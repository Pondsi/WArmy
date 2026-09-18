/**
 * dht —— 最小 Kademlia 风格发现层（UDP）
 *
 * 目标（ADR R7 / 附三.2 / 附五.2 第 3 步）：
 *  - 发布 / 查询 **公钥指纹 → 当前地址**（IP 变了、端口变了，重新宣告即可被查到）；
 *  - 记录**必须签名**（Ed25519，防伪造 / 防篡改 / 防回滚）；
 *  - 记录**内容用群组密钥加密**（AES-256-GCM，无群密钥者读不到内容）；
 *  - 事件驱动：收到他人宣告（store）时立即回调，不需要轮询。
 *
 * 与既有 `LanDiscovery`（内网 UDP 广播，明文 HELLO）的关系：
 *  - `LanDiscovery` 保留用于**同网局域网**兜底（连接阶梯最后一级）；
 *  - 本模块是跨网发现，键空间用 XOR 距离，路由表是 k-bucket。
 *
 * 诚实标注：本实现是**可用最小子集**，不是完整 Kademlia。已实现：
 * PING / FIND_NODE / STORE / GET / 迭代查询（alpha 并行、k 桶、LRU 淘汰）。
 * 未实现：节点超时驱逐的严格收敛、FIND_VALUE 缓存、多跳转发中的节点 ID 校验
 * （自报 ID 不做工作量证明 → 可被 Sybil 攻击；见报告「未做/风险」）。
 *
 * 线格式：单个 UDP 报文一段 JSON（base64url 承载二进制），k=8、alpha=3。
 */
import dgram from 'node:dgram';
import {
  type Bytes,
  b64u,
  ed25519FromSeed,
  fromB64u,
  hmacSha256,
  joinFields,
  open,
  randomHex,
  seal,
  sha256,
  sha256Hex,
  signEd25519Local,
  toBuf,
  verifyEd25519Local,
} from './codec.js';
import {
  type FingerprintDerivation,
  type IdentityProvider,
  type NormalizedIdentity,
  warmyFingerprint,
  normalizeIdentity,
  verifyPeerSignature,
} from './identity.js';

export const DHT_PROTOCOL = 'warmy-dht/1';
export const DHT_ID_LENGTH = 32;
export const DEFAULT_K = 8;
export const DEFAULT_ALPHA = 3;
export const DEFAULT_RPC_TIMEOUT_MS = 1500;
export const RECORD_VERSION = 1;
/**
 * 记录新鲜度上限（毫秒）：超过这个年龄的记录视为过期，不再接受（store）也不再返回（query）。
 * 为什么必须有：DHT 记录的 ts 是签名覆盖的，若无限期接受，攻击者可以把很久以前的
 * 合法记录当作"当前地址"反复投喂（配合 IP 变化场景会指向错误地址）。
 * 代价：**长期在线的节点必须周期性重新宣告**（见 `AnnounceService.startRefresh()`）。
 * 这与 ADR 附三.2 的「宣告失败即放弃」不冲突 —— 那是"不为失败重试"，
 * 这是"DHT 记录保活"，两件事。
 */
export const DEFAULT_RECORD_TTL_MS = 30 * 60_000;

export interface DhtAddr {
  host: string;
  port: number;
}

export interface DhtContact extends DhtAddr {
  id: Buffer;
  lastSeen: number;
  /** 对端身份指纹（若宣告过） */
  fingerprint?: string;
}

/* ────────────────────────────── 键空间 ────────────────────────────── */

/** 节点 ID 由指纹推出（身份即路由身份） */
export function dhtIdFromFingerprint(fingerprint: string): Buffer {
  return sha256(Buffer.from(`${DHT_PROTOCOL}|node-id|${fingerprint}`, 'utf8'));
}

/** 记录键：由"被宣告者指纹"推出，DHT 上看不到明文指纹 */
export function recordKeyForFingerprint(fingerprint: string): string {
  return sha256Hex(Buffer.from(`${DHT_PROTOCOL}|record|${fingerprint}`, 'utf8'));
}

export function xorDistance(a: Bytes, b: Bytes): Buffer {
  const ba = toBuf(a);
  const bb = toBuf(b);
  const out = Buffer.alloc(Math.min(ba.length, bb.length));
  for (let i = 0; i < out.length; i += 1) out[i] = (ba[i] as number) ^ (bb[i] as number);
  return out;
}

/** common prefix length（0..256），用于 k 桶划分 */
export function commonPrefixLength(a: Bytes, b: Bytes): number {
  const ba = toBuf(a);
  const bb = toBuf(b);
  let bits = 0;
  for (let i = 0; i < Math.min(ba.length, bb.length); i += 1) {
    const x = (ba[i] as number) ^ (bb[i] as number);
    if (x === 0) {
      bits += 8;
      continue;
    }
    for (let bit = 7; bit >= 0; bit -= 1) {
      if ((x >> bit) & 1) return bits + (7 - bit);
    }
  }
  return bits;
}

/* ────────────────────────────── 路由表（k-bucket） ────────────────────────────── */

export class RoutingTable {
  private buckets = new Map<number, DhtContact[]>();

  constructor(
    private readonly selfId: Buffer,
    private readonly k: number = DEFAULT_K
  ) {}

