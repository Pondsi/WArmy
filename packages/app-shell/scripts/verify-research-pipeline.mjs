#!/usr/bin/env node
/**
 * verify-research-pipeline.mjs —— **调研管线**（硬门禁；纯 Node，**不联网**：注入假 fetch）。
 *
 * 第 123 轮口径：用户没有 Tavily 密钥。搜索与抓取必须**免注册可用**：
 *   · 搜索：Firecrawl Keyless（无 Authorization 头也能成功）；
 *   · 抓取：Firecrawl 优先，失败回退 Jina Reader；
 *   · Jina Search 无 key 会 401，**不作为搜索供应商**。
 * 同时钉死：没额度/出错要如实失败；每条结果都要有 URL；抓取要摘录；不许编造。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(selfDir, '..');
const dist = path.join(pkgRoot, 'dist');

let pass = 0, fail = 0;
const check = (l, ok, d) => {
  if (ok) { pass++; console.log('  ok   ' + l); }
  else { fail++; console.log('  FAIL ' + l + (d !== undefined ? '  ' + String(JSON.stringify(d)).slice(0, 320) : '')); }
};

const {
  souSuo, zhuaQuWenZhang, zhaiLu, geShiYanJiu, geShiZhaiLu,
  YAN_JIU_GONG_YING_SHANG, FIRECRAWL_SEARCH_URL, FIRECRAWL_SCRAPE_URL, JINA_READER_URL,
} = await import(new URL('file://' + path.join(dist, 'research-tools.js')).href);

console.log('=== 调研管线门禁（免注册搜索 / 抓取）===');

/** 假 fetch：按 URL 返回预设响应，并记录调用 */
function jiaFetch(hui) {
  const ji = [];
  const f = async (url, init) => {
    const u = String(url);
    const body = init && init.body ? JSON.parse(String(init.body)) : null;
    ji.push({ url: u, body, headers: (init && init.headers) || {}, method: (init && init.method) || 'GET' });
    const r = hui(u, init);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body,
      text: async () => (typeof r.text === 'string' ? r.text : JSON.stringify(r.body)),
    };
  };
  return { f, ji };
}

