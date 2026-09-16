/**
 * SWMR JSONL 锁：PID + 心跳，确保单写多读
 */
import fs from 'node:fs';
import path from 'node:path';

export class JsonlLock {
  private lockFile: string;
  private pid: number;
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(jsonlPath: string) {
    this.lockFile = jsonlPath + '.lock';
    this.pid = process.pid;
  }

  acquire(timeoutMs = 5000): boolean {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        fs.writeFileSync(this.lockFile, String(this.pid), { flag: 'wx' });
        this.heartbeat = setInterval(() => {
          try {
            fs.writeFileSync(this.lockFile, String(this.pid));
          } catch {
            /* noop */
          }
        }, 1000);
        return true;
      } catch {
        // 检查持有者是否存活
        try {
          const holder = parseInt(fs.readFileSync(this.lockFile, 'utf8'), 10);
          process.kill(holder, 0); // 抛异常表示进程不存在
        } catch {
          // 持有者已死，清理后重试
          try {
            fs.rmSync(this.lockFile, { force: true });
          } catch {
            /* noop */
          }
        }
        // 等待后重试
        const wait = 50 + Math.random() * 50;
        const end = Date.now() + wait;
        while (Date.now() < end) {
          /* busy wait */
        }
      }
    }
    return false;
  }

  release(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    try {
      const holder = fs.readFileSync(this.lockFile, 'utf8');
      if (parseInt(holder, 10) === this.pid) {
        fs.rmSync(this.lockFile, { force: true });
      }
    } catch {
      /* noop */
    }
  }

  isLocked(): boolean {
    return fs.existsSync(this.lockFile);
  }
}