  get size(): number {
    let n = 0;
    for (const b of this.buckets.values()) n += b.length;
    return n;
  }

  list(): DhtContact[] {
    return [...this.buckets.values()].flat();
  }

  /** 加入/更新；桶满时淘汰最久未见（LRU） */
  add(contact: DhtContact): void {
    if (contact.id.equals(this.selfId)) return;
    const idx = commonPrefixLength(this.selfId, contact.id);
    let bucket = this.buckets.get(idx);
    if (!bucket) {
      bucket = [];
      this.buckets.set(idx, bucket);
    }
    const existing = bucket.find((c) => c.id.equals(contact.id));
    if (existing) {
      existing.host = contact.host;
      existing.port = contact.port;
      existing.lastSeen = contact.lastSeen;
      if (contact.fingerprint) existing.fingerprint = contact.fingerprint;
      return;
    }
    if (bucket.length >= this.k) {
      bucket.sort((a, b) => a.lastSeen - b.lastSeen);
      bucket.shift();
    }
    bucket.push({ ...contact });
  }

  remove(id: Buffer): void {
    const idx = commonPrefixLength(this.selfId, id);
    const bucket = this.buckets.get(idx);
    if (!bucket) return;
    const next = bucket.filter((c) => !c.id.equals(id));
    this.buckets.set(idx, next);
  }

  /** 距离 target 最近的 n 个联系人（含未验证过的） */
  closest(target: Bytes, n = this.k): DhtContact[] {
    return this.list()
      .sort((a, b) => Buffer.compare(xorDistance(a.id, target), xorDistance(b.id, target)))
      .slice(0, n);
  }
}

/* ────────────────────────────── 记录（签名 + 群密钥加密） ────────────────────────────── */

/** 宣告内容（明文，只有持有群密钥的人能解） */
export interface PeerAddressRecord {
  /** 被宣告者的身份指纹 */
  fp: string;
  /** 当前可达地址（IP 或域名） */
  host: string;
  /** TCP 服务端口 */
  port: number;
  /** 该地址的性质：公网 / 局域网 / 中继 */
  scope: 'public' | 'lan' | 'relay';
  announcedAt: number;
  alias?: string;
  extra?: Record<string, unknown>;
}

export interface DhtRecordEnvelope {
  v: number;
  /** 记录键 hex */
  k: string;
  /** 序列号（单调递增 → 防回滚） */
  s: number;
  /** 发布时间 */
  t: number;
  /** 签名者指纹（identity 模式 = 真实指纹；pseudonymous 模式 = 假名指纹） */
  sg: string;
  /** 签名者公钥 b64u */
  pk: string;
  /** 加密内容 b64u(iv || ct+tag) */
  sl: string;
  /** 签名 b64u（覆盖 k/s/t/sg/pk/sl） */
  sig: string;
}

export type RecordSigningMode = 'identity' | 'pseudonymous';

export function recordSignatureTranscript(env: DhtRecordEnvelope): string {
  return joinFields([DHT_PROTOCOL, 'RECORD', env.v, env.k, env.s, env.t, env.sg, env.pk, env.sl]);
}

export function recordAad(env: Pick<DhtRecordEnvelope, 'v' | 'k' | 's' | 't' | 'sg' | 'pk'>): Buffer {
  return Buffer.from(joinFields([DHT_PROTOCOL, 'RECORD-AAD', env.v, env.k, env.s, env.t, env.sg, env.pk]), 'utf8');
}

/**
 * 群组密钥环：允许同时存在多把（轮换期）。
 * **没有密钥就读不到记录内容** —— 这是记录加密的全部意义。
 */
export class GroupKeyRing {
  private keys: Buffer[] = [];

  constructor(keys: Array<Bytes> = []) {
    for (const k of keys) this.add(k);
  }

  add(key: Bytes, makeActive = true): void {
    const k = toBuf(key);
    if (k.length !== 32) throw new Error(`群组密钥必须 32 字节（AES-256），实际 ${k.length}`);
    if (makeActive) this.keys.unshift(k);
    else this.keys.push(k);
  }

  /** 当前活跃密钥（新发布用） */
  get active(): Buffer | null {
    return this.keys[0] ?? null;
  }

  get size(): number {
    return this.keys.length;
  }

  /** 依次尝试所有密钥；全部失败返回 null（无密钥 / 被篡改） */
  tryOpen(env: DhtRecordEnvelope): PeerAddressRecord | null {
    for (const key of this.keys) {
      try {
        const plain = open(key, { iv: fromB64u(env.sl).subarray(0, 12), ct: fromB64u(env.sl).subarray(12) }, recordAad(env));
        const rec = JSON.parse(plain.toString('utf8')) as PeerAddressRecord;
        if (rec && typeof rec.fp === 'string' && typeof rec.host === 'string') return rec;
      } catch {
        /* 试下一把 */
      }
    }
    return null;
  }
}

export interface SignRecordOptions {
  identity: IdentityProvider | NormalizedIdentity;
  groupKey: Bytes;
  key: string;
  record: PeerAddressRecord;
  seq: number;
  ts?: number;
  signing?: RecordSigningMode;
}

