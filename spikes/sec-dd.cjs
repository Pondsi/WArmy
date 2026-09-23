const fs = require('node:fs');
const base = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/renderer/';
let j = fs.readFileSync(base + 'yingYong.js', 'utf8');

// ── 1) 安全模式下拉：替换 session-sec 绑定 ──
const oldSec = j.match(/\s*\$\(\'session-sec\'\)\.addEventListener\(\'change\', \(e\) => \{[\s\S]*?\n  \}\);/);
if (oldSec) {
  j = j.replace(oldSec[0], `
  // 本会话安全模式：同紧急度的下拉样式
  (function bindSecurityDropdown() {
    const trigger = $('secTrigger');
    const menu = $('secCaiDan');
    const dd = $('secDd');
    const biaoQian = $('secBiaoQian');
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
      if (biaoQian) biaoQian.textContent = t(LABELS[mode] || LABELS.normal);
      dd.classList.toggle('urgent', mode === 'full');
      const warn = dd.querySelector('.secWarn');
      if (warn) warn.classList.toggle('yinCang', mode !== 'full');
      menu.querySelectorAll('button').forEach((b) => b.classList.toggle('qiYong', b.dataset.s === mode));
    }
    window.__refreshSecurity = refresh;
    refresh();

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('yinCang');
    });
    document.addEventListener('click', () => menu.classList.add('yinCang'));

    menu.addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-s]');
      if (!b) return;
      const mode = b.dataset.s;
      if (mode === 'full') {
        const ok = await uiConfirmCountdown(t('sec.confirmBody'), t('sec.confirmTitle'), 5);
        if (!ok) {
          menu.classList.add('yinCang');
          return;
        }
      }
      menu.classList.add('yinCang');
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

fs.writeFileSync(base + 'yingYong.js', j);
console.log('session-sec refs left:', (j.match(/session-sec/g) || []).length);
