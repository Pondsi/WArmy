#!/usr/bin/env node
/**
 * perf-100-rounds.mjs —— **100 轮超长上下文压测**（**探针：需要真模型，刻意不进 CI/门禁**）。
 *
 * 它要回答的问题（这是产品必须扛住的真实负载）
 * ---------------------------------------------------------------------------
 * 「连续聊 100 轮、历史累计 >10MB，这个应用还能不能好好干活？」
 * 具体测四件事，全部**用产品自己的模块**（不是另写一套）：
 *   ① **有界渲染**：注入给模型的 prompt 必须**恒定受预算约束**，不随日志线性膨胀
 *      （模块：`dist/context-renderer.js` 的 `xuanranYoujieShitu`）；
 *   ② **真对话**：每一轮都是真的打到 provider（Ollama 本地 / MiMo 云端），拿真回复；
 *   ③ **真工具**：每 N 轮让模型**真的调一次工具**（`runWorkTool` 在会话工作区落盘）；
 *   ④ **真落盘**：日志按产品格式追加进 JSONL，最后给出累计字节（>10MB 的目标）。
 *
 * 同时**顺手记**：每轮耗时分布、失败/重试、降级、进程 RSS 增长 —— 供"有没有问题、哪里能优化"。
 *
 * 用法：
 *   node packages/app-shell/scripts/perf-100-rounds.mjs --provider ollama --model <本地模型> [--rounds 100] [--kb 110]
 *   node packages/app-shell/scripts/perf-100-rounds.mjs --provider mimo --model mimo-v2.6-flash --key-file <含key的文件>
 * 环境变量：WARMY_MIMO_BASE（默认 CN 站）、OLLAMA_BASE（默认 http://127.0.0.1:11434）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(selfDir, '..');
const repoRoot = path.resolve(pkgRoot, '..', '..');
const dist = path.join(pkgRoot, 'dist');

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf('--' + n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const PROVIDER = String(arg('provider', 'ollama'));
const MODEL = String(arg('model', ''));
const ROUNDS = Math.max(1, Number(arg('rounds', '100')));
const KB = Math.max(1, Number(arg('kb', '110')));       // 每轮新增正文 KB（100 轮 ×110KB ≈ 11MB）
const BUDGET = Math.max(400, Number(arg('budget', '6000'))); // 注入预算（字符）
const TOOL_EVERY = Math.max(1, Number(arg('tool-every', '10')));
const KEY_FILE = String(arg('key-file', process.env.WARMY_MIMO_KEY_FILE || ''));

const { chuangjianGongYing, moXingNengLi } = await import(new URL('file://' + path.join(repoRoot, 'packages', 'providers', 'dist', 'index.js')).href);
const { xuanranYoujieShitu } = await import(new URL('file://' + path.join(dist, 'context-renderer.js')).href);
const { runWorkTool, workspaceDirOf } = await import(new URL('file://' + path.join(dist, 'work-tools.js')).href);

const OUT = path.join(os.tmpdir(), 'warmy-perf-100-' + Date.now());
const WS = path.join(OUT, 'workspace');
const JSONL = path.join(OUT, 'fast-memory.jsonl');
fs.mkdirSync(WS, { recursive: true });

/* ── provider ── */
let provider;
if (PROVIDER === 'ollama') {
  const base = process.env.OLLAMA_BASE || 'http://127.0.0.1:11434';
  if (!MODEL) { console.error('需要 --model <本地模型名>（ollama list 里的名字）'); process.exit(2); }
  provider = chuangjianGongYing('ollama', { baseURL: base }, 'ollama');
} else if (PROVIDER === 'mimo') {
  if (!KEY_FILE || !fs.existsSync(KEY_FILE)) { console.error('mimo 需要 --key-file <含 key 的文件>（第一行是 key）'); process.exit(2); }
  const key = fs.readFileSync(KEY_FILE, 'utf8').split(/\r?\n/)[0].trim();
  provider = chuangjianGongYing('openai-compatible', { apiKey: key, baseURL: process.env.WARMY_MIMO_BASE || 'https://token-plan-cn.xiaomimimo.com/v1' }, 'mimo');
} else {
  console.error('--provider 只支持 ollama | mimo');
  process.exit(2);
}

console.log('=== 100 轮超长上下文压测（任务 5/6）===');
console.log(`provider=${PROVIDER} model=${MODEL || '(默认)'} rounds=${ROUNDS} 每轮≈${KB}KB 注入预算=${BUDGET} 字符`);
console.log('产物目录 ' + OUT);

