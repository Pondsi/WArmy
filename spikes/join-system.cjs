const fs = require('node:fs');
const base = 'C:/Users/p/.openclaw/workspace/大龙虾互动区/WArmy/packages/app-shell/src/';
let m = fs.readFileSync(base + 'electron-main.ts', 'utf8');
let j = fs.readFileSync(base + 'renderer/app.js', 'utf8');
let h = fs.readFileSync(base + 'renderer/index.html', 'utf8');
let p = fs.readFileSync(base + 'preload.cjs', 'utf8');

// ── 1) 加入请求 + 黑名单 IPC ──
if (!m.includes('warmy:join-request')) {
  m += '\n// ── 加入请求 / 黑名单 ──\n';
  m += 'const joinRequests: Array<{ id: string; name: string; kind: string; target: string; targetType: string; ts: number; expireAt: number }> = [];\n';
  m += 'const blacklist: Array<{ id: string; name: string; blockedAt: number; target: string }> = [];\n';
  m += "ipcMain.handle('warmy:join-request', (_e, payload: { name: string; kind: string; target: string; targetType: string }) => {\n";
  m += '  const id = "jr-" + Date.now();\n';
  m += '  const ts = Date.now();\n';
  m += '  joinRequests.push({ id, name: payload.name, kind: payload.kind, target: payload.target, targetType: payload.targetType, ts, expireAt: ts + 30 * 24 * 3600_000 });\n';
  m += "  audit?.log('join.request', { id, name: payload.name, target: payload.target });\n";
  m += '  return { ok: true, id };\n';
  m += '});\n';
  m += "ipcMain.handle('warmy:join-pending', () => {\n";
  m += '  const now = Date.now();\n';
  m += '  const valid = joinRequests.filter((r) => r.expireAt > now);\n';
  m += '  return { ok: true, items: valid, count: valid.length };\n';
  m += '});\n';
  m += "ipcMain.handle('warmy:join-respond', (_e, payload: { id: string; action: 'agree' | 'reject' | 'block' }) => {\n";
  m += '  const idx = joinRequests.findIndex((r) => r.id === payload.id);\n';
  m += '  if (idx < 0) return { ok: false };\n';
  m += '  const req = joinRequests[idx];\n';
  m += '  if (payload.action === "block") {\n';
  m += '    blacklist.push({ id: req.id, name: req.name, blockedAt: Date.now(), target: req.target });\n';
  m += '  }\n';
  m += '  joinRequests.splice(idx, 1);\n';
  m += "  audit?.log('join.respond', { id: req.id, action: payload.action });\n";
  m += '  return { ok: true, remaining: joinRequests.filter((r) => r.expireAt > Date.now()).length };\n';
  m += '});\n';
  m += "ipcMain.handle('warmy:blacklist-list', () => ({ ok: true, items: blacklist }));\n";
  m += "ipcMain.handle('warmy:blacklist-remove', (_e, id: string) => {\n";
  m += '  const i = blacklist.findIndex((b) => b.id === id);\n';
  m += '  if (i >= 0) blacklist.splice(i, 1);\n';
  m += '  return { ok: true };\n';
  m += '});\n';
  console.log('join/blacklist IPC added');
}

// ── 2) 删掉导入供应商 IPC（不再暴露）──
// 保留但不在 UI 显示；不删除主进程逻辑（向后兼容）

// preload
if (!p.includes('joinRequest')) {
  const anchor = "  asrOllama: (payload) => ipcRenderer.invoke('warmy:asr-ollama', payload),";
  p = p.replace(anchor, anchor + '\n' +
    "  joinRequest: (payload) => ipcRenderer.invoke('warmy:join-request', payload),\n" +
    "  joinPending: () => ipcRenderer.invoke('warmy:join-pending'),\n" +
    "  joinRespond: (payload) => ipcRenderer.invoke('warmy:join-respond', payload),\n" +
    "  blacklistList: () => ipcRenderer.invoke('warmy:blacklist-list'),\n" +
    "  blacklistRemove: (id) => ipcRenderer.invoke('warmy:blacklist-remove', id),");
  fs.writeFileSync(base + 'preload.cjs', p);
  console.log('preload join ok');
}

