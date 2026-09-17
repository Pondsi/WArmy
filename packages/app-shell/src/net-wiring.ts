/**
 * net-wiring —— 组网接线层：把 ②（握手/发现/保活）真接到 app-shell 上
 *
 * 为什么单独一个文件：
 *   · `electron-main.ts` 已经 3300+ 行；这里放**真实现的部分**，主进程只留「门控 + 通道名 + 返回形状」；
 *   · 这一层能直接被验证脚本 import（`packages/app-shell/scripts/verify-wiring.mjs`），
 *     所以「本机地址枚举 / 出站探测 / DNS / 端口可达 / 鉴权握手 / 重放防护」都跑得起来断言。
 *
 * 真实现 / 降级 / 未实现（**不许假装成功**）：
 *   · 真实现：TCP 连通性探测（含时延）、DNS 解析、网卡地址枚举、出站连通性（TCP + HTTP 到公网端点）、
 *     公网地址发现（HTTP 回显服务，尽力而为，失败如实报 `publicIpError`）、
 *     本机监听端口是否真的在听（真的 TCP 连一次 127.0.0.1:port）、
 *     鉴权握手（Ed25519 双向认证 + X25519 ECDHE + AES-256-GCM）、名册校验、重放防护（**计数持久化**）。
 *   · 降级：**入站可达性**（"别人能不能拨到我"）需要一台真的在公网的第三方对端来拨回；
 *     本机自测只能证明「同机/同网可达」→ 结论里显式带 `inboundVerified: false`，
 *     绝不因为"地址字面看起来是公网"就宣称公网可达。
 *   · 未实现：UPnP / NAT-PMP 端口映射、打洞（对称 NAT）、中继。
 *
 * 旧实现（`lan.ts` / `mesh.ts`）保留文件但**不再被主进程使用**：它们是明文 JSONL、无握手、无身份。
 */
import crypto from 'node:crypto';
import dns from 'node:dns';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
  ConnectionLiveness,
  LanProbe,
  ReplayGuard,
  SecureSyncClient,
  SecureSyncServer,
  SecureSession,
  classifyAddress,
  type HandshakeFailureRecord,
  type MemberLiveness,
  type SyncMessage,
} from '@ccarmy/sync-protocol';
import {
  createIdentityProvider,
  createRosterChecker,
  fingerprintDerivationForAppShell,
  requireSignableIdentity,
  type SignerUnlockState,
} from './identity-provider.js';
import type { IdentityStore } from './identity-store.js';

/** 无服务器拓扑说明。**只给 i18n key**，主进程不拼句子（渲染层负责翻译） */
export const NET_NOTES = {
  lan: 'net.note.lan',
  wanManual: 'net.note.wanManual',
  wanHard: 'net.note.wanHard',
} as const;

/* ────────────────────────────── 基础探测（真实现） ────────────────────────────── */

export interface TcpProbeResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
  /** 真的连上了才有的本地端口（可用来证明"这条连接是我们的"） */
  localPort?: number;
}

/** 真实 TCP 连接探测（不读不写，连上即断） */
export function tcpProbe(host: string, port: number, timeoutMs = 2500): Promise<TcpProbeResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    const sock = net.connect({ host, port });
    const done = (r: TcpProbeResult): void => {
      if (settled) return;
      settled = true;
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      resolve(r);
    };
    sock.once('connect', () => done({ ok: true, latencyMs: Date.now() - started, localPort: sock.localPort ?? undefined }));
    // 用 on（不是 once）：settle 之后对端再抛 ECONNRESET 之类也必须被吞掉，
    // 否则一个未处理的 'error' 事件能直接把 Electron 主进程带崩
    sock.on('error', (e: Error & { code?: string }) => done({ ok: false, error: e.code ?? e.message }));
    sock.setTimeout(timeoutMs, () => done({ ok: false, error: 'timeout' }));
  });
}

export interface LocalAddressInfo {
  ok: boolean;
  /** 最可能被局域网对端使用的本机地址（私网优先） */
  localIp: string;
  /** 全部非回环 IPv4（诊断用） */
  interfaces: string[];
  /** 本机是否有公网地址（网卡直接持有） */
  hasPublicInterface: boolean;
  /** 全部网卡地址都是私网/回环 → 一定在 NAT 之后（有证据的判定） */
  behindNat: boolean;
  /** 公网地址（HTTP 回显服务，尽力而为；失败则没有这个字段） */
  publicIp?: string;
  publicIpSource?: string;
  publicIpError?: string;
  /** 公网地址 ≠ 本机任一网卡地址 → NAT 后才有了公网地址（证据更强） */
  behindNatConfirmed?: boolean;
  tcp?: TcpProbeResult;
}

function isIpv4(v: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v);
  if (!m) return false;
  return m.slice(1).every((x) => Number(x) >= 0 && Number(x) <= 255);
}

/** 枚举非回环 IPv4（真实现：os.networkInterfaces） */
export function listLocalAddresses(): { all: string[]; publicOnes: string[] } {
  const all: string[] = [];
  const publicOnes: string[] = [];
  try {
    const nics = os.networkInterfaces();
    for (const addrs of Object.values(nics)) {
      for (const a of addrs ?? []) {
        if (a.family !== 'IPv4' || a.internal) continue;
        if (!isIpv4(a.address)) continue;
        if (!all.includes(a.address)) all.push(a.address);
        if (classifyAddress(a.address) === 'public') publicOnes.push(a.address);
      }
    }
  } catch {
    /* ignore：拿不到网卡就当空 */
  }
  return { all, publicOnes };
}

