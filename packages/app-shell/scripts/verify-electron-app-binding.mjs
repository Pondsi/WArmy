#!/usr/bin/env node
/**
 * 门禁：**Electron 的 app 绑定不许被改名误伤**（真实崩溃回归）。
 *
 * 背景（实测）：全拼改名把 `require('electron')` 解构里的 `app` 改成了 `yingYong`
 * （`const { yingYong, BrowserWindow } = require('electron')`），但代码体仍在用
 * `app.whenReady()`。运行时 Electron 会弹
 *   「A JavaScript error occurred in the main process / ReferenceError: app is not defined」
 * 这个门禁把这类错误在提交前拦住。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(selfDir, '..', '..', '..');
const SKIP = /(node_modules|[\\/]dist[\\/]|[\\/]release[\\/]|[\\/]\.git[\\/])/;

let failures = [];
let scanned = 0;

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (SKIP.test(p)) continue;
    if (e.isDirectory()) { walk(p); continue; }
    if (!/\.(mjs|cjs|js|ts)$/.test(e.name)) continue;
    if (e.name === 'verify-electron-app-binding.mjs') continue; // 本门禁自身的正则串不算误伤
    scanned += 1;
    const t = fs.readFileSync(p, 'utf8');
    const rel = path.relative(root, p);
    // 1) electron 解构里出现 yingYong
    if (/\{\s*yingYong\b[^}]*\}\s*=\s*require\(['"]electron['"]\)/.test(t)) {
      failures.push(`${rel}: require('electron') 解构里把 app 写成了 yingYong`);
    }
    // 2) 真的把 app 解构成了 yingYong，却又调用 app.*（规则 1 只管解构形态，这条管"用了 app.*"）
    const realDestructure = /\{\s*yingYong\b[^}]*\}\s*=\s*require\(['"]electron['"]\)|\bconst\s*\{\s*yingYong\b[^}]*\}\s*=\s*require\(['"]electron['"]\)/.test(t);
    if (realDestructure && /\bapp\.(whenReady|getPath|quit|on|setAsDefaultProtocolClient|setName|setAppUserModelId|requestSingleInstanceLock)\(/.test(t)) {
      failures.push(`${rel}: 解构成 yingYong 却调用 app.*（会 ReferenceError: app is not defined）`);
    }
    // 3) 误用 yingYong.xxx 调 Electron app 的方法
    //    只在「真的会把 app 绑错」的文件里报：主进程源码，或自己也解构了 yingYong 的文件。
    //    （verify 脚本里可能只是断言用的正则字面量，不算误伤。）
    const bad = t.match(/\byingYong\.(whenReady|getPath|quit|setAsDefaultProtocolClient|requestSingleInstanceLock|setName|setAppUserModelId)\b/g);
    const isSrc = /[\\/]src[\\/]/.test(rel);
    const destructures = /\{\s*yingYong\b/.test(t);
    if (bad && (isSrc || destructures)) {
      failures.push(`${rel}: 误用 ${[...new Set(bad)].join(', ')}（应为 app.*）`);
    }
  }
}

walk(root);
if (failures.length) {
  console.log('==== verify-electron-app-binding: ' + failures.length + ' FAIL ====');
  for (const f of failures) console.log(' - ' + f);
  process.exit(1);
}
console.log(`==== verify-electron-app-binding: 全部通过（扫 ${scanned} 个文件）====`);
