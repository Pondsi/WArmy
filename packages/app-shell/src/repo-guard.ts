/**
 * 仓库写入守卫（对应 ADR 003 附四.3② / 附五「本体安全」+ 附三.4「公开目录发布门禁」）
 *
 * 背景：成员经 SSH 直接操作**创建者的仓库（本体）**，且不设审核闸门（附四.1 / 附五）。
 * 这时最容易被忽略的一个事实是：**SSH 只跑 git ≠ 没有代码执行**。
 *
 *   - 推 `.git/hooks/*`（例如 post-receive）→ 创建者机器上执行任意命令；
 *   - 改 `.git/config`（例如 core.hooksPath）→ 指向任意脚本；
 *   - `.gitattributes` 里绑 `filter=` / `diff=` 驱动 → 由 git 触发 clean/smudge/textconv；
 *   - 符号链接逃逸 / `..` 穿越 / 绝对路径 → 写穿仓库边界；
 *   - 大小写与 Unicode 归一化别名 → 绕过只看字面量的黑名单。
 *
 * 本模块**只做判断，不做 IO 之外的任何动作**，返回结构化结果（不是 boolean）：
 *   - `validatePushPaths(paths, opts)`      —— 推送（pre-receive）路径校验
 *   - `validateRefUpdate(ref, old, new, o)` —— ref 白名单 / 快进 / 删除 校验
 *   - `scanPublishableExport(files, opts)`  —— 公开目录导出前的门禁扫描（ADR 附三.4）
 *
 * ⚠️ 诚实声明：本模块**不可能穷尽**所有绕过方式。已知未覆盖项写在文件末尾
 *    「已知缺口」一节，也必须同步写进交付报告。**不要**把它当成沙箱或安全边界，
 *    它只是"让最省事的那几种提权路走不通"的纵深防御一层。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ────────────────────────────────────────────────────────────────────────────
// 一、路径归一化（三个门禁共用的基座）
// ────────────────────────────────────────────────────────────────────────────

export type lujingBiemingLeixing = 'case' | 'unicode' | 'separator';

export type TuisongLujingJujueDaima =
  | 'empty-path'
  | 'abs-path'
  | 'parent-escape'
  | 'illegal-char'
  | 'noise-suffix'
  | 'git-internal'
  | 'git-hooks'
  | 'git-config'
  | 'git-attributes'
  | 'git-attributes-unverified'
  | 'symlink-escape'
  | 'collision';

export interface CangkuLujingGuifan {
  /** 调用方给的原始字符串 */
  raw: string;
  ok: boolean;
  code?: TuisongLujingJujueDaima;
  reason?: string;
  /** NFKC + 统一分隔符 + 去掉 `.` / 折叠 `..` 后的仓库内相对路径（`/` 分隔） */
  normalized: string;
  /** 用于比较/黑名单匹配的键 = normalized 的 casefold 形式 */
  key: string;
  /** normalized 的段（已去掉 Windows 会静默剥离的末尾空格/点） */
  segments: string[];
  /** POSIX 绝对 / 盘符 / UNC / `~` */
  absolute: boolean;
  /** `..` 越过仓库根 */
  escaped: boolean;
  /** 末尾空格 / 末尾点这类 Windows 会静默剥离的写法 */
  noisy: boolean;
  /** 归一化过程中发现的别名（大小写 / Unicode / 分隔符） */
  aliases: lujingBiemingLeixing[];
}

/** NUL / 控制字符（含 \r \n \t） */
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
/** 零宽与双向控制字符：肉眼看不见，却能造出"看起来一样"的另一个名字 */
const ZERO_WIDTH_RE = /[\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2064\u206a-\u206f\ufeff]/g;
const ZERO_WIDTH_PROBE = /[\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2064\u206a-\u206f\ufeff]/;
/** Windows 会静默剥离段末尾的空格与点 —— 也就是 `.git/config ` 与 `.git/config` 是同一个文件 */
const NOISE_TAIL_RE = /[ .]+$/;
const DRIVE_OR_UNC_RE = /^[A-Za-z]:/;

/**
 * 归一化仓库内路径。**这是三个门禁的安全基座，改动前务必重跑 verify-repo-guard.mjs。**
 *
 * 归一化顺序：NFKC → 去零宽 → 统一分隔符（`\` 视为 `/`）→ 逐段去末尾空格/点 →
 * 折叠 `.` 与 `..`（记录是否越界）→ casefold 得 `key`。
 */
