/**
 * 群列表 / 群成员的真实持久化（userData/groups.json）
 *
 * 背景：原实现里 `ccarmy:group-list` 只返回 `{ ok:true }`（没有列表），
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
   *  - 有了它，`ccarmy:identity-changes` 才能把"某个指纹换了证"精确定位到
   *    具体是哪个群（`scopes`），`ccarmy:net-members-presence` 才能用**活连接**
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
