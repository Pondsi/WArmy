/**
 * 身份存储（ADR 003 附五 / 附五.1 第 1 层）—— 私钥**加密落盘**，绝不明文
 *
 * 磁盘布局（`<userData>/identity/identity.json`）：
 *   identity   —— 公开部分（指纹 / 公钥 / 代次 / 名片 / 退役公钥 / 声明），可以给渲染进程看
 *   keys.privateKey —— 身份私钥（PKCS8 DER）用 **DEK** 做 AES-256-GCM 加密
 *   keys.dekOs  —— DEK 的 **OS 钥匙串包裹**（Electron `safeStorage`：Windows DPAPI / macOS Keychain）
 *   keys.dekPass—— DEK 的 **口令包裹**（scrypt 派生 KEK 再 AES-256-GCM）
 *
 * 为什么是"DEK + 两种包裹"而不是二选一：
 *   - 只有 safeStorage 可用时：不用每次启动让用户输口令（重启后能自己认出自己），
 *     且**文件被单独拷走没用**（DPAPI/Keychain 绑定本机本账号）；
 *   - 启用口令后：**文件 + 同一台机器都不够**，必须知道口令（附五.1 第一层"投入产出比最高的一条"），
 *     所以 `setPassphrase` 会**丢掉 dekOs**（没有旁路）。代价必须对用户讲清：
 *     **口令忘了 = 身份没了**，产品无服务器、不存在"找回/补发"（附三 C6）。
 *   - 两者都不可用时：**拒绝落盘明文私钥**（宁可报错让用户设口令），
 *     而不是像老代码那样回退 base64（那等于把私钥裸放磁盘）。
 *
 * 换证后的密钥处理遵守附三.3：**保公钥、丢私钥** —— 旧公钥进 `retiredKeys` 以便继续验证历史签名。
 * ⚠️ 代次规则只防回滚、不防抢占，见 identity.ts 的 GENERATION_RULE_NOTE。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { readJsonFileQuarantine, writeJsonAtomicSafe } from './atomic-json.js';
import { keyPairFromCredential, isValidCredential } from './credential.js';
import {
  MEMBER_CERT_ROLES,
  MEMBER_CERT_SCHEMA,
  MEMBERSHIP_CLOCK_SKEW_MS,
  REVOCATION_LIST_SCHEMA,
  REVOCATION_REASONS,
  lianShiZhiWen,
  moRenChengYuanZhiWen,
  isSameMember,
  verifyAndApplyRevocationList,
  verifyMemberCertificate,
  type ChengYuanZhengShuMa,
  type ChengYuanZhengShu,
  type quChengYuanZhiWen,
  type ChengYuanYanZhengXuanXiang,
  type CheXiaoYingYongJieGuo,
  type CheXiaoTiaoMu,
  type CheXiaoBiao,
  type CheXiaoBiaoMa,
} from '@warmy/sync-protocol';
import {
  IDENTITY_ALGO,
  IDENTITY_SCHEMA,
  KeyRingEntry,
  ContactCard,
  ContactCardVersion,
  ContactFreezeState,
  IdentityDeclaration,
  IdentityRecord,
  PeerContactState,
  PeerContactView,
  RetiredKey,
  RotationDeclaration,
  RotationVerifyOptions,
  RotationVerifyResult,
  RevocationVerifyResult,
  SignedPayload,
  VerifyResult,
  cloneContactCard,
  contactCardHistory,
  contactFreezeState,
  createIdentity,
  createPeerContact,
  fingerprintFromPublicKey,
  fingerprintMatches,
  normalizeFingerprint,
  keyObjectFromPublicB64,
  keyObjectFromPrivateDer,
  keyRing,
  peerContactOnCard,
  peerContactOnRotation,
  peerContactConfirm,
  peerContactSettle,
  peerContactView,
  privateKeyToDer,
  publicKeyOfPrivate,
  publicKeyToB64,
  rotateIdentity,
  signWithIdentity,
  verifyRevocationDeclaration,
  verifyRotationDeclaration,
  verifyByFingerprint,
  verifySignedPayload,
  GENERATION_RULE_NOTE,
  currentContactCard,
} from './identity.js';

export const IDENTITY_FILE_SCHEMA = 'warmy.identity.file.v1' as const;
export const IDENTITY_BACKUP_SCHEMA = 'warmy.identity.backup.v1' as const;
/** 接收方侧的对端名片状态（本机各自判定；不用任何广播的标志） */
export const PEER_CONTACTS_SCHEMA = 'warmy.peer-contacts.v1' as const;

/** scrypt 参数（约 40ms/次；只在上锁/解锁/导出时跑，不在启动热路径上） */
const SCRYPT = { N: 16384, r: 8, p: 1, keyLen: 32, maxmem: 64 * 1024 * 1024 } as const;

// ── 加解密原语 ──

interface EncryptedBlob {
  v: 1;
  alg: 'aes-256-gcm';
  iv: string;
  tag: string;
  ct: string;
}

function b64(b: Buffer): string {
  return b.toString('base64');
}

function aesGcmEncrypt(key: Buffer, plain: Buffer): EncryptedBlob {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return { v: 1, alg: 'aes-256-gcm', iv: b64(iv), tag: b64(c.getAuthTag()), ct: b64(ct) };
}

/** 认证失败（口令错 / 数据被改）→ 抛错，调用方翻成 bad-passphrase */
function aesGcmDecrypt(key: Buffer, blob: EncryptedBlob): Buffer {
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'base64'));
  d.setAuthTag(Buffer.from(blob.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(blob.ct, 'base64')), d.final()]);
}

function scryptKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.scryptSync(passphrase, salt, SCRYPT.keyLen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem });
}

interface DekWrapPass {
  v: 1;
  kdf: 'scrypt';
  salt: string;
  N: number;
  r: number;
  p: number;
  keyLen: number;
  blob: EncryptedBlob;
}

function wrapDekWithPassphrase(dek: Buffer, passphrase: string): DekWrapPass {
  const salt = crypto.randomBytes(16);
  const kek = scryptKey(passphrase, salt);
  return { v: 1, kdf: 'scrypt', salt: b64(salt), N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, keyLen: SCRYPT.keyLen, blob: aesGcmEncrypt(kek, dek) };
}

function unwrapDekWithPassphrase(wrap: DekWrapPass, passphrase: string): Buffer {
  const kek = crypto.scryptSync(passphrase, Buffer.from(wrap.salt, 'base64'), wrap.keyLen || SCRYPT.keyLen, {
    N: wrap.N || SCRYPT.N,
    r: wrap.r || SCRYPT.r,
    p: wrap.p || SCRYPT.p,
    maxmem: SCRYPT.maxmem,
  });
  return aesGcmDecrypt(kek, wrap.blob);
}

// ── OS 钥匙串 ──

/**
 * OS 级密钥保护（默认实现是 Electron safeStorage）。
 * 抽成接口是为了**可注入**：验证脚本跑在纯 Node 里（没有 Electron），
 * 用一个显式的替身来区分"有 OS 保护"与"完全没保护"两条路径，
 * 而不是让真实 safeStorage 在测试里静默失效。
 */
export interface OsKeyProtector {
  /** 是否可用（不可用时**不允许**明文落盘） */
  available(): boolean;
  label(): string;
  protect(plain: Buffer): Buffer;
  unprotect(cipher: Buffer): Buffer;
}

/**
 * Electron safeStorage 实现。
 *
 * ⚠️ 用 `createRequire` 而不是裸 `require(...)`：本项目是 ESM（package.json type=module），
 * ESM 模块里裸 `require` 是 ReferenceError —— secure-keys.ts 就栽在这里，
 * 它的 try/catch 把 ReferenceError 吞掉后**静默回退 base64**，等于明文落盘。
 * 这里显式拿 require，且失败时**报告不可用**，绝不静默降级。
 */
export function electronSafeStorageProtector(): OsKeyProtector {
  const load = (): { isEncryptionAvailable(): boolean; encryptString(s: string): Buffer; decryptString(b: Buffer): string } | null => {
    try {
      const req = createRequire(import.meta.url);
      const mod = req('electron') as { safeStorage?: unknown } | undefined;
      const ss = mod?.safeStorage as
        | { isEncryptionAvailable?: () => boolean; encryptString?: (s: string) => Buffer; decryptString?: (b: Buffer) => string }
        | undefined;
      if (ss && typeof ss.isEncryptionAvailable === 'function' && typeof ss.encryptString === 'function' && typeof ss.decryptString === 'function') {
        return ss as { isEncryptionAvailable(): boolean; encryptString(s: string): Buffer; decryptString(b: Buffer): string };
      }
    } catch {
      /* 非 Electron 环境（纯 Node 脚本 / 打包缺失）→ 视为不可用 */
    }
    return null;
  };
  return {
    available(): boolean {
      const ss = load();
      if (!ss) return false;
      try {
        return ss.isEncryptionAvailable() === true;
      } catch {
        return false;
      }
    },
    label(): string {
      return load() ? 'safeStorage' : 'safeStorage-unavailable';
    },
    protect(plain: Buffer): Buffer {
      const ss = load();
      if (!ss || !ss.isEncryptionAvailable()) throw new Error('safeStorage unavailable');
      // safeStorage 只吃字符串：DEK 是随机字节，用 base64 无损往返
      return ss.encryptString(b64(plain));
    },
    unprotect(cipher: Buffer): Buffer {
      const ss = load();
      if (!ss || !ss.isEncryptionAvailable()) throw new Error('safeStorage unavailable');
      return Buffer.from(ss.decryptString(cipher), 'base64');
    },
  };
}

