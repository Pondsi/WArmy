/**
 * disk-index —— **全盘后台索引**（设置 → 功能 → 全盘搜索后台索引，默认开）。
 *
 * 设计取舍：
 *   · **不跳过系统/临时文件**：所有文件的名称与路径都进索引；只是优先度不同。
 *   · 低优先度目录先只记名称，正文在后续空闲轮次补；用户仍可按名称立刻搜到。
 *   · 正文先打码再进 FTS：索引里不出现密钥明文；敏感结果的完整内容由按需扫描/悬停解密提供。
 *   · 扫描是**增量、可中断、低占空比**的后台循环，不阻塞聊天；关闭开关立即停。
 *   · 用 Node 内置 SQLite（Electron 45 的 Node 也带 FTS5），不新增原生依赖。
 *   · tokenize=unicode61+prefix（schema 2）：trigram 曾把库撑到 7GB、同步插入卡死
 *     主进程几分钟（真机事故）；中文靠前缀命中 + LIKE 兜底 + 按需扫描补完整性。
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { daMa, lieQuanPanGen, type SousuoMingzhong } from './local-search.js';

const WEN_BEN = new Set([
  '.txt', '.md', '.markdown', '.json', '.jsonl', '.csv', '.tsv', '.log', '.ini', '.cfg', '.conf',
  '.yaml', '.yml', '.toml', '.xml', '.html', '.htm', '.css', '.scss', '.js', '.mjs', '.cjs',
  '.ts', '.tsx', '.jsx', '.py', '.ps1', '.bat', '.cmd', '.sh', '.bash', '.zsh', '.sql',
  '.java', '.cs', '.cpp', '.c', '.h', '.hpp', '.go', '.rs', '.rb', '.php', '.lua', '.r',
  '.env', '.properties', '.vue', '.svelte',
]);

function panFu(p: string): string {
  const m = String(p || '').match(/^([A-Za-z]):[\\/]/);
  return m ? String(m[1]).toUpperCase() + ':' : (path.parse(String(p || '')).root || '/');
}

function youXian(p: string): number {
  const low = String(p || '').toLowerCase();
  const home = os.homedir().toLowerCase();
  if (home && low.startsWith(home)) return 0;
  if (/[\\/](desktop|documents|downloads|pictures|videos|music)[\\/]/i.test(low)) return 0;
  if (/[\\/]windows[\\/]|[\\/]winsxs[\\/]|[\\/]system32[\\/]/i.test(low)) return 4;
  if (/[\\/]program files( \(x86\))?[\\/]|[\\/]programdata[\\/]/i.test(low)) return 3;
  if (/[\\/](temp|tmp|cache|code cache|gpucache|crashpad)[\\/]/i.test(low)) return 5;
  return 2;
}

function shiWenBen(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  return WEN_BEN.has(ext) || (!ext && /^(dockerfile|makefile|readme|license|gitignore)$/i.test(name));
}

/**
 * FTS5 查询词：unicode61 下中文整串是一个 token（如「中文目录名」），
 * 只搜"大龙虾"要靠**前缀**命中 ⇒ 每个词加 `*`；token 内部截断
 * （搜"互动区"）由 name/path 的 LIKE 兜底补。
 */
