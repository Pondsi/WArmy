/**
 * 上下文有界渲染器 —— ADR 002（ADR 000 §3.1 不变量 #2「视图有界」）
 *
 * 把"只追加日志"渲染成"注入给模型的有界视图"：
 *   - 大小恒 ≤ budgetChars，与日志总长度**解耦**（日志千万字，视图同量级）；
 *   - 被挤出视图的部分不丢，以三种冗余线索的可执行指针留在视图里
 *     （seq 范围 → retrieve({seq})；recordId → retrieve({recordId})；语义线索 → recall(hint)）；
 *   - 头尾逐字保留（系统提示冻结 + 近期对话原文），兼顾连贯性与 KV Cache 前缀稳定。
 *
 * 约束（ADR §4 / §7）：
 *   1. `viewBytes ≤ budgetChars` 是函数内**硬断言**，任何预算下都不得越界；
 *   2. 任何预算下都**不抛错**：超预算就先截断压缩要点、再缩 keepTail、再缩 keepHead，
 *      指针本身在还能放下时永不被截断（指针必须完整可执行）；
 *   3. 纯函数、无副作用、零 LLM（默认压缩器复用 @warmy/ccr-compressor 的规则型压缩）。
 *
 * 单位：viewBytes / logBytes / budgetChars 一律是**字符数**（UTF-16 code unit）。
 * ADR §8 明确"预算用字符近似 token"；而唯一的硬指标是 viewBytes ≤ budgetChars，
 * 只有两者同单位这条断言才自洽（若用 UTF-8 字节数，中文内容会被按 3 倍缩水）。
 * 需要字节数时由调用方另算（验证脚本会同时打印字符数与 UTF-8 字节数）。
 */
import { compress as ccrCompress } from '@warmy/ccr-compressor';

export interface LogEntry {
  /** 日志内的单调序号（决定裁剪顺序） */
  seq: number;
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** 记忆服务里的记录 id，供 retrieve 解引用；没有则用 seq */
  recordId?: string;
  ts?: number;
}

export interface RenderOptions {
  /** 视图总预算（字符）。与日志总长无关，这是"有界"的落点 */
  budgetChars: number;
  /** 头部逐字保留条数（系统提示等） */
  keepHead?: number;
  /** 尾部逐字保留条数（近期对话） */
  keepTail?: number;
  /** 被裁条目的压缩器，默认接 CcrGateway；纯函数，零 LLM */
  compress?: (entries: LogEntry[]) => string;
  /** 用于生成 recall 提示的查询串（一般取最近一条用户输入） */
  recallHint?: string;
}

export interface ElidedRange {
  fromSeq: number;
  toSeq: number;
  count: number;
  /**
   * 该段内的 recordId **采样**（有界，见 MAX_RANGE_RECORD_IDS）。
   * 完整覆盖不靠它，靠 `fromSeq..toSeq` 范围 + `recall(语义线索)`（ADR §5 / §9.4 待办 3）。
   */
  recordIds: string[];
}

export interface BoundedView {
  messages: Array<{ role: string; content: string }>;
  elided: ElidedRange[];
  stats: {
    logEntries: number;
    logBytes: number;
    viewBytes: number;
    budgetChars: number;
    pointers: number;
  };
}

/** 头部逐字保留默认条数（ADR §4.1） */
export const DEFAULT_KEEP_HEAD = 1;
/** 尾部逐字保留默认条数（ADR §4.1） */
export const DEFAULT_KEEP_TAIL = 8;
/**
 * 视图预算默认值（字符）。
 * settings-store 的 `contextBudgetChars` 默认取同一个常量，避免两处漂移。
 */
export const DEFAULT_CONTEXT_BUDGET_CHARS = 4000;

/**
 * 为「压缩要点」预留的预算份额下限。
 * 不加这个约束时，keepTail 会把预算吃到只剩几十字符给要点，
 * 于是"有界"成立了、但"压缩"这一半等于没做（ADR §9.4 待办 1）。
 */
export const DIGEST_MIN_SHARE = 0.25;

