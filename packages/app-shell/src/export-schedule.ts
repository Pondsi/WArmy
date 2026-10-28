/**
 * 定时导出（第 107 轮）。
 *
 * 只做三件事：按配置判断"到点没有"、生成一份可核对的数据指纹、把同一份数据导出到每个启用位置。
 * 真正的加密/范围/是否用主密钥仍由 DataVault 负责；这里不复制它的打包逻辑。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DataVault } from './data-vault.js';
import type { DingShiDaoChu } from './settings-store.js';

export const EXPORT_CATEGORIES = ['chat', 'knowledge', 'contacts', 'settings', 'account', 'logs'] as const;
export const EXPORT_LOCATION_MAX = 10;
/** 用户按秒输入；只拒绝 0/负数，1 秒也允许（不再强制 5 分钟起） */
export const EXPORT_INTERVAL_MIN = 1000;
export const EXPORT_INTERVAL_MAX = 365 * 24 * 60 * 60 * 1000;

export interface DingShiDaoChuDeps {
  vault: DataVault;
  load: () => DingShiDaoChu | undefined;
  save: (next: DingShiDaoChu) => void;
  /** 选择性导出的逻辑文件（消息/知识/元数据），调用方负责清理 */
  buildExtraFiles?: (cfg: DingShiDaoChu) => Promise<Array<{ rel: string; size: number; mtime: number; abs?: string }>>;
  /** 访问网络位置前应用凭证；返回清理函数（导出后撤销临时映射） */
  prepareLocation?: (loc: { path: string; username?: string; credentialSet?: boolean }) => Promise<{ ok: boolean; error?: string; cleanup?: () => Promise<void> }>;
  /** 当前账号的稳定恢复根（第 111 轮：加密包改用它，不再另设导出口令） */
  getKroot?: () => Buffer | null;
  appVersion?: () => string;
  audit?: (op: string, detail: Record<string, unknown>) => void;
  /** 主进程 → 所有窗口 */
  broadcast?: (event: string, data: Record<string, unknown>) => void;
  now?: () => number;
}

export interface DingShiDaoChuRunResult {
  ok: boolean;
  skipped?: 'disabled' | 'not-due' | 'unchanged' | 'no-location' | 'credential-missing' | 'vault-locked' | 'credential-unavailable';
  status: string;
  paths: string[];
  files: number;
  bytes: number;
  fingerprint: string;
  nextAt: number;
}

export function quanBuLeiBie(): string[] {
  return [...EXPORT_CATEGORIES];
}

/** 读盘配置统一收敛：坏值不猜、落到安全默认；位置最多 10 个且去重。 */
export function guiYiDingShiDaoChu(raw: unknown, now = Date.now()): DingShiDaoChu {
  const x = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const locations: Array<{ path: string; enabled: boolean; username?: string; credentialSet?: boolean }> = [];
  const seen = new Set<string>();
  for (const it of Array.isArray(x.locations) ? x.locations : []) {
    if (!it || typeof it !== 'object') continue;
    const p = String((it as { path?: unknown }).path || '').trim();
    if (!p || seen.has(p) || locations.length >= EXPORT_LOCATION_MAX) continue;
    seen.add(p);
    locations.push({
      path: p,
      enabled: (it as { enabled?: unknown }).enabled !== false,
      ...(String((it as { username?: unknown }).username || '').trim()
        ? { username: String((it as { username?: unknown }).username || '').trim().slice(0, 200) } : {}),
      ...((it as { credentialSet?: unknown }).credentialSet === true ? { credentialSet: true } : {}),
    });
  }
  const include = (Array.isArray(x.include) ? x.include : [])
    .map((s) => String(s))
    .filter((s, i, a) => (EXPORT_CATEGORIES as readonly string[]).includes(s) && a.indexOf(s) === i);
  const cycles = Math.max(0, Math.min(99999, Math.floor(Number(x.cycles) || 0)));
  const intervalMs = Number.isFinite(Number(x.intervalMs)) && x.intervalMs !== undefined && x.intervalMs !== null && x.intervalMs !== ''
    ? Math.max(EXPORT_INTERVAL_MIN, Math.min(EXPORT_INTERVAL_MAX, Math.floor(Number(x.intervalMs))))
    : 24 * 60 * 60 * 1000;
  const nextAt = Number.isFinite(Number(x.nextAt)) && Number(x.nextAt) > 0 ? Math.floor(Number(x.nextAt)) : now + 60 * 60 * 1000;
  const scopeRaw = x.scope && typeof x.scope === 'object' ? x.scope as Record<string, unknown> : {};
  const chatIds = (Array.isArray(scopeRaw.chatIds) ? scopeRaw.chatIds : [])
    .map((s) => String(s || '').trim()).filter(Boolean)
    .filter((s, i, a) => a.indexOf(s) === i).slice(0, 500);
  const kbLayers = (Array.isArray(scopeRaw.kbLayers) ? scopeRaw.kbLayers : [])
    .map((s) => String(s || '')).filter((s, i, a) => ['session', 'internal', 'private', 'none'].includes(s) && a.indexOf(s) === i);
  const from = Number(scopeRaw.from) > 0 ? Math.floor(Number(scopeRaw.from)) : 0;
  const to = Number(scopeRaw.to) > 0 ? Math.floor(Number(scopeRaw.to)) : 0;
  const scope = (chatIds.length || kbLayers.length || from || to)
    ? { ...(chatIds.length ? { chatIds } : {}), ...(kbLayers.length ? { kbLayers } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) }
    : undefined;
  return {
    enabled: x.enabled === true,
    nextAt,
    cycles,
    intervalMs,
    skipUnchanged: x.skipUnchanged !== false,
    encrypt: x.encrypt !== false,
    requireCredential: false,
    locations,
    include: include.length ? include : quanBuLeiBie(),
    ...(scope ? { scope } : {}),
    runsDone: Math.max(0, Math.floor(Number(x.runsDone) || 0)),
    ...(Number(x.lastRunAt) > 0 ? { lastRunAt: Math.floor(Number(x.lastRunAt)) } : {}),
    ...(typeof x.lastStatus === 'string' ? { lastStatus: x.lastStatus } : {}),
    ...(typeof x.lastFingerprint === 'string' ? { lastFingerprint: x.lastFingerprint } : {}),
    ...(Array.isArray(x.lastPaths) ? { lastPaths: x.lastPaths.map((p) => String(p)).slice(0, EXPORT_LOCATION_MAX) } : {}),
  };
}

