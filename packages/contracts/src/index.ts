/**
 * @warmy/contracts — P0 冻结接口
 *
 * 对应 ADR 000 的十二份契约：
 * ACP协议 / 编排Schema / recall+retrieve签名 / JSONL记录格式 /
 * MemoryStore接口 / 错误分类表 / WorkerResult / 状态差分 /
 * 缓存三层顺序 / EvidenceAnchor / BoardAction / GroupConfig
 */

// ─────────────────────────────────────────────
// 1. ACP 协议（Agent Control Protocol，主进程 ↔ dsh 实例）
// ─────────────────────────────────────────────

/** 数据面：带版本二进制帧，单帧 ≤ 64KiB */
export interface AcpZhenTou {
  version: 1;
  /** 帧类型：控制/数据/心跳/取消 */
  kind: 'control' | 'data' | 'heartbeat' | 'cancel';
  /** 请求关联 ID */
  correlationId: string;
  /** 载荷字节长度（不含 header） */
  payloadLength: number;
}

/** 控制面：Node IPC 仅三类消息 */
export type AcpKongzhiXiaoxi =
  | { type: 'ready'; pid: number; version: string }
  | { type: 'fatal'; code: string; message: string }
  | { type: 'shutdown'; reason?: string };

/** 记忆服务经 UDS/NamedPipe 调用时的 per-session token */
export interface AcpHuihuaLingpai {
  sessionId: string;
  token: string;
  /** 目录权限 0700 */
  pipePath: string;
  expiresAt: number;
}

// ─────────────────────────────────────────────
// 2. 编排 Schema（值班者状态机输入输出）
// ─────────────────────────────────────────────

/** 指令紧急度分级 */
export type Jinji = 'P0' | 'P1' | 'P2' | 'P3';

/** 值班者状态 */
export type ZhibanTai =
  | 'idle'
  | 'listening'
  | 'orchestrating'
  | 'busy'
  | 'queued'
  | 'dead';

/** 群内一次用户发言 → 值班者编排决策 */
export interface OrchestrationRequest {
  groupId: string;
  userId: string;
  content: string;
  urgency: Jinji;
  /** 定向模式下 @ 的实例 ID；非定向为空 */
  mentionIds: string[];
  timestamp: number;
}

export interface OrchestrationDecision {
  /** 被派发任务的执行者实例 ID 列表 */
  executorIds: string[];
  /** 值班者给每个执行者的任务摘要（已过 CCR 压缩） */
  taskBrief: string;
  /** 注入上下文的 token 预算 */
  contextBudget: number;
  /** 是否需要排队等待 */
  shouldQueue: boolean;
}

// ─────────────────────────────────────────────
// 3. recall + retrieve 签名（双刀检索）
// ─────────────────────────────────────────────

/** recall：发现 → 索引卡 */
export interface HuisuoChaxun {
  query: string;
  /** 作用域预过滤 */
  scope?: {
    sessionId?: string;
    groupId?: string;
    entityType?: string;
  };
  limit?: number;
}

export interface RecallCard {
  /** 指向 JSONL 的证据锚点 */
  anchor: ZhengjuMaodian;
  /** 摘要/索引片段 */
  snippet: string;
  score: number;
  source: 'fts_uni' | 'fts_tri' | 'vector' | 'fused';
}

/** retrieve：解引用，三级回退 */
export interface RetrieveRequest {
  anchor: ZhengjuMaodian;
  /** 回退策略：exact → nearby → fuzzy */
  huiTui?: 'exact' | 'nearby' | 'fuzzy';
}

export interface JiansuoJieguo {
  /** 原文（逐字节） */
  YuanWen: string;
  anchor: ZhengjuMaodian;
  /** 命中级别 */
  hitLevel: 'exact' | 'nearby' | 'fuzzy';
}

// ─────────────────────────────────────────────
// 4. JSONL 记录格式（只追加，唯一事实来源）
// ─────────────────────────────────────────────