/** 私网优先的"本机地址"（局域网对端最可能需要这个） */
export function pickLocalAddress(all: string[]): string {
  // 多网卡机器上（Hyper-V/WSL 的 172.16-31 虚拟网卡、Docker 网桥…）排序很关键：
  // 家用/办公局域网一般是 192.168.*，其次是 10.*，172.16-31 往往是虚拟网卡 → 排最后。
  const rank = (a: string): number => {
    if (/^192\.168\./.test(a)) return 0;
    if (/^10\./.test(a)) return 1;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(a)) return 2;
    if (classifyAddress(a) === 'private') return 3;
    if (classifyAddress(a) === 'public') return 4;
    return 5;
  };
  const sorted = [...all].sort((a, b) => rank(a) - rank(b));
  if (sorted.length > 0) return sorted[0] as string;
  return '127.0.0.1';
}

/** 公网地址回显服务（多个，取第一个成功且格式合法的）。这是**尽力而为**的真实探测。 */
const PUBLIC_IP_SERVICES: { url: string; source: string }[] = [
  { url: 'https://ipinfo.io/ip', source: 'ipinfo.io' },
  { url: 'https://checkip.amazonaws.com', source: 'checkip.amazonaws.com' },
  { url: 'https://api.ipify.org', source: 'api.ipify.org' },
];

export interface PublicIpResult {
  ok: boolean;
  ip?: string;
  source?: string;
  error?: string;
  latencyMs?: number;
}

export async function discoverPublicIp(timeoutMs = 4000): Promise<PublicIpResult> {
  const started = Date.now();
  const errors: string[] = [];
  for (const svc of PUBLIC_IP_SERVICES) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(svc.url, { signal: ctl.signal, redirect: 'follow' });
      const text = (await res.text()).trim().slice(0, 64);
      const looksLikeIp = isIpv4(text) || (/^[0-9a-f:]+$/i.test(text) && text.includes(':'));
      if (res.ok && looksLikeIp) return { ok: true, ip: text, source: svc.source, latencyMs: Date.now() - started };
      errors.push(`${svc.source}:bad-body`);
    } catch (e) {
      errors.push(`${svc.source}:${(e as Error).name === 'AbortError' ? 'timeout' : 'unreachable'}`);
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, error: errors.join(','), latencyMs: Date.now() - started };
}

/** 出站连通性：真的 TCP 连一次公网端点（默认挑几个稳定可用的） */
const OUTBOUND_TARGETS: { host: string; port: number; label: string }[] = [
  { host: 'registry.npmjs.org', port: 443, label: 'npm-registry' },
  { host: '1.1.1.1', port: 443, label: 'cloudflare-dns' },
  { host: '8.8.8.8', port: 53, label: 'google-dns' },
];

export interface OutboundResult {
  ok: boolean;
  method?: string;
  latencyMs?: number;
  error?: string;
  attempts: { label: string; ok: boolean; error?: string; latencyMs?: number }[];
}

export async function checkOutbound(timeoutMs = 2500, targets = OUTBOUND_TARGETS): Promise<OutboundResult> {
  const attempts: OutboundResult['attempts'] = [];
  for (const t of targets) {
    const r = await tcpProbe(t.host, t.port, timeoutMs);
    attempts.push({
      label: t.label,
      ok: r.ok,
      ...(r.error ? { error: r.error } : {}),
      ...(r.latencyMs ? { latencyMs: r.latencyMs } : {}),
    });
    if (r.ok) return { ok: true, method: `tcp:${t.label}`, latencyMs: r.latencyMs, attempts };
  }
  return { ok: false, error: attempts.map((a) => `${a.label}:${a.error ?? 'fail'}`).join(','), attempts };
}

/** 本机地址信息（不联网也有结果；公网地址尽力而为） */
export async function localAddressInfo(opts: { port?: number; timeoutMs?: number } = {}): Promise<LocalAddressInfo> {
  const { all, publicOnes } = listLocalAddresses();
  const localIp = pickLocalAddress(all);
  const base: LocalAddressInfo = {
    ok: true,
    localIp,
    interfaces: all,
    hasPublicInterface: publicOnes.length > 0,
    behindNat: publicOnes.length === 0,
  };
  if (opts.port) base.tcp = await tcpProbe('127.0.0.1', opts.port, 1200);
  const pub = await discoverPublicIp(opts.timeoutMs ?? 4000);
  if (pub.ok && pub.ip) {
    base.publicIp = pub.ip;
    base.publicIpSource = pub.source;
    const onNic = all.includes(pub.ip) || publicOnes.includes(pub.ip);
    base.behindNatConfirmed = !onNic;
    if (!onNic) base.behindNat = true;
  } else {
    base.publicIpError = pub.error ?? 'unavailable';
  }
  return base;
}

/* ────────────────────────────── netProbe ────────────────────────────── */

export interface ProbeNetInput {
  ip: string;
  port: number;
  domains?: string[];
}

