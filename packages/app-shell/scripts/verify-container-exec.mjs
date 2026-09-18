/**
 * ADR 004 第十六批验收：**真实执行面 + 项目级属性 + 台账 + 固化/回滚 + 宿主目录加锁**。
 *
 *   node packages/app-shell/scripts/verify-container-exec.mjs [--no-container]
 *
 * 与另两个脚本的分工：
 *   · `verify-container-probe.mjs`  —— 探测/三态/门禁/项目状态推导（**不放**真实执行）；
 *   · `verify-container-real.mjs`   —— 真机引擎启停与镜像拉取（会改本机状态，刻意不进默认门禁）；
 *   · **本脚本** —— 把这一轮新增的**真执行**能力逐条压出来：
 *       纯函数（argv 白名单 / 证据等级 / 加锁计划 / 项目属性与台账 / 跨机信号）
 *       + 真容器（`run --rm`、`exec` 进项目容器、`commit` 固化、从固化镜像回滚、真 shell）。
 *
 * 纪律：**只用极小镜像**；自己起的容器/镜像**用完自己清理**（`--no-container` 可全跳过）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const appPkg = path.resolve(selfDir, '..');
const distProbe = path.join(appPkg, 'dist', 'container-probe.js');
const distGroup = path.join(appPkg, 'dist', 'group-store.js');
const distWiring = path.join(appPkg, 'dist', 'net-wiring.js');
const distHelper = path.join(appPkg, 'dist', 'helper-tool.js');
for (const f of [distProbe, distGroup, distWiring, distHelper]) {
  if (!fs.existsSync(f)) {
    console.error('缺少构建产物 ' + f + '，请先 `pnpm --filter @warmy/app-shell build`');
    process.exit(3);
  }
}
const importDist = async (p) => import(new URL('file://' + p.replace(/\\/g, '/')).href);
const P = await importDist(distProbe);
const G = await importDist(distGroup);
const W = await importDist(distWiring);
const H = await importDist(distHelper);

const NO_CONTAINER = process.argv.includes('--no-container');
const results = [];
let failures = 0;
function ok(cond, label, detail) {
  const pass = !!cond;
  if (!pass) failures++;
  results.push({ pass, label, detail: detail === undefined ? null : String(detail).slice(0, 400) });
  console.log((pass ? '  PASS ' : '  FAIL ') + label + (detail === undefined ? '' : '  [' + String(detail).slice(0, 260) + ']'));
  return pass;
}
function section(t) {
  console.log('\n=== ' + t + ' ===');
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ══ 1. argv 白名单：不可能出现"来自不可信来源的命令行" ══ */
section('1. 执行面的 argv 只来自白名单（不接受任何命令字符串）');
ok(P.CONTAINER_EXEC_OPS.length >= 8 && P.CONTAINER_EXEC_OPS.includes('commit') && P.CONTAINER_EXEC_OPS.includes('exec-shell'),
  '1-1 执行操作是**枚举**（ps/run-rm/run-detached/exec-capture/exec-shell/stop/rm/commit/image-inspect/image-rm）',
  P.CONTAINER_EXEC_OPS.join('|'));
const badOp = P.containerExecPlan('docker', 'exec; rm -rf /', {});
ok(badOp.ok === false && badOp.code === 'bad-op', '1-2 未知 op 一律拒绝（拼不进任何命令行）', JSON.stringify(badOp));
const badName = P.containerExecPlan('docker', 'exec-capture', { name: 'evil; rm -rf /', command: 'pwd' });
ok(badName.ok === false && badName.code === 'bad-container-name',
  '1-3 容器名必须是 warmy-<12hex>（外部传入的名字不可能被采纳）', JSON.stringify(badName));
const badImg = P.containerExecPlan('docker', 'run-rm', { image: 'ubuntu:latest', command: 'smoke-echo' });
ok(badImg.ok === false && badImg.code === 'bad-image',
  '1-4 镜像只接受"钉死 digest 的基础镜像"或"我们自己固化出来的层"（浮动 tag 不行）', JSON.stringify(badImg));
const badCmd = P.containerExecPlan('docker', 'run-rm', {
  image: P.CONTAINER_BASE_IMAGES.find((x) => x.id === 'alpine-3.20').ref + '@' + P.CONTAINER_BASE_IMAGES.find((x) => x.id === 'alpine-3.20').digest,
  command: './evil.sh --do-bad-things',
});
ok(badCmd.ok === false && badCmd.code === 'bad-command',
  '1-5 固定命令表以外的东西一律拒绝（`command` 只能是 `CONTAINER_FIXED_COMMAND_IDS` 里的 id）', JSON.stringify(badCmd));
ok(P.CONTAINER_FIXED_COMMAND_IDS.every((id) => P.isFixedCommandId(id)) && !P.isFixedCommandId('rm -rf /'),
  '1-5b 固定命令表可枚举、可校验（面板上"查看容器里有什么"跑的就是它）', P.CONTAINER_FIXED_COMMAND_IDS.join('|'));
