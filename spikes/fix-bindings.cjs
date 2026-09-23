const fs = require('node:fs');
const base = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/renderer/';
let j = fs.readFileSync(base + 'yingYong.js', 'utf8');

// 定向模式：改为按钮 + 勾/叉
j = j.replace(
  `  $('caiDanTuBiaoDingXiang')?.addEventListener('change', async (e) => {
    if (!state.selectedChat) return;
    await window.warmy.groupDirected({ groupId: state.selectedChat.id, directed: e.target.checked }).catch(() => {});
  });`,
  `  let __directed = false;
  $('caiDanTuBiaoDingXiang')?.addEventListener('click', async () => {
    __directed = !__directed;
    const mark = $('caiDanTuBiaoDingXiangMark');
    if (mark) mark.textContent = __directed ? '✓' : '✕';
    if (state.selectedChat) {
      await window.warmy.groupDirected({ groupId: state.selectedChat.id, directed: __directed }).catch(() => {});
    }
  });`
);
console.log('directed binding updated');

// 停止按钮：改 id 绑定
j = j.replace(
  "$('anNiuTingZhiAll').addEventListener('click', () => stopAllAi());",
  "$('anNiuTingZhiAll')?.addEventListener('click', () => stopAllAi());"
);
console.log('stop binding updated');

fs.writeFileSync(base + 'yingYong.js', j);
console.log('done, anNiuTingZhiAll:', j.includes("anNiuTingZhiAll"));
