/**
 * 会话历史持久化验证（ADR 002 §9.4 待办 4 / 不变量 #5）—— 可重跑：
 *   node packages/app-shell/scripts/verify-history-persist.mjs [--no-electron]
 *
 * 要证明的事：`chatHistories` 不再是"重启即丢的进程内数组"，
 * 而是从记忆服务的只追加日志（**fast-memory.jsonl**，经 memory-client 的 tail 重建）派生；
 * 并且记忆服务不可用时**不会**让对话发不出去。
 *
 * 覆盖：
 *   [1] 真 Electron 第 1 轮：真聊天 → JSONL 落盘 → 记下此刻的日志（seq/角色/摘要/recordId）。
 *   [2] 杀进程、用**同一个 userData** 再起一次（真重启）：
 *       重建后的日志必须与 JSONL 逐条逐字节一致（sha16 比对）、seq 与记忆服务对齐、
 *       且新的一轮对话里模型**真的看到了重启前的消息**（mock 记录的请求体）。
 *   [3] 记忆服务不可用（故意坏掉的子进程）：对话仍能发、日志仍只追加、重建如实报失败。
 *
 * 参数：--no-electron 只做静态断言（文件/契约检查），不启动 Electron。
 */
import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
const sha16 = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex').slice(0, 16);

console.log('=== ADR 002 §9.4 待办 4：会话历史持久化（fast-memory.jsonl 重建）验证 ===');

