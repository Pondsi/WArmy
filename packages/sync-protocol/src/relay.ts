/**
 * relay —— 中继兜底档：双 CGNAT 死锁的出路（ADR 003 §附八.3）
 *
 * 问题（ADR 原话）：§2.5 指出"家用宽带大量在 CGNAT 后面，DHT 查到 IP 也连不上"，
 * 而 §附三.2 的策略是"宣告失败即放弃"。两条叠加 ⇒ **双方都不可拨入时谁都连不上谁，UI 只能一直转圈**。
 * ADR 已定：① 必须保留中继兜底档；② UI 文案与阶梯位置匹配；③ 这个状态**可检测**（双方各自报告"本机不可拨入"）。
 *
 * 本模块提供三件事：
 *  1. `RelayNode`      —— 中继节点（**纯字节转发**）：把两条到中继的出站连接按 token 配对后对拷字节。
 *  2. `RelayTunnelDialer` / `RelayTunnelListener` —— 端点侧适配器：把"中继配对"翻译成**本机 TCP 连接**，
 *     这样既有的 `SecureSyncServer` / `SecureSyncClient`（含 HS1–HS4 握手、`ReplayGuard`、`SecureChannel`）
 *     **不需要任何改动**就能跑在中继之上 —— 中继路径上的鉴权/加密语义与直连**完全一致**。
 *  3. `decideRelay()`  —— 阶梯用的判定：两端都不可拨入时是否选中继、没有可用中继时**如实报缺口**。
 *
 * 安全边界（必须看清，别把中继当成一条"可信管道"）：
 *  · 中继**看不到明文**：会话密钥来自两端之间的 X25519 ECDHE，中继只是把密文搬来搬去；
 *    它能看到握手帧里的公钥/nonce/签名（那是**元数据**，不是内容），但推不出共享密钥。
 *  · 中继**不能冒充对端**：指纹由公钥推出（`warmyFingerprint`），且握手会校验对端指纹；
 *    中继/第三方用别的身份来配对，会在握手层被 roster / 指纹校验拒掉。
 *  · 中继**不能篡改/重排/重放后仍被接受**：记录层每方向一个严格递增的单调计数并被写进 AAD
 *    （见 secure-channel.ts），任何重放/乱序/改字节都会认证失败并断连。
 *    本模块为此提供了 `mode`（replay-once / tamper-once / swap-once）与 `inject()`，
 *    **专门用来做攻击面验证**（恶意中继模拟），默认 `forward` = 老实转发。
 *  · token **不是凭据**，只是"配对标签"（两端各自从"双方指纹 + 中继地址"确定性算出）。
 *    已知未解决的风险：持有同一 token 的第三方可以**抢占配对槽位**（拒绝服务面，不是机密性面）。
 *
 * 未验证边界：真实跨 NAT / 真实公网中继服务器需要第二台机器与公网地址，本机做不到
 * （见 `verify-connectivity.mjs` 的"真实公网可达性未验证"断言）。
 */
import net from 'node:net';
import { sha256Hex } from './codec.js';
import type { DhtDiZhi } from './dht.js';

export const RELAY_PROTOCOL = 'warmy-relay/1';
export const DEFAULT_RELAY_PAIR_TIMEOUT_MS = 10_000;
export const DEFAULT_RELAY_SAMPLE_BYTES = 64;
const RELAY_MAX_LINE = 8 * 1024;
const RELAY_MAX_SAMPLES = 256;

export type ZhongJiJueSe = 'listener' | 'dialer';
/** 'forward' = 老实转发；其余三种是**攻击面验证**用的恶意中继模式 */
export type ZhongJiMoShi = 'forward' | 'replay-once' | 'tamper-once' | 'swap-once';
export type ZhongJiFangXiang = 'dialer->listener' | 'listener->dialer';

export interface ZhongJiWenHou {
  t: 'relay-hello';
  v: 1;
  token: string;
  role: ZhongJiJueSe;
  /** 自称的节点指纹：仅用于日志/统计，中继**不据此做任何信任决策** */
  from?: string;
}

export interface ZhongJiYiZhuCe {
  t: 'relay-registered';
  v: 1;
  token: string;
  role: ZhongJiJueSe;
}

export interface ZhongJiJiuXu {
  t: 'relay-ready';
  v: 1;
  token: string;
  paired: boolean;
  reason?: string;
}

/** 中继**看到**的字节样本（十六进制前缀）。用于证明"经中继的只有密文" */
export interface ZhongJiYangBen {
  token: string;
  direction: ZhongJiFangXiang;
  bytes: number;
  firstBytesHex: string;
  at: number;
}

export interface ZhongJiShiJian {
  type: 'register' | 'paired' | 'forward' | 'reject' | 'attack' | 'close';
  token?: string;
  detail?: string;
  bytes?: number;
  ts: number;
}

export interface ZhongJiJieDianXuanXiang {
  /** 监听端口（0 = 随机） */
  port: number;
  /** 默认 127.0.0.1；真实部署时是"有公网地址的那台机器"的地址 */
  host?: string;
  /** token 授权钩子（默认接受任意非空 token；生产应校验） */
  authorizeToken?: (token: string, role: ZhongJiJueSe) => boolean;
  /** 等待对端配对的上限（超时后向等待方如实回 `paired:false`） */
  pairTimeoutMs?: number;
  mode?: ZhongJiMoShi;
  sampleBytes?: number;
  maxPairs?: number;
  onEvent?: (e: ZhongJiShiJian) => void;
  now?: () => number;
}

