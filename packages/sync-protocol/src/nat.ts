/**
 * nat —— NAT-PMP（RFC 6886）与 STUN（RFC 8489）客户端 + 同时打洞
 *
 * ADR 003 附八.9 的连接阶梯里，`upnp` 与 `holepunch` 两档此前只有**占位**
 * （"未实现 + 原因"）。本模块把它们变成真的：报文编码/解码、UDP 往返、
 * 以及"两边同时往外打"的协调状态机，全部只用 Node 内置模块（零 npm 依赖）。
 *
 * **诚实边界**（这一条比代码本身更重要）：
 *  - STUN/NAT-PMP 的**协议实现**可以离线验证（门禁里跑本地 mock 服务器）；
 *  - **是否真的穿过 NAT** 取决于路由器与 NAT 类型，本机单环境永远证明不了
 *    跨 NAT 成功 ⇒ 阶梯里这些档位失败时如实报 `failed`/`skipped` + 原因，
 *    绝不把"发了包"说成"打通了"。
 *  - **隐私默认**：不内置任何公网 STUN 服务器。要向外发 Binding Request
 *    必须由用户在设置里显式填服务器地址（填了就等于把本机公网出口告诉对方）。
 *  - **映射默认不自动做**：UPnP/NAT-PMP 的"往路由器要一个端口映射"是**改变路由器
 *    状态**的动作，只能由用户显式触发（与 `warmy:wangLuoNatNengLi` 的 map/unmap 一致）；
 *    阶梯的 `upnp` 档只做"目标已宣告了映射地址 ⇒ 去拨它"，不擅自申请映射。
 */
import crypto from 'node:crypto';
import dgram from 'node:dgram';
import dns from 'node:dns';
import net from 'node:net';
import os from 'node:os';
import { promisify } from 'node:util';
import { guiFanZhuJiZiMian, guiLeiIpv6ZuoYongYu, jieXiIpv4ZiJie, quZhuJiIpJiazu, type TiziCelue } from './ladder.js';
import { guiLeiDiZhi } from './dialability.js';

const lookup = promisify(dns.lookup);

// ══════════════════════════════════════════════════════════════
// 1. STUN（RFC 8489）Binding Request / Response
// ══════════════════════════════════════════════════════════════

export const STUN_MAGIC_COOKIE = 0x2112a442;
export const STUN_DEFAULT_PORT = 3478;

/** 只做 Binding（发现公网映射地址），其余方法一律不假装支持 */
export const STUN_TYPE_BINDING_REQUEST = 0x0001;
export const STUN_TYPE_BINDING_SUCCESS = 0x0101;
export const STUN_TYPE_BINDING_ERROR = 0x0111;

const STUN_ATTR_NAMES: Record<number, string> = {
  0x0001: 'MAPPED-ADDRESS',
  0x0006: 'USERNAME',
  0x0008: 'MESSAGE-INTEGRITY',
  0x0009: 'ERROR-CODE',
  0x000a: 'UNKNOWN-ATTRIBUTES',
  0x0013: 'SOFTWARE',
  0x0014: 'REALM',
  0x0015: 'NONCE',
  0x0020: 'XOR-MAPPED-ADDRESS',
  0x0021: 'XOR-MAPPED-ADDRESS (IPv6)',
  0x8020: 'XOR-MAPPED-ADDRESS (IPv6, 旧草案)',
  0x8028: 'FINGERPRINT',
};

export interface IpDuan {
  host: string;
  port: number;
}

export interface StunShuxing {
  type: number;
  name: string;
  value: Buffer;
  /** SOFTWARE / ERROR-CODE 这类可读属性顺手解出来 */
  text?: string;
}

export interface StunBao {
  type: number;
  /** 0=请求 1=指示 2=成功响应 3=错误响应 */
  leiBie: number;
  fangFa: number;
  xieYi: boolean;
  transactionId: string;
  attrs: StunShuxing[];
  mapped?: IpDuan;
  software?: string;
  errorCode?: { code: number; class: number; reason: string };
}

/** 属性按 4 字节对齐补齐（RFC 明确要求，不补对端会当坏包丢） */
function buQi(n: number): number {
  const r = n % 4;
  return r === 0 ? n : n + (4 - r);
}

function bianMaShuxing(type: number, value: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt16BE(type, 0);
  head.writeUInt16BE(value.length, 2);
  const pad = buQi(value.length) - value.length;
  return pad > 0 ? Buffer.concat([head, value, Buffer.alloc(pad)]) : Buffer.concat([head, value]);
}

function jieXiIpv6Nian(host: string): Uint8Array | null {
  if (quZhuJiIpJiazu(host) !== 6) return null;
  const parts: string[] = [];
  const [head, tail] = host.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  if (host.includes('::')) {
    const need = 8 - h.length - t.length;
    if (need < 0) return null;
    for (const p of h) parts.push(p);
    for (let i = 0; i < need; i++) parts.push('0');
    for (const p of t) parts.push(p);
  } else parts.push(...host.split(':'));
  if (parts.length !== 8) return null;
  const out = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const n = parseInt(parts[i] ?? '0', 16);
    if (!Number.isFinite(n)) return null;
    out[i * 2] = (n >> 8) & 0xff;
    out[i * 2 + 1] = n & 0xff;
  }
  return out;
}

/**
 * 编码 XOR-MAPPED-ADDRESS（RFC 8489 §14.1）：端口异或 cookie 高 16 位、
 * 地址异或 cookie（IPv6 再异或交易 ID）。客户端一般用不到，
 * 但"把某台牛马当反射地址报告者"和离线门禁的 mock 服务器都要它。
 */
