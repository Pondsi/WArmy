/**
 * r50-run3.mjs —— 用户口径【这里1】的三连驱动器
 * 压力档 A（小游戏 6 轮）与 B（记忆 1000 轮×2M）各连续 3 遍；
 * 任一遍红 ⇒ 停下修，修完从第 1 遍重来。
 * 纪律（§18.4①）：子进程 stdout/stderr 必须接进日志，不许只记 exit code。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LOGDIR = path.join(ROOT, '.r50-logs');
fs.mkdirSync(LOGDIR, { recursive: true });

const KEY_FILE = process.env.MIMO_KEY_FILE || '';
if (!KEY_FILE || !fs.existsSync(KEY_FILE)) {
  console.log('缺 MIMO_KEY_FILE');
  process.exit(2);
}

const NODE = process.env.MIMO_NODE || process.execPath;
const phase = String(process.argv[2] || 'mem'); // mem | game | all
const times = Number(process.argv[3] || 3);

function run(cmd, args, logName, env = {}) {
  return new Promise((resolve) => {
    const logPath = path.join(LOGDIR, logName);
    /** 每遍独立截断写入，避免上一遍的 FAIL 混进这一遍读数（仪器纪律） */
    const out = fs.createWriteStream(logPath, { flags: 'w' });
    out.write(`\n===== ${new Date().toISOString()} ${cmd} ${args.join(' ')} =====\n`);
    const child = spawn(cmd, args, {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.pipe(out);
    child.stderr.pipe(out);
    let code = 1;
    child.on('exit', (c) => { code = c ?? 1; });
    /** pipe(out) 的 end:true 会先关掉目标流，之后再 out.write() 会被静默丢弃（实测读数见 §27.5）⇒ 等 close 再用 append 落结论行 */
    child.on('close', () => {
      out.end();
      fs.appendFileSync(logPath, `\n----- exit=${code} -----\n`, 'utf8');
      resolve(code);
    });
    child.on('error', (e) => {
      fs.appendFileSync(logPath, `\n----- spawn error ${e} -----\n`, 'utf8');
      out.end();
      resolve(1);
    });
  });
}

/**
 * 日志追加要**容忍 Windows 的共享占用**：三连自己崩过一次 EBUSY（另一路会话/编辑器同时持有同一份 `*-3x.log`）。
 * 结论行丢不起 —— 重试几次；实在写不进去就明确喊一声（stdout 还在，别让人把"没有结论"读成"进程消失"）。
 */
function appendWithRetry(file, text, tries = 8) {
  for (let i = 0; i < tries; i++) {
    try { fs.appendFileSync(file, text, 'utf8'); return true; } catch (e) {
      const code = String((e && e.code) || '');
      if (!/EBUSY|EPERM|EACCES|EAGAIN/.test(code)) throw e;
      const until = Date.now() + 40;
      while (Date.now() < until) { /* 短自旋：串行真机不差这几十毫秒 */ }
    }
  }
  console.log('[warn] 日志被占用（EBUSY），这一行只留在 stdout：' + file);
  return false;
}

function say(tag, line) {
  console.log(line);
  /** 驱动器 stdout 可能被启动方重定向掉；结论行必须同时落进 ${tag}-3x.log 才不会被旁观者读成"进程消失且没有结论" */
  appendWithRetry(path.join(LOGDIR, `${tag}-3x.log`), `${line}\n`);
}

/**
 * **产物指纹**（第 52 轮 2 次实测代价：一遍真机跑到一半，另一路会话重建了 dist ⇒ 同一遍里混两份构建，
 * 18:39:38 那次正好落在 round16 的窗口里、19:54:50 那次落在三连第 1 遍的窗口里）。
 * 原来"看 src 目录 mtime"的证法绑的是源码，可以在不碰构建的情况下改 src ⇒ 一律改绑**门禁真正启动的那份产物**。
 */
function chanWuZhiWen() {
  return ['dist/electron-main.js', 'dist/renderer/app.js'].map((rel) => {
    const p = path.join(ROOT, 'packages', 'app-shell', ...rel.split('/'));
    try {
      const st = fs.statSync(p);
      const sha = createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 12);
      return `${rel} ${new Date(st.mtimeMs).toISOString().slice(11, 19)}#${sha}`;
    } catch { return `${rel} #读不到`; }
  }).join(' | ');
}

/**
 * **坑位闸**：两串真机门禁并行 = 共用同一条真实桌面 ⇒ 两边读数全废（本轮 19:42:23/19:42:39 就撞过一次）。
 * 只数**带调试端口的调试壳**：用户自己开着应用不算占坑（第 44 轮口径，否则等不到 0 会把"没跑"读成"跑过了"）。
 * 要连续两次采到 0 才算空出 —— 腿与腿之间的缝隙会短暂归零。
 */
