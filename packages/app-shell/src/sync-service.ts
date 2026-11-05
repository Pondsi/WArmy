/**
 * R125 任务15：终端同步服务（用户拍板口径 docs/SYNC-MULTIDEVICE-R124.md §9.9）
 *
 * 语义（用户原话 15.0-15.10）：
 *  · 手动触发；同步内容可勾选；触发设备为准的删除 + 修改/添加谁新听谁的（LWW）
 *  · 设备列表各终端本地维护（不同步）；配对 = 一次性配对码（二维码/链接）
 *  · 自锁：同步期间只锁勾选的数据域；同步进行中不能再开同步
 *  · 强制解锁：本地生效 + 在线设备广播移除配对
 *  · 删除/修改记录（2 年 tombstone）跟随同步内容传播
 *
 * 数据模型（第一版，文件级 op）：
 *  · SyncEntry { domain, id, kind: add|mod|del, ts, hash, data }
 *  · 同步包 = 触发设备勾选域的**当前完整导出**（add/mod 带本机 ts）+ 触发设备
 *    2 年 tombstone 的 del 记录；接收方按 LWW 应用、按 del 记录删除、自己删过
 *    但触发设备还有的条目重新添加（回填）。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type SyncDomain = 'chat' | 'dao' | 'shu' | 'yinxiang' | 'kb1' | 'kb2' | 'kb3' | 'models' | 'settings';

export const SYNC_DOMAINS: ReadonlyArray<SyncDomain> = ['chat', 'dao', 'shu', 'yinxiang', 'kb1', 'kb2', 'kb3', 'models', 'settings'];

export interface SyncEntry {
  domain: SyncDomain;
  id: string;
  kind: 'add' | 'mod' | 'del';
  ts: number;
  hash?: string;
  data?: string;
}

export interface SyncDevice {
  id: string;
  ming: string;
  fingerprint: string;
  pairedAt: number;
  lastSeenAt: number;
  online: boolean;
  revoked?: boolean;
  /** 配对此设备时使用的 token（本机作为被配对方时，用于向对方证明配对资格） */
  token?: string;
}

export interface SyncState {
  enabled: boolean;
  network: string;
  selfId: string;
  devices: SyncDevice[];
  domains: Record<SyncDomain, boolean>;
  sessions: Record<string, { sid: string; name: string; sync: boolean }>;
  syncing: boolean;
  lockedDomains: SyncDomain[];
  lastSyncAt: number;
  lastSyncResult: string;
}

export interface SyncPushPayload {
  from: string;
  fromMing: string;
  ts: number;
  entries: SyncEntry[];
  dels: Array<{ domain: SyncDomain; id: string; ts: number }>;
}

export interface SyncServiceOptions {
  userDataDir: string;
  selfDeviceId: string;
  selfMing: string;
  onStateChange?: (state: SyncState) => void;
  /** 通过 SecureMesh control 通道给某设备（指纹）发消息 */
  sendToDevice?: (fingerprint: string, payload: Record<string, unknown>) => void;
  /** 当前在线设备指纹集合（SecureMesh 活跃连接） */
  onlinePeers?: () => string[];
  /** 宿主为各域提供导出函数（chat 会话勾选等）；缺省域返回 null */
  domainExport?: (domain: SyncDomain, sessions: Record<string, { sid: string; name: string; sync: boolean }>) => Array<{ id: string; ts: number; data?: string; kind?: 'add' | 'mod' }> | null;
}

const TOMBSTONE_MS = 2 * 365 * 24 * 3600 * 1000; // 2 年删除记录

export class SyncService {
  private readonly dir: string;
  private readonly options: SyncServiceOptions;
  private devices: SyncDevice[] = [];
  private domains: Record<SyncDomain, boolean> = { chat: true, dao: true, shu: true, yinxiang: true, kb1: true, kb2: true, kb3: true, models: true, settings: true };
  private sessions: Record<string, { sid: string; name: string; sync: boolean }> = {};
  private pairs: Array<{ token: string; deviceId: string; ming: string; fingerprint: string; expiresAt: number }> = [];
  /** 被本机强制解锁过的设备 id：其旧 token 一律作废，重新上线不自动复活配对 */
  private revokedIds: string[] = [];
  /** tombstone：跟随同步传播的删除/修改记录（2 年保留） */
  private tombstones: Array<{ domain: SyncDomain; id: string; ts: number }> = [];
  private syncing = false;
  private lockedDomains: SyncDomain[] = [];
  private lastSyncAt = 0;
  private lastSyncResult = '';
  private enabled = false;
  private network = 'lan';

