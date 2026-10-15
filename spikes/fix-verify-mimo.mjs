import fs from 'node:fs';
const p = 'verify-round18.mjs';
let s = fs.readFileSync(p, 'utf8');
s = s.replace(
  "defaultModel: 'MiMo(r18) · mimo-v2.6-flash', currentModel: '',",
  "defaultModel: 'MiMo(r18) · mimo-v2.6-flash', currentModel: 'mimo-v2.6-flash',"
);
// also put mimo first in availableModels
s = s.replace(
  "availableModels: [`Ollama(r18) · ${OLLAMA_MODEL}`, 'MiMo(r18) · mimo-v2.6-flash'],",
  "availableModels: ['MiMo(r18) · mimo-v2.6-flash', `Ollama(r18) · ${OLLAMA_MODEL}`],"
);
fs.writeFileSync(p, s, 'utf8');
console.log('sticky mimo currentModel');
