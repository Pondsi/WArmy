/**
 * WArmy auth core — pure, dependency-free primitives.
 *
 * This module is intentionally plain ESM (`auth-core.mjs`) so the same code is
 * exercised by the main process and by `scripts/verify-r66-auth.mjs`.
 *
 * Design notes
 * ------------
 * · Mnemonic: 24 BIP-39 English words (256-bit entropy + 8-bit checksum).
 *   The phrase is derived from the existing 51-char credential seed; the
 *   credential itself is never persisted by the auth vault.
 * · Master key: PBKDF2-HMAC-SHA512 over the canonical English mnemonic with a
 *   random per-account salt and a WArmy domain separator. BIP-39 itself uses
 *   PBKDF2-HMAC-SHA512 (2048 iterations, salt "mnemonic"+passphrase) only to
 *   turn a phrase into a seed; we deliberately use a stronger, app-specific
 *   KDF because this key encrypts the identity seed at rest.
 * · PIN: 4–20 ASCII letters/digits, hashed with PBKDF2 + per-account salt.
 *   A PIN has low entropy, so the vault also enforces lockout after repeated
 *   failures and never stores the PIN-derived KEK in clear.
 * · Auto-login: the OS account name + CPU model + a random machine id are
 *   bound into a SHA-256 tag. The mnemonic copy needed by auto-login is
 *   wrapped with Electron safeStorage (DPAPI/Keychain/libsecret), so copying
 *   the vault to another machine is not enough.
 * · Chinese-friendly mode: every BIP-39 word index is mapped to a unique
 *   two-syllable pinyin token. It is a pronunciation-friendly encoding, not a
 *   translation; the mapping is deterministic and reversible to the exact
 *   English mnemonic.
 */
import crypto from 'node:crypto';
import { WORDLIST } from './auth-wordlist.mjs';
import { FRIEND_WORDS } from './auth-friend-words.mjs';
import { FRIEND_IDIOMS } from './auth-friend-idioms.mjs';

export const AUTH_CORE_VERSION = 1;
export const MNEMONIC_WORDS = 24;
export const PIN_MIN = 4;
export const PIN_MAX = 20;
export const PIN_MAX_FAILURES = 5;
export const PIN_LOCK_MS = 60_000;
export const MASTER_KDF_ITERATIONS = 310_000;
export const PIN_KDF_ITERATIONS = 210_000;
export const CREDENTIAL_ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVWXY';
export const CREDENTIAL_LENGTH = 51;

const MASTER_KDF_DOMAIN = 'warmy-auth-master-v1|';
const PIN_KDF_DOMAIN = 'warmy-auth-pin-v1|';
const PIN_VERIFIER_DOMAIN = 'warmy-auth-pin-verifier-v1|';
const BLOB_AAD = 'warmy-auth-v1';
const BINDING_DOMAIN = 'warmy-auth-binding-v1|';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function bytesToBits(buf) {
  let out = '';
  for (const b of buf) out += b.toString(2).padStart(8, '0');
  return out;
}

function bitsToBytes(bits) {
  assert(bits.length % 8 === 0, 'auth: invalid bit length');
  const out = Buffer.alloc(bits.length / 8);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return out;
}

export function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

