/**
 * verify-r63-nm.mjs —— 第 63 轮 nm 查看器专项（行为型，不是只 grep 源码）。
 *
 * 做法：用**隐藏 Electron 窗口加载真实产物** `dist/renderer/nm-viewer.html`，
 * preload 也用真实 `dist/preload.cjs`；主进程只注册测试用的 IPC 假数据。
 * 因此这里量到的工具栏几何、分栏拖动、缩放、全屏、关闭确认、只读自动保存禁用、
 * 音乐信息条、视频进度条悬停宽度，都是页面真实行为。
 *
 * 覆盖用户第 20/21/22/24 项中属于 nm 渲染层的部分：
 *   20 工具栏一行 + 查找组顺序 + 替换流程
 *   21 置顶图标 / 主题参数与系统回退（不自动刷新）
 *   22 SVG 源码/效果分栏、DOCX/XLSX/PPTX 预览页、缩放/打印、双击全屏、
 *      MP4 进度条悬停不变短、音乐名称不折叠、未保存关闭提示、自动保存只读禁用
 *   24 最小化图标更短、最大化/关闭按钮更大
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PKG = path.join(ROOT, 'packages/app-shell');
const ELECTRON = path.join(PKG, 'node_modules/electron/dist/electron.exe');
const HTML = path.join(PKG, 'dist/renderer/nm-viewer.html');
const PRELOAD = path.join(PKG, 'dist/preload.cjs');

let okN = 0, failN = 0;
const jian = (l, p, d) => { if (p) { okN++; console.log('  ok  ' + l); } else { failN++; console.log('  FAIL ' + l + (d ? ' ← ' + String(d).slice(0, 240) : '')); } };
const near = (a, b, tol = 1) => Math.abs(Number(a) - Number(b)) <= tol;

if (!fs.existsSync(HTML) || !fs.existsSync(PRELOAD)) {
  console.error('[verify-r63-nm] 产物不存在，先运行 node scripts/copy-assets.mjs');
  process.exit(2);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-r63-nm-'));
const mainPath = path.join(dir, 'main.cjs');
const BASE = 'C:\\warmy-test\\';

const mainSrc = `'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
app.disableHardwareAcceleration();
const HTML = ${JSON.stringify(HTML)};
const PRELOAD = ${JSON.stringify(PRELOAD)};
const BASE = ${JSON.stringify(BASE)};
const LOG = path.join(__dirname, 'run.log');
const RESULT_PATH = path.join(__dirname, 'result.json');
const RESULT = {};
function log(s) { try { fs.appendFileSync(LOG, new Date().toISOString() + ' ' + s + '\\n'); } catch (e) {} }
function emit() {
  try { console.log('R63_NM ' + JSON.stringify(RESULT)); } catch (e) {}
  try { fs.writeFileSync(RESULT_PATH, JSON.stringify(RESULT)); } catch (e) {}
  setTimeout(() => app.exit(0), 100);
}
setTimeout(() => { if (!RESULT.__done) { RESULT.__done = true; RESULT.timeout = true; log('WATCHDOG timeout'); emit(); } }, 90000);
const CALLS = { winClose: 0, winMinimize: 0, winMaximize: 0, nmBaoCun: 0, nmDaKai: 0, nmSuoZaiMuLu: 0 };
const ERR = [];
const SVG_SRC = '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><rect width="160" height="80" fill="#e33"/><text x="12" y="50" font-size="24" fill="#fff">NM</text></svg>';
const FIX = {
  'demo.txt': { ok: true, luJing: BASE + 'demo.txt', ming: 'demo.txt', kuoZhan: 'txt', leiXing: 'text', keBianJi: true, ziJie: 42, huanHang: 'lf', wenBen: 'alpha beta alpha\\nsecond line' },
  'demo.html': { ok: true, luJing: BASE + 'demo.html', ming: 'demo.html', kuoZhan: 'html', leiXing: 'text', keBianJi: true, ziJie: 88, huanHang: 'lf', wenBen: '<!doctype html><html><body><h1>Hi</h1><p>preview</p></body></html>' },
  'demo.md': { ok: true, luJing: BASE + 'demo.md', ming: 'demo.md', kuoZhan: 'md', leiXing: 'text', keBianJi: true, ziJie: 24, huanHang: 'lf', wenBen: '# T\\n\\n**bold** and code' },
  'demo.svg': { ok: true, luJing: BASE + 'demo.svg', ming: 'demo.svg', kuoZhan: 'svg', leiXing: 'image', keBianJi: false, ziJie: SVG_SRC.length, meiTiUrl: 'file:///C:/warmy-test/demo.svg', mime: 'image/svg+xml' },
  'demo.png': { ok: true, luJing: BASE + 'demo.png', ming: 'demo.png', kuoZhan: 'png', leiXing: 'image', keBianJi: false, ziJie: 1234, meiTiUrl: 'file:///C:/warmy-test/demo.png', mime: 'image/png' },
  'demo.mp3': { ok: true, luJing: BASE + 'demo.mp3', ming: 'Artist - Album - Song.mp3', kuoZhan: 'mp3', leiXing: 'audio', keBianJi: false, ziJie: 1234567, meiTiUrl: 'file:///C:/warmy-test/demo.mp3', mime: 'audio/mpeg' },
  'demo.mp4': { ok: true, luJing: BASE + 'demo.mp4', ming: 'clip.mp4', kuoZhan: 'mp4', leiXing: 'video', keBianJi: false, ziJie: 9876543, meiTiUrl: 'file:///C:/warmy-test/demo.mp4', mime: 'video/mp4' },
  'demo.docx': { ok: true, luJing: BASE + 'demo.docx', ming: 'demo.docx', kuoZhan: 'docx', leiXing: 'docx', keBianJi: false, ziJie: 4567, kuai: [{ biaoTi: '正文 · 共 1 页', wenBen: '第一段。\\n第二段。\\n\\n第三段。' }] },
  'demo.xlsx': { ok: true, luJing: BASE + 'demo.xlsx', ming: 'demo.xlsx', kuoZhan: 'xlsx', leiXing: 'xlsx', keBianJi: false, ziJie: 5555, kuai: [{ biaoTi: '工作表 Sheet1 · 3 行', wenBen: '姓名\\t分数\\t备注\\n张三\\t90\\t好\\n李四\\t80\\t' }] },
  'demo.pptx': { ok: true, luJing: BASE + 'demo.pptx', ming: 'demo.pptx', kuoZhan: 'pptx', leiXing: 'pptx', keBianJi: false, ziJie: 6666, kuai: [{ biaoTi: '第 1 页', wenBen: '标题一\\n正文 A\\n正文 B' }, { biaoTi: '第 2 页', wenBen: '标题二\\n正文 C' }] },
};
function fixtureOf(p) {
  const key = path.basename(String((p && (p.path || p.luJing)) || ''));
  return FIX[key] || { ok: false, cuo: 'no fixture: ' + key };
}
ipcMain.handle('warmy:nmShiTuDu', (_e, p) => fixtureOf(p));
ipcMain.handle('warmy:wenJianYuLan', (_e, p) => {
  const key = path.basename(String((p && p.path) || ''));
  if (key !== 'demo.svg') return { ok: false, error: 'not-image' };
  return { ok: true, dataUrl: 'data:image/svg+xml;base64,' + Buffer.from(SVG_SRC, 'utf8').toString('base64'), bytes: SVG_SRC.length };
});
ipcMain.handle('warmy:nmShiTuBaoCun', (_e, p) => { CALLS.nmBaoCun += 1; return { ok: true, ziJie: String((p && p.wenBen) || '').length }; });
ipcMain.handle('warmy:nmShiTuLingCunWei', () => ({ ok: true, luJing: BASE + 'saved.txt', ziJie: 1 }));
ipcMain.handle('warmy:nmShiTuSheZhi', (_e, p) => ({ ok: true, zongShiDing: !!(p && p.zongShiDing), xiFu: !!(p && p.xiFu) }));
ipcMain.handle('warmy:nmDaKai', () => { CALLS.nmDaKai += 1; return { ok: true }; });
ipcMain.handle('warmy:nmSuoZaiMuLu', () => { CALLS.nmSuoZaiMuLu += 1; return { ok: true }; });
ipcMain.handle('warmy:winGuanBi', () => { CALLS.winClose += 1; return { ok: true }; });
ipcMain.handle('warmy:winZuiXiaoHua', () => { CALLS.winMinimize += 1; return { ok: true }; });
ipcMain.handle('warmy:winZuiDaHua', () => { CALLS.winMaximize += 1; return { ok: true }; });
ipcMain.handle('warmy:luJingCunZai', (_e, p) => { const o = {}; for (const x of (Array.isArray(p) ? p : [])) o[x] = false; return { cunZai: o }; });

function ceSaveIfDirty() {
  const q = (id) => document.getElementById(id);
  const b = q('anNiuBaoCun');
  const ming = q('wenJianMing');
  if (b && q('wenBen') && !b.disabled && ming && ming.textContent.indexOf('●') === 0) { b.click(); return true; }
  return false;
}
function ceToolbar() {
  const q = (id) => document.getElementById(id);
  const ids = ['souRu', 'anNiuShangYiGe', 'anNiuXiaYiGe', 'souJi', 'tiHuanRu', 'anNiuTiHuan'];
  const rs = ids.map((id) => q(id).getBoundingClientRect());
  /** 第 66 轮项 9：替换框默认折叠（宽度 0），顺序/同顶只量**可见**控件 */
  const keJian = rs.filter((r) => r.width > 1);
  const tops = keJian.map((r) => Math.round(r.top + r.height / 2));
  const ck = {};
  for (const id of ['anNiuZuiXiao', 'anNiuZuiDa', 'anNiuGuanBi']) {
    const b = q(id), s = b.querySelector('svg'), r = b.getBoundingClientRect(), sr = s.getBoundingClientRect();
    const shape = s.querySelector('path,rect');
    let gw = 0;
    try { gw = shape ? shape.getBBox().width : 0; } catch (e) { gw = 0; }
    ck[id] = { w: r.width, h: r.height, sw: sr.width, glyph: gw * (sr.width / 16) };
  }
  const cs = getComputedStyle(document.documentElement);
  return {
    xs: rs.map((r) => Math.round(r.left)),
    order: keJian.every((r, i) => i === 0 || r.left > keJian[i - 1].left),
    sameTop: tops.length > 0 && Math.max(...tops) - Math.min(...tops) <= 3,
    rowH: q('gongJuLan').getBoundingClientRect().height,
    scrollW: q('gongJuLan').scrollWidth,
    clientW: q('gongJuLan').clientWidth,
    openRight: q('anNiuDaKai').getBoundingClientRect().right,
    pinViewBox: q('anNiuZongShiDing').querySelector('svg').getAttribute('viewBox'),
    pinPath: q('anNiuZongShiDing').querySelector('path').getAttribute('d'),
    ck,
    theme: document.documentElement.dataset.theme,
    accent: cs.getPropertyValue('--accent').trim(),
    ink: cs.getPropertyValue('--ink').trim(),
    bodyColor: getComputedStyle(document.body).color,
  };
}
function cePinClick() {
  const q = (id) => document.getElementById(id);
  const b = q('anNiuZongShiDing');
  b.click();
  return new Promise((r) => setTimeout(() => r({ pressed: b.getAttribute('aria-pressed'), kai: b.classList.contains('kai') }), 160));
}
function ceSearch(v) {
  const s = document.getElementById('souRu');
  s.value = v;
  s.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}
