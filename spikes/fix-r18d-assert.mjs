import fs from 'node:fs';
const p = 'verify-round18d.mjs';
const lines = fs.readFileSync(p, 'utf8').split('\n');
const start = lines.findIndex((l) => l.includes('const sent = await ev'));
console.log('start', start + 1);
// find end: line with `})()``, 180000);` or `})()`, 180000);`
let end = -1;
for (let i = start; i < start + 30; i++) {
  if (lines[i].includes('})()`,')) { end = i; break; }
}
console.log('end', end + 1, lines[end]);
const neu = [
  "  await ev(`(()=>{",
  "    const rows=[...document.querySelectorAll('[data-sid],.lieBiaoTiaoMu')];",
  "    const r=rows.find(x=>/牛马/.test(x.textContent||''))||rows[0];",
  "    if(r) r.click(); return true;",
  "  })()`, 8000);",
  "  await sleep(800);",
  "  const sent = await ev(`(()=>{",
  "    const ta=document.getElementById('shuRu')||document.querySelector('textarea');",
  "    if(!ta) return false;",
  "    ta.value='写一篇不少于 800 字的短文，主题：管道工程师的一天。写到工作区文件 gongcheng-${MARK}.txt。用 write_file 分段写。';",
  "    ta.dispatchEvent(new Event('input',{bubbles:true}));",
  "    const btn=document.getElementById('faSong')||[...document.querySelectorAll('button')].find(b=>/发送|Send/.test(b.textContent||''));",
  "    if(btn){btn.click();return true}",
  "    ta.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));",
  "    return true;",
  "  })()`, 10000);",
];
lines.splice(start, end - start + 1, ...neu);
let s = lines.join('\n');
s = s.replace(`  ok('长文任务已发送', sent === true, String(sent).slice(0, 50));
  // 再多采 20 秒（续派期间状态条还会亮）
  await sleep(20000);
  sampling = false;
  await sampler;`, `  ok('长文任务已发送', sent === true, String(sent).slice(0, 50));`);
if (!s.includes('sampling = false; await sampler;')) {
  s = s.replace("  ok('使用了 MiMo', sawMimo);", "  sampling = false; await sampler;\n  ok('使用了 MiMo', sawMimo);");
}
fs.writeFileSync(p, s, 'utf8');
console.log('UI send spliced');