/* ── 1. 免注册：没有 key 也能搜索，且请求不带 Authorization ── */
console.log('\n[1] 免注册搜索');
{
  const { f, ji } = jiaFetch(() => ({
    status: 200,
    body: { success: true, data: { web: [
      { url: 'https://a.example/doc', title: 'A 文档', description: '向量数据库用于相似度检索。' },
      { url: 'https://b.example/doc', title: 'B 文档', description: 'ANN 索引是核心。' },
      { url: '', title: '没有链接的条目', description: '应被丢掉' },
    ] } },
  }));
  const r = await souSuo('', '向量数据库', { count: 5 }, f);
  check('无 key 搜索成功（免注册可用）', r.ok && r.items.length === 2, r);
  check('无 URL 的条目被丢掉', r.items.every((x) => /^https?:\/\//.test(x.url)), r.items.map((x) => x.url));
  check('供应商标为 firecrawl-keyless', r.provider === YAN_JIU_GONG_YING_SHANG, r.provider);
  check('请求打到 Firecrawl v2 search', ji[0].url === FIRECRAWL_SEARCH_URL, ji[0].url);
  check('请求体只有 query + limit（无 Tavily 字段）', ji[0].body.query === '向量数据库' && ji[0].body.limit === 5 && !('max_results' in ji[0].body), ji[0].body);
  check('无 key 时不带 Authorization 头', !ji[0].headers.Authorization, ji[0].headers);
}

/* ── 2. 可选 key 只用于提额，不是前提；格式正确 ── */
console.log('\n[2] 可选 key');
{
  const { f, ji } = jiaFetch(() => ({ status: 200, body: { data: { web: [{ url: 'https://a.example', title: 'A', description: 'x' }] } } }));
  const r = await souSuo('KEY', 'q', {}, f);
  check('可选 key 生效', r.ok && r.provider === 'firecrawl-key', r.provider);
  check('带 Bearer 头', String(ji[0].headers.Authorization) === 'Bearer KEY', ji[0].headers);
  const { f: f2, ji: ji2 } = jiaFetch((u, init) => (init && init.headers && init.headers.Authorization)
    ? { status: 401, body: { error: 'bad key' } }
    : { status: 200, body: { data: { web: [{ url: 'https://a.example', title: 'A', description: 'x' }] } } });
  const r2 = await souSuo('BAD', 'q', {}, f2);
  check('无效 key 自动回退 Keyless（不把用户挡在门外）', r2.ok && r2.provider === 'firecrawl-keyless' && /回退/.test(String(r2.hint)), r2);
  check('回退请求不带 Authorization', ji2.length === 2 && !ji2[1].headers.Authorization, ji2.map((x) => x.headers));
}

/* ── 3. 搜索失败路径：429 额度 / 5xx / 网络错误 都要如实且不编 ── */
console.log('\n[3] 搜索失败如实性');
{
  const { f } = jiaFetch(() => ({ status: 429, body: { error: 'quota' } }));
  const r = await souSuo('', 'q', {}, f);
  check('429 ⇒ ok:false 且条目为 0', !r.ok && r.items.length === 0, r);
  check('429 错误码是 search-quota-exceeded', r.error === 'search-quota-exceeded', r.error);
  check('429 提示等待 / 换供应商 / 停止', /等待/.test(String(r.hint)) && /换/.test(String(r.hint)) && /停止/.test(String(r.hint)), r.hint);
  const { f: f2 } = jiaFetch(() => ({ status: 503, body: {} }));
  const r2 = await souSuo('', 'q', {}, f2);
  check('5xx ⇒ 如实失败', !r2.ok && /unavailable|503/.test(String(r2.error)), r2.error);
  const f3 = async () => { throw new Error('network down'); };
  const r3 = await souSuo('', 'q', {}, f3);
  check('网络异常 ⇒ 如实失败（不吞成空结果）', !r3.ok && /network down/.test(String(r3.error)), r3.error);
  const { f: f4 } = jiaFetch(() => ({ status: 200, body: { data: { web: [] } } }));
  const r4 = await souSuo('', 'q', {}, f4);
  check('空结果仍是 ok:true（条目为 0，如实反映）', r4.ok && r4.items.length === 0, r4);
  check('空查询被拒', !(await souSuo('', '   ')).ok);
}

/* ── 4. 抓取：Firecrawl 优先，Jina Reader 兜底（都免注册） ── */
console.log('\n[4] 抓取与兜底');
{
  const zhengWen = '前言与主题无关的一段话，用来当噪声。ANN 索引让向量检索变快，这是第一处命中。'
    + '另一段完全无关的内容，也当噪声处理掉。向量数据库的相似度检索依赖距离度量，这是第二处命中。';
  const { f, ji } = jiaFetch((u) => u.includes('/scrape')
    ? { status: 200, body: { success: true, data: { markdown: zhengWen } } }
    : { status: 200, text: 'Title: x\n\nMarkdown Content:\n' + zhengWen });
  const r = await zhuaQuWenZhang('', ['https://a.example/doc'], { query: '向量 检索' }, f);
  check('无 key 抓取成功', r.ok && r.items.length === 1, r);
  check('优先走 Firecrawl scrape', r.items[0].via === 'firecrawl', r.items[0]);
  check('抓取正文是 markdown（不是 HTML 壳）', /ANN 索引/.test(r.items[0].text), r.items[0].text.slice(0, 80));
  const zhai = zhaiLu(zhengWen, '向量 检索');
  check('摘录命中相关段落（不是从头发一段）', zhai.length > 0 && zhai.every((z) => /向量|检索|ANN/.test(z)), zhai);
  check('摘录条数有上限（不把整页塞进去）', zhai.length <= 3, zhai.length);

  const { f: f2, ji: ji2 } = jiaFetch((u) => u.includes('/scrape')
    ? { status: 500, body: { error: 'down' } }
    : { status: 200, text: 'Title: x\n\nMarkdown Content:\n' + zhengWen });
  const r2 = await zhuaQuWenZhang('', ['https://a.example/doc'], {}, f2);
  check('Firecrawl 失败 ⇒ 自动回退 Jina Reader', r2.ok && r2.items[0].via === 'jina-reader', r2);
  check('Jina Reader 请求打到 r.jina.ai', ji2.some((x) => x.url.startsWith(JINA_READER_URL)), ji2.map((x) => x.url));
  check('Jina 头部（Title/Markdown Content）被剥掉', !/^Title:/.test(r2.items[0].text), r2.items[0].text.slice(0, 40));

  const { f: f3 } = jiaFetch(() => ({ status: 500, body: {} }));
  const r3 = await zhuaQuWenZhang('', ['https://a.example/doc'], {}, f3);
  check('两条腿都失败 ⇒ ok:false 且列出抓不到的 URL', !r3.ok && /a\.example/.test(String(r3.hint)), r3);
  const r4 = await zhuaQuWenZhang('', []);
  check('没给网址 ⇒ 如实拒绝并给提示', !r4.ok && r4.error === 'no-url' && !!r4.hint, r4);
  const { f: f5, ji: ji5 } = jiaFetch((u) => u.includes('/scrape')
    ? { status: 200, body: { data: { markdown: 'ok' } } }
    : { status: 200, text: 'ok' });
  await zhuaQuWenZhang('', ['file:///c:/x', 'javascript:alert(1)', 'https://ok.example'], {}, f5);
  check('只接受 http(s)（file:/javascript: 被丢弃）', ji5.length === 1 && ji5[0].body.url === 'https://ok.example', ji5.map((x) => x.body));
}

/* ── 5. 引用格式：每条都带 URL，结论要求出处 ── */
console.log('\n[5] 引用与格式化');
{
  const r = {
    ok: true, provider: 'firecrawl-keyless',
    items: [
      { title: 'A', url: 'https://a.example/doc', snippet: '向量数据库用于相似度检索。' },
      { title: 'B', url: 'https://b.example/doc', snippet: 'ANN 索引是核心。' },
    ],
  };
  const wen = geShiYanJiu(r);
  check('格式化里每条都有 [n] + URL', /\[1\]/.test(wen) && /https:\/\/a\.example\/doc/.test(wen) && /\[2\]/.test(wen));
  check('末尾要求带出处 URL / 材料不足就说不足', /出处/.test(wen) && /不要补全/.test(wen));
  const bai = geShiYanJiu({ ok: false, items: [], error: 'search-quota-exceeded' });
  check('失败路径不出现"命中 N 条"', !/命中 \d+ 条/.test(bai), bai);
  check('失败路径写明不要凭记忆编造', /不要凭记忆编造/.test(bai), bai);
  const zh = geShiZhaiLu([{ url: 'https://a.example/doc', text: 'ANN 索引让向量检索变快。', via: 'jina-reader' }], '向量');
  check('摘录文本带 URL 与来源', /\[1\] https:\/\/a\.example\/doc/.test(zh) && /jina-reader/.test(zh), zh.slice(0, 120));
}

/* ── 6. 接线：工具表 + 主进程 + 可选 key 不阻塞使用 ── */
console.log('\n[6] 接线');
{
  const wt = fs.readFileSync(path.join(pkgRoot, 'src', 'work-tools.ts'), 'utf8');
  const em = fs.readFileSync(path.join(pkgRoot, 'src', 'electron-main.ts'), 'utf8');
  const rt = fs.readFileSync(path.join(pkgRoot, 'src', 'research-tools.ts'), 'utf8');
  check('工具表含 web_search / web_extract', /'web_search'/.test(wt) && /'web_extract'/.test(wt));
  check('工具描述明确免注册/无需密钥', /免注册/.test(wt) && /不需要.*密钥/.test(wt));
  check('主进程有处理器且在同一分支', /gongJuMing === 'web_search' \|\| gongJuMing === 'web_extract'/.test(em));
  check('代码里不再出现 Tavily 作为供应商', !/api\.tavily\.com/.test(rt) && !/provider: 'tavily'/.test(em));
  check('搜索走 Firecrawl v2', /api\.firecrawl\.dev\/v2\/search/.test(rt));
  check('抓取回退 Jina Reader', /r\.jina\.ai/.test(rt) && /jina-reader/.test(rt));
  check('Jina Search 无 key 401 的事实写进注释', /Jina Search.*401|401.*Jina Search/s.test(rt));
  check('可选 key 仍只进 SecureKeyStore', /secureKeys\?\.load\(id\)/.test(em) && /secureKeys\.save\(id, k\)/.test(em) && /search:firecrawl/.test(em));
  check('状态接口说明 keyless 且 key 可选', /keyless: true/.test(em) && /optional: true/.test(em));
  check('失败都记审计（research.search / research.extract）', /research\.search/.test(em) && /research\.extract/.test(em));
}

console.log(`\n调研管线门禁: ${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
