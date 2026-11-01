/**
 * verify-r82-chatwin —— 「在新窗口打开」必须只显示第三列 + 第四列
 *
 * 用户 2026-10-25 原话：点击会话界面上面的三个点，选择在新窗口打开的时候，
 * 应该是在新窗口显示当前这个第三列和第四列的界面，而不是显示完整的主界面。
 *
 * 真机判据（真实 Electron + 真实 DOM 盒模型）：
 *  ① 子窗口 URL 带 chatId / mode=fu；
 *  ② 子窗口从第一帧起就带 liaoTianChuangKou（early boot 脚本已执行）；
 *  ③ 左栏（#ceLan）、第二列（#lieBiaoLan）、设置/我的页、空态都不显示；
 *  ④ 第三列（聊天）与第四列（右栏）可见，且 #appTi 只有一列；
 *  ⑤ 主窗口不受影响：三列仍在、聊天页正常；
 *  ⑥ 子窗口拉宽到 3440 后仍然只有两列，正文按阅读宽度居中；
 *  ⑦ 子窗口顶栏可见（无边框窗口靠它拖动）。
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
const HTML = fs.readFileSync(path.join(PKG, 'src', 'renderer', 'index.html'), 'utf8');
const { attach, sleep } = await import(pathToFileURL(path.join(PKG, 'scripts', 'cdp-lib.mjs')).href);

const PORT = Number(process.env.R82_CHATWIN_PORT || 9684);
const profile = path.join(os.tmpdir(), 'warmy-r82-chatwin-' + Date.now() + '-' + process.pid);
fs.mkdirSync(profile, { recursive: true });

let ok = 0;
const hong = [];
const jian = (l, p, d) => {
  if (p) { ok += 1; console.log('  ok   ' + l); return; }
  hong.push(l);
  console.log('  FAIL ' + l + (d === undefined ? '' : ' ← ' + String(d).slice(0, 400)));
};

const env = { ...process.env, WARMY_AUTH_BYPASS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(ELECTRON, [
  '--remote-debugging-port=' + PORT,
  '--disable-features=CalculateNativeWinOcclusion',
  '--user-data-dir=' + profile,
  MAIN,
], { cwd: PKG, stdio: ['ignore', 'ignore', 'ignore'], env });

let c = null, c2 = null;
async function guan() {
  try { if (c) await c.send('Browser.close', {}, { timeout: 6000 }); } catch { /* 已退 */ }
  for (let i = 0; i < 30; i++) {
    await sleep(200);
    try { process.kill(child.pid, 0); } catch { return; }
  }
  try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* noop */ }
}

const LIANG = `const liang = (sel) => { const e = document.querySelector(sel); if (!e) return null;
  const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
  return { x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height),
    display: cs.display, vis: cs.visibility }; };`;
const zhuangTai = async (cx) => cx.evaluate(`(function(){
  ${LIANG}
  return {
    url: location.href,
    bodyCls: document.body.className,
    booted: document.documentElement.getAttribute('data-chat-window-boot'),
    appTiCols: getComputedStyle(document.getElementById('appTi')).gridTemplateColumns,
    rail: liang('#ceLan'), list: liang('#lieBiaoLan'), zhu: liang('#zhuLan'),
    titlebar: liang('#biaoTiLan'), chatLayout: liang('#liaoTianBuJu'),
    chat: liang('#liaoTianLan'), panel: liang('#mianBanLan'),
    page: liang('#pageBuJu'), kong: liang('#kongTai'), shiLi: liang('#shiLiXiangQing'),
    feed: liang('#xiaoXiJi'),
  };
})()`);

