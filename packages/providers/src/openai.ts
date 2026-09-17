import {
  BaseProvider,
  httpJson,
  joinUrl,
  messagesToOpenAI,
  parseOpenAIResponse,
} from './base.js';
import type { ChatChunk, ChatRequest, ChatResponse, ProviderAuth } from './types.js';

/**
 * OpenAI 兼容协议
 * 覆盖：DeepSeek / OpenAI / SiliconFlow / Moonshot / GLM / Groq / 自定义中转
 */
export class OpenAICompatibleProvider extends BaseProvider {
  readonly id: string;
  readonly protocol = 'openai-compatible' as const;

  constructor(auth: ProviderAuth, opts: { id?: string; defaultBase: string }) {
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

  private body(req: ChatRequest, stream: boolean): Record<string, unknown> {
    return {
      model: req.model,
      messages: messagesToOpenAI(req.messages),
      max_tokens: req.maxTokens,
      temperature: req.temperature,
      top_p: req.topP,
      stop: req.stop,
      tools: req.tools,
      tool_choice: req.toolChoice,
      stream,
      ...req.extra,
    };
  }

  async chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
    const json = await httpJson<Parameters<typeof parseOpenAIResponse>[0]>(
      joinUrl(this.baseURL, 'chat/completions'),
      { method: 'POST', body: JSON.stringify(this.body(req, false)), signal, headers: this.headers() },
      this.auth
    );
    return parseOpenAIResponse(json);
  }

  async *chatStream(req: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatChunk> {
    const res = await fetch(joinUrl(this.baseURL, 'chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.headers(),
        ...this.auth.headers,
      },
      body: JSON.stringify(this.body(req, true)),
      signal,
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      throw new Error(`stream HTTP ${res.status}: ${text.slice(0, 200)}`);
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
        if (!t.startsWith('data:')) continue;
        const data = t.slice(5).trim();
        if (data === '[DONE]') return;
        try {
          const j = JSON.parse(data);
          const c = j.choices?.[0];
          yield {
            id: j.id || '',
            model: j.model || req.model,
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
      const json = await httpJson<{ data?: Array<{ id: string }> }>(
        joinUrl(this.baseURL, 'models'),
        { method: 'GET', signal, headers: this.headers() },
        this.auth
      );
      return (json.data || []).map((m) => m.id);
    } catch {
      // 部分中转无 /models
      return [];
    }
  }
}

/** DeepSeek 预设工厂（OpenAI 兼容） */
export function createDeepSeekProvider(auth: ProviderAuth): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider(auth, {
    id: 'deepseek',
    defaultBase: 'https://api.deepseek.com',
  });
}
