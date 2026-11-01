#!/usr/bin/env node
/**
 * verify-r121-decisions.mjs —— 第 121 轮用户 6 项决定的行为与接线。
 *
 * 1 技能/插件执行最小副本；2 run_shell 永久授权账本；3 牛马本机/容器（复核对现有实现）；
 * 4 值班者本体永不执行、只派唯一分身；5 nm 下载按会话首次询问并记住；6 审批等待不计时 + 实际 usage。
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, '..');
const repo = path.resolve(pkg, '..', '..');
const require = createRequire(import.meta.url);
const read = (rel) => fs.readFileSync(path.join(pkg, rel), 'utf8');
let pass = 0;
const ok = (name, cond, detail) => {
  assert.ok(cond, name + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail)));
  pass += 1;
  console.log('PASS ' + name);
};

/* ── 1. 执行最小副本（真实文件/真实加密层） ── */
const encfs = require('../src/enc-fs.cjs');
const { zhunBeiZhiXingFuBen } = await import(pathToFileURL(path.join(pkg, 'dist', 'plugin-exec-copy.js')).href);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-r121-fuben-'));
encfs.install({ root });
encfs.setKey(crypto.randomBytes(32));
const plugin = path.join(root, 'scan-dirs', 'plugins', 'demo');
fs.mkdirSync(plugin, { recursive: true });
fs.writeFileSync(path.join(plugin, 'plugin.json'), JSON.stringify({ id: 'demo', entry: 'bridge.mjs', configFile: 'config.json' }));
fs.writeFileSync(path.join(plugin, 'bridge.mjs'), 'console.log(1)\n');
fs.writeFileSync(path.join(plugin, 'config.json'), '{"token":"秘密"}');
fs.writeFileSync(path.join(plugin, 'README.md'), 'should-not-copy\n');
const rawDisk = (p) => {
  const fd = fs.openSync(p, 'r');
  try { const b = Buffer.alloc(fs.fstatSync(fd).size); fs.readSync(fd, b, 0, b.length, 0); return b; } finally { try { fs.closeSync(fd); } catch { /* noop */ } }
};
try {
  ok('源配置在磁盘上是密文', rawDisk(path.join(plugin, 'config.json')).subarray(0, 8).toString('binary') === 'WARMYEF2');
  const b = zhunBeiZhiXingFuBen(plugin);
  ok('执行副本入口是明文代码', rawDisk(b.entry).toString('utf8') === 'console.log(1)\n');
  ok('执行副本包含解密后的配置（仅 0600 临时副本）', rawDisk(b.config).toString('utf8') === '{"token":"秘密"}');
  ok('执行副本不复制无关文件', !fs.existsSync(path.join(b.dir, 'README.md')) && b.files.length === 4, b.files);
  ok('源配置仍是密文（没有就地解密）', rawDisk(path.join(plugin, 'config.json')).subarray(0, 8).toString('binary') === 'WARMYEF2');
  const dir = b.dir;
  b.cleanup();
  ok('cleanup 删除整个执行副本', !fs.existsSync(dir));
  const b2 = zhunBeiZhiXingFuBen(plugin, { withConfig: false });
  ok('不需要配置时可不把配置解密进副本', !b2.config && !fs.existsSync(path.join(b2.dir, 'config.json')));
  b2.cleanup();
} finally { try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* noop */ } }

/* ── 2. run_shell 永久授权账本（真实规范化/键；静态接线） ── */
const { mingLingShouQuanJian, guiFanMingLing } = await import(pathToFileURL(path.join(pkg, 'dist', 'agent-tools.js')).href);
const cwd = path.join(os.tmpdir(), 'warmy-ws');
ok('命令空白规范化', guiFanMingLing('  git   status  ') === 'git status');
ok('相同命令+目录得到同一授权键', mingLingShouQuanJian('git   status', cwd) === mingLingShouQuanJian(' git status ', cwd));
ok('目录不同 → 授权键不同', mingLingShouQuanJian('git status', cwd) !== mingLingShouQuanJian('git status', cwd + '-2'));
ok('授权键是 32 位十六进制', /^[0-9a-f]{32}$/.test(mingLingShouQuanJian('git status', cwd)));
const main = read('src/electron-main.ts');
const preload = read('src/preload.cjs');
const settings = read('src/settings-store.ts');
const appjs = read('src/renderer/app.js');
ok('设置 schema 含永久授权账本', /commandGrants\?: Array<\{ key: string; cmd: string; cwd: string; createdAt: number \}>/.test(settings));
ok('run_shell 命中永久授权时不再询问', /if \(yiShouQuan\)/.test(main) && /run_shell\.permanent-grant-used/.test(main));
ok('授权卡提供“永久同意”并落账', /shell\.grantAlways/.test(main) && /run_shell\.permanent-grant/.test(main));
ok('永久授权可列出/可撤销 IPC', /warmy:mingLingShouQuanLieBiao/.test(main) && /warmy:mingLingShouQuanCheXiao/.test(main) && /run_shell\.permanent-grant-revoked/.test(main));
ok('preload 暴露列出/撤销', /commandGrantsList/.test(preload) && /commandGrantRevoke/.test(preload));
ok('设置页有永久授权列表与撤销按钮', /mingLingShouQuanLie/.test(appjs) && /data-cg-revoke/.test(appjs) && /commandGrantRevoke/.test(appjs));
for (const k of ['settings.commandGrants', 'settings.commandGrantsRevoke', 'shell.grantAlways']) {
  ok('10 语言包含 ' + k, ['zh-CN', 'zh-TW', 'en-US', 'es', 'fr', 'ja', 'ko', 'ru', 'pt', 'eo'].every((L) => fs.readFileSync(path.join(pkg, 'src', 'i18n', L + '.json'), 'utf8').includes('"' + k + '"')));
}