try {
  let lastErr = '';
  for (let i = 0; i < 80; i++) {
    try { c = await attach(PORT, { biaoQian: 'r82-chatwin', callTimeout: 15000 }); break; } catch (e) { lastErr = e.message; await sleep(300); }
  }
  if (!c) throw new Error('CDP 没连上：' + lastErr);
  await c.send('Runtime.enable');
  await c.waitFor('!!document.querySelector("#appTi")', { timeout: 30000, biaoQian: '主窗口' });
  await sleep(600);

  /* ── 静态：early boot 脚本必须在任何界面节点之前 ── */
  const bootIdx = HTML.indexOf('chat-window-boot.js');
  const appIdx = HTML.indexOf('<div id="app"');
  jian('index.html 在 #app 之前加载 chat-window-boot.js（第一帧就进入独立会话窗布局）',
    bootIdx > 0 && appIdx > 0 && bootIdx < appIdx, { bootIdx, appIdx });

  const mainBefore = await zhuangTai(c);
  jian('主窗口没有 liaoTianChuangKou（三列布局不受影响）',
    !mainBefore.bodyCls.includes('liaoTianChuangKou')
      && mainBefore.rail && mainBefore.rail.display !== 'none'
      && mainBefore.list && mainBefore.list.display !== 'none',
    JSON.stringify({ cls: mainBefore.bodyCls, rail: mainBefore.rail, list: mainBefore.list }));

  /* ── 打开独立会话窗 ── */
  const r = await c.evaluate(`window.warmy.openChatWindow({ id: 'probe-chat-win', biaoTi: '探针会话', title: '探针会话', kind: 'single', mode: 'fu' })`, { awaitPromise: true });
  jian('openChatWindow 返回成功', r && r.ok === true, r);
  await sleep(1200);

  const pages = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).filter((t) => t.type === 'page');
  const target = pages.find((t) => t.url.includes('chatId=probe-chat-win'));
  jian('产生了独立会话窗 target，且 URL 带 chatId / mode=fu',
    !!target && target.url.includes('mode=fu'), target && target.url);
  if (!target) throw new Error('没有独立会话窗');

  c2 = await attach(PORT, { biaoQian: 'r82-chatwin-child', callTimeout: 15000, matchUrlIncludes: 'chatId=probe-chat-win' });
  await c2.send('Runtime.enable');
  await c2.waitFor(`document.documentElement.getAttribute('data-chat-window-boot') === '1'`, { timeout: 20000, biaoQian: 'early boot 标记' });
  await sleep(900);

  let s = await zhuangTai(c2);
  jian('子窗口从 early boot 起就是 liaoTianChuangKou（不是 app.js 末尾才补）',
    s.bodyCls.includes('liaoTianChuangKou') && s.booted === '1',
    JSON.stringify({ cls: s.bodyCls, booted: s.booted }));
  jian('子窗口不显示左栏、第二列、设置/我的页、空态、实例详情',
    s.rail?.display === 'none' && s.list?.display === 'none'
      && s.page?.display === 'none' && s.kong?.display === 'none' && s.shiLi?.display === 'none',
    JSON.stringify({ rail: s.rail, list: s.list, page: s.page, kong: s.kong, shiLi: s.shiLi }));
  jian('子窗口只显示第三列（聊天）+ 第四列（右栏）',
    s.chat?.display === 'flex' && s.chat.w > 0
      && s.panel?.display === 'block' && s.panel.w > 0
      && s.chat.x === 0 && s.chat.w + s.panel.w === s.zhu.w,
    JSON.stringify({ chat: s.chat, panel: s.panel, zhu: s.zhu }));
  jian('子窗口 #appTi 只有一列（不是 64px + 列表 + 1fr）',
    !/\d+px\s+\d+px/.test(s.appTiCols), s.appTiCols);
  jian('子窗口顶栏保留（可拖动 + 窗控）', s.titlebar?.display === 'flex' && s.titlebar.w > 300,
    JSON.stringify(s.titlebar));

  /* ── 拉宽到带鱼屏：仍然只有两列、正文居中 ── */
  await c2.send('Emulation.setDeviceMetricsOverride', { width: 3440, height: 1440, deviceScaleFactor: 1, mobile: false });
  await sleep(450);
  s = await zhuangTai(c2);
  const feedPad = await c2.evaluate(`(function(){const e=document.getElementById('xiaoXiJi');const cs=getComputedStyle(e);const r=e.getBoundingClientRect();return {pl:parseFloat(cs.paddingLeft)||0,pr:parseFloat(cs.paddingRight)||0,w:Math.round(r.width)};})()`);
  jian('3440 宽下子窗口仍只有聊天 + 右栏（没有主界面左栏/列表）',
    s.rail?.display === 'none' && s.list?.display === 'none'
      && s.chat?.display === 'flex' && s.panel?.display === 'block',
    JSON.stringify({ rail: s.rail, list: s.list, chat: s.chat, panel: s.panel }));
  jian('3440 宽下子窗口正文按阅读宽度居中（左右留白相等）',
    feedPad.w - feedPad.pl - feedPad.pr <= 1322 && Math.abs(feedPad.pl - feedPad.pr) <= 1,
    feedPad);

  /* ── 主窗口仍然正常 ── */
  const mainAfter = await zhuangTai(c);
  jian('打开子窗口后主窗口仍是完整三列',
    !mainAfter.bodyCls.includes('liaoTianChuangKou')
      && mainAfter.rail?.display !== 'none' && mainAfter.list?.display !== 'none',
    JSON.stringify({ cls: mainAfter.bodyCls, rail: mainAfter.rail, list: mainAfter.list }));

  await c2.snap(path.join(os.tmpdir(), 'warmy-r82-chatwin.png'));
} catch (e) {
  jian('门禁执行未抛错', false, (e && (e.stack || e.message)) || e);
} finally {
  await guan();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Windows 文件锁：留给系统临时目录 */ }
}

console.log(`\nverify-r82-chatwin: ${ok} ok / ${hong.length} FAIL`);
if (hong.length) console.log('红项：\n- ' + hong.join('\n- '));
process.exitCode = hong.length ? 1 : 0;
