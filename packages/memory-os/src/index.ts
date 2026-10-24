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
import { bianMaXiangLiang, yuXianInt8, normalizeCosine, rrfRonghePaixu, unpackInt8 } from './vectors.js';
import type { RankedList, RongheMingzhong } from './vectors.js';
import { OnnxQianruqi, morenMoxingHouxuan, ortSearchCandidates } from './embedder.js';
import type { XiangliangZhuangtai } from './embedder.js';
import { JsonlSuo } from './lock.js';

const require = createRequire(import.meta.url);

/**
 * 类型契约（v1.1）：**只 import type**。本包以子进程运行、运行时目录里没有 @warmy/contracts，
 * 任何值 import 都会让子进程起不来（`import type` 编译后整行消失）。
 * 下面这些名字保留为别名/扩展，是为了下游原有的 `import { X } from '@warmy/memory-os'` 不断。
 */
import type {
  XieRuZhe,
  JsonlJilu as QiYueJsonlJilu,
  HuisuoLaiyuan as QiYueHuisuoLaiyuan,
  HuisuoChaxun,
  RecallCard as QiYueRecallCard,
  ZhengjuMaodian as QiYueZhengjuMaodian,
  JiansuoJieguo,
  RetrieveRequest,
  AcpKongzhiXiaoxi,
} from '@warmy/contracts';

export type XieRuQi = XieRuZhe;

/** 投影 schema 版本：2 = 增加 fts_tri + vec_index + 作用域列 */
export const MOSHI_BANBEN = 2;

/** fts_tri（trigram）最小可查长度（FTS5 trigram 需要 ≥3 个字符） */
export const TRI_MIN_CHARS = 3;

export type JsonlJilu = QiYueJsonlJilu;

export type HuisuoLaiyuan = QiYueHuisuoLaiyuan;

export type HuisuoZuoyongyu = NonNullable<HuisuoChaxun['scope']>;

/** 契约里的索引卡 + 本服务的诊断字段（各通道排名、RRF 原始分、向量余弦） */
export interface RecallCard extends QiYueRecallCard {
  /** 命中该证据的通道列表（RRF 融合前） */
  sources: HuisuoLaiyuan[];
  /** 各通道内排名（1-based） */
  ranks: Partial<Record<HuisuoLaiyuan, number>>;
  /** 该卡片的主命中级别（=source，便于 UI 直读） */
  hitLevel: HuisuoLaiyuan;
  /** RRF 原始分 */
  rrfScore: number;
  /** 向量通道命中的余弦（未命中向量通道则缺省） */
  cosine?: number;
}

export type ZhengjuMaodian = QiYueZhengjuMaodian;

export type QueryLike = HuisuoChaxun;

export interface HuisuoXuanxiang {
  scope?: HuisuoZuoyongyu;
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

export interface HuisuoHaoshi {
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

export interface TongdaoBaogao {
  channel: 'fts_uni' | 'fts_tri' | 'vector' | 'like';
  used: boolean;
  skipped?: string;
  hits: number;
  ms: number;
}

export interface HuisuoXiangqing {
  cards: RecallCard[];
  timings: HuisuoHaoshi;
  scopeStats: ScopeStats;
  channels: TongdaoBaogao[];
  /** 用到的命中级别集合 */
  levels: HuisuoLaiyuan[];
  candidates: { uni: number; tri: number; vector: number; fused: number };
}

export interface JiansuoJibie {
  hitLevel: 'exact' | 'nearby' | 'fuzzy';
}

/** retrieve 的结果 = 契约 `JiansuoJieguo`（v1.1 按本服务的真实返回定稿：raw / via / note） */
export type RetrieveOutcome = JiansuoJieguo;

export interface JiansuoXuanxiang {
  huiTui?: 'exact' | 'nearby' | 'fuzzy';
  /** nearby 级别的 seq 邻域半径，默认 5 */
  window?: number;
  /** fuzzy 级别的检索串（缺省时用 anchor.recordId） */
  query?: string;
  /**
   * 作用域（不变量 #9「权限过滤先于相关性」在解引用侧的那一半）：给了就只认作用域内的记录。
   * 只做召回侧的过滤不够 —— 拿到别处的 seq/recordId 直接 retrieve，等于绕过了召回的作用域。
   */
  scope?: HuisuoZuoyongyu;
}

export interface XiangliangXuanxiang {
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
  CangLu: string;
  /** JSONL 日志文件名，默认 fast-memory.jsonl */
  jsonlName?: string;
  /** 向量/嵌入配置 */
  vector?: XiangliangXuanxiang;
}

export interface ShengjiBaogao {
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

const SQL_JILU = `
  CREATE TABLE IF NOT EXISTS records (
    seq INTEGER PRIMARY KEY,
    id TEXT UNIQUE NOT NULL,
    session_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    ts INTEGER NOT NULL,
    ti TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
  CREATE TABLE IF NOT EXISTS vec_index (
    seq INTEGER PRIMARY KEY,
    dim INTEGER NOT NULL,
    scale REAL NOT NULL,
    data BLOB NOT NULL
  );
`;
const SQL_FTS_UNI = `CREATE VIRTUAL TABLE IF NOT EXISTS fts_uni USING fts5(ti, tokenize='unicode61', content='records', content_rowid='seq');`;
const SQL_FTS_TRI = `CREATE VIRTUAL TABLE IF NOT EXISTS fts_tri USING fts5(ti, tokenize='trigram', content='records', content_rowid='seq');`;

/**
 * 记忆服务核心。应作为长驻子进程运行（见 startMemoryServiceIpc）。
 */
export class JiyiCangFuwu {
  private db: any;
  private seq = 0;
  readonly jsonlPath: string;
  readonly dbPath: string;
  readonly upgrade: ShengjiBaogao;
  /** 冷启动重建报告（DB 丢了但 JSONL 还在 → 全量重建投影，不变量 #5） */
  readonly coldStart: { rebuilt: boolean; HangJi: number; reason: string };

  private vectorPromise: Promise<void>;
  private embedder: OnnxQianruqi | null = null;
  private vectorInitError = '';
  private vectorTried: string[] = [];
  private queryVecCache = new Map<string, Float32Array>();
  private closed = false;
  private jsonlIndex: JsonlSuoyin | null = null;
  /** SWMR 文件锁：写侧持有，读者可并发（与检查点回退共享同一 .lock 协议） */
  private jsonlSuo: JsonlSuo;

  constructor(private opts: MemoryOsOptions) {
    fs.mkdirSync(opts.CangLu, { recursive: true });
    this.jsonlPath = path.join(opts.CangLu, opts.jsonlName || 'fast-memory.jsonl');
    this.dbPath = path.join(opts.CangLu, 'memory.db');
    this.jsonlSuo = new JsonlSuo(this.jsonlPath);
    const Shujuku = require('better-sqlite3');
    this.db = new Shujuku(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SQL_JILU);
    this.upgrade = this.ensureSchema();
    const hang = this.db.prepare("SELECT v FROM meta WHERE k='last_seq'").get();
    this.seq = hang ? Number(hang.v) : 0;
    this.coldStart = this.coldStartRebuild();
    this.backfillFtsFromRecords(this.upgrade);
    this.vectorPromise = this.initVector();
  }

  // ─────────────────────────────────────────────
  // schema：建表 + 旧库升级
  // ─────────────────────────────────────────────

  private tableExists(ming: string): boolean {
    const r = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(ming);
    return !!r;
  }