/** 显式的"没有 OS 保护"：只能配合口令使用（验证脚本用它跑无 OS 保护的路径） */
export function nullProtector(): OsKeyProtector {
  return {
    available: () => false,
    label: () => 'none',
    protect: () => {
      throw new Error('no os protection');
    },
    unprotect: () => {
      throw new Error('no os protection');
    },
  };
}

// ── 文件结构 ──

interface IdentityFile {
  schema: typeof IDENTITY_FILE_SCHEMA;
  identity: IdentityRecord;
  protection: { os: boolean; passphrase: boolean; osLabel: string };
  keys: {
    privateKey: EncryptedBlob;
    /** safeStorage 包裹的 DEK（base64）；启用口令时为 null */
    dekOs: string | null;
    /** 口令包裹的 DEK；未启用口令时为 null */
    dekPass: DekWrapPass | null;
  };
  updatedAt: number;
}

export type IdentityLoadError =
  | 'not-found'
  | 'corrupt'
  | 'unsupported-schema'
  | 'no-protection-available'
  | 'passphrase-required'
  | 'bad-passphrase'
  | 'unlock-failed'
  | 'key-mismatch';

export interface IdentityInfo {
  alias: string;
  fingerprint: string;
  generation: number;
  algo: typeof IDENTITY_ALGO;
  createdAt: number;
  updatedAt: number;
  contactCard: ContactCard;
  /** 本机的名片历史（旧/新并列展示用；**不来自任何对外声明**） */
  cardHistory: ContactCardVersion[];
  /** 联系信息冻结期截止时刻（0 = 未冻结；换证后 7 天） */
  contactFreezeUntil: number;
  contactFrozen: boolean;
  /** SPKI DER base64（公开信息，可以给渲染进程） */
  publicKey: string;
  retiredKeys: RetiredKey[];
  declarationCount: number;
  /** 口令保护是否已启用 */
  passphraseProtected: boolean;
  /** OS 钥匙串保护是否可用 */
  osProtected: boolean;
  osLabel: string;
  /** 本次会话是否已解开私钥 */
  unlocked: boolean;
}

export interface UnlockState {
  /** os = 由 OS 钥匙串自动解锁；passphrase = 需要口令 */
  mode: 'os' | 'passphrase' | 'none';
  unlocked: boolean;
  needsPassphrase: boolean;
  osAvailable: boolean;
  osLabel: string;
}

export interface IdentityStoreOptions {
  protector?: OsKeyProtector;
  /** 审计回调（主进程传 audit.log）：换证 / 导出 / 解锁失败都记一条 */
  onAudit?: (op: string, detail?: unknown) => void;
}

/** 支持的加载/操作结果 */
type Ok<T> = { ok: true } & T;
type Err = { ok: false; error: IdentityLoadError | string; message?: string };

export class IdentityStore {
  private protector: OsKeyProtector;
  private onAudit: (op: string, detail?: unknown) => void;
  /** 会话内解开的 DEK（只在主进程内存里，不落盘） */
  private sessionDek: Buffer | null = null;

  constructor(
    private file: string,
    opts: IdentityStoreOptions = {},
  ) {
    this.protector = opts.protector || electronSafeStorageProtector();
    this.onAudit = opts.onAudit || (() => undefined);
  }

  /** 磁盘上的身份文件路径（**不暴露给渲染进程**） */
  path(): string {
    return this.file;
  }

  exists(): boolean {
    try {
      return fs.existsSync(this.file);
    } catch {
      return false;
    }
  }

  private readFile(): { file: IdentityFile | null; corrupt: boolean } {
    if (!this.exists()) return { file: null, corrupt: false };
    const parsed = readJsonFileQuarantine<IdentityFile | null>(this.file, null);
    if (!parsed || typeof parsed !== 'object') return { file: null, corrupt: true };
    if (parsed.schema !== IDENTITY_FILE_SCHEMA || !parsed.identity || !parsed.keys) return { file: null, corrupt: true };
    return { file: parsed, corrupt: false };
  }

  // ── 只读信息（不需要私钥；渲染进程随时可看） ──

  info(): IdentityInfo | null {
    const { file } = this.readFile();
    if (!file) return null;
    const i = file.identity;
    const freeze = contactFreezeState(i.contactFreezeUntil);
    return {
      alias: i.alias,
      fingerprint: i.fingerprint,
      generation: i.generation,
      algo: i.algo,
      createdAt: i.createdAt,
      updatedAt: i.updatedAt,
      contactCard: cloneContactCard(i.contactCard),
      cardHistory: contactCardHistory(i),
      contactFreezeUntil: freeze.contactFreezeUntil,
      contactFrozen: freeze.frozen,
      publicKey: i.publicKey,
      retiredKeys: i.retiredKeys.map((r) => ({ ...r })),
      declarationCount: i.declarations.length,
      passphraseProtected: file.protection.passphrase,
      osProtected: file.protection.os,
      osLabel: file.protection.osLabel,
      unlocked: this.sessionDek !== null || (file.protection.os && !file.protection.passphrase),
    };
  }

  unlockState(): UnlockState {
    const { file } = this.readFile();
    const osAvailable = this.protector.available();
    if (!file) {
      return { mode: 'none', unlocked: false, needsPassphrase: false, osAvailable, osLabel: this.protector.label() };
    }
    const needsPassphrase = file.protection.passphrase;
    return {
      mode: needsPassphrase ? 'passphrase' : file.protection.os ? 'os' : 'none',
      unlocked: this.sessionDek !== null || (!needsPassphrase && file.protection.os),
      needsPassphrase,
      osAvailable,
      osLabel: file.protection.osLabel,
    };
  }

  /** 密钥环：当前公钥 + 全部退役公钥（联系人侧验历史签名用） */
  keyRing(): KeyRingEntry[] {
    const { file } = this.readFile();
    return file ? keyRing(file.identity) : [];
  }

  declarations(): IdentityDeclaration[] {
    const { file } = this.readFile();
    return file ? [...file.identity.declarations] : [];
  }

  /**
   * 换证 / 作废时间线（从只追加的声明里派生，供横幅与审计页展示）。
   * ⚠️ 不含任何联系方式：换证声明里本来就没有，
   * 旧名片由调用方从 `contactCardHistory()`（本机留存）取。
   */
  timeline(): Array<{ ts: number; op: string; detail: Record<string, unknown> }> {
    const out: Array<{ ts: number; op: string; detail: Record<string, unknown> }> = [];
    for (const d of this.declarations()) {
      if (d.kind === 'warmy.identity.rotation') {
        out.push({
          ts: d.issuedAt,
          op: 'identity.rotate',
          detail: {
            from: d.oldFingerprint,
            to: d.newFingerprint,
            generation: d.generation,
            previousGeneration: d.previousGeneration,
            reason: d.reason ?? '',
            /** 声明里没有联系方式 → 旧名片要从本机留存历史取（附"改自本机留存"规则） */
            previousCardSource: 'local-history',
          },
        });
      } else {
        out.push({
          ts: d.issuedAt,
          op: 'identity.revoke',
          detail: { fingerprint: d.fingerprint, supersededBy: d.supersededBy ?? '', reason: d.reason ?? '' },
        });
      }
    }
    return out.sort((a, b) => a.ts - b.ts);
  }

  /** 本机名片历史（旧/新并列展示用；换证横幅展示的"旧联系方式"就取自这里） */
  contactCardHistory(): ContactCardVersion[] {
    const { file } = this.readFile();
    return file ? contactCardHistory(file.identity) : [];
  }

  /** 本机身份的联系信息冻结期状态（换证后 7 天） */
  contactFreeze(now: number = Date.now()): ContactFreezeState {
    const { file } = this.readFile();
    return contactFreezeState(file?.identity.contactFreezeUntil, now);
  }

  currentContactCard(): ContactCard | null {
    const { file } = this.readFile();
    return file ? currentContactCard(file.identity) : null;
  }

  // ── 首次运行即生成 ──

  /**
   * 幂等初始化：文件不存在才创建。
   * ⚠️ 文件**存在但损坏**时**绝不重建**（重建 = 静默把身份换了，联系人全部对不上），
   * 而是返回 corrupt 让上层去处理/恢复。
   */
  ensureIdentity(
    alias: string,
    contactCard?: ContactCard,
    opts: { passphrase?: string; credential?: string } = {},
  ): { ok: true; created: boolean; info: IdentityInfo } | Err {
    const { file, corrupt } = this.readFile();
    if (file) return { ok: true, created: false, info: this.info()! };
    if (corrupt) {
      return { ok: false, error: 'corrupt', message: '身份文件存在但无法解析；为免静默换掉身份，此处不覆盖重建（文件已隔离为 .corrupt-*）' };
    }
    const created = this.createWith(alias, contactCard, opts.passphrase, opts.credential);
    if (!created.ok) return created;
    return { ok: true, created: true, info: this.info()! };
  }

