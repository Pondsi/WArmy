/**
 * verify-r82-invite —— #108 邀请名片 / 加入流程 / 成员权限 / 会话锚点门禁
 *
 * 纯 Node 直接跑（不依赖 Electron、不读真实 profile）：
 *   node --experimental-strip-types dev/gates/verify-r82-invite.mjs
 * Node 24 也可直接 `node dev/gates/verify-r82-invite.mjs`（类型剥离默认开启）。
 *
 * 覆盖：正常邀请 / 篡改 / 过期 / 换会话 / subject 不符 / nonce 重放 /
 *       viewer 邀请 admin / owner 唯一 / 审批幂等 / 拒绝后再申请 / 角色表真值。
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const M = await import(pathToFileURL(path.join(ROOT, 'packages/app-shell/src/yao-qing-anchor.ts')).href);

let ok = 0;
let fail = 0;

function j(name, fn) {
  try {
    fn();
    ok += 1;
    console.log(`ok   ${name}`);
  } catch (e) {
    fail += 1;
    const detail = String((e && (e.stack || e.message)) || e).split('\n').slice(0, 3).join(' | ');
    console.log(`FAIL ${name} ← ${detail}`);
  }
}

const NOW = 1_800_000_000_000;
const SESSION = 'sess-r82-anchor';

const owner = M.shengChengShenFen();
const member = M.shengChengShenFen();
const other = M.shengChengShenFen();

function issue(over = {}) {
  return M.shengChengYaoQing({
    siYao: owner.siYaoPem,
    gongYao: owner.gongYaoPem,
    sessionId: SESSION,
    role: 'member',
    subjectGongYao: member.gongYaoPem,
    now: NOW,
    ttlMs: 60_000,
    nonce: 'nonce-' + Math.random().toString(16).slice(2),
    ...over,
  });
}

function verify(token, over = {}) {
  return M.yanZhengYaoQing(token, {
    gongYao: owner.gongYaoPem,
    sessionId: SESSION,
    now: NOW + 1_000,
    subjectGongYao: member.gongYaoPem,
    usedNonces: new Set(),
    ...over,
  });
}

function manualToken(siYao, payload) {
  const p = {
    v: 1,
    sessionId: SESSION,
    role: 'member',
    issuerFp: M.zhiWen(owner.gongYaoPem),
    subjectFp: M.zhiWen(member.gongYaoPem),
    issuedAt: NOW,
    expiresAt: NOW + 60_000,
    nonce: 'manual-' + Math.random().toString(16).slice(2),
    ...payload,
  };
  const s = M.qianMing(siYao, M.yaoQingQianMingWen(p));
  return Buffer.from(JSON.stringify({ p, s }), 'utf8').toString('base64url');
}

// ── 身份 / 指纹 / 签名 ──

j('身份：Ed25519 PEM + 指纹固定 8 组、大小写归一、不同密钥不同指纹', () => {
  assert.equal(owner.suanFa, 'Ed25519');
  assert.match(owner.siYaoPem, /BEGIN PRIVATE KEY/);
  assert.match(owner.gongYaoPem, /BEGIN PUBLIC KEY/);
  assert.match(owner.zhiWen, /^[0-9A-F]{4}(-[0-9A-F]{4}){7}$/);
  assert.equal(owner.zhiWen.length, 39);
  assert.equal(M.zhiWen(owner.gongYaoPem), owner.zhiWen);
  assert.equal(M.zhiWen(owner.gongYaoBase64), owner.zhiWen);
  assert.equal(M.zhiWen(Buffer.from(owner.gongYaoYuanShiBase64, 'base64')), owner.zhiWen);
  assert.equal(M.guiYiZhiWen(owner.zhiWen.toLowerCase()), M.guiYiZhiWen(owner.zhiWen));
  assert.notEqual(owner.zhiWen, member.zhiWen);
});

j('签名/验签：原文、公钥、签名任一不符都失败', () => {
  const sig = M.qianMing(owner.siYaoPem, '会话锚点');
  assert.equal(M.yanQian(owner.gongYaoPem, '会话锚点', sig), true);
  assert.equal(M.yanQian(owner.gongYaoPem, '会话锚点!', sig), false);
  assert.equal(M.yanQian(member.gongYaoPem, '会话锚点', sig), false);
  assert.equal(M.yanQian(owner.gongYaoPem, '会话锚点', 'AAAA'), false);
});

// ── 正常邀请 ──

j('正常邀请：token/url/qrText 形状正确，验签 + 绑人 + 锚点全部通过', () => {
  const inv = issue();
  assert.ok(inv.token);
  assert.equal(inv.url, `warmy://invite/${Buffer.from(inv.token, 'utf8').toString('base64url')}`);
  assert.equal(inv.qrText, inv.url);
  assert.ok(inv.qrText.startsWith('warmy://invite/'));
  assert.equal(inv.expiresAt, NOW + 60_000);

  const r = verify(inv.token);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.subjectChecked, true);
  assert.equal(r.payload.sessionId, SESSION);
  assert.equal(r.payload.role, 'member');
  assert.equal(r.payload.issuerFp, owner.zhiWen);
  assert.equal(r.payload.subjectFp, member.zhiWen);
  assert.equal(Object.isFrozen(r.payload), true);

  // 整条 URL 也能直接验
  const viaUrl = verify(inv.url, { usedNonces: new Set() });
  assert.equal(viaUrl.ok, true, JSON.stringify(viaUrl));
  assert.equal(viaUrl.token, inv.token);
});

j('正常邀请：subjectFp 的分组/小写写法同样匹配', () => {
  const inv = issue();
  const r = verify(inv.token, { subjectGongYao: undefined, subjectFp: member.zhiWen.toLowerCase().replace(/-/g, '') });
  assert.equal(r.ok, true, JSON.stringify(r));
});

// ── 篡改 / 过期 / 换会话 / subject 不符 ──

j('篡改 token：改 payload 字段或签名 ⇒ bad-signature', () => {
  const inv = issue();
  const env = JSON.parse(Buffer.from(inv.token, 'base64url').toString('utf8'));
  env.p.role = 'admin';
  const tampered = Buffer.from(JSON.stringify(env), 'utf8').toString('base64url');
  assert.equal(verify(tampered).code, 'bad-signature');

  const env2 = JSON.parse(Buffer.from(inv.token, 'base64url').toString('utf8'));
  env2.s = env2.s.slice(0, -4) + 'AAAA';
  const tampered2 = Buffer.from(JSON.stringify(env2), 'utf8').toString('base64url');
  assert.equal(verify(tampered2).code, 'bad-signature');
});

j('过期：到期前 1ms 通过，到期时刻起失败 ⇒ expired', () => {
  const inv = issue({ ttlMs: 1_000 });
  assert.equal(verify(inv.token, { now: NOW + 999 }).ok, true);
  const r = verify(inv.token, { now: NOW + 1_000 });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'expired');
});

j('换会话：token 的 sessionId 与本地会话不符 ⇒ wrong-session', () => {
  const inv = issue();
  const r = verify(inv.token, { sessionId: 'sess-other' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'wrong-session');
});

j('subject 不符：预期成员公钥/指纹不是被绑定的那个人 ⇒ subject-mismatch', () => {
  const inv = issue();
  assert.equal(verify(inv.token, { subjectGongYao: other.gongYaoPem }).code, 'subject-mismatch');
  assert.equal(verify(inv.token, { subjectGongYao: undefined, subjectFp: other.zhiWen }).code, 'subject-mismatch');
  assert.equal(verify(inv.token, { subjectGongYao: undefined }).subjectChecked, false);
});

j('锚点：issuerFp 必须是创建者公钥指纹，显式 anchorFp 不符 ⇒ wrong-anchor', () => {
  const inv = issue();
  assert.equal(verify(inv.token, { anchorFp: member.zhiWen }).code, 'wrong-anchor');
  const forged = manualToken(owner.siYaoPem, { issuerFp: member.zhiWen });
  assert.equal(verify(forged, { subjectGongYao: member.gongYaoPem }).code, 'wrong-anchor');
});

// ── 重放 ──

j('nonce 一次性：同一 token 第二次 ⇒ replayed（Set / Map 都支持）', () => {
  const inv = issue();
  const used = new Set();
  assert.equal(verify(inv.token, { usedNonces: used }).ok, true);
  assert.equal(used.size, 1);
  const second = verify(inv.token, { usedNonces: used });
  assert.equal(second.ok, false);
  assert.equal(second.code, 'replayed');

  const inv2 = issue();
  const usedMap = new Map();
  assert.equal(verify(inv2.token, { usedNonces: usedMap }).ok, true);
  assert.equal(verify(inv2.token, { usedNonces: usedMap }).code, 'replayed');
});

j('失败不消耗 nonce：换错会话失败后，正确会话仍可通过', () => {
  const inv = issue();
  const used = new Set();
  assert.equal(verify(inv.token, { sessionId: 'sess-wrong', usedNonces: used }).code, 'wrong-session');
  assert.equal(used.size, 0);
  const r = verify(inv.token, { usedNonces: used });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(used.size, 1);
});

// ── 角色 / 越权 ──

j('角色表真值：owner 全开；admin 仅 member/viewer；member/viewer 全禁', () => {
  const expected = {
    owner: { owner: true, admin: true, member: true, viewer: true },
    admin: { owner: false, admin: false, member: true, viewer: true },
    member: { owner: false, admin: false, member: false, viewer: false },
    viewer: { owner: false, admin: false, member: false, viewer: false },
  };
  for (const issuer of M.JUESE_LIST) {
    for (const target of M.JUESE_LIST) {
      assert.equal(M.keShouYu(issuer, target), expected[issuer][target], `${issuer}->${target}`);
    }
  }
  assert.equal(M.keShouYu('owner', 'boss'), false);
  assert.equal(M.keShouYu('boss', 'member'), false);
});

j('viewer 邀请 admin：签发被拒 + 有效签名 token 验角色时仍被拒', () => {
  assert.throws(
    () => issue({ issuerRole: 'viewer', role: 'admin', subjectGongYao: member.gongYaoPem }),
    (e) => e && e.code === 'role-escalation',
  );

  // 用 viewer 自己的私钥签一张"我邀请 admin"的 token：签名有效，但授予规则拒绝
  const viewer = M.shengChengShenFen();
  const forged = manualToken(viewer.siYaoPem, {
    role: 'admin',
    issuerFp: viewer.zhiWen,
    subjectFp: member.zhiWen,
  });
  const r = M.yanZhengYaoQing(forged, {
    gongYao: viewer.gongYaoPem,
    sessionId: SESSION,
    now: NOW + 1_000,
    subjectGongYao: member.gongYaoPem,
    issuerRole: 'viewer',
    usedNonces: new Set(),
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'role-escalation');
});

j('bad-role：签名有效但角色不在 owner/admin/member/viewer ⇒ bad-role', () => {
  const token = manualToken(owner.siYaoPem, { role: 'boss' });
  const r = verify(token);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'bad-role');
  assert.throws(
    () => issue({ role: 'boss' }),
    (e) => e && e.code === 'bad-role',
  );
});

// ── owner 唯一 ──

j('owner 唯一：已有 owner 时第二个 owner 邀请被拒；同指纹重复邀请幂等', () => {
  const ownerInvite = issue({ role: 'owner' });
  const members = [{ fp: owner.zhiWen, role: 'owner' }];

  const clash = verify(ownerInvite.token, { members });
  assert.equal(clash.ok, false);
  assert.equal(clash.code, 'role-escalation');
  assert.equal(clash.detail, 'owner-exists');

  // ownerFp 轻量写法等价
  const clash2 = verify(ownerInvite.token, { ownerFp: owner.zhiWen });
  assert.equal(clash2.ok, false);
  assert.equal(clash2.detail, 'owner-exists');

  assert.throws(
    () => issue({ role: 'owner', members }),
    (e) => e && e.code === 'role-escalation' && e.detail === 'owner-exists',
  );
  assert.throws(
    () => issue({ role: 'owner', ownerFp: owner.zhiWen }),
    (e) => e && e.code === 'role-escalation' && e.detail === 'owner-exists',
  );

  // 同一个 owner 指纹再次邀请（重发/幂等）不算第二个 owner
  const selfInvite = issue({ role: 'owner', subjectGongYao: owner.gongYaoPem, members });
  assert.equal(verify(selfInvite.token, { subjectGongYao: owner.gongYaoPem, members }).ok, true);
});

j('owner 唯一：审批第二个 owner 被拒且状态保持 pending', () => {
  const s = M.shenQingJiaRu(Object.freeze([]), {
    id: 'q-owner-2',
    sessionId: SESSION,
    subjectFp: member.zhiWen,
    role: 'owner',
    token: 'tok',
    now: NOW,
  });
  assert.equal(s.ok, true, JSON.stringify(s));
  const a = M.piZhunJiaRu(s.jiLu, {
    id: 'q-owner-2',
    approve: true,
    now: NOW + 1,
    decidedByRole: 'owner',
    members: [{ fp: owner.zhiWen, role: 'owner' }],
  });
  assert.equal(a.ok, false);
  assert.equal(a.code, 'role-escalation');
  assert.equal(a.detail, 'owner-exists');
  assert.equal(a.jiLu[0].zhuangTai, 'pending');
});

// ── 审批状态机 ──

j('审批状态机：pending → approved；重复审批幂等且返回不可变副本', () => {
  const s = M.shenQingJiaRu(Object.freeze([]), {
    id: 'q-1',
    sessionId: SESSION,
    subjectFp: member.zhiWen,
    role: 'member',
    token: 'tok-1',
    now: NOW,
  });
  assert.equal(s.ok, true);
  assert.equal(Object.isFrozen(s.jiLu), true);
  assert.equal(Object.isFrozen(s.qingQiu), true);
  assert.equal(s.qingQiu.zhuangTai, 'pending');

  const a1 = M.piZhunJiaRu(s.jiLu, { id: 'q-1', approve: true, now: NOW + 10, decidedBy: 'owner-fp' });
  assert.equal(a1.ok, true);
  assert.equal(a1.changed, true);
  assert.equal(a1.qingQiu.zhuangTai, 'approved');
  assert.equal(a1.qingQiu.decidedAt, NOW + 10);
  assert.equal(Object.isFrozen(a1.jiLu), true);
  assert.equal(Object.isFrozen(a1.qingQiu), true);

  const a2 = M.piZhunJiaRu(a1.jiLu, { id: 'q-1', approve: true, now: NOW + 99, decidedBy: 'other' });
  assert.equal(a2.ok, true);
  assert.equal(a2.changed, false);
  assert.equal(a2.qingQiu.zhuangTai, 'approved');
  assert.equal(a2.qingQiu.decidedAt, NOW + 10);
  assert.equal(a2.qingQiu.decidedBy, 'owner-fp');

  const a3 = M.piZhunJiaRu(a1.jiLu, { id: 'q-1', approve: false, now: NOW + 100 });
  assert.equal(a3.changed, false);
  assert.equal(a3.qingQiu.zhuangTai, 'approved');

  // 输入日志没被改
  assert.equal(s.jiLu[0].zhuangTai, 'pending');
});

j('拒绝后可再次申请：旧记录 rejected 保留，新申请为 pending', () => {
  const s1 = M.shenQingJiaRu(Object.freeze([]), {
    id: 'q-rej',
    sessionId: SESSION,
    subjectFp: member.zhiWen,
    role: 'member',
    token: 'tok-rej',
    now: NOW,
  });
  const rej = M.piZhunJiaRu(s1.jiLu, { id: 'q-rej', approve: false, now: NOW + 1, reason: '不是本人' });
  assert.equal(rej.ok, true);
  assert.equal(rej.qingQiu.zhuangTai, 'rejected');
  assert.equal(rej.qingQiu.reason, '不是本人');

  const rej2 = M.piZhunJiaRu(rej.jiLu, { id: 'q-rej', approve: false, now: NOW + 2 });
  assert.equal(rej2.changed, false);

  const s2 = M.shenQingJiaRu(rej.jiLu, {
    id: 'q-rej-2',
    sessionId: SESSION,
    subjectFp: member.zhiWen,
    role: 'member',
    token: 'tok-rej-2',
    now: NOW + 3,
  });
  assert.equal(s2.ok, true, JSON.stringify(s2));
  assert.equal(s2.jiLu.length, 2);
  assert.equal(s2.jiLu[0].zhuangTai, 'rejected');
  assert.equal(s2.jiLu[1].zhuangTai, 'pending');

  // 有 pending 时不能重复申请；旧日志不被修改
  const dup = M.shenQingJiaRu(s2.jiLu, {
    id: 'q-rej-3',
    sessionId: SESSION,
    subjectFp: member.zhiWen,
    role: 'member',
    token: 'tok-rej-3',
    now: NOW + 4,
  });
  assert.equal(dup.ok, false);
  assert.equal(dup.code, 'pending-exists');
  assert.equal(rej.jiLu.length, 1);
});

j('审批越权：admin 不能批准 admin/owner；viewer 不能批准 member', () => {
  const mk = (role) =>
    M.shenQingJiaRu(Object.freeze([]), {
      id: 'q-' + role,
      sessionId: SESSION,
      subjectFp: member.zhiWen,
      role,
      token: 't-' + role,
      now: NOW,
    });
  const adminReq = mk('admin');
  const byAdmin = M.piZhunJiaRu(adminReq.jiLu, {
    id: 'q-admin',
    approve: true,
    decidedByRole: 'admin',
    now: NOW + 1,
  });
  assert.equal(byAdmin.ok, false);
  assert.equal(byAdmin.code, 'role-escalation');
  assert.equal(byAdmin.jiLu[0].zhuangTai, 'pending');

  const memberReq = mk('member');
  const byViewer = M.piZhunJiaRu(memberReq.jiLu, {
    id: 'q-member',
    approve: true,
    decidedByRole: 'viewer',
    now: NOW + 1,
  });
  assert.equal(byViewer.ok, false);
  assert.equal(byViewer.code, 'role-escalation');

  const byAdminOk = M.piZhunJiaRu(memberReq.jiLu, {
    id: 'q-member',
    approve: true,
    decidedByRole: 'admin',
    now: NOW + 1,
  });
  assert.equal(byAdminOk.ok, true);
  assert.equal(byAdminOk.qingQiu.zhuangTai, 'approved');
});

j('申请参数校验：坏角色/坏指纹/空 token 被拒，日志返回只读副本', () => {
  const base = { id: 'qx', sessionId: SESSION, subjectFp: member.zhiWen, role: 'member', token: 't', now: NOW };
  assert.equal(M.shenQingJiaRu(Object.freeze([]), { ...base, role: 'boss' }).code, 'bad-role');
  assert.equal(M.shenQingJiaRu(Object.freeze([]), { ...base, subjectFp: 'XYZ' }).code, 'bad-subject');
  assert.equal(M.shenQingJiaRu(Object.freeze([]), { ...base, token: '  ' }).code, 'bad-token');
  const bad = M.shenQingJiaRu(Object.freeze([]), { ...base, role: 'boss' });
  assert.equal(Object.isFrozen(bad.jiLu), true);
});

console.log(`\nverify-r82-invite: ${ok} ok / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
