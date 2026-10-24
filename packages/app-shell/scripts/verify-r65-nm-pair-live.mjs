/**
 * 第 65 轮 项 25：**两个真实 nm 窗口**的吸附/联动（真机档，不是纯函数）。
 * 起一个隐藏的 Electron 宿主，开两个临时文本的 nm 窗口，手动把第二个放到第一个右侧 10px：
 *  - 必须吸住（无缝隙、顶边对齐、同高）；
 *  - 两窗的 lianJie 必须互相登记；
 *  - 再拖动第一个 200px，第二个必须跟着走（联动）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PKG = path.join(ROOT, 'packages/app-shell');
const ELECTRON = path.join(PKG, 'node_modules/electron/dist/electron.exe');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-r65-nmpair-'));
const a = path.join(tmp, 'a.txt');
const b = path.join(tmp, 'b.txt');
fs.writeFileSync(a, 'AAA', 'utf8');
fs.writeFileSync(b, 'BBB', 'utf8');
const host = path.join(tmp, 'host.cjs');
fs.writeFileSync(host, `
const { app, BrowserWindow } = require('electron');
const path = require('path');
const nm = require(${JSON.stringify(path.join(PKG, 'dist/nm-viewer-win.js'))});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const out = { ok: false };
  try {
    const r1 = nm.nmShiTuKai({ luJing: ${JSON.stringify(a)}, zhuTi: { mode: 'light', accent: '#A87654' } });
    const r2 = nm.nmShiTuKai({ luJing: ${JSON.stringify(b)}, zhuTi: { mode: 'light', accent: '#A87654' } });
    await sleep(400);
    const w1 = BrowserWindow.fromId(r1.id), w2 = BrowserWindow.fromId(r2.id);
    w1.setBounds({ x: 100, y: 100, width: 800, height: 600 });
    await sleep(120);
    w2.setBounds({ x: 910, y: 100, width: 700, height: 600 });
    await sleep(500);
    const b1 = w1.getBounds(), b2 = w2.getBounds();
    const lie = nm.nmShiTuLieBiao();
    const l1 = (lie.find((x) => x.id === r1.id) || {}).lianJie || [];
    const l2 = (lie.find((x) => x.id === r2.id) || {}).lianJie || [];
    const snap = {
      gap: b1.x + b1.width === b2.x || b2.x + b2.width === b1.x,
      top: b1.y === b2.y,
      height: b1.height === b2.height,
      link: l1.includes(r2.id) && l2.includes(r1.id),
    };
    const before = { w1: b1, w2: b2 };
    w1.setBounds({ x: b1.x + 200, y: b1.y + 200, width: b1.width, height: b1.height });
    await sleep(500);
    const after2 = w2.getBounds();
    out.ok = true;
    out.snap = snap;
    out.before = before;
    out.after2 = after2;
    out.followed = Math.abs((after2.x - b2.x) - 200) <= 2 && Math.abs((after2.y - b2.y) - 200) <= 2;
  } catch (e) {
    out.err = String((e && (e.stack || e.message)) || e).slice(0, 500);
  }
  console.log('R65NMPAIR ' + JSON.stringify(out));
  app.quit();
}).catch((e) => { console.log('R65NMPAIR ' + JSON.stringify({ ok: false, err: String(e) })); app.quit(); });
`, 'utf8');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const r = spawnSync(ELECTRON, [host], { timeout: 60000, encoding: 'utf8', windowsHide: true, env });
const line = String(r.stdout || '').split(/\r?\n/).find((x) => x.startsWith('R65NMPAIR '));
let ok = 0; const bad = [];
const jian = (m, t, x) => { if (t) { ok++; console.log('PASS ' + m); } else { bad.push(m); console.log('FAIL ' + m + (x ? ' ← ' + JSON.stringify(x).slice(0, 400) : '')); } };
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* noop */ }
if (!line) {
  console.log('FAIL 两个 nm 真窗口跑得起来 ← ' + String(r.stderr || r.stdout || '').slice(0, 300));
  process.exit(1);
}
const j = JSON.parse(line.slice('R65NMPAIR '.length));
jian('两个 nm 真窗口跑得起来', j.ok === true, j);
jian('第二个窗放到右侧 10px 内会吸住（无缝隙）', j.snap && j.snap.gap, j.snap);
jian('并排后顶边对齐、同高', j.snap && j.snap.top && j.snap.height, j.snap);
jian('两窗互相登记为联动', j.snap && j.snap.link, j.snap);
jian('拖动第一个 200px，第二个跟着走 200px', j.followed === true, { before: j.before, after2: j.after2 });
console.log(`\n==== verify-r65-nm-pair-live: ${ok} PASS / ${bad.length} FAIL ====`);
if (bad.length) console.log(bad.map((x) => '  ✗ ' + x).join('\n'));
process.exit(bad.length ? 1 : 0);
