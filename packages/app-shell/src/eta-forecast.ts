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
    miao: 120 * 1000,
    lun: 12,
    ju: '时间 120 秒 = Claude Code 前台 Bash 默认超时（原 60s 会把下载/构建/长命令误判成异常）；'
      + '次数 12 = 一个多步任务里同名工具被正常调用很多次，"少数几次"绝不代表打转。'
      + '真正的卡死由"无任何真实产出"判定（见 electron-main 的 jinZhanJinQi），'
      + '不靠"调用了几次"这一个数字',
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

/** 预估几次都不准算异常（用户裁决：3 次即判异常；原「9 次」限制废止，不再有跨轮/累计 9 次的门槛） */
export const CHAO_SHI_LIAN_XU_XIAN = 3;
/** 判断最多换几个模型（全都没反应 = 异常） */
export const PAN_MO_XING_SHANG_XIAN = 5;
/** 持久文件里保留最近 N 次真实样本（产品要求：9 次，供下次预测参考校准） */
export const YANG_BEN_BAO_LIU = 9;
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
  /** 条件桶键（情况/任务/工具/环境/步数档；空 = 按行为类型整体统计） */
  qianMing: string;
  yangBen: number;
  /** 预测时长的滑动平均 */
  yuCeEmaMs: number;
  /** 实际时长的滑动平均 */
  shiJiEmaMs: number;
  /** 校准系数 = 实际/预测 的滑动平均（>1 = 一贯偏乐观） */
  piaoYiXiShu: number;
  /** Holt 双指数平滑：水平 + 趋势（能跟上"越跑越快/慢"） */
  holtShuiPing: number;
  holtQuShi: number;
  p50Ms: number;
  p90Ms: number;
  mingZhongLv: number;
  /** 最近 9 次真实样本（产品要求：留 9 次供下次预测校准） */
  yangBenWei: number[];
  /**
   * **分位数水库**（最多 200 个）：p50/p90/MAD 从这里算。
   * 只留 9 个时 p90≈最大值（噪声永不衰减）；留 200 个时经验分位数由 Glivenko–Cantelli
   * 定理**一致收敛**到真实分位数 ⇒ 截止时刻估计本身也"越来越准"。
   */
  fenWeiYang: number[];
  liZi: Array<{ ts: number; yuCeMs: number; shiJiMs: number; mingZhong: boolean; moXing?: string }>;
  gengXinTs: number;
  /**
   * **累积均值统计**（数学上可证收敛的那部分；见 docs/ETA-CONVERGENCE.md）：
   *  · `leiJiHe/leiJiN` = 实际耗时的累积和/次数 ⇒ 样本均值 = leiJiHe/leiJiN，
   *    以 1/n 步长更新，由强大数定律（SLLN）**几乎必然收敛**到该条件桶的真实均值；
   *  · 常数 α 的 EMA **不会**收敛到真值（稳态方差 α/(2-α)·σ²），只用来追短期漂移。
   */
  leiJiHe: number;
  leiJiN: number;
  /** Σ log(实际/预测)：偏移修正因子 = exp(duiShuHe/leiJiN)（Robbins–Monro 一致估计） */
  duiShuHe: number;
  /** 预测绝对对数误差 |log(实际/预测)| 的 EMA —— 文件"越用越准"的可视证据 */
  wuChaEma: number;
  /** 区间校准账：预测区间测了几次、盖住几次（P90 真覆盖 90% 的依据） */
  fuGaiCe: number;
  fuGaiZhong: number;
  /**
   * **区间乘子**（Adaptive Conformal Inference 思路，Gibbs & Candès 2021）：
   * 没盖住就放大、盖住就缓慢回收，长期覆盖率收敛到目标 90%。
   * 步长 γ_n = c/√n 递减 ⇒ 随机逼近收敛（见 docs/ETA-CONVERGENCE.md 定理 5）。
   */
  quJianXiShu: number;
  /** 本桶的条件（''桶为 null） */
  tiaoJian?: TiaoJian | null;
}

