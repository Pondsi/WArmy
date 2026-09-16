const fs = require('node:fs');
const base = 'C:/Users/p/.openclaw/workspace/大龙虾互动区/CCArmy/packages/app-shell/src/renderer/';
let j = fs.readFileSync(base + 'app.js', 'utf8');
let h = fs.readFileSync(base + 'index.html', 'utf8');

// ── 1) 实例详情：去掉模型/记忆文件输入，改为头像 + 认知注入 ──
const oldHead = j.match(/<h1>\$\{escapeHtml\(inst\.name \|\| inst\.id\)\}<\/h1>[\s\S]*?<div class="inst-row">\s*<div class="field"><label>\$\{t\('instances\.name'\)\}<\/label>[\s\S]*?<\/div>\s*<\/div>/);
if (oldHead) {
  j = j.replace(oldHead[0], `<h1>\${escapeHtml(inst.name || inst.id)}</h1>
      <div class="set-card" style="max-width:720px">
        <div class="profile-head" style="align-items:center;gap:14px">
          <button id="i-av-btn" class="av-btn" title="\${t('instances.avatarUpload')}">
            \${inst.avatarDataUrl
              ? '<img class="avatar-img big" src="' + inst.avatarDataUrl + '" alt=""/>'
              : '<div class="big-av">' + escapeHtml((inst.name || '?').slice(0, 1)) + '</div>'}
          </button>
          <div style="flex:1">
            <div class="field"><label>\${t('instances.name')}</label><input id="i-name" value="\${escapeHtml(inst.name || '')}"/></div>
            <div class="muted" style="margin-top:6px">\${t('instances.avatarUpload')}</div>
          </div>
        </div>

        <h3 style="margin:14px 0 8px;font-size:13px">\${t('instances.cognition')}</h3>
        <div class="muted" style="margin-bottom:8px">\${t('instances.cognitionHint')}</div>
        <div id="i-cog-list"></div>
        <div style="margin-top:8px">
          <button class="btn-mini" id="i-cog-add">\${t('instances.cognitionAdd')}</button>
        </div>`);
  console.log('instance head replaced');
} else {
  console.log('WARN: instance head pattern not found');
}

// ── 2) 创建项目 / 创建群聊 命名 ──
j = j.replace(
  "btn.textContent = t('list.createGroup');\n      btn.title = t('list.createGroup');",
  "const createKey = state.nav === 'internalGroup' ? 'list.createProject' : 'list.createGroupChat';\n      btn.textContent = t(createKey);\n      btn.title = t(createKey);"
);
j = j.replace(
  "uiPrompt(t('list.createGroup'), state.nav === 'internalGroup' ? t('placeholder.groupName') : t('placeholder.groupNameExt'))",
  "uiPrompt(state.nav === 'internalGroup' ? t('list.createProject') : t('list.createGroupChat'), state.nav === 'internalGroup' ? t('placeholder.groupName') : t('placeholder.groupNameExt'))"
);

// ── 3) 联系人：添加联系人入口 ──
j = j.replace(
  "} else if (state.nav === 'instances') {\n      btn.textContent = t('list.addInstance');",
  `} else if (state.nav === 'externalChat') {
      btn.textContent = t('contact.add');
      btn.title = t('contact.add');
      btn.classList.remove('hidden');
      btn.onclick = addContactFlow;
    } else if (state.nav === 'instances') {
      btn.textContent = t('list.addInstance');`
);

// ── 4) 我的页：横排、去卡片 ──
const oldMe = j.match(/<h1>\$\{t\('nav\.avatar'\)\}<\/h1>\s*<div class="set-card" style="max-width:520px;margin-bottom:20px">/);
if (oldMe) {
  j = j.replace(oldMe[0], `<h1>\${t('nav.avatar')}</h1>
        <div class="me-strip">`);
  console.log('me header flattened');
}

// ── 5) 邮件：三复选框 ──
j = j.replace(
  '<label><input type="checkbox" id="s-email" ${state.emailOnRequest ? \'checked\' : \'\'}/> ${t(\'settings.emailOnRequest\')}</label>',
  `\${['complete', 'request', 'error']
            .map(
              (k) =>
                '<label style="margin-right:14px"><input type="checkbox" data-email-k="' + k + '" ' +
                (state.emailNotify && state.emailNotify[k] ? 'checked' : '') + '/> ' + t('settings.sound' + k.charAt(0).toUpperCase() + k.slice(1)) + '</label>'
            )
            .join('')}`
);

fs.writeFileSync(base + 'app.js', j);
console.log('app.js patched');
