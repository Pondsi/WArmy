/**
 * ladder —— 连接阶梯（逐级降级）+ 同网局域网探测 + IPv6 地址族选择
 *
 * ADR 003 附八.9 定的阶梯顺序（本实现在此顺序上逐级尝试，命中即停）：
 *   1. `ipv6-direct`   **IPv6 公网直连**（全局单播地址；IPv6 无 NAT ⇒ 天然可拨入）
 *      —— **已实现（真实 TCP over IPv6，socket 自报 remoteFamily=IPv6）**
 *   2. `public-direct` IPv4 公网直连（拨对方宣告的地址）—— **已实现（真实 TCP）**
 *   3. `upnp`          路由器自动映射（UPnP / NAT-PMP / PCP）—— **未实现**
 *   4. `holepunch`     STUN + 同时打洞 —— **未实现**
 *   5. `relay`         中继兜底（双 CGNAT 唯一出路）—— **已实现（真实转发，见 relay.ts）**
 *   6. `lan`           同网局域网（UDP 探测）—— **已实现（真实 UDP）**
 * 未实现的级会**明确标注 unsupported + 原因**，不假装成功（诚实要求）。
 * 每一级都有超时上限，整条阶梯不会无限重试。
 *
 * 为什么 IPv6 必须**单列一档**（附八.9）：IPv6 在拿到公网前缀时**没有 NAT**，
 * 所以"IPv6 可达"的机器是**天然可拨入**的 —— 这是整条打洞/中继阶梯里**成本最低的一档**，
 * 有 IPv6 的用户根本不需要打洞，也不该被误判成"非公网、不可组网"。
 *
 * `LanProbe` 与既有 `LanDiscovery` 的区别：
 *  - `LanDiscovery` 是"收到 HELLO 就回调"，绑定固定端口 7799；
 *  - `LanProbe` 支持**主动单播探测指定地址**（本机多实例、跨子网也能测），
 *    并可选广播探测（多台真机同网时用同一 discoveryPort）。
 *  注意（实测结论）：**同一台机器上两个 socket 绑同一 UDP 端口时，
 *  Windows 只把报文投递给其中一个**（本仓库验证脚本内有该结论），
 *  所以本机双实例只能用单播路径验证（**不同端口**），广播路径需要两台真机。
 */
import dgram from 'node:dgram';
import net from 'node:net';
import os from 'node:os';
import type { DhtDiZhi } from './dht.js';
import { type RelayCandidateRef, type RelayDecision, type RelayDecisionCode, jueDingZhongJi, relayTokenFor } from './relay.js';

export const LAN_PROBE_MAGIC = 'WARMY-LAN/1';
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

/* ────────────────────────────── IPv6 地址族（附八.9） ────────────────────────────── */

/**
 * IPv6 作用域分类。**判据是数值范围，不是字符串前缀**：
 *  · `2000::/3`  全局单播 → 唯一算"公网可达候选"的（IPv6 无 NAT）
 *  · `fc00::/7`  ULA（唯一本地地址）→ **不算**公网候选（等价 IPv4 私网）
 *  · `fe80::/10` 链路本地 → **不算**（只能同链路）
 *  · `::1`       回环 → **不算**
 *  · `ff00::/8`  组播 / `::` 未指定 → **不算**
 */
export type Ipv6Scope = 'global' | 'ula' | 'link-local' | 'loopback' | 'unspecified' | 'multicast' | 'ipv4-mapped' | 'invalid';

/** 2001:db8::/32 是**文档用**地址段：形式上属 2000::/3，但绝不能当成"公网可达候选" */
export const IPV6_DOCUMENTATION_PREFIX = '2001:0db8';

/** 去掉方括号与 zone id（`fe80::1%eth0` / `%12`）—— 客户端拨号必须去掉 zone */
export function normalizeHostLiteral(host: string): string {
  let h = String(host ?? '').trim();
  if (h.startsWith('[')) h = h.replace(/^\[/, '').replace(/\]$/, '');
  const pct = h.indexOf('%');
  if (pct >= 0) h = h.slice(0, pct);
  return h;
}

