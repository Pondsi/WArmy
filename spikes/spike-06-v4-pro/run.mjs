/**
 * Spike 6：DeepSeek V4 Pro 可用性验证（真实调用，不伪造）
 *
 * DoD（ADR 000 第四章）：`deepseek-pro` / V4 Pro API 返回正常响应。
 *
 * 本脚本只做一件事：拿 DEEPSEEK_API_KEY 去真调 API，把**原始响应**
 * （HTTP 状态码 + 响应体片段，密钥已脱敏）落盘到 result.json。
 * 没有凭据时**必须**记为「跳过/未能验证」，绝不在未调用的情况下报通过。
 *
 * 用法（在仓库内任意目录）：
 *   Windows PowerShell:
 *     $env:DEEPSEEK_API_KEY="sk-xxxx"; & "C:\Program Files\nodejs\node.exe" spikes/spike-06-v4-pro/run.mjs
 *   bash / macOS / Linux:
 *     DEEPSEEK_API_KEY=sk-xxxx node spikes/spike-06-v4-pro/run.mjs
 *
 * 可选参数：
 *   --models=id1,id2        覆盖探测的模型 id 列表（默认含 deepseek-v4-pro 与 deepseek-pro）
 *   --base-url=https://...  覆盖 base URL（默认 https://api.deepseek.com，可用 DEEPSEEK_BASE_URL）
 *   --timeout-ms=20000      单次请求超时（默认 20000）
 *   --out=path              覆盖结果文件路径（默认 ./result.json，相对本目录）
 *   --reachability          即使没有 key 也做一次匿名可达性探测（默认开；--no-reachability 关闭）
 *
 * 退出码：
 *   0 = 已用凭据真实调用，且目标模型返回正常响应（DoD 达标）
 *   1 = 已用凭据真实调用，但目标模型未返回正常响应（DoD 不达标）
 *   3 = 无凭据，跳过（未能验证）
 *   4 = 参数/环境错误
 *
 * 安全：密钥只用于 Authorization 头；日志与 result.json 中一律替换为 sk-***REDACTED***，
 *      另存 keySha256Prefix（前 12 位）便于跨机器比对同一把 key，不可逆。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_MODELS = [
  'deepseek-v4-pro',
  'deepseek-pro',
  'deepseek-flash',
  'deepseek-chat',
  'deepseek-reasoner',
];

function parseArgs(argv) {
  const out = { models: null, baseUrl: null, timeoutMs: 20000, out: null, reachability: true };
  for (const a of argv.slice(2)) {
    if (a.startsWith('--models=')) out.models = a.slice('--models='.length).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith('--base-url=')) out.baseUrl = a.slice('--base-url='.length).trim();
    else if (a.startsWith('--timeout-ms=')) out.timeoutMs = Number(a.slice('--timeout-ms='.length)) || 20000;
    else if (a.startsWith('--out=')) out.out = a.slice('--out='.length).trim();
    else if (a === '--no-reachability') out.reachability = false;
    else if (a === '--reachability') out.reachability = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv);

if (args.help) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
  process.exit(0);
}

const BASE_URL = (args.baseUrl || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
const MODELS = args.models && args.models.length ? args.models : DEFAULT_MODELS;
const OUT = args.out ? path.resolve(args.out) : path.join(__dirname, 'result.json');
const KEY = process.env.DEEPSEEK_API_KEY || '';

/** 密钥脱敏：任何落盘/打印的文本都先过这里 */
function redact(text) {
  let s = String(text ?? '');
  if (KEY && KEY.length >= 8) s = s.split(KEY).join('sk-***REDACTED***');
  // 兜底：Authorization 头回显
  s = s.replace(/(Bearer\s+)[A-Za-z0-9._\-]{8,}/g, '$1sk-***REDACTED***');
  s = s.replace(/sk-[A-Za-z0-9._\-]{8,}/g, 'sk-***REDACTED***');
  return s;
}

/** 截断响应体，保留可判读片段 */
function snippet(text, max = 600) {
  const s = redact(text);
  return s.length > max ? `${s.slice(0, max)}…(+${s.length - max} chars)` : s;
}

async function httpOnce(method, url, { headers = {}, body = null, timeoutMs = 20000 } = {}) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    return {
      ok: true,
      status: res.status,
      statusText: res.statusText,
      elapsedMs: Date.now() - started,
      bodyText: text,
      body: anQuanJson(text),
    };
  } catch (e) {
    return {
      ok: false,
      errorName: e?.name ?? 'Error',
      errorMessage: redact(e?.message ?? String(e)),
      elapsedMs: Date.now() - started,
    };
  }
}

function anQuanJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function resultFor(r) {
  if (!r.ok) {
    return {
      transportOk: false,
      requestFailed: true,
      errorName: r.errorName,
      errorMessage: r.errorMessage,
      elapsedMs: r.elapsedMs,
      raw: null,
    };
  }
  const errObj = r.body?.error ?? null;
  return {
    transportOk: true,
    requestFailed: false,
    httpStatus: r.status,
    httpStatusText: r.statusText,
    elapsedMs: r.elapsedMs,
    // 原始响应体片段（已脱敏）
    rawBodySnippet: snippet(r.bodyText),
    // 结构化判读（来自原始响应体，不额外推断）
    modelEcho: r.body?.model ?? null,
    finishReason: r.body?.choices?.[0]?.finish_reason ?? null,
    contentSnippet: snippet(r.body?.choices?.[0]?.message?.content ?? '', 160),
    errorCode: errObj?.code ?? null,
    errorMessage: errObj?.message ? snippet(errObj.message, 300) : null,
    ok: r.status >= 200 && r.status < 300,
  };
}

