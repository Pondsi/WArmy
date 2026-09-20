/**
 * identity-provider —— 身份层 ↔ 组网层的**唯一接缝**（接线层，不含新协议）
 *
 * 这个文件只做三件事：
 *
 *  1. **指纹推导对齐**（`fingerprintDerivationForAppShell`）
 *     身份层（`identity.ts`）的指纹 = `base32(sha256(SPKI DER))` 前 20 位 + 1 位校验 + 短横分组；
 *     组网层（`@warmy/sync-protocol`）默认指纹 = `base32(sha256(raw 32B))`。
 *     两者**不是同一个值** —— 握手时被叫方会用 `fingerprintDerivation` 从对端公钥重推指纹，
 *     不一致就会以 `fingerprint-mismatch` 拒掉**每一条合法连接**。
 *     所以组网层的每一个入口（server / client / handshake / DHT / announce）都必须注入这里给出的
 *     derivation，别处不要再自己拼一份。
 *     `assertDerivationMatches()` 是给启动自检用的：从本机身份文件里的 SPKI DER 取回 raw，
 *     再走一遍 derivation，必须等于身份层自己记的 `info.fingerprint`，否则组网层一律不许启动。
 *
 *  2. **签名者注入**（`createIdentitySigner` / `createIdentityProvider`）
 *     把 `IdentityStore` 适配成组网层要的 `IdentityProvider`：
 *       · `publicKey` 用 `store.info().publicKey`（SPKI DER base64 —— 身份层的线上表示，
 *         组网层两种表示都接受，内部会剥前缀取 raw）；
 *       · `sign()` 产 **raw 64 字节 Ed25519 签名**。注意**不能**用 `store.sign()`：
 *         那个返回的是对 `signingBytes(domain, payload)` 的 base64 签名，语义完全不同
 *         （换证声明/名片用那个；握手 transcript / DHT 记录用这里这个）。
 *       · 私钥**绝不离开主进程**：本模块只在函数内取一次 `privateKeyDer`，用完立刻 `fill(0)` 清零，
 *         任何返回值里都不含私钥。
 *
 *  3. **「当前能否后台签名」的显式门控**（`signReady` / `requireSignableIdentity`）—— 设计取舍，务必读
 *     私钥在盘上是 DEK 加密的（DEK 又被 OS 钥匙串或口令包裹）。后台组网进程没有人给它输口令，
 *     所以「随时可签」**不是天然的**：
 *       · OS 钥匙串模式（没设口令）：`resolveDek()` 会自动解包 → 后台可签，`signReady() === true`；
 *       · 口令模式：必须由 UI 提示用户 `unlock(passphrase)` 一次，之后**本会话内**靠
 *         `IdentityStore.sessionDek` 免口令签名（私钥仍不出主进程）。
 *     **取舍**：本模块**不缓存口令明文、不落盘私钥**，因此 `signReady() === false` 是一个真实状态。
 *     拿不到签名能力时，组网层**不许启动、不许发宣告**，向 UI 如实返回 `identity-locked`
 *     —— 而不是"缓存口令换取永远可签"。后者会把口令变成常驻内存的明文副本，等于自毁这一层保护；
 *     而"静默失败/返回空签名"更糟：会让握手以 `signature-invalid` 不明不白地失败。
 *
 * 本模块不做：密钥存储、身份文件读写、代次规则、联系方式冻结（都在 identity / identity-store 里）。
 */
import crypto from 'node:crypto';
import path from 'node:path';
import {
  MEMBERSHIP_CLOCK_SKEW_MS,
  REVOCATION_REASONS,
  gouJianChengYuanZhengShu,
  gouJianCheXiaoBiao,
  ed25519PublicKeyObject,
  ed25519RawFromSpkiDer,
  ed25519SpkiDerFromRaw,
  normalizeEd25519PublicKey,
  randomHex,
  signMemberCertificate,
  signRevocationList,
  verifyMemberCertificate,
  type ZhiWenTuiDao,
  type ShenfenGongyingshang,
  type ChengYuanZhengShuMa,
  type ChengYuanZhengShuJueSe,
  type ChengYuanZhengShu,
  type quChengYuanZhiWen,
  type GuifanShenfen,
  type CheXiaoBiao,
  type CheXiaoYuanYin,
} from '@warmy/sync-protocol';
import {
  DEFAULT_CLOCK_SKEW_MS,
  fingerprintFromPublicKey,
  zhiwenPipei,
  keyObjectFromPrivateDer,
  verifyRotationDeclaration,
  type LianXiKa,
  type YaoShiHuanTiaoMu,
  type DuiDuanLianXiShiTu,
  type LunHuanShengMing,
  type LunHuanYanZhengJieGuo,
} from './identity.js';
import {
  MEMBERSHIP_FILE_SCHEMA,
  MembershipStore,
  type IdentityStore,
  type JieSuoTai,
} from './identity-store.js';

/** 组网层用的指纹推导：raw 32B Ed25519 公钥 → 身份层指纹 */
export function fingerprintDerivationForAppShell(): ZhiWenTuiDao {
  return (raw32: Buffer): string =>
    fingerprintFromPublicKey(ed25519SpkiDerFromRaw(raw32).toString('base64'));
}

/** 无法签名时的类型化错误（**不允许**静默返回空签名） */
export type ShenfenQianmingzheCuowuDaima = 'identity-locked' | 'identity-missing' | 'identity-unusable';

export class IdentityUnavailableError extends Error {
  readonly code: ShenfenQianmingzheCuowuDaima;
  constructor(code: ShenfenQianmingzheCuowuDaima, message?: string) {
    super(message ?? code);
    // name 直接用 code：调用方可以只判 `e.name === 'identity-locked'`
    this.name = code;
    this.code = code;
  }
}

export interface DerivationCheck {
  fingerprint: string;
  derived: string;
  publicKeyRawBytes: number;
}

/**
 * 启动自检：身份层记的指纹必须能由**身份文件里的公钥**推出来。
 * 不等（或公钥不是 Ed25519 SPKI）就抛错，并带上期望/实际值 —— 这种情况下一旦启动组网，
 * 结果是"所有合法握手都被拒"，比直接失败更难排查。
 */
export function duanyanTuidaoPipei(store: IdentityStore): DerivationCheck {
  const info = store.info();
  if (!info) {
    throw new IdentityUnavailableError('identity-missing', '本机身份不存在，无法校验指纹推导');
  }
  const der = Buffer.from(info.publicKey, 'base64');
  const raw = ed25519RawFromSpkiDer(der);
  if (!raw) {
    throw new IdentityUnavailableError(
      'identity-unusable',
      `identity.publicKey 不是 Ed25519 SPKI DER（${der.length} 字节）：无法推出指纹`
    );
  }
  const derived = fingerprintDerivationForAppShell()(raw);
  if (derived !== info.fingerprint) {
    throw new IdentityUnavailableError(
      'identity-unusable',
      `指纹推导不一致：身份层期望 ${info.fingerprint}，由公钥推出 ${derived}（组网层会拒掉所有合法握手）`
    );
  }
  return { fingerprint: info.fingerprint, derived, publicKeyRawBytes: raw.length };
}

/** 供 UI / 组网层查询的解锁状态（结构化数据，不拼文案） */
export interface QianMingZheJieSuoTai {
  mode: JieSuoTai['mode'];
  unlocked: boolean;
  needsPassphrase: boolean;
  /** 是否真的能后台签名（= 现在调 sign() 不会抛 identity-locked） */
  signReady: boolean;
}