class LineReader {
  private buf: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): void {
    this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk]);
  }
  readLine(): string | null {
    const raw = this.readLineRaw();
    return raw === null ? null : raw.subarray(0, raw.length - 1).toString('utf8');
  }
  /** 读一行但**保留换行**（原样转发对端数据时必须用这个） */
  readLineRaw(): Buffer | null {
    const i = this.buf.indexOf(0x0a);
    if (i < 0) {
      if (this.buf.length > RELAY_MAX_LINE) throw new Error('relay: 控制行过长');
      return null;
    }
    const raw = this.buf.subarray(0, i + 1);
    this.buf = this.buf.subarray(i + 1);
    return raw;
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

interface Half {
  token: string;
  role: ZhongJiJueSe;
  sock: net.Socket;
  reader: LineReader;
  paired: boolean;
  closed: boolean;
  bytesIn: number;
  bytesOut: number;
  peer?: Half;
  timer?: NodeJS.Timeout;
}

function writeLine(sock: net.Socket, obj: ZhongJiYiZhuCe | ZhongJiJiuXu | Record<string, unknown>): void {
  try {
    sock.write(Buffer.from(`${JSON.stringify(obj)}\n`, 'utf8'));
  } catch {
    /* 对端已断，忽略 */
  }
}

/** 端点侧：一次到中继的连接（已握手控制行，进入透明管道阶段） */
interface RelayConn {
  ok: boolean;
  sock?: net.Socket;
  /** 控制行之外多读到的字节（配对时缓冲下来的），要原样交给本地侧 */
  rest?: Buffer;
  paired?: boolean;
  reason?: string;
}

/* ────────────────────────────── 中继节点 ────────────────────────────── */

export class ZhongJiJieDian {
  private server: net.Server | null = null;
  private readonly slots = new Map<string, { listener?: Half; dialer?: Half }>();
  private readonly sampleLog: ZhongJiYangBen[] = [];
  private readonly pairs = new Set<Half>();
  private registered = 0;
  private rejected = 0;
  private pairCount = 0;
  private bytesForwarded = 0;
  private mode: ZhongJiMoShi;
  private attackArmed = false;
  private port = 0;
  private readonly now: () => number;

  constructor(private readonly opts: ZhongJiJieDianXuanXiang) {
    this.mode = opts.mode ?? 'forward';
    this.now = opts.now ?? (() => Date.now());
  }

  get boundPort(): number {
    return this.port;
  }
  get address(): DhtDiZhi {
    return { host: this.opts.host ?? '127.0.0.1', port: this.boundPort };
  }
  get stats(): {
    registered: number;
    rejected: number;
    pairs: number;
    bytesForwarded: number;
    samples: number;
    pendingSlots: number;
  } {
    return {
      registered: this.registered,
      rejected: this.rejected,
      pairs: this.pairCount,
      bytesForwarded: this.bytesForwarded,
      samples: this.sampleLog.length,
      pendingSlots: this.slots.size,
    };
  }
  /** 中继"看到"的字节（十六进制前缀）—— 用于断言中继只见到密文 */
  get samples(): ZhongJiYangBen[] {
    return this.sampleLog.map((s) => ({ ...s }));
  }
  get allForwardedBytes(): number {
    return this.bytesForwarded;
  }

  /** 切换恶意中继模式（攻击面验证用；默认 'forward'） */
  setMode(mode: ZhongJiMoShi): void {
    this.mode = mode;
    this.attackArmed = false;
  }

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer((sock) => this.onConnection(sock));
      this.server = server;
      server.once('error', reject);
      server.listen(this.opts.port, this.opts.host ?? '127.0.0.1', () => {
        const a = server.address();
        this.port = a && typeof a === 'object' ? a.port : this.opts.port;
        resolve(this.boundPort);
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      for (const half of this.pairs) this.destroy(half, 'relay-stop');
      for (const slot of this.slots.values()) {
        if (slot.listener) this.destroy(slot.listener, 'relay-stop');
        if (slot.dialer) this.destroy(slot.dialer, 'relay-stop');
      }
      this.slots.clear();
      this.pairs.clear();
      if (!this.server) return resolve();
      this.server.close(() => resolve());
      this.server = null;
    });
  }

  /**
   * 恶意中继注入：把任意字节塞进已配对的管道（模拟"中继篡改/重放"）。
   * 返回**被交给 socket 的字节数**（0 = 没有配对/没有该方向）。
   * 注意：`socket.write()` 返回 false 只表示超过高水位（背压），数据**仍会写出**，
   * 所以这里不能把 false 当成"没写成功"。
   */
  inject(token: string, direction: ZhongJiFangXiang, bytes: Buffer): number {
    const target = [...this.pairs].find((h) => h.token === token && h.role === (direction === 'dialer->listener' ? 'listener' : 'dialer'));
    if (!target || target.sock.destroyed) return 0;
    target.sock.write(bytes);
    target.bytesOut += bytes.length;
    return bytes.length;
  }

  private onConnection(sock: net.Socket): void {
    sock.on('error', () => {
      /* 对端断开/重置：不抛到进程外 */
    });
    const reader = new LineReader();
    let half: Half | null = null;
    let state: 'hello' | 'piped' = 'hello';

    const onData = (chunk: Buffer): void => {
      if (state === 'piped') {
        // 已配对：任何到达的数据都是纯转发（见 pipe()）
        return;
      }
      reader.push(chunk);
      let line: string | null;
      try {
        line = reader.readLine();
      } catch {
        this.rejectHalf(sock, 'control-line-too-long');
        return;
      }
      if (line === null) return;
      let hello: ZhongJiWenHou;
      try {
        hello = JSON.parse(line) as ZhongJiWenHou;
      } catch {
        this.rejectHalf(sock, 'bad-hello-json');
        return;
      }
      const token = typeof hello.token === 'string' ? hello.token : '';
      const role = hello.role === 'listener' || hello.role === 'dialer' ? hello.role : null;
      if (hello.t !== 'relay-hello' || hello.v !== 1 || !role || token.length < 8 || token.length > 128) {
        this.rejectHalf(sock, 'bad-hello');
        return;
      }
      if (this.opts.authorizeToken && !this.opts.authorizeToken(token, role)) {
        this.rejectHalf(sock, 'token-not-authorized');
        return;
      }
      if (this.opts.maxPairs !== undefined && this.slots.size >= this.opts.maxPairs) {
        this.rejectHalf(sock, 'relay-busy');
        return;
      }
      half = {
        token,
        role,
        sock,
        reader,
        paired: false,
        closed: false,
        bytesIn: 0,
        bytesOut: 0,
      };
      state = 'piped';
      this.registered += 1;
      sock.removeListener('data', onData);
      this.emit({ type: 'register', token, detail: role });
      writeLine(sock, { t: 'relay-registered', v: 1, token, role });
      const slot = this.slots.get(token) ?? {};
      if (role === 'listener') {
        if (slot.listener) this.destroy(slot.listener, 'replaced-by-new-listener');
        slot.listener = half;
      } else {
        if (slot.dialer) this.destroy(slot.dialer, 'replaced-by-new-dialer');
        slot.dialer = half;
      }
      this.slots.set(token, slot);
      // 配对前到达的数据先缓冲（正常情况下端点会等 relay-ready 再发）
      sock.on('data', (c: Buffer) => {
        if (half) half.bytesIn += c.length;
      });
      half.timer = setTimeout(() => {
        if (!half || half.paired || half.closed) return;
        writeLine(sock, { t: 'relay-ready', v: 1, token, paired: false, reason: `等待对端配对超时 ${this.opts.pairTimeoutMs ?? DEFAULT_RELAY_PAIR_TIMEOUT_MS}ms（对端未注册/不可达）` });
        this.emit({ type: 'reject', token, detail: 'pair-timeout' });
        this.destroy(half, 'pair-timeout');
      }, this.opts.pairTimeoutMs ?? DEFAULT_RELAY_PAIR_TIMEOUT_MS);
      half.timer.unref?.();
      sock.once('close', () => {
        if (half) half.closed = true;
        if (half && half.timer) clearTimeout(half.timer);
        const s = half ? this.slots.get(half.token) : undefined;
        if (s && half) {
          if (s.listener === half) delete s.listener;
          if (s.dialer === half) delete s.dialer;
          if (!s.listener && !s.dialer) this.slots.delete(half.token);
        }
        if (half && half.peer && !half.peer.closed) this.destroy(half.peer, 'peer-closed');
        this.emit({ type: 'close', token: half?.token, detail: `bytesIn=${half?.bytesIn ?? 0}` });
      });
      this.tryPair(token);
    };

    sock.on('data', onData);
  }

  private tryPair(token: string): void {
    const slot = this.slots.get(token);
    if (!slot || !slot.listener || !slot.dialer) return;
    const { listener, dialer } = slot;
    this.slots.delete(token);
    this.pairCount += 1;
    if (listener.timer) clearTimeout(listener.timer);
    if (dialer.timer) clearTimeout(dialer.timer);
    listener.paired = true;
    dialer.paired = true;
    listener.peer = dialer;
    dialer.peer = listener;
    this.pairs.add(listener);
    this.pairs.add(dialer);
    this.emit({ type: 'paired', token });
    // 配对前若已收到数据（对端没等 ready 就发了），**原样按序补发**，不丢不乱
    const dialerPre = dialer.reader.takeAll();
    const listenerPre = listener.reader.takeAll();
    writeLine(listener.sock, { t: 'relay-ready', v: 1, token, paired: true });
    writeLine(dialer.sock, { t: 'relay-ready', v: 1, token, paired: true });
    this.pipe(dialer, listener, 'dialer->listener');
    this.pipe(listener, dialer, 'listener->dialer');
    if (dialerPre.length > 0) this.forward(dialer, listener, dialerPre, 'dialer->listener');
    if (listenerPre.length > 0) this.forward(listener, dialer, listenerPre, 'listener->dialer');
  }

  private pipe(from: Half, to: Half, direction: ZhongJiFangXiang): void {
    from.sock.on('data', (chunk: Buffer) => {
      from.bytesIn += chunk.length;
      this.forward(from, to, chunk, direction);
    });
  }

  /**
   * 真正的转发（**唯一**的字节路径）。三种攻击模式只对**第一个**分片生效一次，
   * 之后回到老实转发 —— 这样"篡改/重排/重放被拒"的断言不会被后续流量掩盖。
   */
  private forward(from: Half, to: Half, chunk: Buffer, direction: ZhongJiFangXiang): void {
    const sample = chunk.subarray(0, this.opts.sampleBytes ?? DEFAULT_RELAY_SAMPLE_BYTES);
    if (this.sampleLog.length < RELAY_MAX_SAMPLES) {
      this.sampleLog.push({
        token: from.token,
        direction,
        bytes: chunk.length,
        firstBytesHex: sample.toString('hex'),
        at: this.now(),
      });
    }
    const send = (b: Buffer): void => {
      if (to.sock.destroyed) return;
      to.sock.write(b);
      to.bytesOut += b.length;
      this.bytesForwarded += b.length;
      this.emit({ type: 'forward', token: from.token, bytes: b.length, ts: this.now() });
    };

    if (this.mode === 'forward' || this.attackArmed) {
      send(chunk);
      return;
    }
    this.attackArmed = true;
    if (this.mode === 'tamper-once') {
      const tampered = Buffer.from(chunk);
      if (tampered.length > 0) tampered[tampered.length - 1] = (tampered[tampered.length - 1] as number) ^ 0xff;
      this.emit({ type: 'attack', token: from.token, detail: `tamper-once(${direction})` });
      send(tampered);
      return;
    }
    if (this.mode === 'replay-once') {
      this.emit({ type: 'attack', token: from.token, detail: `replay-once(${direction})` });
      send(chunk);
      send(chunk);
      return;
    }
    // swap-once：扣下第一片，等第二片到了先发第二片再发第一片（字节序被改动）
    this.emit({ type: 'attack', token: from.token, detail: `swap-once(${direction})` });
    const first = chunk;
    const once = (next: Buffer): void => {
      from.sock.removeListener('data', onNext);
      send(next);
      send(first);
    };
    const onNext = (next: Buffer): void => once(next);
    from.sock.once('data', onNext);
  }

  private rejectHalf(sock: net.Socket, reason: string): void {
    this.rejected += 1;
    writeLine(sock, { t: 'relay-ready', v: 1, token: '', paired: false, reason });
    this.emit({ type: 'reject', detail: reason });
    try {
      sock.destroy();
    } catch {
      /* ignore */
    }
  }

  private destroy(half: Half, reason: string): void {
    if (half.closed) return;
    half.closed = true;
    if (half.timer) clearTimeout(half.timer);
    this.pairs.delete(half);
    try {
      half.sock.destroy();
    } catch {
      /* ignore */
    }
    void reason;
  }

  private emit(e: Omit<ZhongJiShiJian, 'ts'> & { ts?: number }): void {
    this.opts.onEvent?.({ ...e, ts: e.ts ?? this.now() });
  }
}

