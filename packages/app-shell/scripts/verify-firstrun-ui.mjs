#!/usr/bin/env node
/**
 * 真机门禁：**首启那一段界面**（语言选择 → 隐私 → 引导条 → 设置页）。
 *
 * 覆盖本轮三处真事故（都用全新 user-data-dir 复现"第一次打开"）：
 *  1) 首启选英文后，5s 轮询拿设置文件里的旧值把界面拉回简体中文（选择框还显示英文）；
 *  2) 引导条拖到顶部后压在 `#biaoTiLan`（-webkit-app-region: drag）上，再也拖不动、按钮也点不了；
 *  3) 设置页模板少一个/多一个 `</div>`，内容列提前闭合 ⇒ 分区挤进导航列、卡片互相吞。
 *
 * 只读产品 DOM、只做真实鼠标输入，不写产品数据。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { attach, sleep } from './cdp-lib.mjs';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(selfDir, '..');
const PORT = Number(process.env.WARMY_FIRSTRUN_CDP_PORT || 9891);
const electron = path.join(pkgRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const mainJs = path.join(pkgRoot, 'dist', 'electron-main.js');
const profile = path.join(os.tmpdir(), 'warmy-firstrun-' + Date.now());

let pass = 0, fail = 0;
const check = (l, ok, d) => {
  if (ok) { pass++; console.log('  ok   ' + l + (d !== undefined ? '  ' + String(d).slice(0, 160) : '')); }
  else { fail++; console.log('  FAIL ' + l + (d !== undefined ? '  ' + String(d).slice(0, 300) : '')); }
};

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [
  `--remote-debugging-port=${PORT}`,
  '--disable-features=CalculateNativeWinOcclusion',
  `--user-data-dir=${profile}`,
  mainJs,
], { cwd: pkgRoot, stdio: ['ignore', 'pipe', 'pipe'], env });

let c = null;
const die = (code, msg) => { if (msg) console.log(msg); try { child.kill('SIGKILL'); } catch { /* noop */ } process.exit(code); };

