/**
 * Electron 主进程 — 零原生模块
 * 注意：Windows 中文路径下 fork 子进程可能乱码，memory ipc 先拷到 userData（ASCII）
 */
import { app, BrowserWindow, ipcMain, Menu, dialog, nativeTheme, Tray, nativeImage, globalShortcut } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createP1Runtime } from './runtime.js';
import {
  MemoryClient,
  memoryToolSpecs,
  runMemoryTool,
  chatRoleOfRecordId,
  contentDigest,
  DEFAULT_MEMORY_TOOL_LABELS,
  type MemoryToolLabels,
} from './memory-client.js';
import { GroupChatRouter, DEFAULT_PERMISSIONS } from '@ccarmy/group-router';
import { BoardStore, parseBoardCommand } from '@ccarmy/board';
import {
  createProviderFromPreset,
  chatWithTools,
  providerSupportsTools,
  type ChatMessage,
  type ChatRequest,
  type ModelProvider,
  type ToolLoopResult,
  type ToolSpec,
} from '@ccarmy/providers';
import { CcrGateway } from '@ccarmy/ccr-compressor';
import { KnowledgeBase } from '@ccarmy/knowledge-base';
import { CheckpointStore } from './checkpoint.js';
import { AuditLogger } from './audit.js';
import { SecureKeyStore } from './secure-keys.js';
import { KnowledgeArchiver, CleanupManager } from './archive-cleanup.js';
import { pickModelForUrgency, pickEmbeddingModel, type RoleModelConfig } from './model-roles.js';
import { orchestrateGroupMessage, buildStatusCard } from './orchestrator.js';
import {
  renderBoundedView,
  DEFAULT_CONTEXT_BUDGET_CHARS,
  DEFAULT_KEEP_HEAD,
  DEFAULT_KEEP_TAIL,
  type LogEntry,
} from './context-renderer.js';
import { runShortLivedExecutor, runExecutors } from './executor.js';
import { initAssetGovernor, retrieveAssetsForChat, registerChatAsset, recordAssetUsage, sweepAssets } from './asset-wire.js';
import { MetricsCollector } from './metrics.js';
import { LocalAccountStore, SettingsStore, generateDeviceId, type AppSettings } from './settings-store.js';
import { IdentityStore } from './identity-store.js';
import {
  CONTACT_CARD_I18N,
  CONTACT_FREEZE_NOTE,
  GENERATION_RULE_NOTE,
  isValidFingerprint,
  verifyIdentityCard,
  verifyRevocationDeclaration,
  verifyRotationDeclaration,
  type ContactCard,
  type IdentityCard,
  type IdentityDeclaration,
  type KeyRingEntry,
  type RotationDeclaration,
} from './identity.js';
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
import { readJsonFile, sweepTempFiles, writeJsonAtomicSafe } from './atomic-json.js';
import { NodeRegistry, SyncBus, createInvite, consumeInvite } from '@ccarmy/sync-protocol';
import { findDshPackageDir, ensureDshProfile, writeDshInstanceEntry } from '@ccarmy/dsh-runtime';
// 组网：**鉴权通道**（SecureSyncServer/Client + 名册 + 持久化重放防护），旧 lan.ts/mesh.ts 只留数据层 PeerRegistry
import { PeerRegistry } from '@ccarmy/sync-protocol';
import {
  NET_NOTES,
  SecureMesh,
  discoverPublicIp,
  ensureNetDir,
  listLocalAddresses,
  localAddressInfo,
  probeNet,
  secureLoopbackSmoke,
  tcpProbe,
  type MeshPeerRef,
  type MeshStatusResult,
  type SecureInboundMessage,
} from './net-wiring.js';
// 身份 ↔ 组网的唯一接缝：指纹推导 + 签名者注入 + 「能否后台签名」的门控
import {
  IdentityUnavailableError,
  assertDerivationMatches,
  buildIdentityChangeEntries,
  createIdentityProvider,
  createIdentitySigner,
  fingerprintDerivationForAppShell,
  knownContactFingerprints,
  listPeerContactViews,
  peerContactKeys,
  requireSignableIdentity,
} from './identity-provider.js';
// 本体协作层：ref/路径门禁 + 租约（写操作前 acquire、写完 release）
import { validatePushPaths, validateRefUpdate, type PushPathEntry } from './repo-guard.js';
import { LeaseRegistry, type AcquireRequest, type LeaseRefRequest } from './lease.js';
import {
  createGitRunner,
  findHookScript,
  installPreReceiveHook,
  runPreReceive,
  type PreReceiveResult,
} from './repo-hooks.js';
import { verifySmtp, type SmtpConfig } from './smtp-verify.js';
import crypto from 'node:crypto';

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
/**
 * 身份层（ADR 003 附五.2 第 1 步）：Ed25519 身份 + 公钥指纹 + 单调代次 + 加密私钥。
 * 它是握手 / DHT 签名 / 成员证书的共同前提，所以在启动时最先就绪。
 */
let identityStore: IdentityStore | null = null;
/** 群列表 / 群成员的真实持久化（userData/groups.json） */
let groupStore: GroupStore | null = null;
/** 自动更新（真实查询 + 真实下载校验；安装未实现） */
let updater: Updater | null = null;
let nodeReg: NodeRegistry | null = null;
let syncBus: SyncBus | null = null;
const emailQueue: Array<{ to: string; subject: string; body: string; ts: number }> = [];
let lastError: { ts: number; message: string; context?: string } | null = null;
let pendingApprovals = new Map<string, { resolve: (d: { allowed: boolean; scope: string }) => void }>();
let approvalSeq = 0;
/**
 * 组网服务（**鉴权通道**）：一台 SecureSyncServer + 出站 SecureSyncClient。
 * 取代原先的 `LanSyncServer` / `MeshNode`（明文 JSONL、无握手、无身份）——
 * 那两处是"发一行 JSON 即 ACK"，任何能被连上的进程都能发/收消息。
 */
let secureMesh: SecureMesh | null = null;
let localNodeId = 'node-local';
let peerReg: PeerRegistry | null = null;
/**
 * 本体协作层：任务/目录/文件租约（进程内唯一权威实例）。
 * 只保护"写入前的声明"：拿到租约才能写；写完释放。见 `lease.ts` 的接线说明。
 */
let leases: LeaseRegistry | null = null;
/** 换证横幅「已核实 / 已关闭」的本地留痕（审计是硬要求，落盘失败即拒绝关闭） */
let changeAckFile = '';
/** 会话消息历史（主进程侧）—— 日志的镜像（不变量 #1/#5），视图由 chatLogs 渲染而来 */
const chatHistories = new Map<string, ChatMessage[]>();
/**
 * 会话日志（只追加，ADR 002 / 不变量 #1）：不变量 #2 的"日志"侧。
 * chat-send、群消息、值班者输入共用这一份；注入模型的是 renderBoundedView 的有界视图。
 */
const chatLogs = new Map<string, LogEntry[]>();
/**
 * 日志序号：单调计数器（ADR §6「seq 由单调计数器分配」，决定裁剪顺序）。
 * 记忆服务可用时对齐它分配的 seq，这样指针里的 `retrieve(seq=…)` 能走 sqlite:seq 精确命中。
 */
let chatLogSeq = 0;
/** recordId 内的单调后缀：`m-${Date.now()}` 同毫秒会撞 id（记忆服务里 id 是 UNIQUE，撞了就 REPLACE） */
let chatLogIdSeq = 0;
/** 视图预算下限（字符）：再小连可执行指针都放不下 */
const MIN_CONTEXT_BUDGET_CHARS = 200;

/**
 * 重启历史重建的上限（ADR 002 §9.4 待办 4）。
 * 只重建最近这些条：更早的记录**不丢**（JSONL 是唯一事实来源，seq/recordId 仍可 retrieve），
 * 只是不进本进程的日志镜像 —— 视图本来就有界，指针才是取回旧内容的通道。
 */
const HISTORY_RESTORE_LIMIT = 400;
const HISTORY_RESTORE_MAX_CHARS = 400000;
/** 记忆服务重新拉起的冷却：晚起/崩过的场景下别把 fork 打爆 */
const MEMORY_ENSURE_COOLDOWN_MS = 15000;

/**
 * 上一次历史重建的结果（可观测：IPC 与验证脚本都读它）。
 * `done` = 尝试已结束，`ok` = 真的从记忆服务重建成功。
 */
let historyRestore: {
  done: boolean;
  ok: boolean;
  entries: number;
  sessions: number;
  maxSeq: number;
  reason: string;
  trigger: string;
  at: number;
} = { done: false, ok: false, entries: 0, sessions: 0, maxSeq: 0, reason: '', trigger: '', at: 0 };
let memoryEnsureAt = 0;

function nextChatSeq(memSeq?: number): number {
  const s =
    typeof memSeq === 'number' && Number.isFinite(memSeq) && memSeq > chatLogSeq
      ? Math.floor(memSeq)
      : chatLogSeq + 1;
  chatLogSeq = s;
  return s;
}

function newChatRecordId(prefix: 'm' | 'a' | 'g'): string {
  chatLogIdSeq += 1;
  return `${prefix}-${Date.now()}-${chatLogIdSeq}`;
}

