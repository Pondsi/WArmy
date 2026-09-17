/**
 * Electron 主进程 — 零原生模块
 * 注意：Windows 中文路径下 fork 子进程可能乱码，memory ipc 先拷到 userData（ASCII）
 */
import { app, BrowserWindow, ipcMain, Menu, dialog, nativeTheme, Tray, nativeImage, globalShortcut } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createP1Runtime } from './runtime.js';
import { MemoryClient } from './memory-client.js';
import { GroupChatRouter, DEFAULT_PERMISSIONS } from '@ccarmy/group-router';
import { BoardStore, parseBoardCommand } from '@ccarmy/board';
import { createProviderFromPreset, type ChatMessage } from '@ccarmy/providers';
import { CcrGateway } from '@ccarmy/ccr-compressor';
import { KnowledgeBase } from '@ccarmy/knowledge-base';
import { CheckpointStore } from './checkpoint.js';
import { AuditLogger } from './audit.js';
import { SecureKeyStore } from './secure-keys.js';
import { KnowledgeArchiver, CleanupManager } from './archive-cleanup.js';
import { pickModelForUrgency, pickEmbeddingModel, type RoleModelConfig } from './model-roles.js';
import { orchestrateGroupMessage, buildStatusCard } from './orchestrator.js';
import { runShortLivedExecutor, runExecutors } from './executor.js';
import { initAssetGovernor, retrieveAssetsForChat, registerChatAsset, recordAssetUsage, sweepAssets } from './asset-wire.js';
import { MetricsCollector } from './metrics.js';
import { LocalAccountStore, SettingsStore } from './settings-store.js';
import { GroupStore, type GroupListResult, type GroupMembersResult } from './group-store.js';
import {
  Updater,
  updaterUnavailableCheck,
  updaterUnavailableDownload,
  validateFeedUrl,
  type UpdateCheckResult,
  type UpdateDownloadResult,
  type UpdateSourceInfo,
} from './updater.js';
import { sweepTempFiles } from './atomic-json.js';
import { NodeRegistry, SyncBus, createInvite, consumeInvite } from '@ccarmy/sync-protocol';
import { findDshPackageDir, ensureDshProfile, writeDshInstanceEntry } from '@ccarmy/dsh-runtime';
import { LanSyncServer, LanSyncClient, dualMachineSmoke } from '@ccarmy/sync-protocol';
import { PeerRegistry, LanDiscovery, MeshNode, P2P_NOTES } from '@ccarmy/sync-protocol';
import { verifySmtp, type SmtpConfig } from './smtp-verify.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bootLog = path.join(app.getPath('userData'), 'ccarmy-boot.log');

function boot(msg: string) {
  try {
    fs.appendFileSync(bootLog, `${new Date().toISOString()} ${msg}\n`);
  } catch {
    /* ignore */
  }
}
boot(`main loaded dir=${__dirname}`);
// 去掉 File/Edit/View/Window/Help 应用菜单
Menu.setApplicationMenu(null);

function loadMainStrings(locale: string | undefined): Record<string, string> {
  const f = locale && locale.startsWith('zh') ? 'zh-CN' : 'en-US';
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'i18n', `${f}.json`), 'utf8'));
  } catch {
    return {};
  }
}
const MAIN_I18N = loadMainStrings(app.getLocale());
function tMain(k: string, fallback = ''): string {
  return MAIN_I18N[k] || fallback || k;
}

let win: BrowserWindow | null = null;
let p1: Awaited<ReturnType<typeof createP1Runtime>> | null = null;
let memory: MemoryClient | null = null;
const router = new GroupChatRouter({ queueWhenFixedBusy: false });
let board: BoardStore | null = null;
const ccr = new CcrGateway(4000);
let knowledge: KnowledgeBase | null = null;
let checkpoints: CheckpointStore | null = null;
const metrics = new MetricsCollector();
let audit: AuditLogger | null = null;
let secureKeys: SecureKeyStore | null = null;
let archiver: KnowledgeArchiver | null = null;
let cleanup: CleanupManager | null = null;
let roleModels: RoleModelConfig = {};
let accountStore: LocalAccountStore | null = null;
let settingsStore: SettingsStore | null = null;
/** 群列表 / 群成员的真实持久化（userData/groups.json） */
let groupStore: GroupStore | null = null;
/** 自动更新（真实查询 + 真实下载校验；安装未实现） */
let updater: Updater | null = null;
let nodeReg: NodeRegistry | null = null;
let syncBus: SyncBus | null = null;
const emailQueue: Array<{ to: string; subject: string; body: string; ts: number }> = [];
let lastError: { ts: number; message: string; context?: string } | null = null;
const pendingApprovals = new Map<string, { resolve: (d: { allowed: boolean; scope: string }) => void }>();
let approvalSeq = 0;
let lanServer: LanSyncServer | null = null;
let localNodeId = 'node-local';
let peerReg: PeerRegistry | null = null;
let mesh: MeshNode | null = null;
let discovery: LanDiscovery | null = null;
let discoverTimer: NodeJS.Timeout | null = null;
/** 会话消息历史（主进程侧） */
const chatHistories = new Map<string, ChatMessage[]>();
/** 运行中的插入指令级别 */
const insertMode = new Map<string, 'outer' | 'inner'>();
/** Provider 配置（由设置 UI 写入） */
let providerCfg = {
  presetId: 'deepseek',
  apiKey: '',
  baseURL: '',
  model: 'deepseek-chat',
  protocol: 'openai-compatible' as 'openai-compatible' | 'anthropic' | 'ollama',
};

/** 打包态资源根目录；开发态下 Electron 也会给值，兜底空串便于拼路径 */
const RES_ROOT = process.resourcesPath || '';

/**
 * 解析记忆服务要用的 Node 运行时。
 * ADR 不变量 #4 要求「记忆服务一律 spawn 捆绑的独立 Node」，不能拿 Electron 当 Node：
 * 实测用 electron.exe 跑该子进程会立刻崩溃（crashpad not connected），
 * 而且那条路径还额外要求 ELECTRON_RUN_AS_NODE。
 * 顺序：捆绑 Node → 环境变量 → Electron 兜底。
 */
function resolveNodeRuntime(): { path: string; source: string } {
  const isWin = process.platform === 'win32';
  const exe = isWin ? 'node.exe' : 'node';
  // 仓库里的 Node 压缩包按 win-x64 / darwin-arm64 / linux-x64 命名，
  // 与 process.platform（win32）不同名，两种目录名都要认。
  const platDirs = [isWin ? 'win-' + process.arch : process.platform + '-' + process.arch,
                    process.platform + '-' + process.arch];
  const roots = [process.resourcesPath || '',
                 path.join(__dirname, '..', '..', '..', 'resources')];
  const candidates: Array<{ p: string; source: string }> = [];
  for (const r of roots) {
    for (const d of platDirs) {
      candidates.push({ p: path.join(r, 'node', d, exe), source: 'bundled:' + path.join('node', d) });
    }
    candidates.push({ p: path.join(r, 'node', exe), source: 'bundled:node/' + exe });
  }
  candidates.push({ p: process.env['CCARM_NODE'] || '', source: 'env:CCARM_NODE' });
  for (const c of candidates) {
    if (c.p && fs.existsSync(c.p)) return { path: c.p, source: c.source };
  }
  return { path: process.execPath, source: 'electron-fallback(不推荐)' };
}

function prepareMemoryRuntime(): { ipcEntry: string; dataDir: string } {
  const userData = app.getPath('userData');
  const dataDir = path.join(userData, 'memory');
  const runtimeDir = path.join(userData, 'memory-runtime');
  const srcCandidates = [
    path.join(__dirname, '..', '..', 'memory-os', 'dist'),
    path.join(app.getAppPath(), 'node_modules', '@ccarmy', 'memory-os', 'dist'),
  ];
  const src = srcCandidates.find((d) => fs.existsSync(path.join(d, 'ipc.js')));
  if (!src) {
    boot(`memory ipc source missing among ${srcCandidates.join(' | ')}`);
    throw new Error('memory-os dist not found');
  }
  fs.mkdirSync(runtimeDir, { recursive: true });
  // 拷贝 dist 下全部 js（ipc + index + map 可选）
  for (const f of fs.readdirSync(src)) {
    if (!f.endsWith('.js') && !f.endsWith('.js.map')) continue;
    fs.copyFileSync(path.join(src, f), path.join(runtimeDir, f));
  }
  // 复制 package.json 便于 Node 解析 type=module
  const srcPkg = path.join(src, '..', 'package.json');
  if (fs.existsSync(srcPkg)) {
    fs.copyFileSync(srcPkg, path.join(runtimeDir, 'package.json'));
  }
  // 链接 better-sqlite3：开发态与打包态布局不同，而且旧链接可能是坏的，必须校验 + 可修复。
  // 历史教训：这里原本只做 `existsSync(nmSrc) && !existsSync(nmDst)`。
  //   - existsSync 对**空目录**也返回 true，包目录一度是空壳时就会链到空目录；
  //   - 链接一旦存在就不再重建，即使依赖后来补齐也修不回来；
  //   结果子进程报 `Cannot find module 'better-sqlite3'`，记忆服务永远启动超时（L2 实际从未起来）。
  const memPkgDir = path.dirname(src);
  const nmDst = path.join(runtimeDir, 'node_modules');
  const nativeName = process.platform + '-' + process.arch + '.node';
  /** 目录里是否有**可用**的 better-sqlite3（含本平台原生二进制） */
  const sqliteUsable = (dir: string): boolean => {
    if (!fs.existsSync(path.join(dir, 'package.json'))) return false;
    try {
      // v13 用 prebuilds/<platform>-<arch>.node；旧版走 build/Release
      const lib = fs.readFileSync(path.join(dir, 'lib', 'binding.js'), 'utf8');
      if (lib.includes('prebuilds')) return fs.existsSync(path.join(dir, 'prebuilds', nativeName));
    } catch {
      /* 读不到就退回通用判断 */
    }
    return (
      fs.existsSync(path.join(dir, 'prebuilds', nativeName)) ||
      fs.existsSync(path.join(dir, 'build', 'Release', 'better_sqlite3.node'))
    );
  };
  const sqliteVer = (() => {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(runtimeDir, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>;
      };
      return pkg.dependencies?.['better-sqlite3'] || '13.0.3';
    } catch {
      return '13.0.3';
    }
  })();
  const sqliteCandidates = [
    path.join(memPkgDir, 'node_modules', 'better-sqlite3'),                                   // 开发态：包内 junction
    path.join(RES_ROOT, 'pnpm-store', 'better-sqlite3@' + sqliteVer,
      'node_modules', 'better-sqlite3'),                                                      // 打包态
    path.join(RES_ROOT, 'pnpm-store', 'better-sqlite3'),                    // 打包态（扁平）
  ].filter((p) => p && !p.startsWith(path.sep + 'pnpm-store'));

  const srcSqlite = sqliteCandidates.find(sqliteUsable);
  const dstSqlite = path.join(nmDst, 'better-sqlite3');
  if (srcSqlite && !sqliteUsable(dstSqlite)) {
    // 只拆链接/空目录，绝不递归删除（junction 递归删会连带删掉目标内容）
    try {
      fs.unlinkSync(nmDst);
    } catch {
      try {
        fs.rmdirSync(nmDst);
      } catch {
        /* 目标不存在或非空目录，交给下面的 mkdir 报错 */
      }
    }
    fs.mkdirSync(nmDst, { recursive: true });
    try {
      fs.unlinkSync(dstSqlite);
    } catch {
      /* 不存在就算了 */
    }
    try {
      fs.symlinkSync(srcSqlite, dstSqlite, 'junction');
      boot('memory sqlite linked: ' + srcSqlite);
    } catch {
      try {
        fs.cpSync(srcSqlite, dstSqlite, { recursive: true });
        boot('memory sqlite copied: ' + srcSqlite);
      } catch (e) {
        boot('memory sqlite link failed ' + String(e));
      }
    }
  } else if (!srcSqlite) {
    boot('memory sqlite not found in ' + sqliteCandidates.join(' | '));
  }
  return { ipcEntry: path.join(runtimeDir, 'ipc.js'), dataDir };
}

