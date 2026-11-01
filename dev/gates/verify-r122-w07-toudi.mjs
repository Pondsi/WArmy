/**
 * W07 门禁：网络投递发件箱 + 业务 ACK（离线可复跑）
 *
 * 覆盖：
 *  · 发件箱持久化 / 重启续投 / 五状态 / 幂等 / 永久失败
 *  · 真 AnQuanTongBuFuWu+KeHu 握手下的「对端落盘后才 ACK」
 *  · 重复帧：只执行一次副作用，但每次回 ACK
 *  · 读回执、错误 peer 的伪造回执被忽略
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const GEN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let ok = 0;
const fails = [];
function jian(name, cond, detail) {
  if (cond) {
    ok += 1;
    console.log('  ok ', name);
  } else {
    fails.push(name);
    console.log('  FAIL', name, detail === undefined ? '' : JSON.stringify(detail));
  }
}

const proto = await import(pathToFileURL(path.join(GEN, 'packages/sync-protocol/dist/index.js')).href);
const {
  sha256, zhuanZiJieZu, ed25519FromSeed, warmyZhiWen, signEd25519Local, verifyEd25519Local,
  AnQuanTongBuFuWu, AnQuanTongBuKeHu,
} = proto;
const { WangLuoFaJianXiang, TouDiFuWu } = await import(pathToFileURL(path.join(GEN, 'packages/app-shell/dist/wang-luo-tou-di.js')).href);

function shenFen(label) {
  const seed = sha256(zhuanZiJieZu(Buffer.from(`warmy-e2e-v1|${label}`, 'utf8')));
  const keys = ed25519FromSeed(seed);
  const zhiWen = warmyZhiWen(keys.publicKey);
  return {
    zhiWen,
    provider: {
      zhiWen,
      publicKey: keys.publicKey,
      sign: (m) => signEd25519Local(m, keys.privateKey),
      verify: (m, s, p) => verifyEd25519Local(m, zhuanZiJieZu(s), zhuanZiJieZu(p)) === true,
    },
  };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function deng(fn, ms = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await sleep(40);
  }
  return false;
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-w07-'));
const xiangDir = path.join(root, 'outbox');

/* ── 1. 纯发件箱语义 ───────────────────────────────────────── */
{
  let now = 1_000;
  const x = new WangLuoFaJianXiang({ dir: xiangDir, now: () => now, maxAttempts: 2, backoffMs: () => 0 });
  const a = x.save({ msgId: 'm-1', recipientFp: 'peer-a', sessionId: 's-1', payload: { v: 1 } });
  jian('新消息持久化为 saved', a.state === 'saved' && x.pending('peer-a').length === 1, a.state);
  const a2 = x.save({ msgId: 'm-1', recipientFp: 'PEER-A', sessionId: 's-1', payload: { v: 2 } });
  jian('同一 msgId 重复入队不新增、不改内容', a2.payload.v === 1 && x.pending().length === 1, a2.payload);

  x.markSending('m-1', 'peer-a');
  const x2 = new WangLuoFaJianXiang({ dir: xiangDir, now: () => now, maxAttempts: 2, backoffMs: () => 0 });
  jian('重启时 sending 不当作已送达', x2.get('m-1', 'peer-a').state === 'sending');
  const hui = x2.recover();
  jian('重启后 sending 回到 saved 并重新排期', hui === 1 && x2.get('m-1', 'peer-a').state === 'saved');

  x2.save({ msgId: 'm-fail', recipientFp: 'peer-a', sessionId: 's-1', payload: {} });
  x2.markSending('m-fail', 'peer-a');
  x2.recordFailure('m-fail', 'peer-a', 'boom');
  jian('失败一次仍在 saved（可重试）', x2.get('m-fail', 'peer-a')?.state === 'saved', x2.get('m-fail', 'peer-a'));
  x2.markSending('m-fail', 'peer-a');
  x2.recordFailure('m-fail', 'peer-a', 'boom');
  jian('达到上限转 failed，不伪装已送达', x2.get('m-fail', 'peer-a').state === 'failed');

  const b = x2.save({ msgId: 'm-2', recipientFp: 'peer-a', sessionId: 's-1', payload: {} });
  x2.markSending('m-2', 'peer-a');
  x2.markPersisted('m-2', 'peer-a', 'peer-a');
  jian('对端回执后才是 persisted', x2.get('m-2', 'peer-a').state === 'persisted');
  x2.markRead('m-2', 'peer-a', 'peer-a');
  jian('读回执单独成态', x2.get('m-2', 'peer-a').state === 'read');
  const x3 = new WangLuoFaJianXiang({ dir: xiangDir, now: () => now });
  jian('状态跨实例持久（重启不丢）', x3.get('m-2', 'peer-a').state === 'read');
  jian('未收件 msgId 的回执被忽略', x2.markPersisted('m-404', 'peer-a') === null);

  let bad = false;
  try { new WangLuoFaJianXiang({ dir: path.join(root, 'plain-file') }); } catch { bad = true; }
  fs.writeFileSync(path.join(root, 'plain-file'), 'x');
  let threw = false;
  try {
    const x4 = new WangLuoFaJianXiang({ dir: path.join(root, 'plain-file') });
    x4.save({ msgId: 'm-x', recipientFp: 'p', sessionId: 's', payload: {} });
  } catch { threw = true; }
  jian('发件箱目录不可写时如实失败（不假装已保存）', threw, { bad });
}

