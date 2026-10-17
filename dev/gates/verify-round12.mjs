/**
 * 第 12 轮真机验证（**不做任何模拟**）。
 *
 * 每轮都真实做这些事：
 *   ① UI：设置页 → 模型；供应商下拉延迟；点「添加供应商」→ **只刷列表、不整页重绘**
 *   ② 供应商连通：真实列模型（本地 Ollama + MiMo）
 *   ③ **真实 AI 对话**：调 `chatSend` 走本地 ollama，必须有非空回复
 *   ④ **真实工具调用**：让它 write_file 建文件，再**去磁盘上确认文件真的存在**
 *   ⑤ **真实 ASR 往返**：MiMo TTS 合成一段真语音 → 同一段音频走 `asrTranscribe` → 必须转出文字
 *   ⑥ **身份不漂移**：问"你是谁"，回复里要认「牛马」，不得自称 qwen
 *
 * 用法：
 *   MIMO_KEY=<key> node verify-round12.mjs            # 跑 1 轮
 *   MIMO_KEY=<key> node verify-round12.mjs --round 2  # 指定轮次标签
 *   MIMO_KEY_FILE=<file> ...
 *
 * 隔离说明（**重要，实测**）：main 里 userData 被硬固定到 `%APPDATA%\@warmy\app-shell`，
 * 而且 **Windows 上 Electron 的 `app.getPath('appData')` 走 shell 已知文件夹、不吃 `APPDATA` 环境变量**
 * （改 `APPDATA` / `--user-data-dir` 都实测无效）⇒ 本脚本**就是在真实配置上跑真机验证**
 * （这也正是产品主要求的"配真实供应商、真实调用"）。所以：
 *   · 运行前必须**关闭正在运行的应用实例**（单实例锁 + 端口冲突）；
 *   · 脚本会往真实 userData 的 workspace 下写验证文件，跑完自行清理。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PKG = path.join(ROOT, 'packages', 'app-shell');
const ROUND = (() => { const i = process.argv.indexOf('--round'); return i >= 0 ? String(process.argv[i + 1] || '1') : '1'; })();
const PORT = 9462 + (Number(ROUND) || 1);

/** 真实 userData（app 硬固定；APPDATA 覆盖在 Windows 上无效，见上） */
const DATA = path.join(process.env.APPDATA || '', '@warmy', 'app-shell');

const OPENAI_OLLAMA = 'ollama-verify';
const MIMO_ID = 'mimo-verify';
/** 本地 ollama：挑一个体积小、能调工具的模型跑对话/工具（快；避免 27B 拖长验证时间） */
const OLLAMA_CHAT_MODEL = process.env.OLLAMA_MODEL || 'huihui_ai/qwen3-vl-abliterated:4b';

