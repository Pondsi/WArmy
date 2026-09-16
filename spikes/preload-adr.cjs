const fs = require('node:fs');
const p = 'C:/Users/p/.openclaw/workspace/大龙虾互动区/CCArmy/packages/app-shell/src/preload.cjs';
let s = fs.readFileSync(p, 'utf8');
if (!s.includes('executorRun')) {
  const anchor = "  winReload: () => ipcRenderer.invoke('ccarmy:win-reload'),";
  s = s.replace(
    anchor,
    `${anchor}
  executorRun: (task) => ipcRenderer.invoke('ccarmy:executor-run', task),
  executorBatch: (tasks) => ipcRenderer.invoke('ccarmy:executor-batch', tasks),
  assetsRetrieve: (opts) => ipcRenderer.invoke('ccarmy:assets-retrieve', opts),
  assetsRegister: (a) => ipcRenderer.invoke('ccarmy:assets-register', a),
  assetsFeedback: (id, good) => ipcRenderer.invoke('ccarmy:assets-feedback', id, good),
  assetsSweep: () => ipcRenderer.invoke('ccarmy:assets-sweep'),
  kbFromChat: (payload) => ipcRenderer.invoke('ccarmy:kb-from-chat', payload),`
  );
  fs.writeFileSync(p, s);
  console.log('preload updated');
} else {
  console.log('preload ok');
}
