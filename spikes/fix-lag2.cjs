const fs = require('node:fs');
const base = 'C:/Users/p/.openclaw/workspace/大龙虾互动区/CCArmy/packages/app-shell/src/renderer/';
let j = fs.readFileSync(base + 'app.js', 'utf8');
let c = fs.readFileSync(base + 'app.css', 'utf8');

// ══════════════════════════════════════════════════
// 深度修复输入卡顿
// ══════════════════════════════════════════════════

// 修复1：bindResizer 有重复 mousedown（旧的没删干净），清理整个函数重写
const oldBindResizer = j.match(/  function bindResizer\(el, cssVar, min, max\) \{[\s\S]*?\n  \}/);
if (oldBindResizer) {
  j = j.replace(oldBindResizer[0], `  function bindResizer(el, cssVar, min, max) {
    if (!el) return;
    let startX = 0, startW = 0, dragging = false;
    const onMove = (e) => {
      if (!dragging) return;
      const w = Math.min(max, Math.max(min, startW + (e.clientX - startX)));
      document.documentElement.style.setProperty(cssVar, w + 'px');
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('dragging');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    el.addEventListener('mousedown', (e) => {
      dragging = true;
      el.classList.add('dragging');
      startX = e.clientX;
      startW = parseInt(getComputedStyle(document.documentElement).getPropertyValue(cssVar), 10) || 280;
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      e.preventDefault();
    });
  }`);
  console.log('bindResizer cleaned');
}

// 修复2：messages 容器加 content-visibility 隔离重绘
c = c.replace(
  '.messages { flex: 1; overflow: auto; padding: var(--sp-4); }',
  `.messages {
  flex: 1; overflow: auto; padding: var(--sp-4);
  content-visibility: auto;
  contain-intrinsic-size: auto 500px;
}`
);
console.log('messages content-visibility');

// 修复3：#input 加 contain 隔离，避免打字触发外部重排
c = c.replace(
  `#input {
  width: 100%; resize: none; border: 1px solid var(--input-border); border-radius: var(--radius-sm);
  padding: 10px; font: inherit; outline: none; background: var(--input-bg);
}`,
  `#input {
  width: 100%; resize: none; border: 1px solid var(--input-border); border-radius: var(--radius-sm);
  padding: 10px; font: inherit; outline: none; background: var(--input-bg);
  contain: layout style;
  will-change: contents;
}`
);
console.log('input contain');

// 修复4：chat-col 加 contain
c = c.replace(
  `#chat-col {
  display: flex; flex-direction: column;
  border-right: 1px solid var(--line);
  min-width: 0; position: relative;
}`,
  `#chat-col {
  display: flex; flex-direction: column;
  border-right: 1px solid var(--line);
  min-width: 0; position: relative;
  contain: layout style paint;
}`
);
console.log('chat-col contain');

// 修复5：msg 动画改为 opacity-only（避免 layout）
c = c.replace(
  '.msg { display: flex; margin-bottom: 14px; gap: 10px; animation: fade-in 0.15s ease; }\n@keyframes fade-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }',
  '.msg { display: flex; margin-bottom: 14px; gap: 10px; animation: msg-in 0.12s ease; }\n@keyframes msg-in { from { opacity: 0; } to { opacity: 1; } }'
);
console.log('msg animation opacity-only');

// 修复6：progress-bar transition 去掉（每 tick 刷新会触发）
c = c.replace(
  '.progress-bar { height: 100%; background: var(--accent); border-radius: 99px; transition: width 0.25s; }',
  '.progress-bar { height: 100%; background: var(--accent); border-radius: 99px; }'
);
console.log('progress transition removed');

// 修复7：所有 rail-item / btn-icon 的 transition 去掉 transform
c = c.replace(
  /transition: background 0\.15s, color 0\.15s, transform 0\.12s;/,
  'transition: background 0.15s, color 0.15s;'
);
console.log('transform transition removed');

fs.writeFileSync(base + 'app.js', j);
fs.writeFileSync(base + 'app.css', c);
console.log('all lag fixes applied');
