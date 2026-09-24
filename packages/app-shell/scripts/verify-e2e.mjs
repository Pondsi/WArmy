/**
 * 端到端验证（真实 Electron + 真实 IPC + 真实 preload）
 *
 *   node scripts/verify-e2e.mjs
 *
 * 做三件事：
 *   1. 把 dist 拷到临时目录跑真实主进程（用户数据目录也是临时的），
 *      通过 CDP 调用渲染进程里的 window.warmy.*，走完整 IPC 链路。
 *   2. 第一轮：设置更新源（本地 HTTP 更新源）→ check-update 各分支 → 下载校验；
 *      建群 → 邀请成员 → group-list / group-members。
 *   3. 关闭进程，用**同一个 userData 目录**再起一次：group-list / group-members
 *      必须还在（真实重启持久化），更新源也必须还在。
 *
 * 说明：为了让临时副本能启动，会 patch 两行与本次改动无关的代码（真实源码不动）：
 *   - 去掉重复注册的 warmy:qingChuCuoWu（Electron 会因重复注册抛异常）
 *   - 去掉 yingYong.setAsDefaultProtocolClient（避免改到本机注册表）
 */
import {execFileSync, spawn} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(here, '..');
const repoRoot = path.join(pkgRoot, '..', '..');
const require = createRequire(import.meta.url);

let failures = 0;
function check(biaoQian, cond, detail) {
  if (!cond) failures++;
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${biaoQian}${detail === undefined ? '' : ` => ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 本地更新源 ──
const ARTIFACT = Buffer.from('WArmy e2e installer payload 无限牛马\n'.repeat(64), 'utf8');
const ARTIFACT_SHA = crypto.createHash('sha256').update(ARTIFACT).digest('hex');
let port = 0;
const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if (url.pathname === '/feed.json') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({
      version: '9.9.9',
      notes: 'e2e feed',
      url: `http://127.0.0.1:${port}/artifact.bin`,
      sha256: ARTIFACT_SHA,
      size: ARTIFACT.length,
    }));
  }
  if (url.pathname === '/feed-not-json') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end('<html>nope</html>');
  }
  if (url.pathname === '/artifact.bin') {
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(ARTIFACT.length) });
    return res.end(ARTIFACT);
  }
  res.writeHead(404);
  res.end('nf');
});
port = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const feedUrl = `http://127.0.0.1:${port}/feed.json`;
const deadPort = await new Promise((resolve) => {
  const s = http.createServer();
  s.listen(0, '127.0.0.1', () => {
    const p = s.address().port;
    s.close(() => resolve(p));
  });
});
console.log(`本地更新源: ${feedUrl}\n构件 ${ARTIFACT.length} 字节 sha256=${ARTIFACT_SHA}`);

// ── 准备临时可运行副本 ──
const electronPath = require('electron');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-e2e-'));
const appRoot = path.join(tmpRoot, 'yingYong');
fs.mkdirSync(appRoot, { recursive: true });
fs.cpSync(path.join(pkgRoot, 'dist'), path.join(appRoot, 'dist'), { recursive: true });
fs.copyFileSync(path.join(pkgRoot, 'package.json'), path.join(appRoot, 'package.json'));
const userData = path.join(tmpRoot, 'userdata');
fs.mkdirSync(userData, { recursive: true });

const mainFile = path.join(appRoot, 'dist', 'electron-main.js');
const lines = fs.readFileSync(mainFile, 'utf8').split('\n');
let seenClearError = false;
let dedupRemoved = 0;
let protocolPatched = 0;
const patched = [];
for (const line of lines) {
  if (line.includes("ipcMain.handle('warmy:qingChuCuoWu'")) {
    if (seenClearError) {
      dedupRemoved++;
      continue; // 丢掉重复注册那一行
    }
    seenClearError = true;
  }
  if (line.includes("yingYong.setAsDefaultProtocolClient('dsh-app')")) {
    protocolPatched++;
    patched.push(line.replace("yingYong.setAsDefaultProtocolClient('dsh-app')", 'void 0'));
    continue;
  }
  patched.push(line);
}
fs.writeFileSync(mainFile, patched.join('\n'), 'utf8');

