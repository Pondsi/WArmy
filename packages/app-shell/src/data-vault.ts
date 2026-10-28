/**
 * data-vault —— 全量用户数据仓库（第 104 轮 项 10）。
 *
 * 模型（如实说明）：
 *   · 应用运行时是「已解锁」状态：数据以普通文件存在于 userData，供现有模块与
 *     记忆子进程读写（不改各仓的 I/O；它们是同一台机器上以当前用户身份运行的程序）。
 *   · 登录成功后把 vault.bin 解包到 userData；退出/注销时重新打包、加密，并删掉明文。
 *     未登录时只有 vault.bin（AES-256-GCM），没有账号主密钥无法查看。
 *   · 导出按钮生成 `.wvault`：整包用用户口令（scrypt）再加密一次；导入用同一口令解开
 *     后写回 userData，并重启应用（账号/身份也在包内，属于完整恢复）。
 *
 * 密钥：
 *   · 静态仓库密钥 = HKDF-SHA256(账号主密钥, "warmy-data-vault-v1")；
 *   · 导出包密钥 = scrypt(用户口令, 每包随机 salt)。
 *   · 登录后主密钥只在 AuthService 内存中；仓库只保留派生出的 32 字节子密钥，
 *     注销/退出时一并清零。
 *
 * 格式（二进制，非 `.nm` JSON 信封）：
 *   magic "WYV1" | version u8 | mode u8 (0=主密钥,1=口令) | flags u8
 *   salt[16] | nonce[12] | AES-256-GCM( gzip( 自定义文件归档 ) ) | tag[16]
 *
 * 归档是「路径长度 + 路径 + 大小 + mtime + 内容」的流式条目，避免把整个数据库读进内存。
 * 解包时拒绝绝对路径、`..`、盘符与符号链接，绝不把条目名当路径直接使用。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { once } from 'node:events';
import { pipeline } from 'node:stream/promises';
import { krootFingerprint } from './auth-core.mjs';

export interface VaultProtector {
  available(): boolean;
  protect(value: string): string;
  unprotect(value: string): string;
}

export interface VaultOptions {
  userData: string;
  protector: VaultProtector;
  log?: (line: string) => void;
}

export interface VaultResult {
  ok: boolean;
  error?: string;
  files?: number;
  bytes?: number;
  skipped?: string[];
}

const MAGIC = Buffer.from('WYV1', 'utf8');
const VERSION = 1;
const MODE_MASTER = 0;
const MODE_PASSWORD = 1;
const HEADER_LEN = 4 + 1 + 1 + 1 + 16 + 12;
const TAG_LEN = 16;
const ARCHIVE_MAGIC = Buffer.from('WYAR1', 'utf8');
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

/** 应用缓存/运行时目录不进入仓库：它们不是用户数据，且可能被进程占用。 */
const SKIP_NAMES = new Set([
  'Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache',
  'Session Storage', 'Local Storage', 'Shared Dictionary', 'blob_storage',
  'Network', 'DIPS', 'DIPS-wal', 'SharedStorage', 'SharedStorage-wal',
  'memory-runtime', 'updates', 'node_modules', '.git', 'logs', 'external-edits',
  'vault.bin', 'vault.bin.tmp', 'vault.session', 'vault.session.tmp', 'vault.clean',
  'warmy-boot.log', 'DevToolsActivePort', 'Preferences', 'Local State',
  'lockfile', 'SingletonLock', 'SingletonCookie', 'SingletonSocket',
  /** 逻辑导出载荷是临时导入载荷，不进入封存/导出；`logical-import` 是用户数据，必须正常封存 */
  '__logical__',
]);
/** 只用于「静态封存」的排除：认证/身份/密钥本身已有各自保护，且登录前必须可读。 */
const SEAL_EXCLUDE_DIRS = new Set(['auth', 'identity', 'secure']);

/**
 * 导出范围（第 107 轮）：路径前缀 → 类别。`include` 为空/缺省 = 全部。
 * 账号与凭据单独一类：不勾选时导出包不能恢复登录，但可当纯数据备份。
 */
const EXPORT_CATEGORIES: Record<string, string[]> = {
  chat: ['memory/', 'workspace/', 'checkpoints/', 'archive/', 'chat-meta.json', 'plans.json', 'ui-queues.json', 'router-queues.json', 'board/', 'logical-import/'],
  knowledge: ['knowledge/', 'memory/fast-memory.jsonl'],
  contacts: ['identity/', 'groups.json', 'nodes.json', 'net/', 'bus/'],
  settings: ['settings.json', 'appearance.json', 'dao.md', 'shu.md', 'instances/', 'scheduled-tasks.json', 'window-state.json', 'fonts-cache.json', 'token-calibration.json', 'token-observations.jsonl', 'eta.json', 'eta-live.json', 'xin-tiao.json'],
  account: ['auth/', 'identity/', 'secure/', 'profile.json'],
  logs: ['audit/'],
};

function shiWenJian(p: string): boolean {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function anQuanXiangDui(p: string): boolean {
  const s = String(p || '').replace(/\\/g, '/');
  if (!s || s.startsWith('/') || /^[a-zA-Z]:/.test(s)) return false;
  const bu = s.split('/').filter(Boolean);
  return bu.length > 0 && !bu.includes('..');
}

interface GuiDangTiao {
  rel: string;
  size: number;
  mtime: number;
  /** 覆盖来源文件（选择性导出的逻辑文件放在临时目录，不复制原库） */
  abs?: string;
}

/**
 * **选择性导出范围（第 109 轮）**：
 *   · chatIds —— 只导出这些会话（聊天元数据/工作区/归档/检索记录）；
 *   · kbLayers —— 只导出这些知识库层（session/internal/private）；
 *   · from/to —— 只导出这个时间范围内的聊天记录、知识事件与日志。
 * 空 = 不限制。范围生效时，原始 memory/ 与 knowledge/ 不再整包复制，改由逻辑文件承载；
 * 否则“选了某一个对话”仍会把全部对话的数据库带出去，等于没选。
 */
export interface DaoChuFanWei {
  chatIds?: string[];
  kbLayers?: string[];
  from?: number;
  to?: number;
}

function zaiShiJianFanWei(ts: number, scope?: DaoChuFanWei): boolean {
  if (!scope) return true;
  const t = Number(ts) || 0;
  if (Number(scope.from) > 0 && t > 0 && t < Number(scope.from)) return false;
  if (Number(scope.to) > 0 && t > 0 && t > Number(scope.to)) return false;
  return true;
}

function lieWenJian(root: string, includeProtected: boolean, include?: string[], scope?: DaoChuFanWei): { files: GuiDangTiao[]; skipped: string[] } {
  const files: GuiDangTiao[] = [];
  const skipped: string[] = [];
  const fanWei = Array.isArray(include) && include.length
    ? include.flatMap((c) => EXPORT_CATEGORIES[String(c)] || [])
    : null;
  const zaiFanWei = (rel: string) => !fanWei || fanWei.some((pre) => rel === pre || rel.startsWith(pre));
  const categoryOf = (rel: string): string => {
    for (const [cat, pres] of Object.entries(EXPORT_CATEGORIES)) {
      if (pres.some((pre) => rel === pre || rel.startsWith(pre))) return cat;
    }
    return '';
  };
  const chatSel = new Set((Array.isArray(scope?.chatIds) ? scope!.chatIds : []).map(String).filter(Boolean));
  const kbSel = new Set((Array.isArray(scope?.kbLayers) ? scope!.kbLayers : []).map(String).filter(Boolean));
  const youShiJian = Number(scope?.from) > 0 || Number(scope?.to) > 0;
  /** 只要给了任一细粒度条件，原始整库就不再进包，改由逻辑文件承载 */
  const chatScoped = !!scope && (chatSel.size > 0 || youShiJian);
  const kbScoped = !!scope && (kbSel.size > 0 || youShiJian);
  /**
   * 范围生效时的“原始文件”排除表：
   * 这些文件要么整库存了未选中的会话/知识，要么会与逻辑文件重复。
   * 逻辑文件由 `writeLogicalOverlay()` 按选择重新生成。
   */
  const yuanShiPaiChu = (rel: string): boolean => {
    const cat = categoryOf(rel);
    if (chatScoped && cat === 'chat') {
      if (rel === 'chat-meta.json' || rel === 'plans.json' || rel === 'ui-queues.json' || rel === 'router-queues.json') return true;
      if (rel.startsWith('memory/') || rel.startsWith('archive/') || rel.startsWith('board/') || rel.startsWith('logical-import/')) return true;
      if (rel.startsWith('workspace/') && chatSel.size) {
        const sid = rel.split('/')[1] || '';
        return !chatSel.has(sid);
      }
      if (rel.startsWith('checkpoints/') && chatSel.size) {
        return ![...chatSel].some((id) => id && rel.includes(id));
      }
    }
    if (kbScoped && cat === 'knowledge') {
      // 原始知识库文件整库复制会带出未选层；逻辑文件按层生成
      if (rel.startsWith('knowledge/')) return true;
      if (rel === 'memory/fast-memory.jsonl') return true;
    }
    return false;
  };
  const walk = (dir: string) => {
    let ents: fs.Dirent[] = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of ents) {
      const p = path.join(dir, ent.name);
      const rel = path.relative(root, p).replace(/\\/g, '/');
      if (SKIP_NAMES.has(ent.name)) { skipped.push(rel); continue; }
      if (!includeProtected && rel.split('/').length === 1 && SEAL_EXCLUDE_DIRS.has(ent.name)) {
        skipped.push(rel);
        continue;
      }
      let st: fs.Stats;
      try { st = fs.lstatSync(p); } catch { continue; }
      if (st.isSymbolicLink()) { skipped.push(rel); continue; }
      if (st.isDirectory()) { walk(p); continue; }
      if (!st.isFile()) { skipped.push(rel); continue; }
      if (!zaiFanWei(rel)) { skipped.push(rel); continue; }
      if (yuanShiPaiChu(rel)) { skipped.push(rel); continue; }
      files.push({ rel, size: st.size, mtime: Math.round(st.mtimeMs) });
    }
  };
  walk(root);
  return { files, skipped };
}

