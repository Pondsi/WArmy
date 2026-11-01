/**
 * verify-r97-live —— 第 97 轮真机验收（Electron + CDP，临时 profile）。
 *
 * A. 助记拼音：勾选后只有拼音本体（主题色），中文与序号并排，不再重复英文行；
 * B. 聊天滚动（项 2/3/11）：
 *     · 下箭头必须真的到最底部；
 *     · 未勾选自动滚动、用户上滚后，新回复/整块重画都不改变 scrollTop；
 *     · 未勾选且用户已在底部：新内容首行置顶后停住；
 *     · 勾选自动滚动：始终到底；
 * C. 操作记录时序（项 4）：
 *     · 每条操作挂到它当时所属的那条回复，不全部塞到最后一条；
 *     · 思考段与操作按时间穿插（含旧数据单块思考的时间切段）。
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
const bad = (m, d) => { failN++; console.log('  FAIL ' + m + (d === undefined ? '' : ' ← ' + String(d).slice(0, 420))); };
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
    try { c = await attach(port, { biaoQian: 'r97-live', callTimeout: 20000 }); break; } catch (e) { last = e.message; await sleep(300); }
  }
  if (!c) throw new Error('CDP 未连接：' + last);
  await c.send('Runtime.enable');
}

async function stop() {
  try { if (c) await c.send('Browser.close', {}, { timeout: 5000 }); } catch { /* 已退 */ }
  c = null;
  await sleep(650);
  try { if (child) execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* 已退 */ }
  child = null;
}
async function cleanupProfile() {
  if (profile) { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 尽力清 */ } profile = ''; }
}

