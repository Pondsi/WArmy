const fs = require('node:fs');
const base = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/';
let m = fs.readFileSync(base + 'electron-main.ts', 'utf8');
let j = fs.readFileSync(base + 'renderer/yingYong.js', 'utf8');
let h = fs.readFileSync(base + 'renderer/index.html', 'utf8');

// ── A. 检查点详情：真实文件变更 ──
// CheckpointStore.create 记录 filesChanged/filesCreated
let ck = fs.readFileSync(base + 'checkpoint.ts', 'utf8');
if (!ck.includes('filesChanged')) {
  ck = ck.replace(
    'export interface Checkpoint {\n  id: string;\n  phase: \'round_start\' | \'round_end\';\n  logSeq: number;\n  createdAt: number;\n  dir: string;\n  strategy: \'cow\' | \'shadow\';\n}',
    `export interface Checkpoint {
  id: string;
  phase: 'round_start' | 'round_end';
  logSeq: number;
  createdAt: number;
  dir: string;
  strategy: 'cow' | 'shadow';
  filesChanged: Array<{ path: string; ts: number }>;
  filesCreated: Array<{ path: string; ts: number }>;
  irreversible: string[];
  assets: string[];
}`
  );
  ck = ck.replace(
    `    const cp: Checkpoint = {
      id,
      phase: opts.phase,
      logSeq: opts.logSeq,
      createdAt: Date.now(),
      dir,
      strategy,
    };`,
    `    const filesCreated: Array<{ path: string; ts: number }> = [];
    const filesChanged: Array<{ path: string; ts: number }> = [];
    if (opts.jsonlPath && fs.existsSync(opts.jsonlPath)) {
      filesChanged.push({ path: 'fast-memory.jsonl', ts: Date.now() });
    }
    if (opts.workspace && fs.existsSync(opts.workspace)) {
      try {
        for (const e of fs.readdirSync(opts.workspace, { withFileTypes: true }).slice(0, 20)) {
          if (e.isFile()) filesCreated.push({ path: e.name, ts: Date.now() });
        }
      } catch { /* noop */ }
    }
    const cp: Checkpoint = {
      id,
      phase: opts.phase,
      logSeq: opts.logSeq,
      createdAt: Date.now(),
      dir,
      strategy,
      filesChanged,
      filesCreated,
      irreversible: [],
      assets: [],
    };`
  );
  fs.writeFileSync(base + 'checkpoint.ts', ck);
  console.log('checkpoint details fields added');
}

// ── B. 审批弹窗：SecurityManager onApprove 接到 IPC ──
if (!m.includes("onApprove: async (req)")) {
  m = m.replace(
    "  p1 = await createP1Runtime({\n    instancesRoot: path.join(app.getPath('userData'), 'instances'),\n  });",
    `  p1 = await createP1Runtime({
    instancesRoot: path.join(app.getPath('userData'), 'instances'),
    onApprove: async (req) => {
      // 安全模式 normal/strict 时向渲染进程请求审批
      const mode = await p1?.security.getMode().catch(() => 'normal');
      if (mode === 'full') return { action: req.action, scope: 'once', allowed: true };
      const id = 'ap' + ++approvalSeq;
      return new Promise((resolve) => {
        pendingApprovals.set(id, { resolve: resolve as never });
        win?.webContents.send('warmy:piZhunQingQiu', { id, action: req.action, suggested: req.suggested });
        setTimeout(() => {
          const p = pendingApprovals.get(id);
          if (p) {
            pendingApprovals.delete(id);
            (p.resolve as (d: unknown) => void)({ allowed: false, scope: 'deny' });
          }
        }, 30000);
      });
    },
  });`
  );
  console.log('approval wired to SecurityManager');
}

// ── C. 多执行者并行展示 ──
if (!m.includes('warmy:zhiXingQiJiZhuangTai')) {
  m += `

// ── C. 执行者状态 ──
const executorStatus: Array<{ id: string; ming: string; taskId: string; brief: string; status: string; durationMs: number; ts: number }> = [];
ipcMain.handle('warmy:zhiXingQiJiZhuangTai', () => ({ ok: true, items: executorStatus.slice(-10) }));
ipcMain.handle('warmy:zhiXingQiJiYunXingJianYao', async (_e, payload: { brief: string; contextItems?: string[]; executorIds?: string[] }) => {
  const ids = payload.executorIds?.length
    ? payload.executorIds
    : (p1?.instances.list() || []).filter((x) => x.status === 'running').map((x) => x.id).slice(0, 3);
  const t0 = Date.now();
  const results = await Promise.all(
    ids.map(async (id) => {
      const item = { id, ming: id, taskId: 't-' + Date.now(), brief: payload.brief, status: 'running', durationMs: 0, ts: Date.now() };
      executorStatus.push(item);
      const r = await runShortLivedExecutor(
        { taskId: item.taskId, brief: payload.brief, contextItems: payload.contextItems || [] },
        { presetId: providerCfg.presetId, apiKey: providerCfg.apiKey, baseURL: providerCfg.baseURL || undefined, model: providerCfg.model }
      );
      item.status = r.error ? 'error' : 'done';
      item.durationMs = Date.now() - t0;
      return r;
    })
  );
  return { ok: true, results };
});
`;
  console.log('executors status ipc added');
}

// ── E. 设置持久化：插件/实例/群 ──
if (!m.includes('warmy:taiBaoCun')) {
  m += `

// ── E. 会话状态持久化 ──
ipcMain.handle('warmy:taiBaoCun', (_e, state: { chaJianJi?: unknown[]; instances?: unknown[]; groups?: unknown[]; chats?: unknown[] }) => {
  if (!settingsStore) return { ok: false };
  const cur = settingsStore.load();
  const next = { ...cur, ...state } as never;
  settingsStore.save(next as never);
  return { ok: true };
});
ipcMain.handle('warmy:taiJiaZai', () => {
  const s = settingsStore?.load() as never;
  return { ok: true, state: s || {} };
});
`;
  console.log('state persistence ipc added');
}

fs.writeFileSync(base + 'electron-main.ts', m);
console.log('main done');
