/**
 * verify-r96-live —— 第 96 轮真机验收（Electron + CDP，临时 profile）。
 *
 * A. 首启：关闭热区/牛马轨道无背景+更大斜率/曲率、助记拼音标签与颜色、截屏保护、失焦隐藏；
 * B. 聊天：单段思考也混排操作；用户滚动后流式追加/整块重画都不改变 scrollTop。
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

let okN = 0, failN = 0;
const ok = (m, d) => { okN++; console.log('  ok   ' + m + (d === undefined ? '' : ' ← ' + String(d).slice(0, 320))); };
const bad = (m, d) => { failN++; console.log('  FAIL ' + m + (d === undefined ? '' : ' ← ' + String(d).slice(0, 400))); };
const jian = (m, cond, d) => (cond ? ok(m, d) : bad(m, d));

let child = null, c = null, profile = '';
const js = (e) => c.evaluate('(async function(){ try { return await (' + e + '); } catch (err) { return { __err: String((err && (err.stack || err.message)) || err).slice(0, 400) }; } })()');
const click = async (sel, nth = 0) => {
  const p = await js(`(() => { const a=[...document.querySelectorAll(${JSON.stringify(sel)})]; const e=a[${nth}]; if(!e) return null; e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}; })()`);
  if (!p || p.__err) return false;
  await c.mouseClick(p.x, p.y);
  return true;
};
async function start(port, prof, bypass) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  if (bypass) env.WARMY_AUTH_BYPASS = '1';
  child = spawn(ELECTRON, ['--remote-debugging-port=' + port, '--user-data-dir=' + prof, MAIN], {
    cwd: PKG, stdio: ['ignore', 'ignore', 'ignore'], windowsHide: false, env,
  });
  let last = '';
  for (let i = 0; i < 90; i++) {
    try { c = await attach(port, { biaoQian: 'r96-live', callTimeout: 20000 }); break; } catch (e) { last = e.message; await sleep(300); }
  }
  if (!c) throw new Error('CDP 未连接：' + last);
  await c.send('Runtime.enable');
}
async function stop() {
  try { if (c) await c.send('Browser.close', {}, { timeout: 5000 }); } catch { /* 已退 */ }
  c = null;
  await sleep(600);
  try { if (child) execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* 已退 */ }
  child = null;
}
async function cleanupProfile() {
  if (profile) { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 尽力清 */ } profile = ''; }
}