/** 持久文件（方法库） */
export interface EtaKu {
  /** 2=旧版（无累积统计）；3=条件分桶+收缩估计版（当前） */
  version: number;
  shouCiTs: number;
  gengXinTs: number;
  quanJu: { yangBen: number; piaoYiXiShu: number; mingZhongLv: number; yuCeEmaMs: number; shiJiEmaMs: number };
  /** 行为类型 → 条件桶键 → 方法 */
  fangFa: Partial<Record<XingWei, Record<string, EtaFangFa>>>;
  /** 自学习进度账：按时间记录整体误差水平（证明"越来越准"的可查轨迹） */
  jingDuGuiJi: Array<{ ts: number; yangBen: number; wuChaEma: number; piaoYiXiShu: number; mingZhongLv: number }>;
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

/**
 * Holt 双指数平滑（线性趋势）—— 比单 EMA 更能跟上"任务越跑越快/越跑越慢"的趋势。
 * 返回平滑后的水平值（预测下一步）。样本不足 2 时退化为单 EMA。
 */
export function holtYuCe(shuiPing: number, quShi: number, xin: number, alpha = 0.4, beta = 0.2): { shuiPing: number; quShi: number } {
  if (!(shuiPing > 0)) return { shuiPing: Math.max(0, Math.round(xin)), quShi: 0 };
  const p = alpha * xin + (1 - alpha) * (shuiPing + quShi);
  const q = beta * (p - shuiPing) + (1 - beta) * quShi;
  return { shuiPing: Math.round(p), quShi: Math.round(q) };
}

/**
 * MAD（Median Absolute Deviation）—— 鲁棒离散度，不受极端值影响。
 * 预测区间 = 预测值 ± k × MAD（k≈1.4826 对应正态 σ）。
 */
export function mad(yang: number[]): number {
  const a = (yang || []).filter((x) => Number.isFinite(x) && x > 0).slice().sort((x, y) => x - y);
  if (a.length < 2) return 0;
  const med = a[Math.floor(a.length / 2)] as number;
  const dev = a.map((x) => Math.abs(x - med)).sort((x, y) => x - y);
  return dev[Math.floor(dev.length / 2)] as number;
}

/**
 * 加权分位数：近期样本权重更高（指数衰减），比简单分位数更跟手。
 * w[i] = 0.85^(n-1-i)，越新权重越大。
 */
export function jiaQuanFenWei(yang: number[], p: number): number {
  const a = (yang || []).filter((x) => Number.isFinite(x) && x > 0);
  if (!a.length) return 0;
  const n = a.length;
  const pairs = a.map((v, i) => ({ v, w: Math.pow(0.85, n - 1 - i) })).sort((x, y) => x.v - y.v);
  const zong = pairs.reduce((s, x) => s + x.w, 0);
  let lei = 0;
  for (const { v, w } of pairs) {
    lei += w;
    if (lei / zong >= p) return Math.round(v);
  }
  return Math.round((pairs[pairs.length - 1] || { v: 0 }).v);
}

/**
 * 自适应 alpha：预测误差大 → 多信新样本（alpha↑）；误差小 → 多信历史（alpha↓）。
 * 基于最近 3 次预测误差的 EMA 动态调整。
 */
export function ziShiYingAlpha(wuChaEma: number): number {
  // 误差比（实际/预测）偏离 1 越远，alpha 越大（更敏感）
  const pianLi = Math.abs(Math.log(Math.max(0.1, wuChaEma)));
  return Math.min(0.7, Math.max(0.15, 0.35 + pianLi * 0.3));
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
  /** 情况：首发 / 自动续派 / 中断恢复（缺省按首发） */
  qingKuang?: string;
  /** 环境：本地模型 / 云模型（缺省由模型名推断） */
  huanJing?: string;
}): string {
  const t = fenTiaoJian(p);
  return tiaoJianJian(t);
}

export function moXingZu(mo?: string): string {
  const s = String(mo || '').trim().toLowerCase();
  if (!s) return '';
  return s.replace(/[-_ ]?(v?\d+(\.\d+)*|20\d{2}[-.]?\d{2}([-.]?\d{2})?)$/i, '').slice(0, 32);
}

// ───────────────────────── 条件分桶：情况 / 任务 / 工具 / 环境 ─────────────────────────
/**
 * **预测账不是一概而论的**（产品要求）：同类行为在不同**情况、任务、工具、环境**下
 * 耗时分布不同（本地 7B 写代码 ≠ 云端写文档 ≠ 构建测试），必须分开记、分开估。
 *
 * 四个维度 + 步数档，构成一个条件桶；样本不足时沿 `huiTuiLian` **逐级回退**
 * （n-gram 平滑里的 backoff 思想：细桶向粗桶收缩，粗桶永远有数据兜底）。
 */

/** 情况：这次行为发生在什么情境下 */
export type QingKuang = 'shouCi' | 'xuPai' | 'duanXu';
/** 任务类型：从工具构成推断"在干什么活" */
export type RenWuLei = 'yanJiu' | 'bianMa' | 'wenDang' | 'gouJian' | 'yunWei' | 'xieTong' | 'guiHua' | 'duiHua' | 'zongHe' | 'qiTa';
/** 工具构成：本轮以哪类工具为主 */
export type GongJuLei = 'du' | 'xie' | 'ling' | 'wang' | 'mou' | 'duo' | 'wu';
/** 环境：本地（Ollama 等）还是云端推理 */
export type HuanJing = 'benDi' | 'yun' | 'unknown';

