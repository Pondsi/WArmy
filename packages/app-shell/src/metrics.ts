/**
 * 运行指标：对话轮次、CCR 压缩比、Provider 用量（缓存命中等）
 * 对应 ADR 6.5 性能监控埋点
 */
export interface LunciZhibiao {
  sessionId: string;
  ts: number;
  promptTokens: number;
  completionTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  durationMs: number;
  providerId: string;
  /**
   * 供应商**显示名**（用户填的那个标签，例如「本地 Ollama」）。
   * 真机反馈：总看板"按供应商"如果能显示人看得懂的名字更靠谱；id 只作兜底。
   */
  providerName?: string;
  model: string;
}

export interface CcrMetric {
  ts: number;
  kind: string;
  originalBytes: number;
  compressedBytes: number;
}

/**
 * 有界渲染视图指标（ADR 002 §6）。
 * viewBytes 恒定 ≤ budgetChars 且不随 logBytes 上涨，是「不变量 #2 是否退化」的哨兵。
 * 单位是字符（与 context-renderer 的 budgetChars 同单位）。
 */
export interface ShituZhibiao {
  ts: number;
  sessionId: string;
  logEntries: number;
  logBytes: number;
  viewBytes: number;
  budgetChars: number;
  pointers: number;
}

/**
 * 工具调用指标（ADR 002 §9.4 待办 2）。
 * 观测面：模型是否真的在解引用被省略的历史、有没有越界、有没有降级。
 */
export interface GongjuDiaoyongZhibiao {
  ts: number;
  sessionId: string;
  round: number;
  tool: string;
  ok: boolean;
  /** 回给模型的文本长度（字符） */
  chars: number;
  ms: number;
}

/** 一次 chat-send 的工具循环总体结果 */
export interface GongjuXunhuanZhibiao {
  ts: number;
  sessionId: string;
  qingQiuJi: number;
  lunShu: number;
  gongJuDiaoYongJi: number;
  toolResultChars: number;
  degraded: boolean;
  tingZhiYuanYin: string;
}

export class ZhiBiaoCaiJiQi {
  private turns: LunciZhibiao[] = [];
  private ccr: CcrMetric[] = [];
  private views: ShituZhibiao[] = [];
  private toolCallsLog: GongjuDiaoyongZhibiao[] = [];
  private toolLoops: GongjuXunhuanZhibiao[] = [];

  recordTurn(m: LunciZhibiao): void {
    this.turns.push(m);
    if (this.turns.length > 500) this.turns.shift();
  }

  recordCcr(m: CcrMetric): void {
    this.ccr.push(m);
    if (this.ccr.length > 500) this.ccr.shift();
  }

  recordView(m: ShituZhibiao): void {
    this.views.push(m);
    if (this.views.length > 500) this.views.shift();
  }

  recordToolCall(m: GongjuDiaoyongZhibiao): void {
    this.toolCallsLog.push(m);
    if (this.toolCallsLog.length > 500) this.toolCallsLog.shift();
  }

  recordToolLoop(m: GongjuXunhuanZhibiao): void {
    this.toolLoops.push(m);
    if (this.toolLoops.length > 500) this.toolLoops.shift();
  }

  lastViews(n = 20): ShituZhibiao[] {
    return this.views.slice(-n);
  }

  lastToolCalls(n = 20): GongjuDiaoyongZhibiao[] {
    return this.toolCallsLog.slice(-n);
  }

