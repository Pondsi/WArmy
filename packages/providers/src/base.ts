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
      /**
       * `source` 的口径（第 44 轮 token 真实化）：**端点报出来的数字就是原生**，不能标成 `estimated`。
       * 以前这里把"只有 prompt_tokens、没有缓存明细"标成估算 ⇒ 上层拿不到任何原生样本，
       * 校准闭环（真实/估算 比值）永远不会启动。我们的猜测只在我们自己算的兜底里标 `estimated`。
       */
      source: tiShiCi || wancheng || mingZhong || weiMingZhong ? 'native' : 'none',
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
      source: shuRu || shuChu || huanCunDuQu || huanCunChuangJian ? 'native' : 'none',
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
    /** Ollama 的 `prompt_eval_count` 是它**自己分词器数出来的**，是原生测量而非估算 ⇒ `native` */
    source: tiShiCi || wancheng ? 'native' : 'none',
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

/**
 * 非流式对话的单次上限：整段回复要在一个响应里生成完（长文 3000~5000 字按 ~40 tok/s 要 2~3 分钟），
 * 用 120 s 的通用默认值会把正常的长回复截成超时。
 */
export const FEI_LIU_CHAT_MS = 300_000;

export async function qingQiuJson<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number },
  auth: GongYingRenZheng
): Promise<T> {
  const timeoutMs = init.timeoutMs ?? auth.timeoutMs ?? 120_000;
  const jieZhi = Date.now() + timeoutMs;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...auth.headers,
    ...((init.headers as Record<string, string>) || {}),
  };
  /**
   * **429/5xx 必须退避重试**（多项目并发验收真机：同一家供应商 10 路并发直接 429，
   * 执行者被整轮判崩溃 —— 这不是任务失败，是供应商让我们慢一点）。
   * 只重试临时错误；401/400 这类配置/参数错误一次就够，绝不拿重试掩盖。
   */
  for (let ci = 1; ; ci++) {
    if (init.signal?.aborted) throw new Error('aborted');
    const shengYu = Math.max(1000, jieZhi - Date.now());
    const kongZhiQi = new AbortController();
    const jiShiQi = setTimeout(() => kongZhiQi.abort(new Error('timeout')), shengYu);
    try {
      // 调用方的取消信号与本函数的超时必须同时生效：只用调用方信号时，挂住的请求永远不会超时
      const res = await fetch(url, {
        ...init,
        headers,
        signal: init.signal ? AbortSignal.any([init.signal, kongZhiQi.signal]) : kongZhiQi.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        const linShi = res.status === 429 || (res.status >= 500 && res.status <= 504);
        if (linShi && ci < 6 && Date.now() < jieZhi) {
          const retryAfter = Number(res.headers.get('retry-after')) || 0;
          const deng = Math.min(15_000, Math.max(800, retryAfter > 0 ? retryAfter * 1000 : ci * 1500));
          await new Promise((r) => setTimeout(r, deng));
          continue;
        }
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
      }
      return JSON.parse(text) as T;
    } catch (e) {
      const msg = String((e as Error)?.message || e);
      const shiHttp = /^HTTP \d{3}:/.test(msg);
      const keChong = !shiHttp || /^HTTP (429|5\d\d):/.test(msg);
      if (keChong && ci < 6 && Date.now() < jieZhi && !init.signal?.aborted) {
        await new Promise((r) => setTimeout(r, Math.min(8000, ci * 1500)));
        continue;
      }
      throw e;
    } finally {
      clearTimeout(jiShiQi);
    }
  }
}

export function pinJieUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/**
 * OpenAI 兼容端点的 baseURL 规范化：`chat/completions` / `models` 都挂在 `/v1` 下，
 * 少了 `/v1` 就是 **HTTP 404**（真事故：DeepSeek 预设写成 `https://api.deepseek.com`）。
 */
export function guiFanBaseURL(u: string): string {
  const s0 = String(u || '').trim().replace(/\/+$/, '');
  if (!s0) return s0;
  if (/\/v\d+[a-z]*$/i.test(s0)) return s0;                       // 已带版本段：不动
  if (/api\.deepseek\.com$|api\.xiaomimimo\.com$|api\.openai\.com$|api\.moonshot\.cn$|api\.siliconflow\.cn$|open\.bigmodel\.cn\/api\/paas$/i.test(s0)) {
    return s0 + '/v1';
  }
  return s0;
}

