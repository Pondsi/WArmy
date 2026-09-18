/**
 * 群列表 / 群成员的真实持久化（userData/groups.json）
 *
 * 背景：原实现里 `warmy:group-list` 只返回 `{ ok:true }`（没有列表），
 * `groupMembers` 是一个进程内 Map，重启即丢。这里把两者落到磁盘：
 *
 *   { version: 1, groups: [...], members: { [groupId]: [...] } }
 *
 * - 写入用 atomic-json 的原子替换，读失败 / 文件损坏都有兜底（损坏文件会被隔离）
 * - 单群成员上限与旧实现一致：50
 * - 只做本地存储，不引入任何 electron 依赖，便于脱离主进程直接跑验证脚本
 */
import { readJsonFileQuarantine, writeJsonAtomicSafe } from './atomic-json.js';

/** 与旧实现保持一致的成员上限 */
export const GROUP_MEMBER_LIMIT = 50;

export type GroupType = 'internal' | 'external';
export type GroupMemberRole = 'creator' | 'admin' | 'member';
export type GroupMemberSource = 'instance' | 'invite' | 'migrated';

export interface GroupRecord {
  groupId: string;
  name: string;
  type: GroupType;
  directedMode: boolean;
  /** 固定值班实例（可为空） */
  dutyInstanceId: string | null;
  createdAt: number;
  updatedAt: number;
  /** ipc=由群创建接口写入；migrated=启动时从旧会话状态回填 */
  origin: 'ipc' | 'migrated';
  /**
   * 建群者（= 本机身份）的指纹；**拿不到就留空**（例如从旧会话状态回填的群）。
   * 用途：校验成员证书的签发者必须是本群创建者 —— 本机建的群这一步是确定的，
   * 迁移来的旧群没有这个信息，宁可留空让上层退回"首次收到的签发者即群主"，
   * 也不要编一个出来。
   */
  creatorFingerprint?: string;
  /**
   * ADR 004（本轮定稿）：**项目级属性** —— 这一层才是"项目是什么"的载体。
   *
   * 产品主的原话（必须照做）：**「记录文件的改动应该是无限牛马的功能，不是本机的功能」**。
   * 也就是说：开发环境选择（本机 / 容器）、选定的运行时、创建者的启用/停用、
   * 项目目录、以及**工具文件读写台账**，全都是**项目属性**，要**随项目同步给成员**，
   * 而不是停在 `settings.json` 里当"本机设置"（那样异地成员永远看不到这是一条
   * 容器开发项目、也看不到它被创建者停用了）。
   *
   * 旧记录没有这一层 ⇒ 读进来就是 `undefined`（**不猜、不伪造、不改写旧文件**），
   * 上层会自动回退到兼容路径（本机设置里的旧映射），见 GroupStore.projectOf 的注释。
   */
  project?: GroupProjectRecord;
}

/* ── ADR 004：项目级属性（**随项目走**，不是本机设置） ─────────────────────── */

/** 开发环境（项目创建时必选；旧数据缺项一律按 host，不猜） */
export type ProjectDevEnv = 'host' | 'container';

/**
 * 创建者节点上报的**可用性**（= 那边现在到底能不能开发）。
 * 这是**每次现场探测得到的本机事实**，所以它随时间变、只作为"信号"同步，
 * 而不是写死进项目属性里。
 */
export type ProjectAvailability = 'available' | 'stopped' | 'not-ready' | 'not-installed' | 'not-chosen' | 'unknown';

/** 工具文件访问操作类型（"记录文件的改动"是产品功能 ⇒ 操作类型必须机器可读） */
export type ProjectFileAccessOp = 'read' | 'write' | 'edit' | 'create' | 'delete' | 'backup' | 'restore';

/**
 * 工具文件访问台账的一条（**只记路径 + 操作 + 时间 + 结果**，
 * ⚠️ **绝不记文件内容**：台账要同步给成员，写进内容就是泄露）。
 */
export interface ProjectFileAccessEntry {
  op: ProjectFileAccessOp;
  /** 绝对路径（由记录方保证；解析根在 UI/主进程侧） */
  path: string;
  ts: number;
  ok: boolean;
  /** 谁动的手：helper-tool（提权写入那套）/ container（容器内的命令）/ product（产品自身） */
  by: string;
  bytes?: number;
}

/** 台账条数上限（项目级，随项目同步 ⇒ 必须有界，超出丢最旧的） */
export const PROJECT_LEDGER_LIMIT = 200;