export function timingSafeEqualHex(a, b) {
  const aa = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

/** BIP-39 checksum + word encoding. Entropy must be 16/20/24/28/32 bytes. */
export function generateMnemonic(entropy = crypto.randomBytes(32)) {
  assert(Buffer.isBuffer(entropy), 'auth: entropy must be a Buffer');
  const entBits = entropy.length * 8;
  assert(entBits >= 128 && entBits <= 256 && entBits % 32 === 0, 'auth: entropy must be 128..256 bits and divisible by 32');
  const csBits = entBits / 32;
  const checksum = crypto.createHash('sha256').update(entropy).digest();
  const bits = bytesToBits(entropy) + bytesToBits(checksum).slice(0, csBits);
  const words = [];
  for (let i = 0; i < bits.length; i += 11) {
    words.push(WORDLIST[parseInt(bits.slice(i, i + 11), 2)]);
  }
  return words.join(' ');
}

/** Reverse BIP-39. Throws on unknown words, bad word count, or checksum mismatch. */
export function mnemonicToEntropy(mnemonic) {
  const words = normalizeEnglishWords(mnemonic);
  assert([12, 15, 18, 21, 24].includes(words.length), 'auth: mnemonic must contain 12/15/18/21/24 words');
  let bits = '';
  for (const word of words) {
    const index = WORDLIST.indexOf(word);
    assert(index >= 0, `auth: unknown mnemonic word: ${word}`);
    bits += index.toString(2).padStart(11, '0');
  }
  const csBits = bits.length / 33;
  const entBits = bits.length - csBits;
  const entropy = bitsToBytes(bits.slice(0, entBits));
  const checksum = bytesToBits(crypto.createHash('sha256').update(entropy).digest()).slice(0, csBits);
  assert(bits.slice(entBits) === checksum, 'auth: mnemonic checksum mismatch');
  return entropy;
}

export function isValidMnemonic(mnemonic) {
  try {
    mnemonicToEntropy(parseMnemonicInput(mnemonic));
    return true;
  } catch {
    return false;
  }
}

export function normalizeEnglishWords(text) {
  return String(text || '')
    .normalize('NFKD')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

// 32 first-syllable tokens × 64 second-syllable tokens = 2048 unique groups.
const PY_A = [
  'a1', 'ai1', 'an1', 'ang1', 'ao1', 'ba1', 'bai1', 'ban1',
  'bang1', 'bao1', 'bei1', 'ben1', 'beng1', 'bi1', 'bian1', 'biao1',
  'bie1', 'bin1', 'bing1', 'bo1', 'bu1', 'ca1', 'cai1', 'can1',
  'cang1', 'cao1', 'ce1', 'cen1', 'ceng1', 'cha1', 'chai1', 'chan1',
];
const PY_B = [
  'chang1', 'chao1', 'che1', 'chen1', 'cheng1', 'chi1', 'chong1', 'chou1',
  'chu1', 'chua1', 'chuai1', 'chuan1', 'chuang1', 'chui1', 'chun1', 'chuo1',
  'ci1', 'cong1', 'cou1', 'cu1', 'cuan1', 'cui1', 'cun1', 'cuo1',
  'da1', 'dai1', 'dan1', 'dang1', 'dao1', 'de1', 'dei1', 'deng1',
  'di1', 'dian1', 'diao1', 'die1', 'ding1', 'diu1', 'dong1', 'dou1',
  'du1', 'duan1', 'dui1', 'dun1', 'duo1', 'e1', 'ei1', 'en1',
  'eng1', 'er1', 'fa1', 'fan1', 'fang1', 'fei1', 'fen1', 'feng1',
  'fo1', 'fou1', 'fu1', 'ga1', 'gai1', 'gan1', 'gang1', 'gao1',
];
assert(PY_A.length === 32 && PY_B.length === 64, 'auth: pinyin table must be 32×64');

function pinyinTokenForIndex(index) {
  return `${PY_A[index % 32]}-${PY_B[Math.floor(index / 32)]}`;
}

const PINYIN_TO_INDEX = new Map();
/** 展示用全拼：去掉音调数字和连字符后的两个音节，如 "a chang" → 单词索引。 */
const DISPLAY_PINYIN_TO_INDEX = new Map();
const DISPLAY_PINYIN_SYLLABLES = new Set();
for (let i = 0; i < WORDLIST.length; i++) {
  const token = pinyinTokenForIndex(i);
  PINYIN_TO_INDEX.set(token, i);
  const parts = token.replace(/[0-9]/g, '').split('-');
  for (const part of parts) DISPLAY_PINYIN_SYLLABLES.add(part);
  DISPLAY_PINYIN_TO_INDEX.set(parts.join(' '), i);
}
assert(DISPLAY_PINYIN_TO_INDEX.size === WORDLIST.length, 'auth: display pinyin mapping must be unique');

/**
 * 中文友好型的新码本：每个 BIP-39 index 对应一个真实的两字词/四字成语。
 * 词/成语的身份是码字，拼音只是它的真实读音；不是把英文词翻译成中文。
 * 24 个格子的词序仍然映射到原来的 24 个 BIP-39 index，校验位/种子完全不变。
 * 这样用户看到的每一个词组/成语都真实存在，拼音也真实存在，不会再出现
 * “把相邻两个词的音节硬拼成一个不存在的组合”。
 */
assert(FRIEND_WORDS.length === WORDLIST.length && FRIEND_IDIOMS.length === WORDLIST.length, 'auth: friendly codebook must be 2048');
const FRIEND_WORD_TO_INDEX = new Map();
const FRIEND_WORD_PINYIN_TO_INDEX = new Map();
const FRIEND_IDIOM_TO_INDEX = new Map();
const FRIEND_IDIOM_PINYIN_TO_INDEX = new Map();
for (let i = 0; i < WORDLIST.length; i++) {
  const w = FRIEND_WORDS[i];
  const id = FRIEND_IDIOMS[i];
  assert(w && id && w.w && w.p && id.w && id.p, 'auth: invalid friendly codebook entry');
  assert(!FRIEND_WORD_TO_INDEX.has(w.w), 'auth: duplicate friendly word');
  assert(!FRIEND_WORD_PINYIN_TO_INDEX.has(w.p), 'auth: duplicate friendly word pinyin');
  assert(!FRIEND_IDIOM_TO_INDEX.has(id.w), 'auth: duplicate friendly idiom');
  assert(!FRIEND_IDIOM_PINYIN_TO_INDEX.has(id.p), 'auth: duplicate friendly idiom pinyin');
  FRIEND_WORD_TO_INDEX.set(w.w, i);
  FRIEND_WORD_PINYIN_TO_INDEX.set(w.p, i);
  FRIEND_IDIOM_TO_INDEX.set(id.w, i);
  FRIEND_IDIOM_PINYIN_TO_INDEX.set(id.p, i);
}
assert(FRIEND_WORD_TO_INDEX.size === WORDLIST.length && FRIEND_IDIOM_TO_INDEX.size === WORDLIST.length, 'auth: friendly mapping size');

/** 一个格子里的内容 → BIP-39 index；英文、两字词、四字成语、真实拼音都可。 */
function friendlyTokenToIndex(token) {
  const t = String(token == null ? '' : token).trim();
  if (!t) return null;
  const low = t.toLowerCase();
  if (FRIEND_WORD_TO_INDEX.has(t)) return FRIEND_WORD_TO_INDEX.get(t);
  if (FRIEND_IDIOM_TO_INDEX.has(t)) return FRIEND_IDIOM_TO_INDEX.get(t);
  if (FRIEND_WORD_PINYIN_TO_INDEX.has(low)) return FRIEND_WORD_PINYIN_TO_INDEX.get(low);
  if (FRIEND_IDIOM_PINYIN_TO_INDEX.has(low)) return FRIEND_IDIOM_PINYIN_TO_INDEX.get(low);
  if (PINYIN_TO_INDEX.has(low)) return PINYIN_TO_INDEX.get(low);
  const en = WORDLIST.indexOf(low);
  return en >= 0 ? en : null;
}

/**
 * 24 个格子 → 英文助记词。优先按换行分格（恢复页每个格子一行提交）；
 * 没有换行时再按空白分格（兼容 24 个英文词/24 个中文词的空格粘贴）。
 */
function mnemonicFromFriendlyCells(text) {
  const raw = String(text == null ? '' : text).trim();
  if (!raw) return null;
  let cells = raw.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  if (cells.length !== 24) cells = raw.split(/\s+/).filter(Boolean);
  if (cells.length !== 24) return null;
  // 整句都是英文 BIP-39 词 ⇒ 按英文解析。有些英文词同时是某个两字词的
  // 无调拼音（如 siren = 私人），逐格先查拼音会把规范英文助记词解析成别的词。
  const low = cells.map((x) => x.toLowerCase());
  if (low.every((x) => WORDLIST.includes(x))) return low.join(' ');
  const indices = cells.map(friendlyTokenToIndex);
  if (indices.some((x) => x == null)) return null;
  return indices.map((i) => WORDLIST[i]).join(' ');
}

/** 给主进程返回这 24 个位置的真实词组/成语（带真实拼音）。 */
export function friendlyMnemonic(mnemonic) {
  const canonical = parseMnemonicInput(mnemonic);
  const indices = canonical.split(' ').map((w) => WORDLIST.indexOf(w));
  if (indices.some((i) => i < 0)) throw new Error('auth: unknown mnemonic word');
  return {
    words: indices.map((i) => FRIEND_WORDS[i]),
    idioms: indices.map((i) => FRIEND_IDIOMS[i]),
  };
}

function displayPinyinSyllables(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[0-9\-–—]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function mnemonicFromDisplayPinyin(text) {
  const flat = displayPinyinSyllables(text);
  if (!flat.length || flat.length % 2 !== 0) return null;
  const words = [];
  for (let i = 0; i < flat.length; i += 2) {
    const index = DISPLAY_PINYIN_TO_INDEX.get(flat[i] + ' ' + flat[i + 1]);
    if (index === undefined) return null;
    words.push(WORDLIST[index]);
  }
  return words.length ? words.join(' ') : null;
}

export function isPinyinPhrase(text) {
  const tokens = String(text || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length > 0 && tokens.every((t) => PINYIN_TO_INDEX.has(t))) return true;
  return mnemonicFromDisplayPinyin(text) !== null;
}

/** English mnemonic / canonical pinyin token / displayed full-pinyin → canonical English words. */
export function parseMnemonicInput(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('auth: mnemonic required');
  // 24 个格子的中文词组/成语/真实拼音（或英文单词）优先按码本解析。
  const friendly = mnemonicFromFriendlyCells(raw);
  if (friendly) return friendly;
  const tokens = raw.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length > 0 && tokens.every((t) => PINYIN_TO_INDEX.has(t))) {
    return tokens.map((t) => WORDLIST[PINYIN_TO_INDEX.get(t)]).join(' ');
  }
  const words = normalizeEnglishWords(raw);
  if ([12, 15, 18, 21, 24].includes(words.length) && words.every((w) => WORDLIST.includes(w))) {
    return words.join(' ');
  }
  const fromPinyin = mnemonicFromDisplayPinyin(raw);
  if (fromPinyin) return fromPinyin;
  for (const word of words) assert(WORDLIST.includes(word), `auth: unknown mnemonic word: ${word}`);
  assert([12, 15, 18, 21, 24].includes(words.length), 'auth: mnemonic must contain 12/15/18/21/24 words');
  return words.join(' ');
}

export function mnemonicToPinyin(mnemonic) {
  const canonical = parseMnemonicInput(mnemonic);
  return canonical.split(' ').map((word) => pinyinTokenForIndex(WORDLIST.indexOf(word))).join(' ');
}

export function pinyinToMnemonic(pinyin) {
  return parseMnemonicInput(pinyin);
}

/**
 * 稳定恢复根 `Kroot`（第 111 轮）。
 *
 * 旧主密钥 = PBKDF2(助记词, **每账号随机 salt**) —— 同一句助记词在新设备/新账号上
 * 会得到不同密钥，所以“同词恢复”打不开旧数据。Kroot 只由助记词熵派生，不掺账号 salt，
 * 因此同一句助记词在任何设备上都能得到同一把根密钥；数据本身再用随机 DEK 包裹。
 */
export function deriveKroot(mnemonic) {
  const entropy = mnemonicToEntropy(parseMnemonicInput(mnemonic));
  return Buffer.from(crypto.hkdfSync('sha256', entropy, Buffer.from('warmy-root-v2', 'utf8'), Buffer.from('recovery', 'utf8'), 32));
}

/** Kroot 的公开短指纹：写进 .nm 头，用来判断“这个包是不是当前账号导出的” */
export function krootFingerprint(kroot) {
  if (!Buffer.isBuffer(kroot) || kroot.length !== 32) throw new Error('auth: kroot must be 32 bytes');
  return crypto.createHash('sha256').update('warmy-kroot-fingerprint-v1', 'utf8').update(kroot).digest('hex').slice(0, 32);
}

/** PBKDF2-HMAC-SHA512 master key. Same phrase + salt + iterations ⇒ same key. */
export function deriveMasterKey(mnemonic, saltB64, iterations = MASTER_KDF_ITERATIONS) {
  const canonical = parseMnemonicInput(mnemonic);
  assert(typeof saltB64 === 'string' && saltB64.length > 0, 'auth: master salt required');
  assert(Number.isInteger(iterations) && iterations >= 10_000, 'auth: invalid KDF iterations');
  return crypto.pbkdf2Sync(
    Buffer.from(canonical.normalize('NFKD'), 'utf8'),
    Buffer.from(MASTER_KDF_DOMAIN + saltB64, 'utf8'),
    iterations,
    32,
    'sha512',
  );
}

export function derivePinKey(pin, saltB64, iterations = PIN_KDF_ITERATIONS) {
  assert(validatePin(pin).ok, 'auth: invalid PIN');
  assert(typeof saltB64 === 'string' && saltB64.length > 0, 'auth: PIN salt required');
  assert(Number.isInteger(iterations) && iterations >= 10_000, 'auth: invalid PIN KDF iterations');
  return crypto.pbkdf2Sync(
    Buffer.from(String(pin), 'utf8'),
    Buffer.from(PIN_KDF_DOMAIN + saltB64, 'utf8'),
    iterations,
    32,
    'sha512',
  );
}

export function pinVerifier(key) {
  assert(Buffer.isBuffer(key) && key.length === 32, 'auth: PIN key must be 32 bytes');
  return sha256Hex(PIN_VERIFIER_DOMAIN + key.toString('hex'));
}

export function encryptBlob(key, plaintext) {
  assert(Buffer.isBuffer(key) && key.length === 32, 'auth: AES key must be 32 bytes');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(BLOB_AAD, 'utf8'));
  const body = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(String(plaintext), 'utf8');
  const ct = Buffer.concat([cipher.update(body), cipher.final()]);
  return {
    v: 1,
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ct: ct.toString('base64'),
  };
}

export function decryptBlob(key, blob) {
  assert(Buffer.isBuffer(key) && key.length === 32, 'auth: AES key must be 32 bytes');
  assert(blob && blob.v === 1 && blob.alg === 'aes-256-gcm', 'auth: unsupported blob');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(String(blob.iv), 'base64'));
  decipher.setAAD(Buffer.from(BLOB_AAD, 'utf8'));
  decipher.setAuthTag(Buffer.from(String(blob.tag), 'base64'));
  try {
    return Buffer.concat([decipher.update(Buffer.from(String(blob.ct), 'base64')), decipher.final()]);
  } catch {
    throw new Error('auth: decrypt failed');
  }
}

