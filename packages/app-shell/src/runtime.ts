/**
 * P1 核心：实例生命周期、安全边界、进程树回收
 *
 * 铁律：
 * - 主进程零原生模块（.node 只允许在 bundled Node 子进程）
 * - 值班权仅限本机
 * - Teardown 后进程树归零
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

// ─────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────

export type InstanceStatus = 'created' | 'starting' | 'running' | 'stopping' | 'stopped' | 'dead';

export type SecurityMode = 'full' | 'normal' | 'strict';

export interface InstanceConfig {
  id: string;
  name: string;
  /** 独立 dshHome / workspace */
  workspace: string;
  /** 可选：人格文件路径 */
  personaFile?: string;
  /** 是否允许成为值班者（远程节点永远 false） */
  dutyEligible: boolean;
  /** 模型角色分配 */
  models?: {
    duty?: string;
    executor?: string;
    fallback?: string;
  };
}

export interface InstanceHandle {
  id: string;
  name: string;
  status: InstanceStatus;
  pid?: number;
  workspace: string;
  dutyEligible: boolean;
  startedAt?: number;
}

export interface PermissionDecision {
  action: string;
  scope: 'once' | 'project' | 'global';
  allowed: boolean;
}

// ─────────────────────────────────────────────
// TeardownRegistry — 保证进程树归零
// ─────────────────────────────────────────────

interface TeardownEntry {
  label: string;
  pid: number;
  child?: ChildProcess;
  /** 额外清理钩子 */
  cleanup?: () => Promise<void> | void;
  /** Windows 下是否需要 taskkill /T */
  tree?: boolean;
}

export class TeardownRegistry {
  private entries = new Map<string, TeardownEntry>();
  private shuttingDown = false;

  register(id: string, entry: TeardownEntry): void {
    this.entries.set(id, entry);
    entry.child?.once('exit', () => {
      this.entries.delete(id);
    });
  }

  unregister(id: string): void {
    this.entries.delete(id);
  }

  size(): number {
    return this.entries.size;
  }

  list(): Array<{ id: string; label: string; pid: number }> {
    return [...this.entries.entries()].map(([id, e]) => ({
      id,
      label: e.label,
      pid: e.pid,
    }));
  }

  async shutdownAll(timeoutMs = 5000): Promise<{ killed: number; failed: string[] }> {
    if (this.shuttingDown) return { killed: 0, failed: [] };
    this.shuttingDown = true;
    const failed: string[] = [];
    const jobs = [...this.entries.entries()].map(async ([id, e]) => {
      try {
        await this.killEntry(e, timeoutMs);
        this.entries.delete(id);
      } catch {
        failed.push(id);
      }
    });
    await Promise.all(jobs);
    this.shuttingDown = false;
    return { killed: jobs.length - failed.length, failed };
  }

  private async killEntry(e: TeardownEntry, timeoutMs: number): Promise<void> {
    try {
      await e.cleanup?.();
    } catch {
      /* ignore cleanup errors */
    }
    if (e.child && e.child.exitCode === null && !e.child.killed) {
      const exited = new Promise<void>((resolve) => e.child!.once('exit', () => resolve()));
      e.child.kill('SIGTERM');
      const timer = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
      await Promise.race([exited, timer]);
      if (e.child.exitCode === null) {
        await this.forceKill(e.pid, e.tree !== false);
      }
    } else if (e.pid) {
      await this.forceKill(e.pid, e.tree !== false);
    }
  }

  private async forceKill(pid: number, tree: boolean): Promise<void> {
    try {
      if (process.platform === 'win32') {
        // /T = 杀进程树，满足「停止后进程树归零」
        const args = tree ? ['/PID', String(pid), '/T', '/F'] : ['/PID', String(pid), '/F'];
        await new Promise<void>((resolve) => {
          // windowsHide：否则每杀一次就会在桌面上闪一个控制台窗口（进程结束后窗口还会留着）
          const p = spawn('taskkill', args, { stdio: 'ignore', windowsHide: true });
          p.once('exit', () => resolve());
          p.once('error', () => resolve());
        });
      } else {
        process.kill(pid, 'SIGKILL');
      }
    } catch {
      /* already dead */
    }
  }
}

// ─────────────────────────────────────────────
// SecurityManager — 三级模式 + 持久允许库
// ─────────────────────────────────────────────

