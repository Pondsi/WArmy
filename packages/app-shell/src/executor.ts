/**
 * P5 短命执行者协议：上下文 = O(任务规模)，完成即销毁，只回传蒸馏结论
 */
import { congYuSheChuangJian, type LiaoTianXiaoXi } from '@warmy/providers';

export interface ZhixingqiRenwu {
  taskId: string;
  brief: string;
  /** 仅任务相关上下文（马尔可夫毯） */
  contextItems: string[];
  budgetTokens?: number;
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
  const xiaoXiJi: LiaoTianXiaoXi[] = [
    {
      role: 'system',
      content:
        '你是 WArmy 的短命执行者。只根据给定上下文完成任务，输出精炼结论（≤200字），不要复述完整过程。',
    },
    {
      role: 'user',
      content: `【任务】${renwu.brief}\n\n【上下文】\n${renwu.contextItems.join('\n---\n')}`,
    },
  ];
  try {
    const provider = congYuSheChuangJian(cfg.presetId, {
      apiKey: cfg.apiKey,
      baseURL: cfg.baseURL || undefined,
    });
    const xiangYing = await provider.chat({
      model: cfg.model || 'deepseek-chat',
      xiaoXiJi,
      maxTokens: Math.min(512, renwu.budgetTokens || 512),
    });
    return {
      taskId: renwu.taskId,
      distilled: xiangYing.choices[0]?.message?.content || '',
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
