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


/**
 * 归档时提炼：知识库实体/事件 + 使用者行为偏好（持久、跨会话）。
 * 产品原则：归档不只是 summary+anchors 存档，还要**进知识**与**进偏好**。
 */
export interface ArchiveExtraction {
  entities: Array<{ id: string; name: string; kind: string; attrs?: Record<string, string> }>;
  events: Array<{ id: string; title: string; result?: string }>;
  preferences: Array<{ key: string; value: string; source: string }>;
}

export function extractKnowledgeFromArchive(input: {
  groupId: string;
  title: string;
  summary: string;
}): ArchiveExtraction {
  const text = `${input.title}\n${input.summary}`.slice(0, 4000);
  const entities: ArchiveExtraction['entities'] = [];
  const events: ArchiveExtraction['events'] = [];
  const preferences: ArchiveExtraction['preferences'] = [];

  // 实体：标题本身作为会话/主题实体
  entities.push({
    id: `arc-topic-${input.groupId}-${Date.now()}`,
    name: input.title.slice(0, 80),
    kind: 'concept',
    attrs: { groupId: input.groupId },
  });

  // 从摘要里抓简单要点（中英文关键词）
  const prefPatterns: Array<[RegExp, string]> = [
    [/(?:用户|我)(?:偏好|希望|想要|倾向)[：: ]*(.{2,60})/g, 'preference.stated'],
    [/(?:always|prefer|user likes)\s+(.{3,60})/gi, 'preference.stated'],
    [/(?:端口|port)\s*[=:：]?\s*(\d{2,5})/gi, 'preference.port'],
    [/(?:语言|locale|language)\s*[=:：]?\s*([a-zA-Z-]{2,8})/gi, 'preference.language'],
  ];
  for (const [re, key] of prefPatterns) {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(text))) {
      const val = String(m[1] || '').trim();
      if (!val) continue;
      preferences.push({ key, value: val.slice(0, 120), source: `archive:${input.groupId}` });
      if (preferences.length >= 8) break;
    }
  }

  // 事件：归档标题 + 摘要首句
  const firstLine = input.summary.split(/\n|\r/).map((s) => s.trim()).filter(Boolean)[0] || input.title;
  events.push({
    id: `ev-arc-${Date.now()}`,
    title: input.title.slice(0, 100),
    result: firstLine.slice(0, 160),
  });

  return { entities, events, preferences };
}

/** 使用者偏好：userData/user-preferences.json（覆盖式 + 去重 key） */
export function mergeUserPreferences(
  userData: string,
  prefs: Array<{ key: string; value: string; source: string }>
): { ok: boolean; count: number; file: string } {
  const file = path.join(userData, 'user-preferences.json');
  try {
    fs.mkdirSync(userData, { recursive: true });
    let map: Record<string, { value: string; source: string; updatedAt: number }> = {};
    try {
      map = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
    } catch { map = {}; }
    let n = 0;
    for (const p of prefs) {
      const k = `${p.key}:${p.value}`.slice(0, 160);
      if (!map[k]) n += 1;
      map[k] = { value: p.value, source: p.source, updatedAt: Date.now() };
    }
    // 有界：最多 200 条偏好
    const keys = Object.keys(map).sort((a, b) => ((map[b] && map[b]!.updatedAt) || 0) - ((map[a] && map[a]!.updatedAt) || 0));
    const keep: typeof map = {};
    for (const k of keys.slice(0, 200)) {
      const v = map[k];
      if (v) keep[k] = v;
    }
    fs.writeFileSync(file, JSON.stringify(keep, null, 2), 'utf8');
    return { ok: true, count: n, file };
  } catch {
    return { ok: false, count: 0, file };
  }
}