export interface AllowlistEntry {
  /** 工具/脚本标识，如 tool:fs.write 或 script:npm */
  key: string;
  scope: 'project' | 'global';
  decision: 'allow' | 'deny';
  createdAt: number;
  note?: string;
}

export interface SecurityStore {
  load(): Promise<{ mode: SecurityMode; allowlist: AllowlistEntry[] }>;
  save(state: { mode: SecurityMode; allowlist: AllowlistEntry[] }): Promise<void>;
}

export class MemorySecurityStore implements SecurityStore {
  private mode: SecurityMode = 'normal';
  private allowlist: AllowlistEntry[] = [];
  async load() {
    return { mode: this.mode, allowlist: [...this.allowlist] };
  }
  async save(state: { mode: SecurityMode; allowlist: AllowlistEntry[] }) {
    this.mode = state.mode;
    this.allowlist = [...state.allowlist];
  }
}

export class FileSecurityStore implements SecurityStore {
  constructor(private file: string) {}
  async load() {
    try {
      const raw = await fs.promises.readFile(this.file, 'utf8');
      const j = JSON.parse(raw);
      return {
        mode: (j.mode as SecurityMode) || 'normal',
        allowlist: (j.allowlist as AllowlistEntry[]) || [],
      };
    } catch {
      return { mode: 'normal' as SecurityMode, allowlist: [] };
    }
  }
  async save(state: { mode: SecurityMode; allowlist: AllowlistEntry[] }) {
    await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
    await fs.promises.writeFile(this.file, JSON.stringify(state, null, 2), 'utf8');
  }
}

export type ApprovalHandler = (req: {
  action: string;
  mode: SecurityMode;
  suggested: 'once' | 'project' | 'global' | 'deny';
}) => Promise<PermissionDecision>;

/**
 * 权限过滤先于相关性检索（不变量 9）
 * 完全授权 / 常规 / 严格
 */
export class SecurityManager {
  private mode: SecurityMode = 'normal';
  private allowlist = new Map<string, AllowlistEntry>();
  private audit: Array<{ ts: number; action: string; decision: string; mode: SecurityMode }> = [];

  constructor(
    private store: SecurityStore = new MemorySecurityStore(),
    private onApprove?: ApprovalHandler
  ) {}

  async init(): Promise<void> {
    const s = await this.store.load();
    this.mode = s.mode;
    this.allowlist.clear();
    for (const e of s.allowlist) this.allowlist.set(this.key(e.scope, e.key), e);
  }

  getMode(): SecurityMode {
    return this.mode;
  }

  async setMode(mode: SecurityMode): Promise<void> {
    this.mode = mode;
    await this.persist();
  }

  private key(scope: string, k: string) {
    return `${scope}::${k}`;
  }

  /**
   * 工具/脚本调用审批
   * full: 直接放行
   * normal: 允许库命中则放行，否则问一次（可持久）
   * strict: 每次仅「允许一次」，不落库
   */
  async requestToolCall(
    action: string,
    opts: { projectKey?: string } = {}
  ): Promise<PermissionDecision> {
    if (this.mode === 'full') {
      return this.record(action, { action, scope: 'once', allowed: true });
    }

    // 先查持久允许库（normal 才查）
    if (this.mode === 'normal') {
      const g = this.allowlist.get(this.key('global', action));
      if (g) return this.record(action, { action, scope: 'global', allowed: g.decision === 'allow' });
      if (opts.projectKey) {
        const p = this.allowlist.get(this.key('project', opts.projectKey));
        if (p) return this.record(action, { action, scope: 'project', allowed: p.decision === 'allow' });
      }
    }

    const suggested = this.mode === 'strict' ? 'once' : 'once';
    // fail-closed：没有审批 UI 时，normal/strict 都不放行
    if (!this.onApprove) {
      return this.record(action, { action, scope: 'once', allowed: false });
    }
    const d = await this.onApprove({ action, mode: this.mode, suggested });
    if (d.allowed && d.scope !== 'once' && this.mode === 'normal') {
      this.allowlist.set(this.key(d.scope, d.scope === 'project' ? opts.projectKey || action : action), {
        key: d.scope === 'project' ? opts.projectKey || action : action,
        scope: d.scope === 'global' ? 'global' : 'project',
        decision: 'allow',
        createdAt: Date.now(),
      });
      await this.persist();
    }
    return this.record(action, d);
  }

