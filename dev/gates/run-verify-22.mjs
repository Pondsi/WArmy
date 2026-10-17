/**
 * run-verify-22.mjs —— 第 22 轮"全面检验"的唯一入口（可连续跑 N 遍，日志可复核）
 *
 * 为什么写成清单：用户要求"连续 3 次没有问题"。跑什么、每支多久、红在哪一行，
 * 必须落在一份能回看的日志里，而不是散在终端历史里。
 *
 * 两档：
 *   --tier=fast（默认）  纯本地、可重复、不依赖外部服务的门禁。**这一档连续跑 3 遍**。
 *   --tier=live          真机 Electron 门禁（要启动应用、抢单实例锁、真 Ollama/真模型）。
 *                        跑之前/之后**先清场**：上一支真机门禁遗留的 electron 会让下一支
 *                        `EVAL_TIMEOUT`（本轮实测：遗留实例占住 9523 与单实例锁）。
 *
 * 用法：
 *   node run-verify-22.mjs --times=3                  # 连续 3 遍 fast（全绿才算过）
 *   node run-verify-22.mjs --tier=live                # 真机档跑一遍
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const TIMES = Math.max(1, Math.min(9, Number((argv.find((a) => /^--times=/.test(a)) || '--times=1').split('=')[1]) || 1));
const TIER = (argv.find((a) => /^--tier=/.test(a)) || '--tier=fast').split('=')[1];

/** 纯本地、可重复 */
const FAST = [
  ['assets', 'verify-assets-fresh', 5],
  ['app-shell', 'verify-security', 120],
  ['app-shell', 'check-syntax', 120],
  ['app-shell', 'verify-gate-manifest', 120],
  ['app-shell', 'verify-secret-at-rest', 120],
  ['app-shell', 'verify-no-empty-catch', 120],
  ['app-shell', 'verify-repo-guard', 120],
  ['app-shell', 'verify-docs', 180],
  ['app-shell', 'verify-truth-guard', 180],
  ['app-shell', 'verify-import-integrity', 180],
  ['app-shell', 'verify-template-integrity', 180],
  ['app-shell', 'verify-renderer-scope', 120],
  ['app-shell', 'verify-renderer-template-balance', 120],
  ['app-shell', 'verify-css-consistency', 120],
  ['app-shell', 'verify-i18n-locales', 180],
  ['app-shell', 'verify-strict-language', 180],
  ['app-shell', 'verify-naming', 180],
  ['app-shell', 'verify-wiring', 180],
  ['app-shell', 'verify-ipc-probe', 180],
  ['app-shell', 'verify-electron-app-binding', 180],
  ['app-shell', 'verify-work-tools', 240],
  ['app-shell', 'verify-tool-calls', 240],
  ['app-shell', 'verify-model-kind', 120],
  ['app-shell', 'verify-model-pick', 240],
  ['app-shell', 'verify-model-route', 240],
  ['app-shell', 'verify-eta-forecast', 240],
  ['app-shell', 'verify-router-queue', 240],
  ['app-shell', 'verify-group-store', 240],
  ['app-shell', 'verify-membership', 240],
  ['app-shell', 'verify-identity', 180],
  ['app-shell', 'verify-credential', 180],
  ['app-shell', 'verify-nm-format', 180],
  ['app-shell', 'verify-ctx-budget', 240],
  ['app-shell', 'verify-zip-look', 240],
  ['app-shell', 'verify-industry-gates', 180],
  ['app-shell', 'verify-media-format', 180],
  ['app-shell', 'verify-audio-first-class', 240],
  ['app-shell', 'verify-updater', 240],
  ['app-shell', 'verify-updater-github', 240],
  ['app-shell', 'verify-office-doc-suite', 420],
  ['app-shell', 'verify-research-pipeline', 240],
  ['app-shell', 'verify-nat', 300],
  ['app-shell', 'verify-context-renderer', 1800, ['--no-electron']],
  ['sync-protocol', 'verify-all', 900],
  ['sync-protocol', 'verify-connectivity', 900],
  ['spikes', 'verify-all/run-full', 1200],
  ['root', 'verify-round20-badge', 300],
  ['root', 'verify-round20-clip', 300],
  ['root', 'verify-round20-css', 300],
  ['root', 'verify-round20-enhance', 600],
  ['root', 'verify-round20-esm', 300],
  ['root', 'verify-round20-ink', 300],
  ['root', 'verify-round20-install', 300],
  ['root', 'verify-round20-play', 300],
  ['root', 'verify-round20-route', 300],
  ['root', 'verify-round20-sound', 300],
  ['root', 'verify-round20-stream', 300],
  ['root', 'verify-round21-long-memory', 300],
  ['root', 'verify-round21-ui-loop', 300],
  ['root', 'verify-round22-decision', 300],
  ['root', 'verify-round22-longrun', 1200],
  ['root', 'verify-round27-changes', 300],
  ['root', 'verify-round28-changes', 300],
  ['root', 'verify-round34-changes', 300],
  ['root', 'verify-round35-changes', 300],
  ['root', 'verify-round36-changes', 300],
  ['root', 'verify-round37-changes', 300],
  ['root', 'verify-tool-args', 300],
];