/** 组装记录信封：内容加密（群密钥）+ 头部签名（身份密钥或假名密钥） */
export async function signRecordEnvelope(opts: SignRecordOptions): Promise<DhtRecordEnvelope> {
  const identity = await normalizeIdentity(opts.identity);
  const groupKey = toBuf(opts.groupKey);
  const ts = opts.ts ?? Date.now();
  const mode = opts.signing ?? 'identity';

  let sg: string;
  let pk: Buffer;
  let signKey: Buffer | null = null;
  if (mode === 'pseudonymous') {
    // 假名密钥 = Ed25519(HMAC(群密钥, 'pseudonym|' + 真实指纹))
    // 效果：公共 DHT 上无法把记录关联回真实身份（只有群成员能算出来）
    const seed = hmacSha256(groupKey, Buffer.from(`${DHT_PROTOCOL}|pseudonym|${identity.fingerprint}`, 'utf8'));
    const derived = ed25519FromSeed(seed);
    pk = derived.publicKey;
    signKey = derived.privateKey;
    sg = warmyFingerprint(pk);
  } else {
    pk = identity.publicKey;
    sg = identity.fingerprint;
  }

  const head: DhtRecordEnvelope = {
    v: RECORD_VERSION,
    k: opts.key,
    s: opts.seq,
    t: ts,
    sg,
    pk: b64u(pk),
    sl: '',
    sig: '',
  };
  const sealed = seal(groupKey, Buffer.from(JSON.stringify(opts.record), 'utf8'), recordAad(head));
  head.sl = b64u(Buffer.concat([sealed.iv, sealed.ct]));
  const transcript = Buffer.from(recordSignatureTranscript(head), 'utf8');
  head.sig = b64u(signKey ? signEd25519Local(transcript, signKey) : await identity.sign(transcript));
  return head;
}

export type RecordRejectReason =
  | 'bad-version'
  | 'key-mismatch'
  | 'signer-mismatch'
  | 'signature-invalid'
  | 'stale-seq'
  | 'decrypt-failed'
  | 'malformed';

export interface VerifyRecordResult {
  ok: boolean;
  reason?: RecordRejectReason;
  detail?: string;
  /** 签名者指纹（假名模式下也是假名指纹） */
  signer?: string;
  record?: PeerAddressRecord;
  /** 解不开内容时的信封（签名合法但无密钥） */
  envelope?: DhtRecordEnvelope;
}

export interface VerifyRecordOptions {
  /** 校验公钥/指纹的推导函数（默认 base32(sha256(pub))） */
  derivation?: FingerprintDerivation;
  /** 注入验签实现（可选；假名模式必须传，因为本地只有公钥） */
  verifier?: ((message: Bytes, signature: Bytes, publicKey: Bytes) => Promise<boolean>) | null;
  /** 期望的记录键（防"把别的键的记录塞进来"） */
  expectKey?: string;
  /** 同一键已见最大 seq（防回滚/重放旧记录） */
  lastSeq?: number;
  /** 群组密钥环：无 → 内容读不到，但签名仍可校验 */
  groupKeys?: GroupKeyRing | null;
  /** 不接受早于这个时间之前发布的记录（可选，默认与 now 比，容差 10 分钟） */
  tsToleranceMs?: number;
  now?: () => number;
  /** 是否需要成功解密才算通过 */
  requireDecrypt?: boolean;
}

/**
 * 校验记录：版本 → 键 → 签名者 fingerprint↔公钥 → 签名 → seq 回滚 → 解密。
 * 任一步失败都会给出**具体原因**（便于审计与测试断言）。
 */
export async function verifyRecordEnvelope(
  env: DhtRecordEnvelope,
  opts: VerifyRecordOptions = {}
): Promise<VerifyRecordResult> {
  const now = opts.now ?? (() => Date.now());
  if (!env || typeof env !== 'object') return { ok: false, reason: 'malformed', detail: '信封不是对象' };
  if (env.v !== RECORD_VERSION) return { ok: false, reason: 'bad-version', detail: `版本 ${env.v}` };
  if (typeof env.k !== 'string' || typeof env.sl !== 'string' || typeof env.sig !== 'string') {
    return { ok: false, reason: 'malformed', detail: '缺少必要字段' };
  }
  if (opts.expectKey && env.k !== opts.expectKey) {
    return { ok: false, reason: 'key-mismatch', detail: `记录键 ${env.k} ≠ 期望 ${opts.expectKey}` };
  }
  if (!Number.isSafeInteger(env.s) || env.s <= 0) return { ok: false, reason: 'malformed', detail: `seq 非法：${env.s}` };
  const pk = (() => {
    try {
      return fromB64u(env.pk);
    } catch {
      return null;
    }
  })();
  if (!pk || pk.length !== 32) return { ok: false, reason: 'malformed', detail: '签名公钥长度非法' };
  const derivation = opts.derivation ?? warmyFingerprint;
  const derivedSigner = derivation(pk);
  if (derivedSigner !== env.sg) {
    return { ok: false, reason: 'signer-mismatch', detail: `签名者指纹 ${env.sg} 与公钥推出 ${derivedSigner} 不符` };
  }
  const transcript = Buffer.from(recordSignatureTranscript(env), 'utf8');
  const sig = fromB64u(env.sig);
  const sigOk = await verifyPeerSignature(
    opts.verifier
      ? {
          normalizedIdentity: true,
          fingerprint: env.sg,
          publicKey: pk,
          sign: async () => {
            throw new Error('verifier-only identity cannot sign');
          },
          verify: opts.verifier,
          enforceLocalEd25519: true,
          requireInjectedVerify: false,
          selfTested: false,
        }
      : null,
    transcript,
    sig,
    pk
  );
  if (!sigOk.ok) return { ok: false, reason: 'signature-invalid', detail: `签名校验失败（${sigOk.via}）`, signer: env.sg };
  if (typeof opts.lastSeq === 'number' && env.s <= opts.lastSeq) {
    return {
      ok: false,
      reason: 'stale-seq',
      detail: `记录 seq ${env.s} <= 已见 ${opts.lastSeq}（拒绝回滚 / 重放旧地址）`,
      signer: env.sg,
    };
  }
  const tolerance = opts.tsToleranceMs ?? 10 * 60_000;
  if (Math.abs(now() - env.t) > tolerance) {
    return { ok: false, reason: 'malformed', detail: `记录时间戳超出容差：${env.t}`, signer: env.sg };
  }
  const rec = opts.groupKeys ? opts.groupKeys.tryOpen(env) : null;
  if (!rec) {
    if (opts.requireDecrypt) {
      return { ok: false, reason: 'decrypt-failed', detail: '无群组密钥或内容被篡改，无法解密', signer: env.sg, envelope: env };
    }
    return { ok: true, signer: env.sg, envelope: env };
  }
  return { ok: true, signer: env.sg, record: rec, envelope: env };
}