function bianMaXorYingShe(v: IpDuan, cookie: number, tid: Buffer): Buffer {
  const v4 = jieXiIpv4ZiJie(v.host);
  if (v4) {
    const out = Buffer.alloc(8);
    out[0] = 0;
    out[1] = 1;
    out.writeUInt16BE((v.port ^ (cookie >> 16)) & 0xffff, 2);
    // 位运算结果是**有符号** int32（最高位为 1 时变负数），必须先 `>>> 0` 再写
    out.writeUInt32BE((((v4[0]! << 24) | (v4[1]! << 16) | (v4[2]! << 8) | v4[3]!) ^ cookie) >>> 0, 4);
    return out;
  }
  const x = jieXiIpv6Nian(v.host);
  if (!x || tid.length !== 12) return Buffer.alloc(0);
  const pre = Buffer.alloc(16);
  pre.writeUInt32BE(cookie >>> 0, 0);
  tid.copy(pre, 4, 0, 12);
  const out = Buffer.alloc(20);
  out[0] = 0;
  out[1] = 2;
  out.writeUInt16BE((v.port ^ (cookie >> 16)) & 0xffff, 2);
  for (let i = 0; i < 16; i++) out[4 + i] = (x[i] ?? 0) ^ (pre[i] ?? 0);
  return out;
}

/**
 * 编码 STUN 响应（Binding Success/Error + XOR-MAPPED-ADDRESS）。
 * 用途：① 离线门禁当 mock 服务器；② 组网里由一台可达节点替对端报告"我看到的你的地址"。
 */
export function bianMaStunXiangYing(o: {
  transactionId: Buffer;
  mapped?: IpDuan;
  type?: number;
  software?: string;
  errorCode?: { code: number; reason: string };
}): Buffer {
  const tid = o.transactionId && o.transactionId.length === 12 ? o.transactionId : crypto.randomBytes(12);
  const attrs: Buffer[] = [];
  if (o.mapped) {
    const enc = bianMaXorYingShe(o.mapped, STUN_MAGIC_COOKIE, tid);
    if (enc.length) attrs.push(bianMaShuxing(o.mapped.host.includes(':') ? 0x0021 : 0x0020, enc));
  }
  if (o.software) attrs.push(bianMaShuxing(0x0013, Buffer.from(String(o.software).slice(0, 64), 'utf8')));
  if (o.errorCode) {
    const reason = Buffer.from(String(o.errorCode.reason).slice(0, 128), 'utf8');
    const v = Buffer.alloc(4 + reason.length);
    v[2] = Math.floor(Math.max(400, Math.min(699, o.errorCode.code)) / 100);
    v[3] = o.errorCode.code % 100;
    reason.copy(v, 4);
    attrs.push(bianMaShuxing(0x0009, v));
  }
  const body = Buffer.concat(attrs);
  const head = Buffer.alloc(20);
  head.writeUInt16BE(Number(o.type ?? STUN_TYPE_BINDING_SUCCESS) & 0x3fff, 0);
  head.writeUInt16BE(body.length, 2);
  head.writeUInt32BE(STUN_MAGIC_COOKIE, 4);
  tid.copy(head, 8, 0, 12);
  return Buffer.concat([head, body]);
}

function jieMaXorYingShe(value: Buffer, cookie: number, tid: Buffer): IpDuan | undefined {
  if (value.length < 8) return undefined;
  const family = value[1] ?? 0;
  const port = (value.readUInt16BE(2) ^ (cookie >> 16)) & 0xffff;
  if (family === 1) {
    if (value.length < 8) return undefined;
    const raw = value.readUInt32BE(4) ^ cookie;
    const b = Buffer.alloc(4);
    b.writeUInt32BE(raw >>> 0, 0);
    return { host: `${b[0]}.${b[1]}.${b[2]}.${b[3]}`, port };
  }
  if (family === 2 && value.length >= 20 && tid.length === 12) {
    const pre = Buffer.alloc(16);
    pre.writeUInt32BE(cookie >>> 0, 0);
    tid.copy(pre, 4, 0, 12);
    const out = Buffer.alloc(16);
    // 地址从 value 的第 4 字节开始（0=保留、1=地址族、2-3=异或端口）
    for (let i = 0; i < 16; i++) out[i] = (value[4 + i] ?? 0) ^ (pre[i] ?? 0);
    const segs: string[] = [];
    for (let i = 0; i < 8; i++) segs.push(out.readUInt16BE(i * 2).toString(16));
    return { host: segs.join(':'), port };
  }
  return undefined;
}

function jieMaYingShe(value: Buffer): IpDuan | undefined {
  if (value.length < 8) return undefined;
  const family = value[1] ?? 0;
  const port = value.readUInt16BE(2);
  if (family === 1) return { host: `${value[4]}.${value[5]}.${value[6]}.${value[7]}`, port };
  return undefined;
}

/**
 * 编码 Binding Request。`software` 只是标识，不含任何本机路径/身份。
 * 交易 ID 12 字节全随机（RFC 要求前 4 字节留给 cookie，后面必须不可预测）。
 */
export function bianMaStunQingQiu(o: { transactionId?: Buffer; software?: string } = {}): { buf: Buffer; transactionId: Buffer } {
  const tid = o.transactionId && o.transactionId.length === 12 ? o.transactionId : crypto.randomBytes(12);
  const attrs: Buffer[] = [];
  if (o.software) attrs.push(bianMaShuxing(0x0013, Buffer.from(String(o.software).slice(0, 64), 'utf8')));
  const body = Buffer.concat(attrs);
  const head = Buffer.alloc(20);
  head.writeUInt16BE(STUN_TYPE_BINDING_REQUEST, 0);
  head.writeUInt16BE(body.length, 2);
  head.writeUInt32BE(STUN_MAGIC_COOKIE, 4);
  tid.copy(head, 8, 0, 12);
  return { buf: Buffer.concat([head, body]), transactionId: tid };
}

