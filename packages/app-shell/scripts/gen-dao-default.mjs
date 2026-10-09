#!/usr/bin/env node
/**
 * gen-dao-default — 由 docs/dao.md 生成 packages/app-shell/src/dao-default.ts
 *
 * 为什么要有这个脚本：首启播种用的出厂「道」（DAO_MOREN）必须与仓库里的 docs/dao.md 逐字一致，
 * 否则「人看到的文件」和「新用户拿到的文件」是两份东西。手抄必错，所以同源生成。
 *
 * 用法：node packages/app-shell/scripts/gen-dao-default.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, '..');
const root = path.resolve(pkgRoot, '..', '..');

const daoPath = path.join(root, 'docs', 'dao.md');
const outPath = path.join(pkgRoot, 'src', 'dao-default.ts');

const md = fs.readFileSync(daoPath, 'utf8');
if (md.length < 5000) {
  console.error(`[gen-dao-default] docs/dao.md 只有 ${md.length} 字，太小了，拒绝生成（防止把内容截断后写出去）`);
  process.exit(1);
}
const out = '// 由 docs/dao.md 自动生成，勿手改\n'
  + '// 重新生成：node packages/app-shell/scripts/gen-dao-default.mjs\n'
  + 'export const DAO_MOREN = ' + JSON.stringify(md) + ';\n';
fs.writeFileSync(outPath, out, 'utf8');

// 自检：读回来必须与 dao.md 逐字一致（生成器自己也得证明自己）
const back = fs.readFileSync(outPath, 'utf8');
const m = back.match(/export const DAO_MOREN = ("(?:[^"\\]|\\.)*");/);
const v = m ? JSON.parse(m[1]) : null;
if (v !== md) {
  console.error('[gen-dao-default] 自检失败：写回的内容与 dao.md 不一致');
  process.exit(1);
}
console.log(`[gen-dao-default] ok — docs/dao.md ${md.length} 字 → dao-default.ts ${back.length} 字节（逐字一致）`);