/* ────────────────────────────── 端点侧适配器 ────────────────────────────── */

export interface ZhongJiSuiDaoTongJi {
  role: ZhongJiJueSe;
  token: string;
  relay: DhtDiZhi;
  /** 中继已确认注册 */
  registered: boolean;
  /** 已与对端配对 */
  paired: boolean;
  attempts: number;
  bytesToRelay: number;
  bytesFromRelay: number;
  lastError?: string;
  pairedAt?: number;
}

export interface ZhongJiSuiDaoXuanXiang {
  /** 中继地址（有公网地址的那台机器） */
  relay: DhtDiZhi;
  /** 配对标签（两端必须算出**同一个**值；见 relayTokenFor） */
  token: string;
  /** 本端指纹（只作为 hello 的自称） */
  from?: string;
  /** 等中继配对的上限 */
  readyTimeoutMs?: number;
  sampleBytes?: number;
  onEvent?: (e: ZhongJiShiJian) => void;
  now?: () => number;
}

/** 打开一条到中继的连接并完成控制行握手 */
async function openRelayConn(opts: ZhongJiSuiDaoXuanXiang, role: ZhongJiJueSe): Promise<RelayConn> {
  const timeoutMs = opts.readyTimeoutMs ?? DEFAULT_RELAY_PAIR_TIMEOUT_MS;
  const sock = net.connect({ host: opts.relay.host, port: opts.relay.port });
  const reader = new LineReader();
  return new Promise<RelayConn>((resolve) => {
    let settled = false;
    const done = (r: RelayConn): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => {
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      done({ ok: false, reason: `中继无响应（超时 ${timeoutMs}ms）` });
    }, timeoutMs);
    timer.unref?.();
    sock.on('error', (e: Error) => {
      done({ ok: false, reason: `中继连接失败：${e.message}` });
    });
    let registered = false;
    /** 非控制行（= 真实数据，可能是对端握手帧）**原样保留**，绝不当作无关行丢掉 */
    const pendingLines: Buffer[] = [];
    const takeRest = (): Buffer => Buffer.concat([...pendingLines.splice(0), reader.takeAll()]);
    sock.on('data', (chunk: Buffer) => {
      reader.push(chunk);
      for (;;) {
        let raw: Buffer | null;
        try {
          raw = reader.readLineRaw();
        } catch {
          sock.destroy();
          done({ ok: false, reason: '中继控制行异常' });
          return;
        }
        if (raw === null) return;
        let msg: ZhongJiYiZhuCe | ZhongJiJiuXu | { t?: string };
        try {
          msg = JSON.parse(raw.subarray(0, raw.length - 1).toString('utf8')) as ZhongJiYiZhuCe | ZhongJiJiuXu | { t?: string };
        } catch {
          pendingLines.push(raw);
          continue;
        }
        if (msg.t === 'relay-registered') {
          registered = true;
          if (role === 'listener') {
            done({ ok: true, sock, rest: takeRest(), paired: false });
            return;
          }
          continue;
        }
        if (msg.t === 'relay-ready') {
          const ready = msg as ZhongJiJiuXu;
          if (!ready.paired) {
            sock.destroy();
            done({ ok: false, reason: ready.reason ?? '中继未能配对到对端', paired: false });
            return;
          }
          done({ ok: true, sock, rest: takeRest(), paired: true });
          return;
        }
        pendingLines.push(raw);
      }
    });
    sock.once('connect', () => {
      const hello: ZhongJiWenHou = { t: 'relay-hello', v: 1, token: opts.token, role, ...(opts.from ? { from: opts.from } : {}) };
      sock.write(Buffer.from(`${JSON.stringify(hello)}\n`, 'utf8'));
    });
    sock.once('close', () => {
      if (!registered) done({ ok: false, reason: '中继在注册前关闭了连接' });
    });
  });
}

