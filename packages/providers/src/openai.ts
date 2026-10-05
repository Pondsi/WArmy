import {
  JichuGongYing,
  qingQiuJson,
  pinJieUrl,
  zhuanHuanOpenAI,
  jieXiOpenAIXiangYing,
} from './base.js';
import { chouNengLiCongDuanDian } from './mo-xing-neng-li.js';
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
          /**
           * **工具调用必须一起带出去**（真事故：流式包装只取了 content ⇒ 工具调用被丢掉 ⇒
           * 界面变成"纯文本对话"）。OpenAI 的 `delta.tool_calls` 是**增量**的（同一个 id
           * 多帧拼 arguments），这里原样转成我们的 `gongJuDiaoYongJi`，由上层按 id 归并。
           */
          const liuGongJu = (c?.delta?.tool_calls || []).map((t: { id?: string; index?: number; function?: { name?: string; arguments?: string } }) => ({
            id: String(t?.id || `call-${t?.index ?? 0}`),
            type: 'function' as const,
            function: {
              name: String(t?.function?.name || ''),
              arguments: String(t?.function?.arguments || ''),
            },
          }));
          yield {
            id: j.id || '',
            model: j.model || Qiu.model,
            choices: [
              {
                index: c?.index ?? 0,
                delta: {
                  content: c?.delta?.content,
                  role: c?.delta?.role,
                  ...(liuGongJu.length ? { gongJuDiaoYongJi: liuGongJu } : {}),
                  ...(c?.delta?.reasoning_content || c?.delta?.reasoning
                    ? { reasoning: String(c.delta.reasoning_content || c.delta.reasoning) }
                    : {}),
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
   * **带元数据**的模型清单：能问出"该模型会什么"（视觉 / 思考档位 / 工具）的唯一官方口径。
   * 端点给字段就解析（`input_modalities` / `capabilities` / `supported_parameters`）；
   * 没给就留空，由宿主用**已知模型能力表**兑底（见 mo-xing-neng-li.ts）。
   */
  async listModelsDetailed(signal?: AbortSignal): Promise<Array<{ id: string; thinkLevels: string[]; supportsThinking: boolean; vision: boolean | 'unknown'; tools: boolean | 'unknown'; kind: string; contextLen: number }>> {
    try {
      const json = await qingQiuJson<{ data?: Array<Record<string, unknown>> }>(
        pinJieUrl(this.baseURL, 'models'),
        { method: 'GET', signal, headers: this.headers() },
        this.auth
      );
      return (json.data || []).map((m) => {
        const id = String((m as { id?: unknown }).id || '');
        const neng = chouNengLiCongDuanDian(m);
        return {
          id,
          thinkLevels: neng?.thinkLevels || [],
          supportsThinking: neng?.thinking === true,
          vision: (neng?.vision !== undefined ? neng.vision : 'unknown') as boolean | 'unknown',
          tools: (neng?.tools !== undefined ? neng.tools : 'unknown') as boolean | 'unknown',
          kind: String((neng as { kind?: unknown })?.kind || 'unknown'),
          contextLen: Number((neng as { contextLen?: unknown })?.contextLen || 0),
        };
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
