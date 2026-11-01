/**
 * verify-r94-ui-live —— 第 94 轮真机界面验收（Electron + CDP，临时 profile）。
 *
 * 覆盖：
 *  1. 首启语言页下方不再显示“当前选择的语言”；
 *  2. 右上角关闭热区变大（≥120px），鼠标进入热区就能看到叉；
 *  3. 关闭确认里的牛马 logo：腿 4 条 / 尾 / 头分包、步频与行进速度相关、
 *     尾巴周期跟随步频、头随机微动、从左往右移动、持续随机补新、返回后停止；
 *  4. 助记词确认弹窗的取消按钮写“返回”（而不是“取消”）；
 *  5. 未勾选「自动滚动聊天记录」时，用户手动滚动后，新回复不得改变滚动位置。
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
const ok = (m, d) => { okN++; console.log('  ok   ' + m + (d === undefined ? '' : ' ← ' + String(d).slice(0, 300))); };
const bad = (m, d) => { failN++; console.log('  FAIL ' + m + (d === undefined ? '' : ' ← ' + String(d).slice(0, 400))); };
const jian = (m, cond, d) => (cond ? ok(m, d) : bad(m, d));

let c = null, child = null;
let profile = '';
let shotPath = '';
const js = (e) => c.evaluate('(async function(){ try { return await (' + e + '); } catch (err) { return { __err: String((err && (err.stack || err.message)) || err).slice(0, 400) }; } })()');

async function dianJi(sel, nth = 0) {
  const p = await js(`(() => { const a=[...document.querySelectorAll(${JSON.stringify(sel)})]; const e=a[${nth}]; if(!e) return null; e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}; })()`);
  if (!p || p.__err) return false;
  await c.mouseClick(p.x, p.y);
  return true;
}

async function startElectron(port, prof, bypass) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  if (bypass) env.WARMY_AUTH_BYPASS = '1';
  child = spawn(ELECTRON, ['--remote-debugging-port=' + port, '--user-data-dir=' + prof, MAIN], {
    cwd: PKG, stdio: ['ignore', 'ignore', 'ignore'], windowsHide: false, env,
  });
  let last = '';
  for (let i = 0; i < 90; i++) {
    try { c = await attach(port, { biaoQian: 'r94-live', callTimeout: 20000 }); break; } catch (e) { last = e.message; await sleep(300); }
  }
  if (!c) throw new Error('CDP 未连接：' + last);
  await c.send('Runtime.enable');
}

async function stopElectron() {
  try { if (c) await c.send('Browser.close', {}, { timeout: 5000 }); } catch { /* 已退 */ }
  c = null;
  await sleep(700);
  try { if (child) execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* 已退 */ }
  child = null;
}

