/**
 * verify-r62-ui.mjs（项目专项 · 真机 UI）—— 第 62 轮：
 *  ① nm 查看器几何：媒体区 hidden 时必须 display:none，三个面板各自铺满正文区，textarea 真能滚；
 *  ② 主窗口吸附：真进程 + 真 Win32 移动，验证靠近屏幕工作区边缘会贴边、离得远不贴、开关真的生效。
 *
 * 为什么不是只看 CSS/源码：上一轮用户报的正是"内容只在上半屏"这种几何现象；静态断言抓不到，
 * 必须量真实盒模型。主窗口吸附也必须让原生窗口真的移动才会触发 Electron 的 `move` 事件。
 *
 * 隔离：nm 用隐藏窗口直接加载产物；主窗口用 `%TEMP%\warmy-r62-ui-*` 作 userData，不碰真实配置。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { attach, sleep } from './cdp-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PKG = path.join(ROOT, 'packages/app-shell');
const ELECTRON = path.join(PKG, 'node_modules/electron/dist/electron.exe');
const PORT = Number(process.env.R62_UI_PORT || 9437);

let okN = 0, failN = 0;
const jian = (l, p, d) => { if (p) { okN++; console.log('  ok  ' + l); } else { failN++; console.log('  FAIL ' + l + (d ? ' ← ' + String(d).slice(0, 220) : '')); } };
const jin = (a, b, tol = 2) => Math.abs(Number(a) - Number(b)) <= tol;

/* ── ① nm 查看器几何（隐藏 Electron 窗口，加载真实产物） ── */
function nmJiHe() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-r62-nm-'));
  const entry = path.join(dir, 'main.cjs');
  const html = path.join(PKG, 'dist/renderer/nm-viewer.html');
  const ce = `(function(){
    const $=id=>document.getElementById(id);
    $('tiShiLie').hidden=true;
    $('juanCuo').hidden=false; $('kuaiLie').hidden=true; $('meiTiLie').hidden=true;
    const z=$('zhengWen').getBoundingClientRect();
    const j=$('juanCuo').getBoundingClientRect();
    const ta=$('wenBen');
    ta.value=Array.from({length:300},(_,i)=>'line '+i).join('\\n');
    const scrollable=ta.scrollHeight>ta.clientHeight;
    const hiddenMedia=getComputedStyle($('meiTiLie')).display;
    $('juanCuo').hidden=true; $('kuaiLie').hidden=false; $('meiTiLie').hidden=true;
    const k=$('kuaiLie').getBoundingClientRect();
    $('kuaiLie').hidden=true; $('meiTiLie').hidden=false;
    const m=$('meiTiLie').getBoundingClientRect();
    const shownMedia=getComputedStyle($('meiTiLie')).display;
    return { zheng:z.height, juan:j.height, kuai:k.height, meiTi:m.height, hiddenMedia, shownMedia, scrollable };
  })()`;
  fs.writeFileSync(entry, `const { app, BrowserWindow } = require('electron');
app.disableHardwareAcceleration();
const CE = ${JSON.stringify(ce)};
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 900, height: 700, webPreferences: { sandbox: true } });
  await w.loadFile(${JSON.stringify(html)});
  const r = await w.webContents.executeJavaScript(CE);
  console.log('R62_GEO ' + JSON.stringify(r));
  app.quit();
}).catch((e) => { console.error(String((e && e.stack) || e)); app.quit(); });
`, 'utf8');
  try {
    const env0 = { ...process.env };
    delete env0.ELECTRON_RUN_AS_NODE;
    const r = spawnSync(ELECTRON, ['--user-data-dir=' + dir, '--no-sandbox', entry], { timeout: 45000, encoding: 'utf8', windowsHide: true, env: env0 });
    const line = String(r.stdout || '').split(/\r?\n/).find((x) => x.startsWith('R62_GEO '));
    if (!line) return { cuo: '没有拿到几何读数: ' + String(r.stderr || r.stdout || '').slice(0, 180) };
    return JSON.parse(line.slice('R62_GEO '.length));
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
  }
}