/** 解 STUN 报文；不是 STUN（前 2 位非 0 / 长度不符 / 头部不全）就返回 null，不抛错 */
export function jieMaStunBao(buf: Buffer): StunBao | null {
  if (!buf || buf.length < 20) return null;
  const type = buf.readUInt16BE(0);
  if ((type & 0xc000) !== 0) return null;
  const len = buf.readUInt16BE(2);
  if (len % 4 !== 0 || 20 + len > buf.length) return null;
  const cookie = buf.readUInt32BE(4);
  const tid = buf.subarray(8, 20);
  const attrs: StunShuxing[] = [];
  let mapped: IpDuan | undefined;
  let software: string | undefined;
  let errorCode: { code: number; class: number; reason: string } | undefined;
  let p = 20;
  const end = 20 + len;
  while (p + 4 <= end) {
    const at = buf.readUInt16BE(p);
    const al = buf.readUInt16BE(p + 2);
    const vStart = p + 4;
    const vEnd = vStart + al;
    if (vEnd > buf.length) break;
    const value = buf.subarray(vStart, vEnd);
    const shu: StunShuxing = { type: at, name: STUN_ATTR_NAMES[at] ?? `0x${at.toString(16)}`, value };
    if (at === 0x0020 || at === 0x0021 || at === 0x8020) {
      const m = jieMaXorYingShe(value, cookie, tid);
      if (m) {
        mapped = m;
        shu.text = `${m.host}:${m.port}`;
      }
    } else if (at === 0x0001) {
      const m = jieMaYingShe(value);
      if (m) {
        mapped = m;
        shu.text = `${m.host}:${m.port}`;
      }
    } else if (at === 0x0013) {
      software = value.toString('utf8');
      shu.text = software;
    } else if (at === 0x0009 && al >= 4) {
      const cls = (value[2] ?? 0) & 0x07;
      const num = ((value[2] ?? 0) & 0xff) * 100 + (value[3] ?? 0);
      errorCode = { code: num, class: cls, reason: value.subarray(4).toString('utf8') };
      shu.text = `${num} ${value.subarray(4).toString('utf8')}`;
    }
    attrs.push(shu);
    p = vStart + buQi(al);
  }
  // RFC 5389 §6：C0=bit4、C1=bit8；M0-3=bit0-3、M4-6=bit5-7、M7-12=bit9-14
  const leiBie = (((type >> 8) & 1) << 1) | ((type >> 4) & 1);
  const fangFa = (type & 0x000f) | (((type >> 5) & 0x0007) << 4) | (((type >> 9) & 0x003f) << 7);
  return {
    type,
    leiBie,
    fangFa,
    xieYi: cookie === STUN_MAGIC_COOKIE,
    transactionId: tid.toString('hex'),
    attrs,
    ...(mapped ? { mapped } : {}),
    ...(software ? { software } : {}),
    ...(errorCode ? { errorCode } : {}),
  };
}

export interface StunDongJieXuanXiang {
  /** 服务器清单（host 或 IP）；**为空就不发包**（隐私默认，不内置公网服务器） */
  servers: Array<string | IpDuan>;
  timeoutMs?: number;
  software?: string;
  /** 绑定本机端口（做锥形 NAT 测试时两端要用同一端口） */
  localPort?: number;
  family?: 4 | 6;
  /** mock 服务器：注入自己的往返实现，便于离线门禁验证状态机 */
  send?: (pkt: Buffer, addr: IpDuan, timeoutMs: number) => Promise<Buffer | null>;
}

export interface StunJieguo {
  ok: boolean;
  /** 本机对公网可见的地址（STUN 服务器看到的来源地址） */
  publicAddress?: IpDuan;
  via?: string;
  transactionId?: string;
  reason: 'no-server' | 'resolved' | 'timeout' | 'bad-response' | 'error' | 'network' | 'no-mapped';
  detail?: string;
  attempts: Array<{ server: string; ok: boolean; reason: string; ms: number }>;
  ms: number;
}

function guiFanFuWuQi(s: string | IpDuan): IpDuan | null {
  if (typeof s === 'string') {
    const t = s.replace(/^stuns?:\/\//, '').replace(/^stun:/, '').split('?')[0] ?? '';
    const [h, p] = t.split(':');
    if (!h) return null;
    const port = Number(p) || STUN_DEFAULT_PORT;
    return { host: h, port };
  }
  if (s && typeof s.host === 'string' && s.host) return { host: s.host, port: Number(s.port) || STUN_DEFAULT_PORT };
  return null;
}

async function jiHeDanCeng(s: string | IpDuan): Promise<IpDuan | null> {
  const g = guiFanFuWuQi(s);
  if (!g) return null;
  if (jieXiIpv4ZiJie(g.host) || quZhuJiIpJiazu(g.host) === 6) return g;
  try {
    const r = await lookup(g.host, { all: false });
    return r?.address ? { host: r.address, port: g.port } : null;
  } catch {
    return null;
  }
}

/** 真实 UDP 往返：发一个 Binding Request，等交易 ID 对得上的响应 */
async function stunUdpWangFan(pkt: Buffer, tid: Buffer, addr: IpDuan, timeoutMs: number, localPort?: number, family = 4): Promise<Buffer | null> {
  const sock = dgram.createSocket(family === 6 ? 'udp6' : 'udp4');
  return await new Promise((resolve) => {
    let done = false;
    const finish = (v: Buffer | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { sock.close(); } catch { /* noop */ }
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), Math.max(50, timeoutMs));
    sock.on('message', (msg) => {
      if (msg.length < 20) return;
      if (msg.readUInt16BE(0) !== STUN_TYPE_BINDING_SUCCESS && msg.readUInt16BE(0) !== STUN_TYPE_BINDING_ERROR) return;
      if (!msg.subarray(8, 20).equals(tid)) return; // 别人的包，不理
      finish(msg);
    });
    sock.on('error', () => finish(null));
    const send = () => {
      try {
        sock.send(pkt, addr.port, addr.host, (e) => { if (e) finish(null); });
      } catch { finish(null); }
    };
    if (localPort) try { sock.bind(localPort, family === 6 ? '::' : '0.0.0.0'); sock.once('listening', send); return; } catch { finish(null); return; }
    send();
  });
}

/**
 * 用 STUN 问自己的公网映射地址（Binding Request → XOR-MAPPED-ADDRESS）。
 * 逐个服务器试到成功为止；失败**如实带原因**，不编造地址。
 */
