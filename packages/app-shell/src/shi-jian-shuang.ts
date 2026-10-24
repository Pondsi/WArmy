/**
 * 知识库的**双时间**（第 53 轮项 5 用户口径）。
 *
 * 一条知识带两个时间，永远不许混：
 *  · **记录时间 `jiluTs`** —— 这条信息**什么时候进入记忆**：取原文那条消息的落地时刻（谁说的、什么时候说的），
 *    由锚点回指 `fast-memory.jsonl` 的那一行，**写一次就不再改**（重新索引/补写都不能覆盖它）。
 *  · **发生时间 `fashengTs`** —— 事情**本身发生在什么时候**：只有原文真的写了才填（并保留原话 `fashengBiao`）。
 *
 * 用户给的场景（必须支持）：*昨天*告诉牛马"我在**上个月5号**已经决定戒烟"，
 * 今天问戒烟的事 ⇒ 牛马要说"你是昨天告诉我的，说的是上个月5号做的决定"，两者不得互相冒充。
 *
 * 关键约束：**相对日期（"昨天/上个月5号"）必须以说话时刻为参照系解析，绝不能用当前时间** ——
 * 否则归档越晚，解析出来的日子就越错（业界同类实现的通病）。解析不出来的（"最近/以前"）就**留空**，不猜。
 *
 * 纯函数 ⇒ 门禁直接跑真值表（scripts/verify-r53-shijian.mjs）。
 */

export type JingDu = 'ri' | 'yue' | 'nian' | 'wu';

export interface ShiJianJieXi {
  /** 发生时间（规范化后的毫秒时间戳；精度只到月/年时取该区间起点） */
  faShengTs?: number;
  /** 原文里那句时间表述（如"上个月5号"），一字不改地留着，供回复时引用 */
  faShengBiao?: string;
  /** 发生时间的精度 */
  jingDu: JingDu;
  /** 第几个命中（多条时间时取最"近"的那条，见 pick 逻辑） */
  leiXing?: 'juedui' | 'xiangdui' | 'dui';
}

const ZAI = (d: number | Date) => { const x = d instanceof Date ? d : new Date(d); return new Date(x.getFullYear(), x.getMonth(), x.getDate(), 0, 0, 0, 0).getTime(); };
const TIAN = 86400000;

/** 取本地日历分量（不用 UTC，避免跨时区把"昨天"算错一天） */
function fenJie(ts: number): { nian: number; yue: number; ri: number } {
  const d = new Date(ts);
  return { nian: d.getFullYear(), yue: d.getMonth() + 1, ri: d.getDate() };
}

/** 某年某月有几天（相对表达落到具体日子时要用） */
function tianShu(nian: number, yue: number): number {
  return new Date(nian, yue, 0).getDate();
}

/** 月/年平移（月底溢出时钳到该月最后一天，如 1/31 往前一个月 = 12/31） */
function yuePingYi(nian: number, yue: number, delta: number): { nian: number; yue: number } {
  const z = (nian * 12 + (yue - 1) + delta);
  return { nian: Math.floor(z / 12), yue: (z % 12 + 12) % 12 + 1 };
}

/** 中文数字（"三天前"、"五号"这种写法要能吃下） */
const SHU_ZI: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 半: 0.5 };
function shuZhi(s: string): number {
  const t = String(s || '').trim();
  if (/^\d+$/.test(t)) return Number(t);
  if (SHU_ZI[t] !== undefined) return SHU_ZI[t] as number;
  if (t.startsWith('十') && t.length === 2) return 10 + (SHU_ZI[t[1] as string] || 0);
  if (t.endsWith('十') && t.length === 2) return 10 * (SHU_ZI[t[0] as string] || 1);
  return NaN;
}

/**
 * 解析一段原文里的**发生时间**。
 * @param yuanWen  原文（一条消息或一段摘要）
 * @param shuoHuaTs **说话时刻**（= 记录时间）—— 所有相对表达以它为锚，绝不用当前时间
 */