function kengWei() {
  try {
    const ps = 'Get-CimInstance Win32_Process -Filter "name=\'electron.exe\'" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress';
    const raw = String(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', timeout: 60000 }) || '');
    /** 一台 electron 都没有时 ConvertTo-Json 给的是**空串**，`JSON.parse('')` 会抛 ⇒ 空串就是真的 0；
     *  解析不了才当"未知"（返回 -1，宁可等也不并发）。反方向（把忙碌读成空）会起两支真机门禁，两边读数全废。 */
    if (!raw.trim()) return 0;
    const j = JSON.parse(raw);
    const arr = Array.isArray(j) ? j : [j];
    return arr.filter((p) => /electron-main\.js/.test(String(p.CommandLine || '')) && /remote-debugging-port/.test(String(p.CommandLine || ''))).length;
  } catch { return -1; }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function dengKong(tag, dengMaxMs = 900000) {
  const kaiShi = Date.now();
  let shang = -1;
  for (;;) {
    const n = kengWei();
    /** 连续两次采样（间隔 ≥20 秒）都为 0 才算场地空出：腿与腿之间的缝隙会短暂归零 */
    if (n === 0 && shang === 0) return true;
    shang = n;
    if (Date.now() - kaiShi > dengMaxMs) return false;
    say(tag, `[WAIT] ${tag} 第 遍前坑位被占（带调试端口的调试壳 ${n} 个），已等 ${Math.round((Date.now() - kaiShi) / 1000)}s ⇒ 绝不并发起第二支真机门禁`);
    await sleep(20000);
  }
}

async function memOnce(i) {
  say('mem', `[mem] 第 ${i}/${times} 遍开始 ${new Date().toISOString()}`);
  const code = await run(NODE, [
    '--max-old-space-size=12288',
    'dev/gates/verify-memory-stress.mjs',
    '--rounds', '1000',
    '--turnChars', '2000000',
    '--runs', '1',
    '--ollamaTail', '40',
    '--stateDir', `.memory-stress-r50-run${i}`,
  ], `mem-run${i}.log`, { MIMO_KEY_FILE: KEY_FILE });
  say('mem', `[mem] 第 ${i}/${times} 遍 exit=${code}`);
  return code;
}

async function gameOnce(i) {
  say('game', `[game] 第 ${i}/${times} 遍开始 ${new Date().toISOString()}`);
  const code = await run(NODE, [
    'dev/gates/verify-r46-youxi.mjs',
  ], `game-run${i}.log`, {
    MIMO_KEY_FILE: KEY_FILE,
    OLLAMA_MODEL: process.env.OLLAMA_MODEL || 'orcarouter/Qwen3.8-27B-Uncensored:q4_K_M-128K',
    KEEP: '1',
  });
  say('game', `[game] 第 ${i}/${times} 遍 exit=${code}`);
  return code;
}

async function loop(fn, tag) {
  /** 记忆档不启动 Electron（verify-memory-stress.mjs 里没有 electron）⇒ 只有真机档才需要坑位闸与产物指纹 */
  const zhenJi = tag === 'game';
  for (let i = 1; i <= times; i++) {
    if (zhenJi && !(await dengKong(tag))) {
      say(tag, `[STOP] ${tag} 第 ${i} 遍**没起跑**：等坑位超过 15 分钟仍被别的真机门禁占着 ⇒ 不硬跑（空跑判绿比判红危险）`);
      process.exit(2);
    }
    const zhiWenKai = zhenJi ? chanWuZhiWen() : '';
    if (zhenJi) say(tag, `[产物] ${tag} 第 ${i}/${times} 遍开跑前指纹：${zhiWenKai}`);
    const code = await fn(i);
    if (zhenJi) {
      const zhiWenShou = chanWuZhiWen();
      if (zhiWenShou !== zhiWenKai) {
        say(tag, `[VOID] ${tag} 第 ${i} 遍作废：遍内产物被重建（开跑 ${zhiWenKai} → 收工 ${zhiWenShou}）⇒ 新产物上从第 1 遍重跑`);
        process.exit(1);
      }
    }
    if (code !== 0) {
      say(tag, `[STOP] ${tag} 第 ${i} 遍失败（exit=${code}），按口径停下，不继续后面的遍。日志：${LOGDIR}`);
      fs.writeFileSync(path.join(LOGDIR, `${tag}-FAIL.txt`),
        `fail at run ${i} exit=${code}\n${new Date().toISOString()}\n`, 'utf8');
      process.exit(1);
    }
    say(tag, `[OK] ${tag} 第 ${i}/${times} 遍全绿${zhenJi ? `（产物 ${zhiWenKai}）` : ''}`);
  }
  say(tag, `[DONE] ${tag} ${times}/${times} 全绿`);
}

if (phase === 'mem' || phase === 'all') await loop(memOnce, 'mem');
if (phase === 'game' || phase === 'all') await loop(gameOnce, 'game');
console.log('三连驱动器收工');