export async function dongJieXuanZhiByStun(opts: StunDongJieXuanXiang): Promise<StunJieguo> {
  const t0 = Date.now();
  const timeoutMs = Math.max(100, Number(opts.timeoutMs) || 1500);
  const attempts: StunJieguo['attempts'] = [];
  const list = (opts.servers || []).map((s) => ({ raw: s, label: typeof s === 'string' ? s : `${s.host}:${s.port}` }));
  if (!list.length) {
    return { ok: false, reason: 'no-server', detail: '未配置 STUN 服务器（隐私默认不内置公网服务器）', attempts, ms: 0 };
  }
  const { buf, transactionId } = bianMaStunQingQiu({ software: opts.software ?? 'WArmy/1' });
  for (const item of list) {
    const ta = Date.now();
    const addr = await jiHeDanCeng(item.raw);
    if (!addr) {
      attempts.push({ server: item.label, ok: false, reason: 'resolved', ms: Date.now() - ta });
      continue;
    }
    try {
      const resp = opts.send
        ? await opts.send(buf, addr, timeoutMs)
        : await stunUdpWangFan(buf, transactionId, addr, timeoutMs, opts.localPort, opts.family);
      if (!resp) {
        attempts.push({ server: item.label, ok: false, reason: 'timeout', ms: Date.now() - ta });
        continue;
      }
      const bao = jieMaStunBao(resp);
      if (!bao) {
        attempts.push({ server: item.label, ok: false, reason: 'bad-response', ms: Date.now() - ta });
        continue;
      }
      if (bao.leiBie === 3) {
        attempts.push({ server: item.label, ok: false, reason: `error:${bao.errorCode?.code ?? '?'}`, ms: Date.now() - ta });
        continue;
      }
      if (!bao.mapped) {
        attempts.push({ server: item.label, ok: false, reason: 'no-mapped', ms: Date.now() - ta });
        continue;
      }
      attempts.push({ server: item.label, ok: true, reason: 'ok', ms: Date.now() - ta });
      return {
        ok: true,
        publicAddress: bao.mapped,
        via: item.label,
        transactionId: transactionId.toString('hex'),
        reason: 'resolved',
        detail: `XOR-MAPPED-ADDRESS=${bao.mapped.host}:${bao.mapped.port}`,
        attempts,
        ms: Date.now() - t0,
      };
    } catch (e) {
      attempts.push({ server: item.label, ok: false, reason: 'network', ms: Date.now() - ta });
      void e;
    }
  }
  const last = attempts[attempts.length - 1];
  return { ok: false, reason: (last?.reason as StunJieguo['reason']) ?? 'timeout', attempts, ms: Date.now() - t0 };
}

// ══════════════════════════════════════════════════════════════
// 2. NAT-PMP（RFC 6886）
// ══════════════════════════════════════════════════════════════

export const NATPMP_PORT = 5351;
/** 结果码（RFC 6886 §3.5）：不翻译成文案，交给界面按 key 取词 */
export const NATPMP_RESULT_TEXT: Record<number, string> = {
  0: 'ok',
  1: 'unsupported-version',
  2: 'unauthorized',
  3: 'not-a-gateway',
  4: 'external-only-support',
  5: 'gateway-unavailable',
  6: 'no-memory-resources',
  7: 'no-port-resources',
};

export interface NatPmpQingQiu {
  version: number;
  opcode: number;
  internalPort: number;
  externalPort: number;
  leaseSec: number;
}

/**
 * 编码映射请求（16 字节）。
 * `explicit` ⇒ opcode 2/3（坚持要这个外部端口）；否则 0/1（端口由路由器挑）。
 */
export function bianMaNatPmpYingSheQingQiu(o: {
  protocol: 'tcp' | 'udp';
  internalPort: number;
  externalPort?: number;
  leaseSec?: number;
  explicit?: boolean;
  version?: number;
}): Buffer {
  const internal = Math.max(0, Math.min(65535, Math.trunc(Number(o.internalPort) || 0)));
  const external = Math.max(0, Math.min(65535, Math.trunc(Number(o.externalPort ?? 0) || 0)));
  const lease = Math.max(0, Math.min(0xffffffff, Math.trunc(Number(o.leaseSec ?? 7200) || 0)));
  const buf = Buffer.alloc(16);
  buf[0] = Number(o.version ?? 0) & 0xff;
  buf[1] = o.protocol === 'tcp' ? (o.explicit ? 3 : 1) : o.explicit ? 2 : 0;
  if (o.explicit) buf.writeUInt16BE(external, 2);
  buf.writeUInt16BE(internal, 4);
  buf.writeUInt16BE(external, 8);
  buf.writeUInt32BE(lease, 12);
  return buf;
}

export interface NatPmpXiangYing {
  version: number;
  opcodeResponse: number;
  protocol: 'tcp' | 'udp';
  result: number;
  resultText: string;
  epoch: number;
  internalPort: number;
  externalPort: number;
  lifetime: number;
}

/** 解映射响应（16 字节）；长度/版本不对返回 null（不抛错） */
export function jieMaNatPmpXiangYing(buf: Buffer): NatPmpXiangYing | null {
  if (!buf || buf.length < 16) return null;
  const opcode = buf[1] ?? 0;
  if (opcode < 128 || opcode > 131) return null;
  const result = buf.readUInt16BE(2);
  return {
    version: buf[0] ?? 0,
    opcodeResponse: opcode,
    protocol: opcode === 129 || opcode === 131 ? 'tcp' : 'udp',
    result,
    resultText: NATPMP_RESULT_TEXT[result] ?? `result-${result}`,
    epoch: buf.readUInt32BE(4),
    internalPort: buf.readUInt16BE(8),
    externalPort: buf.readUInt16BE(10),
    lifetime: buf.readUInt32BE(12),
  };
}

/** 网关编码失败响应（opcode 128）：RFC 6886 §3.5 只带结果码，不带端口/租期 */
export function jieMaNatPmpShibai(buf: Buffer): { version: number; result: number; resultText: string } | null {
  if (!buf || buf.length < 4) return null;
  if (buf[1] !== 128) return null;
  const result = buf.readUInt16BE(2);
  return { version: buf[0] ?? 0, result, resultText: NATPMP_RESULT_TEXT[result] ?? `result-${result}` };
}

