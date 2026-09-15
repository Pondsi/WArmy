/**
 * Electron preload — 仅暴露白名单 API + i18n
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ccarmy', {
  hardware: () => ipcRenderer.invoke('ccarmy:hardware'),
  listInstances: () => ipcRenderer.invoke('ccarmy:list-instances'),
  spawnInstance: (cfg) => ipcRenderer.invoke('ccarmy:spawn-instance', cfg),
  stopInstance: (id) => ipcRenderer.invoke('ccarmy:stop-instance', id),
  securityMode: () => ipcRenderer.invoke('ccarmy:security-mode'),
  setSecurityMode: (mode) => ipcRenderer.invoke('ccarmy:set-security-mode', mode),
  memoryRecall: (q) => ipcRenderer.invoke('ccarmy:memory-recall', q),
  memoryAppend: (body) => ipcRenderer.invoke('ccarmy:memory-append', body),
  i18n: (locale) => ipcRenderer.invoke('ccarmy:i18n', locale),
  localeInfo: () => ipcRenderer.invoke('ccarmy:locale-info'),
});