export function jieXiFaShengShiJian(yuanWen: string, shuoHuaTs: number): ShiJianJieXi {
  const wen = String(yuanWen || '');
  const base = Number(shuoHuaTs) || Date.now();
  const b = fenJie(base);
  const houXuan: ShiJianJieXi[] = [];

  // ① 绝对：2026年10月5日 / 2026-10-05 / 2026/10/5 / 10月5日（无年份 ⇒ 取不晚于说话时刻的最近一次）
  for (const m of wen.matchAll(/(?:(\d{4})\s*[年\-/\.]\s*)?(\d{1,2})\s*[月\-/\.]\s*(\d{1,2})\s*[日号]?/g)) {
    const nian = m[1] ? Number(m[1]) : b.nian;
    const yue = Number(m[2]);
    const ri = Number(m[3]);
    if (!(yue >= 1 && yue <= 12 && ri >= 1 && ri <= 31)) continue;
    let n = nian;
    if (!m[1]) {
      // 只说"10月5号"：往前找最近的一次（不许跑到未来）
      if (new Date(n, yue - 1, ri).getTime() > base) n = n - 1;
    }
    houXuan.push({ faShengTs: new Date(n, yue - 1, Math.min(ri, tianShu(n, yue))).getTime(), faShengBiao: m[0].trim(), jingDu: 'ri', leiXing: 'juedui' });
  }
  for (const m of wen.matchAll(/(\d{4})\s*年\s*(\d{1,2})\s*月(?!\s*\d)/g)) {
    const n = Number(m[1]), y = Number(m[2]);
    if (y >= 1 && y <= 12) houXuan.push({ faShengTs: new Date(n, y - 1, 1).getTime(), faShengBiao: m[0].trim(), jingDu: 'yue', leiXing: 'juedui' });
  }
  for (const m of wen.matchAll(/(?<!\d)(\d{4})\s*年(?!龄|度|度|级)/g)) {
    const n = Number(m[1]);
    if (n >= 1900 && n <= 2200) houXuan.push({ faShengTs: new Date(n, 0, 1).getTime(), faShengBiao: m[0].trim(), jingDu: 'nian', leiXing: 'juedui' });
  }

  /** ② 相对：一律以**说话时刻**为锚 */
  const xiangDui: Array<[RegExp, (g: RegExpMatchArray) => ShiJianJieXi | null]> = [
    [/(今天|今日)/g, (g) => ({ faShengTs: ZAI(base), faShengBiao: g[1], jingDu: 'ri', leiXing: 'xiangdui' })],
    [/(昨天|昨日)/g, () => ({ faShengTs: ZAI(base) - TIAN, faShengBiao: '昨天', jingDu: 'ri', leiXing: 'xiangdui' })],
    [/(前天)/g, () => ({ faShengTs: ZAI(base) - 2 * TIAN, faShengBiao: '前天', jingDu: 'ri', leiXing: 'xiangdui' })],
    [/(\d+|[一二两三四五六七八九十]+)\s*天\s*(前|后|以内|之前|以后)/g, (g) => {
      const n = shuZhi(String(g[1] ?? ''));
      if (!(n > 0)) return null;
      return { faShengTs: ZAI(base) - (String(g[2] ?? '').startsWith('后') || g[2] === '以后' ? -n : n) * TIAN, faShengBiao: String(g[0] ?? '').trim(), jingDu: 'ri', leiXing: 'xiangdui' };
    }],
    [/(\d+|[一二两三四五六七八九十]+)\s*个?月\s*(前|后|以前|以后)/g, (g) => {
      const n = shuZhi(String(g[1] ?? ''));
      if (!(n > 0)) return null;
      const fu = g[2] === '前' || g[2] === '以前' ? -n : n;
      /** "上个月5号"：月的偏移已知，日子在下面单独抓一次（同一句里带日子时优先落到具体日） */
      const ri = /(\d{1,2})\s*[日号]/.exec(g[0]);
      const m = yuePingYi(b.nian, b.yue, fu);
      if (ri) {
        const r = Number(ri[1]);
        if (r >= 1 && r <= 31) return { faShengTs: new Date(m.nian, m.yue - 1, Math.min(r, tianShu(m.nian, m.yue))).getTime(), faShengBiao: String(g[0] ?? '').trim(), jingDu: 'ri', leiXing: 'dui' };
      }
      return { faShengTs: new Date(m.nian, m.yue - 1, 1).getTime(), faShengBiao: String(g[0] ?? '').trim(), jingDu: 'yue', leiXing: 'dui' };
    }],
    [/(\d+|[一二两三四五六七八九十]+)\s*周\s*(前|后|以前)/g, (g) => {
      const n = shuZhi(String(g[1] ?? ''));
      if (!(n > 0)) return null;
      return { faShengTs: ZAI(base) - (g[2] === '后' ? -n : n) * 7 * TIAN, faShengBiao: String(g[0] ?? '').trim(), jingDu: 'ri', leiXing: 'xiangdui' };
    }],
    [/(\d+|[一二两三四五六七八九十]+)\s*年\s*(前|后|以前)/g, (g) => {
      const n = shuZhi(String(g[1] ?? ''));
      if (!(n > 0)) return null;
      return { faShengTs: ZAI(new Date(b.nian - (g[2] === '后' ? -n : n), b.yue - 1, b.ri)), faShengBiao: String(g[0] ?? '').trim(), jingDu: 'nian', leiXing: 'xiangdui' };
    }],
    [/上个?\s*月?\s*(\d{1,2})\s*[日号]/g, (g) => {
      /** "上个月5号"（用户点名的那个例子）：偏移 -1 个月 + 具体日 ⇒ 精度到日，不许退化成"九月初" */
      const r = Number(g[1]);
      if (!(r >= 1 && r <= 31)) return null;
      const m = yuePingYi(b.nian, b.yue, -1);
      return { faShengTs: new Date(m.nian, m.yue - 1, Math.min(r, tianShu(m.nian, m.yue))).getTime(), faShengBiao: `上个月${g[1]}号`, jingDu: 'ri', leiXing: 'dui' };
    }],
    [/(?:这个?月|本月|当月)\s*(\d{1,2})\s*[日号]/g, (g) => {
      const r = Number(g[1]);
      if (!(r >= 1 && r <= 31)) return null;
      return { faShengTs: new Date(b.nian, b.yue - 1, Math.min(r, tianShu(b.nian, b.yue))).getTime(), faShengBiao: g && g[0] ? String(g[0]).trim() : '本月', jingDu: 'ri', leiXing: 'dui' };
    }],
    [/下个?\s*月\s*(\d{1,2})\s*[日号]/g, (g) => {
      const r = Number(g[1]);
      if (!(r >= 1 && r <= 31)) return null;
      const m = yuePingYi(b.nian, b.yue, 1);
      return { faShengTs: new Date(m.nian, m.yue - 1, Math.min(r, tianShu(m.nian, m.yue))).getTime(), faShengBiao: `下个月${g[1]}号`, jingDu: 'ri', leiXing: 'dui' };
    }],
    [/(上周|上个星期|上星期)/g, () => ({ faShengTs: ZAI(base) - 7 * TIAN, faShengBiao: '上周', jingDu: 'ri', leiXing: 'xiangdui' })],
    [/(上个月|上月)/g, () => {
      const m = yuePingYi(b.nian, b.yue, -1);
      return { faShengTs: new Date(m.nian, m.yue - 1, 1).getTime(), faShengBiao: '上个月', jingDu: 'yue', leiXing: 'xiangdui' };
    }],
    [/(去年)/g, () => ({ faShengTs: new Date(b.nian - 1, 0, 1).getTime(), faShengBiao: '去年', jingDu: 'nian', leiXing: 'xiangdui' })],
    [/(今年|本年)/g, () => ({ faShengTs: new Date(b.nian, 0, 1).getTime(), faShengBiao: '今年', jingDu: 'nian', leiXing: 'xiangdui' })],
    [/(本月|这个月|当月)/g, () => ({ faShengTs: new Date(b.nian, b.yue - 1, 1).getTime(), faShengBiao: '本月', jingDu: 'yue', leiXing: 'xiangdui' })],
    [/(\d{1,2})\s*月\s*(份)?\s*(底|末)/g, (g) => {
      const y = Number(g[1]);
      if (!(y >= 1 && y <= 12)) return null;
      return { faShengTs: new Date(b.nian, y - 1, tianShu(b.nian, y)).getTime(), faShengBiao: String(g[0] ?? '').trim(), jingDu: 'ri', leiXing: 'dui' };
    }],
  ];
  for (const [re, han] of xiangDui) {
    for (const m of wen.matchAll(re)) {
      const r = han(m as RegExpMatchArray);
      if (r) houXuan.push(r);
    }
  }

  if (!houXuan.length) return { jingDu: 'wu' };
  /**
   * 一句里出现多个时间时，取**离说话时刻最近**的那条为"发生时间"，
   * 其余留在 `faShengBiao` 拼接里（回复时仍能看到原话）。这比"取第一个"稳：
   * 真话常是"我上个月5号决定，昨天又想改" —— 事件锚在更近的那次。
   */
  houXuan.sort((x, y) => Math.abs((x.faShengTs || 0) - base) - Math.abs((y.faShengTs || 0) - base));
  const zui = houXuan[0]!;
  const biao = [...new Set(houXuan.map((h) => h.faShengBiao).filter(Boolean) as string[])].join('、');
  return { faShengTs: zui.faShengTs, faShengBiao: biao, jingDu: zui.jingDu, leiXing: zui.leiXing };
}

