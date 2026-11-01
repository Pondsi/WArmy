/**
 * verify-r83-mimic-look —— A9 方案 B（保守版）：受控拟态观察
 *  ① 默认关闭：调用 capture 返回 consent-required，绝不偷偷截屏；
 *  ② 显式打开开关后才允许截一次**本应用窗口**；
 *  ③ 返回真实 PNG data URL（能解码、非空），不落盘（本门禁只调 IPC，不检查磁盘）；
 *  ④ 关掉开关后再次拒绝（开关是运行时真判据，不是只存一次）。
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

const PORT = Number(process.env.R83_MIMIC_PORT || 9691);
const profile = path.join(os.tmpdir(), 'warmy-r83-mimic-' + Date.now() + '-' + process.pid);
fs.mkdirSync(profile, { recursive: true });
let ok = 0;
const hong = [];
const jian = (l, p, d) => {
  if (p) { ok += 1; console.log('  ok   ' + l); return; }
  hong.push(l);
  console.log('  FAIL ' + l + (d === undefined ? '' : ' ← ' + String(d).slice(0, 240)));
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
    try { c = await attach(PORT, { biaoQian: 'r83-mimic', callTimeout: 20000 }); break; } catch { await sleep(300); }
  }
  if (!c) throw new Error('CDP 没连上');
  await c.send('Runtime.enable');
  await c.waitFor('!!document.querySelector("#appTi")', { timeout: 30000, biaoQian: '主界面' });
  await sleep(800);

  const r0 = await c.evaluate(`window.warmy.mimicLook()`);
  jian('默认关闭时拒绝截屏（consent-required）', r0 && r0.ok === false && r0.error === 'consent-required', JSON.stringify(r0));

  await c.evaluate(`window.warmy.settingsSave({ mimicLookConsent: true })`);
  await sleep(400);
  const r1 = await c.evaluate(`window.warmy.mimicLook()`);
  jian('显式同意后能截取应用窗口', r1 && r1.ok === true && typeof r1.dataUrl === 'string' && r1.dataUrl.startsWith('data:image/png;base64,'), JSON.stringify(r1 && { ok: r1.ok, len: String(r1.dataUrl || '').length }));
  jian('截图尺寸有效且为 PNG 头', !!r1 && r1.width > 200 && r1.height > 100 && Buffer.from(String(r1.dataUrl).split(',')[1] || '', 'base64').subarray(0, 8).toString('hex') === '89504e470d0a1a0a', r1 && { w: r1.width, h: r1.height });

  await c.evaluate(`window.warmy.settingsSave({ mimicLookConsent: false })`);
  await sleep(300);
  const r2 = await c.evaluate(`window.warmy.mimicLook()`);
  jian('关掉开关后再次拒绝', r2 && r2.ok === false && r2.error === 'consent-required', JSON.stringify(r2));

  await c.evaluate(`document.querySelector('[data-nav="settings"]')?.click()`);
  await sleep(1000);
  await c.evaluate(`document.querySelector('[data-sec="mimic"]')?.click()`);
  await sleep(1000);
  const ui = await c.evaluate(`(function(){ const ck=document.getElementById('mimicLookConsent'); const b=document.getElementById('anNiuMimicLook'); return { ck: !!ck, btn: !!b, nav: !!document.querySelector('[data-nav="settings"]'), sec: !!document.querySelector('[data-sec="mimic"]') }; })()`);
  jian('设置页有隐私开关与「看一眼」按钮', ui.ck === true && ui.btn === true, JSON.stringify(ui));
} catch (e) {
  jian('门禁执行未抛错', false, (e && (e.stack || e.message)) || e);
} finally {
  await guan();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Windows 锁 */ }
}

console.log(`\nverify-r83-mimic-look: ${ok} ok / ${hong.length} FAIL`);
if (hong.length) console.log('红项：\n- ' + hong.join('\n- '));
process.exitCode = hong.length ? 1 : 0;
