/**
 * 第 16 轮真机验证：**任务能不能真做完**（不做任何模拟）。
 *
 * 每轮都真实跑这些（产品主点名要的）：
 *   ① 真实 AI 回复（不是空转）
 *   ② 真实用工具（write_file 落盘 + 自检）
 *   ③ **授权后写桌面**（这一支设成完全授权 ⇒ 验的是"越权路径真的写到了系统桌面"；
 *      授权卡的申请/同意/记账由 verify-r44-ui、verify-round24-changes、verify-round34-live 分别覆盖）
 *   ④ **查看压缩包**（工作区放一个真 zip，让模型 list_archive）
 *   ⑤ **写 5000 字以上**内容并落盘（验字数）
 *   ⑥ **一次对话 10 个以上计划任务**（plan_update 列 10+ 步）
 *   ⑦ 身份不漂移
 *
 * 用法： MIMO_KEY=<key> node verify-round16.mjs --round N
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';

const ROOT = process.cwd();
const PKG = path.join(ROOT, 'packages', 'app-shell');
const ROUND = (() => { const i = process.argv.indexOf('--round'); return i >= 0 ? String(process.argv[i + 1] || '1') : '1'; })();
const PORT = 9522 + (Number(ROUND) || 1);
/**
 * **隔离的 userData**（第 48 轮）：以前这里直接用 `%APPDATA%\@warmy\app-shell`（注释说 `--user-data-dir` 无效 —— 那是早期主进程写死路径时的事，
 * 现在其它真机门禁都靠 `--user-data-dir` 隔离且已验证生效）。用真实目录的代价是**每跑一遍 live 档就把用户真实配置整个删掉重建**
 * （round18 系列与 round19 开头就是 `rmSync(DATA)`：首启备份、本机语音模型、身份与密钥仓一起没了）。现在每次一个临时目录（系统临时目录下，名字带时间戳），不再碰用户真实配置。
 */
const DATA = path.join(os.tmpdir(), 'warmy-round16-' + Date.now());
fs.mkdirSync(DATA, { recursive: true });
const OLLAMA_MODEL_XU = String(process.env.OLLAMA_MODEL || '').trim();
/**
 * 选一只**真能写长文**的本机模型（`OLLAMA_MODEL` 可覆盖）。
 * 为什么不能写死 4B：这一支要验"一次对话写 5200 字并落盘"，4B 模型在本机上写不满 5200 字是常态，
 * 于是每遍都红 —— 红的是仪器选型，不是产品。判据是**体积 + 名字**（嵌入/语音模型不算对话模型），
 * 选不到就退回原来那只，并在读数里如实写出用的是谁。
 */
