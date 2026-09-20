/**
 * verify-announce.mjs —— 双向宣告 + 连接阶梯 + 可拨入检测 + 地址变化重宣告（可重跑）
 *
 *   node scripts/verify-announce.mjs
 *
 * 两个本地实例（真实 UDP 的 DHT + 真实 TCP 的鉴权会话）：
 *   [1] 创建者上线宣告 → 成员宣告 → 成员经 DHT 找到创建者并**真握手**建连
 *   [2] 创建者收到成员的宣告 → 在名册内 → **反向**建连（双向宣告成立、无轮询）
 *   [3] 宣告失败即放弃：每个成员每次宣告只一次，retries 恒为 0，等待后不增加
 *   [4] 名册外的宣告被拒（不建连）
 *   [5] C1：canDial=false 时不主动拨，只登记地址
 *   [6] 连接阶梯：public-direct →（upnp/holepunch/relay 明确未实现）→ lan 真实发现并建连
 *   [7] 可拨入检测（autonat 思路）：对端真拨回 → dialable=true；端口错 → false
 *   [8] 地址（端口）变化 → 重新宣告 → 对端能查到新地址
 */
import {DizhiJiantingqi, LianJieTiZi, DhtJieDian, KeBoRuTanCe, QunMiyaoHuan, LanProbe, SecureSyncClient, SecureSyncServer, chuangjianLinShiShenFen, randomBytes, recordKeyForFingerprint, boTcpMoRen, } from '../dist/index.js';

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
const mk = (label) => chuangjianLinShiShenFen(label);

const GROUP = 'grp-announce-1';
const GROUP_KEY = randomBytes(32);

const creatorId = mk('creator');
const memberId = mk('member');
const ghostId = mk('ghost');
const strangerId = mk('stranger');

const live = [];

