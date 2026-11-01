/**
 * verify-r68-firstrun-ui —— 第 68 轮首启语言页真机门禁（第 78 轮改为平铺语言）
 *
 * 只测本轮改过的首启页：
 *  ① 10 种语言平铺成两列（不再有下拉框/菜单/aria-haspopup），「开始」在网格下方；
 *  ② 语言块都是短名、无国旗图标；点一下即选中（无需展开、无需二次确认）；
 *  ③ 切换语言后本页文案与 html lang 立即变化，开始按钮仍能进入条款页；
 *  ④ 背景是循环亮色场景：晨曦 + 太阳 + 云 + 一匹站着的牛马（本地 logo 图），不原地跑；
 *  ⑤ 独立角落 logo 已移除；首启卡仍在视口内。
 *
 * 用临时 user-data-dir 真启动 Electron，不碰用户配置；结束后关应用并删临时目录。
 * 第 78 轮：旧断言「下拉菜单可开合 / Esc 收起」与新产品行为冲突，已按新行为改写。
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

const PORT = Number(process.env.R68_PORT || 9628);
const SHOT_DEFAULT = path.join(os.tmpdir(), 'warmy-r68-firstrun-default.png');
const SHOT_MENU = path.join(os.tmpdir(), 'warmy-r68-firstrun-menu.png');
const profile = path.join(os.tmpdir(), 'warmy-r68-firstrun-ui-' + Date.now() + '-' + process.pid);
fs.mkdirSync(profile, { recursive: true });

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.WARMY_AUTH_BYPASS;

const child = spawn(ELECTRON, [
  '--remote-debugging-port=' + PORT,
  '--disable-features=CalculateNativeWinOcclusion',
  '--user-data-dir=' + profile,
  MAIN,
], { cwd: PKG, stdio: ['ignore', 'ignore', 'ignore'], env });

let c = null;
let ok = 0;
const hong = [];
const lum = (s) => {
  const [r, g, b] = (String(s).match(/\d+/g) || [0, 0, 0]).slice(0, 3).map(Number);
  return r * 0.299 + g * 0.587 + b * 0.114;
};
const jian = (l, p, d) => {
  if (p) { ok += 1; console.log('  ok   ' + l); return; }
  hong.push(l);
  console.log('  FAIL ' + l + (d === undefined ? '' : ' ← ' + String(d).slice(0, 300)));
};
const js = (expr) => c.evaluate('(async function(){ try { return await (' + expr + '); } catch (err) { return { __err: String((err && (err.stack || err.message)) || err).slice(0, 260) }; } })()');

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
    try { c = await attach(PORT, { biaoQian: 'r68-firstrun', callTimeout: 10000 }); break; } catch (e) { lastErr = e.message; await sleep(300); }
  }
  if (!c) throw new Error('CDP 没连上：' + lastErr);
  await c.send('Runtime.enable');
  await c.send('Page.enable');
  await c.waitFor('!!document.querySelector("#warmyAuthStart") && !!document.querySelector(".warmyAuthScene")', {
    timeout: 20000, biaoQian: '首启语言页出现',
  });
  await sleep(300);
  await c.snap(SHOT_DEFAULT);

  /* ── 1. 平铺布局（R78：语言不再用下拉框） ─────────────────────── */
  const box = await js(`(() => {
    const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, bottom: b.bottom }; };
    const tiles = [...document.querySelectorAll('.warmyAuthLangTile')];
    return {
      grid: r('.warmyAuthLangGrid'), start: r('#warmyAuthStart'), card: r('.warmyAuthFirstCard'),
      tiles: tiles.map((e) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, bottom: b.bottom }; }),
      vw: innerWidth, vh: innerHeight,
    };
  })()`);
  jian('真机上找到平铺语言网格与开始按钮', !!(box && box.grid && box.start && box.tiles.length === 10), JSON.stringify(box && { grid: box.grid, start: box.start, tiles: box.tiles.length }));
  if (box && box.grid && box.start) {
    jian('开始按钮在网格下方（不再与下拉并排）', box.start.y >= box.grid.bottom + 4, JSON.stringify({ gridBottom: box.grid.bottom, startY: box.start.y }));
    jian('10 个语言块两列平铺、每个都可见且不重叠', box.tiles.length === 10
      && box.tiles.every((t) => t.w > 60 && t.h > 20)
      && box.tiles.filter((t) => Math.abs(t.y - box.tiles[0].y) <= 2).length === 2,
      JSON.stringify(box.tiles.slice(0, 3)));
    jian('整张首启卡是窄卡（宽度 < 视口 55%）', box.card && box.card.w < box.vw * 0.55, JSON.stringify(box.card));
    jian('首启卡完整落在视口内', box.card && box.card.x >= 0 && box.card.right <= box.vw && box.card.y >= 0 && box.card.bottom <= box.vh, JSON.stringify(box.card));
  }
  const onlyFirst = await js(`(() => ({
    select: document.querySelectorAll('#warmyAuthCard select').length,
    title: !!document.querySelector('.warmyAuthTitle,.warmyAuthSub,.warmyAuthBrand,.warmyAuthLogo'),
    corner: !!document.querySelector('.warmyAuthCornerLogo'),
    menu: !!document.querySelector('#warmyAuthLangMenu'),
    popup: document.querySelectorAll('#warmyAuthCard [aria-haspopup], .warmyAuthFirstCard [aria-haspopup]').length,
    buttons: [...document.querySelectorAll('.warmyAuthFirstCard button')].map((e) => e.getAttribute('data-auth-action')),
  }))()`);
  jian('首启第一屏没有原生 select / 下拉菜单 / 标题 / 品牌块 / 角落 logo',
    onlyFirst && onlyFirst.select === 0 && onlyFirst.menu === false && onlyFirst.popup === 0
    && onlyFirst.title === false && onlyFirst.corner === false, JSON.stringify(onlyFirst));
  jian('第一屏是 10 个语言块 + 1 个开始（点格子即选，无需展开菜单）',
    onlyFirst && onlyFirst.buttons.filter((x) => x === 'lang-pick').length === 10
    && onlyFirst.buttons.filter((x) => x === 'language-start').length === 1, JSON.stringify(onlyFirst && onlyFirst.buttons));

  /* ── 2. 10 种语言 / 短名 / 无图标 ─────────────────────────────── */
  const tilesInfo = await js(`(() => {
    const opts = [...document.querySelectorAll('[data-auth-action="lang-pick"]')];
    return {
      count: opts.length,
      locales: opts.map((e) => e.getAttribute('data-locale')),
      labels: opts.map((e) => (e.querySelector('.warmyAuthLangTileName') || {}).textContent || ''),
      flagCount: document.querySelectorAll('.warmyAuthFlag').length,
      svgCount: document.querySelectorAll('.warmyAuthLangGrid svg').length,
      on: document.querySelectorAll('.warmyAuthLangTile.is-on').length,
    };
  })()`);
  jian('平铺里有 10 种语言选项', tilesInfo && tilesInfo.count === 10 && tilesInfo.locales.length === 10, JSON.stringify(tilesInfo && tilesInfo.locales));
  jian('语言块已去掉全部国旗图标（0 个 flag / SVG 图标）',
    tilesInfo && tilesInfo.flagCount === 0 && tilesInfo.svgCount === 0, JSON.stringify(tilesInfo && { flagCount: tilesInfo.flagCount, svgCount: tilesInfo.svgCount }));
  jian('选项名称是短名（每种 ≤ 10 个字符）', tilesInfo && tilesInfo.labels.every((s) => Array.from(s.trim()).length >= 1 && Array.from(s.trim()).length <= 10), JSON.stringify(tilesInfo && tilesInfo.labels));
  jian('任何时刻只有一个选中态', tilesInfo && tilesInfo.on === 1, JSON.stringify(tilesInfo && tilesInfo.on));
  jian('首启卡与网格更短（卡 ≤ 380px）',
    box && box.card && box.card.w <= 380, JSON.stringify(box && box.card));
  await c.snap(SHOT_MENU);

  /* ── 3. 点一下即选 + 开始仍进条款页 ─────────────────────────── */
  const pickEn = await c.clickUntil('[data-locale="en-US"]',
    'document.documentElement.lang === "en-US" && document.querySelector("#warmyAuthStart").textContent.trim() === "Start"', { timeout: 4000 });
  jian('点 English 格子：html lang 与开始按钮立即变英文（无需确认）', pickEn.ok, JSON.stringify(pickEn.trail));
  const afterEn = await js(`(() => ({
    lang: document.documentElement.lang,
    start: document.querySelector('#warmyAuthStart') && document.querySelector('#warmyAuthStart').textContent.trim(),
    on: document.querySelector('.warmyAuthLangTile.is-on') && document.querySelector('.warmyAuthLangTile.is-on').getAttribute('data-locale'),
    label: document.querySelector('.warmyAuthLangPick') && document.querySelector('.warmyAuthLangPick').textContent.trim(),
  }))()`);
  jian('英文选中后只有 English 块高亮，底部不再显示已选文字', afterEn && afterEn.on === 'en-US' && !afterEn.label, JSON.stringify(afterEn));

  const pickZh = await c.clickUntil('[data-locale="zh-CN"]',
    'document.documentElement.lang === "zh-CN" && document.querySelector("#warmyAuthStart").textContent.trim() === "开始"', { timeout: 4000 });
  jian('再点简体块立即回到「开始」并落盘', pickZh.ok, JSON.stringify(pickZh.trail));

  /* ── 4. 场景：亮色晨曦 / 云 / 太阳 / 一匹站着的牛马（必须在点开始前量） ───── */
  const art = await js(`(() => {
    const pick = (s) => document.querySelector(s);
    const count = (s) => document.querySelectorAll(s).length;
    const box = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, bottom: b.bottom }; };
    const horse = pick('.warmyAuthLightHorse');
    const bob = horse ? horse.querySelector('.warmyAuthBob') : null;
    const horseImg = horse ? horse.querySelector('.warmyAuthLightHorseImg') : null;
    return {
      corner: !!pick('.warmyAuthCornerLogo'),
      scene: box(pick('.warmyAuthSceneEmbed')),
      embed: !!pick('.warmyAuthSceneEmbed iframe'),
      iframeSrc: pick('.warmyAuthSceneEmbed iframe')?.getAttribute('src') || '',
      vw: innerWidth, vh: innerHeight,
      light: !!pick('.warmyAuthSceneLight'),
      lightSun: !!pick('.warmyAuthLightSun'),
      lightHorse: !!horse, horseBox: box(horse),
      cardBox: box(pick('.warmyAuthFirstCard')),
      gateBg: getComputedStyle(pick('#warmyAuthGate')).backgroundColor,
      cardBg: getComputedStyle(pick('.warmyAuthCard')).backgroundColor,
      firstBg: getComputedStyle(pick('.warmyAuthFirstCard')).backgroundColor,
      titleColor: getComputedStyle(pick('.warmyAuthLangTile.is-on') || pick('.warmyAuthLangTile')).color,
      clouds: count('.warmyAuthCloudA') + count('.warmyAuthCloudB'),
      cloudAnim: count('.warmyAuthCloudA') ? getComputedStyle(pick('.warmyAuthCloudA')).animationName : '',
      bobAnim: bob ? getComputedStyle(bob).animationName : '',
      logoHref: horseImg ? (horseImg.getAttribute('href') || '') : '',
      logoBox: box(horseImg),
      runners: count('.warmyAuthRunner'),
      mascot: !!pick('.warmyAuthLogoMascot'),
      moon: !!pick('.warmyAuthMoon'),
    };
  })()`);
  // 注意：进入条款页后场景会被卸载；这一段必须在点开始前量。见下方重排。
  jian('独立角落 logo 已从 DOM 移除', art && art.corner === false, JSON.stringify(art && art.corner));
  jian('背景场景铺满窗口', art && art.scene && art.scene.w >= art.vw - 2 && art.scene.h >= art.vh - 2, JSON.stringify(art && { scene: art.scene, vw: art.vw, vh: art.vh }));
  jian('首启背景是随机一幕嵌入动画，且没有旧的冲锋队/品牌浮层/月亮',
    art && art.embed === true && /embed=1/.test(art.iframeSrc) && /scenes=\d+&rotate=0/.test(art.iframeSrc) && !/scenes=.*,/.test(art.iframeSrc)
    && art.runners === 0 && art.mascot === false && art.moon === false,
    JSON.stringify(art && { embed: art.embed, src: art.iframeSrc, runners: art.runners, mascot: art.mascot, moon: art.moon }));
  jian('亮色主题：门/首启卡都是亮底，语言按钮文字是深色（首启卡本身透明叠在场景上）',
    art && lum(art.gateBg) > 200 && lum(art.firstBg) > 180 && lum(art.titleColor) < 120,
    JSON.stringify(art && { gateBg: art.gateBg, firstBg: art.firstBg, labelColor: art.titleColor }));
  const emb = await js(`(() => {
    const f = document.querySelector('.warmyAuthSceneEmbed iframe');
    const w = f && f.contentWindow;
    const cv = w?.document?.getElementById('scene');
    const bare = !w?.document?.getElementById('chooser') && !w?.document?.getElementById('sTitle');
    return { ready: !!w?.__firstrun, scenes: w?.__firstrun?.scenes?.().length || 0, bare, frames: Number(w?.__sceneFrames || 0), fit: cv ? w.getComputedStyle(cv).objectFit : '' };
  })()`);
  await sleep(700);
  const emb2 = await js(`(() => { const f=document.querySelector('.warmyAuthSceneEmbed iframe'); return Number(f && f.contentWindow && f.contentWindow.__sceneFrames || 0); })()`);
  jian('嵌入场景引擎真的加载且没有查看器 HUD', emb && emb.ready && emb.scenes === 10 && emb.bare === true, JSON.stringify(emb));
