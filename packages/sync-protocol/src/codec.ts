/**
 * codec —— 零依赖的编码 / 摘要 / 曲线辅助
 *
 * 约束（ADR 000 不变量 #4 零原生模块）：只用 `node:crypto` 与 `Buffer`。
 * 所有 X25519 / Ed25519 密钥在协议里以 raw 32 字节（b64url 字符串）传输，
 * 这里用固定 DER 前缀在 raw ↔ KeyObject 之间转换，避免任何三方依赖。
 */
import crypto from 'node:crypto';

export type Bytes = Uint8Array | ArrayBuffer | Buffer;

/* ────────────────────────────── 字节 / 文本 ────────────────────────────── */

export function toBuf(v: Bytes | string): Buffer {
  if (typeof v === 'string') return Buffer.from(v, 'base64url');
  if (Buffer.isBuffer(v)) return Buffer.from(v);
  if (v instanceof Uint8Array) return Buffer.from(v);
  return Buffer.from(v as ArrayBuffer);
}

export function b64u(v: Bytes): string {
  return toBuf(v).toString('base64url');
}

export function fromB64u(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32（无填充、大写）—— 用于人类可读的指纹 */
export function base32(buf: Bytes): string {
  const b = toBuf(buf);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of b) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) out += B32.charAt((value << (5 - bits)) & 31);
  return out;
}

/** 无歧义的字段拼接（长度前缀），供签名 transcript 使用 */
export function joinFields(fields: ReadonlyArray<string | number | null | undefined>): string {
  return fields
    .map((f) => {
      const s = f === null || f === undefined ? '' : String(f);
      return `${Buffer.byteLength(s, 'utf8')}:${s}`;
    })
    .join('|');
}

/* ────────────────────────────── 摘要 / HMAC / KDF ────────────────────────────── */

export function sha256(...parts: Bytes[]): Buffer {
  const h = crypto.createHash('sha256');
  for (const p of parts) h.update(toBuf(p));
  return h.digest();
}

export function sha256Hex(...parts: Bytes[]): string {
  return sha256(...parts).toString('hex');
}

export function hmacSha256(key: Bytes, ...parts: Bytes[]): Buffer {
  const h = crypto.createHmac('sha256', toBuf(key));
  for (const p of parts) h.update(toBuf(p));
  return h.digest();
}

/** HKDF-SHA256（Node 内置实现） */
export function hkdf(ikm: Bytes, salt: Bytes, info: string, length: number): Buffer {
  return Buffer.from(crypto.hkdfSync('sha256', toBuf(ikm), toBuf(salt), Buffer.from(info, 'utf8'), length));
}

export function randomBytes(n: number): Buffer {
  return crypto.randomBytes(n);
}

export function randomHex(n: number): string {
  return crypto.randomBytes(n).toString('hex');
}

export function randomB64u(n: number): string {
  return crypto.randomBytes(n).toString('base64url');
}