/** 记忆服务 IPC 的 append 回包是 { ok, seq }；兼容直接返回记录对象的实现 */
function memSeqOf(res: unknown): number | undefined {
  const r = res as { seq?: unknown; result?: { seq?: unknown } } | null | undefined;
  if (!r || typeof r !== 'object') return undefined;
  const n = Number(r.seq ?? r.result?.seq);
  return Number.isFinite(n) ? n : undefined;
}

/** 会话日志 → 模型消息数组（chatHistories 只是它的派生镜像，见下） */
function chatMessagesOf(key: string): ChatMessage[] {
  return (chatLogs.get(key) || []).map((e) => ({ role: e.role, content: e.content }));
}

/**
 * 只追加日志（不变量 #1）+ 同步派生镜像。
 * **唯一写入点**：只有这样，"chatHistories 与 chatLogs 是同一份东西"才是结构性成立的，
 * 而不是靠每个调用点自觉（历史 bug 就是两处各自 push，重启后一起清零、与 JSONL 脱节）。
 */
function appendChatLog(key: string, entry: LogEntry): void {
  const arr = chatLogs.get(key);
  if (arr) arr.push(entry);
  else chatLogs.set(key, [entry]);
  const mirror = chatHistories.get(key);
  if (mirror) mirror.push({ role: entry.role, content: entry.content });
  else chatHistories.set(key, [{ role: entry.role, content: entry.content }]);
}

/** 读会话历史（缺镜像时按需从日志派生，绝不返回第二份真相） */
function historyOf(key: string): ChatMessage[] {
  const cached = chatHistories.get(key);
  if (cached) return cached;
  const derived = chatMessagesOf(key);
  chatHistories.set(key, derived);
  return derived;
}

/**
 * 从记忆服务的只追加日志重建会话日志 —— ADR 002 §9.4 待办 4 / 不变量 #5。
 *
 * `chatHistories` 原本是纯进程内内存数组，重启即丢，与"JSONL 是唯一事实来源"有差距。
 * 现在启动（以及记忆服务重新拉起）后从 `tail()` 拉回最近 `HISTORY_RESTORE_LIMIT` 条
 * `kind='message'` 记录：seq 直接用记忆服务分配的 seq（与 `nextChatSeq` 同一条序列），
 * 角色由 recordId 前缀还原（见 memory-client.CHAT_RECORD_PREFIX）。
 *
 * **降级**：记忆服务不可用/超时 → 什么都不做（日志与镜像为空），对话照常发送。
 */
async function restoreChatLogsFromMemory(trigger: string): Promise<typeof historyRestore> {
  const report = {
    done: true,
    ok: false,
    entries: 0,
    sessions: 0,
    maxSeq: 0,
    reason: '',
    trigger,
    at: Date.now(),
  };
  if (!memory || !memory.isReady) {
    report.reason = 'memory-unavailable';
    historyRestore = report;
    boot(`chat log restore skipped (${trigger}): memory unavailable`);
    return report;
  }
  try {
    const res = await memory.tail(HISTORY_RESTORE_LIMIT);
    const records: Array<Record<string, unknown>> = Array.isArray(res?.records) ? res.records : [];
    // tail() 是 seq 倒序（最近的在前），重建要按 seq 升序灌入
    const asc = [...records]
      .filter((r) => r && typeof r === 'object')
      .sort((a, b) => Number(a['seq'] ?? 0) - Number(b['seq'] ?? 0));
    const have = new Map<string, Set<number>>();
    for (const [k, arr] of chatLogs) have.set(k, new Set(arr.map((e) => e.seq)));
    const sessions = new Set<string>();
    let chars = 0;
    for (const r of asc) {
      if (String(r['kind'] ?? '') !== 'message') continue;
      const key = String(r['sessionId'] ?? '');
      const seq = Number(r['seq']);
      const body = typeof r['body'] === 'string' ? r['body'] : '';
      if (!key || !Number.isFinite(seq) || seq <= 0) continue;
      const seen = have.get(key) ?? new Set<number>();
      if (seen.has(seq)) continue;
      if (chars + body.length > HISTORY_RESTORE_MAX_CHARS) continue;
      seen.add(seq);
      have.set(key, seen);
      chars += body.length;
      const rid = String(r['id'] ?? '');
      appendChatLog(key, {
        seq,
        role: chatRoleOfRecordId(rid),
        content: body,
        recordId: rid || undefined,
        ts: Number(r['ts']) || undefined,
      });
      sessions.add(key);
      if (seq > report.maxSeq) report.maxSeq = seq;
      report.entries += 1;
    }
    chatLogSeq = Math.max(chatLogSeq, report.maxSeq);
    // 镜像整份重派生：重建后 chatHistories 与日志逐条对齐
    for (const key of chatLogs.keys()) chatHistories.set(key, chatMessagesOf(key));
    report.ok = true;
    report.sessions = sessions.size;
    historyRestore = report;
    boot(
      `chat log restored (${trigger}): ${report.entries} 条 / ${report.sessions} 会话 / maxSeq=${report.maxSeq}`
    );
    audit?.log('chat.history.restore', {
      trigger,
      entries: report.entries,
      sessions: report.sessions,
      maxSeq: report.maxSeq,
      limit: HISTORY_RESTORE_LIMIT,
    });
    return report;
  } catch (e) {
    report.reason = `restore-failed: ${sanitizeError(e)}`;
    historyRestore = report;
    boot(`chat log restore failed (${trigger}): ${report.reason}`);
    return report;
  }
}

/**
 * 记忆服务可用性（工具暴露 + 历史重建的前提）。
 * 不可用一律**不报错**：撤回工具、跳过重建，对话继续用进程内日志发出去。
 */
async function ensureMemoryReady(): Promise<boolean> {
  if (!memory) return false;
  if (memory.isReady) return true;
  const now = Date.now();
  if (now - memoryEnsureAt < MEMORY_ENSURE_COOLDOWN_MS) return false;
  memoryEnsureAt = now;
  try {
    await memory.start();
    boot('memory ready (re-start)');
    void restoreChatLogsFromMemory('memory-restart');
    return memory.isReady;
  } catch (e) {
    boot(`memory re-start fail ${String(e)}`);
    return false;
  }
}

/** 工具描述（i18n，缺键时退回 memory-client 的中文默认文案） */
function toolLabels(): Partial<MemoryToolLabels> {
  const d = DEFAULT_MEMORY_TOOL_LABELS;
  return {
    recall: tMain('llm.toolRecallDesc', d.recall),
    retrieve: tMain('llm.toolRetrieveDesc', d.retrieve),
    queryParam: tMain('llm.toolQueryParam', d.queryParam),
    limitParam: tMain('llm.toolLimitParam', d.limitParam),
    recordIdParam: tMain('llm.toolRecordIdParam', d.recordIdParam),
    seqParam: tMain('llm.toolSeqParam', d.seqParam),
    offsetParam: tMain('llm.toolOffsetParam', d.offsetParam),
    maxCharsParam: tMain('llm.toolMaxCharsParam', d.maxCharsParam),
  };
}

/** 工具调用上限（settings 可配；越界值一律夹到安全区间） */
function toolLimits(): { maxRounds: number; maxResultChars: number; totalChars: number } {
  let s: Partial<AppSettings> | undefined;
  try {
    s = settingsStore?.load();
  } catch {
    /* 配置坏了就用默认 */
  }
  const rounds = Number(s?.contextToolMaxRounds);
  const per = Number(s?.contextToolResultChars);
  const total = Number(s?.contextToolTotalChars);
  return {
    maxRounds: Number.isFinite(rounds) ? Math.min(8, Math.max(0, Math.floor(rounds))) : 3,
    maxResultChars: Number.isFinite(per) ? Math.min(8000, Math.max(200, Math.floor(per))) : 4000,
    totalChars: Number.isFinite(total) ? Math.min(40000, Math.max(200, Math.floor(total))) : 12000,
  };
}

/**
 * **所有**注入模型的对话都从这里走（ADR 002 §9.4 待办 2）：
 * 有界视图 → 多轮工具调用（recall / retrieve 走记忆服务）→ 结果回给模型 → 终答。
 *
 * 降级链（任一环节不满足就退回"现状"的普通单轮对话，**不报错**）：
 *   1. 记忆服务不可用 → 不暴露工具；
 *   2. `settings.contextToolMaxRounds = 0` → 不暴露工具；
 *   3. provider 不支持 function calling（如 Ollama）→ chatWithTools 内部降级；
 *   4. 首次带 tools 的请求报错（中转/模型不吃 tools）→ 重试一次不带工具。
 *
 * 审计：decide / enabled / unavailable / tool / degraded / done 六个事件全程留痕，
 * 只记工具名、锚点、长度与错误摘要 —— **不落 API Key，也不落工具结果正文**。
 */
