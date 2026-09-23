/**
 * announce —— 双向宣告式上线（ADR 附三.2 / C3）
 *
 * 规则（逐条对应 ADR）：
 *  - **上线** → ① 更新自己的 DHT 记录（宣告"我在线 + 当前地址"）
 *              ② 对已知名册成员尝试连线（一次，见下）
 *  - **收到他人宣告** → 若对方在本群名册内 → 建立联系（不在名册内 → 拒绝，并记录）
 *  - **宣告失败即放弃，不做无限重试**：每个成员**每次宣告只播一次**；
 *    `AnnounceAttempt.retries` 恒为 0，且本模块**不注册任何定时器/轮询**。
 *    理由是事件驱动：对方上线时也会宣告，所以不存在遗漏（C3）。
 *  - **C3 退化路径**：连不上的成员标记为 `await-peer-announce`（"待其上线"，而非失败），
 *    而不是反复重试。
 *  - **创建者上线广播的前提**：成员名册 + DHT 解析地址 + 连得上；对不可达者退化为上述路径。
 *  - **C1**：本机不可拨入时，收到宣告**不主动拨**，
 *    只登记地址等待对方拨入 —— 心跳方向服从连通性。
 *  - **C1 的前提要判对（附八.9）**：`canDial` 从布尔放宽为**两个信号**
 *    （`dialable` = 对端真的拨回来了；`naturalDialable` = 地址事实推出的天然可拨入候选，如全局单播 IPv6）。
 *    **任一为真即可主动拨**，且两个信号**不合并**（报告里分别保留）——
 *    只认 `dialable === true` 会让有全局 IPv6 的机器被误判成"不可拨入"，
 *    从而被动等对端拨、白白退化成打洞/中继（附八.9 点名的正是这一处）。
 *
 * 注意：本模块不做消息层广播（那是 group-router / 消息总线的事）；
 * 它只负责"上线宣告 + 建连"这一段，通过回调把结果交出去。
 */
import type { ShenfenGongyingshang, GuifanShenfen } from './identity.js';
import {
  type DhtDiZhi,
  type DhtJiLuFeng,
  type DuiduanDizhiJilu,
  type JiluQianmingMoshi,
  DhtJieDian,
  jiLuJianYouZhiWen,
  yanZhengJiLuFeng,
} from './dht.js';
import type { LianJieTiZi, TiziDangwei } from './ladder.js';

export type GuangBoYuanYin = 'startup' | 'address-changed' | 'creator-online' | 'manual';

/**
 * 「能不能主动拨出」的**两个独立信号**（附八.9）。
 *
 * 为什么要分开而不是一个布尔：
 *  · `dialable`        —— 对端**真的拨回来过**（DialabilityProbe 的最强证据，已验证）；
 *  · `naturalDialable` —— **地址事实**推出的天然可拨入候选（本机有全局单播 IPv6 ⇒ IPv6 无 NAT），
 *                        强度弱于前者（不等于"已验证公网可达"），但足以说明"我方不必被动等"。
 *
 * UI/日志需要分得清"是验证过还是只是地址事实"，所以两者在报告里都保留。
 */
export interface KeBoRuXinHaoJi {
  /** 对端真的拨回来了（已验证） */
  dialable?: boolean;
  /** 地址事实推出：天然可拨入候选（未经验证） */
  naturalDialable?: boolean;
}

export interface KeBoRuJieXiJieGuo extends KeBoRuXinHaoJi {
  /** 是否允许主动拨出（两个信号任一为真） */
  canDial: boolean;
  /** 依据来源（不合并两个信号的来历，便于日志/UI 区分） */
  basis: 'verified-dialable' | 'natural-address' | 'neither' | 'unspecified';
}

/**
 * 把 `canDial` 的输入（旧的布尔写法 / 新的两信号写法 / 不给）归一成
 * `{ canDial, dialable?, naturalDialable?, basis }`。**纯函数**，便于直接断言。
 *
 * 不给（undefined）= 默认允许主动拨（保持既有语义：不知道就不自我阉割）。
 */
