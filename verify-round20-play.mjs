/**
 * 第 20 轮 · 任务9：朗读按钮播放态（真实 Chromium 计算样式）
 *
 * 三项产品要求：
 *   ① 播放时按钮背景=强调色，**图标=聊天框背景色**（原来强调色压强调色，看不清）；
 *   ② 播放中**只有朗读按钮常驻**，引用/复制等鼠标移开就隐藏；
 *   ③ 播放时对话外框**强调色呼吸发光**（淡、慢）。
 *
 * 用真实 electron 加载**项目里真正的 app.css + renderer.css**，读 getComputedStyle 断言，
 * 因为 `:has()` / `color-mix()` / `!important` 权重这些只有浏览器说了算。
 *
 * 跑法：& $env:MIMO_NODE verify-round20-play.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const GEN = path.dirname(fileURLToPath(import.meta.url));
const R = path.join(GEN, 'packages/app-shell/src/renderer');
const electron = path.join(GEN, 'packages/app-shell/node_modules/electron/dist/electron.exe');

const gen = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-play-'));
const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${pathToFileURL(path.join(R, 'app.css')).href}">
<link rel="stylesheet" href="${pathToFileURL(path.join(R, 'renderer.css')).href}">
</head><body>
<div class="xiaoXi" id="m">
  <div class="bubbleWrap">
    <div class="bubble md" id="bub">一段回复</div>
    <div class="xiaoXiJiao"><div class="xiaoXiJiaoHang">
      <span class="xiaoXiShiJian">10:00</span>
      <button class="xiaoXiLangDu" id="la"><svg class="xiaoXiIco"></svg></button>
      <button class="xiaoXiYinYong" id="yy"><svg class="xiaoXiIco"></svg></button>
      <button class="xiaoXiFuZhi" id="fz">⧉</button>
    </div></div>
  </div>
</div></body></html>`;
fs.writeFileSync(path.join(gen, 'page.html'), html, 'utf8');

fs.writeFileSync(path.join(gen, 'main.mjs'), [
  "import { app, BrowserWindow } from 'electron';",
  "import path from 'node:path';",
  "import { fileURLToPath } from 'node:url';",
  "const here = path.dirname(fileURLToPath(import.meta.url));",
  "app.whenReady().then(async () => {",
  "  const w = new BrowserWindow({ show: false, width: 800, height: 600 });",
  "  await w.loadFile(path.join(here, 'page.html'));",
  "  const jie = await w.webContents.executeJavaScript(`(async () => {",
  "    const $ = (i) => document.getElementById(i);",
  "    const cs = (e, p) => getComputedStyle(e).getPropertyValue(p).trim();",
  "    const root = getComputedStyle(document.documentElement);",
  "    const out = {};",
  "    out.chatBg = root.getPropertyValue('--chat-bg').trim();",
  "    out.accent = root.getPropertyValue('--accent').trim();",
  "    $('la').classList.add('langDuZhong', 'boFangZhong');",
  "    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));",
  "    out.laBg = cs($('la'), 'background-color');",
  "    out.laColor = cs($('la'), 'color');",
  "    out.yyVis = cs($('yy'), 'visibility');",
  "    out.fzVis = cs($('fz'), 'visibility');",
  "    out.laVis = cs($('la'), 'visibility');",
  "    out.rowOpacity = cs(document.querySelector('.xiaoXiJiao'), 'opacity');",
  "    out.bubAnim = cs($('bub'), 'animation-name');",
  "    out.bubDur = cs($('bub'), 'animation-duration');",
  "    $('la').classList.remove('langDuZhong', 'boFangZhong');",
  "    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));",
  "    out.idleAnim = cs($('bub'), 'animation-name');",
  "    out.idleYyVis = cs($('yy'), 'visibility');",
  "    const norm = (c) => { const d = document.createElement('div'); d.style.color = c; document.body.appendChild(d); const v = getComputedStyle(d).color; d.remove(); return v; };",
  "    out.chatBgRgb = norm(out.chatBg);",
  "    out.accentRgb = norm(out.accent);",
  "    return out;",
  "  })()`);",
  "  process.stdout.write('JSON=' + JSON.stringify(jie) + '\\n');",
  "  app.quit();",
  "});",
].join('\n'), 'utf8');
fs.writeFileSync(path.join(gen, 'package.json'), JSON.stringify({ name: 'play-test', type: 'module', main: 'main.mjs' }), 'utf8');

let guo = 0; let bai = 0;
const shuo = (ok, ming, xiang = '') => {
  if (ok) { guo++; console.log(`  [过] ${ming}`); }
  else { bai++; console.log(`  [败] ${ming}${xiang ? ' :: ' + xiang : ''}`); }
};

const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const r = spawnSync(electron, [gen], { encoding: 'utf8', timeout: 45000, windowsHide: true, env });
const m = String(r.stdout || '').match(/JSON=(.*)/);
if (!m) {
  console.log('  [败] 没拿到计算样式\n' + String(r.stdout || '') + '\n' + String(r.stderr || ''));
  process.exit(1);
}
const j = JSON.parse(m[1]);

console.log('\n任务9 · 朗读按钮播放态（真实 Chromium）');
shuo(j.laBg === j.accentRgb, `① 播放时背景 = 强调色（${j.laBg}）`, `强调色=${j.accentRgb}`);
shuo(j.laColor === j.chatBgRgb, `① 播放时图标 = 聊天框背景色（${j.laColor}）`, `聊天背景=${j.chatBgRgb}`);
shuo(j.laColor !== j.laBg, '① 图标色 ≠ 背景色（不再"强调色压强调色"）');
shuo(j.laVis === 'visible', '② 播放中朗读按钮常驻');
shuo(j.yyVis === 'hidden', `② 播放中、鼠标不在时，引用图标隐藏（${j.yyVis}）`);
shuo(j.fzVis === 'hidden', `② 播放中、鼠标不在时，复制图标隐藏（${j.fzVis}）`);
shuo(j.bubAnim === 'langDuHuXi', `③ 播放时对话外框在呼吸发光（${j.bubAnim}）`);
shuo(parseFloat(j.bubDur) >= 2.5, `③ 呼吸足够"慢"（周期 ${j.bubDur}）`);
shuo(j.idleAnim === 'none', `③ 停止播放后发光消失（${j.idleAnim}）`);
shuo(j.idleYyVis === 'visible', '停止播放后引用图标恢复常规显隐（不被永久藏掉）');

if (bai) console.log('\n原始数据：' + JSON.stringify(j, null, 2));
try { fs.rmSync(gen, { recursive: true, force: true }); } catch { /* noop */ }
console.log(`\n${'─'.repeat(52)}\n过 ${guo} · 败 ${bai}\n`);
process.exit(bai ? 1 : 0);
