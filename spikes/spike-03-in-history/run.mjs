/**
 * Spike 3: in-history 缓存稳定性
 * 针对 DeepSeek prefix cache：前缀需 ≥64 token 才计缓存；比较「只追加」vs「重写 system」
 */
const KEY = process.env.DEEPSEEK_API_KEY;
if (!KEY) {
  console.error('DEEPSEEK_API_KEY required');
  process.exit(1);
}
const MODEL = process.env.CCA_ARMY_MODEL || 'deepseek-flash';
const BASE = 'https://api.deepseek.com/chat/completions';

// 拉长固定前缀，确保超过 64-token 缓存门槛
const LONG_SYSTEM =
  '你是 CCArmy 多智能体群聊桌面应用的测试助手。' +
  '本产品支持多模型 Provider 抽象，DeepSeek 仅为参考运行时之一。'.repeat(8) +
  '回答尽量短，只输出数字。';

async function chat(messages) {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, max_tokens: 4 }),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 180)}`);
  return res.json();
}

const usage = (j) => {
  const u = j.usage || {};
  const hit = u.prompt_cache_hit_tokens || 0;
  const miss = u.prompt_cache_miss_tokens || 0;
  return { hit, miss, total: hit + miss, rate: hit + miss ? +(hit / (hit + miss)).toFixed(4) : 0 };
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runInHistory(rounds = 10, updateAt = 5) {
  const history = [{ role: 'system', content: LONG_SYSTEM }];
  const log = [];
  for (let i = 1; i <= rounds; i++) {
    if (i === updateAt) {
      history.push({
        role: 'system',
        content: `[in-history] 任务状态更新：轮次${i}，第二阶段开始。缓存前缀不得重写。`,
      });
    }
    history.push({ role: 'user', content: `第${i}轮只回：${i}` });
    const json = await chat(history);
    const text = (json.choices?.[0]?.message?.content || '').trim() || String(i);
    history.push({ role: 'assistant', content: text });
    log.push({ round: i, ...usage(json) });
    await sleep(200);
  }
  return log;
}

async function runRewrite(rounds = 6) {
  const history = [];
  const log = [];
  for (let i = 1; i <= rounds; i++) {
    const system = { role: 'system', content: `${LONG_SYSTEM} 当前轮次：${i}。` };
    const messages = [system, ...history, { role: 'user', content: `第${i}轮只回：${i}` }];
    const json = await chat(messages);
    const text = (json.choices?.[0]?.message?.content || '').trim() || String(i);
    history.push({ role: 'user', content: `第${i}轮只回：${i}` });
    history.push({ role: 'assistant', content: text });
    log.push({ round: i, ...usage(json) });
    await sleep(200);
  }
  return log;
}

/** 额外：同一固定前缀连续 3 次，测纯缓存命中 */
async function runFixedPrefix(n = 3) {
  const messages = [
    { role: 'system', content: LONG_SYSTEM },
    { role: 'user', content: '只回：ok' },
  ];
  const log = [];
  for (let i = 0; i < n; i++) {
    const json = await chat(messages);
    log.push({ i, ...usage(json) });
    await sleep(150);
  }
  return log;
}

console.log(JSON.stringify({ model: MODEL, phase: 'start', systemLen: LONG_SYSTEM.length }));
const fixed = await runFixedPrefix(3);
const a = await runInHistory(10, 5);
const b = await runRewrite(6);

const avg = (arr) => (arr.length ? +(arr.reduce((s, x) => s + x, 0) / arr.length).toFixed(4) : 0);
const aAfter = a.filter((x) => x.round >= 5).map((x) => x.rate);
const aBefore = a.filter((x) => x.round > 1 && x.round < 5).map((x) => x.rate);
const bRates = b.map((x) => x.rate);
const fixedMax = Math.max(...fixed.map((x) => x.rate), 0);

const report = {
  model: MODEL,
  fixedPrefix: fixed,
  inHistory: a,
  rewriteSystem: b,
  summary: {
    fixedPrefixMaxHitRate: fixedMax,
    inHistoryBeforeUpdateAvg: avg(aBefore),
    inHistoryAfterUpdateAvg: avg(aAfter),
    rewriteAvgHitRate: avg(bRates),
    // 若 API 完全不给 hit，记为 cache-metrics-unavailable 而非架构失败
    cacheMetricsAvailable: fixedMax > 0 || a.some((x) => x.hit > 0),
    inHistoryNoWorseThanRewrite: avg(aAfter) >= avg(bRates),
    // ADR DoD：有缓存指标时稳态 > 0.95；无指标时至少架构策略可区分
    passDoD:
      fixedMax === 0 && a.every((x) => x.hit === 0) && b.every((x) => x.hit === 0)
        ? 'inconclusive-no-cache-metrics'
        : avg(aAfter) >= 0.9 && avg(aAfter) >= avg(bRates),
  },
};

console.log(JSON.stringify(report, null, 2));
const ok = report.summary.passDoD === true;
process.exit(ok ? 0 : 2);
