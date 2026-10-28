/**
 * Account / onboarding vault for WArmy.
 *
 * Threat model (honest):
 * · The vault never stores the credential or the mnemonic in clear. It stores
 *   the identity seed and the mnemonic encrypted with a master key derived
 *   from the mnemonic (PBKDF2-HMAC-SHA512) and a per-account salt.
 * · PIN login unwraps a second copy of the mnemonic with a PIN-derived KEK.
 *   A 4–20 char PIN is not a high-entropy secret, so failures are rate-limited
 *   (5 failures ⇒ 60 s lockout) and the verifier is a one-way hash.
 * · Auto-login wraps the mnemonic with Electron safeStorage and binds it to
 *   the OS account + CPU model + a random machine id. This is convenience,
 *   not a replacement for the mnemonic: changing the OS account or hardware
 *   invalidates auto-login and the mnemonic remains the only recovery path.
 * · safeStorage protects data at rest against another user / copied profile;
 *   it cannot defend against malware already running as the same OS user.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { anQuanYuanZiXieJson } from './atomic-json.js';
import {
  MASTER_KDF_ITERATIONS,
  PIN_KDF_ITERATIONS,
  PIN_MAX_FAILURES,
  PinLockout,
  bindingMatches,
  credentialFromSeed,
  decryptBlob,
  deriveMasterKey,
  deriveKroot,
  derivePinKey,
  encryptBlob,
  friendlyMnemonic,
  generateMnemonic,
  makeBindingRecord,
  mnemonicToEntropy,
  mnemonicToPinyin,
  parseMnemonicInput,
  pinVerifier,
  randomMachineId,
  seedFromCredential,
  timingSafeEqualHex,
  validatePinPair,
  wipeBuffer,
  type AuthBlob,
  type BindingRecord,
} from './auth-core.mjs';
import { shengchengPingzheng, youPingZhengQuMiyaoDui } from './credential.js';
import { fingerprintFromPublicKey } from './identity.js';
import type { ShenFenCang } from './identity-store.js';
import type { BenDiZhangHuCang, BenjiZiliao } from './settings-store.js';

export interface AuthOsProtector {
  available(): boolean;
  protect(value: string): string;
  unprotect(value: string): string;
}

export interface AuthServiceOptions {
  vaultFile: string;
  identity: ShenFenCang;
  profile: BenDiZhangHuCang;
  protector: AuthOsProtector;
  now?: () => number;
}

interface PinRecord {
  salt: string;
  iterations: number;
  verifier: string;
  wrappedMnemonic: AuthBlob;
}

interface AutoLoginRecord {
  wrappedMnemonicOs: string;
  binding: BindingRecord;
}

interface AuthVaultFile {
  schema: 'warmy.auth.v1';
  version: 1;
  createdAt: number;
  updatedAt: number;
  mnemonicConfirmed: boolean;
  pinyin: boolean;
  kdf: { salt: string; iterations: number };
  identity: { seed: AuthBlob; mnemonic: AuthBlob };
  pin: PinRecord | null;
  autoLogin: AutoLoginRecord | null;
  failedAttempts: number;
  lockUntil: number;
  lastLoginAt: number | null;
}

interface PendingRegistration {
  seed: Buffer;
  mnemonic: string;
  masterKey: Buffer;
  salt: string;
  createdAt: number;
}

interface PendingRecovery {
  seed: Buffer;
  mnemonic: string;
  masterKey: Buffer;
  kdf: { salt: string; iterations: number };
}

export interface AuthState {
  ok: true;
  hasAccount: boolean;
  vaultCorrupt: boolean;
  mnemonicConfirmed: boolean;
  pinyin: boolean;
  pinConfigured: boolean;
  autoLogin: boolean;
  autoLoginAvailable: boolean;
  unlocked: boolean;
  lockUntil: number;
  remainingAttempts: number;
  retryAfterMs: number;
  createdAt: number;
  lastLoginAt: number | null;
  hasPendingRegistration: boolean;
  hasPendingRecovery: boolean;
}

export interface AuthResult {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

function err(error: string, extra: Record<string, unknown> = {}): AuthResult {
  return { ok: false, error, ...extra };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function currentBinding(machineId: string) {
  const cpu = os.cpus()[0]?.model || '';
  return {
    osUser: (() => {
      try { return os.userInfo().username; } catch { return ''; }
    })(),
    cpu,
    machineId,
  };
}

export class AuthService {
  private readonly vaultFile: string;
  private readonly identity: ShenFenCang;
  private readonly profile: BenDiZhangHuCang;
  private readonly protector: AuthOsProtector;
  private readonly now: () => number;

  private pendingRegistration: PendingRegistration | null = null;
  private pendingRecovery: PendingRecovery | null = null;
  private sessionMasterKey: Buffer | null = null;
  private unlocked = false;

  constructor(options: AuthServiceOptions) {
    this.vaultFile = options.vaultFile;
    this.identity = options.identity;
    this.profile = options.profile;
    this.protector = options.protector;
    this.now = options.now ?? (() => Date.now());
  }

  hasAccount(): boolean {
    return this.readVault().file !== null;
  }

  state(): AuthState {
    const { file, corrupt } = this.readVault();
    if (!file) {
      return {
        ok: true,
        hasAccount: false,
        vaultCorrupt: corrupt,
        mnemonicConfirmed: false,
        pinyin: false,
        pinConfigured: false,
        autoLogin: false,
        autoLoginAvailable: false,
        unlocked: this.unlocked,
        lockUntil: 0,
        remainingAttempts: PIN_MAX_FAILURES,
        retryAfterMs: 0,
        createdAt: 0,
        lastLoginAt: null,
        hasPendingRegistration: !!this.pendingRegistration,
        hasPendingRecovery: !!this.pendingRecovery,
      };
    }
    const lock = new PinLockout(
      { failedAttempts: file.failedAttempts, lockUntil: file.lockUntil },
    ).check(this.now());
    let autoLoginAvailable = false;
    if (file.autoLogin) {
      try {
        autoLoginAvailable = this.protector.available()
          && bindingMatches(file.autoLogin.binding, currentBinding(file.autoLogin.binding.machineId));
      } catch {
        autoLoginAvailable = false;
      }
    }
    return {
      ok: true,
      hasAccount: true,
      vaultCorrupt: false,
      mnemonicConfirmed: file.mnemonicConfirmed,
      pinyin: file.pinyin,
      pinConfigured: !!file.pin,
      autoLogin: !!file.autoLogin,
      autoLoginAvailable,
      unlocked: this.unlocked,
      lockUntil: lock.lockUntil,
      remainingAttempts: lock.remainingAttempts,
      retryAfterMs: lock.retryAfterMs,
      createdAt: file.createdAt,
      lastLoginAt: file.lastLoginAt,
      hasPendingRegistration: !!this.pendingRegistration,
      hasPendingRecovery: !!this.pendingRecovery,
    };
  }

  // ── registration ──────────────────────────────────────────────────────

  registerBegin(force = false): AuthResult {
    const { file, corrupt } = this.readVault();
    if (corrupt) return err('vault-corrupt');
    if (file && !force) return err('account-exists');
    if (file && force) {
      try {
        const backup = `${this.vaultFile}.replaced-${this.now()}`;
        fs.mkdirSync(path.dirname(this.vaultFile), { recursive: true });
        fs.copyFileSync(this.vaultFile, backup);
      } catch {
        return err('backup-failed');
      }
    }
    this.clearPending();
    this.clearRecovery();
    // 复用既有凭证机制：凭证 = 32 字节种子的 51 位编码；助记词由同一份种子派生。
    const credential = shengchengPingzheng();
    const seed = seedFromCredential(credential);
    const mnemonic = generateMnemonic(seed);
    const salt = crypto.randomBytes(16).toString('base64');
    const masterKey = deriveMasterKey(mnemonic, salt, MASTER_KDF_ITERATIONS);
    const friendly = friendlyMnemonic(mnemonic);
    this.pendingRegistration = { seed, mnemonic, masterKey, salt, createdAt: this.now() };
    return {
      ok: true,
      mnemonic,
      pinyin: mnemonicToPinyin(mnemonic),
      friendlyWords: friendly.words,
      friendlyIdioms: friendly.idioms,
      wordCount: 24,
      replacing: !!file,
    };
  }

  registerCommit(payload: {
    mnemonicConfirmed?: boolean;
    pinyin?: boolean;
    autoLogin?: boolean;
    pin?: string;
    confirmPin?: string;
  }): AuthResult {
    const pending = this.pendingRegistration;
    if (!pending) return err('no-pending-registration');
    const mnemonicConfirmed = payload?.mnemonicConfirmed === true;
    const autoLogin = payload?.autoLogin === true;
    const pinyin = payload?.pinyin === true;
    if (autoLogin && !mnemonicConfirmed) return err('auto-login-requires-confirmed-mnemonic');
    if (autoLogin && (payload?.pin || payload?.confirmPin)) return err('pin-not-allowed-with-auto-login');

    let pinRecord: PinRecord | null = null;
    let autoRecord: AutoLoginRecord | null = null;
    if (autoLogin) {
      if (!this.protector.available()) return err('os-protection-unavailable');
      try {
        const machineId = randomMachineId();
        const wrappedMnemonicOs = this.protector.protect(pending.mnemonic);
        autoRecord = {
          wrappedMnemonicOs,
          binding: makeBindingRecord(currentBinding(machineId)),
        };
      } catch {
        return err('os-protection-failed');
      }
    } else {
      const pair = validatePinPair(payload?.pin, payload?.confirmPin);
      if (!pair.ok) return err(pair.error);
      try {
        const salt = crypto.randomBytes(16).toString('base64');
        const kek = derivePinKey(String(payload.pin), salt, PIN_KDF_ITERATIONS);
        pinRecord = {
          salt,
          iterations: PIN_KDF_ITERATIONS,
          verifier: pinVerifier(kek),
          wrappedMnemonic: encryptBlob(kek, pending.mnemonic),
        };
        wipeBuffer(kek);
      } catch {
        return err('pin-setup-failed');
      }
    }

    const file: AuthVaultFile = {
      schema: 'warmy.auth.v1',
      version: 1,
      createdAt: pending.createdAt,
      updatedAt: this.now(),
      mnemonicConfirmed,
      pinyin,
      kdf: { salt: pending.salt, iterations: MASTER_KDF_ITERATIONS },
      identity: {
        seed: encryptBlob(pending.masterKey, pending.seed),
        mnemonic: encryptBlob(pending.masterKey, pending.mnemonic),
      },
      pin: pinRecord,
      autoLogin: autoRecord,
      failedAttempts: 0,
      lockUntil: 0,
      lastLoginAt: this.now(),
    };

    const applied = this.applyIdentity(pending.seed, pending.masterKey);
    if (!applied.ok) return applied;
    if (!this.hideProfileCredential()) return err('profile-write-failed');
    const written = this.writeVault(file);
    if (!written.ok) return written;

    this.unlocked = true;
    this.sessionMasterKey = pending.masterKey;
    pending.seed.fill(0);
    this.pendingRegistration = null;
    return { ok: true, state: this.state() };
  }

  registerCancel(): AuthResult {
    this.clearPending();
    this.clearRecovery();
    return { ok: true };
  }

  // ── login ─────────────────────────────────────────────────────────────

  loginPin(pin: unknown): AuthResult {
    const { file } = this.readVault();
    if (!file) return err('no-account');
    if (!file.pin) return err('pin-not-configured');
    const lock = new PinLockout(
      { failedAttempts: file.failedAttempts, lockUntil: file.lockUntil },
    );
    const check = lock.check(this.now());
    if (!check.allowed) {
      return err('locked', {
        lockUntil: check.lockUntil,
        remainingAttempts: check.remainingAttempts,
        retryAfterMs: check.retryAfterMs,
        state: this.state(),
      });
    }
    let kek: Buffer;
    try {
      kek = derivePinKey(String(pin ?? ''), file.pin.salt, file.pin.iterations);
    } catch {
      return err('bad-pin', { remainingAttempts: check.remainingAttempts });
    }
    if (!timingSafeEqualHex(pinVerifier(kek), file.pin.verifier)) {
      wipeBuffer(kek);
      const snap = lock.fail(this.now());
      file.failedAttempts = snap.failedAttempts;
      file.lockUntil = snap.lockUntil;
      file.updatedAt = this.now();
      this.writeVault(file);
      return err(snap.locked ? 'locked' : 'bad-pin', {
        lockUntil: snap.lockUntil,
        remainingAttempts: snap.remainingAttempts,
        retryAfterMs: snap.retryAfterMs,
        state: this.state(),
      });
    }

    let mnemonic = '';
    let masterKey: Buffer | null = null;
    let seed: Buffer | null = null;
    try {
      mnemonic = decryptBlob(kek, file.pin.wrappedMnemonic).toString('utf8');
      masterKey = deriveMasterKey(mnemonic, file.kdf.salt, file.kdf.iterations);
      seed = decryptBlob(masterKey, file.identity.seed);
      const entropy = mnemonicToEntropy(mnemonic);
      if (entropy.length !== seed.length || !crypto.timingSafeEqual(entropy, seed)) {
        throw new Error('seed-mismatch');
      }
      const applied = this.applyIdentity(seed, masterKey);
      if (!applied.ok) {
        wipeBuffer(masterKey);
        wipeBuffer(seed);
        return applied;
      }
    } catch {
      wipeBuffer(kek);
      wipeBuffer(masterKey);
      wipeBuffer(seed);
      return err('vault-corrupt');
    } finally {
      wipeBuffer(kek);
    }
    if (!masterKey || !seed) return err('vault-corrupt');

    const reset = lock.success();
    file.failedAttempts = reset.failedAttempts;
    file.lockUntil = reset.lockUntil;
    file.lastLoginAt = this.now();
    file.updatedAt = this.now();
    const written = this.writeVault(file);
    if (!written.ok) {
      wipeBuffer(masterKey);
      wipeBuffer(seed);
      return written;
    }
    this.sessionMasterKey = masterKey;
    this.unlocked = true;
    wipeBuffer(seed);
    return {
      ok: true,
      state: this.state(),
      ...(file.mnemonicConfirmed ? {} : {
        mnemonic,
        pinyin: mnemonicToPinyin(mnemonic),
      }),
    };
  }

  loginAuto(): AuthResult {
    const { file } = this.readVault();
    if (!file) return err('no-account');
    if (!file.autoLogin) return err('auto-login-not-enabled');
    if (!this.protector.available()) return err('os-protection-unavailable');
    const fields = currentBinding(file.autoLogin.binding.machineId);
    if (!bindingMatches(file.autoLogin.binding, fields)) {
      return err('binding-invalid', { state: this.state() });
    }
    let mnemonic = '';
    let masterKey: Buffer | null = null;
    let seed: Buffer | null = null;
    try {
      mnemonic = this.protector.unprotect(file.autoLogin.wrappedMnemonicOs);
      masterKey = deriveMasterKey(mnemonic, file.kdf.salt, file.kdf.iterations);
      seed = decryptBlob(masterKey, file.identity.seed);
      const applied = this.applyIdentity(seed, masterKey);
      if (!applied.ok) {
        wipeBuffer(masterKey);
        wipeBuffer(seed);
        return applied;
      }
    } catch {
      wipeBuffer(masterKey);
      wipeBuffer(seed);
      return err('auto-login-failed', { state: this.state() });
    }
    if (!masterKey || !seed) return err('auto-login-failed', { state: this.state() });
    file.lastLoginAt = this.now();
    file.failedAttempts = 0;
    file.lockUntil = 0;
    file.updatedAt = this.now();
    const written = this.writeVault(file);
    if (!written.ok) {
      wipeBuffer(masterKey);
      wipeBuffer(seed);
      return written;
    }
    this.sessionMasterKey = masterKey;
    this.unlocked = true;
    wipeBuffer(seed);
    return { ok: true, state: this.state() };
  }

  // ── mnemonic recovery ─────────────────────────────────────────────────

  recoverBegin(mnemonicInput: unknown): AuthResult {
    const { file } = this.readVault();
    if (!file) return err('no-account');
    let mnemonic = '';
    try {
      mnemonic = parseMnemonicInput(String(mnemonicInput ?? ''));
      mnemonicToEntropy(mnemonic);
    } catch {
      return err('bad-mnemonic');
    }
    let masterKey: Buffer | null = null;
    let seed: Buffer | null = null;
    try {
      masterKey = deriveMasterKey(mnemonic, file.kdf.salt, file.kdf.iterations);
      seed = decryptBlob(masterKey, file.identity.seed);
      const entropy = mnemonicToEntropy(mnemonic);
      if (entropy.length !== seed.length || !crypto.timingSafeEqual(entropy, seed)) {
        throw new Error('mismatch');
      }
    } catch {
      wipeBuffer(masterKey);
      wipeBuffer(seed);
      return err('bad-mnemonic');
    }
    this.clearPending();
    this.clearRecovery();
    this.pendingRecovery = { mnemonic, seed, masterKey, kdf: { ...file.kdf } };
    const friendly = friendlyMnemonic(mnemonic);
    return { ok: true, pinyin: mnemonicToPinyin(mnemonic), friendlyWords: friendly.words, friendlyIdioms: friendly.idioms };
  }

  recoverCommit(payload: {
    pinyin?: boolean;
    autoLogin?: boolean;
    pin?: string;
    confirmPin?: string;
  }): AuthResult {
    const pending = this.pendingRecovery;
    if (!pending) return err('no-pending-recovery');
    const autoLogin = payload?.autoLogin === true;
    if (autoLogin && (payload?.pin || payload?.confirmPin)) return err('pin-not-allowed-with-auto-login');
    let pinRecord: PinRecord | null = null;
    let autoRecord: AutoLoginRecord | null = null;
    if (autoLogin) {
      if (!this.protector.available()) return err('os-protection-unavailable');
      try {
        const machineId = randomMachineId();
        autoRecord = {
          wrappedMnemonicOs: this.protector.protect(pending.mnemonic),
          binding: makeBindingRecord(currentBinding(machineId)),
        };
      } catch {
        return err('os-protection-failed');
      }
    } else {
      const pair = validatePinPair(payload?.pin, payload?.confirmPin);
      if (!pair.ok) return err(pair.error);
      try {
        const salt = crypto.randomBytes(16).toString('base64');
        const kek = derivePinKey(String(payload.pin), salt, PIN_KDF_ITERATIONS);
        pinRecord = {
          salt,
          iterations: PIN_KDF_ITERATIONS,
          verifier: pinVerifier(kek),
          wrappedMnemonic: encryptBlob(kek, pending.mnemonic),
        };
        wipeBuffer(kek);
      } catch {
        return err('pin-setup-failed');
      }
    }

    // 登录方式的重设不能改变旧数据仓库仍在使用的主密钥。
    const masterKey = Buffer.from(pending.masterKey);
    const file: AuthVaultFile = {
      schema: 'warmy.auth.v1',
      version: 1,
      createdAt: this.now(),
      updatedAt: this.now(),
      mnemonicConfirmed: true,
      pinyin: payload?.pinyin === true,
      kdf: { ...pending.kdf },
      identity: {
        seed: encryptBlob(masterKey, pending.seed),
        mnemonic: encryptBlob(masterKey, pending.mnemonic),
      },
      pin: pinRecord,
      autoLogin: autoRecord,
      failedAttempts: 0,
      lockUntil: 0,
      lastLoginAt: this.now(),
    };
    const applied = this.applyIdentity(pending.seed, masterKey);
    if (!applied.ok) {
      wipeBuffer(masterKey);
      return applied;
    }
    if (!this.hideProfileCredential()) {
      wipeBuffer(masterKey);
      return err('profile-write-failed');
    }
    const written = this.writeVault(file);
    if (!written.ok) {
      wipeBuffer(masterKey);
      return written;
    }
    this.unlocked = true;
    this.sessionMasterKey = masterKey;
    wipeBuffer(pending.masterKey);
    wipeBuffer(pending.seed);
    this.pendingRecovery = null;
    return { ok: true, state: this.state() };
  }

  // ── session / My page ─────────────────────────────────────────────────

  /**
   * 第 104 轮：数据仓库解锁需要账号主密钥的**副本**。
   * 调用方用完必须自己清零；AuthService 仍持有原密钥，logout/lock 时照常擦除。
   */
  sessionMasterKeyCopy(): Buffer | null {
    return this.sessionMasterKey ? Buffer.from(this.sessionMasterKey) : null;
  }

  /**
   * 稳定恢复根 Kroot 的会话副本（第 111 轮）。调用方用完清零。
   * 只由助记词熵派生，不含账号随机盐 ⇒ 同一句助记词在新设备上得到同一把根密钥。
   */
  sessionKrootCopy(): Buffer | null {
    if (!this.unlocked || !this.sessionMasterKey) return null;
    const { file } = this.readVault();
    if (!file) return null;
    try {
      const mnemonic = decryptBlob(this.sessionMasterKey, file.identity.mnemonic).toString('utf8');
      return deriveKroot(mnemonic);
    } catch {
      return null;
    }
  }

  /**
   * 第 104 轮：登录成功 → 解包数据 → 重启应用后，用一次性令牌里的主密钥恢复会话。
   * 不经过 PIN/助记词输入，但必须能解开 auth/vault.json 的 seed 并与助记词一致。
   */
  resumeWithMasterKey(masterKey: Buffer): AuthResult {
    if (!masterKey || masterKey.length !== 32) return err('bad-session-key');
    if (this.unlocked && this.sessionMasterKey) return { ok: true, state: this.state() };
    const { file } = this.readVault();
    if (!file) return err('no-account');
    let seed: Buffer | null = null;
    try {
      const mnemonic = decryptBlob(masterKey, file.identity.mnemonic).toString('utf8');
      seed = decryptBlob(masterKey, file.identity.seed);
      const entropy = mnemonicToEntropy(mnemonic);
      if (entropy.length !== seed.length || !crypto.timingSafeEqual(entropy, seed)) throw new Error('seed-mismatch');
      const applied = this.applyIdentity(seed, masterKey);
      if (!applied.ok) return applied;
    } catch {
      return err('vault-corrupt');
    } finally {
      if (seed) wipeBuffer(seed);
    }
    this.sessionMasterKey = Buffer.from(masterKey);
    this.unlocked = true;
    file.lastLoginAt = this.now();
    file.updatedAt = this.now();
    const written = this.writeVault(file);
    if (!written.ok) {
      this.lockSession();
      return written;
    }
    return { ok: true, state: this.state() };
  }

  changePin(payload: { pin?: string; confirmPin?: string; disableAutoLogin?: boolean }): AuthResult {
    const { file } = this.readVault();
    if (!file) return err('no-account');
    if (file.autoLogin && payload?.disableAutoLogin !== true) return err('auto-login-enabled');
    if (!this.unlocked || !this.sessionMasterKey) return err('locked');
    const pair = validatePinPair(payload?.pin, payload?.confirmPin);
    if (!pair.ok) return err(pair.error);
    let mnemonic = '';
    try {
      mnemonic = decryptBlob(this.sessionMasterKey, file.identity.mnemonic).toString('utf8');
      const salt = crypto.randomBytes(16).toString('base64');
      const kek = derivePinKey(String(payload.pin), salt, PIN_KDF_ITERATIONS);
      file.pin = {
        salt,
        iterations: PIN_KDF_ITERATIONS,
        verifier: pinVerifier(kek),
        wrappedMnemonic: encryptBlob(kek, mnemonic),
      };
      wipeBuffer(kek);
    } catch {
      return err('vault-corrupt');
    }
    // R78 #9：同一笔写入里“设好 PIN + 关闭自动登录”，不会出现已关自动登录却没有 PIN 的中间态。
    if (payload?.disableAutoLogin === true) file.autoLogin = null;
    file.failedAttempts = 0;
    file.lockUntil = 0;
    file.updatedAt = this.now();
    const written = this.writeVault(file);
    if (!written.ok) return written;
    // 从「我的页」设置 PIN 并关闭自动登录时不要顺手锁掉当前会话；普通改 PIN 才要求重新登录。
    if (payload?.disableAutoLogin !== true) this.lockSession();
    return { ok: true, locked: true, state: this.state() };
  }

  viewMnemonic(): AuthResult {
    const { file } = this.readVault();
    if (!file) return err('no-account');
    if (!this.unlocked || !this.sessionMasterKey) return err('locked');
    try {
      const mnemonic = decryptBlob(this.sessionMasterKey, file.identity.mnemonic).toString('utf8');
      const friendly = friendlyMnemonic(mnemonic);
      return {
        ok: true,
        mnemonic,
        pinyin: mnemonicToPinyin(mnemonic),
        friendlyWords: friendly.words,
        friendlyIdioms: friendly.idioms,
        mnemonicConfirmed: file.mnemonicConfirmed,
      };
    } catch {
      return err('vault-corrupt');
    }
  }

  confirmMnemonic(mode: unknown): AuthResult {
    const { file } = this.readVault();
    if (!file) return err('no-account');
    if (mode !== 'confirm' && mode !== 'later') return err('bad-mode');
    file.mnemonicConfirmed = mode === 'confirm';
    // Older builds could have left a plaintext field; remove it if present.
    const legacy = file as unknown as Record<string, unknown>;
    delete legacy.pendingMnemonic;
    delete legacy.pendingMnemonicPlain;
    file.updatedAt = this.now();
    const written = this.writeVault(file);
    if (!written.ok) return written;
    return { ok: true, state: this.state(), mnemonicConfirmed: file.mnemonicConfirmed };
  }

  setPinyin(enabled: unknown): AuthResult {
    const { file } = this.readVault();
    if (!file) return err('no-account');
    file.pinyin = enabled === true;
    file.updatedAt = this.now();
    const written = this.writeVault(file);
    if (!written.ok) return written;
    return { ok: true, pinyin: file.pinyin };
  }

  /**
   * My page auto-login switch. Turning it on needs a confirmed mnemonic and a
   * usable OS protector; it wraps the same mnemonic with safeStorage and binds
   * it to this OS account/CPU/random machine id. Turning it on replaces the
   * autoLogin record **and removes the old PIN**: a newly generated local
   * credential must never leave the old PIN valid. Turning it off deletes the
   * autoLogin record; the user can then set a new PIN.
   */
  setAutoLogin(enabled: unknown): AuthResult {
    const { file } = this.readVault();
    if (!file) return err('no-account');
    const want = enabled === true || (isRecord(enabled) && enabled.enabled === true);
    if (!want) {
      file.autoLogin = null;
      file.updatedAt = this.now();
      const written = this.writeVault(file);
      if (!written.ok) return written;
      return { ok: true, state: this.state() };
    }
    if (!file.mnemonicConfirmed) return err('auto-login-requires-confirmed-mnemonic');
    if (!this.unlocked || !this.sessionMasterKey) return err('locked');
    if (!this.protector.available()) return err('os-protection-unavailable');
    try {
      const mnemonic = decryptBlob(this.sessionMasterKey, file.identity.mnemonic).toString('utf8');
      const machineId = randomMachineId();
      file.autoLogin = {
        wrappedMnemonicOs: this.protector.protect(mnemonic),
        binding: makeBindingRecord(currentBinding(machineId)),
      };
      // A new auto-login credential invalidates the old manual PIN.
      file.pin = null;
      file.failedAttempts = 0;
      file.lockUntil = 0;
    } catch {
      return err('auto-login-failed');
    }
    file.updatedAt = this.now();
    const written = this.writeVault(file);
    if (!written.ok) return written;
    return { ok: true, state: this.state() };
  }

  /**
   * Local display name. 1–30 Unicode graphemes (Intl.Segmenter, so uppercase,
   * spaces and Emoji/ZWJ sequences are all counted correctly), trimmed and
   * non-empty, no control characters. The profile's deviceId/email/avatar are
   * preserved because we merge into the existing record.
   */
  setUsername(name: unknown): AuthResult {
    const input = isRecord(name) ? name.username : name;
    const raw = String(input == null ? '' : input);
    const trimmed = raw.trim();
    if (!trimmed) return err('bad-username');
    if (/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/.test(trimmed)) return err('bad-username');
    let count = 0;
    try {
      const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' });
      count = Array.from(segmenter.segment(trimmed)).length;
    } catch {
      count = Array.from(trimmed).length;
    }
    if (count < 1 || count > 30) return err('bad-username');
    try {
      const prev = this.profile.loadProfile();
      const next: BenjiZiliao = { ...prev, username: trimmed };
      this.profile.saveProfile(next);
      return { ok: true, username: trimmed };
    } catch {
      return err('profile-write-failed');
    }
  }

  logout(): AuthResult {
    this.lockSession();
    try { this.identity.lock(); } catch { /* best effort */ }
    return { ok: true, state: this.state() };
  }

  lock(): AuthResult {
    this.lockSession();
    try { this.identity.lock(); } catch { /* best effort */ }
    return { ok: true };
  }

  // ── internals ─────────────────────────────────────────────────────────

  private lockSession(): void {
    wipeBuffer(this.sessionMasterKey);
    this.sessionMasterKey = null;
    this.unlocked = false;
  }

  private clearPending(): void {
    if (this.pendingRegistration) {
      wipeBuffer(this.pendingRegistration.seed);
      wipeBuffer(this.pendingRegistration.masterKey);
      this.pendingRegistration = null;
    }
  }

  private clearRecovery(): void {
    if (this.pendingRecovery) {
      wipeBuffer(this.pendingRecovery.seed);
      wipeBuffer(this.pendingRecovery.masterKey);
      this.pendingRecovery = null;
    }
  }

  private readVault(): { file: AuthVaultFile | null; corrupt: boolean } {
    try {
      if (!fs.existsSync(this.vaultFile)) return { file: null, corrupt: false };
      const raw = fs.readFileSync(this.vaultFile, 'utf8');
      if (!raw.trim()) return { file: null, corrupt: true };
      const parsed = JSON.parse(raw) as unknown;
      if (!isRecord(parsed) || parsed.schema !== 'warmy.auth.v1' || parsed.version !== 1) {
        return { file: null, corrupt: true };
      }
      if (!isRecord(parsed.kdf) || !isRecord(parsed.identity)) return { file: null, corrupt: true };
      if (!isRecord(parsed.identity.seed) || !isRecord(parsed.identity.mnemonic)) return { file: null, corrupt: true };
      if (parsed.pin !== null && !isRecord(parsed.pin)) return { file: null, corrupt: true };
      if (parsed.autoLogin !== null && !isRecord(parsed.autoLogin)) return { file: null, corrupt: true };
      return { file: parsed as unknown as AuthVaultFile, corrupt: false };
    } catch {
      return { file: null, corrupt: true };
    }
  }

  private writeVault(file: AuthVaultFile): AuthResult {
    file.updatedAt = this.now();
    const result = anQuanYuanZiXieJson(this.vaultFile, file);
    if (!result.ok) return err('vault-write-failed');
    return { ok: true };
  }

  private hideProfileCredential(): boolean {
    try {
      const prev = this.profile.loadProfile();
      const next: BenjiZiliao = {
        ...prev,
        deviceId: '',
        deviceIdSig: undefined,
        deviceIdUpgradedFrom: undefined,
        authManaged: true,
      };
      delete next.deviceIdSig;
      delete next.deviceIdUpgradedFrom;
      this.profile.saveProfile(next);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Bind the existing identity-store record to the seed derived from the
   * mnemonic. The store's DEK is re-wrapped with a master-key-derived
   * passphrase, so the identity file alone no longer opens on this machine.
   */
  private applyIdentity(seed: Buffer, masterKey: Buffer): AuthResult {
    const credential = credentialFromSeed(seed);
    let expectedFingerprint = '';
    try {
      expectedFingerprint = fingerprintFromPublicKey(youPingZhengQuMiyaoDui(credential).publicKeyB64);
    } catch {
      return err('credential-derivation-failed');
    }
    // 身份库的 DEK 直接用助记词派生的主密钥包裹；身份文件离开助记词无法解开。
    const passphrase = masterKey.toString('base64');
    const info = this.identity.info();
    try {
      if (!this.identity.exists()) {
        const profile = this.profile.loadProfile();
        const created = this.identity.ensureIdentity(
          String(profile?.username || '老板'),
          undefined,
          { credential, passphrase },
        );
        if (!created.ok) return err(created.error || 'identity-create-failed');
        return { ok: true };
      }
      if (!info || info.zhiWen !== expectedFingerprint) {
        const restored = this.identity.restoreFromCredential(
          credential,
          this.profile.loadProfile()?.username,
        );
        if (restored.ok) { try { this.identity.setPassphrase(passphrase); } catch { /* best effort */ } }
        if (!restored.ok) return err(restored.error || 'identity-restore-failed');
      }
      const current = this.identity.info();
      if (current?.passphraseProtected) {
        const unlocked = this.identity.unlock(passphrase);
        if (!unlocked.ok) {
          // 同一指纹但口令不同 / 本机旧口令保护：用助记词 seed 重建（旧身份先备份）。
          const restored = this.identity.restoreFromCredential(
            credential,
            this.profile.loadProfile()?.username,
          );
          if (restored.ok) { try { this.identity.setPassphrase(passphrase); } catch { /* best effort */ } }
          if (!restored.ok) return err(restored.error || 'identity-restore-failed');
        }
      } else {
        const unlocked = this.identity.unlock();
        if (!unlocked.ok) {
          // OS 钥匙串不可用（例如 Linux basic_text/换机器）：直接用助记词 seed + 口令重建。
          const restored = this.identity.restoreFromCredential(
            credential,
            this.profile.loadProfile()?.username,
          );
          if (restored.ok) { try { this.identity.setPassphrase(passphrase); } catch { /* best effort */ } }
          if (!restored.ok) return err(restored.error || 'identity-restore-failed');
        } else {
          const wrapped = this.identity.setPassphrase(passphrase);
          if (!wrapped.ok) return err(wrapped.error || 'identity-passphrase-failed');
        }
      }
      return { ok: true };
    } catch {
      return err('identity-apply-failed');
    }
  }
}
