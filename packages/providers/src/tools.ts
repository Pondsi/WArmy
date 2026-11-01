/**
 * 多轮工具调用循环（function calling）—— ADR 002 §9.4 待办 2
 *
 * 背景：上下文有界渲染器把"被省略的历史"留成可执行指针
 * （`retrieve(recordId=…)/retrieve(seq=…)/recall(…)`），但 `provider.chat` 之前**没传 tools**，
 * 模型根本无法当轮解引用 —— "不丢细节"只对宿主成立。本文件把这条链路补齐：
 *
 *   模型要工具 → 宿主执行（recall/retrieve 走记忆服务）→ 结果回给模型 → 再问 → 终答
 *
 * 设计约束：
 *   1. **有界**：`maxRounds` 限工具轮数，`maxToolResultChars` 限工具结果**总**预算，
 *      `maxResultChars` 限单条结果。任何一环都不可能把视图撑破（不变量 #2 的延伸）；
 *   2. **不抛错**：工具执行抛错 → 变文本回给模型（让模型自己决定下一步），不炸整轮对话；
 *      轮数/预算用尽 → 强制一次 `tool_choice:'none'` 收敛成文本答案（同样不抛错）；
 *   3. **优雅降级**：调用方没给 tools、开关关掉、协议不支持 tools（如 Ollama）、
 *      或首次带 tools 的请求直接报错（中转/模型不吃 tools）→ 退回"现状"的普通单轮对话，**不报错**；
 *   4. 协议映射已在 openai.ts / anthropic.ts 里完成（tools / tool_calls / tool_result），本文件不碰 HTTP。
 */
import { jieWeiAnQuan } from './util.js';
import { neiRongWenBen } from './types.js';
import type {
  LiaoTianXiaoXi,
  LiaoTianQingQiu,
  LiaoTianXiangYing,
  MoxingGongYing,
  GongYingXieYi,
  GongJuDiaoYong,
} from './types.js';

/**
 * 协议级工具调用能力表。
 * Ollama `/api/chat` 只对部分模型支持 tools，且旧版本会直接报错 —— 保守按"不支持"处理，
 * 走优雅降级（普通对话）。需要时可显式传 `supportsTools: true` 覆盖。
 */
export const XIEYI_GONGJU_ZHICHI: Record<GongYingXieYi, boolean> = {
  'openai-compatible': true,
  anthropic: true,
  // Ollama：带 tools 的模型支持 function calling；不支持的模型由外层降级链兜住。
  // 以前这里写 false ⇒ 工具整层被剥掉，模型"够不着桌面"（真事故）。
  ollama: true,
};

export const MOREN_GONGJU_ZUIDA_LUN = 12;
/** 单条工具结果上限（字符）。与视图预算同量级，避免"取回原文"把上下文又撑成无界 */
export const MOREN_GONGJU_JIEGUO_ZISHU = 4000;
/** 一轮对话内所有工具结果的**总**预算（字符） */
export const MOREN_GONGJU_ZONG_ZISHU = 12000;
/**
 * **额度分级预警点**（第 39 轮额度重做，抄 Claude Code 的 70/85/90 阶梯）。
 *
 * 真事故：模型**从来看不见自己的额度**。它只知道"调到第 41 次时宿主突然告诉我预算用完了"，
 * 于是前面把力气花在琐碎核对上（实测反复 `read_file`/写脚本数自己刚写的字数），
 * 等它真的开始交付最后一件事时额度已经没了 —— 用户看到的是"任务没做完"。
 * 上游做法是**把剩余预算做成模型可见的倒计时**，让它自己安排节奏、并在耗尽前干净收尾。
 * 这里按"三条仪表里最紧的一项"算同一个百分比，提前**警告而不是掐断**。
 */
export const YU_SUAN_YU_JING_DENG = [0.7, 0.9];

export type GongJuTingZhiYuan = 'stop' | 'max-rounds' | 'budget' | 'call-budget' | 'unsupported' | 'error' | 'max-rounds-extended';

/**
 * **额度快照**（给宿主的续预算钩子与预警文案用；只有计数，绝不含正文/密钥/路径）。
 * `yuanYin` = 是哪一条仪表先撞顶 —— 宿主据此决定抬哪一条。
 */
export interface YuSuanKuaiZhao {
  yuanYin: 'lun' | 'ci' | 'zi';
  lunShu: number;
  zuiDaLunShu: number;
  gongJuCiShu: number;
  zuiDaGongJuCiShu: number;
  jieGuoZiShu: number;
  zongYuSuan: number;
}

/** 工具执行器：入参是模型的 tool_call，返回值是回给模型的文本（不许抛错，抛了也会被兜住） */
export type GongJuZhiXing = (
  call: GongJuDiaoYong,
  ctx: { round: number; zuiDaJieGuoZiShu: number }
) => Promise<string> | string;

export interface GongJuXunHuanShi {
  kind: 'round' | 'tool' | 'degraded' | 'final' | 'retry' | 'budget' | 'shrink';
  round: number;
  tool?: string;
  ok?: boolean;
  /** 结果/错误文本的字符数（**不含**任何密钥、也不含正文） */
  chars?: number;
  detail?: string;
}

