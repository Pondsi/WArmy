const fs = require('node:fs');
const p = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/renderer/yingYong.js';
let j = fs.readFileSync(p, 'utf8');

const anchor = `      document.querySelectorAll('[data-clear]').forEach((b) => {
        b.onclick = () => {
          state.soundFiles[b.dataset.clear] = '';
          renderPage();
        };
      });
    }
  }
  /* renderPage-end */`;

const block = `      document.querySelectorAll('[data-clear]').forEach((b) => {
        b.onclick = () => {
          state.soundFiles[b.dataset.clear] = '';
          renderPage();
        };
      });

      // ── SMTP 多账号（最多 10） ──
      async function renderSmtpList() {
        const r = await window.warmy.smtpList();
        const accounts = r?.accounts || [];
        const n = $('smtpN');
        if (n) n.textContent = String(accounts.length);
        const box = $('smtpAccounts');
        if (!box) return;
        if (!accounts.length) {
          box.innerHTML = '<div class="jingYin">' + t('smtp.empty') + '</div>';
          return;
        }
        box.innerHTML = accounts
          .map(
            (a) =>
              '<div class="provKa" style="margin-bottom:8px" data-id="' + escapeHtml(a.id) + '">' +
              '<div class="shiLiHang">' +
              '<div><b>' + escapeHtml(a.biaoQian) + '</b> <span class="jingYin">' + escapeHtml(a.user) + '@' + escapeHtml(a.host) + ':' + a.port + '</span></div>' +
              '<span class="huiZhang ' + (a.verified ? '' : 'off') + '">' + (a.verified ? t('smtp.verified') : t('smtp.unverified')) + '</span>' +
              '<button class="anNiuXiao" data-v="' + escapeHtml(a.id) + '">' + t('smtp.verify') + '</button>' +
              '<button class="anNiuXiao" data-x="' + escapeHtml(a.id) + '">' + t('smtp.remove') + '</button>' +
              '</div></div>'
          )
          .join('');
        box.querySelectorAll('[data-x]').forEach((b) => {
          b.onclick = async () => {
            await window.warmy.smtpRemove(b.dataset.x);
            renderSmtpList();
          };
        });
        box.querySelectorAll('[data-v]').forEach((b) => {
          b.onclick = async () => {
            const id = b.dataset.v;
            const full = (state.smtpFull || []).find((x) => x.id === id);
            if (!full) {
              $('smtpXiaoXi').textContent = t('smtp.fail');
              return;
            }
            $('smtpXiaoXi').textContent = t('common.loading');
            const vr = await window.warmy.smtpVerify({ ...full, id });
            $('smtpXiaoXi').textContent = vr?.ok ? t('smtp.ok') : t('smtp.fail') + ': ' + (vr?.message || '');
            renderSmtpList();
          };
        });
      }
      renderSmtpList();

      $('anNiusmtpTianJia').onclick = async () => {
        const acc = {
          biaoQian: $('smtpBiaoQian').value.trim(),
          host: $('smtpHost').value.trim(),
          port: parseInt($('smtpDuanKou').value, 10) || 465,
          secure: $('smtpAnQuan').checked,
          user: $('smtpUser').value.trim(),
          pass: $('smtpPass').value,
        };
        if (!acc.host || !acc.user) {
          $('smtpXiaoXi').textContent = t('common.error');
          return;
        }
        const r = await window.warmy.smtpAdd(acc);
        if (r?.ok) {
          state.smtpFull = (state.smtpFull || []).concat([acc]);
          ['smtpBiaoQian', 'smtpHost', 'smtpUser', 'smtpPass'].forEach((id) => {
            const el = $(id);
            if (el) el.value = '';
          });
          $('smtpXiaoXi').textContent = t('instances.saved');
        } else {
          $('smtpXiaoXi').textContent = String(r?.error || t('common.error'));
        }
        renderSmtpList();
      };

      // ── 模型供应商（含拉取模型/删除/默认模型） ──
      const prov = $('provLieBiao');
      state.providers.forEach((pr) => {
        const el = document.createElement('div');
        el.className = 'provKa';
        el.innerHTML =
          '<div class="provHead">' + escapeHtml(pr.biaoQian) + '</div>' +
          '<div class="shiLiHang">' +
          '<div class="field"><biaoQian>' + t('settings.providerName') + '</biaoQian><shuRu data-k="biaoQian" value="' + escapeHtml(pr.biaoQian) + '"/></div>' +
          '<div class="field"><biaoQian>' + t('settings.baseUrl') + '</biaoQian><shuRu data-k="baseURL" value="' + escapeHtml(pr.baseURL) + '"/></div>' +
          '<div class="field"><biaoQian>' + t('settings.apiKey') + '</biaoQian><shuRu data-k="apiKey" type="password" value="' + escapeHtml(pr.apiKey || '') + '"/></div>' +
          '</div>' +
          '<div class="provDongZuoJi"><button class="anNiuXiao" data-fetch>' + t('settings.fetchModels') + '</button></div>' +
          '<div class="moXingHang">' +
          (((pr.models || [])
            .map(
              (m) =>
                '<span class="moXingChip" data-m="' + escapeHtml(m) + '">' + escapeHtml(m) +
                '<button class="x" data-del="' + escapeHtml(m) + '" biaoTi="' + t('settings.removeModel') + '">×</button></span>'
            )
            .join('')) || '<span class="jingYin">' + t('settings.modelsEmpty') + '</span>') +
          '</div>';
        el.querySelectorAll('shuRu[data-k]').forEach((inp) => {
          inp.onchange = () => {
            pr[inp.dataset.k] = inp.value;
            if (inp.dataset.k === 'biaoQian') el.querySelector('.provHead').textContent = inp.value;
            window.warmy.setProvider({
              presetId: pr.id,
              apiKey: pr.apiKey,
              baseURL: pr.baseURL,
              model: providerCfgModel(pr),
              protocol: pr.protocol,
            });
          };
        });
        el.querySelector('[data-fetch]').onclick = async () => {
          const btn = el.querySelector('[data-fetch]');
          btn.textContent = t('common.loading');
          await window.warmy.setProvider({
            presetId: pr.id,
            apiKey: pr.apiKey,
            baseURL: pr.baseURL,
            protocol: pr.protocol,
            model: providerCfgModel(pr),
          });
          const r = await window.warmy.listModels({ protocol: pr.protocol, baseURL: pr.baseURL, apiKey: pr.apiKey });
          if (r?.ok && r.models?.length) {
            pr.models = [...new Set([...(pr.models || []), ...r.models])];
          }
          renderPage();
        };
        el.querySelectorAll('[data-del]').forEach((btn) => {
          btn.onclick = (e) => {
            e.stopPropagation();
            pr.models = (pr.models || []).filter((m) => m !== btn.dataset.del);
            renderPage();
          };
        });
        el.querySelectorAll('.moXingChip').forEach((chip) => {
          chip.onclick = async () => {
            pr.defaultModel = chip.dataset.m;
            await window.warmy.setProvider({
              presetId: pr.id,
              apiKey: pr.apiKey,
              baseURL: pr.baseURL,
              model: pr.defaultModel,
              protocol: pr.protocol,
            });
            renderPage();
          };
        });
        prov.appendChild(el);
      });
      $('anNiuTianJiaProv').onclick = () => {
        state.providers.push({
          id: 'custom-' + Date.now(),
          biaoQian: 'Custom',
          protocol: 'openai-compatible',
          baseURL: '',
          defaultModel: '',
          apiKey: '',
          models: [],
        });
        renderPage();
      };
    }
  }
  /* renderPage-end */`;

if (!j.includes('renderSmtpList')) {
  j = j.replace(anchor, block);
  fs.writeFileSync(p, j);
  console.log('restored smtp + provider bindings');
} else {
  console.log('already present');
}
