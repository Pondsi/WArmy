import fs from 'node:fs';
const p = 'verify-round18d.mjs';
let s = fs.readFileSync(p, 'utf8');
s = s.replace('for (let i = 0; i < 50; i++)', 'for (let i = 0; i < 100; i++)');
s = s.replace(
  `    if (au0.some((x) => x.op === 'chat.tools.done') && writes.length > 0 && i > 8) break;`,
  `    // 等真实收尾：tools.done 且有写盘；或到上限
    if (au0.some((x) => x.op === 'chat.tools.done') && (writes.length > 0 || au0.some((x) => x.op === 'plan.auto-continue')) && i > 5) break;
    if (au0.some((x) => x.op === 'chat.tools.done') && i > 20) break;`
);
fs.writeFileSync(p, s, 'utf8');
console.log('wait extended');
