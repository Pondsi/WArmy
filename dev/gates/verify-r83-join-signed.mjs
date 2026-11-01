/**
 * verify-r83-join-signed —— #112 加入申请持久化/审批 + #108 签名邀请接线（真 Electron IPC）
 *  ① 创建本机群；
 *  ② 用本机身份签发"绑定到本机指纹"的签名邀请；
 *  ③ 走真实 inviteVerify 验签（篡改 token 必须失败）；
 *  ④ joinRequest 落盘为 pending；joinPending 能读到；
 *  ⑤ 批准后成员表真的写入且带指纹；
 *  ⑥ join-requests.json / groups.json 都有落盘结果（重启不丢，不是内存态）。
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

const PORT = Number(process.env.R83_JOIN_PORT || 9692);
const profile = path.join(os.tmpdir(), 'warmy-r83-join-' + Date.now() + '-' + process.pid);
fs.mkdirSync(profile, { recursive: true });
let ok = 0;
const hong = [];
const jian = (l, p, d) => {
  if (p) { ok += 1; console.log('  ok   ' + l); return; }
  hong.push(l);
  console.log('  FAIL ' + l + (d === undefined ? '' : ' ← ' + String(d).slice(0, 260)));
};

const env = { ...process.env, WARMY_AUTH_BYPASS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(ELECTRON, [
  '--remote-debugging-port=' + PORT,
  '--disable-features=CalculateNativeWinOcclusion',
  '--user-data-dir=' + profile,
  MAIN,
], { cwd: PKG, stdio: ['ignore', 'ignore', 'ignore'], env });

let c = null;
async function guan() {
  try { if (c) await c.send('Browser.close', {}, { timeout: 6000 }); } catch { /* 已退 */ }
  try { if (c) c.close(); } catch { /* 已断 */ }
  for (let i = 0; i < 30; i++) {
    await sleep(200);
    try { process.kill(child.pid, 0); } catch { return; }
  }
  try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* noop */ }
}

const GID = 'g-r83-join';
try {
  for (let i = 0; i < 80; i++) {
    try { c = await attach(PORT, { biaoQian: 'r83-join', callTimeout: 20000 }); break; } catch { await sleep(300); }
  }
  if (!c) throw new Error('CDP 没连上');
  await c.send('Runtime.enable');
  await c.waitFor('!!document.querySelector("#appTi")', { timeout: 30000, biaoQian: '主界面' });
  await sleep(500);

  const create = await c.evaluate(`window.warmy.groupCreate({ groupId: ${JSON.stringify(GID)}, ming: '加入测试群', type: 'external' })`);
  jian('创建本机群', create && create.ok !== false, JSON.stringify(create).slice(0, 200));
  const idn = await c.evaluate(`window.warmy.identityInfo()`);
  const fp = String((idn && idn.identity && idn.identity.zhiWen) || '');
  const pub = String((idn && idn.identity && idn.identity.publicKey) || '');
  jian('读本机身份指纹与公钥', !!fp && !!pub, JSON.stringify(idn).slice(0, 240));

  const inv = await c.evaluate(`window.warmy.inviteSign({ groupId: ${JSON.stringify(GID)}, role: 'admin', subjectPublicKey: ${JSON.stringify(pub)} })`);
  const tok = String((inv && inv.invite && inv.invite.token) || '');
  const pk = String((inv && inv.invite && inv.invite.publicKey) || '');
  jian('用本机私钥签发绑定到本机指纹的邀请', !!(inv && inv.ok && tok && pk), JSON.stringify(inv && { ok: inv.ok, err: inv.error }).slice(0, 200));

  const ver = await c.evaluate(`window.warmy.inviteVerify({ token: ${JSON.stringify(tok)}, groupId: ${JSON.stringify(GID)}, gongYao: ${JSON.stringify(pk)} })`);
  jian('真实验签通过（绑定本机指纹）', ver && ver.ok === true, JSON.stringify(ver).slice(0, 200));

  const tampered = Buffer.from(JSON.stringify({ p: { ...inv.invite, role: 'owner' }, s: 'AAAA' }), 'utf8').toString('base64url');
  const bad = await c.evaluate(`window.warmy.inviteVerify({ token: ${JSON.stringify(tampered)}, groupId: ${JSON.stringify(GID)}, gongYao: ${JSON.stringify(pk)} })`);
  jian('篡改 token 验签失败', bad && bad.ok === false, JSON.stringify(bad).slice(0, 200));

  const link = 'warmy://join?group=' + encodeURIComponent(GID) + '&tok=' + encodeURIComponent(tok) + '&pk=' + encodeURIComponent(pk);
  const jr = await c.evaluate(`window.warmy.joinRequest({ ming: '加入测试', kind: 'human', target: ${JSON.stringify(link)}, targetType: 'group', token: ${JSON.stringify(tok)} })`);
  jian('加入申请写入 pending（无 peer 时如实 sent=0）', jr && jr.ok === true && jr.sent === 0, JSON.stringify(jr).slice(0, 200));

  const pend = await c.evaluate(`window.warmy.joinPending()`);
  const item = ((pend && pend.items) || []).find((x) => x.target === GID && x.status === 'pending');
  jian('joinPending 能读到待审批项', !!item, JSON.stringify(pend && { count: pend.count }).slice(0, 200));

  if (item) {
    const resp = await c.evaluate(`window.warmy.joinRespond({ id: ${JSON.stringify(item.id)}, action: 'agree' })`);
    jian('批准加入成功', resp && resp.ok === true && resp.changed === true, JSON.stringify(resp).slice(0, 200));
  }
  const mem = await c.evaluate(`window.warmy.groupMembers(${JSON.stringify(GID)})`);
  const rows = (mem && (mem.members || mem.items)) || [];
  jian('成员表真的写入且带本机指纹', rows.some((x) => String(x.zhiWen || '').replace(/-/g, '') === fp.replace(/-/g, '')), JSON.stringify(rows).slice(0, 300));
  jian('邀请角色 admin 在批准后落到成员表', rows.some((x) => String(x.role || '') === 'admin'), JSON.stringify(rows).slice(0, 300));

  const jrFile = path.join(profile, 'join-requests.json');
  const gpFile = path.join(profile, 'groups.json');
  const jrRaw = fs.existsSync(jrFile) ? fs.readFileSync(jrFile, 'utf8') : '';
  const gpRaw = fs.existsSync(gpFile) ? fs.readFileSync(gpFile, 'utf8') : '';
  jian('join-requests.json 已落盘且状态 approved', jrRaw.includes('approved') && jrRaw.includes(GID), jrRaw.slice(0, 160));
  jian('groups.json 已落盘成员', gpRaw.includes(GID) && gpRaw.includes(fp.slice(0, 8)), gpRaw.slice(0, 160));
} catch (e) {
  jian('门禁执行未抛错', false, (e && (e.stack || e.message)) || e);
} finally {
  await guan();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Windows 锁 */ }
}

console.log(`\nverify-r83-join-signed: ${ok} ok / ${hong.length} FAIL`);
if (hong.length) console.log('红项：\n- ' + hong.join('\n- '));
process.exitCode = hong.length ? 1 : 0;