export function daoChuZhiWen(files: Array<{ rel: string; size: number; mtime: number }>): string {
  const h = crypto.createHash('sha256');
  for (const f of files.slice().sort((a, b) => a.rel.localeCompare(b.rel))) {
    h.update(f.rel); h.update('\0'); h.update(String(f.size)); h.update('\0'); h.update(String(f.mtime)); h.update('\n');
  }
  return h.digest('hex');
}

export function shiJianCi(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function paiXiaYiCi(cfg: DingShiDaoChu, now = Date.now()): DingShiDaoChu {
  const runsDone = (cfg.runsDone || 0) + 1;
  const haiYao = cfg.cycles === 0 || runsDone < cfg.cycles;
  return {
    ...cfg,
    runsDone,
    enabled: haiYao ? cfg.enabled : false,
    nextAt: haiYao ? now + cfg.intervalMs : 0,
    lastRunAt: now,
  };
}

/**
 * 到点就执行一次（每个启用的位置各一份）。`force` 只用于用户点「立即导出」，
 * 不改变"循环几次/下次时间"的语义。
 */
export async function zhiXingDingShiDaoChu(deps: DingShiDaoChuDeps, opts: { force?: boolean } = {}): Promise<DingShiDaoChuRunResult> {
  const now = deps.now ? deps.now() : Date.now();
  const cfg = guiYiDingShiDaoChu(deps.load(), now);
  const base: DingShiDaoChuRunResult = { ok: false, status: 'idle', paths: [], files: 0, bytes: 0, fingerprint: '', nextAt: cfg.nextAt };
  if (!cfg.enabled) return { ...base, skipped: 'disabled', status: 'disabled' };
  if (!opts.force && now < cfg.nextAt) return { ...base, skipped: 'not-due', status: 'not-due' };
  const locations = cfg.locations.filter((x) => x.enabled && x.path);
  if (!locations.length) {
    const next = paiXiaYiCi({ ...cfg, lastStatus: 'no-location' }, now);
    deps.save(next);
    deps.audit?.('export.schedule.no-location', { nextAt: next.nextAt });
    deps.broadcast?.('warmy:dingShiDaoChuZhuangTai', { config: next });
    return { ...base, skipped: 'no-location', status: 'no-location', nextAt: next.nextAt };
  }
  const basicFiles = deps.vault.listExportFiles(cfg.include, cfg.scope);
  /** 选择性导出：逻辑文件（具体会话/知识层/时间范围）由宿主生成，随后随包写出 */
  let extraFiles: Array<{ rel: string; size: number; mtime: number; abs?: string }> = [];
  if (deps.buildExtraFiles && cfg.scope) {
    try { extraFiles = await deps.buildExtraFiles(cfg); }
    catch (e) { deps.audit?.('export.schedule.logical-build-failed', { error: String((e as Error)?.message || e).slice(0, 200) }); }
  }
  const files = [...basicFiles, ...extraFiles.map((x) => ({ rel: x.rel, size: x.size, mtime: x.mtime }))];
  const fingerprint = daoChuZhiWen(files);
  if (cfg.skipUnchanged && !opts.force && cfg.lastFingerprint && cfg.lastFingerprint === fingerprint) {
    const next = paiXiaYiCi({ ...cfg, lastStatus: 'unchanged', lastFingerprint: fingerprint }, now);
    deps.save(next);
    deps.audit?.('export.schedule.unchanged', { files: files.length, nextAt: next.nextAt });
    deps.broadcast?.('warmy:dingShiDaoChuZhuangTai', { config: next });
    return { ...base, ok: true, skipped: 'unchanged', status: 'unchanged', files: files.length, fingerprint, nextAt: next.nextAt };
  }
  if (cfg.encrypt && !deps.vault.isUnlocked()) {
    const retryAt = now + 10 * 60 * 1000;
    const next = { ...cfg, nextAt: retryAt, lastStatus: 'vault-locked' };
    deps.save(next);
    deps.audit?.('export.schedule.vault-locked', { retryAt });
    deps.broadcast?.('warmy:dingShiDaoChuZhuangTai', { config: next, error: 'vault-locked' });
    return { ...base, skipped: 'vault-locked', status: 'vault-locked', files: files.length, fingerprint, nextAt: retryAt };
  }
  const kroot = cfg.encrypt ? (deps.getKroot?.() || null) : null;
  if (cfg.encrypt && !kroot) {
    const retryAt = now + 10 * 60 * 1000;
    const next = { ...cfg, nextAt: retryAt, lastStatus: 'credential-unavailable' };
    deps.save(next);
    deps.audit?.('export.schedule.credential-unavailable', { retryAt });
    deps.broadcast?.('warmy:dingShiDaoChuZhuangTai', { config: next, error: 'credential-unavailable' });
    return { ...base, skipped: 'credential-unavailable', status: 'credential-unavailable', files: files.length, fingerprint, nextAt: retryAt };
  }
  const paths: string[] = [];
  let filesN = 0;
  let bytes = 0;
  const errors: string[] = [];
  for (const loc of locations) {
    let cleanup: (() => Promise<void>) | undefined;
    try {
      if (deps.prepareLocation) {
        const zhun = await deps.prepareLocation(loc);
        if (!zhun.ok) { errors.push(`${loc.path}: ${zhun.error || 'credential-failed'}`); continue; }
        cleanup = zhun.cleanup;
      }
      fs.mkdirSync(loc.path, { recursive: true });
      /** 秒级时间戳会让同一秒内的两次导出互相覆盖；加毫秒后缀，绝不覆盖已有备份 */
      const ms = String(now % 1000).padStart(3, '0');
      const file = path.join(loc.path, `warmy-data-${shiJianCi(now)}-${ms}.nm`);
      const r = await deps.vault.exportNm(file, {
        kroot: kroot ? Buffer.from(kroot) : undefined,
        plain: !cfg.encrypt,
        include: cfg.include,
        scope: cfg.scope,
        extraFiles,
        appVersion: deps.appVersion?.() || '',
      });
      if (r.ok) { paths.push(file); filesN = Math.max(filesN, Number(r.files) || 0); bytes += Number(r.bytes) || 0; }
      else errors.push(`${loc.path}: ${r.error || 'export-failed'}`);
    } catch (e) {
      errors.push(`${loc.path}: ${String((e as Error)?.message || e)}`);
    } finally {
      try { await cleanup?.(); } catch { /* 撤销临时映射失败不影响导出结果 */ }
    }
  }
  try { kroot?.fill(0); } catch { /* noop */ }
  const ok = errors.length === 0;
  const status = ok ? 'ok' : (paths.length ? 'partial' : 'failed');
  const next = paiXiaYiCi({
    ...cfg,
    lastStatus: errors.length ? `${status}: ${errors.join(' | ').slice(0, 500)}` : status,
    lastFingerprint: fingerprint,
    lastPaths: paths,
  }, now);
  deps.save(next);
  deps.audit?.('export.schedule.run', { status, files: filesN, bytes, locations: locations.length, paths: paths.length, errors: errors.slice(0, 3) });
  deps.broadcast?.('warmy:dingShiDaoChuZhuangTai', { config: next, error: errors[0] || '' });
  return { ok, status: next.lastStatus || status, paths, files: filesN, bytes, fingerprint, nextAt: next.nextAt };
}
