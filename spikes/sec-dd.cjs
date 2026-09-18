const fs = require('node:fs');
const base = 'C:/Users/p/.openclaw/workspace/大龙虾互动区/WArmy/packages/app-shell/src/renderer/';
let j = fs.readFileSync(base + 'app.js', 'utf8');

// ── 1) 安全模式下拉：替换 session-sec 绑定 ──
const oldSec = j.match(/\s*\$\(\'session-sec\'\)\.addEventListener\(\'change\', \(e\) => \{[\s\S]*?\n  \}\);/);
if (oldSec) {
  j = j.replace(oldSec[0], `
  // 本会话安全模式：同紧急度的下拉样式
  (function bindSecurityDropdown() {
    const trigger = $('sec-trigger');
    const menu = $('sec-menu');
    const dd = $('sec-dd');
    const label = $('sec-label');
    if (!trigger || !menu || !dd) return;

    const LABELS = {
      normal: 'chat.securityNormal',
      strict: 'chat.securityStrict',
      full: 'chat.securityFull',
    };
    function currentMode() {
      const id = state.selectedChat?.id;
      return (id && state.sessionSecurity[id]) || state.globalSecurity || 'normal';
    }
    function refresh() {
      const mode = currentMode();
      if (label) label.textContent = t(LABELS[mode] || LABELS.normal);
      dd.classList.toggle('urgent', mode === 'full');
      const warn = dd.querySelector('.sec-warn');
      if (warn) warn.classList.toggle('hidden', mode !== 'full');
      menu.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.s === mode));
    }
    window.__refreshSecurity = refresh;
    refresh();

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('hidden');
    });
    document.addEventListener('click', () => menu.classList.add('hidden'));

    menu.addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-s]');
      if (!b) return;
      const mode = b.dataset.s;
      if (mode === 'full') {
        const ok = await uiConfirmCountdown(t('sec.confirmBody'), t('sec.confirmTitle'), 5);
        if (!ok) {
          menu.classList.add('hidden');
          return;
        }
      }
      menu.classList.add('hidden');
      if (state.selectedChat) {
        state.sessionSecurity[state.selectedChat.id] = mode;
      } else {
        state.globalSecurity = mode;
        try { await window.warmy.setSecurityMode(mode); } catch { /* noop */ }
      }
      refresh();
    });
  })();`);
  console.log('security dropdown bound');
}

// openChat 里旧 select 赋值 → 刷新下拉
j = j.replace(/\s*\/\/\s*\$\(.session-sec.\)\.value[\s\S]*?\n/, '\n');
j = j.replace(/\$\(\'session-sec\'\)\.value = [^\n]*\n/, "    window.__refreshSecurity?.();\n");
j = j.replace(/\$\(\'session-sec\'\)\.value = [^\n]*\n/g, "    window.__refreshSecurity?.();\n");

// loadI18n 后刷新安全下拉
j = j.replace("window.__refreshUrgency?.();", "window.__refreshUrgency?.();\n    window.__refreshSecurity?.();");

fs.writeFileSync(base + 'app.js', j);
console.log('session-sec refs left:', (j.match(/session-sec/g) || []).length);
