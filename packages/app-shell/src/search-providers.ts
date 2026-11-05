/**
 * search-providers —— 联网搜索的**供应商编排**（设置 → 功能 → 网络搜索）。
 *
 * 用户口径（第 123 轮追加）：
 *   · 内置 Firecrawl Keyless / Jina Reader / Tavily / DeepSeek 搜索 + 自定义项；
 *   · **默认全部关闭**；至少启用一个搜索供应商后，模型才能联网搜索；
 *   · 429 要如实说明（等待 / 换供应商 / 停止），不许编结果；
 *   · Jina Reader 只能抓取，不能搜索 —— UI 与结果里都要说清楚。
 *
 * 本模块是纯函数 + 注入 fetch；密钥由主进程从 SecureKeyStore 取，不在这里落盘。
 */

import { souSuo, zhuaQuFirecrawl, zhuaQuJina, type YanJiuJieGuo } from './research-tools.js';

export type SousuoGongYingLeiXing = 'firecrawl' | 'jina-reader' | 'tavily' | 'deepseek' | 'exa' | 'serper' | 'brave' | 'bocha' | 'custom';

export interface SousuoGongYingPeiZhi {
  id: string;
  name: string;
  kind: SousuoGongYingLeiXing;
  enabled: boolean;
  /** custom 的端点；内置项留空 */
  url?: string;
  /** 密钥只在主进程内存里传入，不写日志、不回渲染层 */
  key?: string;
}

export interface SousuoChangShi {
  provider: string;
  error?: string;
  status?: number;
  retryAfterSec?: number;
}

type FetchImpl = typeof fetch;

function clampCount(n: unknown): number {
  return Math.min(20, Math.max(1, Number(n) || 8));
}

function httpUrl(u: unknown): string {
  const s = String(u || '').trim();
  return /^https?:\/\//i.test(s) ? s : '';
}

async function duJson(r: Response | { json?: () => Promise<unknown> }): Promise<any> {
  try { return await (r as { json?: () => Promise<unknown> }).json?.(); } catch { return null; }
}

async function duText(r: Response | { text?: () => Promise<string> }): Promise<string> {
  try { return String(await (r as { text?: () => Promise<string> }).text?.() || ''); } catch { return ''; }
}

function retryAfter(r: unknown): number {
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

function shiBai(provider: string, status: number, r: unknown, detail?: string): YanJiuJieGuo {
  const ra = retryAfter(r);
  if (status === 429) {
    return {
      ok: false, items: [], provider,
      error: 'search-rate-limited', rateLimited: true, retryAfterSec: ra || undefined,
      hint: `${provider} 返回 429（限流/额度/并发超限）` + (ra > 0 ? `，建议等待 ${ra} 秒` : '')
        + '。请让用户选择：等待后重试 / 换一个已启用的搜索供应商 / 停止本次搜索；不要凭记忆编造结果。',
    };
  }
  if (status === 401 || status === 403) {
    return { ok: false, items: [], provider, error: 'search-auth-failed', hint: `${provider} 拒绝请求（Key 无效或无权限）。检查设置 → 功能 → 网络搜索。` };
  }
  if (status >= 500) {
    return { ok: false, items: [], provider, error: 'search-provider-unavailable', hint: `${provider} 暂时不可用（HTTP ${status}），稍后重试。` };
  }
  return { ok: false, items: [], provider, error: `search-http-${status}`, hint: (detail || `${provider} 返回 HTTP ${status}`).slice(0, 200) };
}

function itemsFrom(j: any): Array<{ title: string; url: string; snippet: string; score?: number; via?: string }> {
  const arr: any[] = Array.isArray(j?.results) ? j.results
    : Array.isArray(j?.data?.results) ? j.data.results
      : Array.isArray(j?.data?.web) ? j.data.web
        : Array.isArray(j?.data) ? j.data
          : Array.isArray(j?.web) ? j.web
            : Array.isArray(j?.items) ? j.items
              : [];
  return arr.map((x) => ({
    title: String(x?.title || x?.name || '').trim(),
    url: httpUrl(x?.url || x?.link),
    snippet: String(x?.content || x?.snippet || x?.description || x?.summary || x?.text || '').replace(/\s+/g, ' ').slice(0, 900),
    score: typeof x?.score === 'number' ? x.score : undefined,
  })).filter((x) => x.url);
}

/** Tavily 搜索（需要 key） */
export async function souSuoTavily(cfg: SousuoGongYingPeiZhi, query: string, opts: { count?: number } = {}, fetchImpl: FetchImpl = fetch): Promise<YanJiuJieGuo> {
  const q = String(query || '').trim();
  if (!q) return { ok: false, items: [], error: 'empty-query' };
  if (!String(cfg.key || '').trim()) return { ok: false, items: [], provider: cfg.name, error: 'missing-key', hint: 'Tavily 需要 API Key：设置 → 功能 → 网络搜索。' };
  try {
    const r = await fetchImpl('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + String(cfg.key) },
      body: JSON.stringify({ query: q, max_results: clampCount(opts.count), include_answer: true, search_depth: 'advanced' }),
    });
    const j = await duJson(r);
    if (!r.ok) return shiBai(cfg.name, Number(r.status), r, String(j?.detail?.error || j?.error || ''));
    return { ok: true, items: itemsFrom(j), provider: cfg.name, answer: j?.answer ? String(j.answer) : undefined };
  } catch (e) {
    return { ok: false, items: [], provider: cfg.name, error: 'search-failed: ' + String((e as Error)?.message || e) };
  }
}

