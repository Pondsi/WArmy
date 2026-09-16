const fs = require('node:fs');
const base = 'C:/Users/p/.openclaw/workspace/大龙虾互动区/CCArmy/packages/app-shell/src/';
let m = fs.readFileSync(base + 'electron-main.ts', 'utf8');
let j = fs.readFileSync(base + 'renderer/app.js', 'utf8');
let h = fs.readFileSync(base + 'renderer/index.html', 'utf8');

// ── D. ASR 语音转文字 ──
if (!m.includes('ccarmy:asr-transcribe')) {
  m += `

// ── D. ASR 语音转文字（调用 DeepSeek 兼容接口的 audio 端点；失败返回 null） ──
ipcMain.handle('ccarmy:asr-transcribe', async (_e, payload: { dataUrl: string; ext?: string }) => {
  try {
    if (!providerCfg.apiKey) return { ok: false, error: 'no key' };
    // 优先走用户配置的 ASR 端点（若支持）；否则尝试 /audio/transcriptions
    const base = (providerCfg.baseURL || 'https://api.deepseek.com').replace(/\\/+$/, '');
    const b64 = String(payload.dataUrl).replace(/^data:[^,]+,/, '');
    const buf = Buffer.from(b64, 'base64');
    const form = new FormData();
    form.append('file', new Blob([buf], { type: 'audio/webm' }), 'voice.webm');
    form.append('model', 'whisper-1');
    const res = await fetch(base + '/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + providerCfg.apiKey },
      body: form,
    });
    if (!res.ok) return { ok: false, error: 'http ' + res.status };
    const data = await res.json();
    return { ok: true, text: data.text || '' };
  } catch (e) {
    return { ok: false, error: String((e as Error).message || e) };
  }
});
`;
  console.log('asr ipc added');
}

// preload
let p = fs.readFileSync(base + 'preload.cjs', 'utf8');
if (!p.includes('executorsStatus')) {
  p = p.replace(
    "  costSummary: () => ipcRenderer.invoke('ccarmy:cost-summary'),",
    `  costSummary: () => ipcRenderer.invoke('ccarmy:cost-summary'),
  executorsStatus: () => ipcRenderer.invoke('ccarmy:executors-status'),
  executorsRunBrief: (payload) => ipcRenderer.invoke('ccarmy:executors-run-brief', payload),
  stateSave: (s) => ipcRenderer.invoke('ccarmy:state-save', s),
  stateLoad: () => ipcRenderer.invoke('ccarmy:state-load'),
  asrTranscribe: (p) => ipcRenderer.invoke('ccarmy:asr-transcribe', p),`
  );
  fs.writeFileSync(base + 'preload.cjs', p);
  console.log('preload updated');
}

// ── 右栏：执行者面板 ──
if (!h.includes('exec-box')) {
  h = h.replace(
    '          <div class="panel-block">\n            <h3 data-i18n="metrics.title"></h3>',
    `          <div class="panel-block">
            <h3 data-i18n="executors.title"></h3>
            <div id="exec-box" class="muted">—</div>
            <div style="margin-top:8px">
              <button class="btn-mini" id="btn-exec-run" data-i18n="executors.run"></button>
            </div>
          </div>
          <div class="panel-block">
            <h3 data-i18n="metrics.title"></h3>`
  );
  fs.writeFileSync(base + 'renderer/index.html', h);
  console.log('exec panel added');
}

