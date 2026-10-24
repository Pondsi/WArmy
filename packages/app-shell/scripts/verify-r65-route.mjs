import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const src = fs.readFileSync(new URL('../src/hui-hua-lu-you.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { HuiHuaLuYou } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const provider = (id) => ({ id });
let n = 0;
async function test(label, fn) { await fn(); n++; console.log('PASS ' + label); }
await test('最近成功路由依序使用，成功置顶、首次失败保留标记', async () => {
  const r = new HuiHuaLuYou({ A: [{ serverId: 'one', succeededAt: 3, failed: false }, { serverId: 'two', succeededAt: 2, failed: false }] });
  const calls = [];
  const out = await r.send('A', ['one', 'two', 'three'].map(provider), async ({ id }) => { calls.push(id); return { ok: id === 'two' }; });
  assert.deepEqual(calls, ['one', 'two']); assert.equal(out.serverId, 'two');
  assert.deepEqual(r.snapshot().A.map((x) => [x.serverId, x.failed]), [['two', false], ['one', true]]);
  await r.send('A', [provider('one')], async () => ({ ok: false }));
  assert.ok(!r.snapshot().A.some((x) => x.serverId === 'one'));
});
await test('fallback每批最多5个，首成功后不启动下一批并取消其余', async () => {
  const r = new HuiHuaLuYou(); const calls = [], finishes = [], signals = [];
  const promise = r.send('A', Array.from({ length: 20 }, (_, i) => provider(String(i))), (p, signal) => {
    calls.push(p.id); signals.push(signal); return new Promise((resolve) => { finishes.push(resolve); });
  });
  await new Promise(setImmediate); assert.equal(calls.length, 5);
  finishes[2]({ ok: true }); const out = await promise;
  assert.equal(out.serverId, '2'); assert.equal(calls.length, 5);
  assert.equal(signals.filter((s) => s.aborted).length, 4);
  finishes[0]({ ok: true }); finishes[1]({ ok: false }); finishes[3]({ ok: false }); finishes[4]({ ok: false });
  await new Promise(setImmediate);
  assert.deepEqual(r.snapshot().A.map((x) => x.serverId), ['0', '2']);
});
await test('全部失败依次推进批次，本轮不重试已经失败的缓存路由', async () => {
  const r = new HuiHuaLuYou({ A: [{ serverId: '0', succeededAt: 1, failed: false }] });
  const calls = []; let active = 0, peak = 0;
  const result = await r.send('A', Array.from({ length: 13 }, (_, i) => provider(String(i))), async (p) => {
    calls.push(p.id); peak = Math.max(peak, ++active); await new Promise(setImmediate); active--; return { ok: false };
  });
  assert.equal(result.networkUnavailable, true); assert.equal(calls.length, 13);
  assert.equal(new Set(calls).size, 13); assert.ok(peak <= 5);
});
await test('会话缓存相互隔离，最多5条且可持久快照恢复', async () => {
  const r = new HuiHuaLuYou();
  for (let i = 0; i < 8; i++) await r.send('A', [provider(String(i))], async () => ({ ok: true }));
  assert.equal(r.snapshot().A.length, 5);
  await r.send('B', [provider('b')], async () => ({ ok: true }));
  assert.deepEqual(r.snapshot().B.map((x) => x.serverId), ['b']);
  const restored = new HuiHuaLuYou(JSON.parse(JSON.stringify(r.snapshot())));
  assert.deepEqual(restored.snapshot(), r.snapshot());
});
await test('不安全服务商被本地排除，删除后可重新添加', async () => {
  const r = new HuiHuaLuYou(); r.ban('unsafe'); let called = 0;
  const out = await r.send('A', [provider('unsafe')], async () => { called++; return { ok: true }; });
  assert.equal(called, 0); assert.equal(out.networkUnavailable, true);
  r.remove('unsafe'); assert.equal((await r.send('A', [provider('unsafe')], async () => ({ ok: true }))).ok, true);
});
await test('对方离线不误报服务商网络故障；异常和超时有界结束', async () => {
  const r = new HuiHuaLuYou({}, () => {}, Date.now, 10);
  const off = await r.send('A', [provider('one')], async () => ({ ok: false, offline: true }));
  assert.equal(off.networkUnavailable, false); assert.equal(off.offline, true);
  const fail = await r.send('A', [provider('one')], () => new Promise(() => {}));
  assert.equal(fail.networkUnavailable, true);
  const thrown = await r.send('B', [provider('x')], async () => { throw Error('failed'); });
  assert.equal(thrown.ok, false);
});
console.log(`==== verify-r65-route: ${n} PASS / 0 FAIL ====`);
