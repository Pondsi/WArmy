/**
 * verify-round39-quota-ui.mjs —— 「右键模型 ⇒ 额度窗」的**真机**证明（第 39 轮）
 *
 * 用户要的东西全在界面上，所以断言也必须打在界面上：字段齐不齐、遮罩是不是真的把主界面
 * 挡住了、主界面还拖不拖得动、单位填 0.5k 存进去是不是 500、恢复默认是不是**真的两下**才执行。
 * 这些都grep 不出来 —— 以前每一轮"看着改了、其实没接上"的洞都是这么漏掉的。
 *
 * 真右键用 `Input.dispatchMouseEvent(button:'right')` ⇒ 走 Chromium 的原生 contextmenu 通路，
 * 而不是在 JS 里 dispatch 一个假事件（那样测不到"通用右键菜单会不会抢事件"这条真风险）。
 *
 * 跑法：node dev/gates/verify-round39-quota-ui.mjs        （不联网、不要密钥；只用 Ollama 地址占位）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const G = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PKG = path.join(G, 'packages', 'app-shell');
const MAIN = path.join(PKG, 'dist', 'electron-main.js');
const ELECTRON = path.join(PKG, 'node_modules', 'electron', 'dist', 'electron.exe');
const PORT = Number(process.env.R39Q_PORT || 9988);
const MO = 'r39-ceshi-moxing';
const { attach, sleep, bootWait } = await import(pathToFileURL(path.join(PKG, 'scripts', 'cdp-lib.mjs')).href);

let ok = 0; const shi = [];
const jian = (l, p, d) => { if (p) { ok += 1; console.log('  ok   ' + l); return; } shi.push(l); console.log('  FAIL ' + l + (d ? ' ← ' + String(d).slice(0, 260) : '')); };

const profile = path.join(os.tmpdir(), 'warmy-r39-quota-' + Date.now());
fs.mkdirSync(profile, { recursive: true });
const peiZhi = {
  yuYan: 'zh-CN', setupDone: true, privacyConsent: true, guideDone: true, providersSeeded: true,
  globalSecurity: 'normal', trustedFolders: [], asrEnabled: false, specialModels: {},
  providers: [{
    id: 'ollama-r39', biaoQian: 'Ollama-r39', protocol: 'ollama',
    baseURL: 'http://127.0.0.1:11434', defaultModel: '', models: [MO], staleModels: {}, hasKey: false,
  }],
  instances: [{ id: 'inst-r39q-1', ming: '牛马-1', name: '牛马-1', status: 'running', defaultModel: '', currentModel: '', chain: [], chainDisabled: [] }],
};
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify(peiZhi, null, 2), 'utf8');
const sheZhiWen = path.join(profile, 'settings.json');
const du = () => JSON.parse(fs.readFileSync(sheZhiWen, 'utf8'));

const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.MIMO_KEY_FILE;
const child = spawn(ELECTRON, ['--remote-debugging-port=' + PORT, '--disable-features=CalculateNativeWinOcclusion', '--user-data-dir=' + profile, MAIN],
  { cwd: PKG, stdio: ['ignore', 'ignore', 'ignore'], env });
let c = null;
const js = (e) => c.evaluate('(async function(){ try { return await (' + e + '); } catch (err) { return { __err: String((err && (err.stack||err.message)) || err).slice(0,240) }; } })()');

const youJi = async (x, y) => {
  await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', clickCount: 1 });
  await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', clickCount: 1 });
};

try {
  let lian = false;
  for (let i = 0; i < 90; i++) { try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) { lian = true; break; } } catch { /* 还没起 */ } await sleep(1000); }
  if (!lian) { jian('CDP 起得来', false, 'timeout'); process.exit(1); }
  c = await attach(PORT, { biaoQian: 'r39quota', callTimeout: 60000 });
  await c.send('Runtime.enable');
  try { await bootWait(c, '', 60000); } catch { /* 起没起全由后面的断言判（与 qr 档同一口径） */ }

  // 进设置页并让「模型」分区可见。两件麻烦事都是现场试出来的：
  //  ① 点一次导航确实进得去（`peiZhiMoShi`），但**约 1.5 秒后会被一次状态刷新重新藏掉**
  //     ⇒ 必须轮询补点，直到 chip 量得到位置，而不是"点一次然后指望它一直开着"；
  //  ② 模型那张卡默认是**折叠**的（`sheZhiKa yinCang`）⇒ 要点一次分区标题 `#moXingGuanLiZheDie` 展开。
  let chip = null;
  for (let i = 0; i < 24 && !(chip && chip.x); i++) {
    await js("(() => { const n = document.querySelector('.ceLanTiaoMu[data-nav=\"settings\"]'); if (n) n.click(); return !!n; })()");
    await sleep(500);
    await js("(() => { const b = document.querySelector('#peiZhiDaoHang button[data-sec=\"model\"]'); if (b) b.click(); return !!b; })()");
    await sleep(300);
    await js("(() => { const ka = document.querySelector('#provLieBiao'); const t = ka && ka.closest('.sheZhiKa'); if (t && t.classList.contains('yinCang')) { const h = document.querySelector('#moXingGuanLiZheDie'); if (h) h.click(); return 'zhankai'; } return 'yiKai'; })()");
    await sleep(400);
    chip = await js('(() => { const e = document.querySelector(\'#provLieBiao .moXingChip[data-m="' + MO + '"]\'); if (!e) return null; e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); if (!r.width || !r.height) return { x: 0, y: 0, ling: true, wen: e.textContent }; return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), wen: e.textContent }; })()');
  }
  jian('设置→模型 里看得见这个模型，并且**量得到位置**（切对分区、没被折叠成 display:none）', !!chip && !!chip.x && !chip.__err, JSON.stringify(chip));
  if (!chip || !chip.x) throw new Error('没有可见的模型 chip，后面没法测');

  await youJi(chip.x, chip.y);
  await sleep(700);
  const chuang = await js(`(() => {
    const k = document.querySelector('.moXingYuEDan');
    if (!k) return null;
    const qu = (id) => { const i = k.querySelector('#' + id); return i ? { v: i.value, step: i.getAttribute('step') } : null; };
    const dan = (n) => { const r = k.querySelector('input[name=' + n + ']:checked'); return r ? r.value : null; };
    return {
      title: (k.querySelector('div') || {}).textContent || '',
      ctx: qu('mqCtx'), out: qu('mqOut'), rpm: qu('mqRpm'), tpm: qu('mqTpm'),
      ctxU: dan('mqCtxU'), rpmU: dan('mqRpmU'), tpmU: dan('mqTpmU'), outU: dan('mqOutU'),
      inOpts: [...k.querySelectorAll('input[name=mqIn]')].map((x) => x.value),
      outOpts: [...k.querySelectorAll('input[name=mqOutT]')].map((x) => x.value),
      you: { reset: !!k.querySelector('#mqReset'), cancel: !!k.querySelector('#mqCancel'), ok: !!k.querySelector('#mqOk'), tags: !!k.querySelector('#mqTags') },
      zhe: !!document.querySelector('.shouDongMoXingZhe'),
    };
  })()`);
  jian('右键真的弹出了额度窗，字段齐：窗口/输出/rpm/tpm + 输入/输出类型 + 恢复默认/取消/确定',
    !!chuang && !chuang.__err && !!chuang.ctx && !!chuang.out && !!chuang.rpm && !!chuang.tpm && chuang.you.reset && chuang.you.cancel && chuang.you.ok,
    JSON.stringify(chuang));
  const danWei = await js(`(() => {
    const k = document.querySelector('.moXingYuEDan');
    const ge = (n) => [...k.querySelectorAll('input[name=' + n + ']')].map((r) => r.value).join(',');
    const zhi = (id) => { const i = k.querySelector('#' + id); return i ? i.value : null; };
    const wei = (id) => { const i = k.querySelector('#' + id); const hang = i && i.parentElement; return (hang && hang.textContent || '').replace(/\\s+/g, '').trim(); };
    return {
      ctxU: ge('mqCtxU'), outU: ge('mqOutU'),
      rpmDanWei: k.querySelector('input[name=mqRpmU]') ? 'you' : 'wu',
      tpmDanWei: k.querySelector('input[name=mqTpmU]') ? 'you' : 'wu',
      ctxZhi: zhi('mqCtx'), ctxXuan: (k.querySelector('input[name=mqCtxU]:checked') || {}).value,
      outZhi: zhi('mqOut'), outXuan: (k.querySelector('input[name=mqOutU]:checked') || {}).value,
      rpmZhi: zhi('mqRpm'), tpmZhi: zhi('mqTpm'), rpmWei: wei('mqRpm'), tpmWei: wei('mqTpm'),
    };
  })()`);
  jian('单位只有「上下文窗口 / 输出」有 k 与 m 两个选项；**rpm 与 tpm 没有单位**（尾缀是"次/分钟"、"token/分钟"）',
    !!danWei && danWei.ctxU === 'k,m' && danWei.outU === 'k,m'
    && danWei.rpmDanWei === 'wu' && danWei.tpmDanWei === 'wu'
    && /次\/分钟/.test(String(danWei.rpmWei || '')) && /token\/分钟/.test(String(danWei.tpmWei || '')),
    JSON.stringify(danWei));
  jian('没拉到的项（输出上限）留空，单位落在默认 m；**拉不到窗口 ⇒ 默认 128K**',
    !!danWei && danWei.outZhi === '' && danWei.outXuan === 'm' && Number(danWei.ctxZhi) === 128 && danWei.ctxXuan === 'k',
    JSON.stringify(danWei));
  jian('默认值按推导链（窗口 → tpm → rpm）：tpm = max(300000, 128K×2) = 300000；rpm = max(100, 300000÷4000) = 100',
    !!danWei && Number(danWei.tpmZhi) === 300000 && Number(danWei.rpmZhi) === 100,
    JSON.stringify(danWei));
  jian('输入/输出是两套选项（输入含硬盘、输出含音频），不是同一组复用',
    !!chuang && chuang.inOpts.join(',') === 'text,image,disk,video,classify' && chuang.outOpts.join(',') === 'text,image,audio,video,classify',
    JSON.stringify(chuang && { in: chuang.inOpts, out: chuang.outOpts }));

  // 模态：主界面点不动 + 标题栏仍可拖动
  const zheZhao = await js(`(() => {
    const z = document.querySelector('.shouDongMoXingZhe');
    if (!z) return { zhe: false };
    const mu = document.querySelector('.ceLanTiaoMu[data-nav="settings"]') || document.querySelector('button');
    const r = mu.getBoundingClientRect();
    const ding = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
    const biaoTi = document.querySelector('.biaoTiLan, .titleBar, #biaoTiLan, [class*="biaoTi"]');
    const qu = biaoTi ? (getComputedStyle(biaoTi).webkitAppRegion || getComputedStyle(biaoTi).getPropertyValue('-webkit-app-region')) : '';
    return { zhe: true, dianDao: ding ? (ding.className || ding.id || ding.tagName) : 'null', biaoTiQu: String(qu || ''), biaoTiLei: biaoTi ? biaoTi.className : '(没找到标题栏)' };
  })()`);
  jian('弹窗开着时**主界面点不动**（遮罩真的挡住了左侧导航的命中测试）',
    !!zheZhao && zheZhao.zhe === true && /shouDongMoXingZhe/.test(String(zheZhao.dianDao || '')), JSON.stringify(zheZhao));
  jian('标题栏仍是 app-region: drag ⇒ **主界面还能整窗拖动**，弹窗跟着走（用户明确要的行为）',
    !!zheZhao && zheZhao.biaoTiQu === 'drag', JSON.stringify(zheZhao));

  // 填值 + 勾类型 ⇒ 标签预览（rpm/tpm 是纯数字，没有单位可选）
  const tian = await js(`(() => {
    const k = document.querySelector('.moXingYuEDan');
    const set = (id, v) => { const i = k.querySelector('#' + id); i.value = String(v); i.dispatchEvent(new Event('input', { bubbles: true })); };
    const unit = (n, u) => { const r = k.querySelector('input[name=' + n + '][value="' + u + '"]'); if (r) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); } };
    set('mqCtx', 128); unit('mqCtxU', 'k');
    set('mqOut', 8); unit('mqOutU', 'k');
    set('mqRpm', 600);
    set('mqTpm', 500000);
    const gx = (n, v) => { const i = k.querySelector('input[name=' + n + '][value="' + v + '"]'); if (i && !i.checked) { i.click(); } };
    gx('mqIn', 'image'); gx('mqIn', 'disk'); gx('mqOutT', 'image');
    return { biaoQian: [...k.querySelectorAll('#mqTags .moXingNengLi')].map((s) => s.textContent) };
  })()`);
  jian('勾了输入图像 + 输出图像 ⇒ 标签里**同时有「看图」和「画图」**（输入侧不许只给一个"图像"就完事）',
    !!tian && !tian.__err && tian.biaoQian.includes('看图') && tian.biaoQian.includes('画图'), JSON.stringify(tian));

  await js("(() => { const b = document.querySelector('.moXingYuEDan #mqOk'); if (b) b.click(); return !!b; })()");
  await sleep(1200);
  const z = (du().modelQuota || {})[MO] || {};
  const huan = (n, u) => Math.round(Number(n || 0) * (u === 'm' ? 1000000 : 1000));
  jian('点确定后落盘：窗口/输出按单位折算成 token（128k→128000、8k→8000），**rpm/tpm 原样是数字**（600 次、500000 token）',
    huan(z.ctxNum, z.ctxUnit) === 128000 && huan(z.outNum, z.outUnit) === 8000
    && Number(z.rpm) === 600 && Number(z.tpm) === 500000,
    JSON.stringify(z));
  jian('输入/输出类型也存下来了（下次打开不用重勾）',
    Array.isArray(z.inTypes) && z.inTypes.includes('image') && Array.isArray(z.outTypes) && z.outTypes.includes('image'),
    JSON.stringify(z));

  /**
   * **快照语义（用户明确要求的重点）**：只改上下文窗口 ⇒ rpm/tpm 必须**原地不动**。
   * 这一条是"联动"最容易偷偷回来的地方（窗口和 tpm 看起来天然相关，一联动用户设的次数就没了）。
   */
  await youJi(chip.x, chip.y);
  await sleep(700);
  await js(`(() => {
    const k = document.querySelector('.moXingYuEDan');
    const i = k.querySelector('#mqCtx'); i.value = '256'; i.dispatchEvent(new Event('input', { bubbles: true }));
    k.querySelector('#mqOk').click(); return true;
  })()`);
  await sleep(1200);
  const z2 = (du().modelQuota || {})[MO] || {};
  jian('只改上下文窗口（128k→256k）⇒ **rpm/tpm/输出/类型全部保持原样**（快照，不联动重算）',
    huan(z2.ctxNum, z2.ctxUnit) === 256000 && Number(z2.rpm) === 600 && Number(z2.tpm) === 500000
    && huan(z2.outNum, z2.outUnit) === 8000 && Array.isArray(z2.inTypes) && z2.inTypes.includes('disk'),
    JSON.stringify(z2));

  // 重新打开 ⇒ 读回一致
  await youJi(chip.x, chip.y);
  await sleep(700);
  const hui = await js(`(() => {
    const k = document.querySelector('.moXingYuEDan');
    if (!k) return null;
    const g = (id) => (k.querySelector('#' + id) || {}).value;
    const u = (n) => { const r = k.querySelector('input[name=' + n + ']:checked'); return r ? r.value : null; };
    return { ctx: g('mqCtx'), ctxU: u('mqCtxU'), out: g('mqOut'), rpm: g('mqRpm'), tpm: g('mqTpm') };
  })()`);
  jian('再次右键打开，窗里的值与保存的一致（读得回来，不是只写进去了）',
    !!hui && !hui.__err && Number(hui.ctx) === 256 && hui.ctxU === 'k' && Number(hui.out) === 8
    && Number(hui.rpm) === 600 && Number(hui.tpm) === 500000,
    JSON.stringify(hui));

  // 恢复默认：要两下
  await js("(() => { const b = document.querySelector('.moXingYuEDan #mqReset'); if (b) b.click(); return !!b; })()");
  await sleep(500);
  const yiXia = await js("(() => { const b = document.querySelector('.moXingYuEDan #mqReset'); return b ? b.textContent : null; })()");
  const yiXiaCun = (du().modelQuota || {})[MO];
  jian('「恢复默认」第一下**只要求确认，不动数据**（覆盖项还在）',
    /确认/.test(String(yiXia || '')) && !!yiXiaCun, JSON.stringify({ anNiu: yiXia, you: !!yiXiaCun }));
  await js("(() => { const b = document.querySelector('.moXingYuEDan #mqReset'); if (b) b.click(); return !!b; })()");
  await sleep(900);
  const erXia = (du().modelQuota || {})[MO] || {};
  jian('第二下才真的恢复：**按拉取信息重算并存下来**（这模型没拉到任何信息 ⇒ 窗口回 128k、tpm 回 300000、rpm 回 100）',
    huan(erXia.ctxNum, erXia.ctxUnit) === 128000 && Number(erXia.rpm) === 100 && Number(erXia.tpm) === 300000,
    JSON.stringify(erXia));
  jian('恢复默认时**没拉到的项变回空的**（输出上限端点没给 ⇒ 不保留用户填的 8k，也不拿猜测值填）',
    erXia.outNum === undefined && Array.isArray(erXia.inTypes) && erXia.inTypes.join(',') === 'text',
    JSON.stringify(erXia));

  // 撤遮罩
  const jie = await js(`(() => {
    const z = document.querySelector('.shouDongMoXingZhe'); if (z) { z.click(); }
    return true;
  })()`);
  await sleep(600);
  const hou = await js(`(() => {
    const mu = document.querySelector('.ceLanTiaoMu[data-nav="settings"]') || document.querySelector('button');
    const r = mu.getBoundingClientRect();
    const ding = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
    return { ceng: !!document.querySelector('.shouDongMoXingZhe'), dianDao: ding ? (ding.className || ding.tagName) : 'null' };
  })()`);
  jian('关掉弹窗后遮罩撤掉，主界面立刻恢复可点（不能留下透明的点击层）',
    !!jie && hou.ceng === false && !/shouDongMoXingZhe/.test(String(hou.dianDao || '')), JSON.stringify(hou));
} catch (e) {
  jian('整条路跑完没抛错', false, String((e && e.message) || e).slice(0, 240));
} finally {
  try { if (c) c.close && c.close(); } catch { /* noop */ }
  try { child.kill(); } catch { /* noop */ }
  for (let i = 0; i < 20 && fs.existsSync(profile); i++) { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { await sleep(500); } }
}
console.log('\n==== verify-round39-quota-ui：' + ok + ' ok / ' + shi.length + ' FAIL ====');
for (const s of shi) console.log('  ✗ ' + s);
process.exit(shi.length ? 1 : 0);
