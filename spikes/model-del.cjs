const fs = require('node:fs');
const base = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/renderer/';
let j = fs.readFileSync(base + 'yingYong.js', 'utf8');

// ── 1) 实例模型配置重写：全部可用时隐藏列表；手动模式下添加/删除常显 ──
const oldCfg = j.match(/          <h3 style="margin:14px 0 8px;font-size:13px">\$\{t\('instances\.availableModels'\)\}<\/h3>[\s\S]*?<h3 style="margin:14px 0 8px;font-size:13px">\$\{t\('instances\.fallbackChain'\)\}<\/h3>/);
if (!oldCfg) {
  console.log('WARN: model cfg block not found');
} else {
  j = j.replace(oldCfg[0], `          <h3 style="margin:14px 0 8px;font-size:13px">\${t('instances.availableModels')}</h3>
          <biaoQian style="display:block;margin-bottom:8px">
            <shuRu type="checkbox" id="iAllMoXingJi" \${inst.allModels !== false ? 'checked' : ''}/> \${t('instances.allAvailable')}
          </biaoQian>

          <div id="iManual" class="\${inst.allModels !== false ? 'yinCang' : ''}">
            <div style="display:grid;grid-template-columns:140px 1fr;gap:8px;max-width:520px">
              <select id="iProvXuanZe" size="6">\${state.providers.map((p) => '<option value="' + escapeHtml(p.id) + '">' + escapeHtml(p.biaoQian) + '</option>').join('')}</select>
              <select id="iMoXingXuanZe" size="6"></select>
            </div>
            <div style="margin-top:8px;display:flex;gap:8px;align-items:center">
              <button class="anNiuXiao" id="iTianJiaMoXing">\${t('instances.addModel')}</button>
              <button class="anNiuXiao" id="iDelMoXing">\${t('settings.removeModel')}</button>
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
          manual?.classList.toggle('yinCang', allChk.checked);
          if (allChk.checked) {
            const all = state.providers.flatMap((p) => (p.models || []).map((m) => p.biaoQian + ' · ' + m));
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
        return p.biaoQian + ' · ' + m;
      }

      function updateAddDelState() {
        const full = selectedFull();
        const inChain = full && (inst2.chain || []).includes(full);
        const addBtn = $('iTianJiaMoXing');
        const delBtn = $('iDelMoXing');
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

      $('iTianJiaMoXing')?.addEventListener('click', () => {
        const full = selectedFull();
        if (!full) return;
        inst2.availableModels = [...new Set([...(inst2.availableModels || []), full])];
        inst2.chain = [...new Set([...(inst2.chain || []), full])];
        const sel = $('iDefaultMoXing');
        if (sel && ![...sel.options].some((o) => o.value === full)) {
          const opt = document.createElement('option');
          opt.value = full;
          opt.textContent = full;
          sel.appendChild(opt);
        }
        renderChain();
        updateAddDelState();
      });

      $('iDelMoXing')?.addEventListener('click', () => {
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
          '<div class="provHead">' + escapeHtml(pr.biaoQian) + '</div>' +`;
if (j.includes(provHead)) {
  j = j.replace(
    provHead,
    `        el.innerHTML =
          '<div class="provHead" style="display:flex;justify-content:space-between;align-items:center">' +
          '<span>' + escapeHtml(pr.biaoQian) + '</span>' +
          '<button class="anNiuXiao" data-prov-del="' + escapeHtml(pr.id) + '" biaoTi="' + t('settings.pluginUninstall') + '">' + t('settings.pluginUninstall') + '</button>' +
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
  console.log('WARN: provHead anchor not found');
}

fs.writeFileSync(base + 'yingYong.js', j);
console.log('done');