/** DeepSeek 搜索（官方：POST /v1/tools/search，body {query,count}） */
export async function souSuoDeepSeek(cfg: SousuoGongYingPeiZhi, query: string, opts: { count?: number } = {}, fetchImpl: FetchImpl = fetch): Promise<YanJiuJieGuo> {
  const q = String(query || '').trim();
  if (!q) return { ok: false, items: [], error: 'empty-query' };
  if (!String(cfg.key || '').trim()) return { ok: false, items: [], provider: cfg.name, error: 'missing-key', hint: 'DeepSeek 搜索需要 API Key：设置 → 功能 → 网络搜索。' };
  try {
    const r = await fetchImpl('https://api.deepseek.com/v1/tools/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + String(cfg.key) },
      body: JSON.stringify({ query: q, count: clampCount(opts.count) }),
    });
    const j = await duJson(r);
    if (!r.ok) return shiBai(cfg.name, Number(r.status), r, String(j?.error?.message || j?.error || ''));
    return { ok: true, items: itemsFrom(j), provider: cfg.name };
  } catch (e) {
    return { ok: false, items: [], provider: cfg.name, error: 'search-failed: ' + String((e as Error)?.message || e) };
  }
}

/** 自定义搜索：URL 可含 {query}（GET），否则 POST {query,count}；兼容常见响应形状 */
export async function souSuoCustom(cfg: SousuoGongYingPeiZhi, query: string, opts: { count?: number } = {}, fetchImpl: FetchImpl = fetch): Promise<YanJiuJieGuo> {
  const q = String(query || '').trim();
  const url0 = httpUrl(cfg.url);
  if (!q) return { ok: false, items: [], error: 'empty-query' };
  if (!url0) return { ok: false, items: [], provider: cfg.name, error: 'bad-url', hint: '自定义搜索需要 http/https 端点。' };
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (String(cfg.key || '').trim()) headers.Authorization = 'Bearer ' + String(cfg.key);
  try {
    let r: Response;
    if (url0.includes('{query}')) {
      r = await fetchImpl(url0.replace(/\{query\}/g, encodeURIComponent(q)), { method: 'GET', headers });
    } else {
      headers['Content-Type'] = 'application/json';
      r = await fetchImpl(url0, { method: 'POST', headers, body: JSON.stringify({ query: q, count: clampCount(opts.count) }) });
    }
    const j = await duJson(r);
    if (!r.ok) return shiBai(cfg.name, Number(r.status), r, String(j?.error || ''));
    return { ok: true, items: itemsFrom(j), provider: cfg.name };
  } catch (e) {
    return { ok: false, items: [], provider: cfg.name, error: 'search-failed: ' + String((e as Error)?.message || e) };
  }
}

