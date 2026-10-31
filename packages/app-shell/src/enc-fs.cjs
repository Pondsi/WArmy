/**
 * 运行期静态加密层（第 114 轮，全量加密第二阶段）。
 *
 * 目标：应用管理的数据在磁盘上**始终是密文**，只在进程内按需解密。
 * 做法：在 Node 主进程/记忆子进程里包一层 fs：
 *   · 写入 → AES-256-GCM 封装后再落盘；
 *   · 读取 → 识别封装并解密；
 *   · JSONL 使用逐记录 AEAD 追加，避免每次追加重写整个文件。
 *
 * 明确的边界（不假装）：
 *   · workspace/ 是外部工具/IDE/Office 的工作区，保持明文；外部编辑走显式会话；
 *   · auth/ identity/ secure/ 已有各自的密钥/系统保护，且登录前必须可读；
 *   · Chromium 缓存、字体、截图、日志、node_modules、vault.bin、memory.db 不在此层；
 *   · 外部项目目录（userData 之外）不在此层。
 *
 * 这是应用侧加密，不是文件系统级强制；同 OS 用户的管理员进程/内存转储不在威胁模型内。
 */
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
/** patch 前的 promises 原函数：包装层内部必须用它们，否则会递归调用自己 */
const origFsp = {
  readFile: fsp.readFile.bind(fsp),
  writeFile: fsp.writeFile.bind(fsp),
  appendFile: fsp.appendFile.bind(fsp),
  open: fsp.open.bind(fsp),
};
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable, Writable } = require('node:stream');

const MAGIC = Buffer.from('WARMYEF2', 'binary');
const TYPE_FILE = 0;
const TYPE_JSONL = 1;
/** 流式写入的普通文件：AAD 不含逻辑长度（长度在结束时才回填头），用于 createWriteStream/copyFileSync */
const TYPE_STREAM = 2;
const HEADER_LEN = 21; // magic 8 + type 1 + logicalSize 8 + recordCount 4

let KEY = null;
let ROOT = '';
let GET_KEY = null;
let WRITE_GUARD = null;
let INSTALLED = false;

const EXEMPT_DIRS = new Set([
  'auth', 'identity', 'secure', 'workspace', 'external-edits', 'memory-runtime',
  'updates', 'logs', 'dsh-packages', 'dsh-home', 'mimic', 'node_modules', '.git', 'Cache', 'Code Cache',
  'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'Session Storage', 'Local Storage',
  'Shared Dictionary', 'blob_storage', 'Network', 'DIPS', 'fonts', 'screenshots',
  'node', 'pnpm-store', 'release', 'dist',
]);
const EXEMPT_FILE = /^(vault\.bin.*|vault\.session.*|vault\.clean.*|warmy-boot\.log|memory\.db(?:-wal|-shm)?|DIPS(?:-wal)?|SharedStorage(?:-wal)?|Preferences|Local State|DevToolsActivePort|lockfile|Singleton.*)$/i;
const EXEMPT_EXT = /\.(lock|log)$/i;
/**
 * 第 120 轮（决定 1/C）：技能/插件**代码走明文，配置仍加密**。
 * 外部 Node/Python 解释器直接执行 `bridge.mjs` 这类入口时读不到本层密文，
 * 因此只把可重新下载的代码/文档放行；`mcp-servers.json` 等配置、凭据仍留在密文边界内。
 */
const CODE_EXT = /\.(mjs|cjs|js|jsx|ts|tsx|mts|cts|py|pyw|rb|go|rs|java|kt|kts|sh|bash|zsh|ps1|bat|cmd|pl|lua|php|sql|r|swift|cs)$/i;
const CODE_META = /^(SKILL\.md|README(?:\.[^/]*)?\.md|LICENSE(?:\.[^/]*)?|package\.json|plugin\.json|tsconfig\.json|requirements\.txt|pyproject\.toml|Cargo\.toml|go\.mod)$/i;

/** 判断路径是否落在技能/插件代码目录内（代码目录内的配置仍然加密） */
function inCodeRoot(rel) {
  const parts = rel.split('/');
  const top = parts[0] ? parts[0].toLowerCase() : '';
  if (top === 'skills' && parts.length >= 2) return true;
  if (top === 'scan-dirs' && parts.length >= 3) {
    const second = (parts[1] || '').toLowerCase();
    return second === 'skills' || second === 'plugins';
  }
  return false;
}
function isPlainCodeFile(p) {
  if (!ROOT || typeof p !== 'string' || !underRoot(p)) return false;
  const rel = path.relative(ROOT, p).replace(/\\/g, '/');
  if (!rel || rel.startsWith('..') || !inCodeRoot(rel)) return false;
  const name = rel.split('/').pop() || '';
  return CODE_EXT.test(name) || CODE_META.test(name);
}
function isCodePath(p) {
  if (!ROOT || typeof p !== 'string' || !underRoot(p)) return false;
  const rel = path.relative(ROOT, p).replace(/\\/g, '/');
  return !!rel && !rel.startsWith('..') && inCodeRoot(rel);
}