/**
 * 把查询里的时间词换成一个**窗口**（同样以"现在"为锚 —— 问话就是当下说的）。
 * 认不出时间词就返回 null（调用方据此决定"按时间过滤"还是"不过滤"）。
 */
export function jieXiChaXunChuang(wen: string, xianZai = Date.now()): { qi: number; zhi: number; biao: string } | null {
  const s = String(wen || '');
  const now = Number(xianZai) || Date.now();
  const b = fenJie(now);
  const tian = (n: number) => ({ qi: ZAI(now) - n * TIAN, zhi: ZAI(now) + TIAN - 1, biao: `${n}天` });
  if (/(刚刚|刚才|方才)/.test(s)) return { qi: now - 3600000, zhi: now, biao: '刚刚' };
  if (/(今天|今日)/.test(s)) return { qi: ZAI(now), zhi: ZAI(now) + TIAN - 1, biao: '今天' };
  if (/(昨天|昨日)/.test(s)) return { qi: ZAI(now) - TIAN, zhi: ZAI(now) - 1, biao: '昨天' };
  if (/前天/.test(s)) return { qi: ZAI(now) - 2 * TIAN, zhi: ZAI(now) - TIAN - 1, biao: '前天' };
  const mTian = /(\d+|[一二两三四五六七八九十]+)\s*天\s*(前|内|以内|以前)/.exec(s);
  if (mTian) { const n = shuZhi(String(mTian[1] ?? '')); if (n > 0) return tian(n - 1); }
  const mZhou = /(\d+|[一二两三四五六七八九十]+)?\s*(上?周|个星期|星期)/.exec(s);
  if (/(上[周]|上星期|上个星期)/.test(s)) {
    const qi = ZAI(now) - 7 * TIAN, zhi = ZAI(now) - 1;
    return { qi, zhi, biao: '上周' };
  }
  if (mZhou) return { qi: ZAI(now) - 7 * TIAN, zhi: ZAI(now) + TIAN - 1, biao: '近一周' };
  if (/(上个月|上月)/.test(s)) { const m = yuePingYi(b.nian, b.yue, -1); return { qi: new Date(m.nian, m.yue - 1, 1).getTime(), zhi: new Date(m.nian, m.yue, 0, 23, 59, 59).getTime(), biao: '上个月' }; }
  if (/(本月|这个月|当月)/.test(s)) return { qi: new Date(b.nian, b.yue - 1, 1).getTime(), zhi: ZAI(now) + TIAN - 1, biao: '本月' };
  if (/(去年)/.test(s)) return { qi: new Date(b.nian - 1, 0, 1).getTime(), zhi: new Date(b.nian - 1, 11, 31, 23, 59, 59).getTime(), biao: '去年' };
  if (/(今年|本年)/.test(s)) return { qi: new Date(b.nian, 0, 1).getTime(), zhi: ZAI(now) + TIAN - 1, biao: '今年' };
  const mYue = /(?:(\d{4})\s*[年\-/])?(\d{1,2})\s*月/.exec(s);
  if (mYue) {
    const n = mYue[1] ? Number(mYue[1]) : b.nian;
    const y = Number(mYue[2]);
    if (y >= 1 && y <= 12) return { qi: new Date(n, y - 1, 1).getTime(), zhi: new Date(n, y, 0, 23, 59, 59).getTime(), biao: `${n}年${y}月` };
  }
  const mRi = /(\d{4})[\-\/\.](\d{1,2})[\-\/\.](\d{1,2})/.exec(s);
  if (mRi) {
    const n = Number(mRi[1]), y = Number(mRi[2]), r = Number(mRi[3]);
    if (y >= 1 && y <= 12 && r >= 1 && r <= 31) return { qi: new Date(n, y - 1, r).getTime(), zhi: new Date(n, y - 1, r, 23, 59, 59).getTime(), biao: mRi[0] };
  }
  return null;
}