async function runChatLoop(
  sessionId: string,
  provider: ModelProvider,
  req: ChatRequest
): Promise<ToolLoopResult & { tooled: boolean }> {
  const limits = toolLimits();
  const memReady = await ensureMemoryReady();
  const tools: ToolSpec[] | undefined =
    memReady && limits.maxRounds > 0 ? memoryToolSpecs(toolLabels()) : undefined;
  const supported = providerSupportsTools(provider);

  audit?.log('chat.tools.decide', {
    sessionId,
    memoryReady: memReady,
    supported,
    exposed: !!tools,
    maxRounds: limits.maxRounds,
    resultChars: limits.maxResultChars,
    totalChars: limits.totalChars,
  });
  if (tools) {
    audit?.log('chat.tools.enabled', { sessionId, tools: tools.map((t) => t.function.name) });
  } else {
    audit?.log('chat.tools.unavailable', {
      sessionId,
      reason: !memReady ? 'memory-unavailable' : 'disabled-by-settings',
    });
  }

  const loop = await chatWithTools(
    provider,
    { ...req, tools },
    async (call, ctx) => {
      const t1 = Date.now();
      const out = await runMemoryTool(memory, call, { maxChars: ctx.maxResultChars });
      metrics.recordToolCall({
        ts: Date.now(),
        sessionId,
        round: ctx.round,
        tool: out.meta.tool,
        ok: out.ok,
        chars: out.chars,
        ms: Date.now() - t1,
      });
      audit?.log('chat.tool', {
        sessionId,
        round: ctx.round,
        tool: out.meta.tool,
        ok: out.ok,
        chars: out.chars,
        anchor: out.meta.anchor,
        cards: out.meta.cards,
        hitLevel: out.meta.hitLevel,
        truncated: out.meta.truncated,
        queryChars: out.meta.queryChars,
        error: out.meta.error,
        ms: Date.now() - t1,
      });
      return out.content;
    },
    {
      maxRounds: limits.maxRounds,
      maxResultChars: limits.maxResultChars,
      maxToolResultChars: limits.totalChars,
      onEvent: (ev) => {
        if (ev.kind === 'degraded') audit?.log('chat.tools.degraded', { sessionId, detail: ev.detail });
      },
    }
  );

  metrics.recordToolLoop({
    ts: Date.now(),
    sessionId,
    requests: loop.requests,
    rounds: loop.rounds,
    toolCalls: loop.toolCalls,
    toolResultChars: loop.toolResultChars,
    degraded: loop.degraded,
    stopReason: loop.stopReason,
  });
  audit?.log('chat.tools.done', {
    sessionId,
    requests: loop.requests,
    rounds: loop.rounds,
    toolCalls: loop.toolCalls,
    toolResultChars: loop.toolResultChars,
    degraded: loop.degraded,
    stopReason: loop.stopReason,
  });
  return { ...loop, tooled: !!tools };
}

/** 视图预算：SettingsStore 可配（ADR 002 要求"注入上下文有固定上限"且可调） */
function contextBudgetChars(): number {
  try {
    const v = Number(settingsStore?.load()?.contextBudgetChars);
    // 低于下限会让可执行指针放不下（下限 200 + 上限 20 万，防止误配出荒唐值）
    if (Number.isFinite(v)) {
      return Math.min(200000, Math.max(MIN_CONTEXT_BUDGET_CHARS, Math.floor(v)));
    }
  } catch {
    /* 配置坏了就退回默认 */
  }
  return DEFAULT_CONTEXT_BUDGET_CHARS;
}