export interface ShenfenQianmingzhe {
  /** 身份层指纹（线上表示） */
  readonly fingerprint: string;
  /** SPKI DER base64（公开信息，可直接给渲染进程） */
  readonly publicKey: string;
  /** 现在能否后台签名（真实判定：真的去解一次私钥，不缓存、不导出） */
  signReady(): boolean;
  unlockState(): QianMingZheJieSuoTai | null;
  /** raw 64 字节 Ed25519 签名；不能签时抛 IdentityUnavailableError */
  sign(msg: Buffer): Promise<Buffer>;
  /** 校验任意公钥的签名；返回 null = 这次**没有**真的验过（公钥无法解释） */
  verify(msg: Buffer, sig: Buffer, pub: Buffer | string | Uint8Array): boolean | null;
}

export function createIdentitySigner(store: IdentityStore): ShenfenQianmingzhe {
  const info = store.info();
  if (!info) {
    throw new IdentityUnavailableError('identity-missing', '本机身份不存在，无法构造签名者');
  }
  const fingerprint = info.fingerprint;
  const publicKey = info.publicKey;

  const signer: ShenfenQianmingzhe = {
    fingerprint,
    publicKey,

    signReady(): boolean {
      const u = store.unlockState();
      if (!u.unlocked) return false;
      // unlocked 只说明"看起来能解"（例如 OS 保护但钥匙串实际不可用）：
      // 真判定走一次真实的私钥解密，用完立刻清零，绝不缓存也已保存不了私钥。
      const loaded = store.load();
      if (!loaded.ok) return false;
      loaded.privateKeyDer.fill(0);
      return true;
    },

    unlockState(): QianMingZheJieSuoTai | null {
      const cur = store.unlockState();
      const nfo = store.info();
      if (!nfo) return null;
      const unlocked = cur.unlocked && signer.signReady();
      return {
        mode: cur.mode,
        unlocked,
        needsPassphrase: cur.needsPassphrase,
        signReady: unlocked,
      };
    },

    async sign(msg: Buffer): Promise<Buffer> {
      if (!Buffer.isBuffer(msg)) {
        throw new IdentityUnavailableError('identity-unusable', 'sign 只接受 Buffer');
      }
      // ⚠️ 只用 sessionDek（OS 钥匙串模式会自动解包）；**不接受口令参数**：
      // 本桥没有任何入口能把口令带进后台组网进程。
      const loaded = store.load();
      if (!loaded.ok) {
        throw new IdentityUnavailableError(
          'identity-locked',
          `身份未解锁，无法后台签名（${loaded.error}）：请先在身份设置里用口令解锁；后台不会缓存口令`
        );
      }
      const der = loaded.privateKeyDer;
      try {
        const key = keyObjectFromPrivateDer(der);
        // raw 64 字节 Ed25519 签名。**不是** store.sign()（那是 domain+payload 的 base64 签名）
        const sig = crypto.sign(null, msg, key);
        if (sig.length !== 64) {
          throw new IdentityUnavailableError(
            'identity-unusable',
            `Ed25519 签名长度异常：${sig.length}（应为 64）`
          );
        }
        return sig;
      } finally {
        // 私钥明文副本用完即清（不缓存 KeyObject、不返回给调用方）
        der.fill(0);
      }
    },

    verify(msg: Buffer, sig: Buffer, pub: Buffer | string | Uint8Array): boolean | null {
      if (!Buffer.isBuffer(msg) || !Buffer.isBuffer(sig)) return null;
      if (sig.length === 0) return null;
      let raw: Buffer;
      try {
        raw = normalizeEd25519PublicKey(pub as never);
      } catch {
        // 无法解释的公钥 → null（"这次没验过"），绝不返回 true 假装通过
        return null;
      }
      try {
        return crypto.verify(null, msg, ed25519PublicKeyObject(raw) as crypto.KeyObject, sig);
      } catch {
        // 公钥能解释但签名格式非法 → 判定为验签失败（fail-closed）
        return false;
      }
    },
  };
  return signer;
}

/** 组装成组网层要的四字段 `IdentityProvider`（server / client / handshake / DHT 都吃这个） */
export function chuangjianShenfenGongyingshang(store: IdentityStore | ShenfenQianmingzhe): ShenfenGongyingshang {
  const signer = isSigner(store) ? store : createIdentitySigner(store);
  return {
    fingerprint: signer.fingerprint,
    publicKey: signer.publicKey,
    sign: (message: Uint8Array): Promise<Buffer> => signer.sign(Buffer.from(message)),
    verify: (message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array | string): boolean =>
      // 契约要求 boolean：null（没验过）也必须收敛成 false，否则等于放行
      signer.verify(Buffer.from(message), Buffer.from(signature), publicKey as never) === true,
  };
}

function isSigner(v: IdentityStore | ShenfenQianmingzhe): v is ShenfenQianmingzhe {
  return typeof (v as ShenfenQianmingzhe).signReady === 'function';
}

/** 组网层启动/宣告前的门控结果 */
export interface SignableGate {
  ok: boolean;
  errorCode?: ShenfenQianmingzheCuowuDaima;
  /** 拿不到签名能力时，UI 就是靠这个提示"身份未解锁" */
  unlock?: QianMingZheJieSuoTai | null;
  reason?: string;
}

/**
 * 门控：**没有签名能力就不要启动组网 / 不要发宣告**。
 * 返回值是结构化数据（errorCode + unlock），由渲染层决定怎么措辞。
 */
export function requireSignableIdentity(store: IdentityStore | null): SignableGate {
  if (!store) return { ok: false, errorCode: 'identity-missing', reason: 'identity-store-unavailable' };
  try {
    const signer = createIdentitySigner(store);
    const u = signer.unlockState();
    if (!u || !u.signReady) {
      return { ok: false, errorCode: 'identity-locked', unlock: u, reason: 'identity-not-unlocked' };
    }
    duanyanTuidaoPipei(store);
    return { ok: true, unlock: u };
  } catch (e) {
    const code = (e as IdentityUnavailableError).code ?? 'identity-unusable';
    return { ok: false, errorCode: code, unlock: null, reason: (e as Error).message };
  }
}

/* ────────────────────── 本机已知联系人（名册 / presence 用） ────────────────────── */

/**
 * 本机 peer-contacts.json 里的指纹键。
 * 走 `IdentityStore.peerContactKeys()`（身份层已把它公开）；每条的实际内容仍由
 * `store.peerContact(fp)` 解析（含冻结结算逻辑），这里不做第二份解析。
 */
export function peerContactKeys(store: IdentityStore | null): string[] {
  if (!store) return [];
  try {
    return store.peerContactKeys();
  } catch {
    return [];
  }
}

/** 本机已知联系人指纹集合（= 名册的 TOFU 部分） */
export function knownContactFingerprints(store: IdentityStore | null): string[] {
  return peerContactKeys(store);
}

/* ────────────────────── 成员证书存储（落盘在身份目录下） ────────────────────── */

/** 成员证书 / 吊销列表的落盘位置（与身份文件同目录；两边都是本机数据） */
export function membershipFileFor(store: IdentityStore): string {
  return path.join(path.dirname(store.path()), 'membership.json');
}

const membershipCache = new WeakMap<IdentityStore, MembershipStore>();

