export type LuYouFuWu = { id: string };
export type LuYouJieGuo = { ok: boolean; offline?: boolean; error?: string };
export type KeDaJiLu = { serverId: string; succeededAt: number; failed: boolean };
export type KeDaKuaiZhao = Record<string, KeDaJiLu[]>;
export type LuYouHuiBao = LuYouJieGuo & { serverId?: string; networkUnavailable: boolean };

export class HuiHuaLuYou {
  private cache = new Map<string, KeDaJiLu[]>();
  private unsafe = new Set<string>();
  constructor(
    initial: KeDaKuaiZhao = {},
    private changed: (snapshot: KeDaKuaiZhao) => void = () => {},
    private now: () => number = Date.now,
    private timeoutMs = 8_000,
  ) {
    for (const [sid, records] of Object.entries(initial)) {
      if (!Array.isArray(records)) continue;
      const seen = new Set<string>();
      this.cache.set(sid, records.filter((r) => {
        if (!r || typeof r.serverId !== 'string' || seen.has(r.serverId) || !Number.isFinite(r.succeededAt)) return false;
        seen.add(r.serverId); return true;
      }).slice(0, 5).map((r) => ({ ...r, failed: r.failed === true })));
    }
  }
  snapshot(): KeDaKuaiZhao {
    return Object.fromEntries([...this.cache].map(([sid, rows]) => [sid, rows.map((r) => ({ ...r }))]));
  }
  ban(serverId: string): void {
    this.unsafe.add(serverId);
    this.removeFromCache(serverId);
  }
  remove(serverId: string): void {
    this.unsafe.delete(serverId);
    this.removeFromCache(serverId);
  }
  forgetSession(sessionId: string): void {
    this.cache.delete(sessionId); this.changed(this.snapshot());
  }
  private removeFromCache(serverId: string): void {
    for (const [sid, rows] of this.cache) this.cache.set(sid, rows.filter((r) => r.serverId !== serverId));
    this.changed(this.snapshot());
  }
  private success(sid: string, serverId: string): void {
    if (this.unsafe.has(serverId)) return;
    const rows = (this.cache.get(sid) || []).filter((r) => r.serverId !== serverId);
    rows.unshift({ serverId, succeededAt: this.now(), failed: false });
    this.cache.set(sid, rows.slice(0, 5)); this.changed(this.snapshot());
  }
  private failure(sid: string, serverId: string): void {
    const rows = this.cache.get(sid) || [];
    const record = rows.find((r) => r.serverId === serverId);
    if (!record) return;
    if (record.failed) this.cache.set(sid, rows.filter((r) => r !== record));
    else record.failed = true;
    this.changed(this.snapshot());
  }
  async send<T extends LuYouFuWu>(
    sid: string,
    providers: T[],
    deliver: (provider: T, signal: AbortSignal) => Promise<LuYouJieGuo>,
  ): Promise<LuYouHuiBao> {
    const configured = new Map(providers.slice(0, 1000).filter((p) => p && !this.unsafe.has(p.id)).map((p) => [p.id, p]));
    const attempted = new Set<string>();
    const attempt = async (p: T, control: AbortController): Promise<LuYouJieGuo> => {
      attempted.add(p.id);
      let timer: ReturnType<typeof setTimeout>;
      const timeout = new Promise<LuYouJieGuo>((resolve) => {
        timer = setTimeout(() => { resolve({ ok: false, error: 'timeout' }); control.abort(); }, this.timeoutMs);
      });
      try {
        const result = await Promise.race([Promise.resolve().then(() => deliver(p, control.signal)), timeout]);
        if (this.unsafe.has(p.id)) return { ok: false, error: 'unsafe-provider' };
        return result;
      } catch { return { ok: false, error: 'transport-failed' }; }
      finally { clearTimeout(timer!); }
    };
    const cached = (this.cache.get(sid) || []).map((r) => configured.get(r.serverId)).filter((p): p is T => !!p);
    for (const p of cached) {
      const r = await attempt(p, new AbortController());
      if (r.ok || r.offline) {
        this.success(sid, p.id);
        return { ...r, serverId: p.id, networkUnavailable: false };
      }
      this.failure(sid, p.id);
    }
    const remaining = [...configured.values()].filter((p) => !attempted.has(p.id));
    for (let at = 0; at < remaining.length; at += 5) {
      const batch = remaining.slice(at, at + 5);
      const controls = batch.map(() => new AbortController());
      const winner = await new Promise<LuYouHuiBao | null>((resolve) => {
        let pending = batch.length, won = false;
        batch.forEach((p, i) => {
          void attempt(p, controls[i]!).then((r) => {
            if (r.ok || r.offline) {
              this.success(sid, p.id);
              if (!won) {
                won = true;
                resolve({ ...r, serverId: p.id, networkUnavailable: false });
                controls.forEach((c, index) => { if (index !== i) c.abort(); });
              }
            } else if (!won) this.failure(sid, p.id);
            pending--;
            if (!pending && !won) resolve(null);
          });
        });
      });
      if (winner) return winner;
    }
    return { ok: false, networkUnavailable: true, error: 'no-reachable-provider' };
  }
}
