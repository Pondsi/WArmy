import fs from 'node:fs';
const p = 'verify-round18b.mjs';
let s = fs.readFileSync(p, 'utf8');

// 1) seed: full security + autoSelect
s = s.replace(
  "asrEnabled: true, asrLang: 'auto', globalSecurity: 'normal', askOnExceed: true,",
  "asrEnabled: true, asrLang: 'auto', globalSecurity: 'full', askOnExceed: false, autoSelectRecommended: true,"
);

// 2) wait loop: auto-click any decision/auth cards
const oldWait = `  for (let i = 0; i < 150; i++) {
    const au0 = auditSince(since);`;
const newWait = `  for (let i = 0; i < 150; i++) {
    // 自动应答决策卡/授权卡（无人值守测试不能卡在弹卡上）
    await ev(\`(()=>{
      let n = 0;
      document.querySelectorAll('.aiqKa button, .aiqOpts button').forEach((b) => {
        const t = (b.textContent || '');
        if (/同意|允许|本次允许|推荐|继续|确定|好的|Yes|Allow/i.test(t)) { try { b.click(); n++; } catch {} }
      });
      return n;
    })()\`, 2000).catch(() => null);
    const au0 = auditSince(since);`;

if (!s.includes(oldWait)) {
  console.log('wait block not found');
  const i = s.indexOf('for (let i = 0; i < 150; i++)');
  console.log(i, s.slice(i, i + 200));
  process.exit(1);
}
s = s.replace(oldWait, newWait);
fs.writeFileSync(p, s, 'utf8');
console.log('r18b auto-answer cards ok');
