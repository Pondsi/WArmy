/**
 * verify-r83-quit-confirm —— 首启右上角关闭二次确认
 *  ① 首启点 X：不立刻退出，先出现确认层；
 *  ② 确认层内容是项目用过的牛马图标串（≥6 个不同资源，全部真实可加载）；
 *  ③ 选项只有「返回界面 / 关闭程序」；
 *  ④ 点「返回界面」：确认层收起、程序还活着；
 *  ⑤ 再次点 X →「关闭程序」：程序真的退出（不是最小化到托盘）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PKG = path.join(ROOT, 'packages', 'app-shell');
const ELECTRON = path.join(PKG, 'node_modules', 'electron', 'dist', 'electron.exe');
const MAIN = path.join(PKG, 'dist', 'electron-main.js');
const { attach, sleep } = await import(pathToFileURL(path.join(PKG, 'scripts', 'cdp-lib.mjs')).href);

const PORT = Number(process.env.R83_QCONF_PORT || 9693);
const profile = path.join(os.tmpdir(), 'warmy-r83-qconf-' + Date.now() + '-' + process.pid);
fs.mkdirSync(profile, { recursive: true });
let ok = 0;
const hong = [];
const jian = (l, p, d) => {
  if (p) { ok += 1; console.log('  ok   ' + l); return; }
  hong.push(l);
  console.log('  FAIL ' + l + (d === undefined ? '' : ' ← ' + String(d).slice(0, 260)));
};

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.WARMY_AUTH_BYPASS; // 首启必须走真实认证层
const child = spawn(ELECTRON, [
  '--remote-debugging-port=' + PORT,
  '--disable-features=CalculateNativeWinOcclusion',
  '--user-data-dir=' + profile,
  MAIN,
], { cwd: PKG, stdio: ['ignore', 'ignore', 'ignore'], env });

let c = null;
let exited = false;
try {
  for (let i = 0; i < 100; i++) {
    try { c = await attach(PORT, { biaoQian: 'r83-qconf', callTimeout: 20000 }); break; } catch { await sleep(300); }
  }
  if (!c) throw new Error('CDP 没连上');
  await c.send('Runtime.enable');
  await c.waitFor('!!document.querySelector("#warmyAuthCloseX")', { timeout: 40000, biaoQian: '首启关闭按钮' });
  await sleep(400);

  const z0 = await c.evaluate(`(function(){ const m=document.getElementById('warmyAuthQuitMask'); return { mask: !!m, on: !!(m&&m.classList.contains('on')) }; })()`);
  jian('初始没有确认层', z0.mask && z0.on === false, JSON.stringify(z0));

  await c.evaluate(`document.getElementById('warmyAuthCloseX').click()`);
  await sleep(350);
  const z1 = await c.evaluate(`(function(){
    const m=document.getElementById('warmyAuthQuitMask');
    const imgs=[...document.querySelectorAll('.warmyAuthQuitHorse')];
    const b1=document.getElementById('warmyAuthQuitBack');
    const b2=document.getElementById('warmyAuthQuitNow');
    return { on: !!(m&&m.classList.contains('on')), n: imgs.length,
      srcs: imgs.map(i=>i.getAttribute('src')),
      loaded: imgs.map(i=>!!(i.complete && i.naturalWidth>0)),
      back: b1?b1.textContent.trim():'', quit: b2?b2.textContent.trim():'' };
  })()`);
  jian('点 X 先出现二次确认（不直接退出）', z1.on === true, JSON.stringify(z1));
  jian('确认层是一串 ≥6 个不同牛马图标', z1.n >= 6 && new Set(z1.srcs).size >= 6, JSON.stringify(z1.srcs));
  jian('图标资源都真实加载成功', z1.loaded.every(Boolean), JSON.stringify(z1));
  jian('选项是「返回界面 / 关闭程序」', /返回界面/.test(z1.back) && /关闭程序/.test(z1.quit), JSON.stringify({ back: z1.back, quit: z1.quit }));

  await c.evaluate(`document.getElementById('warmyAuthQuitBack').click()`);
  await sleep(300);
  const z2 = await c.evaluate(`(function(){ const m=document.getElementById('warmyAuthQuitMask'); return { on: !!(m&&m.classList.contains('on')), alive: true }; })()`);
  let alive = true;
  try { process.kill(child.pid, 0); } catch { alive = false; }
  jian('点「返回界面」收起确认层', z2.on === false, JSON.stringify(z2));
  jian('「返回界面」后程序仍然活着', alive === true);

  await c.evaluate(`document.getElementById('warmyAuthCloseX').click()`);
  await sleep(250);
  await c.evaluate(`document.getElementById('warmyAuthQuitNow').click()`);
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    try { process.kill(child.pid, 0); } catch { exited = true; break; }
  }
  jian('点「关闭程序」后程序真的退出', exited === true);
} catch (e) {
  jian('门禁执行未抛错', false, (e && (e.stack || e.message)) || e);
} finally {
  if (!exited) {
    try { if (c) await c.send('Browser.close', {}, { timeout: 5000 }); } catch { /* 已退 */ }
    try { if (c) c.close(); } catch { /* 已断 */ }
    for (let i = 0; i < 20; i++) {
      await sleep(200);
      try { process.kill(child.pid, 0); } catch { break; }
    }
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* noop */ }
  }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Windows 锁 */ }
}

console.log(`\nverify-r83-quit-confirm: ${ok} ok / ${hong.length} FAIL`);
if (hong.length) console.log('红项：\n- ' + hong.join('\n- '));
process.exitCode = hong.length ? 1 : 0;
