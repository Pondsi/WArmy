/**
 * 项目 MEMORY — **唯一事实源挂在 GroupRecord.project.memory（Markdown）**。
 *
 * 设计原则（避免与 memory-os 重复）：
 * - memory-os = 会话/工具**流水**（JSONL 唯一事实 + FTS/向量召回）
 * - 项目 MEMORY = **当前有效**的项目规矩/目标（覆盖式，不是流水）
 * - **不**再写一份 MEMORY.md 文件、**不**把全文重复 append 进 memory-os
 *   （注入时从 group-store 读；检索历史用 recall，不是读 MEMORY 副本）
 * - 注入有界：超过 PROJECT_MEMORY_INJECT_CHARS 截断并标注
 */
import type { GroupStore } from './group-store.js';

export const PROJECT_MEMORY_INJECT_CHARS = 1200;
export const PROJECT_MEMORY_MAX_CHARS = 8000;

export interface ProjectMemoryView {
  ok: true;
  groupId: string;
  memory: string;
  chars: number;
  truncated: boolean;
  updatedAt: number | null;
}

export function readProjectMemory(groupStore: GroupStore | null, groupId: string): string {
  try {
    const p = groupStore?.projectOf?.(groupId) || (groupStore as any)?.projectOf?.(groupId);
    const mem = p && typeof p.memory === 'string' ? p.memory : '';
    return mem.slice(0, PROJECT_MEMORY_MAX_CHARS);
  } catch {
    return '';
  }
}

/** 值班注入用：有界截断；空则返回空串（不编造） */
export function projectMemoryForContext(groupStore: GroupStore | null, groupId: string): string {
  const raw = readProjectMemory(groupStore, groupId).trim();
  if (!raw) return '';
  if (raw.length <= PROJECT_MEMORY_INJECT_CHARS) {
    return `[项目记忆]\n${raw}`;
  }
  return `[项目记忆·截断 ${raw.length}>${PROJECT_MEMORY_INJECT_CHARS}]\n${raw.slice(0, PROJECT_MEMORY_INJECT_CHARS)}…`;
}

export function writeProjectMemory(
  groupStore: GroupStore | null,
  groupId: string,
  memory: string
): { ok: boolean; chars: number; error?: string; memory?: string } {
  if (!groupStore) return { ok: false, chars: 0, error: 'group-store-missing' };
  const text = String(memory || '').slice(0, PROJECT_MEMORY_MAX_CHARS);
  try {
    const r = (groupStore as any).setProjectMemory?.(groupId, text);
    if (r && r.ok === false) return { ok: false, chars: text.length, error: r.error || 'save-failed' };
    return { ok: true, chars: text.length, memory: text };
  } catch (e) {
    return { ok: false, chars: text.length, error: String((e as Error)?.message || e) };
  }
}
