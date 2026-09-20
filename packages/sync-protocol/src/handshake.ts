/**
 * handshake —— 鉴权握手（Ed25519 身份认证 + X25519 ECDHE + AES-256-GCM 确认）
 *
 * 设计要点（对齐 ADR 003 §2.3 / R2 / R3）：
 *  - **身份认证**：双方用长期 Ed25519 身份签名，签名绑定 raw 公钥；
 *    指纹必须由公钥推出（`warmyFingerprint`），因此「换公钥不换指纹」必然失败。
 *  - **前向保密**：会话密钥来自 **X25519 ECDHE 临时密钥**（每次连接新生成），
 *    **不使用 RSA 密钥传输**；长期私钥泄露也解不开过去的流量。
 *  - **每连接一次**：会话密钥每个 TCP 连接协商一次，不做「每条消息重握手」；
 *    长连接的刷新走 `SecureChannel.requestKeyUpdate()`（TLS 1.3 KeyUpdate 思路）。
 *  - **防重放**：`nonce`（16 字节随机，窗口内不得重复）+ **单调计数**（严格递增）+
 *    **时间戳容差**（默认 ±120s）。三者任一不符即拒绝，且拒绝发生在**验签之后**，
 *    攻击者无法用伪造消息烧掉合法对端的计数。
 *  - **transcript 绑定**：HS1 绑定「被叫方指纹」（若已知），HS2 绑定 HS1 的哈希，
 *    确认帧绑定完整 transcript —— 消息无法跨节点反射或跨连接重放。
 *  - 四次飞行：HS1 → HS2 → HS3（发起方确认）→ HS4（被叫方确认），
 *    HS3/HS4 用协商出的 AES-256-GCM 密钥加密并校验 transcript，双向证明密钥一致。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  b64u,
  fromB64u,
  generateX25519,
  hkdf,
  joinFields,
  open,
  randomB64u,
  fengyin,
  sha256,
  sha256Hex,
  x25519SharedSecret,
} from './codec.js';
import {
  type ZhiWenTuiDao,
  type ShenfenGongyingshang,
  type GuifanShenfen,
  ShenfenQiyueCuowu,
  warmyFingerprint,
  normalizeIdentity,
  verifyPeerSignature,
} from './identity.js';

export const WOSHOU_BANBEN = 1;
export const WOSHOU_XIEYI = 'warmy-sync/1';
export const DEFAULT_TIMESTAMP_TOLERANCE_MS = 120_000;
export const DEFAULT_PHASE_TIMEOUT_MS = 15_000;
export const WOSHOU_NONCE_ZIJIE = 16;

export type WoshouJuese = 'initiator' | 'responder';

/* ────────────────────────────── 帧 ────────────────────────────── */

export interface Hs1 {
  t: 'hs1';
  v: number;
  /** 群/项目 ID（绑定进 transcript，防跨群重放）；无群时 null */
  gid: string | null;
  /** 发起方临时 X25519 公钥（b64url） */
  eph: string;
  /** 发起方身份指纹 */
  fp: string;
  /** 发起方身份公钥（raw 32B，b64url） */
  pk: string;
  /** 16 字节 nonce（b64url） */
  n: string;
  /** 单调计数 */
  c: number;
  ts: number;
  /**
   * 发起方声明的**被叫方指纹**（pin）。'' = TOFU 未 pin。
   * 这一字段必须被签名：它让"本帧是发给谁的"成为不可篡改的声明，
   * 被叫方校验 `pins ∈ {'', 本机指纹}`，从而挡住「把发给 C 的 HS1 重放给 B」。
   */
  pins: string;
  sig: string;
}

export interface Hs2 {
  t: 'hs2';
  v: number;
  gid: string | null;
  eph: string;
  fp: string;
  pk: string;
  n: string;
  c: number;
  ts: number;
  /** sha256(HS1 transcript) hex */
  th1: string;
  sig: string;
}

export interface Hs3 {
  t: 'hs3';
  /** handshakeId = sha256(transcript) 前 16 字符，便于日志关联 */
  id: string;
  iv: string;
  tag: string;
}

export interface Hs4 {
  t: 'hs4';
  id: string;
  iv: string;
  tag: string;
}

