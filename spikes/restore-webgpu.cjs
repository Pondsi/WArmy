const fs = require('node:fs');
const p = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/renderer/yingYong.js';
let j = fs.readFileSync(p, 'utf8');

if (j.includes('anNiuwebgpu')) {
  console.log('already present');
  process.exit(0);
}

// 在 anNiuBaoCunTeShu 前加 webgpu 按钮
const saveBtn = '          <button class="anNiuXiao" id="anNiuBaoCunTeShu">';
if (j.includes(saveBtn)) {
  j = j.replace(saveBtn,
    '          <div style="margin-top:8px"><button class="anNiuXiao" id="anNiuwebgpu">' +
    "${t('webgpu.test')}" +
    '</button> <span class="jingYin" id="webgpuXiaoXi"></span></div>\n' +
    saveBtn);
  console.log('webgpu button added');
}

// 绑定
const saveBind = "      $('anNiuBaoCunTeShu')?.addEventListener('click',";
if (j.includes(saveBind)) {
  j = j.replace(saveBind,
    `      $('anNiuwebgpu')?.addEventListener('click', async () => {
        $('webgpuXiaoXi').textContent = t('common.loading');
        try {
          if (!navigator.gpu) throw new Error('no navigator.gpu');
          const adapter = await navigator.gpu.requestAdapter();
          if (!adapter) throw new Error('no adapter');
          const info = adapter.info || {};
          $('webgpuXiaoXi').textContent = t('webgpu.ok') + ' · vendor=' + (info.vendor||'') + ' arch=' + (info.architecture||'');
        } catch (e) {
          $('webgpuXiaoXi').textContent = t('webgpu.fail');
        }
      });
${saveBind}`);
  console.log('webgpu binding added');
}

fs.writeFileSync(p, j);
console.log('done, has anNiuwebgpu:', j.includes('anNiuwebgpu'));
