/**
 * recall-hard-gate —— recall/retrieve 硬门禁（R191 项3）。
 *
 * 三层（按建议方案）：
 *  ① 保底：宿主前置召回（electron-main 已有，不依赖模型是否调工具）。
 *  ② 回忆意图强制：识别回忆意图 ⇒ 该轮 toolChoice:'required' + 强化前置召回（本模块给判据）。
 *  ③ 接地校验反幻觉：答案的事实断言必须有召回证据/工具输出支撑；无支撑 ⇒ 强制召回；
 *     记忆中没有 ⇒ 强制换路（联网搜索等）；换路仍无 ⇒ 诚实兜底「不知道」，**禁止编造**。
 *
 * 本模块是纯函数（门禁可脱机真值表）；循环上限硬约束，绝不无限强制。
 * 诚实边界：接地校验降低而非根除幻觉（断言抽取/蕴含判断有误差）；私有数据不在公网，换路找不到只能诚实说不知道。
 */

/** 回忆意图判据：用户话里指向「过去说过/经历过的事实」。只看最后一条用户消息。 */
export const HUI_YI_YI_TU = /(之前|上次|上回|先前|前面|刚才| earlier|第\s*\d+\s*[轮次条]|你记得|还记得|记得吗|我们说过|我告诉过你|我说过|你说过|你提到|我提到|回忆|回想|remember|recall|earlier|previously|last time)/i;

/** 用户明确禁止工具时不强制（与动手任务同口径）。 */
export const JIN_ZHI_GONG_JU = /(不要|别|禁止|无需|不用).{0,8}(调用|使用|动用)?工具|只(回复|输出|回答)|不要做别的|do not use tools|no tools/i;

export function shiBieHuiYiYiTu(text: string): boolean {
  const t = String(text || '');
  return HUI_YI_YI_TU.test(t) && !JIN_ZHI_GONG_JU.test(t);
}

/** 回忆意图轮的前置召回强化参数（条数更多、查询更长）。 */
export function qianZhiZhaoHuiCanShu(huiYiYiTu: boolean): { limit: number; queryChars: number } {
  return huiYiYiTu ? { limit: 6, queryChars: 200 } : { limit: 3, queryChars: 120 };
}

export type JieDiDongZuo = 'ok' | 'force-recall' | 'force-alternative' | 'honest-fallback';
export interface JieDiJieGuo { grounded: boolean; action: JieDiDongZuo; reason: string; }

/**
 * 接地校验：回忆意图轮的答案是否有证据接地。
 * 调了 recall/retrieve，或前置召回有命中 ⇒ 视为有证据（ok）。
 * 回忆轮但零召回证据 ⇒ 疑似幻觉 ⇒ 强制召回（force-recall）。
 * 非回忆轮不强制（ok，保留模型自判）。
 */
export function jianChaJieDi(opts: { huiYiYiTu: boolean; diaoYongGongJu: string[]; qianZhiZhaoHuiMingZhong: number }): JieDiJieGuo {
  if (!opts.huiYiYiTu) return { grounded: true, action: 'ok', reason: '非回忆轮，保留模型自判' };
  const diaoLe = (opts.diaoYongGongJu || []).some((t) => t === 'recall' || t === 'retrieve');
  if (diaoLe) return { grounded: true, action: 'ok', reason: '已调用 recall/retrieve，有证据接地' };
  if ((opts.qianZhiZhaoHuiMingZhong || 0) > 0) return { grounded: true, action: 'ok', reason: '前置召回有命中，有证据接地' };
  return { grounded: false, action: 'force-recall', reason: '回忆断言无召回证据支撑，强制召回（反幻觉）' };
}

/**
 * 强制召回后的升级决策（带硬上限，绝不无限循环）。
 * 召回有命中 ⇒ ok；记忆中没有且未换路过 ⇒ 强制换路（联网搜索等）；换路仍无 ⇒ 诚实兜底。
 * @param yiChangShiHuanLu 已尝试换路次数（0=还没换过）
 */
export function zhaoHuiHouJueDing(zhaoHuiYouMingZhong: boolean, yiChangShiHuanLu: number): JieDiDongZuo {
  if (zhaoHuiYouMingZhong) return 'ok';
  if (yiChangShiHuanLu < 1) return 'force-alternative';
  return 'honest-fallback';
}

/** 诚实兜底文案（禁止编造）。 */
export const CHENG_SHI_DOU_DI = '我在记忆里没有找到相关内容，联网检索也没有可靠结果，因此无法确认这件事——我不编造答案。如果你能提供更多线索，我再帮你查。';

/** 强制召回提示（注入系统消息，驱动模型调 recall/retrieve）。 */
export const QIANG_ZHI_ZHAO_HUI_TI_SHI = '【回忆硬门禁】本轮涉及对过去事实的回忆，但你尚未用证据支撑。必须先调用 recall(关键词) 召回证据、必要时 retrieve(seq=…) 取原文，再据实回答；记忆里确实没有就如实说没有，禁止编造。';

/** 强制换路提示（记忆没有 ⇒ 联网搜索等其他方法）。 */
export const QIANG_ZHI_HUAN_LU_TI_SHI = '【回忆硬门禁】记忆里没有这条内容。请换其他方法寻找正确答案（如联网搜索 search_web、查文档），据实回答；仍找不到就如实说不知道，禁止编造。';