const goodRun = P.containerExecPlan('docker', 'run-rm', {
  image: P.CONTAINER_BASE_IMAGES.find((x) => x.id === 'alpine-3.20').ref + '@' + P.CONTAINER_BASE_IMAGES.find((x) => x.id === 'alpine-3.20').digest,
  command: 'smoke-echo',
});
ok(goodRun.ok === true && goodRun.plan.args.join(' ').includes('echo ok'),
  '1-6 合法调用拼出的 argv 是**我们自己的**固定命令（echo ok）', goodRun.ok ? goodRun.plan.args.join(' ') : JSON.stringify(goodRun));
ok(P.CONTAINER_EXEC_SECURITY.argvFromUntrustedSource === false && P.CONTAINER_EXEC_SECURITY.remoteInjectPaths === 0 &&
   P.CONTAINER_EXEC_SECURITY.hostFallback === false && P.CONTAINER_EXEC_SECURITY.fixedCommandsOnly === true,
  '1-7 安全契约写成**可断言**的字段（无不可信 argv / 无远程注入 / 无宿主回退 / 只有固定命令）',
  JSON.stringify(P.CONTAINER_EXEC_SECURITY));
const env = P.scrubbedChildEnv({ PATH: 'x', OPENAI_API_KEY: 'sk-secret', SMTP_PASS: 'p', WARMY_TOKEN: 't', LANG: 'zh_CN.UTF-8' });
ok(env.OPENAI_API_KEY === undefined && env.SMTP_PASS === undefined && env.WARMY_TOKEN === undefined && env.PATH === 'x',
  '1-8 子进程环境先洗一遍：密钥/token/密码类变量**一律不带**', JSON.stringify(Object.keys(env)));

/* ══ 2. 项目容器命名与固化镜像引用（可复算、可校验） ══ */
section('2. 项目容器名 / 固化镜像引用：由 groupId 决定，可复算');
const n1 = P.containerProjectName('g-1');
ok(P.isValidContainerProjectName(n1) && n1 === P.containerProjectName('g-1') && n1 !== P.containerProjectName('g-2'),
  '2-1 容器名 = warmy-<sha256(groupId) 前 12 位>（同名项目可复算，不同项目必不同）', n1);
const ref = P.solidifiedImageRef('g-1', 1700000000000);
ok(P.SOLIDIFIED_IMAGE_RE.test(ref) && P.isAllowedImageRef(ref), '2-2 固化镜像引用形态正确且被放行', ref);
ok(P.isAllowedImageRef('nginx:alpine') === false, '2-3 别人的镜像引用不被放行（固化只碰我们自己的命名空间）');
ok(P.CONTAINER_PROJECT_MOUNT === '/workspace', '2-4 项目目录挂载点是 /workspace（与给用户的安装提示词一致）', P.CONTAINER_PROJECT_MOUNT);

/* ══ 3. 宿主目录加锁：最小侵入 + 一条命令可撤销 ══ */
section('3. 宿主目录加锁（P5）：argv 白名单 + 可撤销 + 平台诚实');
const apply = P.hostDirGuardPlan({ action: 'apply', dir: 'C:\\proj', sid: 'S-1-5-21-1-2-3-1001', platform: 'win32' });
ok(apply.ok === true && apply.plan.file === 'icacls' && apply.plan.args.join(' ').includes('/deny') &&
   apply.plan.args.join(' ').includes('*S-1-5-21-1-2-3-1001:(OI)(CI)(' + P.HOST_DIR_GUARD_RIGHTS + ')'),
  '3-1 加锁 = 一条**继承式** deny「改/建/删」权限（不动子项 ACL，且**不拒读**）',
  apply.ok ? apply.plan.args.join(' ') : JSON.stringify(apply));
ok(!/:(OI)\(CI\)\(W\)$/.test(apply.ok ? apply.plan.args.join(' ') : '') && P.HOST_DIR_GUARD_RIGHTS.indexOf('RD') < 0 &&
   P.HOST_DIR_GUARD_RIGHTS.indexOf('WRITE_DAC') < 0,
  '3-1b 【实测教训】不用笼统的 (W)：那会把 SYNCHRONIZE 一起拒掉 ⇒ **连读都打不开**（本机实测 EPERM）；也不拒 WRITE_DAC，否则用户无法自己解锁',
  P.HOST_DIR_GUARD_RIGHTS);
const lift = P.hostDirGuardPlan({ action: 'lift', dir: 'C:\\proj', sid: 'S-1-5-21-1-2-3-1001', platform: 'win32' });
ok(lift.ok === true && lift.plan.args.join(' ') === 'C:\\proj /remove:d *S-1-5-21-1-2-3-1001',
  '3-2 【核心】撤销 = 一条 `/remove:d`（用户自己也能跑；属主永远能改自己的 DACL）',
  lift.ok ? lift.plan.args.join(' ') : JSON.stringify(lift));
