/**
 * 第 20 轮 · ESM 产物门禁
 *
 * 本包是 ESM（package.json `"type":"module"`，tsc `module: NodeNext`），
 * 产物里出现 `require(` / `__dirname` / `module.exports` 就是**运行时必崩**。
 *
 * 真机事故（任务4）：`warmy:copyFileToClipboard` 三条分支全以
 * `require('node:child_process')` / `require('electron')` 开头 ⇒ 每条第一行就抛
 * `require is not defined`，于是右键「复制」永远只提示"文件复制不可用，已改为复制路径"。
 * 实测 PowerShell `Set-Clipboard -LiteralPath` 本身完全可用，根因纯粹是模块制式。
 * 同一个错误还静默吃掉了窗口位置记忆（`require('electron')` 取 screen 被 catch 吞掉）。
 *
 * 这类问题 tsc **不报错**（require 是合法标识符），所以必须有独立门禁。
 *
 * 跑法：& $env:MIMO_NODE verify-round20-esm.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GEN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let guo = 0; let bai = 0;
const shuo = (ok, ming, xiang = '') => {
  if (ok) { guo++; console.log(`  [过] ${ming}`); }
  else { bai++; console.log(`  [败] ${ming}${xiang ? ' :: ' + xiang : ''}`); }
};

/**
 * CommonJS 专有物：在 ESM 里**未经定义就裸用**才是运行时炸弹。
 *
 * 合法用法要放过，否则门禁没人愿意留：
 *   · `const require = createRequire(import.meta.url)` —— 本项目多处如此，是正确姿势；
 *   · `const __dirname = path.resolve(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), '../..')` —— 同理；
 *   · `vendor/` 下的第三方 UMD 包 —— 它们自己判断环境，不由我们编译。
 *
 * 所以判据是「**用了但没定义**」，而不是「出现过」。
 */
const DI_LEI = [
  { zhao: /\brequire\s*\(/g, ming: 'require(', ding: /createRequire\s*\(|(?:const|let|var)\s+require\s*=/ },
  { zhao: /\b__dirname\b/g, ming: '__dirname', ding: /(?:const|let|var)\s+__dirname\s*=/ },
  { zhao: /\b__filename\b/g, ming: '__filename', ding: /(?:const|let|var)\s+__filename\s*=/ },
  { zhao: /\bmodule\.exports\b/g, ming: 'module.exports', ding: null },
];
/** 第三方 UMD 产物：不是我们编译出来的，自带环境判断 */
const FANG_GUO = /[\\/]vendor[\\/]/;

console.log('\nESM 产物门禁（CommonJS 残留 = 运行时必崩）');

const baoJi = fs.readdirSync(path.join(GEN, 'packages'), { withFileTypes: true })
  .filter((d) => d.isDirectory()).map((d) => d.name);

let chaGuo = 0;
for (const bao of baoJi) {
  const pkgLu = path.join(GEN, 'packages', bao, 'package.json');
  if (!fs.existsSync(pkgLu)) continue;
  let shiEsm = false;
  try { shiEsm = JSON.parse(fs.readFileSync(pkgLu, 'utf8')).type === 'module'; } catch { /* */ }
  if (!shiEsm) continue;
  const distLu = path.join(GEN, 'packages', bao, 'dist');
  if (!fs.existsSync(distLu)) continue;

  // dist 下所有 .js（含子目录）
  const dui = [distLu]; const wenJianJi = [];
  while (dui.length) {
    const d = dui.pop();
    for (const it of fs.readdirSync(d, { withFileTypes: true })) {
      const quan = path.join(d, it.name);
      if (it.isDirectory()) dui.push(quan);
      else if (it.name.endsWith('.js')) wenJianJi.push(quan);
    }
  }

  for (const f of wenJianJi) {
    const xiangDui = path.relative(GEN, f);
    if (FANG_GUO.test(xiangDui)) continue;
    /**
     * **只看代码，不看注释**：本项目注释里大量写着「以前这里用 `require('electron')`」
     * 这类事故复盘说明（正是它们提醒后人别再犯），不能因此判红。
     * 先剥掉 /* *\/ 块注释与 // 行注释，再做匹配。
     */
    const wen = fs.readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');
    for (const { zhao, ming, ding } of DI_LEI) {
      zhao.lastIndex = 0;
      const pei = [...wen.matchAll(zhao)];
      if (!pei.length) continue;
      // 本文件已自行定义 ⇒ 合法用法，放过
      if (ding && ding.test(wen)) continue;
      // 报出行号，方便直接定位
      const hangJi = pei.map((m) => wen.slice(0, m.index).split('\n').length);
      shuo(false, `${xiangDui} 裸用 ${ming}（ESM 里未定义）`,
        `行 ${hangJi.slice(0, 6).join(',')}${hangJi.length > 6 ? '…' : ''}`);
    }
    chaGuo++;
  }
}
shuo(chaGuo > 0, `确实扫到了产物文件（${chaGuo} 个 .js）`);

// 关键路径的正向断言：复制文件走 execFile，不走 require
{
  const f = path.join(GEN, 'packages/app-shell/dist/electron-main.js');
  if (fs.existsSync(f)) {
    const wen = fs.readFileSync(f, 'utf8');
    shuo(/from 'electron'/.test(wen) && /\bclipboard\b/.test(wen),
      'clipboard 由顶部 import 提供（不是运行时 require）');
    shuo(wen.includes('Set-Clipboard -LiteralPath'), '复制文件本体仍走 Set-Clipboard');
    shuo(wen.includes("clipboard.writeBuffer('FileNameW'"), '保留 FileNameW 原生剪贴板退路');
  }
}

console.log(`\n${'─'.repeat(52)}\n过 ${guo} · 败 ${bai}\n`);
process.exit(bai ? 1 : 0);
