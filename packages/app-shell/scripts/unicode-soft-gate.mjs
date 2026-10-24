#!/usr/bin/env node
/**
 * unicode-soft-gate.mjs —— 中文/全角/同形字混入**可执行代码**的软门禁（第 66 轮 项 12）。
 *
 * 背景：仓库路径含中文时，Windows 上曾出现编码失败（GBK/UTF-8 混写、编译产物乱码）。
 * 但**不能一刀切禁中文**：界面文案、注释、提示词、i18n 字符串本来就该是中文。
 * 所以规则是：
 *   · 允许：注释、普通字符串/模板字符串、正则字面量、i18n JSON；
 *   · 报错（strict 下失败）：标识符里的 CJK、import/require 路径里的 CJK、实际文件/目录名里的 CJK；
 *   · 提醒（不失败）：NFKC 会改变标识符（全角字母）、拉丁 + 西里尔/希腊混排（同形字）。
 *
 * 用法：
 *   node packages/app-shell/scripts/unicode-soft-gate.mjs            # 扫仓库，仅提醒（软门禁）
 *   node packages/app-shell/scripts/unicode-soft-gate.mjs --strict   # 有 error 时退出 1
 *   node packages/app-shell/scripts/unicode-soft-gate.mjs --strict a.ts b.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CJK = [
  [0x2e80, 0x2eff], [0x3000, 0x303f], [0x3040, 0x30ff], [0x31c0, 0x31ef],
  [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xac00, 0xd7af], [0xf900, 0xfaff],
  [0xff00, 0xffef],
];
export function shiCjk(cp) {
  return CJK.some(([a, b]) => cp >= a && cp <= b);
}
export function hanZi(cp) {
  return (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0xf900 && cp <= 0xfaff);
}
function Biao(ming, re) { return { ming, re }; }
/** 常见同形字：拉丁标识符里混入西里尔/希腊字母 */
const HUN_XIAO = [
  Biao('西里尔 а', /а/), Biao('西里尔 е', /е/), Biao('西里尔 о', /о/), Biao('西里尔 р', /р/),
  Biao('西里尔 с', /с/), Biao('西里尔 х', /х/), Biao('西里尔 у', /у/), Biao('西里尔 і', /і/),
  Biao('希腊 ο', /ο/), Biao('希腊 α', /α/), Biao('希腊 ε', /ε/), Biao('希腊 ι', /ι/),
  Biao('希腊 κ', /κ/), Biao('希腊 ν', /ν/), Biao('希腊 ρ', /ρ/), Biao('希腊 τ', /τ/),
];

/**
 * 把注释、字符串、模板字符串、正则字面量替换成空格（保留换行与列位置），
 * 剩下的就是"可执行代码骨架"。这是软门禁不误报的关键。
 */
export function quZhuShiHeZiFuChuan(src) {
  const s = String(src || '');
  const out = s.split('');
  const kong = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' '; };

  function skipQuoted(i) {
    const q = s[i];
    let j = i + 1;
    while (j < s.length) {
      if (s[j] === '\\') { j += 2; continue; }
      if (s[j] === q) { j += 1; break; }
      if (s[j] === '\n') break; // 未闭合的普通字符串：到行尾为止，避免整文件失步
      j += 1;
    }
    kong(i, j);
    return j;
  }

  /** 正则字面量：只在表达式起始位置认；认不出闭合就按除号处理 */
  function skipRegex(i) {
    let j = i + 1;
    let inClass = false;
    while (j < s.length) {
      const c = s[j];
      if (c === '\\') { j += 2; continue; }
      if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) {
        j += 1;
        while (/[a-z]/i.test(s[j] || '')) j += 1;
        kong(i, j);
        return j;
      } else if (c === '\n') break;
      j += 1;
    }
    return i + 1;
  }

  function keYiRegex(i) {
    const qian = s.slice(Math.max(0, i - 60), i).trimEnd();
    return qian === '' || /[=(:,!&|?{}[\];+\-*%<>~^]$/.test(qian) || /\b(return|case|typeof|instanceof|in|of)$/.test(qian);
  }

  /** 模板：只抹掉**字面量段**，${...} 里的表达式继续按代码扫描（中文标识符仍要抓） */
  function skipTemplate(i) {
    let j = i + 1;
    let seg = i; // 包含起始反引号
    while (j < s.length) {
      const c = s[j];
      if (c === '\\') { j += 2; continue; }
      if (c === '`') { j += 1; kong(seg, j); return j; }
      if (c === '$' && s[j + 1] === '{') {
        kong(seg, j + 2);
        const end = scanCode(j + 2, true); // 停在匹配的 }
        kong(end, end + 1);
        j = end + 1;
        seg = j;
        continue;
      }
      j += 1;
    }
    kong(seg, j);
    return j;
  }

  function scanCode(start, inTemplateExpr) {
    let j = start;
    /** ${ {a:1} }：对象字面量的大括号必须先配对，不能把第一个 } 当成插值结束 */
    let depth = 0;
    while (j < s.length) {
      const c = s[j];
      const n = s[j + 1];
      if (c === '/' && n === '/') {
        const k = s.indexOf('\n', j);
        const end = k < 0 ? s.length : k;
        kong(j, end); j = end; continue;
      }
      if (c === '/' && n === '*') {
        const k = s.indexOf('*/', j + 2);
        const end = k < 0 ? s.length : k + 2;
        kong(j, end); j = end; continue;
      }
      if (c === '"' || c === "'") { j = skipQuoted(j); continue; }
      if (c === '`') { j = skipTemplate(j); continue; }
      if (c === '/' && keYiRegex(j)) { j = skipRegex(j); continue; }
      if (inTemplateExpr) {
        if (c === '{') { depth += 1; j += 1; continue; }
        if (c === '}') {
          if (depth === 0) return j;
          depth -= 1;
          j += 1;
          continue;
        }
      }
      j += 1;
    }
    return j;
  }

  scanCode(0, false);
  return out.join('');
}

