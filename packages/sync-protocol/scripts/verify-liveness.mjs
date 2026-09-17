/**
 * verify-liveness.mjs —— 心跳方向服从连通性（ADR C1）实测（可重跑）
 *
 *   node scripts/verify-liveness.mjs
 *
 * 验证点：
 *   [1] 在线判据 = **成员发起的持久连接存活**（不是创建者巡检）
 *   [2] 断链不立即判离线：连续 N 次失败 + 持续 M 秒 的迟滞（防抖动，ADR §2.6）
 *   [3] `sweep()` **绝不遍历全部名册**：只探测显式列入 pendingProbe 的成员
 *   [4] 创建者仅在 `dialable === true` 时才主动探测；不可拨入时连 pendingProbe 都不拨
 *   [5] 探测失败即放弃：队列清空、不重试、无后台定时器
 *   [6] 可拨入但无待探测成员时也不产生任何探测（不轮询）
 *   [7] heartbeat / misses 语义正确
 *   [8] 与真实鉴权连接联动：成员拨入建立 SecureSession → online；断开 → 迟滞后 offline
 */
import {
  ConnectionLiveness,
  GroupKeyRing,
  SecureSyncClient,
  SecureSyncServer,
  createEphemeralIdentity,
  randomBytes,
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

async function main() {
  console.log('=== verify-liveness: C1 心跳方向服从连通性 ===');
  console.log(`node ${process.version}`);

  /* ── [1][2][3] 迟滞 + 不轮询 ── */
  group('[1~3] 在线判据 / 迟滞 / 不轮询名册');
  {
    let fakeNow = 1_000_000;
    const probed = [];
    const offlineEvents = [];
    const lv = new ConnectionLiveness({
      offlineFailures: 2,
      offlineAfterMs: 100,
      now: () => fakeNow,
      probe: async (fp) => {
        probed.push({ fp, at: fakeNow });
        return { ok: false, detail: '探测失败（模拟）' };
      },
      onOffline: (fp, info) => offlineEvents.push({ fp, ...info }),
    });

    const member = 'MEMBER-FP-1';
    const other = 'MEMBER-FP-2';

    // 成员发起的持久连接 → 立即在线
    lv.registerConnection(member, { id: 'conn-1', kind: 'member-initiated' });
    const st1 = lv.status(member);
    check('成员发起的连接建立即判在线', st1.online === true && st1.via === 'member-connection', st1);
    check('未探测任何成员（判在线不需要探测）', lv.probeCallCount.total === 0, lv.probeCallCount);

    // 断链 → 进入迟滞，不立即离线
    lv.closeConnection(member, 'conn-1');
    check('断链后不立即判离线（迟滞）', lv.status(member).online === true, lv.status(member));
    fakeNow += 50;
    const s1 = await lv.sweep();
    check('未达阈值时仍判在线', lv.status(member).online === true, { probes: s1.probed, note: s1.note });
    lv.markMiss(member);
    fakeNow += 30;
    await lv.sweep();
    check('失败 1 次（阈值 2）仍在线', lv.status(member).online === true, lv.status(member).misses);
    lv.markMiss(member);
    fakeNow += 60;
    const s2 = await lv.sweep();
    check('连续失败达标 + 超过持续时间 → 判离线', lv.status(member).online === false && s2.markedOffline.includes(member), s2.markedOffline);
    check('离线回调只触发一次且带原因', offlineEvents.length === 1 && /连续 2 次心跳失败/.test(offlineEvents[0].reason), offlineEvents);

    /* ── [3] 不轮询：名册里 50 人，只有 1 人待探测 ── */
    const roster = Array.from({ length: 50 }, (_, i) => `ROSTER-${i}`);
    for (const fp of roster) lv.registerConnection(fp, { id: `r-${fp}`, kind: 'member-initiated' });
    lv.setDialable(true);
    check('50 人名册全部在线（靠连接判活，零探测）', lv.list().filter((m) => m.online).length === 50, { online: lv.list().filter((m) => m.online).length, total: lv.list().length });
    check('在线阶段探测次数仍为 0', lv.probeCallCount.total === 0, lv.probeCallCount.total);

    /* ── [6] 可拨入但无待探测成员 → 不探测 ── */
    const s3 = await lv.sweep();
    check('可拨入但无待探测成员 → 零探测（不轮询名册）', s3.probed.length === 0, s3.note);
    check('说明文本明确"不主动轮询名册"', /不主动轮询名册/.test(s3.note) || /无待探测成员/.test(s3.note), s3.note);

    /* ── [4] dialable=false + pendingProbe → 仍不拨 ── */
    lv.setDialable(false);
    lv.markPendingProbe(other);
    const s4 = await lv.sweep();
    check('不可拨入时不主动探测（C1）', s4.probed.length === 0 && lv.probeCallCount.total === 0, s4.note);
    check('说明文本指出"等待成员宣告/拨入"', /等待成员宣告|拨入/.test(s4.note), s4.note);
    check('待探测成员仍在队列里（不丢）', lv.pendingProbes.includes(other), lv.pendingProbes);

    /* ── [5] dialable=true → 只拨待探测的 1 人，且只拨一次 ── */
    lv.setDialable(true);
    const s5 = await lv.sweep();
    check('可拨入后只拨待探测的那 1 人', s5.probed.length === 1 && s5.probed[0] === other, s5.probed);
    check('没有误拨名册里的其它 50 人', lv.probeCallCount.total === 1, lv.probeCallCount);
    check('探测留痕', lv.probeLog.length === 1 && lv.probeLog[0].fingerprint === other, lv.probeLog);
    const s6 = await lv.sweep();
    check('探测失败即放弃：下一轮不再拨同一人', s6.probed.length === 0 && lv.probeCallCount.total === 1, { probed: s6.probed, total: lv.probeCallCount.total });
    await sleep(120);
    check('等待后依然没有后台重试', lv.probeCallCount.total === 1 && lv.probeLog.length === 1, lv.probeCallCount);

    /* ── [7] 创建者探测成功 → 刷新在线 ── */
    fakeNow += 1000;
    lv.markPendingProbe(other);
    const s7 = await lv.sweep();
    check('待探测成员每轮最多拨一次（本轮拨了 1 次）', s7.probed.length === 1, s7.probed);
  }
  {
    const lv = new ConnectionLiveness({
      offlineFailures: 1,
      offlineAfterMs: 0,
      now: () => 5_000_000,
      probe: async () => ({ ok: true, detail: '探测成功' }),
    });
    const fp = 'PROBE-OK';
    lv.setDialable(true);
    lv.markPendingProbe(fp);
    const r = await lv.sweep();
    check('主动探测成功 → 记为在线（creator-probe）', r.probed.includes(fp) && lv.status(fp).online === true && lv.status(fp).via === 'creator-probe', lv.status(fp));
  }

  /* ── [8] 与真实鉴权连接联动 ── */
  group('[8] 与真实鉴权连接联动（SecureSession 存活 = 在线）');
  {
    const creatorId = createEphemeralIdentity('creator-lv');
    const memberId = createEphemeralIdentity('member-lv');
    const GROUP = 'grp-lv';
    const closedReasons = [];
    const server = new SecureSyncServer({
      identity: creatorId.provider,
      nodeId: 'creator',
      port: 0,
      groupId: GROUP,
      roster: (fp) => fp === memberId.fingerprint,
      onClose: (s, reason) => closedReasons.push(reason),
    });
    const port = await server.start();

    let onlineEvents = 0;
    const lv = new ConnectionLiveness({
      offlineFailures: 1,
      offlineAfterMs: 0,
      onOnline: () => {
        onlineEvents += 1;
      },
      probe: async () => ({ ok: true }),
    });

    const client = new SecureSyncClient({
      identity: memberId.provider,
      nodeId: 'member',
      host: '127.0.0.1',
      port,
      groupId: GROUP,
      peerFingerprint: creatorId.fingerprint,
    });
    const res = await client.connect();
    check('成员（拨入方）完成鉴权握手', res.ok === true, res.reason ?? 'ok');
    const srvSession = server.sessionList[0];
    check('创建者侧拿到 inbound 会话', srvSession.info.direction === 'inbound' && srvSession.info.peerFingerprint === memberId.fingerprint);

    // 创建者以"服务端收到的 inbound 会话"为在线判据
    const closeConn = () => srvSession.close('test');
    lv.registerConnection(memberId.fingerprint, { id: 'inbound-1', kind: 'member-initiated', close: closeConn });
    check('入站连接 → 成员在线', lv.status(memberId.fingerprint).online === true, lv.status(memberId.fingerprint));
    check('在线事件已触发', onlineEvents === 1, onlineEvents);

    // 成员侧断连 → 创建者的连接关闭 → 走 closeConnection
    client.close('member-going-offline');
    await sleep(250);
    lv.closeConnection(memberId.fingerprint, 'inbound-1');
    check('连接断开后创建者侧观察到关闭', closedReasons.length >= 1, closedReasons);
    check('断开瞬间仍在线（迟滞）', lv.status(memberId.fingerprint).online === true);
    lv.markMiss(memberId.fingerprint);
    const s = await lv.sweep();
    check('迟滞窗口过后判离线', lv.status(memberId.fingerprint).online === false && s.markedOffline.includes(memberId.fingerprint), s.markedOffline);
    check('离线后 via = none', lv.status(memberId.fingerprint).via === 'none', lv.status(memberId.fingerprint));

    // 成员重新拨入 → 再次在线（不需要创建者做任何巡检）
    const client2 = new SecureSyncClient({
      identity: memberId.provider,
      nodeId: 'member',
      host: '127.0.0.1',
      port,
      groupId: GROUP,
      peerFingerprint: creatorId.fingerprint,
    });
    const res2 = await client2.connect();
    check('成员重新拨入（新的鉴权握手）', res2.ok === true, res2.reason ?? 'ok');
    const srvSession2 = server.sessionList.find((s2) => s2 !== srvSession) ?? server.sessionList[0];
    lv.registerConnection(memberId.fingerprint, { id: 'inbound-2', kind: 'member-initiated' });
    check('成员重新上线（创建者零巡检）', lv.status(memberId.fingerprint).online === true && lv.status(memberId.fingerprint).via === 'member-connection', lv.status(memberId.fingerprint));
    check('整个过程中创建者从未主动探测', lv.probeCallCount.total === 0, lv.probeCallCount);
    check('重连使用新会话密钥', res2.session.info.keyFingerprint !== res.session.info.keyFingerprint, {
      c1: res.session.info.keyFingerprint.slice(0, 8),
      c2: res2.session.info.keyFingerprint.slice(0, 8),
    });
    client2.close();
    await server.stop();
  }

  /* ── 群密钥无用例（占位，确保 import 生效） ── */
  void GroupKeyRing;
  void randomBytes;

  console.log(`\n=== verify-liveness 结果：${passes} 通过 / ${failures} 失败 ===`);
  if (failures > 0) process.exitCode = 1;
  setTimeout(() => process.exit(failures > 0 ? 1 : 0), 50).unref();
}

main().catch((e) => {
  console.error('verify-liveness 崩溃：', e);
  process.exit(1);
});