function norm(p) {
  return path.resolve(String(p || '')).replace(/\\/g, '/').toLowerCase();
}
function underRoot(p) {
  if (!ROOT) return false;
  const r = norm(ROOT);
  const x = norm(p);
  return x === r || x.startsWith(r + '/');
}
function policyFile(p) {
  if (!ROOT || typeof p !== 'string' || !underRoot(p)) return false;
  const rel = path.relative(ROOT, p).replace(/\\/g, '/');
  if (!rel || rel.startsWith('..')) return false;
  const parts = rel.split('/');
  if (EXEMPT_DIRS.has(parts[0])) return false;
  if (EXEMPT_FILE.test(parts[parts.length - 1])) return false;
  if (EXEMPT_EXT.test(rel)) return false;
  if (isPlainCodeFile(p)) return false;
  return true;
}
/** 目录/文件的受管范围判断（cpSync 需要先判断目标目录是否在加密层内） */
function policyPath(p) {
  if (!ROOT || typeof p !== 'string' || !underRoot(p)) return false;
  const rel = path.relative(ROOT, p).replace(/\\/g, '/');
  if (!rel || rel.startsWith('..')) return false;
  return !EXEMPT_DIRS.has(rel.split('/')[0]);
}
function keyNow() {
  try {
    if (GET_KEY) { const k = GET_KEY(); if (k && k.length === 32) return k; }
  } catch { /* noop */ }
  return KEY && KEY.length === 32 ? KEY : null;
}
function writeBlocked() {
  try { return !keyNow() && typeof WRITE_GUARD === 'function' && WRITE_GUARD(); } catch { return false; }
}
function isEncryptedBuf(b) {
  return Buffer.isBuffer(b) && b.length >= HEADER_LEN && b.subarray(0, 8).equals(MAGIC);
}
function aadFile(type, logicalSize) {
  const b = Buffer.alloc(9);
  MAGIC.copy(b, 0);
  b[8] = type;
  const n = Buffer.alloc(8); n.writeBigUInt64BE(BigInt(logicalSize || 0), 0);
  return Buffer.concat([b, n]);
}
/** TYPE_STREAM 的长度要到写完才知道，AAD 固定按 0，头里的 logicalSize 只给逻辑读取用 */
function aadFor(type, logicalSize) {
  return aadFile(type, type === TYPE_STREAM ? 0 : logicalSize);
}
function aadRecord(index) {
  const b = Buffer.alloc(13);
  MAGIC.copy(b, 0);
  b[8] = TYPE_JSONL;
  b.writeUInt32BE(index >>> 0, 9);
  return b;
}
function header(type, logicalSize, recordCount) {
  const h = Buffer.alloc(HEADER_LEN);
  MAGIC.copy(h, 0);
  h[8] = type;
  h.writeBigUInt64BE(BigInt(Math.max(0, Math.floor(Number(logicalSize) || 0))), 9);
  h.writeUInt32BE(recordCount >>> 0, 17);
  return h;
}
function readHeader(buf) {
  if (!isEncryptedBuf(buf)) return null;
  const t = buf[8];
  return {
    type: t === TYPE_JSONL ? TYPE_JSONL : t === TYPE_STREAM ? TYPE_STREAM : TYPE_FILE,
    logicalSize: Number(buf.readBigUInt64BE(9)),
    recordCount: buf.readUInt32BE(17),
  };
}
function sealFileBuffer(plain) {
  const k = keyNow();
  if (!k) return plain;
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', k, nonce);
  cipher.setAAD(aadFile(TYPE_FILE, plain.length));
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([header(TYPE_FILE, plain.length, 1), nonce, ct, cipher.getAuthTag()]);
}
function sealJsonlBuffer(plain) {
  const k = keyNow();
  if (!k) return plain;
  const rec = sealRecord(k, plain, 0);
  return Buffer.concat([header(TYPE_JSONL, plain.length, 1), rec]);
}
function sealRecord(k, plain, index) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', k, nonce);
  cipher.setAAD(aadRecord(index));
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const rec = Buffer.alloc(8 + 12 + ct.length + 16);
  rec.writeUInt32BE(index >>> 0, 0);
  rec.writeUInt32BE(ct.length, 4);
  nonce.copy(rec, 8);
  ct.copy(rec, 20);
  cipher.getAuthTag().copy(rec, 20 + ct.length);
  return rec;
}
function openBuffer(buf) {
  const h = readHeader(buf);
  if (!h) return buf;
  const k = keyNow();
  if (!k) throw Object.assign(new Error('encrypted-data-locked'), { code: 'ENC_LOCKED' });
  if (h.type === TYPE_FILE || h.type === TYPE_STREAM) {
    const nonce = buf.subarray(HEADER_LEN, HEADER_LEN + 12);
    const tag = buf.subarray(buf.length - 16);
    const ct = buf.subarray(HEADER_LEN + 12, buf.length - 16);
    const d = crypto.createDecipheriv('aes-256-gcm', k, nonce);
    d.setAAD(aadFor(h.type, h.logicalSize));
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]);
  }
  const parts = [];
  let pos = HEADER_LEN;
  let idx = 0;
  while (pos + 8 <= buf.length) {
    const li = buf.readUInt32BE(pos);
    const len = buf.readUInt32BE(pos + 4);
    if (pos + 8 + 12 + len + 16 > buf.length) break;
    const nonce = buf.subarray(pos + 8, pos + 20);
    const ct = buf.subarray(pos + 20, pos + 20 + len);
    const tag = buf.subarray(pos + 20 + len, pos + 20 + len + 16);
    const d = crypto.createDecipheriv('aes-256-gcm', k, nonce);
    d.setAAD(aadRecord(li));
    d.setAuthTag(tag);
    parts.push(d.update(ct), d.final());
    pos += 8 + 12 + len + 16;
    idx += 1;
  }
  return Buffer.concat(parts);
}

const orig = {
  readFileSync: fs.readFileSync.bind(fs),
  writeFileSync: fs.writeFileSync.bind(fs),
  appendFileSync: fs.appendFileSync.bind(fs),
  copyFileSync: fs.copyFileSync.bind(fs),
  cpSync: fs.cpSync.bind(fs),
  lstatSync: fs.lstatSync.bind(fs),
  renameSync: fs.renameSync.bind(fs),
  statSync: fs.statSync.bind(fs),
  readdirSync: fs.readdirSync.bind(fs),
  readSync: fs.readSync.bind(fs),
  createReadStream: fs.createReadStream.bind(fs),
  createWriteStream: fs.createWriteStream.bind(fs),
  openSync: fs.openSync.bind(fs),
  writeSync: fs.writeSync.bind(fs),
  closeSync: fs.closeSync.bind(fs),
  truncateSync: fs.truncateSync.bind(fs),
};

function readLogical(p) {
  let raw;
  try { raw = orig.readFileSync(p); } catch (e) { throw e; }
  return openBuffer(raw);
}

/**
 * 逻辑记录迭代（同步）：给记忆子进程的 JSONL 索引用。
 * 原生 fd 读到的是 WARMYEF2 密文，不能直接按 JSONL 行解析；这里按**记录长度**逐条读、
 * 逐条解密，内存只与单条记录大小有关，不把整文件读进来。
 * 非加密文件返回 null，调用方保持原有逐行读取。
 */
function* readLogicalRecordsSync(p) {
  let head = null;
  try {
    const fd = orig.openSync(p, 'r');
    try {
      const b = Buffer.alloc(HEADER_LEN);
      const n = orig.readSync(fd, b, 0, HEADER_LEN, 0);
      head = b.subarray(0, n);
    } finally { try { orig.closeSync(fd); } catch { /* noop */ } }
  } catch (e) {
    if (e && e.code === 'ENOENT') return;
    throw e;
  }
  if (!isEncryptedBuf(head)) return;
  const h = readHeader(head);
  if (!h) throw Object.assign(new Error('bad-encrypted-header'), { code: 'ENC_BAD_HEADER' });
  const k = keyNow();
  if (!k) throw Object.assign(new Error('encrypted-data-locked'), { code: 'ENC_LOCKED' });
  if (h.type !== TYPE_JSONL) {
    yield readLogical(p);
    return;
  }
  const fd = orig.openSync(p, 'r');
  try {
    let pos = HEADER_LEN;
    const rh = Buffer.alloc(8);
    for (;;) {
      const n = orig.readSync(fd, rh, 0, 8, pos);
      if (n === 0) break;
      if (n !== 8) throw Object.assign(new Error('bad-encrypted-record（记录头截断）'), { code: 'ENC_BAD_RECORD' });
      const len = rh.readUInt32BE(4);
      if (len > 64 * 1024 * 1024) throw Object.assign(new Error('bad-encrypted-record（记录过大）'), { code: 'ENC_BAD_RECORD' });
      const body = Buffer.alloc(12 + len + 16);
      const n2 = orig.readSync(fd, body, 0, body.length, pos + 8);
      if (n2 !== body.length) throw Object.assign(new Error('bad-encrypted-record（记录截断）'), { code: 'ENC_BAD_RECORD' });
      const d = crypto.createDecipheriv('aes-256-gcm', k, body.subarray(0, 12));
      d.setAAD(aadRecord(rh.readUInt32BE(0)));
      d.setAuthTag(body.subarray(12 + len));
      yield Buffer.concat([d.update(body.subarray(12, 12 + len)), d.final()]);
      pos += 8 + body.length;
    }
  } finally { try { orig.closeSync(fd); } catch { /* noop */ } }
}