  /** 工作区外文件写入 */
  async requestBoundaryWrite(targetPath: string, workspace: string): Promise<PermissionDecision> {
    const abs = path.resolve(targetPath);
    const root = path.resolve(workspace);
    const inside = abs === root || abs.startsWith(root + path.sep);
    if (inside) return { action: `write:${abs}`, scope: 'once', allowed: true };

    if (this.mode === 'full') {
      return this.record(`write:${abs}`, { action: `write:${abs}`, scope: 'once', allowed: true });
    }
    if (this.mode === 'strict') {
      if (!this.onApprove) return this.record(`write:${abs}`, { action: `write:${abs}`, scope: 'once', allowed: false });
      const d = await this.onApprove({ action: `write-outside:${abs}`, mode: this.mode, suggested: 'once' });
      return this.record(`write:${abs}`, d);
    }
    // normal：需授权
    if (!this.onApprove) {
      return this.record(`write:${abs}`, { action: `write:${abs}`, scope: 'once', allowed: false });
    }
    const d = await this.onApprove({ action: `write-outside:${abs}`, mode: this.mode, suggested: 'once' });
    return this.record(`write:${abs}`, d);
  }

  listAllowlist(): AllowlistEntry[] {
    return [...this.allowlist.values()];
  }

  revoke(scope: 'project' | 'global', key: string): boolean {
    const ok = this.allowlist.delete(this.key(scope, key));
    void this.persist();
    return ok;
  }

  getAuditLog() {
    return [...this.audit];
  }

  /** audit.jsonl 绝不上传（ADR） */
  async flushAudit(file: string): Promise<void> {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const lines = this.audit.map((a) => JSON.stringify(a)).join('\n') + '\n';
    await fs.promises.appendFile(file, lines, 'utf8');
    this.audit = [];
  }

  private record(action: string, d: PermissionDecision): PermissionDecision {
    this.audit.push({ ts: Date.now(), action, decision: d.allowed ? `allow:${d.scope}` : 'deny', mode: this.mode });
    return d;
  }

  private async persist() {
    await this.store.save({
      mode: this.mode,
      allowlist: [...this.allowlist.values()],
    });
  }
}

// ─────────────────────────────────────────────
// InstanceManager — spawn bundled Node × N
// ─────────────────────────────────────────────

export interface InstanceManagerOptions {
  /** 捆绑 Node 路径；缺省用 process.execPath（开发期） */
  nodePath?: string;
  /** 实例工作区根目录 */
  instancesRoot: string;
  /** 硬件建议最大实例数；默认按 CPU */
  maxInstances?: number;
  teardown: TeardownRegistry;
  security: SecurityManager;
  /** 启动时注入的环境变量（不含密钥明文到日志） */
  env?: Record<string, string>;
}

export interface SpawnInstanceOptions {
  config: InstanceConfig;
  /** 子进程入口脚本（dsh 或 stub） */
  entryScript?: string;
  /** 额外 argv */
  args?: string[];
}

/** 硬件建议：CPU 核数/2，夹在 1..8 */
export function suggestMaxInstances(cpuCount = os.cpus().length): number {
  return Math.max(1, Math.min(8, Math.floor(cpuCount / 2)));
}

export class InstanceManager extends EventEmitter {
  private instances = new Map<string, InstanceHandle & { child?: ChildProcess }>();

  constructor(private opts: InstanceManagerOptions) {
    super();
  }

  maxInstances(): number {
    return this.opts.maxInstances ?? suggestMaxInstances();
  }

  list(): InstanceHandle[] {
    return [...this.instances.values()].map(({ child: _c, ...h }) => h);
  }

  get(id: string): InstanceHandle | undefined {
    const h = this.instances.get(id);
    if (!h) return undefined;
    const { child: _c, ...rest } = h;
    return rest;
  }

  private get nodeBin(): string {
    return this.opts.nodePath || process.execPath;
  }

