const fs = require('node:fs');
const base = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/';

// preload
const p = base + 'app-shell/src/preload.cjs';
let s = fs.readFileSync(p, 'utf8');
if (!s.includes('auditLog')) {
  const anchor = "  autoUpdateCheck: () => ipcRenderer.invoke('warmy:ziDongGengXinJianCha'),";
  s = s.replace(anchor, `${anchor}
  auditLog: (limit) => ipcRenderer.invoke('warmy:shenJiRiZhi', limit),
  auditClear: () => ipcRenderer.invoke('warmy:shenJiQingChu'),
  secureKeySave: (payload) => ipcRenderer.invoke('warmy:anQuanMiYaoBaoCun', payload),
  secureKeyLoad: (id) => ipcRenderer.invoke('warmy:anQuanMiYaoJiaZai', id),
  archiveExternal: (payload) => ipcRenderer.invoke('warmy:guiDangWaiBu', payload),
  archiveList: (groupId) => ipcRenderer.invoke('warmy:guiDangLieBiao', groupId),
  cleanupRun: (opts) => ipcRenderer.invoke('warmy:qingLiYunXing', opts),
  roleModelsSet: (roles) => ipcRenderer.invoke('warmy:jueSeMoXingJiSheZhi', roles),
  roleModelsGet: () => ipcRenderer.invoke('warmy:jueSeMoXingJiQu'),
  groupDissolve: (groupId) => ipcRenderer.invoke('warmy:qunJieSan', groupId),
  exportAllowlist: () => ipcRenderer.invoke('warmy:daoChuYunXuMingDan'),`);
  fs.writeFileSync(p, s);
  console.log('preload ok');
}

// memory-os exports
const mp = base + 'memory-os/src/index.ts';
let ms = fs.readFileSync(mp, 'utf8');
if (!ms.includes('migrate')) {
  ms += '\nexport * from "./migrate.js";\nexport * from "./lock.js";\nexport * from "./vectors.js";\n';
  fs.writeFileSync(mp, ms);
  console.log('memory-os exports added');
}
