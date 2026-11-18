/**
 * plugin-market —— 插件索引/发现/更新（R238，对齐 dsh 官方插件索引规范）。
 * 规范：https://deepseek-harness.github.io/deepseek-harness/guide/plugin-market
 *
 * 纯函数模块（无 Electron/网络依赖，门禁可离线真跑）：
 *  · 索引 URL 合法性（http/https，禁用户名/密码/#片段）；
 *  · 索引格式校验（format=1 / LocalizedText / plugins / versions / source npm|git / engines / metadata 引用）；
 *  · SemVer 比较 + 范围满足（engines.dsh / engines.warmy 兼容判定）；
 *  · 推荐版本（兼容且非预发布的最高版；无则兼容的最高预发布版）；
 *  · 更新检测（已装版本 vs 索引版本）；
 *  · 模糊搜索（名称/作者/关键词/各语言标题描述/分类/标签，容忍拼写错误，最佳匹配排序）；
 *  · 排序（索引声明的 sortKeys / 发布时间；缺失值恒排最后，0 是有效值）；
 *  · 安装 spec（npm name@version[registry]；git git+url.git#commit[&path]）；图标相对/绝对解析。
 *
 * 安全：索引是第三方内容，只校验格式不背书声明；安装前由宿主展示来源确认；https 优先。
 */

export type LocalizedText = string | Record<string, string>;

export interface SuoYinBanBen {
  version: string;
  publishTimestamp: number;
  source: { type: 'npm'; registry?: string } | { type: 'git'; url: string; commit: string; path?: string };
  engines?: { dsh?: string; warmy?: string };
}
export interface SuoYinChaJian {
  name: string;
  title?: LocalizedText;
  description?: LocalizedText;
  icon?: string;
  author?: string;
  homepage?: string;
  repository?: { url: string; directory?: string };
  keywords?: string[];
  metadata?: { category?: string; labels?: string[]; sortKeys?: Record<string, number | null> };
  versions: SuoYinBanBen[];
}
export interface SuoYin {
  format: number;
  title: LocalizedText;
  description?: LocalizedText;
  metadata?: {
    categories?: Record<string, { title: LocalizedText }>;
    labels?: Record<string, { title: LocalizedText }>;
    sortKeys?: Record<string, { title: LocalizedText; order?: 'asc' | 'desc' }>;
  };
  plugins: SuoYinChaJian[];
}

// ── SemVer（聚焦插件 engines 常用范围：>= > <= < = ^ ~ x 通配 || 连字符 空格 AND；预发布按 node-semver 口径）──
export interface SemVer { major: number; minor: number; patch: number; pre: string[]; raw: string; }

export function parseSemVer(v: string): SemVer | null {
  const s = String(v || '').trim().replace(/^[v=]/, '');
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(s);
  if (!m) return null;
  const major = Number(m[1]); const minor = Number(m[2]); const patch = Number(m[3]);
  if (![major, minor, patch].every((n) => Number.isFinite(n) && n >= 0)) return null;
  return { major, minor, patch, pre: m[4] ? String(m[4]).split('.') : [], raw: s };
}

function cmpPre(a: string[], b: string[]): number {
  if (!a.length && !b.length) return 0;
  if (!a.length) return 1;   // 无预发布 > 有预发布
  if (!b.length) return -1;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const x = a[i]; const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x); const yn = /^\d+$/.test(y);
    if (xn && yn) { const d = Number(x) - Number(y); if (d) return d < 0 ? -1 : 1; }
    else if (xn) return -1;
    else if (yn) return 1;
    else { if (x < y) return -1; if (x > y) return 1; }
  }
  return 0;
}

export function cmpSemVer(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return cmpPre(a.pre, b.pre);
}

