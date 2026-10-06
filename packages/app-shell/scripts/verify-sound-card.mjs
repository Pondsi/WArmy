/**
 * 门禁：**决策卡一出现就得响一声**（真事故第三次报修："首次出现的决策卡仍然没有音效"）。
 *
 * 做法：全新 profile 起真 Electron + CDP，**全程不制造任何用户手势**
 * （这正是"首次出现"的现场：用户可能只按了回车，甚至没碰窗口），然后：
 *   ① 量 AudioContext 在无手势时到底能不能 running（自动播放策略被关掉没有）；
 *   ② 量内置提示音是不是真有声（取到 + 解码 + 峰值 > 0.1，排除"文件是静音的"）；
 *   ③ 直接走产品的播放函数（无手势）→ 必须走 AudioContext 主路、gain>0、成功；
 *      **并从主进程用 `webContents.isCurrentlyAudible()` 确认窗口真的在出声**
 *      （OS 级判据 —— 不是"我们调了 start()"，而是"系统看见有音频流"）；
 *   ④ **造一张真决策卡**（走产品 IPC，与 `ask_user` 工具创建卡片的落点一致）→
 *      不点任何东西 → 卡片必须被界面自己发现、响一声、且主进程确认真的在出声。
 *      这一条针对的正是根因：决策卡的发现与响铃原先挂在 rAF 上，
 *      而同一个 tick 里排第二的 `raf(renderAiQuestions)` **永远被丢掉** ⇒ 从来没跑过；
 *      加上"没选中会话就 return"的短路，冷启动第一张卡既不显示也不响。
 *   ⑤ 广播 + 轮询同一张卡只准响一次（共用一本账，不叠音）；同一 id 重复触发不再响。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { attach, sleep } from './cdp-lib.mjs';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(selfDir, '..');
const PORT = Number(process.env.WARMY_SOUND_CDP_PORT || 9933);
const NODE_PORT = Number(process.env.WARMY_SOUND_NODE_PORT || 9934);
const electron = path.join(pkgRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const mainJs = path.join(pkgRoot, 'dist', 'electron-main.js');
const profile = path.join(os.tmpdir(), 'warmy-sound-gate-profile');

let pass = 0;
let fail = 0;
function check(l, ok, d) {
  if (ok) { pass++; console.log('  ok  ' + l); }
  else { fail++; console.log('  FAIL ' + l, d === undefined ? '' : JSON.stringify(d).slice(0, 400)); }
}

fs.rmSync(profile, { recursive: true, force: true });

async function waitJson(port, secs = 40) {
  for (let i = 0; i < secs; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(1200) }); if (r.ok) return await r.json(); } catch { /* retry */ }
    await sleep(500);
  }
  return null;
}

/** 主进程（Node inspector）求值：问 Electron "这个窗口现在真的有声音吗" */
async function lianZhu(url, biao) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', () => rej(new Error(biao + ' ws 失败')));
  });
  let id = 0;
  const pend = new Map();
  ws.addEventListener('message', (e) => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.id !== undefined && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); p(m); }
  });
  const fa = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await fa('Runtime.enable');
  const ZHU_QIU = `(function(){
    const req = (typeof require === 'function') ? require : (process.mainModule && process.mainModule.require);
    if (!req) return [];
    const { BrowserWindow } = req('electron');
    return BrowserWindow.getAllWindows().map((w) => { try { return w.webContents.isCurrentlyAudible(); } catch (e) { return 'err'; } });
  })()`;
  return {
    async audible() {
      const r = await fa('Runtime.evaluate', { expression: ZHU_QIU, returnByValue: true, awaitPromise: true });
      const v = r && r.result && r.result.result ? r.result.result.value : null;
      return Array.isArray(v) ? v.some((x) => x === true) : false;
    },
  };
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [
  `--remote-debugging-port=${PORT}`,
  `--inspect=${NODE_PORT}`,
  '--disable-features=CalculateNativeWinOcclusion',
  `--user-data-dir=${profile}`,
  mainJs,
], { cwd: pkgRoot, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false, env });

let c = null;
function jieShu() {
  try { if (c) c.close(); } catch { /* noop */ }
  try { child.kill('SIGKILL'); } catch { /* noop */ }
}

