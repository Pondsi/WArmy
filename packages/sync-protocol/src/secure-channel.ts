/**
 * secure-channel —— 会话记录层（AES-256-GCM 分帧 + 长连接密钥更新）
 *
 * 密钥来源：`HandshakeDriver` 产出的 `SessionKeys`（每连接一次 X25519 ECDHE）。
 * **不是每条消息重握手** —— 一条连接上发 N 条消息只用同一代密钥；
 * 需要刷新时走 `requestKeyUpdate()`（TLS 1.3 KeyUpdate 思路），只重派生密钥，
 * 不重握手、不重认证。
 *
 * 记录格式（TCP 字节流）：
 *   u32be(len) | u8(type) | ciphertext+tag(16)
 *   len  = 1 + ct 长度
 *   IV   = ivSalt(4B，随代次变化) || counter(8B 大端)
 *   AAD  = type(1B) || generation(4B 大端) || counter(8B 大端)
 *   type = 1 应用数据 / 2 密钥更新
 *
 * 为什么这个设计能防重放 / 重排：
 *  - 每条方向一个计数器，从 0 开始严格递增且不重复；IV 由计数器决定，
 *    因此同一代次内 IV 绝不重复（AES-GCM 的硬性要求）；
 *  - 接收侧要求 counter 恰好等于期望值，任何重放 / 乱序 / 重复帧都会直接失败；
 *  - 计数器写进 AAD，篡改计数器等同于破坏 tag。
 */
import {
  type Bytes,
  ZhenJieMa,
  GCM_TAG_LENGTH,
  frame,
  hkdf,
  open,
  sealWithIv,
  sha256Hex,
  toBuf,
  u32be,
  u64be,
} from './codec.js';
import type { HandshakeRole, SessionKeys } from './handshake.js';

export const RECORD_TYPE_APP = 1;
export const RECORD_TYPE_KEY_UPDATE = 2;
/** 单代次最多容纳的记录数（2^32-1），超过就必须换密钥（TLS 1.3 同量级） */
export const MAX_RECORDS_PER_GENERATION = 2 ** 32 - 1;

export type TongDaoFangXiang = 'initiator-to-responder' | 'responder-to-initiator';

export type SecureChannelErrorCode =
  | 'not-authorized-tag'
  | 'record-too-large'
  | 'generation-exhausted'
  | 'peer-closed'
  | 'malformed-record'
  | 'counter-exhausted';

export class AnQuanTongDaoCuoWu extends Error {
  constructor(
    public readonly code: SecureChannelErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'SecureChannelError';
  }
}

export interface SecureChannelEvent {
  type: 'send' | 'receive' | 'key-update';
  generation: number;
  direction: TongDaoFangXiang;
  bytes?: number;
  detail?: string;
  ts: number;
}

export interface SecureChannelOptions {
  /** 自动要求换密钥的阈值（已发记录数），默认 2^20 */
  autoKeyUpdateAfter?: number;
  maxRecordBytes?: number;
  now?: () => number;
  onEvent?: (e: SecureChannelEvent) => void;
}

interface DirectionState {
  material: Buffer;
  key: Buffer;
  ivSalt: Buffer;
  counter: number;
  generation: number;
}

export interface SecureChannelStats {
  recordsSent: number;
  recordsReceived: number;
  bytesSent: number;
  bytesReceived: number;
  keyUpdates: number;
  /** 始终为 1：本通道由**一次**握手建立，之后只在密钥层面刷新 */
  handshakes: number;
}

/**
 * 单条连接上的加密通道。`role` 只影响方向映射：
 *  - initiator：发送用 c2s 材料，接收用 s2c 材料
 *  - responder：相反
 */
