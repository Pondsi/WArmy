/**
 * R260 项「记忆图谱/引用解链」：记忆图谱增强层（与现有实体/事件＋retrieve 锚点解链**互补，不替代**）。
 *
 * 现有＝点（实体/事件）＋锚点原文（retrieve 逐字节解引用）。本层在点之间加**边（关系）**：
 * 同一事件里共同出现的实体互为关联（共现即关系，权重=共现次数）。召回命中种子实体后，
 * **沿边一跳扩展**到关联实体，连同"经由哪条事件"一起交给模型去 retrieve 取原文 ——
 * 找全相关（图谱）＋取准原文（retrieve）叠加，召回更全、更可解释。
 *
 * 纯函数、无 IO，便于真值表门禁。
 */

export interface TuPuBianInfo { weight: number; jingYou: string[] }
export type TuPu = Map<string, Map<string, TuPuBianInfo>>;

/** 由事件集合构建无向共现图：事件内每对实体互加一条边（权重+1，记录经由事件标题）。 */
export function gouJianTuPu(events: Array<{ entityIds?: string[]; biaoTi?: string }>): TuPu {
  const tu: TuPu = new Map();
  const jiaBian = (a: string, b: string, jingYou: string) => {
    if (!a || !b || a === b) return;
    let nei = tu.get(a);
    if (!nei) { nei = new Map(); tu.set(a, nei); }
    let info = nei.get(b);
    if (!info) { info = { weight: 0, jingYou: [] }; nei.set(b, info); }
    info.weight += 1;
    if (jingYou && !info.jingYou.includes(jingYou) && info.jingYou.length < 5) info.jingYou.push(jingYou);
  };
  for (const e of events || []) {
    const ids = Array.from(new Set((e.entityIds || []).map(String).filter(Boolean)));
    const jingYou = String(e.biaoTi || '');
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        jiaBian(ids[i]!, ids[j]!, jingYou);
        jiaBian(ids[j]!, ids[i]!, jingYou);
      }
    }
  }
  return tu;
}

/** 一跳图扩展：从种子实体沿边找关联实体（排除种子），按累计共现权重降序，截断 maxNodes。 */
export function tuPuKuoZhan(zhongZi: string[], tu: TuPu, maxNodes = 6): Array<{ id: string; weight: number; jingYou: string[] }> {
  const zhong = new Set((zhongZi || []).map(String).filter(Boolean));
  const he = new Map<string, { weight: number; jingYou: string[] }>();
  for (const z of zhong) {
    const nei = tu.get(z);
    if (!nei) continue;
    for (const [id, info] of nei) {
      if (zhong.has(id)) continue;
      let cur = he.get(id);
      if (!cur) { cur = { weight: 0, jingYou: [] }; he.set(id, cur); }
      cur.weight += info.weight;
      for (const j of info.jingYou) if (!cur.jingYou.includes(j) && cur.jingYou.length < 5) cur.jingYou.push(j);
    }
  }
  return [...he.entries()]
    .map(([id, v]) => ({ id, weight: v.weight, jingYou: v.jingYou }))
    .sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, maxNodes));
}