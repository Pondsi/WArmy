import fs from 'node:fs';
const p = 'packages/app-shell/src/electron-main.ts';
const lines = fs.readFileSync(p, 'utf8').split('\n');
// 0-based 2216-2230 area: fix map closing and skip save when empty
// line 2216 (1-based) = if (gongJuMing === 'plan_update') {
// 2217-2221 empty check
// 2222 const bu = stepsRaw.map((x) => {
// 2230 }) : [];
const idx = lines.findIndex((l) => l.includes("const bu = stepsRaw.map((x) => {"));
console.log('bu map at', idx + 1, lines[idx]);
// find the bad close
let end = -1;
for (let i = idx; i < idx + 20; i++) {
  if (lines[i].includes('}) : [];')) { end = i; break; }
}
console.log('end at', end + 1, lines[end]);
if (idx < 0 || end < 0) process.exit(1);
// replace the map block ending and add skip when empty
lines[end] = '              });';
// After empty check (2218-2221), make it skip the rest - wrap by early else
// Simpler: if empty, don't run map/save - change empty check to assign bu=[]
const emptyStart = lines.findIndex((l) => l.includes('const stepsRaw = Array.isArray(argsH.steps)'));
console.log('stepsRaw at', emptyStart + 1);
// Replace empty-check block to use continue-style: set bu=[] and skip save
const neu = [
  '              const stepsRaw = Array.isArray(argsH.steps) ? argsH.steps : [];',
  '              if (!stepsRaw.length) {',
  '                okH = false;',
  '                huiBaoH = \'[plan_update] 参数为空（steps 必填）。请重新调用并给出步骤数组，例如 {"steps":[{"id":"T1","title":"生成文件","status":"pending"},{"id":"T2","title":"确认完成","status":"pending"}]}。计划卡片需要真实步骤才能显示。\';',
  '              } else {',
  '              const bu = stepsRaw.map((x) => {',
];
// find old empty check through const bu line
const buLine = lines.findIndex((l) => l.includes('const bu = stepsRaw.map((x) => {'));
// emptyStart .. buLine inclusive
lines.splice(emptyStart, buLine - emptyStart + 1, ...neu);
// Now need to close the else after heBing save - find jiHuaBaoCun and the huiBaoH after it
const saveIdx = lines.findIndex((l) => l.includes('jiHuaBaoCun(sessionId, heBing);'));
console.log('save at', saveIdx + 1);
// after huiBaoH = `[plan_update] 已更新计划...` add closing brace
const huiIdx = lines.findIndex((l, i) => i > saveIdx && l.includes('已更新计划'));
console.log('huiBaoH at', huiIdx + 1, lines[huiIdx]);
lines.splice(huiIdx + 1, 0, '              }');
fs.writeFileSync(p, lines.join('\n'), 'utf8');
console.log('plan_update block fixed');
