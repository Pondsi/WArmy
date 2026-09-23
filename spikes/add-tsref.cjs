const fs = require('node:fs');
const p = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/tsconfig.json';
let s = fs.readFileSync(p, 'utf8');
if (!s.includes('asset-governance')) {
  s = s.replace('"path": "../sync-protocol"', '"path": "../sync-protocol",\n    { "path": "../asset-governance" }');
  fs.writeFileSync(p, s);
  console.log('tsconfig ref added');
} else {
  console.log('already has ref');
}
console.log(s.includes('asset-governance'));
