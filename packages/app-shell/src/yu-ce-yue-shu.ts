/**
 * R260 项「数学/哲学证明更好方案→预测类」：神经符号（neuro-symbolic）预测约束闸。
 *
 * 思路（NSVIF / ConstraintLLM / 证据单元约束验证）：LLM/启发式生成候选预测，
 * **符号验证器**按可形式化约束裁决——通过才采纳；不通过回退保守值并留痕（可审计、零违例）。
 * 优于纯模型自判：约束是确定的、可回归测试的，不靠主观自评。
 *
 * 纯函数模块：不依赖 Electron/IO，便于真值表门禁。预测类（ETA/难度/分身数/迪文词根坐标）
 * 统一走这里裁决；调用方拿 `caiNa` 后的值，绝不采纳违例候选。
 */

/** 单条符号约束：name 用于审计；test 返回 true=满足；fallback 违例时的保守回退（可选）。 */
export interface YuCeYueShu<T> {
  name: string;
  test: (v: T) => boolean;
  fallback?: T;
  /** 违例时是否把值夹取/修正为 fallback（true=修正后采纳；false=直接拒绝该候选） */
  repair?: boolean;
}

export interface ShenHeJieGuo<T> {
  ok: boolean;
  /** 裁决后采纳的值（违例且可修正时为 fallback；违例不可修正时为原候选但 ok=false） */
  value: T;
  /** 命中的违例约束名（空=全通过） */
  violations: string[];
  /** 是否发生过修正 */
  adjusted: boolean;
}

/** 通用符号闸：逐条校验候选；违例可修正→取 fallback 继续；不可修正→ok=false（调用方应弃用候选）。 */
export function shenHeYuCe<T>(candidate: T, constraints: Array<YuCeYueShu<T>>): ShenHeJieGuo<T> {
  let value = candidate;
  const violations: string[] = [];
  let adjusted = false;
  let ok = true;
  for (const c of constraints || []) {
    let pass = false;
    try { pass = !!c.test(value); } catch { pass = false; }
    if (pass) continue;
    violations.push(c.name);
    if (c.repair && c.fallback !== undefined) { value = c.fallback; adjusted = true; }
    else ok = false;
  }
  return { ok, value, violations, adjusted };
}

const youXiaoShu = (n: unknown): boolean => typeof n === 'number' && Number.isFinite(n);
const zhengShu = (n: unknown): boolean => youXiaoShu(n) && Number.isInteger(n);

/** ETA（秒）约束：有限、≥0、≤上限（默认 7 天）；违例回退「无时限」null（保守，不误设短时限）。 */
export function etaYueShu(miao: number | null, maxMiao = 7 * 86400): ShenHeJieGuo<number | null> {
  if (miao == null) return { ok: true, value: null, violations: [], adjusted: false };
  return shenHeYuCe<number | null>(miao, [
    { name: 'eta-finite', test: (v) => v == null || youXiaoShu(v), fallback: null, repair: true },
    { name: 'eta-non-negative', test: (v) => v == null || (youXiaoShu(v) && (v as number) >= 0), fallback: null, repair: true },
    { name: 'eta-upper-bound', test: (v) => v == null || (youXiaoShu(v) && (v as number) <= maxMiao), fallback: maxMiao, repair: true },
  ]);
}

/** 难度/复杂度/急缓/重要度约束：1–5 整数；越界夹取到边界（保守修正）。 */
export function nanYiDuYueShu(jieGuo: { nan: number; za: number; ji: number; importance: number }): ShenHeJieGuo<{ nan: number; za: number; ji: number; importance: number }> {
  const jia = (n: number): number => (zhengShu(n) ? Math.min(5, Math.max(1, n as number)) : 3);
  const hou = { nan: jia(jieGuo.nan), za: jia(jieGuo.za), ji: jia(jieGuo.ji), importance: jia(jieGuo.importance) };
  const wei = (k: 'nan' | 'za' | 'ji' | 'importance') => !zhengShu(jieGuo[k]) || (jieGuo[k] as number) < 1 || (jieGuo[k] as number) > 5;
  const violations = (['nan', 'za', 'ji', 'importance'] as const).filter(wei).map((k) => 'nanyidu-' + k + '-range');
  return { ok: true, value: hou, violations, adjusted: violations.length > 0 };
}

/** 分身/子代理数量约束：0–上限 整数；越界夹取（默认上限 8）。 */
export function fenShenShuYueShu(n: number, shangXian = 8): ShenHeJieGuo<number> {
  const jia = zhengShu(n) ? Math.min(shangXian, Math.max(0, n as number)) : 0;
  const wei = !zhengShu(n) || (n as number) < 0 || (n as number) > shangXian;
  return { ok: true, value: jia, violations: wei ? ['fenshen-count-range'] : [], adjusted: wei };
}

/** 迪文词根坐标约束：互不碰撞（同一坐标只容一个词根）；碰撞者拒绝（ok=false，调用方另选坐标）。 */
export function ciGenZuoBiaoYueShu(zuoBiao: Array<{ x: number; y: number }>): ShenHeJieGuo<Array<{ x: number; y: number }>> {
  const seen = new Set<string>();
  let chong = false;
  for (const z of zuoBiao || []) {
    if (!youXiaoShu(z?.x) || !youXiaoShu(z?.y)) { chong = true; continue; }
    const k = String(z.x) + ',' + String(z.y);
    if (seen.has(k)) chong = true;
    seen.add(k);
  }
  return { ok: !chong, value: zuoBiao, violations: chong ? ['cigen-coordinate-collision'] : [], adjusted: false };
}

/** 预测裁决入口（供 IPC/各预测路径复用）：按类型选约束，返回采纳值＋是否修正＋违例名。 */
export function jiaoYanYuCe(lei: string, value: unknown, ctx?: { maxMiao?: number; fenShenShangXian?: number }): { ok: boolean; value: unknown; violations: string[]; adjusted: boolean } {
  switch (String(lei || '')) {
    case 'eta': { const r = etaYueShu(value as number | null, ctx?.maxMiao); return { ok: r.ok, value: r.value, violations: r.violations, adjusted: r.adjusted }; }
    case 'nanyidu': { const r = nanYiDuYueShu(value as { nan: number; za: number; ji: number; importance: number }); return { ok: r.ok, value: r.value, violations: r.violations, adjusted: r.adjusted }; }
    case 'fenshen': { const r = fenShenShuYueShu(value as number, ctx?.fenShenShangXian); return { ok: r.ok, value: r.value, violations: r.violations, adjusted: r.adjusted }; }
    case 'cigen': { const r = ciGenZuoBiaoYueShu(value as Array<{ x: number; y: number }>); return { ok: r.ok, value: r.value, violations: r.violations, adjusted: r.adjusted }; }
    default: return { ok: true, value, violations: [], adjusted: false };
  }
}