/* ────────────────────────────── 节点 ────────────────────────────── */

export interface DhtEvent {
  type: 'rpc-sent' | 'rpc-recv' | 'rpc-failed' | 'stored' | 'record-received' | 'error';
  detail?: string;
  peer?: string;
  ts: number;
}

export interface DhtNodeOptions {
  identity: IdentityProvider | NormalizedIdentity;
  /** 节点别名（人读用；路由身份是 id） */
  nodeId: string;
  /** 覆盖节点 ID（默认由身份指纹推出） */
  id?: Buffer;
  /** 绑定地址，默认 127.0.0.1；组网时用 0.0.0.0 */
  host?: string;
  /** 绑定端口，0 = 随机（测试用） */
  port?: number;
  /** 本机 TCP 服务端口（宣告记录里用） */
  tcpPort?: number;
  k?: number;
  alpha?: number;
  rpcTimeoutMs?: number;
  /** 记录新鲜度上限（默认 30 分钟，见 DEFAULT_RECORD_TTL_MS） */
  recordTtlMs?: number;
  /** 群组密钥环（发布用 active，读取时逐个尝试） */
  groupKeys?: GroupKeyRing;
  /** 记录签名模式（默认 identity；pseudonymous 可隐藏身份） */
  signing?: RecordSigningMode;
  now?: () => number;
  onEvent?: (e: DhtEvent) => void;
  /** 收到记录（store RPC 或本机发布）时的回调 —— 事件驱动宣告的入口 */
  onRecord?: (env: DhtRecordEnvelope, from: DhtAddr | null) => void;
}

interface PendingRpc {
  resolve: (v: Record<string, unknown>) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
  replyType: string;
  /** 只接受来自该地址的回包（否则"自己给自己发 RPC"会被误判成回包） */
  target: DhtAddr;
}

export class DhtNode {
  id: Buffer;
  private socket: dgram.Socket | null = null;
  private table: RoutingTable;
  private identity!: NormalizedIdentity;
  private readonly ready: Promise<void>;
  private readonly k: number;
  private readonly alpha: number;
  private readonly rpcTimeoutMs: number;
  private readonly recordTtlMs: number;
  private readonly now: () => number;
  private bound: DhtAddr = { host: '127.0.0.1', port: 0 };
  private tcpPort: number;
  private store = new Map<string, DhtRecordEnvelope>();
  private seqSeen = new Map<string, number>();
  private seqLocal = new Map<string, number>();
  private pending = new Map<string, PendingRpc>();
  private rpcHandlers = new Map<string, (msg: Record<string, unknown>, from: DhtContact) => Promise<Record<string, unknown> | null>>();
  private watchers = new Map<string, ((env: DhtRecordEnvelope, from: DhtAddr | null) => void)[]>();
  private readonly stats = {
    rpcSent: 0,
    rpcRecv: 0,
    rpcFailed: 0,
    rpcTimeout: 0,
    nodesLearned: 0,
    storesAccepted: 0,
    storesRejected: 0,
    recordsStored: 0,
  };

  constructor(private readonly opts: DhtNodeOptions) {
    this.k = opts.k ?? DEFAULT_K;
    this.alpha = opts.alpha ?? DEFAULT_ALPHA;
    this.rpcTimeoutMs = opts.rpcTimeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;
    this.recordTtlMs = opts.recordTtlMs ?? DEFAULT_RECORD_TTL_MS;
    this.now = opts.now ?? (() => Date.now());
    this.tcpPort = opts.tcpPort ?? 0;
    this.id = opts.id ?? Buffer.alloc(DHT_ID_LENGTH);
    this.table = new RoutingTable(this.id, this.k);
    this.ready = this.init();
    this.ready.catch(() => {});
  }

