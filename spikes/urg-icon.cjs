const fs = require('node:fs');
const base = 'C:/Users/p/.openclaw/workspace/大龙虾互动区/CCArmy/packages/app-shell/src/renderer/';

// JS: P1 才显示感叹号图标
let j = fs.readFileSync(base + 'app.js', 'utf8');
const oldRefresh = j.match(/    function refresh\(\) \{[\s\S]*?\n    \}/);
if (oldRefresh) {
  j = j.replace(
    oldRefresh[0],
    `    function refresh() {
      if (label) label.textContent = t(LABELS[state.urgency] || 'urgency.insertLabel');
      dd.classList.toggle('urgent', state.urgency === 'P1');
      const icon = dd.querySelector('.urgent-i');
      if (icon) icon.classList.toggle('hidden', state.urgency !== 'P1');
      menu.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.u === state.urgency));
    }`
  );
  console.log('urgency refresh updated');
}
fs.writeFileSync(base + 'app.js', j);

// CSS: 图标仅 P1 显示（由 hidden 类控制），确保 hidden 生效
let c = fs.readFileSync(base + 'app.css', 'utf8');
if (!c.includes('.urgent-i.hidden')) {
  c += '\n.urg-ddd .urgent-i.hidden, .urgent-i.hidden { display: none; }\n';
  // 图标红色强调
  c += '.urg-ddd .urgent .urgent-i, .urg-dd.urgent .urgent-i { color: var(--danger); fill: currentColor; }\n';
  fs.writeFileSync(base + 'app.css', c);
  console.log('css appended');
}
