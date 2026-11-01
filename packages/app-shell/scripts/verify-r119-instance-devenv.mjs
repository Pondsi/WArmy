#!/usr/bin/env node
/**
 * verify-r119-instance-devenv.mjs —— 创建牛马时的「本机 / 容器中」真的存在并且有后果。
 *
 * 断言分三层：
 *  1) 纯行为：容器模式未选运行时 ⇒ 不可用（deriveProjectState / xiangMuBuKeYongJuJue 的真实返回）；
 *  2) 接线：创建弹窗的两个选项、默认值、实例记录 devEnv、主进程实例分支与设置持久化；
 *  3) 负向变异：把关键实现删掉/改回默认后，检测器必须变红（防止"写了个字符串就算过"）。
 *
 * 不启动 Electron、不读真实 profile。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, '..');
const root = path.resolve(pkg, '..', '..');
const read = (p) => fs.readFileSync(path.join(pkg, p), 'utf8');
const app = read('src/renderer/app.js');
const main = read('src/electron-main.ts');
const settings = read('src/settings-store.ts');

let pass = 0;
const ok = (name, cond, detail) => {
  assert.ok(cond, name + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail)));
  pass += 1;
  console.log('PASS ' + name);
};
const neg = (name, cond) => {
  assert.ok(!cond, name);
  pass += 1;
  console.log('PASS ' + name);
};

const probe = await import(pathToFileURL(path.join(pkg, 'dist', 'container-probe.js')).href);
const { deriveProjectState, xiangMuBuKeYongJuJue, rongQiXiangMuMing } = probe;

/* ═══ 1. 容器模式的可用性后果（与项目同一套纯实现） ═══ */
const noRuntime = deriveProjectState({ devEnv: 'container', runtimeId: '', runtimeStatus: null });
ok('容器中 · 未选运行时 ⇒ 不可用（container-not-chosen）', noRuntime.stopped === true && noRuntime.code === 'container-not-chosen', noRuntime);
ok('容器中 · 未选运行时 ⇒ 结构化拒绝（project-unavailable）', (() => {
  const r = xiangMuBuKeYongJuJue(noRuntime);
  return !!r && r.ok === false && r.code === 'project-unavailable' && r.projectCode === 'container-not-chosen' && r.historyReadable === true;
})());
const notReady = deriveProjectState({ devEnv: 'container', runtimeId: 'wsl', runtimeStatus: 'not-installed' });
ok('容器中 · 运行时没装 ⇒ 不可用（container-not-installed）', notReady.stopped === true && notReady.code === 'container-not-installed', notReady);
const ready = deriveProjectState({ devEnv: 'container', runtimeId: 'wsl', runtimeStatus: 'ready' });
ok('容器中 · 运行时就绪 ⇒ 可用', ready.running === true && xiangMuBuKeYongJuJue(ready) === null, ready);
const host = deriveProjectState({ devEnv: 'host' });
ok('本机 ⇒ 可用且与容器无关', host.running === true && host.devEnv === 'host' && xiangMuBuKeYongJuJue(host) === null, host);
ok('容器名可由实例 id 稳定推导（warmy-<12hex>）', /^warmy-[0-9a-f]{12}$/.test(rongQiXiangMuMing('inst-119-demo')));

