const fs = require('node:fs');
const base = 'C:/Users/p/.openclaw/workspace/大龙虾互动区/CCArmy/packages/';

// preload
const p = base + 'app-shell/src/preload.cjs';
let s = fs.readFileSync(p, 'utf8');
if (!s.includes('auditLog')) {
  const anchor = "  autoUpdateCheck: () => ipcRenderer.invoke('ccarmy:auto-update-check'),";
  s = s.replace(anchor, `${anchor}
  auditLog: (limit) => ipcRenderer.invoke('ccarmy:audit-log', limit),
  auditClear: () => ipcRenderer.invoke('ccarmy:audit-clear'),
  secureKeySave: (payload) => ipcRenderer.invoke('ccarmy:secure-key-save', payload),
  secureKeyLoad: (id) => ipcRenderer.invoke('ccarmy:secure-key-load', id),
  archiveExternal: (payload) => ipcRenderer.invoke('ccarmy:archive-external', payload),
  archiveList: (groupId) => ipcRenderer.invoke('ccarmy:archive-list', groupId),
  cleanupRun: (opts) => ipcRenderer.invoke('ccarmy:cleanup-run', opts),
  roleModelsSet: (roles) => ipcRenderer.invoke('ccarmy:role-models-set', roles),
  roleModelsGet: () => ipcRenderer.invoke('ccarmy:role-models-get'),
  groupDissolve: (groupId) => ipcRenderer.invoke('ccarmy:group-dissolve', groupId),
  exportAllowlist: () => ipcRenderer.invoke('ccarmy:export-allowlist'),`);
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
