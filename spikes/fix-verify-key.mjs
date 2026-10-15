import fs from 'node:fs';
const p = 'verify-round18.mjs';
let s = fs.readFileSync(p, 'utf8');
const needle = "fs.writeFileSync(path.join(DATA, 'settings.json'), JSON.stringify(s, null, 2), 'utf8');";
const add = needle + `
// 注入 MiMo Key 到安全存储（plain 条目，load() 可读）
try {
  fs.mkdirSync(path.join(DATA, 'secure'), { recursive: true });
  fs.writeFileSync(path.join(DATA, 'secure', 'keys.enc.json'), JSON.stringify({
    'mimo-r18': { v: 2, protector: 'plain', data: Buffer.from(key, 'utf8').toString('base64') },
  }), 'utf8');
} catch (e) { console.error('key inject', e); }`;
const n = s.split(needle).length - 1;
console.log('hits', n);
if (n === 1) {
  s = s.replace(needle, add);
  fs.writeFileSync(p, s, 'utf8');
  console.log('verify injects key');
}
