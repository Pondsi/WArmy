const fs = require('node:fs');
const base = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/renderer/';
let j = fs.readFileSync(base + 'yingYong.js', 'utf8');
if (j.includes('warmy://join?node=')) {
  console.log('present');
  process.exit(0);
}
// 用 renderSmtpList 定义作为锚点
const anchor = '      async function renderSmtpList() {';
if (!j.includes(anchor)) {
  console.log('anchor missing');
  process.exit(1);
}
j = j.replace(
  anchor,
  `      // 邀请链接 / 二维码
      (async () => {
        const st = await window.warmy.meshStatus().catch(() => null);
        const node = st?.nodeId || 'local';
        const inv = await window.warmy.inviteCreate().catch(() => null);
        const tok = inv?.invite?.token ? '&tok=' + inv.invite.token : '';
        const link = 'warmy://join?node=' + encodeURIComponent(node) + '&port=7788' + tok;
        const lk = $('jiaRuLink');
        if (lk) lk.textContent = link;
        const qr = $('jiaRuqr');
        if (qr) {
          try {
            const mod = await import('./qr.js');
            qr.innerHTML = mod.qrSvg(link, 168);
          } catch {
            qr.textContent = link.slice(0, 26) + '…';
          }
        }
      })();
      $('btn-join-copy')?.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText($('jiaRuLink').textContent);
          $('join-msg').textContent = t('join.copied');
        } catch {
          $('join-msg').textContent = t('join.fail');
        }
      });
      $('btn-join-accept')?.addEventListener('click', () => {
        const v = $('join-input').value.trim();
        if (!v) return;
        $('join-msg').textContent = v.startsWith('warmy://') ? t('join.ok') : t('join.fail');
      });

${anchor}`
);
fs.writeFileSync(base + 'yingYong.js', j);
console.log('join bindings added');
