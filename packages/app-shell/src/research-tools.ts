/**
 * research-tools —— **调研管线**：搜索 → 抓取 → 摘录 → **带引用的结论**。
 *
 * 为什么必须有它
 * ---------------------------------------------------------------------------
 * 真事故：模型要"查资料"，手里只有一个 `fetch_url` —— 它得**先猜一个网址**再抓，
 * 猜错了就是 404；抓到一整页 HTML 也不会摘录，最后给用户的"结论"里**一条出处都没有**，
 * 用户没法核对（"有据可查"变成了"听它说"）。
 *
 * 这条管线的口径：
 *   1. **搜索**（`web_search`）：给出**排名 + 标题 + 摘要 + URL**，让模型先看再决定打开哪几条；
 *   2. **抓取**（`web_extract`）：把网页正文抽成干净文本（不是塞一坨 HTML）；
 *   3. **摘录**：按查询词把命中段落截出来，**每条都带 URL**；
 *   4. **结论**：由**模型**写，但必须基于上面带 URL 的材料 —— 工具本身不编结论。
 *
 * 供应商：Tavily（`/search` + `/extract`）。没有密钥时**如实失败**并告诉用户去哪儿配，
 * 绝不返回"看起来像结果"的假数据（这是本仓一贯的纪律）。
 *
 * 纯函数 + 全局 fetch —— 门禁可以注入假 fetch 直接断言（见 scripts/verify-research-pipeline.mjs）。
 */

export interface YanJiuJieGuo {
  ok: boolean;
  /** 命中的条目（已排序） */
  items: Array<{ title: string; url: string; snippet: string; score?: number }>;
  /** 供应商给出的"直接答案"（有就带，没就不编） */
  answer?: string;
  error?: string;
  /** 失败时的可操作提示 */
  hint?: string;
  /** 实际用的供应商 */
  provider?: string;
}

export const YAN_JIU_GONG_YING_SHANG = 'tavily';

/** 搜索：Tavily `/search`（只回**真实返回**的条目，不做任何"补全"） */
export async function souSuo(
  key: string,
  query: string,
  opts: { count?: number; depth?: 'basic' | 'advanced'; topic?: 'general' | 'news'; days?: number } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<YanJiuJieGuo> {
  const q = String(query || '').trim();
  if (!q) return { ok: false, items: [], error: 'empty-query' };
  if (!String(key || '').trim()) {
    return {
      ok: false, items: [], error: 'no-search-key',
      hint: '没有配置搜索密钥：请在「设置 → 搜索」里填 Tavily API Key（或让管理员配置），然后重试。不要凭记忆编造结果。',
    };
  }
  try {
    const body: Record<string, unknown> = {
      query: q,
      search_depth: opts.depth || 'advanced',
      max_results: Math.min(20, Math.max(1, Number(opts.count) || 8)),
      include_answer: true,
    };
    if (opts.topic) body['topic'] = opts.topic;
    if (opts.days) body['time_range'] = `${opts.days}d`;
    const r = await fetchImpl('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify(body),
    });
    const j = (await r.json().catch(() => null)) as { results?: Array<{ title?: string; url?: string; content?: string; score?: number }>; answer?: string; detail?: { error?: string } } | null;
    if (!r.ok) {
      return { ok: false, items: [], error: `search HTTP ${r.status}`, hint: String(j?.detail?.error || '').slice(0, 200) || undefined };
    }
    const items = (j?.results || []).map((x) => ({
      title: String(x.title || ''),
      url: String(x.url || ''),
      snippet: String(x.content || '').slice(0, 600),
      score: typeof x.score === 'number' ? x.score : undefined,
    })).filter((x) => x.url);
    return { ok: true, items, answer: j?.answer ? String(j.answer) : undefined, provider: YAN_JIU_GONG_YING_SHANG };
  } catch (e) {
    return { ok: false, items: [], error: 'search-failed：' + String((e as Error)?.message || e) };
  }
}

