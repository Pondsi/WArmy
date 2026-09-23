const fs = require('node:fs');
const base = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/renderer/';
let j = fs.readFileSync(base + 'yingYong.js', 'utf8');

// ── 1) 进度折叠切换 ──
if (!j.includes('jinDuKaiGuan')) {
  j = j.replace(
    '  // ── 顶层交互绑定（必须全局执行一次） ──',
    `  // ── 进度折叠 ──
  $('jinDuKaiGuan')?.addEventListener('click', () => {
    $('jinDuKaiGuan')?.classList.toggle('daKai');
    $('renwuLieBiao')?.classList.toggle('yinCang');
  });

  // ── onlyQun 显示/隐藏 ──
  function updatePanelVisibility() {
    const isGroup = state.selectedChat && (state.selectedChat.kind === 'internal' || state.selectedChat.kind === 'extgroup');
    document.querySelectorAll('.onlyQun').forEach((el) => {
      el.classList.toggle('yinCang', !isGroup);
    });
  }

  // ── 搜索浮窗 ──
  function showSearchPopup() {
    const root = $('duiHuaKuangGen');
    $('duiHuaKuangBiaoTi').textContent = t('list.search');
    $('duiHuaKuangTi').innerHTML = '<shuRu id="souSuoPopupShuRu" style="width:100%;padding:8px;border:1px solid var(--line);border-radius:6px" placeholder="' + t('list.search') + '"/><div id="souSuoPopupResults" class="jingYin" style="margin-top:8px;max-height:200px;overflow:auto"></div>';
    const acts = $('duiHuaKuangDongZuoJi');
    acts.innerHTML = '';
    const close = document.createElement('button');
    close.className = 'anNiuXiao';
    close.textContent = t('common.close');
    close.onclick = () => { root.classList.add('yinCang'); };
    acts.appendChild(close);
    root.classList.remove('yinCang');
    const inp = $('souSuoPopupShuRu');
    inp?.focus();
    let timer = null;
    inp?.addEventListener('shuRu', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const q = inp.value.trim();
        if (!q) { $('souSuoPopupResults').textContent = ''; return; }
        const r = await window.warmy.searchMessages(q).catch(() => null);
        const hits = r?.hits || [];
        $('souSuoPopupResults').innerHTML = hits.length
          ? hits.map((x) => '<div style="padding:4px 0;border-bottom:1px solid var(--line)">' + escapeHtml(x.snippet) + '</div>').join('')
          : t('list.empty');
      }, 300);
    });
  }

  // ── 导出弹窗 ──
  function showExportDialog() {
    const root = $('duiHuaKuangGen');
    $('duiHuaKuangBiaoTi').textContent = t('chat.export');
    $('duiHuaKuangTi').innerHTML =
      '<div style="margin-bottom:8px">' + t('export.tiShi') + '</div>' +
      '<div class="jingYin">' + t('export.include') + '</div>';
    const acts = $('duiHuaKuangDongZuoJi');
    acts.innerHTML = '';
    const cancel = document.createElement('button');
    cancel.className = 'anNiuXiao';
    cancel.textContent = t('common.cancel');
    cancel.onclick = () => { root.classList.add('yinCang'); };
    const ok = document.createElement('button');
    ok.className = 'anNiuZhuYao';
    ok.textContent = t('chat.export');
    ok.onclick = async () => {
      if (!state.selectedChat) { root.classList.add('yinCang'); return; }
      const xiaoXi = (window.__msgs && window.__msgs[state.selectedChat.id]) || [];
      const r = await window.warmy.exportSession({
        title: state.selectedChat.name,
        xiaoXiJi: xiaoXi.map((x) => ({ role: x.role, text: x.text, ts: x.ts || Date.now() })),
      });
      root.classList.add('yinCang');
      uiAlert(r?.ok ? r.path : t('common.error'));
    };
    acts.append(cancel, ok);
    root.classList.remove('yinCang');
  }

  // ── 顶层交互绑定（必须全局执行一次） ──`
  );
  console.log('jinDu/search/export added');
}

// ── 2) 重绑更多菜单 ──
j = j.replace(
  `  $('caiDanTuBiaoSouSuo')?.addEventListener('click', () => {
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
  });`,
  `  $('caiDanTuBiaoSouSuo')?.addEventListener('click', () => {
    $('gengDuoCaiDan')?.classList.add('yinCang');
    showSearchPopup();
  });
  $('caiDanTuBiaoDingXiang')?.addEventListener('change', async (e) => {
    if (!state.selectedChat) return;
    await window.warmy.groupDirected({ groupId: state.selectedChat.id, directed: e.target.checked }).catch(() => {});
  });
  $('caiDanTuBiaoDaKai')?.addEventListener('click', () => {
    $('gengDuoCaiDan')?.classList.add('yinCang');
    if (!state.selectedChat) return;
    // 子窗口：只有聊天+右栏
    window.warmy.openChatWindow({ id: state.selectedChat.id, title: state.selectedChat.name, kind: state.selectedChat.kind, mode: 'fu' });
  });
  $('caiDanTuBiaoDaoChu')?.addEventListener('click', () => {
    $('gengDuoCaiDan')?.classList.add('yinCang');
    showExportDialog();
  });`
);

// ── 3) openChat 时刷新面板可见性 ──
j = j.replace(
  "    window.__refreshSecurity?.();\n    renderChat();\n    renderQueueBar();\n    renderList();",
  "    window.__refreshSecurity?.();\n    updatePanelVisibility();\n    renderChat();\n    renderQueueBar();\n    renderList();"
);

fs.writeFileSync(base + 'yingYong.js', j);
console.log('done');
console.log('  jinDuKaiGuan:', j.includes('jinDuKaiGuan'));
console.log('  updatePanelVisibility:', j.includes('updatePanelVisibility'));
console.log('  showSearchPopup:', j.includes('showSearchPopup'));
console.log('  showExportDialog:', j.includes('showExportDialog'));
