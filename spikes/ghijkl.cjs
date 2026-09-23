const fs = require('node:fs');
const base = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/';
let m = fs.readFileSync(base + 'electron-main.ts', 'utf8');
let p = fs.readFileSync(base + 'preload.cjs', 'utf8');
let j = fs.readFileSync(base + 'renderer/yingYong.js', 'utf8');
let h = fs.readFileSync(base + 'renderer/index.html', 'utf8');

// ── G. 检查点真实文件时间戳 ──
let ck = fs.readFileSync(base + 'checkpoint.ts', 'utf8');
if (!ck.includes('mtimeMs')) {
  ck = ck.replace(
    "if (opts.jsonlPath && fs.existsSync(opts.jsonlPath)) {\n      filesChanged.push({ path: 'fast-memory.jsonl', ts: Date.now() });\n    }",
    `if (opts.jsonlPath && fs.existsSync(opts.jsonlPath)) {
      try {
        const st = fs.statSync(opts.jsonlPath);
        filesChanged.push({ path: 'fast-memory.jsonl', ts: st.mtimeMs });
      } catch { filesChanged.push({ path: 'fast-memory.jsonl', ts: Date.now() }); }
    }`
  );
  ck = ck.replace(
    "        for (const e of fs.readdirSync(opts.workspace, { withFileTypes: true }).slice(0, 20)) {\n          if (e.isFile()) filesCreated.push({ path: e.name, ts: Date.now() });\n        }",
    `        for (const e of fs.readdirSync(opts.workspace, { withFileTypes: true }).slice(0, 20)) {
          if (e.isFile()) {
            const fp = path.join(opts.workspace, e.name);
            let ts = Date.now();
            try { ts = fs.statSync(fp).mtimeMs; } catch { /* noop */ }
            filesCreated.push({ path: e.name, ts });
          }
        }`
  );
  fs.writeFileSync(base + 'checkpoint.ts', ck);
  console.log('G: checkpoint timestamps');
}

// ── H/I/J/L: 主进程 IPC ──
if (!m.includes('warmy:daKaiLiaoTianChuangKou')) {
  m += `

// ── H. 多窗口：在新窗口打开会话 ──
const chatWindows = new Map<string, BrowserWindow>();
ipcMain.handle('warmy:daKaiLiaoTianChuangKou', (_e, payload: { id: string; title: string; kind?: string }) => {
  if (chatWindows.has(payload.id)) {
    chatWindows.get(payload.id)?.focus();
    return { ok: true };
  }
  const w = new BrowserWindow({
    width: 900,
    height: 700,
    title: payload.biaoTi || 'WArmy',
    frame: process.platform === 'darwin',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  void w.loadFile(path.join(__dirname, 'renderer', 'index.html'), {
    query: { chatId: payload.id, chatKind: payload.kind || 'single', chatTitle: payload.biaoTi || '' },
  });
  w.on('closed', () => chatWindows.delete(payload.id));
  chatWindows.set(payload.id, w);
  return { ok: true };
});

// ── I. 全局热键 ──
ipcMain.handle('warmy:zhuCeKuaiJieJian', (_e, accel: string) => {
  try {
    const { globalShortcut } = require('electron');
    globalShortcut.unregister(accel);
    const ok = globalShortcut.register(accel, () => {
      if (!win) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    });
    return { ok };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

// ── J. 托盘 ──
let tray: import('electron').Tray | null = null;
ipcMain.handle('warmy:tuoPanChuShi', () => {
  try {
    const { Tray, Menu, nativeImage } = require('electron');
    if (tray) return { ok: true };
    // 16x16 简易图标
    const img = nativeImage.createEmpty();
    tray = new Tray(img);
    tray.setToolTip('WArmy');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { biaoQian: '显示主窗口', click: () => { win?.show(); win?.focus(); } },
        { type: 'separator' },
        { biaoQian: '退出', click: () => { app.quit(); } },
      ])
    );
    tray.on('click', () => {
      if (win?.isVisible()) win.hide();
      else { win?.show(); win?.focus(); }
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

// ── K. 会话导出 Markdown ──
ipcMain.handle('warmy:daoChuHuiHua', (_e, payload: { title: string; xiaoXiJi: Array<{ role: string; text: string; ts?: number }> }) => {
  try {
    const dir = path.join(app.getPath('userData'), 'exports');
    fs.mkdirSync(dir, { recursive: true });
    const lines = [\n      '# ' + payload.biaoTi,\n      '',\n      '> 导出自 WArmy · ' + new Date().toLocaleString(),\n      '',\n    ];
    for (const xiaoXi of payload.xiaoXiJi) {
      const shui = xiaoXi.role === 'wo' ? '我' : payload.biaoTi;
      const time = xiaoXi.ts ? new Date(xiaoXi.ts).toLocaleString() : '';
      lines.push(\`**\${shui}** \${time}\`);\n      lines.push('');\n      lines.push(xiaoXi.text || '');\n      lines.push('');\n    }\n    const file = path.join(dir, \`\${payload.biaoTi.replace(/[\\\\/:*?"<>|]/g, '_')}-\${Date.now()}.md\`);\n    fs.writeFileSync(file, lines.join('\\n'), 'utf8');\n    return { ok: true, path: file };\n  } catch (e) {\n    return { ok: false, error: String(e) };\n  }\n});\n\n// ── L. 自动更新（electron-updater 占位） ──\nipcMain.handle('warmy:ziDongGengXinJianCha', async () => {\n  // 无签名/发布源时只返回状态，不实际下载\n  return { ok: true, status: 'idle', message: 'no release channel configured' };\n});\nipcMain.handle('warmy:ziDongGengXinXiaZai', async () => {\n  return { ok: false, status: 'skipped', message: 'requires signed release + update server' };\n});\n`;
  console.log('H/I/J/K/L ipc added');
}

