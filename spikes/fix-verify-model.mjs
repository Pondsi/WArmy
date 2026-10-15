import fs from 'node:fs';
const p = 'verify-round18.mjs';
let s = fs.readFileSync(p, 'utf8');
// default model → mimo flash (tool-calling reliable); keep ollama configured
s = s.replace(
  "const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'huihui_ai/qwen3-vl-abliterated:4b';",
  "const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'huihui_ai/qwen3-vl-abliterated:4b';\nconst CHAT_MODEL = process.env.CHAT_MODEL || 'mimo-v2.6-flash';"
);
// instance default/chain put mimo first
s = s.replace(
  "defaultModel: `Ollama(r18) · ${OLLAMA_MODEL}`, currentModel: '',",
  "defaultModel: 'MiMo(r18) · mimo-v2.6-flash', currentModel: '',"
);
s = s.replace(
  "chain: [`Ollama(r18) · ${OLLAMA_MODEL}`, 'MiMo(r18) · mimo-v2.6-flash'],",
  "chain: ['MiMo(r18) · mimo-v2.6-flash', `Ollama(r18) · ${OLLAMA_MODEL}`],"
);
s = s.replace(
  "chatChain: [`Ollama(r18) · ${OLLAMA_MODEL}`, 'MiMo(r18) · mimo-v2.6-flash'],",
  "chatChain: ['MiMo(r18) · mimo-v2.6-flash', `Ollama(r18) · ${OLLAMA_MODEL}`],"
);
s = s.replace(
  "model: `Ollama(r18) · ${OLLAMA_MODEL}`,",
  "model: 'MiMo(r18) · mimo-v2.6-flash',"
);
fs.writeFileSync(p, s, 'utf8');
console.log('verify uses mimo primary');