export interface ProbeNetResult {
  ok: boolean;
  isPublic: boolean;
  outboundOk: boolean;
  lanOnly?: boolean;
  method?: string;
  behindNat?: boolean;
  observedIp?: string;
  errorCode?: string;
  /** 入站可达性在本机**无法验证**（缺公网第三方对端）；恒 false，别当"已验证"用 */
  inboundVerified: false;
  /** 结构化证据（UI/日志可用；不含任何文案） */
  details?: {
    scope: string;
    localInterfaces: string[];
    onLocalNic: boolean;
    resolvedIpv4: string[];
    dnsErrors: string[];
    outbound?: OutboundResult;
    publicIp?: string;
    publicIpSource?: string;
    publicIpError?: string;
    portCheck?: TcpProbeResult;
    portCheckTarget?: string;
  };
}

function isValidHost(v: string): boolean {
  if (isIpv4(v)) return true;
  if (/^[0-9a-f:]+$/i.test(v) && v.includes(':')) return true; // IPv6
  // 域名或单标签主机名（localhost / 内网 NetBIOS 名都合法）
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(v);
}

/**
 * 公网地址检测（真实现 + 明确降级）。
 *
 * 判定规则（每条都有证据）：
 *  · 字面 IP 属于私网/回环/链路本地/CGNAT → `isPublic=false`、`lanOnly=true`；
 *  · 字面是公网 IP **且** 就是本机某张网卡的地址 → `isPublic=true`（"网卡直接持有公网地址"，证据充分）；
 *  · 字面是公网 IP 但**不是**本机网卡地址 → `isPublic=true`（这是用户填的对外地址；是否真的映射到本机
 *    属于入站可达性，本机无法验证 → `inboundVerified:false` 如实标注）；
 *  · 域名 → 真的 DNS 解析；解析结果里有公网地址才算 `isPublic`，全是私网则 `lanOnly`；
 *  · 端口可达性：只对本机地址/回环做**真实 TCP 连接**；对非本机地址不做任何"假装可达"的结论。
 */
export async function probeNet(input: ProbeNetInput, timeoutMs = 3000): Promise<ProbeNetResult> {
  const ip = String(input?.ip ?? '').trim();
  const port = Number(input?.port);
  if (!ip || !isValidHost(ip)) {
    return { ok: false, isPublic: false, outboundOk: false, errorCode: 'invalid-ip', inboundVerified: false };
  }
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return { ok: false, isPublic: false, outboundOk: false, errorCode: 'invalid-port', inboundVerified: false };
  }

  const { all, publicOnes } = listLocalAddresses();
  const scope = classifyAddress(ip);
  const resolvedIpv4: string[] = [];
  const dnsErrors: string[] = [];
  const hosts = [ip, ...(Array.isArray(input.domains) ? input.domains : []).map((d) => String(d ?? '').trim()).filter(Boolean)];

  for (const h of hosts) {
    if (isIpv4(h)) {
      if (!resolvedIpv4.includes(h)) resolvedIpv4.push(h);
      continue;
    }
    try {
      const rs = await dns.promises.lookup(h, { all: true });
      for (const r of rs) if (r.family === 4 && !resolvedIpv4.includes(r.address)) resolvedIpv4.push(r.address);
    } catch (e) {
      dnsErrors.push(`${h}:${(e as NodeJS.ErrnoException).code ?? 'dns-failed'}`);
    }
  }

  const onLocalNic = all.includes(ip) || publicOnes.includes(ip);
  const scopes = [scope, ...resolvedIpv4.map((a) => classifyAddress(a))];
  const anyPublic = scopes.includes('public');
  const allPrivateLike = scopes.every((s) => s === 'private' || s === 'loopback' || s === 'link-local');
  // isPublic **只由地址事实推出**（私网/回环/链路本地/CGNAT 一律 false），绝不硬编码；
  // "是否真的能被别人拨进来"属于入站可达性 → inboundVerified 恒 false（本机无法验证）。
  const isPublic = anyPublic;
  const lanOnly = allPrivateLike || (onLocalNic && classifyAddress(ip) !== 'public');

  const outbound = await checkOutbound(timeoutMs);

  // 公网地址 + NAT 判定：真的问一次回显服务（失败就如实缺字段）
  const pub = await discoverPublicIp(Math.min(timeoutMs, 3000));
  const behindNat = publicOnes.length === 0 && (!pub.ok || !all.includes(pub.ip as string));

  // 端口：只对本机地址/回环做真实连接
  let portCheck: TcpProbeResult | undefined;
  let portCheckTarget: string | undefined;
  if (onLocalNic || scope === 'loopback') {
    portCheckTarget = scope === 'loopback' ? ip : '127.0.0.1';
    portCheck = await tcpProbe(portCheckTarget, port, 1200);
  } else if (resolvedIpv4.length > 0 && all.includes(resolvedIpv4[0] as string)) {
    portCheckTarget = '127.0.0.1';
    portCheck = await tcpProbe(portCheckTarget, port, 1200);
  }

  const methodBits: string[] = [];
  methodBits.push(onLocalNic ? 'local-interface' : scope === 'hostname' ? 'dns-resolve' : `${scope}-address`);
  methodBits.push(outbound.ok ? `outbound-${outbound.method ?? 'ok'}` : 'outbound-failed');
  if (pub.ok) methodBits.push(`public-ip-${pub.source ?? 'echo'}`);
  if (portCheck) methodBits.push(`local-port-${portCheck.ok ? 'open' : 'closed'}`);

  const details: ProbeNetResult['details'] = {
    scope,
    localInterfaces: all,
    onLocalNic,
    resolvedIpv4,
    dnsErrors,
    outbound,
    ...(pub.ok && pub.ip ? { publicIp: pub.ip, publicIpSource: pub.source as string } : { publicIpError: pub.error ?? 'unavailable' }),
    ...(portCheck ? { portCheck } : {}),
    ...(portCheckTarget ? { portCheckTarget } : {}),
  };

  let errorCode: string | undefined;
  if (!outbound.ok) errorCode = 'no-outbound';
  else if (!isPublic && !lanOnly) errorCode = 'not-public';
  else if (portCheck && !portCheck.ok) errorCode = 'port-not-listening';

  return {
    ok: true,
    isPublic,
    outboundOk: outbound.ok,
    lanOnly,
    method: methodBits.join('+'),
    behindNat,
    ...(pub.ok && pub.ip ? { observedIp: pub.ip } : {}),
    ...(errorCode ? { errorCode } : {}),
    inboundVerified: false,
    details,
  };
}

