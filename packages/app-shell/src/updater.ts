/**
 * 自动更新：真实查询 + 真实下载（校验），不伪装成功
 *
 * 之前 `warmy:check-update` 恒定返回 { ok:true, upToDate:true }，
 * `warmy:auto-update-check/download` 是「no release channel configured」占位。
 * 这里做成可验证的真实实现：
 *
 * 1. 更新源可配置（优先 settings.json 的 updateFeedUrl，其次环境变量），未配置时
 *    返回 status='not-configured'，绝不伪装成「已是最新」。
 * 2. 查询走真实 HTTP(S)，每种真实结果返回**可区分**的 status：
 *    up-to-date / update-available / network-error / http-error / invalid-response / not-configured。
 * 3. 下载：流式写盘 + 原子替换 + 大小 / SHA-256 校验，任何校验失败都会删掉半成品。
 *    **安装未实现**（installImplemented:false），不提供看似可用的空壳。
 *
 * 更新源清单（feed）支持两种真实形态：
 *   A. 通用 JSON：{ "version": "0.2.0", "url": "https://…/WArmy-0.2.0.exe",
 *                   "sha256": "…", "size": 12345, "notes": "…", "mandatory": false }
 *      （也接受 latest/latestVersion、downloadUrl/download_url/asset、checksum/hash、
 *        sizeBytes/bytes、releaseNotes/body、force、publishedAt/published_at/date）
 *   B. GitHub Releases 风格：{ "tag_name": "v0.2.0", "body": "…",
 *      "assets": [{ "name": "…", "browser_download_url": "…", "size": 123 }] }
 *      （也接受 /releases 数组，取第一个非 draft 条目）
 *
 * 本模块不依赖 electron，可直接用 node 跑验证脚本。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { duJsonWenJianGeLi, anQuanYuanZiXieJson } from './atomic-json.js';

export type UpdateStatus =
  | 'not-configured'
  | 'up-to-date'
  | 'update-available'
  | 'network-error'
  | 'http-error'
  | 'invalid-response'
  | 'updater-unavailable';

/** electron-updater 风格状态，保留给 warmy:auto-update-check */
export type AutoUpdateStatus = 'available' | 'not-available' | 'error' | 'not-configured' | 'unavailable';

export type DownloadStatus =
  | UpdateStatus
  | 'downloaded'
  | 'no-download-url'
  | 'checksum-mismatch'
  | 'size-mismatch'
  | 'too-large'
  | 'io-error';

export type VerificationMode = 'sha256+size' | 'sha256' | 'size' | 'none';

export interface UpdateManifest {
  version: string;
  notes?: string;
  downloadUrl?: string;
  sha256?: string;
  size?: number;
  mandatory?: boolean;
  publishedAt?: string;
}

export interface UpdateCheckResult {
  /** 只有在结论明确（有更新 / 已是最新）时为 true；出错与未配置都为 false */
  ok: boolean;
  status: UpdateStatus;
  autoUpdateStatus: AutoUpdateStatus;
  currentVersion: string;
  /** 兼容旧 `warmy:check-update` 的 { version } 字段：当前版本 */
  version: string;
  latestVersion?: string;
  updateAvailable?: boolean;
  /** 仅在结论明确时为 true / false，其余情况恒为 false（旧字段，勿单独用于判断） */
  upToDate: boolean;
  /** 更新源展示串（去掉凭据与查询串） */
  source?: string;
  sourceOrigin: 'settings' | 'env' | 'none';
  channel?: string;
  notes?: string;
  downloadUrl?: string;
  sha256?: string;
  size?: number;
  mandatory?: boolean;
  publishedAt?: string;
  httpStatus?: number;
  /** 机器可读细分原因，如 'bad-json' / 'missing-version' / 'dns-failure' */
  reason?: string;
  /** 人读说明（英文）；界面按 i18nKey 本地化 */
  message: string;
  i18nKey: string;
  checkedAt: number;
  durationMs: number;
}

export interface UpdateDownloadResult {
  ok: boolean;
  status: DownloadStatus;
  message: string;
  i18nKey: string;
  version?: string;
  filePath?: string;
  bytes?: number;
  sha256?: string;
  expectedSha256?: string;
  expectedSize?: number;
  verification: VerificationMode;
  verified: boolean;
  warning?: string;
  /** 安装路径未实现：显式标记，避免看起来可用 */
  installImplemented: false;
  installNotes: string;
  downloadUrlPresent: boolean;
  checkedAt: number;
  durationMs: number;
}

