/**
 * 审计日志：记录所有操作到 audit.jsonl，绝不上传
 */
import fs from 'node:fs';
import path from 'node:path';

export interface ShenJiTiaoMu {
  ts: number;
  op: string;
  detail?: unknown;
  user?: string;
}

export class ShenJiRiZhi {
  private file: string;
  private seq = 0;

  constructor(userData: string) {
    const dir = path.join(userData, 'audit');
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'audit.jsonl');
  }

  log(op: string, detail?: unknown, user?: string): void {
    const entry: ShenJiTiaoMu = { ts: Date.now(), op, detail, user };
    const yiHang = JSON.stringify(entry) + '\n';
    try {
      fs.appendFileSync(this.file, yiHang, 'utf8');
    } catch {
      /**
       * **自愈**（第 28 轮 项 6 取证时发现）：audit 目录被清掉后，构造器只在启动时 mkdir 一次，
       * 之后每条日志都静默失败 ⇒ 出问题时无日志可查。写失败就重建目录再试一次。
       */
      try {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        fs.appendFileSync(this.file, yiHang, 'utf8');
      } catch {
        /* 还是写不进（磁盘/权限）就放弃，绝不影响业务 */
      }
    }
  }

  read(limit = 100): ShenJiTiaoMu[] {
    try {
      if (!fs.existsSync(this.file)) return [];
      return fs
        .readFileSync(this.file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .slice(-limit)
        .map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  }

  clear(): void {
    try {
      fs.writeFileSync(this.file, '', 'utf8');
    } catch {
      /* ignore */
    }
  }
}
