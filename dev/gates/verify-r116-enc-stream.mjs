/**
 * verify-r116-enc-stream.mjs —— 第 116 轮：跨加密边界的复制/流式写入不得整文件进内存。
 *   · copyFileSync：外→内、内→外、内→内（含 JSONL）都按块转换，目标逻辑字节一致；
 *   · createWriteStream：普通文件/JSONL 分块写入后仍是密文、可完整读回、临时文件不残留；
 *   · 写入中途销毁：目标文件保持原样（先写临时文件再原子替换）；
 *   · 写守卫：已有仓库未解锁时，流式写入不得落盘。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const encFs = require(path.join(root, 'packages/app-shell/dist/enc-fs.cjs'));
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-r116-stream-'));
const rootDir = path.join(base, 'profile');
const outDir = path.join(base, 'outside');
fs.mkdirSync(rootDir, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });
const key = Buffer.alloc(32, 0x5c);
let pass = 0;
const ok = (name, cond, detail) => {
  assert.ok(cond, name + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail)));
  pass += 1;
  console.log('PASS ' + name);
};
const rawHead = (p) => {
  const fd = fs.openSync(p, 'r');
  try {
    const st = fs.fstatSync(fd);
    const b = Buffer.alloc(Math.min(9, st.size));
    fs.readSync(fd, b, 0, b.length, 0);
    return { magic: b.subarray(0, 8).toString(), type: b.length > 8 ? b[8] : -1, size: st.size };
  } finally {
    try { fs.closeSync(fd); } catch { /* noop */ }
  }
};
const tmpLeft = (dir) => fs.readdirSync(dir).filter((n) => /\.(wstream|copy|enc|append)-.*\.tmp$/.test(n));
const writeAll = (p, chunks, opts) => new Promise((resolve, reject) => {
  const ws = fs.createWriteStream(p, opts);
  ws.on('error', reject);
  ws.on('finish', resolve);
  for (const c of chunks) ws.write(c);
  ws.end();
});
const readStreamAll = (p, opts) => new Promise((resolve, reject) => {
  const chunks = [];
  const rs = fs.createReadStream(p, opts);
  rs.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
  rs.on('error', reject);
  rs.on('end', () => resolve(Buffer.concat(chunks)));
});