export interface GroupProjectRecord {
  /** 开发环境：创建项目时必选 */
  devEnv: ProjectDevEnv;
  /** 容器开发项目选定的运行时 id（没选 = 空串） */
  runtimeId: string;
  /** 创建者**停用**这个项目的时间戳；0 = 启用中 */
  disabledAt: number;
  /** 项目目录（**产品级事实**：成员据此解析"最近改动文件"的根，不再只有本机知道） */
  directory?: string;
  /** 目录是怎么定下来的（不编：creator-picked = 创建者选的；checkpoint-workspace = 回退点里记的） */
  directorySource?: 'creator-picked' | 'checkpoint-workspace';
  /** 创建者节点最近一次上报的可用性（本机事实） */
  availability: ProjectAvailability;
  /** 与可用性配套的**机器可读原因码**（ok / container-not-ready / disabled-by-owner / …） */
  availabilityCode: string;
  availabilityAt: number;
  /** 上报者身份指纹（拿不到就不写） */
  reportedBy?: string;
  /** 环境记录：记住这个项目用哪个容器 / 上次固化在哪一层（没真发生过就不写） */
  env?: { containerRef?: string; imageRef?: string; solidifiedAt?: number };
  /** 工具文件访问台账（**项目级、成员可见**；有界，只留最近 PROJECT_LEDGER_LIMIT 条） */
  ledger: ProjectFileAccessEntry[];
}

/** 台账操作类型的合法集合（解析外来数据时用；不认识的**丢弃**，不是当成 write） */
const FILE_ACCESS_OPS: readonly ProjectFileAccessOp[] = ['read', 'write', 'edit', 'create', 'delete', 'backup', 'restore'];

export function isFileAccessOp(v: unknown): v is ProjectFileAccessOp {
  return typeof v === 'string' && (FILE_ACCESS_OPS as readonly string[]).includes(v);
}

/** 空的项目属性（devEnv 按 host —— 与"旧项目一律按本机"一致，绝不乐观放开容器） */
export function emptyProjectRecord(): GroupProjectRecord {
  return {
    devEnv: 'host',
    runtimeId: '',
    disabledAt: 0,
    availability: 'unknown',
    availabilityCode: '',
    availabilityAt: 0,
    ledger: [],
  };
}

export interface GroupMemberRecord {
  id: string;
  name: string;
  role: GroupMemberRole;
  joinedAt: number;
  source: GroupMemberSource;
  /** 本机牛马实例 ID（source=instance 时有值） */
  instanceId?: string;
  /**
   * 该成员的身份公钥指纹（身份层线上表示）。
   *
   * **可选，缺失 = 未知**（旧记录、拿不到名片的邀请、本机实例成员都是这样）：
   *  - 旧格式（本字段出现之前落盘的 groups.json）读进来就是 `undefined`，
   *    **不猜、不伪造、不改写文件**；下次因别的原因写盘时也依旧是 `undefined`；
   *  - 有了它，`warmy:identity-changes` 才能把"某个指纹换了证"精确定位到
   *    具体是哪个群（`scopes`），`warmy:net-members-presence` 才能用**活连接**
   *    判定异地成员在不在线（而不是只知道"他是异地"）。
   */
  fingerprint?: string;
}

export interface GroupStoreState {
  version: 1;
  groups: GroupRecord[];
  members: Record<string, GroupMemberRecord[]>;
  /** 旧版会话状态（settings.json 的 state.groups）是否已回填过；只回填一次，避免解散后又被加回来 */
  uiStateMigrated?: boolean;
}

/** IPC 返回形状（显式写出来，配合 safeHandle<T> 的兜底值保持类型一致） */
export interface GroupListResult {
  ok: boolean;
  groups: Array<GroupRecord & { memberCount: number; active: boolean }>;
  count: number;
  error?: string;
}

export interface GroupMembersResult {
  ok: boolean;
  groupId?: string;
  members: GroupMemberRecord[];
  error?: string;
}

const EMPTY: GroupStoreState = { version: 1, groups: [], members: {} };

