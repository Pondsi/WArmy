const fs = require('node:fs');
const base = 'C:/Users/p/.openclaw/workspace/大龙虾互动区/WArmy/packages/app-shell/src/renderer/';
let j = fs.readFileSync(base + 'app.js', 'utf8');

// ── 1) 实例模型配置重写：全部可用时隐藏列表；手动模式下添加/删除常显 ──
const oldCfg = j.match(/          <h3 style="margin:14px 0 8px;font-size:13px">\$\{t\('instances\.availableModels'\)\}<\/h3>[\s\S]*?<h3 style="margin:14px 0 8px;font-size:13px">\$\{t\('instances\.fallbackChain'\)\}<\/h3>/);
if (!oldCfg) {
  console.log('WARN: model cfg block not found');
} else {
  j = j.replace(oldCfg[0], `          <h3 style="margin:14px 0 8px;font-size:13px">\${t('instances.availableModels')}</h3>
          <label style="display:block;margin-bottom:8px">
            <input type="checkbox" id="i-all-models" \${inst.allModels !== false ? 'checked' : ''}/> \${t('instances.allAvailable')}
          </label>

          <div id="i-manual" class="\${inst.allModels !== false ? 'hidden' : ''}">
            <div style="display:grid;grid-template-columns:140px 1fr;gap:8px;max-width:520px">
              <select id="i-prov-pick" size="6">\${state.providers.map((p) => '<option value="' + escapeHtml(p.id) + '">' + escapeHtml(p.label) + '</option>').join('')}</select>
              <select id="i-model-pick" size="6"></select>
            </div>
            <div style="margin-top:8px;display:flex;gap:8px;align-items:center">
              <button class="btn-mini" id="i-add-model">\${t('instances.addModel')}</button>
              <button class="btn-mini" id="i-del-model">\${t('settings.removeModel')}</button>
            </div>
          </div>

          <h3 style="margin:14px 0 8px;font-size:13px">\${t('instances.fallbackChain')}</h3>`);
  console.log('model cfg rewritten');
}

// 绑定逻辑重写
const oldBind = j.match(/      \/\/ 全部可用：勾选 → 显示全部；取消 → 手动添加[\s\S]*?      \/\/ 两列选择器：左供应商 → 右模型[\s\S]*?      if \(defSel\) \{[\s\S]*?      \}\n    \}\)\(\);/);
if (!oldBind) {
  console.log('WARN: bind block not found, will patch pieces');
} else {
  j = j.replace(oldBind[0], `      // 全部可用：勾选时不显示模型列表；取消时进入手动添加
      if (allChk) {
        allChk.onchange = () => {
          inst2.allModels = allChk.checked;
          manual?.classList.toggle('hidden', allChk.checked);
          if (allChk.checked) {
            const all = state.providers.flatMap((p) => (p.models || []).map((m) => p.label + ' · ' + m));
            inst2.availableModels = all;
            inst2.chain = [...all];
            renderChain();
          }
          updateAddDelState();
        };
      }

      // 两列选择器：左供应商 → 右模型
      function fillModels() {
        if (!provPick || !modelPick) return;
        const p = state.providers.find((x) => x.id === provPick.value) || state.providers[0];
        modelPick.innerHTML = (p?.models || [])
          .map((m) => '<option value="' + escapeHtml(m) + '">' + escapeHtml(m) + '</option>')
          .join('');
        updateAddDelState();
      }

      function selectedFull() {
        const p = state.providers.find((x) => x.id === provPick?.value);
        const m = modelPick?.value;
        if (!p || !m) return '';
        return p.label + ' · ' + m;
      }

      function updateAddDelState() {
        const full = selectedFull();
        const inChain = full && (inst2.chain || []).includes(full);
        const addBtn = $('i-add-model');
        const delBtn = $('i-del-model');
        if (addBtn) {
          addBtn.disabled = !full || inChain;
          addBtn.style.opacity = addBtn.disabled ? 0.45 : 1;
        }
        if (delBtn) {
          delBtn.disabled = !full || !inChain;
          delBtn.style.opacity = delBtn.disabled ? 0.45 : 1;
        }
      }

      if (provPick) {
        provPick.onchange = fillModels;
        fillModels();
      }
      modelPick?.addEventListener('change', updateAddDelState);

      $('i-add-model')?.addEventListener('click', () => {
        const full = selectedFull();
        if (!full) return;
        inst2.availableModels = [...new Set([...(inst2.availableModels || []), full])];
        inst2.chain = [...new Set([...(inst2.chain || []), full])];
        const sel = $('i-default-model');
        if (sel && ![...sel.options].some((o) => o.value === full)) {
          const opt = document.createElement('option');
          opt.value = full;
          opt.textContent = full;
          sel.appendChild(opt);
        }
        renderChain();
        updateAddDelState();
      });

      $('i-del-model')?.addEventListener('click', () => {
        const full = selectedFull();
        if (!full) return;
        inst2.chain = (inst2.chain || []).filter((x) => x !== full);
        inst2.availableModels = (inst2.availableModels || []).filter((x) => x !== full);
        renderChain();
        updateAddDelState();
      });

      if (defSel) {
        defSel.onchange = () => {
          inst2.defaultModel = defSel.value === '__smart__' ? '' : defSel.value;
        };
      }
    })();`);
  console.log('bind rewritten');
}

// ── 2) 供应商删除按钮 ──
const provHead = `        el.innerHTML =
          '<div class="prov-head">' + escapeHtml(pr.label) + '</div>' +`;
if (j.includes(provHead)) {
  j = j.replace(
    provHead,
    `        el.innerHTML =
          '<div class="prov-head" style="display:flex;justify-content:space-between;align-items:center">' +
          '<span>' + escapeHtml(pr.label) + '</span>' +
          '<button class="btn-mini" data-prov-del="' + escapeHtml(pr.id) + '" title="' + t('settings.pluginUninstall') + '">' + t('settings.pluginUninstall') + '</button>' +
          '</div>' +`
  );
  // 删除绑定
  j = j.replace(
    `        el.querySelectorAll('[data-del]').forEach((btn) => {
          btn.onclick = (e) => {
            e.stopPropagation();
            pr.models = (pr.models || []).filter((m) => m !== btn.dataset.del);
            renderPage();
          };
        });`,
    `        el.querySelectorAll('[data-del]').forEach((btn) => {
          btn.onclick = (e) => {
            e.stopPropagation();
            pr.models = (pr.models || []).filter((m) => m !== btn.dataset.del);
            renderPage();
          };
        });
        el.querySelector('[data-prov-del]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          state.providers = state.providers.filter((x) => x.id !== pr.id);
          renderPage();
        });`
  );
  console.log('provider delete added');
} else {
  console.log('WARN: prov-head anchor not found');
}

fs.writeFileSync(base + 'app.js', j);
console.log('done');