/**
 * 拨入侧适配器：本地开一个 TCP 端口；本机的 `SecureSyncClient` 连这个端口，
 * 适配器就把这条本地连接**经中继**接到对端（对端是已注册的 listener）。
 * 用途：A 要连 B，但 B 不可拨入（双 CGNAT）→ A 也拨不了 B，只能各自出站到中继。
 */
export class ZhongJiSuiDaoBoHao {
  private server: net.Server | null = null;
  private localPort = 0;
  private readonly opts: ZhongJiSuiDaoXuanXiang;
  private readonly stats: ZhongJiSuiDaoTongJi;
  private pairWaiters: { resolve: (v: { ok: boolean; reason?: string }) => void; timer: NodeJS.Timeout }[] = [];
  private readonly sampleLog: ZhongJiYangBen[] = [];
  private readonly now: () => number;

  constructor(opts: ZhongJiSuiDaoXuanXiang) {
    this.opts = opts;
    this.now = opts.now ?? (() => Date.now());
    this.stats = {
      role: 'dialer',
      token: opts.token,
      relay: opts.relay,
      registered: false,
      paired: false,
      attempts: 0,
      bytesToRelay: 0,
      bytesFromRelay: 0,
    };
  }

  get port(): number {
    return this.localPort;
  }
  get tunnelStats(): ZhongJiSuiDaoTongJi {
    return { ...this.stats };
  }
  get samples(): ZhongJiYangBen[] {
    return this.sampleLog.map((s) => ({ ...s }));
  }

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer((local) => void this.onLocal(local));
      this.server = server;
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const a = server.address();
        this.localPort = a && typeof a === 'object' ? a.port : 0;
        resolve(this.localPort);
      });
    });
  }

  stop(): Promise<void> {
    for (const w of this.pairWaiters) {
      clearTimeout(w.timer);
      w.resolve({ ok: false, reason: 'tunnel-stopped' });
    }
    this.pairWaiters = [];
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      const s = this.server;
      this.server = null;
      s.close(() => resolve());
    });
  }

  /** 等一次"中继配对成功 / 失败"（测试与 UI 都能用它代替轮询） */
  waitForPair(timeoutMs = 5000): Promise<{ ok: boolean; reason?: string }> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pairWaiters = this.pairWaiters.filter((w) => w.timer !== timer);
        resolve({ ok: false, reason: `等待中继配对超时 ${timeoutMs}ms` });
      }, timeoutMs);
      timer.unref?.();
      this.pairWaiters.push({ resolve, timer });
    });
  }

  private settlePair(r: { ok: boolean; reason?: string }): void {
    const waiters = this.pairWaiters;
    this.pairWaiters = [];
    for (const w of waiters) {
      clearTimeout(w.timer);
      w.resolve(r);
    }
  }

  private async onLocal(local: net.Socket): Promise<void> {
    local.on('error', () => {
      /* 本地客户端断开 */
    });
    this.stats.attempts += 1;
    const buffered: Buffer[] = [];
    local.on('data', (c: Buffer) => {
      buffered.push(c);
    });
    const conn = await openRelayConn(this.opts, 'dialer');
    if (!conn.ok || !conn.sock) {
      this.stats.lastError = conn.reason ?? 'relay-connect-failed';
      this.settlePair({ ok: false, reason: this.stats.lastError });
      this.opts.onEvent?.({ type: 'reject', token: this.opts.token, detail: this.stats.lastError, ts: this.now() });
      try {
        local.destroy();
      } catch {
        /* ignore */
      }
      return;
    }
    this.stats.registered = true;
    this.stats.paired = true;
    this.stats.pairedAt = this.now();
    this.settlePair({ ok: true });
    this.opts.onEvent?.({ type: 'paired', token: this.opts.token, detail: 'dialer', ts: this.now() });
    const relaySock = conn.sock;
    relaySock.on('error', () => {
      /* 中继断开 */
    });
    // 配对前本地客户端可能已经写了字节（HS1）：先如实缓冲，再按序补发
    for (const b of buffered.splice(0)) {
      this.stats.bytesToRelay += b.length;
      this.recordSample(this.opts.token, 'dialer->listener', b);
      relaySock.write(b);
    }
    local.on('data', (c: Buffer) => {
      this.stats.bytesToRelay += c.length;
      this.recordSample(this.opts.token, 'dialer->listener', c);
      relaySock.write(c);
    });
    if (conn.rest && conn.rest.length > 0) {
      this.stats.bytesFromRelay += conn.rest.length;
      local.write(conn.rest);
    }
    relaySock.on('data', (c: Buffer) => {
      this.stats.bytesFromRelay += c.length;
      local.write(c);
    });
    const shutdown = (): void => {
      try {
        local.destroy();
      } catch {
        /* ignore */
      }
      try {
        relaySock.destroy();
      } catch {
        /* ignore */
      }
    };
    local.once('close', shutdown);
    relaySock.once('close', shutdown);
  }

  private recordSample(token: string, direction: ZhongJiFangXiang, chunk: Buffer): void {
    if (this.sampleLog.length >= RELAY_MAX_SAMPLES) return;
    this.sampleLog.push({
      token,
      direction,
      bytes: chunk.length,
      firstBytesHex: chunk.subarray(0, this.opts.sampleBytes ?? DEFAULT_RELAY_SAMPLE_BYTES).toString('hex'),
      at: this.now(),
    });
  }
}

