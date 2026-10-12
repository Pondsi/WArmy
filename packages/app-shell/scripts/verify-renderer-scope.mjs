#!/usr/bin/env node
/**
 * verify-renderer-scope.mjs —— **渲染层作用域门禁**（硬门禁，产品自带，模型不得修改）
 *
 * 为什么需要：本仓已经**三次**栽在同一类坑上（项目记忆里有记录）：
 *   ① `window.__nengLiBiaoQianHtml` / `window.__mimicActions` —— 只读不写 ⇒ 功能静默失效；
 *   ② `wenJianIco` 定义在「右栏文件产物」的渲染函数里，聊天区一调用就
 *      `ReferenceError: wenJianIco is not defined` ⇒ 整块附件图标行渲染不出来（空框）；
 *   ③ 同一函数在顶层被声明两次（后者覆盖前者）⇒ 改了"那个"其实改的是另一个。
 *
 * 这三类都能**静态**查出来，不用等真机：
 *   A. `window.__x` 有读、没写（有人赋值才允许读）
 *   B. 函数名在**另一个函数体内**被调用，却只定义在**某个函数体内**（跨作用域泄漏）
 *   C. 顶层同名声明出现多次（后面的会覆盖前面的）
 *
 * 用法：node packages/app-shell/scripts/verify-renderer-scope.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(here, '..');
const FILES = [
  path.join(pkgRoot, 'src', 'renderer', 'app.js'),
  path.join(pkgRoot, 'src', 'renderer', 'niu-ma-templates.js'),
];

let pass = 0;
let fail = 0;
const bad = [];
const ok = (c, l, d) => { if (c) { pass++; console.log('  PASS ' + l); } else { fail++; bad.push(l); console.log('  FAIL ' + l + (d ? '  => ' + String(d).slice(0, 300) : '')); } };

/** 去掉注释/字符串/模板字面量，避免把里面的括号当代码（模板里的 ${} 递归处理） */
function tokenize(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  let line = 1;
  const push = (ch) => out.push(ch);
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '\n') { line++; push('\n'); i++; continue; }
    // ⚠️ 顺序很重要：**先认引号，再认注释**（否则字符串里的 `//`（例如 URL）会被当注释，
    // 把这一行的收尾引号一起吃掉 ⇒ 后面整段被误当字符串，检查直接失效）
    if (c === '"' || c === "'") { const q = c; i++; while (i < n && src[i] !== q) { if (src[i] === '\\') i++; if (src[i] === '\n') { line++; push('\n'); } i++; } i++; continue; }
    if (c === '/' && c2 === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && c2 === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') { line++; push('\n'); } i++; } i += 2; continue; }
    if (c === '`') {
      i++;
      let depth = 0;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '\n') { line++; push('\n'); i++; continue; }
        if (src[i] === '$' && src[i + 1] === '{') { depth++; push('{'); i += 2; continue; }
        if (depth > 0 && src[i] === '}') { depth--; push('}'); i++; continue; }
        if (depth === 0 && src[i] === '`') { i++; break; }
        // 模板正文里的标识符也留着（`${f()}` 里的 f 要能被 grep 到）
        if (depth > 0) push(src[i]);
        i++;
      }
      continue;
    }
    push(c);
    i++;
  }
  return out.join('');
}

