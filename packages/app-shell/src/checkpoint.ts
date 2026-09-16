/**
 * 检查点 / 回退
 * CoW：优先 fs.copyFile 的 COPYFILE_FICLONE（APFS/BTRFS/XFS reflink）；
 * 失败则回退普通拷贝（Windows 上无 reflink 时行为等价 shadow）
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface Checkpoint {
  id: string;
  phase: 'round_start' | 'round_end';
  logSeq: number;
  createdAt: number;
  dir: string;
  strategy: 'cow' | 'shadow';
}

const FICLONE = 2; // fs.constants.COPYFILE_FICLONE

function cowCopy(src: string, dest: string): 'cow' | 'shadow' {
  try {
    fs.copyFileSync(src, dest, FICLONE);
    return 'cow';
  } catch {
    try {
      fs.copyFileSync(src, dest);
      return 'shadow';
    } catch {
      return 'shadow';
    }
  }
}

function cowCopyDir(src: string, dest: string): 'cow' | 'shadow' {
  let mode: 'cow' | 'shadow' = 'cow';
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) {
      if (cowCopyDir(s, d) === 'shadow') mode = 'shadow';
    } else if (cowCopy(s, d) === 'shadow') mode = 'shadow';
  }
  return mode;
}

export class CheckpointStore {
  private items: Checkpoint[] = [];

  constructor(private root: string) {
    fs.mkdirSync(path.join(root, 'shadows'), { recursive: true });
    this.load();
  }

  private get meta() {
    return path.join(this.root, 'checkpoints.json');
  }

  private load() {
    try {
      this.items = JSON.parse(fs.readFileSync(this.meta, 'utf8'));
    } catch {
      this.items = [];
    }
  }

  private save() {
    fs.writeFileSync(this.meta, JSON.stringify(this.items, null, 2));
  }

  create(opts: {
    phase: 'round_start' | 'round_end';
    logSeq: number;
    jsonlPath?: string;
    workspace?: string;
    limit?: number;
  }): Checkpoint {
    const id = `cp-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    const dir = path.join('shadows', id);
    const abs = path.join(this.root, dir);
    fs.mkdirSync(abs, { recursive: true });
    let strategy: 'cow' | 'shadow' = 'cow';
    if (opts.jsonlPath && fs.existsSync(opts.jsonlPath)) {
      if (cowCopy(opts.jsonlPath, path.join(abs, 'fast-memory.jsonl')) === 'shadow') strategy = 'shadow';
    }
    if (opts.workspace && fs.existsSync(opts.workspace)) {
      if (cowCopyDir(opts.workspace, path.join(abs, 'workspace')) === 'shadow') strategy = 'shadow';
    }
    const cp: Checkpoint = {
      id,
      phase: opts.phase,
      logSeq: opts.logSeq,
      createdAt: Date.now(),
      dir,
      strategy,
    };
    this.items.push(cp);
    const limit = opts.limit ?? 50;
    while (this.items.length > limit) {
      const old = this.items.shift();
      if (old) fs.rmSync(path.join(this.root, old.dir), { recursive: true, force: true });
    }
    this.save();
    return cp;
  }

  list(): Checkpoint[] {
    return [...this.items].reverse();
  }

  rollback(id: string, targets: { jsonlPath?: string; workspace?: string }): boolean {
    const cp = this.items.find((x) => x.id === id);
    if (!cp) return false;
    const abs = path.join(this.root, cp.dir);
    if (targets.jsonlPath) {
      const src = path.join(abs, 'fast-memory.jsonl');
      if (fs.existsSync(src)) fs.copyFileSync(src, targets.jsonlPath);
    }
    if (targets.workspace) {
      const src = path.join(abs, 'workspace');
      if (fs.existsSync(src)) {
        fs.rmSync(targets.workspace, { recursive: true, force: true });
        cowCopyDir(src, targets.workspace);
      }
    }
    return true;
  }
}
