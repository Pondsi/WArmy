import type {
  CacheUsage,
  ChatChunk,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ModelProvider,
  ProviderAuth,
  ProviderProtocol,
} from './types.js';

/** 统一缓存用量归一化 */
export function normalizeUsage(
  raw: Record<string, unknown> | undefined,
  protocol: ProviderProtocol
): CacheUsage {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

  if (protocol === 'openai-compatible') {
    // DeepSeek: prompt_cache_hit_tokens / prompt_cache_miss_tokens
    // OpenAI: prompt_tokens_details.cached_tokens
    const details = raw?.prompt_tokens_details as { cached_tokens?: number } | undefined;
    const hit =
      num(raw?.prompt_cache_hit_tokens) || num(details?.cached_tokens);
    const miss = num(raw?.prompt_cache_miss_tokens);
    const prompt = num(raw?.prompt_tokens);
    const completion = num(raw?.completion_tokens);
    return {
      promptTokens: prompt,
      completionTokens: completion,
      totalTokens: num(raw?.total_tokens) || prompt + completion,
      cacheHitTokens: hit,
      cacheMissTokens: miss || Math.max(0, prompt - hit),
      source: hit > 0 || miss > 0 || details ? 'native' : prompt ? 'estimated' : 'none',
    };
  }

  if (protocol === 'anthropic') {
    const cacheRead = num(raw?.cache_read_input_tokens);
    const cacheCreate = num(raw?.cache_creation_input_tokens);
    const input = num(raw?.input_tokens);
    const output = num(raw?.output_tokens);
    return {
      promptTokens: input + cacheCreate + cacheRead,
      completionTokens: output,
      totalTokens: input + cacheCreate + cacheRead + output,
      cacheHitTokens: cacheRead,
      cacheMissTokens: cacheCreate + input,
      source: cacheRead || cacheCreate ? 'native' : input ? 'estimated' : 'none',
    };
  }

  // ollama: prompt_eval_count / eval_count；无缓存字段
  const prompt = num(raw?.prompt_eval_count);
  const completion = num(raw?.eval_count);
  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: prompt + completion,
    cacheHitTokens: 0,
    cacheMissTokens: prompt,
    source: prompt || completion ? 'estimated' : 'none',
  };
}

export function emptyUsage(): CacheUsage {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cacheHitTokens: 0,
    cacheMissTokens: 0,
    source: 'none',
  };
}

export async function httpJson<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number },
  auth: ProviderAuth
): Promise<T> {
  const timeoutMs = init.timeoutMs ?? auth.timeoutMs ?? 120_000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('timeout')), timeoutMs);
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...auth.headers,
      ...((init.headers as Record<string, string>) || {}),
    };
    const res = await fetch(url, {
      ...init,
      headers,
      signal: init.signal ?? ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timer);
  }
}

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export abstract class BaseProvider implements ModelProvider {
  abstract readonly id: string;
  abstract readonly protocol: ProviderProtocol;
  readonly baseURL: string;
  protected auth: ProviderAuth;

  constructor(auth: ProviderAuth, defaultBase: string) {
    this.auth = auth;
    this.baseURL = (auth.baseURL || defaultBase).replace(/\/+$/, '');
  }

  abstract chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResponse>;
  abstract chatStream(req: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatChunk>;
  abstract listModels(signal?: AbortSignal): Promise<string[]>;

  async ping(signal?: AbortSignal): Promise<{ ok: boolean; latencyMs: number; detail?: string }> {
    const t0 = performance.now();
    try {
      await this.listModels(signal);
      return { ok: true, latencyMs: +(performance.now() - t0).toFixed(1) };
    } catch (e) {
      // listModels 失败时退回一次最小 chat
      try {
        await this.chat(
          {
            model: '',
            messages: [{ role: 'user', content: 'ping' }],
            maxTokens: 1,
          },
          signal
        );
        return { ok: true, latencyMs: +(performance.now() - t0).toFixed(1) };
      } catch (e2) {
        return {
          ok: false,
          latencyMs: +(performance.now() - t0).toFixed(1),
          detail: String((e2 as Error).message || e),
        };
      }
    }
  }
}

export function messagesToOpenAI(messages: ChatMessage[]): unknown[] {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return {
        role: 'tool',
        content: m.content,
        tool_call_id: m.toolCallId,
      };
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map((t) => ({
          id: t.id,
          type: 'function',
          function: t.function,
        })),
      };
    }
    return { role: m.role, content: m.content };
  });
}

export function parseOpenAIResponse(json: {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{
        id: string;
        type?: string;
        function?: { name: string; arguments: string };
      }>;
    };
    finish_reason?: string;
  }>;
  usage?: Record<string, unknown>;
}): ChatResponse {
  const choice = json.choices?.[0];
  const msg = choice?.message;
  const toolCalls = (msg?.tool_calls || []).map((t) => ({
    id: t.id,
    type: 'function' as const,
    function: {
      name: t.function?.name || '',
      arguments: t.function?.arguments || '{}',
    },
  }));
  return {
    id: json.id || `chatcmpl-${Date.now()}`,
    model: json.model || '',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: msg?.content || '',
          toolCalls: toolCalls.length ? toolCalls : undefined,
        },
        finishReason: choice?.finish_reason || 'stop',
      },
    ],
    usage: normalizeUsage(json.usage, 'openai-compatible'),
    raw: json,
  };
}
