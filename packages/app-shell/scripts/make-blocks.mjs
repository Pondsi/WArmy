#!/usr/bin/env node
/**
 * R162（D3-C）：给安装包生成**增量更新分块账** `<安装包>.warmyblocks`。
 *
 * 用法：
 *   node packages/app-shell/scripts/make-blocks.mjs release/0.4.9/WArmy-Setup-0.4.9.exe
 *   node packages/app-shell/scripts/make-blocks.mjs   # 不给参数就扫 release/<版本>/ 里最新的安装包
 *
 * 账本格式与算法**只有一份实现**：`packages/app-shell/src/update-blocks.ts`
 * （编译后 dist/update-blocks.js）。这里直接 import 它，避免「生成侧和消费侧算法
 * 不一致」这种最难查的 bug —— 那会让增量装配出来的包哈希对不上、每次都退回整包。
 *
 * 为什么不用 electron-builder 自带的 .blockmap：那份是 app-builder 二进制用
 * 内容定义分块生成的，参数与 gear 表不在本仓，本机无法重算旧包的账。
 * 这里自带一份两侧共用同一实现的 CDC（gear-hash 滚动，边界由内容决定），
 * 旧账在本机算就能做块级比对。
 *
 * ⚠ 别改回固定分块：本轮实测过，固定 64 KiB 分块在真实 0.4.8→0.4.9 上
 * 复用率是 **0%** —— NSIS 头部长度一变，后面所有字节整体位移，块边界全错位。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(selfDir, '..');
const root = path.resolve(pkgRoot, '../..');
const dist = path.join(pkgRoot, 'dist/update-blocks.js');
if (!fs.existsSync(dist)) {
  console.error('MAKE_BLOCKS_FAIL: 缺 dist/update-blocks.js —— 先跑 pnpm -C packages/app-shell build');
  process.exit(2);
}
const { suanKuaiZhao, bianMaKuaiZhao } = await import(pathToFileURL(dist).href);

/** 没给参数时：找 release/<版本>/ 下版本号最大的那个安装包 */
function zuiXinAnZhuangBao() {
  const rel = path.join(root, 'release');
  if (!fs.existsSync(rel)) return null;
  const banBen = fs.readdirSync(rel, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d+\.\d+\.\d+$/.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => {
      const pa = a.split('.').map(Number); const pb = b.split('.').map(Number);
      for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pb[i] - pa[i];
      return 0;
    });
  for (const v of banBen) {
    const mu = path.join(rel, v);
    const exe = fs.readdirSync(mu).filter((f) => /^WArmy-Setup-.*\.exe$/i.test(f));
    if (exe.length) return path.join(mu, exe[0]);
  }
  return null;
}

const muBiao = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : zuiXinAnZhuangBao();
if (!muBiao || !fs.existsSync(muBiao)) {
  console.error('MAKE_BLOCKS_FAIL: 找不到安装包（给个路径，或先打包）');
  process.exit(2);
}

const t0 = Date.now();
const zhao = suanKuaiZhao(muBiao);
const bian = bianMaKuaiZhao(zhao);
const chu = `${muBiao}.warmyblocks`;
fs.writeFileSync(chu, bian);

// 回读自检：账本必须能解回来，且与源文件一致（生成侧自己先证一遍）
const { jieMaKuaiZhao } = await import(pathToFileURL(dist).href);
const hui = jieMaKuaiZhao(fs.readFileSync(chu));
if (!hui.ok || hui.zhao.sha256 !== zhao.sha256 || hui.zhao.size !== zhao.size) {
  console.error('MAKE_BLOCKS_FAIL: 账本回读自检不过', hui.ok ? 'mismatch' : hui.reason);
  process.exit(1);
}

console.log('MAKE_BLOCKS_OK');
console.log(`  installer : ${muBiao}`);
console.log(`  size      : ${zhao.size}`);
console.log(`  sha256    : ${zhao.sha256}`);
console.log(`  cdc       : min=${zhao.cdc.min} mask=0x${zhao.cdc.mask.toString(16)} max=${zhao.cdc.max}`);
console.log(`  blocks    : ${zhao.kuai.length}`);
console.log(`  blockmap  : ${chu} (${bian.length} bytes)`);
console.log(`  elapsed   : ${Date.now() - t0} ms`);