export type HsFrame = Hs1 | Hs2 | Hs3 | Hs4;

export type HandshakeFailureReason =
  | 'protocol-error'
  | 'bad-version'
  | 'malformed'
  | 'bad-group'
  | 'fingerprint-mismatch'
  | 'signature-invalid'
  | 'replay-nonce'
  | 'replay-counter'
  | 'clock-skew'
  | 'not-authorized'
  | 'pin-mismatch'
  | 'confirm-failed'
  | 'phase-timeout'
  | 'state-error';

export class WoshouCuowu extends Error {
  constructor(
    public readonly reason: HandshakeFailureReason,
    message: string,
    public readonly peer?: string
  ) {
    super(message);
    this.name = 'HandshakeError';
  }
}

export interface WoshouShijian {
  type: 'sent' | 'received' | 'rejected' | 'established';
  flight: 1 | 2 | 3 | 4;
  role: WoshouJuese;
  peer?: string;
  detail?: string;
  ts: number;
}

/** 握手失败审计记录（ADR A7 可观测性） */
export interface HandshakeFailureRecord {
  reason: HandshakeFailureReason;
  detail: string;
  peer?: string;
  role: WoshouJuese;
  at: number;
}

/* ────────────────────────────── 防重放 ────────────────────────────── */

export interface ReplayCheck {
  ok: boolean;
  reason?: 'replay-nonce' | 'replay-counter' | 'clock-skew';
  detail?: string;
}

interface DuiduanChongfangZhuangtai {
  maxCounter: number;
  nonces: Map<string, number>;
  lastSeenAt: number;
}

export interface ReplayGuardOptions {
  /** 时间戳容差（毫秒），默认 120s */
  toleranceMs?: number;
  /** nonce 记忆窗口（毫秒），默认 10 分钟 */
  nonceWindowMs?: number;
  /** 可选：持久化到文件（跨进程重启仍然单调，防"重启即重放"） */
  persistFile?: string;
  now?: () => number;
}

interface ReplayGuardSnapshot {
  version: 1;
  localCounter: number;
  peers: Record<string, { maxCounter: number; lastSeenAt: number; nonces: [string, number][] }>;
}

const MAX_TRACKED_PEERS = 4096;
const MAX_TRACKED_NONCES = 8192;

/**
 * 重放防护：nonce + 单调计数 + 时间戳容差
 *
 * `check()` 只读，`commit()` 才推进状态 —— 调用方必须在**验签与授权校验都通过之后**
 * 才 commit，否则攻击者可以用伪造帧把合法对端的计数顶掉。
 */
export class ReplayGuard {
  private peers = new Map<string, DuiduanChongfangZhuangtai>();
  private localCounterValue = 0;
  private readonly toleranceMs: number;
  private readonly nonceWindowMs: number;
  private readonly now: () => number;
  private readonly persistFile?: string;

  constructor(opts: ReplayGuardOptions = {}) {
    this.toleranceMs = opts.toleranceMs ?? DEFAULT_TIMESTAMP_TOLERANCE_MS;
    this.nonceWindowMs = opts.nonceWindowMs ?? 10 * 60_000;
    this.now = opts.now ?? (() => Date.now());
    if (opts.persistFile) {
      this.persistFile = opts.persistFile;
      this.load();
    }
  }

  /** 本端下一个握手计数（单调递增；持久化时跨重启继续递增） */
  nextLocalCounter(): number {
    this.localCounterValue += 1;
    this.save();
    return this.localCounterValue;
  }

  get localCounter(): number {
    return this.localCounterValue;
  }

  get rongcha(): number {
    return this.toleranceMs;
  }

  /** 已被接受过的最高计数（用于测试断言单调性） */
  maxCounterSeen(peer: string): number {
    return this.peers.get(peer)?.maxCounter ?? 0;
  }

  seenNonceCount(peer: string): number {
    return this.peers.get(peer)?.nonces.size ?? 0;
  }

