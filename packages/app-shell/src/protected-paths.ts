/**
 * 第 93 轮：**完全授权也不是无边界**。
 *
 * 用户口径：
 *  · 完全授权 = 本会话工作区 + 除“程序安装目录”以外的所有目录；
 *  · 但**其他会话的工作区 / 历史记录**仍然禁止；
 *  · 程序安装目录仍然禁止；
 *  · 访问这些禁止区域要单独申请授权；命令类操作直接拒绝并告诉模型换方法，不打扰用户。
 *
 * 纯函数 + 一个小型一次性授权集合，便于在 Node 里直接跑真值表。
 */
import path from 'node:path';

/** 程序安装目录（由主进程在启动时注入：app.getAppPath()、execPath 目录、开发态仓库根） */
let programDirs: string[] = [];

export function setProgramDirs(dirs: readonly string[]): void {
  programDirs = dirs.map((d) => path.resolve(String(d || ''))).filter(Boolean);
}
export function getProgramDirs(): string[] {
  return programDirs.slice();
}

/** 用户数据里属于“其他会话 / 历史 / 记忆”的目录名（相对 userData） */
const PROTECTED_DATA = [
  'workspace', 'memory', 'checkpoints', 'archive', 'guifan', 'impressions', 'yaoqiu',
  'board', 'bus', 'auth',
];
/** 用户数据根下的敏感文件（历史 / 账号 / 设置） */
const PROTECTED_FILES = [
  'chat-logs.json', 'chat-meta.json', 'profile.json', 'settings.json', 'appearance.json',
  'join-requests.json', 'plans.json',
];

const yiCi = new Set<string>();
const normCase = (p: string): string => (process.platform === 'win32' ? p.toLowerCase() : p);
const buZhouJian = (p: string): string => {
  const x = path.resolve(p);
  return x.endsWith(path.sep) ? x : x + path.sep;
};
function inside(child: string, parent: string): boolean {
  const c = buZhouJian(child);
  const p = buZhouJian(parent);
  return normCase(c).startsWith(normCase(p));
}

/** 一次性放行（用户在授权卡里明确同意后，主进程调用；下一次写/读消费掉） */
export function grantProtectedOnce(abs: string): void {
  const p = path.resolve(String(abs || ''));
  if (p) yiCi.add(normCase(p));
}
export function consumeProtectedOnce(abs: string): boolean {
  const k = normCase(path.resolve(String(abs || '')));
  if (!yiCi.has(k)) return false;
  yiCi.delete(k);
  return true;
}

/**
 * 返回禁止原因；null = 允许。
 * @param abs 已解析的绝对路径
 * @param baseDir 当前会话工作区（userData/workspace/<sid>）
 */
export function protectedPathReason(abs: string, baseDir: string): string | null {
  try {
    const p = path.resolve(String(abs || ''));
    if (!p) return null;
    /** 程序安装目录：永远禁止（即使完全授权） */
    for (const d of programDirs) if (inside(p, d)) return '程序安装目录';
    const base = path.resolve(String(baseDir || '.'));
    const wsRoot = path.dirname(base);              // userData/workspace
    const userData = path.dirname(wsRoot);          // userData
    /** 其他会话工作区：workspace 根、以及不属于当前 base 的兄弟目录 */
    if (inside(p, wsRoot) && !inside(p, base)) return '其他会话的工作区';
    if (inside(p, path.join(userData, 'workspace'))) {
      if (!inside(p, base)) return '其他会话的工作区';
    }
    /** 历史 / 记忆 / 会话数据 */
    for (const d of PROTECTED_DATA) {
      if (d === 'workspace') continue;
      if (inside(p, path.join(userData, d))) return '会话历史 / 记忆数据';
    }
    const rel = path.relative(userData, p);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel) && PROTECTED_FILES.includes(rel)) return '账号 / 会话历史文件';
    return null;
  } catch { return null; }
}

/** 路径是否在“禁止但可由用户单独授权”的范围内 */
export function isProtected(abs: string, baseDir: string): boolean {
  return protectedPathReason(abs, baseDir) !== null;
}