/**
 * 被拨入侧适配器（**不可拨入的那一端**）：连中继注册为 listener，
 * 配对成功后由适配器**主动拨本机服务**（`localTarget`），然后双向对拷。
 * 这样本机根本不需要接受任何入站连接 —— 正是双 CGNAT 场景需要的。
 */
export class ZhongJiSuiDaoJianTing {
  private readonly opts: ZhongJiSuiDaoXuanXiang & { localTarget: DhtDiZhi };
  private readonly stats: ZhongJiSuiDaoTongJi;
  private readonly sampleLog: ZhongJiYangBen[] = [];
  private readonly now: () => number;
  private relaySock: net.Socket | null = null;
  private stopped = false;
  /** 本机服务的 socket（连上之后才置位；置位前到达的字节全部进 sinkPending） */
  private localSink: net.Socket | null = null;
  private readonly sinkPending: Buffer[] = [];
  private pairedFired = false;

  constructor(opts: ZhongJiSuiDaoXuanXiang & { localTarget: DhtDiZhi }) {
    this.opts = opts;
    this.now = opts.now ?? (() => Date.now());
    this.stats = {
      role: 'listener',
      token: opts.token,
      relay: opts.relay,
      registered: false,
      paired: false,
      attempts: 0,
      bytesToRelay: 0,
      bytesFromRelay: 0,
    };
  }