function weiZhi(s, idx) {
  const qian = s.slice(0, idx);
  const line = (qian.match(/\n/g) || []).length + 1;
  const col = idx - qian.lastIndexOf('\n');
  return { line, col };
}

/** 扫一段源码：返回 errors（真问题）与 warnings（软提醒） */
export function saoYuanMa(src, file = '<fixture>') {
  const errors = [];
  const warnings = [];
  const ma = quZhuShiHeZiFuChuan(src);
  // 1) 标识符里的 CJK（Unicode 标识符字符）
  const idRe = /[$_\p{ID_Start}][$_\u200c\u200d\p{ID_Continue}]*/gu;
  let m;
  while ((m = idRe.exec(ma))) {
    const tok = m[0];
    if (![...tok].some((ch) => shiCjk(ch.codePointAt(0)))) continue;
    const p = weiZhi(ma, m.index);
    errors.push({ file, line: p.line, col: p.col, code: 'cjk-identifier', message: `标识符含中文/全角字符：${tok}` });
  }
  // 2) import / require 路径里的 CJK（即使它在字符串里也必须报）
  const pathRe = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;
  while ((m = pathRe.exec(src))) {
    const spec = m[1];
    if (![...spec].some((ch) => shiCjk(ch.codePointAt(0)))) continue;
    const p = weiZhi(src, m.index);
    errors.push({ file, line: p.line, col: p.col, code: 'cjk-import-path', message: `模块路径含中文：${spec}` });
  }
  // 3) NFKC：全角/兼容字符会改变标识符（如 ｆｏｏ → foo）
  const idRe2 = /[A-Za-z_$][A-Za-z0-9_$]*|[$_\p{ID_Start}][$_\u200c\u200d\p{ID_Continue}]*/gu;
  while ((m = idRe2.exec(ma))) {
    const tok = m[0];
    if (!/[^\x00-\x7f]/.test(tok)) continue;
    const nf = tok.normalize('NFKC');
    if (nf !== tok) {
      const p = weiZhi(ma, m.index);
      warnings.push({ file, line: p.line, col: p.col, code: 'nfkc-identifier', message: `标识符 NFKC 后会变：${tok} → ${nf}（请改用 ASCII）` });
    }
  }
  // 4) 同形字：拉丁 + 西里尔/希腊混排
  while ((m = idRe2.exec(ma))) {
    const tok = m[0];
    if (!/[A-Za-z]/.test(tok)) continue;
    const ming = HUN_XIAO.find((x) => x.re.test(tok));
    if (ming) {
      const p = weiZhi(ma, m.index);
      warnings.push({ file, line: p.line, col: p.col, code: 'confusable-identifier', message: `标识符含同形字（${ming.ming}）：${tok}` });
    }
  }
  return { errors, warnings };
}

/** 扫描路径段里的 CJK（相对 root；node_modules/.git/dist 不扫） */
export function saoLuJing(root) {
  const errors = [];
  const skip = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage']);
  const walk = (dir) => {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (skip.has(e.name)) continue;
      const p = path.join(dir, e.name);
      const rel = path.relative(root, p).replace(/\\/g, '/');
      if ([...rel].some((ch) => shiCjk(ch.codePointAt(0)))) {
        errors.push({ file: rel, line: 1, col: 1, code: 'cjk-path', message: '文件/目录名含中文：' + rel });
      }
      if (e.isDirectory()) walk(p);
    }
  };
  walk(root);
  return errors;
}

export function saoWenJian(files) {
  const errors = [];
  const warnings = [];
  for (const f of files) {
    let src = '';
    try { src = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const r = saoYuanMa(src, f);
    errors.push(...r.errors);
    warnings.push(...r.warnings);
  }
  return { errors, warnings };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const strict = argv.includes('--strict');
  const files = argv.filter((a) => !a.startsWith('--'));
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const list = files.length ? files : (() => {
    const out = [];
    /** dev/gates 里有**故意的反例 fixture**（中文标识符/中文导入路径），默认扫描不含它 */
    const dirs = [path.join(repo, 'packages', 'app-shell', 'src'), path.join(repo, 'packages', 'providers', 'src')];
    for (const d of dirs) {
      const walk = (x) => {
        let ents = [];
        try { ents = fs.readdirSync(x, { withFileTypes: true }); } catch { return; }
        for (const e of ents) {
          if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'i18n') continue;
          const p = path.join(x, e.name);
          if (e.isDirectory()) walk(p);
          else if (/\.(?:mjs|cjs|js|ts|tsx)$/.test(e.name)) out.push(p);
        }
      };
      walk(d);
    }
    return out;
  })();
  const r = saoWenJian(list);
  const pathErr = files.length ? [] : saoLuJing(path.join(repo, 'packages'));
  const allErr = [...r.errors, ...pathErr];
  for (const w of r.warnings.slice(0, 40)) console.log(`  warn ${w.file}:${w.line}:${w.col} [${w.code}] ${w.message}`);
  for (const e of allErr.slice(0, 60)) console.log(`  FAIL ${e.file}:${e.line}:${e.col} [${e.code}] ${e.message}`);
  console.log(`\nUnicode 软门禁：errors=${allErr.length} warnings=${r.warnings.length} files=${list.length}（${strict ? 'strict' : 'soft'}）`);
  process.exit(strict && allErr.length ? 1 : 0);
}
