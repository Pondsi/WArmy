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
  ZhibanTai,
  QunPeizhi,
  QunLei,
  OrchestrationDecision,
  OrchestrationRequest,
  Jinji,
} from '@warmy/contracts';

export interface LuyouqiShili {
  id: string;
  ming: string;
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

export interface DuilieTiaomu {
  id: string;
  groupId: string;
  urgency: Jinji;
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
export interface LuyouqiDuilieKuaizhao {
  version: 1;
  seq: number;
  queues: Record<string, DuilieTiaomu[]>;
  dutyState: Record<string, ZhibanTai>;
}

export class GroupChatRouter {
  private groups = new Map<string, QunPeizhi>();
  private members = new Map<string, LuyouqiShili[]>();
  private queues = new Map<string, DuilieTiaomu[]>();
  private dutyState = new Map<string, ZhibanTai>();
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
  serializeState(): LuyouqiDuilieKuaizhao {
    const queues: Record<string, DuilieTiaomu[]> = {};
    for (const [qunId, q] of this.queues) {
      queues[qunId] = q.map((x) => ({ ...x, request: { ...x.request } }));
    }
    const dutyState: Record<string, ZhibanTai> = {};
    for (const [qunId, s] of this.dutyState) dutyState[qunId] = s;
    return { version: 1, seq: this.seq, queues, dutyState };
  }

  /** 从快照恢复（启动时调用；只恢复队列/值班态，不覆盖成员与群配置） */
  restoreState(snap: LuyouqiDuilieKuaizhao | null | undefined): void {
    if (!snap || snap.version !== 1) return;
    this.seq = Number(snap.seq) || 0;
    this.queues.clear();
    for (const [qunId, q] of Object.entries(snap.queues || {})) {
      if (!Array.isArray(q)) continue;
      this.queues.set(
        qunId,
        q
          .filter((x) => x && typeof x.id === 'string' && x.request)
          .map((x) => ({
            id: String(x.id),
            groupId: String(x.groupId || qunId),
            urgency: (x.urgency as Jinji) || 'P2',
            request: { ...x.request },
            enqueuedAt: Number(x.enqueuedAt) || Date.now(),
            status: (x.status as DuilieTiaomu['status']) || 'queued',
          }))
      );
    }
    this.dutyState.clear();
    for (const [qunId, s] of Object.entries(snap.dutyState || {})) {
      this.dutyState.set(qunId, s as ZhibanTai);
    }
  }

  // ── 群与成员 ──

  createGroup(cfg: QunPeizhi): QunPeizhi {
    if (this.groups.has(cfg.groupId)) throw new Error('group exists');
    this.groups.set(cfg.groupId, { ...cfg });
    this.members.set(cfg.groupId, []);
    this.queues.set(cfg.groupId, []);
    this.dutyState.set(cfg.groupId, 'idle');
    this.notifyQueueMutated(cfg.groupId);
    return this.groups.get(cfg.groupId)!;
  }

  getGroup(groupId: string): QunPeizhi | undefined {
    return this.groups.get(groupId);
  }

  /** 按进群顺序排列；远程 AI 永不可值班 */
  join(groupId: string, inst: Omit<LuyouqiShili, 'order'>): LuyouqiShili {
    const LieBiao = this.members.get(groupId);
    if (!LieBiao) throw new Error('group not found');
    const order = LieBiao.length + 1;
    const hang: LuyouqiShili = {
      ...inst,
      order,
      dutyEligible: inst.dutyEligible && inst.local,
      status: inst.status || 'idle',
    };
    LieBiao.push(hang);
    LieBiao.sort((a, b) => a.order - b.order);
    return hang;
  }

  leave(groupId: string, instanceId: string): void {
    const LieBiao = this.members.get(groupId);
    if (!LieBiao) return;
    const i = LieBiao.findIndex((m) => m.id === instanceId);
    if (i >= 0) LieBiao.splice(i, 1);
  }

  listMembers(groupId: string): LuyouqiShili[] {
    return [...(this.members.get(groupId) || [])];
  }

  setStatus(groupId: string, instanceId: string, status: LuyouqiShili['status']): void {
    const m = this.members.get(groupId)?.find((x) => x.id === instanceId);
    if (m) m.status = status;
  }

  setFixedDuty(groupId: string, instanceId: string | null): void {
    const LieBiao = this.members.get(groupId) || [];
    for (const m of LieBiao) m.fixedDuty = m.id === instanceId;
  }

  // ── 值班者选择（不变量 11：仅本机） ──

