#!/usr/bin/env node
/**
 * probe-research-pipeline.mjs —— **真机**验证调研管线（**探针，刻意不进 CI/门禁**）。
 *
 * 为什么是探针：它**联网**、且需要一个真实搜索密钥（本机从 MiMo/OpenClaw 配置里读，
 * **只读不打印**）。它的价值是一次性取证："搜索 → 抓取 → 摘录 → 带引用的结论"这条链
 * 在真实供应商上**真的走得通**，而不是只有单测里的假 fetch 走得通。
 *
 * 用法：node packages/app-shell/scripts/probe-research-pipeline.mjs ["查询词"]
 * 密钥来源（按序）：
 *   1. 环境变量 WARMY_SEARCH_KEY（推荐）
 *   2. 环境变量 WARMY_SEARCH_CFG 指向的 JSON 配置文件（tavily 插件配置）
 * **不写死任何本机路径** —— 写死就把用户目录结构带进仓库（`verify-security` 会拦）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(selfDir, '..');
const dist = path.join(pkgRoot, 'dist');
const { souSuo, zhuaQuWenZhang, geShiYanJiu, geShiZhaiLu } = await import(new URL('file://' + path.join(dist, 'research-tools.js')).href);

const Q = process.argv.slice(2).join(' ').trim() || 'Electron safeStorage encryptString 平台支持';

function zhaoKey() {
  const env = String(process.env.WARMY_SEARCH_KEY || '').trim();
  if (env) return { k: env, from: 'env' };
  const cfgLu = String(process.env.WARMY_SEARCH_CFG || '').trim();
  if (cfgLu && fs.existsSync(cfgLu)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(cfgLu, 'utf8'));
      const t = cfg?.plugins?.entries?.tavily?.config;
      const k = String(t?.webSearch?.apiKey || t?.apiKey || '').trim();
      if (k) return { k, from: 'WARMY_SEARCH_CFG' };
    } catch { /* 读不到就走"无密钥"路径 */ }
  }
  return { k: '', from: '' };
}

let ok = 0, bad = 0;
const t = (l, c, d) => { if (c) { ok++; console.log('  ok   ' + l); } else { bad++; console.log('  FAIL ' + l + (d !== undefined ? '  ' + String(JSON.stringify(d)).slice(0, 240) : '')); } };

const { k, from } = zhaoKey();
console.log('查询：' + Q);
console.log('密钥来源：' + (from || '（无）') + (k ? '（长度 ' + k.length + '，不打印）' : ''));

/* 0) 没密钥时必须是**如实失败**（这也是产品行为的一部分） */
if (!k) {
  const r = await souSuo('', Q);
  t('无密钥 ⇒ 如实失败并给可操作提示', !r.ok && r.error === 'no-search-key' && !!r.hint, r);
  console.log('\n探针结果：ok=' + ok + ' fail=' + bad + '（未配置密钥，只验证了如实失败路径）');
  process.exit(bad === 0 ? 0 : 1);
}

/* 1) 搜索 */
const r = await souSuo(k, Q, { count: 6 });
console.log('\n[1] 搜索 → ok=' + r.ok + ' 命中 ' + r.items.length + ' 条' + (r.error ? '（' + r.error + '）' : ''));
t('搜索成功且有结果', r.ok && r.items.length > 0, r.error);
t('每条都带 http(s) URL', r.items.every((x) => /^https?:\/\//i.test(x.url)));
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
    console.log('    正文字符数：' + chang.join(', '));
    t('正文不是空壳（>500 字符）', chang.some((n) => n > 500), chang);
    const wen = geShiZhaiLu(e.items, Q);
    t('摘录带 URL 与编号', /\[1\] https?:\/\//.test(wen), wen.slice(0, 120));
    console.log('  摘录片段：\n' + wen.split('\n').slice(0, 7).join('\n'));
  }
}

console.log('\n探针结果：ok=' + ok + ' fail=' + bad);
process.exit(bad === 0 ? 0 : 1);
