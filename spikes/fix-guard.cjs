const fs = require('node:fs');
const p = 'C:/Users/p/.openclaw/workspace/大龙虾互动区/CCArmy/spikes/model-bind.cjs';
let s = fs.readFileSync(p, 'utf8');
s = s.replace("if (j.includes('i-default-model')) {", "if (j.includes('bindModelConfig')) {");
fs.writeFileSync(p, s);
console.log('guard fixed ->', s.includes('bindModelConfig'));
