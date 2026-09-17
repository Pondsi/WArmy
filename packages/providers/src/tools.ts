/**
 * 多轮工具调用循环（function calling）—— ADR 002 §9.4 待办 2
 *
 * 背景：上下文有界渲染器把"被省略的历史"留成可执行指针
 * （`retrieve(recordId=…)/retrieve(seq=…)/recall(…)`），但 `provider.chat` 之前**没传 tools**，
 * 模型根本无法当轮解引用 —— "不丢细节"只对宿主成立。本文件把这条链路补齐：
 *
 *   模型要工具 → 宿主执行（recall/retrieve 走记忆服务）→ 结果回给模型 → 再问 → 终答
 *
 * 设计约束：
 *   1. **有界**：`maxRounds` 限工具轮数，`maxToolResultChars` 限工具结果**总**预算，
 *      `maxResultChars` 限单条结果。任何一环都不可能把视图撑破（不变量 #2 的延伸）；
 *   2. **不抛错**：工具执行抛错 → 变文本回给模型（让模型自己决定下一步），不炸整轮对话；
 *      轮数/预算用尽 → 强制一次 `tool_choice:'none'` 收敛成文本答案（同样不抛错）；
 *   3. **优雅降级**：调用方没给 tools、开关关掉、协议不支持 tools（如 Ollama）、
 *      或首次带 tools 的请求直接报错（中转/模型不吃 tools）→ 退回"现状"的普通单轮对话，**不报错**；
 *   4. 协议映射已在 openai.ts / anthropic.ts 里完成（tools / tool_calls / tool_result），本文件不碰 HTTP。
 */
import { clipTailSafe } from './util.js';
import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ModelProvider,
  ProviderProtocol,
  ToolCall,
} from './types.js';

/**
 * 协议级工具调用能力表。
 * Ollama `/api/chat` 只对部分模型支持 tools，且旧版本会直接报错 —— 保守按"不支持"处理，
 * 走优雅降级（普通对话）。需要时可显式传 `supportsTools: true` 覆盖。
 */
export const PROTOCOL_TOOL_SUPPORT: Record<ProviderProtocol, boolean> = {
  'openai-compatible': true,
  anthropic: true,
  ollama: false,
};

export const DEFAULT_TOOL_MAX_ROUNDS = 3;
/** 单条工具结果上限（字符）。与视图预算同量级，避免"取回原文"把上下文又撑成无界 */
export const DEFAULT_TOOL_RESULT_CHARS = 4000;
/** 一轮对话内所有工具结果的**总**预算（字符） */
export const DEFAULT_TOOL_TOTAL_CHARS = 12000;

export type ToolStopReason = 'stop' | 'max-rounds' | 'budget' | 'unsupported' | 'error';

/** 工具执行器：入参是模型的 tool_call，返回值是回给模型的文本（不许抛错，抛了也会被兜住） */
export type ToolExecutor = (
  call: ToolCall,
  ctx: { round: number; maxResultChars: number }
) => Promise<string> | string;

export interface ToolLoopEvent {
  kind: 'round' | 'tool' | 'degraded' | 'final';
  round: number;
  tool?: string;
  ok?: boolean;
  /** 结果/错误文本的字符数（**不含**任何密钥、也不含正文） */
  chars?: number;
  detail?: string;
}

export interface ToolLoopOptions {
  /** 工具轮上限，默认 3；0 = 不暴露工具（直接普通对话） */
  maxRounds?: number;
  /** 单条工具结果上限（字符），默认 4000 */
  maxResultChars?: number;
  /** 工具结果总预算（字符），默认 12000 */
  maxToolResultChars?: number;
  /** 覆盖协议能力判定 */
  supportsTools?: boolean;
  signal?: AbortSignal;
  /** 观测钩子（审计/指标用）：只带工具名与长度，不带正文 */
  onEvent?: (e: ToolLoopEvent) => void;
}

