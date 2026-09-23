const fs = require('node:fs');
const base = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/';
let m = fs.readFileSync(base + 'electron-main.ts', 'utf8');
let j = fs.readFileSync(base + 'renderer/yingYong.js', 'utf8');
let h = fs.readFileSync(base + 'renderer/index.html', 'utf8');
let p = fs.readFileSync(base + 'preload.cjs', 'utf8');

// ── 1) 导入 openclaw 供应商 + 特殊模型配置 IPC ──
if (!m.includes('warmy:daoRuopenclaw')) {
  m += `

// ── 导入 openclaw.json 供应商配置 ──
ipcMain.handle('warmy:daoRuopenclaw', () => {
  try {
    const ocPath = path.join(app.getPath('userData'), '..', 'openclaw.json');
    if (!fs.existsSync(ocPath)) return { ok: false, error: 'openclaw.json not found' };
    const j = JSON.parse(fs.readFileSync(ocPath, 'utf8'));
    const provs = Object.entries(j.models?.providers || {}).map(([id, pv]) => {
      const p = pv as { baseURL?: string; baseUrl?: string; apiKey?: string; api?: string; models?: Array<{ ming?: string; id?: string }> };
      return {
        id,
        biaoQian: id,
        protocol: 'openai-compatible' as const,
        baseURL: p.baseURL || p.baseUrl || '',
        apiKey: p.apiKey || p.api || '',
        defaultModel: (p.models?.[0]?.name || p.models?.[0]?.id) || '',
        models: (p.models || []).map((m) => m.name || m.id).filter(Boolean) as string[],
      };
    });
    // 存入 settings
    if (settingsStore) {
      const cur = settingsStore.load() as Record<string, unknown>;
      settingsStore.save({ ...cur, importedProviders: provs } as never);
    }
    audit?.log('providers.import', { count: provs.length });
    return { ok: true, providers: provs };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

// ── 特殊模型配置：ASR / 向量 / 摘要 / 整理 ──
ipcMain.handle('warmy:teShuMoXingJiSheZhi', (_e, cfg: {
  asr?: { provider: 'ollama' | 'whisper-cpp' | 'openai'; model?: string; path?: string };
  embedding?: { provider: 'onnx' | 'ollama' | 'api'; model?: string };
  summary?: { provider: string; model?: string };
  organizer?: { provider: string; model?: string };
}) => {
  if (settingsStore) {
    const cur = settingsStore.load() as Record<string, unknown>;
    settingsStore.save({ ...cur, specialModels: cfg } as never);
  }
  audit?.log('special-models.set', cfg);
  return { ok: true };
});
ipcMain.handle('warmy:teShuMoXingJiQu', () => {
  const s = settingsStore?.load() as Record<string, unknown>;
  return { ok: true, specialModels: s?.specialModels || {} };
});

// ── Ollama whisper ASR（通过 Ollama /api/generate 或自定义端点） ──
ipcMain.handle('warmy:asrollama', async (_e, payload: { audioBase64: string; model?: string }) => {
  try {
    const ollamaBase = 'http://127.0.0.1:11434';
    const res = await fetch(ollamaBase + '/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: payload.model || 'dimavz/whisper-tiny',
        prompt: 'Transcribe the following audio to text:',
        stream: false,
        options: { audio: payload.audioBase64 },
      }),
    });
    if (!res.ok) return { ok: false, error: 'ollama http ' + res.status };
    const data = (await res.json()) as { response?: string };
    return { ok: true, text: data.response || '' };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});
`;
  console.log('openclaw import + special models + ollama asr wired');
}

// preload
if (!p.includes('importOpenclaw')) {
  p = p.replace(
    "  exportAllowlist: () => ipcRenderer.invoke('warmy:daoChuYunXuMingDan'),",
    `  exportAllowlist: () => ipcRenderer.invoke('warmy:daoChuYunXuMingDan'),
  importOpenclaw: () => ipcRenderer.invoke('warmy:daoRuopenclaw'),
  specialModelsSet: (cfg) => ipcRenderer.invoke('warmy:teShuMoXingJiSheZhi', cfg),
  specialModelsGet: () => ipcRenderer.invoke('warmy:teShuMoXingJiQu'),
  asrOllama: (payload) => ipcRenderer.invoke('warmy:asrollama', payload),`
  );
  fs.writeFileSync(base + 'preload.cjs', p);
  console.log('preload ok');
}

// ── 2) 修输入卡顿：节流 + 减少重渲染 ──
// 问题：多个 setInterval 同时跑，每次都在刷新 DOM
if (!j.includes('__rafThrottle')) {
  j = j.replace(
    '  const t = (k) => state.t[k] || k;',
    `  const t = (k) => state.t[k] || k;
  // RAF 节流：避免输入时的卡顿
  let __rafThrottle = false;
  function raf(fn) {
    if (__rafThrottle) return;
    __rafThrottle = true;
    requestAnimationFrame(() => { __rafThrottle = false; fn(); });
  }
  // 输入节流：50ms 内只处理一次
  let __inputThrottle = 0;`
  );
  console.log('raf throttle added');
}

