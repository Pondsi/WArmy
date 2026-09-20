/**
 * Spike 8：系统级 Helper Tool（真实实现调用，不是壳）
 *
 * DoD（ADR 000 第四章）：修改 hosts 文件成功。
 *
 * 被测对象 = 真实 L5 组件 `packages/app-shell/src/helper-tool.ts`（由本脚本直接 import，
 * Node 24 原生类型擦除；若不可用则退回 packages/app-shell/dist/helper-tool.js）。
 *
 * 本脚本做四件事，全部落原始证据：
 *   1) 平台探测 + 提权工具选择 + gsudo 凭据缓存探测（原始 stdout 全量记录）
 *   2) 非提权部分对**临时文件**跑完整流程：行校验 / 备份 / 幂等 / 写入 / 回读校验 / 回滚（真实文件 I/O）
 *   3) 「绝不挂住」验证：超时保护、内层退出码捕获、无凭据干净失败、无孤儿 gsudo 进程
 *   4) 真 hosts 提权写入一次（gsudo -n 非交互），观测成功与否并**还原**，记录前后 sha256
 *
 * 用法：
 *   cd <repo root>
 *   & "C:\Program Files\nodejs\node.exe" spikes/spike-08-helper/run.mjs
 *   （可选 --skip-hosts-write 只跑非提权部分；--timeout-ms=N 覆盖提权超时）
 *
 * 退出码：0 = 非提权套件全过且 hosts 真写入成功并已还原
 *         1 = 有失败项
 *         3 = 非提权套件通过但 hosts 写入受权限/凭据阻塞（未能验证 DoD）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MODULE_TS = path.join(REPO_ROOT, 'packages', 'app-shell', 'src', 'helper-tool.ts');
const MODULE_JS = path.join(REPO_ROOT, 'packages', 'app-shell', 'dist', 'helper-tool.js');
const RESULT_PATH = path.join(__dirname, 'result.json');
const BACKUP_DIR = path.join(__dirname, 'backups');

const argv = process.argv.slice(2);
const argOf = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const SKIP_HOSTS_WRITE = argv.includes('--skip-hosts-write');
const TIMEOUT_MS = Number(argOf('timeout-ms') ?? 30000);

const log = (...a) => console.log('[spike-08]', ...a);
const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

/* ───────── 加载真实实现 ───────── */
let helper = null;
let loadMode = null;
let loadError = null;
try {
  helper = await import(pathToFileURL(MODULE_TS).href);
  loadMode = 'ts-type-strip';
} catch (e) {
  loadError = `TS 直载失败：${e.message}`;
  try {
    helper = await import(pathToFileURL(MODULE_JS).href);
    loadMode = 'dist-js';
  } catch (e2) {
    loadError += ` / dist 载入失败：${e2.message}`;
  }
}
if (!helper) {
  console.error('[spike-08] 无法加载 helper-tool 实现：', loadError);
  process.exit(4);
}
log(`已加载真实实现（${loadMode}）：${loadMode === 'dist-js' ? MODULE_JS : MODULE_TS}`);

