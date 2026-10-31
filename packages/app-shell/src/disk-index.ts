/**
 * disk-index —— **全盘后台索引**（设置 → 功能 → 全盘搜索后台索引，默认开）。
 *
 * 设计取舍：
 *   · **不跳过系统/临时文件**：所有文件的名称与路径都进索引；只是优先度不同。
 *   · 低优先度目录先只记名称，正文在后续空闲轮次补；用户仍可按名称立刻搜到。
 *   · 正文先打码再进 FTS：索引里不出现密钥明文；敏感结果的完整内容由按需扫描/悬停解密提供。
 *   · 扫描是**增量、可中断、低占空比**的后台循环，不阻塞聊天；关闭开关立即停。
 *   · 用 Node 内置 SQLite（Electron 45 的 Node 也带 FTS5），不新增原生依赖。
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

function ftsQuery(q: string): string {
  return '"' + String(q || '').replace(/"/g, '""') + '"';
}

export class QuanPanSuoYin {
  private db: DatabaseSync | null = null;
  private running = false;
  private stopping = false;
  private enabled = true;
  private timer: NodeJS.Timeout | null = null;
  private queue: Array<{ p: string; prio: number; depth: number }> = [];
  private contentQueue: Array<{ id: number; p: string }> = [];
  private roots: string[] = [];
  private lastPath = '';
  private errors = 0;
  private seeded = false;
  private finishedWalk = false;
  private contentDone = 0;
  private fileCount = 0;
  readonly dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.ensureDb();
  }

  private ensureDb(): void {
    if (this.db) return;
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    const db = new DatabaseSync(this.dbPath);
    db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=NORMAL;
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
      CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(name, path, body, tokenize='trigram');
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
    `);
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
          while (this.running && Date.now() - t0 < 40) {
            const did = await this.step();
            if (!did) break;
          }
        } catch { this.errors++; }
        if (this.running) this.tick();
      })();
    }, 400);
  }

  private async step(): Promise<boolean> {
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
        try { if (fs.statSync(p).isFile()) this.insertName(p, Math.max(it.prio, youXian(p))); } catch { /* 断链跳过 */ }
        continue;
      }
      if (e.isDirectory()) {
        if (it.depth < 40) this.queue.push({ p, prio: Math.max(it.prio, youXian(p)), depth: it.depth + 1 });
      } else if (e.isFile()) {
        this.insertName(p, Math.max(it.prio, youXian(p)));
      }
    }
    this.lastPath = it.p;
  }

  private insertName(p: string, prio: number): void {
    if (!this.db) return;
    let st: fs.Stats;
    try { st = fs.statSync(p); } catch { this.errors++; return; }
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
          if (shiWenBen(path.basename(p)) && st.size <= 512 * 1024 && prio <= 2) this.contentQueue.push({ id, p });
          else if (shiWenBen(path.basename(p)) && st.size <= 512 * 1024) this.contentQueue.push({ id, p });
        }
      }
    } catch { /* 单文件失败不挡整盘 */ }
  }

  private async indexContent(id: number, p: string): Promise<void> {
    if (!this.db) return;
    let buf: Buffer;
    try { buf = await fsp.readFile(p); } catch { this.errors++; return; }
    const raw = buf.toString('utf8');
    if (!raw || raw.includes('\u0000')) return;
    const dm = daMa(raw);
    const body = dm.text.slice(0, 600 * 1024);
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
