const fs = require('node:fs');
const base = 'C:/Users/p/.openclaw/workspace/大龙虾互动区/CCArmy/packages/app-shell/src/';
let j = fs.readFileSync(base + 'renderer/app.js', 'utf8');
let c = fs.readFileSync(base + 'renderer/app.css', 'utf8');
let m = fs.readFileSync(base + 'electron-main.ts', 'utf8');

// 1) me-strip CSS（横排紧凑）
if (!c.includes('.me-strip')) {
  c += `
/* 我的：横排紧凑，不用卡片 */
.me-strip {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  padding: 8px 0 16px;
  background: transparent;
  border: none;
}
.me-strip .field { min-width: 180px; }
.me-strip .profile-head { margin-bottom: 0; }
.join-qr {
  width: 168px; height: 168px;
  background: #fff; border: 1px solid var(--line);
  border-radius: 10px; display: grid; place-items: center;
}
.join-row { display: flex; gap: 12px; align-items: flex-start; flex-wrap: wrap; }
.join-link {
  font-family: var(--font-mono); font-size: 12px;
  word-break: break-all; max-width: 320px;
  background: var(--hover); padding: 8px 10px; border-radius: 6px;
}
`;
  fs.writeFileSync(base + 'renderer/app.css', c);
  console.log('me-strip + join css added');
}

// 2) pickFile 支持 filters
if (!m.includes("filters: ['md']") && m.includes("ipcMain.handle('ccarmy:pick-file'")) {
  m = m.replace(
    `ipcMain.handle('ccarmy:pick-file', async () => {
  if (!win) return { ok: false };
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
  });`,
    `ipcMain.handle('ccarmy:pick-file', async (_e, opts?: { filters?: string[] }) => {
  if (!win) return { ok: false };
  const ext = opts?.filters?.length ? opts.filters : undefined;
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: ext ? [{ name: ext.join('/'), extensions: ext }] : undefined,
  });`
  );
  fs.writeFileSync(base + 'electron-main.ts', m);
  console.log('pick-file filters added');
}

// 3) emailNotify 绑定
if (!j.includes('data-email-k')) {
  j = j.replace(
    `      $('s-email').onchange = (e) => {
        state.emailOnRequest = e.target.checked;
      };`,
    `      document.querySelectorAll('[data-email-k]').forEach((el) => {
        el.onchange = () => {
          state.emailNotify = state.emailNotify || { complete: false, request: true, error: true };
          state.emailNotify[el.dataset.emailK] = el.checked;
          window.ccarmy.settingsSave({ emailNotify: state.emailNotify });
        };
      });`
  );
  console.log('emailNotify bound');
}

// 4) 群聊邀请：链接 + 二维码
if (!j.includes('join-qr')) {
  const anchor = `        <div class="set-section set-card">
          <h2>\${t('mesh.title')}</h2>`;
  j = j.replace(anchor, `        <div class="set-section set-card">
          <h2>\${t('join.title')}</h2>
          <div class="join-row">
            <div class="join-qr" id="join-qr"></div>
            <div>
              <div class="muted" style="margin-bottom:6px">\${t('join.qrHint')}</div>
              <div class="join-link" id="join-link">—</div>
              <div style="margin-top:8px"><button class="btn-mini" id="btn-join-copy">\${t('join.copyLink')}</button>
              <span class="muted" id="join-msg"></span></div>
              <div class="field" style="margin-top:10px">
                <label>\${t('join.scanHint')}</label>
                <input id="join-input" placeholder="\${escapeHtml(t('join.pastePlaceholder'))}"/>
              </div>
              <button class="btn-mini" id="btn-join-accept">\${t('join.accept')}</button>
            </div>
          </div>
        </div>
${anchor}`);
  console.log('join UI inserted');
}

// 5) join 绑定
if (!j.includes('btn-join-copy')) {
  j = j.replace(
    `      // SMTP`,
    `      // 邀请链接 / 二维码
      (async () => {
        const st = await window.ccarmy.meshStatus();
        const node = st?.nodeId || 'local';
        const link = 'ccarmy://join?node=' + encodeURIComponent(node) + '&port=7788';
        const lk = $('join-link');
        if (lk) lk.textContent = link;
        const qr = $('join-qr');
        if (qr) {
          const inv = await window.ccarmy.inviteCreate().catch(() => null);
          const tok = inv?.invite?.token ? '&tok=' + inv.invite.token : '';
          const finalLink = link + tok;
          if (lk) lk.textContent = finalLink;
          try {
            const mod = await import('./qr.js');
            qr.innerHTML = mod.qrSvg(finalLink, 168);
          } catch {
            qr.textContent = finalLink.slice(0, 24) + '…';
          }
        }
      })();
      $('btn-join-copy').onclick = async () => {
        try {
          await navigator.clipboard.writeText($('join-link').textContent);
          $('join-msg').textContent = t('join.copied');
        } catch {
          $('join-msg').textContent = t('join.fail');
        }
      };
      $('btn-join-accept').onclick = () => {
        const v = $('join-input').value.trim();
        if (!v) return;
        $('join-msg').textContent = v.startsWith('ccarmy://') ? t('join.ok') : t('join.fail');
      };

      // SMTP`
  );
  console.log('join bindings added');
}

fs.writeFileSync(base + 'renderer/app.js', j);
console.log('done');