/* ── 2. 真握手 + 业务 ACK ─────────────────────────────────── */
const srvId = shenFen('w07-server');
const cliId = shenFen('w07-client');
const recvFile = path.join(root, 'recv.jsonl');
const seen = new Set();
let writes = 0;
let dups = 0;
let failNextWrite = false;
let sessionRef = null;
let srvSession = null;
let lastAck = null;

const srv = new AnQuanTongBuFuWu({
  identity: srvId.provider,
  nodeId: 'w07-server',
  host: '127.0.0.1',
  port: 0,
  peerFingerprint: cliId.zhiWen,
  roster: (fp) => fp === cliId.zhiWen,
  fingerprintDerivation: warmyZhiWen,
  onMessage: (m, s) => {
    srvSession = s;
    const z = m.payload && m.payload.zhen;
    if (!z || !z.msgId) return;
    if (failNextWrite) {
      failNextWrite = false;
      return; // 模拟落盘失败：不写、不 ACK
    }
    if (seen.has(z.msgId)) dups += 1;
    else {
      seen.add(z.msgId);
      fs.appendFileSync(recvFile, JSON.stringify({ msgId: z.msgId, text: z.payload && z.payload.text }) + '\n');
      writes += 1;
    }
    try { s.faSong({ to: m.from, channel: 'control', payload: { type: 'toudi-ack', persisted: [z.msgId] } }); } catch { /* noop */ }
  },
});
const srvPort = await srv.start();