export function guiFanHuaCangKuLuJing(raw: string): CangkuLujingGuifan {
  const out: CangkuLujingGuifan = {
    raw,
    ok: true,
    normalized: '',
    key: '',
    segments: [],
    absolute: false,
    escaped: false,
    noisy: false,
    aliases: [],
  };
  if (typeof raw !== 'string' || raw.length === 0) {
    out.ok = false;
    out.code = 'empty-path';
    out.reason = '路径为空';
    return out;
  }
  if (CONTROL_RE.test(raw)) {
    out.ok = false;
    out.code = 'illegal-char';
    out.reason = '路径含控制字符（含 NUL / 换行），git 与文件系统对它的解释不一致';
    return out;
  }
  // 别名按种类去重记录（审计时只关心"发生了哪类归一化"）
  const tianjiaBieming = (kind: lujingBiemingLeixing): void => {
    if (!out.aliases.includes(kind)) out.aliases.push(kind);
  };
  const nfkc = raw.normalize('NFKC');
  if (nfkc !== raw || ZERO_WIDTH_PROBE.test(raw)) tianjiaBieming('unicode');
  if (/\\/.test(raw)) tianjiaBieming('separator');
  if (raw !== raw.toLowerCase()) tianjiaBieming('case');

  const quchu = nfkc.replace(ZERO_WIDTH_RE, '');
  // 分隔符别名：NFKC 之后**新出现**的 `/`（例如全角 `／`）会把路径重新分段，
  // 这是绕过"只看字面量"的黑名单的经典手法，直接判死。
  if (quchu !== raw && quchu.split('/').length !== raw.split('/').length) tianjiaBieming('separator');

  out.absolute =
    quchu.startsWith('/') ||
    quchu.startsWith('\\') ||
    DRIVE_OR_UNC_RE.test(quchu) ||
    quchu === '~' ||
    quchu.startsWith('~/') ||
    quchu.startsWith('~\\');

  const segments: string[] = [];
  for (const pianDuan of quchu.split(/[/\\]+/)) {
    if (pianDuan === '' || pianDuan === '.') continue;
    if (pianDuan === '..') {
      if (segments.length === 0) out.escaped = true;
      else segments.pop();
      continue;
    }
    const trimmed = pianDuan.replace(NOISE_TAIL_RE, '');
    if (trimmed !== pianDuan) out.noisy = true;
    if (trimmed === '') continue;
    segments.push(trimmed);
  }
  out.segments = segments;
  out.normalized = segments.join('/');
  out.key = out.normalized.toLowerCase();

  if (out.absolute) {
    out.ok = false;
    out.code = 'abs-path';
    out.reason = '绝对路径 / 家目录写法：成员推送只允许仓库内相对路径';
    return out;
  }
  if (out.escaped) {
    out.ok = false;
    out.code = 'parent-escape';
    out.reason = '含越出仓库根的 `..`（路径穿越）';
    return out;
  }
  if (out.normalized === '') {
    out.ok = false;
    out.code = 'empty-path';
    out.reason = '归一化后为空（只有 `.` / `..` / 空白）';
    return out;
  }
  return out;
}

/** 比较用键：NFKC + casefold（Windows/macOS 会折叠大小写与 Unicode 形式） */
export function cangkuLujingMiyao(raw: string): string {
  return guiFanHuaCangKuLuJing(raw).key;
}

/** 把相对路径按 `baseSegs` 解析；返回是否越出仓库根 */
function jiexiXiangdui(baseSegs: string[], relSegs: string[]): { segments: string[]; escaped: boolean } {
  const out = baseSegs.slice();
  let escaped = false;
  for (const s of relSegs) {
    if (s === '..') {
      if (out.length === 0) escaped = true;
      else out.pop();
    } else if (s !== '' && s !== '.') {
      out.push(s);
    }
  }
  return { segments: out, escaped };
}

// ────────────────────────────────────────────────────────────────────────────
// 二、推送路径校验 validatePushPaths
// ────────────────────────────────────────────────────────────────────────────

/** git 对象模式；120000=符号链接，160000=gitlink（子模块） */
export type TuisongLujingMoshi = string;

export interface TuiSongLuJingTiaoMu {
  path: string;
  mode?: TuisongLujingMoshi;
  /** 符号链接目标（mode=120000 时）。缺省时回退到 content */
  symlinkTarget?: string;
  /**
   * 文件内容。`.gitattributes` 的 filter/diff 驱动**必须**看内容才能判断，
   * 所以 pre-receive 钩子在能拿到 blob 时必须把它传进来。
   */
  content?: string;
}

export interface TuisongLujingXuanxiang {
  /**
   * `worktree`（默认）：路径相对工作区，`.git/**` 是危险路径；
   * `gitdir`：路径相对 git 目录本身（bare 仓库 / `.git` 内直投），`hooks/**`、`config` 直接命中。
   */
  base?: 'worktree' | 'gitdir';
  /** 拿不到内容的 `.gitattributes` 一律拒绝（默认 true，fail-closed） */
  requireAttributesContent?: boolean;
  /** 拒绝同一批次内「仅大小写 / Unicode 归一化不同」的路径（默认 true） */
  rejectAliasCollisions?: boolean;
}

export interface TuiSongLuJingJuJue {
  /** 调用方给的原始路径 */
  path: string;
  code: TuisongLujingJujueDaima;
  reason: string;
  /** 归一化后的仓库内路径（便于审计） */
  normalized?: string;
  aliases?: lujingBiemingLeixing[];
  /** code=collision 时：与哪个路径撞了 */
  conflictsWith?: string;
}

export interface TuisongLujingJiaoyan {
  allowed: boolean;
  /** 归一化后的可接受路径（去重、保持输入顺序） */
  accepted: string[];
  rejected: TuiSongLuJingJuJue[];
  warnings: string[];
}

interface WeixianMingzhong {
  code: TuisongLujingJujueDaima;
  reason: string;
}

/** 判定"这个 key 落在 git 目录里"，并给出**具体**的危险类型 */
function dangerInGitDir(restKey: string[], restDisp: string[]): WeixianMingzhong | null {
  const biaoQian = `.git` + (restDisp.length ? `/${restDisp.join('/')}` : '');
  if (restKey.length === 0) {
    return { code: 'git-internal', reason: `${biaoQian} 是 git 目录本体，成员不得写入` };
  }
  const touBu = restKey[0] ?? '';
  if (touBu === 'hooks') {
    return { code: 'git-hooks', reason: `${biaoQian} 落在 .git/hooks/**：钩子会在创建者机器上被执行（post-receive 等）` };
  }
  if (touBu === 'config' || touBu === 'config.worktree') {
    return { code: 'git-config', reason: `${biaoQian} 可设置 core.hooksPath / filter 驱动等指向任意脚本，等于任意代码执行` };
  }
  if (touBu === 'info' && (restKey[1] ?? '') === 'attributes') {
    return { code: 'git-attributes', reason: `${biaoQian} 可绑定 filter/diff 驱动并作用于后续操作` };
  }
  if (touBu === 'modules') {
    return { code: 'git-internal', reason: `${biaoQian} 是子模块元数据，可诱导 git 递归到仓库外` };
  }
  return { code: 'git-internal', reason: `${biaoQian} 属于 git 内部数据，成员不得写入` };
}

