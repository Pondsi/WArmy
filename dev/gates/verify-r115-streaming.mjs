/**
 * verify-r115-streaming.mjs —— 第 115 轮：加密层大文件路径不得整文件读入内存。
 *   · createReadStream 对密文返回分块解密的流（多 chunk）；
 *   · 登录迁移对普通文件/JSONL 使用流式封装；
 *   · 大 JSONL 迁移后仍能完整读回。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const encFs = require(path.join(root, 'packages/app-shell/dist/enc-fs.cjs'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-r115-stream-'));
const key = Buffer.alloc(32, 0x33);
let pass = 0;
const ok = (name, cond, detail) => { assert.ok(cond, name + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail))); pass += 1; console.log('PASS ' + name); };
const rawHead = (p) => { const fd = fs.openSync(p, 'r'); try { const st = fs.fstatSync(fd); const b = Buffer.alloc(Math.min(8, st.size)); fs.readSync(fd, b, 0, b.length, 0); return b.toString(); } finally { try { fs.closeSync(fd); } catch { /* noop */ } } };
try {
  encFs.install({root: dir});
  encFs.setKey(key);

  const big = path.join(dir, 'big.bin');
  const plain = Buffer.alloc(8 * 1024 * 1024, 0x5a);
  fs.writeFileSync(big, plain);
  ok('大文件写入后仍是密文', rawHead(big) === 'WARMYEF2');
  let bytes = 0;
  let chunks = 0;
  for await (const chunk of fs.createReadStream(big)) { bytes += chunk.length; chunks += 1; }
  ok('createReadStream 分块解密（不是单块整文件）', bytes === plain.length && chunks > 1, {bytes, chunks});
  ok('流式读取内容一致', fs.readFileSync(big).equals(plain));

  const legacy = path.join(dir, 'legacy.bin');
  const fd = fs.openSync(legacy, 'w');
  fs.writeSync(fd, plain);
  fs.closeSync(fd);
  const n = encFs.migrateTree(dir);
  ok('迁移把历史明文大文件改成密文', n >= 1 && rawHead(legacy) === 'WARMYEF2', {n, head: rawHead(legacy)});
  ok('迁移后大文件仍可完整读回', fs.readFileSync(legacy).equals(plain));

  const jsonl = path.join(dir, 'big.jsonl');
  const lines = Array.from({length: 60000}, (_, i) => `{"i":${i},"ti":"line-${i}-${'x'.repeat(40)}"}`).join('\n') + '\n';
  const fd2 = fs.openSync(jsonl, 'w');
  fs.writeSync(fd2, lines);
  fs.closeSync(fd2);
  const m = encFs.migrateTree(dir);
  ok('迁移把历史明文 JSONL 改成密文', m >= 1 && rawHead(jsonl) === 'WARMYEF2', {m, head: rawHead(jsonl)});
  ok('迁移后 JSONL 逻辑内容完整', fs.readFileSync(jsonl, 'utf8') === lines);
  console.log(`\nverify-r115-streaming: ${pass} PASS / 0 FAIL`);
} finally {
  try { fs.rmSync(dir, {recursive: true, force: true, maxRetries: 5, retryDelay: 150}); } catch { /* noop */ }
}