try {
  const ui = await waitJson(PORT);
  if (!ui) { console.error('CDP not up'); jieShu(); process.exit(2); }
  await sleep(4000);
  c = await attach(PORT, { biaoQian: 'sound-gate', callTimeout: 30000 });
  await c.send('Runtime.enable');

  const zhuList = await waitJson(NODE_PORT, 12);
  let zhu = null;
  if (zhuList && zhuList[0] && zhuList[0].webSocketDebuggerUrl) {
    try { zhu = await lianZhu(zhuList[0].webSocketDebuggerUrl, '主进程'); } catch { zhu = null; }
  }
  check('拿到主进程调试口（能问"真的在出声吗"）', !!zhu);

  // ① 无手势时的上下文状态 + ② 内置提示音是否真有声
  const jichu = await c.evaluate(`(async function(){
    const r = { gesture: !!(navigator.userActivation && navigator.userActivation.hasBeenActive) };
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC();
      r.ctxState = ctx.state;
      const y = await window.warmy.yinXiaoQu({ kind: 'request' });
      r.youYinYuan = !!(y && y.ok && y.dataUrl);
      r.neiZhi = !!(y && y.builtin);
      if (r.youYinYuan) {
        const bin = atob(String(y.dataUrl).replace(/^data:[^,]+,/, ''));
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        const buf = await ctx.decodeAudioData(arr.buffer.slice(0));
        r.miao = Math.round(buf.duration * 100) / 100;
        const ch = buf.getChannelData(0);
        let peak = 0;
        for (let i = 0; i < ch.length; i += 7) { const a = Math.abs(ch[i]); if (a > peak) peak = a; }
        r.fengZhi = Math.round(peak * 1000) / 1000;
      }
      r.hasLedger = Array.isArray(window.__yinXiaoZhenDuan);
    r.baoHuo = !!(window.__yinPinBaoHuo && window.__yinPinBaoHuo());
      r.hasPlay = typeof window.__chuanBoYinXiao === 'function';
      r.selected = (window.__warmyDebugState && window.__warmyDebugState().selected) || null;
      try { ctx.close(); } catch (e) { /* noop */ }
    } catch (e) { r.err = String((e && e.message) || e); }
    return r;
  })()`);

  console.log('  · 现场: ' + JSON.stringify(jichu));
  check('全程没有任何用户手势（= "首次出现"的现场）', jichu.gesture === false, jichu.gesture);
  check('无手势时 AudioContext 直接 running（自动播放策略已放行）', jichu.ctxState === 'running', jichu.ctxState);
  check('内置「请求」音效取得到', jichu.youYinYuan === true, jichu.youYinYuan);
  check('内置音效是真有声的内容（峰值 > 0.1，不是静音文件）', (jichu.fengZhi || 0) > 0.1, jichu.fengZhi);
  check('诊断账本可用（能证明"真播了"，不靠猜）', jichu.hasLedger === true && jichu.hasPlay === true, jichu);
  check('**还没有播过任何声音**时保活源就已经挂上（第一声不走冷路径 ⇒ 起音不被吞）', jichu.baoHuo === true, jichu);

  // ③ 直接走产品的播放函数（无手势）+ 主进程确认真的在出声
  const bo = await c.evaluate(`(async function(){
    const t0 = Date.now();
    const ok = await window.__chuanBoYinXiao('request', 'gate-direct');
    return { ok, ms: Date.now() - t0, last: window.__yinXiaoZuiHou || null };
  })()`);
  console.log('  · 直接播放: ' + JSON.stringify(bo));
  let wenChuSheng = false;
  let qiYinMs = null;
  if (zhu) {
    for (let i = 0; i < 20; i++) {
      await sleep(50);
      if (await zhu.audible()) { wenChuSheng = true; qiYinMs = (i + 1) * 50; break; }
    }
  }
  check('无手势直接播放成功', bo.ok === true, bo);
  check('走的是 AudioContext 主路', bo.last && bo.last.lu === 'audio-context', bo.last);
  check('播放时上下文是 running', bo.last && bo.last.ctxState === 'running', bo.last);
  check('音量不是 0（静音也算"没声音"）', bo.last && Number(bo.last.gain) > 0, bo.last);
  check('主进程确认窗口**真的在出声**（isCurrentlyAudible=true）', wenChuSheng === true, { wenChuSheng });

  // ⚠️ 有意**不**断言"audible 会回到 false"：设备保活源（≈ -70dBFS 噪声）会一直把流热着，
  //    这正是"首次音效起音被吃掉"的修法；改断言**起音够快**（设备不冷启动 ⇒ 起音不被吞）。
  check('起音够快（出声延迟 < 600ms：设备没有冷启动，起音不被吞）', qiYinMs !== null && qiYinMs < 600, { qiYinMs });
  check('保活源已挂上（音频流一直热着，第一声不走冷路径）', await c.evaluate(`!!(window.__yinPinBaoHuo && window.__yinPinBaoHuo())`), 'keep-alive');

  /**
   * ④ 造一张**真决策卡**（走产品 IPC，与 `ask_user` 工具创建卡片的落点一致），
   *    然后**什么都不点**，等界面自己的心跳发现它 —— 同时从主进程盯"真的在出声"。
   */
  const t0 = Date.now();
  const zao = await c.evaluate(`(async function(){
    await window.warmy.aiQuestionOpen({
      groupId: 'sound-gate-session',
      biaoTi: '门禁：决策卡音效',
      ti: '这张卡必须在出现的瞬间就响一声',
      options: [{ biaoQian: '选 A' }, { biaoQian: '选 B' }],
    });
    return { ok: true, selected: (window.__warmyDebugState && window.__warmyDebugState().selected) || null };
  })()`);
  console.log('  · 造卡: ' + JSON.stringify(zao));

  let kaZhen = null;
  let kaChuSheng = false;
  let faXianMs = 0;
  for (let i = 0; i < 40; i++) {
    await sleep(200);
    if (zhu && !kaChuSheng && (await zhu.audible())) { kaChuSheng = true; faXianMs = Date.now() - t0; }
    if (!kaZhen) {
      const z = await c.evaluate(`(function(){
        const d = (window.__yinXiaoZhenDuan || []).filter((x) => String(x.laiYuan || '').indexOf('render') === 0);
        return { n: d.length, hou: d.slice(-1) };
      })()`);
      if (z && z.n > 0) kaZhen = z;
    }
    if (kaZhen && kaChuSheng) break;
  }
  console.log('  · 卡片音效: ' + JSON.stringify(kaZhen) + ' 出声(ms)=' + faXianMs);
  check('卡片出现后（不需要任何点击）自动响了一声', !!(kaZhen && kaZhen.n > 0), kaZhen);
  check('这一声真的播出去了', !!(kaZhen && kaZhen.hou.some((x) => x.ok === true && x.kind === 'request')), kaZhen);
  check('主进程确认卡片这一声**真的在出声**', kaChuSheng === true, { kaChuSheng, faXianMs });
  check('没选中会话也照响（音效与"卡片画得出来"解耦）', !!(kaZhen && !zao.selected), { laiYuan: kaZhen && kaZhen.hou.map((x) => x.laiYuan), selected: zao.selected });

  // ⑤ 同一张卡不许响两遍：广播 + 轮询（同一 id 走两次入口）只准响一次
  const shuang = await c.evaluate(`(async function(){
    const qian = (window.__yinXiaoZhenDuan || []).length;
    window.__xiangKaPianYin(['gate-same-card'], 'broadcast');
    window.__xiangKaPianYin(['gate-same-card'], 'render');
    await new Promise((r) => setTimeout(r, 800));
    const d = (window.__yinXiaoZhenDuan || []).slice(qian).filter((x) => x.kind === 'request');
    return { xinZeng: d.length, list: d.map((x) => x.laiYuan + ':' + x.ok) };
  })()`);
  console.log('  · 广播+轮询同一张卡（新增条目）: ' + JSON.stringify(shuang));
  check('广播+轮询同一张卡：只响一次（不叠音）', shuang.xinZeng === 1 && shuang.list[0].endsWith(':true'), shuang);

  // ⑥ 同一 id 重复触发不再响（账本生效）
  const buBo = await c.evaluate(`(async function(){
    const before = (window.__yinXiaoZhenDuan || []).length;
    await window.__xiangKaPianYin(['gate-retry-card'], 'broadcast');
    await new Promise((r) => setTimeout(r, 500));
    const mid = (window.__yinXiaoZhenDuan || []).length;
    await window.__xiangKaPianYin(['gate-retry-card'], 'broadcast');
    await new Promise((r) => setTimeout(r, 500));
    const after = (window.__yinXiaoZhenDuan || []).length;
    return { before, mid, after };
  })()`);
  console.log('  · 重复触发同一 id: ' + JSON.stringify(buBo));
  check('同一 id 第二次触发不再响（账本生效）', buBo.mid === buBo.before + 1 && buBo.after === buBo.mid, buBo);

  // ⑦ 静态不变量
  const appJs = fs.readFileSync(path.join(pkgRoot, 'src', 'renderer', 'app.js'), 'utf8');
  const iYin = appJs.indexOf('xiangKaPianYin(pending.map');
  const iTui = appJs.indexOf('if (!qunId) { host.innerHTML = \'\'; return; }');
  check('源码：音效在"没选中会话就退出"之前（不会再被短路掉）', iYin > 0 && iTui > 0 && iYin < iTui, { iYin, iTui });
  const mainSrc = fs.readFileSync(path.join(pkgRoot, 'src', 'electron-main.ts'), 'utf8');
  check('主进程：显式关掉用户手势要求（窗口级 + 命令行）', /autoplayPolicy: 'no-user-gesture-required'/.test(mainSrc) && /appendSwitch\('autoplay-policy'/.test(mainSrc));
} catch (e) {
  console.error('门禁异常: ' + ((e && e.stack) || e));
  fail += 1;
}

jieShu();
await sleep(600);
try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch { /* 账号目录偶尔被占，不影响判定 */ }
console.log(`\n==== verify-sound-card: ${pass} ok / ${fail} FAIL ====`);
process.exit(fail ? 1 : 0);
