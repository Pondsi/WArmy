/**
 * verify-r70-budget-name —— 牛马管理局预算滑杆 + 我的页名称落盘/称呼提示词
 *
 * 真 Electron + CDP（临时 profile，WARMY_AUTH_BYPASS=1）：
 *  · 牛马管理局的上下文预算必须是和聊天框同一个 range 滑杆（class 同名），默认 60%；
 *  · 滑杆下限保证不少于 32K 词元（32K 窗口时下限 100%）；移动后落盘并回读；
 *  · 我的页改名（含内部空格）必须 profileSave 落盘，reload 后仍是新名字；
 *  · 提示词有 llm.userCallRule，且 zh-CN 身份锚不再写“老板是称呼”。
 * 静态：滑杆/名称修复代码存在，10 语言都有 userCallRule。
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
const SRC = path.join(PKG, 'src');
const { attach, sleep } = await import(pathToFileURL(path.join(PKG, 'scripts', 'cdp-lib.mjs')).href);
const PORT = Number(process.env.R70_BN_PORT || 9642);
const profile = path.join(os.tmpdir(), 'warmy-r70-bn-' + Date.now());
fs.mkdirSync(profile, { recursive: true });
const bigId = 'i-r70-big';
const smallId = 'i-r70-small';
const bigName = '大窗牛马';
const smallName = '小窗牛马';
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  yuYan: 'zh-CN', setupDone: true, privacyConsent: true, guideDone: true,
  contextBudgetPercent: 60,
  providers: [],
  instances: [
    { id: bigId, ming: bigName, name: bigName, model: 'deepseek-chat', defaultModel: 'deepseek-chat', status: 'stopped', notify: true, dutyEligible: true },
    { id: smallId, ming: smallName, name: smallName, model: 'qwen3.8-27b', defaultModel: 'qwen3.8-27b', status: 'stopped', notify: true, dutyEligible: true },
  ],
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
  console.log('  FAIL ' + name + (detail === undefined ? '' : ' ← ' + String(detail).slice(0, 600)));
};
const js = (e) => c.evaluate('(async function(){ try { return await (' + e + '); } catch (err) { return { __err: String((err && (err.stack || err.message)) || err).slice(0, 300) }; } })()');
const rd = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };

async function guan() {
  try { if (c) await c.send('Browser.close', {}, { timeout: 6000 }); } catch { /* 已退 */ }
  await sleep(700);
  try { process.kill(child.pid, 0); execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* 已退 */ }
}

