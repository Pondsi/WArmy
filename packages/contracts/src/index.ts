/**
 * @warmy/contracts — P0 冻结接口 · **v1.1（第 48 轮「契约全部接入」）**
 *
 * 对应 ADR 000 的十二份契约，外加第 13 份（ADR000 P5 的 SharedContext）：
 *   ACP协议 / 编排Schema / recall+retrieve签名 / JSONL记录格式 / MemoryStore接口 / 错误分类表 /
 *   WorkerResult / 状态差分 / 缓存三层顺序 / EvidenceAnchor / BoardAction / GroupConfig / 任务黑板
 *
 * **v1.1 的口径：契约 = 现实**。v1.0 冻结之后，实现各写了一份自己的类型、契约本身没人 import（只有
 * group-router 用了 6 个）⇒ "冻结"停在纸面，同一个概念已经出现多份不一致的定义（证据锚点 3 份、
 * 群类型少一个值）。这一版逐份改成**实现真实在用的形状**，并让实现处 `import type` 它；
 * 只描述过、从未实现的设计（ACP 二进制帧、UDS 会话令牌）明确标【未落地】，不假装存在。
 * 门禁 `dev/gates/verify-r48-qiyue.mjs`：每个导出类型都要有真实消费点（或标【未落地】并写明原因），
 * 包外不许再定义同名类型（只许 import / extends / 起别名）。
 *
 * ⚠️ 本包**只许有类型**：memory-os 以子进程运行，运行时目录里没有本包（只拷了 memory-os/dist 顶层文件），
 * 任何值导出都会让子进程起不来。
 */

/* ───────────────────────── 1. ACP 协议 ───────────────────────── */

/**
 * 【未落地】数据面二进制帧（带版本、单帧 ≤ 64KiB）。
 * 现实：记忆服务与 dsh 运行时都走 Node `child_process` 的 IPC 通道（结构化克隆），没有自定义帧格式。
 * 真要跨机器/跨语言传大块数据时再实现；在那之前不许有代码假装在用它。
 */
export interface AcpZhenTou {
    version: 1;
    kind: 'control' | 'data' | 'heartbeat' | 'cancel';
    correlationId: string;
    payloadLength: number;
}
/**
 * 控制面：**子进程 → 宿主**的控制消息（记忆服务 `memory-os/src/index.ts` 的 ready、
 * dsh 运行时的 ready / dsh-exit / pong）。v1.0 只写了 ready/fatal/shutdown 三类且 ready 必带 version，
 * 与两个子进程的真实发送内容都对不上。
 */
export type AcpKongzhiXiaoxi = {
    type: 'ready';
    pid: number;
    version?: string;
    /** 记忆服务：数据目录 */
    CangLu?: string;
    /** 记忆服务：投影 schema 版本 */
    schemaVersion?: number;
    /** dsh 运行时：被拉起的 dsh 进程号 */
    dshPid?: number;
} | {
    type: 'fatal';
    code: string;
    message: string;
} | {
    type: 'shutdown';
    reason?: string;
} | {
    type: 'dsh-exit';
    code: number | null;
} | {
    type: 'pong';
};
/**
 * 【未落地】记忆服务经 UDS/NamedPipe 调用时的 per-session token。
 * 现实：记忆服务由宿主 `fork` 起来，只有父进程持有 IPC 通道，不存在第三方连进来的入口 ⇒ 不需要会话令牌。
 */
export interface AcpHuihuaLingpai {
    sessionId: string;
    token: string;
    /** 目录权限 0700 */
    pipePath: string;
    expiresAt: number;
}

/* ───────────────────────── 2. 编排 Schema ───────────────────────── */