/**
 * 流式打包 + 压缩 + AEAD，直接写目标文件；**不再生成明文 tar 临时文件**。
 * 返回写入的文件内容字节数（不含头和压缩开销）。
 */
async function jiaMiGuiDang(
  root: string,
  files: GuiDangTiao[],
  outFile: string,
  key: Buffer,
  mode: number,
  salt: Buffer,
): Promise<number> {
  const nonce = crypto.randomBytes(12);
  const head = Buffer.alloc(HEADER_LEN);
  MAGIC.copy(head, 0);
  head[4] = VERSION;
  head[5] = mode;
  head[6] = 0;
  salt.copy(head, 7, 0, 16);
  nonce.copy(head, 23, 0, 12);
  const gzip = zlib.createGzip({ level: 6 });
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const ws = fs.createWriteStream(outFile);
  const cipherEnd = new Promise<void>((resolve, reject) => {
    cipher.once('end', resolve);
    cipher.once('error', reject);
  });
  const wsDone = new Promise<void>((resolve, reject) => {
    ws.once('finish', resolve);
    ws.once('error', reject);
  });
  void cipherEnd.catch(() => {});
  void wsDone.catch(() => {});
  gzip.once('error', (e) => cipher.destroy(e));
  cipher.once('error', (e) => ws.destroy(e));
  ws.write(head);
  gzip.pipe(cipher).pipe(ws, { end: false });
  const xie = async (buf: Buffer) => { if (!gzip.write(buf)) await once(gzip, 'drain'); };
  let bytes = 0;
  try {
    await xie(ARCHIVE_MAGIC);
    for (const f of files) {
      const name = Buffer.from(f.rel, 'utf8');
      const meta = Buffer.allocUnsafe(4 + 8 + 8);
      meta.writeUInt32BE(name.length, 0);
      meta.writeBigUInt64BE(BigInt(f.size), 4);
      meta.writeBigInt64BE(BigInt(f.mtime), 12);
      await xie(meta);
      await xie(name);
      for await (const chunk of fs.createReadStream(f.abs || path.join(root, f.rel))) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buf.length;
        await xie(buf);
      }
    }
    await xie(Buffer.alloc(4));
    gzip.end();
    await cipherEnd;
    ws.end(cipher.getAuthTag());
    await wsDone;
    return bytes;
  } catch (e) {
    try { gzip.destroy(); } catch { /* noop */ }
    try { cipher.destroy(); } catch { /* noop */ }
    try { ws.destroy(); } catch { /* noop */ }
    throw e;
  }
}

function duGuiDang(archive: string, destRoot: string): { files: number; bytes: number } {
  const fd = fs.openSync(archive, 'r');
  try {
    const head = Buffer.alloc(5);
    fs.readSync(fd, head, 0, 5, 0);
    if (!head.equals(ARCHIVE_MAGIC)) throw new Error('bad-archive（仓库归档标识不对）');
    let pos = 5;
    let files = 0;
    let bytes = 0;
    const buf = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      const lenBuf = Buffer.alloc(4);
      const n0 = fs.readSync(fd, lenBuf, 0, 4, pos);
      if (n0 === 0) throw new Error('bad-archive（缺少结束标记）');
      pos += 4;
      const nameLen = lenBuf.readUInt32BE(0);
      if (nameLen === 0) break;
      if (nameLen > 4096) throw new Error('bad-archive（路径过长）');
      const meta = Buffer.alloc(16);
      fs.readSync(fd, meta, 0, 16, pos); pos += 16;
      const size = Number(meta.readBigUInt64BE(0));
      const mtime = Number(meta.readBigInt64BE(8));
      const nameBuf = Buffer.alloc(nameLen);
      fs.readSync(fd, nameBuf, 0, nameLen, pos); pos += nameLen;
      const rel = nameBuf.toString('utf8');
      if (!anQuanXiangDui(rel)) throw new Error(`zip-slip（仓库条目路径不安全：${rel.slice(0, 80)}）`);
      if (size > 8 * 1024 * 1024 * 1024) throw new Error('bad-archive（单文件过大）');
      const dest = path.join(destRoot, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const out = fs.openSync(dest, 'w');
      let left = size;
      try {
        while (left > 0) {
          const n = fs.readSync(fd, buf, 0, Math.min(buf.length, left), pos);
          if (n <= 0) throw new Error(`bad-archive（文件内容截断：${rel}）`);
          fs.writeSync(out, buf, 0, n);
          pos += n;
          left -= n;
          bytes += n;
        }
      } finally {
        try { fs.closeSync(out); } catch { /* noop */ }
      }
      try { fs.utimesSync(dest, new Date(), new Date(mtime)); } catch { /* noop */ }
      files += 1;
    }
    return { files, bytes };
  } finally {
    try { fs.closeSync(fd); } catch { /* noop */ }
  }
}

/** 明文导出（第 107 轮「导出是否加密」的关闭选项）：gzip 归档，不带 vault 头/密钥。 */
async function xieGuiDangPingWen(root: string, files: GuiDangTiao[], outFile: string): Promise<number> {
  const gzip = zlib.createGzip({ level: 6 });
  const ws = fs.createWriteStream(outFile);
  const wsDone = new Promise<void>((resolve, reject) => {
    ws.once('finish', resolve);
    ws.once('error', reject);
  });
  void wsDone.catch(() => {});
  gzip.once('error', (e) => ws.destroy(e));
  gzip.pipe(ws);
  const xie = async (buf: Buffer) => { if (!gzip.write(buf)) await once(gzip, 'drain'); };
  let bytes = 0;
  try {
    await xie(ARCHIVE_MAGIC);
    for (const f of files) {
      const name = Buffer.from(f.rel, 'utf8');
      const meta = Buffer.allocUnsafe(4 + 8 + 8);
      meta.writeUInt32BE(name.length, 0);
      meta.writeBigUInt64BE(BigInt(f.size), 4);
      meta.writeBigInt64BE(BigInt(f.mtime), 12);
      await xie(meta);
      await xie(name);
      for await (const chunk of fs.createReadStream(f.abs || path.join(root, f.rel))) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buf.length;
        await xie(buf);
      }
    }
    await xie(Buffer.alloc(4));
    gzip.end();
    await wsDone;
    return bytes;
  } catch (e) {
    try { gzip.destroy(); } catch { /* noop */ }
    try { ws.destroy(); } catch { /* noop */ }
    throw e;
  }
}

// ── 第 111 轮：`.nm` v2 全量数据包 ──────────────────────────────────────
const NM_MAGIC = Buffer.from('WYNM', 'utf8');
const NM_VERSION = 2;
const NM_MODE_PLAIN = 0;
const NM_MODE_KROOT = 1;
const NM_FIXED = 12;

export interface NmHeader {
  format: 'warmy-nm-data';
  v: 2;
  mode: 'plain' | 'kroot';
  createdAt: number;
  app: string;
  appVersion: string;
  categories: string[];
  files: number;
  bytes: number;
  krootFp?: string;
  kdf?: { salt: string; nonce: string; wrap: string };
  archiveNonce?: string;
}