/** 宽松解析（允许 1 / 1.2 / 1.2.x 通配，用于范围端点）。 */
function parseLoose(v: string): { major: number; minor: number | null; patch: number | null; pre: string[] } | null {
  const s = String(v || '').trim().replace(/^[v=]/, '');
  const m = /^(\d+|x|X|\*)(?:\.(\d+|x|X|\*))?(?:\.(\d+|x|X|\*))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(s);
  if (!m) return null;
  const wild = (t: string | undefined) => t === undefined || t === 'x' || t === 'X' || t === '*';
  const major = wild(m[1]) ? 0 : Number(m[1]);
  const minor = wild(m[2]) ? null : Number(m[2]);
  const patch = wild(m[3]) ? null : Number(m[3]);
  return { major, minor, patch, pre: m[4] ? String(m[4]).split('.') : [] };
}

interface Comparator { op: '>=' | '>' | '<=' | '<' | '='; ver: SemVer; }

function caret(lo: { major: number; minor: number | null; patch: number | null; pre: string[] }): Comparator[] {
  const minor = lo.minor ?? 0; const patch = lo.patch ?? 0;
  const lower: SemVer = { major: lo.major, minor, patch, pre: lo.pre, raw: '' };
  let upper: SemVer;
  if (lo.major > 0) upper = { major: lo.major + 1, minor: 0, patch: 0, pre: [], raw: '' };
  else if (lo.minor !== null && lo.minor > 0) upper = { major: 0, minor: lo.minor + 1, patch: 0, pre: [], raw: '' };
  else if (lo.minor !== null && lo.patch !== null) upper = { major: 0, minor: 0, patch: lo.patch + 1, pre: [], raw: '' };
  else if (lo.minor !== null) upper = { major: 0, minor: 1, patch: 0, pre: [], raw: '' };
  else upper = { major: 1, minor: 0, patch: 0, pre: [], raw: '' };
  return [{ op: '>=', ver: lower }, { op: '<', ver: upper }];
}
function tilde(lo: { major: number; minor: number | null; patch: number | null; pre: string[] }): Comparator[] {
  const minor = lo.minor ?? 0; const patch = lo.patch ?? 0;
  const lower: SemVer = { major: lo.major, minor, patch, pre: lo.pre, raw: '' };
  const upper: SemVer = lo.minor === null ? { major: lo.major + 1, minor: 0, patch: 0, pre: [], raw: '' } : { major: lo.major, minor: lo.minor + 1, patch: 0, pre: [], raw: '' };
  return [{ op: '>=', ver: lower }, { op: '<', ver: upper }];
}
function wildcard(lo: { major: number; minor: number | null; patch: number | null }): Comparator[] {
  if (lo.minor === null) return [{ op: '>=', ver: { major: lo.major, minor: 0, patch: 0, pre: [], raw: '' } }, { op: '<', ver: { major: lo.major + 1, minor: 0, patch: 0, pre: [], raw: '' } }];
  if (lo.patch === null) return [{ op: '>=', ver: { major: lo.major, minor: lo.minor, patch: 0, pre: [], raw: '' } }, { op: '<', ver: { major: lo.major, minor: lo.minor + 1, patch: 0, pre: [], raw: '' } }];
  return [{ op: '=', ver: { major: lo.major, minor: lo.minor, patch: lo.patch, pre: [], raw: '' } }];
}

function parseComparator(token: string): Comparator[] | null {
  const t = token.trim();
  if (!t) return [];
  const m = /^(>=|<=|>|<|=|\^|~)?\s*(.+)$/.exec(t);
  if (!m) return null;
  const op = m[1] || ''; const rest = m[2] || '';
  const lo = parseLoose(rest);
  if (!lo) return null;
  if (op === '^') return caret(lo);
  if (op === '~') return tilde(lo);
  if (op === '') {
    if (lo.minor === null || lo.patch === null) return wildcard(lo);
    return [{ op: '=', ver: { major: lo.major, minor: lo.minor, patch: lo.patch, pre: lo.pre, raw: '' } }];
  }
  const ver: SemVer = { major: lo.major, minor: lo.minor ?? 0, patch: lo.patch ?? 0, pre: lo.pre, raw: '' };
  const map: Record<string, Comparator['op']> = { '>=': '>=', '<=': '<=', '>': '>', '<': '<', '=': '=' };
  const o = map[op];
  return o ? [{ op: o, ver }] : null;
}