export function parseIpv4Bytes(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(host ?? '').trim());
  if (!m) return null;
  const bytes = m.slice(1).map((x) => Number(x));
  return bytes.every((b) => b >= 0 && b <= 255) ? bytes : null;
}

function hexGroups(arr: string[]): number[] | null {
  const out: number[] = [];
  for (const g of arr) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out;
}

/** 解析 IPv6 字面量为 16 字节；非法返回 null（支持 `::` 压缩与内嵌 IPv4） */
export function parseIpv6(host: string): Uint8Array | null {
  let h = normalizeHostLiteral(host);
  if (!h.includes(':')) return null;
  let embedded: number[] | null = null;
  if (h.includes('.')) {
    const lc = h.lastIndexOf(':');
    const v4 = parseIpv4Bytes(h.slice(lc + 1));
    if (!v4) return null;
    embedded = v4;
    h = h.slice(0, lc);
  }
  const dc = h.indexOf('::');
  if (dc >= 0 && h.indexOf('::', dc + 1) >= 0) return null; // 只能压缩一次
  let head: string[];
  let tail: string[];
  if (dc >= 0) {
    head = h.slice(0, dc).split(':').filter((s) => s !== '');
    tail = h
      .slice(dc + 2)
      .split(':')
      .filter((s) => s !== '');
  } else {
    head = h.split(':');
    tail = [];
  }
  const hb = hexGroups(head);
  const tb = hexGroups(tail);
  if (!hb || !tb) return null;
  const emb = embedded ? [(embedded[0] as number) * 256 + (embedded[1] as number), (embedded[2] as number) * 256 + (embedded[3] as number)] : [];
  let groups: number[];
  if (dc >= 0) {
    const total = hb.length + tb.length + emb.length;
    if (total > 7) return null; // `::` 至少要压掉 1 组
    groups = [...hb, ...new Array(8 - total).fill(0), ...tb, ...emb];
  } else {
    groups = [...hb, ...emb];
    if (groups.length !== 8) return null;
  }
  const out = new Uint8Array(16);
  groups.forEach((g, i) => {
    out[i * 2] = (g >> 8) & 0xff;
    out[i * 2 + 1] = g & 0xff;
  });
  return out;
}

/** 地址族：6 = IPv6，4 = IPv4，0 = 既不是字面 IP（域名/主机名） */
export function ipFamilyOfHost(host: string): 4 | 6 | 0 {
  const h = normalizeHostLiteral(host);
  if (parseIpv4Bytes(h)) return 4;
  if (parseIpv6(h)) return 6;
  return 0;
}

export function guiLeiIpv6ZuoYongYu(host: string): Ipv6Scope {
  const b = parseIpv6(host);
  if (!b) return 'invalid';
  const allZero = b.every((x) => x === 0);
  if (allZero) return 'unspecified';
  if (b.subarray(0, 15).every((x) => x === 0) && b[15] === 1) return 'loopback';
  if (b[0] === 0xff) return 'multicast';
  if (b.subarray(0, 10).every((x) => x === 0) && b[10] === 0xff && b[11] === 0xff) return 'ipv4-mapped';
  if (b[0] === 0xfe && ((b[1] as number) & 0xc0) === 0x80) return 'link-local';
  if (((b[0] as number) & 0xfe) === 0xfc) return 'ula';
  if (((b[0] as number) & 0xe0) === 0x20) return 'global';
  return 'invalid';
}

/** 是否属于 2000::/3 全局单播（注意：文档段 2001:db8::/32 也在其中，见 isPublicDialCandidate） */
export function isGlobalUnicastIpv6(host: string): boolean {
  return guiLeiIpv6ZuoYongYu(host) === 'global';
}

export function isIpv6DocumentationAddress(host: string): boolean {
  const b = parseIpv6(host);
  if (!b) return false;
  return b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8;
}

/**
 * **可以用来拨号的公网 IPv6 候选**：全局单播 且 非文档段。
 * link-local / ULA / 回环 / 组播 / 未指定一律不算（附八.9 的分类要求）。
 */
export function isPublicDialCandidate(host: string): boolean {
  return isGlobalUnicastIpv6(host) && !isIpv6DocumentationAddress(host);
}

