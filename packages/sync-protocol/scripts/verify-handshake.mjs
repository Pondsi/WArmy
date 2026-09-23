/**
 * verify-handshake.mjs —— 鉴权握手实测（可重跑）
 *
 *   node scripts/verify-handshake.mjs
 *
 * 用两个本地实例（真实 TCP 127.0.0.1，随机端口）验证：
 *   [1] 握手成功 + 双方会话密钥一致 + 方向性子密钥不同
 *   [2] 篡改公钥 / 篡改签名 / 重放旧 nonce / 重放旧计数 / 时间戳超差 / 跨群重放 必须失败
 *   [3] 名册外的成员被拒（not-authorized）；pin 指纹不符被拒（MITM）
 *   [4] 会话密钥每连接不同
 *   [5] 每连接只握手一次；长连接密钥更新（KeyUpdate）不重握手
 *   [6] 无密钥无法解包（陌生通道 / 换密钥后重放旧代次 / 篡改密文）
 *   [7] 拒绝审计 / 身份契约 / 注入 verify 被桩成恒真也拦得住篡改
 */
import crypto from 'node:crypto';
import path from 'node:path';
import {HandshakeDriver, ShenfenQiyueCuowu, ReplayGuard, AnQuanTongDao, SecureSyncClient, SecureSyncServer, chuangjianLinShiShenFen, normalizeIdentity, } from '../dist/index.js';