try {
  encFs.install({ root: rootDir });
  encFs.setKey(key);

  const big = Buffer.alloc(8 * 1024 * 1024);
  for (let i = 0; i < big.length; i += 1) big[i] = (i * 31 + 7) & 0xff;
  const outsideBig = path.join(outDir, 'big.bin');
  fs.writeFileSync(outsideBig, big);

  /* 外 → 内：分块加密复制 */
  const inner1 = path.join(rootDir, 'copy-in.bin');
  fs.copyFileSync(outsideBig, inner1);
  const h1 = rawHead(inner1);
  ok('外→内复制后是密文（流式格式）', h1.magic === 'WARMYEF2' && h1.type === encFs.TYPE_STREAM, h1);
  ok('外→内复制逻辑字节一致', fs.readFileSync(inner1).equals(big));
  ok('外→内复制 stat 报逻辑大小', fs.statSync(inner1).size === big.length, fs.statSync(inner1).size);
  const stBig = fs.statSync(inner1, { bigint: true });
  ok('加密文件 stat bigint 也报逻辑大小', stBig.size === BigInt(big.length), String(stBig.size));
  const seg = await readStreamAll(inner1, { start: 1024 * 1024, end: 2 * 1024 * 1024 - 1 });
  ok('加密文件范围读取（start/end）不整文件缓冲', seg.equals(big.subarray(1024 * 1024, 2 * 1024 * 1024)), { bytes: seg.length });
  const textFile = path.join(rootDir, 'text.txt');
  fs.writeFileSync(textFile, 'hello 世界');
  const textStream = await readStreamAll(textFile, { encoding: 'utf8' });
  ok('加密文件 createReadStream 支持 encoding', textStream.toString('utf8') === 'hello 世界', textStream.toString('utf8'));

  /* 内 → 外：分块解密复制 */
  const outsideBack = path.join(outDir, 'back.bin');
  fs.copyFileSync(inner1, outsideBack);
  ok('内→外复制得到明文（不带封装头）', rawHead(outsideBack).magic !== 'WARMYEF2');
  ok('内→外复制字节一致', fs.readFileSync(outsideBack).equals(big));

  /* 内 → 内：解密再加密 */
  const inner2 = path.join(rootDir, 'copy-in2.bin');
  fs.copyFileSync(inner1, inner2);
  ok('内→内复制仍是密文', rawHead(inner2).magic === 'WARMYEF2');
  ok('内→内复制字节一致', fs.readFileSync(inner2).equals(big));

  /* JSONL 跨边界 */
  const lines = Array.from({ length: 4000 }, (_, i) => `{"i":${i},"s":"line-${i}-${'y'.repeat(30)}"}`).join('\n') + '\n';
  const outsideJsonl = path.join(outDir, 'rows.jsonl');
  fs.writeFileSync(outsideJsonl, lines);
  const innerJsonl = path.join(rootDir, 'rows.jsonl');
  fs.copyFileSync(outsideJsonl, innerJsonl);
  ok('JSONL 外→内复制后是密文', rawHead(innerJsonl).magic === 'WARMYEF2');
  ok('JSONL 外→内复制内容一致', fs.readFileSync(innerJsonl, 'utf8') === lines);
  const innerJsonl2 = path.join(rootDir, 'rows2.jsonl');
  fs.copyFileSync(innerJsonl, innerJsonl2);
  ok('JSONL 内→内复制内容一致', fs.readFileSync(innerJsonl2, 'utf8') === lines);
  const outsideJsonl2 = path.join(outDir, 'rows2.jsonl');
  fs.copyFileSync(innerJsonl, outsideJsonl2);
  ok('JSONL 内→外复制内容一致', fs.readFileSync(outsideJsonl2, 'utf8') === lines);

  /* createWriteStream：普通文件分块 */
  const streamed = path.join(rootDir, 'stream.bin');
  const chunks = [];
  for (let i = 0; i < 32; i += 1) chunks.push(big.subarray(i * 256 * 1024, (i + 1) * 256 * 1024));
  await writeAll(streamed, chunks);
  ok('createWriteStream 普通文件落盘为密文', rawHead(streamed).magic === 'WARMYEF2' && rawHead(streamed).type === encFs.TYPE_STREAM, rawHead(streamed));
  ok('createWriteStream 普通文件逻辑字节一致', fs.readFileSync(streamed).equals(big));
  ok('createWriteStream 普通文件 stat 报逻辑大小', fs.statSync(streamed).size === big.length);
  ok('createWriteStream 结束后没有临时文件残留', tmpLeft(rootDir).length === 0, tmpLeft(rootDir));

  /* createWriteStream：JSONL 不规则分块 */
  const streamedJsonl = path.join(rootDir, 'stream.jsonl');
  const jsonChunks = [];
  let pos = 0;
  while (pos < lines.length) {
    const n = 137 + ((pos * 17) % 4096);
    jsonChunks.push(lines.slice(pos, pos + n));
    pos += n;
  }
  await writeAll(streamedJsonl, jsonChunks);
  ok('createWriteStream JSONL 落盘为密文', rawHead(streamedJsonl).magic === 'WARMYEF2');
  ok('createWriteStream JSONL 内容一致', fs.readFileSync(streamedJsonl, 'utf8') === lines);
  fs.appendFileSync(streamedJsonl, '{"i":"append","s":"one"}\n');
  ok('JSONL 流式写完可继续追加', fs.readFileSync(streamedJsonl, 'utf8') === lines + '{"i":"append","s":"one"}\n');
  await new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(streamedJsonl, { flags: 'a' });
    ws.on('error', reject);
    ws.on('finish', resolve);
    ws.write('{"i":"append-stream","s":"two"}\n{"i":"append-stream","s":"three"}\n');
    ws.end();
  });
  ok('JSONL 用 append 流继续追加（多块）', fs.readFileSync(streamedJsonl, 'utf8') === lines + '{"i":"append","s":"one"}\n{"i":"append-stream","s":"two"}\n{"i":"append-stream","s":"three"}\n');

  /* 中途销毁：原目标不变 */
  const atomic = path.join(rootDir, 'atomic.txt');
  fs.writeFileSync(atomic, 'old-content');
  const dying = fs.createWriteStream(atomic);
  dying.write('new-content');
  await new Promise((r) => setTimeout(r, 30));
  dying.destroy(new Error('abort-for-test'));
  await new Promise((resolve) => {
    dying.once('close', resolve);
    dying.once('error', () => { /* 预期错误，仍等 close */ });
  });
  await new Promise((r) => setTimeout(r, 120));
  ok('流式中途销毁不覆盖原文件', fs.readFileSync(atomic, 'utf8') === 'old-content', fs.readFileSync(atomic, 'utf8'));
  ok('流式中途销毁不留临时文件', tmpLeft(rootDir).length === 0, tmpLeft(rootDir));

  /* 成功覆盖已有文件 */
  await writeAll(atomic, ['new-content']);
  ok('流式写入成功后原子覆盖', fs.readFileSync(atomic, 'utf8') === 'new-content');

  /* 目录复制：技能导入/插件播种用的 cpSync 不能绕过加密层 */
  const srcDir = path.join(outDir, 'skill-src');
  fs.mkdirSync(path.join(srcDir, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'SKILL.md'), '# skill\nhello\n');
  fs.writeFileSync(path.join(srcDir, 'sub', 'data.bin'), Buffer.from([1, 2, 3, 4, 5]));
  const dstDir = path.join(rootDir, 'skills', 'demo');
  fs.cpSync(srcDir, dstDir, { recursive: true });
  /** 第 120 轮决定 1/C：技能代码/文档明文，其余数据仍加密 */
  ok('cpSync 外→内：SKILL.md 明文、data.bin 密文',
    rawHead(path.join(dstDir, 'SKILL.md')).magic !== 'WARMYEF2' && rawHead(path.join(dstDir, 'sub', 'data.bin')).magic === 'WARMYEF2');
  ok('cpSync 外→内后内容可读回', fs.readFileSync(path.join(dstDir, 'SKILL.md'), 'utf8') === '# skill\nhello\n' && fs.readFileSync(path.join(dstDir, 'sub', 'data.bin')).equals(Buffer.from([1, 2, 3, 4, 5])));
  const backDir = path.join(outDir, 'skill-back');
  fs.cpSync(dstDir, backDir, { recursive: true });
  ok('cpSync 内→外后是明文且内容一致',
    !rawHead(path.join(backDir, 'SKILL.md')).magic.startsWith('WARMYEF2')
    && fs.readFileSync(path.join(backDir, 'SKILL.md'), 'utf8') === '# skill\nhello\n'
    && !rawHead(path.join(backDir, 'sub', 'data.bin')).magic.startsWith('WARMYEF2')
    && fs.readFileSync(path.join(backDir, 'sub', 'data.bin')).equals(Buffer.from([1, 2, 3, 4, 5])));
  const filtered = path.join(outDir, 'skill-filtered');
  fs.cpSync(dstDir, filtered, { recursive: true, filter: (s) => !s.endsWith('data.bin') });
  ok('cpSync 尊重 filter（被过滤的文件不复制）', fs.existsSync(path.join(filtered, 'SKILL.md')) && !fs.existsSync(path.join(filtered, 'sub', 'data.bin')));

  /* rename 经受管路径：明文临时文件改成密文 */
  const plainTmp = path.join(rootDir, 'plain-temp.txt');
  const fd = fs.openSync(plainTmp, 'w');
  fs.writeSync(fd, 'renamed-plain');
  fs.closeSync(fd);
  const renamed = path.join(rootDir, 'renamed.json');
  fs.renameSync(plainTmp, renamed);
  ok('rename 后普通文件被封装', rawHead(renamed).magic === 'WARMYEF2', rawHead(renamed));
  ok('rename 后内容可读回', fs.readFileSync(renamed, 'utf8') === 'renamed-plain');

  /* 写守卫：有仓库未解锁时流式写入不得落盘 */
  encFs.setKey(null);
  encFs.setWriteGuard(() => true);
  const blocked = path.join(rootDir, 'blocked.bin');
  await writeAll(blocked, ['must-not-write']).catch(() => {});
  ok('写守卫下 createWriteStream 不落盘', !fs.existsSync(blocked));
  ok('写守卫下 copyFileSync 不落盘', (() => { const t = path.join(rootDir, 'blocked-copy.bin'); fs.copyFileSync(outsideBig, t); return !fs.existsSync(t); })());
  encFs.setWriteGuard(null);
  encFs.setKey(key);
  ok('解锁后仍可正常读取加密文件', fs.readFileSync(streamed).equals(big));

  console.log(`\nverify-r116-enc-stream: ${pass} PASS / 0 FAIL`);
} finally {
  try { fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }); } catch { /* noop */ }
}