/**
 * `os.networkInterfaces()` 的 `family` **在 Node 版本间有两种写法**：
 * 老版本是字符串 `'IPv4'` / `'IPv6'`，新版本是数字 `4` / `6`。
 * 两种都要认，否则"某天升级 Node 后 IPv6 档静默消失"。
 */
export function normalizeInterfaceFamily(family: unknown): 'IPv4' | 'IPv6' | 'other' {
  if (family === 'IPv6' || family === 6 || family === '6') return 'IPv6';
  if (family === 'IPv4' || family === 4 || family === '4') return 'IPv4';
  return 'other';
}

export interface LocalIpv6Entry {
  interfaceName: string;
  address: string;
  scope: Ipv6Scope;
  /** 原始 family 值（用于自证兼容点：字符串 'IPv6' 与数字 6 都出现过） */
  familyRaw: string | number;
  internal: boolean;
  documentation: boolean;
}

export interface Ipv6Report {
  /** 至少一个全局单播（非文档段）地址 → IPv6 天然可拨入候选（无 NAT ⇒ 无需打洞） */
  hasGlobalUnicast: boolean;
  /** 首选候选（供宣告/DHT 记录/入站提示使用） */
  publicCandidate: string | null;
  publicCandidates: string[];
  global: string[];
  ula: string[];
  linkLocal: string[];
  loopback: string[];
  documentation: string[];
  entries: LocalIpv6Entry[];
  /** 枚举时实际见到的 family 写法（证明两种形式都被处理过） */
  familyFormsSeen: (string | number)[];
  reason: string;
}

const VIRTUAL_IFACE_RE = /vEthernet|hyper-?v|wsl|docker|vmware|virtualbox|loopback|virtual|vethernet|tap|tun|npcap|bluetooth/i;

/** 接口名打分：越小越优先（真实物理网卡优先于虚拟网卡） */
function ifaceRank(name: string): number {
  return VIRTUAL_IFACE_RE.test(name) ? 1 : 0;
}

/**
 * 本机 IPv6 地址分类（真实现：`os.networkInterfaces()`）。
 * 传入 `nics` 参数是为了**可注入**（验证脚本用构造数据锁住分类矩阵与 `family` 兼容点）。
 */
export function listLocalIpv6Candidates(nics: ReturnType<typeof os.networkInterfaces> = os.networkInterfaces()): LocalIpv6Entry[] {
  const out: LocalIpv6Entry[] = [];
  for (const [iface, addrs] of Object.entries(nics)) {
    for (const a of addrs ?? []) {
      if (normalizeInterfaceFamily(a.family) !== 'IPv6') continue;
      const host = normalizeHostLiteral(a.address);
      const scope = guiLeiIpv6ZuoYongYu(host);
      if (scope === 'invalid') continue;
      out.push({
        interfaceName: iface,
        address: host,
        scope,
        familyRaw: a.family,
        internal: a.internal === true,
        documentation: isIpv6DocumentationAddress(host),
      });
    }
  }
  return out;
}

/** 首选 IPv6 全局地址：全局单播、非文档段、非回环、物理网卡优先 */
export function pickLocalIpv6Address(entries: LocalIpv6Entry[] = listLocalIpv6Candidates()): string | null {
  const cands = entries.filter((e) => e.scope === 'global' && !e.documentation);
  if (cands.length === 0) return null;
  const sorted = [...cands].sort((a, b) => ifaceRank(a.interfaceName) - ifaceRank(b.interfaceName));
  return sorted[0]?.address ?? null;
}

export function inspectLocalIpv6(nics: ReturnType<typeof os.networkInterfaces> = os.networkInterfaces()): Ipv6Report {
  const entries = listLocalIpv6Candidates(nics);
  const group = (s: Ipv6Scope): string[] => entries.filter((e) => e.scope === s).map((e) => e.address);
  const documentation = entries.filter((e) => e.documentation).map((e) => e.address);
  const publicCandidates = entries.filter((e) => e.scope === 'global' && !e.documentation).map((e) => e.address);
  const publicCandidate = pickLocalIpv6Address(entries);
  const hasGlobalUnicast = publicCandidates.length > 0;
  return {
    hasGlobalUnicast,
    publicCandidate,
    publicCandidates,
    global: group('global'),
    ula: group('ula'),
    linkLocal: group('link-local'),
    loopback: group('loopback'),
    documentation,
    entries,
    familyFormsSeen: [...new Set(entries.map((e) => e.familyRaw))],
    reason: hasGlobalUnicast
      ? `本机有全局单播 IPv6 ${publicCandidate ?? ''}（IPv6 无 NAT）→ **天然可拨入候选，无需打洞**（不等于已验证公网可达）`
      : `本机没有全局单播 IPv6（全局 ${group('global').length} / ULA ${group('ula').length} / 链路本地 ${group('link-local').length}）→ IPv6 档不适用，需走 IPv4/打洞/中继`,
  };
}

