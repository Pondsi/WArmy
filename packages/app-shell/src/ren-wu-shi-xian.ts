/**
 * R163 #8：**用户时限**（「3 分钟内做不完就停下来总结」）。
 *
 * 真机事故（会话 inst-1794395477366-g2zs1）：
 *   用户原话「…如果 3 分钟内无法完成，就总结目前的成果，有哪些需要我决策的地方，写出交接文档等。」
 *   模型自己在 461 秒（7.7 分钟）后才写「老板，3 分钟到了」，写完又被宿主续派两次
 *   （`plan.auto-continue why=completion-check` / `why=plan-open-keep`），接着去写代码 ——
 *   等于把用户明确的「到点收尾」当成「中途停下需要补做」。
 *
 * 真因两条：
 *   ① 宿主**没有把用户时限当成硬约束**。审计里唯一与时间有关的是 ETA 预测系统，
 *      它的 `yuJingMiao` 是默认预警阈值，命中后只记 `plan.eta-limit-hit`，
 *      再因为「有进展」而 `plan.eta-skipped-no-stall-signal` ⇒ 从不强制停。
 *   ② 续派决策（完成核对 / 计划未完成续派 / 字数续派 / 只说不做）都不知道有用户时限。
 *
 * 本模块只做**纯解析与纯计算**，便于在 Node 里直接跑真值表；
 * 落账、拦截、收尾指令由主进程负责（见 electron-main.ts 的 renWuShiXian 相关段）。
 *
 * 口径（R167 主人定稿，写清依据）：
 *   · 用户说「过几分钟 / 等几分钟 / 几分钟之后 / 每过几分钟 / N 分钟内…」一律指**物理世界真实时间**
 *     （由时间戳决定），**等卡的时间也算**。除非用户**明确**说「不算等卡/不含等待」才用 net。
 *   · 口径有疑问（既像等待又像时限）⇒ 弹选择卡让用户选该任务的准确口径（见 shiXianYouYiWen）。
 *   · **ETA/执行时间**另算：预测本轮/本任务耗时**不含等卡**（work-time / eta 侧扣等卡），与本时限口径分离。
 *   · 到点不是硬杀，而是**进入收尾模式**：停止一切自动续派，只再派一轮
 *     「总结成果 + 列出需要用户决策的地方 + 写交接文档」（这正是用户要的）。
 *   · 没有时限时行为完全不变（ETA 预测、计划续派、完成核对全部照常）。
 */

/** 中文数字 → 阿拉伯（只覆盖时限里会出现的量级） */
const ZH_SHU: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

/** 解析「三」「十五」「二十」「半」这类写法；解析不了返回 null */
export function jieXiZhShu(raw: string): number | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^\d+(?:\.\d+)?$/.test(s)) return Number(s);
  if (s === '半') return 0.5;
  if (s === '十') return 10;
  const shi = s.indexOf('十');
  if (shi >= 0) {
    const qian = s.slice(0, shi);
    const hou = s.slice(shi + 1);
    const q = qian ? ZH_SHU[qian] : 1;
    const h = hou ? ZH_SHU[hou] : 0;
    if (q === undefined || h === undefined) return null;
    return q * 10 + h;
  }
  const v = ZH_SHU[s];
  return v === undefined ? null : v;
}

/** 时限意图词：必须出现，否则「3 分钟的视频」这种也会被当成时限。
 *  注意包含裸「停」：用户真实写法是「3 分钟内不行就停」，只有停下/停止会漏判。 */
const YI_TU = /停|收工|收尾|结束|别再|不要再|限时|时限|限制|之内|以内|内完成|内无法|内做不|内没|截止|timeout|deadline|stop|limit|within|wrap\s*up/i;
/** 排除：这是「让 AI 等一会儿」的任务步骤，不是给整个任务的时限 */
const PAI_CHU = /(?:等|等待|睡|休眠|暂停|延迟|延时|sleep|wait|delay)\s*$/i;

const DAN_WEI: Array<{ re: RegExp; ms: number }> = [
  { re: /^(?:秒钟|秒|s\b|sec\b|secs\b|seconds?\b)/i, ms: 1000 },
  { re: /^(?:分钟|分(?!钟)|mins?\b|minutes?\b)/i, ms: 60_000 },
  { re: /^(?:小时|个小时|时(?!间)|hrs?\b|hours?\b)/i, ms: 3_600_000 },
];

