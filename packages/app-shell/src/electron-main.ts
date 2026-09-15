/**
 * Electron 主进程 — 零原生模块
 */
import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createP1Runtime } from './runtime.js';
import { MemoryClient } from './memory-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let win: BrowserWindow | null = null;
let p1: Awaited<ReturnType<typeof createP1Runtime>> | null = null;
let memory: MemoryClient | null = null;

function memoryIpcEntry(): string {
  const candidates = [
    path.join(__dirname, '..', '..', 'memory-os', 'dist', 'ipc.js'),
    path.join(app.getAppPath(), 'node_modules', '@ccarmy', 'memory-os', 'dist', 'ipc.js'),
  ];
  const found = candidates.find((c) => fs.existsSync(c));
  return found ?? candidates[0] ?? '';
}

async function bootstrap() {
  p1 = await createP1Runtime({
    instancesRoot: path.join(app.getPath('userData'), 'instances'),
  });
  memory = new MemoryClient({
    nodePath: process.execPath,
    ipcEntry: memoryIpcEntry(),
    dataDir: path.join(app.getPath('userData'), 'memory'),
  });
  try {
    await memory.start();
  } catch (e) {
    console.error('memory service failed to start', e);
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 720,
    title: 'CCArmy 无限牛马',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  void win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(async () => {
  await bootstrap();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  void (async () => {
    try {
      await memory?.stop();
      await p1?.instances.stopAll();
      await p1?.teardown.shutdownAll();
    } catch {
      /* ignore */
    }
  })();
});

ipcMain.handle('ccarmy:hardware', () => p1?.instances.hardwareAdvice());
ipcMain.handle('ccarmy:list-instances', () => p1?.instances.list() ?? []);
ipcMain.handle(
  'ccarmy:spawn-instance',
  async (_e, cfg: { id: string; name: string; dutyEligible?: boolean }) => {
    if (!p1) throw new Error('runtime not ready');
    return p1.instances.spawn({
      config: {
        id: cfg.id,
        name: cfg.name,
        workspace: path.join(app.getPath('userData'), 'instances', cfg.id),
        dutyEligible: !!cfg.dutyEligible,
      },
    });
  }
);
ipcMain.handle('ccarmy:stop-instance', async (_e, id: string) => {
  await p1?.instances.stop(id);
  return true;
});
ipcMain.handle('ccarmy:security-mode', () => p1?.security.getMode());
ipcMain.handle(
  'ccarmy:set-security-mode',
  async (_e, mode: 'full' | 'normal' | 'strict') => {
    await p1?.security.setMode(mode);
    return p1?.security.getMode();
  }
);
ipcMain.handle('ccarmy:memory-recall', async (_e, q: string) => {
  try {
    return await memory?.recall(q);
  } catch (e) {
    return { cards: [], error: String(e) };
  }
});
ipcMain.handle('ccarmy:memory-append', async (_e, body: string) => {
  try {
    return await memory?.append({
      id: `m-${Date.now()}`,
      sessionId: 'ui',
      kind: 'message',
      body,
    });
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});
