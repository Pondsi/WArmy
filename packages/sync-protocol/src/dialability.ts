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
import { suiJiShiLiuJin } from './codec.js';
import type { DhtDiZhi } from './dht.js';
import { type Ipv6Zuoyongyu, type Ipv6Baogao, guiLeiIpv6ZuoYongYu, jianchaBenjiIpv6, quZhuJiIpJiazu, guiFanZhuJiZiMian, jieXiIpv4ZiJie } from './ladder.js';

export type DizhiZuoyongyu = 'loopback' | 'private' | 'link-local' | 'public' | 'hostname' | 'unknown';

/**
 * 地址性质判定（IPv4 + IPv6 都按**数值范围**判，不靠字符串前缀猜）。
 * IPv6：全局单播 `2000::/3` → public；ULA `fc00::/7` → private；`fe80::/10` → link-local；
 * `::1` → loopback；组播/未指定/非法 → unknown；`::ffff:a.b.c.d` 按内嵌 IPv4 判。
 */
export function guiLeiDiZhi(host: string): DizhiZuoyongyu {
  const h = guiFanZhuJiZiMian(host);
  if (h === 'localhost' || h === '') return h === '' ? 'unknown' : 'loopback';
  const v4 = jieXiIpv4ZiJie(h);
  if (v4) {
    const a = v4[0] as number;
    const b = v4[1] as number;
    if (a === 127) return 'loopback';
    if (a === 10) return 'private';
    if (a === 172 && b >= 16 && b <= 31) return 'private';
    if (a === 192 && b === 168) return 'private';
    if (a === 169 && b === 254) return 'link-local';
    if (a === 100 && b >= 64 && b <= 127) return 'private'; // CGNAT 100.64/10
    if (a === 0) return 'unknown';
    return 'public';
  }
  if (quZhuJiIpJiazu(h) !== 6) return 'hostname';
  const scope: Ipv6Zuoyongyu = guiLeiIpv6ZuoYongYu(h);
  if (scope === 'global') return 'public';
  if (scope === 'ula') return 'private';
  if (scope === 'link-local') return 'link-local';
  if (scope === 'loopback') return 'loopback';
  if (scope === 'ipv4-mapped') {
    const tail = h.split(':').slice(-1)[0] as string;
    return jieXiIpv4ZiJie(tail) ? guiLeiDiZhi(tail) : 'unknown';
  }
  return 'unknown';
}

/** 本机 IPv6 事实（附八.9：IPv6 无 NAT ⇒ 有全局单播地址就是天然可拨入候选，无需打洞） */
export interface KeBoRuIpv6XinXi {
  hasGlobalUnicast: boolean;
  publicCandidate: string | null;
  global: string[];
  ula: string[];
  linkLocal: string[];
  loopback: string[];
  documentation: string[];
  /** 枚举时实际见到的 family 写法（'IPv6' 字符串 / 6 数字，两种都要认） */
  familyFormsSeen: (string | number)[];
  /** 有全局单播 IPv6 ⇒ **天然可拨入候选**（无需打洞/中继） */
  naturalDialableCandidate: boolean;
  reason: string;
}

/** 可拨入性结论的**结构化类型**（UI/接线方按它选文案，不靠解析句子） */
export type KeBoRuZhongLei =
  /** 有对端真的拨回来了（最强证据） */
  | 'peer-verified'
  /** 本机有全局单播 IPv6 ⇒ 天然可拨入候选（无 NAT；尚未被对端验证） */
  | 'ipv6-global-natural'
  /** 没有可用探测对端 → **无法判定**（不是"不可拨入"） */
  | 'undetermined'
  /** 有对端但全部拨入失败 → 判定不可拨入 */
  | 'undialable';

export const DIALABILITY_I18N: Record<KeBoRuZhongLei, string> = {
  'peer-verified': 'net.dialability.peerVerified',
  'ipv6-global-natural': 'net.dialability.ipv6Natural',
  undetermined: 'net.dialability.undetermined',
  undialable: 'net.dialability.undialable',
};

