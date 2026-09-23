/**
 * 二维码的**验收侧参考实现**（Node / ESM）。
 *
 * 注意：这个文件**不再被渲染层加载**。
 * 渲染层是 file:// 页面，index.html 的 CSP 是 `script-src 'self'`（没有 unsafe-eval）。
 * 本轮在**真实 dist 产物**上复现过：动态 import('./qr.js') 与 `<script type="module" src>`
 * 都加载失败 —— ESM 那条路在 file:// + CSP 下走不通（注意别再拿 CDP 的 Runtime.evaluate 去测
 * eval/new Function：DevTools 求值不受页面 CSP 约束，那种测法证不了 CSP）。
 * 所以渲染层改用 index.html 里的**经典脚本**：
 *   vendor/qrcode-generator-2.0.4.js（vendored，MIT，全局 `qrcode`），
 * 由 yingYong.js 的 `qrSvg()` 编码 + 画成 SVG。
 *
 * 这个文件还留着，是给验收脚本一个**独立于浏览器的真值**：
 *   * qrMatrix(text)：把 vendored 编码器的模块矩阵原样取出来（Node 里算）；
 *   * qrSvg(text, size)：用与渲染层同一套几何规则（静区 4 模块、单位边长 = size/(模块数+8)）
 *     把矩阵画成 SVG 字符串。
 * verify-net-ui 拿它跟浏览器 DOM 里的实际输出做**逐模块 + 逐字节**比对 ——
 * 两边都走 vendored 编码器，但一边在 Node、一边在 Chromium 的真实 DOM 里，
 * 于是「渲染层真的接上了真编码器」是被证明的，而不是被假设的。
 *
 * 两份实现（yingYong.js 的 qrSvg 与这里的 qrSvg）的重复是**故意的**：
 * verify-net-ui 的 R4-4 断言逐字节比对它们，一旦漂移就会失败。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

/** 与 index.html 里引入的必须是同一个文件 */
export const QR_VENDOR_FILE = 'vendor/qrcode-generator-2.0.4.js';
export const QR_ECC = 'M'; // 纠错等级 M（产品要求）
export const erweimaAnjing = 4; // 静区 4 个模块（ISO/IEC 18004 要求 ≥4）

const VENDOR_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'vendor', 'qrcode-generator-2.0.4.js');

/** 在 Node 的 vm 沙箱里跑那份经典脚本（`var qrcode = ...` 会挂到上下文全局上），取出全局 qrcode */
function loadClassicEncoder() {
  const src = fs.readFileSync(VENDOR_PATH, 'utf8');
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: QR_VENDOR_FILE });
  const enc = sandbox.qrcode;
  if (typeof enc !== 'function') throw new Error('vendored encoder did not expose a global `qrcode`: ' + VENDOR_PATH);
  // 链接里可能有非 ASCII（别名/名字）——上游默认是 Latin-1 式映射，显式换 UTF-8（与 yingYong.js 一致）
  if (enc.stringToBytesFuncs && enc.stringToBytesFuncs['UTF-8']) enc.stringToBytes = enc.stringToBytesFuncs['UTF-8'];
  return enc;
}

const qrcode = loadClassicEncoder();

/** 供验收脚本断言「vendored 编码器确实可加载、确实是它」 */
export const encoderInfo = {
  file: QR_VENDOR_FILE,
  version: '2.0.4',
  hasUtf8: !!(qrcode.stringToBytesFuncs && qrcode.stringToBytesFuncs['UTF-8']),
  globals: ['qrcode'],
};

/**
 * 真 QR 的模块矩阵。
 * @param {string} text 载荷
 * @param {string} ecc  纠错等级（默认 M）
 * @returns {{modules:number, version:number, ecc:string, matrix:boolean[][]}}
 */
export function qrMatrix(text, ecc = QR_ECC) {
  const erWeiMa = qrcode(0, ecc); // typeNumber 0 = 版本自适应
  erWeiMa.addData(String(text == null ? '' : text), 'Byte');
  erWeiMa.make();
  const n = erWeiMa.getModuleCount();
  const matrix = [];
  for (let r = 0; r < n; r++) {
    const hang = [];
    for (let c = 0; c < n; c++) hang.push(!!erWeiMa.isDark(r, c));
    matrix.push(hang);
  }
  return { modules: n, version: (n - 17) / 4, ecc: ecc, matrix: matrix };
}

/**
 * 与渲染层**同一套几何规则**的 SVG（属性顺序也必须一致，验收会逐字节比）。
 * @param {string} text  载荷
 * @param {number} size  边长（CSS px）
 * @param {string} ecc   纠错等级
 * @param {string} biaoQian aria-label（i18n 文案；验收比对时会被规范化掉，另行与语言包逐字比）
 */
export function qrSvg(text, size = 168, ecc = QR_ECC, biaoQian = '') {
  const data = String(text == null ? '' : text);
  if (!data) return '';
  const { modules: n, matrix } = qrMatrix(data, ecc);
  const anJing = erweimaAnjing;
  const total = n + anJing * 2;
  const unit = size / total;
  const juXingJi = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!matrix[r][c]) continue;
      juXingJi.push(
        '<rect x="' + ((c + anJing) * unit).toFixed(3) + '" y="' + ((r + anJing) * unit).toFixed(3) +
        '" width="' + unit.toFixed(3) + '" height="' + unit.toFixed(3) + '"/>'
      );
    }
  }
  const attrs =
    ' data-qr-version="' + ((n - 17) / 4) + '" data-qr-modules="' + n +
    '" data-qr-ecc="' + ecc + '" data-qr-quiet="' + anJing + '" data-qr-unit="' + unit.toFixed(6) +
    '" data-qr-payload-len="' + data.length + '"';
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size +
    '" viewBox="0 0 ' + size + ' ' + size + '" role="img" aria-label="' + biaoQian + '"' + attrs + '>' +
    '<rect width="' + size + '" height="' + size + '" fill="#fff"/>' +
    '<g fill="#111">' + juXingJi.join('') + '</g></svg>';
}

/** 把 SVG 里的 aria-label 抹平（i18n 文案随语言变，逐字节比之前必须先规范化） */
export function stripAriaLabel(svg) {
  return String(svg).replace(/aria-label="[^"]*"/, 'aria-label=""');
}