  check(args: { peer: string; nonce: string; counter: number; ts: number }): ReplayCheck {
    const nowMs = this.now();
    if (!Number.isFinite(args.ts) || Math.abs(nowMs - args.ts) > this.toleranceMs) {
      return {
        ok: false,
        reason: 'clock-skew',
        detail: `|now-ts|=${Math.abs(nowMs - (args.ts || 0))}ms 超出容差 ${this.toleranceMs}ms`,
      };
    }
    const s = this.peers.get(args.peer);
    if (!s) {
      return !Number.isSafeInteger(args.counter) || args.counter <= 0
        ? { ok: false, reason: 'replay-counter', detail: `counter 非法：${args.counter}` }
        : { ok: true };
    }
    if (s.nonces.has(args.nonce)) return { ok: false, reason: 'replay-nonce', detail: 'nonce 已使用过' };
    if (!Number.isSafeInteger(args.counter) || args.counter <= s.maxCounter) {
      return { ok: false, reason: 'replay-counter', detail: `counter ${args.counter} <= 已见最高 ${s.maxCounter}` };
    }
    return { ok: true };
  }

  /** 验签 + 授权通过后调用 */
  commit(args: { peer: string; nonce: string; counter: number }): void {
    const nowMs = this.now();
    const s = this.state(args.peer);
    this.prune(s, nowMs);
    s.nonces.set(args.nonce, nowMs);
    if (s.nonces.size > MAX_TRACKED_NONCES) {
      const zuijiu = [...s.nonces.entries()].sort((a, b) => a[1] - b[1])[0];
      if (zuijiu) s.nonces.delete(zuijiu[0]);
    }
    if (args.counter > s.maxCounter) s.maxCounter = args.counter;
    s.lastSeenAt = nowMs;
    this.save();
  }

  private state(peer: string): DuiduanChongfangZhuangtai {
    let s = this.peers.get(peer);
    if (!s) {
      if (this.peers.size >= MAX_TRACKED_PEERS) {
        const zuijiu = [...this.peers.entries()].sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt)[0];
        if (zuijiu) this.peers.delete(zuijiu[0]);
      }
      s = { maxCounter: 0, nonces: new Map(), lastSeenAt: this.now() };
      this.peers.set(peer, s);
    }
    return s;
  }

  private prune(s: DuiduanChongfangZhuangtai, nowMs: number): void {
    for (const [nonce, at] of s.nonces) {
      if (nowMs - at > this.nonceWindowMs) s.nonces.delete(nonce);
    }
  }

  private load(): void {
    try {
      const raw = fs.readFileSync(this.persistFile as string, 'utf8');
      const snap = JSON.parse(raw) as ReplayGuardSnapshot;
      this.localCounterValue = snap.localCounter ?? 0;
      for (const [peer, st] of Object.entries(snap.peers ?? {})) {
        this.peers.set(peer, {
          maxCounter: st.maxCounter,
          lastSeenAt: st.lastSeenAt,
          nonces: new Map(st.nonces ?? []),
        });
      }
    } catch {
      /* 首次运行 */
    }
  }

  private save(): void {
    if (!this.persistFile) return;
    try {
      const peers: ReplayGuardSnapshot['peers'] = {};
      for (const [peer, st] of this.peers) {
        peers[peer] = { maxCounter: st.maxCounter, lastSeenAt: st.lastSeenAt, nonces: [...st.nonces] };
      }
      const snap: ReplayGuardSnapshot = { version: 1, localCounter: this.localCounterValue, peers };
      fs.mkdirSync(path.dirname(this.persistFile), { recursive: true });
      fs.writeFileSync(this.persistFile, JSON.stringify(snap, null, 2), 'utf8');
    } catch {
      /* 持久化失败不影响内存态 */
    }
  }
}

/* ────────────────────────────── 会话密钥 ────────────────────────────── */

export interface SessionKeys {
  /** sha256(transcript) 全量 hex */
  handshakeId: string;
  transcriptHash: Buffer;
  role: WoshouJuese;
  groupId: string | null;
  peerFingerprint: string;
  peerPublicKey: Buffer;
  localFingerprint: string;
  establishedAt: number;
  /** 本连接握手用量（审计 / 断言） */
  localNonce: string;
  peerNonce: string;
  localCounter: number;
  peerCounter: number;
  /** 方向性密钥材料：initiator → responder */
  c2sMaterial: Buffer;
  /** responder → initiator */
  s2cMaterial: Buffer;
  /** 密钥指纹：用于证明「每连接密钥不同」 */
  keyFingerprint: string;
  /** 是否 TOFU（对端指纹此前未知） */
  tofu: boolean;
}

