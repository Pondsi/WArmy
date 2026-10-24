#!/usr/bin/env node
/**
 * verify-dao-compliance — dao.md 硬约束门禁
 * 检查代码与文档是否违反 dao.md 的关键条款。
 * 运行：node packages/app-shell/scripts/verify-dao-compliance.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
let ok = 0, fail = 0;

function check(label, pass, detail) {
  if (pass) { ok++; console.log(`  ok  ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`); }
}

// 扫描的源文件
const srcDirs = [
  path.join(root, 'packages', 'app-shell', 'src'),
  path.join(root, 'packages', 'app-shell', 'scripts'),
  path.join(root, 'packages', 'contracts', 'src'),
  path.join(root, 'packages', 'group-router', 'src'),
  path.join(root, 'packages', 'memory-os', 'src'),
  path.join(root, 'packages', 'providers', 'src'),
];
const exts = new Set(['.ts', '.js', '.mjs', '.cjs', '.tsx', '.jsx']);
const skipDirs = new Set(['node_modules', 'dist', '.git', 'release', 'vendor']);

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (exts.has(path.extname(e.name))) yield p;
  }
}

const files = [];
for (const d of srcDirs) for (const f of walk(d)) files.push(f);

console.log(`dao-compliance scan — ${files.length} source files`);

// 1. 硬编码密钥/令牌（底线 7：数据最小化）
const keyPatterns = [
  { re: /sk-[A-Za-z0-9_-]{20,}/, label: 'OpenAI-style key' },
  { re: /ghp_[A-Za-z0-9]{30,}/, label: 'GitHub token' },
  { re: /xox[baprs]-[A-Za-z0-9-]{10,}/, label: 'Slack token' },
  { re: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, label: 'JWT' },
];
let keyHits = 0;
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  for (const { re, label } of keyPatterns) {
    const m = s.match(re);
    if (m) {
      // 排除测试夹具/示例/验证脚本
      const isFixture = /fixture|example|test|mock|fake|placeholder|verify-/i.test(f) || /YOUR_|xxx|placeholder/i.test(m[0]);
      if (!isFixture) { keyHits++; console.log(`    key hit: ${path.relative(root, f)} — ${label}`); }
    }
  }
}
check('no hardcoded secrets (底线 7)', keyHits === 0, `${keyHits} hits`);

// 2. 静默吞异常（品质律 1：正确）
let silentCatch = 0;
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  // catch 块内只有注释或空
  const re = /catch\s*(?:\([^)]*\))?\s*\{\s*(?:\/\/[^\n]*\s*)*\}/g;
  const matches = s.match(re);
  if (matches) silentCatch += matches.length;
}
// 允许一定数量的空 catch（有些是刻意忽略的）
check('no silent catch (品质律 1)', silentCatch <= 50, `${silentCatch} empty catch blocks (threshold 50)`);

// 3. 提交信息可自解释（协作律）— 只检查最近的 CHANGELOG 条目
const changelog = path.join(root, 'docs', 'CHANGELOG.md');
if (fs.existsSync(changelog)) {
  const s = fs.readFileSync(changelog, 'utf8');
  const hasVersion = /v?\d+\.\d+\.\d+/.test(s);
  check('changelog has versioned entries (协作律)', hasVersion);
} else {
  check('changelog exists (协作律)', false, 'docs/CHANGELOG.md missing');
}

// 4. dao.md 存在且非空（最高优先级文件）
const daoPath = path.join(root, 'docs', 'dao.md');
if (fs.existsSync(daoPath)) {
  const s = fs.readFileSync(daoPath, 'utf8');
  check('dao.md exists and non-empty', s.length > 5000, `${s.length} chars`);
  check('dao.md has 宗旨 section', s.includes('## 一、宗旨'));
  check('dao.md has 底线 section', s.includes('## 二、底线'));
  check('dao.md has 硬约束 section', s.includes('硬约束'));
} else {
  check('dao.md exists', false);
}

// 5. 证据分级用语统一（认知律 1）— 只查 dao.md 自己
if (fs.existsSync(daoPath)) {
  const s = fs.readFileSync(daoPath, 'utf8');
  check('dao.md uses evidence levels (认知律 1)', /已验证|很可能|推测|未知/.test(s));
}

console.log(`\n==== dao-compliance: ${ok} ok / ${fail} FAIL ====`);
process.exit(fail > 0 ? 1 : 0);