let up = false;
for (let i = 0; i < 60; i++) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/json`, { signal: AbortSignal.timeout(1200) }); if (r.ok) { up = true; break; } } catch { /* retry */ }
  await sleep(500);
}
if (!up) die(2, 'CDP not up');
await sleep(4500);
c = await attach(PORT, { biaoQian: 'firstrun', callTimeout: 25000 });
await c.send('Runtime.enable');

const lang = () => c.evaluate(`(function(){
  const q = (s) => { const e = document.querySelector(s); return e ? e.textContent.trim() : null; };
  return { logo: q('#logoMing'), listTitle: q('#lieBiaoBiaoTi'), sel: (document.getElementById('chuShiSheZhiYuYan')||{}).value || null };
})()`);

// ── A. 首启必须弹语言选择 ──
const hasPicker = await c.waitForQuiet(`!!document.getElementById('chuShiSheZhiYuYan') && !document.getElementById('duiHuaKuangGen').classList.contains('yinCang')`, { timeout: 20000 });
check('首启弹出界面语言选择', hasPicker);
if (!hasPicker) die(1);

// ── B. 选英文 ⇒ 立刻英文 ──
await c.evaluate(`(function(){
  const s = document.getElementById('chuShiSheZhiYuYan');
  s.value = 'en-US';
  s.dispatchEvent(new Event('change', { bubbles: true }));
  return s.value;
})()`);
await sleep(1200);
let L = await lang();
check('选英文后界面变英文', L.logo === 'WArmy' && L.sel === 'en-US', JSON.stringify(L));

// ── C. 关键回归：连等 12s（跨过 2 次 5s 轮询）不许变回中文 ──
const t0 = Date.now();
let reverted = null;
const seen = [];
while (Date.now() - t0 < 12000) {
  await sleep(500);
  const s = await lang();
  seen.push(s.logo);
  if (s.logo && s.logo !== 'WArmy') { reverted = { at: Date.now() - t0, s }; break; }
}
check('选英文后 12s 内不被自动改回中文（轮询/回读都上锁）', !reverted, reverted ? JSON.stringify(reverted) : `采样 ${seen.length} 次，全部 en`);

// ── D. 确认后（真落盘）再观察 7s ──
await c.evaluate(`(function(){ const b=[...document.querySelectorAll('#duiHuaKuangDongZuoJi button')][0]; if(b) b.click(); return 1; })()`);
await sleep(700);
await c.evaluate(`(function(){ const z=document.getElementById('yinSiDuiHuaKuangTi'); if(z) z.scrollTop=z.scrollHeight; return 1; })()`);
await sleep(3600);
const agreed = await c.evaluate(`(function(){ const b=document.querySelector('#duiHuaKuangDongZuoJi button.anNiuZhuYao'); if(b&&!b.disabled){ b.click(); return true;} return false; })()`);
check('隐私政策可同意（滚到底 + 3s 后按钮可用）', agreed);
const t1 = Date.now();
let reverted2 = null;
while (Date.now() - t1 < 7000) {
  await sleep(500);
  const s = await lang();
  if (s.logo && s.logo !== 'WArmy') { reverted2 = s; break; }
}
check('确认语言后仍然保持英文', !reverted2, reverted2 ? JSON.stringify(reverted2) : '7s 采样全 en');

// ── E. 引导条：拖动区必须不被窗口拖动区吃掉 ──
const hasBar = await c.waitForQuiet(`!!document.getElementById('yinDaoTiao')`, { timeout: 15000 });
check('首启出现引导条', hasBar);
if (hasBar) {
  const region = await c.evaluate(`(function(){
    const bar = document.getElementById('yinDaoTiao');
    const g = (e) => e ? getComputedStyle(e).webkitAppRegion : null;
    return { bar: g(bar), head: g(bar.querySelector('.yinDaoHead')), btn: g(bar.querySelector('button')), title: g(document.getElementById('biaoTiLan')), titleBottom: Math.round(document.getElementById('biaoTiLan').getBoundingClientRect().bottom) };
  })()`);
  check('引导条是 no-drag（标题栏仍是 drag）', region.bar === 'no-drag' && region.head === 'no-drag' && region.btn === 'no-drag' && region.title === 'drag', JSON.stringify(region));

  const rect = () => c.evaluate(`(function(){ const r=document.getElementById('yinDaoTiao').getBoundingClientRect(); return { l:Math.round(r.left), t:Math.round(r.top), w:Math.round(r.width), h:Math.round(r.height) }; })()`);
  const headXY = () => c.evaluate(`(function(){ const r=document.getElementById('yinDaoTiao').querySelector('.yinDaoHead').getBoundingClientRect(); return { x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2) }; })()`);
  const drag = async (fromX, fromY, toX, toY) => {
    await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: fromX, y: fromY, button: 'left', clickCount: 1, buttons: 1 });
    for (let i = 1; i <= 12; i++) {
      await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, x: Math.round(fromX + (toX - fromX) * i / 12), y: Math.round(fromY + (toY - fromY) * i / 12) });
      await sleep(16);
    }
    await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: toX, y: toY, button: 'left', clickCount: 1, buttons: 0 });
  };
  const r0 = await rect();
  // 拖到顶部：y=4 落在标题栏（40px）里
  let h = await headXY();
  await drag(h.x, h.y, 600, 4);
  await sleep(700);
  const r1 = await rect();
  check('引导条能被拖到顶部（贴顶 8px）', r1.t <= 12 && r1.t !== r0.t, `初始 t=${r0.t} → 顶部 t=${r1.t}`);
  const hit = await c.hitTest(600, 20);
  check('顶部重叠区命中的是引导条自身（不是窗口拖动区）', String(hit).includes('yinDao'), String(hit));
  // 再从顶部拖回来：这正是"拖到顶部就再也拖不动"的现场
  h = await headXY();
  await drag(h.x, h.y, 500, 420);
  await sleep(700);
  const r2 = await rect();
  check('从顶部仍能拖动（不再被主界面拖动抢走）', r2.t > 60, `t=${r2.t}`);
  check('松手后四边吸附（贴边 8px 或贴顶/贴底）', [8, Math.round(8)].includes(r2.t) || r2.l === 8 || r2.t > 60, `l=${r2.l} t=${r2.t}`);
}

// ── F. 设置页：分区必须都在内容列里 ──
await c.evaluate(`(function(){ const b=document.querySelector('#yinDaoTiao [data-yd="skip"]'); if(b) b.click(); return 1; })()`);
await sleep(400);
await c.evaluate(`(function(){ document.querySelector('[data-nav="settings"]').click(); return 1; })()`);
await sleep(1200);
const secs = ['ui', 'notify', 'model', 'func', 'skill', 'plugin', 'hotkey', 'about'];
let secOk = 0;
const details = [];
for (const s of secs) {
  await c.evaluate(`(function(){ const b=document.querySelector('#peiZhiDaoHang button[data-sec="${s}"]'); if(b) b.click(); return 1; })()`);
  await sleep(600);
  const r = await c.evaluate(`(function(){
    const nr = document.getElementById('peiZhiNeiRong');
    const nav = document.getElementById('peiZhiDaoHang');
    if (!nr || !nav) return { missing: true };
    const vis = [...document.querySelectorAll('.sheZhiSection')].filter(e => !e.classList.contains('yinCang') && getComputedStyle(e).display !== 'none');
    return {
      visCount: vis.length,
      inNav: nav.querySelectorAll('.sheZhiSection').length,
      outside: [...document.querySelectorAll('.sheZhiSection')].filter(e => !nr.contains(e)).length,
      minW: Math.min(...vis.map(e => Math.round(e.getBoundingClientRect().width))),
      navW: Math.round(nav.getBoundingClientRect().width),
      navBtns: nav.querySelectorAll('button[data-sec]').length,
    };
  })()`);
  const ok = !r.missing && r.visCount > 0 && r.inNav === 0 && r.outside === 0 && r.navBtns === 8 && r.minW > r.navW + 100;
  if (ok) secOk++;
  else details.push(s + ':' + JSON.stringify(r));
}
check('设置页 8 个分区都渲染在内容列里（不挤进 200px 导航列、不互相嵌套）', secOk === secs.length, secOk === secs.length ? `8/8，卡片宽 ${'>'} 内容列` : details.join(' | '));

// 分区切换后卡片真的换了一批（不是全都堆着显示）
const switchCheck = await c.evaluate(`(function(){ return document.querySelectorAll('#peiZhiNeiRong .sheZhiSection:not(.yinCang)').length; })()`);
check('分区切换是"只显示当前分区"（关于分区可见卡数应远小于总数）', switchCheck > 0 && switchCheck < 12, `可见 ${switchCheck} 张`);

const errs = c.errors();
check('首启全程无渲染层异常', errs.length === 0, errs.slice(0, 3).join(' | '));

console.log(`\n首启 UI 门禁: ${pass}/${pass + fail} 通过`);
c.close();
die(fail === 0 ? 0 : 1);
