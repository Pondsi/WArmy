/**
 * 写入租约仲裁（对应 ADR 003 附四.3① 与 附五「并发控制」）
 *
 * 背景（附四.3① 原文的陷阱）：
 *   > **git 只能保护"已提交"的内容。** 两个成员同时改同一个文件的**工作区内容**时，
 *   > git 看不到冲突，后写者会静默覆盖先写者 —— 事后 merge 也救不回来，
 *   > 因为丢失的那次改动从来没进过对象库。
 *
 * 所以"成员直接操作本体"必须配**可执行的仲裁**：按 **任务 / 目录 / 文件** 粒度发租约，
 * 租约外写入一律拒绝，并给出**人能读懂**的原因（谁持有、覆盖范围、什么时候过期）。
 *
 * 设计要点：
 *   - **无定时器**：过期靠每次操作时按注入时钟判定（内部 `prune`）。主进程已经很脆弱，
 *     不给它加后台定时器；集成方想主动清理就调 `sweep()`。
 *   - **路径归一化**：复用 repo-guard 的 `normalizeRepoPath`（NFKC + 分隔符统一 +
 *     去末尾空格/点 + 折叠 `..`），所以 `src\a.ts`、`src/a.ts `、`SRC/A.TS`
 *     都会被判成同一个文件（前两个在 Windows 上本来就是同一个文件）。
 *   - **过期租约留痕**：过期后从活跃表移出，但在 history 里留一份，
 *     这样"你刚写过期的租约"能报出 `expired` 而不是含糊的 `no-lease`。
 *   - **纯内存**：跨进程/跨机器需要把租约广播出去并落盘，见文件末尾「接线说明」。
 */
import { normalizeRepoPath } from './repo-guard.js';

export type LeaseKind = 'task' | 'dir' | 'file';

export type LeaseDenyCode =
  | 'no-lease'
  | 'held-by-other'
  | 'expired'
  | 'path-invalid'
  | 'lease-not-found'
  | 'holder-mismatch'
  | 'invalid-request'
  | 'ttl-invalid';

export interface Lease {
  id: string;
  /** 持有者（成员 id / 实例 id / 值班者 id） */
  holder: string;
  kind: LeaseKind;
  /** 原始范围写法：任务 id、目录、文件（用于展示与审计） */
  scope: string;
  /** 归一化后的覆盖路径（`/` 分隔、无前导 `/`）；文件级租约只匹配完全相等 */
  paths: string[];
  /** 申请时的租约时长 */
  ttlMs: number;
  createdAt: number;
  expiresAt: number;
  /** 任务级租约关联的任务 id */
  taskId?: string;
  note?: string;
}

export interface ExpiredLease extends Lease {
  expiredAt: number;
}

export interface LeaseError {
  code: LeaseDenyCode;
  reason: string;
}

export interface LeaseConflict {
  leaseId: string;
  holder: string;
  kind: LeaseKind;
  scope: string;
  paths: string[];
  expiresAt: number;
}

export interface AcquireRequest {
  holder: string;
  /** 默认 dir（范围更宽 = 冲突判定更严，fail-closed） */
  kind?: LeaseKind;
  /** 范围展示名；任务级租约可只给 taskId + paths */
  scope?: string;
  /** 覆盖的路径前缀；任务级租约必填 */
  paths?: string[];
  ttlMs?: number;
  taskId?: string;
  note?: string;
}

export interface HuoquJieguo {
  ok: boolean;
  lease?: Lease;
  /** 复用/合并了自己已有的租约 */
  merged?: boolean;
  error?: LeaseError;
  conflicts?: LeaseConflict[];
}

export interface LeaseRefRequest {
  holder?: string;
  leaseId?: string;
  scope?: string;
}

export interface ShifangJieguo {
  ok: boolean;
  released: boolean;
  lease?: Lease;
  reason?: string;
  error?: LeaseError;
}

export interface CheckWriteResult {
  allowed: boolean;
  holder: string;
  /** 归一化后的路径 */
  path: string;
  code?: LeaseDenyCode;
  reason: string;
  /** 放行时：命中的租约 */
  lease?: Lease;
  /** 被拒时：当前持有者（无人持有则为 null） */
  heldBy?: string | null;
  expiresAt?: number | null;
}

