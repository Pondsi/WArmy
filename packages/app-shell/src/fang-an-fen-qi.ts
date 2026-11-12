/**
 * R167 项1：**方案分歧硬门禁**的纯判定逻辑（可单测）。
 *
 * 主人定稿的决策树：
 *   ① 任何一组方案**都必须有推荐项**（tuiJian）+ 置信度；没有推荐时宿主保底标一个（宁可停下也不替人瞎猜）。
 *   ② 勾选了「自动选择」(autoSelectRecommended) ⇒ 牛马按推荐自己定，**不弹卡**。
 *   ③ 多个方案时牛马要**先自行验证**每个都有效；若**各有利弊**（都可用、置信度接近）⇒ 弹选择卡让用户选。
 *   ④ 若**只有一个明显可用**（置信度高），其余置信度很低 ⇒ **不弹卡**，直接用那个唯一明显可用的。
 *
 * 本模块只做④的纯判定（单一明显可用）与置信度归一，供宿主在开卡前调用；
 * ②③ 的「自动选择 / 各有利弊要问」由宿主提示词 + 开卡逻辑保证。
 */

/** 置信度「高」阈值：≥ 此值视为明显可用 */
export const ZHI_XIN_GAO = 0.7;
/** 置信度「低」阈值：其余选项都 < 此值才算「很低」 */
export const ZHI_XIN_DI = 0.4;

export interface FangAnXuanXiang {
  tuiJian?: boolean;
  keXinDu?: number;
  confidence?: number;
  biaoQian?: string;
}

/** 归一置信度到 0..1（兼容 0..100 与 0..1）；缺失返回 null */
export function guiYiZhiXin(o: FangAnXuanXiang | undefined | null): number | null {
  if (!o) return null;
  const raw = Number(o.keXinDu ?? o.confidence);
  if (!Number.isFinite(raw)) return null;
  const v = raw > 1 ? raw / 100 : raw;
  return Math.max(0, Math.min(1, v));
}

/**
 * ④ 单一明显可用：≥2 个选项，**恰好一个**置信度 ≥ GAO，且**其余全部** < DI ⇒ 返回该选项下标；否则 null。
 * 置信度缺失的选项视为「低」（不敢当成明显可用）。
 */
export function danYiMingXian(opts: readonly FangAnXuanXiang[]): number | null {
  if (!Array.isArray(opts) || opts.length < 2) return null;
  const zhi = opts.map((o) => guiYiZhiXin(o));
  const gao: number[] = [];
  for (let i = 0; i < zhi.length; i++) {
    const v = zhi[i] ?? null;
    if (v !== null && v >= ZHI_XIN_GAO) gao.push(i);
  }
  if (gao.length !== 1) return null;
  const idx = gao[0]!;
  for (let i = 0; i < zhi.length; i++) {
    if (i === idx) continue;
    const v = zhi[i] ?? null;
    if (v === null) continue;          // 缺失视为低
    if (v >= ZHI_XIN_DI) return null;  // 还有别的不够低 ⇒ 不算「唯一明显」
  }
  return idx;
}

/** ① 是否已有推荐项 */
export function youTuiJian(opts: readonly FangAnXuanXiang[]): boolean {
  return (opts || []).some((o) => o && o.tuiJian === true);
}

/** ① 无推荐时保底标哪个：第一个非「停止/取消/拒绝」项；全是被停类则 null（不代选） */
export function baoDiTuiJian(opts: readonly FangAnXuanXiang[]): number | null {
  if (youTuiJian(opts)) return null;
  for (let i = 0; i < (opts || []).length; i++) {
    const b = String(opts[i]?.biaoQian || '');
    if (!/停止|取消|拒绝|Stop|Cancel|Reject/i.test(b)) return i;
  }
  return null;
}