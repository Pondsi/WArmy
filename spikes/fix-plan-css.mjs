import fs from 'node:fs';
const p = 'packages/app-shell/src/renderer/app.css';
let s = fs.readFileSync(p, 'utf8');
const oldS = `.jiHuaBu { margin: 6px 0; padding-left: 8px; border-left: 2px solid var(--line); }`;
const idx = s.indexOf(oldS);
console.log('idx', idx);
// find the block of jiHuaBu rules and replace
const blockOld = s.slice(idx, idx + 600);
console.log(JSON.stringify(blockOld.slice(0, 400)));
const blockNew = `.jiHuaBu { margin: 6px 0; padding-left: 8px; border-left: 2px solid transparent; }
.jiHuaBu[data-st="pending"] { border-left-color: var(--accent); }
.jiHuaBu[data-st="doing"] { border-left-color: var(--accent); }
.jiHuaBu[data-st="done"] { border-left-color: transparent; }
.jiHuaBu[data-st="verified"] { border-left-color: transparent; }
.jiHuaBu[data-st="blocked"] { border-left-color: transparent; text-decoration: line-through; opacity: .72; }`;
// replace from .jiHuaBu { through the blocked rule
const re = /\.jiHuaBu \{ margin: 6px 0; padding-left: 8px; border-left: 2px solid var\(--line\); \}[\s\S]{0,400}?\.jiHuaBu\[data-st="blocked"\] \{[^}]*\}/;
if (re.test(s)) {
  s = s.replace(re, blockNew);
  fs.writeFileSync(p, s, 'utf8');
  console.log('plan bar css updated');
} else {
  console.log('regex fail');
}