  /** 真正落地一个新身份（内部；不做存在性检查，用于恢复/导入） */
  private createWith(
    alias: string,
    contactCard: ContactCard | undefined,
    passphrase?: string,
    credential?: string,
  ): Ok<object> | Err {
    /**
     * 有凭证 ⇒ **由凭证派生**密钥对（同一凭证在任何设备得到同一身份，见 credential.ts）；
     * 没有凭证 ⇒ 老路径（本机随机生成）。这样"ID 即私钥、公钥即身份"成立，
     * 且不影响已存在的旧身份（它们不会走这里）。
     */
    let derived: ReturnType<typeof keyPairFromCredential> | null = null;
    if (credential && isValidCredential(credential)) {
      try { derived = keyPairFromCredential(credential); } catch { derived = null; }
    }
    const { identity, keyPair } = createIdentity({ alias, contactCard, ...(derived ? { keyPair: derived } : {}) });
    const dek = crypto.randomBytes(32);
    const privateKey = keyPair.privateKeyDer;
    const keys: IdentityFile['keys'] = {
      privateKey: aesGcmEncrypt(dek, privateKey),
      dekOs: null,
      dekPass: null,
    };
    let osProtected = false;
    if (passphrase) {
      keys.dekPass = wrapDekWithPassphrase(dek, passphrase);
    } else if (this.protector.available()) {
      try {
        keys.dekOs = b64(this.protector.protect(dek));
        osProtected = true;
      } catch (e) {
        return { ok: false, error: 'no-protection-available', message: e instanceof Error ? e.message : 'os protect failed' };
      }
    } else {
      // 没有 OS 保护也没有口令 → 宁可拒绝，也不把私钥明文写盘
      return {
        ok: false,
        error: 'no-protection-available',
        message: 'OS 钥匙串不可用且未设置口令：拒绝以明文形式落盘身份私钥，请先设置口令',
      };
    }
    const file: IdentityFile = {
      schema: IDENTITY_FILE_SCHEMA,
      identity,
      protection: { os: osProtected, passphrase: !!passphrase, osLabel: this.protector.label() },
      keys,
      updatedAt: Date.now(),
    };
    const w = writeJsonAtomicSafe(this.file, file);
    if (!w.ok) return { ok: false, error: w.error || 'write failed' };
    this.sessionDek = dek;
    this.onAudit('identity.create', { fingerprint: identity.fingerprint, generation: identity.generation, alias: identity.alias, protection: osProtected ? 'os' : 'passphrase' });
    return { ok: true };
  }

  // ── 解锁 ──

  private resolveDek(passphrase?: string): { ok: true; dek: Buffer } | { ok: false; error: IdentityLoadError; message?: string } {
    const { file, corrupt } = this.readFile();
    if (!file) return { ok: false, error: corrupt ? 'corrupt' : 'not-found' };
    if (this.sessionDek) return { ok: true, dek: this.sessionDek };
    if (file.protection.passphrase) {
      if (!file.keys.dekPass) return { ok: false, error: 'corrupt', message: '标记了口令保护但缺少口令包裹' };
      if (!passphrase) return { ok: false, error: 'passphrase-required', message: '该身份受口令保护，需要口令才能解锁私钥' };
      try {
        return { ok: true, dek: unwrapDekWithPassphrase(file.keys.dekPass, passphrase) };
      } catch {
        this.onAudit('identity.unlock.failed', { fingerprint: file.identity.fingerprint });
        // 认证标签校验失败 = 口令错（或文件被改）
        return { ok: false, error: 'bad-passphrase', message: '口令不正确' };
      }
    }
    if (file.keys.dekOs) {
      if (!this.protector.available()) {
        return { ok: false, error: 'no-protection-available', message: `OS 钥匙串不可用（${this.protector.label()}），无法解开私钥` };
      }
      try {
        return { ok: true, dek: this.protector.unprotect(Buffer.from(file.keys.dekOs, 'base64')) };
      } catch (e) {
        return { ok: false, error: 'unlock-failed', message: e instanceof Error ? e.message : 'unprotect failed' };
      }
    }
    return { ok: false, error: 'no-protection-available', message: '身份文件既无 OS 包裹也无口令包裹' };
  }

  /** 会话内解锁（口令模式必需；OS 模式可无参调用做一次校验） */
  unlock(passphrase?: string): { ok: true } | { ok: false; error: IdentityLoadError; message?: string } {
    const r = this.resolveDek(passphrase);
    if (!r.ok) return r;
    // 顺手校验 DEK 真能解出配得上该指纹的私钥（防"换了文件/换了 blob"）
    const loaded = this.loadWith(r.dek);
    if (!loaded.ok) return loaded;
    this.sessionDek = r.dek;
    return { ok: true };
  }

  lock(): void {
    this.sessionDek = null;
  }

  private loadWith(dek: Buffer): { ok: true; identity: IdentityRecord; privateKeyDer: Buffer } | { ok: false; error: IdentityLoadError; message?: string } {
    const { file } = this.readFile();
    if (!file) return { ok: false, error: 'not-found' };
    let der: Buffer;
    try {
      der = aesGcmDecrypt(dek, file.keys.privateKey);
    } catch {
      return { ok: false, error: 'unlock-failed', message: '私钥密文解不开（DEK 不对或文件被改）' };
    }
    try {
      const priv = keyObjectFromPrivateDer(der);
      const pub = publicKeyToB64(publicKeyOfPrivate(priv));
      if (fingerprintFromPublicKey(pub) !== file.identity.fingerprint) {
        return { ok: false, error: 'key-mismatch', message: '私钥与身份指纹不匹配（文件被替换过？）' };
      }
      return { ok: true, identity: file.identity, privateKeyDer: der };
    } catch {
      return { ok: false, error: 'corrupt', message: '私钥无法解析' };
    }
  }

  /**
   * 加载私钥（**只在主进程内存里**；渲染进程永远拿不到私钥，见 identity-backup-export）。
   */
  load(passphrase?: string): { ok: true; identity: IdentityRecord; privateKeyDer: Buffer } | { ok: false; error: IdentityLoadError; message?: string } {
    const r = this.resolveDek(passphrase);
    if (!r.ok) return r;
    const loaded = this.loadWith(r.dek);
    if (loaded.ok) this.sessionDek = r.dek;
    return loaded;
  }

  // ── 签名 / 验签 ──

  sign(payload: string, opts: { domain?: string; passphrase?: string } = {}): { ok: true; signed: SignedPayload } | { ok: false; error: string } {
    const loaded = this.load(opts.passphrase);
    if (!loaded.ok) return { ok: false, error: loaded.error };
    const priv = keyObjectFromPrivateDer(loaded.privateKeyDer);
    // 签名后立刻丢私钥引用（不缓存 KeyObject）
    return { ok: true, signed: signWithIdentity(priv, loaded.identity, payload, { domain: opts.domain }) };
  }

  /** 用本机身份的公钥验签（当前或退役指纹都能验） */
  verify(payload: string, signature: string, fingerprint?: string): VerifyResult {
    const { file } = this.readFile();
    if (!file) return { ok: false, reason: 'malformed', fingerprint: '', detail: '本机身份不存在' };
    const fp = fingerprint || file.identity.fingerprint;
    return verifyByFingerprint(fp, payload, signature, keyRing(file.identity));
  }

  verifySigned(signed: SignedPayload): VerifyResult {
    const { file } = this.readFile();
    if (!file) return { ok: false, reason: 'malformed', fingerprint: '', detail: '本机身份不存在' };
    return verifySignedPayload(signed, keyRing(file.identity));
  }

  // ── 名片 ──

  /**
   * 更新联系资料（**不换证、不动密钥、不加代次**）。
   * ⚠️ 换证后 7 天**冻结期**内一律拒绝（`contact-frozen`）：
   * 否则被偷了钥匙的人可以"抢先换证 + 立刻把联系方式改成自己的"一步到位。
   */
  setContactCard(
    card: ContactCard,
    opts: { passphrase?: string; now?: number } = {},
  ): { ok: true; info: IdentityInfo } | { ok: false; error: string; contactFreezeUntil?: number; remainingMs?: number } {
    const { file } = this.readFile();
    if (!file) return { ok: false, error: 'not-found' };
    const now = opts.now ?? Date.now();
    const freeze = contactFreezeState(file.identity.contactFreezeUntil, now);
    if (freeze.frozen) {
      this.onAudit('identity.card.frozen', { fingerprint: file.identity.fingerprint, until: freeze.untilIso, remainingMs: freeze.remainingMs });
      return {
        ok: false,
        error: 'contact-frozen',
        contactFreezeUntil: freeze.contactFreezeUntil,
        remainingMs: freeze.remainingMs,
      };
    }
    const loaded = this.load(opts.passphrase); // 需要解开私钥才能重写文件里的密文段；顺带确认身份可用
    if (!loaded.ok) return { ok: false, error: loaded.error };
    const nextCard: ContactCard = { ...cloneContactCard(card), updatedAt: now };
    const next: IdentityFile = {
      ...file,
      identity: {
        ...file.identity,
        contactCard: nextCard,
        // 走到这里说明冻结期已结束（或从未冻结）→ 清掉过期标记，语义干净：0 = 未冻结
        contactFreezeUntil: 0,
        cardHistory: [...(file.identity.cardHistory || []), { card: cloneContactCard(nextCard), at: now, note: 'updated' as const }],
        updatedAt: now,
      },
      updatedAt: now,
    };
    const w = writeJsonAtomicSafe(this.file, next);
    if (!w.ok) return { ok: false, error: w.error || 'write failed' };
    this.onAudit('identity.card.update', {
      fingerprint: next.identity.fingerprint,
      ...(card.email ? { hasEmail: true } : {}),
      ...(card.phone ? { hasPhone: true } : {}),
      /** 本机留存了旧值，横幅可以并列展示 */
      previousCard: contactCardHistory(file.identity).slice(-1)[0]?.card ?? null,
    });
    return { ok: true, info: this.info()! };
  }

  // ── 口令保护 ──

