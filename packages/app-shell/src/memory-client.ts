/**
 * 记忆服务长驻子进程客户端（主进程侧，零 .node）
 *
 * 除 IPC 封装外，这里还承担 ADR 002 §9.4 待办 2 的**宿主侧工具**：
 *   - `memoryToolSpecs()`：把 `recall` / `retrieve` 暴露给模型（function calling）；
 *   - `runMemoryTool()`：执行模型发来的工具调用，把结果整理成"回给模型的文本"。
 * 指针里的三种线索（seq 范围 / recordId / 语义）正好是这两个工具的入参。
 */
import { fork, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { ToolCall, ToolSpec } from '@warmy/providers';

export interface MemoryClientOptions {
  nodePath?: string;
  ipcEntry: string;
  dataDir: string;
}

export class MemoryClient {
  private child: ChildProcess | null = null;
  private seq = 0;
  private ready = false;
  private starting: Promise<void> | null = null;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();

  constructor(private opts: MemoryClientOptions) {}

  /** 记忆服务是否可用（工具暴露与日志重建都以它为准；不可用一律走降级路径） */
  get isReady(): boolean {
    return this.ready && !!this.child;
  }

  async start(): Promise<void> {
    if (this.isReady) return;
    // 已经在启动中：复用同一个 promise，避免第二次调用把正在起来的子进程 kill 掉
    if (this.starting) return this.starting;
    this.starting = this.startOnce().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async startOnce(): Promise<void> {
    // 上一次没起来（崩溃/启动超时）：先清掉再重开，否则永远卡在 half-open 状态
    if (this.child) {
      try {
        this.child.kill();
      } catch {
        /* ignore */
      }
      this.child = null;
    }
    this.ready = false;
    const execPath = this.opts.nodePath || process.execPath;
    // 只有在拿 Electron 二进制兜底当 Node 时才需要这个开关；
    // 用真正的 node.exe 时设了也无害，但不设的话 electron 会当普通 GUI 启动并立刻崩。
    const useElectronAsNode = /electron(\.exe)?$/i.test(execPath);
    this.child = fork(this.opts.ipcEntry, [], {
      execPath,
      execArgv: [],
      env: {
        ...process.env,
        CCA_ARMY_MEMORY_DIR: this.opts.dataDir,
        ...(useElectronAsNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    this.child.on('message', (m: any) => {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error));
      else p.resolve(m);
    });
    this.child.on('exit', () => {
      // 子进程死了 → 立刻标记不可用，避免后续工具调用/重建挂在超时上
      this.ready = false;
    });
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('memory service start timeout')), 10_000);
      this.child!.once('message', (m: any) => {
        if (m?.type === 'ready') {
          clearTimeout(t);
          resolve();
        }
      });
      this.child!.once('error', (e) => {
        clearTimeout(t);
        reject(e);
      });
    });
    this.ready = true;
  }

  private call(msg: Record<string, unknown>, timeoutMs = 8000): Promise<any> {
    if (!this.child) throw new Error('memory service not started');
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('memory ipc timeout'));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(t);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(t);
          reject(e);
        },
      });
      this.child!.send({ ...msg, id });
    });
  }

  append(
    record: {
      id: string;
      sessionId: string;
      kind: string;
      body: string;
      /**
       * 角色（可选）。memory-os 会把它一起写进 JSONL（`...record`），
       * 但 SQLite 投影 / `tail()` 查不到它 —— 所以重建时仍以 recordId 前缀为准（见 CHAT_RECORD_PREFIX），
       * 这里落一份只是将来有"读 JSONL 的 IPC"时能直接用字段。
       */
      role?: 'user' | 'assistant';
      [k: string]: unknown;
    },
    writer = 'duty'
  ) {
    return this.call({ op: 'append', record, writer });
  }

  tail(limit = 20) {
    return this.call({ op: 'tail', limit });
  }

  recall(query: string, limit = 10) {
    return this.call({ op: 'recall', query, limit });
  }

  retrieve(anchor: { seq?: number; recordId?: string }) {
    return this.call({ op: 'retrieve', anchor });
  }

  async stop(): Promise<void> {
    if (!this.child) return;
    try {
      await this.call({ op: 'shutdown' }, 2000);
    } catch {
      this.child.kill();
    }
    this.child = null;
    this.ready = false;
  }
}

// ─────────────────────────────────────────────
// 工具：recall / retrieve（ADR 002 §9.4 待办 2）
// ─────────────────────────────────────────────

/** 工具名（与指针文本里的写法保持一致：`recall(…)` / `retrieve(…)`） */
export const MEMORY_TOOL_NAMES = { recall: 'recall', retrieve: 'retrieve' } as const;