export class AnQuanTongDao {
  private sendState: DirectionState;
  private recvState: DirectionState;
  private readonly decoder: ZhenJieMa;
  private closed = false;
  private readonly autoKeyUpdateAfter: number;
  private readonly now: () => number;
  private readonly opts: SecureChannelOptions;
  private pendingKeyUpdate = false;
  private stats: SecureChannelStats = {
    recordsSent: 0,
    recordsReceived: 0,
    bytesSent: 0,
    bytesReceived: 0,
    keyUpdates: 0,
    handshakes: 1,
  };
  /** 每代次的发送密钥指纹（外部可核对代次切换是否真的换了密钥） */
  private readonly keyHistory: { generation: number; fingerprint: string }[] = [];

  constructor(
    private readonly session: SessionKeys,
    role: HandshakeRole = session.role,
    opts: SecureChannelOptions = {}
  ) {
    this.opts = opts;
    this.autoKeyUpdateAfter = opts.autoKeyUpdateAfter ?? 2 ** 20;
    this.now = opts.now ?? (() => Date.now());
    this.decoder = new ZhenJieMa(opts.maxRecordBytes ?? 16 * 1024 * 1024);
    const sendMaterial = role === 'initiator' ? session.c2sMaterial : session.s2cMaterial;
    const recvMaterial = role === 'initiator' ? session.s2cMaterial : session.c2sMaterial;
    this.sendState = this.buildDirection(sendMaterial, 0);
    this.recvState = this.buildDirection(recvMaterial, 0);
    this.keyHistory.push({ generation: 0, fingerprint: this.sendFingerprint });
  }

  private buildDirection(material: Buffer, generation: number): DirectionState {
    const m = Buffer.from(material);
    return {
      material: m,
      key: hkdf(m, this.session.transcriptHash, `key|${generation}`, 32),
      ivSalt: hkdf(m, this.session.transcriptHash, `iv|${generation}`, 4),
      counter: 0,
      generation,
    };
  }

  private deriveNext(state: DirectionState): DirectionState {
    const gen = state.generation + 1;
    const nextMaterial = hkdf(state.material, this.session.transcriptHash, `next|${gen}`, 32);
    return this.buildDirection(nextMaterial, gen);
  }

  /* ── 只读信息 ── */

  get generation(): number {
    return this.sendState.generation;
  }
  get recvGeneration(): number {
    return this.recvState.generation;
  }
  get peerFingerprint(): string {
    return this.session.peerFingerprint;
  }
  get handshakeId(): string {
    return this.session.handshakeId;
  }
  get tofu(): boolean {
    return this.session.tofu;
  }
  get counters(): { sent: number; received: number } {
    return { sent: this.sendState.counter, received: this.recvState.counter };
  }
  get channelStats(): SecureChannelStats {
    return { ...this.stats };
  }
  get wantsKeyUpdate(): boolean {
    return this.pendingKeyUpdate;
  }
  /** 本端发送方向的当前密钥指纹 */
  get sendFingerprint(): string {
    return sha256Hex(this.sendState.material, Buffer.from(`gen|${this.sendState.generation}`));
  }
  get history(): ReadonlyArray<{ generation: number; fingerprint: string }> {
    return this.keyHistory;
  }

  /* ── 发送 ── */

  /** 加密一条应用记录，返回可直接写 socket 的字节 */
  sealRecord(payload: Bytes): Buffer {
    if (this.closed) throw new AnQuanTongDaoCuoWu('peer-closed', 'channel 已关闭');
    const body = this.encrypt(RECORD_TYPE_APP, toBuf(payload));
    this.stats.recordsSent += 1;
    this.stats.bytesSent += body.length;
    this.emit('send', body.length);
    if (this.sendState.counter >= this.autoKeyUpdateAfter) this.pendingKeyUpdate = true;
    return body;
  }

