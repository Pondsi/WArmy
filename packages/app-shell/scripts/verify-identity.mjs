/**
 * 身份层验证（ADR 003 附五 / 附五.1 / 附六）—— 可重跑
 *
 *   node scripts/verify-identity.mjs
 *
 * 覆盖：
 *   [1] 身份 = 公钥指纹（base32 + 校验位）；9 位 deviceId 降级为人读别名
 *   [2] 签发 → 验签，含串改内容 / 串改签名 / 截断 / 换钥匙 / 跨域 的负例
 *   [3] 身份名片：字段可空但**必须展示占位**（不能表现为"他隐藏了"）
 *   [4] 加密存储：落盘不得含私钥明文；没有 OS 保护又没口令时**拒绝落盘**
 *   [5] 口令保护：口令错打不开；启用口令后文件里没有 OS 旁路
 *   [6] 重启（**新 node 进程**）加载同一份数据，指纹一致、签名仍可用
 *   [7] 换证：新指纹生效、代次 +1、旧公钥仍能验旧签名、**声明里没有任何联系方式**（旧名片取自本机留存）
 *   [7b] 联系信息冻结期（本机侧）：换证后 7 天内改不了联系方式
 *   [7c] 接收方侧冻结：对端名片 7 天内不采用新值，7 天从**本机收到通知的时刻**起算
 *   [8] 代次规则：旧代次声明被拒；并**实测**"抢先换证"挡不住（诚实注明它只防回滚）
 *   [9] 备份导出 / 导入（附三 C6：凭证用户自持）
 *  [10] 不静默重建身份（文件损坏时绝不悄悄换一个身份）
 *
 * 关于 OS 钥匙串：验证脚本跑在纯 Node 里（没有 Electron），所以用 `--fixture-os`
 * 注入一个**显式替身**（AES-GCM 的假 KMS）来走"有 OS 保护"这条代码路径；
 * 同时脚本会断言真实 safeStorage 在此环境下**不可用**，以及"没有 OS 保护就必须设口令"。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  CONTACT_CARD_I18N,
  GENERATION_RULE_NOTE,
  IDENTITY_ALGO,
  ROTATION_SCHEMA,
  canonicalize,
  contactCardView,
  createIdentity,
  currentContactCard,
  exportIdentityCard,
  fingerprintFromPublicKey,
  fingerprintMatches,
  isContactCardEmpty,
  isValidFingerprint,
  keyObjectFromPrivateDer,
  keyRing,
  normalizeFingerprint,
  publicKeyOfPrivate,
  publicKeyToB64,
  signWithIdentity,
  verifyByFingerprint,
  verifyIdentityCard,
  verifyRevocationDeclaration,
  verifyRotationDeclaration,
  verifySignedPayload,
} from '../dist/identity.js';
import { IdentityStore, electronSafeStorageProtector, loadIdentity, nullProtector } from '../dist/identity-store.js';

const self = fileURLToPath(import.meta.url);
const argOf = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : '';
};

let failures = 0;
let total = 0;
function check(label, cond, detail) {
  total++;
  const mark = cond ? 'PASS' : 'FAIL';
  if (!cond) failures++;
  const d = detail === undefined ? '' : ` => ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
  console.log(`  [${mark}] ${label}${d}`);
}
function section(title) {
  console.log(`\n${title}`);
}

/** 替身 OS 钥匙串：真 safeStorage 是 DPAPI / Keychain（不可导出），这里用 AES-GCM 假 KMS 走同一条代码路径 */
function fixtureProtector(tag = 'fixture-os') {
  const key = crypto.createHash('sha256').update(`ccarmy-fixture-os|${tag}`).digest();
  const head = `${tag}|`;
  return {
    available: () => true,
    label: () => `fixture-os(${tag})`,
    protect: (plain) => {
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', key, iv);
      const ct = Buffer.concat([c.update(plain), c.final()]);
      return Buffer.concat([Buffer.from(head, 'utf8'), iv, c.getAuthTag(), ct]);
    },
    unprotect: (buf) => {
      const raw = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf), 'base64');
      if (raw.subarray(0, head.length).toString('utf8') !== head) throw new Error('fixture protector: bad tag');
      const iv = raw.subarray(head.length, head.length + 12);
      const tagBuf = raw.subarray(head.length + 12, head.length + 28);
      const ct = raw.subarray(head.length + 28);
      const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
      d.setAuthTag(tagBuf);
      return Buffer.concat([d.update(ct), d.final()]);
    },
  };
}

const t = (k, fb) => {
  const D = {
    'identity.contact.email': '邮箱',
    'identity.contact.phone': '手机号',
    'identity.contact.extra': '其它',
    'identity.contact.unfilled': '未填写',
    'identity.contact.title': '联系方式',
    'identity.contact.alwaysVisible': '加入群/项目、加联系人时，对方一定看得到你的联系方式（可以不写）',
  };
  return D[k] ?? fb ?? k;
};

/** 扮演"手里拿着旧私钥的人"：按同一规范化规则重新签名（负例必须重签，否则先被签名检查拦下） */
function resignWithOldKey(draft, oldPrivateDer) {
  const { signature: _drop, ...rest } = draft;
  const priv = crypto.createPrivateKey({ key: oldPrivateDer, format: 'der', type: 'pkcs8' });
  const sig = crypto.sign(null, Buffer.from(`${ROTATION_SCHEMA}\n${canonicalize(rest)}`, 'utf8'), priv).toString('base64');
  return { ...rest, signature: sig };
}