const geo = nmJiHe();
if (geo.cuo) jian('nm 几何测量跑得起来', false, geo.cuo);
else {
  jian('nm 媒体区 hidden 时真的不占位', geo.hiddenMedia === 'none', JSON.stringify(geo));
  jian('nm 文本面板铺满正文高度（不是只占上半屏）', jin(geo.juan, geo.zheng, 3), JSON.stringify(geo));
  jian('nm 只读文档面板铺满正文高度', jin(geo.kuai, geo.zheng, 3), JSON.stringify(geo));
  jian('nm 媒体面板铺满正文高度', jin(geo.meiTi, geo.zheng, 3), JSON.stringify(geo));
  jian('nm 媒体面板显示时是 flex、隐藏时是 none', geo.shownMedia === 'flex' && geo.hiddenMedia === 'none', JSON.stringify(geo));
  jian('nm textarea 在整块正文区里真的能滚', geo.scrollable === true, JSON.stringify(geo));
}

/* ── ② 主窗口吸附：真进程 + Win32 移动 ── */
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-r62-ui-'));
const PS1 = path.join(PROFILE, 'win32.ps1');
fs.writeFileSync(PS1, String.raw`
param([string]$Action,[int]$ProcId,[long]$H,[int]$X,[int]$Y,[int]$W,[int]$Ht)
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class W {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
  public static IntPtr Find(uint target) {
    IntPtr best = IntPtr.Zero; long max = 0;
    EnumWindows((h,l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid == target && IsWindowVisible(h)) {
        RECT r; if (GetWindowRect(h, out r)) { long a = (long)(r.Right-r.Left) * (r.Bottom-r.Top); if (a > max) { max = a; best = h; } }
      }
      return true;
    }, IntPtr.Zero);
    return best;
  }
  public static string Rect(IntPtr h){
    RECT r;
    /** DWMWA_EXTENDED_FRAME_BOUNDS=9：可见边框，不含 DWM 阴影；GetWindowRect 在 Win10/11 会把左边约 6px 阴影算进去 */
    int hr = DwmGetWindowAttribute(h, 9, out r, Marshal.SizeOf(typeof(RECT)));
    if (hr != 0) { if (!GetWindowRect(h, out r)) return "BADRECT"; }
    return r.Left+","+r.Top+","+(r.Right-r.Left)+","+(r.Bottom-r.Top);
  }
  public static bool Move(IntPtr h,int x,int y,int w,int ht){ return SetWindowPos(h,IntPtr.Zero,x,y,w,ht,0x0004); }
  public static uint Dpi(IntPtr h){ return GetDpiForWindow(h); }
}
"@
if ($Action -eq 'work') { Add-Type -AssemblyName System.Windows.Forms; $r=[System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea; Write-Output "$($r.X),$($r.Y),$($r.Width),$($r.Height)"; exit 0 }
if ($Action -eq 'find') { $hw=[W]::Find($ProcId); if ($hw -eq [IntPtr]::Zero) { Write-Output "NOHWND"; exit 1 } else { Write-Output $hw.ToInt64(); exit 0 } }
$hh = [IntPtr][long]$H
if ($Action -eq 'rect') { Write-Output ([W]::Rect($hh)) }
elseif ($Action -eq 'dpi') { Write-Output ([W]::Dpi($hh)) }
elseif ($Action -eq 'move') { [W]::Move($hh,$X,$Y,$W,$Ht) | Out-Null; Start-Sleep -Milliseconds 200; Write-Output ([W]::Rect($hh)) }
`, 'utf8');
const ps = (args) => {
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS1, ...args.map(String)], { encoding: 'utf8' });
  const out = String(r.stdout || '').trim();
  if (!out && String(r.stderr || '').trim()) console.log('  · [win32] ' + String(r.stderr).trim().split(/\r?\n/)[0].slice(0, 180));
  return out;
};

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(ELECTRON, [`--remote-debugging-port=${PORT}`, '--user-data-dir=' + PROFILE, path.join(PKG, 'dist/electron-main.js')], { cwd: PKG, stdio: ['ignore', 'ignore', 'ignore'], env });
let c = null;
try {
  let up = false;
  for (let i = 0; i < 80 && !up; i++) {
    try { up = (await fetch(`http://127.0.0.1:${PORT}/json`, { signal: AbortSignal.timeout(800) })).ok; } catch { /* wait */ }
    if (!up) await sleep(250);
  }
  jian('主窗口真进程起得来（临时 profile，带 CDP）', up);
  if (up) {
    c = await attach(PORT, { biaoQian: 'r62-ui', callTimeout: 20000 });
    await c.send('Runtime.enable');
    await sleep(4500);
    const pageInfo = await c.evaluate(`location.href + '|' + document.title + '|' + String(document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 80)`);
    console.log('  · 当前页面: ' + String(pageInfo).slice(0, 180));
    let hwnd = '';
    for (let i = 0; i < 30 && !/^\d+$/.test(hwnd); i++) { hwnd = ps(['find', child.pid]); if (!/^\d+$/.test(hwnd)) await sleep(300); }
    jian('找到主窗口的可见原生句柄', /^\d+$/.test(hwnd), hwnd);
    const work = ps(['work']).split(',').map(Number);
    jian('拿到屏幕工作区', work.length === 4 && work.every((x) => Number.isFinite(x)), JSON.stringify(work));
    const [wx, wy] = work;
    const dpi = Number(ps(['dpi', 0, hwnd])) || 96;
    const scale = Math.max(1, dpi / 96);
    const near = Math.round(6 * scale), far = Math.round(120 * scale), hgt = Math.round(700 * scale);
    const rect = () => ps(['rect', 0, hwnd]).split(',').map(Number);
    /** 先关一次再开，确认 IPC 返回值与默认状态都可读 */
    const off0 = await c.evaluate(`window.warmy.zhuXiFu(false)`);
    jian('吸附开关可读可写（关）', off0 && off0.ok === true && off0.on === false, JSON.stringify(off0));
    const stOff = await c.evaluate(`window.warmy.settingsGet()`);
    jian('关闭吸附会落盘（zhuXiFuKai=false）', stOff && stOff.settings && stOff.settings.zhuXiFuKai === false, JSON.stringify(stOff && stOff.settings && stOff.settings.zhuXiFuKai));

    /** 每次贴边测试前先挪到远处：SetWindowPos 到同一坐标不会再发 move 事件，会把"没触发"误判成"没吸附" */
    ps(['move', 0, hwnd, wx + far, wy + far, 900, hgt]);
    await sleep(500);
    ps(['move', 0, hwnd, wx + near, wy + far, 900, hgt]);
    await sleep(650);
    const rOff = rect();
    jian('关闭吸附后靠近边缘不贴边', jin(rOff[0], wx + near, 3), JSON.stringify({ want: wx + near, got: rOff, scale }));

    const on0 = await c.evaluate(`window.warmy.zhuXiFu(true)`);
    jian('吸附开关可读可写（开）', on0 && on0.ok === true && on0.on === true, JSON.stringify(on0));
    const stOn = await c.evaluate(`window.warmy.settingsGet()`);
    jian('开启吸附会落盘（zhuXiFuKai=true）', stOn && stOn.settings && stOn.settings.zhuXiFuKai === true, JSON.stringify(stOn && stOn.settings && stOn.settings.zhuXiFuKai));

    ps(['move', 0, hwnd, wx + far, wy + far, 900, hgt]);
    await sleep(500);
    ps(['move', 0, hwnd, wx + near, wy + far, 900, hgt]);
    await sleep(650);
    const rOn = rect();
    jian('开启吸附后靠近左边缘真的贴到工作区左边', jin(rOn[0], wx, 3), JSON.stringify({ want: wx, got: rOn, scale }));

    ps(['move', 0, hwnd, wx + far, wy + far, 900, hgt]);
    await sleep(500);
    ps(['move', 0, hwnd, wx + far, wy + near, 900, hgt]);
    await sleep(650);
    const rTop = rect();
    jian('靠近上边缘也会贴上边（离得远的那条边不动）', jin(rTop[1], wy, 3) && jin(rTop[0], wx + far, 3), JSON.stringify({ want: [wx + far, wy], got: rTop, scale }));

    ps(['move', 0, hwnd, wx + far, wy + far, 900, hgt]);
    await sleep(650);
    const rFar = rect();
    jian('离开边缘不误贴', jin(rFar[0], wx + far, 3) && jin(rFar[1], wy + far, 3), JSON.stringify({ want: [wx + far, wy + far], got: rFar }));
  }
} finally {
  try { c?.close(); } catch { /* noop */ }
  try { child.kill(); } catch { /* noop */ }
  await sleep(900);
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch { /* noop */ }
}

console.log(`==== verify-r62-ui: ${okN} ok / ${failN} FAIL ====`);
process.exit(failN ? 1 : 0);
