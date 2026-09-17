/**
 * verify-wiring.mjs —— **接线**的可重跑验证（不是单元测试，跑的是真东西）
 *
 *   node scripts/verify-wiring.mjs            # 全量
 *   node scripts/verify-wiring.mjs --keep     # 保留临时目录（排查用）
 *
 * 覆盖（每条断言都有真实执行做证据：真 git 命令 / 真 TCP / 真 crypto / 真实函数返回值）：
 *   [1] 身份 ↔ 组网接缝：指纹推导一致（不一致会拒掉所有合法握手）、签名者、门控、名册
 *   [2] 鉴权通道：真实 HS1–HS4 握手 + 加密记录往返、名册外被拒、重放计数**跨实例持久化**
 *   [3] 探测真实现：网卡枚举 / TCP 连通性 / 端口自测 / DNS / 出站 / 公网地址回显（尽力而为）
 *   [4] pre-receive 钩子：真实 git 仓库 push（危险路径 / 大小写别名 / .gitattributes filter /
 *       主分支保护 / 提案分支放行 / 非快进），含直接用 stdin 喂钩子的退出码
 *   [5] 租约：第二持有者被拒、过期后可获取、无租约写入被拒
 *
 * 依赖 dist（先 `pnpm --filter @ccarmy/app-shell build` 与 `--filter @ccarmy/sync-protocol build`）。
 * 不联网要求：出站/公网回显若被网络策略挡住，只断言"如实降级"（不会因此判失败）。
 * 不碰用户机器上的全局 git config（临时仓库一律用 `-c user.*` 显式传作者）。
 */
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  IdentityUnavailableError,
  assertDerivationMatches,
  createIdentityProvider,
  createIdentitySigner,
  buildIdentityChangeEntries,
  createRosterChecker,
  fingerprintDerivationForAppShell,
  knownContactFingerprints,
  listPeerContactViews,
  peerContactKeys,
  requireSignableIdentity,
} from '../dist/identity-provider.js';
import { IdentityStore, nullProtector } from '../dist/identity-store.js';
import { fingerprintFromPublicKey, isValidFingerprint, keyObjectFromPrivateDer, publicKeyOfPrivate, publicKeyToB64 } from '../dist/identity.js';
import {
  NET_NOTES,
  SecureMesh,
  checkOutbound,
  discoverPublicIp,
  ensureNetDir,
  listLocalAddresses,
  localAddressInfo,
  pickLocalAddress,
  probeNet,
  secureLoopbackSmoke,
  summarizeProbe,
  tcpProbe,
} from '../dist/net-wiring.js';
import {
  collectPushEntries,
  createGitRunner,
  findHookScript,
  formatPreReceiveOutput,
  hookWrapperScript,
  installPreReceiveHook,
  parsePreReceiveStdin,
  runPreReceive,
} from '../dist/repo-hooks.js';
import { validatePushPaths, validateRefUpdate } from '../dist/repo-guard.js';
import { LeaseRegistry } from '../dist/lease.js';
import { ReplayGuard, ed25519RawFromSpkiDer, normalizeIdentity } from '../../sync-protocol/dist/index.js';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const keep = process.argv.includes('--keep');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ccarmy-wiring-'));
const hookScript = path.join(selfDir, 'git-hooks', 'pre-receive.mjs');

let pass = 0;
let fail = 0;
const failures = [];

