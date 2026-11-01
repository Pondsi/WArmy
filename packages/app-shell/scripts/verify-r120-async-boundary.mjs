#!/usr/bin/env node
/**
 * verify-r120-async-boundary.mjs —— P8：真正的异步存储边界 + 外部编辑流式/冲突。
 *
 * 验行为：
 *   A. fs.promises.readFile/writeFile/appendFile 走真异步 I/O，磁盘仍是密文；
 *   B. 加密 JSONL 异步追加只增长一条记录的物理大小（不重写整个历史）；
 *   C. 写守卫对 promises.appendFile 同样生效；
 *   D. 外部编辑：未改动不写回；改动写回；原文件被并发改动时拒绝覆盖并保留副本；
 *   E. 外部编辑写回不再把整文件读进内存（用 readFileSync 探针证明未读大文件）。
 *
 * 临时目录 + 随机密钥 + 合成内容；不读真实 profile；结束清理。
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const encfs = require('../src/enc-fs.cjs');
const { WaiBuBianJiGuanLiQi } = await import(pathToFileURL(path.join(pkg, 'dist', 'external-edit.js')).href);

let pass = 0;
const ok = (name, cond, detail) => {
  assert.ok(cond, name + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail)));
  pass += 1;
  console.log('PASS ' + name);
};
const raw = (p) => {
  const fd = fs.openSync(p, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const buf = Buffer.alloc(size);
    let off = 0;
    while (off < size) {
      const n = fs.readSync(fd, buf, off, size - off, off);
      if (!n) break;
      off += n;
    }
    return buf.subarray(0, off);
  } finally { try { fs.closeSync(fd); } catch { /* noop */ } }
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-r120-async-'));
const key = crypto.randomBytes(32);
encfs.install({ root });
encfs.setKey(key);

try {
  /* A. promises 读写 */
  const pTxt = path.join(root, 'data', 'note.txt');
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  await fs.promises.writeFile(pTxt, '异步写入的内容');
  ok('promises.writeFile 落盘是密文', raw(pTxt).subarray(0, 8).toString('binary') === 'WARMYEF2');
  ok('promises.readFile 解出原文', (await fs.promises.readFile(pTxt, 'utf8')) === '异步写入的内容');

  /* B. 异步 JSONL 追加：O(一条记录)，不重写历史 */
  const pJsonl = path.join(root, 'data', 'log.jsonl');
  for (let i = 0; i < 20000; i++) await fs.promises.appendFile(pJsonl, JSON.stringify({ i, text: '行'.repeat(20) }) + '\n');
  const sizeBefore = raw(pJsonl).length;
  await fs.promises.appendFile(pJsonl, JSON.stringify({ i: 20000, text: '新行' }) + '\n');
  const sizeAfter = raw(pJsonl).length;
  ok('异步 JSONL 追加只增长一条记录的物理大小', sizeAfter - sizeBefore < 4096, { sizeBefore, sizeAfter });
  const lines = (await fs.promises.readFile(pJsonl, 'utf8')).trimEnd().split('\n');
  ok('异步 JSONL 追加后可逐行读回', lines.length === 20001 && JSON.parse(lines[20000]).i === 20000, { lines: lines.length });

  /* C. 写守卫（守卫语义：有仓库但当前未解锁；先撤 key） */
  encfs.setKey(null);
  encfs.setWriteGuard(() => true);
  const pBlocked = path.join(root, 'data', 'blocked.txt');
  await fs.promises.writeFile(pBlocked, '不应落盘');
  ok('写守卫下 promises.writeFile 不落盘', !fs.existsSync(pBlocked));
  const sizeGuard = raw(pJsonl).length;
  await fs.promises.appendFile(pJsonl, '不应追加\n');
  ok('写守卫下 promises.appendFile 不追加', raw(pJsonl).length === sizeGuard);
  encfs.setWriteGuard(null);
  encfs.setKey(key);

  /* D/E. 外部编辑 */
  const ws = path.join(root, 'workspace');
  const man = path.join(root, 'external-edits');
  fs.mkdirSync(ws, { recursive: true });
  const original = path.join(ws, '报告.txt');
  const big = Buffer.alloc(8 * 1024 * 1024, 0x61);
  fs.writeFileSync(original, big);
  const mgr = new WaiBuBianJiGuanLiQi({ workspaceRoot: ws, manifestDir: man });
  const started = mgr.start(original);
  ok('外部编辑开始后生成副本', started.ok === true && fs.existsSync(started.temp), started);
  const t0 = mgr.finish(started.id, false);
  ok('未改动结束：成功且原文件不变', t0.ok === true && fs.readFileSync(original).equals(big));

  const started2 = mgr.start(original);
  fs.writeFileSync(started2.temp, '外部编辑后的内容');
  const origRead = fs.readFileSync;
  const readPaths = [];
  fs.readFileSync = function (p, ...rest) { try { readPaths.push(String(p)); } catch { /* noop */ } return origRead.call(this, p, ...rest); };
  let t1;
  try { t1 = mgr.finish(started2.id, false); } finally { fs.readFileSync = origRead; }
  ok('改动后结束：写回成功', t1.ok === true && origRead(original, 'utf8') === '外部编辑后的内容', t1);
  ok('写回不再整文件 readFileSync（大文件流式哈希/复制）', !readPaths.includes(String(started2.temp)), { readPaths: readPaths.slice(0, 5) });
  ok('结束成功后副本目录删除', !fs.existsSync(started2.temp));

  const started3 = mgr.start(original);
  fs.writeFileSync(started3.temp, '副本里的新内容');
  fs.writeFileSync(original, '原文件被第三方改了');
  const t2 = mgr.finish(started3.id, false);
  ok('原文件被并发改动时拒绝覆盖', t2.ok === false && /conflict-original-changed/.test(String(t2.error)), t2);
  ok('冲突失败时保留副本（用户的新内容不丢）', fs.existsSync(started3.temp) && fs.readFileSync(started3.temp, 'utf8') === '副本里的新内容');
  ok('冲突失败时原文件保持第三方内容', fs.readFileSync(original, 'utf8') === '原文件被第三方改了');
  const t3 = mgr.finish(started3.id, true);
  ok('冲突后明确丢弃可以清理副本', t3.ok === true && !fs.existsSync(started3.temp));

  console.log(`\nverify-r120-async-boundary: ${pass} PASS / 0 FAIL`);
} finally {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* noop */ }
}
