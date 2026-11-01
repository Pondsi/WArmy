/**
 * verify-r78-auth-tour —— 第 78 轮首启/登录 7 项门禁（真机 + 纯函数）
 *
 * 覆盖用户点名的重点：
 *  ① 我的页勾「自动登录」二次确认；取消 ⇒ 保持未勾选（不写认证库）
 *  ② 首启语言页平铺 10 种语言，点一下即选（无下拉/无菜单）
 *  ③ 登录页 PIN 输入框内嵌登录按钮（命中测试）+ 更小 + 返回首启语言页
 *  ④ 语言 / 条款 / 登录三屏持续播放同一牛马背景（亮色场景真的在动）
 *  ⑥ 成语模式 12 格（每格覆盖 2 个 BIP-39 索引）；词组模式 24 格
 *  ⑦ 中文友好型：序号与词同一行，每条两行（序号+词 / 拼音），不出屏
 *  （旧 ⑧ 漫游式引导已在第 98 轮删除，新清单见 verify-r98-onboarding）
 *
 * 只读产品 DOM / 只写临时 profile；不联网、不调用真实 AI、不装任何东西。
 * 纯函数段不需要 Electron（没有 electron.exe 时只跑这一段并说明）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PKG = path.join(ROOT, 'packages', 'app-shell');
const SRC = path.join(PKG, 'src', 'renderer', 'auth-gate.js');
const ELECTRON = path.join(PKG, 'node_modules', 'electron', 'dist', 'electron.exe');
const MAIN = path.join(PKG, 'dist', 'electron-main.js');
const { attach, sleep } = await import(pathToFileURL(path.join(PKG, 'scripts', 'cdp-lib.mjs')).href);

const PORT = Number(process.env.R78_PORT || 9778);
const SHOT = path.join(os.tmpdir(), 'warmy-r78-auth');
fs.mkdirSync(SHOT, { recursive: true });

let ok = 0;
const hong = [];
const jian = (l, p, d) => {
  if (p) { ok += 1; console.log('  ok   ' + l); return; }
  hong.push(l);
  console.log('  FAIL ' + l + (d === undefined ? '' : ' ← ' + String(d).slice(0, 340)));
};

/* ── 纯函数：成语配对（12 格覆盖 1–24 且不重排） ─────────────────────── */
function fnBody(src, name) {
  const marker = `function ${name}(`;
  const i = src.indexOf(marker);
  if (i < 0) return '';
  let depth = 0;
  let started = false;
  for (let k = i; k < src.length; k++) {
    const c = src[k];
    if (c === '{') { depth++; started = true; } else if (c === '}') { depth--; if (started && depth === 0) return src.slice(i, k + 1); }
  }
  return '';
}
const src = fs.readFileSync(SRC, 'utf8');
const pairFn = fnBody(src, 'pairIdiomItems');
let pairOk = false;
let pairDetail = 'pairIdiomItems 未找到';
try {
  const pair = new Function(pairFn + '; return pairIdiomItems;')();
  const items = Array.from({ length: 24 }, (_, i) => ({ w: 'i' + i, p: 'p' + i }));
  const out = pair(items);
  pairOk = out.length === 12
    && out.every((x, k) => x.w === 'i' + (2 * k) && x.w2 === 'i' + (2 * k + 1)
      && x.cover[0] === 2 * k + 1 && x.cover[1] === 2 * k + 2)
    && out.map((x) => x.cover.join(',')).join('|') === Array.from({ length: 12 }, (_, k) => `${2 * k + 1},${2 * k + 2}`).join('|');
  pairDetail = JSON.stringify(out.slice(0, 3));
} catch (e) {
  pairDetail = String(e && e.message);
}
jian('纯函数：24 个成语折成 12 格，第 k 格恰好覆盖 (2k+1, 2k+2) 且顺序不变', pairOk, pairDetail);
jian('纯函数：首启背景本次启动随机一幕并固定（不在页面内轮播）',
  /SHOU_QI_CHANG_JING = \[1, 2, 4, 6, 9, 10\]/.test(src)
  && /sessionStorage\.getItem\('warmy\.firstScene'\)/.test(src)
  && /Math\.floor\(Math\.random\(\) \* SHOU_QI_CHANG_JING\.length\)/.test(src)
  && /scenes=' \+ BEN_CI_CHANG_JING \+ '&rotate=0/.test(src)
  && !/period=12000/.test(src));

const hasElectron = fs.existsSync(ELECTRON) && fs.existsSync(MAIN);
if (!hasElectron) {
  console.log('\n  · 没找到 electron.exe / dist/electron-main.js：只跑了纯函数段。');
  console.log(`\n==== verify-r78-auth-tour：${ok} ok / ${hong.length} FAIL ====`);
  process.exit(hong.length ? 1 : 0);
}