function check(label, cond, detail) {
  const shown = detail === undefined ? '' : ` => ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
  if (cond) {
    pass++;
    console.log(`  [PASS] ${label}${shown}`);
  } else {
    fail++;
    failures.push(label);
    console.log(`  [FAIL] ${label}${shown}`);
  }
}

function section(title) {
  console.log(`\n── ${title} ──`);
}

/** 真跑一个命令（不经过 shell；返回码/输出都原样带出来） */
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd,
    input: opts.input,
    env: { ...process.env, ...(opts.env || {}) },
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error ? String(r.error.message) : '' };
}

const git = (cwd, args, opts = {}) => run('git', args, { cwd, ...opts });
const node = (args, opts = {}) => run(process.execPath, args, opts);

console.log('wiring 验证开始');
console.log(`临时目录: ${tmpRoot}`);
console.log(`node: ${process.execPath}`);
console.log(`hook: ${hookScript}`);

/* ════════════════════════════════════════════════════════════════════════════
   [1] 身份 ↔ 组网接缝
   ════════════════════════════════════════════════════════════════════════════ */

section('1. 身份 ↔ 组网接缝（指纹推导 / 签名者 / 门控 / 名册）');

/** 造一个真身份（口令保护 → 可控地"锁上/解开"） */
function mkIdentity(name, passphrase) {
  const dir = path.join(tmpRoot, `id-${name}`);
  fs.mkdirSync(dir, { recursive: true });
  const store = new IdentityStore(path.join(dir, 'identity.json'), { protector: nullProtector() });
  const created = store.ensureIdentity(`alias-${name}`, { email: `${name}@example.test` }, passphrase ? { passphrase } : {});
  // ensureIdentity 会把 DEK 放进会话缓存（= 刚创建完是"解锁"状态）；
  // 真实后台进程重启后**没有**这个缓存，所以这里显式 lock() 复现那个状态。
  store.lock();
  return { store, created, dir };
}

const PASS = 'wiring-verify-passphrase';
const idA = mkIdentity('a', PASS);
const idB = mkIdentity('b', PASS);
const idC = mkIdentity('c', PASS);

check('身份 A 创建成功（真 Ed25519 密钥落盘）', idA.created.ok === true, idA.created.ok ? idA.store.info()?.fingerprint : idA.created);

const infoA = idA.store.info();
const infoB = idB.store.info();
const infoC = idC.store.info();
check('身份指纹合法（Crockford base32、19 位数据 + 1 位校验）', isValidFingerprint(infoA?.fingerprint) === true, infoA?.fingerprint);
check('指纹展示形是 4 组 × 5 位（手抄核对友好）', /^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/.test(String(infoA?.fingerprint)), infoA?.fingerprint);
check('三个身份指纹互不相同', new Set([infoA?.fingerprint, infoB?.fingerprint, infoC?.fingerprint]).size === 3);

const deriv = fingerprintDerivationForAppShell();
check('fingerprintDerivationForAppShell 是函数', typeof deriv === 'function');

const rawA = ed25519RawFromSpkiDer(Buffer.from(String(infoA?.publicKey), 'base64'));
check('info.publicKey 是 44 字节 Ed25519 SPKI DER', rawA !== null && rawA.length === 32, rawA ? `${rawA.length}B raw` : 'not-spki');
check('推导函数(公钥 raw) === 身份层指纹', deriv(rawA) === infoA?.fingerprint, `${deriv(rawA)} == ${infoA?.fingerprint}`);
check(
  '推导函数与身份层共享同一实现（fingerprintFromPublicKey(SPKI)）',
  deriv(rawA) === fingerprintFromPublicKey(String(infoA?.publicKey)),
);

const checkA = assertDerivationMatches(idA.store);
check('assertDerivationMatches(A) 返回指纹', checkA.fingerprint === infoA?.fingerprint, checkA.fingerprint);
check('assertDerivationMatches 报告 raw 长度=32', checkA.publicKeyRawBytes === 32, checkA.publicKeyRawBytes);

// 反例：把"别的公钥 + 另一个指纹"喂进去必须抛（含期望/实际）
let mismatch = null;
try {
  assertDerivationMatches({
    info: () => ({ publicKey: String(infoB?.publicKey), fingerprint: String(infoA?.fingerprint) }),
    path: () => path.join(tmpRoot, 'fake'),
  });
} catch (e) {
  mismatch = e;
}
check('指纹与公钥不符时 assertDerivationMatches 抛错', !!mismatch, mismatch?.name);
check(
  '抛错信息里同时带期望值与实际值',
  !!mismatch && mismatch.message.includes(String(infoA?.fingerprint)) && mismatch.message.includes(String(infoB?.fingerprint)),
  mismatch?.message?.slice(0, 120),
);

// 签名者：口令模式未解锁 → 不可后台签名（**不许静默失败**）
const signerA = createIdentitySigner(idA.store);
check('未 unlock 时 signReady() === false', signerA.signReady() === false);
check('未 unlock 时 unlockState() 报 needsPassphrase', signerA.unlockState()?.needsPassphrase === true, signerA.unlockState());
check('signer.publicKey === info.publicKey（SPKI DER base64）', signerA.publicKey === infoA?.publicKey);
check('signer.fingerprint === info.fingerprint', signerA.fingerprint === infoA?.fingerprint);

const lockedSign = await signerA.sign(Buffer.from('while-locked')).then(
  () => ({ ok: true }),
  (e) => ({ ok: false, name: e.name, code: e.code }),
);
check('未解锁时 sign() 抛类型化错误 identity-locked（不是空签名）', lockedSign.ok === false && lockedSign.name === 'identity-locked', lockedSign);

const gateLocked = requireSignableIdentity(idA.store);
check('门控：未解锁 → ok=false + errorCode=identity-locked', gateLocked.ok === false && gateLocked.errorCode === 'identity-locked', gateLocked);
check('门控：未解锁时不返回 signReady', gateLocked.unlock?.signReady !== true);

// 真解锁（会话内 DEK）
const unlocked = idA.store.unlock(PASS);
check('unlock(passphrase) 成功', unlocked.ok === true, unlocked);
check('解锁后 signReady() === true（会话内免口令，私钥仍不出主进程）', signerA.signReady() === true);
const gateOpen = requireSignableIdentity(idA.store);
check('门控：解锁后 ok=true', gateOpen.ok === true && gateOpen.unlock?.signReady === true, gateOpen.unlock);

const msg = Buffer.from('ccarmy-wiring-verify-message', 'utf8');
const sig = await signerA.sign(msg);
check('sign() 产 raw 64 字节 Ed25519 签名', Buffer.isBuffer(sig) && sig.length === 64, `${sig.length}B`);
const privLoaded = idA.store.load();
check('store.load() 的私钥确实对应 info.publicKey（指纹可复算）', publicKeyToB64(publicKeyOfPrivate(keyObjectFromPrivateDer(privLoaded.privateKeyDer))) === infoA?.publicKey);
check(
  'signer 对象不暴露任何私钥材料（只指公开字段）',
  !JSON.stringify(signerA).includes(privLoaded.privateKeyDer.toString('base64').slice(0, 24)),
  Object.keys(signerA),
);

// 用 node:crypto 独立复核（真验证：签名能被公钥验过）
const pubObj = crypto.createPublicKey({ key: Buffer.from(String(infoA?.publicKey), 'base64'), format: 'der', type: 'spki' });
check('node:crypto 用身份公钥验签通过', crypto.verify(null, msg, pubObj, sig) === true);
check('独立复核：同一私钥重签亦通过', crypto.verify(null, msg, pubObj, crypto.sign(null, msg, keyObjectFromPrivateDer(privLoaded.privateKeyDer))) === true);
check('signer.verify(msg, sig, SPKI b64) === true', signerA.verify(msg, sig, String(infoA?.publicKey)) === true);
check('signer.verify(改过的 msg, sig) === false', signerA.verify(Buffer.from('tampered'), sig, String(infoA?.publicKey)) === false);
check('signer.verify 无法解释的公钥 → null（"没验过"，不是"验过了"）', signerA.verify(msg, sig, Buffer.from([1, 2, 3])) === null);

const provider = createIdentityProvider(idA.store);
check('createIdentityProvider 四字段齐备', typeof provider.sign === 'function' && typeof provider.verify === 'function' && !!provider.fingerprint && !!provider.publicKey);
const providerSig = await provider.sign(msg);
check('provider.sign 经组网层契约返回 64 字节签名', Buffer.isBuffer(providerSig) && providerSig.length === 64, `${providerSig.length}B`);
check('provider.verify 通过', provider.verify(msg, providerSig, String(infoA?.publicKey)) === true);

// **核心接缝**：身份层指纹必须能被组网层接受；用默认推导必然失败
const normalized = await normalizeIdentity(provider, { fingerprintDerivation: deriv });
check('组网层 normalizeIdentity 接受身份层指纹（注入 derivation）', normalized.fingerprint === infoA?.fingerprint, normalized.fingerprint);
check('归一化后的公钥被剥成 raw 32B', Buffer.isBuffer(normalized.publicKey) && normalized.publicKey.length === 32, normalized.publicKey.length);
const withoutDeriv = await normalizeIdentity(provider).then(
  () => ({ threw: false }),
  (e) => ({ threw: true, name: e.name, message: e.message }),
);
check('不注入 derivation 时组网层拒收（这就是必须注入的原因）', withoutDeriv.threw === true, withoutDeriv.name);
check('拒收原因写明期望/实际指纹不一致', /期望|mismatch|不符/.test(String(withoutDeriv.message)), String(withoutDeriv.message).slice(0, 140));

// 名册：只放行本机已知联系人
const before = knownContactFingerprints(idA.store);
check('新身份的名册为空（没有已知联系人）', Array.isArray(before) && before.length === 0, before);
check('名册拒绝未知指纹（未加联系人时）', createRosterChecker(idA.store)(String(infoB?.fingerprint)) === false);
idA.store.recordPeerCard(String(infoB?.fingerprint), { email: 'b@example.test' });
check('记录对端名片后名册放行该指纹', createRosterChecker(idA.store)(String(infoB?.fingerprint)) === true);
check('名册仍拒绝未记录者', createRosterChecker(idA.store)(String(infoC?.fingerprint)) === false);
check('peerContactKeys 读到落盘的键', peerContactKeys(idA.store).length === 1, peerContactKeys(idA.store));
const viewsA = listPeerContactViews(idA.store);
check('listPeerContactViews 返回对端名片视图', viewsA.length === 1 && viewsA[0].fingerprint === infoB?.fingerprint, viewsA.map((v) => v.fingerprint));
check('视图的 previousCard 来自本机留存（就是刚记录的那张）', viewsA[0].previousCard.email === 'b@example.test', viewsA[0].previousCard);

// 对端换证（本机侧记录；声明不携带任何联系方式）
const fakeDecl = {
  schema: 'ccarmy.identity.rotation.v1',
  kind: 'ccarmy.identity.rotation',
  version: 1,
  algo: 'Ed25519',
  oldFingerprint: String(infoB?.fingerprint),
  oldPublicKey: String(infoB?.publicKey),
  previousGeneration: 1,
  newFingerprint: 'BBBB-BBBB-BBBB-BBBB-BBBB-2',
  newPublicKey: 'x',
  generation: 2,
  issuedAt: Date.now(),
  signerFingerprint: String(infoB?.fingerprint),
  signature: 'x',
};
idA.store.recordPeerRotation(fakeDecl);
const pf = idA.store.peerContact('BBBB-BBBB-BBBB-BBBB-BBBB-2');
check('recordPeerRotation 后能按新指纹查到对端状态', !!pf, pf ? `receivedAt=${pf.receivedAt} frozen=${pf.frozen}` : null);
check('换证后从本机此刻起算冻结期（receivedAt>0 且 frozen）', pf?.receivedAt > 0 && pf?.frozen === true, pf?.remainingMs);
check('新条目的 previousCard 仍是本机留存值（不来自声明）', pf?.previousCard?.email === 'b@example.test', pf?.previousCard);
check('声明里没有联系方式字段（拒收攻击者可控数据）', !('email' in fakeDecl) && !('contactCard' in fakeDecl));

/* ════════════════════════════════════════════════════════════════════════════
   [2] 鉴权通道：真握手 / 名册拒绝 / 重放持久化
   ════════════════════════════════════════════════════════════════════════════ */

section('2. 鉴权通道（真 HS1–HS4 / 名册 / 重放计数持久化）');

const smoke = await secureLoopbackSmoke({ nodeId: 'wiring-smoke', localPort: 0, timeoutMs: 8000 });
check('回环冒烟：TCP 服务端起来了', smoke.serverPort > 0, smoke.serverPort);
check('回环冒烟：鉴权握手成功（HS1–HS4）', smoke.secure.handshakeOk === true, smoke.secure.failure ?? 'ok');
check('回环冒烟：加密记录真的被对端解出（recordRoundTrip）', smoke.secure.recordRoundTrip === true);
check('回环冒烟：loopbackOk 综合为真', smoke.loopbackOk === true);
check('回环冒烟：产生了每连接密钥指纹', typeof smoke.secure.keyFingerprint === 'string' && smoke.secure.keyFingerprint.length > 0, smoke.secure.keyFingerprint?.slice(0, 16));
check('回环冒烟：对端身份是一次性临时身份（不是本机身份）', smoke.secure.ephemeral === true && smoke.secure.peerFingerprint.length > 0);

// 两个真节点：各自身份 + 互相加入名册 → 出站握手 + 收件
const netDir = path.join(tmpRoot, 'net');
check('ensureNetDir 建目录成功', ensureNetDir(netDir).ok === true, ensureNetDir(netDir).dir);

const meshA = new SecureMesh({
  userDataDir: path.join(tmpRoot, 'mesh-a'),
  nodeId: 'node-a',
  store: () => idA.store,
  peers: () => [],
});
const meshB = new SecureMesh({
  userDataDir: path.join(tmpRoot, 'mesh-b'),
  nodeId: 'node-b',
  store: () => idB.store,
  peers: () => [],
});

// 名册：A 认识 B、B 认识 A（否则握手会被 not-authorized 拒掉）
idB.store.recordPeerCard(String(infoA?.fingerprint), {});
idB.store.unlock(PASS);

const enableA = await meshA.enable(0, { discovery: false, announce: false });
check('SecureMesh.enable(身份已解锁) 成功', enableA.ok === true && enableA.port > 0, enableA);
check('enable 返回 nodeId 且 notes 是 i18n key（不拼句子）', enableA.nodeId === 'node-a' && enableA.notes?.lan === 'net.note.lan', enableA.notes);
const portA = enableA.port;

const received = [];
void received;
// keepOpen=true：一次拨号后保持连接（mesh 的常态用法）——presence/sessions 才有东西可测
const sent = await meshB.sendToHost(
  '127.0.0.1',
  portA,
  { to: '*', channel: 'group', payload: { text: 'wiring-hello' } },
  { pin: String(infoA?.fingerprint), keepOpen: true },
);
check('B→A 出站握手成功', sent.ok === true, sent.error ?? 'ok');
check('B 侧拿到 A 的对端指纹（来自握手，不是消息自称）', sent.peerFingerprint === infoA?.fingerprint, sent.peerFingerprint);
check('B 侧记录了握手时延', typeof sent.latencyMs === 'number' && sent.latencyMs >= 0, sent.latencyMs);

const deadline = Date.now() + 2000;
let got = null;
while (Date.now() < deadline) {
  got = meshA.inboxOf().find((m) => m.payload?.text === 'wiring-hello') ?? null;
  if (got) break;
  await new Promise((r) => setTimeout(r, 40));
}
check('A 侧收到明文（加密记录已解封）', !!got, got ? `${got.channel} from ${got.peerFingerprint.slice(0, 10)}` : 'timeout');
check('A 侧记录的对端指纹 === B', got?.peerFingerprint === infoB?.fingerprint, got?.peerFingerprint);
check(
  'A 侧 presence 把 B 记为在线（真判据=已建立的鉴权连接）',
  meshA.presence().some((p) => p.fingerprint === infoB?.fingerprint && p.online === true),
  meshA.presence().map((p) => `${p.online ? 'online' : 'offline'}/conn=${p.connections}`),
);

const stA = await meshA.status(0);
check('status: meshEnabled=true', stA.meshEnabled === true);
check('status: 本机监听自测通过（真 TCP 连 127.0.0.1:port）', stA.link.reachable === true, stA.link.lastError ?? 'reachable');
check('status: local.port === 实际监听端口', stA.local?.port === portA, stA.local);
check('status: 报告 sessions>0', (stA.sessions ?? 0) > 0, stA.sessions);
check('status: unlock.signReady=true', stA.unlock?.signReady === true);

// 断连即离线：presence 不能靠「上次见过」就长期谎报在线
await meshB.disable();
const offlineDeadline = Date.now() + 2000;
while (Date.now() < offlineDeadline) {
  if (!meshA.presence().some((p) => p.fingerprint === infoB?.fingerprint && p.online === true)) break;
  await new Promise((r) => setTimeout(r, 40));
}
check(
  'B 断开后 A 侧 presence 立刻判离线（不谎报在线）',
  meshA.presence().some((p) => p.fingerprint === infoB?.fingerprint && p.online === false),
  meshA.presence(),
);

// 名册外的人：C 不在 A 的名册里 → 必须被 not-authorized 拒
const meshC = new SecureMesh({ userDataDir: path.join(tmpRoot, 'mesh-c'), nodeId: 'node-c', store: () => idC.store, peers: () => [] });
idC.store.unlock(PASS);
idC.store.recordPeerCard(String(infoA?.fingerprint), {}); // C 认识 A，A 不认识 C
const rejected = await meshC.sendToHost('127.0.0.1', portA, { to: '*', channel: 'group', payload: { text: 'intruder' } }, { pin: String(infoA?.fingerprint) });
check('名册外的 C 连 A 被拒（not-authorized）', rejected.ok === false && /not-authorized/.test(String(rejected.error)), rejected.error);
check('被拒后没有建立会话', meshC.sessionCount === 0, meshC.sessionCount);
const stAfter = await meshA.status(0);
check('A 侧把这次拒绝记进 rejectionCounts（可观测）', (stAfter.handshakeRejections?.['not-authorized'] ?? 0) >= 1, stAfter.handshakeRejections);

// 门控：锁上身份后不许起组网、不许宣告
const meshLocked = new SecureMesh({
  userDataDir: path.join(tmpRoot, 'mesh-locked'),
  nodeId: 'node-locked',
  store: () => idC.store,
  peers: () => [],
});
idC.store.lock();
const enableLocked = await meshLocked.enable(0, { discovery: false, announce: true });
check('身份未解锁 → enable 被门控拒绝（errorCode=identity-locked）', enableLocked.ok === false && enableLocked.errorCode === 'identity-locked', enableLocked);
check('被门控拒绝时没有起监听（不许假装成功）', meshLocked.enabled === false);
const announceLocked = await meshLocked.announce('startup');
check('身份未解锁 → announce 也被拒（不许发宣告）', announceLocked.ok === false && announceLocked.errorCode === 'identity-locked', announceLocked.errorCode);
check('门控失败时 attempted/delivered 都是 0（真的没发）', announceLocked.attempted === 0 && announceLocked.delivered === 0);
idC.store.unlock(PASS);
const enableAgain = await meshLocked.enable(0, { discovery: false, announce: false });
check('解锁后同一实例能正常起组网', enableAgain.ok === true && meshLocked.enabled === true, enableAgain.errorCode ?? 'ok');
const announceEmpty = await meshLocked.announce('manual');
check('宣告：没有已知对端时如实报 attempted=0（不是"宣告成功"）', announceEmpty.attempted === 0 && announceEmpty.ok === true, announceEmpty);
check('宣告记录了本机监听地址', announceEmpty.addr.port === meshLocked.boundPort, announceEmpty.addr);
await meshLocked.disable();
check('disable 后 enabled=false', meshLocked.enabled === false);

// 重放防护：**持久化必须跨实例单调**（不持久化 = 重启即可重放）
const replayFile = path.join(tmpRoot, 'replay', 'replay-guard.json');
const g1 = new ReplayGuard({ persistFile: replayFile });
const c1 = g1.nextLocalCounter();
const c2 = g1.nextLocalCounter();
check('ReplayGuard 本地计数单调递增（1 → 2）', c1 === 1 && c2 === 2, [c1, c2]);
check('计数已落盘（文件存在且含 localCounter）', fs.existsSync(replayFile) && JSON.parse(fs.readFileSync(replayFile, 'utf8')).localCounter === 2);
const g2 = new ReplayGuard({ persistFile: replayFile });
check('故障重开的新实例读到持久化计数（跨重启继续递增，不回到 1）', g2.localCounter === 2, g2.localCounter);
check('新实例的下一个计数是 3（重启后仍单调）', g2.nextLocalCounter() === 3);

// 跨实例重放：g1 接受并 commit 一次 (peer, nonce, counter)，**随后新起的实例**（= 进程重启）必须拒。
// 顺序很重要：新实例要在 commit 之后构造，否则它加载的是旧快照（无法复现"重启后仍记得"）。
const peerFp = String(infoB?.fingerprint);
const t = Date.now();
check('g1.check 首次接受', g1.check({ peer: peerFp, nonce: 'n-verify-1', counter: 10, ts: t }).ok === true);
g1.commit({ peer: peerFp, nonce: 'n-verify-1', counter: 10 });
const g3 = new ReplayGuard({ persistFile: replayFile });
check('重启后的新实例读回了对端计数（maxCounterSeen=10）', g3.maxCounterSeen(peerFp) === 10, g3.maxCounterSeen(peerFp));
check('重启后的新实例记得已用过的 nonce', g3.seenNonceCount(peerFp) >= 1, g3.seenNonceCount(peerFp));
const replayNonce = g3.check({ peer: peerFp, nonce: 'n-verify-1', counter: 11, ts: t });
check('重启后同一 nonce 仍被拒（不持久化就会放行）', replayNonce.ok === false && replayNonce.reason === 'replay-nonce', replayNonce);
const replayCounter = g3.check({ peer: peerFp, nonce: 'n-verify-2', counter: 10, ts: t });
check('重启后回退的 counter 被拒', replayCounter.ok === false && replayCounter.reason === 'replay-counter', replayCounter);
check('重启后更高 counter 的 fresh nonce 放行', g3.check({ peer: peerFp, nonce: 'n-verify-3', counter: 11, ts: t }).ok === true);
const skew = g3.check({ peer: peerFp, nonce: 'n-verify-4', counter: 12, ts: t - 10 * 60_000 });
check('时间戳超容差被拒（clock-skew）', skew.ok === false && skew.reason === 'clock-skew', skew);

await meshA.disable();
await meshB.disable();

/* ════════════════════════════════════════════════════════════════════════════
   [3] 探测真实现
   ════════════════════════════════════════════════════════════════════════════ */

section('3. 探测真实现（本机地址 / TCP / 端口自测 / DNS / 出站 / 公网回显）');

const addrs = listLocalAddresses();
check('listLocalAddresses 枚举出非回环 IPv4', Array.isArray(addrs.all) && addrs.all.length >= 1, addrs);
const localIp = pickLocalAddress(addrs.all);
check('pickLocalAddress 优先私网地址', /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(localIp) || localIp === addrs.all[0], localIp);

// 真监听一个端口，再自己连自己（端口自测是真的 TCP 连通）
const tcpServer = await new Promise((resolve) => {
  const srv = net.createServer((c) => {
    c.on('error', () => {});
    c.end('bye');
  });
  srv.on('error', () => {});
  srv.listen(0, '127.0.0.1', () => resolve(srv));
});
const livePort = tcpServer.address().port;
const tcpLive = await tcpProbe('127.0.0.1', livePort, 1500);
check('tcpProbe 对真监听端口返回 ok:true', tcpLive.ok === true, tcpLive);
check('tcpProbe 报告了真实时延', typeof tcpLive.latencyMs === 'number' && tcpLive.latencyMs < 1500, tcpLive.latencyMs);
const tcpDead = await tcpProbe('127.0.0.1', 1, 1500);
check('tcpProbe 对关着的端口返回 ok:false（不谎报通）', tcpDead.ok === false && typeof tcpDead.error === 'string', tcpDead);
const tcpUnroutable = await tcpProbe('203.0.113.1', 65000, 1200);
check('tcpProbe 对不可达地址如实失败', tcpUnroutable.ok === false, tcpUnroutable);

const pLocal = await probeNet({ ip: localIp, port: livePort }, 2000);
check('probeNet(本机私网地址) isPublic=false（绝不硬编码 true）', pLocal.isPublic === false, summarizeProbe(pLocal));
check('probeNet(本机私网地址) lanOnly=true', pLocal.lanOnly === true);
check('probeNet 对本机地址做真实端口自测并通过', pLocal.details?.portCheck?.ok === true, pLocal.details?.portCheck);
check('probeNet 标注入站可达性未验证（inboundVerified=false）', pLocal.inboundVerified === false);
check('probeNet 记录了本机网卡地址证据', (pLocal.details?.localInterfaces?.length ?? 0) >= 1, pLocal.details?.localInterfaces);
check('probeNet 的 method 写明用了哪些手段', typeof pLocal.method === 'string' && pLocal.method.includes('local-interface'), pLocal.method);

const pPublic = await probeNet({ ip: '8.8.8.8', port: 53 }, 1500);
check('probeNet(公网字面地址) isPublic=true（由地址事实推出）', pPublic.isPublic === true, summarizeProbe(pPublic));
check('probeNet(公网字面地址) 仍标注入站未验证', pPublic.inboundVerified === false);
check('probeNet 不把"公网字面"当成"可达"（isPublic 与 outboundOk 是两个字段）', typeof pPublic.outboundOk === 'boolean', pPublic.outboundOk);

const pLoop = await probeNet({ ip: '127.0.0.1', port: livePort }, 1500);
check('probeNet(回环) lanOnly=true 且端口自测通过', pLoop.lanOnly === true && pLoop.details?.portCheck?.ok === true, summarizeProbe(pLoop));

const pBadIp = await probeNet({ ip: 'not an ip!!', port: 80 });
check('非法 ip → ok:false + errorCode=invalid-ip', pBadIp.ok === false && pBadIp.errorCode === 'invalid-ip', pBadIp.errorCode);
const pBadPort = await probeNet({ ip: '127.0.0.1', port: 99999 });
check('非法端口 → ok:false + errorCode=invalid-port', pBadPort.ok === false && pBadPort.errorCode === 'invalid-port', pBadPort.errorCode);

const dnsProbe = await probeNet({ ip: 'registry.npmjs.org', port: 443, domains: ['localhost'] }, 2500);
check('DNS 解析真实发生（registry.npmjs.org 解析出公网 IPv4）', (dnsProbe.details?.resolvedIpv4 ?? []).some((a) => !/^(10\.|127\.|192\.168\.)/.test(a)), dnsProbe.details?.resolvedIpv4);
check('单标签主机名 localhost 也被接受并解析', (dnsProbe.details?.resolvedIpv4 ?? []).length >= 1 && (dnsProbe.details?.dnsErrors ?? []).length === 0, {
  resolved: dnsProbe.details?.resolvedIpv4,
  errs: dnsProbe.details?.dnsErrors,
});
check('域名解析结果进入判断（isPublic 为布尔）', typeof dnsProbe.isPublic === 'boolean', summarizeProbe(dnsProbe));
const dnsFail = await probeNet({ ip: 'no-such-host.invalid', port: 80, domains: ['also-no-such-host.invalid'] }, 1500);
check('解析失败被如实记录（dnsErrors 非空）', (dnsFail.details?.dnsErrors?.length ?? 0) >= 2, dnsFail.details?.dnsErrors);

const outbound = await checkOutbound(2000);
check('checkOutbound 真的尝试了至少一个公网端点', outbound.attempts.length >= 1, outbound.attempts.map((a) => `${a.label}:${a.ok}`));
check('checkOutbound 结论与尝试记录一致（ok ⇔ 有成功的尝试）', outbound.ok === outbound.attempts.some((a) => a.ok), summarizeProbe({ ok: true, isPublic: false, outboundOk: outbound.ok, inboundVerified: false }));
if (outbound.ok) {
  check('出站成功时给出方式（tcp:<label>）', String(outbound.method).startsWith('tcp:'), outbound.method);
} else {
  check('出站失败时给出逐端点原因（不空口说"不通"）', String(outbound.error).length > 0, outbound.error);
}

const localInfo = await localAddressInfo({ port: livePort, timeoutMs: 2500 });
check('localAddressInfo 给出本机地址', typeof localInfo.localIp === 'string' && localInfo.localIp.length > 0, localInfo.localIp);
check('localAddressInfo 的端口自测通过', localInfo.tcp?.ok === true, localInfo.tcp);
check('localAddressInfo 判定 NAT 与否有依据（behindNat 或有公网网卡）', typeof localInfo.behindNat === 'boolean', { behindNat: localInfo.behindNat, publicIfaces: localInfo.hasPublicInterface });
const pubIp = await discoverPublicIp(2500);
if (pubIp.ok) {
  check('公网地址回显成功且不是私网地址', !/^(10\.|127\.|192\.168\.|169\.254\.)/.test(String(pubIp.ip)), `${pubIp.ip} via ${pubIp.source}`);
  check('公网地址来源被记录', typeof pubIp.source === 'string' && pubIp.source.length > 0, pubIp.source);
} else {
  check('公网回显不可达时如实降级（不伪造 publicIp）', typeof pubIp.error === 'string' && pubIp.error.length > 0, pubIp.error);
  check('降级时不返回任何 ip 字段', pubIp.ip === undefined);
}
check('NET_NOTES 只给 i18n key（主进程不拼句子）', Object.values(NET_NOTES).every((v) => /^net\.note\./.test(v)), NET_NOTES);

/* ════════════════════════════════════════════════════════════════════════════
   [4] pre-receive 钩子（真实 git 仓库 + 真实 push）
   ════════════════════════════════════════════════════════════════════════════ */
section('4. pre-receive 钩子（真 git 仓库、真 push、真退出码）');

const AUTHOR = ['-c', 'user.name=ccarmy-verify', '-c', 'user.email=verify@example.test'];
const ZERO = '0'.repeat(40);

const bare = path.join(tmpRoot, 'bare.git');
const work = path.join(tmpRoot, 'work');
fs.mkdirSync(bare, { recursive: true });
fs.mkdirSync(work, { recursive: true });
check('git init --bare 成功（服务端仓库）', git(bare, ['init', '--bare', '-q']).code === 0, git(bare, ['rev-parse', '--is-bare-repository']).stdout.trim());
check('git init 成功（推送方仓库）', git(work, ['init', '-q']).code === 0, git(work, ['rev-parse', '--is-inside-work-tree']).stdout.trim());

// 装钩子（真调 CLI --install）
const installRun = node([hookScript, '--install', bare]);
const installJson = (() => {
  try {
    return JSON.parse(installRun.stdout.trim().split('\n').pop());
  } catch {
    return null;
  }
})();
check('钩子安装 CLI 退出码 0', installRun.code === 0, installRun.stdout.trim() || installRun.stderr.trim());
check('安装结果 ok=true 且给出 hookPath', installJson?.ok === true && !!installJson?.hookPath, installJson);
check('钩子文件真的写到 <gitdir>/hooks/pre-receive', fs.existsSync(path.join(bare, 'hooks', 'pre-receive')));
const installedHook = fs.readFileSync(path.join(bare, 'hooks', 'pre-receive'), 'utf8');
check('钩子内容带受管标记（便于幂等识别）', installedHook.includes('CCARMY-REPO-GUARD-HOOK v1'), installedHook.split('\n')[1]);
check('钩子内容是 sh 包装（exec "node" "pre-receive.mjs"）', installedHook.includes('exec "') && installedHook.includes('pre-receive.mjs'), installedHook.split('\n').pop());
check('钩子包装脚本可生成（纯函数）', hookWrapperScript('/usr/bin/node', '/x/y.mjs').includes('exec "/usr/bin/node" "/x/y.mjs"'));
check('findHookScript 能在 scripts/git-hooks 找到脚本', findHookScript(path.join(selfDir, '..')) === hookScript, findHookScript(path.join(selfDir, '..')));

// 幂等 + 不覆盖别人的钩子
const installAgain = JSON.parse(node([hookScript, '--install', bare]).stdout.trim().split('\n').pop() || '{}');
check('重复安装是幂等的（alreadyInstalled=true）', installAgain.ok === true && installAgain.alreadyInstalled === true, installAgain);
const bare2 = path.join(tmpRoot, 'bare2.git');
fs.mkdirSync(bare2, { recursive: true });
check('第二个裸仓库初始化成功（用于「不覆盖别人的钩子」用例）', git(bare2, ['init', '--bare', '-q']).code === 0);
fs.mkdirSync(path.join(bare2, 'hooks'), { recursive: true });
fs.writeFileSync(path.join(bare2, 'hooks', 'pre-receive'), '#!/bin/sh\necho someone-elses-hook\n', 'utf8');
const clobber = installPreReceiveHook({ repoDir: bare2, hookScript });
check('已有别人的钩子时拒绝覆盖（hook-exists）', clobber.ok === false && clobber.error === 'hook-exists', clobber);

/**
 * 用 plumbing 在指定仓库里造"包含任意路径"的真提交。
 * 为什么不用工作区：`.git/config` / `.git/hooks/pre-receive` / `A.txt`+`a.txt` 这些路径
 * 在真实工作区里根本加不进去（git 自己会拒绝），而攻击者送的正是这种树。
 * mktree 不接受带 `/` 的名字 → 目录层级要逐级建树。
 */
function mkCraft(container) {
  let seq = 0;
  const raw = (args, input) => spawnSync('git', args, { cwd: container, input, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  const blob = (content) => {
    const r = raw(['hash-object', '-w', '--stdin'], content);
    if (r.status !== 0) throw new Error(`hash-object failed: ${r.stderr}`);
    return r.stdout.trim();
  };
  const mktree = (lines) => {
    const r = raw(['mktree'], lines.map((l) => l + '\n').join(''));
    if (r.status !== 0) throw new Error(`mktree failed: ${r.stderr}`);
    return r.stdout.trim();
  };
  const writeTree = (map) => {
    const names = [...map.keys()].sort();
    return mktree(
      names.map((n) => {
        const node = map.get(n);
        return node.kind === 'blob' ? `${node.mode} blob ${node.sha}\t${n}` : `040000 tree ${writeTree(node.children)}\t${n}`;
      }),
    );
  };
  const treeFor = (files) => {
    const root = new Map();
    for (const f of files) {
      const segs = String(f.path).split('/');
      let cur = root;
      for (let i = 0; i < segs.length - 1; i++) {
        const seg = segs[i];
        if (!cur.has(seg)) cur.set(seg, { kind: 'tree', children: new Map() });
        const next = cur.get(seg);
        if (next.kind !== 'tree') throw new Error(`path conflict at ${seg}`);
        cur = next.children;
      }
      cur.set(segs[segs.length - 1], { kind: 'blob', mode: f.mode || '100644', sha: blob(f.content) });
    }
    return writeTree(root);
  };
  const commit = (tree, message, parent) => {
    seq += 1;
    const args = ['-c', 'user.name=ccarmy-verify', '-c', 'user.email=verify@example.test', 'commit-tree', tree, '-m', message || `c${seq}`];
    if (parent) args.push('-p', parent);
    const r = raw(args, undefined);
    if (r.status !== 0) throw new Error(`commit-tree failed: ${r.stderr}`);
    return r.stdout.trim();
  };
  const commitWithFiles = (files, message, parent) => commit(treeFor(files), message, parent);
  return { blob, mktree, treeFor, commit, commitWithFiles, raw };
}

const craftWork = mkCraft(work);
const craftBare = mkCraft(bare);

const goodCommit = craftWork.commitWithFiles([{ path: 'ok.txt', content: 'hello\n' }], 'safe commit');
check('plumbing 在推送方仓库造出安全提交（真对象）', /^[0-9a-f]{40}$/.test(goodCommit), goodCommit);
const nestedCommit = craftWork.commitWithFiles([{ path: 'a/.git/x', content: 'x\n' }], 'nested git dir');
check('plumbing 能造出嵌套 a/.git/x 的真树（逐级建树）', /^[0-9a-f]{40}$/.test(nestedCommit), nestedCommit);

const pushEnv = { CCARMY_PUSHER_ROLE: 'member' };
const push1 = git(work, ['push', bare, `${goodCommit}:refs/heads/proposals/ok`], { env: pushEnv });
check('安全提交推到提案分支：放行（退出码 0）', push1.code === 0, (push1.stderr || '').trim().split('\n').filter(Boolean).slice(-1)[0]);
check('放行时钩子打印 RESULT: pass', /RESULT: pass/.test(push1.stderr), /RESULT:.*/.exec(push1.stderr)?.[0]);
check('放行后服务端真的建出了该 ref', git(bare, ['rev-parse', '--verify', '--quiet', 'refs/heads/proposals/ok']).code === 0);

// 危险路径（逐条真实 push）
const dangerCases = [
  { label: '.git/hooks/pre-receive', files: [{ path: '.git/hooks/pre-receive', content: '#!/bin/sh\necho pwned\n' }], expect: 'git-hooks' },
  { label: '.git/config', files: [{ path: '.git/config', content: '[core]\n\thooksPath = /tmp/x\n' }], expect: 'git-config' },
  { label: '嵌套 a/.git/x', files: [{ path: 'a/.git/x', content: 'x\n' }], expect: 'git-internal' },
  { label: '.gitattributes 绑 filter 驱动', files: [{ path: '.gitattributes', content: '*.txt filter=evil\n' }], expect: 'git-attributes' },
  { label: '大小写别名碰撞 A.txt + a.txt', files: [{ path: 'A.txt', content: '1\n' }, { path: 'a.txt', content: '2\n' }], expect: 'collision' },
];
let dangerIdx = 0;
for (const c of dangerCases) {
  dangerIdx += 1;
  const sha = craftWork.commitWithFiles(c.files, `danger ${dangerIdx}`);
  const res = git(work, ['push', bare, `${sha}:refs/heads/proposals/d${dangerIdx}`], { env: pushEnv });
  check(`危险推送被拒：${c.label}`, res.code !== 0, `exit=${res.code}`);
  check(`拒绝原因含 ${c.expect}：${c.label}`, new RegExp(c.expect).test(res.stderr), (/\[(path|batch|ref|enumerate)\/[a-z-]+\][^\n]*/.exec(res.stderr) || [''])[0].slice(0, 130));
  check(`整批拒绝（服务端没有建出该 ref）：${c.label}`, git(bare, ['rev-parse', '--verify', '--quiet', `refs/heads/proposals/d${dangerIdx}`]).code !== 0);
  check(`拒绝时打印 RESULT: rejected：${c.label}`, /RESULT: rejected/.test(res.stderr));
}

// ref 规则
const mainPush = git(work, ['push', bare, `${goodCommit}:refs/heads/main`], { env: pushEnv });
check('成员推 refs/heads/main 被拒（主分支保护）', mainPush.code !== 0 && /main-branch-protected/.test(mainPush.stderr), mainPush.code);
check('主分支保护时给出可读原因（含提案分支提示）', /refs\/heads\/proposals\//.test(mainPush.stderr), (/\[ref\/[a-z-]+\][^\n]*/.exec(mainPush.stderr) || [''])[0].slice(0, 140));
const creatorPush = git(work, ['push', bare, `${goodCommit}:refs/heads/main`], { env: { CCARMY_PUSHER_ROLE: 'creator' } });
check('creator 推 main 放行（角色确实被读进来了）', creatorPush.code === 0, (creatorPush.stderr || '').trim().split('\n').filter(Boolean).slice(-1)[0]);
const mainAdvance = craftWork.commitWithFiles([{ path: 'ok.txt', content: 'hello again\n' }], 'advance main', goodCommit);
const memberUpdate = git(work, ['push', bare, `${mainAdvance}:refs/heads/main`], { env: pushEnv });
check('成员对已存在的 main 做更新（真正的新提交）仍被拒', memberUpdate.code !== 0 && /main-branch-protected/.test(memberUpdate.stderr), memberUpdate.code);
const memberNamespace = git(work, ['push', bare, `${goodCommit}:refs/heads/members/m-verify/own`], { env: { CCARMY_PUSHER_ROLE: 'member', CCARMY_PUSHER_ID: 'm-verify' } });
check('成员可推自己的命名空间 refs/heads/members/<id>/**', memberNamespace.code === 0, (memberNamespace.stderr || '').trim().split('\n').filter(Boolean).slice(-1)[0]);
const otherNamespace = git(work, ['push', bare, `${goodCommit}:refs/heads/members/someone-else/own`], { env: { CCARMY_PUSHER_ROLE: 'member', CCARMY_PUSHER_ID: 'm-verify' } });
check('成员推别人的命名空间被拒（成员 id 生效）', otherNamespace.code !== 0 && /ref-not-whitelisted/.test(otherNamespace.stderr), otherNamespace.code);

const secondCommit = craftWork.commitWithFiles([{ path: 'ok2.txt', content: 'second\n' }], 'unrelated root');
const nonFF = git(work, ['push', '--force', bare, `${secondCommit}:refs/heads/proposals/ok`], { env: pushEnv });
check('非快进更新提案分支被拒（isAncestor 判定生效）', nonFF.code !== 0 && /non-fast-forward/.test(nonFF.stderr), (/\[ref\/[a-z-]+\][^\n]*/.exec(nonFF.stderr) || [''])[0].slice(0, 140));

// 直接用 stdin 喂钩子（三列格式）：退出码必须真的反映结果
const hookViaStdin = (line, extraEnv = {}) =>
  run(process.execPath, [hookScript], { env: { ...process.env, GIT_DIR: bare, ...pushEnv, ...extraEnv }, input: `${line}\n` });
const stdinPass = hookViaStdin(`${ZERO} ${goodCommit} refs/heads/proposals/stdin-ok`);
check('stdin 直接调用钩子：合法推送退出码 0', stdinPass.code === 0, stdinPass.stdout.trim().split('\n').filter(Boolean).slice(-1)[0]);
check('stdin 调用打印 role/refs 摘要', /role=member/.test(stdinPass.stdout), /role=[^\n]*/.exec(stdinPass.stdout)?.[0]);
const stdinDangerSha = craftBare.commitWithFiles([{ path: '.git/config', content: 'x\n' }], 'stdin danger');
const stdinDanger = hookViaStdin(`${ZERO} ${stdinDangerSha} refs/heads/proposals/stdin-bad`);
check('stdin 直接调用钩子：危险路径退出码非 0', stdinDanger.code !== 0, `exit=${stdinDanger.code}`);
check('stdin 调用逐条打印拒绝原因', /git-config/.test(stdinDanger.stdout), (/\[path\/[a-z-]+\][^\n]*/.exec(stdinDanger.stdout) || [''])[0].slice(0, 130));
const stdinMain = hookViaStdin(`${ZERO} ${goodCommit} refs/heads/main`);
check('stdin 调用：成员推 main 退出码非 0', stdinMain.code !== 0 && /main-branch-protected/.test(stdinMain.stdout), `exit=${stdinMain.code}`);
const stdinEmpty = hookViaStdin('');
check('stdin 为空 → 整批拒绝（fail-closed，退出码非 0）', stdinEmpty.code !== 0 && /FATAL/.test(stdinEmpty.stdout), stdinEmpty.stdout.trim().split('\n')[1]);
const stdinBadRole = hookViaStdin(`${ZERO} ${goodCommit} refs/heads/proposals/stdin-role`, { CCARMY_PUSHER_ROLE: 'superuser' });
check('非法角色按最严的 member 处理（仍能正常判定）', stdinBadRole.code === 0 && /CCARMY_PUSHER_ROLE/.test(stdinBadRole.stdout), /CCARMY_PUSHER_ROLE[^\n]*/.exec(stdinBadRole.stdout)?.[0]?.slice(0, 90));

// 纯函数层：同一实现的直接调用（证明 CLI 只是入口）
const gitRunner = createGitRunner(bare);
const parsed = parsePreReceiveStdin(`  ${ZERO}   ${goodCommit}\t refs/heads/proposals/p \n\nbadline\n`);
check('parsePreReceiveStdin 解析三列并挑出坏行', parsed.refs.length === 1 && parsed.refs[0].ref === 'refs/heads/proposals/p' && parsed.malformed.length === 1, parsed);
const goodInBare = craftBare.commitWithFiles([{ path: 'ok.txt', content: 'hello\n' }], 'bare safe');
const collectedGood = collectPushEntries(gitRunner, { oldSha: ZERO, newSha: goodInBare, ref: 'refs/heads/proposals/p' });
check('collectPushEntries 用真 git 枚举出路径与 mode', collectedGood.entries.length === 1 && collectedGood.entries[0].path === 'ok.txt' && collectedGood.entries[0].mode === '100644', collectedGood.entries);
check('collectPushEntries 对删除 ref 不枚举路径', collectPushEntries(gitRunner, { oldSha: goodInBare, newSha: ZERO, ref: 'x' }).deleted === true);
const dangerPkg = craftBare.commitWithFiles(
  [
    { path: '.gitattributes', content: '*.txt filter=evil\n' },
    { path: 'link', content: '/etc/passwd', mode: '120000' },
    { path: '.git/hooks/post-receive', content: '#!/bin/sh\n' },
  ],
  'attrs+symlink+hook',
);
const collectedDanger = collectPushEntries(gitRunner, { oldSha: ZERO, newSha: dangerPkg, ref: 'refs/heads/proposals/p' });
const attrsEntry = collectedDanger.entries.find((e) => e.path === '.gitattributes');
const linkEntry = collectedDanger.entries.find((e) => e.path === 'link');
check('collectPushEntries 读了 .gitattributes 内容（cat-file 真读）', attrsEntry?.content === '*.txt filter=evil\n', attrsEntry?.content);
check('collectPushEntries 读了符号链接目标与 mode=120000', linkEntry?.mode === '120000' && linkEntry?.symlinkTarget === '/etc/passwd', linkEntry);
const pureResult = runPreReceive({ git: gitRunner, stdin: `${ZERO} ${dangerPkg} refs/heads/proposals/pure\n`, role: 'member', memberId: 'm1' });
check('runPreReceive（纯函数）整批拒绝', pureResult.ok === false, formatPreReceiveOutput(pureResult).filter(Boolean).slice(-1)[0]);
check(
  'runPreReceive 同时命中 .gitattributes / 符号链接逃逸 / 钩子路径',
  ['git-attributes', 'symlink-escape', 'git-hooks'].every((c) => pureResult.refs[0].pathRejected.some((r) => r.code === c)),
  pureResult.refs[0].pathRejected.map((r) => r.code),
);
check('runPreReceive 逐条原因非空（UI/hook 都能显示）', pureResult.refs[0].pathRejected.every((r) => typeof r.reason === 'string' && r.reason.length > 0));
const purePass = runPreReceive({ git: gitRunner, stdin: `${ZERO} ${goodInBare} refs/heads/proposals/pure2\n`, role: 'member', memberId: 'm1' });
check('runPreReceive 对合法推送放行', purePass.ok === true && purePass.refs[0].action === 'create', purePass.refs[0].action);
check('runPreReceive 记录角色与成员 id（逐 ref 校验用）', purePass.role === 'member' && purePass.memberId === 'm1');
const envResult = runPreReceive({ git: gitRunner, stdin: `${ZERO} ${goodInBare} refs/heads/main\n`, role: 'creator' });
check('runPreReceive: creator 推 main 放行（与 CLI 行为一致）', envResult.ok === true, envResult.refs[0].rejections.map((r) => r.code));
check('runPreReceive 报告跨 ref 批次校验与坏行字段', 'union' in pureResult && 'malformed' in pureResult, Object.keys(pureResult));

// 与 repo-guard 直调对照（证明 IPC 层与钩子层用的是同一实现）
const directRef = validateRefUpdate('refs/heads/main', ZERO, goodCommit, { role: 'member' });
check('validateRefUpdate 直调同样拒成员推 main', directRef.allowed === false && directRef.rejections[0].code === 'main-branch-protected', directRef.rejections.map((r) => r.code));
const directPaths = validatePushPaths([{ path: '.git/config', mode: '100644' }], { base: 'worktree' });
check('validatePushPaths 直调同样拒 .git/config', directPaths.allowed === false && directPaths.rejected[0].code === 'git-config', directPaths.rejected.map((r) => r.code));
check('危险路径用例数 ≥ 5（本节覆盖度）', dangerCases.length >= 5, dangerCases.length);
check('钩子没有改动全局 git config（只写目标仓库自己的 hooks/）', !/hooksPath/.test(git(work, ['config', '--global', '--get', 'core.hooksPath']).stdout) || git(work, ['config', '--global', '--get', 'core.hooksPath']).code !== 0, git(work, ['config', '--global', '--get', 'core.hooksPath']).stdout.trim() || '(unset)');
/* ════════════════════════════════════════════════════════════════════════════
   [6] 身份变更横幅（identityChanges 的数据形状）+ IPC 接线一致性
   ════════════════════════════════════════════════════════════════════════════ */

section('6. 身份变更横幅数据（真换证 + 真对端换证）');

// 本机换证：真的 rotate()（新密钥对 + 代次 +1 + 7 天联系信息冻结）
const idD = mkIdentity('d', PASS);
const infoD = idD.store.info();
const unlockD = idD.store.unlock(PASS);
check('第四把身份解锁（rotate 需要私钥）', unlockD.ok === true, unlockD);
const rot = idD.store.rotate({ reason: 'rotate', passphrase: PASS });
check('本机 rotate() 成功（真换证）', rot.ok === true, rot.ok ? rot.info.fingerprint : rot.error);
const infoD2 = idD.store.info();

const selfChanges = buildIdentityChangeEntries(idD.store, { now: Date.now(), acks: {} });
const selfEntry = selfChanges.find((c) => c.id.startsWith('self:'));
check('identityChanges 数据里出现本机换证条目', !!selfEntry, selfChanges.map((c) => c.id));
check('本机换证条目带旧/新指纹与代次', !!selfEntry && selfEntry.oldFingerprint === infoD?.fingerprint && selfEntry.newFingerprint === infoD2?.fingerprint && selfEntry.generation >= 2, selfEntry);
check('本机换证的 previousCard 来自本机留存历史（就是创建时那张）', selfEntry?.previousCard?.email === 'd@example.test', selfEntry?.previousCard);
check('本机换证后处于 7 天联系信息冻结期', selfEntry?.frozen === true && (selfEntry?.remainingMs ?? 0) > 6 * 24 * 3600_000, { frozen: selfEntry?.frozen, remainingMs: selfEntry?.remainingMs });
check('条目带 scopes（UI 靠它决定在三处都出横幅）', Array.isArray(selfEntry?.scopes) && selfEntry.scopes[0]?.kind === 'all', selfEntry?.scopes);
check('没有 ack 时条目不带 ack 字段', selfEntry?.ack === undefined);

// 对端换证：本机留存的 old/new 才是真相，声明里的 oldFingerprint **不得**被采用
const lieDecl = {
  schema: 'ccarmy.identity.rotation.v1',
  kind: 'ccarmy.identity.rotation',
  version: 1,
  algo: 'Ed25519',
  oldFingerprint: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ', // 攻击者可控数据：编一个"旧指纹"
  oldPublicKey: 'x',
  previousGeneration: 4,
  newFingerprint: 'CCCC-CCCC-CCCC-CCCC-CCCC',
  newPublicKey: 'x',
  generation: 5,
  issuedAt: Date.now(),
  signerFingerprint: 'CCCC-CCCC-CCCC-CCCC-CCCC',
  signature: 'x',
};
idA.store.recordPeerRotation(lieDecl);
const peerChanges = buildIdentityChangeEntries(idA.store, { now: Date.now(), acks: {} });
const peerNew = peerChanges.find((c) => c.newFingerprint === 'CCCC-CCCC-CCCC-CCCC-CCCC');
check('对端换证条目出现', !!peerNew, peerChanges.map((c) => c.id));
check('oldFingerprint 取自本机留存（空），**不是**声明里的 ZZZZ', peerNew?.oldFingerprint === '', { old: peerNew?.oldFingerprint, declOld: lieDecl.oldFingerprint });
check('对端条目的 previousCard 不来自声明（声明里根本没有联系方式）', peerNew?.previousCard?.email === undefined, peerNew?.previousCard);
const peerPair = peerChanges.find((c) => c.newFingerprint === 'BBBB-BBBB-BBBB-BBBB-BBBB-2');
check('同一 receivedAt 的新旧两条只出一个横幅，且指认新指纹', !!peerPair && peerPair.oldFingerprint === infoB?.fingerprint, { entry: peerPair?.newFingerprint, old: peerPair?.oldFingerprint });
check('成对条目的 previousCard 仍是本机留存的那张旧名片', peerPair?.previousCard?.email === 'b@example.test', peerPair?.previousCard);
check('对端换证条目处于冻结期', peerPair?.frozen === true, peerPair?.frozen);
check('aci 生效：已「已核实」的条目带 verifiedAt', buildIdentityChangeEntries(idA.store, { now: Date.now(), acks: { [String(peerPair?.id)]: { level: 'verified', at: 12345, auditId: 'a' } } }).find((c) => c.id === peerPair?.id)?.ack?.verifiedAt === 12345);
check('ack=dismiss 对应 dismissedAt（同一个 store 的条目 id）', buildIdentityChangeEntries(idD.store, { now: Date.now(), acks: { [String(selfEntry?.id)]: { level: 'dismiss', at: 99, auditId: 'a' } } }).find((c) => c.id === selfEntry?.id)?.ack?.dismissedAt === 99);
check('identityStore 为空时返回空数组（不抛）', buildIdentityChangeEntries(null).length === 0);
check('条目按时间倒序', peerChanges.every((c, i) => i === 0 || peerChanges[i - 1].ts >= c.ts));

section('7. IPC 接线一致性（静态检查；行为验证需要 Electron 运行环境，本机无头跑不了 → 如实标注）');

const mainSrc = fs.readFileSync(path.join(selfDir, '..', 'src', 'electron-main.ts'), 'utf8');
const preloadSrc = fs.readFileSync(path.join(selfDir, '..', 'src', 'preload.cjs'), 'utf8');

const CHANNELS = [
  'ccarmy:identity-changes',
  'ccarmy:identity-change-ack',
  'ccarmy:identity-peers',
  'ccarmy:net-status',
  'ccarmy:net-probe',
  'ccarmy:net-local-address',
  'ccarmy:net-members-presence',
  'ccarmy:net-mesh-enable',
  'ccarmy:net-mesh-disable',
  'ccarmy:lan-start',
  'ccarmy:lan-stop',
  'ccarmy:lan-send',
  'ccarmy:lan-inbox',
  'ccarmy:lan-status',
  'ccarmy:lan-dual-smoke',
  'ccarmy:mesh-start',
  'ccarmy:mesh-stop',
  'ccarmy:mesh-broadcast',
  'ccarmy:mesh-inbox',
  'ccarmy:mesh-status',
  'ccarmy:repo-guard-check-ref',
  'ccarmy:repo-guard-check-paths',
  'ccarmy:repo-guard-pre-receive',
  'ccarmy:repo-guard-install-hooks',
  'ccarmy:lease-acquire',
  'ccarmy:lease-release',
  'ccarmy:lease-list',
  'ccarmy:lease-check',
];
// handleIpc 允许换行写法（handleIpc(\n  'ccarmy:x', ...）→ 只要通道字面量出现在主进程即可
const missingMain = CHANNELS.filter((c) => !mainSrc.includes(`'${c}'`));
check('主进程至少注册了 28 个 handleIpc 调用', (mainSrc.match(/handleIpc\(/g) ?? []).length >= 28, (mainSrc.match(/handleIpc\(/g) ?? []).length);
const missingPreload = CHANNELS.filter((c) => !preloadSrc.includes(`'${c}'`));
check('全部 28 条通道在主进程都注册了', missingMain.length === 0, missingMain);
check('全部 28 条通道都在 preload 白名单里（否则渲染进程拿不到）', missingPreload.length === 0, missingPreload);

const UI_API = ['identityChanges', 'identityChangeAcknowledge', 'identityPeers', 'netStatus', 'netProbe', 'netLocalAddress', 'netMembersPresence', 'meshEnable', 'meshDisable'];
const missingApi = UI_API.filter((n) => !new RegExp(`\\b${n}: `).test(preloadSrc));
check('UI 调用的 9 个 window.ccarmy 函数名都在 preload 里', missingApi.length === 0, missingApi);
check('UI 契约里的旧 API 一个都没删（meshStart/meshStop/meshStatus）', ['meshStart', 'meshStop', 'meshStatus', 'lanStart', 'lanDualSmoke'].every((n) => new RegExp(`\\b${n}: `).test(preloadSrc)));
const mainNoComments = mainSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/.*$/gm, '');
check(
  '主进程代码（已剥注释）不再引用旧的明文 TCP 类（LanSyncServer/LanSyncClient/MeshNode/LanDiscovery）',
  !/\b(LanSyncServer|LanSyncClient|MeshNode|LanDiscovery)\b/.test(mainNoComments),
  /\b(LanSyncServer|LanSyncClient|MeshNode|LanDiscovery)\b/.exec(mainNoComments)?.[0] ?? 'none',
);
check('主进程仍用 PeerRegistry（它只是地址簿，无鉴权语义）', /PeerRegistry/.test(mainSrc));
check('主进程把 ReplayGuard 的持久化交给 net-wiring（userData 下）', /ensureNetDir/.test(mainSrc) && fs.readFileSync(path.join(selfDir, '..', 'src', 'net-wiring.ts'), 'utf8').includes('persistFile'));
check('主进程没有中文界面文案新增（只回结构化数据/错误码）', !/\b(成功|失败|请先|已解锁)\b/.test(mainSrc.split('// ── D. 身份变更横幅')[1] ?? ''));
check('i18n 两侧都有 net.note.* 键且对齐', (() => {
  const zh = JSON.parse(fs.readFileSync(path.join(selfDir, '..', 'src', 'i18n', 'zh-CN.json'), 'utf8'));
  const en = JSON.parse(fs.readFileSync(path.join(selfDir, '..', 'src', 'i18n', 'en-US.json'), 'utf8'));
  const keys = Object.keys(zh).filter((k) => k.startsWith('net.note.'));
  return keys.length === 3 && keys.every((k) => typeof en[k] === 'string' && en[k].length > 0);
})());
check('英文包里 net.note.* 不含中文', (() => {
  const en = JSON.parse(fs.readFileSync(path.join(selfDir, '..', 'src', 'i18n', 'en-US.json'), 'utf8'));
  return Object.keys(en).filter((k) => k.startsWith('net.note.')).every((k) => !/[\u4e00-\u9fff]/.test(en[k]));
})());



/* ════════════════════════════════════════════════════════════════════════════
   [5] 租约
   ════════════════════════════════════════════════════════════════════════════ */

section('5. 租约（第二持有者被拒 / 过期可获取 / 无租约禁写）');

let clock = 1_000_000;
const leases = new LeaseRegistry({ now: () => clock });
const acq1 = leases.acquire({ holder: 'fp-A', kind: 'dir', scope: 'src', paths: ['src'], ttlMs: 60_000 });
check('A 申请目录租约成功', acq1.ok === true && !!acq1.lease, acq1.error);
check('租约覆盖路径被归一化（src）', acq1.lease?.paths[0] === 'src', acq1.lease?.paths);
check('A 写入自己租约覆盖的路径被放行', leases.checkWrite('fp-A', 'src/a.ts').allowed === true, leases.checkWrite('fp-A', 'src/a.ts').reason);

const acq2 = leases.acquire({ holder: 'fp-B', kind: 'dir', scope: 'src/sub', paths: ['src/sub'], ttlMs: 60_000 });
check('B 申请同一「本体」下的重叠路径被拒（held-by-other）', acq2.ok === false && acq2.error?.code === 'held-by-other', acq2.error);
check('被拒时给出当前持有者（可读原因）', (acq2.conflicts ?? []).some((c) => c.holder === 'fp-A'), acq2.conflicts);
check(
  'B 写入被 A 持有、且自己没租约的路径被拒（held-by-other，比 no-lease 更具体）',
  leases.checkWrite('fp-B', 'src/a.ts').allowed === false && leases.checkWrite('fp-B', 'src/a.ts').code === 'held-by-other',
  leases.checkWrite('fp-B', 'src/a.ts').code,
);
check(
  'B 写入无人持有、但自己也没有租约的路径被拒（no-lease）',
  leases.checkWrite('fp-B', 'docs/x.md').allowed === false && leases.checkWrite('fp-B', 'docs/x.md').code === 'no-lease',
  leases.checkWrite('fp-B', 'docs/x.md').code,
);
check('大小写路径也视为同一文件（SRC/A.TS 被 A 的租约覆盖）', leases.checkWrite('fp-A', 'SRC/A.TS').allowed === true);

clock += 61_000; // 过期
const afterExpiry = leases.acquire({ holder: 'fp-B', kind: 'dir', scope: 'src/sub', paths: ['src/sub'], ttlMs: 60_000 });
check('租约过期后 B 可以拿到', afterExpiry.ok === true, afterExpiry.error);
check('过期时 A 的写入被明确判为 expired（提示重新申请）', leases.checkWrite('fp-A', 'src/a.ts').code === 'expired', leases.checkWrite('fp-A', 'src/a.ts').reason);
check('过期租约进了留痕（可审计）', leases.expiredHistory().length >= 1, leases.expiredHistory().length);

const rel = leases.release({ holder: 'fp-B', leaseId: afterExpiry.lease?.id });
check('B 正常释放自己的租约', rel.ok === true && rel.released === true, rel.error);
const merged = leases.acquire({ holder: 'fp-A', kind: 'dir', scope: 'src', paths: ['src'], ttlMs: 60_000 });
check('重新申请（自己无重叠）成功', merged.ok === true, merged.error);
const crossRelease = leases.release({ holder: 'fp-B', leaseId: merged.lease?.id });
check('越权释放别人的租约被拒（holder-mismatch）', crossRelease.ok === false && crossRelease.error?.code === 'holder-mismatch', crossRelease.error);
const invalid = leases.acquire({ holder: 'fp-C', paths: ['../escape'] });
check('非法路径的租约申请被拒（path-invalid）', invalid.ok === false && invalid.error?.code === 'path-invalid', invalid.error);
check('stats 反映活跃租约数', leases.stats().active >= 1, leases.stats());
const batch = leases.checkWriteBatch('fp-A', ['src/a.ts', 'src/b.ts']);
check('批量写入门禁：全覆盖时放行', batch.allowed === true);
const batchDeny = leases.checkWriteBatch('fp-D', ['docs/x.md']);
check('批量写入门禁：任一被拒即整体拒绝（no-lease）', batchDeny.allowed === false && batchDeny.denied?.code === 'no-lease', batchDeny.denied?.code);
const batchDenyHeld = leases.checkWriteBatch('fp-D', ['docs/x.md', 'src/a.ts']);
check('批量写入门禁报告「第一个被拒的路径」', batchDenyHeld.allowed === false && batchDenyHeld.denied?.path === 'docs/x.md', batchDenyHeld.denied?.path);
check('空路径列表按 fail-closed 拒绝', leases.checkWriteBatch('fp-D', []).allowed === false);

/* ──────────────────────────────────────────────────────────────────────────── */

console.log('\n================ wiring 验证总览 ================');
console.log(`  通过 ${pass} 项，失败 ${fail} 项`);
if (failures.length) console.log(`  失败项：${failures.join(' | ')}`);
console.log(`结果：${pass} 通过 / ${fail} 失败`);
if (!keep) {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* 临时目录删不掉不影响结论 */
  }
} else {
  console.log(`  （--keep：临时目录保留在 ${tmpRoot}）`);
}
process.exit(fail === 0 ? 0 : 1);
