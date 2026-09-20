/**
 * repo-hooks —— pre-receive 门禁：把 `repo-guard.ts` 的校验真的挂到 git 上
 *
 * 为什么逻辑放在 TS 里、脚本只是入口：
 *   · 校验逻辑要能被 `scripts/verify-wiring.mjs` 直接 import 断言（不用起子进程猜输出）；
 *   · CLI 入口 `scripts/git-hooks/pre-receive.mjs` 保持**纯 Node、零第三方依赖**（只 import 本文件的 dist）。
 *
 * pre-receive 的 stdin 协议：每行三列 `<old-sha> <new-sha> <refname>`（空格分隔）。
 * 本实现逐 ref 校验 + 逐 ref 路径校验 + **跨 ref 合并后的别名碰撞**校验（更严，fail-closed）。
 *
 * 角色/成员来自环境变量（缺省当最严的 `member`）：
 *   WARMY_PUSHER_ROLE = member | admin | creator | duty
 *   WARMY_PUSHER_ID   = 成员 id（用于 refs/heads/members/<id>/** 命名空间）
 *   WARMY_GUARD_ASSUME_FF = 1 时允许"对象图不可用也放行快进"（默认禁止 = fail-closed）
 *
 * 明确不做的事：不改用户机器上的全局 git config（hooksPath 等）；不推送、不提交。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  validatePushPaths,
  validateRefUpdate,
  type TuiSongLuJingTiaoMu,
  type TuiSongLuJingJuJue,
  type YinYongDongZuo,
  type YinyongJujue,
  type YinYongGengXinXuanXiang,
} from './repo-guard.js';

export type GuardRole = NonNullable<YinYongGengXinXuanXiang['role']>;

export interface GitRunResult {
  code: number;
  stdout: string;
  stderr: string;
  /** spawn 本身失败（git 不在 PATH 等）时的原因 */
  error?: string;
}

export type GitRunner = (args: string[], opts?: { cwd?: string }) => GitRunResult;

/**
 * 默认 runner：真的调 git（cwd 由 hook 的进程环境决定：GIT_DIR 已由 git 注入）。
 * ⚠️ 必须把 spawnSync 的结果**归一化**成 `{ code, stdout, stderr }`：
 * spawnSync 给的是 `{ status, signal, output, stdout… }`，直接 cast 会让 `r.code` 永远是 undefined，
 * 于是每一次判定都当成"git 失败"（这个坑在 verify-wiring 里被真跑抓出来过）。
 */
export function createGitRunner(cwd?: string): GitRunner {
  return (args, opts) => {
    const r = spawnSync('git', args, {
      cwd: opts?.cwd ?? cwd,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    });
    return {
      code: typeof r.status === 'number' ? r.status : -1,
      stdout: String(r.stdout ?? ''),
      stderr: String(r.stderr ?? ''),
      ...(r.error ? { error: String(r.error.message) } : {}),
    };
  };
}

export interface PreReceiveRef {
  oldSha: string;
  newSha: string;
  ref: string;
}

const ZERO_SHA = /^0{40}$|^0{64}$/;

export function isZeroSha(sha: string): boolean {
  return ZERO_SHA.test(String(sha || '').trim());
}

/** 解析 pre-receive 的 stdin（容忍 CRLF / 空行 / 多余空格） */
export function parsePreReceiveStdin(text: string): { refs: PreReceiveRef[]; malformed: string[] } {
  const refs: PreReceiveRef[] = [];
  const malformed: string[] = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
      malformed.push(line);
      continue;
    }
    refs.push({ oldSha: parts[0], newSha: parts[1], ref: parts[2] });
  }
  return { refs, malformed };
}

/** 变更类型 → 只关心"新增/修改"（删除的路径不需要做危险路径校验） */
function baohanZhuangtai(status: string): boolean {
  return /^[AMCT]$/.test(status[0] ?? '');
}

/**
 * 枚举一个 ref 更新涉及的路径，组装 `PushPathEntry[]`（真正喂给 validatePushPaths 的东西）。
 *
 * 用到的真实 git 命令：
 *   · 创建：`git diff-tree -r --no-commit-id --name-status -z --root <new>`
 *   · 更新：`git diff-tree -r --no-commit-id --name-status -z <old> <new>`
 *   · 取 mode：`git ls-tree -z <new> -- ":(literal)<path>"`
 *   · 取内容（符号链接目标 / .gitattributes 文本）：`git cat-file -p <new>:<path>`
 */
