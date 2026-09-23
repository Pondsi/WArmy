const fs = require('node:fs');
const base = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/';

// i18n
const zhP = base + 'i18n/zh-CN.json';
const enP = base + 'i18n/en-US.json';
const zh = JSON.parse(fs.readFileSync(zhP, 'utf8'));
const en = JSON.parse(fs.readFileSync(enP, 'utf8'));
if (!zh['archive.tiShi']) {
  zh['archive.tiShi'] = '归档后会话从主列表隐藏，但数据仍保留。可在此恢复或彻底删除。所有会话（项目/群聊/联系人/牛马）均可通过右键菜单归档。';
  en['archive.tiShi'] = 'Archived conversations are yinCang from the main list but data is kept. Restore or delete here. All conversations can be archived via right-click.';
  fs.writeFileSync(zhP, JSON.stringify(zh, null, 2) + '\n');
  fs.writeFileSync(enP, JSON.stringify(en, null, 2) + '\n');
  console.log('i18n archive.tiShi added');
}

// yingYong.js: 归档区加说明
const p = base + 'renderer/yingYong.js';
let j = fs.readFileSync(p, 'utf8');
if (!j.includes('archive.tiShi')) {
  const h2 = "          <h2>${t('ctx.archive')}</h2>";
  if (j.includes(h2)) {
    j = j.replace(h2, h2 + '\n          <p class="jingYin">${t(\'archive.tiShi\')}</p>');
    fs.writeFileSync(p, j);
    console.log('archive tiShi added');
  } else {
    console.log('WARN: archive h2 not found');
  }
}

console.log('done');
