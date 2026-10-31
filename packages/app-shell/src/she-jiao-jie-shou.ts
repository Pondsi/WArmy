/**
 * 企微 / 钉钉 —— 接收侧协议（W08）
 *
 * 只做**协议与安全**，不发网络请求、不依赖真实账号：
 *  · 企微：GET 回调验证（SHA1 签名 + AES-256-CBC 解密 echostr）、POST 事件解密、MsgId 去重、应答明文 "success"
 *  · 钉钉：事件回调签名校验（HMAC-SHA256）、消息去重、应答 {"code":0}
 *
 * 去重是**持久化**的（默认 24h）：平台重试/网络抖动不会重复执行副作用。
 */
import { createCipheriv, createDecipheriv, createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface JieShouCunChuXuanXiang {
  /** 去重记录文件；不传则仅内存（测试用） */
  storeFile?: string;
  ttlMs?: number;
  now?: () => number;
}

class QuChongCunChu {
  private readonly jian = new Map<string, number>();
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(private readonly opts: JieShouCunChuXuanXiang) {
    this.now = opts.now ?? (() => Date.now());
    this.ttlMs = opts.ttlMs ?? 24 * 3600_000;
    this.load();
  }

  private load(): void {
    if (!this.opts.storeFile) return;
    try {
      const text = fs.readFileSync(this.opts.storeFile, 'utf8');
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          const o = JSON.parse(line);
          if (typeof o.k === 'string' && Number.isFinite(o.t)) this.jian.set(o.k, Number(o.t));
        } catch { /* 跳过坏行 */ }
      }
    } catch { /* 首次运行 */ }
    this.compact();
  }

  private append(k: string, t: number): void {
    if (!this.opts.storeFile) return;
    try {
      fs.mkdirSync(path.dirname(this.opts.storeFile), { recursive: true });
      fs.appendFileSync(this.opts.storeFile, JSON.stringify({ k, t }) + '\n', 'utf8');
    } catch { /* 去重落盘失败不阻断接收：本轮仍按内存判重 */ }
  }

  private compact(): void {
    if (!this.opts.storeFile) return;
    const xian = this.now();
    let gai = false;
    for (const [k, t] of this.jian) {
      if (xian - t > this.ttlMs) { this.jian.delete(k); gai = true; }
    }
    if (!gai) return;
    try {
      const rows = [...this.jian].map(([k, t]) => JSON.stringify({ k, t })).join('\n');
      fs.mkdirSync(path.dirname(this.opts.storeFile), { recursive: true });
      fs.writeFileSync(this.opts.storeFile, rows + (rows ? '\n' : ''), 'utf8');
    } catch { /* noop */ }
  }

  /** true = 首次见到；false = 重复 */
  shouCi(key: string): boolean {
    const t = this.now();
    const yi = this.jian.get(key);
    if (yi !== undefined && t - yi <= this.ttlMs) return false;
    this.jian.set(key, t);
    this.append(key, t);
    return true;
  }
}

export class QiYeWeiXinJieShou {
  private readonly token: string;
  private readonly aesKey: Buffer;
  private readonly receiveId: string;
  private readonly cunChu: QuChongCunChu;

  constructor(opts: { token: string; encodingAESKey: string; receiveId?: string } & JieShouCunChuXuanXiang) {
    this.token = String(opts.token || '');
    if (!this.token) throw new Error('wecom-token-required');
    const raw = String(opts.encodingAESKey || '').trim();
    if (!raw) throw new Error('wecom-aes-key-required');
    const b = Buffer.from(raw + '=', 'base64');
    if (b.length !== 32) throw new Error('wecom-aes-key-invalid');
    this.aesKey = b;
    this.receiveId = String(opts.receiveId || '');
    this.cunChu = new QuChongCunChu(opts);
  }

  private qianMing(...parts: string[]): string {
    return createHash('sha1').update(parts.filter((x) => x !== undefined).sort().join(''), 'utf8').digest('hex');
  }

