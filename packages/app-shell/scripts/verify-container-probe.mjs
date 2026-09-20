/**
 * ADR 004 P1：**真机**执行环境探测器验收（不经过 Electron、不经过预览桩）。
 *
 * 为什么单独一个脚本：桌面端 UI 验收（verify-net-ui.mjs）跑的是**浏览器预览桩**，
 * 那里的探测结果是注入的 —— 它证明 UI 逻辑，但**证明不了**"本机真的是什么状态"。
 * 这个脚本直接 import 编译产物 `dist/container-probe.js`，在**这台机器上真跑一遍**：
 *   · 三态必须分得开（本机实测：docker = 已安装未运行；wsl = 有命令但没有发行版）；
 *   · 未安装的候选必须如实报 not-installed；
 *   · 平台不适用 / 一次性 VM / 隔离级别 的能力声明必须诚实（不许把 VM 说成容器引擎）；
 *   · 启停能力必须与事实一致（WSL / Windows Sandbox **不给**启停按钮）；
 *   · 探测必须便宜（不挂住 UI）、有并发上限、可缓存；
 *   · `runContainerAction` **只接受预定义 id + 'start'|'stop'**（不接受任意命令字符串）。
 *
 * ⚠️ 本脚本**不会**真的启动/停止任何容器引擎（那会改变用户环境）。
 *    它只验证"按钮出现所依赖的事实、参数校验、二次确认文案键"，真实启停标为未验证。
 *
 *   node packages/app-shell/scripts/verify-container-probe.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const distFile = path.join(selfDir, '..', 'dist', 'container-probe.js');
const i18nDir = path.join(selfDir, '..', 'src', 'i18n');

if (!fs.existsSync(distFile)) {
  console.error('[container-probe] 找不到编译产物，请先构建：dist/container-probe.js');
  process.exit(3);
}
const mod = await import(new URL('file://' + distFile.replace(/\\/g, '/')).href);
const {
  probeContainerRuntimes,
  runContainerAction,
  CONTAINER_RUNTIME_SPECS,
  containerRuntimeSpec,
  CONTAINER_SHELL_ACTIONS,
  CONTAINER_SHELL_MAX_DATA,
  CONTAINER_SHELL_SECURITY,
  containerShellGate,
  projectReasonKey,
  deriveProjectState,
  normalizeContainerShellRequest,
  projectUnavailableRefusal,
  CONTAINER_BASE_IMAGES,
  CONTAINER_NODE_NEEDED_CASES,
  CONTAINER_EXECUTOR_LOCATION,
  CONTAINER_IMAGE_STACKS,
  classifyActionResult,
  actionNeedsInstallHint,
  envSolidifyCapability,
  engineOsModeOf,
  shouldSolidifyAt,
  solidifyRetention,
  SOLIDIFY_COALESCE_MS,
  SOLIDIFY_KEEP,
} = mod;

const results = [];
let failures = 0;
function ok(cond, label, detail) {
  const pass = !!cond;
  if (!pass) failures++;
  results.push({ pass, label, detail: detail === undefined ? null : String(detail) });
  console.log((pass ? '  PASS ' : '  FAIL ') + label + (detail === undefined || detail === null ? '' : '  [' + String(detail).slice(0, 300) + ']'));
  return pass;
}
function section(title) {
  console.log('\n=== ' + title + ' ===');
}
const ZH = JSON.parse(fs.readFileSync(path.join(i18nDir, 'zh-CN.json'), 'utf8'));
const EN = JSON.parse(fs.readFileSync(path.join(i18nDir, 'en-US.json'), 'utf8'));

/* ── 1. 真机探测 ── */
section('1. 真机探测（12 个候选）');
const t0 = Date.now();
const report = await probeContainerRuntimes({ cacheMs: 0, perProbeTimeoutMs: 5000, concurrency: 4 });
const wallMs = Date.now() - t0;
console.log(JSON.stringify(report, null, 1));

ok(report.ok === true, '1-1 探测返回结构化报告（ok=true）');
ok(report.runtimes.length === 12, '1-2 候选运行时 12 个（ADR §3.1 清单）', 'n=' + report.runtimes.length);
ok(report.runtimes.length === CONTAINER_RUNTIME_SPECS.length, '1-2b 与静态目录逐条对齐', CONTAINER_RUNTIME_SPECS.length);
const ids = report.runtimes.map((r) => r.id);
const wantIds = ['docker', 'podman', 'wsl', 'nerdctl', 'rancher-desktop', 'colima', 'lima', 'windows-sandbox', 'lxd-incus', 'isulad', 'pouch', 'kata'];
ok(wantIds.every((w) => ids.includes(w)), '1-2c 12 个 id 与 ADR 清单一致（含国内外运行时）', JSON.stringify(ids));
ok(report.runtimes.every((r) => typeof r.probeMs === 'number'), '1-3 每条都带探测耗时（可诊断慢探测）');
ok(wallMs < 25000, '1-4 整轮探测在本机 < 25s（不挂住 UI；本机实测毫秒级）', wallMs + 'ms');

/* ── 2. 三态必须分得开（本机的真实结论）── */
section('2. 三态（本机真实结论）');
const by = Object.fromEntries(report.runtimes.map((r) => [r.id, r]));

const docker = by.docker;
ok(!!docker, '2-0 有 docker 一行');
/**
 * ⚠️ 这一条原来硬写"必须是 installed-not-running"（基线那台机器守护进程没起）。
 * 引擎开着时那句就**变成了把机器的旧状态当契约**（产品主修好 Docker 之后必然误报）。
 * 原意保留：① 绝不报 not-installed（CLI 真的在）；② 状态与运行态**必须一致**。
 */
const DOCKER_STATES = ['installed-not-running', 'ready'];
ok(DOCKER_STATES.includes(docker.status),
  '2-1 【核心】docker 落在「已安装未运行」或「可用」两态之一（CLI 在就不许报成"未安装"）',
  docker.status);
ok(docker.run === (docker.status === 'ready' ? 'running' : 'not-running'),
  '2-1b docker 的运行态与状态一致（未运行 ⇒ not-running，可就地给「一键启动」）', docker.run);
ok(!!docker.version && /\d+\.\d+/.test(String(docker.version)), '2-1c docker 取到了版本（"命令存在"确实被证实）', docker.version);
ok(docker.status === 'ready'
  ? /^daemon-reachable:(linux|windows)$/.test(String(docker.detail))
  : (typeof docker.evidence === 'string' && /pipe|daemon|connect/i.test(docker.evidence)),
  '2-1d 原始证据被保留（没就绪时是守护进程的真实报错；就绪时是引擎回的 OSType），不是一句空话',
  docker.status === 'ready' ? docker.detail : docker.evidence);
ok(docker.status === 'ready' ? /^daemon-reachable:/.test(String(docker.detail)) : docker.detail === 'daemon-not-running',
  '2-1e detail 是机器可读码（未运行 = daemon-not-running；就绪 = daemon-reachable:<模式>）', docker.detail);

const wsl = by.wsl;
ok(!!wsl, '2-2 有 wsl 一行');
ok(DOCKER_STATES.includes(wsl.status),
  '2-2a 【核心】wsl 同样只允许「已安装未运行」或「可用」两态（命令在就不许报 no-distro 之外的第三种）', wsl.status);
