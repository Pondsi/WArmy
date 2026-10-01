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

console.log('[1] 决策顺序');
{
  const a = M.jueCeMoXing({ explicit: 'explicit-model', defaultModel: 'x', chain: CHAIN, urgency: 'P2' });
  check('显式指定优先于一切', a.model === 'explicit-model' && a.why === 'explicit', a);

  const b = M.jueCeMoXing({ defaultModel: 'my-model', chain: CHAIN, urgency: 'P2' });
  check('牛马默认模型优先于调用链', b.model === 'my-model' && b.why === 'default', b);

  const c = M.jueCeMoXing({ defaultModel: '__smart__', chain: CHAIN, urgency: 'P2' });
  check('「智能」+P2 ⇒ 调用链第 2 个', c.model === 'deepseek-reasoner' && c.why === 'chain-p2' && c.chainIndex === 1, c);

  const d = M.jueCeMoXing({ defaultModel: '', chain: CHAIN, urgency: 'P0' });
  check('「智能」+P0 ⇒ 调用链第 1 个（最强）', d.model === 'deepseek-chat' && d.why === 'chain-p0p1' && d.chainIndex === 0, d);

  const e = M.jueCeMoXing({ defaultModel: '__smart__', chain: CHAIN, urgency: 'P3' });
  check('「智能」+P3 ⇒ 调用链最后 1 个（最省）', e.model === 'deepseek-coder' && e.why === 'chain-p3' && e.chainIndex === 2, e);
}

console.log('\n[2] 【核心】被禁用的模型绝不会被选中');
{
  const dis = ['deepseek-reasoner'];
  const a = M.jueCeMoXing({ defaultModel: 'deepseek-reasoner', chain: CHAIN, chainDisabled: dis, urgency: 'P2' });
  check('默认模型被禁用 ⇒ 不能返回它', a.model !== 'deepseek-reasoner', a);
  const b = M.jueCeMoXing({ defaultModel: '__smart__', chain: CHAIN, chainDisabled: dis, urgency: 'P2' });
  check('智能跳过禁用项（P2 不再选第 2 个）', b.model !== 'deepseek-reasoner' && b.model === 'deepseek-coder', b);
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

console.log('\n[4] 紧急度 → 链位次');
{
  check('P0/P1 → 0', M.zhiNengTiaoLian(CHAIN, 'P0') === 0 && M.zhiNengTiaoLian(CHAIN, 'P1') === 0);
  check('P2 → 1', M.zhiNengTiaoLian(CHAIN, 'P2') === 1);
  check('P2 且链只有 1 个 → 0', M.zhiNengTiaoLian(['only'], 'P2') === 0);
  check('P3 → 末位', M.zhiNengTiaoLian(CHAIN, 'P3') === 2);
  check('空链 → -1', M.zhiNengTiaoLian([], 'P2') === -1);
}

console.log('\n[5] 角色表与兜底');
{
  const r = { duty: 'm-duty', executor: 'm-exec', summary: 'm-sum' };
  check('P2 无链 ⇒ 角色 executor', M.jueCeMoXing({ urgency: 'P2', roles: r }).model === 'm-exec');
  check('P3 无链 ⇒ 角色 summary', M.jueCeMoXing({ urgency: 'P3', roles: r }).model === 'm-sum');
  check('P0 无链 ⇒ 角色 duty', M.jueCeMoXing({ urgency: 'P0', roles: r }).model === 'm-duty');
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

console.log(`\n==== verify-model-pick: ${pass} ok / ${fail} FAIL ====`);
if (fail) console.log('失败项：\n - ' + failures.join('\n - '));
process.exit(fail ? 1 : 0);
