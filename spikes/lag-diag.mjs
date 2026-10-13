/** 页内纯计时诊断：点「设置」后，关键节点多久出现（排除 CDP 往返噪声） */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PKG = path.join(process.cwd(), 'packages', 'app-shell');
const DATA = path.join(process.env.APPDATA || '', '@warmy', 'app-shell');
const PORT = 9480;
try {
  const sp = path.join(DATA, 'settings.json');
  const s = fs.existsSync(sp) ? JSON.parse(fs.readFileSync(sp, 'utf8')) : {};
  s.setupDone = true; s.guideDone = true; s.privacyConsent = true;
  fs.writeFileSync(sp, JSON.stringify(s, null, 2));
} catch { /* noop */ }

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(path.join(PKG, 'node_modules', 'electron', 'dist', 'electron.exe'),
  [`--remote-debugging-port=${PORT}`, path.join(PKG, 'dist', 'electron-main.js')],
  { cwd: PKG, stdio: ['ignore', 'pipe', 'pipe'], env });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WebSocket = globalThis.WebSocket;

let up = false;
for (let i = 0; i < 80 && !up; i++) {
  try { up = (await fetch(`http://127.0.0.1:${PORT}/json`, { signal: AbortSignal.timeout(1500) })).ok; } catch { /* wait */ }
  if (!up) await sleep(300);
}
if (!up) { console.log('CDP not up'); child.kill(); process.exit(1); }
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
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  return r?.result?.result?.value;
};

await send('Runtime.enable');
await sleep(5000);

const r = await ev(`(function(){
  window.__lt = { n:0, total:0, max:0, list:[] };
  try { new PerformanceObserver((es)=>{ for (const e of es.getEntries()){ window.__lt.n++; window.__lt.total+=e.duration; window.__lt.max=Math.max(window.__lt.max,e.duration); window.__lt.list.push(Math.round(e.duration)); } }).observe({entryTypes:['longtask']}); } catch(e){}
  const t0 = performance.now();
  const b = document.querySelector('.ceLanTiaoMu[data-nav="settings"]');
  if (!b) return JSON.stringify({ err:'no settings button' });
  b.click();
  return new Promise((res) => {
    const marks = {};
    const iv = setInterval(() => {
      const now = performance.now() - t0;
      if (!marks.nav && document.getElementById('peiZhiDaoHang')) marks.nav = Math.round(now);
      if (!marks.prov && document.getElementById('provPreset')) marks.prov = Math.round(now);
      if (!marks.func && document.getElementById('anNiuMaiKeFengCeShi')) marks.func = Math.round(now);
      if (!marks.font && document.getElementById('xuanZeYuYan')) marks.font = Math.round(now);
      if (marks.nav && marks.prov) { clearInterval(iv); setTimeout(() => res(JSON.stringify({ marks, lt: window.__lt })), 900); }
      if (now > 15000) { clearInterval(iv); res(JSON.stringify({ marks, timeout:true, lt: window.__lt })); }
    }, 16);
  });
})()`);
console.log('页内计时：', r);

// 再点一次「模型」分区（此时设置已开）
const r2 = await ev(`(function(){
  const t0 = performance.now();
  const b = document.querySelector('#peiZhiDaoHang button[data-sec="model"]');
  if (!b) return JSON.stringify({ err:'no model btn' });
  b.click();
  return new Promise((res) => {
    const iv = setInterval(() => {
      const now = performance.now() - t0;
      if (document.getElementById('provPreset') && document.getElementById('provLieBiao')) {
        clearInterval(iv); res(JSON.stringify({ modelBtnMs: Math.round(now), lt: window.__lt }));
      }
      if (now > 10000) { clearInterval(iv); res(JSON.stringify({ timeout:true, modelBtnMs: Math.round(now), lt: window.__lt })); }
    }, 16);
  });
})()`);
console.log('切「模型」页内计时：', r2);

ws.close(); child.kill();
process.exit(0);