/* 探活 */
try {
  const p = await provider.ping();
  console.log(`连通性：ok=${p.ok} 延迟=${p.latencyMs}ms ${p.detail || ''}`);
  if (!p.ok) console.log('（探活失败也继续跑 —— 用真实请求说话）');
} catch (e) {
  console.log('探活异常：' + String(e?.message || e).slice(0, 120));
}

/* ── 造正文（真实感：带编号与关键实体，便于模型复述） ── */
function zaoZhengWen(i) {
  const hang = [];
  for (let k = 0; k < Math.ceil((KB * 1024) / 96); k++) {
    hang.push(`第${i}轮-第${k + 1}条：编号 SN-${i}-${k}，主题=长上下文稳定性，注意点=有界渲染不随日志膨胀。`);
  }
  return hang.join('\n');
}

const logs = [];        // 产品日志形状（seq/role/content/recordId）
let seq = 0;
const push = (role, content, extra = {}) => {
  seq++;
  const rec = { seq, role, content, ts: Date.now(), sessionId: 'perf-100', ...extra };
  logs.push(rec);
  fs.appendFileSync(JSONL, JSON.stringify(rec) + '\n', 'utf8');
  return rec;
};

const zhiBiao = [];
let toolCalls = 0, toolFails = 0, okRounds = 0, badRounds = 0, degraded = 0;
let siKaoKongBai = 0;   // 内容空但有思考（思考模型把 token 花在思考上）
let zhuangTaiWen = 0;   // 降级说明
let jsonlBytes = 0;

const T0 = Date.now();
for (let lun = 1; lun <= ROUNDS; lun++) {
  const yongTool = lun % TOOL_EVERY === 0;
  const yongHu = yongTool
    // 工具轮：**明确要求动手**（只回一句话的话模型不会调工具，那"真工具"就没被验到）
    ? `第${lun}轮：请把「第${lun}轮压测记录」这句话用 write_file 写进 perf/round-${lun}.txt，然后回一句话确认。\n` + zaoZhengWen(lun).slice(0, 2000)
    : `第${lun}轮：请阅读下面这段材料并回一句话。（只回一句话，别复述全文）\n` + zaoZhengWen(lun);
  push('user', yongHu);
  // 产品口径：注入的是**日志的有界渲染视图**，不是日志本身
  const shitu = xuanranYoujieShitu(logs, { budgetChars: BUDGET, recallHint: `第${lun}轮` });

  const tools = yongTool ? [{
    type: 'function',
    function: {
      name: 'write_file',
      description: '把一段文本写进会话工作区（相对路径）。',
      parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
    },
  }] : undefined;

  const t1 = Date.now();
  let hui = '', cuo = '';
  try {
    const r = await provider.chat({
      model: MODEL || undefined,
      xiaoXiJi: [
        { role: 'system', content: '你是 WArmy 的性能压测助手。回答尽量短（一句话）。' },
        ...shitu.xiaoXiJi,
      ],
      /**
       * ⚠️ 别用 64：**思考模型（qwen3 系）会把 token 全花在思考上，正文必空**
       * （这条在本仓记忆里记过：思考模型 ≤1024 token 内容必空）。8192 是产品里长文的档位。
       */
      maxTokens: 8192,
      ...(tools ? { tools } : {}),
    });
    hui = String(r?.choices?.[0]?.message?.content || '');
    const siKao = String(r?.choices?.[0]?.message?.reasoning || '');
    if (!hui.trim() && siKao.trim()) siKaoKongBai++;
    const tc = r?.choices?.[0]?.message?.gongJuDiaoYongJi || [];
    if (tc.length) {
      for (const c of tc) {
        toolCalls++;
        const wr = runWorkTool(WS, { function: { name: c.function?.name, arguments: c.function?.arguments } }, true);
        if (!wr.ok) toolFails++;
      }
    }
    if (!hui.trim()) degraded++;
  } catch (e) {
    cuo = String(e?.message || e).slice(0, 160);
  }
  const ms = Date.now() - t1;
  if (cuo) { badRounds++; push('assistant', `（本轮失败：${cuo}）`); }
  else { okRounds++; push('assistant', hui, { moXing: MODEL || provider.id }); }
  try { jsonlBytes = fs.statSync(JSONL).size; } catch { /* noop */ }
  zhiBiao.push({ lun, ms, injected: shitu.stats.viewBytes, logBytes: shitu.stats.logBytes, logEntries: shitu.stats.logEntries, pointers: shitu.stats.pointers, ok: !cuo, tool: yongTool, rssMb: Math.round(process.memoryUsage().rss / 1048576) });

  if (lun % 10 === 0 || lun === ROUNDS) {
    const wei = zhiBiao.slice(-10);
    const ping = Math.round(wei.reduce((s, x) => s + x.ms, 0) / wei.length);
    console.log(`  [${String(lun).padStart(3)}/${ROUNDS}] 注入=${shitu.stats.viewBytes}B 日志=${(shitu.stats.logBytes / 1048576).toFixed(2)}MB 条数=${shitu.stats.logEntries} 指针=${shitu.stats.pointers} 近10轮均耗时=${ping}ms RSS=${zhiBiao[zhiBiao.length - 1].rssMb}MB`);
  }
}
const zongMs = Date.now() - T0;