export function shoujiTuisongTiaomu(
  git: GitRunner,
  ref: PreReceiveRef
): { entries: TuiSongLuJingTiaoMu[]; errors: string[]; deleted: boolean } {
  const errors: string[] = [];
  if (isZeroSha(ref.newSha)) return { entries: [], errors, deleted: true };

  const args = isZeroSha(ref.oldSha)
    ? ['diff-tree', '-r', '--no-commit-id', '--name-status', '-z', '--root', ref.newSha]
    : ['diff-tree', '-r', '--no-commit-id', '--name-status', '-z', ref.oldSha, ref.newSha];
  const chaYi = git(args);
  if (chaYi.code !== 0) {
    // 枚举不出来 → fail-closed（不能"看不见就当没事"）
    return { entries: [], errors: [`diff-tree 失败（exit ${chaYi.code}）：${(chaYi.stderr || '').trim().slice(0, 200)}`], deleted: false };
  }

  // -z 输出：`status\0path\0`（R/C 为 `status\0old\0new\0`）
  const fields = chaYi.stdout.split('\0');
  const changes: { status: string; path: string }[] = [];
  for (let i = 0; i < fields.length; i++) {
    const status = fields[i];
    if (!status) continue;
    const first = fields[i + 1];
    if (first === undefined) break;
    if (/^[RC]/.test(status)) {
      const second = fields[i + 2];
      if (second === undefined) break;
      changes.push({ status, path: second });
      i += 2;
      continue;
    }
    changes.push({ status, path: first });
    i += 1;
  }

  const entries: TuiSongLuJingTiaoMu[] = [];
  for (const c of changes) {
    if (!baohanZhuangtai(c.status)) continue;
    const entry: TuiSongLuJingTiaoMu = { path: c.path };
    const ls = git(['ls-tree', '-z', ref.newSha, '--', `:(literal)${c.path}`]);
    if (ls.code === 0 && ls.stdout.trim()) {
      const rec = ls.stdout.split('\0')[0] ?? '';
      const m = /^(\d{6})\s+(\w+)\s+([0-9a-f]+)\t/.exec(rec);
      if (m?.[1]) entry.mode = m[1];
    } else {
      errors.push(`ls-tree 取不到 mode：${c.path}`);
    }
    const basename = c.path.split('/').pop() ?? '';
    const xuyaoNeirong = entry.mode === '120000' || basename === '.gitattributes';
    if (xuyaoNeirong) {
      const cat = git(['cat-file', '-p', `${ref.newSha}:${c.path}`]);
      if (cat.code === 0) {
        if (entry.mode === '120000') entry.symlinkTarget = cat.stdout;
        entry.content = cat.stdout;
      } else {
        errors.push(`cat-file 取不到内容：${c.path}`);
      }
    }
    entries.push(entry);
  }
  return { entries, errors, deleted: false };
}

export interface PreReceiveRefResult {
  ref: string;
  action: YinYongDongZuo;
  allowed: boolean;
  rejections: YinyongJujue[];
  warnings: string[];
  pathRejected: TuiSongLuJingJuJue[];
  pathWarnings: string[];
  entries: number;
  enumerationErrors: string[];
}

export interface PreReceiveResult {
  ok: boolean;
  role: GuardRole;
  memberId: string;
  refs: PreReceiveRefResult[];
  /** 跨 ref 合并后的别名碰撞校验（更严：不同 ref 里推 A.txt / a.txt 也会撞） */
  union: { allowed: boolean; rejected: TuiSongLuJingJuJue[]; warnings: string[]; entries: number } | null;
  malformed: string[];
  fatal?: string;
}

export interface RunPreReceiveOptions {
  git: GitRunner;
  stdin: string;
  role?: GuardRole;
  memberId?: string;
  /** 没有对象图可判定时是否放行（默认 false = fail-closed） */
  assumeFastForward?: boolean;
  allowForceByCreator?: boolean;
  now?: () => number;
}

