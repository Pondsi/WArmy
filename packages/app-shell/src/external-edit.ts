/**
 * 外部编辑边界（第 111 轮）。
 *
 * 产品口径：
 *   · 应用管理的数据保持密文（运行期由 DataVault/SQLCipher 负责，退出/注销封存）；
 *   · 用户要用 Office/IDE 打开项目文件时，**显式**导出一份“解密副本”给外部程序；
 *   · 必须弹警告、记审计；编辑结束后**自动把内容封存回应用**并删除副本；
 *   · 不承诺外部工具被沙箱——外部程序在副本存在期间当然能读它。
 *
 * 这里只做“副本 / 回写 / 清理”的生命周期；真正的加密与封存仍由 DataVault 管。
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
  state: 'open' | 'resealed' | 'failed';
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

function sha256File(p: string): string {
  try { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); } catch { return ''; }
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
  private readonly timers = new Map<string, NodeJS.Timeout>();
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
        return { ok: true, temp: old.temp, id, warning: '外部编辑已在进行中；本次直接返回同一份副本。' };
      }
      const tempDir = path.join(os.tmpdir(), `warmy-external-edit-${id}-${Date.now()}`);
      fs.mkdirSync(tempDir, { recursive: true });
      const temp = path.join(tempDir, path.basename(p));
      fs.copyFileSync(p, temp);
      const man: Manifest = { v: 1, id, original: p, tempDir, temp, startedAt: Date.now(), originalHash: sha256File(p) };
      fs.writeFileSync(path.join(this.manifestDir, id + '.json'), JSON.stringify(man, null, 2), { encoding: 'utf8', mode: 0o600 });
      const state: WaiBuBianJiZhuangTai = { id, original: p, temp, startedAt: man.startedAt, lastChangeAt: man.startedAt, state: 'open' };
      this.states.set(id, state);
      this.audit('workspace.external-edit-start', { original: p, temp, warning: 'external-tools-see-plaintext-copy' });
      this.log(`external-edit start ${p} -> ${temp}`);
      this.watch(id, man, state);
      this.onStatus(state);
      return {
        ok: true, temp, id,
        warning: '外部编辑器看到的是一份明文副本；编辑结束后会自动封存回应用并删除副本。请不要把副本留在公共目录，也不要承诺外部工具被沙箱。',
      };
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message || e) };
    }
  }

  private watch(id: string, man: Manifest, state: WaiBuBianJiZhuangTai): void {
    let lastHash = sha256File(man.temp);
    let stable = 0;
    const t = setInterval(() => {
      try {
        if (!fs.existsSync(man.temp)) { this.finish(id, man, state, false); return; }
        const h = sha256File(man.temp);
        if (h !== lastHash) {
          lastHash = h;
          stable = 0;
          state.lastChangeAt = Date.now();
          return;
        }
        stable += 1;
        /** 连续 2 秒内容不再变化 ⇒ 认为外部编辑器已经保存完，回写并清理 */
        if (stable >= 2 && h !== man.originalHash) this.finish(id, man, state, true);
        else if (stable >= 6 && h === man.originalHash) this.finish(id, man, state, false);
      } catch (e) {
        state.error = String((e as Error)?.message || e);
      }
    }, 1000);
    t.unref?.();
    this.timers.set(id, t);
  }

  private finish(id: string, man: Manifest, state: WaiBuBianJiZhuangTai, writeBack: boolean): void {
    const t = this.timers.get(id);
    if (t) { clearInterval(t); this.timers.delete(id); }
    try {
      if (writeBack) {
        if (!anQuanZai(this.root, man.original)) throw new Error('workspace-escape');
        const buf = fs.readFileSync(man.temp);
        const tmp = man.original + `.warmy-reseal-${process.pid}-${Date.now()}`;
        fs.writeFileSync(tmp, buf, { mode: 0o600 });
        fs.renameSync(tmp, man.original);
        state.state = 'resealed';
        this.audit('workspace.external-edit-resealed', { original: man.original, bytes: buf.length, changed: true });
        this.log(`external-edit resealed ${man.original} bytes=${buf.length}`);
      } else {
        state.state = 'resealed';
        this.audit('workspace.external-edit-closed', { original: man.original, changed: false });
      }
    } catch (e) {
      state.state = 'failed';
      state.error = String((e as Error)?.message || e);
      this.audit('workspace.external-edit-failed', { original: man.original, error: state.error });
    } finally {
      try { fs.rmSync(man.tempDir, { recursive: true, force: true }); } catch { /* noop */ }
      try { fs.rmSync(path.join(this.manifestDir, id + '.json'), { force: true }); } catch { /* noop */ }
      this.onStatus(state);
      /** 状态保留一小会儿供界面读取，然后从内存清掉 */
      setTimeout(() => { this.states.delete(id); }, 60_000).unref?.();
    }
  }

  /**
   * 注销/退出前收口：所有还开着的外部编辑副本都先回写，再让 DataVault 封存；
   * 否则退出后 watcher 仍可能把明文写回已经封存的工作区。
   */
  finishAll(): number {
    let n = 0;
    let files: string[] = [];
    try { files = fs.readdirSync(this.manifestDir).filter((f) => /^[a-f0-9]{16}\.json$/i.test(f)); } catch { return 0; }
    for (const f of files) {
      try {
        const man = JSON.parse(fs.readFileSync(path.join(this.manifestDir, f), 'utf8')) as Manifest;
        if (!man?.id || !man.original || !man.temp || !man.tempDir) continue;
        const state: WaiBuBianJiZhuangTai = this.states.get(man.id) || {
          id: man.id, original: man.original, temp: man.temp, startedAt: man.startedAt, lastChangeAt: Date.now(), state: 'open',
        };
        this.states.set(man.id, state);
        this.finish(man.id, man, state, true);
        n += 1;
      } catch { /* 坏清单跳过 */ }
    }
    return n;
  }

  /** 启动时恢复上次没回写完的外部编辑（应用退出时副本还在） */
  recover(): number {
    let n = 0;
    let files: string[] = [];
    try { files = fs.readdirSync(this.manifestDir).filter((f) => /^[a-f0-9]{16}\.json$/i.test(f)); } catch { return 0; }
    for (const f of files) {
      try {
        const man = JSON.parse(fs.readFileSync(path.join(this.manifestDir, f), 'utf8')) as Manifest;
        if (!man?.id || !man.original || !man.temp || !man.tempDir) { fs.rmSync(path.join(this.manifestDir, f), { force: true }); continue; }
        const state: WaiBuBianJiZhuangTai = { id: man.id, original: man.original, temp: man.temp, startedAt: man.startedAt, lastChangeAt: Date.now(), state: 'open' };
        this.states.set(man.id, state);
        if (fs.existsSync(man.temp) && sha256File(man.temp) !== man.originalHash) {
          this.finish(man.id, man, state, true);
        } else {
          this.finish(man.id, man, state, false);
        }
        n += 1;
      } catch { /* 坏清单不影响其它 */ }
    }
    return n;
  }
}
