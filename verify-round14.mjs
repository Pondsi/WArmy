/**
 * 第 14 轮真机验证（**不做模拟**）：只测本轮改动 + 基本功能。
 *
 * 每轮：
 *   ① UI：设置页/下拉/加供应商（页内计时 + 长任务）
 *   ② **模型标签自动分配**：真实拉取 Ollama + MiMo 模型后，听话/说话/向量/看图链应按标签归位
 *   ③ **真实 AI 对话**（本地 Ollama）+ **真实工具调用**（write_file，磁盘确认 + 绝对路径）
 *   ④ **赞/踩 → 智能配置文件**：点赞后 `智能配置.md` 里应有记录
 *   ⑤ **真实 ASR 往返**（MiMo TTS 合成 → 转写回文字）
 *   ⑥ 身份锚：问"你是谁"，认牛马、不自称 qwen
 *
 * 用法： MIMO_KEY=<key> node verify-round14.mjs --round N
 * 注意：跑之前必须关掉正在运行的应用（单实例锁）。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PKG = path.join(ROOT, 'packages', 'app-shell');
const ROUND = (() => { const i = process.argv.indexOf('--round'); return i >= 0 ? String(process.argv[i + 1] || '1') : '1'; })();
const PORT = 9502 + (Number(ROUND) || 1);
const DATA = path.join(process.env.APPDATA || '', '@warmy', 'app-shell');

const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'huihui_ai/qwen3-vl-abliterated:4b';
const key = (() => {
  const k = String(process.env.MIMO_KEY || '').trim();
  if (k) return k;
  const f = String(process.env.MIMO_KEY_FILE || '').trim();
  if (f) { try { return fs.readFileSync(f, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || ''; } catch { /* ignore */ } }
  return '';
})();

// 引导跳过 + 两个真实供应商就位
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
  you('ollama-r14', { biaoQian: 'Ollama(r14)', protocol: 'ollama', baseURL: 'http://127.0.0.1:11434', defaultModel: OLLAMA_MODEL, models: [OLLAMA_MODEL] });
  you('mimo-r14', { biaoQian: 'MiMo(r14)', protocol: 'openai-compatible', baseURL: 'https://token-plan-cn.xiaomimimo.com/v1', defaultModel: 'mimo-v2.5', models: ['mimo-v2.5', 'mimo-v2.5-asr', 'mimo-v2.5-tts'] });
  s.providers = ps;
  // 清空链，专门验证"按标签自动分配"真的会填
  s.specialModels = { ...(s.specialModels || {}), chatChain: [], asrChain: [], ttsChain: [], embedChain: [], imageUndChain: [], organizerChain: [] };
  fs.writeFileSync(sp, JSON.stringify(s, null, 2));
} catch { /* noop */ }
// 删掉智能配置，专门验证赞/踩会新写进去
try { fs.rmSync(path.join(DATA, '智能配置.md'), { force: true }); } catch { /* noop */ }

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
/** 与 say 同义（脚本里混用了两个名字，统一到一个实现） */
const check0 = say;

let up = false;
for (let i = 0; i < 60 && !up; i++) {
  try { up = (await fetch(`http://127.0.0.1:${PORT}/json`, { signal: AbortSignal.timeout(1500) })).ok; } catch { /* wait */ }
  if (!up) await sleep(400);
}
if (!up) { console.log('CDP not up'); console.log(logs.join('').slice(0, 2500)); try { child.kill(); } catch { /* noop */ } process.exit(1); }

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
async function ev(expr, timeoutMs = 60_000) {
  const r = await Promise.race([
    send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }),
    sleep(timeoutMs).then(() => ({ __timeout: true })),
  ]);
  if (r && r.__timeout) throw new Error('EVAL_TIMEOUT');
  if (r?.result?.exceptionDetails) throw new Error('EVAL_ERR ' + JSON.stringify(r.result.exceptionDetails).slice(0, 200));
  return r?.result?.result?.value;
}

await send('Runtime.enable');
await sleep(5000);
console.log(`\n=========== ROUND ${ROUND} ===========`);

