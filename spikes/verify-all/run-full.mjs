/**
 * WArmy 全量验证套件 — 从头跑一遍
 * 覆盖：包构建产物、i18n、Provider、Security、Instance、Memory、Router、Board、UI 资源
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {fork, execSync} from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
let pass = 0;
let fail = 0;
const fails = [];

function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  OK  ${name}`);
  } else {
    fail++;
    fails.push({ name, detail });
    console.log(`FAIL  ${name}`, detail ?? '');
  }
}

function exists(...parts) {
  return fs.existsSync(path.join(root, ...parts));
}

console.log('=== WArmy verify pass ===');
console.log('root', root);

// 1. 仓库与快照
check('git repo', exists('.git'));
/**
 * 版本 tag：早期读 `.git/refs/tags` 目录且只认 `snapshot-*`（spike 时期命名）。
 * 现在有两处不成立：① clone 会把 ref 打包到 .git/packed-refs，目录可能是空的；
 * ② 发布用的是 `vX.Y.Z`（如 v0.1.0）。所以改用 `git tag` 并同时接受两种命名。
 */
function listTags() {
  try {
    const out = execSync('git tag', { cwd: root, encoding: 'utf8' });
    return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch {
    try {
      const dir = path.join(root, '.git', 'refs', 'tags');
      return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    } catch { return []; }
  }
}
const tags = listTags();
check('has a release tag (v*) or snapshot tag', tags.some((t) => t.startsWith('snapshot-') || /^v\d/.test(t)), tags);

// 2. 包结构
const pkgs = [
  'contracts', 'providers', 'app-shell', 'memory-os', 'group-router',
  'board', 'dsh-runtime', 'ccr-compressor', 'sync-protocol', 'knowledge-base', 'asset-governance',
];
for (const p of pkgs) {
  check(`pkg ${p}`, exists('packages', p, 'package.json'));
}

// 3. dist 产物
for (const p of ['contracts', 'providers', 'app-shell', 'memory-os', 'group-router', 'board']) {
  check(`dist ${p}`, exists('packages', p, 'dist', 'index.js'));
}
check('electron main', exists('packages', 'app-shell', 'dist', 'electron-main.js'));
check('preload', exists('packages', 'app-shell', 'dist', 'preload.cjs'));
check('renderer html', exists('packages', 'app-shell', 'dist', 'renderer', 'index.html'));
check('renderer js', exists('packages', 'app-shell', 'dist', 'renderer', 'app.js'));
check('renderer css', exists('packages', 'app-shell', 'dist', 'renderer', 'app.css'));
check('i18n zh', exists('packages', 'app-shell', 'dist', 'i18n', 'zh-CN.json'));
check('i18n en', exists('packages', 'app-shell', 'dist', 'i18n', 'en-US.json'));
check('memory ipc', exists('packages', 'memory-os', 'dist', 'ipc.js'));

// 4. i18n 键对齐 + 关键键
const zh = JSON.parse(fs.readFileSync(path.join(root, 'packages/app-shell/dist/i18n/zh-CN.json'), 'utf8'));
const en = JSON.parse(fs.readFileSync(path.join(root, 'packages/app-shell/dist/i18n/en-US.json'), 'utf8'));
const zk = Object.keys(zh);
const ek = Object.keys(en);
check('i18n key count match', zk.length === ek.length && zk.length > 100, { zh: zk.length, en: ek.length });
check('i18n no missing en', zk.every((k) => k in en), zk.filter((k) => !(k in en)).slice(0, 5));
check('i18n no missing zh', ek.every((k) => k in zh), ek.filter((k) => !(k in zh)).slice(0, 5));
check('displayName zh name', zh['app.zhName'] === '无限牛马');
check('displayName en name', en['app.enName'] === 'WArmy');
for (const k of ['nav.settings', 'chat.send', 'dashboard.title', 'me.username', 'settings.providers', 'chat.stopAll']) {
  check(`i18n has ${k}`, typeof zh[k] === 'string' && typeof en[k] === 'string');
}

// 5. UI 源码关键能力
const appJs = fs.readFileSync(path.join(root, 'packages/app-shell/src/renderer/app.js'), 'utf8');
const appCss = fs.readFileSync(path.join(root, 'packages/app-shell/src/renderer/app.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'packages/app-shell/src/renderer/index.html'), 'utf8');
const mainTs = fs.readFileSync(path.join(root, 'packages/app-shell/src/electron-main.ts'), 'utf8');

check('no system alert(', !/(^|[^.\w])alert\(/.test(appJs));
check('uiAlert defined', appJs.includes('function uiAlert'));
check('uiConfirm defined', appJs.includes('function uiConfirm'));
check('uiPrompt defined', appJs.includes('function uiPrompt'));
check('modal-root in html', html.includes('id="modal-root"'));
check('username display', appJs.includes('username-input') || appJs.includes('username-display'));
check('username input', appJs.includes('id="p-name"'));
check('light rail', appCss.includes('--rail-bg: #ebebeb') || appCss.includes('--rail-bg:#ebebeb'));
check('dark rail', appCss.includes('[data-theme="dark"]'));
check('rail active accent', appCss.includes('--rail-active: var(--accent)'));
check('resizer list', html.includes('col-resizer'));
check('resizer panel', html.includes('panel-resizer'));
check('voice btn', html.includes('btn-voice'));
check('attach btn', html.includes('btn-attach'));
check('menu removed', mainTs.includes('Menu.setApplicationMenu(null)'));
check('group create ipc', mainTs.includes('warmy:group-create'));
check('board ipc', mainTs.includes('warmy:board-tasks'));
check('list models ipc', mainTs.includes('warmy:list-models'));
check('theme ipc', mainTs.includes('warmy:set-theme-source'));

// 6. 动态加载已构建包
const ascii = path.join(os.tmpdir(), 'warmy-verify-pkgs');
fs.rmSync(ascii, { recursive: true, force: true });
fs.mkdirSync(ascii, { recursive: true });
for (const p of ['contracts', 'providers', 'group-router', 'board']) {
  const dst = path.join(ascii, p);
  fs.mkdirSync(path.join(dst, 'dist'), { recursive: true });
  fs.copyFileSync(path.join(root, 'packages', p, 'package.json'), path.join(dst, 'package.json'));
  for (const f of fs.readdirSync(path.join(root, 'packages', p, 'dist'))) {
    fs.copyFileSync(path.join(root, 'packages', p, 'dist', f), path.join(dst, 'dist', f));
  }
}

function toImportUrl(p) {
  return pathToFileURL(p).href;
}

const { congYuSheChuangJian, PROVIDER_PRESETS, guiFanYongLiang } = await import(
  toImportUrl(path.join(ascii, 'providers', 'dist', 'index.js'))
);
check('presets>=7', PROVIDER_PRESETS.length >= 7);
check('3 protocols', new Set(PROVIDER_PRESETS.map((p) => p.protocol)).size === 3);
const ds = congYuSheChuangJian('deepseek', { apiKey: 'sk-x' });
check('deepseek base', ds.baseURL === 'https://api.deepseek.com');
const u = guiFanYongLiang({ prompt_cache_hit_tokens: 64, prompt_tokens: 100, completion_tokens: 5 }, 'openai-compatible');
check('cache normalize', u.cacheHitTokens === 64);

const { GroupChatRouter, DEFAULT_PERMISSIONS } = await import(
  toImportUrl(path.join(ascii, 'group-router', 'dist', 'index.js'))
);
const router = new GroupChatRouter();
router.createGroup({
  groupId: 'g1', name: 'G', type: 'internal', dutyInstanceId: null,
  directedMode: false, members: [], permissions: DEFAULT_PERMISSIONS, checkpointLimit: 50,
});
router.join('g1', { id: 'a', name: 'A', local: true, dutyEligible: true, status: 'idle' });
router.join('g1', { id: 'r', name: 'R', local: false, dutyEligible: true, status: 'idle' });
check('remote not duty', router.listMembers('g1').find((m) => m.id === 'r')?.dutyEligible === false);
check('duty is a', router.selectDuty('g1')?.id === 'a');
const route = router.route({
  groupId: 'g1', userId: 'u', content: 'hello', urgency: 'P2', mentionIds: [], timestamp: Date.now(),
});
check('route dispatch', route.action === 'dispatch');

const { KanbanCang, JieLing } = await import(
  toImportUrl(path.join(ascii, 'board', 'dist', 'index.js'))
);
const boardDir = path.join(os.tmpdir(), 'warmy-verify-board-' + Date.now());
const board = new KanbanCang(boardDir);
check('board duty only', (() => {
  try {
    board.append({ groupId: 'g', action: 'create_task', title: 't', parsedFrom: 'x' }, 'router');
    return false;
  } catch {
    return true;
  }
})());
board.append({ groupId: 'g1', action: 'create_task', title: '整理周报', parsedFrom: '新建任务: 整理周报' }, 'duty');
board.append({ groupId: 'g1', action: 'update_progress', title: '整理周报', progress: 50, parsedFrom: 'x' }, 'duty');
const tasks = board.listTasks('g1');
check('board task progress', tasks[0]?.progress === 50 && tasks[0]?.status === 'doing', tasks[0]);
check('parse board cmd', JieLing('新建任务: 测试', 'g')?.action === 'create_task');
fs.rmSync(boardDir, { recursive: true, force: true });

// 7. memory-os 直接类（ASCII 拷贝）
const memSrc = path.join(root, 'packages', 'memory-os');
const memAscii = path.join(os.tmpdir(), 'warmy-verify-mem');
fs.rmSync(memAscii, { recursive: true, force: true });
fs.mkdirSync(path.join(memAscii, 'dist'), { recursive: true });
fs.copyFileSync(path.join(memSrc, 'package.json'), path.join(memAscii, 'package.json'));
for (const f of fs.readdirSync(path.join(memSrc, 'dist'))) {
  fs.copyFileSync(path.join(memSrc, 'dist', f), path.join(memAscii, 'dist', f));
}
const nm = path.join(memSrc, 'node_modules');
if (fs.existsSync(nm)) fs.symlinkSync(nm, path.join(memAscii, 'node_modules'), 'junction');
const { MemoryService } = await import(toImportUrl(path.join(memAscii, 'dist', 'index.js')));
const memDir = path.join(os.tmpdir(), 'warmy-verify-memdata-' + Date.now());
const mem = new MemoryService({ dataDir: memDir });
mem.append({ id: 'r1', sessionId: 's', kind: 'message', body: '无限牛马项目进度' }, 'duty');
const cards = mem.recall('牛马');
check('memory fts recall', cards.length >= 1, cards.length);
mem.close();
fs.rmSync(memDir, { recursive: true, force: true });
fs.rmSync(memAscii, { recursive: true, force: true });

// 7b. CCR / knowledge / sync / assets / checkpoint
for (const p of ['ccr-compressor', 'knowledge-base', 'sync-protocol', 'asset-governance']) {
  check(`dist ${p}`, exists('packages', p, 'dist', 'index.js'));
  const dst = path.join(ascii, p);
  fs.mkdirSync(path.join(dst, 'dist'), { recursive: true });
  fs.copyFileSync(path.join(root, 'packages', p, 'package.json'), path.join(dst, 'package.json'));
  for (const f of fs.readdirSync(path.join(root, 'packages', p, 'dist'))) {
    fs.copyFileSync(path.join(root, 'packages', p, 'dist', f), path.join(dst, 'dist', f));
  }
}

const { CcrGateway } = await import(toImportUrl(path.join(ascii, 'ccr-compressor', 'dist', 'index.js')));
const ccr = new CcrGateway(200);
const big = Array.from({ length: 80 }, (_, i) => `line-${i} payload value ${i}`).join('\n');
const out = ccr.beforeLog({ kind: 'tool_result', content: big, toolName: 'bash' });
check('ccr compresses', out.compressedBytes < out.originalBytes && (out.truncated || out.ratio < 1), {
  o: out.originalBytes,
  c: out.compressedBytes,
  t: out.truncated,
  r: out.ratio,
});

const { KnowledgeBase } = await import(toImportUrl(path.join(ascii, 'knowledge-base', 'dist', 'index.js')));
const kbDir = path.join(os.tmpdir(), 'warmy-verify-kb-' + Date.now());
const kb = new KnowledgeBase(kbDir);
kb.upsertEntity({ id: 'e1', kind: 'person', name: '值班者A', attrs: { role: 'duty' }, anchors: [] });
kb.addEvent({ id: 'ev1', title: '完成周报', entityIds: ['e1'], anchors: [], ts: Date.now() });
check('kb bidirectional', kb.eventsOfEntity('e1').length === 1 && kb.entitiesOfEvent('ev1')[0]?.id === 'e1');
check('kb query', kb.query('周报').events.length === 1);
fs.rmSync(kbDir, { recursive: true, force: true });

const { JieDianMingCe, TongbuZongxian, chuangjianYaoQing, shiYongYaoQing, niMingGongZuoMuLu } = await import(
  toImportUrl(path.join(ascii, 'sync-protocol', 'dist', 'index.js'))
);
const regFile = path.join(os.tmpdir(), 'warmy-verify-reg.json');
const reg = new JieDianMingCe(regFile);
const local = reg.registerLocal('A');
const remote = reg.pairRemote('node-b', 'B');
check('registry local', reg.isLocal(local.nodeId) && !reg.isLocal(remote.nodeId));
const busDir = path.join(os.tmpdir(), 'warmy-verify-bus');
const bus = new TongbuZongxian(busDir);
bus.publish({ fromNode: local.nodeId, toNode: remote.nodeId, channel: 'group', payload: { text: 'hi' } });
const incog = bus.publish({ fromNode: remote.nodeId, toNode: local.nodeId, channel: 'group', payload: { text: 'secret' }, incognito: true });
const pulled = bus.pull(remote.nodeId);
check('sync bus deliver', pulled.some((m) => (m.payload)?.text === 'hi'));
check('incognito not persisted', !bus.pull(local.nodeId).some((m) => m.id === incog.id));
const inv = chuangjianYaoQing(1000, 'g1');
check('invite once', shiYongYaoQing(inv) && !shiYongYaoQing(inv));
check('incog dir', niMingGongZuoMuLu().includes('incog'));
fs.rmSync(busDir, { recursive: true, force: true });
fs.rmSync(regFile, { force: true });

const { ZichanGuanliqi } = await import(toImportUrl(path.join(ascii, 'asset-governance', 'dist', 'index.js')));
const gov = new ZichanGuanliqi();
gov.register({ id: 'a1', category: 'rule', scope: 'project', strength: 'strong', title: 'r', body: 'b' });
check('assets strict empty', gov.retrieve({ strict: true }).length === 0);
check('assets normal has', gov.retrieve({}).length === 1);
gov.negativeFeedback('a1', 6);
check('assets downrank', gov.list()[0]?.strength === 'weak');

// checkpoint
const { JianChaDianCang } = await import(
  toImportUrl(path.join(root, 'packages', 'app-shell', 'dist', 'checkpoint.js'))
);
const cpDir = path.join(os.tmpdir(), 'warmy-verify-cp-' + Date.now());
const cps = new JianChaDianCang(cpDir);
const jsonl = path.join(cpDir, 'mem.jsonl');
fs.writeFileSync(jsonl, '{"seq":1}\n');
const cp = cps.create({ phase: 'round_end', logSeq: 1, jsonlPath: jsonl });
fs.writeFileSync(jsonl, '{"seq":999}\n');
check('checkpoint create', !!cp.id && cps.list().length === 1);
check('checkpoint rollback', cps.rollback(cp.id, { jsonlPath: jsonl }) && fs.readFileSync(jsonl, 'utf8').includes('"seq":1'));
fs.rmSync(cpDir, { recursive: true, force: true });

// main process chat IPC surface
check('chat-send ipc', mainTs.includes('warmy:chat-send'));
check('checkpoint ipc', mainTs.includes('warmy:checkpoint-create'));
check('knowledge ipc', mainTs.includes('warmy:knowledge-query'));
check('set-provider ipc', mainTs.includes('warmy:set-provider'));
const appJs2 = fs.readFileSync(path.join(root, 'packages/app-shell/src/renderer/app.js'), 'utf8');
check('renderer uses chatSend', appJs2.includes('warmy.chatSend'));
check('renderer setProvider', appJs2.includes('warmy.setProvider'));

// 8. ADR / agents / lock
check('ADR archived', exists('docs', 'ADR', '000-多智能体群聊桌面应用定稿方案.md'));
check('UI agents installed', exists('packages', 'app-shell', 'agents', 'design-ui-designer.md'));
check('pnpm lock', exists('pnpm-lock.yaml'));
// .npmrc：原意图（防"意外注册表抢占"——那会静默改变所有人装到的东西）**保留**，
// 但打包流水线需要一个**二进制镜像**：github.com 在本机不可达，electron-builder 的
// winCodeSign / nsis / nsis-resources 只能走 npmmirror（pnpm 把它导出成
// npm_config_electron_builder_binaries_mirror，app-builder-lib 在 out/binDownload.js 里读）。
// 因此从"一刀切禁止镜像"改成 **allowlist of one**：
//  ① 不得设置通用包 registry（含 @scope:registry）——抢占注册表是最危险的那类改动；
//  ② 凡 URL 形态的赋值只允许**恰好一条**，且必须正是那条 electron-builder-binaries 镜像；
//  ③ 该镜像行**必须存在**（打包 NSIS 依赖它）；
//  ④ 仍要 save-exact=true。
// 换个镜像 URL、再加一条镜像（electron_mirror / disturl / node_mirror…）、或者加 registry=，
// 都会真的 FAIL。
const npmrcText = fs.readFileSync(path.join(root, '.npmrc'), 'utf8');
const npmrcLines = npmrcText
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#') && !l.startsWith(';'));
const npmrcApprovedMirror =
  'electron_builder_binaries_mirror=https://registry.npmmirror.com/-/binary/electron-builder-binaries/';
const npmrcRegistryHijack = npmrcLines.filter((l) => /(^|:)registry$/i.test(l.split('=')[0].trim()));
const npmrcUrlSettings = npmrcLines.filter((l) => /^[^=]+=\s*https?:\/\//.test(l));
const npmrcProblems = [
  !npmrcLines.includes('save-exact=true') && 'missing save-exact=true（原意图：锁死依赖版本）',
  npmrcRegistryHijack.length > 0 && `registry hijack: ${npmrcRegistryHijack.join(' | ')}`,
  npmrcUrlSettings.length !== 1 &&
    `expected exactly 1 url-valued setting (allowlist of one), got ${npmrcUrlSettings.length}: ${npmrcUrlSettings.join(' | ')}`,
  npmrcUrlSettings.length === 1 &&
    npmrcUrlSettings[0] !== npmrcApprovedMirror &&
    `url-valued setting is not the approved mirror: ${npmrcUrlSettings[0]}`,
  !npmrcLines.includes(npmrcApprovedMirror) &&
    'missing required electron-builder binaries mirror（打包 NSIS 依赖这一行）',
].filter(Boolean);
check(
  'npmrc: no registry hijack + exactly one approved mirror',
  npmrcProblems.length === 0,
  npmrcProblems.length ? { problems: npmrcProblems, npmrc: npmrcLines } : undefined
);

// 9. 后续交付项
check('electron-builder config', exists('packages', 'app-shell', 'electron-builder.yml'));
check('ci workflow', exists('.github', 'workflows', 'ci.yml'));
check('metrics module', exists('packages', 'app-shell', 'dist', 'metrics.js'));
check('checkpoint cow', fs.readFileSync(path.join(root, 'packages/app-shell/src/checkpoint.ts'), 'utf8').includes('COPYFILE_FICLONE'));
check('settings store', exists('packages', 'app-shell', 'dist', 'settings-store.js'));
check('save-voice ipc', mainTs.includes('warmy:save-voice'));
check('metrics ipc', mainTs.includes('warmy:metrics-summary'));
check('nodes ipc', mainTs.includes('warmy:nodes-list'));
check('profile login ipc', mainTs.includes('warmy:profile-login'));
check('settings persist ipc', mainTs.includes('warmy:settings-save'));
check('renderer metrics panel', html.includes('metrics-box'));
check('renderer checkpoint panel', html.includes('cp-detail-list'));
check('renderer knowledge', html.includes('btn-kb-go'));
check('renderer saveVoice', appJs.includes('saveVoice'));
check('renderer profileSave', appJs.includes('profileSave'));
check('i18n metrics keys', typeof zh['metrics.title'] === 'string' && typeof en['metrics.title'] === 'string');
check('i18n cp keys', typeof zh['cp.rollback'] === 'string');
check('executor module', exists('packages', 'app-shell', 'dist', 'executor.js'));
check('asset-wire module', exists('packages', 'app-shell', 'dist', 'asset-wire.js'));
check('executor ipc', mainTs.includes('warmy:executor-run'));
check('assets ipc', mainTs.includes('warmy:assets-retrieve'));
check('kb-from-chat ipc', mainTs.includes('warmy:kb-from-chat'));
check('preload executor', fs.readFileSync(path.join(root, 'packages/app-shell/src/preload.cjs'), 'utf8').includes('executorRun'));
check('orchestrator module', exists('packages', 'app-shell', 'dist', 'orchestrator.js'));
check('orchestrate ipc', mainTs.includes('warmy:group-orchestrate'));
check('approval ipc', mainTs.includes('warmy:request-approval'));
check('cost ipc', mainTs.includes('warmy:cost-summary'));
check('status card', fs.readFileSync(path.join(root, 'packages/app-shell/src/orchestrator.ts'), 'utf8').includes('buildStatusCard'));
check('renderer approval modal', appJs.includes('showApprovalDialog'));
check('renderer cost', appJs.includes('costSummary'));
check('renderer kb save', html.includes('btn-kb-save'));
check('i18n approval keys', typeof zh['approval.once'] === 'string');
check('checkpoint detail fields', fs.readFileSync(path.join(root, 'packages/app-shell/src/checkpoint.ts'), 'utf8').includes('filesChanged'));
check('approval onApprove', mainTs.includes('onApprove'));
check('executors-status ipc', mainTs.includes('warmy:executors-status'));
check('asr ipc', mainTs.includes('warmy:asr-transcribe'));
check('state-save ipc', mainTs.includes('warmy:state-save'));
check('renderer exec panel', html.includes('exec-box'));
check('renderer asr', appJs.includes('asrTranscribe'));
check('renderer stateSave', appJs.includes('stateSave'));
check('provider delete', appJs.includes('data-prov-del'));
check('model add/del', appJs.includes('i-del-model') && appJs.includes('i-add-model'));
check('open-chat-window ipc', mainTs.includes('warmy:open-chat-window'));
check('hotkey ipc', mainTs.includes('warmy:register-hotkey'));
check('tray ipc', mainTs.includes('warmy:tray-init'));
check('export ipc', mainTs.includes('warmy:export-session'));
check('auto-update ipc', mainTs.includes('warmy:auto-update-check'));
check('checkpoint mtime', fs.readFileSync(path.join(root, 'packages/app-shell/src/checkpoint.ts'), 'utf8').includes('mtimeMs'));
check('renderer open window', appJs.includes('btn-open-win'));
check('renderer export', appJs.includes('btn-export'));
check('preload openChatWindow', fs.readFileSync(path.join(root, 'packages/app-shell/src/preload.cjs'), 'utf8').includes('openChatWindow'));
check('i18n export keys', typeof zh['chat.export'] === 'string');
check('group-members ipc', mainTs.includes('warmy:group-members'));
check('board-session ipc', mainTs.includes('warmy:board-session'));
check('ccr-tool ipc', mainTs.includes('warmy:ccr-tool-output'));
check('kb-detail ipc', mainTs.includes('warmy:kb-detail'));
check('last-error ipc', mainTs.includes('warmy:last-error'));
check('setup ipc', mainTs.includes('warmy:setup-state'));
check('renderer board sess', appJs.includes('refreshSessionBoard'));
check('renderer setup', appJs.includes('maybeShowSetup'));
check('i18n retry key', typeof zh['common.retry'] === 'string');
check('search-messages ipc', mainTs.includes('warmy:search-messages'));
check('plugin-install ipc', mainTs.includes('warmy:plugin-install'));
check('archived ipc', mainTs.includes('warmy:archived-list'));
check('renderer chat search', appJs.includes('btn-chat-search'));
check('renderer directed', appJs.includes('btn-directed'));
check('html directed', html.includes('mi-directed'));
check('i18n copy quote', typeof zh['common.copy'] === 'string');
check('renderer archived', appJs.includes('refreshArchived'));
check('renderer kb detail', appJs.includes('kbDetail'));
check('renderer cost dash', appJs.includes('renderCostDash'));
check('html cost dash', html.includes('cost-dash') && html.includes('btn-cost-csv'));
check('html archived', appJs.includes('archived-box'));
check('audit module', exists('packages', 'app-shell', 'dist', 'audit.js'));
check('secure-keys module', exists('packages', 'app-shell', 'dist', 'secure-keys.js'));
check('archive-cleanup module', exists('packages', 'app-shell', 'dist', 'archive-cleanup.js'));
check('model-roles module', exists('packages', 'app-shell', 'dist', 'model-roles.js'));
check('memory-os migrate', exists('packages', 'memory-os', 'dist', 'migrate.js'));
check('memory-os lock', exists('packages', 'memory-os', 'dist', 'lock.js'));
check('memory-os vectors', exists('packages', 'memory-os', 'dist', 'vectors.js'));
check('audit ipc', mainTs.includes('warmy:audit-log'));
check('safeStorage ipc', mainTs.includes('warmy:secure-key-save'));
check('archive ipc', mainTs.includes('warmy:archive-external'));
check('cleanup ipc', mainTs.includes('warmy:cleanup-run'));
check('role-models ipc', mainTs.includes('warmy:role-models-set'));
check('dissolve ipc', mainTs.includes('warmy:group-dissolve'));
check('export-allowlist ipc', mainTs.includes('warmy:export-allowlist'));
check('dsh-app protocol', mainTs.includes('dsh-app'));
check('node binaries 5', [
  'node-v24.20.0-win-x64.zip',
  'node-v24.20.0-win-arm64.zip',
  'node-v24.20.0-darwin-x64.tar.gz',
  'node-v24.20.0-darwin-arm64.tar.gz',
  'node-v24.20.0-linux-x64.tar.xz',
].every((f) => exists('resources', 'node', f)));
check('rrf fusion', fs.readFileSync(path.join(root, 'packages/memory-os/src/vectors.ts'), 'utf8').includes('rrfRonghe'));
check('swmr lock', fs.readFileSync(path.join(root, 'packages/memory-os/src/lock.ts'), 'utf8').includes('JsonlSuo'));
check('session v3', fs.readFileSync(path.join(root, 'packages/memory-os/src/migrate.ts'), 'utf8').includes('migrateSessionV2ToV3'));
check('import-openclaw ipc', mainTs.includes('warmy:import-openclaw'));
check('special-models ipc', mainTs.includes('warmy:special-models-set'));
check('ollama-asr ipc', mainTs.includes('warmy:asr-ollama'));
check('renderer raf', appJs.includes('__rafThrottle'));
check('renderer import btn', appJs.includes('btn-import-openclaw'));
check('renderer special models', appJs.includes('btn-save-special'));
check('i18n special models', typeof zh['settings.specialModels'] === 'string');
check('dsh ipc', mainTs.includes('warmy:spawn-dsh-instance'));
check('email ipc', mainTs.includes('warmy:email-queue'));
check('external silent policy', mainTs.includes("type === 'external'"));
check('builder extraResources', fs.readFileSync(path.join(root, 'packages/app-shell/electron-builder.yml'), 'utf8').includes('memory-os/dist'));
check('renderer spawnDsh', appJs.includes('spawnDshInstance'));
check('smtp verify ipc', mainTs.includes('warmy:smtp-verify'));
check('lan start ipc', mainTs.includes('warmy:lan-start'));
check('lan dual smoke', mainTs.includes('warmy:lan-dual-smoke'));
check('smtp not hardcoded', !mainTs.includes('smtp.qq.com') && !mainTs.includes('@gmail.com'));
check('renderer smtp add btn', appJs.includes('btn-smtp-add') && appJs.includes('smtpAdd'));
// 内网同步 / 多节点组网：产品负责人**明确要求**把这两个设置块从 UI 移除（功能由下方
// 「组网设置」卡片 id="net-card" 承接）；但底层 IPC 通道 warmy:lan-* / warmy:mesh-*
// 仍是**产品契约**——删掉就是破坏契约变更。所以拆成一对，比原来单看一个 id 更严：
//  ① 旧入口在渲染层**不存在**了（原区块的全部 DOM id 都查一遍），且替代入口（net-card）必须在
//     ——否则"整段删掉什么都不过关"也能骗过纯否定断言；
//  ② 通道**两边都还在**：主进程已注册（handleIpc）+ preload 已暴露（ipcRenderer.invoke）。
const lanMeshRetiredUiIds = [
  'btn-lan-start', 'btn-lan-stop', 'btn-lan-send', 'btn-lan-dual',
  'lan-port', 'lan-host', 'lan-pport', 'lan-msg', 'lan-inbox',
  'btn-mesh-start', 'btn-mesh-stop', 'btn-mesh-bcast',
  'mesh-port', 'peer-name', 'peer-host', 'peer-port', 'btn-peer-add',
  'mesh-msg', 'mesh-inbox',
];
const lanMeshUiProblems = [];
for (const [file, src] of [['renderer/app.js', appJs], ['renderer/index.html', html]]) {
  for (const id of lanMeshRetiredUiIds) {
    if (src.includes(id)) lanMeshUiProblems.push(`retired lan/mesh UI entry still present: ${file}:${id}`);
  }
}
if (!appJs.includes('id="net-card"')) {
  lanMeshUiProblems.push('successor 组网设置 card (id="net-card") not found — 旧块不该靠"删干净"过关');
}
check('renderer lan/mesh settings blocks removed', lanMeshUiProblems.length === 0, lanMeshUiProblems);

const lanMeshChannels = [
  'warmy:lan-start', 'warmy:lan-stop', 'warmy:lan-send', 'warmy:lan-inbox', 'warmy:lan-status', 'warmy:lan-dual-smoke',
  'warmy:mesh-start', 'warmy:mesh-stop', 'warmy:mesh-broadcast', 'warmy:mesh-inbox', 'warmy:mesh-status',
];
const preloadSrc = fs.readFileSync(path.join(root, 'packages/app-shell/src/preload.cjs'), 'utf8');
const lanMeshContractMissing = lanMeshChannels.filter(
  (ch) =>
    !new RegExp(`(?:handleIpc|chuliIpc)\\(\\s*'${ch}'`).test(mainTs) || // 主进程注册（handleIpc 实参允许换行）
    !preloadSrc.includes(`invoke('${ch}'`), // preload 暴露
);
check(
  'lan/mesh ipc contract intact (main + preload)',
  lanMeshContractMissing.length === 0 && lanMeshChannels.length === 11,
  lanMeshContractMissing
);
check('renderer webgpu test', appJs.includes('btn-webgpu'));

const { dualMachineSmoke } = await import(
  toImportUrl(path.join(ascii, 'sync-protocol', 'dist', 'lan.js'))
);
const lan = await dualMachineSmoke({ localId: 'verify-node', localPort: 7799 });
check('lan loopback', lan.loopbackOk === true, lan);

const { MetricsCollector } = await import(
  toImportUrl(path.join(root, 'packages', 'app-shell', 'dist', 'metrics.js'))
);
const mc = new MetricsCollector();
mc.recordTurn({
  sessionId: 's', ts: Date.now(), promptTokens: 100, completionTokens: 10,
  cacheHitTokens: 90, cacheMissTokens: 10, durationMs: 20, providerId: 'deepseek', model: 'deepseek-chat',
});
const sum = mc.summary();
check('metrics cache rate', sum.cacheHitRate === 0.9 && sum.turns === 1, sum);

const { LocalAccountStore, SettingsStore } = await import(
  toImportUrl(path.join(root, 'packages', 'app-shell', 'dist', 'settings-store.js'))
);
const accFile = path.join(os.tmpdir(), 'warmy-verify-acc.json');
const acc = new LocalAccountStore(accFile);
acc.setPassword('secret123');
check('local login', acc.loginLocal('secret123').ok === true && acc.loginLocal('wrong').ok === false);
fs.rmSync(accFile, { force: true });
const setFile = path.join(os.tmpdir(), 'warmy-verify-set.json');
const st = new SettingsStore(setFile);
st.save({ themeMode: 'dark', accent: '#3d8bfd' });
check('settings persist', st.load().themeMode === 'dark');
fs.rmSync(setFile, { force: true });

console.log('\n=== SUMMARY ===');
console.log(`pass=${pass} fail=${fail}`);
if (fails.length) {
  console.log('FAILURES:');
  for (const f of fails) console.log(' -', f.name, f.detail ?? '');
  process.exit(1);
}
console.log('ALL PASS');
process.exit(0);