/* ────────────────────────────── 握手驱动 ────────────────────────────── */

export interface WoshouXuanxiang {
  identity: ShenfenGongyingshang | GuifanShenfen;
  role: WoshouJuese;
  /** 已知/名册内的对端指纹；null = TOFU 首次接触（不做 pin 校验） */
  peerFingerprint?: string | null;
  /** 名册校验：返回 false 即判定为未授权成员 */
  roster?: (fingerprint: string) => boolean;
  groupId?: string | null;
  replayGuard?: ReplayGuard;
  timestampToleranceMs?: number;
  phaseTimeoutMs?: number;
  fingerprintDerivation?: ZhiWenTuiDao;
  enforceLocalEd25519?: boolean;
  requireInjectedVerify?: boolean;
  now?: () => number;
  onEvent?: (e: WoshouShijian) => void;
}

interface JiaoyiZhuangtai {
  t1?: string;
  t2?: string;
  hs1?: Hs1;
  hs2?: Hs2;
}

export class HandshakeDriver {
  private identity!: GuifanShenfen;
  private readonly ready: Promise<void>;
  private ephPrivateKey!: Buffer;
  private ephPublicKey!: Buffer;
  private localNonce = '';
  private localCounter = 0;
  private transcript: JiaoyiZhuangtai = {};
  private state: 'init' | 'awaiting-hs2' | 'awaiting-hs3' | 'awaiting-hs4' | 'established' | 'failed' = 'init';
  private sessionKeys: SessionKeys | null = null;
  private failure: WoshouCuowu | null = null;
  private lastFrameAt = 0;
  private readonly guard: ReplayGuard;
  private readonly now: () => number;
  private readonly phaseTimeoutMs: number;

  constructor(private readonly opts: WoshouXuanxiang) {
    this.guard = opts.replayGuard ?? new ReplayGuard({ toleranceMs: opts.timestampToleranceMs });
    this.now = opts.now ?? (() => Date.now());
    this.phaseTimeoutMs = opts.phaseTimeoutMs ?? DEFAULT_PHASE_TIMEOUT_MS;
    this.ready = this.init();
    // 防止"构造后未 await"导致的 unhandled rejection；真正的错误仍在 start()/step() 抛出
    this.ready.catch(() => {});
  }

  private async init(): Promise<void> {
    this.identity = await normalizeIdentity(this.opts.identity, {
      fingerprintDerivation: this.opts.fingerprintDerivation,
      enforceLocalEd25519: this.opts.enforceLocalEd25519,
      requireInjectedVerify: this.opts.requireInjectedVerify,
    });
    if (this.opts.peerFingerprint && this.opts.peerFingerprint === this.identity.fingerprint) {
      throw new ShenfenQiyueCuowu('握手配置错误：peerFingerprint 不能等于本机指纹');
    }
    const eph = generateX25519();
    this.ephPrivateKey = eph.privateKey;
    this.ephPublicKey = eph.publicKey;
    this.localNonce = randomB64u(WOSHOU_NONCE_ZIJIE);
    this.localCounter = this.guard.nextLocalCounter();
    this.lastFrameAt = this.now();
  }

  get role(): WoshouJuese {
    return this.opts.role;
  }
  get localFingerprint(): string {
    return this.identity.fingerprint;
  }
  get established(): boolean {
    return this.state === 'established';
  }
  get session(): SessionKeys | null {
    return this.sessionKeys;
  }
  get error(): WoshouCuowu | null {
    return this.failure;
  }
  get phase(): string {
    return this.state;
  }
  get guardRef(): ReplayGuard {
    return this.guard;
  }
  get localHandshakeUsage(): { nonce: string; counter: number; ephemeralPublicKey: string } {
    return { nonce: this.localNonce, counter: this.localCounter, ephemeralPublicKey: b64u(this.ephPublicKey) };
  }

  private emit(e: Omit<WoshouShijian, 'ts' | 'role'>): void {
    this.opts.onEvent?.({ ...e, role: this.opts.role, ts: this.now() });
  }

