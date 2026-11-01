import { JichuGongYing, pinJieUrl, guiFanYongLiang, FEI_LIU_CHAT_MS } from './base.js';
import type { LiaoTianPian, LiaoTianQingQiu, LiaoTianXiangYing, GongYingRenZheng } from './types.js';

/** 只放行 PNG / JPEG 的 base64：一张解不开的图会让 Ollama 整个请求 400/500，连同截图一起丢 */
function keFaTu(url: string): string {
  const b64 = url.replace(/^data:[^,]*,/, '').replace(/^\s+/, '');
  return /^(?:iVBORw0K|[/_]9j[/_])/.test(b64) ? b64 : '';
}

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

  /**
   * **消息整形**（修 Failed to tokenize prompt）：
   *  · 多条 system 合并成一条放最前（Qwen 视觉模板：system 只能在开头）
   *  · 图片只允许出现在 user 消息（模板：System message cannot contain images）
   *  · tool 消息补 tool_name（官方 API 约定）
   *  · 保证至少有一条非 tool_response 的 user 提问
   */
  private zhengXingXiaoXi(xiaoXiJi: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
    const systemBuf: string[] = [];
    const tuZhuanYi: string[] = [];
    const out: Array<Record<string, unknown>> = [];
    for (const m of xiaoXiJi) {
      const role = String(m.role || '');
      const images = Array.isArray(m.images) ? (m.images as string[]) : [];
      const content = String(m.content ?? '');
      if (role === 'system') {
        if (content.trim()) systemBuf.push(content);
        if (images.length) tuZhuanYi.push(...images);
        continue;
      }
      if (role !== 'user' && images.length) {
        // 非 user 不许带图：并到稍后的 user，或丢弃
        tuZhuanYi.push(...images);
      }
      const ji: Record<string, unknown> = { ...m };
      if (role !== 'user') delete ji.images;
      out.push(ji);
    }
    // 图片挂到第一条 user（没有 user 就挂到后面补的那条，绝不丢图）
    if (tuZhuanYi.length) {
      const u = out.find((x) => x.role === 'user');
      if (u) {
        const yi = Array.isArray(u.images) ? (u.images as string[]) : [];
        u.images = [...yi, ...tuZhuanYi];
      } else {
        out.push({ role: 'user', content: '请查看附带的图片，并继续完成用户交代的任务。', images: tuZhuanYi });
      }
    }
    // system 合并到最前
    if (systemBuf.length) {
      out.unshift({ role: 'system', content: systemBuf.join('\n\n') });
    }
    // 保证有真实 user 提问（模板：No user query found）
    const youTiWen = out.some((x) => x.role === 'user');
    if (!youTiWen) {
      out.push({ role: 'user', content: '请继续完成用户交代的任务，并如实汇报进度。' });
    }
    return out;
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
      let tuDiu = 0;
      if (typeof m.content === 'string') {
        wenBen = m.content;
      } else if (Array.isArray(m.content)) {
        for (const kuai of m.content) {
          if (!kuai) continue;
          if (kuai.type === 'text') wenBen += String(kuai.text || '');
          else if (kuai.type === 'image_url' && kuai.image_url?.url) {
            const b64 = keFaTu(String(kuai.image_url.url));
            if (b64) tuJi.push(b64);
            else tuDiu++;
          }
        }
      } else if (m.content != null) {
        wenBen = String(m.content);
      }
      if (tuDiu) wenBen += `\n（附带的 ${tuDiu} 张图片不是 PNG/JPEG，没有送给模型；如被问到请如实说看不到它们）`;
      const ji: Record<string, unknown> = {
        role: m.role === 'tool' ? 'tool' : m.role,
        content: wenBen,
      };
      if (tuJi.length) ji.images = tuJi;
      // tool_call_id / tool_name：Ollama 官方 API 要求 tool 消息能对上上一轮的 tool_calls
      if (m.role === 'tool') {
        if (m.toolCallId) ji.tool_call_id = m.toolCallId;
        const ming = String((m as { ming?: string; name?: string }).ming || (m as { name?: string }).name || '');
        if (ming) ji.tool_name = ming;
      }
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
        if (m.reasoning) ji.thinking = m.reasoning;
      }
      return ji;
    });
    const ji: Record<string, unknown> = {
      model: Qiu.model,
      messages: this.zhengXingXiaoXi(xiaoXiJi),
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
      /**
       * tool_choice：新版 Ollama / OpenAI 兼容端认 `'required'`（强制出工具）。
       * 旧版忽略该字段也不报错；不支持时外层降级链兜住。
       */
      if (Qiu.toolChoice) ji.tool_choice = Qiu.toolChoice;
    }
    return ji;
  }

  /**
   * 失败回退阶梯：① 原样 → ② 带图才有：去图（正文注明已省略）→ ③ 带 tools 才有：再去 tools。
   * 都失败才抛错，外层降级链接手。没有图时不重复发同一个请求体。
   */
  private huiTuiJieTi(Qiu: LiaoTianQingQiu, stream: boolean): Array<{ ti: Record<string, unknown>; diuTu: number }> {
    let zongTu = 0;
    let keFa = 0;
    for (const m of Qiu.xiaoXiJi || []) {
      if (!Array.isArray(m.content)) continue;
      for (const k of m.content as Array<{ type?: string; image_url?: { url?: string } }>) {
        if (!k || k.type !== 'image_url' || !k.image_url?.url) continue;
        zongTu++;
        if (keFaTu(String(k.image_url.url))) keFa++;
      }
    }
    const yuanTi = this.qingQiuTi(Qiu, stream);
    const jie = [{ ti: yuanTi, diuTu: zongTu - keFa }];
    let youTu = false;
    const quTuJi = (Qiu.xiaoXiJi || []).map((m) => {
      if (!Array.isArray(m.content)) return m;
      if (!(m.content as unknown[]).some((k) => k && (k as { type?: string }).type === 'image_url')) return m;
      youTu = true;
      const wen = (m.content as Array<{ type?: string; text?: string }>)
        .map((k) => (k && k.type === 'text' ? String(k.text || '') : ''))
        .filter(Boolean).join('');
      return { ...m, content: (wen ? wen + '\n' : '') + '（本轮附带的图片已省略：当前请求无法带图，请按文字说明继续；被问到图片时如实说没看到）' };
    });
    const quTu = youTu ? this.qingQiuTi({ ...Qiu, xiaoXiJi: quTuJi }, stream) : yuanTi;
    if (youTu) jie.push({ ti: quTu, diuTu: zongTu });
    if (Qiu.tools?.length) jie.push({ ti: { ...quTu, tools: undefined, tool_choice: undefined }, diuTu: youTu ? zongTu : zongTu - keFa });
    return jie;
  }

  /**
   * toolChoice=required 走 OpenAI 兼容端（v1/chat/completions）：
   * 原生 /api/chat 对 tool_choice 支持不完整；OpenAI 兼容端认 required。
   * 失败返回 null，回落原生端。
   */
  private async chatOpenAIRequired(Qiu: LiaoTianQingQiu, signal?: AbortSignal): Promise<LiaoTianXiangYing | null> {
    try {
      const body = {
        model: Qiu.model,
        messages: this.zhengXingXiaoXi(Qiu.xiaoXiJi.map((m) => {
          /**
           * **多模态内容不能 JSON.stringify**（真事故：base64 被当成正文 ⇒ Failed to tokenize prompt）。
           * 有图时转成 OpenAI 的 content 数组（text + image_url）；纯文本保持字符串。
           */
          let content: unknown;
          if (typeof m.content === 'string') {
            content = m.content;
          } else if (Array.isArray(m.content)) {
            const kuai = m.content.map((k) => {
              if (!k) return null;
              if (k.type === 'text') return { type: 'text', text: String(k.text || '') };
              if (k.type === 'image_url' && k.image_url?.url) {
                return { type: 'image_url', image_url: { url: String(k.image_url.url) } };
              }
              return null;
            }).filter(Boolean);
            const youTu = kuai.some((k) => (k as { type?: string }).type === 'image_url');
            content = youTu ? kuai : kuai.map((k) => String((k as { text?: string }).text || '')).join('');
          } else {
            content = String(m.content ?? '');
          }
          const ji: Record<string, unknown> = { role: m.role, content };
          if (m.role === 'assistant' && m.gongJuDiaoYongJi?.length) {
            ji.tool_calls = m.gongJuDiaoYongJi.filter((t) => t.function?.name).map((t) => ({
              id: t.id,
              type: 'function',
              function: { name: t.function?.name || '', arguments: t.function?.arguments || '{}' },
            }));
          }
          if (m.role === 'tool') {
            ji.role = 'tool';
            ji.tool_call_id = m.toolCallId;
            const ming = String((m as { ming?: string; name?: string }).ming || (m as { name?: string }).name || '');
            if (ming) ji.name = ming;
          }
          return ji;
        }) as Array<Record<string, unknown>>),
        tools: Qiu.tools?.map((t) => ({
          type: 'function',
          function: {
            name: t.function.name,
            description: t.function.description || '',
            parameters: t.function.parameters || { type: 'object', properties: {} },
          },
        })),
        tool_choice: 'required',
        stream: false,
        ...(Qiu.maxTokens != null ? { max_tokens: Qiu.maxTokens } : {}),
      };
      const yu2 = AbortSignal.timeout(this.auth.timeoutMs ?? FEI_LIU_CHAT_MS);
      const ben2 = signal ? AbortSignal.any([signal, yu2]) : yu2;
      const res = await fetch(pinJieUrl(this.baseURL, 'v1/chat/completions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.auth.headers },
        body: JSON.stringify(body),
        signal: ben2,
      });
      if (!res.ok) return null;
      const json = await res.json() as {
        model?: string;
        choices?: Array<{ message?: { content?: string; thinking?: string; reasoning_content?: string; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: unknown } }> } }>;
      };
      const msg = json.choices?.[0]?.message || {};
      const gongJu = (msg.tool_calls || []).filter((t) => t && t.function?.name).map((t) => ({
        id: t.id || 'call_' + Math.random().toString(36).slice(2),
        type: 'function' as const,
        function: {
          name: String(t.function?.name || ''),
          arguments: typeof t.function?.arguments === 'string'
            ? t.function?.arguments
            : JSON.stringify(t.function?.arguments ?? {}),
        },
      }));
      return {
        id: 'ollama-required',
        model: json.model || Qiu.model,
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: String(msg.content || ''),
            ...(String(msg.thinking || msg.reasoning_content || '')
              ? { reasoning: String(msg.thinking || msg.reasoning_content || '') }
              : {}),
            ...(gongJu.length ? { gongJuDiaoYongJi: gongJu } : {}),
          },
          finishReason: gongJu.length ? 'tool_calls' : 'stop',
        }],
        usage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          cacheHitTokens: 0,
          cacheMissTokens: 0,
          source: 'none',
        },
      };
    } catch {
      return null;
    }
  }

  async chat(Qiu: LiaoTianQingQiu, signal?: AbortSignal): Promise<LiaoTianXiangYing> {
    /**
     * toolChoice=required：原生 /api/chat 对 tool_choice 支持不稳，优先走 OpenAI 兼容端；
     * **但消息里带图片时不能走那条捷径**（历史 bug：图片被 JSON.stringify ⇒ 分词失败），
     * 走下面的原生路径（qingQiuTi 已把图片放进 images[]）。
     */
    const youTu = (Qiu.xiaoXiJi || []).some((m) => Array.isArray(m.content)
      && (m.content as unknown[]).some((k) => k && (k as { type?: string }).type === 'image_url'));
    if (Qiu.toolChoice === 'required' && !youTu) {
      const forced = await this.chatOpenAIRequired(Qiu, signal);
      if (forced) return forced;
    }
    /**
     * 单次请求硬超时（真机：Ollama 无超时 fetch 会把工具循环挂死，界面永远 busy）。
     * 上限与 openai/anthropic 同一个数：本机模型只会比云端慢 —— 旧值 60s 把 27B 的 8192 token 兜底请求掐在半路（server.log 记 500）。
     */
    const yu = AbortSignal.timeout(this.auth.timeoutMs ?? FEI_LIU_CHAT_MS);
    const ben = signal ? AbortSignal.any([signal, yu]) : yu;
    const jiShi = this.huiTuiJieTi(Qiu, false);
    let cuoWu = '';
    let chong500 = false;
    for (let ci = 0; ci < jiShi.length; ci++) {
      const res = await fetch(pinJieUrl(this.baseURL, 'api/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.auth.headers },
        body: JSON.stringify(jiShi[ci]!.ti),
        signal: ben,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        cuoWu = `ollama HTTP ${res.status}: ${text.slice(0, 200)}`;
        // 500 多是 runner 加载中/瞬时崩：同一档先重发一次，仍失败才降档（别一次 500 就把图丢了）
        if (res.status === 500 && !chong500) { chong500 = true; await new Promise((r) => setTimeout(r, 2000)); ci--; continue; }
        chong500 = false;
        if ((res.status === 400 || res.status === 500) && ci < jiShi.length - 1) continue;
        throw new Error(cuoWu);
      }
    const json = (await res.json()) as {
      model: string;
      message?: {
        content?: string;
        /** Qwen3 / DeepSeek-R1 等：思考过程在**单独字段**里，不在 content */
        thinking?: string;
        reasoning_content?: string;
        tool_calls?: Array<{ function?: { name?: string; arguments?: unknown }; name?: string; arguments?: unknown }>;
      };
      done_reason?: string;
      prompt_eval_count?: number;
      eval_count?: number;
    };
    // 模型发起的工具调用（Ollama 用 tool_calls，参数可能是对象）
    const gongJu = (json.message?.tool_calls || []).map((t, i) => {
      const fn = t?.function || t;
      return {
        id: `ollama-call-${Date.now()}-${i}`,
        type: 'function' as const,
        function: {
          name: String(fn?.name || ''),
          arguments: typeof fn?.arguments === 'string'
            ? fn.arguments
            : JSON.stringify(fn?.arguments || {}),
        },
      };
    }).filter((c) => c.function.name);
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
      ...(jiShi[ci]!.diuTu > 0 ? { tuShengLue: jiShi[ci]!.diuTu } : {}),
      raw: json,
    };
    }
    throw new Error('ollama retry exhausted');
  }

  async *chatStream(Qiu: LiaoTianQingQiu, signal?: AbortSignal): AsyncIterable<LiaoTianPian> {
    const caiDan = this.huiTuiJieTi(Qiu, true);
    let res: Response | null = null;
    let cuoWu = '';
    let chong500 = false;
    for (let ci = 0; ci < caiDan.length; ci++) {
      const r = await fetch(pinJieUrl(this.baseURL, 'api/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.auth.headers },
        body: JSON.stringify(caiDan[ci]!.ti),
        signal,
      });
      if (r.ok && r.body) { res = r; break; }
      const text = await r.text().catch(() => '');
      cuoWu = `ollama stream ${r.status}: ${text.slice(0, 200)}`;
      if (r.status === 500 && !chong500) { chong500 = true; await new Promise((x) => setTimeout(x, 1500)); ci--; continue; }
      chong500 = false;
      if ((r.status === 400 || r.status === 500) && ci < caiDan.length - 1) continue;
      break;
    }
    if (!res || !res.body) {
      throw new Error(cuoWu || 'ollama stream failed');
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
    kind: string; contextLen: number; buKeYong?: string;
  }>> {
    const ids = await this.listModels(signal);
    const out: Array<{ id: string; thinkLevels: string[]; supportsThinking: boolean; vision: boolean | 'unknown'; tools: boolean | 'unknown'; kind: string; contextLen: number; buKeYong?: string }> = [];
    for (const id of ids) {
      let vision: boolean | 'unknown' = 'unknown';
      let tools: boolean | 'unknown' = 'unknown';
      let supportsThinking = false;
      let thinkLevels: string[] = [];
      let contextLen = 0;
      let kind = 'unknown';
      let jiaTing = '';
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
            details?: { family?: unknown; families?: unknown };
          };
          const caps = Array.isArray(j.capabilities) ? j.capabilities.map((x) => String(x).toLowerCase()) : [];
          const info = j.model_info || {};
          const infoKeys = Object.keys(info);
          /**
           * **`details.family` 是"这台 Ollama 到底加不加载得动"的硬事实**（第 27 轮，真机实测）：
           * `dimavz/whisper-tiny:latest` → `family:"unknown"`，`/api/generate` **连纯文本都失败**：
           * `error loading model: unknown model architecture: ''`（whisper.cpp 的 GGUF 不导出
           * `general.architecture`，llama.cpp 认不出来）。它的 `capabilities` 却写着 `["completion"]`
           * —— 那是识别不出架构时的**兜底值**，不能当成"它会对话"。
           * ⇒ family 为 unknown/空的模型**不进任何调用链**（听话/说话/向量/看图都不进），
           *    并在界面上写清为什么，免得用户以为"配了却不好用"。
           */
          const jiaTing0 = String((j.details && j.details.family) || '').trim().toLowerCase();
          const jiaZu = Array.isArray(j.details?.families) ? (j.details?.families || []).map((x) => String(x).toLowerCase()) : [];
          if (!jiaTing0 || jiaTing0 === 'unknown') {
            const keNeng = jiaZu.filter((x) => x && x !== 'unknown');
            if (!keNeng.length) jiaTing = 'Ollama 认不出这个模型的架构（details.family=unknown），实测加载失败：'
              + '"error loading model: unknown model architecture" —— 它在 Ollama 里既不能对话也不能转写';
          }
          if (caps.length) {
            vision = caps.some((c) => /vision|image/.test(c));
            /**
             * **不要把「capabilities 里没写 tools」当成「不能用工具」**（真机：
             * Qwen3.8-27B-Uncensored:iq4_xs 等明明能 function calling，却被标成
             * 无法调用工具）。只有明确声明 tool/function 才写 true；
             * 完全没提 ⇒ 'unknown'，交给已知表/外层降级链判断。
             */
            const youTools = caps.some((c) => /tool|function/.test(c));
            if (youTools) tools = true;
            else tools = 'unknown';
            supportsThinking = caps.some((c) => /think|reason/.test(c));
            /**
             * **名字优先**（真事故：`dimavz/whisper-tiny:latest` 的 capabilities 只有 `completion`，
             * 于是被判成「对话 + 工具」——它其实是**语音识别**模型，被选进对话链必然出错）。
             * 名字里明确是 ASR / TTS / 嵌入 / 重排 / 图像生成的，一律按名字归类。
             */
            const quanMing = String(id || '').toLowerCase();
            if (/whisper|\basr\b|speech-to-text|\bstt\b|paraformer|sensevoice/.test(quanMing)) { kind = 'asr'; tools = false; }
            else if (/\btts\b|text-to-speech|cosyvoice|vits|bark|sovits/.test(quanMing)) { kind = 'tts'; tools = false; }
            else if (/bge-|embed|gte-|nomic-embed|text-embedding/.test(quanMing)) { kind = 'embedding'; tools = false; }
            else if (/rerank/.test(quanMing)) { kind = 'rerank'; tools = false; }
            else if (/stable-diffusion|sdxl|flux|text-to-image/.test(quanMing)) { kind = 'imageUnd'; tools = false; }
            // **按 capabilities 判类型**（真事故：bge-m3 是 embedding 模型，被当成可用聊天模型）
            else if (caps.some((c) => /embedding/.test(c))) kind = 'embedding';
            /**
             * 第 35 轮 项 7：**先认 `decision`（分类/决策模型）**。
             * 实测 `clef:latest` / `clef-flash:latest` 的能力是 `decision,vision` ——
             * 没有 completion，但**会看图**做分类。旧代码只看到"有 vision 没 completion"
             * 就判成 `image`（画图），界面上于是给一个决策模型打上「画图」标签。
             * 用户也明确说：这两个是分类（决策）模型。
             */
            else if (caps.some((c) => /decision|classif/.test(c))) kind = 'decision';
            /**
             * 第 35 轮 项 7：**Ollama 根本不会生成图片**，`vision` 只代表"能读图"。
             * 有 vision 而没有 completion ⇒ 明确是**图像理解**（`imageUnd`），
             * 绝不能升级成 `image`（生成）。真正的生成模型只在显式声明时才算。
             */
            else if (caps.some((c) => /vision|image/.test(c)) && !caps.some((c) => /completion|generate|chat|thinking/.test(c))) kind = 'imageUnd';
            else if (caps.some((c) => /completion|generate|chat|thinking/.test(c))) kind = 'chat';
            // 聊天类默认可试 tools（Ollama 多数 chat 模型支持；失败由外层降级）
            if (kind === 'chat' && tools === 'unknown') tools = true;
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
      out.push({ id, thinkLevels, supportsThinking, vision, tools, kind: jiaTing ? 'unknown' : kind, contextLen, ...(jiaTing ? { buKeYong: jiaTing } : {}) });
    }
    return out;
  }
}
