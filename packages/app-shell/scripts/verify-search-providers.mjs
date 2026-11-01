#!/usr/bin/env node
/** verify-search-providers.mjs —— 联网搜索供应商编排（硬门禁；不联网，注入假 fetch）。 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const selfDir = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(selfDir, '..', 'dist');
const pkgRoot = path.resolve(selfDir, '..');
const { souSuoProviders, zhuaQuProviders } = await import(new URL('file://' + path.join(dist, 'search-providers.js')).href);
let pass = 0, fail = 0;
const check = (l, ok, d) => { if (ok) { pass++; console.log('  ok   ' + l); } else { fail++; console.log('  FAIL ' + l + (d !== undefined ? '  ' + JSON.stringify(d).slice(0, 260) : '')); } };

function fake(handler) {
  const calls = [];
  const f = async (url, init) => {
    const u = String(url); const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url: u, body, headers: init?.headers || {}, method: init?.method || 'GET' });
    const r = handler(u, init);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, headers: { get: (k) => String(k).toLowerCase() === 'retry-after' ? (r.retryAfter || null) : null }, json: async () => r.body, text: async () => r.text || JSON.stringify(r.body) };
  };
  return { f, calls };
}

console.log('=== 搜索供应商编排门禁 ===');
{
  const r = await souSuoProviders([], 'q');
  check('没有任何启用项 ⇒ 如实返回 search-disabled', !r.ok && r.error === 'search-disabled' && /设置/.test(String(r.hint)), r);
  const r2 = await souSuoProviders([{ id: 'j', name: 'Jina Reader', kind: 'jina-reader', enabled: true }], 'q');
  check('只启用 Jina Reader ⇒ 说明它只能抓取，不能搜索', !r2.ok && r2.error === 'search-disabled' && /只能抓取/.test(String(r2.hint)), r2);
}
{
  const { f, calls } = fake((u) => u.includes('/v2/search')
    ? { status: 200, body: { data: { web: [{ url: 'https://a.example', title: 'A', description: 'content' }] } } }
    : { status: 404, body: {} });
  const r = await souSuoProviders([{ id: 'firecrawl', name: 'Firecrawl Keyless', kind: 'firecrawl', enabled: true }], 'q', { count: 3 }, f);
  check('Firecrawl 供应商可用且映射 URL', r.ok && r.items[0]?.url === 'https://a.example', r);
  check('请求体 limit=count', calls[0].body.limit === 3, calls[0].body);
}
{
  const { f } = fake(() => ({ status: 200, body: { results: [{ title: 'T', url: 'https://t.example', content: 'snippet' }] } }));
  const no = await souSuoProviders([{ id: 'tavily', name: 'Tavily', kind: 'tavily', enabled: true }], 'q', {}, f);
  check('Tavily 缺 Key ⇒ missing-key（不冒充成功）', !no.ok && (no.attempts || []).some((x) => /missing-key/.test(String(x.error))), no);
  const { f: f2, calls } = fake(() => ({ status: 200, body: { results: [{ title: 'T', url: 'https://t.example', content: 'snippet' }] } }));
  const r = await souSuoProviders([{ id: 'tavily', name: 'Tavily', kind: 'tavily', enabled: true, key: 'K' }], 'q', { count: 4 }, f2);
  check('Tavily 有 Key 成功', r.ok && r.items[0].url === 'https://t.example', r);
  check('Tavily 请求体/鉴权正确', calls[0].body.max_results === 4 && String(calls[0].headers.Authorization) === 'Bearer K', calls[0]);
}
{
  const { f, calls } = fake(() => ({ status: 200, body: { results: [{ title: 'D', url: 'https://d.example', content: 'deepseek' }] } }));
  const r = await souSuoProviders([{ id: 'deepseek', name: 'DeepSeek Search', kind: 'deepseek', enabled: true, key: 'DK' }], 'q', { count: 2 }, f);
  check('DeepSeek 成功且请求到 /v1/tools/search', r.ok && calls[0].url === 'https://api.deepseek.com/v1/tools/search', calls[0]);
  check('DeepSeek 请求体 query/count', calls[0].body.query === 'q' && calls[0].body.count === 2, calls[0].body);
}
{
  const { f, calls } = fake(() => ({ status: 200, body: { items: [{ name: 'C', link: 'https://c.example', summary: 'custom' }] } }));
  const r = await souSuoProviders([{ id: 'custom:x', name: 'Custom', kind: 'custom', enabled: true, url: 'https://custom.example/search' }], 'q', { count: 1 }, f);
  check('自定义 POST 搜索成功（兼容 items/name/link/summary）', r.ok && r.items[0].url === 'https://c.example', r);
  check('自定义 POST 请求含 query/count', calls[0].method === 'POST' && calls[0].body.query === 'q', calls[0]);
  const { f: f2, calls: c2 } = fake(() => ({ status: 200, body: { results: [{ title: 'G', url: 'https://g.example' }] } }));
  const r2 = await souSuoProviders([{ id: 'custom:g', name: 'Get', kind: 'custom', enabled: true, url: 'https://custom.example/s?q={query}' }], 'a b', {}, f2);
  check('自定义 URL 含 {query} ⇒ GET 并编码', r2.ok && c2[0].method === 'GET' && /q=a%20b/.test(c2[0].url), c2);
}
{
  const { f } = fake((u) => u.includes('/v2/search') ? { status: 429, retryAfter: '7', body: {} } : { status: 200, body: { results: [{ title: 'B', url: 'https://b.example' }] } });
  const r = await souSuoProviders([
    { id: 'firecrawl', name: 'Firecrawl', kind: 'firecrawl', enabled: true },
    { id: 'tavily', name: 'Tavily', kind: 'tavily', enabled: true, key: 'K' },
  ], 'q', {}, f);
  check('第一个 429 ⇒ 自动尝试下一个供应商', r.ok && r.items[0].url === 'https://b.example' && (r.attempts || []).length === 1, r);
  const { f: f2 } = fake(() => ({ status: 429, retryAfter: '9', body: {} }));
  const r2 = await souSuoProviders([{ id: 'firecrawl', name: 'Firecrawl', kind: 'firecrawl', enabled: true }], 'q', {}, f2);
  check('全部 429 ⇒ rateLimited + 等待/换/停提示', !r2.ok && r2.rateLimited === true && /等待|换|停止/.test(String(r2.hint)), r2);
}
{
  const { f } = fake((u) => u.includes('/v2/scrape') ? { status: 200, body: { data: { markdown: '正文' } } } : { status: 200, text: 'Title: x\n\nMarkdown Content:\n正文' });
  const r = await zhuaQuProviders([{ id: 'firecrawl', name: 'Firecrawl', kind: 'firecrawl', enabled: true }], ['https://a.example'], f);
  check('抓取 Firecrawl 成功', r.ok && r.items[0].via === 'firecrawl', r);
  const r2 = await zhuaQuProviders([], ['https://a.example'], f);
  check('抓取没有任何启用项 ⇒ search-disabled', !r2.ok && r2.error === 'search-disabled', r2);
}
{
  const cw = fs.readFileSync(path.join(pkgRoot, 'src', 'cuowu-fenlei.ts'), 'utf8');
  const em = fs.readFileSync(path.join(pkgRoot, 'src', 'electron-main.ts'), 'utf8');
  check('模型 429 单独归类为 rate-limit', /code: 'rate-limit'/.test(cw) && /429/.test(cw));
  check('模型 429 给用户等待/换模型/停止提示', /供应商返回 429/.test(em) && /等待/.test(em) && /换一个模型/.test(em) && /停止本次任务/.test(em));
}
console.log(`\n搜索供应商编排门禁: ${pass}/${pass + fail} 通过`);
process.exit(fail ? 1 : 0);