export interface NmInspect {
  ok: boolean;
  mode?: 'plain' | 'kroot';
  createdAt?: number;
  categories?: string[];
  files?: number;
  bytes?: number;
  krootFp?: string;
  header?: NmHeader;
  error?: string;
}

function nmAad(h: NmHeader): Buffer {
  return Buffer.from('warmy-nm-data-aad-v2|' + JSON.stringify({
    format: h.format,
    v: h.v,
    mode: h.mode,
    createdAt: h.createdAt,
    app: h.app || '',
    appVersion: h.appVersion || '',
    categories: h.categories,
    files: h.files,
    bytes: h.bytes,
    krootFp: h.krootFp || '',
    archiveNonce: h.archiveNonce || '',
    kdf: h.kdf ? { salt: h.kdf.salt, nonce: h.kdf.nonce } : null,
  }), 'utf8');
}

function nmPrefix(h: NmHeader): Buffer {
  const head = Buffer.from(JSON.stringify(h), 'utf8');
  const pre = Buffer.alloc(NM_FIXED);
  NM_MAGIC.copy(pre, 0);
  pre[4] = NM_VERSION;
  pre[5] = h.mode === 'kroot' ? NM_MODE_KROOT : NM_MODE_PLAIN;
  pre[6] = 0;
  pre[7] = 0;
  pre.writeUInt32BE(head.length, 8);
  return Buffer.concat([pre, head]);
}

/** 与 vault 相同的「路径长度 + 路径 + 大小 + mtime + 内容」流式归档；可额外加密。 */
async function xieNmGuiDang(
  root: string,
  files: GuiDangTiao[],
  outFile: string,
  prefix: Buffer,
  key: Buffer | null,
  nonce: Buffer | null,
  aad: Buffer | null,
): Promise<number> {
  const ws = fs.createWriteStream(outFile);
  const gzip = zlib.createGzip({ level: 6 });
  let cipher: crypto.CipherGCM | null = null;
  let endPromise: Promise<void>;
  if (key && nonce) {
    cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
    if (aad) cipher.setAAD(aad);
    gzip.pipe(cipher);
    cipher.pipe(ws, { end: false });
    endPromise = new Promise<void>((resolve, reject) => {
      cipher!.once('end', resolve);
      cipher!.once('error', reject);
    });
  } else {
    gzip.pipe(ws, { end: false });
    endPromise = new Promise<void>((resolve, reject) => {
      gzip.once('end', resolve);
      gzip.once('error', reject);
    });
  }
  const wsDone = new Promise<void>((resolve, reject) => {
    ws.once('finish', resolve);
    ws.once('error', reject);
  });
  void wsDone.catch(() => {});
  void endPromise.catch(() => {});
  gzip.once('error', (e) => { try { cipher?.destroy(e); } catch { /* noop */ } ws.destroy(e); });
  ws.write(prefix);
  const xie = async (buf: Buffer) => { if (!gzip.write(buf)) await once(gzip, 'drain'); };
  let bytes = 0;
  try {
    await xie(ARCHIVE_MAGIC);
    for (const f of files) {
      const name = Buffer.from(f.rel, 'utf8');
      const meta = Buffer.allocUnsafe(4 + 8 + 8);
      meta.writeUInt32BE(name.length, 0);
      meta.writeBigUInt64BE(BigInt(f.size), 4);
      meta.writeBigInt64BE(BigInt(f.mtime), 12);
      await xie(meta);
      await xie(name);
      for await (const chunk of fs.createReadStream(f.abs || path.join(root, f.rel))) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buf.length;
        await xie(buf);
      }
    }
    await xie(Buffer.alloc(4));
    gzip.end();
    await endPromise;
    if (cipher) ws.end(cipher.getAuthTag());
    else ws.end();
    await wsDone;
    return bytes;
  } catch (e) {
    try { gzip.destroy(); } catch { /* noop */ }
    try { cipher?.destroy(); } catch { /* noop */ }
    try { ws.destroy(); } catch { /* noop */ }
    throw e;
  }
}