/** 中段压缩器的样本上限：渲染器必须是 O(视图) 而不是 O(日志)，所以只取中段头尾样本 */
const ENTRY_SAMPLE_MAX = 24;
const ENTRY_SAMPLE_CHARS = 240;
/** 样本再交一次 CCR（超过就折叠中段），保证"要点"本身也有界 */
const CCR_SAMPLE_BUDGET = 8000;
/** 指针里最多列出的 recordId / seq 段数（结构化 elided 仍是完整的） */
const MAX_POINTER_IDS = 4;
const MAX_POINTER_RANGES = 4;
/** recallHint 在指针里的截断长度 */
const HINT_MAX_CHARS = 24;

/**
 * 每个 elided 段最多保留的 recordId 数（ADR §9.4 待办 3）。
 *
 * 原实现把段内**所有** recordId 都塞进 `ElidedRange.recordIds`，
 * 渲染代价（内存 + 指针拼接 + includes 去重）随日志条数线性放大的部分就在这儿：
 * n=10000 时 1.9ms 还能接受，n≈1e6 时会变成几十 MB 的数组与上百 ms 的拼接。
 *
 * 现在改成**有界采样**：段首 4 个 + 段尾 4 个（两端各留一半，比只取前 N 个更有代表性，
 * 因为"最近的被省略条目"往往是模型最想要的）。接口不变（`recordIds` 仍是 string[]），
 * 被省略的完整覆盖由 `fromSeq..toSeq`（retrieve(seq) 精确命中）与 `recall(hint)` 保证。
 */
export const MAX_RANGE_RECORD_IDS = 8;
/** 段内 recordId 采样的头/尾配额 */
const RANGE_ID_HEAD = 4;
const RANGE_ID_TAIL = MAX_RANGE_RECORD_IDS - RANGE_ID_HEAD;

type Tier = 'full' | 'compact' | 'min';
const TIERS: Tier[] = ['full', 'compact', 'min'];

interface RangeDraft extends ElidedRange {
  lastSeq: number;
  /** 段尾采样的环形缓冲（长度 ≤ RANGE_ID_TAIL） */
  tailIds: string[];
}

function coerceText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return '';
  try {
    return String(v);
  } catch {
    return '';
  }
}

function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return dflt;
  const i = Math.floor(n);
  if (i < lo) return lo;
  if (i > hi) return hi;
  return i;
}

/** 不建议按字符切断代理对（会产出半个 emoji） */
function isHighSurrogate(ch: string | undefined): boolean {
  if (!ch) return false;
  const c = ch.charCodeAt(0);
  return c >= 0xd800 && c <= 0xdbff;
}

function clipTailSafe(s: string, max: number): string {
  if (max <= 0) return '';
  if (s.length <= max) return s;
  let out = s.slice(0, max);
  if (isHighSurrogate(out[out.length - 1])) out = out.slice(0, -1);
  return out;
}

