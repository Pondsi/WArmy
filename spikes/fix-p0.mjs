import fs from 'node:fs';
const p = 'packages/app-shell/src/electron-main.ts';
let s = fs.readFileSync(p, 'utf8');
s = s.replace(
  "      const p0 = m ? m[1] : '';",
  "      const p0 = (m && m[1]) || '';"
);
fs.writeFileSync(p, s, 'utf8');
console.log('p0 fixed');
