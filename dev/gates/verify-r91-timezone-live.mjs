/**
 * verify-r91-timezone-live —— 第 91 轮时区的**真机界面**验收（Electron + CDP，临时 profile）。
 *
 * 覆盖用户口径：
 *  1. 登录（旁路后主界就绪）满 5 秒，若系统时区与已存时区不同 ⇒ 弹二选一；
 *  2. 选「保持」⇒ 时区不变，并记住对当前系统时区已经拒绝过；
 *  3. 设置页有 IANA 时区下拉；改成 Paris ⇒ 立刻落盘、界面时间按 Paris 显示；
 *  4. 另一轮选「更换」⇒ 落盘成系统时区。
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
const PORT = Number(process.env.R91TZ_PORT || 9653);

const SYS_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const PREV_TZ = SYS_TZ === 'Asia/Tokyo' ? 'America/New_York' : 'Asia/Tokyo';
const OTHER_TZ = PREV_TZ === 'Europe/Paris' ? 'Europe/Berlin' : 'Europe/Paris';
const profile = path.join(os.tmpdir(), 'warmy-r91-tz-' + Date.now());
fs.mkdirSync(profile, { recursive: true });

function xiePeiZhi(extra) {
  const now = Date.now();
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
    yuYan: 'zh-CN', setupDone: true, privacyConsent: true, guideDone: true, providersSeeded: true,
    instances: [{ id: 'inst-r91tz-1', ming: '牛马-1', name: '牛马-1', status: 'running', model: 'mimo-v2.6-flash', chain: ['mimo-v2.6-flash'], chainDisabled: [] }],
    providers: [],
    authGrants: { 'inst-r91tz-1': [] },
    panelCardCollapsed: {},
    ...extra,
  }, null, 2), 'utf8');
}
function duPeiZhi() {
  try { return JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8')); } catch { return {}; }
}

let child = null;
let c = null;
let okN = 0, failN = 0;
const ok = (m, d) => { okN++; console.log('  ok   ' + m + (d ? ' ← ' + d : '')); };
const bad = (m, d) => { failN++; console.log('  FAIL ' + m + (d ? ' ← ' + String(d).slice(0, 400) : '')); };
const jian = (m, cond, d) => (cond ? ok(m, d) : bad(m, d));

async function qidong() {
  const env = { ...process.env, WARMY_AUTH_BYPASS: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(ELECTRON, ['--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, MAIN], {
    cwd: PKG, stdio: ['ignore', 'ignore', 'ignore'], windowsHide: false, env,
  });
  let last = '';
  for (let i = 0; i < 80; i++) {
    try { c = await attach(PORT, { biaoQian: 'r91-tz', callTimeout: 15000 }); break; } catch (e) { last = e.message; await sleep(300); }
  }
  if (!c) throw new Error('CDP 未连接：' + last);
  await c.send('Runtime.enable');
  await c.waitFor('document.body.getAttribute("data-warmy-auth") === "ready"', { timeout: 30000, biaoQian: '认证旁路' });
  await c.waitFor('!!document.querySelector("[data-nav=settings]")', { timeout: 20000, biaoQian: '主界面' });
  await sleep(400);
}
async function guan() {
  try { if (c) await c.send('Browser.close', {}, { timeout: 5000 }); } catch { /* 已退 */ }
  await sleep(600);
  try { if (child) execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* 已退 */ }
  child = null; c = null;
}
const js = (expr) => c.evaluate(expr);
async function dianJi(sel) {
  const p = await js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({block:'center'}); const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);
  if (!p) return false;
  await c.mouseClick(p.x, p.y);
  return true;
}
async function dianWenBen(sel, text) {
  return js(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => (x.textContent || '').trim() === ${JSON.stringify(text)}); if (!e) return false; e.click(); return true; })()`);
}
const dlg = () => js(`(() => { const r = document.querySelector('#duiHuaKuangGen'); if (!r) return null; return { visible: !r.classList.contains('yinCang'), title: document.querySelector('#duiHuaKuangBiaoTi')?.textContent.trim() || '', text: document.querySelector('#duiHuaKuangTi')?.textContent.trim() || '', buttons: [...document.querySelectorAll('#duiHuaKuangDongZuoJi button')].map((b) => b.textContent.trim()) }; })()`);

try {
  console.log('系统时区=', SYS_TZ, '｜已存=', PREV_TZ, '｜设置里改成=', OTHER_TZ);

  // ── 第一轮：提醒 → 保持 → 设置页改时区 → 聊天时间按新时区 ──
  xiePeiZhi({ timezone: PREV_TZ, timezoneKeepFor: '' });
  await qidong();
  await sleep(6200);
  const d1 = await dlg();
  jian('登录后 5 秒弹出时区变化提醒', !!(d1 && d1.visible), JSON.stringify(d1));
  jian('提醒里同时点名之前时区与当前系统时区', !!(d1 && d1.text.includes(PREV_TZ) && d1.text.includes(SYS_TZ)), d1 && d1.text);
  jian('提醒是「保持 / 更换」两个选择', !!(d1 && d1.buttons.length === 2 && /保持/.test(d1.buttons[0]) && /更换|切换/.test(d1.buttons[1])), d1 && d1.buttons);

  const kept = await dianWenBen('#duiHuaKuangDongZuoJi button', '保持之前的时区');
  jian('能点「保持之前的时区」', kept === true);
  await sleep(500);
  const s1 = duPeiZhi();
  jian('保持后时区不变', s1.timezone === PREV_TZ, s1.timezone);
  jian('保持后记住“已拒绝当前系统时区”', s1.timezoneKeepFor === SYS_TZ, s1.timezoneKeepFor);

  await dianJi('[data-nav="settings"]');
  await sleep(600);
  const sel0 = await js(`(() => { const s = document.querySelector('#xuanZeShiQu'); return s ? { value: s.value, options: s.options.length } : null; })()`);
  jian('设置页有时区下拉且显示已存时区', !!(sel0 && sel0.value === PREV_TZ && sel0.options > 50), JSON.stringify(sel0));

  const changed = await js(`(() => { const s = document.querySelector('#xuanZeShiQu'); if (!s) return false; s.value = ${JSON.stringify(OTHER_TZ)}; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  jian('能把下拉改成另一个时区', changed === true);
  await sleep(900);
  const s2 = duPeiZhi();
  jian('改时区立刻落盘', s2.timezone === OTHER_TZ, s2.timezone);
  jian('手动改时区会清掉“保持”记录', s2.timezoneKeepFor === '', s2.timezoneKeepFor);
  const tzNow = await js('window.__warmyTime.getTimezone()');
  jian('渲染层生效时区跟着变', tzNow === OTHER_TZ, tzNow);

  // 聊天里注入一个固定时刻，验证界面文字按新时区换算
  await dianJi('[data-nav="singleAi"]');
  await sleep(700);
  await dianJi('#lieBiaoTi .lieBiaoTiaoMu');
  await sleep(1200);
  const sid = await js('window.__r35 && window.__r35.huiHua()');
  jian('能进入一个会话', !!sid, String(sid));
  const FIXED = Date.UTC(2026, 0, 15, 23, 30, 0);
  const shown = await js(`(() => {
    const sid = window.__r35.huiHua();
    window.__msgs = window.__msgs || {};
    window.__msgs[sid] = [];
    window.__r35.tian({ role: 'wo', text: '时区验收固定时刻', ts: ${FIXED} });
    const list = [...document.querySelectorAll('.zhuDongShiJian')];
    const last = list[list.length - 1];
    return { text: last ? (last.textContent || '').trim() : '', all: list.map((x) => (x.textContent || '').trim()) };
  })()`);
  /**
   * 2026-01-16 00:30 Paris（冬令时 UTC+1）；
   * 同一时刻在 Tokyo 是 08:30、在 Shanghai 是 07:30 —— 三者可区分。
   */
  jian('聊天时间按 Paris 显示（2026-01-16 00:30）', !!shown && shown.text === '2026-01-16 00:30', JSON.stringify(shown && shown.all));
  /** 行动行（执行过程）里的时分也必须走同一套时区换算 */
  const hang = await js(`(() => {
    window.__r35.tian({ role: 'them', text: '时区验收助手回复', ts: ${FIXED + 1000}, reasoning: '先读文件。', moXing: 'MiMo · 时区验收', turnCount: 1 });
    window.__r35.hangDong({ hao: 'tz1', ts: ${FIXED}, tsEnd: ${FIXED + 3000}, op: '读取文件 tz.txt', raw: 'read_file', detail: 'x', lei: 'path', ms: 3000, status: 'ok', chars: 10 });
    const h = [...document.querySelectorAll('.xingDongHang')];
    return { count: h.length, text: h.length ? (h[h.length - 1].textContent || '') : '' };
  })()`);
  jian('行动行仍能渲染且时分按 Paris 显示', !!(hang && hang.count > 0 && hang.text.includes('00:30')), JSON.stringify(hang));
  const errs = (typeof c.errors === 'function' ? c.errors() : []) || [];
  jian('第一轮无脚本错误', errs.length === 0, JSON.stringify(errs).slice(0, 300));
  await guan();

  // ── 第二轮：提醒 → 更换到当前系统时区 ──
  xiePeiZhi({ timezone: PREV_TZ, timezoneKeepFor: '' });
  await qidong();
  await sleep(6200);
  const d2 = await dlg();
  jian('第二次启动在时区仍不一致时继续提醒', !!(d2 && d2.visible), JSON.stringify(d2));
  const switched = await dianWenBen('#duiHuaKuangDongZuoJi button', '更换到当前系统时区');
  jian('能点「更换到当前系统时区」', switched === true);
  await sleep(900);
  const s3 = duPeiZhi();
  jian('更换后落盘为系统时区', s3.timezone === SYS_TZ, s3.timezone);
  jian('更换后清掉“保持”记录', s3.timezoneKeepFor === '', s3.timezoneKeepFor);
  const tz3 = await js('window.__warmyTime.getTimezone()');
  jian('更换后渲染层时区 = 系统时区', tz3 === SYS_TZ, tz3);
  await guan();
} catch (e) {
  bad('门禁执行异常', String((e && (e.stack || e.message)) || e));
} finally {
  await guan();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 尽力清 */ }
}

console.log(`\nverify-r91-timezone-live: ${okN} ok / ${failN} FAIL`);
process.exitCode = failN ? 1 : 0;
