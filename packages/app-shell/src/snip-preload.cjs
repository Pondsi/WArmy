const { contextBridge, ipcRenderer } = require('electron');
// 必须走 invoke：主进程 chuliIpc 注册在 ipcMain.handle 上，send() 没人收（真事故：点确定/取消毫无反应）
contextBridge.exposeInMainWorld('warmySnipDone', (q) => {
  try { return ipcRenderer.invoke('warmy:jieTuXuanQu', q); } catch { return null; }
});