function emptyState(): GroupStoreState {
  return { version: 1, groups: [], members: {} };
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function asNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function normalizeRole(v: unknown): GroupMemberRole {
  return v === 'creator' || v === 'admin' ? v : 'member';
}

function normalizeSource(v: unknown): GroupMemberSource {
  return v === 'instance' || v === 'migrated' ? v : 'invite';
}

function normalizeType(v: unknown): GroupType {
  return v === 'external' ? 'external' : 'internal';
}

/**
 * 指纹文本比较（忽略大小写 / 短横分组 / 常见形近字）。
 * 与 `identity.normalizeFingerprint` 同一套规则，但这里**刻意不 import identity.js**：
 * group-store 要能被验证脚本脱离身份层单独加载。两边规则若改动需要同步 —— 见
 * `packages/app-shell/scripts/verify-membership.mjs` 里对两者的对照断言。
 */
export function sameFingerprintText(a: string, b: string): boolean {
  const norm = (s: string): string =>
    String(s || '')
      .toUpperCase()
      .replace(/[^0-9A-Z]/g, '')
      .replace(/[IL]/g, '1')
      .replace(/O/g, '0');
  const na = norm(a);
  return na.length > 0 && na === norm(b);
}

/** 把磁盘上的（可能被手改坏的）数据收敛成合法结构 */
function normalize(raw: unknown): GroupStoreState {
  if (!raw || typeof raw !== 'object') return emptyState();
  const src = raw as Partial<GroupStoreState>;
  const out = emptyState();
  if (src.uiStateMigrated === true) out.uiStateMigrated = true;
  const seen = new Set<string>();
  for (const g of Array.isArray(src.groups) ? src.groups : []) {
    if (!g || typeof g !== 'object') continue;
    const rec = g as Partial<GroupRecord>;
    const groupId = asString(rec.groupId);
    if (!groupId || seen.has(groupId)) continue;
    seen.add(groupId);
    const row: GroupRecord = {
      groupId,
      name: asString(rec.name) || groupId,
      type: normalizeType(rec.type),
      directedMode: rec.directedMode === true,
      dutyInstanceId: asString(rec.dutyInstanceId) || null,
      createdAt: asNumber(rec.createdAt) || Date.now(),
      updatedAt: asNumber(rec.updatedAt) || asNumber(rec.createdAt) || Date.now(),
      origin: rec.origin === 'migrated' ? 'migrated' : 'ipc',
    };
    // 旧记录没有 creatorFingerprint → 保持缺失（不编造）
    const creatorFp = asString(rec.creatorFingerprint);
    if (creatorFp) row.creatorFingerprint = creatorFp;
    // 旧记录没有项目属性 → 保持缺失（上层回退到本机设置的兼容路径，见 projectOf）
    const proj = normalizeProject(rec.project);
    if (proj) row.project = proj;
    out.groups.push(row);
  }
  const membersSrc = src.members && typeof src.members === 'object' ? src.members : {};
  for (const key of Object.keys(membersSrc)) {
    const list = (membersSrc as Record<string, unknown>)[key];
    if (!Array.isArray(list)) continue;
    const out2: GroupMemberRecord[] = [];
    const ids = new Set<string>();
    for (const m of list) {
      if (!m || typeof m !== 'object') continue;
      const rec = m as Partial<GroupMemberRecord>;
      const id = asString(rec.id);
      if (!id || ids.has(id)) continue;
      ids.add(id);
      const row: GroupMemberRecord = {
        id,
        name: asString(rec.name) || id,
        role: normalizeRole(rec.role),
        joinedAt: asNumber(rec.joinedAt) || Date.now(),
        source: normalizeSource(rec.source),
      };
      const instId = asString(rec.instanceId);
      if (instId) row.instanceId = instId;
      // ⚠️ 旧格式（没有 fingerprint 字段）读进来必须是 undefined：
      // 不猜、不用 id/name 凑、也不因为"看起来像指纹"就填上。
      const fp = asString(rec.fingerprint);
      if (fp) row.fingerprint = fp;
      out2.push(row);
    }
    out.members[key] = out2;
  }
  return out;
}

/** 校验台账里的一条（外来数据：不认识的 op 直接丢，别把"未知"当 write 记下来） */
function normalizeLedgerEntry(raw: unknown): ProjectFileAccessEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Partial<ProjectFileAccessEntry>;
  if (!isFileAccessOp(rec.op)) return null;
  const p = asString(rec.path);
  if (!p) return null;
  const row: ProjectFileAccessEntry = {
    op: rec.op,
    path: p,
    ts: asNumber(rec.ts) || Date.now(),
    ok: rec.ok !== false,
    by: asString(rec.by) || 'unknown',
  };
  const bytes = asNumber(rec.bytes);
  if (bytes > 0) row.bytes = bytes;
  return row;
}

