/**
 * **行为级的「预计完成时间 + 轮次/时间上限」** —— 让"是不是卡死了"有可执行的判据。
 *
 * 产品需求（第 6 轮原话拆解）：
 *  1. **每一类行为都有自己的两把尺子**：最长等待时间 + 最大轮/次数。
 *     行为至少包含：对话轮、单次工具调用、等待模型回复、等待某个行动完成（子代理/定时任务/命令）、
 *     多步自动续派任务。**首次的这两个数是固定的**（见 `XING_WEI_MOREN`，取值有据可查，不许拍脑袋）。
 *  2. 时间到 / 次数到 ⇒ **请模型判一次**（优先用这个行为正在用的模型；它没反应就按**该牛马的调用链**
 *     换别的模型，**5 个都没反应**就算异常）。
 *  3. **每次判断之前先看临时文件**（`eta-live.json`）：同一轮里这个行为
 *     **已经超时/超次数过**，那个文件就必须存在，并且记着**上次预测的完成时间戳**；
 *     拿当前时间比 —— 超了就把次数 +1；**同一轮连续/累计 3 次超出预测时间 ⇒ 直接判异常，不再问模型**。
 *  4. 没到 3 次 ⇒ 模型判断：判"卡死" ⇒ 异常停下；判"没卡死" ⇒
 *     **重新预测这类行为的完成时间**（优先用持久文件里已经写下的**该类行为的预测方法**；
 *     没有这类方法就让它自己预测，并把**新的方法写进持久文件**），
 *     同时更新临时文件（这是第几次超时/超次数、新的预计完成时间戳）。
 *  5. 持久文件里存的**不是简单一个时间**：按行为类型 + 任务签名聚类的方法库
 *     （样本数、时长中位/90 分位、**偏移系数**、命中率、最近样例），**越用越准**。
 *     它**开工时是空的** —— 第一次全靠模型自己估，真实跑完的轮次才让它长出经验。
 *
 * 两个文件（产品明确要求分开）：
 *   · **持久** `userData/eta.json`    → 预测**方法库**（跨会话、跨轮次复用，越用越准）
 *   · **临时** `userData/eta-live.json` → **本轮**状态（第几次超时、上次/本次预测完成时间戳）
 *     临时文件也要落盘（进程崩了/重启后"同一轮"仍能续上判断），但每轮收尾即清。
 */
import { anQuanYuanZiXieJson, duJsonWenJian } from './atomic-json.js';

// ───────────────────────── 行为类型与固定初始值 ─────────────────────────

export type XingWei = 'duiHua' | 'gongJu' | 'dengDaiHuiFu' | 'dengDaiXingDong' | 'ziDongXuPai';

export interface XingWeiGui {
  /** 人看的名字（审计/日志/需求文档共用一份说法） */
  ming: string;
  /** 首次的**最长等待时间**（毫秒）—— 到了就判一次 */
  miao: number;
  /** 首次的**最大轮/次数** —— 到了就判一次 */
  lun: number;
  /** 取值依据（来源或推理），写在数据里，免得以后有人以为这些数字是拍脑袋来的 */
  ju: string;
}

/**
 * 首次的固定初始值（**每个数字都有出处**，不是拍脑袋；调研记录见 `docs/REQUIREMENTS-ETA.md`）。
 *
 * 校准来源：
 *  · OpenAI Agents SDK `DEFAULT_MAX_TURNS = 10`；CrewAI `max_iter = 20`、`max_retry_limit = 2`；
 *    AutoGen `max_tool_iterations` 默认 1（示例给 10）；LangGraph `recursion_limit` 现行默认已是 1000
 *    （**那不是 agent 预算，是图引擎上限**，网上流传的 25 已过期）。
 *  · OpenAI Python SDK 默认超时 10 分钟；Anthropic SDK `DEFAULT_TIMEOUT = 10 分钟`（连接 5s）、
 *    `DEFAULT_MAX_RETRIES = 2`、退避 0.5s→8s；MCP TS SDK 请求超时 60 000ms；
 *    MCP 规范要求"所有请求都应有超时、且必须有最大超时"。
 *  · Claude Code 是**官方分档**的现成范例：Bash 前台默认 120s / 上限 600s、后台默认 30min / 硬顶 2h、
 *    WebFetch 5min；`askUserQuestionTimeout` 默认 `never`（等用户输入不设超时）。
 *  · 结论：**不同行为必须给不同尺子**（读文件 vs 跑构建 vs 云模型 vs 等人），
 *    并且"官方默认 10 分钟"是**上限而不是目标**。
 */