/**
 * 第十七批修正：WSL 的探测**不再为了探测而启动发行版**（用户实测"打开新窗口会拉起 WSL"）。
 * 所以原因码多了 `distro-not-running:<name>` —— 它如实说明"发行版存在但没在跑，
 * 我们没有替你启动它"，而不是含糊的"命令不在"或假装"启动失败"。
 */
ok(/no-distro|distro-start|distro-not-running|^distro=/.test(String(wsl.detail)),
  '2-2b 原因码说明到底是"没有发行版"还是"发行版可用/未运行"（不是"命令不在"）', wsl.detail);
ok(wsl.engine.kind === 'linux-vm', '2-2c 【诚实】wsl 的能力类别是 linux-vm（**不是**容器引擎）', wsl.engine.kind);
ok(wsl.capability.runCommand === (wsl.status === 'ready'),
  '2-2d 【核心】能力声明与就绪状态**严格一致**（ready ⇒ 真能跑；没就绪 ⇒ 一律 false，不吹牛）',
  wsl.status + ' / ' + JSON.stringify(wsl.capability));
ok(wsl.lifecycle.startable === false && wsl.lifecycle.stoppable === false,
  '2-2e 【核心】WSL 不给启停按钮（它不是能单独启停的容器引擎），理由已给出',
  wsl.lifecycle.reason);

const notInstalled = report.runtimes.filter((r) => r.status === 'not-installed');
ok(notInstalled.length >= 1, '2-3 至少一个运行时如实报 not-installed（本机没有）',
  JSON.stringify(notInstalled.map((r) => r.id)));
ok(report.notInstalledCount === notInstalled.length, '2-3b notInstalledCount 与逐条一致', report.notInstalledCount);
ok(notInstalled.every((r) => !r.lifecycle.startable && !r.lifecycle.stoppable && r.lifecycle.reason === 'not-installed'),
  '2-3c 未安装的运行时不给启停按钮，理由 = not-installed');

/* ── 3. 平台不适用 → 跳过探测并说明 ── */
section('3. 平台不适用（跳过探测并说明，不是"未安装"）');
const unsupported = report.runtimes.filter((r) => r.status === 'unsupported-platform');
const platform = process.platform;
if (platform === 'win32') {
  const wantUnsup = ['colima', 'lima', 'lxd-incus', 'isulad', 'pouch', 'kata'];
  const bad = wantUnsup.filter((w) => (by[w] || {}).status !== 'unsupported-platform');
  ok(bad.length === 0, '3-1 Windows 上 macOS/Linux 专属的候选如实报「当前系统不适用」', JSON.stringify(bad));
  ok(unsupported.every((r) => r.probeMs < 50), '3-1b 平台不适用的条目**不 spawn**（几乎零成本）',
    JSON.stringify(unsupported.map((r) => [r.id, r.probeMs])));
} else {
  ok(by['windows-sandbox'].status === 'unsupported-platform', '3-1 非 Windows 上 Windows Sandbox 报不适用',
    by['windows-sandbox'].status);
}
ok(unsupported.every((r) => r.run === 'unsupported' && r.detail.startsWith('platform-not-supported')),
  '3-2 不适用条目单独标（不强行并进 running/not-running 两态）',
  JSON.stringify(unsupported.map((r) => [r.id, r.detail])));
ok(unsupported.every((r) => r.lifecycle.reason === 'unsupported-platform'), '3-2b 不适用条目理由一致');

/* ── 4. 能力声明诚实（不许把 VM 说成容器引擎）── */
section('4. 能力与类别（诚实区分）');
const kinds = Object.fromEntries(report.runtimes.map((r) => [r.id, r.engine.kind]));
ok(kinds.wsl === 'linux-vm', '4-1 WSL 是 Linux VM', kinds.wsl);
ok(kinds['windows-sandbox'] === 'disposable-vm', '4-2 Windows Sandbox 是一次性 VM（单列一类）', kinds['windows-sandbox']);
ok(kinds.colima === 'linux-vm' && kinds.lima === 'linux-vm', '4-3 Colima / Lima 是 VM（管理），不是容器引擎', kinds.colima + '/' + kinds.lima);
ok(kinds['lxd-incus'] === 'system-container', '4-4 LXD/Incus 是系统容器', kinds['lxd-incus']);
ok(kinds.docker === 'container' && kinds.podman === 'container' && kinds.nerdctl === 'container',
  '4-5 Docker / Podman / nerdctl 是容器引擎', kinds.docker + '/' + kinds.podman + '/' + kinds.nerdctl);
const kataSpec = containerRuntimeSpec('kata');
ok(!!kataSpec && kataSpec.lifecycle.reason === 'not-standalone-engine',
  '4-6 Kata 被如实标为"隔离级别、不是独立引擎"（ready 也不给 runCommand）', kataSpec && kataSpec.lifecycle.reason);
ok(report.runtimes.every((r) => (r.status === 'ready' ? true : r.capability.runCommand === false && r.capability.interactiveShell === false && r.capability.mountHostDir === false)),
  '4-7 未就绪的条目能力恒为 false（"命令在"不等于"能用"）');

/* ── 5. 报告里的可用性汇总 ── */
section('5. 可用性汇总');
ok(Array.isArray(report.usableIds) && Array.isArray(report.containerEngineIds) && Array.isArray(report.attentionIds),
  '5-1 报告带 usableIds / containerEngineIds / attentionIds（给「项目 / 我的牛马」选用）');
ok(report.containerEngineIds.every((id) => report.usableIds.includes(id)),
  '5-2 containerEngineIds ⊆ usableIds', JSON.stringify({ usable: report.usableIds, engines: report.containerEngineIds }));
const vmInEngines = report.containerEngineIds.filter((id) => (kinds[id] || '') !== 'container');
ok(vmInEngines.length === 0, '5-3 【核心】Linux VM / 一次性沙箱**不**被算作容器引擎', JSON.stringify(vmInEngines));
ok(report.attentionIds.every((id) => ['installed-not-running', 'engine-error'].includes(by[id].status)),
  '5-4 attentionIds 只含"装了但没起/报错"的条目', JSON.stringify(report.attentionIds));

/* ── 6. 便宜 + 可缓存 ── */
section('6. 成本与缓存');
const cached = await probeContainerRuntimes({ cacheMs: 60000 });
ok(cached.cached === true, '6-1 短时间内的第二次探测命中缓存（点两次按钮不会重复压机器）');
ok(cached.runtimes.length === 12, '6-1b 缓存报告形状不变');
const fresh = await probeContainerRuntimes({ cacheMs: 0 });
ok(fresh.cached === false, '6-2 force 时真的重探（cached=false）');

/* ── 7. 启停入口的**参数校验**（不接受任意命令）── */
section('7. 启停入口只接受预定义 id + 动作枚举');
const bad1 = await runContainerAction({ id: 'docker; rm -rf /', action: 'start' });
ok(bad1.ok === false && bad1.code === 'unknown-runtime', '7-1 未知运行时 id 被拒（命令字符串不可能被拼进 spawn）', JSON.stringify(bad1));
const bad2 = await runContainerAction({ id: 'docker', action: 'restart' });
ok(bad2.ok === false && bad2.code === 'bad-action', '7-2 动作只允许 start / stop', JSON.stringify(bad2));
const bad3 = await runContainerAction({ id: 'wsl', action: 'start' });
ok(bad3.ok === false && bad3.code === 'not-controllable',
  '7-3 【核心】WSL 没有可程序化启停的路径 → 即使被直接调用也拒绝（不给语义不对的按钮）', JSON.stringify(bad3));
