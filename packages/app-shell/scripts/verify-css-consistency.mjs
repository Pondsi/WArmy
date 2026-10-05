#!/usr/bin/env node
/**
 * verify-css-consistency —— app.css 与 renderer.css **同名规则不许打架**。
 *
 * 为什么需要它：这两份样式表是重复定义的（历史上先后写过同一批选择器），
 * 而 index.html 里 **renderer.css 后加载** ⇒ 同特异性时它赢。
 * 真事故连着三次：
 *   · `.yinDaoTiao` 一份 top:50%、一份 bottom:24px ⇒ 卡片被拉高一截、底部空一大块；
 *   · `.bubble` 一份 max-width:100%、一份 70% ⇒ 用户连着三轮说"对话宽度还是太窄"；
 *   · `.siKaoKuai pre` 一份 42vh、一份 220px ⇒ 思考块滚动高度被盖掉。
 * 规则：同一个选择器在两份文件里都出现时，**尺寸/定位类属性必须一致**。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const appCss = fs.readFileSync(path.join(root, 'packages/app-shell/src/renderer/app.css'), 'utf8');
const renCss = fs.readFileSync(path.join(root, 'packages/app-shell/src/renderer/renderer.css'), 'utf8');

function chouQu(css) {
  const out = new Map();
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const sel = m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (!sel || sel.startsWith('@')) continue;
    // 声明里也可能夹注释 —— 先去掉，否则会污染属性值比对
    const decl = m[2].replace(/\/\*[\s\S]*?\*\//g, '');
    for (const s of sel.split(',').map((x) => x.trim()).filter(Boolean)) {
      if (!out.has(s)) out.set(s, '');
      out.set(s, out.get(s) + ';' + decl);
    }
  }
  return out;
}

const GUANJIAN = [
  'position', 'top', 'bottom', 'left', 'right',
  'width', 'height', 'max-width', 'max-height', 'min-width', 'min-height',
  'transform', 'overflow', 'flex-direction', 'display',
];

function quShu(shengMing, shuXing) {
  const esc = shuXing.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const re = new RegExp('(?:^|;)\\s*' + esc + '\\s*:\\s*([^;]+)', 'i');
  const mm = shengMing.match(re);
  if (!mm) return null;
  return mm[1].trim().toLowerCase().replace(/\s*!\s*important/g, '').replace(/\s+/g, ' ').trim();
}

let pass = 0, fail = 0;
const fails = [];
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log('  PASS', label); }
  else { fail++; fails.push(label); console.log('  FAIL', label); if (detail) console.log('       ' + detail); }
};

const a = chouQu(appCss);
const r = chouQu(renCss);
const gongTong = [...a.keys()].filter((k) => r.has(k));
console.log('[1] 两份 CSS 共有 ' + gongTong.length + ' 个同名选择器');

const chongTu = [];
for (const sel of gongTong) {
  if (/^(from|to|\d+(\.\d+)?%)$/i.test(sel)) continue;
  const sa = a.get(sel) || '';
  const sr = r.get(sel) || '';
  for (const shu of GUANJIAN) {
    const va = quShu(sa, shu);
    const vr = quShu(sr, shu);
    if (va !== null && vr !== null && va !== vr) {
      chongTu.push(sel + ' { ' + shu + ': app=' + va + ' / renderer=' + vr + ' }');
    }
  }
}
check('同名选择器的尺寸/定位属性不许冲突', chongTu.length === 0,
  chongTu.length ? chongTu.join('\n       ') : '');

console.log('\n[2] 气泡宽度');
check('renderer.css 的 .bubble 不能写死 70%', !/max-width:\s*70%/.test(r.get('.bubble') || ''));
check('app.css 的 .bubble 不能写死 70%', !/max-width:\s*70%/.test(a.get('.bubble') || ''));
const ma = quShu(a.get('.xiaoXi .bubbleWrap') || a.get('.bubbleWrap') || '', 'max-width');
const mr = quShu(r.get('.xiaoXi .bubbleWrap') || r.get('.bubbleWrap') || '', 'max-width');
check('两份 .xiaoXi .bubbleWrap 的 max-width 一致', ma !== null && ma === mr, 'app=' + ma + ' renderer=' + mr);

console.log('\n[3] 思考块高度');
check('两份 .siKaoKuai pre 的 max-height 一致', quShu(a.get('.siKaoKuai pre') || '', 'max-height') === quShu(r.get('.siKaoKuai pre') || '', 'max-height'));

console.log('\n[4] 引导卡');
check('两份 .yinDaoTiao 不能有 translateY(-50%)', !/translateY\(-50%\)/.test(a.get('.yinDaoTiao') || '') && !/translateY\(-50%\)/.test(r.get('.yinDaoTiao') || ''));

console.log('\n==== verify-css-consistency: ' + pass + ' ok / ' + fail + ' FAIL ====');
if (fails.length) console.log('失败项：\n - ' + fails.join('\n - '));
process.exit(fail ? 1 : 0);
