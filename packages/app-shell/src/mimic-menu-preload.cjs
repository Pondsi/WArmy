// R232：独立菜单只暴露查状态、菜单动作与关闭，不暴露录音、拖动或普通对话。
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('warmyMimicMenu', {
  zhuangTai: () => ipcRenderer.invoke('warmy:mimicCaiDanKai'),
  dongZuo: (p) => ipcRenderer.invoke('warmy:mimicCaiDanDong', p),
  guan: () => ipcRenderer.invoke('warmy:mimicCaiDanGuan'),
});