  private columns(table: string): string[] {
    return (this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((r) => r.name);
  }

  private addColumnIfMissing(table: string, lie: string, type: string, yiTianJia: string[]): void {
    if (this.columns(table).includes(lie)) return;
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${lie} ${type}`);
    yiTianJia.push(`${table}.${lie}`);
  }

  /**
   * 建表与升级。老库（只有 fts_uni）在这里平滑加上 fts_tri / vec_index / 作用域列，
   * 不改 JSONL、不删数据（不变量 #5：投影可丢弃、可重建）。
   */
  private ensureSchema(): ShengjiBaogao {
    const yuanshujuHang = this.tableExists('meta') ? (this.db.prepare("SELECT v FROM meta WHERE k='schema_version'").get() as { v?: string } | undefined) : undefined;
    const schemaVersionBefore = yuanshujuHang?.v ? Number(yuanshujuHang.v) : 0;

    const hadFtsUni = this.tableExists('fts_uni');
    const hadFtsTri = this.tableExists('fts_tri');

    const yiTianJia: string[] = [];
    this.addColumnIfMissing('records', 'group_id', 'TEXT', yiTianJia);
    this.addColumnIfMissing('records', 'entity_type', 'TEXT', yiTianJia);

    this.db.exec(SQL_FTS_UNI);
    // 旧库升级路径：把 fts_tri 真正建出来（此前只有注释和类型）
    this.db.exec(SQL_FTS_TRI);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_records_session ON records(session_id);
      CREATE INDEX IF NOT EXISTS idx_records_kind ON records(kind);
      CREATE INDEX IF NOT EXISTS idx_records_group ON records(group_id);
    `);
    this.db.prepare("INSERT OR REPLACE INTO meta (k,v) VALUES ('schema_version', ?)").run(String(MOSHI_BANBEN));

    return {
      schemaVersionBefore,
      schemaVersionAfter: MOSHI_BANBEN,
      hadFtsUni,
      hadFtsTri,
      createdFtsTri: !hadFtsTri,
      addedColumns: yiTianJia,
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
  private backfillFtsFromRecords(up: ShengjiBaogao): void {
    const recN = (this.db.prepare('SELECT COUNT(*) AS n FROM records').get() as { n: number }).n;
    if (!recN) return;
    const needUni = !up.hadFtsUni || this.indexedDocs('fts_uni') === 0;
    const needTri = up.createdFtsTri || this.indexedDocs('fts_tri') === 0;
    if (!needUni && !needTri) return;

    const rows = this.db.prepare('SELECT seq, ti FROM records').all() as Array<{ seq: number; ti: string }>;
    if (needUni) {
      const shiLi = this.db.prepare('INSERT OR REPLACE INTO fts_uni (rowid, ti) VALUES (?, ?)');
      const shiwu = this.db.transaction(() => {
        for (const hang of rows) shiLi.run(hang.seq, spaceChars(String(hang.ti)));
      });
      shiwu();
      up.backfilledUniRows = rows.length;
    }
    if (needTri) {
      const shiLi = this.db.prepare('INSERT OR REPLACE INTO fts_tri (rowid, ti) VALUES (?, ?)');
      const shiwu = this.db.transaction(() => {
        for (const hang of rows) shiLi.run(hang.seq, String(hang.ti));
      });
      shiwu();
      up.backfilledTriRows = rows.length;
    }
    this.db.prepare("INSERT OR REPLACE INTO meta (k,v) VALUES ('schema_version', ?)").run(String(MOSHI_BANBEN));
  }

  /**
   * 不变量 #5：SQLite 是可丢弃投影。库被删/被清空但 JSONL 还在 → 从 JSONL 全量重建。
   * 这是"删掉 memory.db 重启后照样检索"的实现依据。
   */
  private coldStartRebuild(): { rebuilt: boolean; HangJi: number; reason: string } {
    const recN = (this.db.prepare('SELECT COUNT(*) AS n FROM records').get() as { n: number }).n;
    if (recN > 0) return { rebuilt: false, HangJi: recN, reason: 'projection present' };
    if (!fs.existsSync(this.jsonlPath)) return { rebuilt: false, HangJi: 0, reason: 'no jsonl' };
    const size = fs.statSync(this.jsonlPath).size;
    if (size === 0) return { rebuilt: false, HangJi: 0, reason: 'jsonl empty' };
    const n = this.rebuildProjection();
    return { rebuilt: true, HangJi: n, reason: 'projection missing, rebuilt from jsonl' };
  }

  // ─────────────────────────────────────────────
  // 写入（JSONL 唯一事实来源 + 三路投影）
  // ─────────────────────────────────────────────

  /** 只追加写入 JSONL + 投影到 SQLite */
  append(
    record: { id: string; sessionId: string; kind: string; [k: string]: unknown },
    Bi: XieRuQi
  ): JsonlJilu {
    // 写入者唯一约束（简化：duty 写 message；router 写 queue；其余拒绝）
    if (record.kind === 'queue' && Bi !== 'router') {
      throw Object.assign(new Error('queue.jsonl writer must be router'), { code: 'WRITER' });
    }
    if (record.kind === 'message' && Bi === 'executor') {
      // 执行者只回传蒸馏，不直接写 message 流
      throw Object.assign(new Error('executor cannot write message records'), { code: 'WRITER' });
    }

    const seq = ++this.seq;
    const Quan: JsonlJilu = {
      ...record,
      seq,
      ts: Date.now(),
      id: record.id,
      sessionId: record.sessionId,
      kind: record.kind,
    };
    const Hang = JSON.stringify(Quan) + '\n';
    // 写侧持锁（SWMR）：与检查点回退/外部改写共享 jsonlPath.lock，避免写写交错
    const naDaoSuo = this.jsonlSuo.acquire(5000);
    try {
      fs.appendFileSync(this.jsonlPath, Hang, 'utf8');
    } finally {
      if (naDaoSuo) this.jsonlSuo.release();
    }

    const ti = String(Quan.ti ?? Quan.content ?? Quan.text ?? JSON.stringify(Quan));
    /**
     * **投影只存索引预览**（第 44 轮后半 · 用户 #7：「写入侧 CCR 丢原文」的根因修复）。
     * JSONL 里是整条原文（唯一事实来源，不许改写）；SQLite 投影是**可丢弃的检索投影**，
     * 它只需要够用来"找到"，不需要够用来"复述"。所以：
     *  · `records.ti` / 两张 FTS 只放前 `SUO_YIN_ZUI_DA_ZI` 个字符；
     *  · 取原文一律走 `retrieve`（下面 `retrieveExact` 会优先读 JSONL），
     *    这样"命中了投影却只拿回半截原文"这种事不会再发生（旧行为：模型以为拿到原文，其实是压缩预览）。
     */
    const YuGao = ti.length > SUO_YIN_ZUI_DA_ZI ? ti.slice(0, SUO_YIN_ZUI_DA_ZI) : ti;
    this.db
      .prepare(
        'INSERT OR REPLACE INTO records (seq, id, session_id, kind, ts, ti, group_id, entity_type) VALUES (?,?,?,?,?,?,?,?)'
      )
      .run(
        seq,
        Quan.id,
        Quan.sessionId,
        Quan.kind,
        Quan.ts,
        YuGao,
        (Quan.groupId as string) ?? null,
        (Quan.entityType as string) ?? null
      );
    this.db.prepare('INSERT OR REPLACE INTO fts_uni (rowid, ti) VALUES (?, ?)').run(seq, spaceChars(YuGao));
    // fts_tri 索引进原文（不插空格），trigram 才能覆盖 ASCII 标识符/路径与 ≥3 字 CJK 子串
    this.db.prepare('INSERT OR REPLACE INTO fts_tri (rowid, ti) VALUES (?, ?)').run(seq, YuGao);
    this.db.prepare("INSERT OR REPLACE INTO meta (k,v) VALUES ('last_seq', ?)").run(String(seq));
    /**
     * **索引增量维护**（用户 #8：「JSONL 增量索引，不再全文件重读」）。
     * 旧做法是每次 append 都把缓存置 null ⇒ 下一次 retrieve 从头扫整个文件；
     * 6000 轮 × 每轮 2M 字符的日志上，这就是"越用越慢"的直接原因（而且慢在用户等回复的路上）。
     * 现在：已知这一行的字节区间，直接追加到缓存里；文件被别人改过（长度对不上）才重建。
     */
    const HangZiJie = Buffer.byteLength(Hang, 'utf8');
    if (this.jsonlIndex) {
      const kaiShi = this.jsonlIndex.size;
      const yueLan = Buffer.from(String(ti).slice(0, 500), 'utf8').toString('utf8');
      this.jsonlIndex.entries.push({ start: kaiShi, end: kaiShi + HangZiJie, seq, id: String(record.id ?? ''), ti: yueLan });
      this.jsonlIndex.size = kaiShi + HangZiJie;
      try { this.jsonlIndex.mtimeMs = fs.statSync(this.jsonlPath).mtimeMs; } catch { this.jsonlIndex = null; }
    } else {
      this.jsonlIndex = null;
    }
    return Quan;
  }

  tail(limit = 50): JsonlJilu[] {
    const rows = this.db
      .prepare('SELECT * FROM records ORDER BY seq DESC LIMIT ?')
      .all(limit) as Array<{ seq: number; ts: number; session_id: string; kind: string; id: string; ti: string }>;
    return rows.map((r) => ({
      seq: r.seq,
      ts: r.ts,
      sessionId: r.session_id,
      kind: r.kind,
      id: r.id,
      ti: r.ti,
    }));
  }

  /**
   * **按会话分页的最近记录**（第 44 轮后半 · 用户 #6：「重启恢复按会话分页，不再全局 400 条共享」）。
   *
   * 全局 `tail(400)` 的真实后果：一个高频会话能把整个窗口占满 ⇒ **其它会话重启后直接失忆**
   * （界面上还在，但内存镜像里没有 ⇒ 模型看不到，只能靠指针取回，而用户不知道要取）。
   * 这里先按"最近活跃"取若干个会话，再**每个会话各取最近 M 条**：仍然有界，但公平。
   *
   * @param meiHuiHua 每个会话最多取多少条（消息类）
   * @param huiHuaShang 最多覆盖多少个最近活跃的会话
   */
  tailPerSession(meiHuiHua = 120, huiHuaShang = 40): JsonlJilu[] {
    const hui = this.db
      .prepare("SELECT session_id FROM records WHERE kind='message' AND session_id IS NOT NULL AND session_id <> '' GROUP BY session_id ORDER BY MAX(seq) DESC LIMIT ?")
      .all(Math.max(1, Math.floor(huiHuaShang) || 1)) as Array<{ session_id: string }>;
    const quXian = this.db.prepare("SELECT * FROM records WHERE session_id = ? AND kind='message' ORDER BY seq DESC LIMIT ?");
    const chu: JsonlJilu[] = [];
    for (const x of hui) {
      const rows = quXian.all(x.session_id, Math.max(1, Math.floor(meiHuiHua) || 1)) as Array<{ seq: number; ts: number; session_id: string; kind: string; id: string; ti: string }>;
      for (const r of rows) {
        chu.push({ seq: r.seq, ts: r.ts, sessionId: r.session_id, kind: r.kind, id: r.id, ti: r.ti });
      }
    }
    // 与 tail() 同口径：seq 倒序返回（调用方要升序自己排）
    chu.sort((a, b) => Number(b.seq || 0) - Number(a.seq || 0));
    return chu;
  }

  // ─────────────────────────────────────────────
  // 权限过滤先于相关性检索（不变量 #9）
  // ─────────────────────────────────────────────

  private scopePredicate(scope?: HuisuoZuoyongyu): { jiHuo: boolean; predicate: string; params: any[] } {
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
    return { jiHuo: preds.length > 0, predicate: preds.join(' AND '), params };
  }

  /**
   * 把授权 seq 集合物化进 TEMP 表，之后三个通道都 JOIN 它。
   * 向量通道因此只对授权行计算余弦 —— 越权内容连相似度都不会被算（#9 可实测）。
   *
   * 表名按 (predicate, params) 取键：并发 recall 用不同作用域时各写各的表，
   * 不会出现 A 查询的 await 期间被 B 查询覆盖作用域的情况（同一作用域共用一张表，
   * 内容由同一条谓词算出，重建幂等）。
   */
  private buildScopeFilter(scope?: HuisuoZuoyongyu): ScopeStats {
    const total = (this.db.prepare('SELECT COUNT(*) AS n FROM records').get() as { n: number }).n;
    const sp = this.scopePredicate(scope);
    if (!sp.jiHuo) {
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

  private scopeJoin(scopeStats: ScopeStats, bieMing: string): string {
    return scopeStats.scopeActive && scopeStats.table ? `JOIN ${scopeStats.table} sf ON sf.seq = ${bieMing}.rowid` : '';
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
    const cixiang = String(q || '')
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    if (cixiang.length < 2) return [];
    const quoted = cixiang.map((t) => {
      const ti = mode === 'chars' ? spaceChars(t) : t;
      return `"${ti.replace(/"/g, '""')}"`;
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

  private channelUni(query: string, limit: number, scopeStats: ScopeStats): { idJi: string[]; scoreById: Map<string, number>; skipped?: string } {
    const idJi: string[] = [];
    const scoreById = new Map<string, number>();
    const join = this.scopeJoin(scopeStats, 'f');
    const yuju = this.db.prepare(
      `SELECT f.rowid AS seq, bm25(fts_uni) AS s FROM fts_uni f ${join}
       WHERE fts_uni MATCH ? ORDER BY rank LIMIT ?`
    );
    let rows = yuju.all(toPhrase(query), limit) as Array<{ seq: number; s: number }>;
    let skipped: string | undefined;
    if (rows.length === 0) {
      const retry = this.tryFallbacks(this.termwiseFallbacks(query, 'chars'), (m) => yuju.all(m, limit) as Array<{ seq: number; s: number }>);
      if (retry.rows.length) {
        rows = retry.rows;
        skipped = retry.used;
      }
    }
    for (const r of rows) {
      const id = String(r.seq);
      if (!scoreById.has(id)) {
        idJi.push(id);
        scoreById.set(id, -Number(r.s));
      }
    }
    return { idJi, scoreById, ...(skipped ? { skipped } : {}) };
  }

  private channelTri(query: string, limit: number, scopeStats: ScopeStats): { idJi: string[]; scoreById: Map<string, number>; skipped?: string } {
    const idJi: string[] = [];
    const scoreById = new Map<string, number>();
    if (!triQueryable(query)) return { idJi, scoreById, skipped: 'query<3chars' };
    const join = this.scopeJoin(scopeStats, 'f');
    const yuju = this.db.prepare(
      `SELECT f.rowid AS seq, bm25(fts_tri) AS s FROM fts_tri f ${join}
       WHERE fts_tri MATCH ? ORDER BY rank LIMIT ?`
    );
    let rows = yuju.all(toTriPhrase(query.trim()), limit) as Array<{ seq: number; s: number }>;
    let skipped: string | undefined;
    if (rows.length === 0) {
      const retry = this.tryFallbacks(this.termwiseFallbacks(query.trim(), 'raw'), (m) => yuju.all(m, limit) as Array<{ seq: number; s: number }>);
      if (retry.rows.length) {
        rows = retry.rows;
        skipped = retry.used;
      }
    }
    for (const r of rows) {
      const id = String(r.seq);
      if (!scoreById.has(id)) {
        idJi.push(id);
        scoreById.set(id, -Number(r.s));
      }
    }
    return { idJi, scoreById, ...(skipped ? { skipped } : {}) };
  }

  /** LIKE 兜底：1–2 字 CJK 与 trigram 停用时的语义保持不变（历史上是 recall 的兜底路径） */
  private channelLike(query: string, limit: number, scopeStats: ScopeStats): { idJi: string[]; scoreById: Map<string, number> } {
    const idJi: string[] = [];
    const scoreById = new Map<string, number>();
    const join = scopeStats.scopeActive && scopeStats.table ? `JOIN ${scopeStats.table} sf ON sf.seq = r.seq` : '';
    const rows = this.db
      .prepare(
        `SELECT r.seq FROM records r ${join} WHERE r.ti LIKE ? OR r.id LIKE ? ORDER BY r.seq DESC LIMIT ?`
      )
      .all(`%${query}%`, `%${query}%`, limit) as Array<{ seq: number }>;
    for (const r of rows) {
      const id = String(r.seq);
      if (!scoreById.has(id)) {
        idJi.push(id);
        scoreById.set(id, 1 / (1 + idJi.length));
      }
    }
    return { idJi, scoreById };
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
  ): { idJi: string[]; scoreById: Map<string, number>; cosines: number; belowThreshold: number } {
    const join = scopeStats.scopeActive && scopeStats.table ? `JOIN ${scopeStats.table} sf ON sf.seq = v.seq` : '';
    const rows = this.db
      .prepare(`SELECT v.seq, v.scale, v.data FROM vec_index v ${join}`)
      .all() as Array<{ seq: number; scale: number; data: Buffer }>;
    const scored: Array<{ seq: number; cos: number }> = [];
    // 查询向量也量化到 int8，两侧同域比较
    const { data: q8, scale: qs } = encodeVectorToInt8ForQuery(qvec);
    for (const r of rows) {
      const v8 = unpackInt8(r.data);
      const cos = yuXianInt8(q8, qs, v8, Number(r.scale));
      scored.push({ seq: r.seq, cos });
    }
    scored.sort((a, b) => b.cos - a.cos);
    const idJi: string[] = [];
    const scoreById = new Map<string, number>();
    let belowThreshold = 0;
    for (const s of scored.slice(0, limit)) {
      if (s.cos < minCosine) {
        belowThreshold += 1;
        continue;
      }
      const id = String(s.seq);
      idJi.push(id);
      scoreById.set(id, normalizeCosine(s.cos));
    }
    belowThreshold += Math.max(0, scored.length - limit);
    return { idJi, scoreById, cosines: rows.length, belowThreshold };
  }

  // ─────────────────────────────────────────────
  // recall（发现 → 索引卡）
  // ─────────────────────────────────────────────

  /** 同步 recall：fts_uni ∪ fts_tri（+ 已缓存的查询向量）→ RRF → 索引卡 */
  recall(query: string | QueryLike, limit = 10, opts: HuisuoXuanxiang = {}): RecallCard[] {
    return this.searchSync(guiFanHuaChaXunCanShu(query, limit, opts)).cards;
  }

  /** 异步 recall：先补齐缺失向量、再嵌入查询，然后三路 RRF */
  async recallAsync(query: string | QueryLike, limit = 10, opts: HuisuoXuanxiang = {}): Promise<RecallCard[]> {
    return (await this.recallDetailed(query, limit, opts)).cards;
  }

  recallDetailedSync(query: string | QueryLike, limit = 10, opts: HuisuoXuanxiang = {}): HuisuoXiangqing {
    return this.searchSync(guiFanHuaChaXunCanShu(query, limit, opts));
  }

  async recallDetailed(query: string | QueryLike, limit = 10, opts: HuisuoXuanxiang = {}): Promise<HuisuoXiangqing> {
    const o = guiFanHuaChaXunCanShu(query, limit, opts);
    const qiShiShiJian = Date.now();
    const scopeStats = this.buildScopeFilter(o.scope);
    const perChannel = o.perChannel ?? Math.max(o.limit * 3, 20);
    const channels: TongdaoBaogao[] = [];
    const lists: RankedList[] = [];
    const scoreById = new Map<string, { uni?: number; tri?: number; vector?: number }>();
    const timings: HuisuoHaoshi = {
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
    let likeReport: TongdaoBaogao | null = null;
    if (uni.idJi.length) {
      lists.push({ source: 'fts_uni', idJi: uni.idJi });
      for (const id of uni.idJi) scoreById.set(id, { ...(scoreById.get(id) ?? {}), uni: uni.scoreById.get(id) });
      channels.push({ channel: 'fts_uni', used: true, hits: uni.idJi.length, ms: timings.uniMs });
    } else {
      // 保持历史语义：fts_uni 空时用 LIKE 兜底（1–2 字 CJK）
      const like = this.channelLike(o.query, perChannel, scopeStats);
      likeReport = { channel: 'like', used: like.idJi.length > 0, hits: like.idJi.length, ms: 0, skipped: 'fallback-of-fts_uni' };
      if (like.idJi.length) {
        lists.push({ source: 'fts_uni', idJi: like.idJi });
        for (const id of like.idJi) scoreById.set(id, { ...(scoreById.get(id) ?? {}), uni: like.scoreById.get(id) });
      }
      channels.push({ channel: 'fts_uni', used: like.idJi.length > 0, hits: like.idJi.length, ms: timings.uniMs, skipped: 'matched via LIKE fallback' });
    }

    const triT = Date.now();
    const tri = this.channelTri(o.query, perChannel, scopeStats);
    timings.triMs = Date.now() - triT;
    if (tri.idJi.length) {
      lists.push({ source: 'fts_tri', idJi: tri.idJi });
      for (const id of tri.idJi) scoreById.set(id, { ...(scoreById.get(id) ?? {}), tri: tri.scoreById.get(id) });
    }
    channels.push({ channel: 'fts_tri', used: tri.idJi.length > 0, hits: tri.idJi.length, ms: timings.triMs, skipped: tri.skipped });

    // ── 向量通道（异步：补齐 → 嵌入查询 → 授权集合内算余弦）
    let vecShiyong = false;
    let vecSkipped: string | undefined;
    let vecYixiaYuzhi = 0;
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
          vecYixiaYuzhi = vec.belowThreshold;
          vecShiyong = vec.idJi.length > 0;
          if (vec.idJi.length) {
            lists.push({ source: 'vector', idJi: vec.idJi });
            for (const id of vec.idJi) scoreById.set(id, { ...(scoreById.get(id) ?? {}), vector: vec.scoreById.get(id) });
          }
          if (!vecShiyong) vecSkipped = `all ${vec.cosines} cosines below minCosine ${o.minCosine ?? vo.minCosine ?? 0.5}`;
        }
      }
    }
    channels.push({
      channel: 'vector',
      used: vecShiyong,
      hits: vecShiyong ? (lists.find((l) => l.source === 'vector')?.idJi.length ?? 0) : 0,
      ms: timings.vecMs,
      skipped: vecSkipped,
    });
    timings.vectorBelowThreshold = vecYixiaYuzhi;
    timings.vectorUnkRatio = vecUnkRatio;
    if (likeReport) channels.push(likeReport);

    const fuseT = Date.now();
    const fused: RongheMingzhong[] = rrfRonghePaixu(lists, o.k ?? 60);
    timings.fuseMs = Date.now() - fuseT;

    const cards = this.buildCards(fused.slice(0, o.limit), scoreById, scopeStats);
    timings.totalMs = Date.now() - qiShiShiJian;
    return {
      cards,
      timings,
      scopeStats,
      channels,
      levels: [...new Set(cards.map((c) => c.source))],
      candidates: {
        uni: uni.idJi.length,
        tri: tri.idJi.length,
        vector: timings.cosines,
        fused: fused.length,
      },
    };
  }

  private searchSync(o: Required<Pick<HuisuoXuanxiang, 'limit'>> & HuisuoXuanxiang & { query: string }): HuisuoXiangqing {
    const qiShiShiJian = Date.now();
    const scopeStats = this.buildScopeFilter(o.scope);
    const perChannel = o.perChannel ?? Math.max(o.limit * 3, 20);
    const lists: RankedList[] = [];
    const scoreById = new Map<string, { uni?: number; tri?: number; vector?: number }>();
    const channels: TongdaoBaogao[] = [];
    const timings: HuisuoHaoshi = {
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
    if (uni.idJi.length) {
      lists.push({ source: 'fts_uni', idJi: uni.idJi });
      for (const id of uni.idJi) scoreById.set(id, { uni: uni.scoreById.get(id) });
      channels.push({ channel: 'fts_uni', used: true, hits: uni.idJi.length, ms: timings.uniMs });
    } else {
      const like = this.channelLike(o.query, perChannel, scopeStats);
      if (like.idJi.length) {
        lists.push({ source: 'fts_uni', idJi: like.idJi });
        for (const id of like.idJi) scoreById.set(id, { uni: like.scoreById.get(id) });
      }
      channels.push({ channel: 'fts_uni', used: like.idJi.length > 0, hits: like.idJi.length, ms: timings.uniMs, skipped: 'matched via LIKE fallback' });
      channels.push({ channel: 'like', used: like.idJi.length > 0, hits: like.idJi.length, ms: 0, skipped: 'fallback-of-fts_uni' });
    }

    const tT = Date.now();
    const tri = this.channelTri(o.query, perChannel, scopeStats);
    timings.triMs = Date.now() - tT;
    if (tri.idJi.length) {
      lists.push({ source: 'fts_tri', idJi: tri.idJi });
      for (const id of tri.idJi) scoreById.set(id, { ...(scoreById.get(id) ?? {}), tri: tri.scoreById.get(id) });
    }
    channels.push({ channel: 'fts_tri', used: tri.idJi.length > 0, hits: tri.idJi.length, ms: timings.triMs, skipped: tri.skipped });

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
      if (vec.idJi.length) {
        lists.push({ source: 'vector', idJi: vec.idJi });
        for (const id of vec.idJi) scoreById.set(id, { ...(scoreById.get(id) ?? {}), vector: vec.scoreById.get(id) });
      }
      channels.push({ channel: 'vector', used: vec.idJi.length > 0, hits: vec.idJi.length, ms: timings.vecMs });
    }
    if (vecSkipped) channels.push({ channel: 'vector', used: false, hits: 0, ms: 0, skipped: vecSkipped });

    const fT = Date.now();
    const fused = rrfRonghePaixu(lists, o.k ?? 60);
    timings.fuseMs = Date.now() - fT;
    const cards = this.buildCards(fused.slice(0, o.limit), scoreById as any, scopeStats);
    timings.totalMs = Date.now() - qiShiShiJian;
    return {
      cards,
      timings,
      scopeStats,
      channels,
      levels: [...new Set(cards.map((c) => c.source))],
      candidates: { uni: uni.idJi.length, tri: tri.idJi.length, vector: timings.cosines, fused: fused.length },
    };
  }

  private buildCards(
    fused: RongheMingzhong[],
    scoreById: Map<string, { uni?: number; tri?: number; vector?: number }>,
    scopeStats: ScopeStats
  ): RecallCard[] {
    if (!fused.length) return [];
    const seqs = fused.map((f) => Number(f.id));
    const zhanwei = seqs.map(() => '?').join(',');
    const join = scopeStats.scopeActive && scopeStats.table ? `JOIN ${scopeStats.table} sf ON sf.seq = r.seq` : '';
    const rows = this.db
      .prepare(`SELECT r.seq, r.id, r.ti, r.session_id FROM records r ${join} WHERE r.seq IN (${zhanwei})`)
      .all(...seqs) as Array<{ seq: number; id: string; ti: string; session_id: string }>;
    const bySeq = new Map(rows.map((r) => [r.seq, r]));
    const out: RecallCard[] = [];
    for (const f of fused) {
      const seq = Number(f.id);
      const hang = bySeq.get(seq);
      if (!hang) continue; // 越权行会被 scope join 挡掉（防御性二次校验）
      const source: HuisuoLaiyuan = f.sources.length > 1 ? 'fused' : ((f.sources[0] as HuisuoLaiyuan) ?? 'fts_uni');
      const sc = scoreById.get(f.id) ?? {};
      out.push({
        seq,
        recordId: hang.id,
        snippet: String(hang.ti).slice(0, 200),
        score: sc.vector ?? sc.tri ?? sc.uni ?? f.rrfScore,
        source,
        hitLevel: source,
        sources: f.sources as HuisuoLaiyuan[],
        ranks: f.ranks as Partial<Record<HuisuoLaiyuan, number>>,
        rrfScore: f.rrfScore,
        cosine: f.ranks.vector ? sc.vector : undefined,
        anchor: { file: path.basename(this.jsonlPath), seq, recordId: hang.id },
      });
    }
    return out;
  }

  // ─────────────────────────────────────────────
  // retrieve（解引用，三级回退 exact → nearby → fuzzy）
  // ─────────────────────────────────────────────

  retrieve(shuRu: JiansuoMaodianShuru | { anchor: JiansuoMaodianShuru; huiTui?: JiansuoXuanxiang['huiTui'] }, opts: JiansuoXuanxiang = {}): RetrieveOutcome | null {
    const Qiu = (shuRu ?? {}) as { anchor?: JiansuoMaodianShuru; huiTui?: JiansuoXuanxiang['huiTui'] };
    const anchor: JiansuoMaodianShuru = Qiu.anchor ?? (shuRu as JiansuoMaodianShuru);
    const maxLevel = opts.huiTui ?? Qiu.huiTui ?? 'fuzzy';
    const order: Array<'exact' | 'nearby' | 'fuzzy'> = ['exact', 'nearby', 'fuzzy'];
    const allowed = order.slice(0, order.indexOf(maxLevel) + 1);
    const tried: string[] = [];

    for (const level of allowed) {
      const mingZhong =
        level === 'exact'
          ? this.retrieveExact(anchor)
          : level === 'nearby'
            ? this.retrieveNearby(anchor, opts.window ?? 5)
            : this.retrieveFuzzy(anchor, opts.query);
      if (mingZhong && !this.zaiZuoYongYuNei(mingZhong.seq, opts.scope)) {
        tried.push(`${level}(作用域外)`);
        continue;
      }
      if (mingZhong) {
        return {
          raw: mingZhong.raw,
          seq: mingZhong.seq,
          recordId: mingZhong.recordId,
          hitLevel: level,
          via: mingZhong.via,
          anchor: { file: path.basename(this.jsonlPath), seq: mingZhong.seq, recordId: mingZhong.recordId, byteOffset: anchor.byteOffset },
          note: tried.length ? `previous levels failed: ${tried.join(', ')}` : undefined,
        };
      }
      tried.push(level);
    }
    return null;
  }

  /**
   * 解引用的作用域判定：与 recall 用同一条谓词（`scopePredicate`）。投影里查不到这一行（投影丢了还没重建）
   * ⇒ 按作用域外处理 —— 宁可这一次取不到，也不把作用域外的原文交出去。
   */
  private zaiZuoYongYuNei(seq: number, scope?: HuisuoZuoyongyu): boolean {
    const p = this.scopePredicate(scope);
    if (!p.jiHuo) return true;
    const hang = this.db.prepare(`SELECT 1 AS ok FROM records WHERE seq = ? AND ${p.predicate}`).get(Number(seq), ...p.params);
    return !!hang;
  }

  /** exact：SQLite 主键/唯键直取；SQLite 缺行时回 JSONL（JSONL 才是唯一事实来源） */
  private retrieveExact(anchor: JiansuoMaodianShuru): YuanwenMingzhong | null {
    /**
     * **原文一律优先读 JSONL**（第 44 轮后半 · 用户 #7）。
     * 投影里现在只放索引预览（`SUO_YIN_ZUI_DA_ZI`）⇒ 若照旧先取投影，`retrieve` 会"命中成功、
     * 内容半截"，那比取不到更坏（模型会拿半截原文当全文复述）。所以：
     * 先按 seq/id 找 JSONL 那一行；找不到（投影里有）才退回预览，并把 `via` 如实写成 `sqlite:*-预览`。
     */
    const suoYin = this.jsonlIndexOrBuild();
    if (anchor.seq !== undefined && anchor.seq !== null) {
      const tiao = suoYin.entries.find((e) => e.seq === Number(anchor.seq));
      if (tiao) return { raw: this.duJsonlQuanWen(tiao), seq: tiao.seq, recordId: tiao.id, via: 'jsonl:seq' };
    }
    if (anchor.recordId) {
      const tiao = suoYin.entries.find((e) => e.id === anchor.recordId);
      if (tiao) return { raw: this.duJsonlQuanWen(tiao), seq: tiao.seq, recordId: tiao.id, via: 'jsonl:id' };
      const hang = this.db.prepare('SELECT seq, id, ti FROM records WHERE id = ?').get(anchor.recordId);
      if (hang) return { raw: String(hang.ti), seq: Number(hang.seq), recordId: String(hang.id), via: 'sqlite:id-预览' };
    }
    if (anchor.seq !== undefined && anchor.seq !== null) {
      const hang = this.db.prepare('SELECT seq, id, ti FROM records WHERE seq = ?').get(anchor.seq);
      if (hang) return { raw: String(hang.ti), seq: Number(hang.seq), recordId: String(hang.id), via: 'sqlite:seq-预览' };
      // seq 已删除但 JSONL 仍在 → 直接读 JSONL（投影可丢弃，事实源不丢）
      const suoYin = this.jsonlIndexOrBuild();
      const entry = suoYin.entries.find((e) => e.seq === Number(anchor.seq));
      if (entry) return { raw: this.duJsonlQuanWen(entry), seq: entry.seq, recordId: entry.id, via: 'jsonl:seq' };
    }
    if (anchor.recordId) {
      const suoYin = this.jsonlIndexOrBuild();
      const entry = suoYin.entries.find((e) => e.id === anchor.recordId);
      if (entry) return { raw: this.duJsonlQuanWen(entry), seq: entry.seq, recordId: entry.id, via: 'jsonl:id' };
    }
    if (anchor.byteOffset !== undefined) {
      const suoYin = this.jsonlIndexOrBuild();
      const entry = suoYin.entries.find((e) => anchor.byteOffset! >= e.start && anchor.byteOffset! < e.end);
      if (entry) return { raw: this.duJsonlQuanWen(entry), seq: entry.seq, recordId: entry.id, via: 'jsonl:offset' };
    }
    return null;
  }

  /** nearby：seq 邻域 / 去掉后缀的 id / id 长前缀 / 字节偏移最近的行走近一步 */
  private retrieveNearby(anchor: JiansuoMaodianShuru, window: number): YuanwenMingzhong | null {
    if (anchor.seq !== undefined && anchor.seq !== null) {
      const hang = this.db
        .prepare('SELECT seq, id, ti FROM records WHERE seq BETWEEN ? AND ? ORDER BY ABS(seq - ?) LIMIT 1')
        .get(Number(anchor.seq) - window, Number(anchor.seq) + window, Number(anchor.seq));
      if (hang) return { raw: String(hang.ti), seq: Number(hang.seq), recordId: String(hang.id), via: `sqlite:seq±${window}` };
    }
    if (anchor.recordId) {
      // 逐级剥掉尾部片段（'m-003#7' → 'm-003'，'m-012-v2' → 'm-012'）
      let houXuan = String(anchor.recordId);
      for (let i = 0; i < 3; i++) {
        const m = /^(.*?)[-:#@./][^-:#@./]*$/.exec(houXuan);
        if (!m || !m[1]) break;
        houXuan = m[1];
        const hang = this.db.prepare('SELECT seq, id, ti FROM records WHERE id = ?').get(houXuan);
        if (hang) return { raw: String(hang.ti), seq: Number(hang.seq), recordId: String(hang.id), via: 'sqlite:id-trim' };
      }
      // id 长前缀：anchor 比真实 id 长且共享长前缀时也算"邻近"
      const prefix = houXuan.slice(0, Math.max(8, Math.floor(houXuan.length * 0.7)));
      if (prefix.length >= 8 && prefix !== houXuan) {
        const hang = this.db.prepare('SELECT seq, id, ti FROM records WHERE id LIKE ? ORDER BY LENGTH(id) LIMIT 1').get(`${prefix}%`);
        if (hang) return { raw: String(hang.ti), seq: Number(hang.seq), recordId: String(hang.id), via: 'sqlite:id-prefix' };
      }
      const suoYin = this.jsonlIndexOrBuild();
      const cand2 = suoYin.entries
        .map((e) => ({ e, lcp: gongyongQianzhuiChangdu(e.id, String(anchor.recordId)) }))
        .filter((x) => x.lcp >= 8)
        .sort((a, b) => b.lcp - a.lcp)[0];
      if (cand2) return { raw: this.duJsonlQuanWen(cand2.e), seq: cand2.e.seq, recordId: cand2.e.id, via: 'jsonl:id-prefix' };
    }
    if (anchor.byteOffset !== undefined) {
      const suoYin = this.jsonlIndexOrBuild();
      let zuiJia: JsonlSuoyinTiaomu | null = null;
      for (const e of suoYin.entries) {
        if (!zuiJia || Math.abs(e.start - anchor.byteOffset) < Math.abs(zuiJia.start - anchor.byteOffset)) zuiJia = e;
      }
      if (zuiJia) return { raw: this.duJsonlQuanWen(zuiJia), seq: zuiJia.seq, recordId: zuiJia.id, via: 'jsonl:offset-nearest' };
    }
    return null;
  }

  /** fuzzy：先按 anchor/query 做 FTS，再退到 id LIKE，最后退到最新一条 */
  private retrieveFuzzy(anchor: JiansuoMaodianShuru, query?: string): YuanwenMingzhong | null {
    const q = (query ?? anchor.recordId ?? '').trim();
    if (q) {
      const scopeStats = this.buildScopeFilter(undefined);
      for (const [chan, idJi] of [
        ['fts:uni', this.channelUni(q, 5, scopeStats).idJi],
        ['fts:tri', this.channelTri(q, 5, scopeStats).idJi],
      ] as Array<[string, string[]]>) {
        if (idJi.length) {
          const hang = this.db.prepare('SELECT seq, id, ti FROM records WHERE seq = ?').get(Number(idJi[0]));
          if (hang) return { raw: String(hang.ti), seq: Number(hang.seq), recordId: String(hang.id), via: chan };
        }
      }
      const hang = this.db
        .prepare('SELECT seq, id, ti FROM records WHERE id LIKE ? ORDER BY LENGTH(id) LIMIT 1')
        .get(`%${q}%`);
      if (hang) return { raw: String(hang.ti), seq: Number(hang.seq), recordId: String(hang.id), via: 'like:id' };
    }
    const zuixin = this.db.prepare('SELECT seq, id, ti FROM records ORDER BY seq DESC LIMIT 1').get();
    if (zuixin) return { raw: String(zuixin.ti), seq: Number(zuixin.seq), recordId: String(zuixin.id), via: 'sqlite:newest' };
    // SQLite 空投影 → 回 JSONL 最后一行
    const suoYin = this.jsonlIndexOrBuild();
    const last = suoYin.entries[suoYin.entries.length - 1];
    if (last) return { raw: this.duJsonlQuanWen(last), seq: last.seq, recordId: last.id, via: 'jsonl:last' };
    return null;
  }

  // ─────────────────────────────────────────────
  // JSONL 行索引（byteOffset 锚点 + 事实源兜底）
  // ─────────────────────────────────────────────

  private jsonlIndexOrBuild(): JsonlSuoyin {
    if (this.jsonlIndex) {
      try {
        const st = fs.statSync(this.jsonlPath);
        if (st.size === this.jsonlIndex.size && st.mtimeMs === this.jsonlIndex.mtimeMs) return this.jsonlIndex;
      } catch {
        /* 文件消失则重建 */
      }
    }
    this.jsonlIndex = gouJianJsonlSuoYin(this.jsonlPath);
    return this.jsonlIndex;
  }

  // ─────────────────────────────────────────────
  // 向量：初始化 / 被动水合 / 查询嵌入
  // ─────────────────────────────────────────────

  private vectorOpts(): XiangliangXuanxiang {
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
    for (const c of morenMoxingHouxuan(this.opts.CangLu)) candidates.push(c);
    this.vectorTried = candidates.map((c) => `${c.from}:${c.modelPath}`);
    const found = candidates.find((c) => fs.existsSync(c.modelPath));
    if (!found) {
      this.vectorInitError = `ONNX_MODEL_MISSING (tried ${this.vectorTried.join(' | ')})`;
      return;
    }
    const ortPaths = [...(vo.ortSearchPaths ?? []), ...ortSearchCandidates()];
    try {
      const emb = await OnnxQianruqi.create({
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

  vectorStatus(): XiangliangZhuangtai & { error?: string; modelCandidates: string[] } {
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
  async hydrateVectors(budget = 256): Promise<{ embedded: number; ms: number; shengYu: number; skipped?: string }> {
    const qiShiShiJian = Date.now();
    if (!this.embedder) return { embedded: 0, ms: 0, shengYu: 0, skipped: this.vectorInitError || 'embedder unavailable' };
    const maxChars = this.vectorOpts().maxEmbedChars ?? 512;
    const rows = this.db
      .prepare(
        `SELECT r.seq, r.ti FROM records r LEFT JOIN vec_index v ON v.seq = r.seq
         WHERE v.seq IS NULL ORDER BY r.seq DESC LIMIT ?`
      )
      .all(Math.max(0, budget)) as Array<{ seq: number; ti: string }>;
    if (!rows.length) return { embedded: 0, ms: Date.now() - qiShiShiJian, shengYu: 0 };
    const shiLi = this.db.prepare('INSERT OR REPLACE INTO vec_index (seq, dim, scale, data) VALUES (?,?,?,?)');
    let n = 0;
    for (const hang of rows) {
      if (this.closed) break;
      const text = String(hang.ti).slice(0, maxChars);
      const vec = await this.embedder.embed(text);
      const enc = bianMaXiangLiang(vec);
      shiLi.run(hang.seq, enc.dim, enc.scale, enc.blob);
      n += 1;
    }
    const qiYu = (this.db
      .prepare('SELECT COUNT(*) AS n FROM records r LEFT JOIN vec_index v ON v.seq = r.seq WHERE v.seq IS NULL')
      .get() as { n: number }).n;
    return { embedded: n, ms: Date.now() - qiShiShiJian, shengYu: qiYu };
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
  /** 按索引里的字节区间从 JSONL 现读全文（>2GiB 安全；索引只存预览） */
  private duJsonlQuanWen(tiao: { start: number; end: number; ti?: string }): string {
    try {
      const len = Math.max(0, Number(tiao.end) - Number(tiao.start));
      if (!len) return String(tiao.ti || '');
      const fd = fs.openSync(this.jsonlPath, 'r');
      try {
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, Number(tiao.start));
        const Hang = buf.toString('utf8').trim();
        try {
          const j = JSON.parse(Hang) as { ti?: string; content?: string; text?: string };
          return String(j.ti ?? j.content ?? j.text ?? Hang);
        } catch { return Hang; }
      } finally { try { fs.closeSync(fd); } catch { /* noop */ } }
    } catch { return String(tiao.ti || ''); }
  }

  rebuildProjection(): number {
    this.db.exec('DROP TABLE IF EXISTS fts_uni; DROP TABLE IF EXISTS fts_tri;');
    this.db.exec('DELETE FROM records; DELETE FROM vec_index;');
    this.db.exec(SQL_FTS_UNI);
    this.db.exec(SQL_FTS_TRI);
    if (!fs.existsSync(this.jsonlPath)) {
      this.jsonlIndex = null;
      return 0;
    }
    /**
     * **分块流式逐行**（第 51 轮真缺陷）：`readFileSync` 在 >2 GiB 时抛 ERR_FS_FILE_TOO_LARGE，
     * 重建投影会让整台记忆服务崩掉。这里改成块读 + 逐行回调，内存与文件大小无关。
     */
    /** 不把全部行堆进数组（2000 行×2M ≈ 4GB ⇒ OOM）：直接在事务里逐行处理 */
    const shiLi = this.db.prepare(
      'INSERT OR REPLACE INTO records (seq, id, session_id, kind, ts, ti, group_id, entity_type) VALUES (?,?,?,?,?,?,?,?)'
    );
    const insU = this.db.prepare('INSERT OR REPLACE INTO fts_uni (rowid, ti) VALUES (?, ?)');
    const insT = this.db.prepare('INSERT OR REPLACE INTO fts_tri (rowid, ti) VALUES (?, ?)');
    let xieRuShu = 0;
    const shiwu = this.db.transaction(() => {
      for (const Hang of meiHangLiu(this.jsonlPath)) {
        if (!Hang.trim()) continue;
        xieRuShu++;
        const r = JSON.parse(Hang) as JsonlJilu;
        const ti = String(r.ti ?? r.content ?? r.text ?? Hang);
        shiLi.run(r.seq, r.id, r.sessionId, r.kind, r.ts, ti, (r.groupId as string) ?? null, (r.entityType as string) ?? null);
        insU.run(r.seq, spaceChars(ti));
        insT.run(r.seq, ti);
        if (r.seq > this.seq) this.seq = r.seq;
      }
    });
    shiwu();
    this.db.prepare("INSERT OR REPLACE INTO meta (k,v) VALUES ('last_seq', ?)").run(String(this.seq));
    this.db.prepare("INSERT OR REPLACE INTO meta (k,v) VALUES ('schema_version', ?)").run(String(MOSHI_BANBEN));
    this.jsonlIndex = null;
    return xieRuShu;
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
    upgrade: ShengjiBaogao;
    coldStart: { rebuilt: boolean; HangJi: number; reason: string };
    vector: XiangliangZhuangtai & { error?: string; modelCandidates: string[] };
  } {
    const n = (sql: string) => (this.db.prepare(sql).get() as { n: number }).n;
    const suoYin = this.jsonlIndexOrBuild();
    return {
      schemaVersion: Number((this.db.prepare("SELECT v FROM meta WHERE k='schema_version'").get() as { v?: string } | undefined)?.v ?? 0),
      seq: this.seq,
      records: n('SELECT COUNT(*) AS n FROM records'),
      ftsUniDocs: this.indexedDocs('fts_uni'),
      ftsTriDocs: this.indexedDocs('fts_tri'),
      ftsTriPresent: this.tableExists('fts_tri'),
      vecRows: n('SELECT COUNT(*) AS n FROM vec_index'),
      jsonlLines: suoYin.entries.length,
      jsonlBytes: suoYin.size,
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

/** retrieve 的入参锚点 = 契约 `RetrieveRequest['anchor']`（至少给 seq 或 recordId 之一） */
export type JiansuoMaodianShuru = RetrieveRequest['anchor'];

interface YuanwenMingzhong {
  raw: string;
  seq: number;
  recordId: string;
  via: string;
}

/**
 * 投影里只放这么长的索引预览（第 44 轮后半 · 用户 #7）。
 * 原文一律在 JSONL；`retrieve` 取的是 JSONL 那份，所以截预览不会丢内容，只会少索引尾巴。
 */
const SUO_YIN_ZUI_DA_ZI = 16000;

interface JsonlSuoyinTiaomu {
  start: number;
  end: number;
  seq: number;
  id: string;
  ti: string;
}

interface JsonlSuoyin {
  size: number;
  mtimeMs: number;
  entries: JsonlSuoyinTiaomu[];
}

/** 同步分块逐行迭代（>2 GiB 文件安全；调用方只拿字符串行，不保留整文件） */
export function* meiHangLiu(jsonlPath: string, chunk = 8 * 1024 * 1024): Generator<string> {
  const buf = Buffer.allocUnsafe(chunk);
  const fd = fs.openSync(jsonlPath, 'r');
  try {
    let pos = 0;
    let carry = Buffer.alloc(0);
    for (;;) {
      const n = fs.readSync(fd, buf, 0, chunk, pos);
      if (n <= 0) break;
      const kuai = buf.subarray(0, n);
      let data: Buffer = carry.length ? Buffer.concat([carry, kuai]) : kuai;
      let from = 0;
      for (let i = 0; i < data.length; i++) {
        if (data[i] !== 0x0a) continue;
        yield data.subarray(from, i).toString('utf8');
        from = i + 1;
      }
      carry = Buffer.from(data.subarray(from));
      pos += n;
    }
    if (carry.length) yield carry.toString('utf8');
  } finally {
    try { fs.closeSync(fd); } catch { /* noop */ }
  }
}

/**
 * 扫描 JSONL 一次，记录每行的字节区间与关键字段（证据锚点 byteOffset 的真实落点）。
 *
 * **必须分块流式读**（第 51 轮真缺陷）：以前用 `readFileSync` 一次读全文件，
 * 长任务日志超过 2 GiB 时 Node 直接抛 `ERR_FS_FILE_TOO_LARGE`，
 * 记忆服务在「检索→建索引」这一步崩掉 ⇒ 整轮任务失败（压力档 1000 轮×2M 第 999 轮实测）。
 * 现在按 8 MiB 块读、跨块续行，内存占用与文件大小无关。
 */
export function gouJianJsonlSuoYin(jsonlPath: string): JsonlSuoyin {
  const empty: JsonlSuoyin = { size: 0, mtimeMs: 0, entries: [] };
  if (!fs.existsSync(jsonlPath)) return empty;
  const st = fs.statSync(jsonlPath);
  const entries: JsonlSuoyinTiaomu[] = [];
  const CHUNK = 8 * 1024 * 1024;
  const buf = Buffer.allocUnsafe(CHUNK);
  const fd = fs.openSync(jsonlPath, 'r');
  try {
    let pos = 0;
    /** 上一块末尾未闭合的行（拷贝出来，避免下一块覆写共享缓冲） */
    let carry = Buffer.alloc(0);
    /** carry 在文件中的绝对起始偏移 */
    let carryStart = 0;
    const tui = (lineBuf: Buffer, absStart: number, absEnd: number) => {
      const Hang = lineBuf.toString('utf8').trim();
      if (!Hang) return;
      let parsed: any = null;
      try { parsed = JSON.parse(Hang); } catch { return; }
      /**
       * 只存**预览**：全文按字节偏移现读（否则 2000 行×2M ≈ 4GB 常驻内存 ⇒ OOM）。
       * ⚠️ 必须**复制成独立字符串**：V8 的 `slice` 是 sliced string，会保留整条 4.7MB 原文的父串，
       * 于是"只存 500 字"依然把全文留在堆里（实测 RSS 线性涨到 4GB 后 OOM）。
       */
      const quan = String(parsed.ti ?? parsed.content ?? parsed.text ?? Hang);
      const ti = Buffer.from(quan.slice(0, 500), 'utf8').toString('utf8');
      entries.push({
        start: absStart,
        end: absEnd,
        seq: Number(parsed.seq ?? entries.length + 1),
        id: String(parsed.id ?? ''),
        ti,
      });
    };
    for (;;) {
      const n = fs.readSync(fd, buf, 0, CHUNK, pos);
      if (n <= 0) break;
      const kuai = buf.subarray(0, n);
      let data: Buffer = carry.length ? Buffer.concat([carry, kuai]) : kuai;
      let dataStart = carryStart;
      let from = 0;
      for (let i = 0; i < data.length; i++) {
        if (data[i] !== 0x0a) continue;
        const line = data.subarray(from, i);
        tui(line, dataStart + from, dataStart + i);
        from = i + 1;
      }
      carry = Buffer.from(data.subarray(from));
      carryStart = dataStart + from;
      pos += n;
    }
    if (carry.length) tui(carry, carryStart, carryStart + carry.length);
  } finally {
    try { fs.closeSync(fd); } catch { /* noop */ }
  }
  return { size: st.size, mtimeMs: st.mtimeMs, entries };
}

function gongyongQianzhuiChangdu(a: string, b: string): number {
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

function guiFanHuaChaXunCanShu(
  query: string | QueryLike,
  limit: number,
  opts: HuisuoXuanxiang
): { query: string; limit: number } & HuisuoXuanxiang {
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
export function qishiJiyiCangFuwuIpc(CangLu: string): JiyiCangFuwu {
  const fuwu = new JiyiCangFuwu({ CangLu });
  const faSong = (xiaoXi: any) => {
    try {
      process.send?.(xiaoXi);
    } catch {
      /* noop */
    }
  };
  /** 控制面消息按契约 `AcpKongzhiXiaoxi` 定形（宿主 memory-client 按同一份类型解析） */
  const jiuXu: AcpKongzhiXiaoxi = { type: 'ready', pid: process.pid, CangLu, schemaVersion: MOSHI_BANBEN };
  faSong(jiuXu);

  const handlers: Record<string, (xiaoXi: any) => Promise<any> | any> = {
    append: (xiaoXi) => {
      const jiLu = fuwu.append(xiaoXi.record, xiaoXi.Bi || 'memory-service');
      return { ok: true, seq: jiLu.seq };
    },
    tail: (xiaoXi) => ({ ok: true, records: fuwu.tail(xiaoXi.limit) }),
    /** 按会话分页的最近记录（用户 #6：重启恢复不许一个会话吃满整窗） */
    tail_per_session: (xiaoXi) => ({ ok: true, records: fuwu.tailPerSession(xiaoXi.meiHuiHua, xiaoXi.huiHuaShang) }),
    /** 完整三路 recall（fts_uni ∪ fts_tri ∪ 向量 → RRF），返回卡片 + 计时 + 作用域统计 */
    recall: async (xiaoXi) => {
      const detail = await fuwu.recallDetailed({ query: xiaoXi.query, scope: xiaoXi.scope, limit: xiaoXi.limit });
      return { ok: true, cards: detail.cards, timings: detail.timings, scopeStats: detail.scopeStats, channels: detail.channels, candidates: detail.candidates };
    },
    /** 同步 recall（不含异步向量水合），保持历史语义 */
    recall_sync: (xiaoXi) => {
      const detail = fuwu.recallDetailedSync({ query: xiaoXi.query, scope: xiaoXi.scope, limit: xiaoXi.limit });
      return { ok: true, cards: detail.cards, timings: detail.timings, scopeStats: detail.scopeStats, channels: detail.channels };
    },
    retrieve: (xiaoXi) => ({ ok: true, result: fuwu.retrieve(xiaoXi.anchor ?? xiaoXi.request ?? {}, xiaoXi.opts ?? {}) }),
    rebuild: (xiaoXi) => ({ ok: true, count: fuwu.rebuildProjection() }),
    vector_status: async () => {
      await fuwu.waitVectorReady();
      return { ok: true, vector: fuwu.vectorStatus() };
    },
    hydrate: async (xiaoXi) => ({ ok: true, result: await fuwu.hydrateVectors(xiaoXi.budget ?? 256) }),
    stats: () => ({ ok: true, stats: fuwu.stats() }),
    embed: async (xiaoXi) => {
      const v = await fuwu.embedText(xiaoXi.text);
      return { ok: true, dim: v?.length ?? 0, vector: v ? Array.from(v) : null };
    },
    guanBi: (xiaoXi) => {
      fuwu.close();
      setTimeout(() => process.exit(0), 20);
      return { ok: true };
    },
  };

  process.on('message', (xiaoXi: any) => {
    const { id, op } = xiaoXi || {};
    const h = handlers[op];
    if (!h) {
      faSong({ id, error: `unknown op ${op}` });
      return;
    }
    Promise.resolve()
      .then(() => h(xiaoXi))
      .then((res) => {
        if (op !== 'shutdown') faSong({ id, ...res });
      })
      .catch((e: any) => faSong({ id, error: String(e?.message || e), code: e?.code }));
  });
  return fuwu;
}

export * from './migrate.js';
export * from './lock.js';
export * from './vectors.js';
export * from './tokenizer.js';
export * from './embedder.js';