export function validatePin(pin) {
  if (typeof pin !== 'string') return { ok: false, error: 'pin-required' };
  if (pin.length < PIN_MIN) return { ok: false, error: 'pin-too-short' };
  if (pin.length > PIN_MAX) return { ok: false, error: 'pin-too-long' };
  if (!/^[A-Za-z0-9]+$/.test(pin)) return { ok: false, error: 'pin-charset' };
  return { ok: true };
}

export function validatePinPair(pin, confirm) {
  const one = validatePin(pin);
  if (!one.ok) return one;
  if (pin !== confirm) return { ok: false, error: 'pin-mismatch' };
  return { ok: true };
}

export function isAutoLoginBindingComplete(fields) {
  return !!fields && typeof fields.osUser === 'string' && fields.osUser.length > 0
    && typeof fields.cpu === 'string' && fields.cpu.length > 0
    && typeof fields.machineId === 'string' && /^[a-f0-9]{32}$/i.test(fields.machineId);
}

export function bindingTag(fields) {
  assert(isAutoLoginBindingComplete(fields), 'auth: incomplete binding fields');
  const canonical = JSON.stringify({
    v: AUTH_CORE_VERSION,
    osUser: fields.osUser.trim().toLowerCase(),
    cpu: fields.cpu.trim().toLowerCase(),
    machineId: fields.machineId.trim().toLowerCase(),
  });
  return sha256Hex(BINDING_DOMAIN + canonical);
}

