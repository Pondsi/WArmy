/**
 * 检查点 / 回退
 * CoW：优先 fs.copyFile 的 COPYFILE_FICLONE（APFS/BTRFS/XFS reflink）；
 * 失败则回退普通拷贝（Windows 上无 reflink 时行为等价 shadow）
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface JianChaDianXiangQing {
  tasks: string[];
  filesChanged: Array<{ path: string; ts: number }>;
  filesCreated: Array<{ path: string; ts: number }>;
  irreversible: string[];
  assets: string[];
}

export interface Checkpoint {
  id: string;
  phase: 'round_start' | 'round_end';
  logSeq: number;
  createdAt: number;
  dir: string;
  strategy: 'cow' | 'shadow';
  /** 人读摘要：几点几分、大致进行到哪一步 */
  summary: string;
  detail: JianChaDianXiangQing;
  bytes: number;
}

export interface JianChaDianKongJian {
  maxBytes: number;
  usedBytes: number;
  count: number;
}

const FICLONE = 2; // fs.constants.COPYFILE_FICLONE

function kaoBeiZhi(src: string, dest: string): 'cow' | 'shadow' {
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

function kaoBeiMuLu(src: string, dest: string): 'cow' | 'shadow' {
  let mode: 'cow' | 'shadow' = 'cow';
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) {
      if (kaoBeiMuLu(s, d) === 'shadow') mode = 'shadow';
    } else if (kaoBeiZhi(s, d) === 'shadow') mode = 'shadow';
  }
  return mode;
}

export class JianChaDianCang {
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
    maxBytes?: number;
    summary?: string;
    detail?: Partial<JianChaDianXiangQing>;
  }): Checkpoint {
    const id = `cp-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    const dir = path.join('shadows', id);
    const abs = path.join(this.root, dir);
    fs.mkdirSync(abs, { recursive: true });
    let strategy: 'cow' | 'shadow' = 'cow';
    if (opts.jsonlPath && fs.existsSync(opts.jsonlPath)) {
      if (kaoBeiZhi(opts.jsonlPath, path.join(abs, 'fast-memory.jsonl')) === 'shadow') strategy = 'shadow';
    }
    if (opts.workspace && fs.existsSync(opts.workspace)) {
      if (kaoBeiMuLu(opts.workspace, path.join(abs, 'workspace')) === 'shadow') strategy = 'shadow';
    }
    const bytes = muLuDaXiao(abs);
    const now = Date.now();
    // G. 真实文件时间戳
    const filesChanged: Array<{ path: string; ts: number }> = [];
    const filesCreated: Array<{ path: string; ts: number }> = [];
    if (opts.jsonlPath && fs.existsSync(opts.jsonlPath)) {
      try {
        const st = fs.statSync(opts.jsonlPath);
        filesChanged.push({ path: 'fast-memory.jsonl', ts: st.mtimeMs });
      } catch {
        filesChanged.push({ path: 'fast-memory.jsonl', ts: now });
      }
    }
    if (opts.workspace && fs.existsSync(opts.workspace)) {
      try {
        for (const e of fs.readdirSync(opts.workspace, { withFileTypes: true }).slice(0, 20)) {
          if (e.isFile()) {
            const fp = path.join(opts.workspace, e.name);
            let ts = now;
            try {
              ts = fs.statSync(fp).mtimeMs;
            } catch {
              /* noop */
            }
            filesCreated.push({ path: e.name, ts });
          }
        }
      } catch {
        /* noop */
      }
    }
    const cp: Checkpoint = {
      id,
      phase: opts.phase,
      logSeq: opts.logSeq,
      createdAt: now,
      dir,
      strategy,
      summary:
        opts.summary ||
        `${new Date(now).toLocaleTimeString()} · ${opts.phase === 'round_start' ? '轮起' : '轮末'}`,
      detail: {
        tasks: [],
        filesChanged,
        filesCreated,
        irreversible: [],
        assets: [],
        ...opts.detail,
      },
      bytes,
    };
    this.items.push(cp);
    const limit = opts.limit ?? 50;
    while (this.items.length > limit) {
      const old = this.items.shift();
      if (old) fs.rmSync(path.join(this.root, old.dir), { recursive: true, force: true });
    }
    // 容量：超出 maxBytes 删最早
    const maxBytes = opts.maxBytes ?? 512 * 1024 * 1024;
    while (this.space(maxBytes).usedBytes > maxBytes && this.items.length > 1) {
      const old = this.items.shift();
      if (old) fs.rmSync(path.join(this.root, old.dir), { recursive: true, force: true });
    }
    this.save();
    return cp;
  }

  space(maxBytes = 512 * 1024 * 1024): JianChaDianKongJian {
    const usedBytes = this.items.reduce((s, c) => s + (c.bytes || 0), 0);
    return { maxBytes, usedBytes, count: this.items.length };
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
        kaoBeiMuLu(src, targets.workspace);
      }
    }
    return true;
  }
}

function muLuDaXiao(dir: string): number {
  let n = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) n += muLuDaXiao(p);
      else n += fs.statSync(p).size;
    }
  } catch {
    /* ignore */
  }
  return n;
}