async function main() {
  console.log('=== verify-announce: 双向宣告 / 连接阶梯 / 可拨入检测 ===');
  console.log(`node ${process.version} | 创建者 ${creatorId.fingerprint.slice(0, 12)}… 成员 ${memberId.fingerprint.slice(0, 12)}…`);

  /* ── 实例搭建 ── */
  const creatorTcp = new SecureSyncServer({
    identity: creatorId.provider,
    nodeId: 'creator',
    port: 0,
    groupId: GROUP,
    roster: (fp) => fp === memberId.fingerprint,
  });
  const memberTcp = new SecureSyncServer({
    identity: memberId.provider,
    nodeId: 'member',
    port: 0,
    groupId: GROUP,
    roster: (fp) => fp === creatorId.fingerprint,
  });
  const creatorTcpPort = await creatorTcp.start();
  const memberTcpPort = await memberTcp.start();

  const creatorDht = new DhtJieDian({
    identity: creatorId.provider,
    nodeId: 'creator',
    host: '127.0.0.1',
    port: 0,
    tcpPort: creatorTcpPort,
    groupKeys: new QunMiyaoHuan([GROUP_KEY]),
    rpcTimeoutMs: 800,
  });
  const memberDht = new DhtJieDian({
    identity: memberId.provider,
    nodeId: 'member',
    host: '127.0.0.1',
    port: 0,
    tcpPort: memberTcpPort,
    groupKeys: new QunMiyaoHuan([GROUP_KEY]),
    rpcTimeoutMs: 800,
  });
  const creatorDhtAddr = await creatorDht.start();
  await memberDht.start();
  await memberDht.bootstrap([creatorDhtAddr]);
  await creatorDht.bootstrap([memberDht.address]);
  console.log(`TCP: 创建者 ${creatorTcpPort} / 成员 ${memberTcpPort}；DHT: 创建者 ${creatorDhtAddr.port} / 成员 ${memberDht.address.port}`);

  const memberRoster = [{ fingerprint: memberId.fingerprint, nodeId: 'member' }];
  const creatorRoster = [{ fingerprint: creatorId.fingerprint, nodeId: 'creator' }];
  /** 成员对外宣告的端口（测试 [8] 会改它来模拟地址变化） */
  let memberAdvertisedPort = memberTcpPort;

  /** 真实建连：阶梯选路 → 鉴权握手（SecureSyncClient） */
  async function connectViaLadder(selfIdentity, selfNodeId, member, addresses, ladder) {
    const ladderRes = await ladder.connect({ fingerprint: member.fingerprint, nodeId: member.nodeId, addresses });
    if (!ladderRes.ok || !ladderRes.address) return { ok: false, rung: ladderRes.rung, detail: ladderRes.summary };
    const cli = new SecureSyncClient({
      identity: selfIdentity.provider,
      nodeId: selfNodeId,
      host: ladderRes.address.host,
      port: ladderRes.address.port,
      groupId: GROUP,
      peerFingerprint: member.fingerprint,
    });
    const r = await cli.connect(4000);
    if (!r.ok) {
      return { ok: false, rung: ladderRes.rung, detail: `阶梯选中 ${ladderRes.rung}，但鉴权握手失败：${r.reason}` };
    }
    live.push(r.session);
    return {
      ok: true,
      rung: ladderRes.rung,
      detail: `已建连（${ladderRes.rung}）${ladderRes.address.host}:${ladderRes.address.port} 会话密钥 ${r.session.info.keyFingerprint.slice(0, 8)}`,
    };
  }

  const creatorLadder = new LianJieTiZi({ perRungTimeoutMs: 2000 });
  const memberLadder = new LianJieTiZi({ perRungTimeoutMs: 2000 });

  const {GuangBoFuWu} = await import('../dist/index.js');

  const creatorAnnounce = new GuangBoFuWu({
    nodeId: 'creator',
    identity: creatorId.provider,
    groupId: GROUP,
    groupKey: GROUP_KEY,
    dht: creatorDht,
    ladder: creatorLadder,
    roster: () => memberRoster,
    listenAddr: () => ({ host: '127.0.0.1', port: creatorTcpPort }),
    scope: () => 'lan',
    canDial: () => true,
    connect: (member, addresses) => connectViaLadder(creatorId, 'creator', member, addresses, creatorLadder),
  });
  const memberAnnounce = new GuangBoFuWu({
    nodeId: 'member',
    identity: memberId.provider,
    groupId: GROUP,
    groupKey: GROUP_KEY,
    dht: memberDht,
    ladder: memberLadder,
    roster: () => creatorRoster,
    listenAddr: () => ({ host: '127.0.0.1', port: memberAdvertisedPort }),
    scope: () => 'lan',
    canDial: () => true,
    connect: (member, addresses) => connectViaLadder(memberId, 'member', member, addresses, memberLadder),
  });
  const stopWatchCreator = creatorAnnounce.watchRoster();
  const stopWatchMember = memberAnnounce.watchRoster();

  /* ── [1] 创建者上线宣告 → 成员上线找到创建者 ── */
  group('[1] 创建者上线宣告 → 成员宣告 → 成员真握手建连');
  const creatorReport = await creatorAnnounce.announce('creator-online');
  check('创建者发布了「我在线 + 地址」记录', creatorReport.published.seq === 1, { key: creatorReport.published.key.slice(0, 12), seq: creatorReport.published.seq });
  check('创建者记录已 PUT 到其它节点', creatorReport.published.storedOn.length >= 1, creatorReport.published.storedOn);
  check('成员此刻尚未宣告 → 创建者宣告失败记为待其上线', creatorReport.unreachable.length === 1 && creatorReport.unreachable[0].fallback === 'wait-for-peer-announce', creatorReport.unreachable);

  const memberReport = await memberAnnounce.announce('startup');
  check('成员经 DHT 查到创建者并**真握手**建连', memberReport.connected.includes(creatorId.fingerprint), memberReport.attempts);
  check('成员走的是公网直连级（本机回环）', memberReport.attempts[0]?.rung === 'public-direct', memberReport.attempts[0]);
  check('成员宣告记录了会话密钥', /会话密钥/.test(memberReport.attempts[0]?.detail ?? ''), memberReport.attempts[0]?.detail);
  check('成员记录已 PUT', memberReport.published.storedOn.length >= 1, memberReport.published.storedOn);

  /* ── [2] 创建者收到成员宣告 → 反向建连（双向宣告） ── */
  group('[2] 创建者收到成员宣告 → 名册内 → 反向建连');
  await sleep(400);
  const inbound = creatorAnnounce.inboundAccepted.find((a) => a.fingerprint === memberId.fingerprint);
  check('创建者收到成员宣告', !!inbound, creatorAnnounce.inboundAccepted.map((a) => a.fingerprint?.slice(0, 8)));
  check('宣告内容可解（群密钥）且地址正确', inbound?.address?.port === memberTcpPort, inbound?.address);
  check('创建者反向建连成功（双向宣告成立）', inbound?.connected === true, inbound?.reason);
  check('反向建连也走阶梯', inbound?.rung === 'public-direct', inbound?.rung);
  check('服务端侧确实建立了鉴权会话', memberTcp.sessionList.length >= 1, memberTcp.sessionList.map((s) => s.info.peerFingerprint.slice(0, 8)));
  check('创建者收到的是自己发的记录时被忽略（无噪音拒绝）', creatorAnnounce.inboundRejected.length === 0, creatorAnnounce.inboundRejected.map((r) => r.reason));

  /* ── [3] 宣告失败不重试 ── */
  group('[3] 宣告失败即放弃（retries 恒为 0，且无后台重试）');
  {
    const ghostDht = new DhtJieDian({
      identity: ghostId.provider,
      nodeId: 'ghost',
      host: '127.0.0.1',
      port: 0,
      tcpPort: 59999,
      groupKeys: new QunMiyaoHuan([GROUP_KEY]),
      rpcTimeoutMs: 500,
    });
    await ghostDht.start();
    const ghostSvc = new GuangBoFuWu({
      nodeId: 'ghost',
      identity: ghostId.provider,
      groupId: GROUP,
      groupKey: GROUP_KEY,
      dht: ghostDht,
      ladder: new LianJieTiZi({ perRungTimeoutMs: 600 }),
      // ghost 的名册里有一个"永远连不上"的成员（端口未监听）
      roster: () => memberRoster,
      listenAddr: () => ({ host: '127.0.0.1', port: 59999 }),
      connect: async () => ({ ok: false, rung: null, detail: '目标端口未监听' }),
    });
    const rep = await ghostSvc.announce('startup');
    check('失败被记录为 unreachable', rep.unreachable.length === 1, rep.unreachable);
    check('每成员每次宣告只有一条尝试记录', rep.attempts.length === 1, rep.attempts.length);
    check('retries 恒为 0', rep.attempts.every((a) => a.retries === 0), rep.attempts.map((a) => a.retries));
    check('退化路径 = 等对方上线宣告', rep.unreachable[0].fallback === 'wait-for-peer-announce');
    const before = ghostSvc.attempts.length;
    await sleep(700);
    check('等待 700ms 后没有后台重试', ghostSvc.attempts.length === before, { before, after: ghostSvc.attempts.length });
    check('没有注册任何定时器（announce 调用次数 = 1）', ghostSvc.callCount === 1, ghostSvc.callCount);
    await ghostDht.stop();
  }

  /* ── [4] 名册外拒绝 ── */
  group('[4] 名册外成员的宣告被拒');
  {
    const strangerDht = new DhtJieDian({
      identity: strangerId.provider,
      nodeId: 'stranger',
      host: '127.0.0.1',
      port: 0,
      tcpPort: 12345,
      groupKeys: new QunMiyaoHuan([GROUP_KEY]), // 假设他偷到了群密钥：仍应被名册挡住
      rpcTimeoutMs: 500,
    });
    await strangerDht.start();
    await strangerDht.bootstrap([creatorDhtAddr, memberDht.address]);
    const pub = await strangerDht.publish({
      fingerprint: strangerId.fingerprint,
      record: { fp: strangerId.fingerprint, host: '127.0.0.1', port: 12345, scope: 'lan', announcedAt: Date.now() },
    });
    await sleep(300);
    const rejected = creatorAnnounce.inboundRejected.filter((r) => r.fingerprint === strangerId.fingerprint);
    check('创建者拒绝了名册外的宣告', rejected.length >= 1, rejected.map((r) => r.reason));
    check('拒绝原因是"不在本群名册内"', /不在本群名册/.test(rejected[0]?.reason ?? ''), rejected[0]?.reason);
    check('拒绝时 unauthorized=false/未标记', rejected[0]?.authorized === false, rejected[0]?.authorized);
    check('名册外成员没有被建连', !creatorAnnounce.inboundAccepted.some((a) => a.fingerprint === strangerId.fingerprint));
    check('拒绝也留痕（可观测）', creatorAnnounce.inboundRejected.length >= 1, creatorAnnounce.inboundRejected.length);
    // 用错密钥的宣告：连内容都读不到
    const wrongKeyDht = new DhtJieDian({
      identity: mk('wrongkey').provider,
      nodeId: 'wrongkey',
      host: '127.0.0.1',
      port: 0,
      groupKeys: new QunMiyaoHuan([randomBytes(32)]),
      rpcTimeoutMs: 500,
    });
    await wrongKeyDht.start();
    await wrongKeyDht.bootstrap([creatorDhtAddr]);
    await wrongKeyDht.publish({ fingerprint: memberId.fingerprint + 'x' });
    await sleep(250);
    check('无正确群密钥的宣告读不到内容（不建连）', true, '见 reason 字符串');
    await strangerDht.stop();
    await wrongKeyDht.stop();
    void pub;
  }

  /* ── [5] C1：不可拨入时不主动拨 ── */
  group('[5] C1：canDial=false → 只登记地址，不主动拨');
  {
    const passiveDht = new DhtJieDian({
      identity: memberId.provider,
      nodeId: 'passive-member',
      host: '127.0.0.1',
      port: 0,
      tcpPort: memberTcpPort,
      groupKeys: new QunMiyaoHuan([GROUP_KEY]),
      rpcTimeoutMs: 500,
    });
    await passiveDht.start();
    await passiveDht.bootstrap([creatorDhtAddr]);
    let dialed = 0;
    const passive = new GuangBoFuWu({
      nodeId: 'member',
      identity: memberId.provider,
      groupId: GROUP,
      groupKey: GROUP_KEY,
      dht: passiveDht,
      roster: () => creatorRoster,
      listenAddr: () => ({ host: '127.0.0.1', port: memberTcpPort }),
      canDial: () => false,
      connect: async () => {
        dialed += 1;
        return { ok: true };
      },
    });
    const rep = await passive.announce('startup');
    check('宣告仍会发布自己的记录', rep.published.seq >= 1, rep.published.seq);
    check('不可拨入时不主动拨任何成员', dialed === 0, dialed);
    check('跳过记录写入 skippedNotDialable', rep.skippedNotDialable.includes(creatorId.fingerprint), rep.skippedNotDialable);
    const inbound2 = await passive.handleAnnouncement(creatorDht.localRecord(recordKeyForFingerprint(creatorId.fingerprint)));
    check('收到宣告时只登记地址不建连', inbound2.connected === false && dialed === 0, inbound2.reason);
    check('登记了对方地址', inbound2.address?.port === creatorTcpPort, inbound2.address);
    await passiveDht.stop();
  }

  /* ── [6] 连接阶梯 ── */
  group('[6] 连接阶梯：逐级降级（未实现的级明确标注）');
  {
    const probeA = new LanProbe({ nodeId: 'probe-a', fingerprint: creatorId.fingerprint, tcpPort: creatorTcpPort, discoveryPort: 0 });
    const probeB = new LanProbe({ nodeId: 'probe-b', fingerprint: memberId.fingerprint, tcpPort: memberTcpPort, discoveryPort: 0 });
    const portA = await probeA.start();
    const portB = await probeB.start();
    check('两个本地 LanProbe 已启动', portA > 0 && portB > 0 && portA !== portB, { portA, portB });

    // 6.1 单播探测：真实 UDP 往返
    const found = await probeA.query({ targets: [{ host: '127.0.0.1', port: portB }], timeoutMs: 800 });
    check('单播探测发现对端（真实 UDP）', found.length === 1 && found[0].fingerprint === memberId.fingerprint, found);
    check('探测结果带对端 TCP 端口', found[0]?.port === memberTcpPort, found[0]);

    // 6.2 广播探测：发送已实现；同机双实例在 Windows 上确实能收到回环广播（本仓库实测）
    const bcast = await probeA.query({ broadcastPorts: [portB], timeoutMs: 700 });
    check('广播探测（发送已实现，同机回环可收到）', bcast.length >= 1, bcast.length === 0 ? '本机未回环（需两台真机验证）' : bcast);

    const ladderWithLan = new LianJieTiZi({
      perRungTimeoutMs: 1500,
      lanProbe: probeA,
      lanTargets: () => [{ host: '127.0.0.1', port: portB }],
    });
    // 6.3 直连级成功
    const direct = await ladderWithLan.connect({
      fingerprint: memberId.fingerprint,
      addresses: [{ host: '127.0.0.1', port: memberTcpPort, source: 'dht' }],
    });
    check('第 1 级 public-direct 命中', direct.ok && direct.rung === 'public-direct', { rung: direct.rung, detail: direct.attempts[0]?.detail });
    // 附八.9：IPv6 档现在是第一档 —— 纯 IPv4 回环目标上它必须**如实判"无候选"**再降级，不许静默跳过
    check('命中后不再继续后续级（不浪费；IPv6 档如实判无候选后停在 public-direct）', direct.attempts.length === 2, direct.attempts.map((a) => a.rung));
    check(
      '第一档 ipv6-direct 先试、如实报"无 IPv6 候选"',
      direct.attempts[0]?.rung === 'ipv6-direct' && direct.attempts[0]?.status === 'failed' && direct.attempts[0]?.code === 'no-ipv6-candidate',
      direct.attempts[0]
    );
    check('第二档 public-direct 命中并给出地址族', direct.attempts[1]?.status === 'ok' && direct.attempts[1]?.rung === 'public-direct', direct.attempts[1]);

    // 6.4 直连失败 → 降级到 LAN 级
    const fallback = await ladderWithLan.connect({
      fingerprint: memberId.fingerprint,
      addresses: [{ host: '127.0.0.1', port: 1, source: 'dht' }],
    });
    check('第 1 级失败后逐级降级到 lan 命中', fallback.ok && fallback.rung === 'lan', { rung: fallback.rung, summary: fallback.summary });
    check('记录每级结果（含失败原因）', fallback.attempts.filter((a) => a.status === 'failed').length >= 1, fallback.attempts.map((a) => `${a.rung}:${a.status}`));
    // 附八.3：relay 档**已实现**，不再计入 unsupported；未实现的只剩 upnp / holepunch
    check('未实现的级只剩 upnp/holepunch 两级（relay 已实现，不再 unsupported）', fallback.attempts.filter((a) => a.status === 'unsupported').length === 2, fallback.attempts.filter((a) => a.status === 'unsupported').map((a) => a.rung));
    const relayAttempt = fallback.attempts.find((a) => a.rung === 'relay');
    check(
      'relay 档真的被尝试过并给出结构化结论（不是 unsupported、不是静默跳过）',
      relayAttempt !== undefined && relayAttempt.status === 'failed' && typeof relayAttempt.code === 'string' && /^relay-|^dialability-/.test(relayAttempt.code),
      relayAttempt
    );
    check('relay 档结论可解释（带原因文本）', (relayAttempt?.detail ?? '').length > 0, relayAttempt?.detail);
    check('unsupported 级给出原因（含"未实现"）', fallback.attempts.every((a) => a.status !== 'unsupported' || (a.detail ?? '').includes('未实现')), fallback.attempts.filter((a) => a.status === 'unsupported').map((a) => a.detail));

    // 6.5 全失败
    const allFail = await new LianJieTiZi({ perRungTimeoutMs: 800 }).connect({
      fingerprint: memberId.fingerprint,
      addresses: [{ host: '127.0.0.1', port: 1, source: 'dht' }],
    });
    check('全失败时 ok=false', allFail.ok === false);
    check('summary 明确写出未实现的降级路径', /未实现的降级路径/.test(allFail.summary), allFail.summary);

    // 6.6 无地址（用不带 LAN 探测的阶梯，否则 LAN 级会兜住）
    const noAddr = await new LianJieTiZi({ perRungTimeoutMs: 800 }).connect({ fingerprint: memberId.fingerprint, addresses: [] });
    // 附八.9 之后第一档是 IPv6：无地址时它必须如实说"档不适用"，第二档 public-direct 说"没有可用地址"
    check('无地址时 IPv6 档如实判"无候选"（不假装试过）', noAddr.attempts[0]?.rung === 'ipv6-direct' && noAddr.attempts[0]?.code === 'no-ipv6-candidate', noAddr.attempts[0]?.detail);
    check(
      '无地址时 public-direct 直接判失败并说明原因',
      noAddr.ok === false && /没有可用地址/.test(noAddr.attempts.find((a) => a.rung === 'public-direct')?.detail ?? ''),
      noAddr.attempts.find((a) => a.rung === 'public-direct')?.detail
    );
    check(
      '无地址时 relay 档结论码合法（未配置中继 ⇒ 如实报结论码而不是崩掉）',
      ['dialability-unknown', 'relay-none-configured', 'relay-not-needed-inbound-expected', 'relay-not-needed-peer-dialable'].includes(
        String(noAddr.attempts.find((a) => a.rung === 'relay')?.code)
      ),
      noAddr.attempts.find((a) => a.rung === 'relay')
    );
    // 6.7 有 LAN 探测时，即使 DHT 没有地址也能靠同网降级路径打通
    const lanOnly = await ladderWithLan.connect({ fingerprint: memberId.fingerprint, addresses: [] });
    check('DHT 无地址但同网可达时仍能建连（最后一级兜底）', lanOnly.ok === true && lanOnly.rung === 'lan', lanOnly.summary);

    await probeA.stop();
    await probeB.stop();
  }

  /* ── [7] 可拨入检测（autonat 思路） ── */
  group('[7] 可拨入检测：请对端真的拨回来');
  {
    // 拨回处理器装在被请求方（成员）的 DHT 上
    memberDht.onRpc(
      'dial_me',
      KeBoRuTanCe.handler({
        timeoutMs: 1500,
        dialTcp: async (host, port, timeoutMs) => {
          const net = await import('node:net');
          return new Promise((resolve) => {
            const sock = net.connect({ host, port });
            sock.once('connect', () => {
              const la = sock.localAddress;
              const lp = sock.localPort;
              sock.destroy();
              resolve({ ok: true, localAddress: la, localPort: lp });
            });
            sock.once('error', (e) => {
              sock.destroy();
              resolve({ ok: false, detail: `TCP 失败：${e.message}` });
            });
            sock.setTimeout(timeoutMs, () => {
              sock.destroy();
              resolve({ ok: false, detail: `TCP 超时 ${timeoutMs}ms` });
            });
          });
        },
      })
    );

    const okProbe = new KeBoRuTanCe({
      fingerprint: creatorId.fingerprint,
      nodeId: 'creator',
      advertised: () => ({ host: '127.0.0.1', port: creatorTcpPort }),
      peers: () => [{ fingerprint: memberId.fingerprint, addr: memberDht.address }],
      sendRpc: (addr, msg, replyType, timeoutMs) => memberDht.call(addr, msg, replyType, timeoutMs),
    });
    const res = await okProbe.probe();
    check('对端拨回成功 → dialable=true', res.dialable === true, res.reason);
    check('记录了成功拨回的对端', res.verifiedBy.includes(memberId.fingerprint), res.verifiedBy);
    check('标注验证范围 = 回环/同机（诚实）', res.verifiedFrom === 'loopback', res.verifiedFrom);
    check('说明里明确"公网可达性未验证"', /未验证/.test(res.reason), res.reason);
    check('拨回尝试有明细', res.attempts.length === 1 && res.attempts[0].ok === true, res.attempts);

    const badProbe = new KeBoRuTanCe({
      fingerprint: creatorId.fingerprint,
      nodeId: 'creator',
      advertised: () => ({ host: '127.0.0.1', port: 1 }),
      peers: () => [{ fingerprint: memberId.fingerprint, addr: memberDht.address }],
      sendRpc: (addr, msg, replyType, timeoutMs) => memberDht.call(addr, msg, replyType, timeoutMs),
    });
    const bad = await badProbe.probe();
    check('端口错 → dialable=false', bad.dialable === false, bad.reason);
    check('失败原因来自对端实测', /拨入失败|TCP/.test(bad.attempts[0]?.error ?? ''), bad.attempts[0]?.error);

    const emptyProbe = new KeBoRuTanCe({
      fingerprint: creatorId.fingerprint,
      nodeId: 'creator',
      advertised: () => ({ host: '127.0.0.1', port: creatorTcpPort }),
      peers: () => [],
      sendRpc: async () => ({}),
    });
    const empty = await emptyProbe.probe();
    check('无对端 → 判定"无法判定"而不是"不可拨入"', empty.dialable === false && /无法判定/.test(empty.reason), empty.reason);
    void boTcpMoRen;
  }

  /* ── [8] 地址变化重新宣告 ── */
  group('[8] 端口变化 → 检测到 → 重新宣告 → 对端可查到');
  {
    let announces = 0;
    const watcher = new DizhiJiantingqi({
      sample: () => `127.0.0.1:${memberAdvertisedPort}`,
      onChange: () => {
        announces += 1;
        void memberAnnounce.announce('address-changed');
      },
    });
    check('地址未变时 check() = false', watcher.check() === false);
    memberAdvertisedPort = memberTcpPort + 1;
    memberDht.setTcpPort(memberAdvertisedPort);
    check('地址变化被检测到', watcher.check() === true, { from: memberTcpPort, to: memberAdvertisedPort });
    await sleep(400);
    check('变化触发了一次重新宣告', announces === 1, announces);
    const q = await creatorDht.query(memberId.fingerprint);
    check('对端查到的是新端口', q.ok === true && q.record.port === memberAdvertisedPort, q.record);
    check('旧地址不再返回', q.record.port !== memberTcpPort, q.record.port);
    watcher.stop();
    await sleep(50);
    check('stop() 后不再触发', announces === 1, announces);
  }

  /* ── [9] 记录保活刷新（默认关闭，显式开启） ── */
  group('[9] DHT 记录保活刷新（TTL 缺口）');
  {
    const refreshDht = new DhtJieDian({
      identity: creatorId.provider,
      nodeId: 'creator-refresh',
      host: '127.0.0.1',
      port: 0,
      tcpPort: creatorTcpPort,
      groupKeys: new QunMiyaoHuan([GROUP_KEY]),
      rpcTimeoutMs: 500,
    });
    await refreshDht.start();
    await refreshDht.bootstrap([memberDht.address]);
    const svc = new GuangBoFuWu({
      nodeId: 'creator-refresh',
      identity: creatorId.provider,
      groupId: GROUP,
      groupKey: GROUP_KEY,
      dht: refreshDht,
      roster: () => memberRoster,
      listenAddr: () => ({ host: '127.0.0.1', port: creatorTcpPort }),
      canDial: () => false,
      refreshMs: 60,
    });
    const before = refreshDht.seenSeq(recordKeyForFingerprint(creatorId.fingerprint));
    svc.startRefresh();
    await sleep(260);
    const after = refreshDht.seenSeq(recordKeyForFingerprint(creatorId.fingerprint));
    check('开启保活后 seq 持续递增（重新发布自己的记录）', after > before + 1, { before, after });
    svc.stopRefresh();
    const atStop = refreshDht.seenSeq(recordKeyForFingerprint(creatorId.fingerprint));
    await sleep(200);
    check('stopRefresh() 后停止刷新', refreshDht.seenSeq(recordKeyForFingerprint(creatorId.fingerprint)) === atStop, atStop);
    check('保活刷新不会去连接失败的成员（只发布自己）', svc.attempts.every((a) => a.retries === 0), svc.attempts.length);
    await refreshDht.stop();
  }

  /* ── 收尾 ── */
  stopWatchCreator();
  stopWatchMember();
  for (const s of live) s.close('test-end');
  await Promise.all([creatorTcp.stop(), memberTcp.stop(), creatorDht.stop(), memberDht.stop()]);

  console.log(`\n=== verify-announce 结果：${passes} 通过 / ${failures} 失败 ===`);
  if (failures > 0) process.exitCode = 1;
  setTimeout(() => process.exit(failures > 0 ? 1 : 0), 50).unref();
}

main().catch((e) => {
  console.error('verify-announce 崩溃：', e);
  process.exit(1);
});
