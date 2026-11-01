/**
 * verify-r82-kuanping —— 主界面宽屏/带鱼屏/全屏适配（真机 DOM 几何）
 *
 * 覆盖用户 2026-10-25 的要求：“进入程序后的界面要适配各种屏幕尺寸，尤其是带鱼屏。
 * 尤其是全屏的时候要进行适配。”
 *
 * 判据（全部量真实 Chromium 盒模型，不看源码字符串）：
 *  ① 960×600（最小窗）：四列放得下、聊天区 ≥ 330、无横向溢出；
 *  ② 1280×800：默认栏宽 200/300，正文左右内边距各 24（未到阅读宽度上限）；
 *  ③ 1920×1080：栏宽按窗口放宽，正文/输入区同宽（1040）且左右对称；
 *  ④ 2560×1080（带鱼屏）：正文上限 1160，右栏放宽，输入区与正文同沿；
 *  ⑤ 3440×1440 / 3840×1080（超宽/全屏）：正文上限 1320（≥3200 字号同步放大），左右留白相等，
 *     右栏 420、列表 280，窗口控件仍在视口内；
 *  ⑥ 用户拖过列表栏后，窗口再变宽仍尊重用户宽度；双击分隔条回到自动宽度。
 *
 * 只读产品 DOM / 只写临时 user-data-dir；不联网、不调用模型。
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

const PORT = Number(process.env.R82_PORT || 9682);
const SHOT = path.join(os.tmpdir(), 'warmy-r82-kuanping');
const profile = path.join(os.tmpdir(), 'warmy-r82-kuanping-' + Date.now() + '-' + process.pid);
fs.mkdirSync(profile, { recursive: true });

let ok = 0;
const hong = [];
const jian = (l, p, d) => {
  if (p) { ok += 1; console.log('  ok   ' + l); return; }
  hong.push(l);
  console.log('  FAIL ' + l + (d === undefined ? '' : ' ← ' + String(d).slice(0, 400)));
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
  for (let i = 0; i < 30; i++) {
    await sleep(200);
    try { process.kill(child.pid, 0); } catch { return; }
  }
  try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* noop */ }
}

const LIANG = `const liang = (sel) => { const e = document.querySelector(sel); if (!e) return null;
  const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
  return { x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height),
    pl: parseFloat(cs.paddingLeft) || 0, pr: parseFloat(cs.paddingRight) || 0, display: cs.display }; };`;
const q = (sel) => 'liang(' + JSON.stringify(sel) + ')';
const jiHe = async () => {
  const v = await c.evaluate(`(function(){
    ${LIANG}
    return {
      vw: innerWidth, vh: innerHeight,
      docW: document.documentElement.scrollWidth,
      appTi: ${q('#appTi')},
      list: ${q('#lieBiaoLan')},
      zhu: ${q('#zhuLan')},
      chatLayout: ${q('#liaoTianBuJu')},
      chat: ${q('#liaoTianLan')},
      panel: ${q('#mianBanLan')},
      feed: ${q('#xiaoXiJi')},
      msg: ${q('#xiaoXiJi .xiaoXi')},
      input: ${q('.shuRuQu')},
      inputInner: ${q('.shuRuQuZhu')},
      head: ${q('.liaoTianHead')},
      winMax: ${q('#anNiuwinMax')},
      cols: getComputedStyle(document.getElementById('appTi')).gridTemplateColumns,
      chatCols: (document.getElementById('liaoTianBuJu') && getComputedStyle(document.getElementById('liaoTianBuJu')).gridTemplateColumns) || '',
      listVar: getComputedStyle(document.documentElement).getPropertyValue('--list-w').trim(),
      panelVar: getComputedStyle(document.documentElement).getPropertyValue('--panel-w').trim(),
      duWen: getComputedStyle(document.documentElement).getPropertyValue('--du-wen-kuan').trim(),
    };
  })()`);
  return v;
};

/** 正文内容宽度（去掉左右内边距），以及左右留白是否对称 */
const nei = (feed) => feed.w - feed.pl - feed.pr;

