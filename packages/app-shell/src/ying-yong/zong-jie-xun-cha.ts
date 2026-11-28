/** 统一稳定巡查：只有脏源且15分钟无活动才执行。单任务、版本凭据、取消不推进水位。 */
export const ZONG_JIE_JING_MO_MS = 15 * 60000;
export interface ZongJieShuiWei { seq: number; offset: number }
export interface ZongJieYuan { version: number; changedAt: number; doneVersion: number; watermark?: ZongJieShuiWei; retryAt?: number }
export interface ZongJieXunChaYiLai {
  now: () => number;
  du: () => Record<string, ZongJieYuan> | undefined;
  cun: (state: Record<string, ZongJieYuan>) => void;
  enabled: (id: string) => boolean;
  initialWatermark?: (id: string) => ZongJieShuiWei | undefined;
  targetRevision?: (id: string) => string;
  run: (id: string, ctx: ZongJieRenWu) => Promise<{ ok: boolean; watermark?: ZongJieShuiWei; more?: boolean }>;
  audit?: (reason: string) => void;
}
export interface ZongJieRenWu { signal: AbortSignal; version: number; watermark?: ZongJieShuiWei; models?: string[]; fail?: () => void; afterCommit?: () => void; valid: () => boolean }
export function chuangJianZongJieXunCha(yiLai: ZongJieXunChaYiLai) {
  const state: Record<string, ZongJieYuan> = Object.create(null);
  try {
    for (const [id, s] of Object.entries(yiLai.du() || {})) {
      if (!s || !Number.isFinite(s.version) || !Number.isFinite(s.changedAt) || !Number.isFinite(s.doneVersion) || s.version < 0 || s.doneVersion < 0) continue;
      state[id] = { version: s.version, changedAt: s.changedAt, doneVersion: Math.min(s.doneVersion, s.version), retryAt: Number(s.retryAt) || 0,
        ...(s.watermark && Number.isFinite(s.watermark.seq) && Number.isFinite(s.watermark.offset) && s.watermark.seq >= 0 && s.watermark.offset >= 0 ? { watermark: s.watermark } : {}) };
    }
  } catch { /* 损坏账本不冒充已总结，来源启动核实后重建 */ }
  let active: { id: string; c: AbortController } | undefined;
  const activeHas = (id: string) => !!active && (active.id === id || active.id.split('|').includes(id));
  let stopped = false;
  let dirty = false;
  const queue = new Set(Object.keys(state));
  function bianHua(id: string): void {
    if (!id || stopped) return;
    const old = state[id] || { version: 0, changedAt: 0, doneVersion: 0, watermark: yiLai.initialWatermark?.(id) };
    state[id] = { ...old, ...(id.startsWith('knowledge:') ? { watermark: { seq: 0, offset: 0 } } : {}), version: old.version + 1, changedAt: yiLai.now(), retryAt: 0 };
    queue.add(id); dirty = true;
    if (activeHas(id)) active!.c.abort(new Error('summary-source-changed'));
  }
  function huoDong(id: string): void {
    if (state[id]) { state[id]!.changedAt = yiLai.now(); dirty = true; }
    if (activeHas(id)) active!.c.abort(new Error('summary-foreground'));
  }
  async function xunCha(): Promise<void> {
    if (dirty) { yiLai.cun(state); dirty = false; }
    if (stopped || active) return;
    /* R319：同族任务一次最多并发 4 个；generate 层再合并为一次模型请求，水位/版本仍逐项独立。 */
    const familyOf = (id: string) => id.startsWith('session:') || id.startsWith('knowledge:') || id.startsWith('short-memory:') ? 'facts'
      : id.startsWith('duty:') || id.startsWith('decision:') ? 'duty' : 'improve';
    const ready: Array<{ id: string; s: ZongJieYuan; version: number }> = [];
    let family = '';
    for (const id of queue) {
      if (ready.length >= 4) break;
      queue.delete(id); queue.add(id);
      const s = state[id];
      if (!s || s.version <= s.doneVersion) { queue.delete(id); continue; }
      if (!yiLai.enabled(id) || yiLai.now() - s.changedAt < ZONG_JIE_JING_MO_MS || (s.retryAt || 0) > yiLai.now()) continue;
      const f = familyOf(id);
      if (family && f !== family) continue;
      family = family || f;
      ready.push({ id, s, version: s.version });
    }
    if (!ready.length) return;
    const c = new AbortController();
    active = { id: ready.map((x) => x.id).join('|'), c };
    try {
      await Promise.all(ready.map(async ({ id, s, version }) => {
        let revision = yiLai.targetRevision?.(id);
        const valid = () => !stopped && !c.signal.aborted && yiLai.enabled(id) && state[id]?.version === version
          && yiLai.now() - state[id]!.changedAt >= ZONG_JIE_JING_MO_MS && yiLai.targetRevision?.(id) === revision;
        try {
          const r = await yiLai.run(id, { signal: c.signal, version, watermark: s.watermark, valid, fail: () => c.abort(new Error('summary-models-unavailable')), afterCommit: () => { revision = yiLai.targetRevision?.(id); } });
          if (r.ok && valid()) {
            if (r.watermark) s.watermark = r.watermark;
            if (!r.more) { s.doneVersion = version; queue.delete(id); }
          } else s.retryAt = yiLai.now() + 60000;
        } catch { s.retryAt = yiLai.now() + 60000; yiLai.audit?.('summary-retry'); }
      }));
    } finally {
      active = undefined;
      // 提交后立即落水位：崩溃重启不重复总结同一段；写失败留待下次巡查重写。
      try { yiLai.cun(state); dirty = false; } catch { dirty = true; }
    }
  }
  async function shouDong(id: string, quanLiang = false, models?: string[]): Promise<{ ok: boolean; skipped?: string }> {
    if (stopped || active) return { ok: false, skipped: 'summary-busy' };
    if (!state[id]) bianHua(id);
    const source = state[id]!, version = source.version, c = new AbortController(); active = { id, c };
    let revision = yiLai.targetRevision?.(id);
    const valid = () => !stopped && !c.signal.aborted && state[id]?.version === version && yiLai.targetRevision?.(id) === revision;
    let watermark = quanLiang ? undefined : source.watermark;
    try {
      for (;;) {
        const result = await yiLai.run(id, { signal: c.signal, version, watermark, models, valid, fail: () => c.abort(new Error('summary-models-unavailable')), afterCommit: () => { revision = yiLai.targetRevision?.(id); } });
        if (!result.ok || !valid()) return { ok: false, skipped: 'summary-stale-or-unavailable' };
        if (result.more && (!result.watermark || (watermark && result.watermark.seq === watermark.seq && result.watermark.offset === watermark.offset))) return { ok: false, skipped: 'invalid-summary-watermark' };
        watermark = result.watermark; source.watermark = watermark;
        dirty = true; yiLai.cun(state);
        if (!result.more) { source.doneVersion = version; queue.delete(id); return { ok: true }; }
        revision = yiLai.targetRevision?.(id);
      }
    } catch {
      return { ok: false, skipped: c.signal.aborted ? 'summary-cancelled' : 'summary-failed' };
    } finally { active = undefined; if (dirty) { yiLai.cun(state); dirty = false; } }
  }
  function qingLing(id?: string): void {
    const ids = id ? [id] : Object.keys(state).filter((key) => key.startsWith('session:'));
    for (const key of ids) {
      if (activeHas(key)) active!.c.abort(new Error('summary-cursor-reset'));
      const old = state[key];
      state[key] = { version: (old?.version || 0) + 1, changedAt: yiLai.now(), doneVersion: 0, watermark: { seq: 0, offset: 0 }, retryAt: 0 };
      queue.add(key);
    }
    dirty = true;
    yiLai.cun(state); dirty = false;
  }
  function guanBi(): void { stopped = true; active?.c.abort(); if (dirty) yiLai.cun(state); }
  return { bianHua, huoDong, xunCha, shouDong, qingLing, guanBi, state };
}
/** 分块上界只覆盖真正送入模型的原文；长单条也维护partial offset，绝不整条越过。 */
export function zongJieKuai(records: ReadonlyArray<{ seq: number; role: string; content: string; hidden?: boolean; recordId?: string }>, from: ZongJieShuiWei = { seq: 0, offset: 0 }, cap = 12000): { text: string; end: ZongJieShuiWei; more: boolean; userFragments: string[]; anchors: Array<{ file: string; seq: number; recordId: string }> } {
  const userFragments: string[] = [];
  let text = '', end = { ...from };
  const anchors: Array<{ file: string; seq: number; recordId: string }> = [];
  let lo = 0, hi = records.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; const seq = Number(records[mid]!.seq); if (!Number.isFinite(seq) || seq <= 0) throw new Error('summary-invalid-source-sequence'); if (seq < from.seq) lo = mid + 1; else hi = mid; }
  for (let i = lo; i < records.length; i++) {
    const x = records[i]!, seq = Number(x.seq);
    if (!Number.isFinite(seq) || seq <= 0 || (i > 0 && seq < Number(records[i - 1]!.seq))) throw new Error('summary-invalid-source-sequence');
    if (x.hidden || seq < from.seq || (seq === from.seq && !from.offset)) continue;
    const offset = seq === from.seq ? from.offset : 0;
    const body = String(x.content || '').slice(offset);
    const head = `[${x.role}] `;
    const room = cap - text.length - head.length - 1;
    if (room <= 0) return { text, end, more: true, userFragments, anchors };
    const take = Math.min(body.length, room);
    text += head + body.slice(0, take) + '\n';
    if (x.role === 'user') userFragments.push(body.slice(0, take));
    anchors.push({ file: 'chat-log', seq, recordId: String(x.recordId || '') });
    if (anchors.length > 5) anchors.shift();
    end = { seq, offset: take < body.length ? offset + take : 0 };
    if (take < body.length) return { text, end, more: true, userFragments, anchors };
  }
  return { text, end, more: false, userFragments, anchors };
}
