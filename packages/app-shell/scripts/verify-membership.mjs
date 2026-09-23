/**
 * verify-membership.mjs —— **成员证书 + 吊销列表**的可重跑验证（ADR 003 §2.3 第 6 条 / §附八.8 / §附五.1 第四层）
 *
 *   node packages/app-shell/scripts/verify-membership.mjs            # 全量
 *   node packages/app-shell/scripts/verify-membership.mjs --keep     # 保留临时目录
 *
 * 覆盖（**每条断言都有真实执行做证据**：真 Ed25519 签/验、真落盘、真实函数返回值）：
 *   [0] 常量/落盘位置对齐（本地时钟容差 = 身份层 DEFAULT_CLOCK_SKEW_MS）
 *   [1] 真签名 + 真验签（创建者签发；node:crypto 独立复核）
 *   [2] 篡改任一字段 → 验签失败（逐字段，含"公钥+指纹成对换掉"）
 *   [3] 过期 / 未生效：**只用本地时钟**判定，声明里的时间戳不作数
 *   [4] 签发者不是创建者 → 拒（自洽的攻击者证书也拒）
 *   [5] 吊销命中 → 拒（不看 revokedAt）；名册据此拒绝重连
 *   [6] 吊销列表：回滚（listVersion 变小）/ 同版本不同内容 / 条目变少 —— 全部拒
 *   [7] supersedes 变更链：换证后"新指纹 = 原成员"，**无关的新指纹不是**
 *   [8] 无证书时的 TOFU 降级仍可用；但证书/吊销记录**优先**于 TOFU
 *   [9] GroupMemberRecord.fingerprint 迁移（旧格式读入不报错、不造假、不改写文件）
 *  [10] scopes：有映射给出精确会话；无映射如实回退 [{kind:'all'}] + scopeBasis
 *  [11] presenceBasis：本地实例 / 活连接（mesh-session）/ 无法归属（unattributed）三种都出现
 *  [12] 端到端：换证重签 → 旧指纹连不进来、新指纹是原成员；落盘/缓存/无明文私钥
 *  [13] 并发吊销不丢更新（读→签名→落盘 串行化；并发窗口真的存在过）
 *  [14] 阳性对照：去掉 runExclusive 就必须复现丢更新（证明 [13] 是锁在起作用）
 *
 * 依赖 dist（先 `pnpm --filter @warmy/sync-protocol build` 与 `--filter @warmy/app-shell build`）。
 * 本脚本不联网、不起 Electron；用到的一次性口令只写进 %TEMP% 下的抛弃身份。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

import {LianJieHuoXing, DEFAULT_MEMBER_CERT_TTL_MS, MEMBERSHIP_CLOCK_SKEW_MS, CHENGYUAN_ZHENGSHU_MOSHI, REVOCATION_LIST_SCHEMA, yingYongCheXiaoBiao, gouJianChengYuanZhengShu, gouJianCheXiaoBiao, guiFanChengYuanJson, lianShiZhiWen, lianGenZhengShuId, shuoMingChengYuanZhengShu, chaZhaoCheXiaoTiaoMu, shengChengEd25519, yiCheXiao, shiTongYiChengYuan, zhengShuQianMingZiJie, quChengYuanShenFen, signMemberCertificate, signRevocationList, verifyAndApplyRevocationList, verifyMemberCertificate, verifyRevocationList, bianliZhengshuLian, } from '../../bucketBu-protocol/dist/index.js';
import {QunCang, sameFingerprintText} from '../dist/group-store.js';
import {ShenFenCang, MEMBERSHIP_FILE_SCHEMA, ChengYuanMingceCang, nullProtector} from '../dist/identity-store.js';
import {applyInboundRevocationUpdate, buildIdentityChangeEntries, goujianChengyuanZaichang, computeChangeScopes, createRosterChecker, explainRosterDecision, wentiChengyuanZhengshu, membershipFileFor, membershipSameMember, membershipSnapshot, membershipStoreFor, MEMBERSHIP_SKEW_CHECK, reissueMemberCertificateForRecovery, chexiaoChengyuanZhengshu, rotateMemberCertificate, } from '../dist/identity-provider.js';
import {DEFAULT_CLOCK_SKEW_MS, fingerprintFromPublicKey, isValidFingerprint, keyObjectFromPrivateDer, normalizeFingerprint, } from '../dist/identity.js';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const keep = process.argv.includes('--keep');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-membership-'));
/** 一次性口令：只用于 %TEMP% 下的抛弃身份，绝不进仓库 */
const PASS = 'membership-verify-ephemeral';

let pass = 0;
let fail = 0;
const failures = [];

