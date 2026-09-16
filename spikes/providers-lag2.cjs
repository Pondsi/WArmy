const fs = require('node:fs');
const base = 'C:/Users/p/.openclaw/workspace/大龙虾互动区/CCArmy/packages/app-shell/src/';
let m = fs.readFileSync(base + 'electron-main.ts', 'utf8');
let j = fs.readFileSync(base + 'renderer/app.js', 'utf8');
let p = fs.readFileSync(base + 'preload.cjs', 'utf8');

// ── IPC ──
if (!m.includes('ccarmy:import-openclaw')) {
  m += '\n// ── 导入 openclaw.json 供应商配置 ──\n';
  m += "ipcMain.handle('ccarmy:import-openclaw', () => {\n";
  m += "  try {\n";
  m += "    const ocPath = path.join(app.getPath('userData'), '..', 'openclaw.json');\n";
  m += "    if (!fs.existsSync(ocPath)) return { ok: false, error: 'openclaw.json not found' };\n";
  m += "    const j = JSON.parse(fs.readFileSync(ocPath, 'utf8'));\n";
  m += "    const provs = Object.entries(j.models?.providers || {}).map(([id, pv]) => {\n";
  m += "      const p = pv as { baseURL?: string; baseUrl?: string; apiKey?: string; api?: string; models?: Array<{ name?: string; id?: string }> };\n";
  m += "      return {\n";
  m += "        id, label: id, protocol: 'openai-compatible' as const,\n";
  m += "        baseURL: p.baseURL || p.baseUrl || '',\n";
  m += "        apiKey: p.apiKey || p.api || '',\n";
  m += "        defaultModel: (p.models?.[0]?.name || p.models?.[0]?.id) || '',\n";
  m += "        models: (p.models || []).map((m) => m.name || m.id).filter(Boolean) as string[],\n";
  m += "      };\n";
  m += "    });\n";
  m += "    if (settingsStore) {\n";
  m += "      const cur = settingsStore.load() as Record<string, unknown>;\n";
  m += "      settingsStore.save({ ...cur, importedProviders: provs } as never);\n";
  m += "    }\n";
  m += "    audit?.log('providers.import', { count: provs.length });\n";
  m += "    return { ok: true, providers: provs };\n";
  m += "  } catch (e) {\n";
  m += "    return { ok: false, error: String(e) };\n";
  m += "  }\n";
  m += "});\n\n";
  m += "ipcMain.handle('ccarmy:special-models-set', (_e, cfg: { asr?: { provider: string }; embedding?: { provider: string }; summary?: { provider: string; model?: string }; organizer?: { provider: string; model?: string } }) => {\n";
  m += "  if (settingsStore) {\n";
  m += "    const cur = settingsStore.load() as Record<string, unknown>;\n";
  m += "    settingsStore.save({ ...cur, specialModels: cfg } as never);\n";
  m += "  }\n";
  m += "  return { ok: true };\n";
  m += "});\n\n";
  m += "ipcMain.handle('ccarmy:special-models-get', () => {\n";
  m += "  const s = settingsStore?.load() as Record<string, unknown>;\n";
  m += "  return { ok: true, specialModels: s?.specialModels || {} };\n";
  m += "});\n\n";
  m += "ipcMain.handle('ccarmy:asr-ollama', async (_e, payload: { audioBase64: string; model?: string }) => {\n";
  m += "  try {\n";
  m += "    const res = await fetch('http://127.0.0.1:11434/api/generate', {\n";
  m += "      method: 'POST',\n";
  m += "      headers: { 'Content-Type': 'application/json' },\n";
  m += "      body: JSON.stringify({ model: payload.model || 'dimavz/whisper-tiny', prompt: 'Transcribe audio:', stream: false, options: { audio: payload.audioBase64 } }),\n";
  m += "    });\n";
  m += "    if (!res.ok) return { ok: false, error: 'http ' + res.status };\n";
  m += "    const data = (await res.json()) as { response?: string };\n";
  m += "    return { ok: true, text: data.response || '' };\n";
  m += "  } catch (e) { return { ok: false, error: String(e) }; }\n";
  m += "});\n";
  console.log('IPC added');
}

// preload
if (!p.includes('importOpenclaw')) {
  const anchor = "  exportAllowlist: () => ipcRenderer.invoke('ccarmy:export-allowlist'),";
  p = p.replace(anchor, anchor + '\n' +
    "  importOpenclaw: () => ipcRenderer.invoke('ccarmy:import-openclaw'),\n" +
    "  specialModelsSet: (cfg) => ipcRenderer.invoke('ccarmy:special-models-set', cfg),\n" +
    "  specialModelsGet: () => ipcRenderer.invoke('ccarmy:special-models-get'),\n" +
    "  asrOllama: (payload) => ipcRenderer.invoke('ccarmy:asr-ollama', payload),");
  fs.writeFileSync(base + 'preload.cjs', p);
  console.log('preload ok');
}

