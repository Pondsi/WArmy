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
  ollama: false,
};

export const MOREN_GONGJU_ZUIDA_LUN = 3;
/** 单条工具结果上限（字符）。与视图预算同量级，避免"取回原文"把上下文又撑成无界 */
export const MOREN_GONGJU_JIEGUO_ZISHU = 4000;
/** 一轮对话内所有工具结果的**总**预算（字符） */
export const MOREN_GONGJU_ZONG_ZISHU = 12000;

export type GongJuTingZhiYuan = 'stop' | 'max-rounds' | 'budget' | 'unsupported' | 'error';

/** 工具执行器：入参是模型的 tool_call，返回值是回给模型的文本（不许抛错，抛了也会被兜住） */
export type GongJuZhiXing = (
  call: GongJuDiaoYong,
  ctx: { round: number; zuiDaJieGuoZiShu: number }
) => Promise<string> | string;

export interface GongJuXunHuanShi {
  kind: 'round' | 'tool' | 'degraded' | 'final';
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
  /** 覆盖协议能力判定 */
  supportsTools?: boolean;
  signal?: AbortSignal;
  /** 观测钩子（审计/指标用）：只带工具名与长度，不带正文 */
  onEvent?: (e: GongJuXunHuanShi) => void;
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
  const qingQiuGongJuJi = tools.length > 0;
  const zuiDaLunShu = qianZhiZhengShu(o.zuiDaLunShu, 0, 8, MOREN_GONGJU_ZUIDA_LUN);
  const zuiDaJieGuoZiShu = qianZhiZhengShu(o.zuiDaJieGuoZiShu, 64, 20000, MOREN_GONGJU_JIEGUO_ZISHU);
  const zongYuSuan = qianZhiZhengShu(o.maxToolResultChars, 0, 200000, MOREN_GONGJU_ZONG_ZISHU);
  const zhiChi = typeof o.supportsTools === 'boolean' ? o.supportsTools : gongYingZhiChiGongJu(provider);
  const emit = typeof o.onEvent === 'function' ? o.onEvent : () => {};

  /** 不带 tools 的普通对话（= ADR 002 之前的现状行为） */
  const chunWenBen = async (degraded: boolean, reason?: string): Promise<GongJuXunHuanGuo> => {
    const xiangYingTi = await provider.chat(
      { ...Qiu, tools: undefined, toolChoice: undefined },
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
  let qingQiuJi = 0;
  let lunShu = 0;
  let gongJuDiaoYongJi = 0;
  let jieGuoZiShu = 0;
  let tingZhiYuanYin: GongJuTingZhiYuan = 'stop';
  let last: LiaoTianXiangYing | null = null;

  const diaoYongMoXing = async (toolChoice: LiaoTianQingQiu['toolChoice']): Promise<LiaoTianXiangYing> => {
    qingQiuJi += 1;
    return provider.chat({ ...Qiu, xiaoXiJi, tools, toolChoice }, o.signal);
  };

  try {
    for (;;) {
      // 工具轮 / 总预算已用尽：**下一次**就用 tool_choice:'none' 逼出文本答案（不再多发一次 auto）。
      // 这样"最多 maxRounds 轮工具 + 1 次强制收敛"是精确的请求数上界。
      const daoLunShangXian = lunShu >= zuiDaLunShu;
      const yuSuanShuChu = lunShu > 0 && jieGuoZiShu >= zongYuSuan;
      if (daoLunShangXian || yuSuanShuChu) {
        // 两个限制同时命中时，报"预算"（更具体：说明是被工具结果总量拦下的）
        tingZhiYuanYin = yuSuanShuChu ? 'budget' : 'max-rounds';
        emit({ kind: 'final', round: lunShu, detail: tingZhiYuanYin });
        try {
          const zuiZhongXiangYing = await diaoYongMoXing('none');
          const text = zuiZhongXiangYing.choices[0]?.message?.content || '';
          // 强制收敛若仍不产出文本，就保留上一次响应的正文（避免把"空回复"当成答案）
          const qianYiWenBen = last?.choices[0]?.message?.content || '';
          if (text || !qianYiWenBen) last = zuiZhongXiangYing;
        } catch {
          /* 收敛失败就退回最后一次响应，绝不抛错（视图/预算已经守住了） */
        }
        break;
      }
      const xiangYing = await diaoYongMoXing('auto');
      last = xiangYing;
      const xiaoXi = xiangYing.choices[0]?.message;
      const diaoYongJi = Array.isArray(xiaoXi?.gongJuDiaoYongJi) ? xiaoXi.gongJuDiaoYongJi.filter(Boolean) : [];
      if (!diaoYongJi.length) {
        tingZhiYuanYin = 'stop';
        break;
      }
      lunShu += 1;
      emit({ kind: 'round', round: lunShu, detail: `${diaoYongJi.length} 个工具调用` });
      // 模型的 tool_calls 必须以 assistant 消息入对话，随后每条都要有对应的 tool 结果
      xiaoXiJi.push({ role: 'assistant', content: xiaoXi?.content || '', gongJuDiaoYongJi: diaoYongJi });
      for (const call of diaoYongJi) {
        const ming = call.function?.name || 'unknown';
        const shengYu = zongYuSuan - jieGuoZiShu;
        let text = '';
        if (shengYu <= 0) {
          text = `（工具结果预算已用尽，未执行 ${ming}；请基于已有信息作答）`;
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

  return {
    xiangYingTi: huiTui,
    qingQiuJi,
    lunShu,
    gongJuDiaoYongJi,
    toolResultChars: jieGuoZiShu,
    tingZhiYuanYin,
    degraded: false,
  };
}