function ftsQuery(q: string): string {
  return String(q || '').split(/\s+/).filter(Boolean)
    .map((w) => '"' + w.replace(/"/g, '""') + '"*')
    .join(' ');
}

/** 索引库 schema 版本：tokenize 换代就 +1，旧库整删重建（见 ensureDb） */
const SCHEMA_V = '2';

/**
 * 跳过不递归的目录（对搜索无价值，却是全盘扫描的体积大头：
 * node_modules/.git 等动辄数十万文件，逐个 statSync 会把主进程事件循环卡住）。
 */
const TIAO_GUO_MU_LU = new Set([
  'node_modules', '.git', '.svn', '.hg', '.bzr', '__pycache__',
  'code cache', 'gpucache', 'grshadercache', 'graphitedawncache', 'shadercache',
  'crashpad', 'dawnwebgpucache', 'dawngraphitecache',
]);

export class QuanPanSuoYin {
  private db: DatabaseSync | null = null;
  private running = false;
  private stopping = false;
  private enabled = true;
  private timer: NodeJS.Timeout | null = null;
  private queue: Array<{ p: string; prio: number; depth: number }> = [];
  private pendingFiles: Array<{ p: string; prio: number }> = [];
  private contentQueue: Array<{ id: number; p: string }> = [];
  private roots: string[] = [];
  private lastPath = '';
  private errors = 0;
  private seeded = false;
  private finishedWalk = false;
  private contentDone = 0;
  private fileCount = 0;
  private lastCheckpoint = 0;
  readonly dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.ensureDb();
  }

  private ensureDb(): void {
    if (this.db) return;
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    /**
     * schema=2（第 130 轮）：旧库 tokenize='trigram' 把 128KB 正文切成 12 万条
     * trigram ⇒ 库膨胀到 7GB+、同步插入慢到把主进程事件循环卡死几分钟。
     * 版本不匹配一律**整库删除重建**（索引可再生，不是用户数据），顺带回收旧体积。
     */
    try {
      if (fs.existsSync(this.dbPath)) {
        const probe = new DatabaseSync(this.dbPath);
        let v = '';
        try {
          v = String((probe.prepare("SELECT v FROM meta WHERE k='schema'").get() as { v?: string } | undefined)?.v || '');
        } catch { /* 旧库无 meta 行 = 版本 1 */ }
        try { probe.close(); } catch { /* noop */ }
        if (v !== SCHEMA_V) {
          for (const suf of ['', '-wal', '-shm']) {
            try { fs.unlinkSync(this.dbPath + suf); } catch { /* 文件占用时留到下次 */ }
          }
        }
      }
    } catch { /* 探测失败按旧库处理，不挡启动 */ }
    const db = new DatabaseSync(this.dbPath);
    db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=NORMAL;
      PRAGMA wal_autocheckpoint=0;
      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        dir TEXT NOT NULL,
        drive TEXT NOT NULL,
        ext TEXT,
        size INTEGER DEFAULT 0,
        mtime INTEGER DEFAULT 0,
        prio INTEGER DEFAULT 9,
        content_done INTEGER DEFAULT 0,
        sensitive INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_files_prio ON files(prio);
      CREATE INDEX IF NOT EXISTS idx_files_content ON files(content_done);
      CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(name, path, body, tokenize=unicode61, prefix='2 3 4');
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
    `);
    try { db.prepare('INSERT OR REPLACE INTO meta(k,v) VALUES(?,?)').run('schema', SCHEMA_V); } catch { /* noop */ }
    this.db = db;
    try {
      this.fileCount = Number((db.prepare('SELECT COUNT(*) AS n FROM files').get() as { n?: number })?.n || 0);
      this.contentDone = Number((db.prepare('SELECT COUNT(*) AS n FROM files WHERE content_done = 1').get() as { n?: number })?.n || 0);
    } catch { /* noop */ }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.stop();
    else this.start();
  }

  start(): void {
    this.ensureDb();
    if (!this.enabled || this.running) return;
    this.running = true;
    this.stopping = false;
    if (!this.roots.length) this.roots = lieQuanPanGen();
    if (!this.seeded) {
      this.seeded = true;
      for (const r of this.roots) this.queue.push({ p: r, prio: youXian(r), depth: 0 });
    }
    this.tick();
  }

  stop(): void {
    this.stopping = true;
    this.running = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  private tick(): void {
    if (!this.running || this.stopping) return;
    this.timer = setTimeout(() => {
      void (async () => {
        const t0 = Date.now();
        try {
          while (this.running && Date.now() - t0 < 25) {
            const did = await this.step();
            if (!did) break;
          }
        } catch { this.errors++; }
        /**
         * 定时 PASSIVE checkpoint（wal_autocheckpoint=0 的搭档）：
         * 自动 checkpoint 在 7GB 旧库上一触发就是同步大合并 ⇒ 主进程卡死数分钟。
         * PASSIVE 不阻塞写入方，60 秒一次把 WAL 压回主库，WAL 永远保持在几十 MB 内。
         */
        try {
          if (this.db && Date.now() - this.lastCheckpoint > 60_000) {
            this.lastCheckpoint = Date.now();
            this.db.exec('PRAGMA wal_checkpoint(PASSIVE)');
          }
        } catch { /* checkpoint 失败不影响索引 */ }
        if (this.running) this.tick();
      })();
    }, 800);
  }

  private async step(): Promise<boolean> {
    if (this.pendingFiles.length) {
      const f = this.pendingFiles.shift()!;
      await this.insertName(f.p, f.prio);
      // 文件入队与正文索引交错：名称扫得快，正文按批补（与目录扫描同节奏）
      if (this.contentQueue.length && this.fileCount % 5 === 0) {
        const c = this.contentQueue.shift()!;
        await this.indexContent(c.id, c.p);
      }
      return true;
    }
    if (this.queue.length) {
      const it = this.queue.shift()!;
      await this.walk(it);
      // 名称扫描与正文索引交错：用户主目录（最先入队）的正文能较早可搜，
      // 系统/临时目录仍按后补；不要求等整盘名称扫完。
      if (this.contentQueue.length && (this.fileCount % 3 === 0)) {
        const c = this.contentQueue.shift()!;
        await this.indexContent(c.id, c.p);
      }
      return true;
    }
    if (!this.finishedWalk) { this.finishedWalk = true; return true; }
    if (this.contentQueue.length) {
      const it = this.contentQueue.shift()!;
      await this.indexContent(it.id, it.p);
      return true;
    }
    // 名称扫描与内容队列都空：稍后再检查（可能用户新增文件；低频）
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.finishedWalk = false; this.contentQueue.length || this.queue.push(...this.roots.map((r) => ({ p: r, prio: youXian(r), depth: 0 }))); this.tick(); }, 60_000);
    return false;
  }

  private async walk(it: { p: string; prio: number; depth: number }): Promise<void> {
    let ents: fs.Dirent[];
    try { ents = await fsp.readdir(it.p, { withFileTypes: true }); } catch { this.errors++; return; }
    for (const e of ents) {
      const p = path.join(it.p, e.name);
      if (e.isSymbolicLink()) {
        // 链接文件也索引名称；链接目录不递归（防 junction 环），但目标文件本身仍可被其真实路径覆盖
        try {
          const st = await fsp.stat(p);
          if (st.isFile()) this.insertName(p, Math.max(it.prio, youXian(p)));
        } catch { /* 断链跳过 */ }
        continue;
      }
      if (e.isDirectory()) {
        if (it.depth >= 40) continue;
        const base = String(e.name).toLowerCase();
        if (TIAO_GUO_MU_LU.has(base)) continue;
        this.queue.push({ p, prio: Math.max(it.prio, youXian(p)), depth: it.depth + 1 });
      } else if (e.isFile()) {
        this.pendingFiles.push({ p, prio: Math.max(it.prio, youXian(p)) });
      }
    }
    this.lastPath = it.p;
  }

  /**
   * 单个文件入索引（**异步 stat**）：旧实现在这里 `fs.statSync`，
   * 全盘扫描时每文件一次同步系统调用 ⇒ 主进程事件循环被间歇性卡死
   * （表现：点按钮无反应、拖窗口卡顿）。SQLite 写入仍是同步的，但每次
   * 都是内存级毫秒操作；40ms/400ms 的低占空比循环保证不阻塞聊天。
   */
  private async insertName(p: string, prio: number): Promise<void> {
    if (!this.db) return;
    let st: fs.Stats;
    try { st = await fsp.stat(p); } catch { this.errors++; return; }
    if (!st.isFile()) return;
    try {
      const r = this.db.prepare(`INSERT OR IGNORE INTO files(path,name,dir,drive,ext,size,mtime,prio,content_done)
        VALUES(?,?,?,?,?,?,?,?,0)`).run(p, path.basename(p), path.dirname(p), panFu(p), path.extname(p).toLowerCase(), st.size, Math.round(st.mtimeMs), prio);
      if (Number(r.changes) > 0) {
        this.fileCount++;
        const id = Number((this.db.prepare('SELECT id FROM files WHERE path=?').get(p) as { id?: number })?.id || 0);
        if (id > 0) {
          const dm = daMa(path.basename(p) + ' ' + p);
          this.db.prepare('INSERT INTO fts(rowid,name,path,body) VALUES(?,?,?,?)').run(id, path.basename(p), p, '');
          if (dm.sensitive) this.db.prepare('UPDATE files SET sensitive=1 WHERE id=?').run(id);
          // 正文只收小文本（16KB）：大文件的 FTS 同步插入是历史卡死主因（见 indexContent）
          if (shiWenBen(path.basename(p)) && st.size <= 16 * 1024) this.contentQueue.push({ id, p });
        }
      }
    } catch { /* 单文件失败不挡整盘 */ }
  }

  private async indexContent(id: number, p: string): Promise<void> {
    if (!this.db) return;
    /**
     * 第 129 轮起防主进程卡顿：fts5 同步插入会阻塞事件循环（真机：索引到大文本
     * 文件时界面卡住几分钟）。第 130 轮再收紧到 16KB（trigram→unicode61 后单次
     * 插入快了约两个数量级，但同步性质没变，规模仍要限）。
     * 超限只索引名称不读正文；正文检索让位给名称/路径检索 + 按需扫描兜底。
     */
    try {
      const st = await fsp.stat(p);
      if (!st.isFile() || st.size > 16 * 1024) return;
    } catch { return; }
    let buf: Buffer;
    try { buf = await fsp.readFile(p); } catch { this.errors++; return; }
    const raw = buf.toString('utf8');
    if (!raw || raw.includes('\u0000')) return;
    const dm = daMa(raw);
    const body = dm.text.slice(0, 16 * 1024);
    try {
      this.db.prepare('UPDATE fts SET body=? WHERE rowid=?').run(body, id);
      this.db.prepare('UPDATE files SET content_done=1, sensitive=? WHERE id=?').run(dm.sensitive ? 1 : 0, id);
      this.contentDone++;
    } catch { /* 单文件失败不挡整盘 */ }
  }

  /** 分页搜索：先 FTS，少于 limit 时用名称 LIKE 补齐；返回是否可能还有更多 */
  search(query: string, offset = 0, limit = 20): { items: SousuoMingzhong[]; total: number; hasMore: boolean } {
    this.ensureDb();
    const q = String(query || '').trim();
    const n = Math.max(1, Math.min(50, Number(limit) || 20));
    const off = Math.max(0, Number(offset) || 0);
    if (!q) return { items: [], total: 0, hasMore: false };
    const db = this.db!;
    let rows: any[] = [];
    try {
      rows = db.prepare(`SELECT f.id,f.path,f.name,f.drive,f.sensitive,fts.body AS body
        FROM fts JOIN files f ON f.id = fts.rowid
        WHERE fts MATCH ? ORDER BY rank LIMIT ? OFFSET ?`).all(ftsQuery(q), n, off) as any[];
    } catch { rows = []; }
    if (rows.length < n) {
      try {
        const seen = new Set(rows.map((x) => x.id));
        const more = db.prepare(`SELECT f.id,f.path,f.name,f.drive,f.sensitive,fts.body AS body
          FROM files f LEFT JOIN fts ON fts.rowid=f.id
          WHERE (f.name LIKE ? OR f.path LIKE ?) ORDER BY f.prio ASC, f.id ASC LIMIT ? OFFSET ?`)
          .all('%' + q + '%', '%' + q + '%', n, off) as any[];
        for (const x of more) if (!seen.has(x.id)) { rows.push(x); if (rows.length >= n) break; }
      } catch { /* noop */ }
    }
    const items = rows.map((x) => {
      const body = String(x.body || '');
      const low = body.toLowerCase();
      const at = low.indexOf(q.toLowerCase());
      let snip = '';
      if (at >= 0) {
        const a = Math.max(0, at - 100);
        snip = body.slice(a, Math.min(body.length, at + q.length + 220)).replace(/\s+/g, ' ').trim();
      }
      if (!snip) snip = body ? body.replace(/\s+/g, ' ').slice(0, 260) : String(x.name || '');
      return {
        section: 'disk' as const,
        title: String(x.name || path.basename(String(x.path || ''))),
        snippet: snip,
        meta: String(x.drive || panFu(String(x.path || ''))) + ' · ' + String(x.path || ''),
        path: String(x.path || ''),
        drive: String(x.drive || panFu(String(x.path || ''))),
        sensitive: !!x.sensitive,
      };
    });
    let total = items.length;
    try { total = Number((db.prepare('SELECT COUNT(*) AS n FROM files WHERE name LIKE ? OR path LIKE ?').get('%' + q + '%', '%' + q + '%') as { n?: number })?.n || items.length); } catch { /* noop */ }
    return { items, total, hasMore: off + items.length < total || this.running };
  }

  stats(): { files: number; content: number; running: boolean; roots: string[]; lastPath: string; errors: number; enabled: boolean } {
    this.ensureDb();
    try {
      this.fileCount = Number((this.db!.prepare('SELECT COUNT(*) AS n FROM files').get() as { n?: number })?.n || this.fileCount);
      this.contentDone = Number((this.db!.prepare('SELECT COUNT(*) AS n FROM files WHERE content_done=1').get() as { n?: number })?.n || this.contentDone);
    } catch { /* noop */ }
    return { files: this.fileCount, content: this.contentDone, running: this.running, roots: this.roots, lastPath: this.lastPath, errors: this.errors, enabled: this.enabled };
  }
}

export function moRenSuoYinLu(userData: string): string {
  return path.join(userData, 'search-index', 'full-disk.sqlite');
}