/* ────────────────────────────── 真实拨号（带地址族） ────────────────────────────── */

export interface DialDetail {
  ok: boolean;
  detail?: string;
  /** socket 自报的地址族（'IPv6'/'IPv4'）—— 证明**真的**走了该族 */
  remoteFamily?: string;
  localAddress?: string;
  localPort?: number;
  latencyMs?: number;
}

/**
 * 真实 TCP 拨号（可选强制地址族）。
 * `family` 用于"客户端在指定地址族下真连上"：域名时 Node 只查对应族的记录；
 * 字面地址时由字面本身决定族，`remoteFamily` 会如实回报实际用的族。
 */
export function boTcpXiangQing(host: string, port: number, timeoutMs: number, family?: 4 | 6): Promise<DialDetail> {
  return new Promise((resolve) => {
    const started = Date.now();
    const target = normalizeHostLiteral(host);
    const opts: net.NetConnectOpts = family ? { host: target, port, family } : { host: target, port };
    const sock = net.connect(opts);
    let settled = false;
    const done = (r: DialDetail): void => {
      if (settled) return;
      settled = true;
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      resolve(r);
    };
    sock.once('connect', () =>
      done({
        ok: true,
        detail: `TCP 连接成功（${sock.remoteFamily ?? '?'} ${target}:${port}）`,
        remoteFamily: sock.remoteFamily ?? undefined,
        localAddress: sock.localAddress ?? undefined,
        localPort: sock.localPort ?? undefined,
        latencyMs: Date.now() - started,
      })
    );
    sock.on('error', (e: Error) => done({ ok: false, detail: `TCP 失败：${e.message}`, latencyMs: Date.now() - started }));
    sock.setTimeout(timeoutMs, () => done({ ok: false, detail: `TCP 超时 ${timeoutMs}ms`, latencyMs: Date.now() - started }));
  });
}

/* ────────────────────────────── 连接阶梯 ────────────────────────────── */

export type LadderRung = 'ipv6-direct' | 'public-direct' | 'upnp' | 'holepunch' | 'relay' | 'lan';

/** 附八.9 定的顺序：IPv6 公网直连 → IPv4 公网直连 → 端口映射 → 打洞 → 中继 → 局域网 */
export const DEFAULT_LADDER_ORDER: LadderRung[] = ['ipv6-direct', 'public-direct', 'upnp', 'holepunch', 'relay', 'lan'];

export const LADDER_LABELS: Record<LadderRung, string> = {
  'ipv6-direct': 'IPv6 公网直连',
  'public-direct': 'IPv4 公网直连',
  upnp: '路由器自动映射（UPnP/NAT-PMP/PCP）',
  holepunch: '打洞（STUN + 同时打洞）',
  relay: '中继兜底',
  lan: '同网局域网',
};

/** 阶梯档位 → i18n key（UI 文案由主代理统一加；这里只给 key，不拼句子） */
export const LADDER_RUNG_I18N: Record<LadderRung, string> = {
  'ipv6-direct': 'net.rung.ipv6Direct',
  'public-direct': 'net.rung.publicDirect',
  upnp: 'net.rung.upnp',
  holepunch: 'net.rung.holepunch',
  relay: 'net.rung.relay',
  lan: 'net.rung.lan',
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
  /**
   * 对端报告的"本机是否可拨入"（对端自己的 DialabilityProbe 结论）。
   * `undefined` = 未收到报告 → 阶梯**不猜**（附八.3 第 3 条：可检测就可明确表达）。
   */
  peerDialable?: boolean;
}

