/**
 * R136+：被控端三件套 —— 强制亮屏 + 水印层（含屏幕查看状态）+ 不可隐藏可拖动停止按钮。
 *
 * 产品口径（用户拍板）：
 *  · 强制亮屏：控制开始唤醒显示器，控制期间不息屏；
 *  · 水印层：置顶全屏，多行平铺「正在被远程控制 · 对方设备名 · 起始时间」；
 *    另有状态角标：**对方是否正在查看屏幕内容**（对方开了查看屏幕才显示）；
 *  · 停止按钮：侧边常驻、不可隐藏、鼠标可拖动换位置；点击弹窗
 *    「终止本次远程控制，始终拒绝该设备再次控制本机」——确认 = ①立即断会话 ②该设备永久拒绝。
 *
 * 实现：frameless + alwaysOnTop + 透明全屏 BrowserWindow；窗口整体 setIgnoreMouseEvents
 * （点击穿透，不影响被控方用电脑），仅按钮热区内由渲染层 toggle 鼠标事件（可点可拖）。
 * 亮屏走 Electron powerSaveBlocker('prevent-display-sleep')。
 */
import { BrowserWindow, powerSaveBlocker, screen } from 'electron';
import path from 'node:path';

export interface SanJianTaoCanShu {
  /** 对方设备显示名 */
  duiFangMing: string;
  /** 会话起始时间（ms） */
  kaiShi: number;
  /** 点击「停止并拒绝」确认后的回调（主进程负责断会话 + 永久拒绝） */
  onTingZhi: (opts: { yongJiuJuJue: boolean }) => void;
  /** 点击「仅停止」（弹窗里的取消/仅终止） */
  onJinTingZhi?: () => void;
  /** 渲染层就绪（注入初始状态） */
  preloadFile?: string;
}

export class BeiKongSanJianTao {
  private win: BrowserWindow | null = null;
  private blockerId: number | null = null;
  private canShu: SanJianTaoCanShu | null = null;
  private kaiShi = 0;

  get visible(): boolean {
    return !!this.win && !this.win.isDestroyed();
  }

