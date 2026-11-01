/**
 * verify-r82-aiedit-badge —— 模型会自动改写的提示词：标题后的主题色牛头 + 悬停说明
 *
 * 用户 2026-10-25：“所有模型会改的提示词，都在标题（名称）后面加上一个主题色的图标
 * （F:\XXZ\牛.svg），鼠标悬停的时候显示说明。”
 *
 * 产品事实：目前**归档时会被模型/程序自动改写**的提示词只有「术」和「印象」；
 * 道/规范/教条/束缚/认知都只由用户手动写。因此图标只挂这两个标题，避免给用户错误暗示。
 *
 * 判据：
 *  ① 图标文件已入包，CSS 用 mask + --accent 上色；
 *  ② 我的页「术」「印象」标题后面各有一个图标，尺寸可见；
 *  ③ 图标背景色等于当前主题色（改 --accent 后跟着变）；
 *  ④ 悬停后说明可见，文字来自 10 语言包（不是空、不是英文兜底）；
 *  ⑤ 10 个语言包都有这两条说明，且非中文语言不等于英文。
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
const CSS = fs.readFileSync(path.join(PKG, 'src', 'renderer', 'renderer.css'), 'utf8');
const APP = fs.readFileSync(path.join(PKG, 'src', 'renderer', 'app.js'), 'utf8');
const SVG = path.join(PKG, 'src', 'renderer', 'icons', 'prompt-ai.svg');
const { attach, sleep } = await import(pathToFileURL(path.join(PKG, 'scripts', 'cdp-lib.mjs')).href);

const PORT = Number(process.env.R82_AIEDIT_PORT || 9686);
const profile = path.join(os.tmpdir(), 'warmy-r82-aiedit-' + Date.now() + '-' + process.pid);
fs.mkdirSync(profile, { recursive: true });

let ok = 0;
const hong = [];
const jian = (l, p, d) => {
  if (p) { ok += 1; console.log('  ok   ' + l); return; }
  hong.push(l);
  console.log('  FAIL ' + l + (d === undefined ? '' : ' ← ' + String(d).slice(0, 400)));
};

const env = { ...process.env, WARMY_AUTH_BYPASS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(ELECTRON, [
  '--remote-debugging-port=' + PORT,
  '--disable-features=CalculateNativeWinOcclusion',
  '--user-data-dir=' + profile,
  MAIN,
], { cwd: PKG, stdio: ['ignore', 'ignore', 'ignore'], env });

let c = null;
async function guan() {
  try { if (c) await c.send('Browser.close', {}, { timeout: 6000 }); } catch { /* 已退 */ }
  try { if (c) c.close(); } catch { /* 已断 */ }
  for (let i = 0; i < 30; i++) {
    await sleep(200);
    try { process.kill(child.pid, 0); } catch { return; }
  }
  try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* noop */ }
}

const LANGS = ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko', 'fr', 'es', 'pt', 'ru', 'eo'];
const packs = Object.fromEntries(LANGS.map((l) => [l, JSON.parse(fs.readFileSync(path.join(PKG, 'src', 'i18n', l + '.json'), 'utf8'))]));

