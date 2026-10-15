import fs from 'node:fs';
function edit(rel, pairs) {
  const p = rel;
  let s = fs.readFileSync(p, 'utf8');
  for (const [oldS, newS, tag] of pairs) {
    const n = s.split(oldS).length - 1;
    if (n !== 1) { console.error(`FAIL ${rel} [${tag}] hits=${n}`); process.exit(1); }
    s = s.replace(oldS, newS);
  }
  fs.writeFileSync(p, s, 'utf8');
  console.log(`OK ${rel} (${pairs.length})`);
}

// chatStream 也走 zhengXingXiaoXi
edit('packages/providers/src/ollama.ts', [
  [
    `  async *chatStream(Qiu: LiaoTianQingQiu, signal?: AbortSignal): AsyncIterable<LiaoTianPian> {
    const res = await fetch(pinJieUrl(this.baseURL, 'api/chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.auth.headers },
      body: JSON.stringify(this.qingQiuTi(Qiu, true)),
      signal,
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      throw new Error(\`ollama stream \${res.status}: \${text.slice(0, 200)}\`);
    }`,
    `  async *chatStream(Qiu: LiaoTianQingQiu, signal?: AbortSignal): AsyncIterable<LiaoTianPian> {
    /** 与 chat() 同一套失败回退：原样 → 去图 → 去 tools（分词失败不再整轮崩） */
    const caiDan = [this.qingQiuTi(Qiu, true)];
    {
      const quTu = this.qingQiuTi({ ...Qiu, xiaoXiJi: (Qiu.xiaoXiJi || []).map((m) => {
        if (!Array.isArray(m.content)) return m;
        const hasImg = (m.content as unknown[]).some((k) => k && (k as { type?: string }).type === 'image_url');
        if (!hasImg) return m;
        const wen = (m.content as Array<{ type?: string; text?: string }>)
          .map((k) => (k && k.type === 'text' ? String(k.text || '') : ''))
          .filter(Boolean).join('');
        return { ...m, content: (wen ? wen + '\\n' : '') + '（本轮附带的图片已省略：当前请求无法带图，请按文字说明继续）' };
      }) }, true);
      caiDan.push(quTu);
      if (Qiu.tools?.length) caiDan.push({ ...quTu, tools: undefined, tool_choice: undefined });
    }
    let res: Response | null = null;
    let cuoWu = '';
    for (let ci = 0; ci < caiDan.length; ci++) {
      const r = await fetch(pinJieUrl(this.baseURL, 'api/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.auth.headers },
        body: JSON.stringify(caiDan[ci]),
        signal,
      });
      if (r.ok && r.body) { res = r; break; }
      const text = await r.text().catch(() => '');
      cuoWu = \`ollama stream \${r.status}: \${text.slice(0, 200)}\`;
      if (r.status === 400 && ci < caiDan.length - 1) continue;
      if (r.status === 500 && ci < caiDan.length - 1) { await new Promise((x) => setTimeout(x, 1500)); continue; }
    }
    if (!res || !res.body) {
      throw new Error(cuoWu || 'ollama stream failed');
    }`,
    'stream-fallback',
  ],
]);

// electron-main：tokenize/400 硬失败不再自动续派
edit('packages/app-shell/src/electron-main.ts', [
  [
    `    const pan = yingGaiZiDongJiXu(sessionId, xiaoXi as { content?: string }, shangLun);`,
    `    /** **分词/模板硬失败 ⇒ 禁止自动续派**（真机：tokenize 400 被续派成死循环） */
    try {
      const shangCuo = String((shangLun as { cuoWu?: string } | undefined)?.cuoWu || '');
      if (/tokenize|invalid_request|HTTP 400/i.test(shangCuo)) {
        audit?.log('plan.auto-continue-skip-hard-error', { sessionId, error: shangCuo.slice(0, 120) });
        yanXuZhuangTai.delete(sessionId);
        try { broadcastToWindows('warmy:yunXingZhuangTai', { sessionId, kai: false, ts: Date.now() }); } catch { /* noop */ }
        return;
      }
    } catch { /* noop */ }
    const pan = yingGaiZiDongJiXu(sessionId, xiaoXi as { content?: string }, shangLun);`,
    'no-continue-on-400',
  ],
]);

console.log('phase ollama-2 done');
