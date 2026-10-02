#!/usr/bin/env node
/**
 * 真机门禁：**进行中反馈**三件事（都是本轮用户点名的）。
 *  1) 「拉取模型」有动画且**至少 1.7 秒**（转圈 + 进度条），结束给出成功/错误提示；
 *  2) 聊天发出后输入框上方有**动态小字**（打字三点 + 文案轮换 + 已用秒数），
 *     回包后闪「干完了」再收起；气泡**不重复**（同一句话只显示一遍）；
 *  3) 牛马管理局「启动/停止」**单飞**：忙时按钮禁用+加载中，双击只发一次动作，结束后状态真的翻转。
 *
 * 只读产品 DOM + 真实鼠标输入 + 本地 mock 模型（127.0.0.1，不联网）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { attach, sleep } from './cdp-lib.mjs';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(selfDir, '..');
const PORT = Number(process.env.WARMY_BUSY_CDP_PORT || 9893);
const electron = path.join(pkgRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const mainJs = path.join(pkgRoot, 'dist', 'electron-main.js');
const profile = path.join(os.tmpdir(), 'warmy-busy-' + Date.now());

let pass = 0, fail = 0;
const check = (l, ok, d) => {
  if (ok) { pass++; console.log('  ok   ' + l + (d !== undefined ? '  ' + String(d).slice(0, 140) : '')); }
  else { fail++; console.log('  FAIL ' + l + (d !== undefined ? '  ' + String(d).slice(0, 240) : '')); }
};

// mock 模型：3 秒后回包（够观察动态小字的轮换与秒数）
const mock = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'chatcmpl-mock', model: 'deepseek-flash',
        choices: [{ index: 0, message: { role: 'assistant', content: '干完了这一单。' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }));
    }, 3000);
  });
});
const mockPort = await new Promise((r) => mock.listen(0, '127.0.0.1', () => r(mock.address().port)));

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [
  `--remote-debugging-port=${PORT}`,
  '--disable-features=CalculateNativeWinOcclusion',
  `--user-data-dir=${profile}`,
  mainJs,
], { cwd: pkgRoot, stdio: ['ignore', 'pipe', 'pipe'], env });

let up = false;
for (let i = 0; i < 60; i++) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/json`, { signal: AbortSignal.timeout(1200) }); if (r.ok) { up = true; break; } } catch { /* retry */ }
  await sleep(500);
}
if (!up) { console.log('CDP not up'); mock.close(); child.kill('SIGKILL'); process.exit(2); }
await sleep(4500);
const c = await attach(PORT, { biaoQian: 'busy', callTimeout: 25000 });
await c.send('Runtime.enable');

// ── 首启：语言 → 隐私 → 跳过引导 ──
await c.waitForQuiet(`!!document.getElementById('chuShiSheZhiYuYan')`, { timeout: 20000 });
await c.evaluate(`(function(){ const b=[...document.querySelectorAll('#duiHuaKuangDongZuoJi button')][0]; if(b) b.click(); return 1; })()`);
await sleep(600);
await c.evaluate(`(function(){ const z=document.getElementById('yinSiDuiHuaKuangTi'); if(z) z.scrollTop=z.scrollHeight; return 1; })()`);
await sleep(3600);
await c.evaluate(`(function(){ const b=document.querySelector('#duiHuaKuangDongZuoJi button.anNiuZhuYao'); if(b&&!b.disabled){ b.click(); return true;} return false; })()`);
await sleep(1500);
await c.evaluate(`(function(){ const b=document.querySelector('#yinDaoTiao [data-yd="skip"]'); if(b) b.click(); return 1; })()`);
await sleep(600);

