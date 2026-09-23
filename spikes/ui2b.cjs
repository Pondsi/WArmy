const fs = require('node:fs');
const base = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/renderer/';
let j = fs.readFileSync(base + 'yingYong.js', 'utf8');

// 1) 实例头像 + 认知注入绑定（插在模型配置绑定前）
const anchor = `    // ── 模型配置：默认模型 / 全部可用 / 手动添加 / 调用链 ──`;
if (j.includes(anchor) && !j.includes('iCogTianJia')) {
  j = j.replace(anchor, `    // ── 牛马头像 + 认知注入 ──
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

${anchor}`);
  console.log('instance touXiang/cognition bound');
}

// 2) 添加联系人
if (!j.includes('function addContactFlow')) {
  j = j.replace(
    '  function addInstanceFlow() {',
    `  function addContactFlow() {
    uiPrompt(t('contact.add'), '').then((ming) => {
      if (!ming) return;
      state.chats.push({ id: 'c-' + Date.now(), ming, kind: 'extdm', lastPreview: t('list.noReply') });
      renderList();
    });
  }

  function addInstanceFlow() {`
  );
  console.log('addContactFlow added');
}

// 3) emailNotify 状态
if (!j.includes('emailNotify')) {
  j = j.replace('emailOnRequest: false,', "emailOnRequest: false,\n    emailNotify: { complete: false, request: true, error: true },");
}

// 4) pendingAvatarTarget 声明 + touXiang 上传分流
if (!j.includes('pendingAvatarTarget')) {
  j = j.replace('  let state = {', '  let pendingAvatarTarget = null;\n  let state = {');
  j = j.replace('  const state = {', '  let pendingAvatarTarget = null;\n  const state = {');
}
j = j.replace(
  `    reader.onload = () => {
      state.profile.avatarDataUrl = String(reader.result || '');
      applyAvatar();
      if (state.nav === 'wo') renderPage();
    };`,
  `    reader.onload = () => {
      const url = String(reader.result || '');
      if (pendingAvatarTarget && pendingAvatarTarget.kind === 'instance') {
        pendingAvatarTarget.inst.avatarDataUrl = url;
        pendingAvatarTarget = null;
        if (state.selectedInstance) renderInstanceDetail();
        return;
      }
      state.profile.avatarDataUrl = url;
      applyAvatar();
      if (state.nav === 'wo') renderPage();
    };`
);

fs.writeFileSync(base + 'yingYong.js', j);
console.log('yingYong.js patched (contacts/touXiang/email)');
