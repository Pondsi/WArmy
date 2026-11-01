/**
 * 并行跑 8 种语言的正文翻译（每种语言独立进程，互不写同一文件）。
 *
 * 为什么单独做启动器：前台/会话子进程在会话结束时会被回收，翻译会半途停掉。
 * 这里用 detached + unref，进程脱离当前 shell；PID 写到系统临时目录，便于查/停。
 *
 * 用法：
 *   MIMO_KEY_FILE=<密钥文件> node dev/i18n/run-content-parallel.mjs
 *   node dev/i18n/run-content-parallel.mjs --langs=ja,ko --batch=3 --concurrency=2
 *   node dev/i18n/run-content-parallel.mjs --force   # 忽略 PID 文件（确认旧进程已停）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, 'translate-personas.mjs');
const arg = (k, d = '') => (process.argv.find((x) => x.startsWith('--' + k + '=')) || '').split('=')[1] || d;
const LANGS = String(arg('langs', 'zh-TW,ja,ko,fr,es,pt,ru,eo')).split(',').map((x) => x.trim()).filter(Boolean);
const BATCH = String(arg('batch', '3'));
const CONC = String(arg('concurrency', '2'));
const PID = path.join(os.tmpdir(), 'warmy-i18n-content-pids.json');

const huo = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
if (!process.argv.includes('--force') && fs.existsSync(PID)) {
  try {
    const j = JSON.parse(fs.readFileSync(PID, 'utf8'));
    const live = Object.entries(j).filter(([, p]) => huo(Number(p)));
    if (live.length) {
      console.log('已有翻译进程在跑：' + live.map(([k, p]) => `${k}=${p}`).join(' ') + '；确认要重启用 --force');
      process.exit(0);
    }
  } catch { /* 坏 PID 文件按没有处理 */ }
}
if (!process.env.MIMO_KEY_FILE) {
  console.log('缺少 MIMO_KEY_FILE（密钥只从环境变量读，不打印、不落盘）');
  process.exit(1);
}

const pids = {};
for (const l of LANGS) {
  const log = path.join(os.tmpdir(), `warmy-i18n-content-${l}.log`);
  const out = fs.openSync(log, 'a');
  const c = spawn(process.execPath, [SCRIPT, '--lang=' + l, '--field=content', '--batch=' + BATCH, '--concurrency=' + CONC], {
    detached: true,
    windowsHide: true,
    stdio: ['ignore', out, out],
    env: process.env,
  });
  c.unref();
  pids[l] = c.pid;
  console.log(`${l} pid=${c.pid} log=${log}`);
}
fs.writeFileSync(PID, JSON.stringify(pids, null, 2), 'utf8');
console.log('PID 文件：' + PID);
