/**
 * 第 16 轮真机验证：**任务能不能真做完**（不做任何模拟）。
 *
 * 每轮都真实跑这些（产品主点名要的）：
 *   ① 真实 AI 回复（不是空转）
 *   ② 真实用工具（write_file 落盘 + 自检）
 *   ③ **授权**（写桌面文件 → 走授权流，看是否真的申请/放行）
 *   ④ **查看压缩包**（工作区放一个真 zip，让模型 list_archive）
 *   ⑤ **写 5000 字以上**内容并落盘（验字数）
 *   ⑥ **一次对话 10 个以上计划任务**（plan_update 列 10+ 步）
 *   ⑦ 身份不漂移
 *
 * 用法： MIMO_KEY=<key> node verify-round16.mjs --round N
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = process.cwd();
const PKG = path.join(ROOT, 'packages', 'app-shell');
const ROUND = (() => { const i = process.argv.indexOf('--round'); return i >= 0 ? String(process.argv[i + 1] || '1') : '1'; })();
const PORT = 9522 + (Number(ROUND) || 1);
const DATA = path.join(process.env.APPDATA || '', '@warmy', 'app-shell');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'huihui_ai/qwen3-vl-abliterated:4b';
const key = (() => {
  const k = String(process.env.MIMO_KEY || '').trim();
  if (k) return k;
  const f = String(process.env.MIMO_KEY_FILE || '').trim();
  if (f) { try { return fs.readFileSync(f, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || ''; } catch { /* ignore */ } }
  return '';
})();

/** 手工造一个 zip（列出用） */
function zaoZip(tiao) {
  const ju = []; const cen = []; let off = 0;
  for (const t of tiao) {
    const ming = Buffer.from(t.name, 'utf8');
    const yuan = Buffer.from(t.data, 'utf8');
    const ya = zlib.deflateRawSync(yuan);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(ya.length, 18); lh.writeUInt32LE(yuan.length, 22);
    lh.writeUInt16LE(ming.length, 26);
    ju.push(lh, ming, ya);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(ya.length, 20); ch.writeUInt32LE(yuan.length, 24);
    ch.writeUInt16LE(ming.length, 28); ch.writeUInt32LE(off, 42);
    cen.push(ch, ming);
    off += lh.length + ming.length + ya.length;
  }
  const cenBuf = Buffer.concat(cen);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(tiao.length, 8); eocd.writeUInt16LE(tiao.length, 10);
  eocd.writeUInt32LE(cenBuf.length, 12); eocd.writeUInt32LE(off, 16);
  return Buffer.concat([...ju, cenBuf, eocd]);
}

// 引导跳过 + 供应商就位
try {
  const sp = path.join(DATA, 'settings.json');
  const s = fs.existsSync(sp) ? JSON.parse(fs.readFileSync(sp, 'utf8')) : {};
  s.setupDone = true; s.guideDone = true; s.privacyConsent = true; s.providersSeeded = true;
  const ps = Array.isArray(s.providers) ? s.providers.slice() : [];
  const you = (id, extra) => {
    const i = ps.findIndex((p) => p && p.id === id);
    const row = { id, staleModels: {}, models: [], hasKey: false, ...extra };
    if (i >= 0) ps[i] = { ...ps[i], ...row, models: (ps[i].models && ps[i].models.length ? ps[i].models : row.models) };
    else ps.push(row);
  };
  you('ollama-r16', { biaoQian: 'Ollama(r16)', protocol: 'ollama', baseURL: 'http://127.0.0.1:11434', defaultModel: OLLAMA_MODEL, models: [OLLAMA_MODEL] });
  you('mimo-r16', { biaoQian: 'MiMo(r16)', protocol: 'openai-compatible', baseURL: 'https://token-plan-cn.xiaomimimo.com/v1', defaultModel: 'mimo-v2.5', models: ['mimo-v2.5', 'mimo-v2.5-asr', 'mimo-v2.5-tts'] });
  s.providers = ps;
  s.specialModels = { ...(s.specialModels || {}), chatChain: [OLLAMA_MODEL], asrChain: ['mimo-v2.5-asr'], ttsChain: ['mimo-v2.5-tts'] };
  fs.writeFileSync(sp, JSON.stringify(s, null, 2));
} catch { /* noop */ }

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(path.join(PKG, 'node_modules', 'electron', 'dist', 'electron.exe'),
  [`--remote-debugging-port=${PORT}`, path.join(PKG, 'dist', 'electron-main.js')],
  { cwd: PKG, stdio: ['ignore', 'pipe', 'pipe'], env });
