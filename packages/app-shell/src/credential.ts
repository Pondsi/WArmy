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
 *  - **字母一律大写**（产品主明确要求：不要小写字母）—— 抄写/朗读/电话报号时不会因为
 *    大小写产生歧义，也不用担心某个输入法把大小写改掉。
 *
 * 位数（产品主问：55 位十进制换成"数字+字母、去掉 I/O/Z"是多少位）：
 *  - 55 位十进制 = 55 × log2(10) ≈ 182.7 bit
 *  - 字母表 = 0-9 + A-Z，**去掉 I / O / Z** ⇒ **33 个符号**，log2(33) ≈ 5.044 bit/符号
 *      · 只求"装下 55 位十进制"：⌈182.7 / 5.044⌉ = **37 位**
 *      · 但密码学上不该按这个量级设计：128 bit ⇒ 26 位；**256 bit（Ed25519 种子）⇒ 51 位**
 *  - 本实现取 **256 bit = 51 位**（分组显示为 17 组 × 3），不额外做 KDF：
 *    "凭证 = 私钥"在数学上就是同一件事。
 *
 * 为什么不用那些"看起来更短"的方案（如实记录取舍）：
 *  - 32/37 位（≈162–187 bit）够"装下 55 位十进制"，但**不够当密钥种子**：攻击者只要
 *    在可接受时间内枚举 2^162 就能反推出私钥；256 bit 是业界标准（Ed25519 种子长度）。
 *  - 去 I/O/Z 是为了避开"1/l/I、0/O、2/Z"这类**人眼抄错**；代价是每符号少 0.76 bit。
 */
import crypto from 'node:crypto';
import {
  ed25519FromSeed,
  ed25519SpkiDerFromRaw,
  ed25519PrivateKeyObject,
  ed25519PublicKeyObject,
} from '@warmy/sync-protocol';
import { privateKeyToDer } from './identity.js';

/**
 * **33 个符号：数字 + 大写字母，去掉易混的 I / O / Z**（无小写）。
 * 顺序固定，编码/解码都以此表为准。
 */
export const PINGZHENG_ZIFUBIAO = '0123456789ABCDEFGHJKLMNPQRSTUVWXY';

/** 现行长度：256 bit / 5.044 bit ≈ 50.75 ⇒ 51 位（17 组 × 3） */
export const PINGZHENG_CHANGDU = 51;

/**
 * 上一版的字母表与长度（56 符号、45 位、含小写）。
 * 只做**读取兼容**：已经发出去的凭证不能被判无效（那等于把人锁在自己机器外）。
 * 新生成的凭证一律用现行格式。
 */
export const YICHAN_PINGZHENG_ZIFUBIAO = '0123456789ABCDEFGHJKLMNPQRSTUVWXYabcdefghjklmnpqrstuvwxy';
export const YICHAN_PINGZHENG_CHANGDU = 45;

const FENFU = '-';
const qun = 3;

/** 认得出这是哪一版凭证（现行 51 位 / 上一版 45 位） */
export function pingzhengLeixing(text: string): 'current' | 'legacy' | null {
  const s = guiFanHuaPingZheng(text);
  if (s.length === PINGZHENG_CHANGDU && [...s].every((c) => PINGZHENG_ZIFUBIAO.includes(c))) return 'current';
  if (s.length === YICHAN_PINGZHENG_CHANGDU && [...s].every((c) => YICHAN_PINGZHENG_ZIFUBIAO.includes(c))) return 'legacy';
  return null;
}

/** 32 字节 → 定长凭证字符串（按字母表进制转换，高位补 0） */
export function bianMaYong(bytes: Buffer, alphabet: string, length: number): string {
  const base = BigInt(alphabet.length);
  let n = BigInt('0x' + bytes.toString('hex'));
  const out: string[] = [];
  while (n > 0n) {
    out.push(alphabet[Number(n % base)] ?? alphabet[0]!);
    n /= base;
  }
  while (out.length < length) out.push(alphabet[0]!);
  // 超出长度（理论上不会：32 字节 < base^length）时只保留低位，保持定长
  return out.slice(0, length).reverse().join('');
}

