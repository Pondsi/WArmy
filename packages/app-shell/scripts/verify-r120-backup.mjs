#!/usr/bin/env node
/**
 * verify-r120-backup.mjs —— W12：独立、可验证的 profile 恢复备份。
 *
 * 真实跑 `backup-profile.mjs`：
 *   A. 只读源目录；缓存/日志/更新包不进备份；
 *   B. memory.db 用 SQLite 快照，备份出的库能打开且数据完整（含未 checkpoint 的 WAL）；
 *   C. manifest 逐文件大小+sha256；`--verify` 通过，篡改任一文件必须失败；
 *   D. 发现 lockfile 默认拒绝；显式 `--allow-running` 才继续。
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, 'backup-profile.mjs');
const require = createRequire(import.meta.url);
const Database = require(path.join(here, '..', '..', 'memory-os', 'node_modules', 'better-sqlite3'));
let pass = 0;
const ok = (name, cond, detail) => {
  assert.ok(cond, name + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail)));
  pass += 1;
  console.log('PASS ' + name);
};
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-r120-backup-'));
const profile = path.join(root, 'profile');
const out = path.join(root, 'backup');
try {
  fs.mkdirSync(path.join(profile, 'auth'), { recursive: true });
  fs.mkdirSync(path.join(profile, 'Cache'), { recursive: true });
  fs.mkdirSync(path.join(profile, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ themeMode: 'dark' }));
  fs.writeFileSync(path.join(profile, 'vault.bin'), crypto.randomBytes(64));
  fs.writeFileSync(path.join(profile, 'auth', 'key-envelope.json'), '{"v":1}');
  fs.writeFileSync(path.join(profile, 'Cache', 'huge.bin'), Buffer.alloc(1024 * 1024));
  fs.writeFileSync(path.join(profile, 'logs', 'app.log'), 'log');
  const db = new Database(path.join(profile, 'memory.db'));
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
  db.prepare('INSERT INTO t (v) VALUES (?)').run('未 checkpoint 的 WAL 行');
  db.close();

  const sourceHash = sha(path.join(profile, 'settings.json'));
  const r = run('--profile', profile, '--out', out);
  ok('备份脚本成功退出', r.status === 0, { status: r.status, stderr: r.stderr.slice(0, 300) });
  ok('源 settings.json 未被改动', sha(path.join(profile, 'settings.json')) === sourceHash);
  ok('缓存目录未进备份', !fs.existsSync(path.join(out, 'Cache')));
  ok('日志未进备份', !fs.existsSync(path.join(out, 'logs', 'app.log')));
  ok('settings/vault/auth 都在备份里',
    fs.existsSync(path.join(out, 'settings.json')) && fs.existsSync(path.join(out, 'vault.bin')) && fs.existsSync(path.join(out, 'auth', 'key-envelope.json')));
  const man = JSON.parse(fs.readFileSync(path.join(out, 'backup-manifest.json'), 'utf8'));
  ok('清单记录逐文件 sha256 与总字节', man.format === 'warmy-profile-backup' && man.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256)) && man.totalFiles === man.files.length);
  ok('memory.db 走 SQLite 快照', man.dbSnapshot === 'sqlite-backup-api', man.dbSnapshot);
  const bdb = new Database(path.join(out, 'memory.db'), { readonly: true });
  try { ok('备份库能打开且数据完整', bdb.prepare('SELECT v FROM t').get().v.includes('WAL')); } finally { bdb.close(); }

  const v1 = run('--verify', out);
  ok('--verify 通过', v1.status === 0, { status: v1.status, stderr: v1.stderr.slice(0, 200) });
  fs.appendFileSync(path.join(out, 'settings.json'), 'x');
  const v2 = run('--verify', out);
  ok('篡改文件后 --verify 必须失败', v2.status !== 0 && /哈希不符|大小不符/.test(v2.stderr), { status: v2.status, stderr: v2.stderr.slice(0, 200) });

  /* 运行锁：默认拒绝；显式允许才继续 */
  fs.writeFileSync(path.join(profile, 'lockfile'), '');
  const out2 = path.join(root, 'backup2');
  const r2 = run('--profile', profile, '--out', out2);
  ok('发现 lockfile 默认拒绝备份', r2.status === 2 && /可能仍在运行/.test(r2.stderr), { status: r2.status, stderr: r2.stderr.slice(0, 200) });
  const out3 = path.join(root, 'backup3');
  const r3 = run('--profile', profile, '--out', out3, '--allow-running');
  ok('显式 --allow-running 才继续', r3.status === 0, { status: r3.status, stderr: r3.stderr.slice(0, 200) });

  console.log(`\nverify-r120-backup: ${pass} PASS / 0 FAIL`);
} finally {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* noop */ }
}
