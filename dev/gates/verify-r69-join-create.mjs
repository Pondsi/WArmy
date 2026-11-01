/**
 * verify-r69-join-create —— 项目/群聊第二列：去掉「+」，图标打开「左加入 / 右创建」一体化窗口
 *
 * 真 Electron + CDP（临时 profile，WARMY_AUTH_BYPASS=1）：
 *  · 项目页/群聊页的「+」隐藏；项目/群图标仍在，title 同时说明加入与创建；
 *  · 点图标后标题=项目/群聊，左列加入（扫码/粘贴/申请加入），右列创建；
 *  · 两列并排；项目创建必须填名称+选开发环境，群聊只填名称；
 *  · 实际创建一条项目与一条群聊，列表出现；加入侧空链接时如实提示且不关窗；
 *  · 全流程无脚本/控制台错误。
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
const PORT = Number(process.env.R69_JC_PORT || 9641);
const profile = path.join(os.tmpdir(), 'warmy-r69-jc-' + Date.now());
fs.mkdirSync(profile, { recursive: true });
// 旁路只跳过认证；首启 setup/隐私/引导仍会走 app.js。预置完成标记，直达可操作的主界面。
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  yuYan: 'zh-CN', setupDone: true, privacyConsent: true, guideDone: true,
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

async function guan() {
  try { if (c) await c.send('Browser.close', {}, { timeout: 6000 }); } catch { /* 已退 */ }
  await sleep(700);
  try { process.kill(child.pid, 0); execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* 已退 */ }
}