  get tunnelStats(): ZhongJiSuiDaoTongJi {
    return { ...this.stats };
  }
  get samples(): ZhongJiYangBen[] {
    return this.sampleLog.map((s) => ({ ...s }));
  }

  async start(): Promise<{ ok: boolean; registered: boolean; reason?: string }> {
    this.stats.attempts += 1;
    // 先做一次"中继可达"的真实 TCP 检查（注册本身需要它）
    const conn = await openRelayConn(this.opts, 'listener');
    if (!conn.ok || !conn.sock) {
      this.stats.lastError = conn.reason ?? 'relay-connect-failed';
      return { ok: false, registered: false, reason: this.stats.lastError };
    }
    this.relaySock = conn.sock;
    this.stats.registered = true;
    this.opts.onEvent?.({ type: 'register', token: this.opts.token, detail: 'listener', ts: this.now() });
    const relaySock = conn.sock;
    relaySock.on('error', () => {
      /* 中继断开 */
    });
    relaySock.once('close', () => {
      this.stopped = true;
    });
    /**
     * 控制行 / 数据流的状态机。
     * **关键（两个坑都在这里，本仓库实测踩过）**：
     *  1. 配对前的缓冲区里可能**同时**有控制行（relay-ready）和真实数据 ——
     *     对端的握手帧也是换行结尾的 JSON 行！所以非控制行必须**原样保留**，不能当"无关行"吃掉；
     *  2. 配对与"本机服务连上"之间到达的字节必须**先缓存**（sinkPending），
     *     等 localSink 就绪后按序补发。
     * 否则表现为"中继说转发成功、端点却一个字节没收到"（静默丢包）。
     */
    const reader = new LineReader();
    if (conn.rest) reader.push(conn.rest);
    const pump = (): void => {
      for (;;) {
        const raw = reader.readLineRaw();
        if (raw === null) break;
        let msg: ZhongJiJiuXu | { t?: string } | null = null;
        try {
          msg = JSON.parse(raw.toString('utf8')) as ZhongJiJiuXu | { t?: string };
        } catch {
          msg = null;
        }
        if (msg && msg.t === 'relay-ready') {
          if ((msg as ZhongJiJiuXu).paired === true) this.pairedFired = true;
          continue;
        }
        if (msg && (msg.t === 'relay-registered' || msg.t === 'relay-hello')) continue;
        this.feedLocal(raw); // 非控制行 = 真实数据，原样保留（含换行）
      }
      if (this.pairedFired) {
        const leftover = reader.takeAll();
        if (leftover.length > 0) this.feedLocal(leftover);
        this.stats.paired = true;
        if (!this.stats.pairedAt) {
          this.stats.pairedAt = this.now();
          void this.onPaired(Buffer.alloc(0));
        }
      }
    };
    relaySock.on('data', (c: Buffer) => {
      if (this.pairedFired) {
        this.feedLocal(c);
        return;
      }
      reader.push(c);
      pump();
    });
    pump();
    void this.awaitRelayReady();
    return { ok: true, registered: true };
  }

  /** 中继来的字节：本机服务已连上就直接写，否则先缓存（按序，不丢不乱） */
  private feedLocal(chunk: Buffer): void {
    if (chunk.length === 0) return;
    if (this.localSink) {
      this.stats.bytesFromRelay += chunk.length;
      this.localSink.write(chunk);
      return;
    }
    this.sinkPending.push(Buffer.from(chunk));
  }

  /** 等中继说"已配对"（listener 侧只有这一条通路） */
  private readonly relayReadyWaiters: { resolve: (v: boolean) => void; timer: NodeJS.Timeout }[] = [];