let now = Date.now();
const fu = new TouDiFuWu({
  xiang: new WangLuoFaJianXiang({ dir: xiangDir, now: () => now, maxAttempts: 5, backoffMs: () => 0 }),
  now: () => now,
  song: async (jiLu) => {
    if (!sessionRef || !sessionRef.alive) return { ok: false, error: 'offline' };
    try {
      sessionRef.faSong({ to: '*', channel: 'group', groupId: jiLu.sessionId, payload: jiLu.payload });
      return { ok: true, by: srvId.zhiWen };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
  },
});

const frame = (id, text) => ({ chuanShu: true, zhen: { v: 1, msgId: id, sessionId: 'g-1', from: 'w07-client', ts: Date.now(), payload: { text } } });

fu.enqueue({ msgId: 'net-1', sessionId: 'g-1', payload: frame('net-1', 'hello'), recipients: [srvId.zhiWen] });
jian('入队后是 saved（还没连上）', fu.xiang.get('net-1', srvId.zhiWen).state === 'saved');
const r1 = await fu.flush(srvId.zhiWen);
jian('对端离线时 flush 失败但保留消息', r1.failed === 1 && fu.xiang.get('net-1', srvId.zhiWen).state === 'saved', r1);

const cli = new AnQuanTongBuKeHu({
  identity: cliId.provider,
  nodeId: 'w07-client',
  host: '127.0.0.1',
  port: srvPort,
  peerFingerprint: srvId.zhiWen,
  roster: (fp) => fp === srvId.zhiWen,
  fingerprintDerivation: warmyZhiWen,
  onMessage: (m) => {
    if (m.channel === 'control' && m.payload && m.payload.type === 'toudi-ack') {
      lastAck = m.payload;
      fu.ack(srvId.zhiWen, m.payload);
    }
  },
});
const cr = await cli.connect(6000);
sessionRef = cr.session;
jian('真握手成功（pin 对上）', cr.ok === true, cr.reason);

now += 1000;
const r2 = await fu.flush(srvId.zhiWen);
jian('对端上线后 flush 成功发送', r2.ok === 1, r2);
jian('发送成功≠送达：ACK 前仍是 sending', fu.xiang.get('net-1', srvId.zhiWen).state === 'sending');
jian('对端写盘一次', await deng(() => writes === 1), { writes, dups });
jian('收到业务 ACK 后标 persisted', await deng(() => fu.xiang.get('net-1', srvId.zhiWen).state === 'persisted'));
jian('ACK 内容带 msgId', lastAck && Array.isArray(lastAck.persisted) && lastAck.persisted[0] === 'net-1', lastAck);

// 重复投递：同一帧再发一次
now += 1000;
sessionRef.faSong({ to: '*', channel: 'group', groupId: 'g-1', payload: frame('net-1', 'hello') });
await sleep(300);
jian('重复帧对端只执行一次（写入计数不变）', writes === 1 && dups === 1, { writes, dups });
jian('重复帧仍回 ACK（幂等确认）', await deng(() => fu.xiang.get('net-1', srvId.zhiWen).state === 'persisted'));

// 读回执（必须由对端发；自己发给自己的不算）
srvSession.faSong({ to: cliId.zhiWen, channel: 'control', payload: { type: 'toudi-ack', read: ['net-1'] } });
jian('读回执把状态推进到 read', await deng(() => fu.xiang.get('net-1', srvId.zhiWen).state === 'read'));

// 落盘失败：不 ACK → 不能显示 persisted
fu.enqueue({ msgId: 'net-2', sessionId: 'g-1', payload: frame('net-2', 'write-fail'), recipients: [srvId.zhiWen] });
failNextWrite = true;
now += 1000;
await fu.flush(srvId.zhiWen);
await sleep(250);
jian('对端写盘失败 ⇒ 不得标 persisted', fu.xiang.get('net-2', srvId.zhiWen).state === 'sending', fu.xiang.get('net-2', srvId.zhiWen));
jian('写盘失败时对端没有留下记录', !seen.has('net-2'));

// 伪造回执：别的 peer 说"已持久化"必须被忽略
fu.enqueue({ msgId: 'net-3', sessionId: 'g-1', payload: frame('net-3', 'fake-ack'), recipients: [srvId.zhiWen] });
const fake = fu.ack('ATTACKER-FP', { persisted: ['net-3'] });
jian('非收件人的回执被忽略', fake.persisted === 0 && fake.ignored === 1 && fu.xiang.get('net-3', srvId.zhiWen).state === 'saved', fake);

// 持续失败 → failed
const always = new TouDiFuWu({
  xiang: new WangLuoFaJianXiang({ dir: path.join(root, 'outbox-fail'), now: () => now, maxAttempts: 1, backoffMs: () => 0 }),
  now: () => now,
  song: async () => ({ ok: false, error: 'always-fail' }),
});
always.enqueue({ msgId: 'net-9', sessionId: 'g-1', payload: frame('net-9', 'x'), recipients: [srvId.zhiWen] });
await always.flush();
jian('达到最大尝试次数后 failed（如实失败）', always.xiang.get('net-9', srvId.zhiWen).state === 'failed', always.xiang.get('net-9', srvId.zhiWen));

// 重启：同一目录新实例，read 状态不丢
const fu2 = new TouDiFuWu({
  xiang: new WangLuoFaJianXiang({ dir: xiangDir, now: () => now }),
  now: () => now,
  song: async () => ({ ok: false, error: 'offline' }),
});
jian('重启后已持久化/已读状态保留', fu2.xiang.get('net-1', srvId.zhiWen).state === 'read');
jian('重启后未送达消息仍可续投', fu2.xiang.get('net-3', srvId.zhiWen).state === 'saved');

try { cli.close('test-done'); } catch { /* noop */ }
await srv.stop();
fu.stop();
always.stop();
fs.rmSync(root, { recursive: true, force: true });

console.log(`\n==== verify-r122-w07-toudi: ${ok} ok / ${fails.length} FAIL ====`);
if (fails.length) process.exit(1);
