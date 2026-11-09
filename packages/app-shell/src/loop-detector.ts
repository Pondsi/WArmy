/**
 * 循环/停滞检测器（R149 自愈机制）。
 *
 * 检测两类「白费力气」：
 *   ① 同一工具+同一参数反复调用且结果无变化 → 自动提示换方法
 *   ② 连续 N 轮输出为空/相同 → 自动降温度/换策略
 *
 * 只做「检测与计数」，不直接改行为（改由调用方决定注入提示/换模型/上报）。
 */

/** 单次工具调用的指纹 */
export type ToolCallFingerprint = {
  /** 工具名 */
  tool: string;
  /** 参数哈希（用 JSON.stringify 的简单 hash） */
  paramsHash: string;
  /** 结果摘要哈希（截取前 256 字符做 hash） */
  resultHash: string;
  /** 时间戳 */
  ts: number;
};

/** 循环检测配置 */
export type LoopDetectorOptions = {
  /** 同指纹连续多少次算循环（默认 3） */
  sameCallThreshold: number;
  /** 输出停滞检测窗口（默认 5 轮） */
  stallWindow: number;
  /** 最多记录多少条历史（默认 50） */
  maxHistory: number;
};

/** 检测结果 */
export type LoopDetectionResult = {
  /** 是否检测到循环 */
  isLooping: boolean;
  /** 循环类型 */
  loopType: 'same-tool-call' | 'stalled-output' | 'deep-recursion' | null;
  /** 已连续重复次数 */
  consecutiveCount: number;
  /** 建议的自愈动作 */
  suggestion: 'switch-method' | 'reduce-temperature' | 'simplify-prompt' | 'escalate-to-user';
  /** 给模型的提示语（注入到 prompt） */
  modelHint: string;
  /** 给用户的状态提示 */
  userMessage: string;
};

/** 简单字符串哈希（FNV-1a 变体） */
function simpleHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** 循环检测器 */
export class LoopDetector {
  private history: ToolCallFingerprint[] = [];
  private outputHistory: string[] = [];
  private recursionDepth = 0;
  private readonly opts: LoopDetectorOptions;

  constructor(opts?: Partial<LoopDetectorOptions>) {
    this.opts = {
      sameCallThreshold: opts?.sameCallThreshold ?? 3,
      stallWindow: opts?.stallWindow ?? 5,
      maxHistory: opts?.maxHistory ?? 50,
    };
  }

  /** 记录一次工具调用 */
  recordToolCall(tool: string, params: unknown, result: unknown): void {
    const paramsHash = simpleHash(JSON.stringify(params ?? ''));
    const resultStr = String(result ?? '').slice(0, 256);
    const resultHash = simpleHash(resultStr);
    this.history.push({ tool, paramsHash, resultHash, ts: Date.now() });
    if (this.history.length > this.opts.maxHistory) {
      this.history = this.history.slice(-this.opts.maxHistory);
    }
  }

  /** 记录一轮模型输出（用于停滞检测） */
  recordOutput(text: string): void {
    const hash = simpleHash(String(text ?? '').slice(0, 512));
    this.outputHistory.push(hash);
    if (this.outputHistory.length > this.opts.stallWindow) {
      this.outputHistory = this.outputHistory.slice(-this.opts.stallWindow);
    }
  }

  /** 手动设置/增减递归深度 */
  enterRecursion(): void { this.recursionDepth++; }
  exitRecursion(): void { this.recursionDepth = Math.max(0, this.recursionDepth - 1); }

  /** 检测当前状态 */
  detect(): LoopDetectionResult {
    // ① 同工具+同参数+同结果的连续重复
    const sameCount = this.countConsecutiveSameCalls();
    if (sameCount >= this.opts.sameCallThreshold) {
      return {
        isLooping: true,
        loopType: 'same-tool-call',
        consecutiveCount: sameCount,
        suggestion: sameCount >= this.opts.sameCallThreshold * 2 ? 'escalate-to-user' : 'switch-method',
        modelHint: `【循环检测】你已连续 ${sameCount} 次用相同工具和参数执行相同操作，结果没有变化。请**立即换一种完全不同的方法**来完成这个任务，不要再重复相同操作。`,
        userMessage: '检测到重复操作，正在自动换方法…',
      };
    }

    // ② 输出停滞（连续 N 轮输出相同或为空）
    const stallCount = this.countConsecutiveStalledOutput();
    if (stallCount >= this.opts.stallWindow) {
      return {
        isLooping: true,
        loopType: 'stalled-output',
        consecutiveCount: stallCount,
        suggestion: stallCount >= this.opts.stallWindow * 2 ? 'escalate-to-user' : 'reduce-temperature',
        modelHint: `【停滞检测】最近 ${stallCount} 轮输出没有实质进展。请反思当前策略是否有误，尝试全新的思路或降低发散度（更精确、更直接地回答）。`,
        userMessage: '检测到回复停滞，正在调整策略…',
      };
    }

    // ③ 深度递归
    if (this.recursionDepth > 10) {
      return {
        isLooping: true,
        loopType: 'deep-recursion',
        consecutiveCount: this.recursionDepth,
        suggestion: this.recursionDepth > 20 ? 'escalate-to-user' : 'simplify-prompt',
        modelHint: '【递归检测】当前调用链路过深，请简化步骤，用最直接的方式完成任务的核心部分。',
        userMessage: '调用链路较深，正在简化…',
      };
    }

    return {
      isLooping: false,
      loopType: null,
      consecutiveCount: 0,
      suggestion: 'switch-method',
      modelHint: '',
      userMessage: '',
    };
  }

  /** 清空历史（任务切换/重试后调用） */
  reset(): void {
    this.history = [];
    this.outputHistory = [];
    this.recursionDepth = 0;
  }

  /** 统计连续相同调用次数 */
  private countConsecutiveSameCalls(): number {
    if (this.history.length < 2) return 0;
    const last = this.history[this.history.length - 1];
    if (!last) return 0;
    let count = 1;
    for (let i = this.history.length - 2; i >= 0; i--) {
      const cur = this.history[i];
      if (!cur) break;
      if (cur.tool === last.tool && cur.paramsHash === last.paramsHash && cur.resultHash === last.resultHash) {
        count++;
      } else {
        break;
      }
    }
    return count;
  }

  /** 统计连续停滞输出次数 */
  private countConsecutiveStalledOutput(): number {
    if (this.outputHistory.length < 2) return 0;
    const last = this.outputHistory[this.outputHistory.length - 1];
    if (last === undefined) return 0;
    let count = 1;
    for (let i = this.outputHistory.length - 2; i >= 0; i--) {
      if (this.outputHistory[i] === last) {
        count++;
      } else {
        break;
      }
    }
    return count;
  }
}
