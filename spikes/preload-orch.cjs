const fs = require('node:fs');
const p = 'C:/Users/p/.openclaw/workspace/大龙虾互动区/WArmy/packages/app-shell/src/preload.cjs';
let s = fs.readFileSync(p, 'utf8');
if (s.includes('groupOrchestrate')) {
  console.log('already');
  process.exit(0);
}
const anchor = "  winReload: () => ipcRenderer.invoke('warmy:win-reload'),";
const add = `${anchor}
  groupOrchestrate: (msg) => ipcRenderer.invoke('warmy:group-orchestrate', msg),
  requestApproval: (req) => ipcRenderer.invoke('warmy:request-approval', req),
  approvalRespond: (id, allowed, scope) => ipcRenderer.invoke('warmy:approval-respond', id, allowed, scope),
  onApprovalRequest: (cb) => ipcRenderer.on('warmy:approval-request', (_e, d) => cb(d)),
  checkpointAuto: (phase, logSeq) => ipcRenderer.invoke('warmy:checkpoint-auto', phase, logSeq),
  costSummary: () => ipcRenderer.invoke('warmy:cost-summary'),`;
s = s.replace(anchor, add);
fs.writeFileSync(p, s);
console.log('preload updated');
