const fs = require('node:fs');
const p = 'C:/Users/p/.openclaw/workspace/大龙虾互动区/WArmy/packages/app-shell/src/preload.cjs';
let s = fs.readFileSync(p, 'utf8');
if (!s.includes('executorRun')) {
  const anchor = "  winReload: () => ipcRenderer.invoke('warmy:win-reload'),";
  s = s.replace(
    anchor,
    `${anchor}
  executorRun: (task) => ipcRenderer.invoke('warmy:executor-run', task),
  executorBatch: (tasks) => ipcRenderer.invoke('warmy:executor-batch', tasks),
  assetsRetrieve: (opts) => ipcRenderer.invoke('warmy:assets-retrieve', opts),
  assetsRegister: (a) => ipcRenderer.invoke('warmy:assets-register', a),
  assetsFeedback: (id, good) => ipcRenderer.invoke('warmy:assets-feedback', id, good),
  assetsSweep: () => ipcRenderer.invoke('warmy:assets-sweep'),
  kbFromChat: (payload) => ipcRenderer.invoke('warmy:kb-from-chat', payload),`
  );
  fs.writeFileSync(p, s);
  console.log('preload updated');
} else {
  console.log('preload ok');
}
