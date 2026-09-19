/**
 * @warmy/memory-os — L2 记忆服务（长驻子进程）
 *
 * 铁律：
 * - better-sqlite3 仅在本子进程加载 .node（不变量 #4：Electron 主/渲染进程零原生模块）
 * - JSONL 只追加，是唯一事实来源（#1）；SQLite 是可丢弃、可全量重建的投影（#5）
 * - 写入者唯一：fast-memory / queue / SQLite 各有专属 writer（#6）
 * - 权限过滤先于相关性检索（#9）：作用域先筛出授权 seq 集合，再对授权集合做相关性排序
 *
 * 深度层（ADR §3.2 L2）三路召回：
 *   fts_uni  CJK 字符间插空格 → 单字索引，短语查询覆盖 1–2 字词
 *   fts_tri  trigram → ASCII 标识符 / 错误码 / 路径 / ≥3 字 CJK 子串
 *   vector   bge-small-zh-v1.5 int8(512d) BLOB → 授权集合内算余弦
 *   三路 → RRF 融合 → 索引卡；recall 负责发现，retrieve 负责解引用（三级回退）
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { encodeVector, cosineInt8, normalizeCosine, rrfFusionRanked, unpackInt8 } from './vectors.js';
import type { RankedList, FusedHit } from './vectors.js';
import { OnnxEmbedder, defaultModelCandidates, ortSearchCandidates } from './embedder.js';
import type { VectorStatus } from './embedder.js';

const require = createRequire(import.meta.url);

export type Writer = 'duty' | 'router' | 'memory-service' | 'executor';

/** 投影 schema 版本：2 = 增加 fts_tri + vec_index + 作用域列 */
export const SCHEMA_VERSION = 2;

/** fts_tri（trigram）最小可查长度（FTS5 trigram 需要 ≥3 个字符） */
export const TRI_MIN_CHARS = 3;

export interface JsonlRecord {
  seq: number;
  ts: number;
  sessionId: string;
  kind: string;
  id: string;
  [k: string]: unknown;
}

export type RecallSource = 'fts_uni' | 'fts_tri' | 'vector' | 'fused';

export interface RecallScope {
  sessionId?: string;
  groupId?: string;
  entityType?: string;
  kind?: string;
}

export interface RecallCard {
  seq: number;
  recordId: string;
  snippet: string;
  score: number;
  source: RecallSource;
  /** 命中该证据的通道列表（RRF 融合前） */
  sources: RecallSource[];
  /** 各通道内排名（1-based） */
  ranks: Partial<Record<RecallSource, number>>;
  /** 该卡片的主命中级别（=source，便于 UI 直读） */
  hitLevel: RecallSource;
  /** RRF 原始分 */
  rrfScore: number;
  /** 向量通道命中的余弦（未命中向量通道则缺省） */
  cosine?: number;
  /** 可回原文的证据锚点 */
  anchor: EvidenceAnchor;
}

export interface EvidenceAnchor {
  /** JSONL 文件名（相对 dataDir） */
  file: string;
  seq: number;
  recordId: string;
  byteOffset?: number;
}

export interface QueryLike {
  query: string;
  scope?: RecallScope;
  limit?: number;
}

export interface RecallOptions {
  scope?: RecallScope;
  limit?: number;
  /** 每通道候选数，默认 max(limit*3, 20) */
  perChannel?: number;
  /** RRF k，默认 60 */
  k?: number;
  /** 是否启用向量通道（默认 true，无嵌入器时自动跳过） */
  useVector?: boolean;
  /** 是否在查询前补齐缺失向量（仅 async 路径；默认 true） */
  hydrate?: boolean;
  /** 补齐上限，默认 256 */
  hydrateBudget?: number;
  /** 向量通道余弦下限，覆盖 VectorOptions.minCosine */
  minCosine?: number;
}

export interface ScopeStats {
  scopeActive: boolean;
  predicate: string;
  /** 授权集合落地的 TEMP 表名（按 scope 取键，避免并发查询互相覆盖） */
  table: string | null;
  totalRecords: number;
  authorizedRecords: number;
  deniedRecords: number;
}

export interface RecallTimings {
  totalMs: number;
  hydrateMs: number;
  embedQueryMs: number;
  uniMs: number;
  triMs: number;
  vecMs: number;
  fuseMs: number;
  /** 向量通道实际算过余弦的行数（= 授权集合内已建向量的行数） */
  cosines: number;
  /** 本次补齐的向量条数 */
  hydrated: number;
  /** 被 minCosine 挡掉的条数 */
  vectorBelowThreshold?: number;
  /** 查询词元的 [UNK] 占比（跳过向量通道时用来解释原因） */
  vectorUnkRatio?: number | null;
}

export interface ChannelReport {
  channel: 'fts_uni' | 'fts_tri' | 'vector' | 'like';
  used: boolean;
  skipped?: string;
  hits: number;
  ms: number;
}

export interface RecallDetail {
  cards: RecallCard[];
  timings: RecallTimings;
  scopeStats: ScopeStats;
  channels: ChannelReport[];
  /** 用到的命中级别集合 */
  levels: RecallSource[];
  candidates: { uni: number; tri: number; vector: number; fused: number };
}

export interface RetrieveLevel {
  hitLevel: 'exact' | 'nearby' | 'fuzzy';
}

export interface RetrieveOutcome {
  /** 原文 */
  raw: string;
  seq: number;
  recordId: string;
  /** 命中级别 */
  hitLevel: 'exact' | 'nearby' | 'fuzzy';
  /** 具体命中方式 */
  via: string;
  anchor: EvidenceAnchor;
  /** 人类可读说明（分级回退时记录了上一级为何失败） */
  note?: string;
}

export interface RetrieveOptions {
  fallback?: 'exact' | 'nearby' | 'fuzzy';
  /** nearby 级别的 seq 邻域半径，默认 5 */
  window?: number;
  /** fuzzy 级别的检索串（缺省时用 anchor.recordId） */
  query?: string;
}

export interface VectorOptions {
  enabled?: boolean;
  modelPath?: string;
  tokenizerPath?: string;
  ortSearchPaths?: string[];
  threads?: number;
  maxLength?: number;
  /** 单条记录参与嵌入的字符上限，默认 512 */
  maxEmbedChars?: number;
  queryPrefix?: string;
  /**
   * 向量通道余弦下限，默认 0.5。
   * 稠密检索永远会返回"最近的 k 条"，没有地板的话一个乱码查询也会返回一堆噪声
   * （实测语料上乱码查询 top1 余弦 0.447，真实语义查询 top1 0.68 —— 0.5 是实测分界）。
   */
  minCosine?: number;
  /** query 的分词 [UNK] 占比超过该值时跳过向量通道（默认 0.5，稠密向量此时不可信） */
  maxUnkRatio?: number;
}

export interface MemoryOsOptions {
  /** 数据目录 */
  dataDir: string;
  /** JSONL 日志文件名，默认 fast-memory.jsonl */
  jsonlName?: string;
  /** 向量/嵌入配置 */
  vector?: VectorOptions;
}

