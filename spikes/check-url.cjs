const fs = require('node:fs');
const p = 'C:/Users/p/.openclaw/workspace/大龙虾互动区/WArmy/packages/app-shell/src/renderer/app.js';
let j = fs.readFileSync(p, 'utf8');
const i = j.indexOf('new URLSearchParams(window.location.search)');
console.log('URLSearchParams at', i);
if (i >= 0) {
  console.log('context:', JSON.stringify(j.slice(Math.max(0, i - 80), i + 200)));
}
console.log('has mode:', j.includes("q.get('mode')"));