// ── 3) HTML：左栏加加入请求红点 ──
if (!h.includes('join-badge')) {
  h = h.replace(
    '        <button class="rail-item" data-nav="instances" data-i18n-title="tip.instances">',
    '        <div style="position:relative">\n          <button class="rail-item" data-nav="instances" data-i18n-title="tip.instances">'
  );
  h = h.replace(
    '</svg>\n        </button>\n      </div>\n      <div class="rail-bottom">',
    '</svg>\n        </button>\n          <span id="join-badge" class="badge hidden" style="position:absolute;top:-2px;right:-2px;background:#fa5151;color:#fff;min-width:16px;height:16px;font-size:10px;display:grid;place-items:center;border-radius:99px">0</span>\n        </div>\n      </div>\n      <div class="rail-bottom">'
  );
  console.log('join badge HTML');
}

// ── 4) 设置：删导入供应商，合并特殊模型，分类 ──
// 删掉导入供应商区块
j = j.replace(/        <div class="set-section set-card">\s*<h2>\$\{t\('settings\.importProviders'\)\}<\/h2>[\s\S]*?<\/div>\s*<div class="set-section set-card">\s*<h2>\$\{t\('settings\.specialModels'\)\}<\/h2>/,
  `        <div class="set-section set-card">
          <h2>\${t('settings.embeddingSpecial')}</h2>
          <p class="muted">\${t('settings.specialModelsHint')}</p>
          <div class="field" style="margin-bottom:8px">
            <label>\${t('settings.asrModel')}</label>
            <select id="sm-asr">
              <option value="ollama">Ollama (whisper-tiny)</option>
              <option value="whisper-cpp">whisper.cpp (local)</option>
              <option value="openai">OpenAI Whisper API</option>
            </select>
          </div>
          <div class="field" style="margin-bottom:8px">
            <label>\${t('settings.embeddingModel')}</label>
            <select id="sm-embed">
              <option value="onnx">ONNX (bge-small-zh)</option>
              <option value="ollama">Ollama embedding</option>
              <option value="api">API embedding</option>
            </select>
          </div>
          <div class="field" style="margin-bottom:8px">
            <label>\${t('settings.organizerModel')}</label>
            <input id="sm-organizer" placeholder="deepseek-chat"/>
          </div>
          <button class="btn-mini" id="btn-save-special">\${t('common.save')}</button>
          <span class="muted" id="sm-msg"></span>
        </div>
        <div class="set-section set-card">
          <h2>\${t('settings.specialModels')}</h2>`);

// 删掉嵌入/特殊模型旧区块（如果有重复）
j = j.replace(/        <div class="set-section set-card">\s*<h2>\$\{t\('settings\.embedding'\)\}<\/h2>[\s\S]*?<\/div>\s*<div class="set-section set-card">\s*<h2>\$\{t\('mesh\.title'\)\}<\/h2>/,
  `        <div class="set-section set-card">
          <h2>\${t('mesh.title')}</h2>`);

console.log('settings merged');

// 黑名单管理
if (!j.includes('blacklist-box')) {
  j = j.replace(
    "        <div class=\"set-section set-card\">\n          <h2>${t('settings.about')}</h2>",
    `        <div class="set-section set-card">
          <h2>\${t('join.blacklistTitle')}</h2>
          <div id="blacklist-box" class="muted">\${t('join.blacklistEmpty')}</div>
        </div>
        <div class="set-section set-card">
          <h2>\${t('settings.about')}</h2>`
  );
  console.log('blacklist UI added');
}

