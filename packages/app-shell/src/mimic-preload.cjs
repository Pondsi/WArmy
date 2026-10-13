// 拟态（桌宠）窗口的 preload：只暴露最小必要面
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('warmyMimic', {
  dragStart: (p) => ipcRenderer.send('warmy:mimicDragStart', p),
  dragMove: (p) => ipcRenderer.send('warmy:mimicDragMove', p),
  dragEnd: () => ipcRenderer.send('warmy:mimicDragEnd'),
  /**
   * 桌宠本体矩形（窗口内 CSS 像素）：主进程据此做**命中测试**（见 main 里的 `mimicStartHoverPoll`）。
   * 之所以要上报而不是让渲染层自己判断：Windows 上 `forward:true` 的 hover 事件不可靠
   * （electron #30808/#15376），必须由主进程用屏幕光标坐标来判。
   */
  setBodyRect: (r) => ipcRenderer.send('warmy:mimicBodyRect', r),
  openChat: () => ipcRenderer.send('warmy:mimicOpenChat'),
  onSay: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('warmy:mimicSay', h); return () => ipcRenderer.removeListener('warmy:mimicSay', h); },
  onDot: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('warmy:mimicDot', h); return () => ipcRenderer.removeListener('warmy:mimicDot', h); },
  onSetTi: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('warmy:mimicSetTi', h); return () => ipcRenderer.removeListener('warmy:mimicSetTi', h); },
  /** 主进程命中测试的结果：光标是否落在本体上（用来切悬停样式） */
  onHover: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('warmy:mimicHover', h); return () => ipcRenderer.removeListener('warmy:mimicHover', h); },
});
