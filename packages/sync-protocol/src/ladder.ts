/**
 * ladder —— 连接阶梯（逐级降级）+ 同网局域网探测
 *
 * ADR 003 D2 的阶梯顺序（本实现在此顺序上逐级尝试，命中即停）：
 *   1. `public-direct` 公网直连（拨对方宣告的地址）—— **已实现（真实 TCP）**
 *   2. `upnp`          路由器自动映射（UPnP / NAT-PMP / PCP）—— **未实现**
 *   3. `holepunch`     STUN + 同时打洞 —— **未实现**
 *   4. `relay`         中继兜底 —— **未实现**（协议与中继服务都不存在）
 *   5. `lan`           同网局域网（UDP 探测）—— **已实现（真实 UDP）**
 * 未实现的级会**明确标注 unsupported + 原因**，不假装成功（诚实要求）。
 * 每一级都有超时上限，整条阶梯不会无限重试。
 *
 * `LanProbe` 与既有 `LanDiscovery` 的区别：
 *  - `LanDiscovery` 是"收到 HELLO 就回调"，绑定固定端口 7799；
 *  - `LanProbe` 支持**主动单播探测指定地址**（本机多实例、跨子网也能测），
 *    并可选广播探测（多台真机同网时用同一 discoveryPort）。
 *  注意（实测结论）：**同一台机器上两个 socket 绑同一 UDP 端口时，
 *  Windows 只把报文投递给其中一个**（本仓库验证脚本内有该结论），
 *  所以本机双实例只能用单播路径验证，广播路径需要两台真机。
 */
import dgram from 'node:dgram';
import net from 'node:net';

export const LAN_PROBE_MAGIC = 'CCARMY-LAN/1';
export const DEFAULT_DISCOVERY_PORT = 7799;

export interface LanPeer {
  nodeId: string;
  fingerprint: string;
  host: string;
  port: number;
  seenAt: number;
}

export interface LanProbeOptions {
  nodeId: string;
  fingerprint: string;
  /** 本机 TCP 服务端口（回给探测方） */
  tcpPort: number;
  /** 探测端口；默认 7799（与 LanDiscovery 一致，便于多机同网广播） */
  discoveryPort?: number;
  listenHost?: string;
  onPeer?: (p: LanPeer) => void;
}

export class LanProbe {
  private sock: dgram.Socket | null = null;
  private boundPort = 0;
  private peers = new Map<string, LanPeer>();
  private pending = new Map<string, () => void>();
  private responses = new Map<string, LanPeer[]>();
  private readonly discoveryPort: number;