export interface ChiyouzheXinxi {
  path: string;
  /** 当前持有者；无人持有为 null */
  holder: string | null;
  lease: Lease | null;
  expiresAt: number | null;
  reason: string;
}

export interface LeaseRegistryOptions {
  /** 注入时钟（测试必用；默认 Date.now） */
  now?: () => number;
  /** 默认租约时长（默认 15 分钟） */
  defaultTtlMs?: number;
  /** 单次租约时长上限（默认 8 小时） */
  maxTtlMs?: number;
  /** 同一持有者的租约数量上限（默认 32，防误用刷爆） */
  maxLeasesPerHolder?: number;
  /**
   * 路径比较是否折叠大小写（默认 true）。
   * 本体在创建者机器上，Windows/macOS 的文件系统本来就折叠大小写，
   * 所以默认按折叠比较 —— 否则 `SRC/A.TS` 能绕过 `src/a.ts` 的租约。
   */
  caseInsensitive?: boolean;
  /** 过期租约留痕条数（默认 50） */
  historyLimit?: number;
  /** 名字前缀，便于多个本体区分 */
  idPrefix?: string;
}

function geshiShijian(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function geshiShengyu(ms: number): string {
  if (ms <= 0) return '已过期';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  return `${h} 小时 ${m % 60} 分钟`;
}

function LeiXingMing(kind: LeaseKind): string {
  if (kind === 'file') return '文件级';
  if (kind === 'task') return '任务级';
  return '目录级';
}

/** 单个租约是否覆盖某条归一化路径：文件级只匹配完全相等；任务/目录级按前缀 */
function leaseCovers(lease: Lease, target: string): boolean {
  for (const p of lease.paths) {
    if (lease.kind === 'file') {
      if (p === target) return true;
    } else if (target === p || target.startsWith(`${p}/`)) {
      return true;
    }
  }
  return false;
}

/** 候选范围与既有租约的重叠路径（既用于冲突判定，也用于可读的冲突原因） */
function overlapPaths(
  candKind: LeaseKind,
  candPaths: string[],
  otherKind: LeaseKind,
  otherPaths: string[]
): string[] {
  return candPaths.filter((p) => {
    const candCoversOther = otherPaths.some((q) =>
      candKind === 'file' ? p === q : q === p || q.startsWith(`${p}/`)
    );
    const otherCoversCand = otherPaths.some((q) =>
      otherKind === 'file' ? p === q : p === q || p.startsWith(`${q}/`)
    );
    return candCoversOther || otherCoversCand;
  });
}

function zuyueChongdie(a: Lease, b: Lease): boolean {
  return overlapPaths(a.kind, a.paths, b.kind, b.paths).length > 0;
}

/**
 * 租约表。**无定时器**：所有判定都按注入时钟在做操作的那一刻算。
 *
 * 不变量：任一归一化路径在任一时刻最多被一个持有者的活跃租约覆盖。
 */
export class LeaseRegistry {
  private leases = new Map<string, Lease>();
  private history: ExpiredLease[] = [];
  private seq = 0;
  private readonly clock: () => number;
  private readonly defaultTtlMs: number;
  private readonly maxTtlMs: number;
  private readonly maxLeasesPerHolder: number;
  private readonly caseInsensitive: boolean;
  private readonly historyLimit: number;
  private readonly idPrefix: string;

  constructor(opts: LeaseRegistryOptions = {}) {
    this.clock = opts.now ?? ((): number => Date.now());
    this.defaultTtlMs = opts.defaultTtlMs ?? 15 * 60_000;
    this.maxTtlMs = opts.maxTtlMs ?? 8 * 3600_000;
    this.maxLeasesPerHolder = opts.maxLeasesPerHolder ?? 32;
    this.caseInsensitive = opts.caseInsensitive !== false;
    this.historyLimit = opts.historyLimit ?? 50;
    this.idPrefix = opts.idPrefix ?? 'lease';
  }

  /** 申请租约。范围被别人占住 → 拒绝并给出可读原因；自己已占 → 合并（幂等） */
  acquire(req: AcquireRequest): HuoquJieguo {
    const now = this.clock();
    this.prune(now);

    const holder = typeof req?.holder === 'string' ? req.holder.trim() : '';
    if (!holder) return { ok: false, error: { code: 'invalid-request', reason: 'holder 不能为空' } };

    const kind: LeaseKind = req.kind === 'task' || req.kind === 'file' ? req.kind : 'dir';
    const explicitPaths = Array.isArray(req.paths) && req.paths.length ? req.paths : [];
    const rawPaths = explicitPaths.length ? explicitPaths : req.scope ? [req.scope] : [];
    if (!rawPaths.length) {
      return { ok: false, error: { code: 'invalid-request', reason: '必须给 scope 或 paths（要保护的路径）' } };
    }
    if (kind === 'task' && !explicitPaths.length) {
      return {
        ok: false,
        error: { code: 'invalid-request', reason: '任务级租约必须显式给 paths（任务 id 本身不是路径）' },
      };
    }

    const paths: string[] = [];
    for (const raw of rawPaths) {
      const n = normalizeRepoPath(String(raw ?? ''));
      if (!n.ok) {
        return {
          ok: false,
          error: {
            code: 'path-invalid',
            reason: `租约路径非法（${n.reason ?? '未知'}）：${String(raw ?? '')}`,
          },
        };
      }
      const key = this.caseInsensitive ? n.key : n.normalized;
      if (!paths.includes(key)) paths.push(key);
    }

    const ttlMs = req.ttlMs === undefined ? this.defaultTtlMs : req.ttlMs;
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      return { ok: false, error: { code: 'ttl-invalid', reason: `租约时长必须为正数毫秒：${String(req.ttlMs)}` } };
    }
    const youXiaoQi = Math.min(Math.floor(ttlMs), this.maxTtlMs);

    const candidate: Lease = {
      id: '',
      holder,
      kind,
      scope: req.scope?.trim() || paths[0] || holder,
      paths,
      ttlMs: youXiaoQi,
      createdAt: now,
      expiresAt: now + youXiaoQi,
      ...(req.taskId ? { taskId: req.taskId } : {}),
      ...(req.note ? { note: req.note } : {}),
    };

    // 1) 别人的活跃租约 → 冲突
    const conflicts: LeaseConflict[] = [];
    let sharedPaths: string[] = [];
    for (const live of this.leases.values()) {
      if (live.holder === holder) continue;
      const chongdie = overlapPaths(candidate.kind, candidate.paths, live.kind, live.paths);
      if (!chongdie.length) continue;
      if (!sharedPaths.length) sharedPaths = chongdie;
      conflicts.push({
        leaseId: live.id,
        holder: live.holder,
        kind: live.kind,
        scope: live.scope,
        paths: live.paths.slice(),
        expiresAt: live.expiresAt,
      });
    }
    if (conflicts.length) {
      const first = conflicts[0]!;
      const where = (sharedPaths.length ? sharedPaths : first.paths).slice(0, 3).join('、');
      return {
        ok: false,
        conflicts,
        error: {
          code: 'held-by-other',
          reason:
            `写入范围与「${first.holder}」的${LeiXingMing(first.kind)}租约冲突（范围 ${first.scope}，覆盖 ${where}，` +
            `${geshiShijian(first.expiresAt)} 到期，剩余 ${geshiShengyu(first.expiresAt - now)}）。` +
            `请等它释放/过期，或让值班者重新划分范围。`,
        },
      };
    }

    // 2) 自己已有重叠租约 → 合并（幂等，避免自己跟自己抢）
    const own = [...this.leases.values()].filter((l) => l.holder === holder && zuyueChongdie(l, candidate));
    const base = own[0];
    if (base) {
      for (const p of candidate.paths) if (!base.paths.includes(p)) base.paths.push(p);
      for (const extra of own.slice(1)) {
        for (const p of extra.paths) if (!base.paths.includes(p)) base.paths.push(p);
        this.leases.delete(extra.id);
      }
      // 粒度只做**单向**升级：file → dir/task。
      // 升级会把"同名路径"当作前缀（覆盖更宽），方向上是**多挡不漏挡**，
      // 所以宁可多挡：绝不留下"自己以为自己有租约、实际漏挡"的窟窿。
      if (base.kind === 'file' && candidate.kind !== 'file') base.kind = candidate.kind;
      base.expiresAt = Math.max(base.expiresAt, candidate.expiresAt);
      base.ttlMs = Math.max(base.ttlMs, youXiaoQi);
      if (req.note) base.note = req.note;
      if (req.taskId) base.taskId = req.taskId;
      return { ok: true, lease: this.copy(base), merged: true };
    }

    // 3) 新建
    const mine = [...this.leases.values()].filter((l) => l.holder === holder).length;
    if (mine >= this.maxLeasesPerHolder) {
      return {
        ok: false,
        error: {
          code: 'invalid-request',
          reason: `${holder} 的活跃租约已达上限 ${this.maxLeasesPerHolder}，请先 release 掉不用的`,
        },
      };
    }
    this.seq += 1;
    candidate.id = `${this.idPrefix}-${this.seq}-${holder.replace(/[^\w-]/g, '_')}`;
    this.leases.set(candidate.id, candidate);
    return { ok: true, lease: this.copy(candidate) };
  }

  /** 续租（只有持有者本人；已过期的租约不许续，必须重新申请） */
  extend(req: LeaseRefRequest, ttlMs?: number): HuoquJieguo {
    const now = this.clock();
    this.prune(now);
    const found = this.find(req);
    if (found.kind === 'error') return { ok: false, error: found.error };
    const lease = found.lease;
    const youXiaoQi = Math.min(Math.floor(ttlMs === undefined ? lease.ttlMs : ttlMs), this.maxTtlMs);
    if (!Number.isFinite(youXiaoQi) || youXiaoQi <= 0) {
      return { ok: false, error: { code: 'ttl-invalid', reason: `续租时长必须为正数毫秒：${String(ttlMs)}` } };
    }
    lease.ttlMs = youXiaoQi;
    lease.expiresAt = now + youXiaoQi;
    return { ok: true, lease: this.copy(lease) };
  }

  /** 释放（只有持有者本人；非本人 → holder-mismatch）。已过期 = 已自动失效，不算失败 */
  release(req: LeaseRefRequest): ShifangJieguo {
    const now = this.clock();
    this.prune(now);
    const found = this.find(req);
    if (found.kind === 'error') {
      if (found.error.code === 'expired') return { ok: true, released: false, reason: found.error.reason };
      return { ok: false, released: false, error: found.error };
    }
    this.leases.delete(found.lease.id);
    return { ok: true, released: true, lease: this.copy(found.lease) };
  }

  /**
   * 写入门禁：这是**唯一**应该被写入前置检查调用的入口。
   * 无租约 / 他人持有 / 已过期 → 拒绝，并给出可读原因。
   */
  checkWrite(holder: string, path: string): CheckWriteResult {
    const now = this.clock();
    this.prune(now);
    const who = typeof holder === 'string' ? holder.trim() : '';
    const n = normalizeRepoPath(typeof path === 'string' ? path : '');
    if (!n.ok) {
      return {
        allowed: false,
        holder: who,
        path: n.normalized,
        code: 'path-invalid',
        reason: `写入路径非法（${n.reason ?? '未知'}）：${String(path)}`,
        heldBy: null,
        expiresAt: null,
      };
    }
    const key = this.caseInsensitive ? n.key : n.normalized;
    if (!who) {
      return {
        allowed: false,
        holder: who,
        path: n.normalized,
        code: 'invalid-request',
        reason: 'holder 不能为空：无法判断你是否持有租约',
        heldBy: null,
        expiresAt: null,
      };
    }

    // 1) 自己有覆盖该路径的活跃租约 → 放行
    for (const live of this.leases.values()) {
      if (live.holder === who && leaseCovers(live, key)) {
        return {
          allowed: true,
          holder: who,
          path: n.normalized,
          reason: `允许写入（命中你自己的${LeiXingMing(live.kind)}租约 ${live.scope}，${geshiShijian(live.expiresAt)} 到期，剩余 ${geshiShengyu(live.expiresAt - now)}）`,
          lease: this.copy(live),
        };
      }
    }
    // 2) 别人持有 → 拒绝
    for (const live of this.leases.values()) {
      if (live.holder !== who && leaseCovers(live, key)) {
        return {
          allowed: false,
          holder: who,
          path: n.normalized,
          code: 'held-by-other',
          reason:
            `${n.normalized} 当前被「${live.holder}」持有（${LeiXingMing(live.kind)}租约，范围 ${live.scope}，` +
            `${geshiShijian(live.expiresAt)} 到期，剩余 ${geshiShengyu(live.expiresAt - now)}）。` +
            `直接写会静默覆盖对方的改动（工作区内容 git 救不回来）。请等它释放/过期，或找值班者仲裁。`,
          lease: this.copy(live),
          heldBy: live.holder,
          expiresAt: live.expiresAt,
        };
      }
    }
    // 3) 自己的租约刚过期（留痕里能查到）→ 报 expired 而不是含糊的 no-lease
    for (let i = this.history.length - 1; i >= 0; i--) {
      const old = this.history[i]!;
      if (old.holder === who && leaseCovers(old, key)) {
        return {
          allowed: false,
          holder: who,
          path: n.normalized,
          code: 'expired',
          reason: `你对 ${n.normalized} 的租约已于 ${geshiShijian(old.expiresAt)} 过期（原时长 ${Math.round(old.ttlMs / 60_000)} 分钟），已自动失效，请重新申请`,
          heldBy: null,
          expiresAt: null,
        };
      }
    }
    // 4) 无租约
    return {
      allowed: false,
      holder: who,
      path: n.normalized,
      code: 'no-lease',
      reason: `${n.normalized} 没有租约：本项目要求「先拿租约再写」，范围外写入会被拒，请先 acquire`,
      heldBy: null,
      expiresAt: null,
    };
  }

  /** 批量写入门禁：任一路径被拒即整体拒绝（空列表也算拒绝，fail-closed） */
  checkWriteBatch(
    holder: string,
    paths: string[]
  ): { allowed: boolean; denied: CheckWriteResult | null; results: CheckWriteResult[] } {
    const results = (Array.isArray(paths) ? paths : []).map((p) => this.checkWrite(holder, p));
    const denied = results.find((r) => !r.allowed) ?? null;
    return { allowed: denied === null && results.length > 0, denied, results };
  }

  /** 某路径当前被谁持有 */
  holdersOf(p: string): ChiyouzheXinxi[] {
    const now = this.clock();
    this.prune(now);
    const n = normalizeRepoPath(typeof p === 'string' ? p : '');
    if (!n.ok) {
      return [
        { path: n.normalized, holder: null, lease: null, expiresAt: null, reason: `路径非法：${n.reason ?? '未知'}` },
      ];
    }
    const key = this.caseInsensitive ? n.key : n.normalized;
    const out: ChiyouzheXinxi[] = [];
    for (const live of this.leases.values()) {
      if (!leaseCovers(live, key)) continue;
      out.push({
        path: n.normalized,
        holder: live.holder,
        lease: this.copy(live),
        expiresAt: live.expiresAt,
        reason: `「${live.holder}」的${LeiXingMing(live.kind)}租约覆盖该路径（范围 ${live.scope}，${geshiShijian(live.expiresAt)} 到期，剩余 ${geshiShengyu(live.expiresAt - now)}）`,
      });
    }
    if (!out.length) {
      out.push({ path: n.normalized, holder: null, lease: null, expiresAt: null, reason: '当前无人持有该路径' });
    }
    return out;
  }

  /** 活跃租约列表（先按过期时间、再按创建时间） */
  list(): Lease[] {
    this.prune(this.clock());
    return [...this.leases.values()]
      .sort((a, b) => a.expiresAt - b.expiresAt || a.createdAt - b.createdAt)
      .map((l) => this.copy(l));
  }

  /** 主动清理过期租约，返回本次被清掉的（集成方可在心跳里调，也可完全不调） */
  sweep(): ExpiredLease[] {
    return this.prune(this.clock()).map((l) => ({ ...l, paths: l.paths.slice() }));
  }

  /** 过期留痕（最近 N 条） */
  expiredHistory(): ExpiredLease[] {
    return this.history.map((l) => ({ ...l, paths: l.paths.slice() }));
  }

  stats(): { active: number; holders: number; expired: number; nextExpiryAt: number | null } {
    this.prune(this.clock());
    const holders = new Set([...this.leases.values()].map((l) => l.holder));
    let next: number | null = null;
    for (const l of this.leases.values()) next = next === null ? l.expiresAt : Math.min(next, l.expiresAt);
    return { active: this.leases.size, holders: holders.size, expired: this.history.length, nextExpiryAt: next };
  }

  clear(): void {
    this.leases.clear();
    this.history = [];
  }

  // ── 内部 ──

  private copy(l: Lease): Lease {
    return { ...l, paths: l.paths.slice() };
  }

  /** 把过期租约从活跃表移到留痕表，返回本次过期的 */
  private prune(now: number): ExpiredLease[] {
    const expired: ExpiredLease[] = [];
    for (const [id, l] of [...this.leases.entries()]) {
      if (l.expiresAt <= now) {
        this.leases.delete(id);
        const rec: ExpiredLease = { ...this.copy(l), expiredAt: now };
        expired.push(rec);
        this.history.push(rec);
      }
    }
    if (this.history.length > this.historyLimit) {
      this.history = this.history.slice(this.history.length - this.historyLimit);
    }
    return expired;
  }

  private find(req: LeaseRefRequest): { kind: 'ok'; lease: Lease } | { kind: 'error'; error: LeaseError } {
    const id = typeof req?.leaseId === 'string' ? req.leaseId : '';
    const holder = typeof req?.holder === 'string' ? req.holder.trim() : '';
    const scope = typeof req?.scope === 'string' ? req.scope : '';
    const live = id
      ? this.leases.get(id)
      : [...this.leases.values()].find((l) => l.holder === holder && (!scope || l.scope === scope));
    if (live) {
      if (holder && live.holder !== holder) {
        return {
          kind: 'error',
          error: {
            code: 'holder-mismatch',
            reason: `租约 ${live.id} 属于「${live.holder}」，你不是持有者，不能操作它`,
          },
        };
      }
      return { kind: 'ok', lease: live };
    }
    // 查过期留痕，给出"已过期"而不是"不存在"
    const expired = this.history.find(
      (l) => (id ? l.id === id : l.holder === holder && (!scope || l.scope === scope))
    );
    if (expired) {
      if (holder && expired.holder !== holder) {
        return {
          kind: 'error',
          error: { code: 'holder-mismatch', reason: `租约 ${expired.id} 属于「${expired.holder}」，你不是持有者` },
        };
      }
      return {
        kind: 'error',
        error: {
          code: 'expired',
          reason: `租约 ${expired.id}（${expired.scope}）已于 ${geshiShijian(expired.expiresAt)} 过期，已自动失效`,
        },
      };
    }
    return {
      kind: 'error',
      error: {
        code: 'lease-not-found',
        reason: id
          ? `找不到租约 ${id}`
          : `找不到 ${holder || '(未指定 holder)'} 的租约${scope ? `（范围 ${scope}）` : ''}`,
      },
    };
  }
}