  /** 控制会话开始：亮屏 + 水印 + 停止按钮 */
  kaiQi(p: SanJianTaoCanShu): void {
    if (this.win && !this.win.isDestroyed()) this.guanBi();
    this.canShu = p;
    this.kaiShi = p.kaiShi || Date.now();
    // 强制亮屏：阻止息屏（显示器保持唤醒）
    try {
      if (this.blockerId === null || !powerSaveBlocker.isStarted(this.blockerId)) {
        this.blockerId = powerSaveBlocker.start('prevent-display-sleep');
      }
    } catch { /* 平台不支持时忽略 */ }
    const wa = screen.getPrimaryDisplay().workArea;
    const win = new BrowserWindow({
      x: wa.x, y: wa.y, width: wa.width, height: wa.height,
      frame: false, transparent: true, resizable: false, movable: false,
      minimizable: false, maximizable: false, fullscreenable: false,
      skipTaskbar: true, alwaysOnTop: true, hasShadow: false,
      focusable: true, show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: p.preloadFile || path.join(__dirname, 'rc-overlay-preload.cjs'),
      },
    });
    // 最高层级置顶（macOS 用屏保层级；Windows 用 floating）
    try { win.setAlwaysOnTop(true, process.platform === 'darwin' ? 'screen-saver' : 'floating'); } catch { win.setAlwaysOnTop(true); }
    try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch { /* win/linux */ }
    this.win = win;
    const kaiShiStr = new Date(this.kaiShi).toLocaleString('zh-CN', { hour12: false });
    const html = this.shengChengHtml(p.duiFangMing, kaiShiStr);
    void win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    win.once('ready-to-show', () => win.show());
    win.on('closed', () => {
      this.win = null;
      // 窗口被系统/用户关掉也停亮屏；会话终止由调用方（主进程）负责
      this.tingLiangPing();
    });
    // 渲染层消息：穿透切换 / 停止按钮 / 弹窗
    win.webContents.on('ipc-message', (_e, ch, ...args) => {
      const a = args[0] as { yongJiuJuJue?: boolean } | undefined;
      if (ch === 'rc-tingzhi') {
        // 弹窗确认：终止 + 始终拒绝
        this.canShu?.onTingZhi({ yongJiuJuJue: true });
        this.guanBi();
      } else if (ch === 'rc-jin-tingzhi') {
        // 仅终止本次
        this.canShu?.onJinTingZhi?.();
        this.guanBi();
      } else if (ch === 'rc-chuantou' && a && typeof a === 'object') {
        // 按钮热区悬停/离开：切换点击穿透
        const tong = !(a as { on?: boolean }).on;
        try { win.setIgnoreMouseEvents(tong, { forward: true }); } catch { /* noop */ }
      }
    });
    // 初始点击穿透（按钮热区会临时打开）
    try { win.setIgnoreMouseEvents(true, { forward: true }); } catch { /* noop */ }
  }

  /** 更新「对方正在查看屏幕」状态（水印角标） */
  shePingMuZhuangTai(on: boolean, wenAn?: string): void {
    if (!this.win || this.win.isDestroyed()) return;
    const txt = on
      ? (wenAn || '对方正在查看屏幕内容')
      : '';
    try {
      this.win.webContents.executeJavaScript(
        `window.__rcSetScreenView && window.__rcSetScreenView(${JSON.stringify(txt)});`,
      ).catch(() => { /* noop */ });
    } catch { /* noop */ }
  }

  /** 会话结束：关窗 + 停止亮屏 */
  guanBi(): void {
    if (this.win && !this.win.isDestroyed()) {
      try { this.win.destroy(); } catch { /* noop */ }
    }
    this.win = null;
    this.tingLiangPing();
    this.canShu = null;
  }

  private tingLiangPing(): void {
    try {
      if (this.blockerId !== null && powerSaveBlocker.isStarted(this.blockerId)) {
        powerSaveBlocker.stop(this.blockerId);
      }
    } catch { /* noop */ }
    this.blockerId = null;
  }

  /** 水印 HTML：平铺水印 + 状态角标 + 停止按钮（可拖动）+ 确认弹窗 */
  private shengChengHtml(duiFangMing: string, kaiShiStr: string): string {
    const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c);
    return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>remote-control-overlay</title>
<style>
  html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:transparent;
    font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;user-select:none;cursor:default;}
  #wm{position:fixed;inset:0;pointer-events:none;overflow:hidden;}
  .wmline{position:absolute;white-space:nowrap;color:rgba(220,38,38,0.13);font-weight:600;
    transform:rotate(-24deg);font-size:22px;letter-spacing:2px;}
  #badge{position:fixed;top:18px;left:50%;transform:translateX(-50%);pointer-events:none;
    background:rgba(220,38,38,0.92);color:#fff;padding:10px 22px;border-radius:10px;
    font-size:15px;font-weight:600;box-shadow:0 4px 18px rgba(0,0,0,.28);display:none;}
  #badge .sub{font-size:12px;font-weight:400;opacity:.92;margin-top:3px;}
  #sv{margin-top:6px;font-size:13px;font-weight:700;background:rgba(255,255,255,.2);
    border-radius:6px;padding:3px 10px;display:none;}
  /* 停止按钮：右侧边，可拖动（-webkit-app-region 在热区内手动控制） */
  #stop{position:fixed;right:18px;top:50%;transform:translateY(-50%);width:64px;height:64px;
    border-radius:50%;background:rgba(220,38,38,0.95);color:#fff;border:3px solid rgba(255,255,255,.85);
    font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;
    box-shadow:0 6px 22px rgba(0,0,0,.35);z-index:50;}
  #stop:hover{background:#b91c1c;}
  /* 弹窗 */
  #mask{position:fixed;inset:0;background:rgba(0,0,0,.45);display:none;z-index:90;}
  #dlg{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:420px;max-width:88vw;
    background:#fff;border-radius:14px;padding:22px 24px;display:none;z-index:95;
    box-shadow:0 18px 60px rgba(0,0,0,.35);}
  #dlg h3{margin:0 0 10px;font-size:17px;color:#111;}
  #dlg p{margin:0 0 18px;font-size:14px;color:#444;line-height:1.7;}
  #dlg .btns{display:flex;gap:10px;justify-content:flex-end;}
  #dlg button{border:0;border-radius:8px;padding:9px 18px;font-size:14px;cursor:pointer;}
  #bStopAll{background:#dc2626;color:#fff;}
  #bStopOnce{background:#e5e7eb;color:#111;}
  #bCancel{background:transparent;color:#666;}