const bad4 = await runContainerAction({ id: 'windows-sandbox', action: 'start' });
ok(bad4.ok === false && bad4.code === 'not-controllable', '7-4 Windows Sandbox 同样被拒（一次性沙箱无常驻状态）', JSON.stringify(bad4));
const bad5 = await runContainerAction({ id: 'nerdctl', action: 'stop' });
ok(bad5.ok === false && bad5.code === 'not-controllable', '7-5 containerd/nerdctl 由系统服务托管 → 拒绝（需 root，不代跑提权）', JSON.stringify(bad5));

/* ── 8. i18n：安装说明与启停文案必须齐（中英键集相等、英文无中文）── */
section('8. i18n（折叠安装说明四要素 + 四条链接 + 状态/动作）');
const REQUIRED = [
  'container.title', 'container.probeBtn', 'container.probing', 'container.probeDone', 'container.listTitle',
  'container.guideTitle', 'container.guideHint', 'container.guideCost', 'container.guideCommercial', 'container.guideOs', 'container.guideSize',
  'container.link.official', 'container.link.install', 'container.link.download', 'container.link.support',
  'container.guideFirstStep', 'container.listEmpty', 'container.notInstalledNote',
  'container.action.start', 'container.action.stop', 'container.action.starting', 'container.action.stopping',
  'container.action.confirmStopTitle', 'container.action.confirmStopBody', 'container.action.needsAdmin',
  'container.runEnv.title', 'container.runEnv.fitsLabel', 'container.runEnv.needsLabel', 'container.runEnv.blockedLabel',
  // 「运行/测试在容器中」那整套选项**已作废删除**（容器 = 开发环境）；这里只保留仍被设置页引用的"选项事实"键
  'container.runEnv.opt.container-linux.title', 'container.runEnv.opt.container-windows.title',
  'container.runEnv.opt.device-android.title', 'container.runEnv.opt.device-ios.title',
  'container.runEnv.opt.device-windows-desktop.title',
  'container.devEnv.title', 'container.devEnv.host', 'container.devEnv.container', 'container.devEnv.required',
  // 右键菜单要用的那句话（"只有创建者能启用/停用"）
  'container.project.notCreator',
  // P3/P7 定稿：项目可用性 / 不可用 = 只能看历史 / 右键启用停用 / 三块面板（含诚实边界）
  'container.project.unavailable', 'container.project.available', 'container.project.reasonBody',
  'container.project.blockedNotice', 'container.project.usingContainer', 'container.project.historyStillReadable',
  'container.project.unavailableAsOffline', 'container.project.menuHint', 'container.project.enableNeedsContainer',
  'container.project.enableNeedsContainerTitle', 'container.project.enabledAt', 'container.project.enableFailed',
  'container.project.disableConfirmTitle', 'container.project.disableConfirmBody', 'container.project.disableFailed',
  'container.project.notContainerProject', 'container.project.switchTitle', 'container.project.switchBody',
  'container.project.switchNoContainer', 'container.project.switchFits', 'container.project.switchMore',
  'container.project.switchFailed', 'container.project.switchDone', 'container.project.switchNeedRestart',
  'container.project.enforceBoundary', 'container.project.hostEditingRefused', 'container.project.testingAllowed',
  'container.project.reason.ok', 'container.project.reason.containerDown',
  'container.project.reason.disabledByOwner', 'container.project.reason.notInstalled',
  'container.project.reason.notChosen',
  'container.project.fix.ok', 'container.project.fix.start-container', 'container.project.fix.choose-container',
  'container.project.fix.install-container', 'container.project.fix.enable-project',
  // 右键菜单与右栏三块
  'ctx.projectEnable', 'ctx.projectDisable', 'ctx.projectSwitchContainer',
  'panel.projectState', 'panel.projectFiles',
  'projectFiles.changedTitle', 'projectFiles.otherTitle', 'projectFiles.productTitle', 'projectFiles.run',
  'projectFiles.productDir', 'projectFiles.productDirPlanned', 'projectFiles.empty.changed',
  'projectFiles.empty.noProjectDir', 'projectFiles.empty.other', 'projectFiles.source.checkpoint',
  'projectFiles.runReason.host-native', 'projectFiles.runReason.container-built', 'projectFiles.runReason.no-host-runtime',
  'projectFiles.runStarted', 'projectFiles.runFailed', 'projectFiles.loadFailed', 'projectFiles.missingHint',
  // 镜像按技术栈选
  'container.image.stack.title', 'container.image.stack.nodeOnly', 'container.image.stack.minimal',
  'container.image.stack.node', 'container.image.stack.fits', 'container.image.stack.moreLater',
  'container.image.executorHost',
  // P4 定稿：控制台 = 容器内的 shell（含安全契约逐条）
  'container.console.title', 'container.console.tip', 'container.console.onlyInChat', 'container.console.notEnabled',
  'container.console.notReady', 'container.console.projectStopped', 'container.console.needsImage',
  'container.console.linuxNode', 'container.console.security', 'container.console.securityDetail',
  'container.console.intro', 'container.console.stateLine', 'container.console.noExec', 'container.console.refused',
  'container.console.run', 'container.console.sent', 'container.console.inputPlaceholder',
  // 诊断事件流（事件日志已从"控制台"降级为独立排障视图）
  'console.hint', 'console.title', 'tip.console', 'console.clearTip', 'console.empty', 'console.redacted',
];
for (const rid of ['docker', 'podman', 'wsl', 'nerdctl', 'rancher-desktop', 'colima', 'lima', 'windows-sandbox', 'lxd-incus', 'isulad', 'pouch', 'kata']) {
  for (const f of ['name', 'cost', 'commercial', 'os', 'size']) REQUIRED.push('container.rt.' + rid + '.' + f);
}
const missZh = REQUIRED.filter((k) => !ZH[k]);
const missEn = REQUIRED.filter((k) => !EN[k]);
ok(missZh.length === 0, '8-1 中文包包含全部必需键', JSON.stringify(missZh));
ok(missEn.length === 0, '8-2 英文包包含全部必需键', JSON.stringify(missEn));
const CJK = /[\u4e00-\u9fff]/;
const allow = new Set(['app.zhName', 'settings.localeZh', 'about.copyrightBody', 'llm.toolRecallDesc']);
const leaked = Object.keys(EN).filter((k) => CJK.test(String(EN[k])) && !allow.has(k));
ok(leaked.length === 0, '8-3 英文包除 4 个已知例外外没有中文', JSON.stringify(leaked));
ok(Object.keys(ZH).length === Object.keys(EN).length, '8-4 中英键数量相等（键集合相等）',
  Object.keys(ZH).length + '/' + Object.keys(EN).length);
