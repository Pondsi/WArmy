/**
 * dialability —— 可拨入检测（autonat 思路）
 *
 * 思路（与 libp2p autonat 一致）：**不要在本机自测**（本机永远能连自己），
 * 而是请对端**真的拨回来**：我们告诉对端"我现在监听在 addr"，
 * 对端按 addr 发起 TCP 连接；连接成功 = 从对端所处的网络位置看，我们可被拨入。
 *
 * ADR §2.6 说"检测复用 autonat，比自制检测按钮可靠"——本模块就是那个"被请求方拨回"的
 * 最小实现。它复用 DHT 的 RPC 通道（`dial_me` / `dial_result`），不新增依赖。
 *
 * 诚实边界（必须看清）：
 *  - 用回环 / 私网对端拨回，只证明"**那个位置**能连上你"，**不等于**公网可达；
 *  - 真实公网可达性需要一台**真的在公网**的对端（本仓库环境无第二台真机、无公网出口）
 *    → 属**未验证**。`reason` 字段会明确写出验证到的范围。
 *  - UPnP 映射成功的判定需要真实路由器 → **未实现**。
 */
import { randomHex } from './codec.js';
import type { DhtAddr } from './dht.js';

export type AddressScope = 'loopback' | 'private' | 'link-local' | 'public' | 'hostname' | 'unknown';

export function classifyAddress(host: string): AddressScope {
  if (/^127\./.test(host) || host === '::1' || host === 'localhost') return 'loopback';
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 10) return 'private';
    if (a === 172 && b >= 16 && b <= 31) return 'private';
    if (a === 192 && b === 168) return 'private';
    if (a === 169 && b === 254) return 'link-local';
    if (a === 100 && b >= 64 && b <= 127) return 'private'; // CGNAT 100.64/10
    if (a === 0) return 'unknown';
    return 'public';
  }
  if (/^[0-9a-f:]+$/i.test(host) && host.includes(':')) {
    const lower = host.toLowerCase();
    if (lower === '::1') return 'loopback';
    if (lower.startsWith('fe80')) return 'link-local';
    if (lower.startsWith('fc') || lower.startsWith('fd')) return 'private';
    return 'public';
  }
  return 'hostname';
}

export interface DialabilityPeer {
  fingerprint: string;
  nodeId?: string;
  addr: DhtAddr;
}

export interface DialBackAttempt {
  peer: string;
  peerAddr: DhtAddr;
  ok: boolean;
  /** 对端报告：它用什么本地地址连上的（用于诊断，不等于公网映射） */
  observed?: string;
  error?: string;
}

export interface DialabilityResult {
  /** 至少有一个对端成功拨回本机宣告的地址 */
  dialable: boolean;
  /** 宣告地址的性质 */
  scope: AddressScope;
  advertised: DhtAddr;
  /** 成功拨回的对端指纹 */
  verifiedBy: string[];
  attempts: DialBackAttempt[];
  /** 这次结论能覆盖的范围（诚实标注） */
  verifiedFrom: 'loopback' | 'lan-peers' | 'public-peers' | 'none';
  reason: string;
  checkedAt: number;
}

export function dialBackMessage(token: string, addr: DhtAddr): Record<string, unknown> {
  return { t: 'dial_me', reply: 'dial_result', token, addr: { host: addr.host, port: addr.port } };
}

export interface DialabilityProbeOptions {
  fingerprint: string;
  nodeId: string;
  /** 本机 TCP 监听地址（我们希望别人拨进来的那个） */
  advertised: () => DhtAddr;
  /** 可用的探测对端（来自 DHT 路由表 / 群名册） */
  peers: () => DialabilityPeer[];
  /** 发送 RPC（通常接 DhtNode.call） */
  sendRpc: (addr: DhtAddr, msg: Record<string, unknown>, replyType: string, timeoutMs?: number) => Promise<Record<string, unknown>>;
  /** 每次探测的 token 生成器（防重放/串用） */
  token?: () => string;
  timeoutMs?: number;
  maxPeers?: number;
  now?: () => number;
}

