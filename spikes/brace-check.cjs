const fs = require('node:fs');
const p = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/renderer/yingYong.js';
const src = fs.readFileSync(p, 'utf8');
// 简化：跟踪 {} 深度（忽略字符串/注释/模板不便，用近似扫描）
let depth = 0;
let line = 1;
let inS = null;
let i = 0;
let prev = '';
const problems = [];
while (i < src.length) {
  const c = src[i];
  const n = src[i + 1];
  if (c === '\n') line++;
  if (inS) {
    if (c === '\\') { i += 2; continue; }
    if (c === inS) inS = null;
    i++;
    continue;
  }
  if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
  if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; } i += 2; continue; }
  if (c === '"' || c === "'" || c === '`') { inS = c; i++; continue; }
  if (c === '{') depth++;
  if (c === '}') { depth--; if (depth < 0) { problems.push(line); depth = 0; } }
  i++;
}
console.log('final depth', depth, 'first negative line', problems[0] || 'none');
