const fs = require('node:fs');
const base = 'C:/Users/p/.openclaw/workspace/大龙虾互动区/WArmy/packages/app-shell/src/renderer/';
let h = fs.readFileSync(base + 'index.html', 'utf8');
let j = fs.readFileSync(base + 'app.js', 'utf8');
let c = fs.readFileSync(base + 'app.css', 'utf8');

// ── 1) 性能：减少 setInterval，合并刷新 ──
// 把多个独立 interval 合并成一个主循环
if (!j.includes('__mainLoop')) {
  j = j.replace(
    "  setInterval(() => raf(refreshMetrics), 8000);",
    "  // 主刷新循环：合并所有定时刷新，降低频率\n  let __loopTick = 0;\n  setInterval(() => {\n    __loopTick++;\n    if (__loopTick % 2 === 0) raf(refreshMetrics);\n    if (__loopTick % 3 === 0) raf(refreshCost);\n    if (__loopTick % 4 === 0) raf(refreshExecutors);\n    if (__loopTick % 5 === 0) raf(() => { refreshSessionBoard(); refreshMembers(); });\n    if (__loopTick % 6 === 0) raf(checkLastError);\n    if (__loopTick % 8 === 0) raf(refreshJoinBadge);\n    if (__loopTick % 15 === 0) raf(saveState);\n  }, 5000);\n  const __mainLoop = true;"
  );
  // 删除旧的独立 intervals
  j = j.replace('setInterval(() => raf(refreshCost), 10000);', '');
  j = j.replace("setInterval(() => raf(() => { refreshSessionBoard(); refreshMembers(); }), 10000);", '');
  j = j.replace('setInterval(() => raf(checkLastError), 15000);', '');
  j = j.replace('setInterval(() => raf(refreshExecutors), 12000);', '');
  j = j.replace('setInterval(() => raf(refreshJoinBadge), 10000);', '');
  j = j.replace('setInterval(() => raf(saveState), 30000);', '');
  console.log('main loop merged');
}

// ── 2) 任务列表：完成用删除线 ──
c = c.replace(
  '.task-list li.task-done { color: var(--muted); }',
  '.task-list li.task-done { color: var(--muted); text-decoration: line-through; }'
);
console.log('task-done strikethrough');

// ── 3) 我的牛马/联系人：不显示成员 ──
// 成员区块已有 only-group class，确认 single/extdm 时隐藏
// updatePanelVisibility 已处理

// ── 4) 停止按钮：红色圆点图标 ──
h = h.replace(
  /<button id="btn-stop-all" class="btn-stop"[^>]*><\/button>/,
  '<button id="btn-stop-all" class="btn-stop-icon" data-i18n-title="chat.stopAllTip"><svg viewBox="0 0 24 24" class="ico"><circle cx="12" cy="12" r="8" fill="currentColor"/></svg></button>'
);
console.log('stop icon');

// ── 5) 更多菜单：强制边框完整 ──
c = c.replace(
  `.more-menu-panel {
  min-width: 140px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--card);
  box-shadow: var(--shadow-md, 0 8px 24px rgba(0,0,0,.16));
  padding: 4px;
  z-index: 500;
}`,
  `.more-menu-panel {
  min-width: 160px;
  border: 1px solid var(--line) !important;
  border-radius: 10px;
  background: var(--card);
  box-shadow: 0 8px 24px rgba(0,0,0,.18);
  padding: 6px;
  z-index: 500;
  overflow: visible !important;
}`
);
console.log('more-menu border');

// ── 6) 定向模式：勾/叉 替代 checkbox ──
h = h.replace(
  '<label class="more-check"><input type="checkbox" id="mi-directed"/> <span data-i18n="group.directed"></span></label>',
  '<button type="button" id="mi-directed" class="more-menu-btn"><span data-i18n="group.directed"></span><span id="mi-directed-mark" class="mark">✕</span></button>'
);
console.log('directed mark');

// ── 7) 微信风聊天框：底部工具栏图标横排、发送按钮绿色 ──
c = c.replace(
  '.composer-bar {',
  `.composer-bar {
  display: flex; align-items: center; justify-content: space-between;
  gap: 8px; margin-top: 8px;`
);
// 确保 composer-bar 有完整规则
if (!c.includes('composer-bar {')) {
  c += `
.composer-bar {
  display: flex; align-items: center; justify-content: space-between;
  gap: 8px; margin-top: 8px;
}
.composer-left { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.composer-right { display: flex; align-items: center; gap: 8px; }
.btn-stop-icon {
  width: 36px; height: 36px;
  border: none; border-radius: 8px;
  background: transparent; color: var(--danger);
  cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
}
.btn-stop-icon:hover { background: rgba(250,81,81,.12); }
.btn-stop-icon .ico { width: 20px; height: 20px; fill: currentColor; }
.more-menu-btn {
  display: flex; align-items: center; justify-content: space-between;
  width: 100%; border: none; background: transparent;
  padding: 8px 12px; border-radius: 6px;
  font: inherit; font-size: var(--fs-base); color: var(--ink);
  cursor: pointer; text-align: left;
}
.more-menu-btn:hover { background: var(--hover); }
.more-menu-btn .mark { font-weight: 600; }
`;
}

fs.writeFileSync(base + 'index.html', h);
fs.writeFileSync(base + 'app.js', j);
fs.writeFileSync(base + 'app.css', c);
console.log('done');