  private fail(reason: HandshakeFailureReason, message: string, peer?: string): WoshouCuowu {
    const err = new WoshouCuowu(reason, message, peer);
    this.failure = err;
    if (this.state !== 'established') this.state = 'failed';
    this.emit({ type: 'rejected', flight: 1, peer, detail: `${reason}: ${message}` });
    return err;
  }

  /* ── 飞行 1：发起方 → 被叫方 ── */
  async start(): Promise<HsFrame | null> {
    await this.ready;
    if (this.opts.role !== 'initiator') return null;
    if (this.state !== 'init') throw this.fail('state-error', `start() 状态非法：${this.state}`);
    const hs1: Hs1 = {
      t: 'hs1',
      v: WOSHOU_BANBEN,
      gid: this.opts.groupId ?? null,
      eph: b64u(this.ephPublicKey),
      fp: this.identity.fingerprint,
      pk: b64u(this.identity.publicKey),
      n: this.localNonce,
      c: this.localCounter,
      ts: this.now(),
      pins: this.opts.peerFingerprint ?? '',
      sig: '',
    };
    hs1.sig = b64u(await this.identity.sign(Buffer.from(this.hs1Transcript(hs1), 'utf8')));
    this.transcript.hs1 = hs1;
    this.transcript.t1 = this.hs1Transcript(hs1);
    this.state = 'awaiting-hs2';
    this.emit({ type: 'sent', flight: 1, peer: this.opts.peerFingerprint ?? undefined });
    return hs1;
  }

  /** 统一入口：吃掉一帧，产出下一帧 */
  async step(frame: HsFrame): Promise<{ out: HsFrame[]; done: boolean; session?: SessionKeys }> {
    await this.ready;
    if (this.failure) throw this.failure;
    if (this.lastFrameAt && this.now() - this.lastFrameAt > this.phaseTimeoutMs) {
      throw this.fail('phase-timeout', `握手阶段超时：${this.now() - this.lastFrameAt}ms > ${this.phaseTimeoutMs}ms`);
    }
    this.lastFrameAt = this.now();
    if (frame.t === 'hs1') {
      if (this.opts.role !== 'responder') throw this.fail('state-error', 'initiator 不应收到 hs1');
      if (this.state !== 'init') throw this.fail('state-error', `responder 状态非法：${this.state}`);
      const hs2 = await this.onHs1(frame);
      return { out: [hs2], done: false };
    }
    if (frame.t === 'hs2') {
      if (this.opts.role !== 'initiator') throw this.fail('state-error', 'responder 不应收到 hs2');
      if (this.state !== 'awaiting-hs2') throw this.fail('state-error', `initiator 状态非法：${this.state}`);
      const hs3 = await this.onHs2(frame);
      return { out: [hs3], done: false };
    }
    if (frame.t === 'hs3') {
      if (this.opts.role !== 'responder') throw this.fail('state-error', 'initiator 不应收到 hs3');
      if (this.state !== 'awaiting-hs3') throw this.fail('state-error', `responder 状态非法：${this.state}`);
      const hs4 = await this.onHs3(frame);
      return { out: [hs4], done: true, session: this.sessionKeys ?? undefined };
    }
    if (frame.t === 'hs4') {
      if (this.opts.role !== 'initiator') throw this.fail('state-error', 'responder 不应收到 hs4');
      if (this.state !== 'awaiting-hs4') throw this.fail('state-error', `initiator 状态非法：${this.state}`);
      await this.onHs4(frame);
      return { out: [], done: true, session: this.sessionKeys ?? undefined };
    }
    throw this.fail('malformed', `未知帧类型 ${String((frame as { t?: unknown }).t)}`);
  }

