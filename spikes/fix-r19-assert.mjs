import fs from 'node:fs';
const p = 'verify-round19.mjs';
let s = fs.readFileSync(p, 'utf8');
const oldS = `  const btnText = await ev(\`(()=>{
    const t=document.body.innerText||'';
    return { auto: t.includes('自动添加模型'), manual: t.includes('手动添加模型'), proto: t.includes('协议') };
  })()\`, 5000);
  ok('设置页显示自动/手动添加模型', btnText && btnText.auto && btnText.manual, JSON.stringify(btnText || {}));
  ok('设置页显示协议选择', btnText && btnText.proto);`;
const newS = `  const btnText = await ev(\`(()=>{
    const html=document.body.innerHTML||'';
    return {
      auto: html.includes('data-fetch') && html.includes('自动添加模型'),
      manual: html.includes('data-manual-add'),
      proto: html.includes('openai-compatible'),
    };
  })()\`, 5000);
  ok('设置页显示自动/手动添加模型', btnText && btnText.auto && btnText.manual, JSON.stringify(btnText || {}));
  ok('设置页显示协议选择', btnText && btnText.proto);`;
if (!s.includes(oldS)) { console.log('no match'); process.exit(1); }
s = s.replace(oldS, newS);
fs.writeFileSync(p, s, 'utf8');
console.log('assert html');
