const fs = require('node:fs');
const base = 'C:/Users/p/.openclaw/workspace/大龙虾互动区/CCArmy/packages/app-shell/src/';
let j = fs.readFileSync(base + 'renderer/app.js', 'utf8');
let zh = JSON.parse(fs.readFileSync(base + 'i18n/zh-CN.json', 'utf8'));
let en = JSON.parse(fs.readFileSync(base + 'i18n/en-US.json', 'utf8'));

// i18n
if (!zh['common.more']) {
  zh['common.more'] = '更多';
  en['common.more'] = 'More';
  fs.writeFileSync(base + 'i18n/zh-CN.json', JSON.stringify(zh, null, 2) + '\n');
  fs.writeFileSync(base + 'i18n/en-US.json', JSON.stringify(en, null, 2) + '\n');
  console.log('i18n more added');
}

// setupListAction: 显示 join-qr 按钮
const oldSetup = j.match(/  function setupListAction\(\) \{[\s\S]*?\n  \}/);
if (oldSetup) {
  j = j.replace(oldSetup[0], `  function setupListAction() {
    const btn = $('list-action');
    const joinBtn = $('btn-join-qr');
    // 项目/群聊/联系人：显示扫码加入
    if (joinBtn) {
      const showJoin = state.nav === 'internalGroup' || state.nav === 'externalGroup' || state.nav === 'externalChat';
      joinBtn.classList.toggle('hidden', !showJoin);
    }
    if (state.nav === 'internalGroup' || state.nav === 'externalGroup') {
      const createKey = state.nav === 'internalGroup' ? 'list.createProject' : 'list.createGroupChat';
      btn.textContent = t(createKey);
      btn.title = t(createKey);
      btn.classList.remove('hidden');
      btn.onclick = createGroupFlow;
    } else if (state.nav === 'externalChat') {
      btn.textContent = t('contact.add');
      btn.title = t('contact.add');
      btn.classList.remove('hidden');
      btn.onclick = addContactFlow;
    } else if (state.nav === 'instances') {
      btn.textContent = t('list.addInstance');
      btn.title = t('list.addInstance');
      btn.classList.remove('hidden');
      btn.onclick = addInstanceFlow;
    } else {
      btn.classList.add('hidden');
      btn.onclick = null;
    }
  }`);
  console.log('setupListAction updated');
}

// 更多菜单绑定
if (!j.includes('more-trigger')) {
  j = j.replace(
    "  $('btn-console')?.addEventListener('click'",
    `  // 「…」更多菜单
  $('more-trigger')?.addEventListener('click', (e) => {
    e.stopPropagation();
    $('more-menu')?.classList.toggle('hidden');
  });
  document.addEventListener('click', () => $('more-menu')?.classList.add('hidden'));
  $('mi-search')?.addEventListener('click', () => {
    const q = uiPromptSync(t('list.search'));
    // 简化：聚焦搜索
    $('list-search')?.focus();
  });
  $('mi-directed')?.addEventListener('change', async () => {
    if (!state.selectedChat) return;
    await window.ccarmy.groupDirected({ groupId: state.selectedChat.id, directed: true }).catch(() => {});
  });
  $('mi-open')?.addEventListener('click', () => {
    if (!state.selectedChat) return;
    window.ccarmy.openChatWindow({ id: state.selectedChat.id, title: state.selectedChat.name, kind: state.selectedChat.kind });
  });
  $('mi-export')?.addEventListener('click', async () => {
    if (!state.selectedChat) return;
    const msgs = (window.__msgs && window.__msgs[state.selectedChat.id]) || [];
    const r = await window.ccarmy.exportSession({
      title: state.selectedChat.name,
      messages: msgs.map((x) => ({ role: x.role, text: x.text, ts: x.ts || Date.now() })),
    });
    uiAlert(r?.ok ? r.path : t('common.error'));
  });

  $('btn-console')?.addEventListener('click'`
  );
  console.log('more menu wired');
}

// join-qr 点击：在列表列显示时弹加入弹窗（已有绑定）
// 确认 join-qr 绑定存在
if (!j.includes('btn-join-qr') || !j.includes('join-link-input')) {
  console.log('WARN: join-qr binding may be missing');
}

fs.writeFileSync(base + 'renderer/app.js', j);
console.log('done');
