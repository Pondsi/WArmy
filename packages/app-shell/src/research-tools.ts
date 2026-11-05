/**
 * research-tools —— **调研管线**：搜索 → 抓取 → 摘录 → **带引用的结论**。
 *
 * 供应商口径（第 123 轮用户定稿）：
 *   · 搜索：**Firecrawl Keyless**（不注册、不填 key，按 IP 每日免额度重置）；
 *   · 抓取：Firecrawl Keyless 优先，失败时回退 **Jina Reader**（同样不注册）；
 *   · Jina Search 目前无 key 会返回 401，因此**不作为搜索供应商**，绝不假装它能用。
 *
 * 不注册也能用，是本项目对普通用户的硬要求：没有 key 时**不许失败**，也不许编结果。
 * Key 只在用户主动填写时作为可选增强（更高额度），不是使用前提。
 *
 * 纯函数 + 全局 fetch —— 门禁可以注入假 fetch 直接断言（见 scripts/verify-research-pipeline.mjs）。
 */

export interface YanJiuJieGuo {
  ok: boolean;
  /** 命中的条目（已排序） */
  items: Array<{ title: string; url: string; snippet: string; score?: number; via?: string }>;
  /** 供应商给出的"直接答案"（有就带，没就不编） */
  answer?: string;
  error?: string;
  /** 失败时的可操作提示 */
  hint?: string;
  /** 实际用的供应商 */
  provider?: string;
  /** 429 时供应商要求的等待秒数 */
  retryAfterSec?: number;
  /** 是否命中限流/额度 */
  rateLimited?: boolean;
  /** 多供应商尝试记录（按顺序） */
  attempts?: Array<{ provider: string; error?: string; status?: number; retryAfterSec?: number }>;
}

export const YAN_JIU_GONG_YING_SHANG = 'firecrawl-keyless';
export const FIRECRAWL_SEARCH_URL = 'https://api.firecrawl.dev/v2/search';
export const FIRECRAWL_SCRAPE_URL = 'https://api.firecrawl.dev/v2/scrape';
export const JINA_READER_URL = 'https://r.jina.ai/';

type FetchImpl = typeof fetch;

function qingKey(key: unknown): string {
  return String(key || '').trim();
}

function tou(key: unknown): Record<string, string> {
  const k = qingKey(key);
  return k ? { Authorization: 'Bearer ' + k } : {};
}

function httpUrl(u: unknown): string {
  const s = String(u || '').trim();
  return /^https?:\/\//i.test(s) ? s : '';
}

async function duJson(r: Response | { json?: () => Promise<unknown>; ok?: boolean; status?: number }): Promise<any> {
  try {
    return await (r as { json?: () => Promise<unknown> }).json?.();
  } catch {
    return null;
  }
}

async function duText(r: Response | { text?: () => Promise<string> }): Promise<string> {
  try {
    return String(await (r as { text?: () => Promise<string> }).text?.() || '');
  } catch {
    return '';
  }
}

function quRetryAfter(r: unknown): number {
  try {
    const v = (r as { headers?: { get?: (k: string) => string | null } })?.headers?.get?.('retry-after');
    if (!v) return 0;
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return Math.min(3600, Math.round(n));
    const ts = Date.parse(v);
    if (Number.isFinite(ts)) return Math.max(0, Math.min(3600, Math.round((ts - Date.now()) / 1000)));
  } catch { /* noop */ }
  return 0;
}

function shiBaiTiShi(status: number, retryAfterSec = 0): { error: string; hint?: string; rateLimited?: boolean; retryAfterSec?: number } {
  if (status === 429) {
    return {
      error: 'search-quota-exceeded',
      hint: '供应商返回 429（限流/额度/并发超限）' + (retryAfterSec > 0 ? `，建议等待 ${retryAfterSec} 秒` : '') + '。可以等待后重试、换一个已启用的搜索供应商，或停止本次搜索；不要凭记忆编造搜索结果。',
      rateLimited: true,
      retryAfterSec: retryAfterSec || undefined,
    };
  }
  if (status === 401 || status === 403) {
    return {
      error: 'search-auth-failed',
      hint: '供应商拒绝了这次请求（key 无效或无权限）。检查设置 → 功能 → 网络搜索里的 Key；不要凭记忆编造结果。',
    };
  }
  if (status >= 500) {
    return { error: 'search-provider-unavailable', hint: '搜索服务暂时不可用，稍后重试。不要凭记忆编造结果。' };
  }
  return { error: 'search-http-' + status, hint: '搜索服务返回了 HTTP ' + status + '，稍后重试。' };
}

