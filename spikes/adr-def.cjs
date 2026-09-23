const fs = require('node:fs');
const base = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/';
let m = fs.readFileSync(base + 'electron-main.ts', 'utf8');
let j = fs.readFileSync(base + 'renderer/yingYong.js', 'utf8');
let h = fs.readFileSync(base + 'renderer/index.html', 'utf8');

// ── D. ASR 语音转文字 ──
if (!m.includes('warmy:asrZhuanXie')) {
  m += `

// ── D. ASR 语音转文字（调用 DeepSeek 兼容接口的 audio 端点；失败返回 null） ──
ipcMain.handle('warmy:asrZhuanXie', async (_e, payload: { dataUrl: string; ext?: string }) => {
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
    "  costSummary: () => ipcRenderer.invoke('warmy:chengBenZhaiYao'),",
    `  costSummary: () => ipcRenderer.invoke('warmy:chengBenZhaiYao'),
  executorsStatus: () => ipcRenderer.invoke('warmy:zhiXingQiJiZhuangTai'),
  executorsRunBrief: (payload) => ipcRenderer.invoke('warmy:zhiXingQiJiYunXingJianYao', payload),
  stateSave: (s) => ipcRenderer.invoke('warmy:taiBaoCun', s),
  stateLoad: () => ipcRenderer.invoke('warmy:taiJiaZai'),
  asrTranscribe: (p) => ipcRenderer.invoke('warmy:asrZhuanXie', p),`
  );
  fs.writeFileSync(base + 'preload.cjs', p);
  console.log('preload updated');
}

// ── 右栏：执行者面板 ──
if (!h.includes('zhiXingHe')) {
  h = h.replace(
    '          <div class="mianBanKuai">\n            <h3 data-i18n="metrics.biaoTi"></h3>',
    `          <div class="mianBanKuai">
            <h3 data-i18n="executors.biaoTi"></h3>
            <div id="zhiXingHe" class="jingYin">—</div>
            <div style="margin-top:8px">
              <button class="anNiuXiao" id="anNiuZhiXingYunXing" data-i18n="executors.run"></button>
            </div>
          </div>
          <div class="mianBanKuai">
            <h3 data-i18n="metrics.biaoTi"></h3>`
  );
  fs.writeFileSync(base + 'renderer/index.html', h);
  console.log('exec panel added');
}

// ── 检查点详情填充真实文件 ──
j = j.replace(
  `          <div class="cpTi">
            <div>\${t('checkpoints.tasks')}: —</div>
            <ul>
              <li>\${t('checkpoints.changed')}: fast-memory.jsonl</li>
              <li>\${t('checkpoints.created')}: \${c.dir}</li>
              <li>\${t('checkpoints.irreversible')}: —</li>
              <li>\${t('checkpoints.assets')}: —</li>
            </ul>
          </div>`,
  `          <div class="cpTi">
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
if (!j.includes('anNiuZhiXingYunXing')) {
  j = j.replace(
    "  $('anNiuZhiShiKuGo')?.addEventListener('click'",
    `  async function refreshExecutors() {
    const box = $('zhiXingHe');
    if (!box) return;
    const r = await window.warmy.executorsStatus().catch(() => null);
    const items = r?.items || [];
    box.innerHTML = items.length
      ? items.map((it) => '<div>' + escapeHtml(it.name) + ' · ' + it.status + ' · ' + it.durationMs + 'ms</div>').join('')
      : '—';
  }
  $('anNiuZhiXingYunXing')?.addEventListener('click', async () => {
    const brief = state.selectedChat?.name || 'run task';
    await window.warmy.executorsRunBrief({ brief, contextItems: [] });
    refreshExecutors();
  });
  setInterval(refreshExecutors, 8000);

  $('anNiuZhiShiKuGo')?.addEventListener('click'`
  );
  console.log('executor panel bound');
}

// ── 语音转文字 ──
j = j.replace(
  `        const r = await window.warmy.saveVoice({ dataUrl, ext: 'webm' });
        if (r?.ok && state.selectedChat) {
          pushMsg(state.selectedChat.id, 'wo', \`[\${t('chat.voice')}] \${r.path.split(/[\\\\/]/).pop()}\`);
          renderChat();
        } else {
          uiAlert(t('chat.voiceUnsupported'));
        }`,
  `        const r = await window.warmy.saveVoice({ dataUrl, ext: 'webm' });
        if (r?.ok && state.selectedChat) {
          // 尝试 ASR 转文字
          const asr = await window.warmy.asrTranscribe({ dataUrl, ext: 'webm' }).catch(() => null);
          const text = asr?.ok && asr.text ? asr.text : \`[\${t('chat.voice')}] \${r.path.split(/[\\\\/]/).pop()}\`;
          pushMsg(state.selectedChat.id, 'wo', text);
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
      const st = await window.warmy.stateLoad();
      if (st?.state) {
        if (Array.isArray(st.state.chaJianJi) && st.state.chaJianJi.length) state.chaJianJi = st.state.chaJianJi;
        if (Array.isArray(st.state.groups) && st.state.groups.length) state.groups = st.state.groups;
        if (Array.isArray(st.state.chats) && st.state.chats.length) state.chats = st.state.chats;
      }
    } catch { /* noop */ }
    // 变更时保存
    const saveState = () => {
      window.warmy.stateSave({
        chaJianJi: state.chaJianJi,
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
fs.writeFileSync(base + 'renderer/yingYong.js', j);
console.log('all patched');
