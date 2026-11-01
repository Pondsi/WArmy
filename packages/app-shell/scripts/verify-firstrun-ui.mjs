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

const env = { ...process.env, WARMY_AUTH_BYPASS: '1' };
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

// ── C. 关键回归：连等 15s（跨过 3 次 5s 轮询）不许变回中文 ──
//    旧实现在这里就被轮询拉回（选了英文界面却变回简体中文、选择框还显示英文）；
//    更晚的"待确认 2 分钟兜底"同样会在几分钟后回退 —— 现在用户选过就本会话不让步，
//    且**引导语言对话框还开着**时任何自动路径都无权改语言。
const t0 = Date.now();
let reverted = null;
const seen = [];
while (Date.now() - t0 < 15000) {
  await sleep(500);
  const s = await lang();
  seen.push(s.logo);
  if (s.logo && s.logo !== 'WArmy') { reverted = { at: Date.now() - t0, s }; break; }
}
check('选英文后 15s 内不被自动改回中文（轮询/回读都上锁）', !reverted, reverted ? JSON.stringify(reverted) : `采样 ${seen.length} 次，全部 en`);
{
  const st = await lang();
  check('语言选择框仍开着且仍是英文（对话框开着 = 用户在选，不许被改）', st.sel === 'en-US' && st.logo === 'WArmy', JSON.stringify(st));
}

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

// ── E. 开始使用清单（R98 新清单；旧引导条/漫游层必须消失） ──
const hasGuide = await c.waitForQuiet(`!!document.getElementById('startGuide')`, { timeout: 15000 });
check('首启出现「开始使用」清单', hasGuide);
if (hasGuide) {
  const g1 = await c.evaluate(`(function(){
    const card = document.getElementById('startGuide');
    return {
      steps: card.querySelectorAll('.startGuideStep').length,
      done: card.querySelectorAll('.startGuideStep.isDone').length,
      active: [...card.querySelectorAll('.startGuideStep')].findIndex((e) => e.classList.contains('isActive')),
      title: (card.querySelector('.startGuideTitle') || {}).textContent || '',
      sub: (card.querySelector('.startGuideSub') || {}).textContent || '',
      oldBar: !!document.getElementById('yinDaoTiao'),
      oldTour: !!document.getElementById('warmyTour'),
      card: (() => { const r = card.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; })(),
      vw: innerWidth, vh: innerHeight,
      topHit: (() => { const e = document.elementFromPoint(Math.round(innerWidth / 2), 60); return !!(e && e.closest && e.closest('#startGuide')); })(),
    };
  })()`);
  check('旧引导条与漫游层都已删除', g1 && g1.oldBar === false && g1.oldTour === false, JSON.stringify(g1));
  check('清单是 4 步、第 1 步展开、进度 0/4', g1 && g1.steps === 4 && g1.done === 0 && g1.active === 0, JSON.stringify({ steps: g1 && g1.steps, done: g1 && g1.done, active: g1 && g1.active }));
  check('清单有标题与进度，且完整在视口内', g1 && g1.title.length > 0 && /0\/4/.test(g1.sub) && g1.card.l >= 0 && g1.card.t >= 0 && g1.card.l + g1.card.w <= g1.vw && g1.card.t + g1.card.h <= g1.vh, JSON.stringify(g1));
  check('清单非阻塞（页面顶部仍可点到底层内容）', g1 && g1.topHit === false, JSON.stringify({ topHit: g1 && g1.topHit }));

  await c.evaluate(`(function(){ const b=document.querySelector('#startGuide [data-sg="go"]'); if(b) b.click(); return !!b; })()`);
  await sleep(1000);
  const go = await c.evaluate(`(function(){
    const nav = document.querySelector('.ceLanTiaoMu.jiHuo')?.getAttribute('data-nav') || '';
    const sec = document.getElementById('peiZhiDaoHang')?.querySelector('button[data-sec="model"]');
    const host = document.getElementById('provTianJiaRuKou');
    return { nav, modelBtn: !!sec, host: !!host, pulse: !!(host && host.classList.contains('startGuidePulse')) };
  })()`);
  check('点「去添加供应商」真的进入 设置 → 模型 并定位供应商入口', go && go.nav === 'settings' && go.modelBtn === true && go.host === true, JSON.stringify(go));
  await sleep(500);
  const afterGo = await c.evaluate(`(function(){ return { panel: !!document.getElementById('startGuide'), pill: !!document.getElementById('startGuidePill') }; })()`);
  check('去操作后清单仍保留（第 98 轮口径：不自动收起）', afterGo && afterGo.panel === true && afterGo.pill === false, JSON.stringify(afterGo));
  await c.evaluate(`(function(){ document.getElementById('startGuidePill')?.click(); return true; })()`);
  await sleep(450);

  await c.evaluate(`(function(){ const b=document.querySelector('#startGuide [data-sg="later"]'); if(b) b.click(); return !!b; })()`);
  await sleep(500);
  const later = await c.evaluate(`(function(){
    return { panel: !!document.getElementById('startGuide'), pill: !!document.getElementById('startGuidePill') };
  })()`);
  const stAfter = await c.evaluate(`window.warmy.setupState().then((s) => ({ guideDone: s.guideDone === true }))`);
  check('「稍后设置」收起为准出胶囊，并落盘 guideDone', later && later.panel === false && later.pill === true && stAfter && stAfter.guideDone === true, JSON.stringify({ later, stAfter }));

  await c.evaluate(`window.__startGuideOpen(true)`);
  await sleep(500);
  const reopened = await c.evaluate(`(function(){ return { open: !!document.getElementById('startGuide'), active: [...document.querySelectorAll('#startGuide .startGuideStep')].findIndex((e) => e.classList.contains('isActive')) }; })()`);
  check('重看入口能重新打开清单并回到第 1 步', reopened && reopened.open === true && reopened.active === 0, JSON.stringify(reopened));

  await c.evaluate(`(function(){ const b=document.querySelector('#startGuide [data-sg="skip"]'); if(b) b.click(); return !!b; })()`);
  await sleep(400);
  const skipped = await c.evaluate(`(function(){ return { active: [...document.querySelectorAll('#startGuide .startGuideStep')].findIndex((e) => e.classList.contains('isActive')), tag: !!document.querySelector('#startGuide .startGuideSkipTag') }; })()`);
  check('单步可跳过：当前步标记已跳过并展开下一步', skipped && skipped.active === 1 && skipped.tag === true, JSON.stringify(skipped));
  await c.evaluate(`window.__startGuide?.close()`);
  await sleep(400);
}