/** 只允许向**私有/链路本地**地址发映射请求：把公网 IP 当网关发请求既没用也不安全 */
export function shiFouWangGuanHouXuan(host: string): boolean {
  const lei = guiLeiDiZhi(host);
  return lei === 'private' || lei === 'link-local';
}

/**
 * 从本机网卡启发式猜默认网关（`x.y.z.1` / `x.y.z.254`）。
 * 真值应以路由表为准 —— 所以主进程会先读 `Get-NetRoute`，读不到才退到这里，
 * 并且猜出来的网关必须被 NAT-PMP 响应确认才算数。
 */
export function caiJiMenjinHouXuan(nics: ReturnType<typeof os.networkInterfaces> = os.networkInterfaces()): string[] {
  const out: string[] = [];
  for (const list of Object.values(nics || {})) {
    for (const it of list ?? []) {
      if (it.family !== 'IPv4' || !it.address || !shiFouWangGuanHouXuan(it.address)) continue;
      const seg = it.address.split('.');
      const base = `${seg[0]}.${seg[1]}.${seg[2]}.`;
      for (const tail of ['1', '254']) {
        const g = base + tail;
        if (g !== it.address && !out.includes(g)) out.push(g);
      }
    }
  }
  return out;
}

export interface NatpmpXuanXiang {
  /** 候选网关；为空时自动从网卡启发式取 */
  gateways?: string[];
  protocol?: 'tcp' | 'udp';
  internalPort: number;
  externalPort?: number;
  leaseSec?: number;
  explicit?: boolean;
  port?: number;
  timeoutMs?: number;
  /** 注入往返（离线门禁跑 mock 网关用） */
  request?: (pkt: Buffer, gateway: string, port: number, timeoutMs: number) => Promise<Buffer | null>;
}

export interface NatpmpJieguo {
  ok: boolean;
  gateway?: string;
  publicAddress?: IpDuan;
  response?: NatPmpXiangYing;
  reason: 'no-gateway' | 'bad-gateway' | 'timeout' | 'router-refused' | 'router-ok';
  detail?: string;
  attempts: Array<{ gateway: string; ok: boolean; reason: string }>;
  ms: number;
}

async function natpmpUdpWangFan(pkt: Buffer, gateway: string, port: number, timeoutMs: number): Promise<Buffer | null> {
  const sock = dgram.createSocket('udp4');
  return await new Promise((resolve) => {
    let done = false;
    const finish = (v: Buffer | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { sock.close(); } catch { /* noop */ }
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), Math.max(100, timeoutMs));
    sock.on('message', (m) => finish(m));
    sock.on('error', () => finish(null));
    try { sock.send(pkt, port, gateway, (e) => { if (e) finish(null); }); } catch { finish(null); }
  });
}

/** 向路由器要一个 NAT-PMP 端口映射（会**改变路由器状态**，只能显式调用） */
export async function natpmpYingShe(o: NatpmpXuanXiang): Promise<NatpmpJieguo> {
  const t0 = Date.now();
  const timeoutMs = Math.max(100, Number(o.timeoutMs) || 1500);
  const port = Number(o.port) || NATPMP_PORT;
  const protocol = o.protocol === 'tcp' ? 'tcp' : 'udp';
  const attempts: NatpmpJieguo['attempts'] = [];
  let gws = (o.gateways ?? []).filter((g) => !!g);
  if (!gws.length) gws = caiJiMenjinHouXuan();
  if (!gws.length) return { ok: false, reason: 'no-gateway', detail: '本机没有可用的私有网关候选', attempts, ms: 0 };
  const pkt = bianMaNatPmpYingSheQingQiu({
    protocol,
    internalPort: o.internalPort,
    externalPort: o.externalPort,
    leaseSec: o.leaseSec,
    explicit: o.explicit,
  });
  for (const gw of gws) {
    if (!shiFouWangGuanHouXuan(gw)) {
      attempts.push({ gateway: gw, ok: false, reason: 'bad-gateway' });
      continue;
    }
    const resp = o.request ? await o.request(pkt, gw, port, timeoutMs) : await natpmpUdpWangFan(pkt, gw, port, timeoutMs);
    if (!resp) {
      attempts.push({ gateway: gw, ok: false, reason: 'timeout' });
      continue;
    }
    const jie = jieMaNatPmpXiangYing(resp);
    if (!jie) {
      const shi = jieMaNatPmpShibai(resp);
      attempts.push({ gateway: gw, ok: false, reason: shi ? shi.resultText : 'bad-response' });
      continue;
    }
    if (jie.result !== 0) {
      attempts.push({ gateway: gw, ok: false, reason: jie.resultText });
      return { ok: false, gateway: gw, response: jie, reason: 'router-refused', detail: jie.resultText, attempts, ms: Date.now() - t0 };
    }
    attempts.push({ gateway: gw, ok: true, reason: 'router-ok' });
    return {
      ok: true,
      gateway: gw,
      publicAddress: { host: gw, port: jie.externalPort },
      response: jie,
      reason: 'router-ok',
      detail: `内部 ${jie.internalPort} → 外部 ${jie.externalPort}，租期 ${jie.lifetime}s（NAT-PMP 只告诉端口，公网 IP 需另问 STUN）`,
      attempts,
      ms: Date.now() - t0,
    };
  }
  const last = attempts[attempts.length - 1];
  return { ok: false, reason: last?.reason === 'timeout' ? 'timeout' : 'no-gateway', attempts, ms: Date.now() - t0 };
}

/**
 * NAT-PMP **只读**探针：发一个 version=1（本协议只认 0）的请求。
 * RFC 6886 §3.5 要求路由器必须回 `UNSUPPORTED_VERSION(1)` ⇒
 * 收到任何响应就证明"这台路由器听得懂 NAT-PMP"，而**不会创建任何映射**。
 * （直接发 version=0 的映射请求会改路由器状态，那只能由用户显式触发。）
 */
