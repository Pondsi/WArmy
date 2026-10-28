/**
 * 提示词 / 知识库的「互斥放置」判据（纯函数，门禁直接跑真值表）。
 *
 * 用户 2026-10-25 口径：
 *  · **互斥组** = 知识库（会话/内部/私密三层）+ 模型会自动改写的提示词（术、印象）。
 *    同一内容只能出现在其中**一处**；归档时一条内容只能放进一个位置。
 *  · 提示词里的旧内容要被替换时，旧内容先写入知识库，再把新内容写进提示词。
 *  · **规范**、以及只能由人写的提示词（道/教条/束缚/认知）**不参与互斥**：
 *    只要满足规范要求，可以写进规范，也允许和知识库/其它提示词重复。
 *
 * 说明：归档摘要事件（`laiYuan` 以 archive: / derived: 开头）是**溯源记录**，不是待放置的内容条目，
 * 不参与互斥；否则摘要里必然包含用户原话，会把术/印象永远判成重复。
 */

export type HuChiWei = 'knowledge' | 'shu' | 'yinXiang';

/** 去掉空白与标点、统一小写后的比较键 */
export function guiYiWenBen(s: unknown): string {
  return String(s == null ? '' : s).toLowerCase().replace(/[\s\p{P}]/gu, '');
}

/**
 * 同一条内容（用于**同一层内**的新旧替换）：
 *  · 归一后完全相同；或
 *  · 短的那条 ≥ 8 字，且被长的那条完整包含（避免“先查后问”这种 4 字短语误判）。
 */
export function shiTongYiNeiRong(a: unknown, b: unknown): boolean {
  const x = guiYiWenBen(a);
  const y = guiYiWenBen(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const duan = x.length <= y.length ? x : y;
  const chang = x.length <= y.length ? y : x;
  return duan.length >= 8 && chang.includes(duan);
}

/**
 * **跨库放置**是否算“同一条”：只认归一后完全相等。
 * 不能用包含判断：旧条目迁进知识库后，新说法往往是“旧说法 + 新要求”（包含旧说法），
 * 若按包含判重，新说法会被误拒，用户要的“旧内容进知识库、新内容进提示词”就永远做不到。
 */
export function shiZhanWeiChongFu(a: unknown, b: unknown): boolean {
  const x = guiYiWenBen(a);
  const y = guiYiWenBen(b);
  return !!x && x === y;
}

/**
 * 候选内容是否已在互斥组里。
 * `ziShen` 是即将写入的位置：命中同位置不算“重复放置”，由调用方自己决定是否跳过。
 */
export function zhaoHuChiWeiZhi(
  candidate: unknown,
  cang: { knowledge?: readonly unknown[]; shu?: readonly unknown[]; yinXiang?: readonly unknown[] },
  ziShen?: HuChiWei,
): HuChiWei | null {
  const w = String(candidate == null ? '' : candidate).trim();
  if (!w) return null;
  const zhao = (lie: readonly unknown[] | undefined): boolean =>
    Array.isArray(lie) && lie.some((x) => shiZhanWeiChongFu(w, x));
  if (ziShen !== 'knowledge' && zhao(cang.knowledge)) return 'knowledge';
  if (ziShen !== 'shu' && zhao(cang.shu)) return 'shu';
  if (ziShen !== 'yinXiang' && zhao(cang.yinXiang)) return 'yinXiang';
  return null;
}

/**
 * 只有这两层参与互斥；要求/短记忆（guifan）/道/教条/束缚/认知都豁免（可重复）。
 * 保留成表，避免以后有人把“要求/短记忆”加进互斥时没有一处可查的口径。
 */
export const HU_CHI_TI_SHI_CENG = ['shu', 'yinXiang'] as const;
export const BU_HU_CHI_TI_SHI_CENG = ['yaoqiu', 'guifan', 'dao', 'jiaotiao', 'shufu', 'renzhi'] as const;

export function shiHuChiTiShiCeng(ceng: string): boolean {
  return (HU_CHI_TI_SHI_CENG as readonly string[]).includes(String(ceng));
}