// 工作区包用 junction 链到真实包目录（临时副本没有 pnpm 的 node_modules）
const nmDir = path.join(appRoot, 'node_modules', '@warmy');
fs.mkdirSync(nmDir, { recursive: true });
const linked = [];
for (const pkg of ['contracts', 'providers', 'group-router', 'board', 'ccr-compressor', 'knowledge-base', 'sync-protocol', 'dsh-runtime', 'asset-governance']) {
  const target = path.join(repoRoot, 'packages', pkg);
  if (!fs.existsSync(target)) continue;
  try {
    fs.symlinkSync(target, path.join(nmDir, pkg), 'junction');
    linked.push(pkg);
  } catch {
    /* 已存在则忽略 */
  }
}
console.log(`临时副本: ${appRoot}`);
console.log(`  patch: 重复 clear-error 行删除 ${dedupRemoved} 处; setAsDefaultProtocolClient 置空 ${protocolPatched} 处(仅副本)`);
console.log(`  链接工作区包 ${linked.length} 个: ${linked.join(', ')}`);

// ── 极简 CDP 客户端 ──
async function connect(devtoolsPort, appPrefix) {
  const deadline = Date.now() + 45000;
  let target = null;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${devtoolsPort}/json/list`)).json();
      // 只认自己这个副本的页面，避免误连到本机其它 Electron 实例
      target = list.find(
        (t) => t.type === 'page' && t.webSocketDebuggerUrl && String(t.url || '').toLowerCase().includes(appPrefix)
      );
      if (target) break;
    } catch {
      /* 还没起来 */
    }
    await sleep(300);
  }
  if (!target) throw new Error('devtools page target not found');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener('error', (e) => reject(new Error(`ws error ${String(e?.message || e)}`)), { once: true });
  });
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const xiaoXi = JSON.parse(ev.data);
    if (xiaoXi.id && pending.has(xiaoXi.id)) {
      const { resolve, reject } = pending.get(xiaoXi.id);
      pending.delete(xiaoXi.id);
      if (xiaoXi.error) reject(new Error(`cdp ${JSON.stringify(xiaoXi.error)}`));
      else resolve(xiaoXi.result);
    }
  });
  const faSong = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await faSong('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) {
      throw new Error(`renderer exception: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    }
    return r.result.value;
  };
  // 等主进程 bootstrap 完成（appInfo 需要 accountStore，而 accountStore 在 bootstrap 里建）
  const readyDeadline = Date.now() + 45000;
  let ready = false;
  while (Date.now() < readyDeadline && !ready) {
    try {
      ready = await evaluate(`(async () => { try { const r = await window.warmy.appInfo(); return !!(r && r.ok); } catch { return false; } })()`);
    } catch {
      /* 渲染进程还没就绪 */
    }
    if (!ready) await sleep(400);
  }
  if (!ready) throw new Error('main process bootstrap timeout');
  return { evaluate, close: () => ws.close() };
}

async function launchApp(tag) {
  const child = spawn(electronPath, [mainFile, `--user-data-dir=${userData}`, '--remote-debugging-port=0'], {
    cwd: appRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
  });
  const logs = [];
  let devtoolsPort = 0;
  const onChunk = (d) => {
    const text = String(d);
    logs.push(text);
    const m = text.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
    if (m && m[1]) devtoolsPort = Number(m[1]);
  };
  child.stdout.on('data', onChunk);
  child.stderr.on('data', onChunk);
  const portDeadline = Date.now() + 30000;
  while (!devtoolsPort && Date.now() < portDeadline) {
    if (child.exitCode !== null) break;
    await sleep(200);
  }
  if (!devtoolsPort) {
    console.log(`[${tag}] 主进程没起来，输出如下：\n${logs.join('')}`);
    throw new Error(`${tag}: no devtools port (yingYong failed to start)`);
  }
  // 等副本自己的页面出现 + 主进程 bootstrap 完成
  const appPrefix = path.join(appRoot, 'dist', 'renderer').toLowerCase().replace(/\\/g, '/');
  const cdp = await connect(devtoolsPort, appPrefix);
  console.log(`[${tag}] Electron 已启动 (pid=${child.pid}, devtools=${devtoolsPort})`);
  return { child, cdp, logs };
}

