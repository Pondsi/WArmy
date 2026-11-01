/**
 * W09 门禁：签名更新清单（Ed25519）+ 校验和语义
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const GEN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let ok = 0;
const fails = [];
function jian(name, cond, detail) {
  if (cond) { ok += 1; console.log('  ok ', name); }
  else { fails.push(name); console.log('  FAIL', name, detail === undefined ? '' : JSON.stringify(detail)); }
}

const mod = await import(pathToFileURL(path.join(GEN, 'packages/app-shell/dist/updater.js')).href);
const { Gengxinqi, guiFanHuaGengXinQingDan, qingDanQianMingWen, yanZhengQingDanQianMing } = mod;

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const pubB64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');

const base = {
  version: '0.3.0',
  notes: 'signed release',
  url: 'https://example.test/WArmy-0.3.0.exe',
  sha256: 'a'.repeat(64),
  size: 123456,
  mandatory: false,
  publishedAt: '2026-10-30T00:00:00.000Z',
};
const baseParsed = guiFanHuaGengXinQingDan(base);
const signature = crypto.sign(null, Buffer.from(qingDanQianMingWen(baseParsed.manifest), 'utf8'), privateKey).toString('base64');
const signed = { ...base, signature, keyId: 'test-key-1' };
const parsed = guiFanHuaGengXinQingDan(signed);
jian('清单解析保留签名与 keyId', parsed.ok && parsed.manifest.signature === signature && parsed.manifest.keyId === 'test-key-1', parsed);

const v1 = yanZhengQingDanQianMing(parsed.manifest, pubB64);
jian('有效签名通过', v1.ok === true, v1);
const tampered = { ...parsed.manifest, version: '0.3.1' };
jian('改版本号后签名失效', yanZhengQingDanQianMing(tampered, pubB64).ok === false);
jian('缺签名时如实拒绝', yanZhengQingDanQianMing({ ...base }, pubB64).reason === 'signature-missing');
jian('坏公钥被拒', yanZhengQingDanQianMing(parsed.manifest, 'not-a-key').reason === 'public-key-invalid');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-w09-'));
const mk = (feed, key) => new Gengxinqi({
  currentVersion: '0.2.29',
  downloadDir: path.join(tmp, key ? 'a' : 'b'),
  env: { WARMY_UPDATE_FEED_URL: 'https://example.test/feed.json' },
  getSettings: () => null,
  manifestPublicKey: key || undefined,
  fetchImpl: async () => new Response(JSON.stringify(feed), { status: 200, headers: { 'content-type': 'application/json' } }),
  timeoutMs: 2000,
});

const r1 = await mk(signed, pubB64).check();
jian('签名清单可正常判定有更新', r1.ok === true && r1.status === 'update-available' && r1.latestVersion === '0.3.0', { status: r1.status, reason: r1.reason });

const r2 = await mk({ ...base }, pubB64).check();
jian('配置公钥后无签名清单被拒', r2.ok === false && r2.status === 'invalid-response' && r2.reason === 'signature-missing', { status: r2.status, reason: r2.reason });

const badSig = { ...base, signature: Buffer.from('x'.repeat(64)).toString('base64') };
const r3 = await mk(badSig, pubB64).check();
jian('配置公钥后坏签名清单被拒', r3.ok === false && r3.status === 'invalid-response' && r3.reason === 'bad-signature', { status: r3.status, reason: r3.reason });

const r4 = await mk(base, '').check();
jian('未配置公钥时保持旧行为（不假称已签名）', r4.ok === true && r4.status === 'update-available', { status: r4.status });

const sameFeed = { ...base, version: '0.2.29' };
const sameParsed = guiFanHuaGengXinQingDan(sameFeed);
const sameSig = crypto.sign(null, Buffer.from(qingDanQianMingWen(sameParsed.manifest), 'utf8'), privateKey).toString('base64');
const r5 = await mk({ ...sameFeed, signature: sameSig }, pubB64).check();
jian('签名清单同版本判定最新', r5.ok === true && r5.status === 'up-to-date' && r5.updateAvailable === false, { status: r5.status });

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n==== verify-r122-w09-manifest: ${ok} ok / ${fails.length} FAIL ====`);
if (fails.length) process.exit(1);
