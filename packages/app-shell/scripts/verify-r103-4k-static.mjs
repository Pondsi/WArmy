/**
 * verify-r103-4k-static —— 第 103 轮 4K / 高 DPI 静态接线门禁。
 *
 * 真机布局由 dev/gates/verify-r103-4k.mjs 用 CDP 仿真四种视口另测；
 * 这里只钉住源码口径，防止以后又回到 `40px` 魔法数或四列挤压：
 *  · 标题栏统一走 --titlebar-h，4K@100% 为 46px；
 *  · 所有整页高度用 calc(100vh - var(--titlebar-h))，不再写死 40px；
 *  · 四列宽度有聊天区 480px 硬下限，960 宽时夹紧列表/第四列；
 *  · 初始窗口与最小尺寸按显示器 workArea 夹紧（1080p@200% 逻辑高度 <600）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const app = read('src/renderer/app.js');
const main = read('src/electron-main.ts');
const appCss = read('src/renderer/app.css');
const rCss = read('src/renderer/renderer.css');

let pass = 0;
const ok = (name, cond) => { assert.ok(cond, name); pass++; console.log('PASS ' + name); };
const neg = (name, cond) => { assert.ok(!cond, name); pass++; console.log('PASS ' + name); };

ok('标题栏高度 token 存在（默认 40，4K@100% 46）',
  /--titlebar-h:\s*40px/.test(rCss) && /@media \(min-width: 3200px\)[\s\S]{0,500}--titlebar-h:\s*46px/.test(rCss));
ok('标题栏实际高度走 token，按钮内容减 1px 防 border-box 溢出',
  /#biaoTiLan \{ height: var\(--titlebar-h, 40px\) !important; \}/.test(rCss)
  && /#biaoTiLan \.biaoTiLanDongZuoJi button \{ height: calc\(var\(--titlebar-h, 40px\) - 1px\) !important; \}/.test(rCss));
ok('所有整页高度用 100vh - titlebar-h（不再写死 40px）',
  !/calc\(100vh - 40px\)/.test(appCss) && !/calc\(100vh - 40px\)/.test(rCss)
  && /calc\(100vh - var\(--titlebar-h, 40px\)\)/.test(appCss) && /calc\(100vh - var\(--titlebar-h, 40px\)\)/.test(rCss));
ok('模态遮罩从标题栏下沿开始（top 用 token）', /top: var\(--titlebar-h, 40px\)/.test(rCss));
ok('960 宽窗口给聊天区保留 480px 硬下限',
  /const CHAT_MIN = 480;/.test(app) && /const keYong = Math\.max\(0, vw - 64 - CHAT_MIN\);/.test(app)
  && /panel = Math\.max\(220, Math\.min\(panel, keYong - 160\)\);/.test(app)
  && /list = Math\.max\(160, Math\.min\(list, keYong - panel\)\);/.test(app));
ok('4K 标题栏/侧栏/列表行有宽屏档（不靠 JS 乘 scaleFactor）',
  /@media \(min-width: 3200px\)[\s\S]{0,800}\.ceLanTiaoMu \{ width: 54px; height: 54px; \}/.test(rCss)
  && /\.lieBiaoTiaoMu \{ padding: 12px 9px; \}/.test(rCss)
  && /#biaoTiLan \.biaoTiLanDongZuoJi button \{ width: 62px; \}/.test(rCss));
ok('初始窗口/最小尺寸按显示器 workArea 夹紧', /const wa0 = \(\(\) => \{ try \{ return screen\.getPrimaryDisplay\(\)\.workArea; \}/.test(main)
  && /minWidth: Math\.min\(960, wa0\.width\)/.test(main) && /minHeight: Math\.min\(600, wa0\.height\)/.test(main)
  && /Math\.min\(ws\.width \|\| 1280, wa0\.width\)/.test(main) && /Math\.min\(ws\.height \|\| 800, wa0\.height\)/.test(main));
ok('负向：删掉 CHAT_MIN 后判据会失败', !/const CHAT_MIN = 480;/.test(app.replace('const CHAT_MIN = 480;', '')));
ok('负向：把写死 40px 加回整页高度后判据会失败', /calc\(100vh - 40px\)/.test(rCss.replace('height: calc(100vh - var(--titlebar-h, 40px));', 'height: calc(100vh - 40px);')));

console.log(`\nverify-r103-4k-static: ${pass} PASS / 0 FAIL`);
