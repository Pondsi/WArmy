const fs = require('node:fs');
const base = 'C:/Users/p/.openclaw/workspace/大龙虾互动区/WArmy/packages/app-shell/src/renderer/';
let h = fs.readFileSync(base + 'index.html', 'utf8');
let j = fs.readFileSync(base + 'app.js', 'utf8');
let c = fs.readFileSync(base + 'app.css', 'utf8');

// ── 1) 新文件图标 ──
h = h.replace(
  /<svg viewBox="0 0 24 24" class="ico"><path d="M8 3h7l5 5v13H8V3zm7 1\.5V9h4\.5L15 4\.5z"\/><\/svg>/,
  '<svg viewBox="0 0 100 100" class="ico"><g fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="square" stroke-linejoin="miter"><path d="M22,24 L56,24 L70,38 L70,86 L22,86 Z"/><polyline points="56,24 56,38 70,38"/></g><g stroke="currentColor" stroke-width="8" stroke-linecap="square"><line x1="76" y1="14" x2="76" y2="30"/><line x1="68" y1="22" x2="84" y2="22"/></g></svg>'
);
console.log('file icon updated');

// ── 2) 右侧面板重设计 ──
const oldPanel = h.match(/        <aside id="panel-col">[\s\S]*?<\/aside>/);
if (oldPanel) {
  h = h.replace(oldPanel[0], `        <aside id="panel-col">
          <div id="panel-resizer" title="拖动调整宽度"></div>

          <!-- 进度（折叠：百分比条；展开：任务列表） -->
          <div class="panel-block">
            <div class="panel-toggle" id="progress-toggle">
              <span data-i18n="panel.progress"></span>
              <div class="progress" style="flex:1;margin:0 8px"><div id="progress-bar" class="progress-bar" style="width:0%"></div></div>
              <span id="progress-text" class="muted">0%</span>
              <span class="chev">›</span>
            </div>
            <ul id="task-list" class="task-list hidden">
              <li class="task-done">整理周报 <span class="dot done"></span></li>
              <li class="task-fail">接口对接 <span class="dot fail"></span></li>
              <li class="task-active">值班编排 <span class="dot active"></span></li>
              <li>知识库归档 <span class="dot"></span></li>
              <li class="task-abandoned">旧方案验证 <span class="dot fail"></span></li>
            </ul>
          </div>

          <!-- 项目目录（仅项目/群聊） -->
          <div class="panel-block only-group">
            <h3 data-i18n="panel.directory"></h3>
            <div id="dir-box" class="muted">—</div>
          </div>

          <!-- 成员（仅项目/群聊） -->
          <div class="panel-block only-group">
            <h3 data-i18n="group.members"></h3>
            <div id="members-box" class="muted">—</div>
            <div style="margin-top:6px;display:flex;gap:6px">
              <input id="member-name" style="flex:1" placeholder=""/>
              <button class="btn-mini" id="btn-member-add">+</button>
            </div>
          </div>

          <!-- 值班者（仅项目/群聊） -->
          <div class="panel-block only-group">
            <h3 data-i18n="panel.duty"></h3>
            <div id="duty-info" class="muted">—</div>
          </div>

          <!-- 知识库 -->
          <div class="panel-block">
            <h3 data-i18n="knowledge.title"></h3>
            <input id="kb-q" data-i18n-placeholder="knowledge.search" style="width:100%;margin-bottom:6px"/>
            <div style="display:flex;gap:6px">
              <button class="btn-mini" id="btn-kb-go" data-i18n="knowledge.search"></button>
              <button class="btn-mini" id="btn-kb-save" data-i18n="knowledge.save"></button>
            </div>
            <div id="kb-out" class="muted" style="margin-top:8px;max-height:100px;overflow:auto"></div>
          </div>
        </aside>`);
  console.log('panel redesigned');
}

// ── 3) 更多菜单：搜索浮窗 + 定向勾选 + 导出弹窗 ──
const oldMore = h.match(/              <div class="urg-dd" id="more-dd">[\s\S]*?<\/div>\n              <button id="btn-stop-all"/);
if (oldMore) {
  h = h.replace(oldMore[0], `              <div class="urg-dd" id="more-dd">
                <button class="urg-trigger" id="more-trigger" type="button" data-i18n-title="common.more">
                  <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="19" cy="12" r="2" fill="currentColor"/></svg>
                </button>
                <div class="urg-menu more-menu-panel hidden" id="more-menu" role="menu">
                  <button type="button" id="mi-search" data-i18n="list.search"></button>
                  <label class="more-check"><input type="checkbox" id="mi-directed"/> <span data-i18n="group.directed"></span></label>
                  <button type="button" id="mi-open" data-i18n="chat.openWindow"></button>
                  <button type="button" id="mi-export" data-i18n="chat.export"></button>
                </div>
              </div>
              <button id="btn-stop-all"`);
  console.log('more menu updated');
}

// ── 4) CSS：任务状态点、面板切换、更多菜单边框 ──
c += `
/* 任务列表状态点 */
.task-list li { display: flex; align-items: center; gap: 8px; justify-content: space-between; }
.task-list li .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--line); flex-shrink: 0; }
.task-list li .dot.done { background: var(--accent); }
.task-list li .dot.fail { background: var(--danger); }
.task-list li .dot.active { background: #f5a623; }
.task-list li.task-done { color: var(--muted); }
.task-list li.task-done .dot { background: var(--accent); }
.task-list li.task-fail { color: var(--muted); }
.task-list li.task-fail .dot { background: var(--danger); }
.task-list li.task-abandoned { color: var(--muted); text-decoration: line-through; }
.task-list li.task-active .dot { background: #f5a623; }

/* 面板折叠 */
.panel-toggle {
  display: flex; align-items: center; cursor: pointer;
  padding: 4px 0; user-select: none;
}
.panel-toggle .chev { transition: transform 0.15s; color: var(--muted); }
.panel-toggle.open .chev { transform: rotate(90deg); }

/* 更多菜单边框 */
.more-menu-panel {
  min-width: 140px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--card);
  box-shadow: var(--shadow-md, 0 8px 24px rgba(0,0,0,.16));
  padding: 4px;
  z-index: 500;
}
.more-menu-panel button,
.more-menu-panel label {
  display: flex; align-items: center; gap: 6px;
  width: 100%; border: none; background: transparent;
  padding: 8px 12px; border-radius: 6px;
  font: inherit; font-size: var(--fs-base); color: var(--ink);
  cursor: pointer; text-align: left;
}
.more-menu-panel button:hover,
.more-menu-panel label:hover { background: var(--hover); }
.more-check { margin: 0; }

/* only-group: 仅项目/群聊显示 */
.only-group.hidden { display: none !important; }
`;

fs.writeFileSync(base + 'index.html', h);
fs.writeFileSync(base + 'app.css', c);
console.log('html/css done');