/** 按**明文字节偏移**读取范围（索引里存的是逻辑偏移，不是密文偏移） */
function readLogicalRangeSync(p, start, end) {
  const a = Math.max(0, Math.floor(Number(start) || 0));
  const b = Math.max(a, Math.floor(Number(end) || 0));
  if (b === a) return Buffer.alloc(0);
  if (!isEncryptedPath(p)) {
    const out = Buffer.alloc(b - a);
    const fd = orig.openSync(p, 'r');
    try { orig.readSync(fd, out, 0, out.length, a); } finally { try { orig.closeSync(fd); } catch { /* noop */ } }
    return out;
  }
  const parts = [];
  let pos = 0;
  for (const r of readLogicalRecordsSync(p)) {
    const rs = pos;
    const re = pos + r.length;
    pos = re;
    if (re <= a || rs >= b) continue;
    parts.push(r.subarray(Math.max(0, a - rs), Math.min(r.length, b - rs)));
    if (pos >= b) break;
  }
  return Buffer.concat(parts);
}
function writeRawSealed(p, plain, typeJsonl) {
  const k = keyNow();
  const buf = k ? (typeJsonl ? sealJsonlBuffer(plain) : sealFileBuffer(plain)) : plain;
  orig.writeFileSync(p, buf);
}
function appendLogical(p, data) {
  const k = keyNow();
  const add = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
  if (!k) {
    const fdPlain = orig.openSync(p, 'a');
    try { orig.writeSync(fdPlain, add, 0, add.length); } finally { try { orig.closeSync(fdPlain); } catch { /* noop */ } }
    return;
  }
  /**
   * 只读固定头判断格式；**只有 ENOENT 可以当作"新文件"**。
   * 旧实现把所有读取错误都当成空文件，然后覆盖写 —— 实测 1 MiB 被写成 74 B。
   */
  let headBuf = null;
  try {
    const fdHead = orig.openSync(p, 'r');
    try {
      const b = Buffer.alloc(HEADER_LEN);
      const n = orig.readSync(fdHead, b, 0, HEADER_LEN, 0);
      headBuf = b.subarray(0, n);
    } finally { try { orig.closeSync(fdHead); } catch { /* noop */ } }
  } catch (e) {
    if (e && e.code !== 'ENOENT') throw e;
  }
  const duQuanWen = () => {
    try { return orig.readFileSync(p); } catch (e) { if (e && e.code === 'ENOENT') return Buffer.alloc(0); throw e; }
  };
  if (!headBuf || headBuf.length === 0 || !isEncryptedBuf(headBuf)) {
    // 新文件 / 旧明文文件：需要完整旧内容才能重新封装（旧明文迁移路径）
    const old = headBuf && headBuf.length ? duQuanWen() : Buffer.alloc(0);
    writeRawSealed(p, Buffer.concat([old, add]), true);
    return;
  }
  const h = readHeader(headBuf);
  if (!h || (h.type !== TYPE_JSONL && h.type !== TYPE_FILE && h.type !== TYPE_STREAM)) {
    throw Object.assign(new Error('bad-encrypted-header（密文头损坏，拒绝追加覆盖）'), { code: 'ENC_BAD_HEADER' });
  }
  if (h.type !== TYPE_JSONL) {
    /** 已经是密文但分块格式：流式读出旧内容 + 追加块，再原子替换，避免大文件整块进内存 */
    const tmp = `${p}.append-${process.pid}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.tmp`;
    const mode = (() => { try { return orig.statSync(p).mode & 0o777; } catch { return 0o666; } })();
    const base = openPlainReader(p);
    let extraPos = 0;
    const reader = {
      size: base.size + add.length,
      read(buf) {
        const old = base.read(buf);
        if (old) return old;
        if (extraPos >= add.length) return null;
        const n = Math.min(buf.length, add.length - extraPos);
        add.copy(buf, 0, extraPos, extraPos + n);
        extraPos += n;
        return buf.subarray(0, n);
      },
      close: () => base.close(),
    };
    try {
      try { writeSealedFromReader(reader, tmp, k, true, mode); } finally { reader.close(); }
      orig.renameSync(tmp, p);
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* noop */ }
      throw e;
    }
    return;
  }
  const rec = sealRecord(k, add, h.recordCount);
  const preSize = (() => { try { return orig.statSync(p).size; } catch { return HEADER_LEN; } })();
  try {
    // 正常追加 O(头＋新记录)：不再先读整个文件
    const fdAppend = orig.openSync(p, 'a');
    try { orig.writeSync(fdAppend, rec, 0, rec.length); } finally { try { orig.closeSync(fdAppend); } catch { /* noop */ } }
    // 只改头里的逻辑长度/记录数，不重写正文
    const fd = orig.openSync(p, 'r+');
    try {
      const h2 = header(TYPE_JSONL, h.logicalSize + add.length, h.recordCount + 1);
      orig.writeSync(fd, h2, 0, HEADER_LEN, 0);
    } finally { try { orig.closeSync(fd); } catch { /* noop */ } }
  } catch (e) {
    /**
     * 追加或头更新失败：尽力回滚到追加前的大小，避免留下"半条记录 + 旧头"的组合。
     * 回滚失败就显式抛 ENC_APPEND_PARTIAL，让上层知道文件需要恢复，绝不静默。
     */
    try { orig.truncateSync(p, preSize); } catch {
      throw Object.assign(new Error('ENC_APPEND_PARTIAL（追加失败且无法回滚尾部，需要从备份恢复）'), { code: 'ENC_APPEND_PARTIAL', cause: e });
    }
    throw e;
  }
}
/**
 * 异步追加（fs.promises.appendFile）：正常加密 JSONL 只用文件句柄追加一条记录，
 * 不把整个历史读回来；旧明文/旧分块格式才走整文件重封。
 */
async function appendLogicalAsync(p, data) {
  const k = keyNow();
  const add = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
  if (!k) return origFsp.appendFile(p, add);
  const atomicSeal = async (plain, jsonl) => {
    const tmp = `${p}.async-${process.pid}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.tmp`;
    try {
      await origFsp.writeFile(tmp, jsonl ? sealJsonlBuffer(plain) : sealFileBuffer(plain), { mode: 0o600 });
      orig.renameSync(tmp, p);
    } catch (e) {
      try { await origFsp.rm(tmp, { force: true }); } catch { /* noop */ }
      throw e;
    }
  };
  let fh = null;
  let headBuf = null;
  try {
    fh = await origFsp.open(p, 'r+');
    const b = Buffer.alloc(HEADER_LEN);
    const r = await fh.read(b, 0, HEADER_LEN, 0);
    headBuf = b.subarray(0, r.bytesRead);
  } catch (e) {
    if (!e || e.code !== 'ENOENT') { if (fh) { try { await fh.close(); } catch { /* noop */ } } throw e; }
  }
  const closeFh = async () => { if (fh) { try { await fh.close(); } catch { /* noop */ } fh = null; } };
  if (!headBuf || !headBuf.length || !isEncryptedBuf(headBuf)) {
    await closeFh();
    let old = Buffer.alloc(0);
    try { old = await origFsp.readFile(p); } catch (e) { if (!e || e.code !== 'ENOENT') throw e; }
    await atomicSeal(Buffer.concat([old, add]), true);
    return;
  }
  const h = readHeader(headBuf);
  if (!h || (h.type !== TYPE_JSONL && h.type !== TYPE_FILE && h.type !== TYPE_STREAM)) {
    await closeFh();
    throw Object.assign(new Error('bad-encrypted-header（密文头损坏，拒绝追加覆盖）'), { code: 'ENC_BAD_HEADER' });
  }
  if (h.type !== TYPE_JSONL) {
    await closeFh();
    const raw = await origFsp.readFile(p);
    await atomicSeal(Buffer.concat([openBuffer(raw), add]), false);
    return;
  }
  const rec = sealRecord(k, add, h.recordCount);
  let pre = HEADER_LEN;
  try {
    pre = (await fh.stat()).size;
    await fh.write(rec, 0, rec.length, pre);
    await fh.write(header(TYPE_JSONL, h.logicalSize + add.length, h.recordCount + 1), 0, HEADER_LEN, 0);
  } catch (e) {
    try { await fh.truncate(pre); } catch {
      throw Object.assign(new Error('ENC_APPEND_PARTIAL（异步追加失败且无法回滚尾部，需要从备份恢复）'), { code: 'ENC_APPEND_PARTIAL', cause: e });
    }
    throw e;
  } finally {
    await closeFh();
  }
}

