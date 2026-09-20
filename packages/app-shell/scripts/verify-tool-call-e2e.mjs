/**
 * verify-tool-call-e2e.mjs —— **真实应用**里的工具调用端到端证明（T204 待办：控制台那一类事件从来没人跑通过）
 *
 *   node packages/app-shell/scripts/verify-tool-call-e2e.mjs
 *
 * 要证明的三件事（缺一件都不算"跑通了"）：
 *   1) 真的发起：应用**真的**向模型发了带 tools 的请求（recall/retrieve 由记忆服务就绪后暴露）；
 *   2) 真的完成：宿主真的执行了工具，并把工具结果回给模型，模型据此给出终答（同一个会话里闭环）；
 *   3) **真的在控制台里看得见**：渲染层控制台（T194 那套 IPC 事件流）显示 tool.start / tool.finish 两行，
 *      且这两行同时出现在 ①页面 DOM（#console-out）与 ②原始 IPC 事件流（onConsoleEvent）两处。
 *
 * 模型这一侧的**诚实声明**：本机**没有**任何可用的 provider 密钥
 * （providerCfg 是内存态、默认 apiKey 为空；userData 下没有 secure/keys.enc.json；环境里也没有 *_API_KEY），
 * 所以模型是**本地 OpenAI 兼容桩服务器**（纯 node http，零新依赖）。
 * 这不是"真模型跑通"，而是"**真应用**的 tool-call 流水线端到端跑通，模型换成了桩"——
 * 两者区别很大，报告里必须这么说。
 *
 * 顺带证明：控制台把那把（桩用的）假密钥打码了 —— 密钥类内容不能出现在界面上。
 */
import {execFileSync, spawn} from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {attach, reporter, sleep} from './cdp-lib.mjs';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(here, '..');
const repoRoot = path.join(pkgRoot, '..', '..');

const i18nDir = path.join(pkgRoot, 'src', 'i18n');
const ZH = JSON.parse(fs.readFileSync(path.join(i18nDir, 'zh-CN.json'), 'utf8'));

const PORT = Number(process.env.TOOL_E2E_CDP_PORT || 9589);
/** 桩密钥：形状上要能被产品自己的打码规则命中（sk- 开头），且足够独特，便于断言"界面上没有它" */
const STUB_KEY = 'sk-r16toolstub-DEADBEEF0123456789';
const OUT = process.env.WARMY_TOOL_E2E_OUT || path.join(os.tmpdir(), 'warmy-tool-e2e');

const R = reporter();
const { ok, warn } = R;
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
const sha16 = (s) => require('node:crypto').createHash('sha256').update(String(s)).digest('hex').slice(0, 16);

fs.mkdirSync(OUT, { recursive: true });

/* ══════════════════════════════════════════════════════════════════════════
   1. 本地 OpenAI 兼容桩模型（无人为改动应用：它真的把这个当 provider 用）
   ══════════════════════════════════════════════════════════════════════════ */
const state = { requests: [], toolsSeen: null, toolResults: [], turns: 0 };

const toolCallResponse = (id, name, args) => ({
  id: 'stub-' + id,
  object: 'chat.completion',
  created: Math.floor(Date.now() / 1000),
  model: 'stub-model',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: null, tool_calls: [{ id: 'call-' + id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] },
      finish_reason: 'tool_calls',
    },
  ],
  usage: { prompt_tokens: 120, completion_tokens: 20, total_tokens: 140 },
});

const textResponse = (text) => ({
  id: 'stub-' + Date.now(),
  object: 'chat.completion',
  created: Math.floor(Date.now() / 1000),
  model: 'stub-model',
  choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 160, completion_tokens: 40, total_tokens: 200 },
});

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
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'stub-model' }] }));
      return;
    }
    const tools = Array.isArray(body.tools) ? body.tools : [];
    const toolMsgs = (body.messages || []).filter((m) => m.role === 'tool');
    // users 是给「默认紧急度真的把消息发到模型了吗」取证用的：请求体里必须出现那条原文
    const users = (body.messages || []).filter((m) => m.role === 'user').map((m) => String(m.content || ''));
    state.requests.push({ url: req.url, hasTools: tools.length > 0, toolNames: tools.map((x) => x.function && x.function.name), toolMsgs: toolMsgs.map((m) => String(m.content || '')), users });
    if (tools.length && !state.toolsSeen) state.toolsSeen = tools.map((x) => x.function && x.function.name);
    if (toolMsgs.length) state.toolResults.push(String(toolMsgs[toolMsgs.length - 1].content || ''));
    state.turns++;
    res.writeHead(200, { 'content-type': 'application/json' });
    // 第 1 次：要求 recall（宿主真去记忆服务里取）→ 拿到工具结果后：给终答
    if (tools.length >= 1 && toolMsgs.length === 0) {
      res.end(JSON.stringify(toolCallResponse(String(state.turns), 'recall', { query: '无限牛马 工具链 实测', limit: 3 })));
      return;
    }
    if (toolMsgs.length >= 1) {
      res.end(JSON.stringify(textResponse('工具回答：宿主返回 ' + String(toolMsgs[toolMsgs.length - 1].content || '').length + ' 字符（桩模型终答）')));
      return;
    }
    res.end(JSON.stringify(textResponse('无工具普通回答（桩模型）')));
  });
});
const stubPort = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const STUB_BASE = `http://127.0.0.1:${stubPort}/v1`;
console.log('=== 真应用 tool-call 端到端验收 ===');
console.log('桩模型（本地 OpenAI 兼容，模型不是真的）: ' + STUB_BASE + '\n');