// ── 子进程阶段：模拟"重启后仍能认出自己" ──
if (argOf('--phase') === 'restart') {
  const file = argOf('--file');
  const pass = argOf('--pass');
  const expectFp = argOf('--expect-fp');
  const expectAlias = argOf('--expect-alias');
  const expectGen = Number(argOf('--expect-gen'));
  const expectEmail = argOf('--expect-email');
  const derHex = argOf('--expect-nokey-hex');

  const store = new IdentityStore(file, { protector: fixtureProtector('fixture-os') });
  const info = store.info();
  check('新进程读到身份', !!info, info && info.fingerprint);
  check('指纹与上次一致（认得出自己）', !!info && fingerprintMatches(info.fingerprint, expectFp), info?.fingerprint);
  check('人读别名保留（9 位 deviceId 兼容）', info?.alias === expectAlias, { got: info?.alias, want: expectAlias });
  check('代次保留', info?.generation === expectGen, info?.generation);
  check('名片保留', info?.contactCard?.email === expectEmail, info?.contactCard);
  const lk = store.load(pass);
  if (!lk.ok) {
    check('新进程用口令解开私钥', false, lk);
  } else {
    check('新进程用口令解开私钥', true);
    const signed = store.sign('restart-sign-1');
    const vr = signed.ok ? store.verify(signed.signed.payload, signed.signed.signature) : { ok: false };
    check('新进程签发的签名在本进程可验', vr.ok === true, vr);
    const raw = fs.readFileSync(file, 'utf8');
    check('落盘仍无旧私钥明文（PKCS8 hex）', !raw.includes(derHex));
    check('落盘无 PEM 私钥标记', !raw.includes('PRIVATE KEY'));
  }
  console.log(`\n[重启阶段] ${failures === 0 ? '全部通过' : `${failures} 项失败`}（${total} 项检查）`);
  process.exit(failures === 0 ? 0 : 1);
}

// ── 主流程 ──
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ccarmy-identity-'));
const file = path.join(tmpRoot, 'identity', 'identity.json');
console.log(`工作目录: ${tmpRoot}`);
console.log(`身份文件: ${file}`);

/** 落盘文本里绝不能出现这些形态的私钥 */
function scanNoPlaintextKey(filePath, der, label) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const forms = {
    'base64': der.toString('base64'),
    'base64url': der.toString('base64url'),
    'hex': der.toString('hex'),
    'PEM': 'PRIVATE KEY',
  };
  for (const [name, needle] of Object.entries(forms)) {
    check(`${label}：文件不含私钥 ${name} 形态`, !raw.includes(needle));
  }
  return raw;
}

// ── [1] 身份 = 公钥指纹 ──
section('[1] 身份以公钥指纹为准（deviceId 降为人读别名）');
const ALIAS = '375102948';
const OLD_CARD = { email: 'laowang@example.com', phone: '13800138000' };
const fresh = createIdentity({ alias: ALIAS, contactCard: OLD_CARD });
const fp = fresh.identity.fingerprint;
console.log(`      指纹: ${fp}`);
check('指纹形态合法（base32 + 校验位）', isValidFingerprint(fp), fp);
check('指纹为 4 组 × 5 位', /^[0-9A-Z]{5}(-[0-9A-Z]{5}){3}$/.test(fp), fp);
check('指纹长度 = 20 位（19 数据 + 1 校验）', normalizeFingerprint(fp).length === 20, normalizeFingerprint(fp).length);
check('公钥→指纹是确定性的', fingerprintFromPublicKey(fresh.keyPair.publicKeyB64) === fp);
check('归一大写/无分隔符仍匹配', fingerprintMatches(fp.toLowerCase().replace(/-/g, ''), fp));
check('忽略形近字（I/L→1、O→0）后仍匹配', fingerprintMatches(normalizeFingerprint(fp).replace(/1/g, 'I').replace(/0/g, 'O'), fp));
const FPR_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
// 改动 1 位数据 → 校验位对不上的比例（校验位是数据位的确定性函数，31 个候选中预期 ~30 个被拒）
const mutated = FPR_ALPHABET.split('')
  .filter((ch) => ch !== normalizeFingerprint(fp)[3])
  .map((ch) => normalizeFingerprint(fp).slice(0, 3) + ch + normalizeFingerprint(fp).slice(4));
const rejected = mutated.filter((m) => !isValidFingerprint(m)).length;
check('串改 1 位数据 → 校验位拦下绝大多数（≥25/31）', rejected >= 25, `${rejected}/${mutated.length} 被拒`);
const tamperCheck = normalizeFingerprint(fp).slice(0, 19) + (normalizeFingerprint(fp)[19] === 'Z' ? '0' : 'Z');
check('串改校验位 → 拒绝', isValidFingerprint(tamperCheck) === false, tamperCheck);
check('别名 = 9 位 deviceId（兼容保留）', fresh.identity.alias === ALIAS, fresh.identity.alias);
check('代次初始为 1', fresh.identity.generation === 1, fresh.identity.generation);
const other = createIdentity({ alias: '111111111' });
check('两个身份指纹不同', other.identity.fingerprint !== fp, { a: fp, b: other.identity.fingerprint });
check('算法为 Ed25519（Node 内置，无新依赖）', fresh.identity.algo === IDENTITY_ALGO && IDENTITY_ALGO === 'Ed25519');

