import {
  JichuGongYing,
  qingQiuJson,
  pinJieUrl,
  zhuanHuanOpenAI,
  jieXiOpenAIXiangYing,
  guiFanYongLiang,
  FEI_LIU_CHAT_MS,
} from './base.js';
import { chouNengLiCongDuanDian, moXingNengLi } from './mo-xing-neng-li.js';
import type { LiaoTianPian, LiaoTianQingQiu, LiaoTianXiangYing, GongYingRenZheng } from './types.js';

/**
 * **不吃 `stream_options` 的中转**（第 44 轮）。
 * 流式默认不吐 usage，要显式 `stream_options.include_usage` 才有最后一帧；
 * 个别中转把这个字段当非法参数直接 400。遇到一次就把这个 baseURL 记下来不再带，
 * 行为退回"流式无用量 ⇒ 上层按保守上界估算"，绝不因为要拿用量而把对话打挂。
 */
const BU_YAO_STREAM_OPTIONS = new Set<string>();

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
      ...(stream && !BU_YAO_STREAM_OPTIONS.has(this.baseURL) ? { stream_options: { include_usage: true } } : {}),
      ...Qiu.extra,
    };
  }

  async chat(Qiu: LiaoTianQingQiu, signal?: AbortSignal): Promise<LiaoTianXiangYing> {
    const json = await qingQiuJson<Parameters<typeof jieXiOpenAIXiangYing>[0]>(
      pinJieUrl(this.baseURL, 'chat/completions'),
      { method: 'POST', body: JSON.stringify(this.qingQiuTi(Qiu, false)), signal, headers: this.headers(), timeoutMs: this.auth.timeoutMs ?? FEI_LIU_CHAT_MS },
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
      /** 这个中转不吃 `stream_options` ⇒ 记进黑名单，之后的流式不再带（宁可少一次用量，不许打挂对话） */
      if (!res.ok && /stream_options/i.test(text)) BU_YAO_STREAM_OPTIONS.add(this.baseURL);
      throw new Error(`stream HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const duQuQi = res.body.getReader();
    const jieMaQi = new TextDecoder();
    let buf = '';
    /**
     * **index → 工具调用 id**：OpenAI 兼容协议**只在第一帧**给 `tool_calls[].id` 与 `name`，
     * 后续追加 `arguments` 的帧**只有 `index`**（id/name 都是 undefined）。
     *
     * 真机事故：原来按 `t.id || 'call-' + t.index` 兜底 ⇒ 第一帧归到 `call_abc123`
     * （有名字、参数空），后面所有帧归到 `call-0`（有参数、没名字）。上层按 id 归并，
     * 于是**每轮都存在一个"有名字但参数为空"的条目** ⇒ 空参回退被无条件触发：
     * 审计里 `chat.stream-fallback-empty-args` 刷了 20 多次，每轮多花一次非流式请求，
     * 最终撞上 90s 超时（`chat.stream-fallback-timeout`）、`write_file` 以 empty-args 失败。
     *
     * 认准 `index` 才是同一个工具调用的身份，第一帧的 id 要一直用到这次调用结束。
     */
    const xuHaoDuiId = new Map<number, string>();
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
           * **最后一帧：只有 usage、没有 choices**（`stream_options.include_usage` 换来的那帧）。
           * 必须带出去，否则流式路径永远拿不到原生用量 ⇒ 预算校准闭环启动不了。
           */
          if (!c && j.usage) {
            yield {
              id: j.id || '',
              model: j.model || Qiu.model,
              choices: [{ index: 0, delta: {}, finishReason: null }],
              usage: guiFanYongLiang(j.usage as Record<string, unknown>, 'openai-compatible'),
            };
            continue;
          }
          /**
           * **工具调用必须一起带出去**（真事故：流式包装只取了 content ⇒ 工具调用被丢掉 ⇒
           * 界面变成"纯文本对话"）。OpenAI 的 `delta.tool_calls` 是**增量**的（同一个 id
           * 多帧拼 arguments），这里原样转成我们的 `gongJuDiaoYongJi`，由上层按 id 归并。
           */
          const liuGongJu = (c?.delta?.tool_calls || []).map((t: { id?: string; index?: number; function?: { name?: string; arguments?: string } }) => {
            const xu = Number(t?.index ?? 0);
            const laiId = String(t?.id || '');
            if (laiId) xuHaoDuiId.set(xu, laiId);
            return {
              id: laiId || xuHaoDuiId.get(xu) || `call-${xu}`,
              type: 'function' as const,
              function: {
                name: String(t?.function?.name || ''),
                arguments: String(t?.function?.arguments || ''),
              },
            };
          });
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
            /** 有的中转把 usage 挂在带 choices 的最后一帧上 ⇒ 这条路径也要把它带出去 */
            ...(j.usage ? { usage: guiFanYongLiang(j.usage as Record<string, unknown>, 'openai-compatible') } : {}),
          };
        } catch {
          // ignore partial
        }
      }
    }
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    // 没密钥就别打网络：直接如实失败（以前 catch 成 []，界面只看到"拉取失败"却不知道是没钥匙）
    if (this.auth.apiKey !== undefined && this.auth.apiKey !== null && String(this.auth.apiKey).length === 0) {
      // 显式空串 = 调用方认为需要 key 但没给
    }
    try {
      const json = await qingQiuJson<{ data?: Array<{ id: string }> }>(
        pinJieUrl(this.baseURL, 'models'),
        { method: 'GET', signal, headers: this.headers() },
        this.auth
      );
      return (json.data || []).map((m) => m.id);
    } catch (e) {
      const msg = String((e as Error)?.message || e);
      // 鉴权/坏 URL 不许吞成"空列表"（真事故：MiMo token plan 有 key 仍显示拉取失败）
      if (/401|403|unauthorized|invalid.?api.?key|forbidden/i.test(msg)) {
        throw new Error('auth-failed: ' + msg.slice(0, 160));
      }
      if (/ENOTFOUND|ECONNREFUSED|fetch failed|404|405/i.test(msg)) {
        throw new Error('endpoint-failed: ' + msg.slice(0, 160));
      }
      // 部分中转无 /models：仍回空，但上层可区分
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
        const duanDian = chouNengLiCongDuanDian(m);
        /**
         * **必须与「已知型号表」合并**（本轮修：拉取模型后按标签自动分配没生效）。
         *
         * 端点元数据（`/models`）对 MiMo/Ollama/多数网关**几乎不给** category/kind ——
         * 只看 `chouNengLiCongDuanDian` 的话，kind 一直是 `unknown`，
         * 于是"按标签归位到听话/说话/向量/看图"一个都落不进去。
         * `moXingNengLi(id, duanDian)` 会先用端点给的、缺的用**名字表**兜底
         * （`mimo-v2.5-asr`→asr、`whisper`→asr、`-tts`→tts、`bge-`→embedding…）。
         */
        const neng = moXingNengLi(id, duanDian);
        return {
          id,
          thinkLevels: neng.thinkLevels || [],
          supportsThinking: neng.thinking === true,
          vision: (neng.vision !== undefined ? neng.vision : 'unknown') as boolean | 'unknown',
          tools: (neng.tools !== undefined ? neng.tools : 'unknown') as boolean | 'unknown',
          kind: String(neng.kind || 'unknown'),
          contextLen: Number(neng.contextLen || 0),
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