export interface TiaoJian {
  qingKuang: QingKuang;
  renWu: RenWuLei;
  gongJu: GongJuLei;
  huanJing: HuanJing;
  /** 步数档（'0' | '1-3' | '4-8' | '9-20' | '21+'） */
  buShu: string;
}

/** 单个工具名 → 工具类（判定规则固定、可解释，不许拍脑袋） */
export function gongJuFenLei(ming?: string): GongJuLei {
  const s = String(ming || '').trim().toLowerCase();
  if (!s) return 'wu';
  if (/subagent|spawn|delegate|actor/.test(s)) return 'mou';
  if (/plan_|ask_user|question|decision/.test(s)) return 'mou';
  if (/read|grep|glob|search|list_|find|recall|retrieve|open_path|sha_kan|view|look/.test(s)) return 'du';
  if (/write|edit|str_replace|patch|append|create_file|save/.test(s)) return 'xie';
  if (/shell|run_|exec|command|terminal|powershell|\.ps1|\.cmd|npm|dotnet|cargo|git\b/.test(s)) return 'ling';
  if (/web|fetch|http|browse|url|download|crawl/.test(s)) return 'wang';
  return 'du';
}

/** 工具构成：按类计数取主导；两类以上且没有明显主导 ⇒ duo */
export function fenGongJuLei(gongJuMing?: string[], dan?: string): GongJuLei {
  const all = [...(gongJuMing || []).map(gongJuFenLei), ...(dan ? [gongJuFenLei(dan)] : [])].filter((x) => x !== 'wu');
  if (!all.length) return 'wu';
  const ji = new Map<GongJuLei, number>();
  for (const x of all) ji.set(x, (ji.get(x) || 0) + 1);
  const pai = [...ji.entries()].sort((a, b) => b[1] - a[1]);
  const zui = pai[0] as [GongJuLei, number];
  const leiBie = ji.size;
  if (leiBie >= 3) return 'duo';
  if (leiBie === 2 && zui[1] < all.length * 0.7) return 'duo';
  return zui[0];
}

/** 任务类型：从工具构成推断"在干什么活"（同一套行为在不同活上耗时分布不同） */
export function fenRenWuLei(p: { gongJuMing?: string[]; gongJu?: string; zhiShuoBuZuo?: boolean }): RenWuLei {
  if (p.zhiShuoBuZuo) return 'duiHua';
  const ming = [...(p.gongJuMing || []).map((x) => String(x || '').trim().toLowerCase()), String(p.gongJu || '').trim().toLowerCase()].filter(Boolean);
  if (!ming.length) return 'qiTa';
  const lei = ming.map(gongJuFenLei);
  const you = (x: GongJuLei): boolean => lei.includes(x);
  const duoShao = (x: GongJuLei): number => lei.filter((y) => y === x).length;
  // 计划类工具为主且几乎没动手 ⇒ 规划；子代理为主 ⇒ 协同
  if (ming.every((n) => /^plan_/.test(n)) || (duoShao('mou') >= lei.length * 0.6 && ming.some((n) => /^plan_/.test(n)))) return 'guiHua';
  if (duoShao('mou') >= Math.max(2, lei.length * 0.5) && ming.some((n) => /subagent|spawn|delegate/.test(n))) return 'xieTong';
  if (you('wang') && !you('xie') && !you('ling')) return 'yanJiu';
  if (you('ling') && you('xie')) return 'gouJian';
  if (you('ling') && !you('xie')) return 'gouJian';
  if (you('xie') && !you('ling')) {
    // 写代码还是写文档：看文件工具的对手盘（读文件+写=改代码；只写=产出文档）
    return you('du') ? 'bianMa' : 'wenDang';
  }
  if (you('du') && !you('xie') && !you('ling')) return 'yanJiu';
  return 'zongHe';
}

/** 环境：本地推理（Ollama/本地模型名）还是云端（产品白名单 mimo 等） */
export function fenHuanJing(mo?: string, anZhao?: string): HuanJing {
  const an = String(anZhao || '').trim().toLowerCase();
  if (an === 'benDi' || an === 'yun' || an === 'unknown') return an;
  const s = String(mo || '').trim().toLowerCase();
  if (!s) return 'unknown';
  if (/ollama|localhost|127\.0\.0\.1|:11434|qwen|llama|deepseek-r|glm-|phi-|gemma|minicpm|yi-|baichuan/.test(s)) return 'benDi';
  return 'yun';
}

