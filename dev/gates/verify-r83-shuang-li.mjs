/**
 * verify-r83-shuang-li —— 双实例真实 E2E（SecureMesh 聊天 + 签名加入）
 *
 * 两个真实 Electron 实例（不同 user-data-dir、不同端口）：
 *  ① 交换自签名名片，彼此进入名册；
 *  ② 起 SecureMesh 并互加地址簿；
 *  ③ A 通过 chatNetSend 发一条消息 → B 的会话日志真的收到（role=them）；
 *  ④ A 建群，为 B 的公钥签发邀请；B 申请 → A 审批 → B 收到批准并落本地群；
 *  ⑤ 双方成员表都能看到对方指纹。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PKG = path.join(ROOT, 'packages', 'app-shell');
const ELECTRON = path.join(PKG, 'node_modules', 'electron', 'dist', 'electron.exe');
const MAIN = path.join(PKG, 'dist', 'electron-main.js');
const { attach, sleep } = await import(pathToFileURL(path.join(PKG, 'scripts', 'cdp-lib.mjs')).href);

const PORT_A = Number(process.env.R83_E2E_CDP_A || 9701);
const PORT_B = Number(process.env.R83_E2E_CDP_B || 9702);
const NET_A = Number(process.env.R83_E2E_NET_A || 9721);
const NET_B = Number(process.env.R83_E2E_NET_B || 9722);
const profA = path.join(os.tmpdir(), 'warmy-e2e-a-' + Date.now() + '-' + process.pid);
const profB = path.join(os.tmpdir(), 'warmy-e2e-b-' + Date.now() + '-' + process.pid);
fs.mkdirSync(profA, { recursive: true }); fs.mkdirSync(profB, { recursive: true });
let ok = 0; const hong = [];
const jian = (l, p, d) => { if (p) { ok += 1; console.log('  ok   ' + l); return; } hong.push(l); console.log('  FAIL ' + l + (d === undefined ? '' : ' ← ' + String(d).slice(0, 300))); };

const env = { ...process.env, WARMY_AUTH_BYPASS: '1', WARMY_TEST_HOOKS: '1' }; delete env.ELECTRON_RUN_AS_NODE;
const mk = (port, profile) => spawn(ELECTRON, ['--remote-debugging-port=' + port, '--disable-features=CalculateNativeWinOcclusion', '--user-data-dir=' + profile, MAIN], { cwd: PKG, stdio: ['ignore', 'ignore', 'ignore'], env });
const kids = [mk(PORT_A, profA), mk(PORT_B, profB)];
const clients = [];
async function guanOne(child, c) {
  try { if (c) await c.send('Browser.close', {}, { timeout: 5000 }); } catch { /* 已退 */ }
  try { if (c) c.close(); } catch { /* 已断 */ }
  for (let i = 0; i < 20; i++) { await sleep(150); try { process.kill(child.pid, 0); } catch { return; } }
  try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* noop */ }
}
try {
  for (const [port, tag] of [[PORT_A, 'A'], [PORT_B, 'B']]) {
    let c = null;
    for (let i = 0; i < 90; i++) { try { c = await attach(port, { biaoQian: 'e2e-' + tag, callTimeout: 20000 }); break; } catch { await sleep(300); } }
    if (!c) throw new Error('CDP ' + tag + ' 没连上');
    clients.push(c);
    await c.send('Runtime.enable');
    await c.waitFor('!!document.querySelector("#appTi")', { timeout: 30000, biaoQian: tag + ' 主界面' });
    await sleep(400);
  }
  const [A, B] = clients;

  const idA = await A.evaluate(`window.warmy.identityInfo()`);
  const idB = await B.evaluate(`window.warmy.identityInfo()`);
  const fpA = String(idA?.identity?.zhiWen || ''); const fpB = String(idB?.identity?.zhiWen || '');
  jian('两个实例有不同身份', !!fpA && !!fpB && fpA !== fpB, { fpA, fpB });

  const cardA = (await A.evaluate(`window.warmy.identityMyCard()`))?.card;
  const cardB = (await B.evaluate(`window.warmy.identityMyCard()`))?.card;
  jian('双方能导出签名名片', !!cardA?.signature && !!cardB?.signature);
  const putB = await A.evaluate(`window.warmy.identityPeerCard({ signedCard: ${JSON.stringify(cardB)} })`);
  const putA = await B.evaluate(`window.warmy.identityPeerCard({ signedCard: ${JSON.stringify(cardA)} })`);
  jian('双方互相接受签名名片', putB?.ok === true && putA?.ok === true, { putA, putB });

  const ea = await A.evaluate(`window.warmy.meshEnable({ port: ${NET_A} })`);
  const eb = await B.evaluate(`window.warmy.meshEnable({ port: ${NET_B} })`);
  jian('两个实例都起了 SecureMesh', ea?.ok === true && eb?.ok === true, { ea, eb });
  const sa = await A.evaluate(`window.warmy.meshStatus()`);
  const sb = await B.evaluate(`window.warmy.meshStatus()`);
  jian('Mesh 实际监听在指定端口', sa?.listening === true && sb?.listening === true && Number(sa?.port) === NET_A && Number(sb?.port) === NET_B, { sa, sb });

  await A.evaluate(`window.warmy.peersAdd({ nodeId: ${JSON.stringify(String(sb?.nodeId || 'B'))}, ming: 'B', host: '127.0.0.1', port: ${NET_B}, kind: 'lan' })`);
  await B.evaluate(`window.warmy.peersAdd({ nodeId: ${JSON.stringify(String(sa?.nodeId || 'A'))}, ming: 'A', host: '127.0.0.1', port: ${NET_A}, kind: 'lan' })`);
  await sleep(500);

  /* ── 聊天 E2E ── */
  const wen = 'E2E-' + Date.now().toString(36);
  const send = await A.evaluate(`window.warmy.chatNetSend({ sessionId: 'e2e-chat', text: ${JSON.stringify(wen)} })`);
  jian('A 的聊天消息发送成功', send?.ok === true && Number(send?.sent) > 0, send);
  let got = null;
  let blog = null;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    blog = await B.evaluate(`window.warmy.testChatLogText({ sessionId: 'e2e-chat', limit: 20 })`);
    const hit = (blog?.entries || []).find((e) => String(e.role) === 'assistant' && String(e.content || '').includes(wen));
    if (hit) { got = hit; break; }
  }
  jian('B 真的收到 A 的消息（role=them）', !!got, got || JSON.stringify(blog));

  /* ── 签名加入 E2E ── */
  const GID = 'g-e2e-' + Date.now().toString(36);
  const g = await A.evaluate(`window.warmy.groupCreate({ groupId: ${JSON.stringify(GID)}, ming: 'E2E 群', type: 'external' })`);
  jian('A 建群成功', g?.ok !== false, g);
  const inv = await A.evaluate(`window.warmy.inviteSign({ groupId: ${JSON.stringify(GID)}, role: 'member', subjectPublicKey: ${JSON.stringify(String(cardB?.publicKey || ''))} })`);
  jian('A 为 B 的公钥签发邀请', inv?.ok === true && !!inv?.invite?.token, inv && { ok: inv.ok, err: inv.error });
  const link = 'warmy://join?group=' + encodeURIComponent(GID) + '&node=' + encodeURIComponent(String(sa?.nodeId || '')) + '&port=' + NET_A + '&tok=' + encodeURIComponent(String(inv?.invite?.token || '')) + '&pk=' + encodeURIComponent(String(inv?.invite?.publicKey || ''));
  const vr = await B.evaluate(`window.warmy.inviteVerify({ token: ${JSON.stringify(String(inv?.invite?.token || ''))}, groupId: ${JSON.stringify(GID)}, gongYao: ${JSON.stringify(String(inv?.invite?.publicKey || ''))} })`);
  jian('B 验签通过（绑定自己）', vr?.ok === true, vr);
  const jr = await B.evaluate(`window.warmy.joinRequest({ ming: 'B', kind: 'human', target: ${JSON.stringify(link)}, targetType: 'group', token: ${JSON.stringify(String(inv?.invite?.token || ''))} })`);
  jian('B 的申请真的发到 A', jr?.ok === true && Number(jr?.sent) > 0, jr);
  let pend = null;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    const p = await A.evaluate(`window.warmy.joinPending()`);
    pend = (p?.items || []).find((x) => String(x.target) === GID && x.status === 'pending');
    if (pend) break;
  }
  jian('A 收到待审批申请（incoming）', !!pend, pend);
  if (pend) {
    const ap = await A.evaluate(`window.warmy.joinRespond({ id: ${JSON.stringify(String(pend.id))}, action: 'agree' })`);
    jian('A 批准成功', ap?.ok === true && ap?.changed === true, ap);
  }
  let joined = null;
  for (let i = 0; i < 50; i++) {
    await sleep(250);
    const gl = await B.evaluate(`window.warmy.groupList()`);
    joined = ((gl?.groups || gl?.items || [])).find((x) => String(x.groupId || x.id) === GID);
    if (joined) break;
  }
  jian('B 收到批准并落本地群', !!joined, joined);
  const bm = await B.evaluate(`window.warmy.groupMembers(${JSON.stringify(GID)})`);
  const aFp = String(idA?.identity?.zhiWen || '').replace(/-/g, '');
  jian('B 的成员表有创建者（A）', ((bm?.members || bm?.items || [])).some((x) => String(x.zhiWen || '').replace(/-/g, '') === aFp), bm);
  const am = await A.evaluate(`window.warmy.groupMembers(${JSON.stringify(GID)})`);
  const bFp = String(idB?.identity?.zhiWen || '').replace(/-/g, '');
  jian('A 的成员表有 B（带指纹）', ((am?.members || am?.items || [])).some((x) => String(x.zhiWen || '').replace(/-/g, '') === bFp), am);
} catch (e) {
  jian('门禁执行未抛错', false, (e && (e.stack || e.message)) || e);
} finally {
  await Promise.all(kids.map((k, i) => guanOne(k, clients[i])));
  try { fs.rmSync(profA, { recursive: true, force: true }); } catch { /* 锁 */ }
  try { fs.rmSync(profB, { recursive: true, force: true }); } catch { /* 锁 */ }
}
console.log(`\nverify-r83-shuang-li: ${ok} ok / ${hong.length} FAIL`);
if (hong.length) console.log('红项：\n- ' + hong.join('\n- '));
process.exitCode = hong.length ? 1 : 0;