async function setInput(sel, value) {
  await c.evaluate(`(() => {
    const e = document.querySelector(${JSON.stringify(sel)});
    if (!e) return false;
    const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    s.call(e, ${JSON.stringify(value)});
    e.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
}

try {
  let last = '';
  for (let i = 0; i < 60; i++) {
    try { c = await attach(PORT, { biaoQian: 'r69-jc', callTimeout: 12000 }); break; } catch (e) { last = e.message; await sleep(300); }
  }
  if (!c) throw new Error('CDP 未连接：' + last);
  await c.send('Runtime.enable');
  await c.send('Page.enable');
  await c.waitFor('!!document.querySelector(".ceLanTiaoMu[data-nav=internalGroup]")', { timeout: 30000, biaoQian: '主界面' });
  await c.waitFor('document.body.getAttribute("data-warmy-auth") === "ready"', { timeout: 15000, biaoQian: '认证旁路完成' });
  await sleep(300);

  const stamp = String(Date.now()).slice(-7);
  const projectName = '门禁项目' + stamp;
  const groupName = '门禁群聊' + stamp;

  // ── 项目 ───────────────────────────────────────────────────────────
  const projNav = await c.clickUntil('.ceLanTiaoMu[data-nav="internalGroup"]', 'document.querySelector("#lieBiaoBiaoTi")?.textContent.trim() === "项目" && !!document.querySelector("#lieBiaoDongZuo")', { timeout: 8000, tries: 5 });
  if (!projNav.ok) {
    const diag = await js(`(() => ({
      nav: [...document.querySelectorAll('.ceLanTiaoMu')].map((b) => ({ nav: b.dataset.nav, cls: b.className })),
      title: document.querySelector('#lieBiaoBiaoTi')?.textContent.trim() || '',
      action: document.querySelector('#lieBiaoDongZuo')?.className || '',
      join: document.querySelector('#anNiuJiaRuqr')?.className || '',
      auth: document.body.getAttribute('data-warmy-auth'),
      modal: [...document.querySelectorAll('.duiHuaKuangGen')].map((e) => ({ cls: e.className, text: (e.innerText || '').slice(0, 80) })),
      page: (document.querySelector('#pageTi')?.innerText || '').slice(0, 120),
    }))()`);
    console.log('DIAG', JSON.stringify(diag));
    console.log('ERRORS', JSON.stringify(c.errors()));
  }
  jian('切换到项目页', projNav.ok === true, JSON.stringify(projNav && { tries: projNav.tries, hit: projNav.hit, trail: projNav.trail }));
  await sleep(200);
  const projList = await js(`(() => ({
    joinDisplay: getComputedStyle(document.querySelector('#anNiuJiaRuqr')).display,
    joinBox: document.querySelector('#anNiuJiaRuqr').getBoundingClientRect().width,
    iconBox: document.querySelector('#lieBiaoDongZuo').getBoundingClientRect().width,
    iconSvg: !!document.querySelector('#lieBiaoDongZuo svg'),
    iconTitle: document.querySelector('#lieBiaoDongZuo')?.title || '',
    iconAria: document.querySelector('#lieBiaoDongZuo')?.getAttribute('aria-label') || '',
  }))()`);
  jian('项目页的「+」已隐藏，项目图标仍在',
    projList && projList.joinDisplay === 'none' && projList.joinBox === 0 && projList.iconBox > 0 && projList.iconSvg === true,
    JSON.stringify(projList));
  jian('项目图标 title/aria 同时说明加入项目与创建项目',
    projList && projList.iconTitle.includes('加入项目') && projList.iconTitle.includes('创建项目')
    && projList.iconAria.includes('加入项目') && projList.iconAria.includes('创建项目'),
    JSON.stringify({ title: projList && projList.iconTitle, aria: projList && projList.iconAria }));

  const projOpen = await c.clickUntil('#lieBiaoDongZuo', '!document.querySelector("#duiHuaKuangGen")?.classList.contains("yinCang") && document.querySelector("#duiHuaKuangBiaoTi")?.textContent.trim() === "项目" && !!document.querySelector(".erHeYiGrid")', { timeout: 8000, tries: 4 });
  jian('点项目图标能打开一体化窗口', projOpen.ok === true, JSON.stringify({ tries: projOpen && projOpen.tries, hit: projOpen && projOpen.hit, trail: projOpen && projOpen.trail }));
  await sleep(200);
  const projDlg = await js(`(() => {
    const q = (s) => document.querySelector(s);
    const box = (s) => { const e = q(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), r: Math.round(b.right), b: Math.round(b.bottom) }; };
    const panels = [...document.querySelectorAll('.erHeYiLan')];
    return {
      visible: !q('#duiHuaKuangGen')?.classList.contains('yinCang'),
      title: q('#duiHuaKuangBiaoTi')?.textContent.trim() || '',
      heads: panels.map((p) => p.querySelector('h4')?.textContent.trim() || ''),
      left: box('.erHeYiLan[data-erheyi-panel="join"]'),
      right: box('.erHeYiLan[data-erheyi-panel="create"]'),
      linkInput: !!q('#jiaRuLinkShuRu'),
      joinBtn: q('#erHeYiJoinBtn')?.textContent.trim() || '',
      nameInput: !!q('#erHeYiMing'),
      env: !!q('#erHeYiDevEnv'),
      createText: q('#erHeYiCreateBtn')?.textContent.trim() || '',
      createDisabled: q('#erHeYiCreateBtn')?.disabled === true,
      close: q('#duiHuaKuangDongZuoJi button')?.textContent.trim() || '',
    };
  })()`);
  jian('点项目图标打开「项目」一体化窗口：左加入、右创建',
    projDlg && projDlg.visible && projDlg.title === '项目'
    && projDlg.heads.length === 2 && projDlg.heads[0] === '加入项目' && projDlg.heads[1] === '创建项目'
    && projDlg.linkInput && projDlg.joinBtn === '申请加入'
    && projDlg.nameInput && projDlg.env && projDlg.createText === '创建项目' && projDlg.createDisabled === false
    && projDlg.close === '关闭',
    JSON.stringify(projDlg));
  jian('项目窗口左右两列并排（左列在左、右列在右、顶部对齐）',
    projDlg && projDlg.left && projDlg.right
    && projDlg.left.r <= projDlg.right.x + 1
    && Math.abs(projDlg.left.y - projDlg.right.y) <= 2
    && projDlg.left.w >= 300 && projDlg.right.w >= 300,
    JSON.stringify(projDlg && { left: projDlg.left, right: projDlg.right }));

  await c.clickSelector('#erHeYiJoinBtn');
  await sleep(200);
  const joinMsg = await js(`(() => ({ msg: document.querySelector('#jiaRuqrXiaoXi')?.textContent.trim() || '', visible: !document.querySelector('#duiHuaKuangGen')?.classList.contains('yinCang') }))()`);
  jian('加入侧空链接时如实提示，窗口不关', joinMsg && joinMsg.msg.length > 0 && joinMsg.visible === true, JSON.stringify(joinMsg));

  await setInput('#erHeYiMing', '');
  await sleep(150);
  const projEmptyName = await js(`document.querySelector('#erHeYiCreateBtn')?.disabled === true`);
  jian('项目清空名称后创建按钮禁用（默认本机环境不等于跳过名称）', projEmptyName === true, String(projEmptyName));
  await setInput('#erHeYiMing', projectName);
  await sleep(150);
  const projOnlyName = await js(`document.querySelector('#erHeYiCreateBtn')?.disabled === false && document.querySelector('[data-erheyi-devenv="host"]')?.classList.contains('qiYong') === true`);
  jian('项目填名称且默认本机环境已选时创建按钮可用', projOnlyName === true, String(projOnlyName));
  await c.evaluate(`document.querySelector('[data-erheyi-devenv="host"]').click()`);
  await sleep(150);
  const projReady = await js(`(() => ({ disabled: document.querySelector('#erHeYiCreateBtn')?.disabled === true, chosen: document.querySelector('[data-erheyi-devenv="host"]')?.classList.contains('qiYong') === true }))()`);
  jian('项目选「本机」后创建按钮可用', projReady && projReady.disabled === false && projReady.chosen === true, JSON.stringify(projReady));
  await c.evaluate(`document.querySelector('#erHeYiCreateBtn').click()`);
  await c.waitFor('document.querySelector("#duiHuaKuangGen")?.classList.contains("yinCang") || (document.querySelector("#erHeYiCreateMsg")?.textContent.trim().length || 0) > 0', { timeout: 15000, biaoQian: '项目创建返回' });
  await sleep(600);
  // 临时 profile 的首启引导可能把导航切去「我的牛马」；创建已落库，切回项目页再核列表。
  await c.clickUntil('.ceLanTiaoMu[data-nav="internalGroup"]', 'document.querySelector("#lieBiaoBiaoTi")?.textContent.trim() === "项目"', { timeout: 8000, tries: 4 });
  await c.waitFor(`document.querySelector('#lieBiaoTi')?.innerText.includes(${JSON.stringify(projectName)})`, { timeout: 8000, biaoQian: '项目出现在列表' });
  const projResult = await js(`(async () => ({
    list: document.querySelector('#lieBiaoTi')?.innerText || '',
    msg: document.querySelector('#erHeYiCreateMsg')?.textContent.trim() || '',
    groups: (await window.warmy.groupList().catch(() => null))?.groups || [],
    title: document.querySelector('#lieBiaoBiaoTi')?.textContent.trim() || '',
  }))()`);
  jian('项目创建成功并出现在项目列表',
    projResult && projResult.list.includes(projectName) && projResult.groups.some((g) => String(g.ming || g.name || '').includes(projectName)),
    JSON.stringify({ list: projResult && projResult.list.slice(0, 200), msg: projResult && projResult.msg, groups: projResult && projResult.groups.slice(0, 5), title: projResult && projResult.title }));

  // ── 群聊 ───────────────────────────────────────────────────────────
  const groupNav = await c.clickUntil('.ceLanTiaoMu[data-nav="externalGroup"]', 'document.querySelector("#lieBiaoBiaoTi")?.textContent.trim() === "群聊" && (document.querySelector("#lieBiaoDongZuo")?.getBoundingClientRect().width || 0) > 0', { timeout: 8000, tries: 5 });
  jian('切换到群聊页', groupNav.ok === true, JSON.stringify(groupNav && { tries: groupNav.tries, hit: groupNav.hit, trail: groupNav.trail }));
  await sleep(200);
  const groupList = await js(`(() => ({
    joinDisplay: getComputedStyle(document.querySelector('#anNiuJiaRuqr')).display,
    joinBox: document.querySelector('#anNiuJiaRuqr').getBoundingClientRect().width,
    iconBox: document.querySelector('#lieBiaoDongZuo').getBoundingClientRect().width,
    iconSvg: !!document.querySelector('#lieBiaoDongZuo svg'),
    iconTitle: document.querySelector('#lieBiaoDongZuo')?.title || '',
  }))()`);
  jian('群聊页的「+」已隐藏，群图标仍在',
    groupList && groupList.joinDisplay === 'none' && groupList.joinBox === 0 && groupList.iconBox > 0 && groupList.iconSvg === true,
    JSON.stringify(groupList));
  jian('群图标 title 同时说明加入群聊与创建群聊',
    groupList && groupList.iconTitle.includes('加入群聊') && groupList.iconTitle.includes('创建群聊'), JSON.stringify(groupList));

  const groupOpen = await c.clickUntil('#lieBiaoDongZuo', '!document.querySelector("#duiHuaKuangGen")?.classList.contains("yinCang") && document.querySelector("#duiHuaKuangBiaoTi")?.textContent.trim() === "群聊" && !!document.querySelector(".erHeYiGrid")', { timeout: 8000, tries: 4 });
  jian('点群图标能打开群聊一体化窗口', groupOpen.ok === true, JSON.stringify(groupOpen && { tries: groupOpen.tries, hit: groupOpen.hit, trail: groupOpen.trail }));
  await sleep(200);
  const groupDlg = await js(`(() => {
    const q = (s) => document.querySelector(s);
    const panels = [...document.querySelectorAll('.erHeYiLan')];
    return {
      visible: !q('#duiHuaKuangGen')?.classList.contains('yinCang'),
      title: q('#duiHuaKuangBiaoTi')?.textContent.trim() || '',
      heads: panels.map((p) => p.querySelector('h4')?.textContent.trim() || ''),
      linkInput: !!q('#jiaRuLinkShuRu'), joinBtn: q('#erHeYiJoinBtn')?.textContent.trim() || '',
      nameInput: !!q('#erHeYiMing'), env: !!q('#erHeYiDevEnv'),
      createText: q('#erHeYiCreateBtn')?.textContent.trim() || '',
      createDisabled: q('#erHeYiCreateBtn')?.disabled === true,
    };
  })()`);
  jian('点群图标打开「群聊」一体化窗口：左加入、右创建，无开发环境选择',
    groupDlg && groupDlg.visible && groupDlg.title === '群聊'
    && groupDlg.heads.length === 2 && groupDlg.heads[0] === '加入群聊' && groupDlg.heads[1] === '创建群聊'
    && groupDlg.linkInput && groupDlg.joinBtn === '申请加入'
    && groupDlg.nameInput && groupDlg.env === false && groupDlg.createText === '创建群聊' && groupDlg.createDisabled === false,
    JSON.stringify(groupDlg));
  await setInput('#erHeYiMing', groupName);
  await sleep(150);
  const groupReady = await js(`document.querySelector('#erHeYiCreateBtn')?.disabled === false`);
  jian('群聊填名称后创建按钮可用', groupReady === true, String(groupReady));
  await c.evaluate(`document.querySelector('#erHeYiCreateBtn').click()`);
  await c.waitFor('document.querySelector("#duiHuaKuangGen")?.classList.contains("yinCang") || (document.querySelector("#erHeYiCreateMsg")?.textContent.trim().length || 0) > 0', { timeout: 15000, biaoQian: '群聊创建返回' });
  await sleep(600);
  await c.clickUntil('.ceLanTiaoMu[data-nav="externalGroup"]', 'document.querySelector("#lieBiaoBiaoTi")?.textContent.trim() === "群聊" && (document.querySelector("#lieBiaoDongZuo")?.getBoundingClientRect().width || 0) > 0', { timeout: 8000, tries: 4 });
  await c.waitFor(`document.querySelector('#lieBiaoTi')?.innerText.includes(${JSON.stringify(groupName)})`, { timeout: 8000, biaoQian: '群聊出现在列表' });
  const groupResult = await js(`(async () => ({
    list: document.querySelector('#lieBiaoTi')?.innerText || '',
    msg: document.querySelector('#erHeYiCreateMsg')?.textContent.trim() || '',
    groups: (await window.warmy.groupList().catch(() => null))?.groups || [],
  }))()`);
  jian('群聊创建成功并出现在群聊列表',
    groupResult && groupResult.list.includes(groupName) && groupResult.groups.some((g) => String(g.ming || g.name || '').includes(groupName)),
    JSON.stringify({ list: groupResult && groupResult.list.slice(0, 200), msg: groupResult && groupResult.msg, groups: groupResult && groupResult.groups.slice(0, 5) }));

  const errors = c.errors();
  jian('全流程无脚本/控制台错误', errors.length === 0, JSON.stringify(errors));
} catch (e) {
  hong.push('未捕获异常');
  console.log('  FAIL 未捕获异常 ← ' + String((e && (e.stack || e.message)) || e).slice(0, 600));
} finally {
  try { await guan(); } catch { /* noop */ }
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
}
console.log(`\n==== verify-r69-join-create：${ok} ok / ${hong.length} FAIL ====`);
process.exit(hong.length ? 1 : 0);