async function bootstrap() {
  p1 = await createP1Runtime({
    instancesRoot: path.join(app.getPath('userData'), 'instances'),
    onApprove: async (req) => {
      // 安全模式 full 时自动放行；normal/strict 向渲染进程请求审批
      const mode = p1?.security.getMode();
      if (mode === 'full') return { action: req.action, scope: 'once', allowed: true };
      const id = 'ap-' + ++approvalSeq;
      return new Promise((resolve) => {
        pendingApprovals.set(id, { resolve: resolve as never });
        win?.webContents.send('ccarmy:approval-request', { id, action: req.action, suggested: req.suggested });
        setTimeout(() => {
          const p = pendingApprovals.get(id);
          if (p) {
            pendingApprovals.delete(id);
            (p.resolve as (d: unknown) => void)({ allowed: false, scope: 'deny' });
          }
        }, 30000);
      });
    },
  });
  boot('p1 ready');
  const userData = app.getPath('userData');
  board = new BoardStore(path.join(userData, 'board'));
  knowledge = new KnowledgeBase(path.join(userData, 'knowledge'));
  checkpoints = new CheckpointStore(path.join(userData, 'checkpoints'));
  accountStore = new LocalAccountStore(path.join(userData, 'profile.json'));
  settingsStore = new SettingsStore(path.join(userData, 'settings.json'));
  groupStore = new GroupStore(path.join(userData, 'groups.json'));
  updater = new Updater({
    currentVersion: appVersion(),
    downloadDir: path.join(userData, 'updates'),
    getSettings: () => settingsStore?.load() ?? null,
    env: process.env,
    userAgent: `CCArmy/${appVersion()} (${process.platform}; ${process.arch})`,
    log: (msg) => boot(`updater: ${msg}`),
  });
  sweepTempFiles(path.join(userData, 'updates'));
  restoreGroups();
  nodeReg = new NodeRegistry(path.join(userData, 'nodes.json'));
  syncBus = new SyncBus(path.join(userData, 'bus'));
  peerReg = new PeerRegistry(path.join(userData, 'peers.json'));
  if (!nodeReg.list().some((n) => n.isLocal)) {
    nodeReg.registerLocal('local');
  }
  localNodeId = nodeReg.list().find((n) => n.isLocal)?.nodeId || 'node-local';
  initAssetGovernor(path.join(userData, 'assets.json'));
  audit = new AuditLogger(userData);
  secureKeys = new SecureKeyStore(userData);
  archiver = new KnowledgeArchiver(userData);
  cleanup = new CleanupManager(userData);
  audit.log('app.start', { platform: process.platform });
  boot('board/knowledge/checkpoints/account/sync/mesh/assets ready');
}

// ── 群路由 / 群成员：持久化与重启恢复 ──

/** 本机实例入群（路由 + 持久化成员表），已入群则跳过 */
function joinLocalInstances(groupId: string): void {
  for (const inst of p1?.instances.list() || []) {
    if (router.listMembers(groupId).some((m) => m.id === inst.id)) continue;
    try {
      router.join(groupId, {
        id: inst.id,
        name: inst.name,
        local: true,
        dutyEligible: inst.dutyEligible,
        status: inst.status === 'running' ? 'idle' : 'offline',
      });
    } catch {
      continue;
    }
    groupStore?.addMember(groupId, { name: inst.name, role: 'member', source: 'instance', instanceId: inst.id });
  }
}

/** 把路由里已有但成员表没有的成员补进持久化（幂等） */
function syncMembersFromRouter(groupId: string): void {
  if (!groupStore) return;
  const g = router.getGroup(groupId);
  if (!g) return;
  for (const m of router.listMembers(groupId)) {
    groupStore.addMember(groupId, { name: m.name, role: 'member', source: 'instance', instanceId: m.id });
  }
}

/**
 * 重启后恢复：把持久化的群灌回路由（否则重启后群聊收不到消息），
 * 并从旧版会话状态（settings.json 的 state.groups）回填一次。
 */
function restoreGroups(): void {
  if (!groupStore) return;
  try {
    const s = settingsStore?.load() as unknown as { groups?: unknown } | undefined;
    const uiGroups = Array.isArray(s?.groups) ? (s?.groups as Array<{ id?: unknown; name?: unknown; type?: unknown }>) : [];
    const migrated = groupStore.migrateFrom(uiGroups);
    if (migrated) boot(`groups migrated from ui state: ${migrated}`);
    for (const g of groupStore.listGroups()) {
      if (!router.getGroup(g.groupId)) {
        try {
          router.createGroup({
            groupId: g.groupId,
            name: g.name,
            type: g.type,
            dutyInstanceId: g.dutyInstanceId,
            directedMode: g.directedMode,
            members: [],
            permissions: DEFAULT_PERMISSIONS as never,
            checkpointLimit: 50,
          });
        } catch {
          continue;
        }
      }
      joinLocalInstances(g.groupId);
    }
    boot(`groups restored: ${groupStore.listGroups().length}`);
  } catch {
    boot('groups restore failed');
  }
}

function startMemoryAsync() {
  try {
    const { ipcEntry, dataDir } = prepareMemoryRuntime();
    boot(`memory ipc=${ipcEntry}`);
    const nodeRt = resolveNodeRuntime();
    boot(`memory node=${nodeRt.path} (${nodeRt.source})`);
    memory = new MemoryClient({ nodePath: nodeRt.path, ipcEntry, dataDir });
    memory
      .start()
      .then(() => boot('memory ready'))
      .catch((e) => boot(`memory start fail ${String(e)}`));
  } catch (e) {
    boot(`memory prepare fail ${String(e)}`);
  }
}

let forceQuit = false;

function createWindow() {
  const isMac = process.platform === 'darwin';
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: '无限牛马',
    // macOS：系统原生标题栏与红绿灯；Windows/Linux：无边框 + 自定义窗控
    frame: isMac,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 12, y: 10 } : undefined,
    backgroundColor: '#ededed',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
    icon: path.join(__dirname, 'renderer', 'icons', 'app.ico'),
  });
  void win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('ready-to-show', () => {
    win?.show();
    boot(`window ready platform=${process.platform}`);
  });
  // 点击叉 = 最小化到托盘，不关闭窗口。只有托盘「下班」才真正退出。
  win.on('close', (e) => {
    if (!forceQuit) {
      e.preventDefault();
      win?.hide();
    }
  });
}

// ── 安全 IPC 辅助函数 ──
function safeHandle<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch (e) { return fallback; }
}
async function safeHandleAsync<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch (e) { return fallback; }
}
/**
 * 统一 IPC 收口：所有 `ccarmy:*` 通道自动获得
 *   1) try/catch —— 任何未捕获异常都不会变成渲染进程的未处理 rejection；
 *   2) 错误脱敏 —— 完整错误只写主进程日志，回传给渲染进程的 message 里
 *      不含绝对路径 / 堆栈 / 凭据片段；
 *   3) 重复通道保护 —— 重复注册只记日志并跳过，而不是让 Electron 抛异常把主进程带崩。
 */