/* ── 真机：全新 profile ───────────────────────────────────────────────── */
const profile = path.join(os.tmpdir(), 'warmy-r78-auth-' + Date.now() + '-' + process.pid);
fs.mkdirSync(profile, { recursive: true });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.WARMY_AUTH_BYPASS;
const CHILD_ARGS = [
  '--remote-debugging-port=' + PORT,
  '--disable-features=CalculateNativeWinOcclusion',
  '--user-data-dir=' + profile,
  MAIN,
];
const spawnChild = () => spawn(ELECTRON, CHILD_ARGS, { cwd: PKG, stdio: ['ignore', 'ignore', 'ignore'], env });
let child = spawnChild();

async function waitCdp(secs = 40) {
  for (let i = 0; i < secs; i++) {
    try { const r = await fetch('http://127.0.0.1:' + PORT + '/json', { signal: AbortSignal.timeout(1200) }); if (r.ok) return true; } catch { /* retry */ }
    await sleep(500);
  }
  return false;
}
let c = null;
const js = (expr) => c.evaluate('(async function(){ try { return await (' + expr + '); } catch (err) { return { __err: String((err && (err.stack || err.message)) || err).slice(0, 300) }; } })()');
/** 真实鼠标点击 + 条件等待；失败时重新取元素中心再点（目标可能被重渲染移动）。
 *  clickUntil 的问题：一次点中后如果条件慢，它会在同一坐标继续点，reload/切区后可能点到别处。 */
async function realClickUntil(sel, cond, o = {}) {
  const tries = o.tries ?? 3;
  const perTry = o.perTry ?? 10000;
  const trail = [];
  for (let i = 1; i <= tries; i++) {
    const box = await c.center(sel);
    if (!box) { trail.push(`#${i} 没找到/不可见`); await sleep(o.gap ?? 250); continue; }
    await c.mouseClick(box.x, box.y);
    trail.push(`#${i} 点(${box.x},${box.y})`);
    if (await c.waitForQuiet(cond, { timeout: perTry })) return { ok: true, trail };
    await sleep(o.gap ?? 250);
  }
  return { ok: false, trail };
}
async function guan() {
  try { if (c) await c.send('Browser.close', {}, { timeout: 6000 }); } catch { /* 已退 */ }
  for (let i = 0; i < 30; i++) {
    await sleep(200);
    try { process.kill(child.pid, 0); } catch { return; }
  }
  try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* noop */ }
}