/** 危险路径判定：`.git/**`（含任意层级嵌套 .git），key 已 casefold */
function weixianTuisongLujing(key: string, base: 'worktree' | 'gitdir'): WeixianMingzhong | null {
  const keySegs = key.split('/');
  if (base === 'gitdir') {
    // 路径相对 git 目录：必要时剥掉显式的前缀 `.git/`
    const trimmed = keySegs[0] === '.git' ? keySegs.slice(1) : keySegs;
    return dangerInGitDir(trimmed, trimmed);
  }
  const at = keySegs.indexOf('.git');
  if (at >= 0) {
    return dangerInGitDir(keySegs.slice(at + 1), keySegs.slice(at + 1));
  }
  return null;
}

/** `.gitattributes` 里是否绑定了 filter / diff 驱动（会由 git 触发外部程序） */
const ATTR_DRIVER_RE = /(^|\s)(?:filter|diff)\s*=\s*(?:"[^"]*"|'[^']*'|\S+)/;
/** 裸 `filter` 属性（值被视为 true）同样可疑：解析结果依赖 git 版本 */
const ATTR_BARE_FILTER_RE = /(^|\s)filter(?=\s|$)/;

/** 扫 `.gitattributes` 内容；返回命中的危险写法（无则 null） */
function saoMiaoGitShuXing(content: string): { code: TuisongLujingJujueDaima; reason: string } | null {
  const HangJi = content.split(/\r?\n/);
  for (let i = 0; i < HangJi.length; i++) {
    const Hang = (HangJi[i] ?? '').trim();
    if (!Hang || Hang.startsWith('#')) continue;
    if (ATTR_DRIVER_RE.test(Hang) || ATTR_BARE_FILTER_RE.test(Hang)) {
      return {
        code: 'git-attributes',
        reason: `.gitattributes 第 ${i + 1} 行绑定了 filter/diff 驱动：${Hang.slice(0, 120)}`,
      };
    }
  }
  return null;
}

function toEntry(input: string | TuiSongLuJingTiaoMu): TuiSongLuJingTiaoMu {
  return typeof input === 'string' ? { path: input } : input;
}

/**
 * 校验一批即将推送的路径。**只要有一条被拒，`allowed` 就是 false** —— pre-receive 应拒绝整批。
 *
 * 检查顺序（每条路径）：归一化 → 危险路径 → 符号链接逃逸 → `.gitattributes` 内容；
 * 全部路径过完后再做**批次内别名碰撞**（大小写 / Unicode 归一化不同但落到同一个文件）。
 */
export function jiaoYanTuiSongLuJing(
  paths: Array<string | TuiSongLuJingTiaoMu> | string,
  opts: TuisongLujingXuanxiang = {}
): TuisongLujingJiaoyan {
  const base = opts.base ?? 'worktree';
  const requireAttributesContent = opts.requireAttributesContent !== false;
  const rejectAliasCollisions = opts.rejectAliasCollisions !== false;

  const LieBiao = (typeof paths === 'string' ? [paths] : paths).map(toEntry);
  const rejected: TuiSongLuJingJuJue[] = [];
  const warnings: string[] = [];
  const accepted: string[] = [];
  const acceptedSet = new Set<string>();
  /** key → 第一条出现的原始路径（用于碰撞检测） */
  const yiKanDao = new Map<string, string>();

  for (const entry of LieBiao) {
    const raw = typeof entry.path === 'string' ? entry.path : '';
    const n = guiFanHuaCangKuLuJing(raw);
    const reject = (code: TuisongLujingJujueDaima, reason: string, extra: Partial<TuiSongLuJingJuJue> = {}): void => {
      rejected.push({
        path: raw,
        code,
        reason,
        ...(n.normalized ? { normalized: n.normalized } : {}),
        ...(n.aliases.length ? { aliases: n.aliases.slice() } : {}),
        ...extra,
      });
    };

    if (!n.ok) {
      reject(n.code ?? 'empty-path', n.reason ?? '路径非法');
      continue;
    }
    const weixian = weixianTuisongLujing(n.key, base);
    if (weixian) {
      reject(weixian.code, weixian.reason);
      continue;
    }
    if (n.noisy) {
      reject(
        'noise-suffix',
        '段末尾带空格或点：Windows 会静默剥离，等于能偷偷改写另一个文件名'
      );
      continue;
    }

    // 符号链接逃逸
    const isLink = entry.mode === '120000' || typeof entry.symlinkTarget === 'string';
    if (isLink) {
      const target = (typeof entry.symlinkTarget === 'string' ? entry.symlinkTarget : entry.content) ?? '';
      if (!target.trim()) {
        reject('symlink-escape', '符号链接没有目标内容，无法校验它指向哪里');
        continue;
      }
      const t = guiFanHuaCangKuLuJing(target);
      if (!t.ok) {
        reject('symlink-escape', `符号链接目标非法（${t.reason ?? '未知'}）：${target.slice(0, 80)}`);
        continue;
      }
      if (t.absolute) {
        reject('symlink-escape', `符号链接指向绝对路径：${target.slice(0, 80)}`);
        continue;
      }
      const dirSegs = n.segments.slice(0, -1);
      const resolved = jiexiXiangdui(dirSegs, t.segments);
      if (resolved.escaped || t.escaped) {
        reject('symlink-escape', `符号链接逃出仓库根：${n.normalized} → ${target.slice(0, 80)}`);
        continue;
      }
      const mubiaoMiyao = resolved.segments.join('/').toLowerCase();
      const jingyouLianjie = weixianTuisongLujing(mubiaoMiyao, base);
      if (jingyouLianjie) {
        reject('symlink-escape', `符号链接指向 git 内部（${mubiaoMiyao}）：${jingyouLianjie.reason}`);
        continue;
      }
      warnings.push(`符号链接（指向仓库内）：${n.normalized} → ${target.slice(0, 80)}`);
    }

    // .gitattributes 的 filter/diff 驱动
    const basename = n.key.split('/').pop() ?? '';
    if (basename === '.gitattributes') {
      if (typeof entry.content === 'string') {
        const mingZhong = saoMiaoGitShuXing(entry.content);
        if (mingZhong) {
          reject(mingZhong.code, mingZhong.reason);
          continue;
        }
      } else if (requireAttributesContent) {
        reject(
          'git-attributes-unverified',
          '.gitattributes 未提供内容，无法确认是否绑定 filter/diff 驱动（fail-closed；如已确认干净可传 requireAttributesContent:false）'
        );
        continue;
      } else {
        warnings.push(`${n.normalized} 未提供内容，已按 requireAttributesContent:false 放行但未校验`);
      }
    }
    if (basename === '.gitmodules') {
      warnings.push('.gitmodules 会让 git 递归到子模块（可指向任意仓库），建议人工确认');
    }

    // 批次内别名碰撞：`A.ts` 与 `a.ts`、NFC 与 NFD 的 cafe 在多数文件系统上是同一个文件
    const xianqian = yiKanDao.get(n.key);
    if (xianqian === undefined) {
      yiKanDao.set(n.key, raw);
    } else if (rejectAliasCollisions && xianqian !== raw) {
      reject('collision', `与同批次路径「${xianqian}」在大小写/Unicode 归一化后是同一个文件`, {
        conflictsWith: xianqian,
      });
      continue;
    } else {
      warnings.push(`重复路径（同一批次内出现多次）：${n.normalized}`);
    }

    // 同时把先前那条也标成碰撞（否则一条被拒、另一条被放行，语义含糊）
    if (rejectAliasCollisions) {
      const shuangzi = LieBiao.find(
        (e) =>
          e !== entry &&
          typeof e.path === 'string' &&
          e.path !== raw &&
          guiFanHuaCangKuLuJing(e.path).ok &&
          guiFanHuaCangKuLuJing(e.path).key === n.key
      );
      if (shuangzi) {
        reject('collision', `与同批次路径「${shuangzi.path}」在大小写/Unicode 归一化后是同一个文件`, {
          conflictsWith: shuangzi.path,
        });
        continue;
      }
    }

    if (!acceptedSet.has(n.normalized)) {
      acceptedSet.add(n.normalized);
      accepted.push(n.normalized);
    } else {
      warnings.push(`重复路径（同一批次内出现多次）：${n.normalized}`);
    }
  }

  return { allowed: rejected.length === 0, accepted, rejected, warnings };
}

