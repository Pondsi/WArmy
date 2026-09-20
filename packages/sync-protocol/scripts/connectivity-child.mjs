/**
 * connectivity-child.mjs —— verify-connectivity.mjs 的**子进程**角色脚本（真多进程）
 *
 * 为什么要子进程：本机没有第二台机器，但"中继 + 两个不可拨入的端点"必须**跨进程**验证才像真的
 * （三个独立 Node 进程 + 三条真实 TCP 连接），而不是把三端塞进一个进程里互相调用。
 *
 * 用法（父进程用 spawn 调用，参数全 ASCII）：
 *   node connectivity-child.mjs --role relay    --out <result.json> [--port 0]
 *   node connectivity-child.mjs --role listener --relay-port N --token T --seed-self <hex> --peer-fp <fp> --out <f>
 *   node connectivity-child.mjs --role dialer   --relay-port N --token T --seed-self <hex> --peer-fp <fp> --out <f>
 *
 * 身份**不落仓库**：父进程每次运行随机生成 32 字节 seed（`--seed-self`）传给子进程，
 * 双方指纹由父进程算好通过 `--peer-fp` 传入用于 pin 校验 —— 于是仓库里没有任何"密钥材料"，
 * 两个子进程也不需要带外交换私钥。
 *
 * 结果通过**结果文件**回传（父进程轮询），不依赖 stdout 编码（避免中文/编码陷阱）。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  ZhongJiJieDian,
  ZhongJiSuiDaoBoHao,
  ZhongJiSuiDaoJianTing,
  SecureSyncClient,
  SecureSyncServer,
  warmyFingerprint,
  ed25519FromSeed,
  sha256,
  signEd25519Local,
  verifyEd25519Local,
} from '../dist/index.js';

/** 明文中唯一标记：中继侧任何样本里**都不允许**出现它（证明中继只看到密文） */
export const MARKER_SEND = 'WARMY-RELAY-PLAINTEXT-MARKER-SEND-9f3a71';
export const MARKER_REPLY = 'WARMY-RELAY-PLAINTEXT-MARKER-REPLY-4c2b88';

/** 由父进程给的随机 seed（32B hex）确定性派生本进程身份 —— 仓库里不留任何密钥材料 */
function identityFromSeedHex(hex) {
  const seed = sha256(Buffer.from(String(hex), 'utf8'));
  const kp = ed25519FromSeed(seed);
  const fingerprint = warmyFingerprint(kp.publicKey);
  return {
    fingerprint,
    publicKey: kp.publicKey,
    privateKey: kp.privateKey,
    provider: {
      fingerprint,
      publicKey: kp.publicKey,
      sign: (m) => signEd25519Local(m, kp.privateKey),
      verify: (m, s, pk) => verifyEd25519Local(m, s, pk) === true,
    },
  };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) out[a.slice(2)] = argv[i + 1];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const role = args.role ?? '';
const outFile = args.out ?? '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let state = { role, phase: 'init', at: Date.now() };

function writeState(patch) {
  state = { ...state, ...patch, at: Date.now() };
  try {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(state, null, 2), 'utf8');
  } catch {
    /* ignore */
  }
}

async function roleRelay() {
  const port = Number(args.port ?? 0);
  const mode = args.mode ?? 'forward';
  const relay = new ZhongJiJieDian({
    port,
    host: '127.0.0.1',
    pairTimeoutMs: Number(args.pairTimeoutMs ?? 8000),
    mode,
  });
  const bound = await relay.start();
  writeState({ phase: 'listening', port: bound, stats: relay.stats, samples: relay.samples });
  // 周期性把统计与"中继看到的字节样本"写回结果文件（父进程据此断言"只见密文"）
  const iv = setInterval(() => {
    writeState({ phase: 'running', port: bound, stats: relay.stats, samples: relay.samples });
  }, 200);
  // 保持存活：等父进程杀掉；也支持父进程用 --hold-ms 让它自己退出
  const holdMs = Number(args['hold-ms'] ?? 0);
  if (holdMs > 0) {
    setTimeout(() => {
      clearInterval(iv);
      writeState({ phase: 'done', port: bound, stats: relay.stats, samples: relay.samples });
      process.exit(0);
    }, holdMs);
  }
}

