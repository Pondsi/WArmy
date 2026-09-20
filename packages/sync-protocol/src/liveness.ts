/**
 * liveness —— 上下线与心跳（严格实现 ADR C1「心跳方向服从连通性」）
 *
 * C1 原文结论：**以「成员发起的持久连接自身的存活」作为在线判据**；
 * 创建者**仅在确实可拨入时**才主动探测。本模块是这条规则的执行者：
 *
 *  - `registerConnection(fp, conn)`：记一条存活连接。`kind`：
 *      · `member-initiated` —— 成员拨入的持久连接（**唯一无条件的在线判据**）
 *      · `creator-probe`    —— 创建者主动拨出的连接（只在 dialable 时才有）
 *  - `closeConnection(fp, connId)`：连接断了 → 进入**迟滞**（连续 N 次心跳失败且持续 M 秒）
 *    才判定离线（ADR §2.6 的抖动治理）。
 *  - `sweep()`：**绝不遍历全部成员**。它只做两件事：
 *      ① 对处于迟滞窗口内的成员做超时判定（本地计时，不发网络请求）；
 *      ② 对**显式列入 `pendingProbe`** 的成员发起探测，且**仅当本机确实可拨出**。
 *    没进过 `pendingProbe` 的成员永不成为探测目标 —— 这就是"创建者不轮询所有成员"。
 *  - **"可拨出"的判据有两个信号（附八.9）**：`dialable`（对端真的拨回来过，已验证）与
 *    `naturalDialable`（地址事实：本机有全局单播 IPv6 ⇒ IPv6 无 NAT ⇒ 天然可拨入）。
 *    **任一为真即可主动探测**；只认 `dialable === true` 会让有 IPv6 的机器永远不敢拨出
 *    （`setDialable` 默认 false 且没人置真时，`sweep()` 会一直短路成"不可拨入"），
 *    正是附八.9 说的"有 IPv6 的用户白白走上打洞/中继"。
 *  - `pendingProbe` 的典型来源：收到某成员的宣告但当时连不上（附三.2 的"失败即放弃"），
 *    或成员连接断开且创建者可拨入（此时主动拨回一次，仍不做无限重试）。
 *
 * 不实现的部分（明确标注）：不代替 TCP 层判活。半开连接（对端掉电/断网但未发 FIN）
 * 需要 TCP keepalive 或应用层 ping/pong —— 本包提供 `SecureSession.heartbeatMs`
 * 与 `heartbeat()` 钩子，接线方决定保活间隔。
 */

import { type CanDialResolution, type CanDialSignals, resolveCanDial } from './announce.js';

export type LianJieZhongLei = 'member-initiated' | 'creator-probe';

export interface HuoXingLianJie {
  id: string;
  kind: LianJieZhongLei;
  /** 关闭该连接（断开时调用） */
  close?: () => void;
}

export interface ChengYuanHuoXing {
  fingerprint: string;
  online: boolean;
  /** 在线是依据什么得出的 */
  via: 'member-connection' | 'creator-probe' | 'none';
  since: number;
  lastSeenAt: number;
  /** 连续心跳失败次数 */
  misses: number;
  connections: number;
}

export interface HuoXingXuanXiang {
  /** 迟滞：连续多少次心跳失败（默认 3） */
  offlineFailures?: number;
  /** 迟滞：且持续多少毫秒（默认 30_000） */
  offlineAfterMs?: number;
  now?: () => number;
  onOnline?: (fp: string, via: ChengYuanHuoXing['via']) => void;
  onOffline?: (fp: string, info: { misses: number; lastSeenAt: number; reason: string }) => void;
  /** 探测执行器（由调用方注入，通常是连接阶梯 + 握手） */
  probe?: (fp: string) => Promise<{ ok: boolean; detail?: string; rung?: string | null }>;
}

export interface TanCeJiLu {
  fingerprint: string;
  at: number;
  ok: boolean;
  detail?: string;
}

export interface QingliJieguo {
  /** 本轮真正发起探测的成员（只会是 pendingProbe 的子集） */
  probed: string[];
  /** 本轮判定离线的成员 */
  markedOffline: string[];
  /** 未探测的原因（不可拨出 / 无待探测成员） */
  note: string;
  /** 本轮"是否可拨出"的依据来源（附八.9；两个信号不合并） */
  canDialBasis: CanDialResolution['basis'];
}

interface ChengyuanZhuangtai {
  fingerprint: string;
  connections: Map<string, HuoXingLianJie>;
  since: number;
  lastSeenAt: number;
  misses: number;
  offlineSince: number | null;
  via: ChengYuanHuoXing['via'];
  online: boolean;
}

const UNKNOWN: ChengYuanHuoXing = {
  fingerprint: '',
  online: false,
  via: 'none',
  since: 0,
  lastSeenAt: 0,
  misses: 0,
  connections: 0,
};