function parseRangeGroup(group: string): Comparator[] | null {
  const g = group.trim();
  if (!g || g === '*' || g === 'x' || g === 'X') return [];
  // 连字符范围 A - B
  const hy = /^\s*(\S+)\s+-\s+(\S+)\s*$/.exec(g);
  if (hy) {
    const a = parseLoose(hy[1] || ''); const b = parseLoose(hy[2] || '');
    if (!a || !b) return null;
    const out: Comparator[] = [{ op: '>=', ver: { major: a.major, minor: a.minor ?? 0, patch: a.patch ?? 0, pre: a.pre, raw: '' } }];
    if (b.minor === null) out.push({ op: '<', ver: { major: b.major + 1, minor: 0, patch: 0, pre: [], raw: '' } });
    else if (b.patch === null) out.push({ op: '<', ver: { major: b.major, minor: b.minor + 1, patch: 0, pre: [], raw: '' } });
    else out.push({ op: '<=', ver: { major: b.major, minor: b.minor, patch: b.patch, pre: b.pre, raw: '' } });
    return out;
  }
  const out: Comparator[] = [];
  for (const tok of g.split(/\s+/)) {
    const cs = parseComparator(tok);
    if (cs === null) return null;
    out.push(...cs);
  }
  return out;
}

function cmpOp(v: SemVer, c: Comparator): boolean {
  const d = cmpSemVer(v, c.ver);
  switch (c.op) {
    case '>=': return d >= 0;
    case '>': return d > 0;
    case '<=': return d <= 0;
    case '<': return d < 0;
    case '=': return d === 0;
    default: return false;
  }
}

/** version 是否满足 range（node-semver 口径：预发布版仅当范围含同 [maj,min,patch] 预发布比较符时才匹配）。 */
export function semverSatisfies(version: string, range: string): boolean {
  const v = parseSemVer(version);
  if (!v) return false;
  const r = String(range == null ? '' : range).trim();
  if (!r || r === '*' || r === 'x' || r === 'X') return v.pre.length === 0;
  const groups = r.split('||');
  for (const g of groups) {
    const cs = parseRangeGroup(g);
    if (cs === null) continue;
    if (!cs.every((c) => cmpOp(v, c))) continue;
    if (v.pre.length) {
      // 预发布：需有同元组且带预发布的比较符
      const ok = cs.some((c) => c.ver.pre.length && c.ver.major === v.major && c.ver.minor === v.minor && c.ver.patch === v.patch);
      if (!ok) continue;
    }
    return true;
  }
  return false;
}

// ── LocalizedText ──
export function isLocalizedText(x: unknown): boolean {
  if (typeof x === 'string') return true;
  if (x && typeof x === 'object' && !Array.isArray(x)) {
    const o = x as Record<string, unknown>;
    if (typeof o.en !== 'string') return false;
    return Object.entries(o).every(([k, val]) => /^[a-z]{2,3}(?:-[a-z0-9]+)*$/i.test(k) && typeof val === 'string');
  }
  return false;
}
export function pickLocalized(x: LocalizedText | undefined, lang = 'en'): string {
  if (x == null) return '';
  if (typeof x === 'string') return x;
  const o = x as Record<string, string>;
  return String(o[lang] || o[lang.split('-')[0] || 'en'] || o.en || Object.values(o)[0] || '');
}

