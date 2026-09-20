/**
 * 把自定义标识符改成**汉语拼音全拼**（产品规范：docs/TECHNICAL.md §3.6）。
 *
 * 为什么这样写（每条都是本轮踩出来的）：
 *  1. **映射表驱动**（docs/PINYIN-MAP.json）：英文→拼音可评审、可回滚；
 *     不做机器音译 —— 音译需要语义，猜错等于把代码改成看不懂的样子。
 *  2. **两级作用域**：global=导出/契约名（全仓库一起改，否则跨包引用断裂）；
 *     local=包内局部名（只在 --pkg 指定包内改，同名跨包可能含义不同）。
 *  3. **扫描分段而不是占位符**：早期用 `\0N\0` 占位符保护字符串，两次运行会
 *     在文件里留 NUL 字节（git 视为二进制）。现在按字符扫描切 code/keep 段。
 *  4. **模板串插值按代码处理**：`` `text ${expr} text` `` 里 `${}` 内是代码，
 *     整段当字符串会导致 `${ev}` 里的 ev 漏改（实测报 Cannot find name 'ev'）。
 *  5. **有 `.字段` 用法就整名跳过**：类字段/对象属性通过点号访问，
 *     只改声明会让 `this.tasks` 与 `renwuLiebiao` 对不上（实测 TS2339）。
 *     所以 local 映射先扫一遍：任何名字只要出现过 `.name`，就整体不改。
 *
 * 用法：
 *   node scripts/pinyin-rename.mjs --pkg board --pkg contracts --dry
 *   node scripts/pinyin-rename.mjs --pkg board --pkg contracts            # 应用
 *   node scripts/pinyin-rename.mjs --pkg board --pkg contracts --invert   # 回滚
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(selfDir, '..');
const MAP_FILE = path.join(ROOT, 'docs', 'PINYIN-MAP.json');

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const invert = args.includes('--invert');
const localOnly = args.includes('--local-only');
const globalOnly = args.includes('--global-only');
const pkgs = [];
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--pkg' && args[i + 1]) pkgs.push(args[++i]);
  if (args[i] === '--file' && args[i + 1]) files.push(args[++i]);
}

const doc = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
const flip = (m) => Object.fromEntries(Object.entries(m || {}).map(([k, v]) => [v, k]));
const GLOBAL = invert ? flip(doc.global) : doc.global || {};
const LOCAL = invert ? flip(doc.local) : doc.local || {};

/**
 * 切成 code / keep 段。keep = 注释 + 字符串；模板串只保留字面量部分，
 * `${...}` 内部**继续当代码**（递归处理，支持嵌套模板）。
 */
function segment(src, base = 0) {
  const segs = [];
  let buf = '';
  let i = 0;
  const flush = () => { if (buf) { segs.push({ code: true, text: buf }); buf = ''; } };
  while (i < src.length) {
    const ch = src[i];
    const nx = src[i + 1];
    if (ch === '/' && nx === '/') {
      let j = src.indexOf('\n', i);
      if (j < 0) j = src.length;
      flush(); segs.push({ code: false, text: src.slice(i, j) }); i = j; continue;
    }
    if (ch === '/' && nx === '*') {
      const end = src.indexOf('*/', i + 2);
      const j = end < 0 ? src.length : end + 2;
      flush(); segs.push({ code: false, text: src.slice(i, j) }); i = j; continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === ch) { j += 1; break; }
        j += 1;
      }
      flush(); segs.push({ code: false, text: src.slice(i, Math.min(j, src.length)) }); i = Math.min(j, src.length); continue;
    }
    if (ch === '`') {
      flush();
      // 模板串：字面量段原样保留；${ } 内部递归按代码处理
      let j = i + 1;
      let lit = '`';
      while (j < src.length) {
        if (src[j] === '\\') { lit += src.slice(j, j + 2); j += 2; continue; }
        if (src[j] === '`') { lit += '`'; j += 1; break; }
        if (src[j] === '$' && src[j + 1] === '{') {
          /**
           * 模板插值：字面量 + `${` 原样保留，**内部才是代码**，`}` 也原样保留。
           * 早期版本漏掉了 `${`/`}` 两个分隔符 —— 拼回去时 `` `a-${x}` `` 变成 `` `a-x` ``，
           * 直接把模板写坏（实测把 `q-${++this.seq}` 改成 `q-++this.seq`）。
           */
          segs.push({ code: false, text: lit + '${' });
          lit = '';
          // 找到配对的 }（支持嵌套大括号/字符串）
          let depth = 1;
          let k = j + 2;
          while (k < src.length && depth > 0) {
            const c = src[k];
            if (c === '{') depth += 1;
            else if (c === '}') { depth -= 1; if (depth === 0) break; }
            if (c === '"' || c === "'" || c === '`') {
              let m = k + 1;
              while (m < src.length) {
                if (src[m] === '\\') { m += 2; continue; }
                if (src[m] === c) { m += 1; break; }
                m += 1;
              }
              k = m;
              continue;
            }
            k += 1;
          }
          segs.push({ code: true, text: src.slice(j + 2, k) });
          segs.push({ code: false, text: '}' });
          j = k + 1;
          lit = '';
          continue;
        }
        lit += src[j];
        j += 1;
      }
      if (lit) segs.push({ code: false, text: lit });
      i = j;
      continue;
    }
    buf += ch;
    i += 1;
  }
  flush();
  return segs;
}

