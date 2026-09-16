/**
 * 运行指标：对话轮次、CCR 压缩比、Provider 用量（缓存命中等）
 * 对应 ADR 6.5 性能监控埋点
 */
export interface TurnMetric {
  sessionId: string;
  ts: number;
  promptTokens: number;
  completionTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  durationMs: number;
  providerId: string;
  model: string;
}

export interface CcrMetric {
  ts: number;
  kind: string;
  originalBytes: number;
  compressedBytes: number;
}

export class MetricsCollector {
  private turns: TurnMetric[] = [];
  private ccr: CcrMetric[] = [];

  recordTurn(m: TurnMetric): void {
    this.turns.push(m);
    if (this.turns.length > 500) this.turns.shift();
  }

  recordCcr(m: CcrMetric): void {
    this.ccr.push(m);
    if (this.ccr.length > 500) this.ccr.shift();
  }

  summary() {
    const t = this.turns;
    const hit = t.reduce((s, x) => s + x.cacheHitTokens, 0);
    const miss = t.reduce((s, x) => s + x.cacheMissTokens, 0);
    const total = hit + miss;
    const ccrIn = this.ccr.reduce((s, x) => s + x.originalBytes, 0);
    const ccrOut = this.ccr.reduce((s, x) => s + x.compressedBytes, 0);
    return {
      turns: t.length,
      avgDurationMs: t.length ? Math.round(t.reduce((s, x) => s + x.durationMs, 0) / t.length) : 0,
      promptTokens: t.reduce((s, x) => s + x.promptTokens, 0),
      completionTokens: t.reduce((s, x) => s + x.completionTokens, 0),
      cacheHitRate: total ? +(hit / total).toFixed(4) : 0,
      cacheHitTokens: hit,
      cacheMissTokens: miss,
      ccrOriginalBytes: ccrIn,
      ccrCompressedBytes: ccrOut,
      ccrRatio: ccrIn ? +(ccrOut / ccrIn).toFixed(4) : 1,
      /** ADR：命中率 >95% 为健康；工具输出压缩比目标可观察 */
      healthyCache: total > 0 ? hit / total >= 0.9 : true,
    };
  }

  lastTurns(n = 20) {
    return this.turns.slice(-n);
  }
}
