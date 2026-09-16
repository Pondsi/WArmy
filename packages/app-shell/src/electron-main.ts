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
let accountStore: LocalAccountStore | null = null;
let settingsStore: SettingsStore | null = null;
let nodeReg: NodeRegistry | null = null;
let syncBus: SyncBus | null = null;
const emailQueue: Array<{ to: string; subject: string; body: string; ts: number }> = [];
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

    // 请求时邮件提醒（队列占位）
    if (settingsStore?.load().emailOnRequest) {
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
      return { ok: false, reply: '', error: err, needsKey: false };
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

