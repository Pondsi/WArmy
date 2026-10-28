/**
 * mo-xing-qiang-du —— 模型“强弱 / 快慢”的**可解释估计**（纯函数，不联网、不猜供应商）。
 *
 * 为什么需要它：值班者只能给“难易/杂简/急缓”，不能指定模型；但不同牛马自己的
 * 调用链里模型强弱/速度不同，值班者要据此挑人。这里只按**型号名**做保守估计：
 *  · 5 = 明显强（opus/pro/max/reasoner/70B+ …）
 *  · 4 = 较强（sonnet/gpt-5/32B/大参数 …）
 *  · 3 = 中等（普通 chat、未知型号）
 *  · 2 = 偏小（flash/mini/7B-12B …）
 *  · 1 = 很小/很快（nano/tiny/1.5B-3B …）
 *
 * 未知型号一律 3（不假装知道），这样不会因为名字认不出就把牛马排到后面。
 * 真实能力仍以模型自报/用户配置为准；这里只影响“派给谁”的初始倾向。
 */

const QIANG_5 = /(opus|gpt-5(?![-_.]?(?:mini|nano))|o3(?![-_.]?mini)|o4|reasoner|r1\b|ultra|max\b|405b|235b|110b|72b|70b|65b|command-r-plus|deepseek-v3(?![-_.]?(?:lite|tiny))|qwen3?-?max|gemini-2\.5-pro|gemini-3-pro)/i;
const QIANG_4 = /(sonnet|gpt-4\.1|gpt-4o(?![-_.]?mini)|claude-3\.7|claude-4|32b|34b|30b|27b|22b|20b|large|qwen3?-?plus|glm-4\.5|glm-4-plus|deepseek-v2\.5|mixtral-8x22b|command-r\b)/i;
const QIANG_2 = /(flash|mini|nano|tiny|small|lite|light|fast|instant|turbo|haiku|1\.5b|2b|3b|4b|7b|8b|9b|12b|13b|14b|qwen3?-?flash)/i;

/** 型号名 → 强弱 1..5（未知=3） */
export function guSuanMoXingQiangDu(ming: string): number {
  const s = String(ming || '');
  if (!s) return 3;
  if (QIANG_5.test(s)) return 5;
  if (QIANG_4.test(s)) return 4;
  if (QIANG_2.test(s)) return 2;
  if (/1b\b|0\.5b|tiny|nano/i.test(s)) return 1;
  return 3;
}

const KUAI_5 = /(flash|mini|nano|tiny|small|lite|instant|fast|turbo|haiku|1\.5b|2b|3b|4b|7b|8b|9b|12b|13b)/i;
const KUAI_2 = /(opus|max\b|ultra|reasoner|r1\b|thinking|deep|70b|72b|65b|235b|405b|32b|34b)/i;

/** 型号名 → 速度 1..5（未知=3；越大越快） */
export function guSuanMoXingSuDu(ming: string): number {
  const s = String(ming || '');
  if (!s) return 3;
  if (KUAI_5.test(s)) return 5;
  if (/turbo|flash/i.test(s)) return 5;
  if (KUAI_2.test(s)) return 2;
  return 3;
}

/** 型号名 → 三档（兼容旧 modelTier 口径） */
export function guSuanMoXingTier(ming: string): 'high' | 'mid' | 'low' {
  const q = guSuanMoXingQiangDu(ming);
  return q >= 4 ? 'high' : q <= 2 ? 'low' : 'mid';
}

/** 一组模型里最强的那个（空 → 空串） */
export function zuiQiangMoXing(models: string[]): string {
  let best = '';
  let bestQ = -1;
  for (const m of models || []) {
    const s = String(m || '').trim();
    if (!s) continue;
    const q = guSuanMoXingQiangDu(s);
    if (q > bestQ) { bestQ = q; best = s; }
  }
  return best;
}

/** 一组模型里最快的那个（空 → 空串） */
export function zuiKuaiMoXing(models: string[]): string {
  let best = '';
  let bestS = -1;
  for (const m of models || []) {
    const s = String(m || '').trim();
    if (!s) continue;
    const q = guSuanMoXingSuDu(s);
    if (q > bestS) { bestS = q; best = s; }
  }
  return best;
}

/** 这组模型里是否有“明显强”的（q>=4） */
export function youQiangMoXing(models: string[]): boolean {
  return (models || []).some((m) => guSuanMoXingQiangDu(String(m || '')) >= 4);
}

/** 这组模型里是否有“明显快”的（q>=4） */
export function youKuaiMoXing(models: string[]): boolean {
  return (models || []).some((m) => guSuanMoXingSuDu(String(m || '')) >= 4);
}
