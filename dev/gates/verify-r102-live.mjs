/**
 * verify-r102-live —— 第 102 轮真机验收（Electron + CDP，临时 profile）。
 *
 * 项 1：不在底部时只有下箭头；只有**未查看的新回复**才显示摘要；查看后摘要消失，
 *       单纯上翻不再生成摘要。
 * 项 2：引导卡「去聊天」不收起引导卡，只关掉挡路的弹窗/设置页，并把焦点放回输入框。
 * 项 3：nm 自己最大化 = 铺满所在显示器工作区；主窗口最大化时：
 *       · 没吸附 nm ⇒ 原生最大化；
 *       · 吸附了 nm ⇒ 主窗口占满工作区减掉第四列宽度，nm 正好放进预留条；
 *       · 再点一次双方都回到最大化前的位置/尺寸。
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
const ok = (m, d) => { okN++; console.log('  ok   ' + m + (d === undefined ? '' : ' ← ' + String(d).slice(0, 360))); };
const bad = (m, d) => { failN++; console.log('  FAIL ' + m + (d === undefined ? '' : ' ← ' + String(d).slice(0, 520))); };
const jian = (m, cond, d) => (cond ? ok(m, d) : bad(m, d));

let child = null, c = null, profile = '';
const js = (conn) => (e) => conn.evaluate('(async function(){ try { return await (' + e + '); } catch (err) { return { __err: String((err && (err.stack || err.message)) || err).slice(0, 500) }; } })()');
const click = async (conn, sel, nth = 0) => {
  const p = await js(conn)(`(() => { const a=[...document.querySelectorAll(${JSON.stringify(sel)})]; const e=a[${nth}]; if(!e) return null; e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}; })()`);
  if (!p || p.__err) return false;
  await conn.mouseClick(p.x, p.y);
  return true;
};

async function start(port, prof) {
  const env = { ...process.env, WARMY_AUTH_BYPASS: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(ELECTRON, ['--remote-debugging-port=' + port, '--user-data-dir=' + prof, MAIN], {
    cwd: PKG, stdio: ['ignore', 'ignore', 'ignore'], windowsHide: false, env,
  });
  let last = '';
  for (let i = 0; i < 90; i += 1) {
    try { c = await attach(port, { biaoQian: 'r102', callTimeout: 20000 }); break; } catch (e) { last = e.message; await sleep(300); }
  }
  if (!c) throw new Error('CDP 未连接：' + last);
  await c.send('Runtime.enable');
}
async function attachPage(port, includes) {
  for (let i = 0; i < 80; i += 1) {
    try {
      const x = await attach(port, { biaoQian: 'r102', matchUrlIncludes: includes, callTimeout: 20000 });
      await x.send('Runtime.enable');
      return x;
    } catch { await sleep(250); }
  }
  return null;
}
async function stop() {
  try { if (c) await c.send('Browser.close', {}, { timeout: 5000 }); } catch { /* 已退 */ }
  c = null;
  await sleep(700);
  try { if (child) execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* 已退 */ }
  child = null;
}

const PS_MAX = path.join(os.tmpdir(), 'warmy-r102-max-win.ps1');
function maximizeWinByTitle(title) {
  try {
    fs.writeFileSync(PS_MAX, [
      'param([string]$TitleB64="")',
      'Add-Type @"',
      'using System;',
      'using System.Text;',
      'using System.Runtime.InteropServices;',
      'public class W {',
      '  public delegate bool EnumProc(IntPtr h, IntPtr l);',
      '  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);',
      '  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);',
      '  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);',
      '  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);',
      '}',
      '"@',
      'if (-not $TitleB64) { exit 3 }',
      '$target = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($TitleB64))',
      '$global:found = [IntPtr]::Zero',
      '$cb = [W+EnumProc]{ param($h,$l)',
      '  if (-not [W]::IsWindowVisible($h)) { return $true }',
      '  $sb = New-Object System.Text.StringBuilder 1024',
      '  [void][W]::GetWindowText($h, $sb, 1024)',
      '  $t = $sb.ToString()',
      '  if ($t -eq $target -or $t.Contains($target)) { $global:found = $h; return $false }',
      '  return $true }',
      '[void][W]::EnumWindows($cb, [IntPtr]::Zero)',
      'if ($global:found -eq [IntPtr]::Zero) { exit 2 }',
      '[void][W]::ShowWindow($global:found, 3)',
      'exit 0',
    ].join('\r\n'), 'utf8');
    const b64 = Buffer.from(String(title || ''), 'utf8').toString('base64');
    execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS_MAX,
      '-TitleB64', b64], { stdio: 'ignore', timeout: 15000 });
    return true;
  } catch { return false; }
}

