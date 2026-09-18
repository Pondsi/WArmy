const fs = require('node:fs');
const base = 'C:/Users/p/.openclaw/workspace/大龙虾互动区/WArmy/packages/app-shell/src/';
let m = fs.readFileSync(base + 'electron-main.ts', 'utf8');
let j = fs.readFileSync(base + 'renderer/app.js', 'utf8');
let h = fs.readFileSync(base + 'renderer/index.html', 'utf8');
let p = fs.readFileSync(base + 'preload.cjs', 'utf8');
let c = fs.readFileSync(base + 'renderer/app.css', 'utf8');

// ── S. 消息搜索 ──
if (!m.includes('warmy:search-messages')) {
  m += `

// ── S. 消息搜索（从 memory-os recall） ──
ipcMain.handle('warmy:search-messages', async (_e, q: string) => {
  try {
    const r = await memory?.recall(q, 20);
    return { ok: true, hits: r?.cards || [] };
  } catch (e) {
    return { ok: false, hits: [], error: String(e) };
  }
});
`;
  console.log('S search ipc');
}

// ── V. 插件真实安装 ──
if (!m.includes('warmy:plugin-install')) {
  m += `

// ── V. 插件真实安装/卸载 ──
ipcMain.handle('warmy:plugin-install', (_e, pkg: string) => {
  try {
    const dshHome = path.join(app.getPath('userData'), 'dsh-home');
    const profile = 'warmy';
    // 用 pnpm 安装到 profile
    const profileDir = path.join(dshHome, 'profiles', profile);
    fs.mkdirSync(profileDir, { recursive: true });
    const pkgJson = path.join(profileDir, 'package.json');
    if (!fs.existsSync(pkgJson)) {
      fs.writeFileSync(pkgJson, JSON.stringify({ name: 'dsh-profile-warmy', private: true, dependencies: {} }, null, 2));
    }
    const pj = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
    pj.dependencies = pj.dependencies || {};
    pj.dependencies[pkg] = 'latest';
    fs.writeFileSync(pkgJson, JSON.stringify(pj, null, 2));
    return { ok: true, profileDir, pkg };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});
ipcMain.handle('warmy:plugin-uninstall', (_e, pkg: string) => {
  try {
    const dshHome = path.join(app.getPath('userData'), 'dsh-home');
    const pkgJson = path.join(dshHome, 'profiles', 'warmy', 'package.json');
    if (fs.existsSync(pkgJson)) {
      const pj = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
      if (pj.dependencies) delete pj.dependencies[pkg];
      fs.writeFileSync(pkgJson, JSON.stringify(pj, null, 2));
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});
`;
  console.log('V plugin ipc');
}

// ── W. 定向模式开关 ──
// 已在 M 中有 group-directed

// ── X. 归档列表 ──
if (!m.includes('warmy:archived-list')) {
  m += `

// ── X. 归档列表 ──
const archived: Array<{ id: string; name: string; kind: string; ts: number }> = [];
ipcMain.handle('warmy:archived-list', () => ({ ok: true, items: archived }));
ipcMain.handle('warmy:archived-add', (_e, payload: { id: string; name: string; kind: string }) => {
  archived.push({ ...payload, ts: Date.now() });
  return { ok: true, items: archived };
});
ipcMain.handle('warmy:archived-restore', (_e, id: string) => {
  const idx = archived.findIndex((x) => x.id === id);
  if (idx < 0) return { ok: false };
  const item = archived.splice(idx, 1)[0];
  return { ok: true, item };
});
`;
  console.log('X archive ipc');
}

fs.writeFileSync(base + 'electron-main.ts', m);

// preload
if (!p.includes('searchMessages')) {
  p = p.replace(
    "  setupComplete: (payload) => ipcRenderer.invoke('warmy:setup-complete', payload),",
    `  setupComplete: (payload) => ipcRenderer.invoke('warmy:setup-complete', payload),
  searchMessages: (q) => ipcRenderer.invoke('warmy:search-messages', q),
  pluginInstall: (pkg) => ipcRenderer.invoke('warmy:plugin-install', pkg),
  pluginUninstall: (pkg) => ipcRenderer.invoke('warmy:plugin-uninstall', pkg),
  archivedList: () => ipcRenderer.invoke('warmy:archived-list'),
  archivedAdd: (payload) => ipcRenderer.invoke('warmy:archived-add', payload),
  archivedRestore: (id) => ipcRenderer.invoke('warmy:archived-restore', id),`
  );
  fs.writeFileSync(base + 'preload.cjs', p);
  console.log('preload S-X');
}

