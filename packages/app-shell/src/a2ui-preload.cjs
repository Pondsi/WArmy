/* R308⑨：A2UI 互动窗口专用最小宿主桥——只暴露按钮动作回传，不给任何文件/系统能力。 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('warmyA2ui', {
  action: (p) => ipcRenderer.invoke('warmy:a2uiAction', p),
});