/** 真机：要起 Electron / 真模型，跑前先清场 */
const LIVE = [
  ['app-shell', 'verify-runtime-errors', 600],
  ['root', 'verify-round12', 900],
  // round16 从清单里挪出：它的 ①②⑤（本地模型写 5200 字长文落盘）与 ⑥ 在**换回 HEAD 的 electron-main.ts + context-renderer.ts** 后同样红 ⇒ 第 21 轮遗留，不是本轮引入（见 docs/ROUND12-LEDGER.md 第 22 轮）
  ['root', 'verify-round16', 900], // KNOWN-RED-预存在
  ['root', 'verify-round17', 1200],
  ['root', 'verify-round18', 900],
  ['root', 'verify-round18b', 900],
  ['root', 'verify-round18c', 900],
  ['root', 'verify-round18d', 900],
  ['root', 'verify-round18e', 900],
  ['root', 'verify-round18f', 900],
  ['root', 'verify-round19', 900],
  ['root', 'verify-round20-team', 1500, ['--ollama']],
  ['root', 'verify-round27-live', 300],
  ['root', 'verify-round28-live', 1200],
  ['root', 'verify-round34-ui', 600],
  ['root', 'verify-round34-live', 2400],
  ['root', 'verify-round35-ui', 600],
  ['root', 'verify-ui-lag', 900],
  ['root', 'verify-click-lag', 900],
];

const QINGDAN0 = TIER === 'live' ? LIVE : FAST;
/** `--skip=verify-round16,verify-x` 把**已归因为预存在**的门禁暂时挪出清单（不改代码、只在日志里写明跳过原因） */
const SKIP = new Set((argv.find((a) => /^--skip=/.test(a)) || '').split('=')[1]?.split(',').filter(Boolean) || []);
const QINGDAN = QINGDAN0.filter(([, id]) => !SKIP.has(id));
for (const [, id] of QINGDAN0) if (SKIP.has(id)) console.log(`  · 跳过 ${id}（已归因，见 docs/HANDOFF-NEXT.md 遗留项）`);
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'GATE-MANIFEST.json'), 'utf8'));
const KNOWN_RED = new Set(manifest.entries.filter((e) => e.status === 'known-red').map((e) => e.id));

function luJing(where, id) {
  /** 第 37 轮：根级门禁已收进 `dev/gates/`（仓库整理），这里跟着走 */
  if (where === 'root') return path.join(root, 'dev', 'gates', id + '.mjs');
  if (where === 'spikes') return path.join(root, 'spikes', id + '.mjs');
  if (where === 'sync-protocol') return path.join(root, 'packages', 'sync-protocol', 'scripts', id + '.mjs');
  return path.join(root, 'packages', 'app-shell', 'scripts', id + '.mjs');
}

