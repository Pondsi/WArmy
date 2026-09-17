/**
 * Spike 2: better-sqlite3 长驻子进程（记忆服务模式）IPC 延迟
 * 架构对齐：L2 记忆服务 = 独立 Node 子进程，不是 per-query fork
 *
 * DoD（ADR 000 第四章）：
 *   - 1000 次 hash 点查 P50 / P95，P95 < 5ms
 *   - FTS5 全文检索（**10 万条记录**）P95 < 20ms
 *
 * 复核补充（2026-09 修订）：原脚本只灌了 **1 万条** FTS 记录就宣称达标，
 * 与 ADR 的 10 万条口径不符。本版按 1 万 / 10 万两个规模分别实测并落原始证据。
 *
 * 用法：node spikes/spike-02-sqlite-ipc/run.mjs
 * 原始输出落盘：spikes/spike-02-sqlite-ipc/result.json
 */
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const childPath = fileURLToPath(new URL('./child.mjs', import.meta.url));
const dbPath = path.join(os.tmpdir(), `ccarmy-spike2-${Date.now()}.db`);
const RESULT_PATH = path.join(__dirname, 'result.json');

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function stats(samples) {
  const s = [...samples].sort((a, b) => a - b);
  return {
    n: s.length,
    p50: +percentile(s, 50).toFixed(3),
    p95: +percentile(s, 95).toFixed(3),
    max: +s[s.length - 1].toFixed(3),
  };
}

const child = fork(childPath, [], { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
let seq = 0;
const pending = new Map();

child.on('message', (m) => {
  const p = pending.get(m.id);
  if (p) {
    pending.delete(m.id);
    if (m.error) p.reject(new Error(m.error));
    else p.resolve(m);
  }
});

function call(msg) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.send({ ...msg, id });
  });
}

async function benchHash(n) {
  const samples = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    await call({ op: 'hash', key: `k${i % 1000}` });
    samples.push(performance.now() - t0);
  }
  return stats(samples);
}

async function benchFts(n) {
  const samples = [];
  const hitCounts = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    const r = await call({ op: 'fts', q: i % 2 === 0 ? '项目' : '牛马' });
    samples.push(performance.now() - t0);
    hitCounts.push(r.hits);
  }
  return { stats: stats(samples), hitCounts };
}

const report = {
  spike: 'spike-02-sqlite-ipc',
  title: 'better-sqlite3 长驻子进程 IPC 延迟',
  dod: 'hash 点查 P95 < 5ms；FTS5 检索（10 万条记录）P95 < 20ms',
  ranAt: new Date().toISOString(),
  environment: { node: process.version, platform: process.platform, arch: process.arch },
  dbPath,
  init: null,
  phases: {},
  pass: {
    hashP95: false,
    ftsP95At10k: false,
    ftsP95At100k: false,
    dodMet: false,
  },
  notes: [],
};

const initRes = await call({ op: 'init', dbPath, ftsRows: 10000 });
report.init = initRes;
console.log('persistent child ready', dbPath, `ftsRows=${initRes.ftsRows} seedMs=${initRes.seedMs}`);

// warmup
for (let i = 0; i < 20; i++) await call({ op: 'hash', key: `k${i}` });

// 阶段 1：ADR 要求的 1000 次 hash 点查
const hash = await benchHash(1000);
report.phases.hash = hash;
console.log('hash', JSON.stringify(hash));

// 阶段 2：1 万条 FTS（与原脚本口径一致，便于对照旧结论）
const fts10k = await benchFts(100);
report.phases.ftsAt10k = { rows: 10000, ...fts10k };
console.log('fts@10k', JSON.stringify(fts10k.stats));

// 阶段 3：按 ADR 口径重建为 10 万条再测
const reseed = await call({ op: 'reseed-fts', ftsRows: 100000 });
report.phases.reseed = reseed;
console.log('reseed', JSON.stringify(reseed));
const fts100k = await benchFts(200);
report.phases.ftsAt100k = { rows: reseed.actualRows, ...fts100k };
console.log('fts@100k', JSON.stringify(fts100k.stats));

try {
  report.dbBytes = fs.statSync(dbPath).size;
} catch {
  report.dbBytes = null;
}

report.pass.hashP95 = hash.p95 < 5;
report.pass.ftsP95At10k = fts10k.stats.p95 < 20;
report.pass.ftsP95At100k = fts100k.stats.p95 < 20;
report.pass.dodMet = report.pass.hashP95 && report.pass.ftsP95At100k;

if (!report.pass.ftsP95At100k) {
  report.notes.push('10 万条规模下 FTS5 P95 未达 20ms，需重新评估检索层设计');
}
report.notes.push(
  `原脚本仅 1 万条即宣称达标；本次按 ADR 口径在 10 万条下重测（命中数 ${JSON.stringify(fts100k.hitCounts.slice(0, 4))}…）`
);

fs.writeFileSync(RESULT_PATH, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(`原始结果已写入 ${RESULT_PATH}`);

child.send({ op: 'close' });
child.kill();
process.exit(report.pass.dodMet ? 0 : 1);
