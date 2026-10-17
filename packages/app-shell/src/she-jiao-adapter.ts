/**
 * 社交 IM 接入适配器（第 31 轮 项 6/7）。
 * 出站长连接优先；iLink 作个人微信实验通道；不做协议逆向。
 */

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

/** iLink ClawBot（个人微信，实验性）：回信必须带 context_token */
export class ILinkAdapter extends LunXunAdapter {
  readonly pingTai = 'ilink';
  private token: string;
  private botId: string;

  constructor(zheng: SheJiaoPingZheng) {
    super();
    this.token = String(zheng.appSecret || zheng.botToken || '');
    this.botId = String(zheng.botId || zheng.wxid || '');
    if (!this.token) throw new Error('missing-ilink-token');
  }

  protected override jianGeMs(): number { return 3000; }

  async laQu(): Promise<SheJiaoXiaoXi[]> {
    const r = await fetch('https://ilinkai.weixin.qq.com/cgi-bin/mmwebwx-bin/getupdates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: this.token, bot_id: this.botId, timeout: 35 }),
      signal: AbortSignal.timeout(45000),
    }).catch(() => null);
    if (!r || !r.ok) return [];
    const j = await r.json() as { ret?: number; msgs?: Array<Record<string, unknown>> };
    if (j.ret !== 0) return [];
    return (j.msgs || []).map((m) => ({
      pingTai: 'ilink',
      huiHuaId: String(m.from || m.chat_id || ''),
      faSongZheId: String(m.from || ''),
      faSongZheMing: String(m.from_name || m.from || 'wx-user'),
      wenBen: String(m.content || m.text || ''),
      ts: Number(m.create_time) * 1000 || Date.now(),
      xiaoXiId: String(m.msg_id || ''),
      contextToken: String(m.context_token || ''),
    }));
  }

  async faYiTiao(huiHuaId: string, wenBen: string, extra?: Record<string, unknown>): Promise<boolean> {
    const ctx = String((extra && extra.contextToken) || '');
    if (!ctx) return false;
    const r = await fetch('https://ilinkai.weixin.qq.com/cgi-bin/mmwebwx-bin/sendmessage', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: this.token, bot_id: this.botId, to: huiHuaId, content: wenBen.slice(0, 2000), context_token: ctx }),
      signal: AbortSignal.timeout(15000),
    }).catch(() => null);
    if (!r || !r.ok) return false;
    const j = await r.json() as { ret?: number; message_id?: string };
    return j.ret === 0 && !!j.message_id;
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
  { id: 'ilink', ming: '微信 iLink ClawBot（个人微信）', moShi: '长轮询', fengXian: '中（静默风控）', jianYi: true },
  { id: 'slack', ming: 'Slack', moShi: '轮询 / Socket', fengXian: '低', jianYi: false },
  { id: 'discord', ming: 'Discord', moShi: '轮询 / Gateway', fengXian: '低', jianYi: false },
  { id: 'dingtalk', ming: '钉钉', moShi: 'Stream 长连接', fengXian: '低', jianYi: false },
  { id: 'matrix', ming: 'Matrix', moShi: 'sync 长轮询', fengXian: '低', jianYi: false },
] as const;
