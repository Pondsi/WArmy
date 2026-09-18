const fs = require('node:fs');
const p = 'C:/Users/p/.openclaw/workspace/大龙虾互动区/WArmy/packages/app-shell/src/electron-main.ts';
let s = fs.readFileSync(p, 'utf8');

if (s.includes('warmy:audit-log')) {
  console.log('already wired');
  process.exit(0);
}

// imports
s = s.replace(
  "import { CheckpointStore } from './checkpoint.js';",
  "import { CheckpointStore } from './checkpoint.js';\nimport { AuditLogger } from './audit.js';\nimport { SecureKeyStore } from './secure-keys.js';\nimport { KnowledgeArchiver, CleanupManager } from './archive-cleanup.js';\nimport { pickModelForUrgency, pickEmbeddingModel, type RoleModelConfig } from './model-roles.js';"
);

// instances
s = s.replace(
  "const metrics = new MetricsCollector();",
  `const metrics = new MetricsCollector();
let audit: AuditLogger | null = null;
let secureKeys: SecureKeyStore | null = null;
let archiver: KnowledgeArchiver | null = null;
let cleanup: CleanupManager | null = null;
let roleModels: RoleModelConfig = {};`
);

// bootstrap init
s = s.replace(
  "initAssetGovernor(path.join(userData, 'assets.json'));",
  `initAssetGovernor(path.join(userData, 'assets.json'));
  audit = new AuditLogger(userData);
  secureKeys = new SecureKeyStore(userData);
  archiver = new KnowledgeArchiver(userData);
  cleanup = new CleanupManager(userData);
  audit.log('app.start', { platform: process.platform });`
);

// IPC handlers
s += `

// ── 审计日志 ──
ipcMain.handle('warmy:audit-log', (_e, limit?: number) => ({
  ok: true,
  entries: audit?.read(limit || 50) || [],
}));
ipcMain.handle('warmy:audit-clear', () => {
  audit?.clear();
  return { ok: true };
});

// ── SafeStorage 密钥 ──
ipcMain.handle('warmy:secure-key-save', async (_e, payload: { providerId: string; apiKey: string }) => {
  await secureKeys?.save(payload.providerId, payload.apiKey);
  audit?.log('key.save', { providerId: payload.providerId });
  return { ok: true };
});
ipcMain.handle('warmy:secure-key-load', async (_e, providerId: string) => {
  const key = await secureKeys?.load(providerId);
  return { ok: !!key, key: key || null };
});

// ── KnowledgeArchiver ──
ipcMain.handle('warmy:archive-external', (_e, payload: { groupId: string; title: string; summary: string; anchors?: unknown[] }) => {
  const r = archiver?.archive({
    id: 'arc-' + Date.now(),
    groupId: payload.groupId,
    title: payload.title,
    summary: payload.summary,
    anchors: payload.anchors || [],
  });
  audit?.log('archive.external', { groupId: payload.groupId });
  return { ok: true, entry: r };
});
ipcMain.handle('warmy:archive-list', (_e, groupId?: string) => ({
  ok: true,
  entries: archiver?.list(groupId) || [],
}));

// ── CleanupManager ──
ipcMain.handle('warmy:cleanup-run', (_e, opts?: { checkpoints?: number }) => {
  const n = cleanup?.cleanCheckpoints(opts?.checkpoints || 20) || 0;
  const v = cleanup?.cleanVoice() || 0;
  audit?.log('cleanup.run', { checkpoints: n, voice: v });
  return { ok: true, checkpointsRemoved: n, voiceRemoved: v };
});

// ── 模型角色分配 ──
ipcMain.handle('warmy:role-models-set', (_e, roles: RoleModelConfig) => {
  roleModels = { ...roleModels, ...roles };
  audit?.log('roles.set', roles);
  return { ok: true, roles: roleModels };
});
ipcMain.handle('warmy:role-models-get', () => ({ ok: true, roles: roleModels }));

// ── 解散群组 ──
ipcMain.handle('warmy:group-dissolve', (_e, groupId: string) => {
  // 只有创建者可解散（简化：本机节点）
  const g = router.getGroup(groupId);
  if (!g) return { ok: false, error: 'no group' };
  // 从 router 移除
  const members = router.listMembers(groupId);
  for (const m of members) router.leave(groupId, m.id);
  audit?.log('group.dissolve', { groupId });
  return { ok: true };
});

// ── 允许库导出 ──
ipcMain.handle('warmy:export-allowlist', () => {
  const list = p1?.security.listAllowlist() || [];
  const dir = path.join(app.getPath('userData'), 'permissions');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'allowlist-export.json');
  fs.writeFileSync(file, JSON.stringify(list, null, 2), 'utf8');
  audit?.log('allowlist.export', { count: list.length });
  return { ok: true, path: file, count: list.length };
});

// ── dsh-app:// 自定义协议（零对外端口） ──
// 仅在 Electron 内部注册，不对外暴露端口
try {
  app.setAsDefaultProtocolClient('dsh-app');
} catch {
  /* noop */
}
`;

fs.writeFileSync(p, s);
console.log('main wired: audit/safeStorage/archiver/cleanup/roles/dissolve/export/protocol');