/** 纯逻辑入口（验证脚本直接调它，不用起子进程） */
export function runPreReceive(opts: RunPreReceiveOptions): PreReceiveResult {
  const role: GuardRole = opts.role ?? 'member';
  const memberId = opts.memberId ?? '';
  const parsed = parsePreReceiveStdin(opts.stdin);
  const fatal = parsed.refs.length === 0 ? (parsed.malformed.length ? 'no-valid-refs' : 'empty-stdin') : undefined;

  const refResults: PreReceiveRefResult[] = [];
  const unionEntries: TuiSongLuJingTiaoMu[] = [];

  for (const ref of parsed.refs) {
    const yiZhi = opts.git(['rev-parse', '--verify', '--quiet', ref.ref]);
    const knownSha = yiZhi.code === 0 ? yiZhi.stdout.trim() : '';

    const ancestorCache = new Map<string, boolean | undefined>();
    const isAncestor = (a: string, d: string): boolean | undefined => {
      const key = `${a}..${d}`;
      if (ancestorCache.has(key)) return ancestorCache.get(key);
      const r = opts.git(['merge-base', '--is-ancestor', a, d]);
      const v: boolean | undefined = r.code === 0 ? true : r.code === 1 ? false : undefined;
      ancestorCache.set(key, v);
      return v;
    };

    const refCheck = validateRefUpdate(ref.ref, ref.oldSha, ref.newSha, {
      role,
      memberId,
      knownSha,
      isAncestor,
      assumeFastForward: opts.assumeFastForward === true,
      ...(opts.allowForceByCreator === true ? { allowForceByCreator: true } : {}),
    });

    const collected = shoujiTuisongTiaomu(opts.git, ref);
    const pathCheck = validatePushPaths(collected.entries, { base: 'worktree' });
    if (!collected.deleted) unionEntries.push(...collected.entries);

    refResults.push({
      ref: ref.ref,
      action: refCheck.action,
      allowed: refCheck.allowed && pathCheck.allowed && collected.errors.length === 0,
      rejections: refCheck.rejections,
      warnings: refCheck.warnings,
      pathRejected: pathCheck.rejected,
      pathWarnings: pathCheck.warnings,
      entries: collected.entries.length,
      enumerationErrors: collected.errors,
    });
  }

  let union: PreReceiveResult['union'] = null;
  if (unionEntries.length > 0) {
    const u = validatePushPaths(unionEntries, { base: 'worktree' });
    union = { allowed: u.allowed, rejected: u.rejected, warnings: u.warnings, entries: unionEntries.length };
  }

  const ok = !fatal && refResults.every((r) => r.allowed) && (union === null || union.allowed);
  return { ok, role, memberId, refs: refResults, union, malformed: parsed.malformed, ...(fatal ? { fatal } : {}) };
}

/**
 * 打印给推送方看的逐条原因。
 * 标题行是 ASCII（hook 输出是开发者面向的，不进 UI，也不进 i18n）；
 * 逐条 reason 直接来自 repo-guard 的结构化输出，**不重写、不裁剪**。
 */
export function formatPreReceiveOutput(r: PreReceiveResult): string[] {
  const out: string[] = [];
  out.push('[warmy repo-guard] pre-receive');
  out.push(`  role=${r.role} memberId=${r.memberId || '-'} refs=${r.refs.length}`);
  if (r.fatal) out.push(`  FATAL: ${r.fatal}（输入为空或全部非法 → 一律拒绝）`);
  for (const m of r.malformed) out.push(`  MALFORMED LINE: ${m}`);
  for (const ref of r.refs) {
    out.push(`  ref ${ref.ref}  action=${ref.action}  entries=${ref.entries}  ${ref.allowed ? 'ALLOW' : 'REJECT'}`);
    for (const rej of ref.rejections) out.push(`    [ref/${rej.code}] ${rej.reason}`);
    for (const rej of ref.pathRejected) out.push(`    [path/${rej.code}] ${rej.path}: ${rej.reason}`);
    for (const err of ref.enumerationErrors) out.push(`    [enumerate] ${err}`);
    for (const w of ref.warnings) out.push(`    [warn] ${w}`);
    for (const w of ref.pathWarnings) out.push(`    [warn] ${w}`);
  }
  if (r.union) {
    out.push(`  cross-ref batch check: entries=${r.union.entries} ${r.union.allowed ? 'ALLOW' : 'REJECT'}`);
    for (const rej of r.union.rejected) out.push(`    [batch/${rej.code}] ${rej.path}: ${rej.reason}`);
  }
  out.push(r.ok ? '  RESULT: pass (0)' : '  RESULT: rejected (1) — 整批拒绝，请修正后重推');
  return out;
}