  /**
   * 启用口令保护：给 DEK 加口令包裹，并**丢掉 OS 包裹**（这样"偷到文件"不够，
   * 必须知道口令 —— 附五.1 第一层）。代价：口令忘了就找不回来，必须提前告知用户。
   */
  setPassphrase(passphrase: string, opts: { currentPassphrase?: string } = {}): { ok: true; info: IdentityInfo } | { ok: false; error: string } {
    if (!passphrase || passphrase.length < 8) return { ok: false, error: 'passphrase-too-short(>=8)' };
    const { file } = this.readFile();
    if (!file) return { ok: false, error: 'not-found' };
    const r = this.resolveDek(opts.currentPassphrase);
    if (!r.ok) return { ok: false, error: r.error };
    const next: IdentityFile = {
      ...file,
      protection: { os: false, passphrase: true, osLabel: this.protector.label() },
      keys: { ...file.keys, dekOs: null, dekPass: wrapDekWithPassphrase(r.dek, passphrase) },
      updatedAt: Date.now(),
    };
    const w = writeJsonAtomicSafe(this.file, next);
    if (!w.ok) return { ok: false, error: w.error || 'write failed' };
    this.sessionDek = r.dek;
    this.onAudit('identity.passphrase.enable', { fingerprint: next.identity.fingerprint });
    return { ok: true, info: this.info()! };
  }

  // ── 换证 ──

  /**
   * 主动轮换（附五.2 第 1 步 + 需求更正）：新密钥对、代次 +1、
   * 用**旧私钥**签迁移声明（**不含任何联系方式**）与作废声明，并开启 7 天联系信息冻结期。
   * 返回的 `previousCard` 取自**本机留存历史**（横幅展示旧联系方式用，不从声明读）。
   */
  rotate(payload: { reason?: string; passphrase?: string; now?: number } = {}):
    | { ok: true; info: IdentityInfo; declaration: RotationDeclaration; revocation: IdentityDeclaration; previousCard: ContactCard; contactFreezeUntil: number }
    | { ok: false; error: string } {
    const { file } = this.readFile();
    if (!file) return { ok: false, error: 'not-found' };
    const loaded = this.load(payload.passphrase);
    if (!loaded.ok) return { ok: false, error: loaded.error };
    const oldFingerprint = loaded.identity.fingerprint;
    const out = rotateIdentity({
      identity: loaded.identity,
      privateKey: keyObjectFromPrivateDer(loaded.privateKeyDer),
      ...(payload.reason ? { reason: payload.reason } : {}),
      ...(typeof payload.now === 'number' ? { now: payload.now } : {}),
    });
    const dek = this.sessionDek;
    if (!dek) return { ok: false, error: 'unlock-required' };
    const now = payload.now ?? Date.now();
    const next: IdentityFile = {
      ...file,
      identity: out.identity,
      keys: { ...file.keys, privateKey: aesGcmEncrypt(dek, privateKeyToDer(out.keyPair.privateKey)) },
      updatedAt: now,
    };
    const w = writeJsonAtomicSafe(this.file, next);
    if (!w.ok) return { ok: false, error: w.error || 'write failed' };
    this.onAudit('identity.rotate', {
      from: oldFingerprint,
      to: out.identity.fingerprint,
      generation: out.identity.generation,
      reason: payload.reason ?? '',
      /** 冻结期由本机判定（本机时钟），声明里没有也不该有联系方式 */
      contactFreezeUntil: out.contactFreezeUntil,
      previousCardSource: 'local-history',
    });
    return {
      ok: true,
      info: this.info()!,
      declaration: out.declaration,
      revocation: out.revocation as IdentityDeclaration,
      previousCard: out.previousCard,
      contactFreezeUntil: out.contactFreezeUntil,
    };
  }

  /** 联系人侧：验别人发来的换证声明并应用代次规则 */
  acceptRotation(decl: RotationDeclaration, opts: RotationVerifyOptions = {}): RotationVerifyResult {
    return verifyRotationDeclaration(decl, opts);
  }

  /** 联系人侧：验别人发来的"旧的作废"声明 */
  acceptRevocation(decl: IdentityDeclaration): RevocationVerifyResult {
    if (decl && (decl as { kind?: string }).kind === 'warmy.identity.revocation') {
      return verifyRevocationDeclaration(decl as never);
    }
    return {
      accepted: false,
      reason: 'malformed',
      fingerprint: '',
      generation: 0,
      warnings: [],
      honestNote: GENERATION_RULE_NOTE,
      detail: '不是作废声明',
    };
  }

  // ── 接收方侧：对端联系资料状态 + 7 天冻结（**每个接收方本地各自判定**） ──

  /** 对端联系资料的旁路存储（与身份文件同目录；两边都是本机数据） */
  private peerFile(): string {
    return path.join(path.dirname(this.file), 'peer-contacts.json');
  }

  private readPeers(): Record<string, PeerContactState> {
    const raw = readJsonFileQuarantine<{ peers?: Record<string, PeerContactState> }>(this.peerFile(), {});
    const peers = raw && typeof raw === 'object' && raw.peers && typeof raw.peers === 'object' ? raw.peers : {};
    return peers;
  }

  private writePeers(peers: Record<string, PeerContactState>): void {
    const w = writeJsonAtomicSafe(this.peerFile(), { schema: PEER_CONTACTS_SCHEMA, peers });
    if (!w.ok) this.onAudit('identity.peers.write.failed', { error: w.error });
  }

  /**
   * 本机留存了对端名片的指纹键（**公开**）。
   * 之前 `readPeers()` 是私有的，调用方（identity-provider）只能按落盘 schema 旁路读同一个文件 ——
   * 那是"绕过封装读私有格式"，schema 一改就静默失效。这里给出唯一入口，内容仍由 `peerContact()` 解析。
   */
  peerContactKeys(): string[] {
    const peers = this.readPeers();
    return Object.keys(peers).filter((k) => typeof k === 'string' && k.length > 0);
  }

  /**
   * 对端名片状态（读取时顺带结算：冻结到期 → 清冻结标记并置 `awaitingConfirmation`，
   * **不自动采用新值**——见 `peerContactSettle` 与 ADR 003 附七.3-1：若到期即自动采用，
   * 攻击者只要等满 7 天就赢了）。
   */
  peerContact(fingerprint: string, now: number = Date.now()): PeerContactView | null {
    const peers = this.readPeers();
    const key = Object.keys(peers).find((k) => fingerprintMatches(k, fingerprint));
    if (!key) return null;
    const cur = peers[key];
    if (!cur) return null;
    const settled = peerContactSettle(cur, now);
    if (settled !== cur) {
      peers[key] = settled;
      this.writePeers(peers);
    }
    return peerContactView(settled, now);
  }

  /**
   * 记录对方的名片（加入时交换 / 换证后补发）。
   *   · 本机第一次见到该指纹 → 直接留存，**不冻结**（"首次加入不受此限"，否则新人填不了联系方式）；
   *   · 处于冻结期 → 只记为 pendingCard；展示与使用仍用**本机留存值**。
   */
  recordPeerCard(fingerprint: string, card: ContactCard, now: number = Date.now()): PeerContactView {
    const peers = this.readPeers();
    const key = Object.keys(peers).find((k) => fingerprintMatches(k, fingerprint)) || fingerprint;
    const cur = peers[key];
    const next = cur ? peerContactOnCard(cur, card, now) : createPeerContact(fingerprint, card, now);
    peers[key] = next;
    this.writePeers(peers);
    this.onAudit('identity.peer.card', { fingerprint, first: !cur, frozen: next.contactFreezeUntil > now });
    return peerContactView(next, now);
  }

  /**
   * 记录"收到对方换证通知"：**从本机此刻**起算 7 天冻结
   * （绝不用声明里的时间戳 —— 那是攻击者可控的数据）。
   * ⚠️ 调用前必须先验签（`acceptRotation` / `verifyRotationDeclaration`），因为这里采用声明里的指纹与代次。
   */
  recordPeerRotation(decl: RotationDeclaration, now: number = Date.now()): PeerContactView {
    const peers = this.readPeers();
    const key = decl.newFingerprint;
    const cur = peers[key] || peers[decl.oldFingerprint];
    const base = cur ? { ...cur, fingerprint: decl.newFingerprint } : createPeerContact(decl.newFingerprint, {}, now);
    const next = peerContactOnRotation(base, now, decl.generation);
    peers[key] = next;
    const oldEntry = peers[decl.oldFingerprint];
    if (oldEntry && decl.oldFingerprint !== key) {
      // 旧指纹条目保留（历史签名仍可验），冻结同样从本机此刻起算
      peers[decl.oldFingerprint] = peerContactOnRotation(oldEntry, now, decl.previousGeneration);
    }
    this.writePeers(peers);
    this.onAudit('identity.peer.rotation', {
      from: decl.oldFingerprint,
      to: decl.newFingerprint,
      generation: decl.generation,
      receivedAt: now,
      contactFreezeUntil: next.contactFreezeUntil,
      /** 旧名片来自本机留存（声明里没有，也不该有） */
      previousCardSource: 'local-history',
    });
    return peerContactView(next, now);
  }

  /**
   * 接收方**手动确认**采用新名片（冻结期结束后才生效；对应 UI 的
   * 「冻结期已结束，但不会自动采用新值——需要你手动确认」）。
   */
  confirmPeerCard(fingerprint: string, now: number = Date.now()): PeerContactView | null {
    const peers = this.readPeers();
    const key = Object.keys(peers).find((k) => fingerprintMatches(k, fingerprint));
    if (!key) return null;
    const cur = peers[key];
    if (!cur) return null;
    if (cur.contactFreezeUntil > now) {
      // 冻结期内不生效：如实回绝（UI 要说明"还没到期"）
      this.onAudit('identity.peer.confirm.rejected', { fingerprint, until: cur.contactFreezeUntil, reason: 'still-frozen' });
      return peerContactView(cur, now);
    }
    const next = peerContactConfirm(cur, now);
    peers[key] = next;
    this.writePeers(peers);
    this.onAudit('identity.peer.confirm', { fingerprint, adopted: !!next.storedCard.email || !!next.storedCard.phone });
    return peerContactView(next, now);
  }

