/**
 * L5 Shell 组件：跨平台提权 Helper Tool（真实实现，非 spike 壳）
 *
 * 定位（ADR 000 第四章 Spike 8 / P1「InstanceManager · SecurityManager · Helper Tool」）：
 *   - 平台探测与提权工具选择：Windows → gsudo；macOS → SMAppService；其它 → 明确报不支持
 *   - 具体高权操作：**安全修改 hosts**（幂等 / 先备份 / 失败回滚 / 写入前校验目标行格式）
 *   - **绝不挂住**：一律走非交互模式（gsudo `-n`），无凭据就干净失败并返回明确错误码，
 *     不会弹出无人应答的 UAC 对话框。
 *
 * 约定：
 *   - 只依赖 Node 内置模块（本包声明「零原生模块」），可在 Electron 主进程直接使用。
 *   - 本文件由 spike-08 直接以真实代码路径调用（`spikes/spike-08-helper/run.mjs`），
 *     不做任何 mock：非提权部分对临时文件跑完整文件 I/O，提权部分真跑 gsudo。
 *
 * ── 实测踩坑（本机 Windows 11 / gsudo v2.6.1，2026 复核，详见 spikes/spike-08-helper/result.json）──
 *   1) `gsudo -n` 在**无 gsudo 缓存凭据**的普通用户会话下也可能直接提权成功（本机实测
 *      High Mandatory Level S-1-16-12288），并不会弹 UAC。因此「能不能提权」必须以实际执行结果为准。
 *   2) **`gsudo -n` 不回传内层命令的退出码**（`gsudo -n cmd /c exit 9` 实测返回 0），
 *      但它会**等待**子进程结束。所以本实现不信任 gsudo 的退出码，而是：
 *        a. 把内层命令包成一个临时 .cmd 脚本，让它把 `%errorlevel%` 与输出写到标记文件；
 *        b. 写完后**回读目标文件并比对 sha256**。
 *      二者同时满足才算「写入成功」。
 *   3) gsudo 的 stdout/stderr 在被重定向的 console 下可能为空，必须靠 (a) 的标记文件取原始输出。
 *      标记文件是 cmd 写的，中文是 GBK，需按 GBK 兜底解码（`decodeConsoleOutput`）。
 *   4) **gsudo -n 存在瞬时假失败**：偶发出现「gsudo 自身 exit=0，但内层命令根本没执行、
 *      标记文件不存在」。因此 runElevatedArgs 默认重试 2 次（`retries`），只对可重试错误码重试。
 *   5) 提权 copy 覆盖 hosts 时可能撞上共享冲突（“另一个程序正在使用此文件”），同为瞬时失败。
 *   6) 调用方若在 `commandLine` 里执行另一个 .cmd，**必须写 `call "<script>"`**：
 *      cmd 中从批处理调用批处理不加 call 会转移控制权、外层脚本不再返回，
 *      于是标记文件永远不写、内层结果永远拿不到（本仓 H-13 用例即为此踩坑后所加）。
 *
 * ── 已知残余风险 ──
 *   TOCTOU：临时脚本/暂存文件落在用户私有目录（os.tmpdir()），提权进程会以管理员身份执行它。
 *   若该目录被同机低权用户写入，存在提权放大风险。缓解：随机文件名 + 执行前校验脚本 sha256 +
 *   用后立刻删除；生产环境应改为「固定路径的已签名 helper 服务」而非临时脚本。
 *   （对外暴露的唯一入口是 `applyHostEntry` / `runElevatedArgs`，参数一律走数组，不拼 shell 字符串。）
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';

export const HELPER_TOOL_VERSION = '0.1.0-p0-spike8';

/* ────────────────────────── 类型 ────────────────────────── */

export type HelperPlatform = 'win32' | 'darwin' | 'linux' | 'unsupported';

/** 提权工具种类：Windows 用 gsudo，macOS 用 SMAppService，其它平台明确不支持 */
export type ElevationToolKind = 'gsudo' | 'smappservice' | 'none';

export type HelperErrorCode =
  | 'OK'
  | 'ELEVATION_UNSUPPORTED_PLATFORM'
  | 'ELEVATION_TOOL_MISSING'
  | 'ELEVATION_NO_CREDENTIAL'
  | 'ELEVATION_DENIED'
  | 'ELEVATION_TIMEOUT'
  | 'ELEVATION_FAILED'
  | 'ELEVATION_UNVERIFIED_ON_PLATFORM'
  | 'HOSTS_TARGET_UNREADABLE'
  | 'HOSTS_CONTENT_INVALID'
  | 'HOSTS_ENTRY_INVALID'
  | 'HOSTS_WRITE_FAILED'
  | 'HOSTS_VERIFY_FAILED'
  | 'HOSTS_ROLLBACK_FAILED';

export interface ElevationToolInfo {
  platform: HelperPlatform;
  tool: ElevationToolKind;
  available: boolean;
  executable: string | null;
  version: string | null;
  /** 非交互参数：用于「绝不挂住」；gsudo 为 ['-n'] */
  nonInteractiveArgs: string[];
  supportsNonInteractive: boolean;
  reason: string;
  unverified: string[];
}

export interface CommandResult {
  exe: string;
  args: string[];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError: string | null;
  elapsedMs: number;
}

export interface HostEntrySpec {
  ip: string;
  hostname: string;
  comment?: string;
}

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

export interface HostsLineAnalysis {
  kind: 'blank' | 'comment' | 'entry' | 'invalid';
  ok: boolean;
  reason?: string;
  ip?: string;
  hostnames?: string[];
}

export interface HostsContentAnalysis {
  ok: boolean;
  fatal: string[];
  warnings: string[];
  stats: { lines: number; entries: number; comments: number; blanks: number };
}

export interface BackupInfo {
  source: string;
  path: string;
  bytes: number;
  sha256: string;
  createdAt: string;
}

export interface FileFingerprint {
  path: string;
  exists: boolean;
  bytes: number;
  sha256: string | null;
  lineCount: number;
  entryPresent: boolean;
}

export interface ElevationRawEvidence {
  /** 提权命令（gsudo -n cmd /c <脚本>）本身的原始输出 */
  outer: CommandResult | null;
  /** 提权 shell 内层命令的原始输出（从标记文件读回） */
  innerExitCode: number | null;
  innerOutput: string | null;
  markerFiles: { script: string; log: string; done: string } | null;
  /** 重试记录（仅 writeFileWithFallback 填充）；实测 hosts 会被其它进程短暂占用（共享冲突），需要重试 */
  attemptCount?: number;
  attemptLog?: string[];
}