/** 流式加密普通文件：不把大文件整块读进内存 */
function sealFileToPath(src, dst, k) {
  const st = orig.statSync(src);
  const fdIn = orig.openSync(src, 'r');
  const fdOut = orig.openSync(dst, 'w');
  try {
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', k, nonce);
    cipher.setAAD(aadFile(TYPE_FILE, st.size));
    orig.writeSync(fdOut, Buffer.concat([header(TYPE_FILE, st.size, 1), nonce]));
    const buf = Buffer.allocUnsafe(1024 * 1024);
    let pos = 0;
    while (pos < st.size) {
      const n = orig.readSync(fdIn, buf, 0, Math.min(buf.length, st.size - pos), pos);
      if (!n) break;
      const out = cipher.update(buf.subarray(0, n));
      if (out.length) orig.writeSync(fdOut, out);
      pos += n;
    }
    const fin = cipher.final();
    if (fin.length) orig.writeSync(fdOut, fin);
    orig.writeSync(fdOut, cipher.getAuthTag());
  } finally {
    try { orig.closeSync(fdIn); } catch { /* noop */ }
    try { orig.closeSync(fdOut); } catch { /* noop */ }
  }
}

/** 流式加密 JSONL：逐记录追加，内存只保留一个读取块和半行 */
function sealJsonlToPath(src, dst, k) {
  const fdIn = orig.openSync(src, 'r');
  const fdOut = orig.openSync(dst, 'w');
  const buf = Buffer.allocUnsafe(1024 * 1024);
  let carry = Buffer.alloc(0);
  let logical = 0;
  let count = 0;
  const xie = (line) => {
    if (!line.length) return;
    orig.writeSync(fdOut, sealRecord(k, line, count));
    logical += line.length;
    count += 1;
  };
  try {
    orig.writeSync(fdOut, header(TYPE_JSONL, 0, 0));
    for (;;) {
      const n = orig.readSync(fdIn, buf, 0, buf.length, null);
      if (!n) break;
      let zai = Buffer.concat([carry, buf.subarray(0, n)]);
      let start = 0;
      for (;;) {
        const i = zai.indexOf(10, start);
        if (i < 0) break;
        xie(zai.subarray(start, i + 1));
        start = i + 1;
      }
      carry = start < zai.length ? zai.subarray(start) : Buffer.alloc(0);
    }
    if (carry.length) xie(carry);
    const h = header(TYPE_JSONL, logical, count);
    orig.writeSync(fdOut, h, 0, HEADER_LEN, 0);
  } finally {
    try { orig.closeSync(fdIn); } catch { /* noop */ }
    try { orig.closeSync(fdOut); } catch { /* noop */ }
  }
}

/**
 * 同步的「逻辑读取器」：把受管文件（可能加密）按块解出来给复制用。
 * decode=false 只给加密边界外的文件用：外部文件即使碰巧以 WARMYEF2 开头也按原字节复制。
 */
function openPlainReader(src, decode = true) {
  const fd = orig.openSync(src, 'r');
  const st = fs.fstatSync(fd);
  const head = Buffer.alloc(Math.min(HEADER_LEN, st.size));
  const readAt = (buf, pos) => {
    let off = 0;
    while (off < buf.length) {
      const n = orig.readSync(fd, buf, off, buf.length - off, pos + off);
      if (!n) break;
      off += n;
    }
    return off;
  };
  if (head.length) readAt(head, 0);
  const h = decode && isEncryptedBuf(head) ? readHeader(head) : null;
  let pos = 0;
  let end = st.size;
  let dec = null;
  let tagDone = false;
  let queue = Buffer.alloc(0);
  let k = null;
  if (h) {
    k = keyNow();
    if (!k) {
      try { orig.closeSync(fd); } catch { /* noop */ }
      throw Object.assign(new Error('encrypted-data-locked'), { code: 'ENC_LOCKED' });
    }
    if (h.type === TYPE_JSONL) {
      pos = HEADER_LEN;
    } else {
      const nonce = Buffer.alloc(12);
      readAt(nonce, HEADER_LEN);
      dec = crypto.createDecipheriv('aes-256-gcm', k, nonce);
      dec.setAAD(aadFor(h.type, h.logicalSize));
      pos = HEADER_LEN + 12;
      end = st.size - 16;
    }
  }
  const readRaw = (buf) => {
    if (pos >= end) return null;
    const n = orig.readSync(fd, buf, 0, Math.min(buf.length, end - pos), pos);
    if (!n) return null;
    pos += n;
    return buf.subarray(0, n);
  };
  const read = (buf) => {
    if (dec) {
      while (pos < end) {
        const c = readRaw(buf);
        if (!c) break;
        const out = dec.update(c);
        if (out.length) return out;
      }
      if (tagDone) return null;
      const tag = Buffer.alloc(16);
      readAt(tag, st.size - 16);
      dec.setAuthTag(tag);
      tagDone = true;
      const fin = dec.final();
      return fin.length ? fin : null;
    }
    if (h && h.type === TYPE_JSONL) {
      if (queue.length) {
        const n = Math.min(buf.length, queue.length);
        queue.copy(buf, 0, 0, n);
        const out = buf.subarray(0, n);
        queue = queue.subarray(n);
        return out;
      }
      while (pos + 8 <= st.size) {
        const rh = Buffer.alloc(8);
        readAt(rh, pos);
        const li = rh.readUInt32BE(0);
        const len = rh.readUInt32BE(4);
        if (pos + 8 + 12 + len + 16 > st.size) break;
        const nonce = Buffer.alloc(12);
        readAt(nonce, pos + 8);
        const ct = Buffer.alloc(len);
        readAt(ct, pos + 20);
        const tag = Buffer.alloc(16);
        readAt(tag, pos + 20 + len);
        const d = crypto.createDecipheriv('aes-256-gcm', k, nonce);
        d.setAAD(aadRecord(li));
        d.setAuthTag(tag);
        queue = Buffer.concat([d.update(ct), d.final()]);
        pos += 8 + 12 + len + 16;
        if (queue.length) {
          const n = Math.min(buf.length, queue.length);
          queue.copy(buf, 0, 0, n);
          const out = buf.subarray(0, n);
          queue = queue.subarray(n);
          return out;
        }
      }
      return null;
    }
    return readRaw(buf);
  };
  return {
    size: h ? h.logicalSize : st.size,
    read,
    close: () => { try { orig.closeSync(fd); } catch { /* noop */ } },
  };
}