// ── [2] 签发 / 验签（含负例） ──
section('[2] 签发 → 验签（含串改内容的负例）');
const ring = keyRing(fresh.identity);
const signed = signWithIdentity(fresh.keyPair.privateKey, fresh.identity, '把周报整理好 #1');
check('签发信封带指纹与代次', signed.fingerprint === fp && signed.generation === 1, signed.fingerprint);
check('按指纹验签通过', verifyByFingerprint(fp, '把周报整理好 #1', signed.signature, ring).ok === true);
check('命中当前密钥（matched=current）', verifyByFingerprint(fp, '把周报整理好 #1', signed.signature, ring).matched === 'current');
check('信封整体验签通过', verifySignedPayload(signed, ring).ok === true);
check('信封 JSON 往返后仍可验', verifySignedPayload(JSON.parse(JSON.stringify(signed)), ring).ok === true);
const tampered = verifyByFingerprint(fp, '把周报整理好 #2', signed.signature, ring);
check('串改内容 → 验签失败（bad-signature）', tampered.ok === false && tampered.reason === 'bad-signature', tampered);
const tamperedEnv = verifySignedPayload({ ...signed, payload: '把周报整理好 #1（被改）' }, ring);
check('串改信封载荷 → 验签失败', tamperedEnv.ok === false && tamperedEnv.reason === 'bad-signature', tamperedEnv.reason);
const sigBuf = Buffer.from(signed.signature, 'base64');
sigBuf[0] ^= 0xff;
check('串改签名字节 → 验签失败', verifyByFingerprint(fp, '把周报整理好 #1', sigBuf.toString('base64'), ring).ok === false);
const shortSig = verifyByFingerprint(fp, '把周报整理好 #1', sigBuf.subarray(0, 32).toString('base64'), ring);
check('截断签名 → 明确报"应为 64 字节"', shortSig.ok === false && /64/.test(shortSig.detail || ''), shortSig.detail);
check('换了钥匙（别人的密钥环）→ unknown-fingerprint', verifyByFingerprint(fp, '把周报整理好 #1', signed.signature, keyRing(other.identity)).reason === 'unknown-fingerprint');
check('指纹形态非法 → malformed', verifyByFingerprint('NOT-A-FINGERPRINT', 'x', signed.signature, ring).reason === 'malformed');
check('跨域签名不互认（域分隔生效）', verifyByFingerprint(fp, '把周报整理好 #1', signed.signature, ring, { domain: 'ccarmy.other.v1' }).ok === false);
check('规范化是确定性的（同一对象两次序列化一致）', canonicalize({ b: [1, 2], a: 'x' }) === canonicalize({ a: 'x', b: [1, 2] }), canonicalize({ b: [1, 2], a: 'x' }));

// ── [3] 身份名片 ──
section('[3] 身份名片：可空，但必须展示占位');
const viewFull = contactCardView(OLD_CARD, t);
check('有邮箱 → email 填充', viewFull.fields.find((f) => f.key === 'email')?.filled === true);
check('有手机号 → phone 填充', viewFull.fields.find((f) => f.key === 'phone')?.filled === true);
const viewOne = contactCardView({ email: 'only@example.com' }, t);
const phoneField = viewOne.fields.find((f) => f.key === 'phone');
check('空字段仍然出现（不被删掉）', !!phoneField, viewOne.fields.map((f) => f.key));
check('空字段展示占位"未填写"', phoneField?.placeholder === true && phoneField?.value === '未填写', phoneField);
check('空字段的占位≠"隐藏"（占位来自 i18n 键）', CONTACT_CARD_I18N.unfilled === 'identity.contact.unfilled');
const viewEmpty = contactCardView(undefined, t);
check('完全没有名片 → 两个字段都是占位', viewEmpty.fields.length === 2 && viewEmpty.unfilledCount === 2 && viewEmpty.anyFilled === false, viewEmpty.unfilledCount);
check('名片"不可隐藏但可以不写"标志位', viewEmpty.alwaysVisible === true && viewEmpty.alwaysVisibleNote.length > 0, viewEmpty.alwaysVisibleNote);
check('可选其它联系方式也能展示', contactCardView({ extra: [{ label: '备用邮箱', value: 'b@x.com' }] }, t).fields.some((f) => f.key.startsWith('extra:') && f.filled));
check('空卡判定：{} 视为空', isContactCardEmpty({}) === true && isContactCardEmpty({ email: '   ' }) === true);
check('currentContactCard 返回身份里的名片', currentContactCard(fresh.identity).phone === '13800138000');
const card = exportIdentityCard(fresh.identity, fresh.keyPair.privateKey);
check('名片自签可验', verifyIdentityCard(card).ok === true);
check('名片被改（别名）→ 验签失败', verifyIdentityCard({ ...card, alias: '冒名者' }).ok === false);
check('名片被改（联系方式）→ 验签失败', verifyIdentityCard({ ...card, contactCard: { ...card.contactCard, email: 'attacker@x.com' } }).ok === false);

// ── [4] 加密存储 ──
section('[4] 私钥加密落盘（不含明文；没有保护就拒绝落盘）');
check('纯 Node 环境真实 safeStorage 不可用', electronSafeStorageProtector().available() === false, electronSafeStorageProtector().label());
const noProt = new IdentityStore(path.join(tmpRoot, 'bare', 'identity.json'), { protector: nullProtector() });
const refuse = noProt.ensureIdentity('000000001', {});
check('无 OS 保护 + 无口令 → 拒绝落盘（不写 base64 明文）', refuse.ok === false && refuse.error === 'no-protection-available', refuse);
check('拒绝后磁盘上确实没有身份文件', !fs.existsSync(path.join(tmpRoot, 'bare', 'identity.json')));

