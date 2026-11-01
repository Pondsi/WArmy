/**
 * verify-memory-jsonl-big —— 第 51 轮回归：JSONL > 2 GiB 时记忆服务不许崩
 * 真缺陷：gouJianJsonlSuoYin / rebuildProjection 用 readFileSync 读全文件，
 * 超过 2 GiB 直接抛 ERR_FS_FILE_TOO_LARGE（压力档 1000 轮×2M 第 999 轮实测）。
 * 这里造一个 2.2 GiB 的 JSONL，验证：
 *  ① 建索引不抛错、行数与写入一致；
 *  ② 字节区间能精确切回原文（锚点可用）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mod = await import(pathToFileURL(path.join(ROOT, 'packages/memory-os/dist/index.js')).href);
const { gouJianJsonlSuoYin } = mod;

let okN = 0, failN = 0;
const ok = (m) => { okN++; console.log('  ok  ' + m); };
const bad = (m) => { failN++; console.log('  FAIL ' + m); };
const need = (c, m) => (c ? ok(m) : bad(m));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-jsonl-big-'));
const file = path.join(dir, 'big.jsonl');
const TARGET = 2.2 * 1024 * 1024 * 1024;
const line = JSON.stringify({ seq: 0, id: 'x', ti: 'A'.repeat(9000) }) + '\n';
const one = Buffer.from(line, 'utf8');
const fd = fs.openSync(file, 'w');
let written = 0;
let n = 0;
while (written < TARGET) {
  const parts = [];
  for (let i = 0; i < 500; i++) {
    parts.push(Buffer.from(JSON.stringify({ seq: n + i + 1, id: 'id-' + (n + i + 1), ti: 'A'.repeat(9000) }) + '\n', 'utf8'));
  }
  const chunk = Buffer.concat(parts);
  fs.writeSync(fd, chunk, 0, chunk.length);
  written += chunk.length;
  n += 500;
}
fs.closeSync(fd);
console.log(`  · 造文件 ${(written / 1024 / 1024 / 1024).toFixed(2)} GiB / ${n} 行`);

const t0 = Date.now();
let idx = null;
let err = '';
try { idx = gouJianJsonlSuoYin(file); } catch (e) { err = String(e && e.message || e); }
const ms = Date.now() - t0;
need(!err, `建索引不抛错（${ms}ms）` + (err ? `：${err}` : ''));
need(!!idx && idx.entries.length === n, `行数一致（${idx ? idx.entries.length : 'null'} vs ${n}）`);
need(!!idx && idx.size > TARGET - 1024, 'size 与文件一致');

// 抽最后一行验证字节区间能切回原文
if (idx && idx.entries.length) {
  const last = idx.entries[idx.entries.length - 1];
  const buf = Buffer.alloc(last.end - last.start);
  const fd2 = fs.openSync(file, 'r');
  fs.readSync(fd2, buf, 0, buf.length, last.start);
  fs.closeSync(fd2);
  let parsed = null;
  try { parsed = JSON.parse(buf.toString('utf8')); } catch { /* noop */ }
  need(!!parsed && String(parsed.id || '') === 'id-' + n, '按字节区间能切回最后一行原文');
}

try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
console.log(`\n==== verify-memory-jsonl-big: ${okN} ok / ${failN} FAIL ====`);
process.exit(failN ? 1 : 0);