export interface WriteOutcome {
  ok: boolean;
  method: 'direct' | 'elevated' | null;
  errorCode: HelperErrorCode;
  message: string;
  raw: ElevationRawEvidence | null;
}

export interface HostsOpOptions {
  spec: HostEntrySpec;
  /** 'upsert' 追加/确认；'remove' 精确移除（回滚用） */
  op?: 'upsert' | 'remove';
  hostsFile?: string;
  backupDir?: string;
  /** auto：先尝试直接写，失败再提权；direct：只直接写；elevated：强制走提权 */
  mode?: 'auto' | 'direct' | 'elevated';
  createBackup?: boolean;
  timeoutMs?: number;
  verifyTimeoutMs?: number;
  /** 提权写入的重试次数（默认 2 次重试；实测 hosts 会被其它进程短暂占用） */
  retries?: number;
  toolInfo?: ElevationToolInfo;
  /** 提权前先确认 targets 目录可写性检查，仅用于报告 */
  dryRun?: boolean;
}

export interface HostsOpResult {
  ok: boolean;
  changed: boolean;
  alreadyPresent: boolean;
  removedCount: number;
  errorCode: HelperErrorCode;
  message: string;
  hostsFile: string;
  writeMethod: 'direct' | 'elevated' | null;
  backup: BackupInfo | null;
  before: FileFingerprint;
  after: FileFingerprint;
  verified: boolean;
  rolledBack: boolean;
  warnings: string[];
  tool: ElevationToolInfo;
  raw: ElevationRawEvidence | null;
  plan: { appendedLine: string | null; contentSha256: string | null; bytesToWrite: number };
}

export interface HelperStatus {
  version: string;
  platform: HelperPlatform;
  isAdmin: boolean;
  hostsFile: string;
  hostsWritableByCurrentProcess: boolean;
  tool: ElevationToolInfo;
  credentialCache: { queried: boolean; available: boolean | null; raw: string | null; note: string };
  /** 本机（当前平台）尚无法验证的部分，UI 需据此降级展示 */
  unverified: string[];
}

/* ────────────────────────── 平台与工具探测 ────────────────────────── */

export function detectHelperPlatform(platform: string = process.platform): HelperPlatform {
  if (platform === 'win32' || platform === 'darwin' || platform === 'linux') return platform;
  return 'unsupported';
}

export function defaultHostsPath(platform: HelperPlatform = detectHelperPlatform()): string {
  if (platform === 'win32') {
    const root = process.env['SystemRoot'] ?? process.env['windir'] ?? 'C:\\Windows';
    return path.join(root, 'System32', 'drivers', 'etc', 'hosts');
  }
  return '/etc/hosts';
}

/** gsudo 的候选安装位置（按优先级） */
export function gsudoCandidatePaths(env: NodeJS.ProcessEnv = process.env): string[] {
  const pf = env['ProgramFiles'] ?? 'C:\\Program Files';
  const pfx86 = env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const local = env['LOCALAPPDATA'] ?? '';
  const programData = env['ProgramData'] ?? 'C:\\ProgramData';
  const out: string[] = [];
  const pushed = env['GSUDO_PATH'] ?? env['GsudoPath'];
  if (pushed) out.push(pushed);
  out.push(path.join(pf, 'gsudo', 'Current', 'gsudo.exe'));
  out.push(path.join(pfx86, 'gsudo', 'Current', 'gsudo.exe'));
  if (local) out.push(path.join(local, 'Programs', 'gsudo', 'Current', 'gsudo.exe'));
  out.push(path.join(programData, 'chocolatey', 'bin', 'gsudo.exe'));
  return out;
}

/** 子进程输出解码：优先严格 UTF-8，失败则按 GBK 解（Windows cmd 的 copy/系统提示是 GBK） */
export function decodeConsoleOutput(buf: Buffer): string {
  if (buf.length === 0) return '';
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    // noop → 试 GBK
  }
  try {
    return new TextDecoder('gbk').decode(buf);
  } catch {
    return buf.toString('utf8');
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 通用子进程执行：非交互（stdin=ignore）、可超时、超时杀进程树 */
export async function runProcess(
  exe: string,
  args: string[],
  opts: { timeoutMs?: number; env?: NodeJS.ProcessEnv; cwd?: string } = {}
): Promise<CommandResult> {
  const timeoutMs = opts.timeoutMs ?? 15000;
  const started = Date.now();
  return new Promise<CommandResult>((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(exe, args, {
        // 关键：stdin 直接忽略，任何交互式提示都会立刻拿到 EOF 而不是挂住
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: opts.env ?? process.env,
        cwd: opts.cwd,
      });
    } catch (e) {
      resolve({
        exe,
        args,
        exitCode: null,
        signal: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        spawnError: String((e as Error).message ?? e),
        elapsedMs: Date.now() - started,
      });
      return;
    }

    let stdoutBuf = Buffer.alloc(0);
    let stderrBuf = Buffer.alloc(0);
    let timedOut = false;
    const cap = 64 * 1024; // 只留证据，不吞内存
    child.stdout?.on('data', (d: Buffer) => {
      if (stdoutBuf.length < cap) stdoutBuf = Buffer.concat([stdoutBuf, d]);
    });
    child.stderr?.on('data', (d: Buffer) => {
      if (stderrBuf.length < cap) stderrBuf = Buffer.concat([stderrBuf, d]);
    });
    const decode = () => ({ stdout: decodeConsoleOutput(stdoutBuf), stderr: decodeConsoleOutput(stderrBuf) });

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, timeoutMs);

    child.on('error', (e) => {
      clearTimeout(timer);
      const d = decode();
      resolve({
        exe,
        args,
        exitCode: null,
        signal: null,
        stdout: d.stdout,
        stderr: d.stderr,
        timedOut,
        spawnError: String((e as Error).message ?? e),
        elapsedMs: Date.now() - started,
      });
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const d = decode();
      resolve({
        exe,
        args,
        exitCode: code,
        signal: signal ?? null,
        stdout: d.stdout,
        stderr: d.stderr,
        timedOut,
        spawnError: null,
        elapsedMs: Date.now() - started,
      });
    });
  });
}

function killTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === 'win32') {
    // 杀掉整棵树，避免留下孤儿提权进程
    const k = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    k.on('error', () => {
      /* noop */
    });
  } else {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* noop */
    }
  }
}