  /**
   * 选择值班者：
   * 1. 指定固定值班者：空闲则用；忙则按 queueWhenFixedBusy 排队或顺延
   * 2. 否则：序号最小的空闲、本机、dutyEligible
   * 3. 都忙：返回 null → 调用方应排队或用兜底小模型
   */
  selectDuty(groupId: string): LuyouqiShili | null {
    const LieBiao = this.members.get(groupId) || [];
    const fuhe = LieBiao.filter((m) => m.local && m.dutyEligible && m.status !== 'dead' && m.status !== 'offline');

    const fixed = fuhe.find((m) => m.fixedDuty);
    if (fixed) {
      if (fixed.status === 'idle') return fixed;
      if (this.opts.queueWhenFixedBusy) return null;
      // 顺延 +1
      const next = fuhe
        .filter((m) => m.order > fixed.order && m.status === 'idle')
        .sort((a, b) => a.order - b.order)[0];
      return next || fuhe.filter((m) => m.status === 'idle').sort((a, b) => a.order - b.order)[0] || null;
    }

    const kongxian = fuhe.filter((m) => m.status === 'idle').sort((a, b) => a.order - b.order);
    return kongxian[0] || null;
  }

  duty(groupId: string): { state: ZhibanTai; instance: LuyouqiShili | null } {
    return {
      state: this.dutyState.get(groupId) || 'idle',
      instance: this.selectDuty(groupId),
    };
  }

  // ── 队列（仅 Router 写入） ──

  enqueue(request: OrchestrationRequest): DuilieTiaomu {
    const item: DuilieTiaomu = {
      id: `q${++this.seq}-${Date.now().toString(36)}`,
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
    const paiMing: Record<Jinji, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
    const q = this.queues.get(groupId);
    if (!q) return;
    q.sort((a, b) => {
      const u = paiMing[a.urgency] - paiMing[b.urgency];
      if (u !== 0) return u;
      return a.enqueuedAt - b.enqueuedAt;
    });
  }

  listQueue(groupId: string): DuilieTiaomu[] {
    return [...(this.queues.get(groupId) || [])];
  }

  /** 排队消息可编辑 / 删除 / 排序 */
  updateQueueItem(groupId: string, id: string, patch: Partial<Pick<DuilieTiaomu, 'urgency' | 'status'>> & { request?: OrchestrationRequest }): boolean {
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
  insertUrgent(request: OrchestrationRequest): DuilieTiaomu {
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
  route(Qiu: OrchestrationRequest): {
    action: 'silent' | 'queue' | 'dispatch';
    decision?: OrchestrationDecision;
    duty?: LuyouqiShili;
    reason?: string;
    /** action==='queue' 时为 true：本方法**已经**入队，调用方不要重复 enqueue */
    queued?: boolean;
  } {
    const g = this.groups.get(Qiu.groupId);
    if (!g) return { action: 'silent', reason: 'no-group' };

    // 外部群静默规则
    if (g.type === 'external') {
      if (!Qiu.mentionIds.length) {
        return { action: 'silent', reason: 'external-no-mention' };
      }
    }

    // 定向模式：无 @ 不响应（无值班者编排）
    if (g.directedMode) {
      if (!Qiu.mentionIds.length) {
        return { action: 'silent', reason: 'directed-no-mention' };
      }
      const targets = Qiu.mentionIds
        .map((id) => (this.members.get(Qiu.groupId) || []).find((m) => m.id === id))
        .filter(Boolean) as LuyouqiShili[];
      if (!targets.length) return { action: 'silent', reason: 'mentions-not-found' };
      return {
        action: 'dispatch',
        decision: {
          executorIds: targets.map((t) => t.id),
          taskBrief: Qiu.content,
          contextBudget: 2000,
          shouldQueue: false,
        },
      };
    }

    // 非定向：值班者编排
    const duty = this.selectDuty(Qiu.groupId);
    if (!duty) {
      // 已入队；调用方**不要**再 enqueue 一次（会双写队列）
      this.enqueue(Qiu);
      this.dutyState.set(Qiu.groupId, 'queued');
      this.notifyQueueMutated(Qiu.groupId);
      return { action: 'queue', reason: 'no-idle-duty', queued: true };
    }

    this.dutyState.set(Qiu.groupId, 'orchestrating');
    const zhiXingQiJi = (this.members.get(Qiu.groupId) || [])
      .filter((m) => m.id !== duty.id && m.status === 'idle' && !m.pureDispatcher)
      .slice(0, 3)
      .map((m) => m.id);

    // 值班者本身也可执行（非 pureDispatcher）
    if (!zhiXingQiJi.length && !duty.pureDispatcher) {
      zhiXingQiJi.push(duty.id);
    }

    const decision: OrchestrationDecision = {
      executorIds: zhiXingQiJi,
      taskBrief: Qiu.content.slice(0, 500),
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
  dequeueNext(groupId: string): DuilieTiaomu | null {
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
  requeue(item: DuilieTiaomu): DuilieTiaomu {
    const q = this.queues.get(item.groupId);
    const restored: DuilieTiaomu = { ...item, status: 'queued' };
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
