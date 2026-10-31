/**
 * 外部编辑边界（第 111 轮，第 114 轮改为显式会话）。
 *
 * 产品口径：
 *   · 应用管理的数据保持密文（运行期由 DataVault/SQLCipher/加密层负责）；
 *   · 用户要用 Office/IDE 打开项目文件时，**显式**导出一份“解密副本”给外部程序；
 *   · 必须先弹警告；确认后这份副本**完全开放**，直到用户点击“结束外部编辑”或退出应用；
 *   · 不根据文件“多久没变”猜测编辑是否完成（第 114 轮删除 2 秒启发式）；
 *   · 拒绝确认就不生成副本，原文件保持不动。
 *
 * 这里只做“副本 / 显式结束 / 清理”的生命周期；真正的加密与封存仍由 DataVault 管。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface WaiBuBianJiZhuangTai {
  id: string;
  original: string;
  temp: string;
  startedAt: number;
  lastChangeAt: number;
  state: 'open' | 'resealed' | 'discarded' | 'failed';
  error?: string;
}

interface Manifest {
  v: 1;
  id: string;
  original: string;
  tempDir: string;
  temp: string;
  startedAt: number;
  originalHash: string;
}

/** 分块哈希：大文件不整块进内存（同步 API 仍会占主线程，但内存近似有界） */
function sha256File(p: string): string {
  let fd: number | null = null;
  try {
    fd = fs.openSync(p, 'r');
    const h = crypto.createHash('sha256');
    const buf = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (!n) break;
      h.update(buf.subarray(0, n));
    }
    return h.digest('hex');
  } catch { return ''; } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* noop */ } }
  }
}

function anQuanZai(root: string, p: string): boolean {
  const a = path.resolve(root);
  const b = path.resolve(p);
  return b === a || b.startsWith(a + path.sep);
}

export class WaiBuBianJiGuanLiQi {
  private readonly root: string;
  private readonly manifestDir: string;
  private readonly log: (line: string) => void;
  private readonly audit: (op: string, detail: Record<string, unknown>) => void;
  private readonly onStatus: (s: WaiBuBianJiZhuangTai) => void;
  private readonly states = new Map<string, WaiBuBianJiZhuangTai>();

  constructor(opts: {
    workspaceRoot: string;
    manifestDir: string;
    log?: (line: string) => void;
    audit?: (op: string, detail: Record<string, unknown>) => void;
    onStatus?: (s: WaiBuBianJiZhuangTai) => void;
  }) {
    this.root = path.resolve(opts.workspaceRoot);
    this.manifestDir = opts.manifestDir;
    this.log = opts.log || (() => {});
    this.audit = opts.audit || (() => {});
    this.onStatus = opts.onStatus || (() => {});
    try { fs.mkdirSync(this.manifestDir, { recursive: true, mode: 0o700 }); } catch { /* noop */ }
  }

  list(): WaiBuBianJiZhuangTai[] { return [...this.states.values()]; }