const badSid = P.hostDirGuardPlan({ action: 'apply', dir: 'C:\\proj', sid: 'Administrator', platform: 'win32' });
ok(badSid.ok === false && badSid.code === 'bad-sid', '3-3 只接受 SID 文本（账号名有本地化歧义 ⇒ 拒绝）', JSON.stringify(badSid));
const posix = P.hostDirGuardPlan({ action: 'apply', dir: '/tmp/proj', sid: 'S-1-5-21-1-2-3-1001', platform: 'linux' });
ok(posix.ok === false && posix.code === 'platform-not-supported',
  '3-4 非 Windows 如实拒绝（不做半套：POSIX 改 mode 位的侵入性更大）', JSON.stringify(posix));
ok(P.HOST_DIR_GUARD_SECURITY.userInitiatedOnly === true && P.HOST_DIR_GUARD_SECURITY.autoApply === false &&
   P.HOST_DIR_GUARD_SECURITY.singleCommandRollback === true && P.HOST_DIR_GUARD_SECURITY.encrypts === false,
  '3-5 加锁的属性写成可断言的事实：只由用户按键触发 / 不自动 / 一条命令撤销 / 不是加密',
  JSON.stringify(P.HOST_DIR_GUARD_SECURITY));

/* ══ 4. 项目级属性与台账（项目记录 = 事实来源；不是本机设置） ══ */
section('4. 项目级属性 + 工具文件访问台账（product 事实，随项目走）');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-exec-'));
const groupsFile = path.join(tmpDir, 'groups.json');
const store = new G.GroupStore(groupsFile);
store.upsertGroup({ groupId: 'g-1', name: '项目推进群', type: 'internal', creatorFingerprint: 'AABB' });
const setP = store.setProjectAttrs('g-1', { devEnv: 'container', runtimeId: 'docker', directory: 'C:\\proj', availability: 'available', availabilityCode: 'ok', reportedBy: 'AABB' });
ok(setP.ok === true && setP.project.devEnv === 'container' && setP.project.runtimeId === 'docker' && setP.project.directory === 'C:\\proj',
  '4-1 开发环境 / 运行时 / 项目目录写进**项目记录**（不是本机设置）', JSON.stringify(setP.project));
const reread = store.projectOf('g-1');
ok(reread && reread.devEnv === 'container' && reread.directorySource === 'creator-picked',
  '4-2 重新读盘后属性仍在（真的落盘了，不是内存里的假象）', JSON.stringify(reread));
const rec1 = store.recordFileAccess('g-1', { op: 'edit', path: 'C:\\proj\\src\\a.ts', ts: 1000, ok: true, by: 'helper-tool', bytes: 12 });
const rec2 = store.recordFileAccess('g-1', { op: 'edit', path: 'C:\\proj\\src\\a.ts', ts: 2000, ok: true, by: 'helper-tool', bytes: 20 });
const ledger = store.listFileAccess('g-1');
ok(rec1.ok && rec2.ok && ledger.length === 1 && ledger[0].ts === 2000,
  '4-3 台账按"路径 + 操作"去重且保留最新（同一文件反复读写不会把台账塞满）', JSON.stringify(ledger));
const recBad = store.recordFileAccess('g-1', { op: 'nonsense', path: 'x', ts: 1, ok: true, by: 'x' });
ok(recBad.ok === false, '4-4 不认识的 op 一律丢弃（**不**当成 write 记下来）', JSON.stringify(recBad));
store.recordFileAccess('g-1', { op: 'backup', path: 'C:\\backup\\hosts.bak', ts: 3000, ok: true, by: 'helper-tool' });
const ledger2 = store.listFileAccess('g-1');
ok(ledger2.length === 2 && ledger2[0].op === 'backup' && ledger2[0].path.indexOf('backup') >= 0,
  '4-5 非项目内的路径也在同一份台账里（"其他文件"那一栏的来源）', JSON.stringify(ledger2.map((x) => [x.op, x.path])));
for (let i = 0; i < G.PROJECT_LEDGER_LIMIT + 20; i++) {
  store.recordFileAccess('g-1', { op: 'read', path: 'C:\\proj\\f' + i, ts: 4000 + i, ok: true, by: 'helper-tool' });
}
const ledger3 = store.listFileAccess('g-1', 500);
ok(ledger3.length === G.PROJECT_LEDGER_LIMIT, '4-6 台账**有界**（超过上限丢最旧的，随项目同步不会无限涨）', ledger3.length);
const synced = store.applyProjectSync('g-9', {
  name: '来自创建者的项目', type: 'internal',
  project: { devEnv: 'container', runtimeId: 'podman', disabledAt: 12345, directory: 'C:\\remote', availability: 'stopped', availabilityCode: 'disabled-by-owner' },
  creatorFingerprint: 'CCDD',
});
ok(synced.ok === true && synced.group.creatorFingerprint === 'CCDD' && synced.group.project.disabledAt === 12345 && synced.group.project.runtimeId === 'podman',
  '4-7 成员侧：同步过来的项目属性写进本地项目记录（第一次收到会建记录）', JSON.stringify(synced.group && synced.group.project));
