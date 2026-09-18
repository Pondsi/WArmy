/**
 * 生成「浏览器可预览版」：把渲染层 + 一个 window.warmy 桩 输出到指定目录，
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
/**
 * `--keep-csp`：**保留** index.html 里的 CSP meta，其余照旧（仍然注入 window.warmy 桩）。
 * 为什么需要：默认预览产物把 CSP 去掉了，于是预览里"脚本能不能加载"这件事**证明不了**
 * —— 真实渲染层的 CSP 是 `script-src 'self'`（没有 unsafe-eval），ESM / 动态 import 在这里被拦。
 * 想证明"某个 vendored 经典脚本能在真 CSP 下加载"（编码器 qrcode / 解码器 jsQR）就必须带着
 * CSP 跑一遍；scripts/verify-qr-scan.mjs 就是拿这个模式跑的。
 */
const KEEP_CSP = process.argv.includes('--keep-csp');
fs.mkdirSync(out, { recursive: true });

// ── 1. index.html：去 CSP（本地预览不需要；--keep-csp 时保留），在 app.js 之前注入桩 ──
let html = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8');
if (!KEEP_CSP) html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\s*/i, '');
html = html.replace('<script src="./app.js"></script>', '<script src="./bridge.js"></script>\n  <script src="./app.js"></script>');
fs.writeFileSync(path.join(out, 'index.html'), html, 'utf8');
console.log('  index.html' + (KEEP_CSP ? '（保留 CSP，用于真 CSP 下的加载证明）' : '（已去 CSP）'));

// ── 2. 静态资源 ──
// vendor/ 是二维码**编码器 + 解码器**：vendored 的**经典脚本**（全局 qrcode / jsQR），
// 由 index.html 用普通 <script src="./vendor/..."> 引入。预览产物必须带着它们，否则那些
// <script> 会 404：模拟器里既画不出真二维码，也识别不了二维码图片（取不到时界面会如实说）。
// 解码器 jsqr-1.4.0 是**随应用发布**的（Apache-2.0，许可证 jsqr-1.4.0.LICENSE.txt 必须一起带上）。
// qr.js 不复制：它现在是 Node 侧的验收参考实现，渲染层不再加载它（ESM 在 file:// + CSP 下不可用）。
for (const f of ['app.css', 'app.js']) {
  fs.copyFileSync(path.join(renderer, f), path.join(out, f));
  console.log('  ' + f);
}
copyDir(path.join(renderer, 'vendor'), path.join(out, 'vendor'));
console.log('  vendor/ (二维码编码器 + 解码器：vendored 经典脚本，全局 qrcode / jsQR)');

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

