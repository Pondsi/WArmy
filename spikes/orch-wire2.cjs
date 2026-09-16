const fs = require('node:fs');
const p = 'C:/Users/p/.openclaw/workspace/大龙虾互动区/CCArmy/packages/app-shell/src/electron-main.ts';
let s = fs.readFileSync(p, 'utf8');

if (s.includes('ccarmy:group-orchestrate')) {
  console.log('already has orchestrator ipc');
  process.exit(0);
}

// 1) import
if (!s.includes("from './orchestrator.js'")) {
  s = s.replace(
    "import { CheckpointStore } from './checkpoint.js';",
    "import { CheckpointStore } from './checkpoint.js';\nimport { orchestrateGroupMessage, buildStatusCard } from './orchestrator.js';"
  );
  console.log('import added');
}

// 2) approval pending map
if (!s.includes('pendingApprovals')) {
  s = s.replace(
    "const emailQueue: Array<{ to: string; subject: string; body: string; ts: number }> = [];",
    `const emailQueue: Array<{ to: string; subject: string; body: string; ts: number }> = [];
const pendingApprovals = new Map<string, { resolve: (d: { allowed: boolean; scope: string }) => void }>();
let approvalSeq = 0;`
  );
  console.log('approvals map added');
}

// 3) IPC block at end
if (!s.includes('ccarmy:request-approval')) {
  s += `

// ── 3 权限审批弹窗 ──
ipcMain.handle('ccarmy:request-approval', (_e, req: { action: string; suggested?: string }) => {
  const id = 'ap-' + ++approvalSeq;
  return new Promise((resolve) => {
    pendingApprovals.set(id, { resolve });
    win?.webContents.send('ccarmy:approval-request', { id, action: req.action, suggested: req.suggested || 'once' });
    setTimeout(() => {
      const p = pendingApprovals.get(id);
      if (p) {
        pendingApprovals.delete(id);
        p.resolve({ allowed: false, scope: 'deny' });
      }
    }, 30000);
  });
});

ipcMain.handle('ccarmy:approval-respond', (_e, id: string, allowed: boolean, scope: string) => {
  const p = pendingApprovals.get(id);
  if (!p) return { ok: false };
  pendingApprovals.delete(id);
  p.resolve({ allowed, scope });
  return { ok: true };
});

// ── 4 自动检查点 ──
ipcMain.handle('ccarmy:checkpoint-auto', (_e, phase: 'round_start' | 'round_end', logSeq?: number) => {
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
ipcMain.handle('ccarmy:cost-summary', () => {
  const m = metrics.summary();
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
ipcMain.handle('ccarmy:group-orchestrate', async (_e, msg: { groupId: string; content: string; urgency?: string; userId?: string }) => {
  const instList = (p1?.instances.list() || []).map((x) => ({
    id: x.id,
    name: x.name,
    status: x.status,
    dutyEligible: x.dutyEligible,
  }));

  const result = await orchestrateGroupMessage(
    {
      router,
      board: board!,
      ccr,
      history: chatHistories,
      listInstances: () => instList,
      addEvent: (title, body, groupId) => {
        knowledge?.upsertEntity({ id: 'grp-' + groupId, kind: 'project', name: groupId, attrs: {}, anchors: [] });
        knowledge?.addEvent({
          id: 'ev-' + Date.now(),
          title,
          result: body.slice(0, 400),
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
      groupId: msg.groupId,
      userId: msg.userId,
      content: msg.content,
      urgency: msg.urgency as never,
    }
  );

  if (result.usage) {
    metrics.recordTurn({
      sessionId: msg.groupId,
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
  console.log('ipc appended');
}

fs.writeFileSync(p, s);
console.log('done, has orchestrate:', s.includes('ccarmy:group-orchestrate'));