/** 搜索：Firecrawl Keyless `/v2/search`（只回**真实返回**的条目，不做任何"补全"） */
export async function souSuo(
  key: string,
  query: string,
  opts: { count?: number; depth?: 'basic' | 'advanced'; topic?: 'general' | 'news'; days?: number } = {},
  fetchImpl: FetchImpl = fetch,
): Promise<YanJiuJieGuo> {
  const q = String(query || '').trim();
  if (!q) return { ok: false, items: [], error: 'empty-query' };
  const limit = Math.min(20, Math.max(1, Number(opts.count) || 8));
  try {
    const body: Record<string, unknown> = { query: q, limit };
    const days = Number(opts.days) || 0;
    if (days > 0) body.tbs = days <= 1 ? 'qdr:d' : days <= 7 ? 'qdr:w' : days <= 31 ? 'qdr:m' : 'qdr:y';
    const r = await fetchImpl(FIRECRAWL_SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...tou(key) },
      body: JSON.stringify(body),
    });
    const j = await duJson(r);
    if (!r.ok) {
      // 可选 key 失效不该把免注册用户挡在门外：401/403 回退一次 Keyless。
      if ((Number(r.status) === 401 || Number(r.status) === 403) && qingKey(key)) {
        const hui = await souSuo('', query, opts, fetchImpl);
        return { ...hui, hint: '已配置的 Firecrawl Key 无效，已回退免注册额度。' + (hui.hint ? ' ' + hui.hint : '') };
      }
      const t = shiBaiTiShi(Number(r.status), quRetryAfter(r));
      return { ok: false, items: [], ...t };
    }
    const arr: any[] = Array.isArray(j?.data?.web) ? j.data.web
      : Array.isArray(j?.data) ? j.data
        : Array.isArray(j?.results) ? j.results
          : [];
    const items = arr.map((x) => ({
      title: String(x?.title || x?.metadata?.title || '').trim(),
      url: httpUrl(x?.url || x?.metadata?.url),
      snippet: String(x?.description || x?.content || x?.markdown || x?.metadata?.description || '').replace(/\s+/g, ' ').slice(0, 900),
      score: typeof x?.score === 'number' ? x.score : undefined,
      via: 'firecrawl',
    })).filter((x) => x.url);
    return {
      ok: true,
      items,
      provider: qingKey(key) ? 'firecrawl-key' : YAN_JIU_GONG_YING_SHANG,
    };
  } catch (e) {
    return { ok: false, items: [], error: 'search-failed：' + String((e as Error)?.message || e) };
  }
}

/** 抓取单条：Firecrawl `/v2/scrape`（正文 markdown） */
export async function zhuaQuFirecrawl(url: string, key: string, fetchImpl: FetchImpl): Promise<{ ok: boolean; text: string; status: number; error?: string }> {
  try {
    const r = await fetchImpl(FIRECRAWL_SCRAPE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...tou(key) },
      body: JSON.stringify({ url, formats: ['markdown'] }),
    });
    const j = await duJson(r);
    if (!r.ok) return { ok: false, text: '', status: Number(r.status), error: (j?.error || '') + '' };
    const text = String(j?.data?.markdown || j?.data?.content || j?.markdown || '').trim();
    return { ok: !!text, text, status: Number(r.status), error: text ? undefined : 'empty' };
  } catch (e) {
    return { ok: false, text: '', status: 0, error: String((e as Error)?.message || e) };
  }
}

/** 抓取单条：Jina Reader（keyless；返回带标题头的 markdown，去掉头部只留正文） */
export async function zhuaQuJina(url: string, fetchImpl: FetchImpl): Promise<{ ok: boolean; text: string; status: number; error?: string }> {
  try {
    const r = await fetchImpl(JINA_READER_URL + url, {
      method: 'GET',
      headers: { Accept: 'text/plain' },
    });
    const raw = await duText(r);
    if (!r.ok) return { ok: false, text: '', status: Number(r.status), error: raw.slice(0, 160) };
    const cut = raw.indexOf('Markdown Content:');
    const text = (cut >= 0 ? raw.slice(cut + 'Markdown Content:'.length) : raw).trim();
    return { ok: !!text, text, status: Number(r.status), error: text ? undefined : 'empty' };
  } catch (e) {
    return { ok: false, text: '', status: 0, error: String((e as Error)?.message || e) };
  }
}

