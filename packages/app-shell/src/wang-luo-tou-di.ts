/**
 * 网络投递发件箱（W07）
 *
 * 口径：
 *  · 发送前先把整帧**持久化**到收件人级发件箱；进程重启/断线后还能续投；
 *  · 本地保存、正在发送、对端已持久化、对端已读、永久失败是**五个不同状态**；
 *  · 只有收到对端业务 ACK（对端已写入本地存储）才算 persisted，传输成功不算；
 *  · 同一 msgId 重复投递：对端只执行一次，但每次都回 ACK（幂等确认）。
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export type TouDiZhuangTai = 'saved' | 'sending' | 'persisted' | 'read' | 'failed';

export interface TouDiJiLu {
  msgId: string;
  recipientFp: string;
  sessionId: string;
  groupId?: string;
  payload: unknown;
  state: TouDiZhuangTai;
  attempts: number;
  savedAt: number;
  updatedAt: number;
  nextTryAt?: number;
  lastAttemptAt?: number;
  lastError?: string;
  deliveredBy?: string;
  persistedAt?: number;
  readAt?: number;
}

export interface TouDiXuanXiang {
  /** 发件箱根目录（<userData>/net/outbox） */
  dir: string;
  now?: () => number;
  /** 达到后转为 failed（如实失败，不伪装已送达），默认 10 */
  maxAttempts?: number;
  backoffMs?: (attempts: number) => number;
  compactAfterLines?: number;
}

export interface TouDiAck {
  type: 'toudi-ack';
  persisted?: string[];
  read?: string[];
}

export type TouDiSongFa = (jiLu: TouDiJiLu) => Promise<{ ok: boolean; by?: string; error?: string }>;

export interface TouDiFuWuXuanXiang {
  xiang: WangLuoFaJianXiang;
  song: TouDiSongFa;
  now?: () => number;
  flushIntervalMs?: number;
  onEvent?: (e: { type: string; detail?: string; msgId?: string; peer?: string; ts: number }) => void;
}

function zhiWenXiangTong(a: string, b: string): boolean {
  return String(a || '').trim().toUpperCase() === String(b || '').trim().toUpperCase();
}

function shouJianRenWenJian(dir: string, fp: string): string {
  const h = createHash('sha256').update(String(fp || '').trim().toUpperCase(), 'utf8').digest('hex').slice(0, 16);
  return path.join(dir, `${h}.jsonl`);
}

function duJiLu(x: unknown): TouDiJiLu | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Partial<TouDiJiLu>;
  if (typeof o.msgId !== 'string' || !o.msgId) return null;
  if (typeof o.recipientFp !== 'string' || !o.recipientFp) return null;
  const zt = o.state;
  if (zt !== 'saved' && zt !== 'sending' && zt !== 'persisted' && zt !== 'read' && zt !== 'failed') return null;
  return {
    msgId: o.msgId,
    recipientFp: o.recipientFp,
    sessionId: typeof o.sessionId === 'string' ? o.sessionId : '',
    ...(typeof o.groupId === 'string' ? { groupId: o.groupId } : {}),
    payload: o.payload,
    state: zt,
    attempts: Number.isFinite(o.attempts) ? Number(o.attempts) : 0,
    savedAt: Number(o.savedAt) || 0,
    updatedAt: Number(o.updatedAt) || 0,
    ...(Number.isFinite(o.nextTryAt) ? { nextTryAt: Number(o.nextTryAt) } : {}),
    ...(Number.isFinite(o.lastAttemptAt) ? { lastAttemptAt: Number(o.lastAttemptAt) } : {}),
    ...(typeof o.lastError === 'string' ? { lastError: o.lastError } : {}),
    ...(typeof o.deliveredBy === 'string' ? { deliveredBy: o.deliveredBy } : {}),
    ...(Number.isFinite(o.persistedAt) ? { persistedAt: Number(o.persistedAt) } : {}),
    ...(Number.isFinite(o.readAt) ? { readAt: Number(o.readAt) } : {}),
  };
}