// ── 索引 URL 合法性 ──
export function validateIndexUrl(url: string): { ok: boolean; reason?: string } {
  const s = String(url || '').trim();
  if (!s) return { ok: false, reason: 'empty' };
  let u: URL;
  try { u = new URL(s); } catch { return { ok: false, reason: 'not-a-url' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'protocol-must-be-http-https' };
  if (u.username || u.password) return { ok: false, reason: 'no-userinfo' };
  if (u.hash) return { ok: false, reason: 'no-fragment' };
  return { ok: true };
}

// ── 索引格式校验（违规即拒整个索引，报 JSON 路径）──
export interface SuoYinCuoWu { path: string; reason: string; }
export function validateIndex(json: unknown): { ok: boolean; errors: SuoYinCuoWu[]; index?: SuoYin } {
  const errors: SuoYinCuoWu[] = [];
  const bad = (path: string, reason: string) => errors.push({ path, reason });
  if (!json || typeof json !== 'object' || Array.isArray(json)) { bad('$', 'index-must-be-object'); return { ok: false, errors }; }
  const o = json as Record<string, unknown>;
  if (o.format !== 1) bad('$.format', 'format-must-be-1');
  if (!isLocalizedText(o.title)) bad('$.title', 'title-required-localized');
  if (o.description !== undefined && !isLocalizedText(o.description)) bad('$.description', 'description-localized');
  const meta = (o.metadata || {}) as Record<string, unknown>;
  const categories = (meta.categories || {}) as Record<string, unknown>;
  const labels = (meta.labels || {}) as Record<string, unknown>;
  const sortKeys = (meta.sortKeys || {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(categories)) if (!v || typeof v !== 'object' || !isLocalizedText((v as Record<string, unknown>).title)) bad(`$.metadata.categories.${k}`, 'category-title-localized');
  for (const [k, v] of Object.entries(labels)) if (!v || typeof v !== 'object' || !isLocalizedText((v as Record<string, unknown>).title)) bad(`$.metadata.labels.${k}`, 'label-title-localized');
  for (const [k, v] of Object.entries(sortKeys)) {
    if (!v || typeof v !== 'object') { bad(`$.metadata.sortKeys.${k}`, 'sortkey-object'); continue; }
    const sv = v as Record<string, unknown>;
    if (!isLocalizedText(sv.title)) bad(`$.metadata.sortKeys.${k}.title`, 'sortkey-title-localized');
    if (sv.order !== undefined && sv.order !== 'asc' && sv.order !== 'desc') bad(`$.metadata.sortKeys.${k}.order`, 'order-asc-desc');
  }
  if (!Array.isArray(o.plugins)) { bad('$.plugins', 'plugins-array-required'); return { ok: false, errors }; }
  const names = new Set<string>();
  o.plugins.forEach((p0, i) => {
    const pp = `$.plugins[${i}]`;
    if (!p0 || typeof p0 !== 'object') { bad(pp, 'plugin-object'); return; }
    const p = p0 as Record<string, unknown>;
    if (typeof p.name !== 'string' || !p.name) bad(`${pp}.name`, 'name-required');
    else if (!/^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(p.name)) bad(`${pp}.name`, 'name-invalid-npm-grammar');
    else if (names.has(p.name)) bad(`${pp}.name`, 'name-duplicate');
    else names.add(p.name);
    if (p.title !== undefined && !isLocalizedText(p.title)) bad(`${pp}.title`, 'title-localized');
    if (p.description !== undefined && !isLocalizedText(p.description)) bad(`${pp}.description`, 'description-localized');
    if (p.homepage !== undefined && (typeof p.homepage !== 'string' || !/^https?:\/\//i.test(p.homepage))) bad(`${pp}.homepage`, 'homepage-absolute-http-https');
    if (p.icon !== undefined && typeof p.icon !== 'string') bad(`${pp}.icon`, 'icon-string');
    if (typeof p.icon === 'string' && p.icon.startsWith('data:') && p.icon.length > 32 * 1024) bad(`${pp}.icon`, 'inline-icon-max-32KiB');
    const pm = (p.metadata || {}) as Record<string, unknown>;
    if (pm.category !== undefined && !(String(pm.category) in categories)) bad(`${pp}.metadata.category`, 'undeclared-category');
    if (Array.isArray(pm.labels)) pm.labels.forEach((l, j) => { if (!(String(l) in labels)) bad(`${pp}.metadata.labels[${j}]`, 'undeclared-label'); });
    if (pm.sortKeys && typeof pm.sortKeys === 'object') for (const [k, v] of Object.entries(pm.sortKeys as Record<string, unknown>)) {
      if (!(k in sortKeys)) bad(`${pp}.metadata.sortKeys.${k}`, 'undeclared-sortkey');
      else if (v !== null && (typeof v !== 'number' || !Number.isFinite(v))) bad(`${pp}.metadata.sortKeys.${k}`, 'finite-number-or-null');
    }
    if (!Array.isArray(p.versions) || !p.versions.length) { bad(`${pp}.versions`, 'versions-nonempty-array'); return; }
    const vs = new Set<string>();
    (p.versions as unknown[]).forEach((v0, j) => {
      const vp = `${pp}.versions[${j}]`;
      if (!v0 || typeof v0 !== 'object') { bad(vp, 'version-object'); return; }
      const v = v0 as Record<string, unknown>;
      if (typeof v.version !== 'string' || !parseSemVer(v.version)) bad(`${vp}.version`, 'exact-semver-required');
      else if (vs.has(v.version)) bad(`${vp}.version`, 'version-duplicate');
      else vs.add(v.version);
      if (typeof v.publishTimestamp !== 'number' || !Number.isFinite(v.publishTimestamp)) bad(`${vp}.publishTimestamp`, 'unix-seconds-number');
      const src = v.source as Record<string, unknown> | undefined;
      if (!src || typeof src !== 'object') { bad(`${vp}.source`, 'source-required'); }
      else if (src.type === 'npm') { if (src.registry !== undefined && (typeof src.registry !== 'string' || !/^https:\/\//i.test(src.registry))) bad(`${vp}.source.registry`, 'registry-url-https-only'); }
      else if (src.type === 'git') {
        if (typeof src.url !== 'string' || !/^https:\/\//i.test(src.url)) bad(`${vp}.source.url`, 'git-url-https');
        if (typeof src.commit !== 'string' || !/^[0-9a-f]{40}$/i.test(src.commit)) bad(`${vp}.source.commit`, 'git-commit-40-hex');
        if (src.path !== undefined && typeof src.path !== 'string') bad(`${vp}.source.path`, 'path-string');
      } else bad(`${vp}.source.type`, 'source-type-npm-or-git');
      const eng = v.engines as Record<string, unknown> | undefined;
      if (eng !== undefined && (typeof eng !== 'object' || eng === null)) bad(`${vp}.engines`, 'engines-object');
      else if (eng) for (const [k, val] of Object.entries(eng)) if (typeof val !== 'string') bad(`${vp}.engines.${k}`, 'engine-range-string');
    });
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], index: json as SuoYin };
}

// ── 兼容 / 推荐版本 / 更新检测 ──
export function versionCompatible(v: SuoYinBanBen, hostVersion: string, hostKind: 'dsh' | 'warmy' = 'dsh'): boolean {
  const range = v.engines?.[hostKind];
  if (!range) return true; // 缺省表示任意版本
  return semverSatisfies(hostVersion, range);
}
function isPre(v: string): boolean { return (parseSemVer(v)?.pre.length || 0) > 0; }

/** 推荐版本：兼容且非预发布的最高版；无非预发布则兼容的最高预发布版。 */
export function recommendedVersion(versions: SuoYinBanBen[], hostVersion: string, hostKind: 'dsh' | 'warmy' = 'dsh'): SuoYinBanBen | null {
  const compat = (versions || []).filter((v) => parseSemVer(v.version) && versionCompatible(v, hostVersion, hostKind));
  if (!compat.length) return null;
  const stable = compat.filter((v) => !isPre(v.version));
  const pool = stable.length ? stable : compat;
  return pool.slice().sort((a, b) => cmpSemVer(parseSemVer(b.version)!, parseSemVer(a.version)!))[0] || null;
}

/** 更新检测：已装版本 vs 索引（推荐版高于已装 ⇒ 有更新）。 */
export function detectUpdate(installedVersion: string, versions: SuoYinBanBen[], hostVersion: string, hostKind: 'dsh' | 'warmy' = 'dsh'): { hasUpdate: boolean; recommended: string | null; latest: string | null } {
  const rec = recommendedVersion(versions, hostVersion, hostKind);
  const all = (versions || []).filter((v) => parseSemVer(v.version)).slice().sort((a, b) => cmpSemVer(parseSemVer(b.version)!, parseSemVer(a.version)!));
  const latest = all[0]?.version || null;
  const iv = parseSemVer(installedVersion);
  const rv = rec ? parseSemVer(rec.version) : null;
  const hasUpdate = !!(iv && rv && cmpSemVer(rv, iv) > 0);
  return { hasUpdate, recommended: rec?.version || null, latest };
}

// ── 模糊搜索（容忍拼写错误：子串 + 编辑距离≤2 的词匹配；最佳匹配排序）──
function editDistance(a: string, b: string): number {
  const m = a.length; const n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    const cur = [i];
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = cur;
  }
  return prev[n] ?? 0;
}
function pluginHaystack(p: SuoYinChaJian): string[] {
  const out: string[] = [p.name, String(p.author || '')];
  for (const key of ['title', 'description'] as const) {
    const v = p[key];
    if (typeof v === 'string') out.push(v);
    else if (v && typeof v === 'object') out.push(...Object.values(v));
  }
  if (Array.isArray(p.keywords)) out.push(...p.keywords.map(String));
  return out.map((s) => String(s).toLowerCase()).filter(Boolean);
}
export function searchPlugins(plugins: SuoYinChaJian[], query: string): SuoYinChaJian[] {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return plugins.slice(); // 空查询保留发布者默认顺序
  const terms = q.split(/\s+/).filter(Boolean);
  const scored: Array<{ p: SuoYinChaJian; score: number }> = [];
  for (const p of plugins) {
    const hay = pluginHaystack(p);
    const name = String(p.name || '').toLowerCase();
    let score = 0; let matchedAll = true;
    for (const term of terms) {
      let best = 0;
      if (name === term) best = 100;
      else if (name.includes(term)) best = 60;
      for (const h of hay) {
        if (h.includes(term)) best = Math.max(best, 40);
        else {
          for (const word of h.split(/[^a-z0-9\u4e00-\u9fff]+/)) {
            if (!word) continue;
            if (word === term) best = Math.max(best, 35);
            else if (Math.abs(word.length - term.length) <= 2 && editDistance(word, term) <= (term.length >= 5 ? 2 : 1)) best = Math.max(best, 20);
          }
        }
      }
      if (best === 0) matchedAll = false;
      score += best;
    }
    if (matchedAll && score > 0) scored.push({ p, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.p);
}

// ── 排序（缺失值恒排最后；0 是有效值）──
export function sortPlugins(plugins: SuoYinChaJian[], key: string, order: 'asc' | 'desc' = 'desc'): SuoYinChaJian[] {
  const arr = plugins.slice();
  const val = (p: SuoYinChaJian): number | null => {
    if (key === 'publishTimestamp') {
      const ts = (p.versions || []).map((v) => Number(v.publishTimestamp) || 0);
      return ts.length ? Math.max(...ts) : null;
    }
    const v = p.metadata?.sortKeys?.[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  arr.sort((a, b) => {
    const va = val(a); const vb = val(b);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;   // 缺失恒最后（与方向无关）
    if (vb === null) return -1;
    return order === 'asc' ? va - vb : vb - va;
  });
  return arr;
}

// ── 安装 spec / 图标解析 ──
export function installSpec(name: string, v: SuoYinBanBen): { kind: 'npm' | 'git'; spec: string; registry?: string } {
  if (v.source.type === 'npm') return { kind: 'npm', spec: `${name}@${v.version}`, ...(v.source.registry ? { registry: v.source.registry } : {}) };
  const s = v.source;
  const base = `git+${s.url.replace(/\.git$/, '')}.git#${s.commit}`;
  return { kind: 'git', spec: s.path ? `${base}&path:/${String(s.path).replace(/^\/+/, '')}` : base };
}
export function resolveIcon(icon: string | undefined, indexUrl: string): string | null {
  if (!icon) return null;
  if (icon.startsWith('data:')) return icon;
  try {
    const base = new URL(indexUrl);
    const u = new URL(icon, base);
    if (u.origin !== base.origin && u.protocol !== 'https:') return null; // 跨源绝对图标必须 https
    return u.href;
  } catch { return null; }
}