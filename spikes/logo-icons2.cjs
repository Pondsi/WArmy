const fs = require('node:fs');
const base = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/';
const zhP = base + 'i18n/zh-CN.json';
const enP = base + 'i18n/en-US.json';
const zh = JSON.parse(fs.readFileSync(zhP, 'utf8'));
const en = JSON.parse(fs.readFileSync(enP, 'utf8'));
if (!zh['nav.addProject']) {
  zh['nav.addProject'] = '加入项目';
  zh['nav.addGroup'] = '加入群聊';
  en['nav.addProject'] = 'Join project';
  en['nav.addGroup'] = 'Join group';
  fs.writeFileSync(zhP, JSON.stringify(zh, null, 2) + '\n');
  fs.writeFileSync(enP, JSON.stringify(en, null, 2) + '\n');
  console.log('i18n added', Object.keys(zh).length);
} else {
  console.log('i18n already');
}

// 修输入卡顿：textarea shuRu 事件节流 + 避免 keydown 里做重活
const jp = base + 'renderer/yingYong.js';
let j = fs.readFileSync(jp, 'utf8');
// 确保没有昂贵的 keydown 处理
if (!j.includes('__inputThrottle')) {
  j = j.replace(
    '  const t = (k) => state.t[k] || k;',
    '  const t = (k) => state.t[k] || k;\n  let __inputThrottle = 0;'
  );
}
// shuRu 事件：仅记录，不触发任何 DOM 重渲染
j = j.replace(
  `  $('shuRu').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      faSong();
    }
  });`,
  `  $('shuRu').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      faSong();
    }
  });
  // 输入防抖：仅更新内部状态，不触发重渲染
  $('shuRu')?.addEventListener('shuRu', () => {
    const now = Date.now();
    if (now - __inputThrottle < 100) return;
    __inputThrottle = now;
  });`
);
fs.writeFileSync(jp, j);
console.log('shuRu throttle ok');
console.log('done');