const overwrite = store.applyProjectSync('g-9', { project: { devEnv: 'container' }, creatorFingerprint: 'EEFF' });
ok(overwrite.ok === true && store.getGroup('g-9').creatorFingerprint === 'CCDD',
  '4-8 已知道创建者时**不被对端覆盖**（谁也不能自称群主）', store.getGroup('g-9').creatorFingerprint);

/* ══ 5. helper-tool 的真实文件操作 → 项目台账（记账落点由主进程接） ══ */
section('5. 真实文件操作被记账（helper-tool → 项目台账）');
const recorded = [];
H.setFileAccessSink((sessionId, entry) => {
  recorded.push({ sessionId, ...entry });
  store.recordFileAccess(sessionId, entry);
});
const projFile = path.join(tmpDir, 'proj.txt');
const wrote = await H.withFileAccessScope('g-1', () =>
  H.writeFileWithFallback({ target: projFile, content: 'hello', mode: 'direct', tool: { kind: 'none', path: null, version: null, usable: false, note: '' } })
);
ok(wrote.ok === true, '5-1 直接写入成功（前置：本机可写）', wrote.method);
ok(recorded.some((r) => r.op === 'create' && r.path === projFile && r.sessionId === 'g-1'),
  '5-2 【核心】写新文件 ⇒ 台账里是 `create`（不是笼统的 write）', JSON.stringify(recorded.map((r) => [r.op, path.basename(r.path)])));
recorded.length = 0;
await H.withFileAccessScope('g-1', () =>
  H.writeFileWithFallback({ target: projFile, content: 'hello2', mode: 'direct', tool: { kind: 'none', path: null, version: null, usable: false, note: '' } })
);
ok(recorded.some((r) => r.op === 'edit' && r.path === projFile),
  '5-3 改写已存在的文件 ⇒ 台账里是 `edit`（写入**之前**探过目标，是当时的事实）', JSON.stringify(recorded.map((r) => [r.op, path.basename(r.path)])));
recorded.length = 0;
/**
 * ⚠️ 记账需要**作用域**（= 这个动作属于哪个项目）：`withFileAccessScope` 外面一律不记。
 * 这正是"不会退回成本机日志"的那条设计，所以这里必须显式包一层。
 */
const bak = await H.withFileAccessScope('g-1', () => {
  const b = H.backupFile(projFile, path.join(tmpDir, 'bak'), 'proj');
  H.fingerprintFile(projFile);
  return b;
});
ok(recorded.some((r) => r.op === 'backup') && recorded.some((r) => r.op === 'read'),
  '5-4 备份与读取分别记成 backup / read（读操作也记，但面板不会把它当"改动"）', JSON.stringify(recorded.map((r) => r.op)));
H.setFileAccessSink(null);
recorded.length = 0;
H.noteExternalFileAccess('edit', projFile, { by: 'container' });
ok(recorded.length === 0,
  '5-5 【核心】没接 sink 时**什么都不记**：这一层不会退回成"本机设置里的一份日志"', JSON.stringify(recorded));
ok(typeof bak.sha256 === 'string' && bak.bytes > 0, '5-6 备份产物真实可用（sha256 + 字节数）', bak.bytes);

/* ══ 6. 跨机信号：项目属性的形状、校验、映射与入站门控 ══ */
section('6. 项目属性跨机同步（成员能看到"为什么"）');
const msg = W.projectAttrsMessage({
  groupId: 'g-1', name: '项目推进群', type: 'internal',
  project: { devEnv: 'container', runtimeId: 'docker', disabledAt: 0, directory: 'C:\\proj' },
  availability: { availability: 'not-ready', code: 'container-not-ready', at: 4242 },
  creatorFingerprint: 'AABB',
  ledger: [{ op: 'edit', path: 'C:\\proj\\a.ts', ts: 9, ok: true, by: 'helper-tool' }],
});
ok(msg.kind === W.PROJECT_ATTRS_KIND && msg.project.devEnv === 'container' && msg.availability.availability === 'not-ready',
  '6-1 信号带：项目属性 + **创建者节点的实时可用性**（原因码）', JSON.stringify(msg).slice(0, 140));
ok(W.PROJECT_ATTRS_CHANNEL === 'control',
  '6-2 搭在协议既有的 control 频道上（不改 sync-protocol；用 kind 自报身份）', W.PROJECT_ATTRS_CHANNEL);
