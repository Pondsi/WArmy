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
}

export interface GroupMemberRecord {
  id: string;
  name: string;
  role: GroupMemberRole;
  joinedAt: number;
  source: GroupMemberSource;
  /** 本机牛马实例 ID（source=instance 时有值） */
  instanceId?: string;
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
    out.groups.push({
      groupId,
      name: asString(rec.name) || groupId,
      type: normalizeType(rec.type),
      directedMode: rec.directedMode === true,
      dutyInstanceId: asString(rec.dutyInstanceId) || null,
      createdAt: asNumber(rec.createdAt) || Date.now(),
      updatedAt: asNumber(rec.updatedAt) || asNumber(rec.createdAt) || Date.now(),
      origin: rec.origin === 'migrated' ? 'migrated' : 'ipc',
    });
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
   */
  addMember(
    groupId: string,
    input: { name: string; role?: GroupMemberRole; source?: GroupMemberSource; instanceId?: string; id?: string }
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
    list.push(row);
    const w = this.persist(state);
    if (!w.ok) return { ok: false, groupId, members: list.slice(0, -1), error: w.error };
    return { ok: true, groupId, members: list.slice() };
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