const logs = [];
child.stdout.on('data', (d) => logs.push(String(d)));
child.stderr.on('data', (d) => logs.push(String(d)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WebSocket = globalThis.WebSocket;
let pass = true;
const say = (ok, msg) => { if (!ok) pass = false; console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); };

let up = false;
for (let i = 0; i < 60 && !up; i++) {
  try { up = (await fetch(`http://127.0.0.1:${PORT}/json`, { signal: AbortSignal.timeout(1500) })).ok; } catch { /* wait */ }
  if (!up) await sleep(400);
}
if (!up) { console.log('CDP not up'); console.log(logs.join('').slice(0, 2000)); try { child.kill(); } catch { /* noop */ } process.exit(1); }

const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = list.find((x) => x.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let mid = 0; const pending = new Map();
ws.addEventListener('message', (e) => {
  const j = JSON.parse(String(e.data));
  if (j.id && pending.has(j.id)) { pending.get(j.id)(j); pending.delete(j.id); }
});
const send = (method, params = {}) => { const id = ++mid; return new Promise((res) => { pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); };
async function ev(expr, timeoutMs = 600_000) {
  const r = await Promise.race([
    send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }),
    sleep(timeoutMs).then(() => ({ __timeout: true })),
  ]);
  if (r && r.__timeout) throw new Error('EVAL_TIMEOUT');
  return r?.result?.result?.value;
}
await send('Runtime.enable');
await sleep(5000);
console.log(`\n=========== ROUND ${ROUND} ===========`);

const SID = `verify-r16-${ROUND}`;
const WS = path.join(DATA, 'workspace', SID);
try { fs.mkdirSync(WS, { recursive: true }); } catch { /* noop */ }
/** 放一个真 zip 进**本次会话自己的**工作区（真机：上一版放错了会话，模型找不到） */
const ZIP = path.join(WS, `r16-${ROUND}.zip`);
fs.writeFileSync(ZIP, zaoZip([
  { name: 'hello.txt', data: '你好，这是压缩包里的文件' },
  { name: 'docs/readme.md', data: '# 说明\n压缩包测试' },
]));

// 预热（本地模型冷启动）
try { await ev(`window.warmy.chatSend({ sessionId:${JSON.stringify(SID + '-warm')}, role:'user', content:'hi', model:${JSON.stringify(OLLAMA_MODEL)}, ming:'牛马-1' }).then(r=>1)`, 300_000); } catch { /* noop */ }

// ── ①+②+⑤ 真实回复 + 工具落盘 + 5000 字 ──
try {
  const FN = `r16-chang-${ROUND}.txt`;
  const r = await ev(`window.warmy.chatSend({ sessionId:${JSON.stringify(SID)}, role:'user', content:'请调用 write_file 写入 ${FN}，内容写一篇**不少于 5200 字**的短篇小说（题目自拟）。写完在回复里告诉我绝对路径和字数。', model:${JSON.stringify(OLLAMA_MODEL)}, ming:'牛马-1' }).then(r=>({ok:r&&r.ok,reply:String((r&&r.reply)||'')}))`, 600_000).catch(() => null);
  let found = '';
  for (let i = 0; i < 30 && !found; i++) {
    try { for (const f of fs.readdirSync(WS)) if (f === FN) found = path.join(WS, f); } catch { /* noop */ }
    if (!found) {
      try { for (const f of fs.readdirSync(path.join(DATA, 'workspace', `${SID}-tool`))) if (f === FN) found = path.join(path.join(DATA, 'workspace', `${SID}-tool`), f); } catch { /* noop */ }
    }
    if (!found) await sleep(500);
  }
  const zi = found ? [...fs.readFileSync(found, 'utf8')].length : 0;
  say(!!found && zi >= 5000, `①②⑤ 写 5000+ 字并落盘：${found || '(未找到)'}（${zi} 字符）`);
} catch (e) { say(false, `①②⑤ 长文异常：${String(e.message || e)}`); }

// ── ③ 授权：写桌面文件 ──
try {
  const FN = `r16-zhuo-${ROUND}.txt`;
  const r = await ev(`window.warmy.chatSend({ sessionId:${JSON.stringify(SID)}, role:'user', content:'请调用 write_file 把「第${ROUND}轮授权测试」写进 Desktop/${FN}。', model:${JSON.stringify(OLLAMA_MODEL)}, ming:'牛马-1' }).then(r=>({ok:r&&r.ok,reply:String((r&&r.reply)||'')}))`, 600_000).catch(() => null);
  const desk = path.join(process.env.USERPROFILE || '', 'Desktop', FN);
  const zai = fs.existsSync(desk);
  say(zai, `③ 授权写桌面：${desk} ${zai ? '存在' : '未找到'}（回复=${JSON.stringify(String(r?.reply || '').slice(0, 60))}）`);
} catch (e) { say(false, `③ 授权异常：${String(e.message || e)}`); }

// ── ④ 查看压缩包 ──
try {
  const r = await ev(`window.warmy.chatSend({ sessionId:${JSON.stringify(SID)}, role:'user', content:'请用 list_archive 查看 r16-${ROUND}.zip 里有什么文件，把条目名列出来。', model:${JSON.stringify(OLLAMA_MODEL)}, ming:'牛马-1' }).then(r=>String((r&&r.reply)||''))`, 600_000).catch(() => '');
  const t = String(r || '');
  const dui = /hello\.txt/i.test(t) && /readme/i.test(t);
  say(!!dui, `④ 查看压缩包列条目：${dui}（回复=${JSON.stringify(t.slice(0, 100))}）`);
} catch (e) { say(false, `④ 压缩包异常：${String(e.message || e)}`); }

// ── ⑥ 一次对话 10+ 计划任务 ──
try {
  const r = await ev(`window.warmy.chatSend({ sessionId:${JSON.stringify(SID)}, role:'user', content:'请用 plan_update 列一个包含 **12 个步骤** 的计划（id 用 T1..T12），主题是"整理一份旅行攻略"。只列计划，先不要执行。', model:${JSON.stringify(OLLAMA_MODEL)}, ming:'牛马-1' }).then(r=>String((r&&r.reply)||''))`, 600_000).catch(() => '');
  // 从审计/计划里数步骤数
  const n = await ev(`(async()=>{ try { const p = await (window.warmy.jiHuaChaXun?.() || null); return p ? (p.steps||[]).length : -1; } catch(e){ return -2; } })()`, 20_000).catch(() => -3);
  const tui = Number(n) >= 10 || /T1[0-2]|T10|T11|T12/.test(String(r || ''));
  say(!!tui, `⑥ 10+ 计划任务：步骤数=${n}，回复含 T10+ =${/T1[0-2]/.test(String(r || ''))}`);
} catch (e) { say(false, `⑥ 计划异常：${String(e.message || e)}`); }

// ── ⑦ 身份 ──
try {
  const t = String(await ev(`window.warmy.chatSend({ sessionId:${JSON.stringify(SID)}, role:'user', content:'你是谁？别调工具，直接一句话回答。', model:${JSON.stringify(OLLAMA_MODEL)}, ming:'牛马-1' }).then(r=>String((r&&r.reply)||''))`, 300_000).catch(() => ''));
  say(/牛马/.test(t) && !/(我是|作为)[^。\n]{0,12}qwen/i.test(t), `⑦ 身份：${JSON.stringify(t.slice(0, 80))}`);
} catch (e) { say(false, `⑦ 身份异常：${String(e.message || e)}`); }

ws.close();
try { child.kill(); } catch { /* noop */ }
await sleep(500);
console.log(`\n---- ROUND ${ROUND}: ${pass ? 'PASS' : 'FAIL'} ----`);
process.exit(pass ? 0 : 1);
