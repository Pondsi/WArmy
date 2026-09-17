/**
 * verify-dht.mjs —— DHT 发现层实测（可重跑）
 *
 *   node scripts/verify-dht.mjs
 *
 * 三个本地实例（真实 UDP 127.0.0.1，随机端口，XOR 距离路由）验证：
 *   [1] 引导 + 路由表 + 迭代 FIND_NODE
 *   [2] 发布 / 查询：公钥指纹 → 当前地址，内容可用群密钥解出
 *   [3] 篡改记录 → 验签失败；无群密钥者读不到内容（但签名仍合法）
 *   [4] 回滚防护：旧 seq 记录被拒（store RPC 直接报错）
 *   [5] IP / 端口变化后重新宣告 → 能被查到新地址（事件驱动，无需轮询）
 *   [6] 垃圾记录（高 seq 但内容不可解）不遮蔽合法记录
 *   [7] 假名签名模式：公共 DHT 看不到真实指纹，群成员可反推
 */
import {
  DhtNode,
  GroupKeyRing,
  ccarmyFingerprint,
  createEphemeralIdentity,
  ed25519FromSeed,
  hmacSha256,
  randomBytes,
  recordKeyForFingerprint,
  signRecordEnvelope,
  verifyRecordEnvelope,
} from '../dist/index.js';

