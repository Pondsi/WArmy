/**
 * 第 20 轮 · 任务4 真机验证：右键「复制」是否真的把**文件本体**放进剪贴板。
 *
 * 用真实 electron 二进制跑主进程的同一段逻辑（ESM + 顶部 import 的 clipboard/execFile），
 * 然后用系统 API `Get-Clipboard -Format FileDropList` 读回：
 * 读回的是**文件**（不是一段路径文本）才算过。
 *
 * 跑法：& $env:MIMO_NODE verify-round20-clip.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const GEN = path.dirname(fileURLToPath(import.meta.url));
let guo = 0; let bai = 0;
const shuo = (ok, ming, xiang = '') => {
  if (ok) { guo++; console.log(`  [过] ${ming}`); }
  else { bai++; console.log(`  [败] ${ming}${xiang ? ' :: ' + xiang : ''}`); }
};

if (process.platform !== 'win32') {
  console.log('  [跳过] 只在 Windows 上验证（Set-Clipboard / FileDropList 是 Windows 路径）');
  process.exit(0);
}

const electron = path.join(GEN, 'packages/app-shell/node_modules/electron/dist/electron.exe');
if (!fs.existsSync(electron)) {
  console.log('  [败] 找不到 electron 二进制');
  process.exit(1);
}

const gen = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-clip-'));
const muBiao = path.join(gen, '复制测试-中文名.txt');
fs.writeFileSync(muBiao, '文件本体', 'utf8');

/**
 * 与 electron-main.ts `warmy:copyFileToClipboard` **同一套写法**：
 * ESM、顶部 import、不出现 require。若有人又改回 require，这里会直接复现原事故。
 */
/**
 * 目标路径经**数据文件**传给子进程，不内联进源码 ——
 * 内联要同时躲过 JS 字符串转义、Windows 反斜杠、PowerShell 引号三层，极易写错。
 */
fs.writeFileSync(path.join(gen, 'target.json'), JSON.stringify({ abs: muBiao }), 'utf8');
const ceShi = path.join(gen, 'clip-main.mjs');
fs.writeFileSync(ceShi, [
  "import { app, clipboard } from 'electron';",
  "import { execFile } from 'node:child_process';",
  "import fs from 'node:fs';",
  "import path from 'node:path';",
  "import { fileURLToPath } from 'node:url';",
  "const here = path.dirname(fileURLToPath(import.meta.url));",
  "const abs = JSON.parse(fs.readFileSync(path.join(here, 'target.json'), 'utf8')).abs;",
  "app.whenReady().then(async () => {",
  "  let mode = 'none'; let err = '';",
  "  try {",
  "    const ps = (process.env.windir || 'C:\\\\Windows') + '\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe';",
  "    const arg = \"Set-Clipboard -LiteralPath '\" + abs.replace(/'/g, \"''\") + \"'\";",
  "    await new Promise((res, rej) => {",
  "      execFile(ps, ['-NoProfile', '-Command', arg], { windowsHide: true, timeout: 8000 },",
  "        (e) => (e ? rej(e) : res()));",
  "    });",
  "    mode = 'file';",
  "  } catch (e) {",
  "    err = String((e && e.message) || e);",
  "    try { clipboard.writeBuffer('FileNameW', Buffer.from(abs + '\\0', 'ucs2')); mode = 'file-buffer'; }",
  "    catch (e2) { err += ' | ' + String((e2 && e2.message) || e2); clipboard.writeText(abs); mode = 'text'; }",
  "  }",
  "  process.stdout.write('MODE=' + mode + '\\nERR=' + err + '\\n');",
  "  app.quit();",
  "});",
].join('\n'), 'utf8');
fs.writeFileSync(path.join(gen, 'package.json'), JSON.stringify({ name: 'clip-test', type: 'module', main: 'clip-main.mjs' }), 'utf8');

console.log('\n任务4 · 右键「复制」= 复制文件本体（真实 electron）');
/**
 * **必须剥掉 `ELECTRON_RUN_AS_NODE`**：宿主环境若带着它（MiMo 自带的 node 就是 electron
 * 以 node 模式跑的），子进程会被当成纯 Node ⇒ `import { app } from 'electron'` 拿不到 app。
 */
const huanJing = { ...process.env };
delete huanJing.ELECTRON_RUN_AS_NODE;
const r = spawnSync(electron, [gen], { encoding: 'utf8', timeout: 30000, windowsHide: true, env: huanJing });
const chu = String(r.stdout || '');
const mode = (chu.match(/MODE=(\S+)/) || [])[1] || '(无输出)';
const err = ((chu.match(/ERR=(.*)/) || [])[1] || '').trim();
shuo(!/require is not defined/i.test(chu + String(r.stderr || '')), '没有再出现 "require is not defined"（原事故根因）');
shuo(mode === 'file' || mode === 'file-buffer', `主进程走的是文件分支（mode=${mode}）`, err);

// 用系统 API 读回剪贴板：必须是**文件**，不是文本
const ps = `${process.env.windir || 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
const du = spawnSync(ps, ['-NoProfile', '-Command',
  '[Console]::OutputEncoding=[Text.Encoding]::UTF8; (Get-Clipboard -Format FileDropList | ForEach-Object { $_.FullName })'],
{ encoding: 'utf8', timeout: 15000, windowsHide: true });
const duHui = String(du.stdout || '').trim().split(/\r?\n/).filter(Boolean);
shuo(duHui.length === 1, `剪贴板里是 1 个文件（FileDropList 读回 ${duHui.length} 项）`);
shuo(duHui[0] && path.resolve(duHui[0]).toLowerCase() === path.resolve(muBiao).toLowerCase(),
  '读回的正是目标文件（含中文文件名，未乱码）', duHui[0] || '(空)');

if (bai) console.log(`\n（失败时保留现场以便排查：${gen}）\n上面 electron 的原始输出：\n${chu}\nstderr：\n${String(r.stderr || '')}\n`);
else { try { fs.rmSync(gen, { recursive: true, force: true }); } catch { /* noop */ } }
console.log(`\n${'─'.repeat(52)}\n过 ${guo} · 败 ${bai}\n`);
process.exit(bai ? 1 : 0);
