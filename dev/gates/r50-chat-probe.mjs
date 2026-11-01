/**
 * r50-chat-probe.mjs —— 只起一次独立 Electron，发一发 chatSend，把完整返回打出来。
 * 用来定位 verify-r46-youxi 的「0 秒 0 字」是产品还是仪器。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const GEN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PKG = path.join(GEN, 'packages', 'app-shell');
const { attach, sleep } = await import(pathToFileURL(path.join(PKG, 'scripts', 'cdp-lib.mjs')).href);

const PORT = Number(process.env.R50_PORT || 9950);
const PROFILE = path.join(os.tmpdir(), 'warmy-r50-probe-' + Date.now());
const SID = 'r50-probe';
const electron = path.join(PKG, 'node_modules', 'electron', 'dist', 'electron.exe');
const mainJs = path.join(PKG, 'dist', 'electron-main.js');
const MOXING = process.env.OLLAMA_MODEL || 'orcarouter/Qwen3.8-27B-Uncensored:q4_K_M-128K';

fs.mkdirSync(path.join(PROFILE, 'workspace', SID), { recursive: true });
fs.writeFileSync(path.join(PROFILE, 'settings.json'), JSON.stringify({
  setupDone: true, guideDone: true, privacyConsent: true, providersSeeded: true,
  providers: [{ id: 'ollama-r50', biaoQian: 'Ollama(r50)', protocol: 'ollama', baseURL: 'http://127.0.0.1:11434', defaultModel: MOXING, models: [MOXING], hasKey: false, staleModels: {} }],
  instances: [],
  specialModels: { chatChain: [MOXING] },
  contextBudgetPercent: 60,
}), 'utf8');

const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [
  mainJs,
  `--user-data-dir=${PROFILE}`,
  `--remote-debugging-port=${PORT}`,
  '--r50-probe',
], { env, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', (d) => process.stdout.write('[app] ' + d));
child.stderr.on('data', (d) => process.stdout.write('[appE] ' + d));

let c = null;
async function deng() {
  for (let i = 0; i < 200; i++) {
    try {
      const rr = await fetch('http://127.0.0.1:' + PORT + '/json', { signal: AbortSignal.timeout(1200) });
      if (rr.ok) break;
    } catch { /* wait */ }
    await sleep(500);
  }
  await sleep(6000);
  for (let i = 0; i < 30; i++) {
    try {
      c = await attach(PORT, { biaoQian: 'r50probe', callTimeout: 30000 });
      await c.send('Runtime.enable');
      const zhi = await c.evaluate('typeof window.warmy === "object" && typeof window.warmy.chatSend === "function"');
      if (zhi === true) return true;
    } catch { /* wait */ }
    await sleep(2000);
  }
  return false;
}

const up = await deng();
console.log('app up with chatSend =', up);
if (!up) { try { child.kill('SIGKILL'); } catch {} process.exit(1); }

const yu = await c.evaluate(`(async function(){
  try {
    const st = await window.warmy.settingsGet?.();
    const lie = await window.warmy.listModels?.({ protocol: 'ollama', baseURL: 'http://127.0.0.1:11434', providerId: 'ollama-r50' }).catch(e => ({ err: String(e) }));
    return {
      settingsProviders: (st && st.settings && st.settings.providers || []).map(p => ({ id: p.id, protocol: p.protocol, baseURL: p.baseURL, defaultModel: p.defaultModel, hasKey: p.hasKey })),
      chatChain: st && st.settings && st.settings.specialModels,
      listModels: lie,
    };
  } catch (e) { return { err: String(e) }; }
})()`, { awaitPromise: true, timeout: 30000 });
console.log('precheck', JSON.stringify(yu, null, 2).slice(0, 1500));

const t0 = Date.now();
const r = await c.evaluate(`(async function(){
  try {
    const raw = await window.warmy.chatSend({
      sessionId: ${JSON.stringify(SID)},
      content: '请做一个网页小游戏：贪吃蛇。用 write_file 写出 youxi.html（单文件）。只回一行绝对路径。',
      role: 'user', ming: '牛马-1', model: ${JSON.stringify(MOXING)}
    });
    return { type: typeof raw, keys: raw ? Object.keys(raw) : [], raw: raw ? JSON.stringify(raw).slice(0, 1200) : String(raw) };
  } catch (e) { return { threw: String(e && e.message || e) }; }
})()`, { awaitPromise: true, timeout: 180000 });
console.log('chatSend(instances=[]) elapsed', Math.round((Date.now() - t0) / 1000), 's =>', JSON.stringify(r, null, 2).slice(0, 2500));

try { c.close(); } catch {}
try { child.kill('SIGKILL'); } catch {}
process.exit(0);
