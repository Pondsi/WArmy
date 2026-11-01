/**
 * W08 门禁：企微 / 钉钉接收侧协议（离线夹具，不接真实账号）
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

const { QiYeWeiXinJieShou, DingDingJieShou } = await import(
  pathToFileURL(path.join(GEN, 'packages/app-shell/dist/she-jiao-jie-shou.js')).href
);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-w08-'));

/* ── 企微夹具 ─────────────────────────────────────────────── */
const token = 'warmy-token';
const aesKeyRaw = crypto.randomBytes(32).toString('base64').replace(/=+$/, ''); // 43 chars
const aesKey = Buffer.from(aesKeyRaw + '=', 'base64');
const receiveId = 'ww-corp-001';

function pkcs7(buf) {
  const pad = 32 - (buf.length % 32 || 32);
  const p = pad === 0 ? 32 : pad;
  return Buffer.concat([buf, Buffer.alloc(p, p)]);
}
function jiaMi(msg) {
  const m = Buffer.from(msg, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(m.length, 0);
  const plain = pkcs7(Buffer.concat([crypto.randomBytes(16), len, m, Buffer.from(receiveId, 'utf8')]));
  const iv = aesKey.subarray(0, 16);
  const c = crypto.createCipheriv('aes-256-cbc', aesKey, iv);
  c.setAutoPadding(false);
  return Buffer.concat([c.update(plain), c.final()]).toString('base64');
}
function qianMing(...parts) {
  return crypto.createHash('sha1').update(parts.filter(Boolean).sort().join(''), 'utf8').digest('hex');
}

const storeFile = path.join(root, 'wecom-dedupe.jsonl');
const wecom = new QiYeWeiXinJieShou({ token, encodingAESKey: aesKeyRaw, receiveId, storeFile });
const ts = String(Math.floor(Date.now() / 1000));
const nonce = 'n123';

const echoPlain = 'echo-ok-2026';
const echoEnc = jiaMi(echoPlain);
const echoSig = qianMing(token, ts, nonce, echoEnc);
jian('企微 URL 验证通过并返回明文', wecom.yanZhengUrl({ msg_signature: echoSig, timestamp: ts, nonce, echostr: echoEnc }).echo === echoPlain);
jian('企微 URL 验签错误被拒', wecom.yanZhengUrl({ msg_signature: echoSig.slice(0, -2) + '00', timestamp: ts, nonce, echostr: echoEnc }).ok === false);

const msgXml = `<xml><ToUserName><![CDATA[ww-corp-001]]></ToUserName><FromUserName><![CDATA[user-a]]></FromUserName><CreateTime>${ts}</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[hello 企微]]></Content><MsgId>9001</MsgId></xml>`;
const msgEnc = jiaMi(msgXml);
const msgSig = qianMing(token, ts, nonce, msgEnc);
const body = `<xml><ToUserName><![CDATA[ww-corp-001]]></ToUserName><Encrypt><![CDATA[${msgEnc}]]></Encrypt></xml>`;
const r1 = wecom.jieShou({ msg_signature: msgSig, timestamp: ts, nonce, body });
jian('企微事件解密并解析字段', r1.ok && r1.event.msgId === '9001' && r1.event.content === 'hello 企微', r1);
jian('企微应答为 success', r1.reply === 'success');
jian('企微首次事件不是重复', r1.duplicate === false);

const r2 = wecom.jieShou({ msg_signature: msgSig, timestamp: ts, nonce, body });
jian('企微同一 MsgId 判重复（平台重试不重复执行）', r2.ok && r2.duplicate === true);

const wecom2 = new QiYeWeiXinJieShou({ token, encodingAESKey: aesKeyRaw, receiveId, storeFile });
jian('企微去重跨实例持久（重启后仍判重复）', wecom2.jieShou({ msg_signature: msgSig, timestamp: ts, nonce, body }).duplicate === true);

jian('企微签名被篡改 ⇒ 拒绝', wecom.jieShou({ msg_signature: 'deadbeef', timestamp: ts, nonce, body }).ok === false);
jian('企微缺少 Encrypt ⇒ 拒绝', wecom.jieShou({ msg_signature: msgSig, timestamp: ts, nonce, body: '<xml></xml>' }).ok === false);

// 换一个 receiveId 加密的消息必须被拒（防止把别的企业的回调内容塞进来）
const otherRid = 'ww-other-999';
function jiaMiRid(msg, rid) {
  const m = Buffer.from(msg, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(m.length, 0);
  const plain = pkcs7(Buffer.concat([crypto.randomBytes(16), len, m, Buffer.from(rid, 'utf8')]));
  const c = crypto.createCipheriv('aes-256-cbc', aesKey, aesKey.subarray(0, 16));
  c.setAutoPadding(false);
  return Buffer.concat([c.update(plain), c.final()]).toString('base64');
}
const badEnc = jiaMiRid('<xml><MsgId>1</MsgId></xml>', otherRid);
const badSig = qianMing(token, ts, nonce, badEnc);
jian('企微 receiveId 不匹配 ⇒ 拒绝', wecom.jieShou({ msg_signature: badSig, timestamp: ts, nonce, body: `<xml><Encrypt>${badEnc}</Encrypt></xml>` }).ok === false);

// 密文被替换 ⇒ 签名/解密失败
const tampered = Buffer.from(msgEnc, 'base64');
tampered[tampered.length - 5] ^= 0xff;
jian('企微密文被篡改 ⇒ 拒绝', wecom.jieShou({ msg_signature: msgSig, timestamp: ts, nonce, body: `<xml><Encrypt>${tampered.toString('base64')}</Encrypt></xml>` }).ok === false);

// 被动回复：加密 + 签名包装；用自己的解密封装回读，验证明文与签名都对得上
const replyXml = wecom.gouZaoWenBenHuiFu({ toUser: 'user-a', fromUser: 'ww-corp-001', content: '收到：hello 企微', createTime: Number(ts) });
const reply = wecom.gouZaoBeiDongHuiFu({ timestamp: ts, nonce }, replyXml);
jian('企微被动回复构造成功', reply.ok === true && !!reply.body, reply.error);
if (reply.ok && reply.body) {
  const enc2 = /<Encrypt>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/Encrypt>/.exec(reply.body)?.[1] || '';
  const sig2 = /<MsgSignature>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/MsgSignature>/.exec(reply.body)?.[1] || '';
  const rt = wecom.jieMi(enc2);
  jian('企微被动回复可被解开且内容一致', rt.ok && rt.msg === replyXml, rt.error);
  jian('企微被动回复签名正确', sig2 === qianMing(token, ts, nonce, enc2), { got: sig2.slice(0, 8), want: qianMing(token, ts, nonce, enc2).slice(0, 8) });
  const badReply = reply.body.replace(sig2, '0'.repeat(sig2.length));
  jian('企微被动回复签名被改 ⇒ 验签失败', (() => { const e = /<Encrypt>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/Encrypt>/.exec(badReply)?.[1] || ''; const s = /<MsgSignature>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/MsgSignature>/.exec(badReply)?.[1] || ''; return s !== qianMing(token, ts, nonce, e); })());
}

/* ── 钉钉夹具 ─────────────────────────────────────────────── */
const secret = 'ding-secret-xxx';
const ddStore = path.join(root, 'ding-dedupe.jsonl');
const ding = new DingDingJieShou({ appSecret: secret, storeFile: ddStore });
const now = Date.now();
const sign = crypto.createHmac('sha256', secret).update(`${now}\n${secret}`, 'utf8').digest('base64');
const ddBody = JSON.stringify({ msgId: 'dd-1', eventType: 'robot.message', text: 'hi' });
const d1 = ding.jieShou({ timestamp: String(now), sign, body: ddBody });
jian('钉钉签名通过并解析事件', d1.ok && d1.event.msgId === 'dd-1' && d1.event.eventType === 'robot.message', d1);
jian('钉钉应答 code=0', d1.reply && d1.reply.code === 0);
jian('钉钉首次事件不是重复', d1.duplicate === false);
jian('钉钉同一事件判重复', ding.jieShou({ timestamp: String(now), sign, body: ddBody }).duplicate === true);
jian('钉钉签名错误被拒', ding.jieShou({ timestamp: String(now), sign: 'bad', body: ddBody }).ok === false);
jian('钉钉时间戳超窗被拒（防重放）', ding.jieShou({ timestamp: String(now - 2 * 3600_000), sign, body: ddBody }).ok === false);
jian('钉钉坏 JSON 被拒', ding.jieShou({ timestamp: String(now), sign, body: '<xml>' }).ok === false);
const ding2 = new DingDingJieShou({ appSecret: secret, storeFile: ddStore });
jian('钉钉去重跨实例持久', ding2.jieShou({ timestamp: String(now), sign, body: ddBody }).duplicate === true);

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n==== verify-r122-w08-receive: ${ok} ok / ${fails.length} FAIL ====`);
if (fails.length) process.exit(1);
