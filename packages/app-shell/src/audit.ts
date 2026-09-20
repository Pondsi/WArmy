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
    try {
      fs.appendFileSync(this.file, JSON.stringify(entry) + '\n', 'utf8');
    } catch {
      /* ignore */
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
