/**
 * identity-provider —— 身份层 ↔ 组网层的**唯一接缝**（接线层，不含新协议）
 *
 * 这个文件只做三件事：
 *
 *  1. **指纹推导对齐**（`fingerprintDerivationForAppShell`）
 *     身份层（`identity.ts`）的指纹 = `base32(sha256(SPKI DER))` 前 20 位 + 1 位校验 + 短横分组；
 *     组网层（`@ccarmy/sync-protocol`）默认指纹 = `base32(sha256(raw 32B))`。
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
import fs from 'node:fs';
import path from 'node:path';
import {
  ed25519PublicKeyObject,
  ed25519RawFromSpkiDer,
  ed25519SpkiDerFromRaw,
  normalizeEd25519PublicKey,
  type FingerprintDerivation,
  type IdentityProvider,
  type NormalizedIdentity,
} from '@ccarmy/sync-protocol';
import {
  fingerprintFromPublicKey,
  keyObjectFromPrivateDer,
  type ContactCard,
  type PeerContactView,
} from './identity.js';
import {
  PEER_CONTACTS_SCHEMA,
  type IdentityStore,
  type UnlockState,
} from './identity-store.js';

/** 组网层用的指纹推导：raw 32B Ed25519 公钥 → 身份层指纹 */
export function fingerprintDerivationForAppShell(): FingerprintDerivation {
  return (raw32: Buffer): string =>
    fingerprintFromPublicKey(ed25519SpkiDerFromRaw(raw32).toString('base64'));
}

/** 无法签名时的类型化错误（**不允许**静默返回空签名） */
export type IdentitySignerErrorCode = 'identity-locked' | 'identity-missing' | 'identity-unusable';