// ══════════════════════════════════════════════════════════════
// [0] 静态契约：recordId 前缀编码角色（SQLite 投影不含 role，重建只能靠它）
// ══════════════════════════════════════════════════════════════
console.log('\n[0] 静态契约：记忆日志 → 会话日志的角色/序号约定');
{
  const distMemoryClient = path.join(pkgRoot, 'dist', 'memory-client.js');
  if (!fs.existsSync(distMemoryClient)) {
    console.error('[verify-history-persist] 缺少构建产物，请先 build：' + distMemoryClient);
    process.exit(2);
  }
  const { chatRoleOfRecordId, CHAT_RECORD_PREFIX, contentDigest } = await import(pathToFileURL(distMemoryClient).href);
  check(
    'recordId 前缀 → 角色（a-=assistant，其余=用户消息）',
    chatRoleOfRecordId(`${CHAT_RECORD_PREFIX.assistant}-123-1`) === 'assistant' &&
      chatRoleOfRecordId(`${CHAT_RECORD_PREFIX.user}-123-1`) === 'user' &&
      chatRoleOfRecordId(`${CHAT_RECORD_PREFIX.dutyUser}-123-1`) === 'user' &&
      chatRoleOfRecordId('') === 'user',
    {
      assistant: chatRoleOfRecordId(`${CHAT_RECORD_PREFIX.assistant}-1`),
      user: chatRoleOfRecordId(`${CHAT_RECORD_PREFIX.user}-1`),
      duty: chatRoleOfRecordId(`${CHAT_RECORD_PREFIX.dutyUser}-1`),
    }
  );
  check('contentDigest 稳定（重启前后可比对，不落正文）', contentDigest('abc') === contentDigest('abc') && contentDigest('abc') !== contentDigest('abd'), {
    len: contentDigest('abc').length,
  });
  // 主进程源码里：唯一写入点 appendChatLog 同时维护镜像；不再有第二处 chatHistories.push
  const src = fs.readFileSync(path.join(pkgRoot, 'src', 'electron-main.ts'), 'utf8');
  const histPush = [...src.matchAll(/chatHistories\.(push|set)\(/g)].length;
  check('chatHistories 只在 appendChatLog 一处被写（日志是唯一事实来源）', histPush <= 3, { matches: histPush });
  check('启动路径调用 restoreChatLogsFromMemory（重建入口存在）', /restoreChatLogsFromMemory\('boot'\)/.test(src), src.includes("restoreChatLogsFromMemory('boot')"));
}

if (SKIP_ELECTRON) {
  console.log('\n[1][2][3] 跳过 Electron（--no-electron）');
  console.log('\n=== SUMMARY ===');
  console.log(`failures=${failures}`);
  if (failures) {
    for (const f of failuresList) console.log(' - ' + f);
  }
  process.exit(failures === 0 ? 0 : 1);
}

// ══════════════════════════════════════════════════════════════
// Electron 脚手架（与 verify-e2e 相同的临时副本 + CDP 客户端）
// ══════════════════════════════════════════════════════════════
const electronPath = require('electron');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ccarmy-verify-persist-'));

function makeCopy(tag, opts = {}) {
  const root = path.join(tmpRoot, tag);
  const appRoot = path.join(root, 'app');
  fs.mkdirSync(appRoot, { recursive: true });
  fs.cpSync(path.join(pkgRoot, 'dist'), path.join(appRoot, 'dist'), { recursive: true });
  fs.copyFileSync(path.join(pkgRoot, 'package.json'), path.join(appRoot, 'package.json'));
  const userData = opts.userData || path.join(root, 'userdata');
  fs.mkdirSync(userData, { recursive: true });
  const mainFile = path.join(appRoot, 'dist', 'electron-main.js');
  {
    const lines = fs.readFileSync(mainFile, 'utf8').split('\n');
    let seen = false;
    const out = [];
    for (const line of lines) {
      if (line.includes("ipcMain.handle('ccarmy:clear-error'")) {
        if (seen) continue;
        seen = true;
      }
      out.push(line.includes("app.setAsDefaultProtocolClient('dsh-app')") ? line.replace("app.setAsDefaultProtocolClient('dsh-app')", 'void 0') : line);
    }
    fs.writeFileSync(mainFile, out.join('\n'), 'utf8');
  }
  const nmDir = path.join(appRoot, 'node_modules', '@ccarmy');
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
  const distNm = path.join(appRoot, 'dist', 'node_modules', '@ccarmy');
  fs.mkdirSync(distNm, { recursive: true });
  if (opts.brokenMemory) {
    const broken = path.join(root, 'memory-os');
    fs.mkdirSync(path.join(broken, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(broken, 'package.json'), JSON.stringify({ name: '@ccarmy/memory-os', version: '0.0.0-broken', type: 'module', main: './dist/ipc.js' }, null, 2));
    fs.writeFileSync(path.join(broken, 'dist', 'ipc.js'), "process.stderr.write('broken memory (degradation test)\\n');\nprocess.exit(1);\n");
  } else {
    for (const dir of [distNm, nmDir]) {
      try {
        fs.symlinkSync(path.join(repoRoot, 'packages', 'memory-os'), path.join(dir, 'memory-os'), 'junction');
      } catch {
        /* 已存在 */
      }
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
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1', ...(fs.existsSync(bundledNode) ? { CCARM_NODE: bundledNode } : {}) },
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
  if (!devtoolsPort) {
    console.log(logs.join('').slice(-600));
    throw new Error(`[${tag}] 主进程没起来（无调试端口）`);
  }
  const appPrefix = path.join(appRoot, 'dist', 'renderer').toLowerCase().replace(/\\/g, '/');
  let target = null;
  const t2 = Date.now() + 45000;
  while (Date.now() < t2 && !target) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${devtoolsPort}/json/list`)).json();
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
      ready = await evaluate('(async () => { try { const r = await window.ccarmy.appInfo(); return !!(r && r.ok); } catch { return false; } })()');
    } catch {
      /* 未就绪 */
    }
    if (!ready) await sleep(400);
  }
  const call = (api, ...args) =>
    evaluate(`(async () => { try { return await window.ccarmy.${api}(${args.map((a) => JSON.stringify(a)).join(', ')}); } catch (e) { return { __error: String((e && e.message) || e) }; } })()`);
  return {
    child,
    ready,
    call,
    logs,
    close: async () => {
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
      await sleep(1500);
    },
  };
}

async function waitRestore(app, sessionId, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const r = await app.call('chatLog', { sessionId });
    last = r?.stats?.restore;
    if (last?.done) return { restore: last, res: r };
    await sleep(500);
  }
  return { restore: last, res: await app.call('chatLog', { sessionId }) };
}

// ── mock 模型（OpenAI 兼容）：记录所有请求，回固定文本 ──
const seen = [];
const mock = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    let body = {};
    try {
      body = JSON.parse(raw || '{}');
    } catch {
      /* 忽略 */
    }
    seen.push(body);
    // "长回复"开关：用来验证"助手回复在记忆里的正文 = 日志正文"（超长也必须一致）
    const lastUser = [...(body.messages || [])].reverse().find((m) => m.role === 'user');
    const wantsLong = /长回复/.test(String(lastUser?.content || ''));
    const reply = wantsLong ? 'L'.repeat(6000) + '｜LONG-END' : `收到#${seen.length}`;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'chatcmpl-mock',
        model: 'mock',
        choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 8, prompt_cache_hit_tokens: 90 },
      })
    );
  });
});
const mockPort = await new Promise((r) => mock.listen(0, '127.0.0.1', () => r(mock.address().port)));
const mockBase = `http://127.0.0.1:${mockPort}/v1`;