const rt = W.parseProjectAttrsMessage(JSON.parse(JSON.stringify(msg)));
ok(rt.ok === true && rt.value.groupId === 'g-1' && rt.value.ledgerTail.length === 1,
  '6-3 往返可解析（含台账尾部；只带路径/操作/时间）', rt.ok ? JSON.stringify(rt.value.ledgerTail) : rt.error);
ok(W.parseProjectAttrsMessage({ kind: 'warmy.membership.revocation' }).ok === false &&
   W.parseProjectAttrsMessage({ type: 'ping' }).ok === false &&
   W.parseProjectAttrsMessage({ kind: W.PROJECT_ATTRS_KIND, groupId: 'g-1', project: { devEnv: 'weird', runtimeId: '' }, availability: { availability: 'available' } }).ok === false,
  '6-4 不认识 / 形状不对的消息**一律拒绝**（不做"尽力而为"的宽容解析）');
const facts = W.projectAttrsToStateInput({ project: { devEnv: 'container', runtimeId: 'docker', disabledAt: 0 }, availability: { availability: 'not-ready', code: 'container-not-ready', at: 1 } });
ok(facts.devEnv === 'container' && facts.runtimeId === 'docker' && facts.runtimeStatus === 'installed-not-running' && facts.source === 'creator-signal',
  '6-5 信号 → deriveProjectState 的输入事实（**判定仍然只有那一份纯函数**）', JSON.stringify(facts));
const factsUnknown = W.projectAttrsToStateInput({ project: { devEnv: 'container', runtimeId: 'docker', disabledAt: 0 }, availability: { availability: 'unknown', code: '', at: 0 } });
ok(factsUnknown.runtimeStatus === null, '6-6 拿不准 ⇒ null（按未就绪处理，绝不乐观放开）', JSON.stringify(factsUnknown));
const derive = P.deriveProjectState({ devEnv: facts.devEnv, runtimeId: facts.runtimeId, runtimeStatus: facts.runtimeStatus, disabledByOwner: false });
const gate = W.projectInboundGate(derive);
ok(derive.code === 'container-not-ready' && derive.memberFace === 'creator-offline' &&
   gate.allow === false && gate.queue === 'creator-offline' && gate.memberFaceKey === 'group.memberOffline',
  '6-7 【核心】成员侧：不可用 ⇒ 入站**按「创建者离线」排队**（同一句既有文案，不新造状态）', JSON.stringify(gate));
const deriveOk = P.deriveProjectState({ devEnv: 'container', runtimeId: 'docker', runtimeStatus: 'ready', disabledByOwner: false });
ok(W.projectInboundGate(deriveOk).allow === true && W.projectInboundGate(deriveOk).queue === null,
  '6-8 可用时放行（同一条判定的另一半）');
const deriveDisabled = P.deriveProjectState({ devEnv: 'host', runtimeId: '', runtimeStatus: null, disabledByOwner: true });
ok(deriveDisabled.code === 'disabled-by-owner' && W.projectInboundGate(deriveDisabled).queue === 'creator-offline',
  '6-9 被创建者停用 ⇒ 同样走「创建者离线」那一档（不区分出第三种表现）');

