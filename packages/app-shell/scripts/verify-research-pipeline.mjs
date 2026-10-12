#!/usr/bin/env node
/**
 * verify-research-pipeline.mjs —— **调研管线**（硬门禁；纯 Node，**不联网**：注入假 fetch）。
 *
 * 为什么必须有它
 * ---------------------------------------------------------------------------
 * 真事故：模型要"查资料"，手里只有 `fetch_url` —— 得**先猜网址**；抓到整页 HTML 也不会摘录；
 * 最后给的"结论"**一条出处都没有**。这类失败在界面上看着很正常（有文字、有结论），
 * 所以只能靠门禁把三条硬口径钉死：
 *   ① 没密钥 ⇒ **如实失败**（并且给出可操作提示），**绝不返回看着像结果的假数据**；
 *   ② 有结果 ⇒ 每条都**带 URL**（编号可引用），摘要截断但不空；供应商直接答案要**标注"需自行核对"**；
 *   ③ 抓取 ⇒ 按查询词**摘录命中段落**（指得回原文），抓不到就如实说，不编内容。
 *
 * 门禁必须能失败：末节用"空结果/无 URL/无密钥"撞三处判定，任何一处抓不出来就判红。
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

const { souSuo, zhuaQuWenZhang, zhaiLu, geShiYanJiu, geShiZhaiLu } = await import(new URL('file://' + path.join(dist, 'research-tools.js')).href);

console.log('=== 调研管线门禁（硬门禁）===');

/** 假 fetch：按 URL 与 body 返回预设响应，并记录调用 */
function jiaFetch(hui) {
  const ji = [];
  const f = async (url, init) => {
    ji.push({ url: String(url), body: init && init.body ? JSON.parse(String(init.body)) : null, headers: (init && init.headers) || {} });
    const r = hui(String(url));
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body,
      text: async () => JSON.stringify(r.body),
    };
  };
  return { f, ji };
}

/* ── 1. 没密钥 ⇒ 如实失败（不编结果） ── */
console.log('\n[1] 没密钥的如实性');
{
  const a = await souSuo('', '什么是向量数据库');
  check('搜索无密钥 ⇒ ok:false', !a.ok, a);
  check('错误码是 no-search-key', a.error === 'no-search-key', a.error);
  check('给出可操作提示（去哪配）', /设置/.test(String(a.hint || '')) && /Tavily/.test(String(a.hint || '')), a.hint);
  check('无密钥时**不返回任何条目**（不许编）', Array.isArray(a.items) && a.items.length === 0);
  const b = await zhuaQuWenZhang('', ['https://example.com']);
  check('抓取无密钥 ⇒ 如实失败', !b.ok && b.error === 'no-search-key', b);
  const wen = geShiYanJiu(a);
  check('格式化文本里写明"不要凭记忆编造"', /不要凭记忆编造/.test(wen), wen.slice(0, 120));
  const c = await zhuaQuWenZhang('k', []);
  check('没给网址 ⇒ 如实拒绝并给提示', !c.ok && c.error === 'no-url' && !!c.hint, c);
}