try {
  // ══════ A. 首启：语言页 / 关闭热区 / 牛马跑动 / 助记词返回 ══════
  profile = path.join(os.tmpdir(), 'warmy-r94-first-' + Date.now());
  fs.mkdirSync(profile, { recursive: true });
  await startElectron(Number(process.env.R94_PORT_A || 9677), profile, false);
  await c.waitFor('!!document.getElementById("warmyAuthLang")', { timeout: 35000, biaoQian: '首启语言页' });
  await sleep(400);
  await dianJi('[data-locale="zh-CN"]');
  await sleep(350);

  const lang = await js(`(() => {
    const foot = document.querySelector('.warmyAuthLangFoot');
    const start = document.getElementById('warmyAuthStart');
    return {
      footText: foot ? String(foot.innerText || '').trim() : null,
      startText: start ? String(start.textContent || '').trim() : null,
      hasPick: !!document.querySelector('.warmyAuthLangPick'),
      tiles: document.querySelectorAll('#warmyAuthLang .warmyAuthLangTile').length,
    };
  })()`);
  jian('语言页不再渲染“当前选择的语言”文字', !!(lang && !lang.hasPick), JSON.stringify(lang));
  jian('语言页底部只剩开始按钮', !!(lang && lang.footText === lang.startText && lang.startText), JSON.stringify(lang));
  jian('10 种语言仍全部可选', !!(lang && lang.tiles === 10), lang && lang.tiles);

  const vp = await js('({ w: innerWidth, h: innerHeight })');
  await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: vp.w - 28, y: 28 });
  await sleep(320);
  const hot = await js(`(() => {
    const hot = document.querySelector('.warmyAuthCloseHot');
    const x = document.getElementById('warmyAuthCloseX');
    if (!hot || !x) return null;
    const hb = hot.getBoundingClientRect(), xb = x.getBoundingClientRect();
    return { hotW: Math.round(hb.width), hotH: Math.round(hb.height), xW: Math.round(xb.width), xH: Math.round(xb.height), opacity: getComputedStyle(x).opacity };
  })()`);
  jian('右上角关闭热区 ≥120×120（原来 72×72）', !!(hot && hot.hotW >= 120 && hot.hotH >= 120), JSON.stringify(hot));
  jian('叉的点击目标 ≥42px（不是 34px 的小圈）', !!(hot && hot.xW >= 42 && hot.xH >= 42), JSON.stringify(hot));
  jian('鼠标进入大热区就显示叉（不是只有精确悬停叉本身）', !!(hot && Number(hot.opacity) >= 0.95), JSON.stringify(hot));

  await c.mouseClick(vp.w - 28, 28);
  await c.waitFor('document.getElementById("warmyAuthQuitMask")?.classList.contains("on")', { timeout: 5000, biaoQian: '关闭确认出现' });
  await sleep(700);
  const shot = path.join(os.tmpdir(), 'warmy-r94-quit-' + Date.now() + '.png');
  const snap = await c.snap(shot);
  if (snap && snap.ok) { shotPath = shot; console.log('  ..   截图：' + shot); }

  const h0 = await js(`(() => [...document.querySelectorAll('.warmyAuthQuitRunner')].map((el) => {
    const cs = getComputedStyle(el);
    const leg = el.querySelector('.qLeg');
    const tail = el.querySelector('.qTail');
    const head = el.querySelector('.qHead');
    const mv = el.getAnimations().find((a) => a.effect && a.effect.getKeyframes && a.effect.getKeyframes().length > 1);
    const dur = (s) => { const n = parseFloat(String(s || '0').split(',')[0]); return Number.isFinite(n) ? n * 1000 : 0; };
    return {
      id: el.dataset.qiId, left: Math.round(el.getBoundingClientRect().left), w: Math.round(el.getBoundingClientRect().width),
      step: parseFloat(cs.getPropertyValue('--step')), swing: String(cs.getPropertyValue('--swing') || ''),
      legDur: dur(getComputedStyle(leg).animationDuration),
      tailDur: dur(getComputedStyle(tail).animationDuration),
      headDur: dur(getComputedStyle(head).animationDuration),
      legAnim: getComputedStyle(leg).animationName,
      tailAnim: getComputedStyle(tail).animationName,
      headAnim: getComputedStyle(head).animationName,
      legTf: getComputedStyle(leg).transform,
      tailTf: getComputedStyle(tail).transform,
      travel: mv ? Number(mv.effect.getTiming().duration) : null,
      frames: mv ? mv.effect.getKeyframes().map((k) => String(k.transform || '')) : [],
      legs: el.querySelectorAll('.qLeg').length,
      tails: el.querySelectorAll('.qTail').length,
      heads: el.querySelectorAll('.qHead').length,
    };
  }))()`);
  jian('确认框里出现多只跑动的牛马 logo', !!(Array.isArray(h0) && h0.length >= 2), h0 && h0.length);
  jian('每只都有 4 条腿 / 1 条尾 / 1 个头（都能独立动）',
    !!(Array.isArray(h0) && h0.length && h0.every((x) => x.legs === 4 && x.tails === 1 && x.heads === 1)),
    JSON.stringify(h0 && h0.map((x) => ({ legs: x.legs, tails: x.tails, heads: x.heads }))));
  const ratios = (h0 || []).map((x) => (x.travel ? x.legDur / x.travel : 0));
  jian('步频跟随行进速度（腿周期/行进时长在 6%–13%）',
    !!(ratios.length && ratios.every((r) => r >= 0.06 && r <= 0.13)), JSON.stringify(ratios));
  jian('尾巴摆动周期 = 步频 ×2（跟着脚步快慢走）',
    !!(h0 && h0.length && h0.every((x) => x.step > 0 && Math.abs(x.tailDur - x.step * 2) <= Math.max(12, x.step * 0.05))),
    JSON.stringify(h0 && h0.map((x) => ({ step: x.step, tail: x.tailDur }))));
  jian('头部微动是随机时长（1.2s–3.6s，不固定）',
    !!(h0 && h0.length && h0.every((x) => x.headDur >= 1200 && x.headDur <= 3600)),
    JSON.stringify(h0 && h0.map((x) => x.headDur)));
  jian('每只牛马的速度/尺寸独立随机（不是同一个动画复制）',
    !!(h0 && new Set(h0.map((x) => x.step)).size >= 2 && new Set(h0.map((x) => x.travel)).size >= 2),
    JSON.stringify(h0 && h0.map((x) => ({ step: x.step, travel: x.travel, w: x.w }))));
  jian('路径真的是“从左往右”（每段的 x 递增，走完全程消失）',
    !!(h0 && h0.length && h0.every((x) => {
      const xs = x.frames.map((f) => { const m = f.match(/translate\((-?[\d.]+)px/); return m ? Number(m[1]) : NaN; }).filter(Number.isFinite);
      return xs.length >= 2 && xs.every((v, i) => i === 0 || v > xs[i - 1]);
    })), JSON.stringify(h0 && h0.map((x) => x.frames)));
  jian('腿/尾/头的动画真的挂在元素上（不是只写了时长）',
    !!(h0 && h0.length && h0.every((x) => /warmyAuthQuitLeg/.test(x.legAnim) && /warmyAuthQuitTail/.test(x.tailAnim) && /warmyAuthQuitHead/.test(x.headAnim))),
    JSON.stringify(h0 && h0.map((x) => ({ leg: x.legAnim, tail: x.tailAnim, head: x.headAnim }))));
  const tf0 = new Map((h0 || []).map((x) => [x.id, { leg: x.legTf, tail: x.tailTf }]));
  await sleep(300);
  const tf1 = await js(`(() => [...document.querySelectorAll('.warmyAuthQuitRunner')].map((el) => ({
    id: el.dataset.qiId,
    leg: getComputedStyle(el.querySelector('.qLeg')).transform,
    tail: getComputedStyle(el.querySelector('.qTail')).transform,
  })))()`);
  const legMoved = (tf1 || []).some((x) => tf0.has(x.id) && x.leg !== tf0.get(x.id).leg);
  const tailMoved = (tf1 || []).some((x) => tf0.has(x.id) && x.tail !== tf0.get(x.id).tail);
  jian('300ms 内腿与尾巴确实在摆（transform 真的变化）', legMoved && tailMoved,
    JSON.stringify({ legMoved, tailMoved, tf0: [...tf0.entries()].slice(0, 2), tf1: (tf1 || []).slice(0, 2) }));

  const ids0 = new Set((h0 || []).map((x) => x.id));
  const left0 = new Map((h0 || []).map((x) => [x.id, x.left]));
  await sleep(900);
  const h1 = await js(`(() => [...document.querySelectorAll('.warmyAuthQuitRunner')].map((el) => ({ id: el.dataset.qiId, left: Math.round(el.getBoundingClientRect().left) })))()`);
  const moved = (h1 || []).filter((x) => left0.has(x.id) && x.left > (left0.get(x.id) || 0) + 8);
  jian('900ms 内确实在往右移动', moved.length >= 1, JSON.stringify({ h0: h0 && h0.map((x) => [x.id, x.left]), h1 }));
  await sleep(900);
  const h2 = await js(`(() => [...document.querySelectorAll('.warmyAuthQuitRunner')].map((el) => el.dataset.qiId))()`);
  const newOnes = (h2 || []).filter((id) => !ids0.has(id));
  jian('从左持续随机补新（1.8s 内出现新 id）', newOnes.length >= 1, JSON.stringify({ ids0: [...ids0], h2 }));
  jian('同时最多 6 只（不会无限堆 DOM）', !!(h2 && h2.length <= 6), h2 && h2.length);

  await dianJi('#warmyAuthQuitBack');
  await c.waitFor('!document.getElementById("warmyAuthQuitMask")?.classList.contains("on")', { timeout: 4000, biaoQian: '返回界面' });
  await sleep(700);
  const stopped = await js('document.querySelectorAll(".warmyAuthQuitRunner").length');
  jian('点「返回界面」后动画与补新都停止（0 只残留）', stopped === 0, stopped);

  // 助记词确认弹窗：取消按钮应为「返回」
  await dianJi('#warmyAuthStart');
  await c.waitFor('!!document.getElementById("warmyAuthTermsBody")', { timeout: 10000, biaoQian: '条款页' });
  await js(`(() => { const b=document.getElementById('warmyAuthTermsBody'); b.scrollTop=b.scrollHeight; b.dispatchEvent(new Event('scroll')); return b.scrollTop; })()`);
  await sleep(3400);
  await c.waitFor('document.getElementById("warmyAuthTermsContinue") && !document.getElementById("warmyAuthTermsContinue").disabled', { timeout: 6000, biaoQian: '条款可继续' });
  await dianJi('#warmyAuthTermsContinue');
  await c.waitFor('!!document.querySelector("[data-auth-action=register-open]")', { timeout: 10000, biaoQian: '登录页' });
  await dianJi('[data-auth-action="register-open"]');
  await c.waitFor('!!document.querySelector("[data-auth-action=mnemonic-confirm]")', { timeout: 20000, biaoQian: '助记词页' });
  await dianJi('[data-auth-action="mnemonic-confirm"]');
  await c.waitFor('!!document.querySelector(".warmyAuthModal [data-modal=cancel]")', { timeout: 6000, biaoQian: '助记词确认弹窗' });
  const mnem = await js(`(() => {
    const m = document.querySelector('.warmyAuthModal');
    return { body: m ? String(m.querySelector('.warmyAuthModalBody')?.textContent || '') : '', cancel: m ? String(m.querySelector('[data-modal=cancel]')?.textContent || '').trim() : '' };
  })()`);
  jian('助记词确认弹窗显示的是“确定你已抄写两份…”', !!(mnem && mnem.body.includes('确定你已抄写两份')), mnem && mnem.body.slice(0, 80));
  jian('该弹窗的取消按钮已改名为「返回」', !!(mnem && mnem.cancel === '返回'), mnem && mnem.cancel);
  await dianJi('.warmyAuthModal [data-modal="cancel"]');
  await c.waitFor('!document.querySelector(".warmyAuthModal [data-modal=cancel]")', { timeout: 4000, biaoQian: '弹窗关闭' });

  const errsA = (typeof c.errors === 'function' ? c.errors() : []) || [];
  jian('首启全程无脚本错误', errsA.length === 0, JSON.stringify(errsA).slice(0, 300));

  await stopElectron();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 尽力清 */ }
  profile = '';

  // ══════ B. 聊天滚动：未勾选自动滚动，用户滚过之后程序不许抢 ══════
  profile = path.join(os.tmpdir(), 'warmy-r94-scroll-' + Date.now());
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
    yuYan: 'zh-CN', setupDone: true, privacyConsent: true, guideDone: true, providersSeeded: true,
    instances: [{ id: 'inst-r94-a', ming: '牛马-A', name: '牛马-A', status: 'running', model: 'mimo-v2.6-flash', chain: ['mimo-v2.6-flash'], chainDisabled: [] }],
    providers: [], authGrants: { 'inst-r94-a': [] }, panelCardCollapsed: {},
  }, null, 2), 'utf8');
  await startElectron(Number(process.env.R94_PORT_B || 9678), profile, true);
  await c.waitFor('!!document.querySelector("[data-nav=singleAi]")', { timeout: 30000, biaoQian: '主界面' });
  await sleep(600);
  await dianJi('[data-nav="singleAi"]');
  await sleep(700);
  await dianJi('#lieBiaoTi .lieBiaoTiaoMu', 0);
  await sleep(1000);
  const sid = await js('window.__r35 && window.__r35.huiHua()');
  jian('已进入会话', !!sid, sid);

  const auto = await js(`(() => { const el = document.getElementById('caiDanTuBiaoAutoscroll'); return el ? el.getAttribute('aria-checked') : null; })()`);
  jian('「自动滚动聊天记录」默认未勾选', String(auto) === 'false', auto);

  await js(`(() => {
    for (let i = 0; i < 40; i++) window.__r35.tian({ role: i % 2 ? 'them' : 'wo', text: '第 ' + i + ' 条消息 · ' + '内容'.repeat(30), ts: Date.now() + i });
    return true;
  })()`);
  await sleep(500);
  await js('window.__r35.chongHuaQuan()');
  await sleep(400);
  const box = await js(`(() => { const h = document.getElementById('xiaoXiJi'); return h ? { sh: h.scrollHeight, ch: h.clientHeight, top: h.scrollTop } : null; })()`);
  jian('聊天区已可滚动（夹具足够长）', !!(box && box.sh > box.ch + 300), JSON.stringify(box));

  const up = await js(`(() => {
    const h = document.getElementById('xiaoXiJi');
    h.scrollTop = Math.round((h.scrollHeight - h.clientHeight) * 0.35);
    h.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true }));
    return h.scrollTop;
  })()`);
  await sleep(250);
  const beforeUp = await js('document.getElementById("xiaoXiJi").scrollTop');
  await js(`(() => {
    const sid = window.__r35.huiHua();
    window.__msgs[sid].push({ role: 'them', text: '新回复 A：' + '新内容'.repeat(40), ts: Date.now() });
    return window.__r35.chongHuaQuan();
  })()`);
  await sleep(350);
  const afterUp = await js('document.getElementById("xiaoXiJi").scrollTop');
  jian('用户上滚后，新回复不改变滚动位置（不是被打回顶部）', Math.abs(afterUp - beforeUp) <= 1 && afterUp > 0,
    JSON.stringify({ beforeUp, afterUp, set: up }));

  const down = await js(`(() => {
    const h = document.getElementById('xiaoXiJi');
    h.scrollTop = Math.min(h.scrollHeight - h.clientHeight, ${Number(beforeUp) + 260});
    h.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true }));
    return h.scrollTop;
  })()`);
  await sleep(250);
  const beforeDown = await js('document.getElementById("xiaoXiJi").scrollTop');
  await js(`(() => {
    const sid = window.__r35.huiHua();
    window.__msgs[sid].push({ role: 'them', text: '新回复 B：' + '更多内容'.repeat(40), ts: Date.now() + 1 });
    return window.__r35.chongHuaQuan();
  })()`);
  await sleep(350);
  const afterDown = await js('document.getElementById("xiaoXiJi").scrollTop');
  jian('用户下滚后，新回复同样不改变滚动位置', Math.abs(afterDown - beforeDown) <= 1 && afterDown > 0,
    JSON.stringify({ beforeDown, afterDown, set: down }));

  const errsB = (typeof c.errors === 'function' ? c.errors() : []) || [];
  jian('滚动验收全程无脚本错误', errsB.length === 0, JSON.stringify(errsB).slice(0, 300));
} catch (e) {
  bad('门禁执行异常', String((e && (e.stack || e.message)) || e));
} finally {
  await stopElectron();
  if (profile) { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 尽力清 */ } }
  // 全绿就不留截图；有红时保留现场
  if (shotPath && failN === 0) { try { fs.rmSync(shotPath, { force: true }); } catch { /* 尽力清 */ } }
}

console.log(`\nverify-r94-ui-live: ${okN} ok / ${failN} FAIL`);
process.exitCode = failN ? 1 : 0;
