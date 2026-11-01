#!/usr/bin/env node
/**
 * backup-profile.mjs —— 第 120 轮（W12）：独立、可验证的 profile 恢复备份。
 *
 * 为什么不能只靠“退出封存”：封存路径本身有过 D1（封存后解不开）。这个工具不碰 vault
 * 封存逻辑，只做**目录级备份 + 逐文件 sha256 清单**，随时可用 `--verify` 复核。
 *
 * 用法：
 *   node backup-profile.mjs --profile <userData> --out <备份目录> [--allow-running]
 *   node backup-profile.mjs --verify <备份目录>
 *
 * 安全边界：
 *   · 默认拒绝在应用可能仍运行时备份（发现 `lockfile`/`SingletonLock`）；
 *   · `memory.db` 优先用 SQLite 在线备份 API 做一致性快照；失败才退回文件复制并如实标注；
 *   · 只读源目录，不删除、不迁移、不封存真实数据；
 *   · 缓存/日志/更新包/临时构建产物不进入备份（可重建，且会把体积撑爆）。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..');

const EXCLUDE_DIRS = new Set([
  'Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache',
  'Session Storage', 'Local Storage', 'Shared Dictionary', 'blob_storage', 'Network',
  'DIPS', 'fonts', 'screenshots', 'logs', 'release', 'dist', 'node_modules', 'pnpm-store',
  'updates', 'dsh-packages', 'dsh-home', 'Crashpad', 'GrShaderCache', 'ShaderCache',
]);
const EXCLUDE_FILE = /^(Singleton.*|lockfile|DevToolsActivePort|.*\.log|memory\.db-wal|memory\.db-shm)$/i;

function usage() {
  console.log('用法: node backup-profile.mjs --profile <userData> --out <dir> [--allow-running]');
  console.log('      node backup-profile.mjs --verify <backupDir>');
}
function die(msg) { console.error('错误: ' + msg); process.exit(2); }
function arg(name, def = '') {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? String(process.argv[i + 1] || '') : def;
}
function hasFlag(name) { return process.argv.includes('--' + name); }
function sha256(p) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(p, 'r');
  try {
    const buf = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (!n) break;
      h.update(buf.subarray(0, n));
    }
  } finally { try { fs.closeSync(fd); } catch { /* noop */ } }
  return h.digest('hex');
}
function safeRel(rel) {
  const p = path.normalize(String(rel || '')).replace(/\\/g, '/');
  return p && !p.startsWith('..') && !path.isAbsolute(rel) ? p : '';
}
function listFiles(root, dir = '') {
  const out = [];
  const abs = path.join(root, dir);
  let ents;
  try { ents = fs.readdirSync(abs, { withFileTypes: true }); } catch { return out; }
  for (const ent of ents) {
    const rel = dir ? dir + '/' + ent.name : ent.name;
    if (ent.isDirectory()) {
      if (dir === '' && EXCLUDE_DIRS.has(ent.name)) continue;
      out.push(...listFiles(root, rel));
    } else if (ent.isFile()) {
      if (EXCLUDE_FILE.test(ent.name)) continue;
      out.push(rel);
    }
  }
  return out;
}
async function snapshotDb(src, dst) {
  try {
    const req = createRequire(path.join(repo, 'packages', 'memory-os', 'package.json'));
    const Database = req('better-sqlite3');
    const db = new Database(src, { readonly: true, fileMustExist: true });
    try { await db.backup(dst); } finally { try { db.close(); } catch { /* noop */ } }
    return 'sqlite-backup-api';
  } catch (e) {
    fs.copyFileSync(src, dst);
    for (const ext of ['-wal', '-shm']) {
      const s = src + ext;
      if (fs.existsSync(s)) { try { fs.copyFileSync(s, dst + ext); } catch { /* noop */ } }
    }
    return 'file-copy（SQLite 快照失败：' + String(e && e.message || e).slice(0, 120) + '）';
  }
}

async function backup() {
  const profile = path.resolve(arg('profile'));
  const out = path.resolve(arg('out'));
  if (!arg('profile') || !arg('out')) { usage(); die('缺少 --profile 或 --out'); }
  if (!fs.existsSync(profile) || !fs.statSync(profile).isDirectory()) die('profile 不是目录: ' + profile);
  if (fs.existsSync(out) && fs.readdirSync(out).length) die('备份目录必须为空或不存在: ' + out);
  if (!hasFlag('allow-running')) {
    const running = ['lockfile', 'SingletonLock', 'SingletonCookie'].filter((n) => fs.existsSync(path.join(profile, n)));
    if (running.length) die('应用可能仍在运行（发现 ' + running.join(', ') + '）；请先退出，确认无误再加 --allow-running');
  }
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  const files = [];
  let dbSnapshot = '';
  for (const rel of listFiles(profile)) {
    if (rel === 'memory.db') {
      const dst = path.join(out, 'memory.db');
      dbSnapshot = await snapshotDb(path.join(profile, rel), dst);
      files.push({ rel, size: fs.statSync(dst).size, sha256: sha256(dst) });
      continue;
    }
    const src = path.join(profile, rel);
    const dst = path.join(out, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true, mode: 0o700 });
    fs.copyFileSync(src, dst);
    try { fs.chmodSync(dst, 0o600); } catch { /* noop */ }
    files.push({ rel, size: fs.statSync(dst).size, sha256: sha256(dst) });
  }
  const man = {
    format: 'warmy-profile-backup',
    v: 1,
    createdAt: new Date().toISOString(),
    profile,
    files,
    totalFiles: files.length,
    totalBytes: files.reduce((n, f) => n + f.size, 0),
    dbSnapshot: dbSnapshot || 'none',
    note: '只读备份；恢复时把本目录内容拷回空的 userData 目录。vault.bin/auth 仍是密文。',
  };
  fs.writeFileSync(path.join(out, 'backup-manifest.json'), JSON.stringify(man, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  console.log(`备份完成：${out}`);
  console.log(`文件 ${man.totalFiles} 个，${man.totalBytes} 字节；memory.db 快照方式：${man.dbSnapshot}`);
}

function verify() {
  const dir = path.resolve(arg('verify'));
  if (!arg('verify')) { usage(); die('缺少 --verify'); }
  const manPath = path.join(dir, 'backup-manifest.json');
  if (!fs.existsSync(manPath)) die('找不到 backup-manifest.json: ' + manPath);
  const man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
  if (man.format !== 'warmy-profile-backup' || !Array.isArray(man.files)) die('清单格式不对');
  let bad = 0;
  for (const f of man.files) {
    const rel = safeRel(f.rel);
    if (!rel) { console.error('非法相对路径: ' + f.rel); bad++; continue; }
    const p = path.join(dir, rel);
    if (!fs.existsSync(p)) { console.error('缺文件: ' + rel); bad++; continue; }
    const size = fs.statSync(p).size;
    if (size !== f.size) { console.error('大小不符: ' + rel + '（清单 ' + f.size + '，实际 ' + size + '）'); bad++; continue; }
    if (sha256(p) !== f.sha256) { console.error('哈希不符: ' + rel); bad++; }
  }
  if (bad) { console.error(`校验失败：${bad} 个文件不一致`); process.exit(1); }
  console.log(`校验通过：${man.totalFiles} 个文件、${man.totalBytes} 字节与清单一致`);
}

try {
  if (hasFlag('verify')) verify();
  else await backup();
} catch (e) {
  console.error('失败: ' + String(e && e.stack || e));
  process.exit(1);
}
