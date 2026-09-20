/**
 * 工具调用验证（ADR 002 §9.4 待办 2）—— 可重跑：
 *   node packages/app-shell/scripts/verify-tool-calls.mjs [--no-electron]
 *
 * 要证明的事：指针里的 `recall(...) / retrieve(...)` 现在**模型当轮真的能调用**，
 * 而且整条链路（模型要工具 → 宿主执行回想/取回 → 结果回给模型 → 模型终答）是被实测的，
 * 不是"控制器里接了个函数"。
 *
 * 覆盖：
 *   [1] 全链路（真 MemoryClient 子进程 + 真记忆服务 + 真 Provider + 真 HTTP mock 模型）：
 *       第 1 轮模型要求 recall → 宿主执行 → 结果回给模型；
 *       第 2 轮模型**从上一条工具结果里解析出 recordId** 再要求 retrieve（真链路，不是脚本写死）；
 *       第 3 轮模型终答，且答案里带"它收到的原文"的 sha256 —— 与写入记忆的原文逐字节比对。
 *   [2] 最大轮数生效（mock 模型一直要工具 → 工具轮被上限截断 + 强制收敛一次）。
 *   [3] 工具结果总预算生效（单条上限 + 总量上限都被实测）。
 *   [4] 优雅降级：Ollama（协议不支持）/ 首次带 tools 直接报错的中转 / 调用方不给 tools。
 *   [5] 真 Electron：chat-send 走真 IPC → audit 有痕迹（且不含密钥）→ tools 真的进了请求体 →
 *       settings.contextToolMaxRounds=0 时退回现状（请求体无 tools）。
 *   [6] 真 Electron + 记忆服务坏掉：对话仍能发（工具撤销、重建跳过、不报错）。
 */
import {execFileSync, spawn} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(here, '..');
const repoRoot = path.join(pkgRoot, '..', '..');
const require = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const SKIP_ELECTRON = argv.includes('--no-electron');

let failures = 0;
const failuresList = [];
function check(label, cond, detail) {
  if (!cond) {
    failures++;
    failuresList.push(label);
  }
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}${detail === undefined ? '' : ` => ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
const sha16 = (s) => sha(s).slice(0, 16);

// ── 被测实现（构建产物） ──
const distProviders = path.join(repoRoot, 'packages', 'providers', 'dist', 'index.js');
const distRenderer = path.join(pkgRoot, 'dist', 'context-renderer.js');
const distMemoryClient = path.join(pkgRoot, 'dist', 'memory-client.js');
for (const f of [distProviders, distRenderer, distMemoryClient]) {
  if (!fs.existsSync(f)) {
    console.error('[verify-tool-calls] 缺少构建产物，请先 build：' + f);
    process.exit(2);
  }
}
const providers = await import(pathToFileURL(distProviders).href);
const { liaoTianDaiGongJu, congYuSheChuangJian, OllamaGongYing, JianrongOpenAIGongYing } = providers;
const { renderBoundedView } = await import(pathToFileURL(distRenderer).href);
const { MemoryClient, memoryToolSpecs, runMemoryTool } = await import(pathToFileURL(distMemoryClient).href);

console.log('=== ADR 002 §9.4 待办 2：工具调用（recall/retrieve）验证 ===');
console.log(`providers=${distProviders}`);
console.log(`renderer=${distRenderer}\n`);

/** OpenAI 兼容的 tool_calls 响应 */
function toolCallResponse(id, name, args) {
  return {
    id: 'chatcmpl-' + id,
    model: 'mock',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
        },
        finish_reason: 'tool_calls',
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: 0 },
  };
}
function textResponse(text) {
  return {
    id: 'chatcmpl-final',
    model: 'mock',
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 120, completion_tokens: 30 },
  };
}
/** 起一个真 HTTP mock 模型；handler(body, res) 决定回什么 */
async function startModelServer(handler) {
  const state = { requests: [] };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body = {};
      try {
        body = JSON.parse(raw || '{}');
      } catch {
        /* 忽略 */
      }
      state.requests.push({ path: req.url, body });
      const out = handler(body, state);
      if (out && out.__httpStatus) {
        res.writeHead(out.__httpStatus, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: out.__error || 'error' } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out));
    });
  });
  const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
  return { server, state, base: `http://127.0.0.1:${port}/v1`, ollamaBase: `http://127.0.0.1:${port}` };
}

const toolMsgsOf = (body) => (body.messages || []).filter((m) => m.role === 'tool');

// ══════════════════════════════════════════════════════════════
// [0] 真记忆服务（MemoryClient 子进程）—— 工具执行器的真实后端
// ══════════════════════════════════════════════════════════════
console.log('[0] 真记忆服务子进程 + 真工具执行器（runMemoryTool）');
const memAscii = path.join(os.tmpdir(), 'warmy-verify-tools-mem');
fs.rmSync(memAscii, { recursive: true, force: true });
fs.mkdirSync(path.join(memAscii, 'dist'), { recursive: true });
const memPkg = path.join(repoRoot, 'packages', 'memory-os');
fs.copyFileSync(path.join(memPkg, 'package.json'), path.join(memAscii, 'package.json'));
for (const f of fs.readdirSync(path.join(memPkg, 'dist'))) {
  if (f.endsWith('.js') || f.endsWith('.json')) fs.copyFileSync(path.join(memPkg, 'dist', f), path.join(memAscii, 'dist', f));
}
if (fs.existsSync(path.join(memPkg, 'node_modules'))) {
  fs.symlinkSync(path.join(memPkg, 'node_modules'), path.join(memAscii, 'node_modules'), 'junction');
}
const memData = path.join(memAscii, 'data');
const memory = new MemoryClient({ nodePath: process.execPath, ipcEntry: path.join(memAscii, 'dist', 'ipc.js'), dataDir: memData });
let memOk = true;
try {
  await memory.start();
} catch (e) {
  memOk = false;
  console.error('  记忆服务启动失败：' + String(e));
}
check('真记忆服务子进程已就绪（MemoryClient.isReady）', memOk && memory.isReady === true, { ready: memory.isReady });