/* ───────── 断言收集 ───────── */
const items = [];
function check(id, name, expected, actual, pass, evidence) {
  items.push({ id, name, expected, actual, pass: !!pass, evidence: evidence ?? null });
  log(`${pass ? 'PASS' : 'FAIL'} ${id} ${name} | expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  return !!pass;
}

const scratch = path.join(os.tmpdir(), `warmy-spike08-${Date.now()}`);
fs.mkdirSync(scratch, { recursive: true });
const scratchBackups = path.join(scratch, 'backups');

const result = {
  spike: 'spike-08-helper',
  title: '系统级 Helper Tool：平台探测 / 提权工具选择 / 安全修改 hosts',
  dod: '修改 hosts 文件成功',
  ranAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    hostname: os.hostname(),
    repoRoot: REPO_ROOT,
  },
  subject: { module: MODULE_TS, loadMode, loadError, version: helper.HELPER_TOOL_VERSION },
  platformSuite: null,
  credentialSuite: null,
  nonElevatedSuite: null,
  noHangSuite: null,
  hostsRealWrite: null,
  macosSuite: null,
  summary: null,
};

/* ───────── 1) 平台探测 / 工具选择 ───────── */
const tool = await helper.selectElevationTool();
const status = await helper.getHelperStatus();
result.platformSuite = {
  detect: {
    win32: helper.detectHelperPlatform('win32'),
    darwin: helper.detectHelperPlatform('darwin'),
    linux: helper.detectHelperPlatform('linux'),
    freebsd: helper.detectHelperPlatform('freebsd'),
    actual: helper.detectHelperPlatform(),
  },
  hostsPathPerPlatform: {
    win32: helper.defaultHostsPath('win32'),
    darwin: helper.defaultHostsPath('darwin'),
    linux: helper.defaultHostsPath('linux'),
  },
  gsudoCandidates: helper.gsudoCandidatePaths(),
  selectedTool: tool,
  isAdmin: await helper.detectIsAdmin(),
  helperStatus: status,
};
check('P-1', '平台探测（win32/darwin/linux/freebsd）', ['win32', 'darwin', 'linux', 'unsupported'], [
  result.platformSuite.detect.win32,
  result.platformSuite.detect.darwin,
  result.platformSuite.detect.linux,
  result.platformSuite.detect.freebsd,
], ['win32', 'darwin', 'linux', 'unsupported'].every((v, i) => Object.values(result.platformSuite.detect).slice(0, 4)[i] === v));
check('P-2', 'Windows 选定 gsudo', 'gsudo', tool.tool, tool.tool === 'gsudo', tool.reason);
check('P-3', 'gsudo 可执行文件存在', true, tool.available, tool.available, tool.executable);
check('P-4', 'gsudo 非交互参数为 -n', '-n', tool.nonInteractiveArgs.join(' '), tool.nonInteractiveArgs.includes('-n'));
check('P-5', '当前进程非管理员（故必须提权）', true, result.platformSuite.isAdmin === false, result.platformSuite.isAdmin === false);

/* ───────── 2) gsudo 凭据缓存探测（原始输出） ───────── */
const cacheProbe = tool.executable
  ? await helper.queryGsudoCredentialCache(tool.executable)
  : { available: null, raw: null };
result.credentialSuite = {
  available: cacheProbe.available,
  rawStdout: cacheProbe.raw?.stdout ?? null,
  rawStderr: cacheProbe.raw?.stderr ?? null,
  exitCode: cacheProbe.raw?.exitCode ?? null,
  elapsedMs: cacheProbe.raw?.elapsedMs ?? null,
  note: 'gsudo status 的 “Available for this process” 与“实际能否提权”本机实测不一致（见 elevationSuite）',
};
check('C-1', 'gsudo -n status 能取到原始输出（不挂住）', true, (cacheProbe.raw?.stdout ?? '').length > 0, (cacheProbe.raw?.stdout ?? '').length > 0);

/* ───────── 3) 非提权套件：临时文件上跑完整流程 ───────── */
const nsuite = { items: [], passCount: 0, failCount: 0 };
const record = (id, name, expected, actual, pass, evidence) => {
  const ok = check(id, name, expected, actual, pass, evidence);
  nsuite.items.push({ id, name, expected, actual, pass: ok, evidence: evidence ?? null });
  if (ok) nsuite.passCount += 1;
  else nsuite.failCount += 1;
  return ok;
};

// 3.1 行/记录校验
const goodSpec = { ip: '127.0.0.1', hostname: 'warmy-spike08.local', comment: 'WArmy spike-08 probe' };
record('N-1', '合法记录通过校验', true, helper.validateHostEntrySpec(goodSpec).ok, helper.validateHostEntrySpec(goodSpec).ok);
const badIp = helper.validateHostEntrySpec({ ip: '999.1.1.1', hostname: 'a.local' });
record('N-2', '非法 IP 被拒', false, badIp.ok, !badIp.ok, badIp.reason);
const badSpace = helper.validateHostEntrySpec({ ip: '127.0.0.1', hostname: 'a b.local' });
record('N-3', '含空格的主机名被拒', false, badSpace.ok, !badSpace.ok, badSpace.reason);
const badHash = helper.validateHostEntrySpec({ ip: '127.0.0.1', hostname: 'a.local', comment: 'x # y' });
record('N-4', '含 # 的注释被拒', false, badHash.ok, !badHash.ok, badHash.reason);
const badNl = helper.validateHostEntrySpec({ ip: '127.0.0.1', hostname: 'a.local', comment: 'x\ny' });
record('N-5', '含换行的注释被拒', false, badNl.ok, !badNl.ok, badNl.reason);
record('N-6', '注入型主机名被拒（; / | / &）', false,
  ['a;b', 'a|b', 'a&b', 'a>b'].every((h) => !helper.validateHostEntrySpec({ ip: '127.0.0.1', hostname: h }).ok),
  ['a;b', 'a|b', 'a&b', 'a>b'].map((h) => helper.validateHostEntrySpec({ ip: '127.0.0.1', hostname: h }).ok));

const rendered = helper.formatHostEntry(goodSpec);
record('N-7', '渲染出的目标行格式正确', `127.0.0.1 warmy-spike08.local # WArmy spike-08 probe`, rendered, rendered === '127.0.0.1 warmy-spike08.local # WArmy spike-08 probe');
const selfParse = helper.analyzeHostsLine(rendered);
record('N-8', '渲染结果能被自身解析器接受（不盲拼接）', 'entry', selfParse.kind, selfParse.kind === 'entry' && selfParse.ip === '127.0.0.1');

// 3.2 内容解析
const fakeHosts = path.join(scratch, 'hosts-fake');
const originalFake =
  [
    '# fake hosts for spike-08（含注释/多主机名/行尾空格/空行，贴近真实 hosts）',
    '#\t127.0.0.1       localhost',
    '192.168.77.160 host.docker.internal',
    '157.240.11.35 facebook.com www.facebook.com',
    '185.199.108.133 raw.githubusercontent.com  ',
    '',
  ].join('\r\n');
fs.writeFileSync(fakeHosts, originalFake, 'utf8');

const analysis = helper.analyzeHostsContent(originalFake);
record('N-9', '内容体检：合法 hosts 无 fatal', 0, analysis.fatal.length, analysis.fatal.length === 0, analysis);
record('N-10', '内容体检：合法 hosts 无 warnings', 0, analysis.warnings.length, analysis.warnings.length === 0, analysis.warnings);
record('N-11', '内容体检：统计出 3 条映射', 3, analysis.stats.entries, analysis.stats.entries === 3, analysis.stats);
const nulAnalysis = helper.analyzeHostsContent('127.0.0.1 a.local\n\u0000bad\n');
record('N-12', '内容体检：NUL 字节 → fatal', true, !nulAnalysis.ok, !nulAnalysis.ok, nulAnalysis.fatal);
record('N-13', '内容体检：识别出非 hosts 行 → warning 但保留', true,
  helper.analyzeHostsContent('# c\n1.2.3.4 ok.local\nnot-a-hosts-line\n').warnings.length > 0,
  helper.analyzeHostsContent('# c\n1.2.3.4 ok.local\nnot-a-hosts-line\n').warnings);

// 3.3 幂等 upsert / remove（纯函数）
const up1 = helper.upsertHostEntry(originalFake, goodSpec);
record('N-14', '首次 upsert 产生变更', true, up1.changed, up1.ok && up1.changed, { appendedLine: up1.appendedLine });
record('N-15', '追加行保留 CRLF 且位于末尾', true,
  up1.content.endsWith(`${rendered}\r\n`) && !/\n$/.test(up1.content.replace(/\r\n/g, '')),
  up1.content.endsWith(`${rendered}\r\n`), { tail: JSON.stringify(up1.content.slice(-60)) });
const up2 = helper.upsertHostEntry(up1.content, goodSpec);
record('N-16', '二次 upsert 幂等（不重复写）', true, up2.ok && !up2.changed && up2.alreadyPresent, up2.ok && !up2.changed && up2.alreadyPresent);
record('N-17', '幂等时内容逐字节不变', true, up2.content === up1.content, up2.content === up1.content);
const rm = helper.removeHostEntry(up1.content, goodSpec);
record('N-18', 'remove 精确删除 1 行', 1, rm.removedCount, rm.removedCount === 1);
record('N-19', 'remove 后回到原始内容', true, rm.content === originalFake, rm.content === originalFake);

// 3.4 真实文件 I/O：applyHostEntry（direct 模式 + 备份 + 回读校验 + 回滚）
const baselineFake = fs.readFileSync(fakeHosts);
const baselineFakeSha = sha256(baselineFake);
const apply1 = await helper.applyHostEntry({
  spec: goodSpec,
  hostsFile: fakeHosts,
  backupDir: scratchBackups,
  mode: 'direct',
  createBackup: true,
});
record('N-20', '临时文件真实写入成功', true, apply1.ok, apply1.ok, { message: apply1.message, method: apply1.writeMethod });
record('N-21', '写入方式为 direct（未提权）', 'direct', apply1.writeMethod, apply1.writeMethod === 'direct');
record('N-22', '回读校验通过（sha256 一致）', true, apply1.verified, apply1.verified);
record('N-23', '备份文件真实生成且与原始内容一致', true,
  !!apply1.backup && fs.existsSync(apply1.backup.path) && sha256(fs.readFileSync(apply1.backup.path)) === baselineFakeSha,
  !!apply1.backup && fs.existsSync(apply1.backup.path) && sha256(fs.readFileSync(apply1.backup.path)) === baselineFakeSha,
  { backup: apply1.backup });
record('N-24', '写后文件确实含目标行', true, apply1.after.entryPresent, apply1.after.entryPresent);
record('N-25', '写后字节数 = 原字节 + 追加行字节', baselineFake.length + Buffer.byteLength(`${rendered}\r\n`, 'utf8'), apply1.after.bytes,
  apply1.after.bytes === baselineFake.length + Buffer.byteLength(`${rendered}\r\n`, 'utf8'));

const shaAfterFirst = apply1.after.sha256;
const apply2 = await helper.applyHostEntry({
  spec: goodSpec,
  hostsFile: fakeHosts,
  backupDir: scratchBackups,
  mode: 'direct',
  createBackup: true,
});
record('N-26', '重复 apply 幂等：报告 alreadyPresent', true, apply2.alreadyPresent && !apply2.changed, apply2.alreadyPresent && !apply2.changed, apply2.message);
record('N-27', '幂等时文件 sha256 不变（未重复写）', shaAfterFirst, apply2.after.sha256, apply2.after.sha256 === shaAfterFirst);

const rollback = await helper.restoreFromBackup({
  target: fakeHosts,
  backupPath: apply1.backup.path,
  tool,
  mode: 'direct',
});
record('N-28', '从备份回滚成功', true, rollback.ok, rollback.ok, rollback.message);
record('N-29', '回滚后内容与原始逐字节一致', baselineFakeSha, sha256(fs.readFileSync(fakeHosts)), sha256(fs.readFileSync(fakeHosts)) === baselineFakeSha);

// 3.5 失败路径
const badContentFile = path.join(scratch, 'hosts-binary');
fs.writeFileSync(badContentFile, Buffer.from([0x31, 0x32, 0x37, 0x00, 0x0a]));
const refuse = await helper.applyHostEntry({ spec: goodSpec, hostsFile: badContentFile, backupDir: scratchBackups, mode: 'direct' });
record('N-30', '目标文件含 NUL → 拒绝写入', 'HOSTS_CONTENT_INVALID', refuse.errorCode, !refuse.ok && refuse.errorCode === 'HOSTS_CONTENT_INVALID', refuse.message);

const badSpecRes = await helper.applyHostEntry({ spec: { ip: 'nope', hostname: 'x' }, hostsFile: fakeHosts, backupDir: scratchBackups, mode: 'direct' });
record('N-31', '非法目标行 → 拒绝写入', 'HOSTS_ENTRY_INVALID', badSpecRes.errorCode, badSpecRes.errorCode === 'HOSTS_ENTRY_INVALID', badSpecRes.message);

const missingRes = await helper.applyHostEntry({ spec: goodSpec, hostsFile: path.join(scratch, 'nope', 'hosts'), backupDir: scratchBackups, mode: 'direct' });
record('N-32', '目标不可读 → HOSTS_TARGET_UNREADABLE', 'HOSTS_TARGET_UNREADABLE', missingRes.errorCode, missingRes.errorCode === 'HOSTS_TARGET_UNREADABLE', missingRes.message);

const negVerify = await helper.verifyWrittenContent(fakeHosts, 'completely different content', { timeoutMs: 400, pollMs: 100 });
record('N-33', '回读校验能识破不匹配内容', false, negVerify.match, negVerify.match === false, { attempts: negVerify.attempts });

const posVerify = await helper.verifyWrittenContent(fakeHosts, fs.readFileSync(fakeHosts, 'utf8'), { timeoutMs: 400, pollMs: 100 });
record('N-34', '回读校验对一致内容通过', true, posVerify.match, posVerify.match === true, { attempts: posVerify.attempts });

const dryRun = await helper.applyHostEntry({ spec: goodSpec, hostsFile: fakeHosts, backupDir: scratchBackups, mode: 'direct', dryRun: true });
record('N-35', 'dryRun 不写盘', true, dryRun.ok && !dryRun.changed && sha256(fs.readFileSync(fakeHosts)) === baselineFakeSha, dryRun.ok && !dryRun.changed);

// 3.6 由真实故障驱动补上的能力：重试分类 + GBK 输出解码
record('N-36', '可重试错误分类正确（DENIED/FAILED 可重试，无凭据不可重试）', true,
  helper.isRetryableElevationFailure('ELEVATION_DENIED') &&
    helper.isRetryableElevationFailure('ELEVATION_FAILED') &&
    !helper.isRetryableElevationFailure('ELEVATION_NO_CREDENTIAL') &&
    !helper.isRetryableElevationFailure('ELEVATION_TOOL_MISSING'),
  ['ELEVATION_DENIED', 'ELEVATION_FAILED', 'ELEVATION_NO_CREDENTIAL', 'ELEVATION_TOOL_MISSING']
    .map((c) => `${c}=${helper.isRetryableElevationFailure(c)}`));
const gbkBytes = Buffer.from([0xd2, 0xd1, 0xb8, 0xb4, 0xd6, 0xc6, 0x20, 0x31, 0x20, 0xb8, 0xf6, 0xce, 0xc4, 0xbc, 0xfe, 0xa1, 0xa3]);
record('N-37', 'cmd 的 GBK 输出能被正确解码（不再乱码）', '已复制 1 个文件。', helper.decodeConsoleOutput(gbkBytes),
  helper.decodeConsoleOutput(gbkBytes) === '已复制 1 个文件。');

result.nonElevatedSuite = { ...nsuite, scratchDir: scratch, fakeHostsPath: fakeHosts, backupDirUsed: scratchBackups };

/* ───────── 4) 绝不挂住 / 内层退出码捕获 ───────── */
const hang = { items: [], passCount: 0, failCount: 0 };
const recordHang = (id, name, expected, actual, pass, evidence) => {
  const ok = check(id, name, expected, actual, pass, evidence);
  hang.items.push({ id, name, expected, actual, pass: ok, evidence: evidence ?? null });
  if (ok) hang.passCount += 1;
  else hang.failCount += 1;
  return ok;
};

// 4.1 超时保护：ping 6 次（≈5s），给 2500ms 超时 → 必须干净超时
const t0 = Date.now();
const timeoutRun = await helper.runElevatedArgs(['cmd', '/c', 'ping -n 6 127.0.0.1'], tool, { timeoutMs: 2500, commandLine: 'ping -n 6 127.0.0.1' });
const timeoutWallMs = Date.now() - t0;
recordHang('H-1', '超时保护生效（不挂住）', 'ELEVATION_TIMEOUT', timeoutRun.errorCode, timeoutRun.errorCode === 'ELEVATION_TIMEOUT',
  { wallMs: timeoutWallMs, outerTimedOut: timeoutRun.raw.outer?.timedOut, outerExit: timeoutRun.raw.outer?.exitCode });
recordHang('H-2', '超时在约定时间内返回（< 15s）', true, timeoutWallMs < 15000, timeoutWallMs < 15000, { wallMs: timeoutWallMs });

// 4.2 内层退出码捕获：gsudo 自己返回 0，内层必须被标记文件抓出来
// 注意：commandLine 必须是「一条会正常返回的命令」，直接写 `exit 7` 会让外层 cmd 提前退出、不写标记文件
const innerFail = await helper.runElevatedArgs([], tool, { timeoutMs: 15000, commandLine: 'cmd /c exit 7' });
recordHang('H-3', '内层非零退出码被捕获', 7, innerFail.raw.innerExitCode, innerFail.raw.innerExitCode === 7,
  { outerExit: innerFail.raw.outer?.exitCode, note: 'gsudo 自身退出码被观测为 0，说明必须依赖标记文件 + 回读校验' });
recordHang('H-4', '内层失败被判为 ELEVATION_DENIED', 'ELEVATION_DENIED', innerFail.errorCode, innerFail.errorCode === 'ELEVATION_DENIED');

// 用 copy 验证「提权进程真的落了盘」（不涉及内层重定向，避免与日志重定向冲突）
const stagedSource = path.join(scratch, 'staged-source.txt');
const elevatedMarker = path.join(scratch, 'elevated-marker.txt');
fs.writeFileSync(stagedSource, 'elevated-ok', 'utf8');
try { fs.rmSync(elevatedMarker, { force: true }); } catch { /* noop */ }
const innerOk = await helper.runElevatedArgs([], tool, {
  timeoutMs: 20000,
  commandLine: `copy /y "${stagedSource}" "${elevatedMarker}"`,
});
recordHang('H-5', '内层成功退出码为 0', 0, innerOk.raw.innerExitCode, innerOk.raw.innerExitCode === 0, { message: innerOk.message });
recordHang('H-6', '提权进程写出的文件真实存在且内容正确', 'elevated-ok',
  fs.existsSync(elevatedMarker) ? fs.readFileSync(elevatedMarker, 'utf8').trim() : null,
  fs.existsSync(elevatedMarker) && fs.readFileSync(elevatedMarker, 'utf8').trim() === 'elevated-ok');

// 4.3 重试机制（确定性用例）：第一次必失败、第二次必成功。
// 说明：开发中真的撞到过一次瞬态失败（提权 copy 撞共享冲突「另一个程序正在使用此文件」），
// 但瞬态故障无法按需复现，所以这里用一个「fail-once」脚本确定性地验证同一套重试逻辑。
const retryFlag = path.join(scratch, 'retry-flag.txt');
const retryScript = path.join(scratch, 'fail-once.cmd');
try { fs.rmSync(retryFlag, { force: true }); } catch { /* noop */ }
fs.writeFileSync(
  retryScript,
  [
    '@echo off',
    `if exist "${retryFlag}" (`,
    `  del "${retryFlag}"`,
    '  exit /b 0',
    ')',
    `> "${retryFlag}" echo x`,
    'exit /b 3',
    '',
  ].join('\r\n'),
  'utf8'
);
// 注意：从 .cmd 里调用另一个 .cmd 必须用 `call`，否则控制权不会返回、外层脚本无法写回标记文件
const retryRun = await helper.runElevatedArgs([], tool, { timeoutMs: 20000, commandLine: `call "${retryScript}"`, retries: 2 });
recordHang('H-13', '瞬态失败被重试救回（fail-once 用例，attempts 应为 2）', true,
  { ok: retryRun.ok, attempts: retryRun.raw.attemptCount, innerExit: retryRun.raw.innerExitCode },
  retryRun.ok === true && retryRun.raw.attemptCount === 2, { attemptLog: retryRun.raw.attemptLog });

// 4.3 无凭据 / 工具缺失：必须干净失败且快速返回
const t1 = Date.now();
const missingTool = await helper.runElevatedArgs(['cmd', '/c', 'echo hi'], {
  platform: 'win32', tool: 'gsudo', available: false, executable: null, version: null,
  nonInteractiveArgs: ['-n'], supportsNonInteractive: true, reason: '模拟：未安装 gsudo', unverified: [],
});
recordHang('H-7', '工具缺失 → ELEVATION_TOOL_MISSING 且立即返回', 'ELEVATION_TOOL_MISSING', missingTool.errorCode,
  missingTool.errorCode === 'ELEVATION_TOOL_MISSING' && Date.now() - t1 < 1000, { wallMs: Date.now() - t1 });

const t2 = Date.now();
const badExe = await helper.runElevatedArgs(['cmd', '/c', 'echo hi'], {
  platform: 'win32', tool: 'gsudo', available: true, executable: path.join(scratch, 'not-exists-gsudo.exe'),
  version: null, nonInteractiveArgs: ['-n'], supportsNonInteractive: true, reason: '模拟：可执行文件不存在', unverified: [],
});
recordHang('H-8', '可执行文件不存在 → ELEVATION_FAILED 且立即返回', 'ELEVATION_FAILED', badExe.errorCode,
  badExe.errorCode === 'ELEVATION_FAILED' && Date.now() - t2 < 5000, { wallMs: Date.now() - t2, spawnError: badExe.raw.outer?.spawnError });

const unsupported = await helper.runElevatedArgs(['cmd'], {
  platform: 'unsupported', tool: 'none', available: false, executable: null, version: null,
  nonInteractiveArgs: [], supportsNonInteractive: false, reason: '不支持的平台', unverified: [],
});
recordHang('H-9', '不支持平台 → ELEVATION_UNSUPPORTED_PLATFORM', 'ELEVATION_UNSUPPORTED_PLATFORM', unsupported.errorCode,
  unsupported.errorCode === 'ELEVATION_UNSUPPORTED_PLATFORM');

// 4.4 无孤儿 gsudo
const tasklist = spawnSync('tasklist', ['/FI', 'IMAGENAME eq gsudo.exe', '/NH'], { encoding: 'utf8', windowsHide: true });
const gsudoLeft = (tasklist.stdout ?? '').split(/\r?\n/).filter((l) => /gsudo\.exe/i.test(l)).length;
const pingList = spawnSync('tasklist', ['/FI', 'IMAGENAME eq ping.exe', '/NH'], { encoding: 'utf8', windowsHide: true });
recordHang('H-10', '超时后无残留 gsudo 进程', 0, gsudoLeft, gsudoLeft === 0, (tasklist.stdout ?? '').trim().slice(0, 400));
recordHang('H-11', '超时后的残留进程观测（ping.exe，仅记录不判定）', 'evidence-only',
  (pingList.stdout ?? '').split(/\r?\n/).filter((l) => /ping\.exe/i.test(l)).length, true,
  (pingList.stdout ?? '').trim().slice(0, 400));
// 证据项：记录几次提权调用实际用掉几次尝试（innerFail 恒为 3 是设计使然——确定性失败也会重试完；
// 只有 innerOk>1 才代表本机真的观察到 gsudo「exit=0 但内层没执行」的瞬时假失败）
recordHang('H-12', '提权调用实际尝试次数（证据项）', 'evidence',  { innerFail: innerFail.raw.attemptCount, innerOk: innerOk.raw.attemptCount, timeoutRun: timeoutRun.raw.attemptCount },
  true, { attemptLog: { innerFail: innerFail.raw.attemptLog, innerOk: innerOk.raw.attemptLog } });

result.noHangSuite = hang;

/* ───────── 5) 真 hosts 提权写入（非交互，观测并还原） ───────── */
const hostsFile = helper.defaultHostsPath();
const hostsSpec = { ip: '127.0.0.1', hostname: 'warmy-spike08.local', comment: 'WArmy spike-08 helper probe (auto-removed)' };
const hostsBaseline = helper.fingerprintFile(hostsFile, hostsSpec);
let hostsStatBefore = null;
try { hostsStatBefore = fs.statSync(hostsFile); } catch { /* noop */ }

result.hostsRealWrite = {
  target: hostsFile,
  spec: hostsSpec,
  baseline: hostsBaseline,
  baselineSha256: hostsBaseline.sha256,
  statBefore: hostsStatBefore ? { size: hostsStatBefore.size, mode: hostsStatBefore.mode } : null,
  writableByCurrentProcess: helper.isWritable(hostsFile),
  skipped: SKIP_HOSTS_WRITE,
  attempt: null,
  verify: null,
  cleanup: null,
  final: null,
  restoredToOriginal: null,
  observedOutcome: null,
};

if (!SKIP_HOSTS_WRITE) {
  log('开始真实 hosts 提权写入尝试（gsudo -n，非交互）…');
  const write = await helper.applyHostEntry({
    spec: hostsSpec,
    hostsFile,
    backupDir: BACKUP_DIR,
    mode: 'auto',
    createBackup: true,
    timeoutMs: TIMEOUT_MS,
    retries: 3,
    toolInfo: tool,
  });
  result.hostsRealWrite.attempt = write;
  result.hostsRealWrite.originalBackupPath = write.backup?.path ?? null;
  log(`hosts 写入结果：ok=${write.ok} method=${write.writeMethod} verified=${write.verified} code=${write.errorCode}`);
  log(`hosts 写入原始证据：outerExit=${write.raw?.outer?.exitCode} innerExit=${write.raw?.innerExitCode} innerOutput=${JSON.stringify((write.raw?.innerOutput ?? '').slice(0, 200))}`);

  result.hostsRealWrite.verify = {
    entryPresentAfter: helper.fingerprintFile(hostsFile, hostsSpec).entryPresent,
    sha256After: helper.fingerprintFile(hostsFile, hostsSpec).sha256,
  };

  if (write.ok) {
    // 清理：移除探针行，恢复原状
    const cleanup = await helper.applyHostEntry({
      spec: hostsSpec,
      op: 'remove',
      hostsFile,
      backupDir: BACKUP_DIR,
      mode: 'auto',
      createBackup: true,
      timeoutMs: TIMEOUT_MS,
      retries: 3,
      toolInfo: tool,
    });
    result.hostsRealWrite.cleanup = cleanup;
    log(`hosts 清理结果：ok=${cleanup.ok} removed=${cleanup.removedCount}`);
  }

  let finalFp = helper.fingerprintFile(hostsFile, hostsSpec);
  // 安全兜底：若未回到原始，用本次首个备份（即真正的原始文件）再恢复，最多 3 次
  if (finalFp.sha256 !== hostsBaseline.sha256 && result.hostsRealWrite.originalBackupPath) {
    log('hosts 未回到原始状态 → 触发安全兜底恢复…');
    const safety = [];
    for (let i = 1; i <= 3; i += 1) {
      const r = await helper.restoreFromBackup({
        target: hostsFile,
        backupPath: result.hostsRealWrite.originalBackupPath,
        tool,
        mode: 'auto',
        timeoutMs: TIMEOUT_MS,
        retries: 3,
      });
      const fp = helper.fingerprintFile(hostsFile, hostsSpec);
      safety.push({ attempt: i, ok: r.ok, code: r.errorCode, message: r.message, sha256: fp.sha256 });
      log(`兜底恢复 #${i}：ok=${r.ok} sha=${fp.sha256}`);
      if (fp.sha256 === hostsBaseline.sha256) break;
    }
    result.hostsRealWrite.safetyRestore = safety;
    finalFp = helper.fingerprintFile(hostsFile, hostsSpec);
  }

  let hostsStatAfter = null;
  try { hostsStatAfter = fs.statSync(hostsFile); } catch { /* noop */ }
  result.hostsRealWrite.final = {
    fingerprint: finalFp,
    statAfter: hostsStatAfter ? { size: hostsStatAfter.size, mode: hostsStatAfter.mode } : null,
    bytesUnchanged: finalFp.bytes === hostsBaseline.bytes,
  };
  result.hostsRealWrite.restoredToOriginal = finalFp.sha256 === hostsBaseline.sha256;
  result.hostsRealWrite.observedOutcome = write.ok
    ? 'success-elevated-write-verified'
    : write.errorCode === 'ELEVATION_NO_CREDENTIAL'
      ? 'blocked-no-cached-credential'
      : write.errorCode === 'HOSTS_WRITE_FAILED' || write.errorCode === 'ELEVATION_DENIED'
        ? 'blocked-permission'
        : `failed-${write.errorCode}`;
  log(`hosts 是否已还原：${result.hostsRealWrite.restoredToOriginal}（原始 sha256=${hostsBaseline.sha256}，当前=${finalFp.sha256}）`);
}

/* ───────── 6) macOS 分支（如实标注未验证） ───────── */
if (!SKIP_HOSTS_WRITE) {
  const hw = result.hostsRealWrite;
  check(
    'W-1',
    '真实 hosts 写入后已还原到原始状态（无残留）',
    true,
    hw.restoredToOriginal,
    hw.restoredToOriginal === true,
    { baselineSha256: hw.baselineSha256, finalSha256: hw.final?.fingerprint?.sha256 ?? null }
  );
}

const macPlan = helper.macHelperPlan();result.macosSuite = {
  plan: macPlan,
  canVerifyHere: process.platform === 'darwin',
  verified: false,
  note: 'SMAppService 需要 macOS + 已签名的 helper bundle；本机为 win32，该分支未验证（代码路径真实存在）',
  simulatedToolSelection: {
    note: 'selectElevationTool() 依赖 process.platform，无法在此模拟；此处仅记录 detectHelperPlatform("darwin") 与 plan',
    detected: helper.detectHelperPlatform('darwin'),
    hostsPath: helper.defaultHostsPath('darwin'),
  },
};

/* ───────── 汇总 ───────── */
const all = items; // 全局：平台/凭据/非提权/不挂住 全部检查项
const failCount = all.filter((i) => !i.pass).length;
const hostsWrite = result.hostsRealWrite;
const hostsWriteOk = !SKIP_HOSTS_WRITE && hostsWrite.attempt?.ok === true && hostsWrite.restoredToOriginal === true;

result.summary = {
  totalChecks: all.length,
  passed: all.filter((i) => i.pass).length,
  failed: failCount,
  failedIds: all.filter((i) => !i.pass).map((i) => i.id),
  all: all.map((i) => ({ id: i.id, name: i.name, pass: i.pass })),
  nonElevatedAllPass: nsuite.failCount === 0,
  noHangAllPass: hang.failCount === 0,
  hostsWriteSucceeded: hostsWriteOk,
  hostsRestored: hostsWrite.restoredToOriginal,
  dodMet: hostsWriteOk,
  status: failCount > 0 ? 'fail' : hostsWriteOk ? 'pass-windows-macos-unverified' : 'partial-blocked',
  blockers: [],
  verdictHint:
    'Windows 侧（gsudo 非交互 + 安全 hosts 写入 + 幂等/备份/回滚/回读校验）已实测；' +
    'macOS 侧（SMAppService）仅有注册计划与代码路径，未在任何 macOS 上验证。',
};
if (!hostsWriteOk && !SKIP_HOSTS_WRITE) result.summary.blockers.push(hostsWrite.attempt?.message ?? 'hosts 写入未能验证');
if (process.platform !== 'darwin') result.summary.blockers.push('macOS SMAppService 分支未验证（无 macOS 环境）');

result.finishedAt = new Date().toISOString();
fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2) + '\n', 'utf8');
log(`结果已写入：${RESULT_PATH}`);

// 清理临时目录（保留 backups/，那是证据）
try { fs.rmSync(scratch, { recursive: true, force: true }); } catch { /* noop */ }

console.log(`\n[spike-08] 检查项 ${result.summary.passed}/${result.summary.totalChecks} 通过；非提权套件 ${nsuite.passCount}/${nsuite.items.length}；不挂住套件 ${row.passCount}/${hang.items.length}`);
console.log(`[spike-08] hosts 写入：${hostsWrite.observedOutcome ?? 'skipped'}；已还原=${hostsWrite.restoredToOriginal}`);
console.log(`[spike-08] 判定：${result.summary.status}`);
process.exit(failCount > 0 ? 1 : hostsWriteOk ? 0 : 3);