// ── 3. window.warmy 桩（含内联语言包 + 演示数据）──
const i18nDir = path.join(src, 'i18n');
const packs = {};
for (const f of fs.readdirSync(i18nDir)) {
  if (!f.endsWith('.json')) continue; // skip locales.ts and any non-pack files
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
// 演示用的群：字段按主进程 group-store 的 GroupRecord 写（groupId/type/origin…），
// 成员名单独放 memberNames —— 因为 GroupRecord 里**没有**成员的形状，成员走 groupMembers 另一次调用。
const demoGroups = [
  { groupId: 'g-1', name: '项目推进群', type: 'internal', directedMode: false, dutyInstanceId: null,
    createdAt: now - 86400000, updatedAt: now - 60000, origin: 'ipc', memberNames: ['demo.agent', '归档员'] },
  { groupId: 'g-3', name: '外部协作群', type: 'external', directedMode: false, dutyInstanceId: null,
    createdAt: now - 86400000, updatedAt: now - 300000, origin: 'ipc', memberNames: ['demo.agent'] },
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

const bridge = `/* 浏览器预览桩：把 Electron 的 window.warmy 用演示数据模拟出来。 */
(function () {
  const PACKS = ${JSON.stringify(packs)};
  const INSTANCES = ${JSON.stringify(demoInstances)};
  const GROUPS = ${JSON.stringify(demoGroups)};
  const CHATS = ${JSON.stringify(demoChats)};
  const TURNS = ${JSON.stringify(demoTurns)};
  const ok = (extra) => Object.assign({ ok: true }, extra || {});
  const t0 = Date.now();
  // 预览里也要「关掉再打开还在」：真实主进程的 settingsStore 是落盘的，
  // 桩就落 localStorage（键名固定，验收脚本每轮开始会清一次，避免上一轮污染下一轮）。
  const LS_KEY = 'warmyPreviewSettings';
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    window.__previewSettings = Object.assign({}, saved || {}, window.__previewSettings || {});
  } catch (e) { /* 读不到就当没有 */ }
  const keepSettings = () => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(window.__previewSettings || {})); } catch (e) { /* noop */ }
  };

  const SUPPORTED = ['zh-CN','zh-TW','en-US','ja','ko','ru','es','fr','pt','eo'];
  function resolveLocalePack(locale) {
    if (!locale) return 'zh-CN';
    const raw = String(locale).trim();
    if (SUPPORTED.indexOf(raw) !== -1) return raw;
    const l = raw.toLowerCase().replace('_', '-');
    if (l.indexOf('zh-tw') === 0 || l.indexOf('zh-hant') === 0 || l === 'zh-hk' || l === 'zh-mo') return 'zh-TW';
    if (l.indexOf('zh') === 0) return 'zh-CN';
    if (l.indexOf('ja') === 0) return 'ja';
    if (l.indexOf('ko') === 0) return 'ko';
    if (l.indexOf('ru') === 0) return 'ru';
    if (l.indexOf('es') === 0) return 'es';
    if (l.indexOf('fr') === 0) return 'fr';
    if (l.indexOf('pt') === 0) return 'pt';
    if (l.indexOf('eo') === 0) return 'eo';
    if (l.indexOf('en') === 0) return 'en-US';
    return 'zh-CN';
  }
  const api = {
    i18n: async (locale) => {
      // Full 10-locale resolution — never collapse to zh-CN/en-US only.
      const key = resolveLocalePack(locale);
      return { locale: key, strings: PACKS[key] || PACKS['zh-CN'], displayName: (PACKS[key] || {})['app.displayName'], supported: SUPPORTED };
    },
    settingsGet: async () => ok({ settings: Object.assign({
      locale: 'zh-CN', themeMode: 'system', accent: '#917627', sound: { complete: true, request: true, error: true },
      soundFiles: { complete: '', request: '', error: '' }, globalSecurity: 'normal', embedUseGpu: true, listSort: 'time',
      skillScanDirs: [],
    }, (window.__previewSettings || {})) }),
    settingsSave: async (partial) => {
      window.__previewSettings = Object.assign({}, window.__previewSettings || {}, partial || {});
      keepSettings();
      return ok({ settings: Object.assign({ skillScanDirs: [] }, window.__previewSettings) });
    },
    profileGet: async () => ok({ profile: { username: '主人', avatarDataUrl: '', email: '', deviceId: '884024787', avatarPreset: 3 } }),
    profileSave: async (p) => ok({ profile: p }),
    stateLoad: async () => ok({ state: { listSort: 'time', instanceAvatars: {}, chats: CHATS } }),
    stateSave: async () => ok(),
    appInfo: async () => ok({ name: '无限牛马', enName: 'WArmy', version: '0.1.0', electron: '33.2.0', chrome: '130.0.6723.118',
      node: '20.18.0', platform: 'win32', arch: 'x64', deviceId: '884024787', deviceIdValid: true }),
    listInstances: async () => INSTANCES,
    // 形状必须与主进程一致（GroupListResult / GroupMembersResult）。早期桩返回裸数组、字段叫 id，
    // 导致渲染层 syncGroupsFromStore() 因形状不符整段跳过 —— 预览里群 id 全是 undefined、群列表为空。
    groupList: async () => ok({
      count: GROUPS.length,
      groups: GROUPS.map((g) => {
        const rest = Object.assign({}, g);
        delete rest.memberNames;
        return Object.assign(rest, { memberCount: (g.memberNames || []).length, active: true });
      }),
    }),
    groupMembers: async (id) => {
      const g = GROUPS.filter((x) => x.groupId === id)[0];
      const names = g ? (g.memberNames || []) : [];
      return {
        ok: true, groupId: id,
        members: names.map((n, i) => ({
          id: n, groupId: id, name: n,
          role: n === 'demo.agent' ? 'creator' : 'member',
          source: 'invite', instanceId: n, joinedAt: Date.now() - 3600000 + i,
        })),
      };
    },
    groupInvite: async () => ok(), groupKick: async () => ok(), groupJoinInstance: async () => ok(),
    hardwareSuggest: async () => ok({ cpus: 32, suggested: 8, max: 8 }),
    metricsSummary: async () => ok({ turns: TURNS.length, promptTokens: 10900, completionTokens: 3800, cacheHitRate: 0.32, avgDurationMs: 2400, ccrRatio: 0.9, estCostCny: 0.0294 }),
    metricsTurns: async () => ok({ turns: TURNS }),
    costSummary: async () => ok({ turns: TURNS.length, promptTokens: 10900, completionTokens: 3800, cacheHitRate: 0.32, avgDurationMs: 2400, estCostCny: 0.0294 }),
    // ADR 004 §7.6：回退点 = 文件 + **环境指纹**；并带回**分层事实**（文件回退不依赖容器）
    checkpointList: async () => ok({
      list: [{ id: 'cp-1', createdAt: Date.now() - 600000, phase: 'round_end', strategy: 'copy-on-write',
        filesChanged: [{ path: 'src/a.ts' }], filesCreated: [{ path: 'src/b.ts' }], irreversible: [], assets: [], dir: 'checkpoints/cp-1' }],
      envByCheckpoint: {},
      currentEnv: { active: false, runtimeId: '', revision: 'host', at: Date.now(), imageDigests: {} },
      layering: { fileRollbackIndependent: true, snapshotCoversProjectFiles: false, envRollbackNeedsRuntime: true },
    }),
    checkpointCreate: async () => ok(), checkpointRollback: async () => ok(),
    knowledgeQuery: async () => ok({ entities: [{ id: 'e-1', name: '无限牛马', kind: 'project' }, { id: 'e-2', name: '项目推进群', kind: 'org' }],
      events: [{ id: 'v-1', title: '确定四栏布局' }] }),
    kbDetail: async () => ok({ entities: [{ id: 'e-1', name: '无限牛马', kind: 'project' }] }),
    kbDelete: async () => ok(),
    skillsList: async () => {
      const dirs = (((window.__previewSettings || {}).skillScanDirs) || []).map(String);
      const scanDirs = dirs.map(function (pth) {
        if (/missing|invalid|no-such/i.test(pth)) return { path: pth, ok: false, error: 'missing', skillCount: 0 };
        return { path: pth, ok: true, error: null, skillCount: 1 };
      });
      const skills = [
        { id: 'ui-polish', name: 'UI 打磨', description: '对界面做视觉一致性与对比度检查', source: 'userData', mtime: Date.now() },
        { id: 'release-check', name: '发布检查', description: '打包前跑一遍验收清单', source: 'workspace', mtime: Date.now() },
      ];
      scanDirs.forEach(function (s, i) {
        if (s.ok) {
          skills.push({ id: 'discovered:demo:' + i, name: 'Discovered ' + i, description: 'from ' + s.path, source: 'discovered', mtime: Date.now() });
        }
      });
      return ok({ skills, scanDirs });
    },
    skillsPaths: async () => ok({ paths: ['（预览模式）userData/skills', '（预览模式）workspace/skills'] }),
    skillsImport: async () => ok({ id: 'demo-skill' }), skillsRemove: async () => ok(),
    /* ADR 004 执行环境探测：**预览里没有主进程**，所以这里不编造探测结果 ——
       如实回"探测不可用"。桌面端 UI 验收（verify-net-ui.mjs）会把它换成**真机探测的结果**
       （脚本自己跑 dist/container-probe.js 拿到真报告再注入），这样"docker 已安装未运行"
       这类断言是由**真实事实**驱动的，不是写死的演示数据。 */
    containerProbe: async () => ({ ok: false, error: 'preview:no-main-process' }),
    containerAction: async () => ({ ok: false, code: 'preview', error: 'preview:no-main-process' }),
    /* 控制台 = **容器内的 shell**：预览里同样没有主进程 ⇒ 一律如实拒绝，绝不假装开成功。
       （验收脚本会用 net-ui-harness.js 的桩把它换成"照真实现规则推导"的替身。） */
    containerShell: async () => ({ ok: false, code: 'preview', error: 'preview:no-main-process', executed: false }),
    /* 项目可用性 / 右键菜单动作 / 右栏三块文件事实 / 产物运行：一律如实回"预览里没有主进程"，
       不编造状态（验收脚本会用 harness 的桩替换成"照真实现规则推导"的替身）。 */
    projectState: async () => ({ ok: false, error: 'preview:no-main-process' }),
    projectEnable: async () => ({ ok: false, code: 'preview', error: 'preview:no-main-process' }),
    projectDisable: async () => ({ ok: false, code: 'preview', error: 'preview:no-main-process' }),
    projectSetContainer: async () => ({ ok: false, code: 'preview', error: 'preview:no-main-process' }),
    projectFiles: async () => ({ ok: false, error: 'preview:no-main-process' }),
    productRun: async () => ({ ok: false, code: 'preview', error: 'preview:no-main-process', executed: false }),
    projectEnvStatus: async () => ({ ok: false, error: 'preview:no-main-process' }),
    projectEnvSolidify: async () => ({ ok: false, code: 'preview', error: 'preview:no-main-process', executed: false }),
    skillsScanDirsGet: async () => {
      const dirs = (((window.__previewSettings || {}).skillScanDirs) || []).map(String);
      const scanDirs = dirs.map(function (pth) {
        if (/missing|invalid|no-such/i.test(pth)) return { path: pth, ok: false, error: 'missing', skillCount: 0 };
        return { path: pth, ok: true, error: null, skillCount: 1 };
      });
      return ok({ dirs, scanDirs, max: 10 });
    },
    skillsScanDirsSet: async (dirs) => {
      const list = (dirs || []).map(String).filter(Boolean);
      if (list.length > 10) return { ok: false, error: 'too-many-dirs', max: 10, count: list.length };
      window.__previewSettings = Object.assign({}, window.__previewSettings || {}, { skillScanDirs: list });
      return ok({ dirs: list });
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
    // 形状必须与主进程一致：warmy:check-update 真实返回 UpdateCheckResult{status:'up-to-date'|'update-available'|…}。
    // 旧桩只给 {upToDate:true} → updateStatusText() 落到"检查更新失败：未知状态"，
    // 预览里看起来像**功能坏了**（无组网巡检时实测到的那条误导）。
    checkUpdate: async () => ok({ status: 'up-to-date', currentVersion: '0.1.0' }),
    asrTranscribe: async () => ok({ text: '' }),
    // 形状同上：真主进程的 chatSend 一定会回一个**字符串** reply（无 key 时回"未配置密钥"那句）。
    // 桩若回 {ok:true} 而 reply 缺失，会话里会冒出气泡 "undefined" —— 预览的假缺陷。
    chatSend: async (msg) => ok({ reply: '（预览）已收到：' + String((msg && msg.content) || '').slice(0, 40), needsKey: false, usage: null }),
    groupOrchestrate: async (msg) => ok({ reply: '（预览）值班者已安排：' + String((msg && msg.content) || '').slice(0, 40), action: 'ok' }),
    exportSession: async () => ok({ path: '（预览模式）仅示意' }), saveText: async () => ok({ path: '（预览模式）仅示意' }),
    onApprovalRequest: () => () => {}, onInbox: () => () => {}, onTray: () => () => {},
  };

  window.warmy = new Proxy(api, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === 'string' && prop.startsWith('on')) return () => () => {};
      return async () => ok({});
    },
  });
  window.__PREVIEW__ = true;
  console.log('[preview] window.warmy 桩已就绪');
})();
`;
fs.writeFileSync(path.join(out, 'bridge.js'), bridge, 'utf8');
console.log('  bridge.js（含内联语言包 + 演示数据）');
console.log('预览构建完成 -> ' + out);