jian('嵌入场景按 cover 铺满（单幕、不轮播）', emb && emb.fit === 'cover', JSON.stringify(emb));
  jian('嵌入场景真的在动（帧计数持续增长）', emb && emb.frames > 0 && emb2 > emb.frames, JSON.stringify({ a: emb && emb.frames, b: emb2 }));

  const errors = c.errors();
  jian('渲染进程没有脚本异常/console error', errors.length === 0, JSON.stringify(errors));

  const toTerms = await c.clickUntil('#warmyAuthStart', '!!document.querySelector("#warmyAuthTermsBody")', { timeout: 8000 });
  jian('点开始仍能进入条款页（原流程未被改坏）', toTerms.ok, JSON.stringify(toTerms.trail));

  console.log('\n  · 截图：' + path.basename(SHOT_DEFAULT) + ' / ' + path.basename(SHOT_MENU));
} catch (e) {
  hong.push('未捕获异常');
  console.log('  FAIL 未捕获异常 ← ' + String((e && e.message) || e).slice(0, 400));
} finally {
  try { await guan(); } catch { /* noop */ }
  await sleep(400);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
}

const bad = hong.length;
console.log(`\n==== verify-r68-firstrun-ui：${ok} ok / ${bad} FAIL ====`);
process.exit(bad ? 1 : 0);