export class LianJieHuoXing {
  private members = new Map<string, ChengyuanZhuangtai>();
  private pendingProbe = new Set<string>();
  private dialableFlag = false;
  /** 对端真的拨回来过（已验证）——与 naturalDialableFlag **刻意分开**（附八.9） */
  private dialableFlagVerified = false;
  /** 地址事实推出的天然可拨入候选（如全局单播 IPv6） */
  private naturalDialableFlag = false;
  private dialableBasis: CanDialResolution['basis'] = 'unspecified';
  private readonly offlineFailures: number;
  private readonly offlineAfterMs: number;
  private readonly now: () => number;
  /** 每次真实探测都留痕（可观测性 / 断言"不轮询"） */
  readonly probeLog: TanCeJiLu[] = [];
  readonly probeCallCount = { total: 0, bySweep: 0 };

  constructor(private readonly opts: HuoXingXuanXiang = {}) {
    this.offlineFailures = opts.offlineFailures ?? 3;
    this.offlineAfterMs = opts.offlineAfterMs ?? 30_000;
    this.now = opts.now ?? (() => Date.now());
  }

  /**
   * 本机是否可拨出（决定 `sweep()` 要不要主动探测）。
   *
   * 入参可以是旧布尔，也可以是**两个信号**（附八.9）：
   *  · `dialable`        —— 对端真的拨回来过（已验证；最强证据）；
   *  · `naturalDialable` —— 地址事实推出的天然可拨入候选（如全局单播 IPv6，无 NAT）。
   * 任一为真即视为可拨出；两个信号**分别保留**（`dialable` / `naturalDialable` / `canDialBasis`），
   * UI 与日志要分得清"验证过"与"只是地址事实"。
   */
  setDialable(v: CanDialSignals | boolean): void {
    const res = resolveCanDial(v);
    this.dialableFlag = res.canDial;
    this.dialableFlagVerified = res.dialable === true;
    this.naturalDialableFlag = res.naturalDialable === true;
    this.dialableBasis = res.basis;
  }
  /** 合并后的判据（"要不要主动探测"只看它） */
  get dialable(): boolean {
    return this.dialableFlag;
  }
  /** 对端真的拨回来过（**已验证**，与"地址事实"分开） */
  get verifiedDialable(): boolean {
    return this.dialableFlagVerified;
  }
  /** 地址事实推出的天然可拨入候选（如全局单播 IPv6；**未经验证**） */
  get naturalDialable(): boolean {
    return this.naturalDialableFlag;
  }
  /** 上面这个结论的依据来源（附八.9） */
  get canDialBasis(): CanDialResolution['basis'] {
    return this.dialableBasis;
  }

  get pendingProbes(): string[] {
    return [...this.pendingProbe];
  }

  private state(fp: string): ChengyuanZhuangtai {
    let s = this.members.get(fp);
    if (!s) {
      s = {
        fingerprint: fp,
        connections: new Map(),
        since: this.now(),
        lastSeenAt: 0,
        misses: 0,
        offlineSince: null,
        via: 'none',
        online: false,
      };
      this.members.set(fp, s);
    }
    return s;
  }

  /** 成员发起的持久连接建立 → 立即判定在线（这是 C1 的主判据） */
  registerConnection(fp: string, conn: HuoXingLianJie, at = this.now()): ChengYuanHuoXing {
    const s = this.state(fp);
    const wasOnline = s.online;
    s.connections.set(conn.id, conn);
    s.lastSeenAt = at;
    s.misses = 0;
    s.offlineSince = null;
    s.via = conn.kind === 'member-initiated' ? 'member-connection' : 'creator-probe';
    // 只要有一条 member-initiated 连接存活，就以它为准
    if (conn.kind === 'member-initiated') s.via = 'member-connection';
    s.online = true;
    if (!wasOnline) {
      s.since = at;
      this.opts.onOnline?.(fp, s.via);
    }
    return this.status(fp);
  }

  /** 连接断开 → 进入迟滞，不立即判离线 */
  closeConnection(fp: string, connId: string, at = this.now()): ChengYuanHuoXing {
    const s = this.members.get(fp);
    if (!s) return { ...UNKNOWN, fingerprint: fp };
    s.connections.delete(connId);
    s.lastSeenAt = at;
    if (s.connections.size === 0) {
      s.offlineSince = s.offlineSince ?? at;
    }
    return this.status(fp);
  }

  /** 心跳（成员侧保活 / 应用层 ping）；成功即刷新 lastSeen 并清零失败计数 */
  heartbeat(fp: string, at = this.now()): ChengYuanHuoXing {
    const s = this.state(fp);
    s.lastSeenAt = at;
    s.misses = 0;
    s.offlineSince = null;
    if (s.connections.size > 0) {
      const hasMemberInitiated = [...s.connections.values()].some((c) => c.kind === 'member-initiated');
      s.via = hasMemberInitiated ? 'member-connection' : 'creator-probe';
      s.online = true;
    }
    return this.status(fp);
  }