function fmtNum(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 中段单条样本行 */
function sampleLine(e: LogEntry): string {
  const body =
    e.content.length > ENTRY_SAMPLE_CHARS ? e.content.slice(0, ENTRY_SAMPLE_CHARS) + '…' : e.content;
  return `#${e.seq} ${e.role}: ${body}`;
}

/**
 * 默认压缩器（ADR §4.4「中间段交 compress()，复用 CcrGateway」）：
 * 零 LLM、纯函数；先取中段的头尾样本（有界），再交 ccr-compressor 的规则型压缩，
 * 所以渲染一条视图的代价是 O(视图)，与日志总长解耦。
 * 样本覆盖不到的部分由指针 + retrieve/recall 兜底（不丢细节）。
 */
function defaultCompress(entries: LogEntry[]): string {
  if (!entries.length) return '';
  const half = Math.floor(ENTRY_SAMPLE_MAX / 2);
  const picked: string[] = [];
  if (entries.length <= ENTRY_SAMPLE_MAX) {
    for (const e of entries) picked.push(sampleLine(e));
  } else {
    for (const e of entries.slice(0, half)) picked.push(sampleLine(e));
    picked.push(`… [样本省略 ${entries.length - half * 2} 条] …`);
    for (const e of entries.slice(-half)) picked.push(sampleLine(e));
  }
  const joined = picked.join('\n');
  try {
    return ccrCompress({ kind: 'message', content: joined }, CCR_SAMPLE_BUDGET).content;
  } catch {
    return joined; // 压缩器抛错不能连累视图
  }
}

/**
 * 把 [from, to) 切成连续 seq 的段；每个段带齐 recordIds 冗余线索（**有界采样**）。
 * 时间与内存都是 O(日志) 的常数因子：只存段首/段尾各几个 id，不再把段内全部 id 堆起来。
 */
function rangesOf(log: LogEntry[], from: number, to: number): ElidedRange[] {
  const drafts: RangeDraft[] = [];
  let cur: RangeDraft | null = null;
  for (let i = from; i < to; i++) {
    const e = log[i]!;
    if (cur && e.seq !== cur.lastSeq + 1) cur = null;
    if (!cur) {
      cur = {
        fromSeq: e.seq,
        toSeq: e.seq,
        count: 0,
        recordIds: [],
        lastSeq: e.seq,
        tailIds: [],
      };
      drafts.push(cur);
    }
    cur.count += 1;
    cur.toSeq = e.seq;
    cur.lastSeq = e.seq;
    if (e.recordId) {
      if (cur.recordIds.length < RANGE_ID_HEAD) {
        cur.recordIds.push(e.recordId);
      } else if (RANGE_ID_TAIL > 0) {
        cur.tailIds.push(e.recordId);
        if (cur.tailIds.length > RANGE_ID_TAIL) cur.tailIds.shift();
      }
    }
  }
  return drafts.map((d) => {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const id of [...d.recordIds, ...d.tailIds]) {
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    return { fromSeq: d.fromSeq, toSeq: d.toSeq, count: d.count, recordIds: ids };
  });
}

function rangeText(ranges: ElidedRange[]): string {
  const shown = ranges.slice(0, MAX_POINTER_RANGES).map((r) => `${r.fromSeq}..${r.toSeq}`);
  const tail = ranges.length > MAX_POINTER_RANGES ? ',…' : '';
  return `seq ${shown.join(',')}${tail}`;
}

/**
 * 指针里的可执行线索（seq 范围 + recordId + 语义线索，ADR §5）。
 *
 * recordId 是**有界采样**（每段最多 MAX_RANGE_RECORD_IDS 个），所以这里不再声称
 * "还有 +N 个 id"，只列出来的这几条；完整覆盖靠 seq 范围与 recall（ADR §9.4 待办 3）。
 */
function anchorText(ranges: ElidedRange[], hint: string, maxIds: number): string {
  const parts: string[] = [];
  if (ranges.length) parts.push(`retrieve(seq=${ranges[0]!.fromSeq})`);
  const ids: string[] = [];
  for (const r of ranges) {
    for (const id of r.recordIds) {
      if (ids.length >= maxIds) break;
      if (!ids.includes(id)) ids.push(id);
    }
    if (ids.length >= maxIds) break;
  }
  const idSlots = ranges.reduce((s, r) => s + r.recordIds.length, 0);
  if (ids.length) {
    parts.push(`retrieve(recordId="${ids.join('", "')}"${idSlots > ids.length ? ', …' : ''})`);
  }
  if (hint) parts.push(`recall("${hint}")`);
  return parts.join(' 或 ');
}

/**
 * 指针前缀（= 不含"要点"正文的指针消息）。
 * 三级冗余：full（完整可读）→ compact（紧凑）→ min（极简，仅可执行线索）。
 * 指针正文永远先于头尾被牺牲，所以只要还放得下，指针就是完整的。
 */
function pointerPrefix(tier: Tier, ranges: ElidedRange[], hint: string, elidedChars: number): string {
  const count = ranges.reduce((s, r) => s + r.count, 0);
  const rt = rangeText(ranges);
  if (tier === 'full') {
    return (
      `[已省略 ${count} 条历史，${rt}，共 ${fmtNum(elidedChars)} 字]\n` +
      `如需原文，可调用 ${anchorText(ranges, hint, MAX_POINTER_IDS)} 取回逐字节内容（如本会话提供这两个工具，可直接调用）。\n` +
      `以下是被压缩的要点：\n`
    );
  }
  if (tier === 'compact') {
    return (
      `[已省略 ${count} 条，${rt}，共 ${fmtNum(elidedChars)} 字] ` +
      `${anchorText(ranges, hint, 1)} 取回逐字节原文。要点：\n`
    );
  }
  return `[省略 ${count} 条 ${rt}] ${anchorText(ranges, hint, 1)} 取回原文。`;
}

/** 极端预算下的兜底：无论如何都要 viewBytes ≤ budgetChars */
function hardClamp(
  msgs: Array<{ role: string; content: string }>,
  budget: number
): Array<{ role: string; content: string }> {
  const out: Array<{ role: string; content: string }> = [];
  let used = 0;
  for (const m of msgs) {
    const room = budget - used;
    if (room <= 0) break;
    if (m.content.length <= room) {
      out.push({ role: m.role, content: m.content });
      used += m.content.length;
    } else {
      const cut = clipTailSafe(m.content, room);
      if (cut) out.push({ role: m.role, content: cut });
      break;
    }
  }
  return out;
}

/**
 * 渲染有界视图（ADR §4）。
 * 纯函数：不读写任何外部状态，同一个 (entries, opts) 永远给出同一个结果。
 */
export function renderBoundedView(entries: LogEntry[], opts: RenderOptions): BoundedView {
  // ── 0. 输入清洗：任何输入（含脏数据）都不抛错 ──
  const rawIn = Array.isArray(entries) ? entries : [];
  const log: LogEntry[] = [];
  for (let i = 0; i < rawIn.length; i++) {
    const e = rawIn[i] as Record<string, unknown> | null | undefined;
    if (!e || typeof e !== 'object') continue;
    const roleRaw = e['role'];
    const role: LogEntry['role'] =
      roleRaw === 'system' || roleRaw === 'assistant' ? roleRaw : 'user';
    const seqRaw = Number(e['seq']);
    const tsRaw = Number(e['ts']);
    const rid = e['recordId'];
    log.push({
      seq: Number.isFinite(seqRaw) ? seqRaw : i + 1,
      role,
      content: coerceText(e['content']),
      recordId: typeof rid === 'string' && rid.length > 0 ? rid : undefined,
      ts: Number.isFinite(tsRaw) ? tsRaw : undefined,
    });
  }

  const n = log.length;
  /** 前缀和：头/尾/中段字符数都 O(1) 取到 */
  const prefix = new Array<number>(n + 1);
  prefix[0] = 0;
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i]! + log[i]!.content.length;
  const logBytes = prefix[n]!;

  const o = (opts && typeof opts === 'object' ? opts : {}) as RenderOptions;
  const budgetNum = Number(o.budgetChars);
  const budgetChars = Number.isFinite(budgetNum)
    ? Math.max(0, Math.floor(budgetNum))
    : DEFAULT_CONTEXT_BUDGET_CHARS;

  const headWant = clampInt(o.keepHead, 0, n, Math.min(DEFAULT_KEEP_HEAD, n));
  const tailWant = clampInt(
    o.keepTail,
    0,
    Math.max(0, n - headWant),
    Math.min(DEFAULT_KEEP_TAIL, Math.max(0, n - headWant))
  );
  const hint = coerceText(o.recallHint).replace(/\s+/g, ' ').trim().slice(0, HINT_MAX_CHARS);
  const compressFn = typeof o.compress === 'function' ? o.compress : defaultCompress;

  const mkStats = (viewBytes: number, pointers: number) => ({
    logEntries: n,
    logBytes,
    viewBytes,
    budgetChars,
    pointers,
  });

  const countChars = (msgs: Array<{ role: string; content: string }>) =>
    msgs.reduce((s, m) => s + m.content.length, 0);

  // 空日志：视图就是空的
  if (n === 0) return { messages: [], elided: [], stats: mkStats(0, 0) };
  // 预算为 0：不产出任何消息，但把"全部被省略"如实报出（依然不抛错）
  if (budgetChars <= 0) {
    return { messages: [], elided: rangesOf(log, 0, n), stats: mkStats(0, 0) };
  }

  // 中段要点（按 (headN, tailN) 记忆；压缩器可能很贵，且可能抛错）
  const digestCache = new Map<string, string>();
  const digestOf = (headN: number, tailN: number): string => {
    const key = `${headN}:${tailN}`;
    const hit = digestCache.get(key);
    if (hit !== undefined) return hit;
    let out = '';
    const mid = log.slice(headN, n - tailN);
    if (mid.length) {
      try {
        out = coerceText(compressFn(mid));
      } catch {
        out = ''; // 压缩器抛错不能连累视图
      }
    }
    digestCache.set(key, out);
    return out;
  };

  let messages: Array<{ role: string; content: string }> = [];
  let elided: ElidedRange[] = [];
  let pointers = 0;
  let satisfied = false;

  // ── 1. 逐级降配：先截断要点，再缩 keepTail，再缩 keepHead；指针最后才动 ──
  // ADR §9.4 待办 1：要点若被头尾挤到只剩几十字符，"压缩"这一半就白做了。
  // 所以先按「要点至少占预算 DIGEST_MIN_SHARE」搜一遍——total 从大到小遍历，
  // 第一个满足条件的即"尽可能多留头尾、同时要点拿到应有份额"的最优解；
  // 若连 total=0 都满足不了（预算极小），再退回原策略，绝不因要点份额丢掉近期对话。
  const minDigest = Math.ceil(budgetChars * DIGEST_MIN_SHARE);
  const attempt = (enforceDigestShare: boolean): boolean => {
    for (const tier of TIERS) {
      const hasBody = tier !== 'min';
      for (let total = headWant + tailWant; total >= 0; total--) {
        // ADR §4.3：优先缩 keepTail，再缩 keepHead（tail 先被牺牲）
        const h = Math.min(headWant, total);
        const t = total - h;
        const headMsgs = log.slice(0, h).map((e) => ({ role: e.role as string, content: e.content }));
        const tailMsgs = log.slice(n - t).map((e) => ({ role: e.role as string, content: e.content }));
        const headTailChars = prefix[h]! + (prefix[n]! - prefix[n - t]!);

        const omitted = h + t < n;
        const ranges = omitted ? rangesOf(log, h, n - t) : [];
        const elidedChars = omitted ? logBytes - headTailChars : 0;
        const pre = omitted ? pointerPrefix(tier, ranges, hint, elidedChars) : '';
        const cap = budgetChars - headTailChars - pre.length;
        if (cap < 0) continue; // 连指针都放不下 → 继续缩头尾 / 降级指针
        // 有省略、且该档要点有正文时，才要求要点拿到份额
        if (enforceDigestShare && omitted && hasBody && cap < minDigest) continue;

        const body = omitted && hasBody ? clipTailSafe(digestOf(h, t), cap) : '';
        const msgs = omitted
          ? [...headMsgs, { role: 'system', content: pre + body }, ...tailMsgs]
          : [...headMsgs, ...tailMsgs];
        if (countChars(msgs) > budgetChars) continue; // 双保险：绝不超过预算

        messages = msgs;
        elided = ranges;
        pointers = ranges.length; // 完整可执行的指针条数
        return true;
      }
    }
    return false;
  };
  satisfied = attempt(true) || attempt(false);

  // ── 2. 兜底：连最小指针都放不下（极端预算）——截断指针而不是抛错 ──
  if (!satisfied) {
    elided = rangesOf(log, 0, n);
    const minText = pointerPrefix('min', elided, hint, logBytes);
    const text = clipTailSafe(minText, budgetChars);
    messages = text ? [{ role: 'system', content: text }] : [];
    pointers = 0; // 指针被截断 → 不可执行，如实记 0 条
  }

  // ── 3. 硬指标：viewBytes ≤ budgetChars（不允许抛错，所以用裁剪而非 throw 落地）──
  let viewBytes = countChars(messages);
  if (viewBytes > budgetChars) {
    messages = hardClamp(messages, budgetChars);
    viewBytes = countChars(messages);
  }

  return { messages, elided, stats: mkStats(viewBytes, pointers) };
}