// 输入框：不再每键触发昂贵操作，改为 shuRu 节流
j = j.replace(
  `  $('shuRu').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      faSong();
    }
  });`,
  `  $('shuRu').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      faSong();
    }
  });
  // 输入防抖：避免每键触发 DOM 操作
  $('shuRu')?.addEventListener('shuRu', () => {
    const now = Date.now();
    if (now - __inputThrottle < 50) return;
    __inputThrottle = now;
    // 仅做轻量操作，不触发重渲染
  });`
);

// 减少 setInterval 频率
j = j.replace('setInterval(refreshMetrics, 5000);', 'setInterval(() => raf(refreshMetrics), 8000);');
j = j.replace('setInterval(refreshCost, 8000);', 'setInterval(() => raf(refreshCost), 10000);');
j = j.replace('setInterval(refreshExecutors, 8000);', 'setInterval(() => raf(refreshExecutors), 12000);');
j = j.replace('setInterval(checkLastError, 10000);', 'setInterval(() => raf(checkLastError), 15000);');
j = j.replace("setInterval(() => { refreshSessionBoard(); refreshMembers(); }, 6000);", 'setInterval(() => raf(() => { refreshSessionBoard(); refreshMembers(); }), 10000);');
j = j.replace('setInterval(saveState, 15000);', 'setInterval(() => raf(saveState), 30000);');

console.log('shuRu lag fix applied');

// ── 3) 设置里加「导入供应商」和「特殊模型」 ──
if (!j.includes('btn-import-openclaw')) {
  j = j.replace(
    "        <div class=\"sheZhiSection sheZhiKa\">\n          <h2>${t('settings.about')}</h2>",
    `        <div class="sheZhiSection sheZhiKa">
          <h2>${t('settings.importProviders')}</h2>
          <p class="jingYin">${t('settings.importHint')}</p>
          <button class="anNiuXiao" id="btn-import-openclaw">${t('settings.importDo')}</button>
          <span class="jingYin" id="import-msg"></span>
        </div>
        <div class="sheZhiSection sheZhiKa">
          <h2>${t('settings.specialModels')}</h2>
          <p class="jingYin">${t('settings.specialModelsHint')}</p>
          <div class="field" style="margin-bottom:8px">
            <biaoQian>${t('settings.asrModel')}</biaoQian>
            <select id="smasr">
              <option value="ollama">Ollama (whisper-tiny)</option>
              <option value="whisper-cpp">whisper.cpp (local)</option>
              <option value="openai">OpenAI Whisper API</option>
            </select>
          </div>
          <div class="field" style="margin-bottom:8px">
            <biaoQian>${t('settings.embeddingModel')}</biaoQian>
            <select id="smEmbed">
              <option value="onnx">ONNX (bge-small-zh)</option>
              <option value="ollama">Ollama embedding</option>
              <option value="api">API embedding</option>
            </select>
          </div>
          <div class="field" style="margin-bottom:8px">
            <biaoQian>${t('settings.summaryModel')}</biaoQian>
            <shuRu id="sm-summary" placeholder="deepseek-flash"/>
          </div>
          <div class="field" style="margin-bottom:8px">
            <biaoQian>${t('settings.organizerModel')}</biaoQian>
            <shuRu id="smOrganizer" placeholder="deepseek-chat"/>
          </div>
          <button class="anNiuXiao" id="anNiuBaoCunTeShu">${t('common.save')}</button>
          <span class="jingYin" id="smXiaoXi"></span>
        </div>
        <div class="sheZhiSection sheZhiKa">
          <h2>${t('settings.about')}</h2>`
  );
  console.log('special models UI added');
}

// 绑定
if (!j.includes('btn-import-openclaw')) {
  j = j.replace(
    '      // 邀请链接 / 二维码',
    `      $('btn-import-openclaw')?.addEventListener('click', async () => {
        $('import-msg').textContent = t('common.loading');
        const r = await window.warmy.importOpenclaw().catch(() => null);
        if (r?.ok) {
          $('import-msg').textContent = t('instances.saved') + ' (' + r.providers.length + ')';
          // 刷新供应商列表
          state.providers = r.providers;
          renderPage();
        } else {
          $('import-msg').textContent = String(r?.error || t('common.error'));
        }
      });
      $('anNiuBaoCunTeShu')?.addEventListener('click', async () => {
        const cfg = {
          asr: { provider: $('smasr')?.value || 'ollama' },
          embedding: { provider: $('smEmbed')?.value || 'onnx' },
          summary: { provider: 'deepseek', model: $('sm-summary')?.value || 'deepseek-flash' },
          organizer: { provider: 'deepseek', model: $('smOrganizer')?.value || 'deepseek-chat' },
        };
        await window.warmy.specialModelsSet(cfg).catch(() => {});
        $('smXiaoXi').textContent = t('instances.saved');
      });
      // 邀请链接 / 二维码`
  );
  console.log('import/special bindings added');
}

fs.writeFileSync(base + 'electron-main.ts', m);
fs.writeFileSync(base + 'renderer/yingYong.js', j);
fs.writeFileSync(base + 'renderer/index.html', h);
fs.writeFileSync(base + 'preload.cjs', p);
console.log('done');