  /* ── 被叫方处理 HS1，产出 HS2 ── */
  private async onHs1(hs1: Hs1): Promise<Hs2> {
    if (hs1.v !== WOSHOU_BANBEN) throw this.fail('bad-version', `不支持的握手版本 ${hs1.v}`, hs1.fp);
    if ((hs1.gid ?? null) !== (this.opts.groupId ?? null)) {
      throw this.fail('bad-group', `群 ID 不匹配：对端 ${hs1.gid}，本端 ${this.opts.groupId ?? null}`, hs1.fp);
    }
    const pk = safeFromB64u(hs1.pk);
    const eph = safeFromB64u(hs1.eph);
    if (!pk || pk.length !== 32 || !eph || eph.length !== 32) {
      throw this.fail('malformed', 'HS1 公钥字段长度非法', hs1.fp);
    }
    // 被叫方校验「这一帧是否是发给我的」：'' = TOFU 允许；否则必须等于本机指纹
    if (hs1.pins !== '' && hs1.pins !== this.identity.fingerprint) {
      throw this.fail('pin-mismatch', `HS1 声明的被叫方指纹 ${hs1.pins} 不是本机（本机 ${this.identity.fingerprint}）`, hs1.fp);
    }
    this.checkPeerIdentity(hs1.fp, pk);
    await this.checkSignature(this.hs1Transcript(hs1), hs1.sig, pk, hs1.fp, 'HS1');
    this.checkReplay(hs1.fp, hs1.n, hs1.c, hs1.ts);
    this.guard.commit({ peer: hs1.fp, nonce: hs1.n, counter: hs1.c });
    this.transcript.hs1 = hs1;
    this.transcript.t1 = this.hs1Transcript(hs1);

    const hs2: Hs2 = {
      t: 'hs2',
      v: WOSHOU_BANBEN,
      gid: this.opts.groupId ?? null,
      eph: b64u(this.ephPublicKey),
      fp: this.identity.fingerprint,
      pk: b64u(this.identity.publicKey),
      n: this.localNonce,
      c: this.localCounter,
      ts: this.now(),
      th1: sha256Hex(Buffer.from(this.transcript.t1, 'utf8')),
      sig: '',
    };
    hs2.sig = b64u(await this.identity.sign(Buffer.from(this.hs2Transcript(hs2, this.transcript.t1), 'utf8')));
    this.transcript.hs2 = hs2;
    this.transcript.t2 = this.hs2Transcript(hs2, this.transcript.t1);
    this.deriveSession(hs1, hs2);
    this.state = 'awaiting-hs3';
    this.emit({ type: 'sent', flight: 2, peer: hs1.fp });
    return hs2;
  }

  /* ── 发起方处理 HS2，产出 HS3 ── */
  private async onHs2(hs2: Hs2): Promise<Hs3> {
    if (hs2.v !== WOSHOU_BANBEN) throw this.fail('bad-version', `不支持的握手版本 ${hs2.v}`, hs2.fp);
    if ((hs2.gid ?? null) !== (this.opts.groupId ?? null)) throw this.fail('bad-group', `群 ID 不匹配：对端 ${hs2.gid}`, hs2.fp);
    const t1 = this.transcript.t1;
    const hs1 = this.transcript.hs1;
    if (!t1 || !hs1) throw this.fail('state-error', '缺少 HS1 上下文');
    if (hs2.th1 !== sha256Hex(Buffer.from(t1, 'utf8'))) {
      throw this.fail('signature-invalid', 'HS2 未绑定本连接的 HS1（transcript 不匹配）', hs2.fp);
    }
    const pk = safeFromB64u(hs2.pk);
    const eph = safeFromB64u(hs2.eph);
    if (!pk || pk.length !== 32 || !eph || eph.length !== 32) throw this.fail('malformed', 'HS2 公钥字段长度非法', hs2.fp);
    this.checkPeerIdentity(hs2.fp, pk);
    await this.checkSignature(this.hs2Transcript(hs2, t1), hs2.sig, pk, hs2.fp, 'HS2');
    this.checkReplay(hs2.fp, hs2.n, hs2.c, hs2.ts);
    this.guard.commit({ peer: hs2.fp, nonce: hs2.n, counter: hs2.c });
    this.transcript.hs2 = hs2;
    this.transcript.t2 = this.hs2Transcript(hs2, t1);
    this.deriveSession(hs1, hs2);

    const session = this.sessionKeys as SessionKeys;
    const th = session.transcriptHash;
    const sealed = fengyin(session.c2sMaterial, th, Buffer.concat([Buffer.from('HS3'), th]));
    this.state = 'awaiting-hs4';
    this.emit({ type: 'sent', flight: 3, peer: hs2.fp });
    return { t: 'hs3', id: session.handshakeId.slice(0, 16), iv: b64u(sealed.iv), tag: b64u(sealed.ct) };
  }

