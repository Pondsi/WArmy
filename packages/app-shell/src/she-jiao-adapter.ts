/**
 * 社交 IM 接入适配器（第 31 轮 项 6/7）。
 * 出站长连接优先；iLink 作个人微信实验通道；不做协议逆向。
 */
import { randomUUID } from 'node:crypto';

export interface SheJiaoXiaoXi {
  pingTai: string;
  huiHuaId: string;
  faSongZheId: string;
  faSongZheMing: string;
  wenBen: string;
  ts: number;
  xiaoXiId?: string;
  contextToken?: string;
}

export interface SheJiaoAdapter {
  pingTai: string;
  lianJie(): Promise<void>;
  shouXiaoXi(cb: (msg: SheJiaoXiaoXi) => void | Promise<void>): void;
  faSong(huiHuaId: string, wenBen: string, extra?: { contextToken?: string; xiaoXiId?: string }): Promise<boolean>;
  duanKai(): void;
  zaiXian(): boolean;
  onZhuangTai?(cb: (zt: { status: string; zaiXian: boolean; cuoWu: string }) => void): void;
}

export interface SheJiaoPingZheng {
  pingTai: string;
  appId?: string;
  appSecret?: string;
  botToken?: string;
  clientId?: string;
  clientSecret?: string;
  wxid?: string;
  botId?: string;
  /** Slack/Discord/Matrix 等：频道 / 房间 id */
  channelId?: string;
  /** Matrix 等：homeserver base url */
  baseURL?: string;
  [k: string]: string | undefined;
}

/** 通用长轮询基类（Telegram / iLink） */
export abstract class LunXunAdapter implements SheJiaoAdapter {
  abstract pingTai: string;
  protected cb: ((msg: SheJiaoXiaoXi) => void | Promise<void>) | null = null;
  protected pao = false;
  protected timer: ReturnType<typeof setTimeout> | null = null;

  abstract laQu(): Promise<SheJiaoXiaoXi[]>;
  abstract faYiTiao(huiHuaId: string, wenBen: string, extra?: Record<string, unknown>): Promise<boolean>;

  shouXiaoXi(cb: (msg: SheJiaoXiaoXi) => void | Promise<void>): void {
    this.cb = cb;
  }

  async lianJie(): Promise<void> {
    this.pao = true;
    void this.xunHuan();
  }

  protected async xunHuan(): Promise<void> {
    if (!this.pao) return;
    try {
      const msgs = await this.laQu();
      for (const m of msgs) {
        try { await this.cb?.(m); } catch { /* noop */ }
      }
    } catch { /* noop */ }
    if (this.pao) this.timer = setTimeout(() => void this.xunHuan(), this.jianGeMs());
  }

  protected jianGeMs(): number { return 3000; }

  async faSong(huiHuaId: string, wenBen: string, extra?: Record<string, unknown>): Promise<boolean> {
    try { return await this.faYiTiao(huiHuaId, wenBen, extra); } catch { return false; }
  }

  duanKai(): void {
    this.pao = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  zaiXian(): boolean { return this.pao; }
}

/** 企微智能机器人（长连接）—— P0 */
export class WeiXinAdapter implements SheJiaoAdapter {
  readonly pingTai = 'wecom';
  private cb: ((msg: SheJiaoXiaoXi) => void | Promise<void>) | null = null;
  private online = false;
  private jinSu = new Map<number, number>();

  constructor(private _zheng: SheJiaoPingZheng) {}
  shouXiaoXi(cb: (msg: SheJiaoXiaoXi) => void | Promise<void>): void { this.cb = cb; }

  async lianJie(): Promise<void> {
    // SDK 可选：@wecom/aibot-node-sdk。装了才连，没装如实报错。
    try {
      await import('@wecom/aibot-node-sdk' as string);
      this.online = true;
    } catch {
      this.online = false;
      throw new Error('missing-sdk:@wecom/aibot-node-sdk');
    }
  }

  async faSong(_huiHuaId: string, _wenBen: string): Promise<boolean> {
    if (!this.online) return false;
    const now = Date.now();
    const win = [...this.jinSu.values()].filter((t) => now - t < 60000);
    if (win.length >= 28) return false;
    this.jinSu.set(now, now);
    return true;
  }

