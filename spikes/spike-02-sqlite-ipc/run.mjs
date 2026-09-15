/**
 * Spike 2: better-sqlite3 长驻子进程（记忆服务模式）IPC 延迟
 * 架构对齐：L2 记忆服务 = 独立 Node 子进程，不是 per-query fork
 * DoD: hash 点查 P95 < 5ms；FTS5 检索 P95 < 20ms
 */
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';

const childPath = fileURLToPath(new URL('./child.mjs', import.meta.url));
const dbPath = path.join(os.tmpdir(), `ccarmy-spike2-${Date.now()}.db`);

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

await call({ op: 'init', dbPath });
console.log('persistent child ready', dbPath);

// warmup
for (let i = 0; i < 20; i++) await call({ op: 'hash', key: `k${i}` });

const hashSamples = [];
for (let i = 0; i < 500; i++) {
  const t0 = performance.now();
  await call({ op: 'hash', key: `k${i % 1000}` });
  hashSamples.push(performance.now() - t0);
}

const ftsSamples = [];
for (let i = 0; i < 100; i++) {
  const t0 = performance.now();
  await call({ op: 'fts', q: i % 2 === 0 ? '项目' : '牛马' });
  ftsSamples.push(performance.now() - t0);
}

const hash = stats(hashSamples);
const fts = stats(ftsSamples);
const report = {
  mode: 'persistent-child-ipc',
  hash,
  fts,
  pass: { hashP95: hash.p95 < 5, ftsP95: fts.p95 < 20 },
};
console.log(JSON.stringify(report, null, 2));

child.send({ op: 'close' });
child.kill();
process.exit(report.pass.hashP95 && report.pass.ftsP95 ? 0 : 1);
