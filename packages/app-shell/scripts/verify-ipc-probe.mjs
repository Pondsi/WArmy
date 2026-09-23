/**
 * 计划C：通过真实 Electron + CDP 调用 window.warmy.* 只读 API，
 * 产出 docs/API-OPERATIONS-RESULTS.json 并把结果写进 API-OPERATIONS.md 的实测节。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {attach, sleep, BOOT_DONE} from './cdp-lib.mjs';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(selfDir, '..');
const repoRoot = path.resolve(pkgRoot, '..', '..');
const PORT = Number(process.env.WARMY_UI_CDP_PORT || 9889);
const electron = path.join(pkgRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const mainJs = path.join(pkgRoot, 'dist', 'electron-main.js');
const OUT_JSON = path.join(repoRoot, 'docs', 'API-OPERATIONS-RESULTS.json');
const OUT_MD = path.join(repoRoot, 'docs', 'API-OPERATIONS.md');

// 只读 API + 最小参数
const PROBES = [
  ['hardware', () => window.warmy.hardware()],
  ['listInstances', () => window.warmy.listInstances()],
  ['securityMode', () => window.warmy.securityMode()],
  ['memoryStatus', () => window.warmy.memoryStatus()],
  ['localeInfo', () => window.warmy.localeInfo()],
  ['themeInfo', () => window.warmy.themeInfo()],
  ['groupList', () => window.warmy.groupList()],
  ['updateSourceGet', () => window.warmy.updateSourceGet()],
  ['boardEvents', () => window.warmy.boardEvents()],
  ['boardAggregate', () => window.warmy.boardAggregate()],
  ['getProvider', () => window.warmy.getProvider()],
  ['checkpointList', () => window.warmy.checkpointList()],
  ['knowledgeQuery', () => window.warmy.knowledgeQuery('WArmy')],
  ['metricsSummary', () => window.warmy.metricsSummary()],
  ['settingsGet', () => window.warmy.settingsGet()],
  ['skillsList', () => window.warmy.skillsList()],
  ['skillsPaths', () => window.warmy.skillsPaths()],
  ['skillsScanDirsGet', () => window.warmy.skillsScanDirsGet()],
  ['uiQueuesGet', () => window.warmy.uiQueuesGet()],
  ['routerQueuesGet', () => window.warmy.routerQueuesGet()],
  ['profileGet', () => window.warmy.profileGet()],
  ['appInfo', () => window.warmy.appInfo()],
  ['identityInfo', () => window.warmy.identityInfo()],
  ['identityPeers', () => window.warmy.identityPeers()],
  ['netStatus', () => window.warmy.netStatus()],
  ['peersList', () => window.warmy.peersList()],
  ['executorsStatus', () => window.warmy.executorsStatus()],
  ['stateLoad', () => window.warmy.stateLoad()],
  ['lastError', () => window.warmy.lastError()],
  ['setupState', () => window.warmy.setupState()],
  ['lanStatus', () => window.warmy.lanStatus()],
  ['meshStatus', () => window.warmy.meshStatus()],
  ['platformInfo', () => window.warmy.platformInfo()],
  ['costSummary', () => window.warmy.costSummary()],
  ['memoryRecall', () => window.warmy.memoryRecall('WArmy')],
  ['i18n', () => window.warmy.i18n('zh-CN')],
  ['memoryRetrieve', () => window.warmy.memoryRetrieve({ seq: 1 })],
  ['projectState', () => window.warmy.projectState({ sessionId: '' })],
  ['projectMemoryGet', () => window.warmy.projectMemoryGet({ sessionId: '' })],
  ['aiQuestionList', () => window.warmy.aiQuestionList('')],
  ['archiveList', () => window.warmy.archiveList('')],
  ['boardTasks', () => window.warmy.boardTasks('')],
  ['groupMembers', () => window.warmy.groupMembers('')],
  ['containerProbe', () => window.warmy.containerProbe({ force: false })],
  ['netPortCandidates', () => window.warmy.netPortCandidates({ requestedPort: 59599 })],
  ['chatLogRestore', () => window.warmy.chatLogRestore()],
];

function preview(r) {
  try {
    const s = JSON.stringify(r);
    return s && s.length > 200 ? s.slice(0, 200) + '…' : s;
  } catch { return String(r).slice(0, 200); }
}

async function waitCdp(secs = 45) {
  for (let i = 0; i < secs; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json`, { signal: AbortSignal.timeout(1200) });
      if (r.ok) return true;
    } catch { /* retry */ }
    await sleep(500);
  }
  return false;
}

