/**
 * verify-no-empty-catch.mjs
 * 产品源码（packages/*&#47;src）禁止 catch 纯空块。脚本/探针不在此列。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
let fail = 0;
const hits = [];

function walk(d, dep = 0) {
  if (dep > 6) return;
  for (const n of fs.readdirSync(d)) {
    if (['node_modules', 'dist', '.git', 'vendor'].includes(n)) continue;
    const p = path.join(d, n);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, dep + 1);
    else if (/\.(ts|js|cjs|mjs)$/.test(n)) {
      const s = fs.readFileSync(p, 'utf8');
      const re = /catch\s*(\([^)]*\))?\s*\{([^{}]*)\}/g;
      let m;
      while ((m = re.exec(s))) {
        const body = String(m[2] || '').trim();
        if (body === '') {
          const line = s.slice(0, m.index).split('\n').length;
          hits.push(path.relative(root, p) + ':' + line);
        }
      }
    }
  }
}

const pkgs = path.join(root, 'packages');
for (const n of fs.readdirSync(pkgs)) {
  const src = path.join(pkgs, n, 'src');
  if (fs.existsSync(src)) walk(src);
}

console.log('  扫描产品 src 下 catch 空块 …');
if (hits.length) {
  console.log('  [FAIL] 发现纯空 catch：', hits.slice(0, 25).join(', '));
  fail++;
} else {
  console.log('  [PASS] 产品源码无纯空 catch');
}
console.log(fail === 0 ? 'ALL PASS' : 'FAILURES=' + fail);
process.exit(fail === 0 ? 0 : 1);
