/**
 * verify-r96-memory —— 第 96 轮短记忆/即时记忆行为门禁（Electron + CDP，临时 profile）。
 *
 * 验证：
 *  1. 短记忆只从本会话可读知识层选；共享 session 层最多占 3/5；
 *  2. 与本会话最新归档“要点”重复的条目不进短记忆，已有的会被清掉；
 *  3. 老短记忆里不在知识库的条目会补写进知识库（内容敏感度选层）；
 *  4. 压缩短记忆不再往知识库写 `prompt:overflow`；
 *  5. “记住”按内容敏感度分层；被守卫拦下的失败也会当场记踩坑。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PKG = path.join(ROOT, 'packages/app-shell');
const ELECTRON = path.join(PKG, 'node_modules', 'electron', 'dist', 'electron.exe');
const MAIN = path.join(PKG, 'dist', 'electron-main.js');
const { attach, sleep } = await import(pathToFileURL(path.join(PKG, 'scripts', 'cdp-lib.mjs')).href);
const PORT = Number(process.env.R96_PORT || 9696);
const profile = path.join(os.tmpdir(), 'warmy-r96-memory-' + Date.now());
const NOW = Date.now();
const DAY = 86400000;
const SID = 'inst-r96-mem';
const GROUP = 'grp-r96-mem';
const SID_GROUP_ONLY = 'grp-r96-only';
fs.mkdirSync(path.join(profile, 'knowledge'), { recursive: true });
fs.mkdirSync(path.join(profile, 'guifan'), { recursive: true });
fs.mkdirSync(path.join(profile, 'archive'), { recursive: true });

fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  yuYan: 'zh-CN', setupDone: true, privacyConsent: true, guideDone: true, providersSeeded: true,
  instances: [{ id: SID, ming: '牛马-记忆', name: '牛马-记忆', status: 'running', privateKb: true, model: 'x', chain: ['x'], chainDisabled: [] }],
  providers: [], authGrants: {}, panelCardCollapsed: {},
}, null, 2), 'utf8');
fs.writeFileSync(path.join(profile, 'groups.json'), JSON.stringify({
  version: 1,
  groups: [
    { id: GROUP, ming: '外部群', name: '外部群', type: 'external', members: [] },
    { id: SID_GROUP_ONLY, ming: '只有共享层的外部群', name: '只有共享层的外部群', type: 'external', members: [] },
  ],
  members: {}, uiStateMigrated: true,
}, null, 2), 'utf8');
fs.writeFileSync(path.join(profile, 'chat-meta.json'), JSON.stringify({
  version: 1, savedAt: NOW,
  sessions: {
    [SID]: { msgs: [
      { role: 'user', content: '第一段对话', ts: NOW - 60 * DAY },
      { role: 'assistant', content: '回答一', ts: NOW - 60 * DAY + 1000 },
      { role: 'user', content: '最近一段对话', ts: NOW - 2 * DAY },
      { role: 'assistant', content: '回答二', ts: NOW - 2 * DAY + 1000 },
    ] },
    [SID_GROUP_ONLY]: { msgs: [
      { role: 'user', content: '群里的对话', ts: NOW - 2 * DAY },
      { role: 'assistant', content: '群里的回答', ts: NOW - 2 * DAY + 1000 },
    ] },
  },
}, null, 2), 'utf8');

const ev = (id, biaoTi, result, useCount, ageDays, laiYuan = 'test') => ({
  id, biaoTi, result, entityIds: [], anchors: [],
  ts: NOW - ageDays * DAY,
  useCount,
  lastUsedAt: NOW - ageDays * DAY,
  useLog: Array.from({ length: Math.min(useCount, 8) }, (_, i) => NOW - (ageDays + i * 2) * DAY),
  laiYuan,
});
fs.writeFileSync(path.join(profile, 'knowledge', 'knowledge-session.json'), JSON.stringify({
  entities: [], events: [
    ev('ev-s1', '共享条目一', '共享条目一：公开流程说明', 6, 1),
    ev('ev-s2', '共享条目二', '共享条目二：公开能力说明', 5, 3),
    ev('ev-s-existing', '共享已有条目', '共享已有条目：公开资料', 3, 10),
  ],
}, null, 2), 'utf8');
fs.writeFileSync(path.join(profile, 'knowledge', 'knowledge-internal.json'), JSON.stringify({
  entities: [], events: [
    ev('ev-i1', '会话专属高价值', '会话专属高价值：本项目内部做法', 9, 1),
    ev('ev-i2', '会话专属次要', '会话专属次要：本项目内部备注', 2, 4),
    ev('ev-point', '本会话要点', '与要点重复的条目', 20, 1),
  ],
}, null, 2), 'utf8');
fs.writeFileSync(path.join(profile, 'knowledge', 'knowledge-private.json'), JSON.stringify({ entities: [], events: [] }, null, 2), 'utf8');
fs.writeFileSync(path.join(profile, 'guifan', SID + '.md'),
  '## 短记忆（归档自动整理；界面不可见）\n- 与要点重复的条目\n- 会话专属旧条目：项目内部做法\n- 共享已有条目\n', 'utf8');
fs.writeFileSync(path.join(profile, 'archive', 'archives.jsonl'), JSON.stringify({
  id: 'arc-r96', groupId: SID, summary: '## 要点\n- 与要点重复的条目\n- 本次任务目标',
  structured: { bullets: ['与要点重复的条目', '本次任务目标'], decisions: [], todos: [], risks: [] },
}) + '\n', 'utf8');

let child = null, c = null;
let okN = 0, failN = 0;
const ok = (m, d) => { okN++; console.log('  ok   ' + m + (d === undefined ? '' : ' ← ' + String(d).slice(0, 320))); };
const bad = (m, d) => { failN++; console.log('  FAIL ' + m + (d === undefined ? '' : ' ← ' + String(d).slice(0, 400))); };
const jian = (m, cond, d) => (cond ? ok(m, d) : bad(m, d));
const js = (e) => c.evaluate('(async function(){ try { return await (' + e + '); } catch (err) { return { __err: String((err && (err.stack || err.message)) || err).slice(0, 400) }; } })()');
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(path.join(profile, f), 'utf8')); } catch { return null; } };
const duan = () => { try { return fs.readFileSync(path.join(profile, 'guifan', SID + '.md'), 'utf8'); } catch { return ''; } };
const eventsOf = (ceng) => (readJson(`knowledge/knowledge-${ceng}.json`) || {}).events || [];

try {
  const env = { ...process.env, WARMY_AUTH_BYPASS: '1', WARMY_TEST_HOOKS: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(ELECTRON, ['--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, MAIN], {
    cwd: PKG, stdio: ['ignore', 'ignore', 'ignore'], windowsHide: false, env,
  });
  let last = '';
  for (let i = 0; i < 90; i++) {
    try { c = await attach(PORT, { biaoQian: 'r96-memory', callTimeout: 20000 }); break; } catch (e) { last = e.message; await sleep(300); }
  }
  if (!c) throw new Error('CDP 未连接：' + last);
  await c.send('Runtime.enable');
  await c.waitFor('!!document.querySelector("[data-nav=singleAi]")', { timeout: 30000 });

  /**
   * 第 97 轮澄清：短记忆的非 KB 部分来自**本会话聊天记录**。
   * 门禁直接种聊天日志（chat-meta 只是界面旁路，不是主进程 chatLogs 的事实源）。
   */
  for (const [sid0, text] of [
    [SID, '以后回答先说结论，再给证据。'],
    [SID, '这个项目的客户报价和合同结算属于业务内部信息。'],
    [SID, '最近一段对话：先做短记忆测试。'],
    [SID_GROUP_ONLY, '群里约定：以后先说结论。'],
  ]) {
    await js(`window.warmy.chatLogAppend({ sessionId: ${JSON.stringify(sid0)}, role: 'user', content: ${JSON.stringify(text)} })`);
  }
  await sleep(400);

  const r1 = await js(`window.warmy.testDuanJiYi({ sessionId: ${JSON.stringify(SID)}, action: 'guiNa' })`);
  const t1 = duan();
  const lines = t1.split('\n').filter((l) => /^\s*-\s+/.test(l)).map((l) => l.replace(/^\s*-\s+/, '').trim());
  const sessionEvents = eventsOf('session');
  const internalEvents = eventsOf('internal');
  const allEvents = [...sessionEvents, ...internalEvents, ...eventsOf('private')];
  const shared = lines.filter((l) => sessionEvents.some((e) => String(e.result || '').includes(l) || String(e.biaoTi || '').includes(l))).length;
  jian('短记忆已更新出条目', !!(r1 && r1.ok && lines.length >= 2), JSON.stringify({ r1, lines }));
  jian('共享 session 层条目最多占 3/5', shared * 5 <= lines.length * 3, JSON.stringify({ shared, total: lines.length, lines }));
  jian('与本会话要点重复的条目已从短记忆清掉', !lines.includes('与要点重复的条目'), JSON.stringify(lines));
  jian('与本会话要点重复的知识事件没有写进短记忆', !lines.some((l) => l.includes('与要点重复的条目')), JSON.stringify(lines));
  jian('老短记忆里不在知识库的条目保留为会话内容（不再写回知识库）',
    !internalEvents.some((e) => String(e.laiYuan || '') === 'short-memory:migrate')
    && lines.includes('会话专属旧条目：项目内部做法'),
    JSON.stringify({ lines, ev: internalEvents.map((e) => ({ t: e.biaoTi, lai: e.laiYuan })) }));
  jian('短记忆包含本会话聊天内容（不全是知识库）', lines.some((l) => /先说结论|客户报价|最近一段对话/.test(l)), JSON.stringify(lines));
  jian('高频会话专属内容进入短记忆', lines.some((l) => l.includes('会话专属高价值')), JSON.stringify(lines));

  // R96-1（选 B）：只有共享层、没有自己内容的外部群，允许最多 3 条共享起步
  const rg = await js(`window.warmy.testDuanJiYi({ sessionId: ${JSON.stringify(SID_GROUP_ONLY)}, action: 'guiNa' })`);
  const tg = fs.readFileSync(path.join(profile, 'guifan', SID_GROUP_ONLY + '.md'), 'utf8');
  const linesG = tg.split('\n').filter((l) => /^\s*-\s+/.test(l)).map((l) => l.replace(/^\s*-\s+/, '').trim());
  const sharedG = linesG.filter((l) => sessionEvents.some((e) => String(e.result || '').includes(l) || String(e.biaoTi || '').includes(l))).length;
  jian('群聊从本会话聊天记录补足（不再为空）', !!(rg && rg.ok && linesG.length >= 1), JSON.stringify({ rg, linesG }));
  jian('群聊短记忆里 KB 内容不超过 3/5', sharedG * 5 <= linesG.length * 3, JSON.stringify({ sharedG, total: linesG.length, linesG }));

  // 压缩不再写知识库：塞入超长、知识库中不存在的条目，记录事件数后压缩
  const beforeCount = allEvents.length;
  const long = Array.from({ length: 4 }, (_, i) => '- 压缩测试条目' + i + '：' + '很长的内容'.repeat(80)).join('\n');
  fs.writeFileSync(path.join(profile, 'guifan', SID + '.md'), '## 短记忆（归档自动整理；界面不可见）\n' + long + '\n', 'utf8');
  const r2 = await js(`window.warmy.testDuanJiYi({ sessionId: ${JSON.stringify(SID)}, action: 'compress' })`);
  const afterCount = eventsOf('session').length + eventsOf('internal').length + eventsOf('private').length;
  jian('压缩超长短记忆成功', !!(r2 && r2.ok && duan().length < 2000), JSON.stringify({ r2, chars: duan().length }));
  jian('压缩短记忆不再往知识库写 prompt:overflow', afterCount === beforeCount,
    JSON.stringify({ beforeCount, afterCount, lai: [...eventsOf('internal'), ...eventsOf('session'), ...eventsOf('private')].filter((e) => String(e.laiYuan || '').includes('overflow')) }));

  // 即时记忆按内容敏感度分层
  const privText = '记住：我的身份证号和家庭住址是私密信息，不要外传。';
  const intText = '记住：这个项目的客户报价和合同结算属于业务内部信息。';
  const pubText = '记住：以后回答先说结论。';
  const rp = await js(`window.warmy.testInstantMemory({ sessionId: ${JSON.stringify(SID)}, text: ${JSON.stringify(privText)} })`);
  const ri = await js(`window.warmy.testInstantMemory({ sessionId: ${JSON.stringify(SID)}, text: ${JSON.stringify(intText)} })`);
  const rs = await js(`window.warmy.testInstantMemory({ sessionId: ${JSON.stringify(SID)}, text: ${JSON.stringify(pubText)} })`);
  const nowEvents = [...eventsOf('private'), ...eventsOf('internal'), ...eventsOf('session')];
  jian('“记住”私密内容写入 private', !!(rp && rp.ok && (rp.added || []).length >= 1 && (rp.events || []).some((e) => e.ceng === 'private' && String(e.result || '').includes('身份证号'))), JSON.stringify({ rp, ev: nowEvents.filter((e) => String(e.result || '').includes('身份证号')).map((e) => e.laiYuan) }));
  jian('“记住”业务内容写入 internal', !!(ri && ri.ok && (ri.added || []).length >= 1 && eventsOf('internal').some((e) => String(e.result || '').includes('客户报价'))), JSON.stringify({ ri }));
  jian('“记住”普通内容写入 session', !!(rs && rs.ok && (rs.added || []).length >= 1 && eventsOf('session').some((e) => String(e.result || '').includes('先说结论'))), JSON.stringify({ rs }));
  const rk = await js(`window.warmy.testInstantMemory({ sessionId: ${JSON.stringify(SID)}, pitfall: { tool: 'run_shell', why: 'protected-path: 不允许访问其他会话工作区' } })`);
  jian('被守卫拦下的失败也当场记踩坑', !!(rk && rk.ok && rk.pit === true && (rk.events || []).some((e) => String(e.result || '').includes('protected-path'))), JSON.stringify({ rk }));

  const errs = (typeof c.errors === 'function' ? c.errors() : []) || [];
  jian('全程无脚本错误', errs.length === 0, JSON.stringify(errs).slice(0, 300));
} catch (e) {
  bad('门禁执行异常', String((e && (e.stack || e.message)) || e));
} finally {
  try { if (c) await c.send('Browser.close', {}, { timeout: 5000 }); } catch { /* 已退 */ }
  await sleep(600);
  try { if (child) execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* 已退 */ }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 尽力清 */ }
}

console.log(`\nverify-r96-memory: ${okN} ok / ${failN} FAIL`);
process.exitCode = failN ? 1 : 0;