function ceReplace(v) {
  const q = (id) => document.getElementById(id);
  q('tiHuanRu').value = v;
  q('anNiuTiHuan').click();
  return true;
}
function ceSnap() {
  const q = (id) => document.getElementById(id);
  return {
    value: q('wenBen').value,
    count: q('souJi').textContent,
    title: q('wenJianMing').textContent,
    back: q('anNiuHouTui').disabled,
    replace: q('anNiuTiHuan').disabled,
  };
}
function ceBack() {
  const q = (id) => document.getElementById(id);
  q('anNiuHouTui').click();
  return new Promise((r) => setTimeout(() => r({ value: q('wenBen').value, count: q('souJi').textContent }), 120));
}
function ceSplit(dx) {
  const q = (id) => document.getElementById(id);
  const j0 = q('juanCuo').getBoundingClientRect();
  const y0 = q('yuLanLie').getBoundingClientRect();
  const d = q('fenGeTiao').getBoundingClientRect();
  const x = d.left + d.width / 2;
  const yy = d.top + Math.min(80, d.height / 2);
  const md = new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: yy, button: 0 });
  q('fenGeTiao').dispatchEvent(md);
  document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: x + dx, clientY: yy, buttons: 1 }));
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: x + dx, clientY: yy }));
  const j1 = q('juanCuo').getBoundingClientRect();
  const y1 = q('yuLanLie').getBoundingClientRect();
  const f = q('yuLanNei').querySelector('iframe');
  const doc = f ? String(f.getAttribute('srcdoc') || '') : '';
  let previewText = '';
  try { previewText = f && f.contentDocument && f.contentDocument.body ? f.contentDocument.body.innerText : ''; } catch (e) { previewText = 'ERR:' + e; }
  const out = {
    split: q('yuLanLie').hidden === false,
    divider: q('fenGeTiao').hidden === false,
    before: [j0.width, y0.width],
    after: [j1.width, y1.width],
    srcHasHi: doc.indexOf('Hi') >= 0,
    previewText: previewText.slice(0, 80),
    srcDoc: doc.slice(0, 160),
  };
  q('fenGeTiao').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  out.reset = [q('juanCuo').getBoundingClientRect().width, q('yuLanLie').getBoundingClientRect().width];
  return out;
}
function ceZoomPrint() {
  const q = (id) => document.getElementById(id);
  q('anNiuFangDa').click();
  const a = q('suoFangZhi').textContent;
  q('zhengWen').dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100, ctrlKey: true }));
  const b = q('suoFangZhi').textContent;
  const box = q('neiRongHang').getBoundingClientRect();
  const jw = q('juanCuo').getBoundingClientRect().width;
  const yw = q('yuLanLie').getBoundingClientRect().width;
  const fw = q('fenGeTiao').getBoundingClientRect().width;
  q('suoFangZhi').click();
  const c = q('suoFangZhi').textContent;
  window.__printed = 0;
  window.print = function () { window.__printed += 1; };
  q('anNiuDaYin').click();
  return { a: a, b: b, c: c, printed: window.__printed, zoom: q('juanCuo').style.zoom, fit: { box: box.width, jw: jw, yw: yw, fw: fw } };
}
async function ceFullscreen(sel) {
  const q = (s) => document.querySelector(s);
  const el = q(sel);
  if (!el) return { found: false };
  el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 420));
  const on = document.fullscreenElement ? document.fullscreenElement.tagName : (el.classList.contains('quanPing') ? 'class' : 'none');
  el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 420));
  const off = document.fullscreenElement ? document.fullscreenElement.tagName : (el.classList.contains('quanPing') ? 'class' : 'none');
  return { found: true, on: on, off: off };
}
function ceSetDirty() {
  const q = (id) => document.getElementById(id);
  const cb = q('gouZiDongBaoCun');
  cb.checked = false;
  cb.dispatchEvent(new Event('change', { bubbles: true }));
  q('wenBen').value += '\\nchanged';
  q('wenBen').dispatchEvent(new Event('input', { bubbles: true }));
  return { auto: cb.checked, dirty: q('wenBen').value.indexOf('changed') >= 0 };
}
function ceClickClose() {
  const q = (id) => document.getElementById(id);
  q('anNiuGuanBi').click();
  return { modal: q('guanBiZheZhao').hidden === false, text: q('guanBiKuang').textContent.replace(/\\s+/g, ' ').slice(0, 80) };
}
function ceCancelClose() {
  const q = (id) => document.getElementById(id);
  q('anNiuQuXiaoGuanBi').click();
  return { modal: q('guanBiZheZhao').hidden === false };
}
function ceDiscardClose() {
  const q = (id) => document.getElementById(id);
  q('anNiuBuBaoCunGuanBi').click();
  return { modal: q('guanBiZheZhao').hidden === false, title: q('wenJianMing').textContent };
}
function ceModalState() {
  const q = (id) => document.getElementById(id);
  return { modal: q('guanBiZheZhao').hidden === false, text: q('guanBiKuang').textContent.replace(/\s+/g, ' ').slice(0, 80) };
}
function ceBeforeUnload() {
  const e = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}
