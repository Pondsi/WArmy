/**
 * key-envelope —— 稳定恢复根 Kroot + 随机数据 DEK 的包裹文件（第 111 轮）。
 *
 * 为什么要多一层：
 *   · 旧主密钥 = PBKDF2(助记词, 每账号随机 salt)，同词换机/换账号会得到不同密钥；
 *   · 随机 DEK 才是真正加密数据（仓库、存储核心、.nm 包）的密钥；
 *   · DEK 同时被「旧主密钥」和「Kroot」各包一份：
 *       - 旧设备/旧账号：用旧主密钥解；
 *       - 新设备/同助记词：用 Kroot 解；
 *       - 首次登录后自动补上 Kroot 包裹（迁移），不删旧包裹。
 *
 * 文件只包含被包裹后的 DEK，不包含明文 DEK/主密钥/Kroot。包裹用 AES-256-GCM，
 * AAD 绑定 Kroot 指纹与用途，换文件/换用途都会认证失败。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { anQuanYuanZiXieJson } from './atomic-json.js';
import { krootFingerprint } from './auth-core.mjs';

export interface KeyEnvelopeFile {
  v: 1;
  krootFp: string;
  legacy?: { n: string; c: string };
  kroot?: { n: string; c: string };
  createdAt: number;
  updatedAt: number;
}

export interface KeyEnvelopeResult {
  ok: boolean;
  dek?: Buffer;
  created?: boolean;
  migrated?: boolean;
  error?: string;
}

function b64(b: Buffer): string { return b.toString('base64'); }

function jie(base: string): Buffer {
  const b = Buffer.from(String(base || ''), 'base64');
  if (!b.length) throw new Error('empty');
  return b;
}

function wrapKey(root: Buffer, kind: 'legacy' | 'kroot'): Buffer {
  return Buffer.from(crypto.hkdfSync(
    'sha256',
    root,
    Buffer.from('warmy-key-envelope-v1', 'utf8'),
    Buffer.from(kind, 'utf8'),
    32,
  ));
}

function aad(fp: string, kind: 'legacy' | 'kroot'): Buffer {
  return Buffer.from(`warmy-key-envelope-v1|${fp}|${kind}`, 'utf8');
}

function wrapDek(root: Buffer, dek: Buffer, fp: string, kind: 'legacy' | 'kroot'): { n: string; c: string } {
  const key = wrapKey(root, kind);
  const n = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, n);
  c.setAAD(aad(fp, kind));
  const ct = Buffer.concat([c.update(dek), c.final()]);
  key.fill(0);
  return { n: b64(n), c: b64(Buffer.concat([ct, c.getAuthTag()])) };
}

function unwrapDek(root: Buffer, box: { n: string; c: string } | undefined, fp: string, kind: 'legacy' | 'kroot'): Buffer | null {
  if (!box || !box.n || !box.c) return null;
  const key = wrapKey(root, kind);
  try {
    const n = jie(box.n);
    const all = jie(box.c);
    if (n.length !== 12 || all.length < 17) return null;
    const ct = all.subarray(0, all.length - 16);
    const tag = all.subarray(all.length - 16);
    const d = crypto.createDecipheriv('aes-256-gcm', key, n);
    d.setAAD(aad(fp, kind));
    d.setAuthTag(tag);
    const dek = Buffer.concat([d.update(ct), d.final()]);
    return dek.length === 32 ? dek : null;
  } catch {
    return null;
  } finally {
    key.fill(0);
  }
}

function read(file: string): KeyEnvelopeFile | null {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8')) as KeyEnvelopeFile;
    if (!j || j.v !== 1 || typeof j.krootFp !== 'string' || !j.krootFp) return null;
    return j;
  } catch {
    return null;
  }
}

/**
 * 打开或创建包裹。`kroot` 可为空（启动时只有一次性令牌里的旧主密钥）；
 * 为空时只解旧主密钥包裹，不创建、不迁移。
 */
export function openKeyEnvelope(
  file: string,
  masterKey: Buffer,
  kroot: Buffer | null,
  fpFromKroot?: string,
): KeyEnvelopeResult {
  if (!masterKey || masterKey.length !== 32) return { ok: false, error: 'bad-master-key' };
  const fp = kroot && kroot.length === 32 ? (fpFromKroot || krootFingerprint(kroot)) : '';
  const cur = read(file);

  if (!cur) {
    if (!kroot || kroot.length !== 32 || !fp) return { ok: false, error: 'no-envelope' };
    const dek = crypto.randomBytes(32);
    const next: KeyEnvelopeFile = {
      v: 1,
      krootFp: fp,
      legacy: wrapDek(masterKey, dek, fp, 'legacy'),
      kroot: wrapDek(kroot, dek, fp, 'kroot'),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const w = anQuanYuanZiXieJson(file, next);
    if (!w.ok) { dek.fill(0); return { ok: false, error: w.error || 'envelope-write-failed' }; }
    return { ok: true, dek, created: true };
  }

  let dek: Buffer | null = null;
  let migrated = false;
  if (kroot && kroot.length === 32) {
    dek = unwrapDek(kroot, cur.kroot, cur.krootFp, 'kroot');
    if (!dek) {
      const fromLegacy = unwrapDek(masterKey, cur.legacy, cur.krootFp, 'legacy');
      if (fromLegacy) {
        dek = fromLegacy;
        migrated = true;
      }
    }
  } else {
    dek = unwrapDek(masterKey, cur.legacy, cur.krootFp, 'legacy');
  }
  if (!dek) return { ok: false, error: 'envelope-unwrap-failed' };

  if (kroot && kroot.length === 32 && fp && (migrated || !cur.kroot || cur.krootFp !== fp)) {
    cur.krootFp = fp;
    cur.kroot = wrapDek(kroot, dek, fp, 'kroot');
    /** legacy 包裹的 AAD 也绑定 krootFp；换指纹时必须一起重包，否则下次启动只有旧主密钥时解不开 */
    cur.legacy = wrapDek(masterKey, dek, fp, 'legacy');
    cur.updatedAt = Date.now();
    const w = anQuanYuanZiXieJson(file, cur);
    if (!w.ok) {
      /** 写不进去不影响本次使用；下次登录还会再试迁移 */
      migrated = false;
    }
  }
  return { ok: true, dek, migrated };
}

/** 只读公开指纹（不接密钥）；用于导入前提示“这个包是否属于当前账号” */
export function keyEnvelopeFingerprint(file: string): string {
  return read(file)?.krootFp || '';
}