/* ── 结论 ── */
const inj = zhiBiao.map((x) => x.injected);
const msArr = zhiBiao.map((x) => x.ms).sort((a, b) => a - b);
const p = (q) => msArr[Math.min(msArr.length - 1, Math.floor(msArr.length * q))];
/**
 * 判"有没有越过预算"：**头部与尾部是逐字保留的**（ADR §4.1：system 提示与近期对话不许被裁），
 * 所以注入体积**允许有限超出**预算 —— 超出部分应是"逐字保留的头尾"，不是"日志又漏进来了"。
 * 这里按 1.5× 设界：超过就说明有界渲染漏了。
 */
const yueYu = inj.filter((x) => x > BUDGET * 1.5);
const chaoChu = inj.filter((x) => x > BUDGET);
const mb = jsonlBytes / 1048576;

console.log('\n=== 结果 ===');
console.log(`总耗时 ${(zongMs / 1000).toFixed(1)}s；轮次 ${ROUNDS}（成功 ${okRounds} / 失败 ${badRounds}）；空正文 ${degraded}（其中"有思考但无正文" ${siKaoKongBai}）`);
console.log(`日志累计 ${mb.toFixed(2)}MB（${zhiBiao[zhiBiao.length - 1].logEntries} 条）→ 目标 >10MB：${mb > 10 ? '达成' : '**未达成**'}`);
console.log(`注入体积：min=${Math.min(...inj)} max=${Math.max(...inj)} 预算=${BUDGET}；超预算 ${chaoChu.length} 轮（头尾逐字保留属设计），超 1.5× 的 ${yueYu.length} 轮`);
console.log(`耗时：p50=${p(0.5)}ms p95=${p(0.95)}ms max=${msArr[msArr.length - 1]}ms`);
console.log(`工具调用 ${toolCalls} 次（失败 ${toolFails}）；RSS 峰值 ${Math.max(...zhiBiao.map((x) => x.rssMb))}MB`);

const wenTi = [];
if (mb <= 10) wenTi.push(`累计日志只有 ${mb.toFixed(2)}MB，没到 10MB 目标（加大 --kb 或 --rounds）`);
if (yueYu.length) wenTi.push(`有 ${yueYu.length} 轮注入超过 1.5× 预算（有界渲染漏了）`);
if (badRounds) wenTi.push(`${badRounds} 轮失败（看上面失败原因）`);
if (degraded) wenTi.push(`${degraded} 轮返回空正文`);
const shou = zhiBiao.slice(0, 10).reduce((s, x) => s + x.ms, 0) / 10;
const mo = zhiBiao.slice(-10).reduce((s, x) => s + x.ms, 0) / 10;
if (mo > shou * 1.5) wenTi.push(`末 10 轮比前 10 轮慢 ${(mo / shou).toFixed(2)}×（长历史下有性能退化）`);
console.log(wenTi.length ? '\n**发现的问题**：\n  - ' + wenTi.join('\n  - ') : '\n没有发现问题（上述指标全部达标）');
fs.writeFileSync(path.join(OUT, 'perf-100.json'), JSON.stringify({ provider: PROVIDER, model: MODEL, rounds: ROUNDS, budget: BUDGET, mb, inj: { min: Math.min(...inj), max: Math.max(...inj) }, ok: okRounds, bad: badRounds, degraded, toolCalls, toolFails, ms: { p50: p(0.5), p95: p(0.95), max: msArr[msArr.length - 1] }, zhiBiao, wenTi }, null, 2), 'utf8');
console.log('明细：' + path.join(OUT, 'perf-100.json'));
process.exit(wenTi.length && mb <= 10 ? 1 : 0);