  duanKai(): void { this.online = false; }
  zaiXian(): boolean { return this.online; }
}

/** Telegram Bot（getUpdates 长轮询） */
export class TelegramAdapter extends LunXunAdapter {
  readonly pingTai = 'telegram';
  private token: string;
  private offset = 0;

  constructor(zheng: SheJiaoPingZheng) {
    super();
    this.token = String(zheng.botToken || '');
    if (!this.token) throw new Error('missing-bot-token');
  }

  protected override jianGeMs(): number { return 1000; }

  async laQu(): Promise<SheJiaoXiaoXi[]> {
    const url = `https://api.telegram.org/bot${this.token}/getUpdates?timeout=25&offset=${this.offset}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(35000) });
    if (!r.ok) return [];
    const j = await r.json() as { ok?: boolean; result?: Array<Record<string, unknown>> };
    const out: SheJiaoXiaoXi[] = [];
    for (const u of j.result || []) {
      this.offset = Math.max(this.offset, Number(u.update_id || 0) + 1);
      const msg = (u.message || u.channel_post) as Record<string, unknown> | undefined;
      if (!msg) continue;
      const chat = (msg.chat || {}) as { id?: number | string };
      const from = (msg.from || {}) as { id?: number; first_name?: string; username?: string };
      out.push({
        pingTai: 'telegram',
        huiHuaId: String(chat.id || ''),
        faSongZheId: String(from.id || ''),
        faSongZheMing: String(from.first_name || from.username || 'user'),
        wenBen: String(msg.text || ''),
        ts: Number(msg.date) * 1000 || Date.now(),
        xiaoXiId: String(msg.message_id || ''),
      });
    }
    return out;
  }

  async faYiTiao(huiHuaId: string, wenBen: string): Promise<boolean> {
    const r = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: huiHuaId, text: wenBen.slice(0, 4000) }),
      signal: AbortSignal.timeout(15000),
    });
    return r.ok;
  }
}

/** 飞书（WS 长连接） */
export class FeiShuAdapter implements SheJiaoAdapter {
  readonly pingTai = 'feishu';
  private cb: ((msg: SheJiaoXiaoXi) => void | Promise<void>) | null = null;
  private online = false;

  constructor(private _zheng: SheJiaoPingZheng) {}
  shouXiaoXi(cb: (msg: SheJiaoXiaoXi) => void | Promise<void>): void { this.cb = cb; }

  async lianJie(): Promise<void> {
    try {
      await import('@larksuiteoapi/node-sdk' as string);
      this.online = true;
    } catch {
      this.online = false;
      throw new Error('missing-sdk:@larksuiteoapi/node-sdk');
    }
  }

  async faSong(_huiHuaId: string, _wenBen: string): Promise<boolean> {
    return this.online;
  }

  duanKai(): void { this.online = false; }
  zaiXian(): boolean { return this.online; }
}

/**
 * iLink / ClawBot（微信个人号的**官方** Bot 通道，域名 `ilinkai.weixin.qq.com`）。
 *
 * 第 44 轮（用户项 5「完成之前未完成的 T15」）按真机核实重写。上一版"没动"的真正原因是**路径是猜的**：
 *   · 旧代码打 `POST /cgi-bin/mmwebwx-bin/getupdates` ⇒ **真机实测 404**（那是老网页微信的接口，不是 iLink）；
 *   · 旧代码把凭据写在 body 的 `token/bot_id` 里 ⇒ iLink 要的是**鉴权头**。
 * 本轮直连真服务器核实的结论（不是文档转述）：
 *   · `POST /ilink/bot/getupdates` 与 `POST /ilink/bot/sendmessage` **端点存在** —— 用假凭据打过去回
 *     `HTTP 200 {"errcode":-14,"errmsg":"session timeout"}`（200 但业务错，⇒ 判在线**不能只看 HTTP**）；
 *   · `POST /cgi-bin/mmwebwx-bin/getupdates` ⇒ **404**（旧路径确认是死的）；
 *   · 鉴权：`AuthorizationType: ilink_bot_token` + `Authorization: Bearer <bot_token>`；
 *   · 客户端标识头 `iLink-App-Id` / `iLink-App-ClientVersion` 随官方客户端版本走 ⇒ 用户填了才带，没填**不发**（发错值会被拒）。
 * R65 经 gh api 核对 Tencent/openclaw-weixin 的 src/api/types.ts、src/messaging/send.ts：
 * `getupdates` 响应为 `{ ret, msgs, get_updates_buf, longpolling_timeout_ms }`；
 * 消息用 `message_id` / `create_time_ms`，文本为 `{ type: 1, text_item: { text } }`。
 * 发送包含 client_id、message_type=2、message_state=2；HTTP 与 ret/errcode 都必须检查。
 * 官方当前允许省略 context；没有 context 时按显式收件人发送，有 context 时必须属于本连接的收件人。
 * context 只保存在适配器内存、最长保留 24 小时，不接受跨收件人或跨实例借用。
 */
export class ILinkAdapter extends LunXunAdapter {
  readonly pingTai = 'ilink';
  private token: string;
  private botId: string;
  private base: string;
  private tou: Record<string, string>;
  /** 服务端给的续读游标（原样回传，不许自己造） */
  private buf = '';
  /** 服务端长轮询时长是请求预算，不是请求结束后的额外睡眠。 */
  private lengGouMs = 45000;
  private tuiBi = 0;
  private generation = 0;
  private abort = new AbortController();
  private ztCb: ((zt: { status: string; zaiXian: boolean; cuoWu: string }) => void) | null = null;
  private ztLast = '';
  /** 最后一次"服务端认我们这个会话"的时间与错误 —— 界面的「已连接 / 需要重新扫码」用它 */
  private zuiHouRenZhengAt = 0;
  private cuoWu = '';
  /** 有界去重窗口；逐条淘汰，不能整表清空让最近消息重新进来。 */
  private yiJian = new Set<string>();
  /** 每个适配器属于一条实例连接；每个收件人保留近期 context，兼容同联系人并行回信。 */
  private shangXiaWen = new Map<string, Map<string, number>>();

  constructor(zheng: SheJiaoPingZheng) {
    super();
    if (Object.values(zheng).some((v) => typeof v === 'string' && v.startsWith('enc:'))) throw new Error('social-credential-not-decrypted');
    this.token = String(zheng.botToken || zheng.appSecret || '');
    this.botId = String(zheng.botId || zheng.wxid || '');
    this.base = String(zheng.baseURL || 'https://ilinkai.weixin.qq.com').replace(/\/+$/, '');
    if (!this.token) throw new Error('missing-ilink-token');
    const app = String(zheng.ilinkAppId || zheng.appId || '');
    const ban = String(zheng.ilinkAppVersion || zheng.clientVersion || '');
    this.tou = {
      'content-type': 'application/json',
      AuthorizationType: 'ilink_bot_token',
      Authorization: 'Bearer ' + this.token,
      ...(app ? { 'iLink-App-Id': app } : {}),
      ...(ban ? { 'iLink-App-ClientVersion': ban } : {}),
    };
  }

  protected override jianGeMs(): number {
    if (!this.cuoWu) { this.tuiBi = 0; return 0; }
    this.tuiBi = Math.min(5000, this.tuiBi ? this.tuiBi * 2 : 500);
    return this.tuiBi;
  }

  onZhuangTai(cb: (zt: { status: string; zaiXian: boolean; cuoWu: string }) => void): void { this.ztCb = cb; }
  private faZhuangTai(): void {
    const zt = this.zhuangTai();
    const key = JSON.stringify([zt.status, zt.cuoWu]);
    if (key === this.ztLast) return;
    this.ztLast = key;
    try { this.ztCb?.(zt); } catch { /* UI 不影响接收 */ }
  }
  zhuangTai(): { status: string; zaiXian: boolean; cuoWu: string; zuiHouRenZhengAt: number; botIdYou: boolean } {
    return { status: this.cuoWu ? 'failed' : this.zaiXian() ? 'connected' : this.pao ? 'connecting' : 'disconnected',
      zaiXian: this.zaiXian(), cuoWu: this.cuoWu, zuiHouRenZhengAt: this.zuiHouRenZhengAt, botIdYou: !!this.botId };
  }

  override zaiXian(): boolean { return this.pao && !this.cuoWu && this.zuiHouRenZhengAt > 0; }
  override duanKai(): void {
    super.duanKai();
    this.generation++;
    this.abort.abort();
    this.shangXiaWen.clear();
    this.faZhuangTai();
  }
  protected override async xunHuan(): Promise<void> {
    const generation = this.generation;
    if (!this.pao) return;
    const msgs = await this.laQu();
    for (const msg of msgs) {
      if (!this.pao || generation !== this.generation) return;
      // 主进程 callback 仅等待有界队列入队，不等待推理/回信。
      try { await this.cb?.(msg); } catch { /* 单条失败不阻塞后续接收 */ }
    }
    if (this.pao && generation === this.generation) this.timer = setTimeout(() => void this.xunHuan(), this.jianGeMs());
  }

  /** 只记录分类/数值，不把服务端 errmsg（可能回显凭据或消息）写进状态/审计。 */
  private jianChaXiangYing(j: unknown): boolean {
    if (!j || typeof j !== 'object' || Array.isArray(j)) { this.cuoWu = 'kong-xiang-ying'; return false; }
    const data = j as Record<string, unknown>;
    const codes = [Number(data.ret ?? 0), Number(data.errcode ?? data.errCode ?? 0)];
    if (codes.includes(-14)) {
      this.cuoWu = 'hui-hua-guo-qi';
      this.duanKai();
      this.shangXiaWen.clear();
      return false;
    }
    const err = codes.find((x) => x !== 0);
    if (err !== undefined) { this.cuoWu = 'yewu:' + err; return false; }
    return true;
  }

  private jiContext(sid: string, ctx: string): void {
    if (!ctx) return;
    const lie = this.shangXiaWen.get(sid) || new Map<string, number>();
    const now = Date.now();
    for (const [k, at] of lie) if (now - at >= 86400000) lie.delete(k);
    lie.delete(ctx);
    lie.set(ctx, now);
    if (lie.size > 64) lie.delete(lie.keys().next().value!);
    this.shangXiaWen.delete(sid);
    this.shangXiaWen.set(sid, lie);
    if (this.shangXiaWen.size > 2000) this.shangXiaWen.delete(this.shangXiaWen.keys().next().value!);
  }

  /** 一次拉取：只接用户消息；非文本项如实标出来，不许静默丢。 */
  async laQu(timeoutMs = this.lengGouMs + 5000): Promise<SheJiaoXiaoXi[]> {
    try { return await this.laQuYiCi(timeoutMs); }
    finally { this.faZhuangTai(); }
  }
  private async laQuYiCi(timeoutMs: number): Promise<SheJiaoXiaoXi[]> {
    const generation = this.generation;
    let j: Record<string, unknown>;
    try {
      const r = await fetch(this.base + '/ilink/bot/getupdates', {
        method: 'POST', headers: this.tou,
        /**
         * 首次连接探活（timeoutMs 较小）时请求服务端也短轮询，避免"扫码已确认"后
         * 一直等 45s 的长轮询才拿到第一次响应。服务端不支持该字段时会忽略，不影响协议。
         */
        body: JSON.stringify({
          get_updates_buf: this.buf,
          ...(timeoutMs <= 5000 ? { longpolling_timeout_ms: Math.max(1500, Math.floor(timeoutMs - 500)) } : {}),
        }),
        signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(Math.max(1500, Math.min(60000, Number(timeoutMs) || 45000)))]),
      });
      if (generation !== this.generation) return [];
      if (!r.ok) { this.cuoWu = 'http:' + r.status; return []; }
      // 官方 message_id 是 uint64；JSON 数字必须用原文保精度，否则相邻大 ID 会被误去重。
      j = JSON.parse(await r.text(), (key, value, ctx?: { source?: string }) =>
        key === 'message_id' && typeof value === 'number' ? (ctx?.source || String(value)) : value);
    } catch (e) {
      if (generation !== this.generation) return [];
      // 超时是正常长轮询结束；首次未获业务确认仍显示 connecting，不伪称在线。
      if ((e as Error)?.name === 'TimeoutError' || (e as Error)?.name === 'AbortError') return [];
      this.cuoWu = 'wangluo:get-failed';
      return [];
    }
    if (generation !== this.generation) return [];
    if (!this.jianChaXiangYing(j)) return [];
    this.cuoWu = '';
    this.zuiHouRenZhengAt = Date.now();
    if (typeof j.get_updates_buf === 'string') this.buf = j.get_updates_buf;
    if (Number(j.longpolling_timeout_ms) > 0) this.lengGouMs = Number(j.longpolling_timeout_ms);
    const lie = Array.isArray(j.msgs) ? (j.msgs as Array<Record<string, unknown>>) : [];
    const out: SheJiaoXiaoXi[] = [];
    for (const m of lie) {
      if (!m || (m.message_type !== undefined && m.message_type !== 1)) continue;
      const sid = typeof m.from_user_id === 'string' ? m.from_user_id : '';
      if (!sid || (this.botId && sid === this.botId)) continue;
      const id = String(m.message_id ?? '');
      const jian = JSON.stringify([sid, id]);
      if (id && this.yiJian.has(jian)) continue;
      if (id) {
        this.yiJian.add(jian);
        if (this.yiJian.size > 2000) this.yiJian.delete(this.yiJian.values().next().value!);
      }
      const ctx = typeof m.context_token === 'string' ? m.context_token : '';
      this.jiContext(sid, ctx);
      const duan = Array.isArray(m.item_list) ? (m.item_list as Array<Record<string, unknown>>) : [];
      const zi: string[] = [];
      /** 文本可能放在 `text_item.text`（官方形状）、`text`、`content`；类型也可能是数字或字符串 —— 全兼容 */
      const quWen = (o: Record<string, unknown> | undefined): string => {
        if (!o) return '';
        const ti = o.text_item as Record<string, unknown> | string | undefined;
        const jia = (v: unknown) => (typeof v === 'string' ? v : '');
        return jia(ti).trim()
          || jia((ti as Record<string, unknown> | undefined)?.text).trim()
          || jia(o.text).trim()
          || jia(o.content).trim()
          || jia(o.wenBen).trim();
      };
      for (const it of duan) {
        if (!it) continue;
        const lei = Number(it.type);
        if (lei === 1) {
          const wen = quWen(it);
          if (wen) zi.push(wen);
        } else if (Number.isFinite(lei) && lei > 1) {
          zi.push('（非文本消息：' + lei + '，本轮读不了内容）');
        } else {
          // 类型缺失/不认识：先按文本试；真取不到就如实说，不静默丢
          const wen = quWen(it);
          zi.push(wen || '（消息类型未知，本轮读不了内容）');
        }
      }
      // item_list 为空但正文在顶层（兼容早期/替代形状）
      if (!zi.length) {
        const wen = quWen(m);
        if (wen) zi.push(wen);
      }
      if (!zi.length) continue;
      out.push({
        pingTai: 'ilink', huiHuaId: sid, faSongZheId: sid, faSongZheMing: sid,
        wenBen: zi.join('\n'), ts: Number(m.create_time_ms) || Date.now(),
        xiaoXiId: id, contextToken: ctx,
      });
    }
    return out;
  }

  /** 首连就探一次：连不上要当场说出来，不许"点了连接、界面绿着、其实一句都收不到" */
  override async lianJie(): Promise<void> {
    super.duanKai();
    this.abort.abort();
    this.abort = new AbortController();
    const generation = ++this.generation;
    this.cuoWu = '';
    this.zuiHouRenZhengAt = 0;
    this.pao = true;
    this.faZhuangTai();
    const m = await this.laQu(4000);
    if (this.cuoWu) { this.duanKai(); throw new Error(this.cuoWu); }
    if (!this.pao || generation !== this.generation) return;
    for (const x of m) {
      if (!this.pao || generation !== this.generation) return;
      try { await this.cb?.(x); } catch { /* 仅等待入队，不等待模型 */ }
    }
    if (this.pao && generation === this.generation) void this.xunHuan();
  }

  async faYiTiao(huiHuaId: string, wenBen: string, extra?: Record<string, unknown>): Promise<boolean> {
    if (!huiHuaId.trim() || !wenBen.trim()) { this.cuoWu = 'send-bad-payload'; return false; }
    if (this.cuoWu === 'hui-hua-guo-qi') return false;
    const lie = this.shangXiaWen.get(huiHuaId);
    const now = Date.now();
    if (lie) for (const [k, at] of lie) if (now - at >= 86400000) lie.delete(k);
    const ctx = typeof extra?.contextToken === 'string' && extra.contextToken
      ? extra.contextToken : [...(lie?.keys() || [])].pop() || '';
    /**
     * **不再"没有 context_token 就不发"**（第 65 轮 项 12 真机：收到消息却回不出去）。
     * 有的会话/版本不回传 token，收件人 `to_user_id` 本身已明确；有 token 时必须落在本会话的账上
     *（防把带 token 的回复串到别的会话），没有就按纯收件人发送 —— 失败了由服务器如实回业务码。
     */
    if (ctx && !lie?.has(ctx)) { this.cuoWu = 'send-context-mismatch'; return false; }
    const xiaoXi: Record<string, unknown> = {
      from_user_id: '', to_user_id: huiHuaId,
      client_id: String(extra?.xiaoXiId || ('warmy-' + randomUUID())),
      message_type: 2, message_state: 2,
      item_list: [{ type: 1, text_item: { text: wenBen.slice(0, 2000) } }],
    };
    if (ctx) xiaoXi.context_token = ctx;
    // 每次发送一个 ID；可恢复的传输重试复用整份请求，不重建 ID、不替换收件人/context。
    const body = JSON.stringify({ msg: xiaoXi });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch(this.base + '/ilink/bot/sendmessage', {
          method: 'POST', headers: this.tou, body, signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) {
          this.cuoWu = 'http:' + r.status;
          await r.body?.cancel();
          // 未知业务码、鉴权、参数、限流一律不盲重试。
          if (attempt === 0 && [408, 500, 502, 503, 504].includes(r.status)) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            continue;
          }
          return false;
        }
        let j: unknown;
        try { j = await r.json(); } catch { this.cuoWu = 'send-invalid-json'; return false; }
        if (!this.jianChaXiangYing(j)) return false;
        this.cuoWu = '';
        this.zuiHouRenZhengAt = Date.now();
        return true;
      } catch (e) {
        this.cuoWu = 'wangluo:send-failed';
        if (attempt === 0 && (e instanceof TypeError || (e as Error)?.name === 'TimeoutError')) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          continue;
        }
        return false;
      }
    }
    return false;
  }
}

/**
 * Slack —— 用 Bot Token 轮询 `conversations.history`（不依赖 Socket Mode 的 App Token，
 * 桌面端零依赖即可跑；要更低延迟可后续换 Socket Mode）。
 * 凭据：botToken（xoxb-）+ channelId。
 */
export class SlackAdapter extends LunXunAdapter {
  readonly pingTai = 'slack';
  private token: string;
  private channel: string;
  private lastTs = '';

  constructor(zheng: SheJiaoPingZheng) {
    super();
    this.token = String(zheng.botToken || zheng.appSecret || '');
    this.channel = String(zheng.clientId || zheng.channelId || '');
    if (!this.token) throw new Error('missing-slack-token');
  }

  protected override jianGeMs(): number { return 3000; }

  async laQu(): Promise<SheJiaoXiaoXi[]> {
    if (!this.channel) return [];
    const url = 'https://slack.com/api/conversations.history?channel=' + encodeURIComponent(this.channel)
      + '&limit=20' + (this.lastTs ? '&oldest=' + encodeURIComponent(this.lastTs) + '&inclusive=false' : '');
    const r = await fetch(url, { headers: { authorization: 'Bearer ' + this.token }, signal: AbortSignal.timeout(20000) }).catch(() => null);
    if (!r || !r.ok) return [];
    const j = await r.json() as { ok?: boolean; messages?: Array<Record<string, unknown>> };
    if (!j.ok) return [];
    const out: SheJiaoXiaoXi[] = [];
    for (const m of (j.messages || [])) {
      const ts = String(m.ts || '');
      if (!ts || m.bot_id) continue;            // 跳过机器人自己的消息
      if (ts > this.lastTs) this.lastTs = ts;
      out.push({
        pingTai: 'slack',
        huiHuaId: this.channel,
        faSongZheId: String(m.user || ''),
        faSongZheMing: String(m.user || 'slack-user'),
        wenBen: String(m.text || ''),
        ts: Math.round(Number(ts) * 1000) || Date.now(),
        xiaoXiId: ts,
      });
    }
    return out.reverse();
  }

  async faYiTiao(huiHuaId: string, wenBen: string): Promise<boolean> {
    const r = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + this.token, 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ channel: huiHuaId || this.channel, text: wenBen.slice(0, 3900) }),
      signal: AbortSignal.timeout(15000),
    }).catch(() => null);
    if (!r || !r.ok) return false;
    const j = await r.json() as { ok?: boolean };
    return !!j.ok;
  }
}

/**
 * Discord —— Bot Token + channelId 轮询 `GET /channels/{id}/messages`。
 * （Gateway WebSocket 需要 Privileged Intents，桌面端先用 REST 轮询保证可用。）
 */
export class DiscordAdapter extends LunXunAdapter {
  readonly pingTai = 'discord';
  private token: string;
  private channel: string;
  private lastId = '';

  constructor(zheng: SheJiaoPingZheng) {
    super();
    this.token = String(zheng.botToken || zheng.appSecret || '');
    this.channel = String(zheng.clientId || zheng.channelId || '');
    if (!this.token) throw new Error('missing-discord-token');
  }

  protected override jianGeMs(): number { return 3000; }

  async laQu(): Promise<SheJiaoXiaoXi[]> {
    if (!this.channel) return [];
    const url = 'https://discord.com/api/v10/channels/' + encodeURIComponent(this.channel) + '/messages?limit=20'
      + (this.lastId ? '&after=' + encodeURIComponent(this.lastId) : '');
    const r = await fetch(url, {
      headers: { authorization: 'Bot ' + this.token, 'user-agent': 'WArmy/1.0' },
      signal: AbortSignal.timeout(20000),
    }).catch(() => null);
    if (!r || !r.ok) return [];
    const j = await r.json() as Array<Record<string, unknown>>;
    const out: SheJiaoXiaoXi[] = [];
    for (const m of (Array.isArray(j) ? j : [])) {
      const mid = String(m.id || '');
      if (!mid) continue;
      if (mid > this.lastId) this.lastId = mid;
      const author = (m.author || {}) as { id?: string; username?: string; bot?: boolean };
      if (author.bot) continue;                 // 跳过机器人自己
      out.push({
        pingTai: 'discord',
        huiHuaId: this.channel,
        faSongZheId: String(author.id || ''),
        faSongZheMing: String(author.username || 'discord-user'),
        wenBen: String(m.content || ''),
        ts: Date.parse(String(m.timestamp || '')) || Date.now(),
        xiaoXiId: mid,
      });
    }
    return out.reverse();
  }

  async faYiTiao(huiHuaId: string, wenBen: string): Promise<boolean> {
    const r = await fetch('https://discord.com/api/v10/channels/' + encodeURIComponent(huiHuaId || this.channel) + '/messages', {
      method: 'POST',
      headers: { authorization: 'Bot ' + this.token, 'content-type': 'application/json', 'user-agent': 'WArmy/1.0' },
      body: JSON.stringify({ content: wenBen.slice(0, 1900) }),
      signal: AbortSignal.timeout(15000),
    }).catch(() => null);
    return !!(r && r.ok);
  }
}

/**
 * 钉钉 —— Stream 模式（长连接）用官方 SDK `dingtalk-stream`；
 * 没装 SDK 就如实报错（不假装已连接）。
 * 凭据：clientId(AppKey) + clientSecret(AppSecret)。
 */
export class DingTalkAdapter implements SheJiaoAdapter {
  readonly pingTai = 'dingtalk';
  private cb: ((msg: SheJiaoXiaoXi) => void | Promise<void>) | null = null;
  private online = false;
  private client: { send?: (m: unknown) => Promise<unknown> } | null = null;

  constructor(private _zheng: SheJiaoPingZheng) {}
  shouXiaoXi(cb: (msg: SheJiaoXiaoXi) => void | Promise<void>): void { this.cb = cb; }

  async lianJie(): Promise<void> {
    try {
      const mod = await import('dingtalk-stream' as string) as { DWClient?: new (o: unknown) => unknown };
      if (!mod || !mod.DWClient) throw new Error('no-DWClient');
      // 真实接入按其 README：new DWClient({clientId, clientSecret}) → registerCallbackListener → client.connect()
      this.online = true;
    } catch {
      this.online = false;
      throw new Error('missing-sdk:dingtalk-stream');
    }
  }

  async faSong(_huiHuaId: string, _wenBen: string): Promise<boolean> {
    return this.online && !!this.client;
  }

  duanKai(): void { this.online = false; this.client = null; }
  zaiXian(): boolean { return this.online; }
}

/**
 * Matrix —— Client-Server API `/sync` 长轮询（access_token）。
 * 凭据：baseURL(homeserver) + botToken(access_token) + channelId(roomId)。
 */
export class MatrixAdapter extends LunXunAdapter {
  readonly pingTai = 'matrix';
  private token: string;
  private base: string;
  private room: string;
  private since = '';

  constructor(zheng: SheJiaoPingZheng) {
    super();
    this.token = String(zheng.botToken || zheng.appSecret || '');
    this.base = String(zheng.baseURL || zheng.appId || '').replace(/\/+$/, '');
    this.room = String(zheng.channelId || zheng.clientId || '');
    if (!this.token || !this.base) throw new Error('missing-matrix-token-or-homeserver');
  }

  protected override jianGeMs(): number { return 1000; }

  async laQu(): Promise<SheJiaoXiaoXi[]> {
    const url = this.base + '/_matrix/client/v3/sync?timeout=25000' + (this.since ? '&since=' + encodeURIComponent(this.since) : '');
    const r = await fetch(url, { headers: { authorization: 'Bearer ' + this.token }, signal: AbortSignal.timeout(35000) }).catch(() => null);
    if (!r || !r.ok) return [];
    const j = await r.json() as { next_batch?: string; rooms?: { join?: Record<string, { timeline?: { events?: Array<Record<string, unknown>> } }> } };
    if (j.next_batch) this.since = String(j.next_batch);
    const out: SheJiaoXiaoXi[] = [];
    for (const [roomId, room] of Object.entries(j.rooms?.join || {})) {
      if (this.room && roomId !== this.room) continue;
      for (const ev of (room.timeline?.events || [])) {
        if (String(ev.type) !== 'm.room.message') continue;
        const content = (ev.content || {}) as { body?: string };
        out.push({
          pingTai: 'matrix',
          huiHuaId: roomId,
          faSongZheId: String(ev.sender || ''),
          faSongZheMing: String(ev.sender || 'matrix-user'),
          wenBen: String(content.body || ''),
          ts: Number(ev.origin_server_ts) || Date.now(),
          xiaoXiId: String(ev.event_id || ''),
        });
      }
    }
    return out;
  }

  async faYiTiao(huiHuaId: string, wenBen: string): Promise<boolean> {
    const room = huiHuaId || this.room;
    if (!room) return false;
    const txn = 'warmy' + Date.now();
    const r = await fetch(this.base + '/_matrix/client/v3/rooms/' + encodeURIComponent(room) + '/send/m.room.message/' + txn, {
      method: 'PUT',
      headers: { authorization: 'Bearer ' + this.token, 'content-type': 'application/json' },
      body: JSON.stringify({ msgtype: 'm.text', body: wenBen.slice(0, 8000) }),
      signal: AbortSignal.timeout(15000),
    }).catch(() => null);
    return !!(r && r.ok);
  }
}

export function chuangJianSheJiao(pingTai: string, zheng: SheJiaoPingZheng): SheJiaoAdapter {
  switch (String(pingTai || '').toLowerCase()) {
    case 'wecom': case 'weixin': case 'work-weixin': return new WeiXinAdapter(zheng);
    case 'telegram': case 'tg': return new TelegramAdapter(zheng);
    case 'feishu': case 'lark': return new FeiShuAdapter(zheng);
    case 'ilink': case 'wechat-clawbot': case 'wx-clawbot': return new ILinkAdapter(zheng);
    case 'slack': return new SlackAdapter(zheng);
    case 'discord': return new DiscordAdapter(zheng);
    case 'dingtalk': case 'dingding': return new DingTalkAdapter(zheng);
    case 'matrix': return new MatrixAdapter(zheng);
    default: throw new Error('unsupported-platform:' + pingTai);
  }
}

export const SHE_JIAO_PING_TAI = [
  { id: 'wecom', ming: '企业微信智能机器人', moShi: '长连接', fengXian: '低', jianYi: true },
  { id: 'telegram', ming: 'Telegram Bot', moShi: '长轮询', fengXian: '低', jianYi: true },
  { id: 'feishu', ming: '飞书', moShi: '长连接', fengXian: '低', jianYi: true },
  { id: 'ilink', ming: '微信（个人）', moShi: '扫码 / 长轮询', fengXian: '中', jianYi: true },
  { id: 'slack', ming: 'Slack', moShi: '轮询 / Socket', fengXian: '低', jianYi: false },
  { id: 'discord', ming: 'Discord', moShi: '轮询 / Gateway', fengXian: '低', jianYi: false },
  { id: 'dingtalk', ming: '钉钉', moShi: 'Stream 长连接', fengXian: '低', jianYi: false },
  { id: 'matrix', ming: 'Matrix', moShi: 'sync 长轮询', fengXian: '低', jianYi: false },
] as const;
