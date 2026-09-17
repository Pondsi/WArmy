/**
 * verify-all.mjs —— 一次性跑完所有 sync-protocol 验证脚本（可重跑）
 *
 *   node scripts/verify-all.mjs
 *
 * 用子进程顺序执行，互不干扰（每个脚本自己起真实 UDP/TCP 监听、跑完自己清理）。
 * 退出码：任一脚本失败 → 1。
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = [
  'verify-handshake.mjs',
  'verify-dht.mjs',
  'verify-announce.mjs',
  'verify-liveness.mjs',
];

let failed = 0;
const summary = [];
const startedAt = Date.now();

for (const s of scripts) {
  const file = path.join(here, s);
  const t0 = Date.now();
  let out = '';
  let code = 0;
  try {
    out = execFileSync(process.execPath, [file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    code = e.status ?? 1;
  }
  const lines = out.split(/\r?\n/);
  const fails = lines.filter((l) => l.includes('[FAIL]'));
  const summaryLine = lines.find((l) => /结果：\d+ 通过/.test(l)) ?? '（没有汇总行 —— 脚本可能崩溃）';
  console.log(`\n──────────────── ${s} ────────────────`);
  for (const l of lines) {
    if (l.includes('[FAIL]') || /===|^\[|结果：/.test(l)) console.log(l);
  }
  if (fails.length === 0) {
    // 打印通过项的精简统计
    const passCount = lines.filter((l) => l.includes('[PASS]')).length;
    console.log(`  （${passCount} 项全部 PASS，用时 ${Date.now() - t0}ms）`);
  }
  console.log(`  → ${summaryLine}`);
  if (code !== 0 || fails.length > 0) failed += 1;
  summary.push({ script: s, code, fails: fails.length, line: summaryLine, ms: Date.now() - t0 });
}

console.log('\n================ sync-protocol 验证总览 ================');
for (const s of summary) {
  console.log(`  ${s.fails === 0 && s.code === 0 ? 'PASS' : 'FAIL'}  ${s.script}  (${s.ms}ms)  ${s.line}`);
}
console.log(`  总用时 ${Date.now() - startedAt}ms；失败脚本数 ${failed}/${scripts.length}`);
process.exit(failed > 0 ? 1 : 0);