  constructor(private readonly opts: LanProbeOptions) {
    this.discoveryPort = opts.discoveryPort ?? DEFAULT_DISCOVERY_PORT;
  }

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      this.sock = sock;
      sock.on('error', reject);
      sock.on('message', (msg, rinfo) => this.onMessage(msg, rinfo.address, rinfo.port));
      sock.bind({ port: this.discoveryPort, address: this.opts.listenHost ?? '0.0.0.0' }, () => {
        this.boundPort = sock.address().port;
        try {
          sock.setBroadcast(true);
        } catch {
          /* 某些环境不允许，广播路径自动失效 */
        }
        resolve(this.boundPort);
      });
    });
  }

  get port(): number {
    return this.boundPort;
  }
  get knownPeers(): LanPeer[] {
    return [...this.peers.values()];
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.sock) return resolve();
      const s = this.sock;
      this.sock = null;
      s.close(() => resolve());
    });
  }

  /** 主动探测：单播给 targets +（可选）广播到指定端口列表 */
  query(opts: { targets?: { host: string; port: number }[]; broadcastPorts?: number[]; timeoutMs?: number } = {}): Promise<LanPeer[]> {
    const timeoutMs = opts.timeoutMs ?? 600;
    const req = `${Math.random().toString(36).slice(2, 10)}`;
    const payload = Buffer.from(
      JSON.stringify({
        v: 1,
        req,
        nodeId: this.opts.nodeId,
        fingerprint: this.opts.fingerprint,
        tcpPort: this.opts.tcpPort,
      }),
      'utf8'
    );
    const wire = Buffer.concat([Buffer.from(`${LAN_PROBE_MAGIC} `, 'utf8'), payload]);
    const collected = new Map<string, LanPeer>();
    return new Promise<LanPeer[]>((resolve) => {
      this.pending.set(req, () => {
        for (const p of this.responses.get(req) ?? []) collected.set(`${p.fingerprint}@${p.host}:${p.port}`, p);
        this.responses.delete(req);
        resolve([...collected.values()]);
      });
      this.responses.set(req, []);
      for (const t of opts.targets ?? []) {
        try {
          this.sock?.send(wire, t.port, t.host);
        } catch {
          /* ignore */
        }
      }
      for (const port of opts.broadcastPorts ?? []) {
        for (const addr of ['255.255.255.255', '127.255.255.255']) {
          try {
            this.sock?.send(wire, port, addr);
          } catch {
            /* ignore */
          }
        }
      }
      setTimeout(() => {
        const cb = this.pending.get(req);
        if (cb) {
          this.pending.delete(req);
          cb();
        }
      }, timeoutMs).unref?.();
    });
  }

  /** 只广播（不等待） */
  broadcast(port = this.discoveryPort): void {
    const payload = Buffer.from(
      JSON.stringify({ v: 1, req: 'bcast', nodeId: this.opts.nodeId, fingerprint: this.opts.fingerprint, tcpPort: this.opts.tcpPort }),
      'utf8'
    );
    const wire = Buffer.concat([Buffer.from(`${LAN_PROBE_MAGIC} `, 'utf8'), payload]);
    for (const addr of ['255.255.255.255', '127.255.255.255']) {
      try {
        this.sock?.send(wire, port, addr);
      } catch {
        /* ignore */
      }
    }
  }

  private onMessage(msg: Buffer, host: string, port: number): void {
    const s = msg.toString('utf8');
    if (!s.startsWith(LAN_PROBE_MAGIC)) return;
    let j: { req?: string; res?: string; nodeId?: string; fingerprint?: string; tcpPort?: number };
    try {
      j = JSON.parse(s.slice(LAN_PROBE_MAGIC.length + 1)) as typeof j;
    } catch {
      return;
    }
    if (j.res) {
      const list = this.responses.get(j.res);
      if (!list) return;
      const peer: LanPeer = {
        nodeId: j.nodeId ?? 'unknown',
        fingerprint: j.fingerprint ?? '',
        host,
        port: j.tcpPort ?? 0,
        seenAt: Date.now(),
      };
      list.push(peer);
      this.peers.set(peer.fingerprint || `${host}:${port}`, peer);
      this.opts.onPeer?.(peer);
      return;
    }
    if (!j.req) return;
    if (j.fingerprint === this.opts.fingerprint) return; // 自己
    const reply = Buffer.concat([
      Buffer.from(`${LAN_PROBE_MAGIC} `, 'utf8'),
      Buffer.from(
        JSON.stringify({
          v: 1,
          res: j.req,
          nodeId: this.opts.nodeId,
          fingerprint: this.opts.fingerprint,
          tcpPort: this.opts.tcpPort,
        }),
        'utf8'
      ),
    ]);
    try {
      this.sock?.send(reply, port, host);
    } catch {
      /* ignore */
    }
    const peer: LanPeer = { nodeId: j.nodeId ?? 'unknown', fingerprint: j.fingerprint ?? '', host, port: j.tcpPort ?? 0, seenAt: Date.now() };
    this.peers.set(peer.fingerprint || `${host}:${port}`, peer);
    this.opts.onPeer?.(peer);
  }
}

/* ────────────────────────────── 连接阶梯 ────────────────────────────── */

export type LadderRung = 'public-direct' | 'upnp' | 'holepunch' | 'relay' | 'lan';

export const DEFAULT_LADDER_ORDER: LadderRung[] = ['public-direct', 'upnp', 'holepunch', 'relay', 'lan'];

export const LADDER_LABELS: Record<LadderRung, string> = {
  'public-direct': '公网直连',
  upnp: '路由器自动映射（UPnP/NAT-PMP/PCP）',
  holepunch: '打洞（STUN + 同时打洞）',
  relay: '中继兜底',
  lan: '同网局域网',
};

export interface LadderAddress {
  host: string;
  port: number;
  source: 'dht' | 'lan' | 'manual';
}

export interface LadderTarget {
  fingerprint: string;
  nodeId?: string;
  addresses: LadderAddress[];
}

export type RungStatus = 'ok' | 'failed' | 'unsupported' | 'skipped';

