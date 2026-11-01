/**
 * verify-r68-auth-ui —— 第 68 轮认证流程真机门禁（临时 profile）
 *
 * 覆盖本轮验收反馈：
 *  · 语言页无国旗、选择框更短；
 *  · 条款页无提示/勾选框；滚到底后还要等 3 秒，“同意并继续”才可点；
 *  · 入口页无品牌/标题；无账号时只有“使用助记词登录 / 注册新账号”；
 *  · 注册直接进入助记词页（无“创建助记词账号”介绍页），助记词页无品牌/标题，带返回按钮；
 *  · 简体中文默认勾选中文友好型；词组 24 格、成语 12 格（每格 2 个索引）；拼音连写无空格/数字/连字符；
 *  · 词组/成语是切换开关（role=switch）；
 *  · 恢复页无品牌、标题“请输入助记词”，24 个带序号独立输入格；能用注册时的 24 词完成恢复；
 *  · PIN 提示统一为“更改设备的硬件，或者系统升级都有可能导致PIN失效…”（勾不勾自动登录都一样）；
 *  · 正文与确认弹层为新定稿文案；
 *  · 用户名页去掉说明和“称呼”标签；
 *  · 完成注册后登出，登录页无品牌/标题，有 PIN + 登录按钮 + 两个入口。
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
const PORT = Number(process.env.R68_AUTH_PORT || 9640);
const profile = path.join(os.tmpdir(), 'warmy-r68-auth-ui-' + Date.now());
fs.mkdirSync(profile, { recursive: true });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.WARMY_AUTH_BYPASS;
const child = spawn(ELECTRON, ['--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, MAIN], {
  cwd: PKG, stdio: ['ignore', 'ignore', 'ignore'], env,
});

let c = null;
let regWords = null;
let ok = 0;
const hong = [];
const jian = (name, pass, detail) => {
  if (pass) { ok += 1; console.log('  ok   ' + name); return; }
  hong.push(name);
  console.log('  FAIL ' + name + (detail === undefined ? '' : ' ← ' + String(detail).slice(0, 320)));
};
const js = (e) => c.evaluate('(async function(){ try { return await (' + e + '); } catch (err) { return { __err: String((err && (err.stack || err.message)) || err).slice(0, 300) }; } })()');

/**
 * 登录/改 PIN/注销会封存数据仓库并 app.relaunch（清内存密钥）。
 * 旧 CDP 连接随旧进程断开；等旧连接真的失效后，重连同一调试端口，再等新页面条件成立。
 * 不能用“页面上先看到登录页”就返回：重启会在几百毫秒后把它打断。
 */
async function followRelaunch(biaoQian, cond, timeout = 30000) {
  const jin = Date.now() + 8000;
  while (Date.now() < jin) {
    try { await c.evaluate('1'); } catch { break; }
    await sleep(200);
  }
  c = null;
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const nc = await attach(PORT, { biaoQian: 'r68-auth-' + biaoQian, callTimeout: 12000 });
      await nc.send('Runtime.enable');
      if (await nc.evaluate('(' + cond + ')')) { c = nc; return; }
      c = nc;
    } catch { /* 新进程还没起来 */ }
    await sleep(400);
  }
  throw new Error(biaoQian + '：重启后页面条件未成立');
}

/** “我的”页可能被网络配置读取/卡片弹窗触发重绘；确保导航在 wo、账号卡已挂载且相机勾选框可见。 */
async function ensureMyCard() {
  for (let i = 0; i < 3; i++) {
    const ok = await c.evaluate('(document.querySelector("#warmyMyAuto")?.getBoundingClientRect().width || 0) > 0');
    if (ok) return;
    await c.evaluate(`document.querySelector('[data-nav="wo"]')?.click()`);
    await sleep(250);
    await c.evaluate(`window.__warmyAuthGate.decorateMyPage()`);
    await sleep(350);
  }
  await c.waitFor('!!document.querySelector(".woDingR68") && !!document.querySelector("#warmyAuthMyCard .warmyAuthMyButtons")', { timeout: 8000, biaoQian: '我的页账号卡重挂载' });
  await c.evaluate(`window.__warmyAuthGate.decorateMyPage()`);
  await c.waitFor('(document.querySelector("#warmyMyAuto")?.getBoundingClientRect().width || 0) > 0', { timeout: 8000, biaoQian: '自动登录勾选框可见' });
}

async function guan() {
  try { if (c) await c.send('Browser.close', {}, { timeout: 6000 }); } catch { /* 已退 */ }
  await sleep(700);
  try { process.kill(child.pid, 0); execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* 已退 */ }
}