  /* ── 被叫方校验 HS3，产出 HS4 ── */
  private async onHs3(hs3: Hs3): Promise<Hs4> {
    const session = this.sessionKeys;
    if (!session) throw this.fail('state-error', '尚未派生会话密钥');
    if (hs3.id !== session.handshakeId.slice(0, 16)) throw this.fail('confirm-failed', 'HS3 handshakeId 不匹配', session.peerFingerprint);
    const th = session.transcriptHash;
    const iv = safeFromB64u(hs3.iv);
    const ct = safeFromB64u(hs3.tag);
    if (!iv || !ct) throw this.fail('malformed', 'HS3 字段非法', session.peerFingerprint);
    let plain: Buffer;
    try {
      plain = open(session.c2sMaterial, { iv, ct }, Buffer.concat([Buffer.from('HS3'), th]));
    } catch {
      throw this.fail('confirm-failed', 'HS3 解密失败：对端未持有同一会话密钥', session.peerFingerprint);
    }
    if (!plain.equals(th)) throw this.fail('confirm-failed', 'HS3 transcript 校验值不符', session.peerFingerprint);
    const sealed = fengyin(session.s2cMaterial, th, Buffer.concat([Buffer.from('HS4'), th]));
    this.state = 'established';
    this.emit({ type: 'sent', flight: 4, peer: session.peerFingerprint });
    this.emit({ type: 'established', flight: 4, peer: session.peerFingerprint, detail: session.keyFingerprint.slice(0, 16) });
    return { t: 'hs4', id: session.handshakeId.slice(0, 16), iv: b64u(sealed.iv), tag: b64u(sealed.ct) };
  }

  /* ── 发起方校验 HS4 ── */
  private async onHs4(hs4: Hs4): Promise<void> {
    const session = this.sessionKeys;
    if (!session) throw this.fail('state-error', '尚未派生会话密钥');
    if (hs4.id !== session.handshakeId.slice(0, 16)) throw this.fail('confirm-failed', 'HS4 handshakeId 不匹配', session.peerFingerprint);
    const th = session.transcriptHash;
    const iv = safeFromB64u(hs4.iv);
    const ct = safeFromB64u(hs4.tag);
    if (!iv || !ct) throw this.fail('malformed', 'HS4 字段非法', session.peerFingerprint);
    let plain: Buffer;
    try {
      plain = open(session.s2cMaterial, { iv, ct }, Buffer.concat([Buffer.from('HS4'), th]));
    } catch {
      throw this.fail('confirm-failed', 'HS4 解密失败：被叫方未持有同一会话密钥', session.peerFingerprint);
    }
    if (!plain.equals(th)) throw this.fail('confirm-failed', 'HS4 transcript 校验值不符', session.peerFingerprint);
    this.state = 'established';
    this.emit({ type: 'established', flight: 4, peer: session.peerFingerprint, detail: session.keyFingerprint.slice(0, 16) });
  }

  /* ── 校验辅助 ── */

  private checkPeerIdentity(claimedFp: string, pk: Buffer): void {
    if (claimedFp === this.identity.fingerprint) {
      throw this.fail('protocol-error', '对端声称与本机相同指纹（自反射攻击）', claimedFp);
    }
    const tuidao = this.opts.fingerprintDerivation ?? warmyFingerprint;
    const expected = tuidao(pk);
    if (expected !== claimedFp) {
      throw this.fail('fingerprint-mismatch', `指纹与公钥不符：声明 ${claimedFp}，由公钥推出 ${expected}`, claimedFp);
    }
    const pinned = this.opts.peerFingerprint;
    if (pinned && pinned !== claimedFp) {
      throw this.fail('pin-mismatch', `对端指纹与预期不符：预期 ${pinned}，实际 ${claimedFp}`, claimedFp);
    }
    if (this.opts.roster && !this.opts.roster(claimedFp)) {
      throw this.fail('not-authorized', `对端指纹 ${claimedFp} 不在本群名册内`, claimedFp);
    }
  }

  private async checkSignature(transcript: string, sigB64: string, pk: Buffer, fp: string, label: string): Promise<void> {
    const sig = safeFromB64u(sigB64);
    if (!sig || sig.length === 0) throw this.fail('malformed', `${label} 缺少签名`, fp);
    const r = await verifyPeerSignature(this.identity, Buffer.from(transcript, 'utf8'), sig, pk);
    if (!r.ok) throw this.fail('signature-invalid', `${label} 签名校验失败（复核方式 ${r.via}）`, fp);
  }

