/**
 * kb-confidence —— 知识库置信度预测 + 长周期自我改进（I3，R203）。
 *
 * 设计（主人拍板）：
 *  · 先给**保守默认**（起始 0.5，迪文阈值 0.7）；
 *  · **自我改进**：总结时按过去对话/历史/记录/用户行为判断升/降置信度；
 *  · 专门一个**置信度预测文件**（userData/kb-confidence.json + 历史 jsonl），科学地跨长周期自我改进。
 *
 * 科学性：
 *  · 置信度 ∈ [0.05, 0.95]，证据加权更新（非拍脑袋）；
 *  · **校准追踪**：记录「预测高置信」后被用户确认/纠正的比例，据此**有界自适应阈值**（过自信→升阈值，过保守→降阈值）；
 *  · 全量历史落盘，可跨长周期总结审计；时间衰减防止陈旧证据永久主导。
 *
 * 红线：低置信/转换失败 → 原文（不迪文化）；置信度只影响「是否迪文化」，不改写知识原文（日志不可改写）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { danYiMingXian } from './fang-an-fen-qi.js';

export type ZhiXinXinHao =
  | 'user-correct'      // 用户纠正 → 降
  | 'user-affirm'       // 用户肯定 → 升
  | 'reuse'             // 被复用 → 升
  | 'contradiction'     // 检出矛盾 → 降
  | 'supersede-stable'  // 取代后稳定 → 升
  | 'retrieval-hit'     // 检索命中被用 → 微升
  | 'retrieval-miss';   // 检索未中 → 微降

export interface ZhiXinLiShi { ts: number; type: ZhiXinXinHao; delta: number; before: number; after: number; note?: string; }
export interface ZhiXinTiaoMu {
  id: string;
  confidence: number;
  updates: number;
  createdAt: number;
  updatedAt: number;
  history: ZhiXinLiShi[];
}
export interface JiaoZhun { predictedHigh: number; confirmedCorrect: number; confirmedWrong: number; }

/** 保守默认（主人拍板：先保守，跑一段再调）。 */
export const MO_REN_ZHI_XIN = 0.5;
export const MO_REN_DI_WEN_YU_ZHI = 0.7;
export const XIA_XIAN = 0.05;
export const SHANG_XIAN = 0.95;

/** 证据权重（log-odds 风格的有界增量；用户纠正权重最大）。 */
export const XIN_HAO_QUAN_ZHONG: Record<ZhiXinXinHao, number> = {
  'user-correct': -0.25,
  'user-affirm': +0.15,
  'reuse': +0.05,
  'contradiction': -0.20,
  'supersede-stable': +0.10,
  'retrieval-hit': +0.03,
  'retrieval-miss': -0.02,
};

function clamp(v: number): number { return Math.max(XIA_XIAN, Math.min(SHANG_XIAN, v)); }

export interface KbConfidenceOpts {
  file?: string;            // 预测文件路径（userData/kb-confidence.json）
  historyFile?: string;     // 历史 jsonl（可选；缺省 file 同目录 .history.jsonl）
  defaultConfidence?: number;
  diwenThreshold?: number;
  now?: () => number;
}

export class KbConfidenceModel {
  private readonly entries = new Map<string, ZhiXinTiaoMu>();
  private readonly now: () => number;
  private readonly defaultConfidence: number;
  private threshold: number;
  private readonly jiaoZhun: JiaoZhun = { predictedHigh: 0, confirmedCorrect: 0, confirmedWrong: 0 };
  private readonly file?: string;
  private readonly historyFile?: string;

  constructor(opts: KbConfidenceOpts = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.defaultConfidence = opts.defaultConfidence ?? MO_REN_ZHI_XIN;
    this.threshold = opts.diwenThreshold ?? MO_REN_DI_WEN_YU_ZHI;
    this.file = opts.file;
    this.historyFile = opts.historyFile ?? (opts.file ? opts.file.replace(/\.json$/, '') + '.history.jsonl' : undefined);
    this.load();
  }

  /** 预测某条目置信度（无记录 → 保守默认）。 */
  predict(id: string): number {
    return this.entries.get(id)?.confidence ?? this.defaultConfidence;
  }

  /** 是否高置信走迪文（>= 阈值）。 */
  shouldDiwen(id: string): boolean { return this.predict(id) >= this.threshold; }

  get yuZhi(): number { return this.threshold; }
  get jiaoZhunShuJu(): JiaoZhun { return { ...this.jiaoZhun }; }