/** 四维+步数档 → 条件桶（顺序固定：越靠前的维度回退时越先保留） */
export function fenTiaoJian(p: {
  buShu?: number;
  gongJuMing?: string[];
  zhiShuoBuZuo?: boolean;
  moXing?: string;
  gongJu?: string;
  qingKuang?: string;
  huanJing?: string;
}): TiaoJian {
  const bu = Math.max(0, Math.floor(youXian(p.buShu, 0)));
  const qk = String(p.qingKuang || '').trim();
  const qingKuang: QingKuang = qk === 'xuPai' || qk === 'duanXu' ? qk : 'shouCi';
  return {
    qingKuang,
    renWu: fenRenWuLei(p),
    gongJu: fenGongJuLei(p.gongJuMing, p.gongJu),
    huanJing: fenHuanJing(p.moXing, p.huanJing),
    buShu: bu === 0 ? '0' : bu <= 3 ? '1-3' : bu <= 8 ? '4-8' : bu <= 20 ? '9-20' : '21+',
  };
}

export function tiaoJianJian(t: TiaoJian): string {
  return `renWu=${t.renWu}|qingKuang=${t.qingKuang}|gongJu=${t.gongJu}|huanJing=${t.huanJing}|buShu=${t.buShu}`;
}

/**
 * **回退链**：细桶 → 逐级去掉一个维度 → 该行为的整体（''）。
 * 样本会写进链上**每一级**（粗桶永远攒得住数据），预测时从细到粗找第一个有数据的桶，
 * 并用上一级做**收缩先验**（样本少时向粗桶均值靠，James–Stein / 经验贝叶斯思想）。
 */
export function huiTuiLian(jian: string): string[] {
  const duan = String(jian || '').split('|').filter(Boolean);
  const chu: string[] = [];
  for (let i = duan.length; i >= 0; i -= 1) chu.push(duan.slice(0, i).join('|'));
  return chu;
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
export function jieXiKaPanDuan(txt: string): { stalled: boolean | null; reason: string; etaSeconds: number | null; etaRounds: number; etaBasis: string } {
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
    etaRounds: shu('etaRounds') ?? shu('rounds') ?? 0,
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
    holtShuiPing: 0, holtQuShi: 0,
    p50Ms: 0, p90Ms: 0, mingZhongLv: 0, yangBenWei: [], fenWeiYang: [], liZi: [], gengXinTs: now,
    leiJiHe: 0, leiJiN: 0, duiShuHe: 0, wuChaEma: 0, fuGaiCe: 0, fuGaiZhong: 0,
    quJianXiShu: 1,
    tiaoJian: null,
  };
}