export type RungStatus = 'ok' | 'failed' | 'unsupported' | 'skipped';

/** 中继档选中后的细节（供 UI 显示"经中继（更慢，但可用）"） */
export interface RelayRungInfo {
  /** 中继节点地址 */
  relay: { host: string; port: number };
  /** 两端共享的配对 token（确定性推导；不是凭据） */
  token: string;
  /** 中继引入的开销提示（i18n key：net.relay.slowerButUsable） */
  slowerButUsable: true;
}

export interface RungAttempt {
  rung: LadderRung;
  label: string;
  status: RungStatus;
  ms: number;
  detail?: string;
  address?: { host: string; port: number };
  /** 实际使用的地址族（真实拨号时由 socket 报告） */
  family?: 4 | 6;
  /** 结构化结论码（不拼文案，UI 可据此选 key） */
  code?: string;
  relay?: RelayRungInfo;
}

export interface LadderResult {
  ok: boolean;
  rung: LadderRung | null;
  address?: { host: string; port: number };
  attempts: RungAttempt[];
  /** 全部失败时的结论文案（UI 可直接用） */
  summary: string;
  /** 结构化结论码（'ok' / 'no-relay-available' / 'all-failed' / 'no-address' …） */
  code?: string;
  /** 选中的档位走的是哪个地址族（IPv6 档命中时 = 6） */
  family?: 4 | 6;
  /** 中继档的结构化结论（含"无可用中继 → 需要一台有公网地址的机器做中继"） */
  relayDecision?: RelayDecision;
  /** 可达性汇总（UI 判断要显示哪条文案） */
  reachability?: ReachabilitySummary;
}

/** 可达性汇总：**结构化**给出"该显示哪条文案"的依据 */
export interface ReachabilitySummary {
  selfDialable?: boolean;
  peerDialable?: boolean;
  /** 双方各自报告"本机不可拨入" —— 附八.3 的死锁状态 */
  bothUndialable: boolean;
  /** 需要用户看到"两端都无法直连，需要一台有公网地址的机器做中继" */
  needsPublicRelayNotice: boolean;
  relayCode: RelayDecisionCode | 'not-attempted';
  localIpv6: { hasGlobalUnicast: boolean; publicCandidate: string | null };
  /** i18n key 建议（主代理接文案用） */
  i18n: { rung?: string; relay?: string };
}

export interface RungContext {
  target: LadderTarget;
  timeoutMs: number;
  dialTcp: (host: string, port: number, timeoutMs: number, family?: 4 | 6) => Promise<DialDetail | { ok: boolean; detail?: string }>;
  log: (msg: string) => void;
  /** 本机是否可拨入（来自 DialabilityProbe；undefined = 未知） */
  selfDialable?: boolean;
  /** 中继候选（有公网地址的机器） */
  relays: RelayCandidateRef[];
}

export interface RungOutcome {
  ok: boolean;
  detail?: string;
  address?: { host: string; port: number };
  family?: 4 | 6;
  code?: string;
  relay?: RelayRungInfo;
  /** 本档"不适用/不需要"（≠ 失败）：如实记为 skipped，不伪装成试过 */
  skip?: boolean;
  relayDecision?: RelayDecision;
}

