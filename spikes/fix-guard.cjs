const fs = require('node:fs');
const p = 'C:/Users/<user>/workspace/<repo>/WArmy/spikes/model-bind.cjs';
let s = fs.readFileSync(p, 'utf8');
s = s.replace("if (j.includes('iDefaultMoXing')) {", "if (j.includes('bindModelConfig')) {");
fs.writeFileSync(p, s);
console.log('guard fixed ->', s.includes('bindModelConfig'));
