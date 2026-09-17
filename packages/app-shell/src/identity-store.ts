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

export const IDENTITY_FILE_SCHEMA = 'ccarmy.identity.file.v1' as const;
export const IDENTITY_BACKUP_SCHEMA = 'ccarmy.identity.backup.v1' as const;
/** 接收方侧的对端名片状态（本机各自判定；不用任何广播的标志） */
export const PEER_CONTACTS_SCHEMA = 'ccarmy.peer-contacts.v1' as const;

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
      if (d.kind === 'ccarmy.identity.rotation') {
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
    opts: { passphrase?: string } = {},
  ): { ok: true; created: boolean; info: IdentityInfo } | Err {
    const { file, corrupt } = this.readFile();
    if (file) return { ok: true, created: false, info: this.info()! };
    if (corrupt) {
      return { ok: false, error: 'corrupt', message: '身份文件存在但无法解析；为免静默换掉身份，此处不覆盖重建（文件已隔离为 .corrupt-*）' };
    }
    const created = this.createWith(alias, contactCard, opts.passphrase);
    if (!created.ok) return created;
    return { ok: true, created: true, info: this.info()! };
  }

  /** 真正落地一个新身份（内部；不做存在性检查，用于恢复/导入） */
  private createWith(alias: string, contactCard: ContactCard | undefined, passphrase?: string): Ok<object> | Err {
    const { identity, keyPair } = createIdentity({ alias, contactCard });
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
    if (decl && (decl as { kind?: string }).kind === 'ccarmy.identity.revocation') {
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