/** 把（可能来自磁盘或网络对端的）项目属性收敛成合法结构；什么都没有则返回 undefined */
export function normalizeProject(raw: unknown): GroupProjectRecord | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const rec = raw as Partial<GroupProjectRecord>;
  const row = emptyProjectRecord();
  row.devEnv = rec.devEnv === 'container' ? 'container' : 'host';
  row.runtimeId = asString(rec.runtimeId);
  row.disabledAt = Math.max(0, asNumber(rec.disabledAt));
  const dir = asString(rec.directory);
  if (dir) {
    row.directory = dir;
    const src = asString(rec.directorySource);
    row.directorySource = src === 'creator-picked' ? 'creator-picked' : 'checkpoint-workspace';
  }
  const avail = asString(rec.availability);
  row.availability = (['available', 'stopped', 'not-ready', 'not-installed', 'not-chosen'] as const).includes(avail as never)
    ? (avail as ProjectAvailability)
    : 'unknown';
  row.availabilityCode = asString(rec.availabilityCode);
  row.availabilityAt = asNumber(rec.availabilityAt);
  const by = asString(rec.reportedBy);
  if (by) row.reportedBy = by;
  if (rec.env && typeof rec.env === 'object') {
    const e = rec.env as { containerRef?: unknown; imageRef?: unknown; solidifiedAt?: unknown };
    const env: NonNullable<GroupProjectRecord['env']> = {};
    if (asString(e.containerRef)) env.containerRef = asString(e.containerRef);
    if (asString(e.imageRef)) env.imageRef = asString(e.imageRef);
    if (asNumber(e.solidifiedAt) > 0) env.solidifiedAt = asNumber(e.solidifiedAt);
    if (Object.keys(env).length) row.env = env;
  }
  const list = Array.isArray(rec.ledger) ? rec.ledger : [];
  for (const item of list) {
    const e = normalizeLedgerEntry(item);
    if (e) row.ledger.push(e);
  }
  if (row.ledger.length > PROJECT_LEDGER_LIMIT) row.ledger = row.ledger.slice(-PROJECT_LEDGER_LIMIT);
  return row;
}

export class GroupStore {
  /** 最近一次落盘失败的粗粒度原因（不含路径/堆栈） */
  lastWriteError: string | null = null;

  constructor(private file: string) {}

  /** 一次读盘拿到完整快照（group-list 需要「组 + 成员数」，避免 N 次读文件） */
  snapshot(): GroupStoreState {
    return normalize(readJsonFileQuarantine<unknown>(this.file, EMPTY));
  }

  listGroups(): GroupRecord[] {
    return this.snapshot().groups.slice().sort((a, b) => a.createdAt - b.createdAt);
  }

  getGroup(groupId: string): GroupRecord | undefined {
    return this.snapshot().groups.find((g) => g.groupId === groupId);
  }

  /**
   * ADR 004：**项目级属性**的读取入口。
   * 返回 `undefined` = 这条项目记录里**没有**项目属性（旧记录 / 不是项目）。
   * ⚠️ 调用方必须**原样回退到本机旧设置**（兼容路径），**不要**在这里替它猜一个：
   * "没有项目属性"与"项目属性说它是本机项目"是两件事。
   */
  projectOf(groupId: string): GroupProjectRecord | undefined {
    const g = this.getGroup(String(groupId || ''));
    return g && g.project ? g.project : undefined;
  }

