/**
 * 门禁：**聊天框工具栏**（本轮真机反馈的三件事）
 *   ① 插入选项移到**思考级别左边**，并给它一个与本行图标同一套画法的图标；
 *   ② 思考级别点开是**横向滑块**，左 = 灵机（关闭）、右 = 自然（自动），就按这个顺序；
 *   ③ 勾选「由牛马管理局设置」⇒ 滑块**变灰不可拖**；取消勾选 ⇒ 可以随意拖，
 *      拖动会自动取消跟随，并且手动档位**保持**（写进设置、重启还在）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { attach, sleep } from './cdp-lib.mjs';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(selfDir, '..');
const PORT = Number(process.env.WARMY_THINK_CDP_PORT || 9991);
const electron = path.join(pkgRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const mainJs = path.join(pkgRoot, 'dist', 'electron-main.js');
const profile = path.join(os.tmpdir(), 'warmy-think-gate-profile');

let pass = 0;
let fail = 0;
function check(l, ok, d) {
  if (ok) { pass++; console.log('  ok  ' + l); }
  else { fail++; console.log('  FAIL ' + l, d === undefined ? '' : JSON.stringify(d).slice(0, 400)); }
}

// ── ① 静态：顺序 + 图标 + 结构 ──
const html = fs.readFileSync(path.join(pkgRoot, 'src', 'renderer', 'index.html'), 'utf8');
const iChaRu = html.indexOf('id="urgencyDd"');
const iSiKao = html.indexOf('id="siKaoDd"');
check('插入选项在**思考级别左边**（HTML 顺序）', iChaRu > 0 && iSiKao > 0 && iChaRu < iSiKao, { iChaRu, iSiKao });
check('插入触发器有图标（本行同一套 24×24 描边画法）', /class="ico chaRuIco"[\s\S]{0,220}stroke="currentColor"/.test(html), 'chaRuIco');
check('思考级别卡片里有「由牛马管理局设置」勾选框', /id="siKaoGenSuiJu"/.test(html) && /data-i18n="model\.think\.byAgency"/.test(html));
check('思考级别卡片里是**横向滑块**（range input）', /type="range"[^>]*id="siKaoHuaKuai"|id="siKaoHuaKuai"[^>]*type="range"/.test(html), 'siKaoHuaKuai');
check('左端是灵机、右端是自然（data-i18n 顺序）', (() => {
  const kuai = html.slice(html.indexOf('class="siKaoKaBiao"'), html.indexOf('class="siKaoKaBiao"') + 400);
  const iOff = kuai.indexOf('model.think.off');
  const iAuto = kuai.indexOf('model.think.auto');
  return iOff > 0 && iAuto > 0 && iOff < iAuto;
})(), 'label order');
const css1 = fs.readFileSync(path.join(pkgRoot, 'src', 'renderer', 'app.css'), 'utf8');
const css2 = fs.readFileSync(path.join(pkgRoot, 'src', 'renderer', 'renderer.css'), 'utf8');
check('两份 CSS 都有"勾选后滑块变灰不可拖"的样式（且一致）', /\.siKaoHuaKuai:disabled\s*\{[^}]*grayscale/.test(css1) && /\.siKaoHuaKuai:disabled\s*\{[^}]*grayscale/.test(css2));

// ── ③ 运行时：真启动 + 点开 + 勾选/拖动 ──
fs.rmSync(profile, { recursive: true, force: true });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [
  `--remote-debugging-port=${PORT}`,
  '--disable-features=CalculateNativeWinOcclusion',
  `--user-data-dir=${profile}`,
  mainJs,
], { cwd: pkgRoot, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false, env });

async function waitCdp(secs = 40) {
  for (let i = 0; i < secs; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json`, { signal: AbortSignal.timeout(1200) }); if (r.ok) return true; } catch { /* retry */ }
    await sleep(500);
  }
  return false;
}

let c = null;
function jieShu() {
  try { if (c) c.close(); } catch { /* noop */ }
  try { child.kill('SIGKILL'); } catch { /* noop */ }
}