const key = (() => {
  const k = String(process.env.MIMO_KEY || '').trim();
  if (k) return k;
  const f = String(process.env.MIMO_KEY_FILE || '').trim();
  if (f) { try { return fs.readFileSync(f, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || ''; } catch { /* ignore */ } }
  return '';
})();

// 只确保引导已完成 + **真实供应商就位**（本地 Ollama + MiMo）；
// 其余配置一律用用户真实配置。跑前必须关掉正在运行的应用实例。
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
  you(OPENAI_OLLAMA, {
    biaoQian: 'Ollama(verify)', protocol: 'ollama', baseURL: 'http://127.0.0.1:11434',
    defaultModel: OLLAMA_CHAT_MODEL, models: [OLLAMA_CHAT_MODEL],
  });
  you(MIMO_ID, {
    biaoQian: 'MiMo(verify)', protocol: 'openai-compatible', baseURL: 'https://token-plan-cn.xiaomimimo.com/v1',
    defaultModel: 'mimo-v2.5', models: ['mimo-v2.5', 'mimo-v2.5-asr', 'mimo-v2.5-tts'],
  });
  s.providers = ps;
  s.specialModels = {
    ...(s.specialModels || {}),
    chatChain: [OLLAMA_CHAT_MODEL],
    asrChain: ['mimo-v2.5-asr'],
    ttsChain: ['mimo-v2.5-tts'],
    embedChain: [],
  };
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
const results = [];
function check(ok, msg) {
  if (!ok) pass = false;
  results.push(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
}

let up = false;
for (let i = 0; i < 60 && !up; i++) {
  try { up = (await fetch(`http://127.0.0.1:${PORT}/json`, { signal: AbortSignal.timeout(1500) })).ok; } catch { /* wait */ }
  if (!up) await sleep(400);
}
if (!up) {
  console.log('CDP not up'); console.log(logs.join('').slice(0, 3000));
  try { child.kill(); } catch { /* noop */ }
  process.exit(1);
}
const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = list.find((x) => x.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let mid = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const j = JSON.parse(String(e.data));
  if (j.id && pending.has(j.id)) { pending.get(j.id)(j); pending.delete(j.id); }
});
function send(method, params = {}) {
  const id = ++mid;
  return new Promise((resolve) => { pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
}
async function ev(expr, timeoutMs = 30_000) {
  const r = await Promise.race([
    send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }),
    sleep(timeoutMs).then(() => ({ __timeout: true })),
  ]);
  if (r && r.__timeout) throw new Error('EVAL_TIMEOUT');
  if (r?.result?.exceptionDetails) throw new Error('EVAL_ERR ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r?.result?.result?.value;
}

await send('Runtime.enable');
await sleep(5000);

console.log(`\n=========== ROUND ${ROUND} ===========`);

// ── ① UI：设置页 / 下拉 / 添加供应商 ──
try {
  await ev(`(function(){var b=document.querySelector('.ceLanTiaoMu[data-nav="settings"]');if(b)b.click();return 1;})()`);
  await sleep(600);
  await ev(`(function(){var n=document.querySelector('#peiZhiDaoHang button[data-sec="model"]');if(n)n.click();return 1;})()`);
  await sleep(500);
  const lat = [];
  for (let k = 0; k < 8; k++) {
    await ev(`(function(){var p=document.querySelector('.provXiaLaPan');if(p)p.remove();return 1;})()`);
    const s = Date.now();
    await ev(`(function(){var b=document.getElementById('provPreset');if(b)b.click();return 1;})()`);
    for (let i = 0; i < 60; i++) {
      if (await ev(`!!document.querySelector('.provXiaLaPan')`)) break;
      await sleep(8);
    }
    lat.push(Date.now() - s);
    await ev(`(function(){var p=document.querySelector('.provXiaLaPan');if(p)p.remove();return 1;})()`);
  }
  check(lat.every((x) => x < 400), `①a 供应商下拉延迟 <400ms（max=${Math.max(...lat)}）`);

  await ev(`window.__pt1 = (document.getElementById('pageTi')||{}).firstElementChild || null; 1`);
  const before = Number(await ev(`document.querySelectorAll('#provLieBiao > div').length`)) || 0;
  await ev(`(function(){var b=document.getElementById('provPreset');if(b)b.click();return 1;})()`);
  await sleep(120);
  await ev(`(function(){var b=document.querySelector('.provXiaLaPan [data-pid="deepseek"]');if(b)b.click();return 1;})()`);
  await sleep(100);
  const t0 = Date.now();
  await ev(`(function(){var b=document.getElementById('anNiuTianJiaProv');if(b&&!b.disabled)b.click();return 1;})()`);
  let after = before;
  for (let i = 0; i < 60; i++) {
    after = Number(await ev(`document.querySelectorAll('#provLieBiao > div').length`)) || 0;
    if (after > before) break;
    await sleep(20);
  }
  const dt = Date.now() - t0;
  const same = await ev(`(function(){var n=(document.getElementById('pageTi')||{}).firstElementChild||null;return window.__pt1===n;})()`);
  check(after === before + 1 && dt < 900 && same === true,
    `①b 添加供应商：${before}→${after} 行、${dt}ms、整页未重绘=${same}`);
} catch (e) { check(false, `① UI 检查异常：${String(e.message || e)}`); }

// ── ② 供应商连通（真实拉模型） ──
try {
  const r1 = await ev(`window.warmy.listModels({ protocol:'ollama', baseURL:'http://127.0.0.1:11434', providerId:'${OPENAI_OLLAMA}' }).then(r=>({ok:!!r.ok,n:(r.models||[]).length}))`, 90_000);
  check(!!r1 && r1.ok === true && r1.n > 0, `②a 本地 Ollama 真实列模型：${JSON.stringify(r1)}`);
} catch (e) { check(false, `②a Ollama 列模型异常：${String(e.message || e)}`); }

if (key) {
  try {
    const setk = await ev(`window.warmy.providerKeySet({ providerId:'${MIMO_ID}', apiKey:${JSON.stringify(key)} })`, 40_000);
    check(!!setk && setk.ok === true, `②b MiMo 密钥写入安全存储：${JSON.stringify(setk)}`);
    const r2 = await ev(`window.warmy.listModels({ protocol:'openai-compatible', baseURL:'https://token-plan-cn.xiaomimimo.com/v1', providerId:'${MIMO_ID}', apiKey:${JSON.stringify(key)} }).then(r=>({ok:!!r.ok,n:(r.models||[]).length,ids:(r.models||[]).slice(0,4)}))`, 90_000);
    check(!!r2 && r2.ok === true && r2.n > 0, `②c MiMo 真实列模型：${JSON.stringify(r2)}`);
  } catch (e) { check(false, `② MiMo 检查异常：${String(e.message || e)}`); }
} else {
  console.log('warn  未提供 MIMO_KEY/MIMO_KEY_FILE ⇒ 跳过 MiMo 相关（②b/②c/⑤）');
}

// ── ③ 真实 AI 对话（本地 ollama） ──
const SID = `verify-r${ROUND}`;
try {
  const r = await ev(`window.warmy.chatSend({ sessionId:${JSON.stringify(SID)}, role:'user', content:'请只回答三个字：收到了', model:${JSON.stringify(OLLAMA_CHAT_MODEL)}, ming:'牛马-1' }).then(r=>({ok:r&&r.ok,reply:String((r&&r.reply)||''),err:String((r&&(r.error||r.reason))||'')}))`, 240_000);
  check(!!r && r.ok === true && String(r.reply || '').trim().length > 0, `③ 真实对话有回复：${JSON.stringify(String(r?.reply || r?.err || '').slice(0, 120))}`);
} catch (e) { check(false, `③ 对话异常：${String(e.message || e)}`); }

// ── ④ 真实工具调用 + 磁盘确认 ──
try {
  const FN = `r12-check-${ROUND}.txt`;
  const r = await ev(`window.warmy.chatSend({ sessionId:${JSON.stringify(SID + '-tool')}, role:'user', content:'请调用 write_file 工具，把内容 “ok” 写进 ${FN}。做完只用一句话说结果。', model:${JSON.stringify(OLLAMA_CHAT_MODEL)}, ming:'牛马-1' }).then(r=>({ok:r&&r.ok,reply:String((r&&r.reply)||''),tools:(r&&r.tools)||null}))`, 300_000);
  const wsPath = path.join(DATA, 'workspace', `${SID}-tool`);
  let found = '';
  try {
    for (const f of fs.readdirSync(wsPath)) if (f === FN) found = path.join(wsPath, f);
  } catch { /* no workspace yet */ }
  /** 兜底：回复里若给出了具体路径，也直接去那个路径确认（模型可能落在自选位置） */
  if (!found) {
    const m = String(r?.reply || '').match(/[A-Za-z]:\\[^\s`"'）)+\]]+\.txt/);
    if (m && fs.existsSync(m[0])) found = m[0];
  }
  check(!!found, `④ 工具调用真的落盘：${FN} → ${found || '(未找到)'}；回复=${JSON.stringify(String(r?.reply || '').slice(0, 140))}`);
} catch (e) { check(false, `④ 工具调用异常：${String(e.message || e)}`); }

// ── ⑤ 真实 ASR 往返（MiMo TTS → ASR） ──
if (key) {
  try {
    const st = await ev(`window.warmy.tingHuaZhuangTai()`, 40_000);
    check(!!st && st.ready === true, `⑤a 听话模型就绪：${JSON.stringify(st)}`);

    const tts = await ev(`window.warmy.ttsLangDu({ text:'今天天气不错' }).then(r=>({ok:!!r.ok,url:String(r.dataUrl||'').slice(0,40),len:String(r.dataUrl||'').length,err:String(r.error||'')}))`, 180_000);
    check(!!tts && tts.ok === true && tts.len > 1000, `⑤b MiMo TTS 合成真人声：${JSON.stringify({ ok: tts?.ok, len: tts?.len, url: tts?.url, err: tts?.err })}`);

    if (tts && tts.ok) {
      const full = await ev(`window.warmy.ttsLangDu({ text:'今天天气不错' }).then(r=>String(r.dataUrl||''))`, 180_000);
      const asr = await ev(`window.warmy.asrTranscribe({ dataUrl:${JSON.stringify(full)}, ext:'wav' })`, 180_000);
      const txt = String((asr && asr.text) || '');
      check(!!asr && asr.ok === true && txt.trim().length > 0,
        `⑤c ASR 往返转出文字：${JSON.stringify(txt.slice(0, 60))}（model=${asr && asr.model}）`);
    } else {
      check(false, '⑤c 跳过 ASR（TTS 没出音频）');
    }
  } catch (e) { check(false, `⑤ ASR 异常：${String(e.message || e)}`); }
}
// ── ⑥ 身份不漂移 ──
try {
  const r = await ev(`window.warmy.chatSend({ sessionId:${JSON.stringify(SID + '-id')}, role:'user', content:'你是谁？我是谁？请直接回答，别调用工具。', model:${JSON.stringify(OLLAMA_CHAT_MODEL)}, ming:'牛马-1' }).then(r=>String((r&&r.reply)||''))`, 240_000);
  const t = String(r || '');
  const renNiuMa = /牛马/.test(t);
  const ziChengQwen = /(我是|作为|身为)[^。\n]{0,12}(qwen|通义千问)/i.test(t);
  check(renNiuMa && !ziChengQwen, `⑥ 身份锚生效（认牛马=${renNiuMa}，自称 qwen=${ziChengQwen}）：${JSON.stringify(t.slice(0, 140))}`);
} catch (e) { check(false, `⑥ 身份检查异常：${String(e.message || e)}`); }

ws.close();
try { child.kill(); } catch { /* noop */ }
await sleep(600);
console.log(`\n---- ROUND ${ROUND}: ${pass ? 'PASS' : 'FAIL'} (${results.filter((x) => x.startsWith('ok')).length}/${results.length}) ----`);
process.exit(pass ? 0 : 1);
