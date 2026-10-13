/**
 * **专项卡顿探针**（第 13 轮·页内计时版）：只验"点起来卡不卡"。
 *
 * 为什么改成**页内计时**：上一版把 CDP `Runtime.evaluate` 的往返也算进了"点击延迟"，
 * 于是恒定报 ~1250ms；而同一动作在页面里用 `performance.now()` 量是 **59ms**。
 * 卡顿要量的是**用户手指到界面响应**，不是调试协议的往返 —— 所以计时全部发生在渲染进程里，
 * CDP 只负责把结果取出来。
 *
 * 量三样：
 *   ① 启动 → 可交互
 *   ② 一串真实点击的**页内**响应时间（进设置/切分区/开下拉/加供应商/切功能/回我的）
 *   ③ 这段时间里的**长任务**（PerformanceObserver 'longtask'，>50ms 就会挡点击）
 *
 * 判定：每次点击 < 400ms、长任务总时长 < 1500ms 且单条 < 400ms ⇒ 不卡。
 *
 * 用法：<node> verify-ui-lag.mjs [--round N]
 * 注意：跑之前**必须关掉正在运行的应用**（单实例锁）。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PKG = path.join(ROOT, 'packages', 'app-shell');
const ROUND = (() => { const i = process.argv.indexOf('--round'); return i >= 0 ? String(process.argv[i + 1] || '1') : '1'; })();
const PORT = 9472 + (Number(ROUND) || 1);
const DATA = path.join(process.env.APPDATA || '', '@warmy', 'app-shell');

try {
  const sp = path.join(DATA, 'settings.json');
  const s = fs.existsSync(sp) ? JSON.parse(fs.readFileSync(sp, 'utf8')) : {};
  s.setupDone = true; s.guideDone = true; s.privacyConsent = true;
  fs.writeFileSync(sp, JSON.stringify(s, null, 2));
} catch { /* noop */ }

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const tLaunch = Date.now();
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
for (let i = 0; i < 80 && !up; i++) {
  try { up = (await fetch(`http://127.0.0.1:${PORT}/json`, { signal: AbortSignal.timeout(1500) })).ok; } catch { /* wait */ }
  if (!up) await sleep(300);
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
async function ev(expr, timeoutMs = 30_000) {
  const r = await Promise.race([
    send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }),
    sleep(timeoutMs).then(() => ({ __timeout: true })),
  ]);
  if (r && r.__timeout) throw new Error('EVAL_TIMEOUT');
  return r?.result?.result?.value;
}

await send('Runtime.enable');

// ① 启动 → 可交互（**事件绑定完成**才算可交互：DOM 在了但 onclick 还没挂上时点下去是无效点击）
let readyMs = -1;
for (let i = 0; i < 200; i++) {
  const ok = await ev(`(function(){
    if (!document.querySelector('.ceLanTiaoMu[data-nav="settings"]')) return false;
    if (document.body.innerText.length < 20) return false;
    // 顶层导航是用 onclick 绑的；绑上了才算真的能点
    const b = document.querySelector('.ceLanTiaoMu[data-nav="settings"]');
    return !!(b && b.onclick);
  })()`);
  if (ok) { readyMs = Date.now() - tLaunch; break; }
  await sleep(100);
}
say(readyMs > 0 && readyMs < 15000, `① 启动→可交互（事件已绑） = ${readyMs}ms（<15000）`);

// 装长任务观测器
await ev(`(function(){
  window.__lt = { n:0, total:0, max:0, list:[] };
  try { new PerformanceObserver((es)=>{ for (const e of es.getEntries()){ window.__lt.n++; window.__lt.total+=e.duration; window.__lt.max=Math.max(window.__lt.max,e.duration); if(window.__lt.list.length<30) window.__lt.list.push(Math.round(e.duration)); } }).observe({entryTypes:['longtask']}); } catch(e){ window.__lt.err=String(e); }
  return 1;
})()`);

/**
 * **页内计时**：在渲染进程里 `performance.now()` 量「点下去 → 条件满足」。
 * 一次 CDP 调用拿回结果，不把调试往返算进延迟。
 */
