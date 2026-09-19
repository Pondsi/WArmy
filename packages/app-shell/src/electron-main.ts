/**
 * Electron 主进程 — 零原生模块
 * 注意：Windows 中文路径下 fork 子进程可能乱码，memory ipc 先拷到 userData（ASCII）
 */
import { app, BrowserWindow, ipcMain, Menu, dialog, nativeTheme, Tray, nativeImage, globalShortcut } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { execFile, execFileSync, spawn } from 'node:child_process';
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
import { GroupChatRouter, DEFAULT_PERMISSIONS } from '@warmy/group-router';
import { BoardStore, parseBoardCommand } from '@warmy/board';
import {
  createProviderFromPreset,
  chatWithTools,
  providerSupportsTools,
  type ChatMessage,
  type ChatRequest,
  type ModelProvider,
  type ToolLoopResult,
  type ToolSpec,
} from '@warmy/providers';
import { CcrGateway } from '@warmy/ccr-compressor';
import { KnowledgeBase } from '@warmy/knowledge-base';
import { CheckpointStore } from './checkpoint.js';
import { AuditLogger } from './audit.js';
import { SecureKeyStore } from './secure-keys.js';
import { KnowledgeArchiver, CleanupManager, extractKnowledgeFromArchive, mergeUserPreferences, extractStructuredSummary } from './archive-cleanup.js';
import { pickModelForUrgency, pickEmbeddingModel, type RoleModelConfig } from './model-roles.js';
import { orchestrateGroupMessage, buildStatusCard } from './orchestrator.js';
import { projectMemoryForContext, readProjectMemory, writeProjectMemory } from './project-memory.js';
import { AiQuestionHub, AI_QUESTION_CUSTOM } from './ai-questions.js';
import { withReadBack, dedupeByNorm, normPathKey } from './read-back.js';
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
import { LocalAccountStore, SettingsStore, generateDeviceId, type AppSettings, WARMY_DEFAULT_NET_PORT, SKILL_SCAN_DIRS_MAX,} from './settings-store.js';
/**
 * 执行环境探测器（ADR 004）：探测本机**已有**的容器运行时 + 驱动其启停。
 * 纯 node 模块（不依赖 electron），因此可以被 scripts/verify-container-probe.mjs 在真机上直接断言。
 */