  /**
   * 写入 / 合并项目属性（**只写传进来的字段**；没传的一律保持原样）。
   *
   * 这是"记录文件的改动是产品功能、不是本机功能"那条要求的落点：
   * 开发环境 / 运行时 / 停用时间 / 项目目录 / 台账都记在**项目记录**里，
   * 由上层同步给成员 —— 而不是停在 settings.json。
   */
  setProjectAttrs(
    groupId: string,
    patch: Partial<Omit<GroupProjectRecord, 'ledger'>> & { ledger?: ProjectFileAccessEntry[] }
  ): { ok: boolean; project?: GroupProjectRecord; error?: string } {
    const gid = asString(groupId);
    if (!gid) return { ok: false, error: 'groupId required' };
    const state = this.snapshot();
    const g = state.groups.find((x) => x.groupId === gid);
    // 群记录不存在时不偷偷建一条（群名/类型都不知道，编出来比没有更糟）
    if (!g) return { ok: false, error: 'group not found' };
    const cur = g.project || emptyProjectRecord();
    const next: GroupProjectRecord = { ...cur, ledger: (cur.ledger || []).slice() };
    if (patch.devEnv === 'container' || patch.devEnv === 'host') next.devEnv = patch.devEnv;
    if (typeof patch.runtimeId === 'string') next.runtimeId = patch.runtimeId;
    if (typeof patch.disabledAt === 'number' && Number.isFinite(patch.disabledAt)) next.disabledAt = Math.max(0, patch.disabledAt);
    if (typeof patch.directory === 'string' && patch.directory) {
      next.directory = patch.directory;
      next.directorySource = patch.directorySource === 'checkpoint-workspace' ? 'checkpoint-workspace' : 'creator-picked';
    }
    if (patch.availability) next.availability = patch.availability;
    if (typeof patch.availabilityCode === 'string') next.availabilityCode = patch.availabilityCode;
    if (typeof patch.availabilityAt === 'number') next.availabilityAt = patch.availabilityAt;
    if (typeof patch.reportedBy === 'string' && patch.reportedBy) next.reportedBy = patch.reportedBy;
    if (patch.env && typeof patch.env === 'object') {
      next.env = { ...(next.env || {}), ...patch.env };
    }
    if (Array.isArray(patch.ledger)) next.ledger = patch.ledger.slice(-PROJECT_LEDGER_LIMIT);
    g.project = next;
    g.updatedAt = Date.now();
    const w = this.persist(state);
    if (!w.ok) return { ok: false, error: w.error };
    return { ok: true, project: next };
  }

  /**
   * 记一条工具文件访问（**项目级台账**）。同一个路径 + 同一个操作**不重复堆**：
   * 只把时间/结果/字节数刷新到最新（否则一次循环里反复读同一个文件就会把台账塞满）。
   */
  recordFileAccess(
    groupId: string,
    entry: ProjectFileAccessEntry
  ): { ok: boolean; entry?: ProjectFileAccessEntry; error?: string } {
    const gid = asString(groupId);
    if (!gid) return { ok: false, error: 'groupId required' };
    const e = normalizeLedgerEntry(entry);
    if (!e) return { ok: false, error: 'bad entry' };
    const state = this.snapshot();
    const g = state.groups.find((x) => x.groupId === gid);
    if (!g) return { ok: false, error: 'group not found' };
    const proj = g.project || emptyProjectRecord();
    const list = (proj.ledger || []).filter((x) => !(x.path === e.path && x.op === e.op));
    list.push(e);
    proj.ledger = list.length > PROJECT_LEDGER_LIMIT ? list.slice(-PROJECT_LEDGER_LIMIT) : list;
    g.project = proj;
    g.updatedAt = Date.now();
    const w = this.persist(state);
    if (!w.ok) return { ok: false, error: w.error };
    return { ok: true, entry: e };
  }

  /** 台账读取（按时间倒序；`limit` 有上限，避免一次把大台账全推给渲染层） */
  listFileAccess(groupId: string, limit = PROJECT_LEDGER_LIMIT): ProjectFileAccessEntry[] {
    const proj = this.projectOf(groupId);
    const list = (proj && proj.ledger) || [];
    const n = Math.max(1, Math.min(Math.floor(limit) || PROJECT_LEDGER_LIMIT, PROJECT_LEDGER_LIMIT));
    return list.slice().sort((a, b) => b.ts - a.ts).slice(0, n);
  }