try {
  if (!(await waitCdp())) { console.error('CDP not up'); jieShu(); process.exit(2); }
  await sleep(4200);
  c = await attach(PORT, { biaoQian: 'think-gate', callTimeout: 20000 });
  await c.send('Runtime.enable');

  // 顺序：DOM 里插入触发器的横坐标 < 思考级别触发器的横坐标。
  // ⚠️ 全新 profile 没有选中会话 ⇒ 输入区整体未布局（宽度 0），这时坐标不可测，
  //    退回**HTML 顺序**这条断言（上面已独立断言过），并如实说明。
  const pai = await c.evaluate(`(function(){
    const a = document.getElementById('jinJiTrigger');
    const b = document.getElementById('siKaoTrigger');
    if (!a || !b) return null;
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    const list = [...document.querySelectorAll('.shuRuQuZuo > *')].map((x) => x.id);
    return { chaRuX: Math.round(ra.left), siKaoX: Math.round(rb.left), chaRuW: Math.round(ra.width), list };
  })()`);
  console.log('  · 位置: ' + JSON.stringify(pai));
  const buJuKeCe = !!(pai && pai.chaRuW > 0);
  if (buJuKeCe) check('运行时：插入按钮在思考级别按钮左边（实测坐标）', pai.chaRuX < pai.siKaoX, pai);
  else check('运行时不可测坐标（未选中会话 ⇒ 输入区未布局），以 HTML 顺序为准', Array.isArray(pai?.list) && pai.list.indexOf('urgencyDd') < pai.list.indexOf('siKaoDd'), pai);
  check('DOM 顺序里插入确实排在思考级别前面', Array.isArray(pai?.list) && pai.list.indexOf('urgencyDd') >= 0 && pai.list.indexOf('urgencyDd') < pai.list.indexOf('siKaoDd'), pai && pai.list);

  // 点开思考级别 → 出现滑块卡（用元素的 click()，不依赖像素命中：无会话时输入区不可见）
  await c.evaluate(`(function(){ document.getElementById('siKaoTrigger').click(); return true; })()`);
  await sleep(300);
  const kai = await c.evaluate(`(function(){
    const ka = document.getElementById('siKaoCaiDan');
    const ju = document.getElementById('siKaoGenSuiJu');
    const hk = document.getElementById('siKaoHuaKuai');
    if (!ka || !ju || !hk) return null;
    return {
      kaiZhe: !ka.classList.contains('yinCang'),
      juXuan: ju.checked, hkDisabled: hk.disabled,
      min: hk.min, max: hk.max, value: hk.value,
      dang: (document.getElementById('siKaoKaDang') || {}).textContent || '',
      biaoQian: (document.getElementById('siKaoBiaoQian') || {}).textContent || '',
    };
  })()`);
  console.log('  · 打开后: ' + JSON.stringify(kai));
  check('点开后滑块卡出现', !!(kai && kai.kaiZhe === true), kai);
  check('默认勾选「由牛马管理局设置」', !!(kai && kai.juXuan === true), kai);
  check('勾选时滑块**不可拖**（disabled）', !!(kai && kai.hkDisabled === true), kai);
  check('滑块覆盖全部 8 档（0 ~ 7，灵机→自然）', !!(kai && kai.min === '0' && kai.max === '7'), kai);
  check('跟随模式下触发器等标签**不显示**手动档（不必重复牛马的名字）', !!(kai && kai.biaoQian === ''), kai);
  check('档位小字显示"当前跟随到的档"（有内容）', !!(kai && String(kai.dang).length > 0), kai);

  // 取消勾选 → 可拖
  const quXiao = await c.evaluate(`(function(){
    const ju = document.getElementById('siKaoGenSuiJu');
    const hk = document.getElementById('siKaoHuaKuai');
    ju.checked = false;
    ju.dispatchEvent(new Event('change', { bubbles: true }));
    return { hkDisabled: hk.disabled, value: hk.value, juXuan: ju.checked };
  })()`);
  console.log('  · 取消勾选: ' + JSON.stringify(quXiao));
  check('取消勾选后滑块**可以拖**（disabled=false）', quXiao.hkDisabled === false, quXiao);
  check('取消勾选时滑块停在"当前跟随到的档"（不跳档）', quXiao.value === kai.value, { a: quXiao.value, b: kai.value });

  // 拖到最左（灵机）→ 标签变灵机；拖动会自动取消跟随
  const zuiZuo = await c.evaluate(`(function(){
    const hk = document.getElementById('siKaoHuaKuai');
    hk.value = '0';
    hk.dispatchEvent(new Event('input', { bubbles: true }));
    const dang = (document.getElementById('siKaoKaDang') || {}).textContent || '';
    const biao = (document.getElementById('siKaoBiaoQian') || {}).textContent || '';
    return { dang, biao, juXuan: document.getElementById('siKaoGenSuiJu').checked, yinCang: document.getElementById('siKaoBiaoQian').classList.contains('yinCang') };
  })()`);
  console.log('  · 拖到最左: ' + JSON.stringify(zuiZuo));
  check('拖到最左 = 灵机（关闭）档', zuiZuo.dang.length > 0 && zuiZuo.dang === zuiZuo.biao, zuiZuo);
  check('拖动后自动取消「由牛马管理局设置」', zuiZuo.juXuan === false, zuiZuo);
  check('手动档位会显示在触发器的标签上', zuiZuo.biao.length > 0 && zuiZuo.yinCang === false, zuiZuo);

  // 拖到最右（自然）→ 档位标签跟着变
  const zuiYou = await c.evaluate(`(function(){
    const hk = document.getElementById('siKaoHuaKuai');
    hk.value = '7';
    hk.dispatchEvent(new Event('input', { bubbles: true }));
    return { dang: (document.getElementById('siKaoKaDang') || {}).textContent || '' };
  })()`);
  console.log('  · 拖到最右: ' + JSON.stringify(zuiYou));
  check('拖到最右 = 自然（自动）档（与最左不同）', zuiYou.dang.length > 0 && zuiYou.dang !== zuiZuo.dang, { zuo: zuiZuo.dang, you: zuiYou.dang });

  // 手动档"保持"的落点：**有会话时写进设置**；没有会话时只改界面（不写脏数据）
  const baoCun = await c.evaluate(`(async function(){
    const hk = document.getElementById('siKaoHuaKuai');
    hk.value = '3';
    hk.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 500));
    const s = await window.warmy.settingsGet();
    const over = (s && s.settings && s.settings.thinkOverride) || {};
    return { keys: Object.keys(over), vals: Object.values(over), youHuiHua: !!(window.__warmyDebugState && window.__warmyDebugState().selected) };
  })()`);
  console.log('  · 手动档落盘: ' + JSON.stringify(baoCun));
  if (baoCun.youHuiHua) check('手动档位写进了设置（"保持"这条要求的落点）', Array.isArray(baoCun.vals) && baoCun.vals.length > 0, baoCun);
  else check('没选中会话时只改界面、不写脏数据（有会话才落盘）', Array.isArray(baoCun.keys) && baoCun.keys.length === 0, baoCun);

  // 静态：发消息时会用这个覆盖档（覆盖 > 牛马默认 > auto）+ 落盘路径存在
  const appJs = fs.readFileSync(path.join(pkgRoot, 'src', 'renderer', 'app.js'), 'utf8');
  check('发消息时优先用手动档（thinkOverride > 牛马默认 > auto）', /thinkLevel:\s*\(state\.thinkOverride && state\.thinkOverride\[chatId\]\) \|\| \(inst0 && inst0\.thinkLevel\) \|\| 'auto'/.test(appJs));
  check('启动时读回手动档（重启后还在）', /settings\.thinkOverride/.test(appJs));
  check('改动会写进设置（"保持"的持久化路径）', /settingsSave\?\.\(\{ thinkOverride: state\.thinkOverride/.test(appJs));
  check('i18n：勾选框文案 10 语言齐备', (() => {
    const dir = path.join(pkgRoot, 'src', 'i18n');
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).every((f) => {
      const o = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      return ['model.think.byAgency', 'model.think.followAgency', 'model.think.manualKept'].every((k) => o[k] && String(o[k]).trim());
    });
  })());
} catch (e) {
  console.error('门禁异常: ' + ((e && e.stack) || e));
  fail += 1;
}

jieShu();
await sleep(500);
try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch { /* noop */ }
console.log(`\n==== verify-think-toolbar: ${pass} ok / ${fail} FAIL ====`);
process.exit(fail ? 1 : 0);
