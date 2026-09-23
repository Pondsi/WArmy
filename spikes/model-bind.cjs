const fs = require('node:fs');
const base = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/renderer/';
let j = fs.readFileSync(base + 'yingYong.js', 'utf8');

const anchor = `    $('iDel').onclick = async () => {`;
if (!j.includes(anchor)) {
  console.log('anchor missing');
  process.exit(1);
}
if (j.includes('bindModelConfig')) {
  console.log('bindings already present');
  process.exit(0);
}

const bind = `    // ── 模型配置：默认模型 / 全部可用 / 手动添加 / 调用链 ──
    (function bindModelConfig() {
      const inst2 = inst;
      if (!inst2.availableModels) inst2.availableModels = [];
      if (inst2.allModels === undefined) inst2.allModels = true;
      if (!inst2.chain) inst2.chain = [...inst2.availableModels];

      const defSel = $('iDefaultMoXing');
      const allChk = $('iAllMoXingJi');
      const allList = $('i-all-list');
      const manual = $('iManual');
      const provPick = $('iProvXuanZe');
      const modelPick = $('iMoXingXuanZe');
      const chainBox = $('iChain');

      function renderChain() {
        if (!chainBox) return;
        const list = inst2.chain || [];
        chainBox.innerHTML =
          list
            .map(
              (m, i) =>
                '<div class="shiLiHang" style="margin:4px 0">' +
                '<span style="flex:1">' + escapeHtml(m) + '</span>' +
                '<button class="anNiuXiao" data-up="' + i + '">' + t('instances.moveUp') + '</button>' +
                '<button class="anNiuXiao" data-down="' + i + '">' + t('instances.moveDown') + '</button>' +
                '</div>'
            )
            .join('') || '<div class="jingYin">' + t('settings.modelsEmpty') + '</div>';
        chainBox.querySelectorAll('[data-up]').forEach((b) => {
          b.onclick = () => {
            const i = Number(b.dataset.up);
            if (i <= 0) return;
            const arr = inst2.chain;
            [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
            renderChain();
          };
        });
        chainBox.querySelectorAll('[data-down]').forEach((b) => {
          b.onclick = () => {
            const i = Number(b.dataset.down);
            const arr = inst2.chain;
            if (i >= arr.length - 1) return;
            [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
            renderChain();
          };
        });
      }
      renderChain();

      // 全部可用：勾选 → 显示全部；取消 → 手动添加
      if (allChk) {
        allChk.onchange = () => {
          inst2.allModels = allChk.checked;
          allList?.classList.toggle('yinCang', !allChk.checked);
          manual?.classList.toggle('yinCang', allChk.checked);
          if (allChk.checked) {
            const all = state.providers.flatMap((p) => (p.models || []).map((m) => p.biaoQian + ' · ' + m));
            inst2.availableModels = all;
            inst2.chain = [...all];
            renderChain();
            renderPageCurrentInstanceOptions();
          }
        };
      }

      // 两列选择器：左供应商 → 右模型
      function fillModels() {
        if (!provPick || !modelPick) return;
        const p = state.providers.find((x) => x.id === provPick.value) || state.providers[0];
        modelPick.innerHTML = (p?.models || [])
          .map((m) => '<option value="' + escapeHtml(m) + '">' + escapeHtml(m) + '</option>')
          .join('');
      }
      if (provPick) {
        provPick.onchange = fillModels;
        fillModels();
      }
      const addBtn = $('iTianJiaMoXing');
      if (addBtn) {
        addBtn.onclick = () => {
          const p = state.providers.find((x) => x.id === provPick.value);
          const m = modelPick.value;
          if (!p || !m) return;
          const full = p.biaoQian + ' · ' + m;
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
        };
      }

      if (defSel) {
        defSel.onchange = () => {
          inst2.defaultModel = defSel.value === '__smart__' ? '' : defSel.value;
        };
      }
    })();

    function renderPageCurrentInstanceOptions() {
      const sel = $('iDefaultMoXing');
      if (!sel) return;
      const cur = inst2DefaultModel();
      sel.innerHTML =
        '<option value="__smart__">' + t('instances.smartPick') + '</option>' +
        (inst.availableModels || [])
          .map((m) => '<option value="' + escapeHtml(m) + '"' + (cur === m ? ' selected' : '') + '>' + escapeHtml(m) + '</option>')
          .join('');
      function inst2DefaultModel() {
        return inst.defaultModel || '';
      }
    }

    $('iDel').onclick = async () => {`;

j = j.replace(anchor, bind);
fs.writeFileSync(base + 'yingYong.js', j);
console.log('model bindings inserted');
