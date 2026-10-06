/**
 * 临时实验：把 dist 里的 raf + 卡片心跳还原成"老行为"，
 * 确认 verify-sound-card 真的会 FAIL（证明这个门禁能抓到旧 bug，不是恒真）。
 * 跑完自动还原。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(selfDir, '..');
const dist = path.join(pkgRoot, 'dist', 'renderer', 'app.js');
const bak = dist + '.bak-experiment';

const yuan = fs.readFileSync(dist, 'utf8');

// ① raf 还原成"同帧只跑第一个"（老实现）
const i0 = yuan.indexOf('  let __rafDaiLie = null;');
const i1 = yuan.indexOf('window.__rafDaiLieChang = () => (__rafDaiLie ? __rafDaiLie.length : 0);');
if (i0 < 0 || i1 < 0) { console.error('找不到 raf 代码块'); process.exit(2); }
const laoRaf = `  let __rafThrottle = false;
  function raf(fn) {
    if (__rafThrottle) return;
    __rafThrottle = true;
    requestAnimationFrame(() => { __rafThrottle = false; fn(); });
  }
  `;
let gai = yuan.slice(0, i0) + laoRaf + yuan.slice(i1 + 'window.__rafDaiLieChang = () => (__rafDaiLie ? __rafDaiLie.length : 0);'.length);

// ② 去掉决策卡专用心跳（老实现只有 raf 那一趟）
const xin = "  setInterval(() => { try { void renderAiQuestions(); } catch { /* noop */ } }, 1200);\n";
if (!gai.includes(xin)) { console.error('找不到决策卡心跳那行'); process.exit(2); }
gai = gai.replace(xin, '');

fs.writeFileSync(bak, yuan);
fs.writeFileSync(dist, gai);
console.log('已还原成老行为，开始跑门禁（预期 FAIL）…\n');

const r = spawnSync(process.execPath, [path.join(selfDir, 'verify-sound-card.mjs')], { cwd: pkgRoot, encoding: 'utf8' });
const out = (r.stdout || '') + (r.stderr || '');
console.log(out.split('\n').filter((l) => /ok |FAIL|====/.test(l)).join('\n'));
console.log('\n退出码 = ' + r.status + '（非 0 = 门禁确实抓到了旧 bug）');

fs.writeFileSync(dist, fs.readFileSync(bak, 'utf8'));
fs.unlinkSync(bak);
console.log('dist 已还原。');
