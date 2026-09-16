/**
 * Electron 主进程 — 零原生模块
 * 注意：Windows 中文路径下 fork 子进程可能乱码，memory ipc 先拷到 userData（ASCII）
 */
import { app, BrowserWindow, ipcMain, Menu, dialog, nativeTheme } from 'electron';
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
  // 链接/复制 better-sqlite3：从 memory-os 的 node_modules 解析
  const memPkgDir = path.dirname(src);
  const nmSrc = path.join(memPkgDir, 'node_modules');
  const nmDst = path.join(runtimeDir, 'node_modules');
  if (fs.existsSync(nmSrc) && !fs.existsSync(nmDst)) {
    try {
      fs.symlinkSync(nmSrc, nmDst, 'junction');
    } catch {
      // 回退：不链，依赖 require 从包目录向上找（可能失败）
      boot('symlink node_modules failed');
    }
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

function startMemoryAsync() {
  try {
    const { ipcEntry, dataDir } = prepareMemoryRuntime();
    boot(`memory ipc=${ipcEntry}`);
    memory = new MemoryClient({ nodePath: process.execPath, ipcEntry, dataDir });
    memory
      .start()
      .then(() => boot('memory ready'))
      .catch((e) => boot(`memory start fail ${String(e)}`));
  } catch (e) {
    boot(`memory prepare fail ${String(e)}`);
  }
}

function createWindow() {
  const isMac = process.platform === 'darwin';
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'CCArmy',
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
    },
  });
  void win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('ready-to-show', () => {
    win?.show();
    boot(`window ready platform=${process.platform}`);
  });
}

