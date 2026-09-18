const fs = require('node:fs');
const base = 'C:/Users/p/.openclaw/workspace/大龙虾互动区/WArmy/packages/app-shell/src/renderer/';
let j = fs.readFileSync(base + 'app.js', 'utf8');

// ── 1) 进度折叠切换 ──
if (!j.includes('progress-toggle')) {
  j = j.replace(
    '  // ── 顶层交互绑定（必须全局执行一次） ──',
    `  // ── 进度折叠 ──
  $('progress-toggle')?.addEventListener('click', () => {
    $('progress-toggle')?.classList.toggle('open');
    $('task-list')?.classList.toggle('hidden');
  });

  // ── only-group 显示/隐藏 ──
  function updatePanelVisibility() {
    const isGroup = state.selectedChat && (state.selectedChat.kind === 'internal' || state.selectedChat.kind === 'extgroup');
    document.querySelectorAll('.only-group').forEach((el) => {
      el.classList.toggle('hidden', !isGroup);
    });
  }

  // ── 搜索浮窗 ──
  function showSearchPopup() {
    const root = $('modal-root');
    $('modal-title').textContent = t('list.search');
    $('modal-body').innerHTML = '<input id="search-popup-input" style="width:100%;padding:8px;border:1px solid var(--line);border-radius:6px" placeholder="' + t('list.search') + '"/><div id="search-popup-results" class="muted" style="margin-top:8px;max-height:200px;overflow:auto"></div>';
    const acts = $('modal-actions');
    acts.innerHTML = '';
    const close = document.createElement('button');
    close.className = 'btn-mini';
    close.textContent = t('common.close');
    close.onclick = () => { root.classList.add('hidden'); };
    acts.appendChild(close);
    root.classList.remove('hidden');
    const inp = $('search-popup-input');
    inp?.focus();
    let timer = null;
    inp?.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const q = inp.value.trim();
        if (!q) { $('search-popup-results').textContent = ''; return; }
        const r = await window.warmy.searchMessages(q).catch(() => null);
        const hits = r?.hits || [];
        $('search-popup-results').innerHTML = hits.length
          ? hits.map((x) => '<div style="padding:4px 0;border-bottom:1px solid var(--line)">' + escapeHtml(x.snippet) + '</div>').join('')
          : t('list.empty');
      }, 300);
    });
  }

  // ── 导出弹窗 ──
  function showExportDialog() {
    const root = $('modal-root');
    $('modal-title').textContent = t('chat.export');
    $('modal-body').innerHTML =
      '<div style="margin-bottom:8px">' + t('export.hint') + '</div>' +
      '<div class="muted">' + t('export.include') + '</div>';
    const acts = $('modal-actions');
    acts.innerHTML = '';
    const cancel = document.createElement('button');
    cancel.className = 'btn-mini';
    cancel.textContent = t('common.cancel');
    cancel.onclick = () => { root.classList.add('hidden'); };
    const ok = document.createElement('button');
    ok.className = 'btn-primary';
    ok.textContent = t('chat.export');
    ok.onclick = async () => {
      if (!state.selectedChat) { root.classList.add('hidden'); return; }
      const msgs = (window.__msgs && window.__msgs[state.selectedChat.id]) || [];
      const r = await window.warmy.exportSession({
        title: state.selectedChat.name,
        messages: msgs.map((x) => ({ role: x.role, text: x.text, ts: x.ts || Date.now() })),
      });
      root.classList.add('hidden');
      uiAlert(r?.ok ? r.path : t('common.error'));
    };
    acts.append(cancel, ok);
    root.classList.remove('hidden');
  }

  // ── 顶层交互绑定（必须全局执行一次） ──`
  );
  console.log('progress/search/export added');
}

// ── 2) 重绑更多菜单 ──
j = j.replace(
  `  $('mi-search')?.addEventListener('click', () => {
    const q = uiPromptSync(t('list.search'));
    // 简化：聚焦搜索
    $('list-search')?.focus();
  });
  $('mi-directed')?.addEventListener('change', async () => {
    if (!state.selectedChat) return;
    await window.warmy.groupDirected({ groupId: state.selectedChat.id, directed: true }).catch(() => {});
  });
  $('mi-open')?.addEventListener('click', () => {
    if (!state.selectedChat) return;
    window.warmy.openChatWindow({ id: state.selectedChat.id, title: state.selectedChat.name, kind: state.selectedChat.kind });
  });
  $('mi-export')?.addEventListener('click', async () => {
    if (!state.selectedChat) return;
    const msgs = (window.__msgs && window.__msgs[state.selectedChat.id]) || [];
    const r = await window.warmy.exportSession({
      title: state.selectedChat.name,
      messages: msgs.map((x) => ({ role: x.role, text: x.text, ts: x.ts || Date.now() })),
    });
    uiAlert(r?.ok ? r.path : t('common.error'));
  });`,
  `  $('mi-search')?.addEventListener('click', () => {
    $('more-menu')?.classList.add('hidden');
    showSearchPopup();
  });
  $('mi-directed')?.addEventListener('change', async (e) => {
    if (!state.selectedChat) return;
    await window.warmy.groupDirected({ groupId: state.selectedChat.id, directed: e.target.checked }).catch(() => {});
  });
  $('mi-open')?.addEventListener('click', () => {
    $('more-menu')?.classList.add('hidden');
    if (!state.selectedChat) return;
    // 子窗口：只有聊天+右栏
    window.warmy.openChatWindow({ id: state.selectedChat.id, title: state.selectedChat.name, kind: state.selectedChat.kind, mode: 'sub' });
  });
  $('mi-export')?.addEventListener('click', () => {
    $('more-menu')?.classList.add('hidden');
    showExportDialog();
  });`
);

// ── 3) openChat 时刷新面板可见性 ──
j = j.replace(
  "    window.__refreshSecurity?.();\n    renderChat();\n    renderQueueBar();\n    renderList();",
  "    window.__refreshSecurity?.();\n    updatePanelVisibility();\n    renderChat();\n    renderQueueBar();\n    renderList();"
);

fs.writeFileSync(base + 'app.js', j);
console.log('done');
console.log('  progress-toggle:', j.includes('progress-toggle'));
console.log('  updatePanelVisibility:', j.includes('updatePanelVisibility'));
console.log('  showSearchPopup:', j.includes('showSearchPopup'));
console.log('  showExportDialog:', j.includes('showExportDialog'));