export interface KeBoRuDuiDuan {
  zhiWen: string;
  nodeId?: string;
  addr: DhtDiZhi;
}

export interface BoHuiChangShi {
  peer: string;
  peerAddr: DhtDiZhi;
  ok: boolean;
  /** 对端报告：它用什么本地地址连上的（用于诊断，不等于公网映射） */
  observed?: string;
  error?: string;
}

export interface KeBoRuJieGuo {
  /** 至少有一个对端成功拨回本机宣告的地址 */
  dialable: boolean;
  /** 宣告地址的性质 */
  scope: DizhiZuoyongyu;
  advertised: DhtDiZhi;
  /** 成功拨回的对端指纹 */
  verifiedBy: string[];
  attempts: BoHuiChangShi[];
  /** 这次结论能覆盖的范围（诚实标注） */
  verifiedFrom: 'loopback' | 'lan-peers' | 'public-peers' | 'none';
  reason: string;
  checkedAt: number;
  /** 结构化结论类型（见 DialableKind） */
  dialableKind: KeBoRuZhongLei;
  /** 本机有全局单播 IPv6 ⇒ 天然可拨入候选，无需打洞（附八.9） */
  naturalDialable: boolean;
  /** 本机 IPv6 事实细节 */
  ipv6: KeBoRuIpv6XinXi;
  /** i18n key 建议（主代理接文案用） */
  i18n: string;
}

export function boHuiXiaoXi(token: string, addr: DhtDiZhi): Record<string, unknown> {
  return { t: 'dial_me', reply: 'dial_result', token, addr: { host: addr.host, port: addr.port } };
}

export interface KeBoRuTanCeXuanXiang {
  zhiWen: string;
  nodeId: string;
  /** 本机 TCP 监听地址（我们希望别人拨进来的那个） */
  advertised: () => DhtDiZhi;
  /** 可用的探测对端（来自 DHT 路由表 / 群名册） */
  peers: () => KeBoRuDuiDuan[];
  /** 发送 RPC（通常接 DhtNode.call） */
  sendRpc: (addr: DhtDiZhi, xiaoXi: Record<string, unknown>, replyType: string, timeoutMs?: number) => Promise<Record<string, unknown>>;
  /** 每次探测的 token 生成器（防重放/串用） */
  token?: () => string;
  timeoutMs?: number;
  maxPeers?: number;
  /** 本机 IPv6 事实（默认真实枚举网卡；可注入以便验证分类矩阵） */
  localIpv6?: () => Ipv6Baogao;
  now?: () => number;
}

export class KeBoRuTanCe {
  constructor(private readonly opts: KeBoRuTanCeXuanXiang) {}