const sameText = REQUIRED.filter((k) => k.endsWith('.name') === false && ZH[k] === EN[k]);
ok(sameText.length === 0, '8-5 必需键里的**说明性文案**中英不相同（不是漏翻/复制粘贴）', JSON.stringify(sameText));
// 名字是专有名词，允许本来就一样（Colima / Lima / Rancher Desktop …）。
// 产品要求：名字里**不许**出现"推荐/优先"等广告性措辞，也不许挂厂商括注。
const promo = REQUIRED.filter((k) => {
  if (!k.endsWith('.name')) return false;
  return /推荐|優先|优先|recommended|preferred|厂商|公司/i.test(`${ZH[k] || ''}${EN[k] || ''}`);
});
ok(promo.length === 0, '8-5b 运行时名字不含"推荐/优先/厂商"等广告性措辞', JSON.stringify(promo.slice(0, 4)));
/**
 * 授权事实必须在文案里如实体现（已核实的许可硬事实，不许被改写掉）。
 * 第十七批定稿：**只陈述"是否收费 + 许可"**，不抄价目表、不做比较、不写厂商来源。
 */
ok(/Apache-2\.0/.test(ZH['container.rt.podman.cost']) && /免费/.test(ZH['container.rt.podman.cost']),
  '8-6 Podman 文案写明免费 + Apache-2.0 许可（文案如实）', ZH['container.rt.podman.cost']);
ok(/免费/.test(ZH['container.rt.docker.cost']) && /商业许可/.test(ZH['container.rt.docker.cost']) && !/\$/.test(ZH['container.rt.docker.cost']),
  '8-7 Docker 文案写明引擎免费、桌面版为商业许可；**不抄价格、不比较**', ZH['container.rt.docker.cost']);
// 12 个运行时**每一个**都必须回答"是否收费"（这是产品明确要求的字段）
const noCost = Object.keys(ZH).filter((k) => /^container\.rt\.[^.]+\.cost$/.test(k)).filter((k) => !/免费|收费|商业|随 Windows/.test(String(ZH[k])));
ok(noCost.length === 0, '8-7b 每个运行时都回答了"是否收费"（没有含糊其辞）', JSON.stringify(noCost));
ok(!/推荐|优先|首选|优于|替代|国内|阿里|华为/.test(String(ZH['container.rt.podman.cost']) + String(ZH['container.rt.docker.cost'])),
  '8-7c 收费文案里没有比较性措辞与厂商来源暗示', '');
ok(/家庭版没有/.test(ZH['container.rt.windows-sandbox.os']), '8-8 Windows Sandbox 家庭版没有（文案如实）', ZH['container.rt.windows-sandbox.os']);

/* ── 9. 报告形状：给 UI 的契约字段 ── */
section('9. 结构（不拼句子，UI 按字段渲染）');
const sample = report.runtimes.find((r) => r.status === 'installed-not-running') || by.docker || report.runtimes.find((r) => r.status === 'ready');
ok(!!sample && typeof sample.detail === 'string' && sample.detail.length > 0 && typeof sample.engine === 'object',
  '9-1 三态条目带 { id, status, engine, capability, detail }', JSON.stringify(sample && { id: sample.id, detail: sample.detail }));
ok(report.runtimes.every((r) => !/[\u4e00-\u9fff]/.test(String(r.detail))),
  '9-2 detail 是机器可读码（**不翻译**，文案由渲染层按码取 i18n）');
/**
 * evidence 是**原始输出**：可能含系统语言（本机 wsl 就是中文的"没有已安装的分发"）——
 * 它**不参与翻译**。要证明的是"它不是我们拼的句子"，而不是"它必须是英文"。
 * 判据：docker 的 evidence 里带着那条真实的命名管道路径；且没有任何 evidence
 * 恰好等于语言包里的某条文案（= 没被 i18n 渲染过）。
 */
/**
 * 原判据：evidence 里带着真实的命名管道路径（证明是**原始输出**而不是我们拼的句子）。
 * 引擎开着时 docker info 成功、没有那条报错 ⇒ 改用"evidence 必须是引擎自己给的原文"来证：
 * 就绪时的 detail 一定是 `daemon-reachable:<OSType>`（OSType 由 docker info 直接回）。
 */
ok(docker.status === 'ready'
  ? /^daemon-reachable:(linux|windows)$/.test(String(docker.detail))
  : (typeof docker.evidence === 'string' && docker.evidence.includes('npipe:////./pipe/dockerDesktopLinuxEngine')),
  '9-3 docker 的 evidence 是**逐字**的引擎原始输出（未运行时含真实命名管道路径；就绪时含真实 OSType）',
  docker.status === 'ready' ? docker.detail : docker.evidence);
const allI18nValues = new Set([...Object.values(ZH), ...Object.values(EN)].map((v) => String(v)));
const translatedEvidence = report.runtimes.filter((r) => r.evidence && allI18nValues.has(String(r.evidence)));
ok(translatedEvidence.length === 0, '9-3b evidence 没有被 i18n 渲染过（原始证据原样透出）',
  JSON.stringify(translatedEvidence.map((r) => r.id)));

/* ── 10. 控制台 = 容器内的 shell：参数形状与门禁（ADR 004 P4 定稿）── */
section('10. 控制台（容器内 shell）的参数形状：只有 runtimeId + 动作枚举');
const badCmd = normalizeContainerShellRequest({ runtimeId: 'docker', action: 'open', sessionId: 's1', cmd: 'rm -rf /', command: 'curl evil' });
ok(badCmd.ok === true && !('cmd' in badCmd.req) && !('command' in badCmd.req),
  '10-1 【核心】载荷里的 `cmd` / `command` 等字段**根本不被采纳**（白名单外的字段一律忽略）',
  JSON.stringify(Object.keys(badCmd.ok ? badCmd.req : {})));
ok(badCmd.ok === true && badCmd.req.action === 'open' && badCmd.req.runtimeId === 'docker',
  '10-2 采纳的字段只有 { runtimeId, action, sessionId, data }', JSON.stringify(badCmd.ok ? badCmd.req : null));
const badAct = normalizeContainerShellRequest({ action: 'exec', runtimeId: 'docker' });
ok(badAct.ok === false && badAct.code === 'bad-action',
  '10-3 动作是**枚举**（' + CONTAINER_SHELL_ACTIONS.join('/') + '）：`exec` 这种即被拒',
  JSON.stringify(badAct));
ok(normalizeContainerShellRequest({ action: 'open', runtimeId: 'docker; rm -rf /' }).code === 'unknown-runtime',
  '10-4 【核心】运行时 id 必须是预定义清单里的（命令字符串不可能出现在 id 里）');
ok(normalizeContainerShellRequest({ action: 'write', data: 'x'.repeat(CONTAINER_SHELL_MAX_DATA + 1) }).code === 'data-too-long',
  '10-5 写入有长度上限（' + CONTAINER_SHELL_MAX_DATA + ' 字符），拿它当大数据通道会被拒');
ok(normalizeContainerShellRequest({ action: 'write', data: 'echo\u0000hi' }).code === 'bad-data',
  '10-6 含 NUL 的写入被拒（不把二进制/截断技巧带进 shell）');
ok(normalizeContainerShellRequest({ action: 'close', data: 'echo hi' }).code === 'unexpected-data',
  '10-7 不该带数据的动作带上 data 也被拒（形状收紧，不留模糊地带）');
ok(CONTAINER_SHELL_ACTIONS.length === 4 && CONTAINER_SHELL_ACTIONS.includes('write'),
  '10-8 动作清单就是这 4 个（open/write/close/status）', JSON.stringify(CONTAINER_SHELL_ACTIONS));

