/**
 * R319：总结批处理协调器——同族同模型的多个总结任务合并成一次请求；
 * 精确任务去重、按素材时间/任务族排序、前序已提交结论反刍后续任务、结构化拆分失败逐项回退。
 * 事实仍按各自 sid/水位独立提交，绝不跨会话混合或共享水位。
 */
export interface ZongJiePiFaQingQiu { id: string; model: string; prompt: string; signal: AbortSignal; sid: string; family: string; sourceTs: number }
export interface ZongJiePiFaJieGuo { text: string; merged: boolean; fallback: boolean }

export function zongJiePiZuOf(id: string): { family: string; rank: number } {
  if (id.startsWith('session:') || id.startsWith('knowledge:') || id.startsWith('short-memory:')) return { family: 'facts', rank: 0 };
  if (id.startsWith('duty:') || id.startsWith('decision:')) return { family: 'duty', rank: 1 };
  return { family: 'improve', rank: 2 };
}

interface Pending extends ZongJiePiFaQingQiu { resolve: (v: ZongJiePiFaJieGuo) => void; reject: (e: unknown) => void }

export function chuangJianZongJiePiFa(yiLai: {
  /** 实际单次请求：tasks 长度=1 时可原文返回；>1 必须返回 JSON 对象 {id:总结} 或分段文本。 */
  generate: (model: string, tasks: ZongJiePiFaQingQiu[], signal: AbortSignal) => Promise<string>;
  flushMs?: number;
}) {
  const pending = new Map<string, Pending>();
  const notes = new Map<string, { ts: number; sid: string; summary: string }>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let flushing = false;
  const flushMs = yiLai.flushMs ?? 60;
  function digest(excludeSid = '', limit = 1200): string {
    const a = [...notes.values()].filter((x) => x.sid !== excludeSid).sort((a, b) => a.ts - b.ts).slice(-4);
    return a.map((x) => `· ${x.summary}`).join('\n').slice(0, limit);
  }
  function note(sid: string, summary: string): void {
    const s = String(summary || '').trim().replace(/\s+/g, ' ');
    if (!s) return;
    notes.set(sid, { ts: Date.now(), sid, summary: s.slice(0, 600) });
    if (notes.size > 80) for (const k of [...notes.keys()].slice(0, notes.size - 80)) notes.delete(k);
  }
  function split(out: string, tasks: Pending[]): Map<string, string> {
    const got = new Map<string, string>();
    const raw = String(out || '').trim();
    if (tasks.length === 1) { got.set(tasks[0]!.id, raw); return got; }
    try {
      const j = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '')) as Record<string, unknown>;
      for (const t of tasks) {
        const v = j[t.id] ?? j[t.sid];
        if (typeof v === 'string' && v.trim()) got.set(t.id, v.trim());
        else if (v && typeof v === 'object') { const z = JSON.stringify(v); if (z) got.set(t.id, z); }
      }
    } catch { /* 不是 JSON 就试分段 */ }
    for (const t of tasks) {
      if (got.has(t.id)) continue;
      const re = new RegExp('(?:===任务\\s*' + t.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*===|【任务\\s*' + t.sid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '】)([\\s\\S]*?)(?=(?:===任务|【任务|$))', 'i');
      const m = raw.match(re);
      if (m && String(m[1] || '').trim()) got.set(t.id, String(m[1]).trim());
    }
    return got;
  }
  async function flush(): Promise<void> {
    if (flushing) return;
    flushing = true;
    try {
      const byModel = new Map<string, Pending[]>();
      for (const p of pending.values()) {
        const a = byModel.get(p.model) || []; a.push(p); byModel.set(p.model, a);
      }
      pending.clear();
      for (const [model, all] of byModel) {
        /* 同族优先：事实 → 值班 → 改进；同族内按素材时间与 sid 稳定排序 */
        all.sort((a, b) => (zongJiePiZuOf(a.family).rank - zongJiePiZuOf(b.family).rank) || (a.sourceTs - b.sourceTs) || a.sid.localeCompare(b.sid));
        const groups: Pending[][] = [];
        const seen = new Set<string>();
        for (const p of all) {
          if (seen.has(p.id)) { p.resolve({ text: '', merged: true, fallback: false }); continue; }
          seen.add(p.id);
          const last = groups[groups.length - 1];
          if (!last || last.length >= 4 || zongJiePiZuOf(last[0]!.family).family !== zongJiePiZuOf(p.family).family) groups.push([p]);
          else last.push(p);
        }
        for (const tasks of groups) {
          const sig = tasks[0]!.signal;
          let out = '';
          let err: unknown = null;
          try { out = await yiLai.generate(model, tasks.map((t) => ({ ...t })), sig); } catch (e) { err = e; }
          const got = err ? new Map<string, string>() : split(out, tasks);
          for (const t of tasks) {
            const text = got.get(t.id) || '';
            if (text.trim()) t.resolve({ text, merged: tasks.length > 1, fallback: false });
            else t.resolve({ text: '', merged: false, fallback: true });
          }
        }
      }
    } finally { flushing = false; }
  }
  function add(q: ZongJiePiFaQingQiu): Promise<ZongJiePiFaJieGuo> {
    if (pending.has(q.id)) return Promise.resolve({ text: '', merged: true, fallback: true });
    const p = new Promise<ZongJiePiFaJieGuo>((resolve, reject) => {
      pending.set(q.id, { ...q, resolve, reject });
      if (!timer) timer = setTimeout(() => { timer = undefined; void flush(); }, flushMs);
    });
    return p;
  }
  return { add, note, digest };
}