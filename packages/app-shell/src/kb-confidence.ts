/**
 * kb-confidence —— 知识库置信度预测 + 长周期自我改进（I3，R203）。
 *
 * 设计（主人拍板）：
 *  · 先给**保守默认**（起始 0.5，迪文阈值 0.7）；
 *  · **自我改进**：复盘时按过去对话/历史/记录/用户行为判断升/降置信度；
 *  · 专门一个**置信度预测文件**（userData/kb-confidence.json + 历史 jsonl），科学地跨长周期自我改进。
 *
 * 科学性：
 *  · 置信度 ∈ [0.05, 0.95]，证据加权更新（非拍脑袋）；
 *  · **校准追踪**：记录「预测高置信」后被用户确认/纠正的比例，据此**有界自适应阈值**（过自信→升阈值，过保守→降阈值）；
 *  · 全量历史落盘，可跨长周期复盘审计；时间衰减防止陈旧证据永久主导。
 *
 * 红线：低置信/转换失败 → 原文（不迪文化）；置信度只影响「是否迪文化」，不改写知识原文（日志不可改写）。
 */
import fs from 'node:fs';
import path from 'node:path';

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

  /** 证据加权更新（复盘自我调整入口）。记录历史 + 校准。 */
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
   * 复盘自我改进：据校准误差**有界自适应阈值**。
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