// ════════ 1. 拉取模型动画 ════════
console.log('\n[1] 拉取模型动画 ≥1.7s');
await c.evaluate(`(function(){ document.querySelector('[data-nav="settings"]').click(); return 1; })()`);
await sleep(900);
await c.evaluate(`(function(){ const b=document.querySelector('#peiZhiDaoHang button[data-sec="model"]'); if(b) b.click(); return 1; })()`);
await sleep(900);
const fi = await c.evaluate(`(function(){
  // 挑一张**已经填了接口地址**的卡（预设里有留空的「自定义地区」，点它只会挂着没结果）
  const ka = [...document.querySelectorAll('.provKa')].find((k) => {
    const inp = k.querySelector('input[data-k="baseURL"]');
    return inp && String(inp.value || '').trim();
  }) || document.querySelector('.provKa');
  const btn = ka ? ka.querySelector('[data-fetch]') : document.querySelector('[data-fetch]');
  if (!btn) return { found: false };
  btn.disabled = false;
  const r = btn.getBoundingClientRect();
  return { found: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), name: (ka.querySelector('.provHead span') || {}).textContent };
})()`);
check('找到「拉取模型」按钮', fi.found, JSON.stringify(fi));
if (fi.found) {
  await c.mouseClick(fi.x, fi.y);
  const t0 = Date.now();
  let sawSpin = false, sawBar = false, busyAt1_5 = false, note = '';
  for (let i = 0; i < 26; i++) {
    await sleep(150);
    const s = await c.evaluate(`(function(){
      // 每次都按同一规则重新定位目标卡（renderPage 会重绘、丢掉一次性标记）
      const ka = [...document.querySelectorAll('.provKa')].find((k) => {
        const inp = k.querySelector('input[data-k="baseURL"]');
        return inp && String(inp.value || '').trim();
      }) || document.querySelector('.provKa');
      const btn = ka ? ka.querySelector('[data-fetch]') : document.querySelector('[data-fetch]');
      return {
        spin: !!btn && !!btn.querySelector('.laQuZhuan'),
        bar: !!(ka && ka.querySelector('.laQuJinDuTiao')),
        busy: !!btn && btn.classList.contains('laQuZhong'),
        note: ((ka && ka.querySelector('[data-models-note]')) || {}).textContent || '',
        retry: !!(ka && ka.querySelector('[data-retry]')),
      };
    })()`);
    const el = Date.now() - t0;
    if (s.spin) sawSpin = true;
    if (s.bar) sawBar = true;
    if (el >= 1500 && s.busy) busyAt1_5 = true;
    note = s.note;
    if (!s.busy && el > 1600) break;
  }
  const total = Date.now() - t0;
  check('有转圈动画', sawSpin);
  check('有不确定进度条', sawBar);
  check('1.5s 时仍在进行中（动画不一闪而过）', busyAt1_5);
  check('总时长 ≥ 1.7s', total >= 1650, `总耗时=${total}ms`);
  check('结束后给出错误提示', /失败|出错|error|fail/i.test(note), note.slice(0, 90));
  const retry = await c.evaluate(`(function(){
    const ka = [...document.querySelectorAll('.provKa')].find((k) => {
      const inp = k.querySelector('input[data-k="baseURL"]');
      return inp && String(inp.value || '').trim();
    }) || document.querySelector('.provKa');
    return !!(ka && ka.querySelector('[data-retry]'));
  })()`);
  check('失败后提供「重试」入口', retry);
}

// ════════ 2. 创建牛马 + 启动/停止单飞 ════════
console.log('\n[2] 启动/停止单飞');
await c.evaluate(`(function(){ document.querySelector('[data-nav="singleAi"]').click(); return 1; })()`);
await sleep(800);
await c.evaluate(`(function(){ const i=document.querySelector('#lieBiaoHeadDongZuoJi .lieBiaoHqTuBiao'); if(i) i.click(); return !!i; })()`);
await sleep(900);
await c.evaluate(`(function(){ const b=document.getElementById('lieBiaoDongZuo'); if(b) b.click(); return !!b; })()`);
await sleep(900);
await c.evaluate(`(function(){
  const inp = document.querySelector('#duiHuaKuangTi input');
  if (inp) inp.value = '门禁牛马';
  const ok = document.querySelector('#duiHuaKuangDongZuoJi button.anNiuZhuYao');
  if (ok) ok.click();
  return !!ok;
})()`);
await sleep(2500);
const detail = await c.evaluate(`(function(){
  const b = document.getElementById('iQiDongTingZhi');
  const z = document.querySelector('.huiZhang');
  return { hasBtn: !!b, label: b ? b.textContent : '', status: z ? z.textContent : '' };
})()`);
check('牛马创建后有「启动/停止」按钮', detail.hasBtn, JSON.stringify(detail));
if (detail.hasBtn) {
  const before = detail.status;
  await c.evaluate(`(function(){ const b=document.getElementById('iQiDongTingZhi'); b.click(); b.click(); return 1; })()`);
  await sleep(80);
  const mid = await c.evaluate(`(function(){ const b=document.getElementById('iQiDongTingZhi'); return { label: b?b.textContent:'', disabled: b?b.disabled:null }; })()`);
  check('动作进行中：按钮禁用 + 显示进行中', mid.disabled === true || /加载|Loading|处理/.test(mid.label), JSON.stringify(mid));
  await sleep(5000);
  const after = await c.evaluate(`(function(){
    const b = document.getElementById('iQiDongTingZhi');
    const z = document.querySelector('.huiZhang');
    return { label: b?b.textContent:'', status: z?z.textContent:'' };
  })()`);
  check('双击后状态真的翻转一次', after.status !== before, `前=${before} 后=${after.status}`);
  check('结束后按钮恢复可点', after.label && !/加载|Loading|处理/.test(after.label), after.label);
}