  /** 结算所有对端冻结期（启动时调一次即可；**不自动采用新值**，只清标记 + 置 awaitingConfirmation） */
  settlePeerContacts(now: number = Date.now()): { promoted: number; total: number } {
    const peers = this.readPeers();
    let promoted = 0;
    for (const [k, v] of Object.entries(peers)) {
      if (!v) continue;
      const s = peerContactSettle(v, now);
      if (s !== v) {
        peers[k] = s;
        promoted++;
      }
    }
    if (promoted) this.writePeers(peers);
    return { promoted, total: Object.keys(peers).length };
  }

  // ── 备份导出 / 导入（附三 C6：凭证必须用户自持） ──

  /**
   * 导出加密备份。**永远加密** —— 不允许"明文导出私钥"这条路径
   * （附五"默认不显示明文、导出走二次确认并优先加密文件"）。
   */
  /**
   * 从凭证恢复身份：备份当前身份文件 → 用凭证派生密钥重建 → 返回新身份信息。
   * 产品语义：凭证就是私钥；换机 / 误删配置后，只凭这一串即可找回同一个身份与指纹。
   */
  restoreFromCredential(credential: string, alias?: string): { ok: true; info: IdentityInfo; backupFile?: string } | Err {
    if (!isValidCredential(credential)) return { ok: false, error: 'bad-credential' };
    let backupFile: string | undefined;
    try {
      if (fs.existsSync(this.file)) {
        backupFile = `${this.file}.replaced-${Date.now()}`;
        fs.copyFileSync(this.file, backupFile);
      }
      fs.rmSync(this.file, { force: true });
    } catch { /* 备份失败不阻断恢复 */ }
    const created = this.createWith(alias || 'restored', undefined, undefined, credential);
    if (!created.ok) return created as Err;
    this.onAudit('identity.restore.credential', { fingerprint: this.info()?.fingerprint || '' });
    return { ok: true, info: this.info()!, ...(backupFile ? { backupFile } : {}) };
  }

  exportBackup(payload: { passphrase: string }): { ok: true; backup: IdentityBackup } | { ok: false; error: string } {
    if (!payload?.passphrase || payload.passphrase.length < 8) return { ok: false, error: 'passphrase-too-short(>=8)' };
    const { file } = this.readFile();
    if (!file) return { ok: false, error: 'not-found' };
    const loaded = this.load();
    if (!loaded.ok) return { ok: false, error: loaded.error };
    const backup = buildBackup(loaded.identity, loaded.privateKeyDer, payload.passphrase);
    this.onAudit('identity.backup.export', { fingerprint: loaded.identity.fingerprint, generation: loaded.identity.generation });
    return { ok: true, backup };
  }

  /**
   * 导入备份（换机器 / 恢复）。导入后身份指纹与代次与备份一致，
   * 并且**只能**用备份口令解锁（新机器上没有旧机器的 DPAPI 包裹）。
   */
  importBackup(backup: IdentityBackup, payload: { passphrase: string }): { ok: true; info: IdentityInfo } | { ok: false; error: string } {
    const opened = openBackup(backup, payload?.passphrase || '');
    if (!opened.ok) return { ok: false, error: opened.error };
    const dek = crypto.randomBytes(32);
    const next: IdentityFile = {
      schema: IDENTITY_FILE_SCHEMA,
      identity: opened.identity,
      protection: { os: false, passphrase: true, osLabel: this.protector.label() },
      keys: {
        privateKey: aesGcmEncrypt(dek, opened.privateKeyDer),
        dekOs: null,
        dekPass: wrapDekWithPassphrase(dek, payload.passphrase),
      },
      updatedAt: Date.now(),
    };
    const w = writeJsonAtomicSafe(this.file, next);
    if (!w.ok) return { ok: false, error: w.error || 'write failed' };
    this.sessionDek = dek;
    this.onAudit('identity.backup.import', { fingerprint: next.identity.fingerprint, generation: next.identity.generation });
    return { ok: true, info: this.info()! };
  }
}

/* ────────────────────── 成员证书 / 吊销列表的落盘（ADR §附八.8） ────────────────────── */

/**
 * 群成员证书 + 吊销列表的本机副本（`<userData>/identity/membership.json`）。
 *
 * 协议与验签逻辑在 `@warmy/sync-protocol` 的 `membership.ts`（可单独单测）；
 * 这里只负责**磁盘形态**、**单调合并**与**给名册/在线态的查询接口**。
 *
 * 为什么"过期证书也要存"：见 `putCertificate` 的注释 —— 如果过期证书被直接丢掉，
 * 名册就会退回 TOFU 放行，等于"过期证书反而更好用"。
 */
export const MEMBERSHIP_FILE_SCHEMA = 'warmy.membership.file.v1' as const;

/** 每个群最多保留多少张证书（超出时淘汰最老的"无人指涉"证书，保证 supersedes 链不断） */
export const MEMBERSHIP_MAX_CERTS_PER_GROUP = 256;

export interface GroupMembershipState {
  groupId: string;
  /** 本机认可的该群创建者（群主）指纹；首次接受证书时钉住（或由调用方显式给出） */
  issuerFingerprint: string;
  certs: ChengYuanZhengShu[];
  /** 已同步到的吊销列表（null = 还没同步过） */
  revocation: CheXiaoBiao | null;
  updatedAt: number;
}

export interface MembershipFile {
  schema: typeof MEMBERSHIP_FILE_SCHEMA;
  groups: Record<string, GroupMembershipState>;
  updatedAt: number;
}

export interface MembershipStoreOptions {
  onAudit?: (op: string, detail?: unknown) => void;
  now?: () => number;
  /** 指纹推导（app-shell 传身份层的 fingerprintFromPublicKey） */
  fingerprintOf?: quChengYuanZhiWen;
  /** 本地时钟容差（app-shell 传身份层的 DEFAULT_CLOCK_SKEW_MS） */
  clockSkewMs?: number;
  /** 独立验签实现（默认本地 Ed25519 复核） */
  verifySignature?: (message: Buffer, signature: Buffer, publicKeySpkiB64: string) => boolean | null;
}

export interface MembershipAuthorizeResult {
  /** true = 本机对"这个指纹是不是群成员"**有明确结论**（不论结论是放行还是拒绝） */
  decided: boolean;
  ok: boolean;
  code: ChengYuanZhengShuMa | 'revoked' | 'unknown-fingerprint';
  groupId?: string;
  certId?: string;
  detail?: string;
}

function emptyMembershipFile(): MembershipFile {
  return { schema: MEMBERSHIP_FILE_SCHEMA, groups: {}, updatedAt: Date.now() };
}

function copyCert(c: ChengYuanZhengShu): ChengYuanZhengShu {
  return { ...c, permissions: [...(c.permissions ?? [])] };
}

function copyRevocation(l: CheXiaoBiao | null): CheXiaoBiao | null {
  if (!l) return null;
  return { ...l, entries: (l.entries ?? []).map((e) => ({ ...e })) };
}

/**
 * 吊销查询（**本层用容错比较**：短横分组/大小写/形近字都要认出来，与身份层一致）。
 * sync-protocol 的 `findRevocationEntry` 是**精确比较**（协议层把指纹当不透明字符串），
 * 这里包一层是因为本层的指纹来自 UI / 名片，用户抄录与展示形式都可能有差异。
 */
function revocationHit(
  list: CheXiaoBiao | null,
  q: { certId?: string; memberFingerprint?: string }
): CheXiaoTiaoMu | null {
  if (!list || !Array.isArray(list.entries)) return null;
  for (const e of list.entries) {
    if (q.certId && e.certId === q.certId) return e;
    if (q.memberFingerprint && fingerprintMatches(e.memberFingerprint, q.memberFingerprint)) return e;
  }
  return null;
}

const CERT_ROLE_SET: readonly string[] = MEMBER_CERT_ROLES;
const REVOCATION_REASON_SET: readonly string[] = REVOCATION_REASONS;

