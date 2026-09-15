/**
 * @ccarmy/memory-os — L2 记忆服务（长驻子进程）
 *
 * 铁律：
 * - better-sqlite3 仅在本子进程加载 .node
 * - JSONL 只追加，是唯一事实来源
 * - 写入者唯一：fast-memory / queue / SQLite 各有专属 writer
 * - FTS5 CJK：字符插空格 + 短语 MATCH
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);

export type Writer = 'duty' | 'router' | 'memory-service' | 'executor';

export interface JsonlRecord {
  seq: number;
  ts: number;
  sessionId: string;
  kind: string;
  id: string;
  [k: string]: unknown;
}

export interface RecallCard {
  seq: number;
  recordId: string;
  snippet: string;
  score: number;
  source: 'fts_uni' | 'fts_tri' | 'fused';
}

/** CJK/字母数字字符间插空格，保证 unicode61 可单字索引 */
export function spaceChars(s: string): string {
  return Array.from(s)
    .map((ch) => (/\s/.test(ch) ? ' ' : ch))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function toPhrase(q: string): string {
  return `"${spaceChars(q)}"`;
}

export interface MemoryOsOptions {
  /** 数据目录 */
  dataDir: string;
  /** JSONL 日志文件名，默认 fast-memory.jsonl */
  jsonlName?: string;
}

/**
 * 记忆服务核心。应作为长驻子进程运行（见 startMemoryService）。
 */
export class MemoryService {
  private db: any;
  private seq = 0;
  readonly jsonlPath: string;
  readonly dbPath: string;

  constructor(private opts: MemoryOsOptions) {
    fs.mkdirSync(opts.dataDir, { recursive: true });
    this.jsonlPath = path.join(opts.dataDir, opts.jsonlName || 'fast-memory.jsonl');
    this.dbPath = path.join(opts.dataDir, 'memory.db');
    const Database = require('better-sqlite3');
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS records (
        seq INTEGER PRIMARY KEY,
        id TEXT UNIQUE NOT NULL,
        session_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        ts INTEGER NOT NULL,
        body TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS fts_uni USING fts5(body, tokenize='unicode61', content='records', content_rowid='seq');
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
    `);
    const row = this.db.prepare("SELECT v FROM meta WHERE k='last_seq'").get();
    this.seq = row ? Number(row.v) : 0;
    this.rebuildFtsFromJsonl();
  }

  /** 只追加写入 JSONL + 投影到 SQLite */
  append(
    record: { id: string; sessionId: string; kind: string; [k: string]: unknown },
    writer: Writer
  ): JsonlRecord {
    // 写入者唯一约束（简化：duty 写 message；router 写 queue；其余拒绝）
    if (record.kind === 'queue' && writer !== 'router') {
      throw Object.assign(new Error('queue.jsonl writer must be router'), { code: 'WRITER' });
    }
    if (record.kind === 'message' && writer === 'executor') {
      // 执行者只回传蒸馏，不直接写 message 流
      throw Object.assign(new Error('executor cannot write message records'), { code: 'WRITER' });
    }

    const seq = ++this.seq;
    const full: JsonlRecord = {
      ...record,
      seq,
      ts: Date.now(),
      id: record.id,
      sessionId: record.sessionId,
      kind: record.kind,
    };
    const line = JSON.stringify(full) + '\n';
    fs.appendFileSync(this.jsonlPath, line, 'utf8');

    const body = String(full.body ?? full.content ?? full.text ?? JSON.stringify(full));
    this.db
      .prepare(
        'INSERT OR REPLACE INTO records (seq, id, session_id, kind, ts, body) VALUES (?,?,?,?,?,?)'
      )
      .run(seq, full.id, full.sessionId, full.kind, full.ts, body);
    this.db
      .prepare('INSERT OR REPLACE INTO fts_uni (rowid, body) VALUES (?, ?)')
      .run(seq, spaceChars(body));
    this.db.prepare("INSERT OR REPLACE INTO meta (k,v) VALUES ('last_seq', ?)").run(String(seq));
    return full;
  }

  tail(limit = 50): JsonlRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM records ORDER BY seq DESC LIMIT ?')
      .all(limit) as Array<{ seq: number; ts: number; session_id: string; kind: string; id: string; body: string }>;
    return rows.map((r) => ({
      seq: r.seq,
      ts: r.ts,
      sessionId: r.session_id,
      kind: r.kind,
      id: r.id,
      body: r.body,
    }));
  }

  /** recall：FTS 发现 → 索引卡 */
  recall(query: string, limit = 10): RecallCard[] {
    const phrase = toPhrase(query);
    let rows = this.db
      .prepare(
        `SELECT r.seq, r.id, r.body FROM fts_uni f JOIN records r ON r.seq = f.rowid
         WHERE fts_uni MATCH ? ORDER BY rank LIMIT ?`
      )
      .all(phrase, limit) as Array<{ seq: number; id: string; body: string }>;
    if (!rows.length) {
      // LIKE 兜底（1–2 字 CJK）
      const like = `%${query}%`;
      rows = this.db
        .prepare(
          `SELECT seq, id, body FROM records WHERE body LIKE ? ORDER BY seq DESC LIMIT ?`
        )
        .all(like, limit);
    }
    return rows.map((r) => ({
      seq: r.seq,
      recordId: r.id,
      snippet: r.body.slice(0, 200),
      score: 1,
      source: 'fts_uni' as const,
    }));
  }

  /** retrieve：按 anchor 取回原文 */
  retrieve(anchor: { seq?: number; recordId?: string }): { raw: string; seq: number } | null {
    const row = anchor.recordId
      ? this.db.prepare('SELECT seq, body FROM records WHERE id = ?').get(anchor.recordId)
      : this.db.prepare('SELECT seq, body FROM records WHERE seq = ?').get(anchor.seq);
    if (!row) return null;
    return { raw: String(row.body), seq: Number(row.seq) };
  }

  /** 从 JSONL 全量重建 SQLite 投影 */
  rebuildProjection(): number {
    this.db.exec('DELETE FROM records; DELETE FROM fts_uni;');
    if (!fs.existsSync(this.jsonlPath)) return 0;
    const lines = fs.readFileSync(this.jsonlPath, 'utf8').split('\n').filter(Boolean);
    const ins = this.db.prepare(
      'INSERT OR REPLACE INTO records (seq, id, session_id, kind, ts, body) VALUES (?,?,?,?,?,?)'
    );
    const insF = this.db.prepare('INSERT OR REPLACE INTO fts_uni (rowid, body) VALUES (?, ?)');
    const tx = this.db.transaction(() => {
      for (const line of lines) {
        const r = JSON.parse(line) as JsonlRecord;
        const body = String(r.body ?? r.content ?? r.text ?? line);
        ins.run(r.seq, r.id, r.sessionId, r.kind, r.ts, body);
        insF.run(r.seq, spaceChars(body));
        if (r.seq > this.seq) this.seq = r.seq;
      }
    });
    tx();
    this.db.prepare("INSERT OR REPLACE INTO meta (k,v) VALUES ('last_seq', ?)").run(String(this.seq));
    return lines.length;
  }

  private rebuildFtsFromJsonl(): void {
    // 冷启动：若 fts 空但 records 有数据则重建
    const c = this.db.prepare('SELECT COUNT(*) AS n FROM fts_uni').get() as { n: number };
    if (c.n === 0) {
      const r = this.db.prepare('SELECT COUNT(*) AS n FROM records').get() as { n: number };
      if (r.n > 0) {
        const rows = this.db.prepare('SELECT seq, body FROM records').all() as Array<{ seq: number; body: string }>;
        const ins = this.db.prepare('INSERT OR REPLACE INTO fts_uni (rowid, body) VALUES (?, ?)');
        const tx = this.db.transaction(() => {
          for (const row of rows) ins.run(row.seq, spaceChars(String(row.body)));
        });
        tx();
      }
    }
  }

  close(): void {
    this.db?.close();
  }
}

/** IPC 子进程入口（pnpm --filter @ccarmy/memory-os start） */
export function startMemoryServiceIpc(dataDir: string): MemoryService {
  const svc = new MemoryService({ dataDir });
  process.send?.({ type: 'ready', pid: process.pid, dataDir });
  process.on('message', (msg: any) => {
    const { id, op } = msg || {};
    try {
      if (op === 'append') {
        const rec = svc.append(msg.record, msg.writer || 'memory-service');
        process.send?.({ id, ok: true, seq: rec.seq });
        return;
      }
      if (op === 'tail') {
        process.send?.({ id, ok: true, records: svc.tail(msg.limit) });
        return;
      }
      if (op === 'recall') {
        process.send?.({ id, ok: true, cards: svc.recall(msg.query, msg.limit) });
        return;
      }
      if (op === 'retrieve') {
        process.send?.({ id, ok: true, result: svc.retrieve(msg.anchor) });
        return;
      }
      if (op === 'rebuild') {
        process.send?.({ id, ok: true, count: svc.rebuildProjection() });
        return;
      }
      if (op === 'shutdown') {
        svc.close();
        process.send?.({ id, ok: true });
        setTimeout(() => process.exit(0), 20);
        return;
      }
      process.send?.({ id, error: `unknown op ${op}` });
    } catch (e: any) {
      process.send?.({ id, error: String(e?.message || e), code: e?.code });
    }
  });
  return svc;
}
