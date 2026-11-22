/**
 * R292-4 会话重生（唯一 owner）：
 *  · 重生标记过滤 —— 记忆记录**原样保留**（记忆完整不变），但重建聊天窗口时
 *    跳过标记时刻之前的 kind:'message' 记录 ⇒ 最近聊天记录为空；
 *  · 工作区迁移 —— 旧工作区先重命名 → 建同名新文件夹 → 复制 → 逐文件核对（数量+字节）
 *    → 核对无误才删旧；任何一步失败回滚（新文件夹丢弃、旧文件夹改回原名），绝不丢文件。
 *
 * 纯模块：不碰 Electron/IPC，主进程装配；探针可直接对临时目录做行为测试。
 */
import fs from 'node:fs';
import path from 'node:path';

export type ChongShengBiao = { ts: number; ci: number };

/**
 * 这条记忆记录要不要跳过（不进聊天窗口）。
 * 没有标记 ⇒ 不跳；记录时间 < 标记时刻 ⇒ 跳（重生前的旧聊天）。
 * 记录缺 ts 按 0 算 ⇒ 有标记时一律跳（宁缺勿旧）。
 */
export function chongShengTiaoGuo(r: { ts?: unknown }, biao: ChongShengBiao | undefined): boolean {
  if (!biao) return false;
  return (Number(r.ts) || 0) < biao.ts;
}

/** 目录统计：文件数 + 总字节（lstat，不跟随符号链接；目录本身不计）。 */
export function tongJiMuLu(gen: string): { n: number; zi: number } {
  let n = 0, zi = 0;
  const zou = (lu: string): void => {
    let lie: fs.Dirent[];
    try { lie = fs.readdirSync(lu, { withFileTypes: true }); } catch { return; }
    for (const it of lie) {
      const quan = path.join(lu, it.name);
      if (it.isDirectory()) zou(quan);
      else {
        n += 1;
        try { zi += fs.lstatSync(quan).size; } catch { /* 读不到大小按 0，数量仍计入 */ }
      }
    }
  };
  zou(gen);
  return { n, zi };
}

/**
 * 工作区迁移（用户口径）：旧目录重命名 → 同名新目录 → 复制 → 核对 → 删旧。
 * 目录不存在 ⇒ 建一个空的新工作区。失败回滚并抛错（调用方据此中止重生）。
 * 名字保持不变 ⇒ 文件内引用（相对路径/配置里写的目录名）不受影响。
 */
export async function qianYiGongZuoQu(ws: string): Promise<{ qianYi: boolean }> {
  if (!fs.existsSync(ws)) {
    fs.mkdirSync(ws, { recursive: true });
    return { qianYi: false };
  }
  const jiu = ws + '.jiu-' + Date.now();
  fs.renameSync(ws, jiu);
  try {
    fs.mkdirSync(ws, { recursive: true });
    await fs.promises.cp(jiu, ws, { recursive: true, dereference: false });
    const a = tongJiMuLu(jiu), b = tongJiMuLu(ws);
    if (a.n !== b.n || a.zi !== b.zi) {
      throw new Error('workspace-verify-mismatch(' + a.n + '/' + a.zi + ' vs ' + b.n + '/' + b.zi + ')');
    }
    fs.rmSync(jiu, { recursive: true, force: true });
    return { qianYi: true };
  } catch (e) {
    /* 回滚：半截新目录丢掉，旧目录改回原名 —— 文件一份不丢 */
    try { fs.rmSync(ws, { recursive: true, force: true }); } catch { /* noop */ }
    try { fs.renameSync(jiu, ws); } catch { /* noop */ }
    throw e;
  }
}

/** 重生标记的持久化形状（userData/rebirth.json）。 */
export type ChongShengWenJian = { version: 1; sessions: Record<string, ChongShengBiao> };

export function jieXiChongShengWenJian(j: unknown): Map<string, ChongShengBiao> {
  const out = new Map<string, ChongShengBiao>();
  const sessions = (j as ChongShengWenJian | undefined)?.sessions;
  if (!sessions || typeof sessions !== 'object') return out;
  for (const [k, v] of Object.entries(sessions)) {
    if (!k || !v || typeof v !== 'object') continue;
    const ts = Number((v as ChongShengBiao).ts);
    if (!Number.isFinite(ts) || ts <= 0) continue;
    out.set(k, { ts, ci: Math.max(1, Number((v as ChongShengBiao).ci) || 1) });
  }
  return out;
}