/** 把磁盘上的（可能被手改坏 / 版本更旧的）数据收敛成合法结构；坏群不抛错、直接丢 */
function normalizeMembership(raw: unknown): MembershipFile {
  const out = emptyMembershipFile();
  if (!raw || typeof raw !== 'object') return out;
  const src = raw as Partial<MembershipFile>;
  const groupsSrc = src.groups && typeof src.groups === 'object' ? src.groups : {};
  for (const key of Object.keys(groupsSrc)) {
    const g = (groupsSrc as Record<string, unknown>)[key];
    if (!g || typeof g !== 'object') continue;
    const rec = g as Partial<GroupMembershipState>;
    const groupId = typeof rec.groupId === 'string' && rec.groupId ? rec.groupId : key;
    if (!groupId) continue;
    const certs: ChengYuanZhengShu[] = [];
    const certIds = new Set<string>();
    for (const c of Array.isArray(rec.certs) ? rec.certs : []) {
      if (!c || typeof c !== 'object') continue;
      const cr = c as Partial<ChengYuanZhengShu>;
      if (cr.schema !== MEMBER_CERT_SCHEMA) continue;
      if (typeof cr.certId !== 'string' || !cr.certId || certIds.has(cr.certId)) continue;
      if (typeof cr.memberFingerprint !== 'string' || !cr.memberFingerprint) continue;
      if (typeof cr.memberPublicKey !== 'string' || !cr.memberPublicKey) continue;
      if (typeof cr.issuerFingerprint !== 'string' || !cr.issuerFingerprint) continue;
      if (typeof cr.issuerPublicKey !== 'string' || !cr.issuerPublicKey) continue;
      if (typeof cr.issuerSignature !== 'string' || !cr.issuerSignature) continue;
      if (!CERT_ROLE_SET.includes(String(cr.role))) continue;
      if (typeof cr.issuedAt !== 'number' || typeof cr.expiresAt !== 'number') continue;
      certIds.add(cr.certId);
      const row: ChengYuanZhengShu = {
        schema: MEMBER_CERT_SCHEMA,
        certId: cr.certId,
        groupId: typeof cr.groupId === 'string' && cr.groupId ? cr.groupId : groupId,
        memberFingerprint: cr.memberFingerprint,
        memberPublicKey: cr.memberPublicKey,
        role: cr.role as ChengYuanZhengShu['role'],
        permissions: Array.isArray(cr.permissions) ? cr.permissions.filter((p): p is string => typeof p === 'string') : [],
        issuedAt: cr.issuedAt,
        expiresAt: cr.expiresAt,
        issuerFingerprint: cr.issuerFingerprint,
        issuerPublicKey: cr.issuerPublicKey,
        issuerSignature: cr.issuerSignature,
      };
      if (typeof cr.displayName === 'string' && cr.displayName) row.displayName = cr.displayName;
      if (typeof cr.supersedes === 'string' && cr.supersedes) row.supersedes = cr.supersedes;
      if (typeof cr.memberId === 'string' && cr.memberId) row.memberId = cr.memberId;
      certs.push(row);
    }
    let revocation: CheXiaoBiao | null = null;
    const rl = rec.revocation;
    if (rl && typeof rl === 'object' && rl.schema === REVOCATION_LIST_SCHEMA && typeof rl.issuerSignature === 'string') {
      const entries: CheXiaoTiaoMu[] = [];
      const seen = new Set<string>();
      for (const e of Array.isArray(rl.entries) ? rl.entries : []) {
        if (!e || typeof e !== 'object') continue;
        if (typeof e.certId !== 'string' || !e.certId || seen.has(e.certId)) continue;
        if (!REVOCATION_REASON_SET.includes(String(e.reason))) continue;
        if (typeof e.revokedAt !== 'number') continue;
        seen.add(e.certId);
        entries.push({
          certId: e.certId,
          memberFingerprint: typeof e.memberFingerprint === 'string' ? e.memberFingerprint : '',
          reason: e.reason as CheXiaoTiaoMu['reason'],
          revokedAt: e.revokedAt,
        });
      }
      if (typeof rl.listVersion === 'number' && Number.isInteger(rl.listVersion) && rl.listVersion >= 1) {
        revocation = {
          schema: REVOCATION_LIST_SCHEMA,
          groupId: typeof rl.groupId === 'string' && rl.groupId ? rl.groupId : groupId,
          listVersion: rl.listVersion,
          entries,
          issuedAt: typeof rl.issuedAt === 'number' ? rl.issuedAt : 0,
          issuerFingerprint: typeof rl.issuerFingerprint === 'string' ? rl.issuerFingerprint : '',
          issuerPublicKey: typeof rl.issuerPublicKey === 'string' ? rl.issuerPublicKey : '',
          issuerSignature: rl.issuerSignature,
        };
      }
    }
    const issuerFingerprint =
      typeof rec.issuerFingerprint === 'string' && rec.issuerFingerprint
        ? rec.issuerFingerprint
        : revocation?.issuerFingerprint || certs[0]?.issuerFingerprint || '';
    out.groups[groupId] = {
      groupId,
      issuerFingerprint,
      certs,
      revocation,
      updatedAt: typeof rec.updatedAt === 'number' ? rec.updatedAt : 0,
    };
  }
  return out;
}

export type MemberCertStoreCode = ChengYuanZhengShuMa | 'issuer-changed' | 'write-failed';

export interface PutCertificateResult {
  ok: boolean;
  code: MemberCertStoreCode;
  /** 是否**落盘**了这张证书（过期证书也会落盘 —— 见 putCertificate 注释） */
  stored: boolean;
  certId: string;
  groupId: string;
  detail?: string;
}

/**
 * 群成员证书 / 吊销列表的本机存储。
 *
 * ⚠️ 两条容易写错的行为，都在这里钉死：
 *  1. **名册判定的依据是"有没有记录"，不是"证书好不好"**：只要本机对某个指纹有证书或吊销记录，
 *     就由这条记录给出结论（`decided = true`），**不再退回 TOFU**。否则"拿一张过期证书来连"
 *     会比"什么都不带"更容易通过 —— 这是最典型的降级漏洞。
 *  2. **签发者（群主）在首次接受时钉住**：之后换成别的签发者一律拒绝，直到本机显式改绑。
 */
export class MembershipStore {
  private readonly onAudit: (op: string, detail?: unknown) => void;
  private readonly now: () => number;
  private readonly fingerprintOf: quChengYuanZhiWen;
  private readonly clockSkewMs: number;
  private readonly verifySignature?: (message: Buffer, signature: Buffer, publicKeySpkiB64: string) => boolean | null;
  /** mtime+size 缓存：同一个进程里的多个调用点（名册每次握手都会查）不必反复读盘 */
  private cache: { file: MembershipFile; key: string } | null = null;

  constructor(private file: string, opts: MembershipStoreOptions = {}) {
    this.onAudit = opts.onAudit || (() => undefined);
    this.now = opts.now || (() => Date.now());
    this.fingerprintOf = opts.fingerprintOf || moRenChengYuanZhiWen;
    this.clockSkewMs = typeof opts.clockSkewMs === 'number' ? opts.clockSkewMs : MEMBERSHIP_CLOCK_SKEW_MS;
    if (opts.verifySignature) this.verifySignature = opts.verifySignature;
  }

  path(): string {
    return this.file;
  }

  private fileKey(): string {
    try {
      const st = fs.statSync(this.file);
      return `${st.mtimeMs}:${st.size}`;
    } catch {
      return 'absent';
    }
  }

  snapshot(): MembershipFile {
    const key = this.fileKey();
    if (this.cache && this.cache.key === key) return this.cache.file;
    const file = normalizeMembership(readJsonFileQuarantine<unknown>(this.file, null));
    this.cache = { file, key };
    return file;
  }

  private persist(file: MembershipFile): { ok: boolean; error?: string } {
    const r = writeJsonAtomicSafe(this.file, { ...file, updatedAt: this.now() });
    if (!r.ok) this.onAudit('membership.write.failed', { error: r.error });
    this.cache = null;
    return r;
  }

  /** 串行队列（见 runExclusive） */
  private exclusiveChain: Promise<unknown> = Promise.resolve();

  /**
   * 串行化「读 → 签名 → 落盘」这一整段。
   *
   * 为什么必须有：签发 / 换证 / 吊销都是「读当前列表 → 算出版本 +1 → **await 签名** → 落盘」，
   * 中间那个 await 会让两路并发（例如同时踢两个人）各自读到同一版本、各算出 version+1、各签一份，
   * 后写覆盖先写 —— **前一次的吊销会静默丢失**（不是"多授权"，但仍是一次漏掉的吊销）。
   * 写入者在本设计里只有 Electron 主进程一个，所以一条进程内队列就够（跨进程写不在本设计内）。
   *
   * ⚠️ **不可重入**：调用方必须保证不在持有队列时再进队列。
   * `rotateMemberCertificate` / `reissueMemberCertificateForRecovery` 内部要调
   * `issueMemberCertificateImpl` / `revokeMemberCertificateImpl`（不带锁的那两个），
   * 就是为了避免嵌套加锁把自己锁死。
   */
  runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.exclusiveChain.then(fn, fn);
    // 队列本身不能因为某次失败而断掉：把结果吞掉只用于续接
    this.exclusiveChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private verifyOpts(extra: ChengYuanYanZhengXuanXiang = {}): ChengYuanYanZhengXuanXiang {
    return { fingerprintOf: this.fingerprintOf, clockSkewMs: this.clockSkewMs, now: this.now(), ...extra };
  }

  listGroups(): string[] {
    return Object.keys(this.snapshot().groups);
  }

  /** 只读视图（数组已复制；调用方拿到的是副本，改不坏缓存） */
  groupState(groupId: string): GroupMembershipState | null {
    const g = this.snapshot().groups[groupId];
    if (!g) return null;
    return {
      groupId: g.groupId,
      issuerFingerprint: g.issuerFingerprint,
      certs: g.certs.map(copyCert),
      revocation: copyRevocation(g.revocation),
      updatedAt: g.updatedAt,
    };
  }

  private mutableGroup(file: MembershipFile, groupId: string): GroupMembershipState {
    const cur = file.groups[groupId];
    if (cur) return cur;
    const next: GroupMembershipState = {
      groupId,
      issuerFingerprint: '',
      certs: [],
      revocation: null,
      updatedAt: this.now(),
    };
    file.groups[groupId] = next;
    return next;
  }

  /** 某个群里的全部证书（副本） */
  listCertificates(groupId: string): ChengYuanZhengShu[] {
    return (this.snapshot().groups[groupId]?.certs ?? []).map(copyCert);
  }

  /** 全部群的证书（副本）+ 所属群 id */
  allCertificates(): Array<{ groupId: string; cert: ChengYuanZhengShu }> {
    const out: Array<{ groupId: string; cert: ChengYuanZhengShu }> = [];
    for (const [groupId, g] of Object.entries(this.snapshot().groups)) {
      for (const c of g.certs) out.push({ groupId, cert: copyCert(c) });
    }
    return out;
  }

