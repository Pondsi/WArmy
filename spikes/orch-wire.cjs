const fs = require('node:fs');
const p = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/electron-main.ts';
let s = fs.readFileSync(p, 'utf8');

if (s.includes('xietiaoQunXiaoxi')) {
  console.log('already wired');
  process.exit(0);
}

// import orchestrator
s = s.replace(
  "import {yunxingDuanCunhuoZhixingqi, runExecutors} from './executor.js';",
  "import {yunxingDuanCunhuoZhixingqi, runExecutors} from './executor.js';\nimport {xietiaoQunXiaoxi, buildStatusCard} from './orchestrator.js';\nimport {MetricsCollector} from './metrics.js';"
);

// 已有 metrics 变量，不要重复声明
s = s.replace("import {MetricsCollector} from './metrics.js';\n", "");
s = s.replace(
  "import {xietiaoQunXiaoxi, buildStatusCard} from './orchestrator.js';\nimport {MetricsCollector} from './metrics.js';",
  "import {xietiaoQunXiaoxi, buildStatusCard} from './orchestrator.js';"
);

// 审批弹窗：pending approvals
s = s.replace(
  "const emailQueue: Array<{ to: string; subject: string; ti: string; ts: number }> = [];",
  `const emailQueue: Array<{ to: string; subject: string; ti: string; ts: number }> = [];
// 权限审批：渲染进程弹窗后回调
const pendingApprovals = new Map<string, { resolve: (d: { allowed: boolean; scope: string }) => void }>();
let approvalSeq = 0;`
);

// IPC 审批
s += `
// ── 3 权限审批弹窗 ──
ipcMain.handle('warmy:qingQiuPiZhun', (_e, req: { action: string; suggested?: string }) => {
  const id = 'ap' + ++approvalSeq;
  return new Promise((resolve) => {
    pendingApprovals.set(id, { resolve });
    win?.webContents.send('warmy:piZhunQingQiu', { id, action: req.action, suggested: req.suggested || 'once' });
    // 30s 超时 → 拒绝
    setTimeout(() => {
      const p = pendingApprovals.get(id);
      if (p) {
        pendingApprovals.delete(id);
        p.resolve({ allowed: false, scope: 'deny' });
      }
    }, 30000);
  });
});

ipcMain.handle('warmy:piZhunHuiYing', (_e, id: string, allowed: boolean, scope: string) => {
  const p = pendingApprovals.get(id);
  if (!p) return { ok: false };
  pendingApprovals.delete(id);
  p.resolve({ allowed, scope });
  return { ok: true };
});

// ── 4 自动检查点 ──
ipcMain.handle('warmy:checkpointZiDong', (_e, phase: 'round_start' | 'round_end', logSeq?: number) => {
  if (!checkpoints) return { ok: false };
  const memDir = path.join(app.getPath('userData'), 'memory');
  const jsonl = path.join(memDir, 'fast-memory.jsonl');
  const cp = checkpoints.create({
    phase,
    logSeq: logSeq || Date.now(),
    jsonlPath: fs.existsSync(jsonl) ? jsonl : undefined,
  });
  return { ok: true, checkpoint: cp, list: checkpoints.list() };
});

// ── 6 成本仪表盘 ──
ipcMain.handle('warmy:chengBenZhaiYao', () => {
  const m = metrics.summary();
  // 按最近用量估算（简化：0.001 元/1k token 量级示意）
  const estCost = ((m.promptTokens + m.completionTokens) / 1000) * 0.002;
  return {
    ok: true,
    turns: m.turns,
    promptTokens: m.promptTokens,
    completionTokens: m.completionTokens,
    cacheHitRate: m.cacheHitRate,
    avgDurationMs: m.avgDurationMs,
    estCostCny: +estCost.toFixed(4),
  };
});

// ── 1 值班编排闭环 ──
ipcMain.handle('warmy:qunXieTiao', async (_e, xiaoXi: { groupId: string; content: string; urgency?: string; userId?: string }) => {
  const instList = p1?.instances.list().map((x) => ({
    id: x.id,
    ming: x.name,
    status: x.status,
    dutyEligible: x.dutyEligible,
  })) || [];

  const result = await xietiaoQunXiaoxi(
    {
      router,
      board: board!,
      ccr,
      history: chatHistories,
      listInstances: () => instList,
      addEvent: (biaoTi, ti, groupId) => {
        knowledge?.upsertEntity({ id: 'grp-' + groupId, kind: 'project', ming: groupId, attrs: {}, anchors: [] });
        knowledge?.addEvent({
          id: 'ev-' + Date.now(),
          biaoTi,
          result: ti.slice(0, 400),
          entityIds: ['grp-' + groupId],
          anchors: [],
          ts: Date.now(),
        });
      },
    },
    {
      presetId: providerCfg.presetId,
      apiKey: providerCfg.apiKey,
      baseURL: providerCfg.baseURL || undefined,
      model: providerCfg.model,
    },
    {
      groupId: xiaoXi.groupId,
      userId: xiaoXi.userId,
      content: xiaoXi.content,
      urgency: xiaoXi.urgency as never,
    }
  );

  if (result.usage) {
    metrics.recordTurn({
      sessionId: xiaoXi.groupId,
      ts: Date.now(),
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      cacheHitTokens: result.usage.cacheHitTokens,
      cacheMissTokens: Math.max(0, result.usage.promptTokens - result.usage.cacheHitTokens),
      durationMs: 0,
      providerId: providerCfg.presetId,
      model: providerCfg.model,
    });
  }

  // 自动轮末检查点
  try {
    const memDir = path.join(app.getPath('userData'), 'memory');
    const jsonl = path.join(memDir, 'fast-memory.jsonl');
    checkpoints?.create({
      phase: 'round_end',
      logSeq: Date.now(),
      jsonlPath: fs.existsSync(jsonl) ? jsonl : undefined,
    });
  } catch { /* noop */ }

  return { ok: result.action !== 'error', ...result };
});
`;

fs.writeFileSync(p, s);
console.log('main orchestrator/approval/cost wired');
