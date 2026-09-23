const fs = require('node:fs');
const p = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/renderer/yingYong.js';
let j = fs.readFileSync(p, 'utf8');

const oldBlock = j.match(/\s*\$\('urgency-bar'\)\?\.addEventListener\('click', async \(e\) => \{[\s\S]*?\n  \}\);/);
if (!oldBlock) {
  console.log('urgency-bar handler not found');
  process.exit(1);
}

const neu = `
  // 紧急度下拉：悬停显框，点击展开
  (function bindUrgency() {
    const trigger = $('jinJiTrigger');
    const menu = $('jinJiCaiDan');
    const dd = $('urgencyDd');
    const biaoQian = $('jinJiBiaoQian');
    if (!trigger || !menu || !dd) return;

    const LABELS = { P1: 'urgency.urgentLabel', P2: 'urgency.insertLabel', P3: 'urgency.queueLabel' };

    function refresh() {
      if (biaoQian) biaoQian.textContent = t(LABELS[state.urgency] || 'urgency.insertLabel');
      dd.classList.toggle('urgent', state.urgency === 'P1');
      menu.querySelectorAll('button').forEach((b) => b.classList.toggle('qiYong', b.dataset.u === state.urgency));
    }
    refresh();

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('yinCang');
    });
    document.addEventListener('click', () => menu.classList.add('yinCang'));

    menu.addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-u]');
      if (!b) return;
      const u = b.dataset.u;
      if (u === 'P1') {
        const ok = await uiConfirmCountdown(t('urgency.confirmBody'), t('urgency.confirmTitle'), 5);
        if (!ok) {
          menu.classList.add('yinCang');
          return;
        }
      }
      state.urgency = u;
      menu.classList.add('yinCang');
      refresh();
    });

    // 语言切换后刷新文案
    window.__refreshUrgency = refresh;
  })();`;

j = j.replace(oldBlock[0], neu);

// loadI18n 后刷新紧急度文案
if (!j.includes('window.__refreshUrgency')) {
  console.log('warn: refresh hook missing');
}
const i18nHook = `    if (pack.displayName) state.t['yingYong.displayName'] = pack.displayName;`;
if (j.includes(i18nHook) && !j.includes('__refreshUrgency?.()')) {
  j = j.replace(i18nHook, `${i18nHook}\n    window.__refreshUrgency?.();`);
}

fs.writeFileSync(p, j);
console.log('urgency dropdown bound, refresh hook:', j.includes('__refreshUrgency?.()'));
