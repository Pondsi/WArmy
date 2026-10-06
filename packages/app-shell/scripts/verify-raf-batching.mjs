/**
 * 门禁：**同一 tick 里排队的刷新回调必须全部执行**（真事故发现）。
 *
 * 老实现把 `raf(fn)` 写成"同帧只跑第一个"：
 *   `if (__rafThrottle) return; __rafThrottle = true; requestAnimationFrame(...)`
 * 而主刷新循环一个 tick 里连着调 8 个 `raf(...)` ⇒ **除了第一个全被静默丢掉**。
 * 直接后果：`renderAiQuestions`（决策卡的轮询发现）永远排第二 ⇒ 从来没跑过，
 * 主进程没广播的卡片既不显示也不响铃（用户报的"首次出现的决策卡没有音效"）。
 * 同类受害者：refreshCost / shuaxinZhixingqiji / refreshSessionBoard / refreshMembers
 *          / checkLastError / renderProjectMemoryPanel / refreshJoinBadge。
 *
 * 这个门禁只测**机制**（排队的都跑、单个抛错不连累别人、隐藏窗口有兜底），
 * 不去猜具体哪个面板该刷新。
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { attach, sleep } from './cdp-lib.mjs';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(selfDir, '..');
const PORT = Number(process.env.WARMY_RAF_CDP_PORT || 9966);
const electron = path.join(pkgRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const mainJs = path.join(pkgRoot, 'dist', 'electron-main.js');
const profile = path.join(os.tmpdir(), 'warmy-raf-gate-profile');

let pass = 0;
let fail = 0;
function check(l, ok, d) {
  if (ok) { pass++; console.log('  ok  ' + l); }
  else { fail++; console.log('  FAIL ' + l, d === undefined ? '' : JSON.stringify(d).slice(0, 300)); }
}

fs.rmSync(profile, { recursive: true, force: true });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [
  `--remote-debugging-port=${PORT}`,
  '--disable-features=CalculateNativeWinOcclusion',
  `--user-data-dir=${profile}`,
  mainJs,
], { cwd: pkgRoot, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false, env });

async function waitCdp(secs = 40) {
  for (let i = 0; i < secs; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json`, { signal: AbortSignal.timeout(1200) }); if (r.ok) return true; } catch { /* retry */ }
    await sleep(500);
  }
  return false;
}

let c = null;
function jieShu() {
  try { if (c) c.close(); } catch { /* noop */ }
  try { child.kill('SIGKILL'); } catch { /* noop */ }
}