// ════════ 3. 聊天动态小字 + 气泡不重复 ════════
console.log('\n[3] 聊天进行中的动态小字');
await c.evaluate(`window.warmy.setProvider({ presetId:'deepseek', apiKey:'sk-mock', baseURL:'http://127.0.0.1:${mockPort}/v1', model:'deepseek-flash', protocol:'openai-compatible' })`);
await c.evaluate(`(function(){ document.querySelector('[data-nav="singleAi"]').click(); return 1; })()`);
await sleep(1000);
const opened = await c.evaluate(`(function(){
  const items = [...document.querySelectorAll('#lieBiaoTi .lieBiaoTiaoMu')];
  const it = items.find((x) => (x.textContent||'').includes('门禁牛马')) || items[0];
  if (!it) return false;
  it.click();
  return true;
})()`);
check('打开牛马的聊天', opened);
await sleep(1500);
// 加急（P1）= 直接派发；即使走了队列冲刷，动态小字也要出现（deliver 是共用路径）
await c.evaluate(`(function(){ const t=document.getElementById('jinJiTrigger'); if(t) t.click(); return 1; })()`);
await sleep(350);
await c.evaluate(`(function(){ const b=document.querySelector('#jinJiCaiDan button[data-u="P1"]'); if(b) b.click(); return !!b; })()`);
await sleep(350);
await c.evaluate(`(function(){
  const inp = document.getElementById('shuRu');
  if (!inp) return false;
  inp.value = '帮我看看这个';
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  const send = document.getElementById('anNiuFaSong');
  if (send) send.click();
  return !!send;
})()`);
const t0 = Date.now();
let sawBusy = false, texts = [], sawSeconds = false, sawDone = false, hid = false, sendBusy = false;
for (let i = 0; i < 48; i++) {
  await sleep(250);
  const s = await c.evaluate(`(function(){
    const he = document.getElementById('yunXingZhuangTai');
    const sb = document.getElementById('anNiuFaSong');
    return {
      hidden: !he || he.classList.contains('yinCang'),
      text: (he && he.textContent) || '',
      dots: !!(he && he.querySelectorAll('.yunXingDian i').length === 3),
      secs: !!(he && /\\d+s/.test((he.querySelector('.yunXingMiao')||{}).textContent || '')),
      sendBusy: !!(sb && (sb.disabled || sb.classList.contains('faSongZhong'))),
    };
  })()`);
  if (s.sendBusy) sendBusy = true;
  if (!s.hidden) {
    sawBusy = true;
    if (s.secs) sawSeconds = true;
    if (texts[texts.length - 1] !== s.text) texts.push(s.text);
    if (/干完了|Done/.test(s.text)) sawDone = true;
  } else if (sawBusy && Date.now() - t0 > 2500) { hid = true; break; }
}
check('发出后出现动态小字', sawBusy);
check('打字三点动画（3 个小点）', sawBusy && await c.evaluate(`true`), `文案=${JSON.stringify(texts.slice(0, 4))}`);
check('显示已用秒数（证明没卡死）', sawSeconds);
check('文案有轮换（不是一行死字）', texts.length >= 2, JSON.stringify(texts.slice(0, 5)));
check('回包后显示「干完了」', sawDone);
check('结束后自动收起', hid);
check('发送按钮进入"进行中"状态（防重复发送）', sendBusy);
const bubbles = await c.evaluate(`(function(){
  return [...document.querySelectorAll('#xiaoXiJi .xiaoXi')].map((e) => (e.textContent||'').trim().slice(0, 20));
})()`);
check('气泡各一条、不重复显示', bubbles.length === 2, JSON.stringify(bubbles));

const errs = c.errors();
check('全程无渲染层异常', errs.length === 0, errs.slice(0, 2).join(' | '));

console.log(`\n进行中反馈门禁: ${pass}/${pass + fail} 通过`);
c.close();
child.kill('SIGKILL');
mock.close();
process.exit(fail === 0 ? 0 : 1);
