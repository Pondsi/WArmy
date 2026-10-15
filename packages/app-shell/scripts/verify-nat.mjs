#!/usr/bin/env node
/**
 * verify-nat.mjs —— NAT-PMP / STUN / 同时打洞 的**真往返**门禁（纯 Node，不起 Electron）
 *
 * 覆盖（第 22 轮把 `upnp` / `holepunch` 两档从"占位"变成"有客户端"之后必须有的证据）：
 *   1. STUN 报文编码/解码：头部字段、4 字节对齐、XOR-MAPPED-ADDRESS（IPv4 + IPv6）、错误响应；
 *      非 STUN / 截断 / 长度不符 **必须判 null**，不许猜出一个地址；
 *   2. **真 UDP 往返**（进程内 mock STUN 服务器）：拿到 mapped 地址；交易 ID 不匹配的响应必须被忽略；
 *   3. **隐私默认**：`servers` 为空 ⇒ 一个包都不发（不把本机出口地址告诉陌生人）；
 *   4. NAT-PMP：请求 16 字节与字段逐值、响应/失败码解码、**只读探针**（version=1）绝不创建映射、
 *      公网地址不能当网关发映射请求；
 *   5. 同时打洞：令牌两端对称、错令牌不认、真 UDP 互打命中、没人应答时如实报"没打通"；
 *   6. 阶梯接线：注入策略后 `upnp`/`holepunch` 真的会**拨 TCP 才算成功**；没注入时如实 unsupported，
 *      但理由**不许再说"未实现"**（客户端已经存在，那是假信息）；
 *   7. 源码诚实性：主进程不许内置公网 STUN 服务器地址。
 *
 * ⚠️ 本机单环境**证明不了跨 NAT 成功**：这里全部是协议正确性 + 状态机 + 诚实标注。
 *    跨真 NAT 需要两台机器，门禁里绝不假装"已穿越"。
 */
import dgram from 'node:dgram';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const natUrl = pathToFileURL(path.join(repoRoot, 'packages', 'sync-protocol', 'dist', 'nat.js')).href;
const ladderUrl = pathToFileURL(path.join(repoRoot, 'packages', 'sync-protocol', 'dist', 'ladder.js')).href;

if (!fs.existsSync(path.join(repoRoot, 'packages', 'sync-protocol', 'dist', 'nat.js'))) {
  console.error('[verify-nat] 缺少 dist：请先 node node_modules/typescript/bin/tsc -b packages/sync-protocol');
  process.exit(2);
}

const nat = await import(natUrl);
const ladderMod = await import(ladderUrl);

