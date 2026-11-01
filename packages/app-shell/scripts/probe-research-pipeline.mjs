#!/usr/bin/env node
/**
 * probe-research-pipeline.mjs —— **真机**验证调研管线（**探针，刻意不进 CI/门禁**）。
 *
 * 第 123 轮口径：普通用户没有 Tavily 密钥。默认走 **Firecrawl Keyless**（搜索 + 抓取）
 * 与 **Jina Reader**（抓取兜底），两者都不需要注册。可用 `WARMY_SEARCH_KEY` 提供
 * 可选的 Firecrawl Key 以提高额度（只读、不打印）。
 *
 * 用法：node packages/app-shell/scripts/probe-research-pipeline.mjs ["查询词"]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(selfDir, '..');
const dist = path.join(pkgRoot, 'dist');
const { souSuo, zhuaQuWenZhang, geShiYanJiu, geShiZhaiLu } = await import(new URL('file://' + path.join(dist, 'research-tools.js')).href);

const Q = process.argv.slice(2).join(' ').trim() || 'Electron safeStorage encryptString 平台支持';
const k = String(process.env.WARMY_SEARCH_KEY || '').trim();

let ok = 0, bad = 0;
const t = (l, c, d) => { if (c) { ok++; console.log('  ok   ' + l); } else { bad++; console.log('  FAIL ' + l + (d !== undefined ? '  ' + String(JSON.stringify(d)).slice(0, 240) : '')); } };

console.log('查询：' + Q);
console.log('搜索额度：' + (k ? '可选 Key（长度 ' + k.length + '，不打印）' : 'Firecrawl Keyless（免注册）'));

/* 1) 搜索 */
const r = await souSuo(k, Q, { count: 6 });
console.log('\n[1] 搜索 → ok=' + r.ok + ' 命中 ' + r.items.length + ' 条' + (r.error ? '（' + r.error + '）' : '') + ' 供应商=' + (r.provider || ''));
t('搜索成功且有结果', r.ok && r.items.length > 0, r);
t('每条都带 http(s) URL', r.items.every((x) => /^https?:\/\//i.test(x.url)), r.items.map((x) => x.url));
for (const x of r.items.slice(0, 5)) console.log('    · ' + x.title.slice(0, 70) + '\n      ' + x.url);
console.log('  格式化片段：\n' + geShiYanJiu(r).split('\n').slice(0, 8).join('\n'));

/* 2) 抓取前 2 条 + 摘录 */
const urls = r.items.slice(0, 2).map((x) => x.url);
if (urls.length) {
  const e = await zhuaQuWenZhang(k, urls, { query: Q });
  console.log('\n[2] 抓取 ' + urls.length + ' 条 → ok=' + e.ok + ' 拿到 ' + e.items.length + ' 篇正文');
  t('至少抓到一篇正文', e.ok && e.items.length > 0, e);
  if (e.ok) {
    const chang = e.items.map((x) => x.text.length);
    console.log('    正文字符数：' + chang.join(', ') + '  来源：' + e.items.map((x) => x.via || '?').join(', '));
    t('正文不是空壳（>500 字符）', chang.some((n) => n > 500), chang);
    const wen = geShiZhaiLu(e.items, Q);
    t('摘录带 URL 与编号', /\[1\] https?:\/\//.test(wen), wen.slice(0, 120));
    console.log('  摘录片段：\n' + wen.split('\n').slice(0, 7).join('\n'));
  }
}

console.log('\n探针结果：ok=' + ok + ' fail=' + bad);
process.exit(bad === 0 ? 0 : 1);