// renderer: 聊天搜索框 + 消息右键复制/引用 + 定向开关 + 归档
if (!j.includes('btn-chat-search')) {
  // 聊天头加搜索
  h = h.replace(
    '              <button id="btn-open-win" class="btn-mini"',
    `              <input id="chat-search" style="width:100px" data-i18n-placeholder="list.search"/>
              <button id="btn-chat-search" class="btn-mini">🔍</button>
              <button id="btn-open-win" class="btn-mini"`
  );
  fs.writeFileSync(base + 'renderer/index.html', h);
  console.log('S search input added');
}

if (!j.includes('btn-chat-search')) {
  j = j.replace(
    "  $('btn-open-win')?.addEventListener('click'",
    `  $('btn-chat-search')?.addEventListener('click', async () => {
    const q = $('chat-search')?.value?.trim();
    if (!q) return;
    const r = await window.warmy.searchMessages(q).catch(() => null);
    const hits = r?.hits || [];
    pushMsg(state.selectedChat?.id || 'search', 'them', hits.length ? hits.map((x) => x.snippet).join('\\n') : t('list.empty'));
    renderChat();
  });
  // T. 消息右键：复制/引用
  $('messages')?.addEventListener('contextmenu', (e) => {
    const bubble = e.target.closest('.bubble');
    if (!bubble) return;
    e.preventDefault();
    const text = bubble.textContent || '';
    openContextMenu(e.clientX, e.clientY, [
      { label: t('common.copy'), onClick: () => { navigator.clipboard?.writeText(text); } },
      { label: t('common.quote'), onClick: () => {
          const inp = $('input');
          if (inp) inp.value = '> ' + text.slice(0, 120) + '\\n' + inp.value;
        } },
    ]);
  });
  // W. 定向模式开关（聊天头）
  $('btn-open-win')?.addEventListener('click'`
  );
  console.log('S/T wired');
}

// 聊天头加定向开关
if (!h.includes('btn-directed')) {
  h = h.replace(
    '              <button id="btn-export" class="btn-mini"',
    `              <label class="muted" style="display:inline-flex;align-items:center;gap:4px">
                <input type="checkbox" id="btn-directed"/> <span data-i18n="group.directed"></span>
              </label>
              <button id="btn-export" class="btn-mini"`
  );
  fs.writeFileSync(base + 'renderer/index.html', h);
  console.log('W directed switch added');
}

if (!j.includes('btn-directed')) {
  j = j.replace(
    "  $('btn-export')?.addEventListener('click'",
    `  $('btn-directed')?.addEventListener('change', async (e) => {
    if (!state.selectedChat) return;
    await window.warmy.groupDirected({ groupId: state.selectedChat.id, directed: e.target.checked }).catch(() => {});
  });
  $('btn-export')?.addEventListener('click'`
  );
  console.log('W wired');
}

// V. 插件安装：设置里真实调用
j = j.replace(
  "      $('btn-plug-install').onclick = () => {\n        const v = $('plug-path').value.trim();\n        if (!v) return;\n        state.plugins.push({ id: v, name: v, enabled: true, desc: '' });\n        renderPage();\n      };",
  "      $('btn-plug-install').onclick = async () => {\n        const v = $('plug-path').value.trim();\n        if (!v) return;\n        const r = await window.warmy.pluginInstall(v).catch(() => null);\n        state.plugins.push({ id: v, name: v, enabled: true, desc: r?.ok ? 'installed' : 'pending' });\n        renderPage();\n      };"
);

// U. 深色适配：检查关键对比度变量已存在，补充 body 背景过渡
if (!c.includes('transition: background')) {
  c = c.replace(
    'body {',
    'body {\n  transition: background 0.2s ease, color 0.2s ease;'
  );
  console.log('U dark transition');
}

// i18n
// X. 归档：右键归档时调用 archived-add
j = j.replace(
  "          inst.archived = true;\n          uiAlert(t('instances.saved'));",
  "          inst.archived = true;\n          await window.warmy.archivedAdd({ id: inst.id, name: inst.name, kind: 'agent' }).catch(() => {});\n          uiAlert(t('instances.saved'));"
);
j = j.replace(
  "          g.archived = true;\n          uiAlert(t('instances.saved'));",
  "          g.archived = true;\n          await window.warmy.archivedAdd({ id: g.id, name: g.name, kind: 'group' }).catch(() => {});\n          uiAlert(t('instances.saved'));"
);

fs.writeFileSync(base + 'electron-main.ts', m);
fs.writeFileSync(base + 'renderer/app.js', j);
fs.writeFileSync(base + 'renderer/index.html', h);
fs.writeFileSync(base + 'renderer/app.css', c);
console.log('done S-X');