  /** 证据加权更新（总结自我调整入口）。记录历史 + 校准。 */
  update(id: string, signal: ZhiXinXinHao, note?: string): ZhiXinTiaoMu {
    const t = this.now();
    let e = this.entries.get(id);
    if (!e) {
      e = { id, confidence: this.defaultConfidence, updates: 0, createdAt: t, updatedAt: t, history: [] };
      this.entries.set(id, e);
    }
    const before = e.confidence;
    const delta = XIN_HAO_QUAN_ZHONG[signal] ?? 0;
    const after = clamp(before + delta);
    e.confidence = after;
    e.updates += 1;
    e.updatedAt = t;
    const rec: ZhiXinLiShi = { ts: t, type: signal, delta, before, after, ...(note ? { note } : {}) };
    e.history.push(rec);
    if (e.history.length > 200) e.history = e.history.slice(-200); // 单条目历史有界
    // 校准：高置信预测后，用户肯定=确认正确，用户纠正=确认错误
    if (before >= this.threshold) {
      if (signal === 'user-affirm' || signal === 'reuse') { this.jiaoZhun.predictedHigh += 1; this.jiaoZhun.confirmedCorrect += 1; }
      else if (signal === 'user-correct' || signal === 'contradiction') { this.jiaoZhun.predictedHigh += 1; this.jiaoZhun.confirmedWrong += 1; }
    }
    this.appendHistory(rec, id);
    this.save();
    return { ...e, history: e.history.slice() };
  }

  /**
   * 总结自我改进：据校准误差**有界自适应阈值**。
   * 过自信（高置信被纠正比例 > 20%）→ 升阈值；过保守（样本足且纠正率 < 5%）→ 降阈值。
   * 阈值夹在 [0.5, 0.9]，每次最多 ±0.02，防抖。
   */
  fuPanZiWoGaiJin(): { adjusted: boolean; threshold: number; reason: string } {
    const { predictedHigh, confirmedWrong } = this.jiaoZhun;
    if (predictedHigh < 5) return { adjusted: false, threshold: this.threshold, reason: '样本不足（<5），不调' };
    const wrongRate = confirmedWrong / predictedHigh;
    const old = this.threshold;
    if (wrongRate > 0.2) this.threshold = Math.min(0.9, this.threshold + 0.02);
    else if (wrongRate < 0.05) this.threshold = Math.max(0.5, this.threshold - 0.01);
    const adjusted = this.threshold !== old;
    if (adjusted) this.save();
    return { adjusted, threshold: this.threshold, reason: adjusted ? `纠正率 ${(wrongRate * 100).toFixed(0)}% → 阈值 ${old.toFixed(2)}→${this.threshold.toFixed(2)}` : '纠正率适中，阈值不动' };
  }

  /** 时间衰减：陈旧证据缓慢向默认回归（半衰期约 30 天），防陈旧证据永久主导。 */
  shiJianShuaiJian(id: string, halfLifeMs = 30 * 24 * 3600 * 1000): number {
    const e = this.entries.get(id);
    if (!e) return this.defaultConfidence;
    const age = this.now() - e.updatedAt;
    if (age <= 0) return e.confidence;
    const decay = Math.pow(0.5, age / halfLifeMs);
    e.confidence = clamp(this.defaultConfidence + (e.confidence - this.defaultConfidence) * decay);
    this.save();
    return e.confidence;
  }

  private appendHistory(rec: ZhiXinLiShi, id: string): void {
    if (!this.historyFile) return;
    try {
      fs.mkdirSync(path.dirname(this.historyFile), { recursive: true });
      fs.appendFileSync(this.historyFile, JSON.stringify({ id, ...rec }) + '\n', 'utf8');
    } catch { /* 历史写失败不影响置信度 */ }
  }

