import {
  JichuGongYing,
  qingQiuJson,
  pinJieUrl,
  zhuanHuanOpenAI,
  jieXiOpenAIXiangYing,
} from './base.js';
import type { LiaoTianPian, LiaoTianQingQiu, LiaoTianXiangYing, GongYingRenZheng } from './types.js';

/**
 * OpenAI 兼容协议
 * 覆盖：DeepSeek / OpenAI / SiliconFlow / Moonshot / GLM / Groq / 自定义中转
 */
export class JianrongOpenAIGongYing extends JichuGongYing {
  readonly id: string;
  readonly protocol = 'openai-compatible' as const;

  constructor(auth: GongYingRenZheng, opts: { id?: string; defaultBase: string }) {
    super(auth, opts.defaultBase);
    this.id = opts.id || 'openai-compatible';
  }

  /** OpenAI 兼容协议原生支持 tools（ADR 002 §9.4 待办 2）；个别中转不吃 tools 时由循环降级兜住 */
  override get supportsTools(): boolean {
    return true;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {};
    if (this.auth.apiKey) h.Authorization = `Bearer ${this.auth.apiKey}`;
    return h;
  }

  private qingQiuTi(Qiu: LiaoTianQingQiu, stream: boolean): Record<string, unknown> {
    return {
      model: Qiu.model,
      messages: zhuanHuanOpenAI(Qiu.xiaoXiJi),
      max_tokens: Qiu.maxTokens,
      temperature: Qiu.temperature,
      top_p: Qiu.topP,
      stop: Qiu.stop,
      tools: Qiu.tools,
      tool_choice: Qiu.toolChoice,
      stream,
      ...Qiu.extra,
    };
  }

  async chat(Qiu: LiaoTianQingQiu, signal?: AbortSignal): Promise<LiaoTianXiangYing> {
    const json = await qingQiuJson<Parameters<typeof jieXiOpenAIXiangYing>[0]>(
      pinJieUrl(this.baseURL, 'chat/completions'),
      { method: 'POST', body: JSON.stringify(this.qingQiuTi(Qiu, false)), signal, headers: this.headers() },
      this.auth
    );
    return jieXiOpenAIXiangYing(json);
  }

  async *chatStream(Qiu: LiaoTianQingQiu, signal?: AbortSignal): AsyncIterable<LiaoTianPian> {
    const res = await fetch(pinJieUrl(this.baseURL, 'chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.headers(),
        ...this.auth.headers,
      },
      body: JSON.stringify(this.qingQiuTi(Qiu, true)),
      signal,
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      throw new Error(`stream HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const duQuQi = res.body.getReader();
    const jieMaQi = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await duQuQi.read();
      if (done) break;
      buf += jieMaQi.decode(value, { stream: true });
      const HangJi = buf.split('\n');
      buf = HangJi.pop() || '';
      for (const Hang of HangJi) {
        const t = Hang.trim();
        if (!t.startsWith('data:')) continue;
        const data = t.slice(5).trim();
        if (data === '[DONE]') return;
        try {
          const j = JSON.parse(data);
          const c = j.choices?.[0];
          yield {
            id: j.id || '',
            model: j.model || Qiu.model,
            choices: [
              {
                index: c?.index ?? 0,
                delta: {
                  content: c?.delta?.content,
                  role: c?.delta?.role,
                },
                finishReason: c?.finish_reason ?? null,
              },
            ],
          };
        } catch {
          // ignore partial
        }
      }
    }
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    try {
      const json = await qingQiuJson<{ data?: Array<{ id: string }> }>(
        pinJieUrl(this.baseURL, 'models'),
        { method: 'GET', signal, headers: this.headers() },
        this.auth
      );
      return (json.data || []).map((m) => m.id);
    } catch {
      // 部分中转无 /models
      return [];
    }
  }

  /**
   * **带元数据**的模型清单：有些端点（如 OpenRouter）会在每个模型上给
   * `supported_parameters`（含 `reasoning` / `reasoning_effort` / `include_reasoning`）
   * 或 `reasoning` 字段 —— 这是唯一能"问出该模型支持哪些思考档位"的官方口径。
   * 拿不到就返回 `thinkLevels: []`（由宿主按名称启发式 + 失败降级处理）。
   */
  async listModelsDetailed(signal?: AbortSignal): Promise<Array<{ id: string; thinkLevels: string[]; supportsThinking: boolean }>> {
    try {
      const json = await qingQiuJson<{ data?: Array<Record<string, unknown>> }>(
        pinJieUrl(this.baseURL, 'models'),
        { method: 'GET', signal, headers: this.headers() },
        this.auth
      );
      return (json.data || []).map((m) => {
        const id = String((m as { id?: unknown }).id || '');
        const sp = Array.isArray((m as { supported_parameters?: unknown }).supported_parameters)
          ? ((m as { supported_parameters: unknown[] }).supported_parameters.map((x) => String(x)))
          : [];
        const re = (m as { reasoning?: unknown }).reasoning;
        const youReasoning = sp.some((p) => /reason/i.test(p)) || !!re;
        // 有的端点直接给档位清单：reasoning: { supported_efforts: [...] } 或 reasoning_efforts: [...]
        let levels: string[] = [];
        const raw = (re as { supported_efforts?: unknown; efforts?: unknown } | undefined);
        const cand = (Array.isArray((m as { reasoning_efforts?: unknown }).reasoning_efforts)
          ? (m as { reasoning_efforts: unknown[] }).reasoning_efforts
          : (Array.isArray(raw?.supported_efforts) ? raw?.supported_efforts : raw?.efforts)) as unknown;
        if (Array.isArray(cand)) levels = cand.map((x) => String(x)).filter(Boolean);
        return { id, thinkLevels: levels, supportsThinking: youReasoning };
      });
    } catch {
      return [];
    }
  }
}

/** DeepSeek 预设工厂（OpenAI 兼容） */
export function chuangjianDeepSeek(auth: GongYingRenZheng): JianrongOpenAIGongYing {
  return new JianrongOpenAIGongYing(auth, {
    id: 'deepseek',
    defaultBase: 'https://api.deepseek.com/v1',
  });
}
