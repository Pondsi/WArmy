/**
 * verify-qr-scan.mjs —— R16「扫别人的二维码」验收：**真的**解出来、**真的**走了同一条加入路径。
 *
 *   node packages/app-shell/scripts/verify-qr-scan.mjs
 *
 * 为什么单独一个脚本（而不是只往 verify-net-ui 里加一节）：
 *   预览产物是**去掉 CSP** 的（build-preview.mjs 故意删掉 meta），所以它**证明不了**
 *   「脚本在真实 CSP 下能不能加载」——那个坑本轮之前已经踩过（ESM 在 file:// + CSP 下全灭）。
 *   于是这里跑**两遍**：
 *     [A] 真实 dist 产物（packages/app-shell/dist/renderer/index.html：**带 CSP、无桩**）
 *         —— 证明 ./vendor/jsqr-1.4.0.js 是经典脚本加载成功、真的能解出二维码，
 *            并复现「ESM 在这份文档里确实不可用」这条约束（否则整条结论不成立）。
 *     [B] 预览产物 **--keep-csp**（仍带 CSP，但注入 window.warmy 桩）
 *         —— 证明完整链路：用户选图/拖入/粘贴 → 本机解码 → 喂给**同一条**加入实现
 *            （与「粘贴链接 + 确定」完全同一个函数）→ 控制台/界面如实反馈。
 *            顺带把失败路径逐条钉死：图里没码 / 读出来不是加入链接 / 不是图片 / 解码器没加载。
 *
 * 事实与断言都来自**真 Chromium**：CDP 读 DOM、读 window 上的真对象、读 getImageData 结果。
 * 纪律：每个 CDP 调用都有超时（cdp-lib）；只杀自己 user-data-dir 起的 electron；不碰别的进程。
 */
import {execFileSync, spawn} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {attach, reporter, sleep} from './cdp-lib.mjs';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(here, '..');
const repoRoot = path.join(pkgRoot, '..', '..');

const SELF_DIR = here;
const RENDERER = path.join(pkgRoot, 'src', 'renderer');
const SHIPPED_DECODER = path.join(RENDERER, 'vendor', 'jsqr-1.4.0.js');
const SHIPPED_LICENSE = path.join(RENDERER, 'vendor', 'jsqr-1.4.0.LICENSE.txt');
const TEST_DECODER = path.join(SELF_DIR, 'vendor', 'jsqr-1.4.0.js');
const DIST_HTML = path.join(pkgRoot, 'dist', 'renderer', 'index.html');

const PORT_DIST = Number(process.env.QR_SCAN_PORT_DIST || 9586);
const PORT_PREVIEW = Number(process.env.QR_SCAN_PORT_PREVIEW || 9587);
const OUT = process.env.WARMY_QR_SCAN_OUT || path.join(os.tmpdir(), 'warmy-qr-scan');

const i18nDir = path.join(pkgRoot, 'src', 'i18n');
const ZH = JSON.parse(fs.readFileSync(path.join(i18nDir, 'zh-CN.json'), 'utf8'));
const EN = JSON.parse(fs.readFileSync(path.join(i18nDir, 'en-US.json'), 'utf8'));

const R = reporter();
const { ok, warn } = R;
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/**
 * cdp-lib 的 evaluate 在**渲染层抛异常**时返回 `{__exc}`（不是抛错），
 * 这里把它变成"带现场的错误"：否则只会得到一句 `"[object Object]" is not valid JSON`，
 * 根本不知道页面里发生了什么（本轮踩过）。
 */
async function evalJson(c, expr, label) {
  const v = await c.evaluate(expr);
  if (v && typeof v === 'object' && v.__exc !== undefined) {
    throw new Error('渲染层异常 @' + label + ': ' + v.__exc);
  }
  if (typeof v !== 'string') {
    throw new Error('返回值不是字符串 @' + label + ': ' + JSON.stringify(v).slice(0, 200));
  }
  try {
    return JSON.parse(v);
  } catch (e) {
    throw new Error('返回值不是 JSON @' + label + ': ' + String(v).slice(0, 200));
  }
}

/** 没有 label 的薄封装（变量形态的站点用） */
function evalJsonAny(v) {
  if (v && typeof v === 'object' && v.__exc !== undefined) throw new Error('渲染层异常: ' + v.__exc);
  return JSON.parse(v);
}

/** 读扫码区块的现场（状态 + 提示 + 输入框 + 已发起的加入次数） */
async function scanObserved(c, prefix) {
  return evalJson(c, `JSON.stringify((function(){
    var b = document.querySelector('#${prefix}-scan');
    return {
      state: b ? b.getAttribute('data-scan-state') : 'no-block',
      detail: (document.querySelector('#${prefix}-detail')||{}).textContent || '',
      input: (document.querySelector('#join-link-input')||{}).value || '',
      joins: (window.__qrJoins||[]).length,
      join0: (window.__qrJoins||[])[0] || null
    };
  })())`);
}

/**
 * 等状态变成 want；**超时不抛错**，而是把现场回给调用方 ——
 * 断言失败时要看到"实际是什么"，而不是一句"等待超时: false"。
 */
async function waitScanState(c, prefix, want, ms) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < ms) {
    last = await scanObserved(c, prefix);
    if (last.state === want) return last;
    await sleepMs(120);
  }
  return Object.assign({ timedOut: true }, last || {});
}

/**
 * 每次「喂一张图」之前都**重开一次**弹窗。
 * 为什么必须这样：加入成功时弹窗会在 800ms 后自动收起（与「粘贴链接 + 确定」同一行为），
 * 于是连着做两步时后一步会撞上"弹窗已经关了"——那是**测试的**竞态，不是产品的缺陷。
 * 重开还能顺带清空上一步的提示与输入框，让每一步都是干净的现场。
 */
async function reopenContactScan(c) {
  // 先等上一次「加入成功 → 800ms 后自动收窗」的定时器跑完：否则它会把这一次刚打开的弹窗也收掉，
  // 于是"喂进去的图没反应"——那是**测试的**竞态，不是产品行为（本轮实测踩到过）。
  await sleepMs(950);
  await c.evaluate(`(function(){ window.__qrJoins = []; document.querySelector('#modal-root').classList.add('hidden'); return true; })()`);
  await c.evaluate(`(function(){ var b = document.querySelector('#btn-join-qr'); if (b) b.click(); return true; })()`);
  await c.waitFor(`!!document.querySelector('#contact-qr-scan') && !document.querySelector('#modal-root').classList.contains('hidden') && !!document.querySelector('#contact-my-qr svg')`,
    { timeout: 12000, label: '重开「添加联系人」弹窗' });
}

/**
 * 把一张图片喂进扫码区块的 <input type=file> 并**确认真的喂进去了**。
 * 返回 'fed:1' 才算成功；拿不到就抛错（不要静默地"测了个寂寞"）。
 */