export class WangLuoFaJianXiang {
  private readonly now: () => number;
  private readonly maxAttempts: number;
  private readonly backoffMs: (attempts: number) => number;
  private readonly compactAfterLines: number;
  /** key = msgId + NUL + recipientFp（大小写归一） */
  private readonly jiLu = new Map<string, TouDiJiLu>();
  private readonly wenJianHang = new Map<string, number>();

  constructor(private readonly opts: TouDiXuanXiang) {
    this.now = opts.now ?? (() => Date.now());
    this.maxAttempts = opts.maxAttempts ?? 10;
    this.backoffMs = opts.backoffMs ?? ((n) => Math.min(30_000, 500 * 2 ** Math.max(0, n - 1)));
    this.compactAfterLines = opts.compactAfterLines ?? 400;
    this.reload();
  }

  private jian(msgId: string, fp: string): string {
    return `${msgId}\u0000${String(fp || '').trim().toUpperCase()}`;
  }

  private reload(): void {
    this.jiLu.clear();
    this.wenJianHang.clear();
    let names: string[] = [];
    try {
      names = fs.readdirSync(this.opts.dir).filter((n) => n.endsWith('.jsonl'));
    } catch {
      return;
    }
    for (const name of names) {
      const file = path.join(this.opts.dir, name);
      let text = '';
      try {
        text = fs.readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      const lines = text.split('\n').filter((l) => l.trim());
      this.wenJianHang.set(file, lines.length);
      for (const line of lines) {
        let rec: TouDiJiLu | null = null;
        try {
          rec = duJiLu(JSON.parse(line));
        } catch {
          rec = null;
        }
        if (rec) this.jiLu.set(this.jian(rec.msgId, rec.recipientFp), rec);
      }
    }
  }

  /** 进程重启：上次没等到 ACK 的 sending 一律回到 saved，重新排期（不视为已送达） */
  recover(): number {
    let n = 0;
    for (const rec of this.jiLu.values()) {
      if (rec.state !== 'sending') continue;
      rec.state = 'saved';
      rec.updatedAt = this.now();
      rec.nextTryAt = this.now();
      this.append(rec);
      n += 1;
    }
    return n;
  }

  private append(rec: TouDiJiLu): void {
    const file = shouJianRenWenJian(this.opts.dir, rec.recipientFp);
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const line = JSON.stringify(rec) + '\n';
      const fd = fs.openSync(file, 'a');
      try {
        fs.writeSync(fd, line);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      const n = (this.wenJianHang.get(file) ?? 0) + 1;
      this.wenJianHang.set(file, n);
      if (n >= this.compactAfterLines) this.compactFile(file);
    } catch {
      // 持久化失败时不能把它当成已保存：抛出让调用方如实失败
      throw new Error('outbox-write-failed');
    }
  }

  private compactFile(file: string): void {
    const rows: TouDiJiLu[] = [];
    for (const rec of this.jiLu.values()) {
      if (shouJianRenWenJian(this.opts.dir, rec.recipientFp) === file) rows.push(rec);
    }
    const tmp = `${file}.tmp`;
    try {
      fs.writeFileSync(tmp, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''), 'utf8');
      fs.renameSync(tmp, file);
      this.wenJianHang.set(file, rows.length);
    } catch {
      try { fs.unlinkSync(tmp); } catch { /* noop */ }
    }
  }

  save(input: {
    msgId: string;
    recipientFp: string;
    sessionId: string;
    groupId?: string;
    payload: unknown;
  }): TouDiJiLu {
    const fp = String(input.recipientFp || '').trim().toUpperCase();
    const key = this.jian(input.msgId, fp);
    const cunZai = this.jiLu.get(key);
    if (cunZai) return { ...cunZai };
    const t = this.now();
    const jiLu: TouDiJiLu = {
      msgId: String(input.msgId),
      recipientFp: fp,
      sessionId: String(input.sessionId || ''),
      ...(input.groupId ? { groupId: String(input.groupId) } : {}),
      payload: input.payload,
      state: 'saved',
      attempts: 0,
      savedAt: t,
      updatedAt: t,
      nextTryAt: t,
    };
    this.append(jiLu);
    this.jiLu.set(key, jiLu);
    return { ...jiLu };
  }

