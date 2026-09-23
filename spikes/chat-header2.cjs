const fs = require('node:fs');
const base = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/';
let j = fs.readFileSync(base + 'renderer/yingYong.js', 'utf8');
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

// setupListAction: 显示 jiaRuqr 按钮
const oldSetup = j.match(/  function setupListAction\(\) \{[\s\S]*?\n  \}/);
if (oldSetup) {
  j = j.replace(oldSetup[0], `  function setupListAction() {
    const btn = $('lieBiaoDongZuo');
    const joinBtn = $('anNiuJiaRuqr');
    // 项目/群聊/联系人：显示扫码加入
    if (joinBtn) {
      const showJoin = state.nav === 'internalGroup' || state.nav === 'externalGroup' || state.nav === 'externalChat';
      joinBtn.classList.toggle('yinCang', !showJoin);
    }
    if (state.nav === 'internalGroup' || state.nav === 'externalGroup') {
      const createKey = state.nav === 'internalGroup' ? 'list.createProject' : 'list.createGroupChat';
      btn.textContent = t(createKey);
      btn.biaoTi = t(createKey);
      btn.classList.remove('yinCang');
      btn.onclick = createGroupFlow;
    } else if (state.nav === 'externalChat') {
      btn.textContent = t('contact.add');
      btn.biaoTi = t('contact.add');
      btn.classList.remove('yinCang');
      btn.onclick = addContactFlow;
    } else if (state.nav === 'instances') {
      btn.textContent = t('list.addInstance');
      btn.biaoTi = t('list.addInstance');
      btn.classList.remove('yinCang');
      btn.onclick = addInstanceFlow;
    } else {
      btn.classList.add('yinCang');
      btn.onclick = null;
    }
  }`);
  console.log('setupListAction updated');
}

// 更多菜单绑定
if (!j.includes('gengDuoTrigger')) {
  j = j.replace(
    "  $('anNiuKongZhiTai')?.addEventListener('click'",
    `  // 「…」更多菜单
  $('gengDuoTrigger')?.addEventListener('click', (e) => {
    e.stopPropagation();
    $('gengDuoCaiDan')?.classList.toggle('yinCang');
  });
  document.addEventListener('click', () => $('gengDuoCaiDan')?.classList.add('yinCang'));
  $('caiDanTuBiaoSouSuo')?.addEventListener('click', () => {
    const q = uiPromptSync(t('list.search'));
    // 简化：聚焦搜索
    $('lieBiaoSouSuo')?.focus();
  });
  $('caiDanTuBiaoDingXiang')?.addEventListener('change', async () => {
    if (!state.selectedChat) return;
    await window.warmy.groupDirected({ groupId: state.selectedChat.id, directed: true }).catch(() => {});
  });
  $('caiDanTuBiaoDaKai')?.addEventListener('click', () => {
    if (!state.selectedChat) return;
    window.warmy.openChatWindow({ id: state.selectedChat.id, title: state.selectedChat.name, kind: state.selectedChat.kind });
  });
  $('caiDanTuBiaoDaoChu')?.addEventListener('click', async () => {
    if (!state.selectedChat) return;
    const xiaoXi = (window.__msgs && window.__msgs[state.selectedChat.id]) || [];
    const r = await window.warmy.exportSession({
      title: state.selectedChat.name,
      xiaoXiJi: xiaoXi.map((x) => ({ role: x.role, text: x.text, ts: x.ts || Date.now() })),
    });
    uiAlert(r?.ok ? r.path : t('common.error'));
  });

  $('anNiuKongZhiTai')?.addEventListener('click'`
  );
  console.log('more menu wired');
}

// jiaRuqr 点击：在列表列显示时弹加入弹窗（已有绑定）
// 确认 jiaRuqr 绑定存在
if (!j.includes('anNiuJiaRuqr') || !j.includes('jiaRuLinkShuRu')) {
  console.log('WARN: jiaRuqr binding may be missing');
}

fs.writeFileSync(base + 'renderer/yingYong.js', j);
console.log('done');
