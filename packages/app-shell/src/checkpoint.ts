/**
 * 检查点 / 回退
 * CoW：优先 fs.copyFile 的 COPYFILE_FICLONE（APFS/BTRFS/XFS reflink）；
 * 失败则回退普通拷贝（Windows 上无 reflink 时行为等价 shadow）
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { JsonlSuo } from '@warmy/memory-os/lock';
import type { JianchadianZengliang } from '@warmy/contracts';

export interface JianChaDianXiangQing {
  RenwuJi: string[];
  filesChanged: Array<{ path: string; ts: number }>;
  filesCreated: Array<{ path: string; ts: number }>;
  irreversible: string[];
  assets: string[];
}

/**
 * 检查点 = 契约「状态差分」（id / phase / logSeq / strategy / dir / sessionId）+ 本模块的展示与统计字段。
 * 契约 v1.1 就是按这里的真实形状定稿的（v1.0 写的 checkpointId / shadow-git 从没实现过）。
 */
export interface Jianchadian extends JianchadianZengliang {
  createdAt: number;
  /** 人读摘要：几点几分、大致进行到哪一步 */
  summary: string;
  /** R246：自进化合并前的回退点标记（渲染右侧自进化图标） */
  evolve?: boolean;
  /** R263：进化回退点携带的实验快照（回滚时恢复到选支前） */
  evolveSnap?: unknown;
  detail: JianChaDianXiangQing;
  bytes: number;
}

export interface JianChaDianKongJian {
  maxBytes: number;
  usedBytes: number;
  count: number;
}

const FICLONE = 2; // fs.constants.COPYFILE_FICLONE

/** R264 项5：Windows 占用类错误（EPERM/EBUSY/EACCES）短重试；同步上下文用 Atomics.wait 小睡，上限几百毫秒 */
function chongShi<T>(fn: () => T, ci = 3, jianGeMs = 120): T {
  let last: unknown;
  for (let i = 0; i <= ci; i++) {
    try { return fn(); } catch (e) {
      last = e;
      const m = String((e as Error)?.message || e);
      if (!/EPERM|EBUSY|EACCES|resource busy or locked/i.test(m) || i === ci) throw e;
      try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, jianGeMs); } catch { /* noop */ }
    }
  }
  throw last;
}

function kaoBeiZhi(src: string, dest: string): 'cow' | 'shadow' {
  try {
    fs.copyFileSync(src, dest, FICLONE);
    return 'cow';
  } catch {
    try {
      chongShi(() => fs.copyFileSync(src, dest));
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
  /** R264 项5：最近一次回滚因占用跳过的条目（如实上报，不假装全恢复） */
  lastSkipped: string[] = [];

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
    phase: 'round_start' | 'round_end' | 'evolve_select';
    logSeq: number;
    jsonlPath?: string;
    workspace?: string;
    limit?: number;
    maxBytes?: number;
    summary?: string;
    /** R246：标记为自进化合并前回退点 */
    evolve?: boolean;
    detail?: Partial<JianChaDianXiangQing>;
    /** 会话级回滚标记（见 Jianchadian.sessionId） */
    sessionId?: string;
    /** R263：进化实验快照（选支前状态） */
    evolveSnap?: unknown;
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
        `${new Date(now).toISOString()} · ${opts.phase === 'round_start' ? '轮起' : '轮末'}`,
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
    if (opts.sessionId) cp.sessionId = String(opts.sessionId);
    if (opts.evolve) cp.evolve = true;
    if (opts.evolveSnap) cp.evolveSnap = opts.evolveSnap;
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
    this.lastSkipped = [];
    const jueDuiLu = path.join(this.root, cp.dir);
    if (targets.jsonlPath) {
      const src = path.join(jueDuiLu, 'fast-memory.jsonl');
      if (fs.existsSync(src)) {
        const jl = targets.jsonlPath;
        const suo = new JsonlSuo(jl);
        const naDao = suo.acquire(5000);
        try {
          let beiFenLu = '';
          if (fs.existsSync(jl)) {
            beiFenLu = `${jl}.bak-${Date.now().toString(36)}`;
            chongShi(() => fs.copyFileSync(jl, beiFenLu));
          }
          chongShi(() => fs.copyFileSync(src, jl));
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
            fs.appendFileSync(jl, JSON.stringify(biaoJi) + '\n', 'utf8');
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
        /* R264 项5：绝不整删工作区根目录 —— Windows 上它常是会话子进程的 cwd，整删必 EPERM。
         * 改为「保根目录・清内容・覆盖还原」：占用短重试，仍失败则跳过并如实记录。 */
        try { fs.mkdirSync(targets.workspace, { recursive: true }); } catch { /* noop */ }
        for (const e of fs.readdirSync(targets.workspace, { withFileTypes: true })) {
          const p = path.join(targets.workspace, e.name);
          try { jieChuZhiDu(p); chongShi(() => fs.rmSync(p, { recursive: true, force: true })); } catch { this.lastSkipped.push(e.name); }
        }
        for (const e of fs.readdirSync(src, { withFileTypes: true })) {
          const s = path.join(src, e.name); const d = path.join(targets.workspace, e.name);
          try {
            if (e.isDirectory()) kaoBeiMuLu(s, d);
            else { jieChuZhiDu(d); chongShi(() => fs.copyFileSync(s, d)); }
          } catch { this.lastSkipped.push(e.name); }
        }
      }
    }
    return true;
  }
}

/** R264 项5：只读目标先解除只读（Windows 上删/覆只读文件＝EPERM 的另一来源），best-effort */
function jieChuZhiDu(p: string): void {
  try {
    const st = fs.statSync(p);
    if ((st.mode & 0o222) === 0) fs.chmodSync(p, st.isDirectory() ? 0o777 : 0o666);
  } catch { /* noop */ }
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