  get(msgId: string, recipientFp: string): TouDiJiLu | null {
    const rec = this.jiLu.get(this.jian(msgId, recipientFp));
    return rec ? { ...rec } : null;
  }

  pending(recipientFp?: string): TouDiJiLu[] {
    return [...this.jiLu.values()]
      .filter((r) => (r.state === 'saved' || r.state === 'sending'))
      .filter((r) => !recipientFp || zhiWenXiangTong(r.recipientFp, recipientFp))
      .map((r) => ({ ...r }));
  }

  bySession(sessionId: string): TouDiJiLu[] {
    return [...this.jiLu.values()]
      .filter((r) => r.sessionId === sessionId)
      .sort((a, b) => a.savedAt - b.savedAt)
      .map((r) => ({ ...r }));
  }

  stats(): Record<TouDiZhuangTai, number> {
    const out: Record<TouDiZhuangTai, number> = { saved: 0, sending: 0, persisted: 0, read: 0, failed: 0 };
    for (const r of this.jiLu.values()) out[r.state] += 1;
    return out;
  }

  private gengXin(rec: TouDiJiLu, patch: Partial<TouDiJiLu>): TouDiJiLu {
    Object.assign(rec, patch, { updatedAt: this.now() });
    this.append(rec);
    return { ...rec };
  }

  markSending(msgId: string, recipientFp: string): TouDiJiLu | null {
    const rec = this.jiLu.get(this.jian(msgId, recipientFp));
    if (!rec || rec.state === 'persisted' || rec.state === 'read') return null;
    const attempts = rec.attempts + 1;
    return this.gengXin(rec, {
      state: 'sending',
      attempts,
      lastAttemptAt: this.now(),
      nextTryAt: this.now() + this.backoffMs(attempts),
    });
  }

  /** 传输成功只说明"对端连上了"，状态仍是 sending，等业务 ACK */
  recordSent(msgId: string, recipientFp: string, by?: string): TouDiJiLu | null {
    const rec = this.jiLu.get(this.jian(msgId, recipientFp));
    if (!rec || rec.state === 'persisted' || rec.state === 'read') return null;
    // 发得出去但从没等到 ACK：到上限就如实失败，不无限重发
    if (rec.attempts >= this.maxAttempts) {
      return this.gengXin(rec, {
        state: 'failed',
        lastError: rec.lastError || 'no-ack',
        ...(by ? { deliveredBy: by } : {}),
        nextTryAt: this.now() + this.backoffMs(this.maxAttempts),
      });
    }
    return this.gengXin(rec, {
      state: 'sending',
      ...(by ? { deliveredBy: by } : {}),
      lastError: undefined,
      nextTryAt: this.now() + 30_000,
    });
  }

  recordFailure(msgId: string, recipientFp: string, error: string): TouDiJiLu | null {
    const rec = this.jiLu.get(this.jian(msgId, recipientFp));
    if (!rec || rec.state === 'persisted' || rec.state === 'read') return null;
    const attempts = Math.max(1, rec.attempts);
    const yongJiu = attempts >= this.maxAttempts;
    return this.gengXin(rec, {
      state: yongJiu ? 'failed' : 'saved',
      lastError: String(error || 'send-failed').slice(0, 300),
      nextTryAt: this.now() + this.backoffMs(attempts),
    });
  }

  markPersisted(msgId: string, recipientFp: string, by?: string): TouDiJiLu | null {
    const rec = this.jiLu.get(this.jian(msgId, recipientFp));
    if (!rec) return null;
    if (rec.state === 'read') return { ...rec };
    return this.gengXin(rec, {
      state: 'persisted',
      persistedAt: this.now(),
      lastError: undefined,
      ...(by ? { deliveredBy: by } : {}),
    });
  }

  markRead(msgId: string, recipientFp: string, by?: string): TouDiJiLu | null {
    const rec = this.jiLu.get(this.jian(msgId, recipientFp));
    if (!rec) return null;
    return this.gengXin(rec, {
      state: 'read',
      readAt: this.now(),
      ...(rec.persistedAt ? {} : { persistedAt: this.now() }),
      ...(by ? { deliveredBy: by } : {}),
    });
  }
}