export interface UpdateSourceInfo {
  configured: boolean;
  url: string | null;
  origin: 'settings' | 'env' | 'none';
  channel: string;
  currentVersion: string;
  error?: string;
  lastCheck?: { status: UpdateStatus; latestVersion?: string; checkedAt: number } | null;
  lastDownload?: { status: DownloadStatus; version?: string; verified?: boolean; checkedAt: number } | null;
}

export interface UpdaterOptions {
  currentVersion: string;
  /** 下载落盘目录（主进程传 userData/updates） */
  downloadDir: string;
  /** 状态文件（默认 downloadDir/update-state.json） */
  stateFile?: string;
  /** 读取应用设置（settings.json 内容）；用于解析更新源 */
  getSettings?: () => unknown;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  /** 清单请求超时 */
  timeoutMs?: number;
  /** 下载超时 */
  downloadTimeoutMs?: number;
  /** 下载硬上限（默认 512MB） */
  maxBytes?: number;
  userAgent?: string;
  log?: (msg: string) => void;
}

interface PersistedState {
  version: 1;
  lastCheck?: UpdateCheckResult;
  lastDownload?: UpdateDownloadResult;
}

const I18N_KEY: Record<UpdateStatus, string> = {
  'not-configured': 'update.status.notConfigured',
  'up-to-date': 'update.status.upToDate',
  'update-available': 'update.status.available',
  'network-error': 'update.status.networkError',
  'http-error': 'update.status.httpError',
  'invalid-response': 'update.status.invalidResponse',
  'updater-unavailable': 'update.status.unavailable',
};

const AUTO_STATUS: Record<UpdateStatus, AutoUpdateStatus> = {
  'not-configured': 'not-configured',
  'up-to-date': 'not-available',
  'update-available': 'available',
  'network-error': 'error',
  'http-error': 'error',
  'invalid-response': 'error',
  'updater-unavailable': 'unavailable',
};

const DEFAULT_MESSAGE: Record<UpdateStatus, string> = {
  'not-configured': 'update feed url is not configured',
  'up-to-date': 'already on the latest version',
  'update-available': 'a newer version is available',
  'network-error': 'update check failed: network error',
  'http-error': 'update check failed: unexpected http status',
  'invalid-response': 'update check failed: feed response is not a valid manifest',
  'updater-unavailable': 'updater is not ready (app still starting)',
};

const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 15 * 60_000;
/** 清单最大读取量（超了直接判非法，避免被大响应拖死） */
const MANIFEST_MAX_BYTES = 1024 * 1024;

/** 宽松 semver 解析：可选 v 前缀 + 1~3 段数字 + 可选预发布串 */
export function parseVersion(input: string): { nums: number[]; pre: string[] } | null {
  const v = String(input || '').trim().replace(/^v/i, '');
  if (!v) return null;
  const m = v.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+]([0-9A-Za-z.-]+))?$/);
  if (!m) return null;
  const nums = [Number(m[1] || 0), Number(m[2] || 0), Number(m[3] || 0)];
  const pre = m[4] ? m[4].split('.').filter(Boolean) : [];
  return { nums, pre };
}

/** a>b 返回 1，a<b 返回 -1，相等 0，无法解析返回 null */
export function compareVersions(a: string, b: string): number | null {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) return null;
  for (let i = 0; i < 3; i++) {
    const x = va.nums[i] ?? 0;
    const y = vb.nums[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  if (!va.pre.length && !vb.pre.length) return 0;
  if (!va.pre.length) return 1; // 正式版 > 预发布版
  if (!vb.pre.length) return -1;
  const len = Math.max(va.pre.length, vb.pre.length);
  for (let i = 0; i < len; i++) {
    const x = va.pre[i];
    const y = vb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) return Number(x) > Number(y) ? 1 : -1;
    if (nx) return -1; // 数字段 < 字母段
    if (ny) return 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

/** 更新源地址校验：只接受 http(s)，不接受内嵌凭据 */
export function validateFeedUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  const s = String(raw || '').trim();
  if (!s) return { ok: false, error: 'feed url is empty' };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, error: 'feed url is not a valid URL' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, error: 'feed url must be http(s)' };
  }
  if (u.username || u.password) return { ok: false, error: 'feed url must not embed credentials' };
  u.hash = '';
  return { ok: true, url: u.toString() };
}