const specs = memoryToolSpecs();
check('工具清单 = recall + retrieve（且描述说清何时用/入参/返回）', specs.length === 2 && specs.map((s) => s.function.name).sort().join(',') === 'recall,retrieve', specs.map((s) => s.function.name));
check(
  '工具描述包含「何时用」与入参说明（模型可见）',
  specs.every((s) => (s.function.description || '').length > 60 && s.function.parameters && Object.keys(s.function.parameters.properties || {}).length >= 1),
  specs.map((s) => ({ name: s.function.name, descChars: (s.function.description || '').length, params: Object.keys(s.function.parameters.properties || {}) }))
);

// 写入真实记录：一条带唯一标记的长正文（会被挤出视图），若干背景记录
const N = 24;
const bodies = new Map();
let markerSeq = 0;
let markerId = '';
let markerBody = '';
for (let i = 0; i < N; i++) {
  const id = `m-${Date.now()}-${i + 1}`;
  const isMarker = i === N - 3;
  const body = isMarker
    ? `值班者状态机｜上下文有界渲染器｜工具调用全链路验证\nMARKER-${sha16('marker-' + i)}\n` + 'Z'.repeat(600) + '\nMARKER-END'
    : `背景记录 ${i}｜值班者状态机与有界渲染器\npayload-${i}-` + 'X'.repeat(200) + `-end-${i}`;
  const rec = await memory.append({ id, sessionId: 's-tools', kind: 'message', body }, 'duty');
  bodies.set(id, { body, seq: Number(rec.seq), role: i % 2 === 0 ? 'user' : 'assistant' });
  if (isMarker) {
    markerSeq = Number(rec.seq);
    markerId = id;
    markerBody = body;
  }
}
check('真记忆服务写入 24 条记录（含一条带标记的长正文）', bodies.size === N && markerSeq > 0 && !!markerId, { records: bodies.size, markerSeq, markerChars: markerBody.length });

// 视图：小预算 → 标记那条必然被挤出视图（只留指针）
const log = [...bodies.entries()].map(([id, v]) => ({ seq: v.seq, role: v.role, content: v.body, recordId: id }));
const view = renderBoundedView(log, { budgetChars: 900, recallHint: '值班者状态机' });
const viewText = view.messages.map((m) => m.content).join('\n');
check('视图确实把标记正文挤出去了（只剩指针）', view.elided.length > 0 && !viewText.includes('MARKER-END'), {
  viewBytes: view.stats.viewBytes,
  pointers: view.stats.pointers,
  elided: view.elided.reduce((s, r) => s + r.count, 0),
});