/* ══ 7. 真容器：真的在容器里跑（引擎可用时才做；不拉任何镜像，用已有的） ══ */
section('7. 真容器执行（与用后清理）');
let engine = { status: 'unknown' };
try {
  const rep = await P.probeContainerRuntimes({ cacheMs: 0, perProbeTimeoutMs: 6000, concurrency: 4 });
  const d = (rep.runtimes || []).find((x) => x.id === 'docker');
  engine = { status: d ? d.status : 'missing', detail: d ? d.detail : '' };
} catch (e) {
  engine = { status: 'error', detail: String(e && e.message) };
}
console.log('     本机 docker 状态 = ' + JSON.stringify(engine));
const alpine = P.CONTAINER_BASE_IMAGES.find((x) => x.id === 'alpine-3.20');
const alpineRef = alpine && alpine.digest ? alpine.ref + '@' + alpine.digest : '';
const createdContainers = [];
const createdImages = [];
let realRan = false;
if (NO_CONTAINER) {
  console.log('     --no-container：跳过真容器部分（纯函数部分已全部执行）');
} else if (engine.status !== 'ready' || !alpineRef) {
  console.log('     ⚠️ 引擎不可用（status=' + engine.status + '）：真容器部分**如实跳过**，不假装跑过');
} else {
  realRan = true;
  const groupId = 'g-exec-' + Date.now().toString(36);
  const name = P.containerProjectName(groupId);
  // 7-1 一次性：run --rm <钉死 digest> echo ok
  const smoke = await P.runContainerExec('docker', 'run-rm', { image: alpineRef, command: 'smoke-echo' }, 240000);
  ok(smoke.executed === true && smoke.ok === true && /ok/.test(smoke.out),
    '7-1 【真机】`run --rm <钉死 digest> echo ok` 真的跑起来了（executed=true）',
    'rc=' + smoke.code + ' ' + smoke.ms + 'ms out=' + JSON.stringify(smoke.out));
  // 7-2 常驻项目容器（绑定一个临时目录；默认不用 --rm）
  const projDir = fs.mkdtempSync(path.join(tmpdirBase(), 'warmy-exec-proj-'));
  fs.writeFileSync(path.join(projDir, 'hello.txt'), 'from-host\n');
  const up = await P.runContainerExec('docker', 'run-detached', { name, image: alpineRef, hostDir: projDir, projectLabel: groupId }, 240000);
  if (up.ok) createdContainers.push(name);
  ok(up.ok === true, '7-2 【真机】项目容器起来了（`run -d`，**没有 --rm** ⇒ 可写层保留）',
    up.ok ? up.out.slice(0, 40) : 'rc=' + up.code + ' ' + (up.err || '').slice(0, 200));
  // 7-3 项目命令**真的在容器里**跑（exec-capture，固定命令）
  const pwd = await P.runContainerExec('docker', 'exec-capture', { name, command: 'pwd' }, 60000);
  ok(pwd.ok === true && pwd.out.trim() === P.CONTAINER_PROJECT_MOUNT,
    '7-3 【真机·核心】"把项目的命令送进容器"真的执行在容器里（pwd = /workspace）',
    pwd.out.trim() + ' / ' + pwd.ms + 'ms');
  const ls = await P.runContainerExec('docker', 'exec-capture', { name, command: 'ls-workspace' }, 60000);
  ok(ls.ok === true && ls.out.indexOf('hello.txt') >= 0,
    '7-4 【真机·核心】bind mount 生效：宿主目录里的文件在容器里看得见（属于项目目录事实）',
    ls.out.replace(/\s+/g, ' ').slice(0, 120));
  // 7-5 真的交互 shell（容器内）：写一行，拿回容器里的输出
  const opened = P.openContainerShellSession({ groupId, runtimeId: 'docker', containerName: name });
  ok(opened.ok === true && opened.executed === true && opened.insideContainer === true,
    '7-5 【真机·核心】控制台 = **容器内的 shell**（真的 spawn 了 `docker exec -i <name> sh`）', JSON.stringify(opened).slice(0, 200));
  if (opened.ok) {
    const w1 = await P.writeContainerShellSession(opened.sessionId, 'echo shell-in-container-$((1+1))\n');
    ok(w1.ok && w1.executed && /shell-in-container-2/.test(String(w1.output)),
      '7-6 【真机·核心】敲进 shell 的命令**在容器里**执行并回显结果', JSON.stringify(String(w1.output)).slice(0, 120));
    const w2 = await P.writeContainerShellSession(opened.sessionId, 'cat /etc/os-release | head -n 1\n');
    ok(w2.ok && /Alpine|Linux|NAME/i.test(String(w2.output)), '7-7 容器里的发行版事实可读（先探测再动手那条的前提）', String(w2.output).slice(0, 80));
    const closed = P.closeContainerShellSession(opened.sessionId);
    ok(closed.ok === true, '7-8 shell 会话可正常关闭（用完就关，不留悬挂进程）', JSON.stringify(closed));
    const after = await P.writeContainerShellSession(opened.sessionId, 'echo nope\n');
    ok(after.ok === false && after.code === 'no-session', '7-9 关掉之后再写 ⇒ 如实报 no-session（不会偷偷再开一条）', JSON.stringify(after));
  }
  // 7-10 固化：commit + **回读镜像 id**（证据等级 = commit-succeeded 的唯一判据）
  const at = Date.now();
  const imageRef = P.solidifiedImageRef(groupId, at);
  const commit = await P.runContainerExec('docker', 'commit', { name, imageRef }, 600000);
  if (commit.ok) createdImages.push(imageRef);
  ok(commit.ok === true, '7-10 【真机】`commit` 真的把项目容器固化成一层（产物在我们自己的命名空间里）',
    commit.ok ? imageRef : 'rc=' + commit.code + ' ' + (commit.err || '').slice(0, 200));
  const inspect = commit.ok ? await P.runContainerExec('docker', 'image-inspect', { image: imageRef }, 60000) : { ok: false, out: '' };
  const imageId = String(inspect.out || '').split('|')[0] || '';
  ok(commit.ok && inspect.ok && /^sha256:[0-9a-f]{64}$/.test(imageId),
    '7-11 【真机·核心】回读镜像 id 成功 ⇒ 这次的证据等级才够写"已固化"（没回读成功就按失败处理）', imageId.slice(0, 20));
  // 7-12 回滚：删掉容器，从固化镜像再起一个（这就是「回滚到固化点」的真身）
  const rm = await P.runContainerExec('docker', 'rm', { name }, 120000);
  ok(rm.ok === true, '7-12 【真机】原来的项目容器已删除（回滚的前置）', rm.out.replace(/\s+/g, ' ').slice(0, 60));
  const back = await P.runContainerExec('docker', 'run-detached', { name, image: imageRef, hostDir: projDir, projectLabel: groupId }, 240000);
  ok(back.ok === true, '7-13 【真机·核心】从**固化镜像**起容器成功（回滚到固化点的真身，证据等级 container-started）',
    back.ok ? back.out.slice(0, 20) : 'rc=' + back.code + ' ' + (back.err || '').slice(0, 200));
  const ps = await P.runContainerExec('docker', 'ps', { name }, 30000);
  ok(ps.ok && /Up/i.test(ps.out), '7-14 【真机】探测确认它**真的在运行**（不是"命令被受理了"）', ps.out.replace(/\s+/g, ' ').slice(0, 100));
  const verify = await P.runContainerExec('docker', 'exec-capture', { name, command: 'smoke-echo' }, 60000);
  ok(verify.ok && /ok/.test(verify.out), '7-15 【真机】回滚后的容器里照样能跑命令（链路完整）', verify.out.slice(0, 40));
  // 清理：只删我们自己起的东西
  const stopR = await P.runContainerExec('docker', 'stop', { name }, 150000);
  const rmR = await P.runContainerExec('docker', 'rm', { name }, 120000);
  const rmImg = createdImages.length ? await P.runContainerExec('docker', 'image-rm', { image: createdImages[0] }, 120000) : { ok: true, out: 'none' };
  ok(stopR.ok && rmR.ok, '7-16 【清理】我们自己起的容器已停 + 已删（不留残留）',
    JSON.stringify({ stop: stopR.code, rm: rmR.code }));
  ok(rmImg.ok, '7-17 【清理】我们自己固化出来的镜像已删除（磁盘回到原状）', String(rmImg.out || '').slice(0, 60));
}