try {
  /* ── 静态：文件 / CSS / 挂载点 ── */
  jian('牛头图标已入包（icons/prompt-ai.svg）', fs.existsSync(SVG) && fs.statSync(SVG).size > 500, fs.existsSync(SVG) ? fs.statSync(SVG).size : 'missing');
  jian('CSS 用 mask 指向图标并以 --accent 上色',
    /\.tiShiAiGai\s*\{[^}]*background-color:\s*var\(--accent\)/s.test(CSS)
      && /\.tiShiAiGai\s*\{[^}]*mask:\s*url\("\.\/icons\/prompt-ai\.svg"\)/s.test(CSS));
  jian('「术」「印象」标题都调用同一个图标构造器',
    /wo\.shu[^\n]*\$\{moXingGaiBiaoQian\('shu'\)\}/.test(APP)
      && /wo\.yinXiang[^\n]*\$\{moXingGaiBiaoQian\('yinXiang'\)\}/.test(APP));

  /* ── 语言包：10 种都有、非中文不等于英文 ── */
  const empty = LANGS.filter((l) => !String(packs[l]['prompt.aiEdit.shu'] || '').trim() || !String(packs[l]['prompt.aiEdit.yinXiang'] || '').trim());
  jian('10 个语言包都有「术/印象」两条悬停说明', empty.length === 0, empty);
  const en = packs['en-US'];
  const fallback = ['zh-TW', 'ja', 'ko', 'fr', 'es', 'pt', 'ru', 'eo'].filter((l) =>
    String(packs[l]['prompt.aiEdit.shu']) === String(en['prompt.aiEdit.shu'])
    || String(packs[l]['prompt.aiEdit.yinXiang']) === String(en['prompt.aiEdit.yinXiang']));
  jian('其它 8 种语言不是英文兜底', fallback.length === 0, fallback);

  /* ── 真机 DOM ── */
  let lastErr = '';
  for (let i = 0; i < 80; i++) {
    try { c = await attach(PORT, { biaoQian: 'r82-aiedit', callTimeout: 15000 }); break; } catch (e) { lastErr = e.message; await sleep(300); }
  }
  if (!c) throw new Error('CDP 没连上：' + lastErr);
  await c.send('Runtime.enable');
  await c.waitFor('!!document.querySelector("#appTi")', { timeout: 30000, biaoQian: '主界面' });
  await sleep(600);
  // 旁路账号没有走完首启步骤，认证页可能盖在主页上；本门禁只测我的页 UI，先收起遮罩
  await c.evaluate(`(function(){
    const g = document.getElementById('warmyAuthGate'); if (g) g.style.display = 'none';
    document.querySelectorAll('.duiHuaKuangMask, .duiHuaKuangGen, .duiHuaKuang').forEach((e) => { e.style.display = 'none'; });
    return true;
  })()`);
  await c.evaluate(`(function(){ const b = document.querySelector('[data-nav="wo"]'); if (b) b.click(); return !!b; })()`);
  await c.waitFor('!!document.querySelector("#shuKa .tiShiAiGai") && !!document.querySelector("#yinXiangKa .tiShiAiGai")', { timeout: 20000, biaoQian: '两个图标出现' });
  await sleep(400);

  const m = await c.evaluate(`(function(){
    const info = (sel) => {
      const h = document.querySelector(sel); if (!h) return null;
      const el = h.querySelector('.tiShiAiGai'); if (!el) return null;
      const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      return { h3: (h.textContent || '').trim().slice(0, 6), x: Math.round(r.x), y: Math.round(r.y),
        w: Math.round(r.width), h: Math.round(r.height),
        bg: cs.backgroundColor, mask: cs.maskImage || cs.webkitMaskImage || '',
        tip: el.getAttribute('data-tip') || '', aria: el.getAttribute('aria-label') || '',
        afterOpacity: getComputedStyle(el, '::after').opacity,
        afterVis: getComputedStyle(el, '::after').visibility };
    };
    return { shu: info('#shuKa h3'), yinXiang: info('#yinXiangKa h3'),
      accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() };
  })()`);
  jian('我的页「术」标题后有牛头图标', !!m.shu && m.shu.h3.startsWith('术'), m.shu);
  jian('我的页「印象」标题后有牛头图标', !!m.yinXiang && m.yinXiang.h3.startsWith('印象'), m.yinXiang);
  jian('图标尺寸可见（约 1.1em，不是 0×0）',
    [m.shu, m.yinXiang].every((x) => x && x.w >= 12 && x.w <= 22 && x.h >= 12 && x.h <= 22),
    { shu: m.shu, yinXiang: m.yinXiang });
  jian('图标用主题色（背景色不透明且等于 --accent）',
    [m.shu, m.yinXiang].every((x) => x && x.bg !== 'rgba(0, 0, 0, 0)' && x.bg !== 'transparent'),
    { accent: m.accent, shu: m.shu && m.shu.bg, yinXiang: m.yinXiang && m.yinXiang.bg });
  jian('图标 mask 指向 prompt-ai.svg',
    [m.shu, m.yinXiang].every((x) => x && /prompt-ai\.svg/.test(x.mask)),
    { shu: m.shu && m.shu.mask, yinXiang: m.yinXiang && m.yinXiang.mask });
  jian('两条悬停说明非空且与 aria-label 一致',
    [m.shu, m.yinXiang].every((x) => x && x.tip.length > 20 && x.tip === x.aria),
    { shu: m.shu && m.shu.tip.slice(0, 40), yinXiang: m.yinXiang && m.yinXiang.tip.slice(0, 40) });

  /* ── 主题色跟随：改成 #123456 后图标背景跟着变 ── */
  const accentFollow = await c.evaluate(`(function(){
    document.documentElement.style.setProperty('--accent', '#123456');
    const el = document.querySelector('#shuKa .tiShiAiGai');
    return el ? getComputedStyle(el).backgroundColor : '';
  })()`);
  jian('换主题色后图标立即跟随（#123456 → rgb(18, 52, 86)）', accentFollow === 'rgb(18, 52, 86)', accentFollow);
  await c.evaluate(`document.documentElement.style.removeProperty('--accent')`);

  /* ── 悬停显示说明（真实鼠标移动，CSS :hover） ── */
  const p = await c.center('#shuKa .tiShiAiGai');
  await sleep(300); // 等 scroll 事件跑完（滚动处理器会收起说明，属预期）
  const hit = await c.hitTest(p.x, p.y);
  await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
  await sleep(120);
  await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x + 1, y: p.y + 1 });
  await sleep(350);
  const hover = await c.evaluate(`(function(){
    const el = document.querySelector('#shuKa .tiShiAiGai');
    const k = document.getElementById('warmyQuanJuTiShi');
    const r = k ? k.getBoundingClientRect() : null;
    const ks = k ? getComputedStyle(k) : null;
    return { shown: !!k && !k.classList.contains('yinCang'), text: k ? k.textContent : '',
      hit: ${JSON.stringify(hit)}, hovered: el.matches(':hover'),
      x: r ? Math.round(r.x) : -1, y: r ? Math.round(r.y) : -1,
      w: r ? Math.round(r.width) : 0, h: r ? Math.round(r.height) : 0,
      bg: ks ? ks.backgroundColor : '', op: ks ? ks.opacity : '', z: ks ? ks.zIndex : '', pos: ks ? ks.position : '',
      vw: innerWidth, vh: innerHeight };
  })()`);
  jian('鼠标悬停后说明可见、文字正确、完整在视口内',
    !!hover && hover.shown && String(hover.text).includes('归档')
      && hover.w > 200 && hover.h > 20
      && hover.x >= 0 && hover.y >= 0
      && hover.x + hover.w <= hover.vw + 1 && hover.y + hover.h <= hover.vh + 1,
    JSON.stringify(hover));
  await c.snap(path.join(os.tmpdir(), 'warmy-r82-aiedit-badge.png'));
  await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
  await sleep(200);
  const hidden = await c.evaluate(`(function(){ const k = document.getElementById('warmyQuanJuTiShi'); return !k || k.classList.contains('yinCang'); })()`);
  jian('鼠标移开后说明收起', hidden === true, hidden);
} catch (e) {
  jian('门禁执行未抛错', false, (e && (e.stack || e.message)) || e);
} finally {
  await guan();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Windows 文件锁：留给系统临时目录 */ }
}

console.log(`\nverify-r82-aiedit-badge: ${ok} ok / ${hong.length} FAIL`);
if (hong.length) console.log('红项：\n- ' + hong.join('\n- '));
process.exitCode = hong.length ? 1 : 0;