/**
 * 取（并缓存）本机身份的成员证书存储。
 * 缓存按 IdentityStore 实例走：同一进程里所有调用点（名册、IPC、在线态）看到同一份数据；
 * `MembershipStore` 内部再按文件 mtime+size 判定是否重读，所以外部改文件也能被看见。
 */
export function membershipStoreFor(
  store: IdentityStore | null,
  opts: { onAudit?: (op: string, detail?: unknown) => void } = {}
): MembershipStore | null {
  if (!store) return null;
  const hit = membershipCache.get(store);
  if (hit) return hit;
  const yiChuangJian = new MembershipStore(membershipFileFor(store), {
    ...(opts.onAudit ? { onAudit: opts.onAudit } : {}),
    // 指纹推导与本地时间容差都对齐身份层（同一个值、同一个实现）
    fingerprintOf: fingerprintFromPublicKey,
    clockSkewMs: DEFAULT_CLOCK_SKEW_MS,
  });
  membershipCache.set(store, yiChuangJian);
  return yiChuangJian;
}

export interface RosterCheckerOptions {
  /** 显式注入的成员证书存储（默认从 IdentityStore 推导） */
  membership?: MembershipStore | null;
  now?: () => number;
  /** 打开"没有证书就不放行"（默认 false —— 没证书的群保留 TOFU 降级） */
  requireCertificate?: boolean;
}

/**
 * 名册校验器 —— 握手层对 `roster(fp) === false` 的处理是 `not-authorized` 直接拒绝（fail-closed）。
 *
 * 判定顺序（**顺序本身是安全语义，别调换**）：
 *  ① `extra`（调用方显式 pin 过的地址对应的指纹）→ 放行；
 *  ② **本机对该指纹有成员证书/吊销记录** → 由记录给最终结论：
 *     · 有效且未被吊销 → 放行；
 *     · 过期 / 未生效 / 签名不对 / 签发者不是群主 / 在吊销名单里 → **拒绝**（不再退回 TOFU）。
 *     这一步是"被吊销者拿旧证书重连必须被拒"的落点；
 *  ③ 没有记录 → **TOFU 降级**：已知联系人（peer-contacts.json）放行。
 *     没有证书的群（还没铺开证书的老流程）因此不会被卡死 —— 这是刻意的兼容，
 *     但一旦某人在本机有了证书，②就接管他，TOFU 不再能替他背书。
 *
 * `requireCertificate: true` 时关掉③（只有②和①能放行）。默认关闭：现有单测/老库都还没有证书。
 */
export function createRosterChecker(
  store: IdentityStore | null,
  extra: string[] = [],
  opts: RosterCheckerOptions = {}
): (fingerprint: string) => boolean {
  const allow = new Set<string>();
  for (const fp of knownContactFingerprints(store)) allow.add(fp);
  for (const fp of extra) if (typeof fp === 'string' && fp) allow.add(fp);
  const pinned = new Set<string>(extra.filter((fp) => typeof fp === 'string' && fp.length > 0));
  const membership = opts.membership !== undefined ? opts.membership : membershipStoreFor(store);
  const now = opts.now ?? ((): number => Date.now());
  const guiFanHua = (s: string): string => s.replace(/-/g, '').toLowerCase();
  const inSet = (set: Set<string>, fingerprint: string): boolean => {
    if (set.has(fingerprint)) return true;
    const target = guiFanHua(fingerprint);
    for (const fp of set) if (guiFanHua(fp) === target) return true;
    return false;
  };
  return (fingerprint: string): boolean => {
    if (typeof fingerprint !== 'string' || !fingerprint) return false;
    // ① 显式 pin（"我刚把这个地址 pin 过"）—— 调用方自己负责这个信任，不在名册里再判一次
    if (inSet(pinned, fingerprint)) return true;
    // ② 证书 / 吊销记录优先
    if (membership) {
      const verdict = membership.authorizeFingerprint(fingerprint, { now: now() });
      if (verdict.decided) return verdict.ok;
    }
    // ③ TOFU 降级
    if (opts.requireCertificate) return false;
    return inSet(allow, fingerprint);
  };
}

/** 名册判定 + 原因（给 IPC / UI / 审计用；`createRosterChecker` 只回布尔） */
export function explainRosterDecision(
  store: IdentityStore | null,
  fingerprint: string,
  opts: RosterCheckerOptions & { extra?: string[] } = {}
): {
  allowed: boolean;
  basis: 'pin' | 'certificate' | 'revoked' | 'tofu' | 'none';
  code: string;
  groupId?: string;
  certId?: string;
  detail?: string;
} {
  const membership = opts.membership !== undefined ? opts.membership : membershipStoreFor(store);
  const extra = opts.extra ?? [];
  if (extra.some((fp) => zhiwenPipei(fp, fingerprint))) {
    return { allowed: true, basis: 'pin', code: 'pinned' };
  }
  if (membership) {
    const v = membership.authorizeFingerprint(fingerprint, { now: (opts.now ?? (() => Date.now()))() });
    if (v.decided) {
      return {
        allowed: v.ok,
        basis: v.ok ? 'certificate' : 'revoked',
        code: v.code,
        ...(v.groupId ? { groupId: v.groupId } : {}),
        ...(v.certId ? { certId: v.certId } : {}),
        ...(v.detail ? { detail: v.detail } : {}),
      };
    }
  }
  if (!opts.requireCertificate && knownContactFingerprints(store).some((fp) => zhiwenPipei(fp, fingerprint))) {
    return { allowed: true, basis: 'tofu', code: 'known-contact' };
  }
  return { allowed: false, basis: 'none', code: 'unknown-fingerprint' };
}

/** 所有对端名片视图（UI 用「有谁换了证」；逐键走 store.peerContact 以复用冻结期结算） */
export function listPeerContactViews(store: IdentityStore | null, now: number = Date.now()): DuiDuanLianXiShiTu[] {
  const out: DuiDuanLianXiShiTu[] = [];
  for (const fp of peerContactKeys(store)) {
    const shitu = store?.peerContact(fp, now) ?? null;
    if (shitu) out.push(shitu);
  }
  return out;
}

/** 便于断言「签名就是 raw 64 字节」（验证脚本用；纯函数，不接触私钥） */
export function isRawEd25519Signature(sig: Buffer): boolean {
  return Buffer.isBuffer(sig) && sig.length === 64;
}

/* ────────────── 身份变更横幅的数据（UI 契约 identityChanges 的形状） ────────────── */

export interface biangengQuerenJilu {
  level: 'dismiss' | 'verified';
  at: number;
  auditId: string;
}

/**
 * `scopes` 是怎么算出来的（**必须如实标出来**，UI / 审计都靠它区分"精确"与"降级"）：
 *  · `membership`   —— 由成员表（群/项目）与联系人表里的**指纹映射**算出来的，精确到具体会话；
 *  · `fallback-all` —— 本机**没有**任何映射（没指纹 / 成员表为空）→ 退回"到处都出现"
 *                      （旧行为，不许因为改动而退化）；
 *  · `self-all`     —— 这是**本机自己**的换证：与"本机在哪些地方出现"全都相关，
 *                      给 `all` 是真实结论，不是降级。
 */
export type BiangengZuoyongyuYiju = 'membership' | 'fallback-all' | 'self-all';

export interface BiangengZuoyongyu {
  kind: 'internal' | 'external' | 'extdm' | 'all';
  id?: string;
}

