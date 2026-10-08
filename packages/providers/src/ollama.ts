import { JichuGongYing, pinJieUrl, guiFanYongLiang } from './base.js';
import type { LiaoTianPian, LiaoTianQingQiu, LiaoTianXiangYing, GongYingRenZheng } from './types.js';

/**
 * Ollama 本地协议
 * https://github.com/ollama/ollama/blob/main/docs/api.md
 */
export class OllamaGongYing extends JichuGongYing {
  readonly id: string;
  readonly protocol = 'ollama' as const;

  constructor(auth: GongYingRenZheng, opts: { id?: string; defaultBase?: string } = {}) {
    super(auth, opts.defaultBase || 'http://127.0.0.1:11434');
    this.id = opts.id || 'ollama';
  }

  /**
   * Ollama `/api/chat` 对**带 tools 的模型**支持 function calling；不支持的模型会忽略或报错。
   * 以前这里硬声明"不支持"，把 write_file/make_docx/open_path 整层剥掉 —— 模型只能回答
   * 「我是纯对话的小牛马，够不着桌面」（真事故）。现在如实声明支持、**透传 tools**，
   * 由外层的降级链（首请求失败 → 重试不带 tools）兜住不支持的模型。
   */
  override get supportsTools(): boolean {
    return true;
  }

