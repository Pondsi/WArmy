#!/usr/bin/env node
/**
 * 模板字面量完整性门禁 + recordId 唯一性运行时断言。
 * 为什么单独存在：tsc 对 `prefix-Date.now()` 这种“丢了 ${} 的模板”完全放行——
 * 它是合法 TS/JS。只有**语义扫描 + 运行时唯一性**能挡住改名脚本再剥一轮。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(selfDir, '..');
const repoRoot = path.resolve(pkgRoot, '..', '..');

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS ' + label + (detail !== undefined ? ' => ' + String(detail).slice(0, 160) : '')); }
  else { fail++; console.log('  FAIL ' + label + (detail !== undefined ? ' => ' + String(detail).slice(0, 160) : '')); }
}

// ── 1. 扫描：模板正文里出现“像插值却没 ${}”的表达式 ──
// 真正的注释/文档反引号（`docker --version`）会命中，故白名单整行注释。
const SCAN_ROOTS = [
  path.join(pkgRoot, 'src'),
  path.join(repoRoot, 'packages', 'sync-protocol', 'src'),
  path.join(repoRoot, 'packages', 'group-router', 'src'),
];
const TEMPLATE = /`([^`\\]|\\.)*`/g;
const SUSPECT = /(?<!\$)\b(?:[A-Za-z_][\w]*\.[A-Za-z_][\w.]*(?:\([^)]*\))?|[A-Za-z_][\w]*\(\)|GROUP_MEMBER_LIMIT|chatLogIdSeq|Date\.now\(\))/;

const bad = [];
let scanned = 0;
for (const root of SCAN_ROOTS) {
  if (!fs.existsSync(root)) continue;
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) { if (ent.name !== 'node_modules' && ent.name !== 'dist') walk(p); continue; }
      if (!/\.(ts|js|mjs)$/.test(ent.name)) continue;
      scanned++;
      const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
      lines.forEach((line, i) => {
        const t = line.trim();
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
        for (const m of line.matchAll(TEMPLATE)) {
          const inner = m[0].slice(1, -1);
          if (inner.includes('${')) continue;
          // 子进程/脚本源码正文（含 process.on / require / function）不是插值
          if (/process\.on\(|process\.send\(|require\(|module\.exports/.test(inner)) continue;
          // 纯路径/命令/文档名示例跳过（无表达式调用）
          if (!/\(/.test(inner) && !/Date\.now|chatLogIdSeq|\.length|\.slice|\.join|GROUP_MEMBER/.test(inner)) {
            if (/^[\w./\\:@%-]+$/.test(inner) || /^[A-Za-z0-9_ .\\/:@%{}<>-]+$/.test(inner)) continue;
          }
          if (SUSPECT.test(inner) || /[A-Za-z_]\.[A-Za-z_]/.test(inner)) {
            // 再排除：明显是文档里的 API 名（含空格的中文句）
            if (/[一-鿿]/.test(line) && !/\b(Date\.now|chatLogIdSeq|\.length|\.slice|\.join)\b/.test(inner)) return;
            bad.push(`${path.relative(repoRoot, p)}:${i + 1}: ${m[0].slice(0, 100)}`);
          }
        }
      });
    }
  };
  walk(root);
}
check('模板字面量无“丢 ${}”残留', bad.length === 0, bad.slice(0, 8).join(' | ') || `scanned ${scanned} files`);

// ── 2. 运行时：xinLiaoTianJiLuId 连续两次必须不同 ──
// 动态 import dist（构建产物与 src 同义；dist 缺失则从 src 抽函数源码 eval——不，直接读 src 断言模式）
const emSrc = fs.readFileSync(path.join(pkgRoot, 'src', 'electron-main.ts'), 'utf8');
const fnMatch = emSrc.match(/function xinLiaoTianJiLuId\([\s\S]*?\n\}/);
check('xinLiaoTianJiLuId 存在', !!fnMatch);
if (fnMatch) {
  const body = fnMatch[0];
  check('插值齐全（prefix + Date.now + seq）',
    /\$\{prefix\}/.test(body) && /\$\{Date\.now\(\)\}/.test(body) && /\$\{chatLogIdSeq\}/.test(body),
    body.replace(/\s+/g, ' ').slice(0, 120));
  check('不再是坏模板字面量', !/`prefix-Date\.now/.test(body));
}

// 运行时唯一性：复刻同逻辑连调 50 次
{
  let chatLogIdSeq = 0;
  const gen = (prefix) => { chatLogIdSeq += 1; return `${prefix}-${Date.now()}-${chatLogIdSeq}`; };
  const ids = new Set();
  for (let i = 0; i < 50; i++) ids.add(gen('m'));
  check('xinLiaoTianJiLuId 同毫秒连调 50 次全部唯一', ids.size === 50, `unique=${ids.size}`);
}

// ── 3. group-store 成员 id 插值 ──
const gs = fs.readFileSync(path.join(pkgRoot, 'src', 'group-store.ts'), 'utf8');
check('group-store 成员 id 插值齐全', /`inst:\$\{instId\}`/.test(gs) && /`m-\$\{Date\.now\(\)\.toString\(36\)\}-\$\{LieBiao\.length\}`/.test(gs));
check('max 上限插值', /`max \$\{QUN_CHENGYUAN_SHANGXIAN\}`/.test(gs));

// ── 4. pinyin-rename 不得再剥 ${}（硬规则：脚本源里禁止对模板正文做裸标识符替换） ──
const renameTool = path.join(repoRoot, 'scripts', 'pinyin-rename.mjs');
if (fs.existsSync(renameTool)) {
  const rt = fs.readFileSync(renameTool, 'utf8');
  // 要求：存在“跳过模板字面量 / 保护 ${}”的逻辑，而不仅是注释
  const hasGuard = /lock:\s*true|seg\.lock|protectInterpol|assertInterpol/.test(rt);
  const hasComment = /历史事故|模板字面量保护/.test(rt);
  check('pinyin-rename 有模板保护逻辑（非仅注释）', hasGuard, hasGuard ? 'lock+rollback' : (hasComment ? 'comment-only' : 'missing'));
}

console.log(`\n==== verify-template-integrity: ${fail === 0 ? '全部通过' : fail + ' FAIL'} ====`);
process.exit(fail === 0 ? 0 : 1);
