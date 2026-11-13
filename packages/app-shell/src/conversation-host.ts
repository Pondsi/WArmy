/**
 * conversation-host —— 对话进程级隔离的**主进程宿主/进程池**（R190 项5 P0）。
 *
 * 职责（对话进程级隔离强制规范）：
 *  · 每会话一个独立 PID 子进程（utilityProcess.fork / child_process.fork）；主进程只做网关。
 *  · **env 白名单**：绝不把 process.env 整包传下去（密钥明文不进子进程）。
 *  · **内存回收（防溢出）**：子进程心跳上报 RSS，超阈值即回收；空闲超时回收；池满 LRU 回收。
 *  · **崩溃隔离**：子进程死掉只影响该会话，宿主回收并按需重建，不波及其它会话。
 *  · **工具授权收口**：子进程 tool-request 一律回宿主 onTool 裁决（choke point 不下放）。
 *  · **收尾**：stopAll 协作退出 → SIGTERM → taskkill /T /F 兜底，不留孤儿。
 *
 * P0：真实进程池 + 回收 + 授权路由（门禁可脱机真跑）。P1：对话编排循环迁入子进程任务表。
 */
import { fork, spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

/** utilityProcess 与 child_process 都满足的最小接口（便于 Electron 注入 utilityProcess.fork）。 */
export interface ForkedChild {
  pid?: number;
  connected?: boolean;
  send(message: any): boolean;
  kill(signal?: string): boolean;
  on(event: string, listener: (...args: any[]) => void): this;
  once(event: string, listener: (...args: any[]) => void): this;
}
export type ForkFn = (entry: string, args: string[], opts: { cwd: string; env: Record<string, string>; stdio: any }) => ForkedChild;

export interface IsolationOptions {
  /** 子进程入口（dist/conversation-runner.js） */
  runnerPath: string;
  /** 会话工作区根目录 */
  instancesRoot: string;
  nodePath?: string;
  /** 并发子进程上限；默认按 CPU 夹在 8..16 */
  maxChildren?: number;
  /** 空闲多久回收（无活动且无在途任务），默认 5 分钟 */
  idleTimeoutMs?: number;
  /** 子进程 RSS 上限（MB），超过即回收防溢出，默认 512 */
  maxRssMb?: number;
  /** 回收巡检周期，默认 15s */
  sweepIntervalMs?: number;
  /** 单任务超时，默认 120s */
  runTimeoutMs?: number;
  /** 额外白名单 env（不得含密钥明文） */
  env?: Record<string, string>;
  /** 注入 fork（Electron 传 utilityProcess 适配器；缺省 child_process.fork） */
  forkFn?: ForkFn;
  /** R209 z1：异步 fork（VM 隧道需 async spawn）；优先于 forkFn。 */
  forkFnAsync?: (sessionId: string, o: { cwd: string; env: Record<string, string> }) => Promise<ForkedChild>;
  /** 工具授权执行器（宿主裁决；子进程不可跳过） */
  onTool?: (tool: string, args: any, sessionId: string) => Promise<any>;
  onEvent?: (e: { type: string; sessionId?: string; pid?: number; detail?: string }) => void;
  /** R208 y2：可选高级 VM 执行后端（opt-in；不给=进程级隔离，默认不可关闭）。 */
  vmExec?: (cmd: string, opts?: { timeoutMs?: number }) => Promise<{ ok: boolean; stdout: string; stderr: string }>;
}

interface Pending { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout>; }
interface ChildRec {
  sessionId: string;
  child: ForkedChild;
  pid: number;
  workspace: string;
  status: 'starting' | 'ready' | 'busy' | 'dead';
  lastActivity: number;
  rss: number;
  createdAt: number;
  pending: Map<string, Pending>;
  ready: Promise<void>;
}

/** 并发上限：一个逻辑 CPU 一个，夹在 8..16（低配也允许 8 只对话）。 */
export function jianYiZuiDaZiJinShu(cpuCount = os.cpus().length): number {
  return Math.max(8, Math.min(16, Math.floor(cpuCount)));
}

/**
 * R209 z1：把 VM stdio 隧道（ChildProcess）包装成 ForkedChild（JSON-line IPC）。
 * guest 内 Node 无 process.send ⇒  stdin/stdout 逐行 JSON 代替 IPC 通道。
 */
export function vmSuiDaoBaoZhuang(child: ChildProcess): ForkedChild {
  const ee = new EventEmitter();
  if (child.stdout) {
    const rl = createInterface({ input: child.stdout });
    rl.on('line', (line) => { try { ee.emit('message', JSON.parse(line)); } catch { /* 坏行忽略 */ } });
  }
  child.on('exit', (code, signal) => ee.emit('exit', code, signal));
  child.on('error', (e) => ee.emit('error', e));
  const bao: ForkedChild = {
    pid: child.pid,
    connected: true,
    send: (m: any) => { try { child.stdin?.write(JSON.stringify(m) + '\n'); return true; } catch { return false; } },
    kill: (sig?: string) => { try { return child.kill((sig || 'SIGTERM') as NodeJS.Signals); } catch { return false; } },
    on: (ev: string, fn: (...a: any[]) => void) => { ee.on(ev, fn); return bao; },
    once: (ev: string, fn: (...a: any[]) => void) => { ee.once(ev, fn); return bao; },
  };
  return bao;
}

/** env 白名单：只透传运行必需项，**密钥类一律不透传**。 */
export function baiMingDanEnv(extra?: Record<string, string>): Record<string, string> {
  const keep = ['PATH', 'Path', 'TEMP', 'TMP', 'SystemRoot', 'windir', 'HOME', 'USERPROFILE', 'LANG', 'LC_ALL', 'TZ'];
  const out: Record<string, string> = {};
  for (const k of keep) { const v = process.env[k]; if (typeof v === 'string') out[k] = v; }
  out.ELECTRON_RUN_AS_NODE = '1'; // 纯 Node，不开第二套 Electron
  if (extra) for (const [k, v] of Object.entries(extra)) {
    if (/SECRET|TOKEN|PASSWORD|API[_-]?KEY|CREDENTIAL/i.test(k)) continue; // 密钥绝不进子进程
    out[k] = String(v);
  }
  return out;
}

export class ConversationHost extends EventEmitter {
  private readonly children = new Map<string, ChildRec>();
  private readonly opts: Required<Pick<IsolationOptions, 'runnerPath' | 'instancesRoot'>> & IsolationOptions;
  private readonly maxChildren: number;
  private readonly idleTimeoutMs: number;
  private readonly maxRssMb: number;
  private readonly runTimeoutMs: number;
  private readonly forkFn: ForkFn;
  private sweeper: ReturnType<typeof setInterval> | null = null;
  private taskSeq = 0;
  private closed = false;

  constructor(opts: IsolationOptions) {
    super();
    this.opts = opts;
    this.maxChildren = opts.maxChildren ?? jianYiZuiDaZiJinShu();
    this.idleTimeoutMs = opts.idleTimeoutMs ?? 5 * 60_000;
    this.maxRssMb = opts.maxRssMb ?? 512;
    this.runTimeoutMs = opts.runTimeoutMs ?? 120_000;
    this.forkFn = opts.forkFn ?? ((entry, args, o) => fork(entry, args, { cwd: o.cwd, env: o.env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true } as any) as ChildProcess as unknown as ForkedChild);
    // 默认 error 监听：防止 EventEmitter 无监听者时抛错（通知主路走 onEvent）
    this.on('error', () => { /* noop */ });
  }

  private event(type: string, sessionId?: string, pid?: number, detail?: string): void {
    try { this.opts.onEvent?.({ type, sessionId, pid, detail }); } catch { /* noop */ }
    this.emit(type, { sessionId, pid, detail });
  }

  /** 启动回收巡检（空闲/RSS/池满）。幂等。 */
  start(): void {
    if (this.sweeper || this.closed) return;
    this.sweeper = setInterval(() => this.sweep(), this.opts.sweepIntervalMs ?? 15_000);
    this.sweeper.unref?.();
  }

  /** 巡检回收：空闲超时 / RSS 超限 / 死进程清理。 */
  sweep(): { idle: number; rss: number; dead: number } {
    const now = Date.now();
    let idle = 0, rss = 0, dead = 0;
    for (const rec of [...this.children.values()]) {
      if (rec.status === 'dead') { this.children.delete(rec.sessionId); dead++; continue; }
      const idleTooLong = rec.pending.size === 0 && rec.status !== 'busy' && now - rec.lastActivity > this.idleTimeoutMs;
      const rssTooHigh = rec.rss > this.maxRssMb * 1024 * 1024;
      if (idleTooLong || rssTooHigh) {
        void this.stop(rec.sessionId, rssTooHigh ? 'rss-limit' : 'idle-timeout');
        if (rssTooHigh) rss++; else idle++;
      }
    }
    return { idle, rss, dead };
  }

  /** 取或建某会话的子进程；池满则回收最久空闲的一个，无空闲可回收则如实报 pool-full。 */
  private async ensure(sessionId: string): Promise<ChildRec> {
    const cun = this.children.get(sessionId);
    if (cun && cun.status !== 'dead') return cun;
    if (this.children.size >= this.maxChildren) {
      // LRU 回收：挑最久没有活动且无在途任务的
      let lru: ChildRec | null = null;
      for (const r of this.children.values()) {
        if (r.pending.size > 0 || r.status === 'busy') continue;
        if (!lru || r.lastActivity < lru.lastActivity) lru = r;
      }
      if (lru) await this.stop(lru.sessionId, 'pool-lru');
      else throw new Error('pool-full');
    }
    const ws = path.resolve(this.opts.instancesRoot, sessionId);
    try { fs.mkdirSync(ws, { recursive: true }); } catch { /* 工作区建失败下面 fork 会如实报错 */ }
    const env = baiMingDanEnv({ ...this.opts.env, WARMY_SESSION_ID: sessionId, WARMY_WORKSPACE: ws });
    const child = this.opts.forkFnAsync
      ? await this.opts.forkFnAsync(sessionId, { cwd: ws, env })
      : this.forkFn(this.opts.runnerPath, [], { cwd: ws, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    const pid = Number(child.pid) || 0;
    let resolveReady!: () => void;
    const ready = new Promise<void>((r) => { resolveReady = r; });
    const rec: ChildRec = { sessionId, child, pid, workspace: ws, status: 'starting', lastActivity: Date.now(), rss: 0, createdAt: Date.now(), pending: new Map(), ready };
    this.children.set(sessionId, rec);

    child.on('message', (m: any) => this.onMessage(rec, m, resolveReady));
    child.on('exit', (code: any, signal: any) => {
      rec.status = 'dead';
      for (const p of rec.pending.values()) { clearTimeout(p.timer); p.reject(new Error('child-exited:' + String(code) + '/' + String(signal))); }
      rec.pending.clear();
      this.children.delete(sessionId);
      this.event('exit', sessionId, pid, String(code) + '/' + String(signal));
    });
    child.on('error', (err: any) => this.event('error', sessionId, pid, String(err?.message || err)));
    try { child.send({ type: 'init', sessionId, workspace: ws }); } catch { /* noop */ }
    this.event('spawned', sessionId, pid);
    // 就绪等待（带超时兜底，避免子进程起不来时永久挂起）
    await Promise.race([ready, new Promise<void>((r) => { const t = setTimeout(r, 8000); t.unref?.(); })]);
    return rec;
  }

  private onMessage(rec: ChildRec, m: any, resolveReady: () => void): void {
    if (!m || typeof m !== 'object') return;
    rec.lastActivity = Date.now();
    if (m.type === 'ready') { rec.status = 'ready'; resolveReady(); return; }
    if (m.type === 'heartbeat') { rec.rss = Number(m.rss) || 0; return; }
    if (m.type === 'result') {
      const p = rec.pending.get(String(m.taskId));
      if (p) { rec.pending.delete(String(m.taskId)); clearTimeout(p.timer); if (rec.pending.size === 0) rec.status = 'ready'; if (m.ok) p.resolve(m.value); else p.reject(new Error(String(m.error || 'task-failed'))); }
      return;
    }
    if (m.type === 'tool-request') {
      // 授权收口：子进程的工具请求一律由宿主裁决执行
      const id = String(m.id);
      void (async () => {
        try {
          if (!this.opts.onTool) throw new Error('no-tool-gateway');
          const value = await this.opts.onTool(String(m.tool), m.args, rec.sessionId);
          try { rec.child.send({ type: 'tool-result', id, ok: true, value }); } catch { /* noop */ }
        } catch (e) {
          try { rec.child.send({ type: 'tool-result', id, ok: false, error: String((e as Error)?.message || e) }); } catch { /* noop */ }
        }
      })();
      return;
    }
    if (m.type === 'log') { this.event('log', rec.sessionId, rec.pid, String(m.msg)); return; }
  }

  /** 在隔离子进程里跑一个任务（P1：kind='chat-turn' / 'chat-engine'）。timeoutMs 覆盖默认单任务超时。 */
  async run(sessionId: string, kind: string, payload?: any, timeoutMs?: number): Promise<any> {
    if (this.closed) throw new Error('host-closed');
    if (!sessionId) throw new Error('bad-session');
    const rec = await this.ensure(sessionId);
    const taskId = 'k' + (++this.taskSeq);
    rec.status = 'busy';
    rec.lastActivity = Date.now();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { rec.pending.delete(taskId); if (rec.pending.size === 0) rec.status = 'ready'; reject(new Error('run-timeout')); }, timeoutMs ?? this.runTimeoutMs);
      timer.unref?.();
      rec.pending.set(taskId, { resolve, reject, timer });
      try { rec.child.send({ type: 'run', taskId, kind, payload }); }
      catch (e) { clearTimeout(timer); rec.pending.delete(taskId); reject(e as Error); }
    });
  }

  /** 掐断某会话在途回合（停止按钮/看门狗）：子进程 abort 控制器 ⇒ 引擎与在途模型请求一起停。 */
  abort(sessionId: string): void {
    const rec = this.children.get(sessionId);
    if (!rec) return;
    try { rec.child.send({ type: 'abort' }); } catch { /* noop */ }
  }

  /** R208 y2：可选高级 VM 后端执行（opt-in）。没配 vmExec ⇒ 如实报 vm-unavailable（降级进程级）。 */
  async runVm(cmd: string, opts?: { timeoutMs?: number }): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    if (!this.opts.vmExec) throw new Error('vm-unavailable');
    return this.opts.vmExec(cmd, opts);
  }

  /** 回收一个会话子进程：协作 shutdown → SIGTERM → taskkill /T /F 兜底。 */
  async stop(sessionId: string, reason = 'manual', timeoutMs = 5000): Promise<void> {
    const rec = this.children.get(sessionId);
    if (!rec) return;
    this.children.delete(sessionId);
    rec.status = 'dead';
    for (const p of rec.pending.values()) { clearTimeout(p.timer); p.reject(new Error('recycled:' + reason)); }
    rec.pending.clear();
    const child = rec.child;
    const yiTui = new Promise<void>((r) => { try { child.once('exit', () => r()); } catch { r(); } });
    try { if (child.connected) child.send({ type: 'shutdown' }); } catch { /* noop */ }
    try { child.kill('SIGTERM'); } catch { /* noop */ }
    await Promise.race([yiTui, new Promise<void>((r) => { const t = setTimeout(r, timeoutMs); t.unref?.(); })]);
    // 仍存活 → 强杀进程树（Windows taskkill /T /F；其它 SIGKILL）
    if (rec.pid) {
      const alive = await new Promise<boolean>((r) => { try { process.kill(rec.pid, 0); r(true); } catch { r(false); } });
      if (alive) {
        if (process.platform === 'win32') {
          await new Promise<void>((r) => {
            try {
              const p = spawn('taskkill', ['/PID', String(rec.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
              p.once('exit', () => r()); p.once('error', () => r());
            } catch { r(); }
          });
        } else { try { process.kill(rec.pid, 'SIGKILL'); } catch { /* noop */ } }
      }
    }
    this.event('recycled', sessionId, rec.pid, reason);
  }

  /** 收尾：回收全部子进程（应用退出时调）。 */
  async stopAll(): Promise<void> {
    this.closed = true;
    if (this.sweeper) { clearInterval(this.sweeper); this.sweeper = null; }
    await Promise.all([...this.children.keys()].map((id) => this.stop(id, 'shutdown-all')));
    this.children.clear();
  }

  /** 只读快照（UI/门禁用）。 */
  snapshot(): Array<{ sessionId: string; pid: number; status: string; rssMb: number; idleMs: number; pending: number }> {
    const now = Date.now();
    return [...this.children.values()].map((r) => ({ sessionId: r.sessionId, pid: r.pid, status: r.status, rssMb: Math.round(r.rss / 1048576), idleMs: now - r.lastActivity, pending: r.pending.size }));
  }

  get size(): number { return this.children.size; }
}