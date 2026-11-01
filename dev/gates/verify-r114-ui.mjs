/**
 * verify-r114-ui.mjs —— 真 Electron（临时 profile）：
 *   我的页用户名下方有 导入数据/导出数据/定时导出 三个可见入口；
 *   设置→关于不再有这三个入口；我的页显示全量加密状态（未登录=登录后开启）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {attach, sleep} from '../../packages/app-shell/scripts/cdp-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pkg = path.join(root, 'packages/app-shell');
const port = Number(process.env.R114_PORT || 10316);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-r114-ui-'));
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  yuYan: 'zh-CN', setupDone: true, privacyConsent: true, guideDone: true,
  guideChatDone: true, providersSeeded: true, providers: [], instances: [],
}));
const env = {...process.env, WARMY_AUTH_BYPASS: '1'};
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(path.join(pkg, 'node_modules/electron/dist/electron.exe'), [
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, path.join(pkg, 'dist/electron-main.js'),
], {cwd: pkg, env, stdio: 'ignore'});
let c;
let passed = 0;
const check = (name, cond, detail) => { assert.ok(cond, name + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail))); passed += 1; console.log('PASS ' + name); };
try {
  const deadline = Date.now() + 30000;
  while (!c && Date.now() < deadline) { try { c = await attach(port, {matchUrlIncludes: 'index.html', callTimeout: 15000}); } catch { await sleep(200); } }
  assert.ok(c, 'Electron did not start');
  await c.waitFor(`typeof document.querySelector('[data-nav="wo"]').onclick === 'function'`, {timeout: 30000});
  await c.evaluate(`window.__err = []; window.addEventListener('error', (e) => window.__err.push(String(e.message || e.error || e))); document.querySelector('[data-nav="wo"]').onclick();`);
  await sleep(1800);
  const info = await c.evaluate(`(() => {
    const ids = ['anNiuDaoRuWo','anNiuDaoChuWo','anNiuDingShiDaoChuWo'];
    const rows = ids.map((id) => { const b = document.getElementById(id); if (!b) return {id, ok:false}; const r = b.getBoundingClientRect(); return {id, ok:true, text:b.textContent.trim(), w:r.width, h:r.height, vis: r.width>0 && r.height>0}; });
    const hang = document.querySelector('.woDataHang');
    const status = document.getElementById('woJiaMiZhuangTai');
    const pageText = (document.getElementById('pageTi')?.innerText || '').slice(0, 160);
    const errs = (window.__err || []).map(String);
    return {rows, hang: !!hang, status: status ? status.textContent.trim() : '', navWo: !!document.querySelector('[data-nav="wo"]'), pageText, errs};
  })()`);
  check('我的页用户名下有数据入口分组', info.hang === true, info);
  for (const r of info.rows) check(`入口可见：${r.id}`, r.ok && r.vis && r.text.length > 0, r);
  check('三个入口顺序为 导入/导出/定时导出', info.rows[0].text.includes('导入') && info.rows[1].text.includes('导出') && info.rows[2].text.includes('定时'), info.rows.map((x) => x.text));
  check('我的页显示全量加密状态', info.status.includes('全量加密'), info.status);
  await c.evaluate(`document.querySelector('[data-nav="settings"]').click()`);
  await sleep(600);
  const gone = await c.evaluate(`!['anNiuDaoChuSheZhi','anNiuDaoRuSheZhi','anNiuDingShiDaoChu'].some((id) => document.getElementById(id))`);
  check('设置→关于已移除这三个入口', gone === true);
  console.log(`\nverify-r114-ui: ${passed} PASS / 0 FAIL`);
} finally {
  try { child.kill(); } catch { /* noop */ }
  await sleep(700);
  try { fs.rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 150}); } catch { /* noop */ }
}