  certificateById(groupId: string, certId: string): ChengYuanZhengShu | null {
    const c = this.snapshot().groups[groupId]?.certs.find((x) => x.certId === certId);
    return c ? copyCert(c) : null;
  }

  /** 该指纹在该群的**最新**一张证书（按 issuedAt，其次按链长） */
  certificateForFingerprint(groupId: string, fingerprint: string): ChengYuanZhengShu | null {
    const list = (this.snapshot().groups[groupId]?.certs ?? []).filter((c) =>
      fingerprintMatches(c.memberFingerprint, fingerprint)
    );
    if (!list.length) return null;
    const sorted = list.slice().sort((a, b) => b.issuedAt - a.issuedAt);
    return copyCert(sorted[0] as ChengYuanZhengShu);
  }

  /**
   * 存一张**别处签来**的证书（创建者本人签发的走 `issueCertificate`）。
   *
   * ⚠️ 过期 / 未生效的证书**也会落盘**（`stored=true`, `code='expired'|'not-yet-valid'`）：
   * 本机对"这个人"从此有明确结论，名册会**拒绝**他，而不是把记录丢掉退回 TOFU。
   * 结构 / 指纹绑定 / 签发者 / 签名不通过的一律**不入库**（`stored=false`），
   * 因为那种证书连"这是谁签的"都不可信，留着只会污染判定。
   */
  putCertificate(cert: ChengYuanZhengShu, opts: { expectIssuerFingerprint?: string } = {}): PutCertificateResult {
    const groupId = String(cert?.groupId || '');
    const base: PutCertificateResult = {
      ok: false,
      code: 'malformed',
      stored: false,
      certId: String(cert?.certId || ''),
      groupId,
    };
    const file = this.snapshot();
    const existing = file.groups[groupId];
    const pinned = opts.expectIssuerFingerprint || existing?.issuerFingerprint || '';
    // ① 签发者必须还是本机钉住的那一个（换签发者 = 换群主，本机不接受替身）
    if (pinned && !fingerprintMatches(pinned, cert?.issuerFingerprint || '')) {
      this.onAudit('membership.cert.issuer-changed', {
        groupId,
        certId: base.certId,
        pinned,
        claimed: String(cert?.issuerFingerprint || ''),
      });
      return {
        ...base,
        code: 'issuer-changed',
        detail: `本机已把该群创建者钉在 ${pinned}，不接受 ${String(cert?.issuerFingerprint || '')} 签发的证书`,
      };
    }
    // ② 结构 / 指纹绑定 / 时间 / 签名
    const v = verifyMemberCertificate(
      cert,
      this.verifyOpts({ expectGroupId: groupId, ...(pinned ? { expectIssuerFingerprint: pinned } : {}) })
    );
    if (!v.ok && v.code !== 'expired' && v.code !== 'not-yet-valid') {
      this.onAudit('membership.cert.rejected', { groupId, certId: base.certId, code: v.code });
      return { ...base, code: v.code, detail: v.detail };
    }
    const g = this.mutableGroup(file, groupId);
    if (!g.issuerFingerprint) {
      g.issuerFingerprint = cert.issuerFingerprint;
      this.onAudit('membership.issuer.pinned', { groupId, issuer: cert.issuerFingerprint, certId: cert.certId });
    }
    const idx = g.certs.findIndex((c) => c.certId === cert.certId);
    const stored: ChengYuanZhengShu = copyCert(cert);
    if (idx >= 0) {
      // 同一 certId 再送来：内容必须完全一致（否则就是有人想用同 id 覆盖已有的证书）
      const prev = g.certs[idx] as ChengYuanZhengShu;
      if (prev.issuerSignature !== stored.issuerSignature || prev.memberPublicKey !== stored.memberPublicKey) {
        this.onAudit('membership.cert.conflict', { groupId, certId: stored.certId });
        return { ...base, code: 'malformed', detail: '同一 certId 已存在但内容不同（拒绝覆盖）' };
      }
      g.certs[idx] = stored;
    } else {
      g.certs.push(stored);
    }
    this.evictOverflow(g);
    g.updatedAt = this.now();
    const w = this.persist(file);
    if (!w.ok) return { ...base, code: 'write-failed', detail: w.error };
    this.onAudit('membership.cert.stored', {
      groupId,
      certId: stored.certId,
      member: stored.memberFingerprint,
      role: stored.role,
      supersedes: stored.supersedes ?? '',
      code: v.code,
    });
    return { ok: true, code: v.code, stored: true, certId: stored.certId, groupId, detail: v.detail };
  }

  /** 证书数量上限：淘汰最老的"没有任何证书 supersedes 指向它"的那张，保证换证链不断 */
  private evictOverflow(g: GroupMembershipState): void {
    if (g.certs.length <= MEMBERSHIP_MAX_CERTS_PER_GROUP) return;
    const referenced = new Set(g.certs.map((c) => c.supersedes).filter((v): v is string => typeof v === 'string' && v.length > 0));
    const sorted = g.certs.slice().sort((a, b) => a.issuedAt - b.issuedAt);
    const keep = new Set(g.certs.map((c) => c.certId));
    while (keep.size > MEMBERSHIP_MAX_CERTS_PER_GROUP) {
      const victim = sorted.find((c) => keep.has(c.certId) && !referenced.has(c.certId));
      if (!victim) break;
      keep.delete(victim.certId);
      this.onAudit('membership.cert.evicted', { groupId: g.groupId, certId: victim.certId, reason: 'overflow' });
    }
    g.certs = g.certs.filter((c) => keep.has(c.certId));
  }

  /** 当前吊销列表（副本） */
  revocation(groupId: string): CheXiaoBiao | null {
    return copyRevocation(this.snapshot().groups[groupId]?.revocation ?? null);
  }

  /**
   * 同步（收到）一份吊销列表：**先验签，再单调合并**。
   * 验签失败、版本回滚、同版本不同内容、条目变少 —— 全部拒绝并保持本机列表不变。
   */
  applyRevocationList(
    groupId: string,
    list: CheXiaoBiao,
    opts: { expectIssuerFingerprint?: string } = {}
  ): CheXiaoYingYongJieGuo & { stored: boolean } {
    const file = this.snapshot();
    const existing = file.groups[groupId];
    const pinned = opts.expectIssuerFingerprint || existing?.issuerFingerprint || '';
    const current = existing?.revocation ?? null;
    const res = verifyAndApplyRevocationList(
      current,
      list,
      this.verifyOpts({ expectGroupId: groupId, ...(pinned ? { expectIssuerFingerprint: pinned } : {}) })
    );
    if (!res.ok) {
      this.onAudit('membership.revocation.rejected', {
        groupId,
        code: res.code,
        incoming: res.listVersion,
        current: res.previousVersion,
      });
      return { ...res, stored: false };
    }
    if (!res.changed) return { ...res, stored: true };
    const g = this.mutableGroup(file, groupId);
    if (!g.issuerFingerprint) {
      g.issuerFingerprint = list.issuerFingerprint;
      this.onAudit('membership.issuer.pinned', { groupId, issuer: list.issuerFingerprint, via: 'revocation-list' });
    }
    g.revocation = copyRevocation(list);
    g.updatedAt = this.now();
    const w = this.persist(file);
    if (!w.ok) return { ...res, ok: false, code: 'write-failed' as CheXiaoBiaoMa, stored: false };
    this.onAudit('membership.revocation.applied', {
      groupId,
      from: res.previousVersion,
      to: res.listVersion,
      entries: res.entryCount,
    });
    return { ...res, stored: true };
  }

  /**
   * 名册判定：**这个指纹是不是某个群的合法成员**。
   *
   * 返回 `decided = false` 只表示"本机对这个人一无所知（没有证书、也没有吊销记录）"，
   * 调用方此时可以走 TOFU 降级；`decided = true` 时结论就是最终结论。
   */
  authorizeFingerprint(
    fingerprint: string,
    opts: { groupId?: string; now?: number } = {}
  ): MembershipAuthorizeResult {
    const fp = String(fingerprint || '').trim();
    if (!fp) return { decided: false, ok: false, code: 'unknown-fingerprint' };
    const file = this.snapshot();
    const groupIds = opts.groupId ? [opts.groupId] : Object.keys(file.groups);
    // ① **先扫全部吊销**：任一命中即拒。
    //    这一步必须与群顺序无关：如果"先看证书"就会变成"哪个群先被遍历到就听谁的"，
    //    同一个指纹在不同 key 顺序下会得到不同结论（实测过）。吊销 = 全局拒绝（fail-closed）。
    for (const groupId of groupIds) {
      const g = file.groups[groupId];
      if (!g) continue;
      const hit = revocationHit(g.revocation, { memberFingerprint: fp });
      if (hit) {
        return {
          decided: true,
          ok: false,
          code: 'revoked',
          groupId,
          certId: hit.certId,
          detail: `吊销名单命中（reason=${hit.reason}）`,
        };
      }
    }
    // ② 再找有效证书：任一"有效且未被吊销"的证书 → 放行
    let sawCert = false;
    let firstReject: MembershipAuthorizeResult | null = null;
    for (const groupId of groupIds) {
      const g = file.groups[groupId];
      if (!g) continue;
      const certs = g.certs.filter((c) => fingerprintMatches(c.memberFingerprint, fp));
      if (!certs.length) continue;
      sawCert = true;
      for (const cert of certs) {
        const v = verifyMemberCertificate(
          cert,
          this.verifyOpts({
            now: opts.now,
            expectGroupId: groupId,
            ...(g.issuerFingerprint ? { expectIssuerFingerprint: g.issuerFingerprint } : {}),
          })
        );
        // 该证书自身被点名吊销（certId 命中）→ 即使是"另一条"证书被吊销也不放行这一张
        const certRevoked = revocationHit(g.revocation, { certId: cert.certId });
        if (v.ok && !certRevoked) {
          return { decided: true, ok: true, code: 'ok', groupId, certId: cert.certId };
        }
        const code = v.ok ? 'revoked' : v.code;
        if (!firstReject) {
          firstReject = {
            decided: true,
            ok: false,
            code,
            groupId,
            certId: cert.certId,
            detail: v.ok ? '该证书已被吊销' : v.detail,
          };
        }
      }
    }
    if (sawCert && firstReject) return firstReject;
    return { decided: false, ok: false, code: 'unknown-fingerprint' };
  }