/** 指令紧急度分级 */
export type Jinji = 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
/** 值班者状态 */
export type ZhibanTai = 'idle' | 'listening' | 'orchestrating' | 'busy' | 'queued' | 'dead';
/** 值班者可用的插话方式（只影响投递/插队，不影响模型） */
export type CuoHuaFangShi = 'none' | 'stop' | 'urgent' | 'insert' | 'queue';
/** 思考档位：auto + 界面 7 个非自动档（off=灵机，l1..l6=微觉..参悟） */
export type SiKaoDangWei = 'auto' | 'off' | 'l1' | 'l2' | 'l3' | 'l4' | 'l5' | 'l6';
/** 值班者给某只执行者的派发安排（**不含模型**：模型由牛马自己的设置决定） */
export interface ZhiXingFenPei {
    executorId: string;
    ming: string;
    /** auto = 跟随牛马自己的思考级别；具体档位 = 值班者为本次任务指定 */
    thinkLevel: SiKaoDangWei;
    /** 目标正在对话/任务中时，值班者选择的插话方式 */
    interrupt: CuoHuaFangShi;
    why: string;
}
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
    /** 被派发任务的执行者实例 ID 列表（兼容旧字段；以 assignments 为准） */
    executorIds: string[];
    /** 候选执行者池（含忙碌成员，供值班者按紧急度/难易度挑） */
    candidateIds?: string[];
    /** 值班者派发安排：执行者/思考级别/插话方式；**不包含模型** */
    assignments?: ZhiXingFenPei[];
    /** 值班者给每个执行者的任务摘要（已过 CCR 压缩） */
    taskBrief: string;
    /** 注入上下文的 token 预算 */
    contextBudget: number;
    /** 是否需要排队等待 */
    shouldQueue: boolean;
}

/* ───────────────────────── 3. recall + retrieve 签名 ───────────────────────── */

export type HuisuoLaiyuan = 'fts_uni' | 'fts_tri' | 'vector' | 'fused';
/** recall：发现 → 索引卡（作用域先于相关性） */
export interface HuisuoChaxun {
    query: string;
    /** 作用域预过滤（v1.1 加 `kind`：只查归档摘要 / 只查任务黑板 这类按记录种类过滤是真实在用的） */
    scope?: {
        sessionId?: string;
        groupId?: string;
        entityType?: string;
        kind?: string;
    };
    limit?: number;
}
/** recall 返回的索引卡（实现可以 extends 它加诊断字段：各通道排名、RRF 分等） */
export interface RecallCard {
    /** 指向 JSONL 的证据锚点 */
    anchor: ZhengjuMaodian;
    seq: number;
    recordId: string;
    /** 摘要/索引片段 */
    snippet: string;
    score: number;
    source: HuisuoLaiyuan;
}
/** retrieve：解引用，三级回退（exact → nearby → fuzzy） */
export interface RetrieveRequest {
    /** 至少给 seq 或 recordId 之一（v1.0 把整个锚点设成必填，实现与调用方从来只给一部分） */
    anchor: {
        seq?: number;
        recordId?: string;
        file?: string;
        byteOffset?: number;
    };
    huiTui?: 'exact' | 'nearby' | 'fuzzy';
    /** nearby 级别的 seq 邻域半径 */
    window?: number;
    /**
     * 作用域（不变量 #9「权限过滤先于相关性」在解引用侧的那一半）：给了就只认作用域内的记录，
     * 否则拿到别处的 seq/recordId 直接 retrieve 就绕过了召回的作用域。
     */
    scope?: HuisuoChaxun['scope'];
}
/** retrieve 的结果（v1.0 的 `YuanWen` 字段实现里叫 `raw`，且多了命中方式与说明） */
export interface JiansuoJieguo {
    /** 原文（逐字节） */
    raw: string;
    seq: number;
    recordId: string;
    /** 命中级别 */
    hitLevel: 'exact' | 'nearby' | 'fuzzy';
    /** 具体命中方式（sqlite:seq / jsonl:recordId / fts …） */
    via: string;
    anchor: ZhengjuMaodian;
    /** 人类可读说明（分级回退时记录了上一级为何失败） */
    note?: string;
}

/* ───────────────────────── 4. JSONL 记录格式 ───────────────────────── */

/**
 * 记录种类。现实在写的：`message`（会话消息）、`archive`（归档摘要，可召回）、
 * `blackboard`（任务黑板条目）、`worker`（执行者完整结论，超长蒸馏时的原文）。
 * `tool_call / tool_result / compressed_marker` 是 v1.0 的设计：【未落地】——
 * 工具调用记在 `audit.jsonl`，CCR 压缩只产出预览、不写压缩标记记录。
 */
