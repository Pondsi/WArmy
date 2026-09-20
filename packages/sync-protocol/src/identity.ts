/**
 * identity —— 身份层「注入接口」（本包不实现身份层）
 *
 * 身份层（Ed25519 密钥 + 指纹 + safeStorage + 代次 generation）由另一条线实现，
 * 本包只接受一个四字段接口注入：
 *
 * ```ts
 * { fingerprint, publicKey, sign, verify }
 * ```
 *
 * 硬契约（握手安全性依赖它，不满足会直接抛错）：
 *  1. `publicKey` 是 Ed25519 公钥，**两种表示都接受**：
 *     · 32 字节 raw（Buffer / Uint8Array / b64url 字符串）—— 本包内部使用的形式；
 *     · 44 字节 SPKI DER（base64/b64url 字符串或 Buffer）—— 现有身份线
 *       `app-shell/src/identity.ts` 的线上形式；内部会自动剥前缀取 raw。
 *  2. `fingerprint` 必须能**由公钥推出**：默认实现
 *     `warmyFingerprint()` = base32(sha256(raw 32B))；
 *     若身份层用别的方案（例如现身份线的「sha256(SPKI DER base64) → base32 前 20 位 + 1 位校验 +
 *     短横分组」），通过 `fingerprintDerivation` 注入即可 —— 关键点是**指纹由公钥推出**，
 *     这样"换了公钥但沿用旧指纹"必然失败。适配示例（写在 app-shell 侧）：
 *
 *     ```ts
 *     import { ed25519SpkiDerFromRaw } from '@warmy/sync-protocol';
 *     import { fingerprintFromPublicKey } from './identity.js';
 *     const provider = {
 *       fingerprint: record.fingerprint,
 *       publicKey: record.publicKeyB64,                        // SPKI DER base64
 *       sign: (m) => signEd25519(m, privateKey),               // 返回 raw 签名
 *       verify: (m, sig, pub) => verifyEd25519(m, sig, pub),
 *     };
 *     // 传给握手/发现层的选项：
 *     const fingerprintDerivation = (raw32: Buffer) =>
 *       fingerprintFromPublicKey(ed25519SpkiDerFromRaw(raw32).toString('base64'));
 *     ```
 *  3. `sign(message)` 对任意字节串产生签名；`verify(message, sig, pubkey)` 校验任意公钥的签名
 *     （pubkey 也按上面的两种表示之一传入）。
 *
 * 本模块不做私钥存储、不做身份文件、不做 generation —— 那些属于身份层。
 */
import {
  type Bytes,
  base32,
  b64u,
  shengChengEd25519,
  normalizeEd25519PublicKey,
  sha256,
  signEd25519Local,
  toBuf,
  verifyEd25519Local,
} from './codec.js';

/** 身份提供方（身份层注入） */
export interface IdentityProvider {
  readonly fingerprint: string;
  readonly publicKey: Bytes | string;
  sign(message: Uint8Array): Bytes | string | Promise<Bytes | string>;
  verify(message: Uint8Array, signature: Bytes | string, publicKey: Bytes | string): boolean | Promise<boolean>;
}

/** 指纹推导函数：公钥 → 指纹 */
export type ZhiWenTuiDao = (publicKey: Buffer) => string;

/** 默认指纹：base32(sha256(公钥))，52 字符 */
export function warmyFingerprint(publicKey: Bytes): string {
  return base32(sha256(publicKey));
}

export class IdentityContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdentityContractError';
  }
}

/** 归一化后的身份：签名 / 验签一律走注入实现，公钥与指纹已被校验 */
export interface NormalizedIdentity {
  /** 显式标记，避免"鸭子类型"把裸 provider 误当成已校验身份（校验会被跳过） */
  readonly normalizedIdentity: true;
  fingerprint: string;
  publicKey: Buffer;
  sign(message: Bytes): Promise<Buffer>;
  verify(message: Bytes, signature: Bytes, publicKey: Bytes): Promise<boolean>;
  /** 是否启用"本地 Ed25519 复核"（默认 true，见 verifyPeerSignature） */
  enforceLocalEd25519: boolean;
  /** 是否强制同时通过注入的 verify（默认 false） */
  requireInjectedVerify: boolean;
  /** 注入实现是否通过自检（sign→verify 往返） */
  selfTested: boolean;
}

export interface NormalizeIdentityOptions {
  fingerprintDerivation?: ZhiWenTuiDao;
  enforceLocalEd25519?: boolean;
  requireInjectedVerify?: boolean;
  /** 做一次 sign→verify 往返自检（默认 false；wiring 时可开启） */
  selfTest?: boolean;
}

export function isNormalizedIdentity(v: unknown): v is NormalizedIdentity {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as NormalizedIdentity).normalizedIdentity === true &&
    typeof (v as NormalizedIdentity).sign === 'function' &&
    typeof (v as NormalizedIdentity).verify === 'function' &&
    Buffer.isBuffer((v as NormalizedIdentity).publicKey)
  );
}