/* ── 3. 牛马本机/容器（复核现有实现仍在） ── */
ok('创建牛马弹窗仍有本机/容器选项', /nmMing|nmDevEnv/.test(appjs) && /benDi|rongQi/.test(appjs));

/* ── 4. 值班者本体不执行、只派唯一分身 ── */
const router = read('../../packages/group-router/src/index.ts');
const orch = read('src/orchestrator.ts');
ok('路由器不再把值班者本体塞进执行者列表', !/zhiXingQiJi\.push\(duty\.id\)/.test(router));
ok('编排器有唯一分身执行器', /DUTY_SUBAGENT_ID/.test(orch) && /zhiXingDutyFenShen/.test(orch));
ok('分身带 single-flight 互斥（同一时间一个）', /dutyFenShenBusy\.has/.test(orch) && /dutyFenShenBusy\.add/.test(orch) && /dutyFenShenBusy\.delete/.test(orch));
ok('分身只派一个执行者', /zhiXingQiJi: \[DUTY_SUBAGENT_ID\]/.test(orch) && /executorId: DUTY_SUBAGENT_ID/.test(orch));
ok('值班者直接答活的旧 provider 路径已移除', !/congYuSheChuangJian\(dutyCfg\.presetId/.test(orch));
{
  const { GroupChatRouter, DEFAULT_PERMISSIONS } = await import(pathToFileURL(path.join(repo, 'packages', 'group-router', 'dist', 'index.js')).href);
  const r = new GroupChatRouter({ queueWhenFixedBusy: false });
  r.createGroup({ groupId: 'g-one', ming: '单人群', type: 'internal', members: [], permissions: DEFAULT_PERMISSIONS, checkpointLimit: 50 });
  r.join('g-one', { id: 'duty-1', ming: '值班甲', local: true, dutyEligible: true, status: 'idle' });
  const one = r.route({ groupId: 'g-one', userId: 'u', content: '干活', urgency: 'P2', mentionIds: [], timestamp: Date.now() });
  const ids = one.decision?.executorIds || [];
  ok('只有一个值班者时，路由器不把本体列为执行者', one.action === 'dispatch' && one.duty?.id === 'duty-1' && !ids.includes('duty-1'), { action: one.action, ids });
}
ok('分身审计事件存在', /group\.duty-subagent-start/.test(orch) && /group\.duty-subagent-done/.test(orch));
for (const k of ['group.duty.forbidden', 'group.duty.subagentBusy', 'group.duty.subagentFailed']) {
  ok('10 语言包含 ' + k, ['zh-CN', 'zh-TW', 'en-US', 'es', 'fr', 'ja', 'ko', 'ru', 'pt', 'eo'].every((L) => fs.readFileSync(path.join(pkg, 'src', 'i18n', L + '.json'), 'utf8').includes('"' + k + '"')));
}

/* ── 5. nm 下载按会话首次询问并记住 ── */
const nmwin = read('src/nm-viewer-win.ts');
ok('nm 窗口记录打开它的会话 id', /huiHuaId\?: string/.test(nmwin) && /huiHuaId: String\(xuan\?\.huiHuaId/.test(nmwin));
ok('同一文件不同会话不复用同一窗口', /z\.huiHuaId === xuan\?\.huiHuaId/.test(nmwin));
ok('下载首次弹保存框、之后用记住目录', /showSaveDialogSync/.test(nmwin) && /getSaved\(sid\)/.test(nmwin) && /nmXiaZaiLuJing\.save\(sid/.test(nmwin));
ok('默认目录按会话工作区/downloads', /workspaceDirOf\(app\.getPath\('userData'\), sessionId\)/.test(main) && /path\.join\(base, 'downloads'\)/.test(main));
ok('设置持久化 nmDownloadDirs', /nmDownloadDirs\?: Record<string, string>/.test(settings));
ok('渲染层打开 nm 时带当前会话', /nmKai\?\.\(\{ path: lu, huiHuaId: String\(state\.selectedChat\?\.id/.test(appjs));

/* ── 6. 审批等待不计时 + 实际 usage ── */
const { jiSuanGongZuoHaoShi } = await import(pathToFileURL(path.join(pkg, 'dist', 'work-time.js')).href);
ok('执行时间 = 墙钟 − 审批等待', jiSuanGongZuoHaoShi(1000, 2000, 9000, 5000) === 5000, jiSuanGongZuoHaoShi(1000, 2000, 9000, 5000));
ok('时钟回绕/等待倒退时结果不为负', jiSuanGongZuoHaoShi(5000, 5000, 4000, 4000) === 0);
const exec = read('src/executor.ts');
ok('执行者 duration 走审批扣除口径', /jiSuanGongZuoHaoShi\(qiShiShiJian/.test(exec) && /approvalWaitMs/.test(exec));
ok('聊天指标 duration 走审批扣除口径', /benLunHaoShi\(\)/.test(main) && /jiSuanGongZuoHaoShi\(qiShiShiJian, piZhun0/.test(main));
ok('审批响应累计等待并写审计口径', /dengDaiPiZhunMs \+=/.test(main));
ok('指标使用供应商实际 usage 字段', /promptTokens: xiangYing\.usage\.promptTokens/.test(main) && /completionTokens: xiangYing\.usage\.completionTokens/.test(main));
ok('没有新增默认会话硬上限', !/SESSION_HARD_CAP|会话硬上限|sessionHardLimit/.test(main + settings));

console.log(`\nverify-r121-decisions: ${pass} PASS / 0 FAIL`);