/** 单次工具结果上限（字符）；与视图预算同量级，防止"取回原文"把上下文撑成无界 */
export const MEMORY_TOOL_RESULT_CHARS = 4000;
/** recall 返回的卡片数上限 */
export const MEMORY_TOOL_MAX_CARDS = 20;
/** 一次 retrieve 最多返回的字符数（模型可要求更小，但不能要求更大） */
export const MEMORY_TOOL_MAX_RETRIEVE_CHARS = 8000;

export interface MemoryToolLabels {
  /** recall 工具描述（何时用 / 入参 / 返回） */
  recall: string;
  /** retrieve 工具描述 */
  retrieve: string;
  queryParam: string;
  limitParam: string;
  recordIdParam: string;
  seqParam: string;
  offsetParam: string;
  maxCharsParam: string;
}

/**
 * 默认工具描述（中文）。文案刻意说清「何时用 / 入参 / 返回」，
 * 因为指针文本里已经点名了这两个工具，描述要与之对齐（ADR §5）。
 */
export const DEFAULT_MEMORY_TOOL_LABELS: MemoryToolLabels = {
  recall:
    '按语义/关键词在被省略的会话历史里检索。当视图里出现「[已省略 N 条历史 …]」指针，' +
    '而你需要其中某个细节（谁说了什么、某段结论/数值/路径）时**必须**调用它，不要凭空猜测。' +
    '入参：query（检索串，用问题原句或关键实体），limit（可选，1-20，默认 5）。' +
    '返回：命中的前 limit 条卡片，每条含 seq、recordId、片段摘要与命中来源；' +
    '再对其中任一条调用 retrieve 可拿到逐字节原文。',
  retrieve:
    '按 seq 或 recordId 取回被省略历史的**逐字节原文**。指针里给出了 seq 范围与 recordId 样例，优先用它。' +
    '入参：recordId（字符串）或 seq（整数）二选一，可选 offset（起始字符，默认 0）与 maxChars（单次上限，默认 4000）。' +
    '返回：原文片段；若被截断会注明原文总长与下一段 offset，用同样的 offset 继续取即可拼回全文。',
  queryParam: '检索串。用关键词或用户问题的原句，中文可直接整句。',
  limitParam: '返回卡片数（1-20，默认 5）',
  recordIdParam: '记录 id（指针里的 recordId="m-…"）',
  seqParam: '日志序号（指针里的 seq N..M 里的任意一个整数）',
  offsetParam: '起始字符偏移（默认 0；用于分段取回超长记录）',
  maxCharsParam: '单次最多返回的字符数（默认 4000，上限 8000）',
};

/** 给模型看的工具清单（function calling） */
export function memoryToolSpecs(labels: Partial<MemoryToolLabels> = {}): ToolSpec[] {
  const L: MemoryToolLabels = { ...DEFAULT_MEMORY_TOOL_LABELS, ...(labels || {}) };
  return [
    {
      type: 'function',
      function: {
        name: MEMORY_TOOL_NAMES.recall,
        description: L.recall,
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: L.queryParam },
            limit: {
              type: 'integer',
              description: L.limitParam,
              minimum: 1,
              maximum: MEMORY_TOOL_MAX_CARDS,
            },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: MEMORY_TOOL_NAMES.retrieve,
        description: L.retrieve,
        parameters: {
          type: 'object',
          properties: {
            recordId: { type: 'string', description: L.recordIdParam },
            seq: { type: 'integer', description: L.seqParam },
            offset: { type: 'integer', description: L.offsetParam, minimum: 0 },
            maxChars: {
              type: 'integer',
              description: L.maxCharsParam,
              minimum: 1,
              maximum: MEMORY_TOOL_MAX_RETRIEVE_CHARS,
            },
          },
          // 两种线索任选其一即可解引用（ADR §5）
          anyOf: [{ required: ['recordId'] }, { required: ['seq'] }],
        },
      },
    },
  ];
}

export interface MemoryToolMeta {
  tool: string;
  ok: boolean;
  /** 回给模型的文本长度（字符） */
  chars: number;
  /** 解引用锚点（审计/指标用，非敏感） */
  anchor?: { seq?: number; recordId?: string; offset?: number };
  queryChars?: number;
  cards?: number;
  hitLevel?: string;
  /** 是否发生了分段截断（原文比单次上限长） */
  truncated?: boolean;
  totalChars?: number;
  nextOffset?: number;
  /** 失败原因（已脱敏，不含密钥） */
  error?: string;
}

export interface MemoryToolOutcome {
  ok: boolean;
  /** 直接作为 tool 消息回给模型的文本 */
  content: string;
  chars: number;
  meta: MemoryToolMeta;
}

function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return dflt;
  const i = Math.floor(n);
  if (i < lo) return lo;
  if (i > hi) return hi;
  return i;
}