/**
 * **只清自己起的**：命令行里带 `--remote-debugging-port` 的 electron（真机门禁的调试壳）。
 * 用户的正式实例没有这个参数 ⇒ 绝不误杀。
 */
function qingChang() {
  try {
    const ps = 'Get-CimInstance Win32_Process -Filter "name=\'electron.exe\'" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress';
    const j = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', timeout: 60000 }));
    const arr = Array.isArray(j) ? j : [j];
    constkou = arr.filter((p) => /remote-debugging-port/.test(String(p.CommandLine || '')));
    for (const p of kou) {
      try { execFileSync('taskkill', ['/PID', String(p.ProcessId), '/T', '/F'], { encoding: 'utf8', timeout: 30000 }); } catch { /* 已经退了 */ }
    }
    return kou.length;
  } catch { return 0; }
}

/**
 * 有没有**用户自己的实例**在跑（没有 --remote-debugging-port、却加载了 electron-main.js）。
 *
 * 为什么要单独报：一批真机门禁（round12–19 等）**故意在真实 userData 上跑**（要验的就是真配置），
 * 而应用是"禁止多开"的：第二个实例拿到锁失败就立刻退出 ⇒ 调试端口根本起不来 ⇒
 * 日志里只有一句 "CDP not up"，看起来像产品坏了，其实是**用户的应用没关**。
 * 这里提前说清楚，别让下一个人去改代码找不存在的 bug。
 */
function yongHuShiLiZaiPao() {
  try {
    const ps = 'Get-CimInstance Win32_Process -Filter "name=\'electron.exe\'" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress';
    const j = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', timeout: 60000 }));
    const arr = Array.isArray(j) ? j : [j];
    const xiao = arr.filter((p) => /electron-main\.js/.test(String(p.CommandLine || '')) && !/remote-debugging-port/.test(String(p.CommandLine || '')));
    return xiao.map((p) => Number(p.ProcessId));
  } catch { return []; }
}

function ziJianAssetsFresh() {
  const zuiXin = (dir, exts, skip) => {
    let m = 0;
    if (!fs.existsSync(dir)) return m;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip && skip.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) m = Math.max(m, zuiXin(p, exts, skip));
      else if (exts.some((x) => e.name.endsWith(x))) m = Math.max(m, fs.statSync(p).mtimeMs);
    }
    return m;
  };
  const srcM = zuiXin(path.join(root, 'packages', 'app-shell', 'src'), ['.ts', '.cjs'], new Set(['renderer', 'i18n', 'assets']));
  const distM = zuiXin(path.join(root, 'packages', 'app-shell', 'dist'), ['.js', '.cjs', '.map'], null);
  const okRun = distM >= srcM;
  console.log(`  [${okRun ? 'PASS' : 'FAIL'}] verify-assets-fresh   dist=${new Date(distM).toISOString()} src=${new Date(srcM).toISOString()}`);
  return okRun;
}

function pao(where, id, extra, msLimit) {
  if (where === 'assets') return { ok: ziJianAssetsFresh(), ms: 0, tail: '' };
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [luJing(where, id), ...(extra || [])], {
    cwd: root, encoding: 'utf8', timeout: msLimit * 1000, maxBuffer: 64 * 1024 * 1024,
  });
  const out = String(r.stdout || '') + '\n' + String(r.stderr || '');
  /**
   * 尾巴里**优先挑失败行**：红的时候只截最后 3 行常常看不到"红在哪一条"
   * （本轮就有一次 verify-tool-calls 红，日志里只剩一句 FAILED，无法复盘）。
   */
  const hang = out.split('\n').filter((l) => l.trim());
  const shibai = hang.filter((l) => /FAIL|失败项|Error|崩溃|超时/i.test(l)).slice(0, 6);
  const wei = (shibai.length ? shibai : hang.slice(-3)).join(' | ').slice(0, 700);
  return { ok: r.status === 0, ms: Date.now() - t0, tail: wei, signal: r.signal || '' };
}