app
  .whenReady()
  .then(async () => {
    boot('whenReady');
    createWindow();
    boot('window created');
    await bootstrap();
    startMemoryAsync();
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

ipcMain.handle('ccarmy:hardware', () => p1?.instances.hardwareAdvice());
ipcMain.handle('ccarmy:list-instances', () => p1?.instances.list() ?? []);
ipcMain.handle(
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
ipcMain.handle('ccarmy:stop-instance', async (_e, id: string) => {
  await p1?.instances.stop(id);
  return true;
});
ipcMain.handle('ccarmy:security-mode', () => p1?.security.getMode());
ipcMain.handle(
  'ccarmy:set-security-mode',
  async (_e, mode: 'full' | 'normal' | 'strict') => {
    await p1?.security.setMode(mode);
    return p1?.security.getMode();
  }
);
ipcMain.handle('ccarmy:memory-recall', async (_e, q: string) => {
  try {
    return await memory?.recall(q);
  } catch (e) {
    return { cards: [], error: String(e) };
  }
});
ipcMain.handle('ccarmy:memory-append', async (_e, body: string) => {
  try {
    return await memory?.append({
      id: `m-${Date.now()}`,
      sessionId: 'ui',
      kind: 'message',
      body,
    });
  } catch (e) {
    return { ok: false, error: String(e) };
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

ipcMain.handle('ccarmy:i18n', (_e, locale: string) => {
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

ipcMain.handle('ccarmy:locale-info', () => {
  const sys = app.getLocale();
  return { system: sys, isZh: sys.startsWith('zh') };
});

// ── 主题 ──
ipcMain.handle('ccarmy:set-theme-source', (_e, source: 'system' | 'light' | 'dark') => {
  nativeTheme.themeSource = source === 'system' ? 'system' : source;
  return { shouldUseDarkColors: nativeTheme.shouldUseDarkColors, themeSource: nativeTheme.themeSource };
});
ipcMain.handle('ccarmy:theme-info', () => ({
  shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
  themeSource: nativeTheme.themeSource,
}));

// ── 拉取供应商模型列表（OpenAI 兼容 /models） ──
ipcMain.handle(
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
      return { ok: false, models: [], error: String((e as Error).message || e) };
    }
  }
);

// ── 选择本地提示音文件 ──
ipcMain.handle('ccarmy:pick-sound', async () => {
  if (!win) return { ok: false };
  const r = await dialog.showOpenDialog(win, {
    title: 'Select sound',
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return { ok: false };
  return { ok: true, path: r.filePaths[0] };
});

// ── 检查更新（占位） ──
ipcMain.handle('ccarmy:check-update', async () => {
  return { ok: true, upToDate: true, version: '0.1.0' };
});

// ── 选择附件文件 ──
ipcMain.handle('ccarmy:pick-file', async (_e, opts?: { filters?: string[] }) => {
  if (!win) return { ok: false };
  const ext = opts?.filters?.length ? opts.filters : undefined;
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: ext ? [{ name: ext.join('/'), extensions: ext }] : undefined,
  });
  if (r.canceled || !r.filePaths[0]) return { ok: false };
  return { ok: true, path: r.filePaths[0] };
});

// ── 群聊编排 + 看板 ──
ipcMain.handle(
  'ccarmy:group-create',
  (_e, cfg: { groupId: string; name: string; type: 'internal' | 'external'; directedMode?: boolean }) => {
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
    // 本机实例全部可值班
    for (const inst of p1?.instances.list() || []) {
      router.join(cfg.groupId, {
        id: inst.id,
        name: inst.name,
        local: true,
        dutyEligible: inst.dutyEligible,
        status: inst.status === 'running' ? 'idle' : 'offline',
      });
    }
    return { ok: true, groupId: cfg.groupId };
  }
);

ipcMain.handle('ccarmy:group-list', () => {
  // GroupChatRouter 未暴露 groups 枚举，用 board/session 聚合 + 内部缓存
  return { ok: true };
});

ipcMain.handle(
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
        llmReply = `LLM error: ${String((e as Error).message || e).slice(0, 160)}`;
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

ipcMain.handle('ccarmy:board-tasks', (_e, groupId?: string) => {
  return { ok: true, tasks: board?.listTasks(groupId) || [] };
});

ipcMain.handle('ccarmy:board-events', () => {
  return { ok: true, events: board?.tailEvents(30) || [] };
});

ipcMain.handle('ccarmy:board-aggregate', () => {
  return { ok: true, sessions: board?.aggregateByGroup() || [] };
});

ipcMain.handle('ccarmy:group-join-instance', (_e, groupId: string, instanceId: string) => {
  const inst = p1?.instances.list().find((x) => x.id === instanceId);
  if (!inst) return { ok: false };
  router.join(groupId, {
    id: inst.id,
    name: inst.name,
    local: true,
    dutyEligible: inst.dutyEligible,
    status: inst.status === 'running' ? 'idle' : 'offline',
  });
  return { ok: true };
});

// ── 真 LLM 对话 ──
ipcMain.handle('ccarmy:set-provider', (_e, cfg: Partial<typeof providerCfg>) => {
  providerCfg = { ...providerCfg, ...cfg };
  return { ok: true, providerCfg: { ...providerCfg, apiKey: providerCfg.apiKey ? '***' : '' } };
});

ipcMain.handle('ccarmy:get-provider', () => ({
  ok: true,
  providerCfg: { ...providerCfg, apiKey: providerCfg.apiKey ? '***' : '' },
  hasKey: !!providerCfg.apiKey || providerCfg.protocol === 'ollama',
}));

ipcMain.handle(
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
      const err = String((e as Error).message || e);
      lastError = { ts: Date.now(), message: err, context: 'chat-send' };
      return { ok: false, reply: '', error: err, needsKey: false, retry: true };
    }
  }
);

// ── 检查点 ──
ipcMain.handle('ccarmy:checkpoint-create', (_e, phase: 'round_start' | 'round_end') => {
  if (!checkpoints) return { ok: false };
  const memDir = path.join(app.getPath('userData'), 'memory');
  const jsonl = path.join(memDir, 'fast-memory.jsonl');
  const cp = checkpoints.create({ phase, logSeq: Date.now(), jsonlPath: fs.existsSync(jsonl) ? jsonl : undefined });
  return { ok: true, checkpoint: cp, list: checkpoints.list() };
});

ipcMain.handle('ccarmy:checkpoint-list', () => ({
  ok: true,
  list: checkpoints?.list() || [],
  space: checkpoints?.space() || { maxBytes: 512 * 1024 * 1024, usedBytes: 0, count: 0 },
}));

ipcMain.handle('ccarmy:checkpoint-rollback', (_e, id: string, opts?: { stopFirst?: boolean }) => {
  if (!checkpoints) return { ok: false };
  if (opts?.stopFirst) {
    void p1?.instances.stopAll();
  }
  const memDir = path.join(app.getPath('userData'), 'memory');
  const jsonl = path.join(memDir, 'fast-memory.jsonl');
  const ok = checkpoints.rollback(id, { jsonlPath: jsonl });
  return { ok };
});

// ── 知识库 ──
ipcMain.handle('ccarmy:knowledge-query', (_e, q: string) => {
  return { ok: true, ...(knowledge?.query(q) || { entities: [], events: [] }) };
});

ipcMain.handle(
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
ipcMain.handle('ccarmy:set-insert-mode', (_e, sessionId: string, mode: 'outer' | 'inner') => {
  insertMode.set(sessionId, mode);
  return { ok: true, mode };
});
ipcMain.handle('ccarmy:get-insert-mode', (_e, sessionId: string) => ({
  ok: true,
  mode: insertMode.get(sessionId) || 'outer',
}));

// ── 指标 ──
ipcMain.handle('ccarmy:metrics-summary', () => ({ ok: true, ...metrics.summary() }));
ipcMain.handle('ccarmy:metrics-turns', () => ({ ok: true, turns: metrics.lastTurns(20) }));

// ── 设置持久化 ──
ipcMain.handle('ccarmy:settings-get', () => ({ ok: true, settings: settingsStore?.load() }));
ipcMain.handle('ccarmy:settings-save', (_e, partial: Record<string, unknown>) => ({
  ok: true,
  settings: settingsStore?.save(partial as never),
}));

// ── 本地账号 ──
ipcMain.handle('ccarmy:profile-get', () => ({ ok: true, profile: accountStore?.loadProfile() }));
ipcMain.handle('ccarmy:profile-save', (_e, p: { username: string; email: string; avatarDataUrl?: string }) => {
  const prev = accountStore?.loadProfile();
  const next = { ...prev!, ...p };
  return { ok: true, profile: accountStore?.saveProfile(next) };
});
ipcMain.handle('ccarmy:profile-set-password', (_e, pw: string) => {
  accountStore?.setPassword(pw);
  return { ok: true };
});
ipcMain.handle('ccarmy:profile-login', (_e, pw: string) => {
  const r = accountStore?.loginLocal(pw) || { ok: false };
  return r;
});

// ── 语音保存 ──
ipcMain.handle('ccarmy:save-voice', async (_e, data: { dataUrl: string; ext?: string }) => {
  try {
    const dir = path.join(app.getPath('userData'), 'voice');
    fs.mkdirSync(dir, { recursive: true });
    const ext = (data.ext || 'webm').replace(/[^\w]/g, '');
    const file = path.join(dir, `v-${Date.now()}.${ext}`);
    const b64 = String(data.dataUrl).replace(/^data:[^,]+,/, '');
    fs.writeFileSync(file, Buffer.from(b64, 'base64'));
    return { ok: true, path: file };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

// ── 节点 / 邀请 ──
ipcMain.handle('ccarmy:nodes-list', () => ({ ok: true, nodes: nodeReg?.list() || [] }));
ipcMain.handle('ccarmy:nodes-pair', (_e, nodeId: string, name: string) => ({
  ok: true,
  node: nodeReg?.pairRemote(nodeId, name),
}));
ipcMain.handle('ccarmy:nodes-revoke', (_e, nodeId: string) => {
  nodeReg?.revoke(nodeId);
  return { ok: true };
});
ipcMain.handle('ccarmy:invite-create', (_e, groupId?: string) => ({ ok: true, invite: createInvite(15 * 60_000, groupId) }));
ipcMain.handle('ccarmy:invite-use', (_e, tok: { token: string; expiresAt: number; used: boolean }) => ({
  ok: consumeInvite(tok),
}));
ipcMain.handle('ccarmy:sync-publish', (_e, env: { fromNode: string; toNode: string; channel: string; payload: unknown; groupId?: string; incognito?: boolean }) => ({
  ok: true,
  envelope: syncBus?.publish(env as never),
}));
ipcMain.handle('ccarmy:sync-pull', (_e, nodeId: string) => ({ ok: true, messages: syncBus?.pull(nodeId) || [] }));

// ── dsh 实例入口（可选） ──
ipcMain.handle('ccarmy:dsh-available', () => {
  const dir = findDshPackageDir([
    path.join(app.getAppPath(), 'spikes', 'spike-05-plugins', 'node_modules', '@deepseek-ai', 'dsh'),
    path.join(__dirname, '..', '..', '..', 'spikes', 'spike-05-plugins', 'node_modules', '@deepseek-ai', 'dsh'),
  ]);
  return { ok: !!dir, dir: dir || null };
});

ipcMain.handle('ccarmy:spawn-dsh-instance', async (_e, cfg: { id: string; name: string }) => {
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
ipcMain.handle('ccarmy:email-queue', (_e, mail: { to: string; subject: string; body: string }) => {
  emailQueue.push({ ...mail, ts: Date.now() });
  return { ok: true, pending: emailQueue.length };
});
ipcMain.handle('ccarmy:email-list', () => ({ ok: true, items: emailQueue }));

// ── SMTP 验证（用户设置，非写死） ──
ipcMain.handle('ccarmy:smtp-verify', async (_e, cfg: SmtpConfig & { id?: string }) => {
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
});

ipcMain.handle('ccarmy:smtp-list', () => {
  const s = settingsStore?.load();
  const accounts = (s?.smtpAccounts || []).map((a) => ({
    ...a,
    pass: a.pass ? '••••••••' : '',
  }));
  return { ok: true, accounts, max: 10 };
});

ipcMain.handle('ccarmy:smtp-add', (_e, acc: { label: string; host: string; port: number; secure: boolean; user: string; pass: string }) => {
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
});

ipcMain.handle('ccarmy:smtp-remove', (_e, id: string) => {
  const s = settingsStore!.load();
  const list = (s.smtpAccounts || []).filter((a) => a.id !== id);
  settingsStore!.save({ smtpAccounts: list });
  return { ok: true, accounts: list.map((a) => ({ ...a, pass: a.pass ? '••••••••' : '' })) };
});

ipcMain.handle('ccarmy:smtp-update', (_e, id: string, patch: Partial<{ label: string; host: string; port: number; secure: boolean; user: string; pass: string }>) => {
  const s = settingsStore!.load();
  const list = s.smtpAccounts || [];
  const acc = list.find((a) => a.id === id);
  if (!acc) return { ok: false, error: 'not found' };
  Object.assign(acc, patch);
  settingsStore!.save({ smtpAccounts: list });
  return { ok: true, accounts: list.map((a) => ({ ...a, pass: a.pass ? '••••••••' : '' })) };
});

// ── 内网同步 ──
ipcMain.handle('ccarmy:lan-start', async (_e, port = 7788) => {
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
    return { ok: false, error: String((e as Error).message || e) };
  }
});

ipcMain.handle('ccarmy:lan-stop', async () => {
  await lanServer?.stop();
  lanServer = null;
  return { ok: true };
});

ipcMain.handle('ccarmy:lan-send', async (_e, msg: { host: string; port: number; to?: string; payload: unknown; groupId?: string; incognito?: boolean }) => {
  const client = new LanSyncClient(localNodeId);
  const r = await client.send(msg.host, msg.port, {
    to: msg.to || '*',
    channel: 'group',
    groupId: msg.groupId,
    payload: msg.payload,
    incognito: msg.incognito,
  });
  return r;
});

ipcMain.handle('ccarmy:lan-inbox', () => ({
  ok: true,
  messages: lanServer?.inboxOf() || [],
}));

ipcMain.handle('ccarmy:lan-status', () => ({
  ok: true,
  listening: !!lanServer?.listening,
  nodeId: localNodeId,
}));

ipcMain.handle(
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
ipcMain.handle('ccarmy:mesh-start', async (_e, port = 7788) => {
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
    return { ok: false, error: String((e as Error).message || e) };
  }
});

ipcMain.handle('ccarmy:mesh-stop', async () => {
  if (discoverTimer) clearInterval(discoverTimer);
  discoverTimer = null;
  await discovery?.stop();
  await mesh?.stop();
  discovery = null;
  mesh = null;
  return { ok: true };
});

ipcMain.handle('ccarmy:peers-list', () => ({
  ok: true,
  peers: peerReg?.list() || [],
  notes: P2P_NOTES,
}));

ipcMain.handle(
  'ccarmy:peers-add',
  (_e, p: { nodeId?: string; name: string; host: string; port: number; kind?: 'lan' | 'wan' }) => {
    const nodeId = p.nodeId || `peer-${p.host}-${p.port}`;
    const info = peerReg!.addManual(nodeId, p.name || nodeId, p.host, p.port, p.kind || 'wan');
    return { ok: true, peer: info, peers: peerReg!.list() };
  }
);

ipcMain.handle('ccarmy:peers-remove', (_e, nodeId: string) => {
  peerReg?.revoke(nodeId);
  return { ok: true, peers: peerReg?.list() || [] };
});

ipcMain.handle('ccarmy:mesh-broadcast', async (_e, payload: unknown, groupId?: string) => {
  if (!mesh) return { ok: false, error: 'mesh not started' };
  const r = await mesh.sendToAll({ to: '*', channel: 'group', groupId, payload });
  return { ok: true, ...r };
});

ipcMain.handle('ccarmy:mesh-inbox', () => ({ ok: true, messages: mesh?.inboxOf() || [] }));

ipcMain.handle('ccarmy:mesh-status', () => ({
  ok: true,
  listening: !!mesh,
  nodeId: localNodeId,
  peerCount: peerReg?.list().length || 0,
}));

// ── 窗口控制（自定义标题栏） ──
ipcMain.handle('ccarmy:win-minimize', () => win?.minimize());
ipcMain.handle('ccarmy:win-maximize', () => {
  if (!win) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});
ipcMain.handle('ccarmy:win-close', () => win?.close());
ipcMain.handle('ccarmy:win-reload', () => {
  if (!win) return { ok: false };
  // 清 HTTP 缓存后重载，避免旧 JS/CSS 残留
  const ses = win.webContents.session;
  ses.clearCache().catch(() => {});
  win.webContents.reloadIgnoringCache();
  return { ok: true };
});
ipcMain.handle('ccarmy:win-always-on-top', (_e, on?: boolean) => {
  if (!win) return { ok: false };
  const next = typeof on === 'boolean' ? on : !win.isAlwaysOnTop();
  win.setAlwaysOnTop(next);
  return { ok: true, alwaysOnTop: next };
});
ipcMain.handle('ccarmy:platform', () => ({
  ok: true,
  platform: process.platform,
  isMac: process.platform === 'darwin',
  isWin: process.platform === 'win32',
  isLinux: process.platform === 'linux',
}));


// ── P5 短命执行者 ──
ipcMain.handle('ccarmy:executor-run', async (_e, task: { taskId?: string; brief: string; contextItems?: string[] }) => {
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
});

ipcMain.handle('ccarmy:executor-batch', async (_e, tasks: Array<{ taskId?: string; brief: string; contextItems?: string[] }>) => {
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
});

// ── P7 资产治理 ──
ipcMain.handle('ccarmy:assets-retrieve', (_e, opts?: { scope?: string; strict?: boolean }) => ({
  ok: true,
  assets: retrieveAssetsForChat({ scope: opts?.scope as never, strict: opts?.strict }),
}));

ipcMain.handle('ccarmy:assets-register', (_e, a: { id: string; title: string; body: string; scope?: string }) => {
  registerChatAsset({ id: a.id, title: a.title, body: a.body, scope: a.scope as never });
  return { ok: true };
});

ipcMain.handle('ccarmy:assets-feedback', (_e, id: string, good: boolean) => {
  recordAssetUsage(id, good);
  return { ok: true };
});

ipcMain.handle('ccarmy:assets-sweep', () => ({ ok: true, n: sweepAssets() }));

// ── P6 知识库：从对话写入 ──
ipcMain.handle('ccarmy:kb-from-chat', (_e, payload: { sessionId: string; title: string; body: string }) => {
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
});



// ── 3 权限审批弹窗 ──
ipcMain.handle('ccarmy:request-approval', (_e, req: { action: string; suggested?: string }) => {
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
});

ipcMain.handle('ccarmy:approval-respond', (_e, id: string, allowed: boolean, scope: string) => {
  const p = pendingApprovals.get(id);
  if (!p) return { ok: false };
  pendingApprovals.delete(id);
  p.resolve({ allowed, scope });
  return { ok: true };
});

// ── 4 自动检查点 ──
ipcMain.handle('ccarmy:checkpoint-auto', (_e, phase: 'round_start' | 'round_end', logSeq?: number) => {
  if (!checkpoints) return { ok: false };
  const memDir = path.join(app.getPath('userData'), 'memory');
  const jsonl = path.join(memDir, 'fast-memory.jsonl');
  const cp = checkpoints.create({
    phase,
    logSeq: logSeq || Date.now(),
    jsonlPath: fs.existsSync(jsonl) ? jsonl : undefined,
  });
  return { ok: true, checkpoint: cp, list: checkpoints.list() };
});

// ── 6 成本仪表盘 ──
ipcMain.handle('ccarmy:cost-summary', () => {
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
});

// ── 1 值班编排闭环 ──
ipcMain.handle('ccarmy:group-orchestrate', async (_e, msg: { groupId: string; content: string; urgency?: string; userId?: string }) => {
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
ipcMain.handle('ccarmy:executors-status', () => ({ ok: true, items: executorStatus.slice(-10) }));
ipcMain.handle('ccarmy:executors-run-brief', async (_e, payload: { brief: string; contextItems?: string[]; executorIds?: string[] }) => {
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
});


// ── E. 会话状态持久化 ──
ipcMain.handle('ccarmy:state-save', (_e, state: { plugins?: unknown[]; instances?: unknown[]; groups?: unknown[]; chats?: unknown[] }) => {
  if (!settingsStore) return { ok: false };
  const cur = settingsStore.load();
  const next = { ...cur, ...state } as never;
  settingsStore.save(next as never);
  return { ok: true };
});
ipcMain.handle('ccarmy:state-load', () => {
  const s = settingsStore?.load() as never;
  return { ok: true, state: s || {} };
});


// ── D. ASR 语音转文字（调用 DeepSeek 兼容接口的 audio 端点；失败返回 null） ──
ipcMain.handle('ccarmy:asr-transcribe', async (_e, payload: { dataUrl: string; ext?: string }) => {
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
    return { ok: false, error: String((e as Error).message || e) };
  }
});


// ── H. 多窗口：在新窗口打开会话 ──
const chatWindows = new Map<string, BrowserWindow>();
ipcMain.handle('ccarmy:open-chat-window', (_e, payload: { id: string; title: string; kind?: string; mode?: string }) => {
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
});

// ── I. 全局热键 ──
ipcMain.handle('ccarmy:register-hotkey', (_e, accel: string) => {
  try {
    const { globalShortcut } = require('electron');
    globalShortcut.unregister(accel);
    const ok = globalShortcut.register(accel, () => {
      if (!win) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    });
    return { ok };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

// ── J. 托盘 ──
let tray: import('electron').Tray | null = null;
ipcMain.handle('ccarmy:tray-init', () => {
  try {
    const { Tray, Menu, nativeImage } = require('electron');
    if (tray) return { ok: true };
    // 16x16 简易图标
    const img = nativeImage.createEmpty();
    const t = new Tray(img);
    t.setToolTip('CCArmy');
    // 右键仅「退出」
    t.setContextMenu(
      Menu.buildFromTemplate([
        { label: '退出', click: () => { app.quit(); } },
      ])
    );
    // 双击打开主窗口
    t.on('double-click', () => {
      if (!win) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    });
    tray = t;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

// ── K. 会话导出 Markdown ──
ipcMain.handle('ccarmy:export-session', (_e, payload: { title: string; messages: Array<{ role: string; text: string; ts?: number }> }) => {
  try {
    const dir = path.join(app.getPath('userData'), 'exports');
    fs.mkdirSync(dir, { recursive: true });
    const lines = [
      '# ' + payload.title,
      '',
      '> 导出自 CCArmy · ' + new Date().toLocaleString(),
      '',
    ];
    for (const msg of payload.messages) {
      const who = msg.role === 'me' ? '我' : payload.title;
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
    return { ok: false, error: String(e) };
  }
});

// ── L. 自动更新（electron-updater 占位） ──
ipcMain.handle('ccarmy:auto-update-check', async () => {
  // 无签名/发布源时只返回状态，不实际下载
  return { ok: true, status: 'idle', message: 'no release channel configured' };
});
ipcMain.handle('ccarmy:auto-update-download', async () => {
  return { ok: false, status: 'skipped', message: 'requires signed release + update server' };
});


// ── M. 群成员管理 ──
const groupMembers = new Map<string, Array<{ id: string; name: string; role: string; joinedAt: number }>>();
ipcMain.handle('ccarmy:group-members', (_e, groupId: string) => ({
  ok: true,
  members: groupMembers.get(groupId) || [],
}));
ipcMain.handle('ccarmy:group-invite', (_e, payload: { groupId: string; name: string; role?: string }) => {
  const list = groupMembers.get(payload.groupId) || [];
  if (list.length >= 50) return { ok: false, error: 'max 50' };
  list.push({ id: 'm-' + Date.now(), name: payload.name, role: payload.role || 'member', joinedAt: Date.now() });
  groupMembers.set(payload.groupId, list);
  return { ok: true, members: list };
});
ipcMain.handle('ccarmy:group-kick', (_e, payload: { groupId: string; memberId: string }) => {
  const list = groupMembers.get(payload.groupId) || [];
  const next = list.filter((x) => x.id !== payload.memberId);
  groupMembers.set(payload.groupId, next);
  return { ok: true, members: next };
});
ipcMain.handle('ccarmy:group-set-admin', (_e, payload: { groupId: string; memberId: string; admin: boolean }) => {
  const list = groupMembers.get(payload.groupId) || [];
  const m = list.find((x) => x.id === payload.memberId);
  if (m) m.role = payload.admin ? 'admin' : 'member';
  groupMembers.set(payload.groupId, list);
  return { ok: true, members: list };
});
ipcMain.handle('ccarmy:group-directed', (_e, payload: { groupId: string; directed: boolean }) => {
  const g = router.getGroup(payload.groupId);
  if (!g) return { ok: false, error: 'no group' };
  g.directedMode = payload.directed;
  return { ok: true, directedMode: g.directedMode };
});


// ── N. 会话内嵌看板 ──
ipcMain.handle('ccarmy:board-session', (_e, groupId: string) => ({
  ok: true,
  tasks: board?.listTasks(groupId) || [],
  events: (board?.tailEvents(20) || []).filter((e) => e.groupId === groupId),
}));


// ── O. CCR 工具输出压缩 ──
ipcMain.handle('ccarmy:ccr-tool-output', (_e, payload: { toolName?: string; content: string }) => {
  const r = ccr.beforeLog({ kind: 'tool_result', content: payload.content, toolName: payload.toolName });
  metrics.recordCcr({ ts: Date.now(), kind: 'tool_result', originalBytes: r.originalBytes, compressedBytes: r.compressedBytes });
  return { ok: true, ...r };
});


// ── P. 知识库详情 ──
ipcMain.handle('ccarmy:kb-detail', (_e, q: string) => {
  const r = knowledge?.query(q) || { entities: [], events: [] };
  return {
    ok: true,
    entities: r.entities.map((e) => ({ id: e.id, name: e.name, kind: e.kind, attrs: e.attrs, eventIds: e.eventIds })),
    events: r.events.map((e) => ({ id: e.id, title: e.title, result: e.result, ts: e.ts, entityIds: e.entityIds })),
  };
});


// ── Q. 错误提示 ──
ipcMain.handle('ccarmy:last-error', () => ({ ok: true, error: lastError }));
ipcMain.handle('ccarmy:clear-error', () => { lastError = null; return { ok: true }; });


// ── R. 启动引导 ──
ipcMain.handle('ccarmy:setup-state', () => {
  const s = settingsStore?.load() as Record<string, unknown> | undefined;
  return { ok: true, done: !!(s as { setupDone?: boolean })?.setupDone, locale: s?.locale || app.getLocale() };
});
ipcMain.handle('ccarmy:setup-complete', (_e, payload: { locale?: string; provider?: Record<string, unknown> }) => {
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
});


// ── S. 消息搜索（从 memory-os recall） ──
ipcMain.handle('ccarmy:search-messages', async (_e, q: string) => {
  try {
    const r = await memory?.recall(q, 20);
    return { ok: true, hits: r?.cards || [] };
  } catch (e) {
    return { ok: false, hits: [], error: String(e) };
  }
});


// ── V. 插件真实安装/卸载 ──
ipcMain.handle('ccarmy:plugin-install', (_e, pkg: string) => {
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
    return { ok: false, error: String(e) };
  }
});
ipcMain.handle('ccarmy:plugin-uninstall', (_e, pkg: string) => {
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
    return { ok: false, error: String(e) };
  }
});


// ── X. 归档列表 ──
const archived: Array<{ id: string; name: string; kind: string; ts: number }> = [];
ipcMain.handle('ccarmy:archived-list', () => ({ ok: true, items: archived }));
ipcMain.handle('ccarmy:archived-add', (_e, payload: { id: string; name: string; kind: string }) => {
  archived.push({ ...payload, ts: Date.now() });
  return { ok: true, items: archived };
});
ipcMain.handle('ccarmy:archived-restore', (_e, id: string) => {
  const idx = archived.findIndex((x) => x.id === id);
  if (idx < 0) return { ok: false };
  const item = archived.splice(idx, 1)[0];
  return { ok: true, item };
});


// ── 审计日志 ──
ipcMain.handle('ccarmy:audit-log', (_e, limit?: number) => ({
  ok: true,
  entries: audit?.read(limit || 50) || [],
}));
ipcMain.handle('ccarmy:audit-clear', () => {
  audit?.clear();
  return { ok: true };
});

// ── SafeStorage 密钥 ──
ipcMain.handle('ccarmy:secure-key-save', async (_e, payload: { providerId: string; apiKey: string }) => {
  await secureKeys?.save(payload.providerId, payload.apiKey);
  audit?.log('key.save', { providerId: payload.providerId });
  return { ok: true };
});
ipcMain.handle('ccarmy:secure-key-load', async (_e, providerId: string) => {
  const key = await secureKeys?.load(providerId);
  return { ok: !!key, key: key || null };
});

// ── KnowledgeArchiver ──
ipcMain.handle('ccarmy:archive-external', (_e, payload: { groupId: string; title: string; summary: string; anchors?: Array<{ file: string; seq: number }> }) => {
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
ipcMain.handle('ccarmy:archive-list', (_e, groupId?: string) => ({
  ok: true,
  entries: archiver?.list(groupId) || [],
}));

// ── CleanupManager ──
ipcMain.handle('ccarmy:cleanup-run', (_e, opts?: { checkpoints?: number }) => {
  const n = cleanup?.cleanCheckpoints(opts?.checkpoints || 20) || 0;
  const v = cleanup?.cleanVoice() || 0;
  audit?.log('cleanup.run', { checkpoints: n, voice: v });
  return { ok: true, checkpointsRemoved: n, voiceRemoved: v };
});

// ── 模型角色分配 ──
ipcMain.handle('ccarmy:role-models-set', (_e, roles: RoleModelConfig) => {
  roleModels = { ...roleModels, ...roles };
  audit?.log('roles.set', roles);
  return { ok: true, roles: roleModels };
});
ipcMain.handle('ccarmy:role-models-get', () => ({ ok: true, roles: roleModels }));

// ── 解散群组 ──
ipcMain.handle('ccarmy:group-dissolve', (_e, groupId: string) => {
  // 只有创建者可解散（简化：本机节点）
  const g = router.getGroup(groupId);
  if (!g) return { ok: false, error: 'no group' };
  // 从 router 移除
  const members = router.listMembers(groupId);
  for (const m of members) router.leave(groupId, m.id);
  audit?.log('group.dissolve', { groupId });
  return { ok: true };
});

// ── 允许库导出 ──
ipcMain.handle('ccarmy:export-allowlist', () => {
  const list = p1?.security.listAllowlist() || [];
  const dir = path.join(app.getPath('userData'), 'permissions');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'allowlist-export.json');
  fs.writeFileSync(file, JSON.stringify(list, null, 2), 'utf8');
  audit?.log('allowlist.export', { count: list.length });
  return { ok: true, path: file, count: list.length };
});

// ── dsh-app:// 自定义协议（零对外端口） ──
// 仅在 Electron 内部注册，不对外暴露端口
try {
  app.setAsDefaultProtocolClient('dsh-app');
} catch {
  /* noop */
}

// ── 导入 openclaw.json 供应商配置 ──
ipcMain.handle('ccarmy:import-openclaw', () => {
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
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle('ccarmy:special-models-set', (_e, cfg: { asr?: { provider: string }; embedding?: { provider: string }; summary?: { provider: string; model?: string }; organizer?: { provider: string; model?: string } }) => {
  if (settingsStore) {
    const cur = settingsStore.load() as unknown as Record<string, unknown>;
    settingsStore.save({ ...cur, specialModels: cfg } as never);
  }
  return { ok: true };
});

ipcMain.handle('ccarmy:special-models-get', () => {
  const s = settingsStore?.load() as unknown as Record<string, unknown>;
  return { ok: true, specialModels: s?.specialModels || {} };
});

ipcMain.handle('ccarmy:asr-ollama', async (_e, payload: { audioBase64: string; model?: string }) => {
  try {
    const res = await fetch('http://127.0.0.1:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: payload.model || 'dimavz/whisper-tiny', prompt: 'Transcribe audio:', stream: false, options: { audio: payload.audioBase64 } }),
    });
    if (!res.ok) return { ok: false, error: 'http ' + res.status };
    const data = (await res.json()) as { response?: string };
    return { ok: true, text: data.response || '' };
  } catch (e) { return { ok: false, error: String(e) }; }
});

// ── 加入请求 / 黑名单 ──
const joinRequests: Array<{ id: string; name: string; kind: string; target: string; targetType: string; ts: number; expireAt: number }> = [];
const blacklist: Array<{ id: string; name: string; blockedAt: number; target: string }> = [];
ipcMain.handle('ccarmy:join-request', (_e, payload: { name: string; kind: string; target: string; targetType: string }) => {
  const id = "jr-" + Date.now();
  const ts = Date.now();
  joinRequests.push({ id, name: payload.name, kind: payload.kind, target: payload.target, targetType: payload.targetType, ts, expireAt: ts + 30 * 24 * 3600_000 });
  audit?.log('join.request', { id, name: payload.name, target: payload.target });
  return { ok: true, id };
});
ipcMain.handle('ccarmy:join-pending', () => {
  const now = Date.now();
  const valid = joinRequests.filter((r) => r.expireAt > now);
  return { ok: true, items: valid, count: valid.length };
});
ipcMain.handle('ccarmy:join-respond', (_e, payload: { id: string; action: 'agree' | 'reject' | 'block' }) => {
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
});
ipcMain.handle('ccarmy:blacklist-list', () => ({ ok: true, items: blacklist }));
ipcMain.handle('ccarmy:blacklist-remove', (_e, id: string) => {
  const i = blacklist.findIndex((b) => b.id === id);
  if (i >= 0) blacklist.splice(i, 1);
  return { ok: true };
});