let pass = 0;
const reds = [];
const ok = (l, c, d) => {
  if (c) { pass++; console.log(`  ok   ${l}`); }
  else { reds.push(l); console.log(`  FAIL ${l}${d !== undefined ? '  ' + JSON.stringify(d).slice(0, 260) : ''}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('=== NAT-PMP / STUN / 打洞 门禁 ===');

// ── 1. STUN 编码 ──────────────────────────────────────────────
{
  const a = nat.bianMaStunQingQiu({ software: 'WArmy/gate' });
  const b = nat.bianMaStunQingQiu({});
  ok('1-1 Binding Request 头部 20 字节 + 属性 4 字节对齐', a.buf.length >= 20 && a.buf.length % 4 === 0, { len: a.buf.length });
  ok('1-2 消息类型 = 0x0001（Binding Request）', a.buf.readUInt16BE(0) === 0x0001, a.buf.readUInt16BE(0));
  ok('1-3 魔术 cookie 正确', a.buf.readUInt32BE(4) === nat.STUN_MAGIC_COOKIE);
  ok('1-4 头部长度字段与属性体一致', a.buf.readUInt16BE(2) === a.buf.length - 20, { field: a.buf.readUInt16BE(2), real: a.buf.length - 20 });
  ok('1-5 交易 ID 12 字节且两次不同（随机）', a.transactionId.length === 12 && !a.transactionId.equals(b.transactionId));
  const bao = nat.jieMaStunBao(a.buf);
  ok('1-6 自编码的请求能被自己解开（class=请求、method=1）', !!bao && bao.leiBie === 0 && bao.fangFa === 1, bao && { leiBie: bao.leiBie, fangFa: bao.fangFa });
}

// ── 2. STUN 解码（含负例）────────────────────────────────────
{
  const tid = Buffer.from('0102030405060708090a0b0c', 'hex');
  const v4 = nat.bianMaStunXiangYing({ transactionId: tid, mapped: { host: '203.0.113.7', port: 41234 } });
  const d4 = nat.jieMaStunBao(v4);
  ok('2-1 XOR-MAPPED-ADDRESS(IPv4) 逐字段还原', d4.mapped?.host === '203.0.113.7' && d4.mapped?.port === 41234, d4 && d4.mapped);
  ok('2-2 响应类别=成功(2)、方法=1、交易 ID 对得上', d4.leiBie === 2 && d4.fangFa === 1 && d4.transactionId === tid.toString('hex'), d4 && { leiBie: d4.leiBie, tid: d4.transactionId });
  const v6 = nat.bianMaStunXiangYing({ transactionId: tid, mapped: { host: '2001:db8::1', port: 41235 } });
  const d6 = nat.jieMaStunBao(v6);
  ok('2-3 XOR-MAPPED-ADDRESS(IPv6) 逐字节异或还原', d6.mapped?.host.replace(/:/g, '') === '2001:db8:0:0:0:0:0:1'.replace(/:/g, '') && d6.mapped?.port === 41235, d6 && d6.mapped);
  ok('2-4 IPv6 端口同样解出来', d6.mapped?.port === 41235);
  const err = nat.jieMaStunBao(nat.bianMaStunXiangYing({ transactionId: tid, type: 0x0111, errorCode: { code: 400, reason: 'Bad Request' } }));
  ok('2-5 错误响应解出 400 + reason', err.leiBie === 3 && err.errorCode?.code === 400 && err.errorCode?.reason === 'Bad Request', err && err.errorCode);
  const notStun = Buffer.alloc(28); notStun.writeUInt16BE(0x8001, 0); notStun.writeUInt16BE(8, 2);
  ok('2-6 前两位非 0（不是 STUN）⇒ null，不硬解', nat.jieMaStunBao(notStun) === null);
  ok('2-7 短于 20 字节 ⇒ null', nat.jieMaStunBao(Buffer.from([0, 1, 0, 0])) === null);
  const trunc = v4.subarray(0, 24);
  ok('2-8 声明长度 > 实际字节 ⇒ null（截断包不猜地址）', nat.jieMaStunBao(trunc) === null, { lenField: trunc.readUInt16BE(2), actual: trunc.length });
  const misaligned = Buffer.from(v4); misaligned.writeUInt16BE(5, 2);
  ok('2-9 长度不是 4 的倍数 ⇒ null（RFC 对齐要求）', nat.jieMaStunBao(misaligned) === null);
  const otherCookie = Buffer.from(v4); otherCookie.writeUInt32BE(0x12345678, 4);
  ok('2-10 cookie 不是 RFC 值 ⇒ 仍能解但如实标 xieYi=false（legacy）', nat.jieMaStunBao(otherCookie)?.xieYi === false);
}

// ── 3. 真 UDP 往返（mock STUN 服务器）────────────────────────
let stunPort = 0;
const stunSeen = [];
{
  const sock = dgram.createSocket('udp4');
  sock.on('message', (msg, rinfo) => {
    const bao = nat.jieMaStunBao(msg);
    if (!bao || bao.leiBie !== 0) return;
    stunSeen.push({ tid: bao.transactionId, from: `${rinfo.address}:${rinfo.port}` });
    const tidBuf = Buffer.from(bao.transactionId, 'hex');
    // 服务器报告的是**它看到的来源地址**（这里就是回环 + 客户端临时端口）
    sock.send(nat.bianMaStunXiangYing({ transactionId: tidBuf, mapped: { host: '203.0.113.99', port: 45678 }, software: 'mock-stun' }), rinfo.port, rinfo.address, () => {});
  });
  await new Promise((r) => sock.bind(0, '127.0.0.1', r));
  stunPort = sock.address().port;
}
{
  const jie = await nat.dongJieXuanZhiByStun({ servers: [`127.0.0.1:${stunPort}`], timeoutMs: 2000 });
  ok('3-1 真实 UDP 往返拿到公网映射地址', jie.ok === true && jie.publicAddress?.port === 45678, jie && { ok: jie.ok, addr: jie.publicAddress, reason: jie.reason });
  ok('3-2 服务器确实收到一个 Binding Request（交易 ID 记下来了）', stunSeen.length === 1 && /^[0-9a-f]{24}$/.test(stunSeen[0].tid), stunSeen);
  ok('3-3 via 写清是哪台服务器给的', jie.via === `127.0.0.1:${stunPort}`, jie.via);
  const t0 = Date.now();
  const noResp = await nat.dongJieXuanZhiByStun({ servers: [`127.0.0.1:${stunPort + 500}`], timeoutMs: 400 });
  ok('3-4 没人应答 ⇒ 如实 timeout（不编地址）', noResp.ok === false && noResp.reason === 'timeout' && !noResp.publicAddress, { reason: noResp.reason, ms: Date.now() - t0 });
  const empty = await nat.dongJieXuanZhiByStun({ servers: [] });
  ok('3-5 **隐私默认**：不配服务器就一个包都不发', empty.ok === false && empty.reason === 'no-server' && empty.attempts.length === 0, empty);
  const hun = await nat.dongJieXuanZhiByStun({ servers: ['nonsense-without-host', `127.0.0.1:${stunPort}`], timeoutMs: 800 });
  ok('3-6 坏服务器条目不影响好服务器成功（逐个试，两条都记账）', hun.ok === true && hun.attempts.length >= 2, hun.attempts);
}
{
  // 交易 ID 不匹配的响应必须被忽略（别人家的回包不能当自己的）
  const liar = dgram.createSocket('udp4');
  liar.on('message', (msg, rinfo) => {
    const tid = Buffer.alloc(12, 0xff); // 故意用别的交易 ID
    liar.send(nat.bianMaStunXiangYing({ transactionId: tid, mapped: { host: '198.51.100.66', port: 1234 } }), rinfo.port, rinfo.address, () => {});
  });
  await new Promise((r) => liar.bind(0, '127.0.0.1', r));
  const jie = await nat.dongJieXuanZhiByStun({ servers: [`127.0.0.1:${liar.address().port}`], timeoutMs: 500 });
  ok('3-7 交易 ID 不对的响应被丢弃 ⇒ 如实 timeout', jie.ok === false && jie.reason === 'timeout', jie && { reason: jie.reason, addr: jie.publicAddress });
  liar.close();
}

// ── 4. NAT-PMP 编码 / 解码 ───────────────────────────────────
{
  const udp = nat.bianMaNatPmpYingSheQingQiu({ protocol: 'udp', internalPort: 8443, leaseSec: 7200 });
  const tcp = nat.bianMaNatPmpYingSheQingQiu({ protocol: 'tcp', internalPort: 8443, leaseSec: 7200 });
  const exp = nat.bianMaNatPmpYingSheQingQiu({ protocol: 'udp', internalPort: 8443, externalPort: 5555, explicit: true, leaseSec: 600 });
  ok('4-1 映射请求恰好 16 字节', udp.length === 16 && tcp.length === 16 && exp.length === 16, { udp: udp.length });
  ok('4-2 opcode：UDP=0 / TCP=1 / 显式外部端口=2', udp[1] === 0 && tcp[1] === 1 && exp[1] === 2, { udp: udp[1], tcp: tcp[1], exp: exp[1] });
  ok('4-3 version 字段=0（RFC 唯一支持的版本）', udp[0] === 0 && exp[0] === 0);
  ok('4-4 内部端口按大端写在 4-5 字节', udp.readUInt16BE(4) === 8443 && exp.readUInt16BE(4) === 8443);
  ok('4-5 显式模式把外部端口写在 2-3 与 8-9 两处', exp.readUInt16BE(2) === 5555 && exp.readUInt16BE(8) === 5555);
  ok('4-6 租期 4 字节大端', udp.readUInt32BE(12) === 7200 && exp.readUInt32BE(12) === 600);
  ok('4-7 端口越界被夹住（不写出界值）', nat.bianMaNatPmpYingSheQingQiu({ protocol: 'udp', internalPort: 99999, leaseSec: -5 }).readUInt16BE(4) === 65535);
  const good = Buffer.alloc(16); good[0] = 0; good[1] = 129; good.writeUInt16BE(0, 2); good.writeUInt32BE(4242, 4); good.writeUInt16BE(8443, 8); good.writeUInt16BE(52100, 10); good.writeUInt32BE(7200, 12);
  const jie = nat.jieMaNatPmpXiangYing(good);
  ok('4-8 响应解码：opcode 129→TCP、端口、租期、epoch', !!jie && jie.protocol === 'tcp' && jie.internalPort === 8443 && jie.externalPort === 52100 && jie.lifetime === 7200 && jie.epoch === 4242, jie);
  ok('4-9 result=0 ⇒ resultText=ok', jie.resultText === 'ok');
  const refused = Buffer.alloc(16); refused[1] = 128; refused.writeUInt16BE(2, 2);
  const fs_ = nat.jieMaNatPmpShibai(refused);
  ok('4-10 4 字节失败响应解出 unauthorized', fs_?.result === 2 && fs_?.resultText === 'unauthorized', fs_);
  const opcodeJiu = Buffer.alloc(16); opcodeJiu[1] = 139;
  ok('4-11 短包 / opcode 越界 ⇒ null（不假装成功）', nat.jieMaNatPmpXiangYing(Buffer.alloc(8)) === null && nat.jieMaNatPmpXiangYing(opcodeJiu) === null);
  const refused16 = Buffer.alloc(16); refused16[1] = 128; refused16.writeUInt16BE(3, 2);
  ok('4-12 16 字节的 128 是"UDP 映射响应带失败码"：解得出但 result≠0，调用方必须查 result', nat.jieMaNatPmpXiangYing(refused16)?.resultText === 'not-a-gateway');
}

// ── 5. NAT-PMP 只读探针 / 网关护栏 ───────────────────────────
{
  let recved = [];
  const fakeGw = async (pkt, gw, port, timeoutMs) => { recved.push({ gw, port, pkt }); return gw === '192.168.1.1' ? Buffer.from([0, 128, 0, 1]) : null; };
  recved = [];
  const probe = await nat.natpmpMenjinZaiXian({ gateways: ['192.168.1.1'], request: fakeGw });
  ok('5-1 探针包 version=1（**故意不支持**，因此不会创建映射）', recved.length === 1 && recved[0].pkt[0] === 1, recved[0] && { v: recved[0].pkt[0], op: recved[0].pkt[1] });
  ok('5-2 探针打到 5351/UDP', recved[0].port === nat.NATPMP_PORT);
  ok('5-3 有响应 ⇒ alive=true 并写清是哪台网关', probe.alive === true && probe.gateway === '192.168.1.1', probe);
  recved = [];
  const dead = await nat.natpmpMenjinZaiXian({ gateways: ['192.168.99.1'], request: async () => null });
  ok('5-4 无响应 ⇒ alive=false（不猜"支持"）', dead.alive === false && /没应答/.test(dead.detail), dead);
  recved = [];
  const badGw = await nat.natpmpYingShe({ gateways: ['8.8.8.8'], internalPort: 8443, request: fakeGw });
  ok('5-5 **公网地址不许当网关**发映射请求（一个包都不发）', recved.length === 0 && badGw.ok === false && badGw.attempts[0]?.reason === 'bad-gateway', { sent: recved.length, attempts: badGw.attempts });
  recved = [];
  const mapped = await nat.natpmpYingShe({
    gateways: ['192.168.1.1'], protocol: 'tcp', internalPort: 8443, leaseSec: 3600,
    request: async (pkt) => { recved.push(pkt); const r = Buffer.alloc(16); r[0] = 0; r[1] = 129; r.writeUInt16BE(0, 2); r.writeUInt16BE(8443, 8); r.writeUInt16BE(60000, 10); r.writeUInt32BE(3600, 12); return r; },
  });
  ok('5-6 映射成功 ⇒ 报出外部端口与租期', mapped.ok === true && mapped.publicAddress?.port === 60000 && mapped.response?.lifetime === 3600, mapped);
  ok('5-7 映射请求 version=0（真改路由器状态，只在显式调用时发）', recved[0][0] === 0 && recved[0][1] === 1);
  ok('5-8 detail 如实说明"公网 IP 还得另问 STUN"（NAT-PMP 只给端口）', /STUN/.test(mapped.detail || ''), mapped.detail);
  recved = [];
  const cancel = await nat.natpmpQuXiao({
    gateways: ['192.168.1.1'], protocol: 'udp', internalPort: 8443,
    request: async (pkt) => { recved.push(pkt); const r = Buffer.alloc(16); r[0] = 0; r[1] = 128; r.writeUInt16BE(0, 2); r.writeUInt16BE(8443, 8); r.writeUInt16BE(0, 10); return r; },
  });
  ok('5-9 撤销=同一内部端口租期写 0（RFC 6886 无删除操作码）', recved[0]?.readUInt32BE(12) === 0 && cancel.ok === true, { lease: recved[0]?.readUInt32BE(12), ok: cancel.ok });
  const houXuan = nat.caiJiMenjinHouXuan({ en0: [{ family: 'IPv4', address: '192.168.1.23', netmask: '255.255.255.0' }] });
  ok('5-10 网关启发式只在私有网段里猜，且不等于本机地址', houXuan.includes('192.168.1.1') && !houXuan.includes('192.168.1.23'), houXuan);
  ok('5-11 公网网卡地址不产生网关候选', nat.caiJiMenjinHouXuan({ en0: [{ family: 'IPv4', address: '8.8.8.8' }] }).length === 0);
}

// ── 6. 同时打洞 ──────────────────────────────────────────────
{
  const a = nat.quDaDongLingPai('fpAAA', 'fpBBB');
  const b = nat.quDaDongLingPai('fpBBB', 'fpAAA');
  ok('6-1 打洞令牌两端对称（顺序无关）', a === b && /^[0-9a-f]{16}$/.test(a), { a, b });
  ok('6-2 不同对端 ⇒ 不同令牌', nat.quDaDongLingPai('fpAAA', 'fpCCC') !== a);
  ok('6-3 包体带魔数与令牌', nat.daDongBao(a).toString('utf8').startsWith(nat.DA_DONG_MAGIC) && nat.daDongBao(a).toString('utf8').includes(a));
  ok('6-4 错令牌不认（陌生人不能伪造命中）', nat.shiFouDaDongBao(nat.daDongBao('0000000000000000'), a) === false && nat.shiFouDaDongBao(nat.daDongBao(a), a) === true);
  ok('6-5 非打洞包不认', nat.shiFouDaDongBao(Buffer.from('hello world'), a) === false);

  // 两个真 socket 互打：被叫方先监听，主叫方打过去 ⇒ 双方都命中
  const jia = dgram.createSocket('udp4');
  const yi = dgram.createSocket('udp4');
  await new Promise((r) => yi.bind(0, '127.0.0.1', r));
  const yiPort = yi.address().port;
  yi.on('message', (m, rinfo) => { if (nat.shiFouDaDongBao(m, a)) yi.send(nat.daDongBao(a), rinfo.port, rinfo.address, () => {}); });
  const jieguo = await nat.tongShiDaDong({ lingpai: a, candidates: [{ host: '127.0.0.1', port: yiPort }], durationMs: 700, intervalMs: 100 });
  ok('6-6 真 UDP 互打命中（且 NAT 意义上的"回包"来自同一端点）', jieguo.ok === true && jieguo.hits.length === 1 && jieguo.hits[0].port === yiPort, jieguo && { ok: jieguo.ok, hits: jieguo.hits, sent: jieguo.sent });
  ok('6-7 命中前至少发过一包', jieguo.sent >= 1);
  const kong = await nat.tongShiDaDong({ lingpai: a, candidates: [{ host: '127.0.0.1', port: yiPort + 3000 }], durationMs: 400, intervalMs: 100, reply: false });
  ok('6-8 没人应答 ⇒ ok=false 并如实写"不算打通"（不假装）', kong.ok === false && kong.hits.length === 0 && /没有对端回来/.test(kong.detail), kong);
  const wu = await nat.tongShiDaDong({ lingpai: '', candidates: [] });
  ok('6-9 没有候选或令牌 ⇒ 一个包都不发', wu.ok === false && wu.sent === 0, wu);
  jia.close(); yi.close();
}

// ── 7. 阶梯接线：注入后真的会拨 TCP；没注入时理由不许说谎 ────
{
  const defaultLadder = new ladderMod.LianJieTiZi({ perRungTimeoutMs: 300 });
  const upnpStrat = defaultLadder.strategyFor('upnp');
  const hpStrat = defaultLadder.strategyFor('holepunch');
  ok('7-1 未注入时两档仍如实 unsupported（不假装能跑）', upnpStrat?.supported === false && hpStrat?.supported === false);
  ok('7-2 但理由**不许说"未实现"**（客户端已在 nat.ts 里）', !/未实现/.test(upnpStrat?.unsupportedReason || '') && !/未实现/.test(hpStrat?.unsupportedReason || ''), { upnp: upnpStrat?.unsupportedReason, hp: hpStrat?.unsupportedReason });
  ok('7-3 理由里点明"客户端已实现 + 还缺什么"', /nat\.ts/i.test(upnpStrat?.unsupportedReason || '') && /nat\.ts/i.test(hpStrat?.unsupportedReason || ''), { upnp: upnpStrat?.unsupportedReason });

  // 真 TCP 服务器当"对端"，验证"只有拨通才算成功"
  const srv = net.createServer((s) => s.destroy());
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const srvPort = srv.address().port;

  const upnp = nat.chuangJianUpnpYingCelue({ mapped: () => ({ internalPort: 8443, externalPort: 60000, mechanism: 'natpmp' }) });
  const r1 = await upnp.attempt({
    target: { zhiWen: 'z', mappedAddresses: [{ host: '127.0.0.1', port: srvPort, mechanism: 'natpmp' }], addresses: [] },
    timeoutMs: 800,
    dialTcp: async (h, p) => await ladderMod.boTcpXiangQing(h, p, 500),
    relays: [], log: () => {},
  });
  ok('7-4 upnp 档拨通对端映射地址 ⇒ ok 并带地址', r1.ok === true && r1.address?.port === srvPort, r1);
  ok('7-5 detail 里如实带上本机映射状态', /本机映射/.test(r1.detail || ''), r1.detail);
  const r2 = await upnp.attempt({
    target: { zhiWen: 'z', addresses: [] }, timeoutMs: 300, dialTcp: async () => ({ ok: false }), relays: [], log: () => {},
  });
  ok('7-6 对端没宣告映射 ⇒ skipped + 明确结论码（不是"失败"也不是"成功"）', r2.ok === false && r2.skip === true && r2.code === 'upnp-no-peer-mapping', r2);
  const r2b = await nat.chuangJianUpnpYingCelue({}).attempt({
    target: { zhiWen: 'z', addresses: [] }, timeoutMs: 300, dialTcp: async () => ({ ok: false }), relays: [], log: () => {},
  });
  ok('7-7 本机没申请过映射时，detail 写"需用户显式触发"', /显式触发/.test(r2b.detail || ''), r2b.detail);

  const hp = nat.chuangJianDaDongCelue({ selfFingerprint: () => 'fp-self' });
  const r3 = await hp.attempt({
    target: { zhiWen: 'fp-peer', addresses: [{ host: '127.0.0.1', port: srvPort, source: 'manual' }] },
    timeoutMs: 900, dialTcp: async (h, p) => await ladderMod.boTcpXiangQing(h, p, 400), relays: [], log: () => {},
  });
  ok('7-8 打洞档：TCP 拨通才算成功（并记录是打洞窗口内拨通的）', r3.ok === true && r3.code === 'punch-then-dial', r3 && { ok: r3.ok, code: r3.code });
  ok('7-9 没配 STUN 时如实写"未配置 ⇒ 不做反射发现"', /未配置 STUN/.test(r3.detail || ''), r3.detail);
  const r4 = await hp.attempt({ target: { zhiWen: '', addresses: [] }, timeoutMs: 300, dialTcp: async () => ({ ok: false }), relays: [], log: () => {} });
  ok('7-10 缺对端指纹 ⇒ skipped（令牌无从推出，不瞎打）', r4.ok === false && r4.skip === true && r4.code === 'punch-no-fingerprint', r4);
  const r5 = await nat.chuangJianDaDongCelue({ selfFingerprint: () => 'fp-self' }).attempt({
    target: { zhiWen: 'fp-peer', addresses: [] }, timeoutMs: 300, dialTcp: async () => ({ ok: false }), relays: [], log: () => {},
  });
  ok('7-11 没有候选端点 ⇒ skipped 且不发包', r5.ok === false && r5.code === 'punch-no-candidate', r5);

  // 只有 UDP 命中、TCP 拨不通 ⇒ 绝不能报 ok（这是"假装打通"的唯一路径）
  const onlyUdp = dgram.createSocket('udp4');
  await new Promise((r) => onlyUdp.bind(0, '127.0.0.1', r));
  const udpPort = onlyUdp.address().port;
  const lp = nat.quDaDongLingPai('fp-self', 'fp-peer');
  onlyUdp.on('message', (m, rinfo) => {
    if (nat.shiFouDaDongBao(m, lp)) onlyUdp.send(nat.daDongBao(lp), rinfo.port, rinfo.address, () => {});
  });
  const r6 = await nat.chuangJianDaDongCelue({ selfFingerprint: () => 'fp-self', punchMs: 600 }).attempt({
    target: { zhiWen: 'fp-peer', addresses: [{ host: '127.0.0.1', port: udpPort, source: 'manual' }] },
    timeoutMs: 400, dialTcp: async () => ({ ok: false, detail: '拒绝连接' }), relays: [], log: () => {},
  });
  ok('7-12 **UDP 双向命中但 TCP 拨不通 ⇒ 判失败**（code=punch-udp-only，不许报打通）', r6.ok === false && r6.code === 'punch-udp-only' && /不算打通|拨不通/.test(r6.detail || ''), r6);
  onlyUdp.close();
  srv.close();
}

// ── 8. 源码诚实性 ────────────────────────────────────────────
{
  const mainTs = fs.readFileSync(path.join(repoRoot, 'packages', 'app-shell', 'src', 'electron-main.ts'), 'utf8');
  const natTs = fs.readFileSync(path.join(repoRoot, 'packages', 'sync-protocol', 'src', 'nat.ts'), 'utf8');
  ok('8-1 主进程 IPC 会按 mechanism 分流 upnp/natpmp/stun', /mechanism === 'stun'/.test(mainTs) && /mechanism === 'natpmp'/.test(mainTs));
  ok('8-2 STUN 走用户点名：不配 servers 就不发（源码里 servers 来自入参）', /input\.servers/.test(mainTs) && /servers:\s*servers/.test(mainTs));
  const gongKai = (natTs.match(/stun[a-z]*\.[a-z0-9-]+\.[a-z]{2,}/gi) || []);
  ok('8-3 源码里**没有内置公网 STUN 服务器域名**', gongKai.length === 0, gongKai);
  ok('8-4 映射动作只在显式调用路径上（probe 用 version=1 只读探针）', /buf\[0\] = 1/.test(natTs) && /natpmpMenjinZaiXian/.test(mainTs));
  ok('8-5 UI 不再把两档说成"未实现"（改成 needs-config 标注）', /NET_RUNG_NEEDS_CONFIG/.test(fs.readFileSync(path.join(repoRoot, 'packages', 'app-shell', 'src', 'renderer', 'app.js'), 'utf8')) && !/NET_RUNG_UNSUPPORTED/.test(mainTs));
  ok('8-6 i18n 新键已在 10 个语言包里', ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko', 'fr', 'es', 'pt', 'ru', 'eo'].every((L) => {
    try { const p = JSON.parse(fs.readFileSync(path.join(repoRoot, 'packages', 'app-shell', 'src', 'i18n', `${L}.json`), 'utf8')); return typeof p['net.ladder.needsConfig'] === 'string' && p['net.ladder.needsConfig'].trim().length > 0; } catch { return false; }
  }));
}

console.log(`\n=== verify-nat：${reds.length === 0 ? 'PASS' : 'FAILED'} ${pass}/${pass + reds.length} ===`);
if (reds.length) { console.log('失败项：\n - ' + reds.join('\n - ')); process.exit(1); }
process.exit(0);
