/**
 * 检查点 / 回退
 * CoW：优先 fs.copyFile 的 COPYFILE_FICLONE（APFS/BTRFS/XFS reflink）；
 * 失败则回退普通拷贝（Windows 上无 reflink 时行为等价 shadow）
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { JsonlSuo } from '@warmy/memory-os/lock';

export interface JianChaDianXiangQing {
  RenwuJi: string[];
  filesChanged: Array<{ path: string; ts: number }>;
  filesCreated: Array<{ path: string; ts: number }>;
  irreversible: string[];
  assets: string[];
}

export interface Jianchadian {
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
  private items: Jianchadian[] = [];

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
  }): Jianchadian {
    const id = `cp-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    const dir = path.join('shadows', id);
    const jueDuiLu = path.join(this.root, dir);
    fs.mkdirSync(jueDuiLu, { recursive: true });
    let strategy: 'cow' | 'shadow' = 'cow';
    if (opts.jsonlPath && fs.existsSync(opts.jsonlPath)) {
      if (kaoBeiZhi(opts.jsonlPath, path.join(jueDuiLu, 'fast-memory.jsonl')) === 'shadow') strategy = 'shadow';
    }
    if (opts.workspace && fs.existsSync(opts.workspace)) {
      if (kaoBeiMuLu(opts.workspace, path.join(jueDuiLu, 'workspace')) === 'shadow') strategy = 'shadow';
    }
    const bytes = muLuDaXiao(jueDuiLu);
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
    const cp: Jianchadian = {
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
        RenwuJi: [],
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

  LieBiao(): Jianchadian[] {
    return [...this.items].reverse();
  }

  /**
   * 回退到检查点。**唯一允许改写 `fast-memory.jsonl` 的路径**（不变量 #1 的显式例外）。
   * 可审计化（三件事，缺一不可）：
   *   1. 先把当前 JSONL 备份成 `fast-memory.jsonl.bak-<ts>`，被丢掉的历史可找回；
   *   2. 覆盖前/后在日志里追加一条 `kind:'rollback'` 标记（回退点 id / 时间 / 备份路径），
   *      让"改写"这件事本身也留在账上，而不是悄悄消失；
   *   3. 全程持 `JsonlSuo`（与记忆服务 append 共享同一 `.lock`），避免与写入交错。
   */
  rollback(id: string, targets: { jsonlPath?: string; workspace?: string }): boolean {
    const cp = this.items.find((x) => x.id === id);
    if (!cp) return false;
    const jueDuiLu = path.join(this.root, cp.dir);
    if (targets.jsonlPath) {
      const src = path.join(jueDuiLu, 'fast-memory.jsonl');
      if (fs.existsSync(src)) {
        const suo = new JsonlSuo(targets.jsonlPath);
        const naDao = suo.acquire(5000);
        try {
          let beiFenLu = '';
          if (fs.existsSync(targets.jsonlPath)) {
            beiFenLu = `${targets.jsonlPath}.bak-${Date.now().toString(36)}`;
            fs.copyFileSync(targets.jsonlPath, beiFenLu);
          }
          fs.copyFileSync(src, targets.jsonlPath);
          // 显式例外标记：写在回退**后**的账上，声明"历史被改写过、备份在哪"
          const biaoJi = {
            seq: 0,
            ts: Date.now(),
            sessionId: 'system',
            kind: 'rollback',
            id: `rollback-${Date.now().toString(36)}`,
            checkpointId: cp.id,
            reason: 'user-checkpoint-rollback',
            backupPath: beiFenLu || null,
            rolledBackAt: Date.now(),
          };
          try {
            fs.appendFileSync(targets.jsonlPath, JSON.stringify(biaoJi) + '\n', 'utf8');
          } catch {
            /* 标记写不进去也要把回退结果如实返回；备份仍在 */
          }
        } finally {
          if (naDao) suo.release();
        }
      }
    }
    if (targets.workspace) {
      const src = path.join(jueDuiLu, 'workspace');
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
