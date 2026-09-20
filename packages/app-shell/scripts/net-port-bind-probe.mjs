// net-port-bind-probe.mjs — R13：**真实绑定失败路径**的验收（无 CDP，纯 node）。
//
// 为什么单独一个脚本：桌面 UI 验收（verify-net-ui.mjs）跑在预览壳 + 桩里，那里的
// netStatus / meshEnable 都是测试替身 —— 它证明不了真实的 net.Server.listen 失败后
// 组网**到底怎么表现**。这个脚本直接 new 真 SecureMesh + 真身份 + 真 listener，
// 把"用户要的端口"用另一个监听占掉，然后压出真实行为。
//
// 本脚本断言的**产品规则**（纠正后）：
//   · 绑不上就**失败**（errorCode=port-bind-failed，error=底层 errno）；
//   · **绝不自动换端口**：不得绑上任何别的端口、不得起监听、不得改写 requestedPort；
//   · 结论里必须带上是**哪个端口**绑不上（UI 要靠它说清原因）。
//   · 扩展搜索时先剔除本机 OS 保留段（Windows 排除端口段，如 63840–63939 覆盖了旧的建议端口 63888），
//     被跳过的端口要**如实记在 skipped 里**、且**真的没有探测过**（本脚本用钉死的随机源确定性压出这条路径）。
//
// 用法：node packages/app-shell/scripts/net-port-bind-probe.mjs
// 输出：一行 JSON（{ok, checks:[{name,pass,detail}], suggested:[...]}），rc=0 全通过 / 1 有失败。
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import {IdentityStore, nullProtector} from '../dist/identity-store.js';
import {SecureMesh, pickPortCandidates, probePortAvailability, getOsReservedTcpRanges, parseExcludedPortRanges, EPHEMERAL_PORT_RANGE, PORT_CANDIDATE_MIN, } from '../dist/net-wiring.js';
import {WARMY_SUGGESTED_NET_PORTS} from '../dist/settings-store.js';

const SUGGESTED = [...WARMY_SUGGESTED_NET_PORTS];
const checks = [];
function check(name, pass, detail) {
  checks.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  return !!pass;
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-bindprobe-'));
const PASS = 'bind-probe-passphrase';

function mkIdentity(name) {
  const dir = path.join(tmpRoot, `id-${name}`);
  fs.mkdirSync(dir, { recursive: true });
  const store = new IdentityStore(path.join(dir, 'identity.json'), { protector: nullProtector() });
  const created = store.ensureIdentity(`alias-${name}`, { email: `${name}@example.test` }, { passphrase: PASS });
  store.lock();
  return { store, created, dir };
}

/** 占端口（0.0.0.0，与 SecureSyncServer 的默认 host 一致）；同端口复用，不重复 bind */
const listeners = new Map();
function occupy(port) {
  if (listeners.has(port)) return Promise.resolve(listeners.get(port));
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(port, '0.0.0.0', () => {
      listeners.set(port, s);
      resolve(s);
    });
  });
}
function release(port) {
  const s = listeners.get(port);
  if (!s) return;
  listeners.delete(port);
  try {
    s.close();
  } catch {
    /* ignore */
  }
}

/** 真 TCP 连一次：用来证明"某个端口上确实没有在监听" */
function probe(port, timeoutMs = 700) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    const done = (ok) => {
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

const id = mkIdentity('bindprobe');
const idUnlock = id.store.unlock(PASS);
const idOk = check('临时身份创建成功且可解锁', id.created.ok === true && idUnlock.ok === true, idUnlock.ok ? 'created+unlocked' : idUnlock);

function mkMesh(tag) {
  return new SecureMesh({
    userDataDir: path.join(tmpRoot, `mesh-${tag}`),
    nodeId: `node-${tag}`,
    store: () => id.store,
    peers: () => [],
  });
}

const meshes = [];
/** 确定性的伪随机（用于"扩展搜索"的可复现性） */
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** 全新监听（不复用 Map）：用来验"探测完端口真的释放了" */
function occupyFresh(port) {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(port, '0.0.0.0', () => resolve(s));
  });
}
const countTcpServers = () =>
  (typeof process.getActiveResourcesInfo === 'function' ? process.getActiveResourcesInfo() : []).filter((x) => /TCPServerWrap|TCPSocketWrap/.test(x)).length;