export interface GongJuXunHuanXuan {
  /** 工具轮上限，默认 3；0 = 不暴露工具（直接普通对话） */
  zuiDaLunShu?: number;
  /** 单条工具结果上限（字符），默认 4000 */
  zuiDaJieGuoZiShu?: number;
  /** 工具结果总预算（字符），默认 12000 */
  maxToolResultChars?: number;
  /**
   * 本轮**工具调用次数**上限（第 39 轮：以前这条闸只在宿主侧执法，循环不知道它存在，
   * 于是"还剩 3 轮额度"这种话没法告诉模型）。循环拿它只为算"最紧的一项"并发预警；
   * 真正的执法仍然宿主一侧照旧（两边读同一份账本 ⇒ 数字一致）。0/不给 = 这一路不计。
   */
  zuiDaGongJuCiShu?: number;
  /**
   * **额度到顶时向宿主申请续预算**（第 39 轮额度重做的核心）。
   *
   * 为什么要有这一条：固定上限会把"用户点名要 6000 字小说"这种任务**掐死在上限上**
   * —— 那不是打转，是额度不够；但把上限一律调高又会给打转的模型无限续命。
   * 所以判据交给宿主：只认**宿主看到的事实**（还有没交付的东西 + 刚才那一步有净进展 + 没被判停滞），
   * 不认模型自述。返回 `null` ⇒ 不续，走原来的强制收敛；返回增量 ⇒ 抬高对应上限后继续干。
   * 循环自己再套一层硬顶（`XU_YU_SUAN_ZUIDA` 次），保证"续命"是有限的。
   */
  xuYuSuanLai?: (k: YuSuanKuaiZhao) => { lunShu?: number; gongJuCiShu?: number; jieGuoZiShu?: number } | null;
  /** 关掉额度分级预警（压缩/摘要这类一次性调用不需要，也免得把提示词占满） */
  wuYuSuanTiShi?: boolean;
  /**
   * **发请求前的窗口闸**（字符）。0/不给 = 不预判（旧行为：撞 400 再压实重试）。
   *
   * 真机第 39 轮：本地 Ollama 的 `num_ctx` 只有 **7680**，而工具循环一轮轮往历史里追加
   * 工具结果与思考原文，攒到 **30932 token** 才发出去 ⇒ Ollama 直接 `400 exceeding model's context length`
   * ⇒ 整轮被掐。"渲染层的视图预算"管不到这里，因为**循环内部的历史是另一份**。
   * 所以这里在**每次真正发请求之前**估一次：明知超窗就不发，先按宿主的压实钩子压，
   * 压不下再从最旧的工具结果起**中段收起**（留一条"原文可 retrieve"的指针话，不静默截）。
   */
  zuiDaQingQiuZi?: number;
  /** 覆盖协议能力判定 */
  supportsTools?: boolean;
  signal?: AbortSignal;
  /** 观测钩子（审计/指标用）：只带工具名与长度，不带正文 */
  onEvent?: (e: GongJuXunHuanShi) => void;
  /**
   * 轮数到上限时是否让**模型自估**是否还要加轮（产品要求）。
   * 默认 true。false = 硬停（旧行为）。
   */
  daoShangXianWenMoXing?: boolean;
  /** 自估加轮的硬顶（含初始轮），默认 64；防止无限续命 */
  zuiDaZongLun?: number;
  /**
   * **首轮零工具调用时强制重试**（真机事故：多步任务模型只口头“已完成”却不调工具）。
   * 默认 true：当 `Qiu.toolChoice === 'required'` 时，首轮若 0 个 tool_calls，
   * 会用 `toolChoice:'required'` + 硬指令再试一次。
   */
  lingGongJuQiangZhi?: boolean;
  /**
   * **宿主侧上下文压实钩子**（第 34 轮 项 12）。
   *
   * 真事故：模型写长文时每加一段就把**整篇**重发一遍（`write_file` 整篇覆盖，不是 append），
   * 于是历史里堆了十几份全文 —— 实测一次请求 **23 万 token**，直接把 12.8 万窗口的本地
   * Ollama 模型打到 `400 request exceeds the available context size`，整轮任务报废。
   * 循环本身不知道"哪些参数是重复的大正文"（那是产品语义），所以留出这个钩子让宿主来压：
   * 每次**真正发请求前**拿一份"更短但等价"的消息数组，本地累加的历史不动。
   *
   * @param xiaoXiJi 即将发出的消息数组（可以克隆后返回新的）
   * @param jiYa 上一次请求已经因为"超出上下文"被拒 ⇒ 请压得更狠（把工具结果也截短）
   */
  yaSuoLai?: (xiaoXiJi: LiaoTianXiaoXi[], jiYa: boolean) => LiaoTianXiaoXi[];
}

export interface GongJuXunHuanGuo {
  xiangYingTi: LiaoTianXiangYing;
  /** 实际发出的模型请求次数（含强制收敛那次） */
  qingQiuJi: number;
  /** 真正执行了工具的轮数 */
  lunShu: number;
  /** 执行的工具调用条数 */
  gongJuDiaoYongJi: number;
  /** 工具结果累计字符数 */
  toolResultChars: number;
  tingZhiYuanYin: GongJuTingZhiYuan;
  /** true = 本轮走的是"不带 tools 的普通对话"（未暴露工具 / 不支持 / 首次调用报错） */
  degraded: boolean;
  /** 降级原因（审计用，不含密钥） */
  degradedReason?: string;
  /**
   * 收工时额度用到哪一档了**（第 39 轮）。宿主拿它如实告诉用户
   * "这轮是把额度用完了才停的，不是活干完了"，也用来审计"额度是不是又掐死了正在推进的任务"。
   */
  yuSuan?: YuSuanKuaiZhao & { lv: number; xuYuSuanCiShu: number };
  /**
   * **中间回复**：模型在发起工具调用的同一条响应里写给用户的正文（按轮顺序、带落地时刻）。
   * 最终响应只是最后一条；这些话以前只在流式气泡里闪过、落盘时丢掉（第 48 轮真机：27B 把截图内容
   * 写在中间回复里，最终回复只写"截图：两张都看得到"，会话一重绘答案就没了）。
   */
  zhongJianHuiFu?: Array<{ lun: number; ts: number; text: string }>;
}