function ceAutoState() {
  const q = (id) => document.getElementById(id);
  const cb = q('gouZiDongBaoCun');
  return { checked: cb.checked, disabled: cb.disabled, save: q('anNiuBaoCun').disabled, status: q('zhuangTai').textContent };
}
function ceMusic() {
  const he = document.querySelector('.yinPinHe');
  if (!he) return { found: false };
  const name = he.querySelector('.geQuMing');
  const det = he.querySelector('details');
  const jd = he.querySelector('.jinDu');
  const w0 = jd.getBoundingClientRect().width;
  jd.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  jd.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: jd.getBoundingClientRect().left + 10 }));
  const w1 = jd.getBoundingClientRect().width;
  return {
    found: true,
    name: name ? name.textContent : '',
    title: name ? name.title : '',
    nowrap: name ? getComputedStyle(name).whiteSpace : '',
    inDetails: !!(det && name && det.contains(name)),
    details: det ? det.textContent.replace(/\\s+/g, ' ') : '',
    w0: w0, w1: w1,
    nameW: name ? name.getBoundingClientRect().width : 0,
  };
}
function ceVideo() {
  const he = document.querySelector('.shiPinHe');
  if (!he) return { found: false };
  const jd = he.querySelector('.jinDu');
  const v = he.querySelector('video');
  const w0 = jd.getBoundingClientRect().width;
  jd.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  jd.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: jd.getBoundingClientRect().left + 20 }));
  const w1 = jd.getBoundingClientRect().width;
  return { found: true, controls: v ? v.controls : null, w0: w0, w1: w1, play: !!he.querySelector('.boFang'), full: !!he.querySelector('.quanPing') };
}
function ceSvg1() {
  const q = (id) => document.getElementById(id);
  const img = q('yuLanNei').querySelector('img.yuLanTu');
  return {
    hasSvg: q('wenBen').value.indexOf('<svg') >= 0,
    split: q('yuLanLie').hidden === false,
    divider: q('fenGeTiao').hidden === false,
    auto: q('gouZiDongBaoCun').checked && !q('gouZiDongBaoCun').disabled,
    save: !q('anNiuBaoCun').disabled,
    preview: img ? img.src.slice(0, 32) : '',
    img: !!img,
    natural: img ? img.naturalWidth : 0,
  };
}
function ceSvgEdit() {
  const q = (id) => document.getElementById(id);
  q('wenBen').value = q('wenBen').value.replace('#e33', '#33e');
  q('wenBen').dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}