  /** 同一条换证链上的全部指纹（跨群合并） */
  chainFingerprints(fingerprint: string): string[] {
    const out = new Set<string>([String(fingerprint || '')]);
    for (const g of Object.values(this.snapshot().groups)) {
      for (const fp of lianShiZhiWen(g.certs, fingerprint)) out.add(fp);
    }
    return [...out].filter((v) => v.length > 0);
  }

  /** 这两个指纹是不是同一个群成员（换证后重新进群的判据） */
  isSameMember(groupId: string, fpA: string, fpB: string): { same: boolean; reason: string; rootA: string; rootB: string } {
    const g = this.snapshot().groups[groupId];
    if (!g) return { same: false, reason: '本机没有该群的证书记录', rootA: '', rootB: '' };
    const r = isSameMember(g.certs, fpA, fpB);
    return { same: r.same, reason: r.reason, rootA: r.rootA, rootB: r.rootB };
  }

  /** 这些指纹在哪些群里有证书（T179：scopes / 归属查询） */
  groupsContaining(fingerprints: readonly string[]): string[] {
    const out: string[] = [];
    for (const [groupId, g] of Object.entries(this.snapshot().groups)) {
      if (g.certs.some((c) => fingerprints.some((fp) => fingerprintMatches(c.memberFingerprint, fp)))) out.push(groupId);
    }
    return out;
  }

  /** 结构化摘要（IPC/UI 用；不含任何文案） */
  summary(): {
    schema: typeof MEMBERSHIP_FILE_SCHEMA;
    groupCount: number;
    certCount: number;
    revokedCount: number;
    groups: Array<{
      groupId: string;
      issuerFingerprint: string;
      certCount: number;
      memberCount: number;
      revocationListVersion: number;
      revokedCount: number;
    }>;
  } {
    const file = this.snapshot();
    const groups = Object.values(file.groups).map((g) => {
      const members = new Set(g.certs.map((c) => normalizeFingerprint(c.memberFingerprint)));
      return {
        groupId: g.groupId,
        issuerFingerprint: g.issuerFingerprint,
        certCount: g.certs.length,
        memberCount: members.size,
        revocationListVersion: g.revocation?.listVersion ?? 0,
        revokedCount: g.revocation?.entries.length ?? 0,
      };
    });
    return {
      schema: MEMBERSHIP_FILE_SCHEMA,
      groupCount: groups.length,
      certCount: groups.reduce((n, g) => n + g.certCount, 0),
      revokedCount: groups.reduce((n, g) => n + g.revokedCount, 0),
      groups,
    };
  }
}

export interface LoadIdentityOptions {
  /** 口令模式必需（OS 模式可省） */
  passphrase?: string;
  protector?: OsKeyProtector;
  onAudit?: (op: string, detail?: unknown) => void;
  /** 首次运行：文件不存在时用这个别名即时生成（幂等；存在则直接加载） */
  createIfMissing?: { alias: string; contactCard?: ContactCard };
}

export interface LoadedIdentity {
  /** 需要后续操作（签发/换证/导出）时用这个句柄 */
  store: IdentityStore;
  identity: IdentityRecord;
  /** PKCS8 DER：**只在内存里**，调用方不得落盘、不得回给渲染进程 */
  privateKeyDer: Buffer;
}

/**
 * 便捷入口：打开（必要时先创建）一个身份并解开私钥。
 * 与 `IdentityStore.load` 等价，只是把"首次运行即生成"合并进一次调用 ——
 * 于是应用启动路径上只需要这一句（见 electron-main 的 bootstrap）。
 */
export function loadIdentity(
  file: string,
  opts: LoadIdentityOptions = {},
): ({ ok: true } & LoadedIdentity) | { ok: false; error: string } {
  const store = new IdentityStore(file, {
    ...(opts.protector ? { protector: opts.protector } : {}),
    ...(opts.onAudit ? { onAudit: opts.onAudit } : {}),
  });
  if (!store.exists() && opts.createIfMissing) {
    const made = store.ensureIdentity(opts.createIfMissing.alias, opts.createIfMissing.contactCard);
    if (!made.ok) return { ok: false, error: made.error };
  }
  const r = store.load(opts.passphrase);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, store, identity: r.identity, privateKeyDer: r.privateKeyDer };
}

export interface IdentityBackup {
  schema: typeof IDENTITY_BACKUP_SCHEMA;
  exportedAt: number;
  algo: typeof IDENTITY_ALGO;
  /** 公开部分（恢复时可直接核对指纹） */
  alias: string;
  /** 身份创建时间（恢复后保持原值，便于时间线对齐） */
  createdAt: number;
  fingerprint: string;
  generation: number;
  publicKey: string;
  contactCard: ContactCard;
  /** 本机名片历史（换证横幅的"旧联系方式"取自这里，所以必须随备份走） */
  cardHistory?: ContactCardVersion[];
  /** 联系信息冻结期（0 = 未冻结） */
  contactFreezeUntil?: number;
  retiredKeys: RetiredKey[];
  declarations: IdentityDeclaration[];
  kdf: { name: 'scrypt'; salt: string; N: number; r: number; p: number; keyLen: number };
  /** AES-256-GCM(scrypt(passphrase)) 包裹的 PKCS8 DER */
  blob: EncryptedBlob;
}

function buildBackup(identity: IdentityRecord, privateKeyDer: Buffer, passphrase: string): IdentityBackup {
  const salt = crypto.randomBytes(16);
  const kek = scryptKey(passphrase, salt);
  return {
    schema: IDENTITY_BACKUP_SCHEMA,
    exportedAt: Date.now(),
    algo: IDENTITY_ALGO,
    alias: identity.alias,
    createdAt: identity.createdAt,
    fingerprint: identity.fingerprint,
    generation: identity.generation,
    publicKey: identity.publicKey,
    contactCard: cloneContactCard(identity.contactCard),
    cardHistory: contactCardHistory(identity),
    contactFreezeUntil: Number(identity.contactFreezeUntil || 0),
    retiredKeys: identity.retiredKeys.map((r) => ({ ...r })),
    declarations: [...identity.declarations],
    kdf: { name: 'scrypt', salt: b64(salt), N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, keyLen: SCRYPT.keyLen },
    blob: aesGcmEncrypt(kek, privateKeyDer),
  };
}

function openBackup(
  backup: IdentityBackup,
  passphrase: string,
): { ok: true; identity: IdentityRecord; privateKeyDer: Buffer } | { ok: false; error: string } {
  if (!backup || backup.schema !== IDENTITY_BACKUP_SCHEMA || !backup.blob || !backup.kdf) return { ok: false, error: 'corrupt' };
  if (!passphrase) return { ok: false, error: 'passphrase-required' };
  let der: Buffer;
  try {
    const kek = crypto.scryptSync(passphrase, Buffer.from(backup.kdf.salt, 'base64'), backup.kdf.keyLen || SCRYPT.keyLen, {
      N: backup.kdf.N || SCRYPT.N,
      r: backup.kdf.r || SCRYPT.r,
      p: backup.kdf.p || SCRYPT.p,
      maxmem: SCRYPT.maxmem,
    });
    der = aesGcmDecrypt(kek, backup.blob);
  } catch {
    return { ok: false, error: 'bad-passphrase' };
  }
  let priv;
  try {
    priv = keyObjectFromPrivateDer(der);
  } catch {
    return { ok: false, error: 'corrupt' };
  }
  const pubB64 = publicKeyToB64(publicKeyOfPrivate(priv));
  if (fingerprintFromPublicKey(pubB64) !== backup.fingerprint) return { ok: false, error: 'key-mismatch' };
  if (!keyObjectFromPublicB64(backup.publicKey)) return { ok: false, error: 'corrupt' };
  const identity: IdentityRecord = {
    schema: IDENTITY_SCHEMA,
    algo: IDENTITY_ALGO,
    alias: backup.alias,
    fingerprint: backup.fingerprint,
    generation: backup.generation,
    createdAt: typeof backup.createdAt === 'number' && backup.createdAt > 0 ? backup.createdAt : backup.exportedAt,
    updatedAt: backup.exportedAt,
    contactCard: cloneContactCard(backup.contactCard),
    cardHistory: Array.isArray(backup.cardHistory) ? backup.cardHistory.map((v) => ({ card: cloneContactCard(v.card), at: v.at, note: v.note })) : [],
    contactFreezeUntil: Number(backup.contactFreezeUntil || 0),
    publicKey: backup.publicKey,
    retiredKeys: (backup.retiredKeys || []).map((r) => ({ ...r })),
    declarations: Array.isArray(backup.declarations) ? [...backup.declarations] : [],
  };
  return { ok: true, identity, privateKeyDer: der };
}
