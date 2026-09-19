/**
 * 写操作 read-back：save 之后**必须从存储读回**再宣布成功。
 * 不重复实现存储；只在 IPC 出口统一包装。
 */
export interface ReadBackResult<T> {
  ok: boolean;
  saved?: boolean;
  readBack?: T;
  match?: boolean;
  error?: string;
  /** 对人可读：是否允许说“已保存” */
  confident: boolean;
}

export async function withReadBack<T>(
  save: () => unknown | Promise<unknown>,
  read: () => T | Promise<T>,
  equals: (a: unknown, b: T) => boolean
): Promise<ReadBackResult<T>> {
  try {
    const saved = await save();
    const readBack = await read();
    const match = equals(saved, readBack);
    return {
      ok: true,
      saved: true,
      readBack,
      match,
      confident: !!match,
      ...(match ? {} : { error: 'read-back-mismatch' }),
    };
  } catch (e) {
    return { ok: false, saved: false, confident: false, error: String((e as Error)?.message || e) };
  }
}

/**
 * 自动化/列表类写入的去重：按 normalize 后的 key。
 * 用途：skillScanDirs、类似的“最多 N 条目录/账号/源”配置，避免重复点击堆积。
 */
export function dedupeByNorm<T>(items: T[], keyOf: (x: T) => string): { list: T[]; removed: number } {
  const seen = new Set<string>();
  const list: T[] = [];
  let removed = 0;
  for (const it of items) {
    const k = keyOf(it);
    if (!k) continue;
    if (seen.has(k)) {
      removed += 1;
      continue;
    }
    seen.add(k);
    list.push(it);
  }
  return { list, removed };
}

export function normPathKey(p: unknown): string {
  return String(p || '').trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}
