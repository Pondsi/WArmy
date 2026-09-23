/**
 * 模型角色分配：值班者 / 执行者 / 摘要兜底 / 嵌入
 * 任务分级调度：P0→最强 / P3→最便宜
 */
export type MoxingJuese = 'duty' | 'executor' | 'summary' | 'embedding';
export type JinjiduJibie = 'P0' | 'P1' | 'P2' | 'P3';

export interface JueseMoxingPeizhi {
  duty?: string;
  executor?: string;
  summary?: string;
  embedding?: string;
}

/** P0-P3 任务分级 → 角色模型选择 */
export function pickModelForUrgency(
  urgency: JinjiduJibie,
  roles: JueseMoxingPeizhi,
  huiTui = 'deepseek-chat'
): string {
  switch (urgency) {
    case 'P0':
      return roles.duty || huiTui;
    case 'P1':
      return roles.duty || huiTui;
    case 'P2':
      return roles.executor || roles.duty || huiTui;
    case 'P3':
      return roles.summary || huiTui;
    default:
      return huiTui;
  }
}

export function pickEmbeddingModel(roles: JueseMoxingPeizhi): string {
  return roles.embedding || 'Xenova/bge-small-zh-v1.5';
}