/* ═══ 2. 创建弹窗与实例记录（渲染层） ═══ */
ok('创建牛马使用专用弹窗（不再用纯文本 uiPrompt）', /function openCreateInstanceDialog\s*\(/.test(app));
const dlg = (() => {
  const i = app.indexOf('function openCreateInstanceDialog');
  const j = app.indexOf('function addInstanceFlow', i);
  return i >= 0 && j > i ? app.slice(i, j) : '';
})();
ok('创建弹窗包含「本机」按钮', /data-nm-devenv="host"/.test(dlg));
ok('创建弹窗包含「容器中」按钮', /data-nm-devenv="container"/.test(dlg));
ok('创建弹窗默认本机', /let devEnv = 'host';/.test(dlg));
ok('创建弹窗把选择返回给创建流程', /finish\(\{ ming, devEnv \}\)/.test(dlg));
ok('实例记录写入 devEnv', /const inst = \{[\s\S]{0,400}devEnv,/.test(app));
ok('spawnInstance 把 devEnv 传给主进程', /spawnInstance\(\{ id, ming, dutyEligible: true, devEnv \}\)/.test(app));

/* ═══ 3. 牛马设置里的运行环境与选择容器 ═══ */
ok('牛马设置显示运行环境', /id="iKaiFaHuanJing"[\s\S]{0,120}container\.devEnv\.container/.test(app));
ok('牛马设置提供「选择容器…」入口', /id="iRongQiXuanZe"/.test(app) && /switchContainerDialog\(String\(inst\.id \|\| ''\), \{ instance: true \}\)/.test(app));
ok('选择容器对实例写入 containerInstanceRuntime（渲染层读取）', /settings\.containerInstanceRuntime/.test(app));
ok('发送门禁覆盖容器实例', /sel\.kind === 'single' && singleUsesContainer/.test(app) && /instances\.containerNotReady/.test(app));

/* ═══ 4. 主进程：实例 devEnv / 运行时 / 落盘 ═══ */
ok('主进程能按实例 id 读出运行环境', /function shiLiKaiFaHuanJing\s*\(/.test(main) && /source: 'instance-local'/.test(main));
ok('项目属性读取在无项目记录时先看实例', /const shiLi = shiLiKaiFaHuanJing\(qunId\);[\s\S]{0,400}source: 'instance-local'/.test(main));
ok('spawn 时把 devEnv 立刻落进实例记录', /audit\?\.log\('instance\.spawn', \{ id: cfg\.id, devEnv \}\)/.test(main) && /list\[i\] = \{ \.\.\.list\[i\], devEnv \}/.test(main));
ok('选择容器 IPC 支持实例（跳过创建者检查）', /const shiLi = shiLiKaiFaHuanJing\(id\);[\s\S]{0,160}!shiLi && !benJiShiXiangMuChuangJianZhe\(id\)/.test(main));
ok('实例运行时写入 containerInstanceRuntime', /container\.instance-set-container/.test(main) && /containerInstanceRuntime/.test(main));
ok('设置层有 containerInstanceRuntime 字段与默认值', /containerInstanceRuntime\?: Record<string, string>/.test(settings) && /containerInstanceRuntime: \{\}/.test(settings));

/* ═══ 5. 负向变异：删掉实现后，同一条检测器必须失败 ═══ */
neg('负向：去掉「容器中」按钮 ⇒ 正判据失败', /data-nm-devenv="container"/.test(dlg.replace('data-nm-devenv="container"', 'data-nm-devenv="__gone__"')));
neg('负向：默认值改成容器 ⇒ 正判据失败', /let devEnv = 'host';/.test(dlg.replace("let devEnv = 'host';", "let devEnv = 'container';")));
neg('负向：spawn 不带 devEnv ⇒ 正判据失败', /spawnInstance\(\{ id, ming, dutyEligible: true, devEnv \}\)/.test(app.replace('spawnInstance({ id, ming, dutyEligible: true, devEnv })', 'spawnInstance({ id, ming, dutyEligible: true })')));
neg('负向：主进程不看实例 ⇒ 正判据失败', /source: 'instance-local'/.test(main.replace("source: 'instance-local'", "source: 'gone'")));
neg('负向：选择容器 IPC 恢复只认创建者 ⇒ 正判据失败', /!shiLi && !benJiShiXiangMuChuangJianZhe\(id\)/.test(main.replace('!shiLi && !benJiShiXiangMuChuangJianZhe(id)', '!benJiShiXiangMuChuangJianZhe(id)')));
ok('对照：把同一状态谎报为 running ⇒ 结构化拒绝消失（证明上一条判据不是恒真）', (() => {
  const fake = { ...noRuntime, running: true, stopped: false, code: 'ok' };
  return xiangMuBuKeYongJuJue(fake) === null;
})());

/* ═══ 6. 10 个语言包的新文案齐备 ═══ */
const LOCALES = ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko', 'fr', 'es', 'pt', 'ru', 'eo'];
const KEYS = [
  'instances.createTitle', 'instances.devEnv', 'instances.devEnvHint',
  'instances.containerPick', 'instances.containerPickTitle', 'instances.containerPickBody',
  'instances.containerNone', 'instances.containerCurrent', 'instances.containerPicked',
  'instances.containerNotReady',
];
for (const loc of LOCALES) {
  const pack = JSON.parse(read(`src/i18n/${loc}.json`));
  const missing = KEYS.filter((k) => typeof pack[k] !== 'string' || !pack[k].trim());
  ok(`i18n ${loc} 新文案齐备`, missing.length === 0, missing);
}
ok('i18n 所有语言键集合一致', (() => {
  const base = Object.keys(JSON.parse(read('src/i18n/zh-CN.json'))).sort().join('\n');
  return LOCALES.every((loc) => Object.keys(JSON.parse(read(`src/i18n/${loc}.json`))).sort().join('\n') === base);
})());

console.log(`\nverify-r119-instance-devenv: ${pass} PASS / 0 FAIL`);