/* ══════════════════════════════════════════════════════════════════════════
   2. 真 Electron（临时副本 + 独立 user-data-dir：不碰用户真实配置，也不碰别的进程）
   ══════════════════════════════════════════════════════════════════════════ */
const electronPath = require('electron');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-tool-e2e-'));
const appRoot = path.join(tmpRoot, 'app');
fs.mkdirSync(appRoot, { recursive: true });
fs.cpSync(path.join(pkgRoot, 'dist'), path.join(appRoot, 'dist'), { recursive: true });
fs.copyFileSync(path.join(pkgRoot, 'package.json'), path.join(appRoot, 'package.json'));
const userData = path.join(tmpRoot, 'userdata');
fs.mkdirSync(userData, { recursive: true });
const mainFile = path.join(appRoot, 'dist', 'electron-main.js');
{
  // 与 verify-tool-calls 同样的最小 patch：注册自定义协议在临时副本里会冲突
  const lines = fs.readFileSync(mainFile, 'utf8').split('\n');
  fs.writeFileSync(
    mainFile,
    lines.map((l) => (l.includes("app.setAsDefaultProtocolClient('dsh-app')") ? l.replace("app.setAsDefaultProtocolClient('dsh-app')", 'void 0') : l)).join('\n'),
    'utf8'
  );
}
const nmDir = path.join(appRoot, 'node_modules', '@warmy');
const distNm = path.join(appRoot, 'dist', 'node_modules', '@warmy');
fs.mkdirSync(nmDir, { recursive: true });
fs.mkdirSync(distNm, { recursive: true });
for (const pkg of ['contracts', 'providers', 'group-router', 'board', 'ccr-compressor', 'knowledge-base', 'sync-protocol', 'dsh-runtime', 'asset-governance', 'memory-os']) {
  const target = path.join(repoRoot, 'packages', pkg);
  if (!fs.existsSync(target)) continue;
  for (const dir of [nmDir, distNm]) {
    try {
      fs.symlinkSync(target, path.join(dir, pkg), 'junction');
    } catch {
      /* 已存在 */
    }
  }
}
const bundledNodeDir = process.platform === 'win32' ? `win-${process.arch}` : `${process.platform}-${process.arch}`;
const bundledNode = path.join(repoRoot, 'resources', 'node', bundledNodeDir, process.platform === 'win32' ? 'node.exe' : 'node');

const child = spawn(electronPath, [mainFile, `--user-data-dir=${userData}`, `--remote-debugging-port=${PORT}`, '--disable-features=CalculateNativeWinOcclusion'], {
  cwd: appRoot,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1', ...(fs.existsSync(bundledNode) ? { WARMY_NODE: bundledNode } : {}) },
});
const appLogs = [];
child.stdout.on('data', (d) => appLogs.push(String(d)));
child.stderr.on('data', (d) => appLogs.push(String(d)));

function killApp() {
  try {
    execFileSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
  } catch {
    try { child.kill('SIGKILL'); } catch { /* noop */ }
  }
}
process.on('exit', () => { try { server.close(); } catch { /* noop */ } });

