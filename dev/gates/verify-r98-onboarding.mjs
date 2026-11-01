/**
 * verify-r98-onboarding —— 第 98 轮「开始使用」清单门禁（Electron + CDP，临时 profile）。
 *
 * 覆盖用户点名：
 *  ① 旧漫游式引导（引导条 / spotlight / #warmyTour）彻底消失；
 *  ② 新清单是 4 步：供应商 → 模型 → 牛马 → 第一句，状态真的达成才打勾；
 *  ③ 单步可跳过、整张卡可“稍后设置”，未完成时保留“继续设置”胶囊；
 *  ④ 去操作会定位到正确页面；卡片**不自动收起**，固定在右上角，不压住聊天发送按钮；
 *  ⑤ 第一句对话（真主进程 + 真渲染层 + 确定性假模型）完成后自动完成清单；
 *  ⑥ 10 个语言包都有新文案，切换语言清单跟着变；
 *  ⑦ 重启后：点过“稍后设置”只留胶囊；全部配好则静默完成，不再打扰。
 *
 * 跑法：node dev/gates/verify-r98-onboarding.mjs（不联网、不要真实密钥）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PKG = path.join(ROOT, 'packages', 'app-shell');
const ELECTRON = path.join(PKG, 'node_modules', 'electron', 'dist', 'electron.exe');
const MAIN = path.join(PKG, 'dist', 'electron-main.js');
const SRC = path.join(PKG, 'src', 'renderer');
const { attach, sleep } = await import(pathToFileURL(path.join(PKG, 'scripts', 'cdp-lib.mjs')).href);

let okN = 0, failN = 0;
const ok = (m, d) => { okN += 1; console.log('  ok   ' + m + (d === undefined ? '' : ' ← ' + String(d).slice(0, 360))); };
const bad = (m, d) => { failN += 1; console.log('  FAIL ' + m + (d === undefined ? '' : ' ← ' + String(d).slice(0, 460))); };
const jian = (m, cond, d) => (cond ? ok(m, d) : bad(m, d));

/* ── 确定性假模型（OpenAI 兼容 + SSE；不联网） ───────────────────── */
const mock = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (ch) => (raw += ch));
  req.on('end', () => {
    let ti = {};
    try { ti = JSON.parse(raw || '{}'); } catch { /* noop */ }
    if (/\/models$/.test(String(req.url || ''))) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'mock-guide' }] }));
      return;
    }
    const zhengWen = '收到，第一句完成。';
    if (ti.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const pian = (delta, fr) => 'data: ' + JSON.stringify({ id: 'c-guide', model: 'mock-guide', choices: [{ index: 0, delta, ...(fr ? { finish_reason: fr } : {}) }] }) + '\n\n';
      res.write(pian({ role: 'assistant', content: zhengWen }));
      res.write(pian({}, 'stop'));
      res.end('data: [DONE]\n\n');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'c-guide', model: 'mock-guide',
      choices: [{ index: 0, message: { role: 'assistant', content: zhengWen }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 20, completion_tokens: 8 },
    }));
  });
});
const MOCK_PORT = await new Promise((r) => mock.listen(0, '127.0.0.1', () => r(mock.address().port)));
const JIDI = 'http://127.0.0.1:' + MOCK_PORT + '/v1';

let child = null;
let c = null;
let profile = '';
const shotDir = path.join(os.tmpdir(), 'warmy-r98-shots-' + Date.now());
fs.mkdirSync(shotDir, { recursive: true });
const js = (e) => c.evaluate('(async function(){ try { return await (' + e + '); } catch (err) { return { __err: String((err && (err.stack || err.message)) || err).slice(0, 500) }; } })()');

