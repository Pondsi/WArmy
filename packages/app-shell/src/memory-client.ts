/**
 * 记忆服务长驻子进程客户端（主进程侧，零 .node）
 */
import { fork, type ChildProcess } from 'node:child_process';

export interface MemoryClientOptions {
  nodePath?: string;
  ipcEntry: string;
  dataDir: string;
}

export class MemoryClient {
  private child: ChildProcess | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();

  constructor(private opts: MemoryClientOptions) {}

  async start(): Promise<void> {
    if (this.child) return;
    const execPath = this.opts.nodePath || process.execPath;
    // 只有在拿 Electron 二进制兜底当 Node 时才需要这个开关；
    // 用真正的 node.exe 时设了也无害，但不设的话 electron 会当普通 GUI 启动并立刻崩。
    const useElectronAsNode = /electron(\.exe)?$/i.test(execPath);
    this.child = fork(this.opts.ipcEntry, [], {
      execPath,
      execArgv: [],
      env: {
        ...process.env,
        CCA_ARMY_MEMORY_DIR: this.opts.dataDir,
        ...(useElectronAsNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    this.child.on('message', (m: any) => {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error));
      else p.resolve(m);
    });
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('memory service start timeout')), 10_000);
      this.child!.once('message', (m: any) => {
        if (m?.type === 'ready') {
          clearTimeout(t);
          resolve();
        }
      });
      this.child!.once('error', (e) => {
        clearTimeout(t);
        reject(e);
      });
    });
  }

  private call(msg: Record<string, unknown>, timeoutMs = 8000): Promise<any> {
    if (!this.child) throw new Error('memory service not started');
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('memory ipc timeout'));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(t);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(t);
          reject(e);
        },
      });
      this.child!.send({ ...msg, id });
    });
  }

  append(record: { id: string; sessionId: string; kind: string; body: string }, writer = 'duty') {
    return this.call({ op: 'append', record, writer });
  }

  tail(limit = 20) {
    return this.call({ op: 'tail', limit });
  }

  recall(query: string, limit = 10) {
    return this.call({ op: 'recall', query, limit });
  }

  retrieve(anchor: { seq?: number; recordId?: string }) {
    return this.call({ op: 'retrieve', anchor });
  }

  async stop(): Promise<void> {
    if (!this.child) return;
    try {
      await this.call({ op: 'shutdown' }, 2000);
    } catch {
      this.child.kill();
    }
    this.child = null;
  }
}