fs.writeFileSync(base + 'electron-main.ts', m);

// preload
if (!p.includes('openChatWindow')) {
  p = p.replace(
    "  asrTranscribe: (p) => ipcRenderer.invoke('warmy:asrZhuanXie', p),",
    `  asrTranscribe: (p) => ipcRenderer.invoke('warmy:asrZhuanXie', p),
  openChatWindow: (payload) => ipcRenderer.invoke('warmy:daKaiLiaoTianChuangKou', payload),
  registerHotkey: (accel) => ipcRenderer.invoke('warmy:zhuCeKuaiJieJian', accel),
  trayInit: () => ipcRenderer.invoke('warmy:tuoPanChuShi'),
  exportSession: (payload) => ipcRenderer.invoke('warmy:daoChuHuiHua', payload),
  autoUpdateCheck: () => ipcRenderer.invoke('warmy:ziDongGengXinJianCha'),
  autoUpdateDownload: () => ipcRenderer.invoke('warmy:ziDongGengXinXiaZai'),
  getChatQuery: () => { try { return new URLSearchParams(window.location.search); } catch { return new URLSearchParams(); } },`
  );
  fs.writeFileSync(base + 'preload.cjs', p);
  console.log('preload updated');
}

// renderer: 打开新窗口按钮 + 导出 + 启动时托盘/热键
if (!j.includes('btn-export')) {
  h = h.replace(
    '              <button id="anNiuTingZhiAll" class="anNiuTingZhi" data-i18n="chat.stopAll" data-i18n-title="chat.stopAllTip"></button>',
    `              <button id="btn-open-win" class="anNiuXiao" data-i18n="chat.openWindow" data-i18n-title="chat.openWindowTip"></button>
              <button id="btn-export" class="anNiuXiao" data-i18n="chat.export" data-i18n-title="chat.exportTip"></button>
              <button id="anNiuTingZhiAll" class="anNiuTingZhi" data-i18n="chat.stopAll" data-i18n-title="chat.stopAllTip"></button>`
  );
  j = j.replace(
    "  setInterval(refreshMetrics, 5000);",
    `  $('btn-open-win')?.addEventListener('click', () => {
    if (!state.selectedChat) return;
    window.warmy.openChatWindow({
      id: state.selectedChat.id,
      title: state.selectedChat.name,
      kind: state.selectedChat.kind,
    });
  });
  $('btn-export')?.addEventListener('click', async () => {
    if (!state.selectedChat) return;
    const xiaoXi = (window.__msgs && window.__msgs[state.selectedChat.id]) || [];
    const r = await window.warmy.exportSession({
      title: state.selectedChat.name,
      xiaoXiJi: xiaoXi.map((x) => ({ role: x.role, text: x.text, ts: x.ts || Date.now() })),
    });
    uiAlert(r?.ok ? r.path : t('common.error'));
  });
  // 托盘 + 热键
  window.warmy.trayInit?.().catch(() => {});
  window.warmy.registerHotkey?.('CommandOrControl+Shift+M').catch(() => {});
  // 从 URL 参数自动打开会话（多窗口）
  try {
    const q = new URLSearchParams(window.location.search);
    const cid = q.get('chatId');
    if (cid) {
      const biaoTi = q.get('chatTitle') || cid;
      const kind = q.get('chatKind') || 'single';
      setTimeout(() => openChat(kind, cid, biaoTi), 300);
    }
  } catch { /* noop */ }

  setInterval(refreshMetrics, 5000);`
  );
  console.log('renderer H/K wired');
}

// checkpoint detail: 显示真实时间
j = j.replace(
  "              <li>\\${t('checkpoints.changed')}: \\${escapeHtml((c.filesChanged || []).map((f) => f.path).join(', ') || '—')}</li>",
  "              <li>\\${t('checkpoints.changed')}: \\${escapeHtml((c.filesChanged || []).map((f) => f.path + ' @' + (f.ts ? new Date(f.ts).toLocaleString() : '')).join(', ') || '—')}</li>"
);
j = j.replace(
  "              <li>\\${t('checkpoints.created')}: \\${escapeHtml((c.filesCreated || []).map((f) => f.path).join(', ') || c.dir)}</li>",
  "              <li>\\${t('checkpoints.created')}: \\${escapeHtml((c.filesCreated || []).map((f) => f.path + ' @' + (f.ts ? new Date(f.ts).toLocaleString() : '')).join(', ') || c.dir)}</li>"
);

fs.writeFileSync(base + 'electron-main.ts', m);
fs.writeFileSync(base + 'renderer/yingYong.js', j);
fs.writeFileSync(base + 'renderer/index.html', h);
console.log('done');