  private yanQianMing(sig: string, timestamp: string, nonce: string, encrypt: string): boolean {
    const want = this.qianMing(this.token, String(timestamp), String(nonce), encrypt);
    const a = Buffer.from(String(sig || '').toLowerCase(), 'utf8');
    const b = Buffer.from(want, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** 加密一段明文（被动回复用）：16B 随机 + 4B 长度 + 明文 + receiveId，PKCS#7 32 */
  jiaMi(msg: string): string {
    const m = Buffer.from(String(msg || ''), 'utf8');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(m.length, 0);
    const raw = Buffer.concat([randomBytes(16), len, m, Buffer.from(this.receiveId, 'utf8')]);
    const pad = 32 - (raw.length % 32 || 32);
    const plain = Buffer.concat([raw, Buffer.alloc(pad === 0 ? 32 : pad, pad === 0 ? 32 : pad)]);
    const iv = this.aesKey.subarray(0, 16);
    const c = createCipheriv('aes-256-cbc', this.aesKey, iv);
    c.setAutoPadding(false);
    return Buffer.concat([c.update(plain), c.final()]).toString('base64');
  }

  /** 被动回复：把回复 XML 加密并给出平台要求的 MsgSignature/TimeStamp/Nonce 包装 */
  gouZaoBeiDongHuiFu(q: { timestamp?: string; nonce?: string }, huiFuXml: string): { ok: boolean; body?: string; error?: string } {
    const timestamp = String(q.timestamp || '');
    const nonce = String(q.nonce || '');
    if (!timestamp || !nonce) return { ok: false, error: 'missing-params' };
    const miWen = this.jiaMi(huiFuXml);
    const sig = this.qianMing(this.token, timestamp, nonce, miWen);
    return {
      ok: true,
      body: `<xml><Encrypt><![CDATA[${miWen}]]></Encrypt><MsgSignature><![CDATA[${sig}]]></MsgSignature><TimeStamp>${timestamp}</TimeStamp><Nonce><![CDATA[${nonce}]]></Nonce></xml>`,
    };
  }

  /** 构造一条文本被动回复的明文 XML（只含平台要求的字段） */
  gouZaoWenBenHuiFu(p: { toUser: string; fromUser: string; content: string; createTime?: number }): string {
    const ct = Number(p.createTime) || Math.floor(Date.now() / 1000);
    return `<xml><ToUserName><![CDATA[${p.toUser}]]></ToUserName><FromUserName><![CDATA[${p.fromUser}]]></FromUserName><CreateTime>${ct}</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[${String(p.content || '').slice(0, 2048)}]]></Content></xml>`;
  }

  /** 解出明文；PKCS#7 去填充，结构：16B random + 4B len(BE) + msg + receiveId */
  jieMi(miWenB64: string): { ok: boolean; msg?: string; receiveId?: string; error?: string } {
    let buf: Buffer;
    try {
      buf = Buffer.from(String(miWenB64 || ''), 'base64');
    } catch {
      return { ok: false, error: 'bad-encoding' };
    }
    if (buf.length < 32) return { ok: false, error: 'too-short' };
    const iv = this.aesKey.subarray(0, 16);
    let plain: Buffer;
    try {
      const d = createDecipheriv('aes-256-cbc', this.aesKey, iv);
      d.setAutoPadding(false);
      plain = Buffer.concat([d.update(buf), d.final()]);
    } catch {
      return { ok: false, error: 'decrypt-failed' };
    }
    const pad = plain[plain.length - 1] ?? 0;
    if (pad < 1 || pad > 32 || pad > plain.length) return { ok: false, error: 'bad-padding' };
    for (let i = plain.length - pad; i < plain.length; i += 1) {
      if ((plain[i] ?? 0) !== pad) return { ok: false, error: 'bad-padding' };
    }
    const body = plain.subarray(0, plain.length - pad);
    if (body.length < 20) return { ok: false, error: 'bad-body' };
    const len = body.readUInt32BE(16);
    if (len < 0 || 20 + len > body.length) return { ok: false, error: 'bad-length' };
    const msg = body.subarray(20, 20 + len).toString('utf8');
    const rid = body.subarray(20 + len).toString('utf8');
    if (this.receiveId && rid !== this.receiveId) return { ok: false, error: 'receive-id-mismatch' };
    return { ok: true, msg, receiveId: rid };
  }

  /** GET 回调：验证 URL，返回解密后的 echostr */
  yanZhengUrl(q: { msg_signature?: string; timestamp?: string; nonce?: string; echostr?: string }): { ok: boolean; echo?: string; error?: string } {
    const { msg_signature, timestamp, nonce, echostr } = q;
    if (!msg_signature || !timestamp || !nonce || !echostr) return { ok: false, error: 'missing-params' };
    if (!this.yanQianMing(msg_signature, timestamp, nonce, echostr)) return { ok: false, error: 'bad-signature' };
    const r = this.jieMi(echostr);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, echo: r.msg };
  }

  /**
   * POST 事件：XML 里取 <Encrypt>，验签 + 解密 + MsgId 去重。
   * 应答口径：被动回复为空时返回 "success"（不做长文本被动回复）。
   */
  jieShou(q: { msg_signature?: string; timestamp?: string; nonce?: string; body?: string }): {
    ok: boolean;
    reply?: string;
    event?: { msgId: string; msgType: string; from: string; to: string; content: string; createTime: number };
    duplicate?: boolean;
    error?: string;
  } {
    const { msg_signature, timestamp, nonce } = q;
    const xml = String(q.body || '');
    if (!msg_signature || !timestamp || !nonce) return { ok: false, error: 'missing-params' };
    const m = /<Encrypt>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/Encrypt>/.exec(xml);
    if (!m) return { ok: false, error: 'missing-encrypt' };
    const encrypt = (m[1] ?? '').trim();
    if (!this.yanQianMing(msg_signature, timestamp, nonce, encrypt)) return { ok: false, error: 'bad-signature' };
    const r = this.jieMi(encrypt);
    if (!r.ok || !r.msg) return { ok: false, error: r.error || 'decrypt-failed' };
    const du = (tag: string) => {
      const x = new RegExp(`<${tag}>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*</${tag}>`).exec(r.msg!);
      return x ? (x[1] ?? '').trim() : '';
    };
    const msgId = du('MsgId');
    const event = {
      msgId,
      msgType: du('MsgType'),
      from: du('FromUserName'),
      to: du('ToUserName'),
      content: du('Content'),
      createTime: Number(du('CreateTime')) || 0,
    };
    const shouCi = msgId ? this.cunChu.shouCi(`wecom:${msgId}`) : true;
    return { ok: true, reply: 'success', event, duplicate: !shouCi };
  }
}

/** 钉钉事件订阅回调：签名 = Base64(HMAC-SHA256(key = appSecret, data = timestamp + "\n" + appSecret)) */
export class DingDingJieShou {
  private readonly secret: string;
  private readonly cunChu: QuChongCunChu;
  private readonly chuangKouMs: number;
  private readonly now: () => number;

