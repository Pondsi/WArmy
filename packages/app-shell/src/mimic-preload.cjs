// 拟态（桌宠）窗口的 preload：只暴露最小必要面
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('warmyMimic', {
  dragStart: (p) => ipcRenderer.send('warmy:mimicDragStart', p),
  dragMove: (p) => ipcRenderer.send('warmy:mimicDragMove', p),
  dragEnd: () => ipcRenderer.send('warmy:mimicDragEnd'),
  setClickThrough: (on) => ipcRenderer.send('warmy:mimicClickThrough', !!on),
  openChat: () => ipcRenderer.send('warmy:mimicOpenChat'),
  onSay: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('warmy:mimicSay', h); return () => ipcRenderer.removeListener('warmy:mimicSay', h); },
  onDot: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('warmy:mimicDot', h); return () => ipcRenderer.removeListener('warmy:mimicDot', h); },
  onSetTi: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('warmy:mimicSetTi', h); return () => ipcRenderer.removeListener('warmy:mimicSetTi', h); },
});