  summary() {
    const t = this.turns;
    const mingZhong = t.reduce((s, x) => s + x.cacheHitTokens, 0);
    const weiMingZhong = t.reduce((s, x) => s + x.cacheMissTokens, 0);
    const total = mingZhong + weiMingZhong;
    const ccrIn = this.ccr.reduce((s, x) => s + x.originalBytes, 0);
    const ccrOut = this.ccr.reduce((s, x) => s + x.compressedBytes, 0);
    // 有界视图哨兵：最近一次 + 观测区间内的极值（恒定性证据）
    const lastView = this.views.length ? this.views[this.views.length - 1]! : null;
    const viewValues = this.views.map((x) => x.viewBytes);
    return {
      turns: t.length,
      avgDurationMs: t.length ? Math.round(t.reduce((s, x) => s + x.durationMs, 0) / t.length) : 0,
      promptTokens: t.reduce((s, x) => s + x.promptTokens, 0),
      completionTokens: t.reduce((s, x) => s + x.completionTokens, 0),
      cacheHitRate: total ? +(mingZhong / total).toFixed(4) : 0,
      cacheHitTokens: mingZhong,
      cacheMissTokens: weiMingZhong,
      ccrOriginalBytes: ccrIn,
      ccrCompressedBytes: ccrOut,
      ccrRatio: ccrIn ? +(ccrOut / ccrIn).toFixed(4) : 1,
      /** ADR 002：视图有界哨兵（字符数） */
      viewSamples: this.views.length,
      viewBytes: lastView ? lastView.viewBytes : 0,
      logBytes: lastView ? lastView.logBytes : 0,
      viewBudgetChars: lastView ? lastView.budgetChars : 0,
      viewBytesMin: viewValues.length ? Math.min(...viewValues) : 0,
      viewBytesMax: viewValues.length ? Math.max(...viewValues) : 0,
      logEntries: lastView ? lastView.logEntries : 0,
      viewPointers: lastView ? lastView.pointers : 0,
      /** ADR 002 §9.4 待办 2：工具调用观测（模型是否真的 recall/retrieve 了） */
      gongJuDiaoYongJi: this.toolCallsLog.length,
      toolCallsOk: this.toolCallsLog.filter((x) => x.ok).length,
      toolChars: this.toolCallsLog.reduce((s, x) => s + x.chars, 0),
      toolTurns: this.toolLoops.length,
      toolDegradedTurns: this.toolLoops.filter((x) => x.degraded).length,
      toolStopReasons: this.toolLoops.reduce<Record<string, number>>((leiJi, x) => {
        leiJi[x.tingZhiYuanYin] = (leiJi[x.tingZhiYuanYin] || 0) + 1;
        return leiJi;
      }, {}),
      /** 工具循环从未越界（请求数受 maxRounds 约束） */
      toolLoopBounded: this.toolLoops.every((x) => x.qingQiuJi <= 9 && x.lunShu <= 8),
      /** 历史观测里 viewBytes 从未越过预算 → 不变量 #2 成立 */
      viewBounded: this.views.every((x) => x.viewBytes <= x.budgetChars),
      /** ADR：命中率 >95% 为健康；工具输出压缩比目标可观察 */
      healthyCache: total > 0 ? mingZhong / total >= 0.9 : true,
    };
  }

  lastTurns(n = 20) {
    return this.turns.slice(-n);
  }

  /**
   * **工具调用可观测**：次数 / 成功率 / 平均耗时 / 各工具分布 / 停止原因。
   *
   * 为什么单开一个：`summary()` 给的是"总数"，排查时要的是"哪个工具最费、失败率多高、
   * 这一轮为什么停"。这两件事解决的不是一个问题，所以分开给。
   * @param sessionId 只统计某个会话（不给=全部）
   */
  toolStats(sessionId?: string) {
    const calls = sessionId ? this.toolCallsLog.filter((x) => x.sessionId === sessionId) : this.toolCallsLog;
    const loops = sessionId ? this.toolLoops.filter((x) => x.sessionId === sessionId) : this.toolLoops;
    const byTool: Record<string, { n: number; ok: number; chars: number; ms: number }> = {};
    for (const c of calls) {
      const t = byTool[c.tool] || (byTool[c.tool] = { n: 0, ok: 0, chars: 0, ms: 0 });
      t.n++; if (c.ok) t.ok++; t.chars += c.chars; t.ms += c.ms;
    }
    const okN = calls.filter((x) => x.ok).length;
    const msArr = calls.map((x) => x.ms).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    const p = (q: number) => (msArr.length ? msArr[Math.min(msArr.length - 1, Math.floor(msArr.length * q))]! : 0);
    return {
      calls: calls.length,
      okRate: calls.length ? +(okN / calls.length).toFixed(4) : 1,
      avgMs: calls.length ? Math.round(msArr.reduce((s, v) => s + v, 0) / calls.length) : 0,
      p50Ms: p(0.5),
      p95Ms: p(0.95),
      maxMs: msArr.length ? msArr[msArr.length - 1]! : 0,
      chars: calls.reduce((s, x) => s + x.chars, 0),
      byTool: Object.fromEntries(Object.entries(byTool).map(([k, v]) => [k, { ...v, okRate: v.n ? +(v.ok / v.n).toFixed(3) : 1, avgMs: v.n ? Math.round(v.ms / v.n) : 0 }])),
      loops: loops.length,
      degradedLoops: loops.filter((x) => x.degraded).length,
      stopReasons: loops.reduce<Record<string, number>>((lei, x) => { lei[x.tingZhiYuanYin] = (lei[x.tingZhiYuanYin] || 0) + 1; return lei; }, {}),
      /** 平均每轮工具调用数（预算是"每轮次数"的另一把尺子，用来对照） */
      avgCallsPerLoop: loops.length ? +(calls.length / loops.length).toFixed(2) : 0,
    };
  }
}