export interface ToolLoopResult {
  response: ChatResponse;
  /** 实际发出的模型请求次数（含强制收敛那次） */
  requests: number;
  /** 真正执行了工具的轮数 */
  rounds: number;
  /** 执行的工具调用条数 */
  toolCalls: number;
  /** 工具结果累计字符数 */
  toolResultChars: number;
  stopReason: ToolStopReason;
  /** true = 本轮走的是"不带 tools 的普通对话"（未暴露工具 / 不支持 / 首次调用报错） */
  degraded: boolean;
  /** 降级原因（审计用，不含密钥） */
  degradedReason?: string;
}

function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return dflt;
  const i = Math.floor(n);
  if (i < lo) return lo;
  if (i > hi) return hi;
  return i;
}

/** 该 provider 是否具备工具调用能力（实例标志优先于协议表） */
export function providerSupportsTools(provider: ModelProvider): boolean {
  const flag = (provider as { supportsTools?: boolean }).supportsTools;
  if (typeof flag === 'boolean') return flag;
  return PROTOCOL_TOOL_SUPPORT[provider.protocol] ?? true;
}

/**
 * 多轮工具调用循环。
 *
 * @param provider 模型 provider
 * @param req 请求（`req.tools` 为工具清单；不给就等于普通对话）
 * @param execute 宿主侧工具执行器
 */
