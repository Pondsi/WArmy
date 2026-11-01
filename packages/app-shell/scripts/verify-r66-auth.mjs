#!/usr/bin/env node
/**
 * verify-r66-auth — behavioral fixtures for the mnemonic/PIN/auto-login core.
 *
 * Pure functions only: no Electron, no safeStorage, no filesystem, no clock
 * sleeping. This is deliberately runnable with plain `node` in CI.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  PinLockout,
  bindingMatches,
  credentialFromSeed,
  decryptBlob,
  deriveMasterKey,
  derivePinKey,
  encryptBlob,
  friendlyMnemonic,
  generateMnemonic,
  isValidMnemonic,
  makeBindingRecord,
  mnemonicToEntropy,
  mnemonicToPinyin,
  parseMnemonicInput,
  pinVerifier,
  pinyinToMnemonic,
  seedFromCredential,
  validatePin,
  validatePinPair,
} from '../src/auth-core.mjs';

let passed = 0;
function ok(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    console.error(e && e.stack ? e.stack : e);
    process.exitCode = 1;
  }
}

const zero16 = Buffer.alloc(16);
const zero32 = Buffer.alloc(32);

ok('BIP39 known vector (128-bit zero entropy)', () => {
  assert.equal(
    generateMnemonic(zero16),
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  );
});

ok('BIP39 24-word roundtrip preserves 256-bit entropy', () => {
  const m = generateMnemonic(zero32);
  assert.equal(m.split(' ').length, 24);
  assert.deepEqual(mnemonicToEntropy(m), zero32);
  assert.equal(m, 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art');
});

ok('BIP39 rejects a bad checksum', () => {
  const m = generateMnemonic(zero32).split(' ');
  m[m.length - 1] = 'abandon';
  assert.equal(isValidMnemonic(m.join(' ')), false);
  assert.throws(() => mnemonicToEntropy(m.join(' ')), /checksum|unknown/i);
});

ok('random mnemonic roundtrip is exact', () => {
  for (let i = 0; i < 20; i++) {
    const entropy = crypto.randomBytes(32);
    const m = generateMnemonic(entropy);
    assert.deepEqual(mnemonicToEntropy(m), entropy);
  }
});

ok('pinyin mapping is deterministic and reversible', () => {
  const m = generateMnemonic(crypto.randomBytes(32));
  const a = mnemonicToPinyin(m);
  const b = mnemonicToPinyin(m);
  assert.equal(a, b);
  assert.equal(a.split(' ').length, 24);
  assert.equal(pinyinToMnemonic(a), m);
  assert.equal(parseMnemonicInput(a), m);
  assert.equal(parseMnemonicInput(m), m);
  assert.equal(mnemonicToPinyin(pinyinToMnemonic(a)), a);
});

ok('displayed full pinyin (no digits/hyphens) roundtrips in 2- and 4-syllable groups', () => {
  for (let i = 0; i < 20; i++) {
    const m = generateMnemonic(crypto.randomBytes(32));
    const tokens = mnemonicToPinyin(m).split(' ').map((t) => t.replace(/[0-9]/g, '').replace(/-/g, ' '));
    const two = tokens.join(' ');
    assert.equal(/[0-9-]/.test(two), false);
    assert.equal(parseMnemonicInput(two), m);
    const four = [];
    for (let k = 0; k < tokens.length; k += 2) four.push(tokens[k] + ' ' + tokens[k + 1]);
    assert.equal(four.length, 12);
    assert.equal(parseMnemonicInput(four.join('  ')), m);
  }
});

ok('master key is deterministic per mnemonic+salt and domain-separated', () => {
  const m = generateMnemonic(crypto.randomBytes(32));
  const other = generateMnemonic(crypto.randomBytes(32));
  const salt = crypto.randomBytes(16).toString('base64');
  const k1 = deriveMasterKey(m, salt, 10_000);
  const k2 = deriveMasterKey(m, salt, 10_000);
  const k3 = deriveMasterKey(other, salt, 10_000);
  const k4 = deriveMasterKey(m, crypto.randomBytes(16).toString('base64'), 10_000);
  assert.deepEqual(k1, k2);
  assert.notDeepEqual(k1, k3);
  assert.notDeepEqual(k1, k4);
  assert.equal(k1.length, 32);
});

ok('AES-GCM blob roundtrip, wrong key and tamper both fail', () => {
  const key = crypto.randomBytes(32);
  const wrong = crypto.randomBytes(32);
  const secret = 'abandon ability able about above absent absorb abstract absurd abuse access accident';
  const blob = encryptBlob(key, secret);
  assert.equal(decryptBlob(key, blob).toString('utf8'), secret);
  assert.throws(() => decryptBlob(wrong, blob), /decrypt failed/);
  const tampered = { ...blob, ct: Buffer.from('tampered').toString('base64') };
  assert.throws(() => decryptBlob(key, tampered), /decrypt failed/);
});

ok('PIN rules: 4–20 ASCII letters/digits only, two entries must match', () => {
  assert.equal(validatePin('a1B2').ok, true);
  assert.equal(validatePin('A'.repeat(20)).ok, true);
  assert.equal(validatePin('123').ok, false);
  assert.equal(validatePin('A'.repeat(21)).ok, false);
  assert.equal(validatePin('12 34').ok, false);
  assert.equal(validatePin('12-34').ok, false);
  assert.equal(validatePin('密码1234').ok, false);
  assert.equal(validatePin('').ok, false);
  assert.equal(validatePinPair('a1B2', 'a1B2').ok, true);
  assert.equal(validatePinPair('a1B2', 'a1B3').ok, false);
});

ok('PIN verifier is one-way and PIN KEK changes with salt', () => {
  const salt1 = crypto.randomBytes(16).toString('base64');
  const salt2 = crypto.randomBytes(16).toString('base64');
  const k1 = derivePinKey('a1B2', salt1, 10_000);
  const k2 = derivePinKey('a1B2', salt1, 10_000);
  const k3 = derivePinKey('a1B2', salt2, 10_000);
  assert.deepEqual(k1, k2);
  assert.notDeepEqual(k1, k3);
  assert.notEqual(pinVerifier(k1), k1.toString('hex'));
  assert.notEqual(pinVerifier(k1), pinVerifier(k3));
});

ok('auto-login binding invalidates when OS account, CPU or machine id changes', () => {
  const base = { osUser: 'alice', cpu: 'Example CPU @ 3.0GHz', machineId: 'a'.repeat(32) };
  const record = makeBindingRecord(base);
  assert.equal(bindingMatches(record, base), true);
  assert.equal(bindingMatches(record, { ...base, osUser: 'bob' }), false);
  assert.equal(bindingMatches(record, { ...base, cpu: 'Example CPU @ 3.1GHz' }), false);
  assert.equal(bindingMatches(record, { ...base, machineId: 'b'.repeat(32) }), false);
  assert.equal(JSON.stringify(record).includes('alice'), false);
});

ok('wrong PIN lockout: 5 failures ⇒ 60 s, correct PIN rejected until expiry', () => {
  const t0 = 1_000_000;
  const lock = new PinLockout({}, { max: 5, lockMs: 60_000 });
  for (let i = 0; i < 4; i++) {
    const snap = lock.fail(t0);
    assert.equal(snap.locked, false);
    assert.equal(snap.remainingAttempts, 4 - i);
  }
  const fifth = lock.fail(t0);
  assert.equal(fifth.locked, true);
  assert.equal(fifth.lockUntil, t0 + 60_000);
  assert.equal(lock.check(t0 + 59_999).allowed, false);
  assert.equal(lock.check(t0 + 60_000).allowed, true);
  assert.equal(lock.snapshot(t0 + 60_000).failedAttempts, 0);
  const after = lock.fail(t0 + 60_000);
  assert.equal(after.locked, false);
  assert.equal(after.remainingAttempts, 4);
});

ok('successful PIN clears failures and lock state', () => {
  const t0 = 2_000_000;
  const lock = new PinLockout({ failedAttempts: 4, lockUntil: 0 }, { max: 5, lockMs: 60_000 });
  assert.equal(lock.fail(t0).locked, true);
  const reset = lock.success();
  assert.equal(reset.failedAttempts, 0);
  assert.equal(reset.lockUntil, 0);
  assert.equal(reset.allowed, true);
});

ok('credential encoding from the 32-byte seed is stable and reversible', () => {
  const seed = crypto.randomBytes(32);
  const credential = credentialFromSeed(seed);
  assert.match(credential, /^[0-9A-HJKLMNP-XY]{51}$/);
  assert.deepEqual(seedFromCredential(credential), seed);
  assert.equal(credentialFromSeed(seed), credential);
});

ok('parseMnemonicInput accepts pinyin and canonicalizes whitespace/case', () => {
  const m = generateMnemonic(crypto.randomBytes(32));
  const p = mnemonicToPinyin(m);
  assert.equal(parseMnemonicInput(`  ${p.toUpperCase()}  `), m);
  assert.equal(parseMnemonicInput(m.toUpperCase()), m);
});

ok('friendly real-word/idiom codebook roundtrips for words, idioms and real pinyin', () => {
  for (let i = 0; i < 12; i++) {
    const m = generateMnemonic(crypto.randomBytes(32));
    const f = friendlyMnemonic(m);
    assert.equal(f.words.length, 24);
    assert.equal(f.idioms.length, 24);
    for (const x of f.words) {
      assert.equal(Array.from(x.w).length, 2, 'word must be exactly 2 Chinese characters');
      assert.match(x.p, /^[a-z]+$/, 'word pinyin must be plain joined letters');
    }
    for (const x of f.idioms) {
      assert.equal(Array.from(x.w).length, 4, 'idiom must be exactly 4 Chinese characters');
      assert.match(x.p, /^[a-z]+$/, 'idiom pinyin must be plain joined letters');
    }
    assert.equal(parseMnemonicInput(f.words.map((x) => x.w).join('\n')), m);
    assert.equal(parseMnemonicInput(f.words.map((x) => x.p).join('\n')), m);
    assert.equal(parseMnemonicInput(f.idioms.map((x) => x.w).join('\n')), m);
    assert.equal(parseMnemonicInput(f.idioms.map((x) => x.p).join('\n')), m);
    // 旧的英文/拼音恢复路径仍可用
    assert.equal(parseMnemonicInput(m), m);
    assert.equal(pinyinToMnemonic(mnemonicToPinyin(m)), m);
  }
});

ok('英文词与友好拼音撞名时整句英文优先，单格友好拼音仍可还原（siren/私人）', () => {
  const collision = 'stamp oblige then world basket romance sand month snow burden siren side occur bulk sport insect kind bar behave illness ghost enjoy ancient female';
  assert.equal(parseMnemonicInput(collision), collision);
  const f = friendlyMnemonic(collision);
  assert.equal(parseMnemonicInput(f.words.map((x) => x.w).join('\n')), collision);
  assert.equal(parseMnemonicInput(f.words.map((x) => x.p).join('\n')), collision);

  const praisePhrase = collision.replace(' siren ', ' praise ');
  const pf = friendlyMnemonic(praisePhrase);
  assert.equal(pf.words[10].w, '私人');
  assert.equal(pf.words[10].p, 'siren');
  assert.equal(parseMnemonicInput(pf.words.map((x) => x.p).join('\n')), praisePhrase);
});

if (process.exitCode) {
  console.error(`verify-r66-auth: ${passed} passed, failures above`);
} else {
  console.log(`verify-r66-auth: ${passed} fixtures passed`);
}
