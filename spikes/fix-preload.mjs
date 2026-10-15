import fs from 'node:fs';
const p = 'packages/app-shell/src/preload.cjs';
let s = fs.readFileSync(p, 'utf8');
const oldS = "  xianShiWenJianJia: (p) => ipcRenderer.invoke('warmy:xianShiWenJianJia', p),";
const newS = oldS + "\n  copyFileToClipboard: (p) => ipcRenderer.invoke('warmy:copyFileToClipboard', p),";
const n = s.split(oldS).length - 1;
console.log('hits', n);
if (n === 1) {
  s = s.replace(oldS, newS);
  fs.writeFileSync(p, s, 'utf8');
  console.log('preload ok');
}