try {
  let last = '';
  for (let i = 0; i < 60; i++) {
    try { c = await attach(PORT, { biaoQian: 'r68-auth', callTimeout: 12000 }); break; } catch (e) { last = e.message; await sleep(300); }
  }
  if (!c) throw new Error('CDP 未连接：' + last);
  await c.send('Runtime.enable');
  await c.send('Page.enable');
  await c.waitFor('!!document.querySelector("#warmyAuthStart")', { timeout: 20000, biaoQian: '首启语言页' });
  await sleep(250);

  const lang = await js(`(() => ({
    flags: document.querySelectorAll('.warmyAuthFlag').length,
    options: document.querySelectorAll('[data-auth-action="lang-pick"]').length,
    card: (() => { const b = document.querySelector('.warmyAuthFirstCard').getBoundingClientRect(); return { w: b.width, h: b.height }; })(),
    start: document.querySelector('#warmyAuthStart')?.textContent.trim(),
    brand: !!document.querySelector('.warmyAuthBrand'),
  }))()`);
  jian('语言页无国旗、10 个平铺语言块、卡片 ≤ 380px', lang && lang.flags === 0 && lang.options === 10 && lang.card.w <= 380, JSON.stringify(lang));

  await c.clickUntil('#warmyAuthStart', '!!document.querySelector("#warmyAuthTermsBody")', { timeout: 6000 });
  await sleep(150);
  const terms0 = await js(`(() => ({
    checkbox: !!document.querySelector('#warmyAuthTermsAgree'),
    hint: /滚动到条款底部并等待/.test(document.body.innerText),
    disabled: document.querySelector('#warmyAuthTermsContinue')?.disabled,
  }))()`);
  jian('条款页无勾选框、无旧提示，继续按钮初始禁用', terms0 && terms0.checkbox === false && terms0.hint === false && terms0.disabled === true, JSON.stringify(terms0));
  await js(`(() => { const b=document.querySelector('#warmyAuthTermsBody'); b.scrollTop=b.scrollHeight; b.dispatchEvent(new Event('scroll')); return b.scrollTop; })()`);
  await sleep(300);
  const terms1 = await js(`document.querySelector('#warmyAuthTermsContinue')?.disabled`);
  jian('刚滚到底时按钮仍禁用（3 秒从到达底部开始计时）', terms1 === true, String(terms1));
  await sleep(2900);
  const terms2 = await js(`document.querySelector('#warmyAuthTermsContinue')?.disabled`);
  jian('滚到底满 3 秒后“同意并继续”可点击', terms2 === false, String(terms2));

  await c.clickUntil('#warmyAuthTermsContinue', '!!document.querySelector("[data-auth-action=register-open]")', { timeout: 6000 });
  await sleep(200);
  const entry = await js(`(() => ({
    brand: !!document.querySelector('.warmyAuthBrand'), title: !!document.querySelector('.warmyAuthTitle'),
    registerIntro: /创建助记词账号/.test(document.body.innerText),
    pin: !!document.querySelector('#warmyAuthPin'), pinDisabled: document.querySelector('#warmyAuthPin')?.disabled === true,
    pinBtnDisabled: document.querySelector('[data-auth-action="login-pin"]')?.disabled === true,
    hint: /此设备还没有账号/.test(document.body.innerText),
    buttons: [...document.querySelectorAll('[data-auth-action]')].map(e=>[e.getAttribute('data-auth-action'), e.textContent.trim()]).filter(x=>x[0]==='recover-open'||x[0]==='register-open'),
  }))()`);
  jian('无账号入口页无品牌/标题、没有“创建助记词账号”介绍页',
    entry && entry.brand === false && entry.title === false && entry.registerIntro === false, JSON.stringify(entry));
  jian('无账号入口也显示 PIN 输入+登录按钮（置灰）并提示先注册',
    entry && entry.pin === true && entry.pinDisabled === true && entry.pinBtnDisabled === true && entry.hint === true, JSON.stringify(entry));
  jian('入口页只有“使用助记词登录 / 注册新账号”两个按钮',
    entry && entry.buttons.length === 2
    && entry.buttons.some((x) => x[1] === '使用助记词登录') && entry.buttons.some((x) => x[1] === '注册新账号'), JSON.stringify(entry && entry.buttons));

  // 恢复页：无品牌、新标题、旧说明与整块输入框都已删除，24 个带序号的独立输入格。

  await c.clickUntil('[data-auth-action="recover-open"]', '!!document.querySelector(".warmyAuthRecoveryGrid")', { timeout: 6000 });
  await sleep(150);
  const rec = await js(`(() => {
    const cells = [...document.querySelectorAll('.warmyAuthRecoveryCell')];
    const inputs = [...document.querySelectorAll('[data-recovery-index]')];
    return {
      brand: !!document.querySelector('.warmyAuthBrand'),
      title: document.querySelector('.warmyAuthTitle')?.textContent.trim() || '',
      oldBody: /输入 24 词英文助记词/.test(document.body.innerText),
      oldInput: !!document.querySelector('#warmyAuthRecoveryPhrase') || !!document.querySelector('#warmyAuthCard textarea'),
      cells: cells.length, inputs: inputs.length,
      indices: [...document.querySelectorAll('.warmyAuthRecoveryCell .warmyAuthWordIndex')].map((e) => e.textContent.trim()),
      empty: inputs.every((e) => e.value === ''),
      back: document.querySelector('[data-auth-action="recover-back"]')?.textContent.trim() || '',
      verify: document.querySelector('[data-auth-action="recover-verify"]')?.textContent.trim() || '',
    };
  })()`);
  jian('恢复页无品牌、标题为“请输入助记词”、旧说明整块删除',
    rec && rec.brand === false && rec.title === '请输入助记词' && rec.oldBody === false && rec.oldInput === false && rec.back === '返回' && rec.verify === '验证助记词',
    JSON.stringify({ brand: rec && rec.brand, title: rec && rec.title, oldBody: rec && rec.oldBody, oldInput: rec && rec.oldInput, back: rec && rec.back, verify: rec && rec.verify }));
  jian('恢复页是 24 个带序号(1–24)的独立输入格，不再是整块输入',
    rec && rec.cells === 24 && rec.inputs === 24 && rec.empty === true
    && rec.indices.join(',') === Array.from({ length: 24 }, (_, i) => String(i + 1)).join(','),
    JSON.stringify({ cells: rec && rec.cells, inputs: rec && rec.inputs, indices: rec && rec.indices.slice(0, 5) }));
  await c.clickUntil('[data-auth-action="recover-group"][data-group="4"]', 'document.querySelectorAll(".warmyAuthRecoveryPair").length === 12', { timeout: 4000 });
  const pairView = await js(`(() => ({ groups: document.querySelectorAll('.warmyAuthRecoveryPair').length, inputs: document.querySelectorAll('[data-recovery-index]').length, indices: [...document.querySelectorAll('.warmyAuthRecoveryPair .warmyAuthWordIndex')].map((e) => e.textContent.trim()).slice(0, 3) }))()`);
  jian('恢复页成语开关：12 组（每组两格）、共 24 个输入、序号 1-2/3-4',
    pairView && pairView.groups === 12 && pairView.inputs === 24 && pairView.indices.join(',') === '1-2,3-4,5-6', JSON.stringify(pairView));
  await c.clickUntil('[data-auth-action="recover-group"][data-group="2"]', 'document.querySelectorAll(".warmyAuthRecoveryCell").length === 24', { timeout: 4000 });
  await c.clickUntil('[data-auth-action="recover-back"]', '!!document.querySelector("[data-auth-action=register-open]")', { timeout: 6000 });
  jian('恢复页的返回按钮回到登录界面', await js(`!!document.querySelector('#warmyAuthPin') && !document.querySelector('.warmyAuthRecoveryGrid')`));

  await c.clickUntil('[data-auth-action="register-open"]', '!!document.querySelector(".warmyAuthMnemonic")', { timeout: 6000 });
  await sleep(200);
  const mn = await js(`(() => {
    const cells = [...document.querySelectorAll('.warmyAuthMnemonic .warmyAuthWord')];
    return {
      brand: !!document.querySelector('.warmyAuthBrand'), title: !!document.querySelector('.warmyAuthTitle'),
      checked: document.querySelector('[data-auth-action="toggle-pinyin"]')?.checked === true,
      groups: cells.length,
      indices: cells.map((e) => e.querySelector('.warmyAuthWordIndex')?.textContent.trim() || ''),
      words: cells.map((e) => e.querySelector('.warmyAuthWordText')?.textContent.trim() || ''),
      pinyins: cells.map((e) => e.querySelector('.warmyAuthWordPinyin')?.textContent.trim() || ''),
      toggleTexts: [...document.querySelectorAll('[data-auth-action="pinyin-group"]')].map((e) => e.textContent.trim()),
      toggleRole: document.querySelector('.warmyAuthPinyinToggle')?.getAttribute('role') || '',
      back: !!document.querySelector('[data-auth-action="login-back"]'),
      body: document.querySelector('.warmyAuthWarn')?.textContent || '',
      createIntro: /创建助记词账号/.test(document.body.innerText),
      oldInput: !!document.querySelector('#warmyAuthRecoveryPhrase'),
    };
  })()`);
  const isTwoWord = (w) => Array.from(w).length === 2 && /^[\u4e00-\u9fff]+$/.test(w);
  jian('注册直达助记词页且无品牌/标题，有返回登录按钮', mn && mn.brand === false && mn.title === false && mn.createIntro === false && mn.back === true, JSON.stringify({ brand: mn && mn.brand, title: mn && mn.title, back: mn && mn.back }));
  jian('简体中文默认中文友好型：24 个格子、1–24 序号、每个都是真实两字词',
    mn && mn.checked === true && mn.groups === 24
    && mn.indices.join(',') === Array.from({ length: 24 }, (_, i) => String(i + 1)).join(',')
    && mn.words.every(isTwoWord), JSON.stringify({ checked: mn && mn.checked, groups: mn && mn.groups, words: mn && mn.words.slice(0, 4) }));
  jian('中文友好型拼音无空格/数字/连字符，且每格都有真实读音',
    mn && mn.pinyins.length === 24 && mn.pinyins.every((p) => /^[a-z]+$/.test(p)), JSON.stringify((mn && mn.pinyins || []).slice(0, 8)));
  jian('词组/成语是切换开关（role=switch，左词组右成语）',
    mn && mn.toggleRole === 'switch' && mn.toggleTexts.length === 2
    && mn.toggleTexts[0] === '词组' && mn.toggleTexts[1] === '成语', JSON.stringify({ role: mn && mn.toggleRole, texts: mn && mn.toggleTexts }));
  jian('助记词正文包含新的唯一凭证警告',
    mn && mn.body.includes('请立刻用笔抄写两份，分别放在不同地方。不要截图、不要复制、不要存在电脑或云端。助记词是你唯一的凭证，没有任何找回的方法！'), JSON.stringify(mn && mn.body));

  await c.clickUntil('[data-auth-action="pinyin-group"][data-group="4"]', 'document.querySelectorAll(".warmyAuthWord").length === 12', { timeout: 4000 });
  await sleep(150);
  const mn4 = await js(`(() => {
    const cells = [...document.querySelectorAll('.warmyAuthMnemonic .warmyAuthWord')];
    return {
      groups: cells.length,
      indices: cells.map((e) => e.querySelector('.warmyAuthWordIndex')?.textContent.trim() || ''),
      words: cells.map((e) => e.querySelector('.warmyAuthWordText')?.textContent.trim() || ''),
      pinyins: cells.map((e) => e.querySelector('.warmyAuthWordPinyin')?.textContent.trim() || ''),
      covers: cells.map((e) => e.getAttribute('data-cover') || ''),
      cls: document.querySelector('.warmyAuthMnemonic')?.className || '',
    };
  })()`);
  const isIdiom = (w) => Array.from(w).length === 4 && /^[\u4e00-\u9fff]+$/.test(w);
  jian('第 78 轮：切换到成语只显示 12 个格子，序号 1-2/3-4…23-24（每格覆盖两个 BIP-39 索引）',
    mn4 && mn4.groups === 12 && mn4.words.every(isIdiom)
    && mn4.indices.join(',') === Array.from({ length: 12 }, (_, k) => `${2 * k + 1}-${2 * k + 2}`).join(',')
    && mn4.covers.join(',') === Array.from({ length: 12 }, (_, k) => `${2 * k + 1},${2 * k + 2}`).join(',')
    && /is-pinyin-4/.test(mn4.cls), JSON.stringify({ groups: mn4 && mn4.groups, indices: mn4 && mn4.indices, words: mn4 && mn4.words.slice(0, 4), cls: mn4 && mn4.cls }));
  jian('成语拼音仍是真实读音、无空格/数字/连字符', mn4 && mn4.pinyins.length === 12 && mn4.pinyins.every((p) => /^[a-z]+$/.test(p)), JSON.stringify((mn4 && mn4.pinyins || []).slice(0, 8)));
  await c.clickUntil('[data-auth-action="pinyin-group"][data-group="2"]', 'document.querySelectorAll(".warmyAuthWordEn").length === 24 && !document.querySelector(".warmyAuthMnemonic")?.className.includes("is-pinyin")', { timeout: 3000 });

  // 关闭中文友好型：同一批格子应显示 24 个英文 BIP-39 词（后面用它们做真实恢复）。
  await c.evaluate(`document.querySelector('[data-auth-action="toggle-pinyin"]').click()`);
  await c.waitFor('document.querySelector("[data-auth-action=toggle-pinyin]")?.checked === false && document.querySelectorAll(".warmyAuthWordEn").length === 24', { timeout: 4000, biaoQian: '关闭中文友好型' });
  const en = await js(`(() => ({
    words: [...document.querySelectorAll('.warmyAuthMnemonic .warmyAuthWordEn')].map((e) => e.textContent.trim()),
    indices: [...document.querySelectorAll('.warmyAuthMnemonic .warmyAuthWordIndex')].map((e) => e.textContent.trim()),
    pinyins: document.querySelectorAll('.warmyAuthMnemonic .warmyAuthWordPinyin').length,
  }))()`);
  jian('关闭中文友好型后仍是 24 个带序号格子，内容是英文 BIP-39 词',
    en && en.words.length === 24 && en.words.every((w) => /^[a-z]+$/.test(w)) && en.pinyins === 0
    && en.indices.join(',') === Array.from({ length: 24 }, (_, i) => String(i + 1)).join(','), JSON.stringify(en && en.words.slice(0, 4)));
  regWords = en && Array.isArray(en.words) ? en.words : null;
  await c.evaluate(`document.querySelector('[data-auth-action="toggle-pinyin"]').click()`);
  await c.waitFor('document.querySelector("[data-auth-action=toggle-pinyin]")?.checked === true', { timeout: 3000, biaoQian: '重新开启中文友好型' });

  // 返回登录 → 再注册（验证返回按钮真的能回登录界面）
  await c.clickUntil('[data-auth-action="login-back"]', '!!document.querySelector("[data-auth-action=register-open]")', { timeout: 5000 });
  jian('助记词注册页的返回按钮可回到登录界面', await js(`!!document.querySelector('[data-auth-action="register-open"]') && !!document.querySelector('#warmyAuthPin')`));
  await c.clickUntil('[data-auth-action="register-open"]', 'document.querySelectorAll(".warmyAuthWord").length === 24', { timeout: 6000 });
  await sleep(150);

  // 再次注册会重新生成助记词：这次显示的 24 个词才是最终落库的那份（恢复必须用它）。
  await c.evaluate(`document.querySelector('[data-auth-action="toggle-pinyin"]').click()`);
  await c.waitFor('document.querySelector("[data-auth-action=toggle-pinyin]")?.checked === false && document.querySelectorAll(".warmyAuthWordEn").length === 24', { timeout: 4000, biaoQian: '第二次注册关闭中文友好型' });
  const regWords2 = await js(`([...document.querySelectorAll('.warmyAuthMnemonic .warmyAuthWordEn')].map((e) => e.textContent.trim()))`);
  jian('最终注册的 24 个英文词完整可读（用于后面的真实恢复）',
    Array.isArray(regWords2) && regWords2.length === 24 && regWords2.every((w) => /^[a-z]+$/.test(w)), JSON.stringify(Array.isArray(regWords2) ? regWords2.slice(0, 4) : regWords2));
  regWords = Array.isArray(regWords2) ? regWords2 : regWords;
  await c.evaluate(`document.querySelector('[data-auth-action="toggle-pinyin"]').click()`);
  await c.waitFor('document.querySelector("[data-auth-action=toggle-pinyin]")?.checked === true', { timeout: 3000, biaoQian: '第二次注册重新开启中文友好型' });

  await c.clickUntil('[data-auth-action="mnemonic-confirm"]', '!!document.querySelector(".warmyAuthModal")', { timeout: 4000 });
  const modal = await js(`document.querySelector('.warmyAuthModalBody')?.textContent || ''`);
  jian('确认弹层使用新的“助记词将被销毁”文案',
    modal === '助记词是你唯一的凭证，没有任何找回的方法！刚刚的助记词将被销毁，之后无法再次查看，确定你已抄写两份并分开放置了吗？', JSON.stringify(modal));
  await c.clickUntil('[data-modal="ok"]', '!!document.querySelector("#warmyAuthPin1")', { timeout: 6000 });
  const pinHint = await js(`(() => ({ hint: document.querySelector('#warmyAuthModeHint')?.textContent.trim() || '', auto: !!document.querySelector('#warmyAuthAuto') }))()`);
  jian('设置 PIN 页显示新的硬件/系统失效警告（未勾选自动登录时）',
    pinHint && pinHint.hint === '更改设备的硬件，或者系统升级都有可能导致PIN失效，助记词是唯一的恢复方法！', JSON.stringify(pinHint));
  await c.evaluate(`document.querySelector('#warmyAuthAuto').click()`);
  await sleep(200);
  const pinHintAuto = await js(`(() => ({ hint: document.querySelector('#warmyAuthModeHint')?.textContent.trim() || '', checked: document.querySelector('#warmyAuthAuto')?.checked === true }))()`);
  jian('勾选自动登录后仍显示同一段警告文案',
    pinHintAuto && pinHintAuto.checked === true && pinHintAuto.hint === '更改设备的硬件，或者系统升级都有可能导致PIN失效，助记词是唯一的恢复方法！', JSON.stringify(pinHintAuto));
  await c.evaluate(`document.querySelector('#warmyAuthAuto').click()`);
  await sleep(200);
  await c.evaluate(`(() => {
    const set = (id, v) => { const e = document.getElementById(id); const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(e, v); e.dispatchEvent(new Event('input', { bubbles: true })); };
    set('warmyAuthPin1', 'Test1234'); set('warmyAuthPin2', 'Test1234');
    return true;
  })()`);
  await sleep(150);
  await c.clickUntil('[data-auth-action="pin-submit"]', '!!document.querySelector("#warmyAuthUsername")', { timeout: 8000 });
  const uname = await js(`(() => ({
    title: document.querySelector('.warmyAuthTitle')?.textContent || '',
    body: /这个称呼只保存在本机/.test(document.body.innerText),
    label: [...document.querySelectorAll('.warmyAuthLabel')].some((e) => e.textContent.trim() === '称呼'),
    aria: document.querySelector('#warmyAuthUsername')?.getAttribute('aria-label') || '',
    value: document.querySelector('#warmyAuthUsername')?.value || '',
  }))()`);
  jian('用户名页去掉说明和“称呼”标签，输入框保留无障碍名称',
    uname && uname.title === '给自己起个称呼' && uname.body === false && uname.label === false && uname.aria === '给自己起个称呼' && uname.value.length > 0, JSON.stringify(uname));

  await c.clickUntil('[data-auth-action="username-finish"]', 'document.getElementById("warmyAuthGate").classList.contains("warmyAuthHidden")', { timeout: 10000 });
  await sleep(250);

  // ── 我的页：品牌 | 资料 | 账号 三块，以及自动登录/PIN 的联动 ──
  await c.clickUntil('[data-nav="wo"]', '!!document.querySelector(".woDingR68")', { timeout: 8000 });
  await c.waitFor('!!document.querySelector("#warmyAuthMyCard .warmyAuthMyButtons")', { timeout: 10000, biaoQian: '我的页账号卡' });
  await sleep(200);
  const my = await js(`(() => {
    const q = (s) => document.querySelector(s);
    const box = (s) => { const e = q(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), r: Math.round(b.right), b: Math.round(b.bottom), cy: Math.round(b.y + b.height / 2) }; };
    const card = q('#warmyAuthMyCard');
    const btn = (a) => [...card.querySelectorAll('[data-my-action="' + a + '"]')][0];
    const btnBox = (a) => { const e = btn(a); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), r: Math.round(b.right) }; };
    return {
      vw: innerWidth,
      ding: box('.woDingR68'), brand: box('.woBrandR68'), body: box('.woR68Body'),
      profile: box('.woR68Profile'), card: box('#warmyAuthMyCard'),
      logo: box('.woBrandR68 .pinPailogo'), brandName: q('.woBrandMing')?.textContent.trim() || '',
      avatar: box('#pAvAnNiu'), name: box('#pMingDisplay'), nameText: q('#pMingDisplay')?.textContent.trim() || '',
      email: box('#pYouJian'), cardBtn: box('#pMingPianBtn'),
      cardText: card.innerText.trim(), cardTitle: card.querySelector('.warmyAuthTitle,h3')?.textContent.trim() || '',
      oldTitle: /账号与助记词/.test(document.body.innerText),
      key: card.querySelector('.warmyAuthMyKey')?.textContent.trim() || '',
      value: card.querySelector('.warmyAuthMyValue')?.textContent.trim() || '',
      view: card.querySelector('.warmyAuthMyView')?.textContent.trim() || '',
      auto: { exists: !!q('#warmyMyAuto'), checked: q('#warmyMyAuto')?.checked === true, disabled: q('#warmyMyAuto')?.disabled === true },
      pinText: btn('change-pin')?.textContent.trim() || '', pinDisabled: btn('change-pin')?.disabled === true,
      logoutText: btn('logout')?.textContent.trim() || '', logoutDisabled: btn('logout')?.disabled === true,
      pinBox: btnBox('change-pin'), logoutBox: btnBox('logout'),
    };
  })()`);
  const layoutOk = !!(my && my.ding && my.brand && my.body && my.profile && my.card && my.logo && my.avatar && my.email && my.cardBtn && my.pinBox && my.logoutBox);
  /**
   * 第 92 轮定稿改版：资料列（头像+用户名）与账号列（邮箱→助记词→PIN/退出）并排，
   * 两列相对左侧 logo 上下居中；不再要求两列顶对齐，邮箱也不在用户名下面。
   */
  jian('我的页三块布局：品牌占左半并居中，右侧资料列与账号列并排、不重叠',
    layoutOk
    && my.brand.r <= my.body.x + 1
    && my.brand.w / my.ding.w >= 0.4 && my.brand.w / my.ding.w <= 0.55
    && my.profile.y >= my.ding.y - 2 && my.profile.b <= my.ding.b + 2
    && my.card.y >= my.ding.y - 2 && my.card.b <= my.ding.b + 2
    && Math.abs(my.profile.cy - my.card.cy) <= 40
    && my.profile.r <= my.card.x + 1
    && my.card.r <= my.ding.r + 1
    && my.profile.w >= 200 && my.card.w >= 200,
    JSON.stringify(my && { vw: my.vw, ding: my.ding, brand: my.brand, body: my.body, profile: my.profile, card: my.card }));
  jian('左侧大 logo + 名称；右侧资料列头像/名称上下居中对齐，邮箱在账号列且在助记词上方',
    layoutOk && my.logo.w >= 180 && my.brandName.length > 0 && my.nameText.length > 0
    && my.avatar.w >= 40 && my.name.y >= my.avatar.b - 2
    && my.email.x >= my.profile.r - 2 && my.email.b <= my.card.y + 2
    && my.email.w >= 120 && my.email.w <= 300,
    JSON.stringify(my && { logo: my.logo, brandName: my.brandName, avatar: my.avatar, name: my.name, email: my.email, profile: my.profile, card: my.card }));
  jian('账号卡没有“账号与助记词”标题，助记词显示“已保存”（中文冒号）',
    layoutOk && my.cardTitle === '' && my.oldTitle === false
    && my.key === '助记词：' && my.value === '已保存' && my.view === '' && /助记词/.test(my.cardText),
    JSON.stringify(my && { cardTitle: my.cardTitle, oldTitle: my.oldTitle, key: my.key, value: my.value, view: my.view, text: my.cardText }));
  jian('账号卡：自动登录勾选项 + 修改 PIN/退出账号并排；自动登录未勾选时修改 PIN 可用',
    layoutOk && my.auto.exists && my.auto.checked === false && my.auto.disabled === false
    && my.pinText === '修改 PIN' && my.pinDisabled === false
    && my.logoutText === '退出账号' && my.logoutDisabled === false
    && Math.abs(my.pinBox.y - my.logoutBox.y) <= 2 && my.pinBox.r <= my.logoutBox.x + 1,
    JSON.stringify(my && { auto: my.auto, pinText: my.pinText, pinDisabled: my.pinDisabled, logoutText: my.logoutText, pinBox: my.pinBox, logoutBox: my.logoutBox }));

  // 名片按钮仍打开第 67 轮定稿的“我的名片”：头像勾选、服务商多选；没有服务商时不生成。
  await c.clickUntil('#pMingPianBtn', '!!document.querySelector("#woCardGen") && !document.querySelector("#duiHuaKuangGen")?.classList.contains("yinCang")', { timeout: 6000 });
  await sleep(150);
  const cardDlg = await js(`(() => ({
    title: document.querySelector('#duiHuaKuangBiaoTi')?.textContent.trim() || '',
    avatar: !!document.querySelector('#woCardWithAvatar'),
    avatarChecked: document.querySelector('#woCardWithAvatar')?.checked === true,
    provList: !!document.querySelector('.woCardProvList'),
    provText: document.querySelector('.woCardProvList')?.innerText.trim() || '',
    genDisabled: document.querySelector('#woCardGen')?.disabled === true,
    outEmpty: (document.querySelector('#woCardOut')?.innerHTML || '').trim() === '',
  }))()`);
  jian('名片按钮打开“我的名片”：头像可勾选、服务商可多选；无服务商时生成置灰且不出码',
    cardDlg && /名片/.test(cardDlg.title) && cardDlg.avatar === true && cardDlg.avatarChecked === true
    && cardDlg.provList === true && /网络服务商|还没有网络服务商/.test(cardDlg.provText)
    && cardDlg.genDisabled === true && cardDlg.outEmpty === true,
    JSON.stringify(cardDlg));
  await c.clickUntil('#duiHuaKuangDongZuoJi button', 'document.querySelector("#duiHuaKuangGen")?.classList.contains("yinCang")', { timeout: 4000 });
  // 名片弹窗会触发一次网络配置读取/页面重绘；等账号卡重新挂载再做后面的勾选。
  await c.evaluate(`window.__warmyAuthGate.decorateMyPage()`);
  await c.waitFor('!!document.querySelector("#warmyAuthMyCard .warmyAuthMyButtons")', { timeout: 8000, biaoQian: '名片弹窗关闭后的账号卡' });
  await sleep(200);

  // 未确认助记词时，账号卡要变成“查看助记词”按钮；确认后回到“已保存”。
  await js(`window.warmy.authConfirmMnemonic('later')`);
  await js(`window.__warmyAuthGate.decorateMyPage()`);
  await c.waitFor('!!document.querySelector("#warmyAuthMyCard .warmyAuthMyView")', { timeout: 5000, biaoQian: '未保存态查看助记词' });
  const unsaved = await js(`(() => ({ view: document.querySelector('#warmyAuthMyCard .warmyAuthMyView')?.textContent.trim() || '', value: document.querySelector('#warmyAuthMyCard .warmyAuthMyValue')?.textContent.trim() || '' }))()`);
  jian('助记词未确认时显示“查看助记词”按钮，而不是“已保存”',
    unsaved && unsaved.view === '查看助记词' && unsaved.value === '', JSON.stringify(unsaved));
  await js(`window.warmy.authConfirmMnemonic('confirm')`);
  await js(`window.__warmyAuthGate.decorateMyPage()`);
  await c.waitFor('!!document.querySelector("#warmyAuthMyCard .warmyAuthMyValue")', { timeout: 5000, biaoQian: '助记词已保存态' });

  // 勾选自动登录：先二次确认（第 78 轮），确认后勾选框选中、修改 PIN 置灰，旧 PIN 立即失效。
  // 用 DOM 的 input.click() 触发真实的 click/change 委托，避免“我的页”重绘时的坐标点空。
  await ensureMyCard();
  await c.evaluate(`document.querySelector('#warmyMyAuto').click()`);
  await c.waitFor('!!document.querySelector(".warmyAuthModal [data-modal=ok]")', { timeout: 6000, biaoQian: '自动登录二次确认' });
  const autoConfirm = await js(`(() => ({ body: document.querySelector('.warmyAuthModalBody')?.textContent.trim() || '', ok: document.querySelector('.warmyAuthModal [data-modal=ok]')?.textContent.trim() || '' }))()`);
  jian('第 78 轮：勾选自动登录先弹二次确认，取消前不写认证库',
    autoConfirm && autoConfirm.body.length > 0 && autoConfirm.ok.length > 0, JSON.stringify(autoConfirm));
  await c.clickUntil('.warmyAuthModal [data-modal="ok"]', '!document.querySelector(".warmyAuthModal")', { timeout: 6000 });
  await c.waitFor('document.querySelector("#warmyMyAuto")?.checked === true && document.querySelector("[data-my-action=change-pin]")?.disabled === true', { timeout: 10000, biaoQian: '自动登录开启后的账号卡' });
  const autoOn = await js(`(async () => {
    const st = await window.warmy.authState();
    const pin = await window.warmy.authLoginPin('Test1234');
    const card = document.querySelector('#warmyAuthMyCard');
    const b = card.querySelector('[data-my-action="change-pin"]');
    return { st, pin, checked: document.querySelector('#warmyMyAuto')?.checked === true, pinDisabled: !!b?.disabled, pinText: b?.textContent.trim() || '', logoutDisabled: !!card.querySelector('[data-my-action="logout"]')?.disabled };
  })()`);
  jian('勾选自动登录后：勾选框选中、修改 PIN 按钮不可用、退出仍可用',
    autoOn && autoOn.checked === true && autoOn.pinDisabled === true && autoOn.logoutDisabled === false,
    JSON.stringify(autoOn && { checked: autoOn.checked, pinDisabled: autoOn.pinDisabled, pinText: autoOn.pinText, logoutDisabled: autoOn.logoutDisabled }));
  jian('勾选自动登录后：旧 PIN 立即失效（pin-not-configured），本机只保留自动登录',
    autoOn && autoOn.st.autoLogin === true && autoOn.st.pinConfigured === false
    && autoOn.pin && autoOn.pin.ok === false && autoOn.pin.error === 'pin-not-configured',
    JSON.stringify(autoOn && { state: autoOn.st, pin: autoOn.pin }));

  // 取消自动登录：R78 #9 要求先设置 PIN；成功后才真正关闭。
  await ensureMyCard();
  await c.evaluate(`document.querySelector('#warmyMyAuto').click()`);
  await c.waitFor('!!document.querySelector("#warmyChangePin1")', { timeout: 10000, biaoQian: '取消自动登录的 PIN 弹窗' });
  await c.evaluate(`(() => {
    const set = (id, v) => { const e = document.getElementById(id); const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(e, v); e.dispatchEvent(new Event('input', { bubbles: true })); };
    set('warmyChangePin1', 'Pin12345'); set('warmyChangePin2', 'Pin12345');
    return true;
  })()`);
  await c.clickUntil('.warmyAuthModal [data-modal="ok"]', '!document.querySelector(".warmyAuthModal")', { timeout: 10000 });
  await c.waitFor('document.querySelector("#warmyMyAuto")?.checked === false && document.querySelector("[data-my-action=change-pin]")?.disabled === false', { timeout: 10000, biaoQian: 'PIN 设置后的账号卡' });
  const autoOff = await js(`(async () => { const st = await window.warmy.authState(); const b = document.querySelector('[data-my-action="change-pin"]'); return { st, checked: document.querySelector('#warmyMyAuto')?.checked === true, pinDisabled: !!b?.disabled, pinText: b?.textContent.trim() || '' }; })()`);
  jian('设置 PIN 后取消自动登录：自动登录关闭、修改 PIN 可用',
    autoOff && autoOff.st.autoLogin === false && autoOff.st.pinConfigured === true && autoOff.checked === false && autoOff.pinDisabled === false && autoOff.pinText === '修改 PIN',
    JSON.stringify({ state: autoOff && { autoLogin: autoOff.st.autoLogin, pinConfigured: autoOff.st.pinConfigured, unlocked: autoOff.st.unlocked }, checked: autoOff && autoOff.checked, pinDisabled: autoOff && autoOff.pinDisabled, pinText: autoOff && autoOff.pinText }));

  await js(`(() => { window.alert = () => {}; return true; })()`);
  /** 先确认「解除自动登录」的 PIN 弹层已经关闭，否则下一次点击会复用旧弹层的闭包（带 disableAutoLogin） */
  await c.waitFor('!document.querySelector(".warmyAuthModal")', { timeout: 5000, biaoQian: '普通改 PIN 前弹层已关闭' });
  await c.clickUntil('[data-my-action="change-pin"]', '!!document.querySelector(".warmyAuthModal #warmyChangePin1")', { timeout: 5000 });
  await c.clickUntil('.warmyAuthModal [data-modal="cancel"]', '!document.querySelector(".warmyAuthModal")', { timeout: 5000 });
  /** 普通改 PIN 直接走真实 IPC（弹层本身的 UI 已在上面验过）；下面的重点是新进程必须回到登录页 */
  const changeRes = await js(`window.warmy.authChangePin({ pin: 'New1234', confirmPin: 'New1234' })`);
  jian('普通改 PIN 成功并要求重新登录', changeRes && changeRes.ok === true && changeRes.locked === true, changeRes);
  await sleep(500);
  await followRelaunch('改 PIN 后的登录页', '!!document.querySelector("#warmyAuthPin") && !document.getElementById("warmyAuthGate").classList.contains("warmyAuthHidden")');
  await sleep(250);
  const login = await js(`(() => ({
    brand: !!document.querySelector('.warmyAuthBrand'), title: !!document.querySelector('.warmyAuthTitle'),
    pin: !!document.querySelector('#warmyAuthPin'), pinDisabled: document.querySelector('#warmyAuthPin')?.disabled === true,
    confirm: !!document.querySelector('[data-auth-action="login-pin"]'),
    buttons: [...document.querySelectorAll('[data-auth-action]')].map(e=>[e.getAttribute('data-auth-action'), e.textContent.trim()]).filter(x=>x[0]==='recover-open'||x[0]==='register-open'),
  }))()`);
  jian('改 PIN 后回到登录页：无品牌/标题，PIN 可用且有登录确认',
    login && login.brand === false && login.title === false && login.pin === true && login.pinDisabled === false && login.confirm === true, JSON.stringify(login));
  jian('登录页下方仍是“使用助记词登录 / 注册新账号”两个按钮',
    login && login.buttons.length === 2 && login.buttons.some((x) => x[1] === '使用助记词登录') && login.buttons.some((x) => x[1] === '注册新账号'), JSON.stringify(login && login.buttons));

  const setPinInput = (v) => c.evaluate(`(() => {
    const e = document.querySelector('#warmyAuthPin');
    const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    s.call(e, ${JSON.stringify(v)}); e.dispatchEvent(new Event('input', { bubbles: true })); return true;
  })()`);
  await setPinInput('Test1234');
  await c.clickUntil('[data-auth-action="login-pin"]', '(document.querySelector(".warmyAuthError")?.innerText.trim().length || 0) > 0', { timeout: 12000 });
  const oldTry = await js(`(() => ({ error: document.querySelector('.warmyAuthError')?.innerText.trim() || '', stillLogin: !!document.querySelector('#warmyAuthPin') }))()`);
  jian('修改 PIN 后，旧 PIN 无法登录', oldTry && oldTry.stillLogin === true && oldTry.error.length > 0, JSON.stringify(oldTry));
  await setPinInput('New1234');
  await c.clickUntil('[data-auth-action="login-pin"]', 'true', { timeout: 5000 });
  await followRelaunch('新 PIN 登录', 'document.getElementById("warmyAuthGate").classList.contains("warmyAuthHidden")');
  await sleep(1500);
  /** 登录解锁数据仓库可能触发第二段重启；等界面稳定后再进“我的”页 */
  try {
    await c.waitFor('document.getElementById("warmyAuthGate").classList.contains("warmyAuthHidden")', { timeout: 5000 });
  } catch {
    await followRelaunch('新 PIN 登录二次', 'document.getElementById("warmyAuthGate").classList.contains("warmyAuthHidden")');
  }
  const newLogin = await js(`(async () => { const st = await window.warmy.authState(); return { unlocked: st.unlocked === true, hasAccount: st.hasAccount === true, pinConfigured: st.pinConfigured === true, autoLogin: st.autoLogin === true }; })()`);
  jian('修改 PIN 后，新 PIN 可以登录（会话已解锁，自动登录仍关闭）',
    newLogin && newLogin.unlocked === true && newLogin.hasAccount === true && newLogin.pinConfigured === true && newLogin.autoLogin === false,
    JSON.stringify(newLogin));

  /** 助记词恢复全流程由 verify-r68-auth-security / verify-r67-firstrun 专项覆盖；本支到新 PIN 登录为止 */
  const errors = c.errors();
  jian('全流程无脚本/控制台错误', errors.length === 0, JSON.stringify(errors));
} catch (e) {
  hong.push('未捕获异常');
  console.log('  FAIL 未捕获异常 ← ' + String((e && (e.stack || e.message)) || e).slice(0, 500));
} finally {
  try { await guan(); } catch { /* noop */ }
  await sleep(300);
  if (hong.length) console.log('PROFILE_KEPT ' + profile);
  else { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ } }
}
console.log(`\n==== verify-r68-auth-ui：${ok} ok / ${hong.length} FAIL ====`);
process.exit(hong.length ? 1 : 0);
