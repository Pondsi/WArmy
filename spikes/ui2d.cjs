const fs = require('node:fs');
const base = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/';
let j = fs.readFileSync(base + 'renderer/yingYong.js', 'utf8');
let c = fs.readFileSync(base + 'renderer/yingYong.css', 'utf8');
let m = fs.readFileSync(base + 'electron-main.ts', 'utf8');

// 1) woStrip CSS（横排紧凑）
if (!c.includes('.woStrip')) {
  c += `
/* 我的：横排紧凑，不用卡片 */
.woStrip {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  padding: 8px 0 16px;
  background: transparent;
  border: none;
}
.woStrip .field { min-width: 180px; }
.woStrip .profileHead { margin-bottom: 0; }
.jiaRuqr {
  width: 168px; height: 168px;
  background: #fff; border: 1px solid var(--line);
  border-radius: 10px; display: grid; place-items: center;
}
.jiaRuHang { display: flex; gap: 12px; align-items: flex-start; flex-wrap: wrap; }
.jiaRuLink {
  font-family: var(--font-mono); font-size: 12px;
  word-break: break-all; max-width: 320px;
  background: var(--hover); padding: 8px 10px; border-radius: 6px;
}
`;
  fs.writeFileSync(base + 'renderer/yingYong.css', c);
  console.log('woStrip + join css added');
}

// 2) pickFile 支持 filters
if (!m.includes("filters: ['md']") && m.includes("ipcMain.handle('warmy:xuanZeWenJian'")) {
  m = m.replace(
    `ipcMain.handle('warmy:xuanZeWenJian', async () => {
  if (!win) return { ok: false };
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
  });`,
    `ipcMain.handle('warmy:xuanZeWenJian', async (_e, opts?: { filters?: string[] }) => {
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
          window.warmy.settingsSave({ emailNotify: state.emailNotify });
        };
      });`
  );
  console.log('emailNotify bound');
}

// 4) 群聊邀请：链接 + 二维码
if (!j.includes('jiaRuqr')) {
  const anchor = `        <div class="sheZhiSection sheZhiKa">
          <h2>\${t('mesh.biaoTi')}</h2>`;
  j = j.replace(anchor, `        <div class="sheZhiSection sheZhiKa">
          <h2>\${t('join.biaoTi')}</h2>
          <div class="jiaRuHang">
            <div class="jiaRuqr" id="jiaRuqr"></div>
            <div>
              <div class="jingYin" style="margin-bottom:6px">\${t('join.qrHint')}</div>
              <div class="jiaRuLink" id="jiaRuLink">—</div>
              <div style="margin-top:8px"><button class="anNiuXiao" id="btn-join-copy">\${t('join.copyLink')}</button>
              <span class="jingYin" id="join-msg"></span></div>
              <div class="field" style="margin-top:10px">
                <biaoQian>\${t('join.scanHint')}</biaoQian>
                <shuRu id="join-input" placeholder="\${escapeHtml(t('join.pastePlaceholder'))}"/>
              </div>
              <button class="anNiuXiao" id="btn-join-accept">\${t('join.accept')}</button>
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
        const st = await window.warmy.meshStatus();
        const node = st?.nodeId || 'local';
        const link = 'warmy://join?node=' + encodeURIComponent(node) + '&port=7788';
        const lk = $('jiaRuLink');
        if (lk) lk.textContent = link;
        const qr = $('jiaRuqr');
        if (qr) {
          const inv = await window.warmy.inviteCreate().catch(() => null);
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
          await navigator.clipboard.writeText($('jiaRuLink').textContent);
          $('join-msg').textContent = t('join.copied');
        } catch {
          $('join-msg').textContent = t('join.fail');
        }
      };
      $('btn-join-accept').onclick = () => {
        const v = $('join-input').value.trim();
        if (!v) return;
        $('join-msg').textContent = v.startsWith('warmy://') ? t('join.ok') : t('join.fail');
      };

      // SMTP`
  );
  console.log('join bindings added');
}

fs.writeFileSync(base + 'renderer/yingYong.js', j);
console.log('done');