export class IdentityUnavailableError extends Error {
  readonly code: IdentitySignerErrorCode;
  constructor(code: IdentitySignerErrorCode, message?: string) {
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
export function assertDerivationMatches(store: IdentityStore): DerivationCheck {
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
export interface SignerUnlockState {
  mode: UnlockState['mode'];
  unlocked: boolean;
  needsPassphrase: boolean;
  /** 是否真的能后台签名（= 现在调 sign() 不会抛 identity-locked） */
  signReady: boolean;
}

export interface IdentitySigner {
  /** 身份层指纹（线上表示） */
  readonly fingerprint: string;
  /** SPKI DER base64（公开信息，可直接给渲染进程） */
  readonly publicKey: string;
  /** 现在能否后台签名（真实判定：真的去解一次私钥，不缓存、不导出） */
  signReady(): boolean;
  unlockState(): SignerUnlockState | null;
  /** raw 64 字节 Ed25519 签名；不能签时抛 IdentityUnavailableError */
  sign(msg: Buffer): Promise<Buffer>;
  /** 校验任意公钥的签名；返回 null = 这次**没有**真的验过（公钥无法解释） */
  verify(msg: Buffer, sig: Buffer, pub: Buffer | string | Uint8Array): boolean | null;
}

export function createIdentitySigner(store: IdentityStore): IdentitySigner {
  const info = store.info();
  if (!info) {
    throw new IdentityUnavailableError('identity-missing', '本机身份不存在，无法构造签名者');
  }
  const fingerprint = info.fingerprint;
  const publicKey = info.publicKey;

  const signer: IdentitySigner = {
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

    unlockState(): SignerUnlockState | null {
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
export function createIdentityProvider(store: IdentityStore | IdentitySigner): IdentityProvider {
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

function isSigner(v: IdentityStore | IdentitySigner): v is IdentitySigner {
  return typeof (v as IdentitySigner).signReady === 'function';
}

/** 组网层启动/宣告前的门控结果 */
export interface SignableGate {
  ok: boolean;
  errorCode?: IdentitySignerErrorCode;
  /** 拿不到签名能力时，UI 就是靠这个提示"身份未解锁" */
  unlock?: SignerUnlockState | null;
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
    assertDerivationMatches(store);
    return { ok: true, unlock: u };
  } catch (e) {
    const code = (e as IdentityUnavailableError).code ?? 'identity-unusable';
    return { ok: false, errorCode: code, unlock: null, reason: (e as Error).message };
  }
}

/* ────────────────────── 本机已知联系人（名册 / presence 用） ────────────────────── */

/** 对端名片旁路文件（与 identity-store 的 peerFile() 同一份数据；schema 常量复用它的导出） */
function peerStoreFile(store: IdentityStore): string {
  return path.join(path.dirname(store.path()), 'peer-contacts.json');
}

/**
 * 本机 peer-contacts.json 里的指纹键。
 * ⚠️ `IdentityStore.readPeers()` 是私有的，这里按它的落盘 schema（PEER_CONTACTS_SCHEMA）读同一份文件，
 * 只取键名；每条的实际内容仍走 `store.peerContact(fp)`（含结算逻辑），不做第二份解析。
 */
export function peerContactKeys(store: IdentityStore | null): string[] {
  if (!store) return [];
  try {
    const raw = fs.readFileSync(peerStoreFile(store), 'utf8');
    const parsed = JSON.parse(raw) as { schema?: string; peers?: Record<string, unknown> };
    if (!parsed || typeof parsed !== 'object') return [];
    if (parsed.schema !== PEER_CONTACTS_SCHEMA) return [];
    const peers = parsed.peers;
    if (!peers || typeof peers !== 'object') return [];
    return Object.keys(peers).filter((k) => typeof k === 'string' && k.length > 0);
  } catch {
    return [];
  }
}

/** 已知联系人指纹集合（= 名册） */
export function knownContactFingerprints(store: IdentityStore | null): string[] {
  return peerContactKeys(store);
}

/**
 * 名册校验器：**只放行本机已知联系人**（+ 调用方显式加入的指纹，如刚 pin 过的地址）。
 * 握手层对 `roster(fp) === false` 的处理是 `not-authorized` 直接拒绝 —— 这正是我们要的 fail-closed。
 * 注意：调用方若给了 pin（`peerFingerprint`），也要同时把它加进名册，否则 pin 过了名册也会拒。
 */
export function createRosterChecker(
  store: IdentityStore | null,
  extra: string[] = []
): (fingerprint: string) => boolean {
  const allow = new Set<string>();
  for (const fp of knownContactFingerprints(store)) allow.add(fp);
  for (const fp of extra) if (typeof fp === 'string' && fp) allow.add(fp);
  return (fingerprint: string): boolean => {
    if (typeof fingerprint !== 'string' || !fingerprint) return false;
    if (allow.has(fingerprint)) return true;
    // 指纹是"短横分组"写法，比较时容忍大小写与短横差异
    const norm = (s: string): string => s.replace(/-/g, '').toLowerCase();
    const target = norm(fingerprint);
    for (const fp of allow) if (norm(fp) === target) return true;
    return false;
  };
}

/** 所有对端名片视图（UI 用「有谁换了证」；逐键走 store.peerContact 以复用冻结期结算） */
export function listPeerContactViews(store: IdentityStore | null, now: number = Date.now()): PeerContactView[] {
  const out: PeerContactView[] = [];
  for (const fp of peerContactKeys(store)) {
    const view = store?.peerContact(fp, now) ?? null;
    if (view) out.push(view);
  }
  return out;
}

/** 便于断言「签名就是 raw 64 字节」（验证脚本用；纯函数，不接触私钥） */
export function isRawEd25519Signature(sig: Buffer): boolean {
  return Buffer.isBuffer(sig) && sig.length === 64;
}

/* ────────────── 身份变更横幅的数据（UI 契约 identityChanges 的形状） ────────────── */

export interface ChangeAckRecord {
  level: 'dismiss' | 'verified';
  at: number;
  auditId: string;
}

export interface IdentityChangeEntry {
  id: string;
  ts: number;
  subjectId: string;
  subjectName: string;
  oldFingerprint: string;
  newFingerprint: string;
  generation: number;
  reason?: 'rotate' | 'compromised';
  /** 旧联系方式：**只能是本机留存值**（刻意放这里，好让验证脚本能断言它不来自声明） */
  previousCard: ContactCard | null;
  /** 换证时收到的新名片（本机留存）；没有则 null */
  pendingCard: ContactCard | null;
  contactFreezeUntil?: number;
  frozen?: boolean;
  remainingMs?: number;
  /** 该在哪些地方出现横幅。群成员表里没有指纹 → 本机无法归属，如实给 all */
  scopes: Array<{ kind: 'internal' | 'external' | 'extdm' | 'all'; id?: string }>;
  ack?: { dismissedAt?: number; verifiedAt?: number };
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
 */
export function buildIdentityChangeEntries(
  store: IdentityStore | null,
  opts: { now?: number; acks?: Record<string, ChangeAckRecord> } = {}
): IdentityChangeEntry[] {
  if (!store) return [];
  const now = opts.now ?? Date.now();
  const acks = opts.acks ?? {};
  const mkAck = (id: string): IdentityChangeEntry['ack'] => {
    const a = acks[id];
    if (!a) return undefined;
    return a.level === 'verified' ? { verifiedAt: a.at } : { dismissedAt: a.at };
  };
  const changes: IdentityChangeEntry[] = [];

  // ① 本机换证
  const info = store.info();
  const history = store.contactCardHistory();
  const freeze = store.contactFreeze(now);
  if (info) {
    for (const d of store.declarations()) {
      if (d.kind !== 'ccarmy.identity.rotation') continue;
      const id = `self:${d.oldFingerprint}->${d.newFingerprint}`;
      // 旧名片 = 换证时刻之前、本机留存的最后一条（声明里没有联系方式）
      const prev = history.filter((h) => h.at <= d.issuedAt).slice(-1)[0]?.card ?? null;
      const entry: IdentityChangeEntry = {
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
        scopes: [{ kind: 'all' }],
      };
      const ack = mkAck(id);
      if (ack) entry.ack = ack;
      changes.push(entry);
    }
  }

  // ② 对端换证
  const views = listPeerContactViews(store, now);
  for (const view of views) {
    if (!view.receivedAt) continue;
    const pair = views.filter((v) => v.receivedAt === view.receivedAt);
    let newest = view;
    for (const v of pair) if (v.generation > newest.generation) newest = v;
    if (newest !== view) continue; // 旧条目不再单独出横幅
    const oldest = pair.find((v) => v !== newest);
    const id = `peer:${newest.fingerprint}:${newest.receivedAt}`;
    const entry: IdentityChangeEntry = {
      id,
      ts: newest.receivedAt,
      subjectId: newest.fingerprint,
      subjectName: '',
      // 旧指纹来自本机留存条目（不是声明）
      oldFingerprint: oldest?.fingerprint ?? '',
      newFingerprint: newest.fingerprint,
      generation: newest.generation,
      reason: 'rotate',
      previousCard: newest.previousCard ?? null,
      pendingCard: newest.pendingCard ?? null,
      contactFreezeUntil: newest.contactFreezeUntil,
      frozen: newest.frozen,
      remainingMs: newest.remainingMs,
      scopes: [{ kind: 'all' }],
    };
    const ack = mkAck(id);
    if (ack) entry.ack = ack;
    changes.push(entry);
  }

  return changes.sort((a, b) => b.ts - a.ts);
}