/**
 * 命令里的路径扫描：**保守 fail-closed**。
 *  - 静态展开 %VAR% / $env:VAR / ~ / . / ..；
 *  - 跟踪 cd / Set-Location / pushd 后的相对路径；
 *  - 任何看似路径的 token 都按当前 cwd 解析后检查禁止区；
 *  - 出现 base64/-EncodedCommand/Invoke-Expression 这类“把路径藏起来”的写法，直接拒绝。
 * 不是完整 shell 解释器；但足以挡住“直接写路径 / 相对路径 / 环境变量 / cd 进禁止区”的常见绕法。
 */
export function protectedCommandReason(cmd: string, cwd: string, baseDir: string): string | null {
  const raw = String(cmd || '');
  if (!raw.trim()) return null;
  /** 命令的工作目录本身也不许落在禁止区 */
  const whyCwd = protectedPathReason(String(cwd || baseDir || '.'), baseDir);
  if (whyCwd) return whyCwd;
  if (/(?:-encodedcommand|\bfrombase64string\b|\binvoke-expression\b|\biex\s|\beval\s)/i.test(raw)) {
    return '命令使用动态执行/编码路径，无法确认不会访问禁止区域';
  }
  const env = (s: string): string => {
    let out = s;
    const map: Record<string, string> = {
      '%APPDATA%': process.env.APPDATA || '',
      '%LOCALAPPDATA%': process.env.LOCALAPPDATA || '',
      '%USERPROFILE%': process.env.USERPROFILE || '',
      '%HOME%': process.env.HOME || process.env.USERPROFILE || '',
      '$env:APPDATA': process.env.APPDATA || '',
      '$env:LOCALAPPDATA': process.env.LOCALAPPDATA || '',
      '$env:USERPROFILE': process.env.USERPROFILE || '',
      '$HOME': process.env.HOME || process.env.USERPROFILE || '',
      '${HOME}': process.env.HOME || process.env.USERPROFILE || '',
    };
    for (const [k, v] of Object.entries(map)) out = out.split(k).join(v);
    if (/^~(?=$|[\\/])/.test(out)) out = (process.env.HOME || process.env.USERPROFILE || '') + out.slice(1);
    return out;
  };
  /** 把命令拆成段：&& || ; 换行（管道不改变 cwd，但也拆开逐段扫） */
  const segs = raw.split(/&&|\|\||;|\n|\|/);
  let now = path.resolve(String(cwd || baseDir || '.'));
  for (const seg0 of segs) {
    const seg = seg0.trim();
    if (!seg) continue;
    /** cd / Set-Location / pushd：先解析目标，禁止就报；允许就更新 cwd */
    const cd = /^(?:cd|chdir|set-location|pushd|sl)\s+(.+)$/i.exec(seg);
    if (cd) {
      const target = String(cd[1] || '').trim().replace(/^["']|["']$/g, '');
      const abs = path.isAbsolute(env(target)) ? path.resolve(env(target)) : path.resolve(now, env(target));
      const why = protectedPathReason(abs, baseDir);
      if (why) return why;
      now = abs;
      continue;
    }
    /** 所有 token：只检查“像路径”的；解析不了就按原样（绝不拼接未知变量） */
    const toks = seg.match(/"[^"]*"|'[^']*'|[^\s]+/g) || [];
    for (let t of toks) {
      t = t.replace(/^["']|["']$/g, '').replace(/^[>|&]+|[>|&]+$/g, '');
      if (!t) continue;
      const looks = /^(?:[A-Za-z]:[\\/]|\\\\|\/|\.{1,2}[\\/]|~[\\/]?|%[^%]+%|\$env:|\$HOME)/.test(t)
        || /[\\/]/.test(t);
      if (!looks) continue;
      /** 去掉命令行尾巴上的标点 */
      const clean = t.replace(/[),]+$/g, '');
      const e = env(clean);
      const abs = path.isAbsolute(e) ? path.resolve(e) : path.resolve(now, e);
      const why = protectedPathReason(abs, baseDir);
      if (why) return why;
    }
    /**
     * 注意：不要再用"命令里同时出现 appdata + workspace/memory 就拒绝"这种粗判据。
     * 真事故：模型把临时脚本写进**本会话工作区**后执行，命令里必然同时含 `@warmy`、`workspace`
     * 和脚本名；旧粗判据把它当成"访问禁止区"直接拒掉，模型于是换命令/换工具反复重试，
     * 用户看到的就是"一直在申请授权、始终完不成"。真正的越界由上面的 token 路径解析逐段判定。
     */
  }
  return null;
}