try {
  if (!(await waitCdp())) { console.error('CDP not up'); jieShu(); process.exit(2); }
  await sleep(4000);
  c = await attach(PORT, { biaoQian: 'raf-gate', callTimeout: 20000 });
  await c.send('Runtime.enable');

  // ① 一个 tick 里连排 5 个：必须全跑（老实现只跑第一个）
  const p1 = await c.evaluate(`(async function(){
    const pao = [];
    window.__raf(() => pao.push(1));
    window.__raf(() => pao.push(2));
    window.__raf(() => pao.push(3));
    window.__raf(() => pao.push(4));
    window.__raf(() => pao.push(5));
    const duiLie = window.__rafDaiLieChang();
    await new Promise((r) => setTimeout(r, 120));
    return { duiLie, pao, que: [1,2,3,4,5].filter((n) => !pao.includes(n)) };
  })()`);
  console.log('  · 同 tick 排队: ' + JSON.stringify(p1));
  check('钩子存在（能测到队列）', typeof p1.duiLie === 'number', p1);
  check('同一 tick 排了 5 个', p1.duiLie >= 5, p1);
  check('5 个回调**全都执行了**（老实现只跑第 1 个）', p1.pao.length === 5 && p1.que.length === 0, p1);

  // ② 单个回调抛错不许连累同帧其它回调
  const p2 = await c.evaluate(`(async function(){
    const pao = [];
    window.__raf(() => { throw new Error('门禁故意抛错'); });
    window.__raf(() => pao.push('hou'));
    await new Promise((r) => setTimeout(r, 400));
    window.__raf(() => pao.push('hai-huo'));
    await new Promise((r) => setTimeout(r, 120));
    return { pao };
  })()`);
  console.log('  · 抛错隔离: ' + JSON.stringify(p2));
  check('前一个回调抛错，后面的照跑', p2.pao.includes('hou'), p2);
  check('抛错后队列没被永久锁死（后续仍能排）', p2.pao.includes('hai-huo'), p2);

  /**
   * ③ 真机活体证据：**造一张主进程不广播的卡**，看界面能不能自己发现它。
   *    这是决策卡心跳的唯一可观测副作用（老实现里这条路是死的：轮询永远被丢）。
   *    ⚠️ 不要用"改写 window.warmy.xxx 计数"的办法测 —— contextBridge 暴露的对象是只读的，
   *    赋值会被静默忽略，计数器恒为 0（本次门禁自己踩过的坑）。
   */
  const t0 = Date.now();
  await c.evaluate(`(async function(){
    await window.warmy.aiQuestionOpen({ groupId: 'raf-gate-sess', biaoTi: '心跳门禁卡', ti: 'x', options: [{ biaoQian: 'A' }] });
    return true;
  })()`);
  let faxian = null;
  for (let i = 0; i < 24; i++) {
    await sleep(250);
    const z = await c.evaluate(`(function(){
      const d = (window.__yinXiaoZhenDuan || []).filter((x) => String(x.laiYuan || '').indexOf('render') === 0 && x.ok === true);
      return { n: d.length };
    })()`);
    if (z && z.n > 0) { faxian = { n: z.n, ms: Date.now() - t0 }; break; }
  }
  console.log('  · 心跳发现卡片耗时: ' + JSON.stringify(faxian));
  check('决策卡心跳自己发现了新卡（老实现：永远发现不了）', !!(faxian && faxian.n > 0), faxian);
  check('发现得够快（< 4 秒，心跳 1.2s 量级）', !!(faxian && faxian.ms < 4000), faxian);

  // ④ 队列会被真的放空（不是一直躺着）
  const p4 = await c.evaluate(`(async function(){
    window.__raf(() => {});
    window.__raf(() => {});
    const jiZhong = window.__rafDaiLieChang();
    await new Promise((r) => setTimeout(r, 200));
    const hou = window.__rafDaiLieChang();
    return { jiZhong, hou };
  })()`);
  console.log('  · 队列放空: ' + JSON.stringify(p4));
  check('排进去的队列会被放空（不会越积越多）', p4.jiZhong >= 2 && p4.hou === 0, p4);

  // ⑤ 源码不变量：主循环里不许再出现"排在别人后面必然被丢"的写法
  const src = fs.readFileSync(path.join(pkgRoot, 'src', 'renderer', 'app.js'), 'utf8');
  check('源码：raf 是排队实现（不再 if(...) return 直接丢）', /function raf\(fn\) \{\s*\n\s*if \(typeof fn !== 'function'\) return;/.test(src), 'raf 实现');
  check('源码：有兜底定时器（隐藏窗口 rAF 停发时也能放出队列）', /__rafBaoXianJi = setTimeout\(__rafFangChu, 300\)/.test(src));
  check('源码：决策卡心跳是独立 setInterval（不依赖 rAF）', /setInterval\(\(\) => \{ try \{ void renderAiQuestions\(\); \} catch/.test(src));
  check('源码：主循环里不再有 raf(renderAiQuestions)（避免与心跳重复）', !/raf\(renderAiQuestions\)/.test(src));
} catch (e) {
  console.error('门禁异常: ' + ((e && e.stack) || e));
  fail += 1;
}

jieShu();
await sleep(500);
try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch { /* noop */ }
console.log(`\n==== verify-raf-batching: ${pass} ok / ${fail} FAIL ====`);
process.exit(fail ? 1 : 0);
