/**
 * 错误分类器（R149 自愈机制）。
 * 把各种模型/API/网络错误归类，给出是否可重试、建议延迟、用户提示语。
 */

export type ErrorCategory =
  | 'rate_limit'    // 429 限流
  | 'network'       // 断网/超时/连接失败
  | 'server'        // 500/502/503 服务端
  | 'auth'          // 401/403/invalid_api_key
  | 'content'       // content_filter / 内容策略
  | 'context_length' // 上下文超长
  | 'timeout'       // 请求超时
  | 'unknown';

export type ErrorInfo = {
  category: ErrorCategory;
  retryable: boolean;
  suggestedDelayMs: number;
  userMessage: string;
};

/** 简单错误分类：输入任意错误对象/字符串，输出分类结果 */
export function classifyError(err: unknown): ErrorInfo {
  const s = String((err as Error)?.message || err || '').toLowerCase();
  const code = Number((err as { code?: number })?.code) || 0;
  const status = Number((err as { status?: number })?.status) || code;

  // 429 限流
  if (status === 429 || /rate.?limit|too.?many.?request|429/.test(s)) {
    return {
      category: 'rate_limit',
      retryable: true,
      suggestedDelayMs: 1000,
      userMessage: '请求较多，正在排队…',
    };
  }

  // 网络错误
  if (/econnrefused|etimedout|enotfound|econnreset|fetch.?failed|network|socket|dns|eai_again|epipe/.test(s) || code === 'ECONNREFUSED' as unknown as number) {
    return {
      category: 'network',
      retryable: true,
      suggestedDelayMs: 2000,
      userMessage: '网络不稳定，正在重连…',
    };
  }

  // 超时
  if (/abort|timeout|timed.?out|etimedout/.test(s)) {
    return {
      category: 'timeout',
      retryable: true,
      suggestedDelayMs: 3000,
      userMessage: '响应超时，正在重试…',
    };
  }

  // 服务端错误
  if (status >= 500 || /internal.?server|bad.?gateway|service.?unavailable|502|503/.test(s)) {
    return {
      category: 'server',
      retryable: true,
      suggestedDelayMs: 3000,
      userMessage: '服务暂时不可用，正在重试…',
    };
  }

  // 认证错误
  if (status === 401 || status === 403 || /invalid.?api.?key|unauthorized|forbidden|401|403/.test(s)) {
    return {
      category: 'auth',
      retryable: false,
      suggestedDelayMs: 0,
      userMessage: 'API Key 无效或过期，请检查设置',
    };
  }

  // 内容策略
  if (/content.?filter|content.?policy|safety|moderation/.test(s)) {
    return {
      category: 'content',
      retryable: false,
      suggestedDelayMs: 0,
      userMessage: '内容被安全策略拒绝',
    };
  }

  // 上下文超长
  if (/context.?length|context.?window|too.?long|max(?:imum)?[\s_.]?token|token[\s_.]?(?:limit|exceeded|count)/.test(s)) {
    return {
      category: 'context_length',
      retryable: true,
      suggestedDelayMs: 0,
      userMessage: '内容超长，正在裁剪…',
    };
  }

  return {
    category: 'unknown',
    retryable: false,
    suggestedDelayMs: 0,
    userMessage: '发生未知错误',
  };
}
