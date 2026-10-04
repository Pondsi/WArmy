/**
 * agent-tools —— 开箱即用智能体的工具面：受限 shell / skill 发现与安装 / 网络 / Office 读。
 *
 * 授权模型（产品定稿，与聊天框顶上的授权选项**同一套**）：
 *  ┌──────────┬──────────────────────────────┬──────────────────────────────┐
 *  │ 档位     │ shell                        │ skill 安装                    │
 *  ├──────────┼──────────────────────────────┼──────────────────────────────┤
 *  │ 完全授权 │ 无命令限制（仍禁 NUL/超长）   │ 可自行安装；**先过安全检测**   │
 *  │ 严格授权 │ 全部询问；不勾「允许提权」则  │ 全部询问；不勾则直接拒绝      │
 *  │          │ 直接拒绝                     │                              │
 *  │ 常规授权 │ 受限 shell（白名单）          │ 受限安装：检测安全且低权限→   │
 *  │          │ 白名单外→询问（或拒绝）      │ 自动装；否则询问              │
 *  └──────────┴──────────────────────────────┴──────────────────────────────┘
 * 「允许提权」勾选框 = askOnExceed：决定"询问"还是"直接拒绝"。
 *
 * 安全检测（anquanJianCe）是**装之前必过**的一关：静态扫描 shell 命令与 skill 包里的
 * 危险模式（rm -rf / curl|bash / sudo / 注册表 / 外发 等），给低/中/高风险评级。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';

export type AnquanDang = 'normal' | 'strict' | 'full';
export type FengXian = 'low' | 'medium' | 'high';

export interface AnquanJianCeJieGuo {
  ok: boolean;
  risk: FengXian;
  reasons: string[];
  /** 是否允许在「常规授权」下免询问自动执行/安装（= 风险低且权限小） */
  autoOk: boolean;
  summary: string;
}

/* ─────────────────────── 危险模式库（静态检测） ─────────────────────── */

