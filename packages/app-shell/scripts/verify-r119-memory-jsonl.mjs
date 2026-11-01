#!/usr/bin/env node
/**
 * verify-r119-memory-jsonl.mjs —— 加密 JSONL 的逻辑记录迭代与明文偏移索引。
 *
 * 旧实现用原生 fd 逐行读加密 JSONL，读到的是 WARMYEF2 密文；投影重建与原文回读都会坏。
 * 本门禁只做合成文件：加密 JSONL 的索引/逐行/范围读取必须与明文逐字一致；明文回退仍可用。
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..');
const require = createRequire(import.meta.url);
const encfs = require('../src/enc-fs.cjs');
const mem = await import(pathToFileURL(path.join(repo, 'packages', 'memory-os', 'dist', 'index.js')).href);

let pass = 0;
const ok = (name, cond, detail) => {
  assert.ok(cond, name + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail)));
  pass += 1;
  console.log('PASS ' + name);
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-r119-memjsonl-'));
encfs.install({ root });
encfs.setKey(crypto.randomBytes(32));

const jsonl = path.join(root, 'memory', 'fast-memory.jsonl');
fs.mkdirSync(path.dirname(jsonl), { recursive: true });
const rows = [
  { seq: 1, id: 'a', sessionId: 's1', kind: 'fact', ts: 1, ti: '第一段记忆：今天把验收判分修好了。' },
  { seq: 2, id: 'b', sessionId: 's1', kind: 'fact', ts: 2, ti: '第二段记忆：封存前必须证明归档能解开。' },
];
for (const r of rows) fs.appendFileSync(jsonl, JSON.stringify(r) + '\n');

const idx = mem.gouJianJsonlSuoYin(jsonl);
ok('加密 JSONL 索引条目数正确', idx.entries.length === 2, idx.entries);
ok('索引预览是明文而不是 WARMYEF2', idx.entries.every((e) => !e.ti.includes('WARMYEF2')) && idx.entries[0].ti.includes('验收判分'), idx.entries.map((e) => e.ti));
ok('索引大小是逻辑明文大小', idx.size === Buffer.byteLength(rows.map((r) => JSON.stringify(r) + '\n').join(''), 'utf8'), idx.size);

const lines = [...mem.meiHangLiu(jsonl)];
ok('逐行迭代返回两行明文', lines.length === 2 && lines[0].includes('验收判分') && lines[1].includes('封存前'), lines);

const f = fs;
for (const e of idx.entries) {
  const raw = f.__warmyReadLogicalRangeSync(jsonl, e.start, e.end).toString('utf8').trim();
  const parsed = JSON.parse(raw);
  const expect = rows.find((r) => r.seq === e.seq);
  ok(`范围读取 seq=${e.seq} 与原文一致`, expect && parsed.ti === expect.ti, { raw: raw.slice(0, 120) });
}

// 明文 JSONL 回退（不在加密根内）
const plain = path.join(os.tmpdir(), 'warmy-r119-plain-' + process.pid + '.jsonl');
fs.writeFileSync(plain, JSON.stringify({ seq: 9, ti: '明文回退' }) + '\n', 'utf8');
const pidx = mem.gouJianJsonlSuoYin(plain);
ok('明文 JSONL 索引回退仍可用', pidx.entries.length === 1 && pidx.entries[0].ti === '明文回退', pidx.entries);
ok('明文逐行迭代回退仍可用', [...mem.meiHangLiu(plain)][0].includes('明文回退'));
try { fs.rmSync(plain, { force: true }); } catch { /* noop */ }
try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* noop */ }

console.log(`\nverify-r119-memory-jsonl: ${pass} PASS / 0 FAIL`);