export interface LadderStrategy {
  rung: LadderRung;
  supported: boolean;
  unsupportedReason?: string;
  attempt(ctx: RungContext): Promise<RungOutcome>;
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

export interface RelayRungOptions {
  /** 中继候选（可达节点 = 有公网地址的那台机器） */
  relays: () => RelayCandidateRef[];
  /** 本机是否可拨入（DialabilityProbe 结论；undefined = 未知） */
  selfDialable?: () => boolean | undefined;
  /** 本机指纹（配对 token 必须由"双方指纹 + 中继地址"推出，两端才算得出同一个值） */
  selfFingerprint?: () => string | undefined;
  /** 自定义探测（默认真实 TCP） */
  dialTcp?: (host: string, port: number, timeoutMs: number) => Promise<{ ok: boolean; detail?: string }>;
}

export interface LianJieTiZiXuanXiang {
  strategies?: Partial<Record<LadderRung, LadderStrategy>>;
  order?: LadderRung[];
  perRungTimeoutMs?: number;
  dialTcp?: (host: string, port: number, timeoutMs: number, family?: 4 | 6) => Promise<DialDetail | { ok: boolean; detail?: string }>;
  /** LAN 探测提供者（默认用注入的 LanProbe） */
  lanProbe?: LanProbe;
  lanTargets?: () => { host: string; port: number }[];
  lanBroadcastPorts?: number[];
  /** 中继档配置（不配置时：若两端都不可拨入，仍会**如实报缺口**而不是静默失败） */
  relay?: RelayRungOptions;
  /** 本机 IPv6 报告（默认真实枚举本机网卡） */
  ipv6Report?: () => Ipv6Report;
  onRung?: (a: RungAttempt) => void;
  now?: () => number;
}

/**
 * 默认 TCP 拨号：真实 net.connect（第 4 个参数可强制地址族）。
 * 这里只判断"能不能连上"，**不在此处做握手**（握手由 SecureSyncClient 负责）。
 */
export async function boTcpMoRen(host: string, port: number, timeoutMs: number, family?: 4 | 6): Promise<DialDetail> {
  return boTcpXiangQing(host, port, timeoutMs, family);
}

export class LianJieTiZi {
  private readonly order: LadderRung[];
  private readonly perRungTimeoutMs: number;
  private readonly dialTcp: (host: string, port: number, timeoutMs: number, family?: 4 | 6) => Promise<DialDetail | { ok: boolean; detail?: string }>;
  private readonly strategies = new Map<LadderRung, LadderStrategy>();
  private readonly now: () => number;
  private lastRelayDecision?: RelayDecision;
  /** 每一级的尝试历史（可观测性） */
  readonly history: RungAttempt[] = [];