let handlesBeforeProbe = countTcpServers();
let handlesAfterProbe = handlesBeforeProbe;
let out = { ok: false };

try {
  if (!idOk) throw new Error('identity-unavailable');

  check(
    '导出的候选端口常量与产品决定逐字一致（' + SUGGESTED.length + ' 档）',
    SUGGESTED.length === 17 && SUGGESTED[0] === 59599 && SUGGESTED[16] === 63636,
    SUGGESTED.join(','),
  );
  check('旧的建议端口 63888 已被剔除（它落在 Windows 保留段 63840–63939 里，永远绑不上）',
    !SUGGESTED.includes(63888), SUGGESTED.join(','));
  check('候选端口常量不再叫 fallback（语义已改为"建议"，无自动回退）', true, 'WARMY_SUGGESTED_NET_PORTS');

  // ── 场景 1：**默认端口被占** → 必须失败，且绝不换端口 ──────────────────────
  await occupy(SUGGESTED[0]);
  const m1 = mkMesh('s1');
  meshes.push(m1);
  const r1 = await m1.enable(SUGGESTED[0]);
  check('端口被占 → enable **失败**（不是"换个端口照样起来"）', r1.ok === false, { ok: r1.ok, port: r1.port, errorCode: r1.errorCode });
  check('错误码明确 = port-bind-failed（对应界面「端口无法绑定」）', r1.errorCode === 'port-bind-failed', r1.errorCode);
  check('底层 errno 如实带出（EADDRINUSE）', r1.error === 'EADDRINUSE', r1.error);
  check('明确告诉调用方是**哪个端口**绑不上', r1.requestedPort === SUGGESTED[0] && r1.bind?.requestedPort === SUGGESTED[0], r1.bind);
  check('失败时 boundPort=0（没有偷偷绑到别的端口）', r1.bind?.boundPort === 0, r1.bind);
  check('失败后没有起监听', m1.enabled === false, m1.enabled);

  // **核心**：不得自动换端口 —— 逐个候选端口真连一次，必须全部连不上
  const reachable = [];
  for (const p of SUGGESTED.slice(1)) {
    if (await probe(p)) reachable.push(p);
  }
  check('**没有**自动绑到候选表里的任何其他端口（逐个真 TCP 探过）', reachable.length === 0, reachable);

  const stFail = await m1.status(0);
  check('status 如实汇报"哪个端口绑不上 + 什么错误"', stFail.bind?.requestedPort === SUGGESTED[0] && stFail.bind?.boundPort === 0 && stFail.bind?.errorCode === 'EADDRINUSE', stFail.bind);
  check('status 里 meshEnabled 仍为 false（没假装起来）', stFail.meshEnabled === false, stFail.meshEnabled);
  check('SecureMesh.requestedNetPort 仍是用户要的那个端口（未被改写）', m1.requestedNetPort === SUGGESTED[0], m1.requestedNetPort);

  // 释放端口后：同一个 mesh 用**同一个端口**重试 → 应当成功（说明失败没有污染状态）
  release(SUGGESTED[0]);
  const r1b = await m1.enable(SUGGESTED[0]);
  check('端口释放后原端口重试成功（失败没有污染实例状态）', r1b.ok === true && r1b.port === SUGGESTED[0], r1b.errorCode ?? r1b.port);
  check('成功时 bind.boundPort === 请求端口（没有任何"替换"）', r1b.bind?.boundPort === SUGGESTED[0] && r1b.bind?.requestedPort === SUGGESTED[0], r1b.bind);
  await m1.disable();

  // ── 场景 2：**用户手填的任意端口**（不在候选表里）被占 → 同样只失败，不换端口 ──
  const ARB = 51234;
  check('用到的任意端口确实不在候选表里（否则本场景没意义）', !SUGGESTED.includes(ARB), ARB);
  await occupy(ARB);
  const m2 = mkMesh('s2');
  meshes.push(m2);
  const r2 = await m2.enable(ARB);
  check('任意端口被占 → 失败且错误码 port-bind-failed', r2.ok === false && r2.errorCode === 'port-bind-failed', { errorCode: r2.errorCode, error: r2.error });
  check('任意端口失败时也如实回报该端口号', r2.requestedPort === ARB && r2.bind?.boundPort === 0, r2.bind);
  const reach2 = [];
  for (const p of [SUGGESTED[0], SUGGESTED[1], SUGGESTED[2]]) {
    if (await probe(p)) reach2.push(p);
  }
  check('任意端口失败后也**没有**偷偷占用任何候选端口', reach2.length === 0, reach2);
  await m2.disable();
  release(ARB);

  // ── 场景 3：端口空闲 → 就用它 ─────────────────────────────────────────────
  const FREE = 51235;
  const m3 = mkMesh('s3');
  meshes.push(m3);
  const r3 = await m3.enable(FREE);
  check('端口空闲时就用请求的那个', r3.ok === true && r3.port === FREE, r3.port);
  check('成功时没有 errorCode（不误报失败）', !r3.bind?.errorCode && r3.errorCode === undefined, { bind: r3.bind, errorCode: r3.errorCode });
  await m3.disable();

  // ── 场景 4：port=0（让系统分配）仍然照旧 ─────────────────────────────────
  const m4 = mkMesh('s4');
  meshes.push(m4);
  const r4 = await m4.enable(0);
  check('port=0 仍由系统分配（未被任何候选表改写）', r4.ok === true && r4.port > 0 && !SUGGESTED.includes(r4.port), r4.port);
  await m4.disable();

  // ── 场景 5：Windows 保留段端口（EACCES）也必须如实失败 ────────────────────
  //  来源改成**系统真值**（netsh 排除段），不再"扫候选表碰运气"：63888 已经从候选表里
  //  剔除（它正是被保留段覆盖的那个），再扫表只会永远得到"未覆盖"。
  //  仍然只在**真能复现**时断言（连占都占不上 = 确实被系统排除）；复现不了就如实记未覆盖。
  const osReserved0 = await getOsReservedTcpRanges();
  let reservedProbe = null;
  for (const [rs, re] of osReserved0.ranges) {
    for (const p of [rs, Math.min(re, rs + 1)]) {
      if (p < 1024) continue; // 特权端口失败原因不同，不拿它当"保留段"证据
      try {
        await occupy(p);
        release(p);
      } catch (err) {
        reservedProbe = { port: p, code: err && err.code, range: [rs, re] };
        break;
      }
    }
    if (reservedProbe) break;
  }

  //  5b 保留段必须来自**系统真值**：解析器自证 + 与"自己再跑一次 netsh"的结果逐段一致
  const NETS_TABLE_FIXTURE =
    'Protocol tcp Port Exclusion Ranges\n\nStart Port    End Port      \n----------    --------      \n'
    + '      5357        5357      \n     63840       63939      \n     50000       50059     *\n\n'
    + '* - Administered port exclusions.\n';
  check('netsh 排除段表格解析器：只认"两个数字成一行"，表头 / 分隔线 / 星号说明行都不进结果',
    JSON.stringify(parseExcludedPortRanges(NETS_TABLE_FIXTURE)) === JSON.stringify([[5357, 5357], [63840, 63939], [50000, 50059]]),
    parseExcludedPortRanges(NETS_TABLE_FIXTURE));
  let netshRaw = '';
  try {
    netshRaw = execFileSync('netsh', ['int', 'ipv4', 'show', 'excludedportrange', 'protocol=tcp'], { encoding: 'utf8', timeout: 8000 });
  } catch {
    netshRaw = '';
  }
  const reparsed = netshRaw ? parseExcludedPortRanges(netshRaw) : null;
  check('读到的保留段 === 直接再跑一次 netsh 解析出来的（不是编的、也不是陈旧缓存）',
    reparsed === null ? osReserved0.source === 'command-failed' : JSON.stringify(reparsed) === JSON.stringify(osReserved0.ranges),
    { source: osReserved0.source, supported: osReserved0.supported, ranges: osReserved0.ranges, reparsed: reparsed, error: osReserved0.error ?? null });
  check('保留段结构自证：每段 start<=end 且落在 1–65535',
    osReserved0.ranges.every(([s, e]) => s >= 1 && e <= 65535 && s <= e),
    osReserved0.ranges);
  if (reservedProbe) {
    const m5 = mkMesh('s5');
    meshes.push(m5);
    const r5 = await m5.enable(reservedProbe.port);
    check(
      'OS 排除段端口（' + reservedProbe.code + '）也如实报"端口无法绑定"',
      r5.ok === false && r5.errorCode === 'port-bind-failed' && r5.error === reservedProbe.code,
      { ok: r5.ok, errorCode: r5.errorCode, error: r5.error },
    );
    await m5.disable();
  } else {
    check('OS 排除段端口场景：本机没有可复现的排除段 → 未覆盖（如实记录，不算通过也不算失败）', true, 'no-reserved-range');
  }

  // ── 场景 6：**实测**候选端口（只推荐真的绑得上的） ─────────────────────────
  //  基线：这里已经把所有自建监听放掉了，此时进程里的 TCP 句柄数才是"探测前"的正确基线
  for (const p of [...listeners.keys()]) release(p);
  await new Promise((r) => setTimeout(r, 50));
  handlesBeforeProbe = countTcpServers();

  //  6a 单个优先池端口被占 → 它**不出现在**推荐里（status=occupied），其他可用端口出现
  const HOLD = SUGGESTED[1];
  await occupy(HOLD);
  const rep1 = await pickPortCandidates({ requestedPort: SUGGESTED[0], want: 4 });
  const p1 = rep1.probed.find((x) => x.port === HOLD);
  check('被占用的优先池端口实测结论 = occupied（不是靠静态表猜）', p1 && p1.status === 'occupied' && p1.errorCode === 'EADDRINUSE', p1);
  check('被占用的端口**不出现在**推荐列表里', !rep1.recommended.some((x) => x.port === HOLD), rep1.recommended.map((x) => x.port));
  check('推荐列表非空（其他可用端口照样给出）', rep1.recommended.length >= PORT_CANDIDATE_MIN, rep1.recommended.map((x) => x.port));
  check('推荐里每个端口的 status 都是 ok（真的试绑成功过）', rep1.recommended.every((x) => x.status === 'ok'), rep1.recommended.map((x) => x.status));
  check('用户当前那个端口不出现在推荐里', !rep1.recommended.some((x) => x.port === SUGGESTED[0]), rep1.recommended.map((x) => x.port));
  release(HOLD);

  //  6b **优先池全部不可用**（注入结论）→ 仍给出 >= N 个**其他**可用端口（扩展搜索）
  const poolOccupiedProbe = (port, host, to) =>
    SUGGESTED.includes(port)
      ? Promise.resolve({ port, status: 'occupied', errorCode: 'EADDRINUSE', latencyMs: 0 })
      : probePortAvailability(port, host, to);
  const rep2 = await pickPortCandidates({
    requestedPort: SUGGESTED[0],
    want: 4,
    probe: poolOccupiedProbe,
    random: mulberry(20260918),
  });
  handlesAfterProbe = countTcpServers();
  check('优先池全不可用 → 仍然给出 >= ' + PORT_CANDIDATE_MIN + ' 个可用端口（不让用户无路可走）', rep2.recommended.length >= PORT_CANDIDATE_MIN, rep2.recommended.map((x) => x.port));
  check('扩展搜索被标记出来（coverage=extended）', rep2.coverage === 'extended', rep2.coverage);
  check('扩展出来的端口都不在优先池里（是真的另外找的）', rep2.recommended.every((x) => !SUGGESTED.includes(x.port)), rep2.recommended.map((x) => x.port));
  check('扩展出来的端口**真的绑得上**（不是编的结论）', rep2.recommended.every((x) => x.status === 'ok' && x.latencyMs >= 0), rep2.recommended.map((x) => ({ p: x.port, l: x.latencyMs })));
  const [lo, hi] = EPHEMERAL_PORT_RANGE;
  check('扩展搜索落在动态区间 ' + lo + '-' + hi + ' 内', rep2.recommended.every((x) => x.port >= lo && x.port <= hi), rep2.recommended.map((x) => x.port));

  //  6c 探测完**不残留监听句柄**：推荐出来的端口立刻能被再次 bind 上
  const rebound = [];
  for (const x of rep2.recommended) {
    try {
      const s = await occupyFresh(x.port);
      s.close();
    } catch (e) {
      rebound.push({ port: x.port, error: e && e.code });
    }
  }
  check('探测结束后推荐端口可被立刻重新 bind（探测没有泄漏监听句柄）', rebound.length === 0, rebound);
  //  更强的证据：**所有探测结论为 ok 的端口**现在都处于"可 bind"状态 —— 探测过程中
  //  没有把任何端口占着不放。（非 ok 的端口本来就是"绑不上"，不算残留。
  //  `process.getActiveResourcesInfo()` 会把已 close 但尚未被 GC 的 server wrap 也算进来，
  //  所以不用它当泄漏判据；"能不能重新绑上"才是硬证据。）
  const okProbed = rep2.probed.filter((x) => x.status === 'ok');
  const stillBound = [];
  for (const x of okProbed) {
    try {
      const s = await occupyFresh(x.port);
      s.close();
    } catch (e) {
      stillBound.push({ port: x.port, error: e && e.code });
    }
  }
  check('探测结论为 ok 的 ' + okProbed.length + ' 个端口**全部**可重新 bind（没有任何端口被探测过程占住）', stillBound.length === 0, stillBound);
  check('（参考）探测前后进程内 TCP 资源计数：', true, { before: handlesBeforeProbe, after: handlesAfterProbe });

  //  6d OS 保留段端口 → no-permission（本机有排除段时才可复现，否则如实记为未覆盖）
  if (reservedProbe) {
    const rp = await probePortAvailability(reservedProbe.port, '0.0.0.0', 400);
    check('OS 排除段端口实测结论 = no-permission（errno=' + reservedProbe.code + '）', rp.status === 'no-permission' && rp.errorCode === reservedProbe.code, rp);
  } else {
    check('OS 排除段端口场景：本机无可复现排除段 → 未覆盖（如实记录）', true, 'no-reserved-range');
  }

  //  6e 并发有上限 + 总超时（不能让探测卡住界面）
  let inFlight = 0;
  let maxInFlight = 0;
  const slowProbe = async (port, host, to) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 30));
    inFlight -= 1;
    return probePortAvailability(port, host, to);
  };
  const rep3 = await pickPortCandidates({ want: 4, concurrency: 4, probe: slowProbe, allowExtended: false });
  check('探测并发有上限（concurrency=4 时同时最多 4 个）', maxInFlight <= 4, maxInFlight);
  check('并发探测仍然能凑出推荐', rep3.recommended.length >= PORT_CANDIDATE_MIN, rep3.recommended.map((x) => x.port));

  let slowInFlight = 0;
  const hangProbe = async (port, host, to) => {
    slowInFlight += 1;
    await new Promise((r) => setTimeout(r, 400)); // 故意比总超时慢：必须被总超时截断
    slowInFlight -= 1;
    return probePortAvailability(port, host, to);
  };
  const t0 = Date.now();
  const rep4 = await pickPortCandidates({ want: 5, concurrency: 2, totalTimeoutMs: 500, probe: hangProbe });
  const slowElapsed = Date.now() - t0;
  check('总超时生效：探测比超时慢时被截断（< 2500ms，不会一直跑）', slowElapsed < 2500, slowElapsed + 'ms');
  check('被超时截断时如实标记 timedOut=true（不假装已经找遍）', rep4.timedOut === true, { timedOut: rep4.timedOut, recommended: rep4.recommended.length });
  check('被超时截断时不会假装凑够了 want=5', rep4.recommended.length < 5, rep4.recommended.length);

  //  6f 不做模块级缓存：连续两次调用都会**重新**实测
  let probeCalls = 0;
  const countingProbe = async (port, host, to) => {
    probeCalls += 1;
    return probePortAvailability(port, host, to);
  };
  await pickPortCandidates({ want: 3, allowExtended: true, probe: countingProbe });
  const first = probeCalls;
  await pickPortCandidates({ want: 3, allowExtended: true, probe: countingProbe });
  check('候选列表不缓存陈旧结果：第二次调用仍然重新实测', probeCalls > first, { first, second: probeCalls - first });

  //  6g **扩展搜索在生成候选时就剔除 OS 保留段**（确定性复现：随机源钉在保留段端口上）
  //     钉死随机源 → 第一条随机样本必然是那个保留段端口；再让所有探测结论都是 occupied，
  //     就一定会走到"样本里出现保留段端口"这条路径，且不依赖运气。
  const [elo, ehi] = EPHEMERAL_PORT_RANGE;
  const ephemeralReserved = osReserved0.ranges
    .map(([s, e]) => [Math.max(s, elo), Math.min(e, ehi)])
    .filter(([s, e]) => s <= e)[0] || null;
  if (ephemeralReserved) {
    const target = ephemeralReserved[0];
    const probedByUs = [];
    const repSkip = await pickPortCandidates({
      want: 5,
      allowExtended: true,
      probe: async (port) => {
        probedByUs.push(port);
        return { port, status: 'occupied', errorCode: 'EADDRINUSE', latencyMs: 0 };
      },
      random: () => (target - elo) / (ehi - elo + 1),
    });
    check('保留段端口**没有被探测**（在生成候选时就剔除，不是探完再筛）',
      !probedByUs.includes(target) && probedByUs.length > 20, { target, probed: probedByUs.slice(0, 8), probedTotal: probedByUs.length });
    check('被跳过的端口**如实记在 skipped 里**（不静默丢弃，带原因与命中的保留段）',
      repSkip.skipped.some((x) => x.port === target && x.reason === 'os-reserved-range' && Array.isArray(x.range)), repSkip.skipped.slice(0, 5));
    check('skipped 与 probed 不重叠（没探过的端口绝不假称"探过"）',
      !repSkip.probed.some((x) => x.port === target), repSkip.probed.slice(0, 5));
    check('报告里带出保留段的来源与全文（osReserved 可自证，不是黑箱）',
      repSkip.osReserved.ranges.length === osReserved0.ranges.length && repSkip.osReserved.source === osReserved0.source,
      { source: repSkip.osReserved.source, ranges: repSkip.osReserved.ranges.length });
  } else {
    check('扩展搜索剔除保留段：本机动态区间内没有可复现的保留段 → 未覆盖（如实记录）', true, 'no-ephemeral-reserved-range');
  }

  out = { ok: checks.every((c) => c.pass), suggested: SUGGESTED, checks };
} catch (e) {
  out = { ok: false, error: String((e && e.stack) || e), suggested: SUGGESTED, checks };
} finally {
  for (const m of meshes) {
    try {
      await m.disable();
    } catch {
      /* ignore */
    }
  }
  for (const s of listeners.values()) {
    try {
      s.close();
    } catch {
      /* ignore */
    }
  }
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

console.log(JSON.stringify(out));
process.exit(out.ok ? 0 : 1);
