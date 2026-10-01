#!/usr/bin/env node
/**
 * 全量连续 3 轮验证跑批器（覆盖项目**全部**可跑门禁 + 专项单测）。
 *
 * 用法：node scripts/full-verify-rounds.mjs [rounds=3]
 *
 * 关键设计：
 *  - 每轮开始**清理游魂 Electron**：Electron 类门禁靠 CDP 连本地端口，残留进程会让
 *    它们报 "CDP not up"（实测踩过），必须先把上一轮/上次留下的进程收干净。
 *  - Electron 类门禁给足超时（它们要真启动应用）；超时计为该轮失败，不静默放过。
 *  - 单测（UNIT）覆盖：凭证遮挡、i18n、主题色、引导、工作工具会话权限等跨文件不变量。
 */
import { execFileSync, execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(selfDir, '..');
const node = process.execPath;
const need = Number(process.argv[2] || 3);

const E = (n) => `packages/app-shell/scripts/${n}`;

/** 无头/静态门禁（快） */
const GATES_FAST = [
  E('check-syntax.mjs'),
  E('verify-security.mjs'),
  E('verify-template-integrity.mjs'),
  E('verify-naming.mjs'),
  E('verify-electron-app-binding.mjs'),
  E('verify-container-probe.mjs'),
  E('verify-container-exec.mjs'),
  E('verify-credential.mjs'),
  E('verify-identity.mjs'),
  E('verify-i18n-locales.mjs'),
  E('verify-wiring.mjs'),
  E('verify-docs.mjs'),
  E('verify-group-store.mjs'),
  E('verify-history-persist.mjs'),
  E('verify-memory.mjs'),
  E('verify-router-queue.mjs'),
  E('verify-repo-guard.mjs'),
  E('verify-updater.mjs'),
  E('verify-updater-github.mjs'),
  E('verify-work-tools.mjs'),
  E('verify-model-pick.mjs'),
  E('verify-subagents.mjs'),
  E('verify-import-integrity.mjs'),
  E('verify-membership.mjs'),
  E('verify-planB.mjs'),
  E('verify-planD.mjs'),
  E('verify-summary-quality.mjs'),
  E('verify-warmy-features.mjs'),
];

/** Electron 类门禁（真启动应用 + CDP，慢） */
const GATES_ELECTRON = [
  E('verify-ui-layout.mjs'),
  E('verify-chat-window.mjs'),
  E('verify-ipc-probe.mjs'),
];

function killStrayElectron() {
  try {
    if (process.platform === 'win32') {
      execSync('taskkill /F /IM electron.exe /T', { stdio: 'ignore', timeout: 30000 });
    } else {
      execSync("pkill -f 'electron' || true", { stdio: 'ignore', timeout: 30000 });
    }
  } catch { /* 没有残留进程时 taskkill 会返回非 0，属正常 */ }
}

function runGate(g, timeout) {
  const p = path.join(root, g);
  if (!fs.existsSync(p)) return { ok: false, out: `missing script ${g}` };
  try {
    const out = execFileSync(node, [p], { cwd: root, encoding: 'utf8', stdio: 'pipe', timeout });
    return { ok: true, out: String(out).slice(-300) };
  } catch (e) {
    const killed = e.killed === true || e.signal === 'SIGTERM';
    return { ok: false, out: (killed ? `TIMEOUT after ${timeout}ms\n` : '') + String(e.stdout || e.stderr || e).slice(-900) };
  }
}

function unitChecks() {
  const fails = [];
  const appJs = fs.readFileSync(path.join(root, 'packages/app-shell/src/renderer/app.js'), 'utf8');
  const distJs = fs.readFileSync(path.join(root, 'packages/app-shell/dist/renderer/app.js'), 'utf8');
  const probe = fs.readFileSync(path.join(root, 'packages/app-shell/dist/container-probe.js'), 'utf8');
  const work = fs.readFileSync(path.join(root, 'packages/app-shell/dist/work-tools.js'), 'utf8');
  const emTs = fs.readFileSync(path.join(root, 'packages/app-shell/src/electron-main.ts'), 'utf8');
  const ss = fs.readFileSync(path.join(root, 'packages/app-shell/src/settings-store.ts'), 'utf8');
  const zh = JSON.parse(fs.readFileSync(path.join(root, 'packages/app-shell/dist/i18n/zh-CN.json'), 'utf8'));
  const css = ['app.css', 'renderer.css']
    .map((n) => fs.readFileSync(path.join(root, 'packages/app-shell/src/renderer/' + n), 'utf8'))
    .join('\n');

  // 凭证遮挡：开头 1 组 + 9 牛马 + 末 6 字符
  if (!appJs.includes('CRED_MASK_GROUPS = 9')) fails.push('mask: CRED_MASK_GROUPS!=9');
  if (!appJs.includes('raw.slice(-6)')) fails.push('mask: last 6 chars missing');
  // i18n
  if (!appJs.includes('const tOr =')) fails.push('tOr missing');
  if (appJs.includes("t('panel.assist') ||")) fails.push('dropdown still uses raw t()||');
  // 容器 / Microsandbox
  if (!probe.includes("id: 'microsandbox'")) fails.push('probe: microsandbox missing');
  if (!probe.includes('microsandboxExecPlan')) fails.push('probe: msb exec plan missing');
  if (!zh['container.rt.microsandbox.name']) fails.push('i18n: microsandbox missing');
  // dsh
  if (!String(zh['dsh.biaoTi'] || '').includes('DeepSeek Shell')) fails.push('i18n: dsh full name');
  if (!appJs.includes('MIN_MS = 1300')) fails.push('dsh: min not 1300');
  // 主题色
  if (!appJs.includes("theme: '#A78567'")) fails.push('theme: default not #A78567');
  if (!ss.includes("accent: '#A78567'")) fails.push('theme: settings-store accent not #A78567');
  if (/#(?:2ea56a|07c160|10ad6a)/i.test(css)) fails.push('theme: green hex still in css');
  if (appJs.includes("btn.textContent = t('list.addInstance')")) fails.push('create btn not plus');
  if (!appJs.includes('iQiDongTingZhi')) fails.push('toggle button missing');
  if (!appJs.includes('bindThemeMode')) fails.push('theme: mode buttons not bound');
  if (!appJs.includes('miYaoYan')) fails.push('provider: key eye missing');
  if (!appJs.includes('__lastSend')) fails.push('chat: no duplicate-send guard');
  if (!appJs.includes('presetFromName')) fails.push('chat: unstable avatar fallback');
  if (!appJs.includes('xiaoXiMing')) fails.push('chat: speaker name missing');
  if (!appJs.includes('renderDefaultOptions')) fails.push('model: default options follow available');
  if (!appJs.includes('model.disable')) fails.push('model: chain disable missing');
  // 引导
  if (!appJs.includes('yinDaoTiao') || !appJs.includes('yinDaoLianJie')) fails.push('guide: bar/tip missing');
  if (!appJs.includes('guide.finish')) fails.push('guide: finish label missing');
  if (!appJs.includes('check: youGongYingShang') || !appJs.includes('check: youNiuMa')) fails.push('guide: no per-step gating');
  if (!appJs.includes('anNiuChongKanYinDao') || !appJs.includes('guideDone')) fails.push('guide: restart/persist missing');
  if (!css.includes('.yinDaoTiao') || !css.includes('right: 16px')) fails.push('css: guide not on the right');
  // 主进程
  if (!/process\.on\('uncaughtException'/.test(emTs)) fails.push('main: uncaughtException not handled');
  if (!huiYongWork(emTs)) fails.push('main: work tools not wired');
  // 小弟必须能干活，且不能再生小弟
  {
    const i = emTs.indexOf('spawn_subagent');
    const seg = i >= 0 ? emTs.slice(i, i + 2600) : '';
    if (!seg.includes('workToolSpecs')) fails.push('subagent work tools: 小弟没有文件工具');
    if (seg.includes('xiaoDiToolSpecs')) fails.push('subagent work tools: 小弟又派小弟');
    if (!/zuiDaLunShu:\s*4/.test(seg)) fails.push('subagent work tools: 轮数过小');
  }
  if (!appJs.includes('chainDisabled')) fails.push('model: chainDisabled not persisted from UI');
  if (emTs.includes('pickModelForUrgency(')) fails.push('model: dead pickModelForUrgency still called');
  // 工作工具
  if (!work.includes('WORK_TOOL_SECURITY')) fails.push('work-tools: security block missing');
  // dist 同步
  for (const s of ['CRED_MASK_GROUPS = 9', 'MIN_MS = 1300', '__lastSend']) {
    if (!distJs.includes(s)) fails.push(`dist missing: ${s}`);
  }
  return fails;
}
function huiYongWork(emTs) {
  return emTs.includes('workToolSpecs') && emTs.includes('runWorkTool') && emTs.includes('huiHuaKeGanHuo');
}

let streak = 0;
for (let rnd = 1; rnd <= Math.max(need * 3, 9); rnd++) {
  console.log(`\n${'#'.repeat(64)}\n# FULL VERIFY ROUND ${rnd} (streak ${streak}/${need})\n${'#'.repeat(64)}`);
  killStrayElectron();
  let clean = true;
  const unit = unitChecks();
  if (unit.length) { clean = false; console.log('UNIT FAIL:\n  ' + unit.join('\n  ')); }
  else console.log('UNIT OK');

  for (const g of GATES_FAST) {
    const r = runGate(g, 180000);
    if (r.ok) console.log(`OK   ${g}`);
    else { clean = false; console.log(`FAIL ${g}\n${r.out}`); }
  }
  for (const g of GATES_ELECTRON) {
    const r = runGate(g, 300000);
    if (r.ok) console.log(`OK   ${g}`);
    else { clean = false; console.log(`FAIL ${g}\n${r.out}`); }
    killStrayElectron();
  }
  if (clean) {
    streak += 1;
    console.log(`\n>>> ROUND ${rnd} CLEAN streak=${streak}/${need}`);
    if (streak >= need) { console.log('FULL_VERIFY_3X_PASSED'); process.exit(0); }
  } else {
    streak = 0;
    console.log(`\n>>> ROUND ${rnd} FAILED`);
  }
}
console.log('FULL_VERIFY_FAILED');
process.exit(1);
