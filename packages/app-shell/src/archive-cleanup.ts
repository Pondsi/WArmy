/**
 * KnowledgeArchiver：外部群归档流水线
 * 将外部群会话归档到知识库，保留证据锚点
 */
import fs from 'node:fs';
import path from 'node:path';

export interface ArchiveEntry {
  id: string;
  groupId: string;
  title: string;
  summary: string;
  ts: number;
  anchors: Array<{ file: string; seq: number }>;
}

export class KnowledgeArchiver {
  private file: string;

  constructor(userData: string) {
    const dir = path.join(userData, 'archive');
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'archives.jsonl');
  }

  archive(entry: Omit<ArchiveEntry, 'ts'>): ArchiveEntry {
    const full: ArchiveEntry = { ...entry, ts: Date.now() };
    fs.appendFileSync(this.file, JSON.stringify(full) + '\n', 'utf8');
    return full;
  }

  list(groupId?: string): ArchiveEntry[] {
    try {
      if (!fs.existsSync(this.file)) return [];
      return fs
        .readFileSync(this.file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
        .filter((e) => !groupId || e.groupId === groupId);
    } catch {
      return [];
    }
  }
}

/**
 * CleanupManager：手动清理机制
 */
export class CleanupManager {
  constructor(private userData: string) {}

  /** 清理旧检查点（保留最近 N 个） */
  cleanCheckpoints(keep = 20): number {
    const dir = path.join(this.userData, 'checkpoints');
    const meta = path.join(dir, 'checkpoints.json');
    try {
      const items = JSON.parse(fs.readFileSync(meta, 'utf8'));
      if (items.length <= keep) return 0;
      const removed = items.splice(0, items.length - keep);
      for (const r of removed) {
        fs.rmSync(path.join(dir, r.dir), { recursive: true, force: true });
      }
      fs.writeFileSync(meta, JSON.stringify(items, null, 2));
      return removed.length;
    } catch {
      return 0;
    }
  }

  /** 清理审计日志 */
  cleanAudit(): void {
    const f = path.join(this.userData, 'audit', 'audit.jsonl');
    try {
      fs.writeFileSync(f, '', 'utf8');
    } catch {
      /* noop */
    }
  }

  /** 清理语音文件 */
  cleanVoice(olderThanMs = 7 * 24 * 3600_000): number {
    const dir = path.join(this.userData, 'voice');
    let n = 0;
    try {
      for (const f of fs.readdirSync(dir)) {
        const fp = path.join(dir, f);
        const st = fs.statSync(fp);
        if (Date.now() - st.mtimeMs > olderThanMs) {
          fs.rmSync(fp, { force: true });
          n++;
        }
      }
    } catch {
      /* noop */
    }
    return n;
  }
}