/** where.exe gsudo（仅在候选路径都没命中时才用） */
async function whichGsudo(): Promise<string | null> {
  const r = await runProcess(process.platform === 'win32' ? 'where.exe' : 'which', ['gsudo'], { timeoutMs: 5000 });
  if (r.exitCode !== 0) return null;
  const first = r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
  return first ?? null;
}

export async function resolveGsudoExecutable(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  for (const p of gsudoCandidatePaths(env)) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch {
      /* noop */
    }
  }
  return whichGsudo();
}

/** gsudo --version（不需要提权） */
export async function probeGsudo(executable: string): Promise<{ version: string | null; raw: CommandResult }> {
  const raw = await runProcess(executable, ['--version'], { timeoutMs: 10000 });
  const m = raw.stdout.match(/gsudo\s+v?([\w.\-]+)/i);
  return { version: m?.[1] ?? null, raw };
}

/**
 * 查询 gsudo 凭据缓存状态。**只用 `-n`**（非交互）：没有缓存凭据时干净失败，
 * 不会弹出无法应答的 UAC。
 */
export async function queryGsudoCredentialCache(
  executable: string
): Promise<{ available: boolean | null; raw: CommandResult }> {
  const raw = await runProcess(executable, ['-n', 'status'], { timeoutMs: 15000 });
  const text = `${raw.stdout}\n${raw.stderr}`;
  let available: boolean | null = null;
  const m = text.match(/Available for this process:\s*(True|False)/i);
  if (m?.[1]) available = m[1].toLowerCase() === 'true';
  const sessions = text.match(/Total active cache sessions:\s*(\d+)/i);
  if (sessions?.[1] !== undefined && available === null) available = Number(sessions[1]) > 0;
  return { available, raw };
}

/**
 * 选择提权工具。Windows → gsudo；macOS → SMAppService；其它 → 不支持（明确返回原因）。
 * 注意：macOS 的 SMAppService 只能在 macOS 上真正验证；此处如实标注 unverified。
 */
export async function selectElevationTool(): Promise<ElevationToolInfo> {
  const platform = detectHelperPlatform();

  if (platform === 'win32') {
    const exe = await resolveGsudoExecutable();
    if (!exe) {
      return {
        platform,
        tool: 'gsudo',
        available: false,
        executable: null,
        version: null,
        nonInteractiveArgs: ['-n'],
        supportsNonInteractive: true,
        reason: '未找到 gsudo.exe（已查 GSUDO_PATH / Program Files / Program Files (x86) / LOCALAPPDATA / chocolatey / PATH）',
        unverified: [],
      };
    }
    const { version } = await probeGsudo(exe);
    return {
      platform,
      tool: 'gsudo',
      available: true,
      executable: exe,
      version,
      nonInteractiveArgs: ['-n'],
      supportsNonInteractive: true,
      reason:
        'Windows 使用 gsudo；非交互参数 -n。注意：实测 gsudo -n 不回传内层退出码，写操作必须回读校验。',
      unverified: [],
    };
  }

  if (platform === 'darwin') {
    const daemon = macHelperPlan();
    const registered = fs.existsSync(daemon.plistPath);
    return {
      platform,
      tool: 'smappservice',
      available: registered,
      executable: registered ? daemon.helperExecutable : null,
      version: null,
      nonInteractiveArgs: [],
      supportsNonInteractive: registered,
      reason: registered
        ? `SMAppService helper 已注册（${daemon.plistPath}）`
        : 'macOS 走 SMAppService：需要先行注册已签名的 privileged helper（本机未注册）',
      unverified: [
        'SMAppService 注册/调用无法在非 macOS 上验证',
        'macOS 26 的 `fullPath is nil` XPC 连接问题（ADR 已记录）未在本机复现',
      ],
    };
  }

  return {
    platform,
    tool: 'none',
    available: false,
    executable: null,
    version: null,
    nonInteractiveArgs: [],
    supportsNonInteractive: false,
    reason: `平台 ${platform} 未提供提权 Helper 实现（仅支持 Windows=gsudo / macOS=SMAppService）`,
    unverified: ['Linux 侧如需提权，需要另行引入 polkit；当前明确不支持'],
  };
}

/* ────────────────────────── macOS SMAppService 计划 ────────────────────────── */

export interface MacHelperPlan {
  tool: 'smappservice';
  label: string;
  plistPath: string;
  helperExecutable: string;
  plist: string;
  registrationSteps: string[];
  verified: boolean;
  unverifiedReason: string;
}

/** 生成 macOS privileged helper 的注册计划（真实可执行步骤，本机无法验证） */
export function macHelperPlan(opts: { label?: string; helperDir?: string } = {}): MacHelperPlan {
  const label = opts.label ?? 'com.ccarmy.helper';
  const helperDir = opts.helperDir ?? '/Library/PrivilegedHelperTools';
  const helperExecutable = path.join(helperDir, 'ccarmy-helper');
  const plistPath = `/Library/LaunchDaemons/${label}.plist`;
  const plist = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  <string>${label}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    `    <string>${helperExecutable}</string>`,
    '    <string>--write-hosts</string>',
    '  </array>',
    '  <key>MachServices</key>',
    '  <dict>',
    `    <key>${label}</key>`,
    '    <dict><key>ResetAtClose</key><true/></dict>',
    '  </dict>',
    '  <key>RunAtLoad</key>',
    '  <false/>',
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
  return {
    tool: 'smappservice',
    label,
    plistPath,
    helperExecutable,
    plist,
    registrationSteps: [
      '1. 在 Xcode 中为 helper target 打开 App Sandbox 之外的 "Enable XPC Service / Privileged Helper" 能力，并用同一 Team ID 签名（含 hardened runtime）。',
      '2. 主 App 内调用 ServiceManagement.SMAppService.daemon(plistName:) 或 launchd.plist(serviceName:) 注册；注册前把 plist 放进 App bundle 的 Contents/Library/LaunchDaemons/。',
      `3. 注册目标路径（安装后）：${plistPath}；helper 可执行：${helperExecutable}`,
      '4. 用户首次授权后由 launchd 拉活 XPC listener；主 App 通过 NSXPCConnection 调 write-hosts。',
      '5. macOS 26 已知 XPC 断言 fullPath is nil（bundle 未被正确签名/注册时出现），需校验 code signature 与 Team ID。',
    ],
    verified: false,
    unverifiedReason:
      'SMAppService 只能由 macOS 上已签名并注册的 helper bundle 调用；本机为 win32，无 macOS 环境，未验证。',
  };
}

