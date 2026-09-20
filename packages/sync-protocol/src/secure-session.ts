/**
 * secure-session —— 鉴权 TCP 会话（把原来的裸 TCP 换成鉴权通道）
 *
 * 与既有 `LanSyncServer` / `LanSyncClient` 的关系：
 *  - 既有实现「发一行 JSON 即 ACK 落盘」（无鉴权），本模块是它的**替代品**：
 *    连接建立先跑 `HandshakeDriver`（Ed25519 认证 + X25519 ECDHE），
 *    之后所有消息走 `SecureChannel`（AES-256-GCM，每连接一次密钥 + 支持 KeyUpdate）。
 *  - 既有类保留不动，属主可逐步迁移。
 *
 * 线格式（同一条 TCP 连接的两个阶段）：
 *  阶段 1 握手：newline-delimited JSON（HS1/HS2/HS3/HS4 帧）
 *  阶段 2 数据：u32be 长度前缀的加密记录（见 secure-channel.ts）
 * 两阶段之间做了缓冲区交接：握手最后一个飞行之后若同一 TCP 段里已经带了
 * 加密记录，这些字节会交给记录层，不会丢也不会错位。
 */
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { randomHex } from './codec.js';
import {
  type HandshakeEvent,
  type HandshakeFailureReason,
  type HandshakeFailureRecord,
  type HsFrame,
  HandshakeDriver,
  HandshakeError,
  ReplayGuard,
} from './handshake.js';
import { type IdentityProvider, type NormalizedIdentity, type ZhiWenTuiDao } from './identity.js';
import { AnQuanTongDao, AnQuanTongDaoCuoWu } from './secure-channel.js';

/** 对端回包里的 reason 白名单（只信任已知枚举，避免把任意字符串当成原因） */
const KNOWN_HANDSHAKE_REASONS = new Set<string>([
  'protocol-error',
  'bad-version',
  'malformed',
  'bad-group',
  'fingerprint-mismatch',
  'signature-invalid',
  'replay-nonce',
  'replay-counter',
  'clock-skew',
  'not-authorized',
  'pin-mismatch',
  'confirm-failed',
  'phase-timeout',
  'state-error',
]);

export interface SyncMessage {
  id: string;
  from: string;
  to: string | '*';
  channel: 'group' | 'control' | 'invite' | 'gossip' | 'announce';
  groupId?: string;
  payload: unknown;
  ts: number;
  incognito?: boolean;
}

export interface SecureSessionInfo {
  sessionId: string;
  handshakeId: string;
  peerFingerprint: string;
  localFingerprint: string;
  /** 本端在这条连接上的角色（responder = 被拨入；initiator = 拨出） */
  role: 'initiator' | 'responder';
  direction: 'inbound' | 'outbound';
  groupId: string | null;
  establishedAt: number;
  keyFingerprint: string;
  tofu: boolean;
  remoteAddress?: string;
  remotePort?: number;
}

export interface SecureSessionOptions {
  /** 本节点别名（放进消息的 from 字段） */
  nodeId: string;
  onMessage?: (msg: SyncMessage, session: SecureSession) => void;
  onClose?: (session: SecureSession, reason: string) => void;
  onEvent?: (e: HandshakeEvent) => void;
  /** 保活间隔（毫秒）；0 = 关闭。成员侧保持轻量保活即可（ADR C1） */
  heartbeatMs?: number;
  logFile?: string;
  now?: () => number;
}

/** 缓冲区：握手阶段按行读，切到记录层时把剩余字节整体交出去 */
class SwitchBuffer {
  private buf: Buffer = Buffer.alloc(0);
  push(chunk: Buffer): void {
    this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk]);
  }
  readLine(): string | null {
    const idx = this.buf.indexOf(0x0a);
    if (idx < 0) return null;
    const line = this.buf.subarray(0, idx).toString('utf8');
    this.buf = this.buf.subarray(idx + 1);
    return line;
  }
  takeAll(): Buffer {
    const b = this.buf;
    this.buf = Buffer.alloc(0);
    return b;
  }
  get pending(): number {
    return this.buf.length;
  }
}