/** 把逻辑读取器写成受管密文（普通文件用 TYPE_STREAM，JSONL 逐记录） */
function writeSealedFromReader(reader, dst, k, jsonl, mode) {
  const fd = orig.openSync(dst, 'w', mode == null ? 0o666 : mode);
  const buf = Buffer.allocUnsafe(1024 * 1024);
  try {
    if (jsonl) {
      let carry = Buffer.alloc(0);
      let logical = 0;
      let count = 0;
      const xie = (line) => {
        if (!line.length) return;
        orig.writeSync(fd, sealRecord(k, line, count));
        logical += line.length;
        count += 1;
      };
      orig.writeSync(fd, header(TYPE_JSONL, 0, 0));
      for (;;) {
        const c = reader.read(buf);
        if (!c) break;
        const zai = Buffer.concat([carry, c]);
        let start = 0;
        for (;;) {
          const i = zai.indexOf(10, start);
          if (i < 0) break;
          xie(zai.subarray(start, i + 1));
          start = i + 1;
        }
        carry = start < zai.length ? Buffer.from(zai.subarray(start)) : Buffer.alloc(0);
      }
      if (carry.length) xie(carry);
      orig.writeSync(fd, header(TYPE_JSONL, logical, count), 0, HEADER_LEN, 0);
      return;
    }
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', k, nonce);
    cipher.setAAD(aadFor(TYPE_STREAM, 0));
    orig.writeSync(fd, Buffer.concat([header(TYPE_STREAM, 0, 1), nonce]));
    let logical = 0;
    for (;;) {
      const c = reader.read(buf);
      if (!c) break;
      logical += c.length;
      const ct = cipher.update(c);
      if (ct.length) orig.writeSync(fd, ct);
    }
    const fin = cipher.final();
    if (fin.length) orig.writeSync(fd, fin);
    orig.writeSync(fd, cipher.getAuthTag());
    orig.writeSync(fd, header(TYPE_STREAM, logical, 1), 0, HEADER_LEN, 0);
  } finally {
    try { orig.closeSync(fd); } catch { /* noop */ }
  }
}

/** 把逻辑读取器写成明文（复制到加密边界外） */
function writePlainFromReader(reader, dst, mode) {
  const fd = orig.openSync(dst, 'w', mode == null ? 0o666 : mode);
  const buf = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const c = reader.read(buf);
      if (!c) break;
      let off = 0;
      while (off < c.length) {
        const n = orig.writeSync(fd, c, off, c.length - off);
        off += n;
      }
    }
  } finally {
    try { orig.closeSync(fd); } catch { /* noop */ }
  }
}

/** 同目录临时文件 + 原子替换；失败时目标保持原样 */
function replaceWithSealed(p, k, jsonl) {
  const tmp = `${p}.enc-${process.pid}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.tmp`;
  const mode = (() => { try { return orig.statSync(p).mode & 0o777; } catch { return 0o666; } })();
  try {
    const reader = openPlainReader(p);
    try { writeSealedFromReader(reader, tmp, k, jsonl, mode); } finally { reader.close(); }
    orig.renameSync(tmp, p);
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* noop */ }
    throw e;
  }
}

/** 流式写加密文件：先写临时文件，结束后回填头并原子替换；中途失败/销毁不留半截目标 */
function createSealedWriteStream(p, o, jsonl) {
  const tmp = `${p}.wstream-${process.pid}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.tmp`;
  const mode = o && o.mode != null ? o.mode : 0o666;
  const raw = orig.createWriteStream(tmp, { flags: 'w', mode });
  const k = keyNow();
  const nonce = jsonl ? null : crypto.randomBytes(12);
  const cipher = jsonl ? null : crypto.createCipheriv('aes-256-gcm', k, nonce);
  if (cipher) cipher.setAAD(aadFor(TYPE_STREAM, 0));
  let carry = Buffer.alloc(0);
  let logical = 0;
  let count = 0;
  let ended = false;
  let settled = false;
  let headerWritten = false;
  const writeHeader0 = () => {
    if (headerWritten) return;
    headerWritten = true;
    if (jsonl) raw.write(header(TYPE_JSONL, 0, 0));
    else raw.write(Buffer.concat([header(TYPE_STREAM, 0, 1), nonce]));
  };
  /** 销毁时先等 raw 真正关闭再删临时文件：Windows 上 fd 未关会 EPERM，静默失败就留垃圾 */
  const dispose = (cb) => {
    if (ended) { cb(); return; }
    ended = true;
    let done = false;
    let timer = null;
    const finish = () => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      const rm = (n) => {
        try {
          fs.rmSync(tmp, { force: true });
          cb();
        } catch {
          /** Windows 上 close 之后短时间内仍可能被安全软件/索引器占着，重试几次再放弃 */
          if (n > 0) setTimeout(() => rm(n - 1), 50);
          else cb();
        }
      };
      rm(8);
    };
    try {
      if (raw.destroyed) setTimeout(finish, 0);
      else {
        raw.once('close', finish);
        raw.destroy();
      }
      timer = setTimeout(finish, 1500);
    } catch { finish(); }
  };
  raw.on('error', (e) => { try { out.destroy(e); } catch { /* noop */ } });
  const out = new Writable({
    write(chunk, enc, cb) {
      try {
        if (!keyNow()) { cb(Object.assign(new Error('encrypted-data-locked'), { code: 'ENC_LOCKED' })); return; }
        writeHeader0();
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, enc);
        if (jsonl) {
          const zai = Buffer.concat([carry, buf]);
          let start = 0;
          const outs = [];
          for (;;) {
            const i = zai.indexOf(10, start);
            if (i < 0) break;
            const line = zai.subarray(start, i + 1);
            outs.push(sealRecord(k, line, count));
            logical += line.length;
            count += 1;
            start = i + 1;
          }
          carry = start < zai.length ? Buffer.from(zai.subarray(start)) : Buffer.alloc(0);
          if (outs.length) {
            const blob = Buffer.concat(outs);
            if (!raw.write(blob)) { raw.once('drain', cb); return; }
          }
          cb();
          return;
        } else {
          logical += buf.length;
          const ct = cipher.update(buf);
          if (ct.length) {
            if (!raw.write(ct)) { raw.once('drain', cb); return; }
          }
        }
        cb();
      } catch (e) { cb(e); }
    },
    final(cb) {
      const settle = (err) => {
        if (settled) return;
        settled = true;
        if (err) dispose(() => cb(err));
        else cb();
      };
      try {
        writeHeader0();
        if (jsonl && carry.length) {
          raw.write(sealRecord(k, carry, count));
          logical += carry.length;
          count += 1;
        }
        if (cipher) {
          const fin = cipher.final();
          if (fin.length) raw.write(fin);
          raw.write(cipher.getAuthTag());
        }
        carry = Buffer.alloc(0);
        if (raw.destroyed || raw.closed) {
          settle(Object.assign(new Error('write-stream-closed'), { code: 'ERR_STREAM_DESTROYED' }));
          return;
        }
        raw.once('close', () => {
          if (ended) return;
          try {
            const fd = orig.openSync(tmp, 'r+');
            try { orig.writeSync(fd, header(jsonl ? TYPE_JSONL : TYPE_STREAM, logical, jsonl ? count : 1), 0, HEADER_LEN, 0); }
            finally { try { orig.closeSync(fd); } catch { /* noop */ } }
            orig.renameSync(tmp, p);
            ended = true;
            settle();
          } catch (e) { settle(e); }
        });
        raw.end();
      } catch (e) { settle(e); }
    },
    destroy(err, cb) {
      if (settled) { cb(err); return; }
      settled = true;
      dispose(() => cb(err));
    },
  });
  return out;
}
function migrateOne(p, log) {
  if (!policyFile(p)) return false;
  const k = keyNow();
  if (!k) return false;
  try {
    const fd = orig.openSync(p, 'r');
    const st = fs.fstatSync(fd);
    const size = typeof st.size === 'bigint' ? Number(st.size) : st.size;
    const head = Buffer.alloc(Math.min(HEADER_LEN, size));
    try { fs.readSync(fd, head, 0, head.length, 0); } finally { try { orig.closeSync(fd); } catch { /* noop */ } }
    if (isEncryptedBuf(head)) return false;
  } catch { return false; }
  const tmp = `${p}.enc-${process.pid}-${Date.now()}.tmp`;
  try {
    if (/\.jsonl$/i.test(p)) sealJsonlToPath(p, tmp, k);
    else sealFileToPath(p, tmp, k);
    orig.renameSync(tmp, p);
    return true;
  } catch (e) {
    try { if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true }); } catch { /* noop */ }
    try { log && log(`enc migrate failed ${path.basename(p)}: ${String(e && e.message || e)}`); } catch { /* noop */ }
    return false;
  }
}
function migrateTree(root, log) {
  const base = path.resolve(root || ROOT);
  if (!base || !keyNow()) return 0;
  let n = 0;
  const walk = (dir) => {
    let ents;
    try { ents = orig.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of ents) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (EXEMPT_DIRS.has(ent.name)) continue;
        walk(p);
      } else if (ent.isFile() && policyFile(p)) {
        try { if (migrateOne(p, log)) n += 1; } catch { /* 单个文件失败不挡其它 */ }
      }
    }
  };
  walk(base);
  return n;
}
/** 代码目录（旧版 `userData/skills` 与新默认 `scan-dirs/{skills,plugins}`） */
function codeRootsOf(base) {
  return [path.join(base, 'scan-dirs', 'skills'), path.join(base, 'scan-dirs', 'plugins'), path.join(base, 'skills')];
}
/**
 * 把旧版本误加密的**代码文件**解密为明文（配置保持密文）。
 * 只在有 key 时执行；单个文件失败保留原密文并记日志，不覆盖、不删除。
 */
