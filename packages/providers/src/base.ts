import { XIEYI_GONGJU_ZHICHI } from './tools.js';
import type {
  HuanCunYongLiang,
  LiaoTianPian,
  LiaoTianXiaoXi,
  LiaoTianQingQiu,
  LiaoTianXiangYing,
  MoxingGongYing,
  GongYingRenZheng,
  GongYingXieYi,
} from './types.js';

/** 统一缓存用量归一化 */
export function guiFanYongLiang(
  raw: Record<string, unknown> | undefined,
  protocol: GongYingXieYi
): HuanCunYongLiang {
  const shuZhi = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

  if (protocol === 'openai-compatible') {
    // DeepSeek: prompt_cache_hit_tokens / prompt_cache_miss_tokens
    // OpenAI: prompt_tokens_details.cached_tokens
    const xiangQing = raw?.prompt_tokens_details as { cached_tokens?: number } | undefined;
    const mingZhong =
      shuZhi(raw?.prompt_cache_hit_tokens) || shuZhi(xiangQing?.cached_tokens);
    const weiMingZhong = shuZhi(raw?.prompt_cache_miss_tokens);
    const tiShiCi = shuZhi(raw?.prompt_tokens);
    const wancheng = shuZhi(raw?.completion_tokens);
    return {
      promptTokens: tiShiCi,
      completionTokens: wancheng,
      totalTokens: shuZhi(raw?.total_tokens) || tiShiCi + wancheng,
      cacheHitTokens: mingZhong,
      cacheMissTokens: weiMingZhong || Math.max(0, tiShiCi - mingZhong),
      source: mingZhong > 0 || weiMingZhong > 0 || xiangQing ? 'native' : tiShiCi ? 'estimated' : 'none',
    };
  }

  if (protocol === 'anthropic') {
    const huanCunDuQu = shuZhi(raw?.cache_read_input_tokens);
    const huanCunChuangJian = shuZhi(raw?.cache_creation_input_tokens);
    const shuRu = shuZhi(raw?.input_tokens);
    const shuChu = shuZhi(raw?.output_tokens);
    return {
      promptTokens: shuRu + huanCunChuangJian + huanCunDuQu,
      completionTokens: shuChu,
      totalTokens: shuRu + huanCunChuangJian + huanCunDuQu + shuChu,
      cacheHitTokens: huanCunDuQu,
      cacheMissTokens: huanCunChuangJian + shuRu,
      source: huanCunDuQu || huanCunChuangJian ? 'native' : shuRu ? 'estimated' : 'none',
    };
  }

  // ollama: prompt_eval_count / eval_count；无缓存字段
  const tiShiCi = shuZhi(raw?.prompt_eval_count);
  const wancheng = shuZhi(raw?.eval_count);
  return {
    promptTokens: tiShiCi,
    completionTokens: wancheng,
    totalTokens: tiShiCi + wancheng,
    cacheHitTokens: 0,
    cacheMissTokens: tiShiCi,
    source: tiShiCi || wancheng ? 'estimated' : 'none',
  };
}

export function kongYongLiang(): HuanCunYongLiang {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cacheHitTokens: 0,
    cacheMissTokens: 0,
    source: 'none',
  };
}

export async function qingQiuJson<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number },
  auth: GongYingRenZheng
): Promise<T> {
  const timeoutMs = init.timeoutMs ?? auth.timeoutMs ?? 120_000;
  const kongZhiQi = new AbortController();
  const jiShiQi = setTimeout(() => kongZhiQi.abort(new Error('timeout')), timeoutMs);
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...auth.headers,
      ...((init.headers as Record<string, string>) || {}),
    };
    const res = await fetch(url, {
      ...init,
      headers,
      signal: init.signal ?? kongZhiQi.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    return JSON.parse(text) as T;
  } finally {
    clearTimeout(jiShiQi);
  }
}

export function pinJieUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export abstract class JichuGongYing implements MoxingGongYing {
  abstract readonly id: string;
  abstract readonly protocol: GongYingXieYi;
  readonly baseURL: string;
  protected auth: GongYingRenZheng;

  constructor(auth: GongYingRenZheng, defaultBase: string) {
    this.auth = auth;
    this.baseURL = (auth.baseURL || defaultBase).replace(/\/+$/, '');
  }

  abstract chat(Qiu: LiaoTianQingQiu, signal?: AbortSignal): Promise<LiaoTianXiangYing>;
  abstract chatStream(Qiu: LiaoTianQingQiu, signal?: AbortSignal): AsyncIterable<LiaoTianPian>;
  abstract listModels(signal?: AbortSignal): Promise<string[]>;

  /**
   * function calling 能力：默认按协议表判定（tools.ts）。
   * 写成 getter 而不是字段，是因为 protocol 由子类以字段形式声明。
   */
  get supportsTools(): boolean {
    return XIEYI_GONGJU_ZHICHI[this.protocol] ?? true;
  }

  async ping(signal?: AbortSignal): Promise<{ ok: boolean; latencyMs: number; detail?: string }> {
    const qiShiShiJian = performance.now();
    try {
      await this.listModels(signal);
      return { ok: true, latencyMs: +(performance.now() - qiShiShiJian).toFixed(1) };
    } catch (e) {
      // listModels 失败时退回一次最小 chat
      try {
        await this.chat(
          {
            model: '',
            xiaoXiJi: [{ role: 'user', content: 'ping' }],
            maxTokens: 1,
          },
          signal
        );
        return { ok: true, latencyMs: +(performance.now() - qiShiShiJian).toFixed(1) };
      } catch (e2) {
        return {
          ok: false,
          latencyMs: +(performance.now() - qiShiShiJian).toFixed(1),
          detail: String((e2 as Error).message || e),
        };
      }
    }
  }
}

export function zhuanHuanOpenAI(xiaoXiJi: LiaoTianXiaoXi[]): unknown[] {
  return xiaoXiJi.map((m) => {
    if (m.role === 'tool') {
      return {
        role: 'tool',
        content: m.content,
        tool_call_id: m.toolCallId,
      };
    }
    if (m.role === 'assistant' && m.gongJuDiaoYongJi?.length) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.gongJuDiaoYongJi.map((t) => ({
          id: t.id,
          type: 'function',
          function: t.function,
        })),
      };
    }
    return { role: m.role, content: m.content };
  });
}

export function jieXiOpenAIXiangYing(json: {
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
}): LiaoTianXiangYing {
  const xuanXiang = json.choices?.[0];
  const xiaoXi = xuanXiang?.message;
  const gongJuDiaoYongJi = (xiaoXi?.tool_calls || []).map((t) => ({
    id: t.id,
    type: 'function' as const,
    function: {
      name: t.function?.name || t.function?.name || '',
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
          content: xiaoXi?.content || '',
          gongJuDiaoYongJi: gongJuDiaoYongJi.length ? gongJuDiaoYongJi : undefined,
        },
        finishReason: xuanXiang?.finish_reason || 'stop',
      },
    ],
    usage: guiFanYongLiang(json.usage, 'openai-compatible'),
    raw: json,
  };
}