export class SecureSession {
  private readonly channel: AnQuanTongDao;
  private phase: 'handshake' | 'records' | 'closed' = 'handshake';
  private buffer = new SwitchBuffer();
  private heartbeatTimer?: NodeJS.Timeout;
  private readonly now: () => number;
  private lastInboundAt: number;
  private lastOutboundAt: number;
  readonly info: SecureSessionInfo;
  readonly counters = { sent: 0, received: 0, keyUpdates: 0, handshakeFailures: 0 };

  constructor(
    private readonly socket: net.Socket,
    channel: AnQuanTongDao,
    private readonly driver: HandshakeDriver,
    info: Omit<SecureSessionInfo, 'keyFingerprint' | 'handshakeId' | 'sessionId' | 'localFingerprint'> & {
      keyFingerprint?: string;
      handshakeId?: string;
    },
    private readonly opts: SecureSessionOptions
  ) {
    this.channel = channel;
    this.now = opts.now ?? (() => Date.now());
    this.lastInboundAt = this.now();
    this.lastOutboundAt = this.now();
    const handshakeId = info.handshakeId ?? '';
    this.info = {
      ...info,
      handshakeId,
      sessionId: handshakeId.slice(0, 16),
      keyFingerprint: info.keyFingerprint ?? '',
      localFingerprint: driver.localFingerprint,
    };
  }

  get alive(): boolean {
    return this.phase === 'records' && !this.socket.destroyed;
  }
  get channelStats() {
    return this.channel.channelStats;
  }
  get generation(): number {
    return this.channel.generation;
  }
  get recvGeneration(): number {
    return this.channel.recvGeneration;
  }
  get keyUpdateCount(): number {
    return this.channel.channelStats.keyUpdates;
  }
  get lastInbound(): number {
    return this.lastInboundAt;
  }
  get lastOutbound(): number {
    return this.lastOutboundAt;
  }

  /** 标记握手完成 → 切记录层；同段里已到的加密记录会立刻被消化 */
  enterRecordPhase(): void {
    if (this.phase !== 'handshake') return;
    this.phase = 'records';
    const rest = this.buffer.takeAll();
    if (rest.length > 0) this.consumeRecords(rest);
    const hb = this.opts.heartbeatMs ?? 0;
    if (hb > 0) {
      this.heartbeatTimer = setInterval(() => void this.beat(), hb);
      this.heartbeatTimer.unref?.();
    }
  }

  private async beat(): Promise<void> {
    if (!this.alive) return;
    try {
      this.send({ to: '*', channel: 'control', payload: { type: 'ping', at: this.now() } });
    } catch {
      /* 连接已断，交给 close 路径 */
    }
  }

  send(msg: Omit<SyncMessage, 'id' | 'ts' | 'from'> & { from?: string; ts?: number }): SyncMessage {
    if (!this.alive) throw new Error('session 未建立或已关闭');
    const full: SyncMessage = {
      ...msg,
      from: msg.from ?? this.opts.nodeId,
      id: `m-${randomHex(6)}`,
      ts: msg.ts ?? this.now(),
    };
    const payload = Buffer.from(JSON.stringify(full), 'utf8');
    this.socket.write(this.channel.sealRecord(payload));
    this.lastOutboundAt = this.now();
    this.counters.sent += 1;
    if (!full.incognito && this.opts.logFile) {
      fs.mkdirSync(path.dirname(this.opts.logFile), { recursive: true });
      fs.appendFileSync(this.opts.logFile, JSON.stringify(full) + '\n');
    }
    return full;
  }

  /** 长连接密钥更新（不重握手、不重认证） */
  requestKeyUpdate(): void {
    if (!this.alive) throw new Error('session 未建立或已关闭');
    this.socket.write(this.channel.requestKeyUpdate());
    this.counters.keyUpdates += 1;
  }

  /** socket 数据入口（阶段自动判别） */
  handleData(chunk: Buffer): void {
    if (this.phase === 'closed') return;
    this.buffer.push(chunk);
    if (this.phase === 'handshake') return;
    const rest = this.buffer.takeAll();
    if (rest.length > 0) this.consumeRecords(rest);
  }

