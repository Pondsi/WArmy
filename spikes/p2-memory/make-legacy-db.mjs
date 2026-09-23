/**
 * 旧库复刻器：按"改造前"的 memory-os 投影层 DDL 与写入路径造一个真实的老库。
 *
 * 改造前的投影层只有三张东西（见 git 历史里的 packages/memory-os/src/index.ts）：
 *   CREATE TABLE records (seq INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL,
 *                         session_id TEXT NOT NULL, kind TEXT NOT NULL, ts INTEGER NOT NULL, ti TEXT NOT NULL);
 *   CREATE VIRTUAL TABLE fts_uni USING fts5(ti, tokenize='unicode61', content='records', content_rowid='seq');
 *   CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT);
 * 写入时 fts_uni 存的是"字符间插空格"的 ti，meta 只写 last_seq，没有 fts_tri / 没有 vec_index /
 * 没有 schema_version / 没有 group_id、entity_type 列。
 *
 * 本脚本逐字复刻这套 DDL 与写入 SQL（含 spaceChars），生成一个升级前状态的 dataDir，
 * 供 run.mjs 验证"旧库平滑加上 fts_tri"。
 *
 * 用法：node make-legacy-db.mjs <dataDir>  (stdout: JSON 摘要)
 */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

/** 与改造前 index.ts 完全一致的实现 */
function spaceChars(s) {
  return Array.from(s)
    .map((ch) => (/\s/.test(ch) ? ' ' : ch))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const LEGACY_DDL = `
  CREATE TABLE IF NOT EXISTS records (
    seq INTEGER PRIMARY KEY,
    id TEXT UNIQUE NOT NULL,
    session_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    ts INTEGER NOT NULL,
    ti TEXT NOT NULL
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS fts_uni USING fts5(ti, tokenize='unicode61', content='records', content_rowid='seq');
  CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
`;

const LEGACY_RECORDS = [
  { id: 'legacy-1', sessionId: 's-old', kind: 'message', ti: '无限牛马项目进度正常，值班者状态机已上线' },
  { id: 'legacy-2', sessionId: 's-old', kind: 'message', ti: '错误码 E_MEMORY_CORRUPT 表示 SQLite 投影损坏' },
  { id: 'legacy-3', sessionId: 's-old', kind: 'message', ti: '实现文件 packages/memory-os/src/index.ts 新增三元索引' },
  { id: 'legacy-4', sessionId: 's-old', kind: 'message', ti: '多智能体群聊桌面应用的记忆层采用双层设计' },
];

export function makeLegacyDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'memory.db');
  const jsonlPath = path.join(dataDir, 'fast-memory.jsonl');
  fs.rmSync(dbPath, { force: true });
  fs.rmSync(jsonlPath, { force: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(LEGACY_DDL);

  const lines = [];
  const insR = db.prepare('INSERT OR REPLACE INTO records (seq, id, session_id, kind, ts, ti) VALUES (?,?,?,?,?,?)');
  const insF = db.prepare('INSERT OR REPLACE INTO fts_uni (rowid, ti) VALUES (?, ?)');
  const tx = db.transaction(() => {
    LEGACY_RECORDS.forEach((r, i) => {
      const seq = i + 1;
      const full = { ...r, seq, ts: Date.now() - (LEGACY_RECORDS.length - i) * 1000 };
      lines.push(JSON.stringify(full));
      insR.run(seq, r.id, r.sessionId, r.kind, full.ts, r.ti);
      insF.run(seq, spaceChars(r.ti));
    });
    db.prepare("INSERT OR REPLACE INTO meta (k,v) VALUES ('last_seq', ?)").run(String(LEGACY_RECORDS.length));
  });
  tx();
  fs.writeFileSync(jsonlPath, lines.join('\n') + '\n', 'utf8');
  db.close();

  return {
    dbPath,
    jsonlPath,
    tables: listTables(dbPath),
    recordCount: LEGACY_RECORDS.length,
    hasFtsTri: listTables(dbPath).includes('fts_tri'),
    hasVecIndex: listTables(dbPath).includes('vec_index'),
    recordsColumns: listColumns(dbPath, 'records'),
    metaKeys: readMeta(dbPath).map((r) => r.k),
    jsonlSha: hashFile(jsonlPath),
  };
}

function listTables(dbPath) {
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare("SELECT ming FROM sqlite_master WHERE type='table' ORDER BY ming").all().map((r) => r.name);
  db.close();
  return rows;
}

function listColumns(dbPath, table) {
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name);
  db.close();
  return rows;
}

function readMeta(dbPath) {
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare('SELECT k, v FROM meta').all();
  db.close();
  return rows;
}

export function hashFile(p) {
  const buf = fs.readFileSync(p);
  let h = 0;
  for (const b of buf) h = (h * 31 + b) >>> 0;
  return { sha1Simple: h.toString(16), bytes: buf.length };
}

if (process.argv[1] && process.argv[1].endsWith('make-legacy-db.mjs')) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: node make-legacy-db.mjs <dataDir>');
    process.exit(2);
  }
  console.log(JSON.stringify(makeLegacyDb(dir), null, 2));
}
