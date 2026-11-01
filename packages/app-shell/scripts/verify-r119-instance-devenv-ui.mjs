#!/usr/bin/env node
/**
 * verify-r119-instance-devenv-ui.mjs —— 真机 UI：创建牛马时的「本机 / 容器中」。
 *
 * 用全新 user-data-dir + WARMY_AUTH_BYPASS=1 起 Electron，真实点开创建弹窗：
 *  A. 默认选中「本机」；
 *  B. 本机实例创建后，设置里显示「本机」且没有容器入口；
 *  C. 容器实例创建后，设置里显示「容器中」+「选择容器…」；
 *  D. 未选运行时的容器实例：聊天输入被禁用并给出容器未就绪的提示（不是静默失败）。
 *
 * 只操作临时 profile；结束时停掉这两只测试牛马并删除临时目录。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { attach, sleep } from './cdp-lib.mjs';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(selfDir, '..');
const PORT = Number(process.env.WARMY_R119_CDP_PORT || 9893);
const electron = path.join(pkgRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const mainJs = path.join(pkgRoot, 'dist', 'electron-main.js');
const profile = path.join(os.tmpdir(), 'warmy-r119-instance-' + Date.now());

let pass = 0, fail = 0;
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log('  ok   ' + label + (detail !== undefined ? '  ' + String(detail).slice(0, 200) : '')); }
  else { fail++; console.log('  FAIL ' + label + (detail !== undefined ? '  ' + String(detail).slice(0, 400) : '')); }
};

if (!fs.existsSync(mainJs)) { console.error('缺少 dist：请先 npm run build'); process.exit(2); }

const env = { ...process.env, WARMY_AUTH_BYPASS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [
  `--remote-debugging-port=${PORT}`,
  '--disable-features=CalculateNativeWinOcclusion',
  `--user-data-dir=${profile}`,
  mainJs,
], { cwd: pkgRoot, stdio: ['ignore', 'pipe', 'pipe'], env });

let c = null;
let finished = false;
const cleanup = async (ids) => {
  try {
    if (c && ids && ids.length) {
      for (const id of ids) await c.evaluate(`window.warmy.stopInstance(${JSON.stringify(id)}).catch(() => null)`).catch(() => null);
    }
  } catch { /* noop */ }
  try { child.kill('SIGKILL'); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
};
const die = async (code, msg, ids) => {
  if (msg) console.log(msg);
  if (finished) return;
  finished = true;
  await cleanup(ids);
  process.exit(code);
};
const failFast = async (label, detail, ids) => {
  console.log('  FAIL ' + label + (detail !== undefined ? '  ' + String(detail).slice(0, 400) : ''));
  await die(1, '中止：前置条件不满足，后续断言不再执行（不伪造通过）', ids);
};

let createdIds = [];