const report = {
  spike: 'spike-06-v4-pro',
  title: 'DeepSeek V4 Pro 可用性（真实 API 调用）',
  dod: 'V4 Pro API 返回正常响应',
  ranAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    hostname: os.hostname(),
  },
  request: {
    baseUrl: BASE_URL,
    modelsProbed: MODELS,
    timeoutMs: args.timeoutMs,
    authHeaderPresent: !!(KEY && KEY.length),
  },
  credential: {
    source: KEY ? 'env:DEEPSEEK_API_KEY' : null,
    present: !!(KEY && KEY.length),
    length: KEY ? KEY.length : 0,
    keySha256Prefix: KEY ? crypto.createHash('sha256').update(KEY).digest('hex').slice(0, 12) : null,
  },
  reachabilityProbe: null,
  modelsEndpoint: null,
  calls: [],
  verdict: null,
};

/** 匿名可达性探测：不带 key 打一次 /models（预期 401）。仅证明「端点可达」，不证明模型可用 */
if (args.reachability) {
  const r = await httpOnce('GET', `${BASE_URL}/models`, { timeoutMs: Math.min(args.timeoutMs, 15000) });
  report.reachabilityProbe = r.ok
    ? {
        note: '匿名（无 Authorization）请求，仅用于确认端点可达；401/403 属预期，不代表模型可用',
        httpStatus: r.status,
        elapsedMs: r.elapsedMs,
        rawBodySnippet: snippet(r.bodyText, 300),
      }
    : { note: '匿名请求未能建立连接', errorName: r.errorName, errorMessage: r.errorMessage, elapsedMs: r.elapsedMs };
  console.log(`[spike-06] 匿名可达性探测：${r.ok ? `HTTP ${r.status}` : `失败 ${r.errorName}: ${r.errorMessage}`}`);
}

if (!report.credential.present) {
  report.verdict = {
    status: 'skipped',
    dodMet: false,
    reason:
      '未设置环境变量 DEEPSEEK_API_KEY（本机无任何 API key），未发出任何鉴权请求，因此**无法验证** deepseek-v4-pro / deepseek-pro 的可用性。',
    howToReproduce: '设置 DEEPSEEK_API_KEY 后重跑本脚本：node spikes/spike-06-v4-pro/run.mjs',
  };
  console.log('[spike-06] 未发现 DEEPSEEK_API_KEY → 跳过，判定「未能验证」。');
} else {
  // 1) 带凭据拉取 models 列表（原始证据）
  const modelsRes = await httpOnce('GET', `${BASE_URL}/models`, {
    headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json' },
    timeoutMs: args.timeoutMs,
  });
  const m = resultFor(modelsRes);
  report.modelsEndpoint = {
    ...m,
    modelIds: modelsRes.ok
      ? (modelsRes.body?.data ?? []).map((d) => d?.id).filter(Boolean)
      : null,
  };
  console.log(`[spike-06] GET /models → ${modelsRes.ok ? `HTTP ${modelsRes.status}` : '请求失败'}`);

  // 2) 逐个模型发最小 chat 请求（真调用，拿原始响应）
  for (const model of MODELS) {
    const body = JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 8,
      stream: false,
    });
    const res = await httpOnce('POST', `${BASE_URL}/chat/completions`, {
      headers: {
        Authorization: `Bearer ${KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body,
      timeoutMs: args.timeoutMs,
    });
    const rec = { model, ...resultFor(res) };
    report.calls.push(rec);
    console.log(
      `[spike-06] POST /chat/completions model=${model} → ` +
        (rec.transportOk ? `HTTP ${rec.httpStatus} ${rec.ok ? 'OK' : 'ERR'}` : `传输失败 ${rec.errorName}`) +
        (rec.errorCode ? ` code=${rec.errorCode}` : '')
    );
  }

  // 3) 判定：DoD 只看 V4 Pro 家族（deepseek-v4-pro 为主，deepseek-pro 为 ADR 原始写法）
  const primary = report.calls.find((c) => c.model === 'deepseek-v4-pro');
  const legacy = report.calls.find((c) => c.model === 'deepseek-pro');
  const primaryOk = !!primary?.ok;
  const legacyOk = !!legacy?.ok;
  report.verdict = {
    status: primaryOk ? 'verified-pass' : 'verified-fail',
    dodMet: primaryOk,
    deepseekV4ProOk: primaryOk,
    deepseekProAliasOk: legacyOk,
    reason: primaryOk
      ? `deepseek-v4-pro 返回 HTTP ${primary.httpStatus} 且响应体含 model=${primary.modelEcho ?? 'n/a'}，DoD 达标。`
      : `deepseek-v4-pro 未返回正常响应（${primary?.transportOk ? `HTTP ${primary.httpStatus}` : primary?.errorMessage ?? '未知'}），DoD 不达标。`,
    note: legacyOk
      ? 'deepseek-pro 亦可用。'
      : 'ADR 原文写的 deepseek-pro 未返回正常响应，需以 deepseek-v4-pro 为准。',
  };
  console.log(`[spike-06] 判定：${report.verdict.status} — ${report.verdict.reason}`);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(`[spike-06] 原始结果已写入：${OUT}`);
console.log(`[spike-06] exit code 将反映判定（0=达标 / 1=调用后不达标 / 3=无凭据跳过）`);

process.exit(report.verdict.status === 'verified-pass' ? 0 : report.verdict.status === 'verified-fail' ? 1 : 3);
