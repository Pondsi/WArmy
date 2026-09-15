/**
 * @ccarmy/dsh-runtime — 用 bundled Node 拉起真实 dsh 实例
 *
 * InstanceManager 只负责进程生命周期；本包负责：
 * - 定位 dsh CLI / profile
 * - 组装 argv 与 env（Provider 配置经 env 注入，密钥不落盘明文日志）
 * - 解析控制面 ready/fatal
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface DshLaunchOptions {
  /** node 可执行文件（bundled 或系统） */
  nodePath: string;
  /** dsh 包目录，内含 lib/bin.js 或 bin 字段 */
  dshPackageDir: string;
  /** DSH_HOME */
  dshHome: string;
  profile: string;
  cwd: string;
  env?: Record<string, string>;
  /** 传给 dsh app 的参数 */
  appArgs?: string[];
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  onMessage?: (msg: unknown) => void;
}

export interface DshHandle {
  child: ChildProcess;
  pid: number;
}

function resolveDshEntry(dshPackageDir: string): string {
  const pkgPath = path.join(dshPackageDir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    throw new Error(`dsh package not found: ${pkgPath}`);
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
    bin?: string | Record<string, string>;
  };
  let bin: string | undefined;
  if (typeof pkg.bin === 'string') bin = pkg.bin;
  else if (pkg.bin && typeof pkg.bin === 'object') {
    bin = pkg.bin.dsh || Object.values(pkg.bin)[0];
  }
  const entry = bin
    ? path.resolve(dshPackageDir, bin)
    : path.join(dshPackageDir, 'lib', 'bin.js');
  if (!fs.existsSync(entry)) {
    throw new Error(`dsh entry not found: ${entry}`);
  }
  return entry;
}

/** 从 workspace 的 spikes 或全局安装里找 dsh */
export function findDshPackageDir(hints: string[] = []): string | null {
  const candidates = [
    ...hints,
    path.join(process.cwd(), 'node_modules', '@deepseek-ai', 'dsh'),
    path.join(process.cwd(), 'spikes', 'spike-05-plugins', 'node_modules', '@deepseek-ai', 'dsh'),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(path.join(c, 'package.json'))) return c;
  }
  return null;
}

export function launchDsh(opts: DshLaunchOptions): DshHandle {
  const entry = resolveDshEntry(opts.dshPackageDir);
  const args = ['--profile', opts.profile, ...(opts.appArgs || [])];
  const child = spawn(opts.nodePath, [entry, ...args], {
    cwd: opts.cwd,
    env: {
      ...process.env,
      DSH_HOME: opts.dshHome,
      ...opts.env,
    },
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  });
  child.stdout?.on('data', (d: Buffer) => opts.onStdout?.(d.toString()));
  child.stderr?.on('data', (d: Buffer) => opts.onStderr?.(d.toString()));
  child.on('message', (m) => opts.onMessage?.(m));
  return { child, pid: child.pid || 0 };
}

/** 确保 profile 存在：不存在则从 web 模板创建 */
export async function ensureDshProfile(opts: {
  nodePath: string;
  dshPackageDir: string;
  dshHome: string;
  profile: string;
  fromDefault?: string;
}): Promise<{ created: boolean; profileDir: string }> {
  const profileDir = path.join(opts.dshHome, 'profiles', opts.profile);
  if (fs.existsSync(path.join(profileDir, 'package.json'))) {
    return { created: false, profileDir };
  }
  const entry = resolveDshEntry(opts.dshPackageDir);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      opts.nodePath,
      [entry, '--profile', opts.profile, '--from-default-profile', opts.fromDefault || 'web', '--dump-config'],
      {
        env: { ...process.env, DSH_HOME: opts.dshHome },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    let err = '';
    child.stderr?.on('data', (d: Buffer) => (err += d.toString()));
    child.on('exit', (code) => {
      if (fs.existsSync(path.join(profileDir, 'package.json'))) resolve();
      else reject(new Error(`create profile failed code=${code} ${err.slice(0, 300)}`));
    });
    child.on('error', reject);
  });
  return { created: true, profileDir };
}

/** 向 InstanceManager 暴露的入口脚本路径 */
export function writeDshInstanceEntry(outFile: string, opts: {
  dshPackageDir: string;
  dshHome: string;
  profile: string;
}): void {
  const entry = resolveDshEntry(opts.dshPackageDir);
  const src = `// CCArmy dsh instance entry
import { spawn } from 'node:child_process';

const entry = ${JSON.stringify(entry)};
const dshHome = ${JSON.stringify(opts.dshHome)};
const profile = ${JSON.stringify(opts.profile)};
const child = spawn(process.execPath, [entry, '--profile', profile], {
  cwd: process.cwd(),
  env: { ...process.env, DSH_HOME: dshHome },
  stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
});

process.send?.({ type: 'ready', pid: process.pid, dshPid: child.pid });

child.on('exit', (code) => {
  process.send?.({ type: 'dsh-exit', code });
  process.exit(code ?? 0);
});

process.on('message', (m) => {
  if (m === 'ping') process.send({ type: 'pong' });
  if (m === 'shutdown') {
    child.kill();
    setTimeout(() => process.exit(0), 100);
  }
});

setInterval(() => {}, 1 << 30);
`;
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, src, 'utf8');
}