  constructor(options: SyncServiceOptions) {
    this.options = options;
    this.dir = path.join(options.userDataDir, 'sync');
    fs.mkdirSync(this.dir, { recursive: true });
    this.load();
  }

  private load() {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(this.dir, 'devices.json'), 'utf8')) as {
        devices?: SyncDevice[]; enabled?: boolean; network?: string; lastSyncAt?: number; revokedIds?: string[];
      };
      this.devices = Array.isArray(raw.devices) ? raw.devices : [];
      this.enabled = raw.enabled === true;
      this.network = String(raw.network || 'lan');
      this.lastSyncAt = Number(raw.lastSyncAt) || 0;
      this.revokedIds = Array.isArray(raw.revokedIds) ? raw.revokedIds : [];
    } catch { /* fresh */ }
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(this.dir, 'options.json'), 'utf8')) as {
        domains?: Partial<Record<SyncDomain, boolean>>; sessions?: Record<string, { sid: string; name: string; sync: boolean }>;
      };
      if (raw.domains) {
        this.domains = { ...this.domains, ...raw.domains };
        // R125：旧 memory 域拆分为道/术/印象三域，勾选继承原 memory 值
        if ('memory' in raw.domains) {
          const mem = !!raw.domains.memory;
          for (const d of ['dao', 'shu', 'yinxiang'] as SyncDomain[]) if (!(d in this.domains)) this.domains[d] = mem;
        }
      }
      if (raw.sessions) this.sessions = raw.sessions;
    } catch { /* fresh */ }
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(this.dir, 'pairs.json'), 'utf8')) as { pairs?: Array<{ token: string; deviceId: string; ming: string; fingerprint: string; expiresAt: number }> };
      this.pairs = Array.isArray(raw?.pairs) ? raw.pairs : [];
    } catch { /* fresh */ }
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(this.dir, 'tombstones.json'), 'utf8')) as { tombstones?: Array<{ domain: SyncDomain; id: string; ts: number }> };
      this.tombstones = Array.isArray(raw?.tombstones) ? raw.tombstones : [];
    } catch { /* fresh */ }
  }

  private save() {
    try {
      fs.writeFileSync(path.join(this.dir, 'devices.json'), JSON.stringify({
        devices: this.devices, enabled: this.enabled, network: this.network, lastSyncAt: this.lastSyncAt, revokedIds: this.revokedIds,
      }, null, 2));
      fs.writeFileSync(path.join(this.dir, 'options.json'), JSON.stringify({ domains: this.domains, sessions: this.sessions }, null, 2));
      fs.writeFileSync(path.join(this.dir, 'pairs.json'), JSON.stringify({ pairs: this.pairs }, null, 2));
      fs.writeFileSync(path.join(this.dir, 'tombstones.json'), JSON.stringify({ tombstones: this.tombstones }, null, 2));
    } catch { /* 写失败不阻断同步流程 */ }
  }

  private notify() {
    try { this.options.onStateChange?.(this.state()); } catch { /* noop */ }
  }

  state(): SyncState {
    const peers = new Set((this.options.onlinePeers?.() || []).map((f) => String(f).toLowerCase()));
    return {
      enabled: this.enabled,
      network: this.network,
      selfId: this.options.selfDeviceId,
      devices: this.devices.map((d) => ({ ...d, online: !d.revoked && peers.has(String(d.fingerprint).toLowerCase()) })),
      domains: { ...this.domains },
      sessions: { ...this.sessions },
      syncing: this.syncing,
      lockedDomains: [...this.lockedDomains],
      lastSyncAt: this.lastSyncAt,
      lastSyncResult: this.lastSyncResult,
    };
  }

  // ── 配对 ──────────────────────────────────────────────────────────────

  setEnabled(on: boolean) {
    this.enabled = !!on;
    this.save();
    this.notify();
    return this.state();
  }

  setNetwork(net: string) {
    this.network = String(net || 'lan');
    this.save();
    this.notify();
    return this.state();
  }

  setDomainOption(domain: SyncDomain, on: boolean) {
    if (!SYNC_DOMAINS.includes(domain)) return this.state();
    this.domains[domain] = !!on;
    this.save();
    this.notify();
    return this.state();
  }

  setSessionSync(sid: string, name: string, on: boolean) {
    if (!sid) return this.state();
    if (on) this.sessions[sid] = { sid, name: String(name || '').slice(0, 120), sync: true };
    else delete this.sessions[sid];
    this.save();
    this.notify();
    return this.state();
  }

  /** 生成配对码（15 分钟有效）：二维码内容 = 链接 */
  createPairCode(): { token: string; link: string; expiresAt: number } {
    const token = crypto.randomBytes(18).toString('base64url');
    const expiresAt = Date.now() + 15 * 60_000;
    const q = new URLSearchParams({
      t: token,
      d: this.options.selfDeviceId,
      f: '', // 指纹由 SecureMesh 握手提供，链接不写死（防链接泄露后冒充）
      m: this.options.selfMing,
      e: String(expiresAt),
    });
    this.pairs = this.pairs.filter((p) => p.expiresAt > Date.now());
    this.pairs.push({ token, deviceId: this.options.selfDeviceId, ming: this.options.selfMing, fingerprint: '', expiresAt });
    this.save();
    return { token, link: `warmy-sync://pair?${q.toString()}`, expiresAt };
  }

  /**
   * 接受配对：输入二维码/链接内容（warmy-sync://pair?t=…&m=…&e=…）。
   * 对方设备加入本机设备列表；握手完成后由 onDeviceHello 回填指纹。
   */
  acceptPairCode(input: unknown): { ok: boolean; error?: string; token?: string; deviceId?: string; state?: SyncState } {
    const text = String(input || '').trim();
    const url = /^warmy-sync:\/\/pair\?/i.test(text) ? text : `warmy-sync://pair?${text}`;
    let params: URLSearchParams;
    try {
      const u = new URL(url);
      if (u.protocol !== 'warmy-sync:' || u.host !== 'pair') return { ok: false, error: 'bad-link' };
      params = u.searchParams;
    } catch {
      return { ok: false, error: 'bad-link' };
    }
    const token = String(params.get('t') || '');
    const ming = String(params.get('m') || '同步设备').slice(0, 40);
    const expiresAt = Number(params.get('e') || 0);
    const deviceId = String(params.get('d') || '').slice(0, 64);
    if (!token || token.length < 8) return { ok: false, error: 'bad-link' };
    if (expiresAt && expiresAt < Date.now()) return { ok: false, error: 'expired' };
    if (deviceId && deviceId === this.options.selfDeviceId) return { ok: false, error: 'self-pair' };
    const existing = this.devices.find((d) => d.id === deviceId);
    if (existing) {
      existing.revoked = false;
      existing.ming = ming || existing.ming;
      existing.pairedAt = Date.now();
      if (token) existing.token = token;
    } else {
      this.devices.push({ id: deviceId, ming, fingerprint: '', pairedAt: Date.now(), lastSeenAt: 0, online: false, token });
    }
    // 用户主动用新配对码重新配对 = 解除此前的强制解锁
    this.revokedIds = this.revokedIds.filter((x) => x !== deviceId);
    this.save();
    this.notify();
    return { ok: true, token, deviceId, state: this.state() };
  }

  /**
   * 对方设备确认配对（SecureMesh 握手指纹在 onInbound 里拿到后调用）。
   * 已配对设备 → 回填指纹；陌生设备 → 必须带**本机生成且未过期**的配对 token 才允许加入
   * （强制解锁后旧 token 随 pairs 清空而作废，离线设备无法借此复活配对）。
   * 被强制解锁的设备用**新的**配对码重新配对 = 用户主动恢复（解除吊销）。
   */
  onDeviceHello(deviceId: string, ming: string, fingerprint: string, token?: string): boolean | 'rejected' {
    const d = this.devices.find((x) => x.id === deviceId);
    if (d) {
      if (d.revoked || this.revokedIds.includes(deviceId)) {
        // 只有本机当前生成且未过期的配对码能解除强制解锁（旧码已随 forceUnlock 清空）
        const hit = token ? this.pairs.find((p) => p.token === token && p.expiresAt > Date.now()) : null;
        if (!hit || !fingerprint) return 'rejected';
        this.revokedIds = this.revokedIds.filter((x) => x !== deviceId);
        d.revoked = false;
        d.fingerprint = fingerprint || d.fingerprint;
        d.ming = ming || d.ming;
        d.pairedAt = Date.now();
        d.lastSeenAt = Date.now();
        this.save();
        this.notify();
        return true;
      }
      d.fingerprint = fingerprint || d.fingerprint;
      d.ming = ming || d.ming;
      d.revoked = false;
      d.pairedAt = d.pairedAt || Date.now();
      this.save();
      this.notify();
      return true;
    }
    // 陌生设备：只有 token 匹配本机未过期的配对码才加入（双向配对）
    const hit = this.pairs.find((p) => p.token === token && p.expiresAt > Date.now());
    if (hit && fingerprint && deviceId) {
      this.devices.push({ id: deviceId, ming: ming || hit.ming || '同步设备', fingerprint, pairedAt: Date.now(), lastSeenAt: Date.now(), online: true });
      this.save();
      this.notify();
      return true;
    }
    return 'rejected';
  }

  removeDevice(deviceId: string) {
    this.devices = this.devices.filter((d) => d.id !== deviceId);
    this.save();
    this.notify();
    return this.state();
  }

  /** 强制解锁：本机离线 + 广播给在线设备移除这条配对；旧配对 token 全部作废 */
  forceUnlock(deviceId: string): boolean {
    const d = this.devices.find((x) => x.id === deviceId);
    if (!d) return false;
    d.revoked = true;
    d.online = false;
    if (!this.revokedIds.includes(deviceId)) this.revokedIds.push(deviceId);
    this.pairs = []; // 旧配对码作废：重新配对必须生成新码
    this.save();
    try {
      this.options.sendToDevice?.(d.fingerprint, {
        type: 'device-sync-revoke',
        deviceId: this.options.selfDeviceId,
      });
    } catch { /* 广播失败不阻断本地生效 */ }
    this.notify();
    return true;
  }

  /** 对端强制解锁了本机：移除本机上的这条配对 */
  onRevokedByPeer(deviceId: string) {
    this.devices = this.devices.filter((d) => d.id !== deviceId);
    this.save();
    this.notify();
  }

  /** 对端拒绝本机（hello 被拒 / 同步被拒）：本机移除这条配对并如实呈现（兜底解绑） */
  onRejectedByPeer(deviceId: string) {
    this.devices = this.devices.filter((d) => d.id !== deviceId);
    this.save();
    this.notify();
  }

  /** 会话是否勾选了同步（tombstone 记录只针对勾选会话） */
  isSessionSynced(sid: string): boolean {
    try { return !!(this.sessions[String(sid)]?.sync); } catch { return false; }
  }

  // ── 同步执行 ──────────────────────────────────────────────────────────

  /** 手动触发同步（用户拍板：不同步中才能触发） */
  async syncNow(): Promise<SyncState> {
    if (this.syncing) return this.state(); // 同步进行中不能再开同步
    if (!this.enabled) {
      this.lastSyncResult = 'not-enabled';
      this.notify();
      return this.state();
    }
    const targets = this.state().devices.filter((d) => d.online && !d.revoked);
    if (!targets.length) {
      this.lastSyncResult = 'no-peers';
      this.notify();
      return this.state();
    }
    this.syncing = true;
    this.lockedDomains = SYNC_DOMAINS.filter((d) => this.domains[d]);
    this.notify();
    try {
      const payload = this.buildPushPayload();
      let ok = 0;
      let failed = 0;
      for (const t of targets) {
        try {
          if (!this.options.sendToDevice) continue;
          this.options.sendToDevice(t.fingerprint, { type: 'device-sync-push', payload });
          ok += 1;
        } catch {
          failed += 1;
        }
      }
      this.lastSyncAt = Date.now();
      this.lastSyncResult = failed === 0 && ok > 0 ? 'done' : (ok > 0 ? 'partial' : 'send-failed');
      this.save();
    } finally {
      this.syncing = false;
      this.lockedDomains = [];
      this.notify();
    }
    return this.state();
  }

  /** 组装触发设备视角的同步包：勾选域当前导出 + 触发设备 2 年 tombstone del 记录 */
  private buildPushPayload(): SyncPushPayload {
    const entries: SyncEntry[] = [];
    const dels = this.tombstones
      .filter((t) => Date.now() - t.ts <= TOMBSTONE_MS && this.domains[t.domain])
      .map((t) => ({ domain: t.domain, id: t.id, ts: t.ts }));
    for (const domain of SYNC_DOMAINS) {
      if (!this.domains[domain]) continue;
      const items = this.exportDomain(domain);
      for (const it of items) entries.push(it);
    }
    return { from: this.options.selfDeviceId, fromMing: this.options.selfMing, ts: Date.now(), entries, dels };
  }

  /**
   * 接收对端同步包（SecureMesh onInbound type='device-sync-push'）。
   * 应用规则：
   *  · add/mod → LWW（对端 ts 更新才覆盖）
   *  · del（对端 2 年 tombstone 且本机没有对端条目）→ 删除 + 本机 tombstone 记录
   *  · 本机 tombstone 记过 del、但对端包里还有该条目 → 重新添加（回填，触发设备为准）
   */
  applyPushPayload(payload: SyncPushPayload): { accepted: number; deleted: number; refilled: number } {
    if (!payload || !Array.isArray(payload.entries)) return { accepted: 0, deleted: 0, refilled: 0 };
    let accepted = 0;
    let deleted = 0;
    let refilled = 0;
    const peerDels = new Set((Array.isArray(payload.dels) ? payload.dels : []).map((d) => `${d.domain}:${d.id}`));
    for (const e of payload.entries) {
      if (!SYNC_DOMAINS.includes(e.domain) || !this.domains[e.domain]) continue;
      const key = `${e.domain}:${e.id}`;
      if (peerDels.has(key) && this.tombstones.some((t) => t.domain === e.domain && t.id === e.id)) {
        refilled += 1; // 我删过、对方还有 → 回填（对方为准）
      }
      const applied = this.applyEntry(e);
      if (applied) accepted += 1;
    }
    for (const d of Array.isArray(payload.dels) ? payload.dels : []) {
      if (!SYNC_DOMAINS.includes(d.domain)) continue;
      const key = `${d.domain}:${d.id}`;
      const peerHas = payload.entries.some((e) => `${e.domain}:${e.id}` === key);
      if (!peerHas) {
        if (this.removeDomainItem(d.domain, d.id)) deleted += 1;
        if (!this.tombstones.some((t) => t.domain === d.domain && t.id === d.id)) {
          this.tombstones.push({ domain: d.domain, id: d.id, ts: Number(d.ts) || Date.now() });
        }
      }
    }
    this.pruneTombstones();
    this.save();
    return { accepted, deleted, refilled };
  }

  private applyEntry(e: SyncEntry): boolean {
    const key = `${e.domain}:${e.id}`;
    const cur = this.readDomainItem(e.domain, e.id);
    if (cur && Number(cur.ts) >= Number(e.ts)) return false; // LWW：不比自己新
    this.writeDomainItem(e.domain, e.id, e);
    return true;
  }

  private pruneTombstones() {
    const now = Date.now();
    this.tombstones = this.tombstones.filter((t) => now - t.ts <= TOMBSTONE_MS);
  }

  // ── 域数据存取（第一版：userData/sync/data/<domain>/<id>.json，加密随 enc-fs） ──

  private itemPath(domain: SyncDomain, id: string): string {
    const safe = String(id).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'item';
    return path.join(this.dir, 'data', domain, safe + '.json');
  }

  private readDomainItem(domain: SyncDomain, id: string): SyncEntry | null {
    try {
      const j = JSON.parse(fs.readFileSync(this.itemPath(domain, id), 'utf8'));
      return (j && j.kind) ? j as SyncEntry : null;
    } catch { return null; }
  }

  private writeDomainItem(domain: SyncDomain, id: string, e: SyncEntry) {
    const p = this.itemPath(domain, id);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ ...e, data: e.data ?? '', ts: Number(e.ts) || Date.now() }, null, 2));
  }

  private removeDomainItem(domain: SyncDomain, id: string): boolean {
    try {
      const p = this.itemPath(domain, id);
      if (!fs.existsSync(p)) return false;
      fs.rmSync(p, { force: true });
      return true;
    } catch { return false; }
  }

  /** 导出触发设备勾选域的当前条目（由宿主提供数据源提取，见 registerDomainSource） */
  private exportDomain(domain: SyncDomain): SyncEntry[] {
    const src = this.options.domainExport?.(domain, this.sessions);
    if (!src) return [];
    return src.map((e) => {
      const hash = e.data != null ? crypto.createHash('sha256').update(String(e.data)).digest('hex').slice(0, 16) : '';
      return { domain, id: e.id, kind: e.kind || 'add', ts: Number(e.ts) || Date.now(), hash, data: e.data ?? '' };
    });
  }

  recordTombstone(domain: SyncDomain, id: string) {
    if (!this.tombstones.some((t) => t.domain === domain && t.id === id)) {
      this.tombstones.push({ domain, id, ts: Date.now() });
      this.pruneTombstones();
      this.save();
    }
  }

  /** 接收方完成一次应用后调用：更新本机 lastSyncAt（两端的同步时间线） */
  recordLastSync(ts: number) {
    this.lastSyncAt = Math.max(this.lastSyncAt, Number(ts) || Date.now());
    this.save();
  }

  /** 触发端收到 ack：刷新对端上次在线/同步时间 */
  markPeerSeen(deviceId: string, fingerprint: string) {
    const d = this.devices.find((x) => x.id === deviceId);
    if (d) {
      d.lastSeenAt = Date.now();
      if (fingerprint) d.fingerprint = fingerprint || d.fingerprint;
      this.save();
      this.notify();
    }
  }
}
