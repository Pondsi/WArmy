/**
 * Ollama 修复：Failed to tokenize prompt
 *
 * 根因（真机 + 官方 API 文档）：
 *  1) chatOpenAIRequired 把多模态 content JSON.stringify 成一串 base64 文本 ⇒ 视觉模板分词失败
 *  2) Qwen3.5 视觉模板要求：system 只能在开头且不能带图；必须有真实 user 提问；tool 要有 tool_name
 *  3) 失败后无限重试同一坏请求 ⇒ plan.task-interrupted
 *
 * 修法：
 *  · 图片只挂在 user 消息的 images[]（Ollama 原生约定）
 *  · 多条 system 合并成一条放最前
 *  · tool 消息补 tool_name
 *  · toolChoice=required 且含图片时走原生 /api/chat（不走会丢图的 OpenAI 兼容捷径）
 *  · HTTP 400 tokenize ⇒ 先去图重试，再去 tools 重试，都失败才降级
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
function edit(rel, pairs) {
  const p = path.join(ROOT, rel);
  let s = fs.readFileSync(p, 'utf8');
  for (const [oldS, newS, tag] of pairs) {
    const n = s.split(oldS).length - 1;
    if (n !== 1) { console.error(`FAIL ${rel} [${tag}] hits=${n}`); process.exit(1); }
    s = s.replace(oldS, newS);
  }
  fs.writeFileSync(p, s, 'utf8');
  console.log(`OK ${rel} (${pairs.length})`);
}

const OL = 'packages/providers/src/ollama.ts';

edit(OL, [
  // 1) qingQiuTi：合并 system / 图片只挂 user / tool 补 tool_name
  [
    `  private qingQiuTi(Qiu: LiaoTianQingQiu, stream: boolean): Record<string, unknown> {
    const xiaoXiJi = Qiu.xiaoXiJi.map((m) => {`,
    `  /**
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
    // 图片挂到第一条 user
    if (tuZhuanYi.length) {
      const u = out.find((x) => x.role === 'user');
      if (u) {
        const yi = Array.isArray(u.images) ? (u.images as string[]) : [];
        u.images = [...yi, ...tuZhuanYi];
      }
    }
    // system 合并到最前
    if (systemBuf.length) {
      out.unshift({ role: 'system', content: systemBuf.join('\\n\\n') });
    }
    // 保证有真实 user 提问（模板：No user query found）
    const youTiWen = out.some((x) => x.role === 'user');
    if (!youTiWen) {
      out.push({ role: 'user', content: '请继续完成用户交代的任务，并如实汇报进度。' });
    }
    return out;
  }

  private qingQiuTi(Qiu: LiaoTianQingQiu, stream: boolean): Record<string, unknown> {
    const xiaoXiJi = Qiu.xiaoXiJi.map((m) => {`,
    'zhengxing-decl',
  ],
  [
    `      // tool_call_id：Ollama 的 tool 消息要带，才能对上上一轮的 tool_calls
      if (m.role === 'tool' && m.toolCallId) ji.tool_call_id = m.toolCallId;`,
    `      // tool_call_id / tool_name：Ollama 官方 API 要求 tool 消息能对上上一轮的 tool_calls
      if (m.role === 'tool') {
        if (m.toolCallId) ji.tool_call_id = m.toolCallId;
        const ming = String((m as { ming?: string; name?: string }).ming || (m as { name?: string }).name || '');
        if (ming) ji.tool_name = ming;
      }`,
    'tool-name',
  ],
  [
    `    const ji: Record<string, unknown> = {
      model: Qiu.model,
      messages: xiaoXiJi,
      stream,`,
    `    const ji: Record<string, unknown> = {
      model: Qiu.model,
      messages: this.zhengXingXiaoXi(xiaoXiJi),
      stream,`,
    'use-zhengxing',
  ],
  // 2) chatOpenAIRequired：多模态走正确形状；有图时不用 JSON.stringify
  [
    `      const body = {
        model: Qiu.model,
        messages: Qiu.xiaoXiJi.map((m) => {
          const wen = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
          const ji: Record<string, unknown> = { role: m.role, content: wen };`,
    `      const body = {
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
          const ji: Record<string, unknown> = { role: m.role, content };`,
    'openai-multimodal',
  ],
  [
    `          if (m.role === 'tool') {
            ji.role = 'tool';
            ji.tool_call_id = m.toolCallId;
          }
          return ji;
        }),`,
    `          if (m.role === 'tool') {
            ji.role = 'tool';
            ji.tool_call_id = m.toolCallId;
            const ming = String((m as { ming?: string; name?: string }).ming || (m as { name?: string }).name || '');
            if (ming) ji.name = ming;
          }
          return ji;
        }) as Array<Record<string, unknown>>,`,
    'openai-tool-name',
  ],
  // 3) chat：tokenize 失败时去图 → 去 tools 重试
  [
    `  async chat(Qiu: LiaoTianQingQiu, signal?: AbortSignal): Promise<LiaoTianXiangYing> {
    if (Qiu.toolChoice === 'required') {
      const forced = await this.chatOpenAIRequired(Qiu, signal);
      if (forced) return forced;
    }`,
    `  async chat(Qiu: LiaoTianQingQiu, signal?: AbortSignal): Promise<LiaoTianXiangYing> {
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
    }`,
    'required-skip-images',
  ],
  [
    `    // HTTP 500 自动重试 1 次（模型瞬时加载失败/资源不足是常见原因）
    for (let ci = 0; ci < 2; ci++) {
    const res = await fetch(pinJieUrl(this.baseURL, 'api/chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.auth.headers },
      body: JSON.stringify(this.qingQiuTi(Qiu, false)),
      signal: ben,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 500 && ci === 0) { await new Promise((r) => setTimeout(r, 2000)); continue; }
      throw new Error(\`ollama HTTP \${res.status}: \${text.slice(0, 200)}\`);
    }`,
    `    /**
     * **失败回退阶梯**（修 Failed to tokenize prompt 后的死循环）：
     *  ① 原样请求
     *  ② 400 分词失败且带图 ⇒ 去掉图片（正文里注明"图已省略"）再试
     *  ③ 仍失败且带 tools ⇒ 不带 tools 再试（模板对 tools 形状敏感）
     *  ④ 都失败才抛错 —— 外层降级链接手。
     */
    const jiShi = [
      this.qingQiuTi(Qiu, false),
    ];
    {
      const quTu = this.qingQiuTi({ ...Qiu, xiaoXiJi: (Qiu.xiaoXiJi || []).map((m) => {
        if (!Array.isArray(m.content)) return m;
        const hasImg = (m.content as unknown[]).some((k) => k && (k as { type?: string }).type === 'image_url');
        if (!hasImg) return m;
        const wen = (m.content as Array<{ type?: string; text?: string }>)
          .map((k) => (k && k.type === 'text' ? String(k.text || '') : ''))
          .filter(Boolean).join('');
        return { ...m, content: (wen ? wen + '\\n' : '') + '（本轮附带的图片已省略：当前请求无法带图，请按文字说明继续）' };
      }) }, false);
      jiShi.push(quTu);
      if (Qiu.tools?.length) {
        jiShi.push({ ...quTu, tools: undefined, tool_choice: undefined });
      }
    }
    let cuoWu = '';
    for (let ci = 0; ci < jiShi.length; ci++) {
      const res = await fetch(pinJieUrl(this.baseURL, 'api/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.auth.headers },
        body: JSON.stringify(jiShi[ci]),
        signal: ben,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        cuoWu = \`ollama HTTP \${res.status}: \${text.slice(0, 200)}\`;
        // 500 瞬时故障：稍等再试下一档
        if (res.status === 500 && ci < jiShi.length - 1) { await new Promise((r) => setTimeout(r, 2000)); continue; }
        // 400 分词/模板问题：进下一档（去图 / 去 tools）
        if (res.status === 400 && ci < jiShi.length - 1) continue;
        throw new Error(cuoWu);
      }`,
    'fallback-ladder',
  ],
  // 需要在循环体后闭合 for —— 找原来的 json 解析并保持
]);

console.log('phase ollama-1 done');
