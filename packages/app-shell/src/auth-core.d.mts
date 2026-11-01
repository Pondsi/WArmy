export const AUTH_CORE_VERSION: number;
export const MNEMONIC_WORDS: number;
export const PIN_MIN: number;
export const PIN_MAX: number;
export const PIN_MAX_FAILURES: number;
export const PIN_LOCK_MS: number;
export const MASTER_KDF_ITERATIONS: number;
export const PIN_KDF_ITERATIONS: number;
export const CREDENTIAL_ALPHABET: string;
export const CREDENTIAL_LENGTH: number;

export interface AuthBlob {
  v: 1;
  alg: 'aes-256-gcm';
  iv: string;
  tag: string;
  ct: string;
}

export interface BindingFields {
  osUser: string;
  cpu: string;
  machineId: string;
}

export interface BindingRecord {
  v: 1;
  tag: string;
  osUserHash: string;
  cpuHash: string;
  machineIdHash: string;
  machineId: string;
}

export interface LockoutSnapshot {
  allowed: boolean;
  locked: boolean;
  failedAttempts: number;
  remainingAttempts: number;
  lockUntil: number;
  retryAfterMs: number;
}

export function sha256Hex(value: unknown): string;
export function timingSafeEqualHex(a: string, b: string): boolean;
export function generateMnemonic(entropy?: Buffer): string;
export function mnemonicToEntropy(mnemonic: string): Buffer;
export function isValidMnemonic(mnemonic: string): boolean;
export function normalizeEnglishWords(text: string): string[];
export function isPinyinPhrase(text: string): boolean;
export function parseMnemonicInput(text: string): string;
export function friendlyMnemonic(mnemonic: string): { words: Array<{ w: string; p: string }>; idioms: Array<{ w: string; p: string }> };
export function mnemonicToPinyin(mnemonic: string): string;
export function pinyinToMnemonic(pinyin: string): string;
export function deriveKroot(mnemonic: string): Buffer;
export function krootFingerprint(kroot: Buffer): string;
export function deriveMasterKey(mnemonic: string, saltB64: string, iterations?: number): Buffer;
export function derivePinKey(pin: string, saltB64: string, iterations?: number): Buffer;
export function pinVerifier(key: Buffer): string;
export function encryptBlob(key: Buffer, plaintext: Buffer | string): AuthBlob;
export function decryptBlob(key: Buffer, blob: AuthBlob): Buffer;
export function validatePin(pin: unknown): { ok: true } | { ok: false; error: string };
export function validatePinPair(pin: unknown, confirm: unknown): { ok: true } | { ok: false; error: string };
export function isAutoLoginBindingComplete(fields: Partial<BindingFields> | null | undefined): boolean;
export function bindingTag(fields: BindingFields): string;
export function makeBindingRecord(fields: BindingFields): BindingRecord;
export function bindingMatches(record: BindingRecord | null | undefined, fields: BindingFields): boolean;
export function randomMachineId(): string;
export class PinLockout {
  constructor(state?: { failedAttempts?: number; lockUntil?: number }, options?: { max?: number; lockMs?: number });
  max: number;
  lockMs: number;
  failedAttempts: number;
  lockUntil: number;
  check(now?: number): LockoutSnapshot;
  fail(now?: number): LockoutSnapshot;
  success(): LockoutSnapshot;
  snapshot(now?: number): LockoutSnapshot;
}
export function credentialFromSeed(seed: Buffer): string;
export function seedFromCredential(credential: string): Buffer;
export function wipeBuffer(buf: Buffer | null | undefined): void;
