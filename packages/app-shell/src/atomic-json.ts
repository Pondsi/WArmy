/**
 * 原子 JSON 文件读写（主进程本地存储通用件）
 *
 * 与项目内其它存储（settings.json / board / knowledge）一致：都是 userData 下的
 * JSON 文本；这里额外保证写入是「先写临时文件再 rename」的原子替换，
 * 避免进程中途退出留下半截文件。
 *
 * 所有函数都不抛异常给渲染进程：读失败返回兜底值，写失败返回 { ok:false, error }。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** 读取并解析 JSON；文件缺失 / 空 / 非法 JSON 时返回 fallback，绝不抛出 */
export function readJsonFile<T>(file: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.trim()) return fallback;
    const parsed = JSON.parse(raw) as T;
    if (parsed === null || typeof parsed !== 'object') return fallback;
    return parsed;
  } catch {
    return fallback;
  }
}

/**
 * 读取 JSON；解析失败时把损坏文件改名隔离（file.corrupt-<ts>），
 * 便于排查而不是静默丢掉用户数据。
 */
export function readJsonFileQuarantine<T>(file: string, fallback: T): T {
  let raw = '';
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return fallback; // 不存在 / 无权限
  }
  try {
    if (!raw.trim()) return fallback;
    const parsed = JSON.parse(raw) as T;
    if (parsed === null || typeof parsed !== 'object') return fallback;
    return parsed;
  } catch {
    quarantine(file);
    return fallback;
  }
}

/** 把损坏文件改名为 *.corrupt-<timestamp>（失败即忽略） */
export function quarantine(file: string): void {
  try {
    if (!fs.existsSync(file)) return;
    fs.renameSync(file, `${file}.corrupt-${Date.now()}`);
  } catch {
    /* 忽略：隔离失败不影响主流程 */
  }
}

/** 原子写 JSON：同目录临时文件 + rename，失败抛异常（调用方决定是否吞掉） */
export function writeJsonAtomic(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}-${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* 忽略 */
    }
    throw e;
  }
}

/** 原子写 JSON 的安全版本：把失败收敛成 { ok:false, error }，不抛 */
export function writeJsonAtomicSafe(file: string, data: unknown): { ok: boolean; error?: string } {
  try {
    writeJsonAtomic(file, data);
    return { ok: true };
  } catch (e) {
    // 只回错误类型，不带完整路径/堆栈（渲染进程不应看到内部路径）
    return { ok: false, error: e instanceof Error ? e.name : 'write failed' };
  }
}

/** 清掉本次进程残留的 .tmp 文件（启动时调用一次，防止极端退出后堆积） */
export function sweepTempFiles(dir: string, keepMs = 24 * 3600_000): void {
  try {
    if (!fs.existsSync(dir)) return;
    const now = Date.now();
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.tmp')) continue;
      const p = path.join(dir, f);
      try {
        const st = fs.statSync(p);
        if (now - st.mtimeMs > keepMs) fs.rmSync(p, { force: true });
      } catch {
        /* 忽略单个文件 */
      }
    }
  } catch {
    /* 忽略 */
  }
}