// ── F. 设置页：分区必须都在内容列里 ──
await c.evaluate(`(function(){ window.__startGuide?.close?.(); return 1; })()`);
await sleep(400);
await c.evaluate(`(function(){ document.querySelector('[data-nav="settings"]').click(); return 1; })()`);
await sleep(1200);
const secs = ['ui', 'notify', 'model', 'func', 'skill', 'tool', 'plugin', 'gate', 'hotkey', 'about', 'mimic', 'sponsor'];
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
  const ok = !r.missing && r.visCount > 0 && r.inNav === 0 && r.outside === 0 && r.navBtns === secs.length && r.minW > r.navW + 100;
  if (ok) secOk++;
  else details.push(s + ':' + JSON.stringify(r));
}
check(`设置页 ${secs.length} 个分区都渲染在内容列里（不挤进 200px 导航列、不互相嵌套）`, secOk === secs.length, secOk === secs.length ? `${secs.length}/${secs.length}，卡片宽 > 内容列` : details.join(' | '));

// 分区切换后卡片真的换了一批（不是全都堆着显示）
const switchCheck = await c.evaluate(`(function(){ return document.querySelectorAll('#peiZhiNeiRong .sheZhiSection:not(.yinCang)').length; })()`);
check('分区切换是"只显示当前分区"（关于分区可见卡数应远小于总数）', switchCheck > 0 && switchCheck < 12, `可见 ${switchCheck} 张`);

const errs = c.errors();
check('首启全程无渲染层异常', errs.length === 0, errs.slice(0, 3).join(' | '));

console.log(`\n首启 UI 门禁: ${pass}/${pass + fail} 通过`);
c.close();
die(fail === 0 ? 0 : 1);