  private qingQiuTi(Qiu: LiaoTianQingQiu, stream: boolean): Record<string, unknown> {
    const xiaoXiJi = Qiu.xiaoXiJi.map((m) => {
      /**
       * Ollama `/api/chat` 的约定与 OpenAI 不同（真事故：`Value looks like object,
       * but can't find closing '}' symbol` —— 就是我们按 OpenAI 形状发，Ollama 解析报错）：
       *  · `content` 只接受**字符串**；图片走独立的 `images: [base64...]` 字段
       *  · `tool_calls[].function.arguments` 必须是**对象**，不是 JSON 字符串
       */
      let wenBen = '';
      const tuJi: string[] = [];
      if (typeof m.content === 'string') {
        wenBen = m.content;
      } else if (Array.isArray(m.content)) {
        for (const kuai of m.content) {
          if (!kuai) continue;
          if (kuai.type === 'text') wenBen += String(kuai.text || '');
          else if (kuai.type === 'image_url' && kuai.image_url?.url) {
            const url = String(kuai.image_url.url);
            const b64 = url.replace(/^data:[^,]*,/, '');
            if (b64) tuJi.push(b64);
          }
        }
      } else if (m.content != null) {
        wenBen = String(m.content);
      }
      const ji: Record<string, unknown> = {
        role: m.role === 'tool' ? 'tool' : m.role,
        content: wenBen,
      };
      if (tuJi.length) ji.images = tuJi;
      // tool_call_id：Ollama 的 tool 消息要带，才能对上上一轮的 tool_calls
      if (m.role === 'tool' && m.toolCallId) ji.tool_call_id = m.toolCallId;
      // assistant 发起的工具调用（arguments **必须是对象**）
      if (m.role === 'assistant' && m.gongJuDiaoYongJi?.length) {
        ji.tool_calls = m.gongJuDiaoYongJi.map((t) => {
          let can: unknown = {};
          try {
            const s = String(t.function?.arguments ?? '').trim();
            can = s ? JSON.parse(s) : {};
          } catch { can = {}; }
          if (!can || typeof can !== 'object' || Array.isArray(can)) can = {};
          return { function: { name: t.function?.name || '', arguments: can } };
        });
      }
      return ji;
    });
    const ji: Record<string, unknown> = {
      model: Qiu.model,
      messages: xiaoXiJi,
      stream,
      options: {
        num_predict: Qiu.maxTokens,
        temperature: Qiu.temperature,
        top_p: Qiu.topP,
        stop: Qiu.stop,
      },
      ...Qiu.extra,
    };
    // 透传工具表（不支持的模型会忽略它；报错由外层降级）
    if (Qiu.tools?.length) {
      ji.tools = Qiu.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.function.name,
          description: t.function.description || '',
          parameters: t.function.parameters || { type: 'object', properties: {} },
        },
      }));
    }
    return ji;
  }

  async chat(Qiu: LiaoTianQingQiu, signal?: AbortSignal): Promise<LiaoTianXiangYing> {
    const res = await fetch(pinJieUrl(this.baseURL, 'api/chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.auth.headers },
      body: JSON.stringify(this.qingQiuTi(Qiu, false)),
      signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`ollama HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as {
      model: string;
      message?: {
        content?: string;
        /** Qwen3 / DeepSeek-R1 等：思考过程在**单独字段**里，不在 content */
        thinking?: string;
        reasoning_content?: string;
        tool_calls?: Array<{ function?: { name?: string; arguments?: unknown } }>;
      };
      done_reason?: string;
      prompt_eval_count?: number;
      eval_count?: number;
    };
    // 模型发起的工具调用（Ollama 用 tool_calls，参数可能是对象）
    const gongJu = (json.message?.tool_calls || []).map((t, i) => ({
      id: `ollama-call-${Date.now()}-${i}`,
      type: 'function' as const,
      function: {
        name: String(t?.function?.name || ''),
        arguments: typeof t?.function?.arguments === 'string'
          ? t.function.arguments
          : JSON.stringify(t?.function?.arguments || {}),
      },
    }));
    return {
      id: `ollama-${Date.now()}`,
      model: json.model || Qiu.model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: json.message?.content || '',
            /**
             * 思考过程原样带上（Ollama 放在 `message.thinking`，有的版本叫 `reasoning_content`）。
             * 不带上 ⇒ 界面「思考过程」永远是空的（真事故）。
             */
            ...((json.message?.thinking || json.message?.reasoning_content)
              ? { reasoning: String(json.message?.thinking || json.message?.reasoning_content) }
              : {}),
            ...(gongJu.length ? { gongJuDiaoYongJi: gongJu } : {}),
          },
          finishReason: gongJu.length ? 'tool_calls' : (json.done_reason === 'length' ? 'length' : 'stop'),
        },
      ],
      usage: guiFanYongLiang(
        {
          prompt_eval_count: json.prompt_eval_count,
          eval_count: json.eval_count,
        },
        'ollama'
      ),
      raw: json,
    };
  }

  async *chatStream(Qiu: LiaoTianQingQiu, signal?: AbortSignal): AsyncIterable<LiaoTianPian> {
    const res = await fetch(pinJieUrl(this.baseURL, 'api/chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.auth.headers },
      body: JSON.stringify(this.qingQiuTi(Qiu, true)),
      signal,
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      throw new Error(`ollama stream ${res.status}: ${text.slice(0, 200)}`);
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
        if (!t) continue;
        try {
          const j = JSON.parse(t);
          /**
           * **工具调用必须一起带出去**（真事故：模型明明调了工具，界面却是纯文本 ——
           * 因为流式解析只取了 content/thinking，`message.tool_calls` 被整段丢掉，
           * 上层看到的 `gongJuDiaoYongJi` 恒为空 ⇒ `tingZhiYuanYin='stop'` ⇒ 没有下一轮）。
           */
          const liuGongJu = (j.message?.tool_calls || []).map((c: { id?: string; function?: { name?: string; arguments?: unknown } }, k: number) => ({
            id: String(c?.id || `ollama-stream-${Date.now()}-${k}`),
            type: 'function' as const,
            function: {
              name: String(c?.function?.name || ''),
              arguments: typeof c?.function?.arguments === 'string'
                ? c.function.arguments
                : JSON.stringify(c?.function?.arguments || {}),
            },
          }));
          yield {
            id: '',
            model: j.model || Qiu.model,
            choices: [
              {
                index: 0,
                // 思考过程也在流里（Qwen3 等）—— 一并带出去，别丢
                delta: {
                  content: j.message?.content || '',
                  ...((j.message?.thinking || j.message?.reasoning_content)
                    ? { reasoning: String(j.message?.thinking || j.message?.reasoning_content) }
                    : {}),
                  ...(liuGongJu.length ? { gongJuDiaoYongJi: liuGongJu } : {}),
                },
                finishReason: j.done ? (liuGongJu.length ? 'tool_calls' : 'stop') : null,
              },
            ],
            /**
             * **最后一帧带上用量**（`prompt_eval_count` / `eval_count`）。
             * 真事故：流式路径不吐用量 ⇒ 上层（流式包装）累加出来一直是 0 ⇒
             * 总看板的「词元消耗」永远显示 0。
             */
            ...(j.done
              ? {
                  usage: guiFanYongLiang(
                    { prompt_eval_count: j.prompt_eval_count, eval_count: j.eval_count },
                    'ollama'
                  ),
                }
              : {}),
          };
          if (j.done) return;
        } catch {
          /* skip */
        }
      }
    }
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    try {
      const res = await fetch(pinJieUrl(this.baseURL, 'api/tags'), {
        method: 'GET',
        signal,
      });
      if (!res.ok) return [];
      const json = (await res.json()) as { models?: Array<{ name: string }> };
      return (json.models || []).map((m) => m.name);
    } catch {
      return [];
    }
  }

  /**
   * **问出每个本地模型到底会什么**（视觉 / 工具 / 思考 / 上下文长度）。
   *
   * 为什么必须问 `/api/show`：`/api/tags` 只给名字，**不带任何能力字段** ——
   * 于是只能按名字猜，猜不出来就只能标 unknown（真事故：用户拉了 Ollama 的多模态模型，
   * 「看图模型」链里却一个都没有，因为 `^qwen3` 这条把它们一律判成 vision:false）。
   * `/api/show` 的 `capabilities`（新版）或 `model_info` 里的 `clip`/`projector`/`mmproj`（旧版）
   * 才是**真能力**。
   */
  async listModelsDetailed(signal?: AbortSignal): Promise<Array<{
    id: string; thinkLevels: string[]; supportsThinking: boolean;
    vision: boolean | 'unknown'; tools: boolean | 'unknown';
    kind: string; contextLen: number;
  }>> {
    const ids = await this.listModels(signal);
    const out: Array<{ id: string; thinkLevels: string[]; supportsThinking: boolean; vision: boolean | 'unknown'; tools: boolean | 'unknown'; kind: string; contextLen: number }> = [];
    for (const id of ids) {
      let vision: boolean | 'unknown' = 'unknown';
      let tools: boolean | 'unknown' = 'unknown';
      let supportsThinking = false;
      let thinkLevels: string[] = [];
      let contextLen = 0;
      let kind = 'unknown';
      try {
        const res = await fetch(pinJieUrl(this.baseURL, 'api/show'), {
          method: 'POST',
          headers: this.auth.headers,
          body: JSON.stringify({ model: id }),
          signal,
        });
        if (res.ok) {
          const j = (await res.json()) as {
            capabilities?: unknown[];
            model_info?: Record<string, unknown>;
          };
          const caps = Array.isArray(j.capabilities) ? j.capabilities.map((x) => String(x).toLowerCase()) : [];
          const info = j.model_info || {};
          const infoKeys = Object.keys(info);
          if (caps.length) {
            vision = caps.some((c) => /vision|image/.test(c));
            tools = caps.some((c) => /tool|function/.test(c));
            supportsThinking = caps.some((c) => /think|reason/.test(c));
            // **按 capabilities 判类型**（真事故：bge-m3 是 embedding 模型，被当成可用聊天模型）
            if (caps.some((c) => /embedding/.test(c))) kind = 'embedding';
            else if (caps.some((c) => /vision|image/.test(c)) && !caps.some((c) => /completion|generate|chat/.test(c))) kind = 'image';
            else if (caps.some((c) => /completion|generate|chat|thinking/.test(c))) kind = 'chat';
          } else {
            // 旧版 Ollama：只能从 model_info 的 clip/projector/mmproj 判视觉
            const youShiJue = infoKeys.some((k) => /(^|\.)clip$|projector|mmproj|vision|(^|\.)llava/i.test(k));
            vision = youShiJue;
          }
          for (const k of infoKeys) {
            if (/context_length$/i.test(k)) {
              const n = Number(info[k]);
              if (Number.isFinite(n) && n > 0) { contextLen = Math.floor(n); break; }
            }
          }
          /**
           * **运行时上下文优先**（真机反馈修）：`model_info.*.context_length` 是模型的
           * **架构上限**（如 262144），而 `parameters` 里的 `num_ctx` 才是**实际跑用多少**
           * （如 131072）。预算滑块要跟"实际能用的窗口"走，否则显示虚高。
           */
          const can = String((j as { parameters?: string }).parameters || '');
          const mn = can.match(/^\s*num_ctx\s+(\d+)\s*$/im);
          if (mn) {
            const nn = Number(mn[1]);
            if (Number.isFinite(nn) && nn >= 1024) contextLen = Math.floor(nn);
          }
          if (supportsThinking) thinkLevels = ['low', 'medium', 'high'];
        }
      } catch {
        /* 单个模型查不到 ⇒ 保持 unknown（不猜） */
      }
      out.push({ id, thinkLevels, supportsThinking, vision, tools, kind, contextLen });
    }
    return out;
  }
}
