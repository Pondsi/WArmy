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

/** 用户数据里属于“其他会话 / 历史 / 记忆”的目录名（相对 userData）
 * R235 主人定稿：**提示词层不是受保护区域**——规范/短记忆（guifan）、印象/软门禁（impressions）、
 * 要求（yaoqiu）都是模型可读可写的提示词（总结提炼也要改它们），故移出保护清单。
 * 仍保护的只有：其他会话工作区（workspace）/ 长期记忆（memory）/ 检查点 / 归档 / 看板 / 总线 / 账号鉴权（auth）。 */
const PROTECTED_DATA = [
  'workspace', 'memory', 'checkpoints', 'archive',
  'board', 'bus', 'auth',
];
/** R235：插件 / skill / 运行时子树——即使住在程序安装目录里，也不算“程序本身”，
 * 读/管理插件是正常干活，不是“查看其他会话”也不是“改程序本体”，不该弹受保护授权卡。
 * 命中任一路径段即豁免（dsh* 运行时/插件、skills、plugins、扫描目录）。 */
const CHA_JIAN_QU_MING = ['skills', 'plugins', 'scan-dirs', 'warmy-dsh'];
function shiChaJianQu(p: string): boolean {
  const segs = normCase(p).split(/[\\/]+/).filter(Boolean);
  return segs.some((s) => CHA_JIAN_QU_MING.includes(s) || /^dsh/.test(s));
}
/** 用户数据根下的敏感文件（历史 / 账号 / 设置） */
const PROTECTED_FILES = [
  'chat-logs.json', 'chat-meta.json', 'profile.json', 'settings.json', 'appearance.json',
  'join-requests.json', 'plans.json',
];

const yiCi = new Set<string>();
/** R235 硬门禁：绝对不可由模型更改的提示词（道 dao.md 等，由主进程启动时登记绝对路径）。
 * 与“受保护区域”（可经用户授权卡一次性放行）不同：硬门禁**即使同意也不放行**，
 * 只能由用户本人在界面保存（warmy:daoShe）。grant/consume 都拒绝，保证任何工具路径都改不了。 */
let yongBuKeGai = new Set<string>();
export function setYongBuKeGai(paths: readonly string[]): void {
  yongBuKeGai = new Set(paths.map((p) => normCase(path.resolve(String(p || '')))).filter(Boolean));
}
/** 硬门禁原因（null=非硬门禁）；供授权卡流程直接拒绝、不弹可放行的卡。 */
export function hardProtectedReason(abs: string): string | null {
  const k = normCase(path.resolve(String(abs || '')));
  return yongBuKeGai.has(k) ? '硬门禁：道（dao.md）是用户最高准则，模型永不可更改，只能由用户在界面保存' : null;
}
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
  if (!p) return;
  if (yongBuKeGai.has(normCase(p))) return; // R235 硬门禁：道等绝不可经授权放行
  yiCi.add(normCase(p));
}
export function consumeProtectedOnce(abs: string): boolean {
  const k = normCase(path.resolve(String(abs || '')));
  if (yongBuKeGai.has(k)) return false; // R235 硬门禁：即使被误登记也不消费
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
    const base = path.resolve(String(baseDir || '.'));
    const wsRoot = path.dirname(base);              // userData/workspace
    const userData = path.dirname(wsRoot);          // userData
    /** R235 硬门禁：道等绝对不可改的提示词优先判定，模型永不可写（授权卡也不放行）。 */
    const ying = hardProtectedReason(p);
    if (ying) return ying;
    /**
     * R163 #6 真机缺陷：**打包态 userData 就在安装目录下**（`<安装目录>/WArmyData`，R161 改的）。
     * 旧实现先无条件拿 `programDirs` 比，于是**应用自己的会话工作区**也被判成「程序安装目录」：
     *   protectedPathReason('…/WArmy/WArmyData/workspace/inst-x', 同路径) → '程序安装目录'
     * 后果：打包态下**每一条 run_shell**（连 `echo hello`）都弹受保护区域授权卡。
     * 实测：一个 3 分钟任务里 6 张卡全是误判，光等用户点「同意」就花了 185 秒，
     * 直接把用户的 3 分钟时限撑成 7.7 分钟（#8 的直接成因之一）。
     *
     * 口径：「程序安装目录」保的是**程序自己的文件**（resources/、exe、dll），
     * 不包括碰巧住在它里面的用户数据树。userData 内部仍由下面几条管：
     * 其他会话工作区 / 历史记忆 / 账号文件 —— 那才是真正的禁止区。
     */
    const zaiUserData = inside(p, userData);
    /** 程序安装目录：永远禁止（即使完全授权）—— 但 userData 子树与插件/skill/运行时子树除外 */
    if (!zaiUserData && !shiChaJianQu(p)) {
      for (const d of programDirs) if (inside(p, d)) return '程序安装目录';
    }
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
      /**
       * R163：Windows 的 `cd /d "路径"` 带开关。旧实现把 `/d "路径"` 整个当成目标，
       * 解析出一个不存在的路径 ⇒ 不命中禁止区，而且因为 cd 分支会 continue，
       * 后面那道逐 token 扫描也被跳过 ⇒ `cd /d "<程序目录>"` 竟然放行。
       * 现在先剔掉 /d 开关，再解路径；解不出绝对路径时**不跳过 token 扫描**。
       */
      const target = String(cd[1] || '').trim().replace(/^\/d\s+/i, '').replace(/^["']|["']$/g, '');
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
      /**
       * R163 #6：命令开关不是路径。`dir /b`、`/S`、`/quiet` 这类单字母/单词开关
       * 会被 `path.resolve(cwd, '/b')` 解成**盘符根**（`<盘>:\b`），既无意义又容易误判。
       * Unix 绝对路径（`/etc/hosts`）仍要查，所以只排除「没有第二个分隔符的短开关」。
       */
      if (/^\/[A-Za-z][A-Za-z0-9_-]*$/.test(t) && process.platform === 'win32') continue;
      const looks = /^(?:[A-Za-z]:[\\/]|\\\\|\/|\.{1,2}[\\/]|~[\\/]?|%[^%]+%|\$env:|\$HOME)/.test(t)
        || /[\\/]/.test(t);
      /** 去掉命令行尾巴上的标点 */
      const clean = t.replace(/[),]+$/g, '');
      if (!looks) {
        /** R235：裸文件名（无分隔符，如 cd 到 userData 后的 `echo x > dao.md`）也要按 cwd 解析查保护，
         *  否则硬门禁/敏感文件可被「cd + 裸名重定向」绕过。普通命令词解析到工作区内 ⇒ 放行，不误伤。 */
        if (/^[^\s\\/]+$/.test(clean)) {
          const absBare = path.resolve(now, env(clean));
          const whyBare = protectedPathReason(absBare, baseDir);
          if (whyBare) return whyBare;
        }
        continue;
      }
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
