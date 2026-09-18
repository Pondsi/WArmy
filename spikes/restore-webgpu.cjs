const fs = require('node:fs');
const p = 'C:/Users/p/.openclaw/workspace/大龙虾互动区/WArmy/packages/app-shell/src/renderer/app.js';
let j = fs.readFileSync(p, 'utf8');

if (j.includes('btn-webgpu')) {
  console.log('already present');
  process.exit(0);
}

// 在 btn-save-special 前加 webgpu 按钮
const saveBtn = '          <button class="btn-mini" id="btn-save-special">';
if (j.includes(saveBtn)) {
  j = j.replace(saveBtn,
    '          <div style="margin-top:8px"><button class="btn-mini" id="btn-webgpu">' +
    "${t('webgpu.test')}" +
    '</button> <span class="muted" id="webgpu-msg"></span></div>\n' +
    saveBtn);
  console.log('webgpu button added');
}

// 绑定
const saveBind = "      $('btn-save-special')?.addEventListener('click',";
if (j.includes(saveBind)) {
  j = j.replace(saveBind,
    `      $('btn-webgpu')?.addEventListener('click', async () => {
        $('webgpu-msg').textContent = t('common.loading');
        try {
          if (!navigator.gpu) throw new Error('no navigator.gpu');
          const adapter = await navigator.gpu.requestAdapter();
          if (!adapter) throw new Error('no adapter');
          const info = adapter.info || {};
          $('webgpu-msg').textContent = t('webgpu.ok') + ' · vendor=' + (info.vendor||'') + ' arch=' + (info.architecture||'');
        } catch (e) {
          $('webgpu-msg').textContent = t('webgpu.fail');
        }
      });
${saveBind}`);
  console.log('webgpu binding added');
}

fs.writeFileSync(p, j);
console.log('done, has btn-webgpu:', j.includes('btn-webgpu'));