export function timingSafeEq(a: Bytes, b: Bytes): boolean {
  const ba = toBuf(a);
  const bb = toBuf(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/* ────────────────────────────── 曲线 ────────────────────────────── */

const ED25519_SPKI = Buffer.from('302a300506032b6570032100', 'hex');
const ED25519_PKCS8 = Buffer.from('302e020100300506032b657004220420', 'hex');
const X25519_SPKI = Buffer.from('302a300506032b656e032100', 'hex');
const X25519_PKCS8 = Buffer.from('302e020100300506032b656e04220420', 'hex');

export const ED25519_PUBLIC_KEY_LENGTH = 32;
export const X25519_PUBLIC_KEY_LENGTH = 32;
/** Ed25519 SPKI DER 的固定前缀（44 字节 = 12 前缀 + 32 raw） */
export const ED25519_SPKI_PREFIX = Buffer.from(ED25519_SPKI);
export const ED25519_SPKI_DER_LENGTH = 44;

/** raw 32B → SPKI DER（44B） */
export function ed25519SpkiDerFromRaw(raw: Bytes): Buffer {
  const r = toBuf(raw);
  if (r.length !== ED25519_PUBLIC_KEY_LENGTH) throw new Error(`ed25519SpkiDerFromRaw: 需要 32 字节 raw，实际 ${r.length}`);
  return Buffer.concat([ED25519_SPKI_PREFIX, r]);
}

/** SPKI DER（44B）→ raw 32B；不是合法 Ed25519 SPKI 时返回 null */
export function ed25519RawFromSpkiDer(der: Bytes): Buffer | null {
  const d = toBuf(der);
  if (d.length !== ED25519_SPKI_DER_LENGTH) return null;
  if (!d.subarray(0, 12).equals(ED25519_SPKI_PREFIX)) return null;
  return d.subarray(12);
}

/** 任意常见表示 → raw 32B Ed25519 公钥（接受 raw / SPKI DER） */
export function normalizeEd25519PublicKey(key: Bytes | string): Buffer {
  const b = toBuf(key);
  if (b.length === ED25519_PUBLIC_KEY_LENGTH) return b;
  const raw = ed25519RawFromSpkiDer(b);
  if (raw) return raw;
  throw new Error(`不是合法的 Ed25519 公钥：长度 ${b.length}（支持 32 字节 raw 或 44 字节 SPKI DER）`);
}

export function ed25519PublicKeyObject(raw: Bytes): crypto.KeyObject {
  return crypto.createPublicKey({ key: Buffer.concat([ED25519_SPKI, toBuf(raw)]), format: 'der', type: 'spki' });
}

export function ed25519PrivateKeyObject(raw: Bytes): crypto.KeyObject {
  return crypto.createPrivateKey({ key: Buffer.concat([ED25519_PKCS8, toBuf(raw)]), format: 'der', type: 'pkcs8' });
}

export function x25519PublicKeyObject(raw: Bytes): crypto.KeyObject {
  return crypto.createPublicKey({ key: Buffer.concat([X25519_SPKI, toBuf(raw)]), format: 'der', type: 'spki' });
}

export function x25519PrivateKeyObject(raw: Bytes): crypto.KeyObject {
  return crypto.createPrivateKey({ key: Buffer.concat([X25519_PKCS8, toBuf(raw)]), format: 'der', type: 'pkcs8' });
}

export function rawPublicKey(key: crypto.KeyObject): Buffer {
  return key.export({ format: 'der', type: 'spki' }).subarray(12);
}

export function rawPrivateKey(key: crypto.KeyObject): Buffer {
  return key.export({ format: 'der', type: 'pkcs8' }).subarray(16);
}

/** 本地 Ed25519 验签（raw 公钥）。密钥不是 32 字节时返回 null 表示"本地无法判定" */
export function verifyEd25519Local(message: Bytes, signature: Bytes, publicKeyRaw: Bytes): boolean | null {
  const pub = toBuf(publicKeyRaw);
  if (pub.length !== ED25519_PUBLIC_KEY_LENGTH) return null;
  try {
    return crypto.verify(null, toBuf(message), ed25519PublicKeyObject(pub), toBuf(signature));
  } catch {
    return null;
  }
}

/** 本地 Ed25519 签名（raw 私钥）—— 仅供测试 / 身份层的实现参考 */
export function signEd25519Local(message: Bytes, privateKeyRaw: Bytes): Buffer {
  return crypto.sign(null, toBuf(message), ed25519PrivateKeyObject(privateKeyRaw));
}

export function generateEd25519(): { publicKey: Buffer; privateKey: Buffer } {
  const kp = crypto.generateKeyPairSync('ed25519');
  return { publicKey: rawPublicKey(kp.publicKey), privateKey: rawPrivateKey(kp.privateKey) };
}

/**
 * 由 32 字节种子（Ed25519 seed）派生密钥对。
 * 用途：从群组密钥派生**假名签名密钥**（DHT 记录用），使公共 DHT 上看不到真实身份指纹。
 */
export function ed25519FromSeed(seed: Bytes): { publicKey: Buffer; privateKey: Buffer } {
  const s = toBuf(seed);
  if (s.length !== 32) throw new Error(`ed25519FromSeed: seed 必须 32 字节，实际 ${s.length}`);
  const priv = ed25519PrivateKeyObject(s);
  // 用 JWK 导出拿到公钥分量（x），避免 createPublicKey(KeyObject) 的类型/重载差异
  const jwk = priv.export({ format: 'jwk' }) as { x?: string };
  if (typeof jwk.x !== 'string' || jwk.x.length === 0) {
    throw new Error('ed25519FromSeed: 无法从私钥导出公钥（JWK 缺少 x）');
  }
  return { publicKey: Buffer.from(jwk.x, 'base64url'), privateKey: s };
}

export interface X25519KeyPair {
  publicKey: Buffer;
  privateKey: Buffer;
}

export function generateX25519(): X25519KeyPair {
  const kp = crypto.generateKeyPairSync('x25519');
  return { publicKey: rawPublicKey(kp.publicKey), privateKey: rawPrivateKey(kp.privateKey) };
}

/** X25519 ECDHE：共享密钥（32 字节） */
export function x25519SharedSecret(privateKeyRaw: Bytes, peerPublicKeyRaw: Bytes): Buffer {
  const peer = toBuf(peerPublicKeyRaw);
  if (peer.length !== X25519_PUBLIC_KEY_LENGTH) throw new Error(`x25519: bad peer public key length ${peer.length}`);
  return crypto.diffieHellman({
    privateKey: x25519PrivateKeyObject(privateKeyRaw),
    publicKey: x25519PublicKeyObject(peer),
  });
}

/* ────────────────────────────── AES-256-GCM ────────────────────────────── */

export const GCM_IV_LENGTH = 12;
export const GCM_TAG_LENGTH = 16;

export interface Sealed {
  iv: Buffer;
  ct: Buffer; // 密文 + tag
}

export function seal(key: Bytes, plaintext: Bytes, aad: Bytes): Sealed {
  const iv = crypto.randomBytes(GCM_IV_LENGTH);
  return { iv, ct: sealWithIv(key, plaintext, aad, iv) };
}

/**
 * 指定 IV 加密（IV 由调用方按计数器派生时使用）。
 * 返回密文+tag；调用方必须保证「同一密钥下 IV 永不重复」。
 */
export function sealWithIv(key: Bytes, plaintext: Bytes, aad: Bytes, iv: Bytes): Buffer {
  const c = crypto.createCipheriv('aes-256-gcm', toBuf(key), toBuf(iv));
  c.setAAD(toBuf(aad));
  return Buffer.concat([c.update(toBuf(plaintext)), c.final(), c.getAuthTag()]);
}

/** 解密失败（无密钥 / 被篡改 / AAD 不符）一律抛错，绝不返回半成品 */
export function open(key: Bytes, sealed: Sealed, aad: Bytes): Buffer {
  const k = toBuf(key);
  const ct = toBuf(sealed.ct);
  if (ct.length < GCM_TAG_LENGTH) throw new Error('aes-gcm: ciphertext too short');
  const tag = ct.subarray(ct.length - GCM_TAG_LENGTH);
  const body = ct.subarray(0, ct.length - GCM_TAG_LENGTH);
  const d = crypto.createDecipheriv('aes-256-gcm', k, toBuf(sealed.iv));
  d.setAAD(toBuf(aad));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]);
}

/* ────────────────────────────── 8 字节大端计数 ────────────────────────────── */

export function u64be(n: bigint | number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(n));
  return b;
}

export function readU64BE(b: Bytes, offset = 0): bigint {
  return toBuf(b).readBigUInt64BE(offset);
}

export function u32be(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
}

/** 大端长度前缀的分帧读取器（TCP 粘包用） */
export class FrameDecoder {
  private buf: Buffer = Buffer.alloc(0);

  constructor(private maxFrame = 16 * 1024 * 1024) {}

  push(chunk: Bytes): Buffer[] {
    this.buf = this.buf.length === 0 ? toBuf(chunk) : Buffer.concat([this.buf, toBuf(chunk)]);
    const out: Buffer[] = [];
    for (;;) {
      if (this.buf.length < 4) break;
      const len = this.buf.readUInt32BE(0);
      if (len > this.maxFrame) throw new Error(`frame too large: ${len}`);
      if (this.buf.length < 4 + len) break;
      out.push(this.buf.subarray(4, 4 + len));
      this.buf = this.buf.subarray(4 + len);
    }
    return out;
  }
}

export function frame(payload: Bytes): Buffer {
  const p = toBuf(payload);
  return Buffer.concat([u32be(p.length), p]);
}
