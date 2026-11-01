/**
 * verify-r97-nm-live —— 第 97 轮 nm 查看器 / 吸附真机验收（Electron + CDP，临时 profile）。
 *
 * 项 5：二进制编辑框为空时，placeholder 显示原字节；
 * 项 6：菜单点外部收起、同一个按钮再点也收起；
 * 项 7：新 nm 永远贴主窗口右侧、同高；右侧已占则重叠且不吸附；拖 nm 不反向拖主窗口；
 * 项 10：Markdown 分栏竖线可左右拖（越过 iframe 也不断）、收起一侧后另一侧铺满。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PKG = path.join(ROOT, 'packages/app-shell');
const ELECTRON = path.join(PKG, 'node_modules', 'electron', 'dist', 'electron.exe');
const MAIN = path.join(PKG, 'dist', 'electron-main.js');
const { attach, sleep } = await import(pathToFileURL(path.join(PKG, 'scripts', 'cdp-lib.mjs')).href);

let okN = 0, failN = 0;
const ok = (m, d) => { okN++; console.log('  ok   ' + m + (d === undefined ? '' : ' ← ' + String(d).slice(0, 320))); };
const bad = (m, d) => { failN++; console.log('  FAIL ' + m + (d === undefined ? '' : ' ← ' + String(d).slice(0, 420))); };
const jian = (m, cond, d) => (cond ? ok(m, d) : bad(m, d));

let child = null, c = null, profile = '';
const js = (conn) => (e) => conn.evaluate('(async function(){ try { return await (' + e + '); } catch (err) { return { __err: String((err && (err.stack || err.message)) || err).slice(0, 400) }; } })()');
const click = async (conn, sel, nth = 0) => {
  const p = await js(conn)(`(() => { const a=[...document.querySelectorAll(${JSON.stringify(sel)})]; const e=a[${nth}]; if(!e) return null; e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}; })()`);
  if (!p || p.__err) return false;
  await conn.mouseClick(p.x, p.y);
  return true;
};

async function start(port, prof) {
  const env = { ...process.env, WARMY_AUTH_BYPASS: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(ELECTRON, ['--remote-debugging-port=' + port, '--user-data-dir=' + prof, MAIN], {
    cwd: PKG, stdio: ['ignore', 'ignore', 'ignore'], windowsHide: false, env,
  });
  let last = '';
  for (let i = 0; i < 90; i++) {
    try { c = await attach(port, { biaoQian: 'r97-nm', callTimeout: 20000 }); break; } catch (e) { last = e.message; await sleep(300); }
  }
  if (!c) throw new Error('CDP 未连接：' + last);
  await c.send('Runtime.enable');
}
async function attachPage(port, includes) {
  for (let i = 0; i < 80; i++) {
    try { const x = await attach(port, { biaoQian: 'r97-nm', matchUrlIncludes: includes, callTimeout: 20000 }); await x.send('Runtime.enable'); return x; } catch { await sleep(250); }
  }
  return null;
}
async function stop() {
  try { if (c) await c.send('Browser.close', {}, { timeout: 5000 }); } catch { /* 已退 */ }
  c = null;
  await sleep(700);
  try { if (child) execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* 已退 */ }
  child = null;
}
function winScreen(conn) {
  return js(conn)('({x:Math.round(screenX),y:Math.round(screenY),w:Math.round(outerWidth),h:Math.round(outerHeight)})');
}
const PS_MOVE = path.join(os.tmpdir(), 'warmy-r97-move-win.ps1');
function writeMoveScript() {
  fs.writeFileSync(PS_MOVE, [
    'param([string]$TitleB64="",[int]$DX=0,[int]$DY=0)',
    'Add-Type @"',
    'using System;',
    'using System.Text;',
    'using System.Runtime.InteropServices;',
    'public class W {',
    '  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }',
    '  public delegate bool EnumProc(IntPtr h, IntPtr l);',
    '  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);',
    '  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);',
    '  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);',
    '  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);',
    '  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr z, int x, int y, int cx, int cy, uint f);',
    '}',
    '"@',
    'if (-not $TitleB64) { exit 3 }',
    '$target = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($TitleB64))',
    '$global:found = [IntPtr]::Zero',
    '$cb = [W+EnumProc]{ param($h,$l)',
    '  if (-not [W]::IsWindowVisible($h)) { return $true }',
    '  $sb = New-Object System.Text.StringBuilder 1024',
    '  [void][W]::GetWindowText($h, $sb, 1024)',
    '  $t = $sb.ToString()',
    '  if ($t -eq $target -or $t.Contains($target)) { $global:found = $h; return $false }',
    '  return $true }',
    '[void][W]::EnumWindows($cb, [IntPtr]::Zero)',
    'if ($global:found -eq [IntPtr]::Zero) { exit 2 }',
    '$r = New-Object W+RECT',
    '[void][W]::GetWindowRect($global:found, [ref]$r)',
    '$w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top',
    '[void][W]::SetWindowPos($global:found, [IntPtr]::Zero, $r.Left + $DX, $r.Top + $DY, $w, $h, 0x0014)',
    'exit 0',
  ].join('\r\n'), 'utf8');
}
function moveWin({ title = '', dx = 0, dy = 0 }) {
  try {
    const b64 = Buffer.from(String(title || ''), 'utf8').toString('base64');
    execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS_MOVE,
      '-TitleB64', b64, '-DX', String(dx), '-DY', String(dy)], { stdio: 'ignore', timeout: 15000 });
    return true;
  } catch { return false; }
}

