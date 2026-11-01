/**
 * verify-r111-data-ui.mjs —— 真 Electron（临时 profile，auth bypass）：
 * 定时导出弹窗高度服从主界面/内容可滚动、数据范围只有一棵细化树（子类默认折叠）、
 * 循环次数与间隔同一行；手动导出弹窗有加密勾选和同一棵树。
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
const port = Number(process.env.R111_UI_PORT || 10312);
const occupied = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(1000) }).then(() => true, () => false);
assert.equal(occupied, false, 'CDP port must be unused');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-r111-data-ui-'));
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  yuYan: 'zh-CN', setupDone: true, privacyConsent: true, guideDone: true,
  guideChatDone: true, providersSeeded: true, providers: [],
  instances: [], chats: [], groups: [],
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

  const schedule = await evalOk(`(async () => {
    await window.__showDingShiDaoChuDialog();
    const card = document.querySelector('#duiHuaKuangGen .duiHuaKuangKa');
    const ti = document.querySelector('#duiHuaKuangTi');
    const cr = card.getBoundingClientRect();
    const rows = ['dscCycles','dscInterval'].map((id) => document.getElementById(id)?.closest('label')?.getBoundingClientRect());
    const cats = [...document.querySelectorAll('[data-scope-cat-box]')];
    const details = [...document.querySelectorAll('#duiHuaKuangTi details')];
    return {
      open: !document.getElementById('duiHuaKuangGen').classList.contains('yinCang'),
      cardH: Math.round(cr.height), viewH: window.innerHeight,
      overflow: getComputedStyle(ti).overflowY,
      scrollable: ti.scrollHeight >= ti.clientHeight,
      hasDetailText: /更细致/.test(ti.textContent),
      cats: cats.length,
      details: details.length,
      openDetails: details.filter((d) => d.open).length,
      sameRow: !!rows[0] && !!rows[1] && Math.abs(rows[0].top - rows[1].top) <= 2,
      text: ti.textContent.slice(0, 160),
    };
  })()`);
  check('定时导出弹窗打开', schedule.open);
  check('卡片高度不超出主界面（留有边距）', schedule.cardH <= schedule.viewH - 40, schedule);
  check('内容区可滚动（不是整张卡片溢出）', (schedule.overflow === 'auto' || schedule.overflow === 'scroll') && schedule.scrollable, schedule);
  check('不再出现“更细致的选择”', schedule.hasDetailText === false, schedule);
  check('数据范围是六类细化树，且子分类默认折叠', schedule.cats === 6 && schedule.details >= 6 && schedule.openDetails === 0, schedule);
  check('循环次数与间隔在同一行', schedule.sameRow === true, schedule);

  const cleared = await evalOk(`(() => {
    document.getElementById('duiHuaKuangGen').classList.add('yinCang');
    const chat = document.querySelector('[data-scope-cat-box="chat"] [data-scope-cat]');
    chat.click();
    const kids = [...document.querySelectorAll('[data-scope-cat-box="chat"] [data-scope-child]')];
    const off = kids.every((x) => x.disabled) && document.querySelector('[data-scope-cat-box="chat"]').classList.contains('daoChuCatOff');
    chat.click();
    return { off, kids: kids.length };
  })()`);
  check('取消大类会禁用其子项并标灰，重新勾选恢复', cleared.off && cleared.kids > 0, cleared);

  const manual = await evalOk(`(async () => {
    void window.__showDataExportDialog();
    await new Promise((r) => setTimeout(r, 120));
    const card = document.querySelector('#duiHuaKuangGen .duiHuaKuangKa');
    const cr = card.getBoundingClientRect();
    return {
      open: !document.getElementById('duiHuaKuangGen').classList.contains('yinCang'),
      encryptChecked: !!document.getElementById('expEncrypt')?.checked,
      cats: document.querySelectorAll('[data-scope-cat-box]').length,
      cardH: Math.round(cr.height), viewH: window.innerHeight,
    };
  })()`);
  check('手动导出弹窗有加密勾选（默认加密）与同一棵范围树', manual.open && manual.encryptChecked && manual.cats === 6, manual);
  check('手动导出卡片也不超出主界面', manual.cardH <= manual.viewH - 40, manual);
  console.log(`\nverify-r111-data-ui: ${passed} PASS / 0 FAIL`);
} finally {
  try { child.kill(); } catch { /* noop */ }
  await sleep(500);
  if (process.env.R111_KEEP === '1') console.log('FIXTURE ' + profile);
  else fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
