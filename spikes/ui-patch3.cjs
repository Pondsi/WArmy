const fs = require('node:fs');
const p = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/renderer/yingYong.js';
let j = fs.readFileSync(p, 'utf8');

// 定位提示音区块
const sIdx = j.indexOf("t('settings.sound')");
const aIdx = j.indexOf("t('settings.about')");
if (sIdx > 0 && aIdx > sIdx) {
  let seg = j.slice(sIdx, aIdx);
  const before = seg.length;
  // 移除提示音区的“检查更新”按钮块
  seg = seg.replace(/\s*<div style="margin-top:12px">\s*<button class="anNiuXiao" id="btn-update">[\s\S]*?<\/div>/, '');
  j = j.slice(0, sIdx) + seg + j.slice(aIdx);
  console.log('sound seg', before, '->', seg.length);
}

// 移除 btn-update 绑定
const bindRe = /\s*\$\(\'btn-update\'\)\.onclick = async \(\) => \{[\s\S]*?\n      \};/;
if (bindRe.test(j)) {
  j = j.replace(bindRe, '');
  console.log('removed btn-update binding');
}

fs.writeFileSync(p, j);
const out = fs.readFileSync(p, 'utf8');
const s2 = out.indexOf("t('settings.sound')");
const a2 = out.indexOf("t('settings.about')");
console.log('sound still has update btn:', out.slice(s2, a2).includes('btn-update'));
console.log('about has update btn:', out.slice(a2, a2 + 1200).includes('anNiuAboutGengXin'));