  save(): void {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const out = { threshold: this.threshold, jiaoZhun: this.jiaoZhun, entries: [...this.entries.values()] };
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(out, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch { /* 持久化失败不阻断 */ }
  }

  private load(): void {
    if (!this.file || !fs.existsSync(this.file)) return;
    try {
      const d = JSON.parse(fs.readFileSync(this.file, 'utf8')) as { threshold?: number; jiaoZhun?: JiaoZhun; entries?: ZhiXinTiaoMu[] };
      if (typeof d.threshold === 'number') this.threshold = d.threshold;
      if (d.jiaoZhun) Object.assign(this.jiaoZhun, d.jiaoZhun);
      for (const e of d.entries || []) if (e && typeof e.id === 'string') this.entries.set(e.id, e);
    } catch { /* 坏文件按空处理 */ }
  }

  lieBiao(): ZhiXinTiaoMu[] { return [...this.entries.values()].map((e) => ({ ...e, history: e.history.slice() })); }
}

/** 任务澄清的标签与知识转换置信账分开；只接受用户选择或宿主留出标签。 */
export interface RenWuChengQingYangBen {
  id: string; seq: number; model: string; scores: number[]; selected: number; source: 'user-choice' | 'host-label'; ts: number;
}
export interface RenWuChengQingGuJi { scores: number[]; samples: number; basis: 'labelled' | 'prior' }
export interface JueCeRuanCeLue { clarify: boolean; edit: boolean; undo: boolean; confidence: number; margin: number }
export const MO_REN_JUE_CE: JueCeRuanCeLue = { clarify: true, edit: true, undo: true, confidence: 0.7, margin: 0.2 };
export function yanJueCeCeLue(v: unknown): JueCeRuanCeLue | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const p = v as Record<string, unknown>;
  if (Object.keys(p).length !== 5 || !['clarify', 'edit', 'undo'].every((k) => typeof p[k] === 'boolean')
    || typeof p.confidence !== 'number' || !Number.isFinite(p.confidence) || p.confidence < 0.55 || p.confidence > 0.9 || typeof p.margin !== 'number' || !Number.isFinite(p.margin) || p.margin < 0.1 || p.margin > 0.3) return null;
  return { clarify: p.clarify as boolean, edit: p.edit as boolean, undo: p.undo as boolean, confidence: p.confidence, margin: p.margin };
}
export function heFaChengQingFen(v: unknown): v is number[] {
  return Array.isArray(v) && v.length >= 2 && v.length <= 4 && v.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1);
}
const fenTong = (v: number) => Math.min(4, Math.floor(v * 5));
export function jiaoZhunRenWuFen(model: string, raw: readonly number[], observations: readonly RenWuChengQingYangBen[]): RenWuChengQingGuJi {
  if (!heFaChengQingFen(raw)) throw new Error('invalid-clarification-scores');
  let samples = Infinity;
  const scores = raw.map((score) => {
    let total = 0, correct = 0;
    for (const row of observations) {
      if (row.model !== model || row.scores.length !== raw.length || !['user-choice', 'host-label'].includes(row.source)) continue;
      for (const [i, v] of row.scores.entries()) if (fenTong(v) === fenTong(score)) { total++; if (i === row.selected) correct++; }
    }
    samples = Math.min(samples, total);
    // 没有标签时只用对称先验；模型自报 0.99 也不成为 99% 概率。
    return total >= 6 ? clamp((correct + 1) / (total + raw.length)) : Math.min(MO_REN_ZHI_XIN, 1 / raw.length);
  });
  return { scores, samples: Number.isFinite(samples) ? samples : 0, basis: samples >= 6 ? 'labelled' : 'prior' };
}
export function xuYaoRenWuChengQing(policy: JueCeRuanCeLue, estimate: RenWuChengQingGuJi, diverges: boolean): boolean {
  if (!diverges) return false;
  const sorted = [...estimate.scores].sort((a, b) => b - a);
  return sorted[0]! < policy.confidence || sorted[0]! - sorted[1]! < policy.margin;
}
export function yiJuMingXianXuanXiang(options: readonly string[], evidence: string): number | null {
  const normal = (s: string) => s.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
  const text = normal(evidence), matched = options.map((o) => normal(o).length >= 3 && text.includes(normal(o)));
  if (matched.filter(Boolean).length !== 1) return null;
  // 使用相同的单一明显信号，但这里的 1/0 来自宿主实际读到的明确选项，而非模型自评。
  return danYiMingXian(matched.map((yes) => ({ confidence: yes ? 1 : 0 })));
}
export interface JueCeFuZhuFanKui { id: string; seq: number; feature: 'edit' | 'undo'; needed: boolean; generation: string; policyVersion: number; ts: number }
export function chuangJianRenWuZhiXin(file: string) {
  function du(): { version: number; seq: number; rows: RenWuChengQingYangBen[]; feedback: JueCeFuZhuFanKui[] } {
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (j.version !== 1 || !Number.isSafeInteger(j.seq) || j.seq < 0 || !Array.isArray(j.rows) || j.rows.length > 512 || j.rows.some((r: RenWuChengQingYangBen) => !r || !r.id || !r.model || !heFaChengQingFen(r.scores) || !Number.isSafeInteger(r.selected) || r.selected < 0 || r.selected >= r.scores.length || !['user-choice', 'host-label'].includes(r.source) || !Number.isSafeInteger(r.seq))) throw new Error('clarification-calibration-invalid');
      const feedback = j.feedback || [];
      if (!Array.isArray(feedback) || feedback.length > 512 || feedback.some((r: JueCeFuZhuFanKui) => !r || !r.id || !r.generation || !['edit', 'undo'].includes(r.feature) || typeof r.needed !== 'boolean' || !Number.isSafeInteger(r.seq) || !Number.isSafeInteger(r.policyVersion))) throw new Error('decision-feedback-invalid');
      return { ...j, feedback };
    } catch (e) { if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return { version: 1, seq: 0, rows: [], feedback: [] }; throw e; }
  }
  function jiLu(record: Omit<RenWuChengQingYangBen, 'seq' | 'ts'>): void {
    const j = du();
    if (!heFaChengQingFen(record.scores) || !Number.isSafeInteger(record.selected) || record.selected < 0 || record.selected >= record.scores.length || !record.id || !record.model || !['user-choice', 'host-label'].includes(record.source)) throw new Error('invalid-clarification-label');
    if (j.rows.some((r) => r.id === record.id)) return;
    const next = { ...j, seq: j.seq + 1, rows: [...j.rows.slice(-511), { ...record, seq: j.seq + 1, ts: Date.now() }] };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(next), { mode: 0o600, flush: true }); fs.renameSync(file + '.tmp', file);
  }
  function fanKui(record: Omit<JueCeFuZhuFanKui, 'seq' | 'ts'>): void {
    const j = du();
    if (!record.id || !record.generation || !['edit', 'undo'].includes(record.feature) || typeof record.needed !== 'boolean' || !Number.isSafeInteger(record.policyVersion)) throw new Error('invalid-decision-feedback');
    if (j.feedback.some((r) => r.id === record.id)) return;
    const next = { ...j, seq: j.seq + 1, feedback: [...j.feedback.slice(-511), { ...record, seq: j.seq + 1, ts: Date.now() }] };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(next), { mode: 0o600, flush: true }); fs.renameSync(file + '.tmp', file);
  }
  return { du, jiLu, fanKui, guJi: (model: string, scores: number[]) => jiaoZhunRenWuFen(model, scores, du().rows) };
}