section('10b. 安全契约必须写成**可断言的事实**（不是一句宣传语）');
ok(CONTAINER_SHELL_SECURITY.remoteInjectPaths === 0, '10b-1 远程注入路径 0 条（对端/群成员/智能体都没有入口）');
ok(CONTAINER_SHELL_SECURITY.autoRun === false, '10b-2 不自动执行任何命令');
ok(CONTAINER_SHELL_SECURITY.forwardsSecretEnv === false,
  '10b-3 【核心】本机密钥类环境变量**不**带进容器（API Key / SMTP 授权码 / 身份私钥）');
ok(CONTAINER_SHELL_SECURITY.argvFromUntrustedSource === false,
  '10b-4 argv 里不含任何来自不可信来源的串（参数只有预定义 id + 枚举）');
ok(CONTAINER_SHELL_SECURITY.hostFallback === false,
  '10b-5 容器没就绪时**不会**退化成宿主执行（也绝不回退成"事件日志"）');
ok(CONTAINER_SHELL_SECURITY.typedBy === 'local-human-only', '10b-6 只有本机的人手动输入才会执行');

section('11. 控制台门禁：未就绪 ⇒ 一条命令都不执行（顺序与主进程一致）');
const gateNotInChat = containerShellGate({ inProjectOrCattle: false, runInContainer: true, imageReady: true });
ok(gateNotInChat.available === false && gateNotInChat.code === 'not-in-chat' && gateNotInChat.reason === 'onlyInChat',
  '11-1 联系人/群聊里没有控制台（不是"灰着占位"）', JSON.stringify(gateNotInChat));
const gateNotEnabled = containerShellGate({ inProjectOrCattle: true, runInContainer: false });
ok(gateNotEnabled.available === false && gateNotEnabled.code === 'not-enabled', '11-2 没开启"运行/测试在容器中" ⇒ 不可用', JSON.stringify(gateNotEnabled));
const gateStopped = containerShellGate({ inProjectOrCattle: true, runInContainer: true, projectStopped: true, runtimeId: 'docker', runtimeStatus: 'ready', imageReady: true });
ok(gateStopped.available === false && gateStopped.code === 'project-stopped',
  '11-3 【核心】项目已停止（等同创建者下线）⇒ 控制台也不可用', JSON.stringify(gateStopped));
const gateNotReady = containerShellGate({ inProjectOrCattle: true, runInContainer: true, runtimeId: 'docker', runtimeStatus: 'installed-not-running' });
ok(gateNotReady.available === false && gateNotReady.code === 'container-not-ready' && gateNotReady.needsInstall === true,
  '11-4 【核心】容器未就绪（本机真实状态）⇒ 置灰 + needsInstall（走 §3.3 引导流）', JSON.stringify(gateNotReady));
const gateNoProbe = containerShellGate({ inProjectOrCattle: true, runInContainer: true, runtimeId: 'docker', runtimeStatus: null });
ok(gateNoProbe.available === false,
  '11-5 【核心】**没探过**（runtimeStatus=null）也算未就绪 —— 不许乐观放开', JSON.stringify(gateNoProbe));
const gateNoImage = containerShellGate({ inProjectOrCattle: true, runInContainer: true, runtimeId: 'docker', runtimeStatus: 'ready', imageReady: false });
ok(gateNoImage.available === false && gateNoImage.openable === true && gateNoImage.code === 'no-image',
  '11-6 引擎就绪、但项目容器镜像未定：面板能开（openable）、但**一条命令都跑不了**（available=false）——今天就是这一档',
  JSON.stringify(gateNoImage));
const gateOk = containerShellGate({ inProjectOrCattle: true, runInContainer: true, runtimeId: 'docker', runtimeStatus: 'ready', imageReady: true });
ok(gateOk.available === true && gateOk.openable === true && gateOk.code === 'ok',
  '11-7 引擎就绪 + 镜像就绪 ⇒ 才真的可用（本机现在达不到，如实）', JSON.stringify(gateOk));
ok([gateNotInChat, gateNotEnabled, gateStopped, gateNotReady, gateNoProbe].every((g) => g.openable === false),
  '11-8 未就绪的每一档**连面板都不给开**（openable=false）—— 不做"打开了一个什么都干不了的面板"这种假动作');

/* ── 12. 容器项目 = 只能在容器里开发（定稿语义）── */
section('12. 容器项目的开发面：停止态 = 等同创建者下线');
const hostProject = deriveProjectState({ devEnv: 'host' });
ok(hostProject.containerOnly === false && hostProject.developmentAllowed === true && hostProject.developmentWhere === 'host',
  '12-1 「本机开发」的项目完全不受容器影响', JSON.stringify(hostProject));
ok(hostProject.memberFace === null && hostProject.hostEditingRefused === false,
  '12-2 本机项目既不"等同创建者下线"，也不拒绝宿主侧编辑');
const okProject = deriveProjectState({ devEnv: 'container', runtimeId: 'docker', runtimeStatus: 'ready' });
ok(okProject.code === 'ok' && okProject.developmentAllowed === true && okProject.developmentWhere === 'container',
  '12-3 容器就绪 ⇒ 可开发，但**开发地点是容器**', JSON.stringify(okProject));
ok(okProject.hostEditingRefused === true && okProject.restrictions.includes('host-editing'),
  '12-4 【核心】容器项目**恒**拒绝宿主侧编辑（就绪时也在容器里做，绝不在宿主上做）',
  JSON.stringify(okProject.restrictions));
ok(okProject.memberFace === null, '12-5 就绪时不影响成员可见状态');

const downProject = deriveProjectState({ devEnv: 'container', runtimeId: 'docker', runtimeStatus: 'installed-not-running' });
ok(downProject.stopped === true && downProject.running === false && downProject.developmentAllowed === false,
  '12-6 【核心】容器没运行 ⇒ 项目 = 已停止（成员也不能开发）', JSON.stringify(downProject));
ok(downProject.memberFace === 'creator-offline',
  '12-7 【核心】对成员的可见效果 = **与「创建者下线」完全一致**（复用既有语义，不新造一套"停止"）',
  String(downProject.memberFace));
ok(downProject.code === 'container-not-ready' && projectReasonKey(downProject.code) === 'containerDown',
  '12-8 原因码是机器可读的（文案走 i18n）', downProject.code);
const refusal = projectUnavailableRefusal(downProject);
ok(!!refusal && refusal.code === 'project-unavailable' && refusal.hostExecutionRefused === true && refusal.memberFace === 'creator-offline',
  '12-9 【核心】主进程据此**拒绝在宿主侧开发**（返回结构化拒绝 project-unavailable，不是悄悄在本机跑）', JSON.stringify(refusal));
ok(projectUnavailableRefusal(okProject) === null, '12-10 容器就绪时不拒绝（放行到容器内的路径）');
ok(projectUnavailableRefusal(hostProject) === null, '12-11 本机项目永不因此被拒');
const creatorStopped = deriveProjectState({ devEnv: 'container', runtimeId: 'docker', runtimeStatus: 'ready', disabledByOwner: true });
ok(creatorStopped.code === 'disabled-by-owner' && creatorStopped.stopped === true,
  '12-12 【核心】创建者点了「停止项目」⇒ 即使引擎还开着，项目也是停止态（"停止 = 不可开发"）',
  JSON.stringify({ code: creatorStopped.code, stopped: creatorStopped.stopped }));
ok(creatorStopped.memberFace === 'creator-offline' && projectReasonKey(creatorStopped.code) === 'disabledByOwner',
  '12-13 创建者停用 ⇒ 成员看到的还是"创建者下线"那一套 + 可区分的原因码');