export interface UpgradeReport {
  schemaVersionBefore: number;
  schemaVersionAfter: number;
  hadFtsUni: boolean;
  hadFtsTri: boolean;
  createdFtsTri: boolean;
  addedColumns: string[];
  backfilledTriRows: number;
  backfilledUniRows: number;
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

/** trigram 查询串：整体加引号，内部双引号按 FTS5 规则转义为两个 */
export function toTriPhrase(q: string): string {
  return `"${q.replace(/"/g, '""')}"`;
}

/** FTS5 trigram 只对 ≥3 个字符的查询有结果 */
export function triQueryable(q: string): boolean {
  return Array.from(q.trim()).length >= TRI_MIN_CHARS;
}

const SQL_RECORDS = `
  CREATE TABLE IF NOT EXISTS records (
    seq INTEGER PRIMARY KEY,
    id TEXT UNIQUE NOT NULL,
    session_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    ts INTEGER NOT NULL,
    body TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
  CREATE TABLE IF NOT EXISTS vec_index (
    seq INTEGER PRIMARY KEY,
    dim INTEGER NOT NULL,
    scale REAL NOT NULL,
    data BLOB NOT NULL
  );
`;
const SQL_FTS_UNI = `CREATE VIRTUAL TABLE IF NOT EXISTS fts_uni USING fts5(body, tokenize='unicode61', content='records', content_rowid='seq');`;
const SQL_FTS_TRI = `CREATE VIRTUAL TABLE IF NOT EXISTS fts_tri USING fts5(body, tokenize='trigram', content='records', content_rowid='seq');`;

/**
 * 记忆服务核心。应作为长驻子进程运行（见 startMemoryServiceIpc）。
 */
export class MemoryService {
  private db: any;
  private seq = 0;
  readonly jsonlPath: string;
  readonly dbPath: string;
  readonly upgrade: UpgradeReport;
  /** 冷启动重建报告（DB 丢了但 JSONL 还在 → 全量重建投影，不变量 #5） */
  readonly coldStart: { rebuilt: boolean; lines: number; reason: string };

  private vectorPromise: Promise<void>;
  private embedder: OnnxEmbedder | null = null;
  private vectorInitError = '';
  private vectorTried: string[] = [];
  private queryVecCache = new Map<string, Float32Array>();
  private closed = false;
  private jsonlIndex: JsonlIndex | null = null;

  constructor(private opts: MemoryOsOptions) {
    fs.mkdirSync(opts.dataDir, { recursive: true });
    this.jsonlPath = path.join(opts.dataDir, opts.jsonlName || 'fast-memory.jsonl');
    this.dbPath = path.join(opts.dataDir, 'memory.db');
    const Database = require('better-sqlite3');
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SQL_RECORDS);
    this.upgrade = this.ensureSchema();
    const row = this.db.prepare("SELECT v FROM meta WHERE k='last_seq'").get();
    this.seq = row ? Number(row.v) : 0;
    this.coldStart = this.coldStartRebuild();
    this.backfillFtsFromRecords(this.upgrade);
    this.vectorPromise = this.initVector();
  }

  // ─────────────────────────────────────────────
  // schema：建表 + 旧库升级
  // ─────────────────────────────────────────────

  private tableExists(name: string): boolean {
    const r = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
    return !!r;
  }