// ── 输入卡顿修复 ──
if (!j.includes('__rafThrottle')) {
  j = j.replace(
    "  const t = (k) => state.t[k] || k;",
    "  const t = (k) => state.t[k] || k;\n  let __rafThrottle = false;\n  function raf(fn) {\n    if (__rafThrottle) return;\n    __rafThrottle = true;\n    requestAnimationFrame(() => { __rafThrottle = false; fn(); });\n  }\n  let __inputThrottle = 0;"
  );
  console.log('raf throttle added');
}

// 减少 setInterval 频率
j = j.replace('setInterval(refreshMetrics, 5000);', 'setInterval(() => raf(refreshMetrics), 8000);');
j = j.replace('setInterval(refreshCost, 8000);', 'setInterval(() => raf(refreshCost), 10000);');
j = j.replace('setInterval(refreshExecutors, 8000);', 'setInterval(() => raf(refreshExecutors), 12000);');
j = j.replace('setInterval(checkLastError, 10000);', 'setInterval(() => raf(checkLastError), 15000);');
j = j.replace("setInterval(() => { refreshSessionBoard(); refreshMembers(); }, 6000);", 'setInterval(() => raf(() => { refreshSessionBoard(); refreshMembers(); }), 10000);');
j = j.replace('setInterval(saveState, 15000);', 'setInterval(() => raf(saveState), 30000);');

// ── 设置里加导入按钮和特殊模型 ──
if (!j.includes('btn-import-openclaw')) {
  const about = "        <div class=\"set-section set-card\">\n          <h2>${t('settings.about')}</h2>";
  if (j.includes(about)) {
    j = j.replace(about, `        <div class="set-section set-card">
          <h2>\${t('settings.importProviders')}</h2>
          <p class="muted">\${t('settings.importHint')}</p>
          <button class="btn-mini" id="btn-import-openclaw">\${t('settings.importDo')}</button>
          <span class="muted" id="import-msg"></span>
        </div>
        <div class="set-section set-card">
          <h2>\${t('settings.specialModels')}</h2>
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
            <label>\${t('settings.summaryModel')}</label>
            <input id="sm-summary" placeholder="deepseek-flash"/>
          </div>
          <div class="field" style="margin-bottom:8px">
            <label>\${t('settings.organizerModel')}</label>
            <input id="sm-organizer" placeholder="deepseek-chat"/>
          </div>
          <button class="btn-mini" id="btn-save-special">\${t('common.save')}</button>
          <span class="muted" id="sm-msg"></span>
        </div>
${about}`);
    console.log('special models UI added');
  }
}

// 绑定
if (!j.includes('btn-import-openclaw\')')) {
  const invite = "      // 邀请链接 / 二维码";
  if (j.includes(invite)) {
    j = j.replace(invite, `      $('btn-import-openclaw')?.addEventListener('click', async () => {
        $('import-msg').textContent = t('common.loading');
        const r = await window.ccarmy.importOpenclaw().catch(() => null);
        if (r?.ok) {
          $('import-msg').textContent = t('instances.saved') + ' (' + r.providers.length + ')';
          state.providers = r.providers;
          renderPage();
        } else {
          $('import-msg').textContent = String(r?.error || t('common.error'));
        }
      });
      $('btn-save-special')?.addEventListener('click', async () => {
        const cfg = {
          asr: { provider: $('sm-asr')?.value || 'ollama' },
          embedding: { provider: $('sm-embed')?.value || 'onnx' },
          summary: { provider: 'deepseek', model: $('sm-summary')?.value || 'deepseek-flash' },
          organizer: { provider: 'deepseek', model: $('sm-organizer')?.value || 'deepseek-chat' },
        };
        await window.ccarmy.specialModelsSet(cfg).catch(() => {});
        $('sm-msg').textContent = t('instances.saved');
      });
${invite}`);
    console.log('bindings added');
  }
}

fs.writeFileSync(base + 'electron-main.ts', m);
fs.writeFileSync(base + 'renderer/app.js', j);
console.log('done');
console.log('  importOpenclaw:', m.includes('ccarmy:import-openclaw'));
console.log('  specialModels:', m.includes('ccarmy:special-models-set'));
console.log('  ollama asr:', m.includes('ccarmy:asr-ollama'));
console.log('  raf throttle:', j.includes('__rafThrottle'));
console.log('  btn-import:', j.includes('btn-import-openclaw'));
console.log('  btn-save-special:', j.includes('btn-save-special'));
