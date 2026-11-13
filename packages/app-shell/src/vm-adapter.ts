/**
 * vm-adapter —— 可选高级隔离的 VM 适配器层（R196）。
 *
 * 模式：**用户自行安装虚拟机，本程序只对接和使用**（不内置/不分发引擎，规避 GPL copyleft 与体积）。
 * 按需拥有对应隔离环境：用户装了哪个引擎，本程序探测到就对接哪个；没装则明确降级到 L1 进程级。
 *
 * 统一适配器契约：probe / exec / push / pull / snapshot / dispose。
 * 首批两个适配器：Microsandbox（Apache-2.0，microVM，Linux guest）+ QEMU（GPL，跨平台通用）。
 *
 * 安全：VM 内执行不可信代码；密钥留宿主、按目标 host 注入（不进 guest）；网络 allowlist。
 * 可测性：命令构造为纯函数；probe 的二进制探测可注入（门禁脱机真跑，不需真装 VM）。
 */
import { spawn, type ChildProcess } from 'node:child_process';

export interface VmProbeResult { available: boolean; engine: string; version?: string; reason?: string; }
export interface VmExecOpts { cwd?: string; timeoutMs?: number; env?: Record<string, string>; networkAllowlist?: string[]; }
/** 密钥留宿主、按目标 host 注入（不进 guest 明文）；这里只描述策略，实际注入由宿主侧完成。 */
export interface VmSecretPolicy { hostInjected: true; guestPlaintext: false; }
export interface VmExecResult { ok: boolean; code: number | null; stdout: string; stderr: string; error?: string; }
export interface VmAdapter {
  engine: string;
  probe(): Promise<VmProbeResult>;
  exec(sandbox: string, cmd: string, opts?: VmExecOpts): Promise<VmExecResult>;
  push(sandbox: string, local: string, remote: string): Promise<VmExecResult>;
  pull(sandbox: string, remote: string, local: string): Promise<VmExecResult>;
  snapshot(sandbox: string, name: string): Promise<VmExecResult>;
  dispose(sandbox: string): Promise<VmExecResult>;
  /** R209 z1：持久 bidirectional stdio 隧道（VM-backed IPC）；没装返回 null。 */
  spawnTunnel?(sandbox: string, cmd: string): Promise<ChildProcess | null>;
  /** R209 z1：隧道命令构造（纯函数，可测）。 */
  tunnelArgs?(sandbox: string, cmd: string): string[];
}

/** 二进制探测函数（可注入便于测试）：返回路径或 null。 */
export type BinaryChecker = (bin: string) => Promise<string | null>;
export const moRenBinaryChecker: BinaryChecker = async (bin) => {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  return new Promise((resolve) => {
    try {
      const p = spawn(cmd, [bin], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      let out = '';
      p.stdout?.on('data', (d) => { out += String(d); });
      p.on('exit', (code) => resolve(code === 0 ? out.trim().split('\n')[0] || null : null));
      p.on('error', () => resolve(null));
    } catch { resolve(null); }
  });
};

/** 通用命令执行（spawn 无 shell，超时 kill）。 */
function paoMingLing(file: string, args: string[], opts?: VmExecOpts): Promise<VmExecResult> {
  return new Promise((resolve) => {
    try {
      const p = spawn(file, args, { cwd: opts?.cwd, env: { ...process.env, ...(opts?.env || {}) }, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', err = '';
      const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* noop */ } }, opts?.timeoutMs ?? 60000);
      timer.unref?.();
      p.stdout?.on('data', (d) => { out += String(d); if (out.length > 1e6) out = out.slice(-1e6); });
      p.stderr?.on('data', (d) => { err += String(d); if (err.length > 1e6) err = err.slice(-1e6); });
      p.on('exit', (code) => { clearTimeout(timer); resolve({ ok: code === 0, code, stdout: out, stderr: err }); });
      p.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, code: null, stdout: out, stderr: err, error: String(e.message) }); });
    } catch (e) { resolve({ ok: false, code: null, stdout: '', stderr: '', error: String((e as Error).message) }); }
  });
}

