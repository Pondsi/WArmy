const fs = require('node:fs');
const base = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/renderer/';
let j = fs.readFileSync(base + 'yingYong.js', 'utf8');

const anchor = '    (function bindModelConfig() {';
const ins = `    // ── 牛马头像 + 认知注入 ──
    (function bindInstanceAvatarCognition() {
      if (!inst.cognitionFiles) inst.cognitionFiles = [];
      const list = $('iCogLieBiao');
      function renderCog() {
        if (!list) return;
        list.innerHTML =
          inst.cognitionFiles
            .map(
              (f, i) =>
                '<div class="shiLiHang" style="margin:4px 0"><span style="flex:1">' +
                escapeHtml(f.name) +
                '</span><span class="jingYin">' + escapeHtml(String(f.size || 0)) + ' B</span>' +
                '<button class="anNiuXiao" data-cog-del="' + i + '">' + t('mesh.remove') + '</button></div>'
            )
            .join('') || '<div class="jingYin">' + t('instances.cognitionEmpty') + '</div>';
        list.querySelectorAll('[data-cog-del]').forEach((b) => {
          b.onclick = () => {
            inst.cognitionFiles.splice(Number(b.dataset.cogDel), 1);
            renderCog();
          };
        });
      }
      renderCog();

      $('iAvAnNiu')?.addEventListener('click', () => {
        pendingAvatarTarget = { kind: 'instance', inst };
        $('touXiangWenJian').click();
      });

      $('iCogTianJia')?.addEventListener('click', async () => {
        const r = await window.warmy.pickFile({ filters: ['md'] });
        if (!r?.ok) return;
        const ming = r.path.split(/[\\\\/]/).pop();
        inst.cognitionFiles.push({ ming, path: r.path, size: 0 });
        renderCog();
      });
    })();

`;

if (!j.includes('bindInstanceAvatarCognition')) {
  j = j.replace(anchor, ins + anchor);
  fs.writeFileSync(base + 'yingYong.js', j);
  console.log('instance touXiang/cognition bound');
} else {
  console.log('already bound');
}
