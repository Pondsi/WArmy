const fs = require('node:fs');
const p = 'C:/Users/p/.openclaw/workspace/大龙虾互动区/WArmy/packages/app-shell/src/renderer/app.js';
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
        const n = $('smtp-n');
        if (n) n.textContent = String(accounts.length);
        const box = $('smtp-accounts');
        if (!box) return;
        if (!accounts.length) {
          box.innerHTML = '<div class="muted">' + t('smtp.empty') + '</div>';
          return;
        }
        box.innerHTML = accounts
          .map(
            (a) =>
              '<div class="prov-card" style="margin-bottom:8px" data-id="' + escapeHtml(a.id) + '">' +
              '<div class="inst-row">' +
              '<div><b>' + escapeHtml(a.label) + '</b> <span class="muted">' + escapeHtml(a.user) + '@' + escapeHtml(a.host) + ':' + a.port + '</span></div>' +
              '<span class="badge ' + (a.verified ? '' : 'off') + '">' + (a.verified ? t('smtp.verified') : t('smtp.unverified')) + '</span>' +
              '<button class="btn-mini" data-v="' + escapeHtml(a.id) + '">' + t('smtp.verify') + '</button>' +
              '<button class="btn-mini" data-x="' + escapeHtml(a.id) + '">' + t('smtp.remove') + '</button>' +
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
              $('smtp-msg').textContent = t('smtp.fail');
              return;
            }
            $('smtp-msg').textContent = t('common.loading');
            const vr = await window.warmy.smtpVerify({ ...full, id });
            $('smtp-msg').textContent = vr?.ok ? t('smtp.ok') : t('smtp.fail') + ': ' + (vr?.message || '');
            renderSmtpList();
          };
        });
      }
      renderSmtpList();

      $('btn-smtp-add').onclick = async () => {
        const acc = {
          label: $('smtp-label').value.trim(),
          host: $('smtp-host').value.trim(),
          port: parseInt($('smtp-port').value, 10) || 465,
          secure: $('smtp-secure').checked,
          user: $('smtp-user').value.trim(),
          pass: $('smtp-pass').value,
        };
        if (!acc.host || !acc.user) {
          $('smtp-msg').textContent = t('common.error');
          return;
        }
        const r = await window.warmy.smtpAdd(acc);
        if (r?.ok) {
          state.smtpFull = (state.smtpFull || []).concat([acc]);
          ['smtp-label', 'smtp-host', 'smtp-user', 'smtp-pass'].forEach((id) => {
            const el = $(id);
            if (el) el.value = '';
          });
          $('smtp-msg').textContent = t('instances.saved');
        } else {
          $('smtp-msg').textContent = String(r?.error || t('common.error'));
        }
        renderSmtpList();
      };

      // ── 模型供应商（含拉取模型/删除/默认模型） ──
      const prov = $('prov-list');
      state.providers.forEach((pr) => {
        const el = document.createElement('div');
        el.className = 'prov-card';
        el.innerHTML =
          '<div class="prov-head">' + escapeHtml(pr.label) + '</div>' +
          '<div class="inst-row">' +
          '<div class="field"><label>' + t('settings.providerName') + '</label><input data-k="label" value="' + escapeHtml(pr.label) + '"/></div>' +
          '<div class="field"><label>' + t('settings.baseUrl') + '</label><input data-k="baseURL" value="' + escapeHtml(pr.baseURL) + '"/></div>' +
          '<div class="field"><label>' + t('settings.apiKey') + '</label><input data-k="apiKey" type="password" value="' + escapeHtml(pr.apiKey || '') + '"/></div>' +
          '</div>' +
          '<div class="prov-actions"><button class="btn-mini" data-fetch>' + t('settings.fetchModels') + '</button></div>' +
          '<div class="model-row">' +
          (((pr.models || [])
            .map(
              (m) =>
                '<span class="model-chip" data-m="' + escapeHtml(m) + '">' + escapeHtml(m) +
                '<button class="x" data-del="' + escapeHtml(m) + '" title="' + t('settings.removeModel') + '">×</button></span>'
            )
            .join('')) || '<span class="muted">' + t('settings.modelsEmpty') + '</span>') +
          '</div>';
        el.querySelectorAll('input[data-k]').forEach((inp) => {
          inp.onchange = () => {
            pr[inp.dataset.k] = inp.value;
            if (inp.dataset.k === 'label') el.querySelector('.prov-head').textContent = inp.value;
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
        el.querySelectorAll('.model-chip').forEach((chip) => {
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
      $('btn-add-prov').onclick = () => {
        state.providers.push({
          id: 'custom-' + Date.now(),
          label: 'Custom',
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