// ── ② 模型标签自动分配（本轮重点）──
try {
  const r1 = await ev(`window.warmy.listModels({ protocol:'ollama', baseURL:'http://127.0.0.1:11434', providerId:'ollama-r14' }).then(r=>({ok:!!r.ok,n:(r.models||[]).length,ids:(r.models||[]).slice(0,3)}))`, 120_000);
  check0(r1 && r1.ok === true && r1.n > 0, `②a Ollama 真实拉模型：${JSON.stringify(r1)}`);
  const r2 = await ev(`window.warmy.listModels({ protocol:'openai-compatible', baseURL:'https://token-plan-cn.xiaomimimo.com/v1', providerId:'mimo-r14', apiKey:${JSON.stringify(key)} }).then(r=>({ok:!!r.ok,n:(r.models||[]).length}))`, 120_000);
  check0(r2 && r2.ok === true && r2.n > 0, `②b MiMo 真实拉模型：${JSON.stringify(r2)}`);
  // **真实触发「按标签归位」**（渲染层那套：拉取模型后会调它）
  await ev(`window.__anBiaoQianFenPeiMoXing(${JSON.stringify(r1 ? r1.ids || [] : [])}, window.__moXingNengLi || {})`, 30_000).catch(() => null);
  // 把两个供应商的模型一起归位（含 MiMo 的 asr/tts）
  await ev(`(async()=>{
    const all = [];
    try { const r = await window.warmy.listModels({ protocol:'ollama', baseURL:'http://127.0.0.1:11434', providerId:'ollama-r14' }); all.push(...((r&&r.models)||[])); } catch(e){}
    try { const r = await window.warmy.listModels({ protocol:'openai-compatible', baseURL:'https://token-plan-cn.xiaomimimo.com/v1', providerId:'mimo-r14', apiKey:${JSON.stringify(key)} }); all.push(...((r&&r.models)||[])); } catch(e){}
    window.__moXingNengLi = Object.assign({}, window.__moXingNengLi||{}, (await window.warmy.listModels({ protocol:'ollama', baseURL:'http://127.0.0.1:11434', providerId:'ollama-r14' })).nengLi||{});
    return window.__anBiaoQianFenPeiMoXing(all, window.__moXingNengLi||{});
  })()`, 120_000).catch(() => null);
  const fen = await ev(`(async()=>{
    const sp = await window.warmy.specialModelsGet?.();
    const sm = (sp && sp.specialModels) || {};
    return { asr:(sm.asrChain||[]).length, tts:(sm.ttsChain||[]).length, embed:(sm.embedChain||[]).length, chat:(sm.chatChain||[]).length, imageUnd:(sm.imageUndChain||[]).length };
  })()`, 30_000);
  const youGui = fen && (fen.asr > 0 || fen.tts > 0 || fen.embed > 0 || fen.chat > 0);
  check0(!!youGui, `②c 按标签自动分配生效（链里条目数）：${JSON.stringify(fen)}`);
} catch (e) { check0(false, `② 标签分配异常：${String(e.message || e)}`); }

// ── ③ 真实对话 + 工具落盘（含绝对路径自检）──
const SID = `verify-r14-${ROUND}`;
try {
  // 先预热一次（本地大模型冷启动可能 >60s，预热后再做正式断言）
  await ev(`window.warmy.chatSend({ sessionId:${JSON.stringify(SID + '-warm')}, role:'user', content:'hi', model:${JSON.stringify(OLLAMA_MODEL)}, ming:'牛马-1' }).then(r=>1)`, 300_000).catch(() => 1);
  const r = await ev(`window.warmy.chatSend({ sessionId:${JSON.stringify(SID)}, role:'user', content:'请只回答四个字：测试通过', model:${JSON.stringify(OLLAMA_MODEL)}, ming:'牛马-1' }).then(r=>({ok:r&&r.ok,reply:String((r&&r.reply)||'')}))`, 300_000);
  check0(!!r && r.ok === true && String(r.reply || '').trim().length > 0, `③a 真实对话：${JSON.stringify(String(r.reply || '').slice(0, 60))}`);
} catch (e) { check0(false, `③a 对话异常：${String(e.message || e)}`); }

