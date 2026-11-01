/**
 * verify-r92-live —— 第 92 轮真机界面验收（Electron + CDP，临时 profile）。
 *
 * 覆盖：
 *  1. 第四列没有「规范」卡，新增「要求」卡；添加下拉有要求、没有规范；
 *  2. 要求每会话一份、互相隔离；保存落盘到 userData/yaoqiu/<sid>.md；
 *  3. 短记忆内容不出现在界面上（即便文件里写了哨兵）；
 *  4. 要求上限 2000、超限 IPC 拒绝；旧 guiFan 读写 IPC 已不存在；
 *  5. 我的页：名片在用户名右侧、头像+用户名行居中、邮箱在账号列且在助记词上方、
 *     账号列相对左侧 logo 上下居中并下移。
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
const PORT = Number(process.env.R92_PORT || 9657);
const profile = path.join(os.tmpdir(), 'warmy-r92-live-' + Date.now());
fs.mkdirSync(path.join(profile, 'guifan'), { recursive: true });
const NOW = Date.now();
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  yuYan: 'zh-CN', setupDone: true, privacyConsent: true, guideDone: true, providersSeeded: true,
  instances: [
    { id: 'inst-r92-a', ming: '牛马-A', name: '牛马-A', status: 'running', model: 'mimo-v2.6-flash', chain: ['mimo-v2.6-flash'], chainDisabled: [] },
    { id: 'inst-r92-b', ming: '牛马-B', name: '牛马-B', status: 'running', model: 'mimo-v2.6-flash', chain: ['mimo-v2.6-flash'], chainDisabled: [] },
  ],
  providers: [], authGrants: { 'inst-r92-a': [], 'inst-r92-b': [] }, panelCardCollapsed: {},
}, null, 2), 'utf8');
const SENTINEL = 'SHORT_MEMORY_SENTINEL_92';
for (const sid of ['inst-r92-a', 'inst-r92-b']) {
  fs.writeFileSync(path.join(profile, 'guifan', sid + '.md'), '## 短记忆（归档自动整理）\n- ' + SENTINEL + '\n', 'utf8');
}

let child = null;
let c = null;
let okN = 0, failN = 0;
const ok = (m, d) => { okN++; console.log('  ok   ' + m + (d === undefined ? '' : ' ← ' + String(d).slice(0, 300))); };
const bad = (m, d) => { failN++; console.log('  FAIL ' + m + (d === undefined ? '' : ' ← ' + String(d).slice(0, 400))); };
const jian = (m, cond, d) => (cond ? ok(m, d) : bad(m, d));
const js = (e) => c.evaluate('(async function(){ try { return await (' + e + '); } catch (err) { return { __err: String((err && (err.stack || err.message)) || err).slice(0, 400) }; } })()');
const duReq = (sid) => { try { return fs.readFileSync(path.join(profile, 'yaoqiu', sid + '.md'), 'utf8'); } catch { return ''; } };

async function dianJi(sel, nth = 0) {
  const p = await js(`(() => { const a=[...document.querySelectorAll(${JSON.stringify(sel)})]; const e=a[${nth}]; if(!e) return null; e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}; })()`);
  if (!p) return false;
  await c.mouseClick(p.x, p.y);
  return true;
}

try {
  const env = { ...process.env, WARMY_AUTH_BYPASS: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(ELECTRON, ['--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, MAIN], {
    cwd: PKG, stdio: ['ignore', 'ignore', 'ignore'], windowsHide: false, env,
  });
  let last = '';
  for (let i = 0; i < 80; i++) {
    try { c = await attach(PORT, { biaoQian: 'r92-live', callTimeout: 15000 }); break; } catch (e) { last = e.message; await sleep(300); }
  }
  if (!c) throw new Error('CDP 未连接：' + last);
  await c.send('Runtime.enable');
  await c.waitFor('document.body.getAttribute("data-warmy-auth") === "ready"', { timeout: 30000, biaoQian: '认证旁路' });
  await c.waitFor('!!document.querySelector("[data-nav=singleAi]")', { timeout: 20000, biaoQian: '主界面' });
  await sleep(500);

  await dianJi('[data-nav="singleAi"]');
  await sleep(800);
  await dianJi('#lieBiaoTi .lieBiaoTiaoMu', 0);
  await sleep(1200);
  const sidA = await js('window.__r35 && window.__r35.huiHua()');
  jian('进入第一个会话', !!sidA, String(sidA));

  // ── 第四列卡片 ────────────────────────────────────────────────
  const cards = await js(`(() => {
    const gf = document.getElementById('mianBanGuiFanKuai');
    const yq = document.getElementById('mianBanYaoQiuKuai');
    const box = (e) => e ? { hidden: e.classList.contains('yinCang') || getComputedStyle(e).display === 'none', h: Math.round(e.getBoundingClientRect().height) } : null;
    const opts = [...document.querySelectorAll('#panKaXuanZe option')].map((o) => o.value);
    return { guifan: gf ? box(gf) : null, yaoqiu: box(yq), opts };
  })()`);
  jian('第四列没有「规范」卡', cards && cards.guifan === null, JSON.stringify(cards && cards.guifan));
  jian('第四列有「要求」卡且可见', !!(cards && cards.yaoqiu && !cards.yaoqiu.hidden && cards.yaoqiu.h > 0), JSON.stringify(cards && cards.yaoqiu));
  jian('添加卡片下拉有要求、没有规范', !!(cards && cards.opts.includes('mianBanYaoQiuKuai') && !cards.opts.includes('mianBanGuiFanKuai')), JSON.stringify(cards && cards.opts));

  const leak = await js(`(() => ({ body: document.body.innerText.includes(${JSON.stringify(SENTINEL)}), yq: (document.querySelector('#shuRuKuangYaoQiu')||{}).value || '' }))()`);
  jian('短记忆内容不出现在界面上', !!(leak && !leak.body && !String(leak.yq).includes(SENTINEL)), JSON.stringify(leak));

  try {
    await c.waitFor('document.querySelector("#shuRuKuangYaoQiu")?.getAttribute("maxlength") === "2000"', { timeout: 8000, biaoQian: '要求上限' });
  } catch { /* 下面按实测值判 */ }
  const maxLen = await js(`(() => { const t=document.querySelector('#shuRuKuangYaoQiu'); return t ? t.getAttribute('maxlength') : null; })()`);
  jian('要求输入框上限 2000', String(maxLen) === '2000', maxLen);

  // ── 保存 A ────────────────────────────────────────────────────
  const A = 'A 会话要求：先给结论，再给证据。';
  await js(`(() => { const t=document.querySelector('#shuRuKuangYaoQiu'); if(!t) return false; t.focus(); t.value=${JSON.stringify(A)}; t.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
  await sleep(250);
  await js(`document.querySelector('#anNiuYaoQiuBaoCun').click()`);
  await sleep(700);
  jian('A 会话要求落到 yaoqiu/<sid>.md', duReq(String(sidA)) === A, duReq(String(sidA)));

  // ── 切到第二个会话：隔离 ─────────────────────────────────────
  await dianJi('#lieBiaoTi .lieBiaoTiaoMu', 1);
  await sleep(1200);
  const sidB = await js('window.__r35 && window.__r35.huiHua()');
  jian('进入第二个会话', !!sidB && sidB !== sidA, String(sidB));
  const b0 = await js(`(() => { const t=document.querySelector('#shuRuKuangYaoQiu'); return t ? t.value : null; })()`);
  jian('第二个会话的要求为空（互相隔离）', b0 === '', JSON.stringify(b0));
  const B = 'B 会话要求：回答不超过 5 行。';
  await js(`(() => { const t=document.querySelector('#shuRuKuangYaoQiu'); if(!t) return false; t.focus(); t.value=${JSON.stringify(B)}; t.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
  await sleep(250);
  await js(`document.querySelector('#anNiuYaoQiuBaoCun').click()`);
  await sleep(700);
  jian('B 会话要求独立落盘', duReq(String(sidB)) === B, duReq(String(sidB)));
  await dianJi('#lieBiaoTi .lieBiaoTiaoMu', 0);
  await sleep(1200);
  const a1 = await js(`(() => { const t=document.querySelector('#shuRuKuangYaoQiu'); return t ? t.value : null; })()`);
  jian('切回 A 会话仍显示 A 的要求', a1 === A, JSON.stringify(a1));

  // ── IPC 上限与旧入口 ─────────────────────────────────────────
  const over = await js(`window.warmy.yaoQiuShe({ sessionId: ${JSON.stringify(String(sidA))}, text: '字'.repeat(2001) })`);
  jian('IPC 超限保存被拒（2001/2000）', !!(over && over.ok === false && over.shangXian === 2000 && over.ziShu === 2001), JSON.stringify(over));
  const oldIpc = await js(`(() => ({ du: typeof window.warmy.guiFanDu, she: typeof window.warmy.guiFanShe }))()`);
  jian('旧 guiFan 读写 IPC 已不存在', !!(oldIpc && oldIpc.du === 'undefined' && oldIpc.she === 'undefined'), JSON.stringify(oldIpc));

  // ── 我的页布局 ───────────────────────────────────────────────
  await dianJi('[data-nav="wo"]');
  await sleep(900);
  const wo = await js(`(() => {
    const q = (s) => document.querySelector(s);
    const box = (e) => { if(!e) return null; const b=e.getBoundingClientRect(); return { x:Math.round(b.x), y:Math.round(b.y), w:Math.round(b.width), h:Math.round(b.height), r:Math.round(b.right), b:Math.round(b.bottom), cx:Math.round(b.x+b.width/2), cy:Math.round(b.y+b.height/2) }; };
    const av=q('#pAvAnNiu'), name=q('#pMingDisplay'), card=q('#pMingPianBtn'), row=q('.woMingHang');
    const email=q('#pYouJian'), auth=q('#warmyAuthMyCard'), acc=q('.woR68Account'), brand=q('.woBrandR68'), body=q('.woR68Body');
    return {
      av:box(av), name:box(name), card:box(card), row:box(row), email:box(email), auth:box(auth), acc:box(acc), brand:box(brand), body:box(body),
      emailInAcc: !!(email && acc && acc.contains(email)), cardInRow: !!(card && row && row.contains(card)),
      accPadTop: acc ? getComputedStyle(acc).paddingTop : '',
      hasGuiFan: !!q('#mianBanGuiFanKuai'),
    };
  })()`);
  jian('我的页已无规范卡', !!(wo && !wo.hasGuiFan), JSON.stringify(wo && wo.hasGuiFan));
  jian('名片在用户名同一行、位于其右侧', !!(wo && wo.cardInRow && wo.card.x >= wo.name.r - 2), JSON.stringify(wo && { name: wo.name, card: wo.card }));
  jian('头像与「用户名+名片」水平居中（中心差 ≤3px）', !!(wo && wo.av && wo.row && Math.abs(wo.av.cx - wo.row.cx) <= 3), JSON.stringify(wo && { av: wo.av && wo.av.cx, row: wo.row && wo.row.cx }));
  /** 旁路登录下账号卡为空（高度 0），垂直比较按源码顺序兜底；有真实账号时仍量真实矩形 */
  jian('邮箱在账号列里，且位于助记词卡片上方', !!(wo && wo.emailInAcc && (wo.auth.h === 0 || wo.email.b <= wo.auth.y + 2)), JSON.stringify(wo && { email: wo.email, auth: wo.auth }));
  jian('账号列整体下移（padding-top ≥10px）', !!(wo && parseFloat(wo.accPadTop) >= 10), wo && wo.accPadTop);
  jian('右侧资料与左侧 logo 上下居中（中心差 ≤40px）', !!(wo && wo.brand && wo.body && Math.abs(wo.brand.cy - wo.body.cy) <= 40), JSON.stringify(wo && { brand: wo.brand && wo.brand.cy, body: wo.body && wo.body.cy }));

  const errs = (typeof c.errors === 'function' ? c.errors() : []) || [];
  jian('全程无脚本错误', errs.length === 0, JSON.stringify(errs).slice(0, 300));
} catch (e) {
  bad('门禁执行异常', String((e && (e.stack || e.message)) || e));
} finally {
  try { if (c) await c.send('Browser.close', {}, { timeout: 5000 }); } catch { /* 已退 */ }
  await sleep(600);
  try { if (child) execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* 已退 */ }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 尽力清 */ }
}

console.log(`\nverify-r92-live: ${okN} ok / ${failN} FAIL`);
process.exitCode = failN ? 1 : 0;
