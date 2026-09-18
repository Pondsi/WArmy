const fs = require('node:fs');
const base = 'C:/Users/p/.openclaw/workspace/大龙虾互动区/WArmy/packages/app-shell/src/renderer/';
let h = fs.readFileSync(base + 'index.html', 'utf8');
let j = fs.readFileSync(base + 'app.js', 'utf8');
let c = fs.readFileSync(base + 'app.css', 'utf8');

// ── 1) 聊天头部：只留控制台+安全模式+停止，其余进「…」菜单 ──
const oldActions = h.match(/            <div class="chat-actions">[\s\S]*?<\/div>\n          <\/header>/);
if (oldActions) {
  h = h.replace(oldActions[0], `            <div class="chat-actions">
              <button id="btn-console" class="btn-icon" data-i18n-title="tip.console" aria-label="console">
                <svg class="ico" viewBox="0 0 100 100" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"><rect x="10" y="16" width="80" height="68" rx="6"/><polyline points="28,40 42,52 28,64"/><line x1="50" y1="64" x2="72" y2="64"/></g></svg>
              </button>
              <div class="urg-dd" id="sec-dd">
                <button class="urg-trigger" id="sec-trigger" type="button" data-i18n-title="chat.security">
                  <svg class="ico sec-warn hidden" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 3h2v11h-2V3zm0 13h2v2h-2v-2z"/></svg>
                  <span id="sec-label" data-i18n="chat.securityNormal"></span>
                  <svg class="ico urg-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6z"/></svg>
                </button>
                <div class="urg-menu hidden" id="sec-menu" role="menu">
                  <button type="button" data-s="normal" data-i18n="chat.securityNormal"></button>
                  <button type="button" data-s="strict" data-i18n="chat.securityStrict"></button>
                  <button type="button" data-s="full" data-i18n="chat.securityFull"></button>
                </div>
              </div>
              <div class="urg-dd" id="more-dd">
                <button class="urg-trigger" id="more-trigger" type="button" data-i18n-title="common.more">
                  <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="19" cy="12" r="2" fill="currentColor"/></svg>
                </button>
                <div class="urg-menu hidden" id="more-menu" role="menu">
                  <button type="button" id="mi-search" data-i18n="list.search"></button>
                  <button type="button" id="mi-directed" data-i18n="group.directed"></button>
                  <button type="button" id="mi-open" data-i18n="chat.openWindow"></button>
                  <button type="button" id="mi-export" data-i18n="chat.export"></button>
                </div>
              </div>
              <button id="btn-stop-all" class="btn-stop" data-i18n="chat.stopAll" data-i18n-title="chat.stopAllTip"></button>
            </div>
          </header>`);
  console.log('chat header simplified');
}

// ── 2) 扫码加入 → 移到列表列（创建按钮旁） ──
if (!h.includes('btn-join-qr')) {
  h = h.replace(
    '        <button id="list-action" class="btn-mini hidden"></button>',
    '        <div style="display:flex;gap:6px;align-items:center">\n          <button id="btn-join-qr" class="btn-mini hidden" data-i18n="join.scanQr" data-i18n-title="join.qrHint"></button>\n          <button id="list-action" class="btn-mini hidden"></button>\n        </div>'
  );
  console.log('join-qr moved to list header');
}

// ── 3) CSS：更多菜单样式 ──
if (!c.includes('.more-dd')) {
  c += `
.more-dd { position: relative; display: inline-flex; }
.urg-trigger .ico { width: 18px; height: 18px; fill: currentColor; }
`;
}

fs.writeFileSync(base + 'index.html', h);
fs.writeFileSync(base + 'renderer.css', c);
// 注意：css 文件名
fs.writeFileSync(base + 'app.css', c);
console.log('html/css updated');