  /** 握手完成后的收尾：把 channel 从 driver 的会话密钥建起来 */
  static buildChannel(driver: HandshakeDriver, sessionRole: 'initiator' | 'responder'): AnQuanTongDao {
    const keys = driver.session;
    if (!keys) throw new Error('握手尚未完成，无法建立会话密钥');
    return new AnQuanTongDao(keys, sessionRole);
  }

  private consumeRecords(chunk: Buffer): void {
    let plaintexts: Buffer[];
    try {
      plaintexts = this.channel.openRecords(chunk);
    } catch (e) {
      // 认证失败 = 密钥不符 / 被篡改 / 重放 → 直接断连，绝不"跳过继续读"
      this.counters.handshakeFailures += 1;
      this.close(e instanceof AnQuanTongDaoCuoWu ? e.code : 'record-error');
      return;
    }
    this.lastInboundAt = this.now();
    for (const p of plaintexts) {
      this.counters.received += 1;
      let msg: SyncMessage;
      try {
        msg = JSON.parse(p.toString('utf8')) as SyncMessage;
      } catch {
        continue;
      }
      // 轻量 keepalive：ping → pong（不落盘、不投递给上层）
      const payload = msg.payload as { type?: string } | undefined;
      if (msg.channel === 'control' && payload?.type === 'ping') {
        try {
          this.send({ to: msg.from, channel: 'control', payload: { type: 'pong', at: this.now() } });
        } catch {
          /* ignore */
        }
        continue;
      }
      if (msg.channel === 'control' && payload?.type === 'pong') continue;
      if (this.channel.wantsKeyUpdate) {
        try {
          this.requestKeyUpdate();
        } catch {
          /* ignore */
        }
      }
      this.opts.onMessage?.(msg, this);
    }
  }

  close(reason = 'local-close'): void {
    if (this.phase === 'closed') return;
    this.phase = 'closed';
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.channel.close();
    try {
      this.socket.destroy();
    } catch {
      /* ignore */
    }
    this.opts.onClose?.(this, reason);
  }
}

/* ────────────────────────────── 服务端 ────────────────────────────── */

export interface SecureSyncServerOptions {
  identity: IdentityProvider | NormalizedIdentity;
  nodeId: string;
  port: number;
  host?: string;
  groupId?: string | null;
  /** 名册校验（返回 false 即拒绝） */
  roster?: (fingerprint: string) => boolean;
  /** 允许的对端指纹白名单（可选，pin 模式） */
  peerFingerprint?: string | null;
  /**
   * 指纹推导（公钥 → 指纹）。**接线方必须注入身份层那一套**：
   * 默认 `warmyFingerprint` 是 base32(sha256(raw 32B))，而现有身份层是
   * 「sha256(SPKI DER) → base32 前 20 位 + 校验位」—— 不注入会让**每一条**合法连接
   * 在 `normalizeIdentity()` / `checkPeerIdentity()` 处以 fingerprint-mismatch 被拒。
   */
  fingerprintDerivation?: ZhiWenTuiDao;
  replayGuard?: ReplayGuard;
  phaseTimeoutMs?: number;
  handshakeTimeoutMs?: number;
  heartbeatMs?: number;
  logFile?: string;
  onSession?: (session: SecureSession) => void;
  onMessage?: (msg: SyncMessage, session: SecureSession) => void;
  onClose?: (session: SecureSession, reason: string) => void;
  onHandshakeEvent?: (e: HandshakeEvent) => void;
  now?: () => number;
}

export interface ServerHandshakeFailure extends HandshakeFailureRecord {
  remoteAddress?: string;
}

export class SecureSyncServer {
  private server: net.Server | null = null;
  private sessions = new Set<SecureSession>();
  readonly failures: ServerHandshakeFailure[] = [];
  readonly rejectionCounts: Record<string, number> = {};
  readonly accepted = { total: 0, rejected: 0 };

