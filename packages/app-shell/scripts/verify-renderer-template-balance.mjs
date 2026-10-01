#!/usr/bin/env node
/**
 * 渲染层模板字面量的**HTML 标签平衡**门禁。
 *
 * 为什么需要它（本轮真实事故）：
 *   把 WebGPU 卡从「设置 → 模型」挪到「功能」分区时，改的人少写/多写了一个 `</div>`：
 *     · `#peiZhiNeiRong`（设置页内容列）被提前闭合 —— 后半部分分区跑到两列网格里，
 *       整块「本地 SKILL」被塞进 200px 的左侧导航列；
 *     · `#webgpuKa` 自己的 `</div>` 丢了 —— 「新手引导」「快捷」「关于」全被吞进 WebGPU 卡里。
 *   总量是"平衡"的（一多一少），所以只做全局计数根本抓不住；必须**逐模板**计数。
 *   `verify-template-integrity.mjs` 只查"丢 ${}"这一类，管不了标签；tsc / check-syntax 更看不到
 *   （它就是一个合法的字符串）。
 *
 * 用法：node verify-renderer-template-balance.mjs [要检查的文件]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(selfDir, '..');
const fileArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const file = fileArg ? path.resolve(fileArg) : path.join(pkgRoot, 'src', 'renderer', 'app.js');

/** 非空元素（有闭合标签）—— 空元素（input/img/br/hr）天然不成对，不参与计数 */
const PAIRED = [
  'div', 'span', 'p', 'button', 'select', 'option', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
  'section', 'label', 'textarea', 'form', 'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'pre', 'code',
];

/**
 * 抽出源码里所有模板字面量的**正文**（不含引号本身）。
 * 需要正确跳过：注释、'…'/"…"、正则字面量、模板里的 ${…}（里面还能再套模板/字符串）。
 */
function extractTemplates(src) {
  const out = [];
  const frames = [];
  let state = 'code';
  let i = 0;
  const n = src.length;
  const prevSig = (k) => {
    for (let j = k - 1; j >= 0; j--) { const ch = src[j]; if (!/\s/.test(ch)) return ch; }
    return '';
  };
  const regexAllowedAfter = (k) => {
    const p = prevSig(k);
    if (p === '') return true;
    if ('(,=:[!&|?{};+-*%~^<>'.includes(p)) return true;
    const word = (src.slice(Math.max(0, k - 12), k).match(/([A-Za-z_$][\w$]*)\s*$/) || [])[1] || '';
    return ['return', 'typeof', 'in', 'of', 'new', 'delete', 'void', 'case', 'do', 'else'].includes(word);
  };
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (state === 'code') {
      if (c === '/' && c2 === '/') { const e = src.indexOf('\n', i); if (e < 0) break; i = e + 1; continue; }
      if (c === '/' && c2 === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
      if (c === "'" || c === '"') { state = c === "'" ? 'sq' : 'dq'; i++; continue; }
      if (c === '`') { frames.push({ kind: 'tpl', start: i + 1 }); state = 'tpl'; i++; continue; }
      if (c === '{') { const f = frames[frames.length - 1]; if (f && f.kind === 'brace') f.depth += 1; i++; continue; }
      if (c === '}') {
        const f = frames[frames.length - 1];
        if (f && f.kind === 'brace') {
          if (f.depth === 0) { frames.pop(); state = 'tpl'; i++; continue; }
          f.depth -= 1;
        }
        i++; continue;
      }
      if (c === '/' && regexAllowedAfter(i)) {
        let j = i + 1;
        let inClass = false;
        let ok = false;
        while (j < n) {
          const d = src[j];
          if (d === '\\') { j += 2; continue; }
          if (d === '\n') break;
          if (d === '[') inClass = true;
          else if (d === ']') inClass = false;
          else if (d === '/' && !inClass) { ok = true; break; }
          j++;
        }
        i = ok ? j + 1 : i + 1;
        continue;
      }
      i++; continue;
    }
    if (state === 'lineComment') { if (c === '\n') state = 'code'; i++; continue; }
    if (state === 'blockComment') { if (c === '*' && c2 === '/') { state = 'code'; i += 2; continue; } i++; continue; }
    if (state === 'sq' || state === 'dq') {
      if (c === '\\') { i += 2; continue; }
      if (c === (state === 'sq' ? "'" : '"')) state = 'code';
      i++; continue;
    }
    // state === 'tpl'
    if (c === '\\') { i += 2; continue; }
    if (c === '$' && c2 === '{') { frames.push({ kind: 'brace', depth: 0 }); state = 'code'; i += 2; continue; }
    if (c === '`') {
      const f = frames.pop();
      out.push({ text: src.slice(f.start, i), start: f.start });
      state = 'code';
      i++; continue;
    }
    i++;
  }
  out.endState = state;
  out.endIndex = i;
  out.endFrames = frames.length;
  return out;
}