/** 抓取：Tavily `/extract`（拿正文，不是 HTML） */
export async function zhuaQuWenZhang(
  key: string,
  urls: string[],
  opts: { query?: string; depth?: 'basic' | 'advanced' } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; items: Array<{ url: string; text: string }>; error?: string; hint?: string }> {
  const lie = (Array.isArray(urls) ? urls : []).map((u) => String(u || '').trim()).filter((u) => /^https?:\/\//i.test(u)).slice(0, 5);
  if (!lie.length) return { ok: false, items: [], error: 'no-url', hint: '要抓取就给我 http/https 网址。' };
  if (!String(key || '').trim()) return { ok: false, items: [], error: 'no-search-key', hint: '没有配置搜索密钥（设置 → 搜索）。' };
  try {
    const body: Record<string, unknown> = { urls: lie, extract_depth: opts.depth || 'advanced' };
    if (opts.query) body['query'] = String(opts.query);
    const r = await fetchImpl('https://api.tavily.com/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify(body),
    });
    const j = (await r.json().catch(() => null)) as { results?: Array<{ url?: string; raw_content?: string }>; failed_results?: Array<{ url?: string; error?: string }> } | null;
    if (!r.ok) return { ok: false, items: [], error: `extract HTTP ${r.status}` };
    const items = (j?.results || []).map((x) => ({ url: String(x.url || ''), text: String(x.raw_content || '') }));
    const shiBai = (j?.failed_results || []).map((x) => String(x.url || '')).filter(Boolean);
    return {
      ok: items.length > 0,
      items,
      error: items.length ? undefined : 'extract-empty',
      hint: shiBai.length ? `这几条抓不到：${shiBai.slice(0, 3).join(' ')}` : undefined,
    };
  } catch (e) {
    return { ok: false, items: [], error: 'extract-failed：' + String((e as Error)?.message || e) };
  }
}

/** 在正文里按查询词**摘录**命中段落（每条都能指回原文，便于"有据可查"） */
export function zhaiLu(zhengWen: string, query: string, maxSeg = 3, kuan = 240): string[] {
  const text = String(zhengWen || '').replace(/\s+/g, ' ').trim();
  if (!text) return [];
  const ci = String(query || '').split(/\s+/).map((s) => s.trim()).filter((s) => s.length >= 2);
  const duan = text.split(/(?<=[。！？.!?])\s*/).filter((s) => s.trim().length > 10);
  const dai = duan.map((d, i) => {
    const fen = ci.reduce((n, c) => n + (d.toLowerCase().includes(c.toLowerCase()) ? 1 : 0), 0);
    return { d: d.trim(), i, fen };
  });
  const ming = dai.filter((x) => x.fen > 0).sort((a, b) => (b.fen - a.fen) || (a.i - b.i));
  const xuan = (ming.length ? ming : dai.slice(0, maxSeg)).slice(0, maxSeg);
  return xuan.map((x) => (x.d.length > kuan ? x.d.slice(0, kuan) + '…' : x.d));
}

/**
 * 把搜索结果整理成**给模型看、也给用户核**的文本：每条都带编号 URL。
 * 工具**不下结论** —— 结论由模型基于这些材料写（写不出就说材料不够）。
 */
export function geShiYanJiu(jie: YanJiuJieGuo, opts: { kuan?: number } = {}): string {
  if (!jie.ok) {
    return `[web_search] 失败：${jie.error}${jie.hint ? '\n提示：' + jie.hint : ''}\n（**不要凭记忆编造搜索结果**；要么按提示配好密钥，要么如实告诉用户查不到。）`;
  }
  const kuan = opts.kuan || 220;
  const hang = jie.items.map((x, i) => `[${i + 1}] ${x.title}\n    ${x.url}\n    ${x.snippet.slice(0, kuan)}`);
  return `[web_search] 供应商=${jie.provider || YAN_JIU_GONG_YING_SHANG} 命中 ${jie.items.length} 条`
    + (jie.answer ? `\n（供应商直接答案，**引用前请自行核对**）${jie.answer.slice(0, 400)}` : '')
    + '\n' + hang.join('\n')
    + '\n\n写结论时**必须带上出处编号对应的 URL**；材料不足就直说不足，不要补全。';
}

/** 抓取结果 → 带 URL 的摘录文本 */
export function geShiZhaiLu(items: Array<{ url: string; text: string }>, query: string): string {
  if (!items.length) return '[web_extract] 没有抓到正文（如实告诉用户，不要编造内容）。';
  return items.map((x, i) => {
    const zhai = zhaiLu(x.text, query);
    return `[${i + 1}] ${x.url}\n` + (zhai.length ? zhai.map((z) => '    · ' + z).join('\n') : '    （正文里没找到与查询相关的段落）');
  }).join('\n');
}