const noProbe = deriveProjectState({ devEnv: 'container', runtimeId: 'docker', runtimeStatus: null });
ok(noProbe.stopped === true && noProbe.code === 'container-not-ready',
  '12-14 【核心】还没探过也算停止（不许乐观放开宿主侧编辑）', JSON.stringify(noProbe));
const notChosen = deriveProjectState({ devEnv: 'container', runtimeId: '' });
ok(notChosen.code === 'container-not-chosen' && notChosen.stopped === true, '12-15 没选定运行时 ⇒ 停止 + 原因码 not-chosen', notChosen.code);
const notInstalledProject = deriveProjectState({ devEnv: 'container', runtimeId: 'docker', runtimeStatus: 'not-installed' });
ok(notInstalledProject.code === 'container-not-installed' && notInstalledProject.stopped === true, '12-16 所选运行时没装 ⇒ 停止 + 原因码如实', notInstalledProject.code);
ok(downProject.testingAllowed === true && downProject.testingWhere === 'host-or-other-device',
  '12-17 【定稿】只有"测试/运行"可以留在宿主或其它设备上（开发不行）', downProject.testingWhere);
const allCodes = [hostProject, okProject, downProject, creatorStopped, noProbe, notChosen, notInstalledProject];
ok(allCodes.every((x) => x.testingAllowed === true && x.testingWhere === 'host-or-other-device'),
  '12-18 任何情况下测试/运行都不被容器绑定（与 §6.2 的定位一致）');
ok(allCodes.filter((x) => x.devEnv === 'container').every((x) => x.hostEditingRefused === true),
  '12-19 只要选了"容器中开发"，宿主侧编辑**一律**被拒（这条承诺没有例外）');

section('12b. 停止态必须能和"创建者下线"同一套文案对上（不许新造第三种状态）');
ok(!!ZH['group.memberOffline'] && !!EN['group.memberOffline'],
  '12b-1 既有「离线」文案仍在（成员侧复用它：' + ZH['group.memberOffline'] + '）');
ok(!!ZH['container.project.unavailableAsOffline'] && ZH['container.project.unavailableAsOffline'].indexOf('创建者下线') >= 0,
  '12b-2 不可用那条说明里**逐字**写了"与创建者下线一致"', String(ZH['container.project.unavailableAsOffline']).slice(0, 40));
ok(!!ZH['container.project.enforceBoundary'] && ZH['container.project.enforceBoundary'].indexOf('外部编辑器') >= 0,
  '12b-3 【诚实边界】文案里写清"拦不住你用外部编辑器打开那个目录"（不夸大强制力）',
  String(ZH['container.project.enforceBoundary']).slice(0, 50));
ok(!!EN['container.project.enforceBoundary'] && /external editor/i.test(EN['container.project.enforceBoundary']),
  '12b-4 英文包同样写明这条边界（不是中文独有）');


/* ── 12c. 第七批：不误伤 + 只能看历史 + 镜像按技术栈 ── */
section('12c. 「不可用」不等于"什么都看不了"；本机项目不被误伤；镜像按技术栈选');
ok(allCodes.every((x) => x.historyReadable === true),
  '12c-1 【核心】任何状态下 historyReadable 都是 true —— 不可用时**历史记录仍然可读**（只读历史，不是全禁）');
ok(hostProject.running === true && hostProject.code === 'host-dev' && hostProject.fix === 'ok',
  '12c-2 【不误伤】创建时没选容器的项目：本机开发，**无需容器也能正常聊天**', JSON.stringify({ code: hostProject.code, running: hostProject.running }));
const disabledHost = deriveProjectState({ devEnv: 'host', disabledByOwner: true });
ok(disabledHost.stopped === true && disabledHost.code === 'disabled-by-owner' && disabledHost.memberFace === 'creator-offline',
  '12c-3 「停用项目」与容器**无关**：本机项目也能被停用，效果同为不可用 + 等同创建者下线',
  JSON.stringify({ code: disabledHost.code, running: disabledHost.running }));
ok(disabledHost.hostEditingRefused === false && disabledHost.developmentWhere === 'host',
  '12c-4 被停用的本机项目**不**变成"容器项目"（宿主侧编辑限制只针对容器开发项目）');
ok(disabledHost.restrictions.includes('features') && disabledHost.historyReadable === true,
  '12c-5 停用后"其中功能不可用"，但历史仍可读', JSON.stringify(disabledHost.restrictions));
ok(downProject.fix === 'start-container' && notChosen.fix === 'choose-container' && disabledHost.fix === 'enable-project',
  '12c-6 每个不可用状态都给出**下一步该做什么**（fix 码），UI 不会只说"不可用"');
ok(!downProject.restrictions.includes('history') && !disabledHost.restrictions.includes('history'),
  '12c-7 restrictions 里**永远不含 history** —— 历史不在被限制的范围内（这条是硬约束）');

ok(CONTAINER_EXECUTOR_LOCATION === 'host',
  '12c-8 【架构】AI 执行器**留在主机**（只把用户项目的命令执行送进容器）', CONTAINER_EXECUTOR_LOCATION);
ok(CONTAINER_NODE_NEEDED_CASES.length === 2 && CONTAINER_NODE_NEEDED_CASES.includes('project-is-node-stack') && CONTAINER_NODE_NEEDED_CASES.includes('executor-moved-into-container'),
  '12c-9 【更正】"Node 只在两种情况需要"写成可断言的事实（项目本身是 Node 栈 / 执行器也搬进容器）',
  JSON.stringify(CONTAINER_NODE_NEEDED_CASES));
const minimal = CONTAINER_BASE_IMAGES.filter((x) => x.stack === 'minimal');
const nodeImgs = CONTAINER_BASE_IMAGES.filter((x) => x.stack === 'node');
ok(minimal.length >= 1 && nodeImgs.length >= 1,
  '12c-10 镜像表按技术栈分档：最小（纯文本/文档/写作）与 带 Node（JS/前端）都在',
  JSON.stringify(CONTAINER_BASE_IMAGES.map((x) => [x.id, x.stack])));
ok(minimal.every((x) => x.fits && x.fits.length > 0) && nodeImgs.every((x) => x.fits && x.fits.length > 0),
  '12c-11 每一档都写清**适合什么项目**（产品主要求"环境/镜像按项目技术栈选"要有表达）');
ok(!/必须自带 Linux 版 Node/.test(JSON.stringify(CONTAINER_BASE_IMAGES)) && !/必须带 Node/.test(ZH['container.image.node']),
  '12c-12 【更正落地】"镜像必须带 Node"这句过度推广已从数据结构与文案里删掉',
  String(ZH['container.image.node']).slice(0, 60));
ok(CONTAINER_IMAGE_STACKS.includes('minimal') && CONTAINER_IMAGE_STACKS.includes('node'),
  '12c-13 UI 分档用的 stack 枚举 = minimal / node', JSON.stringify(CONTAINER_IMAGE_STACKS));
ok(!!ZH['container.image.stack.nodeOnly'] && ZH['container.image.stack.nodeOnly'].indexOf('两种情况') >= 0 && !!EN['container.image.stack.nodeOnly'],
  '12c-14 "Node 只在两种情况需要"也写进了 UI 文案（中英都有），避免用户误解', String(ZH['container.image.stack.nodeOnly']).slice(0, 40));
