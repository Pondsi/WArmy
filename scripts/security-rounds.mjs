#!/usr/bin/env node
/**
 * 可复现的「连续 3 轮无问题」跑批器（取代 %TEMP% 里的一次性脚本）。
 * 用法：node scripts/security-rounds.mjs [rounds=3]
 * 任一轮失败即退出 1；连续 N 轮 CLEAN 才 exit 0。
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(selfDir, '..');
const need = Number(process.argv[2] || 3);
const node = process.execPath;
const gates = [
  'packages/app-shell/scripts/verify-security.mjs',
  'packages/app-shell/scripts/verify-template-integrity.mjs',
  'packages/app-shell/scripts/verify-naming.mjs',
];

let streak = 0;
for (let rnd = 1; rnd <= Math.max(need * 3, 9); rnd++) {
  console.log(`\n${'#'.repeat(60)}\n# SECURITY ROUNDS ${rnd} (streak ${streak}/${need})\n${'#'.repeat(60)}`);
  let clean = true;
  for (const g of gates) {
    try {
      const out = execFileSync(node, [path.join(root, g)], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
      console.log(out.slice(-800));
    } catch (e) {
      clean = false;
      console.log(String(e.stdout || e.stderr || e).slice(-1200));
    }
  }
  if (clean) {
    streak += 1;
    console.log(`\n>>> ROUND ${rnd} CLEAN streak=${streak}/${need}`);
    if (streak >= need) {
      console.log('SECURITY_ROUNDS_PASSED');
      process.exit(0);
    }
  } else {
    streak = 0;
    console.log(`\n>>> ROUND ${rnd} FAILED`);
  }
}
console.log('SECURITY_ROUNDS_FAILED');
process.exit(1);
