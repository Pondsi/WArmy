const fs = require('node:fs');
const base = 'C:/Users/p/.openclaw/workspace/大龙虾互动区/WArmy/packages/app-shell/src/renderer/';
let j = fs.readFileSync(base + 'app.js', 'utf8');

// 加入群聊邀请绑定（若尚未注入）
if (!j.includes("btn-join-copy")) {
  const anchor = "      // SMTP 多账号（最多 10）";
  const alt = "      // SMTP";
  const use = j.includes(anchor) ? anchor : alt;
  if (!j.includes(use)) {
    console.log('SMTP anchor missing');
    process.exit(1);
  }
  j = j.replace(use, `      // 邀请链接 / 二维码
      (async () => {
        const st = await window.warmy.meshStatus().catch(() => null);
        const node = st?.nodeId || 'local';
        const inv = await window.warmy.inviteCreate().catch(() => null);
        const tok = inv?.invite?.token ? '&tok=' + inv.invite.token : '';
        const link = 'warmy://join?node=' + encodeURIComponent(node) + '&port=7788' + tok;
        const lk = $('join-link');
        if (lk) lk.textContent = link;
        const qr = $('join-qr');
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
          await navigator.clipboard.writeText($('join-link').textContent);
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

${use}`);
  console.log('join bindings added');
}
fs.writeFileSync(base + 'app.js', j);
