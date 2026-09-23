const fs = require('node:fs');
const p = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/preload.cjs';
let s = fs.readFileSync(p, 'utf8');
if (!s.includes('executorRun')) {
  const anchor = "  winReload: () => ipcRenderer.invoke('warmy:winChongXinJiaZai'),";
  s = s.replace(
    anchor,
    `${anchor}
  executorRun: (task) => ipcRenderer.invoke('warmy:zhiXingQiYunXing', task),
  executorBatch: (tasks) => ipcRenderer.invoke('warmy:zhiXingQiPiLiang', tasks),
  assetsRetrieve: (opts) => ipcRenderer.invoke('warmy:ziChanJiJianSuo', opts),
  assetsRegister: (a) => ipcRenderer.invoke('warmy:ziChanJiZhuCe', a),
  assetsFeedback: (id, good) => ipcRenderer.invoke('warmy:ziChanJiFeedback', id, good),
  assetsSweep: () => ipcRenderer.invoke('warmy:ziChanJiSweep'),
  kbFromChat: (payload) => ipcRenderer.invoke('warmy:zhiShiKuCongLiaoTian', payload),`
  );
  fs.writeFileSync(p, s);
  console.log('preload updated');
} else {
  console.log('preload ok');
}