</style>
</head>
<body>
<div id="wm"></div>
<div id="badge">
  <div>正在被远程控制 · ${esc(duiFangMing)} · ${esc(kaiShiStr)}</div>
  <div class="sub">无限牛马 · 远程控制中（对方已获授权）</div>
  <div id="sv"></div>
</div>
<div id="stop">停止</div>
<div id="mask"></div>
<div id="dlg">
  <h3>终止远程控制</h3>
  <p>终止本次远程控制，并<strong>始终拒绝该设备再次控制本机</strong>？<br>
  确认后：① 立即断开本次会话；② 该设备的「可被远程控制 / 信任」勾选将被清除，并加入永久拒绝名单（可在设置中移除）。</p>
  <div class="btns">
    <button id="bCancel">取消</button>
    <button id="bStopOnce">仅终止本次</button>
    <button id="bStopAll">终止并始终拒绝</button>
  </div>
</div>
<script>
  // 平铺水印
  const wm = document.getElementById('wm');
  const text = '正在被远程控制 · ' + ${JSON.stringify(duiFangMing)};
  for (let y = -40; y < innerHeight + 80; y += 150) {
    for (let x = -120; x < innerWidth + 240; x += 520) {
      const d = document.createElement('div');
      d.className = 'wmline';
      d.style.left = x + 'px';
      d.style.top = y + 'px';
      d.textContent = text;
      wm.appendChild(d);
    }
  }
  // 屏幕查看状态
  window.__rcSetScreenView = function (txt) {
    const sv = document.getElementById('sv');
    if (txt) { sv.textContent = txt; sv.style.display = 'block'; }
    else { sv.style.display = 'none'; }
  };
  // 点击穿透切换（热区内可点可拖）
  const stop = document.getElementById('stop');
  function chuantou(on) {
    try { window.warmyRc && window.warmyRc.chuantou && window.warmyRc.chuantou(on); } catch (e) {}
  }
  stop.addEventListener('mouseenter', () => chuantou(true));
  stop.addEventListener('mouseleave', () => chuantou(false));
  // 拖动（在按钮上按住移动）
  let dragging = false, ox = 0, oy = 0;
  stop.addEventListener('mousedown', (e) => {
    dragging = true;
    ox = e.clientX - stop.getBoundingClientRect().left;
    oy = e.clientY - stop.getBoundingClientRect().top;
    e.preventDefault();
  });
  addEventListener('mousemove', (e) => {
    if (!dragging) return;
    stop.style.right = 'auto';
    stop.style.left = Math.max(0, Math.min(innerWidth - 64, e.clientX - ox)) + 'px';
    stop.style.top = Math.max(0, Math.min(innerHeight - 64, e.clientY - oy)) + 'px';
    stop.style.transform = 'none';
  });
  addEventListener('mouseup', () => { dragging = false; });
  // 点击 → 弹窗
  stop.addEventListener('click', () => {
    if (dragging) return;
    document.getElementById('mask').style.display = 'block';
    document.getElementById('dlg').style.display = 'block';
    chuantou(true); // 弹窗期间可交互
  });
  document.getElementById('bCancel').addEventListener('click', () => {
    document.getElementById('mask').style.display = 'none';
    document.getElementById('dlg').style.display = 'none';
    chuantou(false);
  });
  document.getElementById('bStopOnce').addEventListener('click', () => {
    try { window.warmyRc && window.warmyRc.jinTingzhi && window.warmyRc.jinTingzhi(); } catch (e) {}
  });
  document.getElementById('bStopAll').addEventListener('click', () => {
    try { window.warmyRc && window.warmyRc.tingzhi && window.warmyRc.tingzhi(); } catch (e) {}
  });
</script>
</body>
</html>`;
  }
}
