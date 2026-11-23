/**
 * @warmy/dsh-runtime — 用 bundled Node 拉起真实 dsh 实例
 *
 * InstanceManager 只负责进程生命周期；本包负责：
 * - 定位 dsh CLI / profile
 * - 组装 argv 与 env（Provider 配置经 env 注入，密钥不落盘明文日志）
 * - 解析控制面 ready/fatal
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { AcpKongzhiXiaoxi } from '@warmy/contracts';

/** 控制面消息统一按契约定形（宿主 memory-client 按同一份类型解析） */
export type DshKongzhiXiaoxi = AcpKongzhiXiaoxi;

export interface DshLaunchOptions {
  /** node 可执行文件（bundled 或系统） */
  nodePath: string;
  /** dsh 包目录，内含 lib/bin.js 或 bin 字段 */
  dshPackageDir: string;
  /** DSH_HOME */
  dshJiaMuLu: string;
  profile: string;
  cwd: string;
  env?: Record<string, string>;
  /** 传给 dsh yingYong 的参数 */
  appArgs?: string[];
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  onMessage?: (xiaoXi: DshKongzhiXiaoxi | unknown) => void;
}

export interface DshHandle {
  Zhi: ChildProcess;
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
  const Zhi = spawn(opts.nodePath, [entry, ...args], {
    cwd: opts.cwd,
    env: {
      ...process.env,
      DSH_HOME: opts.dshJiaMuLu,
      ...opts.env,
    },
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  });
  Zhi.stdout?.on('data', (d: Buffer) => opts.onStdout?.(d.toString()));
  Zhi.stderr?.on('data', (d: Buffer) => opts.onStderr?.(d.toString()));
  Zhi.on('message', (m) => opts.onMessage?.(m));
  return { Zhi, pid: Zhi.pid || 0 };
}

/** 确保 profile 存在：不存在则从 web 模板创建 */
export async function ensureDshProfile(opts: {
  nodePath: string;
  dshPackageDir: string;
  dshJiaMuLu: string;
  profile: string;
  fromDefault?: string;
}): Promise<{ created: boolean; profileDir: string }> {
  const profileDir = path.join(opts.dshJiaMuLu, 'profiles', opts.profile);
  if (fs.existsSync(path.join(profileDir, 'package.json'))) {
    return { created: false, profileDir };
  }
  const entry = resolveDshEntry(opts.dshPackageDir);
  await new Promise<void>((resolve, reject) => {
    const Zhi = spawn(
      opts.nodePath,
      [entry, '--profile', opts.profile, '--from-default-profile', opts.fromDefault || 'web', '--dump-config'],
      {
        env: { ...process.env, DSH_HOME: opts.dshJiaMuLu },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    let err = '';
    Zhi.stderr?.on('data', (d: Buffer) => (err += d.toString()));
    Zhi.on('exit', (code) => {
      if (fs.existsSync(path.join(profileDir, 'package.json'))) resolve();
      else reject(new Error(`create profile failed code=${code} ${err.slice(0, 300)}`));
    });
    Zhi.on('error', reject);
  });
  return { created: true, profileDir };
}

/** R258：写 warmy-memory 接管 patch 进 profile cordis.patch.yml。
 *  禁用默认 compaction-basic + 把 WArmy 记忆插件插进 compaction 隔离组（command-compact 自动跟随新服务）。
 *  contextPercent = 上下文预算百分比（相对当前模型 contextWindow）→ thresholdRatio。 */
export function writeWarmyMemoryPatch(profileDir: string, pluginPath: string, contextPercent: number): void {
  const percent = Math.min(100, Math.max(10, Math.round(Number(contextPercent) || 80)));
  const yml = [
    '# R258 WArmy 记忆系统接管：禁默认 compaction，挂 warmy-memory（上下文预算 ' + percent + '%）',
    '- id: compaction-basic',
    '  disabled: true',
    '- id: compaction',
    '  insert:',
    '    - id: warmy-memory',
    '      name: ' + JSON.stringify(pluginPath),
    '      config:',
    '        contextPercent: ' + percent,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), yml, 'utf8');
}

/** 向 InstanceManager 暴露的入口脚本路径 */
export function writeDshInstanceEntry(outFile: string, opts: {
  dshPackageDir: string;
  dshJiaMuLu: string;
  profile: string;
  /** R298：所属会话的开发模式快照（只读继承；未开启为 enabled:false） */
  kaiFa?: { enabled: boolean; modeVersion: number };
}): void {
  const entry = resolveDshEntry(opts.dshPackageDir);
  const kaiFa = opts.kaiFa ? { enabled: !!opts.kaiFa.enabled, modeVersion: Number(opts.kaiFa.modeVersion) || 1 } : { enabled: false, modeVersion: 1 };
  const src = `// WArmy dsh instance entry
// 控制面消息按 @warmy/contracts 的 AcpKongzhiXiaoxi 定形（宿主 memory-client 按同一份类型解析）：
//   { type:'ready', pid, dshPid } / { type:'dsh-exit', code } / { type:'pong' }
import { spawn } from 'node:child_process';

const entry = ${JSON.stringify(entry)};
const dshHome = ${JSON.stringify(opts.dshJiaMuLu)};
const profile = ${JSON.stringify(opts.profile)};
const kaiFa = ${JSON.stringify(kaiFa)};
const child = spawn(process.execPath, [entry, '--profile', profile], {
  cwd: process.cwd(),
  env: { ...process.env, DSH_HOME: dshHome, WARMY_DSH_DIR: ${JSON.stringify(opts.dshPackageDir)}, WARMY_KAIFA_ENABLED: kaiFa.enabled ? '1' : '0', WARMY_KAIFA_MODE_VERSION: String(kaiFa.modeVersion) },
  stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
});

process.send?.({ type: 'ready', pid: process.pid, dshPid: child.pid, kaiFa });

child.on('exit', (code) => {
  process.send?.({ type: 'dsh-exit', code });
  process.exit(code ?? 0);
});

/** R258：warmy-memory 插件 ↔ 宿主 RPC 转发（dsh 子进程 → 宿主；宿主回包 → dsh 子进程）。 */
child.on('message', (m) => {
  if (m && m.type === 'warmy-memory') process.send?.(m);
});

process.on('message', (m) => {
  if (m === 'ping') process.send({ type: 'pong' });
  if (m === 'shutdown') {
    child.kill();
    setTimeout(() => process.exit(0), 100);
  }
  if (m && m.type === 'warmy-memory-reply') child.send(m);
});

setInterval(() => {}, 1 << 30);
`;
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, src, 'utf8');
}