/** Exa 搜索（POST /search，x-api-key；响应 results[].title/url/highlights） */
export async function souSuoExa(cfg: SousuoGongYingPeiZhi, query: string, opts: { count?: number } = {}, fetchImpl: FetchImpl = fetch): Promise<YanJiuJieGuo> {
  const q = String(query || '').trim();
  if (!q) return { ok: false, items: [], error: 'empty-query' };
  if (!String(cfg.key || '').trim()) return { ok: false, items: [], provider: cfg.name, error: 'missing-key', hint: 'Exa 需要 API Key：设置 → 功能 → 网络搜索。' };
  try {
    const r = await fetchImpl('https://api.exa.ai/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': String(cfg.key) },
      body: JSON.stringify({ query: q, numResults: clampCount(opts.count), type: 'auto', contents: { highlights: true } }),
    });
    const j = await duJson(r);
    if (!r.ok) return shiBai(cfg.name, Number(r.status), r, String(j?.error || ''));
    const arr: any[] = Array.isArray(j?.results) ? j.results : [];
    const items = arr.map((x) => ({
      title: String(x?.title || '').trim(),
      url: httpUrl(x?.url),
      snippet: String((Array.isArray(x?.highlights) ? x.highlights : []).join(' ') || x?.text || '').replace(/\s+/g, ' ').slice(0, 900),
    })).filter((x) => x.url);
    return { ok: items.length > 0, items, provider: cfg.name };
  } catch (e) {
    return { ok: false, items: [], provider: cfg.name, error: 'search-failed: ' + String((e as Error)?.message || e) };
  }
}

/** Serper（Google SERP：POST google.serper.dev/search，X-API-KEY；响应 organic[].title/link/snippet） */
export async function souSuoSerper(cfg: SousuoGongYingPeiZhi, query: string, opts: { count?: number } = {}, fetchImpl: FetchImpl = fetch): Promise<YanJiuJieGuo> {
  const q = String(query || '').trim();
  if (!q) return { ok: false, items: [], error: 'empty-query' };
  if (!String(cfg.key || '').trim()) return { ok: false, items: [], provider: cfg.name, error: 'missing-key', hint: 'Serper 需要 API Key：设置 → 功能 → 网络搜索。' };
  try {
    const r = await fetchImpl('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': String(cfg.key) },
      body: JSON.stringify({ q, num: clampCount(opts.count) }),
    });
    const j = await duJson(r);
    if (!r.ok) return shiBai(cfg.name, Number(r.status), r, String(j?.error || ''));
    const arr: any[] = Array.isArray(j?.organic) ? j.organic : [];
    const items = arr.map((x) => ({
      title: String(x?.title || '').trim(),
      url: httpUrl(x?.link || x?.url),
      snippet: String(x?.snippet || '').replace(/\s+/g, ' ').slice(0, 900),
    })).filter((x) => x.url);
    return { ok: items.length > 0, items, provider: cfg.name, answer: j?.answerBox?.answer ? String(j.answerBox.answer) : undefined };
  } catch (e) {
    return { ok: false, items: [], provider: cfg.name, error: 'search-failed: ' + String((e as Error)?.message || e) };
  }
}

/** Brave Search（GET api.search.brave.com/res/v1/web/search，X-Subscription-Token；响应 web.results[].title/url/description） */
export async function souSuoBrave(cfg: SousuoGongYingPeiZhi, query: string, opts: { count?: number } = {}, fetchImpl: FetchImpl = fetch): Promise<YanJiuJieGuo> {
  const q = String(query || '').trim();
  if (!q) return { ok: false, items: [], error: 'empty-query' };
  if (!String(cfg.key || '').trim()) return { ok: false, items: [], provider: cfg.name, error: 'missing-key', hint: 'Brave Search 需要 API Key：设置 → 功能 → 网络搜索。' };
  try {
    const r = await fetchImpl('https://api.search.brave.com/res/v1/web/search?q=' + encodeURIComponent(q) + '&count=' + clampCount(opts.count), {
      method: 'GET',
      headers: { Accept: 'application/json', 'X-Subscription-Token': String(cfg.key) },
    });
    const j = await duJson(r);
    if (!r.ok) return shiBai(cfg.name, Number(r.status), r, String(j?.error?.message || j?.error || ''));
    const arr: any[] = Array.isArray(j?.web?.results) ? j.web.results : [];
    const items = arr.map((x) => ({
      title: String(x?.title || '').trim(),
      url: httpUrl(x?.url),
      snippet: String(x?.description || '').replace(/\s+/g, ' ').slice(0, 900),
    })).filter((x) => x.url);
    return { ok: items.length > 0, items, provider: cfg.name };
  } catch (e) {
    return { ok: false, items: [], provider: cfg.name, error: 'search-failed: ' + String((e as Error)?.message || e) };
  }
}

