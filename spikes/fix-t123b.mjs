import fs from 'node:fs';
function edit(rel, pairs) {
  let s = fs.readFileSync(rel, 'utf8');
  for (const [oldS, newS, tag] of pairs) {
    const n = s.split(oldS).length - 1;
    if (n !== 1) { console.error(`FAIL ${rel} [${tag}] hits=${n}`); process.exit(1); }
    s = s.replace(oldS, newS);
  }
  fs.writeFileSync(rel, s, 'utf8');
  console.log(`OK ${rel}`);
}

edit('packages/app-shell/src/renderer/app.js', [
  [
    `        yuanSu.querySelector('[data-fetch]').onclick = async () => {`,
    `        yuanSu.querySelector('[data-manual-add]')?.addEventListener('click', () => {
          kaiShouDongMoXing(pr.id);
        });
        yuanSu.querySelector('[data-fetch]').onclick = async () => {`,
    'bind-manual',
  ],
]);

// preload
edit('packages/app-shell/src/preload.cjs', [
  [
    `  copyFileToClipboard: (p) => ipcRenderer.invoke('warmy:copyFileToClipboard', p),`,
    `  copyFileToClipboard: (p) => ipcRenderer.invoke('warmy:copyFileToClipboard', p),
  shouDongMoXingYanZheng: (p) => ipcRenderer.invoke('warmy:shouDongMoXingYanZheng', p),`,
    'preload-manual',
  ],
]);

// IPC：手动模型验证（用该供应商列模型或最小 chat）
edit('packages/app-shell/src/electron-main.ts', [
  [
    `/** 复制文件到系统剪贴板（右键菜单「复制」）；失败时由渲染层回退为复制路径 */`,
    `/** 手动添加模型：用该供应商设置验证模型是否可用 */
chuliIpc('warmy:shouDongMoXingYanZheng', async (_e, p0?: {
  providerId?: string; model?: string; contextLen?: number; maxOut?: number;
  inputTypes?: string[]; outputTypes?: string[]; caps?: string[];
}) => {
  try {
    const pid = String(p0?.providerId || '');
    const model = String(p0?.model || '').trim();
    if (!pid || !model) return { ok: false, error: 'bad-payload' };
    const s = settingsStore?.load() as {
      providers?: Array<{ id?: string; protocol?: string; baseURL?: string; apiKey?: string; hasKey?: boolean; models?: string[] }>;
    } | undefined;
    const pr = (s?.providers || []).find((x) => x && x.id === pid);
    if (!pr) return { ok: false, error: 'provider-not-found' };
    const apiKey = String(pr.apiKey || '') || (await jiexiGongyingshangMiyao(pid)) || '';
    if (pr.protocol !== 'ollama' && !apiKey) return { ok: false, error: 'no-api-key' };
    const provider = congYuSheChuangJian(pid, {
      apiKey, baseURL: pr.baseURL || undefined, protocol: (pr.protocol || 'openai-compatible') as never,
    } as never, (pr.protocol || 'openai-compatible') as never);
    // 优先 ping / 最小 chat
    try {
      if (typeof (provider as { ping?: (s?: unknown) => Promise<unknown> }).ping === 'function') {
        await (provider as { ping: (s?: unknown) => Promise<unknown> }).ping();
      }
    } catch (e) {
      return { ok: false, error: 'ping-failed: ' + xiJingCuoWu(e).slice(0, 120) };
    }
    try {
      const r = await provider.chat({
        model,
        xiaoXiJi: [{ role: 'user' as const, content: 'hi' }],
        maxTokens: 8,
      });
      const txt = neiRongWenBen(r.choices?.[0]?.message?.content);
      // 有响应即算可用（空文本也可能是 maxTokens=8 截断）
      return { ok: true, sample: txt.slice(0, 40) };
    } catch (e) {
      const msg = xiJingCuoWu(e);
      // 404/unknown model 明确失败
      if (/404|not.?found|unknown.?model|model_not_found/i.test(msg)) {
        return { ok: false, error: 'model-not-found: ' + msg.slice(0, 120) };
      }
      // 401/403 密钥问题
      if (/401|403|unauthorized|invalid.?api.?key/i.test(msg)) {
        return { ok: false, error: 'auth-failed: ' + msg.slice(0, 120) };
      }
      return { ok: false, error: msg.slice(0, 160) };
    }
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});
/** 复制文件到系统剪贴板（右键菜单「复制」）；失败时由渲染层回退为复制路径 */`,
    'ipc-manual-verify',
  ],
]);

console.log('manual-add IPC wired');
