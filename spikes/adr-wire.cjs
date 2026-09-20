const fs = require('node:fs');
const p = 'C:/Users/p/.openclaw/workspace/大龙虾互动区/WArmy/packages/app-shell/src/electron-main.ts';
let s = fs.readFileSync(p, 'utf8');

if (!s.includes('yunxingDuanCunhuoZhixingqi')) {
  s = s.replace(
    "import {JianChaDianCang} from './checkpoint.js';",
    "import {JianChaDianCang} from './checkpoint.js';\nimport {yunxingDuanCunhuoZhixingqi, runExecutors} from './executor.js';\nimport {chuShiZiChanGuanLi, retrieveAssetsForChat, zhuCeLiaoTianZiChan, jiLuZiChanShiYong, qingLiZiChan} from './asset-wire.js';"
  );

  // bootstrap: init asset governor
  s = s.replace(
    "boot('board/knowledge/checkpoints/account/settings/sync/mesh ready');",
    "chuShiZiChanGuanLi(path.join(userData, 'assets.json'));\n  boot('board/knowledge/checkpoints/account/sync/mesh/assets ready');"
  );

  // IPC: executor + assets + knowledge-from-chat
  const ipc = `
// ── P5 短命执行者 ──
ipcMain.handle('warmy:executor-run', async (_e, task: { taskId?: string; brief: string; contextItems?: string[] }) => {
  if (!providerCfg.apiKey && providerCfg.protocol !== 'ollama') {
    return { ok: false, error: 'no key' };
  }
  const r = await yunxingDuanCunhuoZhixingqi(
    {
      taskId: task.taskId || 'x-' + Date.now(),
      brief: task.brief,
      contextItems: task.contextItems || [],
    },
    {
      presetId: providerCfg.presetId,
      apiKey: providerCfg.apiKey,
      baseURL: providerCfg.baseURL || undefined,
      model: providerCfg.model,
    }
  );
  return { ok: !r.error, ...r };
});

ipcMain.handle('warmy:executor-batch', async (_e, tasks: Array<{ taskId?: string; brief: string; contextItems?: string[] }>) => {
  if (!providerCfg.apiKey && providerCfg.protocol !== 'ollama') {
    return { ok: false, error: 'no key' };
  }
  const rs = await runExecutors(
    tasks.map((t) => ({ taskId: t.taskId || 'x-' + Date.now(), brief: t.brief, contextItems: t.contextItems || [] })),
    {
      presetId: providerCfg.presetId,
      apiKey: providerCfg.apiKey,
      baseURL: providerCfg.baseURL || undefined,
      model: providerCfg.model,
    }
  );
  return { ok: true, results: rs };
});

// ── P7 资产治理 ──
ipcMain.handle('warmy:assets-retrieve', (_e, opts?: { scope?: string; strict?: boolean }) => ({
  ok: true,
  assets: retrieveAssetsForChat({ scope: opts?.scope as never, strict: opts?.strict }),
}));

ipcMain.handle('warmy:assets-register', (_e, a: { id: string; title: string; body: string; scope?: string }) => {
  zhuCeLiaoTianZiChan({ id: a.id, title: a.title, body: a.body, scope: a.scope as never });
  return { ok: true };
});

ipcMain.handle('warmy:assets-feedback', (_e, id: string, good: boolean) => {
  jiLuZiChanShiYong(id, good);
  return { ok: true };
});

ipcMain.handle('warmy:assets-sweep', () => ({ ok: true, n: qingLiZiChan() }));

// ── P6 知识库：从对话写入 ──
ipcMain.handle('warmy:kb-from-chat', (_e, payload: { sessionId: string; title: string; body: string }) => {
  knowledge?.upsertEntity({
    id: 'sess-' + payload.sessionId,
    kind: 'project',
    name: payload.sessionId,
    attrs: {},
    anchors: [],
  });
  const evId = 'ev-' + Date.now();
  knowledge?.addEvent({
    id: evId,
    title: payload.title,
    result: payload.body.slice(0, 500),
    entityIds: ['sess-' + payload.sessionId],
    anchors: [],
    ts: Date.now(),
  });
  zhuCeLiaoTianZiChan({
    id: evId,
    title: payload.title,
    body: payload.body,
    scope: 'session',
  });
  return { ok: true, eventId: evId };
});
`;
  s = s + '\n' + ipc + '\n';
  fs.writeFileSync(p, s);
  console.log('main ipc added');
} else {
  console.log('already present');
}
