import { JichuGongYing, kongYongLiang, qingQiuJson, pinJieUrl, guiFanYongLiang } from './base.js';
import type { LiaoTianPian, LiaoTianXiaoXi, LiaoTianQingQiu, LiaoTianXiangYing, GongYingRenZheng } from './types.js';

function chaiXiTong(messages: LiaoTianXiaoXi[]): { system?: string; rest: LiaoTianXiaoXi[] } {
  const sys = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const rest = messages.filter((m) => m.role !== 'system');
  return { system: sys || undefined, rest };
}

/** tool_call.arguments 是字符串（OpenAI 形状）；脏参数不能让整个请求 400 */
function anQuanJson(s: string | undefined): unknown {
  try {
    const v = JSON.parse(s || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

/**
 * Anthropic Messages API
 * https://docs.anthropic.com/en/api/messages
 */
export class AnthropicGongYing extends JichuGongYing {
  readonly id: string;
  readonly protocol = 'anthropic' as const;

  constructor(auth: GongYingRenZheng, opts: { id?: string; defaultBase?: string } = {}) {
    super(auth, opts.defaultBase || 'https://api.anthropic.com');
    this.id = opts.id || 'anthropic';
  }

  private headers(): Record<string, string> {
    return {
      'anthropic-version': '2023-06-01',
      ...(this.auth.apiKey ? { 'x-api-key': this.auth.apiKey } : {}),
    };
  }

  private body(req: LiaoTianQingQiu): Record<string, unknown> {
    const { system, rest } = chaiXiTong(req.messages);
    const contents: Array<{ role: string; content: unknown }> = [];
    for (const m of rest) {
      if (m.role === 'assistant' && m.toolCalls?.length) {
        contents.push({
          role: 'assistant',
          content: [
            ...(m.content ? [{ type: 'text', text: m.content }] : []),
            ...m.toolCalls.map((t) => ({
              type: 'tool_use',
              id: t.id,
              name: t.function.name,
              input: anQuanJson(t.function.arguments),
            })),
          ],
        });
        continue;
      }
      if (m.role === 'tool') {
        // Anthropic 要求 role 交替：一轮里的多个 tool_result 必须合成**一条** user 消息，
        // 否则连续两条 user 会被 API 拒绝（400 messages: roles must alternate）。
        const block = {
          type: 'tool_result',
          tool_use_id: m.toolCallId,
          content: m.content,
        };
        const prev = contents[contents.length - 1];
        const qianYiKuai = prev?.role === 'user' ? (prev.content as Array<{ type?: string }>) : null;
        if (qianYiKuai && Array.isArray(qianYiKuai) && qianYiKuai.every((b) => b?.type === 'tool_result')) {
          qianYiKuai.push(block);
        } else {
          contents.push({ role: 'user', content: [block] });
        }
        continue;
      }
      contents.push({ role: m.role === 'system' ? 'user' : m.role, content: m.content });
    }

    return {
      model: req.model,
      max_tokens: req.maxTokens ?? 1024,
      system,
      messages: contents,
      temperature: req.temperature,
      top_p: req.topP,
      stop_sequences: req.stop,
      tools: req.tools?.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters || { type: 'object', properties: {} },
      })),
      ...req.extra,
    };
  }

  async chat(req: LiaoTianQingQiu, signal?: AbortSignal): Promise<LiaoTianXiangYing> {
    const json = await qingQiuJson<{
      id: string;
      model: string;
      content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
      stop_reason: string;
      usage: Record<string, number>;
    }>(
      pinJieUrl(this.baseURL, 'v1/messages'),
      {
        method: 'POST',
        body: JSON.stringify(this.body(req)),
        signal,
        headers: this.headers(),
      },
      this.auth
    );

    const text = json.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text || '')
      .join('');
    const toolCalls = json.content
      .filter((c) => c.type === 'tool_use')
      .map((c) => ({
        id: c.id || '',
        type: 'function' as const,
        function: {
          name: c.name || '',
          arguments: JSON.stringify(c.input ?? {}),
        },
      }));

    return {
      id: json.id,
      model: json.model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: text,
            toolCalls: toolCalls.length ? toolCalls : undefined,
          },
          finishReason:
            json.stop_reason === 'tool_use'
              ? 'tool_calls'
              : json.stop_reason === 'max_tokens'
                ? 'length'
                : 'stop',
        },
      ],
      usage: guiFanYongLiang(json.usage, 'anthropic'),
      raw: json,
    };
  }

  async *chatStream(req: LiaoTianQingQiu, signal?: AbortSignal): AsyncIterable<LiaoTianPian> {
    const res = await fetch(pinJieUrl(this.baseURL, 'v1/messages'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.headers(),
        ...this.auth.headers,
      },
      body: JSON.stringify({ ...this.body(req), stream: true }),
      signal,
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      throw new Error(`anthropic stream ${res.status}: ${text.slice(0, 200)}`);
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
        try {
          const j = JSON.parse(t.slice(5).trim());
          if (j.type === 'content_block_delta' && j.delta?.type === 'text_delta') {
            yield {
              id: '',
              model: req.model,
              choices: [
                {
                  index: 0,
                  delta: { content: j.delta.text },
                  finishReason: null,
                },
              ],
            };
          }
          if (j.type === 'message_stop') return;
        } catch {
          /* skip */
        }
      }
    }
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    try {
      const json = await qingQiuJson<{ data?: Array<{ id: string }> }>(
        pinJieUrl(this.baseURL, 'v1/models'),
        { method: 'GET', signal, headers: this.headers() },
        this.auth
      );
      return (json.data || []).map((m) => m.id);
    } catch {
      return [];
    }
  }
}