export interface RungAttempt {
  rung: LadderRung;
  label: string;
  status: RungStatus;
  ms: number;
  detail?: string;
  address?: { host: string; port: number };
}

export interface LadderResult {
  ok: boolean;
  rung: LadderRung | null;
  address?: { host: string; port: number };
  attempts: RungAttempt[];
  /** 全部失败时的结论文案（UI 可直接用） */
  summary: string;
}

export interface RungContext {
  target: LadderTarget;
  timeoutMs: number;
  dialTcp: (host: string, port: number, timeoutMs: number) => Promise<{ ok: boolean; detail?: string }>;
  log: (msg: string) => void;
}

export interface LadderStrategy {
  rung: LadderRung;
  supported: boolean;
  unsupportedReason?: string;
  attempt(ctx: RungContext): Promise<{ ok: boolean; detail?: string; address?: { host: string; port: number } }>;
}

function unsupportedStrategy(rung: LadderRung, reason: string): LadderStrategy {
  return {
    rung,
    supported: false,
    unsupportedReason: reason,
    async attempt() {
      return { ok: false, detail: reason };
    },
  };
}

export interface ConnectionLadderOptions {
  strategies?: Partial<Record<LadderRung, LadderStrategy>>;
  order?: LadderRung[];
  perRungTimeoutMs?: number;
  dialTcp?: (host: string, port: number, timeoutMs: number) => Promise<{ ok: boolean; detail?: string }>;
  /** LAN 探测提供者（默认用注入的 LanProbe） */
  lanProbe?: LanProbe;
  lanTargets?: () => { host: string; port: number }[];
  lanBroadcastPorts?: number[];
  onRung?: (a: RungAttempt) => void;
  now?: () => number;
}

/**
 * 默认 TCP 拨号：真实 net.connect。
 * 这里只判断"能不能连上"，**不在此处做握手**（握手由 SecureSyncClient 负责）。
 */
export async function dialTcpDefault(host: string, port: number, timeoutMs: number): Promise<{ ok: boolean; detail?: string }> {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const done = (ok: boolean, detail?: string): void => {
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      resolve({ ok, detail });
    };
    sock.once('connect', () => done(true, 'TCP 连接成功'));
    sock.once('error', (e: Error) => done(false, `TCP 失败：${e.message}`));
    sock.setTimeout(timeoutMs, () => done(false, `TCP 超时 ${timeoutMs}ms`));
  });
}

export class ConnectionLadder {
  private readonly order: LadderRung[];
  private readonly perRungTimeoutMs: number;
  private readonly dialTcp: (host: string, port: number, timeoutMs: number) => Promise<{ ok: boolean; detail?: string }>;
  private readonly strategies = new Map<LadderRung, LadderStrategy>();
  private readonly now: () => number;
  /** 每一级的尝试历史（可观测性） */
  readonly history: RungAttempt[] = [];