export async function chatWithTools(
  provider: ModelProvider,
  req: ChatRequest,
  execute: ToolExecutor,
  opts: ToolLoopOptions = {}
): Promise<ToolLoopResult> {
  const o = opts && typeof opts === 'object' ? opts : {};
  const tools = Array.isArray(req.tools) ? req.tools : [];
  const toolsRequested = tools.length > 0;
  const maxRounds = clampInt(o.maxRounds, 0, 8, DEFAULT_TOOL_MAX_ROUNDS);
  const maxResultChars = clampInt(o.maxResultChars, 64, 20000, DEFAULT_TOOL_RESULT_CHARS);
  const totalBudget = clampInt(o.maxToolResultChars, 0, 200000, DEFAULT_TOOL_TOTAL_CHARS);
  const supports = typeof o.supportsTools === 'boolean' ? o.supportsTools : providerSupportsTools(provider);
  const emit = typeof o.onEvent === 'function' ? o.onEvent : () => {};

  /** 不带 tools 的普通对话（= ADR 002 之前的现状行为） */
  const plain = async (degraded: boolean, reason?: string): Promise<ToolLoopResult> => {
    const response = await provider.chat(
      { ...req, tools: undefined, toolChoice: undefined },
      o.signal
    );
    if (degraded) emit({ kind: 'degraded', round: 0, detail: reason });
    return {
      response,
      requests: 1,
      rounds: 0,
      toolCalls: 0,
      toolResultChars: 0,
      stopReason: degraded ? 'unsupported' : 'stop',
      degraded,
      degradedReason: reason,
    };
  };

  if (!toolsRequested) return plain(false); // 调用方没要工具：普通对话，不属于降级
  if (maxRounds <= 0) return plain(true, 'tools-disabled(maxRounds=0)');
  if (!supports) return plain(true, `unsupported(${provider.protocol})`);

  const messages: ChatMessage[] = req.messages.map((m) => ({ ...m }));
  let requests = 0;
  let rounds = 0;
  let toolCalls = 0;
  let resultChars = 0;
  let stopReason: ToolStopReason = 'stop';
  let last: ChatResponse | null = null;

  const callModel = async (toolChoice: ChatRequest['toolChoice']): Promise<ChatResponse> => {
    requests += 1;
    return provider.chat({ ...req, messages, tools, toolChoice }, o.signal);
  };

  try {
    for (;;) {
      // 工具轮 / 总预算已用尽：**下一次**就用 tool_choice:'none' 逼出文本答案（不再多发一次 auto）。
      // 这样"最多 maxRounds 轮工具 + 1 次强制收敛"是精确的请求数上界。
      const atRoundCap = rounds >= maxRounds;
      const budgetOut = rounds > 0 && resultChars >= totalBudget;
      if (atRoundCap || budgetOut) {
        // 两个限制同时命中时，报"预算"（更具体：说明是被工具结果总量拦下的）
        stopReason = budgetOut ? 'budget' : 'max-rounds';
        emit({ kind: 'final', round: rounds, detail: stopReason });
        try {
          const finalResp = await callModel('none');
          const text = finalResp.choices[0]?.message?.content || '';
          // 强制收敛若仍不产出文本，就保留上一次响应的正文（避免把"空回复"当成答案）
          const prevText = last?.choices[0]?.message?.content || '';
          if (text || !prevText) last = finalResp;
        } catch {
          /* 收敛失败就退回最后一次响应，绝不抛错（视图/预算已经守住了） */
        }
        break;
      }
      const resp = await callModel('auto');
      last = resp;
      const msg = resp.choices[0]?.message;
      const calls = Array.isArray(msg?.toolCalls) ? msg.toolCalls.filter(Boolean) : [];
      if (!calls.length) {
        stopReason = 'stop';
        break;
      }
      rounds += 1;
      emit({ kind: 'round', round: rounds, detail: `${calls.length} 个工具调用` });
      // 模型的 tool_calls 必须以 assistant 消息入对话，随后每条都要有对应的 tool 结果
      messages.push({ role: 'assistant', content: msg?.content || '', toolCalls: calls });
      for (const call of calls) {
        const name = call.function?.name || 'unknown';
        const remaining = totalBudget - resultChars;
        let text = '';
        if (remaining <= 0) {
          text = `（工具结果预算已用尽，未执行 ${name}；请基于已有信息作答）`;
          emit({ kind: 'tool', round: rounds, tool: name, ok: false, chars: text.length, detail: 'budget' });
        } else {
          const cap = Math.min(maxResultChars, remaining);
          try {
            const out = await execute(call, { round: rounds, maxResultChars: cap });
            text = out === undefined || out === null ? '' : String(out);
          } catch (e) {
            // 工具执行失败不是致命错误：把失败原因作为工具结果回给模型，让它自己纠偏
            const why = String((e as Error)?.message || e).slice(0, 200);
            text = `工具 ${name} 执行失败：${why}`;
            emit({ kind: 'tool', round: rounds, tool: name, ok: false, chars: text.length, detail: why });
          }
          if (text.length > cap) {
            text = clipTailSafe(text, cap) + `\n…[结果被截断：原 ${text.length} 字符，本次上限 ${cap}]`;
          }
          toolCalls += 1;
          emit({ kind: 'tool', round: rounds, tool: name, ok: true, chars: text.length });
        }
        resultChars += text.length;
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          name,
          content: text,
        });
      }
    }
  } catch (e) {
    // 首次带 tools 就报错：多半是该模型/中转不吃 tools（HTTP 400 之类）。
    // 优雅降级 = 重试一次不带 tools 的普通对话，而不是把整轮对话打成 error。
    if (requests <= 1) {
      const why = String((e as Error)?.message || e).slice(0, 160);
      emit({ kind: 'degraded', round: 0, detail: `tools-failed: ${why}` });
      try {
        const r = await plain(true, `tools-failed: ${why}`);
        // requests 如实反映"试过带 tools 的那次 + 降级后这次"（失败的尝试也算一次模型请求）
        return { ...r, requests: r.requests + requests, stopReason: 'unsupported' };
      } catch (e2) {
        // 连降级都失败（网络/鉴权），保持原始错误的语义，交给调用方
        throw e2;
      }
    }
    throw e;
  }

  // 轮数/预算用尽时已在循环里用 tool_choice:'none' 强制收敛过一次（见上），
  // 这里只处理"极端情况"：一次模型请求都没成功（正常路径不会走到）。
  const fallback: ChatResponse = last ?? {
    id: 'tool-loop-empty',
    model: req.model,
    choices: [{ index: 0, message: { role: 'assistant', content: '' }, finishReason: 'stop' }],
    usage: {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cacheHitTokens: 0,
      cacheMissTokens: 0,
      source: 'none',
    },
  };

  return {
    response: fallback,
    requests,
    rounds,
    toolCalls,
    toolResultChars: resultChars,
    stopReason,
    degraded: false,
  };
}