let failures = 0;
let passes = 0;
function check(label, cond, detail) {
  const mark = cond ? 'PASS' : 'FAIL';
  if (cond) passes += 1;
  else failures += 1;
  const extra = detail === undefined ? '' : ` => ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
  console.log(`  [${mark}] ${label}${extra}`);
}
function group(title) {
  console.log(`\n${title}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mkIdentity = (label) => createEphemeralIdentity(label).provider;

const GROUP_KEY = randomBytes(32);
const GROUP_KEY_WRONG = randomBytes(32);

const alice = mkIdentity('alice');
const bob = mkIdentity('bob');
const carol = mkIdentity('carol');
const outsider = mkIdentity('outsider');
/** 被宣告的"异地成员"（只有指纹，不需要真机） */
const memberM = { fingerprint: ccarmyFingerprint(randomBytes(32)) };

function makeNode(identity, nodeId, tcpPort, opts = {}) {
  return new DhtNode({
    identity,
    nodeId,
    host: '127.0.0.1',
    port: 0,
    tcpPort,
    k: 8,
    alpha: 3,
    rpcTimeoutMs: 800,
    groupKeys: opts.groupKeys ?? new GroupKeyRing([GROUP_KEY]),
    signing: opts.signing,
    onRecord: opts.onRecord,
  });
}

async function main() {
  console.log('=== verify-dht: Kademlia 风格发现（UDP，签名记录 + 群密钥加密）===');
  console.log(`node ${process.version} | 群密钥 ${GROUP_KEY.length} 字节 | 成员指纹 M=${memberM.fingerprint.slice(0, 12)}…`);

  const A = makeNode(alice, 'node-a', 17701);
  const B = makeNode(bob, 'node-b', 17702);
  const C = makeNode(carol, 'node-c', 17703);
  const addrA = await A.start();
  const addrB = await B.start();
  const addrC = await C.start();
  console.log(`绑定：A=${addrA.host}:${addrA.port} B=${addrB.host}:${addrB.port} C=${addrC.host}:${addrC.port}`);

  /* ── [1] 引导 ── */
  group('[1] 引导与路由表');
  const r1 = await B.bootstrap([addrA]);
  const r2 = await C.bootstrap([addrA, addrB]);
  const r3 = await A.bootstrap([addrB, addrC]);
  check('B 引导成功', r1.ok === 1, r1);
  check('C 引导成功（可多 seed）', r2.ok === 2, r2);
  check('A 反向引导成功', r3.ok === 2, r3);
  check('B 路由表已学到 A', B.contactCount >= 1, B.contactCount);
  check('C 路由表已学到 A/B', C.contactCount >= 2, C.contactCount);
  const lookup = await C.iterativeLookup(A.id);
  check('迭代查询能找到 A 的 contact', lookup.some((c) => c.id.equals(A.id)), lookup.map((c) => c.port));
  check('DHT 节点 ID 由指纹推出（身份即路由身份）', !A.id.equals(B.id) && A.id.length === 32);

  /* ── [2] 发布 / 查询 ── */
  group('[2] 发布 / 查询：指纹 → 地址');
  const published = await A.publish({ fingerprint: memberM.fingerprint });
  check('发布成功', !!published.envelope && published.seq >= 1, { key: published.key.slice(0, 12), seq: published.seq });
  check('记录键由指纹推出（不含明文指纹）', published.key === recordKeyForFingerprint(memberM.fingerprint));
  check('已 PUT 到其它节点', published.storedOn.length >= 1, published.storedOn);

  const q = await C.query(memberM.fingerprint);
  check('C 查询到记录', q.ok === true, q.ok ? 'ok' : JSON.stringify(q.rejected));
  check('解出的地址 = A 宣告的地址', q.record.host === '127.0.0.1' && q.record.port === 17701, q.record);
  check('解出的指纹 = 被宣告成员', q.record.fp === memberM.fingerprint);
  check('签名者 = A 的真实指纹（identity 模式）', q.signer === alice.fingerprint, q.signer?.slice(0, 12));
  check('查询尝试明细可观测', q.attempts.length >= 1, q.attempts);

  /* ── [3] 篡改与无密钥 ── */
  group('[3] 篡改验签失败 / 无群密钥读不到内容');
  {
    const tampered = { ...published.envelope, sl: Buffer.from(published.envelope.sl, 'base64url') };
    tampered.sl[3] = tampered.sl[3] ^ 0x01;
    const res = await verifyRecordEnvelope({ ...tampered, sl: tampered.sl.toString('base64url') }, { expectKey: published.key, groupKeys: new GroupKeyRing([GROUP_KEY]) });
    check('篡改密文（sl）→ 验签失败', res.ok === false && res.reason === 'signature-invalid', res.reason ?? res.detail);
  }
  {
    const res = await verifyRecordEnvelope({ ...published.envelope, sg: outsider.fingerprint }, { expectKey: published.key, groupKeys: new GroupKeyRing([GROUP_KEY]) });
    check('篡改签名者指纹 → signer-mismatch', res.ok === false && res.reason === 'signer-mismatch', res.reason);
  }
  {
    const res = await verifyRecordEnvelope({ ...published.envelope, v: 99 }, { expectKey: published.key });
    check('版本不符 → bad-version', res.ok === false && res.reason === 'bad-version', res.reason);
  }
  {
    const res = await verifyRecordEnvelope(published.envelope, { expectKey: recordKeyForFingerprint('someone-else') });
    check('记录键不符 → key-mismatch', res.ok === false && res.reason === 'key-mismatch', res.reason);
  }
  {
    // 无群密钥的节点：签名仍合法（可确认"有记录存在 / 谁发的"），但内容读不到
    const D = new DhtNode({
      identity: outsider,
      nodeId: 'node-d',
      host: '127.0.0.1',
      port: 0,
      groupKeys: new GroupKeyRing([GROUP_KEY_WRONG]),
      rpcTimeoutMs: 800,
    });
    await D.start();
    await D.bootstrap([addrA, addrB, addrC]);
    const dq = await D.query(memberM.fingerprint);
    check('无正确群密钥 → 查询拿不到内容', dq.ok === false, dq.ok ? JSON.stringify(dq.record) : 'ok=false');
    check('拒绝原因 = decrypt-failed', dq.rejected.some((x) => x.reason === 'decrypt-failed'), dq.rejected.map((x) => x.reason));
    const soft = await verifyRecordEnvelope(published.envelope, { expectKey: published.key, groupKeys: new GroupKeyRing([GROUP_KEY_WRONG]), requireDecrypt: false });
    check('宽松模式：签名通过但 record 为空（读不到内容）', soft.ok === true && soft.record === undefined, soft.ok);
    check('（记录到报告的元数据泄露）无密钥者仍能看到发布者指纹', soft.signer === alice.fingerprint, soft.signer?.slice(0, 12));
    await D.stop();
  }

  /* ── [4] 回滚防护 ── */
  group('[4] 回滚防护（旧 seq 记录被拒）');
  {
    const stale = await signRecordEnvelope({
      identity: alice,
      groupKey: GROUP_KEY,
      key: published.key,
      record: { fp: memberM.fingerprint, host: '127.0.0.1', port: 19999, scope: 'lan', announcedAt: Date.now() },
      seq: 1,
      ts: Date.now(),
    });
    let storeErr = 'no-error';
    try {
      // 向本机发 store（自环 RPC）：必须被当成请求处理，而不是被误判成回包
      await A.call(A.address, { t: 'store', key: published.key, env: stale }, 'stored');
    } catch (e) {
      storeErr = String(e.message);
    }
    const local = A.localRecord(published.key);
    check('旧 seq 记录被 store 拒绝（自环 RPC 也走真实验签）', storeErr.includes('stale-seq'), storeErr);
    check('本机记录仍是最新 seq', local.s === published.seq, { now: local?.s, published: published.seq });
    const vres = await verifyRecordEnvelope(stale, { expectKey: published.key, lastSeq: published.seq, groupKeys: new GroupKeyRing([GROUP_KEY]) });
    check('verifyRecordEnvelope 判定 stale-seq', vres.ok === false && vres.reason === 'stale-seq', vres.reason);
  }

  /* ── [5] 地址变化后重新宣告 ── */
  group('[5] IP / 端口变化 → 重新宣告 → 可被查到');
  {
    const events = [];
    const unwatch = B.watch(published.key, (env) => events.push(env));
    const before = await C.query(memberM.fingerprint);
    A.setTcpPort(27701); // 模拟端口变化（IP 变化同理：换 host + 重新宣告）
    const republished = await A.publish({ fingerprint: memberM.fingerprint });
    check('重新宣告 seq 递增', republished.seq > published.seq, { before: published.seq, after: republished.seq });
    await sleep(200);
    const after = await C.query(memberM.fingerprint);
    check('查询到新端口', after.ok === true && after.record.port === 27701, after.record);
    check('旧记录已被新记录取代（seq 高者胜）', after.envelope.s === republished.seq, { got: after.envelope?.s, want: republished.seq });
    check('事件驱动：B 的 watch 被触发（无轮询）', events.length >= 1, events.map((e) => e.s));
    check('变化前的地址确实不同（排除误判）', before.record.port === 17701, before.record);
    unwatch();

    // IP 变化（host 变化）
    const ipRec = await A.publish({
      fingerprint: memberM.fingerprint,
      record: { fp: memberM.fingerprint, host: '10.20.30.40', port: 27701, scope: 'public', announcedAt: Date.now() },
    });
    await sleep(200);
    const afterIp = await C.query(memberM.fingerprint);
    check('IP 变化后重新宣告可被查到', afterIp.ok === true && afterIp.record.host === '10.20.30.40', afterIp.record);
    check('再次宣告 seq 继续递增', ipRec.seq > republished.seq, { ipSeq: ipRec.seq, prev: republished.seq });
  }

  /* ── [6] 垃圾记录不遮蔽合法记录 ── */
  group('[6] 高 seq 垃圾记录（内容不可解）不遮蔽合法记录');
  {
    // 攻击者（有签名能力但无群密钥）用一把垃圾密钥加密，seq 拉到很高，从**外部节点**塞进 B
    const attackerKey = randomBytes(32);
    const garbage = await signRecordEnvelope({
      identity: outsider,
      groupKey: attackerKey,
      key: published.key,
      record: { fp: memberM.fingerprint, host: '6.6.6.6', port: 6666, scope: 'public', announcedAt: Date.now() },
      seq: 9999,
      ts: Date.now(),
    });
    const HOSTILE = new DhtNode({
      identity: mkIdentity('hostile'),
      nodeId: 'node-hostile',
      host: '127.0.0.1',
      port: 0,
      groupKeys: new GroupKeyRing([attackerKey]),
      rpcTimeoutMs: 800,
    });
    const addrHostile = await HOSTILE.start();
    await HOSTILE.bootstrap([addrB]);
    const storedOnB = await HOSTILE.call(addrB, { t: 'store', key: garbage.k, env: garbage }, 'stored').then(
      () => true,
      () => false
    );
    check('存储节点只验签、不看内容 → 垃圾记录被存下（已知弱点）', storedOnB === true);
    check('B 的记录确实被垃圾占位（seq=9999）', B.localRecord(garbage.k)?.s === 9999, B.localRecord(garbage.k)?.s);
    const q2 = await C.query(memberM.fingerprint);
    check('查询仍返回合法记录（垃圾被验签/解密拒绝）', q2.ok === true && q2.record.host !== '6.6.6.6', q2.record);
    check(
      '查询明细里记录了垃圾的拒绝原因',
      q2.rejected.some((r) => r.reason === 'decrypt-failed' || r.reason === 'signature-invalid'),
      q2.rejected.map((r) => r.reason)
    );
    await HOSTILE.stop();
    void addrHostile;
  }

  /* ── [7] 假名签名 ── */
  group('[7] 假名签名模式（隐藏真实指纹）');
  {
    const P = makeNode(alice, 'node-p', 37701, { signing: 'pseudonymous' });
    await P.start();
    await P.bootstrap([addrA, addrB, addrC]);
    // 用另一个成员指纹发布，避免与前面 identity 模式的同键记录打架
    const member2 = ccarmyFingerprint(randomBytes(32));
    const pub = await P.publish({ fingerprint: member2, signing: 'pseudonymous' });
    check('假名模式发布成功', !!pub.envelope, pub.seq);
    check('公共 DHT 上签名者 ≠ 真实指纹', pub.envelope.sg !== alice.fingerprint, pub.envelope.sg.slice(0, 12));

    // 无群密钥者：验签通过但认不出是谁
    const vs = await verifyRecordEnvelope(pub.envelope, { groupKeys: new GroupKeyRing([GROUP_KEY_WRONG]), requireDecrypt: false });
    check('无密钥者：签名合法但不知道是谁', vs.ok === true && vs.signer !== alice.fingerprint, vs.signer?.slice(0, 12));

    // 群成员：用群密钥可推出"这个假名就是 alice"
    const seed = hmacSha256(GROUP_KEY, Buffer.from(`ccarmy-dht/1|pseudonym|${alice.fingerprint}`, 'utf8'));
    const expectPseudonym = ccarmyFingerprint(ed25519FromSeed(seed).publicKey);
    check('群成员可反推假名归属', expectPseudonym === pub.envelope.sg, { expect: expectPseudonym.slice(0, 12), got: pub.envelope.sg.slice(0, 12) });

    // 群成员查询：能解出内容
    const P2 = new DhtNode({
      identity: carol,
      nodeId: 'node-c2',
      host: '127.0.0.1',
      port: 0,
      groupKeys: new GroupKeyRing([GROUP_KEY]),
      rpcTimeoutMs: 800,
    });
    await P2.start();
    await P2.bootstrap([addrA, addrB, addrC, P.address]);
    const q2 = await P2.query(member2);
    check('群成员能解出假名记录内容', q2.ok === true && q2.record.port === 37701, q2.record);
    await P.stop();
    await P2.stop();
  }

  group('[8] 可观测性计数');
  check('RPC 收发计数 > 0', A.statsSnapshot.rpcSent > 0 && A.statsSnapshot.rpcRecv > 0, { sent: A.statsSnapshot.rpcSent, recv: A.statsSnapshot.rpcRecv });
  check('学到了其它节点', A.statsSnapshot.nodesLearned > 0, A.statsSnapshot.nodesLearned);
  check('接受过记录', B.statsSnapshot.storesAccepted > 0, B.statsSnapshot.storesAccepted);

  group('[9] 记录新鲜度（TTL）—— 过期记录不再被接受/返回');
  {
    const now = Date.now();
    const fresh = await signRecordEnvelope({
      identity: alice,
      groupKey: GROUP_KEY,
      key: recordKeyForFingerprint(memberM.fingerprint),
      record: { fp: memberM.fingerprint, host: '127.0.0.1', port: 17701, scope: 'lan', announcedAt: now },
      seq: 100000,
      ts: now,
    });
    const okNow = await verifyRecordEnvelope(fresh, { expectKey: fresh.k, groupKeys: new GroupKeyRing([GROUP_KEY]), now: () => now, tsToleranceMs: 30 * 60_000 });
    check('刚发布的记录有效', okNow.ok === true, okNow.reason);
    const tooOld = await verifyRecordEnvelope(fresh, { expectKey: fresh.k, groupKeys: new GroupKeyRing([GROUP_KEY]), now: () => now + 45 * 60_000, tsToleranceMs: 30 * 60_000 });
    check('超过 TTL（30 分钟）的记录被拒', tooOld.ok === false && /时间戳/.test(tooOld.detail ?? ''), tooOld.detail);
    const longerTtl = await verifyRecordEnvelope(fresh, { expectKey: fresh.k, groupKeys: new GroupKeyRing([GROUP_KEY]), now: () => now + 45 * 60_000, tsToleranceMs: 60 * 60_000 });
    check('TTL 可配置（放宽后同一记录有效）', longerTtl.ok === true, longerTtl.reason);
  }

  await Promise.all([A.stop(), B.stop(), C.stop()]);

  console.log(`\n=== verify-dht 结果：${passes} 通过 / ${failures} 失败 ===`);
  if (failures > 0) process.exitCode = 1;
  setTimeout(() => process.exit(failures > 0 ? 1 : 0), 50).unref();
}

main().catch((e) => {
  console.error('verify-dht 崩溃：', e);
  process.exit(1);
});
