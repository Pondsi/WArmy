const fs = require('node:fs');
const base = 'C:/Users/p/.openclaw/workspace/大龙虾互动区/WArmy/packages/app-shell/src/renderer/';
let j = fs.readFileSync(base + 'app.js', 'utf8');

// 定向模式：改为按钮 + 勾/叉
j = j.replace(
  `  $('mi-directed')?.addEventListener('change', async (e) => {
    if (!state.selectedChat) return;
    await window.warmy.groupDirected({ groupId: state.selectedChat.id, directed: e.target.checked }).catch(() => {});
  });`,
  `  let __directed = false;
  $('mi-directed')?.addEventListener('click', async () => {
    __directed = !__directed;
    const mark = $('mi-directed-mark');
    if (mark) mark.textContent = __directed ? '✓' : '✕';
    if (state.selectedChat) {
      await window.warmy.groupDirected({ groupId: state.selectedChat.id, directed: __directed }).catch(() => {});
    }
  });`
);
console.log('directed binding updated');

// 停止按钮：改 id 绑定
j = j.replace(
  "$('btn-stop-all').addEventListener('click', () => stopAllAi());",
  "$('btn-stop-all')?.addEventListener('click', () => stopAllAi());"
);
console.log('stop binding updated');

fs.writeFileSync(base + 'app.js', j);
console.log('done, btn-stop-all:', j.includes("btn-stop-all"));
