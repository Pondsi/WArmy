/**
 * R260 项29「智能语音模式」：高频感知＋自我改进＋预测文件＋文案组（≤10 按优劣排序）＋价值优先＋安全分级。
 *
 *  · 感知频率：先高频，总结时按反馈自改进（太吵→拉长间隔；漏掉重要→缩短）。
 *  · 预测文件：凭它预测自我行动；总结时改进预测文件本身。
 *  · 文案组：每个互动最多 10 条文案，按优劣排序（优的使用频率高）；总结时增删。
 *  · 什么值得说：对用户有好处（提高生产力/生活质量）高优先；用户感兴趣低优先但必须有。
 *  · 安全分级：读/查/说自主；删/建/改先问用户。
 *  · 摄像头：权限开关≠常开；定时感知用到时才开（频率自改进）。
 * 纯函数、可测。
 */

/** 感知间隔自改进：feedback>0=太吵（拉长），<0=漏掉重要（缩短）；夹在 [minMs, maxMs]。 */
export function ganZhiJianGe(dangQianMs: number, feedback: number, minMs = 5000, maxMs = 300000): number {
  const cur = Number.isFinite(dangQianMs) ? dangQianMs : 10000;
  const f = Math.max(-1, Math.min(1, Number(feedback) || 0));
  // 太吵(f>0)最多翻倍；漏掉(f<0)最多减半
  const next = f > 0 ? cur * (1 + f) : cur * (1 + f * 0.5);
  return Math.round(Math.min(maxMs, Math.max(minMs, next)));
}

export interface WenAn { id: string; text: string; score: number }

/** 文案组整理：按 score 降序、截断 ≤10；返回排序后的组（优的在前=使用频率高）。 */
export function zhengLiWenAnZu(wenAn: WenAn[], max = 10): WenAn[] {
  return (wenAn || [])
    .filter((w) => w && typeof w.text === 'string' && w.text.trim())
    .slice()
    .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0) || String(a.id).localeCompare(String(b.id)))
    .slice(0, Math.max(0, max));
}

/** 按优劣加权选一条文案（score 越高被选概率越大；确定性种子可复现）。 */
export function xuanWenAn(zu: WenAn[], seed: number): WenAn | null {
  const sorted = zhengLiWenAnZu(zu);
  if (!sorted.length) return null;
  const weights = sorted.map((w) => Math.max(0.01, Number(w.score) || 0));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = (Math.abs(Math.sin(seed)) * total) % total;
  for (let i = 0; i < sorted.length; i += 1) { r -= weights[i]!; if (r <= 0) return sorted[i]!; }
  return sorted[0]!;
}

export interface ShuoHuaJiaZhi { benefit: number; interest: number }

/** 什么值得说：好处（生产力/生活质量）高优先；兴趣低优先但必须有。返回优先级分（benefit 权重远高于 interest）。 */
export function zhiDeShuoFen(jiaZhi: ShuoHuaJiaZhi): number {
  const b = Math.max(0, Math.min(1, Number(jiaZhi.benefit) || 0));
  const i = Math.max(0, Math.min(1, Number(jiaZhi.interest) || 0));
  return b * 0.85 + i * 0.15;
}

export type AnQuanDongZuo = 'read' | 'search' | 'speak' | 'create' | 'modify' | 'delete';

/** 安全分级：读/查/说自主执行；建/改/删先问用户。 */
export function anQuanFenJi(dongZuo: AnQuanDongZuo): 'autonomous' | 'ask' {
  return (dongZuo === 'read' || dongZuo === 'search' || dongZuo === 'speak') ? 'autonomous' : 'ask';
}

export interface YuCeWenJian {
  /** 预测的自我行动（下次该做什么） */
  nextActions: string[];
  /** 当前感知间隔（ms） */
  perceptionIntervalMs: number;
  /** 每个互动的文案组（≤10） */
  copyGroups: Record<string, WenAn[]>;
  /** 上次总结改进时间 */
  lastRefinedAt?: number;
}

/** 总结时改进预测文件：更新感知间隔＋整理各互动文案组（增删后仍 ≤10 排序）＋记录改进时间。 */
export function gaiJinYuCeWenJian(wj: YuCeWenJian, feedback: number, now: number): YuCeWenJian {
  const groups: Record<string, WenAn[]> = {};
  for (const [k, zu] of Object.entries(wj.copyGroups || {})) groups[k] = zhengLiWenAnZu(zu);
  return {
    nextActions: Array.isArray(wj.nextActions) ? wj.nextActions.slice(0, 20) : [],
    perceptionIntervalMs: ganZhiJianGe(wj.perceptionIntervalMs, feedback),
    copyGroups: groups,
    lastRefinedAt: now,
  };
}