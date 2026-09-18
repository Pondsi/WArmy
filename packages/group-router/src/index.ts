/**
 * @warmy/group-router — 值班者状态机 + 队列 + 群类型
 *
 * 不变量：
 * - 值班权仅限本机实例
 * - 非定向：序号最小空闲值班者听取
 * - 定向：必须 @，无值班者
 * - 外部群 AI 仅 @ 响应
 * - queue 仅 Router 写入
 */

import type {
  DutyState,
  GroupConfig,
  GroupType,
  OrchestrationDecision,
  OrchestrationRequest,
  Urgency,
} from '@warmy/contracts';

export interface RouterInstance {
  id: string;
  name: string;
  /** 进群序号（小号优先值班） */
  order: number;
  /** 仅本机实例可为 true */
  local: boolean;
  dutyEligible: boolean;
  status: 'idle' | 'busy' | 'dead' | 'offline';
  /** 固定值班者（可选） */
  fixedDuty?: boolean;
  /** 纯调度：不参与回复内容生成 */
  pureDispatcher?: boolean;
}

export interface QueueItem {
  id: string;
  groupId: string;
  urgency: Urgency;
  request: OrchestrationRequest;
  enqueuedAt: number;
  /** 可编辑/删除/排序 */
  status: 'queued' | 'dispatched' | 'cancelled' | 'done';
}

export interface GroupChatRouterOptions {
  /** 固定值班忙时：true=排队，false=顺延 +1 */
  queueWhenFixedBusy?: boolean;
  /** 队列变更后的落盘回调（主进程注入；Router 自己不碰文件系统） */
  onQueueMutated?: (groupId: string) => void;
}

/** 队列/值班态快照（持久化用；只含 Router 自己拥有的状态） */
export interface RouterQueueSnapshot {
  version: 1;
  seq: number;
  queues: Record<string, QueueItem[]>;
  dutyState: Record<string, DutyState>;
}

export class GroupChatRouter {
  private groups = new Map<string, GroupConfig>();
  private members = new Map<string, RouterInstance[]>();
  private queues = new Map<string, QueueItem[]>();
  private dutyState = new Map<string, DutyState>();
  private seq = 0;

  constructor(private opts: GroupChatRouterOptions = {}) {}

  private notifyQueueMutated(groupId: string): void {
    try {
      this.opts.onQueueMutated?.(groupId);
    } catch {
      /* 落盘失败不影响内存态 */
    }
  }

  /** 导出队列 + 值班态（主进程写 userData/router-queues.json） */
  serializeState(): RouterQueueSnapshot {
    const queues: Record<string, QueueItem[]> = {};
    for (const [gid, q] of this.queues) {
      queues[gid] = q.map((x) => ({ ...x, request: { ...x.request } }));
    }
    const dutyState: Record<string, DutyState> = {};
    for (const [gid, s] of this.dutyState) dutyState[gid] = s;
    return { version: 1, seq: this.seq, queues, dutyState };
  }

  /** 从快照恢复（启动时调用；只恢复队列/值班态，不覆盖成员与群配置） */
  restoreState(snap: RouterQueueSnapshot | null | undefined): void {
    if (!snap || snap.version !== 1) return;
    this.seq = Number(snap.seq) || 0;
    this.queues.clear();
    for (const [gid, q] of Object.entries(snap.queues || {})) {
      if (!Array.isArray(q)) continue;
      this.queues.set(
        gid,
        q
          .filter((x) => x && typeof x.id === 'string' && x.request)
          .map((x) => ({
            id: String(x.id),
            groupId: String(x.groupId || gid),
            urgency: (x.urgency as Urgency) || 'P2',
            request: { ...x.request },
            enqueuedAt: Number(x.enqueuedAt) || Date.now(),
            status: (x.status as QueueItem['status']) || 'queued',
          }))
      );
    }
    this.dutyState.clear();
    for (const [gid, s] of Object.entries(snap.dutyState || {})) {
      this.dutyState.set(gid, s as DutyState);
    }
  }

  // ── 群与成员 ──

  createGroup(cfg: GroupConfig): GroupConfig {
    if (this.groups.has(cfg.groupId)) throw new Error('group exists');
    this.groups.set(cfg.groupId, { ...cfg });
    this.members.set(cfg.groupId, []);
    this.queues.set(cfg.groupId, []);
    this.dutyState.set(cfg.groupId, 'idle');
    this.notifyQueueMutated(cfg.groupId);
    return this.groups.get(cfg.groupId)!;
  }

  getGroup(groupId: string): GroupConfig | undefined {
    return this.groups.get(groupId);
  }

  /** 按进群顺序排列；远程 AI 永不可值班 */
  join(groupId: string, inst: Omit<RouterInstance, 'order'>): RouterInstance {
    const list = this.members.get(groupId);
    if (!list) throw new Error('group not found');
    const order = list.length + 1;
    const row: RouterInstance = {
      ...inst,
      order,
      dutyEligible: inst.dutyEligible && inst.local,
      status: inst.status || 'idle',
    };
    list.push(row);
    list.sort((a, b) => a.order - b.order);
    return row;
  }