export interface ShenfenBiangengTiaomu {
  id: string;
  ts: number;
  subjectId: string;
  subjectName: string;
  oldFingerprint: string;
  newFingerprint: string;
  generation: number;
  reason?: 'rotate' | 'compromised';
  /** 旧联系方式：**只能是本机留存值**（刻意放这里，好让验证脚本能断言它不来自声明） */
  previousCard: LianXiKa | null;
  /** 换证时收到的新名片（本机留存）；没有则 null */
  pendingCard: LianXiKa | null;
  contactFreezeUntil?: number;
  frozen?: boolean;
  remainingMs?: number;
  /** 该在哪些地方出现横幅（精确到具体群/项目；拿不到映射时如实给 all） */
  scopes: BiangengZuoyongyu[];
  /** `scopes` 的来历（见 ChangeScopeBasis 的三条说明） */
  scopeBasis: BiangengZuoyongyuYiju;
  ack?: { dismissedAt?: number; verifiedAt?: number };
}

/**
 * 成员表最小接口（GroupStore 天然满足它）。
 * 用接口而不是直接依赖 GroupStore：验证脚本可以喂真 GroupStore，也可以喂一个受控替身，
 * 而 identity-provider 不必知道 groups.json 的存在。
 */
export interface ChengyuanMulu {
  listGroups(): Array<{ groupId: string; type: 'internal' | 'external' }>;
  listMembers(groupId: string): Array<{ id: string; name: string; fingerprint?: string }>;
}

export interface ComputeScopesInput {
  /** 变更链上的指纹（旧 + 新；通常由 `chainFingerprintsFor` 扩展过） */
  fingerprints: string[];
  directory?: ChengyuanMulu | null;
  /** 本机已知联系人指纹（peer-contacts.json 的键） */
  contacts?: string[];
  /** 本机自己的指纹：命中它 → 本机的换证，`scopes = [{kind:'all'}]` */
  selfFingerprint?: string;
}

export interface ComputeScopesResult {
  scopes: BiangengZuoyongyu[];
  scopeBasis: BiangengZuoyongyuYiju;
  matchedGroups: Array<{ groupId: string; type: 'internal' | 'external'; memberId: string; memberName: string }>;
  matchedContacts: string[];
}

/**
 * 把"某个指纹换了证"翻译成"哪些会话该出横幅"。
 *
 * 关键点：**映射缺失时不许凭空变成"到处都出现"，但也不许变成"哪里都不出现"**。
 * 前者是降级（旧行为，UI 依赖），后者会让用户完全看不到换证提醒 —— 所以回退方向是 `all`，
 * 并用 `scopeBasis` 如实标出"这是回退，不是结论"。
 */
