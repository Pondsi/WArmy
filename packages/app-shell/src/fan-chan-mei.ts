/**
 * R260 项30「反谄媚自改造约束闸」：以高效/正确为目的，必要时才迎合；硬拦无实证的迎合性自改。
 *
 * 自进化/总结/预测的自改造里，若一次改动只是"更顺着用户说"（降低标准/隐瞒错误/夸大/单纯讨好）
 * 而**没有 A/B 实证**证明它更高效或更正确 ⇒ 硬拦（不采纳）。有实证、或用户明确偏好且无害 ⇒ 放行。
 * 被拦时可给用户发系统消息要求 3 选一裁决（同意模型/坚持更好/给其他建议）；该消息为最终回复，
 * 不可再就此续发讨论；无法判断时坚持模型观点。时效：早于最新 10 条且超 30 天的此类消息删除，按模型观点处理。
 *
 * 纯函数、可测。
 */

export interface ZiGaiTiAn {
  /** 是否有 A/B 实证（胜率/回合/正确率提升）支撑这次改动 */
  hasEvidence: boolean;
  /** 是否为迎合而降低标准 */
  lowersStandard?: boolean;
  /** 是否隐瞒/淡化错误 */
  hidesError?: boolean;
  /** 是否夸大成果 */
  exaggerates?: boolean;
  /** 是否 merely 讨好（无效率/正确性收益） */
  merelyPleases?: boolean;
  /** 用户明确偏好且无害（必要时迎合的例外） */
  userPreferenceHarmless?: boolean;
}

export interface YingHePanJue { block: boolean; reason: string }

/** 判定一次自改造是否"无实证的迎合性自改"⇒ 硬拦。 */
export function panDingYingHeXingZiGai(tiAn: ZiGaiTiAn): YingHePanJue {
  const yingHe = !!(tiAn.lowersStandard || tiAn.hidesError || tiAn.exaggerates || tiAn.merelyPleases);
  if (!yingHe) return { block: false, reason: '非迎合性改动，按实证/正确性正常裁决' };
  if (tiAn.hasEvidence) return { block: false, reason: '虽涉迎合但有 A/B 实证支撑，放行（实证优先）' };
  if (tiAn.userPreferenceHarmless) return { block: false, reason: '用户明确偏好且无害，必要时迎合，放行' };
  return { block: true, reason: '无实证的迎合性自改（降低标准/隐瞒错误/夸大/单纯讨好）⇒ 硬拦；以高效正确为目的，不采纳' };
}

export interface QingLiXiaoXi { kind?: string; ts?: number }

/**
 * 时效清理：反谄媚系统消息中，**早于最新 10 条**（不在最近 10 条内）**且超过 30 天**的删除。
 * 返回清理后的消息数组与删除数（按模型观点处理＝删除后不再待裁决）。
 */
export function qingLiGuoQiXiaoXi<T extends QingLiXiaoXi>(messages: T[], now: number, maxKeep = 10, maxAgeMs = 30 * 86400 * 1000): { messages: T[]; removed: number } {
  const n = (messages || []).length;
  const keepFrom = Math.max(0, n - maxKeep);
  const out: T[] = [];
  let removed = 0;
  (messages || []).forEach((m, i) => {
    const isAntiSyco = m && m.kind === 'anti-sycophancy';
    const age = now - Number(m?.ts || 0);
    if (isAntiSyco && i < keepFrom && age > maxAgeMs) { removed += 1; return; }
    out.push(m);
  });
  return { messages: out, removed };
}