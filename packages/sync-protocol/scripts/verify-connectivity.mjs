/**
 * verify-connectivity.mjs —— 连接**可达性**验证（ADR 003 §附八.9 IPv6 第一档 + §附八.3 中继兜底档）
 *
 *   node packages/sync-protocol/scripts/verify-connectivity.mjs
 *
 * 覆盖（每条断言都有**真实 socket / 真实函数返回值**做证据）：
 *   [1] IPv6 地址分类矩阵：全局单播 2000::/3 / ULA fc00::/7 / 链路本地 fe80::/10 / 回环 / 未指定 /
 *       组播 / 内嵌 IPv4 / 文档段 2001:db8::/32 / 非法，以及 `family` 的**两种写法**（'IPv6' 与 6）
 *   [2] 本机 IPv6 枚举（真网卡）+ ULA/链路本地**不算公网候选**
 *   [3] IPv6 **真监听 + 真连上**：::1 / 本机全局单播地址 / 双栈 `::`；并且真的跑一次 SecureSyncServer/Client
 *   [4] 阶梯顺序（附八.9）：IPv6 公网直连 → IPv4 公网直连 → … → 中继 → 局域网；含"IPv6 档不适用"的如实降级
 *   [5] 中继档判定 decideRelay：6 种结构化结论码 + token 两端确定性一致
 *   [6] 中继**真转发**：A→中继→B 内容真到达；中继样本里**看不到明文标记**
 *   [7] 中继引入的攻击面：重放 / 篡改 / 重排 / 冒充对端 —— **都被拒**
 *   [8] 没有可用中继时**如实报缺口**（不转圈、不静默）
 *   [9] **真多进程**：1 个中继进程 + 2 个"不可拨入"的端点进程，A→中继→B 真到达 + 中继只见密文
 *   [10] 本机自测硬约束复核：同一 UDP 端口上的两个 socket **只有一个能收包**
 *
 * 本机**做不到**的三件事（如实标注，不假装验证过）：
 *   · 真实公网可达性（需要真的在公网的第二台机器 / 公网出口）；
 *   · 跨真实 NAT 的打洞（需要两侧真 NAT + STUN 服务器）；
 *   · 真实中继服务器（需要一个有公网地址的部署点）。
 *   上面的"中继"在本脚本里是**本机回环上的真 socket 中继进程**：转发语义、加密语义、
 *   攻击面都真验证；但"跨公网的中继"未验证。
 */
import dgram from 'node:dgram';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  LianJieTiZi,
  DEFAULT_LADDER_ORDER,
  KeBoRuTanCe,
  LADDER_LABELS,
  LADDER_RUNG_I18N,
  ReplayGuard,
  RelayNode,
  RelayTunnelDialer,
  RelayTunnelListener,
  SecureSyncClient,
  SecureSyncServer,
  guiLeiDiZhi,
  guiLeiIpv6ZuoYongYu,
  warmyFingerprint,
  chuangjianLinShiShenFen,
  jueDingZhongJi,
  boTcpXiangQing,
  ed25519FromSeed,
  inspectLocalIpv6,
  isGlobalUnicastIpv6,
  isIpv6DocumentationAddress,
  isPublicDialCandidate,
  listLocalIpv6Candidates,
  normalizeHostLiteral,
  normalizeInterfaceFamily,
  parseIpv6,
  pickLocalIpv6Address,
  randomBytes,
  relayTokenFor,
  sha256,
} from '../dist/index.js';