export function jiexiKeBoRu(shuRu?: KeBoRuXinHaoJi | boolean): KeBoRuJieXiJieGuo {
  if (shuRu === undefined) return { canDial: true, basis: 'unspecified' };
  if (typeof shuRu === 'boolean') {
    return shuRu
      ? { dialable: true, canDial: true, basis: 'verified-dialable' }
      : { dialable: false, canDial: false, basis: 'neither' };
  }
  const dialable = shuRu.dialable === true;
  const naturalDialable = shuRu.naturalDialable === true;
  return {
    dialable,
    naturalDialable,
    canDial: dialable || naturalDialable,
    basis: dialable ? 'verified-dialable' : naturalDialable ? 'natural-address' : 'neither',
  };
}

export interface MingceChengyuan {
  zhiWen: string;
  nodeId?: string;
  bieMing?: string;
  /** 已知地址（没走 DHT 时的手工地址） */
  addresses?: { host: string; port: number; source?: 'dht' | 'lan' | 'manual' }[];
}

export interface GuangBoChangShi {
  /** 哪个成员 */
  zhiWen: string;
  kind: 'dial';
  ok: boolean;
  /** 恒为 0：宣告失败即放弃，不重试 */
  retries: number;
  rung?: TiziDangwei | null;
  detail?: string;
  at: number;
}

export interface BukeDaChengyuan {
  zhiWen: string;
  reason: string;
  /** C3 退化路径：等对方上线时反向宣告 */
  huiTui: 'wait-for-peer-announce';
  /**
   * 这条记录是**哪一种"不可拨入"**造成的（附八.9）：只有两个信号都为假时才会出现；
   * 有全局 IPv6（`natural-address`）时**不再**走这条路径（那是被修正掉的误判）。
   */
  canDialBasis?: KeBoRuJieXiJieGuo['basis'];
}

export interface GuangBoBaoGao {
  reason: GuangBoYuanYin;
  /** 自己的记录发布结果 */
  published: { key: string; seq: number; storedOn: DhtDiZhi[]; address: DhtDiZhi };
  /** 本次对名册成员的**单次**尝试（无重试） */
  attempts: GuangBoChangShi[];
  connected: string[];
  unreachable: BukeDaChengyuan[];
  /** 因本机不可拨入而跳过的主动连接 */
  skippedNotDialable: string[];
  /** 本次宣告的 canDial 判据（两个信号分开保留，附八.9） */
  canDial: KeBoRuJieXiJieGuo;
  durationMs: number;
  at: number;
}

export interface RuXiangGonggao {
  ok: boolean;
  zhiWen?: string;
  address?: DhtDiZhi;
  chongfu?: boolean;
  /** 是否在本群名册内 */
  authorized?: boolean;
  connected?: boolean;
  rung?: TiziDangwei | null;
  reason?: string;
  /** 判定"本机不可拨入"时的依据（附八.9；两个信号分别为 verified-dialable / natural-address / neither） */
  canDialBasis?: KeBoRuJieXiJieGuo['basis'];
}

/**
 * `refreshMs` 存在的理由（ADR 附三.2 的缺口）：
 * 附三.2 说「上线宣告 + IP 变了重新宣告」，但 DHT 记录还有**新鲜度上限**
 * （`DEFAULT_RECORD_TTL_MS`，默认 30 分钟）—— 长期在线的节点若不刷新，
 * 后来上线的对端会认为它的记录过期而查不到地址。
 * 因此提供一个**显式的、可关闭的**保活刷新：默认关闭，接线方按 TTL/2 左右开启。
 * 这与「宣告失败即放弃」不冲突：那是"不为失败重试"，这是"记录保活"。
 */