export class TouDiFuWu {
  private readonly now: () => number;
  private readonly flushIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;

  constructor(private readonly opts: TouDiFuWuXuanXiang) {
    this.now = opts.now ?? (() => Date.now());
    this.flushIntervalMs = opts.flushIntervalMs ?? 20_000;
    this.opts.xiang.recover();
  }

  get xiang(): WangLuoFaJianXiang {
    return this.opts.xiang;
  }

  private event(type: string, detail?: string, extra?: { msgId?: string; peer?: string }): void {
    try {
      this.opts.onEvent?.({ type, detail, ts: this.now(), ...extra });
    } catch {
      /* 事件回调失败不影响投递 */
    }
  }

  enqueue(args: { msgId: string; sessionId: string; groupId?: string; payload: unknown; recipients: string[] }): TouDiJiLu[] {
    const out: TouDiJiLu[] = [];
    for (const fp of args.recipients) {
      if (!fp) continue;
      const rec = this.opts.xiang.save({
        msgId: args.msgId,
        recipientFp: fp,
        sessionId: args.sessionId,
        ...(args.groupId ? { groupId: args.groupId } : {}),
        payload: args.payload,
      });
      out.push(rec);
    }
    if (out.length) this.event('toudi-enqueued', `${out.length}`, { msgId: args.msgId });
    return out;
  }

  /** 对端持久化后回执；只认收件人本人的回执，未知 msgId 一律忽略 */
  ack(peerFp: string, payload: TouDiAck): { persisted: number; read: number; ignored: number } {
    let persisted = 0;
    let read = 0;
    let ignored = 0;
    const peer = String(peerFp || '');
    for (const id of Array.isArray(payload.persisted) ? payload.persisted : []) {
      const r = this.opts.xiang.markPersisted(String(id), peer, peer);
      if (r) {
        persisted += 1;
        this.event('toudi-persisted', undefined, { msgId: String(id), peer });
      } else ignored += 1;
    }
    for (const id of Array.isArray(payload.read) ? payload.read : []) {
      const r = this.opts.xiang.markRead(String(id), peer, peer);
      if (r) {
        read += 1;
        this.event('toudi-read', undefined, { msgId: String(id), peer });
      } else ignored += 1;
    }
    return { persisted, read, ignored };
  }

  async flush(recipientFp?: string): Promise<{ attempted: number; ok: number; failed: number }> {
    if (this.flushing) return { attempted: 0, ok: 0, failed: 0 };
    this.flushing = true;
    let attempted = 0;
    let ok = 0;
    let failed = 0;
    try {
      const due = this.opts.xiang
        .pending(recipientFp)
        .filter((r) => (r.nextTryAt ?? 0) <= this.now());
      for (const rec of due) {
        try {
          const sending = this.opts.xiang.markSending(rec.msgId, rec.recipientFp);
          if (!sending) continue;
          attempted += 1;
          let r: { ok: boolean; by?: string; error?: string };
          try {
            r = await this.opts.song(sending);
          } catch (e) {
            r = { ok: false, error: (e as Error).message };
          }
          if (r.ok) {
            const nowJieGuo = this.opts.xiang.recordSent(rec.msgId, rec.recipientFp, r.by);
            ok += 1;
            if (nowJieGuo?.state === 'failed') this.event('toudi-permanent-failed', 'no-ack', { msgId: rec.msgId, peer: rec.recipientFp });
          } else {
            const now = this.opts.xiang.recordFailure(rec.msgId, rec.recipientFp, r.error ?? 'send-failed');
            failed += 1;
            this.event('toudi-failed', r.error, { msgId: rec.msgId, peer: rec.recipientFp });
            if (now?.state === 'failed') this.event('toudi-permanent-failed', r.error, { msgId: rec.msgId, peer: rec.recipientFp });
          }
        } catch {
          // 单条记录写盘失败不应中断整批续投；下轮会再试
          failed += 1;
        }
      }
    } finally {
      this.flushing = false;
    }
    return { attempted, ok, failed };
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.flush().catch(() => {}); }, this.flushIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}