const auditOps = [];
const store = new IdentityStore(file, { protector: fixtureProtector('fixture-os'), onAudit: (op, detail) => auditOps.push({ op, detail }) });
const created = store.ensureIdentity(ALIAS, OLD_CARD);
check('首次运行即生成身份（ensureIdentity）', created.ok === true && created.created === true, created.ok && created.info.fingerprint);
const info1 = store.info();
const der1 = store.load().privateKeyDer;
let raw = scanNoPlaintextKey(file, der1, '生成后');
const parsed1 = JSON.parse(raw);
check('文件里有加密后的私钥段（ct/tag/iv）', !!parsed1.keys?.privateKey?.ct && !!parsed1.keys?.privateKey?.tag && !!parsed1.keys?.privateKey?.iv);
check('私钥密文与明文不同（确实加密了）', parsed1.keys.privateKey.ct !== der1.toString('base64'));
check('OS 包裹存在（safeStorage 路径）', typeof parsed1.keys.dekOs === 'string' && !!parsed1.keys.dekOs);
check('文件里没有明文 DEK 字段', !Object.keys(parsed1.keys).includes('dek'));
check('info() 不含私钥字段（渲染进程只能看到公开部分）', !('privateKey' in info1) && !('privateKeyDer' in info1) && typeof info1.publicKey === 'string');
check('换一台机器（无 OS 保护）读同一文件 → 打不开私钥', new IdentityStore(file, { protector: nullProtector() }).load().error === 'no-protection-available');
const s1 = store.sign('statement-from-os-mode');
check('OS 模式可直接签发', s1.ok === true);
check('OS 模式的签名可验', store.verify(s1.signed.payload, s1.signed.signature).ok === true);

// loadIdentity()：应用启动路径上的单入口（首次运行即生成 + 解开私钥）
const wrapperFile = path.join(tmpRoot, 'wrapper', 'identity.json');
const l1 = loadIdentity(wrapperFile, { protector: fixtureProtector('fixture-os'), createIfMissing: { alias: '900000001', contactCard: { phone: '13700137000' } } });
check('loadIdentity() 首次调用即生成并解开', l1.ok === true && isValidFingerprint(l1.identity.fingerprint), l1.ok ? l1.identity.fingerprint : l1.error);
const l2 = loadIdentity(wrapperFile, { protector: fixtureProtector('fixture-os'), createIfMissing: { alias: '000000000' } });
check('loadIdentity() 第二次调用读回同一身份（不会重建）', l2.ok === true && l2.identity.fingerprint === l1.identity.fingerprint, l2.ok ? l2.identity.fingerprint : l2.error);
check('loadIdentity() 保留原别名与名片', l2.ok && l2.identity.alias === '900000001' && l2.identity.contactCard.phone === '13700137000');
check('loadIdentity() 交出的私钥不在盘上', !fs.readFileSync(wrapperFile, 'utf8').includes(l1.privateKeyDer.toString('base64')));

// ── [5] 口令保护 ──
section('[5] 口令保护（口令错打不开；启用后没有 OS 旁路）');
const PASS = 'correct horse battery staple';
const shortPw = store.setPassphrase('123');
check('口令过短被拒（>=8）', shortPw.ok === false, shortPw.error);
const setPw = store.setPassphrase(PASS);
check('启用口令保护', setPw.ok === true && setPw.info.passphraseProtected === true, setPw.ok ? setPw.info.passphraseProtected : setPw.error);
const parsed2 = JSON.parse(fs.readFileSync(file, 'utf8'));
check('启用口令后 OS 包裹被移除（偷到文件不够）', parsed2.keys.dekOs === null && !!parsed2.keys.dekPass, { dekOs: parsed2.keys.dekOs });
check('口令包裹记录 scrypt 参数', parsed2.keys.dekPass.kdf === 'scrypt' && parsed2.keys.dekPass.N >= 16384, { N: parsed2.keys.dekPass.N, r: parsed2.keys.dekPass.r });
scanNoPlaintextKey(file, der1, '启用口令后');

const locked = new IdentityStore(file, { protector: nullProtector() });
check('无口令调用 → 明确要求口令（passphrase-required）', locked.load().error === 'passphrase-required');
check('口令错 → 打不开（bad-passphrase）', locked.load('wrong passphrase here').error === 'bad-passphrase');
check('口令错时不签发（不静默用别的路径）', locked.sign('x').ok === false, locked.sign('x').error);
check('unlockState 报告需要口令', locked.unlockState().needsPassphrase === true && locked.unlockState().unlocked === false);
const opened = locked.load(PASS);
check('口令对 → 解开私钥', opened.ok === true);
check('解开的私钥推得出同一把公钥（私钥与指纹自洽）', (() => {
  if (!opened.ok) return false;
  const pub = publicKeyToB64(publicKeyOfPrivate(keyObjectFromPrivateDer(opened.privateKeyDer)));
  return pub === info1.publicKey;
})());
const lockedSign = locked.sign('statement-from-passphrase-mode', { passphrase: PASS });
check('口令模式下可签发', lockedSign.ok === true);
check('口令模式的签名可验', lockedSign.ok && locked.verify(lockedSign.signed.payload, lockedSign.signed.signature).ok === true);

// ── [6] 重启后仍能认出自己（新进程） ──
section('[6] 重启（新 node 进程）仍能认出自己');
const childOut = execFileSync(
  process.execPath,
  [
    self,
    '--phase', 'restart',
    '--file', file,
    '--pass', PASS,
    '--expect-fp', info1.fingerprint,
    '--expect-alias', ALIAS,
    '--expect-gen', '1',
    '--expect-email', 'laowang@example.com',
    '--expect-nokey-hex', der1.toString('hex'),
  ],
  { encoding: 'utf8' },
);
console.log(childOut.trimEnd());
check('子进程（重启）阶段全部通过', !childOut.includes('[FAIL]'));

