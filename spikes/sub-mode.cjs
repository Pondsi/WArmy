const fs = require('node:fs');
const p = 'C:/Users/p/.openclaw/workspace/大龙虾互动区/WArmy/packages/app-shell/src/renderer/app.js';
let j = fs.readFileSync(p, 'utf8');

if (!j.includes("q.get('mode')")) {
  const old = `    const q = new URLSearchParams(window.location.search);
    const cid = q.get('chatId');`;
  const neu = `    const q = new URLSearchParams(window.location.search);
    const mode = q.get('mode');
    if (mode === 'sub') {
      document.getElementById('titlebar')?.classList.add('hidden');
      document.getElementById('rail')?.classList.add('hidden');
      document.getElementById('list-col')?.classList.add('hidden');
      document.getElementById('app-body')?.classList.add('hide-list');
    }
    const cid = q.get('chatId');`;
  if (j.includes(old)) {
    j = j.replace(old, neu);
    fs.writeFileSync(p, j);
    console.log('sub-window mode added');
  } else {
    console.log('anchor not found');
  }
} else {
  console.log('already has mode');
}

// 确保 only-group 在 openChat 时刷新
if (!j.includes('updatePanelVisibility()')) {
  j = j.replace(
    "    window.__refreshSecurity?.();\n    renderChat();",
    "    window.__refreshSecurity?.();\n    updatePanelVisibility?.();\n    renderChat();"
  );
  fs.writeFileSync(p, j);
  console.log('updatePanelVisibility wired');
}

console.log('done, mode:', j.includes("q.get('mode')"));
