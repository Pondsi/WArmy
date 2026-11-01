/**
 * 不依赖 electron-builder 的“同步最新构建到 win-unpacked”脚本。
 *
 * 背景：本机 electron-builder 的依赖树缺 chalk，`pnpm dist` 跑不起来；但产品包是
 * `asar:false`，所以把各 workspace 的 dist 覆盖进 release/win-unpacked 就能得到最新包。
 * 关键：**app/node_modules/@warmy 与 resources/warmy 两份副本都要更新**，否则会出现
 * “开发环境正常、打包版启动报缺导出”（第 79 轮 ZHISHI_CENG 事故）。
 *
 * 用法：node scripts/sync-unpacked.mjs [--dir=release/win-unpacked]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv.find((a) => a.startsWith('--dir='));
const OUT = path.resolve(ROOT, arg ? arg.slice(6) : 'release/win-unpacked');
const APP = path.join(OUT, 'resources', 'app');
if (!fs.existsSync(APP)) {
  console.error('找不到 ' + APP + '；先解压/构建一次 win-unpacked，再运行本脚本。');
  process.exit(1);
}
const PKGS = ['asset-governance', 'board', 'ccr-compressor', 'contracts', 'dsh-runtime', 'group-router', 'knowledge-base', 'providers', 'sync-protocol'];
const cp = (from, to) => {
  if (!fs.existsSync(from)) throw new Error('缺少构建产物：' + from);
  fs.mkdirSync(to, { recursive: true });
  fs.cpSync(from, to, { recursive: true });
  console.log('  ' + path.relative(ROOT, from) + ' → ' + path.relative(ROOT, to));
};

console.log('同步 app-shell');
cp(path.join(ROOT, 'packages/app-shell/dist'), path.join(APP, 'dist'));
cp(path.join(ROOT, 'packages/app-shell/assets'), path.join(APP, 'assets'));
fs.copyFileSync(path.join(ROOT, 'packages/app-shell/package.json'), path.join(APP, 'package.json'));

for (const p of PKGS) {
  const src = path.join(ROOT, 'packages', p, 'dist');
  const pkg = path.join(ROOT, 'packages', p, 'package.json');
  console.log('同步 ' + p);
  cp(src, path.join(OUT, 'resources', 'warmy', p, 'dist'));
  cp(src, path.join(APP, 'node_modules', '@warmy', p, 'dist'));
  if (fs.existsSync(pkg)) {
    fs.mkdirSync(path.join(OUT, 'resources', 'warmy', p), { recursive: true });
    fs.mkdirSync(path.join(APP, 'node_modules', '@warmy', p), { recursive: true });
    fs.copyFileSync(pkg, path.join(OUT, 'resources', 'warmy', p, 'package.json'));
    fs.copyFileSync(pkg, path.join(APP, 'node_modules', '@warmy', p, 'package.json'));
  }
}

console.log('同步 memory-os');
cp(path.join(ROOT, 'packages/memory-os/dist'), path.join(OUT, 'resources', 'memory-os', 'dist'));
fs.copyFileSync(path.join(ROOT, 'packages/memory-os/package.json'), path.join(OUT, 'resources', 'memory-os', 'package.json'));

console.log('\n完成：' + OUT);
