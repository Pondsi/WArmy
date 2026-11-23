/** 持久路由预测与反馈。文件一次读入、逐决策读缓存；总结有界JSON候选经留出回放才更新。 */
import crypto from 'node:crypto';
import { LU_YOU_MO_REN, jianYanLuYouCanShu, luYouMoXingPingFen, type LuYouCanShu } from '../ji-chu/lu-you-yu-ce-gui-ze.js';
export interface LuYouHouXuan { key: string; qualityTier: number; speedTier: number; local: boolean }
export interface LuYouFanKui { id: string; ts: number; sequence?: number; key: string; nan: number; ji: number; quality?: number; ms?: number; tokens?: number; failed?: boolean; preempted?: boolean; candidates?: LuYouHouXuan[] }
const shiLiuChu = (f: LuYouFanKui) => Number(f.sequence || 0) % 3 === 0;
export interface LuYouYuCeZhuangTai { version: number; params: LuYouCanShu; cursor: number; feedback: LuYouFanKui[] }
export function chuangJianLuYouYuCe(d: { du: () => unknown; cun: (s: LuYouYuCeZhuangTai) => void; append: (f: LuYouFanKui) => void; now: () => number }) {
  let loaded = false; let state: LuYouYuCeZhuangTai = { version: 1, params: { ...LU_YOU_MO_REN }, cursor: 0, feedback: [] };
  const scores = new Map<string, { n: number; reward: number; fails: number }>();
  function load(): void {
    if (loaded) return; loaded = true;
    let j: Partial<LuYouYuCeZhuangTai> | undefined;
    try { j = d.du() as Partial<LuYouYuCeZhuangTai> | undefined; } catch { /* 损坏存储保留基础规范 */ }
    const params = jianYanLuYouCanShu(j?.params);
    if (params && j) state = { version: Number(j.version) || 1, params, cursor: Number(j.cursor) || 0, feedback: Array.isArray(j.feedback) ? j.feedback.filter((f) => f && typeof f.id === 'string' && typeof f.key === 'string' && Number.isFinite(f.ts) && Number.isFinite(f.nan) && Number.isFinite(f.ji) && (f.quality === undefined || (Number.isFinite(f.quality) && f.quality >= 0 && f.quality <= 1))).slice(-400) : [] };
    state.feedback = state.feedback.map((f, i) => ({ ...f, sequence: Number.isSafeInteger(f.sequence) && Number(f.sequence) > 0 ? f.sequence : i + 1 }));
    rebuild();
  }
  function rebuild(): void {
    scores.clear(); for (const f of state.feedback) {
      if (shiLiuChu(f) || f.preempted || f.quality === undefined) continue;
      const s = scores.get(f.key) || { n: 0, reward: 0, fails: 0 }; s.n++; s.reward += f.quality; s.fails += f.failed ? 1 : 0; scores.set(f.key, s);
    }
  }
  function jiLu(f: Omit<LuYouFanKui, 'id' | 'ts'>): void {
    load(); const entry = { ...f, id: crypto.randomUUID(), ts: d.now(), sequence: Number(state.feedback.at(-1)?.sequence || 0) + 1 };
    entry.nan = Math.max(1, Math.min(5, Math.round(Number(entry.nan) || 3)));
    entry.ji = Math.max(1, Math.min(5, Math.round(Number(entry.ji) || 3)));
    if (entry.failed && !entry.preempted && entry.quality === undefined) entry.quality = 0;
    if (entry.quality !== undefined) { if (!Number.isFinite(entry.quality)) delete entry.quality; else entry.quality = Math.max(0, Math.min(1, entry.quality)); }
    if (entry.candidates) entry.candidates = entry.candidates.slice(0, 32).map(({ key, qualityTier, speedTier, local }) => ({ key, qualityTier, speedTier, local }));
    d.append(entry); state.feedback.push(entry); state.feedback = state.feedback.slice(-400); rebuild(); d.cun(state);
  }
  function yuCe(): { version: number; params: LuYouCanShu; historyScores: Record<string, number> } {
    load(); const historyScores: Record<string, number> = {};
    for (const [key, x] of scores) historyScores[key] = x.n >= 3 ? (x.reward / x.n) * state.params.history - (x.fails / x.n) * state.params.failure : 0;
    return { version: state.version, params: { ...state.params }, historyScores };
  }
  /** 总结只看按「模型×难×急」聚合的真实结果（最多 24 行），不堆原始反馈与候选表，提示长度有界。 */
  function zongJieDuan(): string {
    // 留出集从不进入模型的改进素材；sequence落盘且截窗后不改，避免轮换窗口把留出样本重新喂给训练。
    load(); const fresh = state.feedback.filter((f) => !shiLiuChu(f) && f.ts > state.cursor).slice(-200);
    if (!fresh.length) return '';
    const rows = new Map<string, { key: string; nan: number; ji: number; n: number; scored: number; quality: number; ms: number; msN: number; failed: number; preempted: number }>();
    for (const f of fresh) {
      const id = f.key + '|' + f.nan + '|' + f.ji;
      const r = rows.get(id) || { key: f.key, nan: f.nan, ji: f.ji, n: 0, scored: 0, quality: 0, ms: 0, msN: 0, failed: 0, preempted: 0 };
      r.n++;
      if (f.preempted) r.preempted++;
      else {
        if (f.quality !== undefined) { r.scored++; r.quality += f.quality; }
        if (f.failed) r.failed++;
        if (Number.isFinite(f.ms) && Number(f.ms) > 0) { r.ms += Number(f.ms); r.msN++; }
      }
      rows.set(id, r);
    }
    const stats = [...rows.values()].sort((a, b) => b.n - a.n).slice(0, 24).map((r) => ({ key: r.key.slice(0, 80), nan: r.nan, ji: r.ji, n: r.n,
      quality: r.scored ? Math.round((r.quality / r.scored) * 100) / 100 : null, scored: r.scored, avgMs: r.msN ? Math.round(r.ms / r.msN) : null, failed: r.failed, preempted: r.preempted }));
    return '\n【路由预测改进】\n' + JSON.stringify({ version: state.version, params: state.params, stats })
      + '\n仅按真实结果建议参数，未知反馈不当成功，取消不当模型失败。末尾可输出【路由裁决】{"params":{"under":40,"surplus":5,"speed":15,"history":10,"failure":30,"urgentAt":4,"insertAt":3}}；不可改变权限/调用链/手选模型。';
  }
  function yingYong(txt: string): boolean {
    load(); const match = /【路由裁决】\s*(\{[^\n]*\})/.exec(txt);
    if (!match) return false;
    let params: LuYouCanShu | null = null;
    try { params = jianYanLuYouCanShu(JSON.parse(match[1]!).params); } catch { return false; }
    if (!params) return false;
    const held = state.feedback.filter((f) => shiLiuChu(f) && !f.preempted && f.quality !== undefined && Array.isArray(f.candidates) && f.candidates.length > 0);
    if (held.length < 6) return false;
    const trained = state.feedback.filter((f) => !shiLiuChu(f) && !f.preempted && f.quality !== undefined);
    const evaluate = (p: LuYouCanShu): { quality: number; ms: number } | null => {
      let quality = 0, ms = 0;
      for (const f of held) {
        const enough = f.candidates!.filter((c) => c.qualityTier >= f.nan);
        const max = Math.max(...f.candidates!.map((c) => c.qualityTier));
        const pool = enough.length ? enough : f.candidates!.filter((c) => c.qualityTier === max);
        const stats = (key: string) => {
          const same = trained.filter((x) => x.key === key && Math.abs(x.nan - f.nan) <= 1 && Math.abs(x.ji - f.ji) <= 1);
          return same.length < 3 ? null : { quality: same.reduce((s, x) => s + x.quality!, 0) / same.length, ms: same.reduce((s, x) => s + (x.ms || 0), 0) / same.length, failure: same.filter((x) => x.failed).length / same.length };
        };
        const ranked = pool.map((c, i) => {
          const evidence = stats(c.key), global = trained.filter((x) => x.key === c.key);
          const learned = global.length >= 3 ? global.reduce((s, x) => s + x.quality!, 0) / global.length * p.history - global.filter((x) => x.failed).length / global.length * p.failure : 0;
          return { c, i, evidence, score: luYouMoXingPingFen({ model: c.key.split(' · ').at(-1) || c.key, ...c }, { nan: f.nan, ji: f.ji }, p, learned) };
        }).sort((a, b) => b.score - a.score || a.i - b.i);
        const selected = ranked[0]?.evidence;
        if (!selected) return null; // 不猜没有历史质量证据的替代模型效果。
        quality += selected.quality; ms += selected.ms;
      }
      return { quality: quality / held.length, ms: ms / held.length };
    };
    const old = evaluate(state.params), next = evaluate(params);
    if (!old || !next || next.quality + 0.01 < old.quality || (old.ms > 0 && next.ms > old.ms * 1.05)) return false;
    // 此回放为历史支持范围内的保守代理指标，不是无偏反事实/线上质量证明。
    state.params = params; state.version++; state.cursor = Math.max(...state.feedback.map((f) => f.ts), state.cursor); d.cun(state); return true;
  }
  return { yuCe, jiLu, zongJieDuan, yingYong };
}
