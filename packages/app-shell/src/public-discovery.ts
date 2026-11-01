/**
 * 公开可发现（C 方案：发现开放，消息仍走用户自选服务器）。
 *
 * 只在用户**显式打开**（默认关）且配置了至少一个引导节点时启动：
 *  - DHT 只发布「签名 + 用公开发现密钥加密」的地址记录（地址/端口/指纹/别名/时间）；
 *  - 聊天内容**从不**进入发现层，消息仍由 SecureMesh 直连用户自选的服务器/主机；
 *  - 关闭后停止节点；已发布记录最多保留一个记录 TTL（30 分钟）后自然过期。
 *
 * 这是「公开可发现」的信任代价：记录内容对任何拿到公开发现密钥的人可读，
 * 因此默认关闭，且 UI 必须如实说明元数据暴露面。
 */
import {
  DhtJieDian,
  QunMiyaoHuan,
  type DhtDiZhi,
  type DhtJiLuFeng,
  type DuiduanDizhiJilu,
  type ShenfenGongyingshang,
} from '@warmy/sync-protocol';
import { sha256 } from '@warmy/sync-protocol';

/** 公开发现记录使用的固定密钥（所有人都能解 = 公开可发现；记录本身仍必须签名） */
export const GONG_KAI_FA_XIAN_MI_YAO = sha256(Buffer.from('warmy-public-discovery/1', 'utf8'));
export const GONG_KAI_FA_XIAN_DEFAULT_PORT = 7800;
export const GONG_KAI_FA_XIAN_MAX_BOOTSTRAP = 10;
/** 记录 TTL 30 分钟 ⇒ 每 10 分钟重发一次，避免在线节点被误判过期 */
export const GONG_KAI_FA_XIAN_REFRESH_MS = 10 * 60_000;

export interface GongKaiFaXianPeiZhi {
  /** 引导节点：host 或 host:port（默认 7800），最多 10 个 */
  bootstrap: string[];
  /** 本机 DHT UDP 端口（0 = 临时端口） */
  port?: number;
  /** 对外宣告的地址（缺省用 publicAddresses[0] / hosts[0] / 本机地址） */
  advertiseHost?: string;
}

export interface GongKaiFaXianZhuangTai {
  enabled: boolean;
  listening: boolean;
  udp?: { host: string; port: number };
  advertised?: { host: string; port: number };
  bootstrap: DhtDiZhi[];
  contacts: number;
  lastPublishAt?: number;
  lastPublishSeq?: number;
  lastStoredOn?: DhtDiZhi[];
  lastError?: string;
  fingerprint?: string;
  nodeId?: string;
}

export interface GongKaiFaXianQiDong {
  identity: ShenfenGongyingshang;
  nodeId: string;
  /** 本机 SecureMesh 的 TCP 端口（记录里告诉别人来这里连） */
  tcpPort: number;
  advertiseHost: string;
  bootstrap: DhtDiZhi[];
  listenHost?: string;
  listenPort?: number;
  now?: () => number;
  onEvent?: (e: { type: string; detail?: string; ts: number }) => void;
}

/** 解析 `host` / `host:port` / `[::1]:port`；不合法返回 null（不猜、不静默兜底） */
export function jieXiFaXianDiZhi(text: string, defaultPort = GONG_KAI_FA_XIAN_DEFAULT_PORT): DhtDiZhi | null {
  const raw = String(text || '').trim();
  if (!raw) return null;
  let host = raw;
  let port = defaultPort;
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    if (end < 0) return null;
    host = raw.slice(1, end);
    const rest = raw.slice(end + 1);
    if (rest) {
      if (!rest.startsWith(':')) return null;
      port = Number(rest.slice(1));
    }
  } else {
    const colons = raw.split(':').length - 1;
    if (colons > 1) return null; // 裸 IPv6 必须加方括号，否则端口有歧义
    if (colons === 1) {
      const parts = raw.split(':');
      host = parts[0] || '';
      port = Number(parts[1]);
    }
  }
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(host) && !/^[0-9a-fA-F:]+$/.test(host)) return null;
  return { host, port };
}