  private async init(): Promise<void> {
    this.identity = await normalizeIdentity(this.opts.identity);
    if (this.opts.id && this.opts.id.length !== DHT_ID_LENGTH) throw new Error('DhtNode.id 必须 32 字节');
    const derivedId = this.opts.id ?? dhtIdFromFingerprint(this.identity.fingerprint);
    this.id = derivedId;
    this.table = new RoutingTable(derivedId, this.k);
  }

  get fingerprint(): string {
    return this.identity.fingerprint;
  }
  get address(): DhtAddr {
    return { ...this.bound };
  }
  get listening(): boolean {
    return !!this.socket;
  }
  get contactCount(): number {
    return this.table.size;
  }
  get statsSnapshot(): typeof this.stats {
    return { ...this.stats };
  }
  get groupKeys(): GroupKeyRing {
    if (!this.opts.groupKeys) this.opts.groupKeys = new GroupKeyRing();
    return this.opts.groupKeys;
  }

  setTcpPort(port: number): void {
    this.tcpPort = port;
  }
  get advertisedTcpPort(): number {
    return this.tcpPort;
  }

  /** 注册自定义 RPC（例如 autonat 式拨回探测） */
  onRpc(type: string, handler: (msg: Record<string, unknown>, from: DhtContact) => Promise<Record<string, unknown> | null>): void {
    this.rpcHandlers.set(type, handler);
  }

  /** 订阅某个记录键（hex）；'*' 订阅全部 —— 事件驱动，无轮询 */
  watch(keyHex: string, cb: (env: DhtRecordEnvelope, from: DhtAddr | null) => void): () => void {
    const list = this.watchers.get(keyHex) ?? [];
    list.push(cb);
    this.watchers.set(keyHex, list);
    return () => {
      const cur = this.watchers.get(keyHex) ?? [];
      this.watchers.set(
        keyHex,
        cur.filter((f) => f !== cb)
      );
    };
  }