function baseSettings(extra = {}) {
  return {
    yuYan: 'zh-CN', setupDone: true, privacyConsent: true, providersSeeded: true,
    providers: [{
      id: 'p-r102', biaoQian: 'P-R102', protocol: 'openai-compatible',
      baseURL: 'http://127.0.0.1:9/v1', defaultModel: '', models: ['m-r102'], staleModels: [], hasKey: false,
    }],
    modelCaps: { 'm-r102': { contextLen: 65536, kind: 'chat', tools: false, vision: false } },
    specialModels: { chatChain: ['m-r102'] },
    instances: [{ id: 'inst-r102', ming: '牛马-R102', name: '牛马-R102', status: 'running', model: 'm-r102', chain: ['m-r102'], chainDisabled: [] }],
    authGrants: { 'inst-r102': [] },
    panelCardCollapsed: {},
    ...extra,
  };
}

try {
  profile = path.join(os.tmpdir(), 'warmy-r102-' + Date.now());
  fs.mkdirSync(profile, { recursive: true });
  const demo = path.join(profile, 'r102-demo.md');
  fs.writeFileSync(demo, '# R102\n\n用于最大化验收的临时文件。\n', 'utf8');
  const panel = Number(process.env.R102_PANEL || 0);
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify(baseSettings({
    guideDone: false,
    ...(Number.isFinite(panel) && panel >= 220 ? { panelWidth: Math.round(panel) } : {}),
  }), null, 2), 'utf8');

  const port = Number(process.env.R102_PORT || 10218);
  await start(port, profile);
  await c.waitFor('window.__warmyBootDataReady === true', { timeout: 30000 });
  await c.waitFor('!!document.querySelector("[data-nav=singleAi]")', { timeout: 30000 });
  await sleep(900);

  /* ══════ A. 引导卡：去聊天不收起引导卡 + 关掉挡路弹窗 ══════ */
  console.log('\n[A] 引导卡「去聊天」');
  await click(c, '[data-nav="singleAi"]'); await sleep(600);
  await c.waitFor('!!document.getElementById("startGuide")', { timeout: 10000 });
  const g0 = await js(c)(`(() => ({ st: window.__startGuide?.state?.(), active: Number(document.querySelector('#startGuide .startGuideStep[aria-current="step"]')?.getAttribute('data-sg-step')), panel: !!document.getElementById('startGuide'), pill: !!document.getElementById('startGuidePill'), nav: document.querySelector('.ceLanTiaoMu.jiHuo')?.getAttribute('data-nav')||'' }))()`);
  jian('引导卡展开在第 4 步（前三步已完成）',
    !!(g0 && g0.panel && g0.pill === false && g0.active === 3 && g0.st && g0.st.ready[0] && g0.st.ready[1] && g0.st.ready[2] && g0.st.ready[3] === false),
    JSON.stringify(g0));

  // 打开「创建牛马」输入弹窗（它会挡住聊天），再点引导卡「去聊天」
  await click(c, '.lieBiaoHqTuBiao'); await sleep(450);
  const dialogBefore = await js(c)(`(() => { const r=document.getElementById('duiHuaKuangGen'); return { open: !!r && !r.classList.contains('yinCang'), input: !!document.querySelector('#duiHuaKuangGen input') }; })()`);
  jian('先打开一个挡路的创建牛马弹窗', !!(dialogBefore && dialogBefore.open && dialogBefore.input), JSON.stringify(dialogBefore));
  await click(c, '#startGuide [data-sg="go"]'); await sleep(800);
  const g1 = await js(c)(`(() => {
    const root=document.getElementById('duiHuaKuangGen');
    const panel=document.getElementById('startGuide');
    const pill=document.getElementById('startGuidePill');
    const st=window.__startGuide?.state?.();
    const chat=document.getElementById('xiaoXiJi');
    return {
      panel: !!panel, pill: !!pill, open: !!st && st.open === true,
      dialog: !!root && !root.classList.contains('yinCang'),
      nav: document.querySelector('.ceLanTiaoMu.jiHuo')?.getAttribute('data-nav')||'',
      chat: !!chat, focus: document.activeElement && document.activeElement.id,
    };
  })()`);
  jian('去聊天：引导卡仍展开、没有变成小胶囊', !!(g1 && g1.panel && g1.pill === false && g1.open), JSON.stringify(g1));
  jian('去聊天：挡路的创建牛马弹窗被关掉', !!(g1 && g1.dialog === false), JSON.stringify(g1));
  jian('去聊天：进入聊天并聚焦输入框', !!(g1 && g1.nav === 'singleAi' && g1.chat && g1.focus === 'shuRu'), JSON.stringify(g1));

  // 设置页也是挡路状态：先切过去，再点「去聊天」
  await click(c, '[data-nav="settings"]'); await sleep(650);
  const g2a = await js(c)(`(() => ({ nav: document.querySelector('.ceLanTiaoMu.jiHuo')?.getAttribute('data-nav')||'', panel: !!document.getElementById('startGuide') }))()`);
  jian('引导卡在设置页也保持展开', !!(g2a && g2a.panel && g2a.nav === 'settings'), JSON.stringify(g2a));
  await click(c, '#startGuide [data-sg="go"]'); await sleep(800);
  const g2 = await js(c)(`(() => ({
    nav: document.querySelector('.ceLanTiaoMu.jiHuo')?.getAttribute('data-nav')||'',
    panel: !!document.getElementById('startGuide'), pill: !!document.getElementById('startGuidePill'),
    focus: document.activeElement && document.activeElement.id,
  }))()`);
  jian('从设置页去聊天：回到单聊、引导卡不收起', !!(g2 && g2.nav === 'singleAi' && g2.panel && g2.pill === false), JSON.stringify(g2));

  // 只有用户主动点「—」才收起
  await click(c, '#startGuide [data-sg="min"]'); await sleep(500);
  const g3 = await js(c)(`(() => ({ panel: !!document.getElementById('startGuide'), pill: !!document.getElementById('startGuidePill') }))()`);
  jian('用户主动点最小化：引导卡才收起并留下继续胶囊', !!(g3 && g3.panel === false && g3.pill === true), JSON.stringify(g3));
  await js(c)(`window.__startGuideOpen?.(true)`); await sleep(650);

  /* ══════ B. 下箭头 / 未查看新回复摘要 ══════ */
  console.log('\n[B] 滚动与未查看摘要');
  await click(c, '[data-nav="singleAi"]'); await sleep(700);
  await click(c, '#lieBiaoTi .lieBiaoTiaoMu'); await sleep(900);
  const sid = await js(c)('window.__r35.huiHua()');
  jian('打开测试会话', !!sid, sid);
  await js(c)(`(() => {
    const sid=window.__r35.huiHua(); const t0=Date.now()-120000; const arr=[];
    for (let i=0;i<60;i++) arr.push({role:i%2?'them':'wo',text:'填充 '+i+'：'+'这是用于滚动的长内容。'.repeat(8),ts:t0+i*100});
    window.__msgs=window.__msgs||{}; window.__msgs[sid]=arr;
    window.__r35.chongHuaQuan(); return true;
  })()`);
  await sleep(500);
  await js(c)(`(() => { const h=document.getElementById('xiaoXiJi'); h.scrollTop=Math.round((h.scrollHeight-h.clientHeight)*0.4); h.dispatchEvent(new WheelEvent('wheel',{deltaY:-120,bubbles:true})); return h.scrollTop; })()`);
  await sleep(450);
  const s0 = await js(c)(`(() => { const a=document.getElementById('scrollDiAnNiu'), b=document.getElementById('newXiaoXiBubble'), h=document.getElementById('xiaoXiJi');
    return { arrow: !!a && !a.classList.contains('yinCang'), bubble: !!b && !b.classList.contains('yinCang'), gap: h.scrollHeight-h.scrollTop-h.clientHeight }; })()`);
  jian('没有新回复、用户上翻：只有下箭头，没有摘要气泡', !!(s0 && s0.arrow && s0.bubble === false && s0.gap > 32), JSON.stringify(s0));

  await js(c)(`window.__r35.xinHuiFu('这是一条尚未查看的新回复：请点下箭头查看。')`);
  await sleep(500);
  const s1 = await js(c)(`(() => { const a=document.getElementById('scrollDiAnNiu'), b=document.getElementById('newXiaoXiBubble'), h=document.getElementById('xiaoXiJi');
    return { arrow: !!a && !a.classList.contains('yinCang'), bubble: !!b && !b.classList.contains('yinCang'), text: b?.textContent||'', gap: h.scrollHeight-h.scrollTop-h.clientHeight }; })()`);
  jian('新回复到来且未查看：显示摘要气泡（下箭头同时存在）', !!(s1 && s1.arrow && s1.bubble && /尚未查看的新回复/.test(s1.text) && s1.gap > 32), JSON.stringify(s1));

  await js(c)(`(() => { const h=document.getElementById('xiaoXiJi'); h.scrollTop=Math.round((h.scrollHeight-h.clientHeight)*0.2); h.dispatchEvent(new WheelEvent('wheel',{deltaY:-60,bubbles:true})); return h.scrollTop; })()`);
  await sleep(400);
  const s2 = await js(c)(`(() => { const b=document.getElementById('newXiaoXiBubble'); return { bubble: !!b && !b.classList.contains('yinCang'), text: b?.textContent||'' }; })()`);
  jian('未查看期间继续上翻：摘要仍然保留', !!(s2 && s2.bubble && /尚未查看的新回复/.test(s2.text)), JSON.stringify(s2));

  await click(c, '#scrollDiAnNiu'); await sleep(500);
  const s3 = await js(c)(`(() => { const a=document.getElementById('scrollDiAnNiu'), b=document.getElementById('newXiaoXiBubble'), h=document.getElementById('xiaoXiJi');
    return { arrow: !!a && !a.classList.contains('yinCang'), bubble: !!b && !b.classList.contains('yinCang'), gap: h.scrollHeight-h.scrollTop-h.clientHeight }; })()`);
  jian('点下箭头查看后：摘要消失、到达底部、下箭头隐藏', !!(s3 && s3.arrow === false && s3.bubble === false && s3.gap <= 2), JSON.stringify(s3));

  await js(c)(`(() => { const h=document.getElementById('xiaoXiJi'); h.scrollTop=Math.round((h.scrollHeight-h.clientHeight)*0.4); h.dispatchEvent(new WheelEvent('wheel',{deltaY:-120,bubbles:true})); return h.scrollTop; })()`);
  await sleep(400);
  const s4 = await js(c)(`(() => { const a=document.getElementById('scrollDiAnNiu'), b=document.getElementById('newXiaoXiBubble'); return { arrow: !!a && !a.classList.contains('yinCang'), bubble: !!b && !b.classList.contains('yinCang') }; })()`);
  jian('已查看过之后再上翻：仍然只有下箭头（不重复显示摘要）', !!(s4 && s4.arrow && s4.bubble === false), JSON.stringify(s4));

  await click(c, '#scrollDiAnNiu'); await sleep(450);
  await js(c)(`window.__r35.xinHuiFu('在底部收到的新回复，应当直接算已查看。')`); await sleep(400);
  const s5 = await js(c)(`(() => { const b=document.getElementById('newXiaoXiBubble'), h=document.getElementById('xiaoXiJi');
    return { bubble: !!b && !b.classList.contains('yinCang'), gap: h.scrollHeight-h.scrollTop-h.clientHeight }; })()`);
  jian('在底部收到新回复：不显示未查看摘要', !!(s5 && s5.bubble === false && s5.gap <= 2), JSON.stringify(s5));

  /* ══════ C. nm / 主窗口最大化 ══════ */
  console.log('\n[C] nm / 主窗口最大化');
  const r1 = await js(c)(`window.warmy.nmKai(${JSON.stringify(demo)})`);
  jian('打开 nm 查看器', !!(r1 && r1.ok), JSON.stringify(r1));
  await sleep(1000);
  const nmPage = await attachPage(port, 'r102-demo.md');
  if (!nmPage) throw new Error('找不到 nm 页面');
  await sleep(500);
  const nmId = await nmPage.evaluate(`Number(new URLSearchParams(location.search).get('id')||0)`);
  const w0 = await js(c)('window.warmy.winZhuangTai()');
  const lie0 = await js(c)('window.warmy.nmLieBiao()');
  const n0 = (lie0 && lie0.chuangKou || []).find((x) => Number(x.id) === Number(nmId));
  jian('初始：主窗口未最大化、nm 与主窗口吸附（右侧）',
    !!(w0 && w0.maximized === false && w0.customMaximized === false && n0 && n0.lianJie.includes(-1)), JSON.stringify({ w0, n0 }));

  // 主窗口最大化：预留第四列
  await js(c)('window.warmy.winMaximize()');
  await c.waitFor('window.warmy.winZhuangTai().then(z=>z.customMaximized===true)', { timeout: 8000 });
  await sleep(700);
  const w1 = await js(c)('window.warmy.winZhuangTai()');
  const lie1 = await js(c)('window.warmy.nmLieBiao()');
  const n1 = (lie1 && lie1.chuangKou || []).find((x) => Number(x.id) === Number(nmId));
  const p1 = await js(c)(`(() => { const s=getComputedStyle(document.documentElement).getPropertyValue('--panel-w'); return Math.round(parseFloat(s)||0); })()`);
  const wa = w1 && w1.workArea;
  jian('主窗口最大化（有吸附）：进入预留式最大化，方向=右',
    !!(w1 && w1.customMaximized === true && Array.isArray(w1.reservedSides) && w1.reservedSides.includes('you') && w1.maximized === false),
    JSON.stringify({ w1, p1 }));
  jian('预留条宽度 = 主窗口第四列宽度',
    !!(n1 && p1 > 0 && Math.abs(n1.kuang.width - p1) <= 2 && Math.abs((wa.x + wa.width) - (n1.kuang.x + n1.kuang.width)) <= 2),
    JSON.stringify({ p1, n1: n1 && n1.kuang, wa }));
  jian('主窗口占满工作区其余部分（顶部/底部/左侧对齐，右缘紧贴 nm）',
    !!(wa && w1 && Math.abs(w1.bounds.x - wa.x) <= 2 && Math.abs(w1.bounds.y - wa.y) <= 2
      && Math.abs(w1.bounds.height - wa.height) <= 2 && Math.abs((w1.bounds.x + w1.bounds.width) - n1.kuang.x) <= 2),
    JSON.stringify({ bounds: w1 && w1.bounds, wa, nm: n1 && n1.kuang }));
  jian('nm 正好放进预留条（高度=工作区高、无重叠无空隙，吸附仍在）',
    !!(n1 && Math.abs(n1.kuang.y - wa.y) <= 2 && Math.abs(n1.kuang.height - wa.height) <= 2 && n1.lianJie.includes(-1)),
    JSON.stringify(n1));

  // 再点一次：双方还原
  await js(c)('window.warmy.winMaximize()');
  await c.waitFor('window.warmy.winZhuangTai().then(z=>z.customMaximized===false)', { timeout: 8000 });
  await sleep(700);
  const w2 = await js(c)('window.warmy.winZhuangTai()');
  const lie2 = await js(c)('window.warmy.nmLieBiao()');
  const n2 = (lie2 && lie2.chuangKou || []).find((x) => Number(x.id) === Number(nmId));
  jian('再点一次最大化：主窗口回到最大化前位置/尺寸、退出预留状态',
    !!(w2 && w2.customMaximized === false && Math.abs(w2.bounds.x - w0.bounds.x) <= 2
      && Math.abs(w2.bounds.y - w0.bounds.y) <= 2 && Math.abs(w2.bounds.width - w0.bounds.width) <= 2
      && Math.abs(w2.bounds.height - w0.bounds.height) <= 2),
    JSON.stringify({ before: w0 && w0.bounds, after: w2 && w2.bounds }));
  jian('还原时 nm 也回到最大化前的尺寸/位置，吸附仍在',
    !!(n2 && Math.abs(n2.kuang.x - n0.kuang.x) <= 2 && Math.abs(n2.kuang.y - n0.kuang.y) <= 2
      && Math.abs(n2.kuang.width - n0.kuang.width) <= 2 && Math.abs(n2.kuang.height - n0.kuang.height) <= 2
      && n2.lianJie.includes(-1)),
    JSON.stringify({ before: n0 && n0.kuang, after: n2 && n2.kuang }));

  // 系统最大化（Win+Up / 贴靠布局 / 任务栏）也必须转成预留式，而不是绕过应用按钮
  const mainTitle2 = await js(c)('document.title');
  const osMax = maximizeWinByTitle(mainTitle2);
  let wOs = null, nOs = null;
  for (let i = 0; i < 50; i += 1) {
    wOs = await js(c)('window.warmy.winZhuangTai()');
    if (wOs && wOs.customMaximized === true) break;
    await sleep(200);
  }
  const lie3 = await js(c)('window.warmy.nmLieBiao()');
  nOs = (lie3 && lie3.chuangKou || []).find((x) => Number(x.id) === Number(nmId));
  jian('系统最大化（非应用按钮）也转成预留式：主窗缩到工作区-第四列，nm 填条',
    !!(osMax && wOs && wOs.customMaximized === true && p1 > 0 && wa && nOs
      && Math.abs(wOs.bounds.width - (wa.width - p1)) <= 2
      && Math.abs(nOs.kuang.width - p1) <= 2
      && Math.abs(nOs.kuang.height - wa.height) <= 2),
    JSON.stringify({ osMax, w: wOs && { custom: wOs.customMaximized, bounds: wOs.bounds }, nm: nOs && nOs.kuang }));
  await js(c)('window.warmy.winMaximize()');
  await c.waitFor('window.warmy.winZhuangTai().then(z=>z.customMaximized===false)', { timeout: 8000 });
  await sleep(600);
  const w4 = await js(c)('window.warmy.winZhuangTai()');
  jian('系统最大化转换后再点应用内最大化：回到原位置', !!(w4 && Math.abs(w4.bounds.x - w0.bounds.x) <= 2 && Math.abs(w4.bounds.width - w0.bounds.width) <= 2), JSON.stringify({ w4: w4 && w4.bounds }));

  // nm 自己最大化：铺满显示器工作区
  await nmPage.evaluate('window.warmy.winMaximize()');
  let n3 = null;
  for (let i = 0; i < 40; i += 1) {
    const l = await js(c)('window.warmy.nmLieBiao()');
    n3 = (l && l.chuangKou || []).find((x) => Number(x.id) === Number(nmId));
    if (n3 && n3.max === true) break;
    await sleep(150);
  }
  /**
   * Windows 原生最大化会带 8px 的不可见缩放边框：getBounds 是 (wa.x-8, wa.y-8, wa.w+16, wa.h+16)，
   * 但客户区正好铺满工作区、任务栏仍可见。这是系统语义，不能用 setBounds 硬抠掉 8px。
   */
  const chao = (b, w) => !!b && !!w && Math.abs(b.x - w.x) <= 10 && Math.abs(b.y - w.y) <= 10
    && b.width >= w.width - 2 && b.width <= w.width + 24
    && b.height >= w.height - 2 && b.height <= w.height + 24;
  jian('nm 点最大化：铺满所在显示器工作区（Windows 原生最大化 8px 不可见边框）',
    !!(n3 && n3.max === true && chao(n3.kuang, wa)), JSON.stringify({ nm: n3 && n3.kuang, wa }));
  const mainDuringNm = await js(c)('window.warmy.winZhuangTai()');
  jian('nm 自己最大化不改变主窗口状态', !!(mainDuringNm && mainDuringNm.customMaximized === false), JSON.stringify(mainDuringNm));

  await nmPage.evaluate('window.warmy.winMaximize()');
  let n4 = null;
  for (let i = 0; i < 50; i += 1) {
    const l = await js(c)('window.warmy.nmLieBiao()');
    n4 = (l && l.chuangKou || []).find((x) => Number(x.id) === Number(nmId));
    if (n4 && n4.max === false
      && Math.abs(n4.kuang.x - n0.kuang.x) <= 2 && Math.abs(n4.kuang.y - n0.kuang.y) <= 2
      && Math.abs(n4.kuang.width - n0.kuang.width) <= 2 && Math.abs(n4.kuang.height - n0.kuang.height) <= 2) break;
    await sleep(150);
  }
  jian('nm 再点一次恢复：回到最大化前的吸附位置，吸附仍在',
    !!(n4 && n4.max === false && Math.abs(n4.kuang.x - n0.kuang.x) <= 2 && Math.abs(n4.kuang.y - n0.kuang.y) <= 2
      && Math.abs(n4.kuang.width - n0.kuang.width) <= 2 && Math.abs(n4.kuang.height - n0.kuang.height) <= 2
      && n4.lianJie.includes(-1)),
    JSON.stringify({ before: n0 && n0.kuang, after: n4 && n4.kuang, max: n4 && n4.max }));

  // 没有吸附：主窗口原生最大化
  await js(c)(`window.warmy.nmSheZhi({ id: ${Number(nmId)}, xiFu: false })`);
  await sleep(400);
  await js(c)('window.warmy.winMaximize()');
  let w5 = null;
  for (let i = 0; i < 40; i += 1) {
    w5 = await js(c)('window.warmy.winZhuangTai()');
    if (w5 && w5.maximized === true) break;
    await sleep(150);
  }
  jian('没有吸附 nm 时：主窗口走原生最大化（customMaximized=false，铺满工作区）',
    !!(w5 && w5.maximized === true && w5.customMaximized === false && chao(w5.bounds, wa)),
    JSON.stringify({ w5 }));
  await js(c)('window.warmy.winMaximize()'); await sleep(600);

  const errs = (typeof c.errors === 'function' ? c.errors() : []) || [];
  jian('主窗口验收全程无脚本错误', errs.length === 0, JSON.stringify(errs).slice(0, 400));
  const nmErrs = (typeof nmPage.errors === 'function' ? nmPage.errors() : []) || [];
  jian('nm 窗口验收全程无脚本错误', nmErrs.length === 0, JSON.stringify(nmErrs).slice(0, 400));
} catch (e) {
  bad('门禁执行异常', String((e && (e.stack || e.message)) || e));
} finally {
  await stop();
  try { if (profile) fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 尽力清 */ }
  try { fs.rmSync(PS_MAX, { force: true }); } catch { /* 尽力清 */ }
}

console.log(`\nverify-r102-live: ${okN} ok / ${failN} FAIL`);
process.exitCode = failN ? 1 : 0;