  /** 记录一次心跳失败（半开连接场景） */
  markMiss(fp: string, at = this.now()): ChengYuanHuoXing {
    const s = this.state(fp);
    s.misses += 1;
    s.lastSeenAt = at;
    if (s.connections.size === 0 && s.offlineSince === null) s.offlineSince = at;
    return this.status(fp);
  }

  /**
   * 把成员列入"待探测"。只有进过这里的人才会被 `sweep()` 主动探测。
   * 典型场景：收到宣告但连不上（附三.2 失败即放弃）—— 之后由创建者（若可拨入）拨回一次。
   */
  markPendingProbe(fp: string): void {
    this.pendingProbe.add(fp);
  }

  clearPendingProbe(fp: string): void {
    this.pendingProbe.delete(fp);
  }

  /** 探测失败的成员不应无限重试：提供显式清空（失败即放弃） */
  drainProbes(): string[] {
    const all = [...this.pendingProbe];
    this.pendingProbe.clear();
    return all;
  }

  status(fp: string): ChengYuanHuoXing {
    const s = this.members.get(fp);
    if (!s) return { ...UNKNOWN, fingerprint: fp };
    return {
      fingerprint: fp,
      online: s.online,
      via: s.online ? s.via : 'none',
      since: s.since,
      lastSeenAt: s.lastSeenAt,
      misses: s.misses,
      connections: s.connections.size,
    };
  }

  list(): ChengYuanHuoXing[] {
    return [...this.members.keys()].map((fp) => this.status(fp));
  }

  /** 探测成功 → 记为 creator-probe 在线（弱证据；无后续心跳会被迟滞判回离线） */
  private markProbeOnline(fp: string, at = this.now()): ChengYuanHuoXing {
    const s = this.state(fp);
    const wasOnline = s.online;
    s.online = true;
    s.via = s.connections.size > 0 ? s.via : 'creator-probe';
    s.lastSeenAt = at;
    s.misses = 0;
    s.offlineSince = null;
    if (!wasOnline) {
      s.since = at;
      this.opts.onOnline?.(fp, s.via);
    }
    return this.status(fp);
  }

  /** 迟滞判定：连接已断 + 连续失败达标 + 持续时间达标 → 才离线 */
  private judge(fp: string, nowMs: number): boolean {
    const s = this.state(fp);
    if (!s.online) return false;
    if (s.connections.size > 0) return false;
    const since = s.offlineSince ?? nowMs;
    const yijingguo = nowMs - since;
    if (s.misses >= this.offlineFailures && yijingguo >= this.offlineAfterMs) {
      s.online = false;
      s.via = 'none';
      this.opts.onOffline?.(fp, { misses: s.misses, lastSeenAt: s.lastSeenAt, reason: `连续 ${s.misses} 次心跳失败且持续 ${yijingguo}ms` });
      return true;
    }
    return false;
  }

  /**
   * 巡检一轮：**只做本地计时 + 对 pendingProbe 且可拨入的成员探测一次**。
   * 绝不遍历全部成员去 ping。
   */
  async sweep(at = this.now()): Promise<QingliJieguo> {
    const markedOffline: string[] = [];
    for (const fp of [...this.members.keys()]) {
      if (this.judge(fp, at)) markedOffline.push(fp);
    }

    if (this.pendingProbe.size === 0) {
      return { probed: [], markedOffline, note: '无待探测成员（创建者不主动轮询名册）', canDialBasis: this.dialableBasis };
    }
    if (!this.dialableFlag) {
      return {
        probed: [],
        markedOffline,
        note:
          this.dialableBasis === 'unspecified'
            ? '尚未判定本机可拨出（未设置拨入性信号）→ 不做主动探测，等待成员宣告/拨入'
            : '本机不可拨出（既无对端验证，也无天然可拨入地址）→ 不做主动探测，等待成员宣告/拨入',
        canDialBasis: this.dialableBasis,
      };
    }
    if (!this.opts.probe) {
      return { probed: [], markedOffline, note: '未注入 probe 执行器', canDialBasis: this.dialableBasis };
    }
    const targets = [...this.pendingProbe];
    this.pendingProbe.clear();
    const probed: string[] = [];
    for (const fp of targets) {
      this.probeCallCount.total += 1;
      this.probeCallCount.bySweep += 1;
      const r = await this.opts.probe(fp);
      this.probeLog.push({ fingerprint: fp, at: this.now(), ok: r.ok, detail: r.detail });
      probed.push(fp);
      if (r.ok) {
        // 探测成功 = 对端确实活着。证据强度弱于"成员发起的持久连接"：
        // 只把它记为 creator-probe 在线；后续若无心跳/连接，仍会被迟滞判回离线。
        this.markProbeOnline(fp);
      } else {
        // 探测失败即放弃（不重试、不留在队列里）
        const s = this.state(fp);
        if (s.connections.size === 0) s.offlineSince = s.offlineSince ?? this.now();
      }
    }
    return { probed, markedOffline, note: `对 ${probed.length} 个待探测成员各拨一次（无重试）`, canDialBasis: this.dialableBasis };
  }
}