import {
  probeContainerRuntimes,
  runContainerAction,
  lastContainerProbeReport,
  containerRuntimeSpec,
  CONTAINER_SHELL_SECURITY,
  containerShellGate,
  normalizeContainerShellRequest,
  projectReasonKey,
  projectUnavailableRefusal,
  deriveProjectState,
  envSolidifyCapability,
  engineOsModeOf,
  shouldSolidifyAt,
  solidifyRetention,
  SOLIDIFY_KEEP,
  SOLIDIFY_COALESCE_MS,
  CONTAINER_BASE_IMAGES,
  /* ── 第十六批：真实的容器内执行 / 固化 / 回滚 / 宿主目录加锁 ── */
  runContainerExec,
  containerProjectName,
  isValidContainerProjectName,
  solidifiedImageRef,
  isAllowedImageRef,
  CONTAINER_PROJECT_MOUNT,
  CONTAINER_EXEC_SECURITY,
  CONTAINER_FIXED_COMMAND_IDS,
  ENV_SOLIDIFY_SECURITY,
  openContainerShellSession,
  writeContainerShellSession,
  closeContainerShellSession,
  closeContainerShellSessionsOf,
  hostDirGuardPlan,
  HOST_DIR_GUARD_SECURITY,
  isUserSid,
  type ContainerFixedCommandId,
  type ContainerProjectState,
} from './container-probe.js';
import { IdentityStore, type MembershipStore } from './identity-store.js';
import {
  CONTACT_CARD_I18N,
  CONTACT_FREEZE_NOTE,
  GENERATION_RULE_NOTE,
  fingerprintMatches,
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
/**
 * ADR 004 第十六批：**工具文件访问台账**的接线。
 * helper-tool 之前**只写文件、不记路径** —— 这就是"最近改动文件"那块面板长期空态的原因之一。
 * 现在它的每一次真实读写都通过 sink 落到**项目记录**里（项目级、成员可见），
 * **不是**落到本机设置里（产品主：记录文件的改动是无限牛马的功能，不是本机的功能）。
 */
import { setFileAccessSink, withFileAccessScope, currentFileAccessScope } from './helper-tool.js';
import { NodeRegistry, SyncBus, createInvite, consumeInvite } from '@warmy/sync-protocol';
import { findDshPackageDir, ensureDshProfile, writeDshInstanceEntry } from '@warmy/dsh-runtime';
// 组网：**鉴权通道**（SecureSyncServer/Client + 名册 + 持久化重放防护），旧 lan.ts/mesh.ts 只留数据层 PeerRegistry
import { PeerRegistry } from '@warmy/sync-protocol';
import {
  NET_NOTES,
  SecureMesh,
  discoverPublicIp,
  ensureNetDir,
  listLocalAddresses,
  localAddressInfo,
  pickPortCandidates,
  probeNet,
  secureLoopbackSmoke,
  tcpProbe,
  /* ── ADR 004 第十六批：**项目级属性**的跨机同步（记录文件的改动是产品功能） ── */
  PROJECT_ATTRS_CHANNEL,
  PROJECT_ATTRS_KIND,
  projectAttrsMessage,
  parseProjectAttrsMessage,
  projectAttrsToStateInput,
  projectInboundGate,
  type MeshPeerRef,
  type MeshStatusResult,
  type ReachabilityHint,
  type SecureInboundMessage,
} from './net-wiring.js';
// 身份 ↔ 组网的唯一接缝：指纹推导 + 签名者注入 + 「能否后台签名」的门控
import {
  IdentityUnavailableError,
  applyInboundRevocationUpdate,
  assertDerivationMatches,
  buildIdentityChangeEntries,
  buildMemberPresence,
  createIdentityProvider,
  createIdentitySigner,
  explainRosterDecision,
  fingerprintDerivationForAppShell,
  issueMemberCertificate,
  knownContactFingerprints,
  listPeerContactViews,
  membershipFileFor,
  membershipSnapshot,
  membershipStoreFor,
  peerContactKeys,
  requireSignableIdentity,
  revokeMemberCertificate,
  rotateMemberCertificate,
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
import { resolveLocale, SUPPORTED_LOCALES } from './i18n/locales.js';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bootLog = path.join(app.getPath('userData'), 'warmy-boot.log');

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
  const f = resolveLocale(locale);
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
const aiQuestions = new AiQuestionHub();

/** 按项目类型自动选择 gateVerify（授权由产品主授予；防过度执行） */
function gateVerifyForProjectType(opts: { directory?: string; devEnv?: string; name?: string }): string[] {
  const dir = String(opts.directory || '').replace(/\\/g, '/');
  const name = String(opts.name || '');
  const hay = `${name} ${dir}`.toLowerCase();
  const isDocsOnly = /(^|[^a-z])(docs?|说明|readme|spec|adr|手册|guide)([^a-z]|$)/i.test(hay) &&
    !/(packages\/|src\/|node_modules|\.ts$|\.js$|\.py$|api|backend|frontend)/i.test(hay);
  const isCode =
    /package\.json|tsconfig|pyproject|cargo\.toml|go\.mod|pom\.xml|build\.gradle/i.test(dir) ||
    /(packages\/|src\/|backend|frontend|server|client|api|repo|monorepo)/i.test(hay) ||
    /code|开发|dev[-_]?env|工程/i.test(name) ||
    /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|cs|cpp|c|h)$/i.test(dir);
  const base = [
    'packages/app-shell/scripts/verify-docs.mjs',
    'packages/app-shell/scripts/verify-i18n-locales.mjs',
  ];
  if (isDocsOnly) return ['packages/app-shell/scripts/verify-docs.mjs'];
  if (isCode) {
    return [
      ...base,
      'packages/app-shell/scripts/verify-router-queue.mjs',
      'packages/app-shell/scripts/verify-memory.mjs',
    ];
  }
  return base;
}

/** 新项目默认门禁（授权由产品主授予；只跑轻量文档/一致性检查，防过度执行） */
const DEFAULT_GATE_VERIFY = [
  'packages/app-shell/scripts/verify-docs.mjs',
  'packages/app-shell/scripts/verify-i18n-locales.mjs',
];
const router = new GroupChatRouter({
  queueWhenFixedBusy: false,
  onQueueMutated: () => {
    persistRouterQueues();
  },
});

/**
 * Router 队列持久化（userData/router-queues.json）。
 * 产品口径：队列是用户待办，**进程退出不得丢**；"弹出即丢弃"的旧实现已废弃。
 */
const ROUTER_QUEUES_VERSION = 1;
function routerQueuesFile(): string {
  try {
    return path.join(app.getPath('userData'), 'router-queues.json');
  } catch {
    return '';
  }
}
function persistRouterQueues(): void {
  const file = routerQueuesFile();
  if (!file) return;
  try {
    writeJsonAtomicSafe(file, router.serializeState());
  } catch {
    /* 落盘失败不影响运行 */
  }
}
function restoreRouterQueues(): void {
  const file = routerQueuesFile();
  if (!file) return;
  try {
    const snap = readJsonFile<{ version?: number } | null>(file, null);
    if (snap && (snap as { version?: number }).version === ROUTER_QUEUES_VERSION) {
      router.restoreState(snap as never);
    }
  } catch {
    /* 损坏快照：从空队列开始，不崩溃 */
  }
}

/** 渲染层「待执行队列」落盘（userData/ui-queues.json）—— 与 Router 队列分开，语义不同 */
function uiQueuesFile(): string {
  try {
    return path.join(app.getPath('userData'), 'ui-queues.json');
  } catch {
    return '';
  }
}
function persistUiQueues(queues: Record<string, unknown>): void {
  const file = uiQueuesFile();
  if (!file) return;
  try {
    writeJsonAtomicSafe(file, { version: 1, savedAt: Date.now(), queues });
  } catch {
    /* ignore */
  }
}
function restoreUiQueues(): Record<string, unknown> {
  const file = uiQueuesFile();
  if (!file) return {};
  try {
    const snap = readJsonFile<{ version?: number; queues?: Record<string, unknown> } | null>(file, null);
    if (snap && snap.version === 1 && snap.queues && typeof snap.queues === 'object') return snap.queues;
  } catch { /* ignore */ }
  return {};
}
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
      // T194：工具调用开始（只给工具名/轮次/会话 —— 不给参数与结果正文）
      const toolName = String((call && call.function && call.function.name) || 'tool');
      emitConsole({ cat: 'tool', code: 'tool.start', data: { tool: toolName, round: ctx.round, sessionId } });
      // 工具里对文件做过的真实读写都记到**这个项目**的台账上（scope = 会话 id）
      const out = await withFileAccessScope(sessionId, () => runMemoryTool(memory, call, { maxChars: ctx.maxResultChars }));
      metrics.recordToolCall({
        ts: Date.now(),
        sessionId,
        round: ctx.round,
        tool: out.meta.tool,
        ok: out.ok,
        chars: out.chars,
        ms: Date.now() - t1,
      });
      // T194：工具调用结束（结论 + 字节数 + 耗时）
      emitConsole({
        cat: 'tool',
        code: 'tool.finish',
        data: { tool: out.meta.tool || toolName, round: ctx.round, sessionId, ok: out.ok, chars: out.chars, ms: Date.now() - t1 },
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
/** 由百分比 → 实际字符预算；并保证不低于最小可用 token（约 2048） */
const MIN_CONTEXT_TOKENS = 2048;
const CHARS_PER_TOKEN_EST = 1.6;
/** 已知模型上下文窗口（token）；settings.modelContextTokens 可覆盖 */
const MODEL_CTX_MAP: Record<string, number> = {
  'deepseek-chat': 65536,
  'deepseek-reasoner': 65536,
  'mimo-v2.5-pro': 131072,
  'mimo-v2.5': 131072,
  'qwen3.7-max': 131072,
  'qwen3.8-27b': 32768,
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'claude-3-5-sonnet': 200000,
};
function modelWindowTokens(modelId?: string): number | null {
  if (!modelId) return null;
  const m = String(modelId).trim();
  return MODEL_CTX_MAP[m] || MODEL_CTX_MAP[m.split('/').pop() || ''] || null;
}
function contextBudgetFromSettings(modelId?: string): { chars: number; percent: number; tokens: number; maxTokens: number; minPercent: number } {
  let percent = 60;
  let maxTokens = 32768;
  try {
    const mw = modelWindowTokens(modelId);
    if (mw && mw >= 4096) maxTokens = mw;

    const s = settingsStore?.load();
    const p = Number(s?.contextBudgetPercent);
    if (Number.isFinite(p)) percent = Math.min(90, Math.max(10, Math.round(p)));
    const m = Number(s?.modelContextTokens);
    if (Number.isFinite(m) && m >= 4096) maxTokens = m;
  } catch { /* 用默认 */ }
  const minPercent = Math.min(90, Math.ceil((MIN_CONTEXT_TOKENS / maxTokens) * 100));
  const effPercent = Math.max(percent, minPercent);
  const tokens = Math.max(MIN_CONTEXT_TOKENS, Math.round((effPercent / 100) * maxTokens));
  const chars = Math.max(200, Math.round(tokens * CHARS_PER_TOKEN_EST));
  return { chars, percent: effPercent, tokens, maxTokens, minPercent };
}

const CONTEXT_RETRY_STEPS = [1.0, 0.6, 0.35, 0.2];
function isContextLengthError(err: unknown): boolean {
  const s = String((err as Error)?.message || err || '');
  return /context|token|too long|maximum length|context_length|maximum context/i.test(s);
}
function budgetCharsForStep(baseChars: number, step: number): number {
  return Math.max(Math.round(MIN_CONTEXT_TOKENS * CHARS_PER_TOKEN_EST), Math.round(baseChars * step));
}

/**
 * 上下文超限时自动收缩重试：100% → 60% → 35% → 20%（相对基础预算）。
 * 群聊等无滑块场景由后台自动判断；到最小值仍失败则如实告知用户，不再无限重试。
 */
async function runWithContextRetry<T>(
  baseChars: number,
  fn: (budgetChars: number) => Promise<T>,
  isCtxErr: (e: unknown) => boolean = isContextLengthError
): Promise<{ result: T; usedBudget: number; retries: number; gaveUp?: string }> {
  let lastErr: unknown;
  let retries = 0;
  for (let i = 0; i < CONTEXT_RETRY_STEPS.length; i++) {
    const budget = budgetCharsForStep(baseChars, CONTEXT_RETRY_STEPS[i]!);
    try {
      const result = await fn(budget);
      return { result, usedBudget: budget, retries };
    } catch (e) {
      lastErr = e;
      if (!isCtxErr(e)) throw e;
      retries += 1;
    }
  }
  const msg = String((lastErr as Error)?.message || lastErr || 'context-too-small');
  return {
    result: { ok: false, error: msg, contextTooSmall: true, retries } as unknown as T,
    usedBudget: budgetCharsForStep(baseChars, CONTEXT_RETRY_STEPS[CONTEXT_RETRY_STEPS.length - 1]!),
    retries,
    gaveUp: msg,
  };
}

function contextBudgetChars(modelId?: string): number {
  try {
    const v = Number(settingsStore?.load()?.contextBudgetChars) || contextBudgetFromSettings(modelId).chars;
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
function renderChatView(key: string, recallHint?: string, budgetCharsOverride?: number) {
  const view = renderBoundedView(chatLogs.get(key) || [], {
    budgetChars: Number.isFinite(budgetCharsOverride as number) ? Number(budgetCharsOverride) : contextBudgetChars(),
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
  candidates.push({ p: process.env['WARMY_NODE'] || process.env['CCARM_NODE'] || '', source: process.env['WARMY_NODE'] ? 'env:WARMY_NODE' : (process.env['CCARM_NODE'] ? 'env:CCARM_NODE(legacy)' : 'env:WARMY_NODE') });
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
    path.join(app.getAppPath(), 'node_modules', '@warmy', 'memory-os', 'dist'),
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
        win?.webContents.send('warmy:approval-request', { id, action: req.action, suggested: req.suggested });
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
  /**
   * ADR 004 第十六批：把 helper-tool 的文件访问记录接到**项目台账**上。
   * 产品主的原话：**「记录文件的改动应该是无限牛马的功能，不是本机的功能」**
   *  ⇒ 记进**项目记录**（`groups.json` 里的项目台账），随项目同步给成员；
   *  没有作用域（不属于任何一个项目）时**什么都不记** —— 绝不退化成"本机设置里的一份日志"。
   */
  setFileAccessSink((sessionId, entry) => {
    try {
      const gid = String(sessionId || '');
      if (!gid || !groupStore) return;
      const r = groupStore.recordFileAccess(gid, entry);
      if (r.ok) void publishProjectAttrs(gid);
    } catch {
      /* 记账失败不影响真实文件操作 */
    }
  });
  updater = new Updater({
    currentVersion: appVersion(),
    downloadDir: path.join(userData, 'updates'),
    getSettings: () => settingsStore?.load() ?? null,
    env: process.env,
    userAgent: `WArmy/${appVersion()} (${process.platform}; ${process.arch})`,
    log: (msg) => boot(`updater: ${msg}`),
  });
  sweepTempFiles(path.join(userData, 'updates'));
  restoreGroups();
  // 群骨架恢复之后再灌队列快照（否则 createGroup 会把 queues Map 清空）
  restoreRouterQueues();
  boot(`router queues restored file=${routerQueuesFile() || 'n/a'}`);
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
  // ── 成员证书 / 吊销列表（ADR §附八.8）：先"热身"建好带审计回调的实例 ──
  // ⚠️ 顺序有讲究：`membershipStoreFor` 按 IdentityStore 实例缓存，第一次调用决定它有没有审计回调；
  // 这里先建，后续所有调用点（名册/在线态/IPC）都拿到同一个带审计的实例，
  // 证书签发/拒收、吊销应用/拒绝都会落到审计日志（audit 已在上面初始化）。
  {
    const ms = membershipStoreFor(identityStore, { onAudit: (op, detail) => audit?.log(op, detail) });
    const sum = ms?.summary();
    if (sum) boot(`membership ready groups=${sum.groupCount} certs=${sum.certCount} revoked=${sum.revokedCount}`);
  }
  // ── 租约表（本体协作层）：写操作的唯一仲裁者 ──
  leases = new LeaseRegistry({ idPrefix: 'warmy' });
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
    onInbound: (msg) => {
      boot(`mesh inbound ${msg.channel} from ${msg.peerFingerprint.slice(0, 12)}`);
      // 成员证书 / 吊销列表的**同步落点**：对端指纹来自握手（msg.peerFingerprint），
      // 不是消息体自称 —— 只有本群创建者发来的吊销列表才会被接受。
      const payload = msg.payload as { type?: string; groupId?: string; list?: unknown } | null;
      /**
       * ADR 004 第十六批：**项目属性 / 可用性信号的落点**（成员侧）。
       * 「记录文件的改动是产品功能」这条要求的另一半就在这：异地成员收到的项目属性
       * 写进本地项目记录 ⇒ 成员的 UI 能看到"这是容器项目 + 创建者那边为什么不可用"，
       * 并**复用既有「创建者离线」那一套**（不新造第三种状态）。
       * 纪律：只接受**校验通过**的消息（不认识就如实拒绝），且**只补创建者指纹、绝不覆盖**。
       */
      if (msg.channel === PROJECT_ATTRS_CHANNEL && (msg.payload as { kind?: unknown } | null)?.kind === PROJECT_ATTRS_KIND) {
        const parsed = parseProjectAttrsMessage(msg.payload);
        if (!parsed.ok) {
          audit?.log('project.attrs.inbound', { ok: false, code: parsed.error });
          boot(`project attrs inbound rejected: ${parsed.error}`);
        } else {
          const v = parsed.value;
          // 指纹用**握手**得到的那个（消息体自称的不采信），只在本地还不知道创建者时补上
          const apply = groupStore?.applyProjectSync(v.groupId, {
            ...(v.name ? { name: v.name } : {}),
            ...(v.type ? { type: v.type } : {}),
            project: {
              devEnv: v.project.devEnv,
              runtimeId: v.project.runtimeId,
              disabledAt: v.project.disabledAt,
              ...(v.project.directory ? { directory: v.project.directory } : {}),
              ...(v.project.directorySource ? { directorySource: v.project.directorySource } : {}),
              ...(v.project.env ? { env: v.project.env } : {}),
            },
            creatorFingerprint: msg.peerFingerprint,
          });
          // 台账尾部：**项目级、成员可见**（去重由 store 负责；只记路径/操作/时间）
          let ledgerAdded = 0;
          if (apply && apply.ok && Array.isArray(v.ledgerTail) && groupStore) {
            for (const e2 of v.ledgerTail) {
              if (!e2.path || !e2.op) continue;
              const r = groupStore.recordFileAccess(v.groupId, {
                op: (['read', 'write', 'edit', 'create', 'delete', 'backup', 'restore'].includes(e2.op) ? e2.op : 'write') as never,
                path: e2.path, ts: e2.ts || Date.now(), ok: e2.ok !== false, by: e2.by || 'remote',
                ...(e2.bytes ? { bytes: e2.bytes } : {}),
              });
              if (r.ok) ledgerAdded++;
            }
          }
          /**
           * 成员侧入站门控：项目不可用 ⇒ 挂到**创建者离线**那一档（同一句既有文案）。
           * 这里只把结论记进审计/事件流；真正的"拒绝入站"由群消息处理路径用它判定。
           */
          if (!projectAttrsAreRemote(v.groupId)) {
            // 本机就是创建者：自己的信号回声，忽略（不要用对端的值覆盖本机事实）
            audit?.log('project.attrs.inbound', { groupId: v.groupId, ok: true, echo: true, ledgerAdded });
          } else {
            const gate = projectInboundGate({
              running: v.availability.availability === 'available' && v.project.disabledAt === 0,
              code: v.project.disabledAt > 0 ? 'disabled-by-owner' : (v.availability.code || 'container-not-ready'),
            });
            audit?.log('project.attrs.inbound', { groupId: v.groupId, ok: true, queue: gate.queue, ledgerAdded });
            if (!gate.allow) {
              emitConsole({ cat: 'net', code: 'project.inbound.queued', data: { groupId: v.groupId, projectCode: gate.projectCode, memberFaceKey: gate.memberFaceKey } });
            }
            boot(`project attrs inbound ${v.groupId} allow=${gate.allow} code=${gate.projectCode} ledger+${ledgerAdded}`);
          }
          emitConsole({ cat: 'system', code: 'project.attrs.applied', data: { groupId: v.groupId, devEnv: v.project.devEnv } });
        }
      }
      if (payload && payload.type === 'warmy.membership.revocation') {
        const gid = String(payload.groupId || msg.groupId || '');
        const membership = membershipStoreFor(identityStore);
        const expect = expectedIssuerFor(gid);
        const r = applyInboundRevocationUpdate({
          membership: membership as MembershipStore,
          groupId: gid,
          list: payload.list as never,
          fromFingerprint: msg.peerFingerprint,
          ...(expect ? { expectedIssuerFingerprint: expect } : {}),
        });
        audit?.log('membership.revocation.inbound', { groupId: gid, ok: r.ok, code: r.code, changed: r.changed ?? false });
        boot(`membership revocation inbound ok=${r.ok} code=${r.code}`);
      }
    },
    onEvent: (ev) => {
      if (ev.type === 'handshake-ok' || ev.type === 'offline') boot(`mesh ${ev.type} ${ev.peer ?? ''}`);
      // T194：对端会话上下线 / 握手 / 局域网发现 —— 组网层的**真实**事件，直接进控制台。
      // 这里**只**推手指纹（peer）与方向/原因（detail），不推消息正文。
      switch (ev.type) {
        case 'session':
          emitConsole({ cat: 'net', code: 'net.peer-up', data: { peer: ev.peer, detail: ev.detail } });
          break;
        case 'online':
          emitConsole({ cat: 'net', code: 'net.peer-online', data: { peer: ev.peer } });
          break;
        case 'offline':
          emitConsole({ cat: 'net', code: 'net.peer-down', data: { peer: ev.peer, detail: ev.detail } });
          break;
        case 'handshake-ok':
          emitConsole({ cat: 'net', code: 'net.handshake-ok', data: { peer: ev.peer } });
          break;
        case 'discovered':
          emitConsole({ cat: 'net', code: 'net.discovered', data: { peer: ev.peer, detail: ev.detail } });
          break;
        default:
          emitConsole({ cat: 'net', code: 'net.event', data: { type: String(ev.type || ''), detail: ev.detail } });
          break;
      }
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
    groupStore?.addMemberWithFingerprint(
      groupId,
      { name: inst.name, role: 'member', source: 'instance', instanceId: inst.id },
      { onAudit: (op, detail) => audit?.log(op, detail) }
    );
  }
}

/** 把路由里已有但成员表没有的成员补进持久化（幂等） */
function syncMembersFromRouter(groupId: string): void {
  if (!groupStore) return;
  const g = router.getGroup(groupId);
  if (!g) return;
  for (const m of router.listMembers(groupId)) {
    groupStore.addMemberWithFingerprint(
      groupId,
      { name: m.name, role: 'member', source: 'instance', instanceId: m.id },
      { onAudit: (op, detail) => audit?.log(op, detail) }
    );
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

function windowStateFile(): string {
  try { return path.join(app.getPath('userData'), 'window-state.json'); } catch { return ''; }
}
function loadWindowState(): { width?: number; height?: number; x?: number; y?: number; maximized?: boolean } {
  const f = windowStateFile();
  if (!f) return {};
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf8')) || {};
    const out: { width?: number; height?: number; x?: number; y?: number; maximized?: boolean } = {};
    if (Number(j.width) >= 960) out.width = Math.round(Number(j.width));
    if (Number(j.height) >= 600) out.height = Math.round(Number(j.height));
    // 位置：只接受落在可见屏幕内的 x/y，避免显示器变更后窗口跑到屏幕外
    if (Number.isFinite(Number(j.x)) && Number.isFinite(Number(j.y))) {
      try {
        const { screen } = require('electron');
        const b = { x: Number(j.x), y: Number(j.y), width: out.width || 1280, height: out.height || 800 };
        const area = screen.getDisplayMatching(b).workArea;
        const visible = b.x < area.x + area.width - 40 && b.y < area.y + area.height - 40 && b.x + 80 > area.x && b.y + 40 > area.y;
        if (visible) { out.x = Math.round(Number(j.x)); out.y = Math.round(Number(j.y)); }
      } catch { /* 无 screen 时忽略位置 */ }
    }
    if (j.maximized === true) out.maximized = true;
    return out;
  } catch { return {}; }
}
let windowSaveTimer: NodeJS.Timeout | null = null;
function saveWindowStateSoon(delay = 500): void {
  if (windowSaveTimer) clearTimeout(windowSaveTimer);
  windowSaveTimer = setTimeout(() => {
    windowSaveTimer = null;
    const f = windowStateFile();
    if (!f || !win || win.isDestroyed()) return;
    try {
      const maximized = win.isMaximized();
      const b = maximized ? (win as unknown as { getNormalBounds?: () => { x: number; y: number; width: number; height: number } }).getNormalBounds?.() || win.getBounds() : win.getBounds();
      const out = { x: b.x, y: b.y, width: b.width, height: b.height, maximized };
      writeJsonAtomicSafe(f, out);
    } catch { /* 忽略 */ }
  }, delay);
}

function createWindow() {
  const isMac = process.platform === 'darwin';
  const ws = loadWindowState();
  win = new BrowserWindow({
    width: ws.width || 1280,
    height: ws.height || 800,
    ...(Number.isFinite(ws.x as number) && Number.isFinite(ws.y as number) ? { x: ws.x, y: ws.y } : {}),
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
    if (ws.maximized) { try { win?.maximize(); } catch { /* noop */ } }
    win?.show();
    boot(`window ready platform=${process.platform}`);
  });
  win.on('resize', () => saveWindowStateSoon());
  win.on('move', () => saveWindowStateSoon());
  win.on('maximize', () => saveWindowStateSoon(200));
  win.on('unmaximize', () => saveWindowStateSoon(200));
  // 点击叉 = 最小化到托盘，不关闭窗口。只有托盘「下班」才真正退出。
  win.on('close', (e) => {
    try { saveWindowStateSoon(0); } catch { /* noop */ }
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
 * 统一 IPC 收口：所有 `warmy:*` 通道自动获得
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
      // T194：IPC 处理器抛出的异常 = "已处理失败"里最典型的一类，推进控制台（只推频道名 + 脱敏摘要）
      emitConsole({ cat: 'error', code: 'err.ipc', data: { channel, message: sanitizeError(e) } });
      throw new Error(sanitizeError(e));
    }
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   T194：控制台事件流（主进程 → 渲染层，**推送**不是轮询）
   ---------------------------------------------------------------------------
   推什么：工具调用开始/结束、组网事件（开/关/端口绑定失败/对端会话上下线/发现）、
          错误（未捕获 + 已处理失败）。
   推什么形状：{ seq, ts, cat, code, data }。**文案不在这里拼** —— i18n 全在渲染层，
   主进程只给结构化事实（工具名/端口/错误码/毫秒数），渲染层按 code 取文案。
   安全：推送内容一律只含"事件元数据"（工具名、端口、errno、频道名、脱敏后的错误首行），
         **不带** API Key / token / 消息正文 / 文件路径；渲染层还会再打一遍码（双保险）。
   seq 单调递增：渲染层据此去重（窗口重建/重复投递不会刷屏）。
   ══════════════════════════════════════════════════════════════════════════ */
let consoleSeq = 0;
function emitConsole(ev: { cat: 'tool' | 'net' | 'error' | 'system'; code: string; data?: Record<string, unknown> }): void {
  try {
    const payload = { seq: ++consoleSeq, ts: Date.now(), cat: ev.cat, code: ev.code, data: ev.data || {} };
    for (const w of BrowserWindow.getAllWindows()) {
      try {
        if (!w.isDestroyed()) w.webContents.send('warmy:console-event', payload);
      } catch {
        /* 窗口正在销毁：控制台丢一行不影响主流程 */
      }
    }
  } catch {
    /* 控制台推送绝不冒泡到调用方 */
  }
}

/** 未捕获异常 / 未处理的 Promise 拒绝：如实进控制台。用 Monitor 版本，**不**改变默认崩溃语义。 */
process.on('uncaughtExceptionMonitor', (err) => {
  try {
    emitConsole({ cat: 'error', code: 'err.uncaught', data: { message: sanitizeError(err) } });
  } catch {
    /* noop */
  }
});
process.on('unhandledRejection', (reason) => {
  try {
    emitConsole({ cat: 'error', code: 'err.unhandled-rejection', data: { message: sanitizeError(reason) } });
  } catch {
    /* noop */
  }
});


// 应用身份：影响任务栏悬停/右键菜单里显示的名称（默认会显示 Electron）
app.setName('无限牛马');
if (process.platform === 'win32') app.setAppUserModelId('com.pondsi.warmy');

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
  // 退出前再落一次盘，避免内存变更没跟上文件
  try {
    persistRouterQueues();
  } catch { /* ignore */ }
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

/** 渲染层「待执行队列」持久化 IPC（重启后不丢 P2/P3 待办） */
handleIpc('warmy:ui-queues-get', async () => {
  try {
    return { ok: true, queues: restoreUiQueues() };
  } catch (e) {
    return { ok: false, error: sanitizeError(e), queues: {} };
  }
});
handleIpc('warmy:ui-queues-set', async (_e, payload?: { queues?: Record<string, unknown> }) => {
  try {
    const q = payload?.queues;
    if (!q || typeof q !== 'object') return { ok: false, error: 'queues must be an object' };
    persistUiQueues(q as Record<string, unknown>);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});
/** Router 队列只读快照（诊断/巡检用） */
handleIpc('warmy:router-queues-get', async () => {
  try {
    persistRouterQueues();
    return { ok: true, snapshot: router.serializeState(), file: routerQueuesFile() };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

handleIpc('warmy:hardware', () => safeHandle(() => p1?.instances.hardwareAdvice(), null));
handleIpc('warmy:list-instances', () => safeHandle(() => p1?.instances.list() ?? [], []));
handleIpc(
  'warmy:spawn-instance',
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
handleIpc('warmy:stop-instance', async (_e, id: string) => {
  try {
    await p1?.instances.stop(id);
    return true;
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});
handleIpc('warmy:security-mode', () => safeHandle(() => p1?.security.getMode(), 'normal'));
handleIpc(
  'warmy:set-security-mode',
  async (_e, mode: 'full' | 'normal' | 'strict') => {
    await p1?.security.setMode(mode);
    return p1?.security.getMode();
  }
);
handleIpc('warmy:memory-recall', async (_e, payload?: string | { query?: string; limit?: number; scope?: Record<string, string> }) => {
  try {
    if (!memory) return { cards: [], error: 'memory-unavailable' };
    const q = typeof payload === 'string' ? payload : String(payload?.query || '');
    const limit = typeof payload === 'object' && payload?.limit ? Number(payload.limit) : 10;
    const scope = typeof payload === 'object' ? payload?.scope : undefined;
    return await memory.recallScoped(q, limit, scope);
  } catch (e) {
    return { cards: [], error: sanitizeError(e) };
  }
});
handleIpc('warmy:memory-append', async (_e, body: string) => {
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
handleIpc('warmy:memory-retrieve', async (_e, payload?: { seq?: number; recordId?: string }) => {
  try {
    if (!memory) return { ok: false, error: 'memory-unavailable' };
    return await memory.retrieve({ seq: payload?.seq, recordId: payload?.recordId });
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});
handleIpc('warmy:memory-status', async () => {
  try {
    const ready = !!(memory?.isReady);
    let vector: unknown = null;
    let stats: unknown = null;
    if (ready) {
      try { vector = await memory!.vectorStatus(); } catch { vector = { ok: false }; }
      try { stats = await memory!.stats(); } catch { stats = null; }
    }
    return {
      ok: true,
      ready,
      dataDir: path.join(app.getPath('userData'), 'memory'),
      jsonl: path.join(app.getPath('userData'), 'memory', 'fast-memory.jsonl'),
      vector,
      stats,
      historyRestore,
    };
  } catch (e) {
    return { ok: false, ready: false, error: sanitizeError(e) };
  }
});
handleIpc('warmy:memory-rebuild', async () => {
  try {
    if (!memory?.isReady) return { ok: false, error: 'memory-unavailable' };
    const r = await memory.rebuildProjection();
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

// ── i18n：文案全部在独立 json，中文产品名「无限牛马」，其余「WArmy」 ──
function i18nDir(): string {
  const candidates = [
    path.join(__dirname, 'i18n'),
    path.join(__dirname, '..', 'src', 'i18n'),
  ];
  const found = candidates.find((d) => fs.existsSync(path.join(d, 'zh-CN.json')));
  return found ?? candidates[0]!;
}

handleIpc('warmy:i18n', (_e, locale: string) => {
  // Resolve to any of the 10 supported packs — never collapse to zh-CN/en-US only.
  const loc = resolveLocale(locale);
  const file = path.join(i18nDir(), `${loc}.json`);
  let strings: Record<string, string> = {};
  try {
    strings = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    strings = {};
  }
  // Trust the pack's own brand strings (ja=無限社畜 WArmy, ko=무한 사축 WArmy, zh=无限牛马, else WArmy).
  if (!strings['app.displayName']) {
    strings['app.displayName'] =
      strings['brand.name'] ||
      (loc === 'zh-CN' || loc === 'zh-TW' ? strings['app.zhName'] || '无限牛马' : strings['app.enName'] || 'WArmy');
  }
  // Non-Chinese packs may still list zh name in copyright context; UI display uses displayName.
  win?.setTitle(strings['app.displayName'] || 'WArmy');
  return { locale: loc, strings, displayName: strings['app.displayName'], supported: SUPPORTED_LOCALES };
});

handleIpc('warmy:locale-info', () =>
  safeHandle(
    () => {
      const sys = app.getLocale();
      return { system: sys, resolved: resolveLocale(sys), isZh: sys.startsWith('zh'), supported: SUPPORTED_LOCALES };
    },
    { system: 'zh-CN', resolved: 'zh-CN', isZh: true, supported: SUPPORTED_LOCALES },
  ),
);

// ── 主题 ──
handleIpc('warmy:set-theme-source', (_e, source: 'system' | 'light' | 'dark') => {
  try {
    nativeTheme.themeSource = source === 'system' ? 'system' : source;
    return { shouldUseDarkColors: nativeTheme.shouldUseDarkColors, themeSource: nativeTheme.themeSource };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});
handleIpc('warmy:theme-info', () => safeHandle(() => ({ shouldUseDarkColors: nativeTheme.shouldUseDarkColors, themeSource: nativeTheme.themeSource }), { shouldUseDarkColors: false, themeSource: 'system' }));

// ── 拉取供应商模型列表（OpenAI 兼容 /models） ──
handleIpc(
  'warmy:list-models',
  async (_e, cfg: { protocol: string; baseURL: string; apiKey?: string }) => {
    try {
      const { createProvider } = await import('@warmy/providers');
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
handleIpc('warmy:pick-sound', async () => {
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
handleIpc('warmy:check-update', async () =>
  safeHandleAsync<UpdateCheckResult>(
    async () => (updater ? await updater.check() : updaterUnavailableCheck(appVersion())),
    updaterUnavailableCheck(appVersion())
  )
);

// ── 选择附件文件 ──
handleIpc('warmy:pick-file', async (_e, opts?: { filters?: string[] }) => {
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
  'warmy:group-create',
  (_e, cfg: { groupId: string; name: string; type: 'internal' | 'external'; directedMode?: boolean; devEnv?: 'host' | 'container'; directory?: string }) => {
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
        // 本机建的群 = 本机身份是创建者（成员证书的签发者就是它）。
        // 拿不到身份时**不填**（留空 = 未知），上层会退回"首次收到的签发者即群主"。
        ...(identityStore?.info()?.fingerprint ? { creatorFingerprint: String(identityStore.info()?.fingerprint) } : {}),
      });
      if (saved && !saved.ok) return { ok: false, error: 'cannot persist group' };
      /**
       * ADR 004（第十六批）：**创建时选的开发环境写进项目记录**（项目级、随项目同步给成员）。
       * 之前这一步是写本机 `settings.containerDev` —— 于是异地成员永远看不到
       * "这是一个容器开发项目"（产品主指出的正是这件事）。
       * 这里还顺手把创建者的身份指纹记为**上报者**，成员侧据此判断"这是创建者说的"。
       */
      // 项目属性：开发环境/目录/gateVerify 一律在创建时写入（不依赖 devEnv 是否填了）
      setProjectAttrsOf(cfg.groupId, {
        ...(cfg.devEnv === 'container' || cfg.devEnv === 'host' ? { devEnv: cfg.devEnv } : {}),
        ...(cfg.directory && fs.existsSync(cfg.directory) ? { directory: cfg.directory, directorySource: 'creator-picked' as const } : {}),
        gateVerify: gateVerifyForProjectType({ directory: cfg.directory, devEnv: cfg.devEnv, name: cfg.name }),
      });
      // 本机实例全部可值班（同时写入持久化成员表）
      joinLocalInstances(cfg.groupId);
      audit?.log('group.create', { groupId: cfg.groupId, type: cfg.type, devEnv: cfg.devEnv === 'container' ? 'container' : 'host' });
      return { ok: true, groupId: cfg.groupId, project: groupStore?.projectOf(cfg.groupId) || null };
    } catch (e) {
      return { ok: false, error: 'group create failed' };
    }
  }
);

// ── 群列表：来自 userData/groups.json（真实存储），不是空数组 / 演示数据 ──
handleIpc('warmy:group-list', () =>
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
  'warmy:group-message',
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
          subject: `WArmy request ${msg.groupId}`,
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
        // 计划1/2：值班路径同样自动收敛重试
        const dutyModel = providerCfg.model;
        const dutyBase = contextBudgetChars(dutyModel);
        const dutyRetried = await runWithContextRetry(dutyBase, async (budgetChars) => {
          const view = renderChatView(msg.groupId, msg.content, budgetChars);
          // ADR 002 §9.4 待办 2：值班者路径也只走这一个循环入口（工具/降级/审计行为一致）
          const loop = await runChatLoop(msg.groupId, provider, {
            model: dutyModel,
            messages: [
              { role: 'system', content: tMain('llm.dutySystem') },
              ...(view.messages as ChatMessage[]),
            ],
            maxTokens: 512,
          });
          return { loop, budgetChars };
        });
        const loop = dutyRetried.result?.loop as Awaited<ReturnType<typeof runChatLoop>> | undefined;
        if (!loop && dutyRetried.gaveUp) {
          llmReply = tMain('chat.contextTooSmall', '该模型上下文太小，无法满足当前聊天需求（已自动收缩重试到最小值仍失败）');
        } else if (loop) {
          llmReply = loop.response.choices[0]?.message?.content || '';
        }
        appendChatLog(msg.groupId, {
          seq: nextChatSeq(),
          role: 'assistant',
          content: llmReply || '',
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

handleIpc('warmy:board-tasks', (_e, groupId?: string) => {
  try {
    return { ok: true, tasks: board?.listTasks(groupId) || [] };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

handleIpc('warmy:board-events', () => {
  try {
    return { ok: true, events: board?.tailEvents(30) || [] };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

handleIpc('warmy:board-aggregate', () => {
  try {
    return { ok: true, sessions: board?.aggregateByGroup() || [] };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

handleIpc('warmy:group-join-instance', (_e, groupId: string, instanceId: string) => {
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
    groupStore?.addMemberWithFingerprint(
      groupId,
      { name: inst.name, role: 'member', source: 'instance', instanceId: inst.id },
      { onAudit: (op, detail) => audit?.log(op, detail) }
    );
    return { ok: true };
  } catch (e) { return { ok: false, error: 'join failed' }; }
});

// ── 真 LLM 对话 ──
handleIpc('warmy:set-provider', (_e, cfg: Partial<typeof providerCfg>) => {
  try {
    providerCfg = { ...providerCfg, ...cfg };
    return { ok: true, providerCfg: { ...providerCfg, apiKey: providerCfg.apiKey ? '***' : '' } };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

handleIpc('warmy:get-provider', () => ({
  ok: true,
  providerCfg: { ...providerCfg, apiKey: providerCfg.apiKey ? '***' : '' },
  hasKey: !!providerCfg.apiKey || providerCfg.protocol === 'ollama',
}));

handleIpc(
  'warmy:chat-send',
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

    /**
     * ADR 004 第七批定稿：**项目不可用**时不可聊天（也不可在宿主侧执行这一轮）。
     *  - 容器开发项目：容器没启动 ⇒ 不可用（等同创建者下线）；
     *  - 任何项目：被创建者**停用** ⇒ 不可用；
     *  - **本机开发且未被停用**的项目、以及「我的牛马」⇒ 直接放行（含探测都不做，不误伤）。
     * 历史记录仍然可读（`historyReadable: true` 一并回给渲染层）。
     */
    const devRefusal = await projectUnavailableFor(sessionId);
    if (devRefusal) {
      emitConsole({ cat: 'system', code: 'container.project.unavailable', data: { sessionId, projectCode: devRefusal.projectCode } });
      return {
        ok: false,
        code: devRefusal.code,
        projectCode: devRefusal.projectCode,
        reasonKey: devRefusal.reasonKey,
        fix: devRefusal.fix,
        // 成员侧看到的就是"创建者下线"那一套（同一个文案键）
        memberFaceKey: 'group.memberOffline',
        hostExecutionRefused: true,
        historyReadable: true,
      };
    }

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
      const modelId = msg.model || providerCfg.model;
      const baseBudget = contextBudgetChars(modelId);
      // 计划1/2：上下文超限自动收缩重试（100%→60%→35%→20%），到最小仍失败则如实停止
      const retried = await runWithContextRetry(baseBudget, async (budgetChars) => {
        // 不变量 #2：注入的是日志的**有界渲染视图**，不是日志本身（ADR 002 §4/§6）
        const view = renderChatView(sessionId, msg.content, budgetChars);
        // ADR 002 §9.4 待办 2：模型可以当轮调用 recall/retrieve 把被省略的原文取回来
        const loop = await runChatLoop(sessionId, provider, {
          model: modelId,
          messages: view.messages as ChatMessage[],
          maxTokens: 1024,
        });
        return { view, loop, budgetChars };
      });
      if (retried.gaveUp || !retried.result?.loop) {
        const msgTxt = retried.gaveUp || 'context-too-small';
        lastError = { ts: Date.now(), message: msgTxt, context: 'chat-send-context' };
        return {
          ok: false,
          error: msgTxt,
          contextTooSmall: true,
          retries: retried.retries,
          reply: tMain('chat.contextTooSmall', '该模型上下文太小，无法满足当前聊天需求（已自动收缩重试到最小值仍失败）'),
        };
      }
      const { loop } = retried.result;
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
      // T194：这条是"**已处理**失败"（聊天链路自己吞掉并回 retry），也要进控制台
      emitConsole({ cat: 'error', code: 'err.chat-send', data: { sessionId, message: err } });
      return { ok: false, reply: '', error: err, needsKey: false, retry: true };
    }
  }
);

// ── 检查点 ──
/**
 * ADR 004 §7.6（第八批）：**回退点 = 文件 + 环境指纹**。
 * 分层（别想当然）：
 *   · 文件回退 = 现有回退点机制（git / shadow-git / CoW），**不依赖容器**；没有容器也必须有回退点；
 *   · 环境回退 = 容器镜像 / 快照（commit），**快照覆盖不到** bind mount 进来的项目文件；
 *   · 增益：每个回退点顺便记下当时的**环境指纹**（运行时 + 我们镜像表的 digest 快照），
 *     这样"回退了代码但环境变了"能被提前告知，而不是等跑不起来才发现。
 */
function currentEnvFingerprint(groupId: string): { active: boolean; runtimeId: string; revision: string; at: number; imageDigests: Record<string, string> } {
  const gid = String(groupId || '');
  const runtimeId = gid ? projectRuntimeOf(gid) : '';
  const isContainer = !!gid && projectDevEnvOf(gid) === 'container' && !!runtimeId;
  const imageDigests: Record<string, string> = {};
  for (const img of CONTAINER_BASE_IMAGES) if (img.digest) imageDigests[img.ref] = img.digest;
  if (!isContainer) return { active: false, runtimeId: '', revision: 'host', at: Date.now(), imageDigests: {} };
  const revision = crypto.createHash('sha256').update(JSON.stringify({ runtimeId, imageDigests })).digest('hex').slice(0, 12);
  return { active: true, runtimeId, revision, at: Date.now(), imageDigests };
}
/** 把当前环境指纹挂到刚建的回退点上（缺容器开发信息时如实记 host，不编） */
function recordCheckpointEnv(cpId: string, groupId?: string): void {
  try {
    if (!cpId || !settingsStore) return;
    const fp = currentEnvFingerprint(String(groupId || ''));
    const s = settingsStore.load();
    const m = { ...((s && s.checkpointEnv) || {}) };
    m[cpId] = fp;
    settingsStore.save({ checkpointEnv: m } as never);
  } catch {
    /* 记不上就不记（宁可缺，也不编） */
  }
}
handleIpc('warmy:checkpoint-create', (_e, phase: 'round_start' | 'round_end', groupId?: string) => {
  try {
    if (!checkpoints) return { ok: false };
    const memDir = path.join(app.getPath('userData'), 'memory');
    const jsonl = path.join(memDir, 'fast-memory.jsonl');
    const cp = checkpoints.create({ phase, logSeq: Date.now(), jsonlPath: fs.existsSync(jsonl) ? jsonl : undefined });
    recordCheckpointEnv(String((cp && cp.id) || ''), groupId);
    return { ok: true, checkpoint: cp, list: checkpoints.list(), env: currentEnvFingerprint(String(groupId || '')) };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

handleIpc('warmy:checkpoint-list', (_e, payload?: { sessionId?: string }) => ({
  ok: true,
  list: checkpoints?.list() || [],
  space: checkpoints?.space() || { maxBytes: 512 * 1024 * 1024, usedBytes: 0, count: 0 },
  /** 每个回退点当时的**环境指纹**（没记过就没有 —— 不编） */
  envByCheckpoint: (settingsStore?.load()?.checkpointEnv) || {},
  /** 当前环境指纹（用来和回退点上的对比） */
  currentEnv: currentEnvFingerprint(String(payload?.sessionId || '')),
  /**
   * **分层事实**（写进响应，UI 照它说明，不许对用户声称"有容器回退点就更简单了"）：
   *   fileRollbackIndependent = true（文件回退不依赖容器，没容器也必须有回退点）
   *   snapshotCoversProjectFiles = false（commit 只快照容器可写层；bind mount 的项目文件在快照之外）
   */
  layering: { fileRollbackIndependent: true, snapshotCoversProjectFiles: false, envRollbackNeedsRuntime: true },
}));

handleIpc('warmy:checkpoint-rollback', (_e, id: string, opts?: { stopFirst?: boolean; sessionId?: string }) => {
  try {
    if (!checkpoints) return { ok: false };
    if (opts?.stopFirst) {
      void p1?.instances.stopAll();
    }
    const memDir = path.join(app.getPath('userData'), 'memory');
    const jsonl = path.join(memDir, 'fast-memory.jsonl');
    const ok = checkpoints.rollback(id, { jsonlPath: jsonl });
    // 回退后**如实对比环境**：环境变了就提前告知（文件回退了、环境回不去）
    const recorded = (settingsStore?.load()?.checkpointEnv || {})[String(id)] || null;
    const current = currentEnvFingerprint(String(opts?.sessionId || ''));
    const envChanged = !!recorded && String(recorded.revision || '') !== String(current.revision || '');
    return {
      ok,
      env: { recorded, current, changed: envChanged, active: current.active },
      /** 文件回退成功 ≠ 环境也回退了 —— 这条一起回给渲染层，让 UI 如实提示 */
      noteKey: envChanged ? 'checkpoints.env.changed' : 'checkpoints.env.same',
    };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

// ── 知识库 ──
handleIpc('warmy:knowledge-query', (_e, q: string) => {
  try {
    return { ok: true, ...(knowledge?.query(q) || { entities: [], events: [] }) };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

handleIpc(
  'warmy:knowledge-add-event',
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
handleIpc('warmy:set-insert-mode', (_e, sessionId: string, mode: 'outer' | 'inner') => {
  try {
    insertMode.set(sessionId, mode);
    return { ok: true, mode };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});
handleIpc('warmy:get-insert-mode', (_e, sessionId: string) => ({
  ok: true,
  mode: insertMode.get(sessionId) || 'outer',
}));

// ── 指标 ──
handleIpc('warmy:metrics-summary', () => safeHandle(() => ({ ok: true, ...metrics.summary() }), { ok: true, turns: 0, avgDurationMs: 0, promptTokens: 0, completionTokens: 0, cacheHitRate: 0, cacheHitTokens: 0, cacheMissTokens: 0, ccrOriginalBytes: 0, ccrCompressedBytes: 0, ccrRatio: 1, healthyCache: false, viewSamples: 0, viewBytes: 0, logBytes: 0, viewBudgetChars: 0, viewBytesMin: 0, viewBytesMax: 0, logEntries: 0, viewPointers: 0, viewBounded: true, toolCalls: 0, toolCallsOk: 0, toolChars: 0, toolTurns: 0, toolDegradedTurns: 0, toolStopReasons: {}, toolLoopBounded: true }))
handleIpc('warmy:metrics-turns', () => safeHandle(() => ({ ok: true, turns: metrics.lastTurns(20) }), { ok: true, turns: [] }))
handleIpc('warmy:metrics-tools', () => safeHandle(() => ({ ok: true, calls: metrics.lastToolCalls(50) }), { ok: true, calls: [] }))

/**
 * 会话日志（只追加）的只读视图 —— ADR 002 §9.4 待办 4 的观测面。
 * 只回 seq / 角色 / 长度 / 摘要，不回正文（正文在记忆服务里，靠 retrieve 取）。
 */
handleIpc('warmy:chat-log', (_e, payload?: { sessionId?: string; limit?: number }) => {
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
handleIpc('warmy:chat-log-restore', async () => {
  const report = await restoreChatLogsFromMemory('ipc');
  return { ok: report.ok, restore: report, sessions: [...chatLogs.keys()], logSeq: chatLogSeq };
});

// ── 设置持久化 ──
handleIpc('warmy:settings-get', () => safeHandle(() => ({ ok: true, settings: settingsStore?.load() }), { ok: true, settings: undefined }))
handleIpc('warmy:settings-save', (_e, partial: Record<string, unknown>) => ({
  ok: true,
  settings: settingsStore?.save(partial as never),
}));

/* ══════════════════════════════════════════════════════════════════════════
   ADR 004 P1：执行环境探测 / 启停（设置 → 功能 → 容器）
   ---------------------------------------------------------------------------
   纪律（都写进契约里，不给后来人留口子）：
   · **只探测与驱动**：不安装、不下载、不提权、不创建容器、不拉镜像；
   · `container-action` **只接受预定义运行时 id + 'start' | 'stop'**，
     **绝不接受任意命令字符串**（否则这里就是一个远程命令执行入口）；
   · 启停**只能由本机用户点击触发**：没有任何网络/群成员/智能体路径会调用它；
   · 任何失败都如实回原始输出与退出码，**不当作成功**。
   ══════════════════════════════════════════════════════════════════════════ */
handleIpc('warmy:container-probe', async (_e, opts?: { force?: boolean; cacheMs?: number }) => {
  try {
    const report = await probeContainerRuntimes({
      cacheMs: opts?.force ? 0 : (typeof opts?.cacheMs === 'number' ? opts.cacheMs : 8000),
    });
    return { ok: true, report };
  } catch (e) {
    return { ok: false, error: sanitizeError(e), report: lastContainerProbeReport() };
  }
});
handleIpc('warmy:container-action', async (_e, payload?: { id?: string; action?: string }) => {
  // 参数形状**只**认 { id, action }：多余字段一律忽略，也不会被拼进命令
  const r = await runContainerAction({ id: payload?.id, action: payload?.action });
  if (r.ok) emitConsole({ cat: 'system', code: 'container.action.accepted', data: { id: r.id, action: r.action } });
  else emitConsole({ cat: 'error', code: 'container.action.rejected', data: { code: r.code, error: r.error } });
  return r;
});

/* ══════════════════════════════════════════════════════════════════════════
   ADR 004 第七批定稿：**项目可用性** + **容器只负责开发**
   ---------------------------------------------------------------------------
   · 创建时选了「开发环境 = 容器」的项目：**容器必须启动，项目才可用**；否则项目
     置灰、不可聊天、其中功能不可用 —— **只能翻看之前的记录（历史仍可读）**。
   · **创建时没选容器 或 这是「我的牛马」⇒ 无需容器也能正常聊天**（绝不误伤）。
   · 对成员的可见效果**等同「创建者下线」**（复用 ADR 003 §2.4 / R6 既有语义，不新造状态）。
   · **『停用项目』与容器无关**：任何项目都能被创建者停用（右键菜单），效果同为"不可用、只看历史"。
   · **容器切换只属于容器开发项目**，入口=项目右键菜单（右侧顶部不再有切换入口）。
   · **「运行/测试在容器中」这个选项已作废删除**（容器 = 开发环境；测试/运行不在其职责内）。
   · **容器项目 = 只能在容器里开发**：本应用**不提供**宿主侧编辑；容器没起来就整个不可用，
     绝不"退到主机上悄悄改"。
   · 判定用**同一份纯实现**（container-probe.deriveProjectState），渲染层不再猜一套。

   诚实边界：我们能拒绝写/改项目文件、把项目显示成不可用、禁用开发与功能入口；
   我们**不能**阻止用户自己用外部编辑器打开那个目录（应用侧强约束，不是文件系统级强制）。
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * 项目属性的**读取顺序**（第十六批定稿）：**项目记录优先 → 本机旧设置兜底**。
 *
 * 为什么这么改（产品主的原话）：**「记录文件的改动应该是无限牛马的功能，不是本机的功能」**
 * —— 开发环境 / 选定的容器 / 启用停用 / 项目目录 / 文件台账都是**项目的事实**，
 * 存在 `groups.json` 的项目记录里，因此**会随项目同步给成员**；
 * `settings.containerDev / containerProjectRuntime / projectDisabled` 只作为**旧版本兼容读**保留
 * （老安装里已经写进本机设置的那些项目不能因为升级就"变成别的项目"）。
 *
 * `projectSource` 会一路带到 IPC 响应与渲染层：
 *   · `local`           = 本机就是项目主，属性是本机自己写的；
 *   · `creator-signal`  = 属性来自**创建者节点同步过来的信号**（异地的成员就是这样看到状态的）。
 */
interface ProjectAttrsView {
  devEnv: 'host' | 'container';
  runtimeId: string;
  disabledAt: number;
  directory: string;
  directorySource: 'creator-picked' | 'checkpoint-workspace' | 'not-recorded';
  availability: string;
  availabilityCode: string;
  availabilityAt: number;
  reportedBy: string;
  source: 'project-record' | 'legacy-local-settings';
}

function projectAttrsOf(groupId: string): ProjectAttrsView {
  const gid = String(groupId || '');
  const legacy = (): ProjectAttrsView => {
    let devEnv: 'host' | 'container' = 'host';
    let runtimeId = '';
    let disabledAt = 0;
    try {
      const s = settingsStore?.load();
      const dev = (s && s.containerDev) || {};
      devEnv = dev[gid] === 'container' ? 'container' : 'host';
      const rt = (s && s.containerProjectRuntime) || {};
      runtimeId = String(rt[gid] || '');
      const dis = (s && s.projectDisabled) || {};
      const n = Number(dis[gid] || 0);
      disabledAt = Number.isFinite(n) && n > 0 ? n : 0;
    } catch {
      /* 拿不到就按默认（本机 / 未停用） */
    }
    return {
      devEnv, runtimeId, disabledAt,
      directory: '', directorySource: 'not-recorded',
      availability: 'unknown', availabilityCode: '', availabilityAt: 0, reportedBy: '',
      source: 'legacy-local-settings',
    };
  };
  const proj = groupStore?.projectOf(gid);
  if (!proj) return legacy();
  return {
    devEnv: proj.devEnv === 'container' ? 'container' : 'host',
    runtimeId: String(proj.runtimeId || ''),
    disabledAt: Number(proj.disabledAt) > 0 ? Number(proj.disabledAt) : 0,
    directory: String(proj.directory || ''),
    directorySource: proj.directory ? (proj.directorySource || 'creator-picked') : 'not-recorded',
    availability: String(proj.availability || 'unknown'),
    availabilityCode: String(proj.availabilityCode || ''),
    availabilityAt: Number(proj.availabilityAt) || 0,
    reportedBy: String(proj.reportedBy || ''),
    source: 'project-record',
  };
}

/** 这个项目的属性是不是**别人的节点同步过来的**（= 本机不是项目主） */
function projectAttrsAreRemote(groupId: string): boolean {
  const gid = String(groupId || '');
  const view = projectAttrsOf(gid);
  if (view.source !== 'project-record') return false;
  const reportedBy = view.reportedBy;
  if (!reportedBy) return false;
  try {
    const localFp = String(identityStore?.info()?.fingerprint || '');
    return !!localFp && !fingerprintMatches(reportedBy, localFp);
  } catch {
    return false;
  }
}

function projectDevEnvOf(groupId: string): 'host' | 'container' {
  return projectAttrsOf(groupId).devEnv;
}
function projectDisabledAt(groupId: string): number {
  return projectAttrsOf(groupId).disabledAt;
}
/** 项目目录（**产品级事实**：成员据此解析"最近改动文件"的根） */
function projectDirectoryOf(groupId: string): { dir: string; reason: string } {
  const v = projectAttrsOf(String(groupId || ''));
  if (v.directory) return { dir: v.directory, reason: v.directorySource };
  return { dir: '', reason: 'not-recorded' };
}
/** 容器开发项目选定的运行时（右键菜单「切换容器…」写入项目记录） */
function projectRuntimeOf(sessionId: string): string {
  return projectAttrsOf(String(sessionId || '')).runtimeId;
}

/**
 * 写项目属性：**只写项目记录**（项目级）—— 不再写本机设置。
 * `runtimeId`/`disabledAt` 传 `undefined` = 保持原样（不覆盖已知事实）。
 */
function setProjectAttrsOf(
  groupId: string,
  patch: {
    devEnv?: 'host' | 'container';
    runtimeId?: string;
    disabledAt?: number;
    directory?: string;
    directorySource?: 'creator-picked' | 'checkpoint-workspace';
    availability?: 'available' | 'stopped' | 'not-ready' | 'not-installed' | 'not-chosen' | 'unknown';
    availabilityCode?: string;
    env?: { containerRef?: string; imageRef?: string; solidifiedAt?: number };
    /** 门禁验收脚本（相对仓库根）；只在 complete/验收 时跑 */
    gateVerify?: string[];
    gateLast?: { at: number; pass: boolean; summary: string };
    /** 项目 MEMORY（覆盖式 Markdown） */
    memory?: string;
  }
): { ok: boolean; error?: string } {
  const gid = String(groupId || '');
  if (!groupStore || !gid) return { ok: false, error: 'group store unavailable' };
  const r = groupStore.setProjectAttrs(gid, {
    ...(patch.devEnv ? { devEnv: patch.devEnv } : {}),
    ...(typeof patch.runtimeId === 'string' ? { runtimeId: patch.runtimeId } : {}),
    ...(typeof patch.disabledAt === 'number' ? { disabledAt: patch.disabledAt } : {}),
    ...(patch.directory ? { directory: patch.directory, directorySource: patch.directorySource || 'creator-picked' } : {}),
    ...(patch.availability ? { availability: patch.availability } : {}),
    ...(typeof patch.availabilityCode === 'string' ? { availabilityCode: patch.availabilityCode } : {}),
    availabilityAt: Date.now(),
    ...(patch.env ? { env: patch.env } : {}),
  });
  if (!r.ok) return { ok: false, error: r.error };
  void publishProjectAttrs(gid);
  return { ok: true };
}

/**
 * 把项目属性（含创建者节点的**实时可用性**）广播给成员。
 *
 * 这是"记录文件改动是产品功能、不是本机功能"那条要求落到**网络**上的一步：
 * 成员那边的 UI 从这条信号里就能知道"这是容器开发项目 / 创建者停用了它 /
 * 创建者那台机器的容器现在没就绪 / 项目目录在哪 / 工具动过哪些文件"，
 * 从而**看到原因**并**复用既有「创建者离线」那一套表现**（不新造第三种状态）。
 *
 * 未组网 / 没起 mesh ⇒ 直接返回（**不报错、不假装发出去了**）。
 */
async function publishProjectAttrs(groupId: string): Promise<{ ok: boolean; sent: boolean; reason?: string }> {
  const gid = String(groupId || '');
  if (!gid) return { ok: false, sent: false, reason: 'no-group-id' };
  const view = projectAttrsOf(gid);
  const g = groupStore?.getGroup(gid);
  const ledger = (groupStore?.listFileAccess(gid, 30) || []).map((e) => ({ op: e.op, path: e.path, ts: e.ts, ok: e.ok, by: e.by, ...(e.bytes ? { bytes: e.bytes } : {}) }));
  let creatorFingerprint = '';
  try {
    creatorFingerprint = String(g?.creatorFingerprint || identityStore?.info()?.fingerprint || '');
  } catch {
    creatorFingerprint = String(g?.creatorFingerprint || '');
  }
  const availabilityCode = view.availabilityCode || view.availability || 'unknown';
  const payload = projectAttrsMessage({
    groupId: gid,
    ...(g?.name ? { name: g.name } : {}),
    ...(g ? { type: g.type } : {}),
    project: {
      devEnv: view.devEnv,
      runtimeId: view.runtimeId,
      disabledAt: view.disabledAt,
      ...(view.directory ? { directory: view.directory, directorySource: view.directorySource === 'checkpoint-workspace' ? 'checkpoint-workspace' as const : 'creator-picked' as const } : {}),
    },
    availability: {
      availability: (['available', 'stopped', 'not-ready', 'not-installed', 'not-chosen'] as const).includes(view.availability as never)
        ? (view.availability as 'available' | 'stopped' | 'not-ready' | 'not-installed' | 'not-chosen')
        : 'unknown',
      code: availabilityCode,
      at: view.availabilityAt || Date.now(),
    },
    ...(creatorFingerprint ? { creatorFingerprint } : {}),
    ledger,
  });
  if (!secureMesh || !secureMesh.enabled) return { ok: true, sent: false, reason: 'mesh-not-running' };
  try {
    const r = await secureMesh.broadcast({ to: '*', channel: PROJECT_ATTRS_CHANNEL, payload });
    return { ok: r.failed === 0, sent: r.sent > 0, reason: r.errors && r.errors.length ? r.errors[0] : undefined };
  } catch (e) {
    return { ok: false, sent: false, reason: sanitizeError(e) };
  }
}

/** 未就绪时顺手探一次（主进程侧有短缓存）。探不到 ⇒ null ⇒ 按未就绪处理（不乐观放开） */
async function containerStatusOf(runtimeId: string): Promise<string | null> {
  if (!runtimeId) return null;
  let report = lastContainerProbeReport();
  if (!report) {
    try {
      report = await probeContainerRuntimes({ cacheMs: 8000 });
    } catch {
      return null;
    }
  }
  const row = (report.runtimes || []).find((x) => x.id === runtimeId);
  return row ? String(row.status) : null;
}

/**
 * 「只有创建者能启用/停用项目」——判定依据与 `warmy:group-members` **完全相同**
 * （group-store 里建群时写入的 creatorFingerprint vs 本机当前身份指纹），
 * 不在渲染层猜、也不新增第二套"谁是创建者"的定义。拿不到指纹 ⇒ false（宁可少给权限）。
 */
function localIsProjectCreator(groupId: string): boolean {
  try {
    const gid = String(groupId || '');
    if (!groupStore || !gid) return false;
    const creatorFp = String(groupStore.getGroup(gid)?.creatorFingerprint || '');
    const localFp = String(identityStore?.info()?.fingerprint || '');
    return !!creatorFp && !!localFp && fingerprintMatches(creatorFp, localFp);
  } catch {
    return false;
  }
}

/**
 * 会话/项目的容器事实 → 结构化可用性状态。**唯一入口**（渲染层、门禁、右键动作都走它）。
 *
 * 第十六批的两处变化：
 *  ① 事实来源改成**项目属性**（项目记录优先，旧设置兜底）—— 所以**异地成员**也会看到
 *     "这是容器开发项目"，而不是把它当成一台普通的本机项目；
 *  ② 本机不是项目主时（`projectAttrsAreRemote`），**容器状态不再拿本机探测去猜**：
 *     用创建者节点同步过来的**可用性信号**（`availability`）顶替，
 *     于是成员看到的是"创建者那边现在不可用 + 具体原因"，而不是"我这台机器上没有这个容器"。
 *     这正好落在既有的「创建者离线」语义上（同一份 deriveProjectState ⇒ 同一个 memberFace）。
 */
async function projectStateFor(sessionId: string, opts: { probe?: boolean } = {}): Promise<ContainerProjectState> {
  const id = String(sessionId || '');
  const attrs = projectAttrsOf(id);
  const remote = projectAttrsAreRemote(id);
  if (remote) {
    const facts = projectAttrsToStateInput({
      project: {
        devEnv: attrs.devEnv,
        runtimeId: attrs.runtimeId,
        disabledAt: attrs.disabledAt,
      },
      availability: {
        availability: (['available', 'stopped', 'not-ready', 'not-installed', 'not-chosen'] as const).includes(attrs.availability as never)
          ? (attrs.availability as 'available' | 'stopped' | 'not-ready' | 'not-installed' | 'not-chosen')
          : 'unknown',
        code: attrs.availabilityCode,
        at: attrs.availabilityAt,
      },
    });
    return deriveProjectState({
      devEnv: facts.devEnv,
      runtimeId: facts.runtimeId,
      runtimeStatus: facts.runtimeStatus as never,
      disabledByOwner: facts.disabledByOwner,
    });
  }
  const devEnv = attrs.devEnv;
  const runtimeId = attrs.runtimeId;
  let status: string | null = null;
  if (devEnv === 'container' && runtimeId) {
    const cached = lastContainerProbeReport();
    const row = cached ? (cached.runtimes || []).find((x) => x.id === runtimeId) : undefined;
    status = row ? String(row.status) : opts.probe === false ? null : await containerStatusOf(runtimeId);
  }
  return deriveProjectState({
    devEnv,
    runtimeId,
    runtimeStatus: (status as never) ?? null,
    disabledByOwner: attrs.disabledAt > 0,
  });
}

/**
 * 把**本机算出来的可用性**记进项目属性并广播（只在**变化时**才写/发）。
 *
 * 为什么需要：成员要看到的不仅是"这是容器项目 / 被停用了"，还要看到**原因**
 * （创建者那边的容器没就绪 / 没装 / 还没选）。这条现场事实只能由**创建者的节点**上报，
 * 所以在这里落一次 —— 写进项目记录（成员可见）并走 `project-attrs` 频道播出去。
 * ⚠️ 写入失败/无变化一律静默（不能因为"状态记不下来"就把渲染层卡住）。
 */
function recordLocalAvailability(groupId: string, code: string): void {
  const gid = String(groupId || '');
  if (!gid || !groupStore) return;
  const cur = groupStore.projectOf(gid);
  if (!cur) return; // 没有项目记录的不写（例如「我的牛马」的聊天、联系人）
  const availability =
    code === 'host-dev' || code === 'ok' ? 'available'
      : code === 'disabled-by-owner' ? 'stopped'
        : code === 'container-not-installed' ? 'not-installed'
          : code === 'container-not-chosen' ? 'not-chosen'
            : 'not-ready';
  if (cur.availability === availability && cur.availabilityCode === code) return;
  let localFp = '';
  try {
    localFp = String(identityStore?.info()?.fingerprint || '');
  } catch {
    localFp = '';
  }
  const r = groupStore.setProjectAttrs(gid, {
    availability,
    availabilityCode: code,
    availabilityAt: Date.now(),
    ...(localFp ? { reportedBy: localFp } : {}),
  });
  if (r.ok) void publishProjectAttrs(gid);
}

/** 项目不可用时的结构化拒绝（chat-send / 值班编排 / 各功能入口共用） */
async function projectUnavailableFor(sessionId: string): Promise<ReturnType<typeof projectUnavailableRefusal>> {
  const id = String(sessionId || '');
  const devEnv = projectDevEnvOf(id);
  // 本机开发 + 未被停用：与容器毫无关系 ⇒ 直接放行，连探测都不做（不误伤）
  if (devEnv !== 'container' && projectDisabledAt(id) === 0) return null;
  return projectUnavailableRefusal(await projectStateFor(id));
}

/** 项目可用性状态（渲染层**唯一**的事实来源；含"历史仍可读"这条事实） */
handleIpc('warmy:project-state', async (_e, payload?: { sessionId?: string }) => {
  try {
    const sessionId = String(payload?.sessionId || '');
    const state = await projectStateFor(sessionId);
    const attrs = projectAttrsOf(sessionId);
    const remote = projectAttrsAreRemote(sessionId);
    // 本机是项目主 ⇒ 把**现场算出来的可用性**记进项目属性并广播（成员据此看到原因）
    if (!remote) recordLocalAvailability(sessionId, state.code);
    return {
      ok: true,
      state: { ...state, reasonKey: projectReasonKey(state.code), runtimeId: attrs.runtimeId },
      /**
       * 与"创建者下线"同一套表现（渲染层据此用同一个文案键，而不是新造第三种状态）。
       * ⚠️ 成员侧也一样：项目不可用时**入站流量按创建者离线处理**（见 projectInboundGate）。
       */
      memberFaceKey: state.memberFace === 'creator-offline' ? 'group.memberOffline' : null,
      /** 创建者能不能启用/停用（渲染层据此灰掉菜单项；判定本身在主进程） */
      localIsCreator: localIsProjectCreator(sessionId),
      /** **历史仍可读**：不可用 ≠ 整块禁掉（渲染层必须继续显示已存在的记录） */
      historyReadable: true,
      /**
       * 这条状态是**谁说的**：
       *  · 'local'          = 本机就是项目主（事实由本机现场探测得出）；
       *  · 'creator-signal' = 属性与可用性来自**创建者节点同步来的信号**（异地成员的情况）——
       *    渲染层据此多给一行"由创建者的节点上报"，**复用**同一句「创建者离线」文案。
       */
      projectSource: remote ? 'creator-signal' : 'local',
      /** 信号到达时间（远端才有意义；本机为 0） */
      projectReportedAt: remote ? attrs.availabilityAt : 0,
      /** 项目目录（产品级事实：成员据此解析"最近改动文件"的根） */
      projectDir: attrs.directory,
      projectDirReason: attrs.directorySource,
      /** 成员侧入站门控结论（可断言的事实：不可用 ⇒ 排队为 creator-offline） */
      inboundGate: projectInboundGate({ running: state.running, code: state.code }),
    };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

/**
 * 「启用项目」（右键菜单）：**只有创建者**能启用。
 * 容器开发项目**必须先有就绪的容器** —— 否则如实拒绝并给"去设置启动容器"的引导，**不假装启用**。
 */
handleIpc('warmy:project-enable', async (_e, payload?: { sessionId?: string }) => {
  try {
    const id = String(payload?.sessionId || '');
    if (!localIsProjectCreator(id)) {
      return { ok: false, code: 'not-creator', error: 'only the creator can enable or disable this project' };
    }
    if (projectDisabledAt(id) > 0) {
      // **写项目记录**（项目级事实 ⇒ 会同步给成员），不再只写本机设置
      const w = setProjectAttrsOf(id, { disabledAt: 0 });
      if (!w.ok) return { ok: false, code: 'cannot-persist', error: w.error };
    }
    const after = await projectStateFor(id);
    if (!after.running) {
      // 不静默降级：容器没起就说容器没起，并给出下一步该做什么
      return {
        ok: false,
        code: after.code === 'container-not-chosen' ? 'container-not-chosen' : 'container-not-ready',
        projectCode: after.code,
        reasonKey: projectReasonKey(after.code),
        fix: after.fix,
        needsContainer: true,
        state: after,
      };
    }
    audit?.log('container.project-enable', { sessionId: id });
    emitConsole({ cat: 'system', code: 'container.project.enabled', data: { sessionId: id } });
    return { ok: true, running: true, enabledAt: Date.now(), state: after };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

/**
 * 「停用项目」（右键菜单）：**只有创建者**能停用；**与是否选了容器无关**。
 * 效果：项目置灰、不可聊天、其中功能不可用，**只能翻看之前的记录**（历史仍可读）。
 * 对成员的效果**等同创建者下线**（复用既有语义，不新造）。
 *
 * 第十六批：停用时间戳写进**项目记录**（项目级）并广播出去 —— 否则异地的成员看到的
 * 还是一台"普通的本机项目"（这正是产品主要修的那件事）。
 */
handleIpc('warmy:project-disable', async (_e, payload?: { sessionId?: string }) => {
  try {
    const id = String(payload?.sessionId || '');
    if (!localIsProjectCreator(id)) {
      return { ok: false, code: 'not-creator', error: 'only the creator can enable or disable this project' };
    }
    const at = Date.now();
    const w = setProjectAttrsOf(id, { disabledAt: at });
    if (!w.ok) return { ok: false, code: 'cannot-persist', error: w.error };
    const state = await projectStateFor(id);
    audit?.log('container.project-disable', { sessionId: id, memberFace: state.memberFace });
    emitConsole({ cat: 'system', code: 'container.project.disabled', data: { sessionId: id } });
    return { ok: true, disabled: true, disabledAt: at, state, historyReadable: true };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

/**
 * 「切换容器…」（右键菜单的弹窗）：**只有创建时选了容器开发的项目**才有这个出口。
 * 只接受设置里已探测到的运行时 id（`{ sessionId, runtimeId }`）；
 * **不接受任何命令字符串**（运行时 id 必须在预定义清单里，否则拒绝）。
 */
handleIpc('warmy:project-set-container', async (_e, payload?: { sessionId?: string; runtimeId?: string }) => {
  try {
    const id = String(payload?.sessionId || '');
    const runtimeId = String(payload?.runtimeId || '');
    if (!localIsProjectCreator(id)) {
      return { ok: false, code: 'not-creator', error: 'only the creator can change this project container' };
    }
    if (projectDevEnvOf(id) !== 'container') {
      return { ok: false, code: 'not-container-project', error: 'this project does not develop in a container' };
    }
    if (!containerRuntimeSpec(runtimeId)) {
      return { ok: false, code: 'unknown-runtime', error: `unknown runtime id: ${runtimeId}` };
    }
    const w = setProjectAttrsOf(id, { runtimeId });
    if (!w.ok) return { ok: false, code: 'cannot-persist', error: w.error };
    const state = await projectStateFor(id);
    audit?.log('container.project-set-container', { sessionId: id, runtimeId });
    return {
      ok: true,
      runtimeId,
      state,
      /** 项目**正在运行**时切换 ⇒ 界面必须提示"重启项目才能生效"（不假装已切过去） */
      restartRequired: state.running,
    };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

/**
 * ADR 004 §七.3 / 第十六批：**项目文件事实**（右侧三块面板的真实数据来源）。
 *
 * 第十六批把两个"数据源缺口"补成真的（产品主的原话：**「记录文件的改动应该是无限牛马的功能，
 * 不是本机的功能」** —— 所以台账是**项目级**的，随项目同步给成员）：
 *  ① **工具文件访问台账**（`tool-file-access-ledger`）：记录在**项目记录**里，
 *     由 helper-tool 的真实读写 + 容器内执行共同填充（读/写/改/删/建/备份/回滚七类操作）；
 *  ② **项目目录记录**（`project-directory-record`）：`GroupRecord.project.directory`
 *     （创建者选目录时写入；没有就用回退点里记的 workspace —— 两侧都如实标来源）。
 *
 * 于是四类真实来源：台账 / 回退点明细 / 项目目录扫描（真实 mtime）/ 产物目录扫描。
 * **仍然拿不到的**（例如项目目录没被记录过）⇒ 如实写进 `missingSources`，绝不编数据。
 */
async function projectFilesFor(sessionId: string): Promise<{
  ok: true;
  sessionId: string;
  projectDir: string | null;
  projectDirReason: string;
  projectSource: string;
  changed: Array<{ path: string; ts: number; kind: string; scope: string; source?: string }>;
  other: Array<{ path: string; ts: number; kind: string; scope: string; source: string }>;
  ledger: Array<{ path: string; op: string; ts: number; ok: boolean; by: string; bytes?: number; scope: string }>;
  missingSources: string[];
  product: {
    dir: string;
    dirExists: boolean;
    dirKind: 'planned' | 'existing';
    kind: 'program' | 'file' | 'none';
    entry: string | null;
    entryHostRunnable: boolean;
    entryReason: string;
    files: Array<{ path: string; name: string; bytes: number; ts: number }>;
  };
}> {
  const id = String(sessionId || '');
  const missingSources: string[] = [];
  const changed: Array<{ path: string; ts: number; kind: string; scope: string; source?: string }> = [];
  let projectDir: string | null = null;
  let projectDirReason = 'not-recorded';
  const attrs = projectAttrsOf(id);
  const remote = projectAttrsAreRemote(id);

  // ① 项目目录：**项目记录里记了的**优先（产品级事实，成员也拿得到）
  if (attrs.directory) {
    projectDir = attrs.directory;
    projectDirReason = attrs.directorySource;
  }
  // ② 回退点明细（真实 path + 真实 ts）
  try {
    const cps = checkpoints?.list() || [];
    for (const cp of cps.slice(-20)) {
      const detail = (cp && (cp as unknown as { detail?: { filesChanged?: Array<{ path: string; ts: number }>; filesCreated?: Array<{ path: string; ts: number }> } }).detail) || {};
      for (const f of detail.filesChanged || []) changed.push({ path: String(f.path), ts: Number(f.ts) || 0, kind: 'changed', scope: 'other', source: 'checkpoint-detail' });
      for (const f of detail.filesCreated || []) changed.push({ path: String(f.path), ts: Number(f.ts) || 0, kind: 'created', scope: 'other', source: 'checkpoint-detail' });
      const ws = (cp as unknown as { workspace?: string }).workspace;
      if (!projectDir && ws && fs.existsSync(ws)) {
        projectDir = ws;
        projectDirReason = 'checkpoint-workspace';
      }
    }
  } catch {
    /* 拿不到就保持空 */
  }
  // ③ **工具文件访问台账**（项目级、成员可见；真实发生过才在）
  const ledgerRows = (groupStore?.listFileAccess(id, 200) || []).map((e2) => {
    const inProject = !!projectDir && path.resolve(e2.path).startsWith(path.resolve(projectDir) + path.sep);
    return { path: e2.path, op: e2.op, ts: e2.ts, ok: e2.ok, by: e2.by, ...(e2.bytes ? { bytes: e2.bytes } : {}), scope: inProject ? 'project' : 'other' };
  });
  for (const e2 of ledgerRows) {
    // 台账里的 read 不进"最近改动文件"（**读不是改动**），但写/改/删/建/备份/回滚都进
    if (e2.op === 'read') continue;
    changed.push({ path: e2.path, ts: e2.ts, kind: e2.op === 'delete' ? 'deleted' : e2.op === 'create' ? 'created' : 'changed', scope: e2.scope, source: 'tool-file-access-ledger' });
  }
  // ④ 项目目录**真实 mtime 扫描**（有目录记录时才做；有界、跳过重目录）
  if (projectDir && fs.existsSync(projectDir)) {
    try {
      const skip = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.venv', 'venv', '__pycache__', '.cache', 'target']);
      const seen: Array<{ path: string; ts: number }> = [];
      const walk = (dir: string, depth: number): void => {
        if (depth > 3 || seen.length >= 400) return;
        let entries: import('node:fs').Dirent[] = [];
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const ent of entries) {
          if (seen.length >= 400) return;
          if (ent.name.startsWith('.') && ent.name !== '.env') continue;
          const fp = path.join(dir, ent.name);
          if (ent.isDirectory()) {
            if (skip.has(ent.name)) continue;
            walk(fp, depth + 1);
            continue;
          }
          if (!ent.isFile()) continue;
          try {
            const st = fs.statSync(fp);
            seen.push({ path: fp, ts: st.mtimeMs });
          } catch {
            /* 拿不到就跳过 */
          }
        }
      };
      walk(projectDir, 0);
      for (const f of seen.sort((a, b) => b.ts - a.ts).slice(0, 60)) {
        changed.push({ path: f.path, ts: f.ts, kind: 'changed', scope: 'project', source: 'dir-scan' });
      }
    } catch {
      /* 扫不到就不扫（不编） */
    }
  }
  // 去重（同一路径取最新的一条，并保留它自己的来源标注）
  const byPath = new Map<string, { path: string; ts: number; kind: string; scope: string; source?: string }>();
  for (const c of changed) {
    const prev = byPath.get(c.path);
    if (!prev || prev.ts <= c.ts) byPath.set(c.path, c);
  }
  const all = [...byPath.values()].sort((a, b) => b.ts - a.ts);
  for (const c of all) {
    if (projectDir && path.resolve(c.path).startsWith(path.resolve(projectDir) + path.sep)) c.scope = 'project';
  }
  const own = all.filter((c) => c.scope === 'project');
  /**
   * 「其他文件（非项目内）」= 被工具动过、但**不在项目目录下**的路径（例如 ~/.warmy 备份、
   * 临时产物、别的盘的路径）。这是产品明确要的那一栏；来源如实标注。
   */
  const other = all.filter((c) => c.scope !== 'project').map((c) => ({ ...c, source: c.source || 'unknown' }));

  /**
   * **仍然缺什么**（如实报告，不填假数据）：
   *  · 没有项目目录记录 ⇒ 成员与"最近改动文件"都缺一个解析根（写进 missingSources）；
   *  · 台账存在但为空 ⇒ **不是缺口**（就是"这段时间没有任何工具动过文件"这个事实本身）。
   *  · 远端成员：项目目录/可用性来自创建者的信号，界面会另有一行说明来源。
   */
  if (!projectDir) missingSources.push('project-directory-record');
  if (remote && !attrs.availabilityAt) missingSources.push('creator-availability-signal');

  // 产物目录（我们计划的存放位置；不存在也如实显示"即将存放"）
  const prodDir = path.join(app.getPath('userData'), 'products', id || 'default');
  let dirExists = false;
  let files: Array<{ path: string; name: string; bytes: number; ts: number }> = [];
  try {
    dirExists = fs.existsSync(prodDir) && fs.statSync(prodDir).isDirectory();
    if (dirExists) {
      files = fs
        .readdirSync(prodDir, { withFileTypes: true })
        .filter((e) => e.isFile())
        .slice(0, 50)
        .map((e) => {
          const fp = path.join(prodDir, e.name);
          let bytes = 0;
          let ts = 0;
          try {
            const st = fs.statSync(fp);
            bytes = st.size;
            ts = st.mtimeMs;
          } catch {
            /* 拿不到就 0 */
          }
          return { path: fp, name: e.name, bytes, ts };
        })
        .sort((a, b) => b.ts - a.ts);
    }
  } catch {
    /* 忽略 */
  }
  const entryOf = (list: Array<{ path: string; name: string }>): { entry: string | null; kind: 'program' | 'file' | 'none'; reason: string } => {
    const prog = list.find((f) => /\.(exe|cmd|bat|js|mjs|cjs|py)$/i.test(f.name)) || null;
    if (prog) return { entry: prog.path, kind: 'program', reason: 'entry-found' };
    const anyFile = list.find((f) => /\.(md|txt|docx?|pptx?|xlsx?|csv|pdf|mp[34]|wav|png|jpe?g|zip)$/i.test(f.name)) || list[0] || null;
    if (anyFile) return { entry: anyFile.path, kind: 'file', reason: 'file-found' };
    return { entry: null, kind: 'none', reason: dirExists ? 'dir-empty' : 'dir-planned' };
  };
  const e = entryOf(files);
  // "能不能在主机上跑"：只有**本机开发的项目** + 宿主原生扩展 才可点；其余一律置灰并说明原因
  const devEnv = projectDevEnvOf(id);
  const hostNative = !!e.entry && /\.(exe|cmd|bat|js|mjs|cjs)$/i.test(path.basename(e.entry));
  const entryHostRunnable = e.kind === 'program' && hostNative && devEnv === 'host';
  const entryReason = e.kind !== 'program'
    ? e.reason
    : devEnv !== 'host'
      ? 'container-built'
      : hostNative
        ? 'host-native'
        : 'no-host-runtime';
  return {
    ok: true,
    sessionId: id,
    projectDir,
    projectDirReason,
    /** 属性是本地事实还是创建者信号（渲染层据此多一行"由创建者的节点上报"） */
    projectSource: remote ? 'creator-signal' : 'local',
    changed: own,
    other,
    ledger: ledgerRows,
    missingSources,
    product: {
      dir: prodDir,
      dirExists,
      dirKind: dirExists ? 'existing' : 'planned',
      kind: e.kind,
      entry: e.entry,
      entryHostRunnable,
      entryReason,
      files,
    },
  };
}

handleIpc('warmy:project-files', async (_e, payload?: { sessionId?: string }) => {
  try {
    return await projectFilesFor(String(payload?.sessionId || ''));
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

/**
 * 「运行」（产物面板）：**真的在主机上运行**那个程序（与容器无关）。
 * 安全：入口路径**由主进程自己解析**（渲染层只给 sessionId，**不接受任何路径/命令字符串**），
 * 且必须满足 `entryHostRunnable`（本机开发 + 宿主原生扩展）才允许；不满足就如实拒绝。
 */
handleIpc('warmy:product-run', async (_e, payload?: { sessionId?: string }) => {
  try {
    const id = String(payload?.sessionId || '');
    const facts = await projectFilesFor(id);
    const p = facts.product;
    if (!p.entry || p.kind !== 'program') return { ok: false, code: 'no-entry', reason: p.entryReason, executed: false };
    if (!p.entryHostRunnable) return { ok: false, code: p.entryReason, executed: false, entry: p.entry };
    // 归一化后再校验：必须落在产物目录里（防路径穿越/软链逃逸）
    const real = fs.realpathSync(p.entry);
    const realDir = fs.realpathSync(p.dir);
    if (!real.startsWith(realDir + path.sep)) return { ok: false, code: 'outside-product-dir', executed: false };
    const ext = path.extname(real).toLowerCase();
    let file = real;
    let args: string[] = [];
    if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
      // 用**本机捆绑的 Node** 跑（Windows 版），不假设系统里有 node
      const bundled = path.join(process.resourcesPath || '', 'node', process.platform === 'win32' ? 'win-x64' : 'linux-x64', process.platform === 'win32' ? 'node.exe' : 'node');
      file = fs.existsSync(bundled) ? bundled : 'node';
      args = [real];
    }
    const child = spawn(file, args, { cwd: realDir, detached: true, stdio: 'ignore', windowsHide: false });
    child.unref();
    audit?.log('product.run', { sessionId: id, entry: real });
    emitConsole({ cat: 'system', code: 'product.run.started', data: { sessionId: id } });
    return { ok: true, executed: true, pid: child.pid || 0, entry: real };
  } catch (e) {
    return { ok: false, code: 'spawn-failed', error: sanitizeError(e), executed: false };
  }
});

/**
 * 项目环境台账（**本机侧**的执行记录）：记住这个项目用哪个容器 / 上次固化在哪一层。
 * ⚠️ 与"项目属性"分开存：
 *   · `settings.projectEnv` = **本机**的容器引用与固化历史（别的机器上不是同一份容器）；
 *   · `GroupRecord.project.env` = 随项目同步的**摘要**（成员据此看到"这个项目固化过"）。
 * 两边都只写**真发生过**的事；没发生过就不写（绝不编一个"已固化"）。
 */
function projectEnvLedgerOf(groupId: string): { runtimeId: string; containerRef?: string; lastImageRef?: string; lastSolidifiedAt?: number; solidifyHistory?: Array<{ imageRef: string; at: number }> } {
  try {
    const m = (settingsStore?.load()?.projectEnv || {})[String(groupId)] || null;
    if (m) return m;
  } catch {
    /* 拿不到就当没有 */
  }
  return { runtimeId: '' };
}

function writeProjectEnvLedger(
  groupId: string,
  patch: { runtimeId?: string; containerRef?: string; imageRef?: string; solidifiedAt?: number }
): void {
  try {
    const gid = String(groupId || '');
    if (!settingsStore || !gid) return;
    const all = { ...(settingsStore.load().projectEnv || {}) };
    const cur = all[gid] || { runtimeId: '' };
    const next = { ...cur };
    if (patch.runtimeId !== undefined) next.runtimeId = patch.runtimeId;
    if (patch.containerRef !== undefined) next.containerRef = patch.containerRef;
    if (patch.imageRef && patch.solidifiedAt) {
      next.lastImageRef = patch.imageRef;
      next.lastSolidifiedAt = patch.solidifiedAt;
      const hist = [...(cur.solidifyHistory || []), { imageRef: patch.imageRef, at: patch.solidifiedAt }];
      // 只留最近 N 个（与 ADR 的保留策略一致）；被裁掉的**只报告不删**（删镜像要用户明确同意）
      next.solidifyHistory = solidifyRetention(hist).keep;
    }
    all[gid] = next;
    settingsStore.save({ projectEnv: all } as never);
    // 同步给成员的**摘要**（项目级）
    setProjectAttrsOf(gid, {
      env: {
        ...(next.containerRef ? { containerRef: next.containerRef } : {}),
        ...(next.lastImageRef ? { imageRef: next.lastImageRef } : {}),
        ...(next.lastSolidifiedAt ? { solidifiedAt: next.lastSolidifiedAt } : {}),
      },
    });
  } catch {
    /* 记账失败不影响主流程，但也不假装成功（返回值里本来就没有"已固化"） */
  }
}

/** 项目容器现在在不在（真的问引擎，不猜） */
async function projectContainerStatusOf(groupId: string, runtimeId: string): Promise<{ running: boolean; exists: boolean; containerRef: string; raw: string }> {
  const name = containerProjectName(groupId);
  const r = await runContainerExec(runtimeId, 'ps', { name }, 30000);
  if (!r.executed) return { running: false, exists: false, containerRef: '', raw: r.err };
  const line = r.out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || '';
  const status = line.split('|')[2] || '';
  return { running: /(^|\s)Up\b/i.test(status), exists: !!line, containerRef: name, raw: line };
}

/** 确保项目容器存在（不存在就按项目镜像起一个，**默认不删** ⇒ 保留可写层） */
async function ensureProjectContainer(
  groupId: string,
  runtimeId: string,
  opts: { image?: string; hostDir?: string } = {}
): Promise<{ ok: boolean; code: string; containerRef: string; created: boolean; raw: string }> {
  const name = containerProjectName(groupId);
  const cur = await projectContainerStatusOf(groupId, runtimeId);
  if (cur.exists) return { ok: true, code: 'already-exists', containerRef: name, created: false, raw: cur.raw };
  // 镜像来源：优先用**上次固化出来的**那一层（真有才用），否则用镜像表里钉死 digest 的默认镜像
  const ledger = projectEnvLedgerOf(groupId);
  let image = String(opts.image || '');
  if (!image) {
    if (ledger.lastImageRef && isAllowedImageRef(ledger.lastImageRef)) image = ledger.lastImageRef;
    else {
      const nodeImg = CONTAINER_BASE_IMAGES.find((x) => x.id === 'node-24-slim');
      const minimal = CONTAINER_BASE_IMAGES.find((x) => x.id === 'alpine-3.20');
      const pick = nodeImg || minimal;
      image = pick && pick.digest ? `${pick.ref}@${pick.digest}` : '';
    }
  }
  if (!isAllowedImageRef(image)) return { ok: false, code: 'no-image', containerRef: name, created: false, raw: 'no allowed image reference available' };
  const dir = String(opts.hostDir || projectDirectoryOf(groupId).dir || '');
  const r = await runContainerExec(runtimeId, 'run-detached', {
    name,
    image,
    ...(dir && fs.existsSync(dir) ? { hostDir: dir } : {}),
    projectLabel: groupId,
  }, 180000);
  if (!r.ok) {
    return { ok: false, code: r.codeReason || 'run-failed', containerRef: name, created: false, raw: compactText(`${r.out} ${r.err}`, 300) };
  }
  writeProjectEnvLedger(groupId, { runtimeId, containerRef: name, ...(image ? {} : {}) });
  return { ok: true, code: 'created', containerRef: name, created: true, raw: r.out };
}

function compactText(s: string, max = 300): string {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * ADR 004 §7.8/§7.9（第八、九批 + 第十六批）：**项目环境状态**
 * （当前容器 / 能不能固化 / 上次固化时间 / 现在该不该固化 / 保留几个）。
 * 全部来自真实事实：运行时的固化能力（按运行时区分，**不假定 Linux 容器**）、
 * 真探测里的**引擎系统模式**、以及**真发生过的**固化记录（没发生过就不写）。
 */
handleIpc('warmy:project-env-status', async (_e, payload?: { sessionId?: string }) => {
  try {
    const id = String(payload?.sessionId || '');
    const state = await projectStateFor(id);
    const runtimeId = projectRuntimeOf(id);
    const cap = envSolidifyCapability(runtimeId);
    const ledger = projectEnvLedgerOf(id);
    const mode = engineOsModeOf(lastContainerProbeReport(), runtimeId);
    const container = state.devEnv === 'container' && runtimeId && state.running
      ? await projectContainerStatusOf(id, runtimeId)
      : { running: false, exists: false, containerRef: '', raw: '' };
    const decision = shouldSolidifyAt({
      lastSolidifiedAt: ledger.lastSolidifiedAt || 0,
      dirty: container.exists,
      programmatic: cap.programmatic,
    });
    const hist = ledger.solidifyHistory || [];
    return {
      ok: true,
      sessionId: id,
      devEnv: state.devEnv,
      runtimeId,
      /** 引擎的**真实系统模式**（docker 是 linux / windows；wsl 是某个发行版；拿不到 = unknown） */
      engineMode: mode,
      solidify: {
        kind: cap.kind,
        programmatic: cap.programmatic,
        why: cap.reason,
        lastImageRef: ledger.lastImageRef || '',
        lastSolidifiedAt: ledger.lastSolidifiedAt || 0,
        history: solidifyRetention(hist).keep,
        /** 保留策略：要**留着**的与可以手动清理的（我们不自作主张删镜像） */
        pruneCandidates: solidifyRetention(hist).prune,
        /** 现在该不该固化（节流 + 时机） */
        decision,
        keep: SOLIDIFY_KEEP,
        coalesceMs: SOLIDIFY_COALESCE_MS,
        /** 证据等级：有镜像引用 ⇒ 真的 commit 成功过（不是"点了就算"） */
        evidence: ledger.lastImageRef ? 'commit-succeeded' : 'none',
        security: ENV_SOLIDIFY_SECURITY,
      },
      /** 项目容器**真的在不在**（问过引擎，不是猜） */
      container: { ref: container.containerRef || containerProjectName(id), exists: container.exists, running: container.running, probeRaw: container.raw },
      /** 项目容器**默认保留**（长期存在、不用 --rm ⇒ 停止/启动保留可写层） */
      containerRetained: true,
      /** 环境维度与文件维度是**分层**的（不许对用户说"有容器回退点就更简单"） */
      layering: { fileRollbackIndependent: true, snapshotCoversProjectFiles: false },
    };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

/**
 * 「固化当前环境」（第九批 + 第十六批：**真的 commit**）。
 *
 * 真的做了：能力判定（Docker/Podman/nerdctl 可 commit；**WSL 没有 commit**）→ 节流判定
 * （45s 合并 / 显式按钮 / 销毁前一定固化一次）→ `commit` 项目容器 → **回读镜像 id 才算成功** →
 * 写台账（本机记录 + 项目级摘要）→ 只留最近 3 个（多的只**报告**不删）。
 *
 * 绝不撒谎的三条：
 *   · 没真的 commit 成功 ⇒ 证据等级是 `refused`，响应里 `executed:false`，**不写"已固化"记录**；
 *   · WSL / 系统服务 / 一次性沙箱 ⇒ 如实说"做不到"（能力表说了算）；
 *   · **安全提醒**随响应回传（commit 会把整个文件系统、可能包括密钥一起固化）。
 */
handleIpc('warmy:project-env-solidify', async (_e, payload?: { sessionId?: string; explicit?: boolean; beforeDestroy?: boolean }) => {
  try {
    const id = String(payload?.sessionId || '');
    const runtimeId = projectRuntimeOf(id);
    const cap = envSolidifyCapability(runtimeId);
    const ledger = projectEnvLedgerOf(id);
    const decision = shouldSolidifyAt({
      lastSolidifiedAt: ledger.lastSolidifiedAt || 0,
      dirty: true,
      explicit: payload?.explicit === true,
      beforeDestroy: payload?.beforeDestroy === true,
      programmatic: cap.programmatic,
    });
    const security = ENV_SOLIDIFY_SECURITY;
    if (cap.programmatic !== true) {
      return { ok: false, code: 'runtime-cannot-solidify', solidifyKind: cap.kind, why: cap.reason, executed: false, decision, evidence: 'refused', security };
    }
    if (!runtimeId) return { ok: false, code: 'no-runtime-chosen', executed: false, decision, evidence: 'refused', security };
    // 节流：窗口内不重复固化（除非这次是"销毁前/显式"—— 那两条 shouldSolidifyAt 已经放行）
    if (decision.solidify !== true) {
      return { ok: false, code: decision.code === 'coalesced' ? 'coalesced' : 'nothing-to-solidify', executed: false, decision, evidence: 'not-attempted', security };
    }
    // 容器必须真的在（不在就没东西可固化 —— 不自动起容器来"凑"一次固化）
    const container = await projectContainerStatusOf(id, runtimeId);
    if (!container.exists) {
      return {
        ok: false, code: 'no-container', executed: false, decision, evidence: 'refused',
        detail: 'the project container does not exist yet (start the project first)',
        containerRef: container.containerRef || containerProjectName(id), security,
      };
    }
    const at = Date.now();
    const imageRef = solidifiedImageRef(id, at);
    const commit = await runContainerExec(runtimeId, 'commit', { name: container.containerRef, imageRef }, 600000);
    if (!commit.ok) {
      return {
        ok: false, code: 'commit-failed', executed: true, evidence: 'refused', decision,
        detail: commit.codeReason || 'commit failed',
        rawOutput: compactText(`${commit.out} ${commit.err}`, 400),
        imageRef, security,
      };
    }
    // **回读**：拿镜像 id 才算真的固化成功（"命令 rc=0"不足以当证据）
    const inspect = await runContainerExec(runtimeId, 'image-inspect', { image: imageRef }, 60000);
    const imageId = inspect.ok ? String(inspect.out.split('|')[0] || '').trim() : '';
    if (!inspect.ok || !imageId) {
      return {
        ok: false, code: 'commit-unverified', executed: true, evidence: 'refused', decision, imageRef,
        detail: 'commit returned success but the image could not be read back',
        rawOutput: compactText(`${inspect.out} ${inspect.err}`, 300), security,
      };
    }
    writeProjectEnvLedger(id, { runtimeId, containerRef: container.containerRef, imageRef, solidifiedAt: at });
    audit?.log('container.project-solidify', { sessionId: id, runtimeId, imageRef });
    emitConsole({ cat: 'system', code: 'container.project.solidified', data: { sessionId: id, imageRef } });
    const hist = projectEnvLedgerOf(id).solidifyHistory || [];
    return {
      ok: true,
      executed: true,
      evidence: 'commit-succeeded',
      decision,
      imageRef,
      imageId,
      ms: commit.ms,
      containerRef: container.containerRef,
      solidifiedAt: at,
      history: solidifyRetention(hist).keep,
      pruneCandidates: solidifyRetention(hist).prune,
      /** 安全提醒：这次固化把当时的**整个文件系统**一起冻进去了（可能含密钥/缓存） */
      security,
      securityNotice: 'whole-filesystem-frozen',
    };
  } catch (e) {
    return { ok: false, error: sanitizeError(e), executed: false, evidence: 'refused' };
  }
});

/**
 * 「回滚到固化点」（第十六批）：从固化出来的镜像**真的起一个容器**。
 *
 * 与"文件回退点"是**分层**的两件事（ADR §8.5）：固化镜像只覆盖容器可写层，
 * **bind mount 的项目文件不在里面** —— 所以响应里把这条事实一起回给渲染层，别让用户误解。
 * 步骤：确保容器在（不在就按镜像起）→ 用指定/最近的固化镜像重建 → 回读容器 id。
 */
handleIpc('warmy:project-env-rollback', async (_e, payload?: { sessionId?: string; imageRef?: string }) => {
  try {
    const id = String(payload?.sessionId || '');
    const runtimeId = projectRuntimeOf(id);
    const cap = envSolidifyCapability(runtimeId);
    if (!runtimeId) return { ok: false, code: 'no-runtime-chosen', executed: false, evidence: 'refused' as const };
    if (cap.programmatic !== true) return { ok: false, code: 'runtime-cannot-solidify', why: cap.reason, executed: false, evidence: 'refused' as const };
    const ledger = projectEnvLedgerOf(id);
    const want = String(payload?.imageRef || ledger.lastImageRef || '');
    if (!want || !isAllowedImageRef(want)) {
      return { ok: false, code: 'no-solidified-point', executed: false, evidence: 'refused' as const, detail: 'no solidified image recorded for this project' };
    }
    const state = await projectStateFor(id);
    if (!state.running) {
      // 项目不可用 ⇒ 不越权起容器（那正是"等同创建者下线"要拦的事）
      return { ok: false, code: 'project-unavailable', projectCode: state.code, executed: false, evidence: 'refused' as const };
    }
    const name = containerProjectName(id);
    const cur = await projectContainerStatusOf(id, runtimeId);
    /**
     * 重建前**先固化一次**（"可能销毁容器之前一定固化一次"这条时机的落点）：
     * 不这么做，回滚就等于把用户刚装的东西丢掉。固化失败也**照实说**，但不挡住回滚本身。
     */
    let preSolidify: { ok: boolean; code: string; imageRef?: string } = { ok: false, code: 'skipped' };
    if (cur.exists) {
      const decision = shouldSolidifyAt({ lastSolidifiedAt: ledger.lastSolidifiedAt || 0, dirty: true, beforeDestroy: true, programmatic: cap.programmatic });
      if (decision.solidify) {
        const at = Date.now();
        const ref = solidifiedImageRef(id, at);
        const c = await runContainerExec(runtimeId, 'commit', { name, imageRef: ref }, 600000);
        const ins = c.ok ? await runContainerExec(runtimeId, 'image-inspect', { image: ref }, 60000) : null;
        const imgId = ins && ins.ok ? String(ins.out.split('|')[0] || '').trim() : '';
        if (c.ok && imgId) {
          writeProjectEnvLedger(id, { runtimeId, containerRef: name, imageRef: ref, solidifiedAt: at });
          preSolidify = { ok: true, code: 'before-destroy', imageRef: ref };
        } else {
          preSolidify = { ok: false, code: c.ok ? 'commit-unverified' : (c.codeReason || 'commit-failed') };
        }
      }
    }
    closeContainerShellSessionsOf(id);
    if (cur.exists) await runContainerExec(runtimeId, 'rm', { name }, 120000);
    const dir = projectDirectoryOf(id).dir;
    const run = await runContainerExec(runtimeId, 'run-detached', {
      name, image: want, ...(dir && fs.existsSync(dir) ? { hostDir: dir } : {}), projectLabel: id,
    }, 180000);
    if (!run.ok) {
      return {
        ok: false, code: run.codeReason || 'run-failed', executed: true, evidence: 'refused' as const,
        imageRef: want, rawOutput: compactText(`${run.out} ${run.err}`, 400), preSolidify,
      };
    }
    const after = await projectContainerStatusOf(id, runtimeId);
    audit?.log('container.project-rollback', { sessionId: id, runtimeId, imageRef: want });
    emitConsole({ cat: 'system', code: 'container.project.rolledback', data: { sessionId: id, imageRef: want } });
    return {
      ok: true,
      executed: true,
      /** 证据等级：真的从那个镜像起了一个容器（有名字 + 真实 ps 为证） */
      evidence: 'container-started' as const,
      imageRef: want,
      containerRef: name,
      containerRunning: after.running,
      ms: run.ms,
      preSolidify,
      /** 分层事实：环境回退 ≠ 文件回退（bind mount 的项目文件不在镜像里） */
      layering: { fileRollbackIndependent: true, snapshotCoversProjectFiles: false },
    };
  } catch (e) {
    return { ok: false, error: sanitizeError(e), executed: false, evidence: 'refused' as const };
  }
});

/**
 * ADR 004 P4（第十六批：**真的接上容器内执行**）：**容器内的 shell**（= 控制台本体）。
 *
 * 控制台**就是容器里的控制台**，其价值是给主机带来安全性防护；它**不是**应用内部事件日志
 * （那一版做错了，已撤销：事件日志降级为独立的诊断视图，见渲染层的 `#console-pane`）。
 *
 * 架构（产品主第七批定稿）：**AI 执行器留在主机，只把"用户项目的命令/工具执行"送进容器**
 * （即 `exec` 进那个项目容器）。所以镜像**不需要**因为"我们的执行器是 Node 写的"而塞 Node ——
 * 镜像按项目技术栈选（见 CONTAINER_BASE_IMAGES / CONTAINER_NODE_NEEDED_CASES）。
 *
 * 现在真的做了什么（每一步都能查证）：
 *   · `open`  ⇒ 确保项目容器存在（`docker run -d`，**默认不删** ⇒ 保留可写层）→ `docker exec -i sh`；
 *   · `write` ⇒ 把 data 写进那个 shell 的 **stdin**，并把容器回显的输出取回来（`executed:true`）；
 *   · `close` ⇒ 关掉 stdin（1.5s 后退不掉才杀我们自己的子进程）；
 *   · `status`⇒ 真的问引擎（`ps`）在不在，并回会话清单。
 * ⚠️ 本处理函数**自己不 spawn 任何东西**：所有进程都由 container-probe 的
 *    `runContainerExec` / `openContainerShellSession` 起（argv 由那张**固定命令表**拼）。
 *
 * 安全契约（逐条对应 CONTAINER_SHELL_SECURITY / CONTAINER_EXEC_SECURITY，并随响应回给渲染层）：
 *   只有本机的人手动输入才会执行；远程/群成员/智能体/网络内容没有注入路径；
 *   不自动执行；不把本机密钥类环境变量带进容器；**未就绪 ⇒ 一条命令都不执行**。
 */
handleIpc('warmy:container-shell', async (_e, payload?: { runtimeId?: string; action?: string; sessionId?: string; data?: string }) => {
  const norm = normalizeContainerShellRequest(payload);
  if (!norm.ok) {
    emitConsole({ cat: 'error', code: 'container.console.rejected', data: { code: norm.code } });
    return { ok: false, code: norm.code, error: norm.error, security: CONTAINER_SHELL_SECURITY, execSecurity: CONTAINER_EXEC_SECURITY };
  }
  const { req } = norm;
  const state = await projectStateFor(req.sessionId);
  const runtimeId = req.runtimeId || projectRuntimeOf(req.sessionId);
  const status = runtimeId ? await containerStatusOf(runtimeId) : null;
  const gate = containerShellGate({
    inProjectOrCattle: true,
    // 控制台只属于**容器开发**的项目（"运行/测试在容器中"那个选项已作废删除）
    runInContainer: state.devEnv === 'container',
    projectStopped: state.stopped,
    runtimeId,
    runtimeStatus: (status as never) ?? null,
    /**
     * 镜像来源**已经定了**：镜像表里钉死 digest 的基础镜像（+ 我们自己固化出来的层）。
     * 所以门禁的第 ⑤ 档不再长期成立 —— 引擎就绪就能真的开 shell（这条是本轮的实质变化）。
     */
    imageReady: !!runtimeId && state.devEnv === 'container' && isAllowedImageRef(defaultProjectImageRef()),
  });
  if (!gate.available) {
    if (req.action === 'write' || req.action === 'open') {
      emitConsole({ cat: 'error', code: 'container.console.refused', data: { code: gate.code, reasonKey: gate.reason, action: req.action } });
    }
    return {
      ok: false,
      code: gate.code,
      reasonKey: gate.reason,
      needsInstall: gate.needsInstall,
      executed: false, // 【核心】没就绪 ⇒ **一条命令都没执行**
      runtimeId,
      projectCode: state.code,
      security: CONTAINER_SHELL_SECURITY,
      execSecurity: CONTAINER_EXEC_SECURITY,
    };
  }

  const name = containerProjectName(req.sessionId);
  if (req.action === 'status') {
    const cur = await projectContainerStatusOf(req.sessionId, runtimeId);
    return {
      ok: true, code: 'ok', reasonKey: 'ok', executed: false, runtimeId, containerRef: cur.containerRef || name,
      containerExists: cur.exists, containerRunning: cur.running,
      sessionId: String(payload?.sessionId || ''),
      security: CONTAINER_SHELL_SECURITY, execSecurity: CONTAINER_EXEC_SECURITY,
    };
  }
  if (req.action === 'open') {
    const ensured = await ensureProjectContainer(req.sessionId, runtimeId);
    if (!ensured.ok) {
      emitConsole({ cat: 'error', code: 'container.console.refused', data: { code: ensured.code, action: 'open' } });
      return {
        ok: false, code: ensured.code, reasonKey: ensured.code === 'no-image' ? 'needsImage' : 'notReady',
        executed: false, runtimeId, containerRef: ensured.containerRef, rawOutput: ensured.raw,
        projectCode: state.code, security: CONTAINER_SHELL_SECURITY, execSecurity: CONTAINER_EXEC_SECURITY,
      };
    }
    // **解锁**宿主目录（如果这个项目被加过锁）：容器要在同一份 bind mount 上写，
    // 让锁和正在运行的容器同时存在会互相打脸（这条在 fsGuard 那边也写着）
    liftFsGuardIfAny(req.sessionId, 'container-started');
    const opened = openContainerShellSession({ groupId: req.sessionId, runtimeId, containerName: ensured.containerRef });
    if (!opened.ok) {
      emitConsole({ cat: 'error', code: 'container.console.refused', data: { code: opened.code, action: 'open' } });
      return {
        ok: false, code: opened.code || 'spawn-failed', reasonKey: 'notReady', executed: false,
        runtimeId, containerRef: ensured.containerRef, error: opened.error,
        security: CONTAINER_SHELL_SECURITY, execSecurity: CONTAINER_EXEC_SECURITY,
      };
    }
    emitConsole({ cat: 'system', code: 'container.console.opened', data: { sessionId: req.sessionId, containerRef: ensured.containerRef } });
    return {
      ok: true, code: 'ok', reasonKey: 'ok', executed: true, runtimeId, containerRef: ensured.containerRef,
      sessionId: opened.sessionId, /** 真的是容器里的 shell（不是宿主 shell、不是事件日志） */
      insideContainer: true, containerCreated: ensured.created,
      security: CONTAINER_SHELL_SECURITY, execSecurity: CONTAINER_EXEC_SECURITY,
    };
  }
  if (req.action === 'close') {
    // `sessionId` 既可以是 shell 会话 id，也可以是项目 id（container-probe 侧两者都能解析）
    const r = closeContainerShellSession(req.sessionId || String(payload?.sessionId || ''));
    return {
      ok: true, code: 'ok', reasonKey: 'ok', executed: r.closed, runtimeId, containerRef: name,
      closed: r.closed, security: CONTAINER_SHELL_SECURITY, execSecurity: CONTAINER_EXEC_SECURITY,
    };
  }
  // write：真的写进那个 shell 的 stdin
  const wrote = await writeContainerShellSession(req.sessionId, req.data);
  if (!wrote.ok) {
    // 会话没了 ⇒ 如实说"得先打开"，**不**偷偷开一条新的（那会绕过用户的重启意图）
    return {
      ok: false, code: wrote.code || 'no-session', reasonKey: 'notReady', executed: false,
      runtimeId, containerRef: name, error: wrote.error, output: '',
      security: CONTAINER_SHELL_SECURITY, execSecurity: CONTAINER_EXEC_SECURITY,
    };
  }
  emitConsole({ cat: 'tool', code: 'container.console.exec', data: { sessionId: req.sessionId, bytes: req.data.length } });
  /**
   * 「一条控制台命令之后」这个固化时机（ADR §8.6 的时机表之一）：
   * 只在**节流窗口外**且确实该固化时才真的 commit（45s 合并，避免"敲一行就固化一个镜像"）。
   * 失败不影响命令本身的返回（如实附带 autoSolidify 结果）。
   */
  const autoSolidify = await maybeSolidifyAfterConsole(req.sessionId, runtimeId);
  /**
   * 容器里的命令**真的可能改了项目文件** ⇒ 如实记一条台账（项目级、成员可见）。
   * 我们只记"发生过一次容器内命令"这个事实 + 挂载点，**不假装知道具体改了哪个文件**
   * （容器里没有文件系统审计，编一个路径出来比不记更糟）。
   */
  const dir = projectDirectoryOf(req.sessionId).dir;
  if (dir) {
    noteExternalFileAccessReq(req.sessionId, 'write', `${dir}${path.sep}${CONTAINER_PROJECT_MOUNT.replace(/^\//, '')}`, { by: 'container-shell' });
  }
  return {
    ok: true, code: 'ok', reasonKey: 'ok', executed: true, runtimeId, containerRef: name,
    output: wrote.output || '', autoSolidify,
    security: CONTAINER_SHELL_SECURITY, execSecurity: CONTAINER_EXEC_SECURITY,
  };
});

/** 默认项目镜像引用（镜像表里带 Node 的那个；取不到就退回最小镜像） */
function defaultProjectImageRef(): string {
  const nodeImg = CONTAINER_BASE_IMAGES.find((x) => x.id === 'node-24-slim' && x.digest);
  const min = CONTAINER_BASE_IMAGES.find((x) => x.digest);
  const pick = nodeImg || min;
  return pick && pick.digest ? `${pick.ref}@${pick.digest}` : '';
}

/** 记一条外部（容器侧）文件访问到项目台账 */
function noteExternalFileAccessReq(groupId: string, op: 'write' | 'edit' | 'create' | 'delete' | 'read', file: string, extra: { by?: string } = {}): void {
  try {
    const gid = String(groupId || '');
    if (!groupStore || !gid) return;
    groupStore.recordFileAccess(gid, { op, path: String(file), ts: Date.now(), ok: true, by: extra.by || 'container' });
    void publishProjectAttrs(gid);
  } catch {
    /* 记账失败不影响执行 */
  }
}

/**
 * 「一条控制台命令之后」的固化时机：只在**该固化**且**真的成功**时写台账。
 * 返回结构化结果（渲染层可以如实显示"这一轮顺带固化了一次"或"被节流了"）。
 */
async function maybeSolidifyAfterConsole(
  groupId: string,
  runtimeId: string
): Promise<{ attempted: boolean; done: boolean; code: string; imageRef?: string }> {
  try {
    const cap = envSolidifyCapability(runtimeId);
    const ledger = projectEnvLedgerOf(groupId);
    const decision = shouldSolidifyAt({ lastSolidifiedAt: ledger.lastSolidifiedAt || 0, dirty: true, programmatic: cap.programmatic });
    if (!decision.solidify) return { attempted: false, done: false, code: decision.code };
    const name = containerProjectName(groupId);
    const cur = await projectContainerStatusOf(groupId, runtimeId);
    if (!cur.exists) return { attempted: false, done: false, code: 'no-container' };
    const at = Date.now();
    const ref = solidifiedImageRef(groupId, at);
    const c = await runContainerExec(runtimeId, 'commit', { name, imageRef: ref }, 600000);
    if (!c.ok) return { attempted: true, done: false, code: c.codeReason || 'commit-failed' };
    const ins = await runContainerExec(runtimeId, 'image-inspect', { image: ref }, 60000);
    const imgId = ins.ok ? String(ins.out.split('|')[0] || '').trim() : '';
    if (!imgId) return { attempted: true, done: false, code: 'commit-unverified' };
    writeProjectEnvLedger(groupId, { runtimeId, containerRef: name, imageRef: ref, solidifiedAt: at });
    emitConsole({ cat: 'system', code: 'container.project.solidified', data: { sessionId: groupId, imageRef: ref, trigger: 'after-console' } });
    return { attempted: true, done: true, code: 'after-console', imageRef: ref };
  } catch (e) {
    return { attempted: true, done: false, code: 'error:' + sanitizeError(e) };
  }
}

/**
 * 「把项目的命令送进容器」（第十六批）：在项目容器里跑一条**固定命令**（枚举），
 * 用于环境探测 / 证明工具调用真的跑在容器里。
 * ⚠️ 参数里**没有命令字符串**：`command` 只能取 `CONTAINER_FIXED_COMMAND_IDS` 里的 id。
 */
handleIpc('warmy:project-exec', async (_e, payload?: { sessionId?: string; command?: string }) => {
  try {
    const id = String(payload?.sessionId || '');
    const command = String(payload?.command || 'env-probe');
    if (!CONTAINER_FIXED_COMMAND_IDS.includes(command as ContainerFixedCommandId)) {
      return { ok: false, code: 'bad-command', executed: false, error: `command must be one of ${CONTAINER_FIXED_COMMAND_IDS.join('|')}` };
    }
    const state = await projectStateFor(id);
    const runtimeId = projectRuntimeOf(id);
    if (state.devEnv !== 'container' || state.stopped || !runtimeId) {
      // **绝不静默退回宿主执行**：项目不可用 ⇒ 直接拒绝（这就是那条硬纪律）
      return { ok: false, code: 'project-unavailable', projectCode: state.code, executed: false, hostExecutionRefused: true };
    }
    const status = await containerStatusOf(runtimeId);
    if (status !== 'ready') return { ok: false, code: 'container-not-ready', executed: false, needsInstall: true };
    const ensured = await ensureProjectContainer(id, runtimeId);
    if (!ensured.ok) return { ok: false, code: ensured.code, executed: false, containerRef: ensured.containerRef, rawOutput: ensured.raw };
    liftFsGuardIfAny(id, 'container-started');
    const r = await runContainerExec(runtimeId, 'exec-capture', { name: ensured.containerRef, command }, 120000);
    emitConsole({ cat: 'tool', code: 'container.project.exec', data: { sessionId: id, command, ok: r.ok } });
    return {
      ok: r.ok,
      executed: r.executed,
      /** 结果**来自容器**（`insideContainer:true` 是事实，不是文案） */
      insideContainer: true,
      command,
      containerRef: ensured.containerRef,
      code: r.code,
      output: r.out,
      error: r.err,
      ms: r.ms,
      codeReason: r.codeReason,
      security: CONTAINER_EXEC_SECURITY,
      fixedCommands: CONTAINER_FIXED_COMMAND_IDS,
    };
  } catch (e) {
    return { ok: false, error: sanitizeError(e), executed: false };
  }
});

/**
 * 「设置项目目录」（第十六批）：把项目目录记进**项目记录**（产品级事实，成员可见）。
 *
 * 为什么需要它：`GroupRecord` 之前**没有目录字段**，所以"最近改动文件 / 其他文件 / 产物目录"
 * 三块都没有一个解析根（ADR §8.3 的第二个数据源缺口）。现在由创建者选一次目录，
 * 记录进项目记录并同步给成员 —— 成员那边也能按同一个根解析。
 * 安全：只接受 `{ sessionId }`，目录**由主进程弹系统对话框选**（渲染层给不了任意路径）。
 */
handleIpc('warmy:project-set-directory', async (_e, payload?: { sessionId?: string; dir?: string }) => {
  try {
    const id = String(payload?.sessionId || '');
    if (!localIsProjectCreator(id)) {
      return { ok: false, code: 'not-creator', error: 'only the creator can set the project directory' };
    }
    let dir = String(payload?.dir || '');
    if (!dir) {
      if (!win) return { ok: false, code: 'no-window', error: 'no window' };
      const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
      if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
      dir = r.filePaths[0];
    }
    if (!path.isAbsolute(dir) || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      return { ok: false, code: 'bad-dir', error: 'directory does not exist' };
    }
    const w = setProjectAttrsOf(id, { directory: dir, directorySource: 'creator-picked' });
    if (!w.ok) return { ok: false, code: 'cannot-persist', error: w.error };
    audit?.log('container.project-set-directory', { sessionId: id });
    const facts = await projectFilesFor(id);
    return { ok: true, dir, projectDirReason: facts.projectDirReason, projectSource: facts.projectSource };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

/**
 * 「工具文件访问台账」（第十六批）：**项目级、成员可见**的读取入口。
 * 产品主的原话：**「记录文件的改动应该是无限牛马的功能，不是本机的功能」**
 * ⇒ 台账存在项目记录里、会随项目同步给成员，所以成员也能看到"谁改了什么、什么时候改的"。
 */
handleIpc('warmy:project-ledger', (_e, payload?: { sessionId?: string; limit?: number }) => {
  try {
    const id = String(payload?.sessionId || '');
    const rows = groupStore?.listFileAccess(id, Number(payload?.limit) || 200) || [];
    const attrs = projectAttrsOf(id);
    const dir = attrs.directory;
    return {
      ok: true,
      sessionId: id,
      /** 成员可见的台账（项目级） */
      entries: rows.map((e2) => ({
        op: e2.op, path: e2.path, ts: e2.ts, ok: e2.ok, by: e2.by,
        ...(e2.bytes ? { bytes: e2.bytes } : {}),
        scope: dir && path.resolve(e2.path).startsWith(path.resolve(dir) + path.sep) ? 'project' : 'other',
      })),
      projectDir: dir,
      projectDirReason: attrs.directory ? attrs.directorySource : 'not-recorded',
      projectSource: projectAttrsAreRemote(id) ? 'creator-signal' : 'local',
      /** 台账的归属是项目而不是本机 —— 把这条事实一起回给渲染层（可断言） */
      scope: 'project',
      entryLimit: 200,
    };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   宿主侧目录加锁（P5）：把"宿主侧不许编辑"从**应用内拒绝**推进到**文件系统**
   ---------------------------------------------------------------------------
   背景（ADR 004 §7.1 的诚实边界）：应用侧能拒绝自己写，拦不住用户用外部编辑器改。
   实现（最小侵入 + 可撤销，见 container-probe.HOST_DIR_GUARD_SECURITY）：
     · **只有用户显式按键**才加锁（绝不自动加）；Windows 上用一条继承式 deny ACE
       （`icacls <dir> /deny *<sid>:(OI)(CI)(W)`）挂在项目目录根上；
     · 撤销 = `icacls <dir> /remove:d *<sid>`（一条命令；目录属主永远能改自己的 DACL）；
     · 记录写在本机设置 `fsGuard[groupId]`（ACL 是本机事实，不是项目属性）；
     · **容器一启动就自动解锁**（容器要在同一份 bind mount 上写，锁着会互相打脸），
       并在响应里如实说明"因为容器启动了所以解锁了"。
   做不到的（如实写在 UI 里）：这不是加密/沙箱，同机管理员与系统进程照样能写。
   ══════════════════════════════════════════════════════════════════════════ */

/** 当前用户的 SID（`whoami /user` 的真实输出；拿不到就不给加锁入口） */
async function currentUserSid(): Promise<string> {
  if (process.platform !== 'win32') return '';
  return new Promise((resolve) => {
    try {
      const child = execFile('whoami', ['/user', '/fo', 'csv', '/nh'], { windowsHide: true, timeout: 15000, encoding: 'utf8' }, (err, stdout) => {
        if (err) return resolve('');
        const m = String(stdout || '').match(/(S-1-\d+(?:-\d+)+)/);
        resolve(m && m[1] ? m[1] : '');
      });
      child.on('error', () => resolve(''));
    } catch {
      resolve('');
    }
  });
}

async function runIcacls(plan: { file: string; args: string[] }): Promise<{ ok: boolean; code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    try {
      execFile(plan.file, plan.args, { windowsHide: true, timeout: 120000, maxBuffer: 1 << 22, encoding: 'utf8' }, (err, stdout, stderr) => {
        if (!err) return resolve({ ok: true, code: 0, out: String(stdout || '').trim(), err: String(stderr || '').trim() });
        const e2 = err as NodeJS.ErrnoException & { code?: number | string };
        resolve({ ok: false, code: typeof e2.code === 'number' ? e2.code : null, out: String(stdout || '').trim(), err: String(stderr || e2.message || '').trim() });
      });
    } catch (e) {
      resolve({ ok: false, code: null, out: '', err: sanitizeError(e) });
    }
  });
}

function fsGuardRecordOf(groupId: string): { dir: string; sid: string; appliedAt: number; liftedAt?: number } | null {
  try {
    const m = (settingsStore?.load()?.fsGuard || {})[String(groupId)];
    return m || null;
  } catch {
    return null;
  }
}

function writeFsGuardRecord(groupId: string, rec: { dir: string; sid: string; appliedAt: number; liftedAt?: number } | null): void {
  try {
    if (!settingsStore) return;
    const all = { ...(settingsStore.load().fsGuard || {}) };
    if (rec) all[String(groupId)] = rec;
    else delete all[String(groupId)];
    settingsStore.save({ fsGuard: all } as never);
  } catch {
    /* 记不上就不记（下一次 status 会如实报"查不到记录"） */
  }
}

/** 容器一启动就解锁（如果这个项目被加过锁）；如实返回发生了什么 */
function liftFsGuardIfAny(groupId: string, reason: string): { lifted: boolean; dir?: string } {
  const rec = fsGuardRecordOf(groupId);
  if (!rec || rec.liftedAt) return { lifted: false };
  try {
    const plan = hostDirGuardPlan({ action: 'lift', dir: rec.dir, sid: rec.sid });
    if (!plan.ok) return { lifted: false };
    const r = runIcaclsSync(plan.plan);
    if (!r.ok) return { lifted: false };
    writeFsGuardRecord(groupId, { ...rec, liftedAt: Date.now() });
    audit?.log('container.fs-guard.lift', { sessionId: groupId, reason });
    emitConsole({ cat: 'system', code: 'container.fsGuard.lifted', data: { sessionId: groupId, reason } });
    return { lifted: true, dir: rec.dir };
  } catch {
    return { lifted: false };
  }
}

/** 同步跑一次 icacls（"启动容器之前"这条关键路径必须先把锁摘掉） */
function runIcaclsSync(plan: { file: string; args: string[] }): { ok: boolean; err: string } {
  try {
    execFileSync(plan.file, plan.args, { windowsHide: true, timeout: 60000, stdio: 'ignore' });
    return { ok: true, err: '' };
  } catch (e) {
    return { ok: false, err: sanitizeError(e) };
  }
}

/**
 * 「锁定 / 解锁项目目录」（右键菜单，**只有创建者**）：
 *   · `status` = 只读查询（目录 + SID + 加锁记录 + 当前那条 ACE 在不在）；
 *   · `apply`  = 真的加锁（一条继承式 deny ACE）；
 *   · `lift`   = 真的撤销（一条 `/remove:d`）—— **永远给出还原路径**。
 */
handleIpc('warmy:project-fs-guard', async (_e, payload?: { sessionId?: string; action?: string }) => {
  try {
    const id = String(payload?.sessionId || '');
    const action = String(payload?.action || 'status');
    if (!['apply', 'lift', 'status'].includes(action)) return { ok: false, code: 'bad-action', error: 'action must be apply|lift|status' };
    if (action !== 'status' && !localIsProjectCreator(id)) {
      return { ok: false, code: 'not-creator', error: 'only the creator can lock or unlock the project directory' };
    }
    const attrs = projectAttrsOf(id);
    const dir = attrs.directory;
    const rec = fsGuardRecordOf(id);
    const sid = await currentUserSid();
    const base = {
      ok: true,
      sessionId: id,
      action,
      dir: dir || '',
      dirReason: attrs.directory ? attrs.directorySource : 'not-recorded',
      sid,
      /** 只有容器开发项目才谈得上"宿主侧不该改" */
      devEnv: attrs.devEnv,
      record: rec,
      /** 平台能力：非 Windows 如实说做不到（不假装） */
      platformSupported: process.platform === 'win32' && !!sid,
      security: HOST_DIR_GUARD_SECURITY,
      notes: {
        userInitiatedOnly: true,
        undo: 'icacls <dir> /remove:d *<sid>  (one command; the owner can always change their own DACL)',
        limitations: 'not encryption/sandbox; admin and system processes can still write',
      },
    };
    if (!dir) return { ...base, ok: false, code: 'no-project-dir', error: 'project directory is not recorded yet' };
    if (attrs.devEnv !== 'container') return { ...base, ok: false, code: 'not-container-project', error: 'only container-dev projects can lock their host directory' };
    if (process.platform !== 'win32' || !sid) return { ...base, ok: false, code: 'platform-not-supported', error: 'locking is only implemented on Windows (icacls)' };

    if (action === 'status') {
      const plan = hostDirGuardPlan({ action: 'status', dir, sid });
      if (!plan.ok) return { ...base, ok: false, code: plan.code, error: plan.error };
      const r = await runIcacls(plan.plan);
      const denies = String(r.out || '')
        .split(/\r?\n/)
        .filter((l) => /\(DENY\)/i.test(l))
        .map((l) => compactText(l, 200));
      return {
        ...base,
        ok: true,
        /** 文件系统层面**现在**是不是锁着（读真实 ACL，不看我们的记录） */
        guarded: r.ok && denies.length > 0,
        denyEntries: denies.slice(0, 5),
        raw: compactText(r.out || r.err, 500),
        /**
         * 记录与事实不一致时**如实标出来**（例如用户自己在应用外改了 ACL）：
         * 这是我们"不假装锁着"的判据。
         */
        recordMatchesFilesystem: rec ? (r.ok && denies.length > 0 && !rec.liftedAt) : false,
      };
    }

    if (action === 'apply') {
      if (rec && !rec.liftedAt) return { ...base, ok: true, guarded: true, already: true };
      const plan = hostDirGuardPlan({ action: 'apply', dir, sid });
      if (!plan.ok) return { ...base, ok: false, code: plan.code, error: plan.error };
      const r = await runIcacls(plan.plan);
      if (!r.ok) return { ...base, ok: false, code: 'icacls-failed', error: compactText(r.err, 300) };
      writeFsGuardRecord(id, { dir, sid, appliedAt: Date.now() });
      audit?.log('container.fs-guard.apply', { sessionId: id });
      emitConsole({ cat: 'system', code: 'container.fsGuard.applied', data: { sessionId: id } });
      return { ...base, ok: true, guarded: true, appliedAt: Date.now(), denies: plan.plan.denies };
    }

    // lift
    const plan = hostDirGuardPlan({ action: 'lift', dir, sid });
    if (!plan.ok) return { ...base, ok: false, code: plan.code, error: plan.error };
    const r = await runIcacls(plan.plan);
    if (!r.ok) return { ...base, ok: false, code: 'icacls-failed', error: compactText(r.err, 300) };
    writeFsGuardRecord(id, { dir, sid, appliedAt: rec ? rec.appliedAt : Date.now(), liftedAt: Date.now() });
    audit?.log('container.fs-guard.lift', { sessionId: id, reason: 'user' });
    emitConsole({ cat: 'system', code: 'container.fsGuard.lifted', data: { sessionId: id, reason: 'user' } });
    return { ...base, ok: true, guarded: false, liftedAt: Date.now() };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

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

/** Read skill auto-discovery directories from the EXISTING settings channel. */
function loadSkillScanDirs(): string[] {
  try {
    const s = settingsStore?.load() as { skillScanDirs?: unknown } | undefined;
    const dirs = s && Array.isArray(s.skillScanDirs) ? s.skillScanDirs : [];
    return dirs.map((d) => String(d || '').trim()).filter(Boolean).slice(0, SKILL_SCAN_DIRS_MAX);
  } catch {
    return [];
  }
}

/** Honest per-directory status: missing / not-a-directory / read-failed are reported, never silently ignored. */
function skillScanStatus(dirs: string[]): Array<{ path: string; ok: boolean; error: string | null; skillCount: number }> {
  return dirs.map((p) => {
    const abs = path.resolve(p);
    if (!fs.existsSync(abs)) return { path: p, ok: false, error: 'missing', skillCount: 0 };
    let st: import('node:fs').Stats;
    try {
      st = fs.statSync(abs);
    } catch {
      return { path: p, ok: false, error: 'stat-failed', skillCount: 0 };
    }
    if (!st.isDirectory()) return { path: p, ok: false, error: 'not-a-directory', skillCount: 0 };
    let skillCount = 0;
    try {
      // Directory itself may be a skill (contains SKILL.md)
      if (fs.existsSync(path.join(abs, 'SKILL.md'))) skillCount += 1;
      const subs = fs.readdirSync(abs, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
      for (const d of subs) {
        if (fs.existsSync(path.join(abs, d, 'SKILL.md'))) skillCount += 1;
      }
    } catch {
      return { path: p, ok: false, error: 'read-failed', skillCount: 0 };
    }
    return { path: p, ok: true, error: null, skillCount };
  });
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
  // Auto-discovery directories (source = 'discovered'); invalid paths are kept out of the
  // scan roots but reported via skillScanStatus on skills-list / skills-scan-dirs-get.
  for (const dir of loadSkillScanDirs()) {
    try {
      const abs = path.resolve(dir);
      if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
        roots.push({ root: abs, source: 'discovered' });
      }
    } catch {
      /* status is reported separately */
    }
  }
  return roots;
}

handleIpc('warmy:skills-list', () => {
  const skills: Array<Record<string, unknown>> = [];
  const scanDirStatus = skillScanStatus(loadSkillScanDirs());
  const enabledMap = ((): Record<string, boolean> => {
    try {
      const s = settingsStore?.load() as { skillEnabled?: Record<string, boolean> } | undefined;
      return s?.skillEnabled && typeof s.skillEnabled === 'object' ? { ...s.skillEnabled } : {};
    } catch { return {}; }
  })();
  for (const { root, source } of skillRoots()) {
    if (!fs.existsSync(root)) continue;
    const pushOne = (dirName: string, md: string) => {
      const info = skillMdInfo(md);
      let mtime = 0;
      try {
        mtime = fs.statSync(md).mtimeMs;
      } catch {
        /* 忽略 */
      }
      const id = source === 'discovered' ? 'discovered:' + path.basename(root) + ':' + dirName : dirName;
      const enabled = enabledMap[id] !== false;
      skills.push({
        id,
        name: info.name || dirName,
        description: info.description,
        source,
        root,
        mtime,
        enabled,
        removable: source !== 'discovered',
      });
    };
    // A discovered root may itself be a skill package (SKILL.md at the root)
    if (source === 'discovered') {
      const selfMd = path.join(root, 'SKILL.md');
      if (fs.existsSync(selfMd)) pushOne(path.basename(root), selfMd);
    }
    let dirs: string[] = [];
    try {
      dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      continue;
    }
    for (const d of dirs) {
      const md = path.join(root, d, 'SKILL.md');
      if (!fs.existsSync(md)) continue;
      pushOne(d, md);
    }
  }
  skills.sort((x, y) => Number(y.mtime || 0) - Number(x.mtime || 0));
  return { ok: true, skills, scanDirs: scanDirStatus, maxScanDirs: SKILL_SCAN_DIRS_MAX };
});

handleIpc('warmy:skills-scan-dirs-get', () => {
  const dirs = loadSkillScanDirs();
  return { ok: true, dirs, scanDirs: skillScanStatus(dirs), max: SKILL_SCAN_DIRS_MAX };
});

handleIpc('warmy:skills-scan-dirs-set', (_e, dirs: unknown) => {
  const list = Array.isArray(dirs) ? dirs.map((d) => String(d || '').trim()).filter(Boolean) : [];
  if (list.length > SKILL_SCAN_DIRS_MAX) {
    return { ok: false, error: 'too-many-dirs', max: SKILL_SCAN_DIRS_MAX, count: list.length };
  }
  try {
    const next = settingsStore?.save({ skillScanDirs: list } as never);
    return { ok: true, dirs: list, scanDirs: skillScanStatus(list), settings: next };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});


handleIpc('warmy:skills-import', async () => {
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

handleIpc('warmy:skills-paths', () => safeHandle(() => ({ ok: true, paths: skillRoots().map((r) => r.root), scanDirs: skillScanStatus(loadSkillScanDirs()) }), { ok: true, paths: [], scanDirs: [] }))

handleIpc('warmy:skills-remove', (_e, id: string) => {
  try {
    // 删除也是写操作：与导入共用同一把租约（否则导入中途被删 = 半个目录）
    // Discovered skills live in user-owned auto-discovery directories — never delete those sources.
    if (String(id || '').startsWith('discovered:')) {
      return { ok: false, error: 'discovered-skill-not-removable' };
    }
    const guarded = withLease('skills', ['skills'], () => {
      for (const { root, source } of skillRoots()) {
        if (source === 'discovered') continue;
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

handleIpc('warmy:profile-get', () => safeHandle(() => ({ ok: true, profile: accountStore?.loadProfile() }), { ok: true, profile: undefined }))
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
handleIpc('warmy:app-info', () => {
  try {
    const st = accountStore?.idStatus();
    return {
      ok: true,
      name: '无限牛马',
      enName: 'WArmy',
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
handleIpc('warmy:profile-save', (_e, p: { username: string; email: string; avatarDataUrl?: string }) => {
  try {
    const prev = accountStore?.loadProfile();
    const next = { ...prev!, ...p };
    return { ok: true, profile: accountStore?.saveProfile(next) };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});
handleIpc('warmy:profile-set-password', (_e, pw: string) => {
  try {
    accountStore?.setPassword(pw);
    return { ok: true };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});
handleIpc('warmy:profile-login', (_e, pw: string) => {
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
handleIpc('warmy:identity-info', () =>
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
handleIpc('warmy:identity-rotate', (_e, payload: { reason?: string; passphrase?: string } = {}) => {
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
handleIpc('warmy:identity-card-history', () =>
  safeHandle(() => ({ ok: true, history: identityStore?.contactCardHistory() ?? [], freeze: identityStore?.contactFreeze() ?? null }), { ok: true, history: [], freeze: null }),
);

/**
 * 接收方侧：记录对方的名片（加入时交换 / 换证后补发）。
 * 首次加入直接留存、**不冻结**；处于冻结期则只记为 pending，展示继续用本机留存值。
 */
handleIpc('warmy:identity-peer-card', (_e, payload: { fingerprint?: string; card?: ContactCard; signedCard?: IdentityCard } = {}) => {
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
  'warmy:identity-peer-rotation',
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
handleIpc('warmy:identity-peer-contact', (_e, fingerprint: string) =>
  safeHandle(() => ({ ok: true, peer: fingerprint ? identityStore?.peerContact(fingerprint) ?? null : null }), { ok: true, peer: null }),
);

/**
 * 接收方侧：**手动确认**采用对方的新名片（冻结期结束后才生效）。
 * 对应 UI 文案「冻结期已结束，但不会自动采用新值——需要你手动确认」。
 */
handleIpc('warmy:identity-peer-confirm', (_e, fingerprint: string) => {
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
handleIpc('warmy:identity-backup-export', (_e, payload: { passphrase?: string; writeFile?: boolean } = {}) => {
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
handleIpc('warmy:identity-set-passphrase', (_e, payload: { passphrase?: string; currentPassphrase?: string } = {}) => {
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
  'warmy:identity-verify-rotation',
  (_e, payload: { declaration?: IdentityDeclaration; knownKeys?: KeyRingEntry[]; currentGeneration?: number } = {}) => {
    try {
      const d = payload?.declaration;
      if (!d) return { ok: false, error: 'declaration-required' };
      if (d.kind === 'warmy.identity.revocation') {
        const r = verifyRevocationDeclaration(d);
        return { ok: true, kind: d.kind, accepted: r.accepted, reason: r.reason, warnings: r.warnings, honestNote: r.honestNote, detail: r.detail ?? '' };
      }
      const r = verifyRotationDeclaration(d as RotationDeclaration, {
        ...(payload?.knownKeys ? { knownKeys: payload.knownKeys } : {}),
        ...(typeof payload?.currentGeneration === 'number' ? { currentGeneration: payload.currentGeneration } : {}),
      });
      return {
        ok: true,
        kind: 'warmy.identity.rotation',
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
handleIpc('warmy:save-voice', async (_e, data: { dataUrl: string; ext?: string }) => {
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
handleIpc('warmy:nodes-list', () => safeHandle(() => ({ ok: true, nodes: nodeReg?.list() || [] }), { ok: true, nodes: [] }))
handleIpc('warmy:nodes-pair', (_e, nodeId: string, name: string) => ({
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
handleIpc('warmy:identity-changes', (_e, payload: { scope?: string } = {}) => {
  try {
    if (!identityStore) return { ok: false, error: 'identity-unavailable', changes: [] };
    void payload;
    const changes = buildIdentityChangeEntries(identityStore, {
      now: Date.now(),
      acks: readChangeAcks(),
      // 成员表给了才能把「某个指纹换了证」精确定位到群/项目（scopes）；
      // 拿不到映射时 computeChangeScopes 会如实退回 [{kind:'all'}] 并标 scopeBasis
      membership: membershipStoreFor(identityStore),
      directory: groupStore,
    });
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
handleIpc('warmy:identity-change-ack', (_e, payload: { changeId?: string; level?: 'dismiss' | 'verified' } = {}) => {
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
// ── D2. 成员证书 / 吊销列表（ADR §2.3 第 6 条 + §附八.8 + §附五.1 第四层） ──
//
// 这里只做**接线**：协议与验签在 `@warmy/sync-protocol` 的 membership.ts（可单测），
// 签发/换证/吊销的编排在 identity-provider.ts。主进程只回结构化数据 + 错误码，**不拼文案**。

/** 该群的创建者（群主）指纹：群记录里有就用它，否则用本机已钉住的那个 */
function expectedIssuerFor(groupId: string): string {
  const fromGroup = groupStore?.getGroup(groupId)?.creatorFingerprint ?? '';
  if (fromGroup) return fromGroup;
  return membershipStoreFor(identityStore)?.groupState(groupId)?.issuerFingerprint ?? '';
}

/** 用本机身份（必须是该群创建者且已解锁）为成员签发证书 */
async function issueMemberCertForGroup(
  groupId: string,
  input: {
    memberFingerprint: string;
    memberPublicKey: string;
    displayName?: string;
    role?: 'creator' | 'admin' | 'member';
    memberId?: string;
    supersedes?: string;
    ttlMs?: number;
  }
): Promise<{ ok: boolean; code: string; cert?: { certId: string; memberFingerprint: string; expiresAt: number }; detail?: string }> {
  const membership = membershipStoreFor(identityStore);
  if (!membership || !identityStore) return { ok: false, code: 'identity-missing' };
  const signer = createIdentitySigner(identityStore);
  const expect = expectedIssuerFor(groupId);
  if (expect && !fingerprintMatches(expect, signer.fingerprint)) {
    // 本机不是该群的创建者 → 无权签发（星型拓扑里只有群主能发证书）
    // 诊断串用 ASCII（主进程不拼面向用户的文字；界面文案一律走 i18n）
    return { ok: false, code: 'not-the-creator', detail: `issuer=${expect} local=${signer.fingerprint}` };
  }
  const r = await issueMemberCertificate({
    signer,
    membership,
    groupId,
    memberFingerprint: input.memberFingerprint,
    memberPublicKey: input.memberPublicKey,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.role ? { role: input.role } : {}),
    ...(input.memberId ? { memberId: input.memberId } : {}),
    ...(input.supersedes ? { supersedes: input.supersedes } : {}),
    ...(input.ttlMs ? { ttlMs: input.ttlMs } : {}),
    ...(expect ? { expectIssuerFingerprint: expect } : {}),
  });
  if (!r.ok || !r.cert) return { ok: false, code: r.code, detail: r.detail };
  audit?.log('membership.cert.issued', {
    groupId,
    certId: r.cert.certId,
    member: r.cert.memberFingerprint,
    supersedes: r.cert.supersedes ?? '',
  });
  return {
    ok: true,
    code: r.code,
    cert: { certId: r.cert.certId, memberFingerprint: r.cert.memberFingerprint, expiresAt: r.cert.expiresAt },
  };
}

/** 把新版吊销列表广播给在线成员（走**已鉴权**通道；失败不重试，与本设计一致） */
async function broadcastRevocationList(groupId: string, list: unknown): Promise<{ sent: number; failed: number } | null> {
  try {
    if (!secureMesh?.enabled) return null;
    const r = await secureMesh.broadcast({
      to: '*',
      channel: 'control',
      groupId,
      payload: { type: 'warmy.membership.revocation', groupId, list },
    });
    audit?.log('membership.revocation.broadcast', { groupId, sent: r.sent, failed: r.failed });
    return { sent: r.sent, failed: r.failed };
  } catch (e) {
    audit?.log('membership.revocation.broadcast.failed', { groupId, error: sanitizeError(e) });
    return null;
  }
}

/**
 * 收到成员证书（例如刚入群时对端送来一张）。
 * 签发者必须是**本群创建者**：群记录里有创建者指纹就按它校验，否则按本机已钉住的那个。
 */
handleIpc('warmy:membership-receive-cert', (_e, payload: { groupId?: string; cert?: unknown } = {}) => {
  try {
    const membership = membershipStoreFor(identityStore);
    if (!membership) return { ok: false, code: 'identity-missing' };
    const groupId = String(payload?.groupId || '');
    if (!groupId || !payload?.cert || typeof payload.cert !== 'object') return { ok: false, code: 'malformed' };
    const expect = expectedIssuerFor(groupId);
    const r = membership.putCertificate(payload.cert as never, expect ? { expectIssuerFingerprint: expect } : {});
    return { ok: r.ok, code: r.code, stored: r.stored, certId: r.certId, detail: r.detail ?? '' };
  } catch (e) {
    return { ok: false, code: 'error', detail: sanitizeError(e) };
  }
});

/** 同步（收到）一份吊销列表：验签 + 单调合并（回滚 / 条目变少一律拒绝） */
handleIpc('warmy:membership-sync-revocation', (_e, payload: { groupId?: string; list?: unknown } = {}) => {
  try {
    const membership = membershipStoreFor(identityStore);
    if (!membership) return { ok: false, code: 'identity-missing' };
    const groupId = String(payload?.groupId || '');
    if (!groupId || !payload?.list || typeof payload.list !== 'object') return { ok: false, code: 'malformed' };
    const expect = expectedIssuerFor(groupId);
    const r = membership.applyRevocationList(groupId, payload.list as never, expect ? { expectIssuerFingerprint: expect } : {});
    return {
      ok: r.ok,
      code: r.code,
      changed: r.changed,
      listVersion: r.listVersion,
      previousVersion: r.previousVersion,
      detail: r.detail ?? '',
    };
  } catch (e) {
    return { ok: false, code: 'error', detail: sanitizeError(e) };
  }
});

/** 成员证书与吊销列表的结构化快照（UI 只读；含本地时钟判定结果） */
handleIpc('warmy:membership-list', (_e, payload: { groupId?: string } = {}) => {
  try {
    const membership = membershipStoreFor(identityStore);
    if (!membership) return { ok: false, schema: 'warmy.membership.file.v1', groups: [] };
    const gid = String(payload?.groupId || '');
    const snap = membershipSnapshot(membership, gid ? { groupId: gid } : {});
    return { ...snap, summary: membership.summary() };
  } catch (e) {
    return { ok: false, schema: 'warmy.membership.file.v1', groups: [], error: sanitizeError(e) };
  }
});

/** 名册判定（含依据）：给 UI/排障用的只读通道，不改任何状态 */
handleIpc(
  'warmy:membership-authorize',
  (_e, payload: { fingerprint?: string; groupId?: string; requireCertificate?: boolean } = {}) => {
    try {
      const fp = String(payload?.fingerprint || '');
      if (!fp) return { ok: false, error: 'fingerprint-required' };
      const membership = membershipStoreFor(identityStore);
      const verdict = explainRosterDecision(identityStore, fp, {
        membership,
        ...(payload?.requireCertificate === true ? { requireCertificate: true } : {}),
      });
      return { ok: true, verdict };
    } catch (e) {
      return { ok: false, error: sanitizeError(e) };
    }
  }
);

/** 签发成员证书（创建者；身份锁着就如实回 identity-locked） */
handleIpc(
  'warmy:membership-issue',
  async (
    _e,
    payload: {
      groupId?: string;
      memberFingerprint?: string;
      memberPublicKey?: string;
      displayName?: string;
      role?: string;
      memberId?: string;
      supersedes?: string;
      ttlMs?: number;
    } = {}
  ) => {
    const groupId = String(payload?.groupId || '');
    const memberFingerprint = String(payload?.memberFingerprint || '');
    const memberPublicKey = String(payload?.memberPublicKey || '');
    if (!groupId || !memberFingerprint || !memberPublicKey) return { ok: false, code: 'malformed' };
    return await issueMemberCertForGroup(groupId, {
      memberFingerprint,
      memberPublicKey,
      ...(payload?.displayName ? { displayName: String(payload.displayName) } : {}),
      ...(payload?.role === 'admin' || payload?.role === 'creator' ? { role: payload.role } : {}),
      ...(payload?.memberId ? { memberId: String(payload.memberId) } : {}),
      ...(payload?.supersedes ? { supersedes: String(payload.supersedes) } : {}),
      ...(typeof payload?.ttlMs === 'number' ? { ttlMs: payload.ttlMs } : {}),
    });
  }
);

/**
 * **换证后重签**（§附五.1 第四层的落地点）。
 * 需要：本机有该成员的旧证书 + 成员用旧私钥签的换证声明。
 * 成功后旧证书进吊销列表（rotation），新指纹持有 `supersedes` 链 → "新指纹 = 原成员"。
 */
handleIpc(
  'warmy:membership-rotate',
  async (
    _e,
    payload: {
      groupId?: string;
      declaration?: unknown;
      currentGeneration?: number;
      knownKeys?: unknown[];
      ttlMs?: number;
    } = {}
  ) => {
    try {
      const membership = membershipStoreFor(identityStore);
      if (!membership || !identityStore) return { ok: false, code: 'identity-missing' };
      const groupId = String(payload?.groupId || '');
      if (!groupId || !payload?.declaration || typeof payload.declaration !== 'object') {
        return { ok: false, code: 'malformed' };
      }
      const expect = expectedIssuerFor(groupId);
      const signer = createIdentitySigner(identityStore);
      if (expect && !fingerprintMatches(expect, signer.fingerprint)) {
        return { ok: false, code: 'not-the-creator' };
      }
      const r = await rotateMemberCertificate({
        signer,
        membership,
        groupId,
        declaration: payload.declaration as never,
        ...(typeof payload.currentGeneration === 'number' ? { currentGeneration: payload.currentGeneration } : {}),
        ...(Array.isArray(payload.knownKeys) ? { knownKeys: payload.knownKeys as never } : {}),
        ...(typeof payload.ttlMs === 'number' ? { ttlMs: payload.ttlMs } : {}),
      });
      if (!r.ok || !r.cert) {
        return { ok: false, code: r.code, reason: r.verification?.reason ?? '', detail: r.detail ?? '' };
      }
      // 证书链落盘后**顺手把成员表的指纹换成新指纹**：
      // 这样横幅（scopes）与在线态映射立刻跟着新指纹走，不用等下次加入。
      const member = groupStore
        ?.listMembers(groupId)
        .find((m) => m.fingerprint && fingerprintMatches(m.fingerprint, String(r.verification?.oldFingerprint || '')));
      let memberPatched: string | null = null;
      if (member && groupStore) {
        const patched = groupStore.setMemberFingerprint(groupId, member.id, r.cert.memberFingerprint);
        memberPatched = patched.ok && patched.changed ? member.id : null;
      }
      void broadcastRevocationList(groupId, r.revocation);
      audit?.log('membership.cert.rotated', {
        groupId,
        old: r.verification?.oldFingerprint ?? '',
        next: r.cert.memberFingerprint,
        certId: r.cert.certId,
        supersedes: r.cert.supersedes ?? '',
        replacement: memberPatched ?? '',
      });
      return {
        ok: true,
        code: 'ok',
        cert: {
          certId: r.cert.certId,
          memberFingerprint: r.cert.memberFingerprint,
          supersedes: r.cert.supersedes ?? '',
          expiresAt: r.cert.expiresAt,
        },
        memberId: memberPatched ?? member?.id ?? '',
        listVersion: r.revocation?.listVersion ?? 0,
      };
    } catch (e) {
      return { ok: false, code: 'error', detail: sanitizeError(e) };
    }
  }
);

/** 主动吊销（踢人之外的场景：私钥泄漏 / 管理员处置） */
handleIpc(
  'warmy:membership-revoke',
  async (_e, payload: { groupId?: string; certId?: string; memberFingerprint?: string; reason?: string } = {}) => {
    try {
      const membership = membershipStoreFor(identityStore);
      if (!membership || !identityStore) return { ok: false, code: 'identity-missing' };
      const groupId = String(payload?.groupId || '');
      const reason = String(payload?.reason || 'admin');
      const allowed = ['rotation', 'compromise', 'departed', 'admin'];
      if (!groupId || !allowed.includes(reason)) return { ok: false, code: 'malformed' };
      const cert =
        (payload?.certId ? membership.certificateById(groupId, String(payload.certId)) : null) ??
        (payload?.memberFingerprint ? membership.certificateForFingerprint(groupId, String(payload.memberFingerprint)) : null);
      if (!cert) return { ok: false, code: 'no-certificate' };
      const expect = expectedIssuerFor(groupId);
      const signer = createIdentitySigner(identityStore);
      if (expect && !fingerprintMatches(expect, signer.fingerprint)) return { ok: false, code: 'not-the-creator' };
      const r = await revokeMemberCertificate({
        signer,
        membership,
        groupId,
        certId: cert.certId,
        memberFingerprint: cert.memberFingerprint,
        reason: reason as never,
        ...(expect ? { expectation: expect } : {}),
      });
      if (!r.ok) return { ok: false, code: r.code, detail: r.detail ?? '' };
      void broadcastRevocationList(groupId, r.list);
      return { ok: true, code: 'ok', certId: cert.certId, listVersion: r.list?.listVersion ?? 0 };
    } catch (e) {
      return { ok: false, code: 'error', detail: sanitizeError(e) };
    }
  }
);

handleIpc('warmy:identity-peers', () => {
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

handleIpc('warmy:repo-guard-check-ref', (_e, payload: RepoGuardRefInput = {} as RepoGuardRefInput) => {
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

handleIpc('warmy:repo-guard-check-paths', (_e, payload: { paths?: Array<string | PushPathEntry> | string; base?: 'worktree' | 'gitdir' } = {}) => {
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
  'warmy:repo-guard-pre-receive',
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
handleIpc('warmy:repo-guard-install-hooks', (_e, payload: { repoDir?: string; force?: boolean } = {}) => {
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

handleIpc('warmy:repo-guard-status', () =>
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

handleIpc('warmy:lease-acquire', (_e, req: AcquireRequest = {} as AcquireRequest) => {
  try {
    if (!leases) return { ok: false, error: { code: 'no-registry', reason: 'lease-registry-unavailable' }, leases: [] };
    const r = leases.acquire({ ...req, holder: req.holder || leaseHolder() });
    if (r.ok) audit?.log('lease.acquire', { scope: r.lease?.scope, holder: r.lease?.holder, kind: r.lease?.kind });
    return { ...r, leases: leases.list() };
  } catch (e) {
    return { ok: false, error: { code: 'invalid-request', reason: sanitizeError(e) }, leases: [] };
  }
});

handleIpc('warmy:lease-release', (_e, req: LeaseRefRequest = {} as LeaseRefRequest) => {
  try {
    if (!leases) return { ok: false, released: false, error: { code: 'no-registry', reason: 'lease-registry-unavailable' } };
    const r = leases.release({ ...req, ...(req.holder || req.leaseId ? {} : { holder: leaseHolder() }) });
    if (r.released) audit?.log('lease.release', { leaseId: r.lease?.id, scope: r.lease?.scope });
    return { ...r, leases: leases.list() };
  } catch (e) {
    return { ok: false, released: false, error: { code: 'invalid-request', reason: sanitizeError(e) } };
  }
});

handleIpc('warmy:lease-list', () =>
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

handleIpc('warmy:lease-check', (_e, payload: { holder?: string; path?: string; paths?: string[] } = {}) => {
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
handleIpc('warmy:nodes-revoke', (_e, nodeId: string) => {
  try {
    nodeReg?.revoke(nodeId);
    return { ok: true };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});
handleIpc('warmy:invite-create', (_e, groupId?: string) => safeHandle(() => ({ ok: true, invite: createInvite(15 * 60_000, groupId) }), { ok: true, invite: { token: "", expiresAt: 0, used: false } }))
handleIpc('warmy:invite-use', (_e, tok: { token: string; expiresAt: number; used: boolean }) => ({
  ok: consumeInvite(tok),
}));
handleIpc('warmy:sync-publish', (_e, env: { fromNode: string; toNode: string; channel: string; payload: unknown; groupId?: string; incognito?: boolean }) => ({
  ok: true,
  envelope: syncBus?.publish(env as never),
}));
handleIpc('warmy:sync-pull', (_e, nodeId: string) => safeHandle(() => ({ ok: true, messages: syncBus?.pull(nodeId) || [] }), { ok: true, messages: [] }))

// ── dsh 实例入口（可选） ──
handleIpc('warmy:dsh-available', () => {
  try {
    const dir = findDshPackageDir([
      path.join(app.getAppPath(), 'spikes', 'spike-05-plugins', 'node_modules', '@deepseek-ai', 'dsh'),
      path.join(__dirname, '..', '..', '..', 'spikes', 'spike-05-plugins', 'node_modules', '@deepseek-ai', 'dsh'),
    ]);
    return { ok: !!dir, dir: dir || null };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

handleIpc('warmy:spawn-dsh-instance', async (_e, cfg: { id: string; name: string }) => {
  const dshDir = findDshPackageDir([
    path.join(app.getAppPath(), 'spikes', 'spike-05-plugins', 'node_modules', '@deepseek-ai', 'dsh'),
    path.join(__dirname, '..', '..', '..', 'spikes', 'spike-05-plugins', 'node_modules', '@deepseek-ai', 'dsh'),
  ]);
  if (!dshDir) return { ok: false, error: 'dsh not found' };
  const dshHome = path.join(app.getPath('userData'), 'dsh-home');
  const profile = 'warmy';
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
handleIpc('warmy:email-queue', (_e, mail: { to: string; subject: string; body: string }) => {
  try {
    emailQueue.push({ ...mail, ts: Date.now() });
    return { ok: true, pending: emailQueue.length };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});
handleIpc('warmy:email-list', () => safeHandle(() => ({ ok: true, items: emailQueue }), { ok: true, items: [] }))

// ── SMTP 验证（用户设置，非写死） ──
handleIpc('warmy:smtp-verify', async (_e, cfg: SmtpConfig & { id?: string }) => {
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

handleIpc('warmy:smtp-list', () => {
  try {
    const s = settingsStore?.load();
    const accounts = (s?.smtpAccounts || []).map((a) => ({
      ...a,
      pass: a.pass ? '••••••••' : '',
    }));
    return { ok: true, accounts, max: 10 };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

handleIpc('warmy:smtp-add', (_e, acc: { label: string; host: string; port: number; secure: boolean; user: string; pass: string }) => {
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

handleIpc('warmy:smtp-remove', (_e, id: string) => {
  try {
    const s = settingsStore!.load();
    const list = (s.smtpAccounts || []).filter((a) => a.id !== id);
    settingsStore!.save({ smtpAccounts: list });
    return { ok: true, accounts: list.map((a) => ({ ...a, pass: a.pass ? '••••••••' : '' })) };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

handleIpc('warmy:smtp-update', (_e, id: string, patch: Partial<{ label: string; host: string; port: number; secure: boolean; user: string; pass: string }>) => {
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
 *
 * 端口：**只用调用方给的那一个**。绑不上就返回 `port-bind-failed` + 底层 errno
 * （`error` 字段）并**保持 requestedPort 不变** —— 不自动换端口、不改设置。
 * 用户由界面引导自己选（见 settings-store 的 WARMY_SUGGESTED_NET_PORTS）。
 */
async function startSecureMesh(port: number, opts: { discovery?: boolean; announce?: boolean } = {}) {
  refreshLocalNodeId();
  if (!secureMesh) {
    emitConsole({ cat: 'net', code: 'net.unavailable' });
    return { ok: false as const, errorCode: 'net-unavailable', error: 'net-wiring-unavailable' };
  }
  const r = await secureMesh.enable(port, opts);
  if (!r.ok) {
    audit?.log('net.enable.failed', {
      errorCode: r.errorCode,
      port,
      errno: r.error,
    });
    // T194：组网开启失败 —— 端口绑不上是最要紧的一类（要能一眼看出是哪个端口、什么 errno）
    emitConsole({
      cat: 'net',
      code: r.errorCode === 'port-bind-failed' ? 'net.bind-failed' : 'net.enable-failed',
      data: { port, requestedPort: (r as { requestedPort?: number }).requestedPort ?? port, errorCode: r.errorCode, error: r.error },
    });
    return r;
  }
  audit?.log('net.enable', {
    port: r.port,
    requestedPort: r.requestedPort,
    nodeId: r.nodeId,
    discovery: opts.discovery === true,
    announce: opts.announce === true,
  });
  emitConsole({ cat: 'net', code: 'net.enable-ok', data: { port: r.port, requestedPort: r.requestedPort, nodeId: r.nodeId } });
  return r;
}

handleIpc('warmy:lan-start', async (_e, port = WARMY_DEFAULT_NET_PORT) => {
  try {
    const r = await startSecureMesh(Number(port) || WARMY_DEFAULT_NET_PORT, { discovery: false, announce: false });
    if (!r.ok) return r;
    return { ok: true, port: r.port, requestedPort: r.requestedPort, bind: r.bind, nodeId: r.nodeId };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

handleIpc('warmy:lan-stop', async () => {
  try {
    await secureMesh?.disable();
    emitConsole({ cat: 'net', code: 'net.disable', data: { reason: 'lan-stop' } });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

handleIpc(
  'warmy:lan-send',
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

handleIpc('warmy:lan-inbox', () => safeHandle(() => ({ ok: true, messages: secureMesh?.inboxOf() ?? [] }), { ok: true, messages: [] }));

handleIpc('warmy:lan-status', () =>
  safeHandle(
    () => ({
      ok: true,
      listening: !!secureMesh?.enabled,
      port: secureMesh?.enabled ? secureMesh.boundPort : undefined,
      requestedPort: secureMesh?.requestedNetPort || undefined,
      bind: secureMesh?.enabled ? secureMesh.bindInfo() : undefined,
      nodeId: localNodeId,
    }),
    { ok: true, listening: false, port: undefined, requestedPort: undefined, bind: undefined, nodeId: localNodeId }
  )
);

handleIpc('warmy:lan-dual-smoke', async (_e, opts: { localPort?: number; peerHost?: string; peerPort?: number } = {}) => {
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
handleIpc('warmy:mesh-start', async (_e, port = WARMY_DEFAULT_NET_PORT) => {
  try {
    const r = await startSecureMesh(Number(port) || WARMY_DEFAULT_NET_PORT, { discovery: true, announce: true });
    if (!r.ok) return r;
    return { ok: true, port: r.port, requestedPort: r.requestedPort, bind: r.bind, nodeId: r.nodeId, notes: NET_NOTES };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

handleIpc('warmy:mesh-stop', async () => {
  try {
    await secureMesh?.disable();
    emitConsole({ cat: 'net', code: 'net.disable', data: { reason: 'mesh-stop' } });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

handleIpc('warmy:peers-list', () => ({
  ok: true,
  peers: peerReg?.list() || [],
  notes: NET_NOTES,
}));

handleIpc(
  'warmy:peers-add',
  (_e, p: { nodeId?: string; name: string; host: string; port: number; kind?: 'lan' | 'wan' }) => {
    const nodeId = p.nodeId || `peer-${p.host}-${p.port}`;
    const info = peerReg!.addManual(nodeId, p.name || nodeId, p.host, p.port, p.kind || 'wan');
    return { ok: true, peer: info, peers: peerReg!.list() };
  }
);

handleIpc('warmy:peers-remove', (_e, nodeId: string) => {
  try {
    peerReg?.revoke(nodeId);
    return { ok: true, peers: peerReg?.list() || [] };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

handleIpc('warmy:mesh-broadcast', async (_e, payload: unknown, groupId?: string) => {
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

handleIpc('warmy:mesh-inbox', () => safeHandle(() => ({ ok: true, messages: secureMesh?.inboxOf() ?? [] }), { ok: true, messages: [] }));

handleIpc('warmy:mesh-status', () =>
  safeHandle(
    () => ({
      ok: true,
      listening: !!secureMesh?.enabled,
      /** **实际**绑定的端口（走了兜底链就是兜底那一档，不是用户填的那个） */
      port: secureMesh?.enabled ? secureMesh.boundPort : undefined,
      requestedPort: secureMesh?.requestedNetPort || undefined,
      bind: secureMesh?.enabled ? secureMesh.bindInfo() : undefined,
      nodeId: localNodeId,
      peerCount: peerReg?.list().length || 0,
      sessions: secureMesh?.sessionCount ?? 0,
    }),
    { ok: true, listening: false, port: undefined, requestedPort: undefined, bind: undefined, nodeId: localNodeId, peerCount: 0, sessions: 0 }
  )
);

// ── 组网状态 / 探测（UI 的 netStatus/netProbe/netLocalAddress/netMembersPresence/meshEnable/meshDisable） ──
//
// 真实现：网卡枚举、TCP 连通性（含时延）、DNS 解析、出站连通性、公网地址回显、监听端口自测、活会话表、
//        IPv6 地址分档、中继候选判定（附八.9 / 附八.3）。
// 降级：**入站可达性**（别人拨我）需要一台真的在公网的第三方对端 → 一律 `inboundVerified:false`，
//       且 `isPublic` 只由地址事实推出（私网/回环/链路本地/CGNAT 恒 false），绝不硬编码 true。
// 未实现：UPnP/NAT-PMP 端口映射、STUN+同时打洞；中继的**判定与选中**已实现，但**转发隧道尚未启用**。

/**
 * 异步可达性（附八.3 的「双不可拨入且无中继」终态只能在这里才算得出来）：
 * `secureMesh.reachabilityFor()` 会**真的拨一次中继候选**（1.5s 超时），而 UI 每秒轮询
 * `net-status` —— 每轮都去拨是不可接受的，所以这里带 TTL 缓存。
 * TTL(20s) < UI 侧保鲜期(30s)，保证 UI 不会拿到"已过期却还没刷新"的结论。
 * ⚠️ 判定必须有**一个对端**：没有已知对端指纹时如实返回 null（不编造中继结论）。
 */
let netReachCache: { at: number; value: ReachabilityHint | null } = { at: 0, value: null };
const NET_REACH_TTL_MS = 20_000;

async function netReachabilityCached(): Promise<ReachabilityHint | null> {
  const now = Date.now();
  if (now - netReachCache.at < NET_REACH_TTL_MS) return netReachCache.value;
  let value: ReachabilityHint | null = null;
  try {
    const localFp = identityStore?.info()?.fingerprint;
    const peers = secureMesh?.presence() ?? [];
    const peer = peers.find((p) => !!p.fingerprint && p.fingerprint !== localFp);
    if (secureMesh && peer?.fingerprint) {
      value = await secureMesh.reachabilityFor(peer.fingerprint, peer.online === true);
    }
  } catch {
    value = null; // 探测失败不影响 net-status 本身：上层按"未知"处理
  }
  netReachCache = { at: now, value };
  return value;
}

handleIpc('warmy:net-status', async () => {
  const fallback: MeshStatusResult = {
    ok: true,
    meshEnabled: false,
    link: { reachable: false, lastError: 'net-unavailable', peers: [] },
    unlock: identityStore ? requireSignableIdentity(identityStore).unlock ?? null : null,
  };
  return await safeHandleAsync<MeshStatusResult>(async () => {
    const base = (await secureMesh?.status()) ?? fallback;
    // status() 里的 reachability 是**同步且刻意保守**的（needsPublicRelayNotice 恒 false）。
    // 终态能力在异步的 reachabilityFor() 里，必须在这里合并出去，否则 UI 的终态横幅
    // 在真实应用里永远不会出现（只有异步路径才敢说"两端都拨不进来、而且没有中继"）。
    const reach = await netReachabilityCached();
    return reach ? { ...base, reachability: reach } : base;
  }, fallback);
});

handleIpc('warmy:net-probe', async (_e, input: { ip?: string; port?: number; domains?: string[] } = {}) => {
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

handleIpc('warmy:net-local-address', async () => {
  const port = secureMesh?.enabled ? secureMesh.boundPort : undefined;
  return await safeHandleAsync(
    async () => await localAddressInfo(port ? { port } : {}),
    { ok: true, localIp: '127.0.0.1', interfaces: [], hasPublicInterface: false, behindNat: true }
  );
});

handleIpc('warmy:net-members-presence', (_e, payload: { groupId?: string } = {}) => {
  try {
    const groupId = String(payload.groupId || '');
    const members = groupId ? groupStore?.listMembers(groupId) ?? [] : [];
    const meshEnabled = !!secureMesh?.enabled;
    const liveness = secureMesh?.presence() ?? [];
    const liveSessions = liveness.filter((p) => p.online).length;
    const instances = p1?.instances.list() ?? [];
    // 判定逻辑在 identity-provider 的 buildMemberPresence（纯函数、验证脚本能真跑）：
    //  · 本机实例成员 → InstanceManager 的真实状态（presenceBasis: 'local-instance'）；
    //  · **有指纹**的异地成员 → 用活连接集合（SecureMesh / ConnectionLiveness）按指纹判
    //    （presenceBasis: 'mesh-session'：没有活连接就是不在线，不假装知道）；
    //  · **没指纹**的异地成员 → presenceBasis: 'unattributed'，如实**不给** online。
    const rows = buildMemberPresence({ members, instances, liveness, meshEnabled });
    return {
      ok: true,
      meshEnabled,
      presenceAvailable: meshEnabled,
      remoteSessions: liveSessions,
      members: rows,
    };
  } catch (e) {
    return { ok: false, meshEnabled: false, members: [], error: sanitizeError(e) };
  }
});

handleIpc('warmy:net-mesh-enable', async (_e, input: { ip?: string; port?: number; domains?: string[]; publicAddresses?: string[] } = {}) => {
  try {
    const port = Number(input.port) || WARMY_DEFAULT_NET_PORT;
    const r = await startSecureMesh(port, { discovery: true, announce: true });
    return r.ok
      ? { ok: true, port: r.port, requestedPort: r.requestedPort, bind: r.bind, nodeId: r.nodeId, errorCode: r.errorCode }
      : r;
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

/**
 * R13：**实测**的候选端口（只推荐本机真的绑得上的端口）。
 *
 * 为什么要有这个 IPC：静态候选表"干净"不等于本机现在绑得上（可能被别的进程占用、
 * 也可能落在 OS 保留段里 EACCES）。渲染层拿不到实测结果就只能瞎猜，所以这里把
 * "带结果的候选列表"（每个候选带 status）交给界面，界面才能解释"为什么少了某个号"。
 *
 * 语义约束：**只读、只探测** —— 不绑定、不改配置、不替用户做主。
 * 探测并发有上限、总超时 4s，绝不让界面卡住。
 */
handleIpc('warmy:net-port-candidates', async (_e, input: { requestedPort?: number; want?: number } = {}) => {
  try {
    const requestedPort = Number(input.requestedPort);
    return {
      ok: true,
      ...(await pickPortCandidates({
        ...(Number.isInteger(requestedPort) && requestedPort > 0 ? { requestedPort } : {}),
        ...(Number.isFinite(Number(input.want)) ? { want: Number(input.want) } : {}),
      })),
    };
  } catch (e) {
    return {
      ok: false,
      error: sanitizeError(e),
      requestedPort: Number(input.requestedPort) || 0,
      recommended: [],
      probed: [],
      coverage: 'pool',
      timedOut: false,
      elapsedMs: 0,
      probedAt: Date.now(),
      host: '0.0.0.0',
    };
  }
});

handleIpc('warmy:net-mesh-disable', async () => {
  try {
    await secureMesh?.disable();
    emitConsole({ cat: 'net', code: 'net.disable', data: { reason: 'net-mesh-disable' } });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

handleIpc('warmy:net-mesh-announce', async (_e, reason: 'startup' | 'address-changed' | 'manual' = 'manual') => {
  try {
    if (!secureMesh?.enabled) return { ok: false, errorCode: 'mesh-disabled' };
    return await secureMesh.announce(reason);
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

// ── 窗口控制（自定义标题栏） ──
handleIpc('warmy:win-minimize', () => safeHandle(() => win?.minimize(), null))
handleIpc('warmy:win-maximize', () => {
  try {
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});
handleIpc('warmy:win-close', () => safeHandle(() => win?.close(), null))
handleIpc('warmy:win-reload', () => {
  try {
    if (!win) return { ok: false };
    // 清 HTTP 缓存后重载，避免旧 JS/CSS 残留
    const ses = win.webContents.session;
    ses.clearCache().catch(() => {});
    win.webContents.reloadIgnoringCache();
    return { ok: true };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});
handleIpc('warmy:win-always-on-top', (_e, on?: boolean) => {
  try {
    if (!win) return { ok: false };
    const next = typeof on === 'boolean' ? on : !win.isAlwaysOnTop();
    win.setAlwaysOnTop(next);
    return { ok: true, alwaysOnTop: next };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});
handleIpc('warmy:platform', () => ({
  ok: true,
  platform: process.platform,
  isMac: process.platform === 'darwin',
  isWin: process.platform === 'win32',
  isLinux: process.platform === 'linux',
}));


// ── P5 短命执行者 ──
handleIpc('warmy:executor-run', async (_e, task: { taskId?: string; brief: string; contextItems?: string[] }) => {
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

handleIpc('warmy:executor-batch', async (_e, tasks: Array<{ taskId?: string; brief: string; contextItems?: string[] }>) => {
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
handleIpc('warmy:assets-retrieve', (_e, opts?: { scope?: string; strict?: boolean }) => ({
  ok: true,
  assets: retrieveAssetsForChat({ scope: opts?.scope as never, strict: opts?.strict }),
}));

handleIpc('warmy:assets-register', (_e, a: { id: string; title: string; body: string; scope?: string }) => {
  try {
    registerChatAsset({ id: a.id, title: a.title, body: a.body, scope: a.scope as never });
    return { ok: true };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

handleIpc('warmy:assets-feedback', (_e, id: string, good: boolean) => {
  try {
    recordAssetUsage(id, good);
    return { ok: true };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

handleIpc('warmy:assets-sweep', () => safeHandle(() => ({ ok: true, n: 0 }), { ok: true, n: 0 }))

// ── P6 知识库：从对话写入 ──
handleIpc('warmy:kb-from-chat', (_e, payload: { sessionId: string; title: string; body: string }) => {
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
handleIpc('warmy:request-approval', (_e, req: { action: string; suggested?: string }) => {
  try {
    const id = 'ap-' + ++approvalSeq;
    return new Promise((resolve) => {
      pendingApprovals.set(id, { resolve });
      win?.webContents.send('warmy:approval-request', { id, action: req.action, suggested: req.suggested || 'once' });
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

handleIpc('warmy:approval-respond', (_e, id: string, allowed: boolean, scope: string) => {
  try {
    const p = pendingApprovals.get(id);
    if (!p) return { ok: false };
    pendingApprovals.delete(id);
    p.resolve({ allowed, scope });
    return { ok: true };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

// ── 4 自动检查点 ──
handleIpc('warmy:checkpoint-auto', (_e, phase: 'round_start' | 'round_end', logSeq?: number) => {
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
handleIpc('warmy:cost-summary', () => {
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
handleIpc('warmy:group-orchestrate', async (_e, msg: { groupId: string; content: string; urgency?: string; userId?: string }) => {
  /**
   * ADR 004 第七批定稿：项目不可用（容器开发项目 + 容器没起，或被创建者停用）⇒ 拒绝派发
   * （**不**退到主机上跑）。启用/停用与切换容器的入口在**项目右键菜单**：
   * `warmy:project-enable` / `warmy:project-disable` / `warmy:project-set-container`。
   */
  const devRefusal = await projectUnavailableFor(String(msg?.groupId || ''));
  if (devRefusal) {
    emitConsole({ cat: 'system', code: 'container.project.unavailable', data: { sessionId: msg?.groupId, projectCode: devRefusal.projectCode } });
    return {
      ok: false,
      action: 'error',
      code: devRefusal.code,
      projectCode: devRefusal.projectCode,
      reasonKey: devRefusal.reasonKey,
      fix: devRefusal.fix,
      memberFaceKey: 'group.memberOffline',
      hostExecutionRefused: true,
      historyReadable: true,
    };
  }
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
      contextBudgetChars: () => contextBudgetChars(providerCfg.model),
      // ADR 002 §9.4 待办 2：值班者路径共用同一套工具与限额（memory-client 是唯一实现）
      toolSpecs: () => (memory?.isReady && toolLimits().maxRounds > 0 ? memoryToolSpecs(toolLabels()) : undefined),
      toolLimits,
      runTool: async (call, ctx) => {
        const t1 = Date.now();
        const toolName = String((call && call.function && call.function.name) || 'tool');
        emitConsole({ cat: 'tool', code: 'tool.start', data: { tool: toolName, round: ctx.round, sessionId: msg.groupId } });
        // 工具里对文件做过的真实读写都记到**这个项目**的台账上（scope = 会话 id）
        const out = await withFileAccessScope(msg.groupId, () => runMemoryTool(memory, call, { maxChars: ctx.maxResultChars }));
        metrics.recordToolCall({
          ts: Date.now(),
          sessionId: msg.groupId,
          round: ctx.round,
          tool: out.meta.tool,
          ok: out.ok,
          chars: out.chars,
          ms: Date.now() - t1,
        });
        emitConsole({
          cat: 'tool',
          code: 'tool.finish',
          data: { tool: out.meta.tool || toolName, round: ctx.round, sessionId: msg.groupId, ok: out.ok, chars: out.chars, ms: Date.now() - t1 },
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
      // 项目 MEMORY：从 group-store 读，**不**从 memory-os 流水复制（避免双源）
      projectMemory: (gid) => projectMemoryForContext(groupStore, gid),
      decisionContext: (gid) => aiQuestions.contextFor(gid),
      runProjectGate: async (gid, reason) => runProjectGateOnce(gid, reason),
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
handleIpc('warmy:executors-status', () => safeHandle(() => ({ ok: true, items: executorStatus.slice(-10) }), { ok: true, items: [] }))
handleIpc('warmy:executors-run-brief', async (_e, payload: { brief: string; contextItems?: string[]; executorIds?: string[] }) => {
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
handleIpc('warmy:state-save', (_e, state: { plugins?: unknown[]; instances?: unknown[]; groups?: unknown[]; chats?: unknown[] }) => {
  try {
    if (!settingsStore) return { ok: false };
    const cur = settingsStore.load();
    const next = { ...cur, ...state } as never;
    settingsStore.save(next as never);
    return { ok: true };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});
handleIpc('warmy:state-load', () => {
  try {
    const s = settingsStore?.load() as never;
    return { ok: true, state: s || {} };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});



// ── 知识库删除 ──
handleIpc('warmy:kb-delete', (_e, payload: { kind: 'entity' | 'event'; id: string }) => {
  try {
    if (!knowledge) return { ok: false, error: 'kb not ready' };
    const removed = payload?.kind === 'event' ? knowledge.removeEvent(payload.id) : knowledge.removeEntity(payload.id);
    return { ok: removed };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

// ── 通用：把文本保存到文件（CSV / Markdown 等）──
handleIpc('warmy:save-text', async (_e, payload: { defaultName?: string; content: string; filters?: Array<{ name: string; extensions: string[] }> }) => {
  try {
    if (!win) return { ok: false, error: 'no window' };
    const r = await dialog.showSaveDialog(win, {
      defaultPath: payload?.defaultName || 'warmy-export.txt',
      filters: payload?.filters || [{ name: 'Text', extensions: ['txt'] }],
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(r.filePath, String(payload?.content ?? ''), 'utf8');
    return { ok: true, path: r.filePath };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

// ── 卡顿自检（diagnostics IPC）已下线：功能整块移除，IPC 通道不再注册 ──

// ── D. ASR 语音转文字（调用 DeepSeek 兼容接口的 audio 端点；失败返回 null） ──
handleIpc('warmy:asr-transcribe', async (_e, payload: { dataUrl: string; ext?: string }) => {
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
handleIpc('warmy:open-chat-window', (_e, payload: { id: string; title: string; kind?: string; mode?: string }) => {
  try {
    if (chatWindows.has(payload.id)) {
      chatWindows.get(payload.id)?.focus();
      return { ok: true };
    }
    const w = new BrowserWindow({
      width: 900,
      height: 700,
      title: payload.title || 'WArmy',
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
handleIpc('warmy:register-hotkey', (_e, accel: string) => {
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
  t.setToolTip('无限牛马 WArmy');
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
handleIpc('warmy:tray-init', () => {
  try {
    createTray();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});


// 托盘提示语由渲染层按当前语言下发（logo 文案随语言变化）
handleIpc('warmy:tray-tooltip', (_e, payload: string | { text?: string; offWork?: string; header?: string; me?: string }) => {
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
handleIpc('warmy:export-session', (_e, payload: { title: string; messages: Array<{ role: string; text: string; ts?: number }> }) => {
  try {
    const dir = path.join(app.getPath('userData'), 'exports');
    // 写操作门禁：导出目录是共享产物，先拿租约再写
    const guarded = withLease('exports', ['exports'], () => {
      fs.mkdirSync(dir, { recursive: true });
      const lines = [
        '# ' + payload.title,
        '',
        '> ' + exportHeaderLabel + ' WArmy · ' + new Date().toLocaleString(),
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
handleIpc('warmy:auto-update-check', async () =>
  safeHandleAsync<UpdateCheckResult>(
    async () => (updater ? await updater.check() : updaterUnavailableCheck(appVersion())),
    updaterUnavailableCheck(appVersion())
  )
);
handleIpc('warmy:auto-update-download', async () =>
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
handleIpc('warmy:update-source-get', () => safeHandle(() => updateSourceSnapshot(), updateSourceSnapshot()));
handleIpc('warmy:update-source-set', (_e, payload: { url?: string; channel?: string }) => {
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
handleIpc('warmy:group-members', (_e, groupId: string) =>
  safeHandle<GroupMembersResult & { localIsCreator?: boolean }>(
    () => {
      const gid = String(groupId || '');
      if (!groupStore) return { ok: false, groupId: gid, members: [], error: 'group store unavailable' };
      // 路由里已有但成员表缺的（例如更早版本入群）补一次，保证列表与路由一致
      syncMembersFromRouter(gid);
      const members = groupStore.listMembers(gid);
      /**
       * ADR 004 §2.2：**只有创建者**能启动/停止项目。
       * 判定依据是 group-store 里记的 `creatorFingerprint`（建群时写入的**本机身份指纹**）
       * 与本机当前身份指纹是否相等 —— 不在渲染层猜、也不新增一套"谁是创建者"的定义。
       * 拿不到指纹时如实回 false（宁可少一个按钮，也不要给错人权限）。
       */
      const creatorFp = String(groupStore.getGroup(gid)?.creatorFingerprint || '');
      const localFp = String(identityStore?.info()?.fingerprint || '');
      const localIsCreator = !!creatorFp && !!localFp && fingerprintMatches(creatorFp, localFp);
      return { ok: true, groupId: gid, members, localIsCreator };
    },
    { ok: false, members: [], error: 'group store unavailable' }
  )
);
/**
 * 邀请入群。**邀请时若带了对方的身份名片（fingerprint + publicKey）就顺手签发成员证书**
 * （ADR §2.3 第 6 条：成员加入时由项目主签发）。
 * 拿不到名片也照常加入，但**指纹留空**并记一条审计 —— 不猜、不伪造。
 */
handleIpc(
  'warmy:group-invite',
  async (
    _e,
    payload: { groupId: string; name: string; role?: string; fingerprint?: string; publicKey?: string; displayName?: string }
  ) => {
    try {
      if (!groupStore) return { ok: false, error: 'group store unavailable' };
      const gid = String(payload?.groupId || '');
      const role = payload?.role === 'admin' ? 'admin' : 'member';
      const fp = String(payload?.fingerprint || '').trim();
      const pub = String(payload?.publicKey || '').trim();
      const r = groupStore.addMemberWithFingerprint(
        gid,
        {
          name: String(payload?.name || ''),
          role,
          source: 'invite',
          ...(fp ? { fingerprint: fp } : {}),
        },
        { onAudit: (op, detail) => audit?.log(op, detail) }
      );
      if (!r.ok) return { ok: false, error: r.error || 'invite failed', members: r.members };
      audit?.log('group.invite', { groupId: gid, withFingerprint: !!fp });
      const result: { ok: boolean; members: typeof r.members; certId?: string; certError?: string } = {
        ok: true,
        members: r.members,
      };
      if (fp && pub) {
        const issued = await issueMemberCertForGroup(gid, {
          memberFingerprint: fp,
          memberPublicKey: pub,
          displayName: String(payload?.displayName || payload?.name || ''),
          role,
          memberId: String(payload?.name || ''),
        });
        if (issued.ok && issued.cert) result.certId = issued.cert.certId;
        else result.certError = String(issued.code);
      }
      return result;
    } catch {
      return { ok: false, error: 'invite failed' };
    }
  }
);
/**
 * 踢人 —— **同时吊销他的成员证书**（reason: 'departed'），并把新版吊销列表广播给在线成员。
 * 这是"吊销后拿旧证书重连必须被拒"的真实入口：证书先在本地吊销，再同步出去。
 */
handleIpc('warmy:group-kick', async (_e, payload: { groupId: string; memberId: string }) => {
  try {
    if (!groupStore) return { ok: false, error: 'group store unavailable' };
    const gid = String(payload?.groupId || '');
    const mid = String(payload?.memberId || '');
    const before = groupStore.listMembers(gid).find((m) => m.id === mid);
    const r = groupStore.removeMember(gid, mid);
    if (!r.ok) return { ok: false, error: r.error || 'kick failed', members: r.members };
    // 本机实例被踢时同步退出路由值班池
    const kicked = router.listMembers(gid).find((m) => m.id === mid || `inst:${m.id}` === mid);
    if (kicked) router.leave(gid, kicked.id);
    audit?.log('group.kick', { groupId: gid });
    let revoked: { certId: string; listVersion: number } | null = null;
    let revokeError: string | null = null;
    const membership = membershipStoreFor(identityStore);
    const targetFp = before?.fingerprint ?? '';
    if (membership && targetFp) {
      const cert = membership.certificateForFingerprint(gid, targetFp);
      const signer = identityStore ? createIdentitySigner(identityStore) : null;
      if (!cert) {
        revokeError = 'no-certificate';
      } else if (!signer) {
        revokeError = 'identity-missing';
      } else {
        const rv = await revokeMemberCertificate({
          signer,
          membership,
          groupId: gid,
          certId: cert.certId,
          memberFingerprint: cert.memberFingerprint,
          reason: 'departed',
        });
        if (rv.ok && rv.list) {
          revoked = { certId: cert.certId, listVersion: rv.list.listVersion };
          audit?.log('membership.revoked', { groupId: gid, certId: cert.certId, reason: 'departed' });
          void broadcastRevocationList(gid, rv.list);
        } else {
          revokeError = String(rv.code);
        }
      }
    } else if (membership && !targetFp) {
      revokeError = 'no-fingerprint';
    }
    return {
      ok: true,
      members: r.members,
      revoked,
      ...(revokeError ? { revokeError } : {}),
    };
  } catch {
    return { ok: false, error: 'kick failed' };
  }
});
handleIpc('warmy:group-set-admin', (_e, payload: { groupId: string; memberId: string; admin: boolean }) => {
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
handleIpc('warmy:group-directed', (_e, payload: { groupId: string; directed: boolean }) => {
  try {
    const g = router.getGroup(payload.groupId);
    if (!g) return { ok: false, error: 'no group' };
    g.directedMode = !!payload.directed;
    groupStore?.setDirected(payload.groupId, g.directedMode);
    return { ok: true, directedMode: g.directedMode };
  } catch (e) { return { ok: false, error: 'directed mode failed' }; }
});


// ── N. 会话内嵌看板 ──
handleIpc('warmy:board-session', (_e, groupId: string) => ({
  ok: true,
  tasks: board?.listTasks(groupId) || [],
  events: (board?.tailEvents(20) || []).filter((e) => e.groupId === groupId),
}));


// ── O. CCR 工具输出压缩 ──
handleIpc('warmy:ccr-tool-output', (_e, payload: { toolName?: string; content: string }) => {
  try {
    const r = ccr.beforeLog({ kind: 'tool_result', content: payload.content, toolName: payload.toolName });
    metrics.recordCcr({ ts: Date.now(), kind: 'tool_result', originalBytes: r.originalBytes, compressedBytes: r.compressedBytes });
    return { ok: true, ...r };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});


// ── P. 知识库详情 ──
handleIpc('warmy:kb-detail', (_e, q: string) => {
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
handleIpc('warmy:last-error', () => safeHandle(() => ({ ok: true, error: lastError }), { ok: true, error: null }))
handleIpc('warmy:clear-error', () => { lastError = null; return { ok: true }; });



// ── 项目 MEMORY / AI 决策卡 / 门禁 / read-back / 去重 ──

/** 项目 MEMORY：唯一落点 = groups.json project.memory */
handleIpc('warmy:project-memory-get', (_e, payload?: { sessionId?: string }) => {
  try {
    const gid = String(payload?.sessionId || '');
    const memory = readProjectMemory(groupStore, gid);
    return { ok: true, groupId: gid, memory, chars: memory.length };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});
handleIpc('warmy:project-memory-set', async (_e, payload?: { sessionId?: string; memory?: string }) => {
  try {
    const gid = String(payload?.sessionId || '');
    const mem = String(payload?.memory ?? '');
    const w = writeProjectMemory(groupStore, gid, mem);
    if (!w.ok) return { ok: false, error: w.error };
    // read-back：从存储读回再确认
    const rb = await withReadBack(
      () => mem,
      () => readProjectMemory(groupStore, gid),
      (saved, back) => String(saved).slice(0, 8000) === String(back).slice(0, 8000)
    );
    void publishProjectAttrs(gid);
    return { ok: rb.confident, saved: w.chars, memory: rb.readBack || '', readBack: rb.match, error: rb.error };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

/** AI 工作中求助选项卡（永远含「其他」自定义输入） */
handleIpc('warmy:ai-question-open', (_e, payload?: { groupId?: string; sessionId?: string; title?: string; body?: string; options?: Array<{ id?: string; label: string; description?: string }> }) => {
  try {
    const q = aiQuestions.open({
      groupId: String(payload?.groupId || payload?.sessionId || ''),
      sessionId: payload?.sessionId,
      title: String(payload?.title || '需要你的决定'),
      body: payload?.body,
      options: payload?.options || [],
    });
    emitConsole({ cat: 'system', code: 'ai.question.open', data: { id: q.id, groupId: q.groupId, title: q.title } });
    return { ok: true, question: q };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});
handleIpc('warmy:ai-question-list', (_e, groupId?: string) => {
  try {
    return { ok: true, items: aiQuestions.list(typeof groupId === 'string' ? groupId : undefined) };
  } catch (e) {
    return { ok: false, items: [], error: sanitizeError(e) };
  }
});
handleIpc('warmy:ai-question-answer', (_e, payload?: { id?: string; optionId?: string; customText?: string }) => {
  try {
    const r = aiQuestions.answer(String(payload?.id || ''), String(payload?.optionId || AI_QUESTION_CUSTOM), payload?.customText);
    return r;
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

/** 门禁判停：仅项目配置了 gateVerify 时才可能跑；主进程串行防并发风暴 */
const gateRuns = new Map<string, number>();
async function runProjectGateOnce(groupId: string, reason: string): Promise<{ pass: boolean; summary: string } | null> {
  try {
    const proj = groupStore?.projectOf(groupId);
    const gates = proj?.gateVerify || [];
    if (!gates.length) return null;
    const now = Date.now();
    const last = gateRuns.get(groupId) || 0;
    if (now - last < 3000) return { pass: !!proj?.gateLast?.pass, summary: '节流：3s 内不重复跑门禁' };
    gateRuns.set(groupId, now);
    const repo = path.resolve(__dirname, '..', '..', '..');
    const lines: string[] = [];
    let allPass = true;
    for (const rel of gates.slice(0, 4)) {
      const script = path.join(repo, rel);
      if (!fs.existsSync(script)) {
        allPass = false;
        lines.push(`${rel}: missing`);
        continue;
      }
      const out = await new Promise<{ code: number; tail: string }>((resolve) => {
        const child = spawn(process.execPath, [script], { cwd: repo, env: process.env });
        let buf = '';
        child.stdout?.on('data', (d) => { buf += String(d); if (buf.length > 4000) buf = buf.slice(-2000); });
        child.stderr?.on('data', (d) => { buf += String(d); if (buf.length > 4000) buf = buf.slice(-2000); });
        child.on('close', (code) => resolve({ code: code ?? 1, tail: buf.split('\n').filter(Boolean).slice(-3).join(' | ') }));
        child.on('error', () => resolve({ code: 1, tail: 'spawn-failed' }));
      });
      const pass = out.code === 0;
      if (!pass) allPass = false;
      lines.push(`${rel}: ${pass ? 'pass' : 'fail(rc=' + out.code + ')'} ${out.tail}`.slice(0, 160));
    }
    groupStore?.setProjectAttrs(groupId, { gateLast: { at: now, pass: allPass, summary: lines.join(' ; ') } });
    return { pass: allPass, summary: lines.join(' ; ') || 'no gates' };
  } catch (e) {
    return { pass: false, summary: sanitizeError(e) };
  }
}

/** skills-scan-dirs-set：路径去重 + read-back */
const _skillsScanSet = handleIpc;
handleIpc('warmy:skills-scan-dirs-set', (_e, dirs: unknown) => {
  const raw = Array.isArray(dirs) ? dirs.map((d) => String(d || '').trim()).filter(Boolean) : [];
  const { list, removed } = dedupeByNorm(raw, normPathKey);
  if (list.length > SKILL_SCAN_DIRS_MAX) {
    return { ok: false, error: 'too-many-dirs', max: SKILL_SCAN_DIRS_MAX, count: list.length };
  }
  try {
    const next = settingsStore?.save({ skillScanDirs: list } as never);
    const readBack = ((next as any)?.skillScanDirs || []) as string[];
    const match = readBack.length === list.length && list.every((x, i) => normPathKey(readBack[i]) === normPathKey(x));
    return { ok: true, dirs: list, scanDirs: skillScanStatus(list), settings: next, removedDups: removed, readBack: match, confident: match };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});

/** update-source-set：read-back */
handleIpc('warmy:update-source-set', async (_e, payload?: { url?: string }) => {
  try {
    const url = String(payload?.url || '').trim();
    const patch: Record<string, unknown> = { updateFeedUrl: url };
    const saved = settingsStore?.save(patch as never);
    const readBack = ((saved as any)?.updateFeedUrl || '') as string;
    const match = readBack === url;
    return { ok: true, configured: !!url, url: readBack, origin: url ? 'settings' : 'none', readBack: match, confident: match };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});


// ── R. 启动引导 ──
handleIpc('warmy:setup-state', () => {
  try {
    const s = settingsStore?.load() as Record<string, unknown> | undefined;
    // 首次运行/安装后首启：setupDone 非 true 一律弹语言选择
    return { ok: true, done: (s as { setupDone?: boolean })?.setupDone === true, locale: s?.locale || app.getLocale() };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});
handleIpc('warmy:setup-complete', (_e, payload: { locale?: string; provider?: Record<string, unknown> }) => {
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

/** Skill enable/pause flags (default enabled when key missing) */
function skillEnabledMap(): Record<string, boolean> {
  try {
    const s = settingsStore?.load() as { skillEnabled?: Record<string, boolean> } | undefined;
    return (s && s.skillEnabled && typeof s.skillEnabled === 'object') ? { ...s.skillEnabled } : {};
  } catch {
    return {};
  }
}
handleIpc('warmy:skills-set-enabled', (_e, payload: { id?: string; enabled?: boolean }) => {
  try {
    const id = String(payload?.id || '');
    if (!id) return { ok: false, error: 'missing-id' };
    const map = skillEnabledMap();
    map[id] = payload?.enabled !== false;
    settingsStore?.save({ skillEnabled: map } as never);
    return { ok: true, id, enabled: map[id] };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});
// patch skills-list to include enabled flag
const _skillsListHandler = async () => {
  const skills: Array<Record<string, unknown>> = [];
  const scanDirStatus = skillScanStatus(loadSkillScanDirs());
  const enabledMap = skillEnabledMap();
  for (const { root, source } of skillRoots()) {
    if (!fs.existsSync(root)) continue;
    const pushOne = (dirName: string, md: string) => {
      const info = skillMdInfo(md);
      let mtime = 0;
      try { mtime = fs.statSync(md).mtimeMs; } catch { /* ignore */ }
      const id = source === 'discovered' ? 'discovered:' + path.basename(root) + ':' + dirName : dirName;
      const enabled = enabledMap[id] !== false;
      skills.push({ id, name: info.name || dirName, description: info.description, source, root, mtime, enabled, removable: source !== 'discovered' });
    };
    if (source === 'discovered') {
      const selfMd = path.join(root, 'SKILL.md');
      if (fs.existsSync(selfMd)) pushOne(path.basename(root), selfMd);
    }
    let dirs: string[] = [];
    try {
      dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch { continue; }
    for (const d of dirs) {
      const md = path.join(root, d, 'SKILL.md');
      if (!fs.existsSync(md)) continue;
      pushOne(d, md);
    }
  }
  skills.sort((x, y) => Number(y.mtime || 0) - Number(x.mtime || 0));
  return { ok: true, skills, scanDirs: scanDirStatus, maxScanDirs: SKILL_SCAN_DIRS_MAX };
};
// re-register by replacing through handleIpc if it overwrites; electron handleIpc likely last-wins
handleIpc('warmy:skills-list', () => _skillsListHandler());

// ── S. 消息搜索（从 memory-os recall） ──
handleIpc('warmy:search-messages', async (_e, q: string) => {
  try {
    const r = await memory?.recall(q, 20);
    return { ok: true, hits: r?.cards || [] };
  } catch (e) {
    return { ok: false, hits: [], error: sanitizeError(e) };
  }
});


// ── V. 插件真实安装/卸载 ──
handleIpc('warmy:plugin-install', (_e, pkg: string) => {
  try {
    const dshHome = path.join(app.getPath('userData'), 'dsh-home');
    const profile = 'warmy';
    // 用 pnpm 安装到 profile
    const profileDir = path.join(dshHome, 'profiles', profile);
    fs.mkdirSync(profileDir, { recursive: true });
    const pkgJson = path.join(profileDir, 'package.json');
    if (!fs.existsSync(pkgJson)) {
      fs.writeFileSync(pkgJson, JSON.stringify({ name: 'dsh-profile-warmy', private: true, dependencies: {} }, null, 2));
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
handleIpc('warmy:plugin-uninstall', (_e, pkg: string) => {
  try {
    const dshHome = path.join(app.getPath('userData'), 'dsh-home');
    const pkgJson = path.join(dshHome, 'profiles', 'warmy', 'package.json');
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
handleIpc('warmy:archived-list', () => safeHandle(() => ({ ok: true, items: archived }), { ok: true, items: [] }))
handleIpc('warmy:archived-add', (_e, payload: { id: string; name: string; kind: string }) => {
  try {
    archived.push({ ...payload, ts: Date.now() });
    return { ok: true, items: archived };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});
handleIpc('warmy:archived-restore', (_e, id: string) => {
  try {
    const idx = archived.findIndex((x) => x.id === id);
    if (idx < 0) return { ok: false };
    const item = archived.splice(idx, 1)[0];
    return { ok: true, item };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});


// ── 审计日志 ──
handleIpc('warmy:audit-log', (_e, limit?: number) => ({
  ok: true,
  entries: audit?.read(limit || 50) || [],
}));
handleIpc('warmy:audit-clear', () => {
  try {
    audit?.clear();
    return { ok: true };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

// ── SafeStorage 密钥 ──
handleIpc('warmy:secure-key-save', async (_e, payload: { providerId: string; apiKey: string }) => {
  try {
    await secureKeys?.save(payload.providerId, payload.apiKey);
    audit?.log('key.save', { providerId: payload.providerId });
    return { ok: true };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});
handleIpc('warmy:secure-key-load', async (_e, providerId: string) => {
  try {
    const key = await secureKeys?.load(providerId);
    return { ok: !!key, key: key || null };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

// ── KnowledgeArchiver ──
handleIpc('warmy:archive-external', (_e, payload: { groupId: string; title: string; summary: string; anchors?: Array<{ file: string; seq: number }> }) => {
  let extraction = null as null | ReturnType<typeof extractKnowledgeFromArchive> | { error?: string };
  let structured = null as null | ReturnType<typeof extractStructuredSummary>;
  try {
    extraction = extractKnowledgeFromArchive({
      groupId: String(payload.groupId || ''),
      title: String(payload.title || ''),
      summary: String(payload.summary || ''),
    });
    structured = extractStructuredSummary({
      groupId: String(payload.groupId || ''),
      title: String(payload.title || ''),
      text: String(payload.summary || ''),
    });
  } catch (e) {
    extraction = { error: sanitizeError(e) };
  }
  const r = archiver?.archive({
    id: 'arc-' + Date.now(),
    groupId: payload.groupId,
    title: payload.title,
    summary: payload.summary,
    anchors: payload.anchors || [],
    ...(structured ? { structured: { bullets: structured.bullets, decisions: structured.decisions, todos: structured.todos, risks: structured.risks } } : {}),
  });
  // 归档触发整理：摘要 → 知识库实体/事件 + 使用者偏好（持久跨会话）
  try {
    if (knowledge && extraction && !(extraction as { error?: string }).error) {
      const ex = extraction as ReturnType<typeof extractKnowledgeFromArchive>;
      for (const e of ex.entities) {
        const kindMap = ['person', 'org', 'material', 'place', 'concept', 'tool', 'project'] as const;
        const kind = (kindMap as readonly string[]).includes(String(e.kind)) ? (e.kind as (typeof kindMap)[number]) : 'concept';
        knowledge.upsertEntity({ id: e.id, kind, name: e.name, attrs: e.attrs || {}, anchors: [] });
      }
      knowledge.upsertEntity({
        id: `grp-${payload.groupId}`,
        kind: 'project',
        name: String(payload.groupId),
        attrs: {},
        anchors: (payload.anchors || []).map((a) => ({ file: a.file, seq: a.seq, recordId: `seq:${a.seq}` })),
      });
      for (const ev of ex.events) {
        knowledge.addEvent({
          id: ev.id,
          title: ev.title,
          result: ev.result || '',
          entityIds: [`grp-${payload.groupId}`],
          anchors: (payload.anchors || []).map((a) => ({ file: a.file, seq: a.seq, recordId: `seq:${a.seq}` })),
          ts: Date.now(),
        });
      }
      if (ex.preferences?.length) mergeUserPreferences(app.getPath('userData'), ex.preferences);
    }
  } catch (e) {
    extraction = { error: sanitizeError(e) };
  }
  audit?.log('archive.external', { groupId: payload.groupId, prefs: (extraction as { preferences?: unknown[] } | null)?.preferences?.length || 0 });
  return { ok: true, entry: r, extraction, structured };
});
handleIpc('warmy:session-summary', async (_e, payload?: { sessionId?: string; auto?: boolean }) => {
  try {
    const gid = String(payload?.sessionId || '');
    if (!gid) return { ok: false, error: 'sessionId required' };
    const logs = chatLogs.get(gid) || [];
    const recent = logs.slice(-30).map((l) => `${l.role}: ${String(l.content || '').slice(0, 160)}`).join('\n');
    if (!recent.trim()) return { ok: false, error: 'no-history' };
    const title = `${gid} 会话摘要 ${new Date().toLocaleString()}`;
    const structured = extractStructuredSummary({ groupId: gid, title, text: recent });
    const summary =
      [
        `# ${title}`,
        structured.decisions.length ? `## 决策\n${structured.decisions.map((d) => '- ' + d).join('\n')}` : '',
        structured.todos.length ? `## 待办\n${structured.todos.map((d) => '- ' + d).join('\n')}` : '',
        structured.risks.length ? `## 风险\n${structured.risks.map((d) => '- ' + d).join('\n')}` : '',
        `## 要点\n${structured.bullets.map((d) => '- ' + d).join('\n')}`,
      ].filter(Boolean).join('\n\n').slice(0, 4000);
    // 尽量带上锚点：用最近日志的 seq（便于右栏「跳到原文」）
    const anchors = logs.slice(-5)
      .filter((l) => l && l.seq != null)
      .map((l) => ({ file: 'chat-log', seq: Number(l.seq || 0), recordId: `seq:${l.seq}` }));
    const entry = archiver?.archive({
      id: 'arc-' + Date.now(),
      groupId: gid,
      title,
      summary,
      anchors,
      structured: {
        bullets: structured.bullets,
        decisions: structured.decisions,
        todos: structured.todos,
        risks: structured.risks,
      },
    });
    try {
      const ex = extractKnowledgeFromArchive({ groupId: gid, title, summary });
      if (knowledge) {
        knowledge.upsertEntity({ id: `grp-${gid}`, kind: 'project', name: gid, attrs: {}, anchors: [] });
        for (const e of ex.entities) {
          const kindMap = ['person','org','material','place','concept','tool','project'] as const;
          const kind = (kindMap as readonly string[]).includes(String(e.kind)) ? (e.kind as (typeof kindMap)[number]) : 'concept';
          knowledge.upsertEntity({ id: e.id, kind, name: e.name, attrs: e.attrs || {}, anchors: [] });
        }
        for (const ev of ex.events) {
          knowledge.addEvent({ id: ev.id, title: ev.title, result: ev.result || '', entityIds: [`grp-${gid}`], anchors: [], ts: Date.now() });
        }
      }
      if (ex.preferences?.length) mergeUserPreferences(app.getPath('userData'), ex.preferences);
    } catch { /* 提炼失败不影响摘要落盘 */ }
    audit?.log('session.summary', { sessionId: gid, auto: !!payload?.auto });
    return { ok: true, entry, structured };
  } catch (e) {
    return { ok: false, error: sanitizeError(e) };
  }
});
handleIpc('warmy:archive-list', (_e, groupId?: string) => ({
  ok: true,
  entries: archiver?.list(groupId) || [],
}));

// ── CleanupManager ──
handleIpc('warmy:cleanup-run', (_e, opts?: { checkpoints?: number }) => {
  try {
    const n = cleanup?.cleanCheckpoints(opts?.checkpoints || 20) || 0;
    const v = cleanup?.cleanVoice() || 0;
    audit?.log('cleanup.run', { checkpoints: n, voice: v });
    return { ok: true, checkpointsRemoved: n, voiceRemoved: v };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

// ── 模型角色分配 ──
handleIpc('warmy:role-models-set', (_e, roles: RoleModelConfig) => {
  try {
    roleModels = { ...roleModels, ...roles };
    audit?.log('roles.set', roles);
    return { ok: true, roles: roleModels };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});
handleIpc('warmy:role-models-get', () => safeHandle(() => ({ ok: true, roles: roleModels }), { ok: true, roles: {} }))

// ── 解散群组 ──
handleIpc('warmy:group-dissolve', (_e, groupId: string) => {
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
handleIpc('warmy:export-allowlist', () => {
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
handleIpc('warmy:import-openclaw', () => {
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

handleIpc('warmy:special-models-set', (_e, cfg: { asr?: { provider: string }; embedding?: { provider: string }; summary?: { provider: string; model?: string }; organizer?: { provider: string; model?: string } }) => {
  try {
    if (settingsStore) {
      const cur = settingsStore.load() as unknown as Record<string, unknown>;
      settingsStore.save({ ...cur, specialModels: cfg } as never);
    }
    return { ok: true };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

handleIpc('warmy:special-models-get', () => {
  try {
    const s = settingsStore?.load() as unknown as Record<string, unknown>;
    return { ok: true, specialModels: s?.specialModels || {} };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});

handleIpc('warmy:asr-ollama', async (_e, payload: { audioBase64: string; model?: string }) => {
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
handleIpc('warmy:join-request', (_e, payload: { name: string; kind: string; target: string; targetType: string }) => {
  try {
    const id = "jr-" + Date.now();
    const ts = Date.now();
    joinRequests.push({ id, name: payload.name, kind: payload.kind, target: payload.target, targetType: payload.targetType, ts, expireAt: ts + 30 * 24 * 3600_000 });
    audit?.log('join.request', { id, name: payload.name, target: payload.target });
    return { ok: true, id };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});
handleIpc('warmy:join-pending', () => {
  try {
    const now = Date.now();
    const valid = joinRequests.filter((r) => r.expireAt > now);
    return { ok: true, items: valid, count: valid.length };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});
handleIpc('warmy:join-respond', (_e, payload: { id: string; action: 'agree' | 'reject' | 'block' }) => {
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
handleIpc('warmy:blacklist-list', () => safeHandle(() => ({ ok: true, items: blacklist }), { ok: true, items: [] }))
handleIpc('warmy:blacklist-remove', (_e, id: string) => {
  try {
    const i = blacklist.findIndex((b) => b.id === id);
    if (i >= 0) blacklist.splice(i, 1);
    return { ok: true };
  } catch (e) { return { ok: false, error: sanitizeError(e) }; }
});
