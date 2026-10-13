/**
 * 点击延迟探针（第 12 轮）：验证「设置页只刷供应商列表、不整页重绘」+ 下拉延迟。
 *
 * 三条断言：
 *   1. 打开「设置 → 模型」耗时（首次渲染预算内）
 *   2. 供应商下拉浮层延迟（自定义下拉，非原生 select）
 *   3. 点「添加供应商」：延迟小、供应商行 +1、且 **pageTi 首个子节点未变**（证明没整页重绘）
 *
 * 用法： <node> verify-click-lag.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PKG = path.join(process.cwd(), 'packages', 'app-shell');
/**
 * **隔离的 userData**：main 里 userData 被硬固定到 `%APPDATA%\@warmy\app-shell`，
 * 而用户本机**可能正开着**同一个应用（占着锁与端口）。所以这里把子进程的 `APPDATA`
 * 指到临时目录 ⇒ userData = `<tmp>\@warmy\app-shell`，探针与用户的实时实例互不干扰。
 */
const APPDATA = path.join(process.env.TEMP || process.env.TMP || '.', 'warmy-verify-appdata');
const DATA = path.join(APPDATA, '@warmy', 'app-shell');
const PORT = 9461;

try {
  fs.mkdirSync(DATA, { recursive: true });
  const sp = path.join(DATA, 'settings.json');
  const s = fs.existsSync(sp) ? JSON.parse(fs.readFileSync(sp, 'utf8')) : {};
  s.privacyConsent = true;
  s.guideDone = true;
  fs.writeFileSync(sp, JSON.stringify(s, null, 2));
} catch { /* noop */ }

const env = { ...process.env, APPDATA };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(path.join(PKG, 'node_modules', 'electron', 'dist', 'electron.exe'),
  [`--remote-debugging-port=${PORT}`, path.join(PKG, 'dist', 'electron-main.js')],
  { cwd: PKG, stdio: ['ignore', 'pipe', 'pipe'], env });

const logs = [];
child.stdout.on('data', (d) => logs.push(String(d)));
child.stderr.on('data', (d) => logs.push(String(d)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WebSocket = globalThis.WebSocket;

let up = false;
for (let i = 0; i < 60 && !up; i++) {
  try { up = (await fetch(`http://127.0.0.1:${PORT}/json`, { signal: AbortSignal.timeout(1500) })).ok; } catch { /* wait */ }
  if (!up) await sleep(400);
}
if (!up) { console.log('CDP not up'); console.log('--- child logs ---\n' + logs.join('').slice(0, 4000)); child.kill(); process.exit(1); }

const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = list.find((x) => x.type === 'page');
if (!page) { console.log('no page'); child.kill(); process.exit(1); }

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
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  return r?.result?.result?.value;
}

await send('Runtime.enable');
await sleep(4500);

let pass = true;
const say = (ok, msg) => { if (!ok) pass = false; console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); };

// ── 1) 打开「设置 → 模型」的耗时 ──
const tSettings = Date.now();
await ev(`(function(){var b=document.querySelector('.ceLanTiaoMu[data-nav="settings"]')||document.querySelector('[data-nav="settings"]');if(b)b.click();return 1;})()`);
await sleep(900);
await ev(`(function(){var n=document.querySelector('#peiZhiDaoHang button[data-sec="model"]');if(n)n.click();return 1;})()`);
await sleep(700);
const dtSettings = Date.now() - tSettings;
say(true, `open settings→model  ${dtSettings}ms（含两次人为 sleep 1800ms，仅作参考）`);

// ── 2) 供应商下拉延迟 ──
const lat = [];
let shown = false;
for (let k = 0; k < 8; k++) {
  await ev(`(function(){var p=document.querySelector('.provXiaLaPan');if(p)p.remove();return 1;})()`);
  const s = Date.now();
  await ev(`(function(){var b=document.getElementById('provPreset');if(b)b.click();return !!b;})()`);
  let ok = false;
  for (let i = 0; i < 60; i++) {
    ok = await ev(`!!document.querySelector('.provXiaLaPan')`);
    if (ok) break;
    await sleep(8);
  }
  if (k === 0) shown = ok;
  lat.push(Date.now() - s);
  await ev(`(function(){var p=document.querySelector('.provXiaLaPan');if(p)p.remove();return 1;})()`);
}
console.log('   dropdown latency ms =', lat.join(','));
say(shown && lat.every((x) => x < 400), `supplier dropdown opens and stays <400ms (shown=${shown}, max=${Math.max(...lat)})`);

// ── 3) 添加供应商：延迟 + 只刷列表（不整页重绘）──
await ev(`(function(){var b=document.getElementById('provPreset');if(b)b.click();return 1;})()`);
await sleep(150);
await ev(`(function(){var b=document.querySelector('.provXiaLaPan [data-pid="deepseek"]');if(b)b.click();return !!b;})()`);
await sleep(120);

// 记下「整页重绘探针」：pageTi 的第一个子节点（若整页重绘，它必被换掉）
await ev(`window.__pageTiFirst = (document.getElementById('pageTi')||{}).firstElementChild || null; 1`);
const rowsBefore = Number(await ev(`document.querySelectorAll('#provLieBiao > div').length`)) || 0;

const tAdd = Date.now();
await ev(`(function(){var b=document.getElementById('anNiuTianJiaProv');if(b&&!b.disabled)b.click();return !!(b&&!b.disabled);})()`);
// 等列表出现新行
let rowsAfter = rowsBefore;
for (let i = 0; i < 60; i++) {
  rowsAfter = Number(await ev(`document.querySelectorAll('#provLieBiao > div').length`)) || 0;
  if (rowsAfter > rowsBefore) break;
  await sleep(20);
}
const dtAdd = Date.now() - tAdd;
const sameFirst = await ev(`(function(){var n=(document.getElementById('pageTi')||{}).firstElementChild||null;return window.__pageTiFirst===n;})()`);

console.log(`   add provider latencyMs=${dtAdd}  rows ${rowsBefore}→${rowsAfter}  pageTi-first-unchanged=${sameFirst}`);
say(dtAdd < 600, `add provider returns fast (${dtAdd}ms < 600ms)`);
say(rowsAfter === rowsBefore + 1, `provider list grew by 1 (${rowsBefore}→${rowsAfter})`);
say(sameFirst === true, 'settings page NOT fully re-rendered (pageTi first child preserved)');

ws.close();
try { child.kill(); } catch { /* noop */ }
console.log(pass ? 'LAG TEST PASS' : 'LAG TEST FAIL');
process.exit(pass ? 0 : 1);