async function killApp(inst, tag) {
  try {
    inst.cdp.close();
  } catch {
    /* 忽略 */
  }
  try {
    execFileSync('taskkill', ['/F', '/T', '/PID', String(inst.child.pid)], { stdio: 'ignore' });
  } catch {
    try {
      inst.child.kill('SIGKILL');
    } catch {
      /* 忽略 */
    }
  }
  await sleep(1500);
  console.log(`[${tag}] 已退出`);
}

// ── 第一轮 ──
console.log('\n[第一轮] 启动真实 Electron 主进程');
const app1 = await launchApp('run1');
const q = (expr) => app1.cdp.evaluate(expr);
const call = (api, ...args) =>
  q(`(async () => { try { return await window.warmy.${api}(${args.map((a) => JSON.stringify(a)).join(', ')}); } catch (e) { return { __error: String((e && e.message) || e) }; } })()`);

const info = await q('(async () => await window.warmy.appInfo())()');
check('preload 暴露 appInfo（真实 IPC 通）', info?.ok === true, { version: info?.version, electron: info?.electron });

console.log('\n[第一轮 A] check-update：默认 GitHub 源 / 清空后未配置 / 有更新 / 网络失败 / 响应非法');
const s0 = await call('updateSourceGet');
// 产品定稿：默认更新源 = GitHub Releases API
check('默认更新源指向 GitHub', s0.configured === true && /github\.com/i.test(String(s0.url || '')), s0);
const cDef = await call('checkUpdate');
check('默认 GitHub 源可检查（明确状态）',
  ['up-to-date', 'update-available', 'network-error', 'http-error', 'invalid-response'].includes(cDef.status), cDef);
await call('updateSourceSet', { url: '' });
const c0 = await call('checkUpdate');
check('清空后 status=not-configured（不是「已是最新」）', c0.status === 'not-configured' && c0.ok === false && c0.upToDate === false, { status: c0.status, ok: c0.ok, upToDate: c0.upToDate });

const set1 = await call('updateSourceSet', { url: feedUrl });
check('写入更新源（settings.json）', set1.ok === true && set1.configured === true, set1);
const c1 = await call('checkUpdate');
check('有更新：status=update-available, latest=9.9.9', c1.status === 'update-available' && c1.latestVersion === '9.9.9', { status: c1.status, latest: c1.latestVersion });

await call('updateSourceSet', { url: `http://127.0.0.1:${deadPort}/feed.json` });
const c2 = await call('checkUpdate');
check('网络失败：status=network-error', c2.status === 'network-error' && c2.ok === false, { status: c2.status, reason: c2.reason });

await call('updateSourceSet', { url: `http://127.0.0.1:${port}/feed-not-json` });
const c3 = await call('checkUpdate');
check('响应非法：status=invalid-response(bad-json)', c3.status === 'invalid-response' && c3.reason === 'bad-json', { status: c3.status, reason: c3.reason });

await call('updateSourceSet', { url: feedUrl });
const c4 = await call('checkUpdate');
check('切回正常源后又是 update-available', c4.status === 'update-available', c4.status);
const auto = await call('autoUpdateCheck');
check('auto-update-check 同一套状态（autoUpdateStatus=available）', auto.autoUpdateStatus === 'available' && auto.status === 'update-available', { status: auto.status, auto: auto.autoUpdateStatus });