// ── 检查点详情填充真实文件 ──
j = j.replace(
  `          <div class="cp-body">
            <div>\${t('checkpoints.tasks')}: —</div>
            <ul>
              <li>\${t('checkpoints.changed')}: fast-memory.jsonl</li>
              <li>\${t('checkpoints.created')}: \${c.dir}</li>
              <li>\${t('checkpoints.irreversible')}: —</li>
              <li>\${t('checkpoints.assets')}: —</li>
            </ul>
          </div>`,
  `          <div class="cp-body">
            <div>\${t('checkpoints.tasks')}: \${escapeHtml(c.phase || '')}</div>
            <ul>
              <li>\${t('checkpoints.changed')}: \${escapeHtml((c.filesChanged || []).map((f) => f.path).join(', ') || '—')}</li>
              <li>\${t('checkpoints.created')}: \${escapeHtml((c.filesCreated || []).map((f) => f.path).join(', ') || c.dir)}</li>
              <li>\${t('checkpoints.irreversible')}: \${escapeHtml((c.irreversible || []).join(', ') || '—')}</li>
              <li>\${t('checkpoints.assets')}: \${escapeHtml((c.assets || []).join(', ') || '—')}</li>
            </ul>
          </div>`
);

// ── 执行者面板绑定 ──
if (!j.includes('btn-exec-run')) {
  j = j.replace(
    "  $('btn-kb-go')?.addEventListener('click'",
    `  async function refreshExecutors() {
    const box = $('exec-box');
    if (!box) return;
    const r = await window.ccarmy.executorsStatus().catch(() => null);
    const items = r?.items || [];
    box.innerHTML = items.length
      ? items.map((it) => '<div>' + escapeHtml(it.name) + ' · ' + it.status + ' · ' + it.durationMs + 'ms</div>').join('')
      : '—';
  }
  $('btn-exec-run')?.addEventListener('click', async () => {
    const brief = state.selectedChat?.name || 'run task';
    await window.ccarmy.executorsRunBrief({ brief, contextItems: [] });
    refreshExecutors();
  });
  setInterval(refreshExecutors, 8000);

  $('btn-kb-go')?.addEventListener('click'`
  );
  console.log('executor panel bound');
}

// ── 语音转文字 ──
j = j.replace(
  `        const r = await window.ccarmy.saveVoice({ dataUrl, ext: 'webm' });
        if (r?.ok && state.selectedChat) {
          pushMsg(state.selectedChat.id, 'me', \`[\${t('chat.voice')}] \${r.path.split(/[\\\\/]/).pop()}\`);
          renderChat();
        } else {
          uiAlert(t('chat.voiceUnsupported'));
        }`,
  `        const r = await window.ccarmy.saveVoice({ dataUrl, ext: 'webm' });
        if (r?.ok && state.selectedChat) {
          // 尝试 ASR 转文字
          const asr = await window.ccarmy.asrTranscribe({ dataUrl, ext: 'webm' }).catch(() => null);
          const text = asr?.ok && asr.text ? asr.text : \`[\${t('chat.voice')}] \${r.path.split(/[\\\\/]/).pop()}\`;
          pushMsg(state.selectedChat.id, 'me', text);
          renderChat();
        } else {
          uiAlert(t('chat.voiceUnsupported'));
        }`
);

// ── E. 状态持久化：启动时加载、变更时保存 ──
if (!j.includes('stateSave')) {
  j = j.replace(
    "    setNav('singleAi');\n    refreshMetrics();\n  })();",
    `    // E. 加载持久化状态
    try {
      const st = await window.ccarmy.stateLoad();
      if (st?.state) {
        if (Array.isArray(st.state.plugins) && st.state.plugins.length) state.plugins = st.state.plugins;
        if (Array.isArray(st.state.groups) && st.state.groups.length) state.groups = st.state.groups;
        if (Array.isArray(st.state.chats) && st.state.chats.length) state.chats = st.state.chats;
      }
    } catch { /* noop */ }
    // 变更时保存
    const saveState = () => {
      window.ccarmy.stateSave({
        plugins: state.plugins,
        groups: state.groups,
        chats: state.chats,
      }).catch(() => {});
    };
    window.__saveState = saveState;
    setInterval(saveState, 15000);
    setNav('singleAi');
    refreshMetrics();
    refreshExecutors();
  })();`
  );
  console.log('state persistence renderer wired');
}

fs.writeFileSync(base + 'electron-main.ts', m);
fs.writeFileSync(base + 'renderer/app.js', j);
console.log('all patched');