/* ────────────────────────── hosts 行/内容校验 ────────────────────────── */

const HOSTNAME_RE = /^[A-Za-z0-9]([A-Za-z0-9._-]{0,251}[A-Za-z0-9])?$/;

export function validateHostEntrySpec(spec: HostEntrySpec): ValidationResult {
  if (!spec || typeof spec.ip !== 'string' || typeof spec.hostname !== 'string') {
    return { ok: false, reason: 'ip/hostname 必须是字符串' };
  }
  if (net.isIP(spec.ip.trim()) === 0) return { ok: false, reason: `ip 不是合法 IPv4/IPv6：${JSON.stringify(spec.ip)}` };
  const hostname = spec.hostname.trim();
  if (!hostname) return { ok: false, reason: 'hostname 为空' };
  if (hostname.length > 253) return { ok: false, reason: `hostname 超长（${hostname.length} > 253）` };
  if (!HOSTNAME_RE.test(hostname)) return { ok: false, reason: `hostname 含非法字符：${JSON.stringify(hostname)}` };
  if (spec.comment !== undefined) {
    if (/[\r\n]/.test(spec.comment)) return { ok: false, reason: 'comment 含换行' };
    if (spec.comment.includes('#')) return { ok: false, reason: 'comment 不能包含 #' };
    if (spec.comment.length > 120) return { ok: false, reason: 'comment 超长（>120）' };
  }
  return { ok: true };
}

/** 渲染成一行 hosts 记录；此处就是「写入前校验目标行格式」的产物 */
export function formatHostEntry(spec: HostEntrySpec): string {
  const base = `${spec.ip.trim()} ${spec.hostname.trim()}`;
  return spec.comment ? `${base} # ${spec.comment}` : base;
}

/** 分析单行：空行 / 注释 / 合法映射 / 非法 */
export function analyzeHostsLine(line: string): HostsLineAnalysis {
  if (/[\u0000\u0001-\u0008\u000b\u000c\u000e-\u001f]/.test(line)) {
    return { kind: 'invalid', ok: false, reason: '含控制字符' };
  }
  const trimmed = line.trim();
  if (!trimmed) return { kind: 'blank', ok: true };
  if (trimmed.startsWith('#')) return { kind: 'comment', ok: true };
  const hashAt = trimmed.indexOf('#');
  const body = (hashAt === -1 ? trimmed : trimmed.slice(0, hashAt)).trim();
  if (!body) return { kind: 'comment', ok: true };
  const tokens = body.split(/\s+/).filter(Boolean);
  const ip = tokens[0];
  if (ip === undefined) return { kind: 'comment', ok: true };
  if (net.isIP(ip) === 0) return { kind: 'invalid', ok: false, reason: `首个字段不是合法 IP：${JSON.stringify(ip)}` };
  const hostnames = tokens.slice(1);
  if (hostnames.length === 0) return { kind: 'invalid', ok: false, reason: '只有 IP 没有主机名', ip };
  for (const h of hostnames) {
    if (!HOSTNAME_RE.test(h)) return { kind: 'invalid', ok: false, reason: `非法主机名：${JSON.stringify(h)}`, ip };
  }
  return { kind: 'entry', ok: true, ip, hostnames };
}

/** 全量内容体检：fatal 直接拒绝写入，warnings 只记录 */
export function analyzeHostsContent(content: string): HostsContentAnalysis {
  const fatal: string[] = [];
  const warnings: string[] = [];
  if (content.includes('\u0000')) fatal.push('文件含 NUL 字节（疑似二进制/损坏）');
  if (/\r(?!\n)/.test(content)) warnings.push('存在孤立 CR');
  const lines = content.split(/\r?\n/);
  const stats = { lines: lines.length, entries: 0, comments: 0, blanks: 0 };
  lines.forEach((line, i) => {
    if (i === lines.length - 1 && line === '') return; // 末尾换行不算一行
    const a = analyzeHostsLine(line);
    if (a.kind === 'entry') stats.entries += 1;
    else if (a.kind === 'comment') stats.comments += 1;
    else if (a.kind === 'blank') stats.blanks += 1;
    else warnings.push(`第 ${i + 1} 行不符合 hosts 记录格式（保留原样）：${a.reason ?? '未知'}`);
  });
  return { ok: fatal.length === 0, fatal, warnings, stats };
}

export function detectEol(content: string): '\r\n' | '\n' {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

/** 判断某条 (ip, hostname) 是否已存在 */
export function findHostEntry(content: string, spec: HostEntrySpec): { present: boolean; lineNumbers: number[] } {
  const target = spec.hostname.trim().toLowerCase();
  const targetIp = spec.ip.trim();
  const lineNumbers: number[] = [];
  content.split(/\r?\n/).forEach((line, i) => {
    const a = analyzeHostsLine(line);
    if (a.kind !== 'entry' || a.ip !== targetIp) return;
    const names = (a.hostnames ?? []).map((h) => h.toLowerCase());
    if (names.includes(target)) lineNumbers.push(i + 1);
  });
  return { present: lineNumbers.length > 0, lineNumbers };
}

/** 幂等 upsert：已存在不改，末尾按原 EOL 追加校验过的一行 */
export function upsertHostEntry(
  content: string,
  spec: HostEntrySpec
): { ok: boolean; content: string; changed: boolean; alreadyPresent: boolean; reason?: string; appendedLine?: string } {
  const v = validateHostEntrySpec(spec);
  if (!v.ok) return { ok: false, content, changed: false, alreadyPresent: false, reason: v.reason };

  const analysis = analyzeHostsContent(content);
  if (!analysis.ok) {
    return { ok: false, content, changed: false, alreadyPresent: false, reason: `内容体检未通过：${analysis.fatal.join('；')}` };
  }

  const found = findHostEntry(content, spec);
  if (found.present) return { ok: true, content, changed: false, alreadyPresent: true };

  const line = formatHostEntry(spec);
  // 自检渲染结果本身必须能被解析器接受（不盲拼接）
  const selfCheck = analyzeHostsLine(line);
  if (selfCheck.kind !== 'entry' || selfCheck.ip !== spec.ip.trim()) {
    return { ok: false, content, changed: false, alreadyPresent: false, reason: `渲染结果自检失败：${selfCheck.reason ?? '未知'}` };
  }
  const hostnames = selfCheck.hostnames ?? [];
  if (!hostnames.map((h) => h.toLowerCase()).includes(spec.hostname.trim().toLowerCase())) {
    return { ok: false, content, changed: false, alreadyPresent: false, reason: '渲染结果未包含目标主机名' };
  }

  const eol = detectEol(content);
  const base = content.endsWith('\n') ? content : content + eol;
  return { ok: true, content: base + line + eol, changed: true, alreadyPresent: false, appendedLine: line };
}

/** 精确移除（回滚/清理用）：只删 ip+hostname 完全匹配的行 */
export function removeHostEntry(
  content: string,
  spec: HostEntrySpec
): { ok: boolean; content: string; changed: boolean; removedCount: number; reason?: string } {
  const v = validateHostEntrySpec(spec);
  if (!v.ok) return { ok: false, content, changed: false, removedCount: 0, reason: v.reason };
  const target = spec.hostname.trim().toLowerCase();
  const targetIp = spec.ip.trim();
  const eol = detectEol(content);
  let removed = 0;
  const kept: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const a = analyzeHostsLine(line);
    if (
      a.kind === 'entry' &&
      a.ip === targetIp &&
      (a.hostnames ?? []).map((h) => h.toLowerCase()).includes(target) &&
      (a.hostnames ?? []).length === 1
    ) {
      removed += 1;
      continue;
    }
    kept.push(line);
  }
  if (removed === 0) return { ok: true, content, changed: false, removedCount: 0 };
  return { ok: true, content: kept.join(eol), changed: true, removedCount: removed };
}