export function computeChangeScopes(input: ComputeScopesInput): ComputeScopesResult {
  const fps = [...new Set((input.fingerprints ?? []).map((f) => String(f || '')).filter((f) => f.length > 0))];
  const matchedGroups: ComputeScopesResult['matchedGroups'] = [];
  const matchedContacts: string[] = [];
  if (input.selfFingerprint && fps.some((fp) => zhiwenPipei(fp, String(input.selfFingerprint)))) {
    return { scopes: [{ kind: 'all' }], scopeBasis: 'self-all', matchedGroups, matchedContacts };
  }
  const scopes: BiangengZuoyongyu[] = [];
  const seen = new Set<string>();
  const push = (kind: BiangengZuoyongyu['kind'], id?: string): void => {
    const key = `${kind}:${id ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    scopes.push(id ? { kind, id } : { kind });
  };
  const hit = (fp: string | undefined): boolean =>
    !!fp && fps.some((target) => zhiwenPipei(fp, target));
  if (input.directory) {
    for (const g of input.directory.listGroups()) {
      const kind: BiangengZuoyongyu['kind'] = g.type === 'external' ? 'external' : 'internal';
      for (const m of input.directory.listMembers(g.groupId)) {
        if (!hit(m.fingerprint)) continue;
        matchedGroups.push({ groupId: g.groupId, type: g.type, memberId: m.id, memberName: m.name });
        push(kind, g.groupId);
      }
    }
  }
  for (const fp of input.contacts ?? []) {
    if (!hit(fp)) continue;
    matchedContacts.push(fp);
  }
  // 联系人的会话 id 与指纹之间本机没有映射表 → 只能标到"联系人（extdm）"这一级，
  // **不填 id**（填了会与 UI 的会话 id 对不上，横幅反而会彻底消失）
  if (matchedContacts.length) push('extdm');
  if (!scopes.length) {
    return { scopes: [{ kind: 'all' }], scopeBasis: 'fallback-all', matchedGroups, matchedContacts };
  }
  return { scopes, scopeBasis: 'membership', matchedGroups, matchedContacts };
}

/**
 * 组装「身份变更」列表 = ① 本机换证（声明由本机自己写、可信）② 对端换证（本机记过 receivedAt 的条目）。
 *
 * ⚠️ 安全要点（写在代码里免得后人改坏）：
 *   `previousCard` **只从本机留存历史取**（`store.contactCardHistory()` / `PeerContactView.previousCard`）。
 *   换证声明是**攻击者可控数据**（`verifyRotationDeclaration` 已显式拒收带联系方式的声明），
 *   从声明里读旧名片 = 让攻击者伪造"旧联系方式"来冒充熟人。
 *   对端的 new/old 指纹也由**本机留存条目**推出（同一 receivedAt 的新旧两条，代次高者为新），
 *   不采信声明里的 oldFingerprint。
 *
 * `scopes` 的算法见 `computeChangeScopes`：给了 `directory`（真群成员表）与 `membership`（证书链）
 * 才能精确到具体群；**不给就退回 `[{kind:'all'}]`**（旧行为，UI 175 项验收依赖它）。
 */
export function buildIdentityChangeEntries(
  store: IdentityStore | null,
  opts: {
    now?: number;
    acks?: Record<string, biangengQuerenJilu>;
    membership?: MembershipStore | null;
    directory?: ChengyuanMulu | null;
    contacts?: string[];
  } = {}
): ShenfenBiangengTiaomu[] {
  if (!store) return [];
  const now = opts.now ?? Date.now();
  const acks = opts.acks ?? {};
  const membership = opts.membership !== undefined ? opts.membership : membershipStoreFor(store);
  const contacts = opts.contacts ?? knownContactFingerprints(store);
  const chainOf = (fps: string[]): string[] => {
    const out = new Set<string>();
    for (const fp of fps) {
      if (!fp) continue;
      out.add(fp);
      // 证书链上的任一指纹都算"同一个成员"，用它去成员表里找归属
      for (const linked of membership ? membership.chainFingerprints(fp) : []) out.add(linked);
    }
    return [...out];
  };
  const mkAck = (id: string): ShenfenBiangengTiaomu['ack'] => {
    const a = acks[id];
    if (!a) return undefined;
    return a.level === 'verified' ? { verifiedAt: a.at } : { dismissedAt: a.at };
  };
  const changes: ShenfenBiangengTiaomu[] = [];

  // ① 本机换证
  const info = store.info();
  const history = store.contactCardHistory();
  const freeze = store.contactFreeze(now);
  const selfFingerprint = info?.fingerprint ?? '';
  if (info) {
    for (const d of store.declarations()) {
      if (d.kind !== 'warmy.identity.rotation') continue;
      const id = `self:${d.oldFingerprint}->${d.newFingerprint}`;
      // 旧名片 = 换证时刻之前、本机留存的最后一条（声明里没有联系方式）
      const prev = history.filter((h) => h.at <= d.issuedAt).slice(-1)[0]?.card ?? null;
      const yiZuoYongYu = computeChangeScopes({
        fingerprints: chainOf([d.oldFingerprint, d.newFingerprint]),
        directory: opts.directory ?? null,
        contacts,
        // 本机自己的换证：三处都该看到（真实结论，不是降级）
        selfFingerprint: selfFingerprint || d.newFingerprint,
      });
      const entry: ShenfenBiangengTiaomu = {
        id,
        ts: d.issuedAt,
        subjectId: info.fingerprint,
        subjectName: info.alias,
        oldFingerprint: d.oldFingerprint,
        newFingerprint: d.newFingerprint,
        generation: d.generation,
        reason: d.reason === 'compromised' ? 'compromised' : 'rotate',
        previousCard: prev,
        pendingCard: info.contactCard ?? null,
        contactFreezeUntil: freeze.contactFreezeUntil,
        frozen: freeze.frozen,
        remainingMs: freeze.remainingMs,
        scopes: yiZuoYongYu.scopes,
        scopeBasis: yiZuoYongYu.scopeBasis,
      };
      const ack = mkAck(id);
      if (ack) entry.ack = ack;
      changes.push(entry);
    }
  }

  // ② 对端换证
  const views = listPeerContactViews(store, now);
  for (const shitu of views) {
    if (!shitu.receivedAt) continue;
    const peiDui = views.filter((v) => v.receivedAt === shitu.receivedAt);
    let zuixin = shitu;
    for (const v of peiDui) if (v.generation > zuixin.generation) zuixin = v;
    if (zuixin !== shitu) continue; // 旧条目不再单独出横幅
    const zuijiu = peiDui.find((v) => v !== zuixin);
    const id = `peer:${zuixin.fingerprint}:${zuixin.receivedAt}`;
    const yiZuoYongYu = computeChangeScopes({
      fingerprints: chainOf([zuijiu?.fingerprint ?? '', zuixin.fingerprint]),
      directory: opts.directory ?? null,
      contacts,
    });
    const entry: ShenfenBiangengTiaomu = {
      id,
      ts: zuixin.receivedAt,
      subjectId: zuixin.fingerprint,
      subjectName: '',
      // 旧指纹来自本机留存条目（不是声明）
      oldFingerprint: zuijiu?.fingerprint ?? '',
      newFingerprint: zuixin.fingerprint,
      generation: zuixin.generation,
      reason: 'rotate',
      previousCard: zuixin.previousCard ?? null,
      pendingCard: zuixin.pendingCard ?? null,
      contactFreezeUntil: zuixin.contactFreezeUntil,
      frozen: zuixin.frozen,
      remainingMs: zuixin.remainingMs,
      scopes: yiZuoYongYu.scopes,
      scopeBasis: yiZuoYongYu.scopeBasis,
    };
    const ack = mkAck(id);
    if (ack) entry.ack = ack;
    changes.push(entry);
  }

  return changes.sort((a, b) => b.ts - a.ts);
}

/* ────────────── 成员在线态：用**活连接集合**按指纹判定（T179） ────────────── */

export type ZaichangYiju = 'local-instance' | 'mesh-session' | 'unattributed';

export interface ChengyuanZaichangHang {
  id: string;
  name: string;
  /** 异地成员（不在本机实例列表里） */
  remote: boolean;
  /** 成员表里记的身份指纹（缺失 = 未知，**不猜**） */
  fingerprint?: string;
  /** 只有"知道是谁"时才给这一项（`local-instance` / `mesh-session`）；unattributed 时**不给** */
  online?: boolean;
  disabled?: boolean;
  presenceBasis: ZaichangYiju;
  /** 在线判据的细节：命中哪条活连接（`creator-probe` 是弱证据，会被迟滞判回离线） */
  presenceVia?: 'member-connection' | 'creator-probe' | 'none';
}

export interface LivenessLike {
  fingerprint: string;
  online: boolean;
  via?: string;
}

export interface GoujianChengyuanZaichangShuru {
  members: Array<{ id: string; name: string; source?: string; instanceId?: string; fingerprint?: string }>;
  instances: Array<{ id: string; name?: string; status?: string }>;
  /** 活连接集合（`SecureMesh.presence()` / `ConnectionLiveness.list()` 的原样输出） */
  liveness: LivenessLike[];
  /** 关掉时异地成员一律不判在线（UI 会显示"组网关闭"） */
  meshEnabled: boolean;
  /** 成员表里显式停用的 instance（如已停用的本机牛马） */
  disabledInstanceIds?: string[];
}

/**
 * 组装"成员在线态"。
 *
 * 判据（ADR C1）：**成员发起的鉴权连接存活 = 在线**；没有活连接就是不在线。
 *  - 本机实例成员 → 用 InstanceManager 的真实状态（`local-instance`）；
 *  - 有指纹的异地成员 → 用活连接集合按指纹判（`mesh-session`）：
 *      命中活连接 → online=该连接状态；**没命中 → online=false**（"没有连接"就是"不在线"，
 *      不假装知道、也不假装在线）；
 *  - 没指纹的异地成员 → `unattributed`，**不给 `online`**（宁可不给，也不编）。
 */
export function goujianChengyuanZaichang(input: GoujianChengyuanZaichangShuru): ChengyuanZaichangHang[] {
  const disabled = new Set(input.disabledInstanceIds ?? []);
  const liveByFp = new Map<string, LivenessLike>();
  for (const l of input.liveness ?? []) {
    if (l && typeof l.fingerprint === 'string' && l.fingerprint) liveByFp.set(l.fingerprint, l);
  }
  const findLive = (fp: string): LivenessLike | null => {
    const exact = liveByFp.get(fp);
    if (exact) return exact;
    for (const [k, v] of liveByFp) if (zhiwenPipei(k, fp)) return v;
    return null;
  };
  return (input.members ?? []).map((m) => {
    const id = String(m.id || m.name || '');
    const inst = m.instanceId
      ? input.instances.find((h) => h.id === m.instanceId)
      : input.instances.find((h) => h.id === id || (h.name && h.name === m.name));
    const isLocal = !!inst || m.source === 'instance';
    if (isLocal) {
      const row: ChengyuanZaichangHang = {
        id,
        name: String(m.name || id),
        remote: false,
        online: inst ? inst.status === 'running' : false,
        presenceBasis: 'local-instance',
      };
      if (inst && disabled.has(inst.id)) row.disabled = true;
      return row;
    }
    const fp = String(m.fingerprint || '');
    if (fp) {
      const live = findLive(fp);
      const row: ChengyuanZaichangHang = {
        id,
        name: String(m.name || id),
        remote: true,
        fingerprint: fp,
        online: input.meshEnabled ? live?.online === true : false,
        presenceBasis: 'mesh-session',
        presenceVia: (live?.via as ChengyuanZaichangHang['presenceVia']) ?? 'none',
      };
      return row;
    }
    // 拿不到指纹 → 如实说"本机无法归属"，**不给 online**
    return {
      id,
      name: String(m.name || id),
      remote: true,
      presenceBasis: 'unattributed',
    };
  });
}

/* ══════════ 成员证书的签发 / 换证 / 吊销（ADR §2.3 第 6 条 + §附八.8 + §附五.1 第四层） ══════════
 *
 * 这四条路径是"证书不是摆着好看"的全部意义所在：
 *   · `issueMemberCertificate`      —— 创建者签发（成员加入，或人工恢复）
 *   · `rotateMemberCertificate`     —— **换证后重签**（supersedes 指向旧证书）+ 旧证书进吊销列表
 *   · `revokeMemberCertificate`     —— 踢人 / 私钥泄漏：拉黑某个 certId
 *   · `applyInboundRevocationUpdate` —— 收到（已鉴权对端发来的）吊销列表：验签 + 单调合并
 *
 * 签名一律走 `IdentitySigner.sign()`：**raw 64 字节 Ed25519**，私钥不出主进程。
 */

/** 签发一张成员证书（创建者视角）。`signer` 必须是**已解锁**的本机身份。 */
export interface WentiChengyuanZhengshuShuru {
  signer: ShenfenQianmingzhe;
  membership: MembershipStore;
  groupId: string;
  /** 成员的指纹与公钥（SPKI DER base64）：两者必须自洽，否则签发直接失败 */
  memberFingerprint: string;
  memberPublicKey: string;
  displayName?: string;
  role?: ChengYuanZhengShuJueSe;
  permissions?: string[];
  /** 创建者分配的**稳定成员标识**：换证后沿用同一个值，链就断不了 */
  memberId?: string;
  /** 换证重签时指向旧证书 certId */
  supersedes?: string;
  /** 显式指定 certId（默认随机）；测试与"重放同一张证书"时用得上 */
  certId?: string;
  ttlMs?: number;
  now?: number;
  /** 证书有效期上限（默认 DEFAULT_MEMBER_CERT_TTL_MS） */
  expectIssuerFingerprint?: string;
}

export interface WentiChengyuanZhengshuJieguo {
  ok: boolean;
  code: string;
  cert?: ChengYuanZhengShu;
  stored?: boolean;
  detail?: string;
}

/**
 * 串行化包装：见 `MembershipStore.runExclusive`。
 * 内层实现不拿锁，所以 rotate / reissue 里嵌套调用它不会死锁。
 */
export function wentiChengyuanZhengshu(input: WentiChengyuanZhengshuShuru): Promise<WentiChengyuanZhengshuJieguo> {
  return input.membership.runExclusive(() => wentiChengyuanZhengshuShixian(input));
}

async function wentiChengyuanZhengshuShixian(input: WentiChengyuanZhengshuShuru): Promise<WentiChengyuanZhengshuJieguo> {
  const signer = input.signer;
  if (!signer) return { ok: false, code: 'identity-missing' };
  if (!signer.signReady()) {
    // 绝不允许"拿不到私钥就发一张没有签名的证书"
    return { ok: false, code: 'identity-locked', detail: '身份未解锁：不能签发成员证书' };
  }
  const now = input.now ?? Date.now();
  const certId = input.certId || `mc-${randomHex(8)}`;
  let cert: ChengYuanZhengShu;
  try {
    cert = gouJianChengYuanZhengShu(
      {
        certId,
        groupId: input.groupId,
        memberFingerprint: input.memberFingerprint,
        memberPublicKey: input.memberPublicKey,
        issuerFingerprint: signer.fingerprint,
        issuerPublicKey: signer.publicKey,
        ...(input.displayName ? { displayName: input.displayName } : {}),
        ...(input.role ? { role: input.role } : {}),
        ...(input.permissions ? { permissions: input.permissions } : {}),
        ...(input.memberId ? { memberId: input.memberId } : {}),
        ...(input.supersedes ? { supersedes: input.supersedes } : {}),
      },
      { now, ...(input.ttlMs ? { ttlMs: input.ttlMs } : {}) }
    );
    cert = await signMemberCertificate(cert, (bytes) => signer.sign(bytes));
  } catch (e) {
    return { ok: false, code: 'build-failed', detail: (e as Error).message };
  }
  // 自检：签出来的东西必须能过自己的验证（签名实现坏掉时立刻暴露，而不是等成员连不上）
  const self = verifyMemberCertificate(cert, {
    fingerprintOf: fingerprintFromPublicKey,
    clockSkewMs: DEFAULT_CLOCK_SKEW_MS,
    now,
    expectGroupId: input.groupId,
    expectIssuerFingerprint: input.expectIssuerFingerprint || signer.fingerprint,
  });
  if (!self.ok) return { ok: false, code: `self-check:${self.code}`, detail: self.detail };
  const stored = input.membership.putCertificate(cert, {
    ...(input.expectIssuerFingerprint ? { expectIssuerFingerprint: input.expectIssuerFingerprint } : {}),
  });
  if (!stored.ok) return { ok: false, code: stored.code, cert, stored: false, detail: stored.detail };
  return { ok: true, code: stored.code, cert, stored: true };
}

/** 生成下一版吊销列表（在**本机当前列表**基础上追加条目；版本单调 +1） */
async function appendRevocationEntries(input: {
  signer: ShenfenQianmingzhe;
  membership: MembershipStore;
  groupId: string;
  add: Array<{ certId: string; memberFingerprint: string; reason: CheXiaoYuanYin }>;
  now?: number;
}): Promise<{ ok: true; list: CheXiaoBiao; previousVersion: number } | { ok: false; code: string; detail?: string }> {
  const now = input.now ?? Date.now();
  if (!input.signer.signReady()) return { ok: false, code: 'identity-locked', detail: '身份未解锁：不能签发吊销列表' };
  const current = input.membership.revocation(input.groupId);
  const entries = (current?.entries ?? []).map((e) => ({ ...e }));
  for (const a of input.add) {
    const idx = entries.findIndex((e) => e.certId === a.certId);
    const row = { certId: a.certId, memberFingerprint: a.memberFingerprint, reason: a.reason, revokedAt: now };
    if (idx >= 0) entries[idx] = row;
    else entries.push(row);
  }
  const listVersion = (current?.listVersion ?? 0) + 1;
  let list = gouJianCheXiaoBiao(
    {
      groupId: input.groupId,
      listVersion,
      entries,
      issuedAt: now,
      issuerFingerprint: input.signer.fingerprint,
      issuerPublicKey: input.signer.publicKey,
    },
    { now }
  );
  try {
    list = await signRevocationList(list, (bytes) => input.signer.sign(bytes));
  } catch (e) {
    return { ok: false, code: 'build-failed', detail: (e as Error).message };
  }
  return { ok: true, list, previousVersion: current?.listVersion ?? 0 };
}

/**
 * 吊销某个成员（踢人 / 私钥泄漏 / 换证的旧证书）。
 * 结果是一份**新的、已签名、版本 +1** 的吊销列表，并落到本机存储。
 */
export function chexiaoChengyuanZhengshu(input: {
  signer: ShenfenQianmingzhe;
  membership: MembershipStore;
  groupId: string;
  certId: string;
  memberFingerprint: string;
  reason: CheXiaoYuanYin;
  now?: number;
  expectation?: string;
}): Promise<{ ok: boolean; code: string; list?: CheXiaoBiao; listVersion?: number; previousVersion?: number; detail?: string }> {
  return input.membership.runExclusive(() => chexiaoChengyuanZhengshuShixian(input));
}

async function chexiaoChengyuanZhengshuShixian(input: {
  signer: ShenfenQianmingzhe;
  membership: MembershipStore;
  groupId: string;
  certId: string;
  memberFingerprint: string;
  reason: CheXiaoYuanYin;
  now?: number;
  expectation?: string;
}): Promise<{ ok: boolean; code: string; list?: CheXiaoBiao; listVersion?: number; previousVersion?: number; detail?: string }> {
  if (!REVOCATION_REASONS.includes(input.reason)) return { ok: false, code: 'bad-reason' };
  const goujian = await appendRevocationEntries({
    signer: input.signer,
    membership: input.membership,
    groupId: input.groupId,
    add: [{ certId: input.certId, memberFingerprint: input.memberFingerprint, reason: input.reason }],
    ...(typeof input.now === 'number' ? { now: input.now } : {}),
  });
  if (!goujian.ok) return goujian;
  const applied = input.membership.applyRevocationList(input.groupId, goujian.list, {
    ...(input.expectation ? { expectIssuerFingerprint: input.expectation } : {}),
  });
  if (!applied.ok) return { ok: false, code: applied.code, detail: applied.detail };
  return {
    ok: true,
    code: 'ok',
    list: goujian.list,
    listVersion: goujian.list.listVersion,
    previousVersion: goujian.previousVersion,
  };
}

export interface RotateMemberCertResult {
  ok: boolean;
  code: string;
  cert?: ChengYuanZhengShu;
  revocation?: CheXiaoBiao;
  verification?: LunHuanYanZhengJieGuo;
  detail?: string;
}

/**
 * **成员换证后重签成员证书** —— 这就是 §附五.1 第四层（兜底恢复）的落地。
 *
 * 流程（每一步都是必需的）：
 *  1. 本机（创建者）必须先有**该成员的旧证书** —— 否则"我认识的是谁"无从谈起
 *     （拿不到就 `no-existing-cert`，绝不凭空给一个新指纹发证书）；
 *  2. 用**旧公钥**验成员的换证声明（`verifyRotationDeclaration`：签名 + 新公钥指纹自洽 +
 *     代次严格递增 + 时间不在未来）；
 *  3. 签一张新证书：`memberFingerprint/newPublicKey` 来自声明，`supersedes = 旧 certId`，
 *     `memberId`/role/permissions **沿用旧证书**；
 *  4. 旧证书进**新版**吊销列表（`reason: 'rotation'`）—— 旧密钥从此连不进来，
 *     而新指纹因为持有有效证书 + 不在吊销名单里，照样是"原来那个人"。
 *
 * 注意：**声明是攻击者可控数据**，所以第 2 步的验签是硬门槛；`knownKeys` / `currentGeneration`
 * 由调用方从**本机留存**（对端名片 / 密钥环）给出，不能从声明里读。
 */
export function rotateMemberCertificate(input: {
  signer: ShenfenQianmingzhe;
  membership: MembershipStore;
  groupId: string;
  declaration: LunHuanShengMing;
  knownKeys?: YaoShiHuanTiaoMu[];
  currentGeneration?: number;
  ttlMs?: number;
  now?: number;
  clockSkewMs?: number;
  /** 显式指定新 certId（默认随机） */
  certId?: string;
}): Promise<RotateMemberCertResult> {
  return input.membership.runExclusive(() => rotateMemberCertificateImpl(input));
}

async function rotateMemberCertificateImpl(input: {
  signer: ShenfenQianmingzhe;
  membership: MembershipStore;
  groupId: string;
  declaration: LunHuanShengMing;
  knownKeys?: YaoShiHuanTiaoMu[];
  currentGeneration?: number;
  ttlMs?: number;
  now?: number;
  clockSkewMs?: number;
  /** 显式指定新 certId（默认随机） */
  certId?: string;
}): Promise<RotateMemberCertResult> {
  const jiuZhengShu = input.membership.certificateForFingerprint(input.groupId, input.declaration?.oldFingerprint ?? '');
  if (!jiuZhengShu) {
    return {
      ok: false,
      code: 'no-existing-cert',
      detail: `本机没有 ${input.declaration?.oldFingerprint ?? ''} 在该群的成员证书：无法认定"新指纹 = 原成员"`,
    };
  }
  const knownKeys = input.knownKeys ?? [
    { fingerprint: jiuZhengShu.memberFingerprint, publicKey: jiuZhengShu.memberPublicKey, generation: 0, current: false },
  ];
  const verification = verifyRotationDeclaration(input.declaration, {
    knownKeys,
    ...(typeof input.currentGeneration === 'number' ? { currentGeneration: input.currentGeneration } : {}),
    ...(typeof input.now === 'number' ? { now: input.now } : {}),
    clockSkewMs: typeof input.clockSkewMs === 'number' ? input.clockSkewMs : DEFAULT_CLOCK_SKEW_MS,
  });
  if (!verification.accepted) {
    return { ok: false, code: `declaration:${verification.reason}`, verification, detail: verification.detail };
  }
  const issued = await wentiChengyuanZhengshuShixian({
    signer: input.signer,
    membership: input.membership,
    groupId: input.groupId,
    memberFingerprint: input.declaration.newFingerprint,
    memberPublicKey: input.declaration.newPublicKey,
    supersedes: jiuZhengShu.certId,
    role: jiuZhengShu.role,
    permissions: jiuZhengShu.permissions,
    ...(jiuZhengShu.memberId ? { memberId: jiuZhengShu.memberId } : {}),
    ...(jiuZhengShu.displayName ? { displayName: jiuZhengShu.displayName } : {}),
    ...(input.certId ? { certId: input.certId } : {}),
    ...(input.ttlMs ? { ttlMs: input.ttlMs } : {}),
    ...(typeof input.now === 'number' ? { now: input.now } : {}),
  });
  if (!issued.ok || !issued.cert) return { ok: false, code: `issue:${issued.code}`, verification, detail: issued.detail };
  const revoked = await chexiaoChengyuanZhengshuShixian({
    signer: input.signer,
    membership: input.membership,
    groupId: input.groupId,
    certId: jiuZhengShu.certId,
    memberFingerprint: jiuZhengShu.memberFingerprint,
    reason: 'rotation',
    ...(typeof input.now === 'number' ? { now: input.now } : {}),
  });
  if (!revoked.ok || !revoked.list) {
    return { ok: false, code: `revoke:${revoked.code}`, cert: issued.cert, verification, detail: revoked.detail };
  }
  return { ok: true, code: 'ok', cert: issued.cert, revocation: revoked.list, verification };
}

/**
 * 人工恢复（创建者当面/其他渠道确认"这就是原来那个人"后重签）：
 * 不需要换证声明，但**必须沿用旧证书的 `memberId`**（或显式给出 `supersedes`），
 * 这样 `isSameMember` 才能推出"新指纹 = 原成员"。没有这两样之一就只是发一张新证书，
 * 与"恢复原成员身份"无关 —— 这时返回 `code: 'not-linked'` 让调用方确认自己知道后果。
 */
export function reissueMemberCertificateForRecovery(input: {
  signer: ShenfenQianmingzhe;
  membership: MembershipStore;
  groupId: string;
  oldFingerprint: string;
  newFingerprint: string;
  newPublicKey: string;
  ttlMs?: number;
  now?: number;
  revokeOld?: boolean;
  certId?: string;
  /** 显式要求"这确实是同一个人"（默认 true：没有链就不给恢复） */
  requireLink?: boolean;
}): Promise<RotateMemberCertResult & { linked?: boolean; memberId?: string }> {
  return input.membership.runExclusive(() => reissueMemberCertificateForRecoveryImpl(input));
}

async function reissueMemberCertificateForRecoveryImpl(input: {
  signer: ShenfenQianmingzhe;
  membership: MembershipStore;
  groupId: string;
  oldFingerprint: string;
  newFingerprint: string;
  newPublicKey: string;
  ttlMs?: number;
  now?: number;
  revokeOld?: boolean;
  certId?: string;
  /** 显式要求"这确实是同一个人"（默认 true：没有链就不给恢复） */
  requireLink?: boolean;
}): Promise<RotateMemberCertResult & { linked?: boolean; memberId?: string }> {
  const jiuZhengShu = input.membership.certificateForFingerprint(input.groupId, input.oldFingerprint);
  if (!jiuZhengShu) return { ok: false, code: 'no-existing-cert', detail: '本机没有旧证书，无法认定归属' };
  const requireLink = input.requireLink !== false;
  const memberId = jiuZhengShu.memberId ?? jiuZhengShu.certId;
  if (requireLink && !jiuZhengShu.memberId && !jiuZhengShu.certId) {
    return { ok: false, code: 'not-linked', detail: '旧证书没有可用于延续的成员标识' };
  }
  const issued = await wentiChengyuanZhengshuShixian({
    signer: input.signer,
    membership: input.membership,
    groupId: input.groupId,
    memberFingerprint: input.newFingerprint,
    memberPublicKey: input.newPublicKey,
    supersedes: jiuZhengShu.certId,
    memberId,
    role: jiuZhengShu.role,
    permissions: jiuZhengShu.permissions,
    ...(jiuZhengShu.displayName ? { displayName: jiuZhengShu.displayName } : {}),
    ...(input.certId ? { certId: input.certId } : {}),
    ...(input.ttlMs ? { ttlMs: input.ttlMs } : {}),
    ...(typeof input.now === 'number' ? { now: input.now } : {}),
  });
  if (!issued.ok || !issued.cert) return { ok: false, code: `issue:${issued.code}`, detail: issued.detail };
  let revocation: CheXiaoBiao | undefined;
  if (input.revokeOld !== false) {
    const revoked = await chexiaoChengyuanZhengshuShixian({
      signer: input.signer,
      membership: input.membership,
      groupId: input.groupId,
      certId: jiuZhengShu.certId,
      memberFingerprint: jiuZhengShu.memberFingerprint,
      reason: 'rotation',
      ...(typeof input.now === 'number' ? { now: input.now } : {}),
    });
    if (!revoked.ok) return { ok: false, code: `revoke:${revoked.code}`, cert: issued.cert, detail: revoked.detail };
    revocation = revoked.list;
  }
  const same = input.membership.isSameMember(input.groupId, input.oldFingerprint, input.newFingerprint);
  return { ok: true, code: 'ok', cert: issued.cert, revocation, linked: same.same, memberId };
}

/**
 * 收到对端（走鉴权通道）发来的吊销列表：**先按"这个对端是不是本群主"过滤，再验签 + 单调合并**。
 *
 * `fromFingerprint` 必须是**握手得到的对端指纹**（`SecureInboundMessage.peerFingerprint`），
 * **绝不能**用消息体里自称的签发者 —— 否则谁都能自称群主来发吊销名单。
 */
export function applyInboundRevocationUpdate(input: {
  membership: MembershipStore;
  groupId: string;
  list: CheXiaoBiao;
  fromFingerprint: string;
  /** 本机已知的群主（创建者）指纹；给定就要求 `fromFingerprint` 必须是他 */
  expectedIssuerFingerprint?: string;
}): { ok: boolean; code: string; changed?: boolean; listVersion?: number; detail?: string } {
  const expected = input.expectedIssuerFingerprint || input.membership.groupState(input.groupId)?.issuerFingerprint || '';
  if (!expected) {
    return { ok: false, code: 'unknown-issuer', detail: '本机不知道该群的创建者，无法判断这份吊销列表的来路' };
  }
  if (!zhiwenPipei(input.fromFingerprint, expected)) {
    return {
      ok: false,
      code: 'not-issuer',
      detail: `发来吊销列表的连接指纹不是本群创建者（${input.fromFingerprint} ≠ ${expected}）`,
    };
  }
  const applied = input.membership.applyRevocationList(input.groupId, input.list, {
    expectIssuerFingerprint: expected,
  });
  return {
    ok: applied.ok,
    code: applied.code,
    changed: applied.changed,
    listVersion: applied.listVersion,
    ...(applied.detail ? { detail: applied.detail } : {}),
  };
}

/** 结构化快照（IPC/UI 用；只有数据与枚举码，没有任何文案） */
export function membershipSnapshot(
  membership: MembershipStore | null,
  opts: { groupId?: string; now?: number } = {}
): {
  ok: boolean;
  schema: typeof MEMBERSHIP_FILE_SCHEMA;
  groups: Array<{
    groupId: string;
    issuerFingerprint: string;
    revocationListVersion: number;
    revokedCount: number;
    certs: Array<{
      certId: string;
      memberFingerprint: string;
      displayName: string;
      role: ChengYuanZhengShuJueSe;
      permissions: string[];
      issuedAt: number;
      expiresAt: number;
      supersedes: string;
      memberId: string;
      /** 本地时钟判定结果（不是证书自称） */
      valid: boolean;
      code: ChengYuanZhengShuMa;
      detail?: string;
    }>;
  }>;
} {
  const now = opts.now ?? Date.now();
  if (!membership) return { ok: false, schema: MEMBERSHIP_FILE_SCHEMA, groups: [] };
  const ids = opts.groupId ? [opts.groupId] : membership.listGroups();
  const groups = ids.map((groupId) => {
    const st = membership.groupState(groupId);
    const xiuding = st?.revocation ?? null;
    return {
      groupId,
      issuerFingerprint: st?.issuerFingerprint ?? '',
      revocationListVersion: xiuding?.listVersion ?? 0,
      revokedCount: xiuding?.entries.length ?? 0,
      certs: (st?.certs ?? []).map((c) => {
        const v = verifyMemberCertificate(c, {
          fingerprintOf: fingerprintFromPublicKey,
          clockSkewMs: DEFAULT_CLOCK_SKEW_MS,
          now,
          expectGroupId: groupId,
          ...(st?.issuerFingerprint ? { expectIssuerFingerprint: st.issuerFingerprint } : {}),
        });
        return {
          certId: c.certId,
          memberFingerprint: c.memberFingerprint,
          displayName: c.displayName ?? '',
          role: c.role,
          permissions: [...c.permissions],
          issuedAt: c.issuedAt,
          expiresAt: c.expiresAt,
          supersedes: c.supersedes ?? '',
          memberId: c.memberId ?? '',
          valid: v.ok,
          code: v.code,
          ...(v.detail ? { detail: v.detail } : {}),
        };
      }),
    };
  });
  return { ok: true, schema: MEMBERSHIP_FILE_SCHEMA, groups };
}

/** 便于验证脚本与 UI：把"这两个指纹是否同一成员"包一层（跨群） */
export function membershipSameMember(
  membership: MembershipStore | null,
  groupId: string,
  fpA: string,
  fpB: string
): { same: boolean; reason: string; rootA: string; rootB: string } {
  if (!membership) return { same: false, reason: 'no-membership-store', rootA: '', rootB: '' };
  return membership.isSameMember(groupId, fpA, fpB);
}

/** 与 sync-protocol 的默认容差必须一致（写在这里，好让验证脚本直接断言） */
export const MEMBERSHIP_SKEW_CHECK = { appShell: DEFAULT_CLOCK_SKEW_MS, protocol: MEMBERSHIP_CLOCK_SKEW_MS };