/** 不切出半个代理对 */
function clipSafe(s: string, max: number): string {
  if (max <= 0) return '';
  if (s.length <= max) return s;
  let out = s.slice(0, max);
  const c = out.charCodeAt(out.length - 1);
  if (c >= 0xd800 && c <= 0xdbff) out = out.slice(0, -1);
  return out;
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  try {
    const v = JSON.parse(String(raw ?? '{}'));
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function sanitize(e: unknown): string {
  const raw = e instanceof Error ? e.message || e.name : String(e);
  const first = String(raw ?? '').split('\n')[0] ?? '';
  return first
    .replace(/[A-Za-z]:\\[^\s"'<>|]+/g, '<path>')
    .replace(/\/(?:Users|home|var|tmp|opt|mnt)\/[^\s"'<>|]*/g, '<path>')
    .slice(0, 160);
}

/**
 * 执行模型发来的工具调用。
 *
 * **绝不抛错**：任何异常都变成 ok:false + 可读文本回给模型
 * （模型据此改换锚点/放弃，而不是把整轮对话打成 error）。
 */
export async function runMemoryTool(
  client: MemoryClient | null,
  call: ToolCall,
  opts: { maxChars?: number } = {}
): Promise<MemoryToolOutcome> {
  const name = call?.function?.name || '';
  const args = parseArgs(call?.function?.arguments);
  const cap = clampInt(opts.maxChars, 64, MEMORY_TOOL_MAX_RETRIEVE_CHARS, MEMORY_TOOL_RESULT_CHARS);
  const meta: MemoryToolMeta = { tool: name, ok: false, chars: 0 };
  const fail = (msg: string, error?: string): MemoryToolOutcome => {
    meta.ok = false;
    meta.chars = msg.length;
    if (error) meta.error = error.slice(0, 120);
    return { ok: false, content: msg, chars: msg.length, meta };
  };

  try {
    if (!client) return fail('记忆服务不可用：当前会话没有可解引用的历史，请直接基于已有上下文作答。', 'memory-client-missing');
    if (!client.isReady) return fail('记忆服务尚未就绪（正在启动或已退出）：无法取回被省略的历史，请直接基于已有上下文作答。', 'memory-not-ready');

    if (name === MEMORY_TOOL_NAMES.recall) {
      const query = String(args['query'] ?? '').replace(/\s+/g, ' ').trim();
      meta.queryChars = query.length;
      if (!query) return fail('recall 需要 query 参数（检索串），例：recall("值班者状态机")。', 'bad-args');
      const limit = clampInt(args['limit'], 1, MEMORY_TOOL_MAX_CARDS, 5);
      const res = await client.recall(query, limit);
      const cards: Array<{ seq?: number; recordId?: string; snippet?: string; score?: number; source?: string; sources?: string[] }> =
        Array.isArray(res?.cards) ? res.cards : [];
      meta.cards = cards.length;
      if (!cards.length) {
        const none = `recall("${query}") 没有命中任何历史记录（可能该内容不在记忆里）。可换关键词重试，或直接用指针里的 retrieve(seq=…) 精确取回。`;
        return fail(none);
      }
      const lines = cards.map((c, i) => {
        const src = c.source || (Array.isArray(c.sources) ? c.sources.join('+') : '');
        const snip = String(c.snippet ?? '').replace(/\s+/g, ' ').slice(0, 160);
        return `${i + 1}) seq=${c.seq ?? '?'} recordId=${c.recordId ?? '?'}${src ? ` 来源=${src}` : ''}\n   片段：${snip}`;
      });
      const head = `recall("${query}", limit=${limit}) 命中 ${cards.length} 条：\n`;
      const tailMsg =
        `\n提示：用 retrieve(recordId="…") 或 retrieve(seq=…) 取回**逐字节**原文；` +
        `超长记录可用 offset/maxChars 分段取。`;
      let text = head + lines.join('\n') + tailMsg;
      let truncated = false;
      if (text.length > cap) {
        truncated = true;
        text = clipSafe(text, cap) + `\n…[卡片列表被截断，本次上限 ${cap} 字符]`;
      }
      meta.ok = true;
      meta.chars = text.length;
      meta.truncated = truncated;
      meta.anchor = { recordId: cards[0]?.recordId, seq: cards[0]?.seq };
      return { ok: true, content: text, chars: text.length, meta };
    }

    if (name === MEMORY_TOOL_NAMES.retrieve) {
      const ridRaw = args['recordId'];
      const recordId = typeof ridRaw === 'string' && ridRaw.trim() ? ridRaw.trim() : undefined;
      const seqNum = Number(args['seq']);
      const seq = Number.isFinite(seqNum) ? Math.floor(seqNum) : undefined;
      if (!recordId && seq === undefined) {
        return fail('retrieve 需要 recordId 或 seq 之一，例：retrieve(seq=12) / retrieve(recordId="m-…")。', 'bad-args');
      }
      const offset = clampInt(args['offset'], 0, 100_000_000, 0);
      const want = clampInt(args['maxChars'], 1, MEMORY_TOOL_MAX_RETRIEVE_CHARS, cap);
      const limit = Math.min(want, cap, MEMORY_TOOL_MAX_RETRIEVE_CHARS);
      meta.anchor = { seq, recordId, offset };
      const res = await client.retrieve(recordId ? { recordId } : { seq: seq! });
      const out = res?.result ?? res;
      const raw = typeof out?.raw === 'string' ? out.raw : '';
      if (!raw) {
        const miss = `retrieve(${recordId ? `recordId="${recordId}"` : `seq=${seq}`}) 没找到记录。可改用 recall("关键词") 按语义检索，或用指针里的 seq 范围换个序号。`;
        return fail(miss, 'not-found');
      }
      meta.hitLevel = typeof out?.hitLevel === 'string' ? out.hitLevel : undefined;
      meta.totalChars = raw.length;
      const piece = raw.slice(offset, offset + limit);
      const truncated = offset + piece.length < raw.length;
      // 记忆服务的 retrieve 是分级回退（exact → nearby → fuzzy）：非 exact 时必须**明说**，
      // 否则模型会把"另一个相近记录"当成它要的那条（这比拿不到原文更危险）。
      const notExact = !!meta.hitLevel && meta.hitLevel !== 'exact';
      let text =
        `retrieve(${recordId ? `recordId="${recordId}"` : `seq=${seq}`}) 命中` +
        `${meta.hitLevel ? `(${meta.hitLevel})` : ''}：原文 ${raw.length} 字符` +
        `${offset || truncated ? `，本次返回 [${offset}, ${offset + piece.length})` : ''}\n` +
        (notExact
          ? `⚠ 这不是精确命中（记忆服务做了 ${meta.hitLevel} 回退）：请核对 seq/recordId，` +
            `或用 recall("关键词") 按语义确认后再引用。\n`
          : '') +
        `——原文——\n${piece}`;
      if (truncated) {
        const next = offset + piece.length;
        text +=
          `\n…[本段到此为止；原文还有 ${raw.length - next} 字符，继续取可用 ` +
          `${recordId ? `retrieve(recordId="${recordId}"` : `retrieve(seq=${seq}`}, offset=${next})]`;
        meta.nextOffset = next;
      }
      meta.truncated = truncated;
      if (text.length > limit + 400) text = clipSafe(text, limit + 400);
      meta.ok = true;
      meta.chars = text.length;
      return { ok: true, content: text, chars: text.length, meta };
    }

    return fail(
      `未知工具 "${name}"：本会话只提供 recall(query) 与 retrieve(recordId|seq)。请改用这两个之一。`,
      'unknown-tool'
    );
  } catch (e) {
    // 超时/子进程挂掉等：不抛错，回一句可读原因让模型自己决定下一步
    return fail(`工具 ${name || '?'} 执行失败：${sanitize(e)}`, 'exec-error');
  }
}

/** 内容摘要（重启历史校验用：不落正文，只落长度与哈希） */
export function contentDigest(s: string): string {
  return createHash('sha256').update(String(s ?? ''), 'utf8').digest('hex').slice(0, 16);
}

// ─────────────────────────────────────────────
// 会话日志（fast-memory.jsonl）的角色约定 —— ADR 002 §9.4 待办 4
// ─────────────────────────────────────────────

/**
 * recordId 前缀 = 角色（不变量 #5 的重建契约）。
 *
 * 为什么只能靠前缀：memory-os 的 SQLite 投影只有 seq/id/session_id/kind/ts/body，
 * `tail()` 读的是投影，取不到 JSONL 记录上的额外字段（我们写进去的 role 会被丢掉）。
 * 所以"重启后从 fast-memory.jsonl 重建 chatLogs"必须能从 id 看出角色，
 * 而 id 是**我们**自己生成的（`newChatRecordId(prefix)`），这条约定是可信的。
 */
export const CHAT_RECORD_PREFIX = {
  /** 普通会话里的用户消息 */
  user: 'm',
  /** 群/值班者会话里的用户消息 */
  dutyUser: 'g',
  /** 助手回复 */
  assistant: 'a',
} as const;

/** 由 recordId 还原本条记录的角色（前缀 `a-` = assistant，其余按用户消息算） */
export function chatRoleOfRecordId(id: unknown): 'user' | 'assistant' {
  return /^a[-_]/i.test(String(id ?? '')) ? 'assistant' : 'user';
}