function migrateCodeToPlain(root, log) {
  const base = path.resolve(root || ROOT);
  if (!base || !keyNow()) return 0;
  let n = 0;
  const walk = (dir) => {
    let ents;
    try { ents = orig.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    try { fs.chmodSync(dir, 0o700); } catch { /* Windows ACL 不受 mode 约束，尽力即可 */ }
    for (const ent of ents) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) { walk(p); continue; }
      if (!ent.isFile() || !isPlainCodeFile(p)) continue;
      try { fs.chmodSync(p, 0o600); } catch { /* noop */ }
      if (!isEncryptedPath(p)) continue;
      const tmp = `${p}.plain-${process.pid}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.tmp`;
      try {
        const plain = openBuffer(orig.readFileSync(p));
        orig.writeFileSync(tmp, plain, { mode: 0o600 });
        try { fs.chmodSync(tmp, 0o600); } catch { /* noop */ }
        orig.renameSync(tmp, p);
        n += 1;
      } catch (e) {
        try { fs.rmSync(tmp, { force: true }); } catch { /* noop */ }
        try { log && log(`code-plain migrate failed ${path.basename(p)}: ${String(e && e.message || e)}`); } catch { /* noop */ }
      }
    }
  };
  for (const r of new Set(codeRootsOf(base))) {
    try { if (orig.statSync(r).isDirectory()) walk(r); } catch { /* 目录不存在 */ }
  }
  return n;
}
function statusInfo(root) {
  const base = path.resolve(root || ROOT);
  let encrypted = 0, plain = 0, bytes = 0, codePlain = 0;
  const walk = (dir) => {
    let ents;
    try { ents = orig.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of ents) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (EXEMPT_DIRS.has(ent.name)) continue;
        walk(p);
      } else if (ent.isFile() && isPlainCodeFile(p)) {
        codePlain += 1;
      } else if (ent.isFile() && policyFile(p)) {
        try {
          const st = orig.statSync(p);
          bytes += st.size;
          const head = Buffer.alloc(Math.min(HEADER_LEN, st.size));
          const fd = orig.openSync(p, 'r');
          try { fs.readSync(fd, head, 0, head.length, 0); } finally { orig.closeSync(fd); }
          if (isEncryptedBuf(head)) encrypted += 1; else plain += 1;
        } catch { /* noop */ }
      }
    }
  };
  walk(base);
  return { encrypted, plain, codePlain, bytes, enabled: !!keyNow() };
}

/** 加密文件的分块读取：DataVault 封存/导出不再把大文件整块读进内存 */
function createDecryptReadable(p) {
  return Readable.from((async function* () {
    const fh = await fsp.open(p, 'r');
    try {
      const st = await fh.stat();
      const head = Buffer.alloc(Math.min(HEADER_LEN, st.size));
      await fh.read(head, 0, head.length, 0);
      const h = readHeader(head);
      if (!h) throw new Error('bad-encrypted-file');
      const k = keyNow();
      if (!k) throw Object.assign(new Error('encrypted-data-locked'), { code: 'ENC_LOCKED' });
      if (h.type === TYPE_FILE || h.type === TYPE_STREAM) {
        const nonce = Buffer.alloc(12);
        await fh.read(nonce, 0, 12, HEADER_LEN);
        const d = crypto.createDecipheriv('aes-256-gcm', k, nonce);
        d.setAAD(aadFor(h.type, h.logicalSize));
        const end = st.size - 16;
        const buf = Buffer.allocUnsafe(1024 * 1024);
        let pos = HEADER_LEN + 12;
        while (pos < end) {
          const len = Math.min(buf.length, end - pos);
          const r = await fh.read(buf, 0, len, pos);
          if (!r.bytesRead) break;
          const out = d.update(buf.subarray(0, r.bytesRead));
          if (out.length) yield out;
          pos += r.bytesRead;
        }
        const tag = Buffer.alloc(16);
        await fh.read(tag, 0, 16, st.size - 16);
        d.setAuthTag(tag);
        const fin = d.final();
        if (fin.length) yield fin;
        return;
      }
      let pos = HEADER_LEN;
      while (pos + 8 <= st.size) {
        const rh = Buffer.alloc(8);
        await fh.read(rh, 0, 8, pos);
        const index = rh.readUInt32BE(0);
        const len = rh.readUInt32BE(4);
        if (pos + 8 + 12 + len + 16 > st.size) break;
        const nonce = Buffer.alloc(12);
        await fh.read(nonce, 0, 12, pos + 8);
        const ct = Buffer.alloc(len);
        await fh.read(ct, 0, len, pos + 20);
        const tag = Buffer.alloc(16);
        await fh.read(tag, 0, 16, pos + 20 + len);
        const d = crypto.createDecipheriv('aes-256-gcm', k, nonce);
        d.setAAD(aadRecord(index));
        d.setAuthTag(tag);
        const out = d.update(ct);
        if (out.length) yield out;
        const fin = d.final();
        if (fin.length) yield fin;
        pos += 8 + 12 + len + 16;
      }
    } finally {
      try { await fh.close(); } catch { /* noop */ }
    }
  })());
}

/**
 * 加密文件的范围读取：解密是流式的，只跳过 start 之前的块，不把整文件读进内存。
 * end 为闭区间（与 Node fs.createReadStream 一致）。
 */
function createDecryptRangeReadable(p, start, end, encoding) {
  const s = Math.max(0, Number(start) || 0);
  const e = end === undefined || end === null ? null : Math.max(s, Number(end));
  const rd = Readable.from((async function* () {
    const src = createDecryptReadable(p);
    let pos = 0;
    for await (const c of src) {
      const cStart = pos;
      const cEnd = pos + c.length - 1;
      pos += c.length;
      if (cEnd < s) continue;
      if (e !== null && cStart > e) break;
      const a = Math.max(0, s - cStart);
      const b = e === null ? c.length - 1 : Math.min(c.length - 1, e - cStart);
      if (b >= a) yield c.subarray(a, b + 1);
      if (e !== null && cEnd >= e) break;
    }
  })());
  if (encoding) rd.setEncoding(String(encoding));
  return rd;
}