export interface ShiXianJieXi {
  /** 时限毫秒 */
  ms: number;
  /** 命中的原文片段（写进审计与收尾说明，便于用户核对宿主理解对不对） */
  yuanWen: string;
}

/**
 * 从用户原话里解析时限。
 *
 * 命中条件（两者都要）：① 出现「数字 + 时间单位」；② 该数字前后一小段里有**时限意图词**。
 * 刻意保守：宁可漏判（退回无时限、行为不变），也不要把「等 3 分钟」这类步骤误当成整任务时限。
 * 多个候选取**最短**的那个（用户说「3 分钟内不行就停，最多 10 分钟」时按 3 分钟收尾）。
 */
export function jieXiShiXian(text: string): ShiXianJieXi | null {
  const raw = String(text || '');
  if (!raw.trim()) return null;
  /** 「半小时」单独认（没有数字） */
  const hou = /(?:^|[^\d])(半个?(?:小时|钟头))/i.exec(raw);
  const out: ShiXianJieXi[] = [];
  if (hou && YI_TU.test(raw)) {
    out.push({ ms: 1_800_000, yuanWen: hou[1]! });
  }
  const re = /(\d+(?:\.\d+)?|[一二两三四五六七八九十]+|半)\s*(秒钟|秒|分钟|分|个小时|小时|钟头|s\b|secs?\b|seconds?\b|mins?\b|minutes?\b|hrs?\b|hours?\b)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const numRaw = String(m[1] || '');
    const danRaw = String(m[2] || '');
    const n = jieXiZhShu(numRaw);
    if (n === null || !(n > 0)) continue;
    const dan = DAN_WEI.find((d) => d.re.test(danRaw));
    if (!dan) continue;
    const ms = Math.round(n * dan.ms);
    /** 上限 24 小时、下限 5 秒：防「0.001 秒」把任务瞬间掐死，也防离谱值 */
    if (ms < 5_000 || ms > 24 * 3_600_000) continue;
    const qi = Math.max(0, m.index - 14);
    const mo = Math.min(raw.length, m.index + m[0].length + 22);
    const chuang = raw.slice(qi, mo);
    const qian = raw.slice(qi, m.index);
    if (PAI_CHU.test(qian)) continue;      // 「等 3 分钟」= 任务步骤，不是时限
    if (!YI_TU.test(chuang)) continue;     // 没有停/限时意图 ⇒ 不当成时限
    out.push({ ms, yuanWen: raw.slice(m.index, Math.min(raw.length, m.index + m[0].length + 12)).trim() });
  }
  if (!out.length) return null;
  out.sort((a, b) => a.ms - b.ms);
  return out[0]!;
}

export interface ShiXianZhuangTai {
  /** 任务开始（epoch ms） */
  kaiShi: number;
  /** 时限长度 */
  ms: number;
  /** 累计「等用户答卡」的毫秒（net 口径才扣；wall 口径不扣，仅留作审计/ETA 参考） */
  dengDaiMs: number;
  /** R167：时限口径。wall=物理墙钟含等卡（默认）；net=只算干活不含等卡（用户明确排除时） */
  kouJing?: 'wall' | 'net';
  /** 是否已经派过收尾轮（只派一次） */
  yiShouWei: boolean;
  /** 命中的原文，收尾说明里如实回显 */
  yuanWen: string;
  /**
   * **到点锁存**：第一次判定到点的时刻（epoch ms）。一旦写入就永不撤销。
   *
   * 端到端实测的振荡缺陷（20 秒时限，真模型）：
   *   20.1s 巡检判到点 → 取消挂着的授权卡；
   *   20.4s 卡返回 → 记 4.8s「等卡时间」→ 净工时 = 20.4 - 4.8 = 15.6s < 20s ⇒ **又变成没到点**；
   *   于是下一张授权卡照弹，5 秒后再取消、再扣时间……净工时永远在 15.6~20.3 之间振荡，
   *   实测循环 5 次白耗 25 秒才收敛。
   *
   * 产品口径：**到点就是到点了**，不能因为之后又等了卡就把时钟拨回去。
   * 「等用户答卡不计入工时」只在**到点之前**生效（用户去倒杯水不该算它超时）。
   */
  daoDianTs?: number;
  /**
   * **收尾已经问过主人一次**（到点后的第一张决策卡）。
   *
   * 端到端第 5 轮实测：到点后模型反复「弹决策卡 → 主人答 → 试被禁工具 → 再弹卡」，
   * 一共 7 张确认卡，把收尾从 24.5s 拖到 114.7s。收尾指令里「必须调 ask_user」
   * 被模型理解成「每一步都要确认」。所以宿主只放行**第一张**，之后一律回「别再问，直接总结」。
   */
  shouWeiWenGuo?: boolean;
}

