const fs = require('node:fs');
const base = 'C:/Users/p/.openclaw/workspace/大龙虾互动区/WArmy/packages/app-shell/src/renderer/';
let j = fs.readFileSync(base + 'app.js', 'utf8');

// 在 renderInstanceDetail 中插入模型配置区
const anchor = `        <div class="inst-row" style="margin-top:14px">
          <button class="btn-primary" id="i-save"`;
if (!j.includes(anchor)) {
  console.log('anchor not found');
  process.exit(1);
}
if (j.includes('id="i-modelcfg"')) {
  console.log('already present');
  process.exit(0);
}

const modelBlock = `        <div class="set-card" style="margin-top:14px" id="i-modelcfg">
          <h3 style="margin:0 0 10px;font-size:13px">\${t('instances.defaultModel')}</h3>
          <div class="inst-row">
            <div class="field">
              <label>\${t('instances.defaultModel')}</label>
              <select id="i-default-model">
                <option value="__smart__">\${t('instances.smartPick')}</option>
                \${(inst.availableModels || []).map((m) => '<option value="' + escapeHtml(m) + '"' + (inst.defaultModel === m ? ' selected' : '') + '>' + escapeHtml(m) + '</option>').join('')}
              </select>
            </div>
          </div>

          <h3 style="margin:14px 0 8px;font-size:13px">\${t('instances.availableModels')}</h3>
          <label style="display:block;margin-bottom:8px">
            <input type="checkbox" id="i-all-models" \${inst.allModels !== false ? 'checked' : ''}/> \${t('instances.allAvailable')}
          </label>

          <div id="i-all-list" class="\${inst.allModels !== false ? '' : 'hidden'}">
            <div class="model-row">
              \${state.providers.flatMap((p) => (p.models || []).map((m) => p.label + ' · ' + m))
                .map((full) => '<span class="model-chip">' + escapeHtml(full) + '</span>')
                .join('') || '<span class="muted">' + t('settings.modelsEmpty') + '</span>'}
            </div>
          </div>

          <div id="i-manual" class="\${inst.allModels !== false ? 'hidden' : ''}">
            <div class="field" style="margin-bottom:8px">
              <label>\${t('instances.manualAdd')}</label>
            </div>
            <div style="display:grid;grid-template-columns:140px 1fr;gap:8px;max-width:520px">
              <select id="i-prov-pick" size="6">\${state.providers.map((p) => '<option value="' + escapeHtml(p.id) + '">' + escapeHtml(p.label) + '</option>').join('')}</select>
              <select id="i-model-pick" size="6"></select>
            </div>
            <div style="margin-top:8px">
              <button class="btn-mini" id="i-add-model">\${t('instances.addModel')}</button>
            </div>
          </div>

          <h3 style="margin:14px 0 8px;font-size:13px">\${t('instances.fallbackChain')}</h3>
          <div id="i-chain"></div>
        </div>
`;

j = j.replace(anchor, modelBlock + anchor);
fs.writeFileSync(base + 'app.js', j);
console.log('model config block inserted');