  constructor(private readonly opts: SecureSyncServerOptions) {}

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((sock) => this.onConnection(sock));
      this.server.once('error', reject);
      this.server.listen(this.opts.port, this.opts.host ?? '0.0.0.0', () => {
        resolve(this.boundPort);
      });
    });
  }

  get boundPort(): number {
    const addr = this.server?.address();
    if (addr && typeof addr === 'object') return addr.port;
    return this.opts.port;
  }

  get listening(): boolean {
    return !!this.server?.listening;
  }

  get sessionList(): SecureSession[] {
    return [...this.sessions];
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      for (const s of this.sessions) s.close('server-stop');
      this.sessions.clear();
      if (!this.server) return resolve();
      this.server.close(() => resolve());
      this.server = null;
    });
  }

  private onConnection(sock: net.Socket): void {
    const now = this.opts.now ?? (() => Date.now());
    const driver = new HandshakeDriver({
      identity: this.opts.identity,
      role: 'responder',
      peerFingerprint: this.opts.peerFingerprint ?? null,
      roster: this.opts.roster,
      groupId: this.opts.groupId ?? null,
      fingerprintDerivation: this.opts.fingerprintDerivation,
      replayGuard: this.opts.replayGuard,
      phaseTimeoutMs: this.opts.phaseTimeoutMs,
      now: this.opts.now,
      onEvent: this.opts.onHandshakeEvent,
    });
    const buffer = new SwitchBuffer();
    let phase: 'handshake' | 'records' | 'done' = 'handshake';
    const remoteAddress = sock.remoteAddress ?? undefined;
    const remotePort = sock.remotePort ?? undefined;

    const timer = setTimeout(
      () => {
        if (phase === 'handshake') finish(`握手超时 ${this.opts.handshakeTimeoutMs ?? 15_000}ms`);
      },
      this.opts.handshakeTimeoutMs ?? 15_000
    );
    timer.unref?.();

    const failHandshake = (err: unknown): void => {
      const reason = err instanceof HandshakeError ? err.reason : 'protocol-error';
      const detail = err instanceof Error ? err.message : String(err);
      this.failures.push({ reason, detail, role: 'responder', at: now(), remoteAddress });
      this.rejectionCounts[reason] = (this.rejectionCounts[reason] ?? 0) + 1;
      this.accepted.rejected += 1;
      try {
        sock.write(JSON.stringify({ t: 'error', reason, detail }) + '\n');
      } catch {
        /* ignore */
      }
      finish(`handshake-rejected:${reason}`);
    };

    const finish = (reason: string): void => {
      if (phase === 'done') return;
      phase = 'done';
      clearTimeout(timer);
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      void reason;
    };

    const handleRecords = (chunk: Buffer): void => {
      const session = sessionRef;
      if (!session) return;
      session.handleData(chunk);
    };

    let sessionRef: SecureSession | null = null;
    let pumping = false;

    sock.on('data', (chunk: Buffer) => {
      if (phase === 'done') return;
      if (phase === 'handshake') {
        buffer.push(chunk);
        // 串行化：多个 data 事件不会并行走同一段缓冲区；
        // 正在跑的那次 pump 会在每步 await 之后继续把新到的行读干净，不会丢行。
        if (pumping) return;
        pumping = true;
        void (async () => {
          try {
            for (;;) {
              const line = buffer.readLine();
              if (line === null) break;
              if (!line.trim()) continue;
              let frame: HsFrame | { t: 'error'; reason?: string; detail?: string };
              try {
                frame = JSON.parse(line) as HsFrame | { t: 'error'; reason?: string; detail?: string };
              } catch {
                throw new HandshakeError('malformed', '握手帧不是合法 JSON');
              }
              if (frame.t === 'error') {
                throw new HandshakeError('protocol-error', `对端拒绝握手：${JSON.stringify(frame)}`);
              }
              const res = await driver.step(frame as HsFrame);
              for (const out of res.out) sock.write(JSON.stringify(out) + '\n');
              if (res.done) {
                clearTimeout(timer);
                const channel = SecureSession.buildChannel(driver, 'responder');
                const keys = driver.session;
                if (!keys) throw new Error('缺少会话密钥');
                const session = new SecureSession(
                  sock,
                  channel,
                  driver,
                  {
                    peerFingerprint: keys.peerFingerprint,
                    role: 'responder',
                    direction: 'inbound',
                    groupId: keys.groupId,
                    establishedAt: keys.establishedAt,
                    keyFingerprint: keys.keyFingerprint,
                    handshakeId: keys.handshakeId,
                    tofu: keys.tofu,
                    remoteAddress,
                    remotePort,
                  },
                  {
                    nodeId: this.opts.nodeId,
                    onMessage: this.opts.onMessage,
                    onClose: (s, reason) => {
                      this.sessions.delete(s);
                      this.opts.onClose?.(s, reason);
                    },
                    onEvent: this.opts.onHandshakeEvent,
                    heartbeatMs: this.opts.heartbeatMs,
                    logFile: this.opts.logFile,
                    now: this.opts.now,
                  }
                );
                sessionRef = session;
                this.sessions.add(session);
                this.accepted.total += 1;
                phase = 'records';
                session.enterRecordPhase();
                this.opts.onSession?.(session);
              }
            }
          } catch (err) {
            failHandshake(err);
          } finally {
            pumping = false;
          }
        })();
        return;
      }
      handleRecords(chunk);
    });

    sock.on('error', () => finish('socket-error'));
    sock.on('close', () => {
      finish('socket-close');
      sessionRef?.close('socket-close');
    });
  }
}

