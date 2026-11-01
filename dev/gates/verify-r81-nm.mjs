/**
 * verify-r81-nm.mjs —— 第 81 轮 nm 查看器专项（行为型）。
 *
 * 用**隐藏 Electron 窗口加载真实产物** `dist/renderer/nm-viewer.html`（真实 preload），
 * 主进程只注册测试用 IPC 假数据；临时 userData，绝不碰真实用户配置。
 *
 * 覆盖：
 *   1) 视频可播：readyState=4、能 play、控制条在视口内（以前的溢出 bug 会让控制条消失）
 *   2) 工具栏：保存=纯图标、撤销右侧=前进按钮（无下拉）、无「新建网页/网页卡」、
 *      换行紧挨缩放左侧、无匹配=图标、替换框最小宽度 + 两行对齐、目录菜单有「打开网站」、
 *      没有悬停「系统默认打开」浮钮
 *   3) 网站模式：两行工具栏（第一行纯图标 + 地址栏；第二行标签页 + 左右箭头）、
 *      分栏 4 态循环与主题色、本地源码可编辑/即时预览/未保存提醒、源码区 2 行工具栏、
 *      非本地（远程）源码只读 + 禁用
 *   4) 只读文字：文字上 text 光标（可框选）、文字外拖动画面
 *   5) 吸附：纯函数四边 + 尺寸对齐目标（duiQi=true）+ 目标窗不被改尺寸
 *   6) 媒体/文档：PPT/图片/PDF 双击全屏、音乐倍速 0.1–5 且无「音乐 · 只读」/静音、
 *      压缩包分隔线可拖动、包内条目右侧预览
 *   7) 右键菜单：全选/复制/粘贴/撤销/重做(前进)/剪切/插入对话
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PKG = path.join(ROOT, 'packages/app-shell');
const ELECTRON = path.join(PKG, 'node_modules/electron/dist/electron.exe');
const HTML = path.join(PKG, 'dist/renderer/nm-viewer.html');
const PRELOAD = path.join(PKG, 'dist/preload.cjs');
const MAIN_JS = path.join(PKG, 'dist/nm-viewer-win.js');
const MP4_B64 = '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';

let okN = 0;
let failN = 0;
const jian = (label, pass, detail) => {
  if (pass) { okN += 1; console.log('  ok  ' + label); }
  else { failN += 1; console.log('  FAIL ' + label + (detail !== undefined ? ' ← ' + String(detail).slice(0, 500) : '')); }
};

if (!fs.existsSync(HTML) || !fs.existsSync(PRELOAD) || !fs.existsSync(MAIN_JS)) {
  console.error('[verify-r81-nm] 产物不存在，先运行 node scripts/copy-assets.mjs');
  process.exit(2);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-r81-nm-'));
const mainPath = path.join(dir, 'main.cjs');
const BASE = 'C:\\warmy-test\\';

const mainSrc = String.raw`'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
app.disableHardwareAcceleration();
app.setPath('userData', path.join(__dirname, 'profile'));
const HTML = ${JSON.stringify(HTML)};
const PRELOAD = ${JSON.stringify(PRELOAD)};
const MAIN_JS = ${JSON.stringify(MAIN_JS)};
const BASE = ${JSON.stringify(BASE)};
const RESULT = {};
const LOG = [];
const CALLS = { save: 0, saveAs: 0, find: [], print: 0, nav: [], view: 0, xinKai: false };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function emit() {
  try { RESULT.log = LOG.slice(0, 80); } catch (e) {}
  try { console.log('R81_NM ' + JSON.stringify(RESULT)); } catch (e) {}
  setTimeout(() => app.exit(0), 120);
}
setTimeout(() => { if (!RESULT.__done) { RESULT.__done = true; RESULT.timeout = true; emit(); } }, 120000);

const MP4 = path.join(__dirname, 'clip.mp4');
try { fs.writeFileSync(MP4, Buffer.from(${JSON.stringify(MP4_B64)}, 'base64')); } catch (e) { LOG.push('mp4 fail ' + e.message); }

const HTML_SRC = '<!doctype html><html><body><h1>Hello</h1><p>page preview</p></body></html>';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z8XcAAAAASUVORK5CYII=';
const ZIP_XIN = {
  ming: 'demo.zip', geShi: 'ZIP', tiaoMuShu: 3, jiaMiShu: 0, zip64: false,
  yuLanShangXian: 8 * 1024 * 1024, jieYaShangXian: 64 * 1024 * 1024,
  tiaoMu: [
    { ming: 'a.txt', isDir: false, ziJie: 5, yaSuoZiJie: 5, fangFa: 0, fangFaMing: 'stored', jiaMi: false, shouBaoHu: false, anQuan: true, keKai: true, shiZip: false },
    { ming: 'sub/', isDir: true, ziJie: 0, yaSuoZiJie: 0, fangFa: 0, fangFaMing: 'stored', jiaMi: false, shouBaoHu: false, anQuan: true, keKai: true, shiZip: false },
    { ming: 'sub/b.png', isDir: false, ziJie: 9, yaSuoZiJie: 9, fangFa: 0, fangFaMing: 'stored', jiaMi: false, shouBaoHu: false, anQuan: true, keKai: true, shiZip: false },
  ],
};

const FIX = {
  'demo.html': { ok: true, luJing: BASE + 'demo.html', ming: 'demo.html', kuoZhan: 'html', leiXing: 'text', keBianJi: true, ziJie: HTML_SRC.length, huanHang: 'lf', wenBen: HTML_SRC },
  'demo.txt': { ok: true, luJing: BASE + 'demo.txt', ming: 'demo.txt', kuoZhan: 'txt', leiXing: 'text', keBianJi: true, ziJie: 42, huanHang: 'lf', wenBen: 'alpha beta alpha\nsecond line' },
  'readonly.txt': { ok: true, luJing: BASE + 'readonly.txt', ming: 'readonly.txt', kuoZhan: 'txt', leiXing: 'text', keBianJi: false, ziJie: 260, huanHang: 'lf',
    wenBen: Array.from({ length: 16 }, (_, i) => 'read only line ' + (i + 1) + ' 只读正文可框选复制').join('\n') },
  'clip.mp4': { ok: true, luJing: BASE + 'clip.mp4', ming: 'clip.mp4', kuoZhan: 'mp4', leiXing: 'video', keBianJi: false, ziJie: 5389, meiTiUrl: pathToFileURL(MP4).href, mime: 'video/mp4' },
  'song.mp3': { ok: true, luJing: BASE + 'song.mp3', ming: 'Artist - Album - Song.mp3', kuoZhan: 'mp3', leiXing: 'audio', keBianJi: false, ziJie: 1234567, meiTiUrl: 'file:///C:/warmy-test/nope.mp3', mime: 'audio/mpeg' },
  'demo.png': { ok: true, luJing: BASE + 'demo.png', ming: 'demo.png', kuoZhan: 'png', leiXing: 'image', keBianJi: false, ziJie: 100, meiTiUrl: PNG, mime: 'image/png' },
  'demo.pptx': { ok: true, luJing: BASE + 'demo.pptx', ming: 'demo.pptx', kuoZhan: 'pptx', leiXing: 'pptx', keBianJi: false, ziJie: 6666, kuai: [{ biaoTi: '第 1 页', wenBen: '标题一\n正文 A' }, { biaoTi: '第 2 页', wenBen: '标题二' }] },
  'demo.pdf': { ok: true, luJing: BASE + 'demo.pdf', ming: 'demo.pdf', kuoZhan: 'pdf', leiXing: 'pdf', keBianJi: false, ziJie: 7777, kuai: [{ biaoTi: '正文 · 共 1 页', wenBen: 'PDF 第一段。\nPDF 第二段。' }] },
  'demo.zip': { ok: true, luJing: BASE + 'demo.zip', ming: 'demo.zip', kuoZhan: 'zip', leiXing: 'archive', keBianJi: false, ziJie: 2048, yaSuoBao: ZIP_XIN },
};
function fixtureOf(p) {
  const s = String((p && (p.path || p.luJing)) || '');
  if (s.startsWith('nmz1:')) {
    let q = {};
    try {
      const b64 = s.slice(5).replace(/-/g, '+').replace(/_/g, '/');
      q = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    } catch (e) { return { ok: false, cuo: 'bad envelope' }; }
    if (q.a === 'read') {
      return { ok: true, luJing: BASE + 'demo.zip', ming: 'a.txt', kuoZhan: 'txt', leiXing: 'text', keBianJi: false, ziJie: 5, huanHang: 'lf', wenBen: 'ZIPPREVIEW' };
    }
    return { ok: true, ok2: true, yaSuoBao: ZIP_XIN };
  }
  const key = path.basename(s);
  return FIX[key] || { ok: false, cuo: 'no fixture: ' + key };
}
ipcMain.handle('warmy:nmShiTuDu', (_e, p) => fixtureOf(p));
ipcMain.handle('warmy:nmShiTuBaoCun', (_e, p) => { CALLS.save += 1; RESULT.lastSave = p; return { ok: true, ziJie: String((p && p.wenBen) || '').length }; });
ipcMain.handle('warmy:nmShiTuLingCunWei', () => { CALLS.saveAs += 1; return { ok: true, luJing: BASE + 'saved.html', ziJie: 1 }; });
ipcMain.handle('warmy:nmShiTuSheZhi', (_e, p) => ({ ok: true, zongShiDing: !!(p && p.zongShiDing), xiFu: !!(p && p.xiFu) }));
ipcMain.handle('warmy:nmQuZiJie', () => ({ ok: false, cuo: 'not-used' }));
ipcMain.handle('warmy:wenJianYuLan', () => ({ ok: false }));
ipcMain.handle('warmy:winGuanBi', () => ({ ok: true }));
ipcMain.handle('warmy:nmDaKai', () => ({ ok: true }));
ipcMain.handle('warmy:nmSuoZaiMuLu', () => ({ ok: true }));
ipcMain.handle('warmy:luJingCunZai', (_e, p) => { const o = {}; for (const x of (Array.isArray(p) ? p : [])) o[x] = false; return { cunZai: o }; });
/** 第 116 轮：远程网页的导航/查找状态由主进程事件同步（这里用假事件验证界面接线） */
const NAV = { canGoBack: true, canGoForward: false, loading: false, url: 'https://example.com/' };
ipcMain.handle('warmy:nmWangYeKai', (e, p) => {
  CALLS.view += 1;
  if (p && p.url) NAV.url = String(p.url);
  e.sender.send('warmy:nmWangYeZhuangTai', { id: 1, nav: { ...NAV } });
  return { ok: true };
});
ipcMain.handle('warmy:nmWangYeKuang', () => ({ ok: true }));
ipcMain.handle('warmy:nmWangYeGuan', () => ({ ok: true }));
ipcMain.handle('warmy:nmWangYeDaoHang', (e, p) => {
  const dong = String(p && p.dong || '');
  CALLS.nav.push(dong);
  if (dong === 'back') { NAV.canGoBack = false; NAV.canGoForward = true; NAV.url = 'https://example.com/back'; }
  else if (dong === 'forward') { NAV.canGoBack = true; NAV.canGoForward = false; NAV.url = 'https://example.com/forward'; }
  NAV.loading = dong === 'reload';
  e.sender.send('warmy:nmWangYeZhuangTai', { id: 1, nav: { ...NAV } });
  if (dong === 'reload') setTimeout(() => { NAV.loading = false; try { e.sender.send('warmy:nmWangYeZhuangTai', { id: 1, nav: { ...NAV } }); } catch { /* noop */ } }, 30);
  return { ok: true };
});
ipcMain.handle('warmy:nmWangYeChaZhao', (e, p) => {
  const wen = String(p && p.wen || '');
  CALLS.find.push(wen);
  setTimeout(() => {
    try {
      e.sender.send('warmy:nmWangYeZhuangTai', {
        id: 1,
        found: wen ? { matches: 3, active: 2 } : { matches: 0, active: 0, query: '' },
      });
    } catch { /* noop */ }
  }, 12);
  return { ok: true, requestId: CALLS.find.length };
});
ipcMain.handle('warmy:nmWangYeDaYin', () => { CALLS.print += 1; return { ok: true }; });
ipcMain.handle('warmy:nmWangYeXinKai', (_e, p) => { CALLS.xinKai = !!(p && p.kai); return { ok: true }; });
ipcMain.handle('warmy:nmWangYeYuan', () => ({ ok: true, url: NAV.url, html: '<!doctype html><html><body><h1>REMOTE-SOURCE</h1><p>rendered</p></body></html>' }));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 960, height: 720, show: false,
    webPreferences: {
      preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true,
      backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required', spellcheck: false,
    },
  });
  win.webContents.on('console-message', (_e, level, msg) => {
    if (level >= 2 || /error|exception/i.test(String(msg))) LOG.push('console[' + level + '] ' + String(msg).slice(0, 300));
  });
  const ce = (code) => win.webContents.executeJavaScript(code, true);
  const load = async (name) => {
    await win.loadFile(HTML, { query: { id: '1', path: BASE + name, theme: 'light' } });
    await sleep(520);
  };
  const dbl = (sel) => ce('(() => { const el = document.querySelector(' + JSON.stringify(sel) + '); if (!el) return false; el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, button: 0 })); return true; })()');
  const rightClick = (sel) => ce('(() => { const el = document.querySelector(' + JSON.stringify(sel) + '); if (!el) return false; const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: r.left + 30, clientY: r.top + 20 })); return true; })()');

  try {
    /* ── 1. 工具栏（demo.txt：可编辑） ── */
    await load('demo.txt');
    RESULT.toolbar = await ce('(() => { const q = (id) => document.getElementById(id); return { saveText: q("anNiuBaoCun").textContent.trim(), saveSvg: !!q("anNiuBaoCun").querySelector("svg"), saveW: Math.round(q("anNiuBaoCun").getBoundingClientRect().width), undoNext: q("anNiuHouTui").nextElementSibling && q("anNiuHouTui").nextElementSibling.id, qianjinVisible: q("anNiuQianJin").getBoundingClientRect().width > 0, qianjinClass: q("anNiuQianJin").className, wrapNext: q("anNiuHuanHang").nextElementSibling && q("anNiuHuanHang").nextElementSibling.id, removed: { newPage: !q("anNiuWangYeXin"), pageCard: !q("anNiuWangYeKa"), histDrop: !q("anNiuHouTuiXia"), sysHover: !q("anNiuXiTongDaKai") } }; })()');

    // 无匹配：图标而不是文字
    await ce('(() => { const s = document.getElementById("souRu"); s.value = "zzzzno"; s.dispatchEvent(new Event("input", { bubbles: true })); })()');
    await sleep(350);
    RESULT.noMatch = await ce('(() => { const b = document.getElementById("souJi"); return { text: b.textContent.trim(), svg: !!b.querySelector("svg"), title: b.title }; })()');
    await ce('(() => { const s = document.getElementById("souRu"); s.value = ""; s.dispatchEvent(new Event("input", { bubbles: true })); })()');

    // 替换框最小宽度 / 两行对齐（窄窗）
    win.setContentSize(440, 620);
    await sleep(420);
    await ce('document.getElementById("souJi").click()');
    await sleep(420);
    RESULT.twoRow = await ce('(() => { const q = (id) => document.getElementById(id); const r2 = q("gongJuHang2"); const th = q("tiHuanZu"); const f = q("souRuKe").getBoundingClientRect(); const t = th.getBoundingClientRect(); const r1 = q("gongJuHang1"); return { twoRows: !r2.hidden, inRow2: th.parentElement === r2, replaceW: Math.round(q("tiHuanRu").getBoundingClientRect().width), align: Math.round(t.left - f.left), row2Height: Math.round(r2.getBoundingClientRect().height), winW: window.innerWidth, r1cw: r1.clientWidth, r1sw: r1.scrollWidth, souW: Math.round(q("souKuang").getBoundingClientRect().width), expanded: q("souJi").getAttribute("aria-expanded"), thParent: th.parentElement.id }; })()');
    win.setContentSize(960, 720);
    await sleep(420);

    // 目录菜单里有「打开网站」
    RESULT.dirMenu = await ce('(() => { const q = (id) => document.getElementById(id); q("anNiuMuLuXia").click(); const m = q("gongJuCaiDan"); const labels = [...m.querySelectorAll("button")].map((b) => b.textContent.trim()); return { open: !m.hidden, labels }; })()');
    await ce('document.getElementById("gongJuCaiDan").hidden = true');

    // 右键菜单（可编辑文本）
    await rightClick('#wenBen');
    await sleep(160);
    RESULT.ctxEditable = await ce('(() => { const m = document.getElementById("gongJuCaiDan"); const labels = [...m.querySelectorAll("button")].map((b) => b.textContent.trim()); return { open: !m.hidden, labels, disabled: [...m.querySelectorAll("button")].map((b) => b.disabled) }; })()');
    // 插入对话（没有 IPC ⇒ 应如实提示缺口）
    RESULT.insertGap = await ce('(() => { const m = document.getElementById("gongJuCaiDan"); const b = [...m.querySelectorAll("button")].find((x) => x.textContent.trim() === "插入对话"); if (!b) return { found: false }; b.click(); return { found: true }; })()');
    await sleep(220);
    RESULT.insertStatus = await ce('document.getElementById("zhuangTai").textContent');
    await ce('document.getElementById("gongJuCaiDan").hidden = true');

    /* ── 2. 网站模式（demo.html：本地可编辑） ── */
    await load('demo.html');
    await ce('(() => { const q = (id) => document.getElementById(id); q("anNiuMuLuXia").click(); const m = q("gongJuCaiDan"); const b = [...m.querySelectorAll("button")].find((x) => x.textContent.includes("打开网站")); b.click(); })()');
    await sleep(600);
    RESULT.web = await ce('(() => { const q = (id) => document.getElementById(id); const h1 = q("wangYeHang1"); const h2 = q("wangYeHang2"); return { open: !q("wangYeGongJu").hidden, row1: [...h1.children].map((x) => x.id || x.tagName), row2HasTabs: !!q("wangYeTabLie"), arrows: !!q("anNiuWangYeTabZuo") && !!q("anNiuWangYeTabYou"), tabs: q("wangYeTabLie").children.length, srcHiddenInitially: q("wangYeYuan").hidden }; })()');
    // 第一条：只网页（正常色）——源码区隐藏是预期
    RESULT.split = [];
    for (let i = 0; i < 4; i += 1) {
      RESULT.split.push(await ce('(() => { const q = (id) => document.getElementById(id); const b = q("anNiuWangYeFenLan"); const r = b.getBoundingClientRect(); const cs = getComputedStyle(b); return { cls: q("wangYeLie").className, pressed: b.getAttribute("aria-pressed"), color: cs.color, title: b.title, srcHidden: q("wangYeYuan").hidden, srcReadOnly: q("wangYeYuanWen").readOnly, srcRows: [q("wangYeYuanHang1"), q("wangYeYuanHang2")].map((x) => Math.round(x.getBoundingClientRect().height)) }; })()'));
      await ce('document.getElementById("anNiuWangYeFenLan").click()');
      await sleep(260);
    }
    // 回到 fen1（源码可编辑）
    await ce('document.getElementById("anNiuWangYeFenLan").click()');
    await sleep(300);
    RESULT.srcPane = await ce('(() => { const q = (id) => document.getElementById(id); return { visible: !q("wangYeYuan").hidden, readOnly: q("wangYeYuanWen").readOnly, rows: [q("wangYeYuanHang1"), q("wangYeYuanHang2")].map((x) => Math.round(x.getBoundingClientRect().height)), save: !!q("anNiuYuanBaoCun").querySelector("svg") }; })()');
    // 改源码 ⇒ 预览即时跟随（未保存也跟随）
    await ce('(() => { const ta = document.getElementById("wangYeYuanWen"); ta.value = ta.value.replace("Hello", "ChangedNow"); ta.dispatchEvent(new Event("input", { bubbles: true })); })()');
    await sleep(350);
    RESULT.instant = await ce('(() => { const f = document.getElementById("wangYeKuang"); return { srcdocHasChange: String(f.srcdoc || "").includes("ChangedNow"), title: document.getElementById("wenJianMing").textContent, tabDot: [...document.querySelectorAll(".wangYeTab")].some((x) => x.textContent.includes("●")) }; })()');
    // 有未保存改动时切分栏 ⇒ 提醒
    await ce('document.getElementById("anNiuWangYeFenLan").click()');
    await sleep(250);
    RESULT.dirtyDlg = await ce('document.getElementById("wangYeWeiBaoCun").hidden === false');
    await ce('document.getElementById("anNiuWangYeFangQi").click()');
    await sleep(300);
    RESULT.afterDiscard = await ce('(() => ({ dlg: document.getElementById("wangYeWeiBaoCun").hidden, title: document.getElementById("wenJianMing").textContent, cls: document.getElementById("wangYeLie").className }))()');
    // 保存源码走 nmBaoCun
    await ce('(() => { const ta = document.getElementById("wangYeYuanWen"); ta.value = ta.value + "\\n<!-- saved -->"; ta.dispatchEvent(new Event("input", { bubbles: true })); })()');
    await sleep(120);
    const saveBefore = CALLS.save;
    await ce('document.getElementById("anNiuYuanBaoCun").click()');
    await sleep(350);
    RESULT.srcSave = { called: CALLS.save > saveBefore, title: await ce('document.getElementById("wenJianMing").textContent') };
    // 保存下拉：自动保存默认不勾
    await ce('document.getElementById("anNiuYuanBaoCunXia").click()');
    await sleep(200);
    RESULT.autoSave = await ce('(() => { const m = document.getElementById("gongJuCaiDan"); const ck = m.querySelector("input[type=checkbox]"); return { hasCheck: !!ck, checked: ck ? ck.checked : null, labels: [...m.querySelectorAll("button,label")].map((x) => x.textContent.trim()) }; })()');
    await ce('document.getElementById("gongJuCaiDan").hidden = true');

    /* 远程网址：源码只读且控件禁用 */
    await ce('document.getElementById("anNiuWangYeFenLan").click()');
    await sleep(180);
    await ce('document.getElementById("anNiuWangYeFenLan").click()');
    await sleep(220);
    await ce('(() => { const u = document.getElementById("wangYeUrl"); u.value = "https://example.com/"; u.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); })()');
    await sleep(500);
    RESULT.viewCount1 = CALLS.view;
    await sleep(600);
    RESULT.viewCount2 = CALLS.view;
    // 远程页拿主进程的真实导航状态（不是渲染层自己的 URL 历史）
    await sleep(180);
    RESULT.remoteNav1 = await ce('(() => ({ back: document.getElementById("anNiuWangYeHou").disabled, fwd: document.getElementById("anNiuWangYeQian").disabled, shua: document.getElementById("anNiuWangYeShua").title, findHidden: document.getElementById("wangYeSouHang").hidden }))()');
    await ce('document.getElementById("anNiuWangYeHou").click()');
    await sleep(120);
    RESULT.remoteNav2 = await ce('(() => ({ back: document.getElementById("anNiuWangYeHou").disabled, fwd: document.getElementById("anNiuWangYeQian").disabled }))()');
    RESULT.remoteNavCalls = CALLS.nav.slice();
    // 远程页查找：Ctrl+F 打开查找条；输入后把匹配数接到工具栏
    await ce('document.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true }))');
    await sleep(120);
    RESULT.findOpen = await ce('(() => ({ hidden: document.getElementById("wangYeSouHang").hidden, focused: document.activeElement && document.activeElement.id }))()');
    await ce('(() => { const i = document.getElementById("wangYeSouRu"); i.value = "needle"; i.dispatchEvent(new Event("input", { bubbles: true })); })()');
    await sleep(320);
    RESULT.findCount = await ce('document.getElementById("wangYeSouJi").textContent');
    await ce('document.getElementById("anNiuWangYeSouXia").click()');
    await sleep(120);
    RESULT.findCalls = CALLS.find.slice();
    await ce('(() => { const i = document.getElementById("wangYeSouRu"); i.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); })()');
    await sleep(160);
    RESULT.findClosed = await ce('document.getElementById("wangYeSouHang").hidden');
    await ce('document.getElementById("anNiuWangYeFenLan").click()');
    await sleep(260);
    RESULT.remote = await ce('(() => ({ readOnly: document.getElementById("wangYeYuanWen").readOnly, saveDisabled: document.getElementById("anNiuYuanBaoCun").disabled, replaceDisabled: document.getElementById("anNiuYuanTiHuan").disabled, type: document.getElementById("yuanLeiXing").textContent, srcVisible: !document.getElementById("wangYeYuan").hidden }))()');

    /* ── 第 122 轮：标签页在上 / + 新建 / 关闭叉 / 每标签分栏 / 分隔条 / 远程源码 / 链接开关 ── */
    RESULT.web122 = await ce('(() => { const q = (id) => document.getElementById(id); const order = [...q("wangYeGongJu").children].map((x) => x.id).filter(Boolean); return { tabsAbove: order.indexOf("wangYeHang2") >= 0 && order.indexOf("wangYeHang2") < order.indexOf("wangYeHang1"), plus: !!q("anNiuWangYeTabJia"), closeSvg: !!document.querySelector(".wangYeTab .tabGuan svg"), toggle: q("anNiuWangYeXinBiaoQian").getAttribute("aria-pressed") }; })()');
    // 开关：点击后变“开”，并告诉主进程
    await ce('document.getElementById("anNiuWangYeXinBiaoQian").click()');
    await sleep(150);
    RESULT.xinKaiOn = {
      pressed: await ce('document.getElementById("anNiuWangYeXinBiaoQian").getAttribute("aria-pressed")'),
      call: CALLS.xinKai,
    };
    // 主进程拦截到网页内链接 -> 交给渲染层新建标签页（当前页不跳走）
    const tabsBeforeLink = await ce('document.querySelectorAll(".wangYeTab").length');
    win.webContents.send('warmy:nmWangYeZhuangTai', { id: 1, openInNewTab: 'https://example.org/from-link' });
    await sleep(600);
    RESULT.linkTab = {
      before: tabsBeforeLink,
      after: await ce('document.querySelectorAll(".wangYeTab").length'),
      url: await ce('document.getElementById("wangYeUrl").value'),
    };
    // 当前标签开分栏，等待远程源码显示
    for (let i = 0; i < 4; i += 1) {
      const cls = await ce('document.getElementById("wangYeLie").className');
      if (String(cls).includes('fen1')) break;
      await ce('document.getElementById("anNiuWangYeFenLan").click()');
      await sleep(240);
    }
    await sleep(600);
    RESULT.remoteSource = await ce('(() => { const q = (id) => document.getElementById(id); return { visible: !q("wangYeYuan").hidden, readOnly: q("wangYeYuanWen").readOnly, hasHtml: q("wangYeYuanWen").value.includes("REMOTE-SOURCE"), type: q("yuanLeiXing").textContent, divider: q("wangYeFenGe").hidden === false }; })()');
    // 拖动分隔条：源码宽度必须变化，松手后拖拽类清除
    const basisBefore = await ce('getComputedStyle(document.getElementById("wangYeYuan")).flexBasis');
    await ce('(() => { const d = document.getElementById("wangYeFenGe"); const r = d.getBoundingClientRect(); d.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, clientX: r.left + 3, clientY: r.top + 20 })); document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: r.left + 90, clientY: r.top + 20, buttons: 1 })); document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })); })()');
    await sleep(300);
    RESULT.divider = {
      before: basisBefore,
      after: await ce('getComputedStyle(document.getElementById("wangYeYuan")).flexBasis'),
      body: await ce('document.body.className'),
    };
    // 每个标签页自己的分栏：+ 新建默认 0；切回原标签恢复 fen1
    const tabsBeforePlus = await ce('document.querySelectorAll(".wangYeTab").length');
    await ce('document.getElementById("anNiuWangYeTabJia").click()');
    await sleep(600);
    RESULT.newTab = {
      before: tabsBeforePlus,
      after: await ce('document.querySelectorAll(".wangYeTab").length'),
      url: await ce('document.getElementById("wangYeUrl").value'),
      splitCls: await ce('document.getElementById("wangYeLie").className'),
      dividerHidden: await ce('document.getElementById("wangYeFenGe").hidden'),
    };
    await ce('(() => { const ts = [...document.querySelectorAll(".wangYeTab")]; ts[ts.length - 2]?.click(); })()');
    await sleep(650);
    RESULT.perTabBack = {
      splitCls: await ce('document.getElementById("wangYeLie").className'),
      srcHas: await ce('document.getElementById("wangYeYuanWen").value.includes("REMOTE-SOURCE")'),
    };
    try {
      const nmMod = require(MAIN_JS);
      const m = (x, kai) => nmMod.nmWangYeJianPanDongZuo(x, kai);
      RESULT.keymap = {
        find: m({ type: 'keyDown', key: 'f', control: true }),
        address: m({ type: 'keyDown', key: 'l', meta: true }),
        reload: m({ type: 'keyDown', key: 'F5' }),
        back: m({ type: 'keyDown', key: 'ArrowLeft', alt: true }),
        forward: m({ type: 'keyDown', key: 'ArrowRight', alt: true }),
        print: m({ type: 'keyDown', key: 'p', control: true }),
        escClosed: m({ type: 'keyDown', key: 'Escape' }, false),
        escOpen: m({ type: 'keyDown', key: 'Escape' }, true),
        keyUp: m({ type: 'keyUp', key: 'f', control: true }),
        plain: m({ type: 'keyDown', key: 'a' }),
      };
    } catch (e) { RESULT.keymapErr = String(e && e.stack || e).slice(0, 500); }

    /* ── 3. 只读文字：光标 + 拖动 ── */
    await load('readonly.txt');
    RESULT.textCursor = await ce('(() => { const ta = document.getElementById("wenBen"); const r = ta.getBoundingClientRect(); const on = new PointerEvent("pointermove", { bubbles: true, clientX: r.left + 40, clientY: r.top + 24, pointerId: 1 }); ta.dispatchEvent(on); const a = document.getElementById("juanCuo").classList.contains("nmWenZiShang"); const off = new PointerEvent("pointermove", { bubbles: true, clientX: r.left + r.width - 6, clientY: r.bottom - 6, pointerId: 1 }); ta.dispatchEvent(off); const b = document.getElementById("juanCuo").classList.contains("nmWenZiShang"); return { onText: a, belowText: b }; })()');
    RESULT.textDrag = await ce('(() => { const ta = document.getElementById("wenBen"); const r = ta.getBoundingClientRect(); const down = new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerId: 2, clientX: r.left + r.width - 4, clientY: r.bottom - 4 }); ta.dispatchEvent(down); const drag = document.body.classList.contains("nmTuoZhong"); document.getElementById("zhengWen").dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 2 })); return { started: drag }; })()');
    RESULT.textDragOnText = await ce('(() => { const ta = document.getElementById("wenBen"); const r = ta.getBoundingClientRect(); ta.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerId: 3, clientX: r.left + 40, clientY: r.top + 24 })); const started = document.body.classList.contains("nmTuoZhong"); document.getElementById("zhengWen").dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 3 })); return { started }; })()');
    // 第 81 轮 #6：同一行的右侧留白不算文字（自动换行时最容易误判成"整块都是文字"）
    RESULT.textRight = await ce('(() => { const ta = document.getElementById("wenBen"); const r = ta.getBoundingClientRect(); const x = r.left + r.width - 40; const y = r.top + 24; ta.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: x, clientY: y, pointerId: 4 })); const cursor = document.getElementById("juanCuo").classList.contains("nmWenZiShang"); ta.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerId: 5, clientX: x, clientY: y })); const started = document.body.classList.contains("nmTuoZhong"); document.getElementById("zhengWen").dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 5 })); return { cursor, started }; })()');

    /* ── 4. 视频 ── */
    await load('clip.mp4');
    await sleep(700);
    RESULT.video = await ce('(() => { const v = document.querySelector("#meiTiLie video"); const he = document.querySelector(".shiPinHe"); if (!v || !he) return { found: false }; const vr = v.getBoundingClientRect(); const hr = he.getBoundingClientRect(); const ctl = he.querySelector(".shiPinKongZhi").getBoundingClientRect(); return { found: true, readyState: v.readyState, error: v.error ? v.error.code : null, duration: v.duration, controlsInView: ctl.bottom <= window.innerHeight + 1 && ctl.top >= 0, videoBottom: Math.round(vr.bottom), containerBottom: Math.round(hr.bottom), hasOrigin: v.currentSrc.indexOf("file://") === 0 }; })()');
    RESULT.videoPlay = await ce('document.querySelector("#meiTiLie video").play().then(() => "played").catch((e) => "ERR " + e.name)');
    await sleep(600);
    RESULT.videoAfter = await ce('(() => { const v = document.querySelector("#meiTiLie video"); return { t: v.currentTime, paused: v.paused }; })()');

    /* ── 5. 音频：无标签/静音、有倍速 ── */
    await load('song.mp3');
    RESULT.audio = await ce('(() => { const he = document.querySelector(".yinPinHe"); if (!he) return { found: false }; const sel = he.querySelector(".suDuXuan"); return { found: true, text: he.textContent.replace(/\\s+/g, " ").slice(0, 120), hasMute: !!he.querySelector(".jingYin"), speeds: sel ? [...sel.options].map((o) => o.value) : [], selected: sel ? sel.value : null, name: (he.querySelector(".geQuMing") || {}).textContent }; })()');

    /* ── 6. PPT / PDF / 图片双击全屏 ── */
    await load('demo.pptx');
    await dbl('.pptYe');
    await sleep(350);
    RESULT.fullPpt = await ce('(() => ({ cls: document.querySelector(".pptYe") ? document.querySelector(".pptYe").className : "", fs: !!document.fullscreenElement }))()');
    await load('demo.pdf');
    await dbl('.docYe');
    await sleep(350);
    RESULT.fullPdf = await ce('(() => ({ cls: document.querySelector(".docYe") ? document.querySelector(".docYe").className : "", fs: !!document.fullscreenElement }))()');
    await load('demo.png');
    await sleep(250);
    await dbl('.tuPianHe');
    await sleep(350);
    RESULT.fullImg = await ce('(() => ({ cls: document.querySelector(".tuPianHe") ? document.querySelector(".tuPianHe").className : "", fs: !!document.fullscreenElement }))()');

    /* ── 7. 压缩包：分隔线 + 右侧预览 ── */
    await load('demo.zip');
    RESULT.archive = await ce('(() => { const q = (id) => document.getElementById(id); return { aside: !q("yaSuoBaoLie").hidden, divider: !q("yaSuoFenGe").hidden, w: Math.round(q("yaSuoBaoLie").getBoundingClientRect().width), rows: q("yaSuoShu").querySelectorAll(".yaSuoTiao").length }; })()');
    await ce('(() => { const d = document.getElementById("yaSuoFenGe"); const r = d.getBoundingClientRect(); d.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, clientX: r.left + 2, clientY: r.top + 30 })); document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: r.left + 90, clientY: r.top + 30, buttons: 1 })); document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })); })()');
    await sleep(200);
    RESULT.archiveAfterDrag = await ce('(() => Math.round(document.getElementById("yaSuoBaoLie").getBoundingClientRect().width))()');
    await ce('(() => { const d = document.getElementById("yaSuoFenGe"); d.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); })()');
    await sleep(200);
    RESULT.archiveAfterReset = await ce('(() => Math.round(document.getElementById("yaSuoBaoLie").getBoundingClientRect().width))()');
    await ce('(() => { const rows = [...document.querySelectorAll("#yaSuoShu .yaSuoTiao")]; const r = rows.find((x) => x.textContent.includes("a.txt")); if (r) r.click(); })()');
    await sleep(500);
    RESULT.archivePreview = await ce('(() => { const q = (id) => document.getElementById(id); return { text: (q("wenBen").hidden ? q("kuaiNei").textContent : q("wenBen").value) || "", asideStill: !q("yaSuoBaoLie").hidden, status: q("zhuangTai").textContent }; })()');

    /* ── 8. 吸附纯函数（duiQi=true） ── */
    try {
      const mod = await import(pathToFileURL(${JSON.stringify(MAIN_JS)}).href);
      const K = (x, y, width, height) => ({ x, y, width, height });
      const target = { id: 2, kuang: K(100, 100, 600, 500), zhanYong: {} };
      const right = mod.nmJiSuanSiBianXiFu({ id: 1, kuang: K(710, 180, 400, 300), zhanYong: {} }, [target], 24, null, true);
      const below = mod.nmJiSuanSiBianXiFu({ id: 1, kuang: K(120, 610, 300, 300), zhanYong: {} }, [{ id: 2, kuang: K(100, 100, 600, 500), zhanYong: {} }], 24, null, true);
      RESULT.snap = {
        right: { bi: right.bian, x: right.zhu && right.zhu.x, y: right.zhu && right.zhu.y, h: right.zhu && right.zhu.height, linH: right.lin && right.lin.height },
        below: { bi: below.bian, x: below.zhu && below.zhu.x, w: below.zhu && below.zhu.width, y: below.zhu && below.zhu.y },
        legacy: (() => { const r = mod.nmJiSuanSiBianXiFu({ id: 1, kuang: K(710, 180, 400, 300) }, [target], 24, null); return { h: r.zhu && r.zhu.height }; })(),
      };
    } catch (e) { RESULT.snapErr = String(e && e.message || e).slice(0, 300); }
  } catch (e) {
    RESULT.err = String(e && e.stack || e).slice(0, 800);
  }
  RESULT.calls = CALLS;
  RESULT.__done = true;
  emit();
});
`;

fs.writeFileSync(mainPath, mainSrc, 'utf8');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.ELECTRON_ENABLE_LOGGING = '0';
const run = spawnSync(ELECTRON, [mainPath], {
  cwd: dir,
  encoding: 'utf8',
  timeout: 150000,
  env,
});
const out = String(run.stdout || '') + '\n' + String(run.stderr || '');
const m = /R81_NM (\{[\s\S]*\})/.exec(out);
if (!m) {
  console.error('[verify-r81-nm] 没有拿到结果');
  console.error(out.slice(-4000));
  process.exit(2);
}
let data;
try { data = JSON.parse(m[1]); } catch (e) {
  console.error('[verify-r81-nm] 结果 JSON 解析失败', e.message);
  console.error(m[1].slice(0, 4000));
  process.exit(2);
}

/* ───────── 断言 ───────── */
{
  const t = data.toolbar || {};
  jian('工具栏：保存按钮是纯图标（无文字、有 svg）', t.saveText === '' && t.saveSvg === true && t.saveW <= 40, JSON.stringify(t));
  jian('工具栏：撤销右侧直接是「前进」按钮（无下拉）', t.undoNext === 'anNiuQianJin' && t.qianjinVisible === true && !/xiaLa/.test(t.qianjinClass || ''), JSON.stringify(t));
  jian('工具栏：自动换行紧挨在缩放左侧', t.wrapNext === 'suoFangZu', t.wrapNext);
  jian('工具栏：删掉新建网页 / 网页卡 / 后退下拉 / 悬停系统打开', t.removed && t.removed.newPage && t.removed.pageCard && t.removed.histDrop && t.removed.sysHover, JSON.stringify(t.removed));
}
{
  const n = data.noMatch || {};
  jian('无匹配：显示图标而不是「无匹配」文字', n.text === '' && n.svg === true && n.title === '无匹配', JSON.stringify(n));
}
{
  const r = data.twoRow || {};
  jian('替换框最小宽度 ≥120px', Number(r.replaceW) >= 120, r.replaceW);
  jian('窄窗时工具栏两行，替换框落到第二行并与查找框左对齐', r.twoRows === true && r.inRow2 === true && Math.abs(Number(r.align)) <= 3, JSON.stringify(r));
}
{
  const d = data.dirMenu || {};
  jian('目录选项里有「打开网站」', d.open === true && Array.isArray(d.labels) && d.labels.some((x) => x.includes('打开网站')), JSON.stringify(d.labels));
}
{
  const c = data.ctxEditable || {};
  const want = ['撤销', '重做（前进）', '剪切', '复制', '粘贴', '全选', '插入对话'];
  jian('右键菜单：存在且顺序为 撤销/重做/剪切/复制/粘贴/全选/插入对话', c.open === true && JSON.stringify(c.labels) === JSON.stringify(want), JSON.stringify(c.labels));
  jian('右键菜单：可编辑区域里撤销/重做/粘贴可用', Array.isArray(c.disabled) && c.disabled[0] === false && c.disabled[1] === false && c.disabled[4] === false, JSON.stringify(c.disabled));
}
{
  const w = data.web || {};
  jian('网站模式：工具栏打开且分两行', w.open === true && w.row2HasTabs === true, JSON.stringify(w));
  jian('网站模式第一行顺序：后退/前进/刷新/地址栏/历史/新标签页/分栏/下载/关闭', JSON.stringify(w.row1) === JSON.stringify(['anNiuWangYeHou', 'anNiuWangYeQian', 'anNiuWangYeShua', 'wangYeUrl', 'anNiuWangYeLiShi', 'anNiuWangYeXinBiaoQian', 'anNiuWangYeFenLan', 'anNiuWangYeXiaZai', 'anNiuWangYeGuan']), JSON.stringify(w.row1));
  jian('网站模式第二行：标签页 + 左右箭头', w.tabs >= 1 && w.arrows === true, JSON.stringify(w));
  jian('网站模式默认「只网页」（源码区隐藏）', w.srcHiddenInitially === true, JSON.stringify(w));
  const w122 = data.web122 || {};
  jian('网站模式：标签页在地址栏上方', w122.tabsAbove === true, JSON.stringify(w122));
  jian('标签页行有 + 新建按钮，关闭叉是 svg', w122.plus === true && w122.closeSvg === true, JSON.stringify(w122));
  jian('「在新标签页打开」是开关（点击后 aria-pressed=true 且通知主进程）', data.xinKaiOn?.pressed === 'true' && data.xinKaiOn?.call === true, JSON.stringify(data.xinKaiOn));
  jian('主进程拦到的链接在 nm 内新建标签页，当前页 URL 不跳走', data.linkTab?.after === data.linkTab?.before + 1 && data.linkTab?.url === 'https://example.org/from-link', JSON.stringify(data.linkTab));
  jian('远程网页只读模式下能看到源码（渲染后的 HTML）', data.remoteSource?.visible === true && data.remoteSource?.readOnly === true && data.remoteSource?.hasHtml === true, JSON.stringify(data.remoteSource));
  jian('分栏分隔条可拖动且松手后拖拽类清除', data.remoteSource?.divider === true && data.divider?.after !== data.divider?.before && !/tuoWangYeFenGe/.test(String(data.divider?.body || '')), JSON.stringify(data.divider));
  jian('+ 默认打开 numumu.com，且新标签默认不分栏', data.newTab?.after === data.newTab?.before + 1 && data.newTab?.url === 'https://www.numumu.com/' && !/fen[123]/.test(String(data.newTab?.splitCls || '')) && data.newTab?.dividerHidden === true, JSON.stringify(data.newTab));
  jian('分栏按标签页各自保存（切回原标签恢复自己的分栏）', /fen1/.test(String(data.perTabBack?.splitCls || '')) && data.perTabBack?.srcHas === true, JSON.stringify(data.perTabBack));
  try {
    const winSrc = fs.readFileSync(path.join(PKG, 'src/nm-viewer-win.ts'), 'utf8');
    const cssSrc = fs.readFileSync(path.join(PKG, 'src/renderer/nm-viewer.css'), 'utf8');
    jian('主进程：开关开启时 will-navigate 改为新标签页', /if \(Z\.wangYeXinKai\)[\s\S]{0,220}e\.preventDefault\(\)[\s\S]{0,160}openInNewTab/.test(winSrc));
    jian('主进程：target=_blank 交回渲染层新标签页', /setWindowOpenHandler[\s\S]{0,360}openInNewTab/.test(winSrc));
    jian('关闭叉平时隐身、悬停才出现、无外框', /#wangYeGongJu \.wangYeTab \.tabGuan \{[\s\S]*?opacity: 0;/.test(cssSrc)
      && /#wangYeGongJu \.wangYeTab \.tabGuan:hover,[\s\S]{0,200}opacity: 1;/.test(cssSrc)
      && /#wangYeGongJu \.wangYeTab \.tabGuan:hover,[\s\S]{0,220}background: transparent;/.test(cssSrc));
  } catch (e) { jian('第 122 轮静态断言可读源码', false, String(e)); }
}
{
  const p = data.srcPane || {};
  jian('本地网页分栏后源码可见、可编辑，且是 2 行工具栏 + 图标保存', p.visible === true && p.readOnly === false && Array.isArray(p.rows) && p.rows.length === 2 && p.rows.every((h) => h > 10) && p.save === true, JSON.stringify(p));
}
{
  const s = Array.isArray(data.split) ? data.split : [];
  const cls = s.map((x) => x.cls);
  const accent = '168, 118, 84';
  jian('分栏 4 态循环：fen0 → fen1 → fen2 → fen3', cls[0] === '' || !/fen/.test(cls[0]), JSON.stringify(cls));
  jian('分栏 4 态 class 依次为 无/fen1/fen2/fen3', /fen1/.test(cls[1] || '') && /fen2/.test(cls[2] || '') && /fen3/.test(cls[3] || ''), JSON.stringify(cls));
  jian('分栏状态色：只网页=正常色，其余 3 态=主题色', s[0] && s[0].pressed === 'false' && s.slice(1).every((x) => x.pressed === 'true' && String(x.color).includes(accent)), JSON.stringify(s.map((x) => [x.pressed, x.color])));
  jian('分栏=0 时源码区隐藏，>0 时显示', s[0].srcHidden === true && s.slice(1).every((x) => x.srcHidden === false), JSON.stringify(s.map((x) => x.srcHidden)));
}
{
  const i = data.instant || {};
  jian('本地源码改动即时反映到网页预览（未保存也跟随）', i.srcdocHasChange === true, JSON.stringify(i));
  jian('未保存改动在标题/标签页有标记', /●/.test(i.title || '') || i.tabDot === true, JSON.stringify(i));
  jian('有未保存改动时切换分栏会提醒', data.dirtyDlg === true, data.dirtyDlg);
  jian('选择「不保存继续」后提醒关闭、脏标记清除', data.afterDiscard && data.afterDiscard.dlg === true && !/●/.test(data.afterDiscard.title || ''), JSON.stringify(data.afterDiscard));
  jian('源码保存走现有 nmBaoCun（保存后清除脏标记）', data.srcSave && data.srcSave.called === true && !/●/.test(data.srcSave.title || ''), JSON.stringify(data.srcSave));
  jian('「保存」下拉里有另存为/自动保存，且自动保存默认不勾', data.autoSave && data.autoSave.hasCheck === true && data.autoSave.checked === false && data.autoSave.labels.some((x) => x.includes('另存为')) && data.autoSave.labels.some((x) => x.includes('自动保存')), JSON.stringify(data.autoSave));
  jian('远程网页：源码只读且保存/替换禁用', data.remote && data.remote.readOnly === true && data.remote.saveDisabled === true && data.remote.replaceDisabled === true, JSON.stringify(data.remote));
  const rn1 = data.remoteNav1 || {};
  const rn2 = data.remoteNav2 || {};
  jian('远程网页：后退/前进按主进程导航状态启用', rn1.back === false && rn1.fwd === true, JSON.stringify(rn1));
  jian('远程网页：后退后前进按钮启用（状态真的会变）', rn2.back === true && rn2.fwd === false, JSON.stringify(rn2));
  jian('远程网页：查找条默认收起', rn1.findHidden === true, JSON.stringify(rn1));
  jian('远程网页：导航状态事件不会触发视图/导航 IPC 自激循环', Number(data.viewCount2) - Number(data.viewCount1) <= 2, { c1: data.viewCount1, c2: data.viewCount2 });
  jian('远程网页：Ctrl+F 打开查找条并聚焦输入框', data.findOpen && data.findOpen.hidden === false && data.findOpen.focused === 'wangYeSouRu', JSON.stringify(data.findOpen));
  jian('远程网页：匹配数接到工具栏（2/3）', data.findCount === '2/3', data.findCount);
  jian('远程网页：下一个按钮再次发起查找', (data.findCalls || []).filter((x) => x === 'needle').length >= 2, JSON.stringify(data.findCalls));
  jian('远程网页：Esc 收起查找条并清空查找', data.findClosed === true, data.findClosed);
  const km = data.keymap || {};
  jian('远程页快捷键映射：Ctrl+F/地址栏/刷新/前后退/打印',
    km.find === 'find' && km.address === 'address' && km.reload === 'reload' && km.back === 'back' && km.forward === 'forward' && km.print === 'print',
    JSON.stringify([km, data.keymapErr]));
  jian('远程页快捷键映射：Esc 只在查找打开时接管（不抢网页自己的 Esc）',
    km.escClosed === '' && km.escOpen === 'escape', JSON.stringify(km));
  jian('远程页快捷键映射：按键抬起/普通字母不拦截', km.keyUp === '' && km.plain === '', JSON.stringify(km));
}
{
  const c = data.textCursor || {};
  const d = data.textDrag || {};
  const d2 = data.textDragOnText || {};
  jian('只读文字：鼠标在字上显示 text 光标（nmWenZiShang）', c.onText === true, JSON.stringify(c));
  jian('只读文字：鼠标不在文字上不显示 text 光标', c.belowText === false, JSON.stringify(c));
  jian('只读文字：文字外拖动画面（进入 nmTuoZhong）', d.started === true, JSON.stringify(d));
  jian('只读文字：文字上拖动不接管（保留框选）', d2.started === false, JSON.stringify(d2));
  jian('只读文字：同一行右侧留白不算文字（光标不是 text、可以拖画面）',
    data.textRight && data.textRight.cursor === false && data.textRight.started === true, JSON.stringify(data.textRight));
}
{
  const v = data.video || {};
  jian('视频：能加载元数据（readyState=4、无 error、有 duration）', v.found === true && v.readyState === 4 && v.error === null && Number(v.duration) > 0, JSON.stringify(v));
  jian('视频：控制条在视口内（不再被高视频顶出屏幕）', v.controlsInView === true, JSON.stringify(v));
  jian('视频：能真正播放（play 成功且 currentTime 前进）', data.videoPlay === 'played' && data.videoAfter && data.videoAfter.t > 0.05 && data.videoAfter.paused === false, JSON.stringify([data.videoPlay, data.videoAfter]));
}
{
  const a = data.audio || {};
  const su = ['0.1', '0.2', '0.5', '1', '1.5', '2', '2.5', '3', '5'];
  jian('音乐：没有「音乐 · 只读」文字、没有静音按钮', a.found === true && !/音乐 · 只读/.test(a.text || '') && a.hasMute === false, JSON.stringify(a));
  jian('音乐：倍速选项 0.1/0.2/0.5/1/1.5/2/2.5/3/5，默认 1×', JSON.stringify(a.speeds) === JSON.stringify(su) && a.selected === '1', JSON.stringify(a.speeds));
}
{
  jian('PPT 双击全屏（.pptYe.quanPing 或 Fullscreen）', /quanPing/.test((data.fullPpt || {}).cls || '') || (data.fullPpt || {}).fs === true, JSON.stringify(data.fullPpt));
  jian('PDF 双击全屏（.docYe.quanPing 或 Fullscreen）', /quanPing/.test((data.fullPdf || {}).cls || '') || (data.fullPdf || {}).fs === true, JSON.stringify(data.fullPdf));
  jian('图片双击全屏（.tuPianHe.quanPing 或 Fullscreen）', /quanPing/.test((data.fullImg || {}).cls || '') || (data.fullImg || {}).fs === true, JSON.stringify(data.fullImg));
}
{
  const a = data.archive || {};
  jian('压缩包：左树 + 可拖动分隔线都显示', a.aside === true && a.divider === true && a.rows >= 2, JSON.stringify(a));
  jian('压缩包：拖动分隔线能改变左侧宽度', Number(data.archiveAfterDrag) > Number(a.w) + 20, JSON.stringify([a.w, data.archiveAfterDrag]));
  jian('压缩包：双击分隔线恢复默认宽度', Math.abs(Number(data.archiveAfterReset) - Number(a.w)) <= 6, JSON.stringify([a.w, data.archiveAfterReset]));
  jian('压缩包：点条目在右侧预览出内容，左树保留', /ZIPPREVIEW/.test((data.archivePreview || {}).text || '') && (data.archivePreview || {}).asideStill === true, JSON.stringify(data.archivePreview));
}
{
  const s = data.snap || {};
  jian('吸附（左/右贴）：高度对齐目标、顶边对齐、不留缝', s.right && s.right.bi === 'zuo' && s.right.x === 700 && s.right.y === 100 && s.right.h === 500, JSON.stringify(s.right));
  jian('吸附（上/下贴）：宽度对齐目标、左边对齐、不留缝', s.below && s.below.bi === 'shang' && s.below.y === 600 && s.below.x === 100 && s.below.w === 600, JSON.stringify(s.below));
  jian('吸附：目标窗自身尺寸不被改动（lin 仍是 600×500）', s.right && s.right.linH === 500, JSON.stringify(s.right));
  jian('旧语义保持：duiQi 默认 false 时并排取最大高度', s.legacy && s.legacy.h === 500, JSON.stringify(s.legacy));
  jian('吸附纯函数可用（可脱机断言）', !data.snapErr, data.snapErr);
  const WIN_SRC = fs.readFileSync(path.join(PKG, 'src/nm-viewer-win.ts'), 'utf8');
  jian('真实拖动/缩放结束都按 duiQi=true 吸附（左右高度一致、上下宽度一致）',
    (WIN_SRC.match(/nmJiSuanSiBianXiFu\(/g) || []).length >= 2
    && /gongZuoQuOf\(b\),\s*\n\s*true,/.test(WIN_SRC));
  jian('缩放只维护本窗共享边，不联动改其它窗尺寸（拉伸一个，其它不变）',
    /function shouLianYiBian[\s\S]{0,1400}sheZhiBianKuang\(Z,/.test(WIN_SRC)
    && !/function shouLianYiBian[\s\S]{0,1400}sheZhiBianKuang\(o,/.test(WIN_SRC));
  jian('第 97 轮：新 nm 窗口永远贴主窗口右侧、高度与主窗口一致（右侧已占则重叠且不吸附）',
    /let x = zb\.x \+ zb\.width/.test(WIN_SRC)
    && /let gao2 = Math\.max\(300, zb\.height\)/.test(WIN_SRC)
    && /const youBianKong = zhu\.xiFu && zhu\.bian\.you == null/.test(WIN_SRC)
    && !/zuiYouCeLian/.test(WIN_SRC));
  jian('第 97 轮：拖 nm 不反向拖主窗口（主窗口只由用户自己移动）',
    /if \(id === NM_ZHU_CHUANG_ID && Z\.id !== NM_ZHU_CHUANG_ID\) return \[\]/.test(WIN_SRC));
}

if (data.err) console.log('  [页面异常] ' + String(data.err).slice(0, 600));
if (data.timeout) console.log('  [警告] 主进程看门狗超时');
console.log('\n[verify-r81-nm] ' + okN + ' 通过 / ' + failN + ' 失败');
if (failN) {
  console.log('DIAG ' + JSON.stringify({
    toolbar: data.toolbar, noMatch: data.noMatch, twoRow: data.twoRow, web: data.web,
    split: data.split, video: data.video, archive: data.archive, snap: data.snap,
    srcSave: data.srcSave, afterDiscard: data.afterDiscard, remote: data.remote,
    remoteNav1: data.remoteNav1, remoteNav2: data.remoteNav2, remoteNavCalls: data.remoteNavCalls,
    findOpen: data.findOpen, findCount: data.findCount, findCalls: data.findCalls, findClosed: data.findClosed,
    err: data.err, log: data.log,
  }).slice(0, 6000));
  process.exit(1);
}