function readNmHeader(file: string): { ok: boolean; header?: NmHeader; payloadStart?: number; size?: number; error?: string } {
  try {
    const size = fs.statSync(file).size;
    if (size < NM_FIXED) return { ok: false, error: 'bad-nm（文件太短）' };
    const fd = fs.openSync(file, 'r');
    let fixed: Buffer;
    try {
      fixed = Buffer.alloc(NM_FIXED);
      fs.readSync(fd, fixed, 0, NM_FIXED, 0);
      if (!fixed.subarray(0, 4).equals(NM_MAGIC)) return { ok: false, error: 'bad-nm（不是 WArmy 数据包）' };
      if (fixed[4] !== NM_VERSION) return { ok: false, error: 'bad-nm（版本不支持）' };
      const modeByte = fixed[5];
      if (modeByte !== NM_MODE_PLAIN && modeByte !== NM_MODE_KROOT) return { ok: false, error: 'bad-nm（模式不支持）' };
      const len = fixed.readUInt32BE(8);
      if (!len || len > 1024 * 1024) return { ok: false, error: 'bad-nm（头长度不合理）' };
      const head = Buffer.alloc(len);
      fs.readSync(fd, head, 0, len, NM_FIXED);
      let h: NmHeader;
      try { h = JSON.parse(head.toString('utf8')) as NmHeader; } catch { return { ok: false, error: 'bad-nm（头不是合法 JSON）' }; }
      if (!h || h.format !== 'warmy-nm-data' || h.v !== 2) return { ok: false, error: 'bad-nm（头格式不对）' };
      const expectMode = modeByte === NM_MODE_KROOT ? 'kroot' : 'plain';
      if (h.mode !== expectMode) return { ok: false, error: 'bad-nm（模式与头不一致）' };
      if (h.mode === 'kroot' && (!h.kdf || !h.archiveNonce)) return { ok: false, error: 'bad-nm（缺少加密参数）' };
      const payloadStart = NM_FIXED + len;
      if (h.mode === 'kroot' && size < payloadStart + 16) return { ok: false, error: 'bad-nm（密文太短）' };
      return { ok: true, header: h, payloadStart, size };
    } finally {
      try { fs.closeSync(fd); } catch { /* noop */ }
    }
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

export function inspectNmPackage(file: string): NmInspect {
  const r = readNmHeader(file);
  if (!r.ok || !r.header) return { ok: false, error: r.error || 'bad-nm' };
  const h = r.header;
  return {
    ok: true,
    mode: h.mode,
    createdAt: h.createdAt,
    categories: h.categories,
    files: h.files,
    bytes: h.bytes,
    krootFp: h.krootFp || '',
    header: h,
  };
}

function unwrapNmDek(h: NmHeader, kroot: Buffer): Buffer {
  if (!h.kdf) throw new Error('bad-nm（缺少加密参数）');
  const salt = Buffer.from(h.kdf.salt, 'base64');
  const nonce = Buffer.from(h.kdf.nonce, 'base64');
  const wrapped = Buffer.from(h.kdf.wrap, 'base64');
  if (salt.length < 8 || nonce.length !== 12 || wrapped.length < 17) throw new Error('bad-nm（加密参数损坏）');
  const key = Buffer.from(crypto.hkdfSync('sha256', kroot, salt, Buffer.from('warmy/nm/v2/wrap', 'utf8'), 32));
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    d.setAAD(nmAad(h));
    d.setAuthTag(wrapped.subarray(wrapped.length - 16));
    const dek = Buffer.concat([d.update(wrapped.subarray(0, wrapped.length - 16)), d.final()]);
    if (dek.length !== 32) throw new Error('bad-nm（DEK 长度不对）');
    return dek;
  } finally {
    key.fill(0);
  }
}

async function jieNmDaoMuLu(src: string, dest: string, kroot: Buffer | null): Promise<{ files: number; bytes: number }> {
  const r = readNmHeader(src);
  if (!r.ok || !r.header || r.payloadStart === undefined || r.size === undefined) throw new Error(r.error || 'bad-nm');
  const h = r.header;
  fs.mkdirSync(dest, { recursive: true });
  if (h.mode === 'plain') {
    const gunzip = zlib.createGunzip();
    const input = fs.createReadStream(src, { start: r.payloadStart });
    const done = once(gunzip, 'end');
    void done.catch(() => {});
    input.once('error', (e) => gunzip.destroy(e));
    input.pipe(gunzip);
    try {
      const out = await jieXiGuiDangLiu(gunzip, dest);
      await done;
      return out;
    } finally {
      try { gunzip.destroy(); } catch { /* noop */ }
    }
  }
  if (!kroot || kroot.length !== 32) throw new Error('need-mnemonic（这个包要用源账号助记词解锁）');
  const dek = unwrapNmDek(h, kroot);
  try {
    const nonce = Buffer.from(String(h.archiveNonce || ''), 'base64');
    if (nonce.length !== 12) throw new Error('bad-nm（归档 nonce 损坏）');
    const decipher = crypto.createDecipheriv('aes-256-gcm', dek, nonce);
    decipher.setAAD(nmAad(h));
    const tag = Buffer.alloc(16);
    const fd = fs.openSync(src, 'r');
    try { fs.readSync(fd, tag, 0, 16, r.size - 16); } finally { try { fs.closeSync(fd); } catch { /* noop */ } }
    decipher.setAuthTag(tag);
    const gunzip = zlib.createGunzip();
    const input = fs.createReadStream(src, { start: r.payloadStart, end: r.size - 17 });
    const done = once(gunzip, 'end');
    void done.catch(() => {});
    input.once('error', (e) => gunzip.destroy(e));
    decipher.once('error', (e) => gunzip.destroy(e));
    input.pipe(decipher).pipe(gunzip);
    try {
      const out = await jieXiGuiDangLiu(gunzip, dest);
      await done;
      return out;
    } catch {
      throw new Error('bad-mnemonic（助记词不对，或数据包已损坏）');
    } finally {
      try { decipher.destroy(); } catch { /* noop */ }
      try { gunzip.destroy(); } catch { /* noop */ }
    }
  } finally {
    try { dek.fill(0); } catch { /* noop */ }
  }
}

/** 流式读取器：把异步流切成固定长度的块，供归档解析器按格式消费。 */
class LiuDuQi {
  private buf = Buffer.alloc(0);
  private it: AsyncIterator<unknown>;
  private end = false;
  constructor(stream: NodeJS.ReadableStream) { this.it = (stream as AsyncIterable<unknown>)[Symbol.asyncIterator](); }
  async read(n: number): Promise<Buffer> {
    while (this.buf.length < n) {
      if (this.end) throw new Error('bad-archive（文件内容截断）');
      const r = await this.it.next();
      if (r.done) { this.end = true; break; }
      this.buf = Buffer.concat([this.buf, Buffer.from(r.value as Buffer)]);
    }
    if (this.buf.length < n) throw new Error('bad-archive（文件内容截断）');
    const out = Buffer.from(this.buf.subarray(0, n));
    this.buf = this.buf.subarray(n);
    return out;
  }
  async assertEnd(): Promise<void> {
    while (!this.end) {
      const r = await this.it.next();
      if (r.done) { this.end = true; break; }
      this.buf = Buffer.concat([this.buf, Buffer.from(r.value as Buffer)]);
    }
    if (this.buf.length) throw new Error('bad-archive（结束标记后还有数据）');
  }
}

/** 流式解析归档内容直写目标目录；不生成明文 tar 中间文件。 */
async function jieXiGuiDangLiu(stream: NodeJS.ReadableStream, destRoot: string): Promise<{ files: number; bytes: number }> {
  const q = new LiuDuQi(stream);
  if (!(await q.read(5)).equals(ARCHIVE_MAGIC)) throw new Error('bad-archive（仓库归档标识不对）');
  let files = 0;
  let bytes = 0;
  for (;;) {
    const nameLen = (await q.read(4)).readUInt32BE(0);
    if (nameLen === 0) break;
    if (nameLen > 4096) throw new Error('bad-archive（路径过长）');
    const meta = await q.read(16);
    const size = Number(meta.readBigUInt64BE(0));
    const mtime = Number(meta.readBigInt64BE(8));
    const rel = (await q.read(nameLen)).toString('utf8');
    if (!anQuanXiangDui(rel)) throw new Error(`zip-slip（仓库条目路径不安全：${rel.slice(0, 80)}）`);
    if (size > 8 * 1024 * 1024 * 1024) throw new Error('bad-archive（单文件过大）');
    const dest = path.join(destRoot, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const out = fs.openSync(dest, 'w');
    let left = size;
    try {
      while (left > 0) {
        const n = Math.min(1024 * 1024, left);
        const b = await q.read(n);
        fs.writeSync(out, b, 0, b.length);
        left -= n;
        bytes += b.length;
      }
    } finally {
      try { fs.closeSync(out); } catch { /* noop */ }
    }
    try { fs.utimesSync(dest, new Date(), new Date(mtime)); } catch { /* noop */ }
    files += 1;
  }
  await q.assertEnd();
  return { files, bytes };
}

/** 解密/解压 + 解析归档，直写临时目录；支持 vault（主密钥/口令）与明文 gzip 两种包。 */
async function jieMiGuiDangLiu(src: string, destRoot: string, keyOf: (salt: Buffer, mode: number) => Buffer): Promise<{ files: number; bytes: number; mode: 'master' | 'password' | 'plain' }> {
  const st = fs.statSync(src);
  if (st.size < 2) throw new Error('bad-vault（文件太短）');
  const fd = fs.openSync(src, 'r');
  const head = Buffer.alloc(HEADER_LEN);
  let n = 0;
  try { n = fs.readSync(fd, head, 0, Math.min(HEADER_LEN, st.size), 0); } finally { try { fs.closeSync(fd); } catch { /* noop */ } }
  if (n < 2) throw new Error('bad-vault（文件太短）');
  // 明文 gzip：没有 vault 头，直接走 gunzip + 归档解析
  if (head[0] === 0x1f && head[1] === 0x8b) {
    const gunzip = zlib.createGunzip();
    const input = fs.createReadStream(src);
    const done = once(gunzip, 'end');
    void done.catch(() => {});
    input.once('error', (e) => gunzip.destroy(e));
    input.pipe(gunzip);
    try {
      const r = await jieXiGuiDangLiu(gunzip, destRoot);
      await done;
      return { ...r, mode: 'plain' };
    } finally {
      try { gunzip.destroy(); } catch { /* noop */ }
    }
  }
  if (n < HEADER_LEN) throw new Error('bad-vault（文件太短）');
  if (st.size < HEADER_LEN + TAG_LEN) throw new Error('bad-vault（文件太短）');
  if (!head.subarray(0, 4).equals(MAGIC)) throw new Error('bad-vault（不是 WArmy 仓库文件）');
  if (head[4] !== VERSION) throw new Error('bad-vault（仓库版本不支持）');
  const mode = head[5] ?? -1;
  const salt = Buffer.from(head.subarray(7, 23));
  const nonce = Buffer.from(head.subarray(23, 35));
  const tag = Buffer.alloc(TAG_LEN);
  const tfd = fs.openSync(src, 'r');
  try { fs.readSync(tfd, tag, 0, TAG_LEN, st.size - TAG_LEN); } finally { try { fs.closeSync(tfd); } catch { /* noop */ } }
  const key = keyOf(salt, mode);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  const gunzip = zlib.createGunzip();
  const input = fs.createReadStream(src, { start: HEADER_LEN, end: st.size - TAG_LEN - 1 });
  const done = once(gunzip, 'end');
  void done.catch(() => {});
  input.once('error', (e) => gunzip.destroy(e));
  decipher.once('error', (e) => gunzip.destroy(e));
  input.pipe(decipher).pipe(gunzip);
  try {
    const r = await jieXiGuiDangLiu(gunzip, destRoot);
    await done;
    return { ...r, mode: mode === MODE_MASTER ? 'master' : 'password' };
  } finally {
    try { decipher.destroy(); } catch { /* noop */ }
    try { gunzip.destroy(); } catch { /* noop */ }
  }
}

function paiShengMiYao(password: string, salt: Buffer): Buffer {
  return crypto.scryptSync(String(password || ''), salt, 32, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 });
}

function zhuYaoYaoShi(masterKey: Buffer): Buffer {
  return Buffer.from(crypto.hkdfSync('sha256', masterKey, Buffer.from('warmy-data-vault'), Buffer.from('v1'), 32));
}

async function jieMiWenJian(src: string, out: string, keyOf: (salt: Buffer, mode: number) => Buffer): Promise<void> {
  const st = fs.statSync(src);
  if (st.size < HEADER_LEN + TAG_LEN) throw new Error('bad-vault（文件太短）');
  const fd = fs.openSync(src, 'r');
  const head = Buffer.alloc(HEADER_LEN);
  try { fs.readSync(fd, head, 0, HEADER_LEN, 0); } finally { try { fs.closeSync(fd); } catch { /* noop */ } }
  if (!head.subarray(0, 4).equals(MAGIC)) throw new Error('bad-vault（不是 WArmy 仓库文件）');
  if (head[4] !== VERSION) throw new Error('bad-vault（仓库版本不支持）');
  const mode = head[5] ?? -1;
  const salt = Buffer.from(head.subarray(7, 23));
  const nonce = Buffer.from(head.subarray(23, 35));
  const key = keyOf(salt, mode);
  const tag = Buffer.alloc(TAG_LEN);
  const fd2 = fs.openSync(src, 'r');
  try { fs.readSync(fd2, tag, 0, TAG_LEN, st.size - TAG_LEN); } finally { try { fs.closeSync(fd2); } catch { /* noop */ } }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  try {
    await pipeline(
      fs.createReadStream(src, { start: HEADER_LEN, end: st.size - TAG_LEN - 1 }),
      decipher,
      zlib.createGunzip(),
      fs.createWriteStream(out),
    );
  } catch {
    try { fs.rmSync(out, { force: true }); } catch { /* noop */ }
    throw new Error('bad-password（口令不对，或仓库文件已损坏）');
  }
}

function shanChuWenJian(root: string, files: GuiDangTiao[]): string[] {
  const shiBai: string[] = [];
  for (const f of files) {
    try { fs.rmSync(path.join(root, f.rel), { force: true, maxRetries: 5, retryDelay: 100 }); } catch { shiBai.push(f.rel); }
  }
  // 只清理空目录；auth/identity/secure 等受保护目录不在 files 里，不会被删
  const dirs = new Set<string>();
  for (const f of files) {
    let d = path.dirname(f.rel);
    while (d && d !== '.') { dirs.add(d); d = path.dirname(d); }
  }
  for (const d of [...dirs].sort((a, b) => b.length - a.length)) {
    try { fs.rmdirSync(path.join(root, d)); } catch { /* 非空/占用 */ }
  }
  return shiBai;
}

export class DataVault {
  private readonly userData: string;
  private readonly protector: VaultProtector;
  private readonly log: (line: string) => void;
  /** 当前加密密钥：通常是 Kroot 包裹的随机 DEK 派生；旧安装可能仍是旧主密钥派生 */
  private key: Buffer | null = null;
  /** 旧主密钥派生密钥：只用于解开升级前的 vault.bin，不用于新写入 */
  private legacyKey: Buffer | null = null;
  private unsealed = false;
  private lastStatus: { files: number; bytes: number } | null = null;

  constructor(opts: VaultOptions) {
    this.userData = opts.userData;
    this.protector = opts.protector;
    this.log = opts.log || (() => {});
  }

  private get vaultFile(): string { return path.join(this.userData, 'vault.bin'); }
  private get tokenFile(): string { return path.join(this.userData, 'vault.session'); }
  private get cleanFile(): string { return path.join(this.userData, 'vault.clean'); }
  private isCleanSealed(): boolean {
    try {
      if (!shiWenJian(this.cleanFile) || !shiWenJian(this.vaultFile)) return false;
      return JSON.parse(fs.readFileSync(this.cleanFile, 'utf8')).v === 1;
    } catch { return false; }
  }
  private writeClean(): boolean {
    const tmp = this.cleanFile + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify({ v: 1, at: Date.now() }), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tmp, this.cleanFile);
      return true;
    } catch {
      try { fs.rmSync(tmp, { force: true }); } catch { /* noop */ }
      return false;
    }
  }
  private clearClean(): void {
    try { fs.rmSync(this.cleanFile, { force: true }); } catch { /* noop */ }
  }

  hasVault(): boolean { return shiWenJian(this.vaultFile); }
  isUnlocked(): boolean { return this.unsealed && !!this.key; }
  /** 定时导出用：列出当前会进包的文件（不读内容，只看大小/时间）。 */
  listExportFiles(include?: string[], scope?: DaoChuFanWei): Array<{ rel: string; size: number; mtime: number }> {
    return lieWenJian(this.userData, true, include, scope).files;
  }
  status(): { hasVault: boolean; unlocked: boolean; files: number; bytes: number } {
    return { hasVault: this.hasVault(), unlocked: this.isUnlocked(), files: this.lastStatus?.files || 0, bytes: this.lastStatus?.bytes || 0 };
  }

  /** 由账号主密钥派生并保存仓库子密钥；调用方负责在返回后清零传入的 masterKey。 */
  setMasterKey(masterKey: Buffer): void {
    this.lock();
    this.legacyKey = zhuYaoYaoShi(masterKey);
    this.key = Buffer.from(this.legacyKey);
  }

  /**
   * 第 111 轮：优先使用 keyEnvelope 里的随机 DEK 派生仓库密钥。
   * 旧 vault.bin 仍可用 legacyKey 解开；下次封存自动换成 DEK 加密。
   */
  setDataKey(dek: Buffer): boolean {
    if (!dek || dek.length !== 32) return false;
    if (this.key) { this.key.fill(0); }
    this.key = zhuYaoYaoShi(dek);
    return true;
  }

  private keyCandidates(): Buffer[] {
    const out: Buffer[] = [];
    if (this.key) out.push(this.key);
    if (this.legacyKey && !out.some((k) => k.equals(this.legacyKey!))) out.push(this.legacyKey);
    return out;
  }

  lock(): void {
    if (this.key) { this.key.fill(0); this.key = null; }
    if (this.legacyKey) { this.legacyKey.fill(0); this.legacyKey = null; }
    this.unsealed = false;
  }

  markUnsealed(): void {
    this.unsealed = !!this.key;
  }

  /** 首次注册/没有 vault 时调用：当前 userData 即工作副本。 */
  markFreshUnsealed(): VaultResult {
    if (!this.key) return { ok: false, error: 'vault-locked' };
    this.unsealed = true;
    this.clearClean();
    return { ok: true, files: 0, bytes: 0 };
  }

  /**
   * 登录后解包。已有明文（上次异常退出留下的工作副本）时**不覆盖**：那是最新数据，
   * 记为 recovery，等下一次封存把它收进 vault。
   */
  async unseal(): Promise<VaultResult> {
    if (!this.key) return { ok: false, error: 'vault-locked' };
    if (!this.hasVault()) { this.markFreshUnsealed(); return { ok: true, files: 0, bytes: 0 }; }
    const { files } = lieWenJian(this.userData, false);
    /**
     * 上次是**干净封存**（vault.clean 存在）⇒ 现在看到的明文只是登录前 yindao/渲染层
     * 写的默认配置，必须清掉再解包，不能被误当成"崩溃遗留的最新数据"。
     * 没有 clean 标记且有明文 ⇒ 上次异常退出，明文是最新数据，保留它（下一次封存收进仓库）。
     */
    if (files.length > 0) {
      if (this.isCleanSealed()) {
        const shiBai = shanChuWenJian(this.userData, files);
        if (shiBai.length) {
          this.log('vault.unseal-cleanup-failed files=' + shiBai.length);
          return { ok: false, error: 'unseal-cleanup-failed（登录前的默认文件删不掉，可能被占用）：' + shiBai.slice(0, 8).join(', ') };
        }
      } else {
        this.unsealed = true;
        this.log('vault.unseal-skip-plaintext files=' + files.length);
        return { ok: true, files: files.length, bytes: 0, skipped: ['已有未封存工作副本，保留它'] };
      }
    }
    /**
     * 旧 vault 用旧主密钥加密，新 vault 用 DEK 派生密钥；
     * 两把都试，成功哪把都行（下次封存自然换成 DEK）。
     */
    let lastError = '';
    for (const [i, keyRef] of this.keyCandidates().entries()) {
      const tempRoot = path.join(os.tmpdir(), `warmy-unseal-${process.pid}-${Date.now()}-${i}`);
      try {
        fs.mkdirSync(tempRoot, { recursive: true });
        const r = await jieMiGuiDangLiu(this.vaultFile, tempRoot, () => keyRef);
        this.huiFuMuLu(tempRoot, this.userData);
        this.unsealed = true;
        this.clearClean();
        this.lastStatus = r;
        this.log(`vault.unsealed files=${r.files} bytes=${r.bytes} key=${i === 0 ? 'data' : 'legacy'}`);
        return { ok: true, files: r.files, bytes: r.bytes };
      } catch (e) {
        lastError = String((e as Error)?.message || e);
      } finally {
        try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* noop */ }
      }
    }
    return { ok: false, error: lastError || 'unseal-failed' };
  }

  /** 封存：打包 → 写 vault.bin.tmp → 替换 vault.bin → 删除明文。失败绝不删明文。 */
  async seal(): Promise<VaultResult> {
    if (!this.key || !this.unsealed) return { ok: false, error: 'vault-locked' };
    if (!this.hasVault() && !this.userData) return { ok: false, error: 'no-user-data' };
    const { files, skipped } = lieWenJian(this.userData, false);
    if (!files.length && this.hasVault()) return { ok: true, files: 0, bytes: 0 };
    const tmpVault = this.vaultFile + '.tmp';
    try {
      const bytes = await jiaMiGuiDang(this.userData, files, tmpVault, this.key, MODE_MASTER, Buffer.alloc(16));
      fs.renameSync(tmpVault, this.vaultFile);
      const shiBai = shanChuWenJian(this.userData, files);
      this.unsealed = false;
      // vault 已完整写出；clean 表示下次登录可以安全解包，不代表明文已全部删干净。
      const cleanOk = this.writeClean();
      this.lastStatus = { files: files.length, bytes };
      this.log(`vault.sealed files=${files.length} bytes=${bytes} deleteFail=${shiBai.length} clean=${cleanOk}`);
      if (shiBai.length || !cleanOk) {
        return {
          ok: false,
          error: cleanOk ? 'seal-plaintext-remains（vault 已写出，但部分明文删不掉）' : 'seal-clean-marker-failed（vault 已写出，但封存标记写不进去）',
          files: files.length,
          bytes,
          skipped: [...skipped, ...shiBai],
        };
      }
      return { ok: true, files: files.length, bytes, skipped };
    } catch (e) {
      try { fs.rmSync(tmpVault, { force: true }); } catch { /* noop */ }
      return { ok: false, error: String((e as Error)?.message || e) };
    }
  }

  /** 完整导出：包含 auth/identity/secure，便于换机恢复账号与凭据。 */
  async exportVault(outFile: string, password: string, include?: string[]): Promise<VaultResult> {
    return this.exportVaultWithOptions(outFile, { password, include });
  }

  /**
   * 第 107 轮：可选范围/是否加密/是否用当前登录主密钥。
   * · plain=true 写出 gzip 归档（**明确是明文包**，界面必须先警告）；
   * · useSessionKey=true 用当前已解锁主密钥（不用口令，适合定时备份；锁屏时返回 vault-locked）。
   */
  async exportVaultWithOptions(
    outFile: string,
    opts: {
      password?: string;
      include?: string[];
      plain?: boolean;
      useSessionKey?: boolean;
      scope?: DaoChuFanWei;
      /** 逻辑文件（选择性导出的消息/知识/元数据），`abs` 指真实临时文件 */
      extraFiles?: Array<{ rel: string; size: number; mtime: number; abs?: string }>;
    } = {},
  ): Promise<VaultResult> {
    const { files: yuanFiles, skipped } = lieWenJian(this.userData, true, opts.include, opts.scope);
    const files = [...yuanFiles, ...(Array.isArray(opts.extraFiles) ? opts.extraFiles : [])];
    try {
      if (opts.plain) {
        const bytes = await xieGuiDangPingWen(this.userData, files, outFile);
        this.log(`vault.exported-plain files=${files.length} bytes=${bytes}`);
        return { ok: true, files: files.length, bytes, skipped };
      }
      if (opts.useSessionKey) {
        if (!this.key) return { ok: false, error: 'vault-locked（当前未解锁，无法用登录主密钥导出）' };
        const bytes = await jiaMiGuiDang(this.userData, files, outFile, this.key, MODE_MASTER, Buffer.alloc(16));
        this.log(`vault.exported-master files=${files.length} bytes=${bytes}`);
        return { ok: true, files: files.length, bytes, skipped };
      }
      const pw = String(opts.password || '');
      if (!pw || pw.length < 4) return { ok: false, error: 'weak-password' };
      const salt = crypto.randomBytes(16);
      const key = paiShengMiYao(pw, salt);
      try {
        const bytes = await jiaMiGuiDang(this.userData, files, outFile, key, MODE_PASSWORD, salt);
        this.log(`vault.exported files=${files.length} bytes=${bytes}`);
        return { ok: true, files: files.length, bytes, skipped };
      } finally {
        key.fill(0);
      }
    } catch (e) {
      try { fs.rmSync(outFile, { force: true }); } catch { /* noop */ }
      return { ok: false, error: String((e as Error)?.message || e) };
    }
  }

  /**
   * 第 111 轮：`.nm` v2 全量数据包导出。
   * · plain=true ⇒ 明文包（界面必须先警告，尤其是含 account 时）；
   * · 否则用 Kroot 包裹随机 DEK，随包头带 Kroot 指纹：同账号直接导入，异账号用源助记词解锁。
   */
  async exportNm(
    outFile: string,
    opts: {
      plain?: boolean;
      kroot?: Buffer;
      include?: string[];
      scope?: DaoChuFanWei;
      extraFiles?: Array<{ rel: string; size: number; mtime: number; abs?: string }>;
      appVersion?: string;
    } = {},
  ): Promise<VaultResult> {
    const { files: yuanFiles, skipped } = lieWenJian(this.userData, true, opts.include, opts.scope);
    const files = [...yuanFiles, ...(Array.isArray(opts.extraFiles) ? opts.extraFiles : [])];
    const total = files.reduce((n, f) => n + Math.max(0, Number(f.size) || 0), 0);
    const categories = Array.isArray(opts.include) && opts.include.length
      ? [...new Set(opts.include.map(String))]
      : Object.keys(EXPORT_CATEGORIES);
    const base: NmHeader = {
      format: 'warmy-nm-data',
      v: 2,
      mode: opts.plain ? 'plain' : 'kroot',
      createdAt: Date.now(),
      app: 'warmy',
      appVersion: String(opts.appVersion || ''),
      categories,
      files: files.length,
      bytes: total,
    };
    try {
      if (opts.plain) {
        const bytes = await xieNmGuiDang(this.userData, files, outFile, nmPrefix(base), null, null, null);
        this.log(`nm.exported-plain files=${files.length} bytes=${bytes}`);
        return { ok: true, files: files.length, bytes, skipped };
      }
      if (!opts.kroot || opts.kroot.length !== 32) return { ok: false, error: 'kroot-unavailable（当前会话没有稳定恢复根）' };
      const dek = crypto.randomBytes(32);
      const salt = crypto.randomBytes(16);
      const wrapNonce = crypto.randomBytes(12);
      const archiveNonce = crypto.randomBytes(12);
      const wrapKey = Buffer.from(crypto.hkdfSync('sha256', opts.kroot, salt, Buffer.from('warmy/nm/v2/wrap', 'utf8'), 32));
      let wrapped: Buffer;
      try {
        const wc = crypto.createCipheriv('aes-256-gcm', wrapKey, wrapNonce);
        wc.setAAD(nmAad({ ...base, krootFp: krootFingerprint(opts.kroot), kdf: { salt: salt.toString('base64'), nonce: wrapNonce.toString('base64'), wrap: '' }, archiveNonce: archiveNonce.toString('base64') }));
        wrapped = Buffer.concat([wc.update(dek), wc.final(), wc.getAuthTag()]);
      } finally {
        wrapKey.fill(0);
      }
      const h: NmHeader = {
        ...base,
        krootFp: krootFingerprint(opts.kroot),
        kdf: { salt: salt.toString('base64'), nonce: wrapNonce.toString('base64'), wrap: wrapped.toString('base64') },
        archiveNonce: archiveNonce.toString('base64'),
      };
      const bytes = await xieNmGuiDang(this.userData, files, outFile, nmPrefix(h), dek, archiveNonce, nmAad(h));
      this.log(`nm.exported-kroot files=${files.length} bytes=${bytes}`);
      return { ok: true, files: files.length, bytes, skipped };
    } catch (e) {
      try { fs.rmSync(outFile, { force: true }); } catch { /* noop */ }
      return { ok: false, error: String((e as Error)?.message || e) };
    } finally {
      try { opts.kroot?.fill(0); } catch { /* noop */ }
    }
  }

  /** 导入前只读 `.nm` 头（不解密）；用于判断是否需要源助记词 */
  inspectNm(file: string): NmInspect { return inspectNmPackage(file); }

  async verifyNm(inFile: string, kroot: Buffer | null): Promise<VaultResult> {
    const tempRoot = path.join(os.tmpdir(), `warmy-nm-verify-${process.pid}-${Date.now()}`);
    try {
      fs.mkdirSync(tempRoot, { recursive: true });
      const r = await jieNmDaoMuLu(inFile, tempRoot, kroot);
      return { ok: true, files: r.files, bytes: r.bytes };
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message || e) };
    } finally {
      try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* noop */ }
      try { kroot?.fill(0); } catch { /* noop */ }
    }
  }

  /** 导入 `.nm`：先完整解到临时目录，确认后覆盖；失败回滚，绝不半解。 */
  async importNm(inFile: string, opts: { kroot?: Buffer | null; include?: string[] } = {}): Promise<VaultResult> {
    const stamp = `${process.pid}-${Date.now()}`;
    const tempRoot = path.join(os.tmpdir(), `warmy-nm-import-${stamp}`);
    const backupFile = path.join(os.tmpdir(), `warmy-nm-import-backup-${stamp}.wvault`);
    const restoreRoot = path.join(os.tmpdir(), `warmy-nm-import-restore-${stamp}`);
    const backupKey = this.key || crypto.randomBytes(32);
    let keepBackup = false;
    try {
      fs.mkdirSync(tempRoot, { recursive: true });
      const r = await jieNmDaoMuLu(inFile, tempRoot, opts.kroot || null);
      /** 逻辑载荷先并进当前数据；消息排队到 logical-import/，由记忆服务启动后导入 */
      try { this.heBingLuoJi(tempRoot, this.userData, Array.isArray(opts.include) && opts.include.length ? opts.include.map(String) : null); } catch (e) {
        this.log('nm.logical-merge-failed ' + String((e as Error)?.message || e).slice(0, 160));
      }
      const before = lieWenJian(this.userData, true).files;
      const beforeSet = new Set(before.map((f) => f.rel));
      await jiaMiGuiDang(this.userData, before, backupFile, backupKey, MODE_MASTER, Buffer.alloc(16));
      try {
        this.huiFuMuLu(tempRoot, this.userData, Array.isArray(opts.include) && opts.include.length ? opts.include.map(String) : null);
      } catch (copyErr) {
        try {
          fs.mkdirSync(restoreRoot, { recursive: true });
          await jieMiGuiDangLiu(backupFile, restoreRoot, () => backupKey);
          this.huiFuMuLu(restoreRoot, this.userData, null);
          for (const f of lieWenJian(this.userData, true).files) {
            if (!beforeSet.has(f.rel)) { try { fs.rmSync(path.join(this.userData, f.rel), { force: true }); } catch { /* noop */ } }
          }
        } catch { keepBackup = true; }
        return { ok: false, error: `import-failed-and-rolled-back: ${String((copyErr as Error)?.message || copyErr)}（加密快照：${backupFile}）` };
      }
      this.lastStatus = r;
      try { fs.rmSync(this.vaultFile, { force: true }); } catch { /* noop */ }
      this.clearSessionToken();
      this.clearClean();
      this.unsealed = !!this.key;
      this.log(`nm.imported files=${r.files} bytes=${r.bytes}`);
      return { ok: true, files: r.files, bytes: r.bytes };
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message || e) };
    } finally {
      try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* noop */ }
      try { fs.rmSync(restoreRoot, { recursive: true, force: true }); } catch { /* noop */ }
      if (!keepBackup) { try { fs.rmSync(backupFile, { force: true }); } catch { /* noop */ } }
      try { opts.kroot?.fill(0); } catch { /* noop */ }
    }
  }

  /** 导入前看信封：只读头，不解密；返回是否有完整账号。 */
  inspect(file: string): { ok: boolean; mode?: 'master' | 'password' | 'plain'; createdAt?: number; error?: string } {
    try {
      const st = fs.statSync(file);
      if (st.size < 2) return { ok: false, error: 'bad-vault' };
      const fd = fs.openSync(file, 'r');
      const head = Buffer.alloc(HEADER_LEN);
      let n = 0;
      try { n = fs.readSync(fd, head, 0, Math.min(HEADER_LEN, st.size), 0); } finally { try { fs.closeSync(fd); } catch { /* noop */ } }
      if (n >= 2 && head[0] === 0x1f && head[1] === 0x8b) return { ok: true, mode: 'plain' };
      if (n < HEADER_LEN + TAG_LEN) return { ok: false, error: 'bad-vault' };
      if (!head.subarray(0, 4).equals(MAGIC)) return { ok: false, error: 'bad-vault' };
      return { ok: true, mode: head[5] === MODE_PASSWORD ? 'password' : 'master' };
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message || e) };
    }
  }

  /** 先按 DEK、再按旧主密钥各解一次；返回真正解开的那份临时目录。 */
  private async decodeTo(src: string, dest: string, password: string): Promise<VaultResult & { root?: string }> {
    let lastError = '';
    const candidates = this.keyCandidates();
    for (const [i, keyRef] of (candidates.length ? candidates : [null]).entries()) {
      const sub = path.join(dest, 'key-' + i);
      try {
        fs.mkdirSync(sub, { recursive: true });
        const r = await jieMiGuiDangLiu(src, sub, (salt, mode) => {
          if (mode === MODE_MASTER) {
            if (!keyRef) throw new Error('vault-locked（这个包要用当前账号主密钥才能解）');
            return keyRef;
          }
          if (!password) throw new Error('need-password（这个包需要导出口令）');
          return paiShengMiYao(password, salt);
        });
        return { ok: true, files: r.files, bytes: r.bytes, root: sub };
      } catch (e) {
        lastError = String((e as Error)?.message || e);
        try { fs.rmSync(sub, { recursive: true, force: true }); } catch { /* noop */ }
      }
    }
    return { ok: false, error: lastError || 'import-verify-failed' };
  }

  /** 导入前完整验证包（口令/认证/归档结构）；只写临时目录，不碰当前 userData。 */
  async verifyImport(inFile: string, password: string): Promise<VaultResult> {
    const tempRoot = path.join(os.tmpdir(), `warmy-verify-${process.pid}-${Date.now()}`);
    try {
      fs.mkdirSync(tempRoot, { recursive: true });
      const r = await this.decodeTo(inFile, tempRoot, password);
      return r.ok ? { ok: true, files: r.files, bytes: r.bytes } : { ok: false, error: r.error };
    } finally {
      try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* noop */ }
    }
  }

  /** 导入：先完整解到临时目录（口令错/损坏不会碰现有数据），确认后覆盖 userData。 */
  async importVault(inFile: string, password: string, opts: { include?: string[] } = {}): Promise<VaultResult> {
    const include = Array.isArray(opts.include) && opts.include.length ? opts.include.map(String) : null;
    const stamp = `${process.pid}-${Date.now()}`;
    const tempRoot = path.join(os.tmpdir(), `warmy-import-${stamp}`);
    const backupFile = path.join(os.tmpdir(), `warmy-import-backup-${stamp}.wvault`);
    const restoreRoot = path.join(os.tmpdir(), `warmy-import-restore-${stamp}`);
    const backupKey = this.key || crypto.randomBytes(32);
    let keepBackup = false;
    try {
      fs.mkdirSync(tempRoot, { recursive: true });
      /**
       * 先完整解包到临时目录（流式，不落明文 tar/归档）。
       * 口令错/包损坏在这里就失败，当前 userData 一个字节都不动。
       */
      const decoded = await this.decodeTo(inFile, tempRoot, password);
      if (!decoded.ok || !decoded.root) return { ok: false, error: decoded.error || 'import-verify-failed' };
      const r = { files: Number(decoded.files) || 0, bytes: Number(decoded.bytes) || 0 };
      /**
       * 逻辑载荷（选择性导出的聊天记录/知识/元数据）先并进当前数据：
       * 消息先落到 `logical-import/`，等记忆服务起来后再逐条 append（保留原 ts）。
       */
      try { this.heBingLuoJi(decoded.root, this.userData, include); } catch (e) {
        this.log('vault.logical-merge-failed ' + String((e as Error)?.message || e).slice(0, 160));
      }
      /** 覆盖前给当前数据做一份加密快照：中途失败能回滚，不把旧库丢在半路。 */
      const before = lieWenJian(this.userData, true).files;
      const beforeSet = new Set(before.map((f) => f.rel));
      await jiaMiGuiDang(this.userData, before, backupFile, backupKey, MODE_MASTER, Buffer.alloc(16));
      try {
        this.huiFuMuLu(decoded.root, this.userData, include);
      } catch (copyErr) {
        try {
          fs.mkdirSync(restoreRoot, { recursive: true });
          await jieMiGuiDangLiu(backupFile, restoreRoot, () => backupKey);
          this.huiFuMuLu(restoreRoot, this.userData, null);
          /** 清掉导入过程中新写、原本不存在的文件，避免留下混合现场。 */
          for (const f of lieWenJian(this.userData, true).files) {
            if (!beforeSet.has(f.rel)) { try { fs.rmSync(path.join(this.userData, f.rel), { force: true }); } catch { /* noop */ } }
          }
        } catch { /* 回滚失败：保留备份文件供人工恢复，下面把路径写进错误 */ keepBackup = true; }
        return { ok: false, error: `import-failed-and-rolled-back: ${String((copyErr as Error)?.message || copyErr)}（加密快照：${backupFile}）` };
      }
      this.lastStatus = r;
      // 导入的是最新明文；旧 vault.bin 已过期，删掉以免下一次登录解出旧数据。
      try { fs.rmSync(this.vaultFile, { force: true }); } catch { /* noop */ }
      this.clearSessionToken();
      this.clearClean();
      this.unsealed = !!this.key;
      this.log(`vault.imported files=${r.files} bytes=${r.bytes}`);
      return { ok: true, files: r.files, bytes: r.bytes };
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message || e) };
    } finally {
      try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* noop */ }
      try { fs.rmSync(restoreRoot, { recursive: true, force: true }); } catch { /* noop */ }
      if (!keepBackup) { try { fs.rmSync(backupFile, { force: true }); } catch { /* noop */ } }
      if (!this.key) { try { backupKey.fill(0); } catch { /* noop */ } }
    }
  }

  /**
   * 合并逻辑载荷：`__logical__/` 里的聊天元数据、知识库、归档按 id 合并；
   * 聊天消息写入 `logical-import/`，由主进程在记忆服务就绪后导入（保留原时间戳）。
   */
  private heBingLuoJi(src: string, dest: string, include?: string[] | null): void {
    const dir = path.join(src, '__logical__');
    if (!fs.existsSync(dir)) return;
    const inc = Array.isArray(include) && include.length ? new Set(include.map(String)) : null;
    const yao = (c: string) => !inc || inc.has(c);
    const readJson = (p: string): Record<string, unknown> | null => {
      try { const j = JSON.parse(fs.readFileSync(p, 'utf8')); return j && typeof j === 'object' ? j as Record<string, unknown> : null; } catch { return null; }
    };
    // 1) 聊天元数据：按 sessionId 合并，导入包覆盖同名键（包内是用户选中的选择）
    try {
      const add = yao('chat') ? readJson(path.join(dir, 'chat-meta.json')) : null;
      if (add) {
        const curPath = path.join(dest, 'chat-meta.json');
        const cur = readJson(curPath) || {};
        const curSessions = (cur.sessions && typeof cur.sessions === 'object') ? cur.sessions as Record<string, unknown> : {};
        const addSessions = (add.sessions && typeof add.sessions === 'object') ? add.sessions as Record<string, unknown> : {};
        fs.mkdirSync(dest, { recursive: true });
        fs.writeFileSync(curPath, JSON.stringify({ ...cur, sessions: { ...curSessions, ...addSessions } }), 'utf8');
      }
    } catch { /* noop */ }
    // 2) 知识库：按实体/事件 id 合并
    try {
      if (yao('knowledge')) for (const f of fs.readdirSync(dir)) {
        if (!/^knowledge-[a-z]+\.json$/i.test(f)) continue;
        const add = readJson(path.join(dir, f));
        if (!add) continue;
        const curPath = path.join(dest, 'knowledge', f);
        const cur = readJson(curPath) || { entities: [], events: [] };
        const mergeById = (a: unknown, b: unknown) => {
          const out = new Map<string, unknown>();
          for (const x of (Array.isArray(a) ? a : [])) {
            const id = String((x as { id?: unknown })?.id || '');
            if (id) out.set(id, x);
          }
          for (const x of (Array.isArray(b) ? b : [])) {
            const id = String((x as { id?: unknown })?.id || '');
            if (id) out.set(id, x);
          }
          return [...out.values()];
        };
        fs.mkdirSync(path.dirname(curPath), { recursive: true });
        fs.writeFileSync(curPath, JSON.stringify({
          ...cur,
          entities: mergeById(cur.entities, add.entities),
          events: mergeById(cur.events, add.events),
        }), 'utf8');
      }
    } catch { /* noop */ }
    // 3) 归档索引：按整行去重追加
    try {
      const addPath = yao('chat') ? path.join(dir, 'archives.jsonl') : '';
      if (addPath && fs.existsSync(addPath)) {
        const curPath = path.join(dest, 'archive', 'archives.jsonl');
        fs.mkdirSync(path.dirname(curPath), { recursive: true });
        const old = fs.existsSync(curPath) ? fs.readFileSync(curPath, 'utf8').split(/\r?\n/).filter(Boolean) : [];
        const seen = new Set(old);
        for (const line of fs.readFileSync(addPath, 'utf8').split(/\r?\n/)) {
          if (line.trim() && !seen.has(line)) { old.push(line); seen.add(line); }
        }
        fs.writeFileSync(curPath, old.join('\n') + (old.length ? '\n' : ''), 'utf8');
      }
    } catch { /* noop */ }
    // 4) 聊天消息：排队，启动后由记忆服务逐条 append
    try {
      const msgPath = yao('chat') ? path.join(dir, 'chat-messages.jsonl') : '';
      if (msgPath && fs.existsSync(msgPath) && fs.statSync(msgPath).size > 0) {
        const q = path.join(dest, 'logical-import');
        fs.mkdirSync(q, { recursive: true });
        fs.copyFileSync(msgPath, path.join(q, `chat-messages-${Date.now()}-${process.pid}.jsonl`));
      }
    } catch { /* noop */ }
  }

  /** 把一个临时目录里的文件递归覆盖到目标根目录（保留相对路径）；`include` 按类别过滤导入。 */
  private huiFuMuLu(src: string, dest: string, include?: string[] | null): void {
    const inc = Array.isArray(include) && include.length ? new Set(include.map(String)) : null;
    const leiOf = (rel: string): string[] => {
      const out: string[] = [];
      for (const [cat, pres] of Object.entries(EXPORT_CATEGORIES)) {
        if (pres.some((pre) => rel === pre || rel.startsWith(pre))) out.push(cat);
      }
      return out;
    };
    const fangXing = (rel: string): boolean => {
      if (!inc) return true;
      const cats = leiOf(rel);
      return cats.some((c) => inc.has(c));
    };
    const walk = (dir: string) => {
      let ents: fs.Dirent[] = [];
      try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const ent of ents) {
        if (ent.name === '__logical__') continue;
        const p = path.join(dir, ent.name);
        const rel = path.relative(src, p).replace(/\\/g, '/');
        const t = path.join(dest, rel);
        if (ent.isDirectory()) { fs.mkdirSync(t, { recursive: true }); walk(p); continue; }
        if (!ent.isFile()) continue;
        if (!fangXing(rel)) continue;
        fs.mkdirSync(path.dirname(t), { recursive: true });
        fs.copyFileSync(p, t);
      }
    };
    walk(src);
  }

  /** 一次性会话令牌：把主密钥用 OS 保护包起来，供“登录成功 → 重启 → 直接进入”使用。 */
  writeSessionToken(masterKey: Buffer): boolean {
    if (!this.protector.available()) return false;
    try {
      const wrapped = this.protector.protect(masterKey.toString('base64'));
      const tmp = this.tokenFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ v: 1, createdAt: Date.now(), wrapped }), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tmp, this.tokenFile);
      return true;
    } catch {
      return false;
    }
  }

  readSessionToken(): Buffer | null {
    try {
      if (!fs.existsSync(this.tokenFile)) return null;
      const j = JSON.parse(fs.readFileSync(this.tokenFile, 'utf8')) as { v?: number; wrapped?: string };
      if (j.v !== 1 || !j.wrapped) return null;
      const b64 = this.protector.unprotect(j.wrapped);
      const buf = Buffer.from(b64, 'base64');
      return buf.length === 32 ? buf : null;
    } catch {
      return null;
    }
  }

  clearSessionToken(): void {
    try { fs.rmSync(this.tokenFile, { force: true }); } catch { /* noop */ }
    try { fs.rmSync(this.tokenFile + '.tmp', { force: true }); } catch { /* noop */ }
  }

  /** 检查是否有明文工作副本（用于启动时判断上次是否异常退出）。 */
  hasPlaintext(): boolean {
    return lieWenJian(this.userData, false).files.length > 0;
  }
}