export async function normalizeIdentity(
  provider: IdentityProvider | NormalizedIdentity,
  opts: NormalizeIdentityOptions = {}
): Promise<NormalizedIdentity> {
  if (isNormalizedIdentity(provider)) return provider;
  const derivation = opts.fingerprintDerivation ?? warmyFingerprint;
  // 公钥接受两种常见表示：32 字节 raw，或 44 字节 SPKI DER（Ed25519）
  let publicKey: Buffer;
  try {
    publicKey = normalizeEd25519PublicKey(provider.publicKey);
  } catch (e) {
    throw new IdentityContractError(
      `identity.publicKey 非法：${(e as Error).message}。` +
        '可用 `normalizeEd25519PublicKey()` / `ed25519SpkiDerFromRaw()` 做转换。'
    );
  }
  if (typeof provider.fingerprint !== 'string' || provider.fingerprint.length === 0) {
    throw new IdentityContractError('identity.fingerprint 缺失');
  }
  const derived = derivation(publicKey);
  if (derived !== provider.fingerprint) {
    throw new IdentityContractError(
      `identity.fingerprint 与公钥不匹配：期望 ${derived}（由 fingerprintDerivation 推出），实际 ${provider.fingerprint}`
    );
  }
  if (typeof provider.sign !== 'function' || typeof provider.verify !== 'function') {
    throw new IdentityContractError('identity.sign / identity.verify 必须是函数');
  }
  const normalized: NormalizedIdentity = {
    normalizedIdentity: true,
    fingerprint: provider.fingerprint,
    publicKey,
    sign: async (message) => toBuf(await provider.sign(toBuf(message))),
    verify: async (message, signature, pk) => (await provider.verify(toBuf(message), toBuf(signature), toBuf(pk))) === true,
    enforceLocalEd25519: opts.enforceLocalEd25519 !== false,
    requireInjectedVerify: opts.requireInjectedVerify === true,
    selfTested: false,
  };
  if (opts.selfTest) await selfTestIdentity(normalized);
  return normalized;
}

/** sign → verify 往返自检：注入实现若不满足契约，这里就会暴露 */
export async function selfTestIdentity(identity: NormalizedIdentity, context = 'warmy-sync self-test'): Promise<void> {
  const probe = sha256(Buffer.from(context, 'utf8'));
  const sig = await identity.sign(probe);
  if (sig.length === 0) throw new IdentityContractError('identity.sign 返回空签名');
  const viaInjected = await identity.verify(probe, sig, identity.publicKey);
  const viaLocal = verifyEd25519Local(probe, sig, identity.publicKey);
  if (!viaInjected && viaLocal !== true) {
    throw new IdentityContractError('identity 自检失败：sign 产出的签名既不被注入 verify 接受，也不被本地 Ed25519 复核接受');
  }
  if (viaLocal === false && viaInjected) {
    throw new IdentityContractError(
      'identity 自检失败：注入 verify 接受，但本地 Ed25519 复核拒绝 —— 公钥/签名算法不是 Ed25519，或 verify 实现有误'
    );
  }
  identity.selfTested = true;
}

/**
 * 对端签名校验 —— 安全关键点
 *
 * 默认策略（enforceLocalEd25519 = true）：
 *  - 公钥是 32 字节 raw Ed25519 时，**本地 `node:crypto` 复核为准**；
 *    注入的 verify 若被要求（requireInjectedVerify）还必须同时通过。
 *  - 公钥不是 32 字节（身份层用了别的算法）时，退回注入的 verify。
 * 这样"注入的 verify 被桩实现成恒真"也不会让篡改签名通过。
 */
export async function verifyPeerSignature(
  identity: NormalizedIdentity | null,
  message: Bytes,
  signature: Bytes,
  publicKey: Bytes
): Promise<{ ok: boolean; via: 'local-ed25519' | 'injected' | 'both' | 'none' }> {
  const local = identity?.enforceLocalEd25519 === false ? null : verifyEd25519Local(message, signature, publicKey);
  if (local !== null) {
    if (local === false) return { ok: false, via: 'none' };
    if (identity?.requireInjectedVerify) {
      const injected = await identity.verify(message, signature, publicKey);
      return { ok: injected, via: 'both' };
    }
    return { ok: true, via: 'local-ed25519' };
  }
  if (!identity) return { ok: false, via: 'none' };
  return { ok: await identity.verify(message, signature, publicKey), via: 'injected' };
}

/** 测试 / 身份层参考实现：内存里的 Ed25519 身份（私钥不经任何持久化） */
export function chuangjianLinShiShenFen(seedLabel?: string): {
  provider: IdentityProvider;
  privateKey: Buffer;
  fingerprint: string;
} {
  const keys = shengChengEd25519();
  void seedLabel;
  const fingerprint = warmyFingerprint(keys.publicKey);
  const provider: IdentityProvider = {
    fingerprint,
    publicKey: keys.publicKey,
    sign: (message) => signEd25519Local(message, keys.privateKey),
    verify: (message, signature, publicKey) =>
      verifyEd25519Local(message, toBuf(signature), toBuf(publicKey)) === true,
  };
  return { provider, privateKey: keys.privateKey, fingerprint };
}

/** 便于测试断言：返回身份的公开描述（不含私钥） */
export function shuoMingShenFen(identity: NormalizedIdentity | IdentityProvider): { fingerprint: string; publicKey: string } {
  return { fingerprint: identity.fingerprint, publicKey: b64u(toBuf(identity.publicKey)) };
}
