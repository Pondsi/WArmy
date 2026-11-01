/**
 * verify-r103-4k —— 第 103 轮 4K / 高 DPI 真机布局验收（临时 profile + CDP 仿真）。
 *
 * 覆盖：
 *  · 3840×2160@100%：标题栏 46px、字号 15/22、四列不溢出、聊天区≥480；
 *  · 1920×1080@200%：逻辑尺寸仍是 1920，不应重复放大（标题栏 40px）；
 *  · 2560×1440@150%：逻辑 2560，不重复放大；
 *  · 960×600@100%：窗口最小尺寸下仍给聊天区 480px；
 *  · 标题栏按钮不溢出、文档无水平滚动、聊天最后一条与输入区在视口内。
 *
 * 注：CDP 仿真只验 DOM 尺寸/命中/滚动；原生最大化/任务栏另见 R102 live 与人工验收。
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
const { attach, sleep } = await import(pathToFileURL(path.join(PKG, 'scripts/cdp-lib.mjs')).href);

let okN = 0, failN = 0;
const ok = (m, d) => { okN++; console.log('  ok   ' + m + (d === undefined ? '' : ' ← ' + String(d).slice(0, 320))); };
const bad = (m, d) => { failN++; console.log('  FAIL ' + m + (d === undefined ? '' : ' ← ' + String(d).slice(0, 420))); };
const jian = (m, c, d) => (c ? ok(m, d) : bad(m, d));

let child = null, c = null, profile = '';

async function start(port, prof) {
  const env = { ...process.env, WARMY_AUTH_BYPASS: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(ELECTRON, ['--remote-debugging-port=' + port, '--user-data-dir=' + prof, MAIN], {
    cwd: PKG, stdio: ['ignore', 'ignore', 'ignore'], windowsHide: false, env,
  });
  let last = '';
  for (let i = 0; i < 100; i += 1) {
    try { c = await attach(port, { biaoQian: 'r103-4k', callTimeout: 20000 }); break; } catch (e) { last = e.message; await sleep(300); }
  }
  if (!c) throw new Error('CDP 未连接：' + last);
  await c.send('Runtime.enable');
}
async function stop() {
  try { if (c) await c.send('Browser.close', {}, { timeout: 5000 }); } catch { /* 已退 */ }
  c = null;
  await sleep(700);
  try { if (child) execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* 已退 */ }
  child = null;
}
const js = (e) => c.evaluate('(async function(){ try { return await (' + e + '); } catch (err) { return { __err: String((err && (err.stack || err.message)) || err).slice(0, 500) }; } })()');

async function setViewport(width, height, deviceScaleFactor) {
  await c.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile: false });
  await sleep(450);
  // 视口变化后把聊天滚到底，最后一条消息应落在视口内（否则测的是“没滚到底”不是布局）
  await js(`(() => { document.getElementById('scrollDiAnNiu')?.click(); const h=document.getElementById('xiaoXiJi'); if(h) h.scrollTop=h.scrollHeight; return true; })()`);
  await sleep(350);
}
async function metrics() {
  return await js(`(() => {
    const q = (s) => document.querySelector(s);
    const rect = (s) => { const e=q(s); if(!e) return null; const r=e.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),r:Math.round(r.right),b:Math.round(r.bottom)}; };
    const root = getComputedStyle(document.documentElement);
    const chat = q('#liaoTianLan') || q('#xiaoXiJi');
    const cr = chat ? chat.getBoundingClientRect() : null;
    const btns = [...document.querySelectorAll('#biaoTiLan .biaoTiLanDongZuoJi button')].map((e) => { const r=e.getBoundingClientRect(); return {id:e.id,x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),r:Math.round(r.right),b:Math.round(r.bottom)}; });
    const last = [...document.querySelectorAll('#xiaoXiJi .xiaoXi')].slice(-1)[0];
    const lr = last ? last.getBoundingClientRect() : null;
    const input = q('#shuRuQu') || q('.shuRuQu');
    const ir = input ? input.getBoundingClientRect() : null;
    return {
      innerWidth: window.innerWidth, innerHeight: window.innerHeight, dpr: window.devicePixelRatio,
      titleH: Math.round(q('#biaoTiLan')?.getBoundingClientRect().height || 0),
      titleToken: root.getPropertyValue('--titlebar-h').trim(),
      fsMd: root.getPropertyValue('--fs-md').trim(),
      fsXl: root.getPropertyValue('--fs-xl').trim(),
      listW: root.getPropertyValue('--list-w').trim(),
      panelW: root.getPropertyValue('--panel-w').trim(),
      duWen: root.getPropertyValue('--du-wen-kuan').trim(),
      chatW: cr ? Math.round(cr.width) : null,
      scrollW: document.documentElement.scrollWidth,
      btns, lastBottom: lr ? Math.round(lr.bottom) : null, inputBottom: ir ? Math.round(ir.bottom) : null,
    };
  })()`);
}
function viewportChecks(tag, m, exp) {
  jian(tag + '：innerWidth / DPR 符合', m && m.innerWidth === exp.w && m.dpr === exp.dpr, JSON.stringify({ got: m && { w: m.innerWidth, dpr: m.dpr }, want: exp }));
  jian(tag + '：标题栏 token 与实际高度一致', !!(m && m.titleToken === exp.titleH + 'px' && m.titleH === exp.titleH), JSON.stringify({ token: m && m.titleToken, h: m && m.titleH, want: exp.titleH }));
  jian(tag + '：标题栏按钮都在标题栏内且热区足够', !!(m && m.btns.length >= 5 && m.btns.every((b) => b.y >= -1 && b.b <= m.titleH + 1 && b.w >= 40 && b.h >= 32)), JSON.stringify(m && m.btns));
  jian(tag + '：文档没有水平溢出', !!(m && m.scrollW <= m.innerWidth + 1), JSON.stringify({ scrollW: m && m.scrollW, innerWidth: m && m.innerWidth }));
  jian(tag + '：聊天列至少 480px', !!(m && m.chatW != null && m.chatW >= 480), JSON.stringify({ chatW: m && m.chatW, list: m && m.listW, panel: m && m.panelW }));
  jian(tag + '：输入区在视口内', !!(m && m.inputBottom != null && m.inputBottom <= m.innerHeight + 1), JSON.stringify({ inputBottom: m && m.inputBottom, innerHeight: m && m.innerHeight }));
  jian(tag + '：最后一条消息在视口内', !!(m && (m.lastBottom == null ? true : m.lastBottom <= m.innerHeight + 1)), JSON.stringify({ lastBottom: m && m.lastBottom, innerHeight: m && m.innerHeight }));
}