/** 定长凭证字符串 → 32 字节（不足补 0，超出取低 256 bit） */
export function jieMaYong(text: string, alphabet: string, length: number): Buffer {
  const s = guiFanHuaPingZheng(text);
  if (s.length !== length) throw new Error(`credential: 需要 ${length} 位，实际 ${s.length}`);
  const base = BigInt(alphabet.length);
  let n = 0n;
  for (const ch of s) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) throw new Error(`credential: 非法字符 ${ch}`);
    n = n * base + BigInt(idx);
  }
  const shiLiuJin = n.toString(16).padStart(64, '0').slice(-64);
  return Buffer.from(shiLiuJin, 'hex');
}

/** 现行格式：32 字节 → 51 位大写凭证 */
export function bianmaPingzheng(bytes: Buffer): string {
  return bianMaYong(bytes, PINGZHENG_ZIFUBIAO, PINGZHENG_CHANGDU);
}

/** 现行格式 → 32 字节 */
export function jiemaPingzheng(text: string): Buffer {
  return jieMaYong(text, PINGZHENG_ZIFUBIAO, PINGZHENG_CHANGDU);
}

/** 去掉分隔符/空白（不再需要处理大小写：现在只有大写一种形式） */
export function guiFanHuaPingZheng(text: string): string {
  return String(text || '').replace(/[\s-]+/g, '');
}

export function isValidCredential(text: string): boolean {
  return pingzhengLeixing(text) !== null;
}

/** 51 位 → 17 组 × 3 位（便于人眼抄写与核对） */
export function formatCredential(text: string): string {
  const s = guiFanHuaPingZheng(text);
  const parts: string[] = [];
  for (let i = 0; i < s.length; i += qun) parts.push(s.slice(i, i + qun));
  return parts.join(FENFU);
}

/**
 * 新凭证：**256 bit 均匀随机**（等价于 Ed25519 的 32 字节种子强度）。
 *
 * 关于"攻击者不断索取新 ID":  我们不是"发号"的一方（没有中心服务器），
 * 任何人本地生成的都是他自己那把私钥；**猜中别人那把**需要枚举 2^256，
 * 与"生成了多少个 ID"无关 —— 撞号概率 ~ n²/2^257，n = 10^12 时约 10^-53。
 */
export function shengchengPingzheng(): string {
  return bianmaPingzheng(crypto.randomBytes(32));
}

export interface TuiDaoMiyaoDui {
  publicKey: crypto.KeyObject;
  privateKey: crypto.KeyObject;
  publicKeyB64: string;
  privateKeyDer: Buffer;
}

/**
 * 凭证 ⇒ 身份密钥对（**确定性**：同一凭证在任何设备派生出同一把密钥）。
 *
 * 这里不做 KDF 拉伸：凭证本身已经是 256 bit 随机（不是弱口令），
 * 直接当 Ed25519 种子即可；这样「凭证 = 私钥」在数学上是同一件事，
 * 也避免为找回身份而引入第二套秘密。
 */
export function youPingZhengQuMiyaoDui(credential: string): TuiDaoMiyaoDui {
  const kind = pingzhengLeixing(credential);
  if (!kind) throw new Error('credential: 形态不认识（既不是 51 位大写凭证，也不是上一版 45 位）');
  const seed = kind === 'current'
    ? jiemaPingzheng(credential)
    : jieMaYong(credential, YICHAN_PINGZHENG_ZIFUBIAO, YICHAN_PINGZHENG_CHANGDU);
  const raw = ed25519FromSeed(seed);
  const privateKey = ed25519PrivateKeyObject(raw.privateKey);
  return {
    publicKey: ed25519PublicKeyObject(raw.publicKey),
    privateKey,
    publicKeyB64: ed25519SpkiDerFromRaw(raw.publicKey).toString('base64'),
    privateKeyDer: privateKeyToDer(privateKey),
  };
}