/** 展示用：去掉凭据 / 查询串，只留 origin + pathname */
export function displayUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.origin}${u.pathname}`;
  } catch {
    return '(invalid url)';
  }
}

function settingsFeed(settings: unknown): { url: string; channel: string } | null {
  if (!settings || typeof settings !== 'object') return null;
  const s = settings as Record<string, unknown>;
  const update = s['update'] && typeof s['update'] === 'object' ? (s['update'] as Record<string, unknown>) : null;
  const updates = s['updates'] && typeof s['updates'] === 'object' ? (s['updates'] as Record<string, unknown>) : null;
  const candidates = [
    s['updateFeedUrl'],
    s['updateUrl'],
    update?.['feedUrl'],
    update?.['url'],
    updates?.['url'],
    updates?.['feedUrl'],
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) {
      const ch = [s['updateChannel'], update?.['channel'], updates?.['channel']].find((x) => typeof x === 'string' && x);
      return { url: c.trim(), channel: typeof ch === 'string' ? ch : '' };
    }
  }
  return null;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function shuZhi(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Number(v.trim());
  return undefined;
}

function bool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === 1) return true;
  if (v === 'false' || v === 0) return false;
  return undefined;
}

function firstObjectIn(raw: unknown): Record<string, unknown> | null {
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (item && typeof item === 'object' && !Array.isArray(item)) return item as Record<string, unknown>;
    }
    return null;
  }
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    for (const key of ['releases', 'items', 'updates', 'data']) {
      const inner = o[key];
      if (Array.isArray(inner)) {
        const found = firstObjectIn(inner);
        if (found) return found;
      }
    }
    return o;
  }
  return null;
}

/**
 * 把各种真实 feed 形态归一化；失败给出机器可读原因
 */
export function normalizeManifest(
  raw: unknown
): { ok: true; manifest: UpdateManifest } | { ok: false; reason: string } {
  const obj = firstObjectIn(raw);
  if (!obj) return { ok: false, reason: 'not-an-object' };
  if (obj['draft'] === true || obj['prerelease'] === true) {
    // 预发布/草稿不作为正式更新源
    return { ok: false, reason: obj['draft'] === true ? 'draft-entry' : 'prerelease-entry' };
  }
  const version =
    str(obj['version']) ||
    str(obj['latest']) ||
    str(obj['latestVersion']) ||
    str(obj['tag_name']) ||
    str(obj['tag']);
  if (!version) return { ok: false, reason: 'missing-version' };
  if (!parseVersion(version)) return { ok: false, reason: 'bad-version' };

  const assets = Array.isArray(obj['assets']) ? (obj['assets'] as unknown[]) : [];
  let assetUrl: string | undefined;
  let assetSize: number | undefined;
  for (const a of assets) {
    if (!a || typeof a !== 'object') continue;
    const rec = a as Record<string, unknown>;
    const u = str(rec['browser_download_url']) || str(rec['url']);
    if (u) {
      assetUrl = u;
      assetSize = shuZhi(rec['size']);
      break;
    }
  }
  const downloadUrl =
    str(obj['url']) ||
    str(obj['downloadUrl']) ||
    str(obj['download_url']) ||
    str(obj['browser_download_url']) ||
    str(obj['file']) ||
    str(obj['asset']) ||
    assetUrl ||
    // GitHub 兜底：没有构建产物时退回 release 页面（仅查询可用，下载会判 no-download-url）
    str(obj['html_url']);

  const rawHash = str(obj['sha256']) || str(obj['checksum']) || str(obj['hash']) || str(obj['shasum']);
  let sha256: string | undefined;
  if (rawHash) {
    const yiQingLi = rawHash.replace(/^sha256[-:]/i, '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(yiQingLi)) return { ok: false, reason: 'bad-checksum' };
    sha256 = yiQingLi;
  }
  const size = shuZhi(obj['size']) ?? shuZhi(obj['sizeBytes']) ?? shuZhi(obj['bytes']) ?? assetSize;
  if (size !== undefined && size <= 0) return { ok: false, reason: 'bad-size' };

  const manifest: UpdateManifest = { version };
  const notes = str(obj['notes']) || str(obj['releaseNotes']) || str(obj['body']) || str(obj['changelog']);
  if (notes) manifest.notes = notes.slice(0, 4000);
  if (downloadUrl) manifest.downloadUrl = downloadUrl;
  if (sha256) manifest.sha256 = sha256;
  if (size !== undefined) manifest.size = size;
  const mandatory = bool(obj['mandatory']) ?? bool(obj['force']) ?? bool(obj['required']);
  if (mandatory !== undefined) manifest.mandatory = mandatory;
  const publishedAt = str(obj['publishedAt']) || str(obj['published_at']) || str(obj['date']) || str(obj['created_at']);
  if (publishedAt) manifest.publishedAt = publishedAt;
  return { ok: true, manifest };
}

/** 网络错误 → 粗粒度、无敏感信息的描述 */
export function classifyFetchError(e: unknown): { reason: string; message: string } {
  const code = (() => {
    const anyE = e as { code?: unknown; cause?: { code?: unknown } } | null;
    const c1 = anyE && typeof anyE.code === 'string' ? anyE.code : '';
    const c2 = anyE?.cause && typeof anyE.cause.code === 'string' ? anyE.cause.code : '';
    return c1 || c2;
  })();
  const name = e instanceof Error ? e.name : '';
  if (name === 'AbortError' || code === 'ABORT_ERR') return { reason: 'timeout', message: 'update check timed out' };
  switch (code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return { reason: 'dns-failure', message: 'update check failed: cannot resolve update host' };
    case 'ECONNREFUSED':
      return { reason: 'connection-refused', message: 'update check failed: connection refused' };
    case 'ECONNRESET':
    case 'EPIPE':
      return { reason: 'connection-reset', message: 'update check failed: connection reset' };
    case 'ETIMEDOUT':
      return { reason: 'timeout', message: 'update check timed out' };
    case 'CERT_HAS_EXPIRED':
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
      return { reason: 'tls-error', message: 'update check failed: TLS certificate rejected' };
    default:
      return { reason: 'fetch-failed', message: 'update check failed: network request failed' };
  }
}

function sanitizeSegment(s: string): string {
  const yiQingLi = String(s || '').replace(/[\\/:*?"<>|\s]/g, '_').replace(/\.+$/, '');
  return yiQingLi.slice(0, 64) || 'latest';
}

/**
 * 丢弃半成品：先释放文件句柄（Windows 下未释放就删不掉），再删文件。
 * 全部失败也不抛：调用方已经要返回错误状态了。
 */
async function discardPartial(ws: fs.WriteStream, file: string): Promise<void> {
  const alreadyDown = ws.destroyed;
  try {
    if (!alreadyDown) ws.destroy();
  } catch {
    /* 忽略 */
  }
  if (!alreadyDown) {
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 1500);
      ws.once('close', () => {
        clearTimeout(t);
        resolve();
      });
    });
  }
  for (let i = 0; i < 5; i++) {
    try {
      fs.rmSync(file, { force: true });
      return;
    } catch {
      await new Promise<void>((r) => setTimeout(r, 50));
    }
  }
}

function fileNameFromUrl(raw: string, version: string): string {
  try {
    const u = new URL(raw);
    const base = path.posix.basename(u.pathname);
    const safe = base.replace(/[\\/:*?"<>|\s]/g, '_');
    if (safe && safe !== '.' && safe !== '..' && safe.length > 1) return safe.slice(0, 120);
  } catch {
    /* 用兜底名 */
  }
  return `warmy-${sanitizeSegment(version)}-update.bin`;
}

export class Updater {
  private readonly currentVersion: string;
  private readonly downloadDir: string;
  private readonly stateFile: string;
  private readonly getSettings: (() => unknown) | null;
  private readonly env: Record<string, string | undefined>;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly downloadTimeoutMs: number;
  private readonly maxBytes: number;
  private readonly userAgent: string;
  private readonly log: (msg: string) => void;

  constructor(opts: UpdaterOptions) {
    this.currentVersion = opts.currentVersion || '0.0.0';
    this.downloadDir = opts.downloadDir;
    this.stateFile = opts.stateFile || path.join(opts.downloadDir, 'update-state.json');
    this.getSettings = opts.getSettings || null;
    this.env = opts.env || process.env;
    this.fetchImpl = opts.fetchImpl || ((...args: Parameters<typeof fetch>) => fetch(...args));
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.downloadTimeoutMs = opts.downloadTimeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
    this.maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
    this.userAgent = opts.userAgent || `WArmy/${this.currentVersion}`;
    this.log = opts.log || (() => {});
  }

  // ── 更新源 ──

  resolveSource(): { url: string | null; origin: 'settings' | 'env' | 'none'; channel: string; error?: string } {
    let settingsRaw: unknown = null;
    try {
      settingsRaw = this.getSettings ? this.getSettings() : null;
    } catch {
      settingsRaw = null;
    }
    const fromSettings = settingsFeed(settingsRaw);
    if (fromSettings) {
      const v = validateFeedUrl(fromSettings.url);
      if (!v.ok) return { url: null, origin: 'settings', channel: fromSettings.channel, error: v.error };
      return { url: v.url, origin: 'settings', channel: fromSettings.channel };
    }
    const fromEnv = str(this.env['WARMY_UPDATE_FEED_URL']);
    if (fromEnv) {
      const v = validateFeedUrl(fromEnv);
      if (!v.ok) return { url: null, origin: 'env', channel: '', error: v.error };
      return { url: v.url, origin: 'env', channel: '' };
    }
    return { url: null, origin: 'none', channel: '' };
  }

  getSourceInfo(): UpdateSourceInfo {
    const s = this.resolveSource();
    const st = this.readState();
    return {
      configured: !!s.url,
      url: s.url ? displayUrl(s.url) : null,
      origin: s.origin,
      channel: s.channel,
      currentVersion: this.currentVersion,
      ...(s.error ? { error: s.error } : {}),
      lastCheck: st.lastCheck
        ? {
            status: st.lastCheck.status,
            ...(st.lastCheck.latestVersion ? { latestVersion: st.lastCheck.latestVersion } : {}),
            checkedAt: st.lastCheck.checkedAt,
          }
        : null,
      lastDownload: st.lastDownload
        ? {
            status: st.lastDownload.status,
            ...(st.lastDownload.version ? { version: st.lastDownload.version } : {}),
            verified: st.lastDownload.verified,
            checkedAt: st.lastDownload.checkedAt,
          }
        : null,
    };
  }

  // ── 结果构造 ──

  private result(status: UpdateStatus, extra: Partial<UpdateCheckResult> = {}): UpdateCheckResult {
    const definite = status === 'up-to-date' || status === 'update-available';
    const src = this.resolveSource();
    return {
      ok: definite,
      status,
      autoUpdateStatus: AUTO_STATUS[status],
      currentVersion: this.currentVersion,
      version: this.currentVersion,
      upToDate: status === 'up-to-date',
      message: DEFAULT_MESSAGE[status],
      i18nKey: I18N_KEY[status],
      checkedAt: Date.now(),
      durationMs: 0,
      sourceOrigin: src.origin,
      ...(src.url ? { source: displayUrl(src.url) } : {}),
      ...(src.channel ? { channel: src.channel } : {}),
      ...extra,
    };
  }

  private dlResult(
    status: DownloadStatus,
    extra: Partial<UpdateDownloadResult> & { durationMs: number }
  ): UpdateDownloadResult {
    const base = status in I18N_KEY ? I18N_KEY[status as UpdateStatus] : 'update.download.failed';
    const huituiXiaoxi = status in DEFAULT_MESSAGE ? DEFAULT_MESSAGE[status as UpdateStatus] : 'update download failed';
    const installNotes =
      'automatic installation is not implemented: the verified artifact is kept on disk for a manual install';
    return {
      ok: status === 'downloaded',
      status,
      message: huituiXiaoxi,
      i18nKey: base,
      verification: 'none',
      verified: false,
      installImplemented: false,
      installNotes,
      downloadUrlPresent: false,
      checkedAt: Date.now(),
      ...extra,
    };
  }

  // ── 查询 ──

  async check(): Promise<UpdateCheckResult> {
    const started = Date.now();
    const src = this.resolveSource();
    if (!src.url) {
      const r = this.result('not-configured', {
        durationMs: Date.now() - started,
        reason: src.error ? 'invalid-feed-url' : 'no-feed-url',
        ...(src.error ? { message: `update feed url is not usable: ${src.error}` } : {}),
      });
      this.persistCheck(r);
      return r;
    }

    let res: Response;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      res = await this.fetchImpl(src.url, {
        method: 'GET',
        headers: { accept: 'application/json, text/plain;q=0.9, */*;q=0.5', 'user-agent': this.userAgent },
        redirect: 'follow',
        signal: ac.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      const c = classifyFetchError(e);
      this.log(`update check network fail: ${c.reason}`);
      const r = this.result('network-error', {
        durationMs: Date.now() - started,
        reason: c.reason,
        message: c.message,
      });
      this.persistCheck(r);
      return r;
    }
    clearTimeout(timer);

    if (!res.ok) {
      const r = this.result('http-error', {
        durationMs: Date.now() - started,
        httpStatus: res.status,
        reason: 'unexpected-status',
        message: `update check failed: feed responded with http ${res.status}`,
      });
      this.persistCheck(r);
      return r;
    }

    const declaredLen = Number(res.headers.get('content-length') || '0');
    if (Number.isFinite(declaredLen) && declaredLen > MANIFEST_MAX_BYTES) {
      const r = this.result('invalid-response', {
        durationMs: Date.now() - started,
        reason: 'manifest-too-large',
        message: 'update check failed: feed payload is too large',
      });
      this.persistCheck(r);
      return r;
    }

    let text = '';
    try {
      text = await res.text();
    } catch (e) {
      const c = classifyFetchError(e);
      const r = this.result('network-error', {
        durationMs: Date.now() - started,
        reason: c.reason,
        message: c.message,
      });
      this.persistCheck(r);
      return r;
    }
    if (text.length > MANIFEST_MAX_BYTES) text = text.slice(0, MANIFEST_MAX_BYTES);

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      const r = this.result('invalid-response', {
        durationMs: Date.now() - started,
        reason: 'bad-json',
        message: 'update check failed: feed did not return valid JSON',
      });
      this.persistCheck(r);
      return r;
    }

    const guiFanHua = normalizeManifest(parsed);
    if (!guiFanHua.ok) {
      const r = this.result('invalid-response', {
        durationMs: Date.now() - started,
        reason: guiFanHua.reason,
        message: `update check failed: feed manifest is not usable (${guiFanHua.reason})`,
      });
      this.persistCheck(r);
      return r;
    }

    const { manifest } = guiFanHua;
    const cmp = compareVersions(manifest.version, this.currentVersion);
    if (cmp === null) {
      const r = this.result('invalid-response', {
        durationMs: Date.now() - started,
        reason: 'unparsable-version',
        message: 'update check failed: feed manifest version cannot be compared',
      });
      this.persistCheck(r);
      return r;
    }

    const extra: Partial<UpdateCheckResult> = {
      durationMs: Date.now() - started,
      latestVersion: manifest.version,
      ...(manifest.notes ? { notes: manifest.notes } : {}),
      ...(manifest.downloadUrl ? { downloadUrl: manifest.downloadUrl } : {}),
      ...(manifest.sha256 ? { sha256: manifest.sha256 } : {}),
      ...(manifest.size !== undefined ? { size: manifest.size } : {}),
      ...(manifest.mandatory !== undefined ? { mandatory: manifest.mandatory } : {}),
      ...(manifest.publishedAt ? { publishedAt: manifest.publishedAt } : {}),
    };

    if (cmp > 0) {
      const r = this.result('update-available', {
        ...extra,
        updateAvailable: true,
        message: `update available: ${manifest.version} (current ${this.currentVersion})`,
      });
      this.persistCheck(r);
      this.log(`update available ${manifest.version}`);
      return r;
    }
    if (cmp === 0) {
      const r = this.result('up-to-date', { ...extra, updateAvailable: false, reason: 'equal-version' });
      this.persistCheck(r);
      return r;
    }
    const r = this.result('up-to-date', {
      ...extra,
      updateAvailable: false,
      reason: 'local-version-newer',
      message: `local version ${this.currentVersion} is newer than feed version ${manifest.version}`,
    });
    this.persistCheck(r);
    return r;
  }

  // ── 下载（含校验；安装未实现） ──

  async download(): Promise<UpdateDownloadResult> {
    const started = Date.now();
    const chk = await this.check();
    if (chk.status !== 'update-available') {
      return this.dlResult(chk.status, {
        durationMs: Date.now() - started,
        message: chk.message,
        i18nKey: chk.i18nKey,
        ...(chk.latestVersion ? { version: chk.latestVersion } : {}),
      });
    }
    const version = chk.latestVersion || 'latest';
    if (!chk.downloadUrl) {
      return this.dlResult('no-download-url', {
        durationMs: Date.now() - started,
        version,
        message: 'feed has no downloadable artifact url (query-only feed)',
        i18nKey: 'update.download.noUrl',
      });
    }
    const v = validateFeedUrl(chk.downloadUrl);
    if (!v.ok) {
      return this.dlResult('invalid-response', {
        durationMs: Date.now() - started,
        version,
        downloadUrlPresent: true,
        message: `feed download url is not usable: ${v.error}`,
        i18nKey: 'update.download.badUrl',
      });
    }

    const mubiaoMulu = path.join(this.downloadDir, sanitizeSegment(version));
    const finalPath = path.join(mubiaoMulu, fileNameFromUrl(v.url, version));
    const root = path.resolve(this.downloadDir) + path.sep;
    if (!path.resolve(finalPath).startsWith(root)) {
      return this.dlResult('io-error', {
        durationMs: Date.now() - started,
        version,
        downloadUrlPresent: true,
        message: 'download target path rejected',
      });
    }
    const partPath = `${finalPath}.part`;
    try {
      fs.mkdirSync(mubiaoMulu, { recursive: true });
    } catch {
      return this.dlResult('io-error', {
        durationMs: Date.now() - started,
        version,
        downloadUrlPresent: true,
        message: 'cannot create download directory',
      });
    }

    const expectedSha256 = chk.sha256 ? chk.sha256.toLowerCase() : undefined;
    const expectedSize = chk.size;

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.downloadTimeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(v.url, {
        method: 'GET',
        headers: { accept: 'application/octet-stream, */*', 'user-agent': this.userAgent },
        redirect: 'follow',
        signal: ac.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      const c = classifyFetchError(e);
      this.log(`update download network fail: ${c.reason}`);
      return this.dlResult('network-error', {
        durationMs: Date.now() - started,
        version,
        downloadUrlPresent: true,
        message: c.message,
      });
    }

    if (!res.ok) {
      clearTimeout(timer);
      return this.dlResult('http-error', {
        durationMs: Date.now() - started,
        version,
        downloadUrlPresent: true,
        message: `download failed: http ${res.status}`,
      });
    }

    const declared = Number(res.headers.get('content-length') || '0');
    if (Number.isFinite(declared) && declared > this.maxBytes) {
      clearTimeout(timer);
      ac.abort();
      return this.dlResult('too-large', {
        durationMs: Date.now() - started,
        version,
        downloadUrlPresent: true,
        message: 'artifact exceeds the download size limit',
      });
    }

    const hash = crypto.createHash('sha256');
    let bytes = 0;
    let tooLarge = false;
    const ws = fs.createWriteStream(partPath);
    try {
      const body = res.body as unknown as AsyncIterable<Uint8Array> | null;
      if (!body) throw new Error('empty body');
      for await (const chunk of body) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buf.length;
        if (bytes > this.maxBytes) {
          tooLarge = true;
          ac.abort();
          break;
        }
        hash.update(buf);
        const okWrite = ws.write(buf);
        if (!okWrite) {
          await new Promise<void>((resolve, reject) => {
            const onError = (err: Error) => {
              ws.off('drain', onDrain);
              reject(err);
            };
            const onDrain = () => {
              ws.off('error', onError);
              resolve();
            };
            ws.once('drain', onDrain);
            ws.once('error', onError);
          });
        }
      }
      if (!tooLarge) await new Promise<void>((resolve, reject) => ws.end(() => resolve()).once('error', reject));
    } catch (e) {
      clearTimeout(timer);
      await discardPartial(ws, partPath);
      const c = classifyFetchError(e);
      this.log(`update download aborted: ${c.reason}`);
      return this.dlResult(bytes > 0 ? 'io-error' : 'network-error', {
        durationMs: Date.now() - started,
        version,
        downloadUrlPresent: true,
        message: bytes > 0 ? 'download interrupted while writing to disk' : c.message,
      });
    }
    clearTimeout(timer);

    if (tooLarge) {
      await discardPartial(ws, partPath);
      return this.dlResult('too-large', {
        durationMs: Date.now() - started,
        version,
        bytes,
        downloadUrlPresent: true,
        message: 'artifact exceeds the download size limit',
      });
    }

    const actualSha256 = hash.digest('hex');
    const verification: VerificationMode =
      expectedSha256 && expectedSize !== undefined
        ? 'sha256+size'
        : expectedSha256
          ? 'sha256'
          : expectedSize !== undefined
            ? 'size'
            : 'none';

    if (expectedSha256 && actualSha256 !== expectedSha256) {
      await discardPartial(ws, partPath);
      return this.dlResult('checksum-mismatch', {
        durationMs: Date.now() - started,
        version,
        bytes,
        sha256: actualSha256,
        expectedSha256,
        verification,
        downloadUrlPresent: true,
        message: 'downloaded artifact failed SHA-256 verification; file discarded',
        i18nKey: 'update.download.checksumMismatch',
      });
    }
    if (expectedSize !== undefined && bytes !== expectedSize) {
      await discardPartial(ws, partPath);
      return this.dlResult('size-mismatch', {
        durationMs: Date.now() - started,
        version,
        bytes,
        expectedSize,
        sha256: actualSha256,
        expectedSha256,
        verification,
        downloadUrlPresent: true,
        message: 'downloaded artifact size does not match the feed manifest; file discarded',
        i18nKey: 'update.download.sizeMismatch',
      });
    }

    try {
      fs.renameSync(partPath, finalPath);
    } catch {
      await discardPartial(ws, partPath);
      return this.dlResult('io-error', {
        durationMs: Date.now() - started,
        version,
        bytes,
        downloadUrlPresent: true,
        message: 'cannot finalize downloaded artifact',
      });
    }

    const out: UpdateDownloadResult = this.dlResult('downloaded', {
      durationMs: Date.now() - started,
      version,
      filePath: finalPath,
      bytes,
      sha256: actualSha256,
      ...(expectedSha256 ? { expectedSha256 } : {}),
      ...(expectedSize !== undefined ? { expectedSize } : {}),
      verification,
      verified: verification !== 'none',
      downloadUrlPresent: true,
      message: `artifact downloaded (${bytes} bytes)`,
      i18nKey: 'update.download.done',
      ...(verification === 'none'
        ? { warning: 'feed did not declare sha256/size: artifact could not be verified' }
        : {}),
    });
    this.log(`update downloaded ${version} verified=${out.verified}`);
    this.persistDownload(out);
    return out;
  }

  // ── 状态文件（诊断用，落盘失败不影响主流程） ──

  readState(): PersistedState {
    const st = duJsonWenJianGeLi<PersistedState>(this.stateFile, { version: 1 });
    return st && typeof st === 'object' ? st : { version: 1 };
  }

  private persistCheck(r: UpdateCheckResult): void {
    const prev = this.readState();
    anQuanYuanZiXieJson(this.stateFile, { version: 1, lastCheck: r, ...(prev.lastDownload ? { lastDownload: prev.lastDownload } : {}) });
  }

  private persistDownload(r: UpdateDownloadResult): void {
    const prev = this.readState();
    anQuanYuanZiXieJson(this.stateFile, { version: 1, ...(prev.lastCheck ? { lastCheck: prev.lastCheck } : {}), lastDownload: r });
  }
}

/** updater 还没就绪（bootstrap 未完成）时的诚实返回 */
export function updaterUnavailableCheck(currentVersion: string): UpdateCheckResult {
  return {
    ok: false,
    status: 'updater-unavailable',
    autoUpdateStatus: 'unavailable',
    currentVersion,
    version: currentVersion,
    upToDate: false,
    message: DEFAULT_MESSAGE['updater-unavailable'],
    i18nKey: I18N_KEY['updater-unavailable'],
    checkedAt: Date.now(),
    durationMs: 0,
    sourceOrigin: 'none',
  };
}

/** 同上，用于下载通道 */
export function updaterUnavailableDownload(currentVersion: string): UpdateDownloadResult {
  return {
    ok: false,
    status: 'updater-unavailable',
    message: DEFAULT_MESSAGE['updater-unavailable'],
    i18nKey: I18N_KEY['updater-unavailable'],
    verification: 'none',
    verified: false,
    installImplemented: false,
    installNotes:
      'automatic installation is not implemented: the verified artifact is kept on disk for a manual install',
    downloadUrlPresent: false,
    checkedAt: Date.now(),
    durationMs: 0,
  };
}
