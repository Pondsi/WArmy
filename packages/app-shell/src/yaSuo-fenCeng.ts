/**
 * 固定开销的**分层压缩**调度（第 52 轮用户口径：不要一次就压到极限）。
 *
 * 优先级阶梯（高 → 低）：
 *   产品硬门禁 > 道 > 术 > 规范 > 印象 > 工具 > 软门禁 > 教条 > 束缚 > 认知 > 身份/模型/时间
 * 压缩顺序 = 阶梯的**倒序**，并且**分层递进**（第 53 轮按用户口径：规范与术同层）：
 *   第一遍（半极限）：第 0 层无名段 → 第 1 层（印象/工具/软门禁）→ 第 2 层（教条/束缚/认知/身份）→ 第 3 层（规范/术）
 *   第二遍（真极限）：同样顺序再来一遍，把每一层压到它自己的下限。
 * ⇒ 优先级越高的内容，在上下文不足时**越晚被动、动得越浅**，留下的越多。
 *
 * 「道」与「产品门禁」永不可压缩（`BU_KE_YA_SUO`，在 `yuSuan-jiage.ts`），根本不进这个队列。
 * 单独成模块是为了**能脱开 Electron 跑真值表**（见 scripts/verify-r52-yasuo.mjs）。
 */
/** 段标签前缀 → 压缩层级。层内也是"从低优先级开始压"。 */
export const YA_SUO_CENG: string[][] = [
  ['软门禁', '工具', '印象'],
  ['身份', '认知', '束缚', '教条'],
  ['规范', '术'],
];
/** 第 0 层：不在阶梯上的段（本轮工具面收窄的通知、上一轮任务黑板摘要等）——没有"保留"承诺，最先压 */
export const YA_SUO_CENG_0 = ['本轮工具面收窄', '上一轮任务黑板摘要'];

/**
 * 扁平的"先压谁"顺序（层与层按阶梯倒序，层内也是倒序）：
 * 软门禁 → 工具 → 印象 → 身份 → 认知 → 束缚 → 教条 → 规范 → 术。
 * 注意 **规范（优先级比 身份/认知 高）排在它们前面**：这是用户点名的分层口径
 * （先把第 1 层整体压到半极限，再动第 2 层；第 53 轮起规范与术同层），不是写错序。
 */
export const YA_SUO_XIAN_HOU_PING: string[] = YA_SUO_CENG.flat();

/** 半极限：留 72%（第一轮） */
export const YA_SUO_BAN = 0.72;
/** 真极限：留 45%（第二轮），且不少于 `YA_SUO_DI_XIAN` 字 */
export const YA_SUO_ZHEN = 0.45;
/** 任何一段压到底也至少留这么多字：真机抓过的原罪是一刀切到 15% ⇒ 模型改成"口头执行" */
export const YA_SUO_DI_XIAN = 600;

export type YaSuoLun = { ceng: number; qiangDu: number };
/** 8 遍：半极限走完三层（含无名段），再来一遍真极限 */
export const BENG_DAO: YaSuoLun[] = [YA_SUO_BAN, YA_SUO_ZHEN].flatMap((q) => [0, 1, 2, 3].map((c) => ({ ceng: c, qiangDu: q })));

/** 这一段的层级：-1 = 不可压缩（道 / 产品门禁），0 = 无名段，1..3 = 阶梯分层 */
export function cengOf(biao: string, buKe: readonly string[] = ['道', '产品门禁']): number {
  const ming = String(biao || '');
  if (buKe.some((k) => ming.startsWith(k))) return -1;
  for (let c = 0; c < YA_SUO_CENG.length; c++) {
    if ((YA_SUO_CENG[c] || []).some((k) => ming.startsWith(k))) return c + 1;
  }
  if (YA_SUO_CENG_0.some((k) => ming.startsWith(k))) return 0;
  return 0;
}

/** 层内名次：越靠前越先被压（层表本身就是倒序写的） */
export function cengNeiMing(biao: string, ceng: number): number {
  if (ceng <= 0) return 0;
  const biaoList = YA_SUO_CENG[ceng - 1] || [];
  const w = biaoList.findIndex((k) => String(biao || '').startsWith(k));
  return w < 0 ? biaoList.length : w;
}

export type YaSuoDuan = { i: number; biao: string; yuanShi: number; dangQian: number };
export type YaSuoBianGeng = { i: number; yuanShi: number; cong: number; dao: number };

/** 一段压到目标强度后应有的长度（相对**原文长度**算，反复压不会叠成 72%×45%） */
export function muBiaoChangDu(yuanShi: number, qiangDu: number): number {
  const diXian = Math.min(Math.max(YA_SUO_DI_XIAN, Math.floor(yuanShi * YA_SUO_ZHEN)), yuanShi);
  return Math.max(diXian, Math.min(yuanShi, Math.floor(yuanShi * qiangDu)));
}

/**
 * 规划一遍压缩：只动 `lun.ceng` 这一层的段，按层内优先级倒序，压到 `lun.qiangDu` 对应的目标长度，
 * 攒够 `queKouZi`（字符缺口）就收手 —— **不许越层提前动**（这是"优先级越高保留越多"的兑现点）。
 */
export function guiHuaYiLun(
  duan: readonly YaSuoDuan[],
  lun: YaSuoLun,
  queKouZi: number,
): { bianGeng: YaSuoBianGeng[]; jianDi: number } {
  const candidates = duan
    .map((d) => ({ d, c: cengOf(d.biao) }))
    .filter((x) => x.c === lun.ceng && x.c !== -1)
    .filter((x) => x.d.dangQian > muBiaoChangDu(x.d.yuanShi, lun.qiangDu))
    .sort((a, b) => (cengNeiMing(a.d.biao, lun.ceng) - cengNeiMing(b.d.biao, lun.ceng)) || (a.d.i - b.d.i));
  let yao = Math.max(0, Math.floor(queKouZi) || 0);
  const bianGeng: YaSuoBianGeng[] = [];
  let jianDi = 0;
  for (const x of candidates) {
    if (yao <= 0 || jianDi >= (Math.floor(queKouZi) || 0)) break;
    const mu = muBiaoChangDu(x.d.yuanShi, lun.qiangDu);
    const jian = x.d.dangQian - mu;
    if (jian <= 0) continue;
    bianGeng.push({ i: x.d.i, yuanShi: x.d.yuanShi, cong: x.d.dangQian, dao: mu });
    jianDi += jian;
    yao -= jian;
  }
  return { bianGeng, jianDi };
}
