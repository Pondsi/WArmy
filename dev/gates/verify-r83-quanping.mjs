/**
 * verify-r83-quanping —— F11 真全屏 + ≥3200 宽字号适配
 *  ① 初始不是全屏；
 *  ② 按 F11 后主窗口进入真全屏（主进程 isFullScreen=true，不是仅最大化）；
 *  ③ 按 Esc 退出全屏；
 *  ④ 视口 3440×1440 时根字号提升到 15px、阅读列 1320，且无横向溢出；
 *  ⑤ 1440 宽仍保持 14px（断点没有误伤普通屏）。
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

const PORT = Number(process.env.R83_QP_PORT || 9690);
const profile = path.join(os.tmpdir(), 'warmy-r83-quanping-' + Date.now() + '-' + process.pid);
fs.mkdirSync(profile, { recursive: true });
let ok = 0;
const hong = [];
const jian = (l, p, d) => {
  if (p) { ok += 1; console.log('  ok   ' + l); return; }
  hong.push(l);
  console.log('  FAIL ' + l + (d === undefined ? '' : ' ← ' + String(d).slice(0, 300)));
};

const env = { ...process.env, WARMY_AUTH_BYPASS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(ELECTRON, [
  '--remote-debugging-port=' + PORT,
  '--disable-features=CalculateNativeWinOcclusion',
  '--user-data-dir=' + profile,
  MAIN,
], { cwd: PKG, stdio: ['ignore', 'ignore', 'ignore'], env });

let c = null;
async function guan() {
  try { if (c) await c.send('Browser.close', {}, { timeout: 6000 }); } catch { /* 已退 */ }
  try { if (c) c.close(); } catch { /* 已断 */ }
  for (let i = 0; i < 30; i++) {
    await sleep(200);
    try { process.kill(child.pid, 0); } catch { return; }
  }
  try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* noop */ }
}

try {
  for (let i = 0; i < 80; i++) {
    try { c = await attach(PORT, { biaoQian: 'r83-quanping', callTimeout: 15000 }); break; } catch { await sleep(300); }
  }
  if (!c) throw new Error('CDP 没连上');
  await c.send('Runtime.enable');
  await c.waitFor('!!document.querySelector("#appTi")', { timeout: 30000, biaoQian: '主界面' });
  await sleep(500);

  const z0 = await c.evaluate(`window.warmy.winZhuangTai()`);
  jian('初始不是全屏', z0 && z0.ok === true && z0.fullscreen === false, z0);

  const key = async (k, code, vk) => {
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  };
  await key('F11', 'F11', 122);
  await sleep(1200);
  const z1 = await c.evaluate(`window.warmy.winZhuangTai()`);
  jian('F11 进入真全屏（isFullScreen=true）', z1 && z1.fullscreen === true, z1);

  await key('Escape', 'Escape', 27);
  await sleep(1000);
  const z2 = await c.evaluate(`window.warmy.winZhuangTai()`);
  jian('Esc 退出全屏', z2 && z2.fullscreen === false, z2);

  /* 4K / 超宽字号（DevTools 模拟视口，不改真实屏幕） */
  await c.send('Emulation.setDeviceMetricsOverride', { width: 3440, height: 1440, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  const d4k = await c.evaluate(`(function(){
    const root = getComputedStyle(document.documentElement);
    return { fs: root.getPropertyValue('--fs-md').trim(), fsBase: root.getPropertyValue('--fs-base').trim(),
      du: root.getPropertyValue('--du-wen-kuan').trim(), vw: innerWidth,
      docW: document.documentElement.scrollWidth, bodyW: document.body.scrollWidth };
  })()`);
  jian('3440 宽根字号提升到 15px', d4k.fs === '15px' && d4k.fsBase === '14px', JSON.stringify(d4k));
  jian('3440 阅读列 1320、无横向溢出', d4k.du === '1320px' && d4k.docW <= d4k.vw + 1 && d4k.bodyW <= d4k.vw + 1, d4k);

  await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(300);
  const d1440 = await c.evaluate(`(function(){ const r = getComputedStyle(document.documentElement); return { fs: r.getPropertyValue('--fs-md').trim(), du: r.getPropertyValue('--du-wen-kuan').trim() }; })()`);
  jian('1440 宽仍是 14px / 1040（断点没误伤）', d1440.fs === '14px' && d1440.du === '1040px', d1440);
} catch (e) {
  jian('门禁执行未抛错', false, (e && (e.stack || e.message)) || e);
} finally {
  await guan();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Windows 锁 */ }
}

console.log(`\nverify-r83-quanping: ${ok} ok / ${hong.length} FAIL`);
if (hong.length) console.log('红项：\n- ' + hong.join('\n- '));
process.exitCode = hong.length ? 1 : 0;