  /**
   * 请求密钥更新：返回一条用**旧密钥**加密的"密钥更新"控制记录。
   * 调用方把字节写出去之后，本端发送方向立即切到新代次（TLS 1.3 语义：
   * 发送方发完即换；接收方处理完该帧才换）。
   */
  requestKeyUpdate(): Buffer {
    if (this.closed) throw new AnQuanTongDaoCuoWu('peer-closed', 'channel 已关闭');
    const rec = this.encrypt(RECORD_TYPE_KEY_UPDATE, Buffer.from('key-update', 'utf8'));
    this.sendState = this.deriveNext(this.sendState);
    this.stats.keyUpdates += 1;
    this.pendingKeyUpdate = false;
    this.keyHistory.push({ generation: this.sendState.generation, fingerprint: this.sendFingerprint });
    this.emit('key-update', rec.length, 'send-direction updated');
    return rec;
  }

  /* ── 接收 ── */

  /** 解密来自 socket 的字节流，返回已解出的应用层载荷（0 条 / 多条） */
  openRecords(chunk: Bytes): Buffer[] {
    if (this.closed) throw new AnQuanTongDaoCuoWu('peer-closed', 'channel 已关闭');
    let records: Buffer[];
    try {
      records = this.decoder.push(chunk);
    } catch (e) {
      throw new AnQuanTongDaoCuoWu('record-too-large', String((e as Error).message ?? e));
    }
    const out: Buffer[] = [];
    for (const rec of records) {
      if (rec.length < 1 + GCM_TAG_LENGTH) {
        throw new AnQuanTongDaoCuoWu('malformed-record', `记录过短：${rec.length}`);
      }
      const type = rec.readUInt8(0);
      const ct = rec.subarray(1);
      const st = this.recvState;
      const counter = st.counter;
      if (counter > MAX_RECORDS_PER_GENERATION) {
        throw new AnQuanTongDaoCuoWu('counter-exhausted', '记录计数达到上限，必须先换密钥');
      }
      const iv = Buffer.concat([st.ivSalt, u64be(counter)]);
      const aad = Buffer.concat([Buffer.from([type]), u32be(st.generation), u64be(counter)]);
      let plain: Buffer;
      try {
        plain = open(st.key, { iv, ct }, aad);
      } catch {
        throw new AnQuanTongDaoCuoWu(
          'not-authorized-tag',
          `记录认证失败（gen=${st.generation} counter=${counter}）：密钥不符或被篡改`
        );
      }
      st.counter += 1;
      this.stats.recordsReceived += 1;
      this.stats.bytesReceived += rec.length;
      if (type === RECORD_TYPE_APP) {
        out.push(plain);
        this.emit('receive', rec.length);
      } else if (type === RECORD_TYPE_KEY_UPDATE) {
        this.recvState = this.deriveNext(this.recvState);
        this.stats.keyUpdates += 1;
        this.emit('key-update', rec.length, 'recv-direction updated');
      } else {
        throw new AnQuanTongDaoCuoWu('malformed-record', `未知记录类型 ${type}`);
      }
    }
    return out;
  }

  close(): void {
    this.closed = true;
  }

  private emit(type: SecureChannelEvent['type'], bytes?: number, detail?: string): void {
    this.opts.onEvent?.({
      type,
      generation: type === 'receive' ? this.recvState.generation : this.sendState.generation,
      direction: this.session.role === 'initiator' ? 'initiator-to-responder' : 'responder-to-initiator',
      bytes,
      detail,
      ts: this.now(),
    });
  }

  private encrypt(type: number, plaintext: Buffer): Buffer {
    const st = this.sendState;
    if (st.counter > MAX_RECORDS_PER_GENERATION) {
      throw new AnQuanTongDaoCuoWu('counter-exhausted', '记录计数达到上限，必须先换密钥');
    }
    const counter = st.counter;
    st.counter += 1;
    const iv = Buffer.concat([st.ivSalt, u64be(counter)]);
    const aad = Buffer.concat([Buffer.from([type]), u32be(st.generation), u64be(counter)]);
    const ct = sealWithIv(st.key, plaintext, aad, iv);
    return frame(Buffer.concat([Buffer.from([type]), ct]));
  }
}