/* ────────────────────────────── 客户端 ────────────────────────────── */

export interface SecureSyncClientOptions {
  identity: IdentityProvider | NormalizedIdentity;
  nodeId: string;
  host: string;
  port: number;
  groupId?: string | null;
  /** 已知对端指纹（名册内）；null = TOFU */
  peerFingerprint?: string | null;
  roster?: (fingerprint: string) => boolean;
  /** 指纹推导（公钥 → 指纹）；必须与身份层一致，理由见 SecureSyncServerOptions */
  fingerprintDerivation?: ZhiWenTuiDao;
  replayGuard?: ReplayGuard;
  handshakeTimeoutMs?: number;
  heartbeatMs?: number;
  onMessage?: (msg: SyncMessage, session: SecureSession) => void;
  onClose?: (session: SecureSession, reason: string) => void;
  onHandshakeEvent?: (e: HandshakeEvent) => void;
  now?: () => number;
}

export interface LianJieJieGuo {
  ok: boolean;
  session?: SecureSession;
  /** 失败原因（握手拒绝 / TCP 不通） */
  reason?: string;
  handshakeFailure?: HandshakeFailureRecord;
  remoteAddress?: string;
}

/**
 * 拨出方：**成员发起的持久连接**（ADR C1：在线判据是这条连接的存活）。
 * 一次 connect() 只做一次拨号 + 一次握手，失败即返回，**不做内部无限重试**
 * —— 重试策略属上层（宣告式上线：失败即放弃）。
 */
export class SecureSyncClient {
  private sessionRef: SecureSession | null = null;

  constructor(private readonly opts: SecureSyncClientOptions) {}

  get session(): SecureSession | null {
    return this.sessionRef;
  }

