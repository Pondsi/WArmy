/**
 * @ccarmy/group-router — 值班者状态机 + 队列 + 群类型
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
} from '@ccarmy/contracts';

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
}

export class GroupChatRouter {
  private groups = new Map<string, GroupConfig>();
  private members = new Map<string, RouterInstance[]>();
  private queues = new Map<string, QueueItem[]>();
  private dutyState = new Map<string, DutyState>();
  private seq = 0;

  constructor(private opts: GroupChatRouterOptions = {}) {}

  // ── 群与成员 ──

  createGroup(cfg: GroupConfig): GroupConfig {
    if (this.groups.has(cfg.groupId)) throw new Error('group exists');
    this.groups.set(cfg.groupId, { ...cfg });
    this.members.set(cfg.groupId, []);
    this.queues.set(cfg.groupId, []);
    this.dutyState.set(cfg.groupId, 'idle');
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
      this.enqueue(req);
      this.dutyState.set(req.groupId, 'queued');
      return { action: 'queue', reason: 'no-idle-duty' };
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

  /** 值班者完成一轮后回到 idle 并冲刷队列 */
  complete(groupId: string): QueueItem | null {
    this.dutyState.set(groupId, 'idle');
    const q = this.queues.get(groupId) || [];
    const next = q.find((x) => x.status === 'queued');
    if (!next) return null;
    next.status = 'dispatched';
    return next;
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