try {
  // ── A. 首启 ─────────────────────────────────────────────────────────
  profile = path.join(os.tmpdir(), 'warmy-r96-live-a-' + Date.now());
  fs.mkdirSync(profile, { recursive: true });
  await start(Number(process.env.R96_PORT_A || 9697), profile, false);
  await c.waitFor('!!document.getElementById("warmyAuthLang")', { timeout: 35000 });
  await sleep(350);
  const vp = await js('({w:innerWidth,h:innerHeight})');
  await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: vp.w - 30, y: 30 });
  await sleep(300);
  const hot = await js(`(() => { const h=document.querySelector('.warmyAuthCloseHot'), x=document.getElementById('warmyAuthCloseX'); const hb=h.getBoundingClientRect(), xb=x.getBoundingClientRect(); return {hw:Math.round(hb.width),hh:Math.round(hb.height),xw:Math.round(xb.width),op:getComputedStyle(x).opacity}; })()`);
  jian('关闭热区 ≥180×160，叉 ≥48px，热区悬停即显示', !!(hot && hot.hw >= 180 && hot.hh >= 160 && hot.xw >= 48 && Number(hot.op) >= 0.95), JSON.stringify(hot));
  await c.mouseClick(vp.w - 30, 30);
  await c.waitFor('document.getElementById("warmyAuthQuitMask")?.classList.contains("on")', { timeout: 5000 });
  await sleep(800);
  const tr = await js(`(() => {
    const t=document.getElementById('warmyAuthQuitTrack');
    const cs=getComputedStyle(t);
    const hs=[...document.querySelectorAll('.warmyAuthQuitRunner')];
    return { n:hs.length, bg:cs.backgroundImage, bgc:cs.backgroundColor, h:Math.round(t.getBoundingClientRect().height),
      ys:hs.map(h=>Math.round(h.getBoundingClientRect().top)) };
  })()`);
  jian('牛马轨道无背景色/渐变', !!(tr && tr.bg === 'none' && /rgba\(0, 0, 0, 0\)/.test(tr.bgc)), JSON.stringify(tr));
  jian('同时至少 2 只牛马在轨道内', !!(tr && tr.n >= 2), tr && tr.n);
  jian('轨迹里有明显的斜率/曲率差异（同屏 y 差 > 20px）', !!(tr && Math.max(...tr.ys)-Math.min(...tr.ys) > 20), JSON.stringify(tr && tr.ys));
  await c.snap(path.join(os.tmpdir(), 'warmy-r96-quit-live.png'));
  await click('#warmyAuthQuitBack'); await sleep(400);
  await click('#warmyAuthStart');
  await c.waitFor('!!document.getElementById("warmyAuthTermsBody")', { timeout: 10000 });
  await js(`(() => { const b=document.getElementById('warmyAuthTermsBody'); b.scrollTop=b.scrollHeight; b.dispatchEvent(new Event('scroll')); return true; })()`);
  await sleep(3400);
  await c.waitFor('document.getElementById("warmyAuthTermsContinue") && !document.getElementById("warmyAuthTermsContinue").disabled', { timeout: 6000 });
  await click('#warmyAuthTermsContinue');
  await c.waitFor('!!document.querySelector("[data-auth-action=register-open]")', { timeout: 10000 });
  await click('[data-auth-action="register-open"]');
  await c.waitFor('!!document.querySelector("[data-auth-action=mnemonic-confirm]")', { timeout: 20000 });
  const mn = await js(`(() => { const w=document.querySelector('.warmyAuthWordFriendly'); const en=w?.querySelector('.warmyAuthWordEn'), idx=w?.querySelector('.warmyAuthWordIndex'), zh=w?.querySelector('.warmyAuthWordText'), py=w?.querySelector('.warmyAuthWordPinyin'); return {label:document.querySelector('.warmyAuthCheck span')?.textContent||'', enCount:document.querySelectorAll('.warmyAuthWordFriendly .warmyAuthWordEn').length, idx:idx&&getComputedStyle(idx).color, zhColor:zh&&getComputedStyle(zh).color, pyColor:py&&getComputedStyle(py).color, idxRow:idx&&getComputedStyle(idx).gridRowStart, zhRow:zh&&getComputedStyle(zh).gridRowStart, pyRow:py&&getComputedStyle(py).gridRowStart}; })()`);
  jian('中文友好型已改名助记拼音', !!(mn && mn.label === '助记拼音'), JSON.stringify(mn));
  jian('勾选拼音后不再重复英文助记词', !!(mn && mn.enCount === 0), JSON.stringify(mn));
  jian('拼音本体主题色；序号/中文灰色；中文与序号同排、拼音在下一行',
    !!(mn && mn.pyColor !== mn.zhColor && /rgb\(143, 138, 130\)/.test(mn.idx) && /rgb\(138, 134, 128\)/.test(mn.zhColor)
      && String(mn.idxRow) === '1' && String(mn.zhRow) === '1' && String(mn.pyRow) === '2'), JSON.stringify(mn));
  const prot = await js('window.warmy.authScreenProtect(true)');
  jian('助记词屏系统截屏保护可用（Windows 本机）', !!(prot && prot.ok && prot.on === true), JSON.stringify(prot));
  await js(`window.warmy.authScreenProtect(false)`);
  await js(`window.dispatchEvent(new Event('blur'))`); await sleep(350);
  const hid = await js(`({h:!!document.querySelector('.warmyAuthMnemonicHidden'),w:document.querySelectorAll('.warmyAuthWordFriendly').length})`);
  jian('窗口失焦立即隐藏助记词', !!(hid && hid.h && hid.w === 0), JSON.stringify(hid));
  await click('[data-auth-action="mnemonic-reveal"]'); await sleep(350);
  const rev = await js(`({h:!!document.querySelector('.warmyAuthMnemonicHidden'),w:document.querySelectorAll('.warmyAuthWordFriendly').length})`);
  jian('点击后助记词恢复显示', !!(rev && !rev.h && rev.w === 24), JSON.stringify(rev));
  const errsA = (typeof c.errors === 'function' ? c.errors() : []) || [];
  jian('首启全程无脚本错误', errsA.length === 0, JSON.stringify(errsA).slice(0, 300));
  await stop(); await cleanupProfile();

  // ── B. 聊天滚动/操作时序 ───────────────────────────────────────────
  profile = path.join(os.tmpdir(), 'warmy-r96-live-b-' + Date.now());
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
    yuYan: 'zh-CN', setupDone: true, privacyConsent: true, guideDone: true, providersSeeded: true,
    instances: [{ id: 'inst-r96-chat', ming: '牛马-聊天', name: '牛马-聊天', status: 'running', model: 'x', chain: ['x'], chainDisabled: [] }],
    providers: [], authGrants: { 'inst-r96-chat': [] }, panelCardCollapsed: {},
  }, null, 2), 'utf8');
  await start(Number(process.env.R96_PORT_B || 9698), profile, true);
  await c.waitFor('!!document.querySelector("[data-nav=singleAi]")', { timeout: 30000 });
  await sleep(600);
  await click('[data-nav="singleAi"]'); await sleep(900);
  const listN = await js('document.querySelectorAll("#lieBiaoTi .lieBiaoTiaoMu").length');
  if (!listN) console.log('  ..   list empty, body=' + String(await js('document.body.innerText')).slice(0, 200));
  await click('#lieBiaoTi .lieBiaoTiaoMu', 0); await sleep(1200);
  console.log('  ..   listN=' + listN + ' sid=' + JSON.stringify(await js('window.__r35.huiHua()')) + ' chats=' + JSON.stringify(await js('(window.__chats||[]).length')));
  await js(`(() => { const sid=window.__r35.huiHua(); window.__msgs=window.__msgs||{}; window.__msgs[sid]=[]; const ts=Date.now()-5000;
    window.__msgs[sid].push({role:'wo',text:'测试问题',ts:ts-2000});
    window.__msgs[sid].push({role:'them',text:'测试回复',ts,reasoning:'一段思考',reasoningDuan:[{ts,text:'一段思考'}],zhongJian:[],moXing:'test'});
    window.__qingXingDong(sid);
    window.__r35.hangDong({ hao:'h-r96', ts: ts + 1000, op:'测试操作', detail:'test', status:'ok', tsEnd: ts + 1200, ms:200 });
    window.__r35.chongHuaQuan(); return true; })()`);
  await sleep(500);
  console.log('  ..   setup=' + JSON.stringify(await js(`(() => { const sid=window.__r35.huiHua(); return {sid, ms:(window.__msgs[sid]||[]).length, kids:document.getElementById('xiaoXiJi')?.childElementCount||0, chong:window.__r35.chongHuaQuan()}; })()`)));
  const order = await js(`(() => { const h=document.getElementById('xiaoXiJi'); const ms=[...h.querySelectorAll('.xiaoXi')]; const last=ms[ms.length-1]; const sk=last?.querySelector('.siKaoKuai');
    return {duan:last?last.querySelectorAll('.siKaoDuanKuai').length:0, xd:last?last.querySelectorAll('.xingDongZu').length:0, order:sk?[...sk.children].map(n=>({cls:n.className,ts:n.dataset?.ts||''})):null}; })()`);
  jian('单段思考渲染成带 ts 的段落', !!(order && order.duan === 1), JSON.stringify(order));
  const ord = (order && order.order) || [];
  const iDuan = ord.findIndex((x) => /siKaoDuanKuai/.test(x.cls));
  const iXd = ord.findIndex((x) => /xingDongZu/.test(x.cls));
  jian('操作行按时间插在思考段之后（不是脱离时间线追加）', iDuan >= 0 && iXd > iDuan, JSON.stringify(ord));
  await js(`(() => { const sid=window.__r35.huiHua(); window.__msgs=window.__msgs||{}; const arr=window.__msgs[sid]=window.__msgs[sid]||[]; for (let i=0;i<30;i++) arr.push({role:i%2?'them':'wo',text:'填充消息 '+i+'：'+'内容'.repeat(30),ts:Date.now()+i}); window.__r35.chongHuaQuan(); return true; })()`);
  await sleep(500);
  const box = await js(`(() => { const h=document.getElementById('xiaoXiJi'); return {sh:h.scrollHeight,ch:h.clientHeight,top:h.scrollTop}; })()`);
  jian('聊天区已可滚动（夹具够长）', !!(box && box.sh > box.ch + 200), JSON.stringify(box));
  const before = await js(`(() => { const h=document.getElementById('xiaoXiJi'); h.scrollTop=Math.round((h.scrollHeight-h.clientHeight)*0.45); h.dispatchEvent(new WheelEvent('wheel',{deltaY:-120,bubbles:true})); return h.scrollTop; })()`);
  await sleep(250);
  const b1 = await js('document.getElementById("xiaoXiJi").scrollTop');
  await js(`window.__r35.liuShiKuai({ reasoning: '流式思考'.repeat(10), content: '流式回复'.repeat(20) })`);
  await sleep(350);
  const a1 = await js('document.getElementById("xiaoXiJi").scrollTop');
  jian('用户滚动后流式追加不改变 scrollTop', Math.abs(a1 - b1) <= 1 && a1 > 0, JSON.stringify({ b1, a1, set: before }));
  await js(`(() => { const sid=window.__r35.huiHua(); window.__msgs=window.__msgs||{}; (window.__msgs[sid]=window.__msgs[sid]||[]).push({role:'them',text:'新回复',ts:Date.now(),reasoning:'新思考',reasoningDuan:[{ts:Date.now(),text:'新思考'}]}); window.__r35.chongHuaQuan(); return true; })()`);
  await sleep(350);
  const a2 = await js('document.getElementById("xiaoXiJi").scrollTop');
  jian('用户滚动后最终回复整块重画不改变 scrollTop', Math.abs(a2 - b1) <= 1 && a2 > 0, JSON.stringify({ b1, a2 }));
  const errsB = (typeof c.errors === 'function' ? c.errors() : []) || [];
  jian('聊天验收全程无脚本错误', errsB.length === 0, JSON.stringify(errsB).slice(0, 300));
} catch (e) {
  bad('门禁执行异常', String((e && (e.stack || e.message)) || e));
} finally {
  await stop();
  await cleanupProfile();
  // 全绿不留截图
  if (failN === 0) { try { fs.rmSync(path.join(os.tmpdir(), 'warmy-r96-quit-live.png'), { force: true }); } catch { /* 尽力清 */ } }
}

console.log(`\nverify-r96-live: ${okN} ok / ${failN} FAIL`);
process.exitCode = failN ? 1 : 0;
