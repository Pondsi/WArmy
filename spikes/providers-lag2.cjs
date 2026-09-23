const fs = require('node:fs');
const base = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/';
let m = fs.readFileSync(base + 'electron-main.ts', 'utf8');
let j = fs.readFileSync(base + 'renderer/yingYong.js', 'utf8');
let p = fs.readFileSync(base + 'preload.cjs', 'utf8');

// ── IPC ──
if (!m.includes('warmy:daoRuopenclaw')) {
  m += '\n// ── 导入 openclaw.json 供应商配置 ──\n';
  m += "ipcMain.handle('warmy:daoRuopenclaw', () => {\n";
  m += "  try {\n";
  m += "    const ocPath = path.join(app.getPath('userData'), '..', 'openclaw.json');\n";
  m += "    if (!fs.existsSync(ocPath)) return { ok: false, error: 'openclaw.json not found' };\n";
  m += "    const j = JSON.parse(fs.readFileSync(ocPath, 'utf8'));\n";
  m += "    const provs = Object.entries(j.models?.providers || {}).map(([id, pv]) => {\n";
  m += "      const p = pv as { baseURL?: string; baseUrl?: string; apiKey?: string; api?: string; models?: Array<{ ming?: string; id?: string }> };\n";
  m += "      return {\n";
  m += "        id, biaoQian: id, protocol: 'openai-compatible' as const,\n";
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
  m += "ipcMain.handle('warmy:teShuMoXingJiSheZhi', (_e, cfg: { asr?: { provider: string }; embedding?: { provider: string }; summary?: { provider: string; model?: string }; organizer?: { provider: string; model?: string } }) => {\n";
  m += "  if (settingsStore) {\n";
  m += "    const cur = settingsStore.load() as Record<string, unknown>;\n";
  m += "    settingsStore.save({ ...cur, specialModels: cfg } as never);\n";
  m += "  }\n";
  m += "  return { ok: true };\n";
  m += "});\n\n";
  m += "ipcMain.handle('warmy:teShuMoXingJiQu', () => {\n";
  m += "  const s = settingsStore?.load() as Record<string, unknown>;\n";
  m += "  return { ok: true, specialModels: s?.specialModels || {} };\n";
  m += "});\n\n";
  m += "ipcMain.handle('warmy:asrollama', async (_e, payload: { audioBase64: string; model?: string }) => {\n";
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
  const anchor = "  exportAllowlist: () => ipcRenderer.invoke('warmy:daoChuYunXuMingDan'),";
  p = p.replace(anchor, anchor + '\n' +
    "  importOpenclaw: () => ipcRenderer.invoke('warmy:daoRuopenclaw'),\n" +
    "  specialModelsSet: (cfg) => ipcRenderer.invoke('warmy:teShuMoXingJiSheZhi', cfg),\n" +
    "  specialModelsGet: () => ipcRenderer.invoke('warmy:teShuMoXingJiQu'),\n" +
    "  asrOllama: (payload) => ipcRenderer.invoke('warmy:asrollama', payload),");
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
  const about = "        <div class=\"sheZhiSection sheZhiKa\">\n          <h2>${t('settings.about')}</h2>";
  if (j.includes(about)) {
    j = j.replace(about, `        <div class="sheZhiSection sheZhiKa">
          <h2>\${t('settings.importProviders')}</h2>
          <p class="jingYin">\${t('settings.importHint')}</p>
          <button class="anNiuXiao" id="btn-import-openclaw">\${t('settings.importDo')}</button>
          <span class="jingYin" id="import-msg"></span>
        </div>
        <div class="sheZhiSection sheZhiKa">
          <h2>\${t('settings.specialModels')}</h2>
          <p class="jingYin">\${t('settings.specialModelsHint')}</p>
          <div class="field" style="margin-bottom:8px">
            <biaoQian>\${t('settings.asrModel')}</biaoQian>
            <select id="smasr">
              <option value="ollama">Ollama (whisper-tiny)</option>
              <option value="whisper-cpp">whisper.cpp (local)</option>
              <option value="openai">OpenAI Whisper API</option>
            </select>
          </div>
          <div class="field" style="margin-bottom:8px">
            <biaoQian>\${t('settings.embeddingModel')}</biaoQian>
            <select id="smEmbed">
              <option value="onnx">ONNX (bge-small-zh)</option>
              <option value="ollama">Ollama embedding</option>
              <option value="api">API embedding</option>
            </select>
          </div>
          <div class="field" style="margin-bottom:8px">
            <biaoQian>\${t('settings.summaryModel')}</biaoQian>
            <shuRu id="sm-summary" placeholder="deepseek-flash"/>
          </div>
          <div class="field" style="margin-bottom:8px">
            <biaoQian>\${t('settings.organizerModel')}</biaoQian>
            <shuRu id="smOrganizer" placeholder="deepseek-chat"/>
          </div>
          <button class="anNiuXiao" id="anNiuBaoCunTeShu">\${t('common.save')}</button>
          <span class="jingYin" id="smXiaoXi"></span>
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
        const r = await window.warmy.importOpenclaw().catch(() => null);
        if (r?.ok) {
          $('import-msg').textContent = t('instances.saved') + ' (' + r.providers.length + ')';
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
${invite}`);
    console.log('bindings added');
  }
}

fs.writeFileSync(base + 'electron-main.ts', m);
fs.writeFileSync(base + 'renderer/yingYong.js', j);
console.log('done');
console.log('  importOpenclaw:', m.includes('warmy:daoRuopenclaw'));
console.log('  specialModels:', m.includes('warmy:teShuMoXingJiSheZhi'));
console.log('  ollama asr:', m.includes('warmy:asrollama'));
console.log('  raf throttle:', j.includes('__rafThrottle'));
console.log('  btn-import:', j.includes('btn-import-openclaw'));
console.log('  anNiuBaoCunTeShu:', j.includes('anNiuBaoCunTeShu'));