async function roleListener() {
  const relayPort = Number(args['relay-port']);
  const token = String(args.token);
  const id = identityFromSeedHex(args['seed-self']);
  const peer = String(args['peer-fp']);

  // B 的"本机服务"：**只监听回环**（模拟"本机服务在本机"，B 不接受任何外部入站）
  let received = null;
  const server = new SecureSyncServer({
    identity: id.provider,
    nodeId: 'endpoint-b',
    port: 0,
    host: '127.0.0.1',
    groupId: null,
    roster: (fp) => fp === peer,
    peerFingerprint: peer,
    onMessage: (msg, session) => {
      received = msg;
      writeState({
        phase: 'received',
        receivedPayload: msg.payload,
        verifiedPeerFingerprint: session.info.peerFingerprint,
        remoteAddress: session.info.remoteAddress,
      });
      try {
        session.send({ to: '*', channel: 'group', payload: { type: 'relay-reply', marker: MARKER_REPLY } });
      } catch (e) {
        writeState({ replyError: String(e && e.message ? e.message : e) });
      }
    },
    onHandshakeEvent: (e) => {
      if (e.type === 'established') writeState({ handshakeEstablishedAt: e.ts, peer: e.peer });
    },
  });
  const serverPort = await server.start();
  writeState({ phase: 'server-up', serverPort, fingerprint: id.fingerprint });

  const tunnel = new ZhongJiSuiDaoJianTing({
    relay: { host: '127.0.0.1', port: relayPort },
    token,
    from: id.fingerprint,
    localTarget: { host: '127.0.0.1', port: serverPort },
    readyTimeoutMs: 8000,
  });
  const reg = await tunnel.start();
  writeState({ phase: 'registered', serverPort, registered: reg.registered, reason: reg.reason });

  const paired = await tunnel.waitForPair(Number(args['pair-timeout'] ?? 9000));
  writeState({ phase: paired ? 'paired' : 'pair-timeout', paired, tunnel: tunnel.tunnelStats });
  // 等 A 把消息发过来 + 我们把回复发回去
  const deadline = Date.now() + Number(args['hold-ms'] ?? 6000);
  while (Date.now() < deadline && !received) await sleep(50);
  await sleep(500);
  writeState({
    phase: 'done',
    serverPort,
    registered: reg.registered,
    paired,
    tunnel: tunnel.tunnelStats,
    receivedMarker: received && received.payload ? received.payload.marker : null,
    receivedPayload: received ? received.payload : null,
  });
  await tunnel.stop();
  await server.stop();
  process.exit(0);
}

async function roleDialer() {
  const relayPort = Number(args['relay-port']);
  const token = String(args.token);
  const id = identityFromSeedHex(args['seed-self']);
  const peer = String(args['peer-fp']);

  const tunnel = new ZhongJiSuiDaoBoHao({
    relay: { host: '127.0.0.1', port: relayPort },
    token,
    from: id.fingerprint,
    readyTimeoutMs: Number(args['ready-timeout'] ?? 8000),
  });
  const localPort = await tunnel.start();
  writeState({ phase: 'tunnel-up', localPort });

  let reply = null;
  const client = new SecureSyncClient({
    identity: id.provider,
    nodeId: 'endpoint-a',
    host: '127.0.0.1',
    port: localPort,
    groupId: null,
    peerFingerprint: peer,
    roster: (fp) => fp === peer,
    handshakeTimeoutMs: 9000,
    onMessage: (msg) => {
      reply = msg;
      // 注意：msg.from 是**对端 nodeId**（消息自称字段），不是握手得出的指纹；
      // 指纹必须取 session.info.peerFingerprint（来自 HS 帧的 fp + 公钥推导校验）。
      writeState({ phase: 'got-reply', replyPayload: msg.payload, replyFromNodeId: msg.from });
    },
  });
  const r = await client.connect(9000);
  writeState({
    phase: r.ok ? 'handshake-ok' : 'handshake-failed',
    handshakeOk: r.ok,
    reason: r.reason,
    keyFingerprint: r.session ? r.session.info.keyFingerprint : null,
    peerFingerprint: r.session ? r.session.info.peerFingerprint : null,
  });
  if (r.ok && r.session) {
    r.session.send({ to: '*', channel: 'group', payload: { type: 'relay-probe', marker: MARKER_SEND } });
    writeState({ phase: 'sent' });
    const deadline = Date.now() + Number(args['hold-ms'] ?? 6000);
    while (Date.now() < deadline && !reply) await sleep(50);
    writeState({
      phase: 'done',
      handshakeOk: true,
      sent: true,
      replyReceived: reply !== null,
      replyMarker: reply && reply.payload ? reply.payload.marker : null,
      tunnel: tunnel.tunnelStats,
    });
  } else {
    writeState({ phase: 'done', handshakeOk: false, sent: false, replyReceived: false, tunnel: tunnel.tunnelStats });
  }
  client.close('done');
  await tunnel.stop();
  await sleep(100);
  process.exit(0);
}

try {
  if (role === 'relay') await roleRelay();
  else if (role === 'listener') await roleListener();
  else if (role === 'dialer') await roleDialer();
  else {
    writeState({ phase: 'error', error: `unknown role ${role}` });
    process.exit(2);
  }
} catch (e) {
  writeState({ phase: 'error', error: String(e && e.stack ? e.stack : e) });
  process.exit(1);
}