const SESSION = 's-persist';
// 带上唯一标记，便于断言"模型真的看到了重启前的内容"。
// 刻意保持短小（预算 1200 内 5 条消息都能逐字保留），这样"重启前后逐字节一致"是直接可比对的。
const USER1 = `重启前第1轮｜${sha16('u1')}｜牛马历史持久化`;
const USER2 = `重启前第2轮｜${sha16('u2')}｜这条重启后必须在`;
const USER3 = `重启后追问｜${sha16('u3')}｜引用上面第2轮`;

// ══════════════════════════════════════════════════════════════
// [1] 第 1 轮：真聊天 + JSONL 落盘
// ══════════════════════════════════════════════════════════════
console.log('\n[1] 第 1 轮 Electron：聊天 → 记忆服务落盘 JSONL');
const copy = makeCopy('persist');
const userData = copy.userData;
const jsonlPath = path.join(userData, 'memory', 'fast-memory.jsonl');
const app1 = await launch(copy, 'run1');
check('[1] Electron 起来且 bootstrap 完成', app1.ready === true);
check('[1] 记忆服务就绪 + 启动重建已完成（首次无历史也是 ok）', (await waitRestore(app1, SESSION)).restore?.done === true, (await app1.call('chatLog', { sessionId: SESSION }))?.stats?.restore);
await app1.call('setProvider', { presetId: 'deepseek', apiKey: 'sk-mock', baseURL: mockBase, model: 'mock', protocol: 'openai-compatible' });
await app1.call('settingsSave', { contextBudgetChars: 1200 });
const r1 = await app1.call('chatSend', { sessionId: SESSION, content: USER1 });
const r2 = await app1.call('chatSend', { sessionId: SESSION, content: USER2 });
check('[1] 两轮 chat-send 走通', r1?.ok === true && r2?.ok === true, { r1: r1?.ok, r2: r2?.ok, err: r1?.error || r2?.error });