function install(opts) {
  if (INSTALLED) return;
  INSTALLED = true;
  ROOT = path.resolve(String(opts && opts.root || ''));
  GET_KEY = opts && typeof opts.getKey === 'function' ? opts.getKey : null;
  if (opts && opts.key) KEY = Buffer.from(opts.key);
  const fsAny = fs;

  fsAny.readFileSync = function (p, o) {
    /** 代码文件按明文策略放行，但升级前的旧密文仍要能读（迁移窗口） */
    if (typeof p === 'string' && (policyFile(p) || isPlainCodeFile(p))) {
      try {
        const raw = orig.readFileSync(p);
        const enc = typeof o === 'string' ? o : (o && o.encoding);
        if (!isEncryptedBuf(raw)) return enc ? raw.toString(enc) : raw;
        const plain = openBuffer(raw);
        return enc ? plain.toString(enc) : plain;
      } catch (e) {
        if (e && e.code === 'ENC_LOCKED') throw e;
        throw e;
      }
    }
    return orig.readFileSync(p, o);
  };
  fsAny.writeFileSync = function (p, data, o) {
    if (typeof p === 'string' && isPlainCodeFile(p)) {
      const opt = o && typeof o === 'object' ? { ...o, mode: 0o600 } : o;
      return orig.writeFileSync(p, data, opt);
    }
    if (typeof p === 'string' && policyFile(p) && writeBlocked()) return undefined;
    if (typeof p === 'string' && policyFile(p)) {
      const flag = o && typeof o === 'object' ? String(o.flag || '') : '';
      if (flag.includes('a')) return appendLogical(p, data);
      const k = keyNow();
      if (k) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data == null ? '' : data), typeof data === 'string' ? 'utf8' : undefined);
        const sealed = /\.jsonl$/i.test(p) ? sealJsonlBuffer(buf) : sealFileBuffer(buf);
        const opt = (o && typeof o === 'object') ? { ...o } : {};
        delete opt.encoding;
        return orig.writeFileSync(p, sealed, opt);
      }
    }
    return orig.writeFileSync(p, data, o);
  };
  fsAny.appendFileSync = function (p, data, o) {
    if (typeof p === 'string' && isPlainCodeFile(p)) {
      if (isEncryptedPath(p)) return appendLogical(p, data);
      const opt = o && typeof o === 'object' ? { ...o, mode: 0o600 } : o;
      return orig.appendFileSync(p, data, opt);
    }
    if (typeof p === 'string' && policyFile(p) && writeBlocked()) return undefined;
    if (typeof p === 'string' && policyFile(p)) return appendLogical(p, data);
    return orig.appendFileSync(p, data, o);
  };
  fsAny.copyFileSync = function (src, dst, mode) {
    if (typeof dst === 'string' && policyFile(dst) && writeBlocked()) return undefined;
    const srcStr = typeof src === 'string';
    const dstStr = typeof dst === 'string';
    /** 第三个参数是 COPYFILE_* 位标志（0..7），不是文件权限；把 cpSync 传来的 0o644 原样透传会抛 ERR_OUT_OF_RANGE */
    const flags = typeof mode === 'number' && mode >= 0 && mode <= 7 ? mode : 0;
    if (!srcStr || !dstStr) return orig.copyFileSync(src, dst, flags);
    /** 代码目录：目标按明文落盘，源若还是旧密文则先解密（迁移期不把密文复制成“明文代码”） */
    if (isPlainCodeFile(dst)) {
      const tmpCode = `${dst}.plain-${process.pid}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.tmp`;
      try {
        if (isEncryptedPath(src)) {
          const reader = openPlainReader(src, true);
          try { writePlainFromReader(reader, tmpCode, 0o600); } finally { reader.close(); }
          orig.renameSync(tmpCode, dst);
        } else {
          orig.copyFileSync(src, dst, flags);
        }
        try { fs.chmodSync(dst, 0o600); } catch { /* noop */ }
        return undefined;
      } catch (e) {
        try { fs.rmSync(tmpCode, { force: true }); } catch { /* noop */ }
        throw e;
      }
    }
    const srcPolicy = policyFile(src);
    const dstPolicy = policyFile(dst);
    if (!srcPolicy && !dstPolicy) return orig.copyFileSync(src, dst, flags);
    const dstMode = mode == null ? (() => { try { return orig.statSync(src).mode & 0o777; } catch { return 0o666; } })() : mode;
    const tmp = `${dst}.copy-${process.pid}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.tmp`;
    const cleanup = () => { try { fs.rmSync(tmp, { force: true }); } catch { /* noop */ } };
    try {
      if (!dstPolicy) {
        const reader = openPlainReader(src, true);
        try { writePlainFromReader(reader, tmp, dstMode); } finally { reader.close(); }
        orig.renameSync(tmp, dst);
        return undefined;
      }
      const k = keyNow();
      if (!k) return orig.copyFileSync(src, dst, flags);
      const reader = openPlainReader(src, srcPolicy);
      try { writeSealedFromReader(reader, tmp, k, /\.jsonl$/i.test(dst), dstMode); } finally { reader.close(); }
      orig.renameSync(tmp, dst);
      return undefined;
    } catch (e) {
      cleanup();
      throw e;
    }
  };
  /**
   * 目录复制：技能导入 / 插件播种会用 cpSync 往 userData 里搬目录。
   * 若目标在受管范围（或源在受管范围），逐文件走受管 copyFileSync，保证密文/解密边界不被绕过。
   */
  fsAny.cpSync = function (src, dst, o) {
    const opt = o && typeof o === 'object' ? o : {};
    if (typeof src !== 'string' || typeof dst !== 'string' || !(policyPath(src) || policyPath(dst))) {
      return orig.cpSync(src, dst, o);
    }
    if (typeof opt.filter === 'function' && !opt.filter(src, dst)) return undefined;
    const st = opt.dereference ? orig.statSync(src) : orig.lstatSync(src);
    if (st.isDirectory()) {
      if (!opt.recursive) return orig.cpSync(src, dst, o);
      const exists = fs.existsSync(dst);
      if (exists && opt.errorOnExist && opt.force === false) {
        throw Object.assign(new Error('EEXIST: file already exists, cpSync ' + dst), { code: 'EEXIST' });
      }
      if (!exists) fs.mkdirSync(dst, { recursive: true, mode: isCodePath(dst) ? 0o700 : (st.mode & 0o777) });
      for (const name of orig.readdirSync(src)) {
        fsAny.cpSync(path.join(src, name), path.join(dst, name), o);
      }
      return undefined;
    }
    if (st.isFile()) {
      if (!opt.force && fs.existsSync(dst)) {
        throw Object.assign(new Error('EEXIST: file already exists, cpSync ' + dst), { code: 'EEXIST' });
      }
      return fsAny.copyFileSync(src, dst, st.mode & 0o777);
    }
    /** 符号链接等特殊条目：应用没有用 cpSync 搬它们的场景，交给原生实现 */
    return orig.cpSync(src, dst, o);
  };
  fsAny.renameSync = function (src, dst) {
    if (typeof dst === 'string' && policyFile(dst) && writeBlocked()) return undefined;
    const r = orig.renameSync(src, dst);
    if (typeof dst === 'string' && policyFile(dst) && keyNow()) {
      try {
        const fd = orig.openSync(dst, 'r');
        const st = fs.fstatSync(fd);
        const head = Buffer.alloc(Math.min(HEADER_LEN, st.size));
        try { if (head.length) fs.readSync(fd, head, 0, head.length, 0); } finally { try { orig.closeSync(fd); } catch { /* noop */ } }
        if (!isEncryptedBuf(head)) replaceWithSealed(dst, keyNow(), /\.jsonl$/i.test(dst));
      } catch { /* 单个文件封装失败不挡 rename 本身 */ }
    }
    return r;
  };
  fsAny.statSync = function (p, o) {
    const st = orig.statSync(p, o);
    if (typeof p !== 'string' || !(policyFile(p) || isPlainCodeFile(p))) return st;
    try {
      const sizeNum = typeof st.size === 'bigint' ? Number(st.size) : st.size;
      const head = Buffer.alloc(Math.min(HEADER_LEN, sizeNum));
      const fd = orig.openSync(p, 'r');
      try { fs.readSync(fd, head, 0, head.length, 0); } finally { try { orig.closeSync(fd); } catch { /* noop */ } }
      if (!isEncryptedBuf(head)) return st;
      const h = readHeader(head);
      if (!h) return st;
      const big = typeof st.size === 'bigint';
      return new Proxy(st, {
        get(t, prop) {
          if (prop === 'size') return big ? BigInt(h.logicalSize) : h.logicalSize;
          const v = Reflect.get(t, prop, t);
          return typeof v === 'function' ? v.bind(t) : v;
        },
      });
    } catch { return st; }
  };
  fsAny.createReadStream = function (p, o) {
    if (typeof p === 'string' && (policyFile(p) || isPlainCodeFile(p))) {
      try {
        const fd = orig.openSync(p, 'r');
        const head = Buffer.alloc(Math.min(HEADER_LEN, fs.fstatSync(fd).size));
        try { fs.readSync(fd, head, 0, head.length, 0); } finally { try { orig.closeSync(fd); } catch { /* noop */ } }
        if (isEncryptedBuf(head)) {
          const opt = o || {};
          /** 带 start/end 的调用也走流式解密（跳过前缀块），不再整文件读入内存 */
          if (opt.start !== undefined || opt.end !== undefined) return createDecryptRangeReadable(p, opt.start, opt.end, opt.encoding);
          const rd = createDecryptReadable(p);
          if (opt.encoding) rd.setEncoding(String(opt.encoding));
          return rd;
        }
      } catch { /* 退回原始流 */ }
    }
    return orig.createReadStream(p, o);
  };
  fsAny.createWriteStream = function (p, o) {
    if (typeof p === 'string' && policyFile(p) && writeBlocked()) {
      return new Writable({ write(_c, _e, cb) { cb(); }, final(cb) { cb(); } });
    }
    if (typeof p === 'string' && policyFile(p) && keyNow()) {
      const opt = o && typeof o === 'object' ? o : {};
      if (String(opt.flags || '').includes('a')) {
        return new Writable({
          write(chunk, enc, cb) {
            try {
              if (!keyNow()) { cb(Object.assign(new Error('encrypted-data-locked'), { code: 'ENC_LOCKED' })); return; }
              appendLogical(p, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, enc));
              cb();
            } catch (e) { cb(e); }
          },
        });
      }
      return createSealedWriteStream(p, opt, /\.jsonl$/i.test(p));
    }
    if (typeof p === 'string' && isPlainCodeFile(p)) {
      const opt = o && typeof o === 'object' ? { ...o, mode: 0o600 } : o;
      return orig.createWriteStream(p, opt);
    }
    return orig.createWriteStream(p, o);
  };
  /**
   * promises 接口用**真异步 I/O**（fsp），密码学运算仍在当前线程。
   * 旧实现把 async 函数名挂在同步实现上，等于宣称“不阻塞”却没有证据；这里不再这样。
   * 追加在正常 JSONL 情况下也是异步文件句柄；旧格式/迁移路径才退回整文件重封。
   */
  if (fs.promises && !fs.promises.__warmyEnc) {
    fs.promises.__warmyEnc = true;
    fs.promises.readFile = async (p, o) => {
      if (typeof p === 'string' && (policyFile(p) || isPlainCodeFile(p))) {
        const raw = await origFsp.readFile(p);
        const enc = typeof o === 'string' ? o : (o && o.encoding);
        if (!isEncryptedBuf(raw)) return enc ? raw.toString(enc) : raw;
        const plain = openBuffer(raw);
        return enc ? plain.toString(enc) : plain;
      }
      return origFsp.readFile(p, o);
    };
    fs.promises.writeFile = async (p, data, o) => {
      if (typeof p === 'string' && isPlainCodeFile(p)) {
        const opt = o && typeof o === 'object' ? { ...o, mode: 0o600 } : o;
        return origFsp.writeFile(p, data, opt);
      }
      if (typeof p === 'string' && policyFile(p)) {
        if (writeBlocked()) return undefined;
        const k = keyNow();
        if (k) {
          const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data == null ? '' : data), typeof data === 'string' ? 'utf8' : undefined);
          const sealed = /\.jsonl$/i.test(p) ? sealJsonlBuffer(buf) : sealFileBuffer(buf);
          const opt = (o && typeof o === 'object') ? { ...o } : {};
          delete opt.encoding;
          return origFsp.writeFile(p, sealed, opt);
        }
      }
      return origFsp.writeFile(p, data, o);
    };
    fs.promises.appendFile = async (p, data, o) => {
      if (typeof p === 'string' && isPlainCodeFile(p) && !isEncryptedPath(p)) {
        const opt = o && typeof o === 'object' ? { ...o, mode: 0o600 } : o;
        return origFsp.appendFile(p, data, opt);
      }
      if (typeof p === 'string' && (policyFile(p) || isPlainCodeFile(p))) {
        if (writeBlocked()) return undefined;
        return appendLogicalAsync(p, data);
      }
      return origFsp.appendFile(p, data, o);
    };
  }
}

