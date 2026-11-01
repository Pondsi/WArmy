/**
 * verify-r111-storage.mjs —— 单一加密存储核心（SQLCipher 兼容）第一阶段：
 * memory.db 用 SQLCipher 兼容驱动加密（库文件不含明文哨兵、错 key 被拒），
 * JSONL 仍是事实源；主进程登录后用 DEK 派生库密钥并重启记忆子进程。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pkg = path.join(root, 'packages/app-shell');
const memPkg = path.join(root, 'packages/memory-os');
const require = createRequire(import.meta.url);
const { JiyiCangFuwu } = await import(pathToFileURL(path.join(memPkg, 'dist/index.js')).href);
const encFs = require(path.join(pkg, 'dist/enc-fs.cjs'));

const rawRead = (p) => { const fd = fs.openSync(p, 'r'); try { const st = fs.fstatSync(fd); const b = Buffer.alloc(st.size); fs.readSync(fd, b, 0, b.length, 0); return b; } finally { try { fs.closeSync(fd); } catch { /* noop */ } } };
let pass = 0;
const ok = (name, cond, detail) => {
  assert.ok(cond, name + (detail === undefined ? '' : '：' + JSON.stringify(detail)));
  pass += 1;
  console.log('PASS ' + name);
};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-r111-storage-'));
const key = 'ab'.repeat(32);
encFs.install({ root: dir });
encFs.setKey(Buffer.from(key, 'hex'));
const wrong = 'cd'.repeat(32);
try {
  const a = new JiyiCangFuwu({ CangLu: dir, dbKeyHex: key });
  a.append({ id: 'm1', sessionId: 's1', kind: 'message', ti: 'R111_SECRET_MEMORY', ts: Date.now() }, 'duty');
  a.close();
  const db = path.join(dir, 'memory.db');
  const raw = fs.readFileSync(db);
  ok('memory.db 不再是明文 SQLite 头', !raw.toString('utf8').startsWith('SQLite format 3'));
  ok('memory.db 文件里没有明文哨兵', !raw.includes(Buffer.from('R111_SECRET_MEMORY')));
  const rawJsonl = rawRead(path.join(dir, 'fast-memory.jsonl'));
  ok('JSONL 已静态加密（磁盘无明文哨兵）', rawJsonl.subarray(0, 8).toString() === 'WARMYEF2' && !rawJsonl.includes(Buffer.from('R111_SECRET_MEMORY')));
  const logicalJsonl = fs.readFileSync(path.join(dir, 'fast-memory.jsonl'), 'utf8');
  ok('JSONL 事实源仍可按 key 读回', logicalJsonl.includes('R111_SECRET_MEMORY'));

  const D = require(path.join(memPkg, 'node_modules/better-sqlite3-multiple-ciphers'));
  const bad = new D(db);
  bad.pragma(`key = "x'${wrong}'"`);
  let rejected = false;
  try { bad.prepare('SELECT count(*) FROM sqlite_master').get(); } catch { rejected = true; }
  bad.close();
  ok('错误库密钥被拒绝（不是静默当明文库）', rejected);

  const c = new JiyiCangFuwu({ CangLu: dir, dbKeyHex: key });
  const tail = c.tail(5);
  ok('正确库密钥能读回记录', tail.some((x) => String(x.ti || '').includes('R111_SECRET_MEMORY')));
  c.close();

  /* 静态：主进程登录后派生库密钥并重启记忆子进程；子进程读一次就删 env */
  const main = fs.readFileSync(path.join(pkg, 'src/electron-main.ts'), 'utf8');
  const client = fs.readFileSync(path.join(pkg, 'src/memory-client.ts'), 'utf8');
  const ipc = fs.readFileSync(path.join(memPkg, 'src/ipc.ts'), 'utf8');
  ok('主进程从 DEK 派生 memory 库密钥', /jiYiKuYaoShiHex/.test(main) && /memoryDbKeyHex/.test(main) && /warmy-storage-v1/.test(main));
  ok('登录后重启记忆子进程让加密生效', /chongQiJiYiCangDaiYaoShi/.test(main) && /dbKeyHex: \(\) => memoryDbKeyHex/.test(main));
  ok('有 vault 且未登录时延迟启动（不拿明文驱动开密库）', /memory deferred until login/.test(main));
  ok('明文旧库先改名留档，迁不动就不启动', /plaintext db remains/.test(main) && /memory\.db migrated to encrypted storage/.test(main));
  ok('库密钥只从 env 进子进程，读完即删', /WARMY_MEMORY_DB_KEY_HEX/.test(client) && /delete process\.env\.WARMY_MEMORY_DB_KEY_HEX/.test(ipc));
  ok('驱动是 SQLCipher 兼容的多密码包', /better-sqlite3-multiple-ciphers/.test(fs.readFileSync(path.join(memPkg, 'src/index.ts'), 'utf8')));
} finally {
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }); } catch { /* noop */ }
}
console.log(`\nverify-r111-storage: ${pass} PASS / 0 FAIL`);