  async connect(timeoutMs = 8000): Promise<LianJieJieGuo> {
    const now = this.opts.now ?? (() => Date.now());
    const sock = net.connect({ host: this.opts.host, port: this.opts.port });
    const result = await new Promise<LianJieJieGuo>((resolve) => {
      let settled = false;
      const settle = (r: LianJieJieGuo): void => {
        if (settled) return;
        settled = true;
        resolve(r);
      };
      const fail = (reason: string, failure?: HandshakeFailureRecord): void => {
        try {
          sock.destroy();
        } catch {
          /* ignore */
        }
        settle({ ok: false, reason, handshakeFailure: failure, remoteAddress: sock.remoteAddress ?? undefined });
      };
      const timer = setTimeout(() => fail(`TCP 连接超时 ${timeoutMs}ms`), timeoutMs);
      timer.unref?.();

      const driver = new HandshakeDriver({
        identity: this.opts.identity,
        role: 'initiator',
        peerFingerprint: this.opts.peerFingerprint ?? null,
        roster: this.opts.roster,
        groupId: this.opts.groupId ?? null,
        fingerprintDerivation: this.opts.fingerprintDerivation,
        replayGuard: this.opts.replayGuard,
        now: this.opts.now,
        onEvent: this.opts.onHandshakeEvent,
      });
      const buffer = new SwitchBuffer();
      let phase: 'connect' | 'handshake' | 'records' | 'done' = 'connect';
      let session: SecureSession | null = null;
      let pumping = false;

      sock.once('connect', () => {
        phase = 'handshake';
        const hs1 = driver.start();
        void hs1
          .then((f) => {
            if (!f) throw new Error('缺少 HS1');
            sock.write(JSON.stringify(f) + '\n');
          })
          .catch((e: unknown) => {
            fail(`握手初始化失败：${e instanceof Error ? e.message : String(e)}`);
          });
      });

      sock.on('data', (chunk: Buffer) => {
        if (phase === 'done') return;
        if (phase === 'handshake') {
          buffer.push(chunk);
          if (pumping) return;
          pumping = true;
          void (async () => {
            try {
              for (;;) {
                const line = buffer.readLine();
                if (line === null) break;
                if (!line.trim()) continue;
                const frame = JSON.parse(line) as HsFrame | { t: 'error'; reason?: string; detail?: string };
                if (frame.t === 'error') {
                  // 对端给出的具体原因原样透出（便于 UI 显示"上次失败原因"，ADR A7）
                  const reason = KNOWN_HANDSHAKE_REASONS.has(String(frame.reason))
                    ? (frame.reason as HandshakeFailureReason)
                    : 'protocol-error';
                  throw new HandshakeError(reason, `对端拒绝握手：${frame.reason ?? ''} ${frame.detail ?? ''}`.trim());
                }
                const res = await driver.step(frame as HsFrame);
                for (const out of res.out) sock.write(JSON.stringify(out) + '\n');
                if (res.done) {
                  clearTimeout(timer);
                  const channel = SecureSession.buildChannel(driver, 'initiator');
                  const keys = driver.session;
                  if (!keys) throw new Error('缺少会话密钥');
                  session = new SecureSession(
                    sock,
                    channel,
                    driver,
                    {
                      peerFingerprint: keys.peerFingerprint,
                      role: 'initiator',
                      direction: 'outbound',
                      groupId: keys.groupId,
                      establishedAt: keys.establishedAt,
                      keyFingerprint: keys.keyFingerprint,
                      handshakeId: keys.handshakeId,
                      tofu: keys.tofu,
                      remoteAddress: sock.remoteAddress ?? undefined,
                      remotePort: sock.remotePort ?? undefined,
                    },
                    {
                      nodeId: this.opts.nodeId,
                      onMessage: this.opts.onMessage,
                      onClose: (s, reason) => {
                        if (this.sessionRef === s) this.sessionRef = null;
                        this.opts.onClose?.(s, reason);
                      },
                      onEvent: this.opts.onHandshakeEvent,
                      heartbeatMs: this.opts.heartbeatMs,
                      now: this.opts.now,
                    }
                  );
                  this.sessionRef = session;
                  phase = 'records';
                  session.enterRecordPhase();
                  settle({ ok: true, session, remoteAddress: sock.remoteAddress ?? undefined });
                }
              }
            } catch (err) {
              const reason = err instanceof HandshakeError ? err.reason : 'protocol-error';
              fail(`握手失败 ${reason}: ${err instanceof Error ? err.message : String(err)}`, {
                reason,
                detail: err instanceof Error ? err.message : String(err),
                role: 'initiator',
                at: now(),
              });
            } finally {
              pumping = false;
            }
          })();
          return;
        }
        session?.handleData(chunk);
      });

      sock.once('error', (e: Error) => fail(`TCP 连接失败：${e.message}`));
      sock.once('close', () => {
        if (phase !== 'records') fail('连接在握手完成前关闭');
      });
    });
    return result;
  }

  close(reason = 'local-close'): void {
    this.sessionRef?.close(reason);
    this.sessionRef = null;
  }
}

export function isValidSyncMessage(v: unknown): v is SyncMessage {
  if (typeof v !== 'object' || v === null) return false;
  const m = v as Partial<SyncMessage>;
  return typeof m.id === 'string' && typeof m.channel === 'string' && typeof m.ts === 'number';
}

export { HandshakeError, HandshakeDriver, ReplayGuard };
export type { HandshakeFailureRecord, HandshakeEvent };