/* ────────────────────────── 备份 / 指纹 / 回读校验 ────────────────────────── */

export function sha256(text: string | Buffer): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function defaultBackupDir(): string {
  return path.join(os.homedir(), '.ccarmy', 'helper-backups');
}

export function backupFile(source: string, backupDir = defaultBackupDir(), label = 'hosts'): BackupInfo {
  const buf = fs.readFileSync(source);
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(backupDir, `${label}.${stamp}.bak`);
  fs.writeFileSync(target, buf);
  const readBack = fs.readFileSync(target);
  if (!readBack.equals(buf)) throw new Error(`备份校验失败：${target} 内容与源不一致`);
  return { source, path: target, bytes: buf.length, sha256: sha256(buf), createdAt: new Date().toISOString() };
}

export function fingerprintFile(file: string, spec?: HostEntrySpec): FileFingerprint {
  try {
    const buf = fs.readFileSync(file);
    const text = buf.toString('utf8');
    return {
      path: file,
      exists: true,
      bytes: buf.length,
      sha256: sha256(buf),
      lineCount: text.split(/\r?\n/).length - (text.endsWith('\n') ? 1 : 0),
      entryPresent: spec ? findHostEntry(text, spec).present : false,
    };
  } catch {
    return { path: file, exists: false, bytes: 0, sha256: null, lineCount: 0, entryPresent: false };
  }
}