try {
  profile = path.join(os.tmpdir(), 'warmy-r103-4k-' + Date.now());
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
    yuYan: 'zh-CN', setupDone: true, privacyConsent: true, guideDone: true, guideChatDone: true, providersSeeded: true,
    providers: [], instances: [{ id: 'inst-r103-4k', ming: '验收牛马-4K', name: '验收牛马-4K', status: 'running', model: 'x', chain: ['x'], chainDisabled: [] }],
    authGrants: { 'inst-r103-4k': [] }, panelCardCollapsed: {},
  }, null, 2), 'utf8');

  const port = Number(process.env.R103_4K_PORT || 10340);
  await start(port, profile);
  await c.waitFor('window.__warmyBootDataReady === true', { timeout: 30000 });
  await c.waitFor('!!document.querySelector("[data-nav=singleAi]")', { timeout: 30000 });
  await sleep(800);
  // 打开默认聊天，确保聊天列/输入区存在
  await c.evaluate(`document.querySelector('[data-nav="singleAi"]')?.click()`);
  await sleep(500);
  await c.evaluate(`document.querySelector('#lieBiaoTi .lieBiaoTiaoMu')?.click()`);
  await sleep(800);
  // 造一条足够长的消息，便于检查最后一条/输入区
  await c.evaluate(`(() => { const sid = window.__r35?.huiHua?.() || ''; if (!sid) return false; window.__msgs=window.__msgs||{}; window.__msgs[sid]=Array.from({length:30},(_,i)=>({role:i%2?'them':'wo',text:'4K 验收消息 '+i+'：'+'内容'.repeat(30),ts:Date.now()+i})); window.__r35.chongHuaQuan?.(); return true; })()`);
  await sleep(700);

  const m34 = await (async () => { await setViewport(3440, 1392, 1); return await metrics(); })();
  viewportChecks('3440×1392@100%（本机）', m34, { w: 3440, dpr: 1, titleH: 46 });

  const m4k = await (async () => { await setViewport(3840, 2160, 1); return await metrics(); })();
  viewportChecks('4K@100%', m4k, { w: 3840, dpr: 1, titleH: 46 });
  jian('4K@100%：字号按宽屏档放大（fs-md=15px / fs-xl=22px）', !!(m4k && m4k.fsMd === '15px' && m4k.fsXl === '22px'), JSON.stringify({ fsMd: m4k && m4k.fsMd, fsXl: m4k && m4k.fsXl }));
  jian('4K@100%：阅读宽度放大到 1320px', !!(m4k && /1320px/.test(m4k.duWen)), JSON.stringify(m4k && m4k.duWen));

  const m2x = await (async () => { await setViewport(1920, 1080, 2); return await metrics(); })();
  viewportChecks('1080p@200%', m2x, { w: 1920, dpr: 2, titleH: 40 });
  jian('1080p@200%：不重复放大字号（fs-md=14px）', !!(m2x && m2x.fsMd === '14px'), JSON.stringify(m2x && m2x.fsMd));

  const m15 = await (async () => { await setViewport(2560, 1440, 1.5); return await metrics(); })();
  viewportChecks('1440p@150%', m15, { w: 2560, dpr: 1.5, titleH: 40 });
  jian('1440p@150%：不重复放大字号（fs-md=14px）', !!(m15 && m15.fsMd === '14px'), JSON.stringify(m15 && m15.fsMd));

  const m96 = await (async () => { await setViewport(960, 600, 1); return await metrics(); })();
  viewportChecks('960×600@100%', m96, { w: 960, dpr: 1, titleH: 40 });
  jian('960×600：列宽被夹紧但聊天区仍 ≥480px', !!(m96 && m96.chatW >= 480), JSON.stringify({ chatW: m96 && m96.chatW, list: m96 && m96.listW, panel: m96 && m96.panelW }));

  try { await c.send('Emulation.clearDeviceMetricsOverride'); } catch { /* noop */ }
} catch (e) {
  bad('门禁执行异常', String((e && (e.stack || e.message)) || e));
} finally {
  await stop();
  try { if (profile) fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 尽力清 */ }
}

console.log(`\nverify-r103-4k: ${okN} ok / ${failN} FAIL`);
process.exitCode = failN ? 1 : 0;
