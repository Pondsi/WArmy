/**
 * 第 20 轮 · 任务14：字体颜色（ink）全局生效
 *
 * 做法：真实 Chromium 加载项目的 app.css + renderer.css，
 * 先量默认文字色，再**按应用里 applyInk 的同一套写法**改 `--ink`，
 * 看各处文字是否真的跟着变。只认 getComputedStyle，不靠读 CSS 推断。
 *
 * 跑法：& $env:MIMO_NODE verify-round20-ink.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const GEN = path.dirname(fileURLToPath(import.meta.url));
const R = path.join(GEN, 'packages/app-shell/src/renderer');
let guo = 0; let bai = 0;
const shuo = (ok, ming, xiang = '') => {
  if (ok) { guo++; console.log(`  [过] ${ming}`); }
  else { bai++; console.log(`  [败] ${ming}${xiang ? ' :: ' + xiang : ''}`); }
};

const gen = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-ink-'));
/** 覆盖应用里真实存在的几类文字：AI 气泡、我方气泡、普通正文、列表项、面板标题 */
const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${pathToFileURL(path.join(R, 'app.css')).href}">
<link rel="stylesheet" href="${pathToFileURL(path.join(R, 'renderer.css')).href}">
</head><body>
<div class="xiaoXiJi" id="ji">
  <div class="xiaoXi" id="them"><div class="bubbleWrap"><div class="bubble md" id="themB">牛马的回复</div></div></div>
  <div class="xiaoXi wo" id="wo"><div class="bubbleWrap"><div class="bubble" id="woB">我说的话</div></div></div>
</div>
<div class="lieBiaoTiaoMu" id="li"><div class="name" id="liName">牛马一号</div></div>
<p id="p">普通正文</p>
</body></html>`;
fs.writeFileSync(path.join(gen, 'page.html'), html, 'utf8');

const liang = `(async () => {
  const $ = (i) => document.getElementById(i);
  const c = (e) => getComputedStyle(e).color;
  const root = document.documentElement;
  const dian = { themB: $('themB'), woB: $('woB'), liName: $('liName'), p: $('p') };
  const qu = () => Object.fromEntries(Object.entries(dian).map(([k, e]) => [k, c(e)]));
  const deng = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const out = {};
  out.moRen = qu();
  // 与 app.js 的 applyInk 完全一致的写法
  root.style.setProperty('--ink', '#ff0000');
  root.style.setProperty('--ink-strong', '#ff0000');
  await deng();
  out.hong = qu();
  // 深色主题下再试一次（我方气泡以前在深色里被写死 #e8ffe8）
  root.setAttribute('data-theme', 'dark');
  root.style.setProperty('--ink', '#00ff00');
  root.style.setProperty('--ink-strong', '#00ff00');
  await deng();
  out.anLv = qu();
  return out;
})()`;

fs.writeFileSync(path.join(gen, 'probe.txt'), liang, 'utf8');
fs.writeFileSync(path.join(gen, 'main.mjs'), [
  "import { app, BrowserWindow } from 'electron';",
  "import fs from 'node:fs';",
  "import path from 'node:path';",
  "import { fileURLToPath } from 'node:url';",
  "const here = path.dirname(fileURLToPath(import.meta.url));",
  "app.whenReady().then(async () => {",
  "  const w = new BrowserWindow({ show: false, width: 900, height: 700 });",
  "  await w.loadFile(path.join(here, 'page.html'));",
  "  const code = fs.readFileSync(path.join(here, 'probe.txt'), 'utf8');",
  "  const r = await w.webContents.executeJavaScript(code);",
  "  process.stdout.write('JSON=' + JSON.stringify(r) + '\\n');",
  "  app.quit();",
  "});",
].join('\n'), 'utf8');
fs.writeFileSync(path.join(gen, 'package.json'), JSON.stringify({ name: 'inktest', type: 'module', main: 'main.mjs' }), 'utf8');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const r = spawnSync(path.join(GEN, 'packages/app-shell/node_modules/electron/dist/electron.exe'),
  [gen], { encoding: 'utf8', timeout: 60000, windowsHide: true, env });
const m = String(r.stdout || '').match(/JSON=(.*)/);
if (!m) {
  console.log('  [败] 没拿到计算样式\n' + String(r.stdout || '') + '\n' + String(r.stderr || ''));
  process.exit(1);
}
const j = JSON.parse(m[1]);
const HONG = 'rgb(255, 0, 0)';
const LV = 'rgb(0, 255, 0)';

console.log('\n任务14 · 字体颜色全局生效（真实 Chromium）');
console.log(`  默认：${JSON.stringify(j.moRen)}`);
shuo(j.hong.themB === HONG, `牛马回复气泡跟随 ink（${j.hong.themB}）`);
shuo(j.hong.p === HONG, `普通正文跟随 ink（${j.hong.p}）`);
shuo(j.hong.liName === HONG, `列表项名称跟随 ink（${j.hong.liName}）`);
console.log(`  深色+绿：${JSON.stringify(j.anLv)}`);
shuo(j.anLv.themB === LV, `深色下牛马气泡仍跟随 ink（${j.anLv.themB}）`);
shuo(j.anLv.woB !== 'rgb(232, 255, 232)', `深色下我方气泡不再写死 #e8ffe8（${j.anLv.woB}）`);

/**
 * 我方气泡底色是亮绿 `--me-bubble`，文字色由 `--me-bubble-ink` 按对比度自动算 ——
 * 这是无障碍要求（写死 ink 可能在亮绿底上完全看不清），属于**有意的例外**。
 * 这里只断言它「不是写死的那个值」，不要求等于 ink。
 */
console.log('  说明：我方气泡（亮绿底）与强调色底上的文字，按对比度自动取色，是无障碍上的有意例外。');

// 源码层面：确认深色那条规则已改成变量
{
  const css = fs.readFileSync(path.join(R, 'renderer.css'), 'utf8');
  shuo(!/\[data-theme="dark"\] \.xiaoXi\.wo \.bubble \{ color: #e8ffe8; \}/.test(css),
    '深色我方气泡的硬编码色已移除');
  shuo(/\[data-theme="dark"\] \.xiaoXi\.wo \.bubble \{ color: var\(/.test(css),
    '改为走 CSS 变量');
}

try { fs.rmSync(gen, { recursive: true, force: true }); } catch { /* noop */ }
console.log(`\n${'─'.repeat(52)}\n过 ${guo} · 败 ${bai}\n`);
process.exit(bai ? 1 : 0);
