import {copyFileSync, mkdirSync, readdirSync, statSync, existsSync as fsExists} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gouJianXuanRan} from './gou-jian-xuan-ran.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, '..', 'src');
const dist = path.join(root, '..', 'dist');

/** 递归复制目录（支持任意层级子目录，如 renderer/icons/avatars） */
function copyDir(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name);
    const d = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else copyFileSync(s, d);
  }
}

mkdirSync(path.join(dist, 'renderer'), { recursive: true });
mkdirSync(path.join(dist, 'i18n'), { recursive: true });

copyFileSync(path.join(src, 'preload.cjs'), path.join(dist, 'preload.cjs'));
/** 第 114 轮：运行期静态加密层（主进程 + 记忆子进程共用，纯 CJS） */
copyFileSync(path.join(src, 'enc-fs.cjs'), path.join(dist, 'enc-fs.cjs'));
/** 第 66 轮认证：纯 JS 加密核心/词表不是 tsc 产物，必须显式带进 dist（否则启动 import 直接崩） */
for (const f of ['auth-core.mjs', 'auth-core.d.mts', 'auth-wordlist.mjs', 'auth-friend-words.mjs', 'auth-friend-idioms.mjs']) {
  if (fsExists(path.join(src, f))) copyFileSync(path.join(src, f), path.join(dist, f));
}
if (fsExists(path.join(src, 'snip-preload.cjs'))) copyFileSync(path.join(src, 'snip-preload.cjs'), path.join(dist, 'snip-preload.cjs'));
/* R219：拟态窗口 preload —— 缺它 warmyMimic 桥不存在，桌宠形象/交互全空白 */
if (fsExists(path.join(src, 'mimic-preload.cjs'))) copyFileSync(path.join(src, 'mimic-preload.cjs'), path.join(dist, 'mimic-preload.cjs'));
copyFileSync(path.join(src, 'mimic-menu-preload.cjs'), path.join(dist, 'mimic-menu-preload.cjs'));
copyFileSync(path.join(src, 'desktop-icons.ps1'), path.join(dist, 'desktop-icons.ps1'));
copyFileSync(path.join(src, 'ipc-aliases.json'), path.join(dist, 'ipc-aliases.json'));
/** R257：迪文子进程 worker（纯 ESM；主进程 spawn 它，npm diwen 的 native 增强只活在子进程） */
copyFileSync(path.join(src, 'diwen-worker.mjs'), path.join(dist, 'diwen-worker.mjs'));
/** R258：dsh 侧 warmy-memory 接管插件（cordis 插件，profile patch 以绝对路径加载） */
copyFileSync(path.join(src, 'dsh-warmy-memory.mjs'), path.join(dist, 'dsh-warmy-memory.mjs'));
/** R259：DuckDB 子进程 worker（native 只在子进程） */
copyFileSync(path.join(src, 'duckdb-worker.mjs'), path.join(dist, 'duckdb-worker.mjs'));
copyDir(path.join(src, 'renderer'), path.join(dist, 'renderer'));
copyDir(path.join(src, 'i18n'), path.join(dist, 'i18n'));
// pptx 模板（make_pptx 用；打包后也要在，否则只能如实报 template-missing）
const tplFrom = path.join(root, '..', 'assets');
if (fsExists(path.join(tplFrom, 'tpl.pptx'))) {
  mkdirSync(path.join(dist, 'assets'), { recursive: true });
  copyFileSync(path.join(tplFrom, 'tpl.pptx'), path.join(dist, 'assets', 'tpl.pptx'));
}

// 资源复制之后统一打包；单独运行 copy-assets 也不会把未打包模块留在 dist。
const xuanRan = await gouJianXuanRan();
console.log('app-shell assets copied (renderer + i18n, recursive); renderer IIFE checked: ' + xuanRan.ruKou.join(', '));