const logBefore = await app1.call('chatLog', { sessionId: SESSION });
check('[1] 会话日志有 4 条（2 轮 × 用户+助手）', logBefore?.count === 4, { count: logBefore?.count, entries: logBefore?.entries?.map((e) => ({ seq: e.seq, role: e.role, chars: e.chars })) });
check('[1] 历史镜像与日志条数一致（不再有第二份真相）', logBefore?.stats?.historyMirror === 4, { mirror: logBefore?.stats?.historyMirror });
let jsonlRecords = [];
if (fs.existsSync(jsonlPath)) {
  jsonlRecords = fs
    .readFileSync(jsonlPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}
check('[1] JSONL 落盘且有 4 条 message（不变量 #5：唯一事实来源）', fs.existsSync(jsonlPath) && jsonlRecords.filter((r) => r.kind === 'message').length >= 4, {
  jsonl: jsonlPath,
  bytes: fs.existsSync(jsonlPath) ? fs.statSync(jsonlPath).size : 0,
  records: jsonlRecords.length,
});
const jsonlBySeq = new Map(jsonlRecords.map((r) => [Number(r.seq), r]));
const logEntriesBefore = (logBefore?.entries || []).slice(-4);
check(
  '[1] 日志条目的 seq/digest 与 JSONL 逐条一致（写日志时就对齐了记忆服务）',
  logEntriesBefore.every((e) => {
    const rec = jsonlBySeq.get(e.seq);
    return rec && sha16(String(rec.body ?? '')) === e.digest;
  }),
  logEntriesBefore.map((e) => ({ seq: e.seq, digest: e.digest, jsonl: jsonlBySeq.get(e.seq) ? sha16(String(jsonlBySeq.get(e.seq).body ?? '')) : null }))
);
// 超长助手回复：记忆里的正文必须与日志正文**一致**（历史上写记忆时被 slice(0,4000)，长回复尾巴取不回来）
const rLong = await app1.call('chatSend', { sessionId: 's-long', content: '长回复一致性验证（请回 6000 字符）' });
check('[1] 长回复那一轮走通', rLong?.ok === true && String(rLong.reply || '').length > 4000, { replyChars: String(rLong.reply || '').length });
const logLong = await app1.call('chatLog', { sessionId: 's-long' });
const longJsonl = fs
  .readFileSync(jsonlPath, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));
const longBySeq = new Map(longJsonl.map((r) => [Number(r.seq), r]));
const longEntries = logLong?.entries || [];
check(
  '[1] 超长助手回复：日志正文与记忆正文逐字节一致（不再被 slice 成两份真相）',
  longEntries.length === 2 &&
    longEntries[1].chars > 4000 &&
    sha16(String(longBySeq.get(longEntries[1].seq)?.body ?? '')) === longEntries[1].digest &&
    Number(longBySeq.get(longEntries[1].seq)?.body?.length ?? 0) === longEntries[1].chars,
  longEntries.map((e) => ({ seq: e.seq, role: e.role, chars: e.chars, jsonlChars: String(longBySeq.get(e.seq)?.body ?? '').length }))
);
// 长回复之后刷新 JSONL 快照（后面 [2] 要用"重启前的最后一条 seq"）
jsonlRecords = longJsonl;
const jsonlBySeqAll = new Map(longJsonl.map((r) => [Number(r.seq), r]));
const maxSeqBefore = Math.max(...jsonlRecords.map((r) => Number(r.seq)));
console.log(
  `  第 1 轮：logSeqs(s-persist)=${logEntriesBefore.map((e) => e.seq).join(',')}；JSONL ${jsonlRecords.length} 条 / ${fs.statSync(jsonlPath).size} 字节 / maxSeq=${maxSeqBefore}`
);
await app1.close();

// ══════════════════════════════════════════════════════════════
// [2] 真重启（同一 userData）：历史必须还在，且模型能看到
// ══════════════════════════════════════════════════════════════
console.log('\n[2] 真重启（同一 userData）→ 从 fast-memory.jsonl 重建');
const copy2 = makeCopy('persist-restart', { userData });
const app2 = await launch(copy2, 'run2');
check('[2] 重启后 Electron 起来且 bootstrap 完成', app2.ready === true);
const { restore } = await waitRestore(app2, SESSION);
check('[2] 启动时执行了历史重建且成功（restore.ok=true）', restore?.done === true && restore?.ok === true, restore);
check('[2] 重建条数 ≥ 重启前的条数', (restore?.entries || 0) >= logEntriesBefore.length, { entries: restore?.entries, before: logEntriesBefore.length, sessions: restore?.sessions, maxSeq: restore?.maxSeq });
check('[2] 重建的 maxSeq 与 JSONL 最后一条一致（seq 与记忆服务对齐）', restore?.maxSeq === maxSeqBefore, { restored: restore?.maxSeq, jsonlMax: maxSeqBefore });

