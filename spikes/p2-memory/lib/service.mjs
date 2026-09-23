/**
 * 测试脚手架：
 * - 把 packages/memory-os/dist 拷到 ASCII 临时目录（中文路径 fork 有编码坑）
 * - node_modules 用 junction 指回本仓库真实的依赖
 * - fork 子进程 + 请求/应答 IPC（验证"跨进程重启仍可检索"）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const P2_DIR = path.dirname(__dirname);
export const REPO_ROOT = path.resolve(__dirname, '../../..');
export const MEM_PKG = path.join(REPO_ROOT, 'packages', 'memory-os');
export const MODEL_DIR = path.join(REPO_ROOT, 'spikes', 'spike-07-onnx', 'models');

export function tmpDir(tag) {
  const d = path.join(os.tmpdir(), `warmy-p2-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/** 复制 dist 到 ASCII 目录 + junction node_modules（子进程用） */
export function makeAsciiRuntime(tag = 'runtime') {
  const root = path.join(os.tmpdir(), `warmy-p2-${tag}`);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  fs.copyFileSync(path.join(MEM_PKG, 'package.json'), path.join(root, 'package.json'));
  for (const f of fs.readdirSync(path.join(MEM_PKG, 'dist'))) {
    if (f.endsWith('.js')) fs.copyFileSync(path.join(MEM_PKG, 'dist', f), path.join(root, 'dist', f));
  }
  const real = path.join(MEM_PKG, 'node_modules');
  if (fs.existsSync(real)) {
    fs.symlinkSync(real, path.join(root, 'node_modules'), 'junction');
  }
  return { root, entry: path.join(root, 'dist', 'ipc.js') };
}

/** 启动长驻记忆子进程（不透明 IPC） */
export function startChild(dataDir, opts = {}) {
  const entry = opts.entry ?? makeAsciiRuntime().entry;
  const child = fork(entry, [], {
    execArgv: [],
    cwd: opts.cwd ?? os.tmpdir(),
    env: {
      ...process.env,
      CCA_ARMY_MEMORY_DIR: dataDir,
      ...(opts.env ?? {}),
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let seq = 0;
  let readyResolve;
  let readyReject;
  const ready = new Promise((res, rej) => {
    readyResolve = res;
    readyReject = rej;
  });
  const pending = new Map();
  const stderr = [];
  child.stderr?.on('data', (d) => stderr.push(String(d)));
  child.on('message', (m) => {
    if (m?.type === 'ready') {
      readyResolve(m);
      return;
    }
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.error) p.reject(Object.assign(new Error(m.error), { code: m.code }));
    else p.resolve(m);
  });
  child.on('exit', (c) => readyReject?.(new Error('child exit ' + c + ' :: ' + stderr.join('').slice(0, 400))));
  const call = (xiaoXi, timeoutMs = 120000) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`ipc timeout: ${JSON.stringify(xiaoXi).slice(0, 120)}`));
      }, timeoutMs);
      pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      child.send({ ...xiaoXi, id });
    });
  const stop = async () => {
    try {
      await call({ op: 'shutdown' }, 10000);
    } catch {
      /* noop */
    }
    await new Promise((r) => setTimeout(r, 150));
  };
  return { child, ready, call, stop, stderr };
}

export function percentile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

export function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