const GAO_WEI_XIAN: Array<[RegExp, string]> = [
  [/rm\s+(-[a-z]*\s+)*-rf?\s+[~\/]/i, '递归删除家目录/根目录'],
  [/rm\s+-rf\s+\/(?!\w)/i, '删除根目录'],
  [/curl[^\n|]*\|\s*(ba|z)?sh/i, '下载并直接执行（curl|sh）'],
  [/wget[^\n|]*\|\s*(ba|z)?sh/i, '下载并直接执行（wget|sh）'],
  [/\bsudo\b/i, '提权执行（sudo）'],
  [/reg(\.exe)?\s+add/i, '写注册表'],
  [/Remove-Item\s+.*-Recurse\s+.*-[Ff]orce/i, 'PowerShell 强制递归删除'],
  [/Format-Volume|diskpart|mkfs/i, '格式化磁盘'],
  [/:\(\)\s*\{.*\|.*&.*\};\s*:/, 'fork 炸弹'],
  [/Invoke-Expression|iex\s*\(/i, '动态执行字符串（易被注入）'],
  [/\bchmod\s+777\b/i, '全开权限（chmod 777）'],
  [/>\s*\/dev\/sd[a-z]/i, '直接写块设备'],
];

const ZHONG_WEI_XIAN: Array<[RegExp, string]> = [
  [/\brm\s+-rf?\b/i, '递归删除'],
  [/\bsudo\b/i, '提权'],
  [/\bchmod\b/i, '改权限'],
  [/\bchown\b/i, '改属主'],
  [/pip\s+install|npm\s+install|yarn\s+add|pnpm\s+add/i, '安装第三方依赖'],
  [/git\s+push/i, '推送远端'],
  [/systemctl|sc\s+config|net\s+stop|net\s+start/i, '操作系统服务'],
  [/\bcurl\b|\bwget\b/i, '访问网络下载'],
  [/os\.system|subprocess|child_process|exec\(|eval\(/i, '代码里执行外部命令'],
  [/process\.env|getenv|SECRET|TOKEN|PASSWORD|API[_-]?KEY/i, '触碰密钥类环境变量'],
  [/fetch\(|XMLHttpRequest|axios|urllib|requests\./i, '代码里发起网络请求'],
];

const DI_WEI_XIAN: Array<[RegExp, string]> = [
  [/^[\w./\\:@%+\-\s]+$/, '纯读写/列目录类命令'],
];

/** 命令/脚本静态检测 */
export function anquanJianCeMingLing(cmd: string): AnquanJianCeJieGuo {
  const s = String(cmd || '');
  const reasons: string[] = [];
  let risk: FengXian = 'low';
  for (const [re, why] of GAO_WEI_XIAN) {
    if (re.test(s)) { risk = 'high'; reasons.push('高风险：' + why); }
  }
  if (risk !== 'high') {
    for (const [re, why] of ZHONG_WEI_XIAN) {
      if (re.test(s)) { risk = 'medium'; reasons.push('中风险：' + why); }
    }
  }
  if (!reasons.length) reasons.push('未命中危险模式');
  return {
    ok: risk === 'low',
    risk,
    reasons,
    autoOk: risk === 'low',
    summary: `风险 ${risk}：${reasons.join('；')}`,
  };
}

/** skill 包静态检测：扫 SKILL.md 与里面的脚本 */
export function anquanJianCeJiNeng(mulu: string): AnquanJianCeJieGuo {
  const reasons: string[] = [];
  let risk: FengXian = 'low';
  try {
    const gen = (p: string): string[] => {
      const out: string[] = [];
      let st: fs.Stats;
      try { st = fs.statSync(p); } catch { return out; }
      if (st.isDirectory()) {
        let ems: string[] = [];
        try { ems = fs.readdirSync(p); } catch { return out; }
        for (const e of ems.slice(0, 200)) out.push(...gen(path.join(p, e)));
      } else out.push(p);
      return out;
    };
    const wenJian = gen(mulu);
    if (!wenJian.length) { reasons.push('目录为空'); }
    let zong = 0;
    for (const f of wenJian) {
      if (zong > 40) break;
      if (/\.(md|txt|js|mjs|cjs|ts|py|sh|ps1|bat|cmd|json|ya?ml)$/i.test(f) === false) continue;
      zong++;
      let txt = '';
      try { txt = fs.readFileSync(f, 'utf8').slice(0, 200 * 1024); } catch { continue; }
      const c1 = anquanJianCeMingLing(txt);
      if (c1.risk === 'high') { risk = 'high'; reasons.push(`高风险文件 ${path.basename(f)}：${c1.reasons.join('；')}`); }
      else if (c1.risk === 'medium' && risk !== 'high') { risk = 'medium'; reasons.push(`中风险文件 ${path.basename(f)}：${c1.reasons.join('；')}`); }
    }
    // 权限面：是否声明了可执行/网络/密钥
    try {
      const sk = path.join(mulu, 'SKILL.md');
      if (fs.existsSync(sk)) {
        const t = fs.readFileSync(sk, 'utf8');
        if (/shell|exec|终端|命令行/i.test(t) && risk === 'low') { risk = 'medium'; reasons.push('SKILL.md 声明会执行命令'); }
      }
    } catch { /* noop */ }
  } catch (e) {
    risk = 'high';
    reasons.push('读取失败：' + String((e as Error)?.message || e));
  }
  if (!reasons.length) reasons.push('未命中危险模式');
  return {
    ok: risk === 'low',
    risk,
    reasons,
    autoOk: risk === 'low',
    summary: `风险 ${risk}：${reasons.slice(0, 4).join('；')}`,
  };
}

/* ─────────────────────── 授权决策 ─────────────────────── */

export interface ShouQuanPanDuan {
  /** 直接执行 */
  allow: boolean;
  /** 需要弹卡问用户 */
  needAsk: boolean;
  /** 拒绝原因（allow=false 且 needAsk=false 时给） */
  why: string;
}

/**
 * 按授权档位 + 「允许提权」勾选 决定一个动作是否放行。
 * @param kind 'shell' | 'skill'
 */
export function panDuanShouQuan(
  dang: AnquanDang,
  askOnExceed: boolean,
  kind: 'shell' | 'skill',
  jiance: AnquanJianCeJieGuo,
): ShouQuanPanDuan {
  if (dang === 'full') {
    // 完全授权：shell 无限制；skill 仍要过安全检测（产品要求："确保安全再装"）
    if (kind === 'skill' && jiance.risk === 'high') {
      return askOnExceed
        ? { allow: false, needAsk: true, why: '高风险 skill，需用户确认' }
        : { allow: false, needAsk: false, why: '高风险 skill 被拒（未勾「允许提权」）' };
    }
    return { allow: true, needAsk: false, why: '' };
  }
  if (dang === 'strict') {
    // 严格授权：一律询问；不勾「允许提权」= 直接拒绝
    return askOnExceed
      ? { allow: false, needAsk: true, why: '严格授权需用户逐次确认' }
      : { allow: false, needAsk: false, why: '严格授权且未勾「允许提权」⇒ 直接拒绝' };
  }
  // 常规授权：低风险才自动放行；中/高风险询问或拒绝
  if (jiance.autoOk) return { allow: true, needAsk: false, why: '' };
  return askOnExceed
    ? { allow: false, needAsk: true, why: jiance.summary }
    : { allow: false, needAsk: false, why: jiance.summary + '（未勾「允许提权」⇒ 拒绝）' };
}

/* ─────────────────────── 受限 shell ─────────────────────── */

/** 常规授权下的命令白名单（只读 + 安全构建类） */
export const MING_LING_BAI_MING_DAN = [
  'ls', 'dir', 'cat', 'type', 'head', 'tail', 'pwd', 'cd', 'echo', 'whoami', 'hostname', 'date',
  'find', 'grep', 'rg', 'wc', 'file', 'stat', 'du', 'df', 'node', 'python', 'python3', 'py',
  'npm', 'npx', 'pnpm', 'yarn', 'git', 'mkdir', 'cp', 'copy', 'mv', 'move', 'python -m',
];

export function zaiBaiMingDan(cmd: string): boolean {
  const t = String(cmd || '').trim();
  if (!t) return false;
  // 取第一个词（Windows 下也可能是 .exe）
  const first = (t.split(/\s+/)[0] || '').replace(/\.exe$/i, '');
  return MING_LING_BAI_MING_DAN.some((w) => first.toLowerCase() === w.toLowerCase());
}

export interface MingLingJieGuo {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  ms: number;
  risk: FengXian;
}

export function yunXingMingLing(cmd: string, opts: { cwd?: string; timeoutMs?: number; maxOut?: number } = {}): Promise<MingLingJieGuo> {
  const timeoutMs = Math.max(1000, Math.min(Number(opts.timeoutMs) || 60000, 10 * 60 * 1000));
  const maxOut = Math.max(200, Math.min(Number(opts.maxOut) || 8000, 40000));
  const jiance = anquanJianCeMingLing(cmd);
  return new Promise((resolve) => {
    const t0 = Date.now();
    // 统一走 shell，但命令串已经过静态检测与授权判定（调用方负责判定）
    const sh = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
    const args = process.platform === 'win32' ? ['/d', '/s', '/c', cmd] : ['-c', cmd];
    execFile(sh, args, {
      cwd: opts.cwd || os.homedir(),
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    }, (err, stdout, stderr) => {
      const out = String(stdout || '').slice(0, maxOut);
      const er = String(stderr || '').slice(0, maxOut);
      const code = err && typeof (err as { code?: number }).code === 'number' ? ((err as { code?: number }).code as number) : (err ? 1 : 0);
      resolve({ ok: !err, code, stdout: out, stderr: er, ms: Date.now() - t0, risk: jiance.risk });
    });
  });
}

/* ─────────────────────── Office 读 ─────────────────────── */

function duZipMing(buf: Buffer): Map<string, Buffer> {
  // 轻量解包：只取需要的 xml（store/deflate）
  const out = new Map<string, Buffer>();
  let off = 0;
  const zlib = require('node:zlib') as typeof import('node:zlib');
  while (off + 30 <= buf.length) {
    if (buf.readUInt32LE(off) !== 0x04034b50) break;
    const method = buf.readUInt16LE(off + 8);
    const csize = buf.readUInt32LE(off + 18);
    const nlen = buf.readUInt16LE(off + 26);
    const elen = buf.readUInt16LE(off + 28);
    const name = buf.subarray(off + 30, off + 30 + nlen).toString('utf8');
    const start = off + 30 + nlen + elen;
    const raw = buf.subarray(start, start + csize);
    try { out.set(name, method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw)); } catch { /* skip */ }
    off = start + csize;
  }
  return out;
}

function quBiaoQianWenBen(xml: string, biaoQian: string): string[] {
  const re = new RegExp(`<${biaoQian}[^>]*>([\\s\\S]*?)</${biaoQian}>`, 'g');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const inner = (m[1] || '').replace(/<[^>]+>/g, '');
    if (inner.trim()) out.push(inner.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'));
  }
  return out;
}

export function duDocx(p: string): { ok: boolean; text: string; error?: string } {
  try {
    const buf = fs.readFileSync(p);
    const parts = duZipMing(buf);
    const doc = parts.get('word/document.xml');
    if (!doc) return { ok: false, text: '', error: 'not-a-docx' };
    const xml = doc.toString('utf8');
    return { ok: true, text: quBiaoQianWenBen(xml, 'w:t').join('\n') };
  } catch (e) { return { ok: false, text: '', error: String((e as Error)?.message || e) }; }
}

export function duPptx(p: string): { ok: boolean; slides: string[]; error?: string } {
  try {
    const buf = fs.readFileSync(p);
    const parts = duZipMing(buf);
    const slides: string[] = [];
    const names = [...parts.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => (parseInt(a.replace(/\D+/g, '') || '0') - parseInt(b.replace(/\D+/g, '') || '0')));
    for (const n of names) {
      const xml = (parts.get(n) as Buffer).toString('utf8');
      slides.push(quBiaoQianWenBen(xml, 'a:t').join('\n'));
    }
    if (!slides.length) return { ok: false, slides: [], error: 'not-a-pptx' };
    return { ok: true, slides };
  } catch (e) { return { ok: false, slides: [], error: String((e as Error)?.message || e) }; }
}

/* ─────────────────────── 网络 ─────────────────────── */

export async function zhuaQuWangZhi(url: string, opts: { maxBytes?: number; timeoutMs?: number } = {}): Promise<{ ok: boolean; status?: number; text?: string; bytes?: number; error?: string }> {
  try {
    if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'only-http-https' };
    const max = Math.max(1024, Math.min(Number(opts.maxBytes) || 200000, 2 * 1024 * 1024));
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), Math.max(2000, Math.min(Number(opts.timeoutMs) || 20000, 60000)));
    try {
      const res = await fetch(url, { signal: ac.signal, redirect: 'follow' });
      const buf = Buffer.from(await res.arrayBuffer());
      return {
        ok: res.ok,
        status: res.status,
        text: buf.subarray(0, max).toString('utf8'),
        bytes: buf.length,
        ...(res.ok ? {} : { error: 'HTTP ' + res.status }),
      };
    } finally { clearTimeout(t); }
  } catch (e) { return { ok: false, error: String((e as Error)?.message || e) }; }
}

export async function xiaZaiWenJian(url: string, saveTo: string, opts: { maxBytes?: number; timeoutMs?: number } = {}): Promise<{ ok: boolean; path?: string; bytes?: number; error?: string }> {
  try {
    if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'only-http-https' };
    const max = Math.max(1024, Math.min(Number(opts.maxBytes) || 50 * 1024 * 1024, 200 * 1024 * 1024));
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), Math.max(5000, Math.min(Number(opts.timeoutMs) || 120000, 10 * 60 * 1000)));
    try {
      const res = await fetch(url, { signal: ac.signal, redirect: 'follow' });
      if (!res.ok) return { ok: false, error: 'HTTP ' + res.status };
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > max) return { ok: false, error: `too-large (${buf.length} > ${max})` };
      fs.mkdirSync(path.dirname(saveTo), { recursive: true });
      fs.writeFileSync(saveTo, buf);
      return { ok: true, path: saveTo, bytes: buf.length };
    } finally { clearTimeout(t); }
  } catch (e) { return { ok: false, error: String((e as Error)?.message || e) }; }
}