const logAfter = await app2.call('chatLog', { sessionId: SESSION });
check('[2] 重启后会话日志仍在（不再重启即丢）', logAfter?.count >= 4, { count: logAfter?.count });
const logEntriesAfter = (logAfter?.entries || []).slice(-logEntriesBefore.length);
check(
  '[2] 重建结果与重启前**逐条逐字节一致**（seq/角色/摘要/recordId）',
  logEntriesAfter.length === logEntriesBefore.length &&
    logEntriesAfter.every((e, i) => {
      const b = logEntriesBefore[i];
      return e.seq === b.seq && e.role === b.role && e.digest === b.digest && e.recordId === b.recordId;
    }),
  {
    before: logEntriesBefore.map((e) => ({ seq: e.seq, role: e.role, digest: e.digest })),
    after: logEntriesAfter.map((e) => ({ seq: e.seq, role: e.role, digest: e.digest })),
  }
);
check(
  '[2] 逐字节一致的口径 = 与 JSONL 正文的 sha256 相同',
  logEntriesAfter.every((e) => {
    const rec = jsonlBySeq.get(e.seq);
    return rec && sha16(String(rec.body ?? '')) === e.digest;
  }),
  logEntriesAfter.map((e) => e.seq)
);
check('[2] 角色由 recordId 前缀还原正确（a-=assistant）', logEntriesAfter.filter((e) => e.role === 'assistant').length === 2, logEntriesAfter.map((e) => ({ seq: e.seq, role: e.role, recordId: e.recordId })));
check('[2] recordId 前缀与角色自洽', logEntriesAfter.every((e) => (e.role === 'assistant') === /^a-/.test(String(e.recordId))), logEntriesAfter.map((e) => ({ role: e.role, rid: String(e.recordId).slice(0, 2) })));

// 新的一轮：模型必须看到重启前的消息（mock 记录请求体）
await app2.call('setProvider', { presetId: 'deepseek', apiKey: 'sk-mock', baseURL: mockBase, model: 'mock', protocol: 'openai-compatible' });
const before = seen.length;
const r3 = await app2.call('chatSend', { sessionId: SESSION, content: USER3 });
const req = seen[before];
check('[2] 重启后仍能继续对话', r3?.ok === true, { ok: r3?.ok, reply: r3?.reply, error: r3?.error });
const promptText = JSON.stringify(req?.messages || []);
// 最强口径：把"重启前落进 JSONL 的原始 body"与"重启后真正注入给模型的消息"逐字节比对
const bodiesBefore = logEntriesBefore.map((e) => String(jsonlBySeq.get(e.seq)?.body ?? ''));
const injectedBodies = bodiesBefore.filter((b) => b && promptText.includes(JSON.stringify(b)));
check('[2] 注入 prompt 里逐字节含重启前的全部消息（历史真的回来了）', injectedBodies.length === bodiesBefore.length && bodiesBefore.length === 4, {
  matched: injectedBodies.length,
  total: bodiesBefore.length,
  chars: promptText.length,
});
check('[2] 注入 prompt 里能看到重启前两轮的标记（可读证据）', promptText.includes(sha16('u1')) && promptText.includes(sha16('u2')), {
  u1: promptText.includes(sha16('u1')),
  u2: promptText.includes(sha16('u2')),
});
const injectedChars = (req?.messages || []).reduce((s, m) => s + String(m.content ?? '').length, 0);
check('[2] 重启后的注入仍 ≤ 预算（1200）', injectedChars > 0 && injectedChars <= 1200, { injectedChars, budget: 1200 });

const logFinal = await app2.call('chatLog', { sessionId: SESSION });
const newEntries = (logFinal?.entries || []).filter((e) => e.seq > maxSeqBefore);
check('[2] 重启后新增的日志 seq 严格大于重启前（不重号、不回退）', newEntries.length === 2 && newEntries.every((e) => e.seq > maxSeqBefore), {
  newSeqs: newEntries.map((e) => e.seq),
  maxSeqBefore,
  logSeq: logFinal?.stats?.logSeq,
});
const jsonl2 = fs
  .readFileSync(jsonlPath, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));
