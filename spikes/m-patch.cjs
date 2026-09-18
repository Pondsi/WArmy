const fs = require('node:fs');
const base = 'C:/Users/p/.openclaw/workspace/大龙虾互动区/WArmy/packages/app-shell/src/';
let m = fs.readFileSync(base + 'electron-main.ts', 'utf8');
let j = fs.readFileSync(base + 'renderer/app.js', 'utf8');
let h = fs.readFileSync(base + 'renderer/index.html', 'utf8');
let p = fs.readFileSync(base + 'preload.cjs', 'utf8');

// ── M. 群成员管理 IPC ──
if (!m.includes('warmy:group-members')) {
  m += `

// ── M. 群成员管理 ──
const groupMembers = new Map<string, Array<{ id: string; name: string; role: string; joinedAt: number }>>();
ipcMain.handle('warmy:group-members', (_e, groupId: string) => ({
  ok: true,
  members: groupMembers.get(groupId) || [],
}));
ipcMain.handle('warmy:group-invite', (_e, payload: { groupId: string; name: string; role?: string }) => {
  const list = groupMembers.get(payload.groupId) || [];
  if (list.length >= 50) return { ok: false, error: 'max 50' };
  list.push({ id: 'm-' + Date.now(), name: payload.name, role: payload.role || 'member', joinedAt: Date.now() });
  groupMembers.set(payload.groupId, list);
  return { ok: true, members: list };
});
ipcMain.handle('warmy:group-kick', (_e, payload: { groupId: string; memberId: string }) => {
  const list = groupMembers.get(payload.groupId) || [];
  const next = list.filter((x) => x.id !== payload.memberId);
  groupMembers.set(payload.groupId, next);
  return { ok: true, members: next };
});
ipcMain.handle('warmy:group-set-admin', (_e, payload: { groupId: string; memberId: string; admin: boolean }) => {
  const list = groupMembers.get(payload.groupId) || [];
  const m = list.find((x) => x.id === payload.memberId);
  if (m) m.role = payload.admin ? 'admin' : 'member';
  groupMembers.set(payload.groupId, list);
  return { ok: true, members: list };
});
ipcMain.handle('warmy:group-directed', (_e, payload: { groupId: string; directed: boolean }) => {
  const g = router.getGroup(payload.groupId);
  if (!g) return { ok: false, error: 'no group' };
  g.directedMode = payload.directed;
  return { ok: true, directedMode: g.directedMode };
});
`;
  console.log('M group members ipc');
}

// ── N. 会话内嵌看板（只读展示，值班者写入） ──
if (!m.includes('warmy:board-session')) {
  m += `

// ── N. 会话内嵌看板 ──
ipcMain.handle('warmy:board-session', (_e, groupId: string) => ({
  ok: true,
  tasks: board?.listTasks(groupId) || [],
  events: (board?.tailEvents(20) || []).filter((e) => e.groupId === groupId),
}));
`;
  console.log('N board session ipc');
}

// ── O. CCR 工具输出压缩 ──
if (!m.includes('warmy:ccr-tool-output')) {
  m += `

// ── O. CCR 工具输出压缩 ──
ipcMain.handle('warmy:ccr-tool-output', (_e, payload: { toolName?: string; content: string }) => {
  const r = ccr.beforeLog({ kind: 'tool_result', content: payload.content, toolName: payload.toolName });
  metrics.recordCcr({ ts: Date.now(), kind: 'tool_result', originalBytes: r.originalBytes, compressedBytes: r.compressedBytes });
  return { ok: true, ...r };
});
`;
  console.log('O ccr tool ipc');
}

// ── P. 知识库详情 ──
if (!m.includes('warmy:kb-detail')) {
  m += `

// ── P. 知识库详情 ──
ipcMain.handle('warmy:kb-detail', (_e, q: string) => {
  const r = knowledge?.query(q) || { entities: [], events: [] };
  return {
    ok: true,
    entities: r.entities.map((e) => ({ id: e.id, name: e.name, kind: e.kind, attrs: e.attrs, eventIds: e.eventIds })),
    events: r.events.map((e) => ({ id: e.id, title: e.title, result: e.result, ts: e.ts, entityIds: e.entityIds })),
  };
});
`;
  console.log('P kb detail ipc');
}

// ── Q. 错误提示与重试（主进程暴露 last error） ──
if (!m.includes('warmy:last-error')) {
  m = m.replace(
    "const emailQueue: Array<{ to: string; subject: string; body: string; ts: number }> = [];",
    `const emailQueue: Array<{ to: string; subject: string; body: string; ts: number }> = [];
let lastError: { ts: number; message: string; context?: string } | null = null;`
  );
  m += `

// ── Q. 错误提示 ──
ipcMain.handle('warmy:last-error', () => ({ ok: true, error: lastError }));
ipcMain.handle('warmy:clear-error', () => { lastError = null; return { ok: true }; });
`;
  // chat-send 错误时记录
  m = m.replace(
    "      const err = String((e as Error).message || e);\n      return { ok: false, reply: '', error: err, needsKey: false };",
    "      const err = String((e as Error).message || e);\n      lastError = { ts: Date.now(), message: err, context: 'chat-send' };\n      return { ok: false, reply: '', error: err, needsKey: false, retry: true };"
  );
  console.log('Q error ipc');
}

