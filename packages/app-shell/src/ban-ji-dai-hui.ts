/**
 * ban-ji-dai-hui —— 跨轮「黑板摘要」带回（第 51 轮，纯逻辑 + 有界）
 *
 * 用户口径（§18.6 #5，已按推荐定稿）：**同一计划/同一话题**的新一轮，自动带回上一轮黑板的
 * ≤2400 字有界摘要 + 指针；**跨任务不带**（新任务从零开始，避免把旧事带进新活）。
 *
 * 为什么要单独一份：黑板正文在记忆库（kind:'blackboard'，可按 renWuId recall 全文），
 * 但"这一轮该不该带、带哪一条任务"必须便宜且确定 —— 所以宿主另存一份**只有摘要行**的环。
 * 它不是第二事实源：只是指针与预览，冲突时以记忆库原文为准。
 */

export interface BanDaiHuiTiao {
  /** 会话/群 id（黑板按 groupId 存） */
  sessionId: string;
  /** 任务号（renWuId） */
  renWuId: string;
  /** 条目类别：fact/decision/artifact/question */
  lei: string;
  /** 摘要行（已截断，≤200 字） */
  wen: string;
  ts: number;
}

export interface BanDaiHuiKu {
  tiao: BanDaiHuiTiao[];
}

const ZUI_DA_TIAO_SHU = 40;
const ZUI_DA_ZI = 2400;
/** 只带这么久以内的（默认 6 小时）：更久的事让模型自己 recall */
export const DAI_HUI_CHUANG_KOU_MS = 6 * 3600 * 1000;

export function kongKu(): BanDaiHuiKu {
  return { tiao: [] };
}

/** 收一条（有界：按条数裁剪，最新的留） */
export function shouTiao(ku: BanDaiHuiKu, t: BanDaiHuiTiao): BanDaiHuiKu {
  const xin = { ...ku, tiao: [...(ku.tiao || []), { ...t, wen: String(t.wen || '').slice(0, 200) }] };
  if (xin.tiao.length > ZUI_DA_TIAO_SHU) xin.tiao = xin.tiao.slice(-ZUI_DA_TIAO_SHU);
  return xin;
}

/**
 * 生成**这一轮该带回的摘要**：同一会话、最近窗口内、**最近一个任务号**的条目。
 * 返回 null 表示没有可带的（新任务/过期/空）。
 */
export function daiHuiZhaiYao(ku: BanDaiHuiKu, sessionId: string, now = Date.now()): { wen: string; renWuId: string; tiaoShu: number } | null {
  const sid = String(sessionId || '');
  if (!sid) return null;
  const huo = (ku.tiao || []).filter((t) => t.sessionId === sid && now - Number(t.ts || 0) <= DAI_HUI_CHUANG_KOU_MS);
  if (!huo.length) return null;
  const zuiHou = huo[huo.length - 1]!;
  const renWuId = zuiHou.renWuId;
  const tong = huo.filter((t) => t.renWuId === renWuId);
  const biao = (lei: string) => (lei === 'fact' ? '事实' : lei === 'decision' ? '决定' : lei === 'artifact' ? '产物' : lei === 'question' ? '未决' : lei);
  const hang: string[] = [];
  let zi = 0;
  for (const t of tong) {
    const l = `· [${biao(t.lei)}] ${t.wen}`;
    if (zi + l.length > ZUI_DA_ZI) break;
    hang.push(l);
    zi += l.length + 1;
  }
  if (!hang.length) return null;
  return {
    renWuId,
    tiaoShu: hang.length,
    wen: `【上一轮任务黑板摘要 · 任务 ${renWuId}】\n${hang.join('\n')}\n（这是**上一轮同一任务**的有界摘要，不是新任务的内容；需要原文用 recall("${renWuId}") 取回。与用户这轮说的冲突时，一律以用户这轮为准。）`,
  };
}
