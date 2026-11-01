/**
 * **中继客户端**（第 58 轮）：端到端加密的信封 + 服务器协议的最小实现。
 *
 * 安全边界（回答"服务器不按协议运行能不能突破加密"）：
 *  · 正文用 **X25519 临时密钥 + HKDF-SHA256 + AES-256-GCM** 加密；服务器只有收件人的**公开** box 公钥，没有任何解密材料。
 *  · 信封带发送方 **Ed25519 签名**（覆盖 epk/iv/ct + 发件人 did）⇒ 服务器改一个字节，收件人解密/验签就会失败。
 *  · 服务器**看不到**明文，也**不能伪造**发件人；它能做的只有：拒服务、丢包/延迟、看元数据（谁在何时找谁）、
 *    以及"给你一个假公钥"——后者由**带外核对身份指纹**（安全码/二维码）防住，不靠服务器。
 *  · 不提供前向保密（同一对长期 box 密钥）——这是 v1 的取舍；要前向保密就上 Double Ratchet（后续）。
 *
 * 纯函数 + fetch；门禁直接起样机服务器跑真链路（`scripts/verify-r58-zhongji.mjs`）。
 */
import crypto from 'node:crypto';

export type ShenFen = { edPub: string; edPriv: string; boxPub: string; boxPriv: string };
type JWK = { x?: string; d?: string };
const b64 = (b: Buffer) => b.toString('base64');
const rawEd = (jwk: JWK) => Buffer.from(String(jwk.x), 'base64url');
const rawX = (jwk: JWK) => Buffer.from(String(jwk.x), 'base64url');
/** 私钥 JWK 同时含 x（公）与 d（私）——**必须用 d**，用 x 会造出一把"公钥当种子"的假私钥（验签必失败） */
const rawPriv = (jwk: JWK) => Buffer.from(String(jwk.d), 'base64url');

/** 生成一套身份材料（生产里 ed 来自用户凭证派生；这里给测试/样机用） */
export function shengChengShenFen(): ShenFen {
  const ed = crypto.generateKeyPairSync('ed25519');
  const x = crypto.generateKeyPairSync('x25519');
  const edJ = ed.publicKey.export({ format: 'jwk' }) as JWK;
  const edP = ed.privateKey.export({ format: 'jwk' }) as JWK;
  const xJ = x.publicKey.export({ format: 'jwk' }) as JWK;
  const xP = x.privateKey.export({ format: 'jwk' }) as JWK;
  return { edPub: b64(rawEd(edJ)), edPriv: b64(rawPriv(edP)), boxPub: b64(rawX(xJ)), boxPriv: b64(rawPriv(xP)) };
}

const ED = Buffer.from('302a300506032b6570032100', 'hex');
const X = Buffer.from('302a300506032b656e032100', 'hex');
const edPubKey = (b64s: string) => crypto.createPublicKey({ key: Buffer.concat([ED, Buffer.from(b64s, 'base64')]), format: 'der', type: 'spki' });
const edPrivKey = (b64s: string) => crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(b64s, 'base64')]), format: 'der', type: 'pkcs8' });
const xPubKey = (b64s: string) => crypto.createPublicKey({ key: Buffer.concat([X, Buffer.from(b64s, 'base64')]), format: 'der', type: 'spki' });
const xPrivKey = (b64s: string) => crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), Buffer.from(b64s, 'base64')]), format: 'der', type: 'pkcs8' });

export function qianMing(privB64: string, wen: string): string {
  return b64(crypto.sign(null, Buffer.from(wen, 'utf8'), edPrivKey(privB64)));
}
export function yanQian(pubB64: string, wen: string, sigB64: string): boolean {
  try { return crypto.verify(null, Buffer.from(wen, 'utf8'), edPubKey(pubB64), Buffer.from(sigB64, 'base64')); } catch { return false; }
}

export type XinFeng = { v: 1; from: string; epk: string; iv: string; ct: string; sig: string };

/** 加密 + 签名：收件人的 boxPub（X25519）、发件人的 edPriv（身份签名） */
export function fengZhuang(shouJianBoxPub: string, mingWen: string, faJian: { did: string; edPriv: string }): XinFeng {
  const eph = crypto.generateKeyPairSync('x25519');
  const ephPub = rawX(eph.publicKey.export({ format: 'jwk' }) as JWK);
  const shared = crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: xPubKey(shouJianBoxPub) });
  const key = Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.from('warmy-relay-v1'), Buffer.from('aes-256-gcm'), 32));
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(faJian.did, 'utf8'));
  const ct = Buffer.concat([c.update(Buffer.from(mingWen, 'utf8')), c.final()]);
  const ctAll = Buffer.concat([ct, c.getAuthTag()]);
  const epk = b64(ephPub), ivB = b64(iv), ctB = b64(ctAll);
  const sig = qianMing(faJian.edPriv, `v1|${faJian.did}|${epk}|${ivB}|${ctB}`);
  return { v: 1, from: faJian.did, epk, iv: ivB, ct: ctB, sig };
}