// ══════════════════════════════════════════════════════════════
// [1] 全链路：模型 recall → 宿主执行 → 结果回模型 → 模型 retrieve → 终答
// ══════════════════════════════════════════════════════════════
console.log('\n[1] 全链路：模型要工具 → 宿主执行 → 结果回给模型 → 终答');
{
  const events = [];
  const mock = await startModelServer((body, state) => {
    const toolMsgs = toolMsgsOf(body);
    if (toolMsgs.length === 0) {
      // 第 1 轮：模型只看到"指针"，先按语义线索 recall
      return toolCallResponse('call-recall-1', 'recall', { query: '值班者状态机', limit: 5 });
    }
    if (toolMsgs.length === 1) {
      // 第 2 轮：模型**从上一条工具结果里**解析出 recordId 再 retrieve（真链路）
      const m = /recordId=([A-Za-z0-9._\-]+)/.exec(String(toolMsgs[0].content || ''));
      state.parsedRecordId = m ? m[1] : '';
      // 取回锚点宁可不用 cards 里的第一个：用标记那条的 seq（模型从工具结果里读到的 seq 也在里面）
      const seqM = /seq=(\d+)/.exec(String(toolMsgs[0].content || ''));
      state.parsedSeq = seqM ? Number(seqM[1]) : undefined;
      return toolCallResponse('call-retrieve-1', 'retrieve', state.parsedRecordId ? { recordId: state.parsedRecordId } : { seq: state.parsedSeq });
    }
    // 第 3 轮：把"它收到的原文"的哈希写进终答 —— 逐字节一致性的判据
    const last = String(toolMsgs[toolMsgs.length - 1].content || '');
    const raw = (/——原文——\n([\s\S]*?)(?:\n…\[本段到此为止|$)/.exec(last) || [])[1] || '';
    state.receivedChars = raw.length;
    return textResponse(`FINAL: 已取回 ${raw.length} 字符，sha16=${sha16(raw)}`);
  });
  const provider = congYuSheChuangJian('deepseek', { apiKey: 'sk-mock', baseURL: mock.base, model: 'mock' });
  const loop = await liaoTianDaiGongJu(
    provider,
    { model: 'mock', messages: view.messages, maxTokens: 256, tools: specs },
    (call, ctx) => runMemoryTool(memory, call, { maxChars: ctx.maxResultChars }).then((r) => r.content),
    { maxRounds: 4, onEvent: (e) => events.push(e) }
  );
  const reqs = mock.state.requests.map((r) => r.body);
  const finalText = loop.response.choices[0]?.message?.content || '';

  check('模型请求带 tools（recall/retrieve 真的暴露给了模型）', Array.isArray(reqs[0]?.tools) && reqs[0].tools.length === 2, (reqs[0]?.tools || []).map((t) => t.function?.name));
  check('发出 3 次模型请求（要工具 → 再要工具 → 终答）', loop.requests === 3 && reqs.length === 3, { requests: loop.requests, http: reqs.length });
  check('宿主执行了 2 次工具调用', loop.toolCalls === 2 && loop.rounds === 2, { toolCalls: loop.toolCalls, rounds: loop.rounds });
  check('stopReason=stop（模型自然收敛）', loop.stopReason === 'stop' && loop.degraded === false, { stopReason: loop.stopReason, degraded: loop.degraded });
  const r2 = toolMsgsOf(reqs[1] || {})[0];
  check('第 2 次请求里带着 recall 的结果（工具结果回给了模型）', !!r2 && /recall\(/.test(String(r2.content)) && /recordId=/.test(String(r2.content)) && String(r2.tool_call_id) === 'call-recall-1', {
    toolCallId: r2?.tool_call_id,
    head: String(r2?.content || '').slice(0, 100),
  });
  check('recall 的卡片带真 recordId/seq（宿主真去记忆服务取了）', mock.state.parsedRecordId !== '' && Number.isFinite(mock.state.parsedSeq), {
    parsedRecordId: mock.state.parsedRecordId,
    parsedSeq: mock.state.parsedSeq,
  });
  const r3 = toolMsgsOf(reqs[2] || {})[toolMsgsOf(reqs[2] || {}).length - 1];
  const retrievedRaw = (/——原文——\n([\s\S]*?)(?:\n…\[本段到此为止|$)/.exec(String(r3?.content || '')) || [])[1] || '';
  const wantBody = bodies.get(mock.state.parsedRecordId)?.body;
  check('retrieve 的结果逐字节等于写入记忆的原文', !!wantBody && retrievedRaw === wantBody, {
    recordId: mock.state.parsedRecordId,
    gotChars: retrievedRaw.length,
    wantChars: wantBody?.length,
    gotSha16: sha16(retrievedRaw),
    wantSha16: wantBody ? sha16(wantBody) : null,
  });
  check('模型的终答基于它真正收到的原文（sha16 相符）', /^FINAL:/.test(finalText) && finalText.includes(sha16(wantBody || '')), finalText.slice(0, 80));
  check('工具结果总量在预算内（maxResultChars=4000）', loop.toolResultChars > 0 && loop.toolResultChars <= 4000 + 400, { toolResultChars: loop.toolResultChars });
  check('onEvent 观测到 round/tool 事件（审计面可用）', events.filter((e) => e.kind === 'tool').length === 2 && events.some((e) => e.kind === 'round'), events.map((e) => `${e.kind}:${e.tool || e.round}`));

  // 指针的 seq 线索同样能当轮解引用：retrieve(seq=…) 取回标记那条的逐字节原文
  const bySeq = await runMemoryTool(
    memory,
    { id: 'c-seq', type: 'function', function: { name: 'retrieve', arguments: JSON.stringify({ seq: markerSeq }) } },
    { maxChars: 4000 }
  );
  const seqRaw = (/——原文——\n([\s\S]*?)(?:\n…\[本段到此为止|$)/.exec(bySeq.content) || [])[1] || '';
  check('retrieve(seq=…) 指向标记那条且逐字节一致', bySeq.ok === true && seqRaw === markerBody, {
    seq: markerSeq,
    hitLevel: bySeq.meta.hitLevel,
    gotChars: seqRaw.length,
    wantChars: markerBody.length,
    sha16: sha16(seqRaw),
    wantSha16: sha16(markerBody),
  });
  // 工具的错误路径也要可读（不抛错）：乱参数 / 未知工具 → ok=false；
  // 不存在的 seq → 记忆服务会分级回退（fuzzy），此时**必须**明确告警而不是冒充精确命中。
  const badArgs = await runMemoryTool(memory, { id: 'c-bad', type: 'function', function: { name: 'retrieve', arguments: '{not json' } });
  const noHit = await runMemoryTool(
    memory,
    { id: 'c-miss', type: 'function', function: { name: 'retrieve', arguments: JSON.stringify({ seq: 99999999 }) } }
  );
  const unknown = await runMemoryTool(memory, { id: 'c-u', type: 'function', function: { name: 'nope', arguments: '{}' } });
  check('工具参数错误/未知工具都返回可读文本且 ok=false（不抛错）', !badArgs.ok && !unknown.ok && badArgs.content.length > 10 && unknown.content.length > 10, {
    badArgs: badArgs.content.slice(0, 50),
    unknown: unknown.content.slice(0, 50),
  });
  check('不存在的 seq 走 fuzzy 回退时明确告警（不冒充精确命中）', noHit.ok === true && noHit.meta.hitLevel === 'fuzzy' && /不是精确命中/.test(noHit.content), {
    hitLevel: noHit.meta.hitLevel,
    head: noHit.content.slice(0, 90),
  });
  // 记忆服务不可用（client 不可用/为 null）时工具也要优雅失败
  const noMem = await runMemoryTool(null, { id: 'c-nm', type: 'function', function: { name: 'recall', arguments: JSON.stringify({ query: 'x' }) } });
  check('记忆服务不可用时工具返回可读原因（模型可自行放弃）', noMem.ok === false && /记忆服务/.test(noMem.content), noMem.content.slice(0, 60));

  // 超长记录分段取回：逐字节可拼回全文
  const longBody = '分段取回验证｜' + 'P'.repeat(9000) + '｜END';
  const longRec = await memory.append({ id: `m-${Date.now()}-pager`, sessionId: 's-tools', kind: 'message', body: longBody }, 'duty');
  const longId = `m-${Date.now()}-pager`;
  let assembled = '';
  let offset = 0;
  let pages = 0;
  let truncated = false;
  do {
    const out = await runMemoryTool(
      memory,
      { id: 'c-p', type: 'function', function: { name: 'retrieve', arguments: JSON.stringify({ recordId: longId, offset, maxChars: 4000 }) } },
      { maxChars: 4000 }
    );
    const piece = (/——原文——\n([\s\S]*?)(?:\n…\[本段到此为止|$)/.exec(out.content) || [])[1] || '';
    assembled += piece;
    truncated = !!out.meta.truncated;
    offset = out.meta.nextOffset ?? offset + piece.length;
    pages += 1;
    if (!truncated) break;
  } while (pages < 10);
  check('超长记录可分段取回并逐字节拼回全文（offset/maxChars）', assembled === longBody && pages >= 3 && truncated === false, {
    pages,
    gotChars: assembled.length,
    wantChars: longBody.length,
    seq: Number(longRec.seq),
    sha16: sha16(assembled),
    wantSha16: sha16(longBody),
  });

  mock.server.close();
}

// ══════════════════════════════════════════════════════════════
// [2] 最大轮数 / [3] 总预算
// ══════════════════════════════════════════════════════════════
console.log('\n[2] 最大轮数生效（模型一直要工具）');
{
  const mock = await startModelServer((body) => {
    const n = toolMsgsOf(body).length;
    return toolCallResponse(`call-${n + 1}`, 'retrieve', { seq: markerSeq });
  });
  const provider = congYuSheChuangJian('deepseek', { apiKey: 'sk-mock', baseURL: mock.base, model: 'mock' });
  const loop = await liaoTianDaiGongJu(
    provider,
    { model: 'mock', messages: view.messages, maxTokens: 64, tools: specs },
    (call, ctx) => runMemoryTool(memory, call, { maxChars: ctx.maxResultChars }).then((r) => r.content),
    { maxRounds: 2, maxResultChars: 500 }
  );
  check('工具轮被上限截断（maxRounds=2 → rounds=2、toolCalls=2）', loop.rounds === 2 && loop.toolCalls === 2, { rounds: loop.rounds, toolCalls: loop.toolCalls });
  check('stopReason=max-rounds（如实报告是"截断"而不是"答完了"）', loop.stopReason === 'max-rounds', loop.stopReason);
  const reqs = mock.state.requests.map((r) => r.body);
  check('轮数用尽后强制收敛一次（tool_choice=none），总请求 = maxRounds+1', reqs.length === 3 && reqs[2].tool_choice === 'none', {
    http: reqs.length,
    lastToolChoice: reqs[2]?.tool_choice,
    toolChoices: reqs.map((b) => b.tool_choice),
  });
  check('收敛这次不再执行工具（toolCalls 未增长）', loop.toolCalls === 2 && toolMsgsOf(reqs[2]).length === 2, { toolCalls: loop.toolCalls });
  mock.server.close();
}

console.log('\n[3] 工具结果总预算生效');
{
  const mock = await startModelServer((body) => {
    const n = toolMsgsOf(body).length;
    return toolCallResponse(`call-b${n + 1}`, 'retrieve', { seq: markerSeq, maxChars: 4000 });
  });
  const provider = congYuSheChuangJian('deepseek', { apiKey: 'sk-mock', baseURL: mock.base, model: 'mock' });
  const TOTAL = 500;
  const PER = 200;
  const loop = await liaoTianDaiGongJu(
    provider,
    { model: 'mock', messages: view.messages, maxTokens: 64, tools: specs },
    (call, ctx) => runMemoryTool(memory, call, { maxChars: ctx.maxResultChars }).then((r) => r.content),
    { maxRounds: 3, maxResultChars: PER, maxToolResultChars: TOTAL }
  );
  const sizes = mock.state.requests.flatMap((r) => toolMsgsOf(r.body).map((m) => String(m.content).length));
  check('单条工具结果 ≤ 单条上限 + 截断标记', sizes.every((n) => n <= PER + 80), { sizes, per: PER });
  check('工具结果总量被总预算拦住（≤ 总预算 + 1 条标记开销）', loop.toolResultChars <= TOTAL + 80, { total: loop.toolResultChars, budget: TOTAL });
  check('预算用尽后如实报告 stopReason=budget', loop.stopReason === 'budget', loop.stopReason);
  check('预算用尽也收敛成一次终答（不把半截 tool_calls 交给调用方）', mock.state.requests.length >= 2 && mock.state.requests[mock.state.requests.length - 1].body.tool_choice === 'none', {
    http: mock.state.requests.length,
  });
  console.log(`  单条 ${sizes.join(' / ')} 字符（上限 ${PER}）；总计 ${loop.toolResultChars} 字符（预算 ${TOTAL}）；rounds=${loop.rounds}`);
  mock.server.close();
}

// ══════════════════════════════════════════════════════════════
// [4] 优雅降级
// ══════════════════════════════════════════════════════════════
console.log('\n[4] 优雅降级（不报错，退回现状的普通单轮对话）');
{
  // (a) 协议不支持 tools：真 OllamaProvider 打真 mock /api/chat
  const mock = await startModelServer((body) => ({
    model: body.model || 'ollama-mock',
    message: { role: 'assistant', content: 'ollama 普通回答' },
    done_reason: 'stop',
    prompt_eval_count: 10,
    eval_count: 5,
  }));
  const ollama = new OllamaGongYing({ baseURL: mock.ollamaBase }, { id: 'ollama' });
  check('OllamaProvider.supportsTools=false（协议表）', ollama.supportsTools === false, ollama.supportsTools);
  let executorCalls = 0;
  const loop = await liaoTianDaiGongJu(
    ollama,
    { model: 'ollama-mock', messages: view.messages, maxTokens: 64, tools: specs },
    () => {
      executorCalls += 1;
      return 'never';
    },
    { maxRounds: 3 }
  );
  const body0 = mock.state.requests[0]?.body || {};
  check('降级：只发 1 次模型请求，且请求体里**没有** tools', mock.state.requests.length === 1 && body0.tools === undefined, {
    http: mock.state.requests.length,
    tools: body0.tools,
  });
  check('降级：返回可用的回答（不抛错）', (loop.response.choices[0]?.message?.content || '').length > 0 && loop.degraded === true, {
    reply: loop.response.choices[0]?.message?.content,
    degraded: loop.degraded,
    reason: loop.degradedReason,
    stopReason: loop.stopReason,
  });
  check('降级：工具执行器一次都没被调用', executorCalls === 0 && loop.toolCalls === 0, { executorCalls, toolCalls: loop.toolCalls });
  mock.server.close();

  // (b) 支持 tools 但中转直接报错（HTTP 400）→ 重试一次不带 tools
  const mock2 = await startModelServer((body) => {
    if (Array.isArray(body.tools) && body.tools.length) {
      return { __httpStatus: 400, __error: 'tools are not supported by this model' };
    }
    return textResponse('中转不吃 tools，这是降级后的回答');
  });
  const p2 = new JianrongOpenAIGongYing({ apiKey: 'sk-mock', baseURL: mock2.base }, { id: 'relay', defaultBase: mock2.base });
  const loop2 = await liaoTianDaiGongJu(
    p2,
    { model: 'mock', messages: view.messages, maxTokens: 64, tools: specs },
    () => 'never',
    { maxRounds: 3 }
  );
  check('中转报错也降级成功（不再抛给调用方）', loop2.degraded === true && /降级后的回答/.test(loop2.response.choices[0]?.message?.content || ''), {
    degraded: loop2.degraded,
    reason: loop2.degradedReason,
    reply: loop2.response.choices[0]?.message?.content,
  });
  check('降级后重试的请求确实没带 tools，且请求数如实为 2', mock2.state.requests.length === 2 && mock2.state.requests[1].body.tools === undefined && loop2.requests === 2, {
    http: mock2.state.requests.length,
    requests: loop2.requests,
    tools2: mock2.state.requests[1]?.body?.tools,
  });
  mock2.server.close();

  // (c) 调用方根本不给 tools：普通对话，不算降级
  const mock3 = await startModelServer(() => textResponse('普通回答'));
  const p3 = congYuSheChuangJian('deepseek', { apiKey: 'sk-mock', baseURL: mock3.base, model: 'mock' });
  const loop3 = await liaoTianDaiGongJu(p3, { model: 'mock', messages: view.messages, maxTokens: 32 }, () => 'never', {});
  check('没有 tools 时就是普通对话（degraded=false，不误报降级）', loop3.degraded === false && loop3.requests === 1 && loop3.stopReason === 'stop', {
    degraded: loop3.degraded,
    requests: loop3.requests,
    stopReason: loop3.stopReason,
  });
  mock3.server.close();
}

// ══════════════════════════════════════════════════════════════
// [5][6] 真 Electron
// ══════════════════════════════════════════════════════════════
if (!SKIP_ELECTRON) {
  const electronPath = require('electron');
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-verify-tools-e2e-'));

  /** 准备一份可启动的临时副本（与 verify-e2e 相同的最小 patch） */
  function makeCopy(tag, opts = {}) {
    const root = path.join(tmpRoot, tag);
    const appRoot = path.join(root, 'app');
    fs.mkdirSync(appRoot, { recursive: true });
    fs.cpSync(path.join(pkgRoot, 'dist'), path.join(appRoot, 'dist'), { recursive: true });
    fs.copyFileSync(path.join(pkgRoot, 'package.json'), path.join(appRoot, 'package.json'));
    const userData = path.join(root, 'userdata');
    fs.mkdirSync(userData, { recursive: true });
    const mainFile = path.join(appRoot, 'dist', 'electron-main.js');
    {
      const lines = fs.readFileSync(mainFile, 'utf8').split('\n');
      let seen = false;
      const out = [];
      for (const line of lines) {
        if (line.includes("ipcMain.handle('warmy:clear-error'")) {
          if (seen) continue;
          seen = true;
        }
        out.push(line.includes("app.setAsDefaultProtocolClient('dsh-app')") ? line.replace("app.setAsDefaultProtocolClient('dsh-app')", 'void 0') : line);
      }
      fs.writeFileSync(mainFile, out.join('\n'), 'utf8');
    }
    // 工作区包 junction
    const nmDir = path.join(appRoot, 'node_modules', '@warmy');
    fs.mkdirSync(nmDir, { recursive: true });
    for (const pkg of ['contracts', 'providers', 'group-router', 'board', 'ccr-compressor', 'knowledge-base', 'sync-protocol', 'dsh-runtime', 'asset-governance']) {
      const target = path.join(repoRoot, 'packages', pkg);
      if (!fs.existsSync(target)) continue;
      try {
        fs.symlinkSync(target, path.join(nmDir, pkg), 'junction');
      } catch {
        /* 已存在 */
      }
    }
    const distNm = path.join(appRoot, 'dist', 'node_modules', '@warmy');
    fs.mkdirSync(distNm, { recursive: true });
    if (opts.brokenMemory) {
      // 故意坏掉的记忆服务：prepareMemoryRuntime 的第一候选是 <siteRoot>/memory-os/dist
      const broken = path.join(root, 'memory-os');
      fs.mkdirSync(path.join(broken, 'dist'), { recursive: true });
      fs.writeFileSync(path.join(broken, 'package.json'), JSON.stringify({ name: '@warmy/memory-os', version: '0.0.0-broken', type: 'module', main: './dist/ipc.js' }, null, 2));
      fs.writeFileSync(
        path.join(broken, 'dist', 'ipc.js'),
        "process.stderr.write('memory service intentionally broken for degradation test\\n');\nprocess.exit(1);\n"
      );
    } else {
      try {
        fs.symlinkSync(path.join(repoRoot, 'packages', 'memory-os'), path.join(distNm, 'memory-os'), 'junction');
      } catch {
        /* 已存在 */
      }
      try {
        fs.symlinkSync(path.join(repoRoot, 'packages', 'memory-os'), path.join(nmDir, 'memory-os'), 'junction');
      } catch {
        /* 已存在 */
      }
    }
    return { appRoot, userData, mainFile };
  }

  async function launch({ appRoot, userData, mainFile }, tag) {
    const bundledNodeDir = process.platform === 'win32' ? `win-${process.arch}` : `${process.platform}-${process.arch}`;
    const bundledNode = path.join(repoRoot, 'resources', 'node', bundledNodeDir, process.platform === 'win32' ? 'node.exe' : 'node');
    const child = spawn(electronPath, [mainFile, `--user-data-dir=${userData}`, '--remote-debugging-port=0'], {
      cwd: appRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1', ...(fs.existsSync(bundledNode) ? { WARMY_NODE: bundledNode } : {}) },
    });
    const logs = [];
    let devtoolsPort = 0;
    const onChunk = (d) => {
      const text = String(d);
      logs.push(text);
      const m = text.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (m && m[1]) devtoolsPort = Number(m[1]);
    };
    child.stdout.on('data', onChunk);
    child.stderr.on('data', onChunk);
    const deadline = Date.now() + 30000;
    while (!devtoolsPort && Date.now() < deadline) {
      if (child.exitCode !== null) break;
      await sleep(200);
    }
    if (!devtoolsPort) throw new Error(`[${tag}] 主进程没起来: ${logs.join('').slice(-400)}`);
    const appPrefix = path.join(appRoot, 'dist', 'renderer').toLowerCase().replace(/\\/g, '/');
    let target = null;
    const t2 = Date.now() + 45000;
    while (Date.now() < t2 && !target) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${devtoolsPort}/json/LieBiao`)).json();
        target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl && String(t.url || '').toLowerCase().includes(appPrefix));
      } catch {
        /* 还没起来 */
      }
      if (!target) await sleep(300);
    }
    if (!target) throw new Error(`[${tag}] 没找到本副本的渲染页面`);
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener('error', (e) => reject(new Error(`ws ${String(e?.message || e)}`)), { once: true });
    });
    let seq = 0;
    const pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(`cdp ${JSON.stringify(msg.error)}`));
        else resolve(msg.result);
      }
    });
    const send = (method, params) =>
      new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if (r.exceptionDetails) throw new Error(`renderer exception: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
      return r.result.value;
    };
    let ready = false;
    const t3 = Date.now() + 45000;
    while (Date.now() < t3 && !ready) {
      try {
        ready = await evaluate('(async () => { try { const r = await window.warmy.appInfo(); return !!(r && r.ok); } catch { return false; } })()');
      } catch {
        /* 未就绪 */
      }
      if (!ready) await sleep(400);
    }
    const call = (api, ...args) =>
      evaluate(`(async () => { try { return await window.warmy.${api}(${args.map((a) => JSON.stringify(a)).join(', ')}); } catch (e) { return { __error: String((e && e.message) || e) }; } })()`);
    return {
      child,
      call,
      ready,
      logs,
      close: () => {
        try {
          ws.close();
        } catch {
          /* 忽略 */
        }
        try {
          execFileSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
        } catch {
          try {
            child.kill('SIGKILL');
          } catch {
            /* 忽略 */
          }
        }
      },
    };
  }

  // ── [5] 正常路径：真 Electron + 真记忆服务 + 会要工具的 mock 模型 ──
  console.log('\n[5] 真 Electron：chat-send 暴露工具 → 宿主执行 → audit 留痕');
  {
    const copy = makeCopy('ok');
    const seen = [];
    // 会要工具的 mock 模型：第一轮要 recall，拿到结果后终答
    const mock = await startModelServer((body, state) => {
      const toolMsgs = toolMsgsOf(body);
      const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
      seen.push({ hasTools, toolNames: (body.tools || []).map((t) => t.function?.name), toolsRaw: body.tools || [], toolMsgs: toolMsgs.map((m) => String(m.content)) });
      if (hasTools && toolMsgs.length === 0) {
        return toolCallResponse(`c-recall-${state.requests.length}`, 'recall', { query: '牛马有界渲染工具链', limit: 3 });
      }
      if (hasTools && toolMsgs.length >= 1) {
        return textResponse(`工具回答：宿主返回 ${String(toolMsgs[toolMsgs.length - 1].content).length} 字符`);
      }
      return textResponse('无工具普通回答');
    });

    const app = await launch(copy, 'ok');
    check('[5] Electron 起来且 bootstrap 完成', app.ready === true);
    const setP = await app.call('setProvider', { presetId: 'deepseek', apiKey: 'sk-mock', baseURL: mock.base, model: 'mock', protocol: 'openai-compatible' });
    check('[5] provider 指向本地 mock', setP?.ok === true, setP);

    // 等历史重建完成（记忆服务就绪信号）
    let restore = null;
    for (let i = 0; i < 40; i++) {
      const r = await app.call('chatLog', { sessionId: 's-tools-e2e' });
      restore = r?.stats?.restore;
      if (restore?.done) break;
      await sleep(500);
    }
    check('[5] 记忆服务就绪 + 历史重建已完成', restore?.done === true && restore?.ok === true, restore);

    await app.call('settingsSave', { contextBudgetChars: 800, contextToolMaxRounds: 3, contextToolResultChars: 1500, contextToolTotalChars: 6000 });
    const turns = [];
    for (let i = 0; i < 4; i++) {
      turns.push(await app.call('chatSend', { sessionId: 's-tools-e2e', content: `第 ${i + 1} 轮：` + '牛马有界渲染工具链验证 '.repeat(30) }));
    }
    check('[5] 4 轮 chat-send 走通', turns.every((r) => r && r.ok === true && typeof r.reply === 'string'), turns.map((t) => ({ ok: t?.ok, reply: String(t?.reply || '').slice(0, 20) })));
    check(
      '[5] 注入请求里带了 tools（recall/retrieve），模型当轮可用',
      seen.some((s) => s.hasTools && s.toolNames.sort().join(',') === 'recall,retrieve'),
      { names: seen.find((s) => s.hasTools)?.toolNames }
    );
    // 到达模型的工具描述必须是"何时用/入参/返回"的完整文案（不是键名、不是空描述）
    const firstTools = seen.find((s) => s.hasTools)?.toolsRaw || [];
    check(
      '[5] 到达模型的工具描述完整（含何时用/入参/返回，非键名）',
      firstTools.length === 2 &&
        firstTools.every(
          (t) =>
            typeof t.function?.description === 'string' &&
            t.function.description.length > 60 &&
            t.function.parameters &&
            Object.keys(t.function.parameters.properties || {}).length >= 1 &&
            !/^llm\./.test(t.function.description)
        ),
      firstTools.map((t) => ({ name: t.function?.name, descChars: (t.function?.description || '').length, params: Object.keys(t.function?.parameters?.properties || {}) }))
    );
    check('[5] 宿主真执行了工具并把结果回给模型（tool 消息里带真记忆卡片）', seen.some((s) => s.toolMsgs.some((c) => /recall\(/.test(c) && /recordId=/.test(c) && /seq=/.test(c))), {
      toolMsgSample: seen.flatMap((s) => s.toolMsgs).map((c) => c.slice(0, 60)).slice(0, 2),
    });
    check('[5] 模型终答来自工具结果（回复里含工具返回长度）', turns[turns.length - 1]?.reply?.includes('工具回答：宿主返回'), String(turns[turns.length - 1]?.reply).slice(0, 60));

    const metrics = await app.call('metricsSummary');
    check('[5] metrics 记录工具调用（toolCalls≥1 且成功）', metrics?.toolCalls >= 1 && metrics?.toolCallsOk >= 1 && metrics?.toolTurns >= 1, {
      toolCalls: metrics?.toolCalls,
      toolCallsOk: metrics?.toolCallsOk,
      toolTurns: metrics?.toolTurns,
      stopReasons: metrics?.toolStopReasons,
      toolChars: metrics?.toolChars,
      toolLoopBounded: metrics?.toolLoopBounded,
    });
    check('[5] 视图有界未被工具撑破（viewBounded 仍 true）', metrics?.viewBounded === true && metrics?.viewBytes <= 800, { viewBytes: metrics?.viewBytes, budget: metrics?.viewBudgetChars });

    const audit = await app.call('auditLog', 500);
    const entries = audit?.entries || [];
    const ops = entries.map((e) => e.op);
    check('[5] audit 记录 chat.tool（工具调用留痕）', ops.includes('chat.tool'), [...new Set(ops)].filter((o) => String(o).startsWith('chat.')));
    check('[5] audit 记录 decide/enabled/done（全程留痕）', ops.includes('chat.tools.decide') && ops.includes('chat.tools.enabled') && ops.includes('chat.tools.done'), [...new Set(ops)].filter((o) => String(o).startsWith('chat.')));
    const toolEntry = entries.find((e) => e.op === 'chat.tool');
    check('[5] audit 的工具条目含工具名/锚点/长度（可追溯）', toolEntry?.detail?.tool === 'recall' && typeof toolEntry?.detail?.chars === 'number', toolEntry?.detail);
    const auditJson = JSON.stringify(entries);
    check('[5] audit 里没有密钥（sk-mock / apiKey 均不出现）', !auditJson.includes('sk-mock') && !/api_?key/i.test(auditJson), {
      bytes: auditJson.length,
      hit: auditJson.includes('sk-mock'),
    });

    // settings 关掉工具 → 退回现状（请求体无 tools），对话照常
    await app.call('settingsSave', { contextToolMaxRounds: 0 });
    const before = seen.length;
    const r0 = await app.call('chatSend', { sessionId: 's-tools-e2e', content: '关掉工具之后还能说话吗？' });
    const lastReq = seen[seen.length - 1];
    check('[5] contextToolMaxRounds=0 → 请求体无 tools（退回现状）', r0?.ok === true && seen.length > before && lastReq?.hasTools === false, {
      ok: r0?.ok,
      hasTools: lastReq?.hasTools,
      reply: String(r0?.reply || '').slice(0, 30),
    });
    check('[5] 对话仍能发（降级不报错）', r0?.ok === true && typeof r0.reply === 'string' && r0.reply.length > 0);
    const audit2 = await app.call('auditLog', 300);
    const entryUnavailable = (audit2?.entries || []).find((e) => e.op === 'chat.tools.unavailable');
    check('[5] audit 如实记录"工具未暴露"及原因', entryUnavailable?.detail?.reason === 'disabled-by-settings', entryUnavailable?.detail);

    app.close();
    mock.server.close();
  }

  // ── [6] 记忆服务坏掉：对话仍能发 ──
  console.log('\n[6] 真 Electron + 记忆服务坏掉：工具撤销、重建跳过、对话仍能发');
  {
    const copy = makeCopy('broken', { brokenMemory: true });
    const seen = [];
    const mock = await startModelServer((body) => {
      seen.push({ hasTools: Array.isArray(body.tools) && body.tools.length > 0 });
      return textResponse('记忆服务不可用时也能收到回答');
    });
    const app = await launch(copy, 'broken');
    check('[6] Electron 起来且 bootstrap 完成（记忆服务是坏的）', app.ready === true);
    await app.call('setProvider', { presetId: 'deepseek', apiKey: 'sk-mock', baseURL: mock.base, model: 'mock', protocol: 'openai-compatible' });

    const r = await app.call('chatSend', { sessionId: 's-broken', content: '记忆服务坏了，这条还能发出去吗？' });
    check('[6] 对话仍能发（ok:true 且有回复）', r?.ok === true && String(r.reply || '').length > 0, { ok: r?.ok, reply: r?.reply, error: r?.error });
    check('[6] 请求体里没有 tools（记忆服务不可用 → 不暴露工具）', seen.length >= 1 && seen.every((s) => s.hasTools === false), { requests: seen.length, tools: seen.map((s) => s.hasTools) });
    const logRes = await app.call('chatLog', { sessionId: 's-broken' });
    check('[6] 重建跳过但如实报告（restore.done=true & ok=false）', logRes?.stats?.restore?.done === true && logRes?.stats?.restore?.ok === false, logRes?.stats?.restore);
    check('[6] 日志照常只追加（进程内镜像仍可用）', (logRes?.count || 0) >= 2, { count: logRes?.count, entries: logRes?.entries?.map((e) => ({ seq: e.seq, role: e.role, chars: e.chars })) });
    const audit = await app.call('auditLog', 200);
    const unavailable = (audit?.entries || []).find((e) => e.op === 'chat.tools.unavailable');
    check('[6] audit 记录不可用原因 memory-unavailable', unavailable?.detail?.reason === 'memory-unavailable', unavailable?.detail);
    const bootLog = path.join(copy.userData, 'warmy-boot.log');
    if (fs.existsSync(bootLog)) {
      const lines = fs.readFileSync(bootLog, 'utf8').trim().split('\n').filter((l) => /memory|restore/i.test(l));
      for (const l of lines.slice(-4)) console.log('  boot: ' + l);
    }
    app.close();
    mock.server.close();
  }
  console.log(`  Electron 临时目录: ${tmpRoot}`);
} else {
  console.log('\n[5][6] 跳过 Electron（--no-electron）');
}

// ── 清理 ──
try {
  await memory.stop();
} catch {
  /* 忽略 */
}
fs.rmSync(memAscii, { recursive: true, force: true });

console.log('\n=== SUMMARY ===');
console.log(`failures=${failures}`);
if (failures) {
  console.log('FAILURES:');
  for (const f of failuresList) console.log(' - ' + f);
}
console.log(failures === 0 ? 'ALL PASS（工具调用链路验收通过）' : 'FAILED');
process.exit(failures === 0 ? 0 : 1);