console.log('\n[第一轮 B] 下载：真实落盘 + sha256/size 校验');
const dl = await call('autoUpdateDownload');
check('下载 status=downloaded 且 verified=true', dl.status === 'downloaded' && dl.verified === true && dl.verification === 'sha256+size', { status: dl.status, verification: dl.verification });
check('构件落在 userData/updates 下且哈希一致', !!dl.filePath && fs.existsSync(dl.filePath) && crypto.createHash('sha256').update(fs.readFileSync(dl.filePath)).digest('hex') === ARTIFACT_SHA, { filePath: dl.filePath, bytes: dl.bytes });
check('installImplemented=false（安装未实现被明确标出）', dl.installImplemented === false, dl.installNotes);
const dl2 = await call('autoUpdateDownload');
check('重复下载同样成功（幂等覆盖）', dl2.status === 'downloaded', dl2.status);

console.log('\n[第一轮 C] 群列表 / 群成员');
const g0 = await call('groupList');
check('初始 group-list 是真实空列表（ok + groups:[]，非演示数据）', g0.ok === true && Array.isArray(g0.groups) && g0.groups.length === 0, g0);

const gc = await call('groupCreate', { groupId: 'g-e2e', ming: 'E2E 作战群', type: 'internal' });
check('建群 ok', gc.ok === true, gc);
const g1 = await call('groupList');
check('group-list 立刻能读到该群（来自落盘存储）', g1.ok === true && g1.count === 1 && g1.groups[0].groupId === 'g-e2e', g1.groups?.[0]);
check('group-list 带 memberCount / jiHuo / type', g1.groups?.[0]?.memberCount === 0 && g1.groups?.[0]?.jiHuo === true && g1.groups?.[0]?.type === 'internal', g1.groups?.[0]);

const inv = await call('groupInvite', { groupId: 'g-e2e', ming: '牛马-E2E' });
check('邀请成员 ok', inv.ok === true && inv.members.length === 1, inv.members);
const inv2 = await call('groupInvite', { groupId: 'g-e2e', ming: '牛马-E2E-2', role: 'admin' });
check('邀请第二位成员（admin）', inv2.ok === true && inv2.members.length === 2, inv2.members.map((m) => `${m.name}:${m.role}`));
const mem = await call('groupMembers', 'g-e2e');
check('group-members 返回邀请的成员', mem.ok === true && mem.members.length === 2, mem.members.map((m) => `${m.name}:${m.role}`));
const g1b = await call('groupList');
check('group-list 的 memberCount 同步更新', g1b.groups?.[0]?.memberCount === 2, g1b.groups?.[0]?.memberCount);
const directed = await call('groupDirected', { groupId: 'g-e2e', directed: true });
check('定向模式切换落盘', directed.ok === true && directed.directedMode === true, directed);
const srcNow = await call('updateSourceGet');
check('updateSourceGet 报告已配置的更新源', srcNow.configured === true && String(srcNow.url).includes('/feed.json'), { url: srcNow.url, last: srcNow.lastCheck?.status });

console.log(`\n[第一轮结束] 关闭进程 pid=${app1.child.pid}（groupMembers 若只在内存，这里就丢了）`);
await killApp(app1, 'run1');
const groupsFile = path.join(userData, 'groups.json');
const groupsJson = fs.existsSync(groupsFile) ? JSON.parse(fs.readFileSync(groupsFile, 'utf8')) : null;
check('groups.json 已落盘', !!groupsJson, groupsFile);
check('groups.json 含 g-e2e 与 2 名成员', groupsJson?.groups?.length === 1 && (groupsJson?.members?.['g-e2e'] || []).length === 2, groupsJson?.members?.['g-e2e']?.map((m) => m.name));
const settingsFile = path.join(userData, 'settings.json');
const settingsJson = fs.existsSync(settingsFile) ? JSON.parse(fs.readFileSync(settingsFile, 'utf8')) : null;
check('settings.json 记录了 updateFeedUrl', settingsJson?.updateFeedUrl === feedUrl, settingsJson?.updateFeedUrl);