ok(!!ZH['container.image.stack.minimal'] && !!ZH['container.image.stack.node'] && !!ZH['container.image.stack.fits'],
  '12c-15 两档的名字与"适合什么项目"标签都在语言包里');


/* ── 14. 第十批：进程派生了 ≠ 成功（原因码要能从真实输出里认出来）── */
section('14. 启停失败的原因码（"假成功"修复的判据）');
const realDesktopErr = '✗ Failed to start Docker Desktop | starting Docker Desktop: getting launcher path: cannot find registry key "SOFTWARE\\Docker Inc.\\Docker Desktop"';
ok(classifyActionResult('start', false, realDesktopErr, 1) === 'install-incomplete',
  '14-1 【核心】真机实测那条错误（找不到注册表键）被判成 install-incomplete（安装不完整或未能启动）',
  classifyActionResult('start', false, realDesktopErr, 1));
ok(actionNeedsInstallHint('install-incomplete') === true && actionNeedsInstallHint('engine-start-failed') === false,
  '14-2 UI 能据此选更精确的提示（"安装不完整" vs 一般"启动失败"）');
ok(classifyActionResult('start', false, 'failed to start Docker Desktop', 1) === 'engine-start-failed',
  '14-3 一般的启动失败仍归到 engine-start-failed（不硬套安装问题）');
ok(classifyActionResult('stop', false, 'access is denied', 5) === 'engine-stop-failed', '14-4 停止失败单独一档');
ok(classifyActionResult('start', false, '', null) === 'no-exit-code',
  '14-5 没有退出码时不假装有原因（如实 no-exit-code）');
ok(classifyActionResult('start', true, 'whatever', 0) === 'ok',
  '14-6 【核心】成功只在真的成功时才报 ok（失败**永不**被当成功）');
ok(!!ZH['container.action.reason.install-incomplete'] && ZH['container.action.reason.install-incomplete'].indexOf('安装不完整') >= 0,
  '14-7 新增原因码有对应中文文案（说清"容器引擎安装不完整或未能启动"）',
  String(ZH['container.action.reason.install-incomplete']).slice(0, 40));
ok(!!EN['container.action.reason.install-incomplete'] && !!EN['container.action.reason.engine-start-failed'] &&
   !!ZH['container.action.failedLine'] && !!EN['container.action.failedLine'],
  '14-8 原因码与"失败行"模板中英都在（键集对齐）');
ok(!!ZH['container.action.retry'] && !!EN['container.action.retry'],
  '14-9 有重试入口的文案（失败后按钮要恢复可用 + 能重试）');

/* ── 15. 第九批：不得假定 Linux + 环境固化按运行时区分 ── */
section('15. 运行时不假定 Linux；固化能力按运行时如实区分');
const capDocker = envSolidifyCapability('docker');
const capPodman = envSolidifyCapability('podman');
const capWsl = envSolidifyCapability('wsl');
const capNone = envSolidifyCapability('');
ok(capDocker.kind === 'commit' && capDocker.programmatic === true, '15-1 Docker ⇒ 可 commit 固化', JSON.stringify(capDocker));
ok(capPodman.kind === 'commit' && capPodman.programmatic === true, '15-2 Podman ⇒ 同样可 commit', JSON.stringify(capPodman));
ok(capWsl.kind === 'export-import' && capWsl.programmatic === false && capWsl.reason === 'wsl-no-commit',
  '15-3 【核心】WSL **没有 commit**：只能整盘 export/import，而且**我们不代跑**（programmatic=false）',
  JSON.stringify(capWsl));
ok(capNone.kind === 'unsupported' && capNone.reason === 'no-runtime-chosen', '15-4 没选容器 ⇒ 能力未知/不支持如实标注', JSON.stringify(capNone));
ok(envSolidifyCapability('windows-sandbox').reason === 'one-shot-vm' && envSolidifyCapability('lxd-incus').reason === 'system-service-needs-root',
  '15-5 每个运行时的固化能力都单独给（一次性沙箱 / 系统容器各自的原因）');
ok(CONTAINER_RUNTIME_SPECS.every((sp) => typeof envSolidifyCapability(sp.id).reason === 'string' && envSolidifyCapability(sp.id).reason.length > 0),
  '15-6 【核心】12 个候选运行时**全部**有固化能力结论（新增运行时必须补这一栏，不留空白）');

const modeRow = (id, detail) => ({ ok: true, platform: 'win32', probedAt: 0, elapsedMs: 0, cached: false,
  runtimes: [{ id, status: 'ready', run: 'running', engine: { kind: 'container', api: 'docker' }, capability: { runCommand: true, interactiveShell: true, mountHostDir: true },
    lifecycle: { startable: true, stoppable: true, reason: 'ok', waitMs: 0, awaitReady: true }, detail, probeMs: 0 }],
  usableIds: [id], containerEngineIds: [id], attentionIds: [], notInstalledCount: 0, pendingActions: [], envTypes: [], images: [], timings: {} });
ok(engineOsModeOf(modeRow('docker', 'daemon-reachable:windows'), 'docker') === 'windows',
  '15-7 【核心】引擎系统模式从**真探测**读：docker 报 windows 就显示 windows（**不把 Linux 当常量**）');
ok(engineOsModeOf(modeRow('docker', 'daemon-reachable:linux'), 'docker') === 'linux', '15-8 报 linux 就显示 linux（是读来的，不是写死的）');
ok(engineOsModeOf(modeRow('wsl', 'distro=Ubuntu'), 'wsl') === 'distro:Ubuntu', '15-9 WSL 显示发行版名（它的"模式"就是发行版）');
ok(engineOsModeOf(modeRow('docker', 'daemon-not-running'), 'docker') === 'unknown',
  '15-10 读不到就如实 unknown（不猜一个模式出来）');
ok(engineOsModeOf(null, 'docker') === 'unknown', '15-11 没有报告时同样 unknown');
ok(!/Linux 容器/.test(ZH['container.env.mode.body']) && !/Linux 容器/.test(EN['container.env.mode.body']),
  '15-12 UI 文案里不写"Linux 容器"，改说"你选择的容器 / 运行环境"');

/* ── 16. 第九批：固化时机（节流 + 明确时机）与保留策略 ── */
section('16. 环境固化的时机与保留策略（不是"一变就固化"）');
const now16 = 1000000;
ok(shouldSolidifyAt({ dirty: true, now: now16, lastSolidifiedAt: 0, programmatic: true }).solidify === true,
  '16-1 第一次有变化 ⇒ 固化一次', JSON.stringify(shouldSolidifyAt({ dirty: true, now: now16, lastSolidifiedAt: 0, programmatic: true })));
ok(shouldSolidifyAt({ dirty: true, now: now16, lastSolidifiedAt: now16 - 5000, programmatic: true }).code === 'coalesced',
  '16-2 【核心】节流窗口内**不**重复固化（避免把缓存/日志一起 commit、避免镜像爆炸）');
ok(shouldSolidifyAt({ dirty: true, now: now16, lastSolidifiedAt: now16 - SOLIDIFY_COALESCE_MS - 1, programmatic: true }).solidify === true,
  '16-3 过了节流窗口且有变化 ⇒ 固化一次');