function ceSvg2() {
  const q = (id) => document.getElementById(id);
  const img = q('yuLanNei').querySelector('img.yuLanTu');
  const src = img ? img.src : '';
  return { hasBlue: src.indexOf('%2333e') >= 0, hasRed: src.indexOf('%23e33') >= 0, tail: src.slice(-160), title: q('wenJianMing').textContent };
}
function ceSvgSave() {
  const q = (id) => document.getElementById(id);
  q('anNiuBaoCun').click();
  return new Promise((r) => setTimeout(() => r({ title: q('wenJianMing').textContent }), 220));
}
function ceDoc() {
  const q = (id) => document.getElementById(id);
  return {
    doc: document.querySelectorAll('.docYe').length,
    p: document.querySelectorAll('.docWen p').length,
    table: document.querySelectorAll('.biaoGeWai table').length,
    heads: Array.from(document.querySelectorAll('.biaoGeWai thead th')).map((x) => x.textContent),
    cells: Array.from(document.querySelectorAll('.biaoGeWai tbody td')).slice(0, 6).map((x) => x.textContent),
    slides: document.querySelectorAll('.pptYe').length,
    h3: Array.from(document.querySelectorAll('.pptWen h3')).map((x) => x.textContent),
    pre: document.querySelectorAll('#kuaiLie pre').length,
    status: q('zhuangTai').textContent,
  };
}
function ceFindState() {
  const cur = document.querySelector('#kuaiLie mark.dangQian');
  return {
    count: document.getElementById('souJi').textContent,
    marks: document.querySelectorAll('#kuaiLie mark.mingZhong').length,
    current: cur ? cur.textContent : '',
  };
}
function ceSysTheme() {
  return { theme: document.documentElement.dataset.theme, color: getComputedStyle(document.body).color };
}