/** Microsandbox 适配器（msb CLI；Apache-2.0；microVM，Linux guest）。 */
export class MicrosandboxAdapter implements VmAdapter {
  engine = 'microsandbox';
  constructor(private readonly checker: BinaryChecker = moRenBinaryChecker, private readonly bin = 'msb') {}
  async probe(): Promise<VmProbeResult> {
    const lu = await this.checker(this.bin);
    if (!lu) return { available: false, engine: this.engine, reason: '未检测到 msb（用户需自行安装 Microsandbox）' };
    const r = await paoMingLing(lu, ['--version'], { timeoutMs: 10000 });
    return { available: true, engine: this.engine, version: r.ok ? (r.stdout.trim() || undefined) : undefined, reason: r.ok ? undefined : 'msb 已找到但 --version 失败' };
  }
  /** 纯命令构造（可测）。 */
  execArgs(sandbox: string, cmd: string): string[] { return ['exec', sandbox, '--', 'sh', '-c', cmd]; }
  /** R197 深化：带网络 allowlist 的 exec（默认禁私网/元数据，仅放行显式 host）。 */
  execArgsWithPolicy(sandbox: string, cmd: string, allow?: string[]): string[] {
    const base = ['exec', sandbox];
    if (allow && allow.length) for (const h of allow) base.push('--net-allow', h);
    base.push('--', 'sh', '-c', cmd);
    return base;
  }
  pushArgs(sandbox: string, local: string, remote: string): string[] { return ['cp', local, `${sandbox}:${remote}`]; }
  pullArgs(sandbox: string, remote: string, local: string): string[] { return ['cp', `${sandbox}:${remote}`, local]; }
  snapshotArgs(sandbox: string, name: string): string[] { return ['snap', sandbox, name]; }
  disposeArgs(sandbox: string): string[] { return ['rm', sandbox]; }
  async exec(sandbox: string, cmd: string, opts?: VmExecOpts): Promise<VmExecResult> {
    const lu = await this.checker(this.bin); if (!lu) return { ok: false, code: null, stdout: '', stderr: '', error: 'msb-not-installed' };
    const args = (opts?.networkAllowlist && opts.networkAllowlist.length) ? this.execArgsWithPolicy(sandbox, cmd, opts.networkAllowlist) : this.execArgs(sandbox, cmd);
    return paoMingLing(lu, args, opts);
  }
  async push(sandbox: string, local: string, remote: string): Promise<VmExecResult> { const lu = await this.checker(this.bin); if (!lu) return weiAnZhuang(this.engine); return paoMingLing(lu, this.pushArgs(sandbox, local, remote)); }
  async pull(sandbox: string, remote: string, local: string): Promise<VmExecResult> { const lu = await this.checker(this.bin); if (!lu) return weiAnZhuang(this.engine); return paoMingLing(lu, this.pullArgs(sandbox, remote, local)); }
  async snapshot(sandbox: string, name: string): Promise<VmExecResult> { const lu = await this.checker(this.bin); if (!lu) return weiAnZhuang(this.engine); return paoMingLing(lu, this.snapshotArgs(sandbox, name)); }
  async dispose(sandbox: string): Promise<VmExecResult> { const lu = await this.checker(this.bin); if (!lu) return weiAnZhuang(this.engine); return paoMingLing(lu, this.disposeArgs(sandbox)); }
  /** R209 z1：隧道命令构造（msb exec … -- sh -c cmd，stdio 留给 JSON-line IPC）。 */
  tunnelArgs(sandbox: string, cmd: string): string[] { return ['exec', sandbox, '--', 'sh', '-c', cmd]; }
  async spawnTunnel(sandbox: string, cmd: string): Promise<ChildProcess | null> {
    const lu = await this.checker(this.bin); if (!lu) return null;
    try { return spawn(lu, this.tunnelArgs(sandbox, cmd), { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] }); } catch { return null; }
  }
}