try {
  let lastErr = '';
  for (let i = 0; i < 80; i++) {
    try { c = await attach(PORT, { biaoQian: 'r82-kuanping', callTimeout: 20000 }); break; } catch (e) { lastErr = e.message; await sleep(300); }
  }
  if (!c) throw new Error('CDP 没连上：' + lastErr);
  await c.send('Runtime.enable');
  await c.send('Page.enable');
  await c.waitFor('!!document.querySelector("#appTi")', { timeout: 30000, biaoQian: '主界面出现' });
  await sleep(700);

  // 无账号时聊天布局被隐藏：用 !important 内联显示，并塞几条消息量几何（只动本页 DOM）
  await c.evaluate(`(function(){
    const kong = document.getElementById('kongTai'); if (kong) kong.style.setProperty('display','none','important');
    const ju = document.getElementById('liaoTianBuJu');
    ju.classList.remove('yinCang'); ju.style.setProperty('display','grid','important');
    const he = document.getElementById('xiaoXiJi'); if (!he) return 'no feed';
    he.innerHTML = '';
    for (let i = 0; i < 4; i++) {
      const d = document.createElement('div'); d.className = 'xiaoXi' + (i % 2 ? ' wo' : '');
      const b = document.createElement('div'); b.className = 'bubble';
      b.textContent = '第 ' + (i + 1) + ' 条：用于量宽屏布局的消息。' + '内容'.repeat(40);
      const w = document.createElement('div'); w.className = 'bubbleWrap'; w.appendChild(b); d.appendChild(w); he.appendChild(d);
    }
    return 'ok';
  })()`);
  await sleep(250);

  const setSize = async (w, h) => {
    await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await sleep(380);
    return jiHe();
  };

  /* ① 最小窗 960×600 */
  let m = await setSize(960, 600);
  jian('960×600：三列都在视口内、无横向溢出',
    m.docW <= m.vw + 1 && m.list.x + m.list.w <= m.vw && m.panel.x + m.panel.w <= m.vw,
    JSON.stringify({ vw: m.vw, docW: m.docW, list: m.list, panel: m.panel }));
  jian('960×600：聊天区仍 ≥330px（不被两侧栏挤没）', m.chat.w >= 330, JSON.stringify(m.chat));
  jian('960×600：聊天正文左右内边距仍为 24px（未到阅读上限）',
    Math.abs(m.feed.pl - 24) < 1 && Math.abs(m.feed.pr - 24) < 1, JSON.stringify(m.feed));

  /* ② 1280×800：默认布局 */
  m = await setSize(1280, 800);
  jian('1280×800：列表 200 / 右栏 300 / 阅读上限变量 1040',
    m.list.w === 200 && m.panel.w === 300 && m.duWen === '1040px',
    JSON.stringify({ list: m.list.w, panel: m.panel.w, duWen: m.duWen }));
  jian('1280×800：正文左右各 24px、输入区不超出聊天列',
    Math.abs(m.feed.pl - 24) < 1 && Math.abs(m.feed.pr - 24) < 1
      && m.inputInner.w >= nei(m.feed) && m.inputInner.w <= m.feed.w,
    JSON.stringify({ feed: m.feed, inputInner: m.inputInner.w, nei: nei(m.feed) }));

  /* ③ 1920×1080 */
  m = await setSize(1920, 1080);
  const nei1920 = nei(m.feed);
  jian('1920×1080：侧栏按窗口放宽（列表 ≥250、右栏 ≥300）',
    m.list.w >= 250 && m.list.w <= 290 && m.panel.w >= 300 && m.panel.w <= 350,
    JSON.stringify({ list: m.list.w, panel: m.panel.w }));
  jian('1920×1080：正文内容宽 1040 且左右留白相等',
    Math.abs(nei1920 - 1040) <= 2 && Math.abs(m.feed.pl - m.feed.pr) <= 1,
    JSON.stringify({ nei: nei1920, pl: m.feed.pl, pr: m.feed.pr }));
  jian('1920×1080：输入区与正文左沿/宽度一致（同一条阅读列）',
    Math.abs(m.inputInner.x - m.msg.x) <= 2 && Math.abs(m.inputInner.w - nei1920) <= 2,
    JSON.stringify({ input: m.inputInner, msg: m.msg, nei: nei1920 }));
  jian('1920×1080：标题栏动作与窗口控件仍在视口内',
    m.winMax && m.winMax.x > 0 && m.winMax.x + m.winMax.w <= m.vw,
    JSON.stringify(m.winMax));

  /* ④ 2560×1080 带鱼屏 */
  m = await setSize(2560, 1080);
  const nei2560 = nei(m.feed);
  jian('2560×1080：带鱼屏正文上限 1160、左右对称',
    Math.abs(nei2560 - 1160) <= 2 && Math.abs(m.feed.pl - m.feed.pr) <= 1,
    JSON.stringify({ nei: nei2560, pl: m.feed.pl, pr: m.feed.pr }));
  jian('2560×1080：右栏 ≥400、列表 280',
    m.panel.w >= 400 && m.list.w === 280, JSON.stringify({ list: m.list.w, panel: m.panel.w }));

  /* ⑤ 3440×1440 超宽 + 3840×1080 超宽全屏 */
  for (const [w, h] of [[3440, 1440], [3840, 1080]]) {
    m = await setSize(w, h);
    const neiW = nei(m.feed);
    jian(`${w}×${h}：正文上限 1320、左右留白相等`,
      Math.abs(neiW - 1320) <= 2 && Math.abs(m.feed.pl - m.feed.pr) <= 1,
      JSON.stringify({ nei: neiW, pl: m.feed.pl, pr: m.feed.pr }));
    jian(`${w}×${h}：列表 280 / 右栏 420 / 聊天区不被压缩`,
      m.list.w === 280 && m.panel.w === 420 && m.chat.w > 1500,
      JSON.stringify({ list: m.list.w, panel: m.panel.w, chat: m.chat.w }));
    jian(`${w}×${h}：输入区、标题栏与正文同宽（不会单独横跨整屏）`,
      Math.abs(m.inputInner.w - neiW) <= 2 && Math.abs(m.input.pl - (m.head.pl)) <= 1
        && Math.abs(m.head.pl - m.feed.pl) <= 1,
      JSON.stringify({ inputW: m.inputInner.w, inputPad: m.input.pl, headPad: m.head.pl, feedPad: m.feed.pl }));
  }

  /* ⑥ 用户拖过宽度 → 窗口变宽仍尊重；双击复位 → 回到自动宽度 */
  m = await setSize(1920, 1080);
  const auto1920 = m.list.w;
  const drag = await c.evaluate(`(function(){
    const el = document.getElementById('lanTiaoZhengTiao');
    if (!el) return 'no resizer';
    const r = el.getBoundingClientRect();
    const x0 = r.x + Math.max(1, r.width / 2), y0 = r.y + 200;
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x0, clientY: y0, buttons: 1 }));
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x0 + 60, clientY: y0 }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x0 + 60, clientY: y0 }));
    return 'ok';
  })()`);
  await sleep(300);
  const afterDrag = await jiHe();
  jian('拖动列表分隔条 +60px 生效（用户宽度被记录）',
    drag === 'ok' && afterDrag.list.w >= auto1920 + 50,
    JSON.stringify({ drag, auto: auto1920, after: afterDrag.list.w }));
  m = await setSize(3440, 1440);
  jian('用户拖过列表栏后，窗口变宽仍保持用户宽度（不被自动放宽覆盖）',
    Math.abs(m.list.w - afterDrag.list.w) <= 2 && m.list.w !== 280,
    JSON.stringify({ afterDrag: afterDrag.list.w, wide: m.list.w }));
  const reset = await c.evaluate(`(function(){
    const el = document.getElementById('lanTiaoZhengTiao');
    if (!el) return 'no resizer';
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    return 'ok';
  })()`);
  await sleep(320);
  m = await jiHe();
  jian('双击分隔条复位：回到自动宽度（3440 下列表 280）',
    reset === 'ok' && m.list.w === 280, JSON.stringify({ reset, list: m.list.w }));

  /* ⑦ 整页（设置/我的）在超宽窗口同样收在 1400px 居中 */
  await c.evaluate(`(function(){
    const ju = document.getElementById('liaoTianBuJu');
    if (ju) { ju.style.removeProperty('display'); ju.classList.add('yinCang'); }
    const kong = document.getElementById('kongTai'); if (kong) kong.style.removeProperty('display');
    const s = document.querySelector('[data-nav="settings"]'); if (s) s.click();
    return !!s;
  })()`);
  await sleep(900);
  const pageGe = async () => c.evaluate(`(function(){
    const host = document.querySelector('#pageBuJu:not(.yinCang) #pageTi'); if (!host) return null;
    const e = host.firstElementChild; if (!e) return null;
    const r = e.getBoundingClientRect();
    const box = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      return { x: Math.round(b.x), w: Math.round(b.width), pl: parseFloat(cs.paddingLeft) || 0, pr: parseFloat(cs.paddingRight) || 0 }; };
    const hostL = Math.round(host.getBoundingClientRect().x);
    return { x: Math.round(r.x), w: Math.round(r.width), vw: innerWidth,
      left: Math.round(r.x) - hostL, right: Math.round(hostL + host.clientWidth - r.x - r.width),
      cls: e.className, hostCw: host.clientWidth,
      host: box(host), pb: box(document.getElementById('pageBuJu')), zhu: box(document.getElementById('zhuLan')) };
  })()`);
  let pg = await pageGe();
  jian('3440×1440：设置页内容收在 ≤1400px 且左右居中',
    !!pg && pg.w <= 1402 && Math.abs(pg.left - pg.right) <= 2,
    JSON.stringify(pg));
  await c.snap(SHOT + '-settings-3440.png');
  await c.evaluate(`(function(){ const w = document.querySelector('[data-nav="wo"]'); if (w) w.click(); return !!w; })()`);
  await sleep(800);
  pg = await pageGe();
  jian('3440×1440：我的页内容同样收在 ≤1400px 且左右居中',
    !!pg && pg.w <= 1402 && Math.abs(pg.left - pg.right) <= 2,
    JSON.stringify(pg));
  await c.snap(SHOT + '-wo-3440.png');

  await c.snap(SHOT + '-3440.png');
  await c.snap(SHOT + '-final.png');
} catch (e) {
  jian('门禁执行未抛错', false, (e && (e.stack || e.message)) || e);
} finally {
  await guan();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Windows 文件锁：留给系统临时目录 */ }
}

console.log(`\nverify-r82-kuanping: ${ok} ok / ${hong.length} FAIL`);
if (hong.length) console.log('红项：\n- ' + hong.join('\n- '));
process.exitCode = hong.length ? 1 : 0;
