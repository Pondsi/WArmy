#!/usr/bin/env node
/**
 * verify-model-pick —— 「智能选模型」决策器验证（**真跑**纯函数，不只看代码）。
 *
 * 背景：此前「智能」是空壳（`pickModelForUrgency` 从未被调用，实际永远用当前供应商模型）。
 * 本脚本断言决策顺序：显式 > 牛马默认 > 调用链+紧急度 > 角色表 > 兜底，
 * 以及**绝不选中被禁用的模型**、任何输入不抛错。
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, '..', 'dist', 'model-pick.js');
if (!fs.existsSync(dist)) {
  console.error('缺少构建产物，请先 build：' + dist);
  process.exit(2);
}
const M = await import(pathToFileURL(dist).href);

let pass = 0, fail = 0;
const failures = [];
function check(l, c, d) {
  const s = d === undefined ? '' : ` => ${typeof d === 'string' ? d : JSON.stringify(d)}`;
  if (c) { pass++; console.log(`  [PASS] ${l}${s}`); }
  else { fail++; failures.push(l); console.log(`  [FAIL] ${l}${s}`); }
}

const CHAIN = ['deepseek-chat', 'deepseek-reasoner', 'deepseek-coder'];

console.log('[1] 决策顺序：显式 > 默认 > 调用链严格顺序 > 角色表 > 兜底');
{
  const a = M.jueCeMoXing({ explicit: 'explicit-model', defaultModel: 'x', chain: CHAIN, urgency: 'P2' });
  check('显式指定优先于一切', a.model === 'explicit-model' && a.why === 'explicit', a);

  const b = M.jueCeMoXing({ defaultModel: 'my-model', chain: CHAIN, urgency: 'P2' });
  check('牛马默认模型优先于调用链', b.model === 'my-model' && b.why === 'default', b);

  const c = M.jueCeMoXing({ smartMode: false, defaultModel: '', chain: CHAIN, urgency: 'P2' });
  check('非智能 ⇒ 调用链第 1 个（严格顺序）', c.model === 'deepseek-chat' && c.why === 'chain' && c.chainIndex === 0, c);

  const d = M.jueCeMoXing({ smartMode: false, defaultModel: '', chain: CHAIN, urgency: 'P0' });
  check('P0 不再改变链位次（仍取链头）', d.model === 'deepseek-chat' && d.why === 'chain' && d.chainIndex === 0, d);

  const e = M.jueCeMoXing({ smartMode: false, defaultModel: '', chain: CHAIN, urgency: 'P3' });
  check('P3 不再跳本地/链尾（仍取链头）', e.model === 'deepseek-chat' && e.why === 'chain' && e.chainIndex === 0, e);

  const f = M.jueCeMoXing({ defaultModel: '__smart__', chain: ['cloud-a', 'ollama-b', 'cloud-c'], benDiMoXing: ['ollama-b'], urgency: 'P3' });
  check('本地模型清单不再影响选型（链头 cloud-a）', f.model === 'cloud-a' && f.chainIndex === 0, f);
  const g = M.jueCeMoXing({ defaultModel: '__smart__', chain: ['ollama-a', 'cloud-b'], benDiMoXing: ['ollama-a'], urgency: 'P1' });
  check('P1 急 ⇒ 智能模式优先云端/快模型（cloud-b）', g.model === 'cloud-b' && g.chainIndex === 1, g);

  const h = M.jueCeMoXing({ defaultModel: 'not-in-list', keYongMoXing: ['a', 'b'], chain: ['a', 'b'] });
  check('默认不存在 ⇒ 严格从链头开始', h.model === 'a' && h.why === 'chain' && h.chainIndex === 0, h);

  const i = M.jueCeMoXing({ defaultModel: 'a', keYongMoXing: ['a', 'b'], chain: ['a', 'b'], tiaoGuo: ['a'] });
  check('默认已失败 ⇒ 顺链到下一个（b）', i.model === 'b' && i.why === 'chain' && i.chainIndex === 1, i);

  const j = M.jueCeMoXing({ defaultModel: '__smart__', chain: ['a', 'b', 'c'], tiaoGuo: ['a', 'b'] });
  check('链上前两个已失败 ⇒ 取 c', j.model === 'c' && j.chainIndex === 2, j);
}

console.log('\n[2] 智能模式：按难易度档位挑链位');
{
  const chain = ['cloud-a', 'ollama-b', 'cloud-c'];
  const benDi = ['ollama-b'];
  const hi = M.jueCeMoXing({ smartMode: true, modelTier: 'high', chain, benDiMoXing: benDi });
  check('high ⇒ 优先云端强模型（cloud-a）', hi.model === 'cloud-a' && hi.why === 'smart' && hi.chainIndex === 0, hi);
  const mid = M.jueCeMoXing({ smartMode: true, modelTier: 'mid', chain, benDiMoXing: benDi });
  check('mid ⇒ 链头（cloud-a）', mid.model === 'cloud-a' && mid.why === 'smart' && mid.chainIndex === 0, mid);
  const low = M.jueCeMoXing({ smartMode: true, modelTier: 'low', chain, benDiMoXing: benDi });
  check('low ⇒ 本地/免费（ollama-b）', low.model === 'ollama-b' && low.why === 'smart' && low.chainIndex === 1, low);
  const hi2 = M.jueCeMoXing({ smartMode: true, modelTier: 'high', chain: ['ollama-a', 'cloud-b'], benDiMoXing: ['ollama-a'] });
  check('high 且链头本地 ⇒ 跳过到云端', hi2.model === 'cloud-b' && hi2.chainIndex === 1, hi2);
  const low2 = M.jueCeMoXing({ smartMode: true, modelTier: 'low', chain: ['cloud-a', 'ollama-b'], benDiMoXing: ['ollama-b'] });
  check('low 且链头云端 ⇒ 选本地', low2.model === 'ollama-b' && low2.chainIndex === 1, low2);
  const noLocal = M.jueCeMoXing({ smartMode: true, modelTier: 'low', chain: ['cloud-a', 'cloud-b'], benDiMoXing: [] });
  check('low 没有本地 ⇒ 回链头（不选链尾）', noLocal.model === 'cloud-a' && noLocal.chainIndex === 0, noLocal);
  const withDefault = M.jueCeMoXing({ smartMode: true, modelTier: 'high', defaultModel: 'my-model', chain: ['a', 'b'] });
  check('智能模式不把默认模型当硬指定', withDefault.model === 'a' && withDefault.why === 'smart', withDefault);
  const skipped = M.jueCeMoXing({ smartMode: true, modelTier: 'high', chain: ['a', 'b'], tiaoGuo: ['a'] });
  check('智能模式也跳过本轮已失败', skipped.model === 'b' && skipped.chainIndex === 1, skipped);
}

console.log('\n[3] 【核心】被禁用的模型绝不会被选中');
{
  const dis = ['deepseek-reasoner'];
  const a = M.jueCeMoXing({ defaultModel: 'deepseek-reasoner', chain: CHAIN, chainDisabled: dis, urgency: 'P2' });
  check('默认模型被禁用 ⇒ 不能返回它', a.model !== 'deepseek-reasoner', a);
  const b = M.jueCeMoXing({ defaultModel: '__smart__', chain: CHAIN, chainDisabled: dis, urgency: 'P2' });
  check('智能跳过禁用项（P2 取链头可用项）', b.model !== 'deepseek-reasoner' && b.model === 'deepseek-chat', b);
  // 禁用只作用于「调用链/默认模型」；链全禁用 ⇒ 走角色表/兜底。
  // 若兜底本身也在禁用名单里，如实标注 why='fallback-disabled'（否则这一轮没法对话）。
  const c = M.jueCeMoXing({ defaultModel: '__smart__', chain: CHAIN, chainDisabled: CHAIN, urgency: 'P2', roles: { duty: 'm-duty' } });
  check('调用链全被禁用 ⇒ 转到角色表，且不返回链里的禁用项', c.model === 'm-duty' && !CHAIN.includes(c.model), c);
  const c2 = M.jueCeMoXing({ defaultModel: '__smart__', chain: CHAIN, chainDisabled: CHAIN, urgency: 'P2', fallback: 'deepseek-chat' });
  check('链全禁用且无角色 ⇒ 兜底（若兜底被禁用则如实标注）', c2.model === 'deepseek-chat' && c2.why === 'fallback-disabled', c2);
}

console.log('\n[3] 调用链启用过滤');
{
  const out = M.qiYongLian(['a', 'b', 'c', 'b', ''], ['b']);
  check('去禁用/去空/去重/保序', JSON.stringify(out) === JSON.stringify(['a', 'c']), out);
  check('空链返回空', JSON.stringify(M.qiYongLian([], [])) === '[]');
}

console.log('\n[4] 紧急度/本地清单不再影响链位次（严格链顺序）');
{
  for (const u of ['P0', 'P1', 'P2', 'P3']) {
    const r = M.jueCeMoXing({ smartMode: false, defaultModel: '', chain: CHAIN, urgency: u, benDiMoXing: ['deepseek-reasoner'] });
    check(`${u} ⇒ 仍取链头（不跳位）`, r.model === 'deepseek-chat' && r.chainIndex === 0, r);
  }
  check('空链不崩（走角色/兜底）', typeof M.jueCeMoXing({ chain: [], urgency: 'P2' }).model === 'string');
}

console.log('\n[5] 角色表与兜底（固定顺序，不看紧急度）');
{
  const r = { duty: 'm-duty', executor: 'm-exec', summary: 'm-sum' };
  check('无链 ⇒ 固定先 duty（P2 也一样）', M.jueCeMoXing({ urgency: 'P2', roles: r }).model === 'm-duty');
  check('无 duty ⇒ executor', M.jueCeMoXing({ roles: { executor: 'm-exec', summary: 'm-sum' } }).model === 'm-exec');
  check('只有 summary ⇒ summary', M.jueCeMoXing({ roles: { summary: 'm-sum' } }).model === 'm-sum');
  check('什么都没有 ⇒ 兜底', M.jueCeMoXing({ fallback: 'fb-model' }).model === 'fb-model');
  check('默认兜底 deepseek-chat', M.jueCeMoXing({}).model === 'deepseek-chat');
}

console.log('\n[6] 边界：任何输入都不抛错');
{
  const cases = [undefined, {}, { chain: null }, { chainDisabled: null }, { defaultModel: 123, chain: [1, 2] }, { urgency: 'P9' }];
  let ok = true;
  for (const c of cases) {
    try {
      const r = M.jueCeMoXing(c);
      if (typeof r.model !== 'string' || !r.model) ok = false;
    } catch { ok = false; }
  }
  check('6 组怪输入全部返回合法 model', ok);
}

console.log('\n[7] 复合展示标签「供应商 · 模型」必须剥成纯模型 id（否则 HTTP 400）');
{
  check('jieMoXingMing 剥前缀', M.jieMoXingMing('DeepSeek · deepseek-flash') === 'deepseek-flash', M.jieMoXingMing('DeepSeek · deepseek-flash'));
  check('jieMoXingMing 保留纯名', M.jieMoXingMing('deepseek-flash') === 'deepseek-flash');
  check('jieMoXingMing 空入参', M.jieMoXingMing('') === '' && M.jieMoXingMing(null) === '');
  const a = M.jueCeMoXing({ defaultModel: 'DeepSeek · deepseek-flash' });
  check('默认模型是复合标签 ⇒ 返回纯 id', a.model === 'deepseek-flash', a);
  const b = M.jueCeMoXing({ explicit: 'DeepSeek · deepseek-v4-pro' });
  check('显式指定也是复合标签 ⇒ 返回纯 id', b.model === 'deepseek-v4-pro', b);
  const c = M.jueCeMoXing({ defaultModel: '__smart__', chain: ['DeepSeek · deepseek-flash', 'DeepSeek · deepseek-v4-pro'], urgency: 'P1' });
  check('调用链里是复合标签 ⇒ 返回纯 id', c.model === 'deepseek-flash', c);
  const d = M.jueCeMoXing({ defaultModel: 'DeepSeek · deepseek-flash', chainDisabled: ['DeepSeek · deepseek-flash'], fallback: 'deepseek-chat' });
  check('禁用名单里也是复合标签 ⇒ 判定为被禁用，走兜底', d.why === 'fallback' && d.model === 'deepseek-chat', d);
  const e = M.jueCeMoXing({ fallback: 'DeepSeek · deepseek-chat' });
  check('兜底本身是复合标签 ⇒ 也剥成纯 id', e.model === 'deepseek-chat', e);
}

console.log(`\n==== verify-model-pick: ${pass} ok / ${fail} FAIL ====`);
if (fail) console.log('失败项：\n - ' + failures.join('\n - '));
process.exit(fail ? 1 : 0);