export type JsonlJiluLeixing = 'message' | 'archive' | 'blackboard' | 'worker' | 'system' | 'checkpoint' | 'board' | 'queue' | 'tool_call' | 'tool_result' | 'compressed_marker';
/** 所有 JSONL 记录的公共头（`kind` 在存储层保持开放：记忆服务不认识的种类也照样只追加保存） */
export interface JsonlRecordBase {
    /** 单调递增，只追加 */
    seq: number;
    ts: number;
    sessionId: string;
    kind: JsonlJiluLeixing | (string & {});
    /** 本记录唯一 ID（宿主生成：m-/a-/g- 会话消息，arc- 归档，hb- 黑板，wk- 执行者全文） */
    id: string;
    /** 正文（检索与回读都以它为准） */
    ti?: string;
    groupId?: string;
    entityType?: string;
}
/** 存储层真实的记录：公共头 + 写入方带来的任意附加字段（role、渲染元数据…原样进 JSONL） */
export type JsonlJilu = JsonlRecordBase & {
    [k: string]: unknown;
};
/** 写入时的记录（seq/ts 由记忆服务分配） */
export type JsonlXieRu = Omit<JsonlRecordBase, 'seq' | 'ts'> & {
    [k: string]: unknown;
};
/** 会话消息记录 */
export interface XiaoxiJilu extends JsonlRecordBase {
    kind: 'message';
    role?: 'user' | 'assistant' | 'system';
    ti: string;
    /** 若内容经过 CCR 压缩，指向压缩前标记 */
    compressedFrom?: string;
}
/** 【未落地】工具调用记录（现实：工具调用写在 audit.jsonl，不进记忆 JSONL） */
export interface GongjuDiaoyongJilu extends JsonlRecordBase {
    kind: 'tool_call';
    toolName: string;
    args: unknown;
    approval: 'auto' | 'once' | 'project' | 'global' | 'denied';
}
/** 【未落地】工具结果记录（现实同上） */
export interface GongjuJieguoJilu extends JsonlRecordBase {
    kind: 'tool_result';
    toolCallId: string;
    shuChu: string;
    isError: boolean;
}
/** 【未落地】压缩标记（现实：CCR 只产出有界预览，原文整条留在 JSONL，没有"压缩态日志"） */
export interface CompressedMarkerRecord extends JsonlRecordBase {
    kind: 'compressed_marker';
    range: {
        from: number;
        to: number;
    };
    summary: string;
    anchors: ZhengjuMaodian[];
}

/* ───────────────────────── 5. MemoryStore 接口 ───────────────────────── */

export interface MemoryStoreWriteOptions {
    /**
     * 写入者身份。铁律：
     * - 会话消息仅值班者/记忆服务可写（执行者只回蒸馏，不直接写 message 流）
     * - queue 仅 Router 可写
     * - SQLite 投影仅记忆服务可写
     */
    Bi: 'duty' | 'router' | 'memory-service' | 'executor';
}
/** 写入者（`MemoryStoreWriteOptions['Bi']` 的别名，IPC 上传的是裸字符串） */
export type XieRuZhe = MemoryStoreWriteOptions['Bi'];
export interface MemoryStoreZhuiJiaHuiYing {
    ok: boolean;
    seq?: number;
    error?: string;
}
/**
 * 记忆库的**宿主侧**接口（v1.1 = `app-shell/src/memory-client.ts` 的真实形状：跨进程 IPC，全部异步）。
 * v1.0 写的签名（append 收 `{Bi}` 对象、recall 收对象、retrieve 收 RetrieveRequest）没有任何实现照着做；
 * 记忆服务子进程内部是同步实现（`JiyiCangFuwu`），不在这份接口的范围内。
 */
export interface MemoryStore {
    /** 只追加写入 JSONL（返回分配到的 seq） */
    append(record: JsonlXieRu, Bi?: XieRuZhe): Promise<MemoryStoreZhuiJiaHuiYing>;
    /** 极速层读取（最近 N 条） */
    tail(limit?: number): Promise<unknown>;
    /** 深度层检索（全局） */
    recall(query: string, limit?: number): Promise<unknown>;
    /** 深度层检索（带作用域；权限先于相关性） */
    recallScoped(query: string, limit?: number, scope?: HuisuoChaxun['scope']): Promise<unknown>;
    /** 解引用（逐字节原文） */
    retrieve(anchor: RetrieveRequest['anchor'], opts?: Pick<RetrieveRequest, 'huiTui' | 'window' | 'scope'>): Promise<unknown>;
    /** 投影重建：从 JSONL 全量重建 SQLite */
    rebuildProjection(): Promise<unknown>;
}

/* ───────────────────────── 6. 错误分类表 ───────────────────────── */

