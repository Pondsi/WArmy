/**
 * local-search —— **统一本地搜索**（用户主动搜索 + 模型只读搜索共用）。
 *
 * 用户口径（第 123 轮）：
 *   · 顺序：当前会话 → 程序全部界面文案 → 其他会话 → 知识库等应用内容 → 程序外全盘；
 *   · 全盘**不建常驻索引**，每次按需扫描；结果必须标出盘符（C:/D:）；
 *   · 密钥等敏感内容不排除，但**默认打码**；用户悬停才解密显示，移开恢复；
 *   · 模型只能搜会话已授权的范围；全盘只允许「我的牛马」会话，并且每次弹授权；
 *   · 搜索**只读**：本模块没有任何写/删/改文件的导出。
 *
 * 纯函数 + 可注入根目录，门禁不联网、不碰真实整盘。
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export type SousuoFenQu = 'session' | 'ui' | 'otherSessions' | 'knowledge' | 'workspace' | 'disk';

export interface SousuoMingzhong {
  section: SousuoFenQu;
  title: string;
  /** 已经打码的展示文本（渲染层默认只显示这个） */
  snippet: string;
  meta?: string;
  path?: string;
  drive?: string;
  key?: string;
  revealId?: string;
  sensitive?: boolean;
  ts?: number;
  score?: number;
  /** 仅主进程内部用于建立悬停解密映射；**不得**直接回给渲染层 */
  full?: string;
}

export interface UIWenAnTiao {
  locale: string;
  key: string;
  value: string;
}

export interface SousuoFenQuJie {
  id: SousuoFenQu;
  title: string;
  items: SousuoMingzhong[];
  note?: string;
}