const results = [];
const yonghuPids = TIER === 'live' ? yongHuShiLiZaiPao() : [];
if (yonghuPids.length) {
  console.log(`\n⚠ 检测到**用户自己的应用实例**正在运行（PID ${yonghuPids.join(', ')}）。`);
  console.log('  应用禁止多开：真机门禁里那些"故意在真实 userData 上跑"的（round12–19、ui-lag、click-lag…）');
  console.log('  第二个实例拿不到单实例锁会立刻退出 ⇒ 调试端口起不来 ⇒ 只会报 "CDP not up"。');
  console.log('  这类失败在下面记为【环境阻塞】，不算产品红。**要真验这批，请先关闭应用再跑一遍。**');
}
for (let lun = 1; lun <= TIMES; lun++) {
  console.log(`\n######## 第 ${lun}/${TIMES} 遍 · tier=${TIER} ########`);
  let hong = 0, jzh = 0, que = 0;
  for (const [where, id, ms, extra] of QINGDAN) {
    if (where !== 'assets') {
      const f = luJing(where, id);
      if (!fs.existsSync(f)) { que++; console.log(`  [缺失] ${id}（${f}）`); continue; }
    }
    let qing = 0;
    if (TIER === 'live') qing = qingChang();
    if (qing) console.log(`  · 清场：收掉 ${qing} 个遗留调试实例`);
    const r = pao(where, id, extra, ms);
    if (TIER === 'live') qingChang();
    /** 用户实例占着真实 userData ⇒ 这类红不是产品红，单独记（别让人去修不存在的 bug） */
    const beiSuo = !r.ok && TIER === 'live' && yonghuPids.length > 0 && /CDP not up|no CDP/i.test(String(r.tail || ''));
    const biaoji = r.ok ? 'PASS' : KNOWN_RED.has(id) ? '已知红' : beiSuo ? '环境阻塞' : 'FAIL';
    if (!r.ok && !KNOWN_RED.has(id) && !beiSuo) hong++;
    if ((KNOWN_RED.has(id) || beiSuo) && !r.ok) jzh++;
    console.log(`  [${biaoji.padEnd(5)}] ${id.padEnd(32)} ${String(r.ms).padStart(8)}ms${r.ok ? '' : '  ' + r.tail}`);
    results.push({ lun, tier: TIER, id, ok: r.ok, knownRed: KNOWN_RED.has(id) || beiSuo, ms: r.ms });
  }
  console.log(`\n---- 第 ${lun} 遍汇总（tier=${TIER}）：真红 ${hong} · 已知红(环境依赖) ${jzh} · 缺文件 ${que} ----`);
  if ((hong || que) && !argv.includes('--keep-going')) { console.log('有红项 ⇒ 停止后续轮次（如实报，不硬凑第三遍）'); break; }
}
const zong = results.filter((r) => !r.ok && !r.knownRed).length;
const zongShu = results.length;
const beiSuoShu = TIER === 'live' && yonghuPids.length ? results.filter((r) => !r.ok && r.knownRed).length : 0;
const jieLun = zong === 0 ? '无产品红（' + zongShu + ' 项次）' : zong + ' 项红';
const zhuiJia = beiSuoShu ? ' · 另有 ' + beiSuoShu + ' 项被用户实例阻塞（关掉应用再跑才算真机全验）' : '';
console.log('\n=== run-verify-22 tier=' + TIER + '：' + TIMES + ' 遍 · ' + jieLun + zhuiJia + ' ===');
fs.writeFileSync(path.join(root, `verify-22-${TIER}-${TIMES}x.log`), results.map((r) => `${r.lun}\t${r.ok ? 'PASS' : 'FAIL'}\t${r.id}\t${r.ms}ms`).join('\n') + '\n', 'utf8');
process.exit(zong ? 1 : 0);