async function xuanMoXing() {
  if (OLLAMA_MODEL_XU) return OLLAMA_MODEL_XU;
  try {
    const r = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(6000) });
    const lie = ((await r.json()).models) || [];
    const keXuan = lie
      .map((m) => ({ n: String(m.name || ''), gb: Number(m.size || 0) / 1e9 }))
      .filter((x) => x.n && x.gb >= 6 && !/whisper|bge|embed|tts|asr/i.test(x.n));
    if (keXuan.length) return keXuan.sort((a, b) => b.gb - a.gb)[0].n;
  } catch { /* Ollama 没起 ⇒ 退回默认，后面自然会红并给出原因 */ }
  return 'huihui_ai/qwen3-vl-abliterated:4b';
}
const OLLAMA_MODEL = await xuanMoXing();
console.log(`· 本机模型 = ${OLLAMA_MODEL}${OLLAMA_MODEL_XU ? '（由 OLLAMA_MODEL 指定）' : '（按体积自动选，可用 OLLAMA_MODEL 覆盖）'}`);
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
  /**
   * ③ 要验的是"**写桌面文件真的落盘**"（路径解析 + 真写盘），不是授权卡本身 ——
   * 卡片的申请/同意/记账由 `verify-r44-ui`（授权卡渲染与按钮）、`verify-round24-changes`
   * （`auth.grant-once` 接线）与 `verify-round34-live`（审计里真有 grant-once）分别覆盖。
   * 这一支没有人能点「同意」⇒ 设成完全授权，否则每遍都卡在"没人批"上，红得没有信息量。
   */
  s.globalSecurity = 'full'; s.askOnExceed = false;
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
  [`--remote-debugging-port=${PORT}`, `--user-data-dir=${DATA}`, path.join(PKG, 'dist', 'electron-main.js')],
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
  const r = await ev(`window.warmy.chatSend({ sessionId:${JSON.stringify(SID)}, role:'user', content:'请调用 write_file 写入 ${FN}，内容写一篇**不少于 5200 字**的短篇小说（题目自拟）。写完在回复里告诉我绝对路径和字数。', model:${JSON.stringify(OLLAMA_MODEL)}, ming:'牛马-1' }).then(r=>({ok:r&&r.ok,reply:String((r&&r.reply)||'')}))`, 1_500_000).catch((e) => { console.log(`  · 长文那一轮没拿到回复：${String((e && e.message) || e).slice(0, 120)}`); return null; });
  if (r && r.ok === false) console.log(`  · 长文那一轮产品侧报错：${String(r.reply || '').slice(0, 200)}`);
  let found = '';
  for (let i = 0; i < 120 && !found; i++) {
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
  const r = await ev(`window.warmy.chatSend({ sessionId:${JSON.stringify(SID)}, role:'user', content:'请调用 write_file 把「第${ROUND}轮授权测试」写进 Desktop/${FN}。', model:${JSON.stringify(OLLAMA_MODEL)}, ming:'牛马-1' }).then(r=>({ok:r&&r.ok,reply:String((r&&r.reply)||'')}))`, 900_000).catch(() => null);
  /**
   * 桌面在哪：**先问系统的已知文件夹**（与产品 `app.getPath('desktop')` 同一来源 ——
   * 桌面被重定向到别的盘时，`%USERPROFILE%\Desktop` 根本不是桌面，第 47 轮就是这么误判"未找到"的），
   * 再兜底老位置（含 OneDrive 重定向）。找不到时把**产品自己说的原因**打出来（回复原文 + 审计），
   * 否则读数只有一句"未找到"，查不出是模型没写、被拦了、还是写到了别处。
   */
  let yiZhiZhuoMian = '';
  try {
    yiZhiZhuoMian = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "[Console]::OutputEncoding=[Text.Encoding]::UTF8; [Environment]::GetFolderPath('Desktop')"], { encoding: 'utf8', timeout: 30000 }).trim();
  } catch { yiZhiZhuoMian = ''; }
  const houXuan = [
    ...(yiZhiZhuoMian ? [path.join(yiZhiZhuoMian, FN)] : []),
    path.join(process.env.USERPROFILE || '', 'Desktop', FN),
    path.join(process.env.USERPROFILE || '', 'OneDrive', 'Desktop', FN),
    path.join(process.env.OneDrive || '', 'Desktop', FN),
  ].filter((p) => p.length > 10);
  const desk = houXuan.find((p) => fs.existsSync(p)) || houXuan[0];
  const zai = fs.existsSync(desk);
  if (!zai) {
    try {
      const shen = fs.readFileSync(path.join(DATA, 'audit', 'audit.jsonl'), 'utf8').split('\n').filter(Boolean).slice(-40)
        .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
        .filter((j) => /stop-send|false-claim|artifact|grant-once|tools\.trim|budget/i.test(String(j.op || '')))
        .slice(-4).map((j) => `${j.op} ${JSON.stringify(j.detail || {}).slice(0, 140)}`);
      if (shen.length) console.log('  · 审计尾巴（查因用）：\n      ' + shen.join('\n      '));
    } catch { /* 审计读不到就算了 */ }
  }
  say(zai, `③ 授权写桌面：${desk} ${zai ? '存在' : '未找到'}（回复=${JSON.stringify(String(r?.reply || '').slice(0, 120))}）`);
  /** 门禁自己让模型写到**用户真实桌面**的文件，验完就删（只删这个唯一文件名，不碰桌面上别的东西） */
  for (const p of houXuan) { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch { /* 删不掉就留着，下面的汇报里会看到 */ } }
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