export type JsonlJiluLeixing =
  | 'message'
  | 'tool_call'
  | 'tool_result'
  | 'system'
  | 'checkpoint'
  | 'board'
  | 'queue'
  | 'compressed_marker';

/** 所有 JSONL 记录的公共头 */
export interface JsonlRecordBase {
  /** 单调递增，只追加 */
  seq: number;
  ts: number;
  sessionId: string;
  kind: JsonlJiluLeixing;
  /** 本记录唯一 ID */
  id: string;
}

export interface XiaoxiJilu extends JsonlRecordBase {
  kind: 'message';
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** 若内容经过 CCR 压缩，指向压缩前标记 */
  compressedFrom?: string;
}

export interface GongjuDiaoyongJilu extends JsonlRecordBase {
  kind: 'tool_call';
  toolName: string;
  args: unknown;
  /** 权限审批结果 */
  approval: 'auto' | 'once' | 'project' | 'global' | 'denied';
}

export interface GongjuJieguoJilu extends JsonlRecordBase {
  kind: 'tool_result';
  toolCallId: string;
  /** 压缩后的输出 */
  shuChu: string;
  isError: boolean;
}

/** 压缩标记：日志本身即压缩态 */
export interface CompressedMarkerRecord extends JsonlRecordBase {
  kind: 'compressed_marker';
  /** 被压缩的 seq 范围 */
  range: { from: number; to: number };
  /** 压缩摘要 */
  summary: string;
  /** 可 recall 回原文的锚点列表 */
  anchors: ZhengjuMaodian[];
}

export type JsonlJilu =
  | XiaoxiJilu
  | GongjuDiaoyongJilu
  | GongjuJieguoJilu
  | CompressedMarkerRecord
  | (JsonlRecordBase & {
      kind: 'system' | 'checkpoint' | 'board' | 'queue';
      payload: unknown;
    });

// ─────────────────────────────────────────────
// 5. MemoryStore 接口（写入者唯一约束）
// ─────────────────────────────────────────────

export interface MemoryStoreWriteOptions {
  /**
   * 写入者身份。铁律：
   * - fast-memory.jsonl 仅值班者可写
   * - queue.jsonl 仅 Router 可写
   * - SQLite 仅记忆服务可写
   */
  Bi: 'duty' | 'router' | 'memory-service' | 'executor';
}

export interface MemoryStore {
  /** 只追加写入 JSONL */
  append(record: JsonlJilu, Xuan: MemoryStoreWriteOptions): Promise<void>;
  /** 极速层读取（最近 N 条） */
  tail(limit: number): Promise<JsonlJilu[]>;
  /** 深度层检索 */
  recall(query: HuisuoChaxun): Promise<RecallCard[]>;
  retrieve(Qiu: RetrieveRequest): Promise<JiansuoJieguo>;
  /** 投影重建：从 JSONL 全量重建 SQLite */
  rebuildProjection(): Promise<void>;
}

// ─────────────────────────────────────────────
// 6. 错误分类表
// ─────────────────────────────────────────────

export type CuowuLeibie =
  | 'PERMISSION_DENIED'
  | 'BOUNDARY_VIOLATION'
  | 'PROTO_FRAME'
  | 'PROTO_TIMEOUT'
  | 'IPC_DEAD'
  | 'WORKER_CRASH'
  | 'MEMORY_CORRUPT'
  | 'SESSION_MIGRATE'
  | 'MODEL_UNAVAILABLE'
  | 'CONTEXT_OVERFLOW'
  | 'UNKNOWN';

export interface GuileiCuowu {
  category: CuowuLeibie;
  code: string;
  message: string;
  /** 可恢复性 */
  recoverable: boolean;
  cause?: unknown;
}

// ─────────────────────────────────────────────
// 7. WorkerResult（短命执行者返回）
// ─────────────────────────────────────────────

export interface GongzuozheRenwuShuru {
  taskId: string;
  brief: string;
  /** 上下文 = O(任务规模) */
  contextItems: string[];
  budgetTokens: number;
}