export const XING_WEI_MOREN: Record<XingWei, XingWeiGui> = {
  duiHua: {
    ming: '对话轮（一次模型回复）',
    miao: 5 * 60 * 1000,
    lun: 12,
    ju: '轮数取 12（Agents SDK 10 与 CrewAI 20 之间，偏保守）：这轮对话最多 12 轮工具 + 一次收敛；'
      + '单轮墙钟 5 分钟越过 Claude Code Bash 默认 120s、不到其 600s 上限',
  },
  gongJu: {
    ming: '单次工具调用',
    miao: 60 * 1000,
    lun: 3,
    ju: '60 秒 = MCP TS SDK 的默认请求超时（本地读写通常几十毫秒，60 秒就是"明显不正常"）；'
      + '次数 3 = 1 次 + 2 次重试（Anthropic SDK DEFAULT_MAX_RETRIES=2）',
  },
  dengDaiHuiFu: {
    ming: '等待模型回复',
    miao: 2 * 60 * 1000,
    lun: 5,
    ju: '120 秒（两家 SDK 的 10 分钟是上限不是目标；本地模型冷加载留出余量）；'
      + '换模型上限 5 —— 5 个都没反应即异常（沿用本项目既有的判卡死链）',
  },
  dengDaiXingDong: {
    ming: '等待某个行动完成（子代理 / 定时任务 / 命令）',
    miao: 30 * 60 * 1000,
    lun: 12,
    ju: '30 分钟 = Claude Code 后台任务默认超时（其硬顶 2h 我们不用：桌面应用宁可早问一次）；'
      + '子代理内部循环沿用工具轮的 12',
  },
  ziDongXuPai: {
    ming: '多步自动续派任务',
    miao: 20 * 60 * 1000,
    lun: 40,
    ju: '本项目既有产品定稿（40 次续派 / 20 分钟）保留：40 次落在 CrewAI 20 与旧 LangGraph 25 的'
      + '"步数预算"带之上，因为是"续派次数"而不是"单轮工具轮"',
  },
};

export function xingWeiGui(x: XingWei): XingWeiGui {
  return XING_WEI_MOREN[x] || XING_WEI_MOREN.duiHua;
}

/** 预警点"加一档"（判"没卡死"就往后放一档，不是翻倍 —— 翻倍会让后面越等越久） */
export const YU_JING_JIA_YI_DANG_MS = 20 * 60 * 1000;
export const YU_JING_JIA_YI_DANG_LUN = 40;

/** 连续超时几次算异常（产品定稿：3） */
export const CHAO_SHI_LIAN_XU_XIAN = 3;
/** 判断最多换几个模型（全都没反应 = 异常） */
export const PAN_MO_XING_SHANG_XIAN = 5;
/** 单次预测的可接受范围：10 秒 ~ 24 小时 */
export const ETA_ZUI_XIAO_MS = 10 * 1000;
export const ETA_ZUI_DA_MS = 24 * 60 * 60 * 1000;

// ───────────────────────── 数据结构 ─────────────────────────

/** 一次预计完成时间 */
export interface EtaYuCe {
  /** 从预测那一刻起预计还要多久 */
  etaMs: number;
  /** 预计完成的**绝对时刻**（epoch ms）—— 重启后仍能判"超没超" */
  jieZhiMs: number;
  /** 预测时这个行为已经跑了多久 */
  yiYongMs: number;
  /** 一句话依据 */
  genJu: string;
  /** 来源：model=模型给的；fangFa=按持久文件里的方法算的；moren=首次固定值 */
  laiYuan: 'model' | 'fangFa' | 'moren';
  moXing?: string;
  ts: number;
  /** 结论：true=在预计时间内完成；null=还没结论 */
  mingZhong?: boolean | null;
  shiJiMs?: number;
}

/** 一类行为的"预测方法"（持久文件里越用越准的那部分） */
export interface EtaFangFa {
  xingWei: XingWei;
  /** 任务签名（同类工作量的聚类键；空 = 按行为类型整体统计） */
  qianMing: string;
  yangBen: number;
  /** 预测时长的滑动平均 */
  yuCeEmaMs: number;
  /** 实际时长的滑动平均 */
  shiJiEmaMs: number;
  /** 校准系数 = 实际/预测 的滑动平均（>1 = 一贯偏乐观） */
  piaoYiXiShu: number;
  p50Ms: number;
  p90Ms: number;
  mingZhongLv: number;
  yangBenWei: number[];
  liZi: Array<{ ts: number; yuCeMs: number; shiJiMs: number; mingZhong: boolean; moXing?: string }>;
  gengXinTs: number;
}

/** 持久文件（方法库） */
export interface EtaKu {
  version: 2;
  shouCiTs: number;
  gengXinTs: number;
  quanJu: { yangBen: number; piaoYiXiShu: number; mingZhongLv: number; yuCeEmaMs: number; shiJiEmaMs: number };
  /** 行为类型 → 签名 → 方法 */
  fangFa: Partial<Record<XingWei, Record<string, EtaFangFa>>>;
}

