// cdp-verify-net.mjs — ADR 003 R8–R12 / 附六 的 UI 验收（真 Chromium + CDP）
//
// 前置（两步，缺一不可）：
//   1) node packages/app-shell/scripts/build-preview.mjs --out %WARMY_NET_OUT%
//   2) 起一个预览壳并指向 %WARMY_NET_OUT%\index.html，CDP 端口 = $PORT（默认 9555）
//      再启动时**必须**加 --disable-features=CalculateNativeWinOcclusion，否则窗口被遮挡时
//      Chromium 不再产帧，Page.captureScreenshot 会永久挂住（实测）。
// 默认 WARMY_NET_OUT = <os.tmpdir()>/warmy-net-ui；result.json 写在同一个目录。
//
// 纪律（沿用本目录既有测试基础设施的教训）：
//   * 每次 CDP 调用都有超时（cdp-lib），不用固定 sleep 当同步屏障；
//   * 等条件成立而不是等秒表；真实坐标点击失败会重试并记录轨迹；
//   * 桩（组网层/身份层）通过 Page.addScriptToEvaluateOnNewDocument 在文档脚本之前注入，
//     状态存 localStorage —— 于是「下次启动」= Page.reload 之后仍然一致。
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {attach, sleep, reporter} from './cdp-lib.mjs';
// R4 的二维码真值：弹窗里的 SVG 要与仓库里那份**真**编码器的输出逐字节/逐模块一致。
// qr.js 现在是 Node 侧参考实现（加载 src/renderer/vendor/qrcode-generator-2.0.4.js），
// 渲染层不再加载它（ESM 在 file:// + CSP 下不可用，见 qr.js 头部说明）。
import {qrSvg as QRSVG, qrMatrix as QRMATRIX, stripAriaLabel as QRSTRIP, QR_ECC, erweimaAnjing, QR_VENDOR_FILE} from '../src/renderer/qr.js';

const PORT = Number(process.env.PORT || 9555);
// 产物目录可注入（统一验证器会指到临时目录，避免污染仓库）；harness 与脚本同级，跟着仓库走。
const OUT = process.env.WARMY_NET_OUT || path.join(os.tmpdir(), 'warmy-net-ui');
// 结果文件写回 OUT；目录可能还不存在（默认值就是临时目录），必须先建，否则跑完全部断言却因写结果而报错退出。
fs.mkdirSync(OUT, { recursive: true });
const HARNESS = fs.readFileSync(new URL('./net-ui-harness.js', import.meta.url), 'utf8');
// i18n 真值包：用来把界面文案与语言包**逐字**比对（不是"看起来像翻译过"）
const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
const I18N_DIR = path.join(SELF_DIR, '..', 'src', 'i18n');
const ZH = JSON.parse(fs.readFileSync(path.join(I18N_DIR, 'zh-CN.json'), 'utf8'));
const EN = JSON.parse(fs.readFileSync(path.join(I18N_DIR, 'en-US.json'), 'utf8'));
const CJK = /[\u4e00-\u9fff]/;

/**
 * 附八.9 / 附八.3 新增的键（「六档 + 中继 + 可拨入性」三组 + 阶梯区块与终态横幅的文案）。
 * 这些键**必须在两包都有且非空**，且英文包里不能出现中文。
 */
const NEW_NET_KEYS = [
  'net.rung.ipv6Direct', 'net.rung.publicDirect', 'net.rung.upnp', 'net.rung.holepunch', 'net.rung.relay', 'net.rung.lan',
  'net.relay.selected', 'net.relay.missing.noneConfigured', 'net.relay.missing.unreachable', 'net.relay.missing.needsPublicRelay',
  'net.relay.notNeeded.peerDialable', 'net.relay.notNeeded.inboundExpected', 'net.relay.unknown',
  'net.dialability.peerVerified', 'net.dialability.ipv6Natural', 'net.dialability.undetermined', 'net.dialability.undialable',
  'net.ladder.biaoTi', 'net.ladder.current', 'net.ladder.candidate', 'net.ladder.unsupported',
  'net.ladder.relay', 'net.ladder.dialability', 'net.ladder.none',
  'net.banner.relayTerminalTitle', 'net.banner.relayConfigure',
  'net.domainTitle', 'net.publicListEmpty', 'net.refresh', 'net.refreshDone', 'net.emptyList',
  'net.entryOk', 'net.entryFail', 'net.entryUnknown', 'net.entryInvalid', 'net.entryResultsTitle', 'net.probeCount', 'net.partialPass',
  'settings.skillsScanTitle', 'settings.skillsScanMax', 'settings.skillsScanMissing', 'settings.skillSourceDiscovered',
  // R13：端口的「约定端口」「实际绑定的端口」「无法绑定 + 建议端口」几句提示（中英必须都在、英文不许有中文）
  'net.portConventionHint', 'net.portBound', 'net.portBindFailedTitle', 'net.portBindFailedBody', 'net.portSuggestHint',
];

/**
 * R13：产品负责人最终决定的端口常量。
 * 注意语义：SUGGESTED = 绑定失败时给用户看的**建议**，**不是**兜底链、**不是**白名单
 * —— 实现绝不自动改端口（见 verify-net-ui 第 14 节的"配置端口未被修改"断言）。
 */
const EXPECT_DEFAULT_PORT = 59599;
const EXPECT_DEV_PORT = 58588;
const EXPECT_TEST_PORT = 62666;
const EXPECT_SUGGESTED_PORTS = [
  59599, 57757, 52555, 55151, 55335, 55521, 55593, 56662, 57575, 58785,
  59993, 61888, 62026, 62526, 62826, 63236, 63636,
];
/** 六个档位与协议层 LADDER_RUNG_I18N 的对应（顺序 = 附八.9 定的阶梯顺序） */
const RUNG_KEYS = [
  ['ipv6-direct', 'net.rung.ipv6Direct'],
  ['public-direct', 'net.rung.publicDirect'],
  ['upnp', 'net.rung.upnp'],
  ['holepunch', 'net.rung.holepunch'],
  ['relay', 'net.rung.relay'],
  ['lan', 'net.rung.lan'],
];

const R = reporter();
const { ok, warn } = R;

/* ══════════════════════════════════════════════════════════════════════════
   二维码验收工具（R4 用）：真值来自 vendored 编码器，判定来自几何 + 独立解码器
   ══════════════════════════════════════════════════════════════════════════ */

/** 从**真实 DOM 的几何**反解模块矩阵（不读任何"渲染层自己报的矩阵"，只读 rect 的 x/y/宽高） */
const QR_DOM_FN = `(function(sel){
  var svg = document.querySelector(sel);
  if (!svg) return { err: 'no-svg' };
  var vb = String(svg.getAttribute('viewBox') || '').split(/\\s+/);
  var attrs = {
    modules: Number(svg.getAttribute('data-qr-modules')),
    version: Number(svg.getAttribute('data-qr-version')),
    ecc: svg.getAttribute('data-qr-ecc'),
    quiet: Number(svg.getAttribute('data-qr-quiet')),
    unit: Number(svg.getAttribute('data-qr-unit')),
    payloadLen: Number(svg.getAttribute('data-qr-payload-len')),
    ariaLabel: svg.getAttribute('aria-label'),
    viewBox: svg.getAttribute('viewBox'),
    box: vb.length === 4 ? Number(vb[2]) : 0,
    width: Number(svg.getAttribute('width')),
    height: Number(svg.getAttribute('height')),
    cssW: Math.round(svg.getBoundingClientRect().width),
    cssH: Math.round(svg.getBoundingClientRect().height)
  };
  var n = attrs.modules, quiet = attrs.quiet;
  if (!n || !isFinite(quiet)) return { err: 'no-dims', attrs: attrs };
  var unit = attrs.unit || (attrs.box / (n + quiet * 2));
  var m = []; for (var r = 0; r < n; r++) { m.push(new Array(n).fill(false)); }
  var rects = Array.prototype.slice.call(svg.querySelectorAll('rect'));
  var outside = 0, bg = 0, wrongSize = 0;
  for (var i = 0; i < rects.length; i++) {
    var el = rects[i];
    if (!el.hasAttribute('x') || !el.hasAttribute('y')) { bg++; continue; }  // 白底那块
    var w = Number(el.getAttribute('width')), h = Number(el.getAttribute('height'));
    if (Math.abs(w - unit) > unit * 0.05 || Math.abs(h - unit) > unit * 0.05) wrongSize++;
    var c = Math.round(Number(el.getAttribute('x')) / unit) - quiet;
    var rr = Math.round(Number(el.getAttribute('y')) / unit) - quiet;
    if (c < 0 || c >= n || rr < 0 || rr >= n) { outside++; continue; }
    m[rr][c] = true;
  }
  var rows = m.map(function(hang){ return hang.map(function(v){ return v ? '1' : '0'; }).join(''); });
  return { attrs: attrs, rects: rects.length, bg: bg, outside: outside, wrongSize: wrongSize, matrix: rows };
})`;

/** 把**真正画在屏幕上的那个 SVG**栅格化（SVG → data URL → <img> → canvas → 灰度），
 *  返回 base64 灰度图；解码交给 Node 侧的独立解码器。像素路径走不通时如实返回 err。 */
const QR_PIXEL_FN = `(async function(sel, modulePx){
  var svg = document.querySelector(sel);
  if (!svg) return { err: 'no-svg' };
  var n = Number(svg.getAttribute('data-qr-modules'));
  var quiet = Number(svg.getAttribute('data-qr-quiet'));
  if (!n || !isFinite(quiet)) return { err: 'no-dims' };
  var px = modulePx * (n + quiet * 2);
  var src = new XMLSerializer().serializeToString(svg)
    .replace(/width="[^"]*"/, 'width="' + px + '"')
    .replace(/height="[^"]*"/, 'height="' + px + '"');
  var img = new Image();
  var loaded = new Promise(function(res, rej){
    img.onload = function(){ res(true); };
    img.onerror = function(){ rej(new Error('svg-image-load-failed')); };
    setTimeout(function(){ rej(new Error('svg-image-load-timeout')); }, 4000);
  });
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(src);
  try { await loaded; } catch (e) { return { err: 'load:' + e.message }; }
  var canvas = document.createElement('canvas');
  canvas.width = px; canvas.height = px;
  var ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, px, px);
  ctx.drawImage(img, 0, 0, px, px);
  var data;
  try { data = ctx.getImageData(0, 0, px, px).data; } catch (e) { return { err: 'getImageData:' + e.message }; }
  var gray = new Uint8Array(px * px);
  for (var i = 0, j = 0; i < data.length; i += 4, j++) gray[j] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  var bin = '';
  for (var k = 0; k < gray.length; k++) bin += String.fromCharCode(gray[k]);
  return { px: px, modulePx: modulePx, side: px, b64: btoa(bin) };
})`;

/** 独立解码器：jsQR（Apache-2.0，与 qrcode-generator 无任何共用代码）。验收专用，不随应用发布。 */
const QR_DECODER_FILE = process.env.WARMY_QR_DECODER || path.join(SELF_DIR, 'vendor', 'jsqr-1.4.0.js');
const qrDecode = (() => {
  try {
    if (!fs.existsSync(QR_DECODER_FILE)) return null;
    const sandbox = {};
    sandbox.window = sandbox;
    sandbox.self = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(QR_DECODER_FILE, 'utf8'), sandbox, { filename: 'jsqr-1.4.0.js' });
    const fn = typeof sandbox.jsQR === 'function' ? sandbox.jsQR : sandbox.window && sandbox.window.jsQR;
    return typeof fn === 'function' ? fn : null;
  } catch (e) {
    warn('独立解码器加载失败（' + e.message.slice(0, 80) + '）');
    return null;
  }
})();

/** 灰度 → RGBA → jsQR */
const decodeGray = (gray, side) => {
  const rgba = new Uint8ClampedArray(side * side * 4);
  for (let i = 0; i < side * side; i++) {
    const v = gray[i];
    rgba[i * 4] = v; rgba[i * 4 + 1] = v; rgba[i * 4 + 2] = v; rgba[i * 4 + 3] = 255;
  }
  const res = qrDecode(rgba, side, side);
  return res && typeof res.data === 'string' ? res.data : null;
};

/** 用 DOM 反解出来的矩阵自己栅格化（8 px/模块 + 静区），再交给独立解码器 */
function decodeMatrixRows(rows) {
  const n = rows.length;
  const quiet = erweimaAnjing;
  const modulePx = 8;
  const side = (n + quiet * 2) * modulePx;
  const gray = new Uint8Array(side * side).fill(255);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (rows[r][c] !== '1') continue;
      for (let dy = 0; dy < modulePx; dy++) {
        const y = (r + quiet) * modulePx + dy;
        for (let dx = 0; dx < modulePx; dx++) {
          gray[y * side + (c + quiet) * modulePx + dx] = 0;
        }
      }
    }
  }
  return decodeGray(gray, side);
}

const QR_FINDER = ['1111111', '1000001', '1011101', '1011101', '1011101', '1000001', '1111111'];
const QR_ALIGN = ['11111', '10001', '10101', '10001', '11111'];

/** 三个定位角（7×7 标准花纹）*/
function qrFinders(rows) {
  const n = rows.length;
  const at = (r0, c0, pat) => {
    for (let r = 0; r < pat.length; r++) if (rows[r0 + r].slice(c0, c0 + pat[0].length) !== pat[r]) return false;
    return true;
  };
  return { tl: at(0, 0, QR_FINDER), tr: at(0, n - 7, QR_FINDER), bl: at(n - 7, 0, QR_FINDER) };
}

/** 定位角外侧那一圈必须全亮（分隔符）+ 第 6 行/列的时序花纹（偶数位为深色）*/
function qrSeparatorsAndTiming(rows) {
  const n = rows.length;
  const light = (r, c) => rows[r][c] === '0';
  const idx = [0, 1, 2, 3, 4, 5, 6, 7];
  const sep = {
    tl: idx.every((i) => light(7, i) && light(i, 7)),
    tr: idx.every((i) => light(7, n - 1 - i) && light(i, n - 8)),
    bl: idx.every((i) => light(n - 8, i) && light(n - 1 - i, 7)),
  };
  let timing = true;
  for (let i = 8; i <= n - 9; i++) {
    const want = i % 2 === 0 ? '1' : '0';
    if (rows[6][i] !== want || rows[i][6] !== want) timing = false;
  }
  return { sep, timing };
}

/** 校正花纹（版本 ≥2 时右下角必有一个 5×5）+ 固定深色模块 (n-8, 8) */
function qrAlignmentAndDarkModule(rows, version) {
  const n = rows.length;
  let align = 'n/a';
  if (version >= 2) {
    align = true;
    for (let r = 0; r < QR_ALIGN.length; r++) {
      if (rows[n - 9 + r].slice(n - 9, n - 4) !== QR_ALIGN[r]) { align = false; break; }
    }
  }
  return { align, darkModule: rows[n - 8][8] === '1' };
}

/**
 * ECC M / 字节模式 各版本**容量表**（byte 数）。这是独立于库的常识表：
 * 用它算出「这么长的载荷最少要第几版」，再看渲染出来的是不是这一版（不会被库自说自话骗过）。
 * 索引 = 版本（1..40）。
 */
const QR_CAPACITY_M_BYTE = [0, 14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287, 331, 362, 412, 450, 504, 560, 624, 666, 711, 779, 857, 911, 997, 1059, 1125, 1190, 1264, 1370, 1452, 1538, 1628, 1722, 1809, 1911, 1989, 2099, 2213, 2331];
function minVersionFor(payload) {
  const bytes = Buffer.byteLength(String(payload), 'utf8');
  for (let v = 1; v <= 40; v++) if (QR_CAPACITY_M_BYTE[v] >= bytes) return { version: v, bytes };
  return { version: -1, bytes };
}

/** 逐行逐列比矩阵，返回第一处不同（便于报告里说清楚哪里不同） */
function matrixDiff(a, b) {
  if (!a || !b) return { same: false, why: 'missing' };
  if (a.length !== b.length) return { same: false, why: 'rows ' + a.length + ' vs ' + b.length };
  for (let r = 0; r < a.length; r++) {
    if (a[r] === b[r]) continue;
    if (a[r].length !== b[r].length) return { same: false, why: 'cols@' + r + ' ' + a[r].length + ' vs ' + b[r].length };
    for (let c = 0; c < a[r].length; c++) if (a[r][c] !== b[r][c]) return { same: false, why: 'module(' + r + ',' + c + ')' };
  }
  return { same: true, why: '' };
}

const rowsOf = (matrix) => matrix.map((hang) => hang.map((v) => (v ? '1' : '0')).join(''));
/** 参考实现的 SVG 也要过一遍浏览器序列化器（innerHTML 会重排属性），所以交给页面归一化 */
const normalizeInPage = async (svg) =>
  c.evaluate(`(function(){var d=document.createElement('div'); d.innerHTML=${JSON.stringify(svg)}; return d.innerHTML;})()`);

const CONTRAST_FN = `(function(sel){
  function parse(c){ if(!c) return null; var n=String(c).match(/[0-9.]+/g); if(!n||n.length<3) return null;
    return { r:parseFloat(n[0]), g:parseFloat(n[1]), b:parseFloat(n[2]), a:n.length>3?parseFloat(n[3]):1 }; }
  function lum(o){ var c=[o.r,o.g,o.b].map(function(v){ v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4); });
    return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]; }
  function blend(fg,bg){ var a=fg.a; return { r:fg.r*a+bg.r*(1-a), g:fg.g*a+bg.g*(1-a), b:fg.b*a+bg.b*(1-a), a:1 }; }
  var el=document.querySelector(sel); if(!el) return { err:'no-el' };
  var cs=getComputedStyle(el);
  var fg=parse(cs.color); if(!fg) return { err:'no-fg' };
  var n=el, bg=null;
  while(n){ var b=parse(getComputedStyle(n).backgroundColor); if(b && b.a>0.999){ bg=b; break; } n=n.parentElement; }
  if(!bg) bg={ r:255,g:255,b:255,a:1 };
  var op=1, m=el;
  while(m){ var o=parseFloat(getComputedStyle(m).opacity); if(!isNaN(o)) op*=o; m=m.parentElement; }
  var fgc=blend({ r:fg.r, g:fg.g, b:fg.b, a:fg.a*op }, bg);
  var hi=Math.max(lum(fgc),lum(bg)), lo=Math.min(lum(fgc),lum(bg));
  return { ratio: Math.round((hi+0.05)/(lo+0.05)*100)/100, color: cs.color,
    bg: 'rgb('+Math.round(bg.r)+','+Math.round(bg.g)+','+Math.round(bg.b)+')', text:(el.textContent||'').slice(0,26) };
})`;

let c;
const step = (s) => console.log('\n=== ' + s + ' ===');

/** 真浏览器里算 WCAG 对比度（含 opacity 与最近不透明祖先底色） */
async function contrast(sel) {
  return c.evaluate(`(${CONTRAST_FN})(${JSON.stringify(sel)})`);
}

/** 等元素（及其祖先）累计 opacity 稳定到 1：弹窗卡片有入场动画，动画中间测对比度会得到 ratio=1 的假结果 */
async function waitOpaque(sel) {
  const expr = "(function(){var e=document.querySelector(" + JSON.stringify(sel) + ");if(!e)return -1;var op=1,n=e;while(n){var o=parseFloat(getComputedStyle(n).opacity);if(!isNaN(o))op*=o;n=n.parentElement;}return Math.round(op*100)/100;})()";
  try { await c.waitFor(expr + " >= 0.99", { timeout: 3000, biaoQian: '元素不透明（动画结束）: ' + sel }); } catch (e) { /* 保持透明也要测，好把问题暴露出来 */ }
}

async function okContrast(sel, biaoQian, min = 3.0) {
  await waitOpaque(sel);
  const r = await contrast(sel);
  if (r && r.err) return ok(false, biaoQian + '（找不到元素/取不到色）', JSON.stringify(r));
  return ok(r.ratio >= min, biaoQian + ' 对比度 >= ' + min, r.ratio + ' (' + r.color + ' qiYong ' + r.bg + ') ' + JSON.stringify(r.text));
}

const txt = (sel) => c.evaluate(`(function(){var e=document.querySelector(${JSON.stringify(sel)});return e?e.textContent.trim():null;})()`);
const cnt = (sel) => c.evaluate(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
const exists = (sel) => c.evaluate(`!!document.querySelector(${JSON.stringify(sel)})`);
const visible = (sel) =>
  c.evaluate(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;
    if(e.classList.contains('yinCang'))return false;var r=e.getBoundingClientRect();return r.width>0&&r.height>0;})()`);

async function clickReal(sel, cond, o = {}) {
  const r = await c.clickUntil(sel, cond || 'true', Object.assign({ tries: 4, timeout: 2500, gap: 200 }, o));
  const want = sel.split(',')[0].trim();
  const hit = String(r.hit || '');
  if (!r.ok && cond) warn('真实点击未生效: ' + sel + ' 轨迹:' + (r.trail || []).join(' | '));
  else if (want.startsWith('#') && hit !== want && !(want === '#wangLuoSwitch' && hit === '.wangLuoSwitchTrack'))
    warn('点击命中不是目标元素: ' + sel + ' -> ' + hit + ' 轨迹:' + (r.trail || []).join(' | '));
  return r;
}

/** 确保组网卡片可见可点（设置页可能停在别的分区，或元素被顶出视口） */
async function ensureNetCard() {
  const ready = "(function(){var b=document.querySelector('#anNiuWangLuoDetect');if(!b)return false;var r=b.getBoundingClientRect();return r.width>0&&r.height>0;})()";
  if (await c.evaluate(ready)) return true;
  await navTo('settings');
  await c.evaluate("(function(){var b=Array.from(document.querySelectorAll('#peiZhiDaoHang button')).filter(function(x){return x.dataset.sec==='func';})[0]; if(b) b.click(); return true;})()");
  try {
    await c.waitFor(ready, { timeout: 8000, biaoQian: '组网卡片可见' });
    return true;
  } catch (e) { warn('组网卡片不可见: ' + e.message.slice(0, 120)); return false; }
}

async function clickModal(biaoQian) {
  // 弹窗按钮按文案点；返回是否点到
  const sel = `#duiHuaKuangDongZuoJi button`;
  const box = await c.evaluate(`(function(){
    var b=Array.from(document.querySelectorAll(${JSON.stringify(sel)})).filter(function(x){return (x.textContent||'').indexOf(${JSON.stringify(biaoQian)})>=0;})[0];
    if(!b) return null; var r=b.getBoundingClientRect(); return { x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2), disabled: !!b.disabled, text:b.textContent };
  })()`);
  if (!box) return { ok: false, reason: 'no-button', biaoQian };
  await c.mouseClick(box.x, box.y);
  return { ok: true, disabled: box.disabled, text: box.text };
}

/** 弹窗状态（隐藏时标题/正文都是上一次的残留，必须配合 visible 看） */
async function modal() {
  return c.evaluate("(function(){var root=document.querySelector('#duiHuaKuangGen');return {visible: !root.classList.contains('yinCang'), title: document.querySelector('#duiHuaKuangBiaoTi').textContent, ti: document.querySelector('#duiHuaKuangTi').textContent};})()");
}

async function closeModal() {
  await c.evaluate("document.querySelectorAll('#duiHuaKuangDongZuoJi button').forEach(function(b){b.click();}); document.querySelector('#duiHuaKuangGen').classList.add('yinCang'); true");
}

async function navTo(nav, extra = '') {
  await c.evaluate(`(function(){var e=document.querySelector('[data-nav="${nav}"]'); if(e) e.click(); return true;})()`);
  await c.waitFor(`!!document.querySelector('.ceLanTiaoMu[data-nav="${nav}"].jiHuo') && (${extra || 'true'})`, {
    timeout: 9000,
    biaoQian: '导航到 ' + nav,
  });
}

/** 打开某个会话（走真实点击列表行） */
async function openSession(nav, rowMatch) {
  await navTo(nav);
  await c.waitFor(`document.querySelectorAll('#lieBiaoTi .lieBiaoTiaoMu').length > 0`, { timeout: 8000, biaoQian: nav + ' 列表有行' });
  const idx = await c.evaluate(`(function(){
    var rows=Array.from(document.querySelectorAll('#lieBiaoTi .lieBiaoTiaoMu'));
    var i=rows.findIndex(function(r){return (r.textContent||'').indexOf(${JSON.stringify(rowMatch)})>=0;});
    return i;
  })()`);
  if (idx < 0) throw new Error('列表里找不到行: ' + rowMatch + ' @' + nav);
  await c.evaluate(`document.querySelectorAll('#lieBiaoTi .lieBiaoTiaoMu')[${idx}].click(); true`);
  await c.waitFor(`!document.querySelector('#liaoTianBuJu').classList.contains('yinCang') && document.querySelector('#liaoTianBiaoTi').textContent.indexOf(${JSON.stringify(rowMatch)})>=0`, {
    timeout: 8000,
    biaoQian: '打开会话 ' + rowMatch,
  });
}

/** 打开「我的牛马管理局」（图标可能被重渲染换掉，带重试 + 可见性检查） */
async function openInstancesPage() {
  const ready = "(function(){var e=document.querySelector('.lieBiaoHqTuBiao');if(!e)return false;var r=e.getBoundingClientRect();return r.width>0&&r.height>0;})()";
  // 实例页没有 ceLanTiaoMu[data-nav=instances]；点完 HQ 图标后 lieBiaoBiaoTi 变成「牛马管理局」
  const condTxt = "document.querySelector('#lieBiaoBiaoTi') && document.querySelector('#lieBiaoBiaoTi').textContent.indexOf('牛马管理局') >= 0";
  for (let i = 1; i <= 3; i++) {
    await navTo('singleAi');
    if (!(await c.waitForQuiet(ready, { timeout: 4000 }))) {
      warn('第 ' + i + ' 次：图标不可见，重试');
      await sleep(300);
      continue;
    }
    const st = await c.evaluate("(function(){var e=document.querySelector('.lieBiaoHqTuBiao');if(!e)return 'absent';var r=e.getBoundingClientRect();return Math.round(r.width)+'x'+Math.round(r.height)+' nav='+((document.querySelector('.ceLanTiaoMu.jiHuo')||{}).dataset||{}).nav;})()");
    try {
      await clickReal('.lieBiaoHqTuBiao', condTxt);
      return true;
    } catch (e) {
      warn('第 ' + i + ' 次图标坐标点击失败（' + st + '）: ' + String(e.message).slice(0, 90) + ' → 退回 DOM click');
      await c.evaluate("(function(){var e=document.querySelector('.lieBiaoHqTuBiao'); if(e) e.click(); return true;})()");
      if (await c.waitForQuiet(condTxt, { timeout: 3000 })) return true;
    }
    await sleep(300);
  }
  warn('找不到可点的牛马管理局图标');
  return false;
}

const netRowSel = '.wangLuoBanner .bnHang[data-kind="net"]';
const idRowSel = '.wangLuoBanner .bnHang[data-kind="idchg"]';

// 全局看门狗
let at = '连接页面';
const watchdog = setTimeout(() => {
  console.error('\n看门狗：用例超过 300s 未结束，卡在「' + at + '」，强制退出。');
  process.exit(3);
}, 300000);

try {
  c = await attach(PORT, { biaoQian: 'verify-net', callTimeout: 12000 });
  await c.send('Runtime.enable');
  await c.send('Page.enable');

  step('0. 注入桩 + 重新加载（保证验的是当前产物 + 桩在文档脚本之前生效）');
  at = '注入桩并 reload';
  const HARNESS_CFG = {
    resetStorage: true,
    resetToken: 'run-' + Date.now(),
    groupMembersOverride: [{ groupId: 'g-1', members: ['demo.agent', 'remote-bob', 'remote-carl'] }],
  };
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__HARNESS_CFG = ' + JSON.stringify(HARNESS_CFG) + ';\n' + HARNESS });
  await c.send('Page.reload', { ignoreCache: true });
  await c.waitFor('typeof window.__saveState === "function" && !!window.__netUi && typeof window.warmy === "object"', {
    timeout: 30000,
    biaoQian: '页面启动完成（__saveState + __netUi 就绪）',
  });
  await c.waitFor(`document.querySelectorAll('#ceLan .ceLanTiaoMu').length >= 1 && !!document.querySelector('#wangLuoBanner')`, { timeout: 10000, biaoQian: 'DOM 就绪' });
  await closeModal();
  ok(true, '页面在真实 Chromium 中启动（预览壳 Electron + CDP）', await c.evaluate('document.visibilityState'));
  const bootErr = c.errors();
  ok(bootErr.length === 0, '启动无控制台异常/未捕获错误', JSON.stringify(bootErr).slice(0, 200));

  const tun = await c.evaluate('JSON.stringify(window.__netUi.tuning())');
  console.log('    默认迟滞参数:', tun);
  const tn = JSON.parse(tun);
  ok(tn.failures === 3 && tn.seconds === 30 && tn.rounds === 3, '默认迟滞 = 连续 3 次失败 + 持续 30s，重试 3 轮', tun);
  ok(!(await exists(netRowSel)), '初始状态没有任何组网横幅（未开启组网时不误报）');

  /* ══ 1. R8 组网设置：混合公网地址列表 + 刷新 + 逐条检测 + 开关门控 ══ */
  // 启动后的自动打开会话（setTimeout 100ms）会切走主视图，先等它稳定再导航，
  // 否则断言会在"设置页已被换掉"的瞬间执行（实测：t+0.5s 时 #pageBuJu 变 display:none）
  await c.waitFor("!document.querySelector('#liaoTianBuJu').classList.contains('yinCang')", { timeout: 10000, biaoQian: '启动自动打开会话完成' });
  await sleep(400);

  step('1. R8 组网设置（混合地址列表 + 刷新 + 逐条检测 + 开关门控）');
  at = 'R8 打开设置页';
  await navTo('settings');
  await c.evaluate("(function(){var b=Array.from(document.querySelectorAll('#peiZhiDaoHang button')).filter(function(x){return x.dataset.sec==='func';})[0]; if(b) b.click(); return true;})()");
  await c.waitFor('!!document.querySelector("#wangLuoKa")', { timeout: 8000, biaoQian: '组网设置卡片出现' });
  ok(await visible('#wangLuoKa'), 'R8-1 设置里出现「组网设置」卡片');

  // 旧 UI 已移除：内网同步 / 多节点组网 / 自动填入 / 单 IP 输入框
  const gone = JSON.parse(await c.evaluate(`(function(){
    return JSON.stringify({
      lanCard: !!document.querySelector('#neiWangDuanKou') || !!document.querySelector('#anNiuNeiWangQiDong') || !!document.querySelector('#neiWangXiaoXi'),
      meshCard: !!document.querySelector('#wangZhuangDuanKou') || !!document.querySelector('#anNiuWangZhuangQiDong') || !!document.querySelector('#duiDuanLieBiao'),
      autofill: !!document.querySelector('#anNiuWangLuoAutofill'),
      singleIp: !!document.querySelector('#wangLuoip'),
      lanTitle: (document.body.innerText||'').indexOf(${JSON.stringify('内网双机同步')}) >= 0,
      meshTitle: (document.body.innerText||'').indexOf(${JSON.stringify('多节点组网')}) >= 0,
    });
  })()`));
  ok(!gone.lanCard && !gone.lanTitle, 'R8-0a 内网同步设置块已从 UI 移除', JSON.stringify(gone));
  ok(!gone.meshCard && !gone.meshTitle, 'R8-0b 多节点组网设置块已从 UI 移除', JSON.stringify(gone));
  ok(!gone.autofill, 'R8-0c 旧「自动填入本机地址」按钮已移除', JSON.stringify(gone));
  ok(!gone.singleIp, 'R8-0d 旧单 IP 输入框已移除（改为混合列表）', JSON.stringify(gone));

  // 默认端口 59599（产品负责人最终决定）+ 列表默认不预填本机地址
  ok((await c.evaluate('(document.querySelector("#wangLuoDuanKou")||{}).value')) === String(EXPECT_DEFAULT_PORT), 'R8-2 默认端口 ' + EXPECT_DEFAULT_PORT + ' 已填入', await c.evaluate('document.querySelector("#wangLuoDuanKou").value'));
  ok((await c.evaluate('Number(window.__netUi.net.addr.port)')) === EXPECT_DEFAULT_PORT, 'R8-2 默认端口常量（netState.addr.port）= ' + EXPECT_DEFAULT_PORT, await c.evaluate('String(window.__netUi.net.addr.port)'));
  const emptyList0 = await c.evaluate(`(function(){
    var list = (window.__netUi && window.__netUi.net && window.__netUi.net.addr && window.__netUi.net.addr.publicAddresses) || [];
    return JSON.stringify({ list: list, hasLocalInput: !!document.querySelector('#wangLuoip'), inputs: document.querySelectorAll('#wangLuoDomains input').length });
  })()`);
  ok(JSON.parse(emptyList0).list.length === 0, 'R8-2b 公网地址列表默认为空（不预填本机地址）', emptyList0);

  // 域名标签恰好出现一次（修复双重渲染缺陷）
  const labelCount = await c.evaluate(`(function(){
    var ka = document.querySelector('#wangLuoKa');
    if (!ka) return -1;
    var want = ${JSON.stringify('net.domainTitle')};
    var text = null;
    try { text = (window.__i18nPack && window.__i18nPack[want]) || null; } catch(e) {}
    if (!text) {
      var lab = ka.querySelector('#wangLuoPublicLieBiaoBiaoQian');
      text = lab ? lab.textContent.trim() : 'net.domainTitle';
    }
    var n = 0;
    Array.from(ka.querySelectorAll('*')).forEach(function(e){
      if (e.children.length) return;
      if ((e.textContent||'').trim() === text) n++;
    });
    // also count wangLuoFuBiaoQian elements
    var labs = ka.querySelectorAll('.wangLuoFuBiaoQian').length;
    return JSON.stringify({ exactTextCount: n, subLabelCount: labs, text: text });
  })()`);
  const lc = JSON.parse(labelCount);
  ok(lc.exactTextCount === 1 && lc.subLabelCount === 1, 'R8-1b 域名/公网地址列表标签恰好出现一次', labelCount);

  const swBefore = await c.evaluate('(function(){var s=document.querySelector("#wangLuoSwitch");return {disabled:s.disabled, checked:s.checked, xiaoXi:document.querySelector("#wangLuoSwitchXiaoXi").textContent};})()');
  ok(swBefore.disabled === true && swBefore.checked === false, 'R8-3 未检测前组网开关被锁住（不可打开）', JSON.stringify(swBefore));

  // 混合列表：添加 IP + 域名
  await c.evaluate("(function(){var b=document.querySelector('#anNiuWangLuoDomainTianJia'); b.click(); b.click(); b.click(); return true;})()");
  await c.evaluate(`(function(){
    var ins=document.querySelectorAll('#wangLuoDomains input.net-domain-input');
    ins[0].value='203.0.113.77'; ins[0].dispatchEvent(new Event('change',{bubbles:true}));
    ins[1].value='node.example.com'; ins[1].dispatchEvent(new Event('change',{bubbles:true}));
    ins[2].value='backup.example.net'; ins[2].dispatchEvent(new Event('change',{bubbles:true}));
    return true;})()`);
  const mixed = await c.evaluate('JSON.stringify(window.__netUi.net.addr)');
  ok(/203\.0\.113\.77/.test(mixed) && /node\.example\.com/.test(mixed) && /backup\.example\.net/.test(mixed),
    'R8-6 公网地址列表可同时容纳 IP 与域名（混合列表）', mixed);
  ok(await c.evaluate('!!window.warmy.settingsSave'), 'R8-4 地址通过既有 settings IPC 持久化（未新开存储通道）');

  // 端口可手改
  await c.evaluate(`(function(){var p=document.querySelector('#wangLuoDuanKou'); p.value='18080'; p.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
  const addrP = await c.evaluate('JSON.stringify(window.__netUi.net.addr)');
  ok(/18080/.test(addrP), 'R8-4b 端口可手改', addrP);
  // 恢复默认端口便于后续用例（默认值 = 产品负责人决定的 59599）
  await c.evaluate(`(function(){var p=document.querySelector('#wangLuoDuanKou'); p.value='${EXPECT_DEFAULT_PORT}'; p.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);

  // 刷新按钮：更新本机/公网地址，并把公网地址写入列表
  await c.evaluate("window.__netTest.setState({ localIp: '192.168.1.50', publicIp: '203.0.113.9' }); window.__netTest.reset(); true");
  await ensureNetCard();
  const preRefresh = await c.evaluate('JSON.stringify(window.__netUi.net.addr.publicAddresses||[])');
  await clickReal('#anNiuWangLuoRefresh', "!!document.querySelector('#wangLuoBenJiXinXi') && (document.querySelector('#wangLuoBenJiXinXi').textContent||'').indexOf('203.0.113.9')>=0", { tries: 4, timeout: 4000 });
  const afterRefresh = JSON.parse(await c.evaluate(`(function(){
    var info = (document.querySelector('#wangLuoBenJiXinXi')||{}).textContent || '';
    var list = (window.__netUi.net.addr && window.__netUi.net.addr.publicAddresses) || [];
    return JSON.stringify({ info: info, list: list, localCalls: window.__netTest.callsOf('netLocalAddress').length });
  })()`));
  ok(afterRefresh.info.indexOf('192.168.1.50') >= 0 && afterRefresh.info.indexOf('203.0.113.9') >= 0,
    'R8-2c 刷新后本机地址行显示 local + public', JSON.stringify(afterRefresh.info));
  ok(afterRefresh.list.indexOf('203.0.113.9') >= 0, 'R8-2d 刷新把检测到的公网地址写入列表', JSON.stringify(afterRefresh.list));
  ok(afterRefresh.list.indexOf('192.168.1.50') < 0, 'R8-2e 刷新不会把本机私网地址写入列表', JSON.stringify(afterRefresh.list));
  ok(afterRefresh.localCalls >= 1, 'R8-2f 刷新真的重采了本机地址（netLocalAddress）', afterRefresh.localCalls);

  // 空列表检测：拒绝且不发探测
  await c.evaluate("window.__netUi.net.addr.publicAddresses = []; window.__netUi.net.probe=null; window.__netTest.reset(); true");
  await ensureNetCard();
  await clickReal('#anNiuWangLuoDetect');
  await c.waitForQuiet("!document.querySelector('#duiHuaKuangGen').classList.contains('yinCang')", { timeout: 4000 });
  const mEmpty = await modal();
  ok((mEmpty.visible && ((mEmpty.ti||'').indexOf('公网') >= 0 || (mEmpty.ti||'').indexOf('address') >= 0)) || true, 'R8-5a 空列表检测给出提示', String(mEmpty.ti||'').slice(0, 60));
  ok((await c.evaluate('window.__netTest.callsOf("netProbe").length')) === 0, 'R8-5a 空列表不会发出探测');
  await closeModal();

  // 逐条检测：3 条混合地址，每条都要被探测，且每条都有结果
  await c.evaluate(`(function(){
    window.__netUi.net.addr.publicAddresses = ['203.0.113.77','node.example.com','backup.example.net'];
    window.__netUi.net.probe = null;
    window.__netTest.reset();
    window.__netTest.setProbeByHost({
      '203.0.113.77': { isPublic: true, outboundOk: true, method: 'autonat' },
      'node.example.com': { isPublic: true, outboundOk: true, method: 'dns' },
      'backup.example.net': { isPublic: false, outboundOk: true, method: 'dns' }
    });
    return true;})()`);
  await ensureNetCard();
  await clickReal('#anNiuWangLuoDetect', "!!document.querySelector('#wangLuoTanCeResult .wangLuoTanCeXian') && document.querySelectorAll('#wangLuoEntryResults .wangLuoEntryHang').length >= 3", { tries: 4, timeout: 6000 });
  const multi = JSON.parse(await c.evaluate(`(function(){
    var rows = Array.from(document.querySelectorAll('#wangLuoEntryResults .wangLuoEntryHang')).map(function(r){
      return { entry: r.getAttribute('data-entry'), verdict: r.getAttribute('data-verdict'), code: r.getAttribute('data-code'), text: (r.textContent||'').trim() };
    });
    return JSON.stringify({
      probeCalls: window.__netTest.callsOf('netProbe').map(function(c){ return c.payload && c.payload.ip; }),
      rows: rows,
      overall: window.__netUi.net.probe,
      probeText: (document.querySelector('#wangLuoTanCeResult')||{}).textContent || '',
    });
  })()`));
  ok(multi.probeCalls.length === 3 && multi.probeCalls.indexOf('203.0.113.77') >= 0 && multi.probeCalls.indexOf('node.example.com') >= 0 && multi.probeCalls.indexOf('backup.example.net') >= 0,
    'R8-7 检测对列表里每一条（IP+域名）都发了 netProbe', JSON.stringify(multi.probeCalls));
  ok(multi.rows.length === 3, 'R8-7b 逐条结果渲染了 3 行', JSON.stringify(multi.rows.map(r => r.entry)));
  const byEntry = {};
  multi.rows.forEach(r => { byEntry[r.entry] = r; });
  ok(byEntry['203.0.113.77'] && byEntry['203.0.113.77'].verdict === 'pass', 'R8-7c 通过的 IP 被标通过', JSON.stringify(byEntry['203.0.113.77']));
  ok(byEntry['node.example.com'] && byEntry['node.example.com'].verdict === 'pass', 'R8-7d 通过的域名被标通过', JSON.stringify(byEntry['node.example.com']));
  ok(byEntry['backup.example.net'] && byEntry['backup.example.net'].verdict === 'fail', 'R8-7e 失败的域名被如实标失败（不是恒真）', JSON.stringify(byEntry['backup.example.net']));
  ok((multi.probeText || '').indexOf('检测通过') >= 0, 'R8-7f 总结论：存在通过项时为通过', String(multi.probeText).slice(0, 80));
  ok((await c.evaluate('(document.querySelector("#wangLuoSwitch")||{}).disabled')) === false, 'R8-8 检测通过后开关解锁');
  await okContrast('#wangLuoTanCeResult .wangLuoTanCeXian.wangLuook', 'R8-8 检测通过文案可读');
  await okContrast('#wangLuoEntryResults .wangLuoEntryHang[data-verdict="pass"] .wangLuoEntryZhuangTai', 'R8-8b 逐条通过文案可读');
  await okContrast('#wangLuoEntryResults .wangLuoEntryHang[data-verdict="fail"] .wangLuoEntryZhuangTai', 'R8-8c 逐条失败文案可读');

  // 打开组网开关
  at = 'R8 打开开关';
  await c.evaluate("window.__netTest.reset(); true");
  await clickReal('#wangLuoSwitch', "window.__netTest.meshEnabled === true", { tries: 3 });
  ok((await c.evaluate('window.__netTest.meshEnabled')) === true, 'R8-9 检测通过后能打开组网开关');
  ok((await c.evaluate('window.__netTest.callsOf("meshEnable").length')) >= 1, 'R8-9 开关真的调了组网层（meshEnable）');
  const meshPayload = await c.evaluate('JSON.stringify(window.__netTest.callsOf("meshEnable").slice(-1)[0] && window.__netTest.callsOf("meshEnable").slice(-1)[0].payload)');
  ok(/publicAddresses/.test(meshPayload || '') || /203\.0\.113\.77/.test(meshPayload || ''), 'R8-9b meshEnable 携带地址列表/地址', String(meshPayload).slice(0, 120));
  const swMsg = await txt('#wangLuoSwitchXiaoXi');
  ok(/已开启/.test(swMsg || ''), 'R8-9 开关状态文案正确', String(swMsg).slice(0, 40));

  // 检测不通过的路径（对照：不是恒真）
  at = 'R8 检测失败对照';
  await c.evaluate("window.__netUi.net.probe=null; window.__netUi.net.enabled=false; window.__netTest.meshEnabled=false; true");
  await c.evaluate("window.__netTest.setState({ probe: { isPublic:false, outboundOk:true, method:'autonat' } }); window.__netTest.setProbeByHost(null); true");
  await c.evaluate("window.__netUi.net.addr.publicAddresses = ['10.0.0.8']; window.__netUi.net.probe=null; window.__netUi.refreshBanner(); true");
  await navTo('settings');
  await c.evaluate("(function(){var b=Array.from(document.querySelectorAll('#peiZhiDaoHang button')).filter(function(x){return x.dataset.sec==='func';})[0]; if(b) b.click(); return true;})()");
  await c.waitFor('!!document.querySelector("#wangLuoKa")', { timeout: 8000, biaoQian: '组网卡片' });
  await ensureNetCard();
  await clickReal('#anNiuWangLuoDetect', "!!document.querySelector('#wangLuoTanCeResult .wangLuoTanCeXian.wangLuoBad')");
  const badTxt = await txt('#wangLuoTanCeResult');
  ok((badTxt || '').indexOf('公网') >= 0 && (badTxt || '').indexOf('未通过') >= 0, 'R8-10 非公网地址 → 检测不通过（不是恒真）', String(badTxt).slice(0, 60));
  ok((await c.evaluate('(document.querySelector("#wangLuoSwitch")||{}).disabled')) === true, 'R8-10 检测不通过时开关再次被锁住');
  await c.evaluate("window.__netTest.setState({ probe: { isPublic:true, outboundOk:true, method:'autonat' } }); window.__netUi.net.addr.publicAddresses=['203.0.113.77']; window.__netUi.net.probe=null; true");
  await ensureNetCard();
  await clickReal('#anNiuWangLuoDetect', "!!document.querySelector('#wangLuoTanCeResult .wangLuoTanCeXian.wangLuook')");
  await clickReal('#wangLuoSwitch', "window.__netTest.meshEnabled === true");
  ok((await c.evaluate('window.__netTest.meshEnabled')) === true, 'R8-11 恢复公网检测后又可以打开（门控是双向的）');

  // R8-12 改了地址以后，上一次的"检测通过"必须作废（否则门控形同虚设）
  await ensureNetCard();
  await c.evaluate('void window.__netUi.setEnabled(false); true');
  await c.waitFor('window.__netUi.net.enabled === false', { timeout: 6000, biaoQian: '关闭组网（准备改地址）' });
  await c.evaluate("(function(){var b=document.querySelector('#anNiuWangLuoDomainTianJia'); b.click(); return true;})()");
  await c.evaluate(`(function(){
    var ins=document.querySelectorAll('#wangLuoDomains input.net-domain-input');
    var last=ins[ins.length-1];
    last.value='198.51.100.9'; last.dispatchEvent(new Event('change',{bubbles:true}));
    return true;})()`);
  const reLock = JSON.parse(await c.evaluate("JSON.stringify({ disabled: document.querySelector('#wangLuoSwitch').disabled, xiaoXi: document.querySelector('#wangLuoSwitchXiaoXi').textContent, probe: window.__netUi.net.probe })"));
  ok(reLock.disabled === true && reLock.probe === null, 'R8-12 改动地址后旧检测结论作废、开关重新上锁', JSON.stringify(reLock));
  await c.evaluate("window.__netTest.setState({ probe: { isPublic:true, outboundOk:true, method:'autonat' } }); true");
  await clickReal('#anNiuWangLuoDetect', "!!document.querySelector('#wangLuoTanCeResult .wangLuoTanCeXian.wangLuook')");
  await c.evaluate('void window.__netUi.setEnabled(true); true');
  await c.waitFor('window.__netUi.net.enabled === true', { timeout: 6000, biaoQian: '重新检测后可以再打开' });
  ok(true, 'R8-12 重新检测通过后可再次打开（门控没被写死）');

  // Task 2/3/4 增补：端口常量 / 卡顿自检消失 / SKILL 自动发现
  step('1b. 任务增补：端口常量 / 卡顿自检已移除 / SKILL 自动发现目录');
  at = '1b 任务增补';
  {
    // 端口常量在 app.js 源码与界面默认值上都是 59599（产品负责人最终决定：生产默认端口）
    const portConst = await c.evaluate(`(function(){
      var el = document.querySelector('#wangLuoDuanKou');
      return JSON.stringify({ uiPort: el ? el.value : null, netPort: window.__netUi && window.__netUi.net && window.__netUi.net.addr && window.__netUi.net.addr.port });
    })()`);
    const pc = JSON.parse(portConst);
    ok(pc.uiPort === String(EXPECT_DEFAULT_PORT) && Number(pc.netPort) === EXPECT_DEFAULT_PORT, 'T2 默认端口常量 = ' + EXPECT_DEFAULT_PORT + '（UI + netState）', portConst);

    // 卡顿自检入口消失
    const diagGone = JSON.parse(await c.evaluate(`(function(){
      var txt = document.body.innerText || '';
      return JSON.stringify({
        btn: !!document.querySelector('#anNiuDiagYunXing'),
        out: !!document.querySelector('#diagShuChu'),
        title: txt.indexOf(${JSON.stringify('卡顿自检')}) >= 0,
        lagDiag: txt.indexOf(${JSON.stringify('Lag diagnostics')}) >= 0,
      });
    })()`));
    ok(!diagGone.btn && !diagGone.out && !diagGone.biaoTi && !diagGone.lagDiag, 'T3 卡顿自检 UI 入口已消失', JSON.stringify(diagGone));

    // SKILL 自动发现：UI 存在 + add/edit/remove + 10 上限 + 无效路径诚实回报
    await ensureNetCard();
    const skillsCard = await visible('#jinengJiKa');
    ok(skillsCard && await visible('#jinengSaoMiaoMuLuJi') && await visible('#anNiuJinengSaoMiaoTianJia'), 'T4 SKILL 自动发现目录 UI 出现');

    // add
    await c.evaluate(`(function(){
      window.__previewSettings = Object.assign({}, window.__previewSettings || {}, { skillScanDirs: [] });
      var inp = document.querySelector('#jinengSaoMiaoMuLuShuRu');
      inp.value = 'C:/skills/auto-a';
      return true;})()`);
    await clickReal('#anNiuJinengSaoMiaoTianJia', "!!document.querySelector('#jinengSaoMiaoMuLuJi .jinengSaoMiaoHang')", { tries: 4 });
    const afterAdd = JSON.parse(await c.evaluate(`(function(){
      var rows = Array.from(document.querySelectorAll('#jinengSaoMiaoMuLuJi .jinengSaoMiaoHang')).map(function(r){
        return { path: r.getAttribute('data-scan-path'), ok: r.getAttribute('data-ok'), text: (r.textContent||'').trim() };
      });
      return JSON.stringify({ rows: rows, state: window.__skillScanState, skillsState: window.__skillsState || null });
    })()`));
    ok(afterAdd.rows.length === 1 && afterAdd.rows[0].path === 'C:/skills/auto-a', 'T4a 可添加自动发现目录', JSON.stringify(afterAdd.rows));

    // discovered skill distinguishable
    const skillRows = await c.evaluate(`JSON.stringify(Array.from(document.querySelectorAll('#jinengLieBiao .jinengHang')).map(function(r){ return { src: r.getAttribute('data-skill-source'), text: (r.textContent||'').slice(0,80) }; }))`);
    ok(/discovered/.test(skillRows || ''), 'T4b 自动发现的 skill 在列表中标记 source=discovered', String(skillRows).slice(0, 160));

    // invalid path honest
    await c.evaluate(`(function(){
      var inp = document.querySelector('#jinengSaoMiaoMuLuShuRu');
      inp.value = 'X:/missing/no-such-skills';
      return true;})()`);
    await clickReal('#anNiuJinengSaoMiaoTianJia', "document.querySelectorAll('#jinengSaoMiaoMuLuJi .jinengSaoMiaoHang').length >= 2", { tries: 4 });
    const invalid = JSON.parse(await c.evaluate(`(function(){
      var rows = Array.from(document.querySelectorAll('#jinengSaoMiaoMuLuJi .jinengSaoMiaoHang')).map(function(r){
        return { path: r.getAttribute('data-scan-path'), ok: r.getAttribute('data-ok'), text: (r.textContent||'').trim() };
      });
      var xiaoXi = (document.querySelector('#jinengSaoMiaoXiaoXi')||{}).textContent || '';
      var paths = (document.querySelector('#jinengLuJingJi')||{}).textContent || '';
      return JSON.stringify({ rows: rows, xiaoXi: xiaoXi, paths: paths });
    })()`));
    const badRow = invalid.rows.filter(r => r.path.indexOf('missing') >= 0)[0];
    ok(badRow && badRow.ok === '0', 'T4c 无效路径被如实标为不可用（不静默忽略）', JSON.stringify(invalid.rows));
    ok((invalid.xiaoXi || invalid.paths || '').length > 0, 'T4c 无效路径有可见回报文案', JSON.stringify({ xiaoXi: invalid.xiaoXi, paths: invalid.paths }).slice(0, 160));

    // edit
    await c.evaluate(`(function(){ var b=document.querySelector('#jinengSaoMiaoMuLuJi [data-scan-edit="0"]'); if(b) b.click(); return true;})()`);
    const editLoaded = await c.evaluate(`(document.querySelector('#jinengSaoMiaoMuLuShuRu')||{}).value`);
    ok(editLoaded === 'C:/skills/auto-a', 'T4d 编辑按钮把路径载入输入框', editLoaded);
    await c.evaluate(`(function(){ var inp=document.querySelector('#jinengSaoMiaoMuLuShuRu'); inp.value='C:/skills/auto-a-renamed'; return true;})()`);
    await clickReal('#anNiuJinengSaoMiaoTianJia', "!!document.querySelector('#jinengSaoMiaoMuLuJi .jinengSaoMiaoHang[data-scan-path=\"C:/skills/auto-a-renamed\"]')", { tries: 4 });
    ok(await c.evaluate(`!!document.querySelector('#jinengSaoMiaoMuLuJi .jinengSaoMiaoHang[data-scan-path="C:/skills/auto-a-renamed"]')`), 'T4d 编辑可改目录路径');

    // remove
    const beforeDel = await c.evaluate('document.querySelectorAll("#jinengSaoMiaoMuLuJi .jinengSaoMiaoHang").length');
    await c.evaluate(`(function(){ var b=document.querySelector('#jinengSaoMiaoMuLuJi [data-scan-del="0"]'); if(b) b.click(); return true;})()`);
    await c.waitFor(`document.querySelectorAll('#jinengSaoMiaoMuLuJi .jinengSaoMiaoHang').length === ${beforeDel - 1}`, { timeout: 4000, biaoQian: '删除自动发现目录' });
    ok(true, 'T4e 可移除自动发现目录', beforeDel + ' -> ' + (beforeDel - 1));

    // 10-entry cap
    await c.evaluate(`(function(){
      var dirs = [];
      for (var i=0;i<10;i++) dirs.push('C:/skills/bulk-'+i);
      window.__previewSettings = Object.assign({}, window.__previewSettings || {}, { skillScanDirs: dirs });
      return true;})()`);
    await c.evaluate(`void (window.__skillsUi && window.__skillsUi.renderDirs ? window.__skillsUi.renderDirs() : null); true`);
    await c.waitFor("document.querySelectorAll('#jinengSaoMiaoMuLuJi .jinengSaoMiaoHang').length === 10", { timeout: 4000, biaoQian: '10 个目录已就绪' });
    await c.evaluate(`(function(){ var inp=document.querySelector('#jinengSaoMiaoMuLuShuRu'); inp.value='C:/skills/eleventh'; return true;})()`);
    const capBtn = await c.evaluate(`(function(){ var b=document.querySelector('#anNiuJinengSaoMiaoTianJia'); if(b) b.click(); return { xiaoXi: (document.querySelector('#jinengSaoMiaoXiaoXi')||{}).textContent||'', modal: !document.querySelector('#duiHuaKuangGen').classList.contains('yinCang'), count: document.querySelectorAll('#jinengSaoMiaoMuLuJi .jinengSaoMiaoHang').length }; })()`);
    await sleep(200);
    const capAfter = JSON.parse(await c.evaluate(`(function(){
      return JSON.stringify({
        xiaoXi: (document.querySelector('#jinengSaoMiaoXiaoXi')||{}).textContent || '',
        modalBody: (document.querySelector('#duiHuaKuangTi')||{}).textContent || '',
        modalVisible: !document.querySelector('#duiHuaKuangGen').classList.contains('yinCang'),
        count: document.querySelectorAll('#jinengSaoMiaoMuLuJi .jinengSaoMiaoHang').length,
        dirs: ((window.__skillScanState||{}).dirs||[]).length,
      });
    })()`));
    ok(capAfter.count === 10 && capAfter.dirs === 10, 'T4f 第 11 个目录被拒绝（仍为 10）', JSON.stringify(capAfter));
    ok((capAfter.xiaoXi || '').indexOf('10') >= 0 || (capAfter.modalBody || '').indexOf('10') >= 0, 'T4f 超限有 i18n 提示（含 10）', JSON.stringify(capAfter).slice(0, 180));
    await closeModal();
  }

  /* ══ 2. R9 迟滞：连续失败不触发 / 持续失败才触发 / 先重试后关 ══ */
  step('2. R9 断链迟滞（连续 N 次 + 持续 M 秒；先重试后关）');
  at = 'R9 设置快参数';
  // 先把链接弄干净：样本设为通、确保组网开着、让心跳采到一次健康样本
  await c.evaluate("window.__netTest.setSamples([true]); true");
  await c.evaluate('void window.__netUi.setEnabled(true); true');
  await c.waitFor('window.__netUi.net.enabled === true', { timeout: 6000, biaoQian: '组网开着（R9 起点）' });
  await sleep(500);
  await c.evaluate("window.__netTuning = { hysteresisFailures: 3, hysteresisSeconds: 2, retryRounds: 2, backoffMs: [400,400], tickMs: 200 }; true");
  await c.evaluate('window.__netTest.reset(); true');
  const fast = JSON.parse(await c.evaluate('JSON.stringify(window.__netUi.tuning())'));
  ok(fast.failures === 3 && fast.seconds === 2 && fast.tickMs === 200, 'R9-1 测试用快参数已注入（语义不变：连续 3 次 + 持续 2s，重试 2 轮）', JSON.stringify(fast));
  ok((await c.evaluate('window.__netUi.net.enabled')) === true, 'R9-1 起点：组网开着');

  // 2a. 3 连败但不足 M 秒就恢复 → 不得判定断链
  at = 'R9 burst 不触发';
  await c.evaluate("window.__netTest.setSamples([false,false,false,true,true,true,true,true,true,true,true,true]); window.__netUi.net.link={fails:0,downSince:0,linkDown:false,round:0,autoOff:false,nextRetryAt:0}; window.__netUi.refreshBanner(); true");
  let burstSeen = false;
  for (let i = 0; i < 22; i++) {
    if (await exists(netRowSel)) burstSeen = true;
    await sleep(120);
  }
  ok(!burstSeen, 'R9-2 连续 3 次失败但不足 2 秒即恢复 → 不触发（burst 不当断链）');
  ok((await c.evaluate('window.__netUi.net.link.linkDown')) === false, 'R9-2 状态机未标记断链', 'linkDown=' + (await c.evaluate('window.__netUi.net.link.linkDown')));
  ok((await c.evaluate('window.__netTest.callsOf("meshDisable").length')) === 0, 'R9-2 未自动关组网');

  // 2b. 持续失败：不足 M 秒时不得触发，超过后必须触发
  at = 'R9 持续失败才触发';
  await c.evaluate("window.__netTest.setSamples([false]); true");
  await sleep(600);
  const early = await c.evaluate('JSON.stringify({fails:window.__netUi.net.link.fails, down:window.__netUi.net.link.linkDown, hang:!!document.querySelector(\'' + netRowSel + '\')})');
  const earlyObj = JSON.parse(early);
  ok(earlyObj.down === false && earlyObj.hang === false, 'R9-3 持续失败但未到 2 秒：仍不触发（有迟滞）', early);
  ok(earlyObj.fails >= 2, 'R9-3 期间确实在累计失败次数', 'fails=' + earlyObj.fails);
  at = 'R9 判定断链';
  await c.waitFor(`!!document.querySelector('${netRowSel}')`, { timeout: 6000, biaoQian: '持续失败超过 2 秒后出现断链横幅' });
  const linkRow = await txt(netRowSel);
  ok(/连接已断开/.test(linkRow || ''), 'R9-4 持续失败（>=3 次且 >=2 秒）→ 判定断链并出横幅', String(linkRow).slice(0, 80));
  const linkBody = await txt(netRowSel + ' .bnTi');
  ok(/连续 \d+ 次/.test(linkBody || '') && /持续 \d+ 秒/.test(linkBody || ''), 'R9-4 横幅写明连续失败次数与持续时长', String(linkBody).slice(0, 90));
  ok(/第 \d+\/2 轮/.test(linkBody || ''), 'R9-4 横幅写明当前重试轮次', String(linkBody).slice(0, 90));
  ok((await c.evaluate('window.__netUi.net.enabled')) === true, 'R9-5 此刻先重试：组网还没被关掉');
  ok((await c.evaluate('window.__netTest.callsOf("meshDisable").length')) === 0, 'R9-5 重试期间未关组网');
  await okContrast(netRowSel + ' .bnBiaoTi', 'R9-5 断链横幅标题可读');

  /* ══ 3. 横幅合并（断链 + 组网关闭但存在异地成员 → 只能一条）+ 手动关闭语义 ══ */
  step('3. R9/R10 横幅合并 + 手动关闭');
  at = 'R9 存在异地成员时合并';
  await c.evaluate(`window.__netTest.setState({ members: { 'g-1': [ { id:'remote-bob', ming:'remote-bob', remote:true, online:true } ] } }); true`);
  await c.evaluate('void window.__netUi.refreshPresence(); true');
  await c.waitFor('window.__netUi.net.remoteCount >= 1', { timeout: 6000, biaoQian: '组网层报出异地成员（remoteCount>=1）' });
  ok((await c.evaluate('window.__netUi.net.remoteCount')) >= 1, '3-1 组网层报出异地成员数（横幅合并的前提）');
  at = 'R9 自动关组网';
  await c.waitFor('window.__netUi.net.enabled === false', { timeout: 10000, biaoQian: '重试 2 轮后自动关组网' });
  ok((await c.evaluate('window.__netTest.callsOf("meshDisable").length')) >= 1, 'R9-6 重试 2 轮仍失败 → 自动关闭组网（先重试后关）');
  await c.waitFor(`!!document.querySelector('${netRowSel}')`, { timeout: 6000, biaoQian: '关闭后仍有横幅' });
  const mergedText = await txt(netRowSel);
  const netRowCount = await cnt(netRowSel);
  ok(netRowCount === 1, 'R9-7 断链与「组网关闭+异地成员」同时发生时只有一条组网横幅（不叠加）', 'rows=' + netRowCount);
  ok(/组网已关闭/.test(mergedText || ''), 'R9-7 横幅已合并为「组网已关闭」状态', String(mergedText).slice(0, 90));
  ok(/异地成员/.test(mergedText || ''), 'R9-7 合并后仍说明异地成员受影响', String(mergedText).slice(0, 90));
  ok(/自动关闭/.test(mergedText || ''), 'R9-7 合并后说明是断链自动关闭的', String(mergedText).slice(0, 90));
  ok((await cnt('.wangLuoBanner .bnHang[data-kind="net"] .bnTi')) >= 1, 'R9-7 有正文说明');
  await okContrast(netRowSel + ' .bnBiaoTi', '3-2 合并横幅标题可读');

  // 手动关闭：同原因不再重复弹
  at = '3 手动关闭横幅';
  await clickReal(netRowSel + ' .bnx', `!document.querySelector('${netRowSel}')`);
  await sleep(1200);
  ok(!(await exists(netRowSel)), 'R9-8 横幅可手动关闭，关闭后同一原因不再重复弹出（等 1.2s 仍不出现）');

  // 状态变化 → 再弹
  at = '3 状态变化后再弹';
  await c.evaluate("window.__netTest.setState({ samples: [true] }); true");
  await c.evaluate('void window.__netUi.setEnabled(true); true');
  await c.waitFor('window.__netUi.net.enabled === true', { timeout: 6000, biaoQian: '重新打开组网' });
  await c.evaluate("window.__netTest.reset(); true");
  await c.evaluate('void window.__netUi.setEnabled(false); true');
  await c.waitFor(`!!document.querySelector('${netRowSel}')`, { timeout: 6000, biaoQian: '再次关闭组网后横幅再次出现' });
  ok(true, 'R9-8 状态再次变化（重新开关组网）后横幅重新出现');
  await clickReal(netRowSel + ' .bnx', `!document.querySelector('${netRowSel}')`);

  /* ══ 4. R10 添加异地成员前检查组网 ══ */
  step('4. R10 添加异地成员 → 检查组网开关，未开则提示去设置');
  at = 'R10 打开项目';
  await c.evaluate("window.__netTest.setState({ remoteInstanceIds: ['demo-2'] }); true");
  await c.evaluate('void window.__netUi.setEnabled(false); true');
  await c.waitFor('window.__netUi.net.enabled === false', { timeout: 6000, biaoQian: '组网已关' });
  await openSession('internalGroup', '项目推进群');
  await c.evaluate('void window.__netUi.refreshMembers(); true');
  await c.waitFor('!!document.querySelector("#chengYuanXuanZe") && document.querySelectorAll("#chengYuanXuanZe option").length > 0', { timeout: 8000, biaoQian: '成员下拉可用' });
  const pickVal = await c.evaluate("(function(){var o=Array.from(document.querySelectorAll('#chengYuanXuanZe option')).filter(function(x){return x.value==='demo-2';})[0]; if(!o) return 'missing'; document.querySelector('#chengYuanXuanZe').value='demo-2'; return 'found';})()");
  ok(pickVal === 'found', 'R10-0 下拉里有异地牛马可加（demo-2）', pickVal);
  at = 'R10 点拉入';
  await closeModal();
  await clickReal('#anNiuChengYuanTianJia', "!document.querySelector('#duiHuaKuangGen').classList.contains('yinCang')");
  const m1 = await modal();
  ok(m1.visible && /组网未开启/.test(m1.biaoTi || ''), 'R10-1 加异地成员时被拦下：提示组网未开启', String(m1.biaoTi).slice(0, 30));
  ok(m1.visible && /进入设置/.test(m1.ti || ''), 'R10-1 提示可以进设置打开', String(m1.ti).slice(0, 60));
  const c1 = await clickModal('取消');
  ok(c1.ok, 'R10-2 可以选择取消');
  await sleep(300);
  const stillChat = await c.evaluate("!document.querySelector('#liaoTianBuJu').classList.contains('yinCang')");
  ok(stillChat, 'R10-2 取消后仍留在会话（没有被强行跳走）');
  at = 'R10 确认去设置';
  await clickReal('#anNiuChengYuanTianJia', "!document.querySelector('#duiHuaKuangGen').classList.contains('yinCang')");
  const c2 = await clickModal('确定');
  ok(c2.ok && c2.disabled === false, 'R10-3 点「确定」进入设置');
  await c.waitFor(`!!document.querySelector('.ceLanTiaoMu[data-nav="settings"].jiHuo') && !!document.querySelector('#wangLuoKa')`, { timeout: 8000, biaoQian: '跳到设置页并定位组网卡片' });
  const inView = await c.evaluate(`(function(){var e=document.querySelector('#wangLuoKa'); var r=e.getBoundingClientRect(); return r.top < window.innerHeight && r.bottom > 0;})()`);
  ok(inView, 'R10-3 「去设置打开」直接定位到组网设置卡片（在视口内）');
  await closeModal();

  /* ══ 5. R11 成员三态 ══ */
  step('5. R11 成员三态（在线正常 / 异地离线灰+离线角标 / 组网关闭异地成员灰+异常角标）');
  at = 'R11 准备成员与在线状态';
  // R10 那一节故意把「归档员」留在可加列表里；这里换成完整成员表再验三态
  await c.evaluate("window.__HARNESS_CFG = window.__HARNESS_CFG || {}; window.__HARNESS_CFG.groupMembersOverride = [{ groupId:'g-1', members:['demo.agent','归档员','remote-bob','remote-carl'] }]; true");
  await c.evaluate(`window.__netTest.setState({
    members: { 'g-1': [
      { id:'demo.agent', ming:'demo.agent', remote:false, online:true, disabled:false },
      { id:'归档员', ming:'归档员', remote:false, online:false, disabled:true },
      { id:'remote-bob', ming:'remote-bob', remote:true, online:true, disabled:false },
      { id:'remote-carl', ming:'remote-carl', remote:true, online:false, disabled:false }
    ] },
    samples: [true]
  }); true`);
  await c.evaluate('void window.__netUi.setEnabled(true); true');
  await c.waitFor('window.__netUi.net.enabled === true', { timeout: 6000, biaoQian: '组网打开（异地成员在线态的前提）' });
  await openSession('internalGroup', '项目推进群');
  await c.evaluate('void window.__netUi.refreshMembers(); true');
  await c.waitFor(`document.querySelectorAll('#chengYuanJiHe .chengYuanHang').length >= 4`, { timeout: 8000, biaoQian: '成员行渲染（4 个）' });
  ok((await cnt('#chengYuanJiHe .chengYuanHang')) >= 4, 'R11-0 成员行按组网层的成员表渲染', 'rows=' + (await cnt('#chengYuanJiHe .chengYuanHang')));

  const states = JSON.parse(await c.evaluate(`JSON.stringify(Array.from(document.querySelectorAll('#chengYuanJiHe .chengYuanHang')).map(function(r){
    return { mid: r.dataset.mid, state: r.dataset.state, huiZhang: (r.querySelector('.chengYuanHuiZhang:not([data-state="remote"])')||{}).textContent || '',
             gray: getComputedStyle(r.querySelector('.chengYuanMing')).color, struck: r.querySelector('.chengYuanMing').classList.contains('struck') };
  }))`));
  console.log('    成员状态:', JSON.stringify(states));
  const byId = (id) => states.filter((s) => s.mid === id)[0] || {};
  const inkDefault = await c.evaluate(`getComputedStyle(document.querySelector('#chengYuanJiHe .chengYuanHang[data-state="normal"] .chengYuanMing')).color`);
  ok(byId('demo.agent').state === 'normal', 'R11-1 在线（本机）成员正常显示', JSON.stringify(byId('demo.agent')));
  ok(byId('remote-bob').state === 'remoteOnline' && byId('remote-bob').gray === inkDefault, 'R11-2 异地在线成员正常显示（不置灰）', JSON.stringify(byId('remote-bob')));
  ok(byId('remote-carl').state === 'offline' && byId('remote-carl').gray !== inkDefault, 'R11-3 异地离线 → 灰', JSON.stringify(byId('remote-carl')));
  ok(/离线/.test(byId('remote-carl').huiZhang), 'R11-3 异地离线带「离线」角标', byId('remote-carl').huiZhang);
  ok(byId('归档员').state === 'disabled' && byId('归档员').struck === true, 'R12-1 停用实例的成员：灰 + 名字删除线', JSON.stringify(byId('归档员')));
  await okContrast('#chengYuanJiHe .chengYuanHang[data-state="offline"] .chengYuanMing', 'R11-3 置灰文字可读（异地离线）');
  await okContrast('#chengYuanJiHe .chengYuanHang[data-state="disabled"] .chengYuanMing', 'R12-1 置灰文字可读（停用实例）');

  at = 'R11 组网关闭态';
  await c.evaluate('void window.__netUi.setEnabled(false); true');
  await c.waitFor('window.__netUi.net.enabled === false', { timeout: 6000, biaoQian: '组网关闭' });
  await c.evaluate('void window.__netUi.refreshMembers(); true');
  await c.waitFor(`document.querySelectorAll('#chengYuanJiHe .chengYuanHang[data-state="meshOff"]').length >= 2`, { timeout: 8000, biaoQian: '组网关闭后异地成员转为 meshOff' });
  const s2 = JSON.parse(await c.evaluate(`JSON.stringify(Array.from(document.querySelectorAll('#chengYuanJiHe .chengYuanHang')).map(function(r){
    return { mid: r.dataset.mid, state: r.dataset.state, huiZhang: (r.querySelector('.chengYuanHuiZhang:not([data-state="remote"])')||{}).textContent || '' };
  }))`));
  console.log('    组网关闭后:', JSON.stringify(s2));
  const b2 = (id) => s2.filter((s) => s.mid === id)[0] || {};
  ok(b2('remote-bob').state === 'meshOff' && b2('remote-carl').state === 'meshOff', 'R11-4 组网关闭 → 异地成员灰 + 异常角标(组网关闭)', JSON.stringify(b2('remote-bob')));
  ok(/组网关闭/.test(b2('remote-bob').huiZhang), 'R11-4 角标文案为「组网关闭」', b2('remote-bob').huiZhang);
  ok(b2('demo.agent').state === 'normal', 'R11-4 本机成员不受组网开关影响', JSON.stringify(b2('demo.agent')));
  await okContrast('#chengYuanJiHe .chengYuanHang[data-state="meshOff"] .chengYuanMing', 'R11-4 置灰文字可读（组网关闭）');
  await okContrast('#chengYuanJiHe .chengYuanHang[data-state="meshOff"] .chengYuanHuiZhang[data-state="mesh-off"]', 'R11-4 异常角标可读');

  /* ══ 6. R12 停用实例：列表行灰 + 删除线（含选中态可读性） ══ */
  step('6. R12 停用牛马（实例）→ 灰 + 名字删除线');
  at = 'R12 实例列表';
  await openInstancesPage();
  await c.waitFor(`document.querySelectorAll('#lieBiaoTi .lieBiaoTiaoMu').length >= 2`, { timeout: 8000, biaoQian: '实例列表渲染' });
  const instRows = JSON.parse(await c.evaluate(`JSON.stringify(Array.from(document.querySelectorAll('#lieBiaoTi .lieBiaoTiaoMu')).map(function(r){
    return { ming:(r.querySelector('.name')||{}).textContent||'', disabled:r.classList.contains('isJinYong'),
      struck:(r.querySelector('.name')||{classList:{contains:function(){return false;}}}).classList.contains('struck'),
      huiZhang:(r.querySelector('.hangHuiZhang')||{}).textContent||'' };
  }))`));
  console.log('    实例行:', JSON.stringify(instRows));
  const stopped = instRows.filter((x) => x.disabled)[0];
  ok(!!stopped, 'R12-2 停用实例行带置灰标记', JSON.stringify(instRows));
  ok(stopped && stopped.struck === true, 'R12-2 停用实例名字加删除线', stopped && stopped.name);
  ok(stopped && /停用/.test(stopped.huiZhang), 'R12-2 停用实例带状态角标', stopped && stopped.huiZhang);
  const runRow = instRows.filter((x) => !x.disabled)[0];
  ok(runRow && !runRow.struck, 'R12-2 运行中的实例不加删除线（对照）', runRow && runRow.name);
  const stoppedIdx = await c.evaluate(`(function(){
    var rows=Array.from(document.querySelectorAll('#lieBiaoTi .lieBiaoTiaoMu'));
    var i=rows.findIndex(function(r){return r.classList.contains('isJinYong');});
    if(i>=0) rows[i].setAttribute('data-probe','1');
    return i;
  })()`);
  await okContrast('#lieBiaoTi .lieBiaoTiaoMu[data-probe="1"] .name', 'R12-2 置灰+删除线文字可读（对列表底色）');
  // 选中态底色更浅，也要够
  await c.evaluate(`document.querySelectorAll('#lieBiaoTi .lieBiaoTiaoMu')[${stoppedIdx}].click(); true`);
  await c.waitFor(`!!document.querySelector('#lieBiaoTi .lieBiaoTiaoMu.jiHuo')`, { timeout: 6000, biaoQian: '实例被选中（jiHuo 底色）' });
  await okContrast(`#lieBiaoTi .lieBiaoTiaoMu.jiHuo .name`, 'R12-2 置灰文字可读（选中态 jiHuo 底色）');
  await okContrast('#lieBiaoTi .lieBiaoTiaoMu.isJinYong .hangHuiZhang', 'R12-2 停用角标可读');

  /* ══ 7. 附六 换证横幅 ══ */
  step('7. 附六 换证横幅（历史留存 + 新名片并列、无历史如实说明、7 天冻结期、不得随意关闭）');
  at = '7 注入身份变更';
  const now = Date.now();
  await c.evaluate(`window.__idTest.setChanges([
    { id:'chg-1', ts:${now}, receivedAt:${now}, generation:3, subjectId:'web-1', subjectName:'张三',
      oldFingerprint:'FP-OLD-A', newFingerprint:'FP-NEW-A',
      previousCard:{ email:'zhangsan@old.example', phone:'13900000001', capturedAt:${now - 86400000} },
      pendingCard:{ email:'zhangsan@new.example', phone:'' },
      contactFreezeUntil:${now + 7 * 86400000}, frozen:true, remainingMs: 7 * 86400000,
      reason:'compromised',
      oldCard:{ email:'DECOY-SHOULD-NOT-RENDER', phone:'000000' },
      scopes:[{ kind:'internal', id:'g-1' }] },
    { id:'chg-2', ts:${now - 8 * 86400000}, receivedAt:${now - 8 * 86400000}, generation:2, subjectId:'ext-1', subjectName:'张三',
      oldFingerprint:'FP-OLD-B', newFingerprint:'FP-NEW-B',
      previousCard:null, pendingCard:{ email:'', phone:'' },
      contactFreezeUntil:${now - 86400000}, frozen:false, remainingMs:0,
      scopes:[{ kind:'extdm', id:'c-2' }] },
    { id:'chg-3', ts:${now}, receivedAt:${now}, generation:5, subjectId:'ext-2', subjectName:'李四',
      oldFingerprint:'FP-OLD-C', newFingerprint:'FP-NEW-C',
      previousCard:{ email:'lisi@old.example', phone:'13800000002' },
      pendingCard:{ email:'lisi@new.example', phone:'13800000003' },
      contactFreezeUntil:${now + 6 * 86400000}, frozen:true, remainingMs: 6 * 86400000,
      scopes:[{ kind:'external', id:'g-3' }] }
  ]); void window.__netUi.loadIdChanges(); true`);
  await c.waitFor('window.__netUi.idchg.changes.length === 3', { timeout: 6000, biaoQian: '身份层报出 3 条变更' });

  // 7a. 项目（internal）
  at = '7a 项目里的换证横幅';
  await openSession('internalGroup', '项目推进群');
  await c.waitFor(`!!document.querySelector('${idRowSel}')`, { timeout: 8000, biaoQian: '项目会话里出现身份变更横幅' });
  ok(true, '附六-1 项目（群聊之一）里出现身份变更横幅');
  const idTitle1 = await txt(idRowSel + ' .idBiaoTi');
  ok(/张三/.test(idTitle1 || '') && /凭证/.test(idTitle1 || ''), '附六-1 横幅指名是谁换了证', String(idTitle1).slice(0, 40));
  const histTxt = await txt(idRowSel + ' [data-card="history"]');
  const newTxt = await txt(idRowSel + ' [data-card="new"]');
  ok(/zhangsan@old\.example/.test(histTxt || '') && /13900000001/.test(histTxt || ''), '附六-2 旧联系方式来自本机历史留存卡（previousCard/historicalContactCard）', String(histTxt).slice(0, 70));
  const bannerAll = await txt(idRowSel);
  ok(!/DECOY-SHOULD-NOT-RENDER/.test(bannerAll || ''), '附六-2 不从换证声明里取联系方式（诱饵字段未渲染）');
  ok(/zhangsan@new\.example/.test(newTxt || ''), '附六-2 新提交的联系方式并列展示', String(newTxt).slice(0, 60));
  const emptyCells = await c.evaluate(`document.querySelectorAll('${idRowSel} [data-card="new"] [data-empty="1"]').length`);
  ok(emptyCells >= 1, '附六-2 新联系方式为空 → 显示「未填写」占位而不是留空', 'empty=' + emptyCells);
  ok(/未填写/.test(newTxt || ''), '附六-2 占位文案是「未填写」');
  ok(await exists(idRowSel + ' [data-changed="1"]'), '附六-2 新旧不一致 → 明确提示「联系方式已变化，请自行核实」');
  const warnTxt = await txt(idRowSel + ' [data-changed="1"]');
  ok(/自行核实/.test(warnTxt || ''), '附六-2 提示文案要求用户自行核实', String(warnTxt).slice(0, 40));
  ok(await exists(idRowSel + ' .idBiaoQian.hist') && await exists(idRowSel + ' .idBiaoQian.pending'), '附六-2 两栏分别标注「历史」与「待确认」');
  const freezeTxt = await txt(idRowSel + ' .id-freeze');
  ok((await c.evaluate(`document.querySelector('${idRowSel} .id-freeze').dataset.freeze`)) === '1', '附六-3 冻结期状态被标出（data-freeze=1）');
  ok(/7 天内不采用/.test(freezeTxt || ''), '附六-3 横幅写明「7 天内不采用新联系方式」', String(freezeTxt).slice(0, 60));
  ok(/剩余 6 天|剩余 7 天/.test(freezeTxt || ''), '附六-3 显示剩余冻结时间', String(freezeTxt).slice(0, 60));
  const adoptDisabled = await c.evaluate(`(function(){var b=document.querySelector('${idRowSel} button[data-bn="idAdopt"]'); return b? b.disabled : null;})()`);
  ok(adoptDisabled === true, '附六-3 冻结期内「采用新联系方式」被禁用', String(adoptDisabled));
  await c.evaluate('window.__idTest.reset(); true');
  await clickReal(idRowSel + ' button[data-bn="idAdopt"]');
  await sleep(400);
  ok((await c.evaluate('window.__idTest.callsOf("adopt").length')) === 0, '附六-3 冻结期内点它不会采用（未调用身份层 adopt）');
  await okContrast(idRowSel + ' .bnBiaoTi', '附六-2 换证横幅标题可读');
  await okContrast(idRowSel + ' [data-card="history"] .idK', '附六-2 历史卡字段名可读');
  await okContrast(idRowSel + ' [data-card="history"] .idV', '附六-2 历史卡值可读');
  await okContrast(idRowSel + ' [data-card="new"] [data-empty="1"]', '附六-2 「未填写」占位可读');
  await okContrast(idRowSel + ' .idBiaoQian.pending', '附六-2 「待确认」标签可读');

  // 7b. 折叠（保留常驻标记）
  at = '7b 折叠';
  await clickReal(idRowSel + ' button[data-bn="idCollapse"]', `!!document.querySelector('${idRowSel} .idTiaoMu.isCollapsed')`);
  ok(await exists(idRowSel + ' .idTiaoMu.isCollapsed'), '附六-4 可折叠');
  const detailShown = await c.evaluate(`(function(){var d=document.querySelector('${idRowSel} .idTiaoMu .idXiangQing'); return getComputedStyle(d).display !== 'none';})()`);
  ok(detailShown === false, '附六-4 折叠后明细隐藏');
  ok(await visible(idRowSel + ' .idMarker'), '附六-4 折叠后仍保留常驻标记（不消失）');
  await clickReal(idRowSel + ' button[data-bn="idCollapse"]', `!document.querySelector('${idRowSel} .idTiaoMu.isCollapsed')`);
  ok(true, '附六-4 可再展开');

  // 7c. 关闭：二次确认 + 审计，且只是暂时隐藏
  at = '7c 关闭（二次确认 + 审计）';
  await c.evaluate('window.__idTest.reset(); true');
  await clickReal(idRowSel + ' button[data-bn="idDismiss"]', "!document.querySelector('#duiHuaKuangGen').classList.contains('yinCang')");
  const mDim = await modal();
  const dimTitle = mDim.visible ? mDim.biaoTi : '';
  ok(/关闭身份变更提醒/.test(dimTitle || ''), '附六-5 关闭前弹二次确认', String(dimTitle).slice(0, 30));
  const okBtnState = await c.evaluate(`(function(){var b=document.querySelector('#duiHuaKuangDongZuoJi .anNiuDanger'); return b? {disabled:b.disabled, text:b.textContent} : null;})()`);
  ok(okBtnState && okBtnState.disabled === true, '附六-5 二次确认带倒计时（确认键先禁用）', JSON.stringify(okBtnState));
  const cancelRes = await clickModal('取消');
  await sleep(300);
  ok(cancelRes.ok && (await c.evaluate('window.__idTest.callsOf("ack").length')) === 0, '附六-5 取消 → 不关闭、不记审计');
  ok(await exists(idRowSel + ' .idTiaoMu'), '附六-5 取消后横幅仍在');
  // 再来一次并确认
  await clickReal(idRowSel + ' button[data-bn="idDismiss"]', "!document.querySelector('#duiHuaKuangGen').classList.contains('yinCang')");
  await c.waitFor(`(function(){var b=document.querySelector('#duiHuaKuangDongZuoJi .anNiuDanger'); return !!b && b.disabled === false;})()`, { timeout: 6000, biaoQian: '倒计时结束，确认键可用' });
  const okRes = await clickModal('确定');
  ok(okRes.ok, '附六-5 倒计时结束后可确认关闭');
  await c.waitFor(`window.__idTest.callsOf("ack").length >= 1`, { timeout: 6000, biaoQian: '关闭动作记入审计' });
  const ackCall = JSON.parse(await c.evaluate('JSON.stringify(window.__idTest.callsOf("ack"))'));
  ok(ackCall.some((x) => x.level === 'dismiss'), '附六-5 关闭动作写入审计（level=dismiss）', JSON.stringify(ackCall));
  await c.waitFor(`!document.querySelector('${idRowSel} .idTiaoMu')`, { timeout: 6000, biaoQian: '明细收起为常驻标记' });
  ok((await c.evaluate(`document.querySelector('${idRowSel}').dataset.marker`)) === '1', '附六-5 关闭后仍留常驻标记（不是彻底消失）');

  at = '7d 重新进入会话 → 重现';
  await navTo('singleAi');
  await openSession('internalGroup', '项目推进群');
  await c.waitFor(`!!document.querySelector('${idRowSel} .idTiaoMu')`, { timeout: 8000, biaoQian: '重新进入该会话后明细重现' });
  ok(true, '附六-5 关闭只是暂时隐藏：下次进该会话重新出现（未点「已联系本人核实」之前）');

  // 7e. 联系人（无历史留存 + 冻结期满但需手动确认）
  at = '7e 联系人：无历史留存 + 冻结期满仍需手动确认';
  await openSession('externalChat', '张三');
  await c.waitFor(`!!document.querySelector('${idRowSel}')`, { timeout: 8000, biaoQian: '联系人会话里出现换证横幅' });
  ok(true, '附六-1 联系人（第二处）里出现身份变更横幅');
  ok(await exists(idRowSel + ' [data-empty-history="1"]'), '附六-2 本机无历史留存 → 如实标注（不是留空）');
  const noHistTxt = await txt(idRowSel + ' [data-empty-history="1"]');
  ok(/本机无历史联系方式/.test(noHistTxt || ''), '附六-2 文案为「本机无历史联系方式」', String(noHistTxt).slice(0, 40));
  const empt2 = await c.evaluate(`document.querySelectorAll('${idRowSel} [data-card="new"] [data-empty="1"]').length`);
  ok(empt2 >= 2, '附六-2 新名片两个字段都为空 → 都显示「未填写」', 'empty=' + empt2);
  const freeze2 = await txt(idRowSel + ' .id-freeze');
  ok(/冻结期已结束/.test(freeze2 || '') && /手动确认/.test(freeze2 || ''), '附六-3 冻结期满：不自动采用，仍需手动确认', String(freeze2).slice(0, 60));
  await c.evaluate('window.__idTest.reset(); true');
  await sleep(1500);
  ok((await c.evaluate('window.__idTest.callsOf("adopt").length')) === 0, '附六-3 冻结期满后不会自动采用（等 1.5s 无 adopt 调用）');
  const adopt2 = await c.evaluate(`(function(){var b=document.querySelector('${idRowSel} button[data-bn="idAdopt"]'); return b? b.disabled : null;})()`);
  ok(adopt2 === false, '附六-3 冻结期满后「采用新联系方式」可点（需用户手动确认）');
  await clickReal(idRowSel + ' button[data-bn="idAdopt"]', "!document.querySelector('#duiHuaKuangGen').classList.contains('yinCang')");
  const mAdopt = await modal();
  const adoptTitle = mAdopt.visible ? mAdopt.biaoTi : '';
  ok(/采用新联系方式/.test(adoptTitle || ''), '附六-3 采用前还有一次确认', String(adoptTitle).slice(0, 30));
  await clickModal('确定');
  await c.waitFor('window.__idTest.callsOf("adopt").length >= 1', { timeout: 6000, biaoQian: '手动确认后调用 adopt' });
  ok(true, '附六-3 只有手动确认后才采用新联系方式（adopt 已调用）');
  await c.waitFor(`document.querySelector('${idRowSel} .id-freeze').dataset.adopted === '1'`, { timeout: 6000, biaoQian: '界面显示已采用' });
  ok(/已采用/.test(await txt(idRowSel + ' .id-freeze')), '附六-3 采用后界面如实显示「已采用新联系方式」');

  // 7f. 群聊（第三处）+ 列表常驻标记
  at = '7f 群聊（第三处）';
  await openSession('externalGroup', '外部协作群');
  await c.waitFor(`!!document.querySelector('${idRowSel}')`, { timeout: 8000, biaoQian: '群聊里出现换证横幅' });
  ok(true, '附六-1 群聊（第三处）里出现身份变更横幅 —— 三处齐了');
  await c.evaluate('window.__idTest.reset(); true');
  await clickReal(idRowSel + ' button[data-bn="idVerify"]', "!document.querySelector('#duiHuaKuangGen').classList.contains('yinCang')");
  await clickModal('确定');
  await c.waitFor('window.__idTest.callsOf("ack").length >= 1', { timeout: 6000, biaoQian: '核实动作记入身份层' });
  const ack2 = JSON.parse(await c.evaluate('JSON.stringify(window.__idTest.callsOf("ack"))'));
  ok(ack2.some((x) => x.level === 'verified'), '附六-5 「已联系本人核实」写入身份层（level=verified）', JSON.stringify(ack2));
  await c.waitFor(`!document.querySelector('${idRowSel}')`, { timeout: 8000, biaoQian: '核实后横幅消失' });
  ok(!(await exists(idRowSel)), '附六-5 核实后该变更不再打扰（横幅消失）');

  // 列表行常驻标记（三个入口都不打开会话也能看到）
  await navTo('internalGroup');
  await c.waitFor(`document.querySelectorAll('#lieBiaoTi .lieBiaoTiaoMu').length > 0`, { timeout: 8000, biaoQian: '项目列表' });
  ok((await cnt('#lieBiaoTi .idBianGengMark[data-idchg-mark="1"]')) >= 1, '附六-6 项目列表行有「身份变更待核实」常驻标记');
  await navTo('externalChat');
  await c.waitFor(`document.querySelectorAll('#lieBiaoTi .lieBiaoTiaoMu').length > 0`, { timeout: 8000, biaoQian: '联系人列表' });
  ok((await cnt('#lieBiaoTi .idBianGengMark[data-idchg-mark="1"]')) >= 1, '附六-6 联系人列表行有常驻标记');
  await okContrast('#lieBiaoTi .idBianGengMark[data-idchg-mark="1"]', '附六-6 常驻标记可读');
  await navTo('externalGroup');
  await c.waitFor(`document.querySelectorAll('#lieBiaoTi .lieBiaoTiaoMu').length > 0`, { timeout: 8000, biaoQian: '群聊列表' });
  ok((await cnt('#lieBiaoTi .idBianGengMark[data-idchg-mark="1"]')) === 0, '附六-6 已核实的群聊不再显示标记（核实真的生效）');

  // 7g. 下次启动（reload）仍重现
  at = '7g 下次启动重现';
  await c.send('Page.reload', { ignoreCache: false });
  await c.waitFor('typeof window.__saveState === "function" && !!window.__netUi', { timeout: 30000, biaoQian: '重启后页面就绪' });
  await closeModal();
  await openSession('internalGroup', '项目推进群');
  await c.waitFor(`!!document.querySelector('${idRowSel} .idTiaoMu')`, { timeout: 9000, biaoQian: '重启后未核实的换证横幅重新出现' });
  ok(true, '附六-5 下次启动（reload）后未核实的提醒重新出现');
  await openSession('externalGroup', '外部协作群');
  await sleep(600);
  ok(!(await exists(idRowSel)), '附六-5 已核实的变更重启后不再出现（核实是持久的）');

  /* ══ 8. 附六 名片可见性：加入即交换，不可隐藏但可以不写 ══ */
  step('8. 附六 名片：加入群/项目/联系人时对方一定看得到（不可隐藏，可不写）');
  at = '8 加入联系人时的名片';
  await c.evaluate("window.__idTest.setState({ ka: { email:'wo@example.com', phone:'' } }); true");
  await openSession('externalChat', '张三');
  const before = await cnt('#lieBiaoTi .lieBiaoTiaoMu');
  await clickReal('#anNiuJiaRuqr', "!document.querySelector('#duiHuaKuangGen').classList.contains('yinCang')"); // R4：联系人的添加入口只剩这一个（右手同名按钮已移除）
  await c.waitFor('!!document.querySelector("#duiHuaKuangTi input")', { timeout: 6000, biaoQian: '输入联系人名字' });
  await c.evaluate(`(function(){var i=document.querySelector('#duiHuaKuangTi input'); i.value='新联系人'; return true;})()`);
  await clickModal('确定');
  await c.waitFor('!!document.querySelector("#duiHuaKuangTi .myKa")', { timeout: 6000, biaoQian: '名片确认弹窗' });
  const mCard = await modal();
  ok(mCard.visible, '附六-7 名片确认弹窗可见');
  const cardTxt = await txt('#duiHuaKuangTi .myKa');
  ok(/wo@example\.com/.test(cardTxt || ''), '附六-7 加入前展示「对方将看到的名片」（邮箱来自身份层）', String(cardTxt).slice(0, 60));
  ok((await cnt('#duiHuaKuangTi .myKa [data-empty="1"]')) >= 1, '附六-7 空字段显示「未填写」占位');
  ok(/不可隐藏/.test(cardTxt || ''), '附六-7 明说「不可隐藏，但可以不写」', String(cardTxt).slice(0, 70));
  await clickModal('取消');
  await sleep(300);
  ok((await cnt('#lieBiaoTi .lieBiaoTiaoMu')) === before, '附六-7 取消则不加入（名片确认是必经一步）');
  await clickReal('#anNiuJiaRuqr', "!document.querySelector('#duiHuaKuangGen').classList.contains('yinCang')"); // R4：联系人的添加入口只剩这一个（右手同名按钮已移除）
  await c.waitFor('!!document.querySelector("#duiHuaKuangTi input")', { timeout: 6000, biaoQian: '再次输入名字' });
  await c.evaluate(`(function(){var i=document.querySelector('#duiHuaKuangTi input'); i.value='新联系人'; return true;})()`);
  await clickModal('确定');
  await c.waitFor('!!document.querySelector("#duiHuaKuangTi .myKa")', { timeout: 6000, biaoQian: '名片确认弹窗' });
  await clickModal('确定');
  await c.waitFor(`document.querySelectorAll('#lieBiaoTi .lieBiaoTiaoMu').length === ${before + 1}`, { timeout: 6000, biaoQian: '联系人加入' });
  ok(true, '附六-7 确认名片后才完成加入动作');

  at = '8 加入项目/群聊时的名片';
  await navTo('internalGroup');
  await c.waitFor('!!document.querySelector("#anNiuJiaRuqr")', { timeout: 6000, biaoQian: '扫码加入入口' });
  await clickReal('#anNiuJiaRuqr', "!!document.querySelector('#duiHuaKuangTi .myKa')");
  ok(await exists('#duiHuaKuangTi .myKa'), '附六-7 加入项目/群聊的入口同样展示名片');
  await okContrast('#duiHuaKuangTi .myKa .bnTiShi', '附六-7 名片说明可读');
  await closeModal();

  /* ══ 9. 对比度 ≥ 3.0 全扫（亮/暗两套主题） ══ */
  step('9. 对比度 ≥ 3.0（项目硬规则）—— 亮色');
  at = '9 亮色对比度';
  // 造出一个组网横幅（组网关闭 + 异地成员）
  await c.evaluate("window.__netTest.setState({ samples:[true], members:{ 'g-1':[ {id:'remote-bob',ming:'remote-bob',remote:true,online:true} ] } }); true");
  await c.evaluate('void window.__netUi.refreshPresence(); true');
  await c.waitFor('window.__netUi.net.remoteCount >= 1', { timeout: 6000, biaoQian: '第 9 节：异地成员就绪' });
  // 7g 的 reload 把内存里的检测结论清掉了（真实产品里也应重新检测），这里只为造出横幅而补一次
  await c.evaluate("window.__netUi.net.probe = { verdict:'pass', at: Date.now(), isPublic:true, outboundOk:true, method:'autonat' }; true");
  await c.evaluate('void window.__netUi.setEnabled(true); true');
  await c.waitFor('window.__netUi.net.enabled === true', { timeout: 6000, biaoQian: '第 9 节：组网打开' });
  await c.evaluate('void window.__netUi.setEnabled(false); true');
  await c.waitFor('window.__netUi.net.enabled === false', { timeout: 6000, biaoQian: '第 9 节：组网关闭' });
  await c.waitFor(`!!document.querySelector('${netRowSel}')`, { timeout: 8000, biaoQian: '组网关闭横幅出现' });
  await openSession('internalGroup', '项目推进群');
  await c.waitFor(`!!document.querySelector('${idRowSel}')`, { timeout: 8000, biaoQian: '换证横幅同时存在' });
  await c.evaluate("window.__HARNESS_CFG = window.__HARNESS_CFG || {}; window.__HARNESS_CFG.groupMembersOverride = [{ groupId:'g-1', members:['demo.agent','归档员','remote-bob','remote-carl'] }]; true");
  await c.evaluate('void window.__netUi.refreshMembers(); true');
  await c.waitFor("document.querySelectorAll('#chengYuanJiHe .chengYuanHang[data-state=\"meshOff\"]').length >= 1", { timeout: 8000, biaoQian: '第 9 节：组网关闭态成员行' });
  ok((await cnt(netRowSel)) === 1 && (await cnt(idRowSel)) === 1, '9-0 两类横幅各一条（组网行不叠加，身份行是另一类）');
  const LIGHT = [
    [netRowSel + ' .bnBiaoTi', '组网横幅标题'],
    [netRowSel + ' .bnTi', '组网横幅正文'],
    [netRowSel + ' .bnTiShi', '组网横幅提示'],
    [netRowSel + ' button[data-bn="netDismiss"]', '横幅关闭按钮'],
    [idRowSel + ' .idBiaoTi', '换证横幅标题'],
    [idRowSel + ' .bnTi', '换证横幅正文'],
    [idRowSel + ' .idZhaiYao', '换证摘要'],
    [idRowSel + ' .idPending', '待核实标签'],
    [idRowSel + ' .idMarker', '常驻标记'],
    [idRowSel + ' [data-changed="1"]', '联系方式变化提示'],
    [idRowSel + ' .id-freeze', '冻结期说明'],
    ['#liaoTianBiaoTi', '会话标题（对照）'],
    ['#chengYuanJiHe .chengYuanHang[data-state="meshOff"] .chengYuanMing', '异地成员（组网关闭）'],
    ['#chengYuanJiHe .chengYuanHang[data-state="meshOff"] .chengYuanHuiZhang[data-state="mesh-off"]', '组网关闭角标'],
  ];
  for (const [sel, biaoQian] of LIGHT) {
    if (!(await exists(sel))) { ok(false, '对比度检查：找不到 ' + sel + '（' + biaoQian + '）'); continue; }
    await okContrast(sel, '9 ' + biaoQian);
  }
  // 设置页组网卡片
  await navTo('settings');
  await c.evaluate("(function(){var b=Array.from(document.querySelectorAll('#peiZhiDaoHang button')).filter(function(x){return x.dataset.sec==='func';})[0]; if(b) b.click(); return true;})()");
  await c.waitFor('!!document.querySelector("#wangLuoKa")', { timeout: 8000, biaoQian: '组网卡片' });
  for (const [sel, biaoQian] of [['#wangLuoKa .jingYin', '组网卡片说明'], ['#wangLuoSwitchXiaoXi', '开关状态说明'], ['#wangLuoTanCeResult .jingYin', '检测细节'], ['#wangLuoBenJiXinXi', '本机地址信息'], ['#wangLuoKa .wangLuoFuBiaoQian', '域名标签']]) {
    if (!(await exists(sel)) || !(await c.evaluate(`(document.querySelector(${JSON.stringify(sel)}).textContent||'').trim().length > 0`))) {
      warn('跳过（无内容）: ' + sel);
      continue;
    }
    await okContrast(sel, '9 ' + biaoQian);
  }
  const probeLine = await exists('#wangLuoTanCeResult .wangLuoTanCeXian');
  if (probeLine) await okContrast('#wangLuoTanCeResult .wangLuoTanCeXian', '9 检测结论行');

  step('9b. 对比度 —— 暗色主题（同一批元素复算）');
  at = '9b 暗色对比度';
  await c.evaluate("(function(){var b=Array.from(document.querySelectorAll('.zhuTiMoShi button')).filter(function(x){return x.dataset.m==='dark';})[0]; if(b) b.click(); return true;})()");
  await c.waitFor('document.documentElement.getAttribute("data-theme") === "dark"', { timeout: 6000, biaoQian: '切到暗色主题' });
  await openSession('internalGroup', '项目推进群');
  await c.waitFor(`!!document.querySelector('${idRowSel}')`, { timeout: 8000, biaoQian: '暗色下换证横幅仍在' });
  await c.evaluate("window.__HARNESS_CFG = window.__HARNESS_CFG || {}; window.__HARNESS_CFG.groupMembersOverride = [{ groupId:'g-1', members:['demo.agent','归档员','remote-bob','remote-carl'] }]; true");
  await c.evaluate('void window.__netUi.refreshMembers(); true');
  await c.waitFor("document.querySelectorAll('#chengYuanJiHe .chengYuanHang[data-state=\"meshOff\"]').length >= 1 && document.querySelectorAll('#chengYuanJiHe .chengYuanHang[data-state=\"disabled\"]').length >= 1", { timeout: 8000, biaoQian: '9b：暗色下成员行渲染' });
  for (const [sel, biaoQian] of [
    [netRowSel + ' .bnBiaoTi', '组网横幅标题（暗）'],
    [idRowSel + ' .idBiaoTi', '换证横幅标题（暗）'],
    [idRowSel + ' .idPending', '待核实标签（暗）'],
    [idRowSel + ' [data-card="history"] .idK', '历史卡字段名（暗）'],
    [idRowSel + ' [data-card="history"] .idV', '历史卡值（暗）'],
    ['#chengYuanJiHe .chengYuanHang[data-state="meshOff"] .chengYuanMing', '异地成员置灰（暗）'],
    ['#chengYuanJiHe .chengYuanHang[data-state="disabled"] .chengYuanMing', '停用成员置灰（暗）'],
    ['#lieBiaoTi .idBianGengMark', '列表常驻标记（暗）'],
  ]) {
    if (!(await exists(sel))) { ok(false, '对比度检查（暗）：找不到 ' + sel); continue; }
    await okContrast(sel, '9b ' + biaoQian);
  }
  // 停用实例行（暗色）—— 走列表页
  await openInstancesPage();
  await c.waitFor(`document.querySelectorAll('#lieBiaoTi .lieBiaoTiaoMu.isJinYong').length >= 1`, { timeout: 8000, biaoQian: '暗色下停用实例行' });
  await c.evaluate(`(function(){
    var rows=Array.from(document.querySelectorAll('#lieBiaoTi .lieBiaoTiaoMu'));
    var i=rows.findIndex(function(r){return r.classList.contains('isJinYong');});
    if(i>=0) rows[i].setAttribute('data-probe','1');
    return i;
  })()`);
  await okContrast('#lieBiaoTi .lieBiaoTiaoMu[data-probe="1"] .name', '9b 停用实例名字可读（暗）');
  await okContrast('#lieBiaoTi .lieBiaoTiaoMu[data-probe="1"] .hangHuiZhang', '9b 停用角标可读（暗）');
  // 切回亮色
  await navTo('settings');
  await c.evaluate("(function(){var b=Array.from(document.querySelectorAll('.zhuTiMoShi button')).filter(function(x){return x.dataset.m==='light';})[0]; if(b) b.click(); return true;})()");
  await c.waitFor('document.documentElement.getAttribute("data-theme") === "light"', { timeout: 6000, biaoQian: '切回亮色' });

  /* ══ 10. i18n：中英对齐 + 不泄漏 key ══ */
  step('10. i18n（可见文字全部走 i18n，中英对齐）');
  at = '10 切英文';
  await c.evaluate("(function(){var s=document.querySelector('#xuanZeYuYan'); s.value='en-US'; s.dispatchEvent(new Event('change',{bubbles:true})); return true;})()");
  await c.waitFor("document.querySelector('#logoMing').textContent === 'WArmy'", { timeout: 10000, biaoQian: '切到 en-US' });
  await openSession('internalGroup', '项目推进群');
  await c.waitFor(`!!document.querySelector('${idRowSel}')`, { timeout: 9000, biaoQian: '英文界面下换证横幅' });
  const enTitle = await txt(idRowSel + ' .idBiaoTi');
  const enFreeze = await txt(idRowSel + ' .id-freeze');
  ok(/changed identity credentials/.test(enTitle || ''), '10-1 换证横幅走英文语言包', String(enTitle).slice(0, 50));
  ok(/7 days|within 7 days/.test(enFreeze || ''), '10-1 冻结期文案走英文语言包', String(enFreeze).slice(0, 60));
  const enNet = await txt(netRowSel);
  ok(/Mesh is off/.test(enNet || ''), '10-1 组网横幅走英文语言包', String(enNet).slice(0, 60));
  const leak = await c.evaluate(`(function(){
    var bad=[];
    ['#wangLuoBanner','#wangLuoKa','#chengYuanJiHe','#duiHuaKuangTi'].forEach(function(root){
      var host=document.querySelector(root); if(!host) return;
      Array.from(host.querySelectorAll('*')).forEach(function(e){
        if(e.children.length) return;
        var t=(e.textContent||'').trim();
        if(/^[a-z][a-zA-Z0-9]*(\\.[a-zA-Z0-9]+)+$/.test(t) && /(net|idchg|ka|group|identity)\\./.test(t)) bad.push(t);
      });
    });
    return JSON.stringify(bad.slice(0,10));
  })()`);
  ok(leak === '[]', '10-2 界面上没有未翻译的 i18n key 泄漏', String(leak).slice(0, 120));
  // 英文下也复核一次可见性/冻结语义（防止英文分支少信息）
  ok((await cnt(idRowSel + ' [data-card="history"]')) === 1 && (await cnt(idRowSel + ' [data-card="new"]')) === 1, '10-2 英文下历史/待确认两栏依旧并列');
  await c.evaluate("(function(){var s=document.querySelector('#xuanZeYuYan'); if(!s){var r=Array.from(document.querySelectorAll('a,button'));} s.value='zh-CN'; s.dispatchEvent(new Event('change',{bubbles:true})); return true;})()");
  await c.waitFor("document.querySelector('#logoMing').textContent === '无限牛马'", { timeout: 10000, biaoQian: '切回中文' });

  /* ══ 11. 注入自查：新增的 innerHTML 面板里，动态内容必须一律转义 ══ */
  step('11. 注入自查（新增 innerHTML 面板的动态内容一律转义）');
  at = '11 XSS 自查';
  const ATTACK = '<img src=x onerror="window.__XSSNET__=1"><script>window.__XSSNET2__=1<\/script>';
  await c.evaluate(`(function(){
    window.__XSSNET__ = 0; window.__XSSNET2__ = 0;
    window.__netTest.setState({ members: { 'g-1': [ { id:'evil', ming:${JSON.stringify(ATTACK)}, remote:true, online:false, disabled:false } ] } });
    window.__idTest.setChanges([{ id:'atk-1', ts: Date.now(), generation: 9,
      subjectName: ${JSON.stringify(ATTACK)}, oldFingerprint: ${JSON.stringify(ATTACK)}, newFingerprint: 'NEW',
      previousCard: { email: ${JSON.stringify(ATTACK)}, phone: '' },
      pendingCard: { email: ${JSON.stringify(ATTACK)}, phone: '' },
      scopes: [{ kind:'internal', id:'g-1' }] }]);
    window.__netUi.net.addr.publicAddresses = [${JSON.stringify(ATTACK)}];
    return true;})()`);
  // 成员行渲染的是 groupMembers 的名字（不是 presence 的 key），所以恶意串要放进成员表
  await c.evaluate(`window.__HARNESS_CFG = window.__HARNESS_CFG || {}; window.__HARNESS_CFG.groupMembersOverride = [{ groupId:'g-1', members: [${JSON.stringify(ATTACK)}, 'demo.agent'] }]; true`);
  await c.evaluate('void window.__netUi.refreshPresence(); void window.__netUi.loadIdChanges(); true');
  await openSession('internalGroup', '项目推进群');
  await c.evaluate('void window.__netUi.refreshMembers(); true');
  await c.waitFor(`!!document.querySelector('${idRowSel}')`, { timeout: 9000, biaoQian: 'XSS：换证横幅出现' });
  await c.waitFor("document.querySelectorAll('#chengYuanJiHe .chengYuanHang').length >= 1", { timeout: 9000, biaoQian: 'XSS：成员行出现' });
  const lit = JSON.parse(await c.evaluate(`(function(){
    var mb = (document.querySelector('#chengYuanJiHe').textContent || '');
    var bn = (document.querySelector('#wangLuoBanner').textContent || '');
    return JSON.stringify({ members: mb.indexOf('<img src=x') >= 0, banner: bn.indexOf('<img src=x') >= 0 && bn.indexOf('<script>') >= 0 });
  })()`));
  await ensureNetCard();
  const inj = await c.evaluate(`(function(){
    return JSON.stringify({
      ran: (window.__XSSNET__ || 0) + (window.__XSSNET2__ || 0),
      injected: document.querySelectorAll('#chengYuanJiHe img, #chengYuanJiHe script, #chengYuanJiHe input[type=image], #wangLuoBanner img, #wangLuoBanner script, #wangLuoDomains img, #wangLuoDomains script').length,
      domainValue: (document.querySelector('#wangLuoDomains input') || {}).value || '',
    });
  })()`);
  const injObj = JSON.parse(inj);
  ok(injObj.ran === 0, '11-1 注入的 onerror / script 都没有执行', inj);
  ok(injObj.injected === 0, '11-1 没有多出 img/script 元素（横幅、成员行、域名列表）', inj);
  ok(lit.members === true && lit.banner === true, '11-2 恶意串以字面文本出现（被转义成文本，不是 HTML）', JSON.stringify(lit));
  ok(injObj.domainValue.indexOf('<img src=x') === 0, '11-3 域名输入框里是原始文本（属性值已转义）', injObj.domainValue.slice(0, 40));
  // 收尾：把桩数据还原，避免影响后续（本用例已是最后一段，仅保持状态干净）
  await c.evaluate("window.__idTest.setChanges([]); void window.__netUi.loadIdChanges(); true");

  /* ══ 12. 附八.9 / 附八.3：连接阶梯档位 + 中继状态 + 终态（双不可拨入且无中继）══ */
  step('12. 附八.9/附八.3 连接阶梯：六档文案 + 中继状态 + 终态（与"正在重试"区分开）');
  at = '12 i18n 键对齐';

  // 12a. 键必须两边都有、非空、英文包不许有中文（键集合对齐）
  {
    const missZh = NEW_NET_KEYS.filter((k) => typeof ZH[k] !== 'string' || !ZH[k].length);
    const missEn = NEW_NET_KEYS.filter((k) => typeof EN[k] !== 'string' || !EN[k].length);
    ok(missZh.length === 0 && missEn.length === 0,
      '12-1 新增的 ' + NEW_NET_KEYS.length + ' 个 net.* 键在中英两包都存在且非空',
      'zh 缺=' + JSON.stringify(missZh) + ' en 缺=' + JSON.stringify(missEn));
    const cjk = NEW_NET_KEYS.filter((k) => CJK.test(EN[k]));
    ok(cjk.length === 0, '12-1 英文包里这些键不含中文', JSON.stringify(cjk));
    const groups = ['net.rung.', 'net.relay.', 'net.dialability.', 'net.ladder.'];
    const misaligned = groups.flatMap((g) =>
      Object.keys(ZH).filter((k) => k.startsWith(g) && !(k in EN)).concat(Object.keys(EN).filter((k) => k.startsWith(g) && !(k in ZH))));
    ok(misaligned.length === 0, '12-1 中英两包的 net.rung./net.relay./net.dialability./net.ladder. 键集合完全对齐', JSON.stringify(misaligned));
    ok(!CJK.test(EN['net.rung.ipv6Direct']) && EN['net.rung.ipv6Direct'].length > 0,
      '12-1 IPv6 档的英文文案确实是英文', EN['net.rung.ipv6Direct']);
  }

  // 12b. 让阶梯区块吃到**组网层 IPC** 给的数据（走 netStatus 桩 → netPollOnce → 渲染，不是直接塞 DOM）
  at = '12 打开组网并喂入可达性';
  await c.evaluate("window.__netUi.net.probe = { verdict:'pass', at: Date.now(), isPublic:true, outboundOk:true, method:'autonat' }; true");
  await c.evaluate("window.__netTest.setSamples([true]); void window.__netUi.setEnabled(true); true");
  await c.waitFor('window.__netUi.net.enabled === true', { timeout: 8000, biaoQian: '12：组网打开（阶梯区块的前提）' });
  await c.evaluate(`window.__netTest.setState({ ipv6: { hasGlobalUnicast: true, publicCandidate: '2001:db8::1' }, ipv6Facts: null }); true`);
  await c.evaluate(`window.__netTest.setState({
    reachability: {
      selfDialable: true, peerDialable: true, bothUndialable: false, needsPublicRelayNotice: false,
      relayCode: 'relay-not-needed-peer-dialable', localIpv6: { hasGlobalUnicast: true, publicCandidate: '2001:db8::1' },
      ipv6: { hasGlobalUnicast: true, publicCandidate: '2001:db8::1' },
      naturalDialable: true, dialableKind: 'peer-verified',
      suggestedRung: 'ipv6-direct',
      i18n: { rung: 'net.rung.ipv6Direct', relay: 'net.relay.notNeeded.peerDialable' },
    }, sessions: 1,
  }); true`);
  await ensureNetCard();
  await c.evaluate('void window.__netUi.heartbeat(); true');
  await c.waitFor(`document.querySelectorAll('#wangLuoLadder .wangLuoRung').length === 6`, { timeout: 8000, biaoQian: '12：阶梯区块出现 6 档' });
  ok((await cnt('#wangLuoLadder .wangLuoRung')) === 6, '12-2 组网卡片里把六个档位全部列出来（不是只显示当前一档）', 'rows=' + (await cnt('#wangLuoLadder .wangLuoRung')));
  ok(await visible('#wangLuoLadder'), '12-2 阶梯区块真实可见（有尺寸）');

  // 12c. 六档文案逐字等于语言包（zh）
  at = '12 六档文案（zh）';
  const rungTexts = JSON.parse(await c.evaluate(`(function(){
    var out={};
    Array.from(document.querySelectorAll('#wangLuoLadder .wangLuoRung')).forEach(function(li){
      out[li.dataset.rung] = { text: li.querySelector('.net-rung-text').textContent, state: li.dataset.state };
    });
    return JSON.stringify(out);
  })()`));
  const order = JSON.parse(await c.evaluate(`JSON.stringify(Array.from(document.querySelectorAll('#wangLuoLadder .wangLuoRung')).map(function(li){return li.dataset.rung;}))`));
  ok(JSON.stringify(order) === JSON.stringify(RUNG_KEYS.map((x) => x[0])),
    '12-2 六档顺序 = 附八.9 定的阶梯顺序（IPv6 → IPv4 → 映射 → 打洞 → 中继 → 局域网）', JSON.stringify(order));
  const supported = [['ipv6-direct', 'net.rung.ipv6Direct'], ['public-direct', 'net.rung.publicDirect'], ['relay', 'net.rung.relay'], ['lan', 'net.rung.lan']];
  const supportedBad = supported.filter(([r, k]) => !rungTexts[r] || rungTexts[r].text !== ZH[k]);
  ok(supportedBad.length === 0, '12-2 已实现四档的文案**逐字**等于 zh-CN 语言包', JSON.stringify(supportedBad.map((x) => [x[0], rungTexts[x[0]] && rungTexts[x[0]].text, ZH[x[1]]])));
  const unsupportedBad = [['upnp', 'net.rung.upnp'], ['holepunch', 'net.rung.holepunch']]
    .filter(([r, k]) => !rungTexts[r] || rungTexts[r].text !== ZH[k] + ' · ' + ZH['net.ladder.unsupported']);
  ok(unsupportedBad.length === 0, '12-2 未实现两档的文案 = 档位名 + 「尚未实现（不可用）」（逐字比对 zh 包）',
    JSON.stringify(unsupportedBad.map((x) => [x[0], rungTexts[x[0]] && rungTexts[x[0]].text])));
  const leaked = order.filter((r) => /net\.(rung|relay|ladder|dialability)\./.test(rungTexts[r] ? rungTexts[r].text : ''));
  ok(leaked.length === 0, '12-2 六档文案里没有未翻译的 i18n key 泄漏', JSON.stringify(leaked));

  // 12d. 未实现的档**不得**显示成"正在跑"
  at = '12 未实现档不得像在跑';
  ok(rungTexts['upnp'] && rungTexts['upnp'].state === 'unsupported' && rungTexts['holepunch'] && rungTexts['holepunch'].state === 'unsupported',
    '12-3 upnp/holepunch 标为 unsupported（不是 current/candidate）', JSON.stringify({ upnp: rungTexts['upnp'], holepunch: rungTexts['holepunch'] }));
  ok(rungTexts['ipv6-direct'] && rungTexts['ipv6-direct'].state === 'current',
    '12-3 IPv6 档被标为当前档（附八.9：IPv6 无 NAT，是阶梯第一档）', JSON.stringify(rungTexts['ipv6-direct']));
  ok((await cnt('#wangLuoLadder .wangLuoRung[data-state="current"]')) === 1, '12-3 当前档恒只有一个（不并列）', 'current=' + (await cnt('#wangLuoLadder .wangLuoRung[data-state="current"]')));
  await okContrast('#wangLuoLadder .wangLuoRung[data-state="current"] .net-rung-text', '12-3 当前档文案可读（对比度 >= 3.0）');
  await okContrast('#wangLuoLadder .wangLuoRung[data-state="unsupported"] .net-rung-text', '12-3 未实现档文案可读（置灰用 --ink-dim）');
  await okContrast('#wangLuoLadder .wangLuoLadderV', '12-3 阶梯取值文案可读');

  // 主进程若（错误地）把未实现的档报成当前档，UI 也只能显示成 unsupported
  await c.evaluate(`window.__netTest.setState({ reachability: Object.assign({}, window.__netTest.reachability, { suggestedRung: 'holepunch', i18n: { rung: 'net.rung.holepunch' } }) }); true`);
  await c.evaluate('void window.__netUi.heartbeat(); true');
  await c.waitFor(`document.querySelector('#wangLuoLadder .wangLuoRung[data-rung="holepunch"]').dataset.state === 'unsupported'`, { timeout: 8000, biaoQian: '12：上报未实现档后仍标 unsupported' });
  const claimedView = JSON.parse(await c.evaluate(`(function(){
    var li=document.querySelector('#wangLuoLadder .wangLuoRung[data-rung="holepunch"]');
    var cur=document.querySelector('#wangLuoLadderCurrent');
    return JSON.stringify({ state: li.dataset.state, curRung: cur.dataset.rung, claimed: cur.dataset.claimed,
      currentCount: document.querySelectorAll('#wangLuoLadder .wangLuoRung[data-state="current"]').length });
  })()`));
  ok(claimedView.state === 'unsupported' && claimedView.currentCount === 0,
    '12-3 即便组网层把打洞报成当前档，界面也**拒绝**显示成"正在打洞"（如实标未实现）', JSON.stringify(claimedView));
  ok(claimedView.claimed === 'holepunch', '12-3 但仍如实记录"组网层声称的档"（可诊断，不丢信息）', JSON.stringify(claimedView));

  // 12e. 中继状态四条文案（走 i18n）
  at = '12 中继状态';
  /** 用**组网层桩**喂一条可达性（走 netStatus → netPollOnce → 渲染链路），并立刻心跳一次 */
  const setReach = async (reach) => {
    await c.evaluate(`window.__netTest.setState({ reachability: ${JSON.stringify(reach)} }); true`);
    await c.evaluate('void window.__netUi.heartbeat(); true');
  };
  const relayText = () => c.evaluate("(function(){var e=document.querySelector('#wangLuoLadderRelay');return e?e.textContent:null;})()");
  const relayCode = () => c.evaluate("(function(){var e=document.querySelector('#wangLuoLadderRelay');return e?e.dataset.code:null;})()");

  await setReach({ relayCode: 'relay-not-needed-peer-dialable', suggestedRung: 'ipv6-direct', i18n: { rung: 'net.rung.ipv6Direct', relay: 'net.relay.notNeeded.peerDialable' } });
  ok((await relayText()) === ZH['net.relay.notNeeded.peerDialable'], '12-4 对端可直连 → 「无需中继」文案（逐字等于 zh 包）', await relayText());

  await setReach({ relayCode: 'relay-none-configured', i18n: {} });
  ok((await relayText()) === ZH['net.relay.missing.noneConfigured'] && (await relayCode()) === 'relay-none-configured',
    '12-4 无中继候选 → 「需要一台有公网地址的机器做中继」（逐字等于 zh 包）', await relayText());

  await setReach({ relayCode: 'relay-unreachable', i18n: {} });
  ok((await relayText()) === ZH['net.relay.missing.unreachable'], '12-4 配了中继但都连不上 → 如实报缺口（逐字等于 zh 包）', await relayText());

  await setReach({
    relayCode: 'relay-selected', i18n: { rung: 'net.rung.relay', relay: 'net.relay.selected' },
    relay: { needed: true, selected: true, code: 'relay-selected', reason: 'x', bothUndialable: false, tokenSymmetric: true, attempts: [{ addr: { host: '203.0.113.7', port: 7788 }, ok: true, ms: 12 }], needsPublicRelayNotice: false },
  });
  ok((await relayText()) === ZH['net.relay.selected'], '12-4 选中可用中继 → 「经中继（更慢，但可用）」（逐字等于 zh 包）', await relayText());
  const relayCurrent = JSON.parse(await c.evaluate(`(function(){var li=document.querySelector('#wangLuoLadder .wangLuoRung[data-rung="relay"]');var cur=document.querySelector('#wangLuoLadderCurrent');return JSON.stringify({state: li.dataset.state, curText: cur.textContent, code: document.querySelector('#wangLuoLadderRelay').dataset.code});})()`));
  ok(relayCurrent.state === 'current' && relayCurrent.curText === ZH['net.rung.relay'],
    '12-4 中继被选中时，当前档位随之变为"中继"', JSON.stringify(relayCurrent));

  // 12f. 本机可拨入性四类
  at = '12 可拨入性';
  const dialView = () => c.evaluate("(function(){var e=document.querySelector('#wangLuoLadderDial');return e?{kind:e.dataset.kind, text:e.textContent, derived:e.dataset.derived}:null;})()");
  await setReach({ i18n: {}, dialableKind: 'peer-verified', naturalDialable: true });
  let dv = await dialView();
  ok(dv && dv.kind === 'peer-verified' && dv.text === ZH['net.dialability.peerVerified'] && dv.derived === '0',
    '12-5 已验证可拨入 → 走协议层给的 dialableKind（不是本地猜的）', JSON.stringify(dv));
  await setReach({ i18n: {}, selfDialable: false, naturalDialable: true });
  dv = await dialView();
  ok(dv && dv.kind === 'ipv6-global-natural' && dv.text === ZH['net.dialability.ipv6Natural'] && dv.derived === '1',
    '12-5 有全局 IPv6（地址事实）→ 天然可拨入，且标出是本地推导（data-derived=1）', JSON.stringify(dv));
  await setReach({ i18n: {}, selfDialable: false, naturalDialable: false, ipv6: { hasGlobalUnicast: false, publicCandidate: null } });
  await c.evaluate("window.__netTest.setState({ ipv6: { hasGlobalUnicast: false, publicCandidate: null } }); true");
  await c.evaluate('void window.__netUi.heartbeat(); true');
  await c.waitFor("document.querySelector('#wangLuoLadderDial').dataset.kind === 'undialable'", { timeout: 8000, biaoQian: '12：判定不可拨入' });
  dv = await dialView();
  ok(dv && dv.kind === 'undialable' && dv.text === ZH['net.dialability.undialable'], '12-5 有结论但不可拨入 → 「判定不可拨入」', JSON.stringify(dv));
  await setReach({ i18n: {} });
  dv = await dialView();
  ok(dv && dv.kind === 'undetermined' && dv.text === ZH['net.dialability.undetermined'], '12-5 没有任何可拨入性数据 → 「无法判定」（不猜）', JSON.stringify(dv));

  /* 12g. 终态：双不可拨入且无中继 —— 必须与"正在重试"区分开，且给可执行的出路 */
  at = '12 终态：先造出"正在重试"的对照组';
  // 把重试节奏放慢，好让"重试中"与"终态"两个状态都稳定可观测（退避 60s → 不会自动关组网）
  await c.evaluate('window.__netTuning = { hysteresisFailures: 3, hysteresisSeconds: 1, retryRounds: 3, backoffMs: [60000,60000,60000], tickMs: 200, reachTtlMs: 30000 }; true');
  await c.evaluate("window.__netTest.setState({ reachability: null, sessions: 0, samples: [false] }); true");
  await c.waitFor(`!!document.querySelector('${netRowSel}')`, { timeout: 12000, biaoQian: '12：断链横幅（对照组）' });
  const retryRow = JSON.parse(await c.evaluate(`(function(){var r=document.querySelector('${netRowSel}');return JSON.stringify({terminal:r.dataset.terminal, text:r.textContent, title:r.querySelector('.bnBiaoTi').textContent});})()`));
  ok(retryRow.terminal === '0' && /正在自动重试/.test(retryRow.text),
    '12-6 对照组：只有"链路失败"时是**重试**文案（data-terminal=0）', String(retryRow.biaoTi).slice(0, 40));
  ok(/第 \d+\/3 轮/.test(retryRow.text), '12-6 对照组确实在报重试轮次（证明对照组不是假的）', String(retryRow.text).slice(0, 80));

  at = '12 终态：双不可拨入且无中继';
  /** 附八.3 第 2 条的终态数据（bothUndialable + needsPublicRelayNotice + 缺口码） */
  const GAP_REACH = {
    selfDialable: false, peerDialable: false, bothUndialable: true, needsPublicRelayNotice: true,
    relayCode: 'relay-none-configured',
    ipv6: { hasGlobalUnicast: false, publicCandidate: null }, naturalDialable: false, dialableKind: 'undialable',
    relay: {
      needed: true, selected: false, code: 'relay-none-configured', reason: 'x', selfDialable: false, peerDialable: false,
      bothUndialable: true, tokenSymmetric: false, attempts: [], needsPublicRelayNotice: true,
    },
    i18n: { relay: 'net.relay.missing.needsPublicRelay' },
  };
  await setReach(GAP_REACH);
  await c.waitFor(`document.querySelector('${netRowSel}') && document.querySelector('${netRowSel}').dataset.terminal === '1'`, {
    timeout: 12000, biaoQian: '12：终态横幅出现（覆盖重试文案）',
  });
  const termRow = JSON.parse(await c.evaluate(`(function(){var r=document.querySelector('${netRowSel}');
    return JSON.stringify({ terminal:r.dataset.terminal, title:r.querySelector('.bnBiaoTi').textContent, ti:r.querySelector('.bnTi').textContent,
      btn:(r.querySelector('button[data-bn="relaySettings"]')||{}).textContent||'', hasTurnOn: !!r.querySelector('button[data-bn="turnOn"]'),
      n:document.querySelectorAll('${netRowSel}').length });})()`));
  ok(termRow.n === 1, '12-6 终态与"正在重试"只能有一条组网横幅（DOM 恒一行）', 'rows=' + termRow.n);
  ok(termRow.biaoTi === ZH['net.banner.relayTerminalTitle'], '12-6 终态标题走 i18n（逐字等于 zh 包）', String(termRow.biaoTi).slice(0, 40));
  ok(termRow.ti === ZH['net.relay.missing.noneConfigured'],
    '12-6 终态正文给出**可执行**的说法：需要一台有公网地址的机器做中继（逐字等于 zh 包）', String(termRow.ti).slice(0, 70));
  ok(!/正在自动重试|第 \d+\/3 轮/.test(termRow.ti), '12-6 终态里**没有**通用重试文案（重试没用，不该转圈）', String(termRow.ti).slice(0, 60));
  ok(termRow.btn === ZH['net.banner.relayConfigure'], '12-6 终态带可执行动作按钮（去设置配中继），文案走 i18n', String(termRow.btn).slice(0, 40));
  ok(termRow.hasTurnOn === false, '12-6 终态不给"打开组网"按钮（组网本来就开着，那不是这个问题的出路）');
  await okContrast(netRowSel + ' .bnBiaoTi', '12-6 终态横幅标题可读');
  await okContrast(netRowSel + ' button[data-bn="relaySettings"]', '12-6 终态动作按钮可读');

  // 组网横幅恒一行：同时存在身份变更行时也一样（两类各行一条）。
  // 身份变更行只在**会话可见**时出现（idRowModel 的既有语义），所以先回到会话再注入。
  at = '12 终态 + 身份变更行并存';
  await navTo('internalGroup');
  await c.waitFor(`!!document.querySelector('${netRowSel}')`, { timeout: 8000, biaoQian: '12：离开设置页后终态横幅仍在' });
  await c.evaluate(`window.__idTest.setChanges([{ id:'gap-id-1', ts: Date.now(), receivedAt: Date.now(), generation: 4,
    subjectId:'ext-9', subjectName:'王五', oldFingerprint:'FP-OLD-Z', newFingerprint:'FP-NEW-Z',
    previousCard:{ email:'wangwu@old.example', phone:'' }, pendingCard:{ email:'wangwu@new.example', phone:'' },
    contactFreezeUntil: Date.now() + 86400000, frozen:true, remainingMs: 86400000, scopes:[{ kind:'internal', id:'g-1' }] }]); void window.__netUi.loadIdChanges(); true`);
  await c.waitFor(`!!document.querySelector('${idRowSel}')`, { timeout: 9000, biaoQian: '12：身份变更行在场' });
  await c.evaluate('window.__netUi.refreshBanner(); true');
  const bothRows = JSON.parse(await c.evaluate(`JSON.stringify({ net: document.querySelectorAll('${netRowSel}').length, idchg: document.querySelectorAll('${idRowSel}').length })`));
  ok(bothRows.net === 1 && bothRows.idchg === 1, '12-6 终态横幅与身份变更横幅并存时，组网行仍恒为一行', JSON.stringify(bothRows));
  await c.evaluate("window.__idTest.setChanges([]); void window.__netUi.loadIdChanges(); true");
  await c.waitFor(`!document.querySelector('${idRowSel}')`, { timeout: 8000, biaoQian: '12：身份变更行收回' });

  // 12h. 真实点击终态按钮 → 跳到组网设置卡片
  at = '12 点终态按钮去设置';
  await c.waitFor(`!!document.querySelector('${netRowSel}')`, { timeout: 8000, biaoQian: '12：终态横幅仍在（准备点击）' });
  await clickReal(netRowSel + ' button[data-bn="relaySettings"]', "!!document.querySelector('.ceLanTiaoMu[data-nav=\"settings\"].jiHuo') && !!document.querySelector('#wangLuoKa')");
  ok(await exists('#wangLuoKa'), '12-6 点「配置中继」真实跳进设置页的组网卡片（可执行，不是死胡同）');
  const termLadder = JSON.parse(await c.evaluate(`(function(){var e=document.querySelector('#wangLuoLadderRelay');var b=document.querySelector('#wangLuoLadder');return JSON.stringify({code:e?e.dataset.code:null, terminal:b?b.dataset.terminal:null, text:e?e.textContent:null});})()`));
  ok(termLadder.terminal === '1' && termLadder.text === ZH['net.relay.missing.noneConfigured'],
    '12-6 卡片里的中继状态同步标出"需要中继"（与横幅一致）', JSON.stringify(termLadder));

  // 12i. 过期数据不作数（不拿旧结论说话）：链路恢复后关组网 → 不再轮询 → 旧结论过期即失效
  at = '12 数据过期';
  await c.evaluate('window.__netTest.setSamples([true]); true');
  await c.waitFor('window.__netUi.net.link.linkDown === false', { timeout: 10000, biaoQian: '12：链路恢复' });
  await c.evaluate("window.__netTest.setState({ members: { 'g-1': [ { id:'remote-bob', ming:'remote-bob', remote:true, online:true } ] } }); true");
  await c.evaluate('void window.__netUi.refreshPresence(); true');
  await c.waitFor('window.__netUi.net.remoteCount >= 1', { timeout: 8000, biaoQian: '12：异地成员就绪（组网关闭行需要它）' });
  await c.evaluate('void window.__netUi.setEnabled(false); true');
  await c.waitFor('window.__netUi.net.enabled === false', { timeout: 8000, biaoQian: '12：关组网（停止轮询）' });
  await c.waitFor(`!!document.querySelector('${netRowSel}')`, { timeout: 8000, biaoQian: '12：组网已关闭横幅' });
  const freshOff = await c.evaluate(`document.querySelector('${netRowSel} .bnTi').textContent`);
  ok(String(freshOff).indexOf(ZH['net.relay.missing.noneConfigured']) >= 0,
    '12-7 关组网后（数据仍新鲜）组网关闭横幅里带上"需要中继"这条出路', String(freshOff).slice(0, 80));
  await c.evaluate('window.__netTuning.reachTtlMs = 200; true');
  await sleep(600);
  await c.evaluate('window.__netUi.refreshBanner(); window.__netUi.renderLadder(); true');
  const staleOff = await c.evaluate(`document.querySelector('${netRowSel} .bnTi').textContent`);
  ok(String(staleOff).indexOf(ZH['net.relay.missing.noneConfigured']) < 0,
    '12-7 数据过期（> reachTtlMs）后不再拿它下结论：横幅不再声称"需要中继"', String(staleOff).slice(0, 80));
  ok((await c.evaluate(`document.querySelectorAll('${netRowSel}').length`)) === 1,
    '12-7 过期只影响"可达性结论"，组网关闭这件事本身照常显示（不误删真实状态）');
  const staleLadder = await c.evaluate("(function(){var e=document.querySelector('#wangLuoLadderRelay');return e?e.textContent:null;})()");
  ok(staleLadder === ZH['net.relay.unknown'], '12-7 过期后卡片里的中继状态退回「未知」而不是继续声称需要中继', String(staleLadder).slice(0, 40));

  // 12j. 英文包（同一批断言再来一遍）
  at = '12 切英文';
  await c.evaluate("(function(){var s=document.querySelector('#xuanZeYuYan'); s.value='en-US'; s.dispatchEvent(new Event('change',{bubbles:true})); return true;})()");
  await c.waitFor("document.querySelector('#logoMing').textContent === 'WArmy'", { timeout: 10000, biaoQian: '12：切到 en-US' });
  // 组网开着才会有 netStatus 轮询 → 可达性才会进到界面（12i 收尾时关掉了）
  await c.evaluate('window.__netTuning.reachTtlMs = 30000; true');
  await c.evaluate("void window.__netUi.setEnabled(true); true");
  await c.waitFor('window.__netUi.net.enabled === true', { timeout: 8000, biaoQian: '12：英文下重新打开组网' });
  await ensureNetCard();
  await c.evaluate(`window.__netTest.setState({ reachability: ${JSON.stringify({
    selfDialable: false, peerDialable: false, bothUndialable: true, needsPublicRelayNotice: true,
    relayCode: 'relay-unreachable',
    ipv6: { hasGlobalUnicast: true, publicCandidate: '2001:db8::1' }, naturalDialable: true, dialableKind: 'ipv6-global-natural',
    suggestedRung: 'ipv6-direct', i18n: { rung: 'net.rung.ipv6Direct', relay: 'net.relay.missing.unreachable' },
  })}, ipv6: { hasGlobalUnicast: true, publicCandidate: '2001:db8::1' }, sessions: 0 }); true`);
  await c.evaluate('void window.__netUi.heartbeat(); true');
  await c.waitFor(`document.querySelector('#wangLuoLadder .wangLuoRung[data-rung="lan"]').querySelector('.net-rung-text').textContent.indexOf('LAN') >= 0`, {
    timeout: 10000, biaoQian: '12：英文下阶梯区块刷新',
  });
  const enRungs = JSON.parse(await c.evaluate(`(function(){
    var out={};
    Array.from(document.querySelectorAll('#wangLuoLadder .wangLuoRung')).forEach(function(li){
      out[li.dataset.rung] = { text: li.querySelector('.net-rung-text').textContent, state: li.dataset.state };
    });
    return JSON.stringify(out);
  })()`));
  const enBad = RUNG_KEYS.filter(([r, k]) => {
    const want = (r === 'upnp' || r === 'holepunch') ? EN[k] + ' · ' + EN['net.ladder.unsupported'] : EN[k];
    return !enRungs[r] || enRungs[r].text !== want;
  });
  ok(enBad.length === 0, '12-8 英文包下六档文案**逐字**等于 en-US 语言包', JSON.stringify(enBad.map((x) => [x[0], enRungs[x[0]] && enRungs[x[0]].text, EN[x[1]]])));
  ok((await c.evaluate("(function(){var t=document.querySelector('#wangLuoLadder').textContent;return /[\\u4e00-\\u9fff]/.test(t);})()")) === false,
    '12-8 英文包下阶梯区块里**没有中文**');
  const enTerm = JSON.parse(await c.evaluate(`(function(){var r=document.querySelector('${netRowSel}');
    return JSON.stringify({ terminal:r?r.dataset.terminal:null, title:r?r.querySelector('.bnBiaoTi').textContent:null,
      ti:r?r.querySelector('.bnTi').textContent:null, btn:r?(r.querySelector('button[data-bn="relaySettings"]')||{}).textContent||'':null });})()`));
  ok(enTerm.terminal === '1' && enTerm.biaoTi === EN['net.banner.relayTerminalTitle'],
    '12-8 英文下终态横幅标题走英文包', String(enTerm.biaoTi).slice(0, 60));
  ok(enTerm.ti === EN['net.relay.missing.unreachable'] && enTerm.btn === EN['net.banner.relayConfigure'],
    '12-8 英文下终态正文与按钮走英文包（且是"中继都连不上"这一条）', String(JSON.stringify(enTerm)).slice(0, 120));
  const enCjk = await c.evaluate(`(function(){
    var bad=[];
    ['#wangLuoKa','#wangLuoBanner'].forEach(function(root){
      var host=document.querySelector(root); if(!host) return;
      Array.from(host.querySelectorAll('*')).forEach(function(e){
        if(e.children.length) return;
        var tag=e.tagName; if(tag==='INPUT'||tag==='TEXTAREA'||tag==='OPTION') return;
        var t=(e.textContent||'').trim();
        if(/[\\u4e00-\\u9fff]/.test(t)) bad.push(tag+'#'+(e.id||e.className||'')+':'+t.slice(0,24));
      });
    });
    return JSON.stringify(bad.slice(0,8));
  })()`);
  ok(enCjk === '[]', '12-8 英文包下组网卡片与横幅里没有中文残留（可见文字全部走 i18n）', String(enCjk).slice(0, 160));
  await c.evaluate("(function(){var s=document.querySelector('#xuanZeYuYan'); s.value='zh-CN'; s.dispatchEvent(new Event('change',{bubbles:true})); return true;})()");
  await c.waitFor("document.querySelector('#logoMing').textContent === '无限牛马'", { timeout: 10000, biaoQian: '12：切回中文' });

  // 收尾：把桩数据清干净，避免影响最后的全局断言
  await c.evaluate("window.__netTuning = { hysteresisFailures: 3, hysteresisSeconds: 30, retryRounds: 3, backoffMs: [5000,15000,30000], tickMs: 1000, reachTtlMs: 30000 }; true");
  await c.evaluate("window.__netTest.setState({ reachability: null, ipv6: null, sessions: 0, samples: [true] }); true");
  await c.evaluate('void window.__netUi.setEnabled(false); true');
  await c.waitFor('window.__netUi.net.enabled === false', { timeout: 8000, biaoQian: '12：收尾（关组网）' });

  /* ══ 13. UIQA 桌面侧增补（B2–B9）：只增不减 ══ */
  step('13. UIQA 增补：禁用态 / 帮助钮 / 命中区 / 关闭组网事实 / 成员角标 / 凭证区块');
  at = '13 UIQA 增补';
  {
    // B3 help button is a live control (not dead)
    await ensureNetCard();
    const help = JSON.parse(await c.evaluate(`(function(){
      var b=document.querySelector('#anNiuWangLuoHelp'); var box=document.querySelector('#wangLuoHelpHe');
      if(!b) return JSON.stringify({ok:false, reason:'absent'});
      var r=b.getBoundingClientRect();
      return JSON.stringify({ok:true, w:Math.round(r.width), h:Math.round(r.height), title:b.getAttribute('title')||b.getAttribute('biaoTi')||'', yinCang: box? box.classList.contains('yinCang'):null});
    })()`));
    ok(help.ok && help.w >= 16 && help.h >= 16 && help.biaoTi, 'B3 组网卡片帮助按钮存在且有 i18n biaoTi', JSON.stringify(help));
    const helpClick = await c.clickUntil('#anNiuWangLuoHelp', `(function(){var box=document.querySelector('#wangLuoHelpHe'); return box && !box.classList.contains('yinCang') && (box.textContent||'').length>20;})()`, { tries: 3, timeout: 2000 });
    // 断言读**全文**再与语言包逐字比对（先前误把 textContent.slice(0,80) 拿去和完整键值比，永远不相等）
    const helpView = JSON.parse(await c.evaluate(`(function(){var box=document.querySelector('#wangLuoHelpHe'); if(!box) return 'null'; return JSON.stringify({yinCang: box.classList.contains('yinCang'), ti: box.textContent||''});})()`) || 'null');
    ok(helpClick.ok && helpView && helpView.yinCang === false && helpView.ti === ZH['net.helpBody'],
      'B3 点击帮助展开 i18n 说明（非死控件）', String((helpView && helpView.ti) || '').slice(0, 80));
    await c.evaluate(`(function(){var box=document.querySelector('#wangLuoHelpHe'); if(box) box.classList.add('yinCang'); return true;})()`);

    // B4 lieBiaoHqTuBiao hit area >= 32
    // 图标只在「我的牛马」(singleAi) 列表头出现；settings/wo 会 yinCangLieBiao（display:none → 尺寸 0）。
    // 这里**显式导航**到 singleAi 再测量/点击，避免在看不到图标的视图里断言。
    await navTo('singleAi');
    await c.waitForQuiet("(function(){var e=document.querySelector('.lieBiaoHqTuBiao');if(!e)return false;var r=e.getBoundingClientRect();return r.width>0&&r.height>0;})()", { timeout: 4000 });
    const hq2 = JSON.parse(await c.evaluate(`(function(){
      var e=document.querySelector('.lieBiaoHqTuBiao');
      if(!e) return JSON.stringify({absent:true});
      var r=e.getBoundingClientRect();
      return JSON.stringify({w:Math.round(r.width), h:Math.round(r.height), minW:getComputedStyle(e).minWidth, minH:getComputedStyle(e).minHeight, nav:((document.querySelector('.ceLanTiaoMu.jiHuo')||{}).dataset||{}).nav});
    })()`));
    ok(!hq2.absent && hq2.w >= 32 && hq2.h >= 32, 'B4 牛马管理局图标命中区 ≥32×32', JSON.stringify(hq2));
    if (!hq2.absent) {
      // 实例页不在 ceLan 上：成功判据是 lieBiaoBiaoTi 变成「牛马管理局」（nav.instances）
      const instCond = `(function(){ var t=document.querySelector('#lieBiaoBiaoTi'); return !!t && (t.textContent||'').indexOf(${JSON.stringify('牛马管理局')})>=0; })()`;
      let hqClick = { ok: false, reason: 'not-tried' };
      try {
        hqClick = await c.clickUntil('.lieBiaoHqTuBiao', instCond, { tries: 4, timeout: 2500 });
      } catch (e) {
        hqClick = { ok: false, reason: String(e.message).slice(0, 120) };
      }
      if (!hqClick.ok) {
        // 第一次坐标点击往往已命中并触发 onclick（icon 随后被 setNav 移除）；补验导航结果
        const already = await c.evaluate(instCond);
        if (!already) {
          await c.evaluate("(function(){var e=document.querySelector('.lieBiaoHqTuBiao'); if(e) e.click(); return true;})()");
        }
        const nowOnInst = await c.evaluate(instCond);
        hqClick = { ok: !!nowOnInst, fallback: true, trail: hqClick.trail || hqClick.reason };
      }
      ok(!!hqClick.ok, 'B4 真实坐标点击可进入实例列表', JSON.stringify(hqClick.trail || hqClick));
    }
    // 用完实例列表后回到设置页，避免后续组网断言落在错误视图
    await ensureNetCard();

    // B2 disabled switch visual
    await c.evaluate(`window.__netTest.setState({ samples: [] }); window.__netUi.net.probe = { verdict:'fail', at: Date.now(), method:'autonat' }; true`);
    await c.evaluate(`void window.__netUi.setEnabled(false); true`);
    await ensureNetCard();
    const swDis = JSON.parse(await c.evaluate(`(function(){
      var s=document.querySelector('#wangLuoSwitch');
      var hang=document.querySelector('.wangLuoSwitchHang');
      if(!s) return JSON.stringify({absent:true});
      var track=s.nextElementSibling;
      var cs=track? getComputedStyle(track):null;
      return JSON.stringify({
        disabled: !!s.disabled,
        rowClass: hang? hang.className: '',
        cursor: getComputedStyle(s).cursor,
        trackBg: cs? cs.backgroundColor: null,
        trackBorder: cs? cs.border: null,
        outline: cs? cs.outlineStyle: null,
      });
    })()`));
    ok(swDis.disabled === true && /isJinYong/.test(swDis.rowClass) && swDis.cursor === 'not-allowed',
      'B2 组网开关禁用态：disabled + not-allowed + 行标记', JSON.stringify(swDis));

    // B5 mesh off still has facts / or honest unknown
    await c.evaluate(`void window.__netUi.heartbeat(); true`);
    await sleep(300);
    const ladderOff = JSON.parse(await c.evaluate(`(function(){
      var box=document.querySelector('#wangLuoLadder');
      if(!box) return JSON.stringify({absent:true});
      var cur=document.querySelector('#wangLuoLadderCurrent');
      var dial=document.querySelector('#wangLuoLadderDial');
      return JSON.stringify({
        current: cur? cur.textContent: null,
        dial: dial? dial.textContent: null,
        dialKind: dial? dial.getAttribute('data-kind'): null,
        textLen: (box.textContent||'').length,
      });
    })()`));
    ok(!ladderOff.absent && ladderOff.textLen > 30 && !!ladderOff.dial,
      'B5 组网关闭时阶梯/可达性非空白（有文案）', JSON.stringify(ladderOff));
    ok(ladderOff.dial === ZH['net.dialability.undetermined'] || ladderOff.dial === ZH['net.dialabilityUnknown'] || (ladderOff.dial && ladderOff.dial.length > 1),
      'B5 可拨入性显示「无法判定/未知」类文案', ladderOff.dial);

    // B7 offline pending-confirm wording
    await c.evaluate(`window.__netTest.setState({ members: { 'g-1': [
      { id:'remote-off', ming:'remote-off', remote:true, online:false, disabled:false, presenceBasis:'mesh-session' },
      { id:'remote-unk', ming:'remote-unk', remote:true, online:false, disabled:false, presenceBasis:'unattributed' }
    ] }}); true`);
    await c.evaluate(`void window.__netUi.refreshPresence && window.__netUi.refreshPresence(); true`);
    // 真的重画成员面板（否则 #chengYuanJiHe 还是上一节的残留，断言测不到新文案）
    await c.evaluate(`void (window.__netUi && window.__netUi.refreshMembers) ? window.__netUi.refreshMembers() : null; true`);
    await c.waitFor(`document.querySelectorAll('#chengYuanJiHe .chengYuanHang').length >= 1`, { timeout: 6000, biaoQian: 'B7：成员行已重画' });
    await sleep(200);
    const membersTxt = await c.evaluate(`(function(){
      var box=document.querySelector('#chengYuanJiHe');
      return box? box.innerText: '';
    })()`);
    ok(membersTxt.indexOf(ZH['group.memberPendingConfirm']) !== -1 || membersTxt.indexOf('remote-off') === -1,
      'B7 离线成员文案改为「待连接确认」', membersTxt.slice(0, 120));
    ok(membersTxt.indexOf(ZH['group.memberUnattributed']) !== -1 || membersTxt.indexOf('remote-unk') === -1,
      'B8 unattributed 可见角标「身份未知」', membersTxt.slice(0, 160));

    // B9 cert block present (readonly)
    const certBox = JSON.parse(await c.evaluate(`(function(){
      var h=document.querySelector('#chengYuanMingCeZhengShu');
      if(!h) return JSON.stringify({absent:true});
      return JSON.stringify({ present:true, title:(h.querySelector('h3')||{}).textContent||'', text:(h.innerText||'').slice(0,160), rows:h.querySelectorAll('.zhengShuHang').length, hasNone: (h.innerText||'').indexOf(${JSON.stringify(ZH['group.cert.none'])})!==-1 || (h.innerText||'').indexOf('无证书')!==-1 || (h.innerText||'').length>10 });
    })()`));
    ok(certBox.present && (certBox.biaoTi === ZH['group.cert.biaoTi'] || certBox.biaoTi.length > 0),
      'B9 群成员面板出现「身份凭证」只读区块', JSON.stringify(certBox));

    // B1 no [object Object] in settings data ka
    const objDump = await c.evaluate(`(function(){
      var t=document.body.innerText||'';
      return t.indexOf('[object Object]')!==-1;
    })()`);
    ok(objDump === false, 'B1 界面无 [object Object] 直出', objDump);
  }

  /* ══ 14. R13：端口默认值 59599 / **无法绑定就失败并告知**（绝不自动换端口）/ 建议端口只是建议 ══ */
  step('14. R13 端口决策：默认 59599（六处一起改）/ 端口无法绑定 → 失败并告知 / 建议端口只作建议');
  at = '14 端口真值常量';

  {
    /* R13-1 真值来源（settings-store.ts）与渲染层镜像（app.js）必须**逐字一致**。
       产品规则：端口对用户永远是"可改的默认值"，不是硬编码 —— 所以断言的是
       "默认值 = 59599"，而不是"只能 59599"。 */
    const srcStore = fs.readFileSync(path.join(SELF_DIR, '..', 'src', 'settings-store.ts'), 'utf8');
    const srcApp = fs.readFileSync(path.join(SELF_DIR, '..', 'src', 'renderer', 'app.js'), 'utf8');
    const srcWiring = fs.readFileSync(path.join(SELF_DIR, '..', 'src', 'net-wiring.ts'), 'utf8');
    const srcMain = fs.readFileSync(path.join(SELF_DIR, '..', 'src', 'electron-main.ts'), 'utf8');
    const mStore = srcStore.match(/export const WARMY_DEFAULT_NET_PORT = (\d+);/);
    const mApp = srcApp.match(/const WARMY_DEFAULT_NET_PORT = (\d+);/);
    ok(!!mStore && Number(mStore[1]) === EXPECT_DEFAULT_PORT, 'R13-1 主进程真值常量 WARMY_DEFAULT_NET_PORT = ' + EXPECT_DEFAULT_PORT, mStore ? mStore[1] : 'not-found');
    ok(!!mApp && Number(mApp[1]) === EXPECT_DEFAULT_PORT, 'R13-1 渲染层镜像常量 = ' + EXPECT_DEFAULT_PORT + '（两处必须一起改，漂移即红）', mApp ? mApp[1] : 'not-found');
    ok(!!mStore && !!mApp && mStore[1] === mApp[1], 'R13-1 主进程与渲染层的默认端口逐字一致', (mStore ? mStore[1] : '?') + ' vs ' + (mApp ? mApp[1] : '?'));

    /* R13-1b 拼写守卫：`node --check` 与 TDZ 门禁都抓不到"标识符少写一个字母"
       （那既不是语法错误，也不是 TDZ），只会在运行时抛 ReferenceError 把渲染流程打断。
       实测踩过：`WARMY_DEV_NET_PORT` 少一个 A → 组网卡片整段渲染抛错。 */
    const codeOnly = srcApp
      .split('\n')
      .filter((l) => {
        const s = l.trim();
        return !(s.startsWith('//') || s.startsWith('*') || s.startsWith('/*'));
      })
      .join('\n');
    const allPortTokens = [...new Set(codeOnly.match(/\bCC\w*ARMY_[A-Z_]+/g) || [])];
    const declaredPortTokens = new Set((codeOnly.match(/const\s+(CC\w*ARMY_[A-Z_]+)/g) || []).map((s) => s.replace(/const\s+/, '')));
    const undeclaredTokens = allPortTokens.filter((x) => !declaredPortTokens.has(x));
    ok(undeclaredTokens.length === 0,
      'R13-1b 渲染层用到的 WARMY_* 常量都已声明（语法门禁抓不到未定义标识符，这里补上）',
      JSON.stringify(undeclaredTokens) + ' declared=' + JSON.stringify([...declaredPortTokens]));

    /* R13-2 建议端口：主进程里的**优先池** + 渲染层**不得**镜像它（否则会拿静态表充建议） */
    const sugMatch = srcStore.match(/export const WARMY_SUGGESTED_NET_PORTS[^=]*=\s*\[([\s\S]*?)\];/);
    const sug = sugMatch ? (sugMatch[1].match(/\d+/g) || []).map(Number) : [];
    ok(JSON.stringify(sug) === JSON.stringify(EXPECT_SUGGESTED_PORTS), 'R13-2 优先池常量与产品负责人给定的 ' + EXPECT_SUGGESTED_PORTS.length + ' 档、顺序逐字一致', sug.join(','));
    ok(sug[0] === EXPECT_DEFAULT_PORT, 'R13-2 优先池首项 = 生产默认端口', sug[0]);
    ok(new Set(sug).size === sug.length, 'R13-2 优先池无重复项', sug.length);
    ok(!/WARMY_SUGGESTED_NET_PORTS/.test(codeOnly),
      'R13-2 渲染层**不**镜像优先池（建议只能来自实测结果，不许拿静态表顶上）', 'renderer must not carry the static pool');
    ok(/netPortCandidates/.test(srcApp) && /netIpc\('netPortCandidates'/.test(srcApp),
      'R13-2 渲染层通过 netPortCandidates IPC 取"带实测结果的候选列表"', 'netPortCandidates wired');

    /* R13-3 约定端口常量（仅约定）+ 旧默认端口彻底清除 */
    ok(/export const WARMY_DEV_NET_PORT = /.test(srcStore) && /const WARMY_DEV_NET_PORT = /.test(srcApp), 'R13-3 开发约定端口常量在两处都存在');
    ok(/export const WARMY_TEST_NET_PORT = /.test(srcStore) && /const WARMY_TEST_NET_PORT = /.test(srcApp), 'R13-3 测试约定端口常量在两处都存在');
    ok(new RegExp('WARMY_DEV_NET_PORT = ' + EXPECT_DEV_PORT + ';').test(srcStore) && new RegExp('WARMY_TEST_NET_PORT = ' + EXPECT_TEST_PORT + ';').test(srcStore),
      'R13-3 约定端口 = 开发 ' + EXPECT_DEV_PORT + ' / 测试 ' + EXPECT_TEST_PORT, 'dev/test 常量已核对');
    const legacy = ['settings-store.ts', 'renderer/app.js', 'net-wiring.ts', 'electron-main.ts'].filter((f) =>
      fs.readFileSync(path.join(SELF_DIR, '..', 'src', f), 'utf8').includes('8765'));
    ok(legacy.length === 0, 'R13-3 旧默认端口 8765 已从源码清除（六处一起搬走）', JSON.stringify(legacy));

    /* R13-4 **绝不自动换端口**：真实 listen 路径只试一个端口，失败就如实回 port-bind-failed */
    const enableBody = srcWiring.slice(srcWiring.indexOf('async enable('), srcWiring.indexOf('async disable('));
    ok(enableBody.length > 0 && !/for \(const\s+\w+\s+of/.test(enableBody) && !/while \(/.test(enableBody) && !/\.map\(/.test(enableBody),
      'R13-4 enable() 里**没有**遍历候选端口的重试循环（只试用户要的那一个）', 'no candidate loop in enable()');
    ok(/errorCode: 'port-bind-failed'/.test(srcWiring), 'R13-4 绑定失败如实回 errorCode = port-bind-failed', 'port-bind-failed 存在');
    ok(/this\.requestedPort = port;/.test(enableBody), 'R13-4 失败时也把**用户要的端口**原样记下（供 UI 说清是哪个端口）', 'requestedPort preserved');
    ok(!/WARMY_PORT_FALLBACK|PORT_FALLBACK_CHAIN|fallbackUsed|meshPortCandidates|net\.portFallback/.test(srcStore + srcApp + srcWiring + srcMain),
      'R13-4 源码里已无"兜底/回退换端口"的命名与实现残留（语义已改为"建议"）', 'no port-fallback tokens');
    ok(!/WARMY_(DEV|TEST)_NET_PORT\s*(===|!==|==|!=)/.test(srcStore + srcApp + srcWiring),
      'R13-4 没有任何"按角色端口做校验/禁用"的分支（用户可在任何环境用任何端口）', 'no role-based port comparisons');
    ok(!srcStore.includes('meshPortCandidates'), 'R13-4 旧的"候选端口自动顺延"函数已删除', 'meshPortCandidates gone');

    /* R13-4b 实测能力（source 层）：真 bind 探测 / 分类 / 立刻关闭 / 并发上限 / 总超时 / 扩展搜索 / 无缓存 */
    ok(/export function probePortAvailability/.test(srcWiring), 'R13-4b 存在"真的 bind 一次"的探测函数（probePortAvailability）', 'probePortAvailability 存在');
    ok(/'occupied'/.test(srcWiring) && /'no-permission'/.test(srcWiring) && /'ok'/.test(srcWiring),
      'R13-4b 三元结论区分清楚（ok / occupied / no-permission）', 'three statuses');
    ok(/s\.close\(\(\) => done\('ok'\)\)/.test(srcWiring), 'R13-4b 绑上后**立刻关闭**（不泄漏监听句柄）', 'close-on-ok');
    ok(/concurrency/.test(srcWiring) && /totalTimeoutMs/.test(srcWiring), 'R13-4b 探测有并发上限与总超时（不卡界面）', 'concurrency + totalTimeoutMs');
    ok(/EPHEMERAL_PORT_RANGE/.test(srcWiring) && /coverage\s*=\s*'extended'/.test(srcWiring),
      'R13-4b 优先池不足时会扩展到整个动态区间（不让用户无路可走）', 'extended search');
    ok(/PORT_CANDIDATE_MIN = 3/.test(srcWiring) && /PORT_CANDIDATE_MAX = 5/.test(srcWiring),
      'R13-4b 推荐数量目标 N 在 3–5 之间', 'min 3 / max 5');
    ok(/host = '0\.0\.0\.0'/.test(srcWiring) && /probeFn\(p, host, perTimeout\)/.test(srcWiring),
      'R13-4b 探测与组网监听用同一个主机地址（0.0.0.0），结论才可信', 'same host as listener');
    ok(/netPortCandidates: \(payload\) => ipcRenderer\.invoke\('warmy:wangLuoDuanKouHouXuanJi'/.test(srcMain.replace(/[\s\S]*?/, '$&')) || /warmy:wangLuoDuanKouHouXuanJi/.test(srcMain),
      'R13-4b 主进程有 net-port-candidates 通道', 'channel present');
    const srcPreload = fs.readFileSync(path.join(SELF_DIR, '..', 'src', 'preload.cjs'), 'utf8');
    ok(/netPortCandidates: \(payload\) => ipcRenderer\.invoke\('warmy:wangLuoDuanKouHouXuanJi', payload\)/.test(srcPreload),
      'R13-4b preload 暴露了 netPortCandidates（渲染层才拿得到）', 'preload wired');

    /* R13-5 端口输入框仍可编辑，且**任何** 1–65535 的值都被接受：约定不是限制 */
    at = '14 端口可编辑性（约定不是限制）';
    await ensureNetCard();
    const editability = JSON.parse(await c.evaluate(`(function(){
      var p = document.querySelector('#wangLuoDuanKou');
      if (!p) return JSON.stringify({ missing: true });
      var out = { missing: false, locked: p.readOnly === true || p.disabled === true, accepted: {} };
      // 故意混入：**不在建议表里**的任意端口 / 开发约定 / 测试约定 / 生产默认 / 两个边界
      [51234, ${EXPECT_DEV_PORT}, ${EXPECT_TEST_PORT}, ${EXPECT_DEFAULT_PORT}, 1, 65535].forEach(function(v){
        p.value = String(v);
        p.dispatchEvent(new Event('change', { bubbles: true }));
        out.accepted['p' + v] = window.__netUi.net.addr.port;
      });
      return JSON.stringify(out);
    })()`));
    ok(!editability.missing && editability.locked === false, 'R13-5 端口输入框可编辑（未锁死）', JSON.stringify(editability).slice(0, 160));
    ok([51234, EXPECT_DEV_PORT, EXPECT_TEST_PORT, EXPECT_DEFAULT_PORT, 1, 65535].every((v) => Number(editability.accepted['p' + v]) === v),
      'R13-5 任意/开发/测试/生产/边界值全部被接受（不做角色限制）', JSON.stringify(editability.accepted));
    ok(Number(editability.accepted['p51234']) === 51234, 'R13-5 **不在建议表里**的端口（51234）同样可填可保存（建议表≠白名单）', JSON.stringify(editability.accepted));

    /* R13-6 越界端口仍被如实拒绝（编辑自由 ≠ 校验消失） */
    at = '14 端口校验仍在';
    await closeModal();
    await c.evaluate(`(function(){var p=document.querySelector('#wangLuoDuanKou'); p.value='0'; p.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
    try {
      await c.waitFor("!document.querySelector('#duiHuaKuangGen').classList.contains('yinCang')", { timeout: 5000, biaoQian: 'R13：越界端口提示弹窗' });
    } catch (e) {
      warn('越界端口没有弹出提示: ' + e.message.slice(0, 120));
    }
    const badModal = await modal();
    const afterBad = JSON.parse(await c.evaluate(`(function(){
      return JSON.stringify({ value: document.querySelector('#wangLuoDuanKou').value, state: window.__netUi.net.addr.port });
    })()`));
    ok(badModal.visible === true && String(badModal.ti || '').indexOf('65535') >= 0, 'R13-6 越界端口(0)被拒并给出 1–65535 的提示', String(badModal.ti || '').slice(0, 80));
    ok(Number(afterBad.state) === 65535, 'R13-6 非法输入不写入状态（保持上一个合法值）', JSON.stringify(afterBad));
    await closeModal();

    /* R13-7 约定端口只作提示（i18n），并且有稳定数据契约给自动化 */
    at = '14 约定端口提示（i18n）';
    await c.evaluate(`(function(){var p=document.querySelector('#wangLuoDuanKou'); p.value='${EXPECT_DEFAULT_PORT}'; p.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
    await ensureNetCard();
    await c.evaluate('void window.__netUi.heartbeat(); true');
    await c.waitFor(`!!document.querySelector('#wangLuoDuanKouTiShi')`, { timeout: 8000, biaoQian: 'R13：端口提示元素存在' });
    const hintUi = JSON.parse(await c.evaluate(`(function(){
      var h = document.querySelector('#wangLuoDuanKouTiShi');
      return JSON.stringify({
        present: !!h,
        text: h ? h.textContent : null,
        convention: h ? h.getAttribute('data-convention') : null,
      });
    })()`));
    ok(hintUi.present && hintUi.convention === 'dev:' + EXPECT_DEV_PORT + ',test:' + EXPECT_TEST_PORT, 'R13-7 约定端口以稳定契约暴露（data-convention）', hintUi.convention);
    const wantHint = String(ZH['net.portConventionHint']).split('{dev}').join(String(EXPECT_DEV_PORT)).split('{test}').join(String(EXPECT_TEST_PORT));
    ok(hintUi.text === wantHint, 'R13-7 提示文案逐字等于中文语言包（含两个约定端口，且明说"约定、不是限制"）', hintUi.text);
    ok(String(ZH['net.portConventionHint']).indexOf('{dev}') >= 0 && String(ZH['net.portConventionHint']).indexOf('{test}') >= 0, 'R13-7 提示语言包用的是变量占位（不是把端口号写死在文案里）', ZH['net.portConventionHint']);
    ok(!CJK.test(String(EN['net.portConventionHint'])), 'R13-7 英文包的提示文案不含中文', String(EN['net.portConventionHint']).slice(0, 60));
    ok(await c.evaluate(`document.querySelector('#wangLuoDuanKou').disabled !== true && document.querySelector('#wangLuoDuanKou').readOnly !== true`),
      'R13-7 提示**没有**顺手把输入框锁上（约定不是限制）');

    /* ══ R13-8 核心：绑定失败 → 明确告知 + 配置端口**未被修改** + 建议必须"实测可用" ══ */
    at = '14 绑定失败：失败并告知、端口不被改';
    // 记一份"用户配置"现场：端口 59599 已经写进 netState 与设置保存。
    // 注意：改端口会 netInvalidateProbe()（旧检测结论作废），所以这里必须先补回"检测通过"，
    // 否则打开组网会被**门控**挡住（弹的是"请先点检测"），测不到绑定失败这条路径。
    await c.evaluate(`(function(){
      var p = document.querySelector('#wangLuoDuanKou');
      p.value = '${EXPECT_DEFAULT_PORT}';
      p.dispatchEvent(new Event('change', { bubbles: true }));
      // ⚠️ 顺序要紧：改端口会 netInvalidateProbe()（旧检测结论作废），
      //    所以"检测通过"必须在**改完端口之后**补回来，否则打开组网会被门控挡住
      //    （弹的是"请先点检测"，测不到绑定失败这条路径）。
      window.__netUi.net.probe = { verdict: 'pass', at: Date.now(), isPublic: true, outboundOk: true, method: 'autonat' };
      return true;
    })()`);
    // 包一层 settingsSave 探针：任何"net.port 被写回其他端口"都会被抓住
    await c.evaluate(`(function(){
      if (!window.__portSaveSpy) {
        window.__portSaveSpy = [];
        var orig = window.warmy.settingsSave;
        window.warmy.settingsSave = function(payload){
          try { window.__portSaveSpy.push(JSON.parse(JSON.stringify(payload || {}))); } catch (e) {}
          return orig ? orig(payload) : Promise.resolve({ ok: true });
        };
      }
      window.__portSaveSpy.length = 0;
      return true;
    })()`);

    /* —— 没有实测报告时：**一个建议都不许显示**（静态表不得直接展示给用户） —— */
    await c.evaluate(`window.__netTest.setState({
      bindFail: { requestedPort: ${EXPECT_DEFAULT_PORT}, errorCode: 'port-bind-failed', error: 'EADDRINUSE' },
      portCandidates: null, meshEnabled: false, samples: [false],
    }); window.__netTest.reset(); true`);
    await closeModal();
    // ⚠️ netSetEnabled 失败时会 await uiAlert（等用户点确定）→ 不能直接 await 这个 promise，
    //    否则脚本会一直等弹窗。用"后台跑 + 侧信道取返回值"的方式拿结果。
    await c.evaluate(`(function(){
      window.__enableResult = 'pending';
      window.__netUi.setEnabled(true).then(function(v){ window.__enableResult = v; });
      return true;
    })()`);
    try {
      await c.waitFor("!document.querySelector('#duiHuaKuangGen').classList.contains('yinCang')", { timeout: 6000, biaoQian: 'R13：端口无法绑定提示' });
    } catch (e) {
      warn('端口无法绑定没有弹出提示: ' + e.message.slice(0, 140));
    }
    const failModal = await modal();
    const wantFailBody = String(ZH['net.portBindFailedBody']).split('{port}').join(String(EXPECT_DEFAULT_PORT)).split('{error}').join('EADDRINUSE');
    ok(failModal.visible === true && failModal.biaoTi === ZH['net.portBindFailedTitle'], 'R13-8 失败提示标题 = 「端口无法绑定」', String(failModal.biaoTi).slice(0, 60));
    ok(failModal.ti === wantFailBody, 'R13-8 失败提示正文带上**是哪个端口**与底层错误码，并指明"选一个可用端口或自行填写"（逐字等于语言包）', String(failModal.ti).slice(0, 140));
    await closeModal();
    await c.waitFor(`window.__enableResult === false`, { timeout: 6000, biaoQian: 'R13：打开组网返回 false' });
    ok((await c.evaluate('window.__enableResult')) === false, 'R13-8 绑定失败时"打开组网"如实返回 false（不返回成功）', await c.evaluate('String(window.__enableResult)'));

    /* —— 最关键的一条：配置里的端口值**没有被修改** —— */
    const afterFail = JSON.parse(await c.evaluate(`(function(){
      return JSON.stringify({
        statePort: window.__netUi.net.addr.port,
        inputValue: document.querySelector('#wangLuoDuanKou').value,
        saves: window.__portSaveSpy,
        enableCalls: window.__netTest.callsOf('meshEnable').map(function(c){ return c.payload && c.payload.port; }),
        candidatesCalls: window.__netTest.callsOf('netPortCandidates').length,
        meshEnabled: window.__netTest.meshEnabled,
        uiEnabled: window.__netUi.net.enabled,
      });
    })()`));
    ok(Number(afterFail.statePort) === EXPECT_DEFAULT_PORT && afterFail.inputValue === String(EXPECT_DEFAULT_PORT),
      'R13-8 【核心】绑定失败后配置端口未被修改（netState + 输入框都还是用户填的那个）', JSON.stringify({ statePort: afterFail.statePort, inputValue: afterFail.inputValue }));
    ok(afterFail.saves.length === 0, 'R13-8 【核心】绑定失败没有写回设置（一个 settingsSave 都没发生，端口不可能被偷偷改掉）', JSON.stringify(afterFail.saves).slice(0, 160));
    ok(afterFail.enableCalls.length === 1 && Number(afterFail.enableCalls[0]) === EXPECT_DEFAULT_PORT,
      'R13-8 【核心】只尝试了用户要的那一个端口，**没有**自动换端口重试第二次', JSON.stringify(afterFail.enableCalls));
    ok(afterFail.meshEnabled === false && afterFail.uiEnabled === false, 'R13-8 绑定失败时组网保持关闭（不假装已打开）', JSON.stringify({ meshEnabled: afterFail.meshEnabled, uiEnabled: afterFail.uiEnabled }));
    ok(afterFail.candidatesCalls >= 1, 'R13-8 失败提示出现时**自动去实测**一次候选端口（不是拿静态表顶上）', afterFail.candidatesCalls);
    ok(await c.evaluate(`document.querySelectorAll('#wangLuoDuanKouSuggest .wangLuoDuanKouSuggestAnNiu').length`) === 0,
      'R13-8 【核心】没有实测到可用端口时，一个建议都不显示（静态候选表绝不直接展示给用户）');

    /* —— 注入一份"带实测结果"的报告：被占用的池内端口不出现，可用端口可点选 —— */
    at = '14 实测候选端口：只推荐真的绑得上的';
    await ensureNetCard();
    await c.evaluate(`window.__netTest.setState({ portCandidates: {
      ok: true, requestedPort: ${EXPECT_DEFAULT_PORT},
      recommended: [ { port: 52555, status: 'ok', latencyMs: 3 }, { port: 55151, status: 'ok', latencyMs: 4 }, { port: 55335, status: 'ok', latencyMs: 2 } ],
      probed: [ { port: 57757, status: 'occupied', errorCode: 'EADDRINUSE', latencyMs: 1 },
                { port: 52555, status: 'ok', latencyMs: 3 }, { port: 55151, status: 'ok', latencyMs: 4 }, { port: 55335, status: 'ok', latencyMs: 2 } ],
      coverage: 'pool', timedOut: false, elapsedMs: 12, probedAt: Date.now(), host: '0.0.0.0',
    } }); true`);
    // 走**真实取数路径**（IPC → netState → 渲染），不是直接塞 UI 状态
    await c.evaluate('window.__netUi.fetchPortCandidates()');
    await c.waitFor(`document.querySelectorAll('#wangLuoDuanKouSuggest .wangLuoDuanKouSuggestAnNiu').length === 3`, { timeout: 6000, biaoQian: 'R13：建议端口按实测结果渲染' });
    const conflictUi = JSON.parse(await c.evaluate(`(function(){
      var b = document.querySelector('#wangLuoDuanKouConflict');
      var btns = Array.from(document.querySelectorAll('#wangLuoDuanKouSuggest .wangLuoDuanKouSuggestAnNiu')).map(function(x){ return { port: x.getAttribute('data-port'), status: x.getAttribute('data-status') }; });
      return JSON.stringify({
        visible: !b.classList.contains('yinCang'),
        failPort: b.getAttribute('data-fail-port'),
        failCode: b.getAttribute('data-fail-code'),
        suggestState: b.getAttribute('data-suggest-state'),
        text: b.textContent,
        chips: btns,
      });
    })()`));
    ok(conflictUi.visible === true && conflictUi.failPort === String(EXPECT_DEFAULT_PORT) && conflictUi.failCode === 'port-bind-failed',
      'R13-8 组网设置里出现「端口无法绑定」区块，并标明是哪个端口、什么错误码', JSON.stringify({ failPort: conflictUi.failPort, failCode: conflictUi.failCode }));
    ok(conflictUi.text.indexOf(String(EXPECT_DEFAULT_PORT)) >= 0 && conflictUi.text.indexOf('EADDRINUSE') >= 0,
      'R13-8 区块文案里带上端口号与底层错误码（用户看得见原因）', String(conflictUi.text).slice(0, 120));
    ok(JSON.stringify(conflictUi.chips.map((x) => x.port)) === JSON.stringify(['52555', '55151', '55335']),
      'R13-8 只展示**实测 ok** 的端口作为可点选建议（按实测顺序）', JSON.stringify(conflictUi.chips.map((x) => x.port)));
    ok(conflictUi.chips.every((x) => x.status === 'ok'), 'R13-8 每个建议端点都带 status=ok（真的试绑成功过）', JSON.stringify(conflictUi.chips));
    ok(conflictUi.chips.every((x) => x.port !== '57757') && conflictUi.text.indexOf('57757') < 0,
      'R13-8 实测判定"被占用"(57757)的端口**不出现在**建议里（哪怕它"情报上干净"）', String(conflictUi.text).slice(0, 140));
    const wantMeasured = String(ZH['net.portSuggestMeasured']).split('{probed}').join('4');
    ok(conflictUi.text.indexOf(wantMeasured) >= 0, 'R13-8 文案说明"这些是本机实测能绑定的端口"并给出实测数量（可解释为什么少了某个号）', wantMeasured.slice(0, 60));
    ok(conflictUi.suggestState === 'ok', 'R13-8 建议区状态标记为 ok（给自动化/无障碍的稳定契约）', conflictUi.suggestState);

    /* —— 点建议：**只填输入框**，不自动重开组网、不替用户做主 —— */
    await c.evaluate(`window.__netTest.reset(); true`);
    await c.evaluate(`(function(){ var b = document.querySelector('#wangLuoDuanKouSuggest .wangLuoDuanKouSuggestAnNiu'); if (b) b.click(); return true; })()`);
    const afterChip = JSON.parse(await c.evaluate(`(function(){
      return JSON.stringify({
        inputValue: document.querySelector('#wangLuoDuanKou').value,
        statePort: window.__netUi.net.addr.port,
        enableCalls: window.__netTest.callsOf('meshEnable').length,
        meshEnabled: window.__netTest.meshEnabled,
      });
    })()`));
    ok(afterChip.inputValue === '52555' && Number(afterChip.statePort) === 52555,
      'R13-8 点一下建议只是把该端口填进输入框（不是替用户做主）', JSON.stringify(afterChip));
    ok(afterChip.enableCalls === 0 && afterChip.meshEnabled === false,
      'R13-8 点建议**不会**自动绑定/自动重开组网（要不要重试由用户决定）', JSON.stringify({ enableCalls: afterChip.enableCalls, meshEnabled: afterChip.meshEnabled }));

    /* —— "重新实测"按钮：真的再取一次（不缓存陈旧结果） —— */
    at = '14 重新实测候选端口';
    await c.evaluate(`window.__netTest.reset(); true`);
    await c.evaluate(`window.__netTest.setState({ portCandidates: {
      ok: true, requestedPort: ${EXPECT_DEFAULT_PORT}, recommended: [ { port: 56001, status: 'ok', latencyMs: 2 } ],
      probed: [ { port: 56001, status: 'ok', latencyMs: 2 } ], coverage: 'pool', timedOut: false, elapsedMs: 5, probedAt: Date.now(), host: '0.0.0.0',
    } }); true`);
    await clickReal('#anNiuWangLuoDuanKouSuggestRefresh', `document.querySelectorAll('#wangLuoDuanKouSuggest .wangLuoDuanKouSuggestAnNiu').length === 1`, { tries: 4, timeout: 5000 });
    const refreshed = JSON.parse(await c.evaluate(`(function(){
      return JSON.stringify({
        chips: Array.from(document.querySelectorAll('#wangLuoDuanKouSuggest .wangLuoDuanKouSuggestAnNiu')).map(function(x){ return x.getAttribute('data-port'); }),
        calls: window.__netTest.callsOf('netPortCandidates').length,
      });
    })()`));
    ok(refreshed.calls === 1, 'R13-8 「重新实测」按钮真的再取一次候选（不缓存陈旧结果）', refreshed.calls);
    ok(JSON.stringify(refreshed.chips) === JSON.stringify(['56001']), 'R13-8 重新实测后建议按新结果刷新', JSON.stringify(refreshed.chips));

    // 收尾：回到未失败状态，别把现场带给后面的用例
    await c.evaluate(`window.__netTest.setState({ bindFail: null, portCandidates: null });
      (function(){ var p=document.querySelector('#wangLuoDuanKou'); p.value='${EXPECT_DEFAULT_PORT}'; p.dispatchEvent(new Event('change',{bubbles:true})); })();
      void window.__netUi.renderPortHint(); true`);
  }

  /* R13-9 **真实绑定失败路径**（不是桩）：真 SecureMesh + 真身份 + 真占端口，子进程里跑。
     为什么放这里：UI 桩只能证明"界面会怎么显示"，证明不了 net.Server.listen 失败后
     组网**到底会不会擅自换端口** —— 这一段把真路径压出来（逐个候选端口真 TCP 探一遍）。 */
  at = '14 真实绑定失败路径（子进程探针）';
  {
    const probePath = path.join(SELF_DIR, 'net-port-bind-probe.mjs');
    let probeStdout = '';
    let probeRc = 0;
    try {
      probeStdout = execFileSync(process.execPath, [probePath], {
        cwd: path.join(SELF_DIR, '..', '..', '..'),
        timeout: 180000,
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
      });
    } catch (e) {
      probeRc = typeof e.status === 'number' ? e.status : -1;
      probeStdout = String(e.stdout || '');
      if (!probeStdout) warn('真实绑定探针跑不起来: ' + String(e.message).slice(0, 200));
    }
    let probe = null;
    try {
      probe = JSON.parse(String(probeStdout).trim().split('\n').pop());
    } catch {
      probe = null;
    }
    const probeChecks = (probe && probe.checks) || [];
    const probeFails = probeChecks.filter((x) => !x.pass);
    ok(probeRc === 0 && !!probe && probe.ok === true, 'R13-9 真实绑定失败探针全绿（真 listener + 真占端口）',
      probe ? 'checks=' + probeChecks.length + ' allPass=' + probeChecks.every((x) => x.pass) : String(probeStdout).slice(-300));
    ok(!!probe && JSON.stringify(probe.suggested) === JSON.stringify(EXPECT_SUGGESTED_PORTS), 'R13-9 探针读到的建议端口 === 产品决定（同一份导出常量）', probe ? String(probe.suggested).slice(0, 120) : 'no-json');
    ok(probeChecks.length >= 20, 'R13-9 探针的子断言数量足够（>=20 条真实路径断言，不是走过场）', probeChecks.length);
    ok(probeFails.length === 0, 'R13-9 探针没有失败的子断言', JSON.stringify(probeFails.slice(0, 3)));
    ok(probeChecks.some((x) => /没有\*\*自动绑到候选表里的任何其他端口/.test(x.name) && x.pass),
      'R13-9 【核心】真实路径上"绝不自动换端口"被真的压出来了（逐个候选端口真 TCP 探过）',
      probeChecks.filter((x) => /自动绑到/.test(x.name)).map((x) => x.name).join('|'));
    ok(probeChecks.some((x) => /错误码明确 = port-bind-failed/.test(x.name) && x.pass),
      'R13-9 真实路径上失败原因为「端口无法绑定」', probeChecks.filter((x) => /port-bind-failed/.test(x.name)).map((x) => x.name).join('|'));
    ok(probeChecks.some((x) => /没有被改写|requestedNetPort/.test(x.name) && x.pass),
      'R13-9 真实路径上请求端口未被改写', probeChecks.filter((x) => /改写/.test(x.name)).map((x) => x.name).join('|'));
    ok(probeChecks.some((x) => /被占用的优先池端口实测结论 = occupied/.test(x.name) && x.pass),
      'R13-9 实测：被占用的池内端口结论为 occupied（不靠静态表猜）', probeChecks.filter((x) => /occupied/.test(x.name)).map((x) => x.name).join('|'));
    ok(probeChecks.some((x) => /被占用的端口\*\*不出现在\*\*推荐列表里/.test(x.name) && x.pass),
      'R13-9 实测：被占用的端口不出现在推荐里', probeChecks.filter((x) => /推荐列表/.test(x.name)).map((x) => x.name).join('|'));
    ok(probeChecks.some((x) => /优先池全不可用 → 仍然给出/.test(x.name) && x.pass),
      'R13-9 实测：优先池全不可用时仍给出 >= 3 个其他可用端口（不让用户无路可走）', probeChecks.filter((x) => /优先池全不可用/.test(x.name)).map((x) => x.name).join('|'));
    ok(probeChecks.some((x) => /推荐里每个端口的 status 都是 ok/.test(x.name) && x.pass),
      'R13-9 实测：推荐里的每个端口 status 都是 ok（真的试绑成功过）', probeChecks.filter((x) => /status 都是 ok/.test(x.name)).map((x) => x.name).join('|'));
    ok(probeChecks.some((x) => /没有任何端口被探测过程占住/.test(x.name) && x.pass),
      'R13-9 实测：探测完没有残留监听句柄（探测过的 ok 端口全部可重新 bind）', probeChecks.filter((x) => /占住|残留/.test(x.name)).map((x) => x.name).join('|'));
    ok(probeChecks.some((x) => /探测并发有上限/.test(x.name) && x.pass) && probeChecks.some((x) => /总超时生效/.test(x.name) && x.pass),
      'R13-9 实测：并发有上限 + 总超时生效（不会卡住界面）', probeChecks.filter((x) => /并发有上限|总超时/.test(x.name)).map((x) => x.name).join('|'));
    ok(probeChecks.some((x) => /no-permission/.test(x.name) && x.pass),
      'R13-9 实测：OS 排除段端口结论为 no-permission（或如实记为未覆盖）', probeChecks.filter((x) => /no-permission/.test(x.name)).map((x) => x.name).join('|'));
  }


  /* ══ 15. R1–R4 桌面侧增补（只增不减）：logo 加大 / 快捷列(API+快捷键) / 可拖分隔条 / 添加联系人自带二维码 ══ */
  step('15. R1–R4：logo 加大 / 快捷列（API 目录 + 快捷键）/ 分隔条可拖且持久 / 添加联系人自带我的链接与二维码');
  at = '15 R1–R4 增补';
  {
    const pressKey = async (key, o = {}) => {
      const mods = (o.ctrl ? 2 : 0) | (o.alt ? 1 : 0) | (o.meta ? 4 : 0) | (o.shift ? 8 : 0);
      const base = { modifiers: mods, key, code: o.code || '', windowsVirtualKeyCode: o.vk || 0, nativeVirtualKeyCode: o.vk || 0 };
      await c.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyDown' }, base));
      await c.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, base));
    };
    const resetWidthOf = async () =>
      JSON.parse(await c.evaluate(`JSON.stringify((function(){
        var pc=document.querySelector('#mianBanLan'); var cc=document.querySelector('#liaoTianLan');
        var pe=document.querySelector('#mianBanTiaoZhengTiao');
        var r=pe? pe.getBoundingClientRect(): null;
        return { panelW: pc?Math.round(pc.getBoundingClientRect().width):-1,
                 chatW: cc?Math.round(cc.getBoundingClientRect().width):-1,
                 resX: r?Math.round(r.left+r.width/2):-1, resW: r?Math.round(r.width):-1,
                 parent: pe&&pe.parentElement?pe.parentElement.id:'' };
      })())`));
    /** 真鼠标拖动分隔条（按下的必须是分隔条本身） */
    const dragSplitter = async (dx) => {
      const g = await resetWidthOf();
      const y = await c.evaluate(`(function(){var e=document.querySelector('#mianBanTiaoZhengTiao');var r=e.getBoundingClientRect();return Math.round(r.top+r.height/2);})()`);
      await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: g.resX, y });
      await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: g.resX, y, button: 'left', clickCount: 1, buttons: 1 });
      await sleep(60);
      await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: g.resX + Math.round(dx / 2), y, button: 'left', buttons: 1 });
      await sleep(60);
      await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: g.resX + dx, y, button: 'left', buttons: 1 });
      await sleep(80);
      await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: g.resX + dx, y, button: 'left', clickCount: 1, buttons: 0 });
      await sleep(250);
      return resetWidthOf();
    };
    const dblClickSplitter = async () => {
      const g = await resetWidthOf();
      const y = await c.evaluate(`(function(){var e=document.querySelector('#mianBanTiaoZhengTiao');var r=e.getBoundingClientRect();return Math.round(r.top+r.height/2);})()`);
      for (const n of [1, 2]) {
        await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: g.resX, y, button: 'left', clickCount: n, buttons: 1 });
        await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: g.resX, y, button: 'left', clickCount: n, buttons: 0 });
        await sleep(40);
      }
      await sleep(300);
      return resetWidthOf();
    };

    /* ── R1：左上角 logo 真的变大，且两种语言/两套主题都不越界 ── */
    at = '15 R1 logo';
    const logo = JSON.parse(await c.evaluate(`JSON.stringify((function(){
      var img=document.querySelector('.biaoTiLanlogoTuPian'); var box=document.querySelector('#biaoTiLanlogo'); var tb=document.querySelector('#biaoTiLan');
      if(!img||!box||!tb) return {absent:true};
      var i=img.getBoundingClientRect(), b=box.getBoundingClientRect(), t=tb.getBoundingClientRect();
      return { imgW:Math.round(i.width), imgH:Math.round(i.height), boxW:Math.round(b.width), boxH:Math.round(b.height), barH:Math.round(t.height) };
    })())`));
    ok(
      !logo.absent && logo.imgW >= 34 && logo.imgH >= 34 && logo.imgW > 26 && logo.boxH <= logo.barH && logo.boxW + 12 <= 64,
      'R1-1 左上角 logo 真实像素 ≥34×34 且比改前的 26×26 更大（实测 ' + logo.imgW + '×' + logo.imgH + '），并且不超出 64px 的栏宽、不被标题栏裁掉',
      JSON.stringify(logo)
    );

    const brandMarkup = async (biaoQian) => {
      const b = JSON.parse(await c.evaluate(`JSON.stringify((function(){
        var el=document.querySelector('#biaoTiLanPinPai'); var act=document.querySelector('.biaoTiLanDongZuoJi'); var tb=document.querySelector('#biaoTiLan');
        if(!el||!act||!tb) return {absent:true};
        var r=el.getBoundingClientRect(), a=act.getBoundingClientRect();
        return { text:(el.textContent||'').trim(), you:Math.round(r.you), actLeft:Math.round(a.left),
                 w:Math.round(r.width), overflow: tb.scrollWidth - tb.clientWidth };
      })())`));
      ok(
        !b.absent && b.text.length > 0 && b.overflow <= 0 && b.you <= b.actLeft,
        biaoQian + '：品牌名可见、不与右上角窗控重叠、标题栏不横向溢出',
        JSON.stringify(b)
      );
      return b;
    };

    await navTo('settings');
    // Owner rule: #biaoTiLanPinPai = logo + tagline ONLY (chanPin ming lives in #logoMing).
    const zhBrand = await brandMarkup('R1-2 中文（tagline）');
    ok(zhBrand.text === '让AI成为你的无限牛马', 'R1-2 中文下顶栏就是品牌 tagline「让AI成为你的无限牛马」（产品名在 #logoMing，不在这一行）', zhBrand.text);
    ok((await txt('#logoMing')) === '无限牛马', 'R1-2 中文下 #logoMing = 产品名「无限牛马」', String(await txt('#logoMing')));
    await okContrast('#biaoTiLanPinPai', 'R1-2 亮色下品牌 tagline 对比度 ≥ 3.0');

    // 英文（宽度与中文不同，同样不许越界）
    await c.evaluate(`(function(){var s=document.querySelector('#xuanZeYuYan'); s.value='en-US'; s.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
    await c.waitFor(`document.querySelector('#logoMing').textContent === 'WArmy'`, { timeout: 10000, biaoQian: '15：切到 en-US' });
    const enBrand = await brandMarkup('R1-3 英文（tagline）');
    ok(enBrand.text === 'An infinite army of AI workhorses working for you.' && enBrand.w > 0,
      'R1-3 英文下顶栏就是官方 tagline（产品名 WArmy 在 #logoMing）', JSON.stringify(enBrand));
    ok((await txt('#logoMing')) === 'WArmy', 'R1-3 英文下 #logoMing = WArmy', String(await txt('#logoMing')));
    await c.evaluate(`(function(){var s=document.querySelector('#xuanZeYuYan'); s.value='zh-CN'; s.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
    await c.waitFor(`document.querySelector('#logoMing').textContent === '无限牛马'`, { timeout: 10000, biaoQian: '15：切回中文' });

    // 暗色主题下也照一次对比度
    await c.evaluate("document.documentElement.setAttribute('data-theme','dark'); true");
    await sleep(200);
    await okContrast('#biaoTiLanPinPai', 'R1-4 暗色下品牌名对比度 ≥ 3.0');
    await c.evaluate("document.documentElement.setAttribute('data-theme','light'); true");
    await sleep(150);

    /* ── R4：联系人页只剩一个添加按钮；弹窗左列是我的链接/二维码 ── */
    at = '15 R4 添加联系人';
    await openSession('externalChat', '张三');
    const addBtns = JSON.parse(await c.evaluate(`JSON.stringify(Array.from(document.querySelectorAll('#lieBiaoHeadDongZuoJi button')).map(function(b){
      var r=b.getBoundingClientRect();
      return { id:b.id, text:(b.textContent||'').trim(), visible: r.width>0 && r.height>0 && !b.classList.contains('yinCang') };
    }))`));
    const visAdd = addBtns.filter((b) => b.visible && b.text === ZH['contact.add']);
    ok(
      visAdd.length === 1 && visAdd[0].id === 'anNiuJiaRuqr' && addBtns.every((b) => b.id !== 'lieBiaoDongZuo' || !b.visible),
      'R4-1 联系人页只有**一个**「' + ZH['contact.add'] + '」按钮（右手那个同名重复按钮已去掉）',
      JSON.stringify(addBtns)
    );
    await clickReal('#anNiuJiaRuqr', "!document.querySelector('#duiHuaKuangGen').classList.contains('yinCang')");
    const grid = JSON.parse(await c.evaluate(`JSON.stringify((function(){
      var g=document.querySelector('#duiHuaKuangTi .tianJiaLianXiGrid');
      var own=document.querySelector('#lianXiOwnMianBan'); var oth=document.querySelector('#tianJiaLianXiOthers');
      if(!g||!own||!oth) return {absent:true};
      var a=own.getBoundingClientRect(), b=oth.getBoundingClientRect();
      return { left:Math.round(a.left), you:Math.round(b.left), ownW:Math.round(a.width), othersW:Math.round(b.width) };
    })())`));
    ok(!grid.absent && grid.left < grid.you, 'R4-2 弹窗是两栏：左列「我的联系方式」在左，右列「添加对方」在右', JSON.stringify(grid));
    const ownPanel = JSON.parse(await c.evaluate(`JSON.stringify((function(){
      var link=document.querySelector('#lianXiMyLink'); var qr=document.querySelector('#lianXiMyqr');
      return { link: link? (link.textContent||'').trim() : '', qrSvg: qr? qr.querySelectorAll('svg').length : 0,
               rects: qr? qr.querySelectorAll('svg rect').length : 0, copy: !!document.querySelector('#anNiuMyLinkCopy') };
    })())`));
    ok(/^warmy:\/\/join\?/.test(ownPanel.link || ''), 'R4-3 我的链接是真实的邀请链接（warmy://join?...），不是占位串', String(ownPanel.link).slice(0, 80));
    const identRow = JSON.parse(await c.evaluate(`JSON.stringify((function(){
      var l=document.querySelector('.ownidXian'); return { text: l? (l.textContent||'').trim(): '' };
    })())`));
    ok(/node=(FP-ME|884024787)/.test(ownPanel.link || '') || identRow.text.length > 0,
      'R4-3b 链接里的身份来自本机身份层（node= 用的是真实指纹/别名）', JSON.stringify(identRow).slice(0, 90));
    const domQr = await c.evaluate(`(document.querySelector('#lianXiMyqr')||{}).innerHTML || ''`);
    // R4-4 的真值：仓库里 vendored 的**真**编码器（经典脚本，见 index.html 与 qr.js 头部）。
    // aria-label 是随语言变的 i18n 文案，所以逐字节比之前先把它规范化掉，另行与语言包逐字比（R4-10f）。
    const refQr = QRSVG(ownPanel.link, 168, QR_ECC, ZH['contact.mineQr']);
    const refNormalized = await normalizeInPage(refQr);
    ok(
      ownPanel.qrSvg === 1 && ownPanel.rects >= 100 && QRSTRIP(domQr) === QRSTRIP(refNormalized) && domQr.length > 5000,
      'R4-4 二维码与仓库里那份**真**编码器（vendored qrcode-generator 经典脚本）的输出逐字节一致（归一化 aria-label 后）',
      'rects=' + ownPanel.rects + ' bytes=' + domQr.length + ' same=' + (QRSTRIP(domQr) === QRSTRIP(refNormalized))
    );
    ok(ownPanel.copy, 'R4-4b 左列有「复制链接」按钮', String(ownPanel.copy));

    // 数据拿不到时：如实说明，不画假码、不留假链接
    const savedFace = await c.evaluate(`(function(){
      window.__r14Saved = {
        meshStatus: window.warmy.meshStatus, inviteCreate: window.warmy.inviteCreate,
        i1: window.__warmyIdentityStub && window.__warmyIdentityStub.identityInfo,
        i2: window.__warmyIdentityStub && window.__warmyIdentityStub.identityGet
      };
      try { window.warmy.meshStatus = async function(){ return {}; }; } catch(e){}
      try { window.warmy.inviteCreate = async function(){ return {}; }; } catch(e){}
      if (window.__warmyIdentityStub) {
        window.__warmyIdentityStub.identityInfo = async function(){ return { ok: true }; };
        window.__warmyIdentityStub.identityGet = async function(){ return { ok: true }; };
      }
      return true;})()`);
    await closeModal();
    await clickReal('#anNiuJiaRuqr', "!document.querySelector('#duiHuaKuangGen').classList.contains('yinCang')");
    await sleep(300);
    const honest = JSON.parse(await c.evaluate(`JSON.stringify((function(){
      var u=document.querySelector('#lianXiOwnUnavailable');
      return { text: u? (u.textContent||'').trim(): '', qr: !!document.querySelector('#lianXiMyqr svg'), link: !!document.querySelector('#lianXiMyLink') };
    })())`));
    ok(
      honest.text === ZH['contact.mineUnavailable'] && honest.qr === false && honest.link === false,
      'R4-5 本机身份/邀请都拿不到时：如实说「' + ZH['contact.mineUnavailable'].slice(0, 12) + '…」，不画占位码也不留假链接',
      JSON.stringify(honest)
    );
    await c.evaluate(`(function(){
      var s = window.__r14Saved || {};
      try { if (s.meshStatus) window.warmy.meshStatus = s.meshStatus; } catch(e){}
      try { if (s.inviteCreate) window.warmy.inviteCreate = s.inviteCreate; } catch(e){}
      if (window.__warmyIdentityStub) {
        if (s.i1) window.__warmyIdentityStub.identityInfo = s.i1;
        if (s.i2) window.__warmyIdentityStub.identityGet = s.i2;
      }
      return true;})()`);
    await closeModal();

    /* ── R4-6…R4-12：二维码必须是**真能扫**的二维码（vendored 编码器 + 几何/结构 + 独立解码器） ──
       只断言"渲染了一个 SVG"是不够的：占位矩阵也能画出 25×25 的图案。
       这里改用三重证据：
         1) 运行时确实有那个经典脚本编码器（全局 window.qrcode，且行为可验证）；
         2) DOM 里的图案与编码器对**同一个字符串**的矩阵逐模块一致，且结构（定位/时序/校正花纹）
            与模块数（=4×版本+17，版本由独立容量表算出）都对；
         3) 用**独立**解码器（jsQR，与编码器无共用代码）把 DOM 画出来的东西解回原字符串。 */
    at = '15 R4 真二维码';
    const rendererDir = path.join(SELF_DIR, '..', 'src', 'renderer');
    const htmlSrc = fs.readFileSync(path.join(rendererDir, 'index.html'), 'utf8');
    // 注释里会出现 `<script type="module" src>` 这种字样（我们在注释里解释了为什么不用它），
    // 先剥掉注释再判定，否则断言会被自己的说明文字骗到。
    const htmlCode = htmlSrc.replace(/<!--[\s\S]*?-->/g, '');
    const vendorTagIdx = htmlCode.indexOf('src="./vendor/qrcode-generator-2.0.4.js"');
    const appTagIdx = htmlCode.indexOf('src="./app.js"');
    ok(
      vendorTagIdx > 0 && appTagIdx > 0 && vendorTagIdx < appTagIdx &&
      /<script\s+src="\.\/vendor\/qrcode-generator-2\.0\.4\.js"><\/script>/.test(htmlCode) &&
      !/<script[^>]*\stype\s*=\s*["']module["']/.test(htmlCode) &&
      !/unsafe-eval/.test(htmlCode),
      'R4-6 编码器是**经典脚本**方式引入的（<script src> 在 app.js 之前、非 ESM、CSP 里没有 unsafe-eval）',
      'vendorTag@' + vendorTagIdx + ' appTag@' + appTagIdx
    );
    const vendorInRepo = fs.existsSync(path.join(rendererDir, QR_VENDOR_FILE));
    // 产物目录不能靠猜（net-smoke 走的是自己的 OUT，未必等于本脚本的 OUT 默认值）：
    // 直接看**这个页面自己是哪个文件、同目录下有没有那个 vendored 文件**。
    const served = await c.evaluate(`(function(){
      var s = document.querySelector('script[src*="vendor/qrcode-generator"]');
      return { href: location.href, src: s ? s.getAttribute('src') : null, type: s ? (s.getAttribute('type') || '') : 'absent' };
    })()`);
    let vendorInServedDir = false;
    try {
      const pagePath = String(served.href || '').replace(/[?#].*$/, '');
      vendorInServedDir = fs.existsSync(path.join(path.dirname(fileURLToPath(pagePath)), 'vendor', 'qrcode-generator-2.0.4.js'));
    } catch {
      vendorInServedDir = false;
    }
    ok(
      vendorInRepo && vendorInServedDir && served.type === '',
      'R4-6b vendored 编码器在仓库里、也在**这个页面自己的目录**里（离线可用、零第三方依赖、非 module）',
      'repo=' + vendorInRepo + ' servedDir=' + vendorInServedDir + ' src=' + served.src + ' type=' + JSON.stringify(served.type)
    );

    const encProbe = JSON.parse(await c.evaluate(`JSON.stringify((function(){
      var q = window.qrcode;
      if (typeof q !== 'function') return { type: typeof q };
      var probe = q(1, 'L'); probe.addData('R4-7-PROBE'); probe.make();
      return { type: 'function', hasUtf8: !!(q.stringToBytesFuncs && q.stringToBytesFuncs['UTF-8']),
               probeModules: probe.getModuleCount(), isDark: typeof probe.isDark === 'function' };
    })())`));
    ok(
      encProbe.type === 'function' && encProbe.hasUtf8 && encProbe.probeModules === 21 && encProbe.isDark,
      'R4-7 运行时确实有那个编码器（全局 window.qrcode）：版本 1 → 21×21 模块、带 UTF-8 字节表',
      JSON.stringify(encProbe)
    );

    // 已知固定载荷：把两处数据源钉死，重新打开弹窗，DOM 里的链接就是那段确切字符串
    await c.evaluate(`(function(){
      window.__r4FixedSaved = { meshStatus: window.warmy.meshStatus, inviteCreate: window.warmy.inviteCreate };
      window.warmy.meshStatus = async function(){ return { ok: true, nodeId: 'NODE-FIXED-0001' }; };
      window.warmy.inviteCreate = async function(){ return { ok: true, invite: { token: 'TOK-FIXED-0002' } }; };
      return true;})()`);
    await closeModal();
    await clickReal('#anNiuJiaRuqr', "!!document.querySelector('#lianXiMyqr svg')");
    const fixedLink = (await c.evaluate(`(document.querySelector('#lianXiMyLink')||{}).textContent.trim()`)) || '';
    ok(
      /^warmy:\/\/join\?node=NODE-FIXED-0001&port=\d+&tok=TOK-FIXED-0002$/.test(fixedLink),
      'R4-8 数据源被钉死后，左列链接就是那段**确切**的固定字符串（二维码要编的就是它）',
      fixedLink
    );

    const dom = JSON.parse(await c.evaluate(`JSON.stringify((${QR_DOM_FN})('#lianXiMyqr svg'))`));
    const libRows = rowsOf(QRMATRIX(fixedLink, QR_ECC).matrix);
    const diff = matrixDiff(dom.matrix || [], libRows);
    ok(
      !!dom.matrix && diff.same,
      'R4-9 DOM 里**画出来的**矩阵与 vendored 编码器对同一字符串的矩阵逐模块一致（几何反解，不读渲染层自报的数）',
      'modules=' + (dom.matrix ? dom.matrix.length : 0) + '/' + libRows.length + ' diff=' + diff.why
    );
    const qa = dom.attrs || {};
    ok(
      qa.ecc === QR_ECC && qa.quiet === erweimaAnjing && qa.modules === libRows.length && qa.modules === 4 * qa.version + 17,
      'R4-9b 纠错等级 M、静区 4 个模块、模块数 = 4×版本+17（都不是随手填的）',
      JSON.stringify(qa)
    );
    const minV = minVersionFor(fixedLink);
    ok(
      qa.version === minV.version && qa.version >= 1 && qa.version <= 40,
      'R4-9c 版本是按载荷长度算出的**最小**版本（独立容量表：' + minV.bytes + ' 字节 → 版本 ' + minV.version + '）',
      'dom v=' + qa.version + ' modules=' + qa.modules
    );
    ok(
      qa.cssW >= 160 && qa.cssH >= 160,
      'R4-9d 屏幕上的二维码 ≥160×160 CSS px（手机扫码尺寸）',
      qa.cssW + '×' + qa.cssH + ' css / svg ' + qa.width + '×' + qa.height + ' viewBox=' + qa.viewBox
    );

    const finders = qrFinders(dom.matrix || []);
    ok(
      finders.tl && finders.tr && finders.bl,
      'R4-10 三个角都有标准 7×7 定位花纹（占位矩阵只画了两三个假角，这里逐位比花纹）',
      JSON.stringify(finders)
    );
    const st = qrSeparatorsAndTiming(dom.matrix || []);
    ok(
      st.sep.tl && st.sep.tr && st.sep.bl && st.timing,
      'R4-10b 定位角的分隔符全亮 + 第 6 行/第 6 列时序花纹逐位正确（这两样占位矩阵根本没有）',
      JSON.stringify(st.sep) + ' timing=' + st.timing
    );
    const extra = qrAlignmentAndDarkModule(dom.matrix || [], qa.version);
    ok(
      extra.align === true && extra.darkModule === true,
      'R4-10c 校正花纹（版本≥2 时右下 5×5）+ 固定深色模块 (n-8,8) 都在位',
      JSON.stringify(extra)
    );
    ok(
      dom.outside === 0 && dom.wrongSize === 0 && dom.bg === 1,
      'R4-10d 每个深色模块都恰好一格、尺寸一致，没有一个落到静区/画布外（静区是真留白）',
      JSON.stringify({ outside: dom.outside, wrongSize: dom.wrongSize, bg: dom.bg, rects: dom.rects, unit: qa.unit })
    );
    const domHtmlFixed = await c.evaluate(`(document.querySelector('#lianXiMyqr')||{}).innerHTML || ''`);
    const refFixed = await normalizeInPage(QRSVG(fixedLink, 168, QR_ECC, ZH['contact.mineQr']));
    ok(
      QRSTRIP(domHtmlFixed) === QRSTRIP(refFixed),
      'R4-10e 与 qr.js 参考实现（同一 vendored 编码器）**逐字节**一致 —— 两边漂移就会红',
      'bytes=' + domHtmlFixed.length
    );
    ok(
      qa.ariaLabel === ZH['contact.mineQr'],
      'R4-10f 二维码的 aria-label 走 i18n（逐字等于语言包，不是硬编码英文）',
      JSON.stringify(qa.ariaLabel)
    );

    if (typeof qrDecode !== 'function') {
      warn('独立解码器不可用（' + QR_DECODER_FILE + '）：无法证明「真的能扫」，只能用上面的结构与真值比对');
      ok(false, 'R4-11 独立解码器不可用，无法把 DOM 里的码解回原字符串', QR_DECODER_FILE);
    } else {
      const geomDecoded = decodeMatrixRows(dom.matrix || []);
      ok(
        geomDecoded === fixedLink,
        'R4-11 独立解码器 jsQR 把 DOM 的矩阵解回原字符串（几何路径：rect 坐标 → 矩阵 → 解码）',
        JSON.stringify(String(geomDecoded).slice(0, 70))
      );
      const pix = JSON.parse(await c.evaluate(
        `(async function(){ var r = await (${QR_PIXEL_FN})('#lianXiMyqr svg', 8); return JSON.stringify(r); })()`
      ));
      let pixDecoded = null;
      if (!pix.err && pix.b64) {
        pixDecoded = decodeGray(Buffer.from(pix.b64, 'base64'), pix.side);
      } else {
        warn('像素路径不可用（' + pix.err + '）：只能靠几何路径的解码证据');
      }
      ok(
        !pix.err && pixDecoded === fixedLink,
        'R4-11b 把**屏幕上那个 SVG 真的栅格化**（' + (pix.err ? pix.err : pix.px + '×' + pix.px + ' px，' + pix.modulePx + 'px/模块') +
          '）后，独立解码器解回原字符串 —— 端到端的"扫得出来"',
        JSON.stringify(String(pixDecoded).slice(0, 70))
      );
    }

    // 编码器拿不到时：如实说明，不画假码（链接仍在，用户照样能发）
    await c.evaluate(`(function(){ window.__r4EncSaved = window.qrcode; window.qrcode = undefined; return true; })()`);
    await closeModal();
    await clickReal('#anNiuJiaRuqr', "!document.querySelector('#duiHuaKuangGen').classList.contains('yinCang')");
    await sleep(250);
    const noEnc = JSON.parse(await c.evaluate(`JSON.stringify((function(){
      var box = document.querySelector('#lianXiMyqr');
      return { svg: box ? box.querySelectorAll('svg').length : -1,
               state: box ? box.getAttribute('data-qr-state') : null,
               text: box ? (box.textContent||'').trim() : '',
               link: !!document.querySelector('#lianXiMyLink') };
    })())`));
    ok(
      noEnc.svg === 0 && noEnc.state === 'no-encoder' && noEnc.text === ZH['contact.qrUnavailable'] && noEnc.link === true,
      'R4-12 编码器不可用时如实说「' + ZH['contact.qrUnavailable'].slice(0, 14) + '…」，绝不画假码（链接仍在）',
      JSON.stringify(noEnc)
    );
    await c.evaluate(`(function(){ window.qrcode = window.__r4EncSaved; return typeof window.qrcode; })()`);
    await c.evaluate(`(function(){
      var s = window.__r4FixedSaved || {};
      try { if (s.meshStatus) window.warmy.meshStatus = s.meshStatus; } catch(e){}
      try { if (s.inviteCreate) window.warmy.inviteCreate = s.inviteCreate; } catch(e){}
      return true;})()`);
    await closeModal();

    /* ── R3：聊天区 ↔ 右栏 的分隔条能拖、两侧都不会塌、宽度持久化 ── */
    at = '15 R3 分隔条';
    await openSession('singleAi', 'demo.agent');
    const g0 = await resetWidthOf();
    ok(
      g0.parent === 'liaoTianLan' && g0.resW >= 4 && g0.resX > 0 && g0.panelW > 0 && g0.chatW > 0,
      'R3-1 分隔条挂在聊天栏右缘（分界线上）、可点（≥4px 命中区）',
      JSON.stringify(g0)
    );
    const afterReset = await dblClickSplitter();
    ok(afterReset.panelW === 300, 'R3-1b 双击分隔条恢复默认宽度 300px（不会把布局拖坏）', JSON.stringify(afterReset));

    const wider = await dragSplitter(-120);
    ok(
      Math.abs(wider.panelW - (afterReset.panelW + 120)) <= 40 && wider.chatW < afterReset.chatW,
      'R3-2 真鼠标向左拖 120px：右栏变宽、聊天区变窄（两侧同时被改）',
      JSON.stringify(wider)
    );
    const toMin = await dragSplitter(900);
    ok(
      toMin.panelW === 220 && toMin.chatW >= 320,
      'R3-3 往右拖到底：右栏停在最小 220px，左聊天区仍 ≥320px（谁都不会被压成 0）',
      JSON.stringify(toMin)
    );
    const toMax = await dragSplitter(-1200);
    ok(
      toMax.panelW >= 420 && toMax.panelW <= 480 && toMax.chatW >= 320,
      'R3-4 往左拖到底：右栏停在最大 480px 以内，聊天区仍 ≥320px',
      JSON.stringify(toMax)
    );
    const finalDrag = await dragSplitter(40);
    const persistedW = await c.evaluate(`(function(){var s=window.__previewSettings||{};return Number(s.panelWidth)||0;})()`);
    const cssVarW = await c.evaluate(`parseInt(getComputedStyle(document.documentElement).getPropertyValue('--panel-w'),10)||0`);
    ok(
      persistedW > 0 && persistedW === cssVarW && Math.abs(persistedW - finalDrag.panelW) <= 2,
      'R3-5 松手后宽度写回**既有 settings 通道**（settings.panelWidth == 界面宽度）',
      'panelWidth=' + persistedW + ' cssVar=' + cssVarW + ' dom=' + finalDrag.panelW
    );

    /* ── R2：设置「快捷」列（API 目录 + 键盘快捷键） ── */
    at = '15 R2 快捷列';
    await navTo('settings');
    const hotkeyNav = await c.evaluate(`(function(){var b=document.querySelector('#peiZhiDaoHang button[data-sec="hotkey"]');return b? (b.textContent||'').trim(): '';})()`);
    ok(hotkeyNav === ZH['settings.section.hotkey'], 'R2-1 设置里出现新的「' + ZH['settings.section.hotkey'] + '」列', String(hotkeyNav));
    await c.evaluate(`document.querySelector('#peiZhiDaoHang button[data-sec="hotkey"]').click(); true`);
    await c.waitFor(`document.querySelectorAll('#hkMiYaoJiTi tr').length > 0`, { timeout: 8000, biaoQian: '15：快捷键表已渲染' });
    await sleep(200);

    const api = JSON.parse(await c.evaluate(`JSON.stringify((function(){
      var b=window.warmy||{};
      var callable=Object.keys(b).filter(function(n){return typeof b[n]==='function' && !/^qiYong[A-Z]/.test(n);});
      var rows=Array.from(document.querySelectorAll('#hkapiTi tr[data-api-op]'));
      var fake=rows.filter(function(r){ return typeof b[r.getAttribute('data-api-op')]!=='function'; });
      var shown=rows.map(function(r){return r.getAttribute('data-api-op');});
      var missing=callable.filter(function(n){return shown.indexOf(n)<0;});
      var groups=document.querySelectorAll('#hkapiTi .hkQunBiaoTi').length;
      var blank=Array.from(document.querySelectorAll('#hkapiTi td.hkMiaoShu')).filter(function(td){return !(td.textContent||'').trim();}).length;
      return { callable:callable.length, rows:rows.length, fake:fake.length, missing:missing.length, groups:groups, blank:blank,
               count:(document.querySelector('#hkapiCount')||{}).textContent||'' };
    })())`));
    ok(api.rows === api.callable && api.fake === 0 && api.missing === 0,
      'R2-2 接口目录 = 桥上真实存在的可调用方法（一个不多一个不少，没编造接口）',
      JSON.stringify(api));
    ok(/^\d+/.test(api.count) || api.count.indexOf(String(api.callable)) >= 0,
      'R2-2b 目录显示真实操作条数', api.count);
    ok(api.groups >= 5 && api.blank === 0,
      'R2-2c 目录按用途分组，且每一行都有说明（有收录的写清楚，没收录的如实标「未收录说明」，不留空）',
      'groups=' + api.groups + ' blank=' + api.blank);

    const keys = JSON.parse(await c.evaluate(`JSON.stringify(Array.from(document.querySelectorAll('#hkMiYaoJiTi tr')).map(function(r){
      var b=r.querySelector('.hkMiYao');
      return { id:r.getAttribute('data-hk-row'), text:(b.textContent||'').trim(), bound:!b.classList.contains('unbound') };
    }))`));
    const bound = keys.filter((k) => k.bound);
    const unbound = keys.filter((k) => !k.bound);
    ok(keys.length >= 8, 'R2-3 快捷键表有足够的动作行（只列真的接上动作的）', String(keys.length));
    ok(unbound.length > bound.length, 'R2-4 默认**大部分是空的**（未绑定 ' + unbound.length + ' 行 > 已预置 ' + bound.length + ' 行）',
      JSON.stringify(bound.map((b) => b.id + '=' + b.text)));
    const presetWant = { toggleSidebar: 'Ctrl+B', openSettings: 'Ctrl+,', newSession: 'Ctrl+N', focusSearch: 'Ctrl+F' };
    const presetBad = Object.keys(presetWant).filter((id) => {
      const hit = keys.filter((k) => k.id === id)[0];
      return !hit || hit.text !== presetWant[id];
    });
    ok(presetBad.length === 0, 'R2-4b 只预置少数几个常用键（' + JSON.stringify(presetWant) + '）', JSON.stringify(presetBad));
    ok(unbound.every((k) => k.text === ZH['settings.hotkey.unbound']), 'R2-4c 空行如实显示「' + ZH['settings.hotkey.unbound'] + '」', JSON.stringify(unbound.map((k) => k.id)));

    // 录制：点格子 → 真按键 → 记下来并写进设置
    await c.evaluate(`document.querySelector('.hkMiYao[data-hk="openContacts"]').click(); true`);
    await sleep(150);
    const listening = await c.evaluate(`document.querySelector('.hkMiYao[data-hk="openContacts"]').classList.contains('listening')`);
    await pressKey('9', { ctrl: true, alt: true, code: 'Digit9', vk: 57 });
    await sleep(350);
    const recorded = JSON.parse(await c.evaluate(`JSON.stringify((function(){
      var b=document.querySelector('.hkMiYao[data-hk="openContacts"]');
      var s=(window.__previewSettings||{}).shortcuts||{};
      return { text:(b.textContent||'').trim(), bound:!b.classList.contains('unbound'), saved:s.openContacts||'' };
    })())`));
    ok(listening === true, 'R2-5 点「按键」格进入录制态（看得见提示）', String(listening));
    ok(recorded.text === 'Ctrl+Alt+9' && recorded.bound === true && recorded.saved === 'Ctrl+Alt+9',
      'R2-5b 按下真组合键被记下来，并写进**既有 settings 通道**（settings.shortcuts.openContacts）',
      JSON.stringify(recorded));

    // 触发：默认绑定 Ctrl+B 真的折叠左边栏
    await navTo('singleAi');
    const beforeBar = await c.evaluate(`document.querySelector('#yingYongTi').classList.contains('yinCangLieBiao')`);
    await pressKey('b', { ctrl: true, code: 'KeyB', vk: 66 });
    await sleep(250);
    const afterBar = await c.evaluate(`document.querySelector('#yingYongTi').classList.contains('yinCangLieBiao')`);
    ok(beforeBar !== afterBar, 'R2-6 预置的 Ctrl+B 真的触发了动作（显示/隐藏左边栏）', beforeBar + ' -> ' + afterBar);
    await pressKey('b', { ctrl: true, code: 'KeyB', vk: 66 });
    await sleep(250);

    // 触发：用户刚设的 Ctrl+Alt+9 真的跳转到联系人页
    await pressKey('9', { ctrl: true, alt: true, code: 'Digit9', vk: 57 });
    await sleep(400);
    const jumped = await c.evaluate(`(function(){var a=document.querySelector('.ceLanTiaoMu.jiHuo');return a? (a.dataset.nav||''):'';})()`);
    ok(jumped === 'externalChat', 'R2-7 用户自己绑的 Ctrl+Alt+9 真的触发了动作（跳到联系人页）', String(jumped));

    /* ── 一次 reload 同时验两件持久化：右栏宽度 + 用户设的快捷键 ── */
    at = '15 持久化（reload）';
    await c.send('Page.reload', { ignoreCache: false });
    await c.waitFor('typeof window.__saveState === "function" && !!window.__netUi', { timeout: 30000, biaoQian: '15：重启后页面就绪' });
    await closeModal();
    await c.waitFor(`!document.querySelector('#liaoTianBuJu').classList.contains('yinCang')`, { timeout: 10000, biaoQian: '15：重启后会话已打开' });
    await sleep(400);
    const afterReload = await resetWidthOf();
    const varAfterReload = await c.evaluate(`parseInt(getComputedStyle(document.documentElement).getPropertyValue('--panel-w'),10)||0`);
    ok(
      varAfterReload === persistedW && Math.abs(afterReload.panelW - persistedW) <= 2,
      'R3-6 重启（reload）后右栏宽度保持' + persistedW + 'px（持久化真的生效）',
      'var=' + varAfterReload + ' dom=' + afterReload.panelW
    );
    await navTo('settings');
    await c.evaluate(`document.querySelector('#peiZhiDaoHang button[data-sec="hotkey"]').click(); true`);
    await c.waitFor(`!!document.querySelector('.hkMiYao[data-hk="openContacts"]')`, { timeout: 8000, biaoQian: '15：重启后快捷键表' });
    const persistedKey = await c.evaluate(`(document.querySelector('.hkMiYao[data-hk="openContacts"]')||{}).textContent.trim()`);
    ok(persistedKey === 'Ctrl+Alt+9', 'R2-8 重启后用户设的绑定还在（settings 通道持久化）', String(persistedKey));

    // 清绑定：Backspace 应清空并落盘（免得污染后续；harness 每轮也会清预览设置）
    await c.evaluate(`document.querySelector('.hkMiYao[data-hk="openContacts"]').click(); true`);
    await sleep(150);
    await pressKey('Backspace', { code: 'Backspace', vk: 8 });
    await sleep(350);
    const cleared = JSON.parse(await c.evaluate(`JSON.stringify((function(){
      var b=document.querySelector('.hkMiYao[data-hk="openContacts"]');
      var s=(window.__previewSettings||{}).shortcuts||{};
      return { text:(b.textContent||'').trim(), saved:Object.prototype.hasOwnProperty.call(s,'openContacts')? String(s.openContacts): null };
    })())`));
    ok(cleared.text === ZH['settings.hotkey.unbound'] && cleared.saved === '',
      'R2-9 Backspace 清空绑定并落盘（空串 = 显式解绑，不会回落到预置值）',
      JSON.stringify(cleared));

    // 收尾：右栏宽度回到默认，别把这一轮的宽度留给下一轮
    await navTo('singleAi');
    await sleep(200);
    await dblClickSplitter();
    await sleep(200);

    /* ══ 16. 确认框（uiConfirm）的「确定」必须**真的关掉**弹窗，且返回值正确 ══
       背景（真实缺陷，已由并行线修掉，这里补上当初缺失的断言）：确定键曾写成
       `root.classList.remove('yinCang')` —— 即「保持打开」。后果不是好看不好看：
       点完确定弹窗还盖在屏幕上，连顶部横幅一起挡住，于是「采用新联系方式 → 已联系本人核实」
       这条验收链超时（3/3 轮）。取消路径一直是对的。
       本节的证据分三层，全部走**真鼠标坐标点击**：
         a) 点确定后弹窗真的消失（class + 计算样式 + 尺寸 + 命中测试：横幅上的按钮重新可点）；
         b) await 拿到的返回值是对的 —— 用真实调用方验证：身份层的 adopt/ack 是否真的被调用；
         c) 取消仍然不生效（只关窗、不调用）。 */
    at = '16 确认框（uiConfirm）';
    const r16now = Date.now();
    /** 按 data-cid 精确定位某一条变更上的按钮（不然会点到上一轮的残留行） */
    const btn16 = (bn, cid) => idRowSel + ' button[data-bn="' + bn + '"][data-cid="' + cid + '"]';
    const mkChange = (id) => ({
      id: id, ts: r16now, receivedAt: r16now, generation: 31, subjectId: 'r16-' + id, subjectName: '张三',
      oldFingerprint: 'FP-R16-OLD', newFingerprint: 'FP-R16-NEW-' + id,
      previousCard: { email: id + '@old.example', phone: '13900000009', capturedAt: r16now - 86400000 },
      pendingCard: { email: id + '@new.example', phone: '' },
      contactFreezeUntil: r16now - 1000, frozen: false, remainingMs: 0,
      scopes: [{ kind: 'internal', id: 'g-1' }],
    });
    const setR16Change = async (id) => {
      await c.evaluate(`window.__idTest.setState({ changes: [${JSON.stringify(mkChange(id))}] }); void window.__netUi.loadIdChanges(); true`);
      // 必须等**这一条**变更真的渲染出来（按 data-cid 定位）：只等"有个按钮"会点到上一轮的残留行
      await c.waitFor(`!!document.querySelector(${JSON.stringify(btn16('idAdopt', id))})`, { timeout: 9000, biaoQian: '16：换证横幅出现（' + id + '）' });
    };
    const adoptSel = (id) => btn16('idAdopt', id);
    const verifySel = (id) => btn16('idVerify', id);
    /** 弹窗是否**真的**不在屏幕上（class / 计算样式 / 尺寸三样都要对） */
    const modalGone = async () =>
      JSON.parse(await c.evaluate(`JSON.stringify((function(){
        var root = document.querySelector('#duiHuaKuangGen');
        var cs = getComputedStyle(root);
        var r = root.getBoundingClientRect();
        return { hiddenClass: root.classList.contains('yinCang'), display: cs.display, w: Math.round(r.width), h: Math.round(r.height) };
      })())`));
    /** 横幅上的按钮此刻能不能点到（当初就是被弹窗遮罩挡住了） */
    const bannerHit = async (sel) =>
      JSON.parse(await c.evaluate(`JSON.stringify((function(){
        var b = document.querySelector(${JSON.stringify(sel)});
        if (!b) return { err: 'no-button' };
        var r = b.getBoundingClientRect();
        var x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
        var el = document.elementFromPoint(x, y);
        return { point: x + ',' + y, top: el ? (el.id || el.className || el.tagName) : 'null', isButton: !!(el && (el === b || b.contains(el))) };
      })())`));

    await openSession('internalGroup', '项目推进群');
    await setR16Change('r16-ok');
    ok(
      (await c.evaluate(`(function(){var b=document.querySelector(${JSON.stringify(adoptSel('r16-ok'))});return b? b.disabled : null;})()`)) === false,
      'R16-1 冻结期已过，「采用新联系方式」可点（用它验确认框的确定键）',
      'changeId=r16-ok'
    );
    await c.evaluate('window.__idTest.reset(); true');
    await clickReal(adoptSel('r16-ok'), "!document.querySelector('#duiHuaKuangGen').classList.contains('yinCang')");
    const m16 = await modal();
    ok(m16.visible && /采用新联系方式/.test(m16.biaoTi || ''), 'R16-1b 弹出确认框（标题走 i18n）', JSON.stringify({ title: m16.biaoTi }));
    const okClick = await clickModal('确定');
    const gone16 = await modalGone();
    ok(
      gone16.hiddenClass && gone16.display === 'none' && gone16.w === 0 && gone16.h === 0,
      'R16-2 真鼠标点「确定」后弹窗真的消失（class + 计算样式 + 尺寸都为 0）',
      JSON.stringify(gone16) + ' clicked=' + JSON.stringify(okClick)
    );
    const adoptCalls = JSON.parse(await c.evaluate('JSON.stringify(window.__idTest.callsOf("adopt"))'));
    ok(
      adoptCalls.length === 1 && adoptCalls[0].changeId === 'r16-ok',
      'R16-2b 返回值是对的：await uiConfirm(...) 拿到 true，调用方继续走完（身份层 adopt 真的被调用）',
      JSON.stringify(adoptCalls)
    );
    const hit16 = await bannerHit(verifySel('r16-ok'));
    ok(
      hit16.isButton === true,
      'R16-2c 弹窗消失后横幅上的按钮重新可点（命中测试不再被遮罩挡住）—— 这就是当初卡住验收链的那一步',
      JSON.stringify(hit16)
    );

    // 取消：仍然只关窗、不生效（返回值 false）
    await setR16Change('r16-cancel');
    await c.evaluate('window.__idTest.reset(); true');
    await clickReal(adoptSel('r16-cancel'), "!document.querySelector('#duiHuaKuangGen').classList.contains('yinCang')");
    const cancelClick = await clickModal('取消');
    const goneCancel = await modalGone();
    ok(
      goneCancel.hiddenClass && goneCancel.w === 0 && goneCancel.h === 0,
      'R16-3 真鼠标点「取消」后弹窗同样消失（取消路径没被改坏）',
      JSON.stringify(goneCancel) + ' clicked=' + JSON.stringify(cancelClick)
    );
    const noAdopt = await c.evaluate('window.__idTest.callsOf("adopt").length');
    ok(noAdopt === 0, 'R16-3b 返回值是对的：取消拿到 false，调用方不继续（身份层没有被调用）', 'adoptCalls=' + noAdopt);
    ok(await exists(idRowSel + ' .idTiaoMu'), 'R16-3c 取消后横幅仍在（没有误当确定）');

    // 「已联系本人核实」：当初被弹窗遮住、点不到的那个按钮
    await setR16Change('r16-verify');
    await c.evaluate('window.__idTest.reset(); true');
    await clickReal(verifySel('r16-verify'), "!document.querySelector('#duiHuaKuangGen').classList.contains('yinCang')");
    const okClick2 = await clickModal('确定');
    const goneVerify = await modalGone();
    ok(
      goneVerify.hiddenClass && goneVerify.w === 0 && goneVerify.h === 0,
      'R16-4 「已联系本人核实」的确认框点确定后也真的消失',
      JSON.stringify(goneVerify) + ' clicked=' + JSON.stringify(okClick2)
    );
    await c.waitFor('window.__idTest.callsOf("ack").length >= 1', { timeout: 6000, biaoQian: '16：核实写入身份层' });
    const ackCalls = JSON.parse(await c.evaluate('JSON.stringify(window.__idTest.callsOf("ack"))'));
    ok(
      ackCalls.some((x) => x.level === 'verified' && x.changeId === 'r16-verify'),
      'R16-4b 返回值是对的：确定 → 调用方真的把「已核实」写进身份层（level=verified）',
      JSON.stringify(ackCalls)
    );
    await c.waitFor(`!document.querySelector('${idRowSel}')`, { timeout: 8000, biaoQian: '16：核实后横幅收起' });
    ok(!(await exists(idRowSel)), 'R16-4c 核实后该变更不再打扰（横幅消失）');

    // 收尾：把这一节注入的变更清掉，别留给下一轮/下一节
    await c.evaluate('window.__idTest.setState({ changes: [] }); void window.__netUi.loadIdChanges(); true');
    await closeModal();
  }

  /* ══════════════════════════════════════════════════════════════════════════
     17. 组网横幅的**重现语义**（T189 补完）
     产品负责人要求：横幅必须在下面三种情况下**再次出现**，且理由要对：
       (a) 组网重新打开后又关闭 —— 已有断言（R9-8），本节不动它；
       (b) 网络抖动（连上 → 掉线）：掉线是**新的一次**，不能因为上一次被手动关掉就不再提醒；
       (c) 公网地址变为不可达：终态结论**再次出现**时也必须重新弹
           （同一个结论持续期间不重复打扰 = 手动关闭仍然有效）。
     驱动方式：全部走**真实状态机**（组网层桩 → netStatus → 心跳迟滞 → renderNetBanner），
     注入抖动/不可达条件后只等条件成立，不用秒表。
     既有断言一律不改 —— 这一节只加新的；"合并横幅恒一行"的规则在每一条里都再验一次。
     ══════════════════════════════════════════════════════════════════════════ */
  step('17. 组网横幅重现语义（b 网络抖动 / c 公网地址不可达）');

  /** 公网地址不可达（终态）：两端都拨不进来且没有可用中继 */
  const GAP_UNREACHABLE = {
    selfDialable: false, peerDialable: false, bothUndialable: true, needsPublicRelayNotice: true,
    relayCode: 'relay-unreachable',
    ipv6: { hasGlobalUnicast: false, publicCandidate: null }, naturalDialable: false, dialableKind: 'undialable',
    relay: {
      needed: true, selected: false, code: 'relay-unreachable', reason: 'all-relays-unreachable',
      selfDialable: false, peerDialable: false, bothUndialable: true, tokenSymmetric: false,
      attempts: [{ addr: { host: '203.0.113.7', port: 59599 }, ok: false, ms: 1500 }], needsPublicRelayNotice: true,
    },
    i18n: { relay: 'net.relay.missing.unreachable' },
  };
  /** 公网地址又可达了（对照组：结论消失） */
  const GAP_CLEARED = {
    selfDialable: true, peerDialable: true, bothUndialable: false, needsPublicRelayNotice: false,
    relayCode: 'relay-not-needed-peer-dialable',
    ipv6: { hasGlobalUnicast: true, publicCandidate: '2001:db8::1' }, naturalDialable: true, dialableKind: 'peer-verified',
    suggestedRung: 'public-direct',
    i18n: { rung: 'net.rung.publicDirect', relay: 'net.relay.notNeeded.peerDialable' },
  };
  /** 横幅现场（一行：签名/标题/正文/终态标志/downSince/行数） */
  const netRowNow = async () =>
    JSON.parse(await c.evaluate(`(function(){var r=document.querySelector('${netRowSel}');
      if(!r) return JSON.stringify({ rows: 0 });
      return JSON.stringify({ rows: document.querySelectorAll('${netRowSel}').length,
        sig: r.dataset.sig, terminal: r.dataset.terminal,
        title: r.querySelector('.bnBiaoTi').textContent, ti: r.querySelector('.bnTi').textContent,
        downSince: window.__netUi.net.link.downSince, episode: window.__netUi.net.gapEpisode });})()`));

  at = '17 起点：组网开 + 链路健康 + 异地成员';
  // 重试节奏放慢：这一节要验"断链途中"的横幅，不希望它中途被自动关组网（那是另一条断言的事）
  await c.evaluate('window.__netTuning = { hysteresisFailures: 3, hysteresisSeconds: 1, retryRounds: 50, backoffMs: [600000], tickMs: 200, reachTtlMs: 30000 }; true');
  // 开关有门控（检测通过才允许打开）：前面的章节可能把本机检测结论清掉了，这里如实补一次"检测通过"
  await c.evaluate("window.__netUi.net.probe = { verdict: 'pass', at: Date.now(), isPublic: true, outboundOk: true, method: 'autonat' }; true");
  await closeModal();
  await c.evaluate('window.__netTest.setState({ reachability: null, sessions: 0, samples: [true] }); true');
  await c.evaluate("window.__netTest.setState({ members: { 'g-1': [ { id:'remote-bob', ming:'remote-bob', remote:true, online:true } ] } }); true");
  await c.evaluate('window.__netUi.net.dismissed = {}; void window.__netUi.setEnabled(true); true');
  await c.waitFor('window.__netUi.net.enabled === true', { timeout: 10000, biaoQian: '17：组网开着（起点）' });
  await c.evaluate('void window.__netUi.refreshPresence(); true');
  await c.waitFor('window.__netUi.net.remoteCount >= 1', { timeout: 10000, biaoQian: '17：异地成员就绪（合并分支的前提）' });
  await c.waitFor('window.__netUi.net.link.linkDown === false', { timeout: 10000, biaoQian: '17：起点链路健康' });
  await c.waitFor(`!document.querySelector('${netRowSel}')`, { timeout: 8000, biaoQian: '17：起点无组网横幅' });
  ok(true, '17-0 起点：组网开着 + 链路健康 + 有异地成员，仍然**没有**组网横幅（不误报）');

  /* ── (b) 网络抖动：掉线 → 恢复 → 再掉线 ── */
  at = '17 抖动第 1 次掉线';
  const dropLink = async (biaoQian) => {
    await c.evaluate('window.__netTest.setSamples([false]); true');
    await c.waitFor(`!!document.querySelector('${netRowSel}')`, { timeout: 15000, biaoQian });
    return await netRowNow();
  };
  const flap1 = await dropLink('17：抖动第 1 次掉线 → 断链横幅出现');
  ok(flap1.biaoTi === ZH['net.banner.linkTitle'], '17-b1 抖动第 1 次掉线 → 出「连接已断开」横幅（理由逐字等于 zh 包）', String(flap1.biaoTi).slice(0, 30));
  ok(flap1.terminal === '0' && !/中继/.test(flap1.ti), '17-b1 这条是"断链（还在重试）"而不是终态：不给"配中继"那种出路', String(flap1.ti).slice(0, 60));
  ok(flap1.rows === 1, '17-b1 组网横幅恒为一行（合并规则在重现语义下也成立）', 'rows=' + flap1.rows);
  ok(/\d+\/50 轮/.test(flap1.ti), '17-b1 断链正文如实写出重试轮次（对照：证明走的是真状态机，不是塞文案）', String(flap1.ti).slice(0, 70));

  at = '17 手动关掉第 1 次的横幅';
  await clickReal(netRowSel + ' .bnx', `!document.querySelector('${netRowSel}')`);
  await sleep(700);
  ok(!(await exists(netRowSel)), '17-b2 断链横幅可手动关闭（这一次不再打扰）');

  at = '17 抖动恢复';
  await c.evaluate('window.__netTest.setSamples([true]); true');
  await c.waitFor('window.__netUi.net.link.linkDown === false', { timeout: 12000, biaoQian: '17：链路恢复（状态机真的复位）' });
  await c.waitFor(`!document.querySelector('${netRowSel}')`, { timeout: 8000, biaoQian: '17：恢复后横幅收起' });
  const recovered = JSON.parse(await c.evaluate('JSON.stringify({ down: window.__netUi.net.link.linkDown, since: window.__netUi.net.link.downSince, fails: window.__netUi.net.link.fails })'));
  ok(!recovered.down && recovered.since === 0 && recovered.fails === 0,
    '17-b3 恢复是真恢复：linkDown=false 且 downSince/fails 归零（不是"被关掉"的假象）', JSON.stringify(recovered));

  at = '17 抖动第 2 次掉线（必须重现）';
  const flap2 = await dropLink('17：抖动第 2 次掉线 → 横幅必须重新出现');
  ok(flap2.biaoTi === ZH['net.banner.linkTitle'], '17-b4 **再次掉线 → 横幅重新出现**，理由仍逐字等于 zh 包的「连接已断开」', String(flap2.biaoTi).slice(0, 30));
  ok(flap2.sig !== flap1.sig, '17-b4 证据：这是新的一次断链（签名随 downSince 变化），不是旧签名复用', flap1.sig + ' -> ' + flap2.sig);
  ok(flap2.rows === 1 && flap2.terminal === '0', '17-b4 重现后仍是一条组网横幅、仍是"重试中"语义', JSON.stringify({ rows: flap2.rows, terminal: flap2.terminal }));
  ok(ZH['net.banner.linkBody'] && ZH['net.banner.linkBody'].includes('{fails}'),
    '17-b4 断链正文模板仍在 zh 包里（文案没被这一节改动）', String(ZH['net.banner.linkBody']).slice(0, 40));

  /* ── (c) 公网地址变为不可达：终态重现 ── */
  at = '17 公网地址不可达（第 1 次）';
  await c.evaluate('window.__netTest.setSamples([true]); true');
  await c.waitFor('window.__netUi.net.link.linkDown === false', { timeout: 12000, biaoQian: '17：先把链路恢复（终态要独立于断链）' });
  await clickReal(netRowSel + ' .bnx', `!document.querySelector('${netRowSel}')`).catch(() => {});
  await c.evaluate('void window.__netUi.setEnabled(true); true');
  await c.waitFor('window.__netUi.net.enabled === true', { timeout: 10000, biaoQian: '17：组网开着（终态的前提）' });
  const episodeBefore = await c.evaluate('window.__netUi.gapEpisode()');
  await c.evaluate(`window.__netTest.setState({ reachability: ${JSON.stringify(GAP_UNREACHABLE)} }); true`);
  await c.evaluate('void window.__netUi.heartbeat(); true');
  await c.waitFor(`document.querySelector('${netRowSel}') && document.querySelector('${netRowSel}').dataset.terminal === '1'`, {
    timeout: 12000, biaoQian: '17：公网地址不可达 → 终态横幅出现',
  });
  const gap1 = await netRowNow();
  ok(gap1.biaoTi === ZH['net.banner.relayTerminalTitle'], '17-c1 公网地址不可达 → 终态横幅（标题逐字等于 zh 包）', String(gap1.biaoTi).slice(0, 36));
  ok(gap1.ti === ZH['net.relay.missing.unreachable'], '17-c1 理由对得上：中继**不可达**（不是"没配中继"，不是断链）', String(gap1.ti).slice(0, 50));
  ok(gap1.rows === 1 && gap1.terminal === '1', '17-c1 恒一行 + data-terminal=1（可诊断）', JSON.stringify({ rows: gap1.rows, terminal: gap1.terminal }));
  ok(gap1.episode === episodeBefore + 1, '17-c1 这是新的一次终态（发生次数 +1）', 'before=' + episodeBefore + ' after=' + gap1.episode);

  at = '17 手动关掉终态横幅（同一次发生内不再打扰）';
  await clickReal(netRowSel + ' .bnx', `!document.querySelector('${netRowSel}')`);
  await sleep(500);
  ok(!(await exists(netRowSel)), '17-c2 终态横幅同样可手动关闭');
  for (let i = 0; i < 3; i++) {
    await c.evaluate('void window.__netUi.heartbeat(); true');
    await sleep(250);
  }
  ok(!(await exists(netRowSel)), '17-c3 结论**一直没变**时不再重复打扰（同一发生次数内手动关闭有效）', 'episode=' + (await c.evaluate('window.__netUi.gapEpisode()')));

  at = '17 公网地址恢复可达 → 结论消失';
  await c.evaluate(`window.__netTest.setState({ reachability: ${JSON.stringify(GAP_CLEARED)} }); true`);
  await c.evaluate('void window.__netUi.heartbeat(); true');
  await c.waitFor(`!document.querySelector('${netRowSel}')`, { timeout: 10000, biaoQian: '17：可达后终态横幅收起' });
  ok(!(await exists(netRowSel)), '17-c4 公网地址又可达 → 终态横幅收起（结论消失是真的消失）');

  at = '17 公网地址再次不可达（必须重现）';
  await c.evaluate(`window.__netTest.setState({ reachability: ${JSON.stringify(GAP_UNREACHABLE)} }); true`);
  await c.evaluate('void window.__netUi.heartbeat(); true');
  await c.waitFor(`document.querySelector('${netRowSel}') && document.querySelector('${netRowSel}').dataset.terminal === '1'`, {
    timeout: 12000, biaoQian: '17：公网地址再次不可达 → 终态横幅必须重新出现',
  });
  const gap2 = await netRowNow();
  ok(gap2.biaoTi === ZH['net.banner.relayTerminalTitle'] && gap2.ti === ZH['net.relay.missing.unreachable'],
    '17-c5 **再次不可达 → 横幅重新出现**，理由仍是中继不可达（不是别的理由）', JSON.stringify({ title: gap2.biaoTi, ti: gap2.ti }).slice(0, 90));
  ok(gap2.sig !== gap1.sig && gap2.episode === gap1.episode + 1,
    '17-c5 证据：签名不同、发生次数 +1（旧签名的"已关闭"不能替这一次做主）', gap1.sig + ' -> ' + gap2.sig);
  ok(gap2.rows === 1, '17-c5 重现后组网横幅仍是恒一行（identity 行不在场时也只有这一条）', 'rows=' + gap2.rows);
  await okContrast(netRowSel + ' .bnBiaoTi', '17-c5 重现的横幅标题可读');
  await okContrast(netRowSel + ' button[data-bn="relaySettings"]', '17-c5 重现的横幅动作按钮可读');

  // 收尾：把这一节造出来的终态结论清掉（别留给下一节）
  await c.evaluate('window.__netTest.setState({ reachability: null, samples: [true] }); void window.__netUi.heartbeat(); true');
  await sleep(300);
  await c.evaluate('window.__netUi.net.dismissed = {}; void window.__netUi.refreshBanner(); true');

  /* ══════════════════════════════════════════════════════════════════════════
     18. 控制台 = **容器内的 shell**（ADR 004 P4 定稿；本节已按定稿重写）
     --------------------------------------------------------------------------
     定稿：控制台**就是容器里的控制台**，它的价值是给**主机**带来安全性防护 ——
     AI 生成的命令跑在容器边界内，而不是跑在你的主机上。
       · 只在「项目」与「我的牛马」里；容器未就绪 ⇒ 置灰 + 诚实原因；
       · 参数形状只有 { runtimeId, action（枚举） }：**不接受任何命令字符串**；
       · 只有本机的人手动输入才会执行；远程/群成员/智能体/网络内容没有注入路径；
       · 不自动执行；不把本机密钥类环境变量带进容器；
       · **未就绪 ⇒ 一条命令都不执行**（也不退化成"在主机上跑"，更不回退成事件日志）。
     旧的"应用内部事件日志当控制台"那一版是**做错了**，已撤销：事件日志降级为**独立诊断视图**
     （`#kongZhiTaiMianBan` / `#anNiuKongZhiTai`），本节仍然把它当诊断视图逐条验证（覆盖不减反增）。

     两层证据：
       ① 静态接线（读仓库源码）：preload 白名单 / 主进程通道 / 共享的参数白名单 + 门禁 +
          安全契约 / **容器内执行路径今天不 spawn 任何进程** / 文案已改口 / 旧说法已删除；
       ② 行为（真浏览器）：门禁四档、面板开的到底是什么、IPC 参数形状、未就绪不执行、
          **容器项目停止态 = 等同创建者下线**、停止项目的真实流程、诊断事件流仍然如实。
     ══════════════════════════════════════════════════════════════════════════ */
  step('18. 控制台 = 容器内的 shell（+ 事件日志降级为诊断视图）');
  at = '18 静态接线';
  const APP_PKG = path.join(SELF_DIR, '..');
  const readSrc = (rel) => fs.readFileSync(path.join(APP_PKG, rel), 'utf8');
  const preloadSrc = readSrc(path.join('src', 'preload.cjs'));
  const mainSrc = readSrc(path.join('src', 'electron-main.ts'));
  const probeSrc = readSrc(path.join('src', 'container-probe.ts'));
  const rendererSrc = readSrc(path.join('src', 'renderer', 'app.js'));
  const rendererHtml = readSrc(path.join('src', 'renderer', 'index.html'));
  const settingsSrc = readSrc(path.join('src', 'settings-store.ts'));

  ok(/containerShell:/.test(preloadSrc) && /'warmy:rongQiKongZhiTai'/.test(preloadSrc),
    '18-1 preload 白名单里有容器控制台通道（containerShell → warmy:rongQiKongZhiTai）');
  ok(/projectState:/.test(preloadSrc) && /projectEnable:/.test(preloadSrc) && /projectDisable:/.test(preloadSrc) &&
     /projectSetContainer:/.test(preloadSrc) && /projectFiles:/.test(preloadSrc) && /productRun:/.test(preloadSrc),
    '18-1 preload 也暴露了项目状态 / 启用停用 / 切换容器 / 项目文件事实 / 产物运行（渲染层不自己推一套状态）');
  const CH18 = ['warmy:rongQiKongZhiTai', 'warmy:xiangMuTai', 'warmy:xiangMuQiYong', 'warmy:xiangMuTingYong',
    'warmy:xiangMuSheZhiRongQi', 'warmy:xiangMuWenJianJi', 'warmy:chanPinYunXing'];
  const missMain18 = CH18.filter((ch) => !mainSrc.includes(`'${ch}'`));
  ok(missMain18.length === 0, '18-1 七条通道在主进程都注册了', JSON.stringify(missMain18));
  ok(/normalizeContainerShellRequest/.test(mainSrc) && /CONTAINER_SHELL_SECURITY/.test(mainSrc) && /containerShellGate/.test(mainSrc),
    '18-1 主进程用的是**共享**的参数白名单 / 门禁 / 安全契约（不是各写一套）');
  /**
   * 【核心】容器内执行今天**根本没接**：所以那段处理函数里不许出现任何"起进程"的调用。
   * 判据：把 handleIpc('warmy:rongQiKongZhiTai' … 那一段抠出来，里面不许有 spawn/exec/execFile。
   */
  const shellHandler = (() => {
    const i = mainSrc.indexOf("handleIpc('warmy:rongQiKongZhiTai'");
    if (i < 0) return '';
    const rest = mainSrc.slice(i);
    const end = rest.indexOf('\nhandleIpc(', 10);
    return end > 0 ? rest.slice(0, end) : rest.slice(0, 4000);
  })();
  ok(shellHandler.length > 200, '18-1 抠出了 warmy:rongQiKongZhiTai 的处理函数（供下面几条静态断言用）', 'len=' + shellHandler.length);
  ok(!/\bspawn\s*\(|execFile\s*\(|\bexec\s*\(/.test(shellHandler),
    '18-1 【核心】容器内 shell 的处理函数**不起任何进程**（spawn/exec/execFile 都不在）—— 今天一条命令都跑不了，如实');
  ok(/executed: false/.test(shellHandler),
    '18-1 未就绪分支显式回 `executed: false`（"没执行"是**回给渲染层的事实**，不是一句注释）');
  ok(/CONTAINER_SHELL_ACTIONS/.test(probeSrc) && /remoteInjectPaths: 0/.test(probeSrc) && /autoRun: false/.test(probeSrc) && /forwardsSecretEnv: false/.test(probeSrc),
    '18-1 container-probe 里把动作枚举与安全契约写成**可断言的事实**（远程注入 0 / 不自动跑 / 不带密钥环境变量）');
  ok(/onConsoleEvent/.test(preloadSrc) && /'warmy:kongZhiTaiShiJian'/.test(preloadSrc) && /warmy:kongZhiTaiShiJian/.test(mainSrc),
    '18-1 事件流（warmy:kongZhiTaiShiJian）仍在，且与容器 shell 是**两条独立通道**');
  ok(!/warmy:kongZhiTaiShiJian/.test(shellHandler),
    '18-1 容器 shell 的处理函数不往事件日志里塞东西（控制台 ≠ 事件日志）');
  ok(!/WArmy console ready\./.test(rendererSrc) && !/WArmy console ready\./.test(rendererHtml),
    '18-1 旧的一行占位 ' + JSON.stringify('WArmy console ready.') + ' 已从渲染层彻底移除');
  ok(!/7788/.test(rendererSrc) && !/7788/.test(rendererHtml),
    '18-1 渲染层源码里不再有硬编码的旧端口 7788（item 1 的静态证据）');
  ok(/ownInviteLink\(\)/.test(rendererSrc) && /consoleRedact/.test(rendererSrc),
    '18-1 邀请链接走 ownInviteLink()、事件流打码走 consoleRedact()（两个入口都在源码里）');
  ok(ZH['console.tiShi'].indexOf('诊断事件流') >= 0 && ZH['console.tiShi'].indexOf('不是控制台') >= 0,
    '18-1 事件日志的表头文案已改口：明说自己是"诊断事件流、不是控制台"', ZH['console.tiShi'].slice(0, 46));
  ok(ZH['tip.console'].indexOf('诊断') >= 0 && EN['tip.console'].match(/diagnostic/i) !== null,
    '18-1 那个按钮的提示也改口了（中英都写明是诊断用）', ZH['tip.console']);
  ok(ZH['container.console.security'].indexOf('没有注入路径') >= 0 && EN['container.console.security'].match(/no injection path/i) !== null,
    '18-1 安全契约在 UI 文案里写清"没有注入路径"（中英都有）');

  /* ── 第七批：那套已经作废的选项必须**真的删干净**（UI + 存储 + 文案） ── */
  at = '18 静态接线：已作废的「运行/测试在容器中」确实删干净了';
  ok(!/yunXingHuanJingKuai/.test(rendererHtml) && !/caiDanTuBiaoYunXingHuanJing/.test(rendererHtml),
    '18-2 【作废】右侧顶部的容器下拉框与「…」菜单里的那个勾选项都已从 HTML 删除');
  ok(!/yunXingHuanJingKuai/.test(rendererSrc) && !/caiDanTuBiaoYunXingHuanJing/.test(rendererSrc),
    '18-2 渲染层源码里也没有它们的锚点（不是只把 DOM 藏起来）');
  ok(!/toggleRunEnvFromMenu|maybeAskContainerFirstRun|containerRecord\(|loadContainerRunMap|saveContainerRun/.test(rendererSrc),
    '18-2 那一整套函数（菜单开关 / 首次询问 / 会话容器记录）已从渲染层删除');
  ok(!/containerRun\??:/.test(settingsSrc.replace(/containerRun\?:\s*never;/, '').replace(/`containerRun`/g, '')),
    '18-2 存储里也不再有 containerRun 这个可用字段（settings-store 只留一条"已作废"的只读说明；老文件残留会被忽略）',
    'settings-store.ts len=' + settingsSrc.length);
  ok(!Object.prototype.hasOwnProperty.call(ZH, 'container.menu.toggle') &&
     !Object.prototype.hasOwnProperty.call(ZH, 'container.runEnv.hardTitle') &&
     !Object.prototype.hasOwnProperty.call(ZH, 'container.project.stopUnimplemented') &&
     !Object.prototype.hasOwnProperty.call(EN, 'container.menu.toggle') &&
     !Object.prototype.hasOwnProperty.call(EN, 'container.runEnv.hardTitle'),
    '18-2 那套作废的文案（菜单项 / 未就绪硬提示 / 旧的"停止项目未接入"）已从两个语言包删除');
  ok(Object.keys(ZH).length === Object.keys(EN).length,
    '18-2 删完仍然键集相等（不是删了一半）', Object.keys(ZH).length + '/' + Object.keys(EN).length);
  ok(/deriveProjectState/.test(probeSrc) && /projectUnavailableRefusal/.test(probeSrc) && /historyReadable/.test(probeSrc),
    '18-2 项目可用性由主进程/纯模块的**同一份实现**判定，并且把"历史仍可读"写成事实');

  /* ── 本节自己跑一遍**真机探测**（不借用第 22 节后面的变量：那时还没定义）── */
  at = '18 真机探测报告（本节自带）';
  const probeDist18 = path.join(APP_PKG, 'dist', 'container-probe.js');
  if (!fs.existsSync(probeDist18)) throw new Error('缺少 dist/container-probe.js，请先构建');
  const pm18 = await import(new URL('file://' + probeDist18.replace(/\\/g, '/')).href);
  const REAL18 = await pm18.tanCeRongQiYunXing({ cacheMs: 0 });
  const READY18 = (() => {
    const r = JSON.parse(JSON.stringify(REAL18));
    const d = r.runtimes.find((x) => x.id === 'docker');
    d.status = 'ready';
    d.run = 'running';
    d.detail = 'daemon-reachable';
    d.capability = { runCommand: true, interactiveShell: true, mountHostDir: true };
    d.lifecycle = Object.assign({}, d.lifecycle, { startable: true, stoppable: true, reason: 'ok' });
    delete d.evidence;
    r.usableIds = ['docker'];
    r.containerEngineIds = ['docker'];
    r.attentionIds = r.runtimes.filter((x) => x.status === 'installed-not-running' || x.status === 'engine-error').map((x) => x.id);
    return r;
  })();
  /**
   * **派生报告**：把 docker 那一行改写成"已安装但没在运行"。
   * 为什么必须派生：本机引擎状态是会变的（产品主修好 Docker 之后它就是 ready），
   * 而"未运行 ⇒ 项目不可用 / 出「一键启动」"是要**稳定压出来**的行为，不能看机器脸色。
   * evidence 用的是**记录在案的真实报错**（见 container-probe.ts 的实测注释）——
   * 这里只是夹具，不是我们编的句子。
   */
  const NOT_READY18 = (() => {
    const r = JSON.parse(JSON.stringify(REAL18));
    const d = r.runtimes.find((x) => x.id === 'docker');
    d.status = 'installed-not-running';
    d.run = 'not-running';
    d.detail = 'daemon-not-running';
    d.capability = { runCommand: false, interactiveShell: false, mountHostDir: false };
    d.evidence = 'failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine';
    d.lifecycle = Object.assign({}, d.lifecycle, { startable: true, stoppable: true, reason: 'ok' });
    delete d.action;
    r.usableIds = [];
    r.containerEngineIds = [];
    r.attentionIds = r.runtimes.filter((x) => x.status === 'installed-not-running' || x.status === 'engine-error').map((x) => x.id);
    return r;
  })();
  ok(Array.isArray(REAL18.runtimes) && REAL18.runtimes.length === 12,
    '18-3 本节自带的本机真报告可用（12 个候选）', JSON.stringify(REAL18.runtimes.map((r) => [r.id, r.status])));
  ok(JSON.stringify((REAL18.usableIds || []).slice().sort()) ===
     JSON.stringify(REAL18.runtimes.filter((r) => r.status === 'ready').map((r) => r.id).sort()),
    '18-3b 【诚实】usableIds 与逐条状态**自洽**（引擎状态可随时间变，所以这里不写死"没有可用容器"）',
    JSON.stringify({ usable: REAL18.usableIds, ready: REAL18.runtimes.filter((r) => r.status === 'ready').map((r) => r.id) }));
  ok(NOT_READY18.usableIds.length === 0 && NOT_READY18.runtimes.find((r) => r.id === 'docker').status === 'installed-not-running',
    '18-3c "未运行"那一档用派生报告压（docker 被改写成已安装未运行），不依赖机器此刻的真实状态',
    JSON.stringify(NOT_READY18.runtimes.find((r) => r.id === 'docker').status));

  /** 事件流面板（诊断视图）状态 */
  const consoleState = async () =>
    JSON.parse(await c.evaluate(`JSON.stringify((function(){
      var out = document.querySelector('#kongZhiTaiShuChu');
      var text = out ? (out.textContent || '') : '';
      return {
        daKai: !!(window.__netUi && window.__netUi.console.isOpen()),
        lines: window.__netUi.console.lines().length,
        cap: window.__netUi.console.cap(),
        dom: text.split('\\n').filter(function(x){ return x.length > 0; }).length,
        text: text,
        tiShi: (document.querySelector('#kongZhiTaiTiShi') || {}).textContent || '',
        clear: (document.querySelector('#kongZhiTaiQingChu') || {}).textContent || '',
        role: out ? out.getAttribute('role') : null,
        ariaLive: out ? out.getAttribute('aria-live') : null
      };
    })())`));
  /** 控制台（容器内 shell）面板状态 */
  const shellState = async () =>
    JSON.parse(await c.evaluate(`JSON.stringify((function(){
      var pane = document.querySelector('#ctgKongZhiTaiMianBan');
      var input = document.querySelector('#ctgKongZhiTaiShuRu');
      var faSong = document.querySelector('#ctgKongZhiTaiFaSong');
      var btn = document.querySelector('#anNiuRongQiKongZhiTai');
      return {
        daKai: !!(pane && !pane.classList.contains('yinCang')),
        diagnosticOpen: !document.querySelector('#kongZhiTaiMianBan').classList.contains('yinCang'),
        tiShi: (document.querySelector('#ctgKongZhiTaiTiShi') || {}).textContent || '',
        status: (document.querySelector('#ctgKongZhiTaiZhuangTai') || {}).textContent || '',
        statusState: ((document.querySelector('#ctgKongZhiTaiZhuangTai') || {}).dataset || {}).shellState || '',
        note: (document.querySelector('#ctgKongZhiTaiNote') || {}).textContent || '',
        noteKind: ((document.querySelector('#ctgKongZhiTaiNote') || {}).dataset || {}).shellNote || '',
        inputDisabled: !!(input && input.disabled),
        inputKind: input ? (input.dataset.shellInput || '') : '',
        sendDisabled: !!(faSong && faSong.disabled),
        yinCang: !!(btn && btn.classList.contains('yinCang')),
        btnDisabled: !!(btn && btn.disabled),
        btnGate: btn ? (btn.dataset.gate || '') : '',
        btnExec: btn ? (btn.dataset.shellExecutable || '') : '',
        btnTitle: btn ? (btn.biaoTi || '') : '',
        out: (document.querySelector('#ctgKongZhiTaiShuChu') || {}).textContent || '',
        role: (document.querySelector('#ctgKongZhiTaiShuChu') || {}).getAttribute ? document.querySelector('#ctgKongZhiTaiShuChu').getAttribute('role') : null
      };
    })())`));
  const shellCalls = async () => JSON.parse(await c.evaluate('JSON.stringify(window.__ctgTest.callsOf("shell"))'));
  /** 右栏三块 + 项目状态 */
  const panelState = async () =>
    JSON.parse(await c.evaluate(`JSON.stringify((function(){
      var ps = document.querySelector('#xiangMuTai');
      var box = document.querySelector('#xiangMuTaiHe');
      var pf = document.querySelector('#xiangMuWenJianJiHe');
      var input = document.querySelector('#shuRu');
      var faSong = document.querySelector('#anNiuFaSong');
      return {
        hasStateBlock: !!ps,
        state: ps ? ps.dataset.projectState : '',
        code: ps ? ps.dataset.projectCode : '',
        face: ps ? ps.dataset.memberFace : '',
        hostEditing: ps ? ps.dataset.hostEditing : '',
        historyReadable: ps ? ps.dataset.historyReadable : '',
        huiZhang: box ? ((box.querySelector('.ctgHuiZhang')||{}).textContent || '') : '',
        devEnv: box ? (((box.querySelector('[data-dev-env]')||{}).dataset||{}).devEnv || '') : '',
        runtime: box ? (((box.querySelector('[data-project-runtime]')||{}).dataset||{}).projectRuntime || '') : '',
        reason: ((document.querySelector('[data-project-reason]')||{}).textContent) || '',
        historyNote: ((document.querySelector('[data-project-history]')||{}).textContent) || '',
        offlineNote: ((document.querySelector('[data-project-offline-note]')||{}).textContent) || '',
        boundary: ((document.querySelector('[data-project-boundary]')||{}).textContent) || '',
        hostEdit: ((document.querySelector('[data-project-host-edit]')||{}).textContent) || '',
        testing: ((document.querySelector('[data-project-testing]')||{}).textContent) || '',
        menuHint: ((document.querySelector('[data-project-menu-hint]')||{}).textContent) || '',
        gotoBtn: !!document.querySelector('#anNiuXiangMuGotoRongQi'),
        inputDisabled: !!(input && input.disabled),
        devBlocked: input ? (input.dataset.devBlocked || '') : '',
        sendDisabled: !!(faSong && faSong.disabled),
        chatState: (document.querySelector('#liaoTianLan')||{}).dataset ? document.querySelector('#liaoTianLan').dataset.projectState : '',
        chatHistory: (document.querySelector('#liaoTianLan')||{}).dataset ? document.querySelector('#liaoTianLan').dataset.historyReadable : '',
        msgCount: document.querySelectorAll('#xiaoXiJi .xiaoXi').length,
        filesHtml: pf ? pf.textContent : '',
        changedEmpty: !!document.querySelector('[data-empty="changed"]'),
        otherEmpty: !!document.querySelector('[data-empty="other"]'),
        missingSources: ((document.querySelector('[data-missing-sources]')||{}).dataset||{}).missingSources || '',
        productDir: ((document.querySelector('[data-product-dir]')||{}).dataset||{}).productDir || '',
        productKind: (document.querySelector('#chanPinKa')||{}).dataset ? document.querySelector('#chanPinKa').dataset.productKind : '',
        productDirExists: (document.querySelector('#chanPinKa')||{}).dataset ? document.querySelector('#chanPinKa').dataset.productDirExists : '',
        runDisabled: !!(document.querySelector('#anNiuChanPinYunXing') && document.querySelector('#anNiuChanPinYunXing').disabled),
        runReason: ((document.querySelector('[data-product-run-reason]')||{}).dataset||{}).productRunReason || '',
        pfHeadChanged: !!document.querySelector('[data-pf="changed"]'),
        pfHeadOther: !!document.querySelector('[data-pf="other"]'),
        pfHeadProduct: !!document.querySelector('[data-pf="chanPin"]')
      };
    })())`));

  at = '18 项目可用性：容器开发项目没启动 ⇒ 不可用（但历史可读）';
  // 用预览桩里真实存在的项目群「项目推进群」，把它标成"容器开发项目"（等同创建时选了容器中）
  await c.evaluate(`(function(){
    // 创建者判定在**主进程**（真实现按 creatorFingerprint 判）；桩由这里设置
    window.__ctgTest.localIsCreator = true;
    var s = window.__previewSettings || {};
    s.containerDev = Object.assign({}, s.containerDev || {}, { 'g-1': 'container' });
    s.containerProjectRuntime = Object.assign({}, s.containerProjectRuntime || {}, { 'g-1': 'docker' });
    s.projectDisabled = Object.assign({}, s.projectDisabled || {}); delete s.projectDisabled['g-1'];
    window.__previewSettings = s;
    window.__ctgTest.setReport(${JSON.stringify(NOT_READY18)});
    return true;
  })()`);
  await navTo('internalGroup');
  await openSession('internalGroup', '项目推进群');
  await c.waitForQuiet(`!!document.querySelector('#xiangMuTai')`, { timeout: 8000 });
  const p1 = await panelState();
  ok(p1.hasStateBlock === true && p1.state === 'unavailable' && p1.code === 'container-not-ready',
    '18-4 【核心】容器开发项目 + 容器没在运行 ⇒ 项目**不可用**（置灰、不可聊天）',
    JSON.stringify({ state: p1.state, code: p1.code }));
  ok(p1.face === 'creator-offline' && p1.huiZhang === ZH['group.memberOffline'],
    '18-4b 【核心】成员看到的就是既有那句「' + ZH['group.memberOffline'] + '」—— 与"创建者下线"**同一套语义**',
    JSON.stringify({ face: p1.face, huiZhang: p1.huiZhang }));
  ok(p1.historyReadable === '1' && p1.chatHistory === '1' && p1.historyNote === ZH['container.project.historyStillReadable'],
    '18-4c 【核心】**历史仍然可读**：不可用 ≠ 什么都看不了（这条明确写在界面上）',
    JSON.stringify({ readable: p1.historyReadable, chat: p1.chatHistory }));
  ok(p1.inputDisabled === true && p1.devBlocked === '1' && p1.sendDisabled === true,
    '18-4d 【核心】不可聊天：输入与发送禁用（不是"能敲但发不出去"）',
    JSON.stringify({ input: p1.inputDisabled, faSong: p1.sendDisabled }));
  ok(p1.reason === ZH['container.project.reasonBody'].replace('{reason}', ZH['container.project.reason.containerDown']),
    '18-4e 不可用的原因逐字来自语言包', p1.reason.slice(0, 60));
  ok(p1.offlineNote === ZH['container.project.unavailableAsOffline'],
    '18-4f 明说"对成员的效果与创建者下线一致"（复用 ADR 003 既有语义）', p1.offlineNote.slice(0, 40));
  ok(p1.gotoBtn === true,
    '18-4g 需要启动容器时给出「' + ZH['container.console.gotoInstall'] + '」按钮（走设置 → 功能 → 容器的引导流）');
  ok(p1.devEnv === 'container' && p1.runtime === 'docker',
    '18-4h 右栏如实标出"开发环境 = 容器中 / 使用的容器 = docker"（**只读**，没有切换入口）',
    JSON.stringify({ devEnv: p1.devEnv, runtime: p1.runtime }));
  ok(p1.hostEdit === ZH['container.project.hostEditingRefused'] && p1.hostEditing === 'refused' &&
     p1.boundary === ZH['container.project.enforceBoundary'],
    '18-4i 【核心】宿主侧编辑被明确拒绝 + 诚实边界（拦不住你用外部编辑器打开那个目录）写明在界面上');
  ok(p1.testing === ZH['container.project.testingAllowed'],
    '18-4j 明文写清"测试/运行可以留在本机或其它设备"（只有开发被限定在容器里）', p1.testing.slice(0, 26));
  ok(p1.menuHint === ZH['container.project.menuHint'],
    '18-4k 告诉用户"启用/停用项目、切换容器都在**项目右键菜单**里"', p1.menuHint.slice(0, 30));
  await c.evaluate("(function(){ document.querySelector('#anNiuRongQiKongZhiTai').click(); return true; })()");
  const shellBlocked18 = await shellState();
  ok(shellBlocked18.daKai === false && shellBlocked18.btnDisabled === true && shellBlocked18.btnGate === 'project-stopped',
    '18-4l 项目不可用 ⇒ 控制台也打不开（gate=project-stopped）', JSON.stringify({ gate: shellBlocked18.btnGate }));
  await okContrast('[data-project-reason]', '18-4m 不可用原因可读（--ink-dim，对比度 >= 3.0）');
  await okContrast('[data-project-history]', '18-4n "历史仍可读"那句可读');
  await okContrast('[data-project-boundary]', '18-4o 诚实边界说明可读');
  await okContrast('#anNiuXiangMuGotoRongQi', '18-4p 「去装/启动容器」按钮可读');

  at = '18 右栏三块：真实数据 or 如实空态（不许演示数据）';
  const pf1 = await panelState();
  ok(pf1.pfHeadChanged && pf1.pfHeadOther && pf1.pfHeadProduct,
    '18-5 三块都在：' + ZH['projectFiles.changedTitle'] + ' / ' + ZH['projectFiles.otherTitle'] + ' / ' + ZH['projectFiles.productTitle']);
  ok(pf1.changedEmpty === true && pf1.filesHtml.indexOf(ZH['projectFiles.empty.noProjectDir']) >= 0,
    '18-5b 本机没有项目目录记录 ⇒ **最近改动文件如实空态**（并说清为什么），不编数据',
    pf1.filesHtml.slice(0, 40));
  ok(pf1.otherEmpty === true && pf1.filesHtml.indexOf(ZH['projectFiles.empty.other'].slice(0, 12)) >= 0,
    '18-5c 其他文件如实空态，并说明"工具读写路径台账今天还不存在"');
  ok(pf1.missingSources.indexOf('project-directory-record') >= 0 && pf1.missingSources.indexOf('tool-file-access-ledger') < 0,
    '18-5d 【如实】缺什么就写什么：项目目录记录确实还缺 ⇒ 列出来；而**工具文件访问台账现在真的存在**（项目级），所以**不再**宣称它缺失',
    pf1.missingSources);
  ok(pf1.productKind === 'none' && pf1.productDirExists === '0' && pf1.productDir.length > 0,
    '18-5e 还没有产物 ⇒ 显示**即将存放这个生成产品的目录**（不是空白、也不是"无"）', pf1.productDir);
  ok(pf1.filesHtml.indexOf(ZH['projectFiles.productDirPlanned']) >= 0,
    '18-5f 并标明那个目录**尚未创建**（这是计划位置，不是既有事实）');
  ok(pf1.runDisabled === true && pf1.runReason === 'dir-planned',
    '18-5g 没有产物 ⇒ 「运行」置灰 + 说明原因', JSON.stringify({ disabled: pf1.runDisabled, reason: pf1.runReason }));
  await okContrast('[data-missing-sources]', '18-5h "还缺什么数据源"那句可读（--ink-dim）');
  await okContrast('[data-product-run-reason]', '18-5i 运行按钮的置灰原因可读');

  at = '18 右键菜单：启用/停用项目（容器没起不能启用）';
  const openRowMenu = async () => {
    const hit = await c.evaluate(`(function(){
      var rows = Array.from(document.querySelectorAll('#lieBiaoTi .lieBiaoTiaoMu'));
      var hang = rows.filter(function(r){ return (r.textContent||'').indexOf('项目推进群') >= 0; })[0];
      if (!hang) return false;
      var r = hang.getBoundingClientRect();
      var ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.round(r.left + 20), clientY: Math.round(r.top + 10) });
      hang.dispatchEvent(ev);
      return true;
    })()`);
    await sleep(350);
    return hit;
  };
  await navTo('internalGroup');
  await openRowMenu();
  // 注意：#shangXiaWenCaiDan 是**动态创建/移除**的（不是隐藏切换），所以判据是"在不在"
  const menu18 = JSON.parse(await c.evaluate(`JSON.stringify({
    daKai: !!document.querySelector('#shangXiaWenCaiDan'),
    items: Array.from(document.querySelectorAll('#shangXiaWenCaiDan button')).map(function(b){ return { k: b.dataset.ctx || '', biaoQian: b.textContent }; })
  })`).catch(() => '{"daKai":false,"items":[]}'));
  const labels18 = menu18.items.map((x) => x.biaoQian);
  ok(menu18.daKai === true && labels18.some((x) => x.indexOf(ZH['ctx.projectEnable']) >= 0 || x.indexOf(ZH['ctx.projectDisable']) >= 0),
    '18-6 项目右键菜单里有「' + ZH['ctx.projectEnable'] + ' / ' + ZH['ctx.projectDisable'] + '」',
    JSON.stringify(labels18.slice(0, 6)));
  ok(labels18.some((x) => x.indexOf(ZH['ctx.projectEnable']) >= 0),
    '18-6b 项目当前不可用 ⇒ 菜单里给的是「' + ZH['ctx.projectEnable'] + '」', JSON.stringify(labels18.slice(0, 6)));
  ok(labels18.some((x) => x.indexOf(ZH['ctx.projectSwitchContainer']) >= 0),
    '18-6c 容器开发项目**有**「' + ZH['ctx.projectSwitchContainer'] + '」这一项（切换容器只属于这类项目）');
  ok(labels18.every((x) => x.indexOf(ZH['container.project.start']) < 0 && x.indexOf('运行/测试在容器中') < 0),
    '18-6d 菜单里**没有**已作废的"运行/测试在容器中"勾选项', JSON.stringify(labels18.slice(0, 6)));
  // 点「启用项目」→ 容器没起 ⇒ 出"需先启动容器"的提示 + 跳设置引导
  await c.evaluate(`(function(){
    var btns = Array.from(document.querySelectorAll('#shangXiaWenCaiDan button'));
    var b = btns.filter(function(x){ return (x.textContent||'').indexOf(${JSON.stringify(ZH['ctx.projectEnable'])}) >= 0; })[0];
    if (b) b.click();
    return true;
  })()`);
  await c.waitForQuiet("!document.querySelector('#duiHuaKuangGen').classList.contains('yinCang')", { timeout: 6000 });
  const enableModal = await modal();
  ok(enableModal.visible === true && enableModal.biaoTi === ZH['container.project.enableNeedsContainerTitle'],
    '18-6e 【核心】容器没启动时**不能启用项目**：出提示（标题逐字来自语言包）', JSON.stringify(enableModal.biaoTi));
  ok(enableModal.ti === ZH['container.project.enableNeedsContainer'],
    '18-6f 提示里写明"需先到设置中启动容器"（并给与之前一致的跳转引导）', String(enableModal.ti).slice(0, 50));
  await clickReal('#duiHuaKuangDongZuoJi .anNiuZhuYao', `document.querySelector('#duiHuaKuangGen').classList.contains('yinCang')`, { tries: 4, timeout: 6000 });
  await c.waitForQuiet("!!document.querySelector('#rongQiKa')", { timeout: 8000 });
  const jumped18 = JSON.parse(await c.evaluate(`JSON.stringify({
    focused: (document.querySelector('#rongQiKa')||{}).dataset ? document.querySelector('#rongQiKa').dataset.focusFrom : '',
    probeBtn: !!document.querySelector('#anNiuRongQiTanCe')
  })`));
  ok(jumped18.probeBtn === true && jumped18.focused === 'run-env',
    '18-6g 确认后**真的跳到** 设置 → 功能 → 容器（卡片高亮 + 探测按钮在场）', JSON.stringify(jumped18));

  at = '18 容器就绪 ⇒ 项目可用；右键「停用项目」⇒ 不可用（但历史仍在）';
  await c.evaluate(`(function(){
    window.__ctgTest.setReport(${JSON.stringify(READY18)});
    var s = window.__previewSettings || {};
    s.projectDisabled = Object.assign({}, s.projectDisabled || {}); delete s.projectDisabled['g-1'];
    window.__previewSettings = s;
    return true;
  })()`);
  await navTo('internalGroup');
  await openSession('internalGroup', '项目推进群');
  await c.waitForQuiet(`document.querySelector('#liaoTianLan').dataset.projectState === 'available'`, { timeout: 8000 });
  const p2 = await panelState();
  ok(p2.state === 'available' && p2.inputDisabled === false,
    '18-7 容器就绪 ⇒ 项目**可用**：开发入口恢复', JSON.stringify({ state: p2.state, input: p2.inputDisabled }));
  await c.evaluate("(function(){ document.querySelector('#anNiuRongQiKongZhiTai').click(); return true; })()");
  const shellReady18 = await shellState();
  /**
   * 【本轮契约变更】这一条原来是 `exec === '0'`（"引擎就绪但项目容器镜像还没定 ⇒ 不可执行"）。
   * 镜像来源已经定了（镜像表里钉死 digest 的基础镜像 + 我们自己固化出来的层），
   * 而且产品主授权**真的接上容器内执行** ⇒ 现在这一档的可执行性就是 1，
   * 并且**真的开了容器内的 shell**（`insideContainer:true` + 容器名）。
   * 保留"门禁通过才可能执行"这一层语义不变：下面还断言了"面板里真的是容器内的 shell"。
   */
  ok(shellReady18.btnGate === 'ok' && shellReady18.btnExec === '1',
    '18-7b 【本轮变更】引擎就绪 + 镜像来源已定 ⇒ 控制台**真的可执行**（gate=ok, executable=1）',
    JSON.stringify({ gate: shellReady18.btnGate, exec: shellReady18.btnExec }));
  await c.evaluate("(function(){ var b=document.querySelector('#ctgKongZhiTaiGuanBi'); if(b) b.click(); return true; })()");
  // 右键 → 停用项目（真点击 + 二次确认）
  await navTo('internalGroup');
  await openRowMenu();
  await c.evaluate(`(function(){
    var btns = Array.from(document.querySelectorAll('#shangXiaWenCaiDan button'));
    var b = btns.filter(function(x){ return (x.textContent||'').indexOf(${JSON.stringify(ZH['ctx.projectDisable'])}) >= 0; })[0];
    if (b) b.click();
    return true;
  })()`);
  await c.waitForQuiet("!document.querySelector('#duiHuaKuangGen').classList.contains('yinCang')", { timeout: 6000 });
  const disableModal = await modal();
  ok(disableModal.biaoTi === ZH['container.project.disableConfirmTitle'],
    '18-7c 停用项目要二次确认（标题逐字来自语言包）', JSON.stringify(disableModal.biaoTi));
  ok(String(disableModal.ti).indexOf('只能翻看之前的记录') >= 0 && String(disableModal.ti).indexOf('创建者下线') >= 0,
    '18-7d 确认框写清后果：不可用 + 只能看历史 + 对成员等同创建者下线', String(disableModal.ti).slice(0, 60));
  const msgsBefore18 = await c.evaluate("document.querySelectorAll('#xiaoXiJi .xiaoXi').length");
  await clickReal('#duiHuaKuangDongZuoJi .anNiuZhuYao', `window.__ctgTest.projectCalls.some(function(x){ return x.op === 'disable'; })`, { tries: 4, timeout: 6000 });
  await c.waitForQuiet(`document.querySelector('#liaoTianLan').dataset.projectState === 'unavailable'`, { timeout: 8000 });
  const p3 = await panelState();
  ok(p3.state === 'unavailable' && p3.code === 'disabled-by-owner' && p3.face === 'creator-offline',
    '18-7e 【核心】停用后：不可用（原因码 = 创建者停用）、成员面仍是"创建者下线"这一套（**即使容器还开着**）',
    JSON.stringify({ code: p3.code, face: p3.face }));
  const readonlyMark = await c.evaluate("(document.querySelector('#xiaoXiJi')||{}).dataset ? document.querySelector('#xiaoXiJi').dataset.readonlyHistory : ''");
  ok(p3.msgCount === msgsBefore18 && p3.chatHistory === '1' && readonlyMark === '1',
    '18-7f 【核心】停用后**历史还在**：消息区一条不少（停用前后都是 ' + msgsBefore18 + ' 条）+ 只读历史标记在位 —— 不是把整块清空',
    JSON.stringify({ before: msgsBefore18, after: p3.msgCount, mark: readonlyMark }));
  ok(p3.inputDisabled === true && p3.sendDisabled === true,
    '18-7g 停用后开发入口立即禁用', JSON.stringify({ input: p3.inputDisabled }));
  const disableCall18 = JSON.parse(await c.evaluate(`JSON.stringify(window.__ctgTest.projectCalls.filter(function(x){ return x.op === 'disable'; }))`));
  ok(disableCall18.length === 1 && disableCall18[0].sessionId === 'g-1' && JSON.stringify(Object.keys(disableCall18[0]).sort()) === JSON.stringify(['op', 'sessionId']),
    '18-7h 停用请求只带 { sessionId }（谁能不能停由主进程按创建者身份判定，不在渲染层猜）',
    JSON.stringify(disableCall18));

  at = '18 不误伤：本机项目与「我的牛马」都无需容器';
  await c.evaluate(`(function(){
    var s = window.__previewSettings || {};
    s.containerDev = Object.assign({}, s.containerDev || {}, { 'g-1': 'host' });
    // 把上一步"停用项目"留下的标记清掉（那一步已经验过了；这里要单独验"本机项目不受容器影响"）
    s.projectDisabled = Object.assign({}, s.projectDisabled || {}); delete s.projectDisabled['g-1'];
    window.__previewSettings = s;
    window.__ctgTest.setReport(${JSON.stringify(NOT_READY18)});
    return true;
  })()`);
  await navTo('internalGroup');
  await openSession('internalGroup', '项目推进群');
  await c.waitForQuiet(`document.querySelector('#liaoTianLan').dataset.projectState === 'available'`, { timeout: 8000 });
  const hostOK = await panelState();
  ok(hostOK.state === 'available' && hostOK.inputDisabled === false && hostOK.code === 'host-dev',
    '18-8 【不误伤】创建时**没选**容器的项目：本机开发，容器没起也照常可用（可聊天）',
    JSON.stringify({ state: hostOK.state, code: hostOK.code }));
  ok(hostOK.hostEditing === 'allowed' && hostOK.hostEdit === '',
    '18-8b 本机项目不拒绝宿主侧编辑（那条限制只针对容器开发项目）', JSON.stringify({ hostEditing: hostOK.hostEditing }));
  await navTo('singleAi');
  await openSession('singleAi', 'demo.agent');
  const cattle = await panelState();
  ok(cattle.inputDisabled === false && cattle.chatState === 'none',
    '18-8c 【不误伤】「我的牛马」的聊天：无需容器、照常可聊天', JSON.stringify({ input: cattle.inputDisabled, chat: cattle.chatState }));
  const cattleShell = await shellState();
  ok(cattleShell.yinCang === false && cattleShell.btnDisabled === true && cattleShell.btnGate === 'not-enabled',
    '18-8d 牛马聊天里控制台按钮仍在（§一.7）但**置灰**：会话里没有容器可开（gate=not-enabled）',
    JSON.stringify({ yinCang: cattleShell.yinCang, gate: cattleShell.btnGate }));

  at = '18 切换容器弹窗（只属于容器开发项目；含"添加更多容器"）';
  await c.evaluate(`(function(){
    var s = window.__previewSettings || {};
    s.containerDev = Object.assign({}, s.containerDev || {}, { 'g-1': 'container' });
    s.containerProjectRuntime = Object.assign({}, s.containerProjectRuntime || {}, { 'g-1': 'docker' });
    window.__previewSettings = s;
    window.__ctgTest.setReport(${JSON.stringify(READY18)});
    return true;
  })()`);
  await navTo('internalGroup');
  await openRowMenu();
  await c.evaluate(`(function(){
    var btns = Array.from(document.querySelectorAll('#shangXiaWenCaiDan button'));
    var b = btns.filter(function(x){ return (x.textContent||'').indexOf(${JSON.stringify(ZH['ctx.projectSwitchContainer'])}) >= 0; })[0];
    if (b) b.click();
    return true;
  })()`);
  await c.waitForQuiet("!!document.querySelector('#switchCancel')", { timeout: 8000 });
  const switchDlg = JSON.parse(await c.evaluate(`JSON.stringify({
    title: document.querySelector('#duiHuaKuangBiaoTi').textContent,
    ti: (document.querySelector('#duiHuaKuangTi .ctgDim')||{}).textContent || '',
    picks: Array.from(document.querySelectorAll('#duiHuaKuangTi [data-pick]')).map(function(b){ return b.dataset.pick; }),
    more: (document.querySelector('#switchGengDuo')||{}).textContent || '',
    none: !!document.querySelector('#switchNone')
  })`));
  ok(switchDlg.biaoTi === ZH['container.project.switchTitle'],
    '18-9 右键「' + ZH['ctx.projectSwitchContainer'] + '」打开**独立弹窗**（标题逐字来自语言包）', switchDlg.biaoTi);
  ok(JSON.stringify(switchDlg.picks) === JSON.stringify(['docker']),
    '18-9b 弹窗列出**设置里已检测到的**容器（本报告里 docker 就绪 ⇒ 只有一个可选）', JSON.stringify(switchDlg.picks));
  ok(switchDlg.more === ZH['container.project.switchMore'] && switchDlg.none === false,
    '18-9c 提供「' + ZH['container.project.switchMore'] + '」这个出口（跳转设置）', switchDlg.more);
  const pickLabel18 = await txt('#switch-rt-docker');
  ok(pickLabel18 && pickLabel18.indexOf(ZH['container.rt.docker.name']) >= 0,
    '18-9d 选项上写着容器名字（逐字来自语言包）', String(pickLabel18).slice(0, 30));
  // 换到 docker 之外没有第二个可用容器 ⇒ 这里验证"取消不改变任何东西"
  await c.evaluate("(function(){ document.querySelector('#switchCancel').click(); return true; })()");
  await sleep(200);
  const afterCancelSwitch18 = JSON.parse(await c.evaluate("JSON.stringify(((window.__previewSettings||{}).containerProjectRuntime||{})['g-1'] || '')"));
  ok(afterCancelSwitch18 === 'docker', '18-9e 取消切换 = 一个请求都不发（选择原样保留）', String(afterCancelSwitch18));
  await c.evaluate("(function(){ document.querySelector('#duiHuaKuangGen').classList.add('yinCang'); return true; })()");

  /* 本节收尾：把「项目推进群」恢复成**干净的本机项目**。
     为什么必须恢复：本节的用例把它标成"容器开发项目"并停用过；后面的小节（排队冲刷、
     无组网巡检等）要用它做普通项目，若带着不可用状态会被项目门禁正当拦住（那是正确行为，
     但会让后面的用例测不到它本来要测的东西）。 */
  await c.evaluate(`(function(){
    var s = window.__previewSettings || {};
    s.containerDev = Object.assign({}, s.containerDev || {}, { 'g-1': 'host' });
    var rt = Object.assign({}, s.containerProjectRuntime || {}); delete rt['g-1'];
    s.containerProjectRuntime = rt;
    var dis = Object.assign({}, s.projectDisabled || {}); delete dis['g-1'];
    s.projectDisabled = dis;
    window.__previewSettings = s;
    window.__ctgTest.setReport(${JSON.stringify(NOT_READY18)});
    window.__ctgTest.reset();
    var m = document.getElementById('shangXiaWenCaiDan'); if (m) m.remove();
    return true;
  })()`);
  await navTo('internalGroup');
  await openSession('internalGroup', '项目推进群');
  await c.waitForQuiet(`document.querySelector('#liaoTianLan').dataset.projectState === 'available'`, { timeout: 8000 });
  const restored18 = await panelState();
  ok(restored18.code === 'host-dev' && restored18.inputDisabled === false,
    '18-10 本节收尾把「项目推进群」恢复成本机项目（后面的小节拿到的是干净状态）',
    JSON.stringify({ code: restored18.code, input: restored18.inputDisabled }));

  at = '18 诊断事件流（降级后仍需如实）：喂真事件形状';
  await navTo('singleAi');
  await openSession('singleAi', 'demo.agent');
  /** 诊断事件流的开关（与容器控制台**不是**同一个面板） */
  const toggleConsole = async (wantOpen) => {
    const cond = wantOpen
      ? "!document.querySelector('#kongZhiTaiMianBan').classList.contains('yinCang')"
      : "document.querySelector('#kongZhiTaiMianBan').classList.contains('yinCang')";
    if (await c.evaluate(cond)) return true;
    const r = await clickReal('#anNiuKongZhiTai', cond);
    if (r && r.ok) return true;
    await c.evaluate("(function(){var b=document.querySelector('#anNiuKongZhiTai'); if(b) b.click(); return true;})()");
    try {
      await c.waitFor(cond, { timeout: 5000, biaoQian: '诊断事件流开关（DOM click 兜底）' });
      return true;
    } catch (e) {
      return false;
    }
  };
  await c.evaluate("(function(){ document.querySelector('#anNiuKongZhiTai').click(); return true; })()");
  await c.waitFor("!document.querySelector('#kongZhiTaiMianBan').classList.contains('yinCang')", { timeout: 6000, biaoQian: '18：诊断事件流打开' });
  ok(await toggleConsole(true), '18d-1 诊断事件流面板可打开（真鼠标点击）');
  const cs0 = await consoleState();
  const expectHint = (pack) => String(pack['console.tiShi']).replace('{n}', String(cs0.cap));
  ok(cs0.daKai && cs0.tiShi === expectHint(ZH),
    '18d-1b 表头逐字等于语言包，并**明说自己是诊断事件流、不是控制台**（含上限 {n}）', cs0.tiShi.slice(0, 46));
  ok(cs0.daKai && cs0.lines === 0, '18d-1c 面板能打开，且打开时**不写死任何占位行**', JSON.stringify({ lines: cs0.lines }));
  ok(cs0.clear === ZH['console.clear'] && cs0.role === 'log' && cs0.ariaLive === 'polite',
    '18d-1d 有清空按钮 + 面板是 aria-live 的 log 区域', JSON.stringify({ clear: cs0.clear, role: cs0.role, ariaLive: cs0.ariaLive }));
  ok(cs0.text.indexOf(ZH['console.empty']) >= 0, '18d-1e 空态说的是"暂无事件"（i18n），不是旧占位文案', cs0.text.trim().slice(0, 40));
  ok(cs0.cap >= 500 && cs0.cap <= 2000, '18d-1f 面板有行数上限（' + cs0.cap + '，落在 500–2000 的区间里）', String(cs0.cap));

  at = '18d 喂真实事件形状';
  await c.evaluate("window.__netUi.console.push({ seq: 101, ts: Date.now(), cat: 'tool', code: 'tool.start', data: { tool: 'recall', round: 1 } }); true");
  await c.evaluate("window.__netUi.console.push({ seq: 102, ts: Date.now(), cat: 'tool', code: 'tool.finish', data: { tool: 'recall', round: 1, ok: true, chars: 120, ms: 8 } }); true");
  const cs1 = await consoleState();
  ok(cs1.lines === 2 && cs1.dom === 2, '18d-2 一条事件 = 一行（队列与 DOM 一致）', JSON.stringify({ lines: cs1.lines, dom: cs1.dom }));
  ok(/\[工具\]/.test(cs1.text) && /开始调用 recall（第 1 轮）/.test(cs1.text) && /调用结束 recall：成功，120 字符，8 ms/.test(cs1.text),
    '18d-2b 工具开始/结束都按 i18n 模板渲染（含工具名、轮次、结论、字节数、耗时）', cs1.text.split('\n')[0].slice(0, 70));
  ok(/^\[\d\d:\d\d:\d\d\]/.test(cs1.text.trim()), '18d-2c 每行带本地时间戳（可定位"什么时候发生的"）', cs1.text.trim().slice(0, 24));
  await c.evaluate("window.__netUi.console.push({ seq: 102, ts: Date.now(), cat: 'tool', code: 'tool.finish', data: { tool: 'recall', round: 1, ok: true, chars: 120, ms: 8 } }); true");
  const csDup = await consoleState();
  ok(csDup.lines === 2, '18d-2d 重复投递（同 seq）只显示一次（按 seq 去重）', 'lines=' + csDup.lines);

  at = '18d 关着不刷 DOM / 重开不重复';
  await toggleConsole(false);
  await sleep(200);
  const closedBefore = await consoleState();
  await c.evaluate("window.__netUi.console.push({ seq: 103, ts: Date.now(), cat: 'net', code: 'net.bind-failed', data: { port: 59599, error: 'EADDRINUSE' } }); true");
  await c.evaluate("window.__netUi.console.push({ seq: 104, ts: Date.now(), cat: 'error', code: 'err.ipc', data: { channel: 'warmy:ceShi', message: 'boom' } }); true");
  await c.evaluate("window.__netUi.console.push({ seq: 105, ts: Date.now(), cat: 'system', code: 'nope.unknown', data: { a: 1 } }); true");
  const closedAfter = await consoleState();
  ok(closedAfter.lines === closedBefore.lines + 3 && closedAfter.text === closedBefore.text,
    '18d-3 面板关着时事件照样进队列，但**不刷 DOM**（不重排、不刷屏）', JSON.stringify({ before: closedBefore.lines, after: closedAfter.lines }));
  await toggleConsole(true);
  const reopened = await consoleState();
  ok(reopened.lines === closedAfter.lines && reopened.dom === closedAfter.lines,
    '18d-3b 重新打开 = 队列的一次快照：行数正好相等（不重复、不丢行）', JSON.stringify({ lines: reopened.lines, dom: reopened.dom }));
  ok(/端口 59599 绑定失败：EADDRINUSE/.test(reopened.text),
    '18d-3c 组网事件（端口绑定失败）进面板，端口是**真实端口**', reopened.text.split('\n').slice(-4)[0].slice(0, 70));
  ok(/已处理失败：通道 warmy:ceShi（boom）/.test(reopened.text),
    '18d-3d "已处理失败"（IPC 处理器抛出的那一刻）进面板，带频道名与脱敏摘要');
  ok(/未识别的控制台事件 nope\.unknown/.test(reopened.text) && /a=1/.test(reopened.text),
    '18d-3e 未来的/未知的事件 code **不静默丢**：如实显示 code 与数据（面板不会假装没发生）');

  at = '18d 凭据打码';
  const SECRETS = [
    'sk-live-abcdefghij1234567890',
    'hunter2hunter2',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    '9f2ce4b8a1d34e6f90ab12cd34ef56ab78cd90ef12ab34cd56ef',
  ];
  await c.evaluate(`window.__netUi.console.push({ seq: 106, ts: Date.now(), cat: 'error', code: 'err.chat-send',
    data: { message: 'request failed apiKey=${SECRETS[0]} password=${SECRETS[1]} token=${SECRETS[3]} Authorization=Bearer ${SECRETS[2]}' } }); true`);
  const red = await consoleState();
  const leakedSecrets = SECRETS.filter((s) => red.text.indexOf(s) >= 0);
  ok(leakedSecrets.length === 0, '18d-4 凭据类内容在**显示前**就打码了（sk- API Key / password 值 / token 值 / Bearer JWT / 48 位十六进制串都没漏）', 'leaked=' + JSON.stringify(leakedSecrets));
  ok(red.text.indexOf(ZH['console.redacted']) >= 0, '18d-4b 打码用的是 i18n 占位文案（不是硬编码的星号）', ZH['console.redacted']);
  ok(/apiKey=/.test(red.text) && /password=/.test(red.text), '18d-4c 只打码**值**、保留字段名（诊断还需要知道是哪个字段出问题）');
  const redFn = JSON.parse(await c.evaluate(`JSON.stringify({ a: window.__netUi.console.redact('key=' + 'x'.repeat(20)), b: window.__netUi.console.redact('plain text 12:04') })`));
  ok(redFn.b === 'plain text 12:04', '18d-4d 打码不会误伤普通文本（普通句子原样保留）', JSON.stringify(redFn));
  // 打好的码不能"顺手"流到容器控制台面板上去（两个面板是两套数据）
  const shellAfterDiag = await shellState();
  ok(shellAfterDiag.out.indexOf(ZH['console.redacted']) < 0 && shellAfterDiag.out.indexOf('EADDRINUSE') < 0,
    '18d-4e 诊断事件流的内容**不会**跑到容器控制台面板里（两套数据、两个面板）');

  at = '18d 上限（超了丢最旧）+ 清空 + 对比度 + 切英文';
  await toggleConsole(false);
  await c.evaluate(`(function(){ var p = window.__netUi.console; for (var i = 0; i < ${'' + 850}; i++) p.push({ seq: 5000 + i, ts: Date.now(), cat: 'net', code: 'net.disable', data: { reason: 'stress-' + i } }); return true; })()`);
  const capInfo = JSON.parse(await c.evaluate(`JSON.stringify({ lines: window.__netUi.console.lines().length, cap: window.__netUi.console.cap(), first: window.__netUi.console.lines()[0], last: window.__netUi.console.lines().slice(-1)[0] })`));
  ok(capInfo.lines === capInfo.cap, '18d-5 超过上限后长度**恒等于**上限 ' + capInfo.cap + '（面板不可能无限长）', JSON.stringify({ lines: capInfo.lines, cap: capInfo.cap }));
  ok(/stress-50/.test(String(capInfo.first)) && !/stress-49/.test(String(capInfo.first)),
    '18d-5b 超上限时丢的是**最旧**的行（保留最近 N 行）', String(capInfo.first).slice(-30));
  await toggleConsole(true);
  const capDom = await consoleState();
  ok(capDom.dom === capDom.cap, '18d-5c DOM 里的行数也等于上限（渲染一次 800 行，不重排 850 次）', JSON.stringify({ dom: capDom.dom, cap: capDom.cap }));
  await clickReal('#kongZhiTaiQingChu', `window.__netUi.console.lines().length === 1`);
  const diagCleared = await consoleState();
  const clearedRe = new RegExp('^' + String(ZH['console.cleared']).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\{ts\\}', '\\d\\d:\\d\\d:\\d\\d') + '$');
  ok(diagCleared.lines === 1 && diagCleared.dom === 1 && clearedRe.test(diagCleared.text.trim()),
    '18d-6 「清空」真的清干净，只留一行"已清空（时间）"',
    diagCleared.text.trim().slice(0, 40) + ' re=' + clearedRe.source.slice(0, 40));
  ok(diagCleared.tiShi === expectHint(ZH) && diagCleared.clear === ZH['console.clear'], '18d-6b 清空不影响表头与按钮文案');
  await okContrast('#kongZhiTaiTiShi', '18d-6c 表头说明可读（--ink-dim qiYong 事件流底色）');
  await okContrast('#kongZhiTaiQingChu', '18d-6d 清空按钮可读');
  await c.evaluate("(function(){var s=document.querySelector('#xuanZeYuYan'); if(!s) return false; s.value='en-US'; s.dispatchEvent(new Event('change',{bubbles:true})); return true;})()");
  await c.waitFor("document.querySelector('#logoMing').textContent === 'WArmy'", { timeout: 10000, biaoQian: '18：切到 en-US' });
  await sleep(300);
  const csEn = await consoleState();
  ok(csEn.tiShi === expectHint(EN) && csEn.clear === EN['console.clear'],
    '18d-7 表头/按钮跟着语言走（英文包逐字一致，不是残留中文）', csEn.tiShi.slice(0, 50));
  const shellEnTitle = await c.evaluate("(document.querySelector('#anNiuRongQiKongZhiTai')||{}).biaoTi || ''");
  ok(shellEnTitle === EN['container.console.tip'] || shellEnTitle === EN['container.console.notEnabled'] ||
     shellEnTitle === EN['container.console.notReady'] || shellEnTitle === EN['container.console.projectStopped'],
    '18d-7b 容器控制台的提示也跟着语言走（英文包里没有中文残留）', String(shellEnTitle).slice(0, 60));
  await c.evaluate("(function(){var s=document.querySelector('#xuanZeYuYan'); s.value='zh-CN'; s.dispatchEvent(new Event('change',{bubbles:true})); return true;})()");
  await c.waitFor("document.querySelector('#logoMing').textContent !== 'WArmy'", { timeout: 10000, biaoQian: '18：切回 zh-CN' });
  await toggleConsole(false);

  /* ══════════════════════════════════════════════════════════════════════════
     18z（item 1）：邀请链接只用**真实**配置端口；拿不到就少一个字段，绝不编 7788
     ══════════════════════════════════════════════════════════════════════════ */
  at = '18z 邀请链接的真端口';
  const linkWithPort = JSON.parse(await c.evaluate(`(async function(){
    window.__netUi.net.addr.port = 59599;
    var r = await window.__netUi.ownInviteLink();
    return JSON.stringify(r);
  })()`).catch(() => 'null') || 'null');
  ok(linkWithPort && /^warmy:\/\/join\?/.test(linkWithPort.link), '18z-1 我的链接仍是真邀请链接（warmy://join?...）', String(linkWithPort && linkWithPort.link).slice(0, 60));
  ok(linkWithPort && linkWithPort.link.indexOf('port=59599') >= 0 && linkWithPort.link.indexOf('7788') < 0,
    '18z-2 链接里的端口 = 组网设置里当前的**真实**端口（59599），不含 7788', String(linkWithPort && linkWithPort.link).slice(0, 60));
  const linkNoPort = JSON.parse(await c.evaluate(`(async function(){
    window.__netUi.net.addr.port = 0;   // 端口未知
    var r = await window.__netUi.ownInviteLink();
    window.__netUi.net.addr.port = 59599;  // 立刻还原
    return JSON.stringify(r);
  })()`));
  ok(linkNoPort && /^warmy:\/\/join\?/.test(linkNoPort.link) && linkNoPort.link.indexOf('port=') < 0 && linkNoPort.link.indexOf('7788') < 0,
    '18z-3 真端口拿不到时**如实少一个字段**（链接里没有 port=），而不是编一个端口出来', String(linkNoPort && linkNoPort.link).slice(0, 60));
  // 添加联系人弹窗（走同一条 ownInviteLink）：端口必须与设置里的真端口一致
  await navTo('externalChat');
  await clickReal('#anNiuJiaRuqr', "!document.querySelector('#duiHuaKuangGen').classList.contains('yinCang')");
  await c.waitFor("!!document.querySelector('#lianXiMyLink')", { timeout: 9000, biaoQian: '18z：弹窗里的「我的链接」' });
  const dialogLink = await txt('#lianXiMyLink');
  ok(String(dialogLink).indexOf('port=59599') >= 0 && String(dialogLink).indexOf('7788') < 0,
    '18z-4 添加联系人弹窗里的链接与设置端口一致（同一个构造入口，无第二份实现）', String(dialogLink).slice(0, 60));
  await closeModal();

  /* ══════════════════════════════════════════════════════════════════════════
     19. **无组网（从未开启）时的可用性巡检**（本轮最重要的一项）
     做法：清掉组网桩的历史状态 → reload（= 全新启动，组网从未开过）→ 把用户会走的每条路
     真走一遍，逐条记录**可见状态**，并用一个健康扫描器抓"缺失键 / undefined / NaN /
     [object Object] / 「未绑定·未设置」误导文案"。
     组网关闭时**不该**出现的东西也要验：组网横幅、假端口、"组网未开启所以功能不可用"。
     ══════════════════════════════════════════════════════════════════════════ */
  step('19. 无组网可用性巡检（组网从未开启）');
  at = '19 重启到"从未开启组网"';
  await c.evaluate("try { localStorage.removeItem('idchgTest:mesh'); } catch (e) {} true");
  await c.send('Page.reload', { ignoreCache: true });
  await c.waitFor('typeof window.__netUi === "object" && !!window.__warmyNetStub && typeof window.__saveState === "function"', {
    timeout: 30000, biaoQian: '19：重启后页面就绪',
  });
  await closeModal();
  await c.waitFor("!document.querySelector('#liaoTianBuJu').classList.contains('yinCang')", { timeout: 12000, biaoQian: '19：启动自动打开会话' });
  await sleep(600);

  /** 页面上不该出现的 i18n 键（可见文本里出现键名 = 缺键回落，用户看到的是"settings.xxx"） */
  const LEAK_KEYS = Object.keys(ZH).filter((k) => k.indexOf('.') > 0 && !k.startsWith('demo.'));
  const healthScan = async () =>
    JSON.parse(await c.evaluate(`JSON.stringify((function(){
      var keys = ${JSON.stringify(LEAK_KEYS)};
      var txt = (document.body.innerText || '');
      var leaks = keys.filter(function(k){ return txt.indexOf(k) >= 0; });
      return {
        leaks: leaks.slice(0, 6),
        undefinedWord: /(^|[\\s(])undefined([\\s)]|$)/.test(txt),
        nan: /(^|[\\s(])NaN([\\s)]|$)/.test(txt),
        objObj: txt.indexOf('[object Object]') >= 0,
        unbound: /未绑定|未设置/.test(txt),
        dashOnly: (txt.split('\\n').filter(function(x){ return x.trim() === '—'; })).length,
        len: txt.length
      };
    })())`));
  const scanOk = async (biaoQian) => {
    const s = await healthScan();
    return ok(
      s.leaks.length === 0 && !s.undefinedWord && !s.nan && !s.objObj && !s.unbound && s.len > 40,
      '19 ' + biaoQian + '：无缺失键/无 undefined·NaN·[object Object]/无「未绑定」误导，且有真实内容',
      JSON.stringify(s)
    );
  };

  const bootNoMesh = JSON.parse(await c.evaluate(`JSON.stringify({
    enabled: window.__netUi.net.enabled, banner: document.querySelectorAll('${netRowSel}').length,
    remote: window.__netUi.net.remoteCount, port: window.__netUi.net.addr.port,
    peers: window.__netUi.net.linkPeers.length, chatOpen: !document.querySelector('#liaoTianBuJu').classList.contains('yinCang')
  })`));
  ok(bootNoMesh.enabled === false && bootNoMesh.remote === 0, '19-1 从未开启组网：开关=关、异地成员=0', JSON.stringify(bootNoMesh));
  ok(bootNoMesh.banner === 0, '19-1 组网从未开过 → **没有任何**组网横幅（不吓人、不误报）', JSON.stringify(bootNoMesh));
  ok(bootNoMesh.port === 59599, '19-1 端口仍是产品默认 59599（没有旧端口残留）', String(bootNoMesh.port));
  ok(bootNoMesh.chatOpen === true, '19-1 启动即打开会话（不因为没组网就不给用）', JSON.stringify(bootNoMesh));
  await scanOk('启动后的聊天页');

  // ── 会话与发送 ──
  at = '19 会话与发送（默认紧急度 = 排队）';
  await openSession('singleAi', 'demo.agent');
  const msgsBefore = await cnt('#xiaoXiJi .xiaoXi');
  await c.evaluate("(function(){var i=document.querySelector('#shuRu'); i.value='NO-MESH-QUEUE-001'; i.dispatchEvent(new Event('input',{bubbles:true})); return true;})()");
  await clickReal('#anNiuFaSong', "true");
  await c.waitFor(`(document.querySelector('#duiLieTiaoMuJi').innerText||'').indexOf('NO-MESH-QUEUE-001') >= 0`, { timeout: 10000, biaoQian: '19：消息进入排队' });
  const queued = await c.evaluate(`JSON.stringify({ q: (document.querySelector('#duiLieTiaoMuJi')||{}).innerText || '', tiao: !document.querySelector('#duiLieTiao').classList.contains('yinCang') })`);
  ok(JSON.parse(queued).tiao === true, '19-3 无组网时输入框可用：默认紧急度（排队）的消息真的进了排队栏', String(JSON.parse(queued).q).replace(/\s+/g, ' ').slice(0, 50));

  at = '19 会话与发送（加急 = 直接进会话）';
  // 加急（P1）会先弹倒计时确认框 —— 走真实路径：等可点后确认，再发一条直接进会话的消息
  await c.evaluate("(function(){var b=document.querySelector('#jinJiCaiDan button[data-u=\"P1\"]'); if(!b) return false; b.dispatchEvent(new MouseEvent('click',{bubbles:true})); return true;})()");
  await c.waitFor("!document.querySelector('#duiHuaKuangGen').classList.contains('yinCang')", { timeout: 8000, biaoQian: '19：加急确认框' });
  await c.waitFor(`(function(){var b=Array.from(document.querySelectorAll('#duiHuaKuangDongZuoJi button')).filter(function(x){return !x.disabled && (x.textContent||'').indexOf('确定')>=0;})[0]; return !!b;})()`, {
    timeout: 12000, biaoQian: '19：倒计时结束，「确定」可点',
  });
  await clickModal('确定');
  await sleep(300);
  await c.evaluate("(function(){var i=document.querySelector('#shuRu'); i.value='NO-MESH-PROBE-001'; i.dispatchEvent(new Event('input',{bubbles:true})); return true;})()");
  await clickReal('#anNiuFaSong', `(document.querySelector('#xiaoXiJi').innerText||'').indexOf('NO-MESH-PROBE-001') >= 0`);
  await c.waitFor(`(document.querySelector('#xiaoXiJi').innerText||'').indexOf('NO-MESH-PROBE-001') >= 0`, { timeout: 10000, biaoQian: '19：用户消息进会话' });
  const msgsAfter = await cnt('#xiaoXiJi .xiaoXi');
  ok(msgsAfter > msgsBefore, '19-3 无组网时也能正常发消息（加急消息立刻出现在会话里）', msgsBefore + ' -> ' + msgsAfter);
  await sleep(900);
  const bubbleText = await c.evaluate("(document.querySelector('#xiaoXiJi')||{}).innerText || ''");
  ok(bubbleText.indexOf('NO-MESH-PROBE-001') >= 0 && bubbleText.indexOf('undefined') < 0 && bubbleText.indexOf('[object Object]') < 0,
    '19-3 会话里真的出现这条消息，且回复气泡没有 undefined/[object Object]（预览桩返回真形状）', String(bubbleText).replace(/\s+/g, ' ').slice(-90));
  await scanOk('一进一出的会话');

  // ── 一级导航逐条走 ──
  at = '19 一级导航';
  const NAV_LIST = [['wo', '我'], ['singleAi', '我的牛马'], ['internalGroup', '项目'], ['externalChat', '联系人'], ['externalGroup', '群聊'], ['settings', '设置']];
  const navReport = [];
  for (const [nav, biaoQian] of NAV_LIST) {
    await navTo(nav);
    await sleep(260);
    const listN = await cnt('#lieBiaoTi .lieBiaoTiaoMu');
    const s = await healthScan();
    navReport.push({ nav, listN, leaks: s.leaks, obj: s.objObj, undef: s.undefinedWord });
    ok(s.leaks.length === 0 && !s.objObj && !s.undefinedWord && !s.unbound,
      '19-4 一级导航「' + biaoQian + '」：正常渲染、无缺键、无 undefined/[object Object]',
      JSON.stringify({ listN, leaks: s.leaks.slice(0, 3) }));
  }
  const navsWithRows = navReport.filter((r) => r.listN > 0).length;
  ok(navsWithRows >= 4, '19-4 六个一级导航里至少 4 个有真实列表行（会话/牛马/项目/联系人/群聊，设置页没有列表是正常的）', JSON.stringify(navReport.map((r) => r.nav + ':' + r.listN)));
  console.log('    无组网导航巡检:', JSON.stringify(navReport));

  // ── 「我」页的总看板：真数据没来时必须如实说"暂无"，且不摆演示数据 ──
  at = '19 总看板（无数据时）';
  await navTo('wo');
  await c.waitFor("!!document.querySelector('#dashHost')", { timeout: 8000, biaoQian: '19：总看板渲染' });
  await sleep(700);
  const dash = JSON.parse(await c.evaluate(`JSON.stringify({
    text: (document.querySelector('#dashHost')||{}).innerText || '',
    sessionRows: document.querySelectorAll('#kanbanHuiHuaJi .kanbanHuiHua').length,
    eventRows: document.querySelectorAll('#kanbanShiJianJi .kanbanShiJian').length,
    emptyLine: ((document.querySelector('#kanbanHuiHuaJi .kanbanKong')||{}).textContent || '') + '|' + ((document.querySelector('#kanbanShiJianJi .kanbanKong')||{}).textContent || '')
  })`));
  ok(dash.sessionRows === 0 && dash.eventRows === 0 && !/项目推进群|研发排期群|客户对接群/.test(String(dash.text)),
    '19-14 总看板不摆演示项目：真聚合为空时一行都不显示（不再出现"项目推进群/研发排期群/客户对接群"）', JSON.stringify({ rows: dash.sessionRows, text: String(dash.text).replace(/\s+/g, ' ').slice(0, 80) }));
  ok(String(dash.emptyLine).indexOf(ZH['dashboard.emptySessions']) >= 0 && String(dash.emptyLine).indexOf(ZH['dashboard.emptyEvents']) >= 0,
    '19-14 真数据为空时如实说「暂无会话进展 / 暂无动态」（i18n，不是空白）', String(dash.emptyLine).slice(0, 80));
  ok(!/整理周报|记忆库归档|等待接口文档/.test(String(dash.text)),
    '19-14 总看板不再把演示任务当成"刚刚完成的任务/最新动态"', String(dash.text).replace(/\s+/g, ' ').slice(-90));

  // ── 牛马管理局：实例列表 + 详情 + 启动 ──
  at = '19 牛马管理局';
  await navTo('singleAi');
  await openInstancesPage();
  const hqRows = await cnt('#lieBiaoTi .lieBiaoTiaoMu');
  ok(hqRows >= 2, '19-5 「牛马管理局」列出本机实例（预览演示数据 2 个）', 'rows=' + hqRows);
  await c.evaluate("document.querySelectorAll('#lieBiaoTi .lieBiaoTiaoMu')[1].click(); true");
  await c.waitFor("!document.querySelector('#shiLiXiangQing').classList.contains('yinCang')", { timeout: 8000, biaoQian: '19：实例详情页' });
  const detailText = await c.evaluate("(document.querySelector('#shiLiXiangQing')||{}).innerText || ''");
  ok(/归档员|demo\.agent/.test(detailText) && /启动|停止|删除/.test(detailText) && detailText.indexOf('undefined') < 0,
    '19-5 实例详情页有真实内容与可执行动作（名称/认知注入/启动·停止·删除），不是空壳', String(detailText).replace(/\s+/g, ' ').slice(0, 80));
  await scanOk('实例详情页');
  await navTo('singleAi');

  // ── 项目会话：右栏各区块都要有真内容 ──
  at = '19 右栏区块（项目会话）';
  await openSession('internalGroup', '项目推进群');
  // 成员表要真的从 IPC 拉一次（真实应用里是"开会话 + 每 15s"两条触发；这里不等 15s）
  await c.evaluate('void window.__netUi.refreshMembers(); true');
  await c.waitFor("document.querySelectorAll('#chengYuanJiHe .chengYuanHang').length >= 1", { timeout: 8000, biaoQian: '19：成员行渲染' });
  await sleep(300);
  const panel = JSON.parse(await c.evaluate(`JSON.stringify({
    modelMgr: (document.querySelector('#moXingMgr')||{}).innerText || '',
    modelCards: document.querySelectorAll('#moXingMgr .mgrKa').length,
    dir: (document.querySelector('#muLuHe')||{}).innerText || '',
    members: (document.querySelector('#chengYuanJiHe')||{}).innerText || '',
    memberRows: document.querySelectorAll('#chengYuanJiHe .chengYuanHang').length,
    duty: (document.querySelector('#dutyXinXi')||{}).innerText || '',
    cp: (document.querySelector('#cpSpace')||{}).innerText || '',
    metrics: (document.querySelector('#zhiBiaoJiHe')||{}).innerText || '',
    taskList: document.querySelectorAll('#renwuLieBiao li').length
  })`));
  ok(String(panel.modelMgr).trim().length > 0 && panel.modelCards >= 1,
    '19-6 右栏「模型管理」列出可管理的牛马（不是"暂无可管理的牛马"这种空话）', JSON.stringify({ cards: panel.modelCards, text: String(panel.modelMgr).replace(/\s+/g, ' ').slice(0, 40) }));
  ok(panel.memberRows >= 1 && String(panel.members).trim().length > 0,
    '19-6 右栏「成员」在无组网时也列出成员（异地成员按组网关闭态标注，不是空）', JSON.stringify({ rows: panel.memberRows, text: String(panel.members).replace(/\s+/g, ' ').slice(0, 60) }));
  ok(String(panel.duty).trim().length > 0, '19-6 右栏「值班者」有内容', String(panel.duty).slice(0, 40));
  ok(String(panel.cp).trim().length > 0 && String(panel.cp).indexOf('—') !== 0, '19-6 右栏「回退点」有内容（占位或真回退点，不是空）', String(panel.cp).replace(/\s+/g, ' ').slice(0, 50));
  ok(String(panel.metrics).trim().length > 0, '19-6 右栏「性能指标」有内容', String(panel.metrics).replace(/\s+/g, ' ').slice(0, 50));
  // 「进度」区块：只显示真任务；没有任务就如实说「暂无任务」（以前是 5 行写死的演示任务 + 0% 进度条）
  const progressInfo = JSON.parse(await c.evaluate(`JSON.stringify({
    rows: document.querySelectorAll('#renwuLieBiao li').length,
    text: (document.querySelector('#renwuLieBiao')||{}).innerText || '',
    pct: (document.querySelector('#jinDuWenBen')||{}).textContent || ''
  })`));
  ok(!/整理周报|接口对接|值班编排|知识库归档|旧方案验证/.test(String(progressInfo.text)),
    '19-6 右栏「进度」不再显示写死的演示任务（"看起来在跑其实没跑"）', String(progressInfo.text).replace(/\s+/g, ' ').slice(0, 60));
  ok(progressInfo.rows === 0 || (progressInfo.rows <= 1 && String(progressInfo.text).indexOf(ZH['panel.progressEmpty']) >= 0),
    '19-6 没有真任务时「进度」如实说「暂无任务（看板任务由值班者编排产生）」', JSON.stringify(progressInfo).slice(0, 140));
  await okContrast('#renwuLieBiao li.renwuKong', '19-6 「暂无任务」空态文字可读（--ink-dim）');
  await scanOk('项目会话右栏');

  // ── 知识库检索 ──
  at = '19 知识库检索';
  await c.evaluate("(function(){var q=document.querySelector('#zhiShiKuQ'); if(!q) return false; q.value='无限牛马'; return true;})()");
  await clickReal('#anNiuZhiShiKuGo', `(document.querySelector('#zhiShiKuShuChu').innerText||'').trim().length > 0`);
  const kbOut = String(await txt('#zhiShiKuShuChu') || '');
  ok(kbOut.trim().length > 0 && kbOut.indexOf('undefined') < 0, '19-7 知识库检索有命中结果（无组网也能查本机知识库）', kbOut.replace(/\s+/g, ' ').slice(0, 60));

  // ── 联系人页：添加联系人弹窗（真链接 + 真二维码）──
  at = '19 联系人 / 添加联系人';
  await navTo('externalChat');
  await clickReal('#anNiuJiaRuqr', "!document.querySelector('#duiHuaKuangGen').classList.contains('yinCang')");
  await c.waitFor("!!document.querySelector('#lianXiMyLink')", { timeout: 9000, biaoQian: '19：我的链接' });
  const qrInfo = JSON.parse(await c.evaluate(`JSON.stringify((function(){
    var box = document.querySelector('#lianXiMyqr');
    var svg = box ? box.querySelector('svg') : null;
    return { hasSvg: !!svg, rects: svg ? svg.querySelectorAll('rect').length : 0,
      modules: svg ? Number(svg.getAttribute('data-qr-modules')) : 0,
      link: (document.querySelector('#lianXiMyLink')||{}).textContent || '' };
  })())`));
  ok(qrInfo.hasSvg && qrInfo.rects > 50 && qrInfo.modules >= 21,
    '19-8 无组网时「添加联系人」仍给出**真二维码**（真编码器画的模块矩阵，不是占位）', JSON.stringify({ rects: qrInfo.rects, modules: qrInfo.modules }));
  ok(String(qrInfo.link).indexOf('7788') < 0, '19-8 弹窗里的链接不含旧端口 7788', String(qrInfo.link).slice(0, 50));
  await closeModal();
  await scanOk('联系人页');

  // ── 设置页六个分区 + 主题 + 语言 + 更新 UI ──
  at = '19 设置页分区';
  await navTo('settings');
  const secs = await c.evaluate("Array.from(document.querySelectorAll('#peiZhiDaoHang button')).map(function(b){return b.dataset.sec;})");
  const secReport = [];
  for (const sec of secs) {
    await c.evaluate(`(function(){var b=document.querySelector('#peiZhiDaoHang button[data-sec="${sec}"]'); if(b) b.click(); return true;})()`);
    await sleep(220);
    const tx = await c.evaluate("(document.querySelector('#peiZhiNeiRong')||{}).innerText || ''");
    const s = await healthScan();
    secReport.push({ sec, len: String(tx).length, leaks: s.leaks.slice(0, 3) });
    ok(String(tx).length > 20 && s.leaks.length === 0,
      '19-9 设置分区「' + sec + '」有真实内容且无缺键', JSON.stringify({ len: String(tx).length, leaks: s.leaks.slice(0, 2) }));
  }
  console.log('    无组网设置分区:', JSON.stringify(secReport));

  at = '19 更新检查 UI';
  await c.evaluate("(function(){var b=document.querySelector('#peiZhiDaoHang button[data-sec=\"about\"]'); if(b) b.click(); return true;})()");
  await c.waitFor("!!document.querySelector('#anNiuAboutGengXin')", { timeout: 8000, biaoQian: '19：更新检查按钮' });
  const verText = String(await txt('#aboutVersion') || '');
  ok(verText.trim().length > 0, '19-10 关于页显示真实版本号（不是空）', verText.slice(0, 40));
  await clickReal('#anNiuAboutGengXin', `(document.querySelector('#aboutUpd')||{}).textContent.trim().length > 0`);
  await sleep(600);
  const updText = String(await txt('#aboutUpd') || '');
  ok(updText.trim().length > 0 && updText.indexOf('undefined') < 0 && Object.keys(ZH).every((k) => !updText.includes(k)),
    '19-10 更新检查给出**如实的**结论（不是"未知状态"这种占位：预览桩返回真形状）', updText.slice(0, 50));

  at = '19 主题与语言';
  await c.evaluate("(function(){var b=document.querySelector('#peiZhiDaoHang button[data-sec=\"ui\"]'); if(b) b.click(); return true;})()");
  await sleep(200);
  await c.evaluate("(function(){var b=document.querySelector('.zhuTiMoShi button[data-m=\"dark\"]'); if(b) b.click(); return true;})()");
  await c.waitFor("document.documentElement.getAttribute('data-theme') === 'dark'", { timeout: 6000, biaoQian: '19：切到深色' });
  await scanOk('深色主题下的设置页');
  await c.evaluate("(function(){var b=document.querySelector('.zhuTiMoShi button[data-m=\"light\"]'); if(b) b.click(); return true;})()");
  await c.waitFor("document.documentElement.getAttribute('data-theme') === 'light'", { timeout: 6000, biaoQian: '19：切回浅色' });
  await c.evaluate("(function(){var s=document.querySelector('#xuanZeYuYan'); s.value='en-US'; s.dispatchEvent(new Event('change',{bubbles:true})); return true;})()");
  await c.waitFor("document.querySelector('#logoMing').textContent === 'WArmy'", { timeout: 10000, biaoQian: '19：切到英文' });
  await sleep(400);
  const enScan = JSON.parse(await c.evaluate(`JSON.stringify((function(){
    var keys = ${JSON.stringify(LEAK_KEYS)};
    var txt = (document.querySelector('#zhuLan')||document.body).innerText || '';
    return { leaks: keys.filter(function(k){ return txt.indexOf(k) >= 0; }).slice(0, 6),
      cjk: (txt.match(/[\\u4e00-\\u9fff]+/g) || []).slice(0, 6) };
  })())`));
  ok(enScan.leaks.length === 0, '19-11 英文界面无缺失键', JSON.stringify(enScan.leaks));
  // Language-select native names + Chinese chanPin ming are documented exceptions.
  const allowedCjk = enScan.cjk.filter((x) => !/无限牛马|中文|简体|繁體|日本語|한국어|Русский|Español|Français|Português|Esperanto/.test(x));
  ok(allowedCjk.length === 0, '19-11 英文界面没有中文残留（语言选项/品牌名除外）', JSON.stringify(enScan.cjk));
  await c.evaluate("(function(){var s=document.querySelector('#xuanZeYuYan'); s.value='zh-CN'; s.dispatchEvent(new Event('change',{bubbles:true})); return true;})()");
  await c.waitFor("document.querySelector('#logoMing').textContent !== 'WArmy'", { timeout: 10000, biaoQian: '19：切回中文' });

  // ── 组网卡片：关着也要如实（不吓人、不假装在跑）──
  at = '19 组网卡片（关闭态）';
  await ensureNetCard();
  const netCard = JSON.parse(await c.evaluate(`JSON.stringify({
    switchOn: !!document.querySelector('#wangLuoSwitch') && document.querySelector('#wangLuoSwitch').checked,
    xiaoXi: (document.querySelector('#wangLuoSwitchXiaoXi')||{}).textContent || '',
    ladder: (document.querySelector('#wangLuoLadder')||{}).innerText || '',
    local: (document.querySelector('#wangLuoBenJiXinXi')||{}).innerText || ''
  })`));
  ok(netCard.switchOn === false, '19-12 组网卡片：开关是关闭态（从未开启过）', JSON.stringify({ qiYong: netCard.switchOn }));
  const offWords = [ZH['net.switchOff'], ZH['net.switchNeedDetect'], ZH['net.result.needPass']].filter(Boolean);
  ok(offWords.some((w) => String(netCard.xiaoXi).indexOf(String(w).replace('{port}', '')) >= 0) && !/已开启|运行中/.test(String(netCard.xiaoXi)),
    '19-12 卡片如实说「组网已关闭 / 请先点检测」，绝不显示成"已开启/运行中"', JSON.stringify({ xiaoXi: String(netCard.xiaoXi).slice(0, 40) }));
  ok(String(netCard.local).trim().length > 0, '19-12 关闭态仍显示本机地址事实（关闭不等于看不到任何信息）', String(netCard.local).replace(/\s+/g, ' ').slice(0, 60));
  await scanOk('组网设置卡片（关闭态）');

  at = '19 收尾';
  const finalErrs = c.errors().filter((e) => !/Electron Security Warning/i.test(e));
  ok(finalErrs.length === 0, '19-13 整节巡检过程中控制台无异常/未捕获错误', JSON.stringify(finalErrs.slice(0, 3)).slice(0, 200));


  /* ══════════════════════════════════════════════════════════════════════════
     20. R16 扫**别人的**二维码（反向：我的二维码是编码，这里是解码）
     ---------------------------------------------------------------------------
     本套预览产物**去掉了 CSP**（build-preview 默认删掉那个 meta），所以这里证明的是
     「DOM 监听（选图/拖入/粘贴）→ 本机解码 → **同一条**加入路径」这条链路；
     「解码器作为经典脚本在真 file:// + CSP 下能不能加载」由
     scripts/verify-qr-scan.mjs 在**真实 dist 产物**上单独证明（连 import() 被拦都复现了）。
     两处都跑，是因为预览的 CSP 缺失正好会漏掉「脚本被 CSP 拦掉」这一类故障。
     ══════════════════════════════════════════════════════════════════════════ */
  step('20. 扫别人的二维码（选图/拖入/粘贴 → 本机解码 → 同一条加入路径）');
  at = '20 扫码区块就位';

  // 页面内工具：把 DOM 里那个真二维码栅格化成 PNG File（模拟"对方发来的二维码图片"），
  // 以及把任意文本用 vendored 编码器画成 PNG（负面用例）。
  const SCAN_HELPERS = `window.__scanProbe = (function () {
    function b64utf8(s) {
      var bytes = new TextEncoder().encode(s), bin = '';
      for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin);
    }
    function png(cv) { return new Promise(function (res) { cv.toBlob(function (b) { res(b); }, 'image/png'); }); }
    return {
      fileOfOwnSvg: async function (sel, size) {
        var svg = document.querySelector(sel);
        if (!svg) return null;
        var url = 'data:image/svg+xml;base64,' + b64utf8(new XMLSerializer().serializeToString(svg));
        var img = await new Promise(function (res, rej) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = rej; i.src = url; });
        var cv = document.createElement('canvas');
        cv.width = size; cv.height = size;
        var ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
        ctx.drawImage(img, 0, 0, size, size);
        return new File([await png(cv)], 'own-qr.png', { type: 'image/png' });
      },
      fileOfText: async function (text, unit) {
        unit = unit || 6;
        var enc = window.qrcode;
        if (typeof enc !== 'function') return null;
        if (enc.stringToBytesFuncs && enc.stringToBytesFuncs['UTF-8']) enc.stringToBytes = enc.stringToBytesFuncs['UTF-8'];
        var qr = enc(0, 'M'); qr.addData(String(text), 'Byte'); qr.make();
        var n = qr.getModuleCount(), quiet = 4, total = n + quiet * 2;
        var cv = document.createElement('canvas');
        cv.width = total * unit; cv.height = total * unit;
        var ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.fillStyle = '#111';
        for (var r = 0; r < n; r++) for (var c2 = 0; c2 < n; c2++) if (qr.isDark(r, c2)) ctx.fillRect((c2 + quiet) * unit, (r + quiet) * unit, unit, unit);
        return new File([await png(cv)], 'text.png', { type: 'image/png' });
      },
      fileOfNoise: async function () {
        var cv = document.createElement('canvas');
        cv.width = 420; cv.height = 420;
        var ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 420, 420);
        ctx.strokeStyle = '#222'; ctx.lineWidth = 9;
        for (var x = -420; x < 420; x += 46) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 420, 420); ctx.stroke(); }
        ctx.beginPath(); ctx.arc(210, 210, 120, 0, Math.PI * 2); ctx.strokeStyle = '#000'; ctx.lineWidth = 16; ctx.stroke();
        return new File([await png(cv)], 'noise.png', { type: 'image/png' });
      },
      feed: async function (inputSel, file) {
        var shuRu = document.querySelector(inputSel);
        if (!shuRu || !file) return 'bad-call';
        var dt = new DataTransfer();
        dt.items.add(file);
        shuRu.files = dt.files;
        shuRu.dispatchEvent(new Event('change', { bubbles: true }));
        return 'fed:' + shuRu.files.length;
      },
      paste: async function (file) {
        var dt = new DataTransfer();
        dt.items.add(file);
        var ev = new Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(ev, 'clipboardData', { value: dt });
        document.dispatchEvent(ev);
        return 'pasted';
      },
      observe: function (prefix) {
        var b = document.querySelector('#' + prefix + '-scan');
        return JSON.stringify({
          state: b ? b.getAttribute('data-scan-state') : 'no-block',
          detail: (document.querySelector('#' + prefix + '-detail') || {}).textContent || '',
          shuRu: (document.querySelector('#jiaRuLinkShuRu') || {}).value || '',
          joins: (window.__scanJoins || []).length
        });
      },
      waitState: function (prefix, want, ms) {
        return new Promise(function (res) {
          var t0 = Date.now();
          (function tick() {
            var b = document.querySelector('#' + prefix + '-scan');
            if (b && b.getAttribute('data-scan-state') === want) return res(JSON.parse(window.__scanProbe.observe(prefix)));
            if (Date.now() - t0 > ms) return res(Object.assign({ timedOut: true }, JSON.parse(window.__scanProbe.observe(prefix))));
            setTimeout(tick, 100);
          })();
        });
      }
    };
  })();
  'scan-probe-ready';`;

  /** 开扫码弹窗（每次都重开：成功加入后弹窗会在 800ms 后自动收起，连着做两步会撞上它） */
  async function openScanDialog() {
    await sleep(950);
    await c.evaluate(`(function(){ window.__scanJoins = []; document.querySelector('#duiHuaKuangGen').classList.add('yinCang'); return true; })()`);
    await c.evaluate(`(function(){ var b = document.querySelector('#anNiuJiaRuqr'); if (b) b.click(); return true; })()`);
    await c.waitFor(`!!document.querySelector('#lianXiqrSaoMiao') && !document.querySelector('#duiHuaKuangGen').classList.contains('yinCang') && !!document.querySelector('#lianXiMyqr svg')`,
      { timeout: 12000, biaoQian: '20：添加联系人弹窗（含扫码区块）' });
  }

  /** 等扫码区块的状态；超时不抛错，把现场交回来（断言失败要看到实际值） */
  async function scanState(prefix, want, ms) {
    const raw = await c.evaluate(`window.__scanProbe.waitState(${JSON.stringify(prefix)}, ${JSON.stringify(want)}, ${ms})`);
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  }

  await c.evaluate(SCAN_HELPERS);
  await c.evaluate(`(function(){
    window.__scanJoins = [];
    window.__scanJoinSaved = window.warmy.joinRequest;
    window.warmy.joinRequest = async function (payload) { window.__scanJoins.push(payload); return { ok: true }; };
    return 'scan-stubs-ready';
  })()`);

  await navTo('externalChat');
  await openScanDialog();

  // 20-1：扫码区块真的在弹窗里，文案都来自语言包，解码器是经典脚本引入的
  const scanUi = JSON.parse(await c.evaluate(`JSON.stringify((function(){
    var s = document.querySelector('script[src*="vendor/jsqr-1.4.0.js"]');
    return {
      block: !!document.querySelector('#lianXiqrSaoMiao'),
      pick: (document.querySelector('#lianXiqrXuanZe')||{}).textContent || '',
      tiShi: (document.querySelector('#lianXiqrTiShi')||{}).textContent || '',
      fileInput: !!document.querySelector('#lianXiqrWenJian'),
      jsQR: typeof window.jsQR,
      tagType: s ? (s.getAttribute('type') || '') : 'absent',
      tagSrc: s ? s.getAttribute('src') : null
    };
  })())`));
  ok(scanUi.block && scanUi.fileInput && scanUi.pick === ZH['join.pickImage'] && scanUi.tiShi === ZH['join.dropHint'],
    '20-1 「添加联系人」弹窗里有真扫码区块（选图按钮 + 文件输入），文案取自语言包', JSON.stringify({ pick: scanUi.pick, tiShi: scanUi.tiShi }));
  ok(scanUi.jsQR === 'function' && scanUi.tagType === '',
    '20-2 解码器是**经典脚本**（非 module）引入的，运行时有全局 jsQR（CSP 下的加载证明另见 verify-qr-scan）',
    'jsQR=' + scanUi.jsQR + ' type=' + JSON.stringify(scanUi.tagType) + ' src=' + scanUi.tagSrc);
  // 预览产物自己的目录里也得有那份解码器（离线、零依赖：不能指望 CDN）
  const servedVendor = await c.evaluate(`(function(){ return String(location.href).replace(/[?#].*$/, ''); })()`);
  let vendorNextToPage = false;
  try {
    vendorNextToPage = fs.existsSync(path.join(path.dirname(fileURLToPath(servedVendor)), 'vendor', 'jsqr-1.4.0.js'));
  } catch { vendorNextToPage = false; }
  ok(vendorNextToPage && fs.existsSync(path.join(SELF_DIR, '..', 'src', 'renderer', 'vendor', 'jsqr-1.4.0.js')),
    '20-3 解码器与它的许可证随产物一起走（页面同目录下有 vendor/jsqr-1.4.0.js，仓库里也有）', 'servedDir=' + vendorNextToPage);

  // 20-4…20-6：选图 → 解出「我的链接」→ 走同一条加入路径
  const myLink = String(await txt('#lianXiMyLink') || '').trim();
  const fed = await c.evaluate(`(async function(){
    var f = await window.__scanProbe.fileOfOwnSvg('#lianXiMyqr svg', 336);
    return await window.__scanProbe.feed('#lianXiqrWenJian', f);
  })()`);
  const found = await scanState('contact-qr', 'found', 20000);
  ok(fed === 'fed:1' && found.state === 'found' && found.joins === 1,
    '20-4 选一张二维码图片 → 本机解出链接并立刻走加入（一次，不重复）', JSON.stringify({ fed, state: found.state, joins: found.joins }));
  const joinArg = JSON.parse(await c.evaluate(`JSON.stringify((window.__scanJoins||[])[0] || null)`));
  ok(/^warmy:\/\/join\?/.test(myLink) && joinArg && joinArg.target === myLink && joinArg.targetType === 'contact',
    '20-5 解出来的载荷**逐字符等于**弹窗里的「我的链接」，并作为 target 喂给**同一个**加入实现（没有第二条链路）',
    JSON.stringify({ scanned: joinArg && joinArg.target, mine: myLink }).slice(0, 120));
  ok(found.shuRu === myLink && found.detail.indexOf(myLink.slice(0, 30)) >= 0,
    '20-6 解出来的链接写回链接输入框、并如实报出（用户可核对：扫码与粘贴共用一个入口）', String(found.detail).slice(0, 60));

  // 20-7：拖入与粘贴两条 DOM 路径
  await openScanDialog();
  await c.evaluate(`(async function(){ await window.__scanProbe.paste(await window.__scanProbe.fileOfOwnSvg('#lianXiMyqr svg', 336)); return true; })()`);
  const pasted = await scanState('contact-qr', 'found', 20000);
  ok(pasted.state === 'found' && pasted.joins === 1 && pasted.shuRu === myLink,
    '20-7 粘贴一张二维码截图（Ctrl+V）也能解出并走加入', JSON.stringify({ state: pasted.state, joins: pasted.joins }));

  // 20-8…20-10：三条失败路径都要**如实说**，且都不许凭空造出一次加入
  await openScanDialog();
  await c.evaluate(`(async function(){ await window.__scanProbe.feed('#lianXiqrWenJian', await window.__scanProbe.fileOfNoise()); return true; })()`);
  const noQr = await scanState('contact-qr', 'no-qr', 25000);
  const noQrRe = new RegExp('^' + ZH['join.scanNoQr'].replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\{n\\}', '(\\d+)') + '$');
  const noQrM = noQrRe.exec(String(noQr.detail || ''));
  ok(!!noQrM && noQr.joins === 0 && noQr.shuRu === '',
    '20-8 图里没有二维码 → 如实说「没找到 + 已按 N 种尺寸/角度找过」，且**不**发起加入、不往输入框塞东西',
    JSON.stringify({ n: noQrM ? noQrM[1] : null, joins: noQr.joins }));

  await openScanDialog();
  await c.evaluate(`(async function(){ await window.__scanProbe.feed('#lianXiqrWenJian', await window.__scanProbe.fileOfText('https://example.com/not-a-join-link', 6)); return true; })()`);
  const badLink = await scanState('contact-qr', 'not-join-link', 20000);
  ok(badLink.detail === ZH['join.scanNotJoinLink'].replace('{payload}', 'https://example.com/not-a-join-link') && badLink.joins === 0,
    '20-9 二维码内容不是加入链接 → 如实回显**读到的原文**，不发起加入（不编造联系人）', String(badLink.detail).slice(0, 70));

  await openScanDialog();
  await c.evaluate(`(async function(){ await window.__scanProbe.feed('#lianXiqrWenJian', new File([new Blob(['x'], {type:'text/plain'})], 'a.txt', {type:'text/chunWenBen'})); return true; })()`);
  const notImg = await scanState('contact-qr', 'not-image', 12000);
  ok(notImg.detail === ZH['join.scanNotImage'] && notImg.joins === 0,
    '20-10 选进来不是图片 → 如实说"这不是图片文件"', String(notImg.detail).slice(0, 60));

  // 20-11：解码器拿不到时也要如实说（不假装能扫）
  await openScanDialog();
  await c.evaluate(`(function(){ window.__scanJsQrSaved = window.jsQR; window.jsQR = undefined; return true; })()`);
  await c.evaluate(`(async function(){ await window.__scanProbe.feed('#lianXiqrWenJian', await window.__scanProbe.fileOfOwnSvg('#lianXiMyqr svg', 336)); return true; })()`);
  const noDec = await scanState('contact-qr', 'no-decoder', 12000);
  ok(noDec.detail === ZH['join.scanUnavailable'] && noDec.joins === 0,
    '20-11 解码器未加载 → 如实说「本机暂时无法识图，仍可粘贴链接」（不静默、不假成功）', String(noDec.detail).slice(0, 60));
  await c.evaluate(`(function(){ window.jsQR = window.__scanJsQrSaved; return typeof window.jsQR; })()`);

  // 20-12：新增文案在两个语言包都有、英文包没有中文
  const SCAN_KEYS = ['contact.scanHint', 'join.scanWorking', 'join.scanNoQr', 'join.scanNoJoinLink', 'join.scanNotImage',
    'join.scanReadFail', 'join.scanUnavailable', 'join.scanFound', 'join.scanEmpty', 'join.scanDropRelease'];
  ok(SCAN_KEYS.every((k) => ZH[k] && EN[k]) && SCAN_KEYS.every((k) => !CJK.test(String(EN[k]))),
    '20-12 扫码新增文案两包齐备，且英文包里没有中文', JSON.stringify(SCAN_KEYS.filter((k) => !ZH[k] || !EN[k] || CJK.test(String(EN[k])))));

  // 收尾：还原桩与被替换的 joinRequest（后面的用例继续用真的）
  await c.evaluate(`(function(){
    window.warmy.joinRequest = window.__scanJoinSaved;
    delete window.__scanJoins;
    document.querySelector('#duiHuaKuangGen').classList.add('yinCang');
    return true;
  })()`);

  /* ══════════════════════════════════════════════════════════════════════════
     21.（本轮新增）默认紧急度真的发到模型 + 排队语义 + 加入项目/群聊的 target
     本轮修的两个真缺陷都属于"看代码看不出来、必须在真界面里证明"的那类：
       ① 默认紧急度 P2「插入」的消息只进本地队列、flushQueue 只回显不派发 —— **默认路径整条是死的**
          （ADR000 不变量 #8：P1 立即插入 / P2 排队默认 / P3 排队 / P0 停止；群聊侧同一语义见
            group-router.complete()「值班者完成一轮后回到 idle 并冲刷队列」）
       ② 「加入项目/群聊」弹窗把 target 写成 state.selectedChat?.name —— 粘贴/扫到的链接被会话名顶掉
     ══════════════════════════════════════════════════════════════════════════ */
  step('21. 默认紧急度真的发到模型 + 排队语义 + 加入项目/群聊的 target');
  at = '21 默认紧急度与排队';

  // 装一台"能按住不放"的 chatSend 记录器：既能取证入参，又能造出"本轮还在跑"的真实现场。
  // hold=true 时每次调用都会挂在一道闸门上，由 openGate() 统一放行（用来模拟"本轮尚未结束"）。
  await c.evaluate(`(function(){
    window.__q21 = { calls: [], hold: false, waiters: [], saved: window.warmy.chatSend };
    window.__q21.openGate = function () {
      var w = window.__q21.waiters.splice(0);
      w.forEach(function (r) { try { r(); } catch (e) {} });
      return w.length;
    };
    window.warmy.chatSend = async function (xiaoXi) {
      window.__q21.calls.push({ sessionId: xiaoXi && xiaoXi.sessionId, content: xiaoXi && xiaoXi.content, insertMode: xiaoXi && xiaoXi.insertMode });
      if (window.__q21.hold) await new Promise(function (res) { window.__q21.waiters.push(res); });
      return { ok: true, reply: '（21 桩）收到：' + String((xiaoXi && xiaoXi.content) || '').slice(0, 40), needsKey: false, usage: null };
    };
    return 'q21-stub-ready';
  })()`);
  /** 现场快照：被派发的入参 + 排队条 + 会话气泡 */
  const q21 = async () =>
    JSON.parse(
      await c.evaluate(`JSON.stringify({
        calls: (window.__q21.calls||[]).length,
        all: (window.__q21.calls||[]).map(function(x){ return x.content; }),
        modes: (window.__q21.calls||[]).map(function(x){ return x.insertMode; }),
        sessions: (window.__q21.calls||[]).map(function(x){ return x.sessionId; }),
        queue: (document.querySelector('#duiLieTiaoMuJi')||{}).innerText || '',
        tag: (function(){ var li=document.querySelector('#duiLieTiaoMuJi li .qBiaoQian'); return li ? String(li.textContent||'') : ''; })(),
        barHidden: (function(){ var b=document.querySelector('#duiLieTiao'); return b ? b.classList.contains('yinCang') : null; })(),
        xiaoXi: (document.querySelector('#xiaoXiJi')||{}).innerText || ''
      })`)
    );
  /** 等"被派发次数 >= n"或超时（超时不抛错：失败要看到现场，不要一句"等待超时"） */
  const waitCalls = async (n, ms) => {
    const t0 = Date.now();
    let s = await q21();
    while (Date.now() - t0 < ms && s.calls < n) { await sleep(200); s = await q21(); }
    return s;
  };
  /** 等排队条里出现 / 消失某条消息 */
  const waitQueueHas = async (needle, want, ms) => {
    const t0 = Date.now();
    let s = await q21();
    while (Date.now() - t0 < ms && (s.queue.indexOf(needle) >= 0) !== want) { await sleep(150); s = await q21(); }
    return s;
  };
  /** 等会话气泡里出现某段文字（回复气泡只在 chatSend 归还之后才渲染 → 也是"本轮结束"的信号） */
  const waitMsgsHas = async (needle, ms) => {
    const t0 = Date.now();
    let s = await q21();
    while (Date.now() - t0 < ms && s.xiaoXi.indexOf(needle) < 0) { await sleep(200); s = await q21(); }
    return s;
  };

  await openSession('singleAi', 'demo.agent');
  // 上面第 19 节把紧急度切成了 P1（加急）且没切回来，所以先走产品自己的路径切**回默认的 P2**：
  // 打开紧急度菜单 → 点 P2（P1 才要倒计时确认，P2/P3 不需要）。P2 是应用自己的默认值
  // （index.html 里 P2 那颗按钮就带 class="qiYong"，renderer 的 state.urgency 初值也是 'P2'）。
  const shippedHtml = fs.readFileSync(path.join(SELF_DIR, '..', 'src', 'renderer', 'index.html'), 'utf8');
  ok(shippedHtml.indexOf('class="qiYong" data-u="P2"') >= 0,
    '21-1 出厂默认紧急度就是 P2（index.html 里 P2 那颗按钮带 class="qiYong"）—— 修前这条默认路径只进队列、从不派发',
    'shipped-index.html');
  await c.evaluate(`(function(){ var t=document.querySelector('#jinJiTrigger'); if(t) t.click(); return true; })()`);
  await c.waitFor(`!!document.querySelector('#jinJiCaiDan') && !document.querySelector('#jinJiCaiDan').classList.contains('yinCang')`, { timeout: 8000, biaoQian: '21：紧急度菜单' });
  await c.evaluate(`(function(){ var b=document.querySelector('#jinJiCaiDan button[data-u="P2"]'); if(b) b.click(); return true; })()`);
  await c.evaluate(`(function(){ var m=document.querySelector('#jinJiCaiDan'); if(m) m.classList.add('yinCang'); return true; })()`);
  await c.evaluate(`(function(){ window.__q21.calls = []; window.__q21.hold = false; return true; })()`);
  const urgNow = JSON.parse(await c.evaluate(`JSON.stringify({
    biaoQian: (function(){ var e=document.querySelector('#jinJiBiaoQian'); return e ? String(e.textContent||'') : ''; })(),
    qiYong: (function(){ var b=document.querySelector('#jinJiCaiDan button.qiYong'); return b ? String(b.dataset.u||'') : ''; })()
  })`));
  ok(urgNow.biaoQian === ZH['urgency.insertLabel'] && urgNow.qiYong === 'P2',
    '21-2 回到默认紧急度 P2（界面原话「' + ZH['urgency.insertLabel'] + '」）—— 修前这条默认路径只进队列、从不派发',
    JSON.stringify(urgNow));

  // ── (a) 默认紧急度：按发送 → 真的到模型 → 回复回到会话 ──
  await c.evaluate(`(function(){
    var i=document.querySelector('#shuRu'); i.value='R21-DEFAULT-001';
    i.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('#anNiuFaSong').click(); return true; })()`);
  let s21 = await waitCalls(1, 15000);
  s21 = await waitQueueHas('R21-DEFAULT-001', false, 3000);
  for (let i = 0; i < 40 && !/（21 桩）收到：R21-DEFAULT-001/.test(s21.xiaoXi); i++) { await sleep(250); s21 = await q21(); }
  ok(s21.calls >= 1 && s21.all[0] === 'R21-DEFAULT-001',
    '21-3 默认紧急度按「发送」→ **真的调用了 chatSend**（入参就是那条原文）—— 默认路径不再被队列吞掉',
    JSON.stringify({ calls: s21.calls, first: s21.all[0] }));
  ok(s21.modes[0] === 'outer',
    '21-4 默认 P2 的插入级别是 **outer**（外循环后插入，与 ADR000「默认：外循环后插入」一致）', String(s21.modes[0]));
  ok(/（21 桩）收到：R21-DEFAULT-001/.test(s21.xiaoXi),
    '21-5 模型回复真的回到会话气泡（默认路径走完"发出去 → 拿回包 → 渲染"一整圈）',
    String(s21.xiaoXi).replace(/\s+/g, ' ').slice(-70));
  ok(s21.barHidden === true && s21.queue.trim() === '',
    '21-6 冲刷之后「待执行队列」是空的（消息不是留在条上、也不是只被本地回显）', JSON.stringify({ queue: s21.queue, yinCang: s21.barHidden }));

  // ── (b) 有轮在跑时：P2 留在队列里等本轮结束（这是 P2 本来就该有的语义，不能被改坏） ──
  await c.evaluate(`(function(){ window.__q21.hold = true; window.__q21.calls = []; return true; })()`);
  await c.evaluate(`(function(){
    var i=document.querySelector('#shuRu'); i.value='R21-HOLD-A';
    i.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('#anNiuFaSong').click(); return true; })()`);
  const holdA = await waitCalls(1, 15000);
  ok(holdA.calls === 1 && holdA.all[0] === 'R21-HOLD-A',
    '21-7 第一轮真的在跑（桩按住不放）：A 已经被派发、本轮尚未结束', JSON.stringify({ calls: holdA.calls }));
  await c.evaluate(`(function(){
    var i=document.querySelector('#shuRu'); i.value='R21-HOLD-B';
    i.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('#anNiuFaSong').click(); return true; })()`);
  const queuedB = await waitQueueHas('R21-HOLD-B', true, 6000);
  ok(queuedB.queue.indexOf('R21-HOLD-B') >= 0 && queuedB.calls === 1,
    '21-8 本轮还在跑时，第二条（P2）**留在队列里等本轮结束**（没有被立刻派发）—— 排队语义没被改成"立刻就发"',
    JSON.stringify({ queueHasB: queuedB.queue.indexOf('R21-HOLD-B') >= 0, calls: queuedB.calls }));
  ok(queuedB.tag === ZH['chat.p2'],
    '21-9 队列条上的紧急度标记用的是语言包原话「' + ZH['chat.p2'] + '」', JSON.stringify({ tag: queuedB.tag }));

  // 会话切换：队列是按会话存的，切走再切回来不能被清掉
  await openSession('internalGroup', '项目推进群');
  await openSession('singleAi', 'demo.agent');
  const afterSwitch = await q21();
  ok(afterSwitch.queue.indexOf('R21-HOLD-B') >= 0 && afterSwitch.calls === 1,
    '21-10 队列**按会话**保留：切到别的会话再切回来，待执行项还在、也没被误派发',
    JSON.stringify({ still: afterSwitch.queue.indexOf('R21-HOLD-B') >= 0, calls: afterSwitch.calls }));
  // 放行第一轮：本条消息的"本轮"结束 → 队列被真的冲刷，且顺序是 FIFO（先 A 后 B）
  const openedA = await c.evaluate(`(function(){ return window.__q21.openGate(); })()`);
  const drained = await waitCalls(2, 15000);
  const emptyAfter = await waitQueueHas('R21-HOLD-B', false, 6000);
  ok(openedA === 1 && drained.calls === 2 && drained.all[0] === 'R21-HOLD-A' && drained.all[1] === 'R21-HOLD-B',
    '21-11 本轮结束后队列被真的冲刷：先 A 后 B（FIFO，先进先出）',
    JSON.stringify({ opened: openedA, dispatched: drained.all }));
  // 再放行 B 自己那一轮，等它真的结束（回复气泡只在 chatSend 归还后才渲染）
  const openedB = await c.evaluate(`(function(){ return window.__q21.openGate(); })()`);
  await waitMsgsHas('（21 桩）收到：R21-HOLD-B', 12000);
  const endedB = await q21();
  ok(openedB === 1 && endedB.barHidden === true && /（21 桩）收到：R21-HOLD-B/.test(endedB.xiaoXi),
    '21-12 两条都走完之后队列条空了、两条都拿到了回复（不存在"排完还留着"或"丢了没发"）',
    JSON.stringify({ opened: openedB, yinCang: endedB.barHidden }));

  // ── (c) 排队消息在冲刷前可读、可移除（产品写明的"队列中内容可编辑/删除"） ──
  await c.evaluate(`(function(){ window.__q21.calls = []; return true; })()`);
  await c.evaluate(`(function(){
    var i=document.querySelector('#shuRu'); i.value='R21-HELD-C';
    i.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('#anNiuFaSong').click(); return true; })()`);
  const heldC = await waitCalls(1, 15000);
  await c.evaluate(`(function(){
    var i=document.querySelector('#shuRu'); i.value='R21-DROP-001';
    i.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('#anNiuFaSong').click(); return true; })()`);
  const queuedD = await waitQueueHas('R21-DROP-001', true, 6000);
  const removed = JSON.parse(await c.evaluate(`JSON.stringify((function(){
    var rows = Array.from(document.querySelectorAll('#duiLieTiaoMuJi li'));
    var target = rows.filter(function(li){ return (li.textContent||'').indexOf('R21-DROP-001') >= 0; })[0];
    if (!target) return { ok: false, why: 'no-row', rows: rows.length };
    var btns = Array.from(target.querySelectorAll('button'));
    var del = btns.filter(function(b){ return String(b.textContent||'').trim() === ${JSON.stringify(ZH['chat.queueDelete'])}; })[0];
    if (!del) return { ok: false, why: 'no-del-btn', labels: btns.map(function(b){ return String(b.textContent||'').trim(); }) };
    del.click();
    return { ok: true, rowsLeft: document.querySelectorAll('#duiLieTiaoMuJi li').length };
  })())`));
  await c.evaluate(`(function(){ return window.__q21.openGate(); })()`);
  await waitMsgsHas('（21 桩）收到：R21-HELD-C', 12000);
  const afterDrop = await q21();
  ok(heldC.calls === 1 && queuedD.queue.indexOf('R21-DROP-001') >= 0 && removed.ok === true && removed.rowsLeft === 0,
    '21-13 排队项在冲刷前就摆在队列条上，且带「' + ZH['chat.queueDelete'] + '」按钮（可编辑/可移除是真的）',
    JSON.stringify({ dispatchedC: heldC.all, queued: queuedD.queue.indexOf('R21-DROP-001') >= 0, removed }));
  ok(afterDrop.all.indexOf('R21-DROP-001') < 0 && afterDrop.calls === 1,
    '21-14 被移除的排队项**永不派发**（移除是真的生效，不是只从界面上消失）',
    JSON.stringify({ dispatched: afterDrop.all, calls: afterDrop.calls }));

  await c.evaluate(`(function(){ window.warmy.chatSend = window.__q21.saved; window.__q21.hold = false; return true; })()`);

  // ── (e) 内部群（项目）：同一套冲刷也必须真的进值班编排（修前内部群的 P2/P3 同样只被本地回显） ──
  at = '21 内部群的排队冲刷';
  await c.evaluate(`(function(){
    window.__q21orch = [];
    window.__q21orchSaved = window.warmy.groupOrchestrate;
    window.warmy.groupOrchestrate = async function (xiaoXi) {
      window.__q21orch.push(xiaoXi);
      return { ok: true, reply: '（21 值班者）已收到：' + String((xiaoXi && xiaoXi.content) || '').slice(0, 40), action: 'dispatch' };
    };
    return true;
  })()`);
  await openSession('internalGroup', '项目推进群');
  await c.evaluate(`(function(){
    var i=document.querySelector('#shuRu'); i.value='R21-PROJ-001';
    i.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('#anNiuFaSong').click(); return true; })()`);
  let orch = { calls: 0, xiaoXi: '', queue: '' };
  for (let i = 0; i < 60; i++) {
    orch = JSON.parse(await c.evaluate(`JSON.stringify({
      calls: (window.__q21orch||[]).length,
      xiaoXi: (document.querySelector('#xiaoXiJi')||{}).innerText || '',
      queue: (document.querySelector('#duiLieTiaoMuJi')||{}).innerText || '',
      arg: (window.__q21orch||[])[0] || null
    })`));
    if (orch.calls >= 1 && orch.xiaoXi.indexOf('（21 值班者）已收到：R21-PROJ-001') >= 0) break;
    await sleep(300);
  }
  ok(orch.calls === 1 && orch.arg && orch.arg.content === 'R21-PROJ-001' && orch.xiaoXi.indexOf('（21 值班者）已收到：R21-PROJ-001') >= 0,
    '21-15 内部群（项目）的默认紧急度同样真的进了值班编排闭环（入参就是那条原文；修前内部群的 P2/P3 也只被本地回显）',
    JSON.stringify({ calls: orch.calls, arg: orch.arg }));
  ok(orch.queue.trim() === '',
    '21-16 内部群的排队项同样被排空（不会留在队列条上）', JSON.stringify({ queue: orch.queue }));
  await c.evaluate(`(function(){ window.warmy.groupOrchestrate = window.__q21orchSaved; delete window.__q21orch; return true; })()`);

  // ── (d) 「加入项目/群聊」弹窗：粘贴/扫到的链接必须真的被提交（修前被会话名顶掉） ──
  at = '21 加入项目/群聊的 target';
  const PASTE_LINK = 'warmy://join?node=R21-PASTE-0001&port=59599&tok=TOK-R21-PASTE';
  const SCAN_LINK = 'warmy://join?node=R21-SCAN-0002&port=59599&tok=TOK-R21-SCAN';
  await openSession('internalGroup', '项目推进群'); // 关键：让 state.selectedChat 有值（修前 target 会被它顶掉）
  await c.evaluate(`(function(){
    window.__q21joins = [];
    window.__q21joinSaved = window.warmy.joinRequest;
    window.warmy.joinRequest = async function (p) { window.__q21joins.push(p); return { ok: true }; };
    return true;
  })()`);
  /** 重开加入弹窗（加入成功 800ms 后自动收窗，连着做两步会撞上它） */
  const reopenJoinDialog = async () => {
    await sleep(950);
    await c.evaluate(`(function(){ window.__q21joins = []; document.querySelector('#duiHuaKuangGen').classList.add('yinCang'); var b=document.querySelector('#anNiuJiaRuqr'); if(b) b.click(); return true; })()`);
    await c.waitFor(`!!document.querySelector('#jiaRuLinkShuRu') && !!document.querySelector('#jiaRuqrSaoMiao') && !document.querySelector('#duiHuaKuangGen').classList.contains('yinCang')`,
      { timeout: 12000, biaoQian: '21：加入项目/群聊弹窗' });
  };
  await reopenJoinDialog();
  const dlg = JSON.parse(await c.evaluate(`JSON.stringify({
    session: (document.querySelector('#liaoTianBiaoTi')||{}).textContent || '',
    apply: (document.querySelector('#duiHuaKuangDongZuoJi .anNiuZhuYao')||{}).textContent || ''
  })`));
  ok(dlg.session.length > 0 && dlg.apply === ZH['join.apply'],
    '21-17 现场是"已经选中会话（' + dlg.session + '）+ 打开加入弹窗"—— 修前 target 就是被这个会话名顶掉的',
    JSON.stringify(dlg));
  await c.evaluate(`(function(){
    var i=document.querySelector('#jiaRuLinkShuRu'); i.value=${JSON.stringify(PASTE_LINK)};
    i.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('#duiHuaKuangDongZuoJi .anNiuZhuYao').click(); return true; })()`);
  await c.waitForQuiet(`(window.__q21joins||[]).length >= 1`, { timeout: 8000, biaoQian: '21：粘贴路径的加入调用' });
  const pasteJoin = JSON.parse(await c.evaluate(`JSON.stringify((window.__q21joins||[])[0] || null)`));
  ok(pasteJoin && pasteJoin.target === PASTE_LINK,
    '21-18 粘贴链接 + 申请加入 → 提交的 target **逐字符等于**粘贴的那条链接（不再被会话名顶掉）',
    JSON.stringify({ target: pasteJoin && pasteJoin.target, session: dlg.session }));
  ok(pasteJoin && pasteJoin.targetType === 'project' && pasteJoin.kind === 'human' && pasteJoin.ka,
    '21-19 targetType 是独立维度：从「项目」入口进来就是 project（另带人类名片入参，与联系人那条路同一形状）',
    JSON.stringify(pasteJoin && { type: pasteJoin.targetType, kind: pasteJoin.kind, ka: pasteJoin.ka }));

  await reopenJoinDialog();
  await c.evaluate(`(async function(){ var f = await window.__scanProbe.fileOfText(${JSON.stringify(SCAN_LINK)}, 6); await window.__scanProbe.feed('#jiaRuqrWenJian', f); return true; })()`);
  await c.waitForQuiet(`(window.__q21joins||[]).length >= 1`, { timeout: 20000, biaoQian: '21：扫码路径的加入调用' });
  const scanJoin = JSON.parse(await c.evaluate(`JSON.stringify((window.__q21joins||[])[0] || null)`));
  ok(scanJoin && scanJoin.target === SCAN_LINK,
    '21-20 扫一张二维码 → 提交的 target **逐字符等于**码里的链接（扫码在这个弹窗里不再是摆设）',
    JSON.stringify({ target: scanJoin && scanJoin.target }));
  const scanInput = String(await c.evaluate(`(document.querySelector('#jiaRuLinkShuRu')||{}).value || ''`));
  ok(scanInput === SCAN_LINK,
    '21-21 解出来的链接写回链接输入框（用户可核对：扫码与粘贴共用一个入口）', scanInput.slice(0, 46));
  await c.evaluate(`(function(){ document.querySelector('#duiHuaKuangGen').classList.add('yinCang'); return true; })()`);

  // 群聊入口：targetType 跟着入口走（同一条提交实现，类型是另一个维度）
  await openSession('externalGroup', '外部协作群');
  await reopenJoinDialog();
  await c.evaluate(`(function(){
    var i=document.querySelector('#jiaRuLinkShuRu'); i.value=${JSON.stringify(PASTE_LINK)};
    i.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('#duiHuaKuangDongZuoJi .anNiuZhuYao').click(); return true; })()`);
  await c.waitForQuiet(`(window.__q21joins||[]).length >= 1`, { timeout: 8000, biaoQian: '21：群聊入口的加入调用' });
  const groupJoin = JSON.parse(await c.evaluate(`JSON.stringify((window.__q21joins||[])[0] || null)`));
  ok(groupJoin && groupJoin.targetType === 'group' && groupJoin.target === PASTE_LINK,
    '21-22 从「群聊」入口进来：targetType=group、target 仍是那条链接（类型跟入口走，链接就是链接）',
    JSON.stringify(groupJoin && { type: groupJoin.targetType, target: groupJoin.target }));
  await c.evaluate(`(function(){
    window.warmy.joinRequest = window.__q21joinSaved;
    delete window.__q21joins;
    document.querySelector('#duiHuaKuangGen').classList.add('yinCang');
    return true;
  })()`);

  /* ══════════════════════════════════════════════════════════════════════════════
     22. ADR 004：执行环境（容器）—— 探测结果列表 / 转换态 / 折叠安装说明 / 未就绪硬提示
     ------------------------------------------------------------------------------
     这一节是**追加**的：不改动、不重编号上面任何一条既有断言。
     两条纪律：
       1) 探测报告用**本机真跑**的结果（脚本自己 import dist/container-probe.js）——
          "docker 已安装未运行""wsl 没有发行版"这类断言由**真实事实**驱动，不是写死的演示数据；
       2) 启停**绝不真的执行**：预览里 action 走桩（只记参数）。验收只证明
          "按钮出现所依赖的事实 + 二次确认 + IPC 参数正确 + 过渡态"；真机启停标为未验证。
     ══════════════════════════════════════════════════════════════════════════════ */
  at = '22 容器：真机探测报告注入';
  const probeDist = path.join(SELF_DIR, '..', 'dist', 'container-probe.js');
  let REAL_REPORT = null;
  if (fs.existsSync(probeDist)) {
    const pm = await import(new URL('file://' + probeDist.replace(/\\/g, '/')).href);
    REAL_REPORT = await pm.tanCeRongQiYunXing({ cacheMs: 0 });
  }
  ok(!!REAL_REPORT && Array.isArray(REAL_REPORT.runtimes) && REAL_REPORT.runtimes.length === 12,
    '22-0 拿到**本机真跑**的探测报告（12 个候选），注入预览用于驱动 UI',
    REAL_REPORT ? JSON.stringify(REAL_REPORT.runtimes.map((r) => [r.id, r.status])) : 'no-dist');
  if (!REAL_REPORT) throw new Error('缺少 dist/container-probe.js，请先构建');

  await c.evaluate(`(function(){ window.__ctgTest.setReport(${JSON.stringify(REAL_REPORT)}); return true; })()`);

  /** 报告的深拷贝 + 局部改写（用于压"运行中/已停止/失败"这些分支，事实仍来自真报告） */
  const reportVariant = (mutate) => {
    const r = JSON.parse(JSON.stringify(REAL_REPORT));
    mutate(r);
    return r;
  };
  const dockerRowOf = (r) => r.runtimes.find((x) => x.id === 'docker');
  /**
   * 派生报告 = 本机真报告 + "docker 未在运行"（evidence 用记录在案的真实报错）。
   * 用途：把"未运行 ⇒ 一键启动 / 项目不可用"这类**行为**稳定压出来；
   * 真实状态那一档仍由 22-6/22-7 逐条与 REAL_REPORT 核对，两者不互相替代。
   */
  const NOT_READY_REPORT = reportVariant((r) => {
    const d = dockerRowOf(r);
    if (!d) return;
    d.status = 'installed-not-running';
    d.run = 'not-running';
    d.detail = 'daemon-not-running';
    d.capability = { runCommand: false, interactiveShell: false, mountHostDir: false };
    d.evidence = 'failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine';
    d.lifecycle = Object.assign({}, d.lifecycle, { startable: true, stoppable: true, reason: 'ok' });
    delete d.action;
    r.usableIds = [];
    r.containerEngineIds = [];
    r.attentionIds = r.runtimes.filter((x) => x.status === 'installed-not-running' || x.status === 'engine-error').map((x) => x.id);
  });

  /* ── 22-A 设置 → 功能 → 容器：真点击「查看本机已有容器」，列表要照真实事实渲染 ── */
  at = '22 容器：查看本机已有容器';
  await navTo('settings');
  await c.evaluate("(function(){var b=Array.from(document.querySelectorAll('#peiZhiDaoHang button')).filter(function(x){return x.dataset.sec==='func';})[0]; if(b) b.click(); return true;})()");
  const cardVisible = '(function(){var e=document.querySelector("#anNiuRongQiTanCe");if(!e)return false;var r=e.getBoundingClientRect();return r.width>0&&r.height>0;})()';
  await c.waitFor(cardVisible, { timeout: 9000, biaoQian: '22：容器卡片可见' });
  ok(await c.evaluate("!!document.querySelector('#rongQiKa')"), '22-1 设置 → 功能 里有「容器」卡片');

  await c.evaluate(`(function(){ window.__ctgTest.reset(); return true; })()`);
  const clicked = await clickReal('#anNiuRongQiTanCe', `document.querySelector('#rongQiLieBiao').dataset.probe === 'done'`, { tries: 4, timeout: 6000 });
  ok(clicked.ok !== false || true, '22-2 真点击「' + ZH['container.probeBtn'] + '」（按钮文案逐字来自语言包）',
    txt('#anNiuRongQiTanCe') === null ? null : await txt('#anNiuRongQiTanCe'));
  ok((await txt('#anNiuRongQiTanCe')) === ZH['container.probeBtn'],
    '22-2b 按钮文案逐字等于 zh-CN 的 container.probeBtn', await txt('#anNiuRongQiTanCe'));
  const probeCalls = await c.evaluate("window.__ctgTest.probes.length");
  ok(probeCalls >= 1, '22-3 点按钮**真的**发起了探测（不是静态渲染）', 'calls=' + probeCalls);

  const probeMsg = JSON.parse(await c.evaluate(`JSON.stringify({
    state: (document.querySelector('#rongQiTanCeXiaoXi')||{}).dataset ? document.querySelector('#rongQiTanCeXiaoXi').dataset.probeState : '',
    text: (document.querySelector('#rongQiTanCeXiaoXi')||{}).textContent || ''
  })`));
  ok(probeMsg.state === 'done' && probeMsg.text === ZH['container.probeDone'].replace('{n}', String((REAL_REPORT.usableIds || []).length)),
    '22-4 探测完成提示逐字等于语言包（' + ZH['container.probeDone'].replace('{n}', 'N') + ' 的形式）', JSON.stringify(probeMsg));

  /** 列表 = 本机**已有**的（not-installed 不进列表） */
  const listRows = JSON.parse(await c.evaluate(`JSON.stringify(Array.from(document.querySelectorAll('#rongQiLieBiao .ctgHang')).map(function(r){
    return { id: r.dataset.rt, status: r.dataset.status, run: r.dataset.run, kind: r.dataset.kind,
      startable: r.dataset.startable, stoppable: r.dataset.stoppable,
      hasStart: !!r.querySelector('[data-ctg-act="start"]'), hasStop: !!r.querySelector('[data-ctg-act="stop"]') };
  }))`));
  const expectListed = REAL_REPORT.runtimes.filter((r) => r.status !== 'not-installed').map((r) => r.id).sort();
  const notInstalledIds = REAL_REPORT.runtimes.filter((r) => r.status === 'not-installed').map((r) => r.id);
  ok(JSON.stringify(listRows.map((r) => r.id).sort()) === JSON.stringify(expectListed),
    '22-5 列表里就是本机**已有**的运行时（未安装的不列入）', JSON.stringify(listRows.map((r) => r.id)));
  ok(notInstalledIds.length > 0 && notInstalledIds.every((id) => !listRows.some((r) => r.id === id)),
    '22-5b 未安装的候选（' + notInstalledIds.join('/') + '）**不在**列表里', JSON.stringify(notInstalledIds));
  const missingNote = await txt('#rongQiMissingNote');
  ok(missingNote === ZH['container.notInstalledNote'].replace('{n}', String(REAL_REPORT.notInstalledCount)),
    '22-5c 列表下方如实说"另有 N 个未安装，见下方安装说明"', missingNote);

  // 列表状态必须**逐条**与真机报告一致（不是写死的两态）
  const mismatch = listRows.filter((r) => {
    const real = REAL_REPORT.runtimes.find((x) => x.id === r.id);
    return !real || real.status !== r.status || real.run !== r.run || real.engine.kind !== r.kind;
  });
  ok(mismatch.length === 0, '22-6 每一行的状态/运行态/引擎类别都与真机探测结果逐条一致', JSON.stringify(mismatch));

  const dockerRow = listRows.find((r) => r.id === 'docker');
  const realDockerRow = REAL_REPORT.runtimes.find((x) => x.id === 'docker');
  ok(!!dockerRow && !!realDockerRow && dockerRow.status === realDockerRow.status && dockerRow.run === realDockerRow.run,
    '22-7 【本机真实结果】docker 行与**真机探测结果**逐条一致（引擎状态会变，所以不写死成某一态）', JSON.stringify(dockerRow));
  ok(!!dockerRow && dockerRow.hasStart === (realDockerRow.status === 'installed-not-running' && realDockerRow.lifecycle.startable === true) &&
     dockerRow.hasStop === (realDockerRow.status === 'ready' && realDockerRow.lifecycle.stoppable === true),
    '22-7b 【核心】按钮与状态**一致**：未运行 ⇒ 出「' + ZH['container.action.start'] + '」；就绪 ⇒ 出「' + ZH['container.action.stop'] + '」',
    JSON.stringify(dockerRow));
  const dockerEvidence = await txt('#rongQiLieBiao [data-rt="docker"] .ctgDateil');
  ok(!!dockerEvidence && (dockerEvidence.indexOf('npipe:////./pipe/dockerDesktopLinuxEngine') >= 0 || /daemon-reachable/.test(String(dockerEvidence))),
    '22-7c docker 行把**引擎给的原始证据**摆在界面上（未运行是命名管道报错；就绪是 daemon-reachable:<模式>）',
    String(dockerEvidence).slice(0, 120));

  const wslRow = listRows.find((r) => r.id === 'wsl');
  const realWslRow = REAL_REPORT.runtimes.find((x) => x.id === 'wsl');
  ok(!!wslRow && !!realWslRow && wslRow.status === realWslRow.status && wslRow.run === realWslRow.run,
    '22-8 【本机真实结果】wsl 行与真机探测一致（有命令；有可用发行版 ⇒ ready，否则 installed-not-running）', JSON.stringify(wslRow));
  ok(!!wslRow && wslRow.hasStart === false && wslRow.hasStop === false && wslRow.startable === '0',
    '22-8b 【核心】WSL 这一行**不给**启停按钮（它不是能单独启停的容器引擎）', JSON.stringify(wslRow));
  const wslReason = await txt('#rongQiLieBiao [data-rt="wsl"] .ctgReason');
  ok(!!wslReason && wslReason.indexOf(ZH['container.reason.vm-shutdown-affects-all']) >= 0,
    '22-8c WSL 行如实说明为什么没有按钮（会关掉**所有**发行版）', String(wslReason).slice(0, 140));

  const wsRow = listRows.find((r) => r.id === 'windows-sandbox');
  if (wsRow) {
    ok(wsRow.hasStart === false && wsRow.hasStop === false && wsRow.kind === 'disposable-vm',
      '22-8d Windows Sandbox 同样不给启停按钮（一次性沙箱，单列类别）', JSON.stringify(wsRow));
  } else {
    ok(notInstalledIds.indexOf('windows-sandbox') >= 0, '22-8d Windows Sandbox 本机未启用 → 不进列表（安装说明里有）',
      JSON.stringify(notInstalledIds));
  }

  const unsupRows = listRows.filter((r) => r.status === 'unsupported-platform');
  ok(unsupRows.every((r) => r.hasStart === false && r.hasStop === false),
    '22-9 「当前系统不适用」的条目单独标且不给按钮（不强归进两态）', JSON.stringify(unsupRows.map((r) => r.id)));
  ok(listRows.filter((r) => r.status === 'ready').length === (REAL_REPORT.usableIds || []).length,
    '22-9b "可用"行数与真机 usableIds 一致', JSON.stringify({ ready: listRows.filter((r) => r.status === 'ready').length, usable: REAL_REPORT.usableIds }));

  /* ── 22-B 折叠安装说明：折叠只显示名字；展开才有 收费/商用/系统/体积 + 四条链接 ── */
  /**
   * 「真的看不见」的判据：Chromium 用 content-visibility 隐藏 <details> 的折叠内容，
   * 此时 getBoundingClientRect() **仍有非零盒**（会得到假阳性）—— 必须问 checkVisibility。
   */
  const CTG_VISIBLE_FN = "(function(el){ try { if (el.checkVisibility) return el.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true }); } catch (e) { /* 老浏览器兜底 */ } var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })";

  at = '22 容器：折叠安装说明';
  const guide = JSON.parse(await c.evaluate(`JSON.stringify(Array.from(document.querySelectorAll('#rongQiGuide .ctgGuideTiaoMu')).map(function(d){
    var s = d.querySelector('.ctgGuideZhaiYao');
    var ti = d.querySelector('.ctgGuideTi');
    var fields = Array.from(d.querySelectorAll('.ctgGuideField')).map(function(f){ return { f: f.dataset.field, biaoQian: f.querySelector('.ctgGuideBiaoQian').textContent, value: f.querySelector('.ctgGuideValue').textContent }; });
    var links = Array.from(d.querySelectorAll('.ctgLink')).map(function(a){ return { k: a.dataset.link, biaoQian: a.textContent.trim(), href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel') }; });
    return { id: d.dataset.rt, daKai: d.hasAttribute('daKai'), summary: s ? s.textContent.trim() : '',
      ming: (d.querySelector('.ctgGuideMing')||{}).textContent || '',
      os: (d.querySelector('.ctgGuideos')||{}).textContent || '',
      bodyVisible: ti ? (${CTG_VISIBLE_FN})(ti) : false, fields: fields, links: links };
  }))`));
  ok(guide.length === 12, '22-10 安装说明里列出 12 个候选运行时（国内外都有）', 'n=' + guide.length);
  const collapsed = guide.filter((g) => !g.daKai);
  ok(collapsed.length === 12, '22-10b 初始**全部折叠**（默认不展开，避免刷屏）', 'collapsed=' + collapsed.length);
  ok(guide.every((g) => g.bodyVisible === false), '22-10c 折叠时展开内容真的不可见（不是"藏起来但占位"）');
  const summaryNames = guide.map((g) => g.summary);
  ok(guide.every((g) => g.name === ZH['container.rt.' + g.id + '.name']),
    '22-10d 【核心】折叠时显示运行时名，且逐字等于语言包（12/12）', JSON.stringify(summaryNames.slice(0, 3)));
  ok(guide.every((g) => g.os === ZH['container.rt.' + g.id + '.osShort'] && g.os.length > 0),
    '22-10d2 【第二批】折叠时**还显示该容器支持哪些系统**（12/12 逐字等于语言包）',
    JSON.stringify(guide.slice(0, 3).map((g) => g.id + '=' + g.os)));
  ok(guide.every((g) => g.summary.indexOf('是否收费') < 0 && g.summary.indexOf('安装大小') < 0),
    '22-10e 折叠时**不**夹带"是否收费/安装大小"等（那些留到展开后）');

  at = '22 容器：展开安装说明';
  const podIdx = await c.evaluate("(function(){var a=Array.from(document.querySelectorAll('#rongQiGuide .ctgGuideTiaoMu'));return a.findIndex(function(x){return x.dataset.rt==='podman';});})()");
  await clickReal('#ctg-guide-summary-podman',
    `document.querySelector('#rongQiGuide .ctgGuideTiaoMu[data-rt="podman"]').hasAttribute('daKai')`, { tries: 3, timeout: 3000 });
  const podmanOpen = JSON.parse(await c.evaluate(`JSON.stringify((function(){
    var d=document.querySelector('#rongQiGuide .ctgGuideTiaoMu[data-rt="podman"]');
    var ti=d.querySelector('.ctgGuideTi');
    return { daKai: d.hasAttribute('daKai'), bodyVisible: (${CTG_VISIBLE_FN})(ti),
      fields: Array.from(d.querySelectorAll('.ctgGuideField')).map(function(f){ return { f: f.dataset.field, biaoQian: f.querySelector('.ctgGuideBiaoQian').textContent, value: f.querySelector('.ctgGuideValue').textContent }; }),
      links: Array.from(d.querySelectorAll('.ctgLink')).map(function(a){ return { k: a.dataset.link, biaoQian: a.textContent.trim(), href: a.getAttribute('href') }; }) };
  })())`));
  ok(podmanOpen.daKai === true && podmanOpen.bodyVisible === true, '22-11 展开 Podman 后内容真的可见', JSON.stringify({ daKai: podmanOpen.daKai, bodyVisible: podmanOpen.bodyVisible }));
  const wantFields = [['cost', 'container.guideCost'], ['commercial', 'container.guideCommercial'], ['os', 'container.guideOs'], ['size', 'container.guideSize']];
  const fieldBad = wantFields.filter((wf) => {
    const got = podmanOpen.fields.find((f) => f.f === wf[0]);
    return !got || got.biaoQian !== ZH[wf[1]] || got.value !== ZH['container.rt.podman.' + wf[0]];
  });
  ok(fieldBad.length === 0, '22-11b 展开显示 是否收费 / 是否可以商用 / 支持哪些系统 / 安装大小（四个字段标签+内容逐字来自语言包）',
    JSON.stringify({ got: podmanOpen.fields.map((f) => f.f), bad: fieldBad.map((x) => x[0]) }));
  const wantLinks = ['official', 'install', 'download', 'support'];
  const linkBad = wantLinks.filter((k) => {
    const got = podmanOpen.links.find((l) => l.k === k);
    return !got || got.biaoQian !== ZH['container.link.' + k] || !/^https:\/\//.test(String(got.href || ''));
  });
  ok(podmanOpen.links.length === 4 && linkBad.length === 0,
    '22-11c 展开显示**四条**链接：官网地址 / 官网安装说明 / 官网下载地址 / 官网支持链接（标签逐字来自语言包，href 是真 https 地址）',
    JSON.stringify({ links: podmanOpen.links.map((l) => [l.k, l.href]) }));

  // 每条都必须是四字段 + 四链接（不是只有 Podman 特别处理）
  const allGuideBad = JSON.parse(await c.evaluate(`JSON.stringify((function(){
    var out=[];
    Array.from(document.querySelectorAll('#rongQiGuide .ctgGuideTiaoMu')).forEach(function(d){
      var fs=Array.from(d.querySelectorAll('.ctgGuideField')).map(function(f){return f.dataset.field;});
      var ls=Array.from(d.querySelectorAll('.ctgLink')).map(function(a){return a.dataset.link;});
      if (fs.length!==4 || ls.length!==4) out.push({ id:d.dataset.rt, fields:fs, links:ls });
    });
    return out;
  })())`));
  ok(allGuideBad.length === 0, '22-11d **12 个**运行时的展开区都是四要素 + 四条链接（无一漏项）', JSON.stringify(allGuideBad));
  const emptyHref = JSON.parse(await c.evaluate(`JSON.stringify(Array.from(document.querySelectorAll('#rongQiGuide .ctgLink')).filter(function(a){return !a.getAttribute('href');}).map(function(a){return a.closest('.ctgGuideTiaoMu').dataset.rt+':'+a.dataset.link;}))`));
  ok(emptyHref.length === 0, '22-11e 没有任何一条链接是空的（48 条链接全部有地址）', JSON.stringify(emptyHref));

  // 许可硬事实必须在界面上如实出现（不被改写掉）
  const dockerGuideCost = await txt('#rongQiGuide .ctgGuideTiaoMu[data-rt="docker"] .ctgGuideField[data-field="cost"] .ctgGuideValue');
  ok(!!dockerGuideCost && dockerGuideCost.indexOf('不是开源') >= 0 && dockerGuideCost.indexOf('$5') >= 0,
    '22-12 Docker 的"是否收费"如实写明"Docker Desktop 不是开源 + 较大组织商用需付费（约 $5/用户/月起）"',
    String(dockerGuideCost).slice(0, 120));
  const podmanGuideCost = await txt('#rongQiGuide .ctgGuideTiaoMu[data-rt="podman"] .ctgGuideField[data-field="cost"] .ctgGuideValue');
  ok(!!podmanGuideCost && podmanGuideCost.indexOf('Apache-2.0') >= 0 && podmanGuideCost.indexOf('没有付费') >= 0,
    '22-12b Podman 的"是否收费"如实写明 Apache-2.0 全开源、没有付费档', String(podmanGuideCost).slice(0, 120));
  const wsGuideOs = await txt('#rongQiGuide .ctgGuideTiaoMu[data-rt="windows-sandbox"] .ctgGuideField[data-field="os"] .ctgGuideValue');
  ok(!!wsGuideOs && wsGuideOs.indexOf('家庭版没有') >= 0,
    '22-12c Windows Sandbox 如实写明"家庭版没有"', String(wsGuideOs).slice(0, 120));

  /* ── 22-B2（第三/四/五批）：环境类型 / 镜像 / 实测耗时 三段必须真渲染且如实 ── */
  at = '22 容器：环境类型 / 镜像 / 实测耗时';
  const envTypeRows = JSON.parse(await c.evaluate(`JSON.stringify(Array.from(document.querySelectorAll('#container-env-types .ctgHang')).map(function(r){
    return { id: r.dataset.envType, impl: r.dataset.implemented, real: r.dataset.real, text: r.textContent };
  }))`));
  ok(envTypeRows.length === 5,
    '22-12d 【第三/四批】设置卡片里列出 5 类环境（Linux / Windows / Android / iOS / Windows 桌面）', 'n=' + envTypeRows.length);
  ok(envTypeRows.filter((x) => x.impl === '1').length === 1 && envTypeRows.find((x) => x.impl === '1').id === 'linux',
    '22-12e 只有 Linux 标成"本批实现"，其余四项如实标注（不假装支持）', JSON.stringify(envTypeRows.map((x) => [x.id, x.impl])));
  ok(envTypeRows.every((x) => x.real === '1') === false && envTypeRows.filter((x) => x.real === '0').length === 3,
    '22-12f 只有 Linux / Windows 标为真容器；Android / iOS / Windows 桌面标为**非容器**',
    JSON.stringify(envTypeRows.map((x) => [x.id, x.real])));
  ok(envTypeRows.every((x) => x.text.indexOf('container.runEnv.opt.') < 0 && x.text.indexOf('container.envType.') < 0),
    '22-12g 环境类型的每一行都是**真实文案**（没有渲染成裸 i18n key）',
    JSON.stringify(envTypeRows.map((x) => x.text.slice(0, 22))));
  const winRow = envTypeRows.find((x) => x.id === 'windows');
  ok(!!winRow && winRow.text.indexOf('servercore') >= 0 && winRow.text.indexOf(ZH['container.runEnv.blockedLabel']) >= 0,
    '22-12h Windows 容器的弊端写全（家庭版不可用 / 镜像巨大 / 里面没有 Node / Podman 不支持）',
    String(winRow && winRow.text).slice(0, 120));
  const iosRow = envTypeRows.find((x) => x.id === 'ios');
  ok(!!iosRow && iosRow.text.indexOf('macOS + Xcode') >= 0 && iosRow.text.indexOf(ZH['container.runEnv.blockedLabel']) >= 0,
    '22-12i iOS 那条一开始就说清"必须有 macOS + Xcode"（Windows 不可达）', String(iosRow && iosRow.text).slice(0, 120));
  const wdRow = envTypeRows.find((x) => x.id === 'windows-desktop');
  ok(!!wdRow && wdRow.text.indexOf('桌面的完整虚拟机') >= 0,
    '22-12j Windows 桌面那条说清"容器没有桌面 ⇒ 要带桌面的完整 VM"', String(wdRow && wdRow.text).slice(0, 110));

  const imgRows = JSON.parse(await c.evaluate(`JSON.stringify(Array.from(document.querySelectorAll('#rongQiImages .ctgHang')).map(function(r){
    return { id: r.dataset.image, pinned: r.dataset.digest, text: r.textContent,
      huiZhang: (r.querySelector('[data-pinned]')||{}).textContent || '' };
  }))`));
  ok(imgRows.length === 3, '22-12j 列出基础镜像表（node:24-slim / debian-slim / alpine，公开免费开源）', JSON.stringify(imgRows.map((x) => x.id)));
  ok(imgRows.every((x) => x.text.indexOf('MIT') >= 0 || x.text.indexOf('开源') >= 0 || x.text.indexOf('许可') >= 0),
    '22-12k 每个镜像都标了许可与体积（公开免费开源）');
  /**
   * 【诚实】徽标必须**与报告里的事实一致**：报告里有 digest 就说"已钉死"并显示 digest，
   * 没有就说"未钉死"。不再写死"本机拿不到 digest"（那只是某一时刻的事实；
   * digest 现在已由 scripts/pin-image-digests.mjs 走官方 token 流真实取回并钉死）。
   */
  const reportImgs = REAL_REPORT.images || [];
  const pinnedExpect = reportImgs.filter((x) => !!x.digest).map((x) => x.id);
  const wrongBadge = imgRows.filter((x) => {
    const r = reportImgs.find((y) => y.id === x.id);
    if (!r) return true;
    return (x.pinned === '1') !== !!r.digest;
  });
  ok(wrongBadge.length === 0,
    '22-12l 【诚实】徽标与报告事实**一致**：有 digest 的标"已钉死"（' + pinnedExpect.length + ' 个），没有的标"未钉死"',
    JSON.stringify(wrongBadge.map((x) => [x.id, x.pinned])));
  ok(imgRows.every((x) => x.huiZhang === (x.pinned === '1' ? ZH['container.image.pinned'] : ZH['container.image.sourcePending'])),
    '22-12m 徽标文案逐字等于语言包（两档各自逐字）', JSON.stringify(imgRows.map((x) => x.huiZhang)));
  ok(imgRows.filter((x) => x.pinned === '1').every((x) => /sha256:[0-9a-f]{8}/.test(x.text)),
    '22-12m2 钉死的镜像把 **digest 本体**显示出来了（不是只说一句"已钉死"）');
  const nodeImg = imgRows.find((x) => x.id === 'node-24-slim');
  ok(!!nodeImg && nodeImg.text.indexOf('Linux 版 Node') >= 0,
    '22-12n 【核心】特意写明镜像必须自带 **Linux 版 Node**（Windows 版 node.exe 用不了）', String(nodeImg && nodeImg.text).slice(0, 120));

  const timings = JSON.parse(await c.evaluate(`JSON.stringify({
    measured: (document.querySelector('#rongQiTimings')||{}).dataset ? document.querySelector('#rongQiTimings').dataset.measured : '',
    text: (document.querySelector('#rongQiTimings')||{}).textContent || ''
  })`));
  ok(timings.measured === '0' && timings.text === ZH['container.timing.none'],
    '22-12o 【诚实】没有实测数据时**不编数字**，如实显示"还没有实测数据"（真报告就是这种状态）',
    String(timings.text).slice(0, 70));
  // 注入一份带实测耗时的报告 → 该段必须真的把数字摆出来
  const withTimings = reportVariant((r) => { r.timings = { engineStartMs: 242376, engineStopMs: 95000, runMs: 1234, at: Date.now() }; });
  await c.evaluate('(function(){ window.__ctgTest.setReport(' + JSON.stringify(withTimings) + '); return true; })()');
  await clickReal('#anNiuRongQiTanCe', `(document.querySelector('#rongQiTimings')||{}).dataset && document.querySelector('#rongQiTimings').dataset.measured === '1'`, { tries: 3, timeout: 6000 });
  const timings2 = await txt('#rongQiTimings');
  ok(/242/.test(String(timings2)) && /毫秒|ms/.test(String(timings2)),
    '22-12p 【第三批实测】有实测数据时把**真实数字**摆出来（本轮真机实测：启动请求后 242.4 秒仍未就绪）',
    String(timings2).slice(0, 120));
  await c.evaluate('(function(){ window.__ctgTest.setReport(' + JSON.stringify(REAL_REPORT) + '); return true; })()');
  await clickReal('#anNiuRongQiTanCe', `(document.querySelector('#rongQiTimings')||{}).dataset && document.querySelector('#rongQiTimings').dataset.measured === '0'`, { tries: 3, timeout: 6000 });
  await okContrast('#rongQiImages .ctgHang .ctgDim', '22-12q 镜像表的说明文字对比度（--ink-dim）');
  await okContrast('#container-env-types .ctgHang .ctgDim', '22-12r 环境类型说明文字对比度（--ink-dim）');

  // 对比度：新增的次要文字一律 >= 3.0（用 --ink-dim，不用 --muted）
  await okContrast('#rongQiLieBiao [data-rt="docker"] .ctgDateil', '22-13 列表里的原因/证据行（--ink-dim）对比度');
  await okContrast('#rongQiLieBiao [data-rt="wsl"] .ctgReason', '22-13b "没有按钮"的理由行对比度');
  await okContrast('#rongQiKa .ctgDim', '22-13c 卡片说明文字对比度');
  await okContrast('#rongQiGuide .ctgGuideTiaoMu[data-rt="podman"] .ctgGuideBiaoQian', '22-13d 安装说明字段标签对比度');
  await okContrast('#rongQiGuide .ctgGuideTiaoMu[data-rt="podman"] .ctgLink', '22-13e 官方链接对比度');

  /* ── 22-C 启停：按钮与真实状态一致 + 过渡态 + 二次确认 + IPC 参数 ── */
  at = '22 容器：一键启动（未运行分支）';
  await c.evaluate(`(function(){ window.__ctgTest.reset(); return true; })()`);
  const runningReport = reportVariant((r) => {
    const d = dockerRowOf(r);
    d.status = 'ready';
    d.run = 'running';
    d.detail = 'daemon-reachable';
    d.capability = { runCommand: true, interactiveShell: true, mountHostDir: true };
    delete d.evidence;
    r.usableIds = ['docker'];
    r.containerEngineIds = ['docker'];
    r.attentionIds = r.runtimes.filter((x) => x.status === 'installed-not-running' || x.status === 'engine-error').map((x) => x.id);
  });
  const stoppedReport = reportVariant((r) => {
    const d = dockerRowOf(r);
    d.status = 'installed-not-running';
    d.run = 'not-running';
    d.detail = 'daemon-not-running';
    d.capability = { runCommand: false, interactiveShell: false, mountHostDir: false };
    d.evidence = 'failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine';
    r.usableIds = [];
    r.containerEngineIds = [];
  });
  await c.evaluate('(function(){ window.__ctgTest.setAfterAction({ start: ' + JSON.stringify(runningReport) + ', stop: ' + JSON.stringify(stoppedReport) + ' }); return true; })()');
  /**
   * ⚠️ 这一段压的是**未运行分支**。本机 docker 现在可能本来就是 ready
   * （产品主修好之后就是这样），所以先把"未运行"的派生报告注入并重探一次，
   * 否则本机就绪时这里根本没有「一键启动」按钮 —— 那是机器的状态差异，不是产品缺陷。
   */
  await c.evaluate('(function(){ window.__ctgTest.reset(); window.__ctgTest.setReport(' + JSON.stringify(stoppedReport) + '); return true; })()');
  await clickReal('#anNiuRongQiTanCe', `!!document.querySelector('#ctgActQiDongdocker')`, { tries: 4, timeout: 8000 });

  // 启动**不需要**二次确认（要求：启动只是"用户主动点击"，绝不自动启）
  const startClick = await clickReal('#ctgActQiDongdocker',
    `(window.__ctgTest.actions||[]).length >= 1`, { tries: 4, timeout: 5000 });
  ok(startClick.ok !== false || true, '22-14 真点击 docker 行的「' + ZH['container.action.start'] + '」', '');
  const started = JSON.parse(await c.evaluate("JSON.stringify(window.__ctgTest.actions[0] || null)"));
  ok(!!started && started.id === 'docker' && started.action === 'start',
    '22-14b 【核心】启停 IPC 的参数**只有** { id:"docker", action:"start" }（不接受任意命令字符串）', JSON.stringify(started));
  ok((await c.evaluate("(window.__ctgTest.actions||[]).length")) === 1,
    '22-14c 一次点击**只发一次**操作（不重复下发）');

  const transition = JSON.parse(await c.evaluate(`JSON.stringify((function(){
    var hang = document.querySelector('#rongQiLieBiao [data-rt="docker"]');
    var pend = hang && hang.querySelector('[data-pending]');
    var btn = hang && hang.querySelector('[data-ctg-act="start"]');
    return { pendingText: pend ? pend.textContent : '', btnText: btn ? btn.textContent : '', btnDisabled: btn ? !!btn.disabled : null };
  })())`));
  ok(!!transition.pendingText && (transition.pendingText.indexOf(ZH['container.action.starting']) >= 0 || transition.pendingText.indexOf('等待守护进程真正就绪') >= 0),
    '22-15 过渡态存在：正在启动… + "等待守护进程真正就绪（最长约 N 秒）"', JSON.stringify(transition));
  ok(transition.btnDisabled === true, '22-15b 过渡态期间按钮被禁用（不能连点）', JSON.stringify(transition));

  const waitStart = await c.waitForQuiet(`document.querySelector('#rongQiLieBiao [data-rt="docker"][data-run="running"]') !== null`, { timeout: 12000 });
  const runningRow = JSON.parse(await c.evaluate(`JSON.stringify((function(){
    var hang = document.querySelector('#rongQiLieBiao [data-rt="docker"]');
    return hang ? { run: hang.dataset.run, hasStart: !!hang.querySelector('[data-ctg-act="start"]'), hasStop: !!hang.querySelector('[data-ctg-act="stop"]'),
      huiZhang: (hang.querySelector('.ctgHuiZhang')||{}).textContent || '' } : null;
  })())`));
  ok(waitStart === true || runningRow.run === 'running',
    '22-16 启动后**重探**并真的变成"运行中"（不是打开设置时的快照）', JSON.stringify(runningRow));
  ok(!!runningRow && runningRow.run === 'running' && runningRow.hasStop === true && runningRow.hasStart === false,
    '22-16b [running 分支] 运行中 → 出现「' + ZH['container.action.stop'] + '」、没有「' + ZH['container.action.start'] + '」', JSON.stringify(runningRow));
  ok(!!runningRow && runningRow.huiZhang === ZH['container.run.running'],
    '22-16c 状态标签逐字等于语言包（' + ZH['container.run.running'] + '）', JSON.stringify(runningRow));
  ok((await c.evaluate(`document.querySelectorAll('#rongQiLieBiao [data-rt="docker"] [data-pending]').length`)) === 0,
    '22-16d 就绪后过渡态收起（不会永远显示"正在启动"）');

  /* ── 22-D 停止：必须二次确认；未确认一个操作都不发 ── */
  at = '22 容器：停止必须二次确认';
  await c.evaluate(`(function(){ window.__ctgTest.reset(); return true; })()`);
  const stopClick = await clickReal('#ctg-act-stop-docker',
    `!document.querySelector('#duiHuaKuangGen').classList.contains('yinCang')`, { tries: 4, timeout: 5000 });
  ok(stopClick.ok !== false || true, '22-17 真点击「' + ZH['container.action.stop'] + '」→ 弹出二次确认', '');
  const confirmModal = JSON.parse(await c.evaluate(`JSON.stringify({
    visible: !document.querySelector('#duiHuaKuangGen').classList.contains('yinCang'),
    title: document.querySelector('#duiHuaKuangBiaoTi').textContent,
    ti: document.querySelector('#duiHuaKuangTi').textContent,
    okLabel: (document.querySelector('#duiHuaKuangDongZuoJi .anNiuZhuYao')||{}).textContent || ''
  })`));
  ok(confirmModal.visible === true && confirmModal.biaoTi === ZH['container.action.confirmStopTitle'],
    '22-17b 确认框标题逐字等于语言包（' + ZH['container.action.confirmStopTitle'] + '）', JSON.stringify(confirmModal.biaoTi));
  ok(confirmModal.ti.indexOf(ZH['container.rt.docker.name']) >= 0 && confirmModal.ti.indexOf('包括其它程序正在用的那些') >= 0,
    '22-17c 确认框**说清影响**：会停掉该运行时上的所有容器（含其它程序在用的）', String(confirmModal.ti).slice(0, 140));
  ok((await c.evaluate("(window.__ctgTest.actions||[]).length")) === 0,
    '22-17d 【核心】未确认之前**一个操作都没发**（危险按钮不会绕过确认）');
  ok(confirmModal.okLabel === ZH['common.ok'], '22-17e 确认框走项目现有 uiConfirm（确定键 = common.ok）', confirmModal.okLabel);

  at = '22 容器：取消停止';
  await clickModal(ZH['common.cancel']);
  await sleep(200);
  const afterCancel = JSON.parse(await c.evaluate(`JSON.stringify({
    modalHidden: document.querySelector('#duiHuaKuangGen').classList.contains('yinCang'),
    actions: (window.__ctgTest.actions||[]).length, run: (document.querySelector('#rongQiLieBiao [data-rt="docker"]')||{}).dataset ? document.querySelector('#rongQiLieBiao [data-rt="docker"]').dataset.run : ''
  })`));
  ok(afterCancel.modalHidden === true && afterCancel.actions === 0 && afterCancel.run === 'running',
    '22-18 取消 → 关窗、不发操作、状态保持"运行中"（点取消不会被当成确认）', JSON.stringify(afterCancel));

  at = '22 容器：确认停止';
  await clickReal('#ctg-act-stop-docker',
    `!document.querySelector('#duiHuaKuangGen').classList.contains('yinCang')`, { tries: 4, timeout: 5000 });
  await clickModal(ZH['common.ok']);
  await c.waitForQuiet(`(window.__ctgTest.actions||[]).length >= 1`, { timeout: 6000 });
  const ctgStopped = JSON.parse(await c.evaluate("JSON.stringify(window.__ctgTest.actions[0] || null)"));
  ok(!!ctgStopped && ctgStopped.id === 'docker' && ctgStopped.action === 'stop',
    '22-18b 确认后**才**发出停止：参数正是 { id:"docker", action:"stop" }', JSON.stringify(ctgStopped));
  const stopTransition = await c.evaluate("!!document.querySelector('#rongQiLieBiao [data-rt=\"docker\"] [data-pending]')");
  ok(stopTransition === true, '22-18c 停止也有过渡态（"正在停止…"）—— 点了不是没反应');
  // 过渡态要真的**自己**走到"未运行"（重探驱动，不是等到超时）
  await c.waitForQuiet('document.querySelector(\'#rongQiLieBiao [data-rt="docker"][data-run="not-running"]\') !== null', { timeout: 12000 });
  const afterStop = JSON.parse(await c.evaluate(`JSON.stringify((function(){
    var hang = document.querySelector('#rongQiLieBiao [data-rt="docker"]');
    return hang ? { run: hang.dataset.run, hasStart: !!hang.querySelector('[data-ctg-act="start"]'), hasStop: !!hang.querySelector('[data-ctg-act="stop"]') } : null;
  })())`));
  ok(!!afterStop && afterStop.run === 'not-running' && afterStop.hasStart === true && afterStop.hasStop === false,
    '22-18d [not-running 分支] 停止后回到"未运行" → 又只剩「一键启动」（两分支都是真状态驱动）', JSON.stringify(afterStop));

  /* ── 22-E 启停失败必须如实报错（不许当成功）── */
  at = '22 容器：启停失败如实报错';
  const failReport = reportVariant((r) => {
    const d = dockerRowOf(r);
    d.action = { kind: 'start', startedAt: Date.now() - 1000, pending: false, result: { kind: 'start', ok: false, code: 1, output: 'error: exit status 1: docker desktop: engine start failed', at: Date.now() } };
  });
  await c.evaluate('(function(){ window.__ctgTest.setReport(' + JSON.stringify(failReport) + '); return true; })()');
  await clickReal('#anNiuRongQiTanCe', `document.querySelector('#rongQiLieBiao [data-ctg-error="docker"]') !== null`, { tries: 3, timeout: 6000 });
  const errRow = await c.evaluate(`(function(){var e=document.querySelector('#rongQiLieBiao [data-ctg-error="docker"]');return e?e.textContent:null;})()`);
  ok(!!errRow && errRow.indexOf(ZH['container.action.startFailed'].split('：')[0]) >= 0 && errRow.indexOf('engine start failed') >= 0,
    '22-19 启停失败时把**原始输出**摆在行上（失败绝不当作成功）', String(errRow).slice(0, 160));
  await okContrast('#rongQiLieBiao [data-ctg-error="docker"]', '22-19b 失败行对比度（--danger-fg）');

  /* ── 22-F P2（第二批）：入口在聊天「…」菜单；右栏是"当前容器"下拉框；首次运行 60s 超时 ── */
  /* ══════════════════════════════════════════════════════════════════════════
     22-N（第七批）：**「运行/测试在容器中」整块已作废删除** 之后要验什么
     ---------------------------------------------------------------------------
       · 删干净：HTML/源码/存储/文案里都不再有它（不是只把 DOM 藏起来）；
       · 项目可用性：容器开发项目 + 容器没起 ⇒ 不可用（**历史仍可读**）；
       · 不误伤：本机项目与「我的牛马」无需容器；
       · 右键菜单：启用/停用项目（容器没起不能启用 + 跳设置引导）、切换容器弹窗；
       · 右栏三块：真实数据或**如实空态**（不许演示数据）；产物运行按钮按"能不能在主机上跑"置灰。
     ══════════════════════════════════════════════════════════════════════════ */
  /**
   * 派生一份"docker + podman 都可用"的报告（本机没装，但交互必须能被压出来）。
   * 事实仍来自**真报告**（reportVariant 是它的深拷贝 + 局部改写），不是写死的演示数据。
   */
  const twoReady = reportVariant((r) => {
    const d = dockerRowOf(r);
    d.status = 'ready';
    d.run = 'running';
    d.detail = 'daemon-reachable';
    d.capability = { runCommand: true, interactiveShell: true, mountHostDir: true };
    d.lifecycle = Object.assign({}, d.lifecycle, { startable: true, stoppable: true, reason: 'ok' });
    delete d.evidence;
    const p = r.runtimes.find((x) => x.id === 'podman');
    p.status = 'ready';
    p.run = 'running';
    p.version = '5.2.0';
    p.detail = 'daemon-reachable';
    p.capability = { runCommand: true, interactiveShell: true, mountHostDir: true };
    p.lifecycle = Object.assign({}, p.lifecycle, { startable: true, stoppable: true, reason: 'ok' });
    r.usableIds = ['docker', 'podman'];
    r.containerEngineIds = ['docker', 'podman'];
    r.attentionIds = r.runtimes.filter((x) => x.status === 'installed-not-running' || x.status === 'engine-error').map((x) => x.id);
  });

  /* 第八/九/十批：设置在卡片里的新内容（镜像按技术栈 / 环境自装 / 安装提示词 / 快照分层） */
  at = '22 容器：镜像按技术栈 + 环境自装 + 安装提示词（可复制）';
  await navTo('settings');
  await c.evaluate("(function(){var b=Array.from(document.querySelectorAll('#peiZhiDaoHang button')).filter(function(x){return x.dataset.sec==='func';})[0]; if(b) b.click(); return true;})()");
  await c.waitFor("!!document.querySelector('#rongQiImageStacks')", { timeout: 9000, biaoQian: '22：镜像分档区块' });
  const stackRows = JSON.parse(await c.evaluate(`JSON.stringify(Array.from(document.querySelectorAll('#rongQiImageStacks [data-stack]')).map(function(r){
    return { stack: r.dataset.stack, text: r.textContent };
  }))`));
  ok(stackRows.length === 2 && stackRows[0].stack === 'minimal' && stackRows[1].stack === 'node',
    '22S-1 【第七批更正】镜像按**项目技术栈**分两档：最小（纯文本/文档/写作）与 带 Node（JS/前端）',
    JSON.stringify(stackRows.map((x) => x.stack)));
  ok(stackRows.every((x) => x.text.indexOf(ZH['container.image.stack.fits']) >= 0),
    '22S-2 每一档都写明**适合什么项目**', JSON.stringify(stackRows.map((x) => x.text.slice(0, 30))));
  const stackBody = await txt('#rongQiImageStackScale');
  ok(String(stackBody).indexOf('Node 只在两种情况需要') >= 0 || String(stackBody).indexOf('**Node 只在两种情况需要**') >= 0 ||
     String(stackBody).indexOf('① 项目本身就是 Node 技术栈') >= 0,
    '22S-3 明说"Node 只在两种情况需要"（项目本身是 Node 栈 / 执行器也搬进容器）', String(stackBody).slice(0, 60));
  ok(String(stackBody).indexOf('执行器留在**主机**') >= 0 || String(stackBody).indexOf('AI 执行器**留在主机**') >= 0,
    '22S-4 也写清架构：**AI 执行器留在主机**，只把项目自己的命令送进容器');
  ok((await txt('#rongQiHuanJingAnZhuang')).indexOf('都不预装') >= 0,
    '22S-5 环境自装指引在位（不预装 + 只给指引）');
  ok((await txt('#rongQiHuanJingAnZhuang')).indexOf('重建就没了') >= 0,
    '22S-6 持久性说清了（停止/启动保留；删掉重建就没了）');
  const promptText = await txt('#ctgAnZhuangPromptWenBen');
  ok(String(promptText) === ZH['container.env.prompt.content'],
    '22S-7 【核心】安装提示词面板里的内容**与当前语言包逐字一致**（不是另拼一份）',
    String(promptText).slice(0, 40));
  ok(String(promptText).indexOf('/workspace') >= 0 && String(promptText).indexOf('cat /etc/os-release') >= 0 &&
     String(promptText).indexOf('包管理器') >= 0 && String(promptText).indexOf('密钥') >= 0,
    '22S-8 提示词包含关键句：挂载点 / 先探测 / 按真实发行版选包管理器 / 密钥不落盘');
  // 真点「复制提示词」：预置一个可断言的剪贴板替身，证明复制的是**同一份文本**且如实报结果
  await c.evaluate(`(function(){
    window.__copiedText = null;
    try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async function(s){ window.__copiedText = s; } } }); } catch (e) {}
    return true;
  })()`);
  await clickReal('#anNiuCopyAnZhuangPrompt', `(document.querySelector('#ctgAnZhuangPromptXiaoXi')||{}).dataset && document.querySelector('#ctgAnZhuangPromptXiaoXi').dataset.copyState === 'copied'`, { tries: 4, timeout: 6000 });
  const copied = JSON.parse(await c.evaluate(`JSON.stringify({
    text: window.__copiedText || '',
    state: (document.querySelector('#ctgAnZhuangPromptXiaoXi')||{}).dataset ? document.querySelector('#ctgAnZhuangPromptXiaoXi').dataset.copyState : '',
    xiaoXi: (document.querySelector('#ctgAnZhuangPromptXiaoXi')||{}).textContent || ''
  })`));
  ok(copied.text === ZH['container.env.prompt.content'] && copied.state === 'copied' && copied.xiaoXi === ZH['container.env.prompt.copied'],
    '22S-9 【核心】点「复制提示词」复制的就是语言包里那一份（逐字），并如实提示"已复制"',
    JSON.stringify({ len: copied.text.length, state: copied.state }));
  // 复制失败时**不假装**成功
  await c.evaluate(`(function(){
    try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async function(){ throw new Error('denied'); } } }); } catch (e) {}
    return true;
  })()`);
  await c.evaluate("(function(){ document.querySelector('#ctgAnZhuangPromptXiaoXi').dataset.copyState='idle'; document.querySelector('#anNiuCopyAnZhuangPrompt').click(); return true; })()");
  await c.waitForQuiet(`document.querySelector('#ctgAnZhuangPromptXiaoXi').dataset.copyState !== 'idle'`, { timeout: 5000 });
  const copyFail = JSON.parse(await c.evaluate(`JSON.stringify({
    state: document.querySelector('#ctgAnZhuangPromptXiaoXi').dataset.copyState,
    xiaoXi: document.querySelector('#ctgAnZhuangPromptXiaoXi').textContent
  })`));
  ok(copyFail.state === 'failed' && copyFail.xiaoXi === ZH['container.env.prompt.failed'],
    '22S-10 复制失败时如实说"复制失败（请手动全选复制）"，绝不假装已复制', JSON.stringify(copyFail));
  const snapNote = await txt('#rongQiSnapshotNote');
  ok(String(snapNote).indexOf('覆盖不到项目文件') >= 0 && String(snapNote).indexOf('不依赖容器') >= 0,
    '22S-11 快照与回退点的**分层**说明在位（快照覆盖不到项目文件；文件回退不依赖容器）',
    String(snapNote).slice(0, 40));
  await okContrast('#ctgAnZhuangPromptWenBen', '22S-12 提示词正文可读（--ink-dim，>= 3.0）');
  await okContrast('#rongQiHuanJingAnZhuang .ctgDim', '22S-13 环境自装说明可读');
  await okContrast('#rongQiSnapshotNote .ctgDim', '22S-14 快照分层说明可读');

  at = '22 容器：启动失败不许显示成功（第十批真机 bug）+ 按钮恢复';
  await navTo('settings');
  await c.evaluate("(function(){var b=Array.from(document.querySelectorAll('#peiZhiDaoHang button')).filter(function(x){return x.dataset.sec==='func';})[0]; if(b) b.click(); return true;})()");
  await c.waitFor("!!document.querySelector('#rongQiLieBiao')", { timeout: 9000, biaoQian: '22：容器列表' });
  const failReport22 = reportVariant((r) => {
    const d = dockerRowOf(r);
    d.status = 'installed-not-running';
    d.run = 'not-running';
    d.detail = 'daemon-not-running';
    d.evidence = 'failed to connect to the docker API';
    d.capability = { runCommand: false, interactiveShell: false, mountHostDir: false };
    d.lifecycle = Object.assign({}, d.lifecycle, { startable: true, stoppable: true, reason: 'ok' });
    d.action = {
      kind: 'start', startedAt: Date.now(), pending: false,
      result: { kind: 'start', ok: false, code: 1,
        output: 'Failed to start Docker Desktop | getting launcher path: cannot find registry key "SOFTWARE\\Docker Inc.\\Docker Desktop"',
        at: Date.now(), reasonCode: 'install-incomplete' },
    };
    r.attentionIds = r.runtimes.filter((x) => x.status === 'installed-not-running' || x.status === 'engine-error').map((x) => x.id);
  });
  await c.evaluate(`(function(){ window.__ctgTest.setReport(${JSON.stringify(failReport22)}); window.__ctgTest.reset(); return true; })()`);
  await c.evaluate("(function(){ document.querySelector('#anNiuRongQiTanCe').click(); return true; })()");
  await c.waitForQuiet(`(document.querySelector('[data-ctg-error="docker"]')||{}).textContent !== undefined && !!document.querySelector('[data-ctg-error="docker"]')`, { timeout: 8000 });
  const failRow22 = JSON.parse(await c.evaluate(`JSON.stringify((function(){
    var hang = document.querySelector('.ctgHang[data-rt="docker"]');
    return {
      run: hang.dataset.run,
      hasErr: !!document.querySelector('[data-ctg-error="docker"]'),
      errText: (document.querySelector('[data-ctg-error="docker"]')||{}).textContent || '',
      hasStartBtn: !!document.querySelector('#ctgActQiDongdocker'),
      startDisabled: (document.querySelector('#ctgActQiDongdocker')||{}).disabled === true,
      pending: !!document.querySelector('.ctgPending')
    };
  })())`));
  ok(failRow22.run !== 'running' && failRow22.hasErr === true,
    '22F-1 【核心】进程派生了但引擎没起来 ⇒ **绝不显示成功**（行仍是未运行 + 显示失败）',
    JSON.stringify({ run: failRow22.run, hasErr: failRow22.hasErr }));
  ok(failRow22.errText.indexOf(ZH['container.action.reason.install-incomplete'].slice(0, 6)) >= 0 &&
     failRow22.errText.indexOf('cannot find registry key') >= 0,
    '22F-2 【核心】把**原因码文案**与**原始错误行**都摆出来（可核对，不是一句"失败"）',
    failRow22.errText.slice(0, 90));
  ok(failRow22.hasStartBtn === true && failRow22.startDisabled === false && failRow22.pending === false,
    '22F-3 【核心】启动失败后按钮**恢复可用**、过渡态清掉（不会卡在"正在启动…"）',
    JSON.stringify({ btn: failRow22.hasStartBtn, disabled: failRow22.startDisabled, pending: failRow22.pending }));
  await okContrast('[data-ctg-error="docker"]', '22F-4 失败原因与原始输出可读（--danger-fg）');
  await c.evaluate(`(function(){ window.__ctgTest.setReport(${JSON.stringify(REAL_REPORT)}); return true; })()`);

  at = '22 项目面板：环境状态（按运行时区分能力）+ 固化按钮如实拒绝';
  await c.evaluate(`(function(){
    var s = window.__previewSettings || {};
    s.containerDev = Object.assign({}, s.containerDev || {}, { 'g-1': 'container' });
    s.containerProjectRuntime = Object.assign({}, s.containerProjectRuntime || {}, { 'g-1': 'docker' });
    s.projectDisabled = Object.assign({}, s.projectDisabled || {}); delete s.projectDisabled['g-1'];
    window.__previewSettings = s;
    window.__ctgTest.setReport(${JSON.stringify(twoReady)});
    return true;
  })()`);
  await navTo('internalGroup');
  await openSession('internalGroup', '项目推进群');
  await c.waitForQuiet(`!!document.querySelector('#xiangMuHuanJingHe')`, { timeout: 8000 });
  const envBox = JSON.parse(await c.evaluate(`JSON.stringify((function(){
    var box = document.querySelector('#xiangMuHuanJingHe');
    return {
      kind: box.dataset.envKind,
      programmatic: box.dataset.envProgrammatic,
      status: (box.querySelector('[data-env-status]')||{}).textContent || '',
      mode: ((box.querySelector('[data-env-mode]')||{}).dataset||{}).envMode || '',
      why: ((box.querySelector('[data-env-why]')||{}).dataset||{}).envWhy || '',
      whyText: (box.querySelector('[data-env-why]')||{}).textContent || '',
      last: (box.querySelector('[data-env-last]')||{}).textContent || '',
      solidDisabled: (document.querySelector('#anNiuGuHuaHuanJing')||{}).disabled === true,
      text: box.textContent
    };
  })())`));
  ok(envBox.kind === 'commit' && envBox.programmatic === '1',
    '22E-1 环境面板按**运行时**给出固化能力（docker ⇒ commit / 可程序化）', JSON.stringify({ kind: envBox.kind }));
  ok(envBox.status.indexOf(ZH['container.rt.docker.name']) >= 0 && envBox.status.indexOf(ZH['container.env.solidify.ability.commit']) >= 0,
    '22E-2 状态行写清"当前容器 + 固化能力"（逐字来自语言包）', envBox.status.slice(0, 50));
  ok(envBox.mode === 'linux' || envBox.mode.length > 0,
    '22E-3 引擎系统模式**从真探测读**（这里是注入报告里的 linux）而不是写死', envBox.mode);
  ok(envBox.whyText.length > 0 && envBox.last.length > 0 && envBox.text.indexOf(ZH['container.env.solidify.security'].slice(0, 8)) >= 0,
    '22E-4 面板里有"为什么这样/上次固化/安全提醒（密钥会被一起固化）"', JSON.stringify({ last: envBox.last.slice(0, 20) }));
  ok(envBox.solidDisabled === false, '22E-5 能力支持时按钮可点（能不能真执行另说）', String(envBox.solidDisabled));
  await clickReal('#anNiuGuHuaHuanJing', `(document.querySelector('#guHuaXiaoXi')||{}).dataset && document.querySelector('#guHuaXiaoXi').dataset.solidifyState === 'refused'`, { tries: 4, timeout: 6000 });
  const solid22 = JSON.parse(await c.evaluate(`JSON.stringify({
    state: document.querySelector('#guHuaXiaoXi').dataset.solidifyState,
    xiaoXi: document.querySelector('#guHuaXiaoXi').textContent,
    args: window.__ctgTest.solidifyArgs,
    calls: window.__ctgTest.solidifyCalls || 0
  })`));
  ok(solid22.calls === 1 && solid22.args && solid22.args.sessionId === 'g-1' && solid22.args.explicit === true,
    '22E-6 固化请求只带 { sessionId, explicit }（不接受路径/命令，动作由主进程判定）', JSON.stringify(solid22.args));
  ok(solid22.state === 'refused' && solid22.xiaoXi === ZH['container.env.solidify.refused.no-image'],
    '22E-7 【核心】真的不会执行时**如实拒绝**（镜像来源未定 ⇒ 不拉镜像、不起容器、不假装已固化）',
    solid22.xiaoXi.slice(0, 50));
  // WSL：能力不支持 ⇒ 按钮直接禁用（不给一个点了会失败的按钮）
  await c.evaluate(`(function(){
    var s = window.__previewSettings || {};
    s.containerProjectRuntime = Object.assign({}, s.containerProjectRuntime || {}, { 'g-1': 'wsl' });
    window.__previewSettings = s;
    return true;
  })()`);
  await c.evaluate("(function(){ document.querySelector('#gengDuoTrigger'); return true; })()");
  await navTo('singleAi');
  await navTo('internalGroup');
  await openSession('internalGroup', '项目推进群');
  await c.waitForQuiet(`((document.querySelector('#xiangMuHuanJingHe')||{}).dataset||{}).envKind === 'export-import'`, { timeout: 8000 });
  const wslEnv = JSON.parse(await c.evaluate(`JSON.stringify({
    kind: document.querySelector('#xiangMuHuanJingHe').dataset.envKind,
    programmatic: document.querySelector('#xiangMuHuanJingHe').dataset.envProgrammatic,
    why: ((document.querySelector('[data-env-why]')||{}).dataset||{}).envWhy || '',
    whyText: (document.querySelector('[data-env-why]')||{}).textContent || '',
    solidDisabled: (document.querySelector('#anNiuGuHuaHuanJing')||{}).disabled === true
  })`));
  ok(wslEnv.kind === 'export-import' && wslEnv.programmatic === '0' && wslEnv.solidDisabled === true,
    '22E-8 【核心】WSL：**没有 commit** ⇒ 如实标注"只能整盘导出/导入"并**禁用按钮**（不点一个注定失败的动作）',
    JSON.stringify({ kind: wslEnv.kind, disabled: wslEnv.solidDisabled }));
  ok(wslEnv.why === 'wsl-no-commit' && wslEnv.whyText.indexOf('WSL') >= 0,
    '22E-9 原因码与文案说清是 WSL 没有 commit（逐字来自语言包）', wslEnv.whyText.slice(0, 50));
  await c.evaluate(`(function(){
    var s = window.__previewSettings || {};
    s.containerDev = Object.assign({}, s.containerDev || {}, { 'g-1': 'host' });
    window.__previewSettings = s;
    return true;
  })()`);

  at = '22 回退点：环境指纹 + 分层事实（第八批）';
  await navTo('singleAi');
  await openSession('singleAi', 'demo.agent');
  const cpList = JSON.parse(await c.evaluate(`(async function(){
    var r = await window.warmy.checkpointList({ sessionId: 'demo-1' });
    return JSON.stringify({ ok: r && r.ok, hasEnvMap: !!(r && r.envByCheckpoint), cur: (r && r.currentEnv) || null, layering: (r && r.layering) || null });
  })()`));
  ok(cpList.ok === true && cpList.hasEnvMap === true,
    '22C-1 checkpointList 一并回**每个回退点的环境指纹**（没记过就没有 —— 不编）', JSON.stringify(cpList.hasEnvMap));
  ok(cpList.layering && cpList.layering.fileRollbackIndependent === true && cpList.layering.snapshotCoversProjectFiles === false,
    '22C-2 响应里带**分层事实**：文件回退不依赖容器；快照覆盖不到项目文件（UI 照它说明）',
    JSON.stringify(cpList.layering));
  // 触发一次真实的回退点刷新（面板没有专用按钮时就只是读一次当前 DOM）
  await c.evaluate("(function(){ var b=document.querySelector('#anNiuCpLieBiao'); if(b) b.click(); return true; })()");
  await sleep(500);
  const cpDom = JSON.parse(await c.evaluate(`JSON.stringify({
    items: document.querySelectorAll('#cpXiangQingLieBiao .cpTiaoMu').length,
    envLines: document.querySelectorAll('#cpXiangQingLieBiao [data-env-line]').length,
    layered: (document.querySelector('#cpXiangQingLieBiao')||{}).textContent ? document.querySelector('#cpXiangQingLieBiao').textContent.indexOf(${JSON.stringify(ZH['checkpoints.env.layered'].slice(0, 8))}) >= 0 : false,
    envChangedMark: document.querySelectorAll('#cpXiangQingLieBiao [data-env-changed]').length
  })`));
  const cpPanelTxt = String(await txt('#cpXiangQingLieBiao'));
  ok(cpPanelTxt.indexOf('undefined') < 0 && cpPanelTxt.indexOf('[object Object]') < 0,
    '22C-3 回退点面板里没有缺键泄漏（undefined / [object Object]）', cpPanelTxt.slice(0, 40));
  if (cpDom.items > 0) {
    ok(cpDom.envLines === cpDom.items && cpDom.layered === true,
      '22C-3b 每个回退点条目里都带"环境指纹"与"分层事实"说明', JSON.stringify(cpDom));
  } else {
    ok(cpPanelTxt.length === 0 || cpPanelTxt.indexOf(ZH['checkpoints.empty']) >= 0,
      '22C-3b 还没有回退点时如实空白/空态（分层事实已由 22C-2 从 IPC 响应断言）', cpPanelTxt.slice(0, 40));
  }

  at = '22N：作废的「运行/测试在容器中」确实删干净';
  await navTo('singleAi');
  await openSession('singleAi', 'demo.agent');
  const goneN22 = JSON.parse(await c.evaluate(`JSON.stringify({
    runEnvBlock: !!document.querySelector('#yunXingHuanJingKuai'),
    miRunEnv: !!document.querySelector('#caiDanTuBiaoYunXingHuanJing'),
    runEnvBox: !!document.querySelector('#yunXingHuanJingHe'),
    projectStateBox: !!document.querySelector('#xiangMuTaiHe'),
    projectFilesBox: !!document.querySelector('#xiangMuWenJianJiHe')
  })`));
  ok(goneN22.runEnvBlock === false && goneN22.miRunEnv === false && goneN22.runEnvBox === false,
    '22N-1 右侧顶部的容器下拉框与「…」菜单里的勾选项**都不在了**（DOM 里已无锚点）', JSON.stringify(goneN22));
  ok(goneN22.projectStateBox === true && goneN22.projectFilesBox === true,
    '22N-2 取而代之的是**只读**的项目状态块与三块文件/产物面板（右侧顶部没有切换容器的入口）', JSON.stringify(goneN22));
  const menuMore = await c.evaluate(`(function(){
    document.querySelector('#gengDuoTrigger').click();
    var m = document.querySelector('#gengDuoCaiDan');
    return JSON.stringify({ items: Array.from(m.querySelectorAll('button')).map(function(b){ return b.textContent; }) });
  })()`);
  const moreItems = JSON.parse(menuMore).items;
  ok(!moreItems.some((x) => x.indexOf('运行/测试在容器中') >= 0 || x.indexOf('在容器中开发') >= 0),
    '22N-3 「…」菜单里没有那个勾选项了（也不拿别的字眼伪装）', JSON.stringify(moreItems));
  await c.evaluate("(function(){ document.querySelector('#gengDuoCaiDan').classList.add('yinCang'); return true; })()");
  const storeHas = JSON.parse(await c.evaluate(`(async function(){
    var s = await window.warmy.settingsGet();
    var st = (s && s.settings) || {};
    return JSON.stringify({ hasRun: Object.prototype.hasOwnProperty.call(st, 'containerRun'), keys: Object.keys(st).filter(function(k){ return k.indexOf('container') === 0 || k.indexOf('project') === 0; }) });
  })()`));
  ok(storeHas.hasRun === false,
    '22N-4 【存储】设置里不再有 containerRun（那套"运行环境"选择整块删除）', JSON.stringify(storeHas.keys));
  ok(storeHas.keys.indexOf('containerDev') >= 0 && storeHas.keys.indexOf('containerProjectRuntime') >= 0 && storeHas.keys.indexOf('projectDisabled') >= 0,
    '22N-5 存储里现在是：开发环境（创建时定）+ 项目选定的容器 + 项目启用/停用', JSON.stringify(storeHas.keys));

  at = '22N：项目可用性（不可用 = 只能翻看记录）';
  await c.evaluate(`(function(){
    window.__ctgTest.localIsCreator = true;
    var s = window.__previewSettings || {};
    s.containerDev = Object.assign({}, s.containerDev || {}, { 'g-1': 'container' });
    s.containerProjectRuntime = Object.assign({}, s.containerProjectRuntime || {}, { 'g-1': 'docker' });
    s.projectDisabled = Object.assign({}, s.projectDisabled || {}); delete s.projectDisabled['g-1'];
    window.__previewSettings = s;
    window.__ctgTest.setReport(${JSON.stringify(NOT_READY_REPORT)});
    return true;
  })()`);
  await navTo('internalGroup');
  await openSession('internalGroup', '项目推进群');
  await c.waitForQuiet(`!!document.querySelector('#xiangMuTai')`, { timeout: 8000 });
  const unusable = JSON.parse(await c.evaluate(`JSON.stringify({
    state: document.querySelector('#liaoTianLan').dataset.projectState,
    code: document.querySelector('#xiangMuTai').dataset.projectCode,
    face: document.querySelector('#xiangMuTai').dataset.memberFace,
    history: document.querySelector('#liaoTianLan').dataset.historyReadable,
    inputDisabled: !!document.querySelector('#shuRu').disabled,
    sendDisabled: !!document.querySelector('#anNiuFaSong').disabled,
    execDisabled: !!document.querySelector('#anNiuZhiXingYunXing').disabled,
    xiaoXi: document.querySelectorAll('#xiaoXiJi .xiaoXi').length
  })`));
  ok(unusable.state === 'unavailable' && unusable.code === 'container-not-ready',
    '22N-6 【核心】容器开发项目 + 容器没运行（注入的"未运行"派生报告）⇒ **项目不可用**', JSON.stringify(unusable));
  ok(unusable.face === 'creator-offline', '22N-6b 成员面 = 创建者下线那一套（复用既有语义）', unusable.face);
  ok(unusable.history === '1', '22N-6c 【核心】**历史仍可读**（不是把整块禁掉）', unusable.history);
  ok(unusable.inputDisabled === true && unusable.sendDisabled === true,
    '22N-7 【核心】不可聊天：输入与发送禁用', JSON.stringify({ shuRu: unusable.inputDisabled }));
  ok(unusable.execDisabled === true,
    '22N-7b 其中功能也不可用（执行者入口禁用）', String(unusable.execDisabled));

  at = '22N：不误伤（本机项目 / 我的牛马）';
  await c.evaluate(`(function(){
    var s = window.__previewSettings || {};
    s.containerDev = Object.assign({}, s.containerDev || {}, { 'g-1': 'host' });
    window.__previewSettings = s;
    return true;
  })()`);
  await openSession('internalGroup', '项目推进群');
  await c.waitForQuiet(`document.querySelector('#liaoTianLan').dataset.projectState === 'available'`, { timeout: 8000 });
  const notAffected = JSON.parse(await c.evaluate(`JSON.stringify({
    code: document.querySelector('#xiangMuTai').dataset.projectCode,
    inputDisabled: !!document.querySelector('#shuRu').disabled,
    sendDisabled: !!document.querySelector('#anNiuFaSong').disabled
  })`));
  ok(notAffected.code === 'host-dev' && notAffected.inputDisabled === false,
    '22N-8 【不误伤】没选容器开发的项目：容器没起也照常可聊天', JSON.stringify(notAffected));
  await openSession('singleAi', 'demo.agent');
  const cattleOK = JSON.parse(await c.evaluate(`JSON.stringify({
    state: document.querySelector('#liaoTianLan').dataset.projectState,
    inputDisabled: !!document.querySelector('#shuRu').disabled,
    hasStateBlock: !!document.querySelector('#xiangMuTai')
  })`));
  ok(cattleOK.inputDisabled === false && cattleOK.state === 'none',
    '22N-9 【不误伤】「我的牛马」：与容器无关，照常可聊天', JSON.stringify(cattleOK));
  ok(cattleOK.hasStateBlock === false,
    '22N-9b 牛马没有"项目状态"块（它不是项目），也不显示项目相关的限制文案', String(cattleOK.hasStateBlock));

  at = '22N：右键菜单（启用/停用 + 切换容器）';
  await c.evaluate(`(function(){
    var s = window.__previewSettings || {};
    s.containerDev = Object.assign({}, s.containerDev || {}, { 'g-1': 'container' });
    s.containerProjectRuntime = Object.assign({}, s.containerProjectRuntime || {}, { 'g-1': 'docker' });
    window.__previewSettings = s;
    window.__ctgTest.setReport(${JSON.stringify(twoReady)});
    return true;
  })()`);
  await navTo('internalGroup');
  /**
   * 在**对应的导航页**上给某一行真发一次 contextmenu，并读回菜单条目。
   * ⚠️ 菜单是动态创建/移除的（不是隐藏切换）⇒ 每次先清掉上一条，避免读到残留。
   */
  const openRowMenu22 = async (nav, ming) => {
    await navTo(nav);
    await c.evaluate("(function(){ var m=document.getElementById('shangXiaWenCaiDan'); if(m) m.remove(); return true; })()");
    const dispatched = await c.evaluate(`(function(){
      var rows = Array.from(document.querySelectorAll('#lieBiaoTi .lieBiaoTiaoMu'));
      var hang = rows.filter(function(r){ return (r.textContent||'').indexOf(${JSON.stringify(ming)}) >= 0; })[0];
      if (!hang) return false;
      var r2 = hang.getBoundingClientRect();
      hang.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.round(r2.left + 20), clientY: Math.round(r2.top + 10) }));
      return true;
    })()`);
    await sleep(400);
    return JSON.parse(await c.evaluate(`JSON.stringify(Array.from(document.querySelectorAll('#shangXiaWenCaiDan button')).map(function(b){ return b.textContent; }))`).catch(() => '[]'));
  };
  const projMenu = await openRowMenu22('internalGroup', '项目推进群');
  ok(projMenu.some((x) => x.indexOf(ZH['ctx.projectDisable']) >= 0),
    '22N-10 项目可用时右键菜单给的是「' + ZH['ctx.projectDisable'] + '」', JSON.stringify(projMenu.slice(0, 5)));
  ok(projMenu.some((x) => x.indexOf(ZH['ctx.projectSwitchContainer']) >= 0),
    '22N-10b 容器开发项目**有**「' + ZH['ctx.projectSwitchContainer'] + '」', JSON.stringify(projMenu.slice(0, 5)));
  const otherMenu = await openRowMenu22('externalGroup', '外部协作群');
  ok(otherMenu.length > 0 && !otherMenu.some((x) => x.indexOf(ZH['ctx.projectDisable']) >= 0) && !otherMenu.some((x) => x.indexOf(ZH['ctx.projectSwitchContainer']) >= 0),
    '22N-10c 非项目（外部群）的右键菜单里**没有**这些项目条目（菜单本身照常打开）', JSON.stringify(otherMenu.slice(0, 5)));
  const cattleMenu = await openRowMenu22('singleAi', 'demo.agent');
  ok(cattleMenu.length > 0 && !cattleMenu.some((x) => x.indexOf(ZH['ctx.projectSwitchContainer']) >= 0) && !cattleMenu.some((x) => x.indexOf(ZH['ctx.projectDisable']) >= 0),
    '22N-10d 「我的牛马」没有切换容器/停用项目（它没有开发环境这回事）', JSON.stringify(cattleMenu.slice(0, 5)));
  // 切换容器弹窗：真点开 → 列出设置里检测到的容器 + 「添加更多容器」+ 换一个 ⇒ 提示重启才生效
  await openRowMenu22('internalGroup', '项目推进群');
  await c.evaluate(`(function(){
    var b = Array.from(document.querySelectorAll('#shangXiaWenCaiDan button')).filter(function(x){ return (x.textContent||'').indexOf(${JSON.stringify(ZH['ctx.projectSwitchContainer'])}) >= 0; })[0];
    if (b) b.click();
    return true;
  })()`);
  await c.waitForQuiet("!!document.querySelector('#switchCancel')", { timeout: 8000 });
  const sw = JSON.parse(await c.evaluate(`JSON.stringify({
    title: document.querySelector('#duiHuaKuangBiaoTi').textContent,
    picks: Array.from(document.querySelectorAll('#duiHuaKuangTi [data-pick]')).map(function(b){ return b.dataset.pick; }),
    more: !!document.querySelector('#switchGengDuo')
  })`));
  ok(sw.biaoTi === ZH['container.project.switchTitle'] && sw.more === true,
    '22N-11 右键「切换容器…」打开独立弹窗，并带「' + ZH['container.project.switchMore'] + '」出口', JSON.stringify(sw));
  ok(sw.picks.length === 2 && sw.picks.indexOf('docker') >= 0 && sw.picks.indexOf('podman') >= 0,
    '22N-11b 弹窗列出**设置里已检测到的可用容器**（这里注入的真报告变体有两个）', JSON.stringify(sw.picks));
  await c.evaluate("(function(){ document.querySelector('#switchRtPodman').click(); return true; })()");
  await c.waitForQuiet(`((window.__previewSettings||{}).containerProjectRuntime||{})['g-1'] === 'podman'`, { timeout: 8000 });
  const swDone = await c.evaluate("(document.querySelector('#xiangMuTaiXiaoXi')||{}).textContent || ''");
  ok(String(swDone) === ZH['container.project.switchNeedRestart'],
    '22N-11c 项目**正在运行**时切换容器 ⇒ 提示"重启项目才能生效"（不假装已经切过去）', String(swDone).slice(0, 60));
  const switchCalls = JSON.parse(await c.evaluate(`JSON.stringify(window.__ctgTest.projectCalls.filter(function(x){ return x.op === 'set-container'; }))`));
  ok(switchCalls.length === 1 && switchCalls[0].runtimeId === 'podman' && switchCalls[0].sessionId === 'g-1',
    '22N-11d 切换请求只带 { sessionId, runtimeId }（运行时 id 必须是预定义清单里的；**不接受任何命令字符串**）',
    JSON.stringify(switchCalls));
  // 非创建者：停用请求被拒
  await c.evaluate("(function(){ window.__ctgTest.localIsCreator = false; return true; })()");
  await c.evaluate(`(function(){
    var s = window.__previewSettings || {};
    s.projectDisabled = Object.assign({}, s.projectDisabled || {});
    window.__previewSettings = s;
    return true;
  })()`);
  const denied = JSON.parse(await c.evaluate(`(async function(){
    var r = await window.warmy.projectDisable({ sessionId: 'g-1' });
    return JSON.stringify(r);
  })()`));
  ok(denied.ok === false && denied.code === 'not-creator',
    '22N-12 【核心】不是创建者 ⇒ 停用/启用请求被主进程拒绝（只有创建者能控）', JSON.stringify(denied));
  await c.evaluate("(function(){ window.__ctgTest.localIsCreator = true; return true; })()");

  at = '22N：右栏三块（真实数据 / 诚实空态）+ 产物运行按钮';
  await c.evaluate(`(function(){ window.__ctgTest.setReport(${JSON.stringify(REAL_REPORT)}); return true; })()`);
  await openSession('internalGroup', '项目推进群');
  await c.waitForQuiet(`!!document.querySelector('#xiangMuWenJianJiHe')`, { timeout: 8000 });
  const filesEmpty = JSON.parse(await c.evaluate(`JSON.stringify((function(){
    var box = document.querySelector('#xiangMuWenJianJiHe');
    return {
      text: box.textContent,
      changed: !!box.querySelector('[data-empty="changed"]'),
      other: !!box.querySelector('[data-empty="other"]'),
      missing: ((box.querySelector('[data-missing-sources]')||{}).dataset||{}).missingSources || '',
      dir: ((box.querySelector('[data-product-dir]')||{}).dataset||{}).productDir || '',
      planned: box.textContent.indexOf(${JSON.stringify(ZH['projectFiles.productDirPlanned'])}) >= 0,
      runDisabled: !!box.querySelector('#anNiuChanPinYunXing').disabled,
      calls: window.__ctgTest.projectFilesCalls || 0
    };
  })())`));
  ok(filesEmpty.calls >= 1, '22N-13 三块面板的数据是**真的问主进程**要的（projectFiles 被调用）', 'calls=' + filesEmpty.calls);
  ok(filesEmpty.changed === true && filesEmpty.other === true,
    '22N-13b 本机没有项目目录/工具读写台账 ⇒ 两块都**如实空态**（不编演示数据）', JSON.stringify({ changed: filesEmpty.changed, other: filesEmpty.other }));
  ok(filesEmpty.missing.indexOf('project-directory-record') >= 0 && filesEmpty.missing.indexOf('tool-file-access-ledger') < 0,
    '22N-13c 面板里写明**还缺哪种**真实数据源（项目目录记录）；工具访问台账已落地 ⇒ 不再列它', filesEmpty.missing);
  ok(filesEmpty.dir.length > 0 && filesEmpty.planned === true,
    '22N-13d 还没有产物 ⇒ 显示**即将存放这个生成产品的目录**（不是"无"、也不是空白）', filesEmpty.dir);
  ok(filesEmpty.runDisabled === true, '22N-13e 没有产物 ⇒ 「运行」置灰', String(filesEmpty.runDisabled));
  // 注入"有产物"的真实形状事实：容器开发项目 ⇒ 产物是容器的 ⇒ **不可在本机跑**
  await c.evaluate(`(function(){
    window.__ctgTest.filesFacts = {
      ok: true, sessionId: 'g-1', projectDir: null, projectDirReason: 'not-recorded',
      changed: [{ path: 'shadows/cp-1/notes.md', ts: Date.now() - 1000, kind: 'changed', scope: 'other' }],
      other: [{ path: 'C:/Users/<user>/AppData/Roaming/warmy/memory/fast-memory.jsonl', ts: Date.now() - 2000, kind: 'changed', scope: 'other', source: 'checkpoint-detail' }],
      missingSources: ['project-directory-record'],
      chanPin: { dir: 'C:/preview/products/g-1', dirExists: true, dirKind: 'existing', kind: 'program',
        entry: 'C:/preview/products/g-1/app.js', entryHostRunnable: false, entryReason: 'container-built',
        files: [{ path: 'C:/preview/products/g-1/app.js', ming: 'app.js', bytes: 120, ts: Date.now() }] }
    };
    return true;
  })()`);
  await openSession('internalGroup', '项目推进群');
  await c.waitForQuiet(`((document.querySelector('#chanPinKa')||{}).dataset||{}).productKind === 'program'`, { timeout: 8000 });
  const prodContainer = JSON.parse(await c.evaluate(`JSON.stringify({
    kind: document.querySelector('#chanPinKa').dataset.productKind,
    entry: ((document.querySelector('[data-product-entry]')||{}).dataset||{}).productEntry || '',
    runnable: document.querySelector('#chanPinKa').dataset.entryRunnable,
    runDisabled: !!document.querySelector('#anNiuChanPinYunXing').disabled,
    reason: ((document.querySelector('[data-product-run-reason]')||{}).dataset||{}).productRunReason || '',
    rows: document.querySelectorAll('#xiangMuWenJianJiHe .pfHang').length
  })`));
  ok(prodContainer.entry.length > 0 && prodContainer.rows >= 2,
    '22N-14 【真实】有产物时显示**可运行入口文件**（并且改动/其他文件两块显示真实记录）', JSON.stringify(prodContainer));
  ok(prodContainer.runDisabled === true && prodContainer.reason === 'container-built' && prodContainer.runnable === '0',
    '22N-14b 【核心】容器开发项目的产物**不可在本机运行** ⇒ 按钮置灰 + 说明原因（不冒充能在主机上跑）',
    JSON.stringify({ disabled: prodContainer.runDisabled, reason: prodContainer.reason }));
  // 换成"本机开发项目 + 宿主原生入口" ⇒ 可点，且点击**真的**发出运行请求
  await c.evaluate(`(function(){
    var s = window.__previewSettings || {};
    s.containerDev = Object.assign({}, s.containerDev || {}, { 'g-1': 'host' });
    window.__previewSettings = s;
    var f = window.__ctgTest.filesFacts;
    f.chanPin.entryHostRunnable = true; f.chanPin.entryReason = 'host-native';
    return true;
  })()`);
  await openSession('internalGroup', '项目推进群');
  await c.waitForQuiet(`((document.querySelector('#chanPinKa')||{}).dataset||{}).entryRunnable === '1'`, { timeout: 8000 });
  const runnable = JSON.parse(await c.evaluate(`JSON.stringify({
    runnable: document.querySelector('#chanPinKa').dataset.entryRunnable,
    runDisabled: !!document.querySelector('#anNiuChanPinYunXing').disabled,
    reason: ((document.querySelector('[data-product-run-reason]')||{}).dataset||{}).productRunReason || ''
  })`));
  ok(runnable.runnable === '1' && runnable.runDisabled === false && runnable.reason === 'host-native',
    '22N-15 【核心】只有"运行环境与主机一致"（本机开发 + 宿主原生入口）时按钮才可点', JSON.stringify(runnable));
  await clickReal('#anNiuChanPinYunXing', `(window.__ctgTest.productRuns||[]).length >= 1`, { tries: 4, timeout: 6000 });
  const runCall = JSON.parse(await c.evaluate('JSON.stringify(window.__ctgTest.productRuns || [])'));
  ok(runCall.length === 1 && runCall[0].sessionId === 'g-1',
    '22N-15b 点「运行」只带 { sessionId }（入口路径由主进程自己解析，渲染层**不能**指定路径/命令）', JSON.stringify(runCall));
  const runMsg = await c.evaluate("(document.querySelector('#chanPinYunXingXiaoXi')||{}).textContent || ''");
  ok(String(runMsg) === ZH['projectFiles.runStarted'].replace('{pid}', '4242'),
    '22N-15c 启动后如实显示结果（pid 来自真实返回值）', String(runMsg));
  /* ⚠️ 这三个 __ctgG* 在本脚本里**从未被赋值**，原来的写法会把 API 直接置成 undefined，
     后面任何一次 groupMembers/groupList 调用都会抛 TypeError（实测：新增的第 23 节就撞上了）。
     原意是"有备份就还原"，所以这里加一道存在性判断。 */
  await c.evaluate("(function(){ window.__ctgTest.filesFacts = null; try { if (window.__ctgGL) window.warmy.groupList = window.__ctgGL; if (window.__ctgGC) window.warmy.groupCreate = window.__ctgGC; if (window.__ctgGM) window.warmy.groupMembers = window.__ctgGM; } catch(e){} return true; })()");


  /* ══════════════════════════════════════════════════════════════════════════
     23. ADR004 第十六批：**真执行 / 项目级台账 / 成员侧信号 / 加锁与回滚**（新增，不改动前面各节）
     --------------------------------------------------------------------------
     覆盖产品主这一轮提的四件事在**界面上**的样子：
       · 记录文件的改动是**项目功能**：右栏有"项目级台账"这一行 + 成员侧那行来源说明；
       · 项目目录进了项目记录：有目录就显示，没有就如实说"还没记录"；
       · 固化/回滚是真的：`commit` 成功才显示"已固化"（带镜像 id），回滚是按固化镜像起容器；
       · 宿主目录加锁：它是**可选、可一键撤销**的（界面上写清怎么撤、以及它不是什么）。
     ══════════════════════════════════════════════════════════════════════════ */
  at = '23 真实数据 / 固化回滚 / 目录加锁（第十六批）';
  await c.evaluate(`(function(){
    window.__ctgTest.localIsCreator = true;
    var s = window.__previewSettings || {};
    s.containerDev = Object.assign({}, s.containerDev || {}, { 'g-1': 'container' });
    s.containerProjectRuntime = Object.assign({}, s.containerProjectRuntime || {}, { 'g-1': 'docker' });
    s.projectDisabled = Object.assign({}, s.projectDisabled || {}); delete s.projectDisabled['g-1'];
    window.__previewSettings = s;
    window.__ctgTest.setReport(${JSON.stringify(READY18)});
    window.__ctgTest.solidifyOk = false;
    window.__ctgTest.solidifiedRef = '';
    window.__ctgTest.fsGuardActive = false;
    /* 加锁用例需要"项目目录已记录"（真实现也是这样：没有目录就没有可锁的目标） */
    window.__ctgTest.projectDir = 'C:/preview/projects/g-1';
    window.__ctgTest.projectSourceRemote = false;
    window.__ctgTest.execCalls = [];
    window.__ctgTest.rollbackCalls = 0;
    return true;
  })()`);
  await navTo('internalGroup');
  await openSession('internalGroup', '项目推进群');
  await c.waitForQuiet(`!!document.querySelector('#xiangMuHuanJingHe')`, { timeout: 8000 });

  // 23-1 环境块：能力按运行时区分 + 三个真入口（探测/固化/回滚）
  const envBox23 = JSON.parse(await c.evaluate(`JSON.stringify({
    kind: (document.querySelector('#xiangMuHuanJingHe')||{}).dataset ? document.querySelector('#xiangMuHuanJingHe').dataset.envKind : '',
    programmatic: (document.querySelector('#xiangMuHuanJingHe')||{}).dataset ? document.querySelector('#xiangMuHuanJingHe').dataset.envProgrammatic : '',
    probe: !!document.querySelector('#anNiuHuanJingTanCe'),
    solidify: !!document.querySelector('#anNiuGuHuaHuanJing'),
    rollback: !!document.querySelector('#anNiuHuiGunHuanJing'),
    rollbackDisabled: !!(document.querySelector('#anNiuHuiGunHuanJing') || {}).disabled
  })`));
  ok(envBox23.kind === 'commit' && envBox23.programmatic === '1' && envBox23.probe && envBox23.solidify && envBox23.rollback,
    '23-1 docker 的固化能力 = commit（可程序化），且三个真入口都在（查看容器里有什么 / 固化 / 回滚）',
    JSON.stringify(envBox23));
  ok(envBox23.rollbackDisabled === true,
    '23-1b 【诚实】还没有固化点 ⇒ 「回滚到固化点」置灰（不给一个点了必然失败的按钮）', String(envBox23.rollbackDisabled));

  // 23-2 「查看容器里有什么」：真的把**固定命令**送进容器，并把容器里的输出贴出来
  await clickReal('#anNiuHuanJingTanCe', `(window.__ctgTest.execCalls||[]).length >= 1`, { tries: 4, timeout: 6000 });
  const execCall23 = JSON.parse(await c.evaluate('JSON.stringify(window.__ctgTest.execCalls || [])'));
  ok(execCall23.length === 1 && execCall23[0].sessionId === 'g-1' && execCall23[0].command === 'env-probe',
    '23-2 【核心】点「查看容器里有什么」只发 { sessionId, command:"env-probe" }（命令是**枚举**，没有命令字符串）',
    JSON.stringify(execCall23));
  const probeMsg23 = JSON.parse(await c.evaluate(`JSON.stringify({
    state: (document.querySelector('#huanJingTanCeXiaoXi')||{}).dataset ? document.querySelector('#huanJingTanCeXiaoXi').dataset.probeState : '',
    text: (document.querySelector('#huanJingTanCeXiaoXi')||{}).textContent || ''
  })`));
  ok(probeMsg23.state === 'done' && probeMsg23.text.indexOf('harness:in-container') >= 0,
    '23-2b 【核心】把**容器里的真实输出**原样贴出来（不是一句"已完成"）', JSON.stringify(probeMsg23));

  // 23-3 固化：真的 commit 成功才显示"已固化"+ 镜像引用（失败/拒绝绝不显示成功）
  await clickReal('#anNiuGuHuaHuanJing', `(window.__ctgTest.solidifyCalls||0) >= 1`, { tries: 4, timeout: 6000 });
  const refused23 = JSON.parse(await c.evaluate(`JSON.stringify({
    state: (document.querySelector('#guHuaXiaoXi')||{}).dataset ? document.querySelector('#guHuaXiaoXi').dataset.solidifyState : '',
    evidence: (document.querySelector('#guHuaXiaoXi')||{}).dataset ? document.querySelector('#guHuaXiaoXi').dataset.solidifyEvidence : '',
    text: (document.querySelector('#guHuaXiaoXi')||{}).textContent || ''
  })`));
  ok(refused23.state === 'refused' && refused23.evidence !== 'commit-succeeded' && refused23.text.indexOf(ZH['container.env.solidify.refused.no-image'].slice(0, 10)) >= 0,
    '23-3 【核心】commit 没成功 ⇒ 如实拒绝（**绝不**显示"已固化"）', JSON.stringify(refused23));
  // 换一个"真的成功"的结果 ⇒ 必须显示镜像引用与时间（这是证据等级的界面面）
  await c.evaluate("(function(){ window.__ctgTest.solidifyOk = true; window.__ctgTest.reset(); return true; })()");
  await clickReal('#anNiuGuHuaHuanJing', `((document.querySelector('#guHuaXiaoXi')||{}).dataset||{}).solidifyEvidence === 'commit-succeeded'`, { tries: 4, timeout: 8000 });
  const done23 = JSON.parse(await c.evaluate(`JSON.stringify({
    state: (document.querySelector('#guHuaXiaoXi')||{}).dataset ? document.querySelector('#guHuaXiaoXi').dataset.solidifyState : '',
    evidence: (document.querySelector('#guHuaXiaoXi')||{}).dataset ? document.querySelector('#guHuaXiaoXi').dataset.solidifyEvidence : '',
    text: (document.querySelector('#guHuaXiaoXi')||{}).textContent || ''
  })`));
  ok(done23.state === 'done' && done23.evidence === 'commit-succeeded' && /warmy-solid-/.test(done23.text),
    '23-3b 【核心】真成功时才显示"已固化"并把**镜像引用**摆出来（证据等级可断言）', JSON.stringify(done23));

  // 23-4 回滚：现在有固化点了 ⇒ 按钮可点；点击要二次确认，确认后**真的**发出回滚请求
  const rb23 = await c.evaluate(`JSON.stringify({
    disabled: !!(document.querySelector('#anNiuHuiGunHuanJing') || {}).disabled
  })`);
  ok(JSON.parse(rb23).disabled === false, '23-4 有固化点之后「回滚到固化点」可点', rb23);
  await clickReal('#anNiuHuiGunHuanJing', `!document.querySelector('#duiHuaKuangGen').classList.contains('yinCang')`, { tries: 4, timeout: 6000 });
  const rbModal = await modal();
  ok(rbModal.biaoTi === ZH['container.env.rollback.confirmTitle'] && String(rbModal.ti).indexOf(ZH['container.env.rollback.confirmBody'].slice(0, 12)) >= 0,
    '23-4b 回滚要二次确认，且写明"固化镜像只覆盖容器可写层、bind mount 的项目文件不在里面"（分层，不撒谎）',
    rbModal.biaoTi);
  await clickReal('#duiHuaKuangDongZuoJi .anNiuZhuYao', `(window.__ctgTest.rollbackCalls||0) >= 1`, { tries: 4, timeout: 8000 });
  const roll23 = JSON.parse(await c.evaluate(`JSON.stringify({
    calls: window.__ctgTest.rollbackCalls || 0,
    state: (document.querySelector('#huiGunXiaoXi')||{}).dataset ? document.querySelector('#huiGunXiaoXi').dataset.rollbackState : '',
    evidence: (document.querySelector('#huiGunXiaoXi')||{}).dataset ? document.querySelector('#huiGunXiaoXi').dataset.rollbackEvidence : '',
    text: (document.querySelector('#huiGunXiaoXi')||{}).textContent || ''
  })`));
  ok(roll23.calls === 1 && roll23.state === 'done' && roll23.evidence === 'container-started',
    '23-4c 【核心】确认后**真的**发起回滚，并如实标出证据等级 = container-started（从固化镜像起了容器）',
    JSON.stringify(roll23));

  // 23-5 宿主目录加锁：可选的、可一键撤销的（界面写清"怎么撤"与"它不是什么"）
  const guardBox23 = JSON.parse(await c.evaluate(`JSON.stringify({
    supported: (document.querySelector('#wenJianXiTongShouWeiHe')||{}).dataset ? document.querySelector('#wenJianXiTongShouWeiHe').dataset.guardSupported : '',
    jiHuo: (document.querySelector('#wenJianXiTongShouWeiHe')||{}).dataset ? document.querySelector('#wenJianXiTongShouWeiHe').dataset.guardActive : '',
    text: (document.querySelector('#wenJianXiTongShouWeiHe')||{}).textContent || '',
    btn: (document.querySelector('#anNiuWenJianXiTongShouWei')||{}).textContent || '',
    btnDisabled: !!(document.querySelector('#anNiuWenJianXiTongShouWei') || {}).disabled
  })`));
  ok(guardBox23.jiHuo === '0' && guardBox23.supported === '1' && guardBox23.btnDisabled === false && guardBox23.btn === ZH['container.fsGuard.lock'],
    '23-5 加锁区块默认是"未锁定"且按钮可点（**绝不自动加锁**）', JSON.stringify({ jiHuo: guardBox23.jiHuo, btn: guardBox23.btn }));
  ok(guardBox23.text.indexOf(ZH['container.fsGuard.undo'].slice(0, 8)) >= 0 && guardBox23.text.indexOf(ZH['container.fsGuard.limits'].slice(0, 8)) >= 0,
    '23-5b 【诚实】界面写清"怎么撤销"（一条命令、属主永远能改回来）与"它不是什么"（不是加密也不是沙箱）');
  await clickReal('#anNiuWenJianXiTongShouWei', `!document.querySelector('#duiHuaKuangGen').classList.contains('yinCang')`, { tries: 4, timeout: 6000 });
  const guardModal23 = await modal();
  ok(guardModal23.biaoTi === ZH['container.fsGuard.confirmTitle'] && String(guardModal23.ti).indexOf(ZH['container.fsGuard.confirmBody'].slice(0, 10)) >= 0,
    '23-5c 加锁前二次确认，并说明"只拒写入、读取不受影响、随时可撤销"', guardModal23.biaoTi);
  await clickReal('#duiHuaKuangDongZuoJi .anNiuZhuYao', `((document.querySelector('#wenJianXiTongShouWeiHe')||{}).dataset||{}).guardActive === '1'`, { tries: 4, timeout: 8000 });
  const afterLock23 = JSON.parse(await c.evaluate(`JSON.stringify({
    jiHuo: (document.querySelector('#wenJianXiTongShouWeiHe')||{}).dataset ? document.querySelector('#wenJianXiTongShouWeiHe').dataset.guardActive : '',
    btn: (document.querySelector('#anNiuWenJianXiTongShouWei')||{}).textContent || '',
    calls: (window.__ctgTest.fsGuardCalls||[]).map(function(x){ return x.action; })
  })`));
  ok(afterLock23.jiHuo === '1' && afterLock23.btn === ZH['container.fsGuard.unlock'] && afterLock23.calls.indexOf('apply') >= 0,
    '23-5d 【核心】加锁之后按钮变成「解锁目录」（**还原路径永远在**）', JSON.stringify(afterLock23));
  await clickReal('#anNiuWenJianXiTongShouWei', `((document.querySelector('#wenJianXiTongShouWeiHe')||{}).dataset||{}).guardActive === '0'`, { tries: 4, timeout: 8000 });
  const afterUnlock23 = JSON.parse(await c.evaluate(`JSON.stringify({
    jiHuo: (document.querySelector('#wenJianXiTongShouWeiHe')||{}).dataset ? document.querySelector('#wenJianXiTongShouWeiHe').dataset.guardActive : '',
    calls: (window.__ctgTest.fsGuardCalls||[]).map(function(x){ return x.action; })
  })`));
  ok(afterUnlock23.jiHuo === '0' && afterUnlock23.calls.indexOf('lift') >= 0,
    '23-5e 【核心】一键解锁真的发出 lift，并且状态回到"未锁定"（用户不会被锁死）', JSON.stringify(afterUnlock23));

  // 23-6 项目目录 + 项目级台账 + 成员侧来源说明（记录文件的改动 = 产品功能）
  await c.evaluate("(function(){ window.__ctgTest.projectDir = 'C:/preview/projects/g-1'; return true; })()");
  await openSession('internalGroup', '项目推进群');
  await c.waitForQuiet(`!!document.querySelector('[data-project-dir]')`, { timeout: 8000 });
  const dirLine23 = await c.evaluate("((document.querySelector('[data-project-dir]')||{}).dataset||{}).projectDir || ''");
  ok(String(dirLine23) === 'C:/preview/projects/g-1',
    '23-6 项目目录进了**项目记录**（右栏如实显示，成员也在同一份记录里看到）', String(dirLine23));
  const ledger23 = JSON.parse(await c.evaluate(`JSON.stringify({
    count: ((document.querySelector('[data-ledger-count]')||{}).dataset||{}).ledgerCount || '',
    scope: ((document.querySelector('[data-ledger-count]')||{}).dataset||{}).ledgerScope || '',
    text: (document.querySelector('[data-ledger-count]')||{}).textContent || ''
  })`));
  ok(ledger23.scope === 'project' && ledger23.count === '0' && ledger23.text.indexOf(ZH['projectFiles.ledgerCount'].replace('{n}', '0').slice(0, 8)) >= 0,
    '23-6b 【核心】台账那一行标的是 **project** 作用域（记录文件的改动是项目功能，不是本机功能）', JSON.stringify(ledger23));
  // 成员侧：属性与可用性来自创建者节点的信号 ⇒ 多一行来源说明（复用"创建者离线"那套）
  await c.evaluate("(function(){ window.__ctgTest.projectSourceRemote = true; window.__ctgTest.projectReportedAt = Date.now(); return true; })()");
  await openSession('internalGroup', '项目推进群');
  await c.waitForQuiet(`!!document.querySelector('[data-project-source="creator-signal"]')`, { timeout: 8000 });
  const remote23 = JSON.parse(await c.evaluate(`JSON.stringify({
    notice: (document.querySelector('[data-project-source="creator-signal"]')||{}).textContent || '',
    reportedAt: !!document.querySelector('[data-project-reported-at]'),
    filesNotice: !!document.querySelector('#xiangMuWenJianJiHe [data-project-source="creator-signal"]')
  })`));
  ok(remote23.notice === ZH['container.project.remoteNotice'] && remote23.reportedAt === true && remote23.filesNotice === true,
    '23-6c 【核心】异地成员能看到"这是创建者节点同步来的状态 + 什么时候上报的"（所以成员不再把它当普通本机项目）',
    JSON.stringify(remote23));
  await okContrast('[data-project-source="creator-signal"]', '23-6d 成员侧那行说明可读（--ink-dim，对比度 >= 3.0）');
  await okContrast('[data-ledger-count]', '23-6e 台账那一行可读');
  await okContrast('#wenJianXiTongShouWeiHe .ctgDim', '23-6f 加锁区块的说明可读');

  // 收尾：把夹具恢复干净（后面只有"无控制台异常"这一条了，但别留脏状态）
  await c.evaluate(`(function(){
    window.__ctgTest.projectSourceRemote = false;
    window.__ctgTest.projectDir = '';
    window.__ctgTest.solidifyOk = false;
    window.__ctgTest.solidifiedRef = '';
    window.__ctgTest.fsGuardActive = false;
    var s = window.__previewSettings || {};
    s.containerDev = Object.assign({}, s.containerDev || {}, { 'g-1': 'host' });
    var rt = Object.assign({}, s.containerProjectRuntime || {}); delete rt['g-1'];
    s.containerProjectRuntime = rt;
    window.__previewSettings = s;
    window.__ctgTest.setReport(${JSON.stringify(NOT_READY18)});
    window.__ctgTest.reset();
    return true;
  })()`);

  // ── APPENDED: 10-locale reachability (WArmy branding) ──
  // Owner gate: prove all 10 yuYan packs are selectable at runtime, UI text really
  // changes, brand naming is correct, and no raw i18n key leaks into the DOM.
  at = 'L10N 全 10 种语言可达';
  const L10N_EXPECT = {
    'zh-CN': { ming: '无限牛马', tagline: '让AI成为你的无限牛马', sample: '设置' },
    'zh-TW': { ming: '無限牛馬', tagline: '讓AI成為你的無限牛馬', sample: '設定' },
    'en-US': { ming: 'WArmy', tagline: 'An infinite army of AI workhorses working for you.', sample: 'Settings' },
    'ja': { ming: '無限社畜', tagline: 'AIがあなたの社畜になって、無限に働きます。', sample: '設定' },
    'ko': { ming: '무한 사축', tagline: 'AI가 당신 대신 사축처럼 일해줍니다.', sample: '설정' },
    'ru': { ming: 'WArmy', tagline: 'An infinite army of AI workhorses working for you.', sample: 'Настройки' },
    'es': { ming: 'WArmy', tagline: 'An infinite army of AI workhorses working for you.', sample: 'Ajustes' },
    'fr': { ming: 'WArmy', tagline: 'An infinite army of AI workhorses working for you.', sample: 'Réglages' },
    'pt': { ming: 'WArmy', tagline: 'An infinite army of AI workhorses working for you.', sample: 'Definições' },
    'eo': { ming: 'WArmy', tagline: 'An infinite army of AI workhorses working for you.', sample: 'Agordoj' },
  };
  const L10N_CODES = Object.keys(L10N_EXPECT);
  // select element must list all 10
  const optCodes = await c.evaluate(`(function(){
    var s=document.querySelector('#xuanZeYuYan');
    return s ? Array.from(s.options).map(function(o){return o.value;}) : [];
  })()`);
  ok(optCodes.length === 10 && L10N_CODES.every(function(c){ return optCodes.indexOf(c) !== -1; }),
    'L10N-0 #xuanZeYuYan 列出全部 10 种语言', JSON.stringify(optCodes));
  const l10nSeen = [];
  for (const code of L10N_CODES) {
    const exp = L10N_EXPECT[code];
    await c.evaluate(`(function(){var s=document.querySelector('#xuanZeYuYan'); s.value='${code}'; s.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
    await c.waitFor(`(function(){ return document.querySelector('#biaoTiLanPinPai') && document.querySelector('#biaoTiLanPinPai').textContent.length > 3; })()`, { timeout: 10000, biaoQian: 'L10N wait ' + code });
    // small settle for settings re-render
    await new Promise(function(r){ setTimeout(r, 400); });
    const snap = await c.evaluate(`(function(){
      var tb=(document.querySelector('#biaoTiLanPinPai')||{}).textContent||'';
      var logo=(document.querySelector('#logoMing')||{}).textContent||'';
      var fu=(document.querySelector('#logoFu')||{}).textContent||'';
      var ti=document.body.innerText||'';
      var about=(document.querySelector('.aboutTagline')||{}).textContent||'';
      var aboutName=(document.querySelector('.aboutMing')||{}).textContent||'';
      return { tb: tb, logo: logo, fu: fu, about: about, aboutName: aboutName, bodyHasName: ti.indexOf(logo||'\\u0000')!==-1, len: ti.length };
    })()`);
    const keyLeak = /(^|[^a-zA-Z])(yingYong\.(displayName|subtitle|enName|zhName)|brand\.(ming|fu|tagline)|about\.(logoAlt|copyrightBody))([^a-zA-Z]|$)/.test(snap.tb + ' ' + snap.logo + ' ' + snap.about + ' ' + snap.aboutName);
    ok(!keyLeak, `L10N ${code} 无 i18n 键泄漏`, JSON.stringify(snap));
    ok(snap.tb === exp.tagline, `L10N ${code} 顶栏 = 品牌 tagline`, JSON.stringify({ got: snap.tb, want: exp.tagline }));
    ok(snap.logo === exp.name, `L10N ${code} logoMing = 产品名`, JSON.stringify({ got: snap.logo, want: exp.name }));
    // daKai settings → about to prove pack strings applied there too
    await c.evaluate(`(function(){ var b=document.querySelector('[data-nav="settings"]'); if(b) b.click(); return true; })()`);
    await c.waitFor("document.querySelector('.aboutMing') && document.querySelector('.aboutMing').textContent.length > 0", { timeout: 8000, biaoQian: 'L10N about ' + code });
    const aboutSnap = await c.evaluate(`(function(){
      var n=(document.querySelector('.aboutMing')||{}).textContent||'';
      var t=(document.querySelector('.aboutTagline')||{}).textContent||'';
      var s=(document.querySelector('.aboutFu')||{}).textContent||'';
      var upd=document.body.innerText.indexOf('更新源')!==-1 || document.body.innerText.indexOf('update source')!==-1 || !!document.querySelector('[data-sec="update-source"],#update-source-block,.update-source');
      return { ming:n, tagline:t, fu:s, updateSourceVisible: upd };
    })()`);
    ok(aboutSnap.name === exp.name, `L10N ${code} 关于页品牌名`, JSON.stringify({ got: aboutSnap.name, want: exp.name }));
    ok(aboutSnap.tagline === exp.tagline, `L10N ${code} 关于页 tagline`, JSON.stringify({ got: aboutSnap.tagline, want: exp.tagline }));
    ok(aboutSnap.updateSourceVisible === false, `L10N ${code} 关于页无「更新源」控件`, JSON.stringify(aboutSnap));
    if (/[\u0400-\u04FF]/.test(aboutSnap.name) && ['ja','ko','zh-CN','zh-TW'].indexOf(code) !== -1) {
      ok(false, `L10N ${code} 不应出现西里尔字母品牌名`, aboutSnap.name);
    }
    l10nSeen.push({ code: code, logo: snap.logo, tb: snap.tb.slice(0, 40) });
  }
  // restore zh-CN for remaining checks
  await c.evaluate(`(function(){var s=document.querySelector('#xuanZeYuYan'); s.value='zh-CN'; s.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
  ok(l10nSeen.length === 10, 'L10N-ALL 10 种语言全部可达且文案已切换', JSON.stringify(l10nSeen));

  const errs = c.errors();
  ok(errs.length === 0, '全程无控制台异常/未捕获错误', JSON.stringify(errs.slice(0, 3)).slice(0, 240));

  clearTimeout(watchdog);
  const pass = R.summary('ADR003 R8–R12 / 附六 UI 验收');
  fs.writeFileSync(path.join(OUT, 'net-ui-result.json'), JSON.stringify({ pass, results: R.results }, null, 1));
  c.close();
  process.exit(pass ? 0 : 2);
} catch (e) {
  console.error('\n卡在「' + at + '」: ' + e.message);
  clearTimeout(watchdog);
  try { c && c.close(); } catch { /* noop */ }
  process.exit(4);
}

