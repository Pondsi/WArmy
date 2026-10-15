import fs from 'node:fs';
const p = 'packages/app-shell/src/electron-main.ts';
let s = fs.readFileSync(p, 'utf8');
s = s.replace(
  '    return dir ? (dir + \'/\' + base) : base;\n  });',
  '    return dir ? (dir + \'/\' + base) : String(base || m);\n  });'
);
fs.writeFileSync(p, s, 'utf8');
console.log('return type fixed');