/**
 * 哪些名字"被点号访问过"（形如 `.name`）→ local 映射必须整体跳过。
 * 只看 keep 段之外的代码段（字符串里的 `.map` 不算）。
 */
function dotUsedNames(src) {
  const used = new Set();
  for (const seg of segment(src)) {
    if (!seg.code) continue;
    const rx = /\.([A-Za-z_$][A-Za-z0-9_$]*)/g;
    let m;
    while ((m = rx.exec(seg.text))) used.add(m[1]);
  }
  return used;
}

function applyMap(src, map, { skipNames } = {}) {
  let changed = 0;
  const segs = segment(src);
  for (const seg of segs) {
    if (!seg.code) continue;
    let text = seg.text;
    for (const [from, to] of Object.entries(map)) {
      if (skipNames && skipNames.has(from)) continue;
      const rx = new RegExp(`(?<![A-Za-z0-9_$.])${from.replace(/\$/g, '\\$')}(?![A-Za-z0-9_$])`, 'g');
      text = text.replace(rx, () => { changed += 1; return to; });
    }
    seg.text = text;
  }
  return { text: segs.map((s) => s.text).join(''), changed };
}

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      walk(p, acc);
    } else if (/\.(ts|tsx|js|mjs|cjs)$/.test(e.name)) acc.push(p);
  }
  return acc;
}
const allRepoFiles = () => walk(path.join(ROOT, 'packages'));
const targetFiles = () => {
  const out = files.map((f) => path.resolve(ROOT, f));
  for (const p of pkgs) out.push(...walk(path.join(ROOT, 'packages', p, 'src')));
  return out;
};

function run(label, list, map, opts = {}) {
  let total = 0;
  const touched = [];
  const skipped = new Set();
  for (const f of list) {
    const src = fs.readFileSync(f, 'utf8');
    const { text, changed } = applyMap(src, map, opts);
    if (!changed) continue;
    if (text.includes('\u0000')) throw new Error(`NUL leak in ${f} — 拒绝写入`);
    total += changed;
    touched.push([path.relative(ROOT, f), changed]);
    if (!dry) fs.writeFileSync(f, text, 'utf8');
  }
  console.log(`\n[${invert ? 'invert ' : ''}${label}] files=${list.length} replacements=${total}${dry ? ' (dry-run)' : ''}`);
  for (const [f, n] of touched) console.log(`  ${String(n).padStart(4)}  ${f}`);
  return total;
}

/** local 映射要按**每个文件**自己的点号用法过滤（同名在不同文件情况不同）。 */
function runLocal(targets) {
  let total = 0;
  const touched = [];
  for (const f of targets) {
    const src = fs.readFileSync(f, 'utf8');
    const skip = dotUsedNames(src);
    const { text, changed } = applyMap(src, LOCAL, { skipNames: skip });
    if (!changed) continue;
    if (text.includes('\u0000')) throw new Error(`NUL leak in ${f} — 拒绝写入`);
    total += changed;
    touched.push([path.relative(ROOT, f), changed]);
    if (!dry) fs.writeFileSync(f, text, 'utf8');
  }
  console.log(`\n[${invert ? 'invert ' : ''}local] files=${targets.length} replacements=${total}${dry ? ' (dry-run)' : ''}`);
  for (const [f, n] of touched) console.log(`  ${String(n).padStart(4)}  ${f}`);
  return total;
}

let sum = 0;
if (!localOnly) sum += run('global', allRepoFiles(), GLOBAL);
if (!globalOnly) sum += runLocal(targetFiles());
console.log(`\ntotal replacements: ${sum}`);
if (!dry && sum && !invert) console.log('下一步：tsc -b 编译 + 跑 verify 全家桶（TECHNICAL §9）。');
