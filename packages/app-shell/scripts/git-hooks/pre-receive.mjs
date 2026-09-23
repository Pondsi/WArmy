#!/usr/bin/env node
/**
 * pre-receive —— WArmy 仓库门禁钩子（**纯 Node，零第三方依赖**）
 *
 * 安装（幂等，只写这个仓库自己的 hook，不动全局 git config）：
 *   node packages/app-shell/scripts/git-hooks/pre-receive.mjs --install <repoDir>
 *
 * 运行（git push 时由 git 自动调用，stdin 是 `<old-sha> <new-sha> <refname>` 三列）：
 *   pre-receive.mjs
 *
 * 角色/成员从环境变量读，缺省当最严的 member：
 *   WARMY_PUSHER_ROLE = member | admin | creator | duty
 *   WARMY_PUSHER_ID   = 成员 id
 *
 * 退出码：0 = 放行；1 = 整批拒绝（逐条原因已打印）。
 * 校验逻辑在 `../dist/repo-hooks.js`（由 TS 编译；脚本本身只做 I/O 与退出码）。
 */
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import process from 'node:process';

const here = path.dirname(fileURLToPath(import.meta.url));

async function loadImpl() {
  const candidates = [
    path.join(here, '..', '..', 'dist', 'repo-hooks.js'),
    path.join(here, '..', 'dist', 'repo-hooks.js'),
    path.join(here, 'repo-hooks.js'),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return await import(new URL(`file://${c.replace(/\\/g, '/')}`).href);
    } catch {
      /* 继续找下一个 */
    }
  }
  throw new Error(`repo-hooks.js not found（先跑 pnpm --filter @warmy/app-shell build）；找过：${candidates.join(' / ')}`);
}

const argv = process.argv.slice(2);

if (argv[0] === '--install') {
  const repoDir = argv[1] || process.cwd();
  const { installPreReceiveHook } = await loadImpl();
  const r = installPreReceiveHook({ repoDir, hookScript: fileURLToPath(import.meta.url), force: argv.includes('--force') });
  process.stdout.write(JSON.stringify({ ...r, script: fileURLToPath(import.meta.url) }) + '\n');
  process.exit(r.ok ? 0 : 1);
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => {
      data += d;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

const { createGitRunner, formatPreReceiveOutput, runPreReceive } = await loadImpl();

const role = (process.env.WARMY_PUSHER_ROLE || 'member').trim();
const memberId = (process.env.WARMY_PUSHER_ID || '').trim();
const allowedRoles = new Set(['member', 'admin', 'creator', 'duty']);
if (!allowedRoles.has(role)) {
  process.stdout.write(`[warmy repo-guard] WARMY_PUSHER_ROLE 非法：${role}（允许 member/admin/creator/duty）→ 按最严的 member 处理\n`);
}

const stdin = await readStdin();
const result = runPreReceive({
  git: createGitRunner(),
  stdin,
  role: (allowedRoles.has(role) ? role : 'member'),
  memberId,
  assumeFastForward: process.env.WARMY_GUARD_ASSUME_FF === '1',
  allowForceByCreator: process.env.WARMY_GUARD_ALLOW_CREATOR_FORCE === '1',
});

for (const line of formatPreReceiveOutput(result)) process.stdout.write(line + '\n');
process.exit(result.ok ? 0 : 1);