async function start(port, prof, bypass = true) {
  const env = { ...process.env, ...(bypass ? { WARMY_AUTH_BYPASS: '1' } : {}) };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(ELECTRON, ['--remote-debugging-port=' + port, '--disable-features=CalculateNativeWinOcclusion', '--user-data-dir=' + prof, MAIN], {
    cwd: PKG, stdio: ['ignore', 'ignore', 'ignore'], windowsHide: false, env,
  });
  let last = '';
  for (let i = 0; i < 90; i += 1) {
    try { c = await attach(port, { biaoQian: 'r98', callTimeout: 30000 }); break; } catch (e) { last = e.message; await sleep(300); }
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

function writeProfile(dir, settings) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(settings, null, 2), 'utf8');
}
const baseSettings = (patch) => ({
  yuYan: 'zh-CN', setupDone: true, privacyConsent: true,
  providersSeeded: true, providers: [], instances: [],
  ...patch,
});
async function wait(expr, t = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < t) {
    const v = await js(expr);
    if (v) return v;
    await sleep(250);
  }
  return null;
}
const guideState = () => js('window.__startGuide?.state?.()');
const guideDom = () => js(`(() => {
  const card = document.getElementById('startGuide');
  if (!card) return { panel: false, pill: !!document.getElementById('startGuidePill') };
  const r = card.getBoundingClientRect();
  return {
    panel: true,
    steps: card.querySelectorAll('.startGuideStep').length,
    done: card.querySelectorAll('.startGuideStep.isDone').length,
    active: [...card.querySelectorAll('.startGuideStep')].findIndex((e) => e.classList.contains('isActive')),
    sub: card.querySelector('.startGuideSub')?.textContent || '',
    title: card.querySelector('.startGuideTitle')?.textContent || '',
    go: card.querySelector('[data-sg="go"]')?.textContent || '',
    skipTags: [...card.querySelectorAll('.startGuideSkipTag')].map((e) => e.textContent),
    doneBox: !!card.querySelector('.startGuideDone'),
    rect: { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) },
    vw: innerWidth, vh: innerHeight,
    oldBar: !!document.getElementById('yinDaoTiao'),
    oldTour: !!document.getElementById('warmyTour'),
  };
})()`);
async function clickGuide(act) {
  return js(`(() => { const b=document.querySelector('#startGuide [data-sg="${act}"]'); if(!b) return false; b.click(); return true; })()`);
}