  constructor(opts: { appSecret: string; chuangKouMs?: number } & JieShouCunChuXuanXiang) {
    this.secret = String(opts.appSecret || '');
    if (!this.secret) throw new Error('dingtalk-secret-required');
    this.cunChu = new QuChongCunChu(opts);
    this.chuangKouMs = opts.chuangKouMs ?? 3600_000;
    this.now = opts.now ?? (() => Date.now());
  }

  qianMing(timestamp: string): string {
    const data = `${timestamp}\n${this.secret}`;
    return createHmac('sha256', this.secret).update(data, 'utf8').digest('base64');
  }

  jieShou(q: { timestamp?: string; sign?: string; body?: string }): {
    ok: boolean;
    reply?: { code: number; msg: string };
    event?: { msgId: string; eventType: string; payload: unknown };
    duplicate?: boolean;
    error?: string;
  } {
    const timestamp = String(q.timestamp || '');
    const sign = String(q.sign || '');
    if (!timestamp || !sign) return { ok: false, error: 'missing-params' };
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(this.now() - ts) > this.chuangKouMs) return { ok: false, error: 'timestamp-out-of-window' };
    const want = this.qianMing(timestamp);
    const a = Buffer.from(sign, 'utf8');
    const b = Buffer.from(want, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, error: 'bad-signature' };
    let body: unknown = null;
    try {
      body = JSON.parse(String(q.body || '{}'));
    } catch {
      return { ok: false, error: 'bad-json' };
    }
    const o = (body && typeof body === 'object' ? body : {}) as { msgId?: string; eventType?: string; header?: { eventId?: string; eventType?: string } };
    const msgId = String(o.msgId || o.header?.eventId || '');
    const eventType = String(o.eventType || o.header?.eventType || '');
    const shouCi = msgId ? this.cunChu.shouCi(`dingtalk:${msgId}`) : true;
    return { ok: true, reply: { code: 0, msg: 'ok' }, event: { msgId, eventType, payload: body }, duplicate: !shouCi };
  }
}