// ── [7] 换证 ──
section('[7] 换证：新指纹 / 代次 +1 / 旧公钥仍验旧签名 / 声明里没有联系方式');
const NEW_CARD = { email: 'new-mail@example.com', phone: '' }; // 换证后（过了冻结期）才允许改的新名片
const oldRing = store.keyRing();
const oldPrivDer = store.load(PASS).privateKeyDer;
const oldFp = store.info().fingerprint;
const oldPub = store.info().publicKey;
const sigOld = store.sign('换证前签的旧内容 #1', { passphrase: PASS }).signed;
const rotAt = Date.now();
const rot = store.rotate({ reason: 'leak-suspected', passphrase: PASS });
check('换证成功', rot.ok === true, rot.ok ? '' : rot.error);
const info2 = store.info();
check('新指纹生效（与旧指纹不同）', info2.fingerprint !== oldFp, { old: oldFp, new: info2.fingerprint });
check('代次 +1（1 → 2）', info2.generation === 2, info2.generation);
check('旧公钥进入退役列表（保公钥、丢私钥）', info2.retiredKeys.some((r) => fingerprintMatches(r.fingerprint, oldFp) && r.publicKey === oldPub), info2.retiredKeys.map((r) => r.fingerprint));
const ring2 = store.keyRing();
const vrOld = verifyByFingerprint(oldFp, '换证前签的旧内容 #1', sigOld.signature, ring2);
check('旧公钥仍可验证换证前的旧签名', vrOld.ok === true && vrOld.matched === 'retired', vrOld);
check('新公钥可验证换证后的新签名', (() => {
  const s = store.sign('换证后签的新内容 #2', { passphrase: PASS });
  return s.ok && store.verify(s.signed.payload, s.signed.signature).ok === true;
})());
const decl = rot.declaration;
check('声明由旧私钥签名（signerFingerprint = 旧指纹）', decl.signerFingerprint === oldFp && decl.oldFingerprint === oldFp, decl.signerFingerprint);
check('声明里携带新公钥与新指纹', fingerprintMatches(fingerprintFromPublicKey(decl.newPublicKey), decl.newFingerprint), decl.newFingerprint);
// ⚠️ 需求更正：换证声明**不得携带任何联系方式**（声明是攻击者可控数据，旧名片只能取自本机留存）
const declKeys = Object.keys(decl);
const declText = JSON.stringify(decl);
check('声明只有「公钥+代次+时间戳+签名」这些字段（无名片字段）', !declKeys.some((k) => /contact|card|email|phone/i.test(k)), declKeys);
check('声明的序列化文本里既没有旧名片值也没有新名片值', !/laowang@example\.com|new-mail@example\.com|13800138000/.test(declText), declText.slice(0, 80) + '…');
check('旧联系方式改由本机留存历史提供', store.contactCardHistory().some((v) => v.card.email === 'laowang@example.com' && v.card.phone === '13800138000'), store.contactCardHistory().map((v) => `${v.note}:${v.card.email}`));
check('rotate() 返回的 previousCard 取自本机留存（不是声明）', rot.previousCard.email === 'laowang@example.com' && rot.previousCard.phone === '13800138000', rot.previousCard);
check('换证不改动当前名片（要改也得等冻结期过）', info2.contactCard.email === 'laowang@example.com', info2.contactCard);
check('换证开启 7 天联系信息冻结期', info2.contactFrozen === true && Math.abs(info2.contactFreezeUntil - (rotAt + 7 * 24 * 3600_000)) < 5000, { until: info2.contactFreezeUntil, expect: rotAt + 7 * 24 * 3600_000 });
const rev = store.acceptRotation(decl, { knownKeys: oldRing, currentGeneration: 1 });
check('迁移声明验签通过 + 代次规则接受', rev.accepted === true, rev);
check('验签结果带 warnings 字段（TOFU/代次跳跃提示）', Array.isArray(rev.warnings));
check('验签结果**必须**带"只防回滚不防抢占"的诚实说明', rev.honestNote === GENERATION_RULE_NOTE && rev.honestNote.includes('不防抢先'), rev.honestNote.slice(0, 40) + '…');
check('时间线记下换证（不含联系方式，指向本机留存）', store.timeline().some((e) => e.op === 'identity.rotate' && e.detail.previousCardSource === 'local-history' && !('previousContactCard' in e.detail)), store.timeline().map((e) => e.op));
const rawAfter = fs.readFileSync(file, 'utf8');
check('换证后旧私钥确实不在盘上（丢私钥）', !rawAfter.includes(oldPrivDer.toString('base64')) && !rawAfter.includes(oldPrivDer.toString('hex')));
check('换证后新私钥也不在盘上（仍是密文）', !rawAfter.includes(store.load(PASS).privateKeyDer.toString('base64')));
check('旧公钥明文保留在盘上（保公钥）', rawAfter.includes(oldPub));
const badDecl1 = verifyRotationDeclaration({ ...decl, reason: '被改了' }, { knownKeys: oldRing, currentGeneration: 1 });
check('串改声明的字段 → 签名不通过', badDecl1.accepted === false && badDecl1.reason === 'bad-signature', badDecl1.reason);
// 即使用旧私钥**重新签名**，也不能把联系方式塞进声明（规则显式拒绝）
const smuggled = verifyRotationDeclaration(resignWithOldKey({ ...decl, previousContactCard: { email: 'attacker@x.com' } }, oldPrivDer), { knownKeys: oldRing, currentGeneration: 1 });
check('🛡 即使重签，携带联系方式的声明也被拒（contact-not-allowed）', smuggled.accepted === false && smuggled.reason === 'contact-not-allowed', smuggled);
const badDecl2 = verifyRotationDeclaration(resignWithOldKey({ ...decl, generation: 1, previousGeneration: 1 }, oldPrivDer), { knownKeys: oldRing, currentGeneration: 1 });
check('声明代次未递增 → 拒绝', badDecl2.accepted === false && badDecl2.reason === 'generation-not-increasing', badDecl2.reason);
const badDecl3 = verifyRotationDeclaration(resignWithOldKey({ ...decl, issuedAt: Date.now() + 3600_000 }, oldPrivDer), { knownKeys: oldRing, currentGeneration: 1 });
check('声明时间戳在未来 → 拒绝（重签也拦得住）', badDecl3.accepted === false && badDecl3.reason === 'timestamp-in-future', badDecl3.reason);
const badDecl4 = verifyRotationDeclaration({ ...decl, newPublicKey: other.keyPair.publicKeyB64 }, { knownKeys: oldRing, currentGeneration: 1 });
check('声明的公钥与指纹不一致 → 拒绝', badDecl4.accepted === false && badDecl4.reason === 'fingerprint-mismatch', badDecl4.reason);
check('作废声明（旧的作废）可验', verifyRevocationDeclaration(rot.revocation).accepted === true);
check('串改作废声明 → 拒绝', verifyRevocationDeclaration({ ...rot.revocation, supersededBy: 'X' }).accepted === false);
check('作废声明带诚实说明（拦不住持有旧私钥的人）', verifyRevocationDeclaration(rot.revocation).honestNote.includes('不能'));
check('生成与换证都写入了本地审计（附五.1 第二层：时间线可重建）', auditOps.some((a) => a.op === 'identity.create') && auditOps.some((a) => a.op === 'identity.rotate' && a.detail?.previousCardSource === 'local-history'), auditOps.map((a) => a.op));