export function makeBindingRecord(fields) {
  assert(isAutoLoginBindingComplete(fields), 'auth: incomplete binding fields');
  return {
    v: 1,
    tag: bindingTag(fields),
    osUserHash: sha256Hex('os|' + fields.osUser.trim().toLowerCase()),
    cpuHash: sha256Hex('cpu|' + fields.cpu.trim().toLowerCase()),
    machineIdHash: sha256Hex('mid|' + fields.machineId.trim().toLowerCase()),
    machineId: fields.machineId.trim().toLowerCase(),
  };
}

export function bindingMatches(record, fields) {
  try {
    if (!record || typeof record.tag !== 'string' || !isAutoLoginBindingComplete(fields)) return false;
    return timingSafeEqualHex(record.tag, bindingTag(fields));
  } catch {
    return false;
  }
}

export function randomMachineId() {
  return crypto.randomBytes(16).toString('hex');
}

/** Constant-time lockout state machine; `now` is injected so gates don't sleep. */
export class PinLockout {
  constructor(state = {}, options = {}) {
    this.max = options.max ?? PIN_MAX_FAILURES;
    this.lockMs = options.lockMs ?? PIN_LOCK_MS;
    this.failedAttempts = Number(state.failedAttempts || 0);
    this.lockUntil = Number(state.lockUntil || 0);
  }