try {
  /* ══════ 0. 静态：旧引导全删、新旧文案对齐 ══════ */
  const appJs = fs.readFileSync(path.join(SRC, 'app.js'), 'utf8');
  const authJs = fs.readFileSync(path.join(SRC, 'auth-gate.js'), 'utf8');
  const appCss = fs.readFileSync(path.join(SRC, 'app.css'), 'utf8');
  const renCss = fs.readFileSync(path.join(SRC, 'renderer.css'), 'utf8');
  const authCss = fs.readFileSync(path.join(SRC, 'auth-gate.css'), 'utf8');
  const allRender = [appJs, authJs, appCss, renCss, authCss].join('\n');
  jian('旧引导代码/样式全删（yinDao / warmyTour / __showOnboardingGuide 不再出现）',
    !/yinDao|warmyTour|__showOnboardingGuide/.test(allRender), JSON.stringify({
      yinDao: (allRender.match(/yinDao/g) || []).length,
      tour: (allRender.match(/warmyTour/g) || []).length,
      oldEntry: (allRender.match(/__showOnboardingGuide/g) || []).length,
    }));
  jian('新清单的 4 步与收/展/跳过/稍后都在 app.js',
    /startGuide\.step\.provider/.test(appJs) && /startGuide\.step\.model/.test(appJs)
    && /startGuide\.step\.niuma/.test(appJs) && /startGuide\.step\.chat/.test(appJs)
    && /data-sg="skip"/.test(appJs) && /data-sg="later"/.test(appJs));
  jian('第一句发送成功路径真的会标记清单完成',
    /\} else if \(r\?\.ok\) \{\s*try \{ window\.__startGuideChatDone\?\.\(\); \}/.test(appJs));
  const i18nDir = path.join(PKG, 'src', 'i18n');
  const locales = ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko', 'ru', 'es', 'fr', 'pt', 'eo'];
  const wantedKeys = [
    'startGuide.title', 'startGuide.subtitle', 'startGuide.progress',
    'startGuide.doneTitle', 'startGuide.doneSubtitle', 'startGuide.doneClose',
    'startGuide.later', 'startGuide.resume', 'startGuide.resumeHint', 'startGuide.aboutHint',
    'startGuide.skipped', 'startGuide.skipStep', 'startGuide.allSkipped', 'startGuide.allSkippedBtn',
    'startGuide.step.provider.title', 'startGuide.step.provider.desc', 'startGuide.step.provider.action',
    'startGuide.step.model.title', 'startGuide.step.model.desc', 'startGuide.step.model.action',
    'startGuide.step.model.noProvider', 'startGuide.step.model.actionNoProvider',
    'startGuide.step.niuma.title', 'startGuide.step.niuma.desc', 'startGuide.step.niuma.action',
    'startGuide.step.chat.title', 'startGuide.step.chat.desc', 'startGuide.step.chat.action',
    'startGuide.step.chat.needNiuma', 'startGuide.step.chat.actionNeedNiuma',
  ];
  const missing = {};
  const oldKeys = {};
  for (const loc of locales) {
    const obj = JSON.parse(fs.readFileSync(path.join(i18nDir, loc + '.json'), 'utf8'));
    const m = wantedKeys.filter((k) => !(k in obj));
    if (m.length) missing[loc] = m;
    const o = Object.keys(obj).filter((k) => k.startsWith('guide.'));
    if (o.length) oldKeys[loc] = o;
  }
  jian('10 个语言包都有开始使用清单的 30 条文案', Object.keys(missing).length === 0, JSON.stringify(missing));
  jian('10 个语言包不再残留旧 guide.* 键', Object.keys(oldKeys).length === 0, JSON.stringify(oldKeys));

  /* ══════ A. 新用户：0/4、去操作自动收起、稍后设置、重开、单步跳过 ══════ */
  console.log('\n[A] 新用户清单');
  profile = path.join(os.tmpdir(), 'warmy-r98-a-' + Date.now());
  writeProfile(profile, baseSettings({ guideDone: false }));
  await start(Number(process.env.R98_PORT_A || 9821), profile);
  await wait('window.__warmyBootDataReady === true', 20000);
  jian('首启自动出现「开始使用」清单', !!(await wait('!!document.getElementById("startGuide")', 15000)));
  await sleep(900);
  const a1 = await guideDom();
  jian('旧引导条/漫游层都不存在', a1 && a1.oldBar === false && a1.oldTour === false, JSON.stringify(a1));
  jian('4 步、0/4、第 1 步展开', a1 && a1.steps === 4 && a1.done === 0 && a1.active === 0, JSON.stringify(a1));
  jian('进度与标题已显示，卡片完整在视口内', a1 && /0\/4/.test(a1.sub) && a1.title.length > 0
    && a1.rect.l >= 0 && a1.rect.t >= 0 && a1.rect.r <= a1.vw && a1.rect.b <= a1.vh, JSON.stringify(a1));
  const topHit = await js(`(() => { const e = document.elementFromPoint(Math.round(innerWidth / 2), 60); return !!(e && e.closest && e.closest('#startGuide')); })()`);
  jian('清单非阻塞（页面顶部仍能点到主界面）', topHit === false, JSON.stringify({ topHit }));
  await c.snap(path.join(shotDir, 'a-fresh.png'));

  jian('点「去添加供应商」', await clickGuide('go'));
  await sleep(1100);
  const a2 = await js(`(() => ({
    nav: document.querySelector('.ceLanTiaoMu.jiHuo')?.getAttribute('data-nav') || '',
    sec: document.querySelector('#peiZhiDaoHang button.qiYong')?.getAttribute('data-sec') || '',
    host: !!document.getElementById('provTianJiaRuKou'),
    preset: !!document.getElementById('provPreset'),
    panel: !!document.getElementById('startGuide'),
    pill: !!document.getElementById('startGuidePill'),
    pulse: !!document.getElementById('provTianJiaRuKou')?.classList.contains('startGuidePulse'),
  }))()`);
  jian('去操作：进入 设置 → 模型 并定位/脉冲供应商入口',
    a2 && a2.nav === 'settings' && a2.sec === 'model' && a2.host && a2.preset && a2.pulse, JSON.stringify(a2));
  jian('去操作后清单保持展开（不自动收起）', a2 && a2.panel === true && a2.pill === false, JSON.stringify(a2));

  jian('点「稍后设置」', await clickGuide('later'));
  await sleep(500);
  const a3 = await guideDom();
  const a3st = await js('window.warmy.setupState()');
  jian('稍后设置：面板收起、保留继续胶囊、guideDone 落盘',
    a3 && a3.panel === false && a3.pill === true && a3st && a3st.guideDone === true, JSON.stringify({ a3, a3st }));

  await js(`document.getElementById('startGuidePill')?.click()`);
  await sleep(400);
  const a4 = await guideDom();
  jian('继续设置：回到第 1 步', a4 && a4.panel === true && a4.active === 0, JSON.stringify(a4));
  jian('单步跳过：第 1 步标记已跳过、展开第 2 步', await clickGuide('skip'));
  await sleep(400);
  const a5 = await guideDom();
  jian('跳过行为正确', a5 && a5.active === 1 && a5.skipTags.includes('已跳过'), JSON.stringify(a5));
  await c.snap(path.join(shotDir, 'a-skip.png'));
  jian('A 段无渲染层异常', (c.errors() || []).length === 0, JSON.stringify((c.errors() || []).slice(0, 3)));
  await stop();

  /* ══════ B. 已填供应商/模型/牛马：3/4，第一句真发真回后自动完成 ══════ */
  console.log('\n[B] 第一句对话');
  profile = path.join(os.tmpdir(), 'warmy-r98-b-' + Date.now());
  writeProfile(profile, baseSettings({
    guideDone: false,
    providers: [{ id: 'mock-guide', biaoQian: 'Mock（引导）', protocol: 'openai-compatible', baseURL: JIDI, defaultModel: '', models: ['mock-guide'], staleModels: [], hasKey: false }],
    modelCaps: { 'mock-guide': { contextLen: 65536, kind: 'chat', tools: false, vision: false } },
    specialModels: { chatChain: ['mock-guide'] },
    instances: [{ id: 'inst-r98-guide', ming: '牛马-引导', name: '牛马-引导', status: 'running', defaultModel: 'Mock（引导） · mock-guide', currentModel: 'mock-guide', chain: ['Mock（引导） · mock-guide'], chainDisabled: [] }],
  }));
  await start(Number(process.env.R98_PORT_B || 9822), profile);
  await wait('window.__warmyBootDataReady === true', 20000);
  await wait('!!document.getElementById("startGuide")', 15000);
  await sleep(1000);
  // 假模型不需要真实密钥，但主进程只认“有 Key 或 Ollama”；给临时 profile 写一把假 Key
  await js(`window.warmy.providerKeySet({ providerId: 'mock-guide', apiKey: 'test-key-r98' })`);
  await js('window.__warmyReloadProviders?.()');
  await sleep(500);
  const b1 = await guideDom();
  const b1s = await guideState();
  jian('已配好三步：3/4，第 4 步展开，按钮是「去聊天」',
    b1 && /3\/4/.test(b1.sub) && b1.active === 3 && b1.done === 3 && /聊天|chat/i.test(b1.go), JSON.stringify({ b1, ready: b1s && b1s.ready }));

  jian('点「去聊天」', await clickGuide('go'));
  await sleep(1300);
  const b2 = await js(`(() => {
    const panelEl = document.getElementById('startGuide');
    const pill = document.getElementById('startGuidePill');
    const send = document.getElementById('anNiuFaSong');
    const inp = document.getElementById('shuRu');
    const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
    const pr = r(panelEl); const sr = r(send); const ir = r(inp);
    const overlap = (a, b) => !!a && !!b && !(a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t);
    return {
      nav: document.querySelector('.ceLanTiaoMu.jiHuo')?.getAttribute('data-nav') || '',
      panel: !!panelEl, pill: !!pill,
      input: !!inp, send: !!send,
      panelOverSend: overlap(pr, sr), panelOverInput: overlap(pr, ir),
      active: document.activeElement && document.activeElement.id,
    };
  })()`);
  jian('去聊天：进入单聊并出现输入框/发送按钮，清单保持展开', b2 && b2.nav === 'singleAi' && b2.input && b2.send && b2.panel === true && b2.pill === false, JSON.stringify(b2));
  jian('展开的清单不压住聊天输入框与发送按钮', b2 && b2.panelOverSend === false && b2.panelOverInput === false, JSON.stringify(b2));

  await js(`(() => {
    const e = document.getElementById('shuRu');
    const s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    s.call(e, '你好，这是我的第一句。');
    e.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await js(`document.getElementById('anNiuFaSong')?.click()`);
  const b3 = await wait(`window.__startGuide?.state?.().chatDone === true`, 20000);
  const b3st = b3 ? await js('window.warmy.setupState()') : null;
  jian('第一句真的发出去并收到回复：清单 chatDone 被真实发送路径点亮', !!b3, JSON.stringify(b3));
  jian('第一句完成后 guideChatDone/guideDone 落盘', b3st && b3st.guideChatDone === true && b3st.guideDone === true, JSON.stringify(b3st));
  const bubble = await js(`[...document.querySelectorAll('.xiaoXi')].some((e) => String(e.textContent || '').includes('第一句完成'))`);
  jian('界面里真的出现假模型回复', bubble === true, JSON.stringify({ bubble }));
  await js('window.__startGuideOpen(true)');
  await sleep(500);
  const b4 = await guideDom();
  jian('重开清单：四步全部打勾并显示全部就绪', b4 && b4.steps === 4 && b4.done === 4 && b4.doneBox === true, JSON.stringify(b4));
  // 语言要一起落盘，否则 5s 设置轮询会把界面拉回旧语言（这是产品既有保护，不是清单问题）
  await js(`window.warmy.settingsSave({ yuYan: 'ja' })`);
  await js(`window.__warmyLoadI18n('ja')`);
  await sleep(900);
  const b5 = await guideDom();
  jian('切换语言后清单文案跟着变（日语）', b5 && /はじめに/.test(b5.title) && /準備完了/.test(await js(`document.querySelector('#startGuide .startGuideDoneTitle')?.textContent || ''`)), JSON.stringify(b5));
  await c.snap(path.join(shotDir, 'b-done-ja.png'));
  jian('B 段无渲染层异常', (c.errors() || []).length === 0, JSON.stringify((c.errors() || []).slice(0, 3)));
  await stop();

  /* ══════ C. 供应商通了但没模型：1/4 → 去拉取；补模型后 2/4 → 去创建牛马 ══════ */
  console.log('\n[C] 模型与牛马步骤');
  profile = path.join(os.tmpdir(), 'warmy-r98-c-' + Date.now());
  writeProfile(profile, baseSettings({
    guideDone: false,
    providers: [{ id: 'p-r98', biaoQian: 'P-R98', protocol: 'openai-compatible', baseURL: 'http://127.0.0.1:9/v1', models: [], hasKey: false }],
  }));
  await start(Number(process.env.R98_PORT_C || 9823), profile);
  await wait('window.__warmyBootDataReady === true', 20000);
  await wait('!!document.getElementById("startGuide")', 15000);
  await js(`window.warmy.providerKeySet({ providerId: 'p-r98', apiKey: 'test-key-r98' })`);
  await js('window.__warmyReloadProviders?.()');
  await sleep(1100);
  const c1 = await guideDom();
  jian('供应商已接通、还没模型：1/4，第 2 步展开', c1 && /1\/4/.test(c1.sub) && c1.active === 1, JSON.stringify(c1));
  jian('点「去拉取模型」', await clickGuide('go'));
  await sleep(1000);
  const c2 = await js(`(() => ({
    nav: document.querySelector('.ceLanTiaoMu.jiHuo')?.getAttribute('data-nav') || '',
    sec: document.querySelector('#peiZhiDaoHang button.qiYong')?.getAttribute('data-sec') || '',
    fetchPulse: !!(document.querySelector('#provLieBiao [data-fetch]')?.classList.contains('startGuidePulse')),
    panel: !!document.getElementById('startGuide'), pill: !!document.getElementById('startGuidePill'),
  }))()`);
  jian('去拉取：进入 设置 → 模型，拉取按钮被定位并脉冲，清单保持展开',
    c2 && c2.nav === 'settings' && c2.sec === 'model' && c2.fetchPulse && c2.panel === true && c2.pill === false, JSON.stringify(c2));

  /* 直接写出「已拉到模型」，验证清单会在状态变化后自动前进到牛马步骤 */
  await js(`(async () => {
    const r = await window.warmy.settingsGet();
    const ps = ((r && r.settings && r.settings.providers) || []).map((p) => p.id === 'p-r98' ? { ...p, models: ['m-r98'] } : p);
    await window.warmy.settingsSave({ providers: ps, providersSeeded: true });
    await window.__warmyReloadProviders?.();
    return true;
  })()`);
  await sleep(1100);
  const c3 = await guideDom();
  const c3st = await guideState();
  jian('状态变化后清单自动前进：2/4', c3 && c3.panel === true && /2\/4/.test(c3.sub) && c3st && c3st.ready[0] === true && c3st.ready[1] === true, JSON.stringify({ c3, c3st }));
  const c3b = await guideDom();
  jian('展开后停在牛马步骤', c3b && c3b.panel === true && c3b.active === 2, JSON.stringify(c3b));
  jian('点「去创建牛马」', await clickGuide('go'));
  await sleep(1000);
  const c4 = await js(`(() => {
    const root = document.getElementById('duiHuaKuangGen');
    return {
      nav: document.querySelector('.ceLanTiaoMu.jiHuo')?.getAttribute('data-nav') || '',
      prompt: !!root && !root.classList.contains('yinCang'),
      input: !!document.querySelector('#duiHuaKuangGen input'),
      title: document.getElementById('duiHuaKuangBiaoTi')?.textContent || '',
      panel: !!document.getElementById('startGuide'), pill: !!document.getElementById('startGuidePill'),
    };
  })()`);
  jian('去创建牛马：直接打开创建输入框，清单保持展开',
    c4 && c4.nav === 'singleAi' && c4.prompt && c4.input && c4.panel === true && c4.pill === false, JSON.stringify(c4));
  await js(`(() => {
    const inp = document.querySelector('#duiHuaKuangGen input');
    if (!inp) return false;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(inp, '验收牛马-引导');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    const bs = [...document.querySelectorAll('#duiHuaKuangDongZuoJi button')];
    bs[bs.length - 1]?.click();
    return true;
  })()`);
  const c5 = await wait(`window.__startGuide?.state?.().ready?.[2] === true`, 20000);
  const c5ui = await wait(`(() => { const root = document.getElementById('duiHuaKuangGen'); return !!root && !root.classList.contains('yinCang') && root.classList.contains('niuMaSheZhi'); })()`, 15000);
  jian('创建牛马后清单第 3 步变绿，并弹出该牛马设置', !!c5 && !!c5ui, JSON.stringify({ c5, c5ui }));

  /* 第 98 轮：牛马管理局页面已删除；右键会话行 → 设置 必须打开同一套设置弹窗 */
  await js(`document.querySelector('#duiHuaKuangDongZuoJi button')?.click()`);
  await sleep(300);
  const menuOpened = await js(`(() => {
    const row = [...document.querySelectorAll('#lieBiaoTi .lieBiaoTiaoMu')].find((e) => String(e.textContent || '').includes('验收牛马-引导'));
    if (!row) return { ok: false, row: false };
    const r = row.getBoundingClientRect();
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.round(r.left + 20), clientY: Math.round(r.top + 20) }));
    return { ok: true, row: true };
  })()`);
  await wait(`!!document.getElementById('shangXiaWenCaiDan')`, 5000);
  const menuText = await js(`[...document.querySelectorAll('#shangXiaWenCaiDan button')].map((b) => b.textContent || '').join('|')`);
  jian('右键牛马会话出现「设置」菜单', menuOpened && menuOpened.ok && /设置/.test(menuText || ''), JSON.stringify({ menuOpened, menuText }));
  const clickedSettings = await js(`(() => {
    const b = [...document.querySelectorAll('#shangXiaWenCaiDan button')].find((x) => /设置/.test(x.textContent || ''));
    if (!b) return false;
    b.click();
    return true;
  })()`);
  const modal = await wait(`(() => {
    const root = document.getElementById('duiHuaKuangGen');
    return !!root && !root.classList.contains('yinCang') && root.classList.contains('niuMaSheZhi')
      && !!document.getElementById('iMing') && !!document.getElementById('iSmartMoXing') && !!document.getElementById('iThinkLevel');
  })()`, 5000);
  jian('右键「设置」打开牛马设置弹窗（含名称/智能模式/思考级别）', !!clickedSettings && !!modal, JSON.stringify({ clickedSettings, modal }));
  jian('C 段无渲染层异常', (c.errors() || []).length === 0, JSON.stringify((c.errors() || []).slice(0, 3)));
  await stop();

  /* ══════ D. 重启：点过稍后只留胶囊；全部配好则静默完成 ══════ */
  console.log('\n[D] 重启与静默完成');
  profile = path.join(os.tmpdir(), 'warmy-r98-d-' + Date.now());
  writeProfile(profile, baseSettings({ guideDone: true }));
  await start(Number(process.env.R98_PORT_D1 || 9824), profile);
  await wait('window.__warmyBootDataReady === true', 20000);
  await sleep(1200);
  const d1 = await guideDom();
  const d1pill = await js(`document.getElementById('startGuidePill')?.innerText || ''`);
  jian('点过「稍后设置」后重启：不再自动弹面板，只留继续胶囊',
    d1 && d1.panel === false && d1.pill === true && /0\/4/.test(d1pill), JSON.stringify({ d1, d1pill }));
  await stop();

  // 同一 profile 改成全部配好、guideDone=false：应静默完成，不再出现任何清单元素
  const pj = JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8'));
  pj.guideDone = false;
  pj.guideChatDone = true;
  pj.providers = [{ id: 'p-d', biaoQian: 'P-D', protocol: 'openai-compatible', baseURL: JIDI, models: ['m-d'], hasKey: true }];
  pj.instances = [{ id: 'i-d', ming: '牛马-D', name: '牛马-D', status: 'running', model: 'm-d', defaultModel: 'm-d', chain: ['m-d'], chainDisabled: [] }];
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify(pj, null, 2), 'utf8');
  await start(Number(process.env.R98_PORT_D2 || 9825), profile);
  await wait('window.__warmyBootDataReady === true', 20000);
  await sleep(1500);
  const d2 = await js(`(() => ({ panel: !!document.getElementById('startGuide'), pill: !!document.getElementById('startGuidePill'), st: window.__startGuide?.state?.() }))()`);
  const d2st = await js('window.warmy.setupState()');
  jian('四步全配好后重启：不弹面板、不留胶囊，guideDone 静默落盘',
    d2 && d2.panel === false && d2.pill === false && d2st && d2st.guideDone === true, JSON.stringify({ d2, d2st }));
  jian('D 段无渲染层异常', (c.errors() || []).length === 0, JSON.stringify((c.errors() || []).slice(0, 3)));
  await stop();
} catch (e) {
  bad('门禁执行异常', String((e && (e.stack || e.message)) || e));
} finally {
  await stop();
  try { mock.close(); } catch { /* noop */ }
  try { fs.rmSync(shotDir, { recursive: true, force: true }); } catch { /* noop */ }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
}

console.log(`\n==== verify-r98-onboarding: ${okN} ok / ${failN} FAIL ====`);
process.exit(failN ? 1 : 0);
