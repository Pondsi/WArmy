#!/usr/bin/env node
/**
 * verify-r120-recall-cancel.mjs —— P6：召回补算 single-flight + 截止时间取消。
 *
 * 用**假嵌入器**（固定延迟、记录调用次数）证明行为，不加载真实 ONNX 模型：
 *   A. 并发两次 hydrateVectors 只嵌入一遍（同一记录不重复算）；
 *   B. deadline 到期停止补算，结果如实标 skipped='deadline'；
 *   C. recallDetailed 先查已建索引，补算在后台有界进行；到点后不再新增嵌入调用；
 *   D. 无 deadline 的显式 hydrate 仍可完整补齐（兼容旧调用）。
 *
 * 临时目录 + 合成记录；不读真实 profile；结束清理。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..');
const require = createRequire(import.meta.url);
const mem = await import(pathToFileURL(path.join(repo, 'packages', 'memory-os', 'dist', 'index.js')).href);

let pass = 0;
const ok = (name, cond, detail) => {
  assert.ok(cond, name + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail)));
  pass += 1;
  console.log('PASS ' + name);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-r120-recall-'));
const svc = new mem.JiyiCangFuwu({ CangLu: dir, jsonlName: 'fast-memory.jsonl' });
const calls = [];
const fake = {
  status: { ready: true, reason: '', backend: 'fake', dim: 8, simdSupported: false, threads: 1, modelPath: null, tokenizerPath: null, modelBytes: 0, ortMain: null, ortTried: [], loadMs: 0, embeds: 0, embedTotalMs: 0, lastEmbedMs: 0, maxLength: 256, queryPrefix: '', tokenizer: null },
  tokenize: (s) => Array.from(String(s)).map((c) => c),
  embed: async (text) => {
    calls.push(text);
    await sleep(8);
    const v = new Float32Array(8);
    for (let i = 0; i < 8; i++) v[i] = ((text.charCodeAt(i % Math.max(1, text.length)) || 65) % 17) / 17;
    return v;
  },
};
/** 先等构造期真实初始化结束（否则它会在注入之后再覆盖 embedder）；再换假嵌入器 */
await svc.waitVectorReady();
svc.embedder = fake;
svc.vectorPromise = Promise.resolve();

for (let i = 0; i < 40; i++) {
  svc.append({ id: `m-${i}`, sessionId: 's1', kind: 'fact', ts: i + 1, ti: `第 ${i} 条记忆：蓝色鲸鱼与长颈鹿 ${i}` }, 'duty');
}

try {
  /* A. single-flight */
  const p1 = svc.hydrateVectors(10);
  const p2 = svc.hydrateVectors(10);
  const [r1, r2] = await Promise.all([p1, p2]);
  ok('并发两次 hydrate 结果一致', r1.embedded === r2.embedded && r1.embedded === 10, { r1, r2 });
  ok('并发两次 hydrate 只嵌入一遍（10 次调用）', calls.length === 10, { calls: calls.length });

  /* B. deadline 停止 */
  const before = calls.length;
  const t0 = Date.now();
  const r3 = await svc.hydrateVectors(40, { deadline: Date.now() + 40 });
  const spent = Date.now() - t0;
  ok('deadline 到期停止补算', r3.skipped === 'deadline' && r3.embedded < 30, r3);
  ok('deadline 后不再嵌入全部记录', calls.length - before < 30, { added: calls.length - before });
  ok('deadline 调用在截止附近返回', spent < 500, { spent });

  /* D. 无 deadline 仍可完整补齐 */
  const r4 = await svc.hydrateVectors(1000);
  ok('无 deadline 的显式 hydrate 可完整补齐', r4.embedded > 0 && r4.shengYu === 0, r4);

  /* C. recall 先查索引、补算后台有界 */
  for (let i = 40; i < 90; i++) {
    svc.append({ id: `m-${i}`, sessionId: 's1', kind: 'fact', ts: i + 1, ti: `新增记忆 ${i}：讲的是绿色海豚` }, 'duty');
  }
  const beforeRecall = calls.length;
  const tr = Date.now();
  const detail = await svc.recallDetailed({ query: '蓝色鲸鱼长颈鹿', scope: { sessionId: 's1' }, limit: 5 }, 5, {
    deadline: Date.now() + 60, hydrateBudget: 1000,
  });
  const recallMs = Date.now() - tr;
  ok('recall 在截止附近返回（不被水合拖死）', recallMs < 600, { recallMs });
  ok('recall 有结果且向量通道可用', Array.isArray(detail.cards) && detail.channels.some((c) => c.channel === 'vector' && c.used), detail.channels);
  ok('recall 水合计数小于待补算总量（后台有界）', detail.timings.hydrated < 50, { hydrated: detail.timings.hydrated });
  await sleep(180);
  const settled = calls.length;
  await sleep(150);
  ok('recall 截止后不再新增嵌入调用（取消生效）', calls.length === settled, { settled, now: calls.length });
  ok('recall 只做了有界补算', settled - beforeRecall < 50, { added: settled - beforeRecall });

  console.log(`\nverify-r120-recall-cancel: ${pass} PASS / 0 FAIL`);
} finally {
  try { svc.close(); } catch { /* noop */ }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
}