// 加入请求 UI：弹窗
if (!j.includes('showJoinRequests')) {
  j = j.replace(
    '  // ── 顶层交互绑定（必须全局执行一次） ──',
    `  // ── 加入请求处理 ──
  async function refreshJoinBadge() {
    const r = await window.warmy.joinPending().catch(() => null);
    const n = r?.count || 0;
    const badge = $('join-badge');
    if (badge) {
      badge.textContent = String(n);
      badge.classList.toggle('hidden', n === 0);
    }
  }
  setInterval(() => raf(refreshJoinBadge), 10000);
  refreshJoinBadge();

  function showJoinRequestModal(req) {
    return new Promise((resolve) => {
      const root = $('modal-root');
      $('modal-title').textContent = t('join.requestBadge');
      $('modal-body').innerHTML =
        '<div>' + t('join.requester') + ': ' + escapeHtml(req.name) + '</div>' +
        '<div>' + t('join.kind') + ': ' + escapeHtml(req.kind) + '</div>' +
        '<div>' + t('join.target') + ': ' + escapeHtml(req.targetType) + ' ' + escapeHtml(req.target) + '</div>' +
        '<div>' + t('join.applyTime') + ': ' + new Date(req.ts).toLocaleString() + '</div>' +
        '<div>' + t('join.expireTime') + ': ' + new Date(req.expireAt).toLocaleString() + '</div>';
      const acts = $('modal-actions');
      acts.innerHTML = '';
      const mk = (label, cls, fn) => {
        const b = document.createElement('button');
        b.className = cls;
        b.textContent = label;
        b.onclick = async () => { root.classList.add('hidden'); await fn(); };
        acts.appendChild(b);
      };
      mk(t('join.reject'), 'btn-mini', () => resolve('reject'));
      mk(t('join.blacklist'), 'btn-danger', () => resolve('block'));
      mk(t('join.agree'), 'btn-primary', () => resolve('agree'));
      root.classList.remove('hidden');
    });
  }

  document.querySelectorAll('[data-nav="instances"]').forEach((el) => {
    el.addEventListener('click', async () => {
      const r = await window.warmy.joinPending().catch(() => null);
      if (r?.items?.length) {
        const req = r.items[0];
        const action = await showJoinRequestModal(req);
        await window.warmy.joinRespond({ id: req.id, action });
        refreshJoinBadge();
        uiAlert(t('instances.saved'));
      }
    });
  });

  // ── 顶层交互绑定（必须全局执行一次） ──`
  );
  console.log('join request modal wired');
}

// 黑名单列表渲染
if (!j.includes('refreshBlacklist')) {
  j = j.replace(
    '      async function refreshArchived() {',
    `      async function refreshBlacklist() {
        const box = $('blacklist-box');
        if (!box) return;
        const r = await window.warmy.blacklistList().catch(() => null);
        const items = r?.items || [];
        box.innerHTML = items.length
          ? items.map((b) => '<div style="display:flex;gap:8px;align-items:center;margin:4px 0"><span style="flex:1">' + escapeHtml(b.name) + ' · ' + escapeHtml(b.target) + ' · ' + new Date(b.blockedAt).toLocaleString() + '</span><button class="btn-mini" data-unblock="' + escapeHtml(b.id) + '">' + t('join.removeBlacklist') + '</button></div>').join('')
          : t('join.blacklistEmpty');
        box.querySelectorAll('[data-unblock]').forEach((btn) => {
          btn.onclick = async () => {
            await window.warmy.blacklistRemove(btn.dataset.unblock).catch(() => {});
            refreshBlacklist();
          };
        });
      }
      refreshBlacklist();

      async function refreshArchived() {`
  );
  console.log('blacklist render added');
}

fs.writeFileSync(base + 'electron-main.ts', m);
fs.writeFileSync(base + 'renderer/app.js', j);
fs.writeFileSync(base + 'renderer/index.html', h);
fs.writeFileSync(base + 'preload.cjs', p);
console.log('done');