function qianZhiZhengShu(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return dflt;
  const i = Math.floor(n);
  if (i < lo) return lo;
  if (i > hi) return hi;
  return i;
}

/** 该 provider 是否具备工具调用能力（实例标志优先于协议表） */
export function gongYingZhiChiGongJu(provider: MoxingGongYing): boolean {
  const biaoZhi = (provider as { supportsTools?: boolean }).supportsTools;
  if (typeof biaoZhi === 'boolean') return biaoZhi;
  return XIEYI_GONGJU_ZHICHI[provider.protocol] ?? true;
}

/**
 * 多轮工具调用循环。
 *
 * @param provider 模型 provider
 * @param req 请求（`req.tools` 为工具清单；不给就等于普通对话）
 * @param execute 宿主侧工具执行器
 */
export async function liaoTianDaiGongJu(
  provider: MoxingGongYing,
  Qiu: LiaoTianQingQiu,
  execute: GongJuZhiXing,
  opts: GongJuXunHuanXuan = {}
): Promise<GongJuXunHuanGuo> {
  const o = opts && typeof opts === 'object' ? opts : {};
  const tools = Array.isArray(Qiu.tools) ? Qiu.tools : [];
  /** 工具清单本身也进 prompt（估窗口时不能只算消息） */
  let gongJuBiaoZi = 0;
  try { gongJuBiaoZi = tools.length ? JSON.stringify(tools).length : 0; } catch { gongJuBiaoZi = 0; }
  const qingQiuGongJuJi = tools.length > 0;
  // 上限与设置里的 `contextToolMaxRounds` 对齐（原写死 8 ⇒ 用户设 12/32 被静默砍半）。
  // ⚠️ 硬顶必须**不低到把宿主的预算基线夹掉**（第 39 轮真事故复盘：宿主要"长文任务"给的
  // 基线被这里的 32 静默削减 ⇒ 抬了个寂寞 ⇒ 同一个洞在第 14/15 轮修过一次又复发）。
  // 所以这里的天花板跟 `zuiDaZongLun` 一致（64），"设置里能填多少"由宿主自己夹。
  const zuiDaLunShu = qianZhiZhengShu(o.zuiDaLunShu, 0, 64, MOREN_GONGJU_ZUIDA_LUN);
  const zuiDaJieGuoZiShu = qianZhiZhengShu(o.zuiDaJieGuoZiShu, 64, 20000, MOREN_GONGJU_JIEGUO_ZISHU);
  /** ⚠️ 可变：宿主批准续预算后会抬高（见 `shenQingXuYuSuan`） */
  let zongYuSuan = qianZhiZhengShu(o.maxToolResultChars, 0, 200000, MOREN_GONGJU_ZONG_ZISHU);
  /** 工具调用**次数**上限（同样可被续预算抬高；0 = 这一路不计） */
  let zuiDaGongJuCiShu = qianZhiZhengShu(o.zuiDaGongJuCiShu, 0, 100000, 0);
  const zhiChi = typeof o.supportsTools === 'boolean' ? o.supportsTools : gongYingZhiChiGongJu(provider);
  const emit = typeof o.onEvent === 'function' ? o.onEvent : () => {};
  const daoShangXianWenMoXing = o.daoShangXianWenMoXing !== false;
  const zuiDaZongLun = qianZhiZhengShu(o.zuiDaZongLun, 1, 128, 64);
  /** 到过上限后由模型自估加过的轮数（只允许有限次，防无限续命） */
  let jiaLunCiShu = 0;
  let zuiDaLunShuDongTai = zuiDaLunShu;
  /** 首轮零工具后的强制 required 重试只做一次 */
  let qiangZhiYiChong = false;

  /** 不带 tools 的普通对话（= ADR 002 之前的现状行为） */
  const chunWenBen = async (degraded: boolean, reason?: string): Promise<GongJuXunHuanGuo> => {
    const yS = typeof o.yaSuoLai === 'function' ? o.yaSuoLai : null;
    const xiangYingTi = await provider.chat(
      { ...Qiu, xiaoXiJi: yS ? yS(Qiu.xiaoXiJi, false) : Qiu.xiaoXiJi, tools: undefined, toolChoice: undefined },
      o.signal
    );
    if (degraded) emit({ kind: 'degraded', round: 0, detail: reason });
    return {
      xiangYingTi,
      qingQiuJi: 1,
      lunShu: 0,
      gongJuDiaoYongJi: 0,
      toolResultChars: 0,
      tingZhiYuanYin: degraded ? 'unsupported' : 'stop',
      degraded,
      degradedReason: reason,
    };
  };

  if (!qingQiuGongJuJi) return chunWenBen(false); // 调用方没要工具：普通对话，不属于降级
  if (zuiDaLunShu <= 0) return chunWenBen(true, 'tools-disabled(maxRounds=0)');
  if (!zhiChi) return chunWenBen(true, `unsupported(${provider.protocol})`);

  const xiaoXiJi: LiaoTianXiaoXi[] = Qiu.xiaoXiJi.map((m) => ({ ...m }));
  const zhongJianHuiFu: Array<{ lun: number; ts: number; text: string }> = [];
  let qingQiuJi = 0;
  let lunShu = 0;
  let gongJuDiaoYongJi = 0;
  let jieGuoZiShu = 0;
  let tingZhiYuanYin: GongJuTingZhiYuan = 'stop';
  let last: LiaoTianXiangYing | null = null;
  /**
   * **每一轮模型的思考过程**（按轮顺序累积）。
   *
   * 真事故：界面流式显示的是"整轮对话所有轮次"的思考（主进程逐增量广播，
   * 渲染层累加到一个缓冲里），而这里 `last = 最后一轮响应` 只带**最后一轮**的思考
   * ⇒ 回复一落地，思考块从"很长"变成"很短"（用户一眼就看出丢了内容）。
   * 落盘（聊天日志）与返回值都用累积后的思考，界面怎么看都一致。
   */
  const siKaoJi: string[] = [];

  /** 已经发过预警的额度档（同一档只发一次，不刷屏） */
  const yiFaYuJing = new Set<number>();
  /** 向宿主申请续预算的已用次数（硬上限，防无限续命） */
  let xuYuSuanCiShu = 0;
  const XU_YU_SUAN_ZUIDA = 4;

  /** 三条仪表里**最紧**的一项 —— 额度条只报这一个数，免得模型收到互相矛盾的信号 */
  const yuSuanZhuiJin = (): { lv: number; zuiJin: YuSuanKuaiZhao['yuanYin'] } => {
    const xiang: Array<[number, YuSuanKuaiZhao['yuanYin']]> = [
      [zuiDaLunShuDongTai > 0 ? lunShu / zuiDaLunShuDongTai : 0, 'lun'],
      [zuiDaGongJuCiShu > 0 ? gongJuDiaoYongJi / zuiDaGongJuCiShu : 0, 'ci'],
      [zongYuSuan > 0 ? jieGuoZiShu / zongYuSuan : 0, 'zi'],
    ];
    let zui = xiang[0]!;
    for (const x of xiang) if (x[0] > zui[0]) zui = x;
    return { lv: zui[0], zuiJin: zui[1] };
  };

  const yuSuanKuaiZhao = (yuanYin: YuSuanKuaiZhao['yuanYin']): YuSuanKuaiZhao => ({
    yuanYin,
    lunShu,
    zuiDaLunShu: zuiDaLunShuDongTai,
    gongJuCiShu: gongJuDiaoYongJi,
    zuiDaGongJuCiShu: zuiDaGongJuCiShu,
    jieGuoZiShu,
    zongYuSuan,
  });

  /** 给模型看的额度条（只讲事实数字 + 该怎么安排力气；**明说这不是权限问题**） */
  const yuJingWen = (deng: number): string => {
    const z = yuSuanZhuiJin();
    const ming = z.zuiJin === 'lun' ? `工具轮 ${lunShu}/${zuiDaLunShuDongTai}`
      : z.zuiJin === 'ci' ? `工具调用 ${gongJuDiaoYongJi}/${zuiDaGongJuCiShu}`
        : `工具结果 ${jieGuoZiShu}/${zongYuSuan} 字符`;
    const bai = Math.min(100, Math.round(z.lv * 100));
    const tou = `【宿主额度提示】一条用户消息的用量上限已用到约 ${bai}%（最紧的一项是${ming}）。`
      + '**这不是权限被拒，也不是哪里出错了** —— 是宿主给"这一轮"的用量闸。';
    if (deng >= 0.9) {
      return tou + '现在请这样安排：① 用户明确要的东西里，**已经做完的先交付**（文件路径、结论写实）；'
        + '② 还差哪几步，在答复里一条条列出来；③ 不要再自己数字数、也不要读回刚写的文件核对（字数与进度宿主每次都会报给你）。'
        + '只要宿主看到你**确实还有没交付的东西、而且刚才那一步有真实进展**，就会再给你额度 —— 所以不必为了省额度而半途交差。';
    }
    return tou + '请从现在开始把力气花在用户明确要的结果上：不要重复读回自己刚写的文件、'
      + '不要自己数字数或写脚本统计（宿主每次都会把进度报给你）；长文用 write_file 带 `append:true` 分段追加，'
      + '不要把整篇正文重复发一遍。';
  };

  /**
   * **额度到顶 ⇒ 先向宿主申请续预算**（第 39 轮额度重做）。
   * 判据全在宿主手里（`o.xuYuSuanLai`）：还有没交付的东西 + 刚才那一步有净进展 + 没被判停滞 ⇒ 才抬上限。
   * 拿不到批准就走原来的强制收敛 —— **给推进续命，不给打转续命**。
   */
  const shenQingXuYuSuan = (yuanYin: YuSuanKuaiZhao['yuanYin']): boolean => {
    if (typeof o.xuYuSuanLai !== 'function' || xuYuSuanCiShu >= XU_YU_SUAN_ZUIDA) return false;
    let jia: { lunShu?: number; gongJuCiShu?: number; jieGuoZiShu?: number } | null = null;
    try {
      jia = o.xuYuSuanLai(yuSuanKuaiZhao(yuanYin)) || null;
    } catch {
      return false;
    }
    if (!jia || typeof jia !== 'object') return false;
    const dl = Math.max(0, Math.floor(Number(jia.lunShu) || 0));
    const dc = Math.max(0, Math.floor(Number(jia.gongJuCiShu) || 0));
    const dz = Math.max(0, Math.floor(Number(jia.jieGuoZiShu) || 0));
    if (!dl && !dc && !dz) return false;
    xuYuSuanCiShu += 1;
    if (dl) zuiDaLunShuDongTai = Math.min(zuiDaZongLun, Math.max(zuiDaLunShuDongTai + 1, lunShu + dl));
    if (dc) zuiDaGongJuCiShu = zuiDaGongJuCiShu + dc;
    if (dz) zongYuSuan = Math.min(200000, Math.max(zongYuSuan + 1, zongYuSuan + dz));
    emit({ kind: 'budget', round: lunShu, detail: `extend(${yuanYin}:+${dl}lun/+${dc}ci/+${dz}zi,#${xuYuSuanCiShu})` });
    return true;
  };

  /** 一次请求的真实字符量（正文 + 思考原文 + 工具调用参数 + 工具清单本身都会进 prompt） */
  const qingQiuZiShu = (arr: LiaoTianXiaoXi[]): number => {
    let s = gongJuBiaoZi;
    for (const m of arr) {
      s += String((m as { content?: unknown }).content ?? '').length;
      s += String((m as { reasoning?: unknown }).reasoning ?? '').length;
      const dui = (m as { gongJuDiaoYongJi?: unknown }).gongJuDiaoYongJi;
      if (Array.isArray(dui) && dui.length) s += JSON.stringify(dui).length;
    }
    return s;
  };

  /**
   * **中段收起**（AutoGen 的 middle-out 那一路）：保头一条（用户原话/系统话）与最近 6 条，
   * 从最旧的工具结果开始收起；每条都留下"原多少字、要原文请 retrieve"的话 ——
   * 与"静默截断"的区别是：模型知道这里少了一段，而且知道去哪儿取回。
   */
  const shouQiZhongDuan = (arr: LiaoTianXiaoXi[], limitZi: number): { chu: LiaoTianXiaoXi[]; shou: number } => {
    const chu = arr.map((m) => ({ ...m }));
    let zi = qingQiuZiShu(chu);
    let shou = 0;
    const BAO_TAIL = 6;
    if (limitZi <= 0 || zi <= limitZi || chu.length <= 3) return { chu, shou };
    /** 收起一条消息（工具结果 / 超长的中间消息 / 超长思考），返回省下的字符数 */
    const shouYiTiao = (m: LiaoTianXiaoXi): number => {
      let jian = 0;
      const c = String((m as { content?: unknown }).content ?? '');
      const keJian = m.role === 'tool' || (m.role !== 'user' && c.length > 600);
      if (keJian && c.length > 160) {
        const xin = `（宿主为不超窗口收起了这一段 · 原 ${c.length} 字 · 需要原文请用 retrieve 按指针取回）`;
        jian += c.length - xin.length;
        (m as { content?: string }).content = xin;
      }
      const r = String((m as { reasoning?: unknown }).reasoning ?? '');
      if (r.length > 800) {
        const xin = r.slice(0, 300) + `…[思考已收起，原 ${r.length} 字]`;
        jian += r.length - xin.length;
        (m as { reasoning?: string }).reasoning = xin;
      }
      return jian;
    };
    /** 第一遍：只收中段，保住最近 `BAO_TAIL` 条（正常情况就该在这里收住） */
    for (let i = 1; i < chu.length - BAO_TAIL && zi > limitZi; i++) { const j = shouYiTiao(chu[i]!); if (j > 0) { zi -= j; shou += 1; } }
    /**
     * 第二遍：**窗口是真的硬限制**，中段收完还超（最近几步本身就很大）就接着往前收，
     * 只保住头两条（系统话 + 用户原话）与**最新那一条**（那是模型下一步要接的东西）。
     * 没有这一遍，"明知超窗就不发"在最坏情况会退化成"照发、等 400"。
     */
    for (let i = 2; i < chu.length - 1 && zi > limitZi; i++) { const j = shouYiTiao(chu[i]!); if (j > 0) { zi -= j; shou += 1; } }
    return { chu, shou };
  };

  const diaoYongMoXing = async (toolChoice: LiaoTianQingQiu['toolChoice']): Promise<LiaoTianXiangYing> => {
    qingQiuJi += 1;
    const yaSuo = typeof o.yaSuoLai === 'function' ? o.yaSuoLai : null;
    /**
     * **额度倒计时进模型上下文**（发请求前告知、拿到响应就撤）：
     * 上游做法是让模型看得见剩余预算，它才可能自己安排节奏、在耗尽前干净收尾。
     * 撤掉是为了不污染对话记录（重启回放/落盘都不该有宿主这句话）。
     * 强制收敛那次（`toolChoice:'none'`）不再发 —— 那条路径已经有收尾指令了。
     */
    let zhanShiDeng: number | null = null;
    let zhanShiTiShi: string | null = null;
    if (o.wuYuSuanTiShi !== true && toolChoice !== 'none' && lunShu > 0) {
      const z = yuSuanZhuiJin();
      for (const d of YU_SUAN_YU_JING_DENG) {
        if (z.lv >= d && !yiFaYuJing.has(d)) {
          zhanShiDeng = d;
          zhanShiTiShi = yuJingWen(d);
          break;
        }
      }
      if (zhanShiTiShi) xiaoXiJi.push({ role: 'user', content: zhanShiTiShi });
    }
    /**
     * **发之前就按窗口夹一次**（第 39 轮真机：本地 `num_ctx=7680` 的模型被循环攒到 30932 token
     * ⇒ Ollama 400 ⇒ 整轮被掐）。顺序：宿主压实钩子(轻) → (重) → 中段收起。
     * 这里的 `faSong` 是**发出去的那份**，本地 `xiaoXiJi` 仍保留完整历史（不因为窗口闸丢记录）。
     */
    const chuangKouZi = Math.max(0, Math.floor(Number(o.zuiDaQingQiuZi) || 0));
    const zhuangFaSong = (jiYa: boolean): LiaoTianXiaoXi[] => {
      let chu: LiaoTianXiaoXi[] = yaSuo ? yaSuo(xiaoXiJi, jiYa) : xiaoXiJi.map((m) => ({ ...m }));
      if (chuangKouZi > 0 && qingQiuZiShu(chu) > chuangKouZi) {
        const s = shouQiZhongDuan(chu, chuangKouZi);
        chu = s.chu;
        if (s.shou > 0) emit({ kind: 'shrink', round: lunShu, detail: `pre-send(${qingQiuZiShu(chu)}/${chuangKouZi} 字, 收起 ${s.shou} 段)` });
      }
      return chu;
    };
    try {
      const xiangYing = await (async (): Promise<LiaoTianXiangYing> => {
        try {
          return await provider.chat({ ...Qiu, xiaoXiJi: zhuangFaSong(false), tools, toolChoice }, o.signal);
        } catch (e) {
          /**
           * **超出上下文 ⇒ 压实后重发一次**（真机：本地 12.8 万窗口被 23 万 token 的请求打到 400，
           * 整轮直接死掉、用户只看到"任务没完成"）。压不动就如实把错误交回去（不静默截断用户的活）。
           */
          const cuo = String((e && (e as Error).message) || e);
          if (!yaSuo || !/exceeds the available context|context length|maximum context|too many tokens|token/i.test(cuo)) throw e;
          emit({ kind: 'retry', round: lunShu, detail: 'compress-after-context-overflow' });
          return await provider.chat({ ...Qiu, xiaoXiJi: zhuangFaSong(true), tools, toolChoice }, o.signal);
        }
      })();
      /**
       * **送达才算发过**（Codex 的同一条纪律：只能在历史插入之后标记已投递；之前被取消要能重试）：
       * 请求抛错时这一档预警不能记账，否则会出现"模型一次也没看见 90% 提示、
       * 但宿主已经记成发过了" ⇒ 再也不会发第二次 —— 那正好把要修的"模型看不见额度"造回来。
       */
      if (zhanShiDeng !== null) {
        yiFaYuJing.add(zhanShiDeng);
        emit({ kind: 'budget', round: lunShu, detail: `warn(${Math.round(yuSuanZhuiJin().lv * 100)}%)` });
      }
      const siKao = String((xiangYing.choices?.[0]?.message as { reasoning?: unknown } | undefined)?.reasoning || '');
      if (siKao) siKaoJi.push(siKao);
      return xiangYing;
    } finally {
      if (zhanShiTiShi) xiaoXiJi.pop();
    }
  };

  try {
    for (;;) {
      // 工具轮 / 总预算 / 调用次数已用尽：**下一次**就用 tool_choice:'none' 逼出文本答案（不再多发一次 auto）。
      // 这样"最多 maxRounds 轮工具 + 1 次强制收敛"是精确的请求数上界。
      const daoLunShangXian = lunShu >= zuiDaLunShuDongTai;
      const yuSuanShuChu = lunShu > 0 && jieGuoZiShu >= zongYuSuan;
      const ciShuShuChu = zuiDaGongJuCiShu > 0 && gongJuDiaoYongJi >= zuiDaGongJuCiShu;
      if (daoLunShangXian || yuSuanShuChu || ciShuShuChu) {
        /**
         * **第一步永远是问宿主"这算不算还在推进"**（第 39 轮额度重做）。
         * 以前三条闸各自硬停：轮数到顶去问模型（它自己说还要 4 轮就加），
         * 结果字符到顶直接掐死（真机实录：1123 秒全程有效增长仍被 `budget lun=20` 截断）。
         * 现在统一成一条预算：有进展就按宿主给的增量续（有硬顶、有次数上限），停滞立刻不续。
         */
        if (shenQingXuYuSuan(yuSuanShuChu ? 'zi' : ciShuShuChu ? 'ci' : 'lun')) continue;
        /**
         * **轮数到上限先让模型自估**（产品要求：不要硬停）。
         * 问它「活干完了吗？还要不要加轮？」——输出 JSON。
         * 未完成且还要加 ⇒ 提高上限继续；已完成 / 说不清 / 加轮超硬顶 ⇒ 走原来的强制收敛。
         * 这是**第二档**：宿主按事实拒绝续预算之后，才听模型自己的判断（它说要加也得有硬顶）。
         */
        if (daoLunShangXian && !yuSuanShuChu && !ciShuShuChu && daoShangXianWenMoXing && jiaLunCiShu < 3 && lunShu < zuiDaZongLun) {
          try {
            const PAN = '工具轮数已到上限。请判断当前任务是否已经完成。\n'
              + '只输出 JSON：{"done":true|false,"needRounds":数字（若未完成，还需要几轮工具调用；1~8）,"etaSeconds":数字（预计还需多少秒，可选）,"reason":"一句话理由"}\n'
              + '若你已经可以给出面向用户的完整结论，done 必须为 true。';
            xiaoXiJi.push({ role: 'user', content: PAN });
            const pan = await diaoYongMoXing('none');
            const panTxt = neiRongWenBen(pan.choices[0]?.message?.content) || '';
            const doneM = panTxt.match(/"done"\s*:\s*(true|false)/i);
            const needM = panTxt.match(/"needRounds"\s*:\s*(\d+)/i);
            const etaM = panTxt.match(/"etaSeconds"\s*:\s*(\d+)/i);
            const done = doneM ? String(doneM[1]).toLowerCase() === 'true' : true;
            const need = needM ? qianZhiZhengShu(Number(needM[1]), 1, 8, 4) : 4;
            const etaSec = etaM ? Number(etaM[1]) : null;
            // 把这次判断从对话里撤掉，避免污染后续工具轮上下文
            xiaoXiJi.pop();
            if (!done && need > 0) {
              jiaLunCiShu += 1;
              zuiDaLunShuDongTai = Math.min(zuiDaZongLun, zuiDaLunShuDongTai + need);
              emit({ kind: 'final', round: lunShu, detail: `max-rounds-extended(+${need}${etaSec != null ? ',eta=' + etaSec + 's' : ''})` });
              continue;
            }
            // done=true 或说不清 ⇒ 落到强制收敛
            tingZhiYuanYin = 'max-rounds';
          } catch {
            /* 自估失败不挡收敛 */
            tingZhiYuanYin = 'max-rounds';
          }
        } else {
          // 报**最先撞顶**的那一条闸（越具体越好：说明是被什么拦下的，而不是笼统的"到上限了"）
          tingZhiYuanYin = yuSuanShuChu ? 'budget'
            : ciShuShuChu ? 'call-budget'
              : (jiaLunCiShu > 0 ? 'max-rounds-extended' : 'max-rounds');
        }
        emit({ kind: 'final', round: lunShu, detail: tingZhiYuanYin });
        /**
         * **收尾必须给出完整正文**（真事故：工具跑到轮数上限被强停，用户只看到
         * 「核对完毕。临时脚本清一下：」这半句话 —— 那是模型在**发起工具调用前**的前导语，
         * 被当成了最终答复）。
         * 做法：逼收尾时先**明确要求"不要再调工具、直接给结论"**；若这一轮仍没有正文，
         * 再补一次同样要求的请求（而不是退回半句前导语）。
         */
        const QIU_SHOU_WEI = '不要再调用任何工具了。请只输出面向用户的最终答复：直接给结论与要点，把已经查到/已经做完的事说清楚，不要再写"接下来要做什么"。'
          // 第 39 轮：额度收口要把"哪些已交付、哪些还欠着"写实，别让用户以为任务完成了。
          + '如果用户的诉求还有没做完的部分，必须在答复里一条条列出来还差什么（这是宿主的额度到了，不是你做完了）。';
        xiaoXiJi.push({ role: 'user', content: QIU_SHOU_WEI });
        try {
          let zuiZhongXiangYing = await diaoYongMoXing('none');
          let text = neiRongWenBen(zuiZhongXiangYing.choices[0]?.message?.content);
          if (!text) {
            // 再逼一次：把要求写得更死
            xiaoXiJi.push({ role: 'user', content: '请只回复正文结论（不要工具调用、不要前言、不要占位符）。' });
            const zai = await diaoYongMoXing('none');
            const t2 = neiRongWenBen(zai.choices[0]?.message?.content);
            if (t2) { zuiZhongXiangYing = zai; text = t2; }
          }
          // 仍然没有正文，才退回上一次响应（避免把"空回复"当答案）
          const qianYiWenBen = neiRongWenBen(last?.choices[0]?.message?.content);
          if (text || !qianYiWenBen) last = zuiZhongXiangYing;
        } catch {
          /* 收敛失败就退回最后一次响应，绝不抛错（视图/预算已经守住了） */
        }
        break;
      }
      // required 只用于首个请求：每轮都 required ⇒ 模型无法自然收尾，只能撞轮数上限（同 Agents SDK reset_tool_choice）
      const qiangZhiBenLun = lunShu === 0 && Qiu.toolChoice === 'required' && (o.lingGongJuQiangZhi !== false);
      const xiangYing = await diaoYongMoXing(qiangZhiBenLun ? 'required' : 'auto');
      last = xiangYing;
      let xiaoXi = xiangYing.choices[0]?.message;
      let diaoYongJi = Array.isArray(xiaoXi?.gongJuDiaoYongJi) ? xiaoXi.gongJuDiaoYongJi.filter((c) => c && c.function?.name) : [];
      if (!diaoYongJi.length && qiangZhiBenLun && !qiangZhiYiChong) {
        qiangZhiYiChong = true;
        xiaoXiJi.push({
          role: 'user',
          content: '你必须立即调用工具执行任务（write_file / make_pptx / open_path / run_shell 等），'
            + '不要只用文字描述“已完成”。禁止在未调用工具前声称已生成/已打开任何文件。',
        });
        try {
          const qiang = await diaoYongMoXing('required');
          last = qiang;
          xiaoXi = qiang.choices[0]?.message;
          diaoYongJi = Array.isArray(xiaoXi?.gongJuDiaoYongJi) ? xiaoXi.gongJuDiaoYongJi.filter(Boolean) : [];
          emit({ kind: 'final', round: lunShu, detail: 'force-tools-required' });
        } catch {
          /* 强制失败不挡正常路径 */
        }
      }
      if (!diaoYongJi.length) {
        tingZhiYuanYin = 'stop';
        /**
         * 跑过工具、模型自己收尾却没写正文 ⇒ 带着整段记忆（含图、工具结果）再要一次最终答复，
         * 同 smolagents 的 provide_final_answer。真机：Qwen3-VL 一轮里把文件/打开/等待全做完，最后 content 为空，
         * 宿主只能拿工具名凑一句，续派轮又从头做一遍。
         */
        if (lunShu > 0 && !/[\p{L}\p{N}]/u.test(neiRongWenBen(xiaoXi?.content) || '')) {
          xiaoXiJi.push({ role: 'user', content: '工具都已执行完毕。不要再调用工具，请直接给出面向用户的最终答复：逐条回答用户原话里的问题，说清楚做成了什么、文件在哪里。' });
          try {
            const zai = await diaoYongMoXing('none');
            if (/[\p{L}\p{N}]/u.test(neiRongWenBen(zai.choices[0]?.message?.content) || '')) last = zai;
            emit({ kind: 'final', round: lunShu, detail: 'empty-stop-final-answer' });
          } catch {
            /* 收尾失败就退回原响应，由宿主兜底 */
          }
        }
        break;
      }
      lunShu += 1;
      emit({ kind: 'round', round: lunShu, detail: `${diaoYongJi.length} 个工具调用` });
      {
        const wen = neiRongWenBen(xiaoXi?.content) || '';
        if (/[\p{L}\p{N}]/u.test(wen) && zhongJianHuiFu.length < 64) zhongJianHuiFu.push({ lun: lunShu, ts: Date.now(), text: wen.slice(0, 20000) });
      }
      // 模型的 tool_calls 必须以 assistant 消息入对话，随后每条都要有对应的 tool 结果。
      // 思考也要原样带回（MiMo/DeepSeek/Kimi 交错思考的硬要求）：丢了它，模型下一轮看不到自己为什么调了这个工具，会去"核实"或重做。
      const siKaoBenLun = String((xiaoXi as { reasoning?: unknown } | undefined)?.reasoning || '');
      xiaoXiJi.push({ role: 'assistant', content: xiaoXi?.content || '', gongJuDiaoYongJi: diaoYongJi, ...(siKaoBenLun ? { reasoning: siKaoBenLun } : {}) });
      for (const call of diaoYongJi) {
        const ming = call.function?.name || 'unknown';
        const shengYu = zongYuSuan - jieGuoZiShu;
        let text = '';
        if (shengYu <= 0) {
          /**
           * 额度用完的**话术必须不像拒绝**（第 35/39 轮的同一课）：写成"未执行/权限"，
           * 模型就当成被拒，换一个工具再试一次、再被拒、再换 —— 真机 145 秒里跑了十几轮。
           * 所以直说：这是宿主的用量闸、不是权限、也不是出错；并告诉它该怎么收口。
           */
          text = `（宿主给这一轮的**结果额度已用完**，${ming} 这次没有执行。`
            + '**这不是权限被拒，也不是执行失败** —— 只是宿主的用量闸到点了。'
            + '请基于已经拿到的信息如实汇报：已经做完了什么、还差哪几步、卡在哪一步。'
            + '只要还有用户明确要的东西没交付、而且刚才那一步有真实进展，宿主会再给额度，所以不要把没做完的说成做完了。）';
          emit({ kind: 'tool', round: lunShu, tool: ming, ok: false, chars: text.length, detail: 'budget' });
        } else {
          const shangXian = Math.min(zuiDaJieGuoZiShu, shengYu);
          try {
            const out = await execute(call, { round: lunShu, zuiDaJieGuoZiShu: shangXian });
            text = out === undefined || out === null ? '' : String(out);
          } catch (e) {
            // 工具执行失败不是致命错误：把失败原因作为工具结果回给模型，让它自己纠偏
            const yuanYin = String((e as Error)?.message || e).slice(0, 200);
            text = `工具 ${ming} 执行失败：${yuanYin}`;
            emit({ kind: 'tool', round: lunShu, tool: ming, ok: false, chars: text.length, detail: yuanYin });
          }
          if (text.length > shangXian) {
            text = jieWeiAnQuan(text, shangXian) + `\n…[结果被截断：原 ${text.length} 字符，本次上限 ${shangXian}]`;
          }
          gongJuDiaoYongJi += 1;
          emit({ kind: 'tool', round: lunShu, tool: ming, ok: true, chars: text.length });
        }
        jieGuoZiShu += text.length;
        xiaoXiJi.push({
          role: 'tool',
          toolCallId: call.id,
          ming,
          content: text,
        });
      }
    }
  } catch (e) {
    // 首次带 tools 就报错：多半是该模型/中转不吃 tools（HTTP 400 之类）。
    // 优雅降级 = 重试一次不带 tools 的普通对话，而不是把整轮对话打成 error。
    if (qingQiuJi <= 1) {
      const yuanYin = String((e as Error)?.message || e).slice(0, 160);
      emit({ kind: 'degraded', round: 0, detail: `tools-failed: ${yuanYin}` });
      try {
        const r = await chunWenBen(true, `tools-failed: ${yuanYin}`);
        // requests 如实反映"试过带 tools 的那次 + 降级后这次"（失败的尝试也算一次模型请求）
        return { ...r, qingQiuJi: r.qingQiuJi + qingQiuJi, tingZhiYuanYin: 'unsupported' };
      } catch (e2) {
        // 连降级都失败（网络/鉴权），保持原始错误的语义，交给调用方
        throw e2;
      }
    }
    throw e;
  }

  // 轮数/预算用尽时已在循环里用 tool_choice:'none' 强制收敛过一次（见上），
  // 这里只处理"极端情况"：一次模型请求都没成功（正常路径不会走到）。
  const huiTui: LiaoTianXiangYing = last ?? {
    id: 'tool-loop-empty',
    model: Qiu.model,
    choices: [{ index: 0, message: { role: 'assistant', content: '' }, finishReason: 'stop' }],
    usage: {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cacheHitTokens: 0,
      cacheMissTokens: 0,
      source: 'none',
    },
  };

  /**
   * 把**所有轮次**的思考合并回最终响应（界面/日志/返回值三处一致）。
   * 只有一轮时 `siKaoJi` 里就是那一轮本身，不会重复；某一轮没思考就跳过。
   */
  const zuiZhong: LiaoTianXiangYing = (() => {
    const heBing = siKaoJi.filter(Boolean).join('\n\n');
    const tou = huiTui.choices[0];
    if (!heBing || !tou) return huiTui;
    return {
      ...huiTui,
      choices: [{ ...tou, message: { ...tou.message, reasoning: heBing } }, ...huiTui.choices.slice(1)],
    };
  })();

  return {
    xiangYingTi: zuiZhong,
    qingQiuJi,
    lunShu,
    gongJuDiaoYongJi,
    toolResultChars: jieGuoZiShu,
    tingZhiYuanYin,
    degraded: false,
    yuSuan: { ...yuSuanKuaiZhao(yuSuanZhuiJin().zuiJin), lv: yuSuanZhuiJin().lv, xuYuSuanCiShu: xuYuSuanCiShu },
    ...(zhongJianHuiFu.length ? { zhongJianHuiFu } : {}),
  };
}