/** 抓取：Firecrawl Keyless 优先，Jina Reader 兜底（都不需要 key） */
export async function zhuaQuWenZhang(
  key: string,
  urls: string[],
  opts: { query?: string; depth?: 'basic' | 'advanced' } = {},
  fetchImpl: FetchImpl = fetch,
): Promise<{ ok: boolean; items: Array<{ url: string; text: string; via?: string }>; error?: string; hint?: string }> {
  const lie = (Array.isArray(urls) ? urls : []).map((u) => httpUrl(u)).filter(Boolean).slice(0, 5);
  if (!lie.length) return { ok: false, items: [], error: 'no-url', hint: '要抓取就给我 http/https 网址。' };
  const items: Array<{ url: string; text: string; via?: string }> = [];
  const shiBai: string[] = [];
  for (const url of lie) {
    const a = await zhuaQuFirecrawl(url, key, fetchImpl);
    if (a.ok) { items.push({ url, text: a.text, via: 'firecrawl' }); continue; }
    const b = await zhuaQuJina(url, fetchImpl);
    if (b.ok) { items.push({ url, text: b.text, via: 'jina-reader' }); continue; }
    shiBai.push(url);
  }
  return {
    ok: items.length > 0,
    items,
    error: items.length ? undefined : 'extract-empty',
    hint: shiBai.length ? `这几条抓不到：${shiBai.slice(0, 3).join(' ')}` : undefined,
  };
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
 * R128 N5：带**相关度自检**与「校验 → 重搜」协议 —— 结果不切题时模型要换词/换参数重搜，
 * 而不是拿垃圾结果硬凑结论。
 */
export function geShiYanJiu(jie: YanJiuJieGuo, opts: { kuan?: number; query?: string } = {}): string {
  if (!jie.ok) {
    return `[web_search] 失败：${jie.error}${jie.hint ? '\n提示：' + jie.hint : ''}\n（**不要凭记忆编造搜索结果**；换关键词或改参数重搜（最多 3 次），仍不行就如实告诉用户查不到。）`;
  }
  const kuan = opts.kuan || 220;
  const hang = jie.items.map((x, i) => `[${i + 1}] ${x.title}\n    ${x.url}\n    ${x.snippet.slice(0, kuan)}`);
  /** 相关度自检：查询词（英文按词、中文按字）在标题+摘要里的命中面 */
  const q = String(opts.query || '').toLowerCase();
  const yingCi: string[] = q.match(/[a-z0-9]{2,}/g) || [];
  const zhongZi: string[] = q.match(/[一-鿿]/g) || [];
  const ci = Array.from(new Set([...yingCi, ...zhongZi]));
  let qieTi = 0;
  if (ci.length && jie.items.length) {
    for (const x of jie.items) {
      const wen = (String(x.title || '') + ' ' + String(x.snippet || '')).toLowerCase();
      const fen = ci.filter((c) => wen.includes(c)).length / ci.length;
      if (fen >= 0.3) qieTi += 1;
    }
  }
  const xiangGuan = jie.items.length && ci.length ? Math.round((qieTi / jie.items.length) * 100) : null;
  const jingGao = xiangGuan !== null && xiangGuan < 50
    ? `\n⚠ 相关度自检：只有 ${qieTi}/${jie.items.length} 条看起来与查询词切题（${xiangGuan}%）。**先别下结论**：换关键词（换说法/加限定词）或改 topic/days 重搜。`
    : xiangGuan !== null
      ? `\n（相关度自检：${qieTi}/${jie.items.length} 条切题 ${xiangGuan}%）`
      : '';
  return `[web_search] 供应商=${jie.provider || YAN_JIU_GONG_YING_SHANG} 命中 ${jie.items.length} 条`
    + (jie.answer ? `\n（供应商直接答案，**引用前请自行核对**）${jie.answer.slice(0, 400)}` : '')
    + '\n' + hang.join('\n')
    + jingGao
    + '\n\n【结果校验与重搜协议】① 逐条核对是否切题、来源是否可信、时间是否够新；② 不切题/质量不高 ⇒ 换关键词或改 topic/days **重新搜索**（最多 3 次），必要时用 web_extract 抓原文核对；③ 仍不足就如实说查到什么、缺什么。\n写结论时**必须带上出处编号对应的 URL**；材料不足就直说不足，不要补全。';
}

/** 抓取结果 → 带 URL 的摘录文本 */
export function geShiZhaiLu(items: Array<{ url: string; text: string; via?: string }>, query: string): string {
  if (!items.length) return '[web_extract] 没有抓到正文（如实告诉用户，不要编造内容）。';
  return items.map((x, i) => {
    const zhai = zhaiLu(x.text, query);
    return `[${i + 1}] ${x.url}${x.via ? '（经 ' + x.via + '）' : ''}\n` + (zhai.length ? zhai.map((z) => '    · ' + z).join('\n') : '    （正文里没找到与查询相关的段落）');
  }).join('\n');
}