/* ────────────────────────────── 鉴权组网服务 ────────────────────────────── */

export interface MeshPeerRef {
  nodeId: string;
  name?: string;
  host: string;
  port: number;
  kind?: 'lan' | 'wan';
  lastSeen?: number;
}

export interface SecureInboundMessage {
  id: string;
  from: string;
  to: string | '*';
  channel: SyncMessage['channel'];
  groupId?: string;
  payload: unknown;
  ts: number;
  incognito?: boolean;
  /** 鉴权后的对端指纹（**来自握手**，不是消息自称） */
  peerFingerprint: string;
  remoteAddress?: string;
}

export interface MeshEnableResult {
  ok: boolean;
  port?: number;
  nodeId?: string;
  /** 未就绪时如实回错误码：identity-locked / identity-missing / port-in-use */
  errorCode?: string;
  unlock?: SignerUnlockState | null;
  error?: string;
  notes?: typeof NET_NOTES;
}

export interface MeshStatusResult {
  ok: boolean;
  /** 组网是否开着（= 本机鉴权监听在跑） */
  meshEnabled: boolean;
  link: {
    reachable: boolean;
    latencyMs?: number;
    lastError?: string;
    peers?: { nodeId: string; host: string; port: number; reachable: boolean; latencyMs?: number; lastError?: string; session?: boolean }[];
  };
  local?: { ip: string; port: number };
  publicIp?: string;
  behindNat?: boolean;
  nodeId?: string;
  sessions?: number;
  handshakeRejections?: Record<string, number>;
  unlock?: SignerUnlockState | null;
}

export interface SecureMeshOptions {
  userDataDir: string;
  nodeId: string;
  /** 取本机身份（延迟取：启动早期可能还没有） */
  store: () => IdentityStore | null;
  /** 已知对端（peerReg：手工添加 / 发现到的） */
  peers: () => MeshPeerRef[];
  /** 收到对端消息（IPC 层转渲染进程） */
  onInbound?: (msg: SecureInboundMessage) => void;
  onEvent?: (e: { type: string; detail?: string; peer?: string; ts: number }) => void;
  now?: () => number;
}

/**
 * 鉴权组网服务：一台 `SecureSyncServer` + 若干出站 `SecureSyncClient`。
 * 名册来自本机已知联系人（`peer-contacts.json`，由 identity-provider 读出），
 * 重放防护**持久化**到 `userData/net/replay-guard.json`（不持久化 = 进程重启后可重放）。
 */
export class SecureMesh {
  private server: SecureSyncServer | null = null;
  private port = 0;
  private readonly clients = new Map<string, SecureSyncClient>();
  private readonly inbox: SecureInboundMessage[] = [];
  private readonly liveness: ConnectionLiveness;
  private probe: LanProbe | null = null;
  private readonly guard: ReplayGuard;
  private lastStatusAt = 0;
  private lastStatusValue: MeshStatusResult | null = null;
  private lastPeerProbes: { at: number; peers: NonNullable<MeshStatusResult['link']['peers']> } | null = null;
  private unlockSnapshot: SignerUnlockState | null = null;
  readonly handshakeFailures: HandshakeFailureRecord[] = [];
  private announceCount = 0;