  /**
   * 成员侧：应用**创建者节点同步过来的**项目属性 —— 只写"项目是什么"这一类，
   * **不覆盖**本地已记录的目录（除非对端带了目录而我们本来不知道）。
   * 语义与 setProjectAttrs 一致：不猜、不伪造；没有的字段保持原样。
   */
  applyProjectSync(
    groupId: string,
    payload: {
      name?: string;
      type?: GroupType;
      project: Partial<Omit<GroupProjectRecord, 'ledger'>>;
      /** 对端（创建者）的指纹：只在本地还不知道创建者时补上 */
      creatorFingerprint?: string;
    }
  ): { ok: boolean; group?: GroupRecord; error?: string } {
    const gid = asString(groupId);
    if (!gid) return { ok: false, error: 'groupId required' };
    // 先确保有这条群记录（成员第一次收到同步时本地可能还没有）
    const existing = this.getGroup(gid);
    if (!existing) {
      const created = this.upsertGroup({
        groupId: gid,
        name: asString(payload.name) || gid,
        type: payload.type === 'external' ? 'external' : 'internal',
        ...(asString(payload.creatorFingerprint) ? { creatorFingerprint: asString(payload.creatorFingerprint) } : {}),
      });
      if (!created.ok) return { ok: false, error: created.error };
    } else if (asString(payload.creatorFingerprint) && !existing.creatorFingerprint) {
      // 只在本地不知道时补；已知创建者绝不被对端覆盖（避免"谁都能自称群主"）
      this.upsertGroup({
        groupId: gid,
        name: existing.name,
        type: existing.type,
        creatorFingerprint: asString(payload.creatorFingerprint),
      });
    }
    const r = this.setProjectAttrs(gid, payload.project);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, group: this.getGroup(gid) };
  }

  memberCount(groupId: string): number {
    return (this.snapshot().members[groupId] || []).length;
  }

  /** 建群 / 更新群信息：已存在则保留 createdAt 与成员列表 */
  upsertGroup(input: {
    groupId: string;
    name: string;
    type: GroupType;
    directedMode?: boolean;
    origin?: 'ipc' | 'migrated';
    /** 建群者（本机身份）指纹；不确定就**不要传**（留空 = 未知） */
    creatorFingerprint?: string;
  }): { ok: boolean; group?: GroupRecord; error?: string } {
    const groupId = asString(input.groupId);
    if (!groupId) return { ok: false, error: 'groupId required' };
    const state = this.snapshot();
    const now = Date.now();
    const existing = state.groups.find((g) => g.groupId === groupId);
    let group: GroupRecord;
    if (existing) {
      existing.name = asString(input.name) || existing.name;
      existing.type = normalizeType(input.type);
      if (typeof input.directedMode === 'boolean') existing.directedMode = input.directedMode;
      // 只在"本来不知道"时补写，绝不覆盖已知的创建者
      const creatorFp = asString(input.creatorFingerprint);
      if (creatorFp && !existing.creatorFingerprint) existing.creatorFingerprint = creatorFp;
      existing.updatedAt = now;
      group = existing;
    } else {
      group = {
        groupId,
        name: asString(input.name) || groupId,
        type: normalizeType(input.type),
        directedMode: input.directedMode === true,
        dutyInstanceId: null,
        createdAt: now,
        updatedAt: now,
        origin: input.origin === 'migrated' ? 'migrated' : 'ipc',
      };
      const creatorFp = asString(input.creatorFingerprint);
      if (creatorFp) group.creatorFingerprint = creatorFp;
      state.groups.push(group);
    }
    if (!state.members[groupId]) state.members[groupId] = [];
    const w = this.persist(state);
    if (!w.ok) return { ok: false, error: w.error };
    return { ok: true, group };
  }

  /** 解散群：群记录与成员一起删除 */
  removeGroup(groupId: string): { ok: boolean; removed: boolean; error?: string } {
    const state = this.snapshot();
    const idx = state.groups.findIndex((g) => g.groupId === groupId);
    if (idx < 0) return { ok: true, removed: false };
    state.groups.splice(idx, 1);
    delete state.members[groupId];
    const w = this.persist(state);
    if (!w.ok) return { ok: false, removed: false, error: w.error };
    return { ok: true, removed: true };
  }

  listMembers(groupId: string): GroupMemberRecord[] {
    return (this.snapshot().members[groupId] || []).slice().sort((a, b) => a.joinedAt - b.joinedAt);
  }

  /**
   * 加成员。幂等：同 instanceId（或同名）已存在则原样返回，不重复写盘。
   * 上限 50，与旧实现一致。
   * `fingerprint` 可选：**给了就写，没给就留空**（绝不猜）。
   */
  addMember(
    groupId: string,
    input: {
      name: string;
      role?: GroupMemberRole;
      source?: GroupMemberSource;
      instanceId?: string;
      id?: string;
      fingerprint?: string;
    }
  ): GroupMembersResult {
    const name = asString(input.name).trim();
    if (!name) return { ok: false, groupId, members: [], error: 'name required' };
    const state = this.snapshot();
    const list = state.members[groupId] || [];
    if (!state.members[groupId]) state.members[groupId] = list;
    const instId = asString(input.instanceId);
    const dup = list.find((m) => (instId ? m.instanceId === instId : m.name === name));
    if (dup) return { ok: true, groupId, members: list.slice() };
    if (list.length >= GROUP_MEMBER_LIMIT) {
      return { ok: false, groupId, members: list.slice(), error: `max ${GROUP_MEMBER_LIMIT}` };
    }
    const row: GroupMemberRecord = {
      id: asString(input.id) || (instId ? `inst:${instId}` : `m-${Date.now().toString(36)}-${list.length}`),
      name,
      role: normalizeRole(input.role),
      joinedAt: Date.now(),
      source: normalizeSource(input.source),
    };
    if (instId) row.instanceId = instId;
    const fp = asString(input.fingerprint);
    if (fp) row.fingerprint = fp;
    list.push(row);
    const w = this.persist(state);
    if (!w.ok) return { ok: false, groupId, members: list.slice(0, -1), error: w.error };
    return { ok: true, groupId, members: list.slice() };
  }

  /**
   * 三条加入路径的指纹写入策略（**统一走这里**，免得各调用点各写一套）：
   *
   * | source | 指纹策略 | 拿不到时 |
   * | :-- | :-- | :-- |
   * | `invite` | 有就用（邀请方应带上对方身份名片里的指纹） | 留空 + 审计一条（`group.member.fingerprint.missing`） |
   * | `instance` | **一律不用**：本机牛马实例不是远端身份，套上本机指纹等于伪造归属 | 留空（原因已明确，不记 missing 审计） |
   * | `migrated` | 旧格式回填，指纹不可知 | 留空 + 审计一条 |
   *
   * 已知成员（同名/同 instanceId）再次调用时只补指纹、不重复加人 ——
   * 这样"先入群后拿到名片"这条真实顺序也能把指纹补上。
   */
  addMemberWithFingerprint(
    groupId: string,
    input: {
      name: string;
      role?: GroupMemberRole;
      source?: GroupMemberSource;
      instanceId?: string;
      id?: string;
      fingerprint?: string;
    },
    hooks: { onAudit?: (op: string, detail?: unknown) => void } = {}
  ): GroupMembersResult {
    const source = normalizeSource(input.source);
    const rawFp = asString(input.fingerprint).trim();
    // 本机实例成员永不携带指纹（它不是"某个远端身份"）
    const fingerprint = source === 'instance' ? '' : rawFp;
    // ⚠️ 必须把入参里的 fingerprint 拆掉再往下传：否则 `{...input}` 会把原值带进去，
    // "instance 一律不写指纹"这条策略会被 input 覆盖掉（实测踩过）。
    const { fingerprint: _dropFingerprint, ...rest } = input;
    void _dropFingerprint;
    const res = this.addMember(groupId, { ...rest, source, ...(fingerprint ? { fingerprint } : {}) });
    if (!res.ok) return res;
    const name = asString(input.name).trim();
    if (fingerprint) {
      const before = this.listMembers(groupId).find((m) => m.name === name);
      // 已存在但当时没指纹：这次补上（幂等；已有同一个就什么都不做）
      if (before && before.fingerprint !== fingerprint) {
        this.setMemberFingerprint(groupId, before.id, fingerprint);
        hooks.onAudit?.('group.member.fingerprint', { groupId, source, bound: 'patched' });
      } else {
        hooks.onAudit?.('group.member.fingerprint', { groupId, source, bound: 'already-present' });
      }
      return this.listMembersResult(groupId);
    }
    if (source !== 'instance') {
      hooks.onAudit?.('group.member.fingerprint.missing', {
        groupId,
        source,
        reason: source === 'migrated' ? 'legacy-record' : 'no-identity-card',
      });
    }
    return this.listMembersResult(groupId);
  }

  private listMembersResult(groupId: string): GroupMembersResult {
    return { ok: true, groupId, members: this.listMembers(groupId) };
  }

  /**
   * 给已有成员补/换指纹（幂等；`memberId` 为空时按 name 找）。
   * 传空指纹 = 不改（**没有"清空指纹"这条路径**：指纹一旦绑定就是审计事实，
   * 要"解绑"应该走换证/吊销，而不是抹掉记录）。
   */
  setMemberFingerprint(groupId: string, memberId: string, fingerprint: string): { ok: boolean; changed: boolean; members: GroupMemberRecord[]; error?: string } {
    const fp = asString(fingerprint).trim();
    if (!fp) return { ok: false, changed: false, members: [], error: 'fingerprint required' };
    const state = this.snapshot();
    const list = state.members[groupId] || [];
    const target = memberId ? list.find((m) => m.id === memberId) : undefined;
    if (!target) return { ok: false, changed: false, members: list.slice(), error: 'member not found' };
    if (target.fingerprint === fp) return { ok: true, changed: false, members: list.slice() };
    target.fingerprint = fp;
    const w = this.persist(state);
    if (!w.ok) return { ok: false, changed: false, members: list.slice(), error: w.error };
    return { ok: true, changed: true, members: list.slice() };
  }

  /** 哪些群里出现过这个指纹（T179：把"某个指纹换了证"定位到具体群） */
  groupsWithFingerprint(fingerprint: string): Array<{ groupId: string; memberId: string; name: string }> {
    const fp = asString(fingerprint).trim();
    if (!fp) return [];
    const out: Array<{ groupId: string; memberId: string; name: string }> = [];
    const snap = this.snapshot();
    for (const [groupId, list] of Object.entries(snap.members)) {
      for (const m of list) {
        if (m.fingerprint && sameFingerprintText(m.fingerprint, fp)) {
          out.push({ groupId, memberId: m.id, name: m.name });
        }
      }
    }
    return out;
  }

  /** 移除成员；creator 不可被移除（与权限表一致：只有创建者可解散群） */
  removeMember(groupId: string, memberId: string): GroupMembersResult {
    const state = this.snapshot();
    const list = state.members[groupId] || [];
    const target = list.find((m) => m.id === memberId);
    if (!target) return { ok: false, groupId, members: list.slice(), error: 'member not found' };
    if (target.role === 'creator') return { ok: false, groupId, members: list.slice(), error: 'creator cannot be removed' };
    const next = list.filter((m) => m.id !== memberId);
    state.members[groupId] = next;
    const w = this.persist(state);
    if (!w.ok) return { ok: false, groupId, members: list.slice(), error: w.error };
    return { ok: true, groupId, members: next.slice() };
  }

  /** 设置 / 取消管理员；创建者角色固定 */
  setAdmin(groupId: string, memberId: string, admin: boolean): GroupMembersResult {
    const state = this.snapshot();
    const list = state.members[groupId] || [];
    const target = list.find((m) => m.id === memberId);
    if (!target) return { ok: false, groupId, members: list.slice(), error: 'member not found' };
    if (target.role === 'creator') return { ok: false, groupId, members: list.slice(), error: 'creator role is fixed' };
    target.role = admin ? 'admin' : 'member';
    const w = this.persist(state);
    if (!w.ok) return { ok: false, groupId, members: list.slice(), error: w.error };
    return { ok: true, groupId, members: list.slice() };
  }

  /** 定向模式（无 @ 不响应）落盘 */
  setDirected(groupId: string, directed: boolean): { ok: boolean; directedMode?: boolean; error?: string } {
    const state = this.snapshot();
    const g = state.groups.find((x) => x.groupId === groupId);
    if (!g) return { ok: false, error: 'group not found' };
    g.directedMode = !!directed;
    g.updatedAt = Date.now();
    const w = this.persist(state);
    if (!w.ok) return { ok: false, error: w.error };
    return { ok: true, directedMode: g.directedMode };
  }

  /** 记录固定值班实例 */
  setDutyInstance(groupId: string, instanceId: string | null): { ok: boolean; error?: string } {
    const state = this.snapshot();
    const g = state.groups.find((x) => x.groupId === groupId);
    if (!g) return { ok: false, error: 'group not found' };
    g.dutyInstanceId = instanceId || null;
    g.updatedAt = Date.now();
    const w = this.persist(state);
    if (!w.ok) return { ok: false, error: w.error };
    return { ok: true };
  }

  /** 一次性回填（旧版本把群列表存在 settings.json 的 state.groups 里）；只做一次 */
  migrateFrom(input: Array<{ id?: unknown; name?: unknown; type?: unknown }>): number {
    const state = this.snapshot();
    if (state.uiStateMigrated) return 0;
    const now = Date.now();
    let added = 0;
    for (const g of input) {
      const groupId = asString(g?.id);
      if (!groupId || state.groups.some((x) => x.groupId === groupId)) continue;
      state.groups.push({
        groupId,
        name: asString(g?.name) || groupId,
        type: normalizeType(g?.type),
        directedMode: false,
        dutyInstanceId: null,
        createdAt: now,
        updatedAt: now,
        origin: 'migrated',
      });
      if (!state.members[groupId]) state.members[groupId] = [];
      added++;
    }
    // 无论有没有新增都记下「已回填」，否则解散过的群会在下次启动被再加回来
    state.uiStateMigrated = true;
    this.persist(state);
    return added;
  }

  private persist(state: GroupStoreState): { ok: boolean; error?: string } {
    const r = writeJsonAtomicSafe(this.file, state);
    this.lastWriteError = r.ok ? null : r.error || 'write failed';
    return r;
  }
}