export interface GongzuozheJieguo {
  taskId: string;
  /** 蒸馏结论（不是原始对话） */
  distilled: string;
  /** 产物文件路径（工作区内） */
  artifacts: string[];
  /** 耗时与 token 统计 */
  stats: {
    durationMs: number;
    promptTokens: number;
    completionTokens: number;
  };
  /** 错误时非空 */
  error?: GuileiCuowu;
}

// ─────────────────────────────────────────────
// 8. 状态差分（检查点/回退）
// ─────────────────────────────────────────────

export interface JianchadianZengliang {
  checkpointId: string;
  /** 轮起 / 轮末 */
  phase: 'round_start' | 'round_end';
  /** 对话状态：日志 seq 截断点 */
  logSeq: number;
  /** 文件状态：CoW 优先，shadow-git 回退 */
  fileStateRef: {
    strategy: 'cow' | 'shadow-git';
    ref: string;
  };
}

// ─────────────────────────────────────────────
// 9. 缓存三层顺序
// ─────────────────────────────────────────────

/**
 * 注入上下文的渲染顺序（铁律：视图有界，与日志总长度解耦）
 * 1. in-history 系统提示（不破坏 KV Cache）
 * 2. 只追加历史（经 CCR 压缩后的有界视图）
 * 3. 状态卡片（≤ 2000 token）
 */
export interface ShangxiawenXuanranCeng {
  inHistorySystemPrompt: string;
  appendedHistoryView: string;
  statusCard: string;
  /** 总注入预算 */
  totalBudgetTokens: number;
}

// ─────────────────────────────────────────────
// 10. EvidenceAnchor（证据锚点）
// ─────────────────────────────────────────────

export interface ZhengjuMaodian {
  /** JSONL 文件路径（相对 userData） */
  file: string;
  /** 记录 seq */
  seq: number;
  /** 记录 id */
  recordId: string;
  /** 可选：字节偏移，加速 seek */
  byteOffset?: number;
}

// ─────────────────────────────────────────────
// 11. BoardAction（看板写入，仅值班者）
// ─────────────────────────────────────────────

export type KanbanLing =
  | { type: 'create_task'; id: string; title: string; owner?: string }
  | { type: 'update_progress'; id: string; jinDu: number; note?: string }
  | { type: 'complete_task'; id: string; result?: string }
  | { type: 'add_note'; id: string; note: string }
  | { type: 'block'; id: string; reason: string };

export interface KanbanShi {
  seq: number;
  ts: number;
  groupId: string;
  action: KanbanLing;
  /** 解析来源：值班者从自然语言解析 */
  parsedFrom: string;
}

// ─────────────────────────────────────────────
// 12. GroupConfig（群类型与权限）
// ─────────────────────────────────────────────

export type QunLei = 'internal' | 'external' | 'direct';

export type QunJuese = 'creator' | 'admin' | 'member' | 'external_member';

export type QuanxianMiyao =
  | 'dissolve_group'
  | 'modify_settings'
  | 'appoint_admin'
  | 'invite_members'
  | 'approve_join'
  | 'approve_tool'
  | 'manage_allowlist'
  | 'view_knowledge'
  | 'talk_to_duty'
  | 'view_board';

/** 权限矩阵：角色 × 权限项 → boolean 或 'readonly' */
export type QuanxianJuzhen = Record<
  QunJuese,
  Record<QuanxianMiyao, boolean | 'readonly'>
>;

export interface QunYuan {
  id: string;
  /** 人或 AI 实例 */
  kind: 'human' | 'ai';
  role: QunJuese;
  /** 远程 AI：incognito，无痕执行 */
  isRemote: boolean;
  /** 远程 AI 所属节点 ID */
  nodeId?: string;
}

export interface QunPeizhi {
  groupId: string;
  ming: string;
  type: QunLei;
  /** 值班者实例 ID（仅本机实例可成为值班者） */
  dutyInstanceId: string | null;
  /** 定向模式：必须 @ 才响应 */
  directedMode: boolean;
  members: QunYuan[];
  permissions: QuanxianJuzhen;
  /** 检查点上限，默认 50 */
  checkpointLimit: number;
}