try {
  // ══════ A. 首启：助记拼音布局 ══════
  profile = path.join(os.tmpdir(), 'warmy-r97-a-' + Date.now());
  fs.mkdirSync(profile, { recursive: true });
  await start(Number(process.env.R97_PORT_A || 9717), profile, false);
  await c.waitFor('!!document.getElementById("warmyAuthLang")', { timeout: 35000 });
  await sleep(350);
  await click('[data-locale="zh-CN"]'); await sleep(300);
  await click('#warmyAuthStart');
  await c.waitFor('!!document.getElementById("warmyAuthTermsBody")', { timeout: 10000 });
  await js(`(() => { const b=document.getElementById('warmyAuthTermsBody'); b.scrollTop=b.scrollHeight; b.dispatchEvent(new Event('scroll')); return true; })()`);
  await sleep(3400);
  await c.waitFor('document.getElementById("warmyAuthTermsContinue") && !document.getElementById("warmyAuthTermsContinue").disabled', { timeout: 6000 });
  await click('#warmyAuthTermsContinue');
  await c.waitFor('!!document.querySelector("[data-auth-action=register-open]")', { timeout: 10000 });
  await click('[data-auth-action="register-open"]');
  await c.waitFor('!!document.querySelector("[data-auth-action=mnemonic-confirm]")', { timeout: 20000 });
  const mn = await js(`(() => {
    const w=document.querySelector('.warmyAuthWordFriendly');
    if (!w) return null;
    const idx=w.querySelector('.warmyAuthWordIndex'), zh=w.querySelector('.warmyAuthWordText'), py=w.querySelector('.warmyAuthWordPinyin');
    const cs=(n)=>n?getComputedStyle(n):null;
    return { label:document.querySelector('.warmyAuthCheck span')?.textContent||'',
      en:document.querySelectorAll('.warmyAuthWordFriendly .warmyAuthWordEn').length,
      pyText:String(py?.textContent||'').trim(), zhText:String(zh?.textContent||'').trim(),
      idxColor:idx?cs(idx).color:'', zhColor:zh?cs(zh).color:'', pyColor:py?cs(py).color:'',
      accent:String(getComputedStyle(document.documentElement).getPropertyValue('--accent')||'').trim(),
      idxRow:idx?cs(idx).gridRowStart:'', zhRow:zh?cs(zh).gridRowStart:'', pyRow:py?cs(py).gridRowStart:'' };
  })()`);
  jian('助记拼音标签为「助记拼音」', !!(mn && mn.label === '助记拼音'), JSON.stringify(mn));
  jian('勾选拼音后不再出现英文助记词行', !!(mn && mn.en === 0), JSON.stringify(mn));
  jian('拼音是助记词本体（主题色），中文辅助为灰色', !!(mn && mn.pyText && mn.pyColor !== mn.zhColor && /rgb\(138, 134, 128\)/.test(mn.zhColor)), JSON.stringify(mn));
  jian('中文与序号并排、拼音在下一行', !!(mn && String(mn.idxRow) === '1' && String(mn.zhRow) === '1' && String(mn.pyRow) === '2'), JSON.stringify(mn));
  const errsA = (typeof c.errors === 'function' ? c.errors() : []) || [];
  jian('首启助记词页无脚本错误', errsA.length === 0, JSON.stringify(errsA).slice(0, 300));
  await stop(); await cleanupProfile();

  // ══════ B/C. 聊天滚动 + 操作时序 ══════
  profile = path.join(os.tmpdir(), 'warmy-r97-b-' + Date.now());
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
    yuYan: 'zh-CN', setupDone: true, privacyConsent: true, guideDone: true, providersSeeded: true,
    instances: [{ id: 'inst-r97-chat', ming: '牛马-聊天', name: '牛马-聊天', status: 'running', model: 'x', chain: ['x'], chainDisabled: [] }],
    providers: [], authGrants: { 'inst-r97-chat': [] }, panelCardCollapsed: {},
  }, null, 2), 'utf8');
  await start(Number(process.env.R97_PORT_B || 9718), profile, true);
  await c.waitFor('!!document.querySelector("[data-nav=singleAi]")', { timeout: 30000 });
  await sleep(600);
  await click('[data-nav="singleAi"]'); await sleep(900);
  const listN = await js('document.querySelectorAll("#lieBiaoTi .lieBiaoTiaoMu").length');
  if (!listN) console.log('  ..   list empty, body=' + String(await js('document.body.innerText')).slice(0, 200));
  await click('#lieBiaoTi .lieBiaoTiaoMu', 0); await sleep(1100);
  const sid = await js('window.__r35.huiHua()');
  jian('选中一个测试会话', !!sid, sid);

  // ── 授权卡：第 99 轮起不再有「本会话允许工作区内命令」勾选项 ──
  await sleep(500);
  const cmd0 = await js(`(() => { const r=document.querySelector('.shouQuanCmdHang'); return r?{ok:true,checked:!!r.querySelector('input')?.checked}:null; })()`);
  jian('授权卡不再有「允许本会话在工作区内执行命令」勾选项', cmd0 === null, JSON.stringify(cmd0));

  // ── C1. 两条回复各自归属自己的工具；思考段/操作按时间穿插 ──
  const order = await js(`(() => {
    const sid=window.__r35.huiHua(); const t0=Date.now()-60000;
    window.__msgs=window.__msgs||{};
    window.__msgs[sid]=[
      {role:'wo',text:'第一问',ts:t0},
      {role:'them',text:'第一答',ts:t0+10000,reasoning:'思考一\\n思考二',reasoningDuan:[{ts:t0+2000,text:'思考一'},{ts:t0+6000,text:'思考二'}],zhongJian:[],moXing:'test'},
      {role:'wo',text:'第二问',ts:t0+20000},
      {role:'them',text:'第二答',ts:t0+50000,reasoning:'思考三\\n思考四',reasoningDuan:[{ts:t0+30000,text:'思考三'},{ts:t0+45000,text:'思考四'}],zhongJian:[],moXing:'test'},
      {role:'wo',text:'第三问',ts:t0+60000},
      {role:'them',text:'旧数据答',ts:t0+90000,reasoning:'旧思考一\\n旧思考二\\n旧思考三\\n旧思考四',reasoningDuan:[],zhongJian:[],moXing:'test'},
    ];
    window.__qingXingDong(sid);
    window.__r35.hangDong({hao:'a1',ts:t0+3000,op:'工具一',detail:'一',status:'ok'});
    window.__r35.hangDong({hao:'a2',ts:t0+40000,op:'工具二',detail:'二',status:'ok'});
    window.__r35.hangDong({hao:'a3',ts:t0+70000,op:'工具三',detail:'三',status:'ok'});
    window.__r35.hangDong({hao:'a4',ts:t0+80000,op:'工具四',detail:'四',status:'ok'});
    window.__r35.chongHuaQuan();
    const ms=[...document.querySelectorAll('#xiaoXiJi .xiaoXi[data-role="them"]')];
    const info=(n)=>{ const sk=n.querySelector('.siKaoKuai'); return { xd:[...n.querySelectorAll('.xingDongZu')].map(x=>x.dataset.hao), order:sk?[...sk.children].map(x=>x.dataset?.hao||x.textContent.slice(0,6)):[] }; };
    return { n:ms.length, m0:info(ms[0]||document.createElement('div')), m1:info(ms[1]||document.createElement('div')), m2:info(ms[2]||document.createElement('div')) };
  })()`);
  jian('三条回复都存在', !!(order && order.n === 3), JSON.stringify(order));
  jian('第一条回复只挂它自己的工具一', !!(order && JSON.stringify(order.m0.xd) === JSON.stringify(['a1'])), JSON.stringify(order && order.m0));
  jian('第二条回复只挂它自己的工具二', !!(order && JSON.stringify(order.m1.xd) === JSON.stringify(['a2'])), JSON.stringify(order && order.m1));
  jian('第三条（旧数据）挂工具三/四', !!(order && JSON.stringify(order.m2.xd) === JSON.stringify(['a3','a4'])), JSON.stringify(order && order.m2));
  jian('第一条：思考→工具一→思考（按时间穿插）', !!(order && order.m0.order.join('|').includes('思考一|a1|思考二')), JSON.stringify(order && order.m0.order));
  jian('第二条：思考→工具二→思考（按时间穿插）', !!(order && order.m1.order.join('|').includes('思考三|a2|思考四')), JSON.stringify(order && order.m1.order));
  jian('旧数据单块思考也按时间切段（工具不在最底部堆积）', !!(order && order.m2.order.filter(x=>/旧思考/.test(x)).length >= 2
    && order.m2.order.findIndex(x=>x==='a3') > 0 && order.m2.order.findIndex(x=>x==='a4') > 0), JSON.stringify(order && order.m2.order));

  // ── B1. 下箭头必须真的到最底 ──
  await js(`(() => {
    const sid=window.__r35.huiHua(); const arr=window.__msgs[sid]=window.__msgs[sid]||[];
    for (let i=0;i<40;i++) arr.push({role:i%2?'them':'wo',text:'填充 '+i+'：'+'内容'.repeat(40),ts:Date.now()+i});
    window.__r35.chongHuaQuan(); return true; })()`);
  await sleep(400);
  const geom = await js(`(() => { const h=document.getElementById('xiaoXiJi'); h.scrollTop=0; h.dispatchEvent(new WheelEvent('wheel',{deltaY:-200,bubbles:true})); return {sh:h.scrollHeight,ch:h.clientHeight,max:h.scrollHeight-h.clientHeight,top:h.scrollTop}; })()`);
  jian('聊天区足够长可滚动', !!(geom && geom.max > 400), JSON.stringify(geom));
  await sleep(200);
  await click('#scrollDiAnNiu'); await sleep(450);
  const atBottom = await js(`(() => { const h=document.getElementById('xiaoXiJi'); return {top:h.scrollTop,max:h.scrollHeight-h.clientHeight,gap:h.scrollHeight-h.scrollTop-h.clientHeight,hidden:document.getElementById('scrollDiAnNiu').classList.contains('yinCang')}; })()`);
  jian('点下箭头后真的到达最底部（gap ≤ 2）', !!(atBottom && atBottom.gap <= 2 && atBottom.hidden), JSON.stringify(atBottom));

  // ── B2. 未勾选：用户上滚后新回复不改变位置 ──
  const b1 = await js(`(() => { const h=document.getElementById('xiaoXiJi'); h.scrollTop=Math.round((h.scrollHeight-h.clientHeight)*0.4); h.dispatchEvent(new WheelEvent('wheel',{deltaY:-160,bubbles:true})); return h.scrollTop; })()`);
  await sleep(250);
  const b1b = await js('document.getElementById("xiaoXiJi").scrollTop');
  await js(`(() => { const sid=window.__r35.huiHua(); (window.__msgs[sid]=window.__msgs[sid]||[]).push({role:'them',text:'用户上滚后的新回复',ts:Date.now(),reasoning:'新思考',reasoningDuan:[{ts:Date.now(),text:'新思考'}],zhongJian:[],moXing:'test'}); window.__r35.chongHuaQuan(); return true; })()`);
  await sleep(350);
  const b2 = await js('document.getElementById("xiaoXiJi").scrollTop');
  jian('未勾选 + 用户上滚：新回复整块重画不改变 scrollTop', Math.abs(b2 - b1b) <= 1 && b2 > 0, JSON.stringify({ b1, b1b, b2 }));
  await js(`(() => { const sid=window.__r35.huiHua(); (window.__msgs[sid]=window.__msgs[sid]||[]).push({role:'them',text:'再来一条',ts:Date.now()+1,reasoning:'再来',reasoningDuan:[{ts:Date.now()+1,text:'再来'}],zhongJian:[],moXing:'test'}); window.__r35.liuShiKuai({reasoning:'流式思考'.repeat(10),content:'流式回复'.repeat(20)}); return true; })()`);
  await sleep(350);
  const b3 = await js('document.getElementById("xiaoXiJi").scrollTop');
  jian('未勾选 + 用户上滚：流式追加也不改变 scrollTop', Math.abs(b3 - b1b) <= 1 && b3 > 0, JSON.stringify({ b1b, b3 }));

  /** B2b：不派发 wheel，直接改 scrollTop（模拟拖动滚动条）也必须被识别为用户接管 */
  const tb = await js(`(() => { const h=document.getElementById('xiaoXiJi'); h.scrollTop=Math.round((h.scrollHeight-h.clientHeight)*0.35); return h.scrollTop; })()`);
  await sleep(220);
  const pinState = await js(`window.__r35.gunDong?.()`);
  await js(`(() => { const sid=window.__r35.huiHua(); (window.__msgs[sid]=window.__msgs[sid]||[]).push({role:'them',text:'拖滚动条后的新回复',ts:Date.now(),reasoningDuan:[{ts:Date.now(),text:'拖条'}],zhongJian:[],moXing:'test'}); window.__r35.chongHuaQuan(); return true; })()`);
  await sleep(350);
  const tb2 = await js('document.getElementById("xiaoXiJi").scrollTop');
  jian('未勾选 + 拖动滚动条（非滚轮）后：新回复不改变 scrollTop',
    !!(pinState && pinState.pin) && Math.abs(tb2 - tb) <= 1 && tb2 > 0, JSON.stringify({ tb, tb2, pinState }));

  // ── B2c. 组合压力：连续流式 + 中途拖条 + 窗口缩放，位置仍不被抢 ──
  const tb0 = await js('document.getElementById("xiaoXiJi").scrollTop');
  const streamTops = [];
  for (let i = 0; i < 5; i++) {
    await js(`window.__r35.liuShiKuai({ reasoning: ${JSON.stringify('组合压力思考'.repeat(20 + i * 5))}, content: ${JSON.stringify('组合压力正文'.repeat(30 + i * 8))} })`);
    await sleep(150);
    streamTops.push(await js('document.getElementById("xiaoXiJi").scrollTop'));
  }
  jian('连续 5 次流式追加期间 scrollTop 不被抢', streamTops.every((x) => Math.abs(x - tb0) <= 1), JSON.stringify({ tb0, streamTops }));
  const vpB = await js('({w:innerWidth,h:innerHeight})');
  try { await c.send('Emulation.setDeviceMetricsOverride', { width: Math.max(640, vpB.w - 120), height: Math.max(420, vpB.h - 100), deviceScaleFactor: 1, mobile: false }); } catch { /* 不支持就跳过 */ }
  await sleep(300);
  const afterResize = await js('document.getElementById("xiaoXiJi").scrollTop');
  try { await c.send('Emulation.clearDeviceMetricsOverride'); } catch { /* noop */ }
  await sleep(300);
  const afterRestore = await js('document.getElementById("xiaoXiJi").scrollTop');
  jian('窗口缩放期间/恢复后位置不回顶（允许浏览器按新高度夹取）',
    afterResize > 0 && afterRestore > 0 && Math.abs(afterRestore - tb0) <= 2, JSON.stringify({ tb0, afterResize, afterRestore }));

  // ── B3. 未勾选 + 用户已在底部：新内容继续贴底（第 99 轮口径） ──
  await js(`document.getElementById('scrollDiAnNiu').click()`); await sleep(400);
  await js(`(() => { const sid=window.__r35.huiHua(); const t=Date.now()+2; (window.__msgs[sid]=window.__msgs[sid]||[]).push({role:'them',text:'长新回复：'+'长内容'.repeat(800),ts:t,reasoningDuan:[{ts:t,text:'长思考'}],zhongJian:[],moXing:'test'}); window.__r35.chongHuaQuan(); return true; })()`);
  await sleep(350);
  const anchored = await js(`(() => { const h=document.getElementById('xiaoXiJi'); const ms=[...h.querySelectorAll('.xiaoXi')]; const last=ms[ms.length-1]; const top=last.getBoundingClientRect().top-h.getBoundingClientRect().top; return {top:Math.round(top),scrollTop:h.scrollTop,max:h.scrollHeight-h.clientHeight,gap:h.scrollHeight-h.scrollTop-h.clientHeight,gun:window.__r35.gunDong?.()}; })()`);
  jian('未勾选 + 已在底部：新内容继续贴底（gap ≤ 2，不把最后一条钉到顶部）', !!(anchored && anchored.gap <= 2 && anchored.scrollTop > 0), JSON.stringify(anchored));

  // ── B4. 勾选自动滚动：始终到底 ──
  await js(`document.getElementById('caiDanTuBiaoAutoscroll').click()`); await sleep(350);
  await js(`(() => { const sid=window.__r35.huiHua(); (window.__msgs[sid]=window.__msgs[sid]||[]).push({role:'them',text:'自动滚动新回复：'+'内容'.repeat(300),ts:Date.now()+3,reasoningDuan:[{ts:Date.now()+3,text:'自动'}],zhongJian:[],moXing:'test'}); window.__r35.chongHuaQuan(); return true; })()`);
  await sleep(350);
  const auto = await js(`(() => { const h=document.getElementById('xiaoXiJi'); return {gap:h.scrollHeight-h.scrollTop-h.clientHeight, gun:window.__r35.gunDong?.()}; })()`);
  jian('勾选自动滚动：重画后仍在最底部', !!(auto && auto.gap <= 2), JSON.stringify(auto));
  await js(`document.getElementById('caiDanTuBiaoAutoscroll').click()`); await sleep(200);

  const errsB = (typeof c.errors === 'function' ? c.errors() : []) || [];
  jian('聊天验收全程无脚本错误', errsB.length === 0, JSON.stringify(errsB).slice(0, 300));
} catch (e) {
  bad('门禁执行异常', String((e && (e.stack || e.message)) || e));
} finally {
  await stop();
  await cleanupProfile();
}

console.log(`\nverify-r97-live: ${okN} ok / ${failN} FAIL`);
process.exitCode = failN ? 1 : 0;