try {
  let lastErr = '';
  for (let i = 0; i < 60; i++) {
    try { c = await attach(PORT, { biaoQian: 'r78', callTimeout: 12000 }); break; } catch (e) { lastErr = e.message; await sleep(300); }
  }
  if (!c) throw new Error('CDP 没连上：' + lastErr);
  await c.send('Runtime.enable');
  await c.send('Page.enable');
  await c.waitFor('!!document.querySelector("#warmyAuthStart")', { timeout: 25000, biaoQian: '首启语言页' });
  await sleep(300);
  await c.snap(path.join(SHOT, '01-language.png'));

  /* ── ② 语言平铺 ───────────────────────────────────────────────── */
  const lang0 = await js(`(() => {
    const tiles = [...document.querySelectorAll('.warmyAuthLangTile')];
    const r = (e) => { const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), r: Math.round(b.right), b: Math.round(b.bottom) }; };
    const grid = document.querySelector('.warmyAuthLangGrid');
    const card = document.querySelector('.warmyAuthFirstCard');
    return {
      tiles: tiles.length,
      labels: tiles.map((e) => e.textContent.trim()),
      locales: tiles.map((e) => e.getAttribute('data-locale')),
      visible: tiles.every((e) => { const b = e.getBoundingClientRect(); return b.width > 40 && b.height > 18; }),
      cols: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length : 0,
      card: r(card), vw: innerWidth, vh: innerHeight,
      select: document.querySelectorAll('#warmyAuthCard select').length,
      menu: !!document.querySelector('#warmyAuthLangMenu'),
      popup: [...document.querySelectorAll('[aria-haspopup]')].filter((e) => e.getClientRects().length > 0).length,
      checkedLocale: document.querySelector('.warmyAuthLangTile[aria-checked="true"]')?.getAttribute('data-locale') || '',
    };
  })()`);
  jian('② 首启平铺 10 种语言（无 select / 无下拉菜单 / 无 aria-haspopup）',
    lang0 && lang0.tiles === 10 && lang0.select === 0 && lang0.menu === false && lang0.popup === 0 && lang0.checkedLocale === 'zh-CN',
    JSON.stringify(lang0 && { tiles: lang0.tiles, select: lang0.select, menu: lang0.menu, popup: lang0.popup, checked: lang0.checkedLocale }));
  jian('② 10 个语言块都真实可见、两列排布、首启卡不出屏',
    lang0 && lang0.visible === true && lang0.cols === 2
    && lang0.card.x >= 0 && lang0.card.r <= lang0.vw && lang0.card.y >= 0 && lang0.card.b <= lang0.vh,
    JSON.stringify(lang0 && { visible: lang0.visible, cols: lang0.cols, card: lang0.card, vw: lang0.vw, vh: lang0.vh }));

  await c.clickUntil('[data-locale="en-US"]', 'document.documentElement.lang === "en-US" && document.querySelector("#warmyAuthStart").textContent.trim() === "Start"', { timeout: 4000 });
  const en = await js(`(async () => {
    const s = await window.warmy.settingsGet();
    return {
      lang: document.documentElement.lang,
      start: document.querySelector('#warmyAuthStart').textContent.trim(),
      on: document.querySelector('.warmyAuthLangTile.is-on')?.getAttribute('data-locale') || '',
      saved: s && s.settings && s.settings.yuYan,
    };
  })()`);
  jian('② 点 English 立即选中（文案/html lang/落盘都变，没有第二步确认）',
    en && en.lang === 'en-US' && en.start === 'Start' && en.on === 'en-US' && en.saved === 'en-US', JSON.stringify(en));
  await c.clickUntil('[data-locale="zh-CN"]', 'document.documentElement.lang === "zh-CN" && document.querySelector("#warmyAuthStart").textContent.trim() === "开始"', { timeout: 4000 });
  const zh = await js(`(() => ({ on: document.querySelector('.warmyAuthLangTile.is-on')?.getAttribute('data-locale') || '', lang: document.documentElement.lang }))()`);
  jian('② 再点简体立即切回（选中态跟着走）', zh && zh.on === 'zh-CN' && zh.lang === 'zh-CN', JSON.stringify(zh));

  /* ── ④ 语言页背景动画 ─────────────────────────────────────────── */
  const sceneOf = () => js(`(() => {
    const s = document.querySelector('#warmyAuthGate > .warmyAuthSceneEmbed');
    const f = s && s.querySelector('iframe');
    const b = s ? s.getBoundingClientRect() : null;
    return { scene: !!s && !s.hidden, embed: !!f, src: f && f.getAttribute('src') || '', w: b && Math.round(b.width), h: b && Math.round(b.height), vw: innerWidth, vh: innerHeight, frames: Number(f && f.contentWindow && f.contentWindow.__sceneFrames || 0) };
  })()`);
  const scene1 = await sceneOf();
  await sleep(650);
  const scene1b = await sceneOf();
  jian('④ 语言页：随机一幕牛马背景铺满窗口且在动（帧计数增长）',
    scene1 && scene1.scene && scene1.embed && /embed=1/.test(scene1.src) && /scenes=\d+&rotate=0/.test(scene1.src) && !/scenes=.*,/.test(scene1.src)
    && scene1.w === scene1.vw && scene1.h === scene1.vh && scene1b.frames > scene1.frames,
    JSON.stringify({ scene1, scene1b }));

  await c.clickUntil('#warmyAuthStart', '!!document.querySelector("#warmyAuthTermsBody")', { timeout: 8000 });
  await sleep(200);
  const scene2 = await sceneOf();
  jian('④ 条款页继续播放同一牛马背景（场景仍在、铺满）',
    scene2 && scene2.scene && scene2.embed && scene2.w === scene2.vw && scene2.h === scene2.vh && scene2.src === scene1.src, JSON.stringify(scene2));
  await c.snap(path.join(SHOT, '02-terms.png'));

  await js(`(() => { const b=document.querySelector('#warmyAuthTermsBody'); b.scrollTop=b.scrollHeight; b.dispatchEvent(new Event('scroll')); return b.scrollTop; })()`);
  await sleep(3200);
  await c.clickUntil('#warmyAuthTermsContinue', '!!document.querySelector("#warmyAuthPin")', { timeout: 8000 });
  await sleep(250);
  const scene3 = await sceneOf();
  jian('④ 登录页继续播放同一牛马背景（一直播到进入软件）',
    scene3 && scene3.scene && scene3.embed && scene3.w === scene3.vw && scene3.h === scene3.vh, JSON.stringify(scene3));

  /* ── ③ 登录页：更小 + PIN 内嵌按钮 + 返回语言页 ──────────────── */
  const login = await js(`(() => {
    const q = (s) => document.querySelector(s);
    const box = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), r: Math.round(b.right), b: Math.round(b.bottom), cy: Math.round(b.y + b.height / 2) }; };
    const card = q('.warmyAuthCard');
    const input = q('#warmyAuthPin');
    const go = q('[data-auth-action="login-pin"]');
    const ib = box(input);
    const gb = box(go);
    const hit = gb ? document.elementFromPoint(gb.x + gb.w / 2, gb.cy) : null;
    const leftInside = ib ? document.elementFromPoint(ib.x + 20, ib.cy) : null;
    return {
      card: box(card), input: ib, go: gb,
      inside: !!(ib && gb && gb.x >= ib.x && gb.r <= ib.r + 1 && gb.y >= ib.y - 1 && gb.b <= ib.b + 1),
      labelFits: !!(go && go.scrollWidth <= go.clientWidth + 1),
      padRight: input ? parseFloat(getComputedStyle(input).paddingRight) : 0,
      hitGo: !!(hit && hit.closest && hit.closest('[data-auth-action="login-pin"]')),
      hitInput: !!(leftInside && leftInside.id === 'warmyAuthPin'),
      back: !!q('[data-auth-action="login-lang-back"]'),
      backText: (q('[data-auth-action="login-lang-back"]')?.textContent || '').trim(),
      backSvg: !!q('[data-auth-action="login-lang-back"] svg'),
      backBox: box(q('[data-auth-action="login-lang-back"]')),
      brand: !!q('.warmyAuthBrand'), title: !!q('.warmyAuthTitle'),
      vw: innerWidth, vh: innerHeight,
    };
  })()`);
  jian('③ PIN 输入框右侧内嵌登录按钮（按钮矩形完全落在输入框内）',
    login && login.inside === true, JSON.stringify({ input: login && login.input, go: login && login.go }));
  jian('③ 内嵌按钮文字不被截断，输入框右侧留白按按钮实际宽度让位',
    login && login.labelFits === true && login.padRight >= login.go.w + 12,
    JSON.stringify({ labelFits: login && login.labelFits, padRight: login && login.padRight, goW: login && login.go && login.go.w }));
  jian('③ 命中测试：按钮中心点到的是登录按钮，输入框左侧点到的是输入框',
    login && login.hitGo === true && login.hitInput === true, JSON.stringify({ hitGo: login && login.hitGo, hitInput: login && login.hitInput }));
  jian('③ 登录页更小（卡片 ≤ 420px、完整落在视口内）且无品牌/标题',
    login && login.card && login.card.w <= 420 && login.card.h <= login.vh && login.card.b <= login.vh
    && login.brand === false && login.title === false,
    JSON.stringify(login && { card: login.card, vw: login.vw, vh: login.vh, brand: login.brand, title: login.title }));
  jian('③ 登录页保留「返回首启语言页」', login && login.back === true);
  jian('③ 返回入口是明显的箭头图标（无可见文字、有 SVG、点击区 ≥28px）',
    login && login.back === true && login.backText === '' && login.backSvg === true
    && login.backBox && login.backBox.w >= 28 && login.backBox.h >= 28,
    JSON.stringify(login && { text: login.backText, svg: login.backSvg, box: login.backBox }));
  // 长语言（法语 Se connecter / 西语 Iniciar sesión）也要装得下：临时换文案触发重排
  const fit = await js(`(() => {
    const go = document.querySelector('.warmyAuthPinGo');
    const input = document.querySelector('#warmyAuthPin');
    const old = go.textContent;
    go.textContent = 'Se connecter';
    window.dispatchEvent(new Event('resize'));
    const g = go.getBoundingClientRect();
    const i = input.getBoundingClientRect();
    /** 首启会把窗口缩到屏幕内，卡片可能整体缩放：computed padding 是 CSS 像素，
     *  getBoundingClientRect 是屏幕像素。先换算到同一坐标系再比较（第 98 轮门禁修正）。 */
    const scale = input.offsetWidth ? i.width / input.offsetWidth : 1;
    const out = {
      w: Math.round(g.width), pad: Math.round(parseFloat(getComputedStyle(input).paddingRight) * scale),
      scale: Math.round(scale * 100) / 100,
      fits: go.scrollWidth <= go.clientWidth + 1,
      inside: g.left >= i.left && g.right <= i.right + 1,
    };
    go.textContent = old;
    window.dispatchEvent(new Event('resize'));
    return out;
  })()`);
  jian('③ 最长语言（Se connecter）也不截断、仍包在输入框内（右侧留白自动让位）',
    fit && fit.fits === true && fit.inside === true && fit.pad >= fit.w + 12 * (fit.scale || 1), JSON.stringify(fit));
  await c.snap(path.join(SHOT, '03-login.png'));

  /* ── 注册：⑥ 12/24 + ⑦ 同行两行 + 不出屏 ─────────────────────── */
  await c.clickUntil('[data-auth-action="register-open"]', '!!document.querySelector(".warmyAuthMnemonic")', { timeout: 8000 });
  await sleep(250);
  const mnRead = () => js(`(() => {
    const cells = [...document.querySelectorAll('.warmyAuthMnemonic .warmyAuthWord')];
    const r = (e) => { const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), r: Math.round(b.right), b: Math.round(b.bottom), cy: Math.round(b.y + b.height / 2) }; };
    const grid = document.querySelector('.warmyAuthMnemonic');
    const card = document.querySelector('.warmyAuthCard');
    return {
      cls: grid ? grid.className : '',
      count: cells.length,
      indices: cells.map((e) => e.querySelector('.warmyAuthWordIndex')?.textContent.trim() || ''),
      words: cells.map((e) => e.querySelector('.warmyAuthWordText')?.textContent.trim() || ''),
      pinyins: cells.map((e) => e.querySelector('.warmyAuthWordPinyin')?.textContent.trim() || ''),
      covers: cells.map((e) => e.getAttribute('data-cover') || ''),
      pairs: cells.map((e) => e.getAttribute('data-pair') || ''),
      sameLine: cells.every((e) => {
        const i = e.querySelector('.warmyAuthWordIndex'); const w = e.querySelector('.warmyAuthWordText');
        if (!i || !w) return false;
        const a = i.getBoundingClientRect(); const b = w.getBoundingClientRect();
        return Math.abs((a.y + a.height / 2) - (b.y + b.height / 2)) <= 3 && a.x < b.x;
      }),
      twoLines: cells.every((e) => {
        const w = e.querySelector('.warmyAuthWordText'); const p = e.querySelector('.warmyAuthWordPinyin');
        if (!w || !p) return true;
        const a = w.getBoundingClientRect(); const b = p.getBoundingClientRect();
        return b.top >= a.bottom - 2 && Math.abs(b.x - a.x) <= 2;
      }),
      gridBox: r(grid), cardBox: r(card), vw: innerWidth, vh: innerHeight,
    };
  })()`);
  const mn2 = await mnRead();
  jian('⑥ 词组模式 24 格（1–24 序号，每格都是真实两字词）',
    mn2 && mn2.count === 24 && mn2.indices.join(',') === Array.from({ length: 24 }, (_, i) => String(i + 1)).join(',')
    && mn2.words.every((w) => Array.from(w).length === 2 && /^[\u4e00-\u9fff]+$/.test(w)),
    JSON.stringify({ count: mn2 && mn2.count, words: mn2 && mn2.words.slice(0, 4) }));
  jian('⑦ 序号与中文词同一行，拼音在第二行（每条两行）',
    mn2 && mn2.sameLine === true && mn2.twoLines === true,
    JSON.stringify({ sameLine: mn2 && mn2.sameLine, twoLines: mn2 && mn2.twoLines }));
  jian('⑦ 助记词区与卡片都不高出屏幕（超出只在自己框里滚动）',
    mn2 && mn2.cardBox.b <= mn2.vh + 1 && mn2.gridBox.b <= mn2.vh + 1,
    JSON.stringify({ card: mn2 && mn2.cardBox, grid: mn2 && mn2.gridBox, vh: mn2 && mn2.vh }));
  const wordsBefore = mn2 ? mn2.words.slice() : [];
  await c.snap(path.join(SHOT, '04-mnemonic-words.png'));

  // 小窗口（1024×640）也不能高出屏幕：卡片/助记词区上限 + 自己滚
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 640, deviceScaleFactor: 1, mobile: false });
  await sleep(350);
  const small = await mnRead();
  jian('⑦ 1024×640 小窗口里助记词仍不出屏（序号仍与词同行）',
    small && small.cardBox.b <= 641 && small.gridBox.b <= 641 && small.sameLine === true,
    JSON.stringify({ card: small && small.cardBox, grid: small && small.gridBox, sameLine: small && small.sameLine }));
  await c.snap(path.join(SHOT, '04b-mnemonic-small.png'));
  await c.send('Emulation.clearDeviceMetricsOverride');
  await sleep(300);

  await c.clickUntil('[data-auth-action="pinyin-group"][data-group="4"]', 'document.querySelectorAll(".warmyAuthWord").length === 12', { timeout: 4000 });
  await sleep(200);
  const mn4 = await mnRead();
  jian('⑥ 成语模式只显示 12 格，序号是 1-2 / 3-4 … 23-24（每格覆盖 2 个 BIP-39 索引）',
    mn4 && mn4.count === 12
    && mn4.indices.join(',') === Array.from({ length: 12 }, (_, k) => `${2 * k + 1}-${2 * k + 2}`).join(',')
    && mn4.covers.join(',') === Array.from({ length: 12 }, (_, k) => `${2 * k + 1},${2 * k + 2}`).join(','),
    JSON.stringify({ count: mn4 && mn4.count, indices: mn4 && mn4.indices, covers: mn4 && mn4.covers }));
  jian('⑥ 12 格都是真实四字成语；data-pair 里保留一对两个成语（不丢词）',
    mn4 && mn4.words.every((w) => Array.from(w).length === 4 && /^[\u4e00-\u9fff]+$/.test(w))
    && mn4.pairs.every((p) => p.split('|').filter(Boolean).length === 2 && p.split('|').every((w) => Array.from(w).length === 4)),
    JSON.stringify({ words: mn4 && mn4.words.slice(0, 4), pairs: mn4 && mn4.pairs.slice(0, 2) }));
  jian('⑦ 成语模式同样是「序号+词 / 拼音」两行，且不出屏',
    mn4 && mn4.sameLine === true && mn4.twoLines === true
    && mn4.cardBox.b <= mn4.vh + 1 && mn4.gridBox.b <= mn4.vh + 1,
    JSON.stringify({ sameLine: mn4 && mn4.sameLine, twoLines: mn4 && mn4.twoLines, card: mn4 && mn4.cardBox, vh: mn4 && mn4.vh }));
  await c.snap(path.join(SHOT, '05-mnemonic-idioms.png'));

  await c.clickUntil('[data-auth-action="pinyin-group"][data-group="2"]', 'document.querySelectorAll(".warmyAuthWord").length === 24', { timeout: 4000 });
  await sleep(150);
  const mn2b = await mnRead();
  jian('⑥ 切回词组仍是同一份 24 个词、顺序不变（12 格只是展示折叠）',
    mn2b && mn2b.count === 24 && mn2b.words.join(' ') === wordsBefore.join(' '),
    JSON.stringify({ a: wordsBefore.slice(0, 4), b: mn2b && mn2b.words.slice(0, 4) }));

  /* ── 完成注册（PIN 登录，不勾自动登录） ───────────────────────── */
  await c.clickUntil('[data-auth-action="mnemonic-confirm"]', '!!document.querySelector(".warmyAuthModal")', { timeout: 4000 });
  await c.clickUntil('[data-modal="ok"]', '!!document.querySelector("#warmyAuthPin1")', { timeout: 6000 });
  await js(`(() => {
    const set = (id, v) => { const e = document.getElementById(id); const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(e, v); e.dispatchEvent(new Event('input', { bubbles: true })); };
    set('warmyAuthPin1', 'Test1234'); set('warmyAuthPin2', 'Test1234'); return true;
  })()`);
  await c.clickUntil('[data-auth-action="pin-submit"]', '!!document.querySelector("#warmyAuthUsername")', { timeout: 10000 });
  await c.clickUntil('[data-auth-action="username-finish"]', 'document.getElementById("warmyAuthGate").classList.contains("warmyAuthHidden")', { timeout: 12000 });
  await sleep(400);

  /* ⑧ 旧 spotlight 漫游引导已在第 98 轮整体删除；新清单由 verify-r98-onboarding 覆盖。 */

  /* ── ③ 登录 → 返回语言页 → 再回登录 → 内嵌按钮命中登录 ──────── */
  await c.clickUntil('[data-nav="wo"]', '!!document.querySelector("#warmyAuthMyCard .warmyAuthMyButtons")', { timeout: 10000 });
  await sleep(300);
  await c.clickUntil('[data-my-action="logout"]', '!!document.querySelector(".warmyAuthModal [data-modal=ok]")', { timeout: 6000 });
  // 点「退出账号」→ 确认 → 真机上会 reload：等到**新文档**的登录页就绪（PIN 已启用）再断言。
  // 每次重试都重新取按钮中心；reload 慢时不至于把后续点击打到新页面别的元素上。
  await js('document.querySelector(".warmyAuthModal [data-modal=\"ok\"]")?.click(); true');
  await sleep(4000);
  try { child.kill('SIGKILL'); } catch { /* 已退出 */ }
  child = spawnChild();
  if (!(await waitCdp())) throw new Error('logout 后重启未起 CDP');
  c = await attach(PORT, { biaoQian: 'after-logout', callTimeout: 15000 });
  await c.waitFor('!!document.querySelector("#warmyAuthPin") && !document.querySelector("#warmyAuthPin").disabled && !!document.querySelector("[data-auth-action=login-lang-back]")', { timeout: 30000 });
  const okRes = { ok: true, trail: ['relaunch + reattach'] };
  await sleep(800);
  const afterLogout = await js(`(async () => {
    const st = await window.warmy.authState();
    const el = document.querySelector('#warmyAuthPin');
    return { st, pin: !!el, disabled: !!(el && el.disabled), back: !!document.querySelector('[data-auth-action="login-lang-back"]'), body: (document.body.innerText || '').slice(0, 160) };
  })()`);
  jian('③ 退出后回到登录页，PIN 可用且能看到返回语言页',
    afterLogout && afterLogout.pin === true && afterLogout.disabled === false && afterLogout.back === true,
    JSON.stringify({ afterLogout, trail: okRes.trail }));
  await c.snap(path.join(SHOT, '03b-login-account.png'));

  await c.clickUntil('[data-auth-action="login-lang-back"]', 'document.querySelectorAll(".warmyAuthLangTile").length === 10', { timeout: 5000 });
  jian('③ 登录页的返回按钮真的回到首启语言页（10 个平铺语言块）',
    await js(`document.querySelectorAll('.warmyAuthLangTile').length === 10 && !document.querySelector('#warmyAuthPin')`));
  await c.clickUntil('#warmyAuthStart', '!!document.querySelector("#warmyAuthTermsBody")', { timeout: 8000 });
  await js(`(() => { const b=document.querySelector('#warmyAuthTermsBody'); b.scrollTop=b.scrollHeight; b.dispatchEvent(new Event('scroll')); return b.scrollTop; })()`);
  await sleep(3200);
  await c.clickUntil('#warmyAuthTermsContinue', '!!document.querySelector("#warmyAuthPin")', { timeout: 8000 });
  await sleep(250);
  jian('③ 从语言页再走一遍条款仍能回到登录页（返回不是死路）',
    await js(`!!document.querySelector('#warmyAuthPin') && !document.querySelector('#warmyAuthGate').classList.contains('warmyAuthHidden')`));

  await js(`(() => {
    const e = document.querySelector('#warmyAuthPin');
    const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    s.call(e, 'Wrong999'); e.dispatchEvent(new Event('input', { bubbles: true })); return true;
  })()`);
  await c.clickUntil('[data-auth-action="login-pin"]', '!!document.querySelector(".warmyAuthError")', { timeout: 12000 });
  const wrong = await js(`(() => ({ err: document.querySelector('.warmyAuthError')?.textContent.trim() || '', still: !!document.querySelector('#warmyAuthPin') }))()`);
  jian('③ 内嵌按钮真的提交登录：错 PIN 给出错误且仍在登录页', wrong && wrong.still === true && wrong.err.length > 0, JSON.stringify(wrong));
  await js(`(() => {
    const e = document.querySelector('#warmyAuthPin');
    const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    s.call(e, 'Test1234'); e.dispatchEvent(new Event('input', { bubbles: true })); return true;
  })()`);
  await c.clickUntil('[data-auth-action="login-pin"]', 'document.getElementById("warmyAuthGate").classList.contains("warmyAuthHidden")', { timeout: 15000 });
  const logged = await js(`(async () => { const st = await window.warmy.authState(); return { unlocked: st.unlocked === true, pin: st.pinConfigured === true }; })()`);
  jian('③ 正确 PIN 用内嵌按钮登录成功（点击命中不是装饰）', logged && logged.unlocked === true && logged.pin === true, JSON.stringify(logged));

  /* ── ① 我的页自动登录二次确认：取消保持未勾选 / 确认才开启 ──── */
  await c.clickUntil('[data-nav="wo"]', '!!document.querySelector("#warmyAuthMyCard .warmyAuthMyButtons")', { timeout: 10000 });
  await sleep(300);
  await c.evaluate(`document.querySelector('#warmyMyAuto').click()`);
  await c.waitFor('!!document.querySelector(".warmyAuthModal [data-modal=ok]")', { timeout: 5000, biaoQian: '自动登录确认弹层' });
  const confirmDlg = await js(`(() => ({
    title: document.querySelector('.warmyAuthModal .warmyAuthTitle')?.textContent.trim() || '',
    body: document.querySelector('.warmyAuthModalBody')?.textContent.trim() || '',
    ok: document.querySelector('.warmyAuthModal [data-modal=ok]')?.textContent.trim() || '',
    checked: document.querySelector('#warmyMyAuto')?.checked === true,
  }))()`);
  jian('① 勾选「自动登录」先弹二次确认（有标题/正文/确认按钮）',
    confirmDlg && confirmDlg.title.length > 0 && confirmDlg.body.length > 0 && confirmDlg.ok.length > 0,
    JSON.stringify(confirmDlg));
  await c.snap(path.join(SHOT, '07-auto-confirm.png'));
  await c.clickUntil('.warmyAuthModal [data-modal="cancel"]', '!document.querySelector(".warmyAuthModal")', { timeout: 4000 });
  await sleep(400);
  const cancelled = await js(`(async () => {
    const st = await window.warmy.authState();
    return { checked: document.querySelector('#warmyMyAuto')?.checked === true, autoLogin: st.autoLogin === true, pin: st.pinConfigured === true };
  })()`);
  jian('① 取消确认后保持未勾选，认证库里的自动登录仍是关（PIN 不受影响）',
    cancelled && cancelled.checked === false && cancelled.autoLogin === false && cancelled.pin === true,
    JSON.stringify(cancelled));

  await c.evaluate(`document.querySelector('#warmyMyAuto').click()`);
  await c.waitFor('!!document.querySelector(".warmyAuthModal [data-modal=ok]")', { timeout: 5000, biaoQian: '再次确认弹层' });
  await c.clickUntil('.warmyAuthModal [data-modal="ok"]', 'document.querySelector("#warmyMyAuto")?.checked === true && document.querySelector("[data-my-action=change-pin]")?.disabled === true', { timeout: 12000 });
  const enabled = await js(`(async () => { const st = await window.warmy.authState(); return { checked: document.querySelector('#warmyMyAuto')?.checked === true, autoLogin: st.autoLogin === true }; })()`);
  jian('① 确认后真的开启自动登录（勾选框选中、authState.autoLogin=true）',
    enabled && enabled.checked === true && enabled.autoLogin === true, JSON.stringify(enabled));

  // R78 #9：取消自动登录先弹 PIN 设置；取消弹窗 ⇒ 自动登录保持开启
  await c.evaluate(`document.querySelector('#warmyMyAuto').click()`);
  await c.waitFor('!!document.querySelector("#warmyChangePin1")', { timeout: 5000, biaoQian: '取消自动登录的 PIN 弹窗' });
  await c.clickUntil('.warmyAuthModal [data-modal="cancel"]', '!document.querySelector(".warmyAuthModal")', { timeout: 4000 });
  await sleep(400);
  const pinCancel = await js(`(async () => { const st = await window.warmy.authState(); return { checked: document.querySelector('#warmyMyAuto')?.checked === true, autoLogin: st.autoLogin === true }; })()`);
  jian('① 取消 PIN 设置后自动登录仍保持开启', pinCancel && pinCancel.checked === true && pinCancel.autoLogin === true, JSON.stringify(pinCancel));
  // 成功设置 PIN 后才真正关闭自动登录
  await c.evaluate(`document.querySelector('#warmyMyAuto').click()`);
  await c.waitFor('!!document.querySelector("#warmyChangePin1")', { timeout: 5000, biaoQian: '再次打开 PIN 弹窗' });
  await c.evaluate(`(() => {
    const set = (id, v) => { const e = document.getElementById(id); const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(e, v); e.dispatchEvent(new Event('input', { bubbles: true })); };
    set('warmyChangePin1', 'Pin12345'); set('warmyChangePin2', 'Pin12345');
    return true;
  })()`);
  await c.clickUntil('.warmyAuthModal [data-modal="ok"]', '!document.querySelector(".warmyAuthModal")', { timeout: 10000 });
  await c.waitFor('document.querySelector("#warmyMyAuto")?.checked === false', { timeout: 8000, biaoQian: 'PIN 成功后关闭自动登录' });
  const pinSet = await js(`(async () => { const st = await window.warmy.authState(); return { checked: document.querySelector('#warmyMyAuto')?.checked === true, autoLogin: st.autoLogin === true, pin: st.pinConfigured === true }; })()`);
  jian('① 设置 PIN 成功后自动登录才关闭', pinSet && pinSet.checked === false && pinSet.autoLogin === false && pinSet.pin === true, JSON.stringify(pinSet));

  const errs = c.errors();
  jian('全流程无渲染层脚本/控制台错误', errs.length === 0, JSON.stringify(errs.slice(0, 3)));

  console.log('\n  · 截图目录：' + SHOT);
} catch (e) {
  hong.push('未捕获异常');
  console.log('  FAIL 未捕获异常 ← ' + String((e && (e.stack || e.message)) || e).slice(0, 500));
} finally {
  try { await guan(); } catch { /* noop */ }
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
}
console.log(`\n==== verify-r78-auth-tour：${ok} ok / ${hong.length} FAIL ====`);
process.exit(hong.length ? 1 : 0);
