import fs from 'node:fs';
const p = 'packages/app-shell/src/electron-main.ts';
const lines = fs.readFileSync(p, 'utf8').split('\n');
// delete leftover 11185-11191 (1-based) => index 11184-11190
console.log('before', lines[11184], '|', lines[11190]);
lines.splice(11184, 7);
console.log('after', lines[11184]);
fs.writeFileSync(p, lines.join('\n'), 'utf8');
console.log('cleaned leftover clipboard lines');