  leave(groupId: string, instanceId: string): void {
    const list = this.members.get(groupId);
    if (!list) return;
    const i = list.findIndex((m) => m.id === instanceId);
    if (i >= 0) list.splice(i, 1);
  }

  listMembers(groupId: string): RouterInstance[] {
    return [...(this.members.get(groupId) || [])];
  }

  setStatus(groupId: string, instanceId: string, status: RouterInstance['status']): void {
    const m = this.members.get(groupId)?.find((x) => x.id === instanceId);
    if (m) m.status = status;
  }

  setFixedDuty(groupId: string, instanceId: string | null): void {
    const list = this.members.get(groupId) || [];
    for (const m of list) m.fixedDuty = m.id === instanceId;
  }

  // ── 值班者选择（不变量 11：仅本机） ──

  /**
   * 选择值班者：
   * 1. 指定固定值班者：空闲则用；忙则按 queueWhenFixedBusy 排队或顺延
   * 2. 否则：序号最小的空闲、本机、dutyEligible
   * 3. 都忙：返回 null → 调用方应排队或用兜底小模型
   */
  selectDuty(groupId: string): RouterInstance | null {
    const list = this.members.get(groupId) || [];
    const eligible = list.filter((m) => m.local && m.dutyEligible && m.status !== 'dead' && m.status !== 'offline');

    const fixed = eligible.find((m) => m.fixedDuty);
    if (fixed) {
      if (fixed.status === 'idle') return fixed;
      if (this.opts.queueWhenFixedBusy) return null;
      // 顺延 +1
      const next = eligible
        .filter((m) => m.order > fixed.order && m.status === 'idle')
        .sort((a, b) => a.order - b.order)[0];
      return next || eligible.filter((m) => m.status === 'idle').sort((a, b) => a.order - b.order)[0] || null;
    }

    const idle = eligible.filter((m) => m.status === 'idle').sort((a, b) => a.order - b.order);
    return idle[0] || null;
  }

  duty(groupId: string): { state: DutyState; instance: RouterInstance | null } {
    return {
      state: this.dutyState.get(groupId) || 'idle',
      instance: this.selectDuty(groupId),
    };
  }

  // ── 队列（仅 Router 写入） ──

  enqueue(request: OrchestrationRequest): QueueItem {
    const item: QueueItem = {
      id: `q-${++this.seq}-${Date.now().toString(36)}`,
      groupId: request.groupId,
      urgency: request.urgency,
      request,
      enqueuedAt: Date.now(),
      status: 'queued',
    };
    const q = this.queues.get(request.groupId);
    if (!q) throw new Error('group not found');
    q.push(item);
    this.sortQueue(request.groupId);
    this.notifyQueueMutated(request.groupId);
    return item;
  }

  private sortQueue(groupId: string): void {
    const rank: Record<Urgency, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
    const q = this.queues.get(groupId);
    if (!q) return;
    q.sort((a, b) => {
      const u = rank[a.urgency] - rank[b.urgency];
      if (u !== 0) return u;
      return a.enqueuedAt - b.enqueuedAt;
    });
  }

  listQueue(groupId: string): QueueItem[] {
    return [...(this.queues.get(groupId) || [])];
  }

  /** 排队消息可编辑 / 删除 / 排序 */
  updateQueueItem(groupId: string, id: string, patch: Partial<Pick<QueueItem, 'urgency' | 'status'>> & { request?: OrchestrationRequest }): boolean {
    const item = (this.queues.get(groupId) || []).find((x) => x.id === id);
    if (!item || item.status !== 'queued') return false;
    if (patch.urgency) item.urgency = patch.urgency;
    if (patch.request) item.request = patch.request;
    if (patch.status) item.status = patch.status;
    this.sortQueue(groupId);
    this.notifyQueueMutated(groupId);
    return true;
  }

  removeQueueItem(groupId: string, id: string): boolean {
    const q = this.queues.get(groupId);
    if (!q) return false;
    const i = q.findIndex((x) => x.id === id);
    if (i < 0) return false;
    const item = q[i];
    if (item) item.status = 'cancelled';
    q.splice(i, 1);
    this.notifyQueueMutated(groupId);
    return true;
  }

  /** P0：停止当前并插队到最前 */
  insertUrgent(request: OrchestrationRequest): QueueItem {
    const item = this.enqueue(request);
    const q = this.queues.get(request.groupId)!;
    const i = q.findIndex((x) => x.id === item.id);
    if (i > 0) {
      q.splice(i, 1);
      q.unshift(item);
      this.notifyQueueMutated(request.groupId);
    }
    return item;
  }

  // ── 编排决策 ──