/** 临时文件里，某个行为在本轮的实时状态 */
export interface EtaXingWeiHuo {
  /** 本轮这个行为**累计**超时/超次数（产品要求：3 次即异常） */
  chaoShiCiShu: number;
  /** **连续**超时次数（中途没超就归零） */
  lianXuChaoShi: number;
  zuiChangLianXu: number;
  /** 最近一次是因为什么触发的 */
  zuiHouZhongLei: '' | 'shiJian' | 'ciShu';
  /** 上次预测的完成时间（判断"超没超"就靠它） */
  shangCiYuCe: EtaYuCe | null;
  /** 本轮的历次预测（给模型"参考自己之前写的"） */
  liCi: EtaYuCe[];
  /** 本轮的预警点（判"没卡死"就加一档） */
  yuJingMiao: number;
  yuJingLun: number;
  /** 已产出的真实样本数 */
  yangBen: number;
  gengXinTs: number;
}

/** 临时文件里，一轮任务的状态 */
export interface EtaHuiHua {
  sessionId: string;
  kaiShi: number;
  xingWei: Partial<Record<XingWei, EtaXingWeiHuo>>;
  gengXinTs: number;
  /** 本轮**从哪一步断的**（续传时如实告诉用户；没断过就没有） */
  zhongDuan?: {
    at: number;
    xingWei?: XingWei;
    jieDuan: string;
    why: string;
    error?: string;
  } | null;
}

export interface EtaLinShiKu {
  version: 1;
  gengXinTs: number;
  huiHua: Record<string, EtaHuiHua>;
}

// ───────────────────────── 工具函数 ─────────────────────────

export function youXian(v: unknown, huiTui = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : huiTui;
}

export function fenWei(yang: number[], p: number): number {
  const a = (yang || []).filter((x) => Number.isFinite(x) && x > 0).slice().sort((x, y) => x - y);
  if (!a.length) return 0;
  const i = Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * p)));
  return Math.round(a[i] as number);
}

/** 毫秒量级的滑动平均（取整） */
export function ema(jiu: number, xin: number, alpha = 0.35): number {
  if (!(jiu > 0)) return Math.max(0, Math.round(xin));
  return Math.round(jiu * (1 - alpha) + xin * alpha);
}

/** 保留小数的滑动平均（小量级比值专用；取整版会把 1.2 压成 1） */
export function emaXiShu(jiu: number, xin: number, alpha = 0.35): number {
  if (!(jiu > 0)) return Number(xin.toFixed(4));
  return Number((jiu * (1 - alpha) + xin * alpha).toFixed(4));
}

/** 把模型的"秒"夹到可用范围（无效值返回 null） */
export function jiaEtaMiao(miao: unknown): number | null {
  const s = youXian(miao, 0);
  if (!(s > 0)) return null;
  return Math.min(ETA_ZUI_DA_MS, Math.max(ETA_ZUI_XIAO_MS, Math.round(s * 1000)));
}

