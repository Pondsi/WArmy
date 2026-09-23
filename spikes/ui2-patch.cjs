const fs = require('node:fs');
const base = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/renderer/';
let j = fs.readFileSync(base + 'yingYong.js', 'utf8');
let h = fs.readFileSync(base + 'index.html', 'utf8');

// ── 1) 实例详情：去掉模型/记忆文件输入，改为头像 + 认知注入 ──
const oldHead = j.match(/<h1>\$\{escapeHtml\(inst\.name \|\| inst\.id\)\}<\/h1>[\s\S]*?<div class="shiLiHang">\s*<div class="field"><biaoQian>\$\{t\('instances\.name'\)\}<\/biaoQian>[\s\S]*?<\/div>\s*<\/div>/);
if (oldHead) {
  j = j.replace(oldHead[0], `<h1>\${escapeHtml(inst.name || inst.id)}</h1>
      <div class="sheZhiKa" style="max-width:720px">
        <div class="profileHead" style="align-items:center;gap:14px">
          <button id="iAvAnNiu" class="avAnNiu" biaoTi="\${t('instances.avatarUpload')}">
            \${inst.avatarDataUrl
              ? '<img class="touXiangTuPian big" src="' + inst.avatarDataUrl + '" alt=""/>'
              : '<div class="bigAv">' + escapeHtml((inst.name || '?').slice(0, 1)) + '</div>'}
          </button>
          <div style="flex:1">
            <div class="field"><biaoQian>\${t('instances.name')}</biaoQian><shuRu id="iMing" value="\${escapeHtml(inst.name || '')}"/></div>
            <div class="jingYin" style="margin-top:6px">\${t('instances.avatarUpload')}</div>
          </div>
        </div>

        <h3 style="margin:14px 0 8px;font-size:13px">\${t('instances.cognition')}</h3>
        <div class="jingYin" style="margin-bottom:8px">\${t('instances.cognitionHint')}</div>
        <div id="iCogLieBiao"></div>
        <div style="margin-top:8px">
          <button class="anNiuXiao" id="iCogTianJia">\${t('instances.cognitionAdd')}</button>
        </div>`);
  console.log('instance head replaced');
} else {
  console.log('WARN: instance head pattern not found');
}

// ── 2) 创建项目 / 创建群聊 命名 ──
j = j.replace(
  "btn.textContent = t('list.createGroup');\n      btn.biaoTi = t('list.createGroup');",
  "const createKey = state.nav === 'internalGroup' ? 'list.createProject' : 'list.createGroupChat';\n      btn.textContent = t(createKey);\n      btn.biaoTi = t(createKey);"
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
      btn.biaoTi = t('contact.add');
      btn.classList.remove('yinCang');
      btn.onclick = addContactFlow;
    } else if (state.nav === 'instances') {
      btn.textContent = t('list.addInstance');`
);

// ── 4) 我的页：横排、去卡片 ──
const oldMe = j.match(/<h1>\$\{t\('nav\.touXiang'\)\}<\/h1>\s*<div class="sheZhiKa" style="max-width:520px;margin-bottom:20px">/);
if (oldMe) {
  j = j.replace(oldMe[0], `<h1>\${t('nav.touXiang')}</h1>
        <div class="woStrip">`);
  console.log('wo header flattened');
}

// ── 5) 邮件：三复选框 ──
j = j.replace(
  '<biaoQian><shuRu type="checkbox" id="s-email" ${state.emailOnRequest ? \'checked\' : \'\'}/> ${t(\'settings.emailOnRequest\')}</biaoQian>',
  `\${['complete', 'request', 'error']
            .map(
              (k) =>
                '<biaoQian style="margin-right:14px"><shuRu type="checkbox" data-email-k="' + k + '" ' +
                (state.emailNotify && state.emailNotify[k] ? 'checked' : '') + '/> ' + t('settings.sound' + k.charAt(0).toUpperCase() + k.slice(1)) + '</biaoQian>'
            )
            .join('')}`
);

fs.writeFileSync(base + 'yingYong.js', j);
console.log('yingYong.js patched');
