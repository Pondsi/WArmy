import fs from 'node:fs';
const p = 'verify-round18.mjs';
let s = fs.readFileSync(p, 'utf8');
const oldS = `  const done = await ev(\`(()=>{
    const t=document.body.innerText||'';
    return t.includes('\${MARK}') && /hello-/.test(t);
  })()\`, 240000);
  ok('回复含唯一标记', !!done);`;
const newS = `  // 等真实工具完成（不要匹配用户消息里的标记）
  let done = false;
  for (let i = 0; i < 90; i++) {
    const au0 = auditSince(since);
    if (au0.some((x) => x.op === 'chat.work-tool' && x.detail && x.detail.tool === 'write_file')) { done = true; break; }
    if (au0.some((x) => x.op === 'chat.tools.done')) { done = true; break; }
    await sleep(2000);
  }
  ok('工具循环已结束或已写文件', done);`;
const n = s.split(oldS).length - 1;
console.log('hits', n);
if (n === 1) {
  s = s.replace(oldS, newS);
  fs.writeFileSync(p, s, 'utf8');
  console.log('wait fixed');
} else {
  const i = s.indexOf('const done = await ev');
  console.log('idx', i);
  if (i >= 0) console.log(JSON.stringify(s.slice(i, i + 350)));
}
