/**
 * verify-r73-nengli —— P0-6 白名单 D：自动加入的能力类别「审计可见 + 一键撤销」
 *
 * 真 Electron + CDP（临时 profile，WARMY_AUTH_BYPASS=1）：
 *  · 预置 nengli.json 两条自动加入条目；设置 → 功能里能看到列表与撤销按钮；
 *  · 点撤销 → 二次确认 → 列表只剩 1 条、nengli.json 同步只留 1 条；
 *  · 审计里落 kb.capability-removed；固定类别（base）不在可撤销列表里；
 *  · 未知 id 返回 not-found；全程无脚本错误。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PKG = path.join(ROOT, 'packages', 'app-shell');
const ELECTRON = path.join(PKG, 'node_modules', 'electron', 'dist', 'electron.exe');
const MAIN = path.join(PKG, 'dist', 'electron-main.js');
const { attach, sleep } = await import(pathToFileURL(path.join(PKG, 'scripts', 'cdp-lib.mjs')).href);
const PORT = Number(process.env.R73_NENGLI_PORT || 9651);
const profile = path.join(os.tmpdir(), 'warmy-r73-nengli-' + Date.now());
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  yuYan: 'zh-CN', setupDone: true, privacyConsent: true, guideDone: true, providers: [], instances: [],
}), 'utf8');
fs.writeFileSync(path.join(profile, 'nengli.json'), JSON.stringify({
  items: [
    { id: 'z-test-a', hua: '测试能力甲', ci: ['测试', '能力'] },
    { id: 'z-test-b', hua: '测试能力乙', ci: ['测试', '能力'] },
  ],
}), 'utf8');

const env = { ...process.env, WARMY_AUTH_BYPASS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(ELECTRON, ['--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, MAIN], {
  cwd: PKG, stdio: ['ignore', 'ignore', 'ignore'], env,
});
let c = null;
let ok = 0;
const hong = [];
const jian = (name, pass, detail) => {
  if (pass) { ok += 1; console.log('  ok   ' + name); return; }
  hong.push(name);
  console.log('  FAIL ' + name + (detail === undefined ? '' : ' ← ' + String(detail).slice(0, 500)));
};
const js = (e) => c.evaluate('(async function(){ try { return await (' + e + '); } catch (err) { return { __err: String((err && (err.stack || err.message)) || err).slice(0, 300) }; } })()');
const rd = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };

async function guan() {
  try { if (c) await c.send('Browser.close', {}, { timeout: 6000 }); } catch { /* 已退 */ }
  await sleep(700);
  try { process.kill(child.pid, 0); execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* 已退 */ }
}

try {
  let last = '';
  for (let i = 0; i < 60; i++) {
    try { c = await attach(PORT, { biaoQian: 'r73-nengli', callTimeout: 12000 }); break; } catch (e) { last = e.message; await sleep(300); }
  }
  if (!c) throw new Error('CDP 未连接：' + last);
  await c.send('Runtime.enable');
  await c.send('Page.enable');
  await c.waitFor('!!window.warmy && typeof window.warmy.nengLiWaiLieBiao === "function"', { timeout: 20000, biaoQian: 'preload 白名单 API' });
  await sleep(400);

  const list0 = await js(`window.warmy.nengLiWaiLieBiao()`);
  jian('预置的两条自动加入条目可读出，固定类别数 > 0',
    list0 && list0.ok === true && Array.isArray(list0.items) && list0.items.length === 2
    && list0.items[0].id === 'z-test-a' && Number(list0.base) > 0,
    JSON.stringify(list0));

  await c.clickUntil('[data-nav="settings"]', '!!document.querySelector("#nengLiWaiKa")', { timeout: 8000 });
  const tab = await c.evaluate(`(() => { const b = document.querySelector('#peiZhiDaoHang button[data-sec="func"]'); if (b) { b.click(); return true; } return false; })()`);
  await sleep(350);
  const ui0 = await js(`(() => {
    const ka = document.querySelector('#nengLiWaiKa');
    const btns = [...document.querySelectorAll('#nengLiWaiLieBiao [data-nengli-chexiao]')];
    return {
      tab: !!document.querySelector('#peiZhiDaoHang button[data-sec="func"]'),
      visible: (ka && ka.getBoundingClientRect().width) > 0,
      texts: btns.map((b) => b.textContent.trim()),
      ids: btns.map((b) => b.getAttribute('data-nengli-chexiao')),
      summary: document.querySelector('#nengLiWaiJiShu')?.textContent.trim() || '',
      hasBaseRevoke: /固定类别/.test(ka?.innerText || ''),
    };
  })()`);
  jian('设置 → 功能里能看到能力白名单卡片、两条撤销按钮与固定/自动计数',
    tab === true && ui0 && ui0.visible === true && ui0.texts.length === 2 && ui0.texts.every((x) => x === '撤销')
    && ui0.ids.join(',') === 'z-test-a,z-test-b' && /固定类别/.test(ui0.summary) && /自动加入/.test(ui0.summary),
    JSON.stringify(ui0));

  await c.clickUntil('#nengLiWaiLieBiao [data-nengli-chexiao="z-test-a"]', '!!document.querySelector("#duiHuaKuangDongZuoJi .anNiuZhuYao")', { timeout: 5000 });
  const dlg = await js(`document.querySelector('#duiHuaKuangTi')?.textContent || ''`);
  jian('撤销前有二次确认，确认文案说明后果', /不再允许出现在对外概要里/.test(dlg), dlg);
  await c.clickUntil('#duiHuaKuangDongZuoJi .anNiuZhuYao', 'document.querySelectorAll("#nengLiWaiLieBiao [data-nengli-chexiao]").length === 1', { timeout: 8000 });
  await sleep(250);
  const after = await js(`(() => ({
    n: document.querySelectorAll('#nengLiWaiLieBiao [data-nengli-chexiao]').length,
    ids: [...document.querySelectorAll('#nengLiWaiLieBiao [data-nengli-chexiao]')].map((b) => b.getAttribute('data-nengli-chexiao')),
  }))()`);
  const disk = JSON.parse(rd(path.join(profile, 'nengli.json')) || '{}');
  jian('撤销后界面只剩 1 条，nengli.json 同步只剩 z-test-b',
    after && after.n === 1 && after.ids.join(',') === 'z-test-b'
    && Array.isArray(disk.items) && disk.items.length === 1 && disk.items[0].id === 'z-test-b',
    JSON.stringify({ after, disk }));

  const bad = await js(`window.warmy.nengLiWaiCheXiao('no-such-id')`);
  jian('未知 id 撤销返回 not-found，不会误删别的条目', bad && bad.ok === false && bad.error === 'not-found', JSON.stringify(bad));

  let auditText = '';
  const walk = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (/\.jsonl$/.test(f.name)) auditText += rd(p);
    }
  };
  try { walk(profile); } catch { /* noop */ }
  jian('撤销落了审计 kb.capability-removed（带条目名）', /kb\.capability-removed/.test(auditText) && /测试能力甲/.test(auditText), auditText.slice(-500));

  const errors = c.errors();
  jian('白名单撤销流程无脚本/控制台错误', errors.length === 0, JSON.stringify(errors));
} catch (e) {
  hong.push('未捕获异常');
  console.log('  FAIL 未捕获异常 ← ' + String((e && (e.stack || e.message)) || e).slice(0, 600));
} finally {
  try { await guan(); } catch { /* noop */ }
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
}
console.log(`\n==== verify-r73-nengli：${ok} ok / ${hong.length} FAIL ====`);
process.exit(hong.length ? 1 : 0);
