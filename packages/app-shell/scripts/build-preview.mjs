/**
 * 生成「浏览器可预览版」：把渲染层 + 一个 window.ccarmy 桩 输出到指定目录，
 * 直接双击 index.html 就能在浏览器里看界面（无需 Electron）。
 *
 *   node scripts/build-preview.mjs --out "<输出目录>"
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, '..', 'src');
const renderer = path.join(src, 'renderer');

const outArgIdx = process.argv.indexOf('--out');
const out = outArgIdx !== -1 ? process.argv[outArgIdx + 1] : path.join(here, '..', 'preview');
fs.mkdirSync(out, { recursive: true });

// ── 1. index.html：去 CSP（本地预览不需要），在 app.js 之前注入桩 ──
let html = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8');
html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\s*/i, '');
html = html.replace('<script src="./app.js"></script>', '<script src="./bridge.js"></script>\n  <script src="./app.js"></script>');
fs.writeFileSync(path.join(out, 'index.html'), html, 'utf8');
console.log('  index.html');

// ── 2. 静态资源 ──
for (const f of ['app.css', 'app.js']) {
  fs.copyFileSync(path.join(renderer, f), path.join(out, f));
  console.log('  ' + f);
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name);
    const d = path.join(to, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}
copyDir(path.join(renderer, 'icons'), path.join(out, 'icons'));
console.log('  icons/ (递归)');

// ── 3. window.ccarmy 桩（含内联语言包 + 演示数据）──
const i18nDir = path.join(src, 'i18n');
const packs = {};
for (const f of fs.readdirSync(i18nDir)) {
  const loc = f.replace('.json', '');
  packs[loc] = JSON.parse(fs.readFileSync(path.join(i18nDir, f), 'utf8'));
}

const now = Date.now();
const demoInstances = [
  { id: 'demo-1', name: 'demo.agent', status: 'running', dutyEligible: true, notify: true, model: 'deepseek-chat',
    avatarPreset: 5, availableModels: ['deepseek-chat', 'deepseek-reasoner', 'mimo-v2.5-pro'],
    chain: ['deepseek-chat', 'deepseek-reasoner'], defaultModel: 'deepseek-chat', allModels: true,
    persona: '性格：沉稳可靠\n角色：值班执行者', cognitionFiles: [] },
  { id: 'demo-2', name: '归档员', status: 'stopped', dutyEligible: false, notify: true, model: 'mimo-v2.5-pro',
    avatarPreset: 9, availableModels: ['mimo-v2.5-pro'], chain: ['mimo-v2.5-pro'], defaultModel: 'mimo-v2.5-pro', allModels: true,
    persona: '', cognitionFiles: [] },
];
const demoGroups = [
  { id: 'g-1', name: '项目推进群', type: 'internal', members: ['demo.agent', '归档员'], lastTs: now - 60000 },
  { id: 'g-3', name: '外部协作群', type: 'external', members: ['demo.agent'], lastTs: now - 300000 },
];
const demoChats = [
  { id: 'demo-1', kind: 'single', name: 'demo.agent', lastTs: now - 30000, lastPreview: '好的，已安排' },
  { id: 'c-2', kind: 'extdm', name: '张三', lastTs: now - 120000, lastPreview: '收到' },
];
const demoTurns = [
  { sessionId: 'demo-1', model: 'deepseek-chat', promptTokens: 2400, completionTokens: 800, cacheHitRate: 0.4, durationMs: 1800 },
  { sessionId: 'demo-1', model: 'deepseek-reasoner', promptTokens: 5200, completionTokens: 2100, cacheHitRate: 0.2, durationMs: 4200 },
  { sessionId: 'g-1', model: 'mimo-v2.5-pro', promptTokens: 3300, completionTokens: 900, cacheHitRate: 0.35, durationMs: 2600 },
];