/** 人话时长 */
export function shuoShiChang(ms: number): string {
  const s = Math.max(0, Math.round(youXian(ms, 0) / 1000));
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分 ${s % 60} 秒`;
  const h = Math.floor(m / 60);
  return `${h} 小时 ${m % 60} 分`;
}

/** 任务签名：只用与"工作量"相关的稳定特征（太细就永远聚不到一起，经验长不起来） */
export function renWuQianMing(p: {
  buShu?: number;
  gongJuMing?: string[];
  zhiShuoBuZuo?: boolean;
  moXing?: string;
  gongJu?: string;
}): string {
  const bu = Math.max(0, Math.floor(youXian(p.buShu, 0)));
  const dang = bu === 0 ? '0' : bu <= 3 ? '1-3' : bu <= 8 ? '4-8' : bu <= 20 ? '9-20' : '21+';
  const gj = [...new Set((p.gongJuMing || []).map((x) => String(x || '').trim()).filter(Boolean))].sort().slice(0, 8).join(',') || 'none';
  const mo = moXingZu(p.moXing);
  const dan = String(p.gongJu || '').trim();
  return [dan ? `工具=${dan}` : '', `步数=${dang}`, `工具集=${gj}`, p.zhiShuoBuZuo ? '只说不做' : '', mo ? `模型=${mo}` : '']
    .filter(Boolean).join('|');
}

export function moXingZu(mo?: string): string {
  const s = String(mo || '').trim().toLowerCase();
  if (!s) return '';
  return s.replace(/[-_ ]?(v?\d+(\.\d+)*|20\d{2}[-.]?\d{2}([-.]?\d{2})?)$/i, '').slice(0, 32);
}

/**
 * **解析"是否卡死"的判断回复**（真机反馈：本地模型往往不吐严格 JSON，
 * 于是 5 个模型全被判"没给结论" ⇒ 误判卡死 ⇒ 任务被误停）。
 *
 * 三级容错：
 *   ① 先抠 JSON（容忍 ``` 包裹、前后废话、中文键名 卡住/卡死）；
 *   ② 再按**话**判断（"没卡住"/"没有卡死"/"还在跑" vs "卡住了"/"卡死"）；
 *   ③ 都判不出来 ⇒ 返回 `stalled: null`（= **没给结论**，不等于卡死），
 *      由调用方决定"换下一个模型"，而不是当成"卡住了"。
 */
export function jieXiKaPanDuan(txt: string): { stalled: boolean | null; reason: string; etaSeconds: number | null; etaBasis: string } {
  const s = String(txt || '');
  const quan = (k: string): string | null => {
    const m = s.match(new RegExp('"' + k + '"\\s*:\\s*"([^"]*)"', 'i'));
    return m ? String(m[1]) : null;
  };
  const shu = (k: string): number | null => {
    const m = s.match(new RegExp('"' + k + '"\\s*:\\s*"?([0-9]+(?:\\.[0-9]+)?)"?', 'i'));
    return m ? Number(m[1]) : null;
  };
  // ① JSON：先把 ``` 包裹去掉，再抠第一个完整对象
  const gan = s.replace(/```[a-zA-Z]*/g, '').trim();
  let obj: Record<string, unknown> | null = null;
  const kuai = gan.match(/\{[\s\S]*\}/);
  if (kuai) {
    try { obj = JSON.parse(kuai[0]) as Record<string, unknown>; } catch { obj = null; }
  }
  const zhiBiao = (k: string): boolean | null => {
    const v = obj ? (obj[k] as unknown) : undefined;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') {
      const t0 = v.trim().toLowerCase();
      if (t0 === 'true' || t0 === '是' || t0 === '卡住' || t0 === '卡死') return true;
      if (t0 === 'false' || t0 === '否' || t0 === '没卡住' || t0 === '没卡死') return false;
    }
    const m = gan.match(new RegExp('"' + k + '"\\s*:\\s*(true|false)', 'i'));
    return m ? String(m[1]).toLowerCase() === 'true' : null;
  };
  const stalled0 = zhiBiao('stalled') ?? zhiBiao('stuck') ?? zhiBiao('卡住') ?? zhiBiao('卡死');
  // ② 话：中英文的"卡住/没卡住"
  let stalled: boolean | null = stalled0;
  if (stalled === null) {
    /**
     * **先抠掉否定式，再判肯定式**。
     *
     * 真缺陷（真机审计里 `plan.stall-analysis-badreply` 连续 9 次、`panBuChu: true`）：
     * 原来的肯定式里有 `\bstuck\b` / `\bstalled\b`，它们会命中 "not stuck" / "not stalled"
     * 里的那个词；而否定式同样命中 ⇒ **两条同时成立** ⇒ 按下面的逻辑既不是 true 也不是 false，
     * 直接判成"判不出结论"。判断模型只要用英文回一句 "not stuck"，我们就白烧一次调用。
     * 修法：把否定式整段从待检文本里抠掉后再测肯定式。
     */
    const FOU_DING = /(没\s*(卡住|卡死|停滞|问题)|没有\s*(卡住|卡死|停滞|问题)|未\s*(卡住|卡死|停滞)|不\s*(卡住|卡死)|还在(跑|继续|进展|进行|工作|正常)|仍在(继续|进行|工作)|正常(进行|运行|工作)|有(进展|输出|响应)|not\s+(stuck|stalled|hung|blocked)|no\s+(progress|issue|problem)|still\s+(running|working|progressing)|progressing|running\s+fine|keep\s+going)/i;
    const KEN_DING = /(卡住了|卡死了|已卡死|已经卡死|停滞|无响应|未响应|没有(任何)?(进展|输出|响应)|无(进展|输出|响应)|\bstuck\b|\bstalled\b|\bhung\b|\bunresponsive\b|\bno\s+progress\b)/i;
    const meiKa = FOU_DING.test(gan);
    const sheng = gan.replace(new RegExp(FOU_DING.source, 'gi'), ' ');
    const kaZhu = KEN_DING.test(sheng);
    if (meiKa && !kaZhu) stalled = false;
    else if (kaZhu && !meiKa) stalled = true;
    else stalled = null;
  }
  return {
    stalled,
    reason: (quan('reason') || quan('理由') || (gan.match(/["']reason["']\s*:\s*["']([^"']*)["']/i) || [])[1] || '').slice(0, 200),
    etaSeconds: shu('etaSeconds') ?? shu('eta'),
    etaBasis: (quan('etaBasis') || '').slice(0, 200),
  };
}

/**
 * 判断模型的候选：**只用聊天模型**（真机反馈：把 whisper-tiny 这类 ASR 模型也拿来判卡死，
 * 它只能回 HTTP 500/空答，白白吃掉 5 个名额）。
 * `kind` 由调用方从能力表里取（拿不到就只按名字判）。
 */
export function shiLiaoTianMoXing(id: string, kind?: string): boolean {
  const m = String(id || '');
  if (!m) return false;
  if (/whisper|tts|asr|embed|rerank|clip|image|video|safety|translate|reranker|bge|stt/i.test(m)) return false;
  const k = String(kind || '');
  if (/asr|tts|embedding|rerank|image|video|safety|translate|imageUnd|videoUnd/i.test(k)) return false;
  return true;
}

function kongFangFa(xingWei: XingWei, qianMing: string, now: number): EtaFangFa {
  return {
    xingWei, qianMing, yangBen: 0, yuCeEmaMs: 0, shiJiEmaMs: 0, piaoYiXiShu: 1,
    p50Ms: 0, p90Ms: 0, mingZhongLv: 0, yangBenWei: [], liZi: [], gengXinTs: now,
  };
}

// ───────────────────────── 持久文件：预测方法库 ─────────────────────────

/**
 * **持久**的预测方法库（`userData/eta.json`）。
 * 存的是"这类行为大概要多久 / 模型估得准不准"的**方法**，不是某一轮的某个时刻。
 * 它一开始是空的：没有方法时 `chaFangFa` 返回 null，调用方就请模型自己预测，然后把新方法写进来。
 */
export class EtaZhangBen {
  private ku: EtaKu;
  private jieDian: string | null;
  private xiePai: ReturnType<typeof setTimeout> | null = null;

  constructor(file?: string | null, now = Date.now()) {
    this.jieDian = file ? String(file) : null;
    const du = this.jieDian ? (duJsonWenJian<EtaKu | null>(this.jieDian, null) as EtaKu | null) : null;
    this.ku = (du && du.version === 2 && du.fangFa) ? du : {
      version: 2, shouCiTs: now, gengXinTs: now,
      quanJu: { yangBen: 0, piaoYiXiShu: 1, mingZhongLv: 0, yuCeEmaMs: 0, shiJiEmaMs: 0 },
      fangFa: {},
    };
  }

  kuaiZhao(): EtaKu { return JSON.parse(JSON.stringify(this.ku)) as EtaKu; }
  wenJian(): string { return this.jieDian || ''; }

  /** 查"这类行为/这类任务"的预测方法（没有就 null —— **绝不编一个出来**） */
  chaFangFa(xingWei: XingWei, qianMing?: string): EtaFangFa | null {
    const an = this.ku.fangFa[xingWei] || {};
    const jing = qianMing ? an[String(qianMing)] : null;
    if (jing && jing.yangBen > 0) return jing;
    // 签名没命中时退到"该行为整体"的统计（方法库天生该有兜底层次）
    const zheng = an[''] || null;
    if (zheng && zheng.yangBen > 0) return zheng;
    return null;
  }

  /** 这类行为的样本总数（决定"有没有方法可用"） */
  yangBenShu(xingWei: XingWei): number {
    const an = this.ku.fangFa[xingWei] || {};
    return Object.values(an).reduce((n, x) => n + (x && x.yangBen ? x.yangBen : 0), 0);
  }

  /**
   * **写/更新一个预测方法**（需求里"把新的该类型任务的预测方法写入持久的配置文件"）。
   * 每轮真实结束都会带一个样本进来，方法随之变准。
   */
  jiFangFa(xingWei: XingWei, qianMing: string, yangBen: { yuCeMs: number; shiJiMs: number; mingZhong: boolean; moXing?: string }, now = Date.now()): EtaFangFa {
    const an = this.ku.fangFa[xingWei] || (this.ku.fangFa[xingWei] = {});
    const f = an[qianMing] || kongFangFa(xingWei, qianMing, now);
    const bi = yangBen.yuCeMs > 0 ? yangBen.shiJiMs / yangBen.yuCeMs : 1;
    f.yangBen += 1;
    f.yuCeEmaMs = ema(f.yuCeEmaMs, yangBen.yuCeMs);
    f.shiJiEmaMs = ema(f.shiJiEmaMs, yangBen.shiJiMs);
    f.piaoYiXiShu = emaXiShu(f.piaoYiXiShu, Math.min(20, Math.max(0.05, bi)));
    f.yangBenWei.push(yangBen.shiJiMs);
    if (f.yangBenWei.length > 40) f.yangBenWei.splice(0, f.yangBenWei.length - 40);
    f.p50Ms = fenWei(f.yangBenWei, 0.5);
    f.p90Ms = fenWei(f.yangBenWei, 0.9);
    f.mingZhongLv = Number((f.yangBen > 1 ? f.mingZhongLv * 0.7 + (yangBen.mingZhong ? 0.3 : 0) : (yangBen.mingZhong ? 1 : 0)).toFixed(3));
    f.liZi.push({ ts: now, yuCeMs: yangBen.yuCeMs, shiJiMs: yangBen.shiJiMs, mingZhong: yangBen.mingZhong, moXing: yangBen.moXing });
    if (f.liZi.length > 12) f.liZi.splice(0, f.liZi.length - 12);
    f.gengXinTs = now;
    an[qianMing] = f;

    const q = this.ku.quanJu;
    q.yangBen += 1;
    q.yuCeEmaMs = ema(q.yuCeEmaMs, yangBen.yuCeMs);
    q.shiJiEmaMs = ema(q.shiJiEmaMs, yangBen.shiJiMs);
    q.piaoYiXiShu = emaXiShu(q.piaoYiXiShu, Math.min(20, Math.max(0.05, bi)));
    q.mingZhongLv = Number((q.yangBen > 1 ? q.mingZhongLv * 0.7 + (yangBen.mingZhong ? 0.3 : 0) : (yangBen.mingZhong ? 1 : 0)).toFixed(3));
    this.paiXie(now, true);
    return f;
  }

  /**
   * **按持久文件里的方法预测**（模型没给、或给得不合法时用它；也用于交叉校验）。
   * 返回 null = 连方法都没有 ⇒ 调用方请模型自己预测。
   */
  yuCeByFangFa(xingWei: XingWei, qianMing: string, now = Date.now()): EtaYuCe | null {
    const f = this.chaFangFa(xingWei, qianMing);
    if (!f) return null;
    // 方法 = 该类行为的历史中位数 × 它的偏移系数，再抬到 90 分位（宁可高估，别让长任务反复被判超时）
    const ji = Math.max(f.p50Ms || 0, Math.round((f.shiJiEmaMs || 0) * (f.piaoYiXiShu || 1)));
    const eta = Math.max(ETA_ZUI_XIAO_MS, Math.min(ETA_ZUI_DA_MS, f.p90Ms ? Math.max(ji, Math.round(f.p90Ms * 0.9)) : (ji || 0)));
    if (!(eta > 0)) return null;
    return {
      etaMs: eta, jieZhiMs: now + eta, yiYongMs: 0,
      genJu: `方法库（${f.yangBen} 次真实记录：中位 ${shuoShiChang(f.p50Ms)}／90 分位 ${shuoShiChang(f.p90Ms)}／偏移 ${f.piaoYiXiShu}）`,
      laiYuan: 'fangFa', ts: now, mingZhong: null,
    };
  }

  /** 给模型看的参考文本（方法库那一半；自己写过的历次预测在临时文件那一半） */
  canKaoWenBen(xingWei: XingWei, qianMing: string): string {
    const f = this.chaFangFa(xingWei, qianMing);
    if (!f) return `【这类行为的经验】还没有历史记录（这是第一次），你只能靠自己判断 —— 请给**偏保守**的估计。`;
    return `【这类行为的经验（${f.yangBen} 次真实记录）】实际耗时中位数 ${shuoShiChang(f.p50Ms)}，90 分位 ${shuoShiChang(f.p90Ms)}；`
      + `历史预测命中率 ${Math.round(f.mingZhongLv * 100)}%；模型一向偏${f.piaoYiXiShu >= 1 ? '乐观' : '保守'}（实际/预测 ≈ ${f.piaoYiXiShu.toFixed(2)}）。`;
  }

  baCun(): void {
    if (this.xiePai) { try { clearTimeout(this.xiePai); } catch { /* noop */ } this.xiePai = null; }
    if (!this.jieDian) return;
    try { anQuanYuanZiXieJson(this.jieDian, this.ku); } catch { /* 落盘失败不影响本次运行 */ }
  }

  private paiXie(now: number, liJi = false): void {
    this.ku.gengXinTs = now;
    if (!this.jieDian) return;
    if (liJi) { this.baCun(); return; }
    if (this.xiePai) return;
    this.xiePai = setTimeout(() => { this.xiePai = null; this.baCun(); }, 1200);
    try { (this.xiePai as unknown as { unref?: () => void }).unref?.(); } catch { /* noop */ }
  }
}

// ───────────────────────── 临时文件：本轮状态 ─────────────────────────

/**
 * **临时**的本轮状态（`userData/eta-live.json`）。
 *
 * 产品要求的硬不变量：**同一轮里这个行为"有过超时/超次数"，这个文件就必须存在，
 * 并且记着上次预测的完成时间戳**。所以这里每一次状态变化都**立刻落盘**（不节流、不攒），
 * 读的时候如果发现"应存在却不存在"，要如实当成线索记下来（不能假装没发生过）。
 */
export class EtaLinShi {
  private ku: EtaLinShiKu;
  private jieDian: string | null;

  constructor(file?: string | null, now = Date.now()) {
    this.jieDian = file ? String(file) : null;
    const du = this.jieDian ? (duJsonWenJian<EtaLinShiKu | null>(this.jieDian, null) as EtaLinShiKu | null) : null;
    this.ku = (du && du.version === 1 && du.huiHua) ? du : { version: 1, gengXinTs: now, huiHua: {} };
  }

  kuaiZhao(): EtaLinShiKu { return JSON.parse(JSON.stringify(this.ku)) as EtaLinShiKu; }
  wenJian(): string { return this.jieDian || ''; }

  /** 某个会话某一轮（同会话重复调用不重置，避免递归续派把状态洗掉） */
  huiHua(sessionId: string, now = Date.now()): EtaHuiHua {
    const sid = String(sessionId || '');
    let h = this.ku.huiHua[sid];
    if (!h) {
      h = { sessionId: sid, kaiShi: now, xingWei: {}, gengXinTs: now };
      this.ku.huiHua[sid] = h;
      this.baCun();
    }
    return h;
  }

  /** 某个行为在本轮的状态（第一次访问就按固定初始值立好预警点） */
  xingWei(sessionId: string, x: XingWei, now = Date.now()): EtaXingWeiHuo {
    const h = this.huiHua(sessionId, now);
    let w = h.xingWei[x];
    if (!w) {
      const gui = xingWeiGui(x);
      w = {
        chaoShiCiShu: 0, lianXuChaoShi: 0, zuiChangLianXu: 0, zuiHouZhongLei: '',
        shangCiYuCe: null, liCi: [], yuJingMiao: gui.miao, yuJingLun: gui.lun, yangBen: 0, gengXinTs: now,
      };
      h.xingWei[x] = w;
      this.baCun();
    }
    return w;
  }

  /**
   * **判断这一次是否已经超出"上次预测的完成时间"**，并如实记账。
   *
   * 返回：
   *   · `kuiShi`  —— 没有上次预测（第一次，谈不上超）
   *   · `chaoShi` —— 超了没有
   *   · `ciShu`   —— 本轮累计超了几次
   *   · `yiChang` —— 到 3 次了（**直接判异常，不再问模型**）
   *   · `shiZong` —— "应存在却查不到上次预测"（临时文件丢了；如实报告）
   */
  panChaoShi(sessionId: string, x: XingWei, now = Date.now()): {
    kuiShi: boolean; chaoShi: boolean; ciShu: number; lianXu: number; yiChang: boolean;
    shangCi: EtaYuCe | null; shiZong: boolean;
  } {
    const w = this.xingWei(sessionId, x, now);
    const shangCi = w.shangCiYuCe;
    if (!shangCi) {
      const shiZong = w.chaoShiCiShu > 0;   // 已经超过却查不到上次预测 ⇒ 临时状态丢过
      return { kuiShi: !shiZong, chaoShi: false, ciShu: w.chaoShiCiShu, lianXu: w.lianXuChaoShi, yiChang: w.chaoShiCiShu >= CHAO_SHI_LIAN_XU_XIAN, shangCi: null, shiZong };
    }
    const chaoShi = now > shangCi.jieZhiMs;
    if (chaoShi) {
      w.chaoShiCiShu += 1;
      w.lianXuChaoShi += 1;
      w.zuiChangLianXu = Math.max(w.zuiChangLianXu, w.lianXuChaoShi);
    } else {
      w.lianXuChaoShi = 0;
    }
    w.gengXinTs = now;
    this.baCun();
    return {
      kuiShi: false, chaoShi, ciShu: w.chaoShiCiShu, lianXu: w.lianXuChaoShi,
      yiChang: w.chaoShiCiShu >= CHAO_SHI_LIAN_XU_XIAN, shangCi, shiZong: false,
    };
  }

  /** 记下这次"因为什么"触发（时间到 / 次数到）—— 判异常时要如实告诉用户 */
  jiZhongLei(sessionId: string, x: XingWei, zhongLei: 'shiJian' | 'ciShu', now = Date.now()): void {
    const w = this.xingWei(sessionId, x, now);
    w.zuiHouZhongLei = zhongLei;
    w.gengXinTs = now;
    this.baCun();
  }

  /** 记下**中断发生在哪一步**（续传按钮要能说清"从哪断的"，不是只说"被打断了"） */
  jiZhongDuan(sessionId: string, d: { xingWei?: XingWei; jieDuan: string; why: string; error?: string }, now = Date.now()): void {
    const h = this.huiHua(sessionId, now);
    h.zhongDuan = {
      at: now,
      xingWei: d.xingWei,
      jieDuan: String(d.jieDuan || '').slice(0, 200),
      why: String(d.why || '').slice(0, 200),
      error: d.error ? String(d.error).slice(0, 200) : undefined,
    };
    h.gengXinTs = now;
    this.baCun();
  }

  /** 取"从哪断的"（续传时读；没断过返回 null） */
  quZhongDuan(sessionId: string): EtaHuiHua['zhongDuan'] {
    const h = this.ku.huiHua[String(sessionId || '')];
    return h?.zhongDuan || null;
  }

  /** 续传成功后清掉中断标记（临时账本就该是临时的） */
  qingZhongDuan(sessionId: string, now = Date.now()): void {
    const h = this.ku.huiHua[String(sessionId || '')];
    if (!h || !h.zhongDuan) return;
    h.zhongDuan = null;
    h.gengXinTs = now;
    this.baCun();
  }

  /** 记下新的预计完成时间（含"这是第几次超时"由 `panChaoShi` 负责，这里只管新预测） */
  jiYuCe(sessionId: string, x: XingWei, yu: { etaMs: number; genJu?: string; laiYuan?: EtaYuCe['laiYuan']; moXing?: string }, now = Date.now()): EtaYuCe {
    const w = this.xingWei(sessionId, x, now);
    const h = this.huiHua(sessionId, now);
    const eta = Math.min(ETA_ZUI_DA_MS, Math.max(ETA_ZUI_XIAO_MS, Math.round(youXian(yu.etaMs, xingWeiGui(x).miao))));
    const rec: EtaYuCe = {
      etaMs: eta, jieZhiMs: now + eta, yiYongMs: Math.max(0, now - h.kaiShi),
      genJu: String(yu.genJu || '').slice(0, 300), laiYuan: yu.laiYuan || 'model',
      moXing: yu.moXing ? String(yu.moXing).slice(0, 80) : undefined, ts: now, mingZhong: null,
    };
    w.shangCiYuCe = rec;
    w.liCi.push(rec);
    if (w.liCi.length > 60) w.liCi.splice(0, w.liCi.length - 60);
    w.gengXinTs = now;
    this.baCun();
    return rec;
  }

  /** 判"没卡死" ⇒ 预警点加一档（时间 +20 分钟 / 次数 +40，与既有产品行为一致） */
  jiaYiDang(sessionId: string, x: XingWei, now = Date.now()): { yuJingMiao: number; yuJingLun: number } {
    const w = this.xingWei(sessionId, x, now);
    w.yuJingMiao += YU_JING_JIA_YI_DANG_MS;
    w.yuJingLun += YU_JING_JIA_YI_DANG_LUN;
    w.gengXinTs = now;
    this.baCun();
    return { yuJingMiao: w.yuJingMiao, yuJingLun: w.yuJingLun };
  }

  /**
   * 这一轮**真的收尾**了 ⇒ 把"最后一次预测 vs 实际"作为样本交给方法库，
   * 然后清掉本轮的临时状态（临时文件就该是临时的）。
   * 返回 null = 这轮压根没有预测（没进过判断流程），不用学。
   */
  xueXi(sessionId: string, x: XingWei, qianMing: string, zhangBen: EtaZhangBen, now = Date.now()): { xueLe: boolean; shiJiMs: number; mingZhong: boolean | null; qianMing: string } {
    const h = this.ku.huiHua[String(sessionId || '')];
    const w = h && h.xingWei[x];
    if (!h || !w || !w.shangCiYuCe) return { xueLe: false, shiJiMs: 0, mingZhong: null, qianMing: '' };
    const shiJi = Math.max(1000, Math.round(now - h.kaiShi));
    const yu = w.shangCiYuCe;
    const mingZhong = shiJi <= yu.etaMs;
    const la = w.liCi[w.liCi.length - 1];
    if (la && la.ts === yu.ts) { la.mingZhong = mingZhong; la.shiJiMs = shiJi; }
    w.yangBen += 1;
    zhangBen.jiFangFa(x, qianMing, { yuCeMs: yu.etaMs, shiJiMs: shiJi, mingZhong, moXing: yu.moXing }, now);
    this.baCun();
    return { xueLe: true, shiJiMs: shiJi, mingZhong, qianMing };
  }

  /** 一轮收尾：清掉本轮状态（经验已经进持久文件了） */
  jieShuLun(sessionId: string): void {
    const sid = String(sessionId || '');
    if (this.ku.huiHua[sid]) {
      delete this.ku.huiHua[sid];
      this.baCun();
    }
  }

  /** 给模型看的"你自己之前写过什么" */
  canKaoWenBen(sessionId: string, x: XingWei, now = Date.now()): string {
    const h = this.ku.huiHua[String(sessionId || '')];
    const w = h && h.xingWei[x];
    if (!w || !w.liCi.length) return '';
    const hang: string[] = [`【你本轮已经为「${xingWeiGui(x).ming}」写过 ${w.liCi.length} 次预计完成时间（最近 6 条）】`];
    for (const y of w.liCi.slice(-6)) {
      const zhuang = y.mingZhong === true ? '结果：在预计时间内完成'
        : y.mingZhong === false ? '结果：超了'
          : (now > y.jieZhiMs ? `结果：**已经超出** ${shuoShiChang(now - y.jieZhiMs)}（还没完成）` : `结果：还没到点（还剩 ${shuoShiChang(y.jieZhiMs - now)}）`);
      hang.push(`· 已跑 ${shuoShiChang(y.yiYongMs)} 时说"还需 ${shuoShiChang(y.etaMs)}"${y.genJu ? `（依据：${y.genJu}）` : ''} → ${zhuang}`);
    }
    if (w.chaoShiCiShu > 0) {
      hang.push(`⚠️ 本轮已经**累计 ${w.chaoShiCiShu} 次**超出你自己写的预计完成时间（累计 ${CHAO_SHI_LIAN_XU_XIAN} 次即按异常处理，不再问你）。`);
    }
    return hang.join('\n');
  }

  baCun(): void {
    if (!this.jieDian) return;
    try {
      this.ku.gengXinTs = Date.now();
      anQuanYuanZiXieJson(this.jieDian, this.ku);
    } catch { /* 落盘失败不影响本次运行 */ }
  }
}