/** 把设置里的字符串列表归一化：去重、去空、最多 10 个；非法项如实丢弃 */
export function guiFanFaXianPeiZhi(bootstrap: unknown, defaultPort = GONG_KAI_FA_XIAN_DEFAULT_PORT): DhtDiZhi[] {
  const list = Array.isArray(bootstrap) ? bootstrap : [];
  const out: DhtDiZhi[] = [];
  const seen = new Set<string>();
  for (const x of list) {
    const a = jieXiFaXianDiZhi(String(x || ''), defaultPort);
    if (!a) continue;
    const key = `${a.host}|${a.port}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
    if (out.length >= GONG_KAI_FA_XIAN_MAX_BOOTSTRAP) break;
  }
  return out;
}

export class GongKaiFaXian {
  private node: DhtJieDian | null = null;
  private timer: NodeJS.Timeout | null = null;
  private opts: GongKaiFaXianQiDong | null = null;
  private lastPublishAt = 0;
  private lastPublishSeq = 0;
  private lastStoredOn: DhtDiZhi[] = [];
  private lastError = '';

  get enabled(): boolean {
    return !!this.node;
  }

  async start(opts: GongKaiFaXianQiDong): Promise<{ ok: boolean; error?: string; status: GongKaiFaXianZhuangTai }> {
    if (this.node) await this.stop();
    if (!opts.bootstrap.length) {
      return { ok: false, error: 'bootstrap-required', status: this.status() };
    }
    if (!Number.isInteger(opts.tcpPort) || opts.tcpPort <= 0 || opts.tcpPort > 65535) {
      return { ok: false, error: 'mesh-not-running', status: this.status() };
    }
    if (!String(opts.advertiseHost || '').trim()) {
      return { ok: false, error: 'advertise-host-required', status: this.status() };
    }
    const node = new DhtJieDian({
      identity: opts.identity,
      nodeId: opts.nodeId,
      host: opts.listenHost || '0.0.0.0',
      advertiseHost: opts.advertiseHost,
      port: Number.isInteger(opts.listenPort) ? Number(opts.listenPort) : GONG_KAI_FA_XIAN_DEFAULT_PORT,
      tcpPort: opts.tcpPort,
      groupKeys: new QunMiyaoHuan([GONG_KAI_FA_XIAN_MI_YAO]),
      signing: 'identity',
      ...(opts.now ? { now: opts.now } : {}),
      onEvent: (e) => opts.onEvent?.(e),
    });
    try {
      await node.start();
      await node.yindao(opts.bootstrap);
      this.node = node;
      this.opts = opts;
      const r = await this.publishNow();
      if (!r.ok) {
        await this.stop();
        return { ok: false, error: r.error || 'publish-failed', status: this.status() };
      }
      this.timer = setInterval(() => { void this.publishNow(); }, GONG_KAI_FA_XIAN_REFRESH_MS);
      this.timer.unref?.();
      return { ok: true, status: this.status() };
    } catch (e) {
      try { await node.stop(); } catch { /* noop */ }
      this.lastError = e instanceof Error ? e.message : String(e);
      return { ok: false, error: 'discovery-start-failed', status: this.status() };
    }
  }

  async publishNow(): Promise<{ ok: boolean; error?: string }> {
    if (!this.node || !this.opts) return { ok: false, error: 'not-running' };
    try {
      const now = this.opts.now ? this.opts.now() : Date.now();
      const record: DuiduanDizhiJilu = {
        fp: this.node.zhiWen,
        host: this.opts.advertiseHost,
        port: this.opts.tcpPort,
        scope: 'public',
        announcedAt: now,
        bieMing: this.opts.nodeId,
        extra: { kind: 'warmy-playground', public: true },
      };
      const r = await this.node.publish({ zhiWen: this.node.zhiWen, record });
      this.lastPublishAt = now;
      this.lastPublishSeq = r.seq;
      this.lastStoredOn = r.storedOn;
      this.lastError = '';
      this.opts.onEvent?.({ type: 'published', detail: `${r.storedOn.length} nodes`, ts: now });
      return { ok: true };
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      this.opts.onEvent?.({ type: 'publish-failed', detail: this.lastError, ts: Date.now() });
      return { ok: false, error: this.lastError };
    }
  }

  async query(zhiWen: string): Promise<{
    ok: boolean;
    record?: DuiduanDizhiJilu;
    error?: string;
    attempts?: unknown;
  }> {
    if (!this.node) return { ok: false, error: 'not-running' };
    try {
      const r = await this.node.query(String(zhiWen || ''));
      if (r.ok && r.record) return { ok: true, record: r.record, attempts: r.attempts };
      return { ok: false, error: 'not-found', attempts: r.attempts };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async stop(): Promise<void> {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    const n = this.node;
    this.node = null;
    this.opts = null;
    if (n) {
      try { await n.stop(); } catch { /* noop */ }
    }
  }

  status(): GongKaiFaXianZhuangTai {
    const node = this.node;
    return {
      enabled: !!node,
      listening: !!node?.listening,
      ...(node ? { udp: node.address, advertised: { host: this.opts?.advertiseHost || '', port: this.opts?.tcpPort || 0 } } : {}),
      bootstrap: this.opts?.bootstrap ?? [],
      contacts: node?.contactCount ?? 0,
      ...(this.lastPublishAt ? { lastPublishAt: this.lastPublishAt } : {}),
      ...(this.lastPublishSeq ? { lastPublishSeq: this.lastPublishSeq } : {}),
      ...(this.lastStoredOn.length ? { lastStoredOn: this.lastStoredOn.slice() } : {}),
      ...(this.lastError ? { lastError: this.lastError } : {}),
      ...(node ? { fingerprint: node.zhiWen, nodeId: this.opts?.nodeId } : {}),
    };
  }
}

export type { DhtJiLuFeng };