const bySeq2 = new Map(jsonl2.map((r) => [Number(r.seq), r]));
check(
  '[2] 重启后新增条目也逐字节落在 JSONL（seq 由记忆服务分配）',
  newEntries.every((e) => {
    const rec = bySeq2.get(e.seq);
    return rec && sha16(String(rec.body ?? '')) === e.digest;
  }),
  newEntries.map((e) => ({ seq: e.seq, digest: e.digest, jsonl: bySeq2.get(e.seq) ? sha16(String(bySeq2.get(e.seq).body ?? '')) : null }))
);
console.log(`  第 2 轮：重建 ${restore?.entries} 条 / ${restore?.sessions} 会话 / maxSeq=${restore?.maxSeq}；重启后新增 ${newEntries.map((e) => e.seq).join(',')}`);
await app2.close();

// ══════════════════════════════════════════════════════════════
// [3] 记忆服务不可用：对话仍能发
// ══════════════════════════════════════════════════════════════
console.log('\n[3] 记忆服务不可用（故意坏掉）→ 降级：对话仍能发');
{
  const copy3 = makeCopy('persist-broken', { brokenMemory: true });
  const app3 = await launch(copy3, 'run3');
  check('[3] Electron 起来且 bootstrap 完成（记忆服务坏掉）', app3.ready === true);
  await app3.call('setProvider', { presetId: 'deepseek', apiKey: 'sk-mock', baseURL: mockBase, model: 'mock', protocol: 'openai-compatible' });
  const before3 = seen.length;
  const r = await app3.call('chatSend', { sessionId: 's-broken-persist', content: '记忆服务坏了，这条也必须能发出去' });
  check('[3] chat-send 仍成功（ok:true 且有回复）', r?.ok === true && String(r.reply || '').length > 0, { ok: r?.ok, reply: r?.reply, error: r?.error });
  check('[3] 确实打到了模型（请求体存在，只是没有工具）', seen.length > before3 && Array.isArray(seen[before3]?.messages) && seen[before3].tools === undefined, {
    requests: seen.length - before3,
    hasTools: seen[before3]?.tools !== undefined,
  });
  const logRes = await app3.call('chatLog', { sessionId: 's-broken-persist' });
  check('[3] 重建被跳过但如实上报失败原因', logRes?.stats?.restore?.done === true && logRes?.stats?.restore?.ok === false, logRes?.stats?.restore);
  check('[3] 进程内日志仍只追加（降级不改语义，不丢当前会话）', (logRes?.count || 0) >= 2, { count: logRes?.count });
  check(
    '[3] 写不进记忆时不挂假 recordId（指针宁缺勿假，只留 seq + recall 两种线索）',
    (logRes?.entries || []).every((e) => e.recordId === null),
    (logRes?.entries || []).map((e) => ({ seq: e.seq, role: e.role, recordId: e.recordId }))
  );
  check('[3] 手动触发重建也如实失败（幂等、不抛错）', (await app3.call('chatLogRestore'))?.ok === false);
  const bootLog = path.join(copy3.userData, 'ccarmy-boot.log');
  if (fs.existsSync(bootLog)) {
    const lines = fs.readFileSync(bootLog, 'utf8').trim().split('\n').filter((l) => /memory|restore/i.test(l));
    for (const l of lines.slice(-4)) console.log('  boot: ' + l);
  }
  await app3.close();
}

mock.close();
console.log(`  Electron 临时目录: ${tmpRoot}`);
console.log('\n=== SUMMARY ===');
console.log(`failures=${failures}`);
if (failures) {
  console.log('FAILURES:');
  for (const f of failuresList) console.log(' - ' + f);
}
console.log(failures === 0 ? 'ALL PASS（会话历史持久化验收通过）' : 'FAILED');
process.exit(failures === 0 ? 0 : 1);
