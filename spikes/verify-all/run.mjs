/**
 * 全面回归：Provider / Security / Instance / 契约一致性
 * 不依赖外网（除可选 DEEPSEEK_API_KEY）
 */
import {chuangjianGongYing, congYuSheChuangJian, GONGYING_YUSHE, guiFanYongLiang, } from '@warmy/providers';
import {createP1Runtime, AnquanGuanliqi, MemorySecurityStore, FileSecurityStore, ChaixieMingce, suggestMaxInstances, } from '@warmy/app-shell';

const fails = [];
function check(ming, cond, detail) {
  if (!cond) fails.push({ ming, detail });
  console.log(`${cond ? 'OK' : 'FAIL'}  ${ming}${detail ? ' — ' + JSON.stringify(detail) : ''}`);
}

// ── Provider ──
check('presets>=7', GONGYING_YUSHE.length >= 7, { n: GONGYING_YUSHE.length });
check(
  '3 protocols',
  new Set(GONGYING_YUSHE.map((p) => p.protocol)).size === 3,
  { protocols: [...new Set(GONGYING_YUSHE.map((p) => p.protocol))] }
);
const ds = congYuSheChuangJian('deepseek', { apiKey: 'sk-x' });
check('deepseek baseURL', ds.baseURL === 'https://api.deepseek.com', { b: ds.baseURL });
const openai = chuangjianGongYing('openai-compatible', { baseURL: 'https://api.example.com/v1' }, 'x');
check('custom baseURL', openai.baseURL === 'https://api.example.com/v1', { b: openai.baseURL });
const ant = chuangjianGongYing('anthropic', {});
check('anthropic base', ant.baseURL === 'https://api.anthropic.com', { b: ant.baseURL });
const ol = chuangjianGongYing('ollama', {});
check('ollama base', ol.baseURL === 'http://127.0.0.1:11434', { b: ol.baseURL });

// usage 归一化
const dsU = guiFanYongLiang(
  { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110, prompt_cache_hit_tokens: 64, prompt_cache_miss_tokens: 36 },
  'openai-compatible'
);
check('deepseek cache normalize', dsU.cacheHitTokens === 64 && dsU.source === 'native', dsU);
const oaU = guiFanYongLiang(
  { prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 80 } },
  'openai-compatible'
);
check('openai cached_tokens normalize', oaU.cacheHitTokens === 80, oaU);
const anU = guiFanYongLiang(
  { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 40, cache_creation_input_tokens: 20 },
  'anthropic'
);
check('anthropic cache normalize', anU.cacheHitTokens === 40 && anU.promptTokens === 70, anU);
const oU = guiFanYongLiang({ prompt_eval_count: 20, eval_count: 3 }, 'ollama');
check('ollama usage normalize', oU.promptTokens === 20 && oU.cacheHitTokens === 0 && oU.source === 'estimated', oU);

// ── Security fail-closed ──
const sec1 = new AnquanGuanliqi(new MemorySecurityStore());
await sec1.init();
await sec1.setMode('strict');
const r1 = await sec1.requestToolCall('tool:dangerous');
check('strict no-ui denies', r1.allowed === false, r1);
await sec1.setMode('normal');
const r2 = await sec1.requestToolCall('tool:read');
check('normal no-ui denies', r2.allowed === false, r2);
await sec1.setMode('full');
const r3 = await sec1.requestToolCall('tool:read');
check('full allows', r3.allowed === true, r3);

// normal + onApprove + 持久允许
let asked = 0;
const sec2 = new AnquanGuanliqi(new MemorySecurityStore(), async () => {
  asked++;
  return { action: 'tool:fs', scope: 'global', allowed: true };
});
await sec2.init();
await sec2.setMode('normal');
await sec2.requestToolCall('tool:fs.write');
const r4 = await sec2.requestToolCall('tool:fs.write');
check('allowlist persists', asked === 1 && r4.allowed && r4.scope === 'global', { asked, r4 });

// strict 不落库
const sec3 = new AnquanGuanliqi(new MemorySecurityStore(), async () => ({
  action: 'x',
  scope: 'project',
  allowed: true,
}));
await sec3.init();
await sec3.setMode('strict');
await sec3.requestToolCall('tool:y');
check('strict no persist', sec3.listAllowlist().length === 0, { n: sec3.listAllowlist().length });

// 边界写
const sec4 = new AnquanGuanliqi(new MemorySecurityStore());
await sec4.init();
await sec4.setMode('normal');
const inside = await sec4.requestBoundaryWrite('C:\\ws\\a.txt', 'C:\\ws');
const outside = await sec4.requestBoundaryWrite('C:\\Windows\\hosts', 'C:\\ws');
check('boundary inside ok', inside.allowed === true, inside);
check('boundary outside denied no-ui', outside.allowed === false, outside);

// FileSecurityStore
const storeFile = 'C:\\Users\\p\\AppData\\Local\\Temp\\warmy-sec-test.json';
const fstore = new FileSecurityStore(storeFile);
await fstore.save({ mode: 'strict', allowlist: [{ key: 'k', scope: 'global', decision: 'allow', createdAt: 1 }] });
const loaded = await fstore.load();
check('file store roundtrip', loaded.mode === 'strict' && loaded.allowlist.length === 1, loaded);

// ── Instance + Teardown ──
const { instances, teardown } = await createP1Runtime({
  instancesRoot: 'C:\\Users\\p\\AppData\\Local\\Temp\\warmy-verify-instances',
});
check('suggest 1..8', suggestMaxInstances() >= 1 && suggestMaxInstances() <= 8, { s: suggestMaxInstances() });
const h = await instances.spawn({
  config: { id: 'v1', ming: 'v1', workspace: 'x', dutyEligible: true },
});
check('spawn running', h.status === 'running' && !!h.pid, h);
await new Promise((r) => setTimeout(r, 200));
await instances.stop('v1');
await instances.stopAll();
check('teardown zero', teardown.size() === 0, { n: teardown.size() });
check('list empty', instances.list().length === 0, { n: instances.list().length });

// max instances
const { instances: im2, teardown: tr2 } = await createP1Runtime({
  instancesRoot: 'C:\\Users\\p\\AppData\\Local\\Temp\\warmy-verify-instances',
  maxInstances: 1,
});
await im2.spawn({ config: { id: 'a', ming: 'a', workspace: 'x', dutyEligible: true } });
let maxErr = null;
try {
  await im2.spawn({ config: { id: 'b', ming: 'b', workspace: 'x', dutyEligible: false } });
} catch (e) {
  maxErr = String(e.message);
}
check('max instances enforced', !!maxErr, { maxErr });
await im2.stopAll();
await tr2.shutdownAll();

// ── 可选 DeepSeek ──
if (process.env.DEEPSEEK_API_KEY) {
  const live = congYuSheChuangJian('deepseek', { apiKey: process.env.DEEPSEEK_API_KEY });
  const r = await live.chat({
    model: 'deepseek-chat',
    xiaoXiJi: [{ role: 'user', content: '只回：ok' }],
    maxTokens: 4,
  });
  check('deepseek live', (r.choices[0]?.message?.content || '').includes('ok'), {
    c: r.choices[0]?.message?.content,
    usage: r.usage,
  });
}

console.log('\n==== SUMMARY ====');
if (fails.length) {
  console.log('FAILURES', fails);
  process.exit(1);
}
console.log('ALL PASS');
process.exit(0);