async function dianNei(name, clickExpr, condExpr) {
  const ms = await ev(`(function(){
    const t0 = performance.now();
    try { ${clickExpr}; } catch (e) { return -2; }
    return new Promise((res) => {
      const iv = setInterval(() => {
        const now = performance.now() - t0;
        let ok = false;
        try { ok = !!(${condExpr}); } catch (e) { ok = false; }
        if (ok) { clearInterval(iv); res(Math.round(now)); }
        else if (now > 8000) { clearInterval(iv); res(-1); }
      }, 8);
    });
  })()`);
  say(Number(ms) >= 0 && Number(ms) < 400, `② ${name} 页内响应 ${ms}ms（<400）`);
  return Number(ms);
}

await dianNei('进「设置」',
  `document.querySelector('.ceLanTiaoMu[data-nav="settings"]').click()`,
  `document.getElementById('peiZhiDaoHang')`);
await dianNei('切到「模型」分区',
  `document.querySelector('#peiZhiDaoHang button[data-sec="model"]').click()`,
  `document.getElementById('provPreset') && document.getElementById('provLieBiao')`);

for (let k = 0; k < 4; k++) {
  await ev(`(function(){var p=document.querySelector('.provXiaLaPan');if(p)p.remove();return 1;})()`);
  await dianNei(`供应商下拉 #${k + 1}`,
    `document.getElementById('provPreset').click()`,
    `document.querySelector('.provXiaLaPan')`);
  await ev(`(function(){var p=document.querySelector('.provXiaLaPan');if(p)p.remove();return 1;})()`);
}

// 添加供应商
await ev(`(function(){var b=document.getElementById('provPreset');if(b)b.click();return 1;})()`);
await sleep(150);
await ev(`(function(){var b=document.querySelector('.provXiaLaPan [data-pid="deepseek"]');if(b)b.click();return 1;})()`);
await sleep(100);
const rowsB = Number(await ev(`document.querySelectorAll('#provLieBiao > div').length`)) || 0;
await dianNei('添加供应商',
  `document.getElementById('anNiuTianJiaProv').click()`,
  `document.querySelectorAll('#provLieBiao > div').length > ${rowsB}`);

await dianNei('切到「功能」分区',
  `document.querySelector('#peiZhiDaoHang button[data-sec="func"]').click()`,
  `document.getElementById('anNiuMaiKeFengCeShi')`);
await dianNei('回到「我的」',
  `document.querySelector('.ceLanTiaoMu[data-nav="wo"]').click()`,
  `document.getElementById('pMingDisplay') || document.querySelector('.woPinPai')`);

const lt = JSON.parse(await ev(`JSON.stringify(window.__lt || {})`) || '{}');
console.log(`   长任务：${lt.n || 0} 条，总 ${Math.round(lt.total || 0)}ms，最大 ${Math.round(lt.max || 0)}ms，样本=${JSON.stringify(lt.list || [])}`);
say((lt.n || 0) <= 12 && (lt.total || 0) < 1500 && (lt.max || 0) < 400,
  `③ 长任务在预算内（n=${lt.n || 0}≤12，total=${Math.round(lt.total || 0)}<1500ms，max=${Math.round(lt.max || 0)}<400ms）`);

// ④ msb 存在性判断必须走「零进程」路径 —— 真 spawn 未签名的 msb.exe 会弹
//    「无法确认谁发布了 msb.exe」并且扫描期间卡住（用户实测）。这里连 CDP 往返一起算，
//    阈值放宽到 300ms：真 spawn 一次就是秒级，必然超。
const tMsb = Date.now();
let msb = null;
try { msb = await ev(`window.warmy.msbCunZai?.()`, 5000); } catch { msb = null; }
const msbMs = Date.now() - tMsb;
say(msb && msbMs < 300, `④ msbCunZai 零进程判断 ${msbMs}ms（<300）exists=${!!(msb && msb.exists)}`);

ws.close();
try { child.kill(); } catch { /* noop */ }
await sleep(500);
console.log(pass ? 'UI LAG TEST PASS' : 'UI LAG TEST FAIL');
process.exit(pass ? 0 : 1);