  /** 注册到 DHT 上的「拨回」处理器（被请求方 = 真的去连一次） */
  static handler(ctx: {
    dialTcp: (host: string, port: number, timeoutMs: number) => Promise<{ ok: boolean; detail?: string; localAddress?: string; localPort?: number }>;
    timeoutMs?: number;
  }): (xiaoXi: Record<string, unknown>, from: { host: string; port: number }) => Promise<Record<string, unknown> | null> {
    return async (xiaoXi) => {
      const addr = xiaoXi['addr'] as { host?: string; port?: number } | undefined;
      const token = typeof xiaoXi['token'] === 'string' ? xiaoXi['token'] : '';
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
  async probe(): Promise<KeBoRuJieGuo> {
    const now = this.opts.now ?? (() => Date.now());
    const advertised = this.opts.advertised();
    const scope = guiLeiDiZhi(advertised.host);
    const peers = this.opts.peers().slice(0, this.opts.maxPeers ?? 5);
    const attempts: BoHuiChangShi[] = [];
    const verifiedBy: string[] = [];

    for (const peer of peers) {
      const token = (this.opts.token ?? (() => suiJiShiLiuJin(8)))();
      try {
        const res = await this.opts.sendRpc(peer.addr, boHuiXiaoXi(token, advertised), 'dial_result', this.opts.timeoutMs ?? 4000);
        const ok = res['ok'] === true && (res['token'] === undefined || res['token'] === token);
        attempts.push({
          peer: peer.zhiWen,
          peerAddr: peer.addr,
          ok,
          observed: typeof res['observed'] === 'string' ? res['observed'] : undefined,
          error: ok ? undefined : typeof res['error'] === 'string' ? res['error'] : '对端拨入失败',
        });
        if (ok) verifiedBy.push(peer.zhiWen);
      } catch (e) {
        attempts.push({ peer: peer.zhiWen, peerAddr: peer.addr, ok: false, error: String((e as Error).message ?? e) });
      }
    }

    const duiDuanZuoyongYuJi = peers.map((p) => guiLeiDiZhi(p.addr.host));
    let verifiedFrom: KeBoRuJieGuo['verifiedFrom'] = 'none';
    if (verifiedBy.length > 0) {
      if (duiDuanZuoyongYuJi.some((s) => s === 'public' || s === 'hostname')) verifiedFrom = 'public-peers';
      else if (duiDuanZuoyongYuJi.some((s) => s === 'private')) verifiedFrom = 'lan-peers';
      else verifiedFrom = 'loopback';
    }
    const dialable = verifiedBy.length > 0;
    // 附八.9：IPv6 可达性是**独立的一档**，且是"天然可拨入候选"（IPv6 无 NAT）
    const v6: Ipv6Baogao = (this.opts.localIpv6 ?? jianchaBenjiIpv6)();
    const ipv6: KeBoRuIpv6XinXi = {
      hasGlobalUnicast: v6.hasGlobalUnicast,
      publicCandidate: v6.publicCandidate,
      global: v6.global,
      ula: v6.ula,
      linkLocal: v6.linkLocal,
      loopback: v6.loopback,
      documentation: v6.documentation,
      familyFormsSeen: v6.familyFormsSeen,
      naturalDialableCandidate: v6.hasGlobalUnicast,
      reason: v6.reason,
    };
    const jiBenYuanyin = dialable
      ? verifiedFrom === 'public-peers'
        ? '有公网/域名对端成功拨入本机宣告地址 → 外部可拨入'
        : verifiedFrom === 'lan-peers'
          ? '私网对端成功拨入本机宣告地址 → 同网可拨入；公网可达性未验证（缺公网对端）'
          : '仅回环/同机对端成功拨入 → 只能证明同机可达；公网与局域网可达性均未验证（本机双实例环境限制）'
      : peers.length === 0
        ? '没有可用探测对端（路由表为空）→ 无法判定'
        : `全部 ${attempts.length} 个对端拨入失败（${attempts.map((a) => a.error).filter(Boolean).slice(0, 3).join(' / ')}）→ 判定为不可拨入`;
    const ipv6Beizhu = ipv6.hasGlobalUnicast
      ? `；另：本机有全局单播 IPv6 ${ipv6.publicCandidate ?? ''}（IPv6 无 NAT）→ **天然可拨入候选，无需打洞**（仅地址事实，不等于已验证公网可达）`
      : '；本机没有全局单播 IPv6（IPv6 档不适用）';
    const reason = `${jiBenYuanyin}${ipv6Beizhu}`;
    const dialableKind: KeBoRuZhongLei = dialable
      ? 'peer-verified'
      : ipv6.naturalDialableCandidate
        ? 'ipv6-global-natural'
        : peers.length === 0
          ? 'undetermined'
          : 'undialable';

    return {
      dialable,
      scope,
      advertised,
      verifiedBy,
      attempts,
      verifiedFrom,
      reason,
      checkedAt: now(),
      dialableKind,
      naturalDialable: ipv6.naturalDialableCandidate,
      ipv6,
      i18n: DIALABILITY_I18N[dialableKind],
    };
  }
}
