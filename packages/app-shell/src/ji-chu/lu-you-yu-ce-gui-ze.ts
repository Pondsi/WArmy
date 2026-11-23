/** 路由学习的基础规范与不可越界包络。只允许有界数值，不执行模型生成代码/正则。 */
export interface LuYouCanShu { under: number; surplus: number; speed: number; history: number; failure: number; urgentAt: number; insertAt: number }
export const LU_YOU_MO_REN: LuYouCanShu = { under: 40, surplus: 5, speed: 15, history: 10, failure: 30, urgentAt: 4, insertAt: 3 };
export const LU_YOU_BIAN_JIE = { under: [20, 120], surplus: [0, 20], speed: [0, 40], history: [0, 40], failure: [0, 60], urgentAt: [4, 5], insertAt: [2, 3] } as const;
export function jianYanLuYouCanShu(p: unknown): LuYouCanShu | null {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const o = p as Record<string, unknown>;
  if (Object.keys(o).some((k) => !(k in LU_YOU_MO_REN))) return null;
  const result = { ...LU_YOU_MO_REN, ...o };
  for (const k of Object.keys(LU_YOU_BIAN_JIE) as Array<keyof LuYouCanShu>) {
    const v = result[k], [lo, hi] = LU_YOU_BIAN_JIE[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) return null;
  }
  if (!Number.isInteger(result.urgentAt) || !Number.isInteger(result.insertAt) || result.insertAt >= result.urgentAt) return null;
  return result as LuYouCanShu;
}
/** 线上选择与留出回放共用同一评分式；能力底线和候选过滤由调用方先执行。 */
export function luYouMoXingPingFen(c: { model: string; qualityTier: number; speedTier: number; local: boolean }, task: { nan: number; ji: number }, p: LuYouCanShu, learned = 0): number {
  const { nan, ji } = task, q = c.qualityTier, su = c.speedTier, ben = c.local;
  let score = q < nan ? -(nan - q) * p.under : (q - nan) * p.surplus;
  score += Number.isFinite(learned) ? Math.max(-p.failure, Math.min(p.history, learned)) : 0;
  if (nan >= 5 && q >= 5) score += 30;
  if (nan >= 4 && !ben) score += 10;
  if (nan <= 2 && ben) score += 15;
  if (ji >= p.urgentAt) {
    score += (su - 3) * p.speed + (ben ? -8 : 12);
    if (ji >= 5) {
      score += su >= 4 ? 10 : 0;
      if (/flash|turbo|instant|fast|haiku/i.test(c.model)) score += 12;
    }
  } else if (ji <= 2) score += (q - 3) * 10;
  else score += (q - 3) * 4 + (su - 3) * 4;
  return score;
}