const __ipcRegistered = new Set<string>();
function sanitizeError(e: unknown): string {
  const raw = e instanceof Error ? (e.message || e.name) : String(e);
  // noUncheckedIndexedAccess：split(..)[0] 的类型是 string | undefined，必须兜一下
  const firstLine = String(raw ?? '').split('\n')[0] ?? '';
  const cleaned = firstLine
    .replace(/[A-Za-z]:\\[^\s"'<>|]+/g, '<path>')                        // Windows 绝对路径
    .replace(/\/(?:Users|home|var|tmp|opt|mnt)\/[^\s"'<>|]*/g, '<path>')  // POSIX 绝对路径
    .slice(0, 200);
  return cleaned || 'unknown error';
}
function handleIpc(channel: string, fn: (event: import('electron').IpcMainInvokeEvent, ...args: any[]) => any): void {
  if (__ipcRegistered.has(channel)) {
    console.error('[ipc] duplicate channel registration ignored: ' + channel);
    return;
  }
  __ipcRegistered.add(channel);
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await fn(event, ...args);
    } catch (e) {
      console.error('[ipc] ' + channel + ' failed:', e);
      throw new Error(sanitizeError(e));
    }
  });
}


// 应用身份：影响任务栏悬停/右键菜单里显示的名称（默认会显示 Electron）
app.setName('无限牛马');
if (process.platform === 'win32') app.setAppUserModelId('com.pondsi.ccarmy');

app
  .whenReady()
  .then(async () => {
    boot('whenReady');
    createWindow();
    boot('window created');
    await bootstrap();
    startMemoryAsync();
    try { createTray(); boot('tray ready'); } catch (e) { boot(`tray fail ${String(e)}`); }
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  })
  .catch((e) => {
    boot(`whenReady error ${String(e)}`);
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  void (async () => {
    try {
      await memory?.stop();
      await p1?.instances.stopAll();
      await p1?.teardown.shutdownAll();
    } catch {
      /* ignore */
    }
  })();
});

handleIpc('ccarmy:hardware', () => safeHandle(() => p1?.instances.hardwareAdvice(), null));
handleIpc('ccarmy:list-instances', () => safeHandle(() => p1?.instances.list() ?? [], []));
handleIpc(
  'ccarmy:spawn-instance',
  async (_e, cfg: { id: string; name: string; dutyEligible?: boolean }) => {
    if (!p1) throw new Error('runtime not ready');
    return p1.instances.spawn({
      config: {
        id: cfg.id,
        name: cfg.name,
        workspace: path.join(app.getPath('userData'), 'instances', cfg.id),
        dutyEligible: !!cfg.dutyEligible,
      },
    });
  }
);
handleIpc('ccarmy:stop-instance', async (_e, id: string) => {
  try {
    await p1?.instances.stop(id);
    return true;
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});
handleIpc('ccarmy:security-mode', () => safeHandle(() => p1?.security.getMode(), 'normal'));
handleIpc(
  'ccarmy:set-security-mode',
  async (_e, mode: 'full' | 'normal' | 'strict') => {
    await p1?.security.setMode(mode);
    return p1?.security.getMode();
  }
);
handleIpc('ccarmy:memory-recall', async (_e, q: string) => {
  try {
    return await memory?.recall(q);
  } catch (e) {
    return { cards: [], error: sanitizeError(e) };
  }
});
handleIpc('ccarmy:memory-append', async (_e, body: string) => {
  try {
    return await memory?.append({
      id: `m-${Date.now()}`,
      sessionId: 'ui',
      kind: 'message',
      body,
    });
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

// ── i18n：文案全部在独立 json，中文产品名「无限牛马」，其余「CCArmy」 ──
function i18nDir(): string {
  const candidates = [
    path.join(__dirname, 'i18n'),
    path.join(__dirname, '..', 'src', 'i18n'),
  ];
  const found = candidates.find((d) => fs.existsSync(path.join(d, 'zh-CN.json')));
  return found ?? candidates[0]!;
}

handleIpc('ccarmy:i18n', (_e, locale: string) => {
  const loc = locale?.startsWith('zh') ? 'zh-CN' : 'en-US';
  const file = path.join(i18nDir(), `${loc}.json`);
  let strings: Record<string, string> = {};
  try {
    strings = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    strings = {};
  }
  // 产品名：仅中文显示「无限牛马」
  strings['app.displayName'] = loc === 'zh-CN' ? (strings['app.zhName'] || '无限牛马') : (strings['app.enName'] || 'CCArmy');
  if (loc !== 'zh-CN') {
    // 非中文时列表等处不再用中文名
    strings['app.zhName'] = strings['app.enName'] || 'CCArmy';
  }
  win?.setTitle(strings['app.displayName'] || 'CCArmy');
  return { locale: loc, strings, displayName: strings['app.displayName'] };
});

handleIpc('ccarmy:locale-info', () => safeHandle(() => { const sys = app.getLocale(); return { system: sys, isZh: sys.startsWith('zh') }; }, { system: 'zh-CN', isZh: true }));

// ── 主题 ──
handleIpc('ccarmy:set-theme-source', (_e, source: 'system' | 'light' | 'dark') => {
  try {
    nativeTheme.themeSource = source === 'system' ? 'system' : source;
    return { shouldUseDarkColors: nativeTheme.shouldUseDarkColors, themeSource: nativeTheme.themeSource };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});
handleIpc('ccarmy:theme-info', () => safeHandle(() => ({ shouldUseDarkColors: nativeTheme.shouldUseDarkColors, themeSource: nativeTheme.themeSource }), { shouldUseDarkColors: false, themeSource: 'system' }));

// ── 拉取供应商模型列表（OpenAI 兼容 /models） ──
handleIpc(
  'ccarmy:list-models',
  async (_e, cfg: { protocol: string; baseURL: string; apiKey?: string }) => {
    try {
      const { createProvider } = await import('@ccarmy/providers');
      const p = createProvider(
        (cfg.protocol as 'openai-compatible' | 'anthropic' | 'ollama') || 'openai-compatible',
        { baseURL: cfg.baseURL, apiKey: cfg.apiKey }
      );
      const models = await p.listModels();
      return { ok: true, models };
    } catch (e) {
      return { ok: false, models: [], error: sanitizeError(e) };
    }
  }
);

// ── 选择本地提示音文件 ──
handleIpc('ccarmy:pick-sound', async () => {
  try {
    if (!win) return { ok: false };
    const r = await dialog.showOpenDialog(win, {
      title: 'Select sound',
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a'] }],
      properties: ['openFile'],
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false };
    return { ok: true, path: r.filePaths[0] };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

// ── 检查更新：真实网络查询，状态可区分（不再恒定返回 upToDate:true） ──
handleIpc('ccarmy:check-update', async () =>
  safeHandleAsync<UpdateCheckResult>(
    async () => (updater ? await updater.check() : updaterUnavailableCheck(appVersion())),
    updaterUnavailableCheck(appVersion())
  )
);

// ── 选择附件文件 ──
handleIpc('ccarmy:pick-file', async (_e, opts?: { filters?: string[] }) => {
  try {
    if (!win) return { ok: false };
    const ext = opts?.filters?.length ? opts.filters : undefined;
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: ext ? [{ name: ext.join('/'), extensions: ext }] : undefined,
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false };
    return { ok: true, path: r.filePaths[0] };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

// ── 群聊编排 + 看板 ──
handleIpc(
  'ccarmy:group-create',
  (_e, cfg: { groupId: string; name: string; type: 'internal' | 'external'; directedMode?: boolean }) => {
    try {
      // 已存在（例如重启后 restoreGroups 已恢复）则不再 createGroup，直接复用
      if (!router.getGroup(cfg.groupId)) {
        router.createGroup({
          groupId: cfg.groupId,
          name: cfg.name,
          type: cfg.type,
          dutyInstanceId: null,
          directedMode: !!cfg.directedMode,
          members: [],
          permissions: DEFAULT_PERMISSIONS as never,
          checkpointLimit: 50,
        });
      }
      // 群记录落盘（group-list 的真实数据来源）
      const saved = groupStore?.upsertGroup({
        groupId: cfg.groupId,
        name: cfg.name,
        type: cfg.type,
        directedMode: !!cfg.directedMode,
      });
      if (saved && !saved.ok) return { ok: false, error: 'cannot persist group' };
      // 本机实例全部可值班（同时写入持久化成员表）
      joinLocalInstances(cfg.groupId);
      audit?.log('group.create', { groupId: cfg.groupId, type: cfg.type });
      return { ok: true, groupId: cfg.groupId };
    } catch (e) {
      return { ok: false, error: 'group create failed' };
    }
  }
);

// ── 群列表：来自 userData/groups.json（真实存储），不是空数组 / 演示数据 ──
handleIpc('ccarmy:group-list', () =>
  safeHandle<GroupListResult>(
    () => {
      if (!groupStore) return { ok: false, groups: [], count: 0, error: 'group store unavailable' };
      const snap = groupStore.snapshot();
      const groups = snap.groups
        .slice()
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((g) => ({
          ...g,
          memberCount: (snap.members[g.groupId] || []).length,
          active: !!router.getGroup(g.groupId),
        }));
      return { ok: true, groups, count: groups.length };
    },
    { ok: false, groups: [], count: 0, error: 'group store unavailable' }
  )
);

handleIpc(
  'ccarmy:group-message',
  async (
    _e,
    msg: { groupId: string; userId?: string; content: string; urgency?: string; mentionIds?: string[] }
  ) => {
    const urgency = (msg.urgency || 'P2') as 'P0' | 'P1' | 'P2' | 'P3';
    const route = router.route({
      groupId: msg.groupId,
      userId: msg.userId || 'local-user',
      content: msg.content,
      urgency,
      mentionIds: msg.mentionIds || [],
      timestamp: Date.now(),
    });

    // 外部群：无 @ 静默（不变量：仅聊天）
    const g = router.getGroup(msg.groupId);
    if (g?.type === 'external' && route.action === 'silent') {
      return { ok: true, action: 'silent', reason: route.reason, reply: null };
    }

    // 值班者看板解析（仅 duty 写入）
    if (board && route.action !== 'silent') {
      const parsed = parseBoardCommand(msg.content, msg.groupId);
      if (parsed) {
        try {
          board.append(parsed, 'duty');
        } catch {
          /* ignore */
        }
      }
    }

    // 请求时邮件提醒：仅在该会话勾选了「提醒」时才入队
    const notifyOk = (p1?.instances.list().find((x) => x.id === msg.groupId)?.dutyEligible !== false);
    const sset = settingsStore?.load();
    const emailOn = sset?.emailNotify?.request !== false || sset?.emailOnRequest;
    if (emailOn && notifyOk) {
      const profile = accountStore?.loadProfile();
      if (profile?.email) {
        emailQueue.push({
          to: profile.email,
          subject: `CCArmy request ${msg.groupId}`,
          body: msg.content.slice(0, 500),
          ts: Date.now(),
        });
      }
    }
    try {
      await memory?.append({
        id: `g-${Date.now()}`,
        sessionId: msg.groupId,
        kind: 'message',
        body: msg.content,
      }, 'duty');
    } catch {
      /* optional */
    }

    // 值班者调用 LLM 生成回复（有 Key 时）
    let llmReply: string | null = null;
    if (providerCfg.apiKey || providerCfg.protocol === 'ollama') {
      try {
        const provider = createProviderFromPreset(providerCfg.presetId, {
          apiKey: providerCfg.apiKey,
          baseURL: providerCfg.baseURL || undefined,
        });
        const hist = chatHistories.get(msg.groupId) || [];
        hist.push({ role: 'user', content: msg.content });
        const resp = await provider.chat({
          model: providerCfg.model,
          messages: [
            {
              role: 'system',
              content:
                tMain('llm.dutySystem'),
            },
            ...hist.slice(-20),
          ],
          maxTokens: 512,
        });
        llmReply = resp.choices[0]?.message?.content || '';
        hist.push({ role: 'assistant', content: llmReply });
        chatHistories.set(msg.groupId, hist);
      } catch (e) {
        llmReply = `LLM error: ${sanitizeError(e).slice(0, 160)}`;
      }
    }

    return {
      ok: true,
      action: route.action,
      reason: route.reason,
      duty: route.duty?.id,
      decision: route.decision,
      queueLength: router.listQueue(msg.groupId).length,
      reply: llmReply,
    };
  }
);

handleIpc('ccarmy:board-tasks', (_e, groupId?: string) => {
  try {
    return { ok: true, tasks: board?.listTasks(groupId) || [] };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

handleIpc('ccarmy:board-events', () => {
  try {
    return { ok: true, events: board?.tailEvents(30) || [] };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

handleIpc('ccarmy:board-aggregate', () => {
  try {
    return { ok: true, sessions: board?.aggregateByGroup() || [] };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

handleIpc('ccarmy:group-join-instance', (_e, groupId: string, instanceId: string) => {
  try {
    const inst = p1?.instances.list().find((x) => x.id === instanceId);
    if (!inst) return { ok: false };
    router.join(groupId, {
      id: inst.id,
      name: inst.name,
      local: true,
      dutyEligible: inst.dutyEligible,
      status: inst.status === 'running' ? 'idle' : 'offline',
    });
    // 成员关系落盘：重启后仍在群里
    groupStore?.addMember(groupId, { name: inst.name, role: 'member', source: 'instance', instanceId: inst.id });
    return { ok: true };
  } catch (e) { return { ok: false, error: 'join failed' }; }
});

// ── 真 LLM 对话 ──
handleIpc('ccarmy:set-provider', (_e, cfg: Partial<typeof providerCfg>) => {
  try {
    providerCfg = { ...providerCfg, ...cfg };
    return { ok: true, providerCfg: { ...providerCfg, apiKey: providerCfg.apiKey ? '***' : '' } };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

handleIpc('ccarmy:get-provider', () => ({
  ok: true,
  providerCfg: { ...providerCfg, apiKey: providerCfg.apiKey ? '***' : '' },
  hasKey: !!providerCfg.apiKey || providerCfg.protocol === 'ollama',
}));

handleIpc(
  'ccarmy:chat-send',
  async (
    _e,
    msg: {
      sessionId: string;
      role?: 'user';
      content: string;
      model?: string;
      /** 指令插入：outer=外循环后，inner=内循环边界 */
      insertMode?: 'outer' | 'inner';
    }
  ) => {
    const sessionId = msg.sessionId;
    if (msg.insertMode) insertMode.set(sessionId, msg.insertMode);

    // 写入侧 CCR
    const compressed = ccr.beforeLog({ kind: 'message', content: msg.content });
    metrics.recordCcr({
      ts: Date.now(),
      kind: 'message',
      originalBytes: compressed.originalBytes,
      compressedBytes: compressed.compressedBytes,
    });
    const userMsg: ChatMessage = { role: 'user', content: compressed.content };
    const hist = chatHistories.get(sessionId) || [];
    hist.push(userMsg);

    try {
      await memory?.append(
        {
          id: `m-${Date.now()}`,
          sessionId,
          kind: 'message',
          body: compressed.content,
        },
        'duty'
      );
    } catch {
      /* optional */
    }

    if (!providerCfg.apiKey && providerCfg.protocol !== 'ollama') {
      const reply = tMain('llm.noKey') + msg.content.slice(0, 80);
      hist.push({ role: 'assistant', content: reply });
      chatHistories.set(sessionId, hist);
      return { ok: true, reply, usage: null, needsKey: true };
    }

    const t0 = Date.now();
    try {
      const provider = createProviderFromPreset(providerCfg.presetId, {
        apiKey: providerCfg.apiKey,
        baseURL: providerCfg.baseURL || undefined,
      });
      const resp = await provider.chat({
        model: msg.model || providerCfg.model,
        messages: hist,
        maxTokens: 1024,
      });
      const reply = resp.choices[0]?.message?.content || '';
      hist.push({ role: 'assistant', content: reply });
      chatHistories.set(sessionId, hist);
      metrics.recordTurn({
        sessionId,
        ts: Date.now(),
        promptTokens: resp.usage.promptTokens,
        completionTokens: resp.usage.completionTokens,
        cacheHitTokens: resp.usage.cacheHitTokens,
        cacheMissTokens: resp.usage.cacheMissTokens,
        durationMs: Date.now() - t0,
        providerId: providerCfg.presetId,
        model: msg.model || providerCfg.model,
      });
      try {
        await memory?.append(
          { id: `a-${Date.now()}`, sessionId, kind: 'message', body: reply.slice(0, 4000) },
          'duty'
        );
      } catch {
        /* optional */
      }
      if (knowledge && reply.length > 0) {
        knowledge.upsertEntity({
          id: 'session-' + sessionId,
          kind: 'project',
          name: sessionId,
          attrs: {},
          anchors: [],
        });
      }
      return { ok: true, reply, usage: resp.usage, needsKey: false };
    } catch (e) {
      const err = sanitizeError(e);
      lastError = { ts: Date.now(), message: err, context: 'chat-send' };
      return { ok: false, reply: '', error: err, needsKey: false, retry: true };
    }
  }
);

// ── 检查点 ──
handleIpc('ccarmy:checkpoint-create', (_e, phase: 'round_start' | 'round_end') => {
  try {
    if (!checkpoints) return { ok: false };
    const memDir = path.join(app.getPath('userData'), 'memory');
    const jsonl = path.join(memDir, 'fast-memory.jsonl');
    const cp = checkpoints.create({ phase, logSeq: Date.now(), jsonlPath: fs.existsSync(jsonl) ? jsonl : undefined });
    return { ok: true, checkpoint: cp, list: checkpoints.list() };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

handleIpc('ccarmy:checkpoint-list', () => ({
  ok: true,
  list: checkpoints?.list() || [],
  space: checkpoints?.space() || { maxBytes: 512 * 1024 * 1024, usedBytes: 0, count: 0 },
}));

handleIpc('ccarmy:checkpoint-rollback', (_e, id: string, opts?: { stopFirst?: boolean }) => {
  try {
    if (!checkpoints) return { ok: false };
    if (opts?.stopFirst) {
      void p1?.instances.stopAll();
    }
    const memDir = path.join(app.getPath('userData'), 'memory');
    const jsonl = path.join(memDir, 'fast-memory.jsonl');
    const ok = checkpoints.rollback(id, { jsonlPath: jsonl });
    return { ok };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

// ── 知识库 ──
handleIpc('ccarmy:knowledge-query', (_e, q: string) => {
  try {
    return { ok: true, ...(knowledge?.query(q) || { entities: [], events: [] }) };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

handleIpc(
  'ccarmy:knowledge-add-event',
  (_e, ev: { id: string; title: string; entityIds?: string[]; result?: string }) => {
    knowledge?.upsertEntity({
      id: 'default',
      kind: 'project',
      name: 'default',
      attrs: {},
      anchors: [],
    });
    knowledge?.addEvent({
      id: ev.id,
      title: ev.title,
      result: ev.result,
      entityIds: ev.entityIds || ['default'],
      anchors: [],
      ts: Date.now(),
    });
    return { ok: true };
  }
);

// ── 指令插入级别 ──
handleIpc('ccarmy:set-insert-mode', (_e, sessionId: string, mode: 'outer' | 'inner') => {
  try {
    insertMode.set(sessionId, mode);
    return { ok: true, mode };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});
handleIpc('ccarmy:get-insert-mode', (_e, sessionId: string) => ({
  ok: true,
  mode: insertMode.get(sessionId) || 'outer',
}));

// ── 指标 ──
handleIpc('ccarmy:metrics-summary', () => safeHandle(() => ({ ok: true, ...metrics.summary() }), { ok: true, turns: 0, avgDurationMs: 0, promptTokens: 0, completionTokens: 0, cacheHitRate: 0, cacheHitTokens: 0, cacheMissTokens: 0, ccrOriginalBytes: 0, ccrCompressedBytes: 0, ccrRatio: 1, healthyCache: false }))
handleIpc('ccarmy:metrics-turns', () => safeHandle(() => ({ ok: true, turns: metrics.lastTurns(20) }), { ok: true, turns: [] }))

// ── 设置持久化 ──
handleIpc('ccarmy:settings-get', () => safeHandle(() => ({ ok: true, settings: settingsStore?.load() }), { ok: true, settings: undefined }))
handleIpc('ccarmy:settings-save', (_e, partial: Record<string, unknown>) => ({
  ok: true,
  settings: settingsStore?.save(partial as never),
}));

// ── 本地账号 ──

// ── 本地 SKILL：扫描 / 删除 ──
function skillMdInfo(file: string): { name: string; description: string } {
  let name = '';
  let description = '';
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const fm = raw.match(/^---\s*\n([\s\S]*?)\n---/);
    const head = fm && fm[1] ? fm[1] : '';
    if (head) {
      const nm = head.match(/^\s*name\s*:\s*(.+)$/m);
      const dm = head.match(/^\s*description\s*:\s*(.+)$/m);
      if (nm && nm[1]) name = nm[1].trim().replace(/^["']|["']$/g, '');
      if (dm && dm[1]) description = dm[1].trim().replace(/^["']|["']$/g, '');
    }
    if (!name) {
      const h = raw.match(/^#\s+(.+)$/m);
      if (h && h[1]) name = h[1].trim();
    }
    if (!description) {
      const body = raw.replace(/^---[\s\S]*?---/, '').replace(/^#.*$/gm, '').trim();
      description = (body.split(/\n\s*\n/)[0] || '').replace(/\s+/g, ' ').slice(0, 180);
    }
  } catch {
    /* 忽略 */
  }
  return { name, description };
}

function skillRoots(): Array<{ root: string; source: string }> {
  const roots: Array<{ root: string; source: string }> = [];
  try {
    roots.push({ root: path.join(app.getPath('userData'), 'skills'), source: 'userData' });
  } catch {
    /* 忽略 */
  }
  const local = path.join(process.cwd(), 'skills');
  if (fs.existsSync(local)) roots.push({ root: local, source: 'workspace' });
  return roots;
}

handleIpc('ccarmy:skills-list', () => {
  const skills: Array<Record<string, unknown>> = [];
  for (const { root, source } of skillRoots()) {
    if (!fs.existsSync(root)) continue;
    let dirs: string[] = [];
    try {
      dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      continue;
    }
    for (const d of dirs) {
      const md = path.join(root, d, 'SKILL.md');
      if (!fs.existsSync(md)) continue;
      const info = skillMdInfo(md);
      let mtime = 0;
      try {
        mtime = fs.statSync(md).mtimeMs;
      } catch {
        /* 忽略 */
      }
      skills.push({ id: d, name: info.name || d, description: info.description, source, mtime });
    }
  }
  skills.sort((x, y) => Number(y.mtime || 0) - Number(x.mtime || 0));
  return { ok: true, skills };
});


handleIpc('ccarmy:skills-import', async () => {
  if (!win) return { ok: false, error: 'no window' };
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
  const src = r.filePaths[0];
  if (!fs.existsSync(path.join(src, 'SKILL.md'))) {
    return { ok: false, error: 'SKILL.md not found in the selected folder' };
  }
  const id = path.basename(src);
  const dest = path.join(app.getPath('userData'), 'skills', id);
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(src, dest, { recursive: true });
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

handleIpc('ccarmy:skills-paths', () => safeHandle(() => ({ ok: true, paths: skillRoots().map((r) => r.root) }), { ok: true, paths: [] }))

handleIpc('ccarmy:skills-remove', (_e, id: string) => {
  try {
    for (const { root } of skillRoots()) {
      const dir = path.resolve(root, String(id || ''));
      // 防目录穿越：必须仍在该 root 之下
      if (!dir.startsWith(path.resolve(root) + path.sep)) continue;
      if (!fs.existsSync(dir)) continue;
      fs.rmSync(dir, { recursive: true, force: true });
      return { ok: true };
    }
    return { ok: false, error: 'skill not found' };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

handleIpc('ccarmy:profile-get', () => safeHandle(() => ({ ok: true, profile: accountStore?.loadProfile() }), { ok: true, profile: undefined }))
// 读自家 package.json 的版本；dev 下 app.getVersion() 返回的是 Electron 版本，不可用
function appVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    if (pkg && pkg.version) return String(pkg.version);
  } catch {
    /* 忽略 */
  }
  return app.getVersion();
}

// 关于页：版本 / 运行时 / 平台 / 用户 ID 及其签名校验状态
handleIpc('ccarmy:app-info', () => {
  try {
    const st = accountStore?.idStatus();
    return {
      ok: true,
      name: '无限牛马',
      enName: 'CCArmy',
      version: appVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      deviceId: st?.id || '',
      deviceIdValid: st?.valid ?? false,
    };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});
handleIpc('ccarmy:profile-save', (_e, p: { username: string; email: string; avatarDataUrl?: string }) => {
  try {
    const prev = accountStore?.loadProfile();
    const next = { ...prev!, ...p };
    return { ok: true, profile: accountStore?.saveProfile(next) };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});
handleIpc('ccarmy:profile-set-password', (_e, pw: string) => {
  try {
    accountStore?.setPassword(pw);
    return { ok: true };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});
handleIpc('ccarmy:profile-login', (_e, pw: string) => {
  try {
    const r = accountStore?.loginLocal(pw) || { ok: false };
    return r;
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

// ── 语音保存 ──
handleIpc('ccarmy:save-voice', async (_e, data: { dataUrl: string; ext?: string }) => {
  try {
    const dir = path.join(app.getPath('userData'), 'voice');
    fs.mkdirSync(dir, { recursive: true });
    const ext = (data.ext || 'webm').replace(/[^\w]/g, '');
    const file = path.join(dir, `v-${Date.now()}.${ext}`);
    const b64 = String(data.dataUrl).replace(/^data:[^,]+,/, '');
    fs.writeFileSync(file, Buffer.from(b64, 'base64'));
    return { ok: true, path: file };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

// ── 节点 / 邀请 ──
handleIpc('ccarmy:nodes-list', () => safeHandle(() => ({ ok: true, nodes: nodeReg?.list() || [] }), { ok: true, nodes: [] }))
handleIpc('ccarmy:nodes-pair', (_e, nodeId: string, name: string) => ({
  ok: true,
  node: nodeReg?.pairRemote(nodeId, name),
}));
handleIpc('ccarmy:nodes-revoke', (_e, nodeId: string) => {
  try {
    nodeReg?.revoke(nodeId);
    return { ok: true };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});
handleIpc('ccarmy:invite-create', (_e, groupId?: string) => safeHandle(() => ({ ok: true, invite: createInvite(15 * 60_000, groupId) }), { ok: true, invite: { token: "", expiresAt: 0, used: false } }))
handleIpc('ccarmy:invite-use', (_e, tok: { token: string; expiresAt: number; used: boolean }) => ({
  ok: consumeInvite(tok),
}));
handleIpc('ccarmy:sync-publish', (_e, env: { fromNode: string; toNode: string; channel: string; payload: unknown; groupId?: string; incognito?: boolean }) => ({
  ok: true,
  envelope: syncBus?.publish(env as never),
}));
handleIpc('ccarmy:sync-pull', (_e, nodeId: string) => safeHandle(() => ({ ok: true, messages: syncBus?.pull(nodeId) || [] }), { ok: true, messages: [] }))

// ── dsh 实例入口（可选） ──
handleIpc('ccarmy:dsh-available', () => {
  try {
    const dir = findDshPackageDir([
      path.join(app.getAppPath(), 'spikes', 'spike-05-plugins', 'node_modules', '@deepseek-ai', 'dsh'),
      path.join(__dirname, '..', '..', '..', 'spikes', 'spike-05-plugins', 'node_modules', '@deepseek-ai', 'dsh'),
    ]);
    return { ok: !!dir, dir: dir || null };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

handleIpc('ccarmy:spawn-dsh-instance', async (_e, cfg: { id: string; name: string }) => {
  const dshDir = findDshPackageDir([
    path.join(app.getAppPath(), 'spikes', 'spike-05-plugins', 'node_modules', '@deepseek-ai', 'dsh'),
    path.join(__dirname, '..', '..', '..', 'spikes', 'spike-05-plugins', 'node_modules', '@deepseek-ai', 'dsh'),
  ]);
  if (!dshDir) return { ok: false, error: 'dsh not found' };
  const dshHome = path.join(app.getPath('userData'), 'dsh-home');
  const profile = 'ccarmy';
  await ensureDshProfile({
    nodePath: process.execPath,
    dshPackageDir: dshDir,
    dshHome,
    profile,
  });
  const entry = path.join(app.getPath('userData'), 'instances', cfg.id, 'dsh-entry.mjs');
  writeDshInstanceEntry(entry, { dshPackageDir: dshDir, dshHome, profile });
  const handle = await p1!.instances.spawn({
    config: {
      id: cfg.id,
      name: cfg.name,
      workspace: path.join(app.getPath('userData'), 'instances', cfg.id),
      dutyEligible: true,
    },
    entryScript: entry,
  });
  return { ok: true, handle };
});

// ── 邮件提醒（队列占位，功能待接 SMTP） ──
handleIpc('ccarmy:email-queue', (_e, mail: { to: string; subject: string; body: string }) => {
  try {
    emailQueue.push({ ...mail, ts: Date.now() });
    return { ok: true, pending: emailQueue.length };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});
handleIpc('ccarmy:email-list', () => safeHandle(() => ({ ok: true, items: emailQueue }), { ok: true, items: [] }))

// ── SMTP 验证（用户设置，非写死） ──
handleIpc('ccarmy:smtp-verify', async (_e, cfg: SmtpConfig & { id?: string }) => {
  try {
    const r = await verifySmtp(cfg);
    if (r.ok && cfg.id && settingsStore) {
      const s = settingsStore.load();
      const acc = (s.smtpAccounts || []).find((a) => a.id === cfg.id);
      if (acc) {
        acc.verified = true;
        acc.lastVerifyAt = Date.now();
        settingsStore.save({ smtpAccounts: s.smtpAccounts });
      }
    }
    return r;
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

handleIpc('ccarmy:smtp-list', () => {
  try {
    const s = settingsStore?.load();
    const accounts = (s?.smtpAccounts || []).map((a) => ({
      ...a,
      pass: a.pass ? '••••••••' : '',
    }));
    return { ok: true, accounts, max: 10 };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

handleIpc('ccarmy:smtp-add', (_e, acc: { label: string; host: string; port: number; secure: boolean; user: string; pass: string }) => {
  try {
    const s = settingsStore!.load();
    const list = s.smtpAccounts || [];
    if (list.length >= 10) return { ok: false, error: 'max 10' };
    const full = {
      id: 'smtp-' + Date.now().toString(36),
      label: acc.label || acc.user || `smtp-${list.length + 1}`,
      host: acc.host,
      port: acc.port || 465,
      secure: acc.secure !== false,
      user: acc.user,
      pass: acc.pass,
    };
    list.push(full);
    settingsStore!.save({ smtpAccounts: list });
    return { ok: true, accounts: list.map((a) => ({ ...a, pass: a.pass ? '••••••••' : '' })), max: 10 };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

handleIpc('ccarmy:smtp-remove', (_e, id: string) => {
  try {
    const s = settingsStore!.load();
    const list = (s.smtpAccounts || []).filter((a) => a.id !== id);
    settingsStore!.save({ smtpAccounts: list });
    return { ok: true, accounts: list.map((a) => ({ ...a, pass: a.pass ? '••••••••' : '' })) };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

handleIpc('ccarmy:smtp-update', (_e, id: string, patch: Partial<{ label: string; host: string; port: number; secure: boolean; user: string; pass: string }>) => {
  try {
    const s = settingsStore!.load();
    const list = s.smtpAccounts || [];
    const acc = list.find((a) => a.id === id);
    if (!acc) return { ok: false, error: 'not found' };
    Object.assign(acc, patch);
    settingsStore!.save({ smtpAccounts: list });
    return { ok: true, accounts: list.map((a) => ({ ...a, pass: a.pass ? '••••••••' : '' })) };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

// ── 内网同步 ──
handleIpc('ccarmy:lan-start', async (_e, port = 7788) => {
  try {
    if (lanServer?.listening) await lanServer.stop();
    const local = nodeReg?.list().find((n) => n.isLocal);
    localNodeId = local?.nodeId || 'node-local';
    lanServer = new LanSyncServer(
      localNodeId,
      port,
      path.join(app.getPath('userData'), 'bus', 'lan.jsonl')
    );
    await lanServer.start();
    return { ok: true, port, nodeId: localNodeId };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

handleIpc('ccarmy:lan-stop', async () => {
  try {
    await lanServer?.stop();
    lanServer = null;
    return { ok: true };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

handleIpc('ccarmy:lan-send', async (_e, msg: { host: string; port: number; to?: string; payload: unknown; groupId?: string; incognito?: boolean }) => {
  try {
    const client = new LanSyncClient(localNodeId);
    const r = await client.send(msg.host, msg.port, {
      to: msg.to || '*',
      channel: 'group',
      groupId: msg.groupId,
      payload: msg.payload,
      incognito: msg.incognito,
    });
    return r;
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

handleIpc('ccarmy:lan-inbox', () => ({
  ok: true,
  messages: lanServer?.inboxOf() || [],
}));

handleIpc('ccarmy:lan-status', () => ({
  ok: true,
  listening: !!lanServer?.listening,
  nodeId: localNodeId,
}));

handleIpc(
  'ccarmy:lan-dual-smoke',
  async (_e, opts: { localPort?: number; peerHost?: string; peerPort?: number }) => {
    return dualMachineSmoke({
      localId: localNodeId,
      localPort: opts.localPort || 7790,
      peerHost: opts.peerHost,
      peerPort: opts.peerPort,
    });
  }
);

// ── 多节点 mesh ──
handleIpc('ccarmy:mesh-start', async (_e, port = 7788) => {
  try {
    await mesh?.stop();
    mesh = new MeshNode(localNodeId, port, peerReg!, path.join(app.getPath('userData'), 'bus', 'mesh.jsonl'));
    await mesh.start();
    // 启动 UDP 发现
    await discovery?.stop();
    discovery = new LanDiscovery(localNodeId, 'ccarmy-' + localNodeId.slice(-4), port, (p) => {
      peerReg?.upsert({
        nodeId: p.nodeId,
        name: p.name,
        host: p.host,
        port: p.port,
        kind: 'lan',
        lastSeen: Date.now(),
      });
    });
    await discovery.start();
    discovery.broadcast();
    if (discoverTimer) clearInterval(discoverTimer);
    discoverTimer = setInterval(() => discovery?.broadcast(), 8000);
    return { ok: true, port, nodeId: localNodeId, notes: P2P_NOTES };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

handleIpc('ccarmy:mesh-stop', async () => {
  try {
    if (discoverTimer) clearInterval(discoverTimer);
    discoverTimer = null;
    await discovery?.stop();
    await mesh?.stop();
    discovery = null;
    mesh = null;
    return { ok: true };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

handleIpc('ccarmy:peers-list', () => ({
  ok: true,
  peers: peerReg?.list() || [],
  notes: P2P_NOTES,
}));

handleIpc(
  'ccarmy:peers-add',
  (_e, p: { nodeId?: string; name: string; host: string; port: number; kind?: 'lan' | 'wan' }) => {
    const nodeId = p.nodeId || `peer-${p.host}-${p.port}`;
    const info = peerReg!.addManual(nodeId, p.name || nodeId, p.host, p.port, p.kind || 'wan');
    return { ok: true, peer: info, peers: peerReg!.list() };
  }
);

handleIpc('ccarmy:peers-remove', (_e, nodeId: string) => {
  try {
    peerReg?.revoke(nodeId);
    return { ok: true, peers: peerReg?.list() || [] };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

handleIpc('ccarmy:mesh-broadcast', async (_e, payload: unknown, groupId?: string) => {
  try {
    if (!mesh) return { ok: false, error: 'mesh not started' };
    const r = await mesh.sendToAll({ to: '*', channel: 'group', groupId, payload });
    return { ok: true, ...r };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

handleIpc('ccarmy:mesh-inbox', () => safeHandle(() => ({ ok: true, messages: mesh?.inboxOf() || [] }), { ok: true, messages: [] }))

handleIpc('ccarmy:mesh-status', () => ({
  ok: true,
  listening: !!mesh,
  nodeId: localNodeId,
  peerCount: peerReg?.list().length || 0,
}));

// ── 窗口控制（自定义标题栏） ──
handleIpc('ccarmy:win-minimize', () => safeHandle(() => win?.minimize(), null))
handleIpc('ccarmy:win-maximize', () => {
  try {
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});
handleIpc('ccarmy:win-close', () => safeHandle(() => win?.close(), null))
handleIpc('ccarmy:win-reload', () => {
  try {
    if (!win) return { ok: false };
    // 清 HTTP 缓存后重载，避免旧 JS/CSS 残留
    const ses = win.webContents.session;
    ses.clearCache().catch(() => {});
    win.webContents.reloadIgnoringCache();
    return { ok: true };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});
handleIpc('ccarmy:win-always-on-top', (_e, on?: boolean) => {
  try {
    if (!win) return { ok: false };
    const next = typeof on === 'boolean' ? on : !win.isAlwaysOnTop();
    win.setAlwaysOnTop(next);
    return { ok: true, alwaysOnTop: next };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});
handleIpc('ccarmy:platform', () => ({
  ok: true,
  platform: process.platform,
  isMac: process.platform === 'darwin',
  isWin: process.platform === 'win32',
  isLinux: process.platform === 'linux',
}));


// ── P5 短命执行者 ──
handleIpc('ccarmy:executor-run', async (_e, task: { taskId?: string; brief: string; contextItems?: string[] }) => {
  try {
    if (!providerCfg.apiKey && providerCfg.protocol !== 'ollama') {
      return { ok: false, error: 'no key' };
    }
    const r = await runShortLivedExecutor(
      {
        taskId: task.taskId || 'x-' + Date.now(),
        brief: task.brief,
        contextItems: task.contextItems || [],
      },
      {
        presetId: providerCfg.presetId,
        apiKey: providerCfg.apiKey,
        baseURL: providerCfg.baseURL || undefined,
        model: providerCfg.model,
      }
    );
    return { ok: !r.error, ...r };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

handleIpc('ccarmy:executor-batch', async (_e, tasks: Array<{ taskId?: string; brief: string; contextItems?: string[] }>) => {
  try {
    if (!providerCfg.apiKey && providerCfg.protocol !== 'ollama') {
      return { ok: false, error: 'no key' };
    }
    const rs = await runExecutors(
      tasks.map((t) => ({ taskId: t.taskId || 'x-' + Date.now(), brief: t.brief, contextItems: t.contextItems || [] })),
      {
        presetId: providerCfg.presetId,
        apiKey: providerCfg.apiKey,
        baseURL: providerCfg.baseURL || undefined,
        model: providerCfg.model,
      }
    );
    return { ok: true, results: rs };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

// ── P7 资产治理 ──
handleIpc('ccarmy:assets-retrieve', (_e, opts?: { scope?: string; strict?: boolean }) => ({
  ok: true,
  assets: retrieveAssetsForChat({ scope: opts?.scope as never, strict: opts?.strict }),
}));

handleIpc('ccarmy:assets-register', (_e, a: { id: string; title: string; body: string; scope?: string }) => {
  try {
    registerChatAsset({ id: a.id, title: a.title, body: a.body, scope: a.scope as never });
    return { ok: true };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

handleIpc('ccarmy:assets-feedback', (_e, id: string, good: boolean) => {
  try {
    recordAssetUsage(id, good);
    return { ok: true };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

handleIpc('ccarmy:assets-sweep', () => safeHandle(() => ({ ok: true, n: 0 }), { ok: true, n: 0 }))

// ── P6 知识库：从对话写入 ──
handleIpc('ccarmy:kb-from-chat', (_e, payload: { sessionId: string; title: string; body: string }) => {
  try {
    knowledge?.upsertEntity({
      id: 'sess-' + payload.sessionId,
      kind: 'project',
      name: payload.sessionId,
      attrs: {},
      anchors: [],
    });
    const evId = 'ev-' + Date.now();
    knowledge?.addEvent({
      id: evId,
      title: payload.title,
      result: payload.body.slice(0, 500),
      entityIds: ['sess-' + payload.sessionId],
      anchors: [],
      ts: Date.now(),
    });
    registerChatAsset({
      id: evId,
      title: payload.title,
      body: payload.body,
      scope: 'session',
    });
    return { ok: true, eventId: evId };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});



// ── 3 权限审批弹窗 ──
handleIpc('ccarmy:request-approval', (_e, req: { action: string; suggested?: string }) => {
  try {
    const id = 'ap-' + ++approvalSeq;
    return new Promise((resolve) => {
      pendingApprovals.set(id, { resolve });
      win?.webContents.send('ccarmy:approval-request', { id, action: req.action, suggested: req.suggested || 'once' });
      setTimeout(() => {
        const p = pendingApprovals.get(id);
        if (p) {
          pendingApprovals.delete(id);
          p.resolve({ allowed: false, scope: 'deny' });
        }
      }, 30000);
    });
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

handleIpc('ccarmy:approval-respond', (_e, id: string, allowed: boolean, scope: string) => {
  try {
    const p = pendingApprovals.get(id);
    if (!p) return { ok: false };
    pendingApprovals.delete(id);
    p.resolve({ allowed, scope });
    return { ok: true };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

// ── 4 自动检查点 ──
handleIpc('ccarmy:checkpoint-auto', (_e, phase: 'round_start' | 'round_end', logSeq?: number) => {
  try {
    if (!checkpoints) return { ok: false };
    const memDir = path.join(app.getPath('userData'), 'memory');
    const jsonl = path.join(memDir, 'fast-memory.jsonl');
    const cp = checkpoints.create({
      phase,
      logSeq: logSeq || Date.now(),
      jsonlPath: fs.existsSync(jsonl) ? jsonl : undefined,
    });
    return { ok: true, checkpoint: cp, list: checkpoints.list() };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

// ── 6 成本仪表盘 ──
handleIpc('ccarmy:cost-summary', () => {
  try {
    const m = metrics.summary();
    const estCost = ((m.promptTokens + m.completionTokens) / 1000) * 0.002;
    return {
      ok: true,
      turns: m.turns,
      promptTokens: m.promptTokens,
      completionTokens: m.completionTokens,
      cacheHitRate: m.cacheHitRate,
      avgDurationMs: m.avgDurationMs,
      estCostCny: +estCost.toFixed(4),
    };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

// ── 1 值班编排闭环 ──
handleIpc('ccarmy:group-orchestrate', async (_e, msg: { groupId: string; content: string; urgency?: string; userId?: string }) => {
  const instList = (p1?.instances.list() || []).map((x) => ({
    id: x.id,
    name: x.name,
    status: x.status,
    dutyEligible: x.dutyEligible,
  }));

  const result = await orchestrateGroupMessage(
    {
      router,
      board: board!,
      ccr,
      history: chatHistories,
      listInstances: () => instList,
      addEvent: (title, body, groupId) => {
        knowledge?.upsertEntity({ id: 'grp-' + groupId, kind: 'project', name: groupId, attrs: {}, anchors: [] });
        knowledge?.addEvent({
          id: 'ev-' + Date.now(),
          title,
          result: body.slice(0, 400),
          entityIds: ['grp-' + groupId],
          anchors: [],
          ts: Date.now(),
        });
      },
    },
    {
      presetId: providerCfg.presetId,
      apiKey: providerCfg.apiKey,
      baseURL: providerCfg.baseURL || undefined,
      model: providerCfg.model,
    },
    {
      groupId: msg.groupId,
      userId: msg.userId,
      content: msg.content,
      urgency: msg.urgency as never,
    }
  );

  if (result.usage) {
    metrics.recordTurn({
      sessionId: msg.groupId,
      ts: Date.now(),
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      cacheHitTokens: result.usage.cacheHitTokens,
      cacheMissTokens: Math.max(0, result.usage.promptTokens - result.usage.cacheHitTokens),
      durationMs: 0,
      providerId: providerCfg.presetId,
      model: providerCfg.model,
    });
  }

  try {
    const memDir = path.join(app.getPath('userData'), 'memory');
    const jsonl = path.join(memDir, 'fast-memory.jsonl');
    checkpoints?.create({
      phase: 'round_end',
      logSeq: Date.now(),
      jsonlPath: fs.existsSync(jsonl) ? jsonl : undefined,
    });
  } catch { /* noop */ }

  return { ok: result.action !== 'error', ...result };
});


// ── C. 执行者状态 ──
const executorStatus: Array<{ id: string; name: string; taskId: string; brief: string; status: string; durationMs: number; ts: number }> = [];
handleIpc('ccarmy:executors-status', () => safeHandle(() => ({ ok: true, items: executorStatus.slice(-10) }), { ok: true, items: [] }))
handleIpc('ccarmy:executors-run-brief', async (_e, payload: { brief: string; contextItems?: string[]; executorIds?: string[] }) => {
  try {
    const ids = payload.executorIds?.length
      ? payload.executorIds
      : (p1?.instances.list() || []).filter((x) => x.status === 'running').map((x) => x.id).slice(0, 3);
    const t0 = Date.now();
    const results = await Promise.all(
      ids.map(async (id) => {
        const item = { id, name: id, taskId: 't-' + Date.now(), brief: payload.brief, status: 'running', durationMs: 0, ts: Date.now() };
        executorStatus.push(item);
        const r = await runShortLivedExecutor(
          { taskId: item.taskId, brief: payload.brief, contextItems: payload.contextItems || [] },
          { presetId: providerCfg.presetId, apiKey: providerCfg.apiKey, baseURL: providerCfg.baseURL || undefined, model: providerCfg.model }
        );
        item.status = r.error ? 'error' : 'done';
        item.durationMs = Date.now() - t0;
        return r;
      })
    );
    return { ok: true, results };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});


// ── E. 会话状态持久化 ──
handleIpc('ccarmy:state-save', (_e, state: { plugins?: unknown[]; instances?: unknown[]; groups?: unknown[]; chats?: unknown[] }) => {
  try {
    if (!settingsStore) return { ok: false };
    const cur = settingsStore.load();
    const next = { ...cur, ...state } as never;
    settingsStore.save(next as never);
    return { ok: true };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});
handleIpc('ccarmy:state-load', () => {
  try {
    const s = settingsStore?.load() as never;
    return { ok: true, state: s || {} };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});



// ── 知识库删除 ──
handleIpc('ccarmy:kb-delete', (_e, payload: { kind: 'entity' | 'event'; id: string }) => {
  try {
    if (!knowledge) return { ok: false, error: 'kb not ready' };
    const removed = payload?.kind === 'event' ? knowledge.removeEvent(payload.id) : knowledge.removeEntity(payload.id);
    return { ok: removed };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

// ── 通用：把文本保存到文件（CSV / Markdown 等）──
handleIpc('ccarmy:save-text', async (_e, payload: { defaultName?: string; content: string; filters?: Array<{ name: string; extensions: string[] }> }) => {
  try {
    if (!win) return { ok: false, error: 'no window' };
    const r = await dialog.showSaveDialog(win, {
      defaultPath: payload?.defaultName || 'ccarmy-export.txt',
      filters: payload?.filters || [{ name: 'Text', extensions: ['txt'] }],
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(r.filePath, String(payload?.content ?? ''), 'utf8');
    return { ok: true, path: r.filePath };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

// ── 卡顿自检：主进程 CPU / 内存 / 事件循环延迟 ──
let __diagPrevCpu: NodeJS.CpuUsage | null = null;
let __diagPrevAt = Date.now();
handleIpc('ccarmy:diagnostics', async () => {
  try {
    const now = Date.now();
    const cpu = process.cpuUsage();
    const dtMs = Math.max(1, now - __diagPrevAt);
    let cpuPercent = 0;
    if (__diagPrevCpu) {
      const du = (cpu.user - __diagPrevCpu.user) + (cpu.system - __diagPrevCpu.system); // 微秒
      cpuPercent = Math.round((du / 1000 / dtMs) * 100);
    }
    __diagPrevCpu = cpu;
    __diagPrevAt = now;
  
    // 事件循环延迟：连续 setTimeout(0) 采样
    const lag = await new Promise<number>((resolve) => {
      const samples: number[] = [];
      let n = 0;
      const tick = () => {
        const t0 = process.hrtime.bigint();
        setImmediate(() => {
          const t1 = process.hrtime.bigint();
          samples.push(Number(t1 - t0) / 1e6);
          if (++n >= 20) {
            samples.sort((x, y) => x - y);
            const mid = samples[Math.floor(samples.length / 2)] ?? 0;
            resolve(Math.round(mid * 10) / 10);
          } else {
            tick();
          }
        });
      };
      tick();
    });
  
    const mem = process.memoryUsage();
    return {
      ok: true,
      pid: process.pid,
      uptimeSec: Math.round(process.uptime()),
      cpuPercent,
      loopLagMs: lag,
      rssMb: Math.round(mem.rss / 1048576),
      heapUsedMb: Math.round(mem.heapUsed / 1048576),
      handles: (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles?.()?.length ?? 0,
      requests: (process as unknown as { _getActiveRequests?: () => unknown[] })._getActiveRequests?.()?.length ?? 0,
      nodeVersion: process.versions.node,
      electronVersion: process.versions.electron,
    };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

// ── D. ASR 语音转文字（调用 DeepSeek 兼容接口的 audio 端点；失败返回 null） ──
handleIpc('ccarmy:asr-transcribe', async (_e, payload: { dataUrl: string; ext?: string }) => {
  try {
    if (!providerCfg.apiKey) return { ok: false, error: 'no key' };
    // 优先走用户配置的 ASR 端点（若支持）；否则尝试 /audio/transcriptions
    const base = (providerCfg.baseURL || 'https://api.deepseek.com').replace(/\/+$/, '');
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
    const data = (await res.json()) as { text?: string };
    return { ok: true, text: data.text || '' };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});


// ── H. 多窗口：在新窗口打开会话 ──
const chatWindows = new Map<string, BrowserWindow>();
handleIpc('ccarmy:open-chat-window', (_e, payload: { id: string; title: string; kind?: string; mode?: string }) => {
  try {
    if (chatWindows.has(payload.id)) {
      chatWindows.get(payload.id)?.focus();
      return { ok: true };
    }
    const w = new BrowserWindow({
      width: 900,
      height: 700,
      title: payload.title || 'CCArmy',
      frame: process.platform === 'darwin',
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    void w.loadFile(path.join(__dirname, 'renderer', 'index.html'), {
      query: { chatId: payload.id, chatKind: payload.kind || 'single', chatTitle: payload.title || '', mode: payload.mode || 'full' },
    });
    w.on('closed', () => chatWindows.delete(payload.id));
    chatWindows.set(payload.id, w);
    return { ok: true };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

// ── I. 全局热键 ──
handleIpc('ccarmy:register-hotkey', (_e, accel: string) => {
  try {
    globalShortcut.unregister(accel);
    const ok = globalShortcut.register(accel, () => {
      if (!win) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    });
    return { ok };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

// ── J. 托盘 ──
let tray: import('electron').Tray | null = null;
let trayOffWorkLabel = '下班';
let exportHeaderLabel = '导出自';
let exportMeLabel = '我';
function createTray() {
  if (tray) return;
  // 用真实 logo 生成托盘图标（16/32 均可，Windows 托盘实际显示 16px）
  const iconPath = path.join(__dirname, 'renderer', 'icons', 'app.ico');
  let img = nativeImage.createFromPath(iconPath);
  if (img.isEmpty()) {
    img = nativeImage.createFromPath(path.join(__dirname, 'renderer', 'icons', 'app-32.png'));
  }
  if (img.isEmpty()) {
    // 回退：16x16 占位
    img = nativeImage.createFromBuffer(
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAKklEQVQ4y2NgGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaNgFIwCAAgQAAF/lPurAAAAAElFTkSuQmCC', 'base64')
    );
  }
  const t = new Tray(img);
  t.setToolTip('无限牛马 CCArmy');
  // 托盘菜单：只有一个「下班」（= 退出）
  t.setContextMenu(Menu.buildFromTemplate([{ label: trayOffWorkLabel, click: () => { app.quit(); } }]));
  t.on('double-click', () => {
    if (!win) { createWindow(); return; }
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  tray = t;
}
handleIpc('ccarmy:tray-init', () => {
  try {
    createTray();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});


// 托盘提示语由渲染层按当前语言下发（logo 文案随语言变化）
handleIpc('ccarmy:tray-tooltip', (_e, payload: string | { text?: string; offWork?: string; header?: string; me?: string }) => {
  try {
    const p = typeof payload === 'string' ? { text: payload } : payload || {};
    if (p.text) tray?.setToolTip(String(p.text).slice(0, 120));
    if (p.offWork && p.offWork !== trayOffWorkLabel) {
      trayOffWorkLabel = String(p.offWork);
      const { Menu } = require('electron');
      tray?.setContextMenu(Menu.buildFromTemplate([{ label: trayOffWorkLabel, click: () => { app.quit(); } }]));
    }
    if (p.header) exportHeaderLabel = String(p.header);
    if (p.me) exportMeLabel = String(p.me);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

// ── K. 会话导出 Markdown ──
handleIpc('ccarmy:export-session', (_e, payload: { title: string; messages: Array<{ role: string; text: string; ts?: number }> }) => {
  try {
    const dir = path.join(app.getPath('userData'), 'exports');
    fs.mkdirSync(dir, { recursive: true });
    const lines = [
      '# ' + payload.title,
      '',
      '> ' + exportHeaderLabel + ' CCArmy · ' + new Date().toLocaleString(),
      '',
    ];
    for (const msg of payload.messages) {
      const who = msg.role === 'me' ? exportMeLabel : payload.title;
      const time = msg.ts ? new Date(msg.ts).toLocaleString() : '';
      lines.push(`**${who}** ${time}`);
      lines.push('');
      lines.push(msg.text || '');
      lines.push('');
    }
    const file = path.join(dir, `${payload.title.replace(/[\\/:*?"<>|]/g, '_')}-${Date.now()}.md`);
    fs.writeFileSync(file, lines.join('\n'), 'utf8');
    return { ok: true, path: file };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

// ── L. 自动更新（真实查询 + 真实下载校验；自动安装未实现，明确标记） ──
handleIpc('ccarmy:auto-update-check', async () =>
  safeHandleAsync<UpdateCheckResult>(
    async () => (updater ? await updater.check() : updaterUnavailableCheck(appVersion())),
    updaterUnavailableCheck(appVersion())
  )
);
handleIpc('ccarmy:auto-update-download', async () =>
  safeHandleAsync<UpdateDownloadResult>(
    async () => (updater ? await updater.download() : updaterUnavailableDownload(appVersion())),
    updaterUnavailableDownload(appVersion())
  )
);

// ── L2. 更新源配置（写入 settings.json 的 updateFeedUrl / updateChannel） ──
function updateSourceSnapshot(): UpdateSourceInfo & { ok: boolean } {
  const info = updater?.getSourceInfo();
  if (info) return { ok: true, ...info };
  return {
    ok: false,
    configured: false,
    url: null,
    origin: 'none',
    channel: '',
    currentVersion: appVersion(),
    error: 'updater unavailable',
  };
}
handleIpc('ccarmy:update-source-get', () => safeHandle(() => updateSourceSnapshot(), updateSourceSnapshot()));
handleIpc('ccarmy:update-source-set', (_e, payload: { url?: string; channel?: string }) => {
  try {
    if (!settingsStore) return { ok: false, error: 'settings not ready' };
    const patch: Record<string, unknown> = {};
    const url = typeof payload?.url === 'string' ? payload.url.trim() : '';
    if (url) {
      const v = validateFeedUrl(url);
      if (!v.ok) return { ok: false, error: v.error }; // 校验信息是给用户看的，不含内部路径
      patch['updateFeedUrl'] = v.url;
    } else {
      patch['updateFeedUrl'] = ''; // 清空 = 未配置
    }
    if (typeof payload?.channel === 'string') patch['updateChannel'] = payload.channel.trim().slice(0, 40);
    const w = settingsStore.save(patch as never);
    if (!w) return { ok: false, error: 'cannot persist update source' };
    audit?.log('update.source.set', { configured: !!url });
    return updateSourceSnapshot();
  } catch {
    return { ok: false, error: 'cannot persist update source' };
  }
});


// ── M. 群成员管理（真实持久化：userData/groups.json） ──
handleIpc('ccarmy:group-members', (_e, groupId: string) =>
  safeHandle<GroupMembersResult>(
    () => {
      const gid = String(groupId || '');
      if (!groupStore) return { ok: false, groupId: gid, members: [], error: 'group store unavailable' };
      // 路由里已有但成员表缺的（例如更早版本入群）补一次，保证列表与路由一致
      syncMembersFromRouter(gid);
      return { ok: true, groupId: gid, members: groupStore.listMembers(gid) };
    },
    { ok: false, members: [], error: 'group store unavailable' }
  )
);
handleIpc('ccarmy:group-invite', (_e, payload: { groupId: string; name: string; role?: string }) => {
  try {
    if (!groupStore) return { ok: false, error: 'group store unavailable' };
    const gid = String(payload?.groupId || '');
    const role = payload?.role === 'admin' ? 'admin' : 'member';
    const r = groupStore.addMember(gid, { name: String(payload?.name || ''), role, source: 'invite' });
    if (!r.ok) return { ok: false, error: r.error || 'invite failed', members: r.members };
    audit?.log('group.invite', { groupId: gid });
    return { ok: true, members: r.members };
  } catch {
    return { ok: false, error: 'invite failed' };
  }
});
handleIpc('ccarmy:group-kick', (_e, payload: { groupId: string; memberId: string }) => {
  try {
    if (!groupStore) return { ok: false, error: 'group store unavailable' };
    const gid = String(payload?.groupId || '');
    const mid = String(payload?.memberId || '');
    const r = groupStore.removeMember(gid, mid);
    if (!r.ok) return { ok: false, error: r.error || 'kick failed', members: r.members };
    // 本机实例被踢时同步退出路由值班池
    const kicked = router.listMembers(gid).find((m) => m.id === mid || `inst:${m.id}` === mid);
    if (kicked) router.leave(gid, kicked.id);
    audit?.log('group.kick', { groupId: gid });
    return { ok: true, members: r.members };
  } catch {
    return { ok: false, error: 'kick failed' };
  }
});
handleIpc('ccarmy:group-set-admin', (_e, payload: { groupId: string; memberId: string; admin: boolean }) => {
  try {
    if (!groupStore) return { ok: false, error: 'group store unavailable' };
    const gid = String(payload?.groupId || '');
    const mid = String(payload?.memberId || '');
    const r = groupStore.setAdmin(gid, mid, !!payload?.admin);
    if (!r.ok) return { ok: false, error: r.error || 'set admin failed', members: r.members };
    return { ok: true, members: r.members };
  } catch {
    return { ok: false, error: 'set admin failed' };
  }
});
handleIpc('ccarmy:group-directed', (_e, payload: { groupId: string; directed: boolean }) => {
  try {
    const g = router.getGroup(payload.groupId);
    if (!g) return { ok: false, error: 'no group' };
    g.directedMode = !!payload.directed;
    groupStore?.setDirected(payload.groupId, g.directedMode);
    return { ok: true, directedMode: g.directedMode };
  } catch (e) { return { ok: false, error: 'directed mode failed' }; }
});


// ── N. 会话内嵌看板 ──
handleIpc('ccarmy:board-session', (_e, groupId: string) => ({
  ok: true,
  tasks: board?.listTasks(groupId) || [],
  events: (board?.tailEvents(20) || []).filter((e) => e.groupId === groupId),
}));


// ── O. CCR 工具输出压缩 ──
handleIpc('ccarmy:ccr-tool-output', (_e, payload: { toolName?: string; content: string }) => {
  try {
    const r = ccr.beforeLog({ kind: 'tool_result', content: payload.content, toolName: payload.toolName });
    metrics.recordCcr({ ts: Date.now(), kind: 'tool_result', originalBytes: r.originalBytes, compressedBytes: r.compressedBytes });
    return { ok: true, ...r };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});


// ── P. 知识库详情 ──
handleIpc('ccarmy:kb-detail', (_e, q: string) => {
  try {
    const r = knowledge?.query(q) || { entities: [], events: [] };
    return {
      ok: true,
      entities: r.entities.map((e) => ({ id: e.id, name: e.name, kind: e.kind, attrs: e.attrs, eventIds: e.eventIds })),
      events: r.events.map((e) => ({ id: e.id, title: e.title, result: e.result, ts: e.ts, entityIds: e.entityIds })),
    };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});


// ── Q. 错误提示 ──
handleIpc('ccarmy:last-error', () => safeHandle(() => ({ ok: true, error: lastError }), { ok: true, error: null }))
handleIpc('ccarmy:clear-error', () => { lastError = null; return { ok: true }; });


// ── R. 启动引导 ──
handleIpc('ccarmy:setup-state', () => {
  try {
    const s = settingsStore?.load() as Record<string, unknown> | undefined;
    return { ok: true, done: !!(s as { setupDone?: boolean })?.setupDone, locale: s?.locale || app.getLocale() };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});
handleIpc('ccarmy:setup-complete', (_e, payload: { locale?: string; provider?: Record<string, unknown> }) => {
  try {
    if (payload.locale) settingsStore?.save({ locale: payload.locale } as never);
    if (payload.provider) {
      // 预填 provider
      Object.assign(providerCfg, {
        presetId: (payload.provider.presetId as string) || providerCfg.presetId,
        apiKey: (payload.provider.apiKey as string) || providerCfg.apiKey,
        baseURL: (payload.provider.baseURL as string) || providerCfg.baseURL,
        model: (payload.provider.model as string) || providerCfg.model,
      });
    }
    const cur = settingsStore?.load() as unknown as Record<string, unknown>;
    settingsStore?.save({ ...cur, setupDone: true } as never);
    return { ok: true };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});


// ── S. 消息搜索（从 memory-os recall） ──
handleIpc('ccarmy:search-messages', async (_e, q: string) => {
  try {
    const r = await memory?.recall(q, 20);
    return { ok: true, hits: r?.cards || [] };
  } catch (e) {
    return { ok: false, hits: [], error: sanitizeError(e) };
  }
});


// ── V. 插件真实安装/卸载 ──
handleIpc('ccarmy:plugin-install', (_e, pkg: string) => {
  try {
    const dshHome = path.join(app.getPath('userData'), 'dsh-home');
    const profile = 'ccarmy';
    // 用 pnpm 安装到 profile
    const profileDir = path.join(dshHome, 'profiles', profile);
    fs.mkdirSync(profileDir, { recursive: true });
    const pkgJson = path.join(profileDir, 'package.json');
    if (!fs.existsSync(pkgJson)) {
      fs.writeFileSync(pkgJson, JSON.stringify({ name: 'dsh-profile-ccarmy', private: true, dependencies: {} }, null, 2));
    }
    const pj = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
    pj.dependencies = pj.dependencies || {};
    pj.dependencies[pkg] = 'latest';
    fs.writeFileSync(pkgJson, JSON.stringify(pj, null, 2));
    return { ok: true, profileDir, pkg };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});
handleIpc('ccarmy:plugin-uninstall', (_e, pkg: string) => {
  try {
    const dshHome = path.join(app.getPath('userData'), 'dsh-home');
    const pkgJson = path.join(dshHome, 'profiles', 'ccarmy', 'package.json');
    if (fs.existsSync(pkgJson)) {
      const pj = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
      if (pj.dependencies) delete pj.dependencies[pkg];
      fs.writeFileSync(pkgJson, JSON.stringify(pj, null, 2));
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});


// ── X. 归档列表 ──
const archived: Array<{ id: string; name: string; kind: string; ts: number }> = [];
handleIpc('ccarmy:archived-list', () => safeHandle(() => ({ ok: true, items: archived }), { ok: true, items: [] }))
handleIpc('ccarmy:archived-add', (_e, payload: { id: string; name: string; kind: string }) => {
  try {
    archived.push({ ...payload, ts: Date.now() });
    return { ok: true, items: archived };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});
handleIpc('ccarmy:archived-restore', (_e, id: string) => {
  try {
    const idx = archived.findIndex((x) => x.id === id);
    if (idx < 0) return { ok: false };
    const item = archived.splice(idx, 1)[0];
    return { ok: true, item };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});


// ── 审计日志 ──
handleIpc('ccarmy:audit-log', (_e, limit?: number) => ({
  ok: true,
  entries: audit?.read(limit || 50) || [],
}));
handleIpc('ccarmy:audit-clear', () => {
  try {
    audit?.clear();
    return { ok: true };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

// ── SafeStorage 密钥 ──
handleIpc('ccarmy:secure-key-save', async (_e, payload: { providerId: string; apiKey: string }) => {
  try {
    await secureKeys?.save(payload.providerId, payload.apiKey);
    audit?.log('key.save', { providerId: payload.providerId });
    return { ok: true };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});
handleIpc('ccarmy:secure-key-load', async (_e, providerId: string) => {
  try {
    const key = await secureKeys?.load(providerId);
    return { ok: !!key, key: key || null };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

// ── KnowledgeArchiver ──
handleIpc('ccarmy:archive-external', (_e, payload: { groupId: string; title: string; summary: string; anchors?: Array<{ file: string; seq: number }> }) => {
  const r = archiver?.archive({
    id: 'arc-' + Date.now(),
    groupId: payload.groupId,
    title: payload.title,
    summary: payload.summary,
    anchors: payload.anchors || [],
  });
  audit?.log('archive.external', { groupId: payload.groupId });
  return { ok: true, entry: r };
});
handleIpc('ccarmy:archive-list', (_e, groupId?: string) => ({
  ok: true,
  entries: archiver?.list(groupId) || [],
}));

// ── CleanupManager ──
handleIpc('ccarmy:cleanup-run', (_e, opts?: { checkpoints?: number }) => {
  try {
    const n = cleanup?.cleanCheckpoints(opts?.checkpoints || 20) || 0;
    const v = cleanup?.cleanVoice() || 0;
    audit?.log('cleanup.run', { checkpoints: n, voice: v });
    return { ok: true, checkpointsRemoved: n, voiceRemoved: v };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

// ── 模型角色分配 ──
handleIpc('ccarmy:role-models-set', (_e, roles: RoleModelConfig) => {
  try {
    roleModels = { ...roleModels, ...roles };
    audit?.log('roles.set', roles);
    return { ok: true, roles: roleModels };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});
handleIpc('ccarmy:role-models-get', () => safeHandle(() => ({ ok: true, roles: roleModels }), { ok: true, roles: {} }))

// ── 解散群组 ──
handleIpc('ccarmy:group-dissolve', (_e, groupId: string) => {
  try {
    // 只有创建者可解散（简化：本机节点）
    const g = router.getGroup(groupId);
    if (!g) return { ok: false, error: 'no group' };
    // 从 router 移除
    const members = router.listMembers(groupId);
    for (const m of members) router.leave(groupId, m.id);
    // 持久化的群记录与成员一起删掉
    const r = groupStore?.removeGroup(String(groupId || ''));
    if (r && !r.ok) return { ok: false, error: 'cannot persist dissolve' };
    audit?.log('group.dissolve', { groupId });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'dissolve failed' };
  }
});

// ── 允许库导出 ──
handleIpc('ccarmy:export-allowlist', () => {
  try {
    const list = p1?.security.listAllowlist() || [];
    const dir = path.join(app.getPath('userData'), 'permissions');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'allowlist-export.json');
    fs.writeFileSync(file, JSON.stringify(list, null, 2), 'utf8');
    audit?.log('allowlist.export', { count: list.length });
    return { ok: true, path: file, count: list.length };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

// ── dsh-app:// 自定义协议（零对外端口） ──
// 仅在 Electron 内部注册，不对外暴露端口
try {
  app.setAsDefaultProtocolClient('dsh-app');
} catch {
  /* noop */
}

// ── 导入 openclaw.json 供应商配置 ──
handleIpc('ccarmy:import-openclaw', () => {
  try {
    const ocPath = path.join(app.getPath('userData'), '..', 'openclaw.json');
    if (!fs.existsSync(ocPath)) return { ok: false, error: 'openclaw.json not found' };
    const j = JSON.parse(fs.readFileSync(ocPath, 'utf8'));
    const provs = Object.entries(j.models?.providers || {}).map(([id, pv]) => {
      const p = pv as { baseURL?: string; baseUrl?: string; apiKey?: string; api?: string; models?: Array<{ name?: string; id?: string }> };
      return {
        id, label: id, protocol: 'openai-compatible' as const,
        baseURL: p.baseURL || p.baseUrl || '',
        apiKey: p.apiKey || p.api || '',
        defaultModel: (p.models?.[0]?.name || p.models?.[0]?.id) || '',
        models: (p.models || []).map((m) => m.name || m.id).filter(Boolean) as string[],
      };
    });
    if (settingsStore) {
      const cur = settingsStore.load() as unknown as Record<string, unknown>;
      settingsStore.save({ ...cur, importedProviders: provs } as never);
    }
    audit?.log('providers.import', { count: provs.length });
    return { ok: true, providers: provs };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

handleIpc('ccarmy:special-models-set', (_e, cfg: { asr?: { provider: string }; embedding?: { provider: string }; summary?: { provider: string; model?: string }; organizer?: { provider: string; model?: string } }) => {
  try {
    if (settingsStore) {
      const cur = settingsStore.load() as unknown as Record<string, unknown>;
      settingsStore.save({ ...cur, specialModels: cfg } as never);
    }
    return { ok: true };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

handleIpc('ccarmy:special-models-get', () => {
  try {
    const s = settingsStore?.load() as unknown as Record<string, unknown>;
    return { ok: true, specialModels: s?.specialModels || {} };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

handleIpc('ccarmy:asr-ollama', async (_e, payload: { audioBase64: string; model?: string }) => {
  try {
    const res = await fetch('http://127.0.0.1:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: payload.model || 'dimavz/whisper-tiny', prompt: 'Transcribe audio:', stream: false, options: { audio: payload.audioBase64 } }),
    });
    if (!res.ok) return { ok: false, error: 'http ' + res.status };
    const data = (await res.json()) as { response?: string };
    return { ok: true, text: data.response || '' };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

// ── 加入请求 / 黑名单 ──
const joinRequests: Array<{ id: string; name: string; kind: string; target: string; targetType: string; ts: number; expireAt: number }> = [];
const blacklist: Array<{ id: string; name: string; blockedAt: number; target: string }> = [];
handleIpc('ccarmy:join-request', (_e, payload: { name: string; kind: string; target: string; targetType: string }) => {
  try {
    const id = "jr-" + Date.now();
    const ts = Date.now();
    joinRequests.push({ id, name: payload.name, kind: payload.kind, target: payload.target, targetType: payload.targetType, ts, expireAt: ts + 30 * 24 * 3600_000 });
    audit?.log('join.request', { id, name: payload.name, target: payload.target });
    return { ok: true, id };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});
handleIpc('ccarmy:join-pending', () => {
  try {
    const now = Date.now();
    const valid = joinRequests.filter((r) => r.expireAt > now);
    return { ok: true, items: valid, count: valid.length };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});
handleIpc('ccarmy:join-respond', (_e, payload: { id: string; action: 'agree' | 'reject' | 'block' }) => {
  try {
    const idx = joinRequests.findIndex((r) => r.id === payload.id);
    if (idx < 0) return { ok: false };
    const req = joinRequests[idx];
    if (!req) return { ok: false };
    if (payload.action === 'block') {
      blacklist.push({ id: req.id, name: req.name, blockedAt: Date.now(), target: req.target });
    }
    joinRequests.splice(idx, 1);
    audit?.log('join.respond', { id: req.id, action: payload.action });
    return { ok: true, remaining: joinRequests.filter((r) => r.expireAt > Date.now()).length };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});
handleIpc('ccarmy:blacklist-list', () => safeHandle(() => ({ ok: true, items: blacklist }), { ok: true, items: [] }))
handleIpc('ccarmy:blacklist-remove', (_e, id: string) => {
  try {
    const i = blacklist.findIndex((b) => b.id === id);
    if (i >= 0) blacklist.splice(i, 1);
    return { ok: true };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});
