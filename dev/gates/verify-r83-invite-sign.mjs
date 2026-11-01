/**
 * verify-r83-invite-sign —— #108 签名邀请绑定身份（纯密码学）
 *  ① 外部签名者（私钥不出安全存储）能签发并可验签；
 *  ② token 被篡改 → bad-signature；
 *  ③ 换一个人（subject 不匹配）→ subject-mismatch；
 *  ④ 过期 → expired；重放 → replayed；
 *  ⑤ 公钥与签名者不匹配 → bad-signature（不允许把坏邀请发出去）；
 *  ⑥ 角色越权（admin 发 owner）→ role-escalation。
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PKG = path.join(ROOT, 'packages', 'app-shell');
const Y = await import(pathToFileURL(path.join(PKG, 'dist', 'yao-qing-anchor.js')).href);

let ok = 0;
const hong = [];
const jian = (l, p, d) => {
  if (p) { ok += 1; console.log('  ok   ' + l); return; }
  hong.push(l);
  console.log('  FAIL ' + l + (d === undefined ? '' : ' ← ' + String(d).slice(0, 300)));
};

const owner = Y.shengChengShenFen();
const member = Y.shengChengShenFen();
const other = Y.shengChengShenFen();
const ownerKey = crypto.createPrivateKey(owner.siYaoPem);
const sign = (bytes) => crypto.sign(null, bytes, ownerKey).toString('base64');
const signBad = (bytes) => crypto.sign(null, Buffer.concat([bytes, Buffer.from('x')]), ownerKey).toString('base64');

const r = Y.shengChengYaoQing({
  sessionId: 'g-1', role: 'member', subjectFp: member.zhiWen,
  gongYao: owner.gongYaoPem, sign, issuerRole: 'owner', ownerFp: owner.zhiWen,
});
jian('外部签名者能签发邀请', !!r.token && r.url.startsWith('warmy://invite/') && r.expiresAt > Date.now());

const nonces = new Set();
const v = Y.yanZhengYaoQing(r.token, {
  gongYao: owner.gongYaoPem, sessionId: 'g-1', subjectFp: member.zhiWen,
  usedNonces: nonces, issuerRole: 'owner', ownerFp: owner.zhiWen,
});
jian('正确的人/会话/锚点验签通过', v.ok === true && v.subjectChecked === true, v);

const replay = Y.yanZhengYaoQing(r.token, {
  gongYao: owner.gongYaoPem, sessionId: 'g-1', subjectFp: member.zhiWen,
  usedNonces: nonces, issuerRole: 'owner', ownerFp: owner.zhiWen,
});
jian('同一 token 第二次使用 → replayed', replay.ok === false && replay.code === 'replayed', replay);

const wrong = Y.yanZhengYaoQing(r.token, {
  gongYao: owner.gongYaoPem, sessionId: 'g-1', subjectFp: other.zhiWen,
  usedNonces: new Set(), issuerRole: 'owner',
});
jian('换人使用 → subject-mismatch', wrong.ok === false && wrong.code === 'subject-mismatch', wrong);

const expiredToken = Y.shengChengYaoQing({
  sessionId: 'g-1', role: 'member', subjectFp: member.zhiWen,
  gongYao: owner.gongYaoPem, sign, issuerRole: 'owner', ownerFp: owner.zhiWen,
  now: Date.now() - 10_000, ttlMs: 1,
});
const expired = Y.yanZhengYaoQing(expiredToken.token, {
  gongYao: owner.gongYaoPem, sessionId: 'g-1', subjectFp: member.zhiWen, usedNonces: new Set(),
});
jian('过期邀请 → expired', expired.ok === false && expired.code === 'expired', expired);

const j = Y.jieYaoQingToken(r.token);
const tampered = Buffer.from(JSON.stringify({ p: { ...j.payload, role: 'owner' }, s: j.qianMing }), 'utf8').toString('base64url');
const tamper = Y.yanZhengYaoQing(tampered, {
  gongYao: owner.gongYaoPem, sessionId: 'g-1', subjectFp: member.zhiWen, usedNonces: new Set(),
});
jian('篡改 payload（member→owner）→ bad-signature', tamper.ok === false && tamper.code === 'bad-signature', tamper);

let badSignErr = '';
try {
  Y.shengChengYaoQing({
    sessionId: 'g-1', role: 'member', subjectFp: member.zhiWen,
    gongYao: owner.gongYaoPem, sign: signBad, issuerRole: 'owner',
  });
} catch (e) { badSignErr = String(e && e.code); }
jian('签名与公钥不匹配 → 拒绝产出 token', badSignErr === 'bad-signature', badSignErr);

let esc = '';
try {
  Y.shengChengYaoQing({
    sessionId: 'g-1', role: 'owner', subjectFp: member.zhiWen,
    gongYao: owner.gongYaoPem, sign, issuerRole: 'admin', ownerFp: owner.zhiWen,
  });
} catch (e) { esc = String(e && e.code); }
jian('admin 发 owner → role-escalation', esc === 'role-escalation', esc);

jian('签发时公钥缺失直接拒绝（不允许盲签）', (() => {
  try { Y.shengChengYaoQing({ sessionId: 'g-1', role: 'member', subjectFp: member.zhiWen, sign }); return false; }
  catch (e) { return String(e && e.code) === 'bad-key'; }
})());

console.log(`\nverify-r83-invite-sign: ${ok} ok / ${hong.length} FAIL`);
if (hong.length) console.log('红项：\n- ' + hong.join('\n- '));
process.exitCode = hong.length ? 1 : 0;
