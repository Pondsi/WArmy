/**
 * 身份凭证门禁：格式 / 唯一性 / **确定性派生**（凭证即私钥，公钥可分享）。
 *
 * 产品语义：ID = 凭证 = 私钥；给别人的是公钥（指纹）。
 * 没有中心服务器也要能：唯一识别、换机恢复、互相关联 —— 靠的就是
 * 「同一凭证在任何设备派生出同一把密钥」这一条。
 */
import {shengchengPingzheng, formatCredential, normalizeCredential, isValidCredential, keyPairFromCredential, PINGZHENG_ZIFUBIAO, PINGZHENG_CHANGDU} from '../dist/credential.js';
import {fingerprintFromPublicKey} from '../dist/identity.js';

let pass = 0, fail = 0;
function check(biaoQian, ok, detail) {
  if (ok) { pass++; console.log('  ok  ' + biaoQian); }
  else { fail++; console.log('  FAIL ' + biaoQian, detail === undefined ? '' : ' => ' + JSON.stringify(detail).slice(0, 200)); }
}

const cred = shengchengPingzheng();
const norm = normalizeCredential(cred);
check('凭证长度 = 45', norm.length === PINGZHENG_CHANGDU, norm.length);
check('字符集为 56 符号（数字+大小写字母，去掉 I/O/Z）', PINGZHENG_ZIFUBIAO.length === 56, PINGZHENG_ZIFUBIAO.length);
check('不含易混字符 I / O / Z', !/[IOZ]/.test(norm), norm);
check('isValidCredential 通过', isValidCredential(cred) === true);
check('带分隔符的显示形式同样有效', isValidCredential(formatCredential(cred)) === true);
check('长度不足/非法字符被拒', isValidCredential('abc') === false && isValidCredential('I'.repeat(45)) === false);

// 熵：45 × log2(59) ≈ 265 bit ≥ 256
const bits = norm.length * Math.log2(PINGZHENG_ZIFUBIAO.length);
check('熵 ≥ 256 bit（与 Ed25519 种子等长）', bits >= 256, Math.floor(bits));

// 确定性派生：同一凭证（含不同书写形式）⇒ 同一公钥/指纹
const a = keyPairFromCredential(cred);
const b = keyPairFromCredential(formatCredential(cred));
const fpA = fingerprintFromPublicKey(a.publicKeyB64);
const fpB = fingerprintFromPublicKey(b.publicKeyB64);
check('同凭证 ⇒ 同指纹（换机可恢复）', fpA === fpB, { fpA, fpB });
const c = keyPairFromCredential(shengchengPingzheng());
const fpC = fingerprintFromPublicKey(c.publicKeyB64);
check('不同凭证 ⇒ 不同指纹（唯一性）', fpC !== fpA, { fpA, fpC });
check('指纹形状可读（5 位一组）', /^[A-Z0-9]{5}(-[A-Z0-9]{5}){3}$/.test(fpA), fpA);

console.log(`\n==== verify-credential: ${pass} ok / ${fail} FAIL ====`);
process.exit(fail === 0 ? 0 : 1);
