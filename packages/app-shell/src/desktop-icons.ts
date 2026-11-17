/** R232：只读桌面图标快照。独立 PowerShell/UIAutomation 子进程，不在 Electron 主进程加载原生模块。 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export interface ZhuoMianTuBiao {
  id: string; name: string; filePath: string | null; ambiguous: boolean;
  rect: { x: number; y: number; width: number; height: number };
}
export interface TuBiaoKuaiZhao { ok: boolean; icons: ZhuoMianTuBiao[]; coordinateSpace: 'physical-pixels'; capturedAt: number; itemCount: number | null; truncated: boolean; error?: string }
export async function duZhuoMianTuBiao(signal?: AbortSignal): Promise<TuBiaoKuaiZhao> {
  const base: TuBiaoKuaiZhao = { ok: false, icons: [], coordinateSpace: 'physical-pixels', capturedAt: Date.now(), itemCount: null, truncated: false };
  if (process.platform !== 'win32') return { ...base, error: 'desktop-platform-unsupported' };
  const script = fileURLToPath(new URL('./desktop-icons.ps1', import.meta.url));
  const r = await new Promise<{ stdout: string; failed: boolean }>((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', script],
      { windowsHide: true, timeout: 15000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8', signal },
      (error, stdout) => resolve({ stdout: String(stdout || ''), failed: !!error }));
  });
  try {
    const raw = JSON.parse(r.stdout.replace(/^\uFEFF/, '')) as { ok?: boolean; error?: string; itemCount?: number; icons?: Array<{ name?: unknown; runtimeId?: unknown; path?: unknown; ambiguous?: boolean; rect?: Record<string, unknown> }>; truncated?: boolean };
    if (r.failed || !raw.ok || !Array.isArray(raw.icons)) return { ...base, error: signal?.aborted ? 'desktop-cancelled' : raw.error === 'desktop-accessibility-unavailable' ? raw.error : 'desktop-view-unavailable' };
    const icons: ZhuoMianTuBiao[] = [];
    for (const i of raw.icons) {
      const rect = i.rect;
      if (!rect || ![rect.x, rect.y, rect.width, rect.height].every((n) => typeof n === 'number' && Number.isFinite(n))) continue;
      const filePath = typeof i.path === 'string' && path.isAbsolute(i.path) ? path.resolve(i.path) : null;
      const id = createHash('sha256').update(JSON.stringify([i.runtimeId, i.name, filePath])).digest('hex').slice(0, 24);
      icons.push({ id, name: String(i.name || '').slice(0, 256), filePath, ambiguous: !!i.ambiguous,
        rect: rect as unknown as ZhuoMianTuBiao['rect'] });
    }
    return { ...base, ok: true, icons, itemCount: typeof raw.itemCount === 'number' ? raw.itemCount : null, truncated: !!raw.truncated, capturedAt: Date.now() };
  } catch { return { ...base, error: signal?.aborted ? 'desktop-cancelled' : 'desktop-bridge-unavailable' }; }
}