// ────────────────────────────────────────────────────────────────────────────
// 三、ref 更新校验 validateRefUpdate
// ────────────────────────────────────────────────────────────────────────────

export type YinyongJujueDaima =
  | 'ref-invalid'
  | 'ref-not-whitelisted'
  | 'ref-blocked'
  | 'main-branch-protected'
  | 'env-ref-protected'
  | 'ref-delete'
  | 'env-ref-delete'
  | 'sha-invalid'
  | 'stale-old-sha'
  | 'non-fast-forward'
  | 'forced-update'
  | 'fast-forward-unverified';

export type YinYongDongZuo = 'create' | 'update' | 'delete' | 'noop';

export interface YinYongGengXinXuanXiang {
  /** 推送者角色；默认 member（最严） */
  role?: 'member' | 'admin' | 'creator' | 'duty';
  /** 成员 id（用于 `refs/heads/members/<id>/**` 命名空间） */
  memberId?: string;
  /** 可以写主分支的角色（默认只有 creator） */
  protectedRefWriters?: Array<'member' | 'admin' | 'creator' | 'duty'>;
  /** 可以写环境 ref 的角色（默认 creator + admin） */
  envRefWriters?: Array<'member' | 'admin' | 'creator' | 'duty'>;
  /** 主分支（默认 refs/heads/main、refs/heads/master） */
  protectedRefs?: string[];
  /** 成员可推的提案命名空间（默认 refs/heads/proposals/） */
  proposalPrefixes?: string[];
  /** 成员私有命名空间前缀（默认 refs/heads/members/） */
  memberPrefixes?: string[];
  /** 环境 ref 前缀（默认 refs/environments/、refs/env/） */
  envRefPrefixes?: string[];
  /** 对所有人封禁的 ref 前缀（默认 refs/replace/、refs/config/、refs/hooks/） */
  blockedRefPrefixes?: string[];
  /** 由调用方注入的对象图判定：newSha 是否以 oldSha 为祖先（pre-receive 里可用 git merge-base --is-ancestor） */
  isAncestor?: (ancestor: string, descendant: string) => boolean | undefined;
  /** 调用方已确认是强制推（`--force` / 非快进） */
  force?: boolean;
  /** 没有对象图可判定时是否放行（默认 false = fail-closed） */
  assumeFastForward?: boolean;
  /** 服务端当前该 ref 的值（用于发现 CAS 竞争 / 强推） */
  knownSha?: string;
  /** 允许 creator 强制推（默认 false） */
  allowForceByCreator?: boolean;
  /** 允许 creator 删除 ref（默认 false；环境 ref 任何人任何时候都不许删） */
  allowDeleteByCreator?: boolean;
}

export interface YinyongJujue {
  code: YinyongJujueDaima;
  reason: string;
}