  check(now = Date.now()) {
    if (this.lockUntil && now >= this.lockUntil) {
      this.failedAttempts = 0;
      this.lockUntil = 0;
    }
    const locked = this.lockUntil > now;
    return {
      allowed: !locked,
      locked,
      failedAttempts: this.failedAttempts,
      remainingAttempts: Math.max(0, this.max - this.failedAttempts),
      lockUntil: this.lockUntil,
      retryAfterMs: locked ? this.lockUntil - now : 0,
    };
  }

  fail(now = Date.now()) {
    this.failedAttempts += 1;
    if (this.failedAttempts >= this.max) this.lockUntil = now + this.lockMs;
    return this.snapshot(now);
  }

  success() {
    this.failedAttempts = 0;
    this.lockUntil = 0;
    return this.snapshot(Date.now());
  }

  snapshot(now = Date.now()) {
    const locked = this.lockUntil > now;
    return {
      allowed: !locked,
      locked,
      failedAttempts: this.failedAttempts,
      remainingAttempts: Math.max(0, this.max - this.failedAttempts),
      lockUntil: this.lockUntil,
      retryAfterMs: locked ? this.lockUntil - now : 0,
    };
  }
}

/** Same alphabet/length as credential.ts; kept here so the gate is dependency-free. */
export function credentialFromSeed(seed) {
  assert(Buffer.isBuffer(seed) && seed.length === 32, 'auth: seed must be 32 bytes');
  const base = BigInt(CREDENTIAL_ALPHABET.length);
  let n = BigInt('0x' + seed.toString('hex'));
  const out = [];
  while (n > 0n) {
    out.push(CREDENTIAL_ALPHABET[Number(n % base)]);
    n /= base;
  }
  while (out.length < CREDENTIAL_LENGTH) out.push(CREDENTIAL_ALPHABET[0]);
  return out.slice(0, CREDENTIAL_LENGTH).reverse().join('');
}

export function seedFromCredential(credential) {
  const s = String(credential || '').replace(/[\s-]+/g, '');
  assert(s.length === CREDENTIAL_LENGTH, 'auth: credential must be 51 chars');
  const base = BigInt(CREDENTIAL_ALPHABET.length);
  let n = 0n;
  for (const ch of s) {
    const i = CREDENTIAL_ALPHABET.indexOf(ch);
    assert(i >= 0, `auth: invalid credential char: ${ch}`);
    n = n * base + BigInt(i);
  }
  return Buffer.from(n.toString(16).padStart(64, '0').slice(-64), 'hex');
}

/** Remove secrets from a Buffer after use (best effort; JS strings cannot be wiped). */
export function wipeBuffer(buf) {
  if (Buffer.isBuffer(buf)) buf.fill(0);
}