async function feedContactFile(c, fileExpr, label) {
  const r = await c.evaluate(`(async function(){ var f = ${fileExpr}; if (!f) return 'file-is-null'; return await window.__qrScanTest.feedInput('#contact-qr-file', f); })()`);
  if (r !== 'fed:1') throw new Error('喂文件失败 @' + label + ': ' + JSON.stringify(r));
  return r;
}

/** [A] 段没有桥接桩（真实 dist 就是没有 window.warmy），app.js 启动尾部的接线必然报这几条 —— 与扫码无关。
 *  注意 cdp-lib 会把异常描述截断到 140 字符，所以只能按前缀匹配（'onApprova' 就是被截断的 onApprovalRequest）。 */
const NO_BRIDGE_ERR = /onApprova|onInbox|onTray|trayInit|window\.warmy|Cannot read properties of undefined|is not a function/;

/** 本次验收要用的「对方的二维码」：内容 = 本机链接（由应用自己的 ownInviteLink 产出） */
const NODE_ID = 'NODE-R16-QR-0001';
const TOKEN = 'TOK-R16-QR-0002';
const MALFORMED_PAYLOAD = 'https://example.com/not-a-join-link';
const PLAIN_TEXT_PAYLOAD = 'R16-plain-text-not-a-link';

/* ══════════════════════════════════════════════════════════════════════════
   0. 静态证据：文件在哪、是不是同一份 jsQR、index.html 是怎么引的
   ══════════════════════════════════════════════════════════════════════════ */
console.log('=== R16 扫码验收 ===\n');
console.log('[0] 静态证据');

ok(fs.existsSync(SHIPPED_DECODER), '0-1 随应用发布的解码器在 src/renderer/vendor/ 下（会被 copy-assets 带进 dist）', SHIPPED_DECODER);
ok(fs.existsSync(SHIPPED_LICENSE), '0-2 Apache-2.0 许可证就在解码器旁边（发行合规）', SHIPPED_LICENSE);

// 「两份是不是同一个 jsQR」是可判定的事实，不是声明：去掉头部块之后必须逐字节相同。
const shippedRaw = fs.readFileSync(SHIPPED_DECODER, 'utf8');
const testRaw = fs.readFileSync(TEST_DECODER, 'utf8');
const shippedBody = shippedRaw.replace(/^\/\*![\s\S]*?\*\/\r?\n/, '');
const testBody = testRaw.replace(/^\/\*![\s\S]*?\*\/\r?\n/, '');
ok(
  shippedBody === testBody && shippedBody.startsWith('(function webpackUniversalModuleDefinition'),
  '0-3 发布副本 = 测试副本（去掉头部注释后逐字节相同）：两份 jsQR 不可能悄悄漂移',
  'shippedBodySha16=' + sha256(shippedBody).slice(0, 16) + ' (upstream 1.4.0 sha256=' + sha256(shippedBody).slice(0, 8) + '…)'
);
ok(
  /bc40c8a15196236b2314db0856f72ca0b49980cd5413b8c852a7349f5fee0859/.test(shippedRaw) &&
  sha256(shippedBody) === 'bc40c8a15196236b2314db0856f72ca0b49980cd5413b8c852a7349f5fee0859',
  '0-4 解码器确实是 npm tarball 里的 jsqr@1.4.0 原样包体（sha256 与头部记录一致）',
  sha256(shippedBody)
);
ok(/Apache-2\.0/.test(shippedRaw) && /jsqr-1\.4\.0\.LICENSE\.txt/.test(shippedRaw) && /SHIPS WITH THE APP/.test(shippedRaw),
  '0-5 头部记录了口包/版本/许可证/来源，并明确写了「这份随应用发布」', 'header ok');