  /**
   * 开始一次外部编辑：把应用管理的文件复制到临时目录，并交给系统默认程序打开。
   * 只允许应用工作区内的普通文件；路径越界一律拒绝。
   * 副本会一直保留到显式 `finish()` / `discard()` 或应用退出（`finishAll()`）。
   */
  start(absPath: string): { ok: boolean; temp?: string; warning?: string; id?: string; error?: string } {
    try {
      const p = path.resolve(String(absPath || ''));
      if (!anQuanZai(this.root, p)) return { ok: false, error: 'workspace-escape（只允许应用工作区内的文件）' };
      let st: fs.Stats;
      try { st = fs.statSync(p); } catch { return { ok: false, error: 'not-found' }; }
      if (!st.isFile()) return { ok: false, error: 'not-a-file' };
      const id = crypto.createHash('sha256').update(p).digest('hex').slice(0, 16);
      const old = this.states.get(id);
      if (old && old.state === 'open' && fs.existsSync(old.temp)) {
        return { ok: true, temp: old.temp, id, warning: '外部编辑已在进行中；本次直接返回同一份副本。改完后请点击「结束外部编辑」。' };
      }
      const tempDir = path.join(os.tmpdir(), `warmy-external-edit-${id}-${Date.now()}`);
      fs.mkdirSync(tempDir, { recursive: true });
      const temp = path.join(tempDir, path.basename(p));
      fs.copyFileSync(p, temp);
      const man: Manifest = { v: 1, id, original: p, tempDir, temp, startedAt: Date.now(), originalHash: sha256File(p) };
      fs.writeFileSync(path.join(this.manifestDir, id + '.json'), JSON.stringify(man, null, 2), { encoding: 'utf8', mode: 0o600 });
      const state: WaiBuBianJiZhuangTai = { id, original: p, temp, startedAt: man.startedAt, lastChangeAt: man.startedAt, state: 'open' };
      this.states.set(id, state);
      this.audit('workspace.external-edit-start', { original: p, temp, mode: 'explicit-session' });
      this.log(`external-edit start ${p} -> ${temp}`);
      this.onStatus(state);
      return {
        ok: true, temp, id,
        warning: '外部编辑器看到的是一份明文副本。确认后这份副本会一直保持开放，直到你点击「结束外部编辑」或退出应用；应用不会再猜测你是否改完。外部程序在副本存在期间当然能读它。',
      };
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message || e) };
    }
  }

  /** 显式结束：把副本内容写回原文件并删除副本；discard=true 则丢弃副本 */
  finish(id: string, discard = false): { ok: boolean; state?: WaiBuBianJiZhuangTai; error?: string } {
    const key = String(id || '');
    let man = this.readManifest(key);
    let state = this.states.get(key);
    if (!man && state) {
      man = {
        v: 1, id: key, original: state.original, tempDir: path.dirname(state.temp), temp: state.temp,
        startedAt: state.startedAt, originalHash: '',
      };
    }
    if (!man) return { ok: false, error: 'external-edit-not-found' };
    if (!state) state = { id: key, original: man.original, temp: man.temp, startedAt: man.startedAt, lastChangeAt: Date.now(), state: 'open' };
    this.states.set(key, state);
    return this.finishNow(key, man, state, !discard);
  }

  /**
   * 注销/退出前收口：所有还开着的外部编辑副本都写回，再让 DataVault 封存；
   * 否则退出后副本仍可能在外部程序里被保存，而应用已经封存了。
   */
  finishAll(): { attempted: number; failed: Array<{ id: string; error: string }> } {
    let attempted = 0;
    const failed: Array<{ id: string; error: string }> = [];
    let files: string[] = [];
    try { files = fs.readdirSync(this.manifestDir).filter((f) => /^[a-f0-9]{16}\.json$/i.test(f)); } catch { return { attempted, failed }; }
    for (const f of files) {
      try {
        const man = JSON.parse(fs.readFileSync(path.join(this.manifestDir, f), 'utf8')) as Manifest;
        if (!man?.id || !man.original || !man.temp || !man.tempDir) continue;
        const state: WaiBuBianJiZhuangTai = this.states.get(man.id) || {
          id: man.id, original: man.original, temp: man.temp, startedAt: man.startedAt, lastChangeAt: Date.now(), state: 'open',
        };
        this.states.set(man.id, state);
        const r = this.finishNow(man.id, man, state, true);
        attempted += 1;
        if (!r.ok) failed.push({ id: man.id, error: r.error || 'external-edit-failed' });
      } catch (e) {
        failed.push({ id: f.replace(/\.json$/i, ''), error: String((e as Error)?.message || e) });
      }
    }
    return { attempted, failed };
  }

  /**
   * 启动时恢复上次没结束的外部编辑：**不猜测是否改完**，只把状态列出来让用户显式结束。
   * 副本不存在就只清理清单；原文件保持不变。
   */
  recover(): number {
    let n = 0;
    let files: string[] = [];
    try { files = fs.readdirSync(this.manifestDir).filter((f) => /^[a-f0-9]{16}\.json$/i.test(f)); } catch { return 0; }
    for (const f of files) {
      try {
        const man = JSON.parse(fs.readFileSync(path.join(this.manifestDir, f), 'utf8')) as Manifest;
        if (!man?.id || !man.original || !man.temp || !man.tempDir || !fs.existsSync(man.temp)) {
          try { fs.rmSync(path.join(this.manifestDir, f), { force: true }); } catch { /* noop */ }
          continue;
        }
        const state: WaiBuBianJiZhuangTai = {
          id: man.id, original: man.original, temp: man.temp, startedAt: man.startedAt,
          lastChangeAt: Date.now(), state: 'open',
        };
        this.states.set(man.id, state);
        this.onStatus(state);
        n += 1;
      } catch { /* 坏清单不影响其它 */ }
    }
    return n;
  }

  private readManifest(id: string): Manifest | null {
    try {
      if (!/^[a-f0-9]{16}$/i.test(id)) return null;
      return JSON.parse(fs.readFileSync(path.join(this.manifestDir, id + '.json'), 'utf8')) as Manifest;
    } catch { return null; }
  }

  private finishNow(id: string, man: Manifest, state: WaiBuBianJiZhuangTai, writeBack: boolean): { ok: boolean; state?: WaiBuBianJiZhuangTai; error?: string } {
    try {
      if (writeBack) {
        if (!anQuanZai(this.root, man.original)) throw new Error('workspace-escape');
        if (fs.existsSync(man.temp)) {
          const nowHash = sha256File(man.temp);
          if (!nowHash) throw new Error('temp-unreadable');
          if (nowHash !== man.originalHash) {
            /** 冲突检测：外部编辑期间原文件也被别人改过 ⇒ 不覆盖，保留副本并如实失败 */
            const originalNow = sha256File(man.original);
            if (man.originalHash && originalNow !== man.originalHash) {
              throw new Error('conflict-original-changed（原文件在编辑期间已被修改，副本已保留）');
            }
            const size = fs.statSync(man.temp).size;
            const tmp = man.original + `.warmy-reseal-${process.pid}-${Date.now()}`;
            fs.copyFileSync(man.temp, tmp);
            try { fs.chmodSync(tmp, 0o600); } catch { /* noop */ }
            fs.renameSync(tmp, man.original);
            state.state = 'resealed';
            this.audit('workspace.external-edit-resealed', { original: man.original, bytes: size, changed: true, mode: 'explicit-session' });
            this.log(`external-edit resealed ${man.original} bytes=${size}`);
          } else {
            state.state = 'resealed';
            this.audit('workspace.external-edit-closed', { original: man.original, changed: false, mode: 'explicit-session' });
          }
        } else {
          state.state = 'failed';
          state.error = 'temp-missing';
          this.audit('workspace.external-edit-failed', { original: man.original, error: state.error });
        }
      } else {
        state.state = 'discarded';
        this.audit('workspace.external-edit-discarded', { original: man.original, mode: 'explicit-session' });
      }
    } catch (e) {
      state.state = 'failed';
      state.error = String((e as Error)?.message || e);
      this.audit('workspace.external-edit-failed', { original: man.original, error: state.error, keptCopy: true });
    } finally {
      /**
       * 只有**成功提交/明确丢弃**才清理副本与清单。
       * 失败（文件被占用/磁盘满/rename 失败/源文件并发变化）必须保留新副本，
       * 否则用户唯一的新编辑结果会被 finally 删掉。
       */
      if (state.state !== 'failed') {
        try { fs.rmSync(man.tempDir, { recursive: true, force: true }); } catch { /* noop */ }
        try { fs.rmSync(path.join(this.manifestDir, id + '.json'), { force: true }); } catch { /* noop */ }
      } else {
        this.log(`external-edit retained failed copy: ${man.temp} (${state.error})`);
      }
      state.lastChangeAt = Date.now();
      this.onStatus(state);
      if (state.state !== 'failed') setTimeout(() => { this.states.delete(id); }, 60_000).unref?.();
    }
    return state.state === 'failed'
      ? { ok: false, state, error: state.error || 'external-edit-failed' }
      : { ok: true, state };
  }
}
