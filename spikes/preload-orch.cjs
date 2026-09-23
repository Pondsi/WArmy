const fs = require('node:fs');
const p = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/preload.cjs';
let s = fs.readFileSync(p, 'utf8');
if (s.includes('groupOrchestrate')) {
  console.log('already');
  process.exit(0);
}
const anchor = "  winReload: () => ipcRenderer.invoke('warmy:winChongXinJiaZai'),";
const add = `${anchor}
  groupOrchestrate: (xiaoXi) => ipcRenderer.invoke('warmy:qunXieTiao', xiaoXi),
  requestApproval: (req) => ipcRenderer.invoke('warmy:qingQiuPiZhun', req),
  approvalRespond: (id, allowed, scope) => ipcRenderer.invoke('warmy:piZhunHuiYing', id, allowed, scope),
  onApprovalRequest: (cb) => ipcRenderer.on('warmy:piZhunQingQiu', (_e, d) => cb(d)),
  checkpointAuto: (phase, logSeq) => ipcRenderer.invoke('warmy:checkpointZiDong', phase, logSeq),
  costSummary: () => ipcRenderer.invoke('warmy:chengBenZhaiYao'),`;
s = s.replace(anchor, add);
fs.writeFileSync(p, s);
console.log('preload updated');