/** 验签 + 解密：必须同时给出正确的 boxPriv；任何篡改都会抛错 */
export function jieFeng(x: XinFeng, shouJianBoxPriv: string): string {
  if (!x || x.v !== 1) throw new Error('信封版本不认识');
  if (!yanQian(x.from, `v1|${x.from}|${x.epk}|${x.iv}|${x.ct}`, x.sig)) throw new Error('签名无效（发件人被伪造或被篡改）');
  const priv = xPrivKey(shouJianBoxPriv);
  const shared = crypto.diffieHellman({ privateKey: priv, publicKey: xPubKey(x.epk) });
  const key = Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.from('warmy-relay-v1'), Buffer.from('aes-256-gcm'), 32));
  const all = Buffer.from(x.ct, 'base64');
  const tag = all.subarray(all.length - 16);
  const ct = all.subarray(0, all.length - 16);
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(x.iv, 'base64'));
  d.setAAD(Buffer.from(x.from, 'utf8'));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

/** ── 与样机服务器的 HTTP 协议（可替换成任意语言/托管）── */
export function zhuanJiKeHu(base: string, shenFen: () => ShenFen, credential = '') {
  const u = (p: string) => base.replace(/\/$/, '') + p;
  const post = async (p: string, b: unknown) => {
    const r = await fetch(u(p), { method: 'POST', headers: { 'content-type': 'application/json', ...(credential ? { authorization: 'Bearer ' + credential } : {}) }, body: JSON.stringify(b) });
    return { status: r.status, j: await r.json() as Record<string, unknown> };
  };
  return {
    async zhuCe(): Promise<boolean> {
      const s = shenFen();
      const ts = Date.now();
      const r = await post('/api/register', { did: s.edPub, boxPub: s.boxPub, ts, sig: qianMing(s.edPriv, `register|${s.edPub}|${s.boxPub}|${ts}`) });
      return !!(r.j && r.j.ok);
    },
    async chaXun(did: string) {
      const r = await fetch(u('/api/lookup?did=' + encodeURIComponent(did)), { headers: credential ? { authorization: 'Bearer ' + credential } : {} });
      return await r.json() as { ok: boolean; online: boolean; boxPub: string; lastSeen: number };
    },
    async touDi(to: string, xinFeng: XinFeng) {
      const s = shenFen();
      const r = await post('/api/relay', { from: s.edPub, to, envelope: JSON.stringify(xinFeng) });
      return { ok: !!(r.j && r.j.ok), offline: !!(r.j && r.j.offline), error: String((r.j && r.j.error) || '') };
    },
    /** 在线心跳：每 N 秒调一次；服务器只记 lastSeen，不记内容。带时间戳+私钥签名，防止别人替你"上线" */
    async xinTiao(): Promise<boolean> {
      const s = shenFen();
      const ts = Date.now();
      const r = await post('/api/heartbeat', { did: s.edPub, ts, sig: qianMing(s.edPriv, `heartbeat|${s.edPub}|${ts}`) });
      return !!(r.j && r.j.ok);
    },
    /** 批量查在线：联系人/群/项目里的 did 一次问完（服务器只返回 bool + lastSeen） */
    async piLiangZaiXian(dids: string[]): Promise<Record<string, { online: boolean; lastSeen: number }>> {
      const r = await post('/api/presence/batch', { dids: (Array.isArray(dids) ? dids : []).slice(0, 500) });
      const p = (r.j && (r.j as { presence?: Record<string, { online: boolean; lastSeen: number }> }).presence) || {};
      return p as Record<string, { online: boolean; lastSeen: number }>;
    },
    async lunXun(): Promise<string[]> {
      const s = shenFen();
      const ts = Date.now();
      const sig = qianMing(s.edPriv, `poll|${s.edPub}|${ts}`);
      const r = await fetch(u('/api/poll?did=' + encodeURIComponent(s.edPub) + '&ts=' + ts + '&sig=' + encodeURIComponent(sig)), { headers: credential ? { authorization: 'Bearer ' + credential } : {} });
      const j = await r.json() as { ok?: boolean; envelopes?: string[] };
      return Array.isArray(j.envelopes) ? j.envelopes : [];
    },
    /** 下线也要私钥证明，防止拿一个凭据把任意 did 踢下线 */
    async xiaXian(): Promise<boolean> {
      const s = shenFen();
      const ts = Date.now();
      const r = await post('/api/bye', { did: s.edPub, ts, sig: qianMing(s.edPriv, `bye|${s.edPub}|${ts}`) });
      return !!(r.j && r.j.ok);
    },
  };
}