/* ── 2. 搜索：条目必须带 URL、答案要标注需核对、请求体正确 ── */
console.log('\n[2] 搜索形状与引用');
{
  const { f, ji } = jiaFetch(() => ({
    status: 200,
    body: {
      answer: '向量数据库是……',
      results: [
        { title: 'A 文档', url: 'https://a.example/doc', content: '向量数据库用于相似度检索。', score: 0.9 },
        { title: 'B 文档', url: 'https://b.example/doc', content: 'ANN 索引是核心。', score: 0.8 },
        { title: '没有链接的条目', url: '', content: '应被丢掉' },
      ],
    },
  }));
  const r = await souSuo('KEY', '向量数据库', { count: 5, topic: 'news', days: 7 }, f);
  check('搜索成功', r.ok && r.items.length === 2, r.items.length);
  check('无 URL 的条目被丢掉（引用必须能点开）', r.items.every((x) => /^https?:\/\//.test(x.url)), r.items.map((x) => x.url));
  check('供应商与答案一并带回', r.provider === 'tavily' && r.answer === '向量数据库是……', { p: r.provider, a: r.answer });
  check('请求体：max_results 夹到 1..20', ji[0].body.max_results === 5, ji[0].body);
  check('请求体：topic/time_range 透传', ji[0].body.topic === 'news' && ji[0].body.time_range === '7d', ji[0].body);
  check('鉴权头是 Bearer', String(ji[0].headers.Authorization) === 'Bearer KEY', ji[0].headers);
  const wen = geShiYanJiu(r);
  check('格式化里每条都有 [n] + URL', /\[1\]/.test(wen) && /https:\/\/a\.example\/doc/.test(wen) && /\[2\]/.test(wen));
  check('供应商直接答案标注"引用前请自行核对"', /引用前请自行核对|需自行核对/.test(wen), wen.slice(0, 160));
  check('末尾要求"带出处 URL / 材料不足就说不足"', /出处/.test(wen) && /不要补全/.test(wen));
}

/* ── 3. 抓取 + 摘录：按查询词命中，能指回原文 ── */
console.log('\n[3] 抓取与摘录');
{
  const zhengWen = '前言与主题无关的一段话，用来当噪声。ANN 索引让向量检索变快，这是第一处命中。'
    + '另一段完全无关的内容，也当噪声处理掉。向量数据库的相似度检索依赖距离度量，这是第二处命中。';
  const { f, ji } = jiaFetch(() => ({ status: 200, body: { results: [{ url: 'https://a.example/doc', raw_content: zhengWen }] } }));
  const r = await zhuaQuWenZhang('KEY', ['https://a.example/doc'], { query: '向量 检索' }, f);
  check('抓取成功', r.ok && r.items.length === 1, r);
  check('请求体带 urls 与 extract_depth', Array.isArray(ji[0].body.urls) && ji[0].body.extract_depth === 'advanced', ji[0].body);
  const zhai = zhaiLu(zhengWen, '向量 检索');
  check('摘录命中相关段落（不是从头发一段）', zhai.length > 0 && zhai.every((z) => /向量|检索|ANN/.test(z)), zhai);
  check('摘录条数有上限（不把整页塞进去）', zhai.length <= 3, zhai.length);
  const wen = geShiZhaiLu(r.items, '向量 检索');
  check('摘录文本带 URL 与条目编号', /\[1\] https:\/\/a\.example\/doc/.test(wen), wen.slice(0, 120));
  // 非 http 的 URL 必须被过滤
  const r2 = await zhuaQuWenZhang('KEY', ['file:///c:/x', 'javascript:alert(1)', 'https://ok.example'], {}, f);
  check('只接受 http(s)（file:/javascript: 被丢弃）', ji[1].body.urls.length === 1 && ji[1].body.urls[0] === 'https://ok.example', ji[1].body.urls);
  void r2;
}

/* ── 4. 失败路径：HTTP 错 / 抛错 / 空结果 都要如实 ── */
console.log('\n[4] 失败路径的如实性');
{
  const { f } = jiaFetch(() => ({ status: 432, body: { detail: { error: 'rate limited' } } }));
  const r = await souSuo('KEY', 'q', {}, f);
  check('搜索 HTTP 错 ⇒ ok:false 且带状态码', !r.ok && /432/.test(String(r.error)), r.error);
  check('供应商的错误细节被带出（可诊断）', /rate limited/.test(String(r.hint || '')), r.hint);
  const { f: f2 } = jiaFetch(() => ({ status: 200, body: { results: [] } }));
  const r2 = await souSuo('KEY', 'q', {}, f2);
  check('空结果仍是 ok:true（但条目为 0，如实反映）', r2.ok && r2.items.length === 0, r2);
  const f3 = async () => { throw new Error('network down'); };
  const r3 = await souSuo('KEY', 'q', {}, f3);
  check('抛错 ⇒ 如实失败（不吞成空结果）', !r3.ok && /network down/.test(String(r3.error)), r3.error);
  const { f: f4 } = jiaFetch(() => ({ status: 200, body: { failed_results: [{ url: 'https://x.example' }] } }));
  const r4 = await zhuaQuWenZhang('KEY', ['https://x.example'], {}, f4);
  check('抓取全失败 ⇒ ok:false 且提示哪几条抓不到', !r4.ok && /x\.example/.test(String(r4.hint || '')), r4);
}

/* ── 5. 接线：工具表 + 主进程 + 密钥只进 safeStorage ── */
console.log('\n[5] 接线');
{
  const wt = fs.readFileSync(path.join(pkgRoot, 'src', 'work-tools.ts'), 'utf8');
  const em = fs.readFileSync(path.join(pkgRoot, 'src', 'electron-main.ts'), 'utf8');
  const pl = fs.readFileSync(path.join(pkgRoot, 'src', 'preload.cjs'), 'utf8');
  check('工具表含 web_search / web_extract', /'web_search'/.test(wt) && /'web_extract'/.test(wt));
  check('暴露了工具规格（模型能看到）', /name: 'web_search'/.test(wt) && /name: 'web_extract'/.test(wt));
  check('主进程有处理器且在**同一分支**里（web_search|web_extract）', /gongJuMing === 'web_search' \|\| gongJuMing === 'web_extract'/.test(em));
  check('密钥只从 SecureKeyStore 取', /secureKeys\?\.load\('search'\)/.test(em));
  check('密钥写入走 safeStorage（不是明文 settings）', /secureKeys\.save\('search'/.test(em) && !/settings.*searchApiKey/.test(em));
  check('状态查询只回"有没有"', /souSuoMiYaoZhuangTai/.test(em) && /has: !!k/.test(em));
  check('preload 暴露三个密钥接口', /searchKeySet/.test(pl) && /searchKeyStatus/.test(pl) && /searchKeyClear/.test(pl));
  check('失败都记审计（research.search / research.extract）', /research\.search/.test(em) && /research\.extract/.test(em));
}

/* ── 6. 自证 ── */
console.log('\n[6] 自证（门禁必须能失败）');
{
  check('自证：空查询必须被拒（不能拿空串去搜）', !(await souSuo('KEY', '   ')).ok);
  check('自证：无 URL 条目若被留下，则"引用可点开"这条失效', (await souSuo('KEY', 'q', {}, jiaFetch(() => ({ status: 200, body: { results: [{ title: 'x', url: '', content: 'y' }] } })).f)).items.length === 0);
  const zhai = zhaiLu('完全无关的一句话，一个字都不沾边。', '量子计算');
  check('自证：无命中时摘录不得伪造命中（回退到前几段且不为空）', zhai.length > 0 && !/量子计算/.test(zhai.join('')), zhai);
  check('自证：格式化失败路径不得出现"结果"字样',
    !/命中 \d+ 条/.test(geShiYanJiu({ ok: false, items: [], error: 'no-search-key' })));
}

console.log(`\n调研管线门禁: ${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
