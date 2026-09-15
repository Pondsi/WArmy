/**
 * Electron 主进程 — 零原生模块
 * 注意：Windows 中文路径下 fork 子进程可能乱码，memory ipc 先拷到 userData（ASCII）
 */
import { app, BrowserWindow, ipcMain, Menu, dialog, nativeTheme } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createP1Runtime } from './runtime.js';
import { MemoryClient } from './memory-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bootLog = path.join(app.getPath('userData'), 'ccarmy-boot.log');

function boot(msg: string) {
  try {
    fs.appendFileSync(bootLog, `${new Date().toISOString()} ${msg}\n`);
  } catch {
    /* ignore */
  }
}
boot(`main loaded dir=${__dirname}`);
// 去掉 File/Edit/View/Window/Help 应用菜单
Menu.setApplicationMenu(null);

let win: BrowserWindow | null = null;
let p1: Awaited<ReturnType<typeof createP1Runtime>> | null = null;
let memory: MemoryClient | null = null;

function prepareMemoryRuntime(): { ipcEntry: string; dataDir: string } {
  const userData = app.getPath('userData');
  const dataDir = path.join(userData, 'memory');
  const runtimeDir = path.join(userData, 'memory-runtime');
  const srcCandidates = [
    path.join(__dirname, '..', '..', 'memory-os', 'dist'),
    path.join(app.getAppPath(), 'node_modules', '@ccarmy', 'memory-os', 'dist'),
  ];
  const src = srcCandidates.find((d) => fs.existsSync(path.join(d, 'ipc.js')));
  if (!src) {
    boot(`memory ipc source missing among ${srcCandidates.join(' | ')}`);
    throw new Error('memory-os dist not found');
  }
  fs.mkdirSync(runtimeDir, { recursive: true });
  // 拷贝 dist 下全部 js（ipc + index + map 可选）
  for (const f of fs.readdirSync(src)) {
    if (!f.endsWith('.js') && !f.endsWith('.js.map')) continue;
    fs.copyFileSync(path.join(src, f), path.join(runtimeDir, f));
  }
  // 复制 package.json 便于 Node 解析 type=module
  const srcPkg = path.join(src, '..', 'package.json');
  if (fs.existsSync(srcPkg)) {
    fs.copyFileSync(srcPkg, path.join(runtimeDir, 'package.json'));
  }
  // 链接/复制 better-sqlite3：从 memory-os 的 node_modules 解析
  const memPkgDir = path.dirname(src);
  const nmSrc = path.join(memPkgDir, 'node_modules');
  const nmDst = path.join(runtimeDir, 'node_modules');
  if (fs.existsSync(nmSrc) && !fs.existsSync(nmDst)) {
    try {
      fs.symlinkSync(nmSrc, nmDst, 'junction');
    } catch {
      // 回退：不链，依赖 require 从包目录向上找（可能失败）
      boot('symlink node_modules failed');
    }
  }
  return { ipcEntry: path.join(runtimeDir, 'ipc.js'), dataDir };
}

async function bootstrap() {
  p1 = await createP1Runtime({
    instancesRoot: path.join(app.getPath('userData'), 'instances'),
  });
  boot('p1 ready');
}

function startMemoryAsync() {
  try {
    const { ipcEntry, dataDir } = prepareMemoryRuntime();
    boot(`memory ipc=${ipcEntry}`);
    memory = new MemoryClient({ nodePath: process.execPath, ipcEntry, dataDir });
    memory
      .start()
      .then(() => boot('memory ready'))
      .catch((e) => boot(`memory start fail ${String(e)}`));
  } catch (e) {
    boot(`memory prepare fail ${String(e)}`);
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'CCArmy',
    backgroundColor: '#ededed',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  void win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('ready-to-show', () => {
    win?.show();
    boot('window ready-to-show');
  });
}

app
  .whenReady()
  .then(async () => {
    boot('whenReady');
    createWindow();
    boot('window created');
    await bootstrap();
    startMemoryAsync();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  })
  .catch((e) => {
    boot(`whenReady error ${String(e)}`);
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

// ── i18n：文案全部在独立 json，中文产品名「无限牛马」，其余「CCArmy」 ──
function i18nDir(): string {
  const candidates = [
    path.join(__dirname, 'i18n'),
    path.join(__dirname, '..', 'src', 'i18n'),
  ];
  const found = candidates.find((d) => fs.existsSync(path.join(d, 'zh-CN.json')));
  return found ?? candidates[0]!;
}

ipcMain.handle('ccarmy:i18n', (_e, locale: string) => {
  const loc = locale?.startsWith('zh') ? 'zh-CN' : 'en-US';
  const file = path.join(i18nDir(), `${loc}.json`);
  let strings: Record<string, string> = {};
  try {
    strings = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    strings = {};
  }
  // 产品名：仅中文显示「无限牛马」
  strings['app.displayName'] = loc === 'zh-CN' ? (strings['app.zhName'] || '无限牛马') : (strings['app.enName'] || 'CCArmy');
  if (loc !== 'zh-CN') {
    // 非中文时列表等处不再用中文名
    strings['app.zhName'] = strings['app.enName'] || 'CCArmy';
  }
  win?.setTitle(strings['app.displayName'] || 'CCArmy');
  return { locale: loc, strings, displayName: strings['app.displayName'] };
});

ipcMain.handle('ccarmy:locale-info', () => {
  const sys = app.getLocale();
  return { system: sys, isZh: sys.startsWith('zh') };
});

// ── 主题 ──
ipcMain.handle('ccarmy:set-theme-source', (_e, source: 'system' | 'light' | 'dark') => {
  nativeTheme.themeSource = source === 'system' ? 'system' : source;
  return { shouldUseDarkColors: nativeTheme.shouldUseDarkColors, themeSource: nativeTheme.themeSource };
});
ipcMain.handle('ccarmy:theme-info', () => ({
  shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
  themeSource: nativeTheme.themeSource,
}));

// ── 拉取供应商模型列表（OpenAI 兼容 /models） ──
ipcMain.handle(
  'ccarmy:list-models',
  async (_e, cfg: { protocol: string; baseURL: string; apiKey?: string }) => {
    try {
      const { createProvider } = await import('@ccarmy/providers');
      const p = createProvider(
        (cfg.protocol as 'openai-compatible' | 'anthropic' | 'ollama') || 'openai-compatible',
        { baseURL: cfg.baseURL, apiKey: cfg.apiKey }
      );
      const models = await p.listModels();
      return { ok: true, models };
    } catch (e) {
      return { ok: false, models: [], error: String((e as Error).message || e) };
    }
  }
);

// ── 选择本地提示音文件 ──
ipcMain.handle('ccarmy:pick-sound', async () => {
  if (!win) return { ok: false };
  const r = await dialog.showOpenDialog(win, {
    title: 'Select sound',
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return { ok: false };
  return { ok: true, path: r.filePaths[0] };
});

// ── 检查更新（占位） ──
ipcMain.handle('ccarmy:check-update', async () => {
  return { ok: true, upToDate: true, version: '0.1.0' };
});

// ── 选择附件文件 ──
ipcMain.handle('ccarmy:pick-file', async () => {
  if (!win) return { ok: false };
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return { ok: false };
  return { ok: true, path: r.filePaths[0] };
});