/** 只去除 ${…} 插值（插值里可能是任意代码/字符串，不能当 HTML 计） */
function stripInterp(t) {
  let out = '';
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '\\') { if (depth === 0) out += t.slice(i, i + 2); i++; continue; }
    if (c === '$' && t[i + 1] === '{' && depth === 0) { depth = 1; i++; continue; }
    if (depth > 0) { if (c === '{') depth++; else if (c === '}') depth--; continue; }
    out += c;
  }
  return out;
}

/** 把一个模板正文里的 div 开闭走一遍，返回每步的深度（用于嵌套断言，而不是只看总量） */
function depthTrace(html) {
  const re = /<\/?div\b[^>]*>/gi;
  const trace = [];
  let depth = 0;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    if (/^<\/div/i.test(tag)) { depth -= 1; trace.push({ open: false, tag, depth }); }
    else { trace.push({ open: true, tag, depth: depth + 1 }); depth += 1; }
  }
  return trace;
}

const src = fs.readFileSync(file, 'utf8');
const lineOf = (idx) => src.slice(0, idx).split('\n').length;
const tpls = extractTemplates(src);

const bad = [];
let sheZhiSectionTotal = 0;
for (const t of tpls) {
  const html = stripInterp(t.text);
  if (!html.includes('<')) continue;
  for (const tag of PAIRED) {
    const opens = (html.match(new RegExp('<' + tag + '(?=[\\s/>])', 'gi')) || []).length;
    const closes = (html.match(new RegExp('</' + tag + '\\s*>', 'gi')) || []).length;
    if (opens !== closes) {
      bad.push(`${path.relative(pkgRoot, file)}:${lineOf(t.start)} 模板里 <${tag}> 开 ${opens} / 闭 ${closes}（差 ${opens - closes}）`);
    }
  }
  /**
   * 嵌套断言：`<div>` 多一个/少一个时**总量可能还是平衡的**（本轮事故就是一处多、一处少），
   * 所以必须看嵌套：深度跌到 0 以下 = 多写了 `</div>`；
   * 设置页的每张分区卡必须是内容列 `#peiZhiNeiRong` 的直接子节点（深度 = 内容列深度 + 1）——
   * 少了内容列的 `</div>`、或少了卡片的 `</div>`，都会让分区跑到导航列 / 钻进别的卡片里。
   */
  const trace = depthTrace(html);
  if (trace.some((x) => x.depth < 0)) {
    const first = trace.find((x) => x.depth < 0);
    bad.push(`${path.relative(pkgRoot, file)}:${lineOf(t.start)} 模板里 </div> 多于 <div>（深度跌到 ${first.depth}）`);
  }
  const nrIdx = trace.findIndex((x) => x.open && /id="peiZhiNeiRong"/.test(x.tag));
  if (nrIdx < 0) continue;
  const base = trace[nrIdx].depth;
  const secs = trace.filter((x, i) => i > nrIdx && x.open && /class="sheZhiSection/.test(x.tag));
  sheZhiSectionTotal += secs.length;
  for (const s of secs) {
    if (s.depth !== base + 1) {
      bad.push(`${path.relative(pkgRoot, file)}:${lineOf(t.start)} 设置分区「${(s.tag.match(/id="([^"]+)"/) || [, ''])[1] || s.tag.slice(0, 40)}」不在内容列 #peiZhiNeiRong 里（深度 ${s.depth}，应为 ${base + 1}）`);
    }
  }
}

console.log(`[renderer-tag-balance] 模板字面量 ${tpls.length} 个，检查 ${path.relative(pkgRoot, file)}`);
if (process.argv.includes('--list')) {
  for (const t of tpls) console.log('   line ' + lineOf(t.start) + '-' + lineOf(t.start + t.text.length) + '  len ' + t.text.length + '  ' + t.text.replace(/\s+/g, ' ').slice(0, 60));
  console.log('   源码总行数 ' + src.split('\n').length);
  console.log('   扫描结束状态 ' + tpls.endState + '  位置 line ' + lineOf(tpls.endIndex) + '  未闭合帧 ' + tpls.endFrames);
}
if (sheZhiSectionTotal < 20) {
  bad.push(`设置页分区只数出 ${sheZhiSectionTotal} 个（应 ≥ 20）：模板可能整块没被扫到`);
}
if (bad.length) {
  console.log('FAIL 标签不平衡（多一个/少一个 </div> 会把整块界面挤进错误的列或卡片里）：');
  for (const b of bad.slice(0, 20)) console.log('  ' + b);
  process.exit(1);
}
console.log('PASS 所有模板标签成对');
