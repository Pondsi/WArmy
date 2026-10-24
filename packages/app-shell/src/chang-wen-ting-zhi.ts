import zlib from 'node:zlib';

/**
 * chang-wen-ting-zhi —— 长文「慢写 / 复读 / 卡住」判定（第 51 轮，纯函数、零依赖）
 *
 * 行业做法（调研结论）：
 *  · distinct-n 重复率（Li et al. 2015）、Self-BLEU / 4-gram 重复（Texygen）
 *  · 压缩比判重复（CTRL, arxiv 1909.05858）
 *  · 新增信息量（新数字/新实体/新小标题）区分「慢写」与「复读」
 *  · Aider 的 max_reflections、Cline 的 mistakeTracker 连续错误上限
 *
 * 判定分工：
 *  · **复读**：4-gram 重复率高 或 gzip 压缩比异常高 且新增信息量≈0 ⇒ abort
 *  · **慢写**：段增量小但新增信息量仍为正 ⇒ nudge（只提示写新增，不判死）
 *  · **卡住**：速度低 + 新增信息量低 + 已 nudge ≥ 2 次 ⇒ abort
 *
 * 阈值可自校准：调用方传同模型正常样本的 p95；这里给保守默认值。
 */

export type TingZhiDongZuo = 'continue' | 'nudge' | 'abort';
export interface TingZhiPei {
  /** 4-gram 重复率上限（1 - distinct-4） */
  repHi?: number;
  /** gzip 压缩比上限 */
  crHi?: number;
  /** 新增信息量下限（低于它视为没有新内容） */
  infoLo?: number;
  /** 已 nudge 次数上限 */
  maxNudge?: number;
}
export interface TingZhiJieGuo {
  dong: TingZhiDongZuo;
  rep: number;
  cr: number;
  info: number;
  liYou: string;
}

/** 4-gram 重复率：(总 gram 数 - 去重 gram 数) / 总 gram 数 */
export function siGramChongFu(lianJie: string): number {
  const s = String(lianJie || '').replace(/\s+/g, '');
  if (s.length < 8) return 0;
  const he = new Map<string, number>();
  let zong = 0;
  for (let i = 0; i + 4 <= s.length; i++) {
    const g = s.slice(i, i + 4);
    he.set(g, (he.get(g) || 0) + 1);
    zong++;
  }
  if (!zong) return 0;
  return 1 - he.size / zong;
}

/** 粗粒度压缩比（用 zlib 同步压缩；失败退化为 1） */
export function yaSuoBi(wen: string): number {
  try {
    // 只压尾部样本，避免长文压缩耗时
    const yang = String(wen || '').slice(-40000);
    if (!yang) return 1;
    const ya = zlib.deflateSync(Buffer.from(yang, 'utf8'));
    return ya.length / Buffer.byteLength(yang, 'utf8');
  } catch { return 1; }
}

/** 新增信息量：新数字 + 新中文二元组 + 新标题行，占本段长度的比例（粗估，够区分有无新增） */
export function xinZengXinXi(duan: string, zhiQian: string): number {
  const s = String(duan || '');
  if (!s.trim()) return 0;
  const yi = new Set<string>();
  for (const m of String(zhiQian || '').matchAll(/[\u4e00-\u9fff]{2}|[0-9]+(?:\.[0-9]+)?/g)) yi.add(m[0]);
  let xin = 0;
  for (const m of s.matchAll(/[\u4e00-\u9fff]{2}|[0-9]+(?:\.[0-9]+)?/g)) if (!yi.has(m[0])) xin++;
  const biaoTi = (s.match(/^#{1,6}\s+.+$/gm) || []).length;
  return (xin + biaoTi * 5) / Math.max(20, s.length);
}

/**
 * 判定当前段落。
 * @param duan 最近 N 段（最后一段是刚写的）
 * @param zhiQian 之前全部正文（用于算"新增"）
 * @param nudgeCi 已经 nudge 过几次
 */
export function panDuanTingZhi(duan: string[], zhiQian: string, nudgeCi = 0, pei: TingZhiPei = {}): TingZhiJieGuo {
  const repHi = pei.repHi ?? 0.35;
  const crHi = pei.crHi ?? 0.55;   // deflate 比率高于 0.55 视为高度重复（≈gzip 比 2.5 的倒数）
  const infoLo = pei.infoLo ?? 0.012;
  const maxNudge = pei.maxNudge ?? 2;
  const lian = (duan || []).join('\n');
  const rep = siGramChongFu(lian);
  const cr = yaSuoBi(lian);
  const info = xinZengXinXi((duan || [])[(duan || []).length - 1] || '', zhiQian);
  if (rep > repHi && info < infoLo) {
    return { dong: 'abort', rep, cr, info, liYou: `复读：4-gram 重复率 ${rep.toFixed(2)} > ${repHi} 且新增信息≈0` };
  }
  if (cr > crHi && info < infoLo) {
    return { dong: 'abort', rep, cr, info, liYou: `复读：压缩比 ${cr.toFixed(2)} > ${crHi} 且新增信息≈0` };
  }
  if (info < infoLo) {
    return nudgeCi >= maxNudge
      ? { dong: 'abort', rep, cr, info, liYou: `卡住：已 nudge ${nudgeCi} 次仍无新增信息` }
      : { dong: 'nudge', rep, cr, info, liYou: '没有新增信息，提示只写新增' };
  }
  return { dong: 'continue', rep, cr, info, liYou: '有新增信息，继续' };
}