function setWriteGuard(fn) { WRITE_GUARD = typeof fn === 'function' ? fn : null; }
function setKey(key) {
  try { KEY = key && key.length ? Buffer.from(key) : null; } catch { KEY = null; }
}
function hasKey() { return !!keyNow(); }
function isEncryptedPath(p) {
  try {
    const head = Buffer.alloc(HEADER_LEN);
    const fd = orig.openSync(p, 'r');
    try { fs.readSync(fd, head, 0, head.length, 0); } finally { orig.closeSync(fd); }
    return isEncryptedBuf(head);
  } catch { return false; }
}

// 子进程预加载：内存服务等 fork 出来的 Node 进程用同一套格式
if (!INSTALLED && process.env.WARMY_ENC_ROOT) {
  try {
    if (process.env.WARMY_DATA_KEY_HEX) setKey(Buffer.from(String(process.env.WARMY_DATA_KEY_HEX), 'hex'));
    install({ root: process.env.WARMY_ENC_ROOT });
  } catch { /* 预加载失败也不能挡住子进程启动 */ }
}

// 逻辑记录/范围读取：记忆子进程通过同一份 fs 对象调用（原生 fd 只看到密文，不能直接用）
try {
  Object.defineProperty(fs, '__warmyReadLogicalRecordsSync', { value: readLogicalRecordsSync, configurable: true });
  Object.defineProperty(fs, '__warmyReadLogicalRangeSync', { value: readLogicalRangeSync, configurable: true });
  Object.defineProperty(fs, '__warmyIsEncryptedPath', { value: isEncryptedPath, configurable: true });
} catch { /* 只读 fs 环境忽略 */ }

module.exports = { install, setKey, setWriteGuard, hasKey, migrateTree, migrateCodeToPlain, statusInfo, policyFile, isPlainCodeFile, isCodePath, isEncryptedPath, openBuffer, sealJsonlBuffer, sealFileBuffer, readLogical, readLogicalRecordsSync, readLogicalRangeSync, MAGIC, TYPE_FILE, TYPE_JSONL, TYPE_STREAM };