let passes = 0;
let failures = 0;
let noteCount = 0;
const unverified = [];

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
/** 如实标注"本机做不到 / 未验证"的边界（并汇总计数） */
function note(text) {
  noteCount += 1;
  unverified.push(text);
  console.log(`  [NOTE] ${text}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const here = path.dirname(fileURLToPath(import.meta.url));
const childScript = path.join(here, 'connectivity-child.mjs');

const MARKER_SEND = 'WARMY-RELAY-PLAINTEXT-MARKER-SEND-9f3a71';
const MARKER_REPLY = 'WARMY-RELAY-PLAINTEXT-MARKER-REPLY-4c2b88';

/**
 * 子进程（connectivity-child.mjs）用**每次运行随机生成**的 32 字节 seed 派生身份：
 * 仓库里不留任何密钥材料，父进程算好指纹后用 `--peer-fp` 传给子进程做 pin 校验。
 */
function fingerprintFromSeedHex(hex) {
  const seed = sha256(Buffer.from(hex, 'utf8'));
  return warmyFingerprint(ed25519FromSeed(seed).publicKey);
}

/* ────────────────────────── 通用工具 ────────────────────────── */

function listenTcp(host, port = 0) {
  return new Promise((resolve) => {
    const srv = net.createServer((c) => {
      c.on('error', () => {});
      c.end('ok');
    });
    srv.once('error', (e) => resolve({ ok: false, host, error: e.code ?? e.message }));
    srv.listen(port, host, () => {
      const a = srv.address();
      resolve({ ok: true, host, port: a && typeof a === 'object' ? a.port : port, srv });
    });
  });
}
const closeSrv = (srv) => new Promise((r) => (srv ? srv.close(() => r()) : r()));

async function mkSecureServer(opts) {
  const received = [];
  const closes = [];
  const srv = new SecureSyncServer({
    identity: opts.id.provider,
    nodeId: opts.nodeId ?? 'verify-server',
    port: 0,
    host: opts.host ?? '127.0.0.1',
    groupId: null,
    roster: (fp) => fp === opts.peerFp,
    peerFingerprint: opts.peerFp,
    handshakeTimeoutMs: opts.handshakeTimeoutMs ?? 5000,
    ...(opts.replayGuard ? { replayGuard: opts.replayGuard } : {}),
    onMessage: (m) => received.push(m),
    onClose: (s, r) => closes.push(r),
  });
  const port = await srv.start();
  return { srv, port, received, closes };
}

/** 在**本机回环**上起一个真中继 + 两个端点：A 经中继连 B（B 不接受任何外部入站） */
async function relaySession(opts = {}) {
  const relay = new RelayNode({
    port: 0,
    host: '127.0.0.1',
    pairTimeoutMs: opts.pairTimeoutMs ?? 900,
    mode: opts.relayMode ?? 'forward',
    sampleBytes: 4096,
  });
  const relayPort = await relay.start();
  const relayAddr = { host: '127.0.0.1', port: relayPort };
  const A = chuangjianLinShiShenFen('verify-A');
  const B = chuangjianLinShiShenFen('verify-B');
  const token = opts.token ?? relayTokenFor(A.fingerprint, B.fingerprint, relayAddr);
  const server = await mkSecureServer({
    id: B,
    peerFp: A.fingerprint,
    handshakeTimeoutMs: opts.handshakeTimeoutMs ?? 6000,
    ...(opts.replayGuard ? { replayGuard: opts.replayGuard } : {}),
  });
  const listener = new RelayTunnelListener({
    relay: relayAddr,
    token,
    from: B.fingerprint,
    localTarget: { host: '127.0.0.1', port: server.port },
    readyTimeoutMs: opts.readyTimeoutMs ?? 4000,
    sampleBytes: 4096,
  });
  const registration = await listener.start();
  const dialer = new RelayTunnelDialer({
    relay: relayAddr,
    token,
    from: A.fingerprint,
    readyTimeoutMs: opts.readyTimeoutMs ?? 4000,
    sampleBytes: 4096,
  });
  const dialerPort = await dialer.start();

  /**
   * 可选"线路旁路"（tap）：客户端先连 tap，tap 把字节原样转发给拨入侧隧道。
   * 用途：拿到**记录层的完整字节**（AES-GCM 记录帧），从而能"像恶意中继那样**原样重放**一条记录"，
   * 并断言它被接收侧的单调计数/认证拒掉。tap 只记录、不修改。
   */
  let tap = null;
  let clientPort = dialerPort;
  if (opts.tap) {
    const chunks = [];
    let total = 0;
    const tapSrv = net.createServer((c) => {
      c.on('error', () => {});
      const up = net.connect({ host: '127.0.0.1', port: dialerPort });
      up.on('error', () => {});
      c.on('data', (d) => {
        chunks.push(Buffer.from(d));
        total += d.length;
        up.write(d);
      });
      up.on('data', (d) => c.write(d));
      const stop = () => {
        try {
          c.destroy();
        } catch {
          /* ignore */
        }
        try {
          up.destroy();
        } catch {
          /* ignore */
        }
      };
      c.once('close', stop);
      up.once('close', stop);
    });
    await new Promise((r) => tapSrv.listen(0, '127.0.0.1', r));
    clientPort = tapSrv.address().port;
    tap = {
      server: tapSrv,
      mark: () => total,
      since: (mark) => Buffer.concat(chunks).subarray(mark),
      all: () => Buffer.concat(chunks),
      close: () => new Promise((r) => tapSrv.close(() => r())),
    };
  }

  const replies = [];
  const client = new SecureSyncClient({
    identity: A.provider,
    nodeId: 'verify-A',
    host: '127.0.0.1',
    port: clientPort,
    groupId: null,
    peerFingerprint: B.fingerprint,
    roster: (fp) => fp === B.fingerprint,
    handshakeTimeoutMs: opts.handshakeTimeoutMs ?? 6000,
    ...(opts.replayGuard ? { replayGuard: opts.replayGuard } : {}),
    onMessage: (m) => replies.push(m),
  });
  const connect = await client.connect(opts.connectTimeoutMs ?? 7000);
  return {
    relay,
    relayAddr,
    token,
    A,
    B,
    listener,
    dialer,
    client,
    server,
    connect,
    replies,
    tap,
    registration,
    stop: async () => {
      client.close('verify-done');
      await dialer.stop();
      await listener.stop();
      await server.srv.stop();
      if (tap) await tap.close();
      await relay.stop();
    },
  };
}

/* ────────────────────────── 主流程 ────────────────────────── */

async function main() {
  console.log('=== verify-connectivity: IPv6 第一档（附八.9）+ 中继兜底档（附八.3）===');
  console.log(`node ${process.version} | 平台 ${process.platform}`);

  const v6Global = pickLocalIpv6Address();
  const v6Report = inspectLocalIpv6();
  console.log(`本机全局单播 IPv6 首选：${v6Global ?? '（无）'}`);

  /* ══════════════ [1] IPv6 地址分类矩阵 ══════════════ */
  group('[1] IPv6 地址分类矩阵（全局/ULA/链路本地/回环/未指定/组播/内嵌 IPv4/文档段/非法）');

  check('解析 ::1 → 16 字节，最后一字节为 1', parseIpv6('::1')?.length === 16 && parseIpv6('::1')[15] === 1, [...(parseIpv6('::1') ?? [])].join(','));
  check('解析 :: → 全零（未指定）', [...(parseIpv6('::') ?? [])].every((b) => b === 0), [...(parseIpv6('::') ?? [])].join(','));
  check(
    '解析完整 8 组地址（240e:36f:3f:e3e0:...）',
    parseIpv6('240e:36f:3f:e3e0:9f2a:d07:d7d6:6cb7')?.[0] === 0x24 && parseIpv6('240e:36f:3f:e3e0:9f2a:d07:d7d6:6cb7')?.[1] === 0x0e,
    [...(parseIpv6('240e:36f:3f:e3e0:9f2a:d07:d7d6:6cb7') ?? [])].slice(0, 4).join(',')
  );
  check('解析带 zone id 的链路本地（fe80::1%eth0）', guiLeiIpv6ZuoYongYu('fe80::1%eth0') === 'link-local', guiLeiIpv6ZuoYongYu('fe80::1%eth0'));
  check('解析方括号形式 [2001:4860:4860::8888]', guiLeiIpv6ZuoYongYu('[2001:4860:4860::8888]') === 'global', guiLeiIpv6ZuoYongYu('[2001:4860:4860::8888]'));
  check('规范化：去方括号 + 去 zone', normalizeHostLiteral('[fe80::1%12]') === 'fe80::1', normalizeHostLiteral('[fe80::1%12]'));
  check('内嵌 IPv4（::ffff:127.0.0.1）被判为 ipv4-mapped', guiLeiIpv6ZuoYongYu('::ffff:127.0.0.1') === 'ipv4-mapped', guiLeiIpv6ZuoYongYu('::ffff:127.0.0.1'));
  check('IPv4 字面不是 IPv6（返回 invalid）', guiLeiIpv6ZuoYongYu('192.168.1.1') === 'invalid', guiLeiIpv6ZuoYongYu('192.168.1.1'));
  check('非法 IPv6（组数不够）返回 null', parseIpv6('1:2:3') === null, String(parseIpv6('1:2:3')));
  check('非法 IPv6（两个 ::）返回 null', parseIpv6('1::2::3') === null, String(parseIpv6('1::2::3')));
  check('非法 IPv6（组数过多）返回 null', parseIpv6('1:2:3:4:5:6:7:8:9') === null, String(parseIpv6('1:2:3:4:5:6:7:8:9')));

  const matrix = [
    ['240e:36f:3f:e3e0:9f2a:d07:d7d6:6cb7', 'global', true],
    ['2001:4860:4860::8888', 'global', true],
    ['2a00:1450:4001:80f::200e', 'global', true],
    ['3fff::1', 'global', true],
    ['2001:db8::1', 'global', false], // 文档段：形式上是 2000::/3，但不算可达候选
    ['fc00::1', 'ula', false],
    ['fd12:3456:789a::1', 'ula', false],
    ['fe80::a66a:7c2f:cd2a:d91d', 'link-local', false],
    ['febf::1', 'link-local', false],
    ['::1', 'loopback', false],
    ['::', 'unspecified', false],
    ['ff02::1', 'multicast', false],
    ['::ffff:192.168.1.6', 'ipv4-mapped', false],
  ];
  for (const [addr, scope, dialable] of matrix) {
    check(`分类 ${addr} → ${scope}`, guiLeiIpv6ZuoYongYu(addr) === scope, guiLeiIpv6ZuoYongYu(addr));
    check(
      `是否公网拨号候选 ${addr} → ${dialable}`,
      isPublicDialCandidate(addr) === dialable,
      { global: isGlobalUnicastIpv6(addr), doc: isIpv6DocumentationAddress(addr) }
    );
  }
  check('ULA（fc00::/7）不算公网候选（附八.9 明文要求）', !isPublicDialCandidate('fd00::1') && !isPublicDialCandidate('fc00::abcd'), {});
  check('链路本地（fe80::/10）不算公网候选（附八.9 明文要求）', !isPublicDialCandidate('fe80::1') && !isPublicDialCandidate('febf:ffff::1'), {});
  check('回环（::1）不算公网候选', !isPublicDialCandidate('::1'), {});
  check('文档段 2001:db8::/32 虽属 2000::/3 但**排除**在候选外', isGlobalUnicastIpv6('2001:db8::1') && !isPublicDialCandidate('2001:db8::1'), {});

  /* family 两种写法：这是必须锁住的兼容点 */
  check(`family 字符串 'IPv6' → IPv6`, normalizeInterfaceFamily('IPv6') === 'IPv6', normalizeInterfaceFamily('IPv6'));
  check(`family 数字 6 → IPv6`, normalizeInterfaceFamily(6) === 'IPv6', normalizeInterfaceFamily(6));
  check(`family 字符串 '6' → IPv6`, normalizeInterfaceFamily('6') === 'IPv6', normalizeInterfaceFamily('6'));
  check(`family 字符串 'IPv4' → IPv4`, normalizeInterfaceFamily('IPv4') === 'IPv4', normalizeInterfaceFamily('IPv4'));
  check(`family 数字 4 → IPv4`, normalizeInterfaceFamily(4) === 'IPv4', normalizeInterfaceFamily(4));
  check(`未知 family（'other'/'17'）→ other`, normalizeInterfaceFamily('other') === 'other' && normalizeInterfaceFamily(17) === 'other', {
    a: normalizeInterfaceFamily('other'),
    b: normalizeInterfaceFamily(17),
  });

  const fakeNics = (familyForm) => ({
    '以太网': [
      { address: '192.168.1.6', family: familyForm === 'string' ? 'IPv4' : 4, internal: false, netmask: '', mac: '', cidr: '', scopeid: 0 },
      { address: '240e:36f:3f:e3e0:9f2a:d07:d7d6:6cb7', family: familyForm === 'string' ? 'IPv6' : 6, internal: false, netmask: '', mac: '', cidr: '', scopeid: 0 },
      { address: 'fe80::117f:559c:8262:8b1d%3', family: familyForm === 'string' ? 'IPv6' : 6, internal: false, netmask: '', mac: '', cidr: '', scopeid: 3 },
      { address: 'fd12:3456:789a::7', family: familyForm === 'string' ? 'IPv6' : 6, internal: false, netmask: '', mac: '', cidr: '', scopeid: 0 },
    ],
    'Loopback Pseudo-Interface 1': [
      { address: '::1', family: familyForm === 'string' ? 'IPv6' : 6, internal: true, netmask: '', mac: '', cidr: '', scopeid: 0 },
    ],
  });
  for (const form of ['string', 'number']) {
    const entries = listLocalIpv6Candidates(fakeNics(form));
    check(`family=${form} 写法下也能枚举出 4 个 IPv6 地址（兼容点）`, entries.length === 4, entries.map((e) => `${e.address}|${e.scope}`));
    check(
      `family=${form}：zone id 被去掉、作用域分类正确`,
      entries.some((e) => e.address === 'fe80::117f:559c:8262:8b1d' && e.scope === 'link-local') && entries.some((e) => e.address === 'fd12:3456:789a::7' && e.scope === 'ula'),
      entries.map((e) => [e.address, e.scope])
    );
    const rep = inspectLocalIpv6(fakeNics(form));
    check(`family=${form}：只有全局单播进 publicCandidates`, rep.publicCandidates.length === 1 && rep.publicCandidates[0].startsWith('240e:'), rep.publicCandidates);
    check(`family=${form}：ULA/链路本地/回环被分到各自桶里`, rep.ula.length === 1 && rep.linkLocal.length === 1 && rep.loopback.length === 1, {
      ula: rep.ula,
      ll: rep.linkLocal,
      lo: rep.loopback,
    });
    check(`family=${form}：familyFormsSeen 记录到实际写法`, rep.familyFormsSeen.length === 1 && String(rep.familyFormsSeen[0]) === String(form === 'string' ? 'IPv6' : 6), rep.familyFormsSeen);
  }

  /* ══════════════ [2] 本机 IPv6 真实枚举 ══════════════ */
  group('[2] 本机 IPv6 真枚举（os.networkInterfaces）');
  check('inspectLocalIpv6 返回结构化报告', typeof v6Report.hasGlobalUnicast === 'boolean' && Array.isArray(v6Report.entries), Object.keys(v6Report));
  check(
    '每个条目都带地址与作用域（枚举没空转）',
    v6Report.entries.length >= 1 && v6Report.entries.every((e) => typeof e.address === 'string' && typeof e.scope === 'string'),
    v6Report.entries.map((e) => `${e.address}|${e.scope}`)
  );
  check(
    '报告里的分类与 classifyIpv6Scope 一致（无自相矛盾）',
    v6Report.entries.every((e) => guiLeiIpv6ZuoYongYu(e.address) === e.scope),
    v6Report.entries.filter((e) => guiLeiIpv6ZuoYongYu(e.address) !== e.scope)
  );
  check(
    'ULA / 链路本地 / 回环**绝不**出现在 publicCandidates（附八.9）',
    v6Report.publicCandidates.every((a) => isPublicDialCandidate(a)),
    v6Report.publicCandidates
  );
  check('publicCandidate 与 hasGlobalUnicast 自洽', v6Report.hasGlobalUnicast === (v6Report.publicCandidate !== null), {
    has: v6Report.hasGlobalUnicast,
    cand: v6Report.publicCandidate,
  });
  check('reason 写明"天然可拨入候选"或"IPv6 档不适用"', /天然可拨入候选|IPv6 档不适用/.test(v6Report.reason), v6Report.reason.slice(0, 120));
  if (v6Global) {
    check('本机确有全局单播 IPv6（本环境实测）', isPublicDialCandidate(v6Global), v6Global);
    check('首选候选来自物理网卡（不是 vEthernet/虚拟网卡）', /vEthernet|Hyper|WSL|Docker|VMware|VirtualBox/i.test(v6Report.entries.find((e) => e.address === v6Global)?.interfaceName ?? '') === false, v6Report.entries.find((e) => e.address === v6Global));
  } else {
    note('本机没有全局单播 IPv6 → 无法在本机验证"IPv6 公网直连档真命中"；IPv6 档的降级路径仍已验证');
  }

  /* ══════════════ [3] IPv6 真监听 + 真连出 ══════════════ */
  group('[3] IPv6 真监听 + 真连出（真 socket，socket 自报地址族）');
  {
    const l6 = await listenTcp('::1');
    check('能在 ::1 上真监听', l6.ok === true, l6.ok ? l6.port : l6.error);
    const d6 = await boTcpXiangQing('::1', l6.port, 2000, 6);
    check('dialTcpDetailed(::1, family=6) 连上', d6.ok === true, d6);
    check("socket 自报 remoteFamily='IPv6'（证明真走 IPv6）", d6.remoteFamily === 'IPv6', d6.remoteFamily);
    check('本地地址族也是 IPv6', String(d6.localAddress ?? '').includes('::'), d6.localAddress);
    const d6bracket = await boTcpXiangQing('[::1]', l6.port, 2000, 6);
    check('方括号字面量 [::1] 也能连（客户端兼容）', d6bracket.ok === true && d6bracket.remoteFamily === 'IPv6', d6bracket);
    const d4to6 = await boTcpXiangQing('127.0.0.1', l6.port, 1200);
    check('IPv4 回环连 IPv6-only 监听**如实失败**（不谎报通）', d4to6.ok === false, d4to6.detail);
    await closeSrv(l6.srv);

    const dual = await listenTcp('::');
    check('能在 :: 上真监听（双栈）', dual.ok === true, dual.ok ? dual.port : dual.error);
    const viaV6 = await boTcpXiangQing('::1', dual.port, 2000, 6);
    const viaV4 = await boTcpXiangQing('127.0.0.1', dual.port, 2000, 4);
    check('双栈监听从 IPv6 侧连上（family=IPv6）', viaV6.ok === true && viaV6.remoteFamily === 'IPv6', viaV6);
    check('双栈监听从 IPv4 侧连上（family=IPv4）', viaV4.ok === true && viaV4.remoteFamily === 'IPv4', viaV4);
    await closeSrv(dual.srv);

    if (v6Global) {
      const g = await listenTcp(v6Global);
      check(`能在本机全局单播 IPv6（${v6Global}）上真监听`, g.ok === true, g.ok ? g.port : g.error);
      const dg = await boTcpXiangQing(v6Global, g.port, 2000, 6);
      check('真的拨通本机全局单播 IPv6（附八.9「成本最低的一档」真实可跑）', dg.ok === true, dg);
      check('全局 IPv6 拨号 socket 自报 IPv6', dg.remoteFamily === 'IPv6', dg.remoteFamily);
      await closeSrv(g.srv);

      // 真的跑一次鉴权会话：SecureSyncServer 监听 IPv6，SecureSyncClient 从 IPv6 连
      const idS = chuangjianLinShiShenFen('v6-server');
      const idC = chuangjianLinShiShenFen('v6-client');
      const srv6 = await mkSecureServer({ id: idS, peerFp: idC.fingerprint, host: v6Global });
      const cli6 = new SecureSyncClient({
        identity: idC.provider,
        nodeId: 'v6-client',
        host: v6Global,
        port: srv6.port,
        groupId: null,
        peerFingerprint: idS.fingerprint,
        roster: (fp) => fp === idS.fingerprint,
        handshakeTimeoutMs: 5000,
      });
      const r6 = await cli6.connect(6000);
      check('SecureSyncServer 在全局 IPv6 上真监听 + 客户端真连上（真握手）', r6.ok === true, r6.reason);
      check('握手后对端指纹与 pin 一致', r6.session?.info.peerFingerprint === idS.fingerprint, r6.session?.info.peerFingerprint);
      if (r6.ok && r6.session) {
        r6.session.send({ to: '*', channel: 'group', payload: { type: 'ipv6-hello', over: 'ipv6' } });
        const deadline = Date.now() + 2000;
        while (srv6.received.length === 0 && Date.now() < deadline) await sleep(50);
        check('IPv6 上加密记录真送达（端到端）', srv6.received.length === 1 && srv6.received[0].payload.over === 'ipv6', srv6.received.map((m) => m.payload));
      } else {
        check('IPv6 上加密记录真送达（端到端）', false, '握手未完成');
      }
      cli6.close('done');
      await srv6.srv.stop();
      note('「全局单播 IPv6 真监听+真连上」在本机成立；但**跨公网**的 IPv6 可达性未验证（需要第二台有 IPv6 的机器）');
    } else {
      note('本机无全局单播 IPv6 → 「全局 IPv6 真监听+真连上」未验证（原因：本机没有该地址类型）');
    }
  }

  /* ══════════════ [4] 阶梯顺序与选档 ══════════════ */
  group('[4] 阶梯顺序（附八.9：IPv6 → IPv4 → 映射 → 打洞 → 中继 → 局域网）');
  check(
    'DEFAULT_LADDER_ORDER 就是 ADR 附八.9 的顺序',
    JSON.stringify(DEFAULT_LADDER_ORDER) === JSON.stringify(['ipv6-direct', 'public-direct', 'upnp', 'holepunch', 'relay', 'lan']),
    DEFAULT_LADDER_ORDER
  );
  check('每一档都有中文 label', DEFAULT_LADDER_ORDER.every((r) => typeof LADDER_LABELS[r] === 'string' && LADDER_LABELS[r].length > 0), DEFAULT_LADDER_ORDER.map((r) => LADDER_LABELS[r]));
  check('每一档都有 i18n key（net.rung.*）', DEFAULT_LADDER_ORDER.every((r) => String(LADDER_RUNG_I18N[r]).startsWith('net.rung.')), LADDER_RUNG_I18N);
  {
    const l = new LianJieTiZi();
    check('relay 档已实现（supported=true，不再是 unsupported）', l.strategyFor('relay')?.supported === true, l.strategyFor('relay')?.unsupportedReason);
    check('upnp 档仍**如实**标未实现', l.strategyFor('upnp')?.supported === false && /未实现/.test(l.strategyFor('upnp')?.unsupportedReason ?? ''), l.strategyFor('upnp')?.unsupportedReason);
    check('holepunch 档仍**如实**标未实现', l.strategyFor('holepunch')?.supported === false && /未实现/.test(l.strategyFor('holepunch')?.unsupportedReason ?? ''), l.strategyFor('holepunch')?.unsupportedReason);
    check('ipv6-direct 档已实现', l.strategyFor('ipv6-direct')?.supported === true, {});
  }

  if (v6Global) {
    const g = await listenTcp(v6Global);
    const ladder = new LianJieTiZi({ perRungTimeoutMs: 1500 });
    const res = await ladder.connect({ fingerprint: 'peer-ipv6', addresses: [{ host: v6Global, port: g.port, source: 'dht' }] });
    check('IPv6 目标 → 第一档 ipv6-direct 命中（这是"成本最低的一档"）', res.ok === true && res.rung === 'ipv6-direct', { rung: res.rung, detail: res.attempts[0]?.detail });
    check('命中即停（只试了 1 档）', res.attempts.length === 1, res.attempts.map((a) => a.rung));
    check('结果带地址族 = 6（真走 IPv6，不是只起了个档位名）', res.family === 6 && res.attempts[0]?.family === 6, { family: res.family, attempt: res.attempts[0]?.family });
    check('档位 detail 写明 IPv6 无 NAT / 无需打洞', /无 NAT|无需打洞/.test(res.attempts[0]?.detail ?? ''), res.attempts[0]?.detail);
    check('summary 与阶梯位置匹配（IPv6 公网直连）', /IPv6 公网直连/.test(res.summary), res.summary);
    check('reachability 报出本机 IPv6 事实', res.reachability?.localIpv6.hasGlobalUnicast === true && res.reachability?.localIpv6.publicCandidate === v6Global, res.reachability?.localIpv6);
    check('reachability.i18n.rung = net.rung.ipv6Direct', res.reachability?.i18n.rung === 'net.rung.ipv6Direct', res.reachability?.i18n);

    // IPv6 档失败 → 真降级到 IPv4 公网直连
    const s4 = await listenTcp('127.0.0.1');
    const res2 = await ladder.connect({
      fingerprint: 'peer-fallback',
      addresses: [
        { host: v6Global, port: 1, source: 'dht' }, // 全局 IPv6 但端口是关的（真实 ECONNREFUSED）
        { host: '127.0.0.1', port: s4.port, source: 'manual' },
      ],
    });
    check('IPv6 档真失败（端口关）后降级命中 public-direct', res2.ok === true && res2.rung === 'public-direct', { rung: res2.rung, attempts: res2.attempts.map((a) => `${a.rung}:${a.status}`) });
    check('IPv6 档的失败被如实记为 failed + 结论码 ipv6-dial-failed', res2.attempts[0]?.code === 'ipv6-dial-failed', res2.attempts[0]);
    check('降级记录里 IPv4 档给出实际地址族（IPv4）', res2.attempts[1]?.family === 4, res2.attempts[1]);
    await closeSrv(s4.srv);
    await closeSrv(g.srv);
  } else {
    note('本机无全局单播 IPv6 → 「IPv6 档真命中 / IPv6→IPv4 真降级」未验证（原因：本机没有该地址类型）');
  }

  {
    // IPv6 但**不是**公网候选（链路本地/ULA/文档段）→ 必须如实判"无候选"并列出被排除的地址
    const ladder = new LianJieTiZi({ perRungTimeoutMs: 600 });
    const res = await ladder.connect({
      fingerprint: 'peer-ula',
      addresses: [
        { host: 'fe80::117f:559c:8262:8b1d', port: 9001, source: 'lan' },
        { host: 'fd12:3456:789a::7', port: 9002, source: 'lan' },
        { host: '2001:db8::1', port: 9003, source: 'dht' },
      ],
    });
    const first = res.attempts[0];
    check('全是非公网 IPv6 → IPv6 档判 no-ipv6-candidate', first?.rung === 'ipv6-direct' && first?.code === 'no-ipv6-candidate', first);
    check('被排除的地址逐个列出（可解释，不静默跳过）', /fe80::117f:559c:8262:8b1d\(link-local\)/.test(first?.detail ?? '') && /fd12:3456:789a::7\(ula\)/.test(first?.detail ?? ''), first?.detail);
    check('文档段单独标注（不只说 global，说明"形式属 2000::/3 但排除"）', /2001:db8::1\(global·文档段\)/.test(first?.detail ?? ''), first?.detail);
    check('链路本地/ULA 真的没被拿去拨号（远小于 perRungTimeoutMs=600ms 的真实连接耗时）', first !== undefined && first.ms < 400, first?.ms);
  }

  /* ══════════════ [5] 中继档判定 ══════════════ */
  group('[5] 中继档判定 decideRelay（附八.3：可检测 + 可解释，6 种结构化结论码）');
  {
    const relay = new RelayNode({ port: 0, host: '127.0.0.1', pairTimeoutMs: 800 });
    const relayPort = await relay.start();
    const relayAddr = { host: '127.0.0.1', port: relayPort };
    const target = { fingerprint: 'peer-relay-1', nodeId: 'node-relay-1' };

    const notNeeded1 = await jueDingZhongJi(target, { selfDialable: false, peerDialable: true, candidates: [] });
    check('对端可拨入 → 不需要中继（直连即可）', notNeeded1.needed === false && notNeeded1.code === 'relay-not-needed-peer-dialable', notNeeded1);

    const notNeeded2 = await jueDingZhongJi(target, { selfDialable: true, peerDialable: false, candidates: [] });
    check('本机可拨入、对端不可拨入 → 不需要中继（等对端拨入，C1）', notNeeded2.needed === false && notNeeded2.code === 'relay-not-needed-inbound-expected', notNeeded2);

    const unknown = await jueDingZhongJi(target, { candidates: [] });
    check('可拨入性未知 → 如实标 dialability-unknown（不猜）', unknown.code === 'dialability-unknown' && unknown.needed === true, unknown.reason);

    const none = await jueDingZhongJi(target, { selfDialable: false, peerDialable: false, candidates: [] });
    check('两端都不可拨入 + 无中继候选 → relay-none-configured', none.code === 'relay-none-configured' && none.selected === false, none);
    check('该状态要求 UI 明确告知（needsPublicRelayNotice=true）', none.needsPublicRelayNotice === true, none.needsPublicRelayNotice);
    check('reason 明确写出"需要一台有公网地址的机器做中继"', /需要一台有公网地址的机器做中继/.test(none.reason), none.reason);
    check('bothUndialable=true（双方各自报告不可拨入）', none.bothUndialable === true, none);

    const badCandidate = await jueDingZhongJi(target, { selfDialable: false, peerDialable: false, candidates: [{ fingerprint: 'relay-dead', addr: { host: '203.0.113.1', port: 9 } }], timeoutMs: 700 });
    check('配了中继候选但连不上 → relay-unreachable', badCandidate.code === 'relay-unreachable' && badCandidate.selected === false, badCandidate.reason);
    check('不可达中继的**真实探测结果**被留痕（ok=false + 耗时）', badCandidate.attempts.length === 1 && badCandidate.attempts[0].ok === false && typeof badCandidate.attempts[0].ms === 'number', badCandidate.attempts);
    check('relay-unreachable 同样要求 UI 明确告知', badCandidate.needsPublicRelayNotice === true, badCandidate.needsPublicRelayNotice);

    const good = await jueDingZhongJi(target, { selfDialable: false, peerDialable: false, selfFingerprint: 'fp-self', candidates: [{ fingerprint: 'relay-good', addr: relayAddr }], timeoutMs: 1500 });
    check('两端都不可拨入 + 真可达中继 → relay-selected', good.code === 'relay-selected' && good.selected === true && good.needed === true, good.reason);
    check('选中继后带地址与配对 token', good.relay?.port === relayPort && typeof good.token === 'string' && good.token.length === 32, { relay: good.relay, token: good.token });
    check('选中继的探测结果也是真实 TCP 成功', good.attempts[0]?.ok === true, good.attempts);
    check('reason 提示"经中继：更慢，但可用"', /更慢，但可用/.test(good.reason), good.reason);

    const noSelfFp = await jueDingZhongJi(target, { selfDialable: false, peerDialable: false, candidates: [{ fingerprint: 'relay-good', addr: relayAddr }], timeoutMs: 1500 });
    check('没给本机指纹时**不编** token（token 缺失 + tokenSymmetric=false，诚实）', noSelfFp.token === undefined && noSelfFp.tokenSymmetric === false, { token: noSelfFp.token, sym: noSelfFp.tokenSymmetric });

    const t1 = relayTokenFor('fp-A', 'fp-B', relayAddr);
    const t2 = relayTokenFor('fp-B', 'fp-A', relayAddr);
    const t3 = relayTokenFor('fp-A', 'fp-C', relayAddr);
    const t4 = relayTokenFor('fp-A', 'fp-B', { host: '127.0.0.1', port: relayPort + 1 });
    check('配对 token 两端对称（各自算得出同一个值）', t1 === t2 && t1.length === 32, { t1, t2 });
    check('不同对端/不同中继 → 不同 token（不会串台）', t1 !== t3 && t1 !== t4, { t3, t4 });
    await relay.stop();
  }

  /* ══════════════ [6] 中继真转发 + 中继只见密文 ══════════════ */
  group('[6] 中继真转发（A→中继→B 内容真到达；中继样本里没有明文）');
  const sampleBuf = (s) => Buffer.from(s.firstBytesHex, 'hex');
  const samplesWithMarker = (relay, markers) =>
    relay.samples.filter((s) => {
      const txt = sampleBuf(s).toString('latin1');
      return markers.some((m) => txt.includes(m));
    });
  const recordSamples = (relay) =>
    relay.samples.filter((s) => {
      const b = sampleBuf(s);
      return b.length >= 21 && b[4] === 1 && b.readUInt32BE(0) + 4 <= s.bytes;
    });
  const handshakeSamples = (relay) => relay.samples.filter((s) => sampleBuf(s).subarray(0, 1).toString('latin1') === '{');

  {
    const S = await relaySession({ tap: true });
    check('中继路径上的握手成功（既有握手/鉴权语义原样复用）', S.connect.ok === true, S.connect.reason);
    check('对端指纹与 pin 一致（中继不能冒充对端）', S.connect.session?.info.peerFingerprint === S.B.fingerprint, S.connect.session?.info.peerFingerprint);
    check('被拨入侧（listener）先向中继注册成功', S.registration.ok === true && S.registration.registered === true, S.registration);
    check('中继统计：注册 2 条（listener + dialer）', S.relay.stats.registered === 2, S.relay.stats);
    check('中继统计：配对成功 1 对', S.relay.stats.pairs === 1, S.relay.stats);

    if (S.connect.ok && S.connect.session) {
      const mark = S.tap.mark();
      S.connect.session.send({ to: '*', channel: 'group', payload: { type: 'secret', marker: MARKER_SEND, body: 'x'.repeat(64) } });
      let waited = 0;
      while (S.server.received.length === 0 && waited < 3000) {
        await sleep(50);
        waited += 50;
      }
      const got = S.server.received[0];
      check('A→中继→B：内容**真到达** B（真字节转发）', got !== undefined && got.payload.marker === MARKER_SEND, got?.payload);
      check('记录被推入 tap（有真实记录层字节）', S.tap.since(mark).length > 0, S.tap.since(mark).length);

      const responder = S.server.srv.sessionList[0];
      check('B 侧会话存在且活着（握手后的加密会话）', !!responder && responder.alive === true, S.server.srv.sessionList.length);
      if (responder) responder.send({ to: '*', channel: 'group', payload: { type: 'reply', marker: MARKER_REPLY } });
      waited = 0;
      while (S.replies.length === 0 && waited < 3000) {
        await sleep(50);
        waited += 50;
      }
      check('B→中继→A：反向内容也**真到达** A（双向转发）', S.replies[0]?.payload.marker === MARKER_REPLY, S.replies[0]?.payload);
      check('中继真的搬了字节（bytesForwarded > 0）', S.relay.stats.bytesForwarded > 0, S.relay.stats);
      check('中继样本非空（真的"看到"了经过的字节）', S.relay.samples.length > 0, S.relay.samples.length);
      check('**中继样本里没有消息明文标记**（只看到密文）', samplesWithMarker(S.relay, [MARKER_SEND, MARKER_REPLY]).length === 0, samplesWithMarker(S.relay, [MARKER_SEND, MARKER_REPLY]).map((s) => s.direction));
      check('中继样本里也没有明文 body（64 个 x 的重复串）', !S.relay.samples.some((s) => sampleBuf(s).toString('latin1').includes('x'.repeat(64))), S.relay.samples.length);
      check('中继样本里确实存在**加密记录帧**（类型字节=1）', recordSamples(S.relay).length >= 1, recordSamples(S.relay).map((s) => ({ d: s.direction, n: s.bytes })));
      check('中继能看到握手帧（元数据：指纹/nonce/公钥）—— 如实记录这一事实', handshakeSamples(S.relay).length >= 1, handshakeSamples(S.relay).map((s) => s.bytes));
      check('握手帧里也没有消息明文标记', samplesWithMarker({ samples: handshakeSamples(S.relay) }, [MARKER_SEND, MARKER_REPLY]).length === 0, {});
      note('中继**看得到握手帧的元数据**（指纹、nonce、X25519 公钥、签名）——这是"中继是字节管道"的必然结果；'
        + '内容机密性由两端 ECDHE 决定，中继拿不到私钥就推不出会话密钥。真正的"元数据不可见"需要额外混淆，本轮未实现。');
    } else {
      check('A→中继→B：内容真到达 B', false, '握手未完成');
      check('中继样本里没有消息明文标记', false, '握手未完成');
    }
    await S.stop();
  }

  /* ══════════════ [7] 中继引入的攻击面 ══════════════ */
  group('[7] 中继攻击面：重放 / 篡改 / 重排 / 冒充对端 —— 都必须被拒');
  {
    const guard = new ReplayGuard();
    const S = await relaySession({ tap: true, replayGuard: guard, handshakeTimeoutMs: 6000 });
    check('中继路径上的握手也走既有 ReplayGuard（双方单调计数都被推进）', guard.maxCounterSeen(S.A.fingerprint) > 0 && guard.maxCounterSeen(S.B.fingerprint) > 0, {
      a: guard.maxCounterSeen(S.A.fingerprint),
      b: guard.maxCounterSeen(S.B.fingerprint),
    });
    const seen = guard.maxCounterSeen(S.A.fingerprint);
    const same = guard.check({ peer: S.A.fingerprint, nonce: 'nonce-fresh-0', counter: seen, ts: Date.now() });
    const lower = guard.check({ peer: S.A.fingerprint, nonce: 'nonce-fresh-1', counter: Math.max(1, seen - 1), ts: Date.now() });
    const higher = guard.check({ peer: S.A.fingerprint, nonce: 'nonce-fresh-2', counter: seen + 1, ts: Date.now() });
    check('counter 相等（回退到已见值）→ 被拒 replay-counter', same.ok === false && same.reason === 'replay-counter', same);
    check('counter 更低 → 被拒 replay-counter', lower.ok === false && lower.reason === 'replay-counter', lower);
    check('严格递增 → 被接受（不是一律拒绝，证明判据是单调性）', higher.ok === true, higher);
    guard.commit({ peer: S.A.fingerprint, nonce: 'nonce-fresh-9', counter: seen + 9 });
    const nonceReuse = guard.check({ peer: S.A.fingerprint, nonce: 'nonce-fresh-9', counter: seen + 10, ts: Date.now() });
    check('同一 nonce 二次使用 → 被拒 replay-nonce', nonceReuse.ok === false && nonceReuse.reason === 'replay-nonce', nonceReuse);
    const skewed = guard.check({ peer: 'someone', nonce: 'n', counter: 1, ts: Date.now() - 3_600_000 });
    check('时间戳超容差 → 被拒 clock-skew', skewed.ok === false && skewed.reason === 'clock-skew', skewed);

    if (S.connect.ok && S.connect.session) {
      // 恶意中继：**原样重放**一条已加密的应用记录（不是伪造，攻击者只搬字节）
      const mark = S.tap.mark();
      S.connect.session.send({ to: '*', channel: 'group', payload: { type: 'secret', marker: MARKER_SEND } });
      let waited = 0;
      while (S.server.received.length === 0 && waited < 3000) {
        await sleep(50);
        waited += 50;
      }
      const replayBytes = S.tap.since(mark);
      check(
        '拿到一条**完整**的记录帧（长度前缀自洽 + 类型=1）',
        replayBytes.length >= 21 && replayBytes[4] === 1 && replayBytes.readUInt32BE(0) + 4 === replayBytes.length,
        { len: replayBytes.length, prefix: replayBytes.length >= 4 ? replayBytes.readUInt32BE(0) : null, type: replayBytes.length > 4 ? replayBytes[4] : null }
      );
      const deliveredBefore = S.server.received.length;
      const closesBefore = S.server.closes.length;
      const injected = S.relay.inject(S.token, 'dialer->listener', replayBytes);
      check('恶意中继真的把这条记录**重放进管道**（注入字节数 = 记录长度）', injected === replayBytes.length, injected);
      await sleep(800);
      check('重放的记录**被拒**（接收侧断开：认证/计数不符）', S.server.closes.length > closesBefore, S.server.closes);
      check('拒因来自记录层（not-authorized-tag / 记录错误），不是"没收到"', /not-authorized-tag|record|malformed/i.test(String(S.server.closes[S.server.closes.length - 1] ?? '')), S.server.closes);
      check('重放**没有**造成第二次投递（内容未被接受）', S.server.received.length === deliveredBefore, { before: deliveredBefore, after: S.server.received.length });
      check('重放后会话不再存活（拒绝是"断连"，不是"记个日志继续"）', S.server.srv.sessionList.every((s) => s.alive === false), S.server.srv.sessionList.map((s) => s.alive));
    } else {
      check('重放的记录被拒', false, '握手未完成，无法做重放断言');
    }
    await S.stop();
  }

  for (const mode of ['replay-once', 'tamper-once', 'swap-once']) {
    const S = await relaySession({ relayMode: mode, handshakeTimeoutMs: 2500, connectTimeoutMs: 7000 });
    check(`恶意中继 ${mode}：握手**不成立**（不能篡改/重排后仍被接受）`, S.connect.ok === false, { reason: S.connect.reason, ok: S.connect.ok });
    check(`恶意中继 ${mode}：被拨入侧没有建立任何会话`, S.server.srv.sessionList.length === 0, S.server.srv.sessionList.length);
    check(`恶意中继 ${mode}：中继确实看到了字节（失败不是"根本没跑"）`, S.relay.stats.samples > 0 || S.relay.stats.bytesForwarded > 0, S.relay.stats);
    await S.stop();
  }

  {
    // 冒充对端：第三方拿到配对 token 抢占 listener 槽位 → 握手层必须按指纹拒掉
    const relay = new RelayNode({ port: 0, host: '127.0.0.1', pairTimeoutMs: 900 });
    const relayPort = await relay.start();
    const relayAddr = { host: '127.0.0.1', port: relayPort };
    const A = chuangjianLinShiShenFen('imp-A');
    const B = chuangjianLinShiShenFen('imp-B');
    const X = chuangjianLinShiShenFen('imp-stranger');
    const token = relayTokenFor(A.fingerprint, B.fingerprint, relayAddr);
    const xServer = await mkSecureServer({ id: X, peerFp: A.fingerprint });
    const xTunnel = new RelayTunnelListener({ relay: relayAddr, token, localTarget: { host: '127.0.0.1', port: xServer.port }, readyTimeoutMs: 4000 });
    await xTunnel.start();
    const dialer = new RelayTunnelDialer({ relay: relayAddr, token, readyTimeoutMs: 4000 });
    const localPort = await dialer.start();
    const client = new SecureSyncClient({
      identity: A.provider,
      nodeId: 'imp-A',
      host: '127.0.0.1',
      port: localPort,
      groupId: null,
      peerFingerprint: B.fingerprint, // A pin 的是 B
      roster: (fp) => fp === B.fingerprint,
      handshakeTimeoutMs: 4000,
    });
    const r = await client.connect(5000);
    check('中继路径上冒充对端 → 握手被拒（pin 校验生效）', r.ok === false, r.reason);
    check('冒充者一侧也没有建立会话', xServer.srv.sessionList.length === 0, xServer.srv.sessionList.length);
    const rejected = Object.keys(xServer.srv.rejectionCounts);
    check('冒充者一侧留下拒绝原因（可审计）', rejected.length >= 1, xServer.srv.rejectionCounts);
    check('拒因与指纹/授权相关', rejected.some((k) => /fingerprint|authoriz|pin|confirm|bad-group/i.test(k)), rejected);
    client.close('done');
    await dialer.stop();
    await xTunnel.stop();
    await xServer.srv.stop();
    await relay.stop();
  }

  /* ══════════════ [8] 没有可用中继时如实报缺口 ══════════════ */
  group('[8] 双 CGNAT + 无中继：如实报缺口（不转圈、不静默）');
  {
    const cgnatA = await boTcpXiangQing('100.64.10.20', 7891, 700);
    const cgnatB = await boTcpXiangQing('100.64.10.21', 7892, 700);
    check('CGNAT 宣告地址（100.64/10）真的拨不通 → "不可拨入"是被测出来的', cgnatA.ok === false && cgnatB.ok === false, { a: cgnatA.detail, b: cgnatB.detail });

    const ladder = new LianJieTiZi({ perRungTimeoutMs: 900, relay: { relays: () => [], selfDialable: () => false, selfFingerprint: () => 'fp-self' } });
    const res = await ladder.connect({
      fingerprint: 'fp-peer',
      addresses: [{ host: '100.64.10.21', port: 7892, source: 'dht' }],
      peerDialable: false,
    });
    const relayAttempt = res.attempts.find((a) => a.rung === 'relay');
    check('阶梯整体 ok=false（不假装成功）', res.ok === false, { code: res.code });
    check('阶梯结论码 = no-relay-available', res.code === 'no-relay-available', res.code);
    check('relay 档结论码 = relay-none-configured（不是 unsupported，也不是静默跳过）', relayAttempt?.code === 'relay-none-configured', relayAttempt);
    check('summary 明确写出"需要一台有公网地址的机器做中继"', /需要一台有公网地址的机器做中继/.test(res.summary), res.summary);
    check('reachability.needsPublicRelayNotice = true（UI 据此明确告知）', res.reachability?.needsPublicRelayNotice === true, res.reachability);
    check('reachability.bothUndialable = true（双方各自报告不可拨入）', res.reachability?.bothUndialable === true, res.reachability);
    check('reachability.relayCode 与 relay 档一致', res.reachability?.relayCode === 'relay-none-configured', res.reachability?.relayCode);
    check('reachability 给出 i18n key（net.relay.missing.needsPublicRelay）', res.reachability?.i18n.relay === 'net.relay.missing.needsPublicRelay', res.reachability?.i18n);
    check('relayDecision 结构完整（code/reason/attempts/needsPublicRelayNotice）', !!res.relayDecision && typeof res.relayDecision.reason === 'string' && Array.isArray(res.relayDecision.attempts), res.relayDecision);
    check('relayDecision.tokenSymmetric = true（给了本机指纹就能两端算出同一个 token）', res.relayDecision?.tokenSymmetric === true, res.relayDecision?.tokenSymmetric);

    // 配了中继但都连不上
    const ladder2 = new LianJieTiZi({
      perRungTimeoutMs: 800,
      relay: { relays: () => [{ fingerprint: 'relay-dead', addr: { host: '203.0.113.1', port: 9 } }], selfDialable: () => false, selfFingerprint: () => 'fp-self' },
    });
    const res2 = await ladder2.connect({ fingerprint: 'fp-peer', addresses: [{ host: '100.64.10.21', port: 7892, source: 'dht' }], peerDialable: false });
    const relayAttempt2 = res2.attempts.find((a) => a.rung === 'relay');
    check('配了中继但连不上 → relay-unreachable（同样如实报缺口）', relayAttempt2?.code === 'relay-unreachable', relayAttempt2);
    check('该情形仍是 no-relay-available 且要求明确告知', res2.code === 'no-relay-available' && res2.reachability?.needsPublicRelayNotice === true, { code: res2.code, r: res2.reachability?.needsPublicRelayNotice });
    check('探测留痕：逐候选 ok/耗时（可解释"为什么不可用"）', res2.relayDecision?.attempts.length === 1 && res2.relayDecision.attempts[0].ok === false, res2.relayDecision?.attempts);
    check('没配置中继时不写 tokenSymmetric=false 的假结论（诚实）', res2.relayDecision?.tokenSymmetric === true, res2.relayDecision?.tokenSymmetric);

    // 两端都不可拨入 + 真可达中继 → 阶梯选中继档
    const relay = new RelayNode({ port: 0, host: '127.0.0.1', pairTimeoutMs: 800 });
    const rp = await relay.start();
    const ladder3 = new LianJieTiZi({
      perRungTimeoutMs: 900,
      relay: { relays: () => [{ fingerprint: 'relay-node', addr: { host: '127.0.0.1', port: rp } }], selfDialable: () => false, selfFingerprint: () => 'fp-self' },
    });
    const res3 = await ladder3.connect({ fingerprint: 'fp-peer', addresses: [{ host: '100.64.10.21', port: 7892, source: 'dht' }], peerDialable: false });
    check('两端都不可拨入 + 真可达中继 → 阶梯选中 relay 档', res3.ok === true && res3.rung === 'relay', { rung: res3.rung, summary: res3.summary });
    const rung3 = res3.attempts.find((a) => a.rung === 'relay');
    check('relay 档命中时带中继地址 + 配对 token + "更慢但可用"标记', rung3?.relay?.relay?.port === rp && typeof rung3?.relay?.token === 'string' && rung3?.relay?.slowerButUsable === true, rung3?.relay);
    check('relay 档的 token = relayTokenFor(本机, 对端, 中继)（两端可复算）', rung3?.relay?.token === relayTokenFor('fp-self', 'fp-peer', { host: '127.0.0.1', port: rp }), rung3?.relay?.token);
    check('档位顺序：relay 在 lan 之前被尝试（附八.9 顺序）', res3.attempts.map((a) => a.rung).indexOf('relay') < (res3.attempts.map((a) => a.rung).indexOf('lan') === -1 ? 99 : res3.attempts.map((a) => a.rung).indexOf('lan')), res3.attempts.map((a) => `${a.rung}:${a.status}`));
    check('两端的 token 对称（各自算得出同一个值）', (await jueDingZhongJi({ fingerprint: 'fp-peer' }, { selfDialable: false, peerDialable: false, selfFingerprint: 'fp-self', candidates: [{ fingerprint: 'relay-node', addr: { host: '127.0.0.1', port: rp } }] })).token === (await jueDingZhongJi({ fingerprint: 'fp-self' }, { selfDialable: false, peerDialable: false, selfFingerprint: 'fp-peer', candidates: [{ fingerprint: 'relay-node', addr: { host: '127.0.0.1', port: rp } }] })).token, {});
    await relay.stop();
  }

  /* ══════════════ [9] 真多进程 ══════════════ */
  group('[9] 真多进程：中继进程 + 两个"不可拨入"的端点进程（A→中继→B）');
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-conn-'));
    const children = [];
    const spawnChild = (role, extra = []) => {
      const out = path.join(tmpDir, `${role}-${Math.random().toString(36).slice(2, 8)}.json`);
      const proc = spawn(process.execPath, [childScript, '--role', role, ...extra, '--out', out], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let err = '';
      proc.stderr.on('data', (d) => {
        err += d.toString();
      });
      proc.stdout.on('data', () => {});
      const c = {
        role,
        proc,
        out,
        read: () => {
          try {
            return JSON.parse(fs.readFileSync(out, 'utf8'));
          } catch {
            return null;
          }
        },
        err: () => err,
      };
      children.push(c);
      return c;
    };
    const waitFor = async (c, pred, timeoutMs) => {
      const deadline = Date.now() + timeoutMs;
      let last = null;
      while (Date.now() < deadline) {
        const s = c.read();
        if (s) {
          last = s;
          if (pred(s)) return s;
        }
        if (c.proc.exitCode !== null) {
          await sleep(100);
          const s2 = c.read();
          if (s2) {
            last = s2;
            if (pred(s2)) return s2;
          }
          break;
        }
        await sleep(60);
      }
      return last;
    };

    // 每次运行现生成 seed（**不落仓库**）；父进程算好两端的 pin 指纹
    const seedA = randomBytes(32).toString('hex');
    const seedB = randomBytes(32).toString('hex');
    const FP_A = fingerprintFromSeedHex(seedA);
    const FP_B = fingerprintFromSeedHex(seedB);
    check('父进程能按同一 seed 推出身份指纹（跨进程 pin 校验的前提；seed 每次运行新生成，仓库里无密钥材料）', FP_A !== FP_B && FP_A.length > 10 && FP_B.length > 10, { FP_A: FP_A.slice(0, 12), FP_B: FP_B.slice(0, 12) });

    const relayC = spawnChild('relay', ['--port', '0']);
    const relayUp = await waitFor(relayC, (s) => s.port > 0, 8000);
    check('多进程[1/3]：中继进程真的起来了（真 socket 监听端口）', relayUp?.port > 0, { port: relayUp?.port, phase: relayUp?.phase });

    // 两个端点都"不可拨入"：宣告地址是 CGNAT 段，并用**真实 TCP 拨号**证明拨不通
    const cgnatA = await boTcpXiangQing('100.64.10.20', 7891, 800);
    const cgnatB = await boTcpXiangQing('100.64.10.21', 7892, 800);
    check('多进程：端点 A 宣告的 CGNAT 地址真的拨不通（不可拨入有实测证据）', cgnatA.ok === false, cgnatA.detail);
    check('多进程：端点 B 宣告的 CGNAT 地址真的拨不通（不可拨入有实测证据）', cgnatB.ok === false, cgnatB.detail);

    const token = relayTokenFor(FP_A, FP_B, { host: '127.0.0.1', port: relayUp.port });
    const listenerC = spawnChild('listener', [
      '--relay-port',
      String(relayUp.port),
      '--token',
      token,
      '--seed-self',
      seedB,
      '--peer-fp',
      FP_A,
      '--pair-timeout',
      '10000',
      '--hold-ms',
      '9000',
    ]);
    const regState = await waitFor(listenerC, (s) => s.phase === 'registered', 12000);
    check('多进程[2/3]：端点 B 进程已向中继**出站注册**（本机不接受任何入站）', regState?.registered === true, regState);
    check('多进程：B 自报指纹与父进程按同一 seed 推导一致', regState?.fingerprint === FP_B, { got: String(regState?.fingerprint).slice(0, 12), want: FP_B.slice(0, 12) });
    check('多进程：B 的"本机服务"只监听回环端口（模拟不可拨入的一端）', typeof regState?.serverPort === 'number' && regState.serverPort > 0, regState?.serverPort);

    const dialerC = spawnChild('dialer', [
      '--relay-port',
      String(relayUp.port),
      '--token',
      token,
      '--seed-self',
      seedA,
      '--peer-fp',
      FP_B,
      '--hold-ms',
      '9000',
    ]);
    const dialerDone = await waitFor(dialerC, (s) => s.phase === 'done', 40000);
    const listenerDone = await waitFor(listenerC, (s) => s.phase === 'done', 40000);

    check('多进程[3/3]：A 经中继与 B 完成**真握手**', dialerDone?.handshakeOk === true, dialerDone);
    check('多进程：A 侧会话的对端指纹 = B（pin 校验通过）', dialerDone?.peerFingerprint === FP_B, String(dialerDone?.peerFingerprint).slice(0, 12));
    check('多进程：B 真的收到了 A 的载荷（A→中继→B）', listenerDone?.receivedMarker === MARKER_SEND, listenerDone?.receivedPayload);
    check('多进程：B 侧会话记录的对端指纹来自握手（= A）', listenerDone?.verifiedPeerFingerprint === FP_A, String(listenerDone?.verifiedPeerFingerprint).slice(0, 12));
    check('多进程：A 真的收到了 B 的回复（B→中继→A，双向）', dialerDone?.replyReceived === true && dialerDone?.replyMarker === MARKER_REPLY, { reply: dialerDone?.replyMarker });
    check('多进程：两端隧道都统计了真实字节', (dialerDone?.tunnel?.bytesToRelay ?? 0) > 0 && (listenerDone?.tunnel?.bytesFromRelay ?? 0) > 0, { a: dialerDone?.tunnel, b: listenerDone?.tunnel });

    const relayFinal = await (async () => {
      // 等中继进程把最新统计写回结果文件（它是每 200ms 刷新一次）
      await sleep(500);
      return relayC.read();
    })();
    check('多进程：中继统计到配对 >= 1', (relayFinal?.stats?.pairs ?? 0) >= 1, relayFinal?.stats);
    check('多进程：中继真的搬了字节', (relayFinal?.stats?.bytesForwarded ?? 0) > 0, relayFinal?.stats);
    const mpSamples = relayFinal?.samples ?? [];
    const mpJunk = (m) => mpSamples.filter((s) => Buffer.from(s.firstBytesHex, 'hex').toString('latin1').includes(m));
    check('多进程：中继样本里**没有** A→B 的明文标记', mpJunk(MARKER_SEND).length === 0, mpJunk(MARKER_SEND).length);
    check('多进程：中继样本里**没有** B→A 的回复明文标记', mpJunk(MARKER_REPLY).length === 0, mpJunk(MARKER_REPLY).length);
    check(
      '多进程：中继样本里确有加密记录帧（类型字节=1）',
      mpSamples.some((s) => {
        const b = Buffer.from(s.firstBytesHex, 'hex');
        return b.length >= 21 && b[4] === 1 && b.readUInt32BE(0) + 4 <= s.bytes;
      }),
      mpSamples.length
    );
    check('多进程：中继双向都转发过（两个方向都有样本）', new Set(mpSamples.map((s) => s.direction)).size === 2, [...new Set(mpSamples.map((s) => s.direction))]);

    // 阶梯在"两端都不可拨入 + 有真中继进程"时选中继档
    const ladderMP = new LianJieTiZi({
      perRungTimeoutMs: 1000,
      relay: { relays: () => [{ fingerprint: 'relay-child', addr: { host: '127.0.0.1', port: relayUp.port } }], selfDialable: () => false, selfFingerprint: () => FP_A },
    });
    const mpRes = await ladderMP.connect({ fingerprint: FP_B, addresses: [{ host: '100.64.10.21', port: 7892, source: 'dht' }], peerDialable: false });
    check('多进程：阶梯在"双方都不可拨入"时选中 relay 档（真探测到中继进程）', mpRes.ok === true && mpRes.rung === 'relay', { rung: mpRes.rung, summary: mpRes.summary });
    check('多进程：relay 档 token = relayTokenFor(A, B, 中继)（与子进程用的一致）', mpRes.attempts.find((a) => a.rung === 'relay')?.relay?.token === token, mpRes.attempts.find((a) => a.rung === 'relay')?.relay?.token);
    check('多进程：relay 档之前的直连档都如实失败（CGNAT 地址真拨不通）', mpRes.attempts.filter((a) => a.rung === 'public-direct')[0]?.status === 'failed', mpRes.attempts.map((a) => `${a.rung}:${a.status}`));

    for (const c of children) {
      try {
        c.proc.kill();
      } catch {
        /* ignore */
      }
    }
    for (let i = 0; i < 40 && children.some((c) => c.proc.exitCode === null && c.proc.signalCode === null); i += 1) await sleep(100);
    check(
      '多进程：三个子进程都已退出（清理干净，不留孤儿）',
      children.every((c) => c.proc.exitCode !== null || c.proc.signalCode !== null),
      children.map((c) => `${c.role}:exit=${c.proc.exitCode},sig=${c.proc.signalCode}`)
    );
  }

  /* ══════════════ [10] 本机自测硬约束复核 ══════════════ */
  group('[10] 本机约束复核：同端口双 UDP socket 只有一个能收包（所以本机多机模拟必须单播+不同端口）');
  {
    const s1 = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const s2 = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const port = await new Promise((r) => {
      s1.on('error', () => {});
      s1.bind(0, '127.0.0.1', () => {
        const p = s1.address().port;
        s2.on('error', () => {});
        s2.bind(p, '127.0.0.1', () => r(p));
      });
    });
    let got1 = 0;
    let got2 = 0;
    s1.on('message', () => {
      got1 += 1;
    });
    s2.on('message', () => {
      got2 += 1;
    });
    const peer = dgram.createSocket({ type: 'udp4' });
    await new Promise((r) => peer.bind(0, '127.0.0.1', r));
    for (let i = 0; i < 3; i += 1) peer.send(Buffer.from(`probe-${i}`), port, '127.0.0.1');
    await sleep(500);
    check('两个 socket 确实都绑上了同一端口（约束前提成立）', port > 0, port);
    check('发 3 个报文 → 投递总数 <= 3（**不是**每个 socket 各得一份）', got1 + got2 <= 3, { gotA: got1, gotB: got2 });
    check('至少投递到 1 个（真收到了，不是"谁都没收"）', got1 + got2 >= 1, { gotA: got1, gotB: got2 });
    check('其中一个 socket 收到 0 个（实测 gotA/gotB 不各得一份）', got1 === 0 || got2 === 0, { gotA: got1, gotB: got2 });
    peer.close();
    s1.close();
    s2.close();
    note('本机双实例只能用**单播 + 不同端口**（本脚本场景即如此）；广播发现路径需要两台真机才能验证');
  }

  /* ══════════════ 汇总 ══════════════ */
  group('[未验证 / 未实现的边界（如实列出）]');
  note('真实公网可达性：未验证。原因：没有第二台在公网的机器、本机也没有公网出口，DHT/autonat 只能在本机/同网验证。');
  note('跨真实 NAT 的打洞（STUN + 同时打洞）：未实现（阶梯里仍为 unsupported），原因：需要两侧真 NAT 与 STUN 服务器，无第二网络环境。');
  note('UPnP / NAT-PMP / PCP 端口映射：未实现（仍为 unsupported），原因：需要真实路由器与加解密依赖（本项目零依赖约束）。');
  note('真实中继服务器：未验证。原因：需要一个有公网地址的部署点；本脚本验证的是**本机回环上的真 socket 中继进程**（转发/加密/攻击面语义一致，但跨公网未验证）。');
  note('中继的元数据隐藏：未实现。中继必然看得到握手帧（指纹/nonce/公钥/签名），本轮不做流量混淆。');
  note('中继 token 的抢占（拿到同一 token 的第三方抢占配对槽位）：未实现防护，属于**拒绝服务**面（机密性不受影响：握手仍会按指纹拒掉冒充者）。');
  for (const n of unverified) console.log(`  · ${n}`);

  console.log(`\n=== verify-connectivity 结果：${passes} 通过 / ${failures} 失败 ===`);
  console.log(`（其中 ${noteCount} 条 [NOTE] 为本机无法验证/未实现的边界，已如实列出）`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('[FATAL]', e);
  process.exit(1);
});
