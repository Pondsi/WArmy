/** run-gates.mjs —— 逐个跑门禁，每个带超时；把结果写日志，避免被挂死的那个拖住整体 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = 'C:\\wbuild';
const list = process.argv.slice(2);
const LOG = path.join(process.env.TEMP, 'warmy-gates.log');
const lines = [];
const out = (s) => { lines.push(s); console.log(s); };

for (const name of list) {
  const f = path.join(root, 'packages', 'app-shell', 'scripts', name + '.mjs');
  const t0 = Date.now();
  let okArg = true;
  let tail = '';
  try {
    const r = execFileSync(process.execPath, [f], {
      cwd: root, timeout: 420000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
    });
    tail = r;
  } catch (e) {
    okArg = false;
    tail = String((e && (e.stdout || '')) + '\n' + (e && (e.stderr || ''))) || String(e && e.message);
    if (e && (e.killed || e.signal)) tail += '\n[TIMEOUT/KILLED signal=' + (e.signal || '-') + ']';
  }
  const ms = Date.now() - t0;
  const zuiHou = tail.split('\n').filter((l) => l.trim()).slice(-4).join(' | ').slice(0, 400);
  out((okArg ? 'PASS ' : 'FAIL ') + name.padEnd(34) + ' ' + String(ms).padStart(7) + 'ms  ' + zuiHou);
}
fs.writeFileSync(LOG, lines.join('\n'), 'utf8');
console.log('\n---- 汇总 ----\n通过 ' + lines.filter((l) => l.startsWith('PASS')).length + ' / 共 ' + lines.length + '（日志 ' + LOG + '）');
