const fs = require('node:fs');
const p = 'C:/Users/p/.openclaw/workspace/大龙虾互动区/CCArmy/packages/app-shell/src/preload.cjs';
let s = fs.readFileSync(p, 'utf8');
if (s.includes('groupOrchestrate')) {
  console.log('already');
  process.exit(0);
}
const anchor = "  winReload: () => ipcRenderer.invoke('ccarmy:win-reload'),";
const add = `${anchor}
  groupOrchestrate: (msg) => ipcRenderer.invoke('ccarmy:group-orchestrate', msg),
  requestApproval: (req) => ipcRenderer.invoke('ccarmy:request-approval', req),
  approvalRespond: (id, allowed, scope) => ipcRenderer.invoke('ccarmy:approval-respond', id, allowed, scope),
  onApprovalRequest: (cb) => ipcRenderer.on('ccarmy:approval-request', (_e, d) => cb(d)),
  checkpointAuto: (phase, logSeq) => ipcRenderer.invoke('ccarmy:checkpoint-auto', phase, logSeq),
  costSummary: () => ipcRenderer.invoke('ccarmy:cost-summary'),`;
s = s.replace(anchor, add);
fs.writeFileSync(p, s);
console.log('preload updated');