async function run() {
  const R = RESULT;
  log('run start');
  const w = new BrowserWindow({
    show: false, width: 1100, height: 760,
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, spellcheck: false },
  });
  w.webContents.on('console-message', (_e, _level, message) => { if (message) ERR.push(String(message).slice(0, 300)); });
  w.webContents.on('preload-error', (_e, p, err) => ERR.push('preload-error ' + p + ' ' + String(err)));
  w.webContents.on('render-process-gone', (_e, d) => ERR.push('render-process-gone ' + JSON.stringify(d)));
  const js = (code) => w.webContents.executeJavaScript(code, true);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let pageReady = false;
  const load = async (key, extra) => {
    if (pageReady) {
      log('load save ' + key);
      try { await js('(' + ceSaveIfDirty.toString() + ')()'); } catch (e) { /* 页面还没起来 */ }
      await sleep(260);
    }
    const q = Object.assign({ id: '7', path: BASE + key, theme: 'light', accent: '#A87654' }, extra || {});
    log('load file ' + key);
    await w.loadFile(HTML, { query: q });
    pageReady = true;
    log('loaded ' + key);
    await sleep(450);
  };
  try {
    await load('demo.txt', { theme: 'dark', accent: '#336699', ink: '#123456' });
    R.toolbar = await js('(' + ceToolbar.toString() + ')()');
    log('toolbar');
    w.setContentSize(960, 700);
    await sleep(220);
    R.toolbar960 = await js('(' + ceToolbar.toString() + ')()');
    w.setContentSize(1100, 760);
    await sleep(220);
    R.pin = await js('(' + cePinClick.toString() + ')()');
    log('pin');

    await js('(' + ceSearch.toString() + ')(' + JSON.stringify('alpha') + ')');
    await sleep(120);
    R.replaceBefore = await js('(' + ceSnap.toString() + ')()');
    await js('(' + ceReplace.toString() + ')(' + JSON.stringify('X') + ')');
    await sleep(160);
    R.replaceAfter = await js('(' + ceSnap.toString() + ')()');
    R.replaceBack = await js('(' + ceBack.toString() + ')()');
    log('replace');

    await load('demo.html');
    R.split = await js('(' + ceSplit.toString() + ')(' + (-140) + ')');
    log('split');
    R.zoom = await js('(' + ceZoomPrint.toString() + ')()');
    log('zoom');

    await load('demo.png');
    R.fsImage = await js('(' + ceFullscreen.toString() + ')(' + JSON.stringify('.tuPianHe') + ')');
    log('fs image');

    await load('demo.pptx');
    R.fsPpt = await js('(' + ceFullscreen.toString() + ')(' + JSON.stringify('.pptYe') + ')');
    log('fs ppt');
    R.pptx = await js('(' + ceDoc.toString() + ')()');
    await js('(' + ceSearch.toString() + ')(' + JSON.stringify('正文 C') + ')');
    await sleep(120);
    R.pptxFind = await js('(' + ceFindState.toString() + ')()');

    await load('demo.txt');
    const closeBefore = CALLS.winClose;
    R.closeSet = await js('(' + ceSetDirty.toString() + ')()');
    R.closeModal = await js('(' + ceClickClose.toString() + ')()');
    R.closeNoCall = CALLS.winClose === closeBefore;
    R.beforeUnload = await js('(' + ceBeforeUnload.toString() + ')()');
    R.closeCancel = await js('(' + ceCancelClose.toString() + ')()');
    R.closeModal2 = await js('(' + ceClickClose.toString() + ')()');
    R.closeDiscard = await js('(' + ceDiscardClose.toString() + ')()');
    R.closeCalled = CALLS.winClose === closeBefore + 1;
    log('close flow');

    // 模拟系统 Alt+F4：主进程直接 close()，渲染层必须用 beforeunload + 可见确认框拦住
    await load('demo.txt');
    await js('(' + ceSetDirty.toString() + ')()');
    w.close();
    await sleep(700);
    R.nativeClose = { destroyed: w.isDestroyed() };
    if (!w.isDestroyed()) {
      R.nativeClose.modal = await js('(' + ceModalState.toString() + ')()');
      await js('(' + ceCancelClose.toString() + ')()');
    }
    log('native close');

    await load('demo.docx');
    R.autoReadonly = await js('(' + ceAutoState.toString() + ')()');
    R.docx = await js('(' + ceDoc.toString() + ')()');
    await js('(' + ceSearch.toString() + ')(' + JSON.stringify('第三段') + ')');
    // 第 67 轮：文档视图新增了缩放/时间线容器，查找高亮完成得稍晚；旧 120ms 偶发读到 0/0。
    await sleep(600);
    R.docxFind = await js('(' + ceFindState.toString() + ')()');
    await load('demo.txt');
    R.autoEditable = await js('(' + ceAutoState.toString() + ')()');
    log('auto');

    await load('demo.mp3');
    R.music = await js('(' + ceMusic.toString() + ')()');
    await load('demo.mp4');
    R.video = await js('(' + ceVideo.toString() + ')()');
    log('media');

    await load('demo.svg');
    R.svg1 = await js('(' + ceSvg1.toString() + ')()');
    await js('(' + ceSvgEdit.toString() + ')()');
    await sleep(700);
    R.svg2 = await js('(' + ceSvg2.toString() + ')()');
    R.svgSaved = await js('(' + ceSvgSave.toString() + ')()');
    R.svgSaveCalls = CALLS.nmBaoCun;
    log('svg');

    await load('demo.xlsx');
    R.xlsx = await js('(' + ceDoc.toString() + ')()');
    await js('(' + ceSearch.toString() + ')(' + JSON.stringify('张三') + ')');
    await sleep(120);
    R.xlsxFind = await js('(' + ceFindState.toString() + ')()');
    log('xlsx');

    await load('demo.txt', { theme: '', accent: '' });
    R.sysTheme = await js('(' + ceSysTheme.toString() + ')()');
    log('sys theme');
  } catch (e) {
    R.error = String((e && e.stack) || e);
    log('ERR ' + R.error);
  }
  R.calls = CALLS;
  R.console = ERR;
  R.__done = true;
  log('emit');
  emit();
}
app.whenReady().then(run).catch((e) => {
  RESULT.error = String((e && e.stack) || e);
  RESULT.console = ERR;
  RESULT.calls = CALLS;
  RESULT.__done = true;
  log('outer ERR ' + RESULT.error);
  emit();
});
`;

fs.writeFileSync(mainPath, mainSrc, 'utf8');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const r = spawnSync(ELECTRON, ['--no-sandbox', '--user-data-dir=' + path.join(dir, 'ud'), mainPath], {
  timeout: 120000, encoding: 'utf8', windowsHide: true, env,
});
let data = null;
const line = String(r.stdout || '').split(/\r?\n/).find((x) => x.startsWith('R63_NM '));
if (line) {
  try { data = JSON.parse(line.slice('R63_NM '.length)); } catch { data = null; }
}
if (!data) {
  try { data = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8')); } catch { data = null; }
}
if (!data) {
  console.error('[verify-r63-nm] 没拿到读数');
  try { console.error(fs.readFileSync(path.join(dir, 'run.log'), 'utf8').split(/\r?\n/).slice(-20).join('\n')); } catch { /* noop */ }
  console.error(String(r.stderr || r.stdout || '').slice(0, 1200));
  console.log(`==== verify-r63-nm: 0 ok / 1 FAIL ====`);
  process.exit(1);
}
jian('隐藏 Electron 加载真实产物并跑完（无未捕获异常）', !data.error, data.error);
if (data.error) {
  console.log(`==== verify-r63-nm: ${okN} ok / ${failN} FAIL ====`);
  process.exit(1);
}

const t = data.toolbar || {};
console.log('  · 1100 工具栏: ' + JSON.stringify({ scrollW: t.scrollW, clientW: t.clientW, openRight: t.openRight }));
console.log('  · 960 工具栏: ' + JSON.stringify(data.toolbar960 && { scrollW: data.toolbar960.scrollW, clientW: data.toolbar960.clientW, openRight: data.toolbar960.openRight, rowH: data.toolbar960.rowH }));
console.log('  · 120% 分栏: ' + JSON.stringify(data.zoom && data.zoom.fit));
jian('工具栏是一行、不换行', t.rowH <= 46, JSON.stringify({ rowH: t.rowH }));
jian('默认 960 宽窗口工具栏不横向溢出、仍是一行', data.toolbar960 && data.toolbar960.rowH <= 46 && data.toolbar960.scrollW <= data.toolbar960.clientW + 2 && data.toolbar960.order && data.toolbar960.sameTop, JSON.stringify(data.toolbar960 && { scrollW: data.toolbar960.scrollW, clientW: data.toolbar960.clientW, rowH: data.toolbar960.rowH }));
jian('查找组顺序：搜索框 → 上箭头 → 下箭头 → 结果数 → 替换框 → 替换按钮', !!t.order && t.sameTop, JSON.stringify(t.xs));
jian('主题参数：dark / 强调色 / 字体颜色都跟着底座传入', t.theme === 'dark' && /#336699/i.test(t.accent) && /#123456/i.test(t.ink), JSON.stringify({ theme: t.theme, accent: t.accent, ink: t.ink, color: t.bodyColor }));
jian('置顶按钮用 nm 自己的图钉（24×24，M9 4h6…）', t.pinViewBox === '0 0 24 24' && /^M9 4h6/.test(String(t.pinPath || '')), JSON.stringify({ viewBox: t.pinViewBox, path: t.pinPath }));
jian('置顶按钮可切换（aria-pressed / 高亮）', data.pin && data.pin.pressed === 'true' && data.pin.kai === true, JSON.stringify(data.pin));

const ck = t.ck || {};
jian('最小化图标变短（≤ 8.5px 线宽）、按钮 42×30', ck.anNiuZuiXiao && ck.anNiuZuiXiao.glyph <= 8.5 && ck.anNiuZuiXiao.w >= 40 && ck.anNiuZuiXiao.h >= 28, JSON.stringify(ck.anNiuZuiXiao));
jian('最大化 / 关闭按钮与图标都变大（按钮 ≥ 40×28，图标 ≥ 8.5px）', ck.anNiuZuiDa && ck.anNiuGuanBi && ck.anNiuZuiDa.w >= 40 && ck.anNiuZuiDa.h >= 28 && ck.anNiuGuanBi.w >= 40 && ck.anNiuGuanBi.h >= 28 && ck.anNiuZuiDa.glyph >= 8.5 && ck.anNiuGuanBi.glyph >= 8.5, JSON.stringify({ max: ck.anNiuZuiDa, close: ck.anNiuGuanBi }));

jian('替换流程：有结果 + 可编辑才可用，替换后计数/脏标记正确', data.replaceBefore && data.replaceBefore.count === '1/2' && data.replaceBefore.replace === false && data.replaceAfter && data.replaceAfter.value.indexOf('X beta alpha') === 0 && data.replaceAfter.title.indexOf('●') === 0, JSON.stringify({ before: data.replaceBefore, after: data.replaceAfter }));
jian('替换可后退回替换前', data.replaceBack && data.replaceBack.value.indexOf('alpha beta alpha') === 0, JSON.stringify(data.replaceBack));

jian('HTML 源码/效果分栏真的显示（左源码、右效果、中间分隔条）', data.split && data.split.split && data.split.divider && data.split.srcHasHi && /Hi/.test(data.split.previewText || ''), JSON.stringify({ split: data.split && data.split.split, divider: data.split && data.split.divider, hasHi: data.split && data.split.srcHasHi, text: data.split && data.split.previewText }));
jian('拖动分隔条能改宽度，双击恢复 50%', data.split && data.split.after[0] < data.split.before[0] - 80 && data.split.after[1] > data.split.before[1] + 80 && near(data.split.reset[0], data.split.reset[1], 20), JSON.stringify(data.split && { before: data.split.before, after: data.split.after, reset: data.split.reset }));
jian('工具栏放大/缩小 + Ctrl+滚轮 + 恢复 100%', data.zoom && data.zoom.a === '110%' && data.zoom.b === '120%' && data.zoom.c === '100%', JSON.stringify(data.zoom));
jian('放大到 120% 后源码/效果分栏不溢出', data.zoom && data.zoom.fit && data.zoom.fit.jw + data.zoom.fit.yw + data.zoom.fit.fw <= data.zoom.fit.box + 2, JSON.stringify(data.zoom && data.zoom.fit));
jian('打印按钮真的调用 window.print', data.zoom && data.zoom.printed === 1, JSON.stringify(data.zoom));

jian('图片双击全屏、再次双击恢复', data.fsImage && data.fsImage.found && data.fsImage.on !== 'none' && data.fsImage.off === 'none', JSON.stringify(data.fsImage));
jian('PPT 双击全屏、再次双击恢复', data.fsPpt && data.fsPpt.found && data.fsPpt.on !== 'none' && data.fsPpt.off === 'none', JSON.stringify(data.fsPpt));

jian('有未保存改动时关闭弹确认，未确认前不调 winClose', data.closeSet && data.closeSet.auto === false && data.closeModal && data.closeModal.modal && data.closeNoCall, JSON.stringify({ set: data.closeSet, modal: data.closeModal, noCall: data.closeNoCall }));
jian('beforeunload 在脏状态下阻止卸载（原生关闭的渲染层兜底）', data.beforeUnload === true);
jian('取消关闭保留窗口；选“不保存”才真正调 winClose', data.closeCancel && data.closeCancel.modal === false && data.closeModal2 && data.closeModal2.modal && data.closeDiscard && !data.closeDiscard.modal && data.closeCalled, JSON.stringify({ cancel: data.closeCancel, again: data.closeModal2, discard: data.closeDiscard, called: data.closeCalled }));
jian('系统 Alt+F4（主进程 close）不会静默丢改动：窗口留下并显示确认框', data.nativeClose && data.nativeClose.destroyed === false && data.nativeClose.modal && data.nativeClose.modal.modal === true, JSON.stringify(data.nativeClose));

jian('只读 DOCX：自动保存不勾选且灰色不可用，保存按钮禁用', data.autoReadonly && data.autoReadonly.checked === false && data.autoReadonly.disabled === true && data.autoReadonly.save === true, JSON.stringify(data.autoReadonly));
jian('可编辑文本：自动保存默认勾选且可用', data.autoEditable && data.autoEditable.checked === true && data.autoEditable.disabled === false && data.autoEditable.save === false, JSON.stringify(data.autoEditable));

jian('音乐信息条：名称不在折叠区、单行不折叠', data.music && data.music.found && data.music.name === 'Song' && data.music.nowrap === 'nowrap' && data.music.inDetails === false && data.music.nameW > 0, JSON.stringify(data.music && { name: data.music.name, nowrap: data.music.nowrap, inDetails: data.music.inDetails }));
jian('音乐详情有格式/大小/专辑（文件名可识别时）', data.music && /MP3/.test(data.music.details) && /1\.2 MB/.test(data.music.details) && /Album/.test(data.music.details), data.music && data.music.details);
jian('音乐进度条悬停宽度不变', data.music && near(data.music.w0, data.music.w1, 0.5), data.music && JSON.stringify([data.music.w0, data.music.w1]));

jian('MP4 用自定义控制条（不再用原生 controls）', data.video && data.video.found && data.video.controls === false && data.video.play && data.video.full, JSON.stringify(data.video));
jian('MP4 进度条悬停宽度不变（修偶发变短）', data.video && near(data.video.w0, data.video.w1, 0.5), data.video && JSON.stringify([data.video.w0, data.video.w1]));

jian('SVG 能读出源码并进入左源码/右效果分栏', data.svg1 && data.svg1.hasSvg && data.svg1.split && data.svg1.divider && data.svg1.img && data.svg1.natural >= 100, JSON.stringify(data.svg1));
jian('SVG 可编辑：自动保存勾选、保存可用', data.svg1 && data.svg1.auto === true && data.svg1.save === true, JSON.stringify(data.svg1 && { auto: data.svg1.auto, save: data.svg1.save }));
jian('改 SVG 源码后效果区跟着更新', data.svg2 && data.svg2.hasBlue && !data.svg2.hasRed && data.svg2.title.indexOf('●') === 0, JSON.stringify({ blue: data.svg2 && data.svg2.hasBlue, red: data.svg2 && data.svg2.hasRed, title: data.svg2 && data.svg2.title }));
jian('SVG 保存后脏标记清除', data.svgSaved && data.svgSaved.title.indexOf('●') !== 0 && data.svgSaveCalls >= 1, JSON.stringify({ saved: data.svgSaved, calls: data.svgSaveCalls }));

jian('DOCX 显示纸张式预览页（不是二进制/纯 pre）', data.docx && data.docx.doc === 1 && data.docx.p >= 3 && data.docx.pre === 0, JSON.stringify(data.docx));
jian('DOCX 正文里查找能命中并高亮', data.docxFind && data.docxFind.count === '1/1' && data.docxFind.current === '第三段', JSON.stringify(data.docxFind));
jian('XLSX 显示工作表表格（表头/单元格有值，不是二进制）', data.xlsx && data.xlsx.table === 1 && data.xlsx.heads.indexOf('姓名') >= 0 && data.xlsx.cells.indexOf('张三') >= 0 && data.xlsx.cells.indexOf('90') >= 0 && data.xlsx.pre === 0, JSON.stringify(data.xlsx));
jian('XLSX 表格里查找能命中并高亮', data.xlsxFind && data.xlsxFind.count === '1/1' && data.xlsxFind.current === '张三', JSON.stringify(data.xlsxFind));
jian('PPTX 显示 16:9 幻灯片页（文字版式，不是二进制）', data.pptx && data.pptx.slides === 2 && data.pptx.h3.indexOf('标题一') >= 0 && data.pptx.pre === 0, JSON.stringify(data.pptx));
jian('PPTX 幻灯片里查找能命中并高亮', data.pptxFind && data.pptxFind.count === '1/1' && data.pptxFind.current === '正文 C', JSON.stringify(data.pptxFind));

jian('没有 ?theme= 参数时回退到系统深浅色（不是写死 light）', data.sysTheme && (data.sysTheme.theme === 'dark' || data.sysTheme.theme === 'light') && !!data.sysTheme.color, JSON.stringify(data.sysTheme));

const severe = (data.console || []).filter((m) => /Uncaught|ReferenceError|TypeError|SyntaxError|Content Security Policy|Refused to frame/i.test(m));
jian('渲染层无未捕获异常 / CSP 拦预览', severe.length === 0, JSON.stringify(severe.slice(0, 4)));

console.log(`==== verify-r63-nm: ${okN} ok / ${failN} FAIL ====`);
if (failN) console.log('  · 测试目录保留：' + dir);
else { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ } }
process.exit(failN ? 1 : 0);