try {
  profile = path.join(os.tmpdir(), 'warmy-r97-nm-' + Date.now());
  fs.mkdirSync(profile, { recursive: true });
  const doc = path.join(profile, 'split-test.md');
  fs.writeFileSync(doc, '# 分栏测试\n\n' + Array.from({ length: 40 }, (_, i) => `- 第 ${i + 1} 行：这是 Markdown 预览内容，用来测试左右分栏拖动。`).join('\n'), 'utf8');
  const doc2 = path.join(profile, 'second.md');
  fs.writeFileSync(doc2, '# 第二份文档\n\n第二扇 nm 窗口应当与第一扇重叠，而不是继续往右排。\n', 'utf8');
  const bin = path.join(profile, 'bytes.bin');
  fs.writeFileSync(bin, Buffer.from([0xAB, 0xCD, 0xEF, 0x01, 0x23, 0x45, 0x67, 0x89, 0x00, 0xFF, 0x10, 0x20, 0x30, 0x40, 0x50, 0x60]));
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
    yuYan: 'zh-CN', setupDone: true, privacyConsent: true, guideDone: true, providersSeeded: true,
    instances: [], providers: [], authGrants: {}, panelCardCollapsed: {},
  }, null, 2), 'utf8');

  const port = Number(process.env.R97_NM_PORT || 9728);
  await start(port, profile);
  await c.waitFor('!!document.querySelector("[data-nav=singleAi]")', { timeout: 30000 });
  await sleep(500);

  // ── 打开第一份 Markdown ──
  const r1 = await js(c)(`window.warmy.nmKai(${JSON.stringify(doc)})`);
  jian('nmKai 返回成功', !!(r1 && r1.ok), JSON.stringify(r1));
  await sleep(900);
  const n = await attachPage(port, 'split-test.md');
  if (!n) throw new Error('找不到 Markdown nm 页面');
  await n.waitFor('!document.getElementById("fenGeTiao").hidden', { timeout: 15000 });
  await sleep(500);

  // ── 项 10：分栏拖动（向右越过 iframe 也不能停） ──
  const before = await n.evaluate(`(() => { const s=document.getElementById('fenGeTiao').getBoundingClientRect(); const j=document.getElementById('juanCuo').getBoundingClientRect(); const y=document.getElementById('yuLanLie').getBoundingClientRect(); return {sx:Math.round(s.left+s.width/2),sy:Math.round(s.top+s.height/2),jw:Math.round(j.width),yw:Math.round(y.width)}; })()`);
  await n.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: before.sx, y: before.sy, button: 'left', clickCount: 1 });
  await n.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: before.sx + 60, y: before.sy, button: 'left' });
  await n.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: before.sx + 140, y: before.sy, button: 'left' });
  await n.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: before.sx + 140, y: before.sy, button: 'left', clickCount: 1 });
  await sleep(350);
  const after = await n.evaluate(`(() => { const j=document.getElementById('juanCuo').getBoundingClientRect(); return {jw:Math.round(j.width)}; })()`);
  jian('分栏竖线向右拖动有效（越过预览 iframe 也不断）', !!(after && after.jw > before.jw + 60), JSON.stringify({ before, after }));
  await n.evaluate(`document.getElementById('fenGeTiao').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`);
  await sleep(250);
  const reset = await n.evaluate(`(() => { const h=document.getElementById('neiRongHang').getBoundingClientRect(); const j=document.getElementById('juanCuo').getBoundingClientRect(); return {ratio:j.width/h.width}; })()`);
  jian('双击分隔条恢复约 50%', !!(reset && Math.abs(reset.ratio - 0.5) < 0.12), JSON.stringify(reset));

  // ── 项 10：收起预览后源码铺满 ──
  await n.evaluate(`document.getElementById('anNiuShouYou').click()`);
  await sleep(300);
  const collapsed = await n.evaluate(`(() => { const h=document.getElementById('neiRongHang').getBoundingClientRect(); const j=document.getElementById('juanCuo'); return {hidden:getComputedStyle(document.getElementById('yuLanLie')).display==='none', jw:Math.round(j.getBoundingClientRect().width), hw:Math.round(h.width)}; })()`);
  jian('点击「收起预览」后右侧不留空白（源码铺满）', !!(collapsed && collapsed.hidden && collapsed.jw >= collapsed.hw - 30), JSON.stringify(collapsed));
  await n.evaluate(`document.getElementById('anNiuShouYou').click()`);
  await sleep(300);
  const expanded = await n.evaluate(`(() => { const j=document.getElementById('juanCuo').getBoundingClientRect(); const h=document.getElementById('neiRongHang').getBoundingClientRect(); return {hidden:document.getElementById('yuLanLie').hidden, ratio:j.width/h.width}; })()`);
  jian('再次点击恢复预览分栏', !!(expanded && !expanded.hidden && expanded.ratio > 0.25 && expanded.ratio < 0.75), JSON.stringify(expanded));

  // ── 项 6：菜单点外部/同按钮收起 ──
  await n.evaluate(`document.getElementById('anNiuBaoCunXia').click()`); await sleep(250);
  const m1 = await n.evaluate(`!document.getElementById('gongJuCaiDan').hidden`);
  await n.evaluate(`document.getElementById('anNiuBaoCunXia').click()`); await sleep(250);
  const m2 = await n.evaluate(`!document.getElementById('gongJuCaiDan').hidden`);
  await n.evaluate(`document.getElementById('anNiuBaoCunXia').click()`); await sleep(250);
  const m3 = await n.evaluate(`!document.getElementById('gongJuCaiDan').hidden`);
  await n.evaluate(`document.getElementById('zhengWen').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`); await sleep(300);
  const m4 = await n.evaluate(`!document.getElementById('gongJuCaiDan').hidden`);
  jian('菜单同按钮第二次点击收起', !!(m1 && !m2), JSON.stringify({ m1, m2 }));
  jian('菜单点外部收起', !!(m3 && !m4), JSON.stringify({ m3, m4 }));

  // ── 项 5：二进制编辑框 placeholder = 原字节 ──
  const r2 = await js(c)(`window.warmy.nmKai(${JSON.stringify(bin)})`);
  jian('二进制文件打开成功', !!(r2 && r2.ok), JSON.stringify(r2));
  await sleep(900);
  const nb = await attachPage(port, 'bytes.bin');
  if (!nb) throw new Error('找不到二进制 nm 页面');
  await nb.waitFor('!document.getElementById("shiLiuLie").hidden', { timeout: 15000 });
  await sleep(500);
  const zj = await nb.evaluate(`(() => { const s=document.querySelector('.shiLiuHex span[data-off]'); if(!s) return null; const r=s.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),off:s.dataset.off,text:s.textContent}; })()`);
  if (zj) await nb.mouseClick(zj.x, zj.y);
  await sleep(300);
  const ph = await nb.evaluate(`(() => { const s=document.getElementById('shiLiuShuRu'); return {hidden:s.hidden,ph:s.placeholder,value:s.value,first:document.querySelector('.shiLiuHex span[data-off]')?.textContent}; })()`);
  jian('点字节后输入框为空但 placeholder 显示原字节', !!(ph && ph.hidden === false && ph.value === '' && /^[0-9A-F]{2}$/.test(ph.ph) && ph.ph === String(ph.first || '').trim()), JSON.stringify(ph));

  // ── 项 7：新窗口贴主窗口右侧、同高；第二扇重叠且不吸附 ──
  const mainW = await winScreen(c);
  const md1 = await winScreen(n);
  jian('第一扇 nm 贴主窗口右侧、顶边对齐、高度与主窗口一致',
    !!(mainW && md1 && Math.abs(md1.x - (mainW.x + mainW.w)) <= 18 && Math.abs(md1.y - mainW.y) <= 18 && Math.abs(md1.h - mainW.h) <= 18),
    JSON.stringify({ mainW, md1 }));
  const r3 = await js(c)(`window.warmy.nmKai(${JSON.stringify(doc2)})`);
  jian('第二份文档打开成功', !!(r3 && r3.ok), JSON.stringify(r3));
  await sleep(900);
  const n2 = await attachPage(port, 'second.md');
  if (!n2) throw new Error('找不到第二扇 nm 页面');
  await sleep(400);
  const md2 = await winScreen(n2);
  jian('第二扇仍开在同一个位置（与第一扇重叠，不再往右排）',
    !!(md2 && md1 && Math.abs(md2.x - md1.x) <= 18 && Math.abs(md2.y - md1.y) <= 18 && Math.abs(md2.h - md1.h) <= 18),
    JSON.stringify({ md1, md2 }));
  const lie = await js(c)(`window.warmy.nmLieBiao()`);
  const arr = (lie && lie.chuangKou) || [];
  const id1b = await n.evaluate(`Number(new URLSearchParams(location.search).get('id')||0)`);
  const id2 = await n2.evaluate(`Number(new URLSearchParams(location.search).get('id')||0)`);
  const z1 = arr.find((x) => Number(x.id) === Number(id1b));
  const z2 = arr.find((x) => Number(x.id) === Number(id2));
  jian('第一扇与主窗口有吸附连接', !!(z1 && Array.isArray(z1.lianJie) && z1.lianJie.includes(-1)), JSON.stringify({ id1b, z1, arr }));
  jian('第二扇没有抢主窗口右侧的吸附边', !!(z2 && Array.isArray(z2.lianJie) && !z2.lianJie.includes(-1)), JSON.stringify({ id2, z2 }));

  // ── 项 7：主窗移动带走吸附窗；拖 nm 不反向拖主窗（用真实 SetWindowPos，走 Electron move 事件） ──
  writeMoveScript();
  const mainTitle = await js(c)('document.title');
  const mdTitle = await n.evaluate('document.title');
  const moveMain = moveWin({ title: mainTitle, dx: 60, dy: 0 });
  await sleep(900);
  const md1b = await winScreen(n);
  jian('主窗口右移 60px 后，吸附的 nm 跟着右移',
    !!(moveMain && md1b && Math.abs(md1b.x - (md1.x + 60)) <= 28), JSON.stringify({ moveMain, mainTitle, mdTitle, md1, md1b }));
  const mainAfter = await winScreen(c);
  const moveNm = moveWin({ title: mdTitle, dx: 10, dy: 0 });
  await sleep(900);
  const mainAfter2 = await winScreen(c);
  jian('拖 nm 10px 不会反向拖主窗口',
    !!(moveNm && mainAfter && mainAfter2 && Math.abs(mainAfter2.x - mainAfter.x) <= 3 && Math.abs(mainAfter2.y - mainAfter.y) <= 3),
    JSON.stringify({ moveNm, mainTitle, mdTitle, mainAfter, mainAfter2 }));

  const errs = (typeof c.errors === 'function' ? c.errors() : []) || [];
  jian('nm 验收全程主窗口无脚本错误', errs.length === 0, JSON.stringify(errs).slice(0, 300));
} catch (e) {
  bad('门禁执行异常', String((e && (e.stack || e.message)) || e));
} finally {
  await stop();
  try { if (profile) fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 尽力清 */ }
  try { fs.rmSync(PS_MOVE, { force: true }); } catch { /* 尽力清 */ }
}

console.log(`\nverify-r97-nm-live: ${okN} ok / ${failN} FAIL`);
process.exitCode = failN ? 1 : 0;
