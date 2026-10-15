import fs from 'node:fs';
const p = 'verify-round18b.mjs';
let s = fs.readFileSync(p, 'utf8');
const model = 'lileilei999/qwen3.5-9b-abliterated-vision:latest';
const old = `      const r = await window.warmy.chatSend({
        sessionId: chatId,`;
const neu = `      const r = await window.warmy.chatSend({
        sessionId: chatId,
        model: '${model}',`;
if (!s.includes(old)) { console.log('no match'); process.exit(1); }
s = s.replace(old, neu);
s = s.replace("const chatId = (inst && inst.id) || 'inst-r18b';", "const chatId = 'inst-r18b';");
// also add chain in moXingJueCe
s = s.replace(
  "defaultModel: (inst && inst.defaultModel) || '',",
  `defaultModel: '${model}',`
);
s = s.replace(
  'chain: (inst && inst.chain) || [],',
  `chain: ['Ollama(r18b) · ${model}'],`
);
fs.writeFileSync(p, s, 'utf8');
console.log('model injected');