async function setRange(sel, value) {
  await c.evaluate(`(() => {
    const e = document.querySelector(${JSON.stringify(sel)});
    if (!e) return false;
    const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    s.call(e, ${JSON.stringify(String(value))});
    e.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
}

/** 详情入口已从“牛马管理局”页迁到右键实例 → 设置弹窗（第 98 轮）。 */
async function openInstance(name, windowTokens) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const nav = await c.clickUntil('.ceLanTiaoMu[data-nav="singleAi"]', '!!document.querySelector("#lieBiaoTi .lieBiaoTiaoMu")', { timeout: 8000, tries: 4 });
    if (!nav.ok) { await sleep(300); continue; }
    const ctx = await c.evaluate(`(() => {
      const r = [...document.querySelectorAll('#lieBiaoTi .lieBiaoTiaoMu')].find((e) => e.innerText.includes(${JSON.stringify(name)}));
      if (!r) return false;
      const b = r.getBoundingClientRect();
      r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: Math.round(b.left + 20), clientY: Math.round(b.top + 20) }));
      return true;
    })()`);
    if (!ctx) { await sleep(300); continue; }
    try {
      await c.waitFor('!!document.querySelector("#shangXiaWenCaiDan")', { timeout: 4000 });
      const clicked = await c.evaluate(`(() => {
        const b = [...document.querySelectorAll('#shangXiaWenCaiDan button')].find((x) => x.textContent.trim() === '设置');
        if (!b) return false;
        b.click();
        return true;
      })()`);
      if (!clicked) { await sleep(300); continue; }
      await c.waitFor(`document.querySelector('#iCtxBudget')?.dataset.ctxWindow === '${windowTokens}' && (document.querySelector('#iCtxBudget')?.getBoundingClientRect().width || 0) > 120`, { timeout: 5000 });
      return true;
    } catch { await sleep(300); }
  }
  return false;
}

async function closeInstanceSettings() {
  try {
    await c.evaluate(`(() => { const b = [...document.querySelectorAll('#duiHuaKuangDongZuoJi button')].find((x) => x.textContent.trim() === '关闭'); if (b) b.click(); return true; })()`);
    await sleep(300);
  } catch { /* noop */ }
}

try {
  // ── 静态：代码与 10 语言 ─────────────────────────────────────────
  const appJs = rd(path.join(SRC, 'renderer/app.js'));
  const mainTs = rd(path.join(SRC, 'electron-main.ts'));
  const zh = JSON.parse(rd(path.join(SRC, 'i18n/zh-CN.json')) || '{}');
  const packs = ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko', 'ru', 'es', 'fr', 'pt', 'eo'];
  jian('我的页改名会调用 profileSave 落盘（不是只改内存）',
    /const commitName = \(\) => \{[\s\S]{0,700}?saveProfile\(\)/.test(appJs));
  jian('提示词有名称优先规则：10 语言都有 llm.userCallRule，且主进程真的注入',
    packs.every((l) => {
      try { const j = JSON.parse(rd(path.join(SRC, 'i18n', l + '.json'))); return typeof j['llm.userCallRule'] === 'string' && j['llm.userCallRule'].includes('{u}'); } catch { return false; }
    })
    && /llm\.userCallRule/.test(mainTs) && /dangQianYongHuMing\(\)/.test(mainTs));
  jian('zh-CN 身份锚不再把“老板”当成称呼',
    typeof zh['llm.identityAnchor'] === 'string'
    && !/用户是你的老板|他是老板/.test(zh['llm.identityAnchor'])
    && zh['llm.identityAnchor'].includes('服务对象'));
  jian('牛马管理局预算用同一个 range 滑杆类，且绑定函数存在',
    /id="iCtxBudget"[^>]*class="shangXiaWenSlider"[^>]*type="range"/.test(appJs)
    && /function bindInstanceCtxBudget\(inst\)/.test(appJs)
    && /bindInstanceCtxBudget\(inst\);/.test(appJs)
    && !/<input id="iCtxBudget" type="number"/.test(appJs));
  jian('32K 下限与副身预算已进入主进程请求窗口',
    /Math\.ceil\(32768 \/ maxTokens \* 100\)/.test(appJs)
    && /zuiDaQingQiuZi: xiaoDiSuan\.chars/.test(mainTs)
    && /percentOverride/.test(mainTs));

  // ── 真机 ────────────────────────────────────────────────────────
  let last = '';
  for (let i = 0; i < 60; i++) {
    try { c = await attach(PORT, { biaoQian: 'r70-bn', callTimeout: 12000 }); break; } catch (e) { last = e.message; await sleep(300); }
  }
  if (!c) throw new Error('CDP 未连接：' + last);
  await c.send('Runtime.enable');
  await c.send('Page.enable');
  try {
    await c.waitFor('!!document.querySelector(".ceLanTiaoMu[data-nav=singleAi]")', { timeout: 30000, biaoQian: '主界面' });
  } catch (e) {
    const d = await js(`(() => ({ url: location.href, title: document.title, body: (document.body?.innerText || '').slice(0, 400), html: (document.body?.innerHTML || '').slice(0, 300) }))()`);
    console.log('DIAG', JSON.stringify(d));
    console.log('BOOT', rd(path.join(profile, 'warmy-boot.log')).slice(-1200));
    throw e;
  }
  await c.waitFor('document.body.getAttribute("data-warmy-auth") === "ready"', { timeout: 15000, biaoQian: '认证旁路完成' });
  await sleep(400);

  // 牛马管理局：先回「我的牛马」，再点列表头的管理局图标（不是左侧导航）
  const openedBig = await openInstance(bigName, '1000000');
  jian('打开大窗牛马详情', openedBig === true);
  await c.waitFor('!!document.querySelector("#iCtxBudget")', { timeout: 8000, biaoQian: '大窗牛马预算滑杆' });
  await sleep(200);
  const big = await js(`(() => {
    const s = document.querySelector('#iCtxBudget');
    const b = s.getBoundingClientRect();
    return {
      tag: s.tagName, type: s.type, cls: s.className, min: s.min, max: s.max, step: s.step, value: s.value,
      pct: document.querySelector('#iCtxBudgetPct')?.textContent.trim() || '',
      tokens: document.querySelector('#iCtxBudgetTokens')?.textContent.trim() || '',
      minHint: document.querySelector('#iCtxBudgetMin')?.textContent.trim() || '',
      samePaper: !!s.closest('.modelZiXiang')?.querySelector('.shangXiaWenPopYuanShuju'),
      minHintCls: !!s.closest('.modelZiXiang')?.querySelector('.shangXiaWenPopMin'),
      width: Math.round(b.width), numberInput: !!s.closest('.modelZiXiang')?.querySelector('input[type=number]'),
      window: s.dataset.ctxWindow || '', minPct: s.dataset.ctxMin || '',
    };
  })()`);
  jian('预算控件是聊天框同款 range 滑杆（同 class、无数字输入框）',
    big && big.tag === 'INPUT' && big.type === 'range' && /shangXiaWenSlider/.test(big.cls)
    && big.samePaper && big.minHintCls && big.numberInput === false && big.width > 120,
    JSON.stringify(big));
  jian('大窗模型默认 60%，显示百分比与词元，且不低于 32K',
    big && big.value === '60' && big.pct === '60%' && Number(big.window) > 100000
    && Number(big.minPct) * Number(big.window) / 100 >= 32768,
    JSON.stringify({ value: big && big.value, pct: big && big.pct, window: big && big.window, minPct: big && big.minPct, tokens: big && big.tokens }));

  await setRange('#iCtxBudget', 20);
  await sleep(300);
  const afterMove = await js(`(() => ({ value: document.querySelector('#iCtxBudget')?.value, pct: document.querySelector('#iCtxBudgetPct')?.textContent.trim(), tokens: document.querySelector('#iCtxBudgetTokens')?.textContent.trim() }))()`);
  let saved = null;
  for (let i = 0; i < 10; i++) {
    await sleep(350);
    saved = await js(`(async () => { const r = await window.warmy.settingsGet(); const x = (r?.settings?.instances || []).find((i) => i.id === ${JSON.stringify(bigId)}); return { value: x?.contextBudgetPercent, all: r?.settings?.instances?.map((i) => ({ id: i.id, v: i.contextBudgetPercent })) }; })()`);
    if (saved && Number(saved.value) === 20) break;
  }
  jian('移动滑杆即时更新百分比/词元并落盘到该牛马',
    afterMove && afterMove.value === '20' && afterMove.pct === '20%' && saved && Number(saved.value) === 20,
    JSON.stringify({ afterMove, saved }));

  // 32K 窗口实例：先关设置弹窗，再回「我的牛马」→ 详情
  await closeInstanceSettings();
  const openedSmall = await openInstance(smallName, '32768');
  jian('打开小窗牛马详情', openedSmall === true);
  await sleep(200);
  const small = await js(`(() => {
    const s = document.querySelector('#iCtxBudget');
    return { min: s.min, value: s.value, pct: document.querySelector('#iCtxBudgetPct')?.textContent.trim(), tokens: document.querySelector('#iCtxBudgetTokens')?.textContent.trim(), window: s.dataset.ctxWindow, minHint: document.querySelector('#iCtxBudgetMin')?.textContent.trim() };
  })()`);
  jian('32K 窗口时滑杆下限 100%，预算不少于 32K（不会被 60% 压到 19.2K）',
    small && small.window === '32768' && small.min === '100' && small.value === '100' && small.pct === '100%'
    && /32768|32,?768|32K/i.test(small.tokens),
    JSON.stringify(small));

  // 我的页改名（先关掉实例设置弹窗）
  await closeInstanceSettings();
  await c.clickUntil('.ceLanTiaoMu[data-nav="wo"]', '!!document.querySelector("#pMingDisplay")', { timeout: 8000, tries: 4 });
  await c.clickSelector('#pMingDisplay');
  await sleep(150);
  await c.evaluate(`(() => {
    const e = document.querySelector('#pMing');
    e.focus();
    const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    s.call(e, '列   表');
    e.dispatchEvent(new Event('input', { bubbles: true }));
    // 与用户点开名称输入框再点走等价：触发 onblur 的提交逻辑
    e.dispatchEvent(new Event('blur'));
    return true;
  })()`);
  await sleep(1000);
  const prof = await js(`(async () => { const r = await window.warmy.profileGet(); return { name: r?.profile?.username || '', shown: document.querySelector('#pMingDisplay')?.textContent.trim() || '' }; })()`);
  jian('我的页改名“列   表”会保存到 profile（牛马提示词读同一份）',
    prof && prof.name === '列   表' && prof.shown === '列   表', JSON.stringify(prof));
  await js(`location.reload()`);
  await c.waitFor('!!document.querySelector(".ceLanTiaoMu[data-nav=wo]")', { timeout: 20000, biaoQian: '重载后主界面' });
  await c.waitFor('document.body.getAttribute("data-warmy-auth") === "ready"', { timeout: 15000, biaoQian: '重载后认证旁路' });
  await c.clickUntil('.ceLanTiaoMu[data-nav="wo"]', '!!document.querySelector("#pMingDisplay")', { timeout: 8000, tries: 4 });
  const afterReload = await js(`document.querySelector('#pMingDisplay')?.textContent.trim() || ''`);
  jian('reload 后我的页仍显示保存的名称（不是老板）',
    afterReload === '列   表', afterReload);

  const errors = c.errors();
  jian('全流程无脚本/控制台错误', errors.length === 0, JSON.stringify(errors));
} catch (e) {
  hong.push('未捕获异常');
  console.log('  FAIL 未捕获异常 ← ' + String((e && (e.stack || e.message)) || e).slice(0, 800));
} finally {
  try { await guan(); } catch { /* noop */ }
  await sleep(300);
  if (hong.length) console.log('KEEP_PROFILE', profile);
  else try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
}
console.log(`\n==== verify-r70-budget-name：${ok} ok / ${hong.length} FAIL ====`);
process.exit(hong.length ? 1 : 0);
