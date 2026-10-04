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
      message?: { content?: string; tool_calls?: Array<{ function?: { name?: string; arguments?: unknown } }> };
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
          yield {
            id: '',
            model: j.model || Qiu.model,
            choices: [
              {
                index: 0,
                delta: { content: j.message?.content || '' },
                finishReason: j.done ? 'stop' : null,
              },
            ],
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
}