export function bianMaNatPmpTanZhen(): Buffer {
  const buf = Buffer.alloc(16);
  buf[0] = 1; // 故意用不支持的版本
  buf[1] = 0;
  return buf;
}

export interface NatpmpZaiXianXuanXiang {
  gateways?: string[];
  port?: number;
  timeoutMs?: number;
  request?: (pkt: Buffer, gateway: string, port: number, timeoutMs: number) => Promise<Buffer | null>;
}

export interface NatpmpZaiXianJieguo {
  alive: boolean;
  gateway?: string;
  detail: string;
  attempts: Array<{ gateway: string; ok: boolean; reason: string }>;
  ms: number;
}

/** 探测默认网关是否支持 NAT-PMP（只读，不建映射） */
export async function natpmpMenjinZaiXian(o: NatpmpZaiXianXuanXiang = {}): Promise<NatpmpZaiXianJieguo> {
  const t0 = Date.now();
  const timeoutMs = Math.max(100, Number(o.timeoutMs) || 1000);
  const port = Number(o.port) || NATPMP_PORT;
  const attempts: NatpmpZaiXianJieguo['attempts'] = [];
  let gws = (o.gateways ?? []).filter((g) => !!g);
  if (!gws.length) gws = caiJiMenjinHouXuan();
  if (!gws.length) return { alive: false, detail: '本机没有私有网关候选（可能直通公网或没联网）', attempts, ms: 0 };
  const pkt = bianMaNatPmpTanZhen();
  for (const gw of gws) {
    if (!shiFouWangGuanHouXuan(gw)) {
      attempts.push({ gateway: gw, ok: false, reason: 'bad-gateway' });
      continue;
    }
    const resp = o.request ? await o.request(pkt, gw, port, timeoutMs) : await natpmpUdpWangFan(pkt, gw, port, timeoutMs);
    if (!resp) {
      attempts.push({ gateway: gw, ok: false, reason: 'timeout' });
      continue;
    }
    const wan = jieMaNatPmpXiangYing(resp);
    const bai = jieMaNatPmpShibai(resp);
    const jieGuoText = wan ? wan.resultText : bai ? bai.resultText : 'responded';
    attempts.push({ gateway: gw, ok: true, reason: jieGuoText });
    return { alive: true, gateway: gw, detail: `网关 ${gw} 应答 NAT-PMP（${jieGuoText}，端口 ${port}）`, attempts, ms: Date.now() - t0 };
  }
  return { alive: false, detail: `${gws.length} 个网关候选都没应答 5351/UDP（路由器不支持或被挡）`, attempts, ms: Date.now() - t0 };
}

/**
 * 撤销 NAT-PMP 映射：RFC 6886 没有"删除"操作码，**同一内部端口把租期写成 0** 即为删除。
 * 所以取消也必须由用户显式触发（同样是改路由器状态）。
 */
export async function natpmpQuXiao(o: Omit<NatpmpXuanXiang, 'leaseSec' | 'externalPort'>): Promise<NatpmpJieguo> {
  return await natpmpYingShe({ ...o, externalPort: 0, leaseSec: 0, explicit: false });
}

// ══════════════════════════════════════════════════════════════
// 3. 同时打洞（两端各自往外发，NAT 才放行进来的包）
// ══════════════════════════════════════════════════════════════

export const DA_DONG_MAGIC = 'WARMY-PUNCH/1';

/**
 * 打洞令牌：两端各自算出的同一个值（谁先谁后无所谓 ⇒ 排序后哈希）。
 * 用它认"对端真在打"，陌生人的包不会造成假命中。
 */
export function quDaDongLingPai(fingerprintA: string, fingerprintB: string): string {
  const p = [String(fingerprintA || ''), String(fingerprintB || '')].sort();
  return crypto.createHash('sha256').update(`WARMY-PUNCH/1|${p[0]}|${p[1]}`).digest('hex').slice(0, 16);
}

export function daDongBao(lingpai: string): Buffer {
  return Buffer.from(`${DA_DONG_MAGIC} ${String(lingpai).slice(0, 16)}`, 'utf8');
}

/** 解析打洞包；令牌必须逐字符相等（防时序旁路用 timingSafeEqual） */
export function shiFouDaDongBao(msg: Buffer, lingpai: string): boolean {
  const s = msg.toString('utf8');
  if (!s.startsWith(DA_DONG_MAGIC)) return false;
  const got = s.slice(DA_DONG_MAGIC.length + 1).trim().slice(0, 16);
  const want = String(lingpai).slice(0, 16);
  if (got.length !== want.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
  } catch {
    return false;
  }
}

export interface DaDongXuanXiang {
  lingpai: string;
  candidates: IpDuan[];
  /** 本机端口：锥形 NAT 下"同一端口进出"才有效，默认让内核挑 */
  localPort?: number;
  durationMs?: number;
  intervalMs?: number;
  family?: 4 | 6;
  /** 收到对端打洞包时回调（`from` 是 NAT 实际放行的地址） */
  onHit?: (from: IpDuan, ms: number) => void;
  /** 打完是否回一包（被叫方要回，否则主叫方永远收不到 ⇒ 认定 NAT 已开） */
  reply?: boolean;
}

export interface DaDongJieguo {
  ok: boolean;
  hits: IpDuan[];
  sent: number;
  ms: number;
  detail: string;
}

/**
 * 同时打洞：向每个候选端点周期发包，直到收到同令牌的回来。
 * **这只证明 UDP 路径被打开了**，会话仍需 TCP 拨号成功才算"连上"（阶梯里会接着拨）。
 */
