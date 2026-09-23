const fs = require('node:fs');
const base = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/renderer/';

// JS: P1 才显示感叹号图标
let j = fs.readFileSync(base + 'yingYong.js', 'utf8');
const oldRefresh = j.match(/    function refresh\(\) \{[\s\S]*?\n    \}/);
if (oldRefresh) {
  j = j.replace(
    oldRefresh[0],
    `    function refresh() {
      if (biaoQian) biaoQian.textContent = t(LABELS[state.urgency] || 'urgency.insertLabel');
      dd.classList.toggle('urgent', state.urgency === 'P1');
      const icon = dd.querySelector('.urgentI');
      if (icon) icon.classList.toggle('yinCang', state.urgency !== 'P1');
      menu.querySelectorAll('button').forEach((b) => b.classList.toggle('qiYong', b.dataset.u === state.urgency));
    }`
  );
  console.log('urgency refresh updated');
}
fs.writeFileSync(base + 'yingYong.js', j);

// CSS: 图标仅 P1 显示（由 yinCang 类控制），确保 yinCang 生效
let c = fs.readFileSync(base + 'yingYong.css', 'utf8');
if (!c.includes('.urgentI.yinCang')) {
  c += '\n.jinJiDdd .urgentI.yinCang, .urgentI.yinCang { display: none; }\n';
  // 图标红色强调
  c += '.jinJiDdd .urgent .urgentI, .jinJiDd.urgent .urgentI { color: var(--danger); fill: currentColor; }\n';
  fs.writeFileSync(base + 'yingYong.css', c);
  console.log('css appended');
}