// ── 第二轮：同一个 userData 重启 ──
console.log('\n[第二轮] 用同一个 userData 目录重启，检查是否还记得');
const app2 = await launchApp('run2');
const q2 = (expr) => app2.cdp.evaluate(expr);
const call2 = (api, ...args) =>
  q2(`(async () => { try { return await window.warmy.${api}(${args.map((a) => JSON.stringify(a)).join(', ')}); } catch (e) { return { __error: String((e && e.message) || e) }; } })()`);

const g2 = await call2('groupList');
check('重启后 group-list 仍有 g-e2e（真实持久化）', g2.ok === true && g2.count === 1 && g2.groups[0].groupId === 'g-e2e', g2.groups);
check('重启后群属性保留（ming/type/directed/memberCount）', g2.groups?.[0]?.name === 'E2E 作战群' && g2.groups?.[0]?.directedMode === true && g2.groups?.[0]?.memberCount === 2, g2.groups?.[0]);
const mem2 = await call2('groupMembers', 'g-e2e');
check('重启后 group-members 仍有 2 人（原来只是内存 Map）', mem2.ok === true && mem2.members.length === 2 && mem2.members.some((m) => m.name === '牛马-E2E'), mem2.members.map((m) => `${m.name}:${m.role}`));
const msg2 = await call2('groupMessage', { groupId: 'g-e2e', content: '重启后还能发消息吗' });
check('重启后群消息路由仍认识该群（不是 no-group）', msg2.ok === true && msg2.reason !== 'no-group', { action: msg2.action, reason: msg2.reason, duty: msg2.duty });
const g2b = await call2('groupCreate', { groupId: 'g-e2e', ming: 'E2E 作战群', type: 'internal' });
check('重启后重复建群不报错（幂等复用）', g2b.ok === true, g2b);
const c5 = await call2('checkUpdate');
check('重启后更新源仍在且仍能查到有更新', c5.status === 'update-available' && c5.latestVersion === '9.9.9', { status: c5.status, latest: c5.latestVersion });
const clr = await call2('updateSourceSet', { url: '' });
const c6 = await call2('checkUpdate');
check('清空更新源后又回到 not-configured', clr.configured === false && c6.status === 'not-configured', { configured: clr.configured, status: c6.status });
const kickTarget = mem2.members.find((m) => m.name === '牛马-E2E-2');
const k = await call2('groupKick', { groupId: 'g-e2e', memberId: kickTarget.id });
check('踢人成功并返回剩余成员', k.ok === true && k.members.length === 1, k.members.map((m) => m.name));
const g3 = await call2('groupList');
check('group-list memberCount 随踢人更新', g3.groups?.[0]?.memberCount === 1, g3.groups?.[0]?.memberCount);
const d = await call2('groupDissolve', 'g-e2e');
const g4 = await call2('groupList');
check('解散后 group-list 为空（存储删除）', d.ok === true && g4.count === 0, { dissolve: d, count: g4.count });
await killApp(app2, 'run2');

const bootLog = path.join(userData, 'warmy-boot.log');
if (fs.existsSync(bootLog)) {
  const log = fs.readFileSync(bootLog, 'utf8').trim().split('\n');
  console.log('\n[主进程 boot 日志摘录（groups / updater 相关）]');
  for (const l of log.filter((x) => /groups|updater/.test(x))) console.log('  ' + l);
}

server.close();
console.log(`\n结论: ${failures === 0 ? '全部通过' : `${failures} 项失败`}`);
console.log(`临时根目录: ${tmpRoot}`);
process.exit(failures === 0 ? 0 : 1);
