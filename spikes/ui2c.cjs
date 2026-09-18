const fs = require('node:fs');
const base = 'C:/Users/p/.openclaw/workspace/大龙虾互动区/WArmy/packages/app-shell/src/renderer/';
let j = fs.readFileSync(base + 'app.js', 'utf8');

const anchor = '    (function bindModelConfig() {';
const ins = `    // ── 牛马头像 + 认知注入 ──
    (function bindInstanceAvatarCognition() {
      if (!inst.cognitionFiles) inst.cognitionFiles = [];
      const list = $('i-cog-list');
      function renderCog() {
        if (!list) return;
        list.innerHTML =
          inst.cognitionFiles
            .map(
              (f, i) =>
                '<div class="inst-row" style="margin:4px 0"><span style="flex:1">' +
                escapeHtml(f.name) +
                '</span><span class="muted">' + escapeHtml(String(f.size || 0)) + ' B</span>' +
                '<button class="btn-mini" data-cog-del="' + i + '">' + t('mesh.remove') + '</button></div>'
            )
            .join('') || '<div class="muted">' + t('instances.cognitionEmpty') + '</div>';
        list.querySelectorAll('[data-cog-del]').forEach((b) => {
          b.onclick = () => {
            inst.cognitionFiles.splice(Number(b.dataset.cogDel), 1);
            renderCog();
          };
        });
      }
      renderCog();

      $('i-av-btn')?.addEventListener('click', () => {
        pendingAvatarTarget = { kind: 'instance', inst };
        $('avatar-file').click();
      });

      $('i-cog-add')?.addEventListener('click', async () => {
        const r = await window.warmy.pickFile({ filters: ['md'] });
        if (!r?.ok) return;
        const name = r.path.split(/[\\\\/]/).pop();
        inst.cognitionFiles.push({ name, path: r.path, size: 0 });
        renderCog();
      });
    })();

`;

if (!j.includes('bindInstanceAvatarCognition')) {
  j = j.replace(anchor, ins + anchor);
  fs.writeFileSync(base + 'app.js', j);
  console.log('instance avatar/cognition bound');
} else {
  console.log('already bound');
}