  constructor(private readonly opts: SecureMeshOptions) {
    // 重放防护：**必须持久化**，否则进程重启后同一 nonce/seq 仍会被接受（= 重启即可重放）
    this.guard = new ReplayGuard({ persistFile: path.join(opts.userDataDir, 'net', 'replay-guard.json') });
    // 在线判据：事件驱动（连接建立/关闭），不轮询名册。
    // offlineFailures=1 / offlineAfterMs=0：连接断了就判离线（这里的迟滞会变成"谎报在线"）
    this.liveness = new ConnectionLiveness({
      offlineFailures: 1,
      offlineAfterMs: 0,
      onOnline: (fp) => this.opts.onEvent?.({ type: 'online', peer: fp, ts: this.now() }),
      onOffline: (fp, info) => this.opts.onEvent?.({ type: 'offline', peer: fp, detail: info.reason, ts: this.now() }),
    });
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  get enabled(): boolean {
    return !!this.server?.listening;
  }

  get boundPort(): number {
    return this.server?.boundPort ?? this.port;
  }

  get sessionCount(): number {
    return this.server?.sessionList.length ?? 0;
  }

  get announceCallCount(): number {
    return this.announceCount;
  }

  /** 名册（= 本机已知联系人 + 显式 pin 过的指纹） */
  private rosterFor(extra: string[] = []): (fp: string) => boolean {
    return createRosterChecker(this.opts.store(), extra);
  }

  /**
   * 启动组网。**先门控**：身份拿不到签名能力（口令未解锁 / 无身份）→ 直接失败，
   * 不监听、不宣告（`identity-locked`）。这是刻意的：宁愿用户在 UI 上看到"身份未解锁"，
   * 也不要起一个"看起来在跑、实际所有握手都会失败"的监听。
   */
  async enable(port: number, opts: { discovery?: boolean; announce?: boolean } = {}): Promise<MeshEnableResult> {
    const store = this.opts.store();
    const gate = requireSignableIdentity(store);
    this.unlockSnapshot = gate.unlock ?? null;
    if (!gate.ok || !store) {
      return {
        ok: false,
        errorCode: gate.errorCode ?? 'identity-missing',
        unlock: gate.unlock ?? null,
        error: gate.reason ?? 'identity-unavailable',
      };
    }
    const identity = createIdentityProvider(store);
    // 指纹推导**必须**是身份层那一套：默认 base32(sha256(raw)) 与身份层指纹不同，
    // 不注入的话握手层会把每一条合法连接都判成 fingerprint-mismatch。
    const derivation = fingerprintDerivationForAppShell();

    if (this.server?.listening && this.boundPort === port) {
      if (opts.discovery) await this.startDiscovery();
      if (opts.announce) await this.announce('manual');
      return { ok: true, port: this.boundPort, nodeId: this.opts.nodeId, notes: NET_NOTES };
    }

    await this.disable();
    const server = new SecureSyncServer({
      identity,
      nodeId: this.opts.nodeId,
      port,
      groupId: null,
      fingerprintDerivation: derivation,
      roster: this.rosterFor(),
      replayGuard: this.guard,
      heartbeatMs: 20_000,
      logFile: path.join(this.opts.userDataDir, 'bus', 'secure-mesh.jsonl'),
      onSession: (s) => this.trackSession(s),
      onMessage: (m, s) => this.onMessage(m, s),
      onClose: (s) => {
        this.untrackSession(s);
      },
      onHandshakeEvent: (e) => {
        if (e.type === 'established') this.opts.onEvent?.({ type: 'handshake-ok', peer: e.peer, ts: e.ts });
      },
    });
    try {
      await server.start();
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      return {
        ok: false,
        errorCode: err.code === 'EADDRINUSE' ? 'port-in-use' : 'listen-failed',
        error: err.code ?? err.message,
      };
    }
    this.server = server;
    this.port = server.boundPort;
    if (opts.discovery) await this.startDiscovery();
    if (opts.announce) await this.announce('startup');
    return { ok: true, port: this.port, nodeId: this.opts.nodeId, notes: NET_NOTES };
  }

  async disable(): Promise<{ ok: boolean }> {
    await this.stopDiscovery();
    for (const c of this.clients.values()) c.close('mesh-disable');
    this.clients.clear();
    for (const s of this.server?.sessionList ?? []) this.untrackSession(s);
    await this.server?.stop();
    this.server = null;
    this.port = 0;
    this.lastPeerProbes = null;
    this.lastStatusValue = null;
    return { ok: true };
  }

  private async startDiscovery(): Promise<void> {
    const info = this.opts.store()?.info();
    if (!info) return;
    await this.stopDiscovery();
    const probe = new LanProbe({
      nodeId: this.opts.nodeId,
      fingerprint: info.fingerprint,
      tcpPort: this.port,
      onPeer: (p) => {
        // 只记地址；所有数据仍走鉴权 TCP。名册外的人拨不进来（roster 拒）。
        this.opts.onEvent?.({ type: 'discovered', peer: p.fingerprint, detail: `${p.host}:${p.port}`, ts: this.now() });
      },
    });
    try {
      await probe.start();
    } catch {
      // 发现失败不影响鉴权组网本身（端口占用/权限）→ 如实继续，不假装发现成功
      this.probe = null;
      return;
    }
    this.probe = probe;
  }

  private async stopDiscovery(): Promise<void> {
    await this.probe?.stop();
    this.probe = null;
  }

  private trackSession(session: SecureSession): void {
    const fp = session.info.peerFingerprint;
    this.liveness.registerConnection(
      fp,
      {
        id: session.info.sessionId,
        kind: session.info.direction === 'inbound' ? 'member-initiated' : 'creator-probe',
        close: () => session.close('liveness-close'),
      },
      this.now()
    );
    this.opts.onEvent?.({ type: 'session', peer: fp, detail: session.info.direction, ts: this.now() });
  }

  private untrackSession(session: SecureSession): void {
    const fp = session.info.peerFingerprint;
    this.liveness.closeConnection(fp, session.info.sessionId, this.now());
    this.liveness.markMiss(fp, this.now());
    void this.liveness.sweep(this.now());
  }

  private onMessage(msg: SyncMessage, session: SecureSession): void {
    const fp = session.info.peerFingerprint;
    this.liveness.heartbeat(fp, this.now());
    if (msg.incognito) return; // 无痕：不留在 inbox（与旧实现一致）
    const entry: SecureInboundMessage = {
      id: msg.id,
      from: msg.from,
      to: msg.to,
      channel: msg.channel,
      ...(msg.groupId ? { groupId: msg.groupId } : {}),
      payload: msg.payload,
      ts: msg.ts,
      peerFingerprint: fp,
      ...(session.info.remoteAddress ? { remoteAddress: session.info.remoteAddress } : {}),
    };
    this.inbox.push(entry);
    if (this.inbox.length > 500) this.inbox.splice(0, this.inbox.length - 500);
    this.opts.onInbound?.(entry);
  }

  inboxOf(): SecureInboundMessage[] {
    return [...this.inbox];
  }

  /** 成员在线状态（真判据：**已建立的鉴权连接** + 心跳；没有连接就是不在线） */
  presence(): MemberLiveness[] {
    return this.liveness.list();
  }

  presenceOf(fingerprint: string): MemberLiveness {
    return this.liveness.status(fingerprint);
  }

  /** 出站：连一个地址发一条消息（一次拨号一次握手；失败即返回，不重试） */
  async sendToHost(
    host: string,
    port: number,
    msg: Omit<SyncMessage, 'id' | 'ts' | 'from'>,
    opts: { pin?: string; timeoutMs?: number; keepOpen?: boolean } = {}
  ): Promise<{ ok: boolean; error?: string; peerFingerprint?: string; latencyMs?: number }> {
    const store = this.opts.store();
    const gate = requireSignableIdentity(store);
    if (!gate.ok || !store) return { ok: false, error: gate.errorCode ?? 'identity-missing' };
    const key = `${host}:${port}`;
    const existing = this.clients.get(key);
    if (existing?.session?.alive) {
      try {
        existing.session.send(msg);
        return { ok: true, peerFingerprint: existing.session.info.peerFingerprint };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    }
    const started = this.now();
    const client = new SecureSyncClient({
      identity: createIdentityProvider(store),
      nodeId: this.opts.nodeId,
      host,
      port,
      groupId: null,
      fingerprintDerivation: fingerprintDerivationForAppShell(),
      peerFingerprint: opts.pin ?? null,
      roster: this.rosterFor(opts.pin ? [opts.pin] : []),
      replayGuard: this.guard,
      heartbeatMs: 20_000,
      onMessage: (m, s) => this.onMessage(m, s),
      onClose: (s) => {
        this.untrackSession(s);
        if (this.clients.get(key) === client) this.clients.delete(key);
      },
    });
    const r = await client.connect(opts.timeoutMs ?? 6000);
    if (!r.ok || !r.session) {
      if (r.handshakeFailure) this.handshakeFailures.push(r.handshakeFailure);
      return { ok: false, error: r.reason ?? 'connect-failed' };
    }
    this.trackSession(r.session);
    if (opts.keepOpen) this.clients.set(key, client);
    const peerFingerprint = r.session.info.peerFingerprint;
    const latencyMs = this.now() - started;
    try {
      r.session.send(msg);
    } catch (e) {
      return { ok: false, error: (e as Error).message, peerFingerprint, latencyMs };
    }
    if (!opts.keepOpen) client.close('one-shot-done');
    return { ok: true, peerFingerprint, latencyMs };
  }

  /** 向所有已知对端广播（逐个真拨；返回成功/失败计数） */
  async broadcast(msg: Omit<SyncMessage, 'id' | 'ts' | 'from'>): Promise<{ sent: number; failed: number; errors: string[] }> {
    let sent = 0;
    let failed = 0;
    const errors: string[] = [];
    for (const p of this.opts.peers()) {
      const r = await this.sendToHost(p.host, p.port, { ...msg, to: msg.to ?? '*' });
      if (r.ok) sent++;
      else {
        failed++;
        errors.push(`${p.nodeId}@${p.host}:${p.port}:${r.error ?? 'fail'}`);
      }
    }
    return { sent, failed, errors };
  }

  /**
   * 宣告"我在线 + 我的地址"：走过**已鉴权**的会话发给每个已知对端。
   * 不是 DHT 宣告（DHT 未接线），也没有重试 —— 失败即放弃，如实记进 errors。
   */
  async announce(reason: 'startup' | 'address-changed' | 'manual' = 'startup'): Promise<{
    ok: boolean;
    reason: string;
    addr: { host: string; port: number };
    attempted: number;
    delivered: number;
    errors: string[];
    errorCode?: string;
  }> {
    const gate = requireSignableIdentity(this.opts.store());
    this.unlockSnapshot = gate.unlock ?? this.unlockSnapshot;
    if (!gate.ok) {
      return {
        ok: false,
        reason,
        addr: { host: '', port: this.port },
        attempted: 0,
        delivered: 0,
        errors: [],
        errorCode: gate.errorCode ?? 'identity-locked',
      };
    }
    const info = this.opts.store()?.info();
    const { all } = listLocalAddresses();
    const host = pickLocalAddress(all);
    const payload = {
      type: 'announce',
      reason,
      fingerprint: info?.fingerprint ?? '',
      nodeId: this.opts.nodeId,
      host,
      port: this.port,
      generation: info?.generation ?? 0,
      at: this.now(),
    };
    this.announceCount += 1;
    const r = await this.broadcast({ to: '*', channel: 'announce', payload });
    return {
      ok: r.failed === 0,
      reason,
      addr: { host, port: this.port },
      attempted: r.sent + r.failed,
      delivered: r.sent,
      errors: r.errors,
    };
  }

  /** UI 心跳读的那一份状态（真实现：本机监听自测 + 逐对端 TCP 探测 + 会话表） */
  async status(ttlMs = 1200): Promise<MeshStatusResult> {
    const now = this.now();
    if (this.lastStatusValue && now - this.lastStatusAt < ttlMs) return this.lastStatusValue;
    const store = this.opts.store();
    const unlock = store ? requireSignableIdentity(store).unlock ?? this.unlockSnapshot : null;
    if (!this.enabled) {
      const value: MeshStatusResult = {
        ok: true,
        meshEnabled: false,
        link: { reachable: false, lastError: 'mesh-disabled', peers: [] },
        nodeId: this.opts.nodeId,
        sessions: 0,
        unlock,
      };
      this.lastStatusAt = now;
      this.lastStatusValue = value;
      return value;
    }

    // 本机监听自测：真的连一次 127.0.0.1:port（不是"我以为在听"）
    const self = await tcpProbe('127.0.0.1', this.port, 1200);

    // 逐对端探测（缓存 5s：UI 每秒轮询，不能每秒都去拨所有人）
    let peerProbes = this.lastPeerProbes?.peers ?? [];
    if (!this.lastPeerProbes || now - this.lastPeerProbes.at > 5000) {
      const out: NonNullable<MeshStatusResult['link']['peers']> = [];
      for (const p of this.opts.peers().slice(0, 8)) {
        const hasSession = (this.server?.sessionList ?? []).some((s) => s.alive && s.info.remoteAddress === p.host);
        if (hasSession) {
          out.push({ nodeId: p.nodeId, host: p.host, port: p.port, reachable: true, session: true });
          continue;
        }
        const r = await tcpProbe(p.host, p.port, 1500);
        out.push({
          nodeId: p.nodeId,
          host: p.host,
          port: p.port,
          reachable: r.ok,
          ...(r.latencyMs ? { latencyMs: r.latencyMs } : {}),
          ...(r.ok ? {} : { lastError: r.error ?? 'unreachable' }),
        });
      }
      peerProbes = out;
      this.lastPeerProbes = { at: now, peers: out };
    }

    const { all, publicOnes } = listLocalAddresses();
    const localIp = pickLocalAddress(all);
    const sessions = this.sessionCount;
    const reachable = self.ok && (peerProbes.length === 0 || sessions > 0 || peerProbes.some((p) => p.reachable));
    const firstFail = peerProbes.find((p) => !p.reachable);

    const value: MeshStatusResult = {
      ok: true,
      meshEnabled: true,
      link: {
        reachable,
        ...(self.latencyMs ? { latencyMs: self.latencyMs } : {}),
        ...(reachable
          ? {}
          : { lastError: self.ok ? (firstFail?.lastError ?? 'peers-unreachable') : (self.error ?? 'not-listening') }),
        peers: peerProbes,
      },
      local: { ip: localIp, port: this.port },
      // behindNat 用证据判定：网卡里有公网地址 → false（本机可直接被拨入）
      behindNat: publicOnes.length === 0,
      ...(publicOnes.length > 0 && publicOnes[0] ? { publicIp: publicOnes[0] } : {}),
      nodeId: this.opts.nodeId,
      sessions,
      handshakeRejections: { ...(this.server?.rejectionCounts ?? {}) },
      unlock,
    };

    this.lastStatusAt = now;
    this.lastStatusValue = value;
    return value;
  }

  /** 让主进程能拿到"上次宣告失败原因"之类的诊断 */
  diagnostics(): { handshakeFailures: HandshakeFailureRecord[]; announceCalls: number; sessions: number; inbox: number } {
    return {
      handshakeFailures: this.handshakeFailures.slice(-20),
      announceCalls: this.announceCount,
      sessions: this.sessionCount,
      inbox: this.inbox.length,
    };
  }
}

/* ────────────────────────────── 回环冒烟（真握手） ────────────────────────────── */

/**
 * 双机联测的**本机冒烟**：起一个真服务器，用**另一把**临时身份连上去跑完 HS1–HS4。
 *
 * 为什么用临时身份：握手层明确拒绝"对端指纹 == 本机指纹"（自反射攻击）。
 * 旧实现（明文 JSONL、无身份）可以拿同一个 nodeId 自己连自己，鉴权实现不行 ——
 * 这不是退步，而是"自反射"本来就应该被拒绝。
 * 因此这里生成两把**一次性** Ed25519 身份，只在本函数内存里存活，用完即弃；
 * 结论只能说明"鉴权握手 + 加密记录在回环上能跑通"，**不代表**跨机可达（如实写进返回值）。
 *
 * 注意：临时身份用的是 sync-protocol 默认指纹（base32(sha256(raw))），
 * 所以这里**不注入**身份层的 derivation（注入反而会把两边指纹都对不上）。
 */
export async function secureLoopbackSmoke(opts: {
  nodeId: string;
  localPort: number;
  peerHost?: string;
  peerPort?: number;
  timeoutMs?: number;
}): Promise<{
  serverPort: number;
  loopbackOk: boolean;
  peerHost?: string;
  peerOk: boolean;
  peerError?: string;
  secure: {
    handshakeOk: boolean;
    /** 一次性身份（不是本机身份）：仅为跑通握手 */
    ephemeral: true;
    peerFingerprint: string;
    keyFingerprint?: string;
    recordRoundTrip?: boolean;
    failure?: string;
  };
}> {
  const { createEphemeralIdentity } = await import('@ccarmy/sync-protocol');
  const serverId = createEphemeralIdentity('smoke-server');
  const clientId = createEphemeralIdentity('smoke-client');

  let received: SyncMessage | null = null;
  const server = new SecureSyncServer({
    identity: serverId.provider,
    nodeId: opts.nodeId,
    port: opts.localPort > 0 ? opts.localPort : 0,
    groupId: null,
    // 冒烟：名册只放行这一把一次性身份
    roster: (fp) => fp === clientId.fingerprint,
    peerFingerprint: clientId.fingerprint,
    handshakeTimeoutMs: opts.timeoutMs ?? 8000,
    onMessage: (m) => {
      received = m;
    },
  });
  const serverPort = await server.start();

  let handshakeOk = false;
  let keyFingerprint: string | undefined;
  let failure: string | undefined;
  const client = new SecureSyncClient({
    identity: clientId.provider,
    nodeId: `${opts.nodeId}-smoke-client`,
    host: '127.0.0.1',
    port: serverPort,
    groupId: null,
    peerFingerprint: serverId.fingerprint,
    roster: (fp) => fp === serverId.fingerprint,
    handshakeTimeoutMs: opts.timeoutMs ?? 8000,
  });
  const r = await client.connect(opts.timeoutMs ?? 8000);
  if (r.ok && r.session) {
    handshakeOk = true;
    keyFingerprint = r.session.info.keyFingerprint;
    try {
      r.session.send({ to: '*', channel: 'group', payload: { text: 'loopback-hello', secure: true } });
    } catch (e) {
      failure = (e as Error).message;
    }
  } else {
    failure = r.reason ?? 'connect-failed';
  }
  // 等加密记录真的被对端解出来
  const deadline = Date.now() + 2000;
  while (!received && Date.now() < deadline) await new Promise((res) => setTimeout(res, 50));
  const arrived = received as SyncMessage | null;
  const recordRoundTrip =
    arrived !== null && ((arrived.payload as { text?: string } | null)?.text ?? '') === 'loopback-hello';

  client.close('smoke-done');
  await server.stop();

  let peerOk = false;
  let peerError: string | undefined;
  if (opts.peerHost && opts.peerPort) {
    // 对端是"另一台机器"：本机没有它的身份/名册 → 只能如实报告失败原因
    const ext = new SecureSyncClient({
      identity: clientId.provider,
      nodeId: `${opts.nodeId}-smoke-peer`,
      host: opts.peerHost,
      port: opts.peerPort,
      groupId: null,
      peerFingerprint: null,
      handshakeTimeoutMs: opts.timeoutMs ?? 8000,
    });
    const er = await ext.connect(opts.timeoutMs ?? 8000);
    peerOk = er.ok;
    peerError = er.ok ? undefined : er.reason;
    ext.close('smoke-peer-done');
  }

  return {
    serverPort,
    loopbackOk: handshakeOk && recordRoundTrip,
    ...(opts.peerHost ? { peerHost: opts.peerHost } : {}),
    peerOk,
    ...(peerError ? { peerError } : {}),
    secure: {
      handshakeOk,
      ephemeral: true,
      peerFingerprint: clientId.fingerprint,
      ...(keyFingerprint ? { keyFingerprint } : {}),
      recordRoundTrip,
      ...(failure ? { failure } : {}),
    },
  };
}

/** 便于断言：把一次探测结果压成一行（不含文案） */
export function summarizeProbe(r: ProbeNetResult): string {
  return `${r.ok ? 'ok' : 'fail'} public=${r.isPublic} outbound=${r.outboundOk} lanOnly=${r.lanOnly === true} inboundVerified=${r.inboundVerified}${r.errorCode ? ` code=${r.errorCode}` : ''}`;
}

/** 便于断言：稳定的短 id（不泄露身份信息） */
export function shortNodeId(seed: string): string {
  return crypto.createHash('sha256').update(seed).digest('hex').slice(0, 8);
}

/** 供 electron-main 判断"组网数据目录是否可写"（写不进去就别假装有落盘） */
export function ensureNetDir(userDataDir: string): { ok: boolean; dir: string; error?: string } {
  const dir = path.join(userDataDir, 'net');
  try {
    fs.mkdirSync(dir, { recursive: true });
    return { ok: true, dir };
  } catch (e) {
    return { ok: false, dir, error: (e as NodeJS.ErrnoException).code ?? 'mkdir-failed' };
  }
}