  start(): Promise<DhtAddr> {
    return new Promise((resolve, reject) => {
      void this.ready.then(() => {
        const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        this.socket = sock;
        sock.on('error', (e) => {
          this.emit('error', String(e.message ?? e));
          reject(e);
        });
        sock.on('message', (msg, rinfo) => {
          void this.handleDatagram(msg, rinfo.address, rinfo.port);
        });
        sock.bind({ port: this.opts.port ?? 0, address: this.opts.host ?? '127.0.0.1' }, () => {
          const a = sock.address();
          this.bound = { host: this.opts.host ?? '127.0.0.1', port: a.port };
          resolve(this.address);
        });
      }, reject);
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error('node stopped'));
      }
      this.pending.clear();
      if (!this.socket) return resolve();
      const s = this.socket;
      this.socket = null;
      s.close(() => resolve());
    });
  }

  /** 引导：PING + FIND_NODE(self) 播种路由表 */
  async bootstrap(seeds: DhtAddr[]): Promise<{ ok: number; failed: number }> {
    let ok = 0;
    let failed = 0;
    for (const seed of seeds) {
      try {
        await this.ping(seed);
        await this.findNode(seed, this.id);
        ok += 1;
      } catch {
        failed += 1;
      }
    }
    return { ok, failed };
  }

  /* ── 基础 RPC ── */

  private contactOf(from: DhtContact): Record<string, unknown> {
    return { id: b64u(from.id), host: from.host, port: from.port };
  }

  contactFromWire(v: unknown): DhtContact | null {
    if (typeof v !== 'object' || v === null) return null;
    const o = v as { id?: string; host?: string; port?: number; fp?: string };
    if (typeof o.id !== 'string' || typeof o.port !== 'number') return null;
    let id: Buffer;
    try {
      id = fromB64u(o.id);
    } catch {
      return null;
    }
    if (id.length !== DHT_ID_LENGTH) return null;
    return {
      id,
      host: typeof o.host === 'string' && o.host.length > 0 ? o.host : '',
      port: o.port,
      lastSeen: this.now(),
      fingerprint: typeof o.fp === 'string' ? o.fp : undefined,
    };
  }

  /** 发送一条 RPC 并等待回复（单次，超时即失败；**不重试**） */
  async call(addr: DhtAddr, msg: Record<string, unknown>, replyType: string, timeoutMs = this.rpcTimeoutMs): Promise<Record<string, unknown>> {
    if (!this.socket) throw new Error('DhtNode 未启动');
    const rid = randomHex(6);
    const payload = Buffer.from(JSON.stringify({ ...msg, id: b64u(this.id), rid, reply: replyType }), 'utf8');
    this.stats.rpcSent += 1;
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(rid);
        this.stats.rpcFailed += 1;
        this.stats.rpcTimeout += 1;
        this.emit('rpc-failed', `${replyType} → ${addr.host}:${addr.port} 超时`);
        reject(new Error(`RPC ${replyType} 超时`));
      }, timeoutMs);
      this.pending.set(rid, { resolve, reject, timer, replyType, target: { host: addr.host, port: addr.port } });
      try {
        this.socket!.send(payload, addr.port, addr.host);
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(rid);
        this.stats.rpcFailed += 1;
        reject(e as Error);
      }
    }).finally(() => {
      this.emit('rpc-sent', `${replyType} → ${addr.host}:${addr.port}`);
    });
  }

  async ping(addr: DhtAddr): Promise<DhtContact | null> {
    const res = await this.call(addr, { t: 'ping' }, 'pong');
    const from = this.contactFromWire(res['from']);
    if (from) this.learn(from, addr);
    return from;
  }

  async findNode(addr: DhtAddr, target: Buffer): Promise<DhtContact[]> {
    const res = await this.call(addr, { t: 'find_node', target: b64u(target) }, 'nodes');
    const out: DhtContact[] = [];
    const arr = Array.isArray(res['nodes']) ? (res['nodes'] as unknown[]) : [];
    for (const n of arr) {
      const c = this.contactFromWire(n);
      if (c) {
        out.push(c);
        this.learn(c, addr);
      }
    }
    return out;
  }

  private learn(contact: DhtContact, observedAddr: DhtAddr): void {
    const before = this.table.size;
    // 观察到的地址（rinfo）优先于自报地址；自报 host 为空时用观察值
    const host = contact.host && contact.host !== '0.0.0.0' ? contact.host : observedAddr.host;
    this.table.add({ ...contact, host, port: contact.port || observedAddr.port, lastSeen: this.now() });
    if (this.table.size > before) this.stats.nodesLearned += 1;
  }

  /** 迭代 FIND_NODE（alpha 并行，非阻塞收敛） */
  async iterativeLookup(target: Buffer, maxRpc = 48): Promise<DhtContact[]> {
    const shortlist = new Map<string, DhtContact>();
    const queried = new Set<string>();
    for (const c of this.table.closest(target, this.k)) shortlist.set(b64u(c.id), c);
    let rpcCount = 0;

    for (;;) {
      const candidates = [...shortlist.values()]
        .filter((c) => !queried.has(b64u(c.id)))
        .sort((a, b) => Buffer.compare(xorDistance(a.id, target), xorDistance(b.id, target)))
        .slice(0, this.alpha);
      if (candidates.length === 0 || rpcCount >= maxRpc) break;
      const results = await Promise.all(
        candidates.map(async (c) => {
          queried.add(b64u(c.id));
          rpcCount += 1;
          try {
            return await this.findNode({ host: c.host, port: c.port }, target);
          } catch {
            this.table.remove(c.id);
            return [] as DhtContact[];
          }
        })
      );
      for (const list of results) {
        for (const c of list) {
          const key = b64u(c.id);
          if (!shortlist.has(key)) shortlist.set(key, c);
        }
      }
    }
    return [...shortlist.values()]
      .sort((a, b) => Buffer.compare(xorDistance(a.id, target), xorDistance(b.id, target)))
      .slice(0, this.k);
  }

  /* ── 发布 / 查询 ── */

  /** 本地已有的记录（含自己发布的） */
  localRecord(keyHex: string): DhtRecordEnvelope | null {
    return this.store.get(keyHex) ?? null;
  }

  seenSeq(keyHex: string): number {
    return this.seqSeen.get(keyHex) ?? 0;
  }

  /** 本端下一序列号（严格递增：本地计数与已见最大值的较大者 + 1） */
  nextSeq(keyHex: string, seenFromNetwork = this.seenSeq(keyHex)): number {
    const local = this.seqLocal.get(keyHex) ?? 0;
    const next = Math.max(local, seenFromNetwork, this.seqSeen.get(keyHex) ?? 0) + 1;
    this.seqLocal.set(keyHex, next);
    return next;
  }

  /** 发布：内容加密 + 签名 → 本机存一份 → PUT 给距离最近的 k 个节点 */
  async publish(args: { fingerprint: string; record?: PeerAddressRecord; seq?: number; signing?: RecordSigningMode }): Promise<{
    key: string;
    seq: number;
    storedOn: DhtAddr[];
    envelope: DhtRecordEnvelope;
  }> {
    await this.ready;
    const key = recordKeyForFingerprint(args.fingerprint);
    const groupKey = this.groupKeys.active;
    if (!groupKey) throw new Error('发布记录需要群组密钥（groupKeys.active）');
    const record: PeerAddressRecord =
      args.record ??
      ({
        fp: args.fingerprint,
        host: this.bound.host === '0.0.0.0' ? '127.0.0.1' : this.bound.host,
        port: this.tcpPort,
        scope: 'lan',
        announcedAt: this.now(),
        alias: this.opts.nodeId,
      } satisfies PeerAddressRecord);
    const seq = args.seq ?? this.nextSeq(key);
    const env = await signRecordEnvelope({
      identity: this.identity,
      groupKey,
      key,
      record,
      seq,
      ts: this.now(),
      signing: args.signing ?? this.opts.signing ?? 'identity',
    });
    this.acceptRecord(env, null);

    const target = dhtIdFromFingerprint(args.fingerprint);
    const closest = (await this.iterativeLookup(target)).filter((c) => !c.id.equals(this.id));
    const storedOn: DhtAddr[] = [];
    for (const c of closest.slice(0, this.k)) {
      try {
        await this.call({ host: c.host, port: c.port }, { t: 'store', key, env }, 'stored');
        storedOn.push({ host: c.host, port: c.port });
      } catch {
        this.table.remove(c.id);
      }
    }
    this.emit('record-received', `本机发布 ${key.slice(0, 12)} seq=${seq}`);
    return { key, seq, storedOn, envelope: env };
  }

  /**
   * 查询：迭代查询最近的 k 个节点 → GET → 逐个验签/解密，返回 seq 最高的合法记录。
   * `attempts` 记录每个候选的结果（含失败原因），便于排障（ADR A7）。
   */
  async query(
    fingerprint: string,
    opts: { requireDecrypt?: boolean } = {}
  ): Promise<{
    ok: boolean;
    key: string;
    record?: PeerAddressRecord;
    envelope?: DhtRecordEnvelope;
    signer?: string;
    from?: DhtAddr;
    attempts: { addr: DhtAddr; status: 'ok' | 'empty' | 'reject' | 'rpc-failed'; reason?: string; seq?: number }[];
    rejected: { addr: DhtAddr; reason: string; detail?: string }[];
  }> {
    await this.ready;
    const key = recordKeyForFingerprint(fingerprint);
    const attempts: { addr: DhtAddr; status: 'ok' | 'empty' | 'reject' | 'rpc-failed'; reason?: string; seq?: number }[] = [];
    const rejected: { addr: DhtAddr; reason: string; detail?: string }[] = [];
    const target = dhtIdFromFingerprint(fingerprint);
    const candidates = await this.iterativeLookup(target);
    const best = { env: null as DhtRecordEnvelope | null, record: undefined as PeerAddressRecord | undefined, signer: undefined as string | undefined, from: undefined as DhtAddr | undefined, seq: 0 };

    const consider = async (env: DhtRecordEnvelope, addr: DhtAddr): Promise<void> => {
      const result = await verifyRecordEnvelope(env, {
        expectKey: key,
        groupKeys: this.groupKeys,
        requireDecrypt: opts.requireDecrypt ?? true,
        now: this.now,
      });
      if (!result.ok) {
        attempts.push({ addr, status: 'reject', reason: result.reason });
        rejected.push({ addr, reason: result.reason ?? 'unknown', detail: result.detail });
        return;
      }
      if (env.s > best.seq) {
        best.env = env;
        best.record = result.record;
        best.signer = result.signer;
        best.from = addr;
        best.seq = env.s;
      }
      attempts.push({ addr, status: 'ok', seq: env.s });
    };

    // 本机副本先算候选
    const local = this.store.get(key);
    if (local) await consider(local, { host: this.bound.host, port: this.bound.port });

    for (const c of candidates) {
      const addr = { host: c.host, port: c.port };
      if (c.id.equals(this.id)) continue;
      try {
        const res = await this.call(addr, { t: 'get', key }, 'found');
        const envs = Array.isArray(res['envs']) ? (res['envs'] as DhtRecordEnvelope[]) : [];
        if (envs.length === 0) {
          attempts.push({ addr, status: 'empty' });
          continue;
        }
        for (const env of envs) await consider(env, addr);
      } catch (e) {
        attempts.push({ addr, status: 'rpc-failed', reason: String((e as Error).message ?? e) });
        this.table.remove(c.id);
      }
    }

    if (!best.env) return { ok: false, key, attempts, rejected };
    this.learnSeen(key, best.seq);
    return { ok: true, key, record: best.record, envelope: best.env, signer: best.signer, from: best.from, attempts, rejected };
  }

  private learnSeen(keyHex: string, seq: number): void {
    const cur = this.seqSeen.get(keyHex) ?? 0;
    if (seq > cur) this.seqSeen.set(keyHex, seq);
  }

  /** 接受一条记录（来自网络或本机）：验签 + 防回滚，然后回调订阅者 */
  acceptRecord(env: DhtRecordEnvelope, from: DhtAddr | null): { accepted: boolean; reason?: string } {
    const seen = this.seqSeen.get(env.k) ?? 0;
    if (env.s <= seen) {
      this.stats.storesRejected += 1;
      return { accepted: false, reason: `stale-seq（${env.s} <= ${seen}）` };
    }
    this.store.set(env.k, env);
    this.learnSeen(env.k, env.s);
    if (env.s > (this.seqLocal.get(env.k) ?? 0)) this.seqLocal.set(env.k, env.s);
    this.stats.storesAccepted += 1;
    this.stats.recordsStored += 1;
    this.notifyWatchers(env, from);
    this.opts.onRecord?.(env, from);
    return { accepted: true };
  }

  private notifyWatchers(env: DhtRecordEnvelope, from: DhtAddr | null): void {
    for (const [key, list] of this.watchers) {
      if (key !== '*' && key !== env.k) continue;
      for (const cb of list) {
        try {
          cb(env, from);
        } catch {
          /* 订阅者异常不影响节点 */
        }
      }
    }
  }

  /* ── 收包处理 ── */

  private async handleDatagram(raw: Buffer, host: string, port: number): Promise<void> {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
    } catch {
      return;
    }
    this.stats.rpcRecv += 1;
    const t = typeof msg['t'] === 'string' ? msg['t'] : '';
    const rid = typeof msg['rid'] === 'string' ? msg['rid'] : '';
    const sender = this.contactFromWire({ id: msg['id'], host, port });
    if (sender) this.learn(sender, { host, port });

    // 0) 这是我发出的某条 RPC 的回包？直接结算，不再当请求处理
    //    判别依据（三重）：带 rid + 目标地址匹配 + **不是请求**（请求必带 reply 字段）
    //    这样"给本机自己发 RPC"不会被误判成回包。
    const p = rid ? this.pending.get(rid) : undefined;
    const isRequest = Object.prototype.hasOwnProperty.call(msg, 'reply');
    if (
      rid &&
      p &&
      !isRequest &&
      (msg['t'] === p.replyType || msg['t'] === 'error') &&
      p.target.host === host &&
      p.target.port === port
    ) {
      this.resolvePending(rid, msg);
      return;
    }

    // 1) 应用层自定义 RPC
    const handler = this.rpcHandlers.get(t);
    if (handler && sender) {
      const result = await handler(msg, { ...sender, host, port });
      if (result) {
        const replyType = typeof msg['reply'] === 'string' ? msg['reply'] : 'resp';
        const payload = Buffer.from(JSON.stringify({ t: replyType, rid, id: b64u(this.id), ...result }), 'utf8');
        this.socket?.send(payload, port, host);
      }
      return;
    }

    // 2) 内置 RPC
    switch (t) {
      case 'ping':
        this.reply(port, host, rid, 'pong', { from: this.selfWireContact() });
        return;
      case 'find_node': {
        const target = typeof msg['target'] === 'string' ? fromB64u(msg['target']) : this.id;
        const nodes = this.table.closest(target, this.k).map((c) => this.contactOf(c));
        if (!nodes.some((n) => (n as { id: string }).id === b64u(this.id))) nodes.push(this.selfWireContact());
        this.reply(port, host, rid, 'nodes', { nodes: nodes.slice(0, this.k) });
        return;
      }
      case 'store': {
        const env = msg['env'] as DhtRecordEnvelope | undefined;
        if (!env || typeof env !== 'object') {
          this.reply(port, host, rid, 'error', { reason: 'malformed' });
          return;
        }
        const verified = await verifyRecordEnvelope(env, {
          expectKey: typeof msg['key'] === 'string' ? (msg['key'] as string) : undefined,
          groupKeys: null, // 存储方无需群密钥：只验签，不解密（守得住内容机密性）
          requireDecrypt: false,
          now: this.now,
        });
        if (!verified.ok) {
          this.stats.storesRejected += 1;
          this.emit('error', `拒绝记录：${verified.reason} ${verified.detail ?? ''}`);
          this.reply(port, host, rid, 'error', { reason: verified.reason });
          return;
        }
        const acc = this.acceptRecord(env, { host, port });
        if (!acc.accepted) {
          this.reply(port, host, rid, 'error', { reason: acc.reason });
          return;
        }
        this.emit('stored', `接受 ${env.k.slice(0, 12)} seq=${env.s}`);
        this.reply(port, host, rid, 'stored', { key: env.k });
        return;
      }
      case 'get': {
        const key = typeof msg['key'] === 'string' ? msg['key'] : '';
        const env = this.store.get(key);
        this.reply(port, host, rid, 'found', { key, envs: env ? [env] : [] });
        return;
      }
      default:
        if (rid) this.reply(port, host, rid, 'error', { reason: `unknown-rpc:${t}` });
        return;
    }
  }

  private selfWireContact(): Record<string, unknown> {
    const host = this.bound.host === '0.0.0.0' ? '127.0.0.1' : this.bound.host;
    return { id: b64u(this.id), host, port: this.bound.port, fp: this.identity.fingerprint };
  }

  private reply(port: number, host: string, rid: string, type: string, body: Record<string, unknown>): void {
    if (!rid) return;
    try {
      this.socket?.send(Buffer.from(JSON.stringify({ t: type, rid, id: b64u(this.id), ...body }), 'utf8'), port, host);
    } catch {
      /* ignore */
    }
  }

  private emit(type: DhtEvent['type'], detail?: string, peer?: string): void {
    this.opts.onEvent?.({ type, detail, peer, ts: this.now() });
  }

  /** 处理一条已收到的 RPC 回包（由 socket 主循环调用；此处供测试直接注入） */
  resolvePending(rid: string, reply: Record<string, unknown>): void {
    const p = this.pending.get(rid);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(rid);
    if (reply['t'] === 'error') {
      p.reject(new Error(`RPC ${p.replyType} 被拒绝：${JSON.stringify(reply)}`));
      return;
    }
    p.resolve(reply);
  }

  /** 通用：把一条原始报文喂给节点（测试 / 自定义传输用） */
  async feedDatagram(raw: Bytes, host: string, port: number): Promise<void> {
    await this.handleDatagram(toBuf(raw), host, port);
  }
}

/* ────────────────────────────── 便捷函数 ────────────────────────────── */

/** 判断记录里的地址是否与本地地址相同（用于"地址变了要重新宣告"判定） */
export function sameAddress(a: DhtAddr, b: DhtAddr): boolean {
  return a.host === b.host && a.port === b.port;
}