export async function tongShiDaDong(o: DaDongXuanXiang): Promise<DaDongJieguo> {
  const t0 = Date.now();
  const durationMs = Math.max(100, Number(o.durationMs) || 1500);
  const intervalMs = Math.max(50, Number(o.intervalMs) || 250);
  const list = (o.candidates || []).filter((c) => c && c.host && c.port > 0);
  if (!list.length || !o.lingpai) {
    return { ok: false, hits: [], sent: 0, ms: 0, detail: '没有候选地址或令牌（未发包）' };
  }
  const sock = dgram.createSocket(o.family === 6 ? 'udp6' : 'udp4');
  const pkt = daDongBao(o.lingpai);
  const hits: IpDuan[] = [];
  let sent = 0;
  let closed = false;
  let tick: ReturnType<typeof setInterval> | null = null;
  let deadline: ReturnType<typeof setTimeout> | null = null;
  const close = () => {
    if (closed) return;
    closed = true;
    if (tick) clearInterval(tick);
    if (deadline) clearTimeout(deadline);
    try { sock.close(); } catch { /* noop */ }
  };
  await new Promise<void>((res) => {
    if (!o.localPort) return res();
    let settled = false;
    const done = () => { if (!settled) { settled = true; res(); } };
    sock.once('listening', done);
    sock.once('error', done);
    try { sock.bind(o.localPort); } catch { done(); }
    setTimeout(done, 300).unref?.();
  });
  sock.on('message', (msg, rinfo) => {
    if (!shiFouDaDongBao(msg, o.lingpai)) return;
    const from = { host: rinfo.address, port: rinfo.port };
    if (!hits.some((h) => h.host === from.host && h.port === from.port)) {
      hits.push(from);
      try { o.onHit?.(from, Date.now() - t0); } catch { /* 回调异常不影响打洞 */ }
    }
    if (o.reply !== false) {
      try { sock.send(pkt, rinfo.port, rinfo.address, () => {}); } catch { /* noop */ }
    }
  });
  sock.on('error', close);
  const faSong = () => {
    for (const c of list) {
      try { sock.send(pkt, c.port, c.host, () => {}); sent++; } catch { /* 单点失败不影响其它候选 */ }
    }
  };
  // 命中就提前结束；否则到 durationMs 为止（这段时间就是"同时"的窗口）
  await new Promise<void>((res) => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; close(); res(); } };
    tick = setInterval(() => {
      if (hits.length) return done();
      faSong();
    }, intervalMs);
    deadline = setTimeout(done, durationMs);
    tick.unref?.();
    deadline.unref?.();
    faSong();
    if (hits.length) done();
  });
  return {
    ok: hits.length > 0,
    hits,
    sent,
    ms: Date.now() - t0,
    detail: hits.length
      ? `UDP 双向命中 ${hits.map((h) => `${h.host}:${h.port}`).join(', ')}（共发 ${sent} 包）`
      : `${durationMs}ms 内向 ${list.length} 个候选发了 ${sent} 包，没有对端回来（对称 NAT / 对端没在打 / 未放行）`,
  };
}

/** 打洞之后真正拨 TCP：只有拨通才算"连上"，别把"发过包"当成连接 */
export async function boDaDongHouTcp(addr: IpDuan, timeoutMs: number): Promise<{ ok: boolean; detail: string }> {
  if (!addr?.host || !addr.port) return { ok: false, detail: '地址不合法' };
  const sock = net.connect({ host: addr.host, port: addr.port });
  return await new Promise((resolve) => {
    let done = false;
    const finish = (v: { ok: boolean; detail: string }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.removeAllListeners();
      sock.destroy();
      resolve(v);
    };
    const timer = setTimeout(() => finish({ ok: false, detail: `TCP 拨号超时（${timeoutMs}ms）` }), Math.max(50, timeoutMs));
    sock.once('connect', () => finish({ ok: true, detail: `TCP 已连通 ${addr.host}:${addr.port}` }));
    sock.once('timeout', () => finish({ ok: false, detail: 'TCP 连接超时' }));
    sock.once('error', (e) => finish({ ok: false, detail: `TCP 失败 ${(e as Error).message}`.slice(0, 120) }));
  });
}

/** 给阶梯/界面用的纯 IPv6 地址收敛（复用 ladder 的判定，避免两处漂移） */
export function shiFouKeBoDuanKou(host: string): boolean {
  const h = guiFanZhuJiZiMian(host);
  if (!h) return false;
  if (jieXiIpv4ZiJie(h)) return true;
  return quZhuJiIpJiazu(h) === 6 && (guiLeiIpv6ZuoYongYu(h) === 'global' || guiLeiIpv6ZuoYongYu(h) === 'ula');
}

// ══════════════════════════════════════════════════════════════
// 4. 阶梯档位：把上面的客户端接进 `upnp` / `holepunch` 两级
// ══════════════════════════════════════════════════════════════

export interface NatDangweiXuanxiang {
  /** 本机指纹（打洞令牌由两端指纹共同推出） */
  selfFingerprint?: () => string | undefined;
  /** 本机 UDP 打洞用的端口（锥形 NAT 下与业务端口一致最好） */
  selfUdpPort?: () => number;
  /** 已生效的端口映射（**只能由用户在设置里显式触发后回填**；阶梯本身不申请） */
  mapped?: () => { internalPort: number; externalPort: number; publicHost?: string; mechanism: 'upnp' | 'natpmp' } | undefined;
  /** STUN 服务器；空 = 不做反射地址发现（隐私默认） */
  stunServers?: () => Array<string | IpDuan>;
  /** 网关候选（默认从本机网卡启发式取） */
  gateways?: () => string[] | Promise<string[]>;
  /** 打洞窗口时长 */
  punchMs?: number;
  stunTimeoutMs?: number;
}

/**
 * `upnp` 档：**用对端已映射到路由器的公网地址**去拨。
 *
 * 本档**不会自己去改路由器**：申请端口映射是改变共享网络状态的动作，
 * 只有用户在设置里点了「映射端口」才会有 `nat.mapped()`；那种情况下本机是
 * "可被回拨"的一方，如实标 `outbound-only` 而不是谎称这一档拨通了。
 */
