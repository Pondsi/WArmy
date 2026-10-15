import fs from 'node:fs';
const p = 'packages/providers/src/ollama.ts';
let s = fs.readFileSync(p, 'utf8');
const oldS = '        }) as Array<Record<string, unknown>>,';
const newS = '        }) as Array<Record<string, unknown>>),';
const n = s.split(oldS).length - 1;
console.log('hits', n);
if (n === 1) {
  s = s.replace(oldS, newS);
  fs.writeFileSync(p, s, 'utf8');
  console.log('fixed paren');
}
