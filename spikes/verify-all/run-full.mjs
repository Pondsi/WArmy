/**
 * CCArmy 全量验证套件 — 从头跑一遍
 * 覆盖：包构建产物、i18n、Provider、Security、Instance、Memory、Router、Board、UI 资源
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fork } from 'node:child_process';

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

console.log('=== CCArmy verify pass ===');
console.log('root', root);

// 1. 仓库与快照
check('git repo', exists('.git'));
const tags = fs.existsSync(path.join(root, '.git', 'refs', 'tags'))
  ? fs.readdirSync(path.join(root, '.git', 'refs', 'tags'))
  : [];
check('has snapshot tags', tags.some((t) => t.startsWith('snapshot-')), tags);

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
check('displayName en name', en['app.enName'] === 'CCArmy');
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
check('username display', appJs.includes('p-name-display') && appJs.includes('username-display'));
check('username input', appJs.includes('id="p-name"'));
check('light rail', appCss.includes('--rail-bg: #ebebeb') || appCss.includes('--rail-bg:#ebebeb'));
check('dark rail', appCss.includes('[data-theme="dark"]'));
check('rail active accent', appCss.includes('--rail-active: var(--accent)'));
check('resizer list', html.includes('col-resizer'));
check('resizer panel', html.includes('panel-resizer'));
check('voice btn', html.includes('btn-voice'));
check('attach btn', html.includes('btn-attach'));
check('menu removed', mainTs.includes('Menu.setApplicationMenu(null)'));
check('group create ipc', mainTs.includes('ccarmy:group-create'));
check('board ipc', mainTs.includes('ccarmy:board-tasks'));
check('list models ipc', mainTs.includes('ccarmy:list-models'));
check('theme ipc', mainTs.includes('ccarmy:set-theme-source'));

// 6. 动态加载已构建包
const ascii = path.join(os.tmpdir(), 'ccarmy-verify-pkgs');
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

const { createProviderFromPreset, PROVIDER_PRESETS, normalizeUsage } = await import(
  toImportUrl(path.join(ascii, 'providers', 'dist', 'index.js'))
);
check('presets>=7', PROVIDER_PRESETS.length >= 7);
check('3 protocols', new Set(PROVIDER_PRESETS.map((p) => p.protocol)).size === 3);
const ds = createProviderFromPreset('deepseek', { apiKey: 'sk-x' });
check('deepseek base', ds.baseURL === 'https://api.deepseek.com');
const u = normalizeUsage({ prompt_cache_hit_tokens: 64, prompt_tokens: 100, completion_tokens: 5 }, 'openai-compatible');
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

const { BoardStore, parseBoardCommand } = await import(
  toImportUrl(path.join(ascii, 'board', 'dist', 'index.js'))
);
const boardDir = path.join(os.tmpdir(), 'ccarmy-verify-board-' + Date.now());
const board = new BoardStore(boardDir);
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
check('parse board cmd', parseBoardCommand('新建任务: 测试', 'g')?.action === 'create_task');
fs.rmSync(boardDir, { recursive: true, force: true });

// 7. memory-os 直接类（ASCII 拷贝）
const memSrc = path.join(root, 'packages', 'memory-os');
const memAscii = path.join(os.tmpdir(), 'ccarmy-verify-mem');
fs.rmSync(memAscii, { recursive: true, force: true });
fs.mkdirSync(path.join(memAscii, 'dist'), { recursive: true });
fs.copyFileSync(path.join(memSrc, 'package.json'), path.join(memAscii, 'package.json'));
for (const f of fs.readdirSync(path.join(memSrc, 'dist'))) {
  fs.copyFileSync(path.join(memSrc, 'dist', f), path.join(memAscii, 'dist', f));
}
const nm = path.join(memSrc, 'node_modules');
if (fs.existsSync(nm)) fs.symlinkSync(nm, path.join(memAscii, 'node_modules'), 'junction');
const { MemoryService } = await import(toImportUrl(path.join(memAscii, 'dist', 'index.js')));
const memDir = path.join(os.tmpdir(), 'ccarmy-verify-memdata-' + Date.now());
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
const kbDir = path.join(os.tmpdir(), 'ccarmy-verify-kb-' + Date.now());
const kb = new KnowledgeBase(kbDir);
kb.upsertEntity({ id: 'e1', kind: 'person', name: '值班者A', attrs: { role: 'duty' }, anchors: [] });
kb.addEvent({ id: 'ev1', title: '完成周报', entityIds: ['e1'], anchors: [], ts: Date.now() });
check('kb bidirectional', kb.eventsOfEntity('e1').length === 1 && kb.entitiesOfEvent('ev1')[0]?.id === 'e1');
check('kb query', kb.query('周报').events.length === 1);
fs.rmSync(kbDir, { recursive: true, force: true });

const { NodeRegistry, SyncBus, createInvite, consumeInvite, incognitoWorkDir } = await import(
  toImportUrl(path.join(ascii, 'sync-protocol', 'dist', 'index.js'))
);
const regFile = path.join(os.tmpdir(), 'ccarmy-verify-reg.json');
const reg = new NodeRegistry(regFile);
const local = reg.registerLocal('A');
const remote = reg.pairRemote('node-b', 'B');
check('registry local', reg.isLocal(local.nodeId) && !reg.isLocal(remote.nodeId));
const busDir = path.join(os.tmpdir(), 'ccarmy-verify-bus');
const bus = new SyncBus(busDir);
bus.publish({ fromNode: local.nodeId, toNode: remote.nodeId, channel: 'group', payload: { text: 'hi' } });
const incog = bus.publish({ fromNode: remote.nodeId, toNode: local.nodeId, channel: 'group', payload: { text: 'secret' }, incognito: true });
const pulled = bus.pull(remote.nodeId);
check('sync bus deliver', pulled.some((m) => (m.payload)?.text === 'hi'));
check('incognito not persisted', !bus.pull(local.nodeId).some((m) => m.id === incog.id));
const inv = createInvite(1000, 'g1');
check('invite once', consumeInvite(inv) && !consumeInvite(inv));
check('incog dir', incognitoWorkDir().includes('incog'));
fs.rmSync(busDir, { recursive: true, force: true });
fs.rmSync(regFile, { force: true });

const { AssetGovernor } = await import(toImportUrl(path.join(ascii, 'asset-governance', 'dist', 'index.js')));
const gov = new AssetGovernor();
gov.register({ id: 'a1', category: 'rule', scope: 'project', strength: 'strong', title: 'r', body: 'b' });
check('assets strict empty', gov.retrieve({ strict: true }).length === 0);
check('assets normal has', gov.retrieve({}).length === 1);
gov.negativeFeedback('a1', 6);
check('assets downrank', gov.list()[0]?.strength === 'weak');

// checkpoint
const { CheckpointStore } = await import(
  toImportUrl(path.join(root, 'packages', 'app-shell', 'dist', 'checkpoint.js'))
);
const cpDir = path.join(os.tmpdir(), 'ccarmy-verify-cp-' + Date.now());
const cps = new CheckpointStore(cpDir);
const jsonl = path.join(cpDir, 'mem.jsonl');
fs.writeFileSync(jsonl, '{"seq":1}\n');
const cp = cps.create({ phase: 'round_end', logSeq: 1, jsonlPath: jsonl });
fs.writeFileSync(jsonl, '{"seq":999}\n');
check('checkpoint create', !!cp.id && cps.list().length === 1);
check('checkpoint rollback', cps.rollback(cp.id, { jsonlPath: jsonl }) && fs.readFileSync(jsonl, 'utf8').includes('"seq":1'));
fs.rmSync(cpDir, { recursive: true, force: true });

// main process chat IPC surface
check('chat-send ipc', mainTs.includes('ccarmy:chat-send'));
check('checkpoint ipc', mainTs.includes('ccarmy:checkpoint-create'));
check('knowledge ipc', mainTs.includes('ccarmy:knowledge-query'));
check('set-provider ipc', mainTs.includes('ccarmy:set-provider'));
const appJs2 = fs.readFileSync(path.join(root, 'packages/app-shell/src/renderer/app.js'), 'utf8');
check('renderer uses chatSend', appJs2.includes('ccarmy.chatSend'));
check('renderer setProvider', appJs2.includes('ccarmy.setProvider'));

// 8. ADR / agents / lock
check('ADR archived', exists('docs', 'ADR', '000-多智能体群聊桌面应用定稿方案.md'));
check('UI agents installed', exists('packages', 'app-shell', 'agents', 'design-ui-designer.md'));
check('pnpm lock', exists('pnpm-lock.yaml'));
check('no mirror in npmrc', (() => {
  const n = fs.readFileSync(path.join(root, '.npmrc'), 'utf8');
  return !n.includes('registry.npmmirror') && n.includes('save-exact');
})());

console.log('\n=== SUMMARY ===');
console.log(`pass=${pass} fail=${fail}`);
if (fails.length) {
  console.log('FAILURES:');
  for (const f of fails) console.log(' -', f.name, f.detail ?? '');
  process.exit(1);
}
console.log('ALL PASS');
process.exit(0);
