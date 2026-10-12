#!/usr/bin/env node
/**
 * verify-import-integrity —— 门禁：脚本里 `import { … } from '…/dist/xxx.js'` 的名字必须真实存在。
 *
 * 为什么需要它（真实事故）：
 *   项目做过一次「全拼改名」，导出名从英文改成拼音。若干脚本的 import 名没跟着改，
 *   于是运行时报 `SyntaxError: The requested module '…' does not provide an export named 'X'`。
 *   更隐蔽的是**子串式改名事故**：`listCertificates` 被改成了 `LieBiaoCertificates`（不存在）。
 *   这类问题只有"真跑那个脚本"才暴露，而脚本有几十个 —— 所以做成静态门禁，一次扫全仓。
 *
 * 覆盖：`packages/** /scripts/**\/*.mjs` 与 `scripts/**\/*.mjs` 中对 `…/dist/*.js` 的具名导入。
 * 不覆盖：node_modules / dist 自身 / .ts 源文件（源文件由 tsc 把关）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(selfDir, '..', '..', '..');
const SKIP = /(node_modules|[\\/]dist[\\/]|[\\/]release[\\/]|[\\/]\.git[\\/])/;

/** 收集一个 dist 文件导出的所有名字（**跟随 `export * from`**，否则桶文件全被误报） */
const exportCache = new Map();
function exportsOf(file, seen = new Set()) {
  if (exportCache.has(file)) return exportCache.get(file);
  if (seen.has(file)) return new Set();
  seen.add(file);
  let set = null;
  try {
    const t = fs.readFileSync(file, 'utf8');
    set = new Set();
    for (const m of t.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) set.add(m[1]);
    for (const m of t.matchAll(/export\s*\{([^}]+)\}/g)) {
      for (const part of m[1].split(',')) {
        const n = part.trim().split(/\s+as\s+/).pop().trim();
        if (n) set.add(n);
      }
    }
    if (/export\s+default\b/.test(t)) set.add('default');
    // 桶文件：`export * from './x.js'` / `export * as ns from`
    for (const m of t.matchAll(/export\s*\*\s*(?:as\s+[\w$]+\s+)?from\s*['"]([^'"]+)['"]/g)) {
      const sub = path.resolve(path.dirname(file), m[1]);
      const subSet = exportsOf(sub, seen);
      if (subSet) for (const n of subSet) if (n !== 'default') set.add(n);
    }
  } catch {
    set = null;
  }
  exportCache.set(file, set);
  return set;
}

const problems = [];
let checkedFiles = 0;
let checkedNames = 0;
const missingTargets = [];

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (SKIP.test(p)) continue;
    if (e.isDirectory()) { walk(p); continue; }
    if (!p.endsWith('.mjs')) continue;
    if (p.endsWith('verify-import-integrity.mjs')) continue; // 自身 JSDoc 里的示例路径不算
    const rel = path.relative(root, p).split(path.sep).join('/');
    // 只看脚本目录
    if (!/\/scripts\//.test(rel) && !rel.startsWith('scripts/')) continue;
    checkedFiles += 1;
    const src = fs.readFileSync(p, 'utf8');

    // 逐条匹配 `import { a, b as c } from '<spec>'`
    for (const m of src.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"]/g)) {
      const spec = m[2];
      if (!/dist\/[\w.-]+\.js$/.test(spec)) continue; // 只看 dist 产物
      const target = path.resolve(path.dirname(p), spec);
      const set = exportsOf(target);
      if (set === null) {
        missingTargets.push(`${rel}: 目标模块不存在 → ${spec}`);
        continue;
      }
      const names = m[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => (s.startsWith('type ') ? s.slice(5).trim() : s));
      for (const raw of names) {
        const name = raw.split(/\s+as\s+/)[0].trim();
        if (!name) continue;
        checkedNames += 1;
        if (!set.has(name)) {
          // 给个线索：同尾词候选
          const tail = name.replace(/^(list|get|create|build|apply|verify|sign|normalize|compute|explain)/, '');
          const cand = [...set].filter((k) => k.length > 4 && k.endsWith(tail));
          problems.push(`${rel}: '${name}' 不在 ${spec} 的导出里${cand.length ? `（疑似应为：${cand.slice(0, 3).join(' / ')}）` : ''}`);
        }
      }
    }
  }
}

walk(root);

console.log(`扫描脚本 ${checkedFiles} 个，检查具名导入 ${checkedNames} 个`);
if (missingTargets.length) {
  console.log('\n目标模块缺失：');
  for (const x of missingTargets) console.log(' - ' + x);
}
if (problems.length) {
  console.log(`\n==== verify-import-integrity: ${problems.length} FAIL ====`);
  for (const x of problems) console.log(' - ' + x);
  process.exit(1);
}
if (missingTargets.length) {
  console.log('\n==== verify-import-integrity: 目标模块缺失（视同失败）====');
  process.exit(1);
}
console.log('\n==== verify-import-integrity: 全部通过 ====');
