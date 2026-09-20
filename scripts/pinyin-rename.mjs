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

/**
 * **两个"成员名"守卫**（每次事故都是这两个之一）：
 *
 *  1. `dotUsed`：名字在全仓库任何地方以 `.name` 出现过 ⇒ 它就是**成员/字段**，
 *     单独改声明或单独改调用都会断（TS2339 / TS2353 实测都踩过）。
 *  2. `keyUsed`：名字以 `name:` 形式出现过（对象字面量键、接口成员、Node/浏览器的
 *     选项键，例如 `fs.readFileSync(p, { flag: 'wx' })`）⇒ 同理不许改。
 *
 * 这两类名字要改必须"声明 + 所有访问点一起改"，属于另一种模式（尚未实现）；
 * 在此之前**一律跳过**，并明确打印出来 —— 绝不静默改名。
 */
function memberNames(fileList) {
  const dot = new Set();
  const key = new Set();
  for (const f of fileList) {
    if (isThirdParty(f)) continue;
    let src;
    try { src = fs.readFileSync(f, 'utf8'); } catch { continue; }
    for (const n of dotUsedNames(src)) dot.add(n);
    for (const seg of segment(src)) {
      if (!seg.code) continue;
      const rx = /(?<![A-Za-z0-9_$.])([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g;
      let m;
      while ((m = rx.exec(seg.text))) key.add(m[1]);
    }
  }
  return { dot, key };
}

const doc = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
const flip = (m) => Object.fromEntries(Object.entries(m || {}).map(([k, v]) => [v, k]));

/**
 * **绝不能改的名字**：JS/TS 保留字与内建全局。
 * 实测事故：local 表里把 TypeScript 的类型关键字 never 也列进了映射，
 * 改完之后直接报 `TS2749: refers to a value, but is being used as a type here` ——
 * 这类词不是我们的标识符，是语言本身的一部分，任何情况下都不许动。
 */
const RESERVED = new Set([
  // 值级关键字
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do',
  'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'import', 'in',
  'instanceof', 'new', 'null', 'return', 'super', 'switch', 'this', 'throw', 'true', 'try',
  'typeof', 'var', 'void', 'while', 'with', 'yield', 'await', 'async', 'static', 'get', 'set',
  // 类型级关键字
  'any', 'boolean', 'constructor', 'declare', 'infer', 'interface', 'is', 'keyof', 'let', 'module',
  'namespace', 'never', 'object', 'of', 'package', 'private', 'protected', 'public', 'readonly',
  'require', 'number', 'string', 'symbol', 'bigint', 'type', 'undefined', 'unique', 'unknown',
  'abstract', 'as', 'asserts', 'assert', 'satisfies', 'override', 'out', 'from', 'global', 'accessor',
  // 内建全局
  'Array', 'ArrayBuffer', 'BigInt', 'Boolean', 'Buffer', 'DataView', 'Date', 'Error', 'EvalError',
  'Function', 'Infinity', 'Intl', 'JSON', 'Map', 'Math', 'NaN', 'Number', 'Object', 'Promise',
  'Proxy', 'RangeError', 'ReferenceError', 'Reflect', 'RegExp', 'Set', 'String', 'Symbol',
  'SyntaxError', 'TypeError', 'URIError', 'URL', 'URLSearchParams', 'Uint8Array', 'WeakMap',
  'WeakSet', 'console', 'document', 'exports', 'globalThis', 'navigator', 'process', 'setInterval',
  'setTimeout', 'clearInterval', 'clearTimeout', 'window',
]);

/** 过滤掉保留字/内建的映射（并**明确报出来**，不静默） */
function safeMap(map) {
  const out = {};
  const dropped = [];
  for (const [from, to] of Object.entries(map || {})) {
    if (RESERVED.has(from) || RESERVED.has(to)) { dropped.push(from); continue; }
    out[from] = to;
  }
  if (dropped.length) {
    console.log(`[guard] 映射表里的保留字/内建已强制跳过（不许改语言关键字）：${dropped.join(' , ')}`);
  }
  return out;
}

const GLOBAL = safeMap(invert ? flip(doc.global) : doc.global || {});
const LOCAL = safeMap(invert ? flip(doc.local) : doc.local || {});

/**
 * 这个 `/` 是不是**正则字面量**的开头？
 *
 * 为什么必须判断：扫描器不认正则，于是 `.replace(/[^\s"'<>|]+/g, …)` 里的 `"` 会被
 * 当成字符串开头 —— 从那以后整个文件的分段全部错位，**该改的标识符全被跳过**
 * （实测 memory-client.ts 里 `ToolCall` / `clampInt` 的用法就漏改了，tsc 报
 * `TS2304 Cannot find name`）。判定用业界通行的启发式：看前一个"有效字符"。
 */
function regexStartsAt(src, i) {
  let k = i - 1;
  while (k >= 0 && /\s/.test(src[k])) k -= 1;
  if (k < 0) return false;
  const prev = src[k];
  if ('([{=,:;!&|?+-*%~^<>'.includes(prev)) return true;
  // 关键字之后（return / typeof / case / in / of / new / delete / void / instanceof / do / else / yield / await）
  const word = (src.slice(0, k + 1).match(/[A-Za-z_$][A-Za-z0-9_$]*$/) || [''])[0];
  return ['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'instanceof', 'do', 'else', 'yield', 'await'].includes(word);
}

/** 从 i 处的 `/` 开始扫一个正则字面量；扫不到收尾的 `/`（或跨行）就返回 -1（当除号处理） */
function scanRegex(src, i) {
  let j = i + 1;
  let inClass = false;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') { j += 2; continue; }
    if (c === '\n') return -1;
    if (inClass) { if (c === ']') inClass = false; j += 1; continue; }
    if (c === '[') { inClass = true; j += 1; continue; }
    if (c === '/') {
      j += 1;
      while (j < src.length && /[a-z]/i.test(src[j])) j += 1;
      return j;
    }
    j += 1;
  }
  return -1;
}

/**
 * 切成 code / keep 段。keep = 注释 + 字符串 + 正则；模板串只保留字面量部分，
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
    if (ch === '/' && regexStartsAt(src, i)) {
      const j = scanRegex(src, i);
      if (j > 0) { flush(); segs.push({ code: false, text: src.slice(i, j) }); i = j; continue; }
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
          // 找到配对的 }（支持嵌套大括号/字符串/正则/注释）
          let depth = 1;
          let k = j + 2;
          while (k < src.length && depth > 0) {
            const c = src[k];
            /**
             * 插值里也可能出现**正则 / 注释**，它们里面的 `}` 不算配对的 `}`
             * （例如 `/a{2}/`、`// 这里 } 结尾`）。早期只跳字符串，于是这里会多算/少算一层，
             * 导致分段错位 —— 表现为"拼回去少了一个 `}`"（括号计数自检会拦下来）。
             */
            if (c === '/' && src[k + 1] === '/') {
              const nl = src.indexOf('\n', k);
              k = nl < 0 ? src.length : nl;
              continue;
            }
            if (c === '/' && src[k + 1] === '*') {
              const close = src.indexOf('*/', k + 2);
              k = close < 0 ? src.length : close + 2;
              continue;
            }
            if (c === '/' && regexStartsAt(src, k)) {
              const rEnd = scanRegex(src, k);
              if (rEnd > 0) { k = rEnd; continue; }
            }
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
          /**
           * 插值内部**递归分段**，而不是整段当代码。
           *
           * 为什么：整段当代码时，插值里的**字符串**也会被当标识符改掉 ——
           * 实测把 `` `${x.toString('hex')}` `` 改成了 `'hex'`，
           * 直接破坏 Node API 调用（`TS2345: '"hex"' is not assignable to BufferEncoding`）。
           * 递归一遍即可让插值里的字符串/注释/正则照旧受保护。
           */
          for (const inner of segment(src.slice(j + 2, k))) segs.push(inner);
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
  let delta = 0;
  const segs = segment(src);
  for (const seg of segs) {
    if (!seg.code) continue;
    let text = seg.text;
    for (const [from, to] of Object.entries(map)) {
      if (skipNames && skipNames.has(from)) continue;
      const rx = new RegExp(`(?<![A-Za-z0-9_$.])${from.replace(/\$/g, '\\$')}(?![A-Za-z0-9_$])`, 'g');
      text = text.replace(rx, () => { changed += 1; delta += to.length - from.length; return to; });
    }
    seg.text = text;
  }
  return { text: segs.map((s) => s.text).join(''), changed, delta };
}

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      /**
       * 第三方与产物**一律不碰**：`vendor/`（随仓库带进来的 jsqr / qrcode-generator）、
       * `node_modules/`、`dist/`。曾经漏掉 `vendor/`，把压缩过的第三方库也改了名 ——
       * 那不是"我们的命名"，改它只会引入无法维护的差异。
       */
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'vendor' || e.name === '.git') continue;
      walk(p, acc);
    } else if (/\.(ts|tsx|js|mjs|cjs)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

/** 路径里任何一段是 vendor/node_modules/dist 都跳过（双保险，防止别处直接传路径） */
const isThirdParty = (p) => /(^|[\\/])(vendor|node_modules|dist|\.git)([\\/]|$)/.test(p);

/**
 * 写回前的**自检**（这是本工具唯一一次历史事故的补救）：
 * 曾经有一次运行把两个文件各多写了一个右括号、还丢掉了文件末尾换行 —— 语法直接坏掉
 * （`TS1128: Declaration or statement expected`）。所以现在写入前必须全部满足：
 *   1. 括号计数与原文**逐类相同**（改名只换标识符，不该动任何括号）；
 *   2. 末尾换行的有无、CRLF/LF 风格与原文一致；
 *   3. 长度变化 = 所有替换的净增量（防止"凭空多写字符"）；
 *   4. 不含 NUL。
 * 任何一条不满足 ⇒ **不写**并抛出，宁可不改也不写坏文件。
 */
function assertSafeWrite(f, before, after, delta) {
  const count = (s, c) => (s.match(new RegExp('\\' + c, 'g')) || []).length;
  const pairs = [['{', '}'], ['(', ')'], ['[', ']']];
  for (const [o, c] of pairs) {
    const b = `${count(before, o)}/${count(before, c)}`;
    const a = `${count(after, o)}/${count(after, c)}`;
    if (b !== a) throw new Error(`${f}: 括号计数被改动（${o}${c} ${b} → ${a}）—— 拒绝写入`);
  }
  const hadNl = before.endsWith('\n');
  if (after.endsWith('\n') !== hadNl) throw new Error(`${f}: 末尾换行状态被改动 —— 拒绝写入`);
  const crlf = (s) => count(s, 'n'); // 占位，下面用真正的 CRLF 计数
  const crlfCount = (s) => (s.match(/\r\n/g) || []).length;
  if (crlfCount(after) !== crlfCount(before)) throw new Error(`${f}: 换行风格(CRLF)被改动 —— 拒绝写入`);
  if (after.length - before.length !== delta) {
    throw new Error(`${f}: 长度增量 ${after.length - before.length} ≠ 替换净增量 ${delta} —— 拒绝写入`);
  }
  if (after.includes('\u0000')) throw new Error(`${f}: NUL 泄漏 —— 拒绝写入`);
  void crlf;
}

/**
 * 逐条替换的**净增量**：不用猜，按实际替换次数算。
 * applyMap 返回的 changed 是替换次数，但每个替换的增量取决于 (to.length - from.length)，
 * 因此这里改成让 applyMap 同时回报增量。
 */
function walkTotals() { /* 占位：保持函数表稳定 */ }
/**
 * global 映射的扫描范围 = **全仓库可执行代码**：packages/ + spikes/ + scripts/。
 * 曾经只扫 packages/，结果 spikes/verify-all 里仍写着旧名（`BoardStore is not a
 * constructor`）—— 导出名一改，所有引用处（含验证/spike 脚本）都必须同步。
 */
const REPO_CODE_ROOTS = ['packages', 'spikes', 'scripts'];
const allRepoFiles = () => {
  const acc = [];
  for (const r of REPO_CODE_ROOTS) walk(path.join(ROOT, r), acc);
  return acc;
};
const targetFiles = () => {
  const out = files.map((f) => path.resolve(ROOT, f));
  /**
   * 包内改名的范围 = **只改 `src/`**。
   *
   * 曾经把该包自己的 `scripts/`（门禁/工具脚本）也纳进来 —— 那是错的：
   *  1. 那些脚本的局部变量**不是产品面**，改了没有任何收益；
   *  2. 它们是**普通 JS**（没有类型检查兜底），一旦改名不一致（声明在解构里、
   *     用法在别处）就直接 `ReferenceError`（实测把 verify-planB / verify-naming 打挂）；
   *  3. 断言里写死的 DOM id / CSS 类名也被波及过（那是命名规范明令不许改的东西）。
   * 结论：工具只改产品源码；门禁脚本要跟着改时，**手工改**（并保留其断言语义）。
   */
  for (const p of pkgs) out.push(...walk(path.join(ROOT, 'packages', p, 'src')));
  return out;
};

function run(label, list, map, opts = {}) {
  let total = 0;
  const touched = [];
  const skipped = new Set();
  /**
   * global 映射同样要过"成员名"守卫：`applyRevocationList` 既是 sync-protocol 的
   * 导出函数、又是 `MembershipStore` 的方法名 —— 只改前者会让 `.applyRevocationList`
   * 的调用处报 `TS2339 Property does not exist`（本机实测）。
   * 回滚（--invert）时不做守卫，否则改回去也会被拦。
   */
  if (!invert && !opts.skipNames) {
    const { dot, key } = memberNames(allRepoFiles());
    const skip = new Set([...dot, ...key]);
    const hit = Object.keys(map).filter((n) => skip.has(n));
    if (hit.length) console.log(`[${label}] 成员名守卫跳过 ${hit.length} 个（声明与访问点必须一起改）：${hit.join(' , ')}`);
    opts = { ...opts, skipNames: skip };
  }
  for (const f of list) {
    if (isThirdParty(f)) { skipped.add(f); continue; }
    const src = fs.readFileSync(f, 'utf8');
    const { text, changed, delta } = applyMap(src, map, opts);
    if (!changed) continue;
    total += changed;
    touched.push([path.relative(ROOT, f), changed]);
    if (!dry) {
      assertSafeWrite(f, src, text, delta);
      fs.writeFileSync(f, text, 'utf8');
    }
  }
  console.log(`\n[${invert ? 'invert ' : ''}${label}] files=${list.length} replacements=${total}${dry ? ' (dry-run)' : ''}${skipped.size ? ` skipped-third-party=${skipped.size}` : ''}`);
  for (const [f, n] of touched) console.log(`  ${String(n).padStart(4)}  ${f}`);
  return total;
}

/**
 * 包内局部改名（local）。
 *
 * ⚠️ 点号守卫必须按**整包并集**判断，不能只看单个文件：
 * 字段名常常"声明在这个文件、用在那个文件"。只看单文件时，声明处（types.ts）因为
 * 别处有 `.toolCalls` 被跳过，而使用处（base.ts 的对象字面量）却被改掉 ——
 * 实测 `TS2561: 'toolCalls' does not exist in type 'ChatMessage'`。
 * 规则改成：**只要这个名字在本包任何一个文件里以 `.name` 出现过，整包不改它。**
 */
function runLocal(targets) {
  let total = 0;
  const touched = [];
  let skipped = 0;
  const pkgFiles = [];
  for (const f of targets) {
    if (isThirdParty(f)) { skipped += 1; continue; }
    pkgFiles.push(f);
  }
  const skip = invert ? new Set() : new Set([...memberNames(allRepoFiles()).dot, ...memberNames(allRepoFiles()).key]);
  const guarded = Object.keys(LOCAL).filter((n) => skip.has(n));
  if (guarded.length) console.log(`[local] 因点号用法整包跳过 ${guarded.length} 个名字：${guarded.join(' , ')}`);
  for (const f of pkgFiles) {
    const src = fs.readFileSync(f, 'utf8');
    const { text, changed, delta } = applyMap(src, LOCAL, { skipNames: skip });
    if (!changed) continue;
    total += changed;
    touched.push([path.relative(ROOT, f), changed]);
    if (!dry) {
      assertSafeWrite(f, src, text, delta);
      fs.writeFileSync(f, text, 'utf8');
    }
  }
  console.log(`\n[${invert ? 'invert ' : ''}local] files=${targets.length} replacements=${total}${dry ? ' (dry-run)' : ''}${skipped ? ` skipped-third-party=${skipped}` : ''}`);
  for (const [f, n] of touched) console.log(`  ${String(n).padStart(4)}  ${f}`);
  return total;
}

/**
 * 重名检查（产品规范的三级兜底：全拼 → 全拼_作用域 → 全拼_作用域_英文名）。
 * 映射表里两个不同的源名落到同一个拼音 = 会撞名，必须按梯子升级命名。
 */
function checkCollisions() {
  const byTarget = new Map();
  for (const [src, dst] of Object.entries({ ...GLOBAL, ...LOCAL })) {
    const arr = byTarget.get(dst) || [];
    arr.push(src);
    byTarget.set(dst, arr);
  }
  const dups = [...byTarget.entries()].filter(([, arr]) => arr.length > 1);
  if (!dups.length) {
    console.log('collision-check: 映射表无重名（当前不需要 全拼_作用域 后缀）');
    return 0;
  }
  console.log('collision-check: 发现重名，需要按梯子升级（全拼_作用域 / 全拼_作用域_英文名）：');
  for (const [dst, arr] of dups) {
    console.log(`  ${dst}  <=  ${arr.join(' , ')}   建议：${arr.map((s) => `${dst}_${s}`).join(' / ')}`);
  }
  return dups.length;
}

if (args.includes('--check-collisions')) {
  const n = checkCollisions();
  process.exit(n ? 1 : 0);
}

let sum = 0;
if (!localOnly) sum += run('global', allRepoFiles(), GLOBAL);
if (!globalOnly) sum += runLocal(targetFiles());
console.log(`\ntotal replacements: ${sum}`);
if (!dry && sum && !invert) console.log('下一步：tsc -b 编译 + 跑 verify 全家桶（TECHNICAL §9）。');
