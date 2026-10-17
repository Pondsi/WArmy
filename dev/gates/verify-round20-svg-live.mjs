/**
 * 第 20 轮 · 把**真实模型产出**的 SVG 送进我们的消毒器，确认端到端真的能画出图。
 *
 * 前置：先跑 verify-round20-enhance-live.mjs（它会把模型产出的 SVG 存到
 * .round20-live-svg.txt）。本脚本在真实 Chromium 里消毒 + 插入 DOM + 量 getBBox。
 *
 * 跑法：& $env:MIMO_NODE verify-round20-svg-live.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const GEN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const yuanLu = path.join(GEN, '.round20-live-svg.txt');
if (!fs.existsSync(yuanLu)) {
  console.log('  [跳过] 没有 .round20-live-svg.txt，先跑 verify-round20-enhance-live.mjs');
  process.exit(0);
}
const svg = fs.readFileSync(yuanLu, 'utf8');
const R = path.join(GEN, 'packages/app-shell/src/renderer');
const app = fs.readFileSync(path.join(R, 'app.js'), 'utf8');
const duan = app.slice(app.indexOf('const SVG_BIAOQIAN'), app.indexOf('window.__xiaoDuSvg'));

const gen = fs.mkdtempSync(path.join(os.tmpdir(), 'r20svg-'));
fs.writeFileSync(path.join(gen, 'svg.txt'), svg, 'utf8');

const yeMian = [
  '<!doctype html><meta charset="utf-8"><body><script>',
  'function escapeHtml(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;")',
  '.replace(/>/g,"&gt;").replace(/\\"/g,"&quot;").replace(/\'/g,"&#39;");}',
  duan,
  'window.xiaoDuSvg = xiaoDuSvg;',
  '</script></body>',
].join('\n');
fs.writeFileSync(path.join(gen, 'page.html'), yeMian, 'utf8');

const liang = `(() => {
  const s = __SRC__;
  const out = xiaoDuSvg(escapeHtml(s));
  const d = document.createElement('div');
  d.innerHTML = out;
  document.body.appendChild(d);
  const e = d.querySelector('svg');
  let bb = null;
  try { bb = e ? e.getBBox() : null; } catch (x) { bb = null; }
  return {
    len: out.length,
    hasSvg: !!e,
    tags: [...d.querySelectorAll('*')].length,
    texts: [...d.querySelectorAll('text')].length,
    w: bb ? Math.round(bb.width) : 0,
    h: bb ? Math.round(bb.height) : 0,
    bad: /script|onload|javascript:/i.test(out),
  };
})()`;

fs.writeFileSync(path.join(gen, 'main.mjs'), [
  "import { app, BrowserWindow } from 'electron';",
  "import fs from 'node:fs';",
  "import path from 'node:path';",
  "import { fileURLToPath } from 'node:url';",
  "const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');",
  "app.whenReady().then(async () => {",
  "  const w = new BrowserWindow({ show: false, width: 900, height: 700 });",
  "  await w.loadFile(path.join(here, 'page.html'));",
  "  const src = fs.readFileSync(path.join(here, 'svg.txt'), 'utf8');",
  "  const code = fs.readFileSync(path.join(here, 'probe.txt'), 'utf8').replace('__SRC__', JSON.stringify(src));",
  "  const r = await w.webContents.executeJavaScript(code);",
  "  process.stdout.write('JSON=' + JSON.stringify(r) + '\\n');",
  "  app.quit();",
  "});",
].join('\n'), 'utf8');
fs.writeFileSync(path.join(gen, 'probe.txt'), liang, 'utf8');
fs.writeFileSync(path.join(gen, 'package.json'), JSON.stringify({ name: 'svglive', type: 'module', main: 'main.mjs' }), 'utf8');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const r = spawnSync(path.join(GEN, 'packages/app-shell/node_modules/electron/dist/electron.exe'),
  [gen], { encoding: 'utf8', timeout: 60000, windowsHide: true, env });
const m = String(r.stdout || '').match(/JSON=(.*)/);
console.log(`\n真实产出的 SVG 源码 ${svg.length} 字`);
if (!m) {
  console.log('  [败] 没拿到结果\n' + String(r.stdout || '') + '\n' + String(r.stderr || ''));
  process.exit(1);
}
const j = JSON.parse(m[1]);
console.log(`消毒后 ${j.len} 字 · 元素 ${j.tags} 个 · 文字节点 ${j.texts} 个 · 渲染尺寸 ${j.w}x${j.h} · 含危险内容=${j.bad}`);
const ok = j.hasSvg && !j.bad && j.texts > 0 && j.w > 50 && j.h > 20;
console.log(ok
  ? '  [过] 真实模型产出的 SVG 经消毒后能正常渲染出图（有文字、有尺寸、无危险内容）'
  : '  [败] 渲染结果不达预期');
try { fs.rmSync(gen, { recursive: true, force: true }); } catch { /* noop */ }
process.exit(ok ? 0 : 1);