  waitForPair(timeoutMs = 5000): Promise<boolean> {
    if (this.stats.paired) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve(false);
      }, timeoutMs);
      timer.unref?.();
      this.relayReadyWaiters.push({ resolve, timer });
    });
  }

  private async awaitRelayReady(): Promise<void> {
    // 配对由中继在另一条连接注册时触发（onData 里已处理）；这里只负责唤醒等者
    const iv = setInterval(() => {
      if (this.stats.paired || this.stopped) {
        clearInterval(iv);
        const ws = this.relayReadyWaiters.splice(0);
        for (const w of ws) {
          clearTimeout(w.timer);
          w.resolve(this.stats.paired);
        }
      }
    }, 25);
    iv.unref?.();
  }

  private async onPaired(rest: Buffer): Promise<void> {
    if (this.stopped) return;
    const relaySock = this.relaySock;
    if (!relaySock) return;
    this.stats.pairedAt = this.now();
    this.opts.onEvent?.({ type: 'paired', token: this.opts.token, detail: 'listener', ts: this.now() });
    // listener 侧：配对后**由适配器主动拨本机服务**（本机无需接受任何入站连接）
    const local = net.connect({ host: this.opts.localTarget.host, port: this.opts.localTarget.port });
    const okLocal = await new Promise<boolean>((resolve) => {
      const t = setTimeout(() => {
        try {
          local.destroy();
        } catch {
          /* ignore */
        }
        resolve(false);
      }, this.opts.readyTimeoutMs ?? DEFAULT_RELAY_PAIR_TIMEOUT_MS);
      t.unref?.();
      local.once('connect', () => {
        clearTimeout(t);
        resolve(true);
      });
      local.once('error', () => {
        clearTimeout(t);
        resolve(false);
      });
    });
    if (!okLocal) {
      this.stats.lastError = `本机服务 ${this.opts.localTarget.host}:${this.opts.localTarget.port} 连不上`;
      try {
        relaySock.destroy();
      } catch {
        /* ignore */
      }
      return;
    }
    local.on('error', () => {
      /* 本地服务断开 */
    });
    // **先挂 sink，再排空缓冲**：配对与"本地服务连上"之间到达的字节必须先缓存再按序补发，
    // 否则会出现"中继说转发成功、端点却一个字节没收到"的静默丢包（本仓库实测踩过）。
    this.localSink = local;
    const drain = this.sinkPending.splice(0);
    for (const b of drain) {
      this.stats.bytesFromRelay += b.length;
      local.write(b);
    }
    if (rest.length > 0) {
      this.stats.bytesFromRelay += rest.length;
      local.write(rest);
    }
    local.on('data', (c: Buffer) => {
      this.stats.bytesToRelay += c.length;
      this.recordSample(this.opts.token, 'listener->dialer', c);
      relaySock.write(c);
    });
    const shutdown = (): void => {
      this.localSink = null;
      try {
        local.destroy();
      } catch {
        /* ignore */
      }
      try {
        relaySock.destroy();
      } catch {
        /* ignore */
      }
    };
    local.once('close', shutdown);
    relaySock.once('close', shutdown);
  }

  stop(): Promise<void> {
    this.stopped = true;
    const ws = this.relayReadyWaiters.splice(0);
    for (const w of ws) {
      clearTimeout(w.timer);
      w.resolve(this.stats.paired);
    }
    return new Promise((resolve) => {
      try {
        this.relaySock?.destroy();
      } catch {
        /* ignore */
      }
      this.relaySock = null;
      resolve();
    });
  }

  private recordSample(token: string, direction: ZhongJiFangXiang, chunk: Buffer): void {
    if (this.sampleLog.length >= RELAY_MAX_SAMPLES) return;
    this.sampleLog.push({
      token,
      direction,
      bytes: chunk.length,
      firstBytesHex: chunk.subarray(0, this.opts.sampleBytes ?? DEFAULT_RELAY_SAMPLE_BYTES).toString('hex'),
      at: this.now(),
    });
  }
}

/* ────────────────────────────── 中继档的判定（阶梯用） ────────────────────────────── */

export type ZhongJiJueDingMa =
  /** 对端可拨入 → 直连即可，不需要中继 */
  | 'relay-not-needed-peer-dialable'
  /** 本机可拨入 → 对端能拨进来，不需要中继 */
  | 'relay-not-needed-inbound-expected'
  /** 两端都不可拨入，且真的连上了可用中继 → 选中继档 */
  | 'relay-selected'
  /** 两端都不可拨入，但没有任何中继候选 → **如实报缺口**（附八.3 第 2 条的状态） */
  | 'relay-none-configured'
  /** 配了中继候选但一个都连不上 → 如实报缺口 */
  | 'relay-unreachable'
  /** 对端可拨入性未知（未收到对端报告）→ 无法判定是否需中继 */
  | 'dialability-unknown';

export interface ZhongJiHouXuanYinYong {
  fingerprint?: string;
  nodeId?: string;
  /** 中继节点的地址（真实部署时 = 有公网地址的那台机器） */
  addr: DhtDiZhi;
}

export interface ZhongJiJueDing {
  /** 是否"需要中继才算出路"（两端都不可拨入 / 对端可拨入性未知） */
  needed: boolean;
  /** 是否真的选中并**验证到**可用中继 */
  selected: boolean;
  code: ZhongJiJueDingMa;
  reason: string;
  selfDialable?: boolean;
  peerDialable?: boolean;
  bothUndialable: boolean;
  /** 中继地址 */
  relay?: DhtDiZhi;
  /**
   * 两端共享的配对 token（两端各自确定性算出同一个值）。
   * **只有给了 `selfFingerprint` 才算得出来** —— 否则为 undefined 且 `tokenSymmetric=false`（诚实标注）。
   */
  token?: string;
  /** token 是否"两端对称"（= 双方各用自己+对方指纹都能算出同一个值） */
  tokenSymmetric: boolean;
  attempts: { addr: DhtDiZhi; ok: boolean; detail?: string; ms: number }[];
  /**
   * 是否需要向用户**明确告知**："你的网络两端都无法直连，需要一台有公网地址的机器做中继"。
   * 这正是附八.3 第 2 条要的状态（可检测 ⇒ 可明确表达 ⇒ 不必一直转圈）。
   */
  needsPublicRelayNotice: boolean;
}

export interface ZhongJiJueDingXuanXiang {
  /** 本机可拨入？（来自 DialabilityProbe；undefined = 未知） */
  selfDialable?: boolean;
  /** 对端可拨入？（对端报告的；undefined = 未知） */
  peerDialable?: boolean;
  /** **本机指纹**：配对 token 必须由"双方指纹 + 中继地址"推出，缺了它两端算不出同一个值 */
  selfFingerprint?: string;
  candidates: ZhongJiHouXuanYinYong[];
  dialTcp?: (host: string, port: number, timeoutMs: number) => Promise<{ ok: boolean; detail?: string }>;
  timeoutMs?: number;
  now?: () => number;
}

/**
 * 配对 token：**两端确定性算出同一个值**（无带外通道）。
 * 刻意不含时间因素：换窗口会导致"两端窗口不一致就配不上"；重放风险由端到端加密与单调计数兜住。
 */
export function quZhongJiLingPai(fingerprintA: string, fingerprintB: string, relay: DhtDiZhi): string {
  const pair = [fingerprintA, fingerprintB].sort().join('|');
  return sha256Hex(Buffer.from(`${RELAY_PROTOCOL}|token|${pair}|${relay.host}:${relay.port}`, 'utf8')).slice(0, 32);
}