// ── [7b] 冻结期：本机在换证后 7 天内不得改联系方式 ──
section('[7b] 联系信息冻结期（本机侧）：换证后 7 天内改不了联系方式');
check('冻结状态可导出（contactFreezeUntil / frozen）', store.contactFreeze().frozen === true && store.contactFreeze().remainingMs > 6 * 24 * 3600_000, store.contactFreeze().remainingMs);
check('冻结期说明写明"从本机收到通知起算、不自动采用、不能阻止抢占"', store.contactFreeze().note.includes('本机') && store.contactFreeze().note.includes('不会自动采用') && store.contactFreeze().note.includes('不能阻止抢占'));
const frozenUpd = store.setContactCard(NEW_CARD);
check('🛡 冻结期内改名片被拒（contact-frozen）', frozenUpd.ok === false && frozenUpd.error === 'contact-frozen', frozenUpd);
check('被拒时回传冻结截止与剩余时间（UI 能解释原因）', typeof frozenUpd.contactFreezeUntil === 'number' && frozenUpd.remainingMs > 0, { until: frozenUpd.contactFreezeUntil, left: frozenUpd.remainingMs });
check('被拒不写入审计' + '（写的是冻结拦截记录）', auditOps.some((a) => a.op === 'identity.card.frozen'));
check('冻结期内名片没有被改动', store.info().contactCard.email === 'laowang@example.com', store.info().contactCard);
// 冻结到期后（注入 now）允许修改，且旧值仍在本机历史里
const afterFreeze = store.setContactCard(NEW_CARD, { now: info2.contactFreezeUntil + 1000 });
check('冻结期满后可以改名片', afterFreeze.ok === true, afterFreeze.ok ? afterFreeze.info.contactCard : afterFreeze.error);
check('改名片后冻结标记清除', store.info().contactFrozen === false && store.info().contactFreezeUntil === 0);
check('改名片不动指纹与代次', fingerprintMatches(store.info().fingerprint, info2.fingerprint) && store.info().generation === 2, store.info().generation);
check('旧名片仍留在本机历史里（横幅能并列展示旧/新）', (() => {
  const h = store.contactCardHistory();
  return h.some((v) => v.card.email === 'laowang@example.com') && h.some((v) => v.card.email === 'new-mail@example.com');
})(), store.contactCardHistory().map((v) => `${v.note}:${v.card.email}`));
check('空联系方式在名片视图里仍显示占位', contactCardView(store.currentContactCard(), t).fields.every((f) => f.filled || f.value === '未填写'));

