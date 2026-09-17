/**
 * Spike 2 child: 长驻 better-sqlite3 子进程
 * .node 仅在本进程加载，满足「零原生模块」主进程边界
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let Database = null;
let db = null;

function ensureDb(dbPath) {
  if (db) return;
  Database = require('better-sqlite3');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
}

function seedFts(database, rows) {
  database.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(body, tokenize='unicode61');`);
  const insF = database.prepare('INSERT INTO docs_fts (rowid, body) VALUES (?, ?)');
  const txF = database.transaction(() => {
    for (let i = 1; i <= rows; i++) {
      const raw = `这是第${i}条记录 关于项目进度 与无限牛马协作 的说明`;
      insF.run(i, Array.from(raw).join(' '));
    }
  });
  txF();
}

process.on('message', (msg) => {
  const { id, op } = msg;
  try {
    if (op === 'init') {
      ensureDb(msg.dbPath);
      db.exec(`
        CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
      `);
      const ins = db.prepare('INSERT OR IGNORE INTO kv (k,v) VALUES (?,?)');
      const tx = db.transaction(() => {
        for (let i = 0; i < 1000; i++) ins.run(`k${i}`, `v${i}`);
      });
      tx();

      const rows = msg.ftsRows ?? 10000;
      const t0 = Date.now();
      seedFts(db, rows);
      process.send({ id, ok: true, ftsRows: rows, seedMs: Date.now() - t0 });
      return;
    }

    // 重建 FTS 索引到指定规模（用于按 ADR 的 10 万条记录口径重测）
    if (op === 'reseed-fts') {
      const rows = msg.ftsRows ?? 100000;
      db.exec('DROP TABLE IF EXISTS docs_fts');
      const t0 = Date.now();
      seedFts(db, rows);
      const count = db.prepare('SELECT count(*) AS c FROM docs_fts').get().c;
      process.send({ id, ok: true, ftsRows: rows, actualRows: count, seedMs: Date.now() - t0 });
      return;
    }

    if (op === 'hash') {
      const row = db.prepare('SELECT v FROM kv WHERE k = ?').get(msg.key);
      process.send({ id, ok: true, v: row?.v });
      return;
    }

    if (op === 'fts') {
      const phrase = Array.from(msg.q).join(' ');
      const rows = db.prepare(
        "SELECT rowid FROM docs_fts WHERE docs_fts MATCH ? LIMIT 5"
      ).all(`"${phrase}"`);
      process.send({ id, ok: true, hits: rows.length });
      return;
    }

    if (op === 'close') {
      db?.close();
      db = null;
      process.send({ id, ok: true });
      return;
    }

    process.send({ id, error: `unknown op ${op}` });
  } catch (e) {
    process.send({ id, error: String(e && e.message ? e.message : e) });
  }
});
