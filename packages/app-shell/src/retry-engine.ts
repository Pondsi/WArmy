/**
 * 重试引擎（R149 自愈机制）。
 * 指数退避 + 随机抖动 + 熔断器。
 */
import { classifyError, type ErrorInfo } from './error-classifier.js';

export type RetryOptions = {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (info: { attempt: number; maxRetries: number; delayMs: number; error: unknown; errorInfo: ErrorInfo }) => void;
  isRetryable?: (err: unknown) => boolean;
};

/** 带指数退避的重试 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const maxRetries = opts.maxRetries ?? 5;
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  const maxDelayMs = opts.maxDelayMs ?? 30000;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const info = classifyError(err);
      const retryable = opts.isRetryable ? opts.isRetryable(err) : info.retryable;

      if (!retryable || attempt === maxRetries) throw err;

      // 抖动随延迟按比例缩放（30%），保证指数退避对任意 baseDelay 都单调递增；
      // 旧写法固定 +0..499ms，baseDelay 很小时抖动会淹没指数增长（实测出现延迟倒挂）。
      const base = baseDelayMs * Math.pow(2, attempt);
      const delayMs = Math.min(base + Math.floor(Math.random() * base * 0.3), maxDelayMs);
      opts.onRetry?.({ attempt: attempt + 1, maxRetries, delayMs, error: err, errorInfo: info });
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

/** 熔断器状态 */
type CircuitState = 'closed' | 'open' | 'half-open';

/** 熔断器：连续失败过多则暂时拒绝请求，超时后放行试探 */
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private lastFailureTime = 0;

  constructor(
    private failureThreshold = 5,
    private recoveryTimeoutMs = 60000,
  ) {}

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.recoveryTimeoutMs) {
        this.state = 'half-open';
      } else {
        throw new Error(`circuit-breaker: 服务暂时不可用，请 ${Math.ceil((this.recoveryTimeoutMs - (Date.now() - this.lastFailureTime)) / 1000)} 秒后重试`);
      }
    }

    try {
      const result = await fn();
      // 成功 → 关闭熔断
      this.state = 'closed';
      this.failureCount = 0;
      return result;
    } catch (err) {
      this.failureCount++;
      this.lastFailureTime = Date.now();
      if (this.failureCount >= this.failureThreshold) {
        this.state = 'open';
      }
      throw err;
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.lastFailureTime = 0;
  }
}
