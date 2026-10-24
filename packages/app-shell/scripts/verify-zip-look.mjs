/**
 * 门禁：zip-look（**看压缩包内部**的纯 JS 解析）。
 * 真实造一个 zip（手写 local/central header），再列条目、读条目、拦 zip slip。
 *
 * 用法：<node> verify-zip-look.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { lieYaSuoBaoTiaoMu, duYaSuoBaoTiaoMu, tiaoMuMingAnQuan } from '../dist/zip-look.js';

/** 手工造一个 stored/deflate 混合的 zip（不依赖第三方库） */
function zaoZip(tiao) {
  const ju = [];
  const cen = [];
  let off = 0;
  for (const t of tiao) {
    const ming = Buffer.from(t.name, 'utf8');
    const yuan = Buffer.from(t.data, 'utf8');
    const ya = t.store ? yuan : zlib.deflateRawSync(yuan);
    const method = t.store ? 0 : 8;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(method, 8); lh.writeUInt32LE(0, 14);
    lh.writeUInt32LE(ya.length, 18); lh.writeUInt32LE(yuan.length, 22);
    lh.writeUInt16LE(ming.length, 26); lh.writeUInt16LE(0, 28);
    ju.push(lh, ming, ya);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(method, 10); ch.writeUInt32LE(0, 16);
    ch.writeUInt32LE(ya.length, 20); ch.writeUInt32LE(yuan.length, 24);
    ch.writeUInt16LE(ming.length, 28); ch.writeUInt32LE(off, 42);
    cen.push(ch, ming);
    off += lh.length + ming.length + ya.length;
  }
  const cenBuf = Buffer.concat(cen);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(tiao.length, 8); eocd.writeUInt16LE(tiao.length, 10);
  eocd.writeUInt32LE(cenBuf.length, 12); eocd.writeUInt32LE(off, 16);
  return Buffer.concat([...ju, cenBuf, eocd]);
}

const zip = zaoZip([
  { name: 'hello.txt', data: '你好，世界\n第二行', store: false },
  { name: 'docs/readme.md', data: '# 说明\n压缩包里的 markdown', store: false },
  { name: 'raw.bin', data: 'Xbinary', store: true },
  { name: 'folder/', data: '', store: true },
]);

let n = 0;
const ok = (t, fn) => { fn(); n++; console.log('ok  ', t); };

ok('列出条目（含目录、大小）', () => {
  const tiao = lieYaSuoBaoTiaoMu(zip);
  assert.deepEqual(tiao.map((x) => x.name), ['hello.txt', 'docs/readme.md', 'raw.bin', 'folder/']);
  assert.equal(tiao.find((x) => x.name === 'hello.txt')?.isDirectory, false);
  assert.equal(tiao.find((x) => x.name === 'folder/')?.isDirectory, true);
});

ok('读 deflate 条目（中文正确解出）', () => {
  assert.equal(duYaSuoBaoTiaoMu(zip, 'hello.txt').toString('utf8'), '你好，世界\n第二行');
});

ok('读 stored 条目', () => {
  assert.equal(duYaSuoBaoTiaoMu(zip, 'raw.bin').toString('utf8'), 'Xbinary');
});

ok('读子目录里的条目', () => {
  assert.match(duYaSuoBaoTiaoMu(zip, 'docs/readme.md').toString('utf8'), /压缩包里的 markdown/);
});

ok('zip slip：`..`、绝对路径、盘符一律拒绝', () => {
  assert.equal(tiaoMuMingAnQuan('../etc/passwd'), false);
  assert.equal(tiaoMuMingAnQuan('/etc/passwd'), false);
  assert.equal(tiaoMuMingAnQuan('C:/Windows/system32'), false);
  assert.equal(tiaoMuMingAnQuan('a/../../b'), false);
  assert.equal(tiaoMuMingAnQuan('docs/readme.md'), true);
  assert.throws(() => duYaSuoBaoTiaoMu(zip, '../evil.txt'), /zip-slip/);
});

ok('不存在的条目如实报 not-found', () => {
  assert.throws(() => duYaSuoBaoTiaoMu(zip, '没有这个.txt'), /not-found/);
});

ok('不是 zip 报 not-a-zip', () => {
  assert.throws(() => lieYaSuoBaoTiaoMu(Buffer.from('这不是压缩包')), /not-a-zip/);
});

const tmp = path.join(os.tmpdir(), 'zip-look-selftest.zip');
fs.writeFileSync(tmp, zip);
ok('真实文件路径可读', () => {
  assert.equal(lieYaSuoBaoTiaoMu(fs.readFileSync(tmp)).length, 4);
  fs.unlinkSync(tmp);
});

console.log(`==== verify-zip-look: ${n} 全部通过 ====`);
process.exit(0);