const bridge = `/* 浏览器预览桩：把 Electron 的 window.ccarmy 用演示数据模拟出来。 */
(function () {
  const PACKS = ${JSON.stringify(packs)};
  const INSTANCES = ${JSON.stringify(demoInstances)};
  const GROUPS = ${JSON.stringify(demoGroups)};
  const CHATS = ${JSON.stringify(demoChats)};
  const TURNS = ${JSON.stringify(demoTurns)};
  const ok = (extra) => Object.assign({ ok: true }, extra || {});
  const t0 = Date.now();

  const api = {
    i18n: async (locale) => {
      const key = String(locale || 'zh-CN').startsWith('en') ? 'en-US' : 'zh-CN';
      return { locale: key, strings: PACKS[key] || PACKS['zh-CN'], displayName: (PACKS[key] || {})['app.displayName'] };
    },
    settingsGet: async () => ok({ settings: { locale: 'zh-CN', themeMode: 'system', accent: '#917627', sound: { complete: true, request: true, error: true },
      soundFiles: { complete: '', request: '', error: '' }, globalSecurity: 'normal', embedUseGpu: true, listSort: 'time' } }),
    settingsSave: async () => ok(),
    profileGet: async () => ok({ profile: { username: '主人', avatarDataUrl: '', email: '', deviceId: '884024787', avatarPreset: 3 } }),
    profileSave: async (p) => ok({ profile: p }),
    stateLoad: async () => ok({ state: { listSort: 'time', instanceAvatars: {} } }),
    stateSave: async () => ok(),
    appInfo: async () => ok({ name: '无限牛马', enName: 'CCArmy', version: '0.1.0', electron: '33.2.0', chrome: '130.0.6723.118',
      node: '20.18.0', platform: 'win32', arch: 'x64', deviceId: '884024787', deviceIdValid: true }),
    listInstances: async () => INSTANCES,
    groupList: async () => GROUPS,
    groupMembers: async (id) => ok({ members: (GROUPS.find((g) => g.id === id) || { members: [] }).members.map((n) => ({ id: n, name: n, role: '成员' })) }),
    groupInvite: async () => ok(), groupKick: async () => ok(), groupJoinInstance: async () => ok(),
    hardwareSuggest: async () => ok({ cpus: 32, suggested: 8, max: 8 }),
    metricsSummary: async () => ok({ turns: TURNS.length, promptTokens: 10900, completionTokens: 3800, cacheHitRate: 0.32, avgDurationMs: 2400, ccrRatio: 0.9, estCostCny: 0.0294 }),
    metricsTurns: async () => ok({ turns: TURNS }),
    costSummary: async () => ok({ turns: TURNS.length, promptTokens: 10900, completionTokens: 3800, cacheHitRate: 0.32, avgDurationMs: 2400, estCostCny: 0.0294 }),
    checkpointList: async () => ok({ list: [{ id: 'cp-1', createdAt: Date.now() - 600000, phase: 'round_end', strategy: 'copy-on-write',
      filesChanged: [{ path: 'src/a.ts' }], filesCreated: [{ path: 'src/b.ts' }], irreversible: [], assets: [], dir: 'checkpoints/cp-1' }] }),
    checkpointCreate: async () => ok(), checkpointRollback: async () => ok(),
    knowledgeQuery: async () => ok({ entities: [{ id: 'e-1', name: '无限牛马', kind: 'project' }, { id: 'e-2', name: '项目推进群', kind: 'org' }],
      events: [{ id: 'v-1', title: '确定四栏布局' }] }),
    kbDetail: async () => ok({ entities: [{ id: 'e-1', name: '无限牛马', kind: 'project' }] }),
    kbDelete: async () => ok(),
    skillsList: async () => ok({ skills: [
      { id: 'ui-polish', name: 'UI 打磨', description: '对界面做视觉一致性与对比度检查', source: 'workspace', mtime: Date.now() },
      { id: 'release-check', name: '发布检查', description: '打包前跑一遍验收清单', source: 'userData', mtime: Date.now() } ] }),
    skillsPaths: async () => ok({ paths: ['（预览模式）userData/skills', '（预览模式）workspace/skills'] }),
    skillsImport: async () => ok({ id: 'demo-skill' }), skillsRemove: async () => ok(),
    diagnostics: async () => {
      await new Promise((r) => setTimeout(r, 60));
      return ok({ pid: 1234, uptimeSec: Math.round((Date.now() - t0) / 1000), cpuPercent: Math.round(Math.random() * 8),
        loopLagMs: Math.round(Math.random() * 30) / 10, rssMb: 128 + Math.round(Math.random() * 20),
        heapUsedMb: 9 + Math.round(Math.random() * 4), handles: 24, requests: 0, nodeVersion: '20.18.0', electronVersion: '33.2.0' });
    },
    joinPending: async () => ok({ count: 0 }),
    setupState: async () => ok({ done: true }), setupComplete: async () => ok(),
    executorsList: async () => ok({ items: [] }), executorsRun: async () => ok(),
    metricsCacheRate: async () => ok(), auditTail: async () => ok({ lines: [] }),
    archiveList: async () => ok({ items: [] }), blacklistList: async () => ok({ items: [] }),
    smtpList: async () => ok({ accounts: [] }), providerList: async () => ok({ providers: [] }),
    listModels: async () => ok({ models: ['deepseek-chat', 'deepseek-reasoner'] }),
    roleModelsGet: async () => ok({ roles: {} }), specialModelsGet: async () => ok({ cfg: {} }),
    trayInit: async () => ok(), trayTooltip: async () => ok(), setSecurityMode: async () => ok(),
    setThemeSource: async () => ok(), winMinimize: async () => ok(), winMaximize: async () => ok(),
    winClose: async () => ok(), winReload: async () => ok(), winAlwaysOnTop: async () => ok({ alwaysOnTop: false }),
    checkUpdate: async () => ok({ upToDate: true }), asrTranscribe: async () => ok({ text: '' }),
    exportSession: async () => ok({ path: '（预览模式）仅示意' }), saveText: async () => ok({ path: '（预览模式）仅示意' }),
    onApprovalRequest: () => () => {}, onInbox: () => () => {}, onTray: () => () => {},
  };

  window.ccarmy = new Proxy(api, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === 'string' && prop.startsWith('on')) return () => () => {};
      return async () => ok({});
    },
  });
  window.__PREVIEW__ = true;
  console.log('[preview] window.ccarmy 桩已就绪');
})();
`;
fs.writeFileSync(path.join(out, 'bridge.js'), bridge, 'utf8');
console.log('  bridge.js（含内联语言包 + 演示数据）');
console.log('预览构建完成 -> ' + out);