// ── R. 启动引导 ──
if (!m.includes('warmy:setup-state')) {
  m += `

// ── R. 启动引导 ──
ipcMain.handle('warmy:setup-state', () => {
  const s = settingsStore?.load() as Record<string, unknown> | undefined;
  return { ok: true, done: !!(s as { setupDone?: boolean })?.setupDone, locale: s?.locale || app.getLocale() };
});
ipcMain.handle('warmy:setup-complete', (_e, payload: { locale?: string; provider?: Record<string, unknown> }) => {
  if (payload.locale) settingsStore?.save({ locale: payload.locale } as never);
  if (payload.provider) {
    // 预填 provider
    Object.assign(providerCfg, {
      presetId: (payload.provider.presetId as string) || providerCfg.presetId,
      apiKey: (payload.provider.apiKey as string) || providerCfg.apiKey,
      baseURL: (payload.provider.baseURL as string) || providerCfg.baseURL,
      model: (payload.provider.model as string) || providerCfg.model,
    });
  }
  const cur = settingsStore?.load() as Record<string, unknown>;
  settingsStore?.save({ ...cur, setupDone: true } as never);
  return { ok: true };
});
`;
  console.log('R setup ipc');
}

fs.writeFileSync(base + 'electron-main.ts', m);

// preload
if (!p.includes('groupMembers')) {
  p = p.replace(
    "  autoUpdateCheck: () => ipcRenderer.invoke('warmy:auto-update-check'),",
    `  autoUpdateCheck: () => ipcRenderer.invoke('warmy:auto-update-check'),
  groupMembers: (groupId) => ipcRenderer.invoke('warmy:group-members', groupId),
  groupInvite: (payload) => ipcRenderer.invoke('warmy:group-invite', payload),
  groupKick: (payload) => ipcRenderer.invoke('warmy:group-kick', payload),
  groupSetAdmin: (payload) => ipcRenderer.invoke('warmy:group-set-admin', payload),
  groupDirected: (payload) => ipcRenderer.invoke('warmy:group-directed', payload),
  boardSession: (groupId) => ipcRenderer.invoke('warmy:board-session', groupId),
  ccrToolOutput: (payload) => ipcRenderer.invoke('warmy:ccr-tool-output', payload),
  kbDetail: (q) => ipcRenderer.invoke('warmy:kb-detail', q),
  lastError: () => ipcRenderer.invoke('warmy:last-error'),
  clearError: () => ipcRenderer.invoke('warmy:clear-error'),
  setupState: () => ipcRenderer.invoke('warmy:setup-state'),
  setupComplete: (payload) => ipcRenderer.invoke('warmy:setup-complete', payload),`
  );
  fs.writeFileSync(base + 'preload.cjs', p);
  console.log('preload M-R');
}

// renderer: 右栏加会话看板 + 成员；聊天加错误重试；启动引导
if (!h.includes('board-sess-box')) {
  h = h.replace(
    '          <div class="panel-block">\n            <h3 data-i18n="panel.duty"></h3>',
    `          <div class="panel-block">
            <h3 data-i18n="board.session"></h3>
            <div id="board-sess-box" class="muted">—</div>
          </div>
          <div class="panel-block">
            <h3 data-i18n="group.members"></h3>
            <div id="members-box" class="muted">—</div>
            <div style="margin-top:6px;display:flex;gap:6px">
              <input id="member-name" style="flex:1" placeholder=""/>
              <button class="btn-mini" id="btn-member-add">+</button>
            </div>
          </div>
          <div class="panel-block">
            <h3 data-i18n="panel.duty"></h3>`
  );
  fs.writeFileSync(base + 'renderer/index.html', h);
  console.log('N/M panel added');
}

if (!j.includes('refreshSessionBoard')) {
  j = j.replace(
    "  async function refreshExecutors() {",
    `  async function refreshSessionBoard() {
    const box = $('board-sess-box');
    if (!box || !state.selectedChat) return;
    const r = await window.warmy.boardSession(state.selectedChat.id).catch(() => null);
    const tasks = r?.tasks || [];
    box.innerHTML = tasks.length
      ? tasks.map((t) => '<div>' + escapeHtml(t.title) + ' · ' + (t.progress || 0) + '% · ' + t.status + '</div>').join('')
      : '—';
  }
  async function refreshMembers() {
    const box = $('members-box');
    if (!box || !state.selectedChat) return;
    const r = await window.warmy.groupMembers(state.selectedChat.id).catch(() => null);
    const ms = r?.members || [];
    box.innerHTML = ms.length
      ? ms.map((x) => '<div>' + escapeHtml(x.name) + ' · ' + x.role + '</div>').join('')
      : '—';
  }
  $('btn-member-add')?.addEventListener('click', async () => {
    const name = $('member-name')?.value?.trim();
    if (!name || !state.selectedChat) return;
    await window.warmy.groupInvite({ groupId: state.selectedChat.id, name });
    $('member-name').value = '';
    refreshMembers();
  });
  setInterval(() => { refreshSessionBoard(); refreshMembers(); }, 6000);

  // Q. 错误重试
  async function checkLastError() {
    const r = await window.warmy.lastError().catch(() => null);
    if (r?.error) {
      // 简单提示 + 可重试
      const ok = await uiConfirm(t('common.error') + ': ' + r.error.message.slice(0, 80) + ' · ' + t('common.retry'), t('common.error'));
      if (ok && state.selectedChat) {
        await window.warmy.clearError();
        send();
      } else {
        await window.warmy.clearError();
      }
    }
  }
  setInterval(checkLastError, 10000);

  // R. 启动引导
  async function maybeShowSetup() {
    const st = await window.warmy.setupState().catch(() => null);
    if (!st || st.done) return;
    const locale = await uiPrompt(t('settings.language'), 'zh-CN');
    if (locale) await window.warmy.setupComplete({ locale });
    else await window.warmy.setupComplete({});
    uiAlert(t('instances.saved'));
  }
  maybeShowSetup();

  async function refreshExecutors() {`
  );
  console.log('renderer M-R wired');
}

fs.writeFileSync(base + 'electron-main.ts', m);
fs.writeFileSync(base + 'renderer/app.js', j);
console.log('done');