function readTextOrNull(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** 读文件并按 Windows 控制台编码解码（标记文件是 cmd 写的，可能是 GBK） */
function readDecodedOrNull(file: string): string | null {
  try {
    return decodeConsoleOutput(fs.readFileSync(file));
  } catch {
    return null;
  }
}

export function isWritable(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** 回读校验（带轮询，容忍提权进程写盘延迟） */
export async function verifyWrittenContent(
  file: string,
  expected: string,
  opts: { timeoutMs?: number; pollMs?: number } = {}
): Promise<{ match: boolean; actualSha256: string | null; expectedSha256: string; attempts: number; elapsedMs: number }> {
  const timeoutMs = opts.timeoutMs ?? 4000;
  const pollMs = opts.pollMs ?? 150;
  const expectedSha256 = sha256(expected);
  const started = Date.now();
  let attempts = 0;
  let actual: string | null = null;
  while (Date.now() - started <= timeoutMs) {
    attempts += 1;
    actual = readTextOrNull(file);
    if (actual !== null && sha256(actual) === expectedSha256) {
      return { match: true, actualSha256: sha256(actual), expectedSha256, attempts, elapsedMs: Date.now() - started };
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return {
    match: false,
    actualSha256: actual === null ? null : sha256(actual),
    expectedSha256,
    attempts,
    elapsedMs: Date.now() - started,
  };
}

/* ────────────────────────── 提权执行 ────────────────────────── */

function stageDir(): string {
  const dir = path.join(os.tmpdir(), 'ccarmy-helper-stage');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function randomTag(): string {
  return `${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * 用「临时 .cmd 脚本 + 标记文件」执行高权命令。
 * 目的：绕开 gsudo 不回传退出码 / 被重定向 console 下无 stdout 的两个坑。
 * 脚本形态（路径全部为独立参数，不做字符串拼接）：
 *   @echo off
 *   <commandLine> > "<log>" 2>&1
 *   set CCRMY_RC=%errorlevel%
 *   > "<done>" echo %CCRMY_RC%
 *
 * 默认重试 2 次：实测 gsudo -n 偶发出现「进程返回 0 但内层命令根本没执行（无标记文件）」，
 * 以及 hosts 被其它进程短暂占用导致的 copy 共享冲突。这两类失败都是瞬时的，不能一次就报死。
 */
export type ElevatedAttempt = {
  ok: boolean;
  errorCode: HelperErrorCode;
  message: string;
  raw: ElevationRawEvidence;
};

export async function runElevatedArgs(
  args: string[],
  tool: ElevationToolInfo,
  opts: { timeoutMs?: number; commandLine?: string; retries?: number } = {}
): Promise<ElevatedAttempt> {
  const timeoutMs = opts.timeoutMs ?? 30000;
  const maxAttempts = Math.max(1, (opts.retries ?? 2) + 1);
  const emptyRaw: ElevationRawEvidence = { outer: null, innerExitCode: null, innerOutput: null, markerFiles: null };

  if (!tool.available || !tool.executable) {
    return {
      ok: false,
      errorCode: tool.platform === 'unsupported' ? 'ELEVATION_UNSUPPORTED_PLATFORM' : 'ELEVATION_TOOL_MISSING',
      message: tool.reason,
      raw: emptyRaw,
    };
  }
  if (tool.tool === 'smappservice') {
    // macOS：只能由已注册的 XPC helper 执行，这里如实报「需要 helper」
    return {
      ok: false,
      errorCode: fs.existsSync(macHelperPlan().plistPath) ? 'ELEVATION_UNVERIFIED_ON_PLATFORM' : 'ELEVATION_TOOL_MISSING',
      message: 'macOS 提权必须走已注册的 SMAppService helper（本机非 macOS，未验证）',
      raw: emptyRaw,
    };
  }

  const attemptLog: string[] = [];
  let last: ElevatedAttempt | null = null;
  for (let i = 1; i <= maxAttempts; i += 1) {
    const r = await runElevatedOnce(args, tool, { timeoutMs, commandLine: opts.commandLine });
    last = r;
    attemptLog.push(
      `#${i} code=${r.errorCode} outerExit=${r.raw.outer?.exitCode ?? 'n/a'} innerExit=${r.raw.innerExitCode} innerOutput=${JSON.stringify(
        (r.raw.innerOutput ?? '').trim()
      )}`
    );
    if (r.ok) break;
    if (!isRetryableElevationFailure(r.errorCode) || i === maxAttempts) break;
    await delay(400 * i);
  }
  if (!last) {
    return { ok: false, errorCode: 'ELEVATION_FAILED', message: '提权命令未执行', raw: emptyRaw };
  }
  return { ...last, raw: { ...last.raw, attemptCount: attemptLog.length, attemptLog } };
}

async function runElevatedOnce(
  args: string[],
  tool: ElevationToolInfo,
  opts: { timeoutMs: number; commandLine?: string }
): Promise<ElevatedAttempt> {
  const timeoutMs = opts.timeoutMs;
  const executable = tool.executable;
  if (!executable) {
    return { ok: false, errorCode: 'ELEVATION_TOOL_MISSING', message: tool.reason, raw: emptyRawEvidence() };
  }
  const tag = randomTag();
  const dir = stageDir();
  const scriptPath = path.join(dir, `elevated-${tag}.cmd`);
  const logPath = path.join(dir, `elevated-${tag}.log`);
  const donePath = path.join(dir, `elevated-${tag}.done`);

  const commandLine =
    opts.commandLine ??
    args
      .map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a))
      .join(' ');

  const script = [
    '@echo off',
    'setlocal',
    `${commandLine} > "${logPath}" 2>&1`,
    'set CCRMY_RC=%errorlevel%',
    `> "${donePath}" echo %CCRMY_RC%`,
    'endlocal',
    '',
  ].join('\r\n');
  fs.writeFileSync(scriptPath, script, 'utf8');
  const scriptSha = sha256(script);

  const outer = await runProcess(executable, [...tool.nonInteractiveArgs, 'cmd', '/c', scriptPath], {
    timeoutMs,
  });

  // 等标记文件（提权进程可能略晚于 gsudo 返回）；但进程根本没起来/已超时就不必等
  if (!outer.timedOut && !outer.spawnError) {
    const waited = Date.now();
    while (!fs.existsSync(donePath) && Date.now() - waited < Math.min(timeoutMs, 8000)) {
      await delay(120);
    }
  }

  const innerRaw = readDecodedOrNull(donePath);
  const innerOutput = readDecodedOrNull(logPath);
  const innerExitCode = innerRaw === null ? null : Number(innerRaw.trim());

  // 执行后校验脚本未被篡改（TOCTOU 缓解）
  let afterSha: string | null = null;
  try {
    afterSha = sha256(fs.readFileSync(scriptPath, 'utf8'));
  } catch {
    afterSha = null;
  }

  const raw: ElevationRawEvidence = {
    outer,
    innerExitCode: Number.isFinite(innerExitCode) ? (innerExitCode as number) : null,
    innerOutput,
    markerFiles: { script: scriptPath, log: logPath, done: donePath },
  };

  // 清理临时文件
  for (const f of [scriptPath, logPath, donePath]) {
    try {
      fs.rmSync(f, { force: true });
    } catch {
      /* noop */
    }
  }
  raw.markerFiles = null;

  if (outer.timedOut) {
    return { ok: false, errorCode: 'ELEVATION_TIMEOUT', message: `提权命令超时（${timeoutMs}ms），已杀进程树`, raw };
  }
  if (outer.spawnError) {
    return { ok: false, errorCode: 'ELEVATION_FAILED', message: `无法启动提权工具：${outer.spawnError}`, raw };
  }
  const combined = `${outer.stdout}\n${outer.stderr}`;
  if (outer.exitCode === 999 || /credentials?\s+are\s+not\s+available|no\s+cached\s+credentials/i.test(combined)) {
    return {
      ok: false,
      errorCode: 'ELEVATION_NO_CREDENTIAL',
      message: `gsudo -n 无可用凭据，已干净失败（未弹 UAC）：exit=${outer.exitCode}`,
      raw,
    };
  }
  if (afterSha !== scriptSha) {
    return { ok: false, errorCode: 'ELEVATION_FAILED', message: '临时提权脚本在执行前被修改（疑似 TOCTOU），已放弃', raw };
  }
  if (innerExitCode === null) {
    return {
      ok: false,
      errorCode: 'ELEVATION_FAILED',
      message: `提权进程未写回标记文件（gsudo exit=${outer.exitCode}），无法确认内层命令结果`,
      raw,
    };
  }
  if (innerExitCode !== 0) {
    return {
      ok: false,
      errorCode: 'ELEVATION_DENIED',
      message: `内层命令失败，exit=${innerExitCode}`,
      raw,
    };
  }
  return { ok: true, errorCode: 'OK', message: '提权命令执行完成', raw };
}

function emptyRawEvidence(): ElevationRawEvidence {
  return { outer: null, innerExitCode: null, innerOutput: null, markerFiles: null };
}

/** 提权失败是否值得重试：提权本身成功、只是被占位/共享冲突（实测 hosts 会被其它进程短暂持有） */
export function isRetryableElevationFailure(code: HelperErrorCode): boolean {
  return code === 'ELEVATION_DENIED' || code === 'ELEVATION_FAILED' || code === 'HOSTS_WRITE_FAILED';
}

/**
 * 写文件：先试「直接写」，失败（EPERM/EACCES）再提权。
 * 提权路径 = 暂存文件 → gsudo -n cmd /c copy → 标记文件确认 → 回读校验（调用方）。
 * 支持重试：实测 hosts 可能被其它进程短暂占用（copy 报 “另一个程序正在使用此文件”），
 * 这类失败必须重试，否则会误判为「权限不足」。
 */
export async function writeFileWithFallback(opts: {
  target: string;
  content: string;
  mode?: 'auto' | 'direct' | 'elevated';
  tool: ElevationToolInfo;
  timeoutMs?: number;
  retries?: number;
}): Promise<WriteOutcome> {
  const mode = opts.mode ?? 'auto';
  const steps: string[] = [];

  if (mode === 'auto' || mode === 'direct') {
    try {
      const tmp = `${opts.target}.ccarmy-tmp-${randomTag()}`;
      fs.writeFileSync(tmp, opts.content, 'utf8');
      fs.renameSync(tmp, opts.target);
      return { ok: true, method: 'direct', errorCode: 'OK', message: '直接写入成功（进程有写权限）', raw: null };
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? 'UNKNOWN';
      steps.push(`直接写入失败：${code}`);
      if (mode === 'direct') {
        return {
          ok: false,
          method: null,
          errorCode: 'HOSTS_WRITE_FAILED',
          message: `直接写入失败且未启用提权：${code} ${String((e as Error).message ?? e)}`,
          raw: null,
        };
      }
    }
  }

  // 提权路径（重试策略在 runElevatedArgs 内部：默认 2 次重试）
  const stage = path.join(stageDir(), `payload-${randomTag()}.tmp`);
  fs.writeFileSync(stage, opts.content, 'utf8');
  const elevated = await runElevatedArgs(['copy', '/y', stage, opts.target], opts.tool, {
    timeoutMs: opts.timeoutMs ?? 30000,
    commandLine: `copy /y "${stage}" "${opts.target}"`,
    retries: opts.retries,
  });
  try {
    fs.rmSync(stage, { force: true });
  } catch {
    /* noop */
  }

  const raw: ElevationRawEvidence = {
    ...elevated.raw,
    attemptCount: elevated.raw.attemptCount ?? 1,
    attemptLog: elevated.raw.attemptLog ?? [],
  };

  return {
    ok: elevated.ok,
    method: elevated.ok ? 'elevated' : null,
    errorCode: elevated.ok ? 'OK' : elevated.errorCode,
    message: elevated.ok
      ? `提权写入完成${steps.length ? `（${steps.join('；')} → 提权）` : ''}（尝试 ${raw.attemptCount} 次）；gsudo 退出码不可信，已按回读校验判定`
      : `${steps.join('；')}${steps.length ? ' → ' : ''}提权失败（尝试 ${raw.attemptCount} 次）：${elevated.message}；原始输出 ${JSON.stringify(
          (elevated.raw.innerOutput ?? '').trim()
        )}`,
    raw,
  };
}

/** 从备份恢复（回滚） */
export async function restoreFromBackup(opts: {
  target: string;
  backupPath: string;
  tool: ElevationToolInfo;
  mode?: 'auto' | 'direct' | 'elevated';
  timeoutMs?: number;
  retries?: number;
}): Promise<{ ok: boolean; errorCode: HelperErrorCode; message: string; raw: ElevationRawEvidence | null }> {
  const content = readTextOrNull(opts.backupPath);
  if (content === null) {
    return { ok: false, errorCode: 'HOSTS_ROLLBACK_FAILED', message: `备份不可读：${opts.backupPath}`, raw: null };
  }
  const w = await writeFileWithFallback({
    target: opts.target,
    content,
    mode: opts.mode ?? 'auto',
    tool: opts.tool,
    timeoutMs: opts.timeoutMs,
    retries: opts.retries,
  });
  if (!w.ok) {
    return { ok: false, errorCode: 'HOSTS_ROLLBACK_FAILED', message: `回滚写入失败：${w.message}`, raw: w.raw };
  }
  const v = await verifyWrittenContent(opts.target, content, { timeoutMs: opts.timeoutMs ?? 4000 });
  if (!v.match) {
    return { ok: false, errorCode: 'HOSTS_ROLLBACK_FAILED', message: '回滚后回读校验不一致', raw: w.raw };
  }
  return { ok: true, errorCode: 'OK', message: '已从备份回滚并校验通过', raw: w.raw };
}

/* ────────────────────────── 顶层：安全修改 hosts ────────────────────────── */

/**
 * 安全修改 hosts（幂等 / 先备份 / 失败回滚 / 写前校验行格式）。
 * 这是 Helper Tool 对外的主入口，spike-08 与主进程都用它。
 */
export async function applyHostEntry(opts: HostsOpOptions): Promise<HostsOpResult> {
  const op = opts.op ?? 'upsert';
  const hostsFile = opts.hostsFile ?? defaultHostsPath();
  const backupDir = opts.backupDir ?? defaultBackupDir();
  const tool = opts.toolInfo ?? (await selectElevationTool());
  const warnings: string[] = [];

  const before = fingerprintFile(hostsFile, opts.spec);
  const emptyPlan = { appendedLine: null, contentSha256: null, bytesToWrite: 0 };

  const specCheck = validateHostEntrySpec(opts.spec);
  if (!specCheck.ok) {
    return {
      ok: false,
      changed: false,
      alreadyPresent: false,
      removedCount: 0,
      errorCode: 'HOSTS_ENTRY_INVALID',
      message: `目标行非法：${specCheck.reason}`,
      hostsFile,
      writeMethod: null,
      backup: null,
      before,
      after: before,
      verified: false,
      rolledBack: false,
      warnings,
      tool,
      raw: null,
      plan: emptyPlan,
    };
  }

  const current = readTextOrNull(hostsFile);
  if (current === null) {
    return {
      ok: false,
      changed: false,
      alreadyPresent: false,
      removedCount: 0,
      errorCode: 'HOSTS_TARGET_UNREADABLE',
      message: `无法读取 hosts：${hostsFile}`,
      hostsFile,
      writeMethod: null,
      backup: null,
      before,
      after: before,
      verified: false,
      rolledBack: false,
      warnings,
      tool,
      raw: null,
      plan: emptyPlan,
    };
  }

  const analysis = analyzeHostsContent(current);
  warnings.push(...analysis.warnings);
  if (!analysis.ok) {
    return {
      ok: false,
      changed: false,
      alreadyPresent: false,
      removedCount: 0,
      errorCode: 'HOSTS_CONTENT_INVALID',
      message: `拒绝写入：目标文件内容体检未通过（${analysis.fatal.join('；')}）`,
      hostsFile,
      writeMethod: null,
      backup: null,
      before,
      after: before,
      verified: false,
      rolledBack: false,
      warnings,
      tool,
      raw: null,
      plan: emptyPlan,
    };
  }

  const mutated =
    op === 'upsert' ? upsertHostEntry(current, opts.spec) : removeHostEntry(current, opts.spec);
  if (!mutated.ok) {
    return {
      ok: false,
      changed: false,
      alreadyPresent: false,
      removedCount: 0,
      errorCode: 'HOSTS_CONTENT_INVALID',
      message: `变更计算失败：${mutated.reason ?? '未知'}`,
      hostsFile,
      writeMethod: null,
      backup: null,
      before,
      after: before,
      verified: false,
      rolledBack: false,
      warnings,
      tool,
      raw: null,
      plan: emptyPlan,
    };
  }

  const appendedLine = 'appendedLine' in mutated ? (mutated.appendedLine ?? null) : null;
  const removedCount = 'removedCount' in mutated ? mutated.removedCount : 0;
  const alreadyPresent = 'alreadyPresent' in mutated ? mutated.alreadyPresent : false;
  const plan = {
    appendedLine,
    contentSha256: mutated.changed ? sha256(mutated.content) : null,
    bytesToWrite: Buffer.byteLength(mutated.content, 'utf8'),
  };

  const base: HostsOpResult = {
    ok: false,
    changed: false,
    alreadyPresent,
    removedCount,
    errorCode: 'OK',
    message: '',
    hostsFile,
    writeMethod: null,
    backup: null,
    before,
    after: before,
    verified: false,
    rolledBack: false,
    warnings,
    tool,
    raw: null,
    plan,
  };

  // 幂等：已存在（upsert）或无可删行（remove）→ 不写盘
  if (!mutated.changed) {
    return {
      ...base,
      ok: true,
      changed: false,
      verified: true,
      message:
        op === 'upsert'
          ? `幂等跳过：${opts.spec.ip} ${opts.spec.hostname} 已存在（行 ${findHostEntry(current, opts.spec).lineNumbers.join(',')}）`
          : `无需移除：未找到 ${opts.spec.ip} ${opts.spec.hostname} 的单主机名记录`,
    };
  }

  if (opts.dryRun) {
    return { ...base, ok: true, changed: false, message: 'dryRun：已算出变更但未写盘', verified: false };
  }

  // 先备份（读 hosts 不需要提权）
  let backup: BackupInfo | null = null;
  if (opts.createBackup !== false) {
    try {
      backup = backupFile(hostsFile, backupDir, path.basename(hostsFile));
    } catch (e) {
      return {
        ...base,
        errorCode: 'HOSTS_WRITE_FAILED',
        message: `备份失败，已中止写入：${String((e as Error).message ?? e)}`,
      };
    }
  }

  const write = await writeFileWithFallback({
    target: hostsFile,
    content: mutated.content,
    mode: opts.mode ?? 'auto',
    tool,
    timeoutMs: opts.timeoutMs ?? 30000,
    retries: opts.retries,
  });

  const verify = await verifyWrittenContent(hostsFile, mutated.content, {
    timeoutMs: opts.verifyTimeoutMs ?? 5000,
  });

  const after = fingerprintFile(hostsFile, opts.spec);

  if (write.ok && verify.match) {
    return {
      ...base,
      ok: true,
      changed: true,
      writeMethod: write.method,
      backup,
      after,
      verified: true,
      raw: write.raw,
      message: `写入成功（${write.method}）并回读校验通过：sha256=${verify.actualSha256}`,
    };
  }

  // 失败 → 回滚
  let rolledBack = false;
  let rollbackMsg = '';
  if (backup) {
    const rb = await restoreFromBackup({
      target: hostsFile,
      backupPath: backup.path,
      tool,
      mode: opts.mode === 'direct' ? 'auto' : (opts.mode ?? 'auto'),
      timeoutMs: opts.timeoutMs,
      retries: opts.retries,
    });
    rolledBack = rb.ok;
    rollbackMsg = rb.message;
  } else {
    rollbackMsg = '未创建备份，无法回滚';
  }
  const finalFingerprint = fingerprintFile(hostsFile, opts.spec);

  return {
    ...base,
    ok: false,
    changed: false,
    writeMethod: write.method,
    backup,
    after: finalFingerprint,
    verified: false,
    rolledBack,
    raw: write.raw,
    errorCode: write.ok ? 'HOSTS_VERIFY_FAILED' : write.errorCode,
    message:
      `写入/校验失败：${write.message}；回读校验 ${verify.match ? '通过' : '不通过'}` +
      `（期望 sha256=${verify.expectedSha256}，实际=${verify.actualSha256 ?? 'n/a'}，轮询 ${verify.attempts} 次/${verify.elapsedMs}ms）；` +
      `回滚：${rollbackMsg}`,
  };
}

/* ────────────────────────── 状态汇总（给 UI/IPC 用） ────────────────────────── */

export async function getHelperStatus(): Promise<HelperStatus> {
  const platform = detectHelperPlatform();
  const tool = await selectElevationTool();
  const hostsFile = defaultHostsPath(platform);
  const unverified: string[] = [...tool.unverified];

  let credentialCache: HelperStatus['credentialCache'] = {
    queried: false,
    available: null,
    raw: null,
    note: '非 Windows 平台无 gsudo 凭据缓存概念',
  };

  if (platform === 'win32' && tool.executable) {
    const q = await queryGsudoCredentialCache(tool.executable);
    credentialCache = {
      queried: true,
      available: q.available,
      raw: `${q.raw.stdout}\n${q.raw.stderr}`.trim().slice(0, 4000),
      note:
        'gsudo status 报告的缓存状态**不代表实际能否提权**：本机实测 Available=False 时 gsudo -n 仍可提权成功。',
    };
    unverified.push('gsudo 凭据缓存的“可用性”与“能否提权”在实际环境中不一致，必须以实际执行结果为准');
  }

  return {
    version: HELPER_TOOL_VERSION,
    platform,
    isAdmin: platform === 'win32' ? await detectIsAdmin() : false,
    hostsFile,
    hostsWritableByCurrentProcess: isWritable(hostsFile),
    tool,
    credentialCache,
    unverified,
  };
}

/** 是否已提权（Windows 用 net session 探测；不需要提权即可调用） */
export async function detectIsAdmin(): Promise<boolean> {
  if (process.platform !== 'win32') {
    return typeof process.getuid === 'function' ? process.getuid() === 0 : false;
  }
  const r = await runProcess('net', ['session'], { timeoutMs: 8000 });
  return r.exitCode === 0;
}