/** 旧版（v2）方法条目迁移到 v3：补累积统计字段（按已有滑动值近似初始化） */
function qianYiFangFa(f: EtaFangFa, now: number): EtaFangFa {
  const x = { ...kongFangFa(f.xingWei, f.qianMing, now), ...f };
  if (!Array.isArray(x.fenWeiYang)) x.fenWeiYang = Array.isArray(x.yangBenWei) ? [...x.yangBenWei] : [];
  if (!(x.leiJiN > 0)) {
    x.leiJiN = Math.max(1, Math.floor(x.yangBen || 1));
    x.leiJiHe = Math.round((x.shiJiEmaMs || 0) * x.leiJiN);
    x.duiShuHe = Math.log(Math.max(0.05, Math.min(20, x.piaoYiXiShu || 1))) * x.leiJiN;
    x.wuChaEma = 0.25;
    x.fuGaiCe = x.leiJiN;
    x.fuGaiZhong = Math.round(x.leiJiN * (x.mingZhongLv || 0.5));
  }
  return x;
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
    // 读盘时放宽版本号类型（历史文件是 v2，要能认出来做迁移）
    const du = this.jieDian ? (duJsonWenJian<{ version?: number; fangFa?: EtaKu['fangFa']; jingDuGuiJi?: EtaKu['jingDuGuiJi']; shouCiTs?: number; gengXinTs?: number; quanJu?: EtaKu['quanJu'] } | null>(this.jieDian, null)) : null;
    this.ku = (du && (du.version === 2 || du.version === 3) && du.fangFa) ? du as unknown as EtaKu : {
      version: 3, shouCiTs: now, gengXinTs: now,
      quanJu: { yangBen: 0, piaoYiXiShu: 1, mingZhongLv: 0, yuCeEmaMs: 0, shiJiEmaMs: 0 },
      fangFa: {}, jingDuGuiJi: [],
    };
    // v2 → v3 迁移：补累积统计字段 + 精度轨迹账
    if (this.ku.version !== 3 || !this.ku.jingDuGuiJi) {
      for (const an of Object.values(this.ku.fangFa || {})) {
        for (const [k, f] of Object.entries(an || {})) {
          if (f) an![k] = qianYiFangFa(f, now);
        }
      }
      this.ku.version = 3;
      if (!Array.isArray(this.ku.jingDuGuiJi)) this.ku.jingDuGuiJi = [];
      this.paiXie(now, true);
    }
  }

  kuaiZhao(): EtaKu { return JSON.parse(JSON.stringify(this.ku)) as EtaKu; }
  wenJian(): string { return this.jieDian || ''; }

  /** 查"这类行为/这类任务"的预测方法（没有就 null —— **绝不编一个出来**） */
  chaFangFa(xingWei: XingWei, qianMing?: string): EtaFangFa | null {
    return this.chaFangFaLian(xingWei, qianMing).zuiXi || null;
  }

  /**
   * **沿回退链找方法**：返回最细的有数据桶 + 它的收缩先验（下一级有数据的粗桶）。
   * 样本少的细桶预测时向粗桶均值收缩，避免"只见过 1 次就当真理"。
   */
  chaFangFaLian(xingWei: XingWei, qianMing?: string): { zuiXi: EtaFangFa | null; xianYan: EtaFangFa | null; ceng: number } {
    const an = this.ku.fangFa[xingWei] || {};
    const lian = qianMing ? huiTuiLian(String(qianMing)) : [''];
    let zuiXi: EtaFangFa | null = null;
    let xianYan: EtaFangFa | null = null;
    let ceng = 0;
    for (const jian of lian) {
      const f = an[jian] || null;
      if (f && f.yangBen > 0) {
        if (!zuiXi) { zuiXi = f; ceng = lian.indexOf(jian); }
        else { xianYan = f; break; }
      }
    }
    if (!zuiXi) {
      const zheng = an[''] || null;
      if (zheng && zheng.yangBen > 0) return { zuiXi: zheng, xianYan: null, ceng: lian.length - 1 };
    }
    return { zuiXi, xianYan, ceng };
  }

  /** 这类行为的样本总数（决定"有没有方法可用"） */
  yangBenShu(xingWei: XingWei): number {
    const an = this.ku.fangFa[xingWei] || {};
    return Object.values(an).reduce((n, x) => n + (x && x.yangBen ? x.yangBen : 0), 0);
  }

  /**
   * **写/更新一个预测方法**（需求里"把新的该类型任务的预测方法写入持久的配置文件"）。
   * 每轮真实结束都会带一个样本进来，方法随之变准。
   *
   * 自学习（docs/ETA-CONVERGENCE.md 的定理 1/2）：
   *  · 样本写进**回退链上的每一级**（细桶精、粗桶永不缺数据）；
   *  · `leiJiHe/leiJiN` 用 1/n 步长累计 ⇒ 样本均值几乎必然收敛到该桶真实均值；
   *  · `duiShuHe` 累计 log(实际/预测) ⇒ 偏移因子 exp(均值) 一致收敛到真实偏移；
   *  · 常数 α 的 EMA/Holt 只用来追**短期漂移**，不再充当中心估计。
   */
  jiFangFa(xingWei: XingWei, qianMing: string, yangBen: { yuCeMs: number; shiJiMs: number; mingZhong: boolean; moXing?: string }, now = Date.now()): EtaFangFa {
    const lian = huiTuiLian(qianMing);
    let zuiXi: EtaFangFa | null = null;
    for (const jian of lian) {
      const f = this.jiYiCeng(xingWei, jian, yangBen, now, jian === (lian[0] || ''));
      if (jian === (lian[0] || '')) zuiXi = f;
    }
    const q = this.ku.quanJu;
    const bi = yangBen.yuCeMs > 0 ? yangBen.shiJiMs / yangBen.yuCeMs : 1;
    q.yangBen += 1;
    q.yuCeEmaMs = ema(q.yuCeEmaMs, yangBen.yuCeMs);
    q.shiJiEmaMs = ema(q.shiJiEmaMs, yangBen.shiJiMs);
    q.piaoYiXiShu = emaXiShu(q.piaoYiXiShu, Math.min(20, Math.max(0.05, bi)));
    q.mingZhongLv = Number((q.yangBen > 1 ? q.mingZhongLv * 0.7 + (yangBen.mingZhong ? 0.3 : 0) : (yangBen.mingZhong ? 1 : 0)).toFixed(3));
    // 精度轨迹：每次学习记一笔（文件自己证明"越来越准"）
    const zong = this.zongWuChaEma();
    const gui = this.ku.jingDuGuiJi || (this.ku.jingDuGuiJi = []);
    if (!gui.length || now - (gui[gui.length - 1] as { ts: number }).ts > 10 * 60 * 1000 || gui.length < 64) {
      gui.push({ ts: now, yangBen: q.yangBen, wuChaEma: zong, piaoYiXiShu: q.piaoYiXiShu, mingZhongLv: q.mingZhongLv });
      if (gui.length > 256) gui.splice(0, gui.length - 256);
    }
    this.paiXie(now, true);
    return zuiXi || kongFangFa(xingWei, qianMing, now);
  }

  /** 回退链上单个桶的一次样本更新 */
  private jiYiCeng(xingWei: XingWei, qianMing: string, yangBen: { yuCeMs: number; shiJiMs: number; mingZhong: boolean; moXing?: string }, now: number, shiZuiXi: boolean): EtaFangFa {
    const an = this.ku.fangFa[xingWei] || (this.ku.fangFa[xingWei] = {});
    const f = an[qianMing] || kongFangFa(xingWei, qianMing, now);
    const bi = yangBen.yuCeMs > 0 ? yangBen.shiJiMs / yangBen.yuCeMs : 1;
    f.yangBen += 1;
    f.yuCeEmaMs = ema(f.yuCeEmaMs, yangBen.yuCeMs);
    f.shiJiEmaMs = ema(f.shiJiEmaMs, yangBen.shiJiMs);
    f.piaoYiXiShu = emaXiShu(f.piaoYiXiShu, Math.min(20, Math.max(0.05, bi)));
    // Holt 双指数平滑：跟上"越跑越快/慢"的趋势（只作漂移追踪）
    const h = holtYuCe(f.holtShuiPing, f.holtQuShi, yangBen.shiJiMs);
    f.holtShuiPing = h.shuiPing;
    f.holtQuShi = h.quShi;
    // 累积均值统计（1/n 步长 ⇒ SLLN 收敛）
    f.leiJiN += 1;
    f.leiJiHe += Math.max(1000, Math.round(yangBen.shiJiMs));
    f.duiShuHe += Math.log(Math.max(0.05, Math.min(20, bi)));
    f.wuChaEma = emaXiShu(f.wuChaEma, Math.abs(Math.log(Math.max(0.1, bi))), 0.2);
    f.fuGaiCe += 1;
    if (yangBen.mingZhong) f.fuGaiZhong += 1;
    // ACI 式区间乘子：没盖住 ⇒ 放大；盖住 ⇒ 缓慢回收。目标覆盖率 90%，步长递减收敛
    if (!(f.quJianXiShu > 0)) f.quJianXiShu = 1;
    const gamma = Math.min(0.2, 1.2 / Math.sqrt(f.fuGaiCe));
    f.quJianXiShu = Math.max(0.85, Math.min(3, f.quJianXiShu * Math.exp(gamma * (0.9 - (yangBen.mingZhong ? 1 : 0)))));
    f.yangBenWei.push(yangBen.shiJiMs);
    // 产品要求：保留最近 9 次真实样本供下次预测校准
    if (f.yangBenWei.length > YANG_BEN_BAO_LIU) f.yangBenWei.splice(0, f.yangBenWei.length - YANG_BEN_BAO_LIU);
    // 分位数水库（≤200）：经验分位数一致收敛到真实分位数（Glivenko–Cantelli）
    f.fenWeiYang = f.fenWeiYang || [];
    f.fenWeiYang.push(yangBen.shiJiMs);
    if (f.fenWeiYang.length > 200) f.fenWeiYang.splice(0, f.fenWeiYang.length - 200);
    const fenYuan = f.fenWeiYang.length >= 9 ? f.fenWeiYang : f.yangBenWei;
    f.p50Ms = fenWei(fenYuan, 0.5);
    f.p90Ms = fenWei(fenYuan, 0.9);
    f.mingZhongLv = Number((f.yangBen > 1 ? f.mingZhongLv * 0.7 + (yangBen.mingZhong ? 0.3 : 0) : (yangBen.mingZhong ? 1 : 0)).toFixed(3));
    // 最细桶才记逐条例子（粗桶只做统计，避免文件膨胀）
    if (shiZuiXi) {
      f.liZi.push({ ts: now, yuCeMs: yangBen.yuCeMs, shiJiMs: yangBen.shiJiMs, mingZhong: yangBen.mingZhong, moXing: yangBen.moXing });
      if (f.liZi.length > YANG_BEN_BAO_LIU) f.liZi.splice(0, f.liZi.length - YANG_BEN_BAO_LIU);
      if (!f.tiaoJian) {
        const t = fenTiaoJian({ gongJuMing: [], moXing: yangBen.moXing });
        f.tiaoJian = t;
      }
    }
    f.gengXinTs = now;
    an[qianMing] = f;
    return f;
  }

  /** 全库平均预测误差（|log(实际/预测)| 的样本量加权）——"越来越准"的总量尺 */
  zongWuChaEma(): number {
    let zi = 0, mu = 0;
    for (const an of Object.values(this.ku.fangFa || {})) {
      for (const f of Object.values(an || {})) {
        if (!f || !(f.yangBen > 0)) continue;
        zi += (f.wuChaEma || 0) * f.yangBen;
        mu += f.yangBen;
      }
    }
    return mu > 0 ? Number((zi / mu).toFixed(4)) : 0;
  }

  /**
   * **按持久文件里的方法预测**（模型没给、或给得不合法时用它；也用于交叉校验）。
   * 返回 null = 连方法都没有 ⇒ 调用方请模型自己预测。
   */
  yuCeByFangFa(xingWei: XingWei, qianMing: string, now = Date.now()): EtaYuCe | null {
    const { zuiXi: f, xianYan: fu, ceng } = this.chaFangFaLian(xingWei, qianMing);
    if (!f) return null;
    /**
     * 预测方法 v3（条件分桶 + 收缩估计，收敛性证明见 docs/ETA-CONVERGENCE.md）：
     *  1. **中心** = 收缩样本均值：μ̂ = (n·x̄_bucket + λ·μ̂_parent)/(n+λ)，λ=5。
     *     样本少向粗桶（更泛的条件）均值靠，样本多则自己说了算 —— n→∞ 时 μ̂→x̄→真值（SLLN）。
     *  2. **偏移修正** = exp(Σlog(实际/预测)/n)，一致收敛到真实乐观/保守偏移。
     *  3. Holt 双指数平滑：只用来追短期漂移（越跑越快/慢），不作中心。
     *  4. 加权分位数 p50/p90（近期样本权重指数衰减）+ MAD 鲁棒区间（宁可高估）。
     *  取较保守（更大）者，夹到 [10s, 24h]。
     */
    const n = Math.max(1, f.leiJiN || f.yangBen);
    const ziYangBen = f.leiJiN > 0 ? f.leiJiHe / f.leiJiN : (f.shiJiEmaMs || 0);
    const fuYangBen = fu && fu.leiJiN > 0 ? fu.leiJiHe / fu.leiJiN : 0;
    const quanJuMu = this.ku.quanJu.yangBen > 0 ? (this.ku.quanJu.shiJiEmaMs || 0) : 0;
    const mu = fuYangBen > 0 ? fuYangBen : (quanJuMu > 0 ? quanJuMu : ziYangBen);
    const LAMBDA = 5;
    const shouSuo = mu > 0 ? (n * ziYangBen + LAMBDA * mu) / (n + LAMBDA) : ziYangBen;
    const pianYi = n > 0 ? Math.exp(Math.max(-Math.log(4), Math.min(Math.log(4), f.duiShuHe / n))) : 1;
    const zhongXin = Math.round(shouSuo * pianYi);
    const holt = f.holtShuiPing > 0 ? Math.round(f.holtShuiPing + f.holtQuShi) : 0;
    const fenYuan = (f.fenWeiYang && f.fenWeiYang.length >= 9) ? f.fenWeiYang : f.yangBenWei;
    const jiaQuan50 = jiaQuanFenWei(fenYuan, 0.5);
    const jiaQuan90 = jiaQuanFenWei(fenYuan, 0.9);
    const zhongWei = Math.max(f.p50Ms || 0, jiaQuan50, zhongXin);
    const quJian = f.quJianXiShu > 0 ? f.quJianXiShu : 1;
    const p90 = Math.round(Math.max(f.p90Ms ? Math.round(f.p90Ms * 0.9) : 0, jiaQuan90 ? Math.round(jiaQuan90 * 0.9) : 0) * quJian);
    const madQuJian = fenYuan.length >= 3 ? Math.round((zhongWei + 1.4826 * mad(fenYuan)) * quJian) : 0;
    const eta = Math.max(ETA_ZUI_XIAO_MS, Math.min(ETA_ZUI_DA_MS,
      Math.max(holt, zhongWei, p90, madQuJian) || zhongWei || 0));
    if (!(eta > 0)) return null;
    const fuGaiLv = f.fuGaiCe > 0 ? Math.round((f.fuGaiZhong / f.fuGaiCe) * 100) : 0;
    return {
      etaMs: eta, jieZhiMs: now + eta, yiYongMs: 0,
      genJu: `条件桶（${f.qianMing || '行为整体'}｜${f.yangBen} 次记录，回退第 ${ceng} 层）：`
        + `收缩均值 ${shuoShiChang(Math.round(shouSuo))}×偏移 ${pianYi.toFixed(2)}→中心 ${shuoShiChang(zhongXin)}；`
        + `加权中位 ${shuoShiChang(jiaQuan50)}／加权P90 ${shuoShiChang(jiaQuan90)}×区间乘子 ${quJian.toFixed(2)}／趋势 ${f.holtQuShi >= 0 ? '+' : ''}${shuoShiChang(Math.abs(f.holtQuShi))}／MAD区间 ${shuoShiChang(madQuJian)}；`
        + `历史区间覆盖 ${fuGaiLv}%、预测误差 ${(f.wuChaEma || 0).toFixed(3)}`,
      laiYuan: 'fangFa', ts: now, mingZhong: null,
    };
  }

  /** 给模型看的参考文本（方法库那一半；自己写过的历次预测在临时文件那一半） */
  canKaoWenBen(xingWei: XingWei, qianMing: string): string {
    const { zuiXi: f, ceng } = this.chaFangFaLian(xingWei, qianMing);
    if (!f) return `【这类行为的经验】还没有历史记录（这是第一次），你只能靠自己判断 —— 请给**偏保守**的估计。`;
    const tiao = f.qianMing ? `条件「${f.qianMing}」` : '该行为整体';
    return `【这类行为的经验（${tiao}：${f.yangBen} 次真实记录${ceng > 0 ? `，按回退链第 ${ceng} 层的粗桶` : ''}）】`
      + `实际耗时中位数 ${shuoShiChang(f.p50Ms)}，90 分位 ${shuoShiChang(f.p90Ms)}；`
      + `历史预测命中率 ${Math.round(f.mingZhongLv * 100)}%；模型一向偏${f.piaoYiXiShu >= 1 ? '乐观' : '保守'}（实际/预测 ≈ ${f.piaoYiXiShu.toFixed(2)}）；`
      + `条件分桶后预测误差 ${(f.wuChaEma || 0).toFixed(3)}（越小越准）。`;
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
   *   · `yiChang` —— 预估不准到 3 次了（**直接判异常，不再问模型**；用户裁决阈值）
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

  /**
   * **列出所有还挂着中断标记的会话**（第 38 轮 项 2）。
   *
   * 真机反馈：牛马跑到一半程序被关掉，重新打开后**没有"继续/重试"按钮** ——
   * 中断信息其实已经落盘在 `eta-live.json` 里，但 `quZhongDuan()` 全仓没有任何调用方，
   * 而界面那个按钮是靠**广播事件**点亮的（渲染层的 `state.renWuZhongDuan` 只在内存里），
   * 重启后没人把账本里的断点重新播出去 ⇒ 内容丢了、按钮也没了。
   */
  lieZhongDuan(): Array<{ sessionId: string; jieDuan: string; why: string; error?: string; at: number }> {
    const chu: Array<{ sessionId: string; jieDuan: string; why: string; error?: string; at: number }> = [];
    for (const [sid, h] of Object.entries(this.ku.huiHua || {})) {
      const z = (h && h.zhongDuan) || null;
      if (!z || !z.at) continue;
      chu.push({ sessionId: sid, jieDuan: String(z.jieDuan || ''), why: String(z.why || ''), error: z.error ? String(z.error) : undefined, at: Number(z.at) || 0 });
    }
    return chu.sort((a, b) => b.at - a.at);
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

  /**
   * 判"没卡死" ⇒ **按持久预测文件续期**（产品要求 T14：不再简单翻倍/加档）。
   * 优先用方法库预测剩余时间/轮次作为新预警点；没有方法时退回加一档。
   * 同时更新持久预测文件（时间到了还没完成 = 之前的预测不准，用本次数据校准）。
   */
  jiaYiDang(sessionId: string, x: XingWei, yuCeEtaMs?: number, now = Date.now()): { yuJingMiao: number; yuJingLun: number } {
    const w = this.xingWei(sessionId, x, now);
    if (yuCeEtaMs && yuCeEtaMs > 0) {
      // 预测式续期：新预警点 = 现在 + 预测剩余时间（再留 20% 余量）
      w.yuJingMiao = Math.max(w.yuJingMiao, Math.round(yuCeEtaMs * 1.2));
      w.yuJingLun = Math.max(w.yuJingLun, Math.round(w.yuJingLun * 1.2));
    } else {
      w.yuJingMiao += YU_JING_JIA_YI_DANG_MS;
      w.yuJingLun += YU_JING_JIA_YI_DANG_LUN;
    }
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