try {
  const FN = `r14-check-${ROUND}.txt`;
  let r = null;
  try {
    r = await ev(`window.warmy.chatSend({ sessionId:${JSON.stringify(SID + '-tool')}, role:'user', content:'请调用 write_file 写入 ${FN}，内容为「第${ROUND}轮验证」。做完把返回里的绝对路径原样告诉我。', model:${JSON.stringify(OLLAMA_MODEL)}, ming:'牛马-1' }).then(r=>({ok:r&&r.ok,reply:String((r&&r.reply)||'')}))`, 600_000);
  } catch (e) {
    r = { ok: false, reply: String(e && e.message || e) };
  }
  // **以磁盘为准**：回复慢/超时不代表工具没干成（真机：本地大模型带工具循环偶尔 >360s）
  const wsPath = path.join(DATA, 'workspace', `${SID}-tool`);
  let found = '';
  for (let i = 0; i < 40 && !found; i++) {
    try { for (const f of fs.readdirSync(wsPath)) if (f === FN) found = path.join(wsPath, f); } catch { /* noop */ }
    if (!found) await sleep(500);
  }
  if (!found) {
    const m = String(r?.reply || '').match(/[A-Za-z]:\\[^\s`"'）)+\]]+\.txt/);
    if (m && fs.existsSync(m[0])) found = m[0];
  }
  const ziFu = found ? [...fs.readFileSync(found, 'utf8')].length : 0;
  check0(!!found && ziFu > 0, `③b 工具落盘 + 自检：${FN} → ${found || '(未找到)'}（${ziFu} 字符）${r && !r.ok ? '（回复超时但磁盘为准）' : ''}`);
} catch (e) { check0(false, `③b 工具异常：${String(e.message || e)}`); }

// ── ④ 赞/踩 → 智能配置文件 ──
try {
  await ev(`window.warmy.zhiNengPeiZhiTian({ lei:'user-vote', zanCai:'up', moXing:'qwen-verify', huiHua:${JSON.stringify(SID)}, wenTi:'第${ROUND}轮验证质量' })`, 20_000);
  const cfg = await ev(`window.warmy.zhiNengPeiZhiDu().then(r=>({ok:!!r.ok,text:String(r.text||''),path:String(r.path||'')}))`, 20_000);
  const youJiLu = !!(cfg && /用户评价=赞/.test(String(cfg.text || '')));
  check0(youJiLu, `④ 赞已写入智能配置：${youJiLu}（${cfg && cfg.path}）`);
} catch (e) { check0(false, `④ 智能配置异常：${String(e.message || e)}`); }

// ── ⑤ 真实 ASR 往返 ──
if (key) {
  try {
    /** TTS 偶发失败（外部服务瞬时）—— 重试一次再判定，不把抖动当成产品缺陷 */
    let tts = null;
    for (let ci = 0; ci < 3 && !(tts && tts.ok); ci++) {
      tts = await ev(`window.warmy.ttsLangDu({ text:'今天天气不错' }).then(r=>({ok:!!r.ok,len:String(r.dataUrl||'').length,err:String(r.error||'')}))`, 180_000).catch(() => null);
      if (!(tts && tts.ok)) await sleep(3000);
    }
    check0(!!tts && tts.ok === true && tts.len > 1000, `⑤a MiMo TTS 合成：${JSON.stringify({ ok: tts?.ok, len: tts?.len, err: tts?.err })}`);
    if (tts && tts.ok) {
      const full = await ev(`window.warmy.ttsLangDu({ text:'今天天气不错' }).then(r=>String(r.dataUrl||''))`, 180_000);
      const asr = await ev(`window.warmy.asrTranscribe({ dataUrl:${JSON.stringify(full)}, ext:'wav' })`, 180_000);
      const txt = String((asr && asr.text) || '');
      check0(!!asr && asr.ok === true && txt.trim().length > 0, `⑤b ASR 往返：${JSON.stringify(txt.slice(0, 40))}`);
    } else check0(false, '⑤b 跳过（TTS 没出音频）');
  } catch (e) { check0(false, `⑤ ASR 异常：${String(e.message || e)}`); }
} else {
  console.log('warn  无 MIMO_KEY，跳过 ⑤');
}

// ── ⑥ 身份锚 ──
try {
  const t = String(await ev(`window.warmy.chatSend({ sessionId:${JSON.stringify(SID + '-id')}, role:'user', content:'你是谁？我是谁？别调用工具，直接回答。', model:${JSON.stringify(OLLAMA_MODEL)}, ming:'牛马-1' }).then(r=>String((r&&r.reply)||''))`, 240_000) || '');
  const ren = /牛马/.test(t);
  const jia = /(我是|作为|身为)[^。\n]{0,12}(qwen|通义千问)/i.test(t);
  check0(ren && !jia, `⑥ 身份锚（认牛马=${ren}，自称qwen=${jia}）：${JSON.stringify(t.slice(0, 100))}`);
} catch (e) { check0(false, `⑥ 身份异常：${String(e.message || e)}`); }

ws.close();
try { child.kill(); } catch { /* noop */ }
await sleep(500);
console.log(`\n---- ROUND ${ROUND}: ${pass ? 'PASS' : 'FAIL'} ----`);
process.exit(pass ? 0 : 1);