/**
 * 错误类别。v1.1 新增 `MODERATION_BLOCKED`：供应商风控把请求拦下、却以 200 + 一句样板话回来
 * （第 45 轮真机抓到的 MiMo "rejected … high risk"）——它既不是模型不可用、也不是上下文溢出。
 */
export type CuowuLeibie = 'PERMISSION_DENIED' | 'BOUNDARY_VIOLATION' | 'PROTO_FRAME' | 'PROTO_TIMEOUT' | 'IPC_DEAD' | 'WORKER_CRASH' | 'MEMORY_CORRUPT' | 'SESSION_MIGRATE' | 'MODEL_UNAVAILABLE' | 'CONTEXT_OVERFLOW' | 'MODERATION_BLOCKED' | 'UNKNOWN';
export interface GuileiCuowu {
    category: CuowuLeibie;
    code: string;
    message: string;
    /** 可恢复性（重试/收缩/换模型有意义 = true；钥匙错、越界这类重试没用 = false） */
    recoverable: boolean;
    cause?: unknown;
}

/* ───────────────────────── 7. WorkerResult（执行者协议：输入 + 蒸馏返回） ───────────────────────── */

export interface GongzuozheRenwuShuru {
    taskId: string;
    brief: string;
    /** 上下文 = O(任务规模)（马尔可夫毯，宿主设尺寸闸） */
    contextItems: string[];
    /** v1.1 改可选：实现里没给就按执行者档位默认值 */
    budgetTokens?: number;
}
/** 蒸馏出的一条决定（`zhuTi` 是冲突检测的键：同一主题两个执行者说法不同 ⇒ 交值班者裁决） */
export interface ZhengLiuJueDing {
    zhuTi: string;
    nei: string;
}
export interface GongzuozheJieguo {
    taskId: string;
    /** 蒸馏结论（硬上限；超长时是"开头 + 可执行指针"，完整原文见 fullRecordId） */
    distilled: string;
    /** 产物文件路径（**宿主核实过真的存在**的绝对路径） */
    artifacts: string[];
    /** 耗时与 token 统计 */
    stats: {
        durationMs: number;
        promptTokens: number;
        completionTokens: number;
    };
    /** 错误时非空 */
    error?: GuileiCuowu;
    /* —— v1.1：真正的蒸馏（结构化，不是把最后一段正文原样当结论） —— */
    /** 关键事实（每条有上限、条数有上限） */
    facts?: string[];
    decisions?: ZhengLiuJueDing[];
    /** 还没解决、需要值班者或用户定的问题 */
    questions?: string[];
    /** 它**声称**产出了、宿主却没找到的文件（口头执行当场点名） */
    unverifiedArtifacts?: string[];
    /** 完整结论存进记忆库后的真 recordId（只有存成功才有；没有就不许在正文里给指针） */
    fullRecordId?: string;
    /** 结构化程度：提交工具（最可靠）/ 正文 JSON 块 / 纯正文兜底 */
    laiYuan?: 'jiao_fu' | 'json' | 'zheng_wen';
}

/* ───────────────────────── 8. 状态差分（检查点） ───────────────────────── */

/**
 * 检查点 = 会话日志截断点 + 文件状态快照（v1.1 = `app-shell/src/checkpoint.ts` 的真实形状）。
 * v1.0 写的 `checkpointId / fileStateRef{strategy:'cow'|'shadow-git', ref}` 没有实现：
 * 实现用 reflink 拷贝（cow）失败就普通拷贝（shadow），不是 shadow-git。
 */
export interface JianchadianZengliang {
    id: string;
    /** 轮起 / 轮末 */
    phase: 'round_start' | 'round_end';
    /** 对话状态：日志 seq 截断点（回退时会话日志回到这里） */
    logSeq: number;
    /** 文件状态：reflink 优先（cow），失败退回普通拷贝（shadow） */
    strategy: 'cow' | 'shadow';
    /** 文件快照所在目录 */
    dir: string;
    /** 会话级回滚用：属于哪个会话（老数据没有） */
    sessionId?: string;
}

/* ───────────────────────── 9. 缓存三层顺序 ───────────────────────── */

/**
 * 注入上下文的渲染顺序（铁律：视图有界，与日志总长度解耦）
 * 1. in-history 系统提示（**冻结**，不随轮次变 ⇒ 不破坏 KV Cache）
 * 2. 只追加历史（经 CCR 压缩后的有界视图）
 * 3. 状态卡片（≤ 2000 token，**放最后**：它每轮都变，放进系统提示会让整段缓存失效）
 */