const MIN_GAN_PATTERNS: Array<{ re: RegExp; keep?: RegExp }> = [
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { re: /\bsk-(?:ant-)?[A-Za-z0-9_-]{10,}\b/g },
  { re: /\bAKIA[0-9A-Z]{16}\b/g },
  { re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g },
  { re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { re: /(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/g, keep: /^Bearer\s+/ },
  { re: /((?:api[_-]?key|secret|token|passwd|password|passphrase|access[_-]?key|密钥|密码|口令)\s*[:=：]\s*["']?)([^\s"',;]{4,})/gi, keep: /^[^:=：]+[:=：]\s*["']?$/ },
];

/** 默认打码：返回可展示文本 + 是否命中敏感模式。**绝不在这里把明文回给渲染层。** */
export function daMa(text: string): { text: string; sensitive: boolean } {
  let out = String(text ?? '');
  let sensitive = false;
  for (const p of MIN_GAN_PATTERNS) {
    out = out.replace(p.re, (...args) => {
      const m = String(args[0] || '');
      sensitive = true;
      if (p.keep) {
        const k = m.match(p.keep);
        if (k) return k[0] + '*****';
      }
      return '*****';
    });
  }
  if (/助记词|mnemonic|seed phrase/i.test(out)) {
    sensitive = true;
    out = out.replace(/((?:助记词|mnemonic|seed phrase)\s*[:：]?\s*)[^\n]*/gi, '$1*****');
  }
  return { text: out, sensitive };
}

function fenQuMing(id: SousuoFenQu): string {
  return ({
    session: '当前会话',
    ui: '程序界面',
    otherSessions: '其他会话',
    knowledge: '知识库',
    workspace: '本会话工作区',
    disk: '本机磁盘',
  } as Record<SousuoFenQu, string>)[id] || id;
}

/** 从界面文案里按关键词找（同一 key 的多种语言只出一条；当前语言优先） */
export function chaUIWenAn(entries: UIWenAnTiao[], query: string, opts: { limit?: number; locale?: string } = {}): SousuoMingzhong[] {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const limit = Math.max(1, Math.min(50, Number(opts.limit) || 15));
  const byKey = new Map<string, UIWenAnTiao[]>();
  for (const e of Array.isArray(entries) ? entries : []) {
    const k = String(e?.key || '').trim();
    const v = String(e?.value || '').trim();
    if (!k || !v) continue;
    const arr = byKey.get(k) || [];
    arr.push({ locale: String(e.locale || ''), key: k, value: v });
    byKey.set(k, arr);
  }
  const hits: Array<{ it: UIWenAnTiao; score: number }> = [];
  for (const arr of byKey.values()) {
    let best: { it: UIWenAnTiao; score: number } | null = null;
    for (const it of arr) {
      const v = it.value.toLowerCase();
      const score = v === q ? 0 : v.startsWith(q) ? 1 : v.includes(q) ? 2 : 9;
      if (score > 8) continue;
      if (!best || score < best.score || (score === best.score && it.locale === opts.locale)) best = { it, score };
    }
    if (best) hits.push(best);
  }
  hits.sort((a, b) => a.score - b.score || a.it.value.localeCompare(b.it.value));
  return hits.slice(0, limit).map(({ it }) => {
    const dm = daMa(it.value);
    return {
      section: 'ui' as const,
      title: it.value,
      snippet: dm.text,
      meta: '界面文案 · ' + it.key,
      key: it.key,
      sensitive: dm.sensitive,
      full: dm.sensitive ? it.value : undefined,
    };
  });
}

/** 从主进程/渲染层源码里提取**用户看得见的短文案**（静态标签、按钮、提示）。 */
export function tiQuJieMianWenAn(source: string, opts: { max?: number } = {}): string[] {
  const max = Math.max(1, Math.min(20000, Number(opts.max) || 6000));
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /(['"`])((?:\\.|(?!\1)[^\\\r\n]){2,80})\1/g;
  for (const m of String(source || '').matchAll(re)) {
    const raw = String(m[2] || '');
    if (!raw || seen.has(raw)) continue;
    if (!/[\u3400-\u9fff]/.test(raw) && !/^[A-Z][A-Za-z0-9 &/·:+-]{1,40}$/.test(raw)) continue;
    if (/https?:\/\/|function|=>|==|\breturn\b|\bconst\b|\bvar\b|className|data-|--[a-z]|#[0-9a-f]{3,8}\b/i.test(raw)) continue;
    if (/^[a-z0-9_.-]+$/.test(raw)) continue;
    seen.add(raw);
    out.push(raw);
    if (out.length >= max) break;
  }
  return out;
}

/** 静态文案过滤：把 URL、代码、CSS 变量等噪声挡在界面索引外 */
function shiJieMianWenAn(raw: string): boolean {
  const s = String(raw || '').trim();
  if (!s || s.length > 300) return false;
  if (!/[\u3400-\u9fff]/.test(s) && !/^[A-Z][A-Za-z0-9 &/·:+-]{1,60}$/.test(s)) return false;
  if (/https?:\/\/|function|=>|==|\breturn\b|\bconst\b|\bvar\b|className|data-|--[a-z]|#[0-9a-f]{3,8}\b/i.test(s)) return false;
  if (/^[a-z0-9_.-]+$/.test(s)) return false;
  return true;
}

/** 由 i18n JSON + 静态文案组成界面索引（同一文案只留一条） */
export function jianUIWenAnSuoYin(packs: Array<{ locale: string; strings: Record<string, unknown> }>, staticText: string[] = []): UIWenAnTiao[] {
  const out: UIWenAnTiao[] = [];
  const seen = new Set<string>();
  for (const p of packs) {
    for (const [key, val] of Object.entries(p.strings || {})) {
      const v = String(val ?? '').trim();
      if (!shiJieMianWenAn(v)) continue;
      const dedup = key + '\u0000' + v;
      if (seen.has(dedup)) continue;
      seen.add(dedup);
      out.push({ locale: p.locale, key, value: v });
    }
  }
  staticText.forEach((v, i) => {
    const s = String(v || '').trim();
    if (!shiJieMianWenAn(s)) return;
    out.push({ locale: 'static', key: 'ui.static.' + i, value: s });
  });
  return out;
}

const TIAO_GUO_MU = new Set([
  'System Volume Information', '$Recycle.Bin', '$WinREAgent', 'Recovery', 'PerfLogs',
  'Windows', 'WinSxS',
  'node_modules', '.git', '.svn', '.hg',
  'Cache', 'cache', 'Code Cache', 'GPUCache', 'Service Worker', 'Crashpad', 'blob_storage',
  'Temp', 'tmp',
]);
const WEN_BEN_KUO = new Set([
  '.txt', '.md', '.markdown', '.json', '.jsonl', '.csv', '.tsv', '.log', '.ini', '.cfg', '.conf',
  '.yaml', '.yml', '.toml', '.xml', '.html', '.htm', '.css', '.scss', '.js', '.mjs', '.cjs',
  '.ts', '.tsx', '.jsx', '.py', '.ps1', '.bat', '.cmd', '.sh', '.bash', '.zsh', '.sql',
  '.java', '.cs', '.cpp', '.c', '.h', '.hpp', '.go', '.rs', '.rb', '.php', '.lua', '.r',
  '.env', '.properties', '.gitignore', '.dockerfile', '.vue', '.svelte',
]);

function panFuOf(root: string): string {
  const m = String(root || '').match(/^([A-Za-z]):[\\/]/);
  return m ? String(m[1] || '').toUpperCase() + ':' : String(root || '').slice(0, 1) || '/';
}

/** Windows 列出存在的盘符；其它平台只扫根。 */
export function liePanFu(): string[] {
  if (process.platform !== 'win32') return ['/'];
  const out: string[] = [];
  for (let c = 65; c <= 90; c++) {
    const r = String.fromCharCode(c) + ':\\';
    try { if (fs.existsSync(r)) out.push(r); } catch { /* 无权限盘跳过 */ }
  }
  return out.length ? out : ['C:\\'];
}

/**
 * 全盘扫描的**优先根**：用户主目录先扫（文档/配置/密钥大多在这里），再扫各盘。
 * 结果仍按真实盘符标注；同一文件只出一条。
 */
export function lieQuanPanGen(): string[] {
  const out: string[] = [];
  try {
    const home = os.homedir();
    if (home && fs.existsSync(home)) out.push(home);
  } catch { /* 主目录取不到就只扫盘 */ }
  for (const r of liePanFu()) {
    if (!out.some((x) => path.resolve(x).toLowerCase() === path.resolve(r).toLowerCase())) out.push(r);
  }
  return out.length ? out : liePanFu();
}

export interface QuanPanXuanXiang {
  roots?: string[];
  maxMs?: number;
  maxResults?: number;
  maxFiles?: number;
  maxDepth?: number;
  maxBytes?: number;
  signal?: AbortSignal;
}

export interface QuanPanJieGuo {
  items: SousuoMingzhong[];
  roots: string[];
  files: number;
  errors: number;
  truncated: boolean;
  ms: number;
}

/**
 * 按需全盘扫描：**不建索引、不落盘**。只读文本类文件，命中行才返回。
 * 盘符标签随结果带回；超时/超量会如实标 truncated。
 */
export async function saoMiaoQuanPan(query: string, opts: QuanPanXuanXiang = {}): Promise<QuanPanJieGuo> {
  const q = String(query || '').trim();
  const qi = Date.now();
  const maxMs = Math.max(500, Math.min(60000, Number(opts.maxMs) || 8000));
  const maxResults = Math.max(1, Math.min(200, Number(opts.maxResults) || 40));
  const maxFiles = Math.max(1, Math.min(500000, Number(opts.maxFiles) || 80000));
  const maxDepth = Math.max(1, Math.min(30, Number(opts.maxDepth) || 12));
  const maxBytes = Math.max(1024, Math.min(8 * 1024 * 1024, Number(opts.maxBytes) || 2 * 1024 * 1024));
  const roots = (Array.isArray(opts.roots) && opts.roots.length ? opts.roots : lieQuanPanGen()).map((x) => path.resolve(String(x)));
  const items: SousuoMingzhong[] = [];
  let files = 0;
  let errors = 0;
  let truncated = false;
  const yiJian = new Set<string>();
  if (!q) return { items, roots, files, errors, truncated, ms: 0 };

  const chao = () => Date.now() - qi > maxMs || items.length >= maxResults || files >= maxFiles || !!opts.signal?.aborted;

  async function wenJian(p: string, root: string): Promise<void> {
    if (yiJian.has(p.toLowerCase())) return;
    yiJian.add(p.toLowerCase());
    let st: fs.Stats;
    try { st = await fsp.stat(p); } catch { return; }
    if (!st.isFile() || st.size > maxBytes) return;
    let buf: Buffer;
    try { buf = await fsp.readFile(p); } catch { errors++; return; }
    const text = buf.toString('utf8');
    if (!text || text.includes('\u0000')) return;
    const low = text.toLowerCase();
    const ql = q.toLowerCase();
    let at = low.indexOf(ql);
    if (at < 0) return;
    let n = 0;
    while (at >= 0 && n < 2 && items.length < maxResults) {
      const lineStart = text.lastIndexOf('\n', at) + 1;
      const lineEnd = text.indexOf('\n', at);
      const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd).trim();
      if (line) {
        const dm = daMa(line.slice(0, 320));
        items.push({
          section: 'disk',
          title: path.basename(p),
          snippet: dm.text,
          meta: panFuOf(root) + ' · ' + p,
          path: p,
          drive: panFuOf(root),
          sensitive: dm.sensitive,
          full: dm.sensitive ? line.slice(0, 320) : undefined,
        });
        n++;
      }
      at = low.indexOf(ql, at + ql.length);
    }
  }

  async function muLu(dir: string, root: string, depth: number): Promise<void> {
    if (chao()) { truncated = true; return; }
    let ents: fs.Dirent[];
    try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { errors++; return; }
    const ziMu: string[] = [];
    // 先读本层文件，再下钻目录：用户放在主目录/桌面根部的文件不该被深层目录挤掉时间预算
    for (const e of ents) {
      if (chao()) { truncated = true; return; }
      if (e.isSymbolicLink()) continue;
      const p = path.join(dir, e.name);
      if (e.isFile()) {
        files++;
        const ext = path.extname(e.name).toLowerCase();
        if (ext && !WEN_BEN_KUO.has(ext) && e.name.toLowerCase() !== 'dockerfile') continue;
        await wenJian(p, root);
      } else if (e.isDirectory()) {
        if (TIAO_GUO_MU.has(e.name) || e.name.startsWith('.')) continue;
        if (depth >= maxDepth) { truncated = true; continue; }
        ziMu.push(p);
      }
    }
    for (const p of ziMu) {
      if (chao()) { truncated = true; return; }
      await muLu(p, root, depth + 1);
    }
  }

  for (const root of roots) {
    if (chao()) { truncated = true; break; }
    await muLu(root, root, 0);
  }
  return { items, roots: roots.map(panFuOf), files, errors, truncated, ms: Date.now() - qi };
}

/** 会话/知识库/工作区等结构化结果统一成同一种命中项 */
export function zhengLiMingzhong(
  section: SousuoFenQu,
  rows: Array<{ title?: string; snippet?: string; meta?: string; path?: string; key?: string; ts?: number }>,
  limit = 20,
): SousuoMingzhong[] {
  return rows.slice(0, Math.max(1, limit)).map((r) => {
    const raw = String(r.snippet || r.title || '');
    const dm = daMa(raw);
    return {
      section,
      title: String(r.title || '').trim() || raw.slice(0, 60),
      snippet: dm.text,
      meta: r.meta,
      path: r.path,
      key: r.key,
      ts: r.ts,
      sensitive: dm.sensitive,
      full: dm.sensitive ? raw : undefined,
    };
  });
}

/** 给模型看的只读文本（敏感项只给打码文本；绝不给 full） */
export function geShiSousuoJieGuo(sections: SousuoFenQuJie[], opts: { maxChars?: number } = {}): string {
  const max = Math.max(500, Math.min(12000, Number(opts.maxChars) || 6000));
  const out: string[] = [];
  for (const s of sections) {
    if (!s.items.length) continue;
    out.push('## ' + (s.title || fenQuMing(s.id)) + (s.note ? '（' + s.note + '）' : ''));
    s.items.forEach((x, i) => {
      out.push(`[${i + 1}] ${x.title}${x.meta ? ' — ' + x.meta : ''}\n    ${x.snippet}`);
    });
  }
  const text = out.join('\n');
  return (text.length > max ? text.slice(0, max) + '\n…（结果已截断）' : text)
    + '\n（本地搜索只读：不能修改/删除任何文件；敏感内容已打码，不要尝试还原。）';
}

export { fenQuMing };