/** 博查 Bocha（POST api.bochaai.com/v1/web-search，Bearer；响应 data.webPages.value[].name/url/snippet） */
export async function souSuoBocha(cfg: SousuoGongYingPeiZhi, query: string, opts: { count?: number } = {}, fetchImpl: FetchImpl = fetch): Promise<YanJiuJieGuo> {
  const q = String(query || '').trim();
  if (!q) return { ok: false, items: [], error: 'empty-query' };
  if (!String(cfg.key || '').trim()) return { ok: false, items: [], provider: cfg.name, error: 'missing-key', hint: '博查需要 API Key：设置 → 功能 → 网络搜索。' };
  try {
    const r = await fetchImpl('https://api.bochaai.com/v1/web-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + String(cfg.key) },
      body: JSON.stringify({ query: q, freshness: 'noLimit', count: clampCount(opts.count) }),
    });
    const j = await duJson(r);
    if (!r.ok) return shiBai(cfg.name, Number(r.status), r, String(j?.message || j?.error || ''));
    const arr: any[] = Array.isArray(j?.data?.webPages?.value) ? j.data.webPages.value
      : Array.isArray(j?.data?.webPages) ? j.data.webPages : [];
    const items = arr.map((x) => ({
      title: String(x?.name || '').trim(),
      url: httpUrl(x?.url),
      snippet: String(x?.snippet || x?.summary || '').replace(/\s+/g, ' ').slice(0, 900),
    })).filter((x) => x.url);
    return { ok: items.length > 0, items, provider: cfg.name };
  } catch (e) {
    return { ok: false, items: [], provider: cfg.name, error: 'search-failed: ' + String((e as Error)?.message || e) };
  }
}

/**
 * 按设置里的顺序尝试所有**已启用**的搜索供应商。
 * Jina Reader 不是搜索供应商：只记录一条说明，不参与搜索。
 */
export async function souSuoProviders(
  configs: SousuoGongYingPeiZhi[],
  query: string,
  opts: { count?: number; depth?: 'basic' | 'advanced'; topic?: 'general' | 'news'; days?: number } = {},
  fetchImpl: FetchImpl = fetch,
): Promise<YanJiuJieGuo> {
  const q = String(query || '').trim();
  if (!q) return { ok: false, items: [], error: 'empty-query' };
  const enabled = (Array.isArray(configs) ? configs : []).filter((c) => c && c.enabled);
  const searchable = enabled.filter((c) => c.kind !== 'jina-reader');
  const jinaOnly = enabled.some((c) => c.kind === 'jina-reader');
  if (!searchable.length) {
    return {
      ok: false, items: [], error: 'search-disabled',
      hint: jinaOnly
        ? '当前只启用了 Jina Reader，它只能抓取网页、不能搜索。请在设置 → 功能 → 网络搜索里启用 Firecrawl / Tavily / DeepSeek 或自定义搜索。'
        : '联网搜索尚未启用：设置 → 功能 → 网络搜索，至少启用一个搜索供应商。',
    };
  }
  const attempts: SousuoChangShi[] = [];
  let lastEmpty: YanJiuJieGuo | null = null;
  let rateLimited = false;
  let retryAfterSec = 0;
  for (const cfg of searchable) {
    let r: YanJiuJieGuo;
    if (cfg.kind === 'firecrawl') r = await souSuo(cfg.key || '', q, opts, fetchImpl);
    else if (cfg.kind === 'tavily') r = await souSuoTavily(cfg, q, opts, fetchImpl);
    else if (cfg.kind === 'deepseek') r = await souSuoDeepSeek(cfg, q, opts, fetchImpl);
    else if (cfg.kind === 'exa') r = await souSuoExa(cfg, q, opts, fetchImpl);
    else if (cfg.kind === 'serper') r = await souSuoSerper(cfg, q, opts, fetchImpl);
    else if (cfg.kind === 'brave') r = await souSuoBrave(cfg, q, opts, fetchImpl);
    else if (cfg.kind === 'bocha') r = await souSuoBocha(cfg, q, opts, fetchImpl);
    else if (cfg.kind === 'custom') r = await souSuoCustom(cfg, q, opts, fetchImpl);
    else continue;
    if (r.ok) {
      if (r.items.length === 0) { lastEmpty = { ...r, provider: cfg.name, attempts }; continue; }
      return { ...r, provider: cfg.name, attempts };
    }
    attempts.push({ provider: cfg.name, error: r.error, retryAfterSec: r.retryAfterSec });
    if (r.rateLimited) { rateLimited = true; retryAfterSec = Math.max(retryAfterSec, Number(r.retryAfterSec) || 0); }
  }
  if (lastEmpty) return { ...lastEmpty, attempts };
  return {
    ok: false, items: [], error: 'all-search-providers-failed', attempts,
    rateLimited, retryAfterSec: retryAfterSec || undefined,
    hint: (rateLimited
      ? '所有已启用的搜索供应商都限流/额度不足' + (retryAfterSec > 0 ? `（建议等待 ${retryAfterSec} 秒）` : '')
      : '所有已启用的搜索供应商都失败了')
      + '。请让用户选择：等待后重试 / 换一个供应商 / 停止；不要凭记忆编造结果。'
      + (attempts.length ? '\n' + attempts.map((x) => `· ${x.provider}: ${x.error || 'unknown'}`).join('\n') : ''),
  };
}

