/**
 * Session V3 迁移：旧会话首次打开时自动迁移并保留原文件
 */
import fs from 'node:fs';
import path from 'node:path';

export interface SessionV2Record {
  seq?: number;
  ts?: number;
  sessionId?: string;
  kind?: string;
  id?: string;
  [k: string]: unknown;
}

export interface SessionV3Record extends SessionV2Record {
  v: 3;
}

/** 检测是否需要迁移 */
export function xuyaoQianyi(sessionDir: string): boolean {
  const marker = path.join(sessionDir, '.format-v3');
  return !fs.existsSync(marker);
}

/** 执行 V2→V3 迁移，保留原文件 */
export function migrateSessionV2ToV3(sessionDir: string): { migrated: boolean; count: number } {
  if (!xuyaoQianyi(sessionDir)) return { migrated: false, count: 0 };

  const jsonl = path.join(sessionDir, 'fast-memory.jsonl');
  if (!fs.existsSync(jsonl)) {
    fs.writeFileSync(path.join(sessionDir, '.format-v3'), Date.now().toString());
    return { migrated: false, count: 0 };
  }

  // 备份原文件
  const backup = jsonl + '.v2.bak';
  if (!fs.existsSync(backup)) {
    fs.copyFileSync(jsonl, backup);
  }

  const lines = fs.readFileSync(jsonl, 'utf8').split('\n').filter(Boolean);
  const out: string[] = [];
  let count = 0;
  for (const line of lines) {
    try {
      const rec = JSON.parse(line) as SessionV2Record;
      const v3: SessionV3Record = { ...rec, v: 3 };
      out.push(JSON.stringify(v3));
      count++;
    } catch {
      out.push(line);
    }
  }

  fs.writeFileSync(jsonl, out.join('\n') + '\n', 'utf8');
  fs.writeFileSync(path.join(sessionDir, '.format-v3'), Date.now().toString());
  return { migrated: true, count };
}