  async spawn(opts: SpawnInstanceOptions): Promise<InstanceHandle> {
    const { config } = opts;
    if (this.instances.has(config.id)) {
      throw new Error(`instance exists: ${config.id}`);
    }
    if (this.instances.size >= this.maxInstances()) {
      throw new Error(`max instances reached (${this.maxInstances()})`);
    }

    const ws = path.resolve(this.opts.instancesRoot, config.id);
    await fs.promises.mkdir(ws, { recursive: true });

    const entry = opts.entryScript || path.join(ws, 'agent.mjs');
    if (!fs.existsSync(entry)) {
      // 默认 stub：可被真实 dsh 入口替换
      await fs.promises.writeFile(
        entry,
        `process.send?.({ type: 'ready', pid: process.pid, name: ${JSON.stringify(config.name)} });\n` +
          `process.on('message', (m) => { if (m === 'ping') process.send({ type: 'pong' }); });\n` +
          `setInterval(() => {}, 1 << 30);\n`,
        'utf8'
      );
    }

    const handle: InstanceHandle & { child?: ChildProcess } = {
      id: config.id,
      name: config.name,
      status: 'starting',
      workspace: ws,
      dutyEligible: config.dutyEligible,
    };
    this.instances.set(config.id, handle);

    const child = spawn(this.nodeBin, [entry, ...(opts.args || [])], {
      cwd: ws,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      /**
       * windowsHide：Windows 上不加这一项，**每个实例都会多出一个控制台窗口**，
       * 而且杀掉进程后窗口仍然留在桌面上（用户实测："桌面上堆积很多无用的控制台窗口"）。
       * 我们的实例日志已经通过 stdio 管道回收，不需要可见的控制台。
       */
      windowsHide: true,
      env: {
        ...process.env,
        ...this.opts.env,
        WARMY_INSTANCE_ID: config.id,
        CCA_ARMY_INSTANCE_ID: config.id,
        WARMY_WORKSPACE: ws,
        CCA_ARMY_WORKSPACE: ws,
        // 密钥不写入实例 env 日志路径；由主进程经 safeStorage 注入
      },
    });

    handle.child = child;
    handle.pid = child.pid;
    handle.status = 'running';
    handle.startedAt = Date.now();

    this.opts.teardown.register(config.id, {
      label: `instance:${config.name}`,
      pid: child.pid || 0,
      child,
      tree: true,
    });

    child.on('exit', (code, signal) => {
      handle.status = code === 0 ? 'stopped' : 'dead';
      this.emit('exit', { id: config.id, code, signal });
      this.instances.delete(config.id);
    });
    child.stderr?.on('data', (d: Buffer) => {
      this.emit('stderr', { id: config.id, text: d.toString() });
    });

    this.emit('spawned', { id: config.id, pid: child.pid });
    const { child: _drop, ...publicHandle } = handle;
    return publicHandle;
  }

  async stop(id: string, timeoutMs = 5000): Promise<void> {
    const h = this.instances.get(id);
    if (!h) return;
    h.status = 'stopping';
    if (h.child && h.child.exitCode === null) {
      const exited = new Promise<void>((r) => h.child!.once('exit', () => r()));
      h.child.kill('SIGTERM');
      await Promise.race([exited, new Promise((r) => setTimeout(r, timeoutMs))]);
      if (h.child.exitCode === null && h.pid) {
        if (process.platform === 'win32') {
          await new Promise<void>((r) => {
            const p = spawn('taskkill', ['/PID', String(h.pid!), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
            p.once('exit', () => r());
            p.once('error', () => r());
          });
        } else {
          try {
            process.kill(h.pid, 'SIGKILL');
          } catch {
            /* noop */
          }
        }
      }
    }
    this.opts.teardown.unregister(id);
    h.status = 'stopped';
    this.instances.delete(id);
  }

  async stopAll(): Promise<void> {
    await this.opts.teardown.shutdownAll();
    this.instances.clear();
  }

  /** 硬件建议文案（UI 用） */
  hardwareAdvice(): { cpus: number; suggested: number; max: number } {
    const cpus = os.cpus().length;
    const suggested = suggestMaxInstances(cpus);
    return { cpus, suggested, max: this.maxInstances() };
  }
}

export async function createP1Runtime(opts?: {
  instancesRoot?: string;
  nodePath?: string;
  maxInstances?: number;
  env?: Record<string, string>;
  store?: SecurityStore;
  onApprove?: ApprovalHandler;
}) {
  const teardown = new TeardownRegistry();
  const security = new SecurityManager(opts?.store ?? new MemorySecurityStore(), opts?.onApprove);
  await security.init();
  const instances = new InstanceManager({
    instancesRoot: opts?.instancesRoot || path.join(os.tmpdir(), 'warmy-instances'),
    teardown,
    security,
    nodePath: opts?.nodePath,
    maxInstances: opts?.maxInstances,
    env: opts?.env,
  });
  return { teardown, security, instances };
}