async function defaultDial(host: string, port: number, timeoutMs: number): Promise<{ ok: boolean; detail?: string }> {
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
    sock.once('connect', () => done(true, '中继可达'));
    sock.on('error', (e: Error) => done(false, `中继连接失败：${e.message}`));
    sock.setTimeout(timeoutMs, () => done(false, `中继连接超时 ${timeoutMs}ms`));
  });
}

/**
 * 判定"要不要走中继、走得到吗"。**每条结论都带证据**（真实 TCP 连接结果）。
 *
 * 判定顺序（照着 ADR 附八.3 的三条定论来）：
 *  1. 对端可拨入 → 不需要中继（直连档应该已经命中）；
 *  2. 本机可拨入（对端不可拨入）→ 也不需要中继：对端能拨进来（C1 心跳方向服从连通性）；
 *  3. 两端都不可拨入 → **必须**有中继：逐个候选做真实 TCP 探测，命中即 `relay-selected`；
 *     一个都没有 → `relay-none-configured`；都连不上 → `relay-unreachable`（两者都 `needsPublicRelayNotice`）。
 *  4. 对端可拨入性未知 → 如实标 `dialability-unknown`（不猜）。
 */
export async function jueDingZhongJi(
  target: { fingerprint: string; nodeId?: string },
  opts: ZhongJiJueDingXuanXiang
): Promise<ZhongJiJueDing> {
  const now = opts.now ?? (() => Date.now());
  const timeoutMs = opts.timeoutMs ?? 2000;
  const dial = opts.dialTcp ?? defaultDial;
  const selfDialable = opts.selfDialable;
  const peerDialable = opts.peerDialable;
  const tokenSymmetric = typeof opts.selfFingerprint === 'string' && opts.selfFingerprint.length > 0;
  const bothUndialable = selfDialable === false && peerDialable === false;
  const base = {
    selfDialable,
    peerDialable,
    bothUndialable,
    tokenSymmetric,
    attempts: [] as ZhongJiJueDing['attempts'],
    needsPublicRelayNotice: false,
  };

  if (peerDialable === true) {
    return {
      ...base,
      needed: false,
      selected: false,
      code: 'relay-not-needed-peer-dialable',
      reason: '对端报告本机可拨入 → 走直连档即可，不需要中继',
    };
  }
  if (peerDialable === false && selfDialable === true) {
    return {
      ...base,
      needed: false,
      selected: false,
      code: 'relay-not-needed-inbound-expected',
      reason: '本机可拨入、对端不可拨入 → 等对端拨入本机（C1：心跳方向服从连通性），不需要中继',
    };
  }

  if (!bothUndialable) {
    return {
      ...base,
      needed: true,
      selected: false,
      code: 'dialability-unknown',
      reason:
        selfDialable === undefined || peerDialable === undefined
          ? `可拨入性未知（本机=${selfDialable === undefined ? '未知' : selfDialable ? '可拨入' : '不可拨入'} / 对端=${peerDialable === undefined ? '未收到对端报告' : peerDialable ? '可拨入' : '不可拨入'}）→ 无法判定是否必须中继（不猜）`
          : '未命中"两端都不可拨入"的中继条件',
    };
  }

  // 到这里：**两端都不可拨入** → 必须有中继，否则永久连不上（附八.3）
  const candidates = opts.candidates ?? [];
  if (candidates.length === 0) {
    return {
      ...base,
      needed: true,
      selected: false,
      code: 'relay-none-configured',
      reason:
        '两端都无法直连（本机与对端各自报告"不可拨入"），且本机没有任何中继候选 → 需要一台有公网地址的机器做中继',
      needsPublicRelayNotice: true,
    };
  }
  for (const c of candidates) {
    const startedAt = now();
    let r: { ok: boolean; detail?: string };
    try {
      r = await dial(c.addr.host, c.addr.port, timeoutMs);
    } catch (e) {
      r = { ok: false, detail: `探测异常：${(e as Error).message ?? String(e)}` };
    }
    base.attempts.push({ addr: c.addr, ok: r.ok, detail: r.detail, ms: now() - startedAt });
    if (r.ok) {
      return {
        ...base,
        needed: true,
        selected: true,
        code: 'relay-selected',
        relay: c.addr,
        // 两端各用「自己指纹 + 对方指纹 + 中继地址」算，因 relayTokenFor 内部排序 ⇒ 两端必得同一个值
        ...(tokenSymmetric ? { token: quZhongJiLingPai(opts.selfFingerprint as string, target.fingerprint, c.addr) } : {}),
        reason: `两端都不可拨入，已选中继 ${c.addr.host}:${c.addr.port}（经中继：更慢，但可用）`,
      };
    }
  }
  return {
    ...base,
    needed: true,
    selected: false,
    code: 'relay-unreachable',
    reason: `两端都无法直连，且 ${candidates.length} 个中继候选全部连不上 → 需要一台有公网地址且可达的机器做中继`,
    needsPublicRelayNotice: true,
  };
}

/** 给上层（阶梯/UI）用的可读结论码 → i18n key 建议（不拼文案，只给 key） */
export const RELAY_STATUS_I18N: Record<ZhongJiJueDingMa, string> = {
  'relay-not-needed-peer-dialable': 'net.relay.notNeeded.peerDialable',
  'relay-not-needed-inbound-expected': 'net.relay.notNeeded.inboundExpected',
  'relay-selected': 'net.relay.selected',
  'relay-none-configured': 'net.relay.missing.noneConfigured',
  'relay-unreachable': 'net.relay.missing.unreachable',
  'dialability-unknown': 'net.relay.unknown',
};