/* ────────────────────────────── 钩子安装 ────────────────────────────── */

export interface AnzhuangGouziJieguo {
  ok: boolean;
  hookPath?: string;
  gitDir?: string;
  alreadyInstalled?: boolean;
  error?: string;
}

export const GOUZI_BIAOZHI = '# WARMY-REPO-GUARD-HOOK v1';

/** 生成 `hooks/pre-receive` 的包装脚本（POSIX sh；Git for Windows 也用 sh 执行钩子） */
export function gouziBaozhuangJiaoben(nodeBin: string, hookScript: string): string {
  const n = nodeBin.replace(/\\/g, '/');
  const h = hookScript.replace(/\\/g, '/');
  return `#!/bin/sh\n${GOUZI_BIAOZHI}\n# 由 WArmy 生成（幂等；不要手改）。校验逻辑见 packages/app-shell/src/repo-hooks.ts\nexec "${n}" "${h}"\n`;
}

/**
 * 给仓库安装 pre-receive 钩子。
 * **不动全局 git config**（不设 core.hooksPath）：只写这个仓库自己的 `<gitdir>/hooks/pre-receive`。
 * 已有别人的钩子且不是我们装的 → 拒绝覆盖（返回 error: hook-exists），需要 force。
 */
export function installPreReceiveHook(opts: {
  repoDir: string;
  hookScript: string;
  nodeBin?: string;
  force?: boolean;
  git?: GitRunner;
}): AnzhuangGouziJieguo {
  const git = opts.git ?? createGitRunner(opts.repoDir);
  const gitDirRes = git(['rev-parse', '--absolute-git-dir']);
  if (gitDirRes.code !== 0) {
    return { ok: false, error: `not-a-git-repo:${(gitDirRes.stderr || '').trim().slice(0, 120)}` };
  }
  const gitDir = gitDirRes.stdout.trim();
  const hooksDir = path.join(gitDir, 'hooks');
  const hookPath = path.join(hooksDir, 'pre-receive');
  try {
    fs.mkdirSync(hooksDir, { recursive: true });
  } catch (e) {
    return { ok: false, gitDir, error: (e as NodeJS.ErrnoException).code ?? 'mkdir-failed' };
  }
  if (fs.existsSync(hookPath)) {
    let current = '';
    try {
      current = fs.readFileSync(hookPath, 'utf8');
    } catch {
      current = '';
    }
    if (current.includes(GOUZI_BIAOZHI)) {
      return { ok: true, hookPath, gitDir, alreadyInstalled: true };
    }
    if (opts.force !== true) return { ok: false, hookPath, gitDir, error: 'hook-exists' };
  }
  try {
    fs.writeFileSync(hookPath, gouziBaozhuangJiaoben(opts.nodeBin ?? process.execPath, opts.hookScript), 'utf8');
    fs.chmodSync(hookPath, 0o755);
    return { ok: true, hookPath, gitDir, alreadyInstalled: false };
  } catch (e) {
    return { ok: false, hookPath, gitDir, error: (e as NodeJS.ErrnoException).code ?? 'write-failed' };
  }
}

/** 钩子脚本的候选路径（开发态 scripts/git-hooks、打包态 dist/git-hooks） */
export function gouziJiaobenHouxuan(appRoot: string): string[] {
  return [
    path.join(appRoot, 'scripts', 'git-hooks', 'pre-receive.mjs'),
    path.join(appRoot, 'git-hooks', 'pre-receive.mjs'),
    path.join(appRoot, 'dist', 'git-hooks', 'pre-receive.mjs'),
  ];
}

/** 找到第一个存在的钩子脚本；都没有则返回 null（**不要**假装装好了） */
export function findHookScript(appRoot: string): string | null {
  for (const p of gouziJiaobenHouxuan(appRoot)) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return null;
}
