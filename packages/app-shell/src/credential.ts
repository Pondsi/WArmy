/**
 * 凭证（Credential）= 身份的唯一私密凭据，也是本机「ID」。
 *
 * 产品设计（产品主定稿）：
 *  - **ID 就是唯一凭证，也就是私钥**；加好友 / 入群时给出去的是**由它派生的公钥**（指纹）。
 *  - 没有中心服务器也能做到：唯一性、互相识别、换机恢复 —— 全部来自非对称密钥本身：
 *      · 唯一性：私钥空间 2^256，撞号概率可忽略；
 *      · 识别：对方拿公钥/指纹即可验证你的签名（签名只有你手里的私钥做得出来）；
 *      · 恢复：只要有凭证字符串，就能在任意设备**重新派生出同一把密钥**、同一个指纹；
 *      · 关联：指纹是公钥的短标识，任何人可对照，不需要任何服务器背书。
 *
 * 位数（产品主问：55 位十进制换成"数字+字母、去掉 I/O/Z"是多少位）：
 *  - 55 位十进制 = 55 × log2(10) ≈ 182.7 bit
 *  - 字母表 = 0-9 + A-Z + a-z，去掉 I/O/Z（含小写）⇒ **56 个符号**，log2(56) ≈ 5.807 bit/符号
 *  - 182.7 / 5.807 ≈ 31.5 ⇒ **32 位**即可承载 55 位十进制的信息量
 *  - 本实现直接取 **256 bit（32 字节随机）** ⇒ 需要 ⌈256/5.807⌉ = **45 位**，
 *    再留一位冗余并按 5 位分组，最终 **45 位**（9 组 × 5）。这样与 Ed25519 的 32 字节种子等长，
 *    不需要额外 KDF 拉伸即可满分强度。
 */
import crypto from 'node:crypto';
import {
  ed25519FromSeed,
  ed25519SpkiDerFromRaw,
  ed25519PrivateKeyObject,
  ed25519PublicKeyObject,
} from '@warmy/sync-protocol';
import { privateKeyToDer } from './identity.js';

/** 59 个符号：数字 + 大小写字母，去掉易混的 I / O / Z */
/** 56 个符号：数字 + 大小写字母，**去掉易混的 I / O / Z（含小写）** */
export const CREDENTIAL_ALPHABET =
  '0123456789ABCDEFGHJKLMNPQRSTUVWXYabcdefghjklmnpqrstuvwxy';
export const CREDENTIAL_LENGTH = 45;
const SEP = '-';
const GROUP = 5;

/** 32 字节 → base59 定长字符串（高位补 0 到 45 位） */
export function encodeCredential(bytes: Buffer): string {
  const base = BigInt(CREDENTIAL_ALPHABET.length);
  let n = BigInt('0x' + bytes.toString('hex'));
  const out: string[] = [];
  while (n > 0n) {
    out.push(CREDENTIAL_ALPHABET[Number(n % base)] ?? (CREDENTIAL_ALPHABET[0] as string));
    n /= base;
  }
  while (out.length < CREDENTIAL_LENGTH) out.push(CREDENTIAL_ALPHABET[0] as string);
  return out.reverse().join('');
}

/** base59 定长字符串 → 32 字节（超出部分丢弃、不足补 0） */
export function decodeCredential(text: string): Buffer {
  const s = normalizeCredential(text);
  if (s.length !== CREDENTIAL_LENGTH) throw new Error(`credential: 需要 ${CREDENTIAL_LENGTH} 位，实际 ${s.length}`);
  const base = BigInt(CREDENTIAL_ALPHABET.length);
  let n = 0n;
  for (const ch of s) {
    const idx = CREDENTIAL_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error(`credential: 非法字符 ${ch}`);
    n = n * base + BigInt(idx);
  }
  const hex = n.toString(16).padStart(64, '0').slice(-64);
  return Buffer.from(hex, 'hex');
}

/** 去掉分隔符/空白；不改变大小写（大小写是信息的一部分） */
export function normalizeCredential(text: string): string {
  return String(text || '').replace(/[\s-]+/g, '');
}

export function isValidCredential(text: string): boolean {
  const s = normalizeCredential(text);
  return s.length === CREDENTIAL_LENGTH && [...s].every((c) => CREDENTIAL_ALPHABET.includes(c));
}

/** 45 位 → 9 组 × 5 位，便于人眼抄写与核对 */
export function formatCredential(text: string): string {
  const s = normalizeCredential(text);
  const parts: string[] = [];
  for (let i = 0; i < s.length; i += GROUP) parts.push(s.slice(i, i + GROUP));
  return parts.join(SEP);
}

/** 新凭证：256 bit 随机（等价于 Ed25519 的 32 字节种子强度） */
export function generateCredential(): string {
  return encodeCredential(crypto.randomBytes(32));
}

export interface DerivedKeyPair {
  publicKey: crypto.KeyObject;
  privateKey: crypto.KeyObject;
  publicKeyB64: string;
  privateKeyDer: Buffer;
}

/**
 * 凭证 ⇒ 身份密钥对（**确定性**：同一凭证在任何设备派生出同一把密钥）。
 *
 * 这里不再做 KDF 拉伸：凭证本身已经是 256 bit 随机（不是弱口令），
 * 直接当 Ed25519 种子即可；这样「凭证 = 私钥」在数学上是同一件事，
 * 也避免为找回身份而引入第二套秘密。
 */
export function keyPairFromCredential(credential: string): DerivedKeyPair {
  const seed = decodeCredential(credential);
  const raw = ed25519FromSeed(seed);
  const privateKey = ed25519PrivateKeyObject(raw.privateKey);
  return {
    publicKey: ed25519PublicKeyObject(raw.publicKey),
    privateKey,
    publicKeyB64: ed25519SpkiDerFromRaw(raw.publicKey).toString('base64'),
    privateKeyDer: privateKeyToDer(privateKey),
  };
}
