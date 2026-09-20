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
   * Ollama 的 /api/chat 目前只对部分模型支持 tools，旧版本对 tools 字段直接报错，
   * 且本 provider 的 body() 也不透传 tools —— 如实声明"不支持"，
   * 让工具调用循环走优雅降级（普通单轮对话），而不是把整轮对话打成 error。
   */
  override get supportsTools(): boolean {
    return false;
  }

  private body(req: LiaoTianQingQiu, stream: boolean): Record<string, unknown> {
    const messages = req.messages.map((m) => ({
      role: m.role === 'tool' ? 'tool' : m.role,
      content: m.content,
    }));
    return {
      model: req.model,
      messages,
      stream,
      options: {
        num_predict: req.maxTokens,
        temperature: req.temperature,
        top_p: req.topP,
        stop: req.stop,
      },
      ...req.extra,
    };
  }

  async chat(req: LiaoTianQingQiu, signal?: AbortSignal): Promise<LiaoTianXiangYing> {
    const res = await fetch(pinJieUrl(this.baseURL, 'api/chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.auth.headers },
      body: JSON.stringify(this.body(req, false)),
      signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`ollama HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as {
      model: string;
      message?: { content?: string };
      done_reason?: string;
      prompt_eval_count?: number;
      eval_count?: number;
    };
    return {
      id: `ollama-${Date.now()}`,
      model: json.model || req.model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: json.message?.content || '' },
          finishReason: json.done_reason === 'length' ? 'length' : 'stop',
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

  async *chatStream(req: LiaoTianQingQiu, signal?: AbortSignal): AsyncIterable<LiaoTianPian> {
    const res = await fetch(pinJieUrl(this.baseURL, 'api/chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.auth.headers },
      body: JSON.stringify(this.body(req, true)),
      signal,
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      throw new Error(`ollama stream ${res.status}: ${text.slice(0, 200)}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        try {
          const j = JSON.parse(t);
          yield {
            id: '',
            model: j.model || req.model,
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
