/**
 * 构建并重启 WArmy 桌面应用。
 * 重要：改完源码后必须重启 Electron 进程，否则界面不会更新（历史上多次踩坑）。
 *
 *   node scripts/dev-restart.mjs
 */
import {execFileSync, spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(here, '..');
const electronExe = path.join(pkgRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const mainJs = path.join(pkgRoot, 'dist', 'electron-main.js');

function log(xiaoXi) {
  process.stdout.write(`[dev-restart] ${xiaoXi}\n`);
}

// 1. 杀掉在跑的 WArmy Electron 进程（按命令行匹配，避免误伤其它 electron 应用）
function killRunning() {
  const ps = `
$procs = Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
  Where-Object { $_.CommandLine -match 'WArmy|app-shell' }
$n = ($procs | Measure-Object).Count
$procs | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Write-Output $n
`;
  let killed = '0';
  try {
    killed = execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }).trim();
  } catch {
    /* 没有进程时也会走到这里，忽略 */
  }
  log(`killed ${killed} running process(es)`);
}

// 2. 构建
function build() {
  log('building...');
  const nodeDir = 'C:\\Program Files\\nodejs';
  const env = { ...process.env };
  if (existsSync(nodeDir)) env.Path = `${nodeDir};${env.Path ?? ''}`;
  execFileSync('corepack', ['pnpm', '--filter', '@warmy/app-shell', 'build'], {
    cwd: path.join(pkgRoot, '..', '..'),
    stdio: 'inherit',
    env,
    shell: true,
  });
  log('build ok');
}

// 3. 启动
function launch() {
  if (!existsSync(electronExe)) throw new Error(`electron not found: ${electronExe}`);
  if (!existsSync(mainJs)) throw new Error(`main not built: ${mainJs}`);
  const child = spawn(electronExe, [mainJs], { cwd: pkgRoot, detached: true, stdio: 'ignore' });
  child.unref();
  log(`launched pid=${child.pid}`);
}

killRunning();
build();
launch();
log('done — 界面已加载最新代码');