/** 顶层（大 IIFE 内、括号深度 1）的声明 + 每个函数的行范围 */
/** 扫描：函数范围（字符偏移 + 花括号配对）、顶层声明、函数体内的 const/let 声明、调用点 */
function scan(src) {
  const clean = tokenize(src);
  const lines = clean.split('\n');
  const rawLines = src.split('\n');
  // 字符偏移 → 行号
  const hangHao = new Array(clean.length);
  {
    let ln = 0;
    for (let i = 0; i < clean.length; i++) { hangHao[i] = ln; if (clean[i] === '\n') ln++; }
  }
  /** 从 start 处的 '{' 开始配对，返回结束花括号的偏移（找不到返回 -1） */
  const peiHua = (kai) => {
    let d = 0;
    for (let i = kai; i < clean.length; i++) {
      if (clean[i] === '{') d++;
      else if (clean[i] === '}') { d--; if (d === 0) return i; }
    }
    return -1;
  };
  const funcs = [];
  const declAtTop = new Map();
  const dupTop = [];
  const hu = /(?:^|[^\w$.])(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = hu.exec(clean))) {
    const name = m[1];
    const kai = clean.indexOf('{', m.index + m[0].length);
    const bi = kai >= 0 ? peiHua(kai) : -1;
    const start = hangHao[m.index] || 0;
    const end = bi >= 0 ? hangHao[bi] : start;
    const depth0 = (clean.slice(0, m.index).match(/\{/g) || []).length - (clean.slice(0, m.index).match(/\}/g) || []).length;
    if (depth0 <= 1) {
      if (declAtTop.has(name)) dupTop.push(name + '（第二处在第 ' + (start + 1) + ' 行，第一处在第 ' + (declAtTop.get(name) + 1) + ' 行）');
      else declAtTop.set(name, start);
    }
    funcs.push({ name, start, end, depth: depth0 });
  }
  // 调用点（排除 .foo( / function foo( / 关键字）
  const calls = [];
  {
    const re = /(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g;
    let c2;
    while ((c2 = re.exec(clean))) {
      const name = c2[2];
      if (['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'new', 'await', 'async', 'do', 'else', 'try', 'in', 'of', 'void', 'delete', 'yield'].includes(name)) continue;
      calls.push({ name, line: hangHao[c2.index] || 0 });
    }
  }
  // 函数体内声明的 const/let/var（顶层的不算）
  const localDecl = new Map();
  {
    const re = /(?:^|[\s;{(])(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g;
    let c3;
    while ((c3 = re.exec(clean))) {
      const name = c3[1];
      if (declAtTop.has(name)) continue;
      const ln = hangHao[c3.index] || 0;
      const owner = funcs.filter((f) => ln >= f.start && ln <= f.end).sort((x, y) => (x.end - x.start) - (y.end - y.start))[0];
      if (owner && !localDecl.has(name)) localDecl.set(name, { ownerStart: owner.start, ownerEnd: owner.end, owner: owner.name });
    }
  }
  return { funcs, calls, declAtTop, dupTop, localDecl, rawLines, lines, clean };
}

/**
 * 三类检查的实现（同一份逻辑既跑真文件，也跑"自证样例"——
 * **门禁必须能失败**：样例里故意各放一个违规，检查必须都能抓出来，否则这门禁是摆设）。
 */
function jianCe(src, jian) {
  const { funcs, calls, declAtTop, dupTop, localDecl } = scan(src);
  // A. window.__x 只读不写（只用"去注释"的轻量清洗，见下方说明）
  const banQing = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
  const reads = new Set();
  {
    // ⚠️ 名字至少要 3 个字符（`__` 之后 ≥2）：否则文档/注释里写「window.__x」这种**示例名**
    //    会被当成真的别名读（本门禁自己的文案就踩过这个自伤）。
    const reR = /window\.(__[A-Za-z_$][\w$]{2,})/g;
    let m;
    while ((m = reR.exec(banQing))) reads.add(m[1]);
  }
  const quanXie = new Set();
  {
    const re = /window\.(__[A-Za-z_$][\w$]{2,})\s*(?:=|(?:\|\||\?\?)=\+\+|\+\+)/g;
    let m;
    while ((m = re.exec(quanWen))) quanXie.add(m[1]);
  }
  const zhiDu = [...reads].filter((k) => !quanXie.has(k) && !WAI_BU_ZHURU.has(k));
  // B. 跨作用域泄漏
  const leak = [];
  for (const [name, d] of localDecl) {
    if (declAtTop.has(name)) continue;
    const calls2 = calls.filter((x) => x.name === name);
    if (!calls2.length) continue;
    const wai = calls2.filter((c) => c.line < d.ownerStart || c.line > d.ownerEnd);
    if (wai.length) leak.push(name + '（定义在 ' + d.owner + ' 内，却在第 ' + wai.slice(0, 3).map((x) => x.line + 1).join('/') + ' 行被调用）');
  }
  return { zhiDu, leak, dupTop };
}

console.log('=== 渲染层作用域门禁（硬门禁）===');
// 全体渲染层文件（含 index.html 的内联脚本）：`window.__x` 的**赋值**可能写在别的文件里
// （例如 `busy-phrases.js` 负责 `__BUSY_PHRASES`、`niu-ma-templates.js` 负责 `__NIU_MA_TEMPLATES`），
// 所以"有没有人赋值"要**整目录**看，不能只看 app.js —— 否则全是误报。
const rendererDir = path.join(pkgRoot, 'src', 'renderer');
const quanWen = fs
  .readdirSync(rendererDir)
  .filter((n) => n.endsWith('.js') || n.endsWith('.html'))
  .map((n) => fs.readFileSync(path.join(rendererDir, n), 'utf8'))
  .join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, ' ');

/**
 * **外部注入的别名**（不是本仓渲染层写的，读它们是对的，不算"只读别名"）：
 *   · `scripts/net-ui-harness.js`（预览/联调桩）会注入 `__warmyNetStub` / `__warmyIdentityStub` / `__netTuning` / `__idchgTuning`；
 *   · `__PREVIEW__` 是"当前是不是预览桩页面"的探测位。
 */
const WAI_BU_ZHURU = new Set(['__PREVIEW__', '__warmyPreview', '__warmyNetStub', '__warmyIdentityStub', '__netTuning', '__idchgTuning']);

// ⓪ 自证：样例里三类违规各一处，必须全部被逮到
{
  const yang = [
    'window.__zhiDuBieMing ? window.__zhiDuBieMing() : 1;',
    'function waiCeng() {',
    '  const juBuZhuShou = (x) => x + 1;',
    '  return juBuZhuShou(1);',
    '}',
    'function lingYiGe() { return juBuZhuShou(2); }',
    'function chongMing() { return 1; }',
    'function chongMing() { return 2; }',
  ].join('\n');
  const r = jianCe(yang, 'sample');
  ok(r.zhiDu.length > 0, '自证：只读别名能被抓出来', r.zhiDu.join(','));
  ok(r.leak.length > 0, '自证：跨作用域调用能被抓出来', r.leak.join(';'));
  ok(r.dupTop.length > 0, '自证：顶层重复声明能被抓出来', r.dupTop.join(';'));
}

for (const f of FILES) {
  if (!fs.existsSync(f)) { console.log('  SKIP（不存在）' + f); continue; }
  const src = fs.readFileSync(f, 'utf8');
  const jian = path.basename(f);
  const r = jianCe(src, jian);
  ok(r.zhiDu.length === 0, jian + '：window.__x 有读就有写（无只读别名）', r.zhiDu.length ? '只读未赋值: ' + r.zhiDu.join(', ') : 'ok');
  ok(r.leak.length === 0, jian + '：函数不跨作用域泄漏（局部定义不许在别处调用）', r.leak.length ? r.leak.join('；') : 'ok');
  ok(r.dupTop.length === 0, jian + '：顶层没有重复声明（后者会覆盖前者）', r.dupTop.length ? r.dupTop.join('；') : 'ok');
}

console.log(`\n==== verify-renderer-scope: ${pass} ok / ${fail} FAIL ====`);
if (fail) console.log('失败项：\n - ' + bad.join('\n - '));
process.exit(fail ? 1 : 0);
