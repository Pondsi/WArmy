/**
 * 检查点 / 回退（简化实现：对话 JSONL 快照 + 工作区文件快照目录）
 * CoW 优先在有 reflink 时由上层增强；此处提供可移植 shadow 目录方案
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface Checkpoint {
  id: string;
  phase: 'round_start' | 'round_end';
  logSeq: number;
  createdAt: number;
  /** shadow 目录相对路径 */
  dir: string;
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

  /** 创建检查点：复制 jsonl 与 workspace 快照 */
  create(opts: { phase: 'round_start' | 'round_end'; logSeq: number; jsonlPath?: string; workspace?: string; limit?: number }): Checkpoint {
    const id = `cp-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    const dir = path.join('shadows', id);
    const abs = path.join(this.root, dir);
    fs.mkdirSync(abs, { recursive: true });
    if (opts.jsonlPath && fs.existsSync(opts.jsonlPath)) {
      fs.copyFileSync(opts.jsonlPath, path.join(abs, 'fast-memory.jsonl'));
    }
    if (opts.workspace && fs.existsSync(opts.workspace)) {
      copyDirLite(opts.workspace, path.join(abs, 'workspace'));
    }
    const cp: Checkpoint = {
      id,
      phase: opts.phase,
      logSeq: opts.logSeq,
      createdAt: Date.now(),
      dir,
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

  /** 回退：还原 jsonl 与 workspace */
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
        copyDirLite(src, targets.workspace);
      }
    }
    return true;
  }
}

function copyDirLite(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDirLite(s, d);
    else fs.copyFileSync(s, d);
  }
}