  /**
   * 用户发言 → 编排
   * 外部群：仅 @ 才响应
   * 定向：必须 @
   */
  route(req: OrchestrationRequest): {
    action: 'silent' | 'queue' | 'dispatch';
    decision?: OrchestrationDecision;
    duty?: RouterInstance;
    reason?: string;
    /** action==='queue' 时为 true：本方法**已经**入队，调用方不要重复 enqueue */
    queued?: boolean;
  } {
    const g = this.groups.get(req.groupId);
    if (!g) return { action: 'silent', reason: 'no-group' };

    // 外部群静默规则
    if (g.type === 'external') {
      if (!req.mentionIds.length) {
        return { action: 'silent', reason: 'external-no-mention' };
      }
    }

    // 定向模式：无 @ 不响应（无值班者编排）
    if (g.directedMode) {
      if (!req.mentionIds.length) {
        return { action: 'silent', reason: 'directed-no-mention' };
      }
      const targets = req.mentionIds
        .map((id) => (this.members.get(req.groupId) || []).find((m) => m.id === id))
        .filter(Boolean) as RouterInstance[];
      if (!targets.length) return { action: 'silent', reason: 'mentions-not-found' };
      return {
        action: 'dispatch',
        decision: {
          executorIds: targets.map((t) => t.id),
          taskBrief: req.content,
          contextBudget: 2000,
          shouldQueue: false,
        },
      };
    }

    // 非定向：值班者编排
    const duty = this.selectDuty(req.groupId);
    if (!duty) {
      // 已入队；调用方**不要**再 enqueue 一次（会双写队列）
      this.enqueue(req);
      this.dutyState.set(req.groupId, 'queued');
      this.notifyQueueMutated(req.groupId);
      return { action: 'queue', reason: 'no-idle-duty', queued: true };
    }

    this.dutyState.set(req.groupId, 'orchestrating');
    const executors = (this.members.get(req.groupId) || [])
      .filter((m) => m.id !== duty.id && m.status === 'idle' && !m.pureDispatcher)
      .slice(0, 3)
      .map((m) => m.id);

    // 值班者本身也可执行（非 pureDispatcher）
    if (!executors.length && !duty.pureDispatcher) {
      executors.push(duty.id);
    }

    const decision: OrchestrationDecision = {
      executorIds: executors,
      taskBrief: req.content.slice(0, 500),
      contextBudget: 2000,
      shouldQueue: false,
    };
    return { action: 'dispatch', decision, duty };
  }

  /**
   * 值班者完成一轮后回到 idle。
   * **不在此处弹出队列项** —— 弹出必须走 `dequeueNext`，且调用方要真的处理它。
   * 旧实现 here 标 `dispatched` 却把项留在队列里，orchestrator 又忽略返回值 ⇒ 等于丢弃。
   */
  complete(groupId: string): null {
    this.dutyState.set(groupId, 'idle');
    this.notifyQueueMutated(groupId);
    return null;
  }

  /**
   * 真正弹出下一条排队项：从队列**移除**并返回，调用方必须处理。
   * 处理失败时调用方应 `requeue` 放回，绝不静默丢掉。
   */
  dequeueNext(groupId: string): QueueItem | null {
    const q = this.queues.get(groupId) || [];
    const i = q.findIndex((x) => x.status === 'queued');
    if (i < 0) return null;
    const [item] = q.splice(i, 1);
    if (!item) return null;
    item.status = 'dispatched';
    this.notifyQueueMutated(groupId);
    return item;
  }

  /** 处理失败时把项放回队列（保持原 urgency/时间，重新排序） */
  requeue(item: QueueItem): QueueItem {
    const q = this.queues.get(item.groupId);
    const restored: QueueItem = { ...item, status: 'queued' };
    if (!q) {
      this.queues.set(item.groupId, [restored]);
    } else {
      q.push(restored);
      this.sortQueue(item.groupId);
    }
    this.notifyQueueMutated(item.groupId);
    return restored;
  }
}

export const DEFAULT_PERMISSIONS = {
  creator: {
    dissolve_group: true,
    modify_settings: true,
    appoint_admin: true,
    invite_members: true,
    approve_join: true,
    approve_tool: true,
    manage_allowlist: true,
    view_knowledge: true,
    talk_to_duty: true,
    view_board: true,
  },
  admin: {
    dissolve_group: false,
    modify_settings: true,
    appoint_admin: false,
    invite_members: true,
    approve_join: true,
    approve_tool: true,
    manage_allowlist: true,
    view_knowledge: true,
    talk_to_duty: true,
    view_board: true,
  },
  member: {
    dissolve_group: false,
    modify_settings: false,
    appoint_admin: false,
    invite_members: false,
    approve_join: false,
    approve_tool: false,
    manage_allowlist: false,
    view_knowledge: true,
    talk_to_duty: true,
    view_board: true,
  },
  external_member: {
    dissolve_group: false,
    modify_settings: false,
    appoint_admin: false,
    invite_members: false,
    approve_join: false,
    approve_tool: false,
    manage_allowlist: false,
    view_knowledge: false,
    talk_to_duty: true,
    view_board: 'readonly',
  },
} as const;