  private checkReplay(fp: string, nonce: string, counter: number, ts: number): void {
    const r = this.guard.check({ peer: fp, nonce, counter, ts });
    if (!r.ok) throw this.fail(r.reason ?? 'protocol-error', `${r.detail ?? ''}`, fp);
  }

  private hs1Transcript(hs1: Hs1): string {
    return joinFields([
      'WARMY-HS1',
      WOSHOU_BANBEN,
      hs1.gid,
      hs1.eph,
      hs1.fp,
      hs1.pk,
      hs1.n,
      hs1.c,
      hs1.ts,
      hs1.pins ?? '',
    ]);
  }

  private hs2Transcript(hs2: Hs2, t1: string): string {
    return joinFields([
      'WARMY-HS2',
      WOSHOU_BANBEN,
      hs2.gid,
      hs2.eph,
      hs2.fp,
      hs2.pk,
      hs2.n,
      hs2.c,
      hs2.ts,
      sha256Hex(Buffer.from(t1, 'utf8')),
    ]);
  }

  private deriveSession(hs1: Hs1, hs2: Hs2): void {
    // ECDHE：对端临时公钥对发起方是 hs2.eph，对被叫方是 hs1.eph（别拿自己的公钥去算）
    const duiduanLinshi = this.opts.role === 'initiator' ? hs2.eph : hs1.eph;
    const shared = x25519SharedSecret(this.ephPrivateKey, fromB64u(duiduanLinshi));
    const t1 = this.transcript.t1 ?? this.hs1Transcript(hs1);
    const t2 = this.transcript.t2 ?? this.hs2Transcript(hs2, t1);
    const transcriptHash = sha256(Buffer.from(t1, 'utf8'), Buffer.from('|', 'utf8'), Buffer.from(t2, 'utf8'));
    const c2sMaterial = hkdf(shared, transcriptHash, `${WOSHOU_XIEYI} initiator-to-responder`, 32);
    const s2cMaterial = hkdf(shared, transcriptHash, `${WOSHOU_XIEYI} responder-to-initiator`, 32);
    const peerIsInitiator = hs1.fp !== this.identity.fingerprint;
    this.sessionKeys = {
      handshakeId: transcriptHash.toString('hex'),
      transcriptHash,
      role: this.opts.role,
      groupId: this.opts.groupId ?? null,
      peerFingerprint: peerIsInitiator ? hs1.fp : hs2.fp,
      peerPublicKey: fromB64u(peerIsInitiator ? hs1.pk : hs2.pk),
      localFingerprint: this.identity.fingerprint,
      establishedAt: this.now(),
      localNonce: this.localNonce,
      peerNonce: peerIsInitiator ? hs1.n : hs2.n,
      localCounter: this.localCounter,
      peerCounter: peerIsInitiator ? hs1.c : hs2.c,
      c2sMaterial,
      s2cMaterial,
      keyFingerprint: sha256Hex(c2sMaterial, s2cMaterial),
      tofu: !this.opts.peerFingerprint,
    };
  }
}

function safeFromB64u(s: unknown): Buffer | null {
  if (typeof s !== 'string' || s.length === 0) return null;
  try {
    return fromB64u(s);
  } catch {
    return null;
  }
}

/** 便捷函数：在两个驱动之间跑完握手（内存内自检 / 测试用） */
export async function yunxingWoshou(initiator: HandshakeDriver, responder: HandshakeDriver): Promise<SessionKeys> {
  const hs1 = await initiator.start();
  if (!hs1) throw new Error('initiator.start() 未返回 HS1');
  let cur: HsFrame = hs1;
  for (let i = 0; i < 4; i += 1) {
    const target = cur.t === 'hs1' || cur.t === 'hs3' ? responder : initiator;
    const res = await target.step(cur);
    if (res.session) return res.session;
    const next = res.out[0];
    if (!next) throw new Error('握手飞行链中断');
    cur = next;
  }
  const s = initiator.session ?? responder.session;
  if (!s) throw new Error('握手未完成');
  return s;
}
