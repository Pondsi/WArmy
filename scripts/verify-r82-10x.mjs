/**
 * 第 82 轮 10 轮全功能验收：
 *   5 种内容 × 各 2 轮（连续两轮同内容），每轮先跑 32 门禁 fast 套件（覆盖全部已门禁功能），
 *   再按内容追加真实模型 / 长记忆 / 语音 / 社交 / FWArmy 扩网 / 预算与 UI 的实测。
 * 任一轮失败：立即停止，不进入下一轮；修复后必须从第 1 轮重跑。
 */
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FW = path.resolve(ROOT, '..', 'FWArmy');
const LOG = path.join(ROOT, 'docs', 'VERIFY-R82-10X.md');
const rows = [];
let currentRound = 0;
const now = () => new Date().toISOString();
const START = now();
const TOU = `# 第 82 轮 10 轮全功能验收\n\n开始：${START}\n\n规则：5 种内容 × 各 2 轮；每轮先跑 32 门禁 fast 套件，再跑该内容的额外实测；任一轮失败停止，修复后从第 1 轮重跑。\n\n`;

// 清掉上一次被中断时遗留的测试 Electron（只匹配 %TEMP%\warmy-* 临时 profile）
try {
  execFileSync('powershell', ['-NoProfile', '-Command',
    "Get-CimInstance Win32_Process -Filter \"name='electron.exe'\" | Where-Object { $_.CommandLine -like '*Temp\\warmy-*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
  ], { stdio: 'ignore', timeout: 20_000 });
} catch { /* noop */ }

function run(label, file, cwd = ROOT, env = {}) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [file], {
    cwd, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 15 * 60_000,
  });
  const out = String(r.stdout || '') + String(r.stderr || '');
  const last = out.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] || '';
  const ok = r.status === 0;
  const sec = Math.round((Date.now() - t0) / 1000);
  console.log(`[${now()}] ${ok ? 'ok  ' : 'FAIL'} ${label} — ${last} (${sec}s)`);
  rows.push({ round: currentRound, label, ok, last, sec });
  if (!ok) {
    fs.appendFileSync(LOG, `\n### FAIL ${label}\n\n\`\`\`\n${out.slice(-4000)}\n\`\`\`\n`);
    throw new Error(`FAIL ${label}`);
  }
  return out;
}

const variants = {
  1: [
    ['UI/IPC 接线 r82-r103', 'dev/gates/verify-r82-r103.mjs'],
  ],
  2: [
    ['长会话记忆 round39-longchat', 'dev/gates/verify-round39-longchat.mjs'],
    ['ASR 路由 round38-asr', 'dev/gates/verify-round38-asr.mjs'],
  ],
  3: [
    ['微信凭据/队列 r44', 'dev/gates/verify-r44-shejiao.mjs'],
    ['微信协议 r65', 'packages/app-shell/scripts/verify-r65-shejiao.mjs'],
  ],
  4: [
    ['FWArmy 扩网', 'verify-expand.mjs', FW],
  ],
  5: [
    ['预算/额度 round39-budget', 'dev/gates/verify-round39-budget.mjs'],
    ['独立会话窗 r82-chatwin', 'dev/gates/verify-r82-chatwin.mjs'],
  ],
};

fs.writeFileSync(LOG, TOU + `| 轮 | 标签 | 结果 | 末行 | 秒 |\n|---|---|---|---|---|\n`);

try {
  for (let round = 1; round <= 10; round++) {
    const pair = Math.ceil(round / 2);
    currentRound = round;
    console.log(`\n===== ROUND ${round}/10 · 内容 ${pair} =====`);
    run(`fast 32 门禁（第 ${round} 轮）`, 'scripts/verify-r78-3x.mjs', ROOT, { VERIFY_ROUNDS: '1' });
    for (const [label, file, cwd] of variants[pair]) {
      run(`${label}（第 ${round} 轮）`, file, cwd || ROOT);
    }
    fs.writeFileSync(LOG, TOU + `| 轮 | 标签 | 结果 | 末行 | 秒 |\n|---|---|---|---|---|\n` +
      rows.map((x) => `| ${x.round} | ${x.label} | ${x.ok ? 'PASS' : 'FAIL'} | ${String(x.last).replace(/\|/g, '/')} | ${x.sec} |`).join('\n') + '\n');
    console.log(`[${now()}] ===== ROUND ${round}/10 PASSED =====`);
  }
  fs.appendFileSync(LOG, `\n## 结论\n\n10 轮全部 PASSED（5 种内容各连续 2 轮）。结束：${now()}\n`);
  console.log('\nR82 10X PASSED');
} catch (e) {
  fs.appendFileSync(LOG, `\n## 停止\n\n${now()} ${String(e.message)}\n\n**必须修复后从第 1 轮重跑。**\n`);
  console.error('\nR82 10X STOPPED:', e.message);
  process.exitCode = 1;
}