/**
 * R167：时限口径下的已用时间。
 *  · wall（默认）= 物理墙钟（**含等卡**）——用户的「几分钟」是真实时间；
 *  · net = 墙钟 - 等卡（仅用户明确「不算等卡」时）。
 * 闸门已锁后不再回落（至少等于时限）。
 */
export function jingGongShi(t: ShiXianZhuangTai, now: number): number {
  const qiang = Math.max(0, now - t.kaiShi);
  const raw = t.kouJing === 'net' ? Math.max(0, qiang - Math.max(0, t.dengDaiMs || 0)) : qiang;
  /** 已锁存 ⇒ 不许回落，否则审计里会出现「已到点但已用 < 时限」的自相矛盾 */
  return t.daoDianTs ? Math.max(raw, t.ms) : raw;
}

/**
 * 是否已到点（净工时 ≥ 时限）。**一次性闸门**：第一次到点即锁存，之后恒为真。
 * 注意这里会写入 t.daoDianTs —— 这是刻意的副作用，见该字段注释里的振荡事故。
 */
export function shiXianDaoDian(t: ShiXianZhuangTai | undefined | null, now: number): boolean {
  if (!t) return false;
  if (t.daoDianTs) return true;
  if (jingGongShi(t, now) < t.ms) return false;
  t.daoDianTs = now;
  return true;
}

/** 还剩多少净毫秒（未到点时 > 0） */
export function shiXianShengYu(t: ShiXianZhuangTai, now: number): number {
  return Math.max(0, t.ms - jingGongShi(t, now));
}

/** 毫秒 → 人读（收尾说明用；不引第三方库） */
export function miaoShu(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  const yu = s % 60;
  if (m < 60) return yu ? `${m} 分 ${yu} 秒` : `${m} 分钟`;
  const h = Math.floor(m / 60);
  return `${h} 小时 ${m % 60} 分`;
}
/** R167：用户**明确**排除等卡 ⇒ net；明确包含 ⇒ wall；都没说 ⇒ null（默认 wall）。 */
export function jieXiKouJing(text: string): 'wall' | 'net' | null {
  const s = String(text || '');
  if (/(不算|不含|不扣|扣除|去掉|排除)[^。，；\n]{0,8}(等卡|等待|等人|答卡|点卡|授权卡|选择卡)/.test(s)) return 'net';
  if (/(等卡|等待|等人|答卡|点卡)[^。，；\n]{0,6}(不算|不计|不扣|除外)/.test(s)) return 'net';
  if (/(算上|包含|包括|加上|连同)[^。，；\n]{0,8}(等卡|等待|等人|答卡|点卡)/.test(s)) return 'wall';
  if (/(真实时间|物理时间|墙钟|实际时间|现实时间)/.test(s)) return 'wall';
  return null;
}

/**
 * R167：口径**有疑问** ⇒ 该弹选择卡问用户。
 * 判据：同一小段里**既**出现等待词（等/等待/睡/延迟）**又**出现时限词（停/限时/之内/截止…），
 * 即「等 N 分钟」与「N 分钟内停」混在一起，宿主无法确定用户要哪种口径。
 * 纯等待（只有等待词）或纯时限（只有时限词）都不算疑问。
 */
export function shiXianYouYiWen(text: string): boolean {
  const s = String(text || '');
  const re = /(\d+(?:\.\d+)?|[一二两三四五六七八九十]+|半)\s*(秒钟|秒|分钟|分|个小时|小时|钟头)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const qi = Math.max(0, m.index - 14);
    const mo = Math.min(s.length, m.index + m[0].length + 22);
    const chuang = s.slice(qi, mo);
    const youDeng = /等|等待|睡|休眠|暂停|延迟|延时|sleep|wait|delay/i.test(chuang);
    const youXian = /停|收工|收尾|结束|限时|时限|限制|之内|以内|截止|timeout|deadline|stop|limit|within/i.test(chuang);
    if (youDeng && youXian) return true;
  }
  return false;
}