// ── [7c] 接收方侧冻结：对端名片 7 天内不采用新值（本机各自判定） ──
section('[7c] 接收方侧冻结（本机各自判定；不依赖任何人广播的"冻结中"标志）');
const peerFp = store.info().fingerprint; // 拿本机指纹当"对端"演示：逻辑与对端完全一样
const peerOld = { email: 'peer-old@example.com', phone: '13500135000' };
const joinView = store.recordPeerCard(peerFp, peerOld);
check('首次加入：直接留存，不冻结（新人要能填联系方式）', joinView.frozen === false && joinView.effectiveCard.email === 'peer-old@example.com', joinView);
// 收到换证通知：7 天**从本机收到通知的时刻**起算
const peerNow = 1_800_000_000_000; // 固定的"本机此刻"，便于断言
const longAgoDecl = resignWithOldKey({ ...decl, issuedAt: peerNow - 2 * 365 * 24 * 3600_000 }, oldPrivDer);
const futureDecl = resignWithOldKey({ ...decl, issuedAt: peerNow + 1000 }, oldPrivDer);
const afterNotify = store.recordPeerRotation(longAgoDecl, peerNow);
check('收到换证通知 → 冻结', afterNotify.frozen === true, { until: afterNotify.contactFreezeUntil, receivedAt: afterNotify.receivedAt });
check('7 天从本机收到通知起算（**不用**声明里两年前的时间戳）', afterNotify.contactFreezeUntil === peerNow + 7 * 24 * 3600_000, { until: afterNotify.contactFreezeUntil, expect: peerNow + 7 * 24 * 3600_000 });
const afterNotify2 = store.recordPeerRotation(futureDecl, peerNow);
check('声明里的时间戳是"未来"也一样（本机时钟说了算）', afterNotify2.contactFreezeUntil === peerNow + 7 * 24 * 3600_000, afterNotify2.contactFreezeUntil);
const held = store.recordPeerCard(peerFp, { email: 'peer-new@example.com', phone: '' }, peerNow + 1000);
check('冻结期内收到新名片 → 只记为 pending（不采用）', held.pendingCard?.email === 'peer-new@example.com' && held.effectiveCard.email === 'peer-old@example.com', { pending: held.pendingCard, effective: held.effectiveCard });
check('旧/新名片是两个分开的字段（UI 可并列展示）', held.previousCard.email === 'peer-old@example.com' && held.pendingCard.email === 'peer-new@example.com');
check('视图明确标注"当前用的是本机留存值"', held.usingStoredHistory === true && held.pendingIsHeldBack === true, { usingStoredHistory: held.usingStoredHistory, held: held.pendingIsHeldBack });
check('空字段在新名片里也能展示占位', contactCardView(held.pendingCard, t).fields.find((f) => f.key === 'phone')?.value === '未填写');
const stillFrozenConfirm = store.confirmPeerCard(peerFp, peerNow + 1000);
check('冻结期内"确认采用"不生效（如实回绝）', stillFrozenConfirm.frozen === true && stillFrozenConfirm.effectiveCard.email === 'peer-old@example.com', stillFrozenConfirm.effectiveCard);
check('被回绝的确认写入审计（still-frozen）', auditOps.some((a) => a.op === 'identity.peer.confirm.rejected'));
const stillFrozen = store.peerContact(peerFp, peerNow + 6 * 24 * 3600_000);
check('第 6 天仍冻结（未采用新名片）', stillFrozen.frozen === true && stillFrozen.effectiveCard.email === 'peer-old@example.com', stillFrozen.effectiveCard);
const stillFrozenConfirm2 = store.confirmPeerCard(peerFp, peerNow + 6 * 24 * 3600_000);
check('第 6 天"确认采用"仍不生效（差 1 天也不行）', stillFrozenConfirm2.frozen === true && stillFrozenConfirm2.effectiveCard.email === 'peer-old@example.com', stillFrozenConfirm2.effectiveCard);
const afterExpiry = store.peerContact(peerFp, peerNow + 7 * 24 * 3600_000 + 1);
check('第 7 天+1ms：冻结到期，但**不自动采用**新值（等手动确认）', afterExpiry.frozen === false && afterExpiry.awaitingConfirmation === true && afterExpiry.effectiveCard.email === 'peer-old@example.com', { effective: afterExpiry.effectiveCard, awaiting: afterExpiry.awaitingConfirmation });
check('待确认时新名片仍在 pending 字段里（UI 可提示"需要你手动确认"）', afterExpiry.pendingCard?.email === 'peer-new@example.com' && afterExpiry.usingStoredHistory === true, afterExpiry.pendingCard);
const confirmed = store.confirmPeerCard(peerFp, peerNow + 7 * 24 * 3600_000 + 2000);
check('手动确认后才采用新名片', confirmed.effectiveCard.email === 'peer-new@example.com' && confirmed.awaitingConfirmation === false && confirmed.pendingCard === null, confirmed.effectiveCard);
check('确认动作写入审计', auditOps.some((a) => a.op === 'identity.peer.confirm'));
const peerRestart = new IdentityStore(file, { protector: fixtureProtector('fixture-os') });
check('对端状态已落盘（换进程读得到，本机判定不靠内存）', peerRestart.peerContact(peerFp, peerNow + 7 * 24 * 3600_000 + 3000)?.effectiveCard.email === 'peer-new@example.com', peerRestart.peerContact(peerFp).effectiveCard);
check('对端旁路文件不含任何私钥', !fs.readFileSync(path.join(tmpRoot, 'identity', 'peer-contacts.json'), 'utf8').includes(store.load(PASS).privateKeyDer.toString('base64')));

// ── [8] 代次规则：只防回滚，不防抢占 ──
section('[8] 代次规则（旧代次被拒；并实测"抢先换证"挡不住）');
/** 扮演"手里拿着旧私钥的人"：用旧私钥手搓一条任意代次的合法声明 */
function forgeRotation(oldPrivateDer, oldFingerprint, oldPublicKey, newFp, newPub, generation, previousGeneration) {
  const draft = {
    schema: ROTATION_SCHEMA,
    kind: 'ccarmy.identity.rotation',
    version: 1,
    algo: IDENTITY_ALGO,
    oldFingerprint,
    oldPublicKey,
    previousGeneration,
    newFingerprint: newFp,
    newPublicKey: newPub,
    generation,
    issuedAt: Date.now(),
    // 声明里不允许出现任何名片/联系方式字段（攻击者也不能顺带塞进来）
    signerFingerprint: oldFingerprint,
  };
  const priv = crypto.createPrivateKey({ key: oldPrivateDer, format: 'der', type: 'pkcs8' });
  const sig = crypto.sign(null, Buffer.from(`${ROTATION_SCHEMA}\n${canonicalize(draft)}`, 'utf8'), priv).toString('base64');
  return { ...draft, signature: sig };
}
const stolen = forgeRotation(oldPrivDer, oldFp, oldPub, other.identity.fingerprint, other.identity.publicKey, 2, 1);
check('（前提取证）攻击者用旧私钥手搓的声明签名本身是合法的', verifyRotationDeclaration(stolen, { currentGeneration: 1 }).accepted === true);
const stale = verifyRotationDeclaration(stolen, { knownKeys: ring2, currentGeneration: 2 });
check('🛡 旧代次（=2，已知代次 2）声明被拒绝', stale.accepted === false && stale.reason === 'stale-generation', stale);
console.log(`      拒绝原因: ${stale.detail}`);
const lower = verifyRotationDeclaration(forgeRotation(oldPrivDer, oldFp, oldPub, other.identity.fingerprint, other.identity.publicKey, 1, 1), { currentGeneration: 2 });
check('🛡 更低代次（1）声明被拒绝', lower.accepted === false, lower.reason);
const preempt = forgeRotation(oldPrivDer, oldFp, oldPub, other.identity.fingerprint, other.identity.publicKey, 3, 2);
const preemptRes = verifyRotationDeclaration(preempt, { knownKeys: ring2, currentGeneration: 2 });
check('⚠️ 诚实结论：抢先用旧私钥发出**更高代次**的声明 → 规则只能接受（不防抢占）', preemptRes.accepted === true, preemptRes.reason);
console.log(`      诚实说明（必须进 UI 文案）: ${preemptRes.honestNote}`);
check('诚实说明常量已导出且写明"不防抢先"', GENERATION_RULE_NOTE.includes('不防抢先') && GENERATION_RULE_NOTE.includes('不可解'));
check('（对照）原主随后发出的声明代次更低 → 会被同一规则拒掉', verifyRotationDeclaration(decl, { knownKeys: ring2, currentGeneration: 2 }).accepted === false);

