import fs from 'node:fs';
const p = 'packages/app-shell/src/renderer/app.js';
let s = fs.readFileSync(p, 'utf8');
const oldS = `  function consoleAppend(Shi) {
    try {
      const seq = Number(Shi && Shi.seq);
      if (Number.isFinite(seq) && seq > 0) {
        if (seq <= consoleLastSeq) return null; // 重复投递：同一 seq 只显示一次
        consoleLastSeq = seq;
      }
      const Hang = consoleLineText(Shi);
      if (!Hang) return null;`;
const newS = `  function consoleAppend(Shi) {
    try {
      const seq = Number(Shi && Shi.seq);
      if (Number.isFinite(seq) && seq > 0) {
        if (seq <= consoleLastSeq) return null; // 重复投递：同一 seq 只显示一次
        consoleLastSeq = seq;
      }
      // 任何工具/系统动作都算「有行动」⇒ 刷新动态小字「最近更新」
      try {
        const cat = String((Shi && Shi.cat) || '');
        const code = String((Shi && Shi.code) || '');
        if (cat === 'tool' || cat === 'model' || /^tool\\./.test(code) || /^model\\./.test(code)) {
          window.__chuoYunXingZuiXin?.();
        }
      } catch { /* noop */ }
      const Hang = consoleLineText(Shi);
      if (!Hang) return null;`;
const n = s.split(oldS).length - 1;
console.log('hits', n);
if (n !== 1) process.exit(1);
s = s.replace(oldS, newS);
fs.writeFileSync(p, s, 'utf8');
console.log('tool activity updates time');