export abstract class JichuGongYing implements MoxingGongYing {
  abstract readonly id: string;
  abstract readonly protocol: GongYingXieYi;
  readonly baseURL: string;
  protected auth: GongYingRenZheng;

  constructor(auth: GongYingRenZheng, defaultBase: string) {
    this.auth = auth;
    this.baseURL = guiFanBaseURL((auth.baseURL || defaultBase).replace(/\/+$/, ''));
  }

  abstract chat(Qiu: LiaoTianQingQiu, signal?: AbortSignal): Promise<LiaoTianXiangYing>;
  abstract chatStream(Qiu: LiaoTianQingQiu, signal?: AbortSignal): AsyncIterable<LiaoTianPian>;
  abstract listModels(signal?: AbortSignal): Promise<string[]>;

  /** 第 104 轮：默认没有服务端取消接口；只有真有接口的子类才覆盖。 */
  async cancel(_req: { id?: string; signal?: AbortSignal }): Promise<{ supported: boolean; ok: boolean; detail?: string }> {
    return { supported: false, ok: false, detail: 'provider has no server-side cancel endpoint' };
  }

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
      /** 丢掉 function.name 为空的调用：API 会 400「missing a function name」 */
      const youXiao = m.gongJuDiaoYongJi.filter((t) => t.function?.name);
      return {
        role: 'assistant',
        content: m.content || null,
        // 只在端点自己吐过思考时回传（OpenAI 官方不吐 ⇒ 不会多出它不认的字段）
        ...(m.reasoning ? { reasoning_content: m.reasoning } : {}),
        tool_calls: youXiao.map((t) => ({
          id: t.id,
          type: 'function',
          function: t.function,
          ...(t.extra_content ? { extra_content: t.extra_content } : {}),
        })),
      };
    }
    // 多模态（含图片）：原样透传内容块数组 —— 视觉模型因此能真的看到图
    if (Array.isArray(m.content)) return { role: m.role, content: m.content };
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
      /** 思考过程：各家字段名不同（MiMo/DeepSeek 用 reasoning_content，部分网关用 reasoning） */
      reasoning_content?: string | null;
      reasoning?: string | null;
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
  const gongJuDiaoYongJi = (xiaoXi?.tool_calls || [])
    .map((t) => {
      const fn = (t as { function?: { name?: string; arguments?: unknown }; name?: string; arguments?: unknown }).function
        || (t as { function?: { name?: string; arguments?: unknown }; name?: string; arguments?: unknown });
      const name = String(fn?.name || (t as { name?: string }).name || '');
      const args = fn?.arguments ?? (t as { arguments?: unknown }).arguments;
      const extra = (t as { extra_content?: Record<string, unknown> }).extra_content;
      return {
        id: t.id || `call-${Math.random().toString(36).slice(2)}`,
        type: 'function' as const,
        function: {
          name,
          arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}),
        },
        ...(extra ? { extra_content: extra } : {}),
      };
    })
    .filter((c) => c.function.name);
  return {
    id: json.id || `chatcmpl-${Date.now()}`,
    model: json.model || '',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: xiaoXi?.content || '',
          /**
           * **非流式也要带上思考过程**。
           *
           * 真缺陷：流式路径（openai.ts chatStream）一直读 `reasoning_content`，
           * 这里非流式却整个丢掉 ⇒ 凡是走非流式的轮次（空参回退、流式失败兜底、
           * 判卡死/分类等内部调用）思考过程**全部消失**，界面上那一轮就是"没思考"。
           */
          ...((xiaoXi?.reasoning_content || xiaoXi?.reasoning)
            ? { reasoning: String(xiaoXi.reasoning_content || xiaoXi.reasoning) }
            : {}),
          gongJuDiaoYongJi: gongJuDiaoYongJi.length ? gongJuDiaoYongJi : undefined,
        },
        finishReason: xuanXiang?.finish_reason || 'stop',
      },
    ],
    usage: guiFanYongLiang(json.usage, 'openai-compatible'),
    raw: json,
  };
}
