#!/usr/bin/env node
/**
 * verify-r82-chuan-shu —— 第 82 轮：会话消息传输底层（#106）
 *
 * 只跑纯逻辑，不启动 Electron、不连网络、不读仓库文件：
 *  · AES-256-GCM 帧加密往返，篡改 data/tag/aad 必须失败；
 *  · 发送侧 msgId 去重、接收侧重复丢弃；
 *  · 并发上限 5、单次尝试超时；
 *  · transport 失败一次保留、第二次剔除，成功清 failed；
 *  · 每会话最近成功 ≤5 的淘汰；
 *  · 全失败 → readonly + onAllFailed，后续发送不尝试、不声称送达。
 *
 * 运行：node dev/gates/verify-r82-chuan-shu.mjs
 * （Node 24 默认支持 .ts type stripping，直接动态 import 源码。）
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const {
  ChuanShuDuiLie,
  CHUAN_SHU_AAD,
  aadHuiHua,
  jiaMiZhen,
  jieMiZhen,
} = await import(new URL('../../packages/app-shell/src/hui-hua-chuan-shu.ts', import.meta.url));

let ok = 0;
const hong = [];

const jian = async (name, fn) => {
  try {
    await fn();
    ok += 1;
    console.log('  ok   ' + name);
  } catch (e) {
    hong.push(name);
    console.log('  FAIL ' + name + ' ← ' + String((e && (e.stack || e.message)) || e).slice(0, 500));
  }
};

const zhen = (msgId, sessionId = 's-1', payload = { text: '你好', n: 42 }) => ({
  v: 1,
  msgId,
  sessionId,
  from: 'alice',
  ts: 1_700_000_000_000,
  payload,
  seq: 7,
});

const flip = (b64) => {
  const b = Buffer.from(b64, 'base64');
  b[0] ^= 0x01;
  return b.toString('base64');
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const waitFor = async (fn, ms = 1_000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('waitFor timeout');
    await sleep(1);
  }
};

const key = new Uint8Array(randomBytes(32));
const aad = aadHuiHua('s-1');
const frame = zhen('m-crypto');

console.log('\n[加密 / 解密]');

await jian('往返：AAD 含 sessionId，payload 与 seq 原样还原', () => {
  assert.ok(aad.includes('s-1'), 'AAD 应含 sessionId');
  assert.notEqual(aadHuiHua('s-1'), aadHuiHua('s-2'));
  const mi = jiaMiZhen(frame, key, aad);
  assert.equal(typeof mi.iv, 'string');
  assert.equal(typeof mi.tag, 'string');
  assert.equal(typeof mi.data, 'string');
  assert.deepEqual(jieMiZhen(mi, key, aad), frame);
});

await jian('默认 AAD 也能对称往返', () => {
  const mi = jiaMiZhen(frame, key);
  assert.deepEqual(jieMiZhen(mi, key), frame);
  assert.equal(CHUAN_SHU_AAD, 'chuan-shu:v1');
});

await jian('篡改 data 一个字节 → 解密失败', () => {
  const mi = jiaMiZhen(frame, key, aad);
  assert.throws(() => jieMiZhen({ ...mi, data: flip(mi.data) }, key, aad), /jie-mi-shi-bai/);
});

await jian('篡改 tag 一个字节 → 解密失败', () => {
  const mi = jiaMiZhen(frame, key, aad);
  assert.throws(() => jieMiZhen({ ...mi, tag: flip(mi.tag) }, key, aad), /jie-mi-shi-bai/);
});

await jian('篡改 AAD（换 sessionId）→ 解密失败', () => {
  const mi = jiaMiZhen(frame, key, aad);
  assert.throws(() => jieMiZhen(mi, key, aadHuiHua('s-2')), /jie-mi-shi-bai/);
});

await jian('密钥长度不是 32 字节 → 拒绝', () => {
  assert.throws(() => jiaMiZhen(frame, new Uint8Array(16)), /key-must-be-32-bytes/);
});

console.log('\n[去重]');

await jian('发送侧：同一 msgId 只真正发送一次，重复调用带 duplicate', async () => {
  const calls = [];
  const q = new ChuanShuDuiLie({
    send: async (t, z) => { calls.push([t, z.msgId]); return true; },
  });
  const r1 = await q.faSong(frame, ['t1']);
  const r2 = await q.faSong(frame, ['t2']);
  assert.equal(r1.ok, true);
  assert.equal(r1.deliveredBy, 't1');
  assert.equal(r2.ok, true);
  assert.equal(r2.duplicate, true);
  assert.equal(r2.attempts, 0);
  assert.equal(calls.length, 1, '第二次不应再调用 send');
  assert.equal(calls[0][0], 't1');
});

await jian('发送侧：并发重复调用共享同一次发送', async () => {
  let calls = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const q = new ChuanShuDuiLie({
    send: async () => { calls += 1; await gate; return true; },
  });
  const p1 = q.faSong(frame, ['t1']);
  const p2 = q.faSong(frame, ['t1']);
  await waitFor(() => calls === 1);
  release();
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(calls, 1);
  assert.equal(r1.ok, true);
  assert.equal(r2.duplicate, true);
});

await jian('接收侧：重复 msgId 丢弃，新 msgId 接受', () => {
  const q = new ChuanShuDuiLie({ send: async () => true });
  assert.equal(q.shouDao(zhen('in-1')), true);
  assert.equal(q.shouDao(zhen('in-1')), false);
  assert.equal(q.shouDao(zhen('in-2')), true);
  assert.equal(q.shouDao(zhen('')), false, '空 msgId 非法');
});

console.log('\n[并发 / 超时]');

await jian('并发上限 5：12 个通道峰值恰为 5，成功后不再补位', async () => {
  let active = 0;
  let peak = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const started = [];
  const q = new ChuanShuDuiLie({
    timeoutMs: 2_000,
    send: async (t) => {
      active += 1;
      peak = Math.max(peak, active);
      started.push(t);
      await gate;
      active -= 1;
      return true;
    },
  });
  const transports = Array.from({ length: 12 }, (_, i) => `t${i}`);
  const p = q.faSong(zhen('c-1'), transports);
  try {
    await waitFor(() => active === 5);
    assert.equal(peak, 5);
    assert.equal(active, 5);
  } finally {
    release();
  }
  const r = await p;
  assert.equal(r.ok, true);
  assert.equal(peak, 5, '峰值不能超过 5');
  assert.equal(started.length, 5, '成功后不应再补位启动第 6 个');
});

await jian('超时：注入 40ms + 永不 resolve 的 send，超时失败并 abort', async () => {
  let signal;
  const q = new ChuanShuDuiLie({
    timeoutMs: 40,
    send: (_t, _z, s) => { signal = s; return new Promise(() => {}); },
  });
  const t0 = Date.now();
  const r = await q.faSong(zhen('to-1'), ['slow']);
  const dt = Date.now() - t0;
  assert.equal(r.ok, false);
  assert.equal(r.readonly, true);
  assert.equal(r.attempts, 1);
  assert.ok(dt >= 25 && dt < 1_000, '不应真的等 8 秒，实际 ' + dt + 'ms');
  assert.equal(signal.aborted, true);
});

console.log('\n[通道成败记忆]');

await jian('失败一次保留、第二次剔除，之后不再尝试该通道', async () => {
  const calls = { bad: 0, ok: 0 };
  const q = new ChuanShuDuiLie({
    send: async (t) => {
      if (t === 'bad') { calls.bad += 1; return { ok: false, error: 'nope' }; }
      calls.ok += 1;
      await sleep(10);
      return true;
    },
  });

  const r1 = await q.faSong(zhen('f-1'), ['bad', 'ok']);
  assert.equal(r1.ok, true);
  assert.equal(r1.deliveredBy, 'ok');
  let k = q.kuaiZhao('s-1');
  assert.equal(k.failed.includes('bad'), true, '第一次失败只标记 failed');
  assert.equal(k.removed.includes('bad'), false);
  assert.equal(calls.bad, 1);

  await q.faSong(zhen('f-2'), ['bad', 'ok']);
  k = q.kuaiZhao('s-1');
  assert.equal(k.failed.includes('bad'), false, '第二次失败后不再标记 failed');
  assert.equal(k.removed.includes('bad'), true, '第二次失败后剔除');
  assert.equal(calls.bad, 2);

  await q.faSong(zhen('f-3'), ['bad', 'ok']);
  assert.equal(calls.bad, 2, '剔除后的通道不再被尝试');
  assert.equal(calls.ok, 3);
});

await jian('成功会清掉 failed，之后的第一次失败重新计数', async () => {
  let mode = 'fail';
  let badCalls = 0;
  const q = new ChuanShuDuiLie({
    send: async (t) => {
      if (t === 'flaky') {
        badCalls += 1;
        return mode === 'fail' ? false : true;
      }
      await sleep(10);
      return true;
    },
  });

  await q.faSong(zhen('s-1'), ['flaky', 'ok']);
  assert.equal(q.kuaiZhao('s-1').failed.includes('flaky'), true);

  mode = 'ok';
  const r = await q.faSong(zhen('s-2'), ['flaky']);
  assert.equal(r.ok, true);
  assert.equal(r.deliveredBy, 'flaky');
  assert.deepEqual(q.kuaiZhao('s-1').failed, [], '成功后清 failed');

  mode = 'fail';
  await q.faSong(zhen('s-3'), ['flaky', 'ok']);
  let k = q.kuaiZhao('s-1');
  assert.equal(k.failed.includes('flaky'), true, '清空后第一次失败重新标记');
  assert.equal(k.removed.includes('flaky'), false);

  await q.faSong(zhen('s-4'), ['flaky', 'ok']);
  k = q.kuaiZhao('s-1');
  assert.equal(k.removed.includes('flaky'), true, '清空后第二次失败才剔除');
  // s-1 失败、s-2 成功、s-3 失败、s-4 失败：共 4 次尝试。
  assert.equal(badCalls, 4);
});

await jian('最近成功 ≤5：只保留最新 5 个，最旧的被淘汰', async () => {
  const calls = new Map();
  const q = new ChuanShuDuiLie({
    send: async (t) => {
      calls.set(t, (calls.get(t) || 0) + 1);
      await sleep(5);
      return true;
    },
  });
  for (let i = 1; i <= 6; i += 1) {
    const r = await q.faSong(zhen('r-' + i), ['t' + i]);
    assert.equal(r.ok, true);
  }
  const k = q.kuaiZhao('s-1');
  assert.equal(k.recent.length, 5);
  assert.deepEqual(k.recent, ['t6', 't5', 't4', 't3', 't2']);

  const r = await q.faSong(zhen('r-all'), ['t1', 't2', 't3', 't4', 't5', 't6']);
  assert.equal(r.ok, true);
  assert.equal(r.deliveredBy, 't6', '最近成功的 t6 应优先');
  assert.equal(calls.get('t1'), 1, '被淘汰的 t1 不应在新一轮先被尝试');
});

console.log('\n[全失败 → 只读]');

await jian('全失败：onAllFailed 一次、attempts 正确、标记只读', async () => {
  const failed = [];
  let calls = 0;
  const q = new ChuanShuDuiLie({
    onAllFailed: (sid) => failed.push(sid),
    send: async () => { calls += 1; return { ok: false, error: 'down' }; },
  });
  const r = await q.faSong(zhen('d-1'), ['a', 'b']);
  assert.equal(r.ok, false);
  assert.equal(r.readonly, true);
  assert.equal(r.attempts, 2);
  assert.equal(r.deliveredBy, undefined);
  assert.deepEqual(failed, ['s-1']);
  assert.equal(q.shiZhiDu('s-1'), true);
  assert.equal(q.shiReadonly('s-1'), true);
  assert.equal(calls, 2);
});

await jian('只读后：新 msgId 不再尝试、不声称送达；旧 msgId 返回只读结果', async () => {
  const failed = [];
  let calls = 0;
  let good = false;
  const q = new ChuanShuDuiLie({
    onAllFailed: (sid) => failed.push(sid),
    send: async () => { calls += 1; return good ? true : false; },
  });
  const first = await q.faSong(zhen('d-1'), ['a', 'b']);
  assert.equal(first.readonly, true);
  const before = calls;

  const r2 = await q.faSong(zhen('d-2'), ['a', 'b']);
  assert.equal(calls, before, '只读后不应再调用 send');
  assert.equal(r2.ok, false);
  assert.equal(r2.readonly, true);
  assert.equal(r2.deliveredBy, undefined);
  assert.equal(r2.error, 'readonly');

  const r3 = await q.faSong(zhen('d-1'), ['a', 'b']);
  assert.equal(r3.duplicate, true);
  assert.equal(r3.readonly, true);
  assert.equal(r3.deliveredBy, undefined);
  assert.equal(failed.length, 1, 'onAllFailed 只回调一次');

  q.chongZhiReadonly('s-1');
  assert.equal(q.shiZhiDu('s-1'), false);
  good = true;
  const r4 = await q.faSong(zhen('d-3'), ['a']);
  assert.equal(r4.ok, true);
  assert.equal(r4.deliveredBy, 'a');
  assert.equal(r4.readonly, false);
});

console.log(`\nverify-r82-chuan-shu: ${ok} ok / ${hong.length} FAIL`);
if (hong.length) {
  console.log('失败项：' + hong.join('、'));
}
process.exit(hong.length ? 1 : 0);
