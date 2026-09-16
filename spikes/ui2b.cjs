const fs = require('node:fs');
const base = 'C:/Users/p/.openclaw/workspace/大龙虾互动区/CCArmy/packages/app-shell/src/renderer/';
let j = fs.readFileSync(base + 'app.js', 'utf8');

// 1) 实例头像 + 认知注入绑定（插在模型配置绑定前）
const anchor = `    // ── 模型配置：默认模型 / 全部可用 / 手动添加 / 调用链 ──`;
if (j.includes(anchor) && !j.includes('i-cog-add')) {
  j = j.replace(anchor, `    // ── 牛马头像 + 认知注入 ──
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
        const r = await window.ccarmy.pickFile({ filters: ['md'] });
        if (!r?.ok) return;
        const name = r.path.split(/[\\\\/]/).pop();
        inst.cognitionFiles.push({ name, path: r.path, size: 0 });
        renderCog();
      });
    })();

${anchor}`);
  console.log('instance avatar/cognition bound');
}

// 2) 添加联系人
if (!j.includes('function addContactFlow')) {
  j = j.replace(
    '  function addInstanceFlow() {',
    `  function addContactFlow() {
    uiPrompt(t('contact.add'), '').then((name) => {
      if (!name) return;
      state.chats.push({ id: 'c-' + Date.now(), name, kind: 'extdm', lastPreview: t('list.noReply') });
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

// 4) pendingAvatarTarget 声明 + avatar 上传分流
if (!j.includes('pendingAvatarTarget')) {
  j = j.replace('  let state = {', '  let pendingAvatarTarget = null;\n  let state = {');
  j = j.replace('  const state = {', '  let pendingAvatarTarget = null;\n  const state = {');
}
j = j.replace(
  `    reader.onload = () => {
      state.profile.avatarDataUrl = String(reader.result || '');
      applyAvatar();
      if (state.nav === 'me') renderPage();
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
      if (state.nav === 'me') renderPage();
    };`
);

fs.writeFileSync(base + 'app.js', j);
console.log('app.js patched (contacts/avatar/email)');