const htmlSrc = fs.readFileSync(path.join(RENDERER, 'index.html'), 'utf8');
const htmlCode = htmlSrc.replace(/<!--[\s\S]*?-->/g, '');
const encTagIdx = htmlCode.indexOf('src="./vendor/qrcode-generator-2.0.4.js"');
const decTagIdx = htmlCode.indexOf('src="./vendor/jsqr-1.4.0.js"');
const appTagIdx = htmlCode.indexOf('src="./app.js"');
ok(
  encTagIdx > 0 && decTagIdx > 0 && appTagIdx > 0 && decTagIdx < appTagIdx &&
  /<script\s+src="\.\/vendor\/jsqr-1\.4\.0\.js"><\/script>/.test(htmlCode) &&
  !/<script[^>]*\stype\s*=\s*["']module["']/.test(htmlCode) &&
  !/unsafe-eval/.test(htmlCode),
  '0-6 解码器是**经典脚本**（<script src>、非 ESM、在 app.js 之前；CSP 里没有 unsafe-eval）',
  'enc@' + encTagIdx + ' dec@' + decTagIdx + ' app@' + appTagIdx
);
ok(/img-src 'self' data: blob:/.test(htmlCode) && /script-src 'self'/.test(htmlCode),
  '0-7 CSP 允许 data:/blob: 图片（canvas 读像素这条路）且 script-src 只信 self', 'csp ok');

/* ══════════════════════════════════════════════════════════════════════════
   1. 起一个极简 Electron 壳（自己写的 host，写在临时目录，不污染仓库）
   ══════════════════════════════════════════════════════════════════════════ */
const HOST_SRC = `// 自动生成：极简 Electron 壳，只用来在真 Chromium 里打开指定 index.html 并暴露 CDP
const { app, BrowserWindow } = require('electron');
const target = process.env.PREVIEW_HTML || process.argv[2];
app.whenReady().then(() => {
  const w = new BrowserWindow({
    width: 1280, height: 860, show: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  w.loadFile(target);
  w.webContents.on('console-message', (_e, _lvl, message) => console.log('PAGE ' + message));
  w.webContents.on('render-process-gone', (_e, d) => console.log('RENDER_GONE ' + JSON.stringify(d)));
});
app.on('window-all-closed', () => app.quit());
`;

fs.mkdirSync(OUT, { recursive: true });
const HOST = path.join(OUT, 'qr-scan-host.cjs');
fs.writeFileSync(HOST, HOST_SRC, 'utf8');

const electronPath = require('electron');
const running = [];

function killMine(profileTag) {
  try {
    const ps = `Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like "*${profileTag}*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
    execFileSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'ignore' });
  } catch {
    /* 忽略 */
  }
}

function killAll() {
  for (const p of running.splice(0)) {
    try { execFileSync('taskkill', ['/F', '/T', '/PID', String(p.pid)], { stdio: 'ignore' }); } catch { try { p.kill('SIGKILL'); } catch { /* noop */ } }
  }
}

async function waitCdp(port, secs = 45) {
  for (let i = 0; i < secs; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return true;
    } catch {
      /* 还没起来 */
    }
    await sleepMs(1000);
  }
  return false;
}

async function startHost({ html, port, profileTag }) {
  killMine(profileTag);
  await sleepMs(1200);
  const profile = path.join(OUT, profileTag);
  fs.mkdirSync(profile, { recursive: true });
  const child = spawn(
    electronPath,
    [`--remote-debugging-port=${port}`, '--disable-features=CalculateNativeWinOcclusion', `--user-data-dir=${profile}`, HOST],
    { env: { ...process.env, PREVIEW_HTML: html }, cwd: pkgRoot, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false }
  );
  running.push(child);
  const logs = [];
  child.stdout.on('data', (d) => logs.push(String(d)));
  child.stderr.on('data', (d) => logs.push(String(d)));
  if (!(await waitCdp(port))) {
    console.error('CDP 没起来（' + profileTag + '）:\n' + logs.join('').slice(-600));
    killMine(profileTag);
    return null;
  }
  await sleepMs(4000);
  const c = await attach(port, { label: profileTag, callTimeout: 15000 });
  await c.send('Runtime.enable');
  return { c, logs, stop: () => { try { c.close(); } catch { /* noop */ } killMine(profileTag); } };
}

/* ── 页面内工具：把一段文本用**应用自己的编码器**画成 PNG（模拟"对方发来的二维码图片"）── */
const PAGE_HELPERS = `
window.__qrScanTest = (function () {
  function b64utf8(s) {
    var bytes = new TextEncoder().encode(s), bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function pngOfCanvas(cv) {
    return new Promise(function (res) { cv.toBlob(function (b) { res(b); }, 'image/png'); });
  }
  return {
    b64utf8: b64utf8,
    /** 用 vendored 编码器（应用自己用的那个）把文本画成 canvas：2 模块/像素 + 4 模块静区 */
    qrCanvas: function (text, unit) {
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
      for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
        if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * unit, (r + quiet) * unit, unit, unit);
      }
      return cv;
    },
    /** 文本 -> PNG File */
    fileOfText: async function (text, unit, name) {
      var cv = this.qrCanvas(text, unit);
      if (!cv) return null;
      var blob = await pngOfCanvas(cv);
      return new File([blob], name || 'qr.png', { type: 'image/png' });
    },
    /** DOM 里那个真二维码（SVG）-> PNG File：模拟"用户把对方发来的二维码图片存成文件再选进来" */
    fileOfOwnSvg: async function (sel, size) {
      var svg = document.querySelector(sel);
      if (!svg) return null;
      size = size || 336;
      var xml = new XMLSerializer().serializeToString(svg);
      var url = 'data:image/svg+xml;base64,' + b64utf8(xml);
      var img = await new Promise(function (res, rej) {
        var i = new Image(); i.onload = function () { res(i); }; i.onerror = rej; i.src = url;
      });
      var cv = document.createElement('canvas');
      cv.width = size; cv.height = size;
      var ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);
      var blob = await pngOfCanvas(cv);
      return new File([blob], 'own-qr.png', { type: 'image/png' });
    },
    /** 一张"手机拍的大照片"：4000×4000，中间 900px 是真二维码（考的是缩放大图这条路） */
    fileOfLargePhoto: async function (innerFile) {
      var inner = await new Promise(function (res, rej) {
        var i = new Image(); i.onload = function () { res(i); }; i.onerror = rej;
        i.src = URL.createObjectURL(innerFile);
      });
      var cv = document.createElement('canvas');
      cv.width = 4000; cv.height = 4000;
      var ctx = cv.getContext('2d');
      // 非纯色背景 + 一些"照片噪声"：不是白底，二维码只占中间一块
      var g = ctx.createLinearGradient(0, 0, 4000, 4000);
      g.addColorStop(0, '#8d99ae'); g.addColorStop(1, '#2b2d42');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 4000, 4000);
      for (var k = 0; k < 400; k++) {
        ctx.fillStyle = 'rgba(255,255,255,' + (0.02 + (k % 7) * 0.01).toFixed(3) + ')';
        ctx.fillRect((k * 137) % 3980, (k * 311) % 3980, 60, 60);
      }
      ctx.drawImage(inner, 1550, 1550, 900, 900);
      var blob = await pngOfCanvas(cv);
      return new File([blob], 'big-photo.png', { type: 'image/png' });
    },
    /** 把一张图片再旋转 deg 度（模拟"手机拍歪了 / EXIF 旋转被抹掉"的图） */
    rotateFile: async function (file, deg) {
      var img = await new Promise(function (res, rej) {
        var i = new Image(); i.onload = function () { res(i); }; i.onerror = rej;
        i.src = URL.createObjectURL(file);
      });
      var s = img.naturalWidth;
      var cv = document.createElement('canvas');
      cv.width = s; cv.height = s;
      var ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, s, s);
      ctx.translate(s / 2, s / 2);
      ctx.rotate((deg * Math.PI) / 180);
      ctx.drawImage(img, -s / 2, -s / 2, s, s);
      var blob = await pngOfCanvas(cv);
      return new File([blob], 'rotated-' + deg + '.png', { type: 'image/png' });
    },
    /** 一张没有任何二维码的图（条纹 + 圆），用来钉死"图里没码"这条如实话术 */
    fileOfNoise: async function () {
      var cv = document.createElement('canvas');
      cv.width = 420; cv.height = 420;
      var ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 420, 420);
      ctx.strokeStyle = '#222'; ctx.lineWidth = 9;
      for (var x = -420; x < 420; x += 46) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 420, 420); ctx.stroke(); }
      ctx.beginPath(); ctx.arc(210, 210, 120, 0, Math.PI * 2); ctx.strokeStyle = '#000'; ctx.lineWidth = 16; ctx.stroke();
      var blob = await pngOfCanvas(cv);
      return new File([blob], 'noise.png', { type: 'image/png' });
    },
    /** 不是图片的文件（例如一个 .txt） */
    fileOfTextPlain: function () {
      return new File([new Blob(['this is not an image'], { type: 'text/plain' })], 'not-image.txt', { type: 'text/chunWenBen' });
    },
    /** 把 File 塞进 <input type=file> 并派发 change —— 走的就是用户点选文件那条 DOM 监听 */
    async feedInput(inputSel, file) {
      var input = document.querySelector(inputSel);
      if (!input) return 'no-input';
      var dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return 'fed:' + input.files.length;
    },
    /** 拖入：真实 drop 事件（dataTransfer 里带着文件） */
    async drop(sinkSel, file) {
      var sink = document.querySelector(sinkSel);
      if (!sink) return 'no-sink';
      var dt = new DataTransfer();
      dt.items.add(file);
      sink.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true }));
      var ev = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'dataTransfer', { value: dt });
      sink.dispatchEvent(ev);
      return 'dropped';
    },
    /** 粘贴：真实 paste 事件（剪贴板里带着图片文件） */
    async paste(file) {
      var dt = new DataTransfer();
      dt.items.add(file);
      var ev = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'clipboardData', { value: dt });
      document.dispatchEvent(ev);
      return 'pasted';
    },
  };
})();
'helpers-ready';
`;

/** 装桩：让「我的链接」在预览里有真实数据（与 verify-net-ui 的做法一致），并给 joinRequest 装记录器 */
const PAGE_STUBS = `
(function () {
  window.warmy.meshStatus = async function () {
    return { ok: true, nodeId: ${JSON.stringify(NODE_ID)}, port: 59599, peers: [] };
  };
  window.warmy.inviteCreate = async function () {
    return { ok: true, invite: { token: ${JSON.stringify(TOKEN)}, expiresAt: Date.now() + 86400000 } };
  };
  window.__qrJoins = [];
  window.warmy.joinRequest = async function (payload) {
    window.__qrJoins.push(payload);
    return { ok: true };
  };
  return 'stubs-ready';
})();
`;

/* ══════════════════════════════════════════════════════════════════════════
   [A] 真实 dist 产物 + 真 CSP + 无桩：证明经典脚本加载与解码能力
   ══════════════════════════════════════════════════════════════════════════ */
console.log('\n[A] 真实 dist 产物（file:// + 真 CSP，无桥接桩）');
if (!fs.existsSync(DIST_HTML)) {
  console.error('[verify-qr-scan] 缺少构建产物 dist/renderer/index.html，请先 build');
  process.exit(2);
}
{
  const host = await startHost({ html: DIST_HTML, port: PORT_DIST, profileTag: 'qrscan-dist-profile' });
  if (!host) { ok(false, 'A-0 真实 dist 页面起来了', 'CDP 没起来'); }
  else {
    const c = host.c;
    try {
      const facts = await c.evaluate(`JSON.stringify((function(){
        var s = document.querySelector('script[src*="vendor/jsqr-1.4.0.js"]');
        var meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
        return {
          href: location.href, protocol: location.protocol,
          csp: meta ? meta.getAttribute('content') : null,
          decTag: !!s, decSrc: s ? s.getAttribute('src') : null, decType: s ? (s.getAttribute('type') || '') : 'absent',
          jsQR: typeof window.jsQR, enc: typeof window.qrcode,
          decLen: typeof window.jsQR === 'function' ? window.jsQR.length : -1
        };
      })())`);
      const f = evalJsonAny(facts);
      ok(String(f.href).startsWith('file:///') && f.protocol === 'file:', 'A-1 页面是真 file:// 加载（不是 http 预览）', String(f.href).slice(0, 60));
      ok(/script-src 'self'/.test(String(f.csp)) && !/unsafe-eval/.test(String(f.csp)),
        'A-2 这份文档带着真 CSP（script-src \'self\'，无 unsafe-eval）——预览默认产物里是没有的', String(f.csp).slice(0, 60));
      ok(f.decTag === true && String(f.decSrc).indexOf('vendor/jsqr-1.4.0.js') >= 0 && f.decType === '',
        'A-3 <script src="./vendor/jsqr-1.4.0.js"> 是经典脚本（type 为空），且真的在文档里', 'src=' + f.decSrc + ' type=' + JSON.stringify(f.decType));
      ok(f.jsQR === 'function', 'A-4 真 CSP 下 window.jsQR 真的加载成功（经典脚本这条路在 file:// + CSP 下可行）', 'jsQR=' + f.jsQR + ' arity=' + f.decLen);
      ok(f.enc === 'function', 'A-5 旁边那份 vendored 编码器也照常加载（没有被我改坏）', 'qrcode=' + f.enc);

      // 约束复现：这份文档里 ESM 确实走不通（否则"必须经典脚本"这个结论只是传说）
      const esm = await c.evaluate(`(async function(){ try { await import('./qr.js'); return 'IMPORT_OK'; } catch (e) { return 'IMPORT_FAILED: ' + String(e && e.message || e).slice(0, 80); } })()`);
      ok(String(esm).startsWith('IMPORT_FAILED'), 'A-6 同一份文档里动态 import() 被拦（所以解码器只能用经典脚本加载）', String(esm).slice(0, 70));
      const modTag = await c.evaluate(`(function(){
        return new Promise(function(res){ var s=document.createElement('script'); s.type='module'; s.src='./qr.js';
          s.onerror=function(){ res('MODULE_TAG_FAILED'); }; s.onload=function(){ res('MODULE_TAG_OK'); };
          document.head.appendChild(s); setTimeout(function(){ res('MODULE_TAG_UNKNOWN'); }, 2500); });
      })()`);
      ok(String(modTag) === 'MODULE_TAG_FAILED', 'A-7 module 脚本也被拦（两条 ESM 路都死，证据不是"猜的"）', String(modTag));

      // 真解码：用应用自己的编码器画一张 PNG（data: URL，不污染 canvas）→ canvas 像素 → jsQR
      await c.evaluate(PAGE_HELPERS);
      const round = await evalJson(c, `(async function(){
        var payload = 'warmy://join?node=' + ${JSON.stringify(NODE_ID)} + '&port=59599&tok=' + ${JSON.stringify(TOKEN)};
        var file = await window.__qrScanTest.fileOfText(payload, 6, 'dist-round.png');
        var dataUrl = await new Promise(function(res){ var fr=new FileReader(); fr.onload=function(){res(String(fr.result));}; fr.readAsDataURL(file); });
        var img = await new Promise(function(res,rej){ var i=new Image(); i.onload=function(){res(i);}; i.onerror=rej; i.src=dataUrl; });
        var cv = document.createElement('canvas'); cv.width=img.naturalWidth; cv.height=img.naturalHeight;
        var ctx = cv.getContext('2d'); ctx.drawImage(img,0,0);
        var px = ctx.getImageData(0,0,cv.width,cv.height);
        var r = window.jsQR(px.data, cv.width, cv.height, { inversionAttempts: 'attemptBoth' });
        return JSON.stringify({ payload: payload, decoded: r ? r.data : null, w: cv.width, h: cv.height,
          tainted: false, location: (r && r.location) ? true : false });
      })()`);
      ok(round.decoded === round.payload,
        'A-8 真 CSP + 真 file:// 下 jsQR 把「应用自己编码的二维码」解回**原字符串**（逐字符相等）',
        JSON.stringify({ w: round.w, h: round.h, ok: round.decoded === round.payload }));
      ok(String(round.payload).startsWith('warmy://join?'),
        'A-9 解出来的正是加入链接形态（warmy://join?…）', String(round.payload).slice(0, 50));
      const allErrs = c.errors();
      const errs = allErrs.filter((e) => !NO_BRIDGE_ERR.test(e));
      if (allErrs.length !== errs.length) {
        warn('[A] 段忽略 ' + (allErrs.length - errs.length) + ' 条"没有桥接桩"导致的接线报错（真实 dist 就是没有 window.warmy；与扫码无关）: ' + allErrs.filter((e) => NO_BRIDGE_ERR.test(e))[0].slice(0, 90));
      }
      ok(errs.length === 0, 'A-10 [A] 段除"无桥接桩"外没有控制台异常', JSON.stringify(errs.slice(0, 3)));
    } catch (e) {
      ok(false, 'A 段抛错', String(e.message).slice(0, 200));
    } finally {
      host.stop();
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   [B] 预览产物（--keep-csp）+ 桥接桩：完整「扫码 → 加入」链路
   ══════════════════════════════════════════════════════════════════════════ */
console.log('\n[B] 预览产物 --keep-csp：扫码 → 同一条加入路径');
const PREVIEW_OUT = path.join(OUT, 'preview-keep-csp');
{
  // 先删旧产物再构建：否则"这一轮真的重建过"就说不清（build-preview 不清理目录）
  fs.rmSync(PREVIEW_OUT, { recursive: true, force: true });
  const rc = (() => {
    try {
      execFileSync(process.execPath, [path.join(SELF_DIR, 'build-preview.mjs'), '--out', PREVIEW_OUT, '--keep-csp'], { stdio: 'inherit', cwd: repoRoot });
      return 0;
    } catch (e) {
      return e.status === undefined ? 1 : e.status;
    }
  })();
  ok(rc === 0, 'B-0 build-preview --keep-csp 构建成功', 'rc=' + rc);
  const prevHtml = fs.readFileSync(path.join(PREVIEW_OUT, 'index.html'), 'utf8');
  ok(/Content-Security-Policy/.test(prevHtml) && /bridge\.js/.test(prevHtml),
    'B-0b 带 CSP 的预览产物：CSP meta 保留 + 桥接桩注入（两者都要，缺一个就证明不了）', 'csp+bridge ok');
  ok(fs.existsSync(path.join(PREVIEW_OUT, 'vendor', 'jsqr-1.4.0.js')) && fs.existsSync(path.join(PREVIEW_OUT, 'vendor', 'jsqr-1.4.0.LICENSE.txt')),
    'B-0c 解码器与它的 LICENSE 都进了产物目录',
    'sha16=' + sha256(fs.readFileSync(path.join(PREVIEW_OUT, 'vendor', 'jsqr-1.4.0.js'))).slice(0, 16) + ' repo=' + sha256(fs.readFileSync(SHIPPED_DECODER)).slice(0, 16));
}
{
  const host = await startHost({ html: path.join(PREVIEW_OUT, 'index.html'), port: PORT_PREVIEW, profileTag: 'qrscan-preview-profile' });
  if (!host) { ok(false, 'B-1 预览页面起来了', 'CDP 没起来'); }
  else {
    const c = host.c;
    let at = 'B 段开始';
    try {
      at = 'B 启动与静态事实';
      await c.waitFor('typeof window.__saveState === "function" && typeof window.__PREVIEW__ === "boolean"', { timeout: 30000, label: 'B：预览页面就绪' });
      const boot = await evalJson(c, `JSON.stringify({
        href: location.href, protocol: location.protocol, csp: !!document.querySelector('meta[http-equiv="Content-Security-Policy"]'),
        jsQR: typeof window.jsQR, preview: window.__PREVIEW__ === true, entries: document.querySelectorAll('#rail .rail-item').length
      })`);
      ok(boot.protocol === 'file:' && boot.csp === true && boot.jsQR === 'function' && boot.preview === true && boot.entries >= 5,
        'B-1 页面在 file:// + 真 CSP 下起来了，解码器可用，界面渲染完整',
        JSON.stringify(boot));

      at = 'B 打开「添加联系人」弹窗';
      await c.evaluate(PAGE_HELPERS); // 把测试侧的取图工具装进页面（与 [A] 段同一份实现）
      await c.evaluate(`(function(){var e=document.querySelector('[data-nav="externalChat"]'); if(e) e.click(); return true;})()`);
      await c.waitFor(`!!document.querySelector('.rail-item[data-nav="externalChat"].active')`, { timeout: 10000, label: 'B：切到联系人页' });
      await c.evaluate(PAGE_STUBS);
      await c.evaluate(`(function(){var b=document.querySelector('#btn-join-qr'); if(b) b.click(); return true;})()`);
      await c.waitFor(`!!document.querySelector('#contact-my-qr svg') && !!document.querySelector('#contact-qr-scan')`, { timeout: 12000, label: 'B：添加联系人弹窗（含扫码区块）' });
      const ownLink = String(await c.evaluate("(document.querySelector('#contact-my-link')||{}).textContent || ''")).trim();
      ok(/^warmy:\/\/join\?/.test(ownLink) && ownLink.indexOf(NODE_ID) >= 0,
        'B-2 「我的链接」是真的邀请链接（扫码要解的就是它，方向正好与"展示我的二维码"相反）', ownLink);

      /* ── B-3：用户选图 → 解码 → 加入（主路径） ── */
      at = 'B 选图识别（主路径）';
      const scan = await evalJson(c, `(async function(){
        var file = await window.__qrScanTest.fileOfOwnSvg('#contact-my-qr svg', 336);
        window.__scanFeed = { bytes: file ? file.size : -1, type: file ? file.type : null };
        await window.__qrScanTest.feedInput('#contact-qr-file', file);
        return JSON.stringify(window.__scanFeed);
      })()`);
      await c.waitFor(`document.querySelector('#contact-qr-scan').getAttribute('data-scan-state') === 'found'`, { timeout: 15000, label: 'B：扫码命中' });
      await c.waitFor(`(window.__qrJoins||[]).length >= 1`, { timeout: 10000, label: 'B：加入被调用' });
      const after = await evalJson(c, `JSON.stringify((function(){
        var block = document.querySelector('#contact-qr-scan');
        return {
          state: block.getAttribute('data-scan-state'),
          detail: (document.querySelector('#contact-qr-detail')||{}).textContent || '',
          input: (document.querySelector('#join-link-input')||{}).value || '',
          joins: window.__qrJoins,
          msg: (document.querySelector('#join-qr-msg')||{}).textContent || '',
          inputHadFocusableButton: !!document.querySelector('#contact-qr-pick'),
          pickLabel: (document.querySelector('#contact-qr-pick')||{}).textContent || '',
          hint: (document.querySelector('#contact-qr-hint')||{}).textContent || ''
        };
      })())`);
      ok(scan.bytes > 200 && scan.type === 'image/png',
        'B-3 测试用的「对方的二维码图片」是真 PNG 文件（由应用自己渲染的二维码栅格化而来）', JSON.stringify(scan));
      ok(after.state === 'found' && after.joins.length === 1,
        'B-4 选图后本机解出链接并**立刻走加入路径**（一次，不重复）', JSON.stringify({ state: after.state, joins: after.joins.length }));
      ok(after.joins[0] && after.joins[0].target === ownLink,
        'B-5 加入的入参**逐字符等于**原二维码里的链接（解出来什么就喂什么，没有二次改写）',
        JSON.stringify(after.joins[0] && after.joins[0].target));
      ok(after.joins[0] && after.joins[0].targetType === 'contact' && after.joins[0].kind === 'human',
        'B-6 走的是**同一条**加入实现（与「粘贴链接 + 确定」相同的 targetType/kind/名片入参）',
        JSON.stringify(after.joins[0] && { t: after.joins[0].targetType, k: after.joins[0].kind, card: after.joins[0].card }));
      ok(after.input === ownLink,
        'B-7 解出来的链接写回了链接输入框（用户看得见、能核对——扫码与粘贴共用同一个入口）', after.input.slice(0, 50));
      ok(after.detail.indexOf(after.input.slice(0, 40)) >= 0 && after.detail.indexOf('{') < 0,
        'B-8 提示里如实报出识别到的链接（不是只写"识别成功"）', after.detail.slice(0, 70));
      ok(after.msg === ZH['join.ok'], 'B-9 加入结果显示的是语言包里的原话（join.ok）', JSON.stringify(after.msg));
      ok(after.pickLabel === ZH['join.pickImage'] && after.hint === ZH['join.dropHint'],
        'B-10 按钮/提示文案都来自语言包（没有硬编码中文）', JSON.stringify({ pick: after.pickLabel, hint: after.hint }));
      const png1 = await c.snap(path.join(OUT, 'scan-found.png'));
      if (!png1.ok) warn('截图失败（不影响判定）: ' + png1.reason);

      /* ── B-11：与"粘贴链接"是同一条路：把同一个链接手工粘进输入框再点确定 ── */
      at = 'B 粘贴路径对照';
      await reopenContactScan(c);
      await c.evaluate(`(function(){
        var inp = document.querySelector('#join-link-input'); inp.value = ${JSON.stringify(ownLink)};
        return true;})()`);
      await c.evaluate(`(function(){var bs=document.querySelectorAll('#modal-actions button'); for (var i=0;i<bs.length;i++){ if (bs[i].classList.contains('btn-primary')) { bs[i].click(); return true; } } return false;})()`);
      await c.waitFor(`(window.__qrJoins||[]).length >= 1`, { timeout: 8000, label: 'B：粘贴路径的加入调用' });
      const pasteJoin = await evalJson(c, `JSON.stringify(window.__qrJoins[0] || null)`);
      ok(pasteJoin && pasteJoin.target === after.joins[0].target && pasteJoin.targetType === after.joins[0].targetType,
        'B-11 粘贴链接与扫码走的是**同一条**加入入参（唯一实现，不是两条平行链路）',
        JSON.stringify({ paste: pasteJoin && pasteJoin.target, scan: after.joins[0].target }));

      /* ── B-12：大照片（4000px）也能扫出来 ── */
      at = 'B 大照片识别';
      await reopenContactScan(c);
      const big = await evalJson(c, `(async function(){
        var inner = await window.__qrScanTest.fileOfOwnSvg('#contact-my-qr svg', 900);
        var big = await window.__qrScanTest.fileOfLargePhoto(inner);
        await window.__qrScanTest.feedInput('#contact-qr-file', big);
        return JSON.stringify({ px: 4000, bytes: big.size, type: big.type });
      })()`);
      await c.waitFor(`document.querySelector('#contact-qr-scan').getAttribute('data-scan-state') === 'found'`, { timeout: 30000, label: 'B：大照片扫码命中' });
      await c.waitFor(`(window.__qrJoins||[]).length >= 1`, { timeout: 10000, label: 'B：大照片加入被调用' });
      const bigRes = await evalJson(c, `JSON.stringify({ state: document.querySelector('#contact-qr-scan').getAttribute('data-scan-state'), target: (window.__qrJoins[0]||{}).target })`);
      ok(big.bytes > 100000 && bigRes.state === 'found' && bigRes.target === ownLink,
        'B-12 4000×4000 的"拍摄照片"也能解出同一条链接（大图会先按尺寸缩几次再解）', JSON.stringify({ bytes: big.bytes, state: bigRes.state }));

      /* ── B-13：拖入（drop）这条 DOM 路径 ── */
      at = 'B 拖入路径';
      await reopenContactScan(c);
      await c.evaluate(`(async function(){ var f = await window.__qrScanTest.fileOfOwnSvg('#contact-my-qr svg', 336); await window.__qrScanTest.drop('#contact-qr-scan', f); return true; })()`);
      await c.waitFor(`(window.__qrJoins||[]).length >= 1`, { timeout: 15000, label: 'B：拖入后加入被调用' });
      const dropJoin = await evalJson(c, `JSON.stringify((window.__qrJoins||[])[0] || null)`);
      ok(dropJoin && dropJoin.target === ownLink, 'B-13 拖入图片同样能解出并走加入（drop 事件是真派发的）', JSON.stringify(dropJoin && dropJoin.target));

      /* ── B-14：粘贴（paste）这条 DOM 路径 ── */
      at = 'B 粘贴图片路径';
      await reopenContactScan(c);
      await c.evaluate(`(async function(){ var f = await window.__qrScanTest.fileOfOwnSvg('#contact-my-qr svg', 336); await window.__qrScanTest.paste(f); return true; })()`);
      await c.waitFor(`(window.__qrJoins||[]).length >= 1`, { timeout: 15000, label: 'B：粘贴后加入被调用' });
      const pasteImg = await evalJson(c, `JSON.stringify((window.__qrJoins||[])[0] || null)`);
      ok(pasteImg && pasteImg.target === ownLink, 'B-14 粘贴一张二维码截图（Ctrl+V）同样能解出并走加入', JSON.stringify(pasteImg && pasteImg.target));

      /* ── B-14b：拍歪/被旋转过的图（EXIF 被抹掉或手机横拍）也要能扫 ── */
      at = 'B 旋转过的图片';
      await reopenContactScan(c);
      await c.evaluate(`(async function(){
        var f = await window.__qrScanTest.fileOfOwnSvg('#contact-my-qr svg', 336);
        var rot = await window.__qrScanTest.rotateFile(f, 90);
        await window.__qrScanTest.feedInput('#contact-qr-file', rot);
        return true;
      })()`);
      await c.waitFor(`(window.__qrJoins||[]).length >= 1`, { timeout: 20000, label: 'B：旋转图也能解出' });
      const rotRes = await evalJson(c, `JSON.stringify({
        state: document.querySelector('#contact-qr-scan').getAttribute('data-scan-state'),
        via: document.querySelector('#contact-qr-scan').getAttribute('data-scan-via'),
        target: (window.__qrJoins[0]||{}).target
      })`);
      ok(rotRes.state === 'found' && rotRes.target === ownLink,
        'B-14b 90° 旋转过的二维码图同样解出同一条链接（非正立图片这条路上真跑通了）',
        JSON.stringify({ state: rotRes.state, via: rotRes.via }));
      console.log('    旋转图的命中现场: ' + rotRes.via);

      /* ── B-15：失败路径 1 —— 图里没有二维码 ── */
      at = 'B 失败路径：图里没码';
      await reopenContactScan(c);
      await c.evaluate(`(async function(){ var f = await window.__qrScanTest.fileOfNoise(); await window.__qrScanTest.feedInput('#contact-qr-file', f); return true; })()`);
      const noQr = await waitScanState(c, 'contact-qr', 'no-qr', 25000);
      // 文案里的 {n} = 实际尝试的尺寸/角度组合数：用语言包模板反解，不写死数字（写死会与实现悄悄脱钩）
      const noQrRe = new RegExp('^' + ZH['join.scanNoQr'].replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\{n\\}', '(\\d+)') + '$');
      const noQrMatch = noQrRe.exec(String(noQr.detail || ''));
      ok(!!noQrMatch && Number(noQrMatch[1]) >= 3,
        'B-15 图里没有二维码 → 如实说「没找到 + 已按 N 种尺寸/角度找过」，不静默、不假成功',
        JSON.stringify({ state: noQr.state, n: noQrMatch ? noQrMatch[1] : null, detail: String(noQr.detail).slice(0, 60) }));
      ok(noQr.joins === 0 && noQr.input === '', 'B-16 没解出东西时**绝不**调用加入、也不往输入框里塞东西（不会凭空造联系人）', JSON.stringify({ joins: noQr.joins, input: noQr.input }));

      /* ── B-17：失败路径 2 —— 解出来了但不是加入链接 ── */
      at = 'B 失败路径：不是加入链接';
      await reopenContactScan(c);
      await feedContactFile(c, `await window.__qrScanTest.fileOfText(${JSON.stringify(MALFORMED_PAYLOAD)}, 6, 'bad.png')`, 'B-17');
      const bad = await waitScanState(c, 'contact-qr', 'not-join-link', 20000);
      ok(bad.detail === ZH['join.scanNotJoinLink'].replace('{payload}', MALFORMED_PAYLOAD),
        'B-17 二维码内容不是加入链接 → 如实把**读到的原文**贴出来（用户能自己判断扫错了什么）',
        JSON.stringify({ state: bad.state, detail: String(bad.detail).slice(0, 80) }));
      ok(bad.joins === 0, 'B-18 载荷不是加入链接时不发起加入（不编造）', 'joins=' + bad.joins);
      await reopenContactScan(c);
      await feedContactFile(c, `await window.__qrScanTest.fileOfText(${JSON.stringify(PLAIN_TEXT_PAYLOAD)}, 6, 'plain.png')`, 'B-19');
      const plain = await waitScanState(c, 'contact-qr', 'not-join-link', 20000);
      ok(plain.detail.indexOf(PLAIN_TEXT_PAYLOAD) >= 0 && plain.joins === 0,
        'B-19 纯文本二维码（不是链接）也如实回显原文且不加入', JSON.stringify({ state: plain.state, detail: String(plain.detail).slice(0, 60) }));

      /* ── B-20：失败路径 3 —— 选进来的不是图片 ── */
      at = 'B 失败路径：不是图片';
      await reopenContactScan(c);
      await feedContactFile(c, `window.__qrScanTest.fileOfTextPlain()`, 'B-20');
      const notImg = await waitScanState(c, 'contact-qr', 'not-image', 12000);
      ok(notImg.detail === ZH['join.scanNotImage'] && notImg.joins === 0,
        'B-20 选进来不是图片 → 如实说"这不是图片文件"（本地判类型，不硬解）',
        JSON.stringify({ state: notImg.state, detail: String(notImg.detail).slice(0, 60) }));

      /* ── B-21：失败路径 4 —— 解码器没加载（如实说，不假装能扫） ── */
      at = 'B 失败路径：解码器缺失';
      await reopenContactScan(c);
      await c.evaluate(`(function(){ window.__jsQRSaved = window.jsQR; window.jsQR = undefined; return true; })()`);
      await feedContactFile(c, `await window.__qrScanTest.fileOfOwnSvg('#contact-my-qr svg', 336)`, 'B-21');
      const noDec = await waitScanState(c, 'contact-qr', 'no-decoder', 12000);
      ok(noDec.detail === ZH['join.scanUnavailable'] && noDec.joins === 0,
        'B-21 解码器没加载时如实说「本机暂时无法识图，仍可粘贴链接」——不静默、也不假装成功',
        JSON.stringify({ state: noDec.state, detail: String(noDec.detail).slice(0, 60) }));
      await c.evaluate(`(function(){ window.jsQR = window.__jsQRSaved; return typeof window.jsQR; })()`);
      await c.evaluate(`(function(){ var f=document.querySelector('#contact-qr-file'); f.value=''; document.querySelector('#modal-root').classList.add('hidden'); return true; })()`);
      const badShot = await c.snap(path.join(OUT, 'scan-honest-failures.png'));
      if (!badShot.ok) warn('截图失败（不影响判定）: ' + badShot.reason);

      /* ── B-22：项目/群聊弹窗里也接了同一条路（同一份扫码区块实现） ── */
      at = 'B 项目弹窗扫码';
      await c.evaluate(`(function(){var e=document.querySelector('[data-nav="internalGroup"]'); if(e) e.click(); return true;})()`);
      await c.waitFor(`!!document.querySelector('.rail-item[data-nav="internalGroup"].active')`, { timeout: 10000, label: 'B：切到项目页' });
      await c.evaluate(`(function(){window.__qrJoins=[]; var b=document.querySelector('#btn-join-qr'); if(b) b.click(); return true;})()`);
      await c.waitFor(`!!document.querySelector('#join-qr-scan') && !!document.querySelector('#join-qr-file')`, { timeout: 10000, label: 'B：加入项目/群聊弹窗的扫码区块' });
      await c.evaluate(`(async function(){ var f = await window.__qrScanTest.fileOfText(${JSON.stringify('warmy://join?node=NODE-R16-QR-0001&port=59599&tok=TOK-R16-QR-0002')}, 6, 'proj.png'); await window.__qrScanTest.feedInput('#join-qr-file', f); return true; })()`);
      await c.waitFor(`(window.__qrJoins||[]).length >= 1`, { timeout: 20000, label: 'B：项目弹窗扫码后加入被调用' });
      const projJoin = await evalJson(c, `JSON.stringify({
        join: (window.__qrJoins||[])[0] || null,
        state: document.querySelector('#join-qr-scan').getAttribute('data-scan-state'),
        detail: (document.querySelector('#join-qr-detail')||{}).textContent || '',
        input: (document.querySelector('#join-link-input')||{}).value || ''
      })`);
      ok(projJoin.state === 'found' && projJoin.join && /project|group/.test(String(projJoin.join.targetType)) && projJoin.input.indexOf('warmy://join?') === 0,
        'B-22 「加入项目/群聊」弹窗用的是同一份扫码实现（同一套 DOM 监听 + 同一个提交函数）',
        JSON.stringify({ state: projJoin.state, type: projJoin.join && projJoin.join.targetType }));

      /* ── B-23：i18n 两包齐备（新键在两包都有、英文包没有中文） ── */
      at = 'B i18n';
      const NEW_KEYS = ['contact.scanHint', 'join.scanWorking', 'join.scanNoQr', 'join.scanNoJoinLink', 'join.scanNotImage',
        'join.scanReadFail', 'join.scanUnavailable', 'join.scanFound', 'join.scanEmpty', 'join.scanDropRelease'];
      const missing = NEW_KEYS.filter((k) => !ZH[k] || !EN[k]);
      const cjk = NEW_KEYS.filter((k) => /[\u4e00-\u9fff]/.test(String(EN[k] || '')));
      ok(missing.length === 0, 'B-23 新增的扫码文案在两个语言包都有', JSON.stringify(missing));
      ok(cjk.length === 0, 'B-24 英文包里这些新键没有中文残留', JSON.stringify(cjk));
      const liveEnReady = await c.evaluate(`(function(){
        var pack = window.warmy && window.warmy.i18n;
        return true; })()`);
      void liveEnReady;

      /* ── B-25：切英文后弹窗里的扫码文案真的变成英文（不是只有语言包里有译文） ── */
      at = 'B 英文界面下的扫码区块';
      await c.evaluate(`(function(){ document.querySelector('#modal-root').classList.add('hidden'); return true; })()`);
      await c.evaluate(`(function(){var e=document.querySelector('[data-nav="settings"]'); if(e) e.click(); return true;})()`);
      const secOk = await c.waitForQuiet(`!!document.querySelector('#settings-nav button[data-sec="ui"]')`, { timeout: 12000, label: 'B：设置页 UI 分区' });
      if (secOk) await c.evaluate(`(function(){var b=document.querySelector('#settings-nav button[data-sec="ui"]'); if(b) b.click(); return true;})()`);
      const enReady = await c.waitForQuiet(`!!document.querySelector('#sel-locale')`, { timeout: 12000, label: 'B：语言选择器' }) ? 'has-select' : 'no-locale-select';
      if (enReady === 'has-select') {
        await c.evaluate(`(function(){var s=document.querySelector('#sel-locale'); s.value='en-US'; s.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
        await c.waitFor(`(document.querySelector('#logo-name')||{}).textContent === 'WArmy'`, { timeout: 12000, label: 'B：切到英文' });
        await c.evaluate(`(function(){var e=document.querySelector('[data-nav="externalChat"]'); if(e) e.click(); return true;})()`);
        await c.waitFor(`!!document.querySelector('.rail-item[data-nav="externalChat"].active')`, { timeout: 10000, label: 'B：英文下切到联系人页' });
        await c.evaluate(`(function(){var b=document.querySelector('#btn-join-qr'); if(b) b.click(); return true;})()`);
        await c.waitFor(`!!document.querySelector('#contact-qr-scan')`, { timeout: 12000, label: 'B：英文下的添加联系人弹窗' });
        const enUi = await evalJson(c, `JSON.stringify({
          pick: (document.querySelector('#contact-qr-pick')||{}).textContent || '',
          hint: (document.querySelector('#contact-qr-hint')||{}).textContent || '',
          cjk: (document.querySelector('#add-contact-others')||{}).innerText || ''
        })`);
        ok(enUi.pick === EN['join.pickImage'] && enUi.hint === EN['join.dropHint'],
          'B-25 切到英文后扫码区块的按钮与提示是英文包里的原话（i18n 真的接到了新 UI 上）',
          JSON.stringify({ pick: enUi.pick, hint: enUi.hint }));
        ok(!/[\u4e00-\u9fff]/.test(String(enUi.cjk)), 'B-26 英文界面里扫码区块没有中文残留', String(enUi.cjk).replace(/\s+/g, ' ').slice(0, 60));
        await c.evaluate(`(function(){document.querySelector('#modal-root').classList.add('hidden'); return true;})()`);
        await c.evaluate(`(function(){var e=document.querySelector('[data-nav="settings"]'); if(e) e.click(); return true;})()`);
        await c.waitForQuiet(`!!document.querySelector('#settings-nav button[data-sec="ui"]')`, { timeout: 10000, label: 'B：回到设置页' });
        await c.evaluate(`(function(){var b=document.querySelector('#settings-nav button[data-sec="ui"]'); if(b) b.click(); return true;})()`);
        await c.waitForQuiet(`!!document.querySelector('#sel-locale')`, { timeout: 10000, label: 'B：语言选择器（回到中文）' });
        await c.evaluate(`(function(){var s=document.querySelector('#sel-locale'); s.value='zh-CN'; s.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
        await c.waitForQuiet(`(document.querySelector('#logo-name')||{}).textContent !== 'WArmy'`, { timeout: 12000, label: 'B：切回中文' });
        await c.evaluate(`(function(){document.querySelector('#modal-root').classList.add('hidden'); return true;})()`);
      } else {
        warn('没找到语言选择器，跳过英文界面断言（' + enReady + '）');
      }

      at = 'B 收尾';
      const errs = c.errors().filter((e) => !/Electron Security Warning/i.test(e));
      ok(errs.length === 0, 'B-27 [B] 段全程没有控制台异常/未捕获错误', JSON.stringify(errs.slice(0, 3)).slice(0, 220));
    } catch (e) {
      ok(false, 'B 段卡在「' + at + '」', String(e.message).slice(0, 240));
    } finally {
      host.stop();
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════════ */
const pass = R.summary('R16 扫码（扫别人的二维码）验收');
fs.writeFileSync(path.join(OUT, 'qr-scan-result.json'), JSON.stringify({ pass, results: R.results }, null, 1));
killAll();
console.log('产物目录: ' + OUT);
process.exit(pass ? 0 : 2);
