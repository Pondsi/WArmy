const fs = require('node:fs');
const p = 'C:/Users/p/.openclaw/workspace/大龙虾互动区/WArmy/packages/app-shell/src/renderer/app.js';
let j = fs.readFileSync(p, 'utf8');

const anchor = `  bindResizer($('col-resizer'), '--list-w', 200, 420);`;
if (!j.includes(anchor)) {
  console.log('anchor missing');
  process.exit(1);
}

const globals = `  // ── 顶层交互绑定（必须全局执行一次） ──
  document.querySelectorAll('.rail-item').forEach((el) => {
    el.onclick = () => setNav(el.dataset.nav);
  });
  $('list-search').addEventListener('input', () => renderList());
  $('btn-send').addEventListener('click', () => send());
  $('btn-stop-all').addEventListener('click', () => stopAllAi());
  $('btn-attach').addEventListener('click', async () => {
    const r = await window.warmy.pickFile();
    if (r?.ok) {
      const name = r.path.split(/[\\\\/]/).pop();
      state.attachments.push({ name, path: r.path });
      renderAttach();
    }
  });

`;

if (!j.includes("querySelectorAll('.rail-item').forEach((el) => {\n    el.onclick = () => setNav")) {
  j = j.replace(anchor, globals + anchor);
  console.log('restored global bindings');
} else {
  console.log('already present');
}

fs.writeFileSync(p, j);
