import { JichuGongYing, kongYongLiang, qingQiuJson, pinJieUrl, guiFanYongLiang } from './base.js';
import type { LiaoTianPian, LiaoTianXiaoXi, LiaoTianQingQiu, LiaoTianXiangYing, GongYingRenZheng } from './types.js';

function chaiXiTong(xiaoXiJi: LiaoTianXiaoXi[]): { system?: string; qiYu: LiaoTianXiaoXi[] } {
  const xitongTiShi = xiaoXiJi
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const qiYu = xiaoXiJi.filter((m) => m.role !== 'system');
  return { system: xitongTiShi || undefined, qiYu };
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
 * https://docs.anthropic.com/en/api/xiaoXiJi
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

  private qingQiuTi(Qiu: LiaoTianQingQiu): Record<string, unknown> {
    const { system, qiYu } = chaiXiTong(Qiu.xiaoXiJi);
    const neiRongJi: Array<{ role: string; content: unknown }> = [];
    for (const m of qiYu) {
      if (m.role === 'assistant' && m.gongJuDiaoYongJi?.length) {
        neiRongJi.push({
          role: 'assistant',
          content: [
            ...(m.content ? [{ type: 'text', text: m.content }] : []),
            ...m.gongJuDiaoYongJi.map((t) => ({
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
        // 否则连续两条 user 会被 API 拒绝（400 xiaoXiJi: roles must alternate）。
        const kuai = {
          type: 'tool_result',
          tool_use_id: m.toolCallId,
          content: m.content,
        };
        const prev = neiRongJi[neiRongJi.length - 1];
        const qianYiKuai = prev?.role === 'user' ? (prev.content as Array<{ type?: string }>) : null;
        if (qianYiKuai && Array.isArray(qianYiKuai) && qianYiKuai.every((b) => b?.type === 'tool_result')) {
          qianYiKuai.push(kuai);
        } else {
          neiRongJi.push({ role: 'user', content: [kuai] });
        }
        continue;
      }
      neiRongJi.push({ role: m.role === 'system' ? 'user' : m.role, content: m.content });
    }

    return {
      model: Qiu.model,
      max_tokens: Qiu.maxTokens ?? 1024,
      system,
      content: neiRongJi,
      temperature: Qiu.temperature,
      top_p: Qiu.topP,
      stop_sequences: Qiu.stop,
      tools: Qiu.tools?.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters || { type: 'object', properties: {} },
      })),
      ...Qiu.extra,
    };
  }

  async chat(Qiu: LiaoTianQingQiu, signal?: AbortSignal): Promise<LiaoTianXiangYing> {
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
        body: JSON.stringify(this.qingQiuTi(Qiu)),
        signal,
        headers: this.headers(),
      },
      this.auth
    );

    const text = json.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text || '')
      .join('');
    const gongJuDiaoYongJi = json.content
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
            gongJuDiaoYongJi: gongJuDiaoYongJi.length ? gongJuDiaoYongJi : undefined,
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

  async *chatStream(Qiu: LiaoTianQingQiu, signal?: AbortSignal): AsyncIterable<LiaoTianPian> {
    const res = await fetch(pinJieUrl(this.baseURL, 'v1/messages'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.headers(),
        ...this.auth.headers,
      },
      body: JSON.stringify({ ...this.qingQiuTi(Qiu), stream: true }),
      signal,
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      throw new Error(`anthropic stream ${res.status}: ${text.slice(0, 200)}`);
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
        try {
          const j = JSON.parse(t.slice(5).trim());
          if (j.type === 'content_block_delta' && j.delta?.type === 'text_delta') {
            yield {
              id: '',
              model: Qiu.model,
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