export class DialabilityProbe {
  constructor(private readonly opts: DialabilityProbeOptions) {}

  /** 注册到 DHT 上的「拨回」处理器（被请求方 = 真的去连一次） */
  static handler(ctx: {
    dialTcp: (host: string, port: number, timeoutMs: number) => Promise<{ ok: boolean; detail?: string; localAddress?: string; localPort?: number }>;
    timeoutMs?: number;
  }): (msg: Record<string, unknown>, from: { host: string; port: number }) => Promise<Record<string, unknown> | null> {
    return async (msg) => {
      const addr = msg['addr'] as { host?: string; port?: number } | undefined;
      const token = typeof msg['token'] === 'string' ? msg['token'] : '';
      if (!addr || typeof addr.host !== 'string' || typeof addr.port !== 'number') {
        return { ok: false, token, error: 'malformed-addr' };
      }
      const r = await ctx.dialTcp(addr.host, addr.port, ctx.timeoutMs ?? 2500);
      return {
        token,
        ok: r.ok,
        observed: r.ok ? `${r.localAddress ?? '?'}:${r.localPort ?? '?'}` : undefined,
        error: r.ok ? undefined : r.detail,
      };
    };
  }

  /** 发起检测：请若干对端拨回本机宣告的地址 */
  async probe(): Promise<DialabilityResult> {
    const now = this.opts.now ?? (() => Date.now());
    const advertised = this.opts.advertised();
    const scope = classifyAddress(advertised.host);
    const peers = this.opts.peers().slice(0, this.opts.maxPeers ?? 5);
    const attempts: DialBackAttempt[] = [];
    const verifiedBy: string[] = [];

    for (const peer of peers) {
      const token = (this.opts.token ?? (() => randomHex(8)))();
      try {
        const res = await this.opts.sendRpc(peer.addr, dialBackMessage(token, advertised), 'dial_result', this.opts.timeoutMs ?? 4000);
        const ok = res['ok'] === true && (res['token'] === undefined || res['token'] === token);
        attempts.push({
          peer: peer.fingerprint,
          peerAddr: peer.addr,
          ok,
          observed: typeof res['observed'] === 'string' ? res['observed'] : undefined,
          error: ok ? undefined : typeof res['error'] === 'string' ? res['error'] : '对端拨入失败',
        });
        if (ok) verifiedBy.push(peer.fingerprint);
      } catch (e) {
        attempts.push({ peer: peer.fingerprint, peerAddr: peer.addr, ok: false, error: String((e as Error).message ?? e) });
      }
    }

    const peerScopes = peers.map((p) => classifyAddress(p.addr.host));
    let verifiedFrom: DialabilityResult['verifiedFrom'] = 'none';
    if (verifiedBy.length > 0) {
      if (peerScopes.some((s) => s === 'public' || s === 'hostname')) verifiedFrom = 'public-peers';
      else if (peerScopes.some((s) => s === 'private')) verifiedFrom = 'lan-peers';
      else verifiedFrom = 'loopback';
    }
    const dialable = verifiedBy.length > 0;
    const reason = dialable
      ? verifiedFrom === 'public-peers'
        ? '有公网/域名对端成功拨入本机宣告地址 → 外部可拨入'
        : verifiedFrom === 'lan-peers'
          ? '私网对端成功拨入本机宣告地址 → 同网可拨入；公网可达性未验证（缺公网对端）'
          : '仅回环/同机对端成功拨入 → 只能证明同机可达；公网与局域网可达性均未验证（本机双实例环境限制）'
      : peers.length === 0
        ? '没有可用探测对端（路由表为空）→ 无法判定'
        : `全部 ${attempts.length} 个对端拨入失败（${attempts.map((a) => a.error).filter(Boolean).slice(0, 3).join(' / ')}）→ 判定为不可拨入`;

    return { dialable, scope, advertised, verifiedBy, attempts, verifiedFrom, reason, checkedAt: now() };
  }
}