/* ══ 8. 证据等级：没有真成功就绝不算成功 ══ */
section('8. 证据等级（不许把"点了按钮"当成功）');
ok(P.ENV_SOLIDIFY_SECURITY.freezesWholeFilesystem === true && P.ENV_SOLIDIFY_SECURITY.deletesUserFiles === false &&
   P.ENV_SOLIDIFY_SECURITY.forwardsSecretEnv === false && P.ENV_SOLIDIFY_SECURITY.keep === 3,
  '8-1 安全提醒写成可断言的事实：冻结整个文件系统 / 不删用户文件 / 不带密钥环境变量 / 只留 3 个',
  JSON.stringify(P.ENV_SOLIDIFY_SECURITY));
ok(P.envSolidifyCapability('docker').programmatic === true && P.envSolidifyCapability('wsl').programmatic === false &&
   P.envSolidifyCapability('wsl').kind === 'export-import' && P.envSolidifyCapability('windows-sandbox').programmatic === false,
  '8-2 能力表照旧：Docker 可程序化固化；WSL 只能整盘导出（**不可程序化**，我们不代跑）；一次性沙箱不支持');
ok(P.SOLIDIFY_KEEP === 3 && P.SOLIDIFY_COALESCE_MS === 45000,
  '8-3 保留 3 个 + 45s 节流（时机驱动，不是"一变就固化"）', P.SOLIDIFY_KEEP + '/' + P.SOLIDIFY_COALESCE_MS);
const d1 = P.shouldSolidifyAt({ lastSolidifiedAt: Date.now() - 1000, dirty: true, programmatic: true });
const d2 = P.shouldSolidifyAt({ lastSolidifiedAt: Date.now() - 1000, dirty: true, explicit: true, programmatic: true });
const d3 = P.shouldSolidifyAt({ lastSolidifiedAt: Date.now() - 1000, dirty: true, beforeDestroy: true, programmatic: true });
const d4 = P.shouldSolidifyAt({ lastSolidifiedAt: Date.now() - 1000, dirty: true, programmatic: false });
ok(d1.solidify === false && d1.code === 'coalesced' && d2.solidify === true && d3.solidify === true && d4.solidify === false,
  '8-4 节流窗口内不固化；显式按键与"销毁前"必须固化；运行时不能固化时一律不执行',
  JSON.stringify([d1.code, d2.code, d3.code, d4.code]));

/* ══ 9. 宿主目录加锁：在**临时目录**上真跑一次 icacls，并证明能撤销 ══ */
section('9. 宿主目录加锁：真的改 ACL，也真的能撤销（只在临时目录上做）');
const { execFile } = await import('node:child_process');
const runCmd = (file, args, timeoutMs = 60000) =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true, encoding: 'utf8', maxBuffer: 1 << 22 }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? (typeof err.code === 'number' ? err.code : null) : 0, out: String(stdout || '').trim(), err: String(stderr || '').trim() });
    });
  });