ok(shouldSolidifyAt({ dirty: false, now: now16, lastSolidifiedAt: now16 - SOLIDIFY_COALESCE_MS * 10, programmatic: true }).code === 'nothing-changed',
  '16-4 可写层没变化 ⇒ 不固化（docker diff 看不到变化就别 commit）');
ok(shouldSolidifyAt({ dirty: false, beforeDestroy: true, programmatic: true }).code === 'before-destroy' &&
   shouldSolidifyAt({ dirty: false, beforeDestroy: true, programmatic: true }).solidify === true,
  '16-5 【核心】可能销毁容器之前**无论如何**固化一次（最后机会）');
ok(shouldSolidifyAt({ explicit: true, dirty: false, programmatic: true }).solidify === true, '16-6 用户显式点按钮 ⇒ 固化');
ok(shouldSolidifyAt({ explicit: true, dirty: true, programmatic: false }).code === 'runtime-cannot-solidify',
  '16-7 【核心】能力不支持时**连显式请求也不执行**（如实说不能，而不是点了假装成功）');
const ret = solidifyRetention([{ imageRef: 'a', at: 1 }, { imageRef: 'b', at: 5 }, { imageRef: 'c', at: 3 }, { imageRef: 'd', at: 9 }]);
ok(ret.keep.length === SOLIDIFY_KEEP && ret.keep[0].imageRef === 'd' && ret.prune.length === 1 && ret.prune[0].imageRef === 'a',
  '16-8 保留策略：只留最近 N 个（默认 ' + SOLIDIFY_KEEP + '）+ 明确哪些该清理', JSON.stringify(ret.keep.map((x) => x.imageRef)));
ok(!!ZH['container.env.solidify.security'] && ZH['container.env.solidify.security'].indexOf('密钥') >= 0,
  '16-9 【安全】固化入口旁写清"commit 会把整个文件系统一起固化（包括可能的密钥）"',
  String(ZH['container.env.solidify.security']).slice(0, 40));
ok(!!ZH['container.env.solidify.retained'] && !!ZH['container.env.solidify.retained'].indexOf('默认保留') >= 0 &&
   !!ZH['container.env.solidify.throttle'] && !!ZH['container.env.solidify.keep'],
  '16-10 三条策略（默认不删容器 / 节流与时机 / 只留最近 N 个）都在文案里');
ok(!!ZH['container.env.solidify.decision.before-destroy'] && !!EN['container.env.solidify.decision.coalesced'],
  '16-11 固化决策码的文案中英都有（UI 能说清"为什么这次没固化"）');

/* ── 17. 第八批：快照与回退点分层 + 安装提示词 ── */
section('17. 快照 vs 回退点（分层）+ 安装提示词（可复制、可核对）');
ok(ZH['container.snapshot.body'].indexOf('覆盖不到项目文件') >= 0 && ZH['container.snapshot.body'].indexOf('不成立') >= 0,
  '17-1 【核心】如实写明"bind mount 下容器快照覆盖不到项目文件"，并否掉"有容器回退点就更简单"',
  String(ZH['container.snapshot.body']).slice(0, 40));
ok(ZH['container.snapshot.layerFiles'].indexOf('不依赖容器') >= 0 && ZH['container.snapshot.layerFiles'].indexOf('没有容器也必须有回退点') >= 0,
  '17-2 【核心】文件回退 = 现有回退点机制，**不依赖容器**（没容器也必须有回退点）');
ok(ZH['container.snapshot.layerEnv'].indexOf('环境回退') >= 0 && ZH['container.snapshot.fingerprint'].indexOf('环境指纹') >= 0,
  '17-3 环境回退靠镜像/快照；回退点升级为"文件 + 环境指纹"（这是容器带来的**唯一**增益）');
ok(ZH['container.snapshot.noClaim'].indexOf('不会') >= 0 && EN['container.snapshot.noClaim'].match(/will \*\*not\*\*/) !== null,
  '17-4 明确承诺"不会声称有容器回退点就更简单"（中英都有）');
const promptZh = ZH['container.env.prompt.content'];
const promptEn = EN['container.env.prompt.content'];
const needZh = ['/workspace', 'cat /etc/os-release', 'which node python3 java go', 'uname -m', '包管理器', '密钥', '重建', '固化'];
const needEn = ['/workspace', 'cat /etc/os-release', 'package manager', 'distribution', 'token', 'recreate', 'solidify'];
ok(needZh.every((x) => promptZh.indexOf(x) >= 0),
  '17-5 安装提示词（中文）包含全部要素：挂载点 / 先探测（os-release、which、uname） / 按真实发行版选包管理器 / 密钥不落盘 / 重建与固化',
  JSON.stringify(needZh.filter((x) => promptZh.indexOf(x) < 0)));
ok(needEn.every((x) => promptEn.indexOf(x) >= 0),
  '17-6 安装提示词（英文）同样包含全部要素（键集对齐、不是只翻一半）',
  JSON.stringify(needEn.filter((x) => promptEn.indexOf(x) < 0)));
ok(promptZh.indexOf('不要把任何密钥') >= 0 || promptZh.indexOf('不要把密钥') >= 0,
  '17-7 ⛔ 提示词里写清"不要把密钥/token/密码写进容器文件"（快照会把它们固化进镜像）');
ok(!!ZH['container.env.prompt.copy'] && !!ZH['container.env.prompt.copied'] && !!ZH['container.env.prompt.failed'] && !!EN['container.env.prompt.copied'],
  '17-8 一键复制的按钮/成功/失败文案中英都在（复制失败时**不假装**已复制）');
ok(!!ZH['container.env.install.persistBody'] && ZH['container.env.install.persistBody'].indexOf('重建就没了') >= 0,
  '17-9 环境自装的**持久性**说清了（停止/启动保留；删掉重建就没了）');
ok(!!ZH['container.env.install.netBody'] && ZH['container.env.install.netBody'].indexOf('镜像源') >= 0,
  '17-10 也给了**网络**上的现实提醒（装包要联网，国内可能要换镜像源）',
  String(ZH['container.env.install.netBody']).slice(0, 30));
ok(ZH['container.env.install.body'].indexOf('都不预装') >= 0 && ZH['container.env.install.body'].indexOf('指引') >= 0,
  '17-11 明说"不预装 + 我们只给指引、不代跑"', String(ZH['container.env.install.body']).slice(0, 30));
ok(!!ZH['checkpoints.env.changed'] && ZH['checkpoints.env.changed'].indexOf('环境回不去') >= 0 &&
   !!EN['checkpoints.env.changed'] && !!ZH['checkpoints.env.layered'],
  '17-12 回退点上的环境指纹文案：环境变了要**提前告知**"文件回退了、环境回不去"（中英都有）');

/* ── 13. 收尾 ── */
const errs = [];
section('结果');
const failed = results.filter((r) => !r.pass);
console.log(JSON.stringify({ pass: failed.length === 0, failures: failed.length, total: results.length }, null, 1));
const outDir = process.env.WARMY_CONTAINER_OUT || path.join(process.env.TEMP || '.', 'perf', 'container');
try {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'container-probe-result.json'), JSON.stringify({ results, report }, null, 1), 'utf8');
  console.log('结果写入: ' + path.join(outDir, 'container-probe-result.json'));
} catch (e) {
  console.log('（结果文件写入失败：' + String(e.message) + '）');
}
if (errs.length) console.log(JSON.stringify(errs));
process.exit(failed.length === 0 ? 0 : 2);