export interface RefUpdateResult {
  allowed: boolean;
  ref: string;
  action: YinYongDongZuo;
  oldSha: string;
  newSha: string;
  role: 'member' | 'admin' | 'creator' | 'duty';
  rejections: YinyongJujue[];
  warnings: string[];
}

const ZERO_SHA = /^0{40}$|^0{64}$/;
const SHA_RE = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/;
/** git check-ref-format 的关键约束（宽松版：只挡真正危险与解析歧义的写法） */
const REF_BAD_CHARS_RE = /[\u0000-\u001f\u007f ~^:?*[\\]/;

function wuxiaoYinyongYuanyin(ref: string): string | null {
  if (!ref.startsWith('refs/')) return '必须以 refs/ 开头';
  if (ref.length < 6) return 'ref 名太短';
  if (ref.endsWith('/')) return '不能以 / 结尾';
  if (ref.includes('//')) return '不能出现连续 //';
  if (ref.includes('..')) return '不能出现 ..';
  if (ref.includes('@{')) return '不能出现 @{';
  if (REF_BAD_CHARS_RE.test(ref)) return '含非法字符（空格/控制字符/^:?*[\\ 之一）';
  if (ref.endsWith('.lock')) return '不能以 .lock 结尾';
  for (const Duan of ref.split('/')) {
    if (Duan.startsWith('.')) return `段不能以 . 开头：${Duan}`;
    if (Duan.endsWith('.')) return `段不能以 . 结尾：${Duan}`;
  }
  return null;
}

/** 校验一次 ref 更新（pre-receive 中每个 ref 调一次） */
export function jiaoYanYinYongGengXin(
  ref: string,
  oldSha: string,
  newSha: string,
  opts: YinYongGengXinXuanXiang = {}
): RefUpdateResult {
  const role = opts.role ?? 'member';
  const protectedRefs = opts.protectedRefs ?? ['refs/heads/main', 'refs/heads/master'];
  const proposalPrefixes = opts.proposalPrefixes ?? ['refs/heads/proposals/'];
  const memberPrefixes = opts.memberPrefixes ?? ['refs/heads/members/'];
  const envRefPrefixes = opts.envRefPrefixes ?? ['refs/environments/', 'refs/env/'];
  const blockedRefPrefixes = opts.blockedRefPrefixes ?? ['refs/replace/', 'refs/config/', 'refs/hooks/'];
  const protectedRefWriters = opts.protectedRefWriters ?? ['creator'];
  const envRefWriters = opts.envRefWriters ?? ['creator', 'admin'];

  const rejections: YinyongJujue[] = [];
  const warnings: string[] = [];
  const reject = (code: YinyongJujueDaima, reason: string): void => {
    rejections.push({ code, reason });
  };

  const safeRef = typeof ref === 'string' ? ref.trim() : '';
  const oldS = (oldSha ?? '').trim().toLowerCase();
  const newS = (newSha ?? '').trim().toLowerCase();

  const isDelete = ZERO_SHA.test(newS) ? true : false;
  const isCreate = ZERO_SHA.test(oldS) ? true : false;
  const action: YinYongDongZuo = isDelete ? 'delete' : isCreate ? 'create' : newS === oldS ? 'noop' : 'update';

  const badRef = wuxiaoYinyongYuanyin(safeRef);
  if (badRef) reject('ref-invalid', `ref 名非法（${badRef}）：${safeRef || '(空)'}`);
  if (!SHA_RE.test(oldS) && !ZERO_SHA.test(oldS)) reject('sha-invalid', `oldSha 不是合法对象名：${oldSha}`);
  if (!SHA_RE.test(newS) && !ZERO_SHA.test(newS)) reject('sha-invalid', `newSha 不是合法对象名：${newSha}`);

  const isProtected = protectedRefs.includes(safeRef);
  const isEnv = envRefPrefixes.some((p) => safeRef === p || safeRef.startsWith(p));
  const isBlocked = blockedRefPrefixes.some((p) => safeRef.startsWith(p));

  if (isBlocked) {
    reject('ref-blocked', `${safeRef} 落在永久封禁命名空间（可改对象图/影响所有人生成物），任何人不得推送`);
  }

  // 删除：默认一律拒绝。环境 ref 连创建者也不许删（删环境 = 拆协作面）。
  if (action === 'delete') {
    if (isEnv) {
      reject('env-ref-delete', `环境 ref 不允许删除：${safeRef}`);
    } else if (!(role === 'creator' && opts.allowDeleteByCreator === true)) {
      reject('ref-delete', `不允许删除 ref（删 ref 会让所有人丢历史）：${safeRef}`);
    } else {
      warnings.push(`creator 删除了 ${safeRef}（allowDeleteByCreator=true，需记入审计）`);
    }
  }

  // ref 白名单：成员只能推提案分支 / 自己的命名空间
  if (!badRef && action !== 'noop') {
    if (isProtected) {
      if (!protectedRefWriters.includes(role)) {
        reject('main-branch-protected', `主分支受保护，${role} 不得推送：${safeRef}（成员请推 ${proposalPrefixes[0]}…）`);
      }
    } else if (isEnv) {
      if (!envRefWriters.includes(role)) {
        reject('env-ref-protected', `环境 ref 只允许 ${envRefWriters.join('/')} 推送：${safeRef}`);
      }
    } else if (role === 'member' || role === 'duty') {
      const inProposal = proposalPrefixes.some((p) => safeRef.startsWith(p));
      const inOwn = memberPrefixes.some(
        (p) => safeRef.startsWith(`${p}${opts.memberId ?? ''}/`) && !!opts.memberId
      );
      if (!inProposal && !inOwn) {
        reject(
          'ref-not-whitelisted',
          `${role} 只能推送 ${proposalPrefixes.join(' / ')}，或自己的 ${memberPrefixes.join(' / ')}<memberId>/：${safeRef}`
        );
      }
    }
  }

  // 快进 / 强制推
  if (action === 'update') {
    const yiZhi = typeof opts.knownSha === 'string' && opts.knownSha ? opts.knownSha.trim().toLowerCase() : '';
    if (yiZhi && yiZhi !== oldS) {
      reject(
        'stale-old-sha',
        `服务端 ${safeRef} 当前是 ${yiZhi.slice(0, 8)}，而推送方声称的旧值是 ${oldS.slice(0, 8)}（并发竞争或强推）`
      );
    }
    const creatorForceOk = role === 'creator' && opts.allowForceByCreator === true;
    if (opts.force === true) {
      if (!creatorForceOk) reject('forced-update', `拒绝强制推（--force / 非快进）：${safeRef}`);
      else warnings.push(`${role} 强制更新了 ${safeRef}（allowForceByCreator=true，需记入审计）`);
    } else if (typeof opts.isAncestor === 'function') {
      const ff = opts.isAncestor(oldS, newS);
      if (ff === false) {
        if (!creatorForceOk) {
          reject('non-fast-forward', `${newS.slice(0, 8)} 不是 ${oldS.slice(0, 8)} 的后代：拒绝非快进更新 ${safeRef}`);
        } else {
          warnings.push(`非快进但在 allowForceByCreator 下放行：${safeRef}`);
        }
      } else if (ff === undefined) {
        if (!opts.assumeFastForward && !creatorForceOk) {
          reject('fast-forward-unverified', `对象图不可用，无法确认 ${safeRef} 是快进（fail-closed）`);
        } else warnings.push(`快进未验证但已放行：${safeRef}`);
      }
    } else if (isProtected || isEnv) {
      // 受保护 ref 上不做无据放行
      if (!opts.assumeFastForward && !creatorForceOk) {
        reject('fast-forward-unverified', `未提供 isAncestor，无法验证 ${safeRef} 是否快进（fail-closed）`);
      }
    } else if (!opts.assumeFastForward) {
      reject('fast-forward-unverified', `未提供 isAncestor，无法验证 ${safeRef} 是否快进（fail-closed；如已确认可传 assumeFastForward:true）`);
    }
  }
  if (action === 'noop') warnings.push(`${safeRef} 没有实际变化（${newS.slice(0, 8)}），git 通常不会调用钩子`);

  return {
    allowed: rejections.length === 0,
    ref: safeRef,
    action,
    oldSha: oldS,
    newSha: newS,
    role,
    rejections,
    warnings,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 四、公开目录发布门禁 scanPublishableExport（ADR 附三.4）
// ────────────────────────────────────────────────────────────────────────────

export type PublishViolationCode =
  | 'chat-log'
  | 'member-roster'
  | 'email'
  | 'secret-key'
  | 'device-credential'
  | 'local-abs-path'
  | 'env-file'
  | 'symlink'
  | 'unreadable';

export interface PublishScanFile {
  /** 公开目录内的相对路径 */
  path: string;
  content?: string | Buffer;
  size?: number;
}

export interface PublishViolation {
  path: string;
  code: PublishViolationCode;
  reason: string;
  /** 已脱敏的命中片段（绝不回显完整密钥/邮箱） */
  match?: string;
  /** 内容命中时的行号（1 起） */
  Hang?: number;
}

export interface PublishScanResult {
  allowed: boolean;
  files: number;
  bytes: number;
  violations: PublishViolation[];
  warnings: string[];
  /** 只扫了头部的大文件（超过 maxScanBytes） */
  truncated: string[];
}

export interface PublishScanOptions {
  /** 单文件最多扫多少字节（默认 2 MiB）；大文件只扫头部并记入 truncated */
  maxScanBytes?: number;
  /** 忽略占位邮箱（example.com / *.invalid / localhost），默认 true */
  allowPlaceholderEmails?: boolean;
  /** 额外放行的文件名（正则字符串），默认无 */
  allowPathPatterns?: string[];
  /** 目录模式下是否统计字节数（默认 true） */
  statBytes?: boolean;
}

interface MingGuize {
  code: PublishViolationCode;
  biaoQian: string;
  re: RegExp;
}

/** 文件名级规则：名字本身就说明它是"绝不能公开"的东西 */
const NAME_RULES: MingGuize[] = [
  {
    code: 'chat-log',
    biaoQian: '聊天日志',
    re: /(^|\/)(chat|chats|chatlog|chat[-_.]?log|chat[-_.]?history|conversation|transcript|session|xiaoXiJi?|history)([-_.][^/]*)?\.(json|jsonl|ndjson|log|txt|md|csv|db|sqlite3?)$/i,
  },
  { code: 'chat-log', biaoQian: '聊天日志（中文名）', re: /(^|\/)[^/]*聊天(记录|日志|历史)[^/]*$|(^|\/)[^/]*对话记录[^/]*$/ },
  {
    code: 'member-roster',
    biaoQian: '成员名册',
    re: /(^|\/)(members?|member[-_]?list|roster|participants|名册|成员)[^/]*\.(json|jsonl|csv|tsv|txt|md|ya?ml)$/i,
  },
  { code: 'secret-key', biaoQian: '私钥文件', re: /(^|\/)(id_rsa|id_dsa|id_ecdsa|id_ed25519)(\.[^/]*)?$|\.(pem|pfx|p12|jks|keystore|key)$/i },
  {
    code: 'device-credential',
    biaoQian: '凭据文件',
    re: /(^|\/)(credentials?|tokens?|secrets?|device[-_]?(id|key|secret)|identity|passwd|shadow)[^/]*\.(json|txt|ini|key|pem|ya?ml|cfg)$/i,
  },
  { code: 'env-file', biaoQian: '环境变量文件', re: /(^|\/)\.env(\.[\w-]+)?$|(^|\/)\.npmrc$|(^|\/)\.pypirc$/i },
];

interface NeirongGuize {
  code: PublishViolationCode;
  biaoQian: string;
  re: RegExp;
  /** 命中多少次才算违规（默认 1） */
  minHits?: number;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/;
const PLACEHOLDER_EMAIL_RE = /@(?:example\.(?:com|org|net)|invalid|test|localhost)$/i;

const CONTENT_RULES: NeirongGuize[] = [
  { code: 'secret-key', biaoQian: '私钥块', re: /-----BEGIN[^-]{0,40}PRIVATE KEY-----/ },
  {
    code: 'secret-key',
    biaoQian: '常见 API Key',
    re: /\b(?:sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,})\b/,
  },
  {
    code: 'secret-key',
    biaoQian: '口令/密钥赋值',
    re: /(?:password|passwd|secret|api[_-]?key|access[_-]?token|private[_-]?key)\s*[:=]\s*["']?[A-Za-z0-9!@#$%^&*_+.-]{8,}/i,
  },
  { code: 'device-credential', biaoQian: 'SSH 公钥/指纹', re: /\b(?:ssh-rsa|ssh-ed25519|ecdsa-sha2-nistp\d+|sk-ssh-ed25519@openssh\.com)\s+AAAA[A-Za-z0-9+/=]{20,}/ },
  { code: 'member-roster', biaoQian: '成员名册内容', re: /"(?:memberId|holderId|instanceId)"\s*:/g, minHits: 2 },
  { code: 'chat-log', biaoQian: '聊天记录内容', re: /"role"\s*:\s*"(?:user|assistant|system)"[\s\S]{0,120}?"(?:content|text)"\s*:/ },
  { code: 'email', biaoQian: '邮箱', re: new RegExp(EMAIL_RE.source, 'g') },
  { code: 'local-abs-path', biaoQian: 'Windows 绝对路径', re: /[A-Za-z]:\\[^\s"'<>|]{2,}/ },
  { code: 'local-abs-path', biaoQian: 'POSIX 家目录/系统路径', re: /(?<![\w."'])\/(?:Users|home|root|mnt|var\/folders|private\/var|opt\/home)\/[\w.$-]+/ },
  { code: 'local-abs-path', biaoQian: 'file:// URL', re: /file:\/\/\/?[A-Za-z0-9]/ },
];

/** 命中片段脱敏：绝不在报告里回显完整的密钥或邮箱 */
function tuomin(code: PublishViolationCode, matched: string): string {
  const m = matched.trim();
  if (code === 'email') {
    const at = m.indexOf('@');
    if (at > 0) return `${m.slice(0, 1)}***${m.slice(at)}`;
  }
  if (m.length <= 8) return `${m.slice(0, 2)}***`;
  return `${m.slice(0, 6)}…(${m.length} 字符)`;
}

function lineOf(text: string, index: number): number {
  let Hang = 1;
  const end = Math.min(index, text.length);
  for (let i = 0; i < end; i++) if (text.charCodeAt(i) === 10) Hang++;
  return Hang;
}

function matchesFor(rule: NeirongGuize, text: string, opts: PublishScanOptions): { index: number; matched: string }[] {
  const re = new RegExp(rule.re.source, rule.re.flags.includes('g') ? rule.re.flags : `${rule.re.flags}g`);
  const out: { index: number; matched: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    if (rule.code === 'email' && opts.allowPlaceholderEmails !== false && PLACEHOLDER_EMAIL_RE.test(m[0])) {
      continue;
    }
    out.push({ index: m.index, matched: m[0] });
    if (out.length >= 20) break;
  }
  return out;
}

/** 判断是不是二进制（只看头部少量字节） */
function looksBinary(text: string): boolean {
  const touBu = text.slice(0, 512);
  return /\u0000/.test(touBu);
}

function scanOneFile(
  file: PublishScanFile,
  violations: PublishViolation[],
  warnings: string[],
  truncated: string[],
  opts: PublishScanOptions
): number {
  const p = (file.path ?? '').replace(/\\/g, '/');
  const allowed = (opts.allowPathPatterns ?? []).some((src) => new RegExp(src).test(p));
  if (allowed) {
    warnings.push(`按 allowPathPatterns 跳过：${p}`);
    return 0;
  }
  for (const rule of NAME_RULES) {
    if (rule.re.test(p)) {
      violations.push({ path: p, code: rule.code, reason: `文件名命中「${rule.biaoQian}」规则：${p}` });
      break;
    }
  }
  if (file.content === undefined) return 0;
  const buf = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, 'utf8');
  const max = opts.maxScanBytes ?? 2 * 1024 * 1024;
  const touBu = buf.subarray(0, max);
  if (buf.byteLength > max) truncated.push(p);
  const text = touBu.toString('utf8');
  if (looksBinary(text)) {
    warnings.push(`二进制内容只做文件名检查：${p}`);
    return buf.byteLength;
  }

  // 本机绝对路径：直接拿当前机器的家目录/用户名做高置信匹配
  const jiamulu = os.homedir();
  const jiaBianti = [jiamulu, jiamulu.replace(/\\/g, '/'), jiamulu.replace(/\//g, '\\')].filter(Boolean);
  for (const h of jiaBianti) {
    const at = text.toLowerCase().indexOf(h.toLowerCase());
    if (at >= 0 && h.length > 4) {
      violations.push({
        path: p,
        code: 'local-abs-path',
        reason: '内容里出现了**本机**的用户目录绝对路径',
        match: tuomin('local-abs-path', text.slice(at, at + h.length + 8)),
        Hang: lineOf(text, at),
      });
      break;
    }
  }

  for (const rule of CONTENT_RULES) {
    const hits = matchesFor(rule, text, opts);
    if (hits.length < (rule.minHits ?? 1)) {
      if (hits.length > 0 && (rule.minHits ?? 1) > 1) {
        warnings.push(`${p} 有 ${hits.length} 处疑似「${rule.biaoQian}」但未达阈值 ${rule.minHits}`);
      }
      continue;
    }
    const first = hits[0];
    if (!first) continue;
    violations.push({
      path: p,
      code: rule.code,
      reason: `内容命中「${rule.biaoQian}」${hits.length > 1 ? `（共 ${hits.length} 处）` : ''}`,
      match: tuomin(rule.code, first.matched),
      Hang: lineOf(text, first.index),
    });
  }
  return buf.byteLength;
}

/**
 * 导出「公开目录」前的门禁扫描（ADR 附三.4）。
 *
 * 入参可以是文件数组，或**一个目录路径**（会递归读取）。返回结构化结果：
 * 有任何 violation 时 `allowed=false`，调用方必须拒绝发布。
 *
 * ⚠️ 这是"模式匹配门禁"，不是 DLP。已知漏检项见文件末尾「已知缺口」。
 */
export function saomiaoKeFabucDaochu(
  files: PublishScanFile[] | string,
  opts: PublishScanOptions = {}
): PublishScanResult {
  const violations: PublishViolation[] = [];
  const warnings: string[] = [];
  const truncated: string[] = [];
  let count = 0;
  let bytes = 0;

  if (typeof files === 'string') {
    const root = files;
    const bianli = (dir: string): void => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (e) {
        violations.push({ path: dir, code: 'unreadable', reason: `目录不可读：${e instanceof Error ? e.name : 'unknown'}` });
        return;
      }
      for (const tiaoMu of entries) {
        const Quan = path.join(dir, tiaoMu.name);
        const xiangDuiLu = path.relative(root, Quan).replace(/\\/g, '/');
        if (tiaoMu.isSymbolicLink()) {
          // 导出目录里的符号链接一律拒绝：它能把仓库外/本体内部的东西带进公开产物
          violations.push({ path: xiangDuiLu, code: 'symlink', reason: '公开目录里存在符号链接，可能把目录外的内容带进发布产物' });
          continue;
        }
        if (tiaoMu.isDirectory()) {
          if (tiaoMu.name === '.git' || tiaoMu.name === 'node_modules') {
            warnings.push(`跳过目录：${xiangDuiLu}`);
            continue;
          }
          bianli(Quan);
          continue;
        }
        if (!tiaoMu.isFile()) continue;
        let buf: Buffer | undefined;
        let size = 0;
        try {
          const st = fs.statSync(Quan);
          size = st.size;
          const max = opts.maxScanBytes ?? 2 * 1024 * 1024;
          const fd = fs.openSync(Quan, 'r');
          try {
            const want = Math.min(size, max);
            const chunk = Buffer.alloc(want);
            const read = fs.readSync(fd, chunk, 0, want, 0);
            buf = chunk.subarray(0, read);
          } finally {
            fs.closeSync(fd);
          }
        } catch (e) {
          violations.push({ path: xiangDuiLu, code: 'unreadable', reason: `文件不可读：${e instanceof Error ? e.name : 'unknown'}` });
          continue;
        }
        count++;
        bytes += size;
        scanOneFile({ path: xiangDuiLu, content: buf, size }, violations, warnings, truncated, opts);
      }
    };
    bianli(root);
    return { allowed: violations.length === 0, files: count, bytes, violations, warnings, truncated };
  }

  for (const file of files) {
    count++;
    bytes += file.size ?? (typeof file.content === 'string' ? Buffer.byteLength(file.content) : file.content?.byteLength ?? 0);
    scanOneFile(file, violations, warnings, truncated, opts);
  }
  return { allowed: violations.length === 0, files: count, bytes, violations, warnings, truncated };
}

// ────────────────────────────────────────────────────────────────────────────
// 五、已知缺口（**不要**把本模块当安全边界；这段必须同步进交付报告）
// ────────────────────────────────────────────────────────────────────────────
//
//  1. 内容型攻击面没做：构建脚本、package.json 里 `postinstall`、Makefile、
//     `.vscode/tasks.json`、CI 配置（.github/workflows/**）等 —— 推上来本身不执行，
//     但创建者的 AI/人"跑一下看看"就会执行（ADR 附三.1② 要求隔离环境，本模块管不了）。
//  2. git 的正常执行面：`.gitmodules`（子模块递归到任意仓库，本模块只告警）、
//     `merge=<driver>`、`!` 形式的属性、`refs/notes/**` 未做限制。
//  3. 只校验 git 层。**SSH 层没做**：如果 sshd 给的是 shell 而不是
//     `command="git-receive-pack ..."` 的 forced-command，那任何路径校验都是摆设。
//  4. 大小写/Unicode 折叠是**近似**：只做 NFKC + toLowerCase，没有完全实现
//     Windows/macOS 的真实文件名比较规则（如 U+0131、土耳其语 I、HFS+ 的 NFD 历史行为）。
//  5. 引用透明性没做：packfile 里的对象图（旧对象、.git/objects 内既有内容）、
//     `git replace`、alternates、`core.fsmonitor` 等由服务端配置决定的面。
//  6. 发布扫描是**正则**：混淆/编码（base64、UTF-16、图片里的文字、压缩包）一律漏检；
//     邮箱与密钥的少量变体（拼接、变量插值）也会漏。
//  7. 没有时序/数量控制：一次推 50 万个路径的 DoS、以及"先合法推入、后续再改"的两步走，
//     本模块都是无状态单次判定。
//  8. 租约（lease.ts）是**进程内**仲裁：跨进程/跨机器需要接播与落盘，见 lease.ts 末尾说明。