/** 两个轴都过一遍：命中在哪一个轴上，要如实告诉模型（这是用户点名要区分的那件事） */
export function mingZhongZhou<T extends { jiluTs?: number; fashengTs?: number }>(
  xiang: T[], chuang: { qi: number; zhi: number } | null,
): Array<{ xiang: T; zhou: 'jilu' | 'fasheng' | 'liang' } | null> {
  if (!chuang) return xiang.map((x) => ({ xiang: x, zhou: 'liang' as const }));
  return xiang.map((x) => {
    const jl = typeof x.jiluTs === 'number' && x.jiluTs >= chuang.qi && x.jiluTs <= chuang.zhi;
    const fs = typeof x.fashengTs === 'number' && x.fashengTs >= chuang.qi && x.fashengTs <= chuang.zhi;
    if (jl && fs) return { xiang: x, zhou: 'liang' as const };
    if (jl) return { xiang: x, zhou: 'jilu' as const };
    if (fs) return { xiang: x, zhou: 'fasheng' as const };
    return null;
  }).filter(Boolean) as Array<{ xiang: T; zhou: 'jilu' | 'fasheng' | 'liang' }>;
}

const BU = (n: number) => (n < 10 ? '0' + n : String(n));
/** 给人看也够短的时间戳（本地时区；分钟够用，不写秒） */
export function geShiHuaShiJian(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${BU(d.getMonth() + 1)}-${BU(d.getDate())} ${BU(d.getHours())}:${BU(d.getMinutes())}`;
}

/** 注入/回读时给模型看的两个时间（顺序固定：记录时间在前，发生时间在后） */
export function liangShiJianMing(jiluTs?: number, fashengTs?: number, fashengBiao?: string): string {
  const bu = (ts?: number) => {
    /** 发生时间缺失时必须明写"原文没说"，并挡住模型拿记录时间顶替（用户点名的混轴错误） */
    if (!ts) return '（未记录：原文没说事情发生在什么时候，**不许拿记录时间顶替**）';
    const d = new Date(ts);
    return `${d.getFullYear()}-${BU(d.getMonth() + 1)}-${BU(d.getDate())}`;
  };
  const quan = (ts?: number) => {
    if (!ts) return '（未记录）';
    const d = new Date(ts);
    return `${d.getFullYear()}-${BU(d.getMonth() + 1)}-${BU(d.getDate())} ${BU(d.getHours())}:${BU(d.getMinutes())}`;
  };
  return `记录时间 ${quan(jiluTs)}｜发生时间 ${bu(fashengTs)}${fashengBiao ? `（原话「${fashengBiao}」）` : ''}`;
}

/** 发生时间明显早于/晚于记录时间时的自检（写库时用，防把"解析失败"当成"发生在未来"） */
export function shiJianYiChang(jiluTs: number, fashengTs?: number): string {
  if (!fashengTs) return '';
  if (fashengTs > jiluTs + 366 * TIAN) return '发生时间晚于记录时间一年以上';
  if (jiluTs - fashengTs > 3660 * TIAN) return '发生时间早于记录时间十年以上';
  return '';
}