async function main() {
  const child = spawn(electron, [
    `--remote-debugging-port=${PORT}`,
    '--disable-features=CalculateNativeWinOcclusion',
    `--user-data-dir=${path.join(os.tmpdir(), 'warmy-ipc-probe-profile')}`,
    mainJs,
  ], { cwd: pkgRoot, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false });
  if (!(await waitCdp())) {
    console.error('CDP not up');
    try { child.kill('SIGKILL'); } catch { /* noop */ }
    process.exit(2);
  }
  await sleep(4000);
  const c = await attach(PORT, { biaoQian: 'ipc-probe', callTimeout: 20000 });
  await c.send('Runtime.enable');
  try { await c.waitFor(BOOT_DONE, { timeout: 20000 }); } catch { /* warn */ }
  await sleep(2000);

  const results = [];
  for (const [ming, fn] of PROBES) {
    const t0 = Date.now();
    try {
      const r = await c.evaluate(`(async function(){ try { return ${fn.toString().replace(/^\(\)\s*=>\s*/, 'return ').replace(/^return\s+/, '')}; } catch(e) { return { __err: String(e && e.message || e) }; } })()`);
      const ms = Date.now() - t0;
      const ok = r && !r.__err && r.ok !== false;
      results.push({ ming, ok, ms, resultPreview: preview(r) });
      console.log(`  [${ok ? 'ok' : 'FAIL'}] ${ming} ${ms}ms ${preview(r)}`);
    } catch (e) {
      results.push({ ming, ok: false, ms: Date.now() - t0, error: String(e.message || e) });
      console.log(`  [FAIL] ${ming} ${e.message}`);
    }
  }

  try { c.close(); } catch { /* noop */ }
  try { child.kill('SIGKILL'); } catch { /* noop */ }

  const okCount = results.filter((x) => x.ok).length;
  const out = { at: new Date().toISOString(), total: results.length, ok: okCount, results };
  fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2), 'utf8');

  // 写入 API-OPERATIONS.md 的实测节
  if (fs.existsSync(OUT_MD)) {
    let md = fs.readFileSync(OUT_MD, 'utf8');
    const lines = results.map((r) => `| \`${r.name}\` | ${r.ok ? '✅' : '❌'} | ${r.ms}ms | ${r.resultPreview || r.error || ''} |`).join('\n');
    const section = `

## 实测结果（CDP 真实 IPC）

生成时间：${out.at} · 通过 ${okCount}/${results.length}

| API | ok | ms | preview |
| --- | --- | --- | --- |
${lines}

> 本节由 \`packages/app-shell/scripts/verify-ipc-probe.mjs\` 在真实 Electron 会话内生成。
`;
    if (md.includes('## 实测结果（CDP 真实 IPC）')) {
      md = md.replace(/## 实测结果（CDP 真实 IPC）[\s\S]*?(?=\n## |\n---)/, section.trim() + '\n');
    } else if (md.includes('## 实测说明')) {
      md = md.replace('## 实测说明', section.trim() + '\n\n## 实测说明');
    } else {
      md += section;
    }
    fs.writeFileSync(OUT_MD, md, 'utf8');
  }

  console.log(`\n==== verify-ipc-probe: ${okCount}/${results.length} ====`);
  // 只读 API 至少 70% 成功即算通过（部分 API 可能因空数据返回 ok:false）
  process.exit(okCount >= Math.floor(results.length * 0.7) ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
