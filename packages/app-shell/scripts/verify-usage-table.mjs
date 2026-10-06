/**
 * 门禁：**总看板 · 使用量**（本轮真机反馈三件事）
 *   ① 供应商归属必须真实：本地 ollama 跑的就显示 ollama，不许写死成 deepseek；
 *   ② 做成**表格**（窗口 / 供应商 / 模型 / 提示词 / 补全 / 合计）；
 *   ③ **只算词元**：不出现金额、不出现"按内置价目估算"那类说明；
 *   ④ 「窗口」列用**第二列显示的名称**（不是内部 sessionId）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { attach, sleep } from './cdp-lib.mjs';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(selfDir, '..');
const PORT = Number(process.env.WARMY_USAGE_CDP_PORT || 9994);
const electron = path.join(pkgRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const mainJs = path.join(pkgRoot, 'dist', 'electron-main.js');
const profile = path.join(os.tmpdir(), 'warmy-usage-gate-profile');

let pass = 0;
let fail = 0;
function check(l, ok, d) {
  if (ok) { pass++; console.log('  ok  ' + l); }
  else { fail++; console.log('  FAIL ' + l, d === undefined ? '' : JSON.stringify(d).slice(0, 400)); }
}

// ── 静态：只算词元、供应商取真实值、窗口用列表名 ──
const appJs = fs.readFileSync(path.join(pkgRoot, 'src', 'renderer', 'app.js'), 'utf8');
const emTs = fs.readFileSync(path.join(pkgRoot, 'src', 'electron-main.ts'), 'utf8');
check('金额与价目估算**全部删掉**（没有价格表 / 没有 ¥ / 没有估算文案）',
  !/JIA_GE_BIAO/.test(appJs) && !/cost\.estHint/.test(appJs) && !/cost\.localHint/.test(appJs) && !/'¥'/.test(appJs) && !/` · ¥/.test(appJs), 'cost removed');
check('用量表是 <table>（表头：窗口/供应商/模型/提示词/补全/词元）',
  /class="usageBiao"/.test(appJs) && /usage\.prompt/.test(appJs) && /usage\.completion/.test(appJs) && /usage\.total/.test(appJs));
check('窗口列用第二列的名称（mingBiaoQing）而不是 sessionId',
  /function mingBiaoQing\(id\)/.test(appJs) && /window: mingBiaoQing\(x\.sessionId/.test(appJs));
check('供应商归属记的是**本轮真正用的那个**（zhu），不是设置里"当前生效的"',
  /providerId: String\(\(zhu as \{ presetId\?: string \} \| undefined\)\?\.presetId \|\| providerCfg\.presetId/.test(emTs));
check('主进程指标里也带上供应商显示名（给"按供应商"看得懂）', /providerName: String\(\(zhu as \{ biaoQian\?: string \}/.test(emTs));
check('两份 CSS 都有用量表格样式', (() => {
  const a = fs.readFileSync(path.join(pkgRoot, 'src', 'renderer', 'app.css'), 'utf8');
  const b = fs.readFileSync(path.join(pkgRoot, 'src', 'renderer', 'renderer.css'), 'utf8');
  return /\.usageBiao \{/.test(a) && /\.usageBiao \{/.test(b);
})());

// ── 运行时：开总看板，灌入两轮假数据（一轮本地 ollama、一轮云端），看表格 ──
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
  await sleep(4200);
  c = await attach(PORT, { biaoQian: 'usage-gate', callTimeout: 20000 });
  await c.send('Runtime.enable');

  // 总看板在**「我的」页底部**（见 `总看板（我的页底部）`），不是设置页
  await c.evaluate(`(function(){ const n = document.querySelector('[data-nav="wo"]'); if (n) n.click(); return true; })()`);
  await sleep(1600);
  const youKanBan = await c.evaluate(`(function(){
    const h = document.getElementById('dashHost');
    return { has: !!h, html: h ? h.innerHTML.length : 0, sortBar: !!document.getElementById('costSortBar'), list: !!document.getElementById('costList') };
  })()`);
  console.log('  · 总看板: ' + JSON.stringify(youKanBan));
  check('总看板渲染出来了（使用量区存在）', !!(youKanBan.has && youKanBan.html > 0 && youKanBan.sortBar && youKanBan.list), youKanBan);
  check('词元消耗卡**没有**"按内置价目估算"之类的说明', await c.evaluate(`(function(){
    const h = document.getElementById('dashHost');
    return h ? !/估算|价目|¥/.test(h.textContent || '') : false;
  })()`));

  // 灌两轮假数据（本地 ollama + 云端 deepseek），再点"按供应商"触发重排
  const biao = await c.evaluate(`(function(){
    window.__costData = [
      { windowId: 'inst-a', window: '牛马一号', provider: 'ollama-1791277810337', model: 'orcarouter/Qwen3.8-27B', ru: 100, chu: 200, tokens: 300 },
      { windowId: 'inst-b', window: '牛马二号', provider: 'deepseek', model: 'deepseek-chat', ru: 10, chu: 20, tokens: 30 },
    ];
    const b = document.querySelector('[data-cost-sort="provider"]');
    if (b) b.click();
    const t = document.querySelector('#costList table');
    if (!t) return { table: false, text: (document.getElementById('costList') || {}).textContent || '' };
    const heads = [...t.querySelectorAll('thead th')].map((x) => x.textContent.trim());
    const rows = [...t.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()));
    const foot = t.querySelector('tfoot tr') ? [...t.querySelectorAll('tfoot td')].map((td) => td.textContent.trim()) : [];
    return { table: true, heads, rows, foot, hasYuan: /¥/.test(t.textContent || '') };
  })()`);
  console.log('  · 表格: ' + JSON.stringify(biao));
  check('渲染成表格（有 thead/tbody）', biao.table === true, biao);
  check('表头 6 列（窗口/供应商/模型/提示词/补全/词元）', Array.isArray(biao.heads) && biao.heads.length === 6, biao.heads);
  check('本地 ollama 那行的供应商显示 ollama（不再写死 deepseek）', !!(biao.rows || []).some((r) => String(r[1]).includes('ollama')), biao.rows);
  check('云端那行显示自己的供应商（deepseek）', !!(biao.rows || []).some((r) => String(r[1]) === 'deepseek'), biao.rows);
  check('窗口列用的是传入的名称（牛马一号/牛马二号），不是内部 id', !!(biao.rows || []).some((r) => r[0] === '牛马一号') && !!(biao.rows || []).some((r) => r[0] === '牛马二号'), biao.rows);
  check('有合计行，且合计 = 提示词+补全（330）', Array.isArray(biao.foot) && biao.foot[5] === '330', biao.foot);
  check('表格里**没有金额**（¥）', biao.hasYuan === false, biao);
} catch (e) {
  console.error('门禁异常: ' + ((e && e.stack) || e));
  fail += 1;
}

jieShu();
await sleep(500);
try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch { /* noop */ }
console.log(`\n==== verify-usage-table: ${pass} ok / ${fail} FAIL ====`);
process.exit(fail ? 1 : 0);
