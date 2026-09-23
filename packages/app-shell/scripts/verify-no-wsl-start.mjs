/**
 * **永久要求**（产品主定稿）：启动 / 使用本应用 **绝不启动 WSL**。
 *
 * 为什么是"永久"要求：`wsl.exe` 的 `--version` / `-l -v` 在 Windows 上会把 WSL 服务拉起来，
 * 以前"打开新窗口 → 查项目状态 → 全量探测运行时"就会顺手 spawn wsl.exe，
 * 用户看到的现象就是"打开应用/新窗口触发了打开 WSL"。这条必须一直成立，不许回退。
 *
 * 本门禁做两件事（**动态 + 静态**）：
 *  1. **动态**：记录 wsl/wslhost 进程数与各发行版状态 → 启动应用 → 走真实路径打开一个会话
 *     （并开一个新窗口）→ 断言进程数不变、发行版状态不变（没有新的 wsl.exe/wslhost.exe）。
 *     只有 `wsl -l -v` 这一句是我们自己为**取证**而跑的（读状态，不启动发行版）。
 *  2. **静态**：`probeWsl` 默认静默（!deep 时一个 wsl.exe 都不 spawn）；
 *     项目状态查询的调用点不传 deep；只有容器卡片的显式探测才允许 deep。
 *
 * 降级：本机没有 WSL / PowerShell 不可用 ⇒ 如实跳过动态部分（不断言假通过）。
 */
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(selfDir, '..');
const ROOT = path.resolve(PKG, '..', '..');
const PORT = Number(process.env.WARMY_NO_WSL_CDP_PORT || 9937);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const failures = [];
function check(ming, ok, detail) {
  console.log((ok ? '  ok   ' : '  FAIL ') + ming + (detail !== undefined ? '  ' + JSON.stringify(detail).slice(0, 200) : ''));
  if (!ok) failures.push(ming);
}

// ── 静态部分：规则必须写在代码里 ──
{
  const probeSrc = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/container-probe.ts'), 'utf8');
  const mainSrc = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/electron-main.ts'), 'utf8');
  check('静态：probeWsl 默认静默（!deep 时不 spawn 任何 wsl.exe，报 not-probed）',
    /async function tanCeWsl[\s\S]{0,900}status: 'not-probed'/.test(probeSrc) && /wsl-not-probed/.test(probeSrc));
  check('静态：项目状态查询不传 deep（例行路径不启动 WSL）',
    /tanCeRongQiYunXing\(\{ cacheMs: 8000, only: \[runtimeId\] \}\)/.test(mainSrc)
    && !/tanCeRongQiYunXing\(\{ cacheMs: 8000, only: \[runtimeId\], deep/.test(mainSrc));
  check('静态：只有显式探测（容器卡片按钮）才传 deep:true',
    /opts\?\.deep === true/.test(mainSrc) && /warmy:rongQiTanCe/.test(mainSrc));
}

// ── 动态部分：真机启动应用 + 开新窗口，看 wsl 有没有被拉起 ──
function ps(cmd) {
  try { return execSync('powershell -NoProfile -Command "' + cmd + '"', { encoding: 'utf8', maxBuffer: 4e6 }).trim(); }
  catch (e) { return null; }
}
const wslProcs = () => ps('(Get-Process wsl,wslhost -ErrorAction SilentlyContinue | Measure-Object).Count');
const wslStates = () => ps('wsl -l -v') ? ps('wsl -l -v').replace(/\u0000/g, '') : null;

const beforeProcs = wslProcs();
const beforeStates = wslStates();
if (beforeStates === null) {
  console.log('  SKIP 本机没有可用的 WSL/PowerShell ⇒ 动态部分跳过（静态规则仍已断言）');
} else {
  const electron = path.join(PKG, 'node_modules', 'electron', 'dist', 'electron.exe');
  const child = spawn(electron, [`--remote-debugging-port=${PORT}`, '--disable-features=CalculateNativeWinOcclusion', path.join(PKG, 'dist', 'electron-main.js')], { cwd: PKG, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', () => {}); child.stderr.on('data', () => {});
  const afterBootProcs = { v: null, v2: null, fu: null };
  async function attachTo(pred, biaoQian) {
    for (let i = 0; i < 60; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json`, { signal: AbortSignal.timeout(4000) })).json();
        const page = list.find(pred);
        if (page) {
          const ws = new WebSocket(page.webSocketDebuggerUrl);
          await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', () => j(new Error('ws'))); });
          let id = 0; const pending = new Map();
          ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } });
          const faSong = (method, params) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: mid, method, params })); setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); rej(new Error('timeout')); } }, 20000); });
          await faSong('Runtime.enable', {});
          return { url: page.url, evaluate: async (expr) => { const r = await faSong('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 200)); return r.result.value; } };
        }
      } catch { /* retry */ }
      await sleep(1000);
    }
    throw new Error('no target ' + biaoQian);
  }
  try {
    const main = await attachTo((p) => p.type === 'page' && !/chatId=/.test(p.url), 'main');
    await sleep(4000);
    afterBootProcs.v = wslProcs();
    check('动态：应用启动后没有新的 wsl.exe/wslhost.exe', afterBootProcs.v === beforeProcs, { before: String(beforeProcs).slice(0, 80), after: String(afterBootProcs.v).slice(0, 80) });

    const stamp = String(Date.now()).slice(-6);
    const gid = 'nowsl-' + stamp;
    const ming = '无WSL-' + stamp;
    await main.evaluate(`(async function(){
      await window.warmy.groupCreate({ groupId: '${gid}', ming: '${ming}', type: 'internal', directedMode: false, devEnv: 'host' });
      if (window.__syncGroups) await window.__syncGroups();
      return true;
    })()`);
    await sleep(1500);
    await main.evaluate(`(function(){ document.querySelector('#ceLan [data-nav="internalGroup"]').click(); return true; })()`);
    await sleep(2000);
    await main.evaluate(`(function(){ const r=Array.from(document.querySelectorAll('#lieBiaoTi .lieBiaoTiaoMu')).find((x)=>((x.querySelector('.name')||{}).textContent||'').trim()===${JSON.stringify(ming)}); if(r) r.click(); return true; })()`);
    await sleep(2500);
    afterBootProcs.v2 = wslProcs();
    check('动态：选中会话后没有新的 wsl.exe/wslhost.exe', afterBootProcs.v2 === beforeProcs);

    await main.evaluate(`(function(){ const mi=document.querySelector('#caiDanTuBiaoDaKai'); if (mi) mi.click(); return true; })()`);
    await attachTo((p) => p.type === 'page' && p.url.includes('chatId=' + gid), 'fu');
    await sleep(4000);
    afterBootProcs.fu = wslProcs();
    const afterStates = wslStates();
    check('动态：打开新窗口后没有新的 wsl.exe/wslhost.exe', afterBootProcs.fu === beforeProcs);
    check('动态：发行版状态未被改变（没有被代为启动）', afterStates === beforeStates, { before: String(beforeStates).replace(/\s+/g, ' ').slice(0, 90), after: String(afterStates).replace(/\s+/g, ' ').slice(0, 90) });
  } catch (e) {
    check('动态：执行未抛异常', false, String(e).slice(0, 200));
  } finally {
    try { child.kill('SIGKILL'); } catch { /* noop */ }
  }
}

console.log(`\n==== verify-no-wsl-start: ${failures.length === 0 ? '全部通过' : failures.length + ' FAIL'} ====`);
if (failures.length) console.log('失败项：\n - ' + failures.join('\n - '));
process.exit(failures.length ? 1 : 0);
