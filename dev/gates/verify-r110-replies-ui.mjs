/**
 * verify-r110-replies-ui.mjs —— 真 Electron（临时 profile，auth bypass）：
 * 同一用户轮里放两条模型回复 + 两条操作，验证：
 *   ① 两条回复都在、顺序按 ts；② 操作各归各的回复（不全部堆到最后一条）；
 *   ③ 主进程 chatLogAppend 连续写两条 assistant 回复时不会互相覆盖。
 * 不写真实 profile。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { attach, sleep } from '../../packages/app-shell/scripts/cdp-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pkg = path.join(root, 'packages/app-shell');
const port = Number(process.env.R110R_PORT || 10311);
const occupied = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(1000) }).then(() => true, () => false);
assert.equal(occupied, false, 'CDP port must be unused');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-r110-replies-'));
const sid = 'r110-replies';
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  yuYan: 'zh-CN', setupDone: true, privacyConsent: true, guideDone: true,
  guideChatDone: true, providersSeeded: true, providers: [],
  instances: [{ id: sid, ming: '回复保留验收', name: '回复保留验收', status: 'running', chain: [], chainDisabled: [] }],
}));
const env = { ...process.env, WARMY_AUTH_BYPASS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(path.join(pkg, 'node_modules/electron/dist/electron.exe'), [
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, path.join(pkg, 'dist/electron-main.js'),
], { cwd: pkg, env, stdio: 'ignore' });
let c;
let passed = 0;
const check = (name, condition, detail) => {
  assert.ok(condition, name + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail)));
  passed += 1;
  console.log('PASS ' + name);
};
const evalOk = async (expr) => {
  const r = await c.evaluate(expr);
  assert.ok(!r?.__exc, 'Renderer evaluation failed: ' + r?.__exc);
  return r;
};
try {
  const deadline = Date.now() + 30000;
  while (!c && Date.now() < deadline) {
    try { c = await attach(port, { matchUrlIncludes: 'index.html', callTimeout: 15000 }); }
    catch { await sleep(150); }
  }
  assert.ok(c, 'Electron dev app did not start');
  await c.send('Runtime.enable');
  await c.waitFor('window.__warmyBootDataReady === true', { timeout: 30000 });
  await evalOk(`window.warmy.chatLogAppend({sessionId:${JSON.stringify(sid)},role:'user',content:'回复保留验收'})`);
  await c.send('Page.reload');
  await c.waitFor('window.__warmyBootDataReady === true', { timeout: 30000 });
  await evalOk(`document.querySelector('[data-nav="singleAi"]').click()`);
  await c.waitFor(`!!document.querySelector('#lieBiaoTi .lieBiaoTiaoMu')`);
  await evalOk(`document.querySelector('#lieBiaoTi .lieBiaoTiaoMu').click()`);
  await c.waitFor(`window.__r35?.huiHua() === ${JSON.stringify(sid)}`);

  const fixture = await evalOk(`(() => {
    const sid = window.__r35.huiHua();
    const T = Date.now() + 60000;
    window.__msgs = window.__msgs || {};
    window.__msgs[sid] = [];
    window.__r35.qingHangDong();
    window.__r35.tian({ role: 'wo', text: '一次性任务', ts: T });
    window.__r35.tian({ role: 'them', text: '第一份回复：完整保留。', ts: T + 1000, reasoningDuan: [{ ts: T + 100, text: '第一段思考' }], zhongJian: [{ ts: T + 200, text: '第一段中间回复' }] });
    window.__r35.tian({ role: 'them', text: '第二份回复：核对结论。', ts: T + 4000, reasoningDuan: [{ ts: T + 1200, text: '第二段思考' }], zhongJian: [{ ts: T + 1300, text: '第二段中间回复' }] });
    window.__r35.hangDong({ hao: 'r110-a1', ts: T + 500, op: '读取第一份', raw: 'read_file', detail: 'a.txt', status: 'ok', ms: 5 });
    window.__r35.hangDong({ hao: 'r110-a2', ts: T + 2500, op: '读取第二份', raw: 'read_file', detail: 'b.txt', status: 'ok', ms: 5 });
    window.__r35.guiNa();
    return { T };
  })()`);
  await sleep(250);
  const dom = await evalOk(`(() => {
    const rows = [...document.querySelectorAll('#xiaoXiJi .xiaoXi.them')]
      .filter((n) => !n.hasAttribute('data-streaming'))
      .sort((a, b) => (Number(a.dataset.ts) || 0) - (Number(b.dataset.ts) || 0));
    return rows.map((n) => ({
      ts: Number(n.dataset.ts) || 0,
      text: n.querySelector('.bubble')?.textContent || '',
      acts: [...n.querySelectorAll('.xingDongZu')].map((x) => x.textContent || ''),
      mids: [...n.querySelectorAll('.zhongJianKa')].map((x) => x.textContent || ''),
    }));
  })()`);
  check('两条模型回复都保留（不是只剩最后一条）', dom.length === 2, dom);
  check('两条回复按时间先后排列', dom[0]?.ts < dom[1]?.ts && dom[0]?.text.includes('第一份') && dom[1]?.text.includes('第二份'), dom.map((x) => x.text));
  check('第一份回复的操作归第一份', dom[0]?.acts.length === 1 && dom[0].acts.join('').includes('读取第一份'), dom[0]?.acts);
  check('第二份回复的操作归第二份（不串到第一份）', dom[1]?.acts.length === 1 && dom[1].acts.join('').includes('读取第二份'), dom[1]?.acts);
  check('两条回复各自的中间回复都在', dom[0]?.mids.length === 1 && dom[1]?.mids.length === 1, dom.map((x) => x.mids));

  const logs = await evalOk(`(async () => {
    await window.warmy.chatLogAppend({ sessionId: ${JSON.stringify(sid)}, role: 'assistant', content: '主进程写入 A1' });
    await window.warmy.chatLogAppend({ sessionId: ${JSON.stringify(sid)}, role: 'assistant', content: '主进程写入 A2' });
    const r = await window.warmy.chatMessages({ sessionId: ${JSON.stringify(sid)}, limit: 500 });
    return (r?.xiaoXiJi || []).filter((m) => m.role === 'assistant').map((m) => m.text);
  })()`);
  check('主进程连续写两条 assistant 回复不会互相覆盖',
    logs.filter((x) => x === '主进程写入 A1').length === 1 && logs.filter((x) => x === '主进程写入 A2').length === 1, logs);
  console.log(`\nverify-r110-replies-ui: ${passed} PASS / 0 FAIL`);
} finally {
  try { child.kill(); } catch { /* noop */ }
  await sleep(500);
  if (process.env.R110_KEEP === '1') console.log('FIXTURE ' + profile);
  else fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