/** Tavily 抓取（需要 key） */
export async function zhuaQuTavily(cfg: SousuoGongYingPeiZhi, urls: string[], fetchImpl: FetchImpl = fetch): Promise<{ ok: boolean; items: Array<{ url: string; text: string; via?: string }>; error?: string; hint?: string }> {
  const lie = (Array.isArray(urls) ? urls : []).map(httpUrl).filter(Boolean).slice(0, 5);
  if (!lie.length) return { ok: false, items: [], error: 'no-url' };
  if (!String(cfg.key || '').trim()) return { ok: false, items: [], error: 'missing-key', hint: 'Tavily 抓取需要 API Key。' };
  try {
    const r = await fetchImpl('https://api.tavily.com/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + String(cfg.key) },
      body: JSON.stringify({ urls: lie, extract_depth: 'advanced' }),
    });
    const j = await duJson(r);
    if (!r.ok) return { ok: false, items: [], error: 'extract-http-' + r.status };
    const items = (j?.results || []).map((x: any) => ({ url: String(x.url || ''), text: String(x.raw_content || '') })).filter((x: any) => x.url && x.text);
    return { ok: items.length > 0, items, error: items.length ? undefined : 'extract-empty' };
  } catch (e) {
    return { ok: false, items: [], error: 'extract-failed: ' + String((e as Error)?.message || e) };
  }
}

/** 按已启用供应商抓正文：Firecrawl / Tavily / Jina Reader；没有任何启用项就如实失败 */
export async function zhuaQuProviders(
  configs: SousuoGongYingPeiZhi[],
  urls: string[],
  fetchImpl: FetchImpl = fetch,
): Promise<{ ok: boolean; items: Array<{ url: string; text: string; via?: string }>; error?: string; hint?: string }> {
  const lie = (Array.isArray(urls) ? urls : []).map(httpUrl).filter(Boolean).slice(0, 5);
  if (!lie.length) return { ok: false, items: [], error: 'no-url', hint: '要抓取就给我 http/https 网址。' };
  const enabled = (Array.isArray(configs) ? configs : []).filter((c) => c && c.enabled);
  const extractors = enabled.filter((c) => c.kind === 'firecrawl' || c.kind === 'tavily' || c.kind === 'jina-reader');
  if (!extractors.length) return { ok: false, items: [], error: 'search-disabled', hint: '抓取尚未启用：设置 → 功能 → 网络搜索，至少启用 Firecrawl / Tavily / Jina Reader。' };
  const items: Array<{ url: string; text: string; via?: string }> = [];
  const failed: string[] = [];
  for (const cfg of extractors) {
    if (items.length >= lie.length) break;
    if (cfg.kind === 'firecrawl') {
      for (const u of lie) {
        if (items.some((x) => x.url === u)) continue;
        const r = await zhuaQuFirecrawl(u, cfg.key || '', fetchImpl);
        if (r.ok) items.push({ url: u, text: r.text, via: 'firecrawl' }); else failed.push(u);
      }
    } else if (cfg.kind === 'tavily') {
      const rest = lie.filter((u) => !items.some((x) => x.url === u));
      const r = await zhuaQuTavily(cfg, rest, fetchImpl);
      if (r.ok) items.push(...r.items.map((x) => ({ ...x, via: 'tavily' })));
    } else if (cfg.kind === 'jina-reader') {
      for (const u of lie) {
        if (items.some((x) => x.url === u)) continue;
        const r = await zhuaQuJina(u, fetchImpl);
        if (r.ok) items.push({ url: u, text: r.text, via: 'jina-reader' });
      }
    }
  }
  return {
    ok: items.length > 0,
    items,
    error: items.length ? undefined : 'extract-empty',
    hint: items.length ? undefined : `抓不到：${failed.slice(0, 3).join(' ') || lie.slice(0, 3).join(' ')}`,
  };
}
