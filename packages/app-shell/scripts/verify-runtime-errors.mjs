/**
 * 运行时错误门禁（真机 CDP）：走一遍常见交互，断言**没有任何未捕获异常**。
 *
 * 为什么必须存在：`ReferenceError: updateListWatermark is not defined` 这类
 * “调用了未定义函数”的缺陷，静态检查（grep/tsc 不做跨文件闭包校验、JS 无类型）
 * 完全查不出来，而它会**中断 openChat 后续流程**，表现为“右栏分区/成员卡片不更新”。
 */
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {attach, sleep} from './cdp-lib.mjs';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(selfDir, '..');
const PORT = Number(process.env.WARMY_ERR_CDP_PORT || 9887);
const electron = path.join(pkgRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const mainJs = path.join(pkgRoot, 'dist', 'electron-main.js');

let pass = 0, fail = 0;
const errs = [];
function check(l, ok, d) {
  if (ok) { pass++; console.log('  ok  ' + l); }
  else { fail++; errs.push(l); console.log('  FAIL ' + l, d === undefined ? '' : ' => ' + JSON.stringify(d).slice(0, 400)); }
}

const child = spawn(electron, [
  `--remote-debugging-port=${PORT}`,
  '--disable-features=CalculateNativeWinOcclusion',
  `--user-data-dir=${path.join(os.tmpdir(), 'warmy-errgate-' + Date.now())}`,
  mainJs,
], { cwd: pkgRoot, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false });

try {
  for (let i = 0; i < 90; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json`, { signal: AbortSignal.timeout(1200) }); if (r.ok) break; } catch {}
    await sleep(500);
  }
  await sleep(4500);
  const c = await attach(PORT, { label: 'errgate', callTimeout: 20000 });
  await c.send('Runtime.enable');
  await sleep(1500);

  // 页面内记录所有未捕获异常 / 未处理 rejection
  await c.evaluate(`(function(){
    window.__errs = window.__errs || [];
    if (!window.__errHooked) {
      window.__errHooked = true;
      window.addEventListener('error', (e) => {
        window.__errs.push(String((e && (e.message || (e.error && e.error.message))) || 'error'));
      });
      window.addEventListener('unhandledrejection', (e) => {
        window.__errs.push('rejection: ' + String((e && e.reason && (e.reason.message || e.reason)) || 'unknown'));
      });
    }
    return true;
  })()`);

  const step = async (label, js) => {
    const r = await c.evaluate(`(function(){ try { ${js}; return { ok: true }; } catch (e) { return { ok: false, err: String((e && (e.stack || e.message)) || e).slice(0, 400) }; } })()`);
    check(`交互无异常：${label}`, !!r && r.ok === true, r && r.err);
  };

  await step('切换导航(我的牛马)', `document.querySelector('#rail [data-nav="singleAi"]').click();`);
  await sleep(900);
  await step('切换导航(项目)', `document.querySelector('#rail [data-nav="internalGroup"]').click();`);
  await sleep(900);
  await step('切换导航(联系人)', `document.querySelector('#rail [data-nav="externalChat"]').click();`);
  await sleep(900);
  await step('切换导航(群聊)', `document.querySelector('#rail [data-nav="externalGroup"]').click();`);
  await sleep(900);
  await step('打开设置', `document.querySelector('#rail [data-nav="settings"]').click();`);
  await sleep(1200);
  await step('打开我的', `document.querySelector('#rail [data-nav="me"]').click();`);
  await sleep(1200);

  // 建项目 → 选会话 → 打开会话（renderChat 路径）
  await step('创建内部项目', `window.__created = null;`);
  const gid = 'errgate-' + Date.now();
  await c.evaluate(`(async function(){ try { await window.warmy.groupCreate({ groupId:'${gid}', name:'ErrGate', type:'internal', directedMode:false, devEnv:'host' }); await window.__syncGroups(); } catch(e){} return true; })()`);
  await sleep(800);
  await step('切换导航(项目)', `document.querySelector('#rail [data-nav="internalGroup"]').click();`);
  await sleep(1500);
  await step('点击项目会话(走 openChat/renderChat)', `var r=document.querySelectorAll('#list-body .list-item'); if(r.length) r[0].onclick();`);
  await sleep(1500);
  await step('再次点击同一会话', `var r=document.querySelectorAll('#list-body .list-item'); if(r.length) r[0].onclick();`);
  await sleep(1200);

  // 右栏分区必须生效（成员卡片可见）
  const panel = await c.evaluate(`(function(){
    const el = document.getElementById('panel-members-block');
    if (!el) return { missing: true };
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { display: cs.display, w: Math.round(r.width), h: Math.round(r.height), cls: el.className };
  })()`);
  check('项目会话选中后「成员」卡片可见（证明 openChat 未中断）',
    panel && panel.display !== 'none' && panel.w > 0, panel);

  // 汇总页面内的未捕获异常
  const pageErrs = await c.evaluate(`window.__errs || []`);
  check('页面无未捕获异常/未处理 rejection', Array.isArray(pageErrs) && pageErrs.length === 0, pageErrs);

  // 主进程侧：诊断事件流里不应有 err.uncaught
  const logs = await c.evaluate(`(async function(){ try { const r = await window.warmy.lastError && window.warmy.lastError(); return r; } catch(e){ return null; } })()`);
  check('主进程 lastError 为空', !logs || !logs.error, logs);
} finally {
  try { child.kill('SIGKILL'); } catch {}
}

console.log(`\n==== verify-runtime-errors: ${pass} ok / ${fail} FAIL ====`);
if (errs.length) console.log('失败项：\n - ' + errs.join('\n - '));
process.exit(fail === 0 ? 0 : 1);
