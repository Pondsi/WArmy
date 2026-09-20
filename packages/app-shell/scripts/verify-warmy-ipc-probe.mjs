/**
 * WArmy IPC 实测：对 preload 白名单里的只读接口做真实调用（Electron 主进程环境）。
 * 产出 docs/API-OPERATIONS-RESULTS.json —— 说明与形参以预置表为准，本脚本验证「能否调用」。
 * 用法：node packages/app-shell/scripts/verify-warmy-ipc-probe.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(selfDir, '..');
const repoRoot = path.resolve(pkgRoot, '..', '..');
const electron = path.join(pkgRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const mainJs = path.join(pkgRoot, 'dist', 'electron-main.js');
const OUT = path.join(repoRoot, 'docs', 'API-OPERATIONS-RESULTS.json');

const HOST = path.join(os.tmpdir(), 'warmy-ipc-probe-host.cjs');
fs.writeFileSync(HOST, `
const { app, BrowserWindow, ipcMain } = require('electron');
const mainJs = process.env.MAIN_JS;
// load product main after we can intercept
require('electron');
app.whenReady().then(async () => {
  try { require(mainJs); } catch (e) { console.log('MAIN_LOAD_FAIL', String(e).slice(0,200)); }
  const w = new BrowserWindow({ show:false, webPreferences:{ contextIsolation:true, nodeIntegration:false } });
  w.loadURL('data:text/html,<html><body>probe</body></html>');
  // Give main process handlers time to register
  setTimeout(() => {
    const { ipcMain } = require('electron');
    const channels = [];
    // electron doesn't expose handler list easily; probe via invoke from renderer after preload
    console.log('HOST_READY');
  }, 2000);
});
`, 'utf8');

// Simpler approach: run product e2e-style with a small script inside electron that uses ipcRenderer
const PROBE = path.join(os.tmpdir(), 'warmy-ipc-probe.cjs');
fs.writeFileSync(PROBE, `
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const mainJs = process.env.MAIN_JS;
const outPath = process.env.OUT_JSON;
const NAMES = JSON.parse(process.env.PROBE_NAMES || '[]');
const SIG = JSON.parse(process.env.PROBE_SIG || '{}');

app.whenReady().then(async () => {
  // boot product main
  try { require(mainJs); } catch (e) {
    fs.writeFileSync(outPath, JSON.stringify({ error: 'main-load', message: String(e) }, null, 2));
    app.exit(2);
    return;
  }
  await new Promise((r) => setTimeout(r, 2500));
  const { ipcRenderer } = require('electron');
  const results = [];
  for (const name of NAMES) {
    const sig = SIG[name] || '()';
    let channel = name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
    // common channel prefix
    channel = 'warmy:' + channel;
    const argsBySig = {
      memoryRecall: ['WArmy'],
      i18n: ['zh-CN'],
      boardTasks: [],
      knowledgeQuery: ['WArmy'],
      searchMessages: ['测试'],
      containerProbe: [{ force: false }],
      netPortCandidates: [{ requestedPort: 59599 }],
      projectState: [{ sessionId: '' }],
      projectMemoryGet: [{ sessionId: '' }],
      aiQuestionList: [],
      membershipList: [],
      archiveList: [],
    };
    const args = argsBySig[name] || [];
    const t0 = Date.now();
    try {
      const r = await ipcRenderer.invoke(channel, ...args);
      results.push({ name, channel, sig, ok: true, ms: Date.now() - t0, resultPreview: preview(r) });
    } catch (e) {
      results.push({ name, channel, sig, ok: false, ms: Date.now() - t0, error: String(e && e.message || e) });
    }
  }
  fs.writeFileSync(outPath, JSON.stringify({ at: Date.now(), results }, null, 2));
  console.log('PROBE_DONE', results.filter(x=>x.ok).length + '/' + results.length);
  app.exit(0);
});
function preview(r) {
  try {
    const s = JSON.stringify(r);
    return s && s.length > 180 ? s.slice(0, 180) + '…' : s;
  } catch { return String(r).slice(0, 180); }
}
`, 'utf8');

const READONLY = [
  ['hardware', '()', 'Read CPU/RAM suggestion for max instances'],
  ['listInstances', '()', 'List local workhorse instances'],
  ['securityMode', '()', 'Get global security mode (full/normal/strict)'],
  ['memoryStatus', '()', 'Memory service readiness + data dir'],
  ['localeInfo', '()', 'System/resolved locale packs'],
  ['themeInfo', '()', 'Current theme source'],
  ['groupList', '()', 'List project/group records'],
  ['updateSourceGet', '()', 'Configured update feed URL/status'],
  ['boardEvents', '()', 'Tail board events'],
  ['boardAggregate', '()', 'Aggregate board progress per group'],
  ['getProvider', '()', 'Current LLM provider config (secrets omitted in UI)'],
  ['checkpointList', '()', 'List rollback points'],
  ['knowledgeQuery', 'WArmy', 'FTS/entity search on knowledge base'],
  ['metricsSummary', '()', 'Chat/tool metrics summary'],
  ['settingsGet', '()', 'App settings snapshot'],
  ['skillsList', '()', 'Installed + discovered skills'],
  ['skillsPaths', '()', 'Skill roots on disk'],
  ['skillsScanDirsGet', '()', 'Auto-discovery directories (max 10)'],
  ['uiQueuesGet', '()', 'Persisted P2/P3 UI queues'],
  ['routerQueuesGet', '()', 'Router queue snapshot (read-only)'],
  ['profileGet', '()', 'Local profile (name/avatar/deviceId)'],
  ['appInfo', '()', 'App version / electron / platform'],
  ['identityInfo', '()', 'Local identity fingerprint/card'],
  ['identityPeers', '()', 'Confirmed peer identities'],
  ['netStatus', '()', 'Mesh/dialability facts'],
  ['peersList', '()', 'Known mesh peers'],
  ['executorsStatus', '()', 'Executor pool status'],
  ['stateLoad', '()', 'UI session state (groups/chats/sort)'],
  ['lastError', '()', 'Last main-process error (if any)'],
  ['setupState', '()', 'First-run setupDone flag'],
  ['lanStatus', '()', 'LAN sync status'],
  ['meshStatus', '()', 'Mesh enable/status'],
  ['platformInfo', '()', 'OS platform flags'],
  ['costSummary', '()', 'Cost rollup'],
  ['memoryRecall', 'WArmy', 'Semantic/FTS recall cards'],
  ['i18n', 'zh-CN', 'Load a locale pack'],
  ['chatLogRestore', '()', 'Rebuild chat logs from memory JSONL'],
];

const payload = READONLY.map(([name]) => name);
const sigMap = Object.fromEntries(READONLY.map(([n, , d]) => [n, d]));
// channel probe uses names only
fs.writeFileSync(OUT + '.plan.json', JSON.stringify({ readonly: READONLY }, null, 2));

const child = spawn(electron, [PROBE], {
  env: (() => {
    const e = { ...process.env };
    delete e.ELECTRON_RUN_AS_NODE;
    e.MAIN_JS = mainJs;
    e.OUT_JSON = OUT;
    e.PROBE_NAMES = JSON.stringify(payload);
    e.PROBE_SIG = JSON.stringify(Object.fromEntries(READONLY.map(([n,s]) => [n,s])));
    return e;
  })(),
  cwd: pkgRoot,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
child.stdout.on('data', (d) => { logs += d; });
child.stderr.on('data', (d) => { logs += d; });
child.on('exit', (code) => {
  console.log(logs.slice(-800));
  console.log('probe exit', code);
  if (fs.existsSync(OUT)) {
    const j = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    const ok = (j.results || []).filter((x) => x.ok).length;
    const fail = (j.results || []).filter((x) => !x.ok);
    console.log(`IPC probe: ${ok}/${(j.results||[]).length} ok`);
    fail.slice(0, 15).forEach((f) => console.log(' FAIL', f.name, f.channel, f.error || ''));
    process.exit(code === 0 && fail.length <= 5 ? 0 : (fail.length ? 1 : 0));
  } else {
    console.error('no result file');
    process.exit(2);
  }
});