// ── [9] 备份导出 / 导入 ──
section('[9] 备份导出 / 导入（凭证用户自持）');
check('导出必须给口令（不允许明文导出）', store.exportBackup({ passphrase: '' }).ok === false, store.exportBackup({ passphrase: '' }).error);
const exported = store.exportBackup({ passphrase: 'backup-pass-2026' });
check('导出成功', exported.ok === true, exported.ok ? exported.backup.fingerprint : exported.error);
const backupText = JSON.stringify(exported.backup);
const curDer = store.load(PASS).privateKeyDer;
check('备份文件不含私钥明文', !backupText.includes(curDer.toString('base64')) && !backupText.includes(curDer.toString('hex')));
check('备份记录了指纹与代次（恢复时可核对）', fingerprintMatches(exported.backup.fingerprint, info2.fingerprint) && exported.backup.generation === 2);
check('备份带退役公钥（历史签名仍可验）', exported.backup.retiredKeys.length === 1);
check('备份带声明时间线（声明里没有联系方式）', exported.backup.declarations.some((d) => d.kind === 'ccarmy.identity.rotation') && !exported.backup.declarations.some((d) => /contact|email|phone/i.test(JSON.stringify(d))));
check('备份带本机名片历史（旧联系方式随备份走，横幅才有旧值）', Array.isArray(exported.backup.cardHistory) && exported.backup.cardHistory.some((v) => v.card.email === 'laowang@example.com'), exported.backup.cardHistory?.map((v) => v.card.email));
const restoredFile = path.join(tmpRoot, 'restored', 'identity.json');
const restored = new IdentityStore(restoredFile, { protector: nullProtector() });
check('备份口令错 → 导入失败', restored.importBackup(exported.backup, { passphrase: 'wrong-pass-here' }).ok === false);
check('没有口令 → 导入失败（passphrase-required）', restored.importBackup(exported.backup, { passphrase: '' }).error === 'passphrase-required');
const imported = restored.importBackup(exported.backup, { passphrase: 'backup-pass-2026' });
check('口令对 → 导入成功（换机器/恢复）', imported.ok === true, imported.ok ? imported.info.fingerprint : imported.error);
check('恢复后指纹一致（联系人不需要重新认识你）', fingerprintMatches(restored.info().fingerprint, info2.fingerprint));
check('恢复后代次一致（不会回滚代次）', restored.info().generation === 2);
const restoredSign = restored.sign('restored-machine-sign', { passphrase: 'backup-pass-2026' });
check('恢复后可签发且可验', restoredSign.ok === true && restored.verify(restoredSign.signed.payload, restoredSign.signed.signature).ok === true);
check('导入的身份受口令保护（新机器没有旧机器的 OS 包裹）', restored.info().passphraseProtected === true && restored.info().osProtected === false);

// ── [10] 不静默重建身份 ──
section('[10] 身份文件损坏时不静默换身份');
const corruptFile = path.join(tmpRoot, 'corrupt', 'identity.json');
fs.mkdirSync(path.dirname(corruptFile), { recursive: true });
fs.writeFileSync(corruptFile, '{ 这不是合法 JSON', 'utf8');
const corruptStore = new IdentityStore(corruptFile, { protector: fixtureProtector('fixture-os') });
const cr = corruptStore.ensureIdentity('123456789', {});
check('损坏文件 → 报错而不是重建', cr.ok === false && cr.error === 'corrupt', cr.error);
check('损坏文件被隔离为 .corrupt-*（留证据）', fs.readdirSync(path.dirname(corruptFile)).some((f) => f.includes('.corrupt-')), fs.readdirSync(path.dirname(corruptFile)));
check('损坏时不写入新身份（磁盘没有身份文件）', !fs.existsSync(corruptFile));
check('另一个进程的合法身份不受影响', fingerprintMatches(new IdentityStore(file, { protector: nullProtector() }).info().fingerprint, info2.fingerprint));

// ── 汇总 ──
console.log(`\n=== 汇总 ===`);
console.log(`检查项: ${total}，失败: ${failures}`);
console.log('诚实边界（ADR 003 附五.1）：');
console.log(`  · ${GENERATION_RULE_NOTE.slice(0, 120)}…`);
console.log('  · 旧私钥一旦丢失/泄漏，攻击者仍可冒充；群内可由创建者重签成员证书恢复，点对点只能人工核对。');
console.log('  · 本脚本用 `--fixture-os` 替身走"有 OS 钥匙串"的路径；真实 safeStorage 只在 Electron 主进程可用（脚本已断言此处不可用）。');
console.log(`临时目录: ${tmpRoot}`);
process.exit(failures === 0 ? 0 : 1);