/** QEMU 适配器（qemu-system + SSH 进 guest；GPL；跨平台通用）。用户自装 QEMU 并建好 guest。 */
export class QemuAdapter implements VmAdapter {
  engine = 'qemu';
  constructor(private readonly checker: BinaryChecker = moRenBinaryChecker, private readonly sshBin = 'ssh', private readonly qemuBin = 'qemu-system-x86_64') {}
  async probe(): Promise<VmProbeResult> {
    const qemu = await this.checker(this.qemuBin);
    const ssh = await this.checker(this.sshBin);
    if (!qemu && !ssh) return { available: false, engine: this.engine, reason: '未检测到 qemu/ssh（用户需自行安装 QEMU 并建 guest）' };
    return { available: true, engine: this.engine, version: qemu ? 'qemu+ssh' : 'ssh-only', reason: qemu ? undefined : '仅 ssh（guest 已在运行）' };
  }
  /** 纯命令构造：经 SSH 在 guest 内执行（sandbox = SSH 目标，如 user@host）。 */
  execArgs(sandbox: string, cmd: string): string[] { return ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', sandbox, cmd]; }
  pushArgs(sandbox: string, local: string, remote: string): string[] { return ['-o', 'BatchMode=yes', local, `${sandbox}:${remote}`]; }
  pullArgs(sandbox: string, remote: string, local: string): string[] { return ['-o', 'BatchMode=yes', `${sandbox}:${remote}`, local]; }
  async exec(sandbox: string, cmd: string, opts?: VmExecOpts): Promise<VmExecResult> {
    const ssh = await this.checker(this.sshBin); if (!ssh) return weiAnZhuang(this.engine);
    return paoMingLing(ssh, this.execArgs(sandbox, cmd), opts);
  }
  async push(sandbox: string, local: string, remote: string): Promise<VmExecResult> {
    const scp = await this.checker('scp'); if (!scp) return weiAnZhuang(this.engine);
    return paoMingLing(scp, this.pushArgs(sandbox, local, remote));
  }
  async pull(sandbox: string, remote: string, local: string): Promise<VmExecResult> {
    const scp = await this.checker('scp'); if (!scp) return weiAnZhuang(this.engine);
    return paoMingLing(scp, this.pullArgs(sandbox, remote, local));
  }
  async snapshot(sandbox: string, name: string): Promise<VmExecResult> {
    // QEMU 快照需 guest 磁盘路径；未配置如实标记（不假装成功）
    return { ok: false, code: null, stdout: '', stderr: '', error: `qemu-snapshot-needs-disk-config（${sandbox}/${name}）` };
  }
  /** R199 深化：qemu-img 磁盘快照命令构造（纯函数，可测）。 */
  snapshotDiskArgs(diskPath: string, name: string): string[] { return ['snapshot', '-c', name, diskPath]; }
  /** R199 深化：用户配置磁盘路径后，经 qemu-img 建快照。 */
  async snapshotDisk(diskPath: string, name: string): Promise<VmExecResult> {
    const bin = await this.checker('qemu-img'); if (!bin) return weiAnZhuang(this.engine);
    return paoMingLing(bin, this.snapshotDiskArgs(diskPath, name));
  }
  async dispose(sandbox: string): Promise<VmExecResult> {
    const ssh = await this.checker(this.sshBin); if (!ssh) return weiAnZhuang(this.engine);
    return paoMingLing(ssh, this.execArgs(sandbox, 'sudo shutdown -h now'));
  }
  /** R209 z1：隧道命令构造（ssh … cmd，stdio 留给 JSON-line IPC）。 */
  tunnelArgs(sandbox: string, cmd: string): string[] { return ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', sandbox, cmd]; }
  async spawnTunnel(sandbox: string, cmd: string): Promise<ChildProcess | null> {
    const ssh = await this.checker(this.sshBin); if (!ssh) return null;
    try { return spawn(ssh, this.tunnelArgs(sandbox, cmd), { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] }); } catch { return null; }
  }
}

function weiAnZhuang(engine: string): VmExecResult { return { ok: false, code: null, stdout: '', stderr: '', error: `${engine}-not-installed` }; }

/**
 * R199 深化：密钥宿主侧注入准备。密钥**留宿主**，按目标 host 生成注入计划，
 * 绝不把明文写进 guest 环境/命令行。返回「哪个 host 用哪个密钥引用」，实际注入由宿主侧完成。
 */
export interface MiYaoZhuRuJiHua { host: string; secretRef: string; guestPlaintext: false; }
export function zhunBeiMiYaoZhuRu(secrets: Record<string, string>, targetHosts: string[]): MiYaoZhuRuJiHua[] {
  const out: MiYaoZhuRuJiHua[] = [];
  for (const host of targetHosts) {
    for (const ref of Object.keys(secrets)) out.push({ host, secretRef: ref, guestPlaintext: false });
  }
  return out; // 只输出引用名，不含密钥值；guestPlaintext 恒 false
}

/** 适配器管理：注册 + 探测全部 + 选可用。用户没装任何引擎 ⇒ 返回空，宿主降级 L1。 */
export class VmAdapterManager {
  private readonly adapters: VmAdapter[] = [];
  constructor(adapters?: VmAdapter[]) { this.adapters = adapters ?? [new MicrosandboxAdapter(), new QemuAdapter()]; }
  lieBiao(): VmAdapter[] { return this.adapters.slice(); }
  async probeAll(): Promise<VmProbeResult[]> { return Promise.all(this.adapters.map((a) => a.probe())); }
  async xuanKeYong(): Promise<VmAdapter | null> {
    for (const a of this.adapters) { const r = await a.probe(); if (r.available) return a; }
    return null; // 都没装 ⇒ 降级 L1 进程级
  }
}