export interface GuangBoFuWuXuanXiang {
  nodeId: string;
  identity: ShenfenGongyingshang | GuifanShenfen;
  groupId: string;
  groupKey: Buffer;
  dht: DhtJieDian;
  ladder?: LianJieTiZi;
  /** 本群名册（宣告与授权都用它） */
  roster: () => MingceChengyuan[];
  /** 本机 TCP 监听地址（写进宣告记录） */
  listenAddr: () => DhtDiZhi;
  /** 地址性质 */
  scope?: () => DuiduanDizhiJilu['scope'];
  signing?: JiluQianmingMoshi;
  /**
   * 是否可主动拨出（C1）。
   * 输入可以是旧布尔（`() => true`），也可以是两个信号（`() => ({ dialable, naturalDialable })`）——
   * **有全局 IPv6 的机器必须算"可拨出"**（附八.9），所以不要只认 `dialable === true`。
   */
  canDial?: () => KeBoRuXinHaoJi | boolean;
  /** 自定义建连（默认走阶梯）；返回 ok 表示已建立 */
  connect?: (member: MingceChengyuan, addresses: { host: string; port: number; source: 'dht' | 'lan' | 'manual' }[]) => Promise<{ ok: boolean; rung?: TiziDangwei | null; detail?: string }>;
  onPeerAnnouncement?: (a: RuXiangGonggao, env: DhtJiLuFeng, from: DhtDiZhi | null) => void;
  onConnectResult?: (a: GuangBoChangShi) => void;
  onUnreachable?: (u: BukeDaChengyuan) => void;
  /** DHT 记录保活间隔（默认 0 = 关闭，只在上线/地址变化时宣告） */
  refreshMs?: number;
  now?: () => number;
}

export class GuangBoFuWu {
  private readonly attemptsLog: GuangBoChangShi[] = [];
  private readonly unreachableLog: BukeDaChengyuan[] = [];
  private readonly inboundAcceptedLog: RuXiangGonggao[] = [];
  private readonly inboundRejectedLog: RuXiangGonggao[] = [];
  private readonly seenAnnouncements = new Set<string>();
  private stopWatchers: (() => void)[] = [];
  private announceCalls = 0;
  private refreshTimer?: NodeJS.Timeout;
  private readonly selfFingerprint: string;

  constructor(private readonly opts: GuangBoFuWuXuanXiang) {
    this.selfFingerprint = typeof opts.identity.zhiWen === 'string' ? opts.identity.zhiWen : '';
  }

