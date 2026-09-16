/**
 * Electron preload — 白名单 API
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
  setThemeSource: (s) => ipcRenderer.invoke('ccarmy:set-theme-source', s),
  themeInfo: () => ipcRenderer.invoke('ccarmy:theme-info'),
  listModels: (cfg) => ipcRenderer.invoke('ccarmy:list-models', cfg),
  pickSound: () => ipcRenderer.invoke('ccarmy:pick-sound'),
  checkUpdate: () => ipcRenderer.invoke('ccarmy:check-update'),
  pickFile: () => ipcRenderer.invoke('ccarmy:pick-file'),
  groupCreate: (cfg) => ipcRenderer.invoke('ccarmy:group-create', cfg),
  groupMessage: (msg) => ipcRenderer.invoke('ccarmy:group-message', msg),
  groupJoinInstance: (groupId, instanceId) => ipcRenderer.invoke('ccarmy:group-join-instance', groupId, instanceId),
  boardTasks: (groupId) => ipcRenderer.invoke('ccarmy:board-tasks', groupId),
  boardEvents: () => ipcRenderer.invoke('ccarmy:board-events'),
  boardAggregate: () => ipcRenderer.invoke('ccarmy:board-aggregate'),
  setProvider: (cfg) => ipcRenderer.invoke('ccarmy:set-provider', cfg),
  getProvider: () => ipcRenderer.invoke('ccarmy:get-provider'),
  chatSend: (msg) => ipcRenderer.invoke('ccarmy:chat-send', msg),
  checkpointCreate: (phase) => ipcRenderer.invoke('ccarmy:checkpoint-create', phase),
  checkpointList: () => ipcRenderer.invoke('ccarmy:checkpoint-list'),
  checkpointRollback: (id) => ipcRenderer.invoke('ccarmy:checkpoint-rollback', id),
  knowledgeQuery: (q) => ipcRenderer.invoke('ccarmy:knowledge-query', q),
  knowledgeAddEvent: (ev) => ipcRenderer.invoke('ccarmy:knowledge-add-event', ev),
  setInsertMode: (sessionId, mode) => ipcRenderer.invoke('ccarmy:set-insert-mode', sessionId, mode),
  getInsertMode: (sessionId) => ipcRenderer.invoke('ccarmy:get-insert-mode', sessionId),
});