/**
 * 接线说明（本模块刻意不 import electron / fs / net）：
 *  - 创建者侧：`LeaseRegistry` 单例放在一个纯模块里（本文件），写入前置检查调
 *    `checkWrite(holder, path)`，不通过就拒绝这次写；`checkWriteBatch` 用于一次改多个文件；
 *  - 成员侧：成员在 UI 上说"我要改 X"，走 IPC 让创建者 `acquire`，拿到 `lease.id`
 *    之后再开始写；写完 `release`；
 *  - 广播：租约变化（acquire/extend/release/过期）需要推给所有成员，否则成员不知道自己
 *    能不能动手；这一步要接 `packages/sync-protocol` 的通道（本文件不做网络）；
 *  - 落盘：`list()` / `expiredHistory()` 可序列化落盘，创建者重启后恢复；否则重启 = 租约全失，
 *    成员会以为还持有 → 需要靠 `expired` 提示引导重新申请。
 *
 * 已知缺口（必须同步进交付报告）：
 *  1. 进程内仲裁：两个进程各持一份 `LeaseRegistry` 就会各放各的，必须只有一个权威实例；
 *  2. 租约只保护"写入前的声明"，**不点检文件系统**：绕过 git 直接改工作区文件（编辑器自动保存、
 *     构建产物写回）依然会静默覆盖 —— git 层只能看到已提交内容；
 *  3. 没有防"拿了租约不改也不放"的恶意占用（只有 TTL 上限兜底）；
 *  4. 路径折叠是近似（同 repo-guard 的已知缺口第 4 条）；
 *  5. 时间依赖调用方时钟，跨机器时钟偏差会让"过期"判定不一致（需要 A5 的单调计数/时间戳容差）。
 */