  get attempts(): readonly GuangBoChangShi[] {
    return this.attemptsLog;
  }
  get unreachable(): readonly BukeDaChengyuan[] {
    return this.unreachableLog;
  }
  get inboundAccepted(): readonly RuXiangGonggao[] {
    return this.inboundAcceptedLog;
  }
  get inboundRejected(): readonly RuXiangGonggao[] {
    return this.inboundRejectedLog;
  }
  get callCount(): number {
    return this.announceCalls;
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  private rosterOf(fp: string): MingceChengyuan | undefined {
    return this.opts.roster().find((m) => m.zhiWen === fp);
  }

  private addressCandidates(member: MingceChengyuan, fromDht?: DuiduanDizhiJilu): { host: string; port: number; source: 'dht' | 'lan' | 'manual' }[] {
    const out: { host: string; port: number; source: 'dht' | 'lan' | 'manual' }[] = [];
    if (fromDht) out.push({ host: fromDht.host, port: fromDht.port, source: 'dht' });
    for (const a of member.addresses ?? []) out.push({ host: a.host, port: a.port, source: a.source ?? 'manual' });
    return out;
  }

  /**
   * 上线宣告：① 发布/更新自己的 DHT 记录 ② 对名册成员各尝试**一次**连线。
   * 失败即放弃 → 记入 `unreachable`（fallback: wait-for-peer-announce）。
   */
  async announce(reason: GuangBoYuanYin = 'startup'): Promise<GuangBoBaoGao> {
    this.announceCalls += 1;
    const kaiShiShiJian = this.now();
    const myFingerprint = this.selfFingerprint;
    const address = this.opts.listenAddr();

    // ① 宣告"我在线 + 当前地址"（IP/端口变了就重新宣告，seq 递增）
    const published = await this.opts.dht.publish({
      zhiWen: myFingerprint,
      record: {
        fp: myFingerprint,
        host: address.host,
        port: address.port,
        scope: this.opts.scope?.() ?? 'lan',
        announcedAt: this.now(),
        bieMing: this.opts.nodeId,
      },
      signing: this.opts.signing,
    });

    // ② 对名册成员尝试一次（跳过自己）
    const attempts: GuangBoChangShi[] = [];
    const connected: string[] = [];
    const unreachable: BukeDaChengyuan[] = [];
    const skippedNotDialable: string[] = [];
    // 附八.9：`dialable`（已验证）与 `naturalDialable`（地址事实）**任一为真即可主动拨**；
    // 两个信号都保留在报告里，别在这里压成一个布尔丢掉来历。
    const keBoRuJieXiJieGuo = jiexiKeBoRu(this.opts.canDial?.());

    for (const member of this.opts.roster()) {
      if (member.zhiWen === myFingerprint) continue;
      if (!keBoRuJieXiJieGuo.canDial) {
        // C1：本机确实不可拨入（既没被对端验证过，也没有 IPv6 这类天然可拨入地址）→ 不主动拨，等对方拨入
        skippedNotDialable.push(member.zhiWen);
        const u: BukeDaChengyuan = {
          zhiWen: member.zhiWen,
          reason: '本机不可拨入（既无对端验证，也无天然可拨入地址）→ 不主动探测，等待对方上线宣告/拨入',
          huiTui: 'wait-for-peer-announce',
          canDialBasis: keBoRuJieXiJieGuo.basis,
        };
        unreachable.push(u);
        this.unreachableLog.push(u);
        this.opts.onUnreachable?.(u);
        continue;
      }
      // 解析当前地址（DHT 优先；查不到就用名册里的手工地址）
      let resolved: DuiduanDizhiJilu | undefined;
      try {
        const q = await this.opts.dht.query(member.zhiWen, { requireDecrypt: true });
        if (q.ok) resolved = q.record;
      } catch {
        /* 查不到就用手工地址 */
      }
      const addresses = this.addressCandidates(member, resolved);
      const attempt: GuangBoChangShi = {
        zhiWen: member.zhiWen,
        kind: 'dial',
        ok: false,
        retries: 0,
        at: this.now(),
      };
      if (addresses.length === 0) {
        attempt.detail = 'DHT 无记录且名册无手工地址 → 放弃（等对方宣告）';
        attempts.push(attempt);
        this.finishAttempt(attempt, unreachable);
        continue;
      }
      const result = await this.connectTo(member, addresses, attempt);
      attempts.push(result);
      this.finishAttempt(result, unreachable);
      if (result.ok) connected.push(member.zhiWen);
    }

    this.attemptsLog.push(...attempts);
    return {
      reason,
      published: { key: published.key, seq: published.seq, storedOn: published.storedOn, address },
      attempts,
      connected,
      unreachable,
      skippedNotDialable,
      canDial: keBoRuJieXiJieGuo,
      durationMs: this.now() - kaiShiShiJian,
      at: kaiShiShiJian,
    };
  }

  private async connectTo(
    member: MingceChengyuan,
    addresses: { host: string; port: number; source: 'dht' | 'lan' | 'manual' }[],
    attempt: GuangBoChangShi
  ): Promise<GuangBoChangShi> {
    try {
      let r: { ok: boolean; rung?: TiziDangwei | null; detail?: string };
      if (this.opts.connect) {
        r = await this.opts.connect(member, addresses);
      } else if (this.opts.ladder) {
        const tiziJieguo = await this.opts.ladder.connect({
          zhiWen: member.zhiWen,
          nodeId: member.nodeId,
          addresses,
        });
        r = { ok: tiziJieguo.ok, rung: tiziJieguo.rung, detail: tiziJieguo.summary };
      } else {
        r = { ok: false, detail: '未提供连接方式（ladder / connect）' };
      }
      return { ...attempt, ok: r.ok, rung: r.rung ?? null, detail: r.detail, at: this.now() };
    } catch (e) {
      return { ...attempt, ok: false, detail: `连接异常：${(e as Error).message ?? String(e)}`, at: this.now() };
    }
  }

  private finishAttempt(attempt: GuangBoChangShi, unreachable: BukeDaChengyuan[]): void {
    this.opts.onConnectResult?.(attempt);
    if (!attempt.ok) {
      const u: BukeDaChengyuan = {
        zhiWen: attempt.zhiWen,
        reason: attempt.detail ?? '连接失败',
        huiTui: 'wait-for-peer-announce',
      };
      unreachable.push(u);
      this.unreachableLog.push(u);
      this.opts.onUnreachable?.(u);
    }
  }

  /**
   * 订阅名册成员的宣告键（事件驱动；**无轮询**）。
   * 返回退订函数。
   */
  watchRoster(): () => void {
    const stop = this.opts.dht.watch('*', (env, from) => {
      void this.handleAnnouncement(env, from);
    });
    this.stopWatchers.push(stop);
    return stop;
  }

  unwatch(): void {
    for (const s of this.stopWatchers) s();
    this.stopWatchers = [];
  }

  /**
   * DHT 记录保活刷新（默认不开启；`refreshMs > 0` 才有效）。
   * 只重新发布自己的记录（幂等），**不重新尝试连接失败的成员**（那仍然是"失败即放弃"）。
   */
  startRefresh(): void {
    const ms = this.opts.refreshMs ?? 0;
    if (ms <= 0 || this.refreshTimer) return;
    this.refreshTimer = setInterval(() => {
      void this.announce('address-changed').catch(() => {
        /* 刷新失败不抛出：DHT 侧还会在下次宣告时重试 */
      });
    }, ms);
    this.refreshTimer.unref?.();
  }

  stopRefresh(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = undefined;
  }

  /** 收到他人宣告：验签 + 名册授权 + （可拨入时）建连 */
  async handleAnnouncement(env: DhtJiLuFeng, from: DhtDiZhi | null = null): Promise<RuXiangGonggao> {
    const key = env.k;
    const quchongMiyao = `${key}:${env.s}`;
    const chongfu = this.seenAnnouncements.has(quchongMiyao);
    const yiYanZheng = await yanZhengJiLuFeng(env, {
      groupKeys: this.opts.dht.groupKeys,
      requireDecrypt: true,
      now: this.opts.now,
    });
    if (!yiYanZheng.ok || !yiYanZheng.record) {
      const juJue: RuXiangGonggao = { ok: false, chongfu, reason: `记录不可用：${yiYanZheng.reason ?? 'unknown'} ${yiYanZheng.detail ?? ''}`.trim() };
      this.inboundRejectedLog.push(juJue);
      this.opts.onPeerAnnouncement?.(juJue, env, from);
      return juJue;
    }
    const record = yiYanZheng.record;
    if (record.fp === this.selfFingerprint) {
      // 自己的记录（自己发布时也会触发 watch）：静默忽略，不记进拒绝日志
      return { ok: false, chongfu, zhiWen: record.fp, reason: '自己发布的记录（忽略）' };
    }
    if (key !== jiLuJianYouZhiWen(record.fp)) {
      const juJue: RuXiangGonggao = { ok: false, chongfu, zhiWen: record.fp, reason: '记录键与被宣告指纹不符（键/内容不一致）' };
      this.inboundRejectedLog.push(juJue);
      this.opts.onPeerAnnouncement?.(juJue, env, from);
      return juJue;
    }
    const member = this.rosterOf(record.fp);
    if (!member) {
      const juJue: RuXiangGonggao = {
        ok: false,
        chongfu,
        zhiWen: record.fp,
        authorized: false,
        reason: `对方指纹 ${record.fp.slice(0, 12)}… 不在本群名册内 → 不建连`,
        address: { host: record.host, port: record.port },
      };
      this.inboundRejectedLog.push(juJue);
      this.opts.onPeerAnnouncement?.(juJue, env, from);
      return juJue;
    }

    this.seenAnnouncements.add(quchongMiyao);
    const base: RuXiangGonggao = {
      ok: true,
      chongfu,
      zhiWen: record.fp,
      authorized: true,
      address: { host: record.host, port: record.port },
    };
    if (chongfu) {
      // 同一条宣告（同 seq）重复到达：只登记地址，不重复建连
      const zhongFu: RuXiangGonggao = { ...base, connected: false, reason: '同 seq 宣告重复（已处理过）→ 只更新地址' };
      this.inboundAcceptedLog.push(zhongFu);
      this.opts.onPeerAnnouncement?.(zhongFu, env, from);
      return zhongFu;
    }

    // 附八.9：这里**同样**要认 `naturalDialable`（有全局 IPv6 ⇒ 天然可拨入），
    // 否则有 IPv6 的机器收到宣告后会只登记地址、白白放弃一次可直连的机会。
    const keBoRuJieXiJieGuo = jiexiKeBoRu(this.opts.canDial?.());
    if (!keBoRuJieXiJieGuo.canDial) {
      // C1：本机确实不可拨入 → 只登记地址，等对方拨入（不主动拨）
      const res: RuXiangGonggao = {
        ...base,
        connected: false,
        reason: '本机不可拨入（既无对端验证，也无天然可拨入地址）→ 只登记地址，等待对方拨入（C1）',
        canDialBasis: keBoRuJieXiJieGuo.basis,
      };
      this.inboundAcceptedLog.push(res);
      this.opts.onPeerAnnouncement?.(res, env, from);
      return res;
    }

    const addresses = this.addressCandidates(member, record);
    const attempt: GuangBoChangShi = { zhiWen: record.fp, kind: 'dial', ok: false, retries: 0, at: this.now() };
    const result = await this.connectTo(member, addresses, attempt);
    this.attemptsLog.push(result);
    this.opts.onConnectResult?.(result);
    const res: RuXiangGonggao = {
      ...base,
      connected: result.ok,
      rung: result.rung ?? null,
      reason: result.ok ? '建连成功' : `建连失败：${result.detail ?? ''}（对方上线时也会宣告，故不重试）`,
    };
    this.inboundAcceptedLog.push(res);
    this.opts.onPeerAnnouncement?.(res, env, from);
    return res;
  }
}

/* ────────────────────────────── 地址变化监视 ────────────────────────────── */

/**
 * 本机地址变化监视：**重新宣告的触发器**。
 * ADR 附三.2 只说"IP 变了 = 重新宣告"，没写清"IP 变化怎么被发现"——这里是那一环。
 * 注意：NAT 外部映射的变化**本机看不见**（接口没变），只能从对端观察到的地址得知
 * （见 `SecureSession.info.remoteAddress` / autonat 拨回），这一点在报告里标注。
 */
export class DizhiJiantingqi {
  private jiShiQi?: NodeJS.Timeout;
  private last: string;

  constructor(
    private readonly opts: {
      /** 采样函数：返回"当前对外地址"的规范化字符串 */
      sample: () => string;
      onChange: (info: { prev: string; next: string; at: number }) => void;
      intervalMs?: number;
      now?: () => number;
    }
  ) {
    this.last = opts.sample();
  }

  get current(): string {
    return this.last;
  }

  /** 单次检查（测试可直接调用；无需真的等定时器） */
  check(): boolean {
    const next = this.opts.sample();
    if (next === this.last) return false;
    const prev = this.last;
    this.last = next;
    this.opts.onChange({ prev, next, at: this.opts.now ? this.opts.now() : Date.now() });
    return true;
  }

  start(): void {
    if (this.jiShiQi) return;
    const jiange = this.opts.intervalMs ?? 15_000;
    this.jiShiQi = setInterval(() => this.check(), jiange);
    this.jiShiQi.unref?.();
  }

  stop(): void {
    if (this.jiShiQi) clearInterval(this.jiShiQi);
    this.jiShiQi = undefined;
  }
}