  constructor(private readonly opts: ConnectionLadderOptions = {}) {
    this.order = opts.order ?? DEFAULT_LADDER_ORDER;
    this.perRungTimeoutMs = opts.perRungTimeoutMs ?? 3000;
    this.dialTcp = opts.dialTcp ?? dialTcpDefault;
    this.now = opts.now ?? (() => Date.now());

    const publicDirect: LadderStrategy = {
      rung: 'public-direct',
      supported: true,
      async attempt(ctx) {
        if (ctx.target.addresses.length === 0) return { ok: false, detail: '没有可用地址（DHT 未宣告 / 未提供）' };
        const errors: string[] = [];
        for (const addr of ctx.target.addresses) {
          const r = await ctx.dialTcp(addr.host, addr.port, ctx.timeoutMs);
          if (r.ok) return { ok: true, address: { host: addr.host, port: addr.port }, detail: `${addr.host}:${addr.port} 可直连（来源 ${addr.source}）` };
          errors.push(`${addr.host}:${addr.port} ${r.detail ?? '失败'}`);
        }
        return { ok: false, detail: errors.join(' / ') };
      },
    };

    const lan: LadderStrategy = {
      rung: 'lan',
      supported: true,
      async attempt(ctx) {
        const probe = opts.lanProbe;
        if (!probe) return { ok: false, detail: '未提供 LanProbe（无法做同网探测）' };
        const peers = await probe.query({
          targets: opts.lanTargets?.() ?? [],
          broadcastPorts: opts.lanBroadcastPorts ?? [],
          timeoutMs: Math.min(ctx.timeoutMs, 800),
        });
        const hit = peers.filter((p) => p.fingerprint === ctx.target.fingerprint);
        if (hit.length === 0) {
          return {
            ok: false,
            detail: `同网探测未找到 ${ctx.target.fingerprint.slice(0, 12)}…（单播 ${opts.lanTargets?.().length ?? 0} 个目标 / 广播 ${(opts.lanBroadcastPorts ?? []).length} 个端口）`,
          };
        }
        // 同一对端可能从多个地址被发现（LAN IP + 回环），逐个试到能连上为止
        const errors: string[] = [];
        for (const p of hit) {
          const r = await ctx.dialTcp(p.host, p.port, ctx.timeoutMs);
          if (r.ok) return { ok: true, address: { host: p.host, port: p.port }, detail: `同网发现 ${p.host}:${p.port}` };
          errors.push(`${p.host}:${p.port} ${r.detail ?? '失败'}`);
        }
        return { ok: false, detail: `同网发现 ${hit.length} 个候选地址但都连不上：${errors.join(' / ')}` };
      },
    };

    this.strategies.set('public-direct', opts.strategies?.['public-direct'] ?? publicDirect);
    this.strategies.set('lan', opts.strategies?.lan ?? lan);
    this.strategies.set(
      'upnp',
      opts.strategies?.upnp ??
        unsupportedStrategy('upnp', '未实现：UPnP/SSDP 与 NAT-PMP/PCP 需要额外依赖或原生模块（本项目零依赖约束）')
    );
    this.strategies.set(
      'holepunch',
      opts.strategies?.holepunch ?? unsupportedStrategy('holepunch', '未实现：真实 STUN 服务器与同时打洞需要公网对端，本仓库无 STUN 客户端')
    );
    this.strategies.set('relay', opts.strategies?.relay ?? unsupportedStrategy('relay', '未实现：ADR 未定义中继协议，也无中继服务可部署'));
  }

  strategyFor(rung: LadderRung): LadderStrategy | undefined {
    return this.strategies.get(rung);
  }

  /** 逐级降级：命中即停；未实现的级标注 unsupported 并继续下一级 */
  async connect(target: LadderTarget): Promise<LadderResult> {
    const attempts: RungAttempt[] = [];
    for (const rung of this.order) {
      const strat = this.strategies.get(rung);
      const startedAt = this.now();
      if (!strat) {
        attempts.push({ rung, label: LADDER_LABELS[rung], status: 'skipped', ms: 0, detail: '未注册该级策略' });
        continue;
      }
      if (!strat.supported) {
        const a: RungAttempt = {
          rung,
          label: LADDER_LABELS[rung],
          status: 'unsupported',
          ms: 0,
          detail: strat.unsupportedReason ?? '未实现',
        };
        attempts.push(a);
        this.history.push(a);
        this.opts.onRung?.(a);
        continue;
      }
      const ctx: RungContext = {
        target,
        timeoutMs: this.perRungTimeoutMs,
        dialTcp: this.dialTcp,
        log: () => {},
      };
      let outcome: { ok: boolean; detail?: string; address?: { host: string; port: number } };
      try {
        outcome = await strat.attempt(ctx);
      } catch (e) {
        outcome = { ok: false, detail: `策略异常：${(e as Error).message ?? String(e)}` };
      }
      const a: RungAttempt = {
        rung,
        label: LADDER_LABELS[rung],
        status: outcome.ok ? 'ok' : 'failed',
        ms: this.now() - startedAt,
        detail: outcome.detail,
        address: outcome.address,
      };
      attempts.push(a);
      this.history.push(a);
      this.opts.onRung?.(a);
      if (outcome.ok) {
        return { ok: true, rung, address: outcome.address, attempts, summary: `已连接（${LADDER_LABELS[rung]}）：${outcome.detail ?? ''}` };
      }
    }
    const missing = attempts.filter((a) => a.status === 'unsupported').map((a) => LADDER_LABELS[a.rung]);
    return {
      ok: false,
      rung: null,
      attempts,
      summary: missing.length
        ? `全部可用方式均失败；未实现的降级路径：${missing.join('、')}（详见 attempts）`
        : '全部可用方式均失败（详见 attempts）',
    };
  }
}