try {
  let up = false;
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json`, { signal: AbortSignal.timeout(1200) }); if (r.ok) { up = true; break; } } catch { /* retry */ }
    await sleep(500);
  }
  if (!up) await die(2, 'CDP 未启动');
  await sleep(4500);
  c = await attach(PORT, { biaoQian: 'r119-instance', callTimeout: 30000 });
  await c.send('Runtime.enable');
  /** 等到表达式返回非空值（超时返回 null，由调用方如实判红） */
  const waitVal = async (expr, timeout = 10000) => {
    try { return await c.waitFor(expr, { timeout }); } catch { return null; }
  };

  // ── 首启：语言 + 隐私 ──
  const hasPicker = await c.waitForQuiet(`!!document.getElementById('chuShiSheZhiYuYan')`, { timeout: 20000 });
  if (!hasPicker) await failFast('首启语言选择没有出现');
  await c.evaluate(`(function(){
    const s = document.getElementById('chuShiSheZhiYuYan');
    s.value = 'zh-CN'; s.dispatchEvent(new Event('change', { bubbles: true }));
    const b = [...document.querySelectorAll('#duiHuaKuangDongZuoJi button')][0]; if (b) b.click();
    return 1;
  })()`);
  await sleep(900);
  const hasPrivacy = await c.waitForQuiet(`!!document.getElementById('yinSiDuiHuaKuangTi')`, { timeout: 10000 });
  if (hasPrivacy) {
    await c.evaluate(`(function(){ const z=document.getElementById('yinSiDuiHuaKuangTi'); if(z) z.scrollTop=z.scrollHeight; return 1; })()`);
    await sleep(3600);
    await c.evaluate(`(function(){ const b=document.querySelector('#duiHuaKuangDongZuoJi button.anNiuZhuYao'); if(b&&!b.disabled) b.click(); return 1; })()`);
  }
  await c.waitForQuiet(`window.__warmyBootDone === true`, { timeout: 20000 });
  await sleep(1200);

  // ── A. 创建弹窗：默认本机 ──
  const opened = await c.evaluate(`(function(){
    const nav = document.querySelector('[data-nav="singleAi"]'); if (nav) nav.click();
    const b = document.getElementById('anNiuEnterHq') || document.querySelector('.lieBiaoHqTuBiao');
    if (b) { b.click(); return true; } return false;
  })()`);
  if (!opened) await failFast('找不到创建牛马入口');
  const dlg = await waitVal(`(function(){
    const host = document.getElementById('nmDevEnv');
    if (!host) return null;
    const bs = [...host.querySelectorAll('[data-nm-devenv]')];
    return {
      count: bs.length,
      host: !!host.querySelector('[data-nm-devenv="host"]'),
      container: !!host.querySelector('[data-nm-devenv="container"]'),
      active: (bs.find((x) => x.classList.contains('qiYong')) || {}).getAttribute ? (bs.find((x) => x.classList.contains('qiYong')) || {}).getAttribute('data-nm-devenv') : null,
      defaultMing: (document.getElementById('nmMing') || {}).value || '',
    };
  })()`, 10000);
  check('创建弹窗有两个选项（本机 / 容器中）', dlg && dlg.count === 2 && dlg.host && dlg.container, dlg);
  check('创建弹窗默认选中「本机」', dlg && dlg.active === 'host', dlg && dlg.active);
  check('创建弹窗预填名称', !!(dlg && dlg.defaultMing), dlg && dlg.defaultMing);
  if (!dlg) await failFast('创建弹窗没有出现', undefined, createdIds);

  // ── B. 本机实例 ──
  const hostName = 'R119本机';
  await c.evaluate(`(function(){
    const i = document.getElementById('nmMing'); i.value = ${JSON.stringify(hostName)}; i.dispatchEvent(new Event('input', { bubbles: true }));
    const ok = [...document.querySelectorAll('#duiHuaKuangDongZuoJi button')].find((b) => b.classList.contains('anNiuZhuYao'));
    if (ok) ok.click(); return 1;
  })()`);
  const hostSettings = await waitVal(`(function(){
    const env = document.getElementById('iKaiFaHuanJing');
    if (!env) return null;
    return { env: env.getAttribute('data-dev-env'), text: env.textContent.trim(), pick: !!document.getElementById('iRongQiXuanZe') };
  })()`, 15000);
  check('本机实例的设置弹窗自动打开且显示「本机」', !!hostSettings && hostSettings.env === 'host', hostSettings);
  check('本机实例没有「选择容器…」入口', !!hostSettings && hostSettings.pick === false, hostSettings);
  if (!hostSettings) await failFast('本机实例创建后没有打开设置弹窗', undefined, createdIds);
  // 关掉设置
  await c.evaluate(`(function(){ const b=[...document.querySelectorAll('#duiHuaKuangDongZuoJi button')].find((x)=>x.classList.contains('anNiuZhuYao')); if(b) b.click(); return 1; })()`);
  await sleep(700);
  let settings = await c.evaluate(`window.warmy.settingsGet().then((s)=>s&&s.settings||null)`);
  const hostInst = (settings && Array.isArray(settings.instances) ? settings.instances : []).find((x) => x && (x.name === hostName || x.ming === hostName));
  if (!(hostInst && hostInst.devEnv === 'host')) {
    const again = await waitVal(`window.warmy.settingsGet().then((s)=>{
      const list=(s&&s.settings&&s.settings.instances)||[];
      const it=list.find((x)=>x&&(x.name===${JSON.stringify(hostName)}||x.ming===${JSON.stringify(hostName)}));
      return it?{id:it.id,name:it.name,ming:it.ming,devEnv:it.devEnv,keys:Object.keys(it)}:null;
    })`, 5000);
    settings = await c.evaluate(`window.warmy.settingsGet().then((s)=>s&&s.settings||null)`);
    check('本机实例落盘 devEnv=host', !!again && again.devEnv === 'host', again || (settings && (settings.instances || []).map((x) => ({ name: x.name, ming: x.ming, devEnv: x.devEnv }))));
  } else {
    check('本机实例落盘 devEnv=host', true, { id: hostInst.id, devEnv: hostInst.devEnv });
  }
  const hostInst2 = (settings && Array.isArray(settings.instances) ? settings.instances : []).find((x) => x && (x.name === hostName || x.ming === hostName));
  if (hostInst2) createdIds.push(hostInst2.id);

  // ── C. 容器实例 ──
  const contName = 'R119容器';
  await c.evaluate(`(function(){ const b=document.querySelector('.lieBiaoHqTuBiao'); if (b) { b.click(); return 1; } return 0; })()`);
  const open2 = await c.waitForQuiet(`!!document.getElementById('nmDevEnv')`, { timeout: 8000 });
  if (!open2) await failFast('第二次创建弹窗没有打开', undefined, createdIds);
  await c.evaluate(`(function(){
    const cb = document.querySelector('[data-nm-devenv="container"]'); if (cb) cb.click();
    const i = document.getElementById('nmMing'); i.value = ${JSON.stringify(contName)}; i.dispatchEvent(new Event('input', { bubbles: true }));
    const ok = [...document.querySelectorAll('#duiHuaKuangDongZuoJi button')].find((b) => b.classList.contains('anNiuZhuYao'));
    if (ok) ok.click(); return 1;
  })()`);
  const contSettings = await waitVal(`(function(){
    const env = document.getElementById('iKaiFaHuanJing');
    if (!env) return null;
    return {
      env: env.getAttribute('data-dev-env'),
      text: env.textContent.trim(),
      pick: !!document.getElementById('iRongQiXuanZe'),
      current: (document.getElementById('iRongQiMing') || {}).textContent || '',
    };
  })()`, 15000);
  check('容器实例的设置弹窗显示「容器中」', !!contSettings && contSettings.env === 'container', contSettings);
  check('容器实例提供「选择容器…」入口', !!contSettings && contSettings.pick === true, contSettings);
  check('未选运行时显示「未选定」', !!contSettings && /未选定/.test(contSettings.current), contSettings && contSettings.current);
  if (!contSettings) await failFast('容器实例创建后没有打开设置弹窗', undefined, createdIds);
  // 设置里的「选择容器…」真的能打开选择弹窗（有可用容器或明确的空状态，不静默）
  await c.evaluate(`(function(){ const b=document.getElementById('iRongQiXuanZe'); if(b) b.click(); return 1; })()`);
  const pickDlg = await waitVal(`(function(){
    const none=document.getElementById('switchNone');
    const opt=document.querySelector('[data-pick]');
    if(!none && !opt) return null;
    return { title: (document.getElementById('duiHuaKuangBiaoTi')||{}).textContent || '', none: !!none, opts: document.querySelectorAll('[data-pick]').length };
  })()`, 20000);
  check('牛马设置「选择容器…」真的打开选择弹窗', !!pickDlg && /选择容器/.test(pickDlg.title), pickDlg);
  await c.evaluate(`(function(){ const b=document.getElementById('switchCancel'); if(b) b.click(); return 1; })()`);
  await sleep(500);
  await c.evaluate(`(function(){ const b=[...document.querySelectorAll('#duiHuaKuangDongZuoJi button')].find((x)=>x.classList.contains('anNiuZhuYao')); if(b) b.click(); return 1; })()`);
  await sleep(700);
  settings = await c.evaluate(`window.warmy.settingsGet().then((s)=>s&&s.settings||null)`);
  const contInst = (settings && Array.isArray(settings.instances) ? settings.instances : []).find((x) => x && (x.name === contName || x.ming === contName));
  if (!(contInst && contInst.devEnv === 'container')) {
    const again = await waitVal(`window.warmy.settingsGet().then((s)=>{
      const list=(s&&s.settings&&s.settings.instances)||[];
      const it=list.find((x)=>x&&(x.name===${JSON.stringify(contName)}||x.ming===${JSON.stringify(contName)}));
      return it?{id:it.id,name:it.name,ming:it.ming,devEnv:it.devEnv,keys:Object.keys(it)}:null;
    })`, 5000);
    check('容器实例落盘 devEnv=container', !!again && again.devEnv === 'container', again || (settings && (settings.instances || []).map((x) => ({ name: x.name, ming: x.ming, devEnv: x.devEnv }))));
  } else {
    check('容器实例落盘 devEnv=container', true, { id: contInst.id, devEnv: contInst.devEnv });
  }
  settings = await c.evaluate(`window.warmy.settingsGet().then((s)=>s&&s.settings||null)`);
  const contInst2 = (settings && Array.isArray(settings.instances) ? settings.instances : []).find((x) => x && (x.name === contName || x.ming === contName));
  if (contInst2) createdIds.push(contInst2.id);

  // ── D. 未选运行时的容器实例：聊天输入被禁用 ──
  const gate = await c.evaluate(`(function(){
    const rows = [...document.querySelectorAll('.lieBiaoTiaoMu')];
    const row = rows.find((r) => {
      const n = r.querySelector('.name');
      return n && n.textContent.trim() === ${JSON.stringify(contName)};
    });
    if (!row) return { clicked: false, names: rows.map((r) => (r.querySelector('.name') || {}).textContent || '') };
    row.click();
    return { clicked: true };
  })()`);
  await sleep(1800);
  const blocked = await c.evaluate(`(function(){
    const i = document.getElementById('shuRu');
    return { disabled: !!(i && i.disabled), devBlocked: i ? String(i.dataset.devBlocked || '') : '', title: i ? String(i.title || '') : '' };
  })()`);
  check('容器实例被真实选中（否则下一条不算数）', gate.clicked === true, gate);
  check('未选运行时的容器实例：输入框被禁用', blocked.disabled === true && blocked.devBlocked === '1', blocked);
  check('禁用时有「容器未就绪」提示（不是静默失败）', /容器未就绪/.test(blocked.title), blocked.title);

  // ── E. 实例选择容器：真实 IPC 写入（不依赖引擎是否就绪） ──
  const contId = contInst2 && contInst2.id;
  if (!contId) await failFast('拿不到容器实例 id，无法验证选择容器 IPC', undefined, createdIds);
  const setR = await c.evaluate(`window.warmy.projectSetContainer({ sessionId: ${JSON.stringify(contId)}, runtimeId: 'wsl' })`);
  check('实例选择容器：IPC 接受并标记 scope=instance', !!setR && setR.ok === true && setR.scope === 'instance', setR && { ok: setR.ok, scope: setR.scope, code: setR.code });
  const mapAfter = await c.evaluate(`window.warmy.settingsGet().then((s)=>{
    const m=(s&&s.settings&&s.settings.containerInstanceRuntime)||{};
    return { rid: String(m[${JSON.stringify(contId)}]||'') };
  })`);
  check('实例选择容器：运行时写入 containerInstanceRuntime', mapAfter && mapAfter.rid === 'wsl', mapAfter);
  const stAfter = await c.evaluate(`window.warmy.projectState({ sessionId: ${JSON.stringify(contId)} })`);
  check('实例选择容器后：环境仍是容器（不会退化成宿主）', !!stAfter && stAfter.ok === true && stAfter.state && stAfter.state.devEnv === 'container', stAfter && stAfter.state && { devEnv: stAfter.state.devEnv, code: stAfter.state.code, stopped: stAfter.state.stopped });

  await die(fail ? 1 : 0, `\n==== verify-r119-instance-devenv-ui: ${pass} ok / ${fail} FAIL ====`, createdIds);
} catch (e) {
  await die(1, '异常：' + (e && e.stack || e), createdIds);
}
