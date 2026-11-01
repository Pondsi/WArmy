/**
 * verify-r68-charge-preview —— 牛马冲锋十幕概念预览（第 71 轮重做）
 *
 * 静态：十幕齐全、标题/短名唯一、每幕有一个牛马剪影与足够长的副标题；
 *       页面只引用本地 engine.js/scenes.js；画布 1280×720、pixelated；
 *       没有全屏模糊/扫描线/暗角；没有屏幕震动/闪电/爆燃/扬尘。
 * 真机：Electron 打开 preview/charge-scenes/index.html，逐个点选 10 幕，
 *       检查标题/选中态/画布色彩丰富、亮度分布有对比、边缘清晰、动画在动但不过度；
 *       键盘 1–0 与左右键切换；无控制台错误；每幕截图留在 %TEMP% 供人工复核。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(ROOT, 'preview', 'charge-scenes');
const PKG = path.join(ROOT, 'packages', 'app-shell');
const ELECTRON = path.join(PKG, 'node_modules', 'electron', 'dist', 'electron.exe');
const TITLES = [
  '星河 · 跃迁', '千军 · 独影', '高岭 · 天梯', '巨树 · 攀登', '深海 · 孤航',
  '大漠 · 风碑', '极夜 · 极光', '熔心 · 彼岸', '云海 · 天关', '顿悟 · 倒影',
];
const SHORTS = ['星河', '千军', '天梯', '巨树', '深海', '风碑', '极夜', '熔心', '天关', '顿悟'];
const PORT = Number(process.env.R71_PREVIEW_PORT || 9704);
const profile = path.join(os.tmpdir(), 'warmy-r71-charge-' + Date.now());
const main = path.join(os.tmpdir(), 'warmy-r71-charge-main-' + Date.now() + '.cjs');
const shotDir = path.join(os.tmpdir(), 'warmy-r71-charge-shots');
fs.mkdirSync(profile, { recursive: true });
fs.mkdirSync(shotDir, { recursive: true });

let ok = 0;
const hong = [];
const jian = (name, pass, detail) => {
  if (pass) { ok += 1; console.log('  ok   ' + name); return; }
  hong.push(name);
  console.log('  FAIL ' + name + (detail === undefined ? '' : ' ← ' + String(detail).slice(0, 420)));
};

const rd = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const index = rd(path.join(DIR, 'index.html'));
const engine = rd(path.join(DIR, 'engine.js'));
const scenesSrc = rd(path.join(DIR, 'scenes.js'));
const chunks = scenesSrc.split('S.push({').slice(1);

/* ── 静态 ─────────────────────────────────────────────────────────── */
jian('十幕都在 scenes.js 里注册', chunks.length === 10, 'chunks=' + chunks.length);
jian('十幕标题与短名唯一且顺序正确',
  TITLES.every((t, i) => chunks[i] && new RegExp("title: '" + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'").test(chunks[i]))
  && SHORTS.every((s, i) => chunks[i] && new RegExp("short: '" + s + "'").test(chunks[i])),
  chunks.map((c) => (/title: '([^']+)'/.exec(c) || [])[1]).join(' | '));
jian('每幕都有足够具体的副标题与一个牛马剪影',
  chunks.every((c) => {
    const sub = (/sub: '([^']+)'/.exec(c) || [])[1] || '';
    return sub.length >= 24 && /A\.beast\(/.test(c);
  }),
  chunks.map((c) => ((/sub: '([^']+)'/.exec(c) || [])[1] || '').length).join(','));
jian('页面只加载本地 engine.js + scenes.js，无外链',
  /engine\.js/.test(index) && /scenes\.js/.test(index)
  && !/https?:\/\//.test(index) && !/https?:\/\//.test(engine) && !/https?:\/\//.test(scenesSrc));
jian('画布 1280×720、像素化且关闭平滑',
  /const VW = 1280/.test(engine) && /const VH = 720/.test(engine)
  && /image-rendering:\s*pixelated/.test(index)
  && /imageSmoothingEnabled = false/.test(engine));
jian('没有全屏模糊/扫描线/暗角（清晰度要求）',
  !/filter:\s*blur/.test(index) && !/backdrop-filter/.test(index)
  && !/scanlines/i.test(index) && !/vignette/i.test(index) && !/createRadialGradient/.test(engine));
jian('十幕都不使用屏幕震动/闪电/爆燃/扬尘',
  !/screenShake|lightningBolt|dustCloud|flame\(/.test(scenesSrc));
jian('选择条与键盘提示支持 10 幕',
  /chooser\.innerHTML = ''/.test(engine) && /dataset\.i/.test(engine)
  && /← → \/ 1–0/.test(index) && /key === '0' \? 10/.test(engine));

fs.writeFileSync(main, `const { app, BrowserWindow } = require('electron');
const path = require('node:path');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 1600, height: 900, backgroundColor: '#03050a', autoHideMenuBar: true, webPreferences: { contextIsolation: true, sandbox: true } });
  win.loadFile(path.join(process.env.CHARGE_PREVIEW_DIR, 'index.html'));
});
app.on('window-all-closed', () => app.quit());
`, 'utf8');

const { attach, sleep } = await import(pathToFileURL(path.join(PKG, 'scripts', 'cdp-lib.mjs')).href);
const env = { ...process.env, CHARGE_PREVIEW_DIR: DIR };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(ELECTRON, ['--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, main], {
  cwd: os.tmpdir(), stdio: ['ignore', 'ignore', 'ignore'], env,
});
let c = null;

async function startSample() {
  return c.evaluate(`(() => {
    const cv = document.getElementById('scene');
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    const px = []; const colors = new Set();
    let lit = 0; let sum = 0; let sum2 = 0; let n = 0; let edge = 0; let edgeN = 0;
    const W = cv.width;
    for (let i = 0; i < d.length; i += 32) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      px.push(r, g, b);
      const v = r + g + b;
      sum += v; sum2 += v * v; n += 1;
      if (v > 60) lit += 1;
      colors.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
    }
    for (let y = 0; y < cv.height; y += 4) {
      for (let x = 0; x < cv.width - 4; x += 4) {
        const i = (y * W + x) * 4;
        const j = i + 16;
        const a = d[i] + d[i + 1] + d[i + 2];
        const b2 = d[j] + d[j + 1] + d[j + 2];
        if (Math.abs(a - b2) > 48) edge += 1;
        edgeN += 1;
      }
    }
    const mean = sum / Math.max(1, n);
    const sd = Math.sqrt(Math.max(0, sum2 / Math.max(1, n) - mean * mean));
    window.__r71Snap = px;
    window.__r71Info = { colors: colors.size, lit: lit / Math.max(1, n), mean, sd, edge: edge / Math.max(1, edgeN) };
    return true;
  })()`);
}
async function finishSample() {
  return c.evaluate(`(() => {
    const cv = document.getElementById('scene');
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    const s = window.__r71Snap || [];
    let changed = 0; let delta = 0; let n = 0;
    for (let i = 0, j = 0; i < d.length && j + 2 < s.length; i += 32, j += 3) {
      if (s[j] !== d[i] || s[j + 1] !== d[i + 1] || s[j + 2] !== d[i + 2]) changed += 1;
      delta += Math.abs(s[j] - d[i]) + Math.abs(s[j + 1] - d[i + 1]) + Math.abs(s[j + 2] - d[i + 2]);
      n += 1;
    }
    return { ...(window.__r71Info || {}), changed: n ? changed / n : 0, meanDelta: n ? delta / n : 0 };
  })()`);
}

try {
  let last = '';
  for (let i = 0; i < 60; i++) {
    try { c = await attach(PORT, { biaoQian: 'r71-charge', callTimeout: 12000 }); break; } catch (e) { last = e.message; await sleep(300); }
  }
  if (!c) throw new Error('CDP 未连接：' + last);
  await c.send('Runtime.enable');
  await c.send('Page.enable');
  await c.waitFor('!!window.__charge && window.__charge.scenes().length === 10', { timeout: 20000, biaoQian: '十幕预览' });
  await sleep(800);
  const info = await c.evaluate(`(() => ({
    scenes: window.__charge.scenes(),
    buttons: [...document.querySelectorAll('#chooser button')].map((b) => b.textContent.trim()),
    overflow: document.getElementById('chooser').scrollWidth <= innerWidth + 1,
    canvas: { w: document.getElementById('scene').width, h: document.getElementById('scene').height },
    css: getComputedStyle(document.getElementById('scene')).imageRendering,
  }))()`);
  jian('页面加载十幕，标题/短名正确、选择条不横向溢出',
    info && info.scenes.length === 10 && info.scenes.every((s, i) => s.title === TITLES[i] && s.short === SHORTS[i])
    && info.buttons.length === 10 && info.overflow
    && info.canvas.w === 1280 && info.canvas.h === 720,
    JSON.stringify({ scenes: info && info.scenes.map((s) => s.title), buttons: info && info.buttons.length, overflow: info && info.overflow, canvas: info && info.canvas }));

  for (let i = 0; i < 10; i++) {
    await c.clickUntil(`#chooser button[data-i="${i}"]`, `window.__charge.current === ${i}`, { timeout: 5000 });
    await sleep(900);
    await startSample();
    await sleep(800);
    const a = await finishSample();
    const meta = await c.evaluate(`(() => ({
      title: document.getElementById('sTitle').textContent,
      sub: document.getElementById('sSub').textContent,
      index: document.getElementById('sIndex').textContent,
      on: document.querySelector('#chooser button.is-on')?.dataset.i,
      hash: location.hash,
    }))()`);
    jian(`第 ${i + 1} 幕「${TITLES[i]}」可选中、标题/副标题/序号正确`,
      meta && meta.title === TITLES[i] && meta.sub.length >= 24 && meta.index === String(i + 1).padStart(2, '0')
      && meta.on === String(i) && meta.hash === '#s' + (i + 1),
      JSON.stringify(meta));
    jian(`第 ${i + 1} 幕画面清晰有对比（颜色 ≥ 24、非黑 ≥ 35%、亮度标准差 ≥ 18、边缘密度 ≥ 0.6%）`,
      a.colors >= 24 && a.lit >= 0.35 && a.sd >= 18 && a.edge >= 0.006,
      JSON.stringify({ colors: a.colors, lit: Number(a.lit.toFixed(3)), sd: Number(a.sd.toFixed(1)), edge: Number(a.edge.toFixed(3)) }));
    jian(`第 ${i + 1} 幕是慢动画：在动但变化面积 < 40%、平均亮度变化 < 30`,
      a.changed > 0.0003 && a.changed < 0.4 && a.meanDelta < 30,
      JSON.stringify({ changed: Number(a.changed.toFixed(4)), meanDelta: Number(a.meanDelta.toFixed(2)) }));
    try {
      const shot = await c.send('Page.captureScreenshot', { format: 'png' }, { timeout: 8000 });
      if (shot && shot.data) fs.writeFileSync(path.join(shotDir, `scene-${String(i + 1).padStart(2, '0')}.png`), Buffer.from(shot.data, 'base64'));
    } catch { /* 截图失败不影响判定 */ }
  }

  await c.evaluate(`window.__charge.select(0)`);
  await sleep(500);
  await c.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))`);
  await sleep(600);
  const right = await c.evaluate('window.__charge.current');
  await c.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))`);
  await sleep(600);
  const left = await c.evaluate('window.__charge.current');
  await c.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '0' }))`);
  await sleep(700);
  const ten = await c.evaluate('window.__charge.current');
  await c.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }))`);
  await sleep(500);
  const one = await c.evaluate('window.__charge.current');
  jian('键盘左右键与数字 1/0 都能切换场景', right === 1 && left === 0 && ten === 9 && one === 0, JSON.stringify({ right, left, ten, one }));

  const errors = c.errors();
  jian('十幕切换与动画过程无脚本/控制台错误', errors.length === 0, JSON.stringify(errors));
  console.log('  shots: ' + shotDir);
} catch (e) {
  hong.push('未捕获异常');
  console.log('  FAIL 未捕获异常 ← ' + String((e && (e.stack || e.message)) || e).slice(0, 600));
} finally {
  try { if (c) await c.send('Browser.close', {}, { timeout: 5000 }); } catch { /* noop */ }
  await sleep(600);
  try { process.kill(child.pid, 0); execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* noop */ }
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
  try { fs.rmSync(main, { force: true }); } catch { /* noop */ }
}
console.log(`\n==== verify-r68-charge-preview：${ok} ok / ${hong.length} FAIL ====`);
process.exit(hong.length ? 1 : 0);
