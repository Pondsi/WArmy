const fs = require('node:fs');
const p = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/renderer/yingYong.js';
let j = fs.readFileSync(p, 'utf8');

const anchor = `  bindResizer($('lanTiaoZhengTiao'), '--list-w', 200, 420);`;
if (!j.includes(anchor)) {
  console.log('anchor missing');
  process.exit(1);
}

const globals = `  // ── 顶层交互绑定（必须全局执行一次） ──
  document.querySelectorAll('.ceLanTiaoMu').forEach((el) => {
    el.onclick = () => setNav(el.dataset.nav);
  });
  $('lieBiaoSouSuo').addEventListener('shuRu', () => renderList());
  $('anNiuFaSong').addEventListener('click', () => faSong());
  $('anNiuTingZhiAll').addEventListener('click', () => stopAllAi());
  $('anNiuAttach').addEventListener('click', async () => {
    const r = await window.warmy.pickFile();
    if (r?.ok) {
      const ming = r.path.split(/[\\\\/]/).pop();
      state.attachments.push({ ming, path: r.path });
      renderAttach();
    }
  });

`;

if (!j.includes("querySelectorAll('.ceLanTiaoMu').forEach((el) => {\n    el.onclick = () => setNav")) {
  j = j.replace(anchor, globals + anchor);
  console.log('restored global bindings');
} else {
  console.log('already present');
}

fs.writeFileSync(p, j);