export interface ShangxiawenXuanranCeng {
    inHistorySystemPrompt: string;
    appendedHistoryView: string;
    statusCard: string;
    /** 总注入预算 */
    totalBudgetTokens: number;
}

/* ───────────────────────── 10. EvidenceAnchor ───────────────────────── */

export interface ZhengjuMaodian {
    /**
     * JSONL 存储名（相对**记忆数据目录**，例 `fast-memory.jsonl`；会话日志锚点用 `chat-log`）。
     * v1.0 写的"相对 userData"与实现不符（记忆数据目录可由 WARMY_MEMORY_DIR 改到别处）。
     */
    file: string;
    /** 记录 seq */
    seq: number;
    /** 记录 id（只许是日志里真实存在的 id；拿不到就留空串，解引用侧回落 seq） */
    recordId: string;
    /** 可选：字节偏移，加速 seek */
    byteOffset?: number;
}

/* ───────────────────────── 11. BoardAction（看板） ───────────────────────── */

/** 看板指令种类 */
export type KanbanLingLei = 'create_task' | 'update_progress' | 'complete_task' | 'add_note' | 'block';
/**
 * 一条看板指令（值班者从自然语言解析出来的）。v1.1 = `board` 包与 `board.jsonl` 存量数据的真实形状：
 * 平铺字段、任务以标题为键；v1.0 写的 `{type, id, title, …}` 判别联合从来没有实现，存量数据也不兼容。
 */
export interface KanbanLing {
    action: KanbanLingLei;
    biaoTi: string;
    jinDu?: number;
    note?: string;
    /** 父任务（= 父任务标题），轻量任务树 */
    parentId?: string;
}
/** 看板事件（只追加进 board.jsonl） */
export interface KanbanShi extends KanbanLing {
    seq: number;
    ts: number;
    groupId: string;
    /** 解析来源：值班者从自然语言解析 */
    parsedFrom: string;
}

/* ───────────────────────── 12. GroupConfig ───────────────────────── */

export type QunLei = 'internal' | 'external' | 'direct';
export type QunJuese = 'creator' | 'admin' | 'member' | 'external_member';
export type QuanxianMiyao = 'dissolve_group' | 'modify_settings' | 'appoint_admin' | 'invite_members' | 'approve_join' | 'approve_tool' | 'manage_allowlist' | 'view_knowledge' | 'talk_to_duty' | 'view_board';
/** 权限矩阵：角色 × 权限项 → boolean 或 'readonly' */
export type QuanxianJuzhen = Record<QunJuese, Record<QuanxianMiyao, boolean | 'readonly'>>;
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

/* ───────────────────────── 13. 任务黑板（ADR000 P5 · SharedContext） ───────────────────────── */

/**
 * 条目种类：事实 / 决定 / 产物 / 未决问题 / 回答（回答某条问题）。
 * **只追加**：改口不改旧条目，而是新写一条并用 `tiDai` 声明它替代哪条（LangGraph reducer 式的追加合并）。
 */
export type HeiBanLei = 'fact' | 'decision' | 'artifact' | 'question' | 'answer';
/** 条目来源（**宿主盖章**，执行者自己报的身份一律不认 —— MetaGPT 的 sent_from 自填就是反面例子） */
export interface HeiBanLaiYuan {
    id: string;
    ming: string;
    jueSe: 'executor' | 'duty' | 'host';
}
export interface HeiBanTiao {
    /** = 记忆库 recordId（宿主生成 `hb-<任务>-<序号>`；只有 yiLuoPan=true 时才是能 retrieve 的真 id） */
    id: string;
    renWuId: string;
    groupId: string;
    lei: HeiBanLei;
    nei: string;
    /** decision 必填：冲突检测按主题 */
    zhuTi?: string;
    /** artifact 必填：产物路径 */
    luJing?: string;
    /** answer 必填：回答的是哪条 question 的 id */
    guanLian?: string;
    /** 替代哪条（改口 = 新写一条并声明替代，旧条目不动） */
    tiDai?: string;
    laiYuan: HeiBanLaiYuan;
    ts: number;
    /** 记忆库写成功才为 true（没落盘的条目不给 retrieve 指针，宁缺不假） */
    yiLuoPan: boolean;
}
