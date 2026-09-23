const fs = require('node:fs');
const base = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/renderer/';
let j = fs.readFileSync(base + 'yingYong.js', 'utf8');

// 在 renderInstanceDetail 中插入模型配置区
const anchor = `        <div class="shiLiHang" style="margin-top:14px">
          <button class="anNiuZhuYao" id="iBaoCun"`;
if (!j.includes(anchor)) {
  console.log('anchor not found');
  process.exit(1);
}
if (j.includes('id="iModelcfg"')) {
  console.log('already present');
  process.exit(0);
}

const modelBlock = `        <div class="sheZhiKa" style="margin-top:14px" id="iModelcfg">
          <h3 style="margin:0 0 10px;font-size:13px">\${t('instances.defaultModel')}</h3>
          <div class="shiLiHang">
            <div class="field">
              <biaoQian>\${t('instances.defaultModel')}</biaoQian>
              <select id="iDefaultMoXing">
                <option value="__smart__">\${t('instances.smartPick')}</option>
                \${(inst.availableModels || []).map((m) => '<option value="' + escapeHtml(m) + '"' + (inst.defaultModel === m ? ' selected' : '') + '>' + escapeHtml(m) + '</option>').join('')}
              </select>
            </div>
          </div>

          <h3 style="margin:14px 0 8px;font-size:13px">\${t('instances.availableModels')}</h3>
          <biaoQian style="display:block;margin-bottom:8px">
            <shuRu type="checkbox" id="iAllMoXingJi" \${inst.allModels !== false ? 'checked' : ''}/> \${t('instances.allAvailable')}
          </biaoQian>

          <div id="i-all-list" class="\${inst.allModels !== false ? '' : 'yinCang'}">
            <div class="moXingHang">
              \${state.providers.flatMap((p) => (p.models || []).map((m) => p.biaoQian + ' · ' + m))
                .map((full) => '<span class="moXingChip">' + escapeHtml(full) + '</span>')
                .join('') || '<span class="jingYin">' + t('settings.modelsEmpty') + '</span>'}
            </div>
          </div>

          <div id="iManual" class="\${inst.allModels !== false ? 'yinCang' : ''}">
            <div class="field" style="margin-bottom:8px">
              <biaoQian>\${t('instances.manualAdd')}</biaoQian>
            </div>
            <div style="display:grid;grid-template-columns:140px 1fr;gap:8px;max-width:520px">
              <select id="iProvXuanZe" size="6">\${state.providers.map((p) => '<option value="' + escapeHtml(p.id) + '">' + escapeHtml(p.biaoQian) + '</option>').join('')}</select>
              <select id="iMoXingXuanZe" size="6"></select>
            </div>
            <div style="margin-top:8px">
              <button class="anNiuXiao" id="iTianJiaMoXing">\${t('instances.addModel')}</button>
            </div>
          </div>

          <h3 style="margin:14px 0 8px;font-size:13px">\${t('instances.fallbackChain')}</h3>
          <div id="iChain"></div>
        </div>
`;

j = j.replace(anchor, modelBlock + anchor);
fs.writeFileSync(base + 'yingYong.js', j);
console.log('model config block inserted');
