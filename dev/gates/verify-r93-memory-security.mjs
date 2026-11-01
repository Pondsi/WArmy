/**
 * 第 93 轮：
 *  ① 知识条目使用频率（knowledge_query 命中才累加）；
 *  ② 短记忆只从“本会话有权读的知识层”补高频且未在短记忆中的内容；超限删最低频；
 *  ③ 用户明确“记住”/工具踩坑 ⇒ 即时落知识库；
 *  ④ 完全授权的禁止区：其他会话工作区/历史 + 程序安装目录；命令路径扫描。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PKG = path.join(ROOT, 'packages/app-shell');
const DIST = path.join(PKG, 'dist');
const ELECTRON = path.join(PKG, 'node_modules', 'electron', 'dist', 'electron.exe');
const MAIN = path.join(DIST, 'electron-main.js');
let okN = 0, failN = 0;
const ok = (m, d) => { okN++; console.log('  ok   ' + m + (d === undefined ? '' : ' ← ' + String(d).slice(0, 260))); };
const bad = (m, d) => { failN++; console.log('  FAIL ' + m + (d === undefined ? '' : ' ← ' + String(d).slice(0, 320))); };
const jian = (m, c, d) => (c ? ok(m, d) : bad(m, d));

console.log('\n[1] 知识条目使用频率');
const KB = await import(pathToFileURL(path.join(ROOT, 'packages/knowledge-base/dist/index.js')).href);
const kdir = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-r93-kb-'));
try {
  const kb = new KB.ZhishiCang(kdir);
  const ev = (id, use = 0) => ({ id, biaoTi: id, result: 'r-' + id, entityIds: [], anchors: [], ts: Date.now(), useCount: use, lastUsedAt: use ? Date.now() : 0 });
  kb.session.addEvent(ev('a', 0));
  kb.internal.addEvent(ev('b', 0));
  kb.noteUse([{ id: 'a', _ceng: 'session' }, { id: 'b', _ceng: 'internal' }, { id: 'a', _ceng: 'session' }]);
  const a = kb.session.activeEvents().find((x) => x.id === 'a');
  const b = kb.internal.activeEvents().find((x) => x.id === 'b');
  jian('noteUse 按层累加', a.useCount === 2 && b.useCount === 1, { a: a.useCount, b: b.useCount });
  jian('noteUse 记录最后使用时间', a.lastUsedAt > 0 && b.lastUsedAt > 0);
  const act = kb.activeEventsIn(['session', 'internal']);
  jian('activeEventsIn 只返回有权层并带 _ceng', act.length === 2 && act.some((x) => x._ceng === 'session') && act.some((x) => x._ceng === 'internal'));
  kb.session.addEvent(ev('gone', 0));
  kb.session.supersedeEvent('gone');
  jian('activeEventsIn 过滤被取代条目', kb.activeEventsIn(['session']).every((x) => x.id !== 'gone'));
} finally { fs.rmSync(kdir, { recursive: true, force: true }); }

console.log('\n[2] 完全授权禁止区真值表');
const PP = await import(pathToFileURL(path.join(DIST, 'protected-paths.js')).href);
const ud = path.join(process.env.APPDATA || os.homedir(), '@warmy', 'app-shell');
const base = path.join(ud, 'workspace', 's1');
const prog = path.join(os.tmpdir(), 'warmy-r93-prog');
PP.setProgramDirs([prog]);
const cases = [
  ['本会话工作区', path.join(base, 'a.txt'), null],
  ['其他会话工作区', path.join(ud, 'workspace', 's2', 'x.txt'), '其他会话的工作区'],
  ['workspace 根', path.join(ud, 'workspace'), '其他会话的工作区'],
  ['历史记忆', path.join(ud, 'memory', 'fast-memory.jsonl'), '会话历史 / 记忆数据'],
  ['短记忆', path.join(ud, 'guifan', 's2.md'), '会话历史 / 记忆数据'],
  ['要求', path.join(ud, 'yaoqiu', 's2.md'), '会话历史 / 记忆数据'],
  ['程序目录', path.join(prog, 'src', 'x.ts'), '程序安装目录'],
  ['桌面', path.join(process.env.USERPROFILE || os.homedir(), 'Desktop', 'a.txt'), null],
];
for (const [ming, p, want] of cases) {
  const got = PP.protectedPathReason(p, base);
  jian('路径：' + ming, got === want, { got, want });
}
const cmds = [
  ['相对 cd 越界', 'cd ../s2 && dir', '其他会话的工作区'],
  ['环境变量路径', 'type "%APPDATA%\\@warmy\\app-shell\\workspace\\s2\\x.txt"', '其他会话的工作区'],
  ['程序目录绝对路径', 'type "' + path.join(prog, 'package.json') + '"', '程序安装目录'],
  ['普通工作区命令', 'echo hi > ok.txt', null],
  ['动态编码命令', 'powershell -EncodedCommand ZQBjAGgAbwA=', '命令使用动态执行/编码路径，无法确认不会访问禁止区域'],
];
for (const [ming, c, want] of cmds) {
  const got = PP.protectedCommandReason(c, base, base);
  jian('命令：' + ming, got === want, { got, want });
}

console.log('\n[3] 文件工具行为级：完全授权也不能越禁止区');
const WTM = await import(pathToFileURL(path.join(DIST, 'work-tools.js')).href);
const tmpU = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-r93-ws-'));
try {
  const s1 = path.join(tmpU, 'workspace', 's1');
  const s2 = path.join(tmpU, 'workspace', 's2');
  fs.mkdirSync(s1, { recursive: true }); fs.mkdirSync(s2, { recursive: true });
  const prog2 = path.join(tmpU, 'prog'); fs.mkdirSync(prog2, { recursive: true });
  PP.setProgramDirs([prog2]);
  const wOk = WTM.workWriteFile(s1, { path: 'ok.txt', content: 'ok' }, true);
  const wOther = WTM.workWriteFile(s1, { path: '../s2/x.txt', content: 'x' }, true);
  const wProg = WTM.workWriteFile(s1, { path: path.join(prog2, 'x.txt'), content: 'x' }, true);
  jian('工作区内仍可写（负向断言不误伤）', wOk.ok === true, JSON.stringify(wOk.meta));
  jian('完全授权下写其他会话工作区被拒', wOther.ok === false && /protected-path/.test(String(wOther.meta.error || '')), JSON.stringify(wOther.meta));
  jian('完全授权下写程序目录被拒', wProg.ok === false && /protected-path/.test(String(wProg.meta.error || '')), JSON.stringify(wProg.meta));
  const rProg = WTM.workReadFile(s1, { path: path.join(prog2, 'x.txt') }, true);
  jian('完全授权下读程序目录被拒', rProg.ok === false && /protected-path/.test(String(rProg.meta.error || '')), JSON.stringify(rProg.meta));
} finally { fs.rmSync(tmpU, { recursive: true, force: true }); }

console.log('\n[3b] 接线静态判据');
const MAIN_SRC = fs.readFileSync(path.join(PKG, 'src', 'electron-main.ts'), 'utf8');
jian('knowledge_query 命中后累加使用次数', /knowledge\.noteUse\(shiJian/.test(MAIN_SRC));
jian('短记忆候选只来自本会话有权读的知识层', /kbLayersFor\(sid\)/.test(MAIN_SRC) && /knowledge\.activeEventsIn\(layers\)/.test(MAIN_SRC));
jian('短记忆候选要求 useCount > 0', /Number\(e\.useCount\) > 0/.test(MAIN_SRC));
jian('超限压缩走按频率的 yaSuoDuanJiYi', /function yaSuoDuanJiYi/.test(MAIN_SRC) && /function duGuiFan[\s\S]{0,300}yaSuoDuanJiYi/.test(MAIN_SRC));
jian('频率放侧车文件、不塞进正文', /\.freq\.json/.test(MAIN_SRC) && /function duanJiYiPinLu/.test(MAIN_SRC));
jian('完全授权禁止区在 run_shell 前检查', /protectedCommandReason\(cmd/.test(MAIN_SRC));
jian('open_path / 读文档 / lsp / 下载也检查禁止区', /protectedPathReason\(abs, baseH\)/.test(MAIN_SRC) && /protectedPathReason\(target, baseH\)/.test(MAIN_SRC) && /protectedPathReason\(abs, baseH\)/.test(MAIN_SRC));
jian('文件工具按禁止区检查', /protectedPathReason\(abs, baseDir\)/.test(fs.readFileSync(path.join(PKG, 'src', 'work-tools.ts'), 'utf8')));
jian('即时记住/踩坑写知识库', /function jiShiJiZhuYongHuHua/.test(MAIN_SRC) && /function jiShiJiZhuCaiKeng/.test(MAIN_SRC) && /user:explicit-remember/.test(MAIN_SRC) && /host:pitfall/.test(MAIN_SRC));

console.log('\n[4] 真 Electron：短记忆按频率更新/压缩 + 即时记忆');
const profile = path.join(os.tmpdir(), 'warmy-r93-live-' + Date.now());
fs.mkdirSync(path.join(profile, 'knowledge'), { recursive: true });
fs.mkdirSync(path.join(profile, 'guifan'), { recursive: true });
const SID = 'inst-r93';
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  yuYan: 'zh-CN', setupDone: true, privacyConsent: true, guideDone: true, providersSeeded: true,
  instances: [{ id: SID, ming: '牛马-R93', name: '牛马-R93', status: 'running', model: 'mimo-v2.6-flash', chain: ['mimo-v2.6-flash'], chainDisabled: [] }],
  providers: [], authGrants: { [SID]: [] }, panelCardCollapsed: {},
}, null, 2), 'utf8');
const now = Date.now();
const ev = (id, biao, use) => ({ id, biaoTi: biao, result: '内容-' + id, entityIds: [], anchors: [], ts: now, useCount: use, lastUsedAt: use ? now - use * 1000 : 0 });
fs.writeFileSync(path.join(profile, 'knowledge', 'knowledge-session.json'), JSON.stringify({
  entities: [], events: [ev('ev-a', '高频条目', 9), ev('ev-b', '低频条目', 1), ev('ev-c', '没用过条目', 0)],
}, null, 2), 'utf8');
fs.writeFileSync(path.join(profile, 'knowledge', 'knowledge-internal.json'), JSON.stringify({
  entities: [], events: [ev('ev-i', '内部高频条目', 9)],
}, null, 2), 'utf8');
const { attach, sleep } = await import(pathToFileURL(path.join(PKG, 'scripts', 'cdp-lib.mjs')).href);
const PORT = Number(process.env.R93_PORT || 9671);
let child = null, c = null;
try {
  const env = { ...process.env, WARMY_AUTH_BYPASS: '1', WARMY_TEST_HOOKS: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(ELECTRON, ['--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, MAIN], { cwd: PKG, stdio: ['ignore', 'ignore', 'ignore'], windowsHide: false, env });
  let last = '';
  for (let i = 0; i < 80; i++) { try { c = await attach(PORT, { biaoQian: 'r93', callTimeout: 15000 }); break; } catch (e) { last = e.message; await sleep(300); } }
  if (!c) throw new Error('CDP 未连接：' + last);
  await c.send('Runtime.enable');
  await c.waitFor('document.body.getAttribute("data-warmy-auth") === "ready"', { timeout: 30000, biaoQian: '认证旁路' });
  await sleep(600);
  const guiNa = await c.evaluate(`window.warmy.testDuanJiYi({ sessionId: ${JSON.stringify(SID)}, action: 'guiNa' })`);
  jian('归档补入高频未在短记忆中的条目（新口径：共享层最多 3/5，内部条目优先）', !!(guiNa && guiNa.ok && guiNa.added >= 1 && /内部高频条目/.test(guiNa.text)), JSON.stringify(guiNa && { added: guiNa.added, text: guiNa.text }));
  jian('未用过的没进来，且共享内容不独占短记忆（无聊天时可最多 3 条 KB 起步）', !!(guiNa && !/没用过条目/.test(guiNa.text) && (() => { const lines=guiNa.text.split('\n').filter(l=>/^\s*-\s+/.test(l)); const shared=lines.filter(l=>!/内部高频条目/.test(l)).length; return shared <= 3 && (lines.length >= 5 ? shared*5 <= lines.length*3 : true); })()), guiNa && guiNa.text);

  // 造一份超限短记忆：高频一条、低频多条；调用 compress 应删低频、留高频
  const high = '- 高频必须保留 ' + '甲'.repeat(80);
  const lows = Array.from({ length: 10 }, (_, i) => `- 低频第${i + 1}条 ` + '乙'.repeat(220));
  const body = '## 短记忆（归档自动整理；界面不可见）\n' + high + '\n' + lows.join('\n') + '\n';
  fs.writeFileSync(path.join(profile, 'guifan', SID + '.md'), body, 'utf8');
  const pin = {};
  const crypto = await import('node:crypto');
  const norm = (s) => String(s).replace(/[\s\p{P}]/gu, '').toLowerCase();
  const hash = (s) => crypto.createHash('sha1').update(norm(s)).digest('hex').slice(0, 16);
  pin[hash(high.replace(/^\s*-\s+/, ''))] = { n: 20, last: now };
  for (const l of lows) pin[hash(l.replace(/^\s*-\s+/, ''))] = { n: 1, last: now };
  fs.writeFileSync(path.join(profile, 'guifan', SID + '.freq.json'), JSON.stringify({ v: 1, items: pin }, null, 2), 'utf8');
  const comp = await c.evaluate(`window.warmy.testDuanJiYi({ sessionId: ${JSON.stringify(SID)}, action: 'compress' })`);
  jian('超限压缩后 <= 2000 字', !!(comp && comp.ok && comp.text.length <= 2000), comp && comp.text.length);
  jian('压缩保留高频条目、删掉低频条目', !!(comp && /高频必须保留/.test(comp.text) && !/低频第1条/.test(comp.text)), comp && comp.text.slice(0, 120));

  const inst = await c.evaluate(`window.warmy.testInstantMemory({ sessionId: ${JSON.stringify(SID)}, text: '以后都用中文回答，记住这一点。今天天气不错。' })`);
  jian('用户说“记住” ⇒ 即时落知识库', !!(inst && inst.ok && Array.isArray(inst.added) && inst.added.length === 1 && inst.events.some((e) => /以后都用中文回答/.test(String(e.result || '')))), JSON.stringify(inst && { added: inst.added }));
  jian('普通闲聊不会误记', !!(inst && !inst.events.some((e) => /今天天气不错/.test(String(e.result || '')))));
  const pit = await c.evaluate(`window.warmy.testInstantMemory({ sessionId: ${JSON.stringify(SID)}, pitfall: { tool: 'write_file', why: 'ENOENT: no such file or directory' } })`);
  jian('工具踩坑 ⇒ 即时沉淀', !!(pit && pit.ok && pit.pit === true && pit.events.some((e) => String(e.biaoTi || '').startsWith('踩坑·write_file'))), JSON.stringify(pit && { pit: pit.pit }));
  const pitNo = await c.evaluate(`window.warmy.testInstantMemory({ sessionId: ${JSON.stringify(SID)}, pitfall: { tool: 'read_file', why: '权限不足，未授权访问' } })`);
  jian('被守卫/权限拦下也记踩坑（第 96 轮用户口径）', !!(pitNo && pitNo.ok && pitNo.pit === true && pitNo.events.some((e) => /权限不足|未授权/.test(String(e.result || '')))));
  const errs = (typeof c.errors === 'function' ? c.errors() : []) || [];
  jian('全程无脚本错误', errs.length === 0, JSON.stringify(errs).slice(0, 200));
} finally {
  try { if (c) await c.send('Browser.close', {}, { timeout: 5000 }); } catch { /* 已退 */ }
  await sleep(500);
  try { if (child) execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* 已退 */ }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 尽力清 */ }
}

console.log(`\nverify-r93-memory-security: ${okN} ok / ${failN} FAIL`);
process.exitCode = failN ? 1 : 0;