/** 统一的视图渲染入口：所有注入点都走这里，不许另写一份（不变量 #2） */
function renderChatView(key: string, recallHint?: string) {
  const view = renderBoundedView(chatLogs.get(key) || [], {
    budgetChars: contextBudgetChars(),
    keepHead: DEFAULT_KEEP_HEAD,
    keepTail: DEFAULT_KEEP_TAIL,
    recallHint,
  });
  metrics.recordView({
    ts: Date.now(),
    sessionId: key,
    logEntries: view.stats.logEntries,
    logBytes: view.stats.logBytes,
    viewBytes: view.stats.viewBytes,
    budgetChars: view.stats.budgetChars,
    pointers: view.stats.pointers,
  });
  return view;
}

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
  // ── 身份层：首次运行即生成（ADR 003 附三 C6「首次运行即生成唯一 ID 与凭证」）──
  // 私钥用 safeStorage 包裹的 DEK 加密后落盘；启用口令后连同一台机器也不够（附五.1 第一层）。
  identityStore = new IdentityStore(path.join(userData, 'identity', 'identity.json'), {
    onAudit: (op, detail) => audit?.log(op, detail),
  });
  try {
    const profile = accountStore.loadProfile();
    // 旧 9 位 deviceId 降级为**人读别名**（附 ADR §2.2：ID 不再是身份，身份是指纹）
    const idInit = identityStore.ensureIdentity(profile.deviceId || generateDeviceId(), {
      email: profile.email || '',
    });
    if (idInit.ok) {
      boot(
        `identity ${idInit.created ? 'created' : 'loaded'} fp=${idInit.info.fingerprint} gen=${idInit.info.generation} alias=${idInit.info.alias} protection=${
          idInit.info.passphraseProtected ? 'passphrase' : idInit.info.osProtected ? idInit.info.osLabel : 'none'
        }`,
      );
    } else {
      // 绝不静默重建：文件损坏时保留证据（已隔离为 .corrupt-*），由用户走"导入备份"恢复
      boot(`identity init fail: ${idInit.error}`);
      lastError = { ts: Date.now(), message: `身份初始化失败：${idInit.error}`, context: 'identity' };
    }
  } catch (e) {
    boot(`identity init fail ${String(e)}`);
  }
  // 启动时结算一次对端冻结期：到期则把"待采用的新名片"提升为本机留存值（纯本地判定，无定时器）
  try {
    const settled = identityStore.settlePeerContacts();
    boot(`identity peer-contacts settled promoted=${settled.promoted}/${settled.total}`);
  } catch (e) {
    boot(`identity peer settle fail ${String(e)}`);
  }
  audit.log('app.start', { platform: process.platform });
  // ── 租约表（本体协作层）：写操作的唯一仲裁者 ──
  leases = new LeaseRegistry({ idPrefix: 'ccarmy' });
  // ── 换证横幅的确认留痕（「已核实 / 已关闭」）；审计写不进去时拒绝关闭，见 IPC ──
  changeAckFile = path.join(userData, 'identity', 'change-acks.json');
  // ── 组网（鉴权通道）：**门控在前**，身份拿不到签名能力就不起监听、不发宣告 ──
  const netDir = ensureNetDir(userData);
  if (!netDir.ok) boot(`net dir unavailable: ${netDir.error}`);
  try {
    // 启动自检：身份层指纹必须能由身份文件里的公钥推出；不一致则整条组网线不可用
    const check = assertDerivationMatches(identityStore);
    boot(`identity derivation ok fp=${check.fingerprint} raw=${check.publicKeyRawBytes}B`);
  } catch (e) {
    const err = e as IdentityUnavailableError;
    boot(`identity derivation FAILED: ${err.name}: ${err.message}`);
    lastError = { ts: Date.now(), message: err.message, context: 'identity-derivation' };
  }
  secureMesh = new SecureMesh({
    userDataDir: userData,
    nodeId: localNodeId,
    store: () => identityStore,
    peers: () => peerRefs(),
    onInbound: (msg) => boot(`mesh inbound ${msg.channel} from ${msg.peerFingerprint.slice(0, 12)}`),
    onEvent: (ev) => {
      if (ev.type === 'handshake-ok' || ev.type === 'offline') boot(`mesh ${ev.type} ${ev.peer ?? ''}`);
    },
  });
  {
    const gate = requireSignableIdentity(identityStore);
    boot(`net gate signReady=${gate.ok} mode=${gate.unlock?.mode ?? 'none'} error=${gate.errorCode ?? '-'}`);
  }
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
      .then(() => {
        boot('memory ready');
        // 不变量 #5：记忆服务的 JSONL 是唯一事实来源 → 启动即重建会话日志（ADR 002 §9.4 待办 4）
        return restoreChatLogsFromMemory('boot');
      })
      .catch((e) => {
        boot(`memory start fail ${String(e)}`);
        // 降级路径的可观测信号：记忆服务没起来，重建被跳过（对话仍可发送）
        historyRestore = {
          done: true,
          ok: false,
          entries: 0,
          sessions: 0,
          maxSeq: 0,
          reason: 'memory-start-failed',
          trigger: 'boot',
          at: Date.now(),
        };
      });
  } catch (e) {
    boot(`memory prepare fail ${String(e)}`);
    historyRestore = {
      done: true,
      ok: false,
      entries: 0,
      sessions: 0,
      maxSeq: 0,
      reason: 'memory-prepare-failed',
      trigger: 'boot',
      at: Date.now(),
    };
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
    const dutyUserRecordId = newChatRecordId('g');
    let dutyUserSeq: number | undefined;
    try {
      dutyUserSeq = memSeqOf(
        await memory?.append({
          id: dutyUserRecordId,
          sessionId: msg.groupId,
          kind: 'message',
          body: msg.content,
        }, 'duty')
      );
    } catch {
      /* optional */
    }
    // 日志只追加 + 真实 recordId/seq（不变量 #1、#5）。
    // recordId 只在记忆服务**真的写入成功**时才挂到日志上：否则指针会给出一个解引用不到的死 id
    // （降级路径下宁可只留 seq + recall 两种线索，也不给假线索）。
    appendChatLog(msg.groupId, {
      seq: nextChatSeq(dutyUserSeq),
      role: 'user',
      content: msg.content,
      recordId: dutyUserSeq !== undefined ? dutyUserRecordId : undefined,
      ts: Date.now(),
    });

    // 值班者调用 LLM 生成回复（有 Key 时）
    let llmReply: string | null = null;
    if (providerCfg.apiKey || providerCfg.protocol === 'ollama') {
      try {
        const provider = createProviderFromPreset(providerCfg.presetId, {
          apiKey: providerCfg.apiKey,
          baseURL: providerCfg.baseURL || undefined,
        });
        // 注意：用户消息已经在上面 appendChatLog 时进了镜像（chatHistories 不再是独立真相，
        // 见 appendChatLog —— 历史 bug 就是两处各自 push，重启后与 JSONL 脱节）
        // 不变量 #2：注入的是有界渲染视图（原来这里是 hist.slice(-20)，只按条数有界）。
        // 值班系统提示是**冻结头**，不随日志增长，作为固定前缀在预算之外（常数开销）。
        const view = renderChatView(msg.groupId, msg.content);
        // ADR 002 §9.4 待办 2：值班者路径也只走这一个循环入口（工具/降级/审计行为一致）
        const loop = await runChatLoop(msg.groupId, provider, {
          model: providerCfg.model,
          messages: [
            {
              role: 'system',
              content:
                tMain('llm.dutySystem'),
            },
            ...(view.messages as ChatMessage[]),
          ],
          maxTokens: 512,
        });
        llmReply = loop.response.choices[0]?.message?.content || '';
        appendChatLog(msg.groupId, {
          seq: nextChatSeq(),
          role: 'assistant',
          content: llmReply,
          recordId: newChatRecordId('a'),
          ts: Date.now(),
        });
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
    // 日志只追加（不变量 #1）：先写入记忆服务，拿到**真实 recordId + seq** 再落日志，
    // 这样指针里的 retrieve(recordId=…)/retrieve(seq=…) 真的能回到这条原文。
    // recordId 只在写入成功时才挂到日志（失败时宁缺勿假：死 id 会让模型白跑一轮工具）。
    const userRecordId = newChatRecordId('m');
    let userMemSeq: number | undefined;
    try {
      userMemSeq = memSeqOf(
        await memory?.append(
          {
            id: userRecordId,
            sessionId,
            kind: 'message',
            // role 一并落 JSONL（SQLite 投影查不到它，但 JSONL 才是事实来源；
            // 重建时先用 recordId 前缀，将来有读 JSONL 的 IPC 就能直接用这个字段）
            role: 'user',
            body: compressed.content,
          },
          'duty'
        )
      );
    } catch {
      /* optional */
    }
    appendChatLog(sessionId, {
      seq: nextChatSeq(userMemSeq),
      role: 'user',
      content: compressed.content,
      recordId: userMemSeq !== undefined ? userRecordId : undefined,
      ts: Date.now(),
    });

    if (!providerCfg.apiKey && providerCfg.protocol !== 'ollama') {
      const reply = tMain('llm.noKey') + msg.content.slice(0, 80);
      appendChatLog(sessionId, {
        seq: nextChatSeq(),
        role: 'assistant',
        content: reply,
        recordId: newChatRecordId('a'),
        ts: Date.now(),
      });
      return { ok: true, reply, usage: null, needsKey: true };
    }

    const t0 = Date.now();
    try {
      const provider = createProviderFromPreset(providerCfg.presetId, {
        apiKey: providerCfg.apiKey,
        baseURL: providerCfg.baseURL || undefined,
      });
      // 不变量 #2：注入的是日志的**有界渲染视图**，不是日志本身（ADR 002 §4/§6）
      const view = renderChatView(sessionId, msg.content);
      // ADR 002 §9.4 待办 2：模型可以当轮调用 recall/retrieve 把被省略的原文取回来
      const loop = await runChatLoop(sessionId, provider, {
        model: msg.model || providerCfg.model,
        messages: view.messages as ChatMessage[],
        maxTokens: 1024,
      });
      const resp = loop.response;
      const reply = resp.choices[0]?.message?.content || '';
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
      const replyRecordId = newChatRecordId('a');
      let replyMemSeq: number | undefined;
      try {
        replyMemSeq = memSeqOf(
          await memory?.append(
            // 与日志正文**一致**地落盘：之前这里 slice(0,4000)，会让 retrieve(recordId) 只能回到前 4000 字符，
            // 而日志里是全量 —— 两份真相不一致，等于长回复的尾巴取不回来（不丢细节的前提是两边同一份内容）。
            { id: replyRecordId, sessionId, kind: 'message', role: 'assistant', body: reply },
            'duty'
          )
        );
      } catch {
        /* optional */
      }
      appendChatLog(sessionId, {
        seq: nextChatSeq(replyMemSeq),
        role: 'assistant',
        content: reply,
        recordId: replyMemSeq !== undefined ? replyRecordId : undefined,
        ts: Date.now(),
      });
      if (knowledge && reply.length > 0) {
        knowledge.upsertEntity({
          id: 'session-' + sessionId,
          kind: 'project',
          name: sessionId,
          attrs: {},
          anchors: [],
        });
      }
      return {
        ok: true,
        reply,
        usage: resp.usage,
        needsKey: false,
        /** 工具调用观测（渲染层可据此展示"本轮调用了 retrieve/recall"） */
        tools: {
          requested: !!loop.tooled,
          calls: loop.toolCalls,
          rounds: loop.rounds,
          requests: loop.requests,
          degraded: loop.degraded,
          stopReason: loop.stopReason,
        },
      };
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
handleIpc('ccarmy:metrics-summary', () => safeHandle(() => ({ ok: true, ...metrics.summary() }), { ok: true, turns: 0, avgDurationMs: 0, promptTokens: 0, completionTokens: 0, cacheHitRate: 0, cacheHitTokens: 0, cacheMissTokens: 0, ccrOriginalBytes: 0, ccrCompressedBytes: 0, ccrRatio: 1, healthyCache: false, viewSamples: 0, viewBytes: 0, logBytes: 0, viewBudgetChars: 0, viewBytesMin: 0, viewBytesMax: 0, logEntries: 0, viewPointers: 0, viewBounded: true, toolCalls: 0, toolCallsOk: 0, toolChars: 0, toolTurns: 0, toolDegradedTurns: 0, toolStopReasons: {}, toolLoopBounded: true }))
handleIpc('ccarmy:metrics-turns', () => safeHandle(() => ({ ok: true, turns: metrics.lastTurns(20) }), { ok: true, turns: [] }))
handleIpc('ccarmy:metrics-tools', () => safeHandle(() => ({ ok: true, calls: metrics.lastToolCalls(50) }), { ok: true, calls: [] }))

/**
 * 会话日志（只追加）的只读视图 —— ADR 002 §9.4 待办 4 的观测面。
 * 只回 seq / 角色 / 长度 / 摘要，不回正文（正文在记忆服务里，靠 retrieve 取）。
 */
handleIpc('ccarmy:chat-log', (_e, payload?: { sessionId?: string; limit?: number }) => {
  try {
    const sessionId = String(payload?.sessionId ?? '');
    const limit = Math.min(500, Math.max(1, Math.floor(Number(payload?.limit)) || 200));
    const all = chatLogs.get(sessionId) || [];
    return {
      ok: true,
      sessionId,
      count: all.length,
      entries: all.slice(-limit).map((e) => ({
        seq: e.seq,
        role: e.role,
        chars: e.content.length,
        recordId: e.recordId || null,
        digest: contentDigest(e.content),
        ts: e.ts ?? null,
      })),
      stats: {
        sessions: [...chatLogs.keys()],
        logSeq: chatLogSeq,
        restore: historyRestore,
        // 缺镜像时按需从日志派生（历史上是两份各自 push 的真相，重启后一起清零）
        historyMirror: historyOf(sessionId).length,
      },
    };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

/** 手动触发一次历史重建（排障/验证用；与启动路径同一函数） */
handleIpc('ccarmy:chat-log-restore', async () => {
  const report = await restoreChatLogsFromMemory('ipc');
  return { ok: report.ok, restore: report, sessions: [...chatLogs.keys()], logSeq: chatLogSeq };
});

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
  // 写操作门禁：导入技能会整目录覆盖 → 先拿租约（另一台/另一个身份正在导入同一目录就被挡住）
  const guarded = withLease('skills', ['skills'], () => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(src, dest, { recursive: true });
    return id;
  });
  try {
    if (!guarded.ok) return { ok: false, error: 'lease-denied', errorCode: guarded.errorCode, reason: guarded.reason, conflicts: guarded.conflicts };
    return { ok: true, id: guarded.value };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

handleIpc('ccarmy:skills-paths', () => safeHandle(() => ({ ok: true, paths: skillRoots().map((r) => r.root) }), { ok: true, paths: [] }))

handleIpc('ccarmy:skills-remove', (_e, id: string) => {
  try {
    // 删除也是写操作：与导入共用同一把租约（否则导入中途被删 = 半个目录）
    const guarded = withLease('skills', ['skills'], () => {
      for (const { root } of skillRoots()) {
        const dir = path.resolve(root, String(id || ''));
        // 防目录穿越：必须仍在该 root 之下
        if (!dir.startsWith(path.resolve(root) + path.sep)) continue;
        if (!fs.existsSync(dir)) continue;
        fs.rmSync(dir, { recursive: true, force: true });
        return true;
      }
      return false;
    });
    if (!guarded.ok) return { ok: false, error: 'lease-denied', errorCode: guarded.errorCode, reason: guarded.reason };
    return guarded.value ? { ok: true } : { ok: false, error: 'skill not found' };
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
      // 身份层（ADR 003）：deviceId 只是人读别名，身份以公钥指纹为准
      identityFingerprint: identityStore?.info()?.fingerprint || '',
      identityGeneration: identityStore?.info()?.generation ?? 0,
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

// ── 身份层（ADR 003 附五 / 附五.1 / 附六） ──
/**
 * 身份公开信息。**只给公开部分**：指纹 / 公钥 / 代次 / 名片 / 退役公钥 / 时间线。
 * 私钥永远不出主进程（导出也只能是加密备份）。
 */
handleIpc('ccarmy:identity-info', () =>
  safeHandle(
    () => ({
      ok: true,
      identity: identityStore?.info() ?? null,
      unlock: identityStore?.unlockState() ?? null,
      /** 换证 / 作废时间线（含**旧名片快照**，供附六的横幅展示旧联系方式） */
      timeline: identityStore?.timeline() ?? [],
      /** ⚠️ 代次规则的诚实说明，UI 文案必须照此写：只防回滚，不防抢占（附五.1） */
      generationRuleNote: GENERATION_RULE_NOTE,
      /** 名片占位/标签所需 i18n 键：渲染层自己 t()，主进程不拼中文 */
      contactI18n: CONTACT_CARD_I18N,
      /** 7 天联系信息冻结期的说明（含"从本机收到通知起算"） */
      contactFreezeNote: CONTACT_FREEZE_NOTE,
      /** 导出/换证都要口令；这里只声明需求，不代填 */
      passphraseMinLength: 8,
    }),
    {
      ok: true,
      identity: null,
      unlock: null,
      timeline: [],
      generationRuleNote: GENERATION_RULE_NOTE,
      contactI18n: CONTACT_CARD_I18N,
      contactFreezeNote: CONTACT_FREEZE_NOTE,
      passphraseMinLength: 8,
    },
  ),
);

/**
 * 换证（主动轮换）：用**旧私钥**签迁移声明（旧公钥→新公钥 + 代次 + 时间戳，**不含任何联系方式**）
 * 与"旧的作废"声明，代次 +1，旧公钥进退役列表（保公钥丢私钥），并开启 7 天联系信息冻结期。
 * `previousCard` 取自**本机留存历史**（不是声明）—— 横幅展示旧联系方式用它。
 */
handleIpc('ccarmy:identity-rotate', (_e, payload: { reason?: string; passphrase?: string } = {}) => {
  try {
    if (!identityStore) return { ok: false, error: 'identity-unavailable' };
    const r = identityStore.rotate(payload || {});
    if (!r.ok) return { ok: false, error: r.error };
    return {
      ok: true,
      identity: r.info,
      /** 迁移声明：随 DHT 记录 / 群内记录 / 联系人通道传播（接收方用旧公钥验签 + 代次规则判定） */
      declaration: r.declaration,
      /** 作废声明：由旧私钥自签，表示"这把旧钥匙下线了" */
      revocation: r.revocation,
      /** 换证前的名片：来自本机留存（声明里没有联系方式，也不该有） */
      previousCard: r.previousCard,
      contactFreezeUntil: r.contactFreezeUntil,
      timeline: identityStore.timeline(),
      generationRuleNote: GENERATION_RULE_NOTE,
      contactFreezeNote: CONTACT_FREEZE_NOTE,
    };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

/** 本机的名片历史（旧值留存；换证横幅的"旧联系方式"取自这里） */
handleIpc('ccarmy:identity-card-history', () =>
  safeHandle(() => ({ ok: true, history: identityStore?.contactCardHistory() ?? [], freeze: identityStore?.contactFreeze() ?? null }), { ok: true, history: [], freeze: null }),
);

/**
 * 接收方侧：记录对方的名片（加入时交换 / 换证后补发）。
 * 首次加入直接留存、**不冻结**；处于冻结期则只记为 pending，展示继续用本机留存值。
 */
handleIpc('ccarmy:identity-peer-card', (_e, payload: { fingerprint?: string; card?: ContactCard; signedCard?: IdentityCard } = {}) => {
  try {
    if (!identityStore) return { ok: false, error: 'identity-unavailable' };
    let fingerprint = payload?.fingerprint || '';
    let card = payload?.card as ContactCard | undefined;
    if (payload?.signedCard) {
      // 带签名的名片先验签（自签 + 指纹自洽），再决定是否留存
      const v = verifyIdentityCard(payload.signedCard);
      if (!v.ok) return { ok: false, error: `bad-card:${v.reason}` };
      fingerprint = payload.signedCard.fingerprint;
      card = payload.signedCard.contactCard;
    }
    if (!fingerprint || !isValidFingerprint(fingerprint)) return { ok: false, error: 'fingerprint-required' };
    return { ok: true, peer: identityStore.recordPeerCard(fingerprint, card || {}, Date.now()) };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

/**
 * 接收方侧：记录"收到换证通知"并**从本机此刻**起算 7 天冻结（不用声明里的时间戳）。
 * 先验签 + 走代次规则，规则不过就不落地。
 */
handleIpc(
  'ccarmy:identity-peer-rotation',
  (_e, payload: { declaration?: RotationDeclaration; knownKeys?: KeyRingEntry[]; currentGeneration?: number } = {}) => {
    try {
      if (!identityStore) return { ok: false, error: 'identity-unavailable' };
      const d = payload?.declaration;
      if (!d) return { ok: false, error: 'declaration-required' };
      const verdict = verifyRotationDeclaration(d, {
        ...(payload?.knownKeys ? { knownKeys: payload.knownKeys } : {}),
        ...(typeof payload?.currentGeneration === 'number' ? { currentGeneration: payload.currentGeneration } : {}),
      });
      if (!verdict.accepted) return { ok: false, error: verdict.reason, verdict };
      const peer = identityStore.recordPeerRotation(d, Date.now());
      return { ok: true, verdict, peer };
    } catch (e) {
      return { ok: false, error: sanitizeError(e) };
    }
  },
);

/** 接收方侧：取某指纹的对端名片视图（旧/新两个字段并列 + 冻结状态） */
handleIpc('ccarmy:identity-peer-contact', (_e, fingerprint: string) =>
  safeHandle(() => ({ ok: true, peer: fingerprint ? identityStore?.peerContact(fingerprint) ?? null : null }), { ok: true, peer: null }),
);

/**
 * 接收方侧：**手动确认**采用对方的新名片（冻结期结束后才生效）。
 * 对应 UI 文案「冻结期已结束，但不会自动采用新值——需要你手动确认」。
 */
handleIpc('ccarmy:identity-peer-confirm', (_e, fingerprint: string) => {
  try {
    if (!identityStore) return { ok: false, error: 'identity-unavailable' };
    if (!fingerprint) return { ok: false, error: 'fingerprint-required' };
    const peer = identityStore.confirmPeerCard(fingerprint);
    if (!peer) return { ok: false, error: 'unknown-peer' };
    return { ok: true, peer, adopted: !peer.awaitingConfirmation && !peer.pendingCard };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

/**
 * 导出身份凭证备份（附三 C6：产品无服务器，凭证必须用户自持）。
 * **永远是加密文件**：不存在"明文导出私钥"这条路径（附五：默认不显示明文）。
 */
handleIpc('ccarmy:identity-backup-export', (_e, payload: { passphrase?: string; writeFile?: boolean } = {}) => {
  try {
    if (!identityStore) return { ok: false, error: 'identity-unavailable' };
    const passphrase = payload?.passphrase || '';
    const r = identityStore.exportBackup({ passphrase });
    if (!r.ok) return { ok: false, error: r.error };
    let savedTo: string | null = null;
    if (payload?.writeFile !== false) {
      const dir = path.join(app.getPath('userData'), 'identity-backup');
      fs.mkdirSync(dir, { recursive: true });
      const f = path.join(dir, `identity-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      fs.writeFileSync(f, JSON.stringify(r.backup, null, 2), 'utf8');
      savedTo = f;
      audit?.log('identity.backup.save', { file: path.basename(f), fingerprint: r.backup.fingerprint });
    }
    return {
      ok: true,
      savedTo,
      // 备份本身是口令加密的密文（可打印 / 拷到别的硬盘），不含明文私钥
      backup: r.backup,
      fingerprint: r.backup.fingerprint,
      generation: r.backup.generation,
    };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

/**
 * 设置 / 启用私钥口令保护（附五.1 第一层：投入产出比最高的一条预防）。
 * 两种用法：
 *   ① 首次运行且 OS 钥匙串不可用 —— 用口令创建身份（否则身份层会拒绝明文落盘）；
 *   ② 已有身份（OS 模式）—— 升级成口令模式：此后"文件 + 同一台机器"都不够，必须知道口令。
 * ⚠️ 代价必须对用户讲清：口令忘了 = 身份没了（产品无服务器，不存在找回/补发）。
 */
handleIpc('ccarmy:identity-set-passphrase', (_e, payload: { passphrase?: string; currentPassphrase?: string } = {}) => {
  try {
    if (!identityStore) return { ok: false, error: 'identity-unavailable' };
    const passphrase = payload?.passphrase || '';
    if (!identityStore.exists()) {
      const profile = accountStore?.loadProfile();
      const made = identityStore.ensureIdentity(profile?.deviceId || generateDeviceId(), { email: profile?.email || '' }, { passphrase });
      if (!made.ok) return { ok: false, error: made.error };
      return { ok: true, created: made.created, identity: made.info, timeline: identityStore.timeline() };
    }
    const r = identityStore.setPassphrase(passphrase, {
      ...(payload?.currentPassphrase ? { currentPassphrase: payload.currentPassphrase } : {}),
    });
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, created: false, identity: r.info, timeline: identityStore.timeline() };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

/**
 * 联系人侧：验一条换证 / 作废声明并应用**单调代次规则**（横幅分支与信任更新用）。
 * 返回值里的 generationRuleNote 必须一路带到 UI —— 它明确写了"不防抢先"。
 */
handleIpc(
  'ccarmy:identity-verify-rotation',
  (_e, payload: { declaration?: IdentityDeclaration; knownKeys?: KeyRingEntry[]; currentGeneration?: number } = {}) => {
    try {
      const d = payload?.declaration;
      if (!d) return { ok: false, error: 'declaration-required' };
      if (d.kind === 'ccarmy.identity.revocation') {
        const r = verifyRevocationDeclaration(d);
        return { ok: true, kind: d.kind, accepted: r.accepted, reason: r.reason, warnings: r.warnings, honestNote: r.honestNote, detail: r.detail ?? '' };
      }
      const r = verifyRotationDeclaration(d as RotationDeclaration, {
        ...(payload?.knownKeys ? { knownKeys: payload.knownKeys } : {}),
        ...(typeof payload?.currentGeneration === 'number' ? { currentGeneration: payload.currentGeneration } : {}),
      });
      return {
        ok: true,
        kind: 'ccarmy.identity.rotation',
        accepted: r.accepted,
        reason: r.reason,
        warnings: r.warnings,
        honestNote: r.honestNote,
        oldFingerprint: r.oldFingerprint,
        newFingerprint: r.newFingerprint,
        generation: r.generation,
        detail: r.detail ?? '',
      };
    } catch (e) {
      return { ok: false, error: sanitizeError(e) };
    }
  },
);

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
// ── D. 身份变更横幅（UI 已经按这个形状写完：identityChanges / identityChangeAcknowledge / identityPeers） ──

interface ChangeAckRecord {
  level: 'dismiss' | 'verified';
  at: number;
  auditId: string;
}

function readChangeAcks(): Record<string, ChangeAckRecord> {
  return readJsonFile<Record<string, ChangeAckRecord>>(changeAckFile, {});
}

function writeChangeAcks(map: Record<string, ChangeAckRecord>): { ok: boolean; error?: string } {
  return writeJsonAtomicSafe(changeAckFile, map);
}

/**
 * 身份变更 = ① 本机换证（声明由本机自己写、可信） ② 对端换证（本机记过 receivedAt 的条目）。
 * 组装逻辑放在 `identity-provider.buildIdentityChangeEntries`（纯函数、可被验证脚本真跑），
 * 这里只负责「读确认留痕 → 交给它 → 返回 UI 契约形状」。
 * ⚠️ previousCard **只从本机留存历史取**：换证声明是攻击者可控数据。
 */
handleIpc('ccarmy:identity-changes', (_e, payload: { scope?: string } = {}) => {
  try {
    if (!identityStore) return { ok: false, error: 'identity-unavailable', changes: [] };
    void payload;
    const changes = buildIdentityChangeEntries(identityStore, { now: Date.now(), acks: readChangeAcks() });
    return { ok: true, changes };
  } catch (e) {
    return { ok: false, error: sanitizeError(e), changes: [] };
  }
});

/**
 * 「已核实 / 关闭提示」——**必须先审计成功**：审计写不进去就拒绝关闭
 * （UI 明确依赖这一点：`{ok:false}` 时不会把横幅消掉）。
 * auditId 同时写进审计日志与本地留痕，便于事后对账。
 */
handleIpc('ccarmy:identity-change-ack', (_e, payload: { changeId?: string; level?: 'dismiss' | 'verified' } = {}) => {
  try {
    if (!audit) return { ok: false, error: 'audit-unavailable' };
    if (!identityStore) return { ok: false, error: 'identity-unavailable' };
    const changeId = String(payload.changeId || '');
    const level: ChangeAckRecord['level'] | '' = payload.level === 'verified' ? 'verified' : payload.level === 'dismiss' ? 'dismiss' : '';
    if (!changeId || !level) return { ok: false, error: 'invalid-request' };
    const auditId = `idchg-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
    audit.log('identity.change.ack', { changeId, level, auditId });
    // 审计真的落地了吗？AuditLogger.log 会吞掉写失败 → 读回来确认（不确认就等于假装记过了）
    const last = audit.read(1)[0];
    const landed =
      !!last && last.op === 'identity.change.ack' && (last.detail as { auditId?: string } | undefined)?.auditId === auditId;
    if (!landed) return { ok: false, error: 'audit-write-failed' };
    const acks = readChangeAcks();
    acks[changeId] = { level, at: Date.now(), auditId };
    const w = writeChangeAcks(acks);
    if (!w.ok) return { ok: false, error: 'ack-persist-failed' };
    return { ok: true, auditId };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

/** 本机已知的**全部**对端名片状态（UI 靠它知道"有谁换了证"；按指纹单查的通道见 identity-peer-contact） */
handleIpc('ccarmy:identity-peers', () => {
  try {
    if (!identityStore) return { ok: false, error: 'identity-unavailable', peers: [] };
    return { ok: true, peers: listPeerContactViews(identityStore) };
  } catch (e) {
    return { ok: false, error: sanitizeError(e), peers: [] };
  }
});

// ── C. 本体协作层接线：ref / 路径门禁 + 租约 ──
//
// 这里**不删减任何既有校验**：IPC 只是把 repo-guard / lease 的既有实现暴露出去，
// pre-receive 钩子（scripts/git-hooks/pre-receive.mjs）跑的是同一份实现（repo-hooks.ts）。
// 也**不动**用户机器上的全局 git config（只写目标仓库自己的 hooks/pre-receive）。

interface RepoGuardRefInput {
  ref?: string;
  oldSha?: string;
  newSha?: string;
  role?: 'member' | 'admin' | 'creator' | 'duty';
  memberId?: string;
  knownSha?: string;
  repoDir?: string;
  force?: boolean;
  assumeFastForward?: boolean;
  allowForceByCreator?: boolean;
  protectedRefs?: string[];
  proposalPrefixes?: string[];
  memberPrefixes?: string[];
  envRefPrefixes?: string[];
  blockedRefPrefixes?: string[];
}

/**
 * 写操作门禁：先拿租约，写完释放。拿不到就**不写**，也不假装成功。
 * holder = 本机身份指纹（不同身份/实例互斥）。
 */
function withLease<T>(  scope: string,
  paths: string[],
  fn: () => T
):
  | { ok: true; value: T; leaseId: string }
  | { ok: false; errorCode: string; reason: string; conflicts: unknown[] } {
  if (!leases) return { ok: false, errorCode: 'no-registry', reason: 'lease-registry-unavailable', conflicts: [] };
  const holder = leaseHolder();
  const acq = leases.acquire({ holder, kind: 'dir', scope, paths });
  if (!acq.ok || !acq.lease) {
    audit?.log('lease.denied', { scope, error: acq.error?.code, conflicts: acq.conflicts?.length ?? 0 });
    return {
      ok: false,
      errorCode: acq.error?.code ?? 'acquire-failed',
      reason: acq.error?.reason ?? 'unknown',
      conflicts: acq.conflicts ?? [],
    };
  }
  const leaseId = acq.lease.id;
  try {
    return { ok: true, value: fn(), leaseId };
  } finally {
    leases.release({ holder, leaseId });
  }
}

handleIpc('ccarmy:repo-guard-check-ref', (_e, payload: RepoGuardRefInput = {} as RepoGuardRefInput) => {
  try {
    const ref = String(payload.ref || '');
    const oldSha = String(payload.oldSha || '');
    const newSha = String(payload.newSha || '');
    if (!ref) return { ok: false, error: 'ref-required' };
    let knownSha = typeof payload.knownSha === 'string' ? payload.knownSha : '';
    let isAncestor: ((a: string, d: string) => boolean | undefined) | undefined;
    const repoDir = payload.repoDir ? String(payload.repoDir) : '';
    if (repoDir) {
      const git = createGitRunner(repoDir);
      const probe = git(['rev-parse', '--absolute-git-dir']);
      if (probe.code !== 0) return { ok: false, error: 'not-a-git-repo' };
      if (!knownSha) {
        const k = git(['rev-parse', '--verify', '--quiet', ref]);
        if (k.code === 0) knownSha = k.stdout.trim();
      }
      const cache = new Map<string, boolean | undefined>();
      isAncestor = (a: string, d: string): boolean | undefined => {
        const key = `${a}..${d}`;
        if (cache.has(key)) return cache.get(key);
        const r = git(['merge-base', '--is-ancestor', a, d]);
        const v: boolean | undefined = r.code === 0 ? true : r.code === 1 ? false : undefined;
        cache.set(key, v);
        return v;
      };
    }
    const result = validateRefUpdate(ref, oldSha, newSha, {
      role: payload.role ?? 'member',
      ...(payload.memberId ? { memberId: String(payload.memberId) } : {}),
      ...(knownSha ? { knownSha } : {}),
      ...(isAncestor ? { isAncestor } : {}),
      force: payload.force === true,
      assumeFastForward: payload.assumeFastForward === true,
      allowForceByCreator: payload.allowForceByCreator === true,
      ...(Array.isArray(payload.protectedRefs) ? { protectedRefs: payload.protectedRefs.map(String) } : {}),
      ...(Array.isArray(payload.proposalPrefixes) ? { proposalPrefixes: payload.proposalPrefixes.map(String) } : {}),
      ...(Array.isArray(payload.memberPrefixes) ? { memberPrefixes: payload.memberPrefixes.map(String) } : {}),
      ...(Array.isArray(payload.envRefPrefixes) ? { envRefPrefixes: payload.envRefPrefixes.map(String) } : {}),
      ...(Array.isArray(payload.blockedRefPrefixes) ? { blockedRefPrefixes: payload.blockedRefPrefixes.map(String) } : {}),
    });
    return { ok: true, result, knownSha, usedGit: !!repoDir };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

handleIpc('ccarmy:repo-guard-check-paths', (_e, payload: { paths?: Array<string | PushPathEntry> | string; base?: 'worktree' | 'gitdir' } = {}) => {
  try {
    const validation = validatePushPaths(payload.paths ?? [], {
      base: payload.base === 'gitdir' ? 'gitdir' : 'worktree',
    });
    return { ok: true, validation };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

/** 真跑一遍 pre-receive 逻辑（stdin 三列格式）；UI / 验证脚本 / 钩子共用同一实现 */
handleIpc(
  'ccarmy:repo-guard-pre-receive',
  (_e, payload: { stdin?: string; role?: string; memberId?: string; repoDir?: string; assumeFastForward?: boolean } = {}) => {
    try {
      const git = createGitRunner(payload.repoDir ? String(payload.repoDir) : undefined);
      const result: PreReceiveResult = runPreReceive({
        git,
        stdin: String(payload.stdin ?? ''),
        role: (payload.role as 'member' | 'admin' | 'creator' | 'duty') ?? 'member',
        memberId: payload.memberId ? String(payload.memberId) : '',
        assumeFastForward: payload.assumeFastForward === true,
      });
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: sanitizeError(e) };
    }
  }
);

/** 给仓库初始化（安装）pre-receive 钩子；找不到钩子脚本时如实报错，不假装装好了 */
handleIpc('ccarmy:repo-guard-install-hooks', (_e, payload: { repoDir?: string; force?: boolean } = {}) => {
  try {
    const repoDir = String(payload.repoDir || '');
    if (!repoDir) return { ok: false, error: 'repo-dir-required' };
    const appRoot = path.join(__dirname, '..');
    const hookScript = findHookScript(appRoot);
    if (!hookScript) return { ok: false, error: 'hook-script-not-found', searched: appRoot };
    const r = installPreReceiveHook({
      repoDir,
      hookScript,
      nodeBin: process.execPath,
      force: payload.force === true,
    });
    audit?.log('repo.hook.install', { ok: r.ok, error: r.error, alreadyInstalled: r.alreadyInstalled === true });
    return { ...r, script: hookScript };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

handleIpc('ccarmy:repo-guard-status', () =>
  safeHandle(
    () => ({
      ok: true,
      hookScript: findHookScript(path.join(__dirname, '..')),
      leaseStats: leases?.stats() ?? null,
      mesh: secureMesh?.diagnostics() ?? null,
      netDir: ensureNetDir(app.getPath('userData')).ok,
    }),
    { ok: false, hookScript: null, leaseStats: null, mesh: null, netDir: false }
  )
);

handleIpc('ccarmy:lease-acquire', (_e, req: AcquireRequest = {} as AcquireRequest) => {
  try {
    if (!leases) return { ok: false, error: { code: 'no-registry', reason: 'lease-registry-unavailable' }, leases: [] };
    const r = leases.acquire({ ...req, holder: req.holder || leaseHolder() });
    if (r.ok) audit?.log('lease.acquire', { scope: r.lease?.scope, holder: r.lease?.holder, kind: r.lease?.kind });
    return { ...r, leases: leases.list() };
  } catch (e) {
    return { ok: false, error: { code: 'invalid-request', reason: sanitizeError(e) }, leases: [] };
  }
});

handleIpc('ccarmy:lease-release', (_e, req: LeaseRefRequest = {} as LeaseRefRequest) => {
  try {
    if (!leases) return { ok: false, released: false, error: { code: 'no-registry', reason: 'lease-registry-unavailable' } };
    const r = leases.release({ ...req, ...(req.holder || req.leaseId ? {} : { holder: leaseHolder() }) });
    if (r.released) audit?.log('lease.release', { leaseId: r.lease?.id, scope: r.lease?.scope });
    return { ...r, leases: leases.list() };
  } catch (e) {
    return { ok: false, released: false, error: { code: 'invalid-request', reason: sanitizeError(e) } };
  }
});

handleIpc('ccarmy:lease-list', () =>
  safeHandle(
    () => ({
      ok: true,
      holder: leaseHolder(),
      leases: leases?.list() ?? [],
      expired: leases?.expiredHistory() ?? [],
      stats: leases?.stats() ?? null,
    }),
    { ok: true, holder: '', leases: [], expired: [], stats: null }
  )
);

handleIpc('ccarmy:lease-check', (_e, payload: { holder?: string; path?: string; paths?: string[] } = {}) => {
  try {
    if (!leases) return { ok: false, errorCode: 'no-registry', results: [] };
    const holder = payload.holder || leaseHolder();
    const list = Array.isArray(payload.paths) && payload.paths.length ? payload.paths.map(String) : [String(payload.path ?? '')];
    const results = list.map((p) => leases!.checkWrite(holder, p));
    return { ok: results.every((r) => r.allowed), holder, results, holders: list.map((p) => leases!.holdersOf(p)) };
  } catch (e) {
    return { ok: false, errorCode: sanitizeError(e), results: [] };
  }
});
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

// ── 组网：**鉴权通道**（取代原 lan.ts / mesh.ts 的明文 JSONL TCP） ──
//
// 旧实现（`LanSyncServer` / `LanSyncClient` / `MeshNode`）是「发一行 JSON 即 ACK」：
// 任何能连上端口的人都能收发消息、不需要身份。现在两处都换成 `SecureSyncServer` /
// `SecureSyncClient`：先跑 HS1–HS4（Ed25519 双向认证 + X25519 ECDHE + HKDF + AES-256-GCM），
// 名册外的人直接被 `not-authorized` 拒绝，重放计数**持久化**到 userData/net/replay-guard.json。
// 通道名与返回形状保持向后兼容（lan-* / mesh-* 一个都没删）。
// `PeerRegistry` 仍然保留，但它只当**地址簿**用（没有任何鉴权语义）：能不能通信由握手 + 名册决定。

/** PeerRegistry（地址簿）→ 组网层要的对端列表 */
function peerRefs(): MeshPeerRef[] {
  return (peerReg?.list() ?? [])
    .filter((p) => !!p && typeof p.host === 'string' && Number(p.port) > 0)
    .map((p) => ({
      nodeId: p.nodeId,
      name: p.name,
      host: p.host,
      port: Number(p.port),
      kind: p.kind,
      lastSeen: p.lastSeen,
    }));
}

/** 本机节点 id 刷新（nodeReg 里的 isLocal 那条） */
function refreshLocalNodeId(): string {
  const local = nodeReg?.list().find((n) => n.isLocal);
  localNodeId = local?.nodeId || 'node-local';
  return localNodeId;
}

/** 身份指纹（写操作租约的持有者 id；没有身份时退回本机节点 id） */
function leaseHolder(): string {
  return identityStore?.info()?.fingerprint || localNodeId || 'local';
}

/**
 * 起组网（鉴权）。**门控在前**：拿不到签名能力就返回 `identity-locked`，
 * 既不监听也不宣告 —— UI 会据此显示「身份未解锁」，而不是"打开了但谁连不上"。
 */
async function startSecureMesh(port: number, opts: { discovery?: boolean; announce?: boolean } = {}) {
  refreshLocalNodeId();
  if (!secureMesh) return { ok: false as const, errorCode: 'net-unavailable', error: 'net-wiring-unavailable' };
  const r = await secureMesh.enable(port, opts);
  if (!r.ok) {
    audit?.log('net.enable.failed', { errorCode: r.errorCode, port });
    return r;
  }
  audit?.log('net.enable', {
    port: r.port,
    nodeId: r.nodeId,
    discovery: opts.discovery === true,
    announce: opts.announce === true,
  });
  return r;
}

handleIpc('ccarmy:lan-start', async (_e, port = 7788) => {
  try {
    const r = await startSecureMesh(Number(port) || 7788, { discovery: false, announce: false });
    if (!r.ok) return r;
    return { ok: true, port: r.port, nodeId: r.nodeId };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

handleIpc('ccarmy:lan-stop', async () => {
  try {
    await secureMesh?.disable();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

handleIpc(
  'ccarmy:lan-send',
  async (
    _e,
    msg: { host: string; port: number; to?: string; payload: unknown; groupId?: string; incognito?: boolean; fingerprint?: string } = {
      host: '',
      port: 0,
      payload: null,
    }
  ) => {
    try {
      if (!secureMesh) return { ok: false, error: 'net-unavailable' };
      const host = String(msg.host || '');
      const port = Number(msg.port);
      if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) return { ok: false, error: 'invalid-target' };
      // 出站一次拨号一次握手。给了 fingerprint 就 pin（同时在名册里放行它），
      // 没给则 TOFU + 严格名册校验（只有本机已知联系人能通过）。
      return await secureMesh.sendToHost(
        host,
        port,
        {
          to: msg.to || '*',
          channel: 'group',
          ...(msg.groupId ? { groupId: msg.groupId } : {}),
          payload: msg.payload,
          ...(msg.incognito ? { incognito: true } : {}),
        },
        { ...(msg.fingerprint ? { pin: String(msg.fingerprint) } : {}) }
      );
    } catch (e) {
      return { ok: false, error: sanitizeError(e) };
    }
  }
);

handleIpc('ccarmy:lan-inbox', () => safeHandle(() => ({ ok: true, messages: secureMesh?.inboxOf() ?? [] }), { ok: true, messages: [] }));

handleIpc('ccarmy:lan-status', () =>
  safeHandle(() => ({ ok: true, listening: !!secureMesh?.enabled, nodeId: localNodeId }), { ok: true, listening: false, nodeId: localNodeId })
);

handleIpc('ccarmy:lan-dual-smoke', async (_e, opts: { localPort?: number; peerHost?: string; peerPort?: number } = {}) => {
  try {
    refreshLocalNodeId();
    // 回环冒烟用**一次性**身份：握手层拒绝"对端指纹 == 本机指纹"（自反射），
    // 拿本机身份自己连自己必定失败 —— 这不是缺陷，是设计。
    return await secureLoopbackSmoke({
      nodeId: localNodeId,
      localPort: Number(opts.localPort) || 7790,
      ...(opts.peerHost ? { peerHost: opts.peerHost } : {}),
      ...(opts.peerPort ? { peerPort: Number(opts.peerPort) } : {}),
    });
  } catch (e) {
    return {
      serverPort: 0,
      loopbackOk: false,
      peerOk: false,
      peerError: sanitizeError(e),
      secure: { handshakeOk: false, ephemeral: true as const, peerFingerprint: '' },
    };
  }
});

// ── 多节点 mesh（同样走鉴权通道；UDP 只做地址发现，不传业务数据） ──
handleIpc('ccarmy:mesh-start', async (_e, port = 7788) => {
  try {
    const r = await startSecureMesh(Number(port) || 7788, { discovery: true, announce: true });
    if (!r.ok) return r;
    return { ok: true, port: r.port, nodeId: r.nodeId, notes: NET_NOTES };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

handleIpc('ccarmy:mesh-stop', async () => {
  try {
    await secureMesh?.disable();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

handleIpc('ccarmy:peers-list', () => ({
  ok: true,
  peers: peerReg?.list() || [],
  notes: NET_NOTES,
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
    if (!secureMesh?.enabled) return { ok: false, error: 'mesh not started' };
    const r = await secureMesh.broadcast({
      to: '*',
      channel: 'group',
      ...(groupId ? { groupId } : {}),
      payload,
    });
    return { ok: true, sent: r.sent, failed: r.failed, errors: r.errors };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

handleIpc('ccarmy:mesh-inbox', () => safeHandle(() => ({ ok: true, messages: secureMesh?.inboxOf() ?? [] }), { ok: true, messages: [] }));

handleIpc('ccarmy:mesh-status', () =>
  safeHandle(
    () => ({
      ok: true,
      listening: !!secureMesh?.enabled,
      nodeId: localNodeId,
      peerCount: peerReg?.list().length || 0,
      sessions: secureMesh?.sessionCount ?? 0,
    }),
    { ok: true, listening: false, nodeId: localNodeId, peerCount: 0, sessions: 0 }
  )
);

// ── 组网状态 / 探测（UI 的 netStatus/netProbe/netLocalAddress/netMembersPresence/meshEnable/meshDisable） ──
//
// 真实现：网卡枚举、TCP 连通性（含时延）、DNS 解析、出站连通性、公网地址回显、监听端口自测、活会话表。
// 降级：**入站可达性**（别人拨我）需要一台真的在公网的第三方对端 → 一律 `inboundVerified:false`，
//       且 `isPublic` 只由地址事实推出（私网/回环/链路本地/CGNAT 恒 false），绝不硬编码 true。
// 未实现：UPnP/NAT-PMP 端口映射、打洞、中继 —— 这些不开"假装成功"的口子。
handleIpc('ccarmy:net-status', async () => {
  const fallback: MeshStatusResult = {
    ok: true,
    meshEnabled: false,
    link: { reachable: false, lastError: 'net-unavailable', peers: [] },
    unlock: identityStore ? requireSignableIdentity(identityStore).unlock ?? null : null,
  };
  return await safeHandleAsync<MeshStatusResult>(async () => (await secureMesh?.status()) ?? fallback, fallback);
});

handleIpc('ccarmy:net-probe', async (_e, input: { ip?: string; port?: number; domains?: string[] } = {}) => {
  try {
    return await probeNet({
      ip: String(input.ip ?? ''),
      port: Number(input.port),
      ...(Array.isArray(input.domains) ? { domains: input.domains.map(String) } : {}),
    });
  } catch (e) {
    return { ok: false, isPublic: false, outboundOk: false, errorCode: sanitizeError(e), inboundVerified: false as const };
  }
});

handleIpc('ccarmy:net-local-address', async () => {
  const port = secureMesh?.enabled ? secureMesh.boundPort : undefined;
  return await safeHandleAsync(
    async () => await localAddressInfo(port ? { port } : {}),
    { ok: true, localIp: '127.0.0.1', interfaces: [], hasPublicInterface: false, behindNat: true }
  );
});

handleIpc('ccarmy:net-members-presence', (_e, payload: { groupId?: string } = {}) => {
  try {
    const groupId = String(payload.groupId || '');
    const members = groupId ? groupStore?.listMembers(groupId) ?? [] : [];
    const meshEnabled = !!secureMesh?.enabled;
    const liveSessions = (secureMesh?.presence() ?? []).filter((p) => p.online).length;
    const instances = p1?.instances.list() ?? [];
    return {
      ok: true,
      meshEnabled,
      // 成员表里只有 id/name/instanceId，**没有指纹** → 本机无法把人映射到指纹上。
      // 因此：本地实例用 InstanceManager 的真实状态；异地成员只给"是不是异地"，
      // online 一律不给（宁可不给，也不假装知道他在不在线）。
      presenceAvailable: meshEnabled,
      remoteSessions: liveSessions,
      members: members.map((m) => {
        const inst = m.instanceId ? instances.find((h) => h.id === m.instanceId) : undefined;
        const remote = m.source === 'invite' && !inst;
        return {
          id: m.id,
          name: m.name,
          remote,
          ...(remote
            ? { presenceBasis: 'unattributed' as const }
            : { online: inst ? inst.status === 'running' : false, presenceBasis: 'local-instance' as const }),
        };
      }),
    };
  } catch (e) {
    return { ok: false, meshEnabled: false, members: [], error: sanitizeError(e) };
  }
});

handleIpc('ccarmy:net-mesh-enable', async (_e, input: { ip?: string; port?: number; domains?: string[] } = {}) => {
  try {
    const port = Number(input.port) || 7788;
    const r = await startSecureMesh(port, { discovery: true, announce: true });
    return r.ok ? { ok: true, port: r.port, nodeId: r.nodeId, errorCode: r.errorCode } : r;
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

handleIpc('ccarmy:net-mesh-disable', async () => {
  try {
    await secureMesh?.disable();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

handleIpc('ccarmy:net-mesh-announce', async (_e, reason: 'startup' | 'address-changed' | 'manual' = 'manual') => {
  try {
    if (!secureMesh?.enabled) return { ok: false, errorCode: 'mesh-disabled' };
    return await secureMesh.announce(reason);
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

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
      // 值班者输入与 chat-send 共享同一份日志 + 同一个渲染器（不变量 #2）
      logOf: (key: string) => chatLogs.get(key) || [],
      contextBudgetChars,
      // ADR 002 §9.4 待办 2：值班者路径共用同一套工具与限额（memory-client 是唯一实现）
      toolSpecs: () => (memory?.isReady && toolLimits().maxRounds > 0 ? memoryToolSpecs(toolLabels()) : undefined),
      toolLimits,
      runTool: async (call, ctx) => {
        const t1 = Date.now();
        const out = await runMemoryTool(memory, call, { maxChars: ctx.maxResultChars });
        metrics.recordToolCall({
          ts: Date.now(),
          sessionId: msg.groupId,
          round: ctx.round,
          tool: out.meta.tool,
          ok: out.ok,
          chars: out.chars,
          ms: Date.now() - t1,
        });
        audit?.log('chat.tool', {
          sessionId: msg.groupId,
          round: ctx.round,
          tool: out.meta.tool,
          ok: out.ok,
          chars: out.chars,
          anchor: out.meta.anchor,
          error: out.meta.error,
        });
        return out.content;
      },
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
    // 写操作门禁：导出目录是共享产物，先拿租约再写
    const guarded = withLease('exports', ['exports'], () => {
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
      return file;
    });
    if (!guarded.ok) {
      return { ok: false, error: 'lease-denied', errorCode: guarded.errorCode, reason: guarded.reason, conflicts: guarded.conflicts };
    }
    return { ok: true, path: guarded.value };
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