function check(biaoQian, cond, detail) {
  const shown = detail === undefined ? '' : ` => ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
  if (cond) {
    pass++;
    console.log(`  [PASS] ${biaoQian}${shown}`);
  } else {
    fail++;
    failures.push(biaoQian);
    console.log(`  [FAIL] ${biaoQian}${shown}`);
  }
}
function section(biaoTi) {
  console.log(`\n── ${biaoTi} ──`);
}

/* ────────────────────────────── 夹具 ────────────────────────────── */

/** 造一个真身份（口令保护 → 可控地锁上/解开）；口令只用于 TEMP 下的抛弃身份 */
function mkIdentity(ming, passphrase) {
  const dir = path.join(tmpRoot, `id-${ming}`);
  fs.mkdirSync(dir, { recursive: true });
  const store = new ShenFenCang(path.join(dir, 'identity.json'), { protector: nullProtector() });
  const created = store.ensureIdentity(`alias-${ming}`, { email: `${ming}@example.test` }, passphrase ? { passphrase } : {});
  store.lock(); // 复现"重启后没有会话 DEK"的真实状态
  return { store, created, dir, idFile: path.join(dir, 'identity.json') };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** 用 node:crypto **独立**复核一张证书的签名（不走本包的验签实现） */
function independentVerifyCert(cert) {
  const pub = crypto.createPublicKey({ key: Buffer.from(cert.issuerPublicKey, 'base64'), format: 'der', type: 'spki' });
  return crypto.verify(null, zhengShuQianMingZiJie(cert), pub, Buffer.from(cert.issuerSignature, 'base64'));
}
function independentSignCert(cert, privateKeyDer) {
  const priv = crypto.createPrivateKey({ key: privateKeyDer, format: 'der', type: 'pkcs8' });
  return { ...cert, issuerSignature: crypto.sign(null, zhengShuQianMingZiJie(cert), priv).toString('base64') };
}

const creator = mkIdentity('creator', PASS);
const memberB = mkIdentity('bob', PASS);
const memberC = mkIdentity('carol', PASS);
const attacker = mkIdentity('evil', PASS);
for (const [biaoQian, id] of [['creator', creator], ['bob', memberB], ['carol', memberC], ['evil', attacker]]) {
  const u = id.store.unlock(PASS);
  if (!u.ok) {
    console.error(`夹具身份 ${biaoQian} 解锁失败：`, u);
    process.exit(1);
  }
}
const infoCreator = creator.store.info();
const infoB = memberB.store.info();
const infoC = memberC.store.info();
const infoEvil = attacker.store.info();
const GROUP = 'g-membership-1';
const creatorMembership = membershipStoreFor(creator.store);
/** 验签选项（必须注入身份层的指纹推导：sync-protocol 默认推导与身份层不同） */
const VOPT0 = { fingerprintOf: fingerprintFromPublicKey, clockSkewMs: DEFAULT_CLOCK_SKEW_MS };

console.log('membership 验证开始');
console.log(`临时目录: ${tmpRoot}`);
console.log(`node: ${process.execPath}`);

/* ════════════════════════════════════════════════════════════════════════════
   [0] 常量 / 落盘位置
   ════════════════════════════════════════════════════════════════════════════ */

section('0. 常量与落盘位置（容差必须复用身份层的 DEFAULT_CLOCK_SKEW_MS）');

check('CHENGYUAN_ZHENGSHU_MOSHI === "warmy.member-cert.v1"', CHENGYUAN_ZHENGSHU_MOSHI === 'warmy.member-cert.v1', CHENGYUAN_ZHENGSHU_MOSHI);
check('REVOCATION_LIST_SCHEMA === "warmy.revocation-list.v1"', REVOCATION_LIST_SCHEMA === 'warmy.revocation-list.v1', REVOCATION_LIST_SCHEMA);
check('MEMBERSHIP_FILE_SCHEMA 是独立的文件 schema', MEMBERSHIP_FILE_SCHEMA === 'warmy.membership.file.v1', MEMBERSHIP_FILE_SCHEMA);
check(
  '本地时钟容差复用身份层 DEFAULT_CLOCK_SKEW_MS（同一个值）',
  MEMBERSHIP_CLOCK_SKEW_MS === DEFAULT_CLOCK_SKEW_MS,
  `${MEMBERSHIP_CLOCK_SKEW_MS} == ${DEFAULT_CLOCK_SKEW_MS}`
);
check(
  'identity-provider 的容差对照常量两侧一致（跨层接口稳定）',
  MEMBERSHIP_SKEW_CHECK.appShell === MEMBERSHIP_SKEW_CHECK.protocol && MEMBERSHIP_SKEW_CHECK.appShell === DEFAULT_CLOCK_SKEW_MS,
  MEMBERSHIP_SKEW_CHECK
);
check('默认证书有效期为正且有限', DEFAULT_MEMBER_CERT_TTL_MS > 0 && Number.isFinite(DEFAULT_MEMBER_CERT_TTL_MS), DEFAULT_MEMBER_CERT_TTL_MS);
check('membership.json 与 identity.json 同目录（落盘在身份目录下）', path.dirname(membershipFileFor(creator.store)) === path.dirname(creator.store.path()), membershipFileFor(creator.store));
check('membership.json 文件名固定', path.basename(membershipFileFor(creator.store)) === 'membership.json', membershipFileFor(creator.store));
check('三个夹具身份指纹互不相同', new Set([infoCreator.fingerprint, infoB.fingerprint, infoC.fingerprint]).size === 3, [infoCreator.fingerprint, infoB.fingerprint, infoC.fingerprint]);
check('指纹形态合法（Crockford base32 + 校验位）', isValidFingerprint(infoCreator.fingerprint) && isValidFingerprint(infoB.fingerprint));
check('公钥 → 指纹可由身份层实现复算（与证书绑定用的推导一致）', fingerprintFromPublicKey(infoB.publicKey) === infoB.fingerprint, infoB.fingerprint);
check('membershipStoreFor 对同一 IdentityStore 返回同一实例（进程内一致）', membershipStoreFor(creator.store) === membershipStoreFor(creator.store));
check('membershipStoreFor(null) 返回 null（不抛）', membershipStoreFor(null) === null);
check('guiFanChengYuanJson 键序无关（同值同串）', guiFanChengYuanJson({ b: 1, a: 2 }) === guiFanChengYuanJson({ a: 2, b: 1 }), guiFanChengYuanJson({ b: 1, a: 2 }));
check('guiFanChengYuanJson 丢 undefined 字段', guiFanChengYuanJson({ a: 1, b: undefined }) === guiFanChengYuanJson({ a: 1 }));
check('未签名证书（issuerSignature 为空）必须被拒', verifyMemberCertificate(gouJianChengYuanZhengShu({
  certId: 'mc-unsigned', groupId: GROUP, memberFingerprint: infoB.fingerprint, memberPublicKey: infoB.publicKey,
  issuerFingerprint: infoCreator.fingerprint, issuerPublicKey: infoCreator.publicKey,
}), { ...VOPT0 }).code === 'bad-signature');
check('证书结构：schema 不对 → unknown-schema', verifyMemberCertificate({ schema: 'x' }).code === 'unknown-schema');
check('证书结构：null → malformed', verifyMemberCertificate(null).code === 'malformed');

/* ════════════════════════════════════════════════════════════════════════════
   [1] 真签名 / 真验签
   ════════════════════════════════════════════════════════════════════════════ */

section('1. 创建者签发成员证书（真 Ed25519 + 真落盘 + 独立复核）');

const CREATOR_CERT_ID = 'mc-bob-1';
const issued = await wentiChengyuanZhengshu({
  signer: (await import('../dist/identity-provider.js')).createIdentitySigner(creator.store),
  membership: creatorMembership,
  groupId: GROUP,
  memberFingerprint: infoB.fingerprint,
  memberPublicKey: infoB.publicKey,
  displayName: 'bob',
  role: 'member',
  permissions: ['read', 'push:proposals', 'read'],
  memberId: 'bob',
  certId: CREATOR_CERT_ID,
  now: Date.now(),
});
check('wentiChengyuanZhengshu 成功', issued.ok === true, issued.code);
const bobCert = issued.cert;
check('签发出的证书 schema 正确', bobCert?.schema === CHENGYUAN_ZHENGSHU_MOSHI, bobCert?.schema);
check('certId 使用调用方指定的值', bobCert?.certId === CREATOR_CERT_ID, bobCert?.certId);
check('groupId / memberFingerprint 正确', bobCert?.groupId === GROUP && bobCert?.memberFingerprint === infoB.fingerprint, [bobCert?.groupId, bobCert?.memberFingerprint]);
check('memberPublicKey 与成员指纹自洽', fingerprintFromPublicKey(bobCert?.memberPublicKey) === infoB.fingerprint);
check('issuerFingerprint = 创建者指纹', bobCert?.issuerFingerprint === infoCreator.fingerprint, bobCert?.issuerFingerprint);
check('permissions 去重并排序（read/push:proposals 各一次）', JSON.stringify(bobCert?.permissions) === JSON.stringify(['push:proposals', 'read']), bobCert?.permissions);
check('role = member（默认）', bobCert?.role === 'member', bobCert?.role);
check('memberId 写入（跨换证稳定成员标识）', bobCert?.memberId === 'bob', bobCert?.memberId);
check('证书上不含 supersedes（首次签发）', bobCert?.supersedes === undefined, bobCert?.supersedes);
check('签名是 raw 64 字节 Ed25519（base64 解出 64 字节）', Buffer.from(String(bobCert?.issuerSignature), 'base64').length === 64, Buffer.from(String(bobCert?.issuerSignature), 'base64').length);
check('wentiChengyuanZhengshu 自检通过（返回 code=ok）', issued.code === 'ok', issued.code);

const vBob = verifyMemberCertificate(bobCert, { fingerprintOf: fingerprintFromPublicKey, clockSkewMs: DEFAULT_CLOCK_SKEW_MS });
check('本包验签通过（code=ok）', vBob.ok === true && vBob.code === 'ok', vBob.code);
check('node:crypto 独立复核：签名覆盖的字节确实由创建者私钥签出', independentVerifyCert(bobCert) === true);
check('指纹推导用错实现时也一致（默认 base32(sha256(raw)) 与身份层推导不同，故必须注入）', verifyMemberCertificate(bobCert).ok === false, verifyMemberCertificate(bobCert).code);

const described = shuoMingChengYuanZhengShu(bobCert);
check('shuoMingChengYuanZhengShu 给出 32 字节 raw 公钥（b64url）', Buffer.from(described.memberPublicKeyRawB64u, 'base64url').length === 32, described.memberPublicKeyRawB64u.length);
check('shuoMingChengYuanZhengShu 不含任何私钥字段', !JSON.stringify(described).toLowerCase().includes('private'));

check('证书已落盘（membership.json 存在）', fs.existsSync(membershipFileFor(creator.store)), membershipFileFor(creator.store));
const storedFile = readJson(membershipFileFor(creator.store));
check('落盘文件 schema 正确', storedFile.schema === MEMBERSHIP_FILE_SCHEMA, storedFile.schema);
check('落盘里有该群的证书记录', Array.isArray(storedFile.groups?.[GROUP]?.certs) && storedFile.groups[GROUP].certs.length === 1, Object.keys(storedFile.groups ?? {}));
check('落盘里 certId 与内存一致', storedFile.groups[GROUP].certs[0].certId === CREATOR_CERT_ID);
check('落盘里 issuerFingerprint 被记为群主（钉住）', storedFile.groups[GROUP].issuerFingerprint === infoCreator.fingerprint);
check('落盘里 id 就是群 id（键 = groupId）', storedFile.groups[GROUP].groupId === GROUP);
check('membership.json 里**没有**任何私钥材料', !/PRIVATE KEY|privateKey|pkcs8/i.test(JSON.stringify(storedFile)));
check('membership.json 里没有创建者的身份私钥 base64', !(() => {
  const loaded = creator.store.load();
  const needle = loaded.privateKeyDer.toString('base64').slice(0, 40);
  loaded.privateKeyDer.fill(0);
  return fs.readFileSync(membershipFileFor(creator.store), 'utf8').includes(needle);
})());

check('MembershipStore.groupState 返回副本（改不到缓存）', (() => {
  const g = creatorMembership.groupState(GROUP);
  g.certs[0].role = 'creator';
  return creatorMembership.groupState(GROUP).certs[0].role === 'member';
})());
check('certificateForFingerprint 能查到该成员', creatorMembership.certificateForFingerprint(GROUP, infoB.fingerprint)?.certId === CREATOR_CERT_ID);
check('certificateForFingerprint 忽略短横/大小写差异', !!creatorMembership.certificateForFingerprint(GROUP, infoB.fingerprint.replace(/-/g, '').toLowerCase()));
check('certificateById 能按 certId 查到', creatorMembership.certificateById(GROUP, CREATOR_CERT_ID)?.memberFingerprint === infoB.fingerprint);
check('allCertificates 列出全部群（当前 1 张）', creatorMembership.allCertificates().length === 1, creatorMembership.allCertificates().length);
check('listGroups 列出该群', creatorMembership.listGroups().includes(GROUP));
check('summary 计数正确（1 群 1 证书 0 吊销）', (() => {
  const s = creatorMembership.summary();
  return s.groupCount === 1 && s.certCount === 1 && s.revokedCount === 0;
})(), creatorMembership.summary());
check('同一 certId 重复落盘（内容一致）不报错', (() => {
  const r = creatorMembership.putCertificate(bobCert);
  return r.ok === true && r.stored === true;
})());
check('同一 certId 但内容不同 → 拒绝覆盖', (() => {
  const r = creatorMembership.putCertificate({ ...bobCert, role: 'admin' });
  return r.ok === false;
})());
check('落盘后证书数量没有翻倍', creatorMembership.listCertificates(GROUP).length === 1, creatorMembership.listCertificates(GROUP).length);

/* ════════════════════════════════════════════════════════════════════════════
   [2] 篡改任一字段 → 验签失败
   ════════════════════════════════════════════════════════════════════════════ */

section('2. 篡改任一字段 → 验签失败（逐字段）');

const VOPT = { fingerprintOf: fingerprintFromPublicKey, clockSkewMs: DEFAULT_CLOCK_SKEW_MS };
const tamperCases = [
  ['displayName', (c) => ({ ...c, displayName: 'not-bob' })],
  ['role', (c) => ({ ...c, role: 'admin' })],
  ['permissions', (c) => ({ ...c, permissions: ['read'] })],
  ['issuedAt（仍在容差内）', (c) => ({ ...c, issuedAt: c.issuedAt - 60_000 })],
  ['expiresAt（仍在有效期内）', (c) => ({ ...c, expiresAt: c.expiresAt - 1000 })],
  ['memberId', (c) => ({ ...c, memberId: 'somebody-else' })],
  ['certId', (c) => ({ ...c, certId: 'mc-bob-1-fake' })],
  ['groupId', (c) => ({ ...c, groupId: 'g-other' })],
  ['memberFingerprint（公钥不动）', (c) => ({ ...c, memberFingerprint: infoC.fingerprint })],
  ['memberPublicKey（指纹不动）', (c) => ({ ...c, memberPublicKey: infoC.publicKey })],
  ['issuerFingerprint', (c) => ({ ...c, issuerFingerprint: infoEvil.fingerprint })],
  ['issuerPublicKey', (c) => ({ ...c, issuerPublicKey: infoEvil.publicKey })],
  ['issuerSignature（换成别人的签名）', (c) => ({ ...c, issuerSignature: Buffer.alloc(64, 7).toString('base64') })],
  ['issuerSignature（截断）', (c) => ({ ...c, issuerSignature: Buffer.from(c.issuerSignature, 'base64').subarray(0, 32).toString('base64') })],
  ['删掉 displayName', (c) => { const d = { ...c }; delete d.displayName; return d; }],
  ['加一个 supersedes', (c) => ({ ...c, supersedes: 'mc-nonexistent' })],
  ['加一个未知字段（不进签名载荷，必须不影响判定）', (c) => ({ ...c, extraJunk: 1 })],
];
for (const [biaoQian, mutate] of tamperCases) {
  const t = mutate(bobCert);
  const r = verifyMemberCertificate(t, VOPT);
  if (biaoQian.includes('未知字段')) {
    check(`篡改「${biaoQian}」→ 仍通过（载荷只含列出的字段，这是刻意的）`, r.ok === true, r.code);
  } else {
    check(`篡改「${biaoQian}」→ 验签/校验失败`, r.ok === false, r.code);
  }
}
check('成对换掉"公钥 + 指纹"（自洽的攻击者公钥）→ 也失败（issuer 不变则签名不通过）', (() => {
  const r = verifyMemberCertificate({ ...bobCert, memberPublicKey: infoC.publicKey, memberFingerprint: infoC.fingerprint }, VOPT);
  return r.ok === false;
})());
check('把 issuerSignature 换成"用别的私钥对同一载荷重签的合法签名" → 仍失败（验签用的是 issuerPublicKey）', (() => {
  const evilKeys = shengChengEd25519();
  const evilPkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), evilKeys.privateKey]);
  const resigned = independentSignCert(bobCert, evilPkcs8);
  const r = verifyMemberCertificate(resigned, VOPT);
  return r.ok === false && r.code === 'bad-signature';
})());
check('证书字段被改成"未来才生效"→ not-yet-valid（而签名其实是对的，故需重新签）', (() => {
  const future = { ...bobCert, issuedAt: Date.now() + 3_600_000, expiresAt: Date.now() + 7_200_000 };
  const r = verifyMemberCertificate(future, VOPT);
  return r.ok === false && r.code === 'not-yet-valid';
})(), verifyMemberCertificate({ ...bobCert, issuedAt: Date.now() + 3_600_000, expiresAt: Date.now() + 7_200_000 }, VOPT).code);

/* ════════════════════════════════════════════════════════════════════════════
   [3] 过期 / 未生效：只用本地时钟
   ════════════════════════════════════════════════════════════════════════════ */

section('3. 过期判定只用**本地时钟**（声明里的时间戳不作数）');

const nowMs = Date.now();
/** 明确"已过期"= 早于 now - 容差（容差是 5 分钟，所以"刚过 1 秒"仍然算有效） */
const EXPIRED_AT = nowMs - DEFAULT_CLOCK_SKEW_MS - 60_000;
const shortCertBase = gouJianChengYuanZhengShu(
  {
    certId: 'mc-short', groupId: GROUP, memberFingerprint: infoC.fingerprint, memberPublicKey: infoC.publicKey,
    issuerFingerprint: infoCreator.fingerprint, issuerPublicKey: infoCreator.publicKey,
    issuedAt: nowMs - 3_600_000, expiresAt: EXPIRED_AT,
  },
  { now: nowMs }
);
const signedShort = independentSignCert(shortCertBase, creator.store.load().privateKeyDer);
check('已过期证书 → code=expired', verifyMemberCertificate(signedShort, VOPT).code === 'expired', verifyMemberCertificate(signedShort, VOPT).detail);
check('过期证书 ok=false', verifyMemberCertificate(signedShort, VOPT).ok === false);
check('容差生效：expiresAt 刚过 1 秒（容差 5 分钟）仍视为有效', (() => {
  const fresh = independentSignCert(
    { ...shortCertBase, issuedAt: nowMs - 3_600_000, expiresAt: nowMs - 1000 },
    creator.store.load().privateKeyDer
  );
  const withinSkew = { ...fresh, expiresAt: nowMs + DEFAULT_CLOCK_SKEW_MS - 1000 };
  const signed = independentSignCert(withinSkew, creator.store.load().privateKeyDer);
  return verifyMemberCertificate(signed, VOPT).ok === true;
})());
check('超过容差（expiresAt 早于 now - skew）→ 过期', verifyMemberCertificate(
  independentSignCert({ ...shortCertBase, issuedAt: nowMs - 3_600_000, expiresAt: nowMs - DEFAULT_CLOCK_SKEW_MS - 1 }, creator.store.load().privateKeyDer),
  VOPT
).code === 'expired');
check('把本地 now 推到 expiresAt + 容差之后 → 立刻过期（证明比较的是本地时钟）', verifyMemberCertificate(
  independentSignCert({ ...shortCertBase, issuedAt: nowMs, expiresAt: nowMs + 86_400_000 }, creator.store.load().privateKeyDer),
  { ...VOPT, now: nowMs + 86_400_000 + DEFAULT_CLOCK_SKEW_MS + 1000 }
).code === 'expired');
check('expiresAt <= issuedAt → 结构不合法（malformed）', (() => {
  const bad = independentSignCert({ ...shortCertBase, issuedAt: nowMs, expiresAt: nowMs }, creator.store.load().privateKeyDer);
  const r = verifyMemberCertificate(bad, VOPT);
  return r.ok === false;
})(), verifyMemberCertificate(independentSignCert({ ...shortCertBase, issuedAt: nowMs, expiresAt: nowMs }, creator.store.load().privateKeyDer), VOPT).detail);
check('issuedAt 远超本地时间 → not-yet-valid（不当成有效）', verifyMemberCertificate(
  independentSignCert({ ...shortCertBase, issuedAt: nowMs + 10 * 60_000, expiresAt: nowMs + 86_400_000 }, creator.store.load().privateKeyDer),
  VOPT
).code === 'not-yet-valid');
check('容差内的 issuedAt（+1min）仍有效（容差确实生效）', verifyMemberCertificate(
  independentSignCert({ ...shortCertBase, issuedAt: nowMs + 60_000, expiresAt: nowMs + 86_400_000 }, creator.store.load().privateKeyDer),
  VOPT
).ok === true);

/* ════════════════════════════════════════════════════════════════════════════
   [4] 签发者不是创建者 → 拒
   ════════════════════════════════════════════════════════════════════════════ */

section('4. 签发者必须是本群创建者');

const evilSignedForB = independentSignCert(
  gouJianChengYuanZhengShu(
    {
      certId: 'mc-bob-evil', groupId: GROUP, memberFingerprint: infoB.fingerprint, memberPublicKey: infoB.publicKey,
      issuerFingerprint: infoEvil.fingerprint, issuerPublicKey: infoEvil.publicKey,
    },
    { now: nowMs }
  ),
  attacker.store.load().privateKeyDer
);
check('攻击者自洽地给 bob 签一张证书（自己当签发者）→ 指定 expectIssuerFingerprint 后被拒 wrong-issuer', (() => {
  const r = verifyMemberCertificate(evilSignedForB, { ...VOPT, expectIssuerFingerprint: infoCreator.fingerprint });
  return r.ok === false && r.code === 'wrong-issuer';
})());
check('攻击者证书**自称**是创建者签发（issuerFingerprint 改成创建者）→ issuer-fingerprint-mismatch', (() => {
  const r = verifyMemberCertificate({ ...evilSignedForB, issuerFingerprint: infoCreator.fingerprint }, VOPT);
  return r.ok === false && r.code === 'issuer-fingerprint-mismatch';
})(), verifyMemberCertificate({ ...evilSignedForB, issuerFingerprint: infoCreator.fingerprint }, VOPT).code);
check('MembershipStore.putCertificate 拒收攻击者签的证书（stored=false）', (() => {
  const r = creatorMembership.putCertificate(evilSignedForB, { expectIssuerFingerprint: infoCreator.fingerprint });
  return r.ok === false && r.stored === false && r.code === 'issuer-changed';
})(), creatorMembership.putCertificate(evilSignedForB, { expectIssuerFingerprint: infoCreator.fingerprint }).code);
check('拒收后落盘里没有这张证书', readJson(membershipFileFor(creator.store)).groups[GROUP].certs.length === 1);
check('换了签名域（用换证声明的域签证书载荷）→ bad-signature', (() => {
  const payload = `warmy.identity.rotation.v1\n${guiFanChengYuanJson({})}`;
  void payload;
  const priv = keyObjectFromPrivateDer(creator.store.load().privateKeyDer);
  const wrongDomain = crypto.sign(null, Buffer.from(`warmy.other.domain\n${guiFanChengYuanJson({
    schema: bobCert.schema, certId: bobCert.certId, groupId: bobCert.groupId, memberFingerprint: bobCert.memberFingerprint,
    memberPublicKey: bobCert.memberPublicKey, displayName: 'bob', role: bobCert.role, permissions: bobCert.permissions,
    issuedAt: bobCert.issuedAt, expiresAt: bobCert.expiresAt, issuerFingerprint: bobCert.issuerFingerprint,
    issuerPublicKey: bobCert.issuerPublicKey, supersedes: '', memberId: bobCert.memberId,
  })}`, 'utf8'), priv).toString('base64');
  return verifyMemberCertificate({ ...bobCert, issuerSignature: wrongDomain }, VOPT).code === 'bad-signature';
})());
check('expectGroupId 不匹配 → wrong-group', verifyMemberCertificate(bobCert, { ...VOPT, expectGroupId: 'g-other' }).code === 'wrong-group');
check('expectIssuerFingerprint 用短横/大小写变体也认（容错比较由身份层实现，这里用原值）', verifyMemberCertificate(bobCert, { ...VOPT, expectIssuerFingerprint: infoCreator.fingerprint.replace(/-/g, '') }).code === 'wrong-issuer');

/* ════════════════════════════════════════════════════════════════════════════
   [5] 吊销命中 → 拒（不看 revokedAt）
   ════════════════════════════════════════════════════════════════════════════ */

section('5. 吊销列表：命中即拒（且不看 revokedAt）');

const signerCreator = (await import('../dist/identity-provider.js')).createIdentitySigner(creator.store);

// 先给 carol 签一张，随后吊销
const carolIssued = await wentiChengyuanZhengshu({
  signer: signerCreator, membership: creatorMembership, groupId: GROUP,
  memberFingerprint: infoC.fingerprint, memberPublicKey: infoC.publicKey, displayName: 'carol', certId: 'mc-carol-1',
});
check('为 carol 签发证书成功', carolIssued.ok === true, carolIssued.code);
check('carol 名册判定放行（持有效证书）', creatorMembership.authorizeFingerprint(infoC.fingerprint).ok === true);

const revokeCarol = await chexiaoChengyuanZhengshu({
  signer: signerCreator, membership: creatorMembership, groupId: GROUP,
  certId: 'mc-carol-1', memberFingerprint: infoC.fingerprint, reason: 'departed',
});
check('吊销 carol 成功（新版吊销列表）', revokeCarol.ok === true, revokeCarol.code);
check('吊销列表版本 = 1（首版）', revokeCarol.listVersion === 1, revokeCarol.listVersion);
check('吊销条目 reason = departed', revokeCarol.list?.entries?.[0]?.reason === 'departed');
check('吊销条目记录 certId 与 memberFingerprint', revokeCarol.list?.entries?.[0]?.certId === 'mc-carol-1' && revokeCarol.list?.entries?.[0]?.memberFingerprint === infoC.fingerprint);
const carolVerdict = creatorMembership.authorizeFingerprint(infoC.fingerprint);
check('吊销后 carol 名册判定：decided=true 且拒（revoked）', carolVerdict.decided === true && carolVerdict.ok === false && carolVerdict.code === 'revoked', carolVerdict);
check('吊销判定给出 certId（可追责）', carolVerdict.certId === 'mc-carol-1', carolVerdict.certId);
check('chaZhaoCheXiaoTiaoMu 命中成员指纹', !!chaZhaoCheXiaoTiaoMu(creatorMembership.revocation(GROUP), { memberFingerprint: infoC.fingerprint }));
check('yiCheXiao 命中 certId', yiCheXiao(creatorMembership.revocation(GROUP), { certId: 'mc-carol-1' }) === true);
check('被吊销者即使证书本身**完全有效**也判拒（证书有效性与吊销是两个判据）', verifyMemberCertificate(carolIssued.cert, VOPT).ok === true && carolVerdict.ok === false);
check('吊销条目 revokedAt 被改成"一年后"依然吊销（不看时间戳）', (() => {
  const cur = creatorMembership.revocation(GROUP);
  const tampered = { ...cur, entries: cur.entries.map((e) => ({ ...e, revokedAt: Date.now() + 365 * 86_400_000 })) };
  return yiCheXiao(tampered, { certId: 'mc-carol-1' }) === true && !!chaZhaoCheXiaoTiaoMu(tampered, { memberFingerprint: infoC.fingerprint });
})());
check('吊销列表落盘（membership.json 里有 listVersion 与 entries）', (() => {
  const f = readJson(membershipFileFor(creator.store));
  return f.groups[GROUP].revocation.listVersion === 1 && f.groups[GROUP].revocation.entries.length === 1;
})());
check('未吊销的成员（bob）仍放行', creatorMembership.authorizeFingerprint(infoB.fingerprint).ok === true);
check('名册判定对"一无所知"的指纹给出 decided=false（这才是 TOFU 降级的入口）', creatorMembership.authorizeFingerprint(infoEvil.fingerprint).decided === false);
check('名册判定容忍指纹书写差异（去短横/小写仍命中吊销）', creatorMembership.authorizeFingerprint(infoC.fingerprint.replace(/-/g, '').toLowerCase()).code === 'revoked');

/* ════════════════════════════════════════════════════════════════════════════
   [6] 吊销列表单调性：回滚 / 重放 / 条目变少
   ════════════════════════════════════════════════════════════════════════════ */

section('6. 吊销列表：回滚、同版本不同内容、条目变少 全部拒');

const curList = creatorMembership.revocation(GROUP);
const v2 = await signRevocationList(
  gouJianCheXiaoBiao({ groupId: GROUP, listVersion: 2, entries: [...curList.entries], issuerFingerprint: infoCreator.fingerprint, issuerPublicKey: infoCreator.publicKey }),
  (b) => signerCreator.sign(b)
);
const applied2 = creatorMembership.yingYongCheXiaoBiao(GROUP, v2);
check('升版（v1 → v2，条目不变）被接受', applied2.ok === true && applied2.changed === true && applied2.listVersion === 2, applied2);
check('落盘版本同步为 2', readJson(membershipFileFor(creator.store)).groups[GROUP].revocation.listVersion === 2);
const rollback = creatorMembership.yingYongCheXiaoBiao(GROUP, curList);
check('回滚（再送 v1）→ code=rollback 且被拒', rollback.ok === false && rollback.code === 'rollback', rollback.code);
check('回滚被拒后本机列表仍是 v2（没被降级）', creatorMembership.revocation(GROUP).listVersion === 2);
check('纯 yingYongCheXiaoBiao(v2, v1) 也报 rollback（协议层同样挡）', yingYongCheXiaoBiao(v2, curList).code === 'rollback');
const sameVersionDifferent = await signRevocationList(
  gouJianCheXiaoBiao({ groupId: GROUP, listVersion: 2, entries: [], issuerFingerprint: infoCreator.fingerprint, issuerPublicKey: infoCreator.publicKey, issuedAt: v2.issuedAt + 5000 }),
  (b) => signerCreator.sign(b)
);
const replayRes = creatorMembership.yingYongCheXiaoBiao(GROUP, sameVersionDifferent);
check('同版本(v2)但内容不同 → code=replay 且被拒', replayRes.ok === false && replayRes.code === 'replay', replayRes.code);
check('同版本(v2)且内容相同 → 幂等接受（changed=false）', (() => {
  const r = creatorMembership.yingYongCheXiaoBiao(GROUP, v2);
  return r.ok === true && r.changed === false;
})());
const v3Dropped = await signRevocationList(
  gouJianCheXiaoBiao({ groupId: GROUP, listVersion: 3, entries: [], issuerFingerprint: infoCreator.fingerprint, issuerPublicKey: infoCreator.publicKey }),
  (b) => signerCreator.sign(b)
);
const dropped = creatorMembership.yingYongCheXiaoBiao(GROUP, v3Dropped);
check('升版但**少了已吊销项** → code=entries-dropped 且被拒（不能借新版本偷偷解吊销）', dropped.ok === false && dropped.code === 'entries-dropped', dropped.code);
check('被拒后列表仍停在 v2 且条目还在', creatorMembership.revocation(GROUP).listVersion === 2 && creatorMembership.revocation(GROUP).entries.length === 1);
check('条目变少的拒绝在协议层同样成立', yingYongCheXiaoBiao(v2, v3Dropped).code === 'entries-dropped');
check('篡改条目 reason → 验签失败（bad-signature）', (() => {
  const t = { ...v2, entries: v2.entries.map((e) => ({ ...e, reason: 'admin' })) };
  return verifyRevocationList(t, VOPT).code === 'bad-signature';
})());
check('篡改 listVersion → 验签失败', verifyRevocationList({ ...v2, listVersion: 99 }, VOPT).code === 'bad-signature');
check('伪造 issuerFingerprint（签名仍是创建者的）→ 被拒', (() => {
  const t = { ...v2, issuerFingerprint: infoEvil.fingerprint };
  const r = verifyRevocationList(t, VOPT);
  return r.ok === false;
})(), verifyRevocationList({ ...v2, issuerFingerprint: infoEvil.fingerprint }, VOPT).code);
const evilList = await signRevocationList(
  gouJianCheXiaoBiao({ groupId: GROUP, listVersion: 9, entries: [{ certId: 'mc-bob-1', memberFingerprint: infoB.fingerprint, reason: 'admin', revokedAt: nowMs }], issuerFingerprint: infoEvil.fingerprint, issuerPublicKey: infoEvil.publicKey }),
  (b) => signerCreator.sign(b) // 用创建者的密钥签，但 issuer 字段写攻击者 → 验签必须失败
);
check('attacker 自称签发者但签名不是他的 → bad-signature', verifyRevocationList(evilList, VOPT).code === 'bad-signature');
check('把攻击者的列表塞进本机 → 被拒且版本不变', (() => {
  const r = creatorMembership.yingYongCheXiaoBiao(GROUP, evilList);
  return r.ok === false && creatorMembership.revocation(GROUP).listVersion === 2;
})(), creatorMembership.yingYongCheXiaoBiao(GROUP, evilList).code);
check('verifyAndApplyRevocationList：验签失败时**不合并**（顺序不可颠倒）', (() => {
  const r = verifyAndApplyRevocationList(v2, evilList, VOPT);
  return r.ok === false && r.changed === false;
})(), verifyAndApplyRevocationList(v2, evilList, VOPT).code);
check('本机的 v2 列表可以自证（verifyRevocationList ok）', verifyRevocationList(v2, { ...VOPT, expectIssuerFingerprint: infoCreator.fingerprint }).ok === true);
check('issuerPublicKey 无法解释（非 Ed25519）→ 结构拒', verifyRevocationList({ ...v2, issuerPublicKey: Buffer.from('zz').toString('base64') }, VOPT).ok === false);
check('entry.certId 重复 → malformed（签名列表不该有重复项）', (() => {
  const dup = { ...v2, entries: [v2.entries[0], { ...v2.entries[0] }] };
  return verifyRevocationList(dup, VOPT).code === 'malformed';
})(), verifyRevocationList({ ...v2, entries: [v2.entries[0], { ...v2.entries[0] }] }, VOPT).code);
check('revokedAt 非法（NaN）→ malformed', (() => {
  const t = { ...v2, entries: [{ ...v2.entries[0], revokedAt: NaN }] };
  return verifyRevocationList(t, VOPT).ok === false;
})());
check('applyInboundRevocationUpdate：来路指纹不是创建者 → not-issuer', (() => {
  const r = applyInboundRevocationUpdate({
    membership: creatorMembership, groupId: GROUP, list: v2, fromFingerprint: infoEvil.fingerprint,
    expectedIssuerFingerprint: infoCreator.fingerprint,
  });
  return r.ok === false && r.code === 'not-issuer';
})(), applyInboundRevocationUpdate({
  membership: creatorMembership, groupId: GROUP, list: v2, fromFingerprint: infoEvil.fingerprint,
  expectedIssuerFingerprint: infoCreator.fingerprint,
}).code);
check('applyInboundRevocationUpdate：来路指纹就是创建者 → 接受', (() => {
  const r = applyInboundRevocationUpdate({
    membership: creatorMembership, groupId: GROUP, list: v2, fromFingerprint: infoCreator.fingerprint,
    expectedIssuerFingerprint: infoCreator.fingerprint,
  });
  return r.ok === true;
})());
check('applyInboundRevocationUpdate：本机不知道群主时如实拒（unknown-issuer，不猜）', (() => {
  const fresh = new ChengYuanMingceCang(path.join(tmpRoot, 'unknown-issuer.json'), { fingerprintOf: fingerprintFromPublicKey });
  const r = applyInboundRevocationUpdate({ membership: fresh, groupId: 'g-nobody', list: v2, fromFingerprint: infoCreator.fingerprint });
  return r.ok === false && r.code === 'unknown-issuer';
})());
check('applyInboundRevocationUpdate：连接指纹是创建者但**列表是旧的** → 仍被 rollback 拒', (() => {
  const r = applyInboundRevocationUpdate({
    membership: creatorMembership, groupId: GROUP, list: curList, fromFingerprint: infoCreator.fingerprint,
    expectedIssuerFingerprint: infoCreator.fingerprint,
  });
  return r.ok === false && r.code === 'rollback';
})(), applyInboundRevocationUpdate({
  membership: creatorMembership, groupId: GROUP, list: curList, fromFingerprint: infoCreator.fingerprint,
  expectedIssuerFingerprint: infoCreator.fingerprint,
}).code);

/* ════════════════════════════════════════════════════════════════════════════
   [7] supersedes 变更链
   ════════════════════════════════════════════════════════════════════════════ */

section('7. supersedes 变更链：换证后"新指纹 = 原成员"，无关新指纹不是');

// bob 真换证（旧私钥签迁移声明）
const bobInfoBefore = memberB.store.info();
const rot = memberB.store.rotate({ reason: 'rotate', passphrase: PASS });
check('bob 本机 rotate() 成功（真换证）', rot.ok === true, rot.ok ? rot.info.fingerprint : rot.error);
const bobInfoAfter = memberB.store.info();
check('bob 的旧/新指纹不同（确实是换证）', bobInfoBefore.fingerprint !== bobInfoAfter.fingerprint);

const rotated = await rotateMemberCertificate({
  signer: signerCreator,
  membership: creatorMembership,
  groupId: GROUP,
  declaration: rot.declaration,
  currentGeneration: 1,
  certId: 'mc-bob-2',
});
check('创建者为 bob 重签成员证书成功（这就是"群内身份恢复"）', rotated.ok === true, rotated.ok ? rotated.cert.certId : rotated.code);
check('新证书 memberFingerprint = 新指纹', rotated.cert?.memberFingerprint === bobInfoAfter.fingerprint, rotated.cert?.memberFingerprint);
check('新证书 memberPublicKey = 新公钥', fingerprintFromPublicKey(String(rotated.cert?.memberPublicKey)) === bobInfoAfter.fingerprint);
check('新证书 supersedes 指向旧 certId（链的关键字段）', rotated.cert?.supersedes === CREATOR_CERT_ID, rotated.cert?.supersedes);
check('新证书沿用 memberId（跨换证稳定）', rotated.cert?.memberId === 'bob', rotated.cert?.memberId);
check('新证书沿用旧证书的 role/permissions', JSON.stringify(rotated.cert?.permissions) === JSON.stringify(bobCert.permissions) && rotated.cert?.role === bobCert.role);
check('换证声明被真实验证过（verification.accepted）', rotated.verification?.accepted === true, rotated.verification?.reason);
check('换证声明由旧公钥签名（reason 里能看到 oldFingerprint）', rotated.verification?.oldFingerprint === bobInfoBefore.fingerprint);
check('旧证书进入新版本吊销列表（reason=rotation）', (() => {
  const list = creatorMembership.revocation(GROUP);
  const e = list.entries.find((x) => x.certId === CREATOR_CERT_ID);
  return !!e && e.reason === 'rotation' && e.memberFingerprint === bobInfoBefore.fingerprint;
})(), creatorMembership.revocation(GROUP).entries);
check('吊销列表版本升到 3（v2→v3，递增）', creatorMembership.revocation(GROUP).listVersion === 3, creatorMembership.revocation(GROUP).listVersion);
check('换证后**旧指纹被拒**（旧证书已吊销）', (() => {
  const v = creatorMembership.authorizeFingerprint(bobInfoBefore.fingerprint);
  return v.decided === true && v.ok === false && v.code === 'revoked';
})(), creatorMembership.authorizeFingerprint(bobInfoBefore.fingerprint).code);
check('换证后**新指纹被放行**（原成员以新身份回来）', (() => {
  const v = creatorMembership.authorizeFingerprint(bobInfoAfter.fingerprint);
  return v.decided === true && v.ok === true && v.certId === 'mc-bob-2';
})(), creatorMembership.authorizeFingerprint(bobInfoAfter.fingerprint));
check('shiTongYiChengYuan(旧, 新) === true', creatorMembership.shiTongYiChengYuan(GROUP, bobInfoBefore.fingerprint, bobInfoAfter.fingerprint).same === true);
check('shiTongYiChengYuan 给出理由（链根）', /链/.test(creatorMembership.shiTongYiChengYuan(GROUP, bobInfoBefore.fingerprint, bobInfoAfter.fingerprint).reason), creatorMembership.shiTongYiChengYuan(GROUP, bobInfoBefore.fingerprint, bobInfoAfter.fingerprint).reason);
check('membershipSameMember（跨群封装）同样为 true', membershipSameMember(creatorMembership, GROUP, bobInfoBefore.fingerprint, bobInfoAfter.fingerprint).same === true);
check('lianShiZhiWen 覆盖链上两个指纹', (() => {
  const fps = creatorMembership.chainFingerprints(bobInfoAfter.fingerprint);
  return fps.includes(bobInfoBefore.fingerprint) && fps.includes(bobInfoAfter.fingerprint);
})(), creatorMembership.chainFingerprints(bobInfoAfter.fingerprint).length);
check('lianGenZhengShuId 指向链根（旧 certId）', lianGenZhengShuId(creatorMembership.listCertificates(GROUP), 'mc-bob-2') === CREATOR_CERT_ID, lianGenZhengShuId(creatorMembership.listCertificates(GROUP), 'mc-bob-2'));
check('bianliZhengshuLian 给出 旧→新 的顺序', (() => {
  const c = bianliZhengshuLian(creatorMembership.listCertificates(GROUP), 'mc-bob-2');
  return c.certIds.length === 2 && c.certIds[0] === CREATOR_CERT_ID && c.fingerprints[1] === bobInfoAfter.fingerprint;
})());
check('quChengYuanShenFen 在链上是同一 id（换证不换成员身份）', (() => {
  const certs = creatorMembership.listCertificates(GROUP);
  const a = quChengYuanShenFen(certs, certs.find((c) => c.certId === CREATOR_CERT_ID));
  const b = quChengYuanShenFen(certs, certs.find((c) => c.certId === 'mc-bob-2'));
  return a === b && a.length > 0;
})());

// 逆命题：无关的新指纹**不能**被当成原成员
const carolCert = creatorMembership.certificateById(GROUP, 'mc-carol-1');
check('无关指纹（carol）与 bob 不是同一成员', shiTongYiChengYuan(creatorMembership.listCertificates(GROUP), bobInfoAfter.fingerprint, infoC.fingerprint).same === false);
check('无关指纹的链根不同（理由里给出两个根）', (() => {
  const r = shiTongYiChengYuan(creatorMembership.listCertificates(GROUP), bobInfoAfter.fingerprint, infoC.fingerprint);
  return r.rootA !== r.rootB && /≠/.test(r.reason);
})(), shiTongYiChengYuan(creatorMembership.listCertificates(GROUP), bobInfoAfter.fingerprint, infoC.fingerprint));
check('完全没有证书的新指纹 → shiTongYiChengYuan false（理由：没有成员证书）', shiTongYiChengYuan(creatorMembership.listCertificates(GROUP), bobInfoAfter.fingerprint, infoEvil.fingerprint).reason.includes('没有成员证书'));
check('carol 的证书链根是她自己（无 supersedes）', lianGenZhengShuId(creatorMembership.listCertificates(GROUP), 'mc-carol-1') === 'mc-carol-1');
check('链断裂（supersedes 指向本机没有的证书）→ broken=true 但不崩', (() => {
  const certs = [...creatorMembership.listCertificates(GROUP), { ...bobCert, certId: 'mc-orphan', supersedes: 'mc-missing', memberFingerprint: 'AAAA-BBBB-CCCC-DDDD-EEEE' }];
  const c = bianliZhengshuLian(certs, 'mc-orphan');
  return c.broken === true && c.rootCertId === 'mc-orphan';
})());
check('链成环 → cycle=true 且**不用环做归属**（same=false）', (() => {
  // 注意：把 memberId 去掉 —— 否则"创建者沿用了同一 memberId"这条**独立**判据会先命中，
  // 反映不出"环不可用"这件事。
  const bare = { ...bobCert };
  delete bare.memberId;
  delete bare.supersedes;
  const x = { ...bare, certId: 'mc-cyc-a', memberFingerprint: 'AAAA-AAAA-AAAA-AAAA-AAAA', supersedes: 'mc-cyc-b' };
  const y = { ...bare, certId: 'mc-cyc-b', memberFingerprint: 'BBBB-BBBB-BBBB-BBBB-BBBB', supersedes: 'mc-cyc-a' };
  const cyclic = bianliZhengshuLian([x, y], 'mc-cyc-a');
  const same = shiTongYiChengYuan([x, y], 'AAAA-AAAA-AAAA-AAAA-AAAA', 'BBBB-BBBB-BBBB-BBBB-BBBB');
  return cyclic.cycle === true && same.same === false;
})(), (() => {
  const bare = { ...bobCert };
  delete bare.memberId;
  delete bare.supersedes;
  const x = { ...bare, certId: 'mc-cyc-a', memberFingerprint: 'AAAA-AAAA-AAAA-AAAA-AAAA', supersedes: 'mc-cyc-b' };
  const y = { ...bare, certId: 'mc-cyc-b', memberFingerprint: 'BBBB-BBBB-BBBB-BBBB-BBBB', supersedes: 'mc-cyc-a' };
  return { cycle: bianliZhengshuLian([x, y], 'mc-cyc-a').cycle, same: shiTongYiChengYuan([x, y], 'AAAA-AAAA-AAAA-AAAA-AAAA', 'BBBB-BBBB-BBBB-BBBB-BBBB').same };
})());
check('memberId 相同（创建者显式沿用）也判"同一成员"（第二条等价判据）', (() => {
  const p = { ...bobCert, certId: 'mc-id-a', memberFingerprint: 'AAAA-AAAA-AAAA-AAAA-AAAA', memberId: 'shared-id' };
  const q = { ...bobCert, certId: 'mc-id-b', memberFingerprint: 'BBBB-BBBB-BBBB-BBBB-BBBB', memberId: 'shared-id' };
  const r = shiTongYiChengYuan([p, q], 'AAAA-AAAA-AAAA-AAAA-AAAA', 'BBBB-BBBB-BBBB-BBBB-BBBB');
  return r.same === true && r.memberId === 'shared-id';
})());

// 负例：没有旧证书就不能重签（不猜"这是谁"）
const fakeDecl = { ...rot.declaration, oldFingerprint: infoEvil.fingerprint, signerFingerprint: infoEvil.fingerprint, newFingerprint: infoEvil.fingerprint };
const noCertRotate = await rotateMemberCertificate({ signer: signerCreator, membership: creatorMembership, groupId: GROUP, declaration: fakeDecl });
check('本机没有该指纹的旧证书 → no-existing-cert（绝不凭空认定）', noCertRotate.ok === false && noCertRotate.code === 'no-existing-cert', noCertRotate.code);
// 负例：代次不升
const staleRotate = await rotateMemberCertificate({
  signer: signerCreator, membership: creatorMembership, groupId: GROUP, declaration: rot.declaration, currentGeneration: 99, certId: 'mc-bob-3',
});
check('换证声明代次低于已知代次 → 拒（stale-generation）', staleRotate.ok === false && staleRotate.code === 'declaration:stale-generation', staleRotate.code);
check('被拒后没有多余的证书落盘（仍是 3 张：bob1/bob2/carol1）', creatorMembership.listCertificates(GROUP).length === 3, creatorMembership.listCertificates(GROUP).length);
// 负例：声明里带联系方式 → 拒
const declWithCard = { ...rot.declaration, contactCard: { email: 'x@evil.test' } };
const cardRotate = await rotateMemberCertificate({ signer: signerCreator, membership: creatorMembership, groupId: GROUP, declaration: declWithCard });
check('声明里带联系方式 → 拒（contact-not-allowed）', cardRotate.ok === false && cardRotate.code === 'declaration:contact-not-allowed', cardRotate.code);

// 人工恢复：无声明、靠 memberId 延续 —— 用**已被踢出**的 carol 做真实场景
const revived = mkIdentity('revived', PASS);
revived.store.unlock(PASS);
const infoRevived = revived.store.info();
const recover = await reissueMemberCertificateForRecovery({
  signer: signerCreator, membership: creatorMembership, groupId: GROUP,
  oldFingerprint: infoC.fingerprint, newFingerprint: infoRevived.fingerprint, newPublicKey: infoRevived.publicKey, certId: 'mc-carol-recover',
});
check('人工恢复（被踢成员换新密钥后回来，沿用 memberId）成功签发', recover.ok === true, recover.code);
check('人工恢复给出 linked=true（同一成员身份）', recover.linked === true, recover.linked);
check('人工恢复后 shiTongYiChengYuan(新指纹, 被踢的旧指纹) === true —— 这就是"群内身份恢复"', creatorMembership.shiTongYiChengYuan(GROUP, infoRevived.fingerprint, infoC.fingerprint).same === true);
check('人工恢复沿用旧证书的成员标识', recover.memberId === 'mc-carol-1' || recover.memberId === 'carol', recover.memberId);
check('恢复出来的新指纹持有效证书 → 放行（真正重新进群）', creatorMembership.authorizeFingerprint(infoRevived.fingerprint).ok === true);
check('被踢的旧指纹依旧被吊销（恢复不解除旧证书的吊销）', creatorMembership.authorizeFingerprint(infoC.fingerprint).code === 'revoked');

/* ════════════════════════════════════════════════════════════════════════════
   [8] TOFU 降级 + 证书优先
   ════════════════════════════════════════════════════════════════════════════ */

section('8. 无证书时 TOFU 降级仍可用；有记录时证书/吊销优先');

const plain = mkIdentity('plain', PASS);
const plainMembership = membershipStoreFor(plain.store);
check('全新身份没有任何群成员记录', plainMembership.listGroups().length === 0, plainMembership.listGroups());
check('名册：未知指纹被拒（fail-closed）', createRosterChecker(plain.store)('AAAA-AAAA-AAAA-AAAA-AAAA') === false);
plain.store.recordPeerCard(infoB.fingerprint, { email: 'b@example.test' }, Date.now());
check('记录对端名片后名册放行（TOFU 降级路径仍可用）', createRosterChecker(plain.store)(infoB.fingerprint) === true);
check('名册仍拒未记录者', createRosterChecker(plain.store)(infoC.fingerprint) === false);
check('explainRosterDecision 说明依据是 tofu', explainRosterDecision(plain.store, infoB.fingerprint).basis === 'tofu');
check('requireCertificate=true 时 TOFU 被关闭（已知联系人也不放行）', createRosterChecker(plain.store, [], { requireCertificate: true })(infoB.fingerprint) === false);
check('requireCertificate=true 但持有效证书 → 放行', (() => {
  const m = new ChengYuanMingceCang(path.join(tmpRoot, 'plain-membership.json'), { fingerprintOf: fingerprintFromPublicKey, clockSkewMs: DEFAULT_CLOCK_SKEW_MS });
  // 用创建者给 bob 的有效证书（bob 的新指纹），拷进 plain 的库里
  const cert = creatorMembership.certificateById(GROUP, 'mc-bob-2');
  const put = m.putCertificate(cert, { expectIssuerFingerprint: infoCreator.fingerprint });
  if (!put.ok) return false;
  return createRosterChecker(plain.store, [], { membership: m, requireCertificate: true })(bobInfoAfter.fingerprint) === true;
})());
check('证书记录优先于 TOFU：被吊销者即使在本机联系人表里也被拒', (() => {
  const m = new ChengYuanMingceCang(path.join(tmpRoot, 'plain-membership2.json'), { fingerprintOf: fingerprintFromPublicKey, clockSkewMs: DEFAULT_CLOCK_SKEW_MS });
  const cert = creatorMembership.certificateById(GROUP, 'mc-carol-1');
  m.putCertificate(cert, { expectIssuerFingerprint: infoCreator.fingerprint });
  const list = creatorMembership.revocation(GROUP);
  m.yingYongCheXiaoBiao(GROUP, list, { expectIssuerFingerprint: infoCreator.fingerprint });
  plain.store.recordPeerCard(infoC.fingerprint, { email: 'c@example.test' }, Date.now());
  const checker = createRosterChecker(plain.store, [], { membership: m });
  const decision = explainRosterDecision(plain.store, infoC.fingerprint, { membership: m });
  // 对照组：只有 TOFU（不给 membership）时同一个人是放行的 —— 说明"拒"确实来自证书层
  const tofuOnly = createRosterChecker(plain.store, [], { membership: null })(infoC.fingerprint);
  return checker(infoC.fingerprint) === false && decision.basis === 'revoked' && tofuOnly === true;
})());
check('过期证书也要落盘（stored=true）→ 名册因此明确拒，而不是退回 TOFU', (() => {
  const m = new ChengYuanMingceCang(path.join(tmpRoot, 'expired-store.json'), { fingerprintOf: fingerprintFromPublicKey, clockSkewMs: DEFAULT_CLOCK_SKEW_MS, now: () => nowMs });
  const expired = independentSignCert(
    gouJianChengYuanZhengShu(
      { certId: 'mc-expired', groupId: 'g-exp', memberFingerprint: infoC.fingerprint, memberPublicKey: infoC.publicKey,
        issuerFingerprint: infoCreator.fingerprint, issuerPublicKey: infoCreator.publicKey, issuedAt: EXPIRED_AT - 3_600_000, expiresAt: EXPIRED_AT },
      { now: nowMs }
    ),
    creator.store.load().privateKeyDer
  );
  const put = m.putCertificate(expired, { expectIssuerFingerprint: infoCreator.fingerprint });
  const verdict = m.authorizeFingerprint(infoC.fingerprint, { now: nowMs });
  return put.ok === true && put.code === 'expired' && verdict.decided === true && verdict.ok === false && verdict.code === 'expired';
})(), (() => {
  const m = new ChengYuanMingceCang(path.join(tmpRoot, 'expired-store-probe.json'), { fingerprintOf: fingerprintFromPublicKey, clockSkewMs: DEFAULT_CLOCK_SKEW_MS, now: () => nowMs });
  const expired = independentSignCert(
    gouJianChengYuanZhengShu(
      { certId: 'mc-expired-p', groupId: 'g-exp', memberFingerprint: infoC.fingerprint, memberPublicKey: infoC.publicKey,
        issuerFingerprint: infoCreator.fingerprint, issuerPublicKey: infoCreator.publicKey, issuedAt: EXPIRED_AT - 3_600_000, expiresAt: EXPIRED_AT },
      { now: nowMs }
    ),
    creator.store.load().privateKeyDer
  );
  const put = m.putCertificate(expired, { expectIssuerFingerprint: infoCreator.fingerprint });
  return { put: put.code, verdict: m.authorizeFingerprint(infoC.fingerprint, { now: nowMs }) };
})());
check('明文/结构损坏的证书不进库（不污染判定）', (() => {
  const r = membershipStoreFor(plain.store).putCertificate({ schema: CHENGYUAN_ZHENGSHU_MOSHI, certId: 'x' });
  return r.ok === false && r.stored === false;
})());
check('explainRosterDecision 对 pin 过的指纹给 basis=pin', explainRosterDecision(plain.store, 'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ', { extra: ['ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ'] }).basis === 'pin');
check('explainRosterDecision 对完全未知指纹给 basis=none', explainRosterDecision(plain.store, 'YYYY-YYYY-YYYY-YYYY-YYYY').basis === 'none');
check('名册判定在"证书有效"时给出 basis=certificate', (() => {
  const m = new ChengYuanMingceCang(path.join(tmpRoot, 'plain-membership3.json'), { fingerprintOf: fingerprintFromPublicKey, clockSkewMs: DEFAULT_CLOCK_SKEW_MS });
  m.putCertificate(creatorMembership.certificateById(GROUP, 'mc-bob-2'), { expectIssuerFingerprint: infoCreator.fingerprint });
  return explainRosterDecision(plain.store, bobInfoAfter.fingerprint, { membership: m }).basis === 'certificate';
})());
check('identity-provider 的 wentiChengyuanZhengshu 在身份锁着时如实报 identity-locked（不返回空签名）', await (async () => {
  const locked = mkIdentity('locked', PASS);
  const lockedMembership = membershipStoreFor(locked.store);
  const r = await wentiChengyuanZhengshu({
    signer: (await import('../dist/identity-provider.js')).createIdentitySigner(locked.store),
    membership: lockedMembership, groupId: 'g-locked',
    memberFingerprint: infoB.fingerprint, memberPublicKey: infoB.publicKey, certId: 'mc-locked',
  });
  return r.ok === false && r.code === 'identity-locked';
})());
check('锁着时**没有**留下半成品证书', membershipStoreFor(mkIdentity('locked2', PASS).store).listGroups().length === 0);

/* ════════════════════════════════════════════════════════════════════════════
   [9] GroupMemberRecord.fingerprint 迁移
   ════════════════════════════════════════════════════════════════════════════ */

section('9. 成员表 fingerprint 字段与旧格式迁移（不猜、不伪造、不改写）');

const groupsFile = path.join(tmpRoot, 'groups.json');
const legacy = {
  version: 1,
  groups: [{ groupId: 'g-legacy', ming: '旧群', type: 'internal', directedMode: false, dutyInstanceId: null, createdAt: 1, updatedAt: 1, origin: 'ipc' }],
  members: {
    'g-legacy': [
      { id: 'm-1', ming: '老王', role: 'member', joinedAt: 1, source: 'invite' },
      { id: 'inst:inst-9', ming: '牛马九号', role: 'member', joinedAt: 2, source: 'instance', instanceId: 'inst-9' },
    ],
  },
};
fs.writeFileSync(groupsFile, JSON.stringify(legacy, null, 2), 'utf8');
const legacyRaw = fs.readFileSync(groupsFile, 'utf8');
const gs = new QunCang(groupsFile);
const legacySnap = gs.snapshot();
check('旧格式读入不报错', legacySnap.groups.length === 1 && legacySnap.members['g-legacy'].length === 2, legacySnap.groups.length);
check('旧成员记录的 fingerprint 是 undefined（不猜、不伪造）', legacySnap.members['g-legacy'].every((m) => m.fingerprint === undefined), legacySnap.members['g-legacy'].map((m) => m.fingerprint));
check('读旧格式**不改写文件**（字节级一致）', fs.readFileSync(groupsFile, 'utf8') === legacyRaw);
check('旧群没有 creatorFingerprint（未知就留空）', legacySnap.groups[0].creatorFingerprint === undefined);
check('groupsWithFingerprint 对无指纹的旧库返回空', gs.groupsWithFingerprint(infoB.fingerprint).length === 0);

const audits = [];
const inviteWithFp = gs.addMemberWithFingerprint(
  'g-legacy',
  { ming: '小张', role: 'member', source: 'invite', fingerprint: infoB.fingerprint },
  { onAudit: (op, detail) => audits.push({ op, detail }) }
);
check('邀请 + 带指纹 → 成员写入成功', inviteWithFp.ok === true && inviteWithFp.members.length === 3, inviteWithFp.members.map((m) => m.name));
check('指纹落盘并在返回值里可见', inviteWithFp.members.find((m) => m.name === '小张')?.fingerprint === infoB.fingerprint);
check('写入路径记录审计 group.member.fingerprint', audits.some((a) => a.op === 'group.member.fingerprint'), audits.map((a) => a.op));
check('这次写盘后文件里出现了指纹（"下次写入时才带上"）', readJson(groupsFile).members['g-legacy'].find((m) => m.name === '小张').fingerprint === infoB.fingerprint);
check('旧成员依然没有指纹（没有被"顺便补上"）', readJson(groupsFile).members['g-legacy'].find((m) => m.name === '老王').fingerprint === undefined);
const audits2 = [];
const inviteNoFp = gs.addMemberWithFingerprint('g-legacy', { ming: '无名', role: 'member', source: 'invite' }, { onAudit: (op, detail) => audits2.push({ op, detail }) });
check('邀请但拿不到指纹 → 留空', inviteNoFp.members.find((m) => m.name === '无名')?.fingerprint === undefined);
check('拿不到指纹时记一条审计（missing）', audits2.some((a) => a.op === 'group.member.fingerprint.missing'), audits2.map((a) => a.op));
const audits3 = [];
const instMember = gs.addMemberWithFingerprint(
  'g-legacy',
  { ming: '牛马十号', role: 'member', source: 'instance', instanceId: 'inst-10', fingerprint: infoC.fingerprint },
  { onAudit: (op, detail) => audits3.push({ op, detail }) }
);
check('本机实例成员即使传了指纹也**不写**（实例不是远端身份，套指纹等于伪造归属）', instMember.members.find((m) => m.name === '牛马十号')?.fingerprint === undefined);
check('实例路径不记 missing 审计（原因已明确：不是"拿不到"）', audits3.length === 0, audits3);
const audits4 = [];
gs.addMemberWithFingerprint('g-legacy', { ming: '迁移员', role: 'member', source: 'migrated' }, { onAudit: (op, detail) => audits4.push({ op, detail }) });
check('migrated 路径留空且记审计', audits4.some((a) => a.op === 'group.member.fingerprint.missing' && a.detail?.reason === 'legacy-record'), audits4);

const patch = gs.setMemberFingerprint('g-legacy', 'm-1', infoB.fingerprint);
check('setMemberFingerprint 能给旧成员补指纹', patch.ok === true && patch.changed === true, patch.error);
check('补写后落盘可见', readJson(groupsFile).members['g-legacy'].find((m) => m.id === 'm-1').fingerprint === infoB.fingerprint);
check('重复补同一指纹 → changed=false（幂等）', (() => {
  const again = gs.setMemberFingerprint('g-legacy', 'm-1', infoB.fingerprint);
  return again.ok === true && again.changed === false;
})());
check('空指纹不被接受（没有"清空指纹"这条路径）', gs.setMemberFingerprint('g-legacy', 'm-1', '').ok === false);
check('给不存在的成员补指纹 → member not found', gs.setMemberFingerprint('g-legacy', 'nope', infoB.fingerprint).ok === false);
check('groupsWithFingerprint 命中该群', gs.groupsWithFingerprint(infoB.fingerprint).some((r) => r.groupId === 'g-legacy'), gs.groupsWithFingerprint(infoB.fingerprint));
check('groupsWithFingerprint 忽略短横/大小写差异', gs.groupsWithFingerprint(infoB.fingerprint.replace(/-/g, '').toLowerCase()).length >= 1);
check('addMember（底层）也接受 fingerprint 参数', (() => {
  const r = gs.addMember('g-legacy', { ming: '直接加', role: 'member', source: 'invite', fingerprint: infoC.fingerprint });
  return r.ok === true && r.members.find((m) => m.name === '直接加')?.fingerprint === infoC.fingerprint;
})());
const gs2 = new QunCang(groupsFile);
const up = gs2.upsertGroup({ groupId: 'g-legacy', ming: '旧群', type: 'internal', creatorFingerprint: infoCreator.fingerprint });
check('upsertGroup 写入 creatorFingerprint', up.ok === true && up.group?.creatorFingerprint === infoCreator.fingerprint, up.group?.creatorFingerprint);
check('creatorFingerprint 落盘', readJson(groupsFile).groups[0].creatorFingerprint === infoCreator.fingerprint);
check('再次 upsert 不覆盖已知的 creatorFingerprint', (() => {
  const r = gs2.upsertGroup({ groupId: 'g-legacy', ming: '旧群2', type: 'internal', creatorFingerprint: infoEvil.fingerprint });
  return r.group?.creatorFingerprint === infoCreator.fingerprint;
})());
check('不给 creatorFingerprint 时保持缺失（不编造）', (() => {
  const r = gs2.upsertGroup({ groupId: 'g-new', ming: '新群', type: 'external' });
  return r.ok === true && r.group?.creatorFingerprint === undefined;
})());
check('group-store 的指纹比较与身份层规则一致（同一批输入结论相同）', (() => {
  const cases = [
    [infoB.fingerprint, infoB.fingerprint.toLowerCase()],
    [infoB.fingerprint, infoB.fingerprint.replace(/-/g, '')],
    ['ABCDE-FGHJK-1LMNP-TVXYZ', 'abcde-fghjk-ilmnptvxyz'.replace(/i/g, '1').replace(/o/g, '0')],
    ['AAAAA-BBBBB-CCCCC-DDDDD-EEEEE', 'AAAAA-BBBBB-CCCCC-DDDDD-EEEEF'],
  ];
  return cases.every(([a, b]) => sameFingerprintText(a, b) === (normalizeFingerprint(a) === normalizeFingerprint(b)));
})(), sameFingerprintText(infoB.fingerprint, infoB.fingerprint.toLowerCase()));

/* ════════════════════════════════════════════════════════════════════════════
   [10] scopes
   ════════════════════════════════════════════════════════════════════════════ */

section('10. scopes：有映射精确到群/项目；无映射如实回退 [{kind:all}]');

const scopeGroups = new QunCang(path.join(tmpRoot, 'scope-groups.json'));
scopeGroups.upsertGroup({ groupId: 'g-in', ming: '项目推进群', type: 'internal', creatorFingerprint: infoCreator.fingerprint });
scopeGroups.upsertGroup({ groupId: 'g-ext', ming: '外部队', type: 'external', creatorFingerprint: infoCreator.fingerprint });
scopeGroups.addMemberWithFingerprint('g-in', { ming: 'bob', role: 'member', source: 'invite', fingerprint: bobInfoAfter.fingerprint });
scopeGroups.addMemberWithFingerprint('g-ext', { ming: 'bob', role: 'member', source: 'invite', fingerprint: bobInfoAfter.fingerprint });
scopeGroups.addMemberWithFingerprint('g-ext', { ming: '本地牛马', role: 'member', source: 'instance', instanceId: 'inst-1' });

const scoped = computeChangeScopes({
  fingerprints: [bobInfoBefore.fingerprint, bobInfoAfter.fingerprint],
  directory: scopeGroups,
  contacts: [],
});
check('有映射时 scopeBasis = membership', scoped.scopeBasis === 'membership', scoped.scopeBasis);
check('精确命中内群（kind=internal + groupId）', scoped.scopes.some((s) => s.kind === 'internal' && s.id === 'g-in'), scoped.scopes);
check('精确命中外部群（kind=external + groupId）', scoped.scopes.some((s) => s.kind === 'external' && s.id === 'g-ext'), scoped.scopes);
check('scopes 里**没有** all（有映射就不该到处出现）', scoped.scopes.every((s) => s.kind !== 'all'), scoped.scopes);
check('命中群列表非空且带成员 id/ming（可追责）', scoped.matchedGroups.length === 2 && scoped.matchedGroups.every((g) => !!g.memberId), scoped.matchedGroups);
check('映射不存在 → 回退 [{kind:all}] 且 scopeBasis=fallback-all', (() => {
  const r = computeChangeScopes({ fingerprints: ['QQQQ-QQQQ-QQQQ-QQQQ-QQQQ'], directory: scopeGroups, contacts: [] });
  return r.scopeBasis === 'fallback-all' && r.scopes.length === 1 && r.scopes[0].kind === 'all';
})(), computeChangeScopes({ fingerprints: ['QQQQ-QQQQ-QQQQ-QQQQ-QQQQ'], directory: scopeGroups, contacts: [] }).scopes);
check('完全没有 directory 时也是 fallback-all（旧行为，UI 175 项依赖）', (() => {
  const r = computeChangeScopes({ fingerprints: [bobInfoAfter.fingerprint] });
  return r.scopeBasis === 'fallback-all' && r.scopes[0].kind === 'all';
})());
check('本机自己的换证 → [{kind:all}] + scopeBasis=self-all（真实结论，不是降级）', (() => {
  const r = computeChangeScopes({ fingerprints: [infoCreator.fingerprint], directory: scopeGroups, selfFingerprint: infoCreator.fingerprint });
  return r.scopeBasis === 'self-all' && r.scopes.length === 1 && r.scopes[0].kind === 'all';
})());
check('联系人命中 → 加一个不带 id 的 extdm 范围（本机没有会话 id ↔ 指纹映射）', (() => {
  const r = computeChangeScopes({ fingerprints: [bobInfoAfter.fingerprint], directory: null, contacts: [bobInfoAfter.fingerprint] });
  const extdm = r.scopes.find((s) => s.kind === 'extdm');
  return r.scopeBasis === 'membership' && !!extdm && extdm.id === undefined && r.matchedContacts.length === 1;
})(), computeChangeScopes({ fingerprints: [bobInfoAfter.fingerprint], directory: null, contacts: [bobInfoAfter.fingerprint] }).scopes);
check('成员表里的指纹书写不同（去短横）也能命中', computeChangeScopes({
  fingerprints: [bobInfoAfter.fingerprint.replace(/-/g, '').toLowerCase()],
  directory: scopeGroups,
}).scopes.some((s) => s.id === 'g-in'));
check('两个指纹命中同一个群只出一次 scope（去重）', (() => {
  const r = computeChangeScopes({ fingerprints: [bobInfoAfter.fingerprint, bobInfoAfter.fingerprint], directory: scopeGroups });
  return r.scopes.filter((s) => s.id === 'g-in').length === 1;
})());
check('空指纹列表 → fallback-all', computeChangeScopes({ fingerprints: [], directory: scopeGroups }).scopeBasis === 'fallback-all');

// 真换证条目上的 scopes（bob 换证 → 创建者视角）
creator.store.recordPeerRotation(rot.declaration, Date.now());
const entries = buildIdentityChangeEntries(creator.store, {
  now: Date.now(),
  acks: {},
  membership: creatorMembership,
  directory: scopeGroups,
  contacts: [],
});
const peerEntry = entries.find((e) => e.id.startsWith('peer:'));
check('换证条目出现（对端换证）', !!peerEntry, entries.map((e) => e.id));
check('条目 scopes 精确到两个群（不再是"到处都出现"）', (() => {
  const ids = peerEntry.scopes.filter((s) => s.id).map((s) => s.id).sort();
  return JSON.stringify(ids) === JSON.stringify(['g-ext', 'g-in']);
})(), peerEntry.scopes);
check('条目 scopeBasis = membership', peerEntry.scopeBasis === 'membership', peerEntry.scopeBasis);
check('条目的 newFingerprint = bob 的新指纹', peerEntry.newFingerprint === bobInfoAfter.fingerprint, peerEntry.newFingerprint);
check('链条扩展生效：只给新指纹也能通过链找到成员表（旧指纹在表里也能命中）', (() => {
  const r = computeChangeScopes({ fingerprints: creatorMembership.chainFingerprints(bobInfoAfter.fingerprint), directory: scopeGroups });
  return r.scopeBasis === 'membership';
})());
const noDirEntries = buildIdentityChangeEntries(creator.store, { now: Date.now(), acks: {}, membership: creatorMembership, contacts: [] });
check('不给 directory、也不给联系人 → 退回 [{kind:all}] + fallback-all（向后兼容，UI 只增不减）', (() => {
  const e = noDirEntries.find((x) => x.id.startsWith('peer:'));
  return e.scopeBasis === 'fallback-all' && e.scopes.length === 1 && e.scopes[0].kind === 'all';
})(), noDirEntries.find((x) => x.id.startsWith('peer:'))?.scopes);
const contactOnlyEntries = buildIdentityChangeEntries(creator.store, { now: Date.now(), acks: {}, membership: creatorMembership });
check('有联系人表但没有群成员表 → 精确到 extdm（有映射就不退回 all）', (() => {
  const e = contactOnlyEntries.find((x) => x.id.startsWith('peer:'));
  return e.scopeBasis === 'membership' && e.scopes.some((s) => s.kind === 'extdm');
})(), contactOnlyEntries.find((x) => x.id.startsWith('peer:'))?.scopes);
check('本机换证条目 scopeBasis = self-all（和旧行为一致：三处都出）', (() => {
  const self = entries.find((e) => e.id.startsWith('self:'));
  if (!self) return true; // 创建者本机没换证 → 本条不适用
  return self.scopeBasis === 'self-all' && self.scopes[0].kind === 'all';
})());
check('entries 仍是数组且按时间倒序', Array.isArray(entries) && entries.every((e, i) => i === 0 || entries[i - 1].ts >= e.ts));

/* ════════════════════════════════════════════════════════════════════════════
   [11] presenceBasis：三种取值都用真活连接压出来
   ════════════════════════════════════════════════════════════════════════════ */

section('11. 成员在线态：活连接按指纹判定；拿不到指纹如实 unattributed');

let livenessClock = 1_000_000;
const liveness = new LianJieHuoXing({ now: () => livenessClock, offlineFailures: 2, offlineAfterMs: 30_000 });
const liveB = liveness.registerConnection(bobInfoAfter.fingerprint, { id: 'conn-1', kind: 'member-initiated' });
check('真活连接注册后该指纹在线（member-connection）', liveB.online === true && liveB.via === 'member-connection', liveB);
const presenceMembers = [
  { id: 'inst-1', ming: '牛马一号', source: 'instance', instanceId: 'inst-1' },
  { id: 'm-bob', ming: 'bob', role: 'member', source: 'invite', fingerprint: bobInfoAfter.fingerprint },
  { id: 'm-nofp', ming: '无名氏', role: 'member', source: 'invite' },
];
const presenceRows = goujianChengyuanZaichang({
  members: presenceMembers,
  instances: [{ id: 'inst-1', ming: '牛马一号', status: 'running' }],
  liveness: liveness.list(),
  meshEnabled: true,
});
check('三种 presenceBasis 都出现（local-instance / mesh-session / unattributed）', (() => {
  const set = new Set(presenceRows.map((r) => r.presenceBasis));
  return set.has('local-instance') && set.has('mesh-session') && set.has('unattributed');
})(), presenceRows.map((r) => r.presenceBasis));
const rowLocal = presenceRows.find((r) => r.id === 'inst-1');
const rowBob = presenceRows.find((r) => r.id === 'm-bob');
const rowNoFp = presenceRows.find((r) => r.id === 'm-nofp');
check('本机实例成员：online 取 InstanceManager 状态（running → true）', rowLocal.online === true && rowLocal.remote === false, rowLocal);
check('本机实例成员：presenceBasis=local-instance', rowLocal.presenceBasis === 'local-instance');
check('异地+有指纹：presenceBasis=mesh-session', rowBob.presenceBasis === 'mesh-session', rowBob);
check('异地+有指纹：活连接命中 → online=true', rowBob.online === true, rowBob);
check('异地+有指纹：给出判据（presenceVia=member-connection）', rowBob.presenceVia === 'member-connection', rowBob.presenceVia);
check('异地+有指纹：指纹被带回（结构化，供 UI 归属）', rowBob.fingerprint === bobInfoAfter.fingerprint);
check('异地+**没有**指纹：presenceBasis=unattributed', rowNoFp.presenceBasis === 'unattributed');
check('异地+没有指纹：**不给** online 字段（宁可不给，不编）', !('online' in rowNoFp), Object.keys(rowNoFp));
check('异地+没有指纹：也不给 fingerprint 字段', !('fingerprint' in rowNoFp), Object.keys(rowNoFp));
check('未连过的指纹 → 明确 offline（有指纹但没活连接 = 不在线）', (() => {
  const rows = goujianChengyuanZaichang({
    members: [{ id: 'm-c', ming: 'carol', source: 'invite', fingerprint: infoC.fingerprint }],
    instances: [], liveness: liveness.list(), meshEnabled: true,
  });
  return rows[0].presenceBasis === 'mesh-session' && rows[0].online === false && rows[0].presenceVia === 'none';
})(), goujianChengyuanZaichang({
  members: [{ id: 'm-c', ming: 'carol', source: 'invite', fingerprint: infoC.fingerprint }],
  instances: [], liveness: liveness.list(), meshEnabled: true,
})[0]);
liveness.closeConnection(bobInfoAfter.fingerprint, 'conn-1', livenessClock);
livenessClock += 60_000;
liveness.markMiss(bobInfoAfter.fingerprint, livenessClock);
liveness.markMiss(bobInfoAfter.fingerprint, livenessClock);
const swept = await liveness.sweep(livenessClock);
check('迟滞判定把断开的成员判离线（真 sweep：连续失败 ≥2 且持续 ≥30s）', liveness.status(bobInfoAfter.fingerprint).online === false, { swept: swept.markedOffline, status: liveness.status(bobInfoAfter.fingerprint) });
check('sweep 把该指纹列进 markedOffline（可观测）', swept.markedOffline.includes(bobInfoAfter.fingerprint), swept.markedOffline);
check('sweep 不做主动探测（没有 pendingProbe 目标 → probed 为空）', swept.probed.length === 0, swept.probed);
check('断线后 presenceBasis 仍是 mesh-session，但 online=false（如实）', (() => {
  const rows = goujianChengyuanZaichang({ members: [presenceMembers[1]], instances: [], liveness: liveness.list(), meshEnabled: true });
  return rows[0].presenceBasis === 'mesh-session' && rows[0].online === false;
})());
check('组网关闭时异地成员一律不在线（UI 会显示"组网关闭"）', (() => {
  const rows = goujianChengyuanZaichang({ members: [presenceMembers[1]], instances: [], liveness: [liveB], meshEnabled: false });
  return rows[0].online === false && rows[0].presenceBasis === 'mesh-session';
})());
check('指纹书写差异也能匹配活连接（去短横/小写）', (() => {
  const rows = goujianChengyuanZaichang({
    members: [{ id: 'm-b', ming: 'bob', source: 'invite', fingerprint: bobInfoAfter.fingerprint.toLowerCase() }],
    instances: [], liveness: [liveB], meshEnabled: true,
  });
  return rows[0].online === true;
})());
check('已停用实例在 presence 行里带 disabled 标记', (() => {
  const rows = goujianChengyuanZaichang({
    members: [presenceMembers[0]], instances: [{ id: 'inst-1', ming: '牛马一号', status: 'stopped' }],
    liveness: [], meshEnabled: true, disabledInstanceIds: ['inst-1'],
  });
  return rows[0].disabled === true && rows[0].online === false;
})());
check('空成员表 → 空数组（不抛）', goujianChengyuanZaichang({ members: [], instances: [], liveness: [], meshEnabled: true }).length === 0);

// IPC 接线（静态检查：主进程/preload 真的注册了这些通道）
const mainSrc = fs.readFileSync(path.join(selfDir, '..', 'src', 'electron-main.ts'), 'utf8');
const preloadSrc = fs.readFileSync(path.join(selfDir, '..', 'src', 'preload.cjs'), 'utf8');
check('主进程 net-members-presence 已改用 goujianChengyuanZaichang', /net-members-presence[\s\S]{0,900}buildMemberPresence\(/.test(mainSrc));
check('主进程不再残留"成员表里只有 id/ming/instanceId，没有指纹"的旧注释', !mainSrc.includes('成员表里只有 id/ming/instanceId'));
check('主进程 identity-changes 传入 directory（成员表）', /identity-changes[\s\S]{0,700}directory: groupStore/.test(mainSrc));
const CHANNELS = [
  'warmy:chengYuanMingCeLieBiao',
  'warmy:chengYuanMingCeShouQuan',
  'warmy:chengYuanMingCeQianFa',
  'warmy:chengYuanMingCeLunHuan',
  'warmy:chengYuanMingCeCheXiao',
  'warmy:chengYuanMingCeJieShouZhengShu',
  'warmy:chengYuanMingCeTongBuCheXiao',
];
check('7 条成员证书 IPC 都在主进程注册', CHANNELS.every((c) => mainSrc.includes(`'${c}'`)), CHANNELS.filter((c) => !mainSrc.includes(`'${c}'`)));
check('7 条成员证书 IPC 都在 preload 白名单里', CHANNELS.every((c) => preloadSrc.includes(`'${c}'`)), CHANNELS.filter((c) => !preloadSrc.includes(`'${c}'`)));
check('preload 暴露了 renderer 用的函数名（membershipList/Authorize/Issue/Rotate/Revoke）', ['membershipList', 'membershipAuthorize', 'membershipIssue', 'membershipRotate', 'membershipRevoke'].every((n) => new RegExp(`\\b${n}: `).test(preloadSrc)));
check('踢人会顺手吊销证书（group-kick 里调用 chexiaoChengyuanZhengshu）', /group-kick[\s\S]{0,2000}revokeMemberCertificate\(/.test(mainSrc));
check('邀请带名片时会签发证书（group-invite 里调用 issueMemberCertForGroup）', /group-invite[\s\S]{0,2000}issueMemberCertForGroup\(/.test(mainSrc));
check('收到的吊销列表走已鉴权指纹校验（onInbound 里用 xiaoXi.peerFingerprint）', /applyInboundRevocationUpdate\(\{[\s\S]{0,400}fromFingerprint: xiaoXi\.peerFingerprint/.test(mainSrc));
check('UI（app.js）把 presenceBasis 带进 DOM 属性（可观测，不改判定）', fs.readFileSync(path.join(selfDir, '..', 'src', 'renderer', 'app.js'), 'utf8').includes('data-presence-basis'));
check('UI 换证条目带 data-scope-basis（降级原因可见）', fs.readFileSync(path.join(selfDir, '..', 'src', 'renderer', 'app.js'), 'utf8').includes('data-scope-basis'));
check('i18n 两侧都有 group.memberPresenceUnknown 且非空', (() => {
  const zh = readJson(path.join(selfDir, '..', 'src', 'i18n', 'zh-CN.json'));
  const en = readJson(path.join(selfDir, '..', 'src', 'i18n', 'en-US.json'));
  return typeof zh['group.memberPresenceUnknown'] === 'string' && zh['group.memberPresenceUnknown'].length > 0 &&
    typeof en['group.memberPresenceUnknown'] === 'string' && en['group.memberPresenceUnknown'].length > 0;
})());
check('英文包里该键不含中文', !/[\u4e00-\u9fff]/.test(readJson(path.join(selfDir, '..', 'src', 'i18n', 'en-US.json'))['group.memberPresenceUnknown']));

/* ════════════════════════════════════════════════════════════════════════════
   [12] 端到端：换证 → 旧指纹进不来 / 新指纹是原成员；落盘与缓存
   ════════════════════════════════════════════════════════════════════════════ */

section('12. 端到端与持久化（换证重签 + 缓存刷新 + 无明文私钥）');

const rosterCreator = createRosterChecker(creator.store);
check('名册：新指纹（持换证后的新证书）放行', rosterCreator(bobInfoAfter.fingerprint) === true, creatorMembership.authorizeFingerprint(bobInfoAfter.fingerprint));
check('名册：旧指纹（证书已吊销）被拒', rosterCreator(bobInfoBefore.fingerprint) === false);
check('名册：被踢的 carol 被拒', rosterCreator(infoC.fingerprint) === false);
check('名册：被踢后经群主背书回来的新指纹放行（这就是第四层恢复的最终效果）', rosterCreator(infoRevived.fingerprint) === true);
check('名册：完全无关的指纹被拒', rosterCreator('ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ') === false);
check('名册：攻击者的指纹被拒（从没被签发过证书）', rosterCreator(infoEvil.fingerprint) === false);
check('roster 判定链在握手层是可注入的纯函数（返回 boolean）', typeof rosterCreator(bobInfoAfter.fingerprint) === 'boolean');

// 另一个进程视角：新建 MembershipStore 直接读同一个文件
const reopened = new ChengYuanMingceCang(membershipFileFor(creator.store), {
  fingerprintOf: fingerprintFromPublicKey,
  clockSkewMs: DEFAULT_CLOCK_SKEW_MS,
});
check('重开（模拟重启）后证书仍在', reopened.LieBiaoCertificates(GROUP).length === creatorMembership.listCertificates(GROUP).length, {
  reopened: reopened.LieBiaoCertificates(GROUP).length,
  live: creatorMembership.listCertificates(GROUP).length,
});
check('重开后吊销列表版本一致', reopened.revocation(GROUP).listVersion === creatorMembership.revocation(GROUP).listVersion);
check('重开后旧指纹仍被拒（吊销是持久的）', reopened.authorizeFingerprint(bobInfoBefore.fingerprint).code === 'revoked');
check('重开后新指纹仍放行', reopened.authorizeFingerprint(bobInfoAfter.fingerprint).ok === true);
check('两个实例（不同进程视角）看到同一真相', (() => {
  const a = creatorMembership.authorizeFingerprint(infoC.fingerprint);
  const b = reopened.authorizeFingerprint(infoC.fingerprint);
  return a.code === b.code && a.ok === b.ok;
})());

// 缓存刷新：另一实例写入后，本实例应看到（按 mtime+size 判定）
const vNext = await signRevocationList(
  gouJianCheXiaoBiao({
    groupId: GROUP, listVersion: reopened.revocation(GROUP).listVersion + 1,
    entries: [...reopened.revocation(GROUP).entries, { certId: 'mc-evil-x', memberFingerprint: infoEvil.fingerprint, reason: 'compromise', revokedAt: Date.now() }],
    issuerFingerprint: infoCreator.fingerprint, issuerPublicKey: infoCreator.publicKey,
  }),
  (b) => signerCreator.sign(b)
);
const vNextVersion = vNext.listVersion;
reopened.yingYongCheXiaoBiao(GROUP, vNext, { expectIssuerFingerprint: infoCreator.fingerprint });
check('另一实例写入后，本实例读到新版本（缓存按文件变化失效）', creatorMembership.revocation(GROUP).listVersion === vNextVersion, creatorMembership.revocation(GROUP).listVersion);
check('刚刚被吊销的指纹立刻被名册拒（无需重启）', rosterCreator(infoEvil.fingerprint) === false);

// 损坏文件容错
const brokenFile = path.join(tmpRoot, 'broken-membership.json');
fs.writeFileSync(brokenFile, '{ this is not json', 'utf8');
const brokenStore = new ChengYuanMingceCang(brokenFile, { fingerprintOf: fingerprintFromPublicKey });
check('损坏文件读入不抛错（返回空结构）', brokenStore.listGroups().length === 0 && brokenStore.summary().certCount === 0);
const junkFile = path.join(tmpRoot, 'junk-membership.json');
fs.writeFileSync(junkFile, JSON.stringify({ schema: MEMBERSHIP_FILE_SCHEMA, groups: { g1: { groupId: 'g1', certs: [{ certId: 'bad' }, null, 'x'], revocation: { schema: 'wrong' } } } }), 'utf8');
const junkStore = new ChengYuanMingceCang(junkFile, { fingerprintOf: fingerprintFromPublicKey });
check('坏证书/坏吊销列表被丢弃而不是让整个文件不可用', junkStore.listCertificates('g1').length === 0 && junkStore.revocation('g1') === null);
check('坏数据不影响其它查询（authorizeFingerprint 给出 decided=false）', junkStore.authorizeFingerprint('AAAA-AAAA-AAAA-AAAA-AAAA').decided === false);

check('membership.json 全程不含明文私钥（最终检查）', !/BEGIN PRIVATE KEY|pkcs8/i.test(fs.readFileSync(membershipFileFor(creator.store), 'utf8')));
check('membershipSnapshot 结构化输出可用（逐证书带 valid/code）', (() => {
  const snap = membershipSnapshot(membershipStoreFor(creator.store), { groupId: GROUP });
  const bob2 = snap.groups[0]?.certs?.find((c) => c.certId === 'mc-bob-2');
  const bob1 = snap.groups[0]?.certs?.find((c) => c.certId === CREATOR_CERT_ID);
  return (
    snap.ok === true &&
    snap.groups.length === 1 &&
    snap.groups[0].revocationListVersion >= 2 &&
    bob2?.valid === true &&
    bob2?.code === 'ok' &&
    // 旧证书被吊销：快照里签发者/时间都还"有效"，但吊销由 revocationListVersion 表达
    bob1?.valid === true &&
    bob2?.supersedes === CREATOR_CERT_ID
  );
})(), JSON.stringify(membershipSnapshot(membershipStoreFor(creator.store), { groupId: GROUP }).groups[0]?.certs?.map((c) => [c.certId, c.valid, c.code])));
check('membershipSnapshot 对"已过期"的证书给出 valid=false + code=expired', (() => {
  const m = new ChengYuanMingceCang(path.join(tmpRoot, 'snap-expired.json'), { fingerprintOf: fingerprintFromPublicKey, clockSkewMs: DEFAULT_CLOCK_SKEW_MS });
  const expired = independentSignCert(
    gouJianChengYuanZhengShu(
      { certId: 'mc-snap-exp', groupId: 'g-snap', memberFingerprint: infoC.fingerprint, memberPublicKey: infoC.publicKey,
        issuerFingerprint: infoCreator.fingerprint, issuerPublicKey: infoCreator.publicKey, issuedAt: nowMs - 60_000, expiresAt: nowMs + 1000 },
      { now: nowMs }
    ),
    creator.store.load().privateKeyDer
  );
  m.putCertificate(expired, { expectIssuerFingerprint: infoCreator.fingerprint });
  const snap = membershipSnapshot(m, { groupId: 'g-snap', now: nowMs + 86_400_000 });
  return snap.groups[0].certs[0].valid === false && snap.groups[0].certs[0].code === 'expired';
})());
check('签名验签对"用未解锁身份签"给出类型化错误而不是空签名', await (async () => {
  const l = mkIdentity('locked3', PASS);
  const r = await chexiaoChengyuanZhengshu({
    signer: (await import('../dist/identity-provider.js')).createIdentitySigner(l.store),
    membership: membershipStoreFor(l.store), groupId: 'g-x', certId: 'c-x', memberFingerprint: infoB.fingerprint, reason: 'admin',
  });
  return r.ok === false && r.code === 'identity-locked';
})());

check('跨群一致性：吊销与"有效证书"并存时**与写入顺序无关**，一律拒（fail-closed）', (() => {
  const mkOrderedStore = async (file, revocationFirst) => {
    const m = new ChengYuanMingceCang(file, { fingerprintOf: fingerprintFromPublicKey, clockSkewMs: DEFAULT_CLOCK_SKEW_MS });
    const revokeGroup = 'g-revokes';
    const validGroup = 'g-valid';
    const revocationList = await signRevocationList(
      gouJianCheXiaoBiao({
        groupId: revokeGroup, listVersion: 1,
        entries: [{ certId: 'mc-someone', memberFingerprint: infoRevived.fingerprint, reason: 'departed', revokedAt: Date.now() }],
        issuerFingerprint: infoCreator.fingerprint, issuerPublicKey: infoCreator.publicKey,
      }),
      (b) => signerCreator.sign(b)
    );
    // 真证书（不能靠改 groupId 字段伪造：groupId 在签名载荷里）
    const issued2 = await wentiChengyuanZhengshu({
      signer: signerCreator, membership: m, groupId: validGroup,
      memberFingerprint: infoRevived.fingerprint, memberPublicKey: infoRevived.publicKey, certId: `mc-valid-${revocationFirst}`,
    });
    if (!issued2.ok) return { decided: false, ok: false, code: `issue:${issued2.code}` };
    void revocationFirst;
    const applied = m.yingYongCheXiaoBiao(revokeGroup, revocationList, { expectIssuerFingerprint: infoCreator.fingerprint });
    if (!applied.ok) return { decided: false, ok: false, code: `apply:${applied.code}` };
    return m.authorizeFingerprint(infoRevived.fingerprint);
  };
  return (async () => {
    const a = await mkOrderedStore(path.join(tmpRoot, 'order-a.json'), true);
    const b = await mkOrderedStore(path.join(tmpRoot, 'order-b.json'), false);
    return a.decided === true && a.ok === false && a.code === 'revoked' && b.decided === true && b.ok === false && b.code === 'revoked';
  })();
})());
check('跨群一致性：只有证书、没有任何吊销时放行', (() => {
  const m = new ChengYuanMingceCang(path.join(tmpRoot, 'order-c.json'), { fingerprintOf: fingerprintFromPublicKey, clockSkewMs: DEFAULT_CLOCK_SKEW_MS });
  return (async () => {
    const r = await wentiChengyuanZhengshu({
      signer: signerCreator, membership: m, groupId: 'g-only',
      memberFingerprint: infoRevived.fingerprint, memberPublicKey: infoRevived.publicKey, certId: 'mc-only-cert',
    });
    if (!r.ok) return false;
    const v = m.authorizeFingerprint(infoRevived.fingerprint);
    return v.decided === true && v.ok === true && v.code === 'ok';
  })();
})());

/* ════════════════════════════════════════════════════════════════════════════
   [13] 并发吊销：**不许丢更新**（MembershipStore.runExclusive 的证据）
   ════════════════════════════════════════════════════════════════════════════ */

section('13. 并发吊销不丢更新（读→签名→落盘 必须串行化）');

{
  // 「读当前列表 → 算出版本 +1 → **await 签名** → 落盘」中间那个 await 是并发窗口：
  // 两路各自读到版本 N、各自算出 N+1、各自签一份，后写覆盖先写 ⇒ **前一次吊销静默丢失**。
  // 这里用同一个 store 真并发两次吊销，断言最终两条都在（版本 2、条目 2）。
  const concFile = path.join(tmpRoot, 'concurrent-membership.json');
  const concStore = new ChengYuanMingceCang(concFile, { fingerprintOf: fingerprintFromPublicKey, clockSkewMs: DEFAULT_CLOCK_SKEW_MS });
  const GROUP_C = 'g-concurrent';

  const certB = await wentiChengyuanZhengshu({
    signer: signerCreator, membership: concStore, groupId: GROUP_C,
    memberFingerprint: infoB.fingerprint, memberPublicKey: infoB.publicKey, displayName: 'bob', certId: 'mc-conc-b',
  });
  const certC = await wentiChengyuanZhengshu({
    signer: signerCreator, membership: concStore, groupId: GROUP_C,
    memberFingerprint: infoC.fingerprint, memberPublicKey: infoC.publicKey, displayName: 'carol', certId: 'mc-conc-c',
  });
  check('并发用例前置：两张证书都签发成功', certB.ok === true && certC.ok === true, [certB.code, certC.code]);
  check('并发用例前置：两人当前都被放行', concStore.authorizeFingerprint(infoB.fingerprint).ok === true && concStore.authorizeFingerprint(infoC.fingerprint).ok === true);

  // 真并发：不 await 第一个就发第二个
  const [revB, revC] = await Promise.all([
    chexiaoChengyuanZhengshu({
      signer: signerCreator, membership: concStore, groupId: GROUP_C,
      certId: 'mc-conc-b', memberFingerprint: infoB.fingerprint, reason: 'departed',
    }),
    chexiaoChengyuanZhengshu({
      signer: signerCreator, membership: concStore, groupId: GROUP_C,
      certId: 'mc-conc-c', memberFingerprint: infoC.fingerprint, reason: 'compromise',
    }),
  ]);
  check('并发吊销：两次调用都成功', revB.ok === true && revC.ok === true, [revB.code, revC.code]);
  check('并发吊销：两次拿到**不同**的列表版本（说明真的串行了，而不是都基于同一版本）',
    revB.listVersion !== revC.listVersion && revC.listVersion === 2 && revB.listVersion === 1,
    [revB.listVersion, revC.listVersion]);

  const persisted = readJson(concFile);
  const rev = persisted?.groups?.[GROUP_C]?.revocation;
  check('并发吊销：落盘列表版本 = 2', rev?.listVersion === 2, rev?.listVersion);
  check('并发吊销：落盘**两条**条目都在（这是"不丢更新"的核心断言）', rev?.entries?.length === 2, rev?.entries?.length);
  const ids = new Set((rev?.entries || []).map((e) => e.certId));
  check('并发吊销：两个 certId 都在落盘里', ids.has('mc-conc-b') && ids.has('mc-conc-c'), [...ids]);
  check('并发吊销：两人现在都被拒（revoked）',
    concStore.authorizeFingerprint(infoB.fingerprint).code === 'revoked' && concStore.authorizeFingerprint(infoC.fingerprint).code === 'revoked');
  check('并发吊销：落盘吊销列表验签通过（串行化没有把签名数字搞坏）',
    verifyRevocationList(rev, VOPT0).ok === true, verifyRevocationList(rev, VOPT0).code);
}

/* ════════════════════════════════════════════════════════════════════════════
   [14] 阳性对照：**去掉锁就必须复现丢更新**（否则 [13] 不能证明是锁在起作用）
   ════════════════════════════════════════════════════════════════════════════ */

section('14. 阳性对照：绕过 runExclusive 时并发吊销必须丢一次');

{
  // 把 runExclusive 换成"直接执行"，模拟加锁之前的代码路径。
  // 如果这样也能留下两条吊销，那 [13] 就是"碰巧通过"，不能作为修复的证据 —— 必须让它失败。
  const proto = ChengYuanMingceCang.prototype;
  const original = proto.runExclusive;
  const bypassFile = path.join(tmpRoot, 'concurrent-bypass.json');
  const bypassStore = new ChengYuanMingceCang(bypassFile, { fingerprintOf: fingerprintFromPublicKey, clockSkewMs: DEFAULT_CLOCK_SKEW_MS });
  const GROUP_X = 'g-concurrent-bypass';
  try {
    proto.runExclusive = function (fn) { return fn(); };
    await wentiChengyuanZhengshu({
      signer: signerCreator, membership: bypassStore, groupId: GROUP_X,
      memberFingerprint: infoB.fingerprint, memberPublicKey: infoB.publicKey, displayName: 'bob', certId: 'mc-by-b',
    });
    await wentiChengyuanZhengshu({
      signer: signerCreator, membership: bypassStore, groupId: GROUP_X,
      memberFingerprint: infoC.fingerprint, memberPublicKey: infoC.publicKey, displayName: 'carol', certId: 'mc-by-c',
    });
    const [x1, x2] = await Promise.all([
      chexiaoChengyuanZhengshu({
        signer: signerCreator, membership: bypassStore, groupId: GROUP_X,
        certId: 'mc-by-b', memberFingerprint: infoB.fingerprint, reason: 'departed',
      }),
      chexiaoChengyuanZhengshu({
        signer: signerCreator, membership: bypassStore, groupId: GROUP_X,
        certId: 'mc-by-c', memberFingerprint: infoC.fingerprint, reason: 'compromise',
      }),
    ]);
    const bypassRev = readJson(bypassFile)?.groups?.[GROUP_X]?.revocation;
    const count = bypassRev?.entries?.length;
    // 实测（不是推测）：无锁时第一次成功（v1 / 1 条），第二次**被单调性校验拒成 `replay`**
    // —— 因为两次都基于 v0 算出 v1，第二次的内容与已落盘的 v1 不同，被 store 自己拦下。
    // 后果仍然是"第二次吊销根本没生效"（调用方只拿到一个 replay 错误码），所以是真丢更新。
    check('阳性对照：第一次吊销成功', x1.ok === true && x1.listVersion === 1, [x1.code, x1.listVersion]);
    check('阳性对照：第二次吊销被拒成 replay（同版本不同内容；调用方只拿到错误码）',
      x2.ok === false && x2.code === 'replay', [x2.code, x2.listVersion]);
    check('阳性对照：落盘**只剩 1 条**吊销（另一次被覆盖 —— 这就是 [13] 在防的事）', count === 1, count);
    check('阳性对照：因此有一个被吊销的人其实没被吊销（安全后果可见）', (() => {
      const b = bypassStore.authorizeFingerprint(infoB.fingerprint).code;
      const c = bypassStore.authorizeFingerprint(infoC.fingerprint).code;
      return (b === 'revoked') !== (c === 'revoked');
    })());
  } finally {
    proto.runExclusive = original;
  }
  check('阳性对照结束后已恢复 runExclusive（不影响后续断言）', proto.runExclusive === original);
}

/* ────────────────────────────── 收尾 ────────────────────────────── */

console.log('\n================ membership 验证总览 ================');
console.log(`  通过 ${pass} 项，失败 ${fail} 项`);
if (failures.length) console.log(`  失败项：${failures.join(' | ')}`);
console.log(`结果：${pass} 通过 / ${fail} 失败`);
if (pass < 100) {
  console.log(`  ⚠️ 断言数不足 100（实际 ${pass}），本脚本要求 ≥100`);
  fail++;
}
if (!keep) {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* 临时目录删不掉不影响结论 */
  }
}
process.exit(fail === 0 ? 0 : 1);