let c = null;
let pass = false;
try {
  let cdpUp = false;
  for (let i = 0; i < 60 && !cdpUp; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json`, { signal: AbortSignal.timeout(2000) });
      cdpUp = r.ok;
    } catch {
      /* 还没起来 */
    }
    if (!cdpUp) await sleepMs(1000);
  }
  ok(cdpUp, '1-1 真 Electron 主进程起来了（真 main + 真 preload + 真渲染层）', 'CDP 端口 ' + PORT);
  if (!cdpUp) throw new Error('CDP 没起来: ' + appLogs.join('').slice(-400));

  c = await attach(PORT, { label: 'tool-e2e', callTimeout: 20000 });
  await c.send('Runtime.enable');
  await c.waitFor('typeof window.warmy === "object" && typeof window.__saveState === "function"', { timeout: 60000, label: '真应用渲染层就绪' });
  const info = await c.evaluate(`(async function(){ var r = await window.warmy.appInfo(); return JSON.stringify({ ok: r && r.ok, version: r && r.version, href: location.href }); })()`);
  const infoObj = JSON.parse(info);
  ok(infoObj.ok === true && String(infoObj.href).startsWith('file://'), '1-2 渲染层是真 file:// 文档 + 真 IPC（window.warmy 来自真 preload，不是预览桩）', JSON.stringify(infoObj));
  ok((await c.evaluate('window.__PREVIEW__ === undefined')) === true, '1-3 不是预览桩页面（__PREVIEW__ 未定义）', 'ok');

  /* ── 顺带钉死「经典脚本在真 CSP 文档里能加载」：这里是**真应用**的文档（不是预览产物） ── */
  const docFacts = JSON.parse(await c.evaluate(`JSON.stringify((function(){
    var meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    var s = document.querySelector('script[src*="vendor/jsqr-1.4.0.js"]');
    return { csp: meta ? meta.getAttribute('content') : null, jsQR: typeof window.jsQR, qrcode: typeof window.qrcode,
      decTagType: s ? (s.getAttribute('type') || '') : 'absent' };
  })())`));
  ok(/script-src 'self'/.test(String(docFacts.csp)) && !/unsafe-eval/.test(String(docFacts.csp)) &&
    docFacts.jsQR === 'function' && docFacts.qrcode === 'function' && docFacts.decTagType === '',
    '1-4 **真应用**的文档自带 CSP（script-src self，无 unsafe-eval），编码器与解码器都作为经典脚本真的加载成功',
    JSON.stringify(docFacts));
  const decoRaw = await c.evaluate(`(function(){
    var enc = window.qrcode; if (typeof enc !== 'function') return JSON.stringify({ err: 'no-encoder' });
    if (enc.stringToBytesFuncs && enc.stringToBytesFuncs['UTF-8']) enc.stringToBytes = enc.stringToBytesFuncs['UTF-8'];
    var payload = 'warmy://join?node=R16-REALAPP-0001&port=59599&tok=TOK-REAL-0002';
    var qr = enc(0, 'M'); qr.addData(payload, 'Byte'); qr.make();
    var n = qr.getModuleCount(), quiet = 4, unit = 6, total = n + quiet * 2;
    var cv = document.createElement('canvas'); cv.width = total * unit; cv.height = total * unit;
    var ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.fillStyle = '#111';
    for (var r = 0; r < n; r++) for (var c2 = 0; c2 < n; c2++) if (qr.isDark(r, c2)) ctx.fillRect((c2 + quiet) * unit, (r + quiet) * unit, unit, unit);
    var px = ctx.getImageData(0, 0, cv.width, cv.height);
    var res = window.jsQR(px.data, cv.width, cv.height, { inversionAttempts: 'attemptBoth' });
    return JSON.stringify({ payload: payload, decoded: res ? res.data : null, w: cv.width, h: cv.height });
  })()`);
  const deco = typeof decoRaw === 'string' ? JSON.parse(decoRaw) : { bad: typeof decoRaw === 'object' ? JSON.stringify(decoRaw).slice(0, 160) : String(decoRaw) };
  ok(deco.decoded === deco.payload,
    '1-5 在**真应用**的文档里：应用自己的编码器画码 → canvas 像素 → jsQR 解回原字符串（CSP 下真解码，不止"加载成功"）',
    JSON.stringify({ w: deco.w, h: deco.h, ok: deco.decoded === deco.payload, bad: deco.bad }));

  /* ── 2. 用**设置界面**把 provider 指到本地桩（与应用自己保存 baseURL/密钥是同一条路径） ── */
  await c.evaluate(`(function(){var e=document.querySelector('[data-nav="settings"]'); if(e) e.click(); return true;})()`);
  await c.waitForQuiet(`!!document.querySelector('#settings-nav')`, { timeout: 20000, label: '设置页' });
  await c.evaluate(`(function(){var b=document.querySelector('#settings-nav button[data-sec="model"]'); if(b) b.click(); return true;})()`);
  await c.waitFor(`!!document.querySelector('#prov-list .prov-card input[data-k="baseURL"]')`, { timeout: 20000, label: '设置页的供应商卡片' });
  const uiSet = await c.evaluate(`(function(){
    var card = document.querySelector('#prov-list .prov-card');
    var base = card.querySelector('input[data-k="baseURL"]');
    var key = card.querySelector('input[data-k="apiKey"]');
    base.value = ${JSON.stringify(STUB_BASE)};
    base.dispatchEvent(new Event('change', { bubbles: true }));
    key.value = ${JSON.stringify(STUB_KEY)};
    key.dispatchEvent(new Event('change', { bubbles: true }));
    return JSON.stringify({ base: base.value, hasKey: !!key.value });
  })()`);
  const uiSetObj = JSON.parse(uiSet);
  await sleepMs(400);
  const got = JSON.parse(await c.evaluate(`(async function(){ var r = await window.warmy.getProvider(); return JSON.stringify({ ok: r.ok, presetId: r.providerCfg && r.providerCfg.presetId, baseURL: r.providerCfg && r.providerCfg.baseURL, hasKey: r.hasKey, masked: r.providerCfg && r.providerCfg.apiKey }); })()`));
  ok(uiSetObj.base === STUB_BASE && got.baseURL === STUB_BASE && got.hasKey === true,
    '2-1 在**设置界面**里把 provider 的 baseURL/密钥改成自定义 OpenAI 兼容端点，并真的写进了主进程的 providerCfg',
    JSON.stringify({ ui: uiSetObj, cfg: got }));
  ok(got.masked === '***', '2-2 主进程回给渲染层的配置里密钥是打码的（只有 hasKey 布尔）', JSON.stringify({ masked: got.masked }));

  /* ── 3. 等记忆服务就绪（工具只有在记忆服务可用时才暴露；不就绪就如实报，不降低标准） ── */
  let restore = null;
  for (let i = 0; i < 60; i++) {
    const r = await c.evaluate(`(async function(){ var x = await window.warmy.chatLog({ sessionId: 'r16-tool-e2e' }); return JSON.stringify(x && x.stats ? x.stats.restore : null); })()`);
    restore = r ? JSON.parse(r) : null;
    if (restore && restore.done) break;
    await sleepMs(500);
  }
  ok(restore && restore.done === true && restore.ok === true,
    '3-1 真记忆服务就绪 + 会话历史重建完成（工具暴露的前提；不满足就不会暴露 recall/retrieve）', JSON.stringify(restore));

  /* ── 4. 真实会话：在真界面里「建一头牛马 → 开会话 → 输入 → 发送」（不是直接调 IPC） ── */
  await c.evaluate(`(function(){var e=document.querySelector('[data-nav="singleAi"]'); if(e) e.click(); return true;})()`);
  await c.waitForQuiet(`!!document.querySelector('.list-hq-icon')`, { timeout: 15000, label: '「我的牛马」页的牛马管理局入口' });
  // 全新 profile 里没有实例 → 走产品自己的「新建实例」流程（弹窗填名字 → 确定），
  // 这样后面的会话就是**产品自己造出来的**，不是测试塞进去的假会话。
  await c.evaluate(`(function(){ var i = document.querySelector('.list-hq-icon'); if (i) i.click(); return true; })()`);
  await c.waitFor(`!!document.querySelector('#list-action') && !document.querySelector('#list-action').classList.contains('hidden')`, { timeout: 15000, label: '牛马管理局页的新建按钮' });
  await c.evaluate(`(function(){ document.querySelector('#list-action').click(); return true; })()`);
  await c.waitFor(`!!document.querySelector('#modal-body input') && !document.querySelector('#modal-root').classList.contains('hidden')`, { timeout: 10000, label: '新建实例的名字弹窗' });
  await c.evaluate(`(function(){
    var inp = document.querySelector('#modal-body input');
    inp.value = 'R16-值班牛马';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    var bs = document.querySelectorAll('#modal-actions button');
    for (var i = 0; i < bs.length; i++) if (bs[i].classList.contains('btn-primary')) { bs[i].click(); return true; }
    return false;
  })()`);
  await c.waitForQuiet(`!!document.querySelector('#inst-detail') && !document.querySelector('#inst-detail').classList.contains('hidden')`, { timeout: 12000, label: '实例详情页' });
  await c.evaluate(`(function(){var e=document.querySelector('[data-nav="singleAi"]'); if(e) e.click(); return true;})()`);
  await c.waitFor(`!!document.querySelector('#chat-layout') && !document.querySelector('#chat-layout').classList.contains('hidden') && !!document.querySelector('#input')`,
    { timeout: 15000, label: '会话打开（应用自动打开列表里的第一个）' });
  const opened = JSON.parse(await c.evaluate(`JSON.stringify({
    title: (document.querySelector('#chat-title')||document.querySelector('.chat-title')||{}).textContent || '',
    bubbles: document.querySelectorAll('#messages .bubble').length,
    inputVisible: !!document.querySelector('#input') && document.querySelector('#input').offsetParent !== null
  })`));
  ok(opened.inputVisible,
    '4-1 走产品自己的流程：新建牛马 → 自动打开会话 → 输入框可见可用（不是测试塞的假会话）', JSON.stringify(opened));

  // 一、默认紧急度这条路径（本轮修的那条）：**不许**再为了跑通而切到 P1。
  //     修前 P2/P3（P2 就是默认「插入」）只进本地队列、flushQueue 只回显不派发，
  //     所以这条 e2e 当时必须切 P1 才发得出去。现在默认就该真的到达模型。
  const urgUi = JSON.parse(await c.evaluate(`JSON.stringify((function(){
    var lbl = document.querySelector('#urg-label');
    var on = document.querySelector('#urg-menu button.on');
    return {
      label: lbl ? String(lbl.textContent || '') : '',
      on: on ? String(on.dataset.u || '') : '',
      p1On: (function(){ var b = document.querySelector('#urg-menu button[data-u="P1"]'); return !!(b && b.classList.contains('on')); })()
    };
  })())`));
  ok(urgUi.label === ZH['urgency.insertLabel'] && urgUi.on === 'P2' && urgUi.p1On === false,
    '4-2 默认紧急度就是 P2（界面上的原话「' + ZH['urgency.insertLabel'] + '」）—— 这正是修前"发了没反应"的那条默认路径',
    JSON.stringify(urgUi));

  // 页面侧：抓**原始** IPC 事件流（与应用自己那份控制台无关的第二条证据）
  await c.evaluate(`(function(){
    window.__toolE2E = { events: [], replies: [] };
    try { window.warmy.onConsoleEvent(function (ev) { window.__toolE2E.events.push(ev); }); } catch (e) {}
    return true;
  })()`);
  const MSG = 'R16-TOOL-E2E：请调用记忆工具取回「无限牛马 工具链 实测」这条锚点。';
  const sent = await c.evaluate(`(function(){
    var inp = document.querySelector('#input');
    inp.value = ${JSON.stringify(MSG)};
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    var b = document.querySelector('#btn-send');
    if (!b) return 'no-btn';
    if (b.disabled) return 'disabled';
    b.click();
    return 'clicked';
  })()`);
  ok(sent === 'clicked', '4-3 输入框里的消息通过「发送」按钮真的发出去了（点的是真按钮，不是调 IPC）', JSON.stringify({ sent, key: 'sha16=' + sha16(STUB_KEY) }));
  /** 数一数会话里出现了几条"桩模型终答"（不能用"最后一条气泡"判断：上一轮的终答还留在那儿） */
  const finalCount = async () =>
    Number(await c.evaluate(`(function(){ return Array.from(document.querySelectorAll('#messages .bubble')).filter(function(b){ return /桩模型终答/.test(String(b.textContent||'')); }).length; })()`));
  let finalAfterDefault = 0;
  for (let i = 0; i < 90; i++) {
    finalAfterDefault = await finalCount();
    if (finalAfterDefault >= 1) break;
    await sleepMs(1000);
  }
  ok(finalAfterDefault >= 1,
    '4-4 默认紧急度下终答回到聊天气泡（输入框 → 默认 P2 → 队列冲刷 → preload → 主进程 chat-send → 工具循环 → 模型 → 回界面）',
    JSON.stringify({ bubbles: await c.evaluate(`document.querySelectorAll('#messages .bubble').length`), finals: finalAfterDefault }));
  const queuedMsgReachedModel = state.requests.filter((r) => (r.users || []).some((u) => u.indexOf('R16-TOOL-E2E') >= 0));
  ok(queuedMsgReachedModel.length >= 1,
    '4-5 **桩模型真的收到了这条消息**（请求体里出现那条原文）—— 默认路径不再被队列吞掉',
    JSON.stringify({ requests: state.requests.length, hits: queuedMsgReachedModel.length }));
  // 会话 id 从渲染层自己的消息表里反查（哪条会话里有这条消息），不写死 id
  const sidInfo = JSON.parse(await c.evaluate(`JSON.stringify((function(){
    var m = window.__msgs || {};
    var hit = Object.keys(m).filter(function(id){ return (m[id]||[]).some(function(x){ return String(x.text||'').indexOf('R16-TOOL-E2E') >= 0; }); });
    return { ids: hit, all: Object.keys(m) };
  })())`));
  const sessionId = (sidInfo.ids && sidInfo.ids[0]) || '';
  const modeAfterDefault = JSON.parse(await c.evaluate(`(async function(){ var r = await window.warmy.getInsertMode(${JSON.stringify(sessionId)}); return JSON.stringify({ mode: r && r.mode }); })()`));
  ok(!!sessionId && modeAfterDefault.mode === 'outer',
    '4-6 默认 P2 走的是**外循环后插入**（主进程里该会话的插入级别 = outer，与 ADR000「默认：外循环后插入」一致）',
    JSON.stringify({ sessionId, mode: modeAfterDefault.mode }));
  const queueAfter = JSON.parse(await c.evaluate(`JSON.stringify((function(){
    var bar = document.querySelector('#queue-bar');
    return {
      items: (document.querySelector('#queue-items')||{}).innerText || '',
      hidden: bar ? bar.classList.contains('hidden') : null,
      count: (document.querySelector('#queue-count')||{}).textContent || ''
    };
  })())`));
  ok(queueAfter.items.trim() === '' && queueAfter.hidden === true,
    '4-7 「待执行队列」被真的排空了（队列项不是留在条上、也不是只被回显）', JSON.stringify(queueAfter));
  ok(state.turns >= 2, '4-8 桩模型被调用了至少两次（第 1 次给工具调用，第 2 次拿工具结果给终答）', 'turns=' + state.turns);

  /* ── 4b. 紧急度语义没被改坏：P1 仍然立即插入（内循环），P0（停止）仍然只停不发 ── */
  await c.evaluate(`(function(){ var t = document.querySelector('#urg-trigger'); if (t) t.click(); return true; })()`);
  await c.waitFor(`!!document.querySelector('#urg-menu') && !document.querySelector('#urg-menu').classList.contains('hidden')`, { timeout: 8000, label: '紧急度菜单' });
  await c.evaluate(`(function(){ var b = document.querySelector('#urg-menu button[data-u="P1"]'); if (b) b.click(); return true; })()`);
  await c.waitFor(`!!document.querySelector('#modal-actions .btn-danger')`, { timeout: 8000, label: 'P1 倒计时确认弹窗' });
  await c.waitFor(`document.querySelector('#modal-actions .btn-danger').disabled === false`, { timeout: 15000, label: 'P1 倒计时结束（确认键可用）' });
  await c.evaluate(`(function(){ document.querySelector('#modal-actions .btn-danger').click(); return true; })()`);
  await c.waitForQuiet(`document.querySelector('#modal-root').classList.contains('hidden')`, { timeout: 6000, label: '紧急度确立' });
  const p1Label = String(await c.evaluate(`(function(){ var e = document.querySelector('#urg-label'); return e ? String(e.textContent || '') : ''; })()`));
  ok(p1Label === ZH['urgency.urgentLabel'],
    '4-9 切到加急：界面上的紧急度变成 P1（原话「' + ZH['urgency.urgentLabel'] + '」，走完倒计时确认）', p1Label);
  const MSG_P1 = 'R16-P1-E2E：加急这条也要照旧立即插入（不排队）。';
  const turnsBeforeP1 = state.turns;
  await c.evaluate(`(function(){
    var inp = document.querySelector('#input');
    inp.value = ${JSON.stringify(MSG_P1)};
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#btn-send').click();
    return true;
  })()`);
  // P1 是"立即插入"：消息**立刻**进会话，且**不进**排队条
  await c.waitFor(`(document.querySelector('#messages').innerText||'').indexOf('R16-P1-E2E') >= 0`, { timeout: 15000, label: 'P1：用户消息立刻进会话' });
  const p1Queue = String(await c.evaluate(`(function(){ var e = document.querySelector('#queue-items'); return e ? String(e.innerText || '') : ''; })()`));
  let finalsAfterP1 = 0;
  for (let i = 0; i < 90; i++) {
    finalsAfterP1 = await finalCount();
    if (finalsAfterP1 > finalAfterDefault) break;
    await sleepMs(1000);
  }
  ok(p1Queue.indexOf('R16-P1-E2E') < 0 && finalsAfterP1 > finalAfterDefault && state.turns > turnsBeforeP1,
    '4-10 加急（P1）仍然"立即插入"：不进排队条、直接派发、真拿到回复（修前的老路径没被改坏）',
    JSON.stringify({ queueBar: p1Queue.slice(0, 40), turns: state.turns, finals: finalsAfterP1 }));
  const modeP1 = JSON.parse(await c.evaluate(`(async function(){ var r = await window.warmy.getInsertMode(${JSON.stringify(sessionId)}); return JSON.stringify({ mode: r && r.mode }); })()`));
  ok(modeP1.mode === 'inner',
    '4-11 加急（P1）走的是**内循环后插入**（主进程里插入级别 = inner，与 ADR000「P1 立即插入」一致）', JSON.stringify(modeP1));
  const turnsBeforeStop = state.turns;
  const stopLabel = ZH['chat.stopAll'];
  const stopHit = await c.evaluate(`(function(){ var b = document.querySelector('#btn-stop-all'); if (!b) return 'no-btn'; b.click(); return 'clicked'; })()`);
  const bubblesHaveStop = `(function(){ return Array.from(document.querySelectorAll('#messages .bubble')).some(function(x){ return String(x.textContent||'').trim() === ${JSON.stringify(stopLabel)}; }); })()`;
  await c.waitForQuiet(bubblesHaveStop, { timeout: 8000, label: 'P0：停止那句原话' });
  await sleepMs(900);
  ok(stopHit === 'clicked' && (await c.evaluate(bubblesHaveStop)) === true,
    '4-12 停止（P0）仍然只"停"：会话里出现语言包原话「' + stopLabel + '」', stopHit);
  ok(state.turns === turnsBeforeStop,
    '4-13 停止（P0）**不**给模型发任何请求（桩模型调用次数不变：P0 是停止，不是一次发送）',
    'turns ' + turnsBeforeStop + ' -> ' + state.turns);

  /* ── 4c. 默认路径再来一次：这次插入级别要从 inner **翻回** outer（不是"默认值恰好是 outer"） ── */
  await c.evaluate(`(function(){ var t = document.querySelector('#urg-trigger'); if (t) t.click(); return true; })()`);
  await c.waitFor(`!!document.querySelector('#urg-menu') && !document.querySelector('#urg-menu').classList.contains('hidden')`, { timeout: 8000, label: '紧急度菜单（切回 P2）' });
  await c.evaluate(`(function(){ var b = document.querySelector('#urg-menu button[data-u="P2"]'); if (b) b.click(); return true; })()`);
  await c.evaluate(`(function(){ var m = document.querySelector('#urg-menu'); if (m) m.classList.add('hidden'); return true; })()`);
  const modeBeforeP2 = JSON.parse(await c.evaluate(`(async function(){ var r = await window.warmy.getInsertMode(${JSON.stringify(sessionId)}); return JSON.stringify({ mode: r && r.mode }); })()`));
  const turnsBeforeP2 = state.turns;
  const MSG_P2 = 'R16-P2-E2E-002：默认紧急度再来一条，验证不是"只对第一条管用"。';
  await c.evaluate(`(function(){
    var inp = document.querySelector('#input');
    inp.value = ${JSON.stringify(MSG_P2)};
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#btn-send').click();
    return true;
  })()`);
  let finalsAfterP2 = finalsAfterP1;
  for (let i = 0; i < 90; i++) {
    finalsAfterP2 = await finalCount();
    if (finalsAfterP2 > finalsAfterP1) break;
    await sleepMs(1000);
  }
  const modeAfterP2 = JSON.parse(await c.evaluate(`(async function(){ var r = await window.warmy.getInsertMode(${JSON.stringify(sessionId)}); return JSON.stringify({ mode: r && r.mode }); })()`));
  ok(modeBeforeP2.mode === 'inner' && modeAfterP2.mode === 'outer',
    '4-14 默认 P2 的插入级别真的**从 inner 翻回 outer**（所以 4-6 的 outer 是这次发送带过去的，不是主进程的默认值）',
    JSON.stringify({ before: modeBeforeP2.mode, after: modeAfterP2.mode }));
  ok(state.requests.some((r) => (r.users || []).some((u) => u.indexOf('R16-P2-E2E-002') >= 0)) && state.turns > turnsBeforeP2,
    '4-15 默认路径**第二条**同样真的到达模型（不是"只对第一条管用"）', 'turns ' + turnsBeforeP2 + ' -> ' + state.turns);
  await sleepMs(1200);
  const queueAfterP2 = JSON.parse(await c.evaluate(`JSON.stringify((function(){
    var bar = document.querySelector('#queue-bar');
    return { items: (document.querySelector('#queue-items')||{}).innerText || '', hidden: bar ? bar.classList.contains('hidden') : null };
  })())`));
  ok(queueAfterP2.items.trim() === '' && queueAfterP2.hidden === true && finalsAfterP2 > finalsAfterP1,
    '4-16 第二条默认消息也拿到了回复、队列同样被真的排空（没有堆积、没有残留）',
    JSON.stringify({ finals: finalsAfterP2, queue: queueAfterP2 }));

  /* ── 5. 工具真的被发起 + 真的被执行完（两端的证据：模型侧请求体 + 应用侧 metrics） ── */
  const withTools = state.requests.filter((r) => r.hasTools);
  ok(withTools.length >= 1 && (state.toolsSeen || []).slice().sort().join(',') === 'recall,retrieve',
    '5-1 应用真的把 tools（recall + retrieve）发给了模型 —— 工具被**发起**了，不是躺在源码里',
    JSON.stringify({ requests: state.requests.length, tools: state.toolsSeen }));
  ok(state.toolResults.length >= 1 && state.toolResults[0].length > 0,
    '5-2 宿主真的执行了工具并把结果回给模型（后续请求里出现 role=tool 的消息，内容来自真记忆服务）',
    JSON.stringify({ toolMsgs: state.toolResults.length, sample: String(state.toolResults[0] || '').slice(0, 60) }));
  const metrics = JSON.parse(await c.evaluate(`(async function(){ var m = await window.warmy.metricsSummary(); return JSON.stringify(m || null); })()`));
  ok(metrics && Number(metrics.toolCalls) >= 1,
    '5-3 应用自己的 metrics 记下了工具调用（工具**完成**了：有 toolCalls，且宿主给了结论）',
    JSON.stringify({ toolCalls: metrics && metrics.toolCalls, toolCallsOk: metrics && metrics.toolCallsOk, toolTurns: metrics && metrics.toolTurns }));

  /* ── 6. 控制台（T194 那套真事件流）：原始 IPC + 页面 DOM 两处都要看得见 ── */
  await c.evaluate(`(function(){ var b = document.querySelector('#btn-console'); if (b) b.click(); return true; })()`);
  await c.waitFor(`!document.querySelector('#console-pane').classList.contains('hidden')`, { timeout: 10000, label: '控制台展开' });
  const consoleText = String(await c.evaluate(`(function(){ return (document.querySelector('#console-out')||{}).textContent || ''; })()`) || '');
  const raw = JSON.parse(await c.evaluate(`JSON.stringify(window.__toolE2E.events)`));
  const toolRaw = raw.filter((e) => e && e.cat === 'tool');
  const startLine = ZH['console.tool.start'].replace('{tool}', 'recall').replace('{round}', '1');
  // 结束行的期望值从语言包模板反解（不写死："字符/毫秒"两个数是实测值，只约束形状）
  const finishRe = new RegExp(
    '\\[' + ZH['console.cat.tool'] + '\\] ' +
    ZH['console.tool.finish']
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace('\\{tool\\}', 'recall')
      .replace('\\{result\\}', '(?:' + ZH['console.result.ok'] + '|' + ZH['console.result.fail'] + ')')
      .replace('\\{chars\\}', '\\d+')
      .replace('\\{ms\\}', '\\d+')
  );
  ok(toolRaw.some((e) => e.code === 'tool.start') && toolRaw.some((e) => e.code === 'tool.finish'),
    '6-1 原始 IPC 事件流里有 tool.start 与 tool.finish（cat=tool，主进程推的不是渲染层编的）',
    JSON.stringify(toolRaw.slice(0, 3).map((e) => ({ code: e.code, data: e.data }))));
  ok(toolRaw.some((e) => e.code === 'tool.start' && e.data && e.data.tool === 'recall'),
    '6-2 tool.start 事件里带着真实工具名与轮次（recall / round=1）',
    JSON.stringify(toolRaw.filter((e) => e.code === 'tool.start').map((e) => e.data).slice(0, 2)));
  const finishEvents = toolRaw.filter((e) => e.code === 'tool.finish');
  ok(finishEvents.length >= 1 && finishEvents.every((e) => e.data && e.data.tool === 'recall' && typeof e.data.chars === 'number' && typeof e.data.ms === 'number'),
    '6-3 tool.finish 带着结论与度量（ok / chars / ms）—— 工具是**完成**的，不是只开了个头',
    JSON.stringify(finishEvents.map((e) => e.data).slice(0, 2)));
  ok(consoleText.indexOf('[' + ZH['console.cat.tool'] + '] ' + startLine) >= 0,
    '6-4 **控制台面板**（#console-out）里显示了工具开始那一行（来自语言包的原话）',
    JSON.stringify(consoleText.split('\n').filter((l) => l.indexOf(ZH['console.cat.tool']) >= 0).slice(0, 2)));
  ok(finishRe.test(consoleText) && consoleText.indexOf(ZH['console.result.ok']) >= 0,
    '6-5 控制台面板里显示了工具结束那一行（含结论/字符数/耗时，且结论是"成功"）',
    JSON.stringify(consoleText.split('\n').filter((l) => l.indexOf('调用结束') >= 0).slice(0, 2)));
  ok(consoleText.indexOf(STUB_KEY) < 0,
    '6-6 控制台里**没有**出现那把（桩）密钥 —— 打码规则真的生效（界面上永不显示密钥）',
    'keyLen=' + STUB_KEY.length + ' sha16=' + sha16(STUB_KEY));
  const shot = await c.snap(path.join(OUT, 'console-tool-call.png'));
  if (!shot.ok) warn('截图失败（不影响判定）: ' + shot.reason);
  fs.writeFileSync(path.join(OUT, 'console-out.txt'), consoleText, 'utf8');
  fs.writeFileSync(path.join(OUT, 'raw-console-events.json'), JSON.stringify(raw, null, 1), 'utf8');
  console.log('\n--- #console-out（真应用控制台里的原始文本，工具相关行） ---');
  console.log(
    consoleText
      .split('\n')
      .filter((l) => /工具|tool/.test(l))
      .slice(-6)
      .join('\n')
  );
  console.log('--- 原始 IPC 事件（cat=tool）---');
  console.log(JSON.stringify(toolRaw.slice(-4), null, 1));
  console.log('--- 桩模型收到的请求概览 ---');
  console.log(JSON.stringify(state.requests.map((r) => ({ hasTools: r.hasTools, tools: r.toolNames, toolMsgs: r.toolMsgs.length })), null, 1));

  const errs = c.errors().filter((e) => !/Electron Security Warning/i.test(e));
  ok(errs.length === 0, '6-7 全过程没有控制台异常/未捕获错误', JSON.stringify(errs.slice(0, 3)).slice(0, 200));

  pass = R.summary('真应用 tool-call 端到端（桩模型）');
  fs.writeFileSync(path.join(OUT, 'tool-e2e-result.json'), JSON.stringify({ pass, results: R.results }, null, 1), 'utf8');
} catch (e) {
  ok(false, '卡住', String(e && e.message).slice(0, 300));
  console.error('app logs tail: ' + appLogs.join('').slice(-800));
  pass = R.summary('真应用 tool-call 端到端（桩模型）');
} finally {
  try { if (c) c.close(); } catch { /* noop */ }
  killApp();
  try { server.close(); } catch { /* noop */ }
}
console.log('产物目录: ' + OUT);
process.exit(pass ? 0 : 2);