  constructor(private readonly opts: LianJieTiZiXuanXiang = {}) {
    this.order = opts.order ?? DEFAULT_LADDER_ORDER;
    this.perRungTimeoutMs = opts.perRungTimeoutMs ?? 3000;
    this.dialTcp = opts.dialTcp ?? boTcpMoRen;
    this.now = opts.now ?? (() => Date.now());

    /**
     * 第 1 档：IPv6 公网直连（附八.9）。
     * 只拨"目标的**全局单播** IPv6 地址"；link-local / ULA / 回环 / 文档段**不算**候选，
     * 并把这些被排除的地址原样写进 detail（可解释，不静默跳过）。
     */
    const ipv6Direct: LadderStrategy = {
      rung: 'ipv6-direct',
      supported: true,
      async attempt(ctx) {
        const all = ctx.target.addresses;
        const v6 = all.filter((a) => ipFamilyOfHost(a.host) === 6);
        const candidates = v6.filter((a) => isPublicDialCandidate(a.host));
        const excluded = v6.filter((a) => !isPublicDialCandidate(a.host));
        const label = (a: LadderAddress): string => `${a.host}(${guiLeiIpv6ZuoYongYu(a.host)}${isIpv6DocumentationAddress(a.host) ? '·文档段' : ''})`;
        if (candidates.length === 0) {
          return {
            ok: false,
            code: 'no-ipv6-candidate',
            detail:
              all.length === 0
                ? '没有可用地址（DHT 未宣告 / 未提供）→ IPv6 档不适用'
                : excluded.length > 0
                  ? `目标有 ${excluded.length} 个 IPv6 地址但不是公网候选（链路本地/ULA/回环/文档段，IPv6 无 NAT 只对全局单播成立）：${excluded.map(label).join('、')}`
                  : '目标没有 IPv6 地址（只有 IPv4）→ IPv6 档不适用，交给下一档',
          };
        }
        const errors: string[] = [];
        for (const addr of candidates) {
          // 显式指定 family=6：证明这一档**真的**用 IPv6 拨号（socket 会回报 remoteFamily）
          const r = await ctx.dialTcp(addr.host, addr.port, ctx.timeoutMs, 6);
          if (r.ok) {
            const fam = (r as DialDetail).remoteFamily;
            return {
              ok: true,
              address: { host: addr.host, port: addr.port },
              family: 6,
              code: 'ipv6-direct-ok',
              detail: `IPv6 直连成功 [${addr.host}]:${addr.port}（socket 报 ${fam ?? 'IPv6'}；IPv6 无 NAT，无需打洞/中继）`,
            };
          }
          errors.push(`[${addr.host}]:${addr.port} ${r.detail ?? '失败'}`);
        }
        return { ok: false, code: 'ipv6-dial-failed', detail: errors.join(' / ') };
      },
    };

    const publicDirect: LadderStrategy = {
      rung: 'public-direct',
      supported: true,
      async attempt(ctx) {
        if (ctx.target.addresses.length === 0) return { ok: false, code: 'no-address', detail: '没有可用地址（DHT 未宣告 / 未提供）' };
        const errors: string[] = [];
        for (const addr of ctx.target.addresses) {
          const r = await ctx.dialTcp(addr.host, addr.port, ctx.timeoutMs);
          if (r.ok) {
            const fam = (r as DialDetail).remoteFamily;
            return {
              ok: true,
              address: { host: addr.host, port: addr.port },
              ...(fam === 'IPv6' ? { family: 6 as const } : fam === 'IPv4' ? { family: 4 as const } : {}),
              code: 'public-direct-ok',
              detail: `${addr.host}:${addr.port} 可直连（来源 ${addr.source}${fam ? `，地址族 ${fam}` : ''}）`,
            };
          }
          errors.push(`${addr.host}:${addr.port} ${r.detail ?? '失败'}`);
        }
        return { ok: false, code: 'direct-failed', detail: errors.join(' / ') };
      },
    };

    /**
     * 中继档（附八.3）：**两端都不可拨入**时经一台可达节点转发。
     * 结论永远是**可检测、可解释**的三种之一：
     *  · `relay-selected`        —— 真连上了中继，拿到配对 token；
     *  · `relay-none-configured` —— 两端不可拨入且没有中继 ⇒ 明确报缺口（不转圈、不静默）；
     *  · `relay-unreachable`     —— 配了中继但都连不上 ⇒ 同样明确报缺口。
     */
    const relay: LadderStrategy = {
      rung: 'relay',
      supported: true,
      async attempt(ctx) {
        const decision = await jueDingZhongJi(
          { fingerprint: ctx.target.fingerprint, nodeId: ctx.target.nodeId },
          {
            selfDialable: ctx.selfDialable,
            peerDialable: ctx.target.peerDialable,
            ...(opts.relay?.selfFingerprint?.() ? { selfFingerprint: opts.relay.selfFingerprint() as string } : {}),
            candidates: ctx.relays,
            ...(opts.relay?.dialTcp ? { dialTcp: opts.relay.dialTcp } : {}),
            timeoutMs: Math.max(600, Math.min(ctx.timeoutMs, 2500)),
            now: opts.now,
          }
        );
        if (decision.selected && decision.relay && decision.token) {
          const info: RelayRungInfo = {
            relay: { host: decision.relay.host, port: decision.relay.port },
            token: decision.token,
            slowerButUsable: true,
          };
          return {
            ok: true,
            address: { host: decision.relay.host, port: decision.relay.port },
            code: 'relay-selected',
            relay: info,
            relayDecision: decision,
            detail: `${decision.reason}（配对 token ${decision.token.slice(0, 8)}…；内容端到端加密，中继只见密文）`,
          };
        }
        return {
          ok: false,
          code: decision.code,
          detail: decision.reason,
          relayDecision: decision,
        };
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

    this.strategies.set('ipv6-direct', opts.strategies?.['ipv6-direct'] ?? ipv6Direct);
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
    // 中继档**已实现**（relay.ts）：未配置中继候选时也不是 unsupported —— 会如实报"缺中继"这个状态
    this.strategies.set('relay', opts.strategies?.relay ?? relay);
  }

  strategyFor(rung: LadderRung): LadderStrategy | undefined {
    return this.strategies.get(rung);
  }

  /** 最近一次中继档的结构化结论（UI 可在 connect() 之外直接读） */
  get relayDecision(): RelayDecision | undefined {
    return this.lastRelayDecision;
  }

  /** 逐级降级：命中即停；未实现的级标注 unsupported 并继续下一级 */
  async connect(target: LadderTarget): Promise<LadderResult> {
    const attempts: RungAttempt[] = [];
    const localIpv6 = (this.opts.ipv6Report ?? inspectLocalIpv6)();
    const selfDialable = this.opts.relay?.selfDialable ? this.opts.relay.selfDialable() : undefined;
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
        selfDialable,
        relays: this.opts.relay?.relays() ?? [],
      };
      let outcome: RungOutcome;
      try {
        outcome = await strat.attempt(ctx);
      } catch (e) {
        outcome = { ok: false, detail: `策略异常：${(e as Error).message ?? String(e)}`, code: 'rung-threw' };
      }
      if (outcome.relayDecision) this.lastRelayDecision = outcome.relayDecision;
      const a: RungAttempt = {
        rung,
        label: LADDER_LABELS[rung],
        status: outcome.ok ? 'ok' : outcome.skip ? 'skipped' : 'failed',
        ms: this.now() - startedAt,
        detail: outcome.detail,
        address: outcome.address,
        ...(outcome.family ? { family: outcome.family } : {}),
        ...(outcome.code ? { code: outcome.code } : {}),
        ...(outcome.relay ? { relay: outcome.relay } : {}),
      };
      attempts.push(a);
      this.history.push(a);
      this.opts.onRung?.(a);
      if (outcome.ok) {
        const relayCode = attempts.find((x) => x.rung === 'relay')?.code as RelayDecisionCode | undefined;
        return {
          ok: true,
          rung,
          address: outcome.address,
          attempts,
          summary: `已连接（${LADDER_LABELS[rung]}）：${outcome.detail ?? ''}`,
          code: outcome.code ?? 'ok',
          ...(outcome.family ? { family: outcome.family } : {}),
          ...(this.lastRelayDecision ? { relayDecision: this.lastRelayDecision } : {}),
          reachability: {
            selfDialable,
            peerDialable: target.peerDialable,
            bothUndialable: false,
            needsPublicRelayNotice: false,
            relayCode: relayCode ?? 'not-attempted',
            localIpv6: { hasGlobalUnicast: localIpv6.hasGlobalUnicast, publicCandidate: localIpv6.publicCandidate },
            i18n: { rung: LADDER_RUNG_I18N[rung], ...(rung === 'relay' ? { relay: 'net.relay.selected' } : {}) },
          },
        };
      }
    }
    const missing = attempts.filter((a) => a.status === 'unsupported').map((a) => LADDER_LABELS[a.rung]);
    const relayAttempt = attempts.find((a) => a.rung === 'relay');
    const relayDecision = this.lastRelayDecision;
    const parts: string[] = ['全部可用方式均失败'];
    if (relayDecision?.needsPublicRelayNotice) {
      parts.push(`两端都无法直连且无可用中继（${relayDecision.code}）：需要一台有公网地址的机器做中继`);
    } else if (relayDecision && relayDecision.code === 'dialability-unknown') {
      parts.push('对端可拨入性未知，无法判定是否必须中继');
    }
    if (missing.length) parts.push(`未实现的降级路径：${missing.join('、')}`);
    parts.push('（详见 attempts）');
    return {
      ok: false,
      rung: null,
      attempts,
      summary: parts.join('；'),
      code: relayDecision?.needsPublicRelayNotice
        ? 'no-relay-available'
        : attempts.some((a) => a.code === 'no-address') && attempts.some((a) => a.code === 'no-ipv6-candidate')
          ? 'no-address'
          : 'all-failed',
      ...(relayDecision ? { relayDecision } : {}),
      reachability: {
        selfDialable,
        peerDialable: target.peerDialable,
        bothUndialable: relayDecision?.bothUndialable === true,
        needsPublicRelayNotice: relayDecision?.needsPublicRelayNotice === true,
        relayCode: (relayAttempt?.code as RelayDecisionCode | undefined) ?? 'not-attempted',
        localIpv6: { hasGlobalUnicast: localIpv6.hasGlobalUnicast, publicCandidate: localIpv6.publicCandidate },
        i18n: relayDecision?.needsPublicRelayNotice ? { relay: 'net.relay.missing.needsPublicRelay' } : {},
      },
    };
  }
}