export type JueCeLiuChuYangBen =
  | { kind: 'clarify'; model: string; scores: number[]; selected: number; explicit: boolean }
  | { kind: 'edit'; wantedEdit: boolean; approved: boolean; succeeded: boolean }
  | { kind: 'undo'; wantedRollback: boolean; conflict: boolean; succeeded: boolean; persisted?: boolean }
  | { kind: 'recover'; replayed: boolean; blocked: boolean; executed: boolean };
export interface JueCeZhiBiao { unsafe: number; miss: number; wrongRollback: number; wrongRecovery: number; success: number; interruptions: number }
export function jueCeLiuChuDuiZhao(policy: JueCeRuanCeLue, cases: readonly JueCeLiuChuYangBen[], train: readonly RenWuChengQingYangBen[]): JueCeZhiBiao {
  const m: JueCeZhiBiao = { unsafe: 0, miss: 0, wrongRollback: 0, wrongRecovery: 0, success: 0, interruptions: 0 };
  for (const sample of cases) {
    if (sample.kind === 'clarify') {
      const estimate = jiaoZhunRenWuFen(sample.model, sample.scores, train);
      const ask = sample.explicit || (policy.clarify && xuYaoRenWuChengQing(policy, estimate, true));
      const chosen = ask ? sample.selected : estimate.scores.indexOf(Math.max(...estimate.scores));
      if (chosen === sample.selected) m.success++; else m.miss++;
      if (ask) m.interruptions++;
    } else if (sample.kind === 'edit') {
      // 编辑入口关闭后仍有原始逐工具批准；原卡已落盘的继续可编辑，不参与开关回放。
      if (sample.succeeded && !sample.approved) { m.unsafe++; continue; }
      if (!sample.approved) m.success++;
      else if (!sample.succeeded) m.miss++;
      else if (!sample.wantedEdit || policy.edit) m.success++;
      else m.miss++;
      m.interruptions++;
    } else if (sample.kind === 'recover') {
      // 已执行重演、或停止/过期/越权后仍执行＝错误恢复；被门禁拦住不执行才是安全。
      if (sample.executed && (sample.replayed || sample.blocked)) m.wrongRecovery++;
      else if (!sample.executed && !sample.blocked) m.miss++;
      else m.success++;
    } else {
      if (sample.conflict) {
        // 冲突校验固定启用，候选不能删除它；冲突后仍回滚＝错误回滚。
        if (sample.succeeded) m.wrongRollback++; else m.success++;
        continue;
      }
      if (!sample.succeeded) { m.miss++; continue; }
      if (!sample.wantedRollback || policy.undo || sample.persisted) m.success++; else m.miss++;
      if (policy.undo) m.interruptions++;
    }
  }
  return m;
}
export function jueCeGaiJinHeGe(base: JueCeZhiBiao, next: JueCeZhiBiao): boolean {
  return next.unsafe <= base.unsafe && next.miss <= base.miss && next.wrongRollback <= base.wrongRollback && next.wrongRecovery <= base.wrongRecovery
    && next.success >= base.success && (next.success > base.success || next.interruptions < base.interruptions);
}
export function jueCeYouTuiHua(previous: JueCeZhiBiao, current: JueCeZhiBiao): boolean {
  return current.unsafe > previous.unsafe || current.miss > previous.miss || current.wrongRollback > previous.wrongRollback || current.wrongRecovery > previous.wrongRecovery || current.success < previous.success;
}
export interface JueCeCeLueBan { version: number; policy: JueCeRuanCeLue; previous?: { version: number; policy: JueCeRuanCeLue }; watermark: number; reviewedIds: string[]; revisions: Array<{ version: number; policy: JueCeRuanCeLue; reason: string }> }
export function chuangJianJueCeCeLue(file: string) {
  function du(): JueCeCeLueBan {
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      const keys = Object.keys(MO_REN_JUE_CE);
      const policy = yanJueCeCeLue(j.policy || Object.fromEntries(keys.map((k) => [k, j[k]])));
      if (!policy || (j.version != null && (!Number.isSafeInteger(j.version) || j.version < 1))) throw new Error('decision-policy-invalid');
      if (j.watermark != null && (!Number.isSafeInteger(j.watermark) || j.watermark < 0)) throw new Error('decision-policy-invalid');
      const previous = j.previous && Number.isSafeInteger(j.previous.version) && j.previous.version > 0 && yanJueCeCeLue(j.previous.policy) ? j.previous : undefined;
      return { version: j.version || 1, policy, previous, watermark: j.watermark || 0, reviewedIds: Array.isArray(j.reviewedIds) ? j.reviewedIds.filter((s: unknown) => typeof s === 'string').slice(-1024) : [], revisions: Array.isArray(j.revisions) ? j.revisions.slice(-16) : [] };
    } catch (e) { if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return { version: 1, policy: { ...MO_REN_JUE_CE }, watermark: 0, reviewedIds: [], revisions: [] }; throw e; }
  }
  function cun(next: JueCeCeLueBan): void {
    du(); fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(next), { mode: 0o600, flush: true }); fs.renameSync(file + '.tmp', file);
  }
  function apply(policy: JueCeRuanCeLue, version: number, watermark: number, ids: string[] = []): boolean {
    const old = du(), next = yanJueCeCeLue(policy);
    if (!next || old.version !== version || watermark < old.watermark || JSON.stringify(next) === JSON.stringify(old.policy)) return false;
    cun({ ...old, policy: next, version: version + 1, watermark, reviewedIds: [...old.reviewedIds, ...ids].slice(-1024), previous: { version, policy: old.policy }, revisions: [...old.revisions.slice(-15), { version, policy: old.policy, reason: 'labelled-holdout-improvement' }] }); return true;
  }
  function rollback(version: number, watermark: number, ids: string[] = []): boolean {
    const old = du();
    if (old.version !== version || !old.previous || watermark < old.watermark) return false;
    cun({ ...old, policy: old.previous.policy, previous: undefined, version: version + 1, watermark, reviewedIds: [...old.reviewedIds, ...ids].slice(-1024), revisions: [...old.revisions.slice(-15), { version, policy: old.policy, reason: 'incremental-regression' }] }); return true;
  }
  function reviewed(version: number, watermark: number, ids: string[] = []): void { const old = du(); if (old.version === version && watermark >= old.watermark) cun({ ...old, watermark, reviewedIds: [...old.reviewedIds, ...ids].slice(-1024) }); }
  return { du, apply, rollback, reviewed };
}