  private columns(table: string): string[] {
    return (this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((r) => r.name);
  }

  private addColumnIfMissing(table: string, col: string, type: string, added: string[]): void {
    if (this.columns(table).includes(col)) return;
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
    added.push(`${table}.${col}`);
  }

  /**
   * 建表与升级。老库（只有 fts_uni）在这里平滑加上 fts_tri / vec_index / 作用域列，
   * 不改 JSONL、不删数据（不变量 #5：投影可丢弃、可重建）。
   */
  private ensureSchema(): UpgradeReport {
    const metaRow = this.tableExists('meta') ? (this.db.prepare("SELECT v FROM meta WHERE k='schema_version'").get() as { v?: string } | undefined) : undefined;
    const schemaVersionBefore = metaRow?.v ? Number(metaRow.v) : 0;

    const hadFtsUni = this.tableExists('fts_uni');
    const hadFtsTri = this.tableExists('fts_tri');

    const added: string[] = [];
    this.addColumnIfMissing('records', 'group_id', 'TEXT', added);
    this.addColumnIfMissing('records', 'entity_type', 'TEXT', added);

    this.db.exec(SQL_FTS_UNI);
    // 旧库升级路径：把 fts_tri 真正建出来（此前只有注释和类型）
    this.db.exec(SQL_FTS_TRI);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_records_session ON records(session_id);
      CREATE INDEX IF NOT EXISTS idx_records_kind ON records(kind);
      CREATE INDEX IF NOT EXISTS idx_records_group ON records(group_id);
    `);
    this.db.prepare("INSERT OR REPLACE INTO meta (k,v) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION));

    return {
      schemaVersionBefore,
      schemaVersionAfter: SCHEMA_VERSION,
      hadFtsUni,
      hadFtsTri,
      createdFtsTri: !hadFtsTri,
      addedColumns: added,
      backfilledTriRows: 0,
      backfilledUniRows: 0,
    };
  }

  /**
   * 冷启动 / 旧库升级：FTS 索引为空但 records 有数据时按 records 重建。
   * fts_uni 插空格文本（单字索引），fts_tri 插原文（trigram 才能覆盖 ASCII 与长 CJK 子串）。
   *
   * 注意：不能拿 fts_*_data 的行数判断"索引是否为空"——空 fts5 表也有结构行。
   */
  private backfillFtsFromRecords(up: UpgradeReport): void {
    const recN = (this.db.prepare('SELECT COUNT(*) AS n FROM records').get() as { n: number }).n;
    if (!recN) return;
    const needUni = !up.hadFtsUni || this.indexedDocs('fts_uni') === 0;
    const needTri = up.createdFtsTri || this.indexedDocs('fts_tri') === 0;
    if (!needUni && !needTri) return;

    const rows = this.db.prepare('SELECT seq, body FROM records').all() as Array<{ seq: number; body: string }>;
    if (needUni) {
      const ins = this.db.prepare('INSERT OR REPLACE INTO fts_uni (rowid, body) VALUES (?, ?)');
      const tx = this.db.transaction(() => {
        for (const row of rows) ins.run(row.seq, spaceChars(String(row.body)));
      });
      tx();
      up.backfilledUniRows = rows.length;
    }
    if (needTri) {
      const ins = this.db.prepare('INSERT OR REPLACE INTO fts_tri (rowid, body) VALUES (?, ?)');
      const tx = this.db.transaction(() => {
        for (const row of rows) ins.run(row.seq, String(row.body));
      });
      tx();
      up.backfilledTriRows = rows.length;
    }
    this.db.prepare("INSERT OR REPLACE INTO meta (k,v) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION));
  }

  /**
   * 不变量 #5：SQLite 是可丢弃投影。库被删/被清空但 JSONL 还在 → 从 JSONL 全量重建。
   * 这是"删掉 memory.db 重启后照样检索"的实现依据。
   */
  private coldStartRebuild(): { rebuilt: boolean; lines: number; reason: string } {
    const recN = (this.db.prepare('SELECT COUNT(*) AS n FROM records').get() as { n: number }).n;
    if (recN > 0) return { rebuilt: false, lines: recN, reason: 'projection present' };
    if (!fs.existsSync(this.jsonlPath)) return { rebuilt: false, lines: 0, reason: 'no jsonl' };
    const size = fs.statSync(this.jsonlPath).size;
    if (size === 0) return { rebuilt: false, lines: 0, reason: 'jsonl empty' };
    const n = this.rebuildProjection();
    return { rebuilt: true, lines: n, reason: 'projection missing, rebuilt from jsonl' };
  }

  // ─────────────────────────────────────────────
  // 写入（JSONL 唯一事实来源 + 三路投影）
  // ─────────────────────────────────────────────

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
        'INSERT OR REPLACE INTO records (seq, id, session_id, kind, ts, body, group_id, entity_type) VALUES (?,?,?,?,?,?,?,?)'
      )
      .run(
        seq,
        full.id,
        full.sessionId,
        full.kind,
        full.ts,
        body,
        (full.groupId as string) ?? null,
        (full.entityType as string) ?? null
      );
    this.db.prepare('INSERT OR REPLACE INTO fts_uni (rowid, body) VALUES (?, ?)').run(seq, spaceChars(body));
    // fts_tri 索引进原文（不插空格），trigram 才能覆盖 ASCII 标识符/路径与 ≥3 字 CJK 子串
    this.db.prepare('INSERT OR REPLACE INTO fts_tri (rowid, body) VALUES (?, ?)').run(seq, body);
    this.db.prepare("INSERT OR REPLACE INTO meta (k,v) VALUES ('last_seq', ?)").run(String(seq));
    this.jsonlIndex = null;
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

  // ─────────────────────────────────────────────
  // 权限过滤先于相关性检索（不变量 #9）
  // ─────────────────────────────────────────────

  private scopePredicate(scope?: RecallScope): { active: boolean; predicate: string; params: any[] } {
    const preds: string[] = [];
    const params: any[] = [];
    if (scope?.sessionId) {
      preds.push('session_id = ?');
      params.push(scope.sessionId);
    }
    if (scope?.groupId) {
      preds.push('group_id = ?');
      params.push(scope.groupId);
    }
    if (scope?.entityType) {
      preds.push('entity_type = ?');
      params.push(scope.entityType);
    }
    if (scope?.kind) {
      preds.push('kind = ?');
      params.push(scope.kind);
    }
    return { active: preds.length > 0, predicate: preds.join(' AND '), params };
  }

  /**
   * 把授权 seq 集合物化进 TEMP 表，之后三个通道都 JOIN 它。
   * 向量通道因此只对授权行计算余弦 —— 越权内容连相似度都不会被算（#9 可实测）。
   *
   * 表名按 (predicate, params) 取键：并发 recall 用不同作用域时各写各的表，
   * 不会出现 A 查询的 await 期间被 B 查询覆盖作用域的情况（同一作用域共用一张表，
   * 内容由同一条谓词算出，重建幂等）。
   */
  private buildScopeFilter(scope?: RecallScope): ScopeStats {
    const total = (this.db.prepare('SELECT COUNT(*) AS n FROM records').get() as { n: number }).n;
    const sp = this.scopePredicate(scope);
    if (!sp.active) {
      this.db.exec('DROP TABLE IF EXISTS scope_filter');
      return { scopeActive: false, predicate: '', table: null, totalRecords: total, authorizedRecords: total, deniedRecords: 0 };
    }
    const table = `scope_filter_${fnv1a(`${sp.predicate}|${JSON.stringify(sp.params)}`)}`;
    this.db.exec(`CREATE TEMP TABLE IF NOT EXISTS ${table} (seq INTEGER PRIMARY KEY)`);
    this.db.exec(`DELETE FROM ${table}`);
    this.db.prepare(`INSERT OR IGNORE INTO ${table}(seq) SELECT seq FROM records WHERE ${sp.predicate}`).run(...sp.params);
    const authorized = (this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    return {
      scopeActive: true,
      predicate: sp.predicate,
      table,
      totalRecords: total,
      authorizedRecords: authorized,
      deniedRecords: Math.max(0, total - authorized),
    };
  }

  private scopeJoin(scopeStats: ScopeStats, alias: string): string {
    return scopeStats.scopeActive && scopeStats.table ? `JOIN ${scopeStats.table} sf ON sf.seq = ${alias}.rowid` : '';
  }

  // ─────────────────────────────────────────────
  // 三路召回通道
  // ─────────────────────────────────────────────

  /**
   * 多词查询的**逐词回退表达式**（短语查不到时用）。
   *
   * 为什么需要：`toPhrase()` 把整条查询当成一个**短语**（`"a b c"`），
   * 只有正文里**连续同序**出现才命中。实测：单词/双词正常，三词
   * "ALPHA-7799 memory verify" 命中 0（文档其实已在 FTS 里，见 stats.ftsUniDocs），
   * 只能靠向量腿救回；**没有嵌入模型的机器上就等于完全召不回**（CI 就是这样暴露的）。
   *
   * 两种索引的token 粒度不同，不能用同一套表达式：
   *  - fts_uni 是**单字**索引（CJK 逐字、ASCII 逐字符），所以词要写成 `"m e m o r y"`；
   *  - fts_tri 是 trigram，词保持原样 `"memory"`；
   * 先试 **AND**（所有词都在，精确），再试 **OR**（部分词命中，宽松）。
   */
  private termwiseFallbacks(q: string, mode: 'chars' | 'raw'): string[] {
    const terms = String(q || '')
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    if (terms.length < 2) return [];
    const quoted = terms.map((t) => {
      const body = mode === 'chars' ? spaceChars(t) : t;
      return `"${body.replace(/"/g, '""')}"`;
    });
    return [quoted.join(' AND '), quoted.join(' OR ')];
  }

  /** 依次尝试回退表达式，返回第一个有结果的（顺序即优先级） */
  private tryFallbacks<T>(exprs: string[], run: (matchExpr: string) => T[]): { rows: T[]; used?: string } {
    for (const [i, expr] of exprs.entries()) {
      try {
        const rows = run(expr);
        if (rows.length) return { rows, used: i === 0 ? 'termwise AND fallback' : 'termwise OR fallback' };
      } catch { /* 表达式语法问题：继续下一个 */ }
    }
    return { rows: [] };
  }

  private channelUni(query: string, limit: number, scopeStats: ScopeStats): { ids: string[]; scoreById: Map<string, number>; skipped?: string } {
    const ids: string[] = [];
    const scoreById = new Map<string, number>();
    const join = this.scopeJoin(scopeStats, 'f');
    const stmt = this.db.prepare(
      `SELECT f.rowid AS seq, bm25(fts_uni) AS s FROM fts_uni f ${join}
       WHERE fts_uni MATCH ? ORDER BY rank LIMIT ?`
    );
    let rows = stmt.all(toPhrase(query), limit) as Array<{ seq: number; s: number }>;
    let skipped: string | undefined;
    if (rows.length === 0) {
      const retry = this.tryFallbacks(this.termwiseFallbacks(query, 'chars'), (m) => stmt.all(m, limit) as Array<{ seq: number; s: number }>);
      if (retry.rows.length) {
        rows = retry.rows;
        skipped = retry.used;
      }
    }
    for (const r of rows) {
      const id = String(r.seq);
      if (!scoreById.has(id)) {
        ids.push(id);
        scoreById.set(id, -Number(r.s));
      }
    }
    return { ids, scoreById, ...(skipped ? { skipped } : {}) };
  }

  private channelTri(query: string, limit: number, scopeStats: ScopeStats): { ids: string[]; scoreById: Map<string, number>; skipped?: string } {
    const ids: string[] = [];
    const scoreById = new Map<string, number>();
    if (!triQueryable(query)) return { ids, scoreById, skipped: 'query<3chars' };
    const join = this.scopeJoin(scopeStats, 'f');
    const stmt = this.db.prepare(
      `SELECT f.rowid AS seq, bm25(fts_tri) AS s FROM fts_tri f ${join}
       WHERE fts_tri MATCH ? ORDER BY rank LIMIT ?`
    );
    let rows = stmt.all(toTriPhrase(query.trim()), limit) as Array<{ seq: number; s: number }>;
    let skipped: string | undefined;
    if (rows.length === 0) {
      const retry = this.tryFallbacks(this.termwiseFallbacks(query.trim(), 'raw'), (m) => stmt.all(m, limit) as Array<{ seq: number; s: number }>);
      if (retry.rows.length) {
        rows = retry.rows;
        skipped = retry.used;
      }
    }
    for (const r of rows) {
      const id = String(r.seq);
      if (!scoreById.has(id)) {
        ids.push(id);
        scoreById.set(id, -Number(r.s));
      }
    }
    return { ids, scoreById, ...(skipped ? { skipped } : {}) };
  }

  /** LIKE 兜底：1–2 字 CJK 与 trigram 停用时的语义保持不变（历史上是 recall 的兜底路径） */
  private channelLike(query: string, limit: number, scopeStats: ScopeStats): { ids: string[]; scoreById: Map<string, number> } {
    const ids: string[] = [];
    const scoreById = new Map<string, number>();
    const join = scopeStats.scopeActive && scopeStats.table ? `JOIN ${scopeStats.table} sf ON sf.seq = r.seq` : '';
    const rows = this.db
      .prepare(
        `SELECT r.seq FROM records r ${join} WHERE r.body LIKE ? OR r.id LIKE ? ORDER BY r.seq DESC LIMIT ?`
      )
      .all(`%${query}%`, `%${query}%`, limit) as Array<{ seq: number }>;
    for (const r of rows) {
      const id = String(r.seq);
      if (!scoreById.has(id)) {
        ids.push(id);
        scoreById.set(id, 1 / (1 + ids.length));
      }
    }
    return { ids, scoreById };
  }

  /**
   * 向量通道：只取授权行 → 逐行 int8 余弦（不反量化）。
   * 返回 cosines = 实际计算行数（作用域预过滤的直接证据）。
   */
  private channelVector(
    qvec: Float32Array,
    limit: number,
    scopeStats: ScopeStats,
    minCosine: number
  ): { ids: string[]; scoreById: Map<string, number>; cosines: number; belowThreshold: number } {
    const join = scopeStats.scopeActive && scopeStats.table ? `JOIN ${scopeStats.table} sf ON sf.seq = v.seq` : '';
    const rows = this.db
      .prepare(`SELECT v.seq, v.scale, v.data FROM vec_index v ${join}`)
      .all() as Array<{ seq: number; scale: number; data: Buffer }>;
    const scored: Array<{ seq: number; cos: number }> = [];
    // 查询向量也量化到 int8，两侧同域比较
    const { data: q8, scale: qs } = encodeVectorToInt8ForQuery(qvec);
    for (const r of rows) {
      const v8 = unpackInt8(r.data);
      const cos = cosineInt8(q8, qs, v8, Number(r.scale));
      scored.push({ seq: r.seq, cos });
    }
    scored.sort((a, b) => b.cos - a.cos);
    const ids: string[] = [];
    const scoreById = new Map<string, number>();
    let belowThreshold = 0;
    for (const s of scored.slice(0, limit)) {
      if (s.cos < minCosine) {
        belowThreshold += 1;
        continue;
      }
      const id = String(s.seq);
      ids.push(id);
      scoreById.set(id, normalizeCosine(s.cos));
    }
    belowThreshold += Math.max(0, scored.length - limit);
    return { ids, scoreById, cosines: rows.length, belowThreshold };
  }

  // ─────────────────────────────────────────────
  // recall（发现 → 索引卡）
  // ─────────────────────────────────────────────

  /** 同步 recall：fts_uni ∪ fts_tri（+ 已缓存的查询向量）→ RRF → 索引卡 */
  recall(query: string | QueryLike, limit = 10, opts: RecallOptions = {}): RecallCard[] {
    return this.searchSync(normalizeQueryArgs(query, limit, opts)).cards;
  }

  /** 异步 recall：先补齐缺失向量、再嵌入查询，然后三路 RRF */
  async recallAsync(query: string | QueryLike, limit = 10, opts: RecallOptions = {}): Promise<RecallCard[]> {
    return (await this.recallDetailed(query, limit, opts)).cards;
  }

  recallDetailedSync(query: string | QueryLike, limit = 10, opts: RecallOptions = {}): RecallDetail {
    return this.searchSync(normalizeQueryArgs(query, limit, opts));
  }

  async recallDetailed(query: string | QueryLike, limit = 10, opts: RecallOptions = {}): Promise<RecallDetail> {
    const o = normalizeQueryArgs(query, limit, opts);
    const t0 = Date.now();
    const scopeStats = this.buildScopeFilter(o.scope);
    const perChannel = o.perChannel ?? Math.max(o.limit * 3, 20);
    const channels: ChannelReport[] = [];
    const lists: RankedList[] = [];
    const scoreById = new Map<string, { uni?: number; tri?: number; vector?: number }>();
    const timings: RecallTimings = {
      totalMs: 0,
      hydrateMs: 0,
      embedQueryMs: 0,
      uniMs: 0,
      triMs: 0,
      vecMs: 0,
      fuseMs: 0,
      cosines: 0,
      hydrated: 0,
    };

    let uniT = Date.now();
    const uni = this.channelUni(o.query, perChannel, scopeStats);
    timings.uniMs = Date.now() - uniT;
    let likeReport: ChannelReport | null = null;
    if (uni.ids.length) {
      lists.push({ source: 'fts_uni', ids: uni.ids });
      for (const id of uni.ids) scoreById.set(id, { ...(scoreById.get(id) ?? {}), uni: uni.scoreById.get(id) });
      channels.push({ channel: 'fts_uni', used: true, hits: uni.ids.length, ms: timings.uniMs });
    } else {
      // 保持历史语义：fts_uni 空时用 LIKE 兜底（1–2 字 CJK）
      const like = this.channelLike(o.query, perChannel, scopeStats);
      likeReport = { channel: 'like', used: like.ids.length > 0, hits: like.ids.length, ms: 0, skipped: 'fallback-of-fts_uni' };
      if (like.ids.length) {
        lists.push({ source: 'fts_uni', ids: like.ids });
        for (const id of like.ids) scoreById.set(id, { ...(scoreById.get(id) ?? {}), uni: like.scoreById.get(id) });
      }
      channels.push({ channel: 'fts_uni', used: like.ids.length > 0, hits: like.ids.length, ms: timings.uniMs, skipped: 'matched via LIKE fallback' });
    }

    const triT = Date.now();
    const tri = this.channelTri(o.query, perChannel, scopeStats);
    timings.triMs = Date.now() - triT;
    if (tri.ids.length) {
      lists.push({ source: 'fts_tri', ids: tri.ids });
      for (const id of tri.ids) scoreById.set(id, { ...(scoreById.get(id) ?? {}), tri: tri.scoreById.get(id) });
    }
    channels.push({ channel: 'fts_tri', used: tri.ids.length > 0, hits: tri.ids.length, ms: timings.triMs, skipped: tri.skipped });

    // ── 向量通道（异步：补齐 → 嵌入查询 → 授权集合内算余弦）
    let vecUsed = false;
    let vecSkipped: string | undefined;
    let vecBelowThreshold = 0;
    let vecUnkRatio: number | null = null;
    if (o.useVector === false) vecSkipped = 'disabled by option';
    else {
      await this.vectorPromise;
      if (!this.embedder || this.closed) vecSkipped = this.vectorInitError || 'embedder unavailable';
      else {
        const vo = this.vectorOpts();
        const tokens = this.embedder.tokenize(o.query);
        vecUnkRatio = tokens.length ? tokens.filter((t) => t === '[UNK]').length / tokens.length : 0;
        const maxUnk = vo.maxUnkRatio ?? 0.5;
        if (tokens.length === 0) vecSkipped = 'empty query tokens';
        else if (vecUnkRatio > maxUnk) vecSkipped = `unk-ratio ${vecUnkRatio.toFixed(2)} > ${maxUnk}（稠密向量不可信，交给词法通道）`;
        else {
          if (o.hydrate !== false) {
            const h = await this.hydrateVectors(o.hydrateBudget ?? 256);
            timings.hydrateMs = h.ms;
            timings.hydrated = h.embedded;
          }
          const eT = Date.now();
          const qvec = await this.embedQuery(o.query);
          timings.embedQueryMs = Date.now() - eT;
          const vT = Date.now();
          const vec = this.channelVector(qvec, perChannel, scopeStats, o.minCosine ?? vo.minCosine ?? 0.5);
          timings.vecMs = Date.now() - vT;
          timings.cosines = vec.cosines;
          vecBelowThreshold = vec.belowThreshold;
          vecUsed = vec.ids.length > 0;
          if (vec.ids.length) {
            lists.push({ source: 'vector', ids: vec.ids });
            for (const id of vec.ids) scoreById.set(id, { ...(scoreById.get(id) ?? {}), vector: vec.scoreById.get(id) });
          }
          if (!vecUsed) vecSkipped = `all ${vec.cosines} cosines below minCosine ${o.minCosine ?? vo.minCosine ?? 0.5}`;
        }
      }
    }
    channels.push({
      channel: 'vector',
      used: vecUsed,
      hits: vecUsed ? (lists.find((l) => l.source === 'vector')?.ids.length ?? 0) : 0,
      ms: timings.vecMs,
      skipped: vecSkipped,
    });
    timings.vectorBelowThreshold = vecBelowThreshold;
    timings.vectorUnkRatio = vecUnkRatio;
    if (likeReport) channels.push(likeReport);

    const fuseT = Date.now();
    const fused: FusedHit[] = rrfFusionRanked(lists, o.k ?? 60);
    timings.fuseMs = Date.now() - fuseT;

    const cards = this.buildCards(fused.slice(0, o.limit), scoreById, scopeStats);
    timings.totalMs = Date.now() - t0;
    return {
      cards,
      timings,
      scopeStats,
      channels,
      levels: [...new Set(cards.map((c) => c.source))],
      candidates: {
        uni: uni.ids.length,
        tri: tri.ids.length,
        vector: timings.cosines,
        fused: fused.length,
      },
    };
  }

  private searchSync(o: Required<Pick<RecallOptions, 'limit'>> & RecallOptions & { query: string }): RecallDetail {
    const t0 = Date.now();
    const scopeStats = this.buildScopeFilter(o.scope);
    const perChannel = o.perChannel ?? Math.max(o.limit * 3, 20);
    const lists: RankedList[] = [];
    const scoreById = new Map<string, { uni?: number; tri?: number; vector?: number }>();
    const channels: ChannelReport[] = [];
    const timings: RecallTimings = {
      totalMs: 0,
      hydrateMs: 0,
      embedQueryMs: 0,
      uniMs: 0,
      triMs: 0,
      vecMs: 0,
      fuseMs: 0,
      cosines: 0,
      hydrated: 0,
    };

    const uT = Date.now();
    const uni = this.channelUni(o.query, perChannel, scopeStats);
    timings.uniMs = Date.now() - uT;
    if (uni.ids.length) {
      lists.push({ source: 'fts_uni', ids: uni.ids });
      for (const id of uni.ids) scoreById.set(id, { uni: uni.scoreById.get(id) });
      channels.push({ channel: 'fts_uni', used: true, hits: uni.ids.length, ms: timings.uniMs });
    } else {
      const like = this.channelLike(o.query, perChannel, scopeStats);
      if (like.ids.length) {
        lists.push({ source: 'fts_uni', ids: like.ids });
        for (const id of like.ids) scoreById.set(id, { uni: like.scoreById.get(id) });
      }
      channels.push({ channel: 'fts_uni', used: like.ids.length > 0, hits: like.ids.length, ms: timings.uniMs, skipped: 'matched via LIKE fallback' });
      channels.push({ channel: 'like', used: like.ids.length > 0, hits: like.ids.length, ms: 0, skipped: 'fallback-of-fts_uni' });
    }

    const tT = Date.now();
    const tri = this.channelTri(o.query, perChannel, scopeStats);
    timings.triMs = Date.now() - tT;
    if (tri.ids.length) {
      lists.push({ source: 'fts_tri', ids: tri.ids });
      for (const id of tri.ids) scoreById.set(id, { ...(scoreById.get(id) ?? {}), tri: tri.scoreById.get(id) });
    }
    channels.push({ channel: 'fts_tri', used: tri.ids.length > 0, hits: tri.ids.length, ms: timings.triMs, skipped: tri.skipped });

    // 同步路径的向量通道：只在查询向量已缓存时使用（避免阻塞事件循环）
    let vecSkipped: string | undefined;
    const cached = this.queryVecCache.get(o.query);
    if (o.useVector === false) vecSkipped = 'disabled by option';
    else if (!this.embedder) vecSkipped = this.vectorInitError || 'embedder not ready (sync path)';
    else if (!cached) vecSkipped = 'no cached query vector (use recallAsync)';
    else {
      const vo = this.vectorOpts();
      const vT = Date.now();
      const vec = this.channelVector(cached, perChannel, scopeStats, o.minCosine ?? vo.minCosine ?? 0.5);
      timings.vecMs = Date.now() - vT;
      timings.cosines = vec.cosines;
      timings.vectorBelowThreshold = vec.belowThreshold;
      if (vec.ids.length) {
        lists.push({ source: 'vector', ids: vec.ids });
        for (const id of vec.ids) scoreById.set(id, { ...(scoreById.get(id) ?? {}), vector: vec.scoreById.get(id) });
      }
      channels.push({ channel: 'vector', used: vec.ids.length > 0, hits: vec.ids.length, ms: timings.vecMs });
    }
    if (vecSkipped) channels.push({ channel: 'vector', used: false, hits: 0, ms: 0, skipped: vecSkipped });

    const fT = Date.now();
    const fused = rrfFusionRanked(lists, o.k ?? 60);
    timings.fuseMs = Date.now() - fT;
    const cards = this.buildCards(fused.slice(0, o.limit), scoreById as any, scopeStats);
    timings.totalMs = Date.now() - t0;
    return {
      cards,
      timings,
      scopeStats,
      channels,
      levels: [...new Set(cards.map((c) => c.source))],
      candidates: { uni: uni.ids.length, tri: tri.ids.length, vector: timings.cosines, fused: fused.length },
    };
  }

  private buildCards(
    fused: FusedHit[],
    scoreById: Map<string, { uni?: number; tri?: number; vector?: number }>,
    scopeStats: ScopeStats
  ): RecallCard[] {
    if (!fused.length) return [];
    const seqs = fused.map((f) => Number(f.id));
    const placeholders = seqs.map(() => '?').join(',');
    const join = scopeStats.scopeActive && scopeStats.table ? `JOIN ${scopeStats.table} sf ON sf.seq = r.seq` : '';
    const rows = this.db
      .prepare(`SELECT r.seq, r.id, r.body, r.session_id FROM records r ${join} WHERE r.seq IN (${placeholders})`)
      .all(...seqs) as Array<{ seq: number; id: string; body: string; session_id: string }>;
    const bySeq = new Map(rows.map((r) => [r.seq, r]));
    const out: RecallCard[] = [];
    for (const f of fused) {
      const seq = Number(f.id);
      const row = bySeq.get(seq);
      if (!row) continue; // 越权行会被 scope join 挡掉（防御性二次校验）
      const source: RecallSource = f.sources.length > 1 ? 'fused' : ((f.sources[0] as RecallSource) ?? 'fts_uni');
      const sc = scoreById.get(f.id) ?? {};
      out.push({
        seq,
        recordId: row.id,
        snippet: String(row.body).slice(0, 200),
        score: sc.vector ?? sc.tri ?? sc.uni ?? f.rrfScore,
        source,
        hitLevel: source,
        sources: f.sources as RecallSource[],
        ranks: f.ranks as Partial<Record<RecallSource, number>>,
        rrfScore: f.rrfScore,
        cosine: f.ranks.vector ? sc.vector : undefined,
        anchor: { file: path.basename(this.jsonlPath), seq, recordId: row.id },
      });
    }
    return out;
  }

  // ─────────────────────────────────────────────
  // retrieve（解引用，三级回退 exact → nearby → fuzzy）
  // ─────────────────────────────────────────────

  retrieve(input: RetrieveAnchorInput | { anchor: RetrieveAnchorInput; fallback?: RetrieveOptions['fallback'] }, opts: RetrieveOptions = {}): RetrieveOutcome | null {
    const req = (input ?? {}) as { anchor?: RetrieveAnchorInput; fallback?: RetrieveOptions['fallback'] };
    const anchor: RetrieveAnchorInput = req.anchor ?? (input as RetrieveAnchorInput);
    const maxLevel = opts.fallback ?? req.fallback ?? 'fuzzy';
    const order: Array<'exact' | 'nearby' | 'fuzzy'> = ['exact', 'nearby', 'fuzzy'];
    const allowed = order.slice(0, order.indexOf(maxLevel) + 1);
    const tried: string[] = [];

    for (const level of allowed) {
      const hit =
        level === 'exact'
          ? this.retrieveExact(anchor)
          : level === 'nearby'
            ? this.retrieveNearby(anchor, opts.window ?? 5)
            : this.retrieveFuzzy(anchor, opts.query);
      if (hit) {
        return {
          raw: hit.raw,
          seq: hit.seq,
          recordId: hit.recordId,
          hitLevel: level,
          via: hit.via,
          anchor: { file: path.basename(this.jsonlPath), seq: hit.seq, recordId: hit.recordId, byteOffset: anchor.byteOffset },
          note: tried.length ? `previous levels failed: ${tried.join(', ')}` : undefined,
        };
      }
      tried.push(level);
    }
    return null;
  }

  /** exact：SQLite 主键/唯键直取；SQLite 缺行时回 JSONL（JSONL 才是唯一事实来源） */
  private retrieveExact(anchor: RetrieveAnchorInput): RawHit | null {
    if (anchor.recordId) {
      const row = this.db.prepare('SELECT seq, id, body FROM records WHERE id = ?').get(anchor.recordId);
      if (row) return { raw: String(row.body), seq: Number(row.seq), recordId: String(row.id), via: 'sqlite:id' };
    }
    if (anchor.seq !== undefined && anchor.seq !== null) {
      const row = this.db.prepare('SELECT seq, id, body FROM records WHERE seq = ?').get(anchor.seq);
      if (row) return { raw: String(row.body), seq: Number(row.seq), recordId: String(row.id), via: 'sqlite:seq' };
      // seq 已删除但 JSONL 仍在 → 直接读 JSONL（投影可丢弃，事实源不丢）
      const idx = this.jsonlIndexOrBuild();
      const entry = idx.entries.find((e) => e.seq === Number(anchor.seq));
      if (entry) return { raw: entry.body, seq: entry.seq, recordId: entry.id, via: 'jsonl:seq' };
    }
    if (anchor.recordId) {
      const idx = this.jsonlIndexOrBuild();
      const entry = idx.entries.find((e) => e.id === anchor.recordId);
      if (entry) return { raw: entry.body, seq: entry.seq, recordId: entry.id, via: 'jsonl:id' };
    }
    if (anchor.byteOffset !== undefined) {
      const idx = this.jsonlIndexOrBuild();
      const entry = idx.entries.find((e) => anchor.byteOffset! >= e.start && anchor.byteOffset! < e.end);
      if (entry) return { raw: entry.body, seq: entry.seq, recordId: entry.id, via: 'jsonl:offset' };
    }
    return null;
  }

  /** nearby：seq 邻域 / 去掉后缀的 id / id 长前缀 / 字节偏移最近的行走近一步 */
  private retrieveNearby(anchor: RetrieveAnchorInput, window: number): RawHit | null {
    if (anchor.seq !== undefined && anchor.seq !== null) {
      const row = this.db
        .prepare('SELECT seq, id, body FROM records WHERE seq BETWEEN ? AND ? ORDER BY ABS(seq - ?) LIMIT 1')
        .get(Number(anchor.seq) - window, Number(anchor.seq) + window, Number(anchor.seq));
      if (row) return { raw: String(row.body), seq: Number(row.seq), recordId: String(row.id), via: `sqlite:seq±${window}` };
    }
    if (anchor.recordId) {
      // 逐级剥掉尾部片段（'m-003#7' → 'm-003'，'m-012-v2' → 'm-012'）
      let cand = String(anchor.recordId);
      for (let i = 0; i < 3; i++) {
        const m = /^(.*?)[-:#@./][^-:#@./]*$/.exec(cand);
        if (!m || !m[1]) break;
        cand = m[1];
        const row = this.db.prepare('SELECT seq, id, body FROM records WHERE id = ?').get(cand);
        if (row) return { raw: String(row.body), seq: Number(row.seq), recordId: String(row.id), via: 'sqlite:id-trim' };
      }
      // id 长前缀：anchor 比真实 id 长且共享长前缀时也算"邻近"
      const prefix = cand.slice(0, Math.max(8, Math.floor(cand.length * 0.7)));
      if (prefix.length >= 8 && prefix !== cand) {
        const row = this.db.prepare('SELECT seq, id, body FROM records WHERE id LIKE ? ORDER BY LENGTH(id) LIMIT 1').get(`${prefix}%`);
        if (row) return { raw: String(row.body), seq: Number(row.seq), recordId: String(row.id), via: 'sqlite:id-prefix' };
      }
      const idx = this.jsonlIndexOrBuild();
      const cand2 = idx.entries
        .map((e) => ({ e, lcp: commonPrefixLen(e.id, String(anchor.recordId)) }))
        .filter((x) => x.lcp >= 8)
        .sort((a, b) => b.lcp - a.lcp)[0];
      if (cand2) return { raw: cand2.e.body, seq: cand2.e.seq, recordId: cand2.e.id, via: 'jsonl:id-prefix' };
    }
    if (anchor.byteOffset !== undefined) {
      const idx = this.jsonlIndexOrBuild();
      let best: JsonlIndexEntry | null = null;
      for (const e of idx.entries) {
        if (!best || Math.abs(e.start - anchor.byteOffset) < Math.abs(best.start - anchor.byteOffset)) best = e;
      }
      if (best) return { raw: best.body, seq: best.seq, recordId: best.id, via: 'jsonl:offset-nearest' };
    }
    return null;
  }

  /** fuzzy：先按 anchor/query 做 FTS，再退到 id LIKE，最后退到最新一条 */
  private retrieveFuzzy(anchor: RetrieveAnchorInput, query?: string): RawHit | null {
    const q = (query ?? anchor.recordId ?? '').trim();
    if (q) {
      const scopeStats = this.buildScopeFilter(undefined);
      for (const [chan, ids] of [
        ['fts:uni', this.channelUni(q, 5, scopeStats).ids],
        ['fts:tri', this.channelTri(q, 5, scopeStats).ids],
      ] as Array<[string, string[]]>) {
        if (ids.length) {
          const row = this.db.prepare('SELECT seq, id, body FROM records WHERE seq = ?').get(Number(ids[0]));
          if (row) return { raw: String(row.body), seq: Number(row.seq), recordId: String(row.id), via: chan };
        }
      }
      const row = this.db
        .prepare('SELECT seq, id, body FROM records WHERE id LIKE ? ORDER BY LENGTH(id) LIMIT 1')
        .get(`%${q}%`);
      if (row) return { raw: String(row.body), seq: Number(row.seq), recordId: String(row.id), via: 'like:id' };
    }
    const newest = this.db.prepare('SELECT seq, id, body FROM records ORDER BY seq DESC LIMIT 1').get();
    if (newest) return { raw: String(newest.body), seq: Number(newest.seq), recordId: String(newest.id), via: 'sqlite:newest' };
    // SQLite 空投影 → 回 JSONL 最后一行
    const idx = this.jsonlIndexOrBuild();
    const last = idx.entries[idx.entries.length - 1];
    if (last) return { raw: last.body, seq: last.seq, recordId: last.id, via: 'jsonl:last' };
    return null;
  }

  // ─────────────────────────────────────────────
  // JSONL 行索引（byteOffset 锚点 + 事实源兜底）
  // ─────────────────────────────────────────────

  private jsonlIndexOrBuild(): JsonlIndex {
    if (this.jsonlIndex) {
      try {
        const st = fs.statSync(this.jsonlPath);
        if (st.size === this.jsonlIndex.size && st.mtimeMs === this.jsonlIndex.mtimeMs) return this.jsonlIndex;
      } catch {
        /* 文件消失则重建 */
      }
    }
    this.jsonlIndex = buildJsonlIndex(this.jsonlPath);
    return this.jsonlIndex;
  }

  // ─────────────────────────────────────────────
  // 向量：初始化 / 被动水合 / 查询嵌入
  // ─────────────────────────────────────────────

  private vectorOpts(): VectorOptions {
    return { enabled: true, ...(this.opts.vector ?? {}) };
  }

  private async initVector(): Promise<void> {
    const vo = this.vectorOpts();
    if (vo.enabled === false) {
      this.vectorInitError = 'vector channel disabled by option';
      return;
    }
    const candidates: Array<{ modelPath: string; tokenizerPath: string; from: string }> = [];
    if (vo.modelPath) {
      candidates.push({ modelPath: vo.modelPath, tokenizerPath: vo.tokenizerPath ?? path.join(path.dirname(vo.modelPath), 'tokenizer.json'), from: 'explicit' });
    }
    for (const c of defaultModelCandidates(this.opts.dataDir)) candidates.push(c);
    this.vectorTried = candidates.map((c) => `${c.from}:${c.modelPath}`);
    const found = candidates.find((c) => fs.existsSync(c.modelPath));
    if (!found) {
      this.vectorInitError = `ONNX_MODEL_MISSING (tried ${this.vectorTried.join(' | ')})`;
      return;
    }
    const ortPaths = [...(vo.ortSearchPaths ?? []), ...ortSearchCandidates()];
    try {
      const emb = await OnnxEmbedder.create({
        modelPath: found.modelPath,
        tokenizerPath: found.tokenizerPath,
        ortSearchPaths: ortPaths,
        threads: vo.threads ?? 1,
        maxLength: vo.maxLength ?? 256,
        queryPrefix: vo.queryPrefix ?? '',
      });
      if (this.closed) return;
      this.embedder = emb;
      this.vectorInitError = '';
    } catch (e: any) {
      this.vectorInitError = String(e?.status?.reason || e?.message || e);
      this.vectorTried = [...this.vectorTried, ...(e?.status?.ortTried ?? [])];
    }
  }

  async waitVectorReady(): Promise<void> {
    await this.vectorPromise;
  }

  vectorStatus(): VectorStatus & { error?: string; modelCandidates: string[] } {
    const base = this.embedder?.status;
    if (base) return { ...base, modelCandidates: this.vectorTried };
    return {
      ready: false,
      reason: this.vectorInitError || 'initializing',
      backend: 'none',
      dim: 0,
      simdSupported: undefined as any,
      threads: this.vectorOpts().threads ?? 1,
      modelPath: null,
      tokenizerPath: null,
      modelBytes: 0,
      ortMain: null,
      ortTried: [],
      loadMs: 0,
      embeds: 0,
      embedTotalMs: 0,
      lastEmbedMs: 0,
      maxLength: this.vectorOpts().maxLength ?? 256,
      queryPrefix: this.vectorOpts().queryPrefix ?? '',
      tokenizer: null,
      modelCandidates: this.vectorTried,
    };
  }

  /** 查询嵌入（带 LRU 缓存，供同步 recall 复用） */
  private async embedQuery(text: string): Promise<Float32Array> {
    const cached = this.queryVecCache.get(text);
    if (cached) return cached;
    if (!this.embedder) throw new Error('embedder unavailable');
    const vec = await this.embedder.embed(text);
    if (this.queryVecCache.size >= 64) {
      const first = this.queryVecCache.keys().next().value;
      if (first !== undefined) this.queryVecCache.delete(first);
    }
    this.queryVecCache.set(text, vec);
    return vec;
  }

  /**
   * 被动水合：把还没有向量的历史记录补上（最近优先），上限 budget 条。
   * 不是全量预算 —— 每次查询只补水合预算内的那部分，其余留给下一次。
   */
  async hydrateVectors(budget = 256): Promise<{ embedded: number; ms: number; remaining: number; skipped?: string }> {
    const t0 = Date.now();
    if (!this.embedder) return { embedded: 0, ms: 0, remaining: 0, skipped: this.vectorInitError || 'embedder unavailable' };
    const maxChars = this.vectorOpts().maxEmbedChars ?? 512;
    const rows = this.db
      .prepare(
        `SELECT r.seq, r.body FROM records r LEFT JOIN vec_index v ON v.seq = r.seq
         WHERE v.seq IS NULL ORDER BY r.seq DESC LIMIT ?`
      )
      .all(Math.max(0, budget)) as Array<{ seq: number; body: string }>;
    if (!rows.length) return { embedded: 0, ms: Date.now() - t0, remaining: 0 };
    const ins = this.db.prepare('INSERT OR REPLACE INTO vec_index (seq, dim, scale, data) VALUES (?,?,?,?)');
    let n = 0;
    for (const row of rows) {
      if (this.closed) break;
      const text = String(row.body).slice(0, maxChars);
      const vec = await this.embedder.embed(text);
      const enc = encodeVector(vec);
      ins.run(row.seq, enc.dim, enc.scale, enc.blob);
      n += 1;
    }
    const rest = (this.db
      .prepare('SELECT COUNT(*) AS n FROM records r LEFT JOIN vec_index v ON v.seq = r.seq WHERE v.seq IS NULL')
      .get() as { n: number }).n;
    return { embedded: n, ms: Date.now() - t0, remaining: rest };
  }

  /** 直接嵌入一段文本（调试/测试用） */
  async embedText(text: string): Promise<Float32Array | null> {
    await this.vectorPromise;
    if (!this.embedder) return null;
    return this.embedder.embed(text);
  }

  // ─────────────────────────────────────────────
  // 投影重建 / 统计
  // ─────────────────────────────────────────────

  /** 从 JSONL 全量重建 SQLite 投影（records + fts_uni + fts_tri；向量下次查询时被动水合） */
  rebuildProjection(): number {
    this.db.exec('DROP TABLE IF EXISTS fts_uni; DROP TABLE IF EXISTS fts_tri;');
    this.db.exec('DELETE FROM records; DELETE FROM vec_index;');
    this.db.exec(SQL_FTS_UNI);
    this.db.exec(SQL_FTS_TRI);
    if (!fs.existsSync(this.jsonlPath)) {
      this.jsonlIndex = null;
      return 0;
    }
    const lines = fs.readFileSync(this.jsonlPath, 'utf8').split('\n').filter(Boolean);
    const ins = this.db.prepare(
      'INSERT OR REPLACE INTO records (seq, id, session_id, kind, ts, body, group_id, entity_type) VALUES (?,?,?,?,?,?,?,?)'
    );
    const insU = this.db.prepare('INSERT OR REPLACE INTO fts_uni (rowid, body) VALUES (?, ?)');
    const insT = this.db.prepare('INSERT OR REPLACE INTO fts_tri (rowid, body) VALUES (?, ?)');
    const tx = this.db.transaction(() => {
      for (const line of lines) {
        const r = JSON.parse(line) as JsonlRecord;
        const body = String(r.body ?? r.content ?? r.text ?? line);
        ins.run(r.seq, r.id, r.sessionId, r.kind, r.ts, body, (r.groupId as string) ?? null, (r.entityType as string) ?? null);
        insU.run(r.seq, spaceChars(body));
        insT.run(r.seq, body);
        if (r.seq > this.seq) this.seq = r.seq;
      }
    });
    tx();
    this.db.prepare("INSERT OR REPLACE INTO meta (k,v) VALUES ('last_seq', ?)").run(String(this.seq));
    this.db.prepare("INSERT OR REPLACE INTO meta (k,v) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION));
    this.jsonlIndex = null;
    return lines.length;
  }

  /**
   * 索引里真实有多少篇文档。
   *
   * 用 fts5 的 %_docsize 影子表：每写入一行就有一条 (docid, sz)，空表为 0，DELETE 后归 0。
   * 不能用 %_data 行数（空表也有结构行，实测 2 行），也不能用 fts5vocab（实测多分段时
   * 只枚举到部分分段：14 条记录只报 4 条），会误判"索引是否为空"，进而漏掉旧库回填。
   */
  private indexedDocs(fts: 'fts_uni' | 'fts_tri'): number {
    try {
      return (this.db.prepare(`SELECT COUNT(*) AS n FROM ${fts}_docsize`).get() as { n: number }).n;
    } catch {
      return -1;
    }
  }

  stats(): {
    schemaVersion: number;
    seq: number;
    records: number;
    ftsUniDocs: number;
    ftsTriDocs: number;
    ftsTriPresent: boolean;
    vecRows: number;
    jsonlLines: number;
    jsonlBytes: number;
    dbPath: string;
    jsonlPath: string;
    upgrade: UpgradeReport;
    coldStart: { rebuilt: boolean; lines: number; reason: string };
    vector: VectorStatus & { error?: string; modelCandidates: string[] };
  } {
    const n = (sql: string) => (this.db.prepare(sql).get() as { n: number }).n;
    const idx = this.jsonlIndexOrBuild();
    return {
      schemaVersion: Number((this.db.prepare("SELECT v FROM meta WHERE k='schema_version'").get() as { v?: string } | undefined)?.v ?? 0),
      seq: this.seq,
      records: n('SELECT COUNT(*) AS n FROM records'),
      ftsUniDocs: this.indexedDocs('fts_uni'),
      ftsTriDocs: this.indexedDocs('fts_tri'),
      ftsTriPresent: this.tableExists('fts_tri'),
      vecRows: n('SELECT COUNT(*) AS n FROM vec_index'),
      jsonlLines: idx.entries.length,
      jsonlBytes: idx.size,
      dbPath: this.dbPath,
      jsonlPath: this.jsonlPath,
      upgrade: this.upgrade,
      coldStart: this.coldStart,
      vector: this.vectorStatus(),
    };
  }

  /** 直接跑一条 SQL（测试/诊断用，只读意图） */
  rawQuery(sql: string, ...params: any[]): any {
    return this.db.prepare(sql).all(...params);
  }

  /** 直接 exec（测试/诊断用，例如建 fts5vocab 探针表、看 EXPLAIN QUERY PLAN） */
  rawExec(sql: string): void {
    this.db.exec(sql);
  }

  close(): void {
    this.closed = true;
    try {
      this.db?.close();
    } catch {
      /* noop */
    }
  }
}

// ─────────────────────────────────────────────
// 内部工具
// ─────────────────────────────────────────────

export interface RetrieveAnchorInput {
  seq?: number;
  recordId?: string;
  file?: string;
  byteOffset?: number;
}

interface RawHit {
  raw: string;
  seq: number;
  recordId: string;
  via: string;
}

interface JsonlIndexEntry {
  start: number;
  end: number;
  seq: number;
  id: string;
  body: string;
}

interface JsonlIndex {
  size: number;
  mtimeMs: number;
  entries: JsonlIndexEntry[];
}

/** 扫描 JSONL 一次，记录每行的字节区间与关键字段（证据锚点 byteOffset 的真实落点） */
export function buildJsonlIndex(jsonlPath: string): JsonlIndex {
  const empty: JsonlIndex = { size: 0, mtimeMs: 0, entries: [] };
  if (!fs.existsSync(jsonlPath)) return empty;
  const st = fs.statSync(jsonlPath);
  const buf = fs.readFileSync(jsonlPath);
  const entries: JsonlIndexEntry[] = [];
  let start = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] !== 0x0a) continue;
    const lineBuf = buf.subarray(start, i);
    start = i + 1;
    if (!lineBuf.length) continue;
    const line = lineBuf.toString('utf8').trim();
    if (!line) continue;
    let parsed: any = null;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const body = String(parsed.body ?? parsed.content ?? parsed.text ?? line);
    entries.push({
      start: i - lineBuf.length,
      end: i,
      seq: Number(parsed.seq ?? entries.length + 1),
      id: String(parsed.id ?? ''),
      body,
    });
  }
  return { size: st.size, mtimeMs: st.mtimeMs, entries };
}