if (process.platform !== 'win32') {
  console.log('     非 Windows：如实跳过（我们的实现本来就只支持 Windows）');
  ok(posix.ok === false && posix.code === 'platform-not-supported', '9-1 非 Windows 上加锁入口如实关闭（沿用 3-4 的结论）');
} else {
  const sidRes = await runCmd('whoami', ['/user', '/fo', 'csv', '/nh'], 20000);
  const sidMatch = /(S-1-\d+(?:-\d+)+)/.exec(sidRes.out || '');
  const sid = sidMatch ? sidMatch[1] : '';
  ok(!!sid, '9-0 取到本机当前用户 SID（加锁只按 SID，不按本地化的账号名）', sid);
  const guardDir = fs.mkdtempSync(path.join(tmpdirBase(), 'warmy-guard-'));
  fs.writeFileSync(path.join(guardDir, 'file.txt'), 'x');
  const planA = P.hostDirGuardPlan({ action: 'apply', dir: guardDir, sid });
  const applyRes = planA.ok ? await runCmd(planA.plan.file, planA.plan.args) : { ok: false, out: '', err: JSON.stringify(planA) };
  const listed1 = await runCmd('icacls', [guardDir]);
  /* icacls 会把 SID 解析成本地化账号名显示，所以两种形态都接受（ACE 一定带 (DENY)） */
  const denied = /\(DENY\)/.test(listed1.out) && (listed1.out.indexOf(sid) >= 0 || /\\(DENY)\(/.test(listed1.out) || /DENY/.test(listed1.out));
  ok(applyRes.ok && denied,
    '9-1 【真机·核心】加锁真的写进了文件系统（`icacls` 列表里能看到那条 DENY ACE）',
    listed1.out.split('\n').filter((l) => /DENY/.test(l)).join(' ').slice(0, 160));
  // 加锁后：以本机身份**真的写不进去**（这是"文件系统级强制"的实际效果，不是文案）
  let writeBlocked = false;
  try {
    fs.writeFileSync(path.join(guardDir, 'file.txt'), 'should-fail');
  } catch {
    writeBlocked = true;
  }
  ok(writeBlocked, '9-2 【真机·核心】锁上之后宿主侧写入**真的被拒**（外部编辑器同样会失败）', writeBlocked ? 'EACCES/EPERM' : '未阻止');
  let createBlocked = false;
  try {
    fs.writeFileSync(path.join(guardDir, 'new-file.txt'), 'nope');
  } catch {
    createBlocked = true;
  }
  ok(createBlocked, '9-2b 【真机】在锁着的目录里**新建**文件也被拒（继承式 ACE 连子项一起管住）', createBlocked ? 'EACCES/EPERM' : '未阻止');
  // 读取不受影响（对比度：锁的是写，不是把人锁死）
  let readOk = false;
  try {
    readOk = fs.readFileSync(path.join(guardDir, 'file.txt'), 'utf8').length > 0;
  } catch { /* noop */ }
  ok(readOk, '9-3 只锁写、不锁读（目录仍然可读，不会被锁死）');
  const planL = P.hostDirGuardPlan({ action: 'lift', dir: guardDir, sid });
  const liftRes = planL.ok ? await runCmd(planL.plan.file, planL.plan.args) : { ok: false };
  const listed2 = await runCmd('icacls', [guardDir]);
  let writeBack = false;
  try {
    fs.writeFileSync(path.join(guardDir, 'file.txt'), 'writable-again');
    writeBack = fs.readFileSync(path.join(guardDir, 'file.txt'), 'utf8') === 'writable-again';
  } catch { /* noop */ }
  let createBack = false;
  try {
    fs.writeFileSync(path.join(guardDir, 'after-lift.txt'), 'ok');
    createBack = fs.existsSync(path.join(guardDir, 'after-lift.txt'));
  } catch { /* noop */ }
  ok(liftRes.ok && !/\(DENY\)/.test(listed2.out) && writeBack && createBack,
    '9-4 【真机·核心】一条命令撤销之后 ACL 那条 DENY 消失、写入与新建都恢复（**用户永远不会被锁死**）',
    JSON.stringify({ lift: liftRes.ok, denyGone: !/\(DENY\)/.test(listed2.out), writeBack, createBack }));
  try { fs.rmSync(guardDir, { recursive: true, force: true }); } catch { /* noop */ }
}

const failed = results.filter((r) => !r.pass);
console.log('\n=== 结果 ===');
console.log(JSON.stringify({ pass: failed.length === 0, failures: failed.length, total: results.length, realRan, engine }));
try {
  fs.writeFileSync(path.join(os.tmpdir(), 'perf', 'container', 'container-exec-result.json'),
    JSON.stringify({ at: new Date().toISOString(), pass: failed.length === 0, failures: failed.length, total: results.length, realRan, engine, results }, null, 1), 'utf8');
} catch { /* 忽略 */ }
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* 忽略 */ }
process.exit(failed.length === 0 ? 0 : 2);

function tmpdirBase() {
  return process.env.TEMP || os.tmpdir();
}