export function chuangJianUpnpYingCelue(nat: NatDangweiXuanxiang = {}): TiziCelue {
  return {
    rung: 'upnp',
    supported: true,
    async attempt(ctx) {
      /**
       * 不要求"字面看起来是公网"：对端宣告的映射地址可能是内网/回环（同一 LAN、
       * 或它虚报）。**照样拨一次**，但把地址性质写进 detail —— 判据来自实测，不来自字面猜测。
       */
      const houXuan = (ctx.target.mappedAddresses ?? []).filter((a) => a && a.host && a.port > 0);
      const feiGongKai = houXuan.filter((a) => guiLeiDiZhi(a.host) !== 'public').map((a) => `${a.host}:${a.port}`);
      const benJi = nat.mapped?.();
      const benJiShuo = benJi
        ? `本机映射：内部 ${benJi.internalPort} → 外部 ${benJi.externalPort}（${benJi.mechanism === 'natpmp' ? 'NAT-PMP' : 'UPnP'}）`
        : '本机未申请端口映射（改路由器状态需用户在设置里显式触发）';
      const xingZhiShuo = feiGongKai.length ? `；注意这些地址不是公网段：${feiGongKai.join(', ')}` : '';
      if (!houXuan.length) {
        return {
          ok: false,
          skip: true,
          code: 'upnp-no-peer-mapping',
          detail: `对端没有宣告路由器映射地址；${benJiShuo}`,
        };
      }
      const cuo: string[] = [];
      for (const a of houXuan) {
        const r = await ctx.dialTcp(a.host, a.port, ctx.timeoutMs);
        if (r.ok) return { ok: true, address: { host: a.host, port: a.port }, detail: `经映射地址拨通 ${a.host}:${a.port}；${benJiShuo}${xingZhiShuo}` };
        cuo.push(`${a.host}:${a.port} ${r.detail ?? '失败'}`);
      }
      return { ok: false, code: 'upnp-dial-failed', detail: `映射地址 ${houXuan.length} 个都拨不通：${cuo.join(' / ')}；${benJiShuo}${xingZhiShuo}` };
    },
  };
}

/**
 * `holepunch` 档：STUN 问到自己公网端点（可选）→ 两端同时打 UDP → 打完立刻拨 TCP。
 * **只有 TCP 拨通才算这一档成功**；"发出过打洞包"永远不等于打通。
 */
export async function chuangJianDaDongCelueAsync(nat: NatDangweiXuanxiang = {}): Promise<TiziCelue> {
  return chuangJianDaDongCelue(nat);
}

export function chuangJianDaDongCelue(nat: NatDangweiXuanxiang = {}): TiziCelue {
  return {
    rung: 'holepunch',
    supported: true,
    async attempt(ctx) {
      const zhiWen = String(ctx.target.zhiWen || '');
      const benJiZhiWen = String(nat.selfFingerprint?.() ?? '');
      if (!zhiWen || !benJiZhiWen) {
        return { ok: false, skip: true, code: 'punch-no-fingerprint', detail: '缺少两端指纹，打洞令牌无从推出（不猜）' };
      }
      const houXuan: IpDuan[] = (ctx.target.addresses ?? [])
        .map((a) => ({ host: guiFanZhuJiZiMian(a.host), port: a.port }))
        .filter((a) => a.host && a.port > 0);
      if (!houXuan.length) return { ok: false, skip: true, code: 'punch-no-candidate', detail: '没有可打的候选端点（地址表为空）' };

      const parts: string[] = [];
      const servers = (nat.stunServers?.() ?? []).filter(Boolean);
      if (servers.length) {
        const stun = await dongJieXuanZhiByStun({ servers, timeoutMs: nat.stunTimeoutMs ?? 1200, localPort: nat.selfUdpPort?.() });
        parts.push(stun.ok ? `STUN 反射地址 ${stun.publicAddress?.host}:${stun.publicAddress?.port}` : `STUN 未取得地址（${stun.reason}）`);
      } else {
        parts.push('未配置 STUN 服务器 ⇒ 不做反射地址发现');
      }

      const lingpai = quDaDongLingPai(benJiZhiWen, zhiWen);
      const chongTu = new Set<string>();
      const daiXuan = [...houXuan, ...(ctx.target.mappedAddresses ?? [])].filter((a) => {
        const k = `${a.host}:${a.port}`;
        if (chongTu.has(k)) return false;
        chongTu.add(k);
        return true;
      });
      const punchMs = Math.max(200, Math.min(Number(nat.punchMs) || 1200, ctx.timeoutMs * 2));
      const daXian: IpDuan[] = [];
      const punchPromise = tongShiDaDong({
        lingpai,
        candidates: daiXuan,
        localPort: nat.selfUdpPort?.(),
        durationMs: punchMs,
        onHit: (f) => daXian.push(f),
      });
      // 打洞的同时就开始拨（NAT 放行是逐包发生的，等完窗口再拨反而错过）
      const boXian: Array<{ addr: IpDuan; ok: boolean; detail?: string }> = [];
      for (const a of daiXuan) {
        const r = await ctx.dialTcp(a.host, a.port, Math.max(120, Math.floor(ctx.timeoutMs / 2)));
        boXian.push({ addr: a, ok: r.ok, ...(r.detail ? { detail: r.detail } : {}) });
        if (r.ok) {
          void punchPromise;
          return {
            ok: true,
            address: { host: a.host, port: a.port },
            code: 'punch-then-dial',
            detail: `${parts.join('；')}；打洞窗口内 TCP 拨通 ${a.host}:${a.port}`,
          };
        }
      }
      const jieguo = await punchPromise;
      if (daXian.length) {
        for (const a of daXian) {
          const r = await ctx.dialTcp(a.host, a.port, Math.max(120, Math.floor(ctx.timeoutMs / 2)));
          if (r.ok) {
            return { ok: true, address: { host: a.host, port: a.port }, code: 'punch-hit-dial', detail: `${parts.join('；')}；${jieguo.detail} ⇒ 回拨 TCP 成功` };
          }
        }
        return {
          ok: false,
          code: 'punch-udp-only',
          detail: `${parts.join('；')}；${jieguo.detail}，但 TCP 仍拨不通（对称 NAT / 对端 TCP 未监听）——不算打通`,
        };
      }
      return { ok: false, code: 'punch-no-hit', detail: `${parts.join('；')}；${jieguo.detail}` };
    },
  };
}