function commonPrefixLen(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i += 1;
  return i;
}

/** 32 位 FNV-1a：给作用域临时表取稳定表名（同谓词同表，不同谓词不同表） */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

function normalizeQueryArgs(
  query: string | QueryLike,
  limit: number,
  opts: RecallOptions
): { query: string; limit: number } & RecallOptions {
  if (typeof query === 'string') return { ...opts, query, limit: opts.limit ?? limit };
  return {
    ...opts,
    query: query.query,
    limit: opts.limit ?? query.limit ?? limit,
    scope: opts.scope ?? query.scope,
  };
}

function encodeVectorToInt8ForQuery(vec: Float32Array): { data: Int8Array; scale: number } {
  let max = 0;
  for (const v of vec) {
    const a = Math.abs(v);
    if (a > max) max = a;
  }
  const scale = max > 0 ? max / 127 : 1;
  const data = new Int8Array(vec.length);
  for (let i = 0; i < vec.length; i++) data[i] = Math.round((vec[i] ?? 0) / scale);
  return { data, scale };
}

// ─────────────────────────────────────────────
// IPC 子进程入口
// ─────────────────────────────────────────────

/** IPC 子进程入口（pnpm --filter @warmy/memory-os start） */
export function startMemoryServiceIpc(dataDir: string): MemoryService {
  const svc = new MemoryService({ dataDir });
  const send = (msg: any) => {
    try {
      process.send?.(msg);
    } catch {
      /* noop */
    }
  };
  send({ type: 'ready', pid: process.pid, dataDir, schemaVersion: SCHEMA_VERSION });

  const handlers: Record<string, (msg: any) => Promise<any> | any> = {
    append: (msg) => {
      const rec = svc.append(msg.record, msg.writer || 'memory-service');
      return { ok: true, seq: rec.seq };
    },
    tail: (msg) => ({ ok: true, records: svc.tail(msg.limit) }),
    /** 完整三路 recall（fts_uni ∪ fts_tri ∪ 向量 → RRF），返回卡片 + 计时 + 作用域统计 */
    recall: async (msg) => {
      const detail = await svc.recallDetailed({ query: msg.query, scope: msg.scope, limit: msg.limit });
      return { ok: true, cards: detail.cards, timings: detail.timings, scopeStats: detail.scopeStats, channels: detail.channels, candidates: detail.candidates };
    },
    /** 同步 recall（不含异步向量水合），保持历史语义 */
    recall_sync: (msg) => {
      const detail = svc.recallDetailedSync({ query: msg.query, scope: msg.scope, limit: msg.limit });
      return { ok: true, cards: detail.cards, timings: detail.timings, scopeStats: detail.scopeStats, channels: detail.channels };
    },
    retrieve: (msg) => ({ ok: true, result: svc.retrieve(msg.anchor ?? msg.request ?? {}, msg.opts ?? {}) }),
    rebuild: (msg) => ({ ok: true, count: svc.rebuildProjection() }),
    vector_status: async () => {
      await svc.waitVectorReady();
      return { ok: true, vector: svc.vectorStatus() };
    },
    hydrate: async (msg) => ({ ok: true, result: await svc.hydrateVectors(msg.budget ?? 256) }),
    stats: () => ({ ok: true, stats: svc.stats() }),
    embed: async (msg) => {
      const v = await svc.embedText(msg.text);
      return { ok: true, dim: v?.length ?? 0, vector: v ? Array.from(v) : null };
    },
    shutdown: (msg) => {
      svc.close();
      setTimeout(() => process.exit(0), 20);
      return { ok: true };
    },
  };

  process.on('message', (msg: any) => {
    const { id, op } = msg || {};
    const h = handlers[op];
    if (!h) {
      send({ id, error: `unknown op ${op}` });
      return;
    }
    Promise.resolve()
      .then(() => h(msg))
      .then((res) => {
        if (op !== 'shutdown') send({ id, ...res });
      })
      .catch((e: any) => send({ id, error: String(e?.message || e), code: e?.code }));
  });
  return svc;
}

export * from './migrate.js';
export * from './lock.js';
export * from './vectors.js';
export * from './tokenizer.js';
export * from './embedder.js';
