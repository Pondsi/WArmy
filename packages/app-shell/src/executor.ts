/**
 * P5 短命执行者协议：上下文 = O(任务规模)，完成即销毁，只回传蒸馏结论
 */
import {
  congYuSheChuangJian,
  neiRongWenBen,
  liaoTianDaiGongJu,
  type LiaoTianXiaoXi,
  type GongJuGuiGe,
  type GongJuDiaoYong,
} from '@warmy/providers';

export interface ZhixingqiRenwu {
  taskId: string;
  brief: string;
  /** 仅任务相关上下文（马尔可夫毯） */
  contextItems: string[];
  budgetTokens?: number;
  /**
   * **这个执行者是哪只牛马**（id + 名字 + 人格）。
   *
   * 真机缺陷（第 20 轮）：以前执行者只是一串 id 字符串，这里拿**全局 providerCfg**
   * 发一次请求就完事 ⇒ 群里添加多少只牛马，模型侧都只是"同一个模型多答一句"，
   * 既没有各自的人格，也没有各自的模型。现在把身份带进来，系统提示里如实注入。
   */
  shenFen?: { id: string; ming: string; persona?: string };
  /**
   * **可用工具**（产品要求：项目里的执行者要和单聊牛马一样能干活）。
   * 不给就退回"只说不做"的纯对话 —— 那正是以前的行为。
   */
  tools?: GongJuGuiGe[];
  runTool?: (call: GongJuDiaoYong, ctx: { round: number; zuiDaJieGuoZiShu: number }) => Promise<string> | string;
  toolLimits?: { zuiDaLunShu: number; zuiDaJieGuoZiShu: number; totalChars: number };
}

export interface zhixingqiJieguo {
  taskId: string;
  distilled: string;
  stats: { durationMs: number; promptTokens: number; completionTokens: number };
  error?: string;
}

export interface ZhixingqiGongyingshangPeizhi {
  presetId: string;
  apiKey?: string;
  baseURL?: string;
  model?: string;
  protocol?: string;
}

/**
 * 执行者：独立短命会话，不继承值班者历史
 * 蒸馏返回：只给结论，不给完整对话
 */
export async function yunxingDuanCunhuoZhixingqi(
  renwu: ZhixingqiRenwu,
  cfg: ZhixingqiGongyingshangPeizhi
): Promise<zhixingqiJieguo> {
  const qiShiShiJian = Date.now();
  const sf = renwu.shenFen;
  const youGongJu = !!(renwu.tools && renwu.tools.length && renwu.runTool);
  /**
   * 系统提示：**你是哪只牛马**（名字 + 人格）+ 执行者纪律。
   * 有工具时明确要求"用工具真的去干"——否则模型常常只描述打算怎么做。
   */
  const xiTong = [
    sf ? `你是 WArmy 项目里的牛马「${sf.ming}」，这次被值班者派来执行一项任务。` : '你是 WArmy 的短命执行者。',
    sf?.persona ? `你的人设：${String(sf.persona).slice(0, 600)}` : '',
    '只根据给定任务与上下文完成工作，不继承值班者的完整历史。',
    youGongJu
      ? '需要生成/修改/打开文件、执行命令时，**必须真的调用工具**去做，不要只描述打算怎么做；做完再用精炼结论汇报（≤300字，含产物路径）。'
      : '输出精炼结论（≤200字），不要复述完整过程。',
  ].filter(Boolean).join('\n');
  const xiaoXiJi: LiaoTianXiaoXi[] = [
    { role: 'system', content: xiTong },
    {
      role: 'user',
      content: `【任务】${renwu.brief}\n\n【上下文】\n${renwu.contextItems.join('\n---\n')}`,
    },
  ];
  try {
    const provider = congYuSheChuangJian(cfg.presetId, {
      apiKey: cfg.apiKey,
      baseURL: cfg.baseURL || undefined,
      protocol: cfg.protocol,
    } as never, cfg.protocol as never);
    const Qiu = {
      model: cfg.model || 'deepseek-chat',
      xiaoXiJi,
      /** 有工具要多给预算：工具参数（如 write_file 的正文）本身就占输出 token */
      maxTokens: youGongJu ? Math.max(2048, renwu.budgetTokens || 4096) : Math.min(512, renwu.budgetTokens || 512),
      ...(youGongJu ? { tools: renwu.tools } : {}),
    };
    const lim = renwu.toolLimits || { zuiDaLunShu: 8, zuiDaJieGuoZiShu: 4000, totalChars: 12000 };
    const xiangYing = youGongJu
      ? (await liaoTianDaiGongJu(provider, Qiu, renwu.runTool!, {
          zuiDaLunShu: lim.zuiDaLunShu,
          zuiDaJieGuoZiShu: lim.zuiDaJieGuoZiShu,
          maxToolResultChars: lim.totalChars,
        })).xiangYingTi
      : await provider.chat(Qiu);
    return {
      taskId: renwu.taskId,
      distilled: neiRongWenBen(xiangYing.choices[0]?.message?.content),
      stats: {
        durationMs: Date.now() - qiShiShiJian,
        promptTokens: xiangYing.usage.promptTokens,
        completionTokens: xiangYing.usage.completionTokens,
      },
    };
  } catch (e) {
    return {
      taskId: renwu.taskId,
      distilled: '',
      stats: { durationMs: Date.now() - qiShiShiJian, promptTokens: 0, completionTokens: 0 },
      error: String((e as Error).message || e),
    };
  }
}

/** 批量派发：多个执行者并行，各自短命 */
export async function yunXingZhiXingQiJi(
  RenwuJi: ZhixingqiRenwu[],
  cfg: ZhixingqiGongyingshangPeizhi
): Promise<zhixingqiJieguo[]> {
  return Promise.all(RenwuJi.map((t) => yunxingDuanCunhuoZhixingqi(t, cfg)));
}