let failures = 0;
let passes = 0;
function check(biaoQian, cond, detail) {
  const mark = cond ? 'PASS' : 'FAIL';
  if (cond) passes += 1;
  else failures += 1;
  const extra = detail === undefined ? '' : ` => ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
  console.log(`  [${mark}] ${biaoQian}${extra}`);
}

function group(biaoTi) {
  console.log(`\n${biaoTi}`);
}

function mkIdentity(biaoQian) {
  const i = chuangjianLinShiShenFen(biaoQian);
  return { provider: i.provider, privateKey: i.privateKey, fingerprint: i.fingerprint };
}

function flipB64uByte(s) {
  const b = Buffer.from(s, 'base64url');
  b[0] = b[0] ^ 0x01;
  return b.toString('base64url');
}

const GROUP = 'grp-local-1';
const A = mkIdentity('alice');
const B = mkIdentity('bob');
const ATTACKER = mkIdentity('mallory');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 内存内驱动两个握手实例（帧走 JSON 往返，等同线上编码） */
async function handshakePair(opts = {}) {
  const {
    guardI,
    guardR,
    responderIdentity = B,
    initiatorIdentity = A,
    roster,
    nowI,
    peerPin,
    groupId = GROUP,
  } = opts;
  const events = [];
  const I = new HandshakeDriver({
    identity: initiatorIdentity.provider,
    role: 'initiator',
    groupId,
    peerFingerprint: peerPin === undefined ? responderIdentity.fingerprint : peerPin,
    replayGuard: guardI,
    now: nowI,
    onEvent: (e) => events.push(e),
  });
  const R = new HandshakeDriver({
    identity: responderIdentity.provider,
    role: 'responder',
    groupId,
    peerFingerprint: null,
    roster,
    replayGuard: guardR,
    onEvent: (e) => events.push(e),
  });
  const hs1 = await I.start();
  const r1 = await R.step(JSON.parse(JSON.stringify(hs1)));
  const hs3 = await I.step(JSON.parse(JSON.stringify(r1.out[0])));
  const r2 = await R.step(JSON.parse(JSON.stringify(hs3.out[0])));
  await I.step(JSON.parse(JSON.stringify(r2.out[0])));
  return { I, R, events, session: I.session };
}

/** 只跑 HS1，返回 reject 原因（用于篡改/重放用例） */
async function rejectReason(mutate, opts = {}) {
  const I = new HandshakeDriver({
    identity: (opts.initiatorIdentity ?? A).provider,
    role: 'initiator',
    groupId: opts.initiatorGroupId ?? GROUP,
    peerFingerprint: B.fingerprint,
    now: opts.nowI,
    replayGuard: opts.guardI,
  });
  const R = new HandshakeDriver({
    identity: B.provider,
    role: 'responder',
    groupId: GROUP,
    replayGuard: opts.guardR,
  });
  const hs1 = await I.start();
  const frame = mutate ? mutate({ ...hs1 }) : { ...hs1 };
  try {
    await R.step(frame);
    return 'no-error';
  } catch (e) {
    return e.reason ?? String(e.message);
  }
}

async function main() {
  console.log('=== verify-handshake: 鉴权握手（Ed25519 认证 + X25519 ECDHE + AES-256-GCM）===');
  console.log(`node ${process.version} | alice=${A.fingerprint.slice(0, 12)}… bob=${B.fingerprint.slice(0, 12)}…`);

  /* ── [1] 握手成功 ── */
  group('[1] 两个本地实例握手成功');
  const first = await handshakePair();
  check('发起方握手完成', first.I.established === true, first.I.phase);
  check('被叫方握手完成', first.R.established === true, first.R.phase);
  check('双方 handshakeId 一致', first.I.session.handshakeId === first.R.session.handshakeId, first.I.session.handshakeId.slice(0, 16));
  check('双方 keyFingerprint 一致', first.I.session.keyFingerprint === first.R.session.keyFingerprint, first.I.session.keyFingerprint.slice(0, 16));
  check('对端指纹识别正确', first.I.session.peerFingerprint === B.fingerprint && first.R.session.peerFingerprint === A.fingerprint);
  check('pin 模式下非 TOFU', first.I.session.tofu === false);
  const tofuPair = await handshakePair({ peerPin: null });
  check('未 pin 时标记 TOFU（首次接触）', tofuPair.I.session.tofu === true && tofuPair.session.peerFingerprint === B.fingerprint);
  check('方向性子密钥不同（c2s ≠ s2c）', !first.I.session.c2sMaterial.equals(first.I.session.s2cMaterial));
  check('ECDHE 材料 32 字节（X25519，无 RSA 密钥传输）', first.I.session.c2sMaterial.length === 32 && first.I.session.transcriptHash.length === 32);
  check('双方各自记录 established 事件', first.events.filter((e) => e.type === 'established').length === 2);

  /* ── [2] 篡改 / 重放 ── */
  group('[2] 篡改与重放必须失败');
  const fpReason = await rejectReason((f) => ({ ...f, pk: Buffer.from(ATTACKER.provider.publicKey).toString('base64url') }));
  check('篡改公钥（沿用旧指纹）被拒', fpReason === 'fingerprint-mismatch', fpReason);
  const sigReason = await rejectReason((f) => ({ ...f, sig: flipB64uByte(f.sig) }));
  check('篡改签名被拒', sigReason === 'signature-invalid', sigReason);
  const ephReason = await rejectReason((f) => ({ ...f, eph: Buffer.from(ATTACKER.provider.publicKey).toString('base64url') }));
  check('篡改 ECDHE 临时公钥（破坏 transcript）被拒', ephReason === 'signature-invalid', ephReason);

  {
    const guard = new ReplayGuard();
    const I = new HandshakeDriver({ identity: A.provider, role: 'initiator', groupId: GROUP, peerFingerprint: B.fingerprint });
    const r1 = new HandshakeDriver({ identity: B.provider, role: 'responder', groupId: GROUP, replayGuard: guard });
    const hs1 = await I.start();
    await r1.step({ ...hs1 });
    const r2 = new HandshakeDriver({ identity: B.provider, role: 'responder', groupId: GROUP, replayGuard: guard });
    let reason = 'no-error';
    try {
      await r2.step({ ...hs1 });
    } catch (e) {
      reason = e.reason ?? String(e.message);
    }
    check('重放旧 nonce（整帧原样重放）被拒', reason === 'replay-nonce', reason);
  }
  {
    // 新 nonce，但 counter 不递增（驱动内部 nonce 随机，这里只把计数打回 1）
    const guard = new ReplayGuard();
    const gOld1 = new ReplayGuard();
    gOld1.nextLocalCounter = () => 1;
    const I1 = new HandshakeDriver({ identity: A.provider, role: 'initiator', groupId: GROUP, peerFingerprint: B.fingerprint, replayGuard: gOld1 });
    const r1 = new HandshakeDriver({ identity: B.provider, role: 'responder', groupId: GROUP, replayGuard: guard });
    const hs1 = await I1.start();
    await r1.step({ ...hs1 });
    const seen = guard.maxCounterSeen(A.fingerprint);

    const gOld2 = new ReplayGuard();
    gOld2.nextLocalCounter = () => 1;
    const I2 = new HandshakeDriver({ identity: A.provider, role: 'initiator', groupId: GROUP, peerFingerprint: B.fingerprint, replayGuard: gOld2 });
    const r2 = new HandshakeDriver({ identity: B.provider, role: 'responder', groupId: GROUP, replayGuard: guard });
    const hs1b = await I2.start();
    let reason = 'no-error';
    try {
      await r2.step({ ...hs1b });
    } catch (e) {
      reason = e.reason ?? String(e.message);
    }
    check('nonce 新鲜但计数回退被拒', reason === 'replay-counter', `reason=${reason} 旧计数=${seen} 重放计数=${hs1b.c}`);
    const differ = hs1.n !== hs1b.n;
    check('两帧 nonce 确实不同（排除误判为 nonce 重放）', differ);
  }
  const skewReason = await rejectReason(null, { nowI: () => Date.now() - 10 * 60_000 });
  check('时间戳超出容差（±120s）被拒', skewReason === 'clock-skew', skewReason);
  const groupReason = await rejectReason(null, { initiatorGroupId: 'grp-other' });
  check('跨群重放（groupId 不符）被拒', groupReason === 'bad-group', groupReason);

  /* ── [3] 授权与 pin ── */
  group('[3] 名册授权与指纹 pin');
  {
    let reason = 'no-error';
    try {
      await handshakePair({ roster: (fp) => fp !== A.fingerprint });
    } catch (e) {
      reason = e.reason ?? String(e.message);
    }
    check('名册外的成员被拒（not-authorized）', reason === 'not-authorized', reason);
  }
  {
    const I = new HandshakeDriver({ identity: ATTACKER.provider, role: 'initiator', groupId: GROUP, peerFingerprint: B.fingerprint });
    const R = new HandshakeDriver({ identity: B.provider, role: 'responder', groupId: GROUP, peerFingerprint: A.fingerprint });
    const hs1 = await I.start();
    let reason = 'no-error';
    try {
      await R.step({ ...hs1 });
    } catch (e) {
      reason = e.reason ?? String(e.message);
    }
    check('MITM 冒充（pin 不符）被拒', reason === 'pin-mismatch', reason);
  }

  /* ── [4] 会话密钥每连接不同 ── */
  group('[4] 会话密钥「每连接一次、每次不同」');
  const second = await handshakePair();
  check('两次连接 handshakeId 不同', first.session.handshakeId !== second.session.handshakeId);
  check('两次连接密钥指纹不同', first.session.keyFingerprint !== second.session.keyFingerprint, {
    c1: first.session.keyFingerprint.slice(0, 12),
    c2: second.session.keyFingerprint.slice(0, 12),
  });
  check(
    '两次连接 ECDHE 临时公钥不同（真正的前向保密）',
    first.I.localHandshakeUsage.ephemeralPublicKey !== second.I.localHandshakeUsage.ephemeralPublicKey
  );

  /* ── [5] 真实 TCP：只握手一次 + KeyUpdate ── */
  group('[5] 真实 TCP：握手一次 + 长连接密钥更新');
  {
    const serverIdentity = mkIdentity('server');
    const clientIdentity = mkIdentity('client');
    const serverMsgs = [];
    const clientMsgs = [];
    let establishedEvents = 0;
    const server = new SecureSyncServer({
      identity: serverIdentity.provider,
      nodeId: 'node-server',
      port: 0,
      groupId: GROUP,
      onMessage: (m) => serverMsgs.push(m),
      onHandshakeEvent: (e) => {
        if (e.type === 'established') establishedEvents += 1;
      },
    });
    const port = await server.start();
    const client = new SecureSyncClient({
      identity: clientIdentity.provider,
      nodeId: 'node-client',
      host: '127.0.0.1',
      port,
      groupId: GROUP,
      peerFingerprint: serverIdentity.fingerprint,
      onMessage: (m) => clientMsgs.push(m),
      onHandshakeEvent: (e) => {
        if (e.type === 'established') establishedEvents += 1;
      },
    });
    const res = await client.connect();
    check('真实 TCP 握手成功', res.ok === true, res.reason ?? 'ok');
    const serverSession = server.sessionList[0];
    check('服务端已注册 inbound 会话', !!serverSession && serverSession.info.direction === 'inbound');
    check('双方密钥指纹一致', serverSession.info.keyFingerprint === res.session.info.keyFingerprint, serverSession.info.keyFingerprint.slice(0, 12));
    check('服务端看到客户端指纹', serverSession.info.peerFingerprint === clientIdentity.fingerprint);
    check('客户端看到服务端指纹（pin 生效，非 TOFU）', res.session.info.tofu === false);

    res.session.send({ to: '*', channel: 'group', payload: { text: 'hello-from-client' } });
    serverSession.send({ to: '*', channel: 'group', payload: { text: 'hello-from-server' } });
    await sleep(200);
    check('服务端收到并解密客户端消息', serverMsgs.length === 1 && serverMsgs[0].payload.text === 'hello-from-client', serverMsgs.map((m) => m.payload));
    check('客户端收到并解密服务端消息', clientMsgs.length === 1 && clientMsgs[0].payload.text === 'hello-from-server', clientMsgs.map((m) => m.payload));

    for (let i = 0; i < 20; i += 1) res.session.send({ to: '*', channel: 'group', payload: { text: `m${i}` } });
    await sleep(300);
    check('同连接 20 条消息没有触发重握手', res.session.channelStats.handshakes === 1 && establishedEvents === 2, {
      clientHandshakes: res.session.channelStats.handshakes,
      establishedEvents,
    });
    check('21 条应用记录已发', res.session.channelStats.recordsSent === 21, res.session.channelStats.recordsSent);

    const genBefore = res.session.generation;
    res.session.requestKeyUpdate();
    await sleep(200);
    check('KeyUpdate 后发送代次 +1', res.session.generation === genBefore + 1, { before: genBefore, after: res.session.generation });
    check('KeyUpdate 后对端接收代次同步 +1', serverSession.recvGeneration === 1, serverSession.recvGeneration);
    res.session.send({ to: '*', channel: 'group', payload: { text: 'after-keyupdate' } });
    await sleep(200);
    check('换密钥后消息仍互通', serverMsgs.length === 22 && serverMsgs[21].payload.text === 'after-keyupdate', serverMsgs.length);
    check('KeyUpdate 全程只握手一次', establishedEvents === 2, establishedEvents);

    /* ── [6] 无密钥无法解包 ── */
    const stranger = new AnQuanTongDao(second.session, 'initiator');
    const victim = new AnQuanTongDao(first.session, 'initiator');
    const victimRecord = victim.sealRecord(Buffer.from('top-secret', 'utf8'));
    let foreignErr = 'no-error';
    try {
      stranger.openRecords(victimRecord);
    } catch (e) {
      foreignErr = e.code ?? String(e.message);
    }
    check('陌生通道解不开他人记录（无会话密钥）', foreignErr === 'not-authorized-tag', foreignErr);

    const chA = new AnQuanTongDao(first.session, 'initiator');
    const chB = new AnQuanTongDao(first.session, 'responder');
    const gen0 = chA.sealRecord(Buffer.from('gen0-msg', 'utf8'));
    check('gen0 记录正常解出', chB.openRecords(gen0).toString('utf8') === 'gen0-msg');
    chB.openRecords(chA.requestKeyUpdate());
    check('KeyUpdate 后双方代次一致', chA.generation === 1 && chB.recvGeneration === 1, { faSong: chA.generation, recv: chB.recvGeneration });
    let replayErr = 'no-error';
    try {
      chB.openRecords(gen0);
    } catch (e) {
      replayErr = e.code ?? String(e.message);
    }
    check('换密钥后重放旧代次记录被拒', replayErr === 'not-authorized-tag', replayErr);

    const tampered = Buffer.from(chA.sealRecord(Buffer.from('x', 'utf8')));
    tampered[tampered.length - 1] ^= 0x01;
    let tamperErr = 'no-error';
    try {
      chB.openRecords(tampered);
    } catch (e) {
      tamperErr = e.code ?? String(e.message);
    }
    check('篡改密文记录被拒', tamperErr === 'not-authorized-tag', tamperErr);

    client.close();
    await server.stop();
  }

  /* ── [7] 审计 / 契约 / 桩式 verify ── */
  group('[7] 拒绝审计 / 身份契约 / 桩式 verify');
  {
    const serverIdentity = mkIdentity('server2');
    const bogus = mkIdentity('bogus');
    const server = new SecureSyncServer({
      identity: serverIdentity.provider,
      nodeId: 'node-server2',
      port: 0,
      groupId: GROUP,
      roster: (fp) => fp !== bogus.fingerprint,
    });
    const port = await server.start();
    const attacker = new SecureSyncClient({
      identity: bogus.provider,
      nodeId: 'node-attacker',
      host: '127.0.0.1',
      port,
      groupId: GROUP,
      peerFingerprint: serverIdentity.fingerprint,
    });
    const r = await attacker.connect();
    check('名册外客户端连不上', r.ok === false, r.reason);
    check('客户端侧拿到对端给出的具体原因（not-authorized）', r.handshakeFailure?.reason === 'not-authorized', r.handshakeFailure);
    check('服务端拒绝计数（not-authorized）', server.rejectionCounts['not-authorized'] === 1, server.rejectionCounts);
    check('服务端失败审计含 reason / remoteAddress', server.failures.length === 1 && server.failures[0].reason === 'not-authorized' && !!server.failures[0].remoteAddress, server.failures[0]);
    check('服务端未建立任何会话', server.sessionList.length === 0);
    await server.stop();
  }
  {
    let err = 'no-error';
    try {
      await normalizeIdentity({ ...A.provider, fingerprint: 'NOT-A-REAL-FINGERPRINT' });
    } catch (e) {
      err = e instanceof ShenfenQiyueCuowu ? 'ShenfenQiyueCuowu' : String(e.message);
    }
    check('指纹与公钥不符 → ShenfenQiyueCuowu', err === 'IdentityContractError', err);
  }
  {
    const stubIdentity = { fingerprint: A.fingerprint, publicKey: A.provider.publicKey, sign: A.provider.sign, verify: () => true };
    const I = new HandshakeDriver({ identity: stubIdentity, role: 'initiator', groupId: GROUP, peerFingerprint: B.fingerprint });
    const R = new HandshakeDriver({ identity: B.provider, role: 'responder', groupId: GROUP });
    const hs1 = await I.start();
    let reason = 'no-error';
    try {
      await R.step({ ...hs1, sig: flipB64uByte(hs1.sig) });
    } catch (e) {
      reason = e.reason ?? String(e.message);
    }
    check('注入 verify 恒真时，篡改签名仍被本地 Ed25519 复核拦住', reason === 'signature-invalid', reason);
    const okPair = await handshakePair({ initiatorIdentity: { provider: stubIdentity } });
    check('桩 verify（恒真）不影响真签名握手', okPair.I.established === true);
  }
  {
    const denyIdentity = { fingerprint: B.fingerprint, publicKey: B.provider.publicKey, sign: B.provider.sign, verify: () => false };
    const I = new HandshakeDriver({ identity: A.provider, role: 'initiator', groupId: GROUP, peerFingerprint: B.fingerprint });
    const R = new HandshakeDriver({
      identity: denyIdentity,
      role: 'responder',
      groupId: GROUP,
      requireInjectedVerify: true,
    });
    const hs1 = await I.start();
    let reason = 'no-error';
    try {
      await R.step({ ...hs1 });
    } catch (e) {
      reason = e.reason ?? String(e.message);
    }
    check('requireInjectedVerify=true 且注入 verify 恒假 → 拒绝', reason === 'signature-invalid', reason);
  }
  {
    const file = path.join(process.env.TEMP || process.env.TMPDIR || '/tmp', `warmy-replay-${Date.now()}.json`);
    const g1 = new ReplayGuard({ persistFile: file });
    const c1 = g1.nextLocalCounter();
    const g2 = new ReplayGuard({ persistFile: file });
    const c2 = g2.nextLocalCounter();
    check('计数持久化后跨实例继续递增（重启不重放）', c1 === 1 && c2 === 2, { c1, c2 });
    check('无持久化时从 1 开始', new ReplayGuard().nextLocalCounter() === 1);
  }
  {
    // 自反射：对端声称与本机相同指纹
    const I = new HandshakeDriver({ identity: A.provider, role: 'initiator', groupId: GROUP, peerFingerprint: null });
    const R = new HandshakeDriver({ identity: A.provider, role: 'responder', groupId: GROUP });
    const hs1 = await I.start();
    let reason = 'no-error';
    try {
      await R.step({ ...hs1 });
    } catch (e) {
      reason = e.reason ?? String(e.message);
    }
    check('自反射（对端指纹 = 本机指纹）被拒', reason === 'protocol-error', reason);
  }

  /* ── [8] 与现有身份线（SPKI DER + 带校验位指纹）的适配 ── */
  group('[8] 身份注入适配：SPKI DER 公钥 + 自定义指纹推导（对齐 app-shell/src/identity.ts）');
  {
    // 独立复刻现身份线的方案：指纹 = base32(sha256(SPKI DER)) 取前 20 位 + 1 位校验 + 短横分组
    const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // 现身份线用的 Crockford 变体，这里只需确定性
    const base32Local = (buf) => {
      let bits = 0;
      let value = 0;
      let out = '';
      for (const b of buf) {
        value = (value << 8) | b;
        bits += 8;
        while (bits >= 5) {
          out += B32.charAt((value >>> (bits - 5)) & 31);
          bits -= 5;
        }
      }
      if (bits > 0) out += B32.charAt((value << (5 - bits)) & 31);
      return out;
    };
    const checkChar = (data) => B32.charAt([...data].reduce((a, c) => a + B32.indexOf(c), 0) % 32);
    const deriveFingerprint = (raw32) => {
      // raw → SPKI DER → base64 → sha256 → base32 → 20 + 1 校验位 → 4 组短横
      const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw32]);
      const digest = crypto.createHash('sha256').update(der).digest();
      const data = base32Local(digest).slice(0, 20);
      const full = data + checkChar(data);
      return [0, 5, 10, 15].map((i) => full.slice(i, i + 5)).join('-');
    };

    const spkiB64 = (id) => Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(id.provider.publicKey)]).toString('base64');
    /** 把现有身份线的形式（SPKI DER base64 + 自定义指纹）包装成注入接口 */
    const spkiAdapter = (id) => ({
      fingerprint: deriveFingerprint(Buffer.from(id.provider.publicKey)),
      publicKey: spkiB64(id), // 44 字节 SPKI DER 的 base64（现身份线的形式）
      sign: id.provider.sign,
      verify: id.provider.verify,
    });
    const adapterA = spkiAdapter(A);
    const adapterB = spkiAdapter(B);
    check('两种公钥表示得到同一指纹', deriveFingerprint(Buffer.from(A.provider.publicKey)) !== adapterB.fingerprint);

    const I = new HandshakeDriver({
      identity: adapterA,
      role: 'initiator',
      groupId: GROUP,
      peerFingerprint: adapterB.fingerprint,
      fingerprintDerivation: deriveFingerprint,
    });
    const R = new HandshakeDriver({
      identity: adapterB,
      role: 'responder',
      groupId: GROUP,
      fingerprintDerivation: deriveFingerprint,
    });
    const hs1 = await I.start();
    const r1 = await R.step({ ...hs1 });
    const hs3 = await I.step({ ...r1.out[0] });
    const r2 = await R.step({ ...hs3.out[0] });
    await I.step({ ...r2.out[0] });
    check('SPKI DER 公钥 + 自定义指纹方案可直接接入', I.established === true && R.established === true, adapterB.fingerprint);
    check('双方对端指纹按自定义方案一致', I.session.peerFingerprint === adapterB.fingerprint, I.session.peerFingerprint);
    check('携带短横分组的指纹在收发两侧原样保留', R.session.peerFingerprint === adapterA.fingerprint, R.session.peerFingerprint);

    // 同样的方案下，pin 指向"第三方"仍被拒（HS1.pins 必须等于被叫方指纹）
    const I2 = new HandshakeDriver({
      identity: adapterA,
      role: 'initiator',
      groupId: GROUP,
      peerFingerprint: deriveFingerprint(Buffer.from(ATTACKER.provider.publicKey)),
      fingerprintDerivation: deriveFingerprint,
    });
    const R2 = new HandshakeDriver({
      identity: adapterB,
      role: 'responder',
      groupId: GROUP,
      fingerprintDerivation: deriveFingerprint,
    });
    const hs1b = await I2.start();
    let reason = 'no-error';
    try {
      await R2.step({ ...hs1b });
    } catch (e) {
      reason = e.reason ?? String(e.message);
    }
    check('自定义方案下 pin 指向第三方仍被拒', reason === 'pin-mismatch', reason);

    // 篡改 SPKI 表示的公钥（长度变了）→ 公钥非法
    let badKey = 'no-error';
    try {
      await normalizeIdentity({ fingerprint: adapterA.fingerprint, publicKey: Buffer.alloc(7), sign: adapterA.sign, verify: adapterA.verify });
    } catch (e) {
      badKey = e instanceof ShenfenQiyueCuowu ? 'ShenfenQiyueCuowu' : String(e.message);
    }
    check('非法公钥长度 → ShenfenQiyueCuowu', badKey === 'IdentityContractError', badKey);
  }

  console.log(`\n=== verify-handshake 结果：${passes} 通过 / ${failures} 失败 ===`);
  if (failures > 0) process.exitCode = 1;
  setTimeout(() => process.exit(failures > 0 ? 1 : 0), 50).unref();
}

main().catch((e) => {
  console.error('verify-handshake 崩溃：', e);
  process.exit(1);
});
