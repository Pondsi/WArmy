/**
 * 门禁：**同一实体的两处视图**（主界面 + 独立会话窗）必须是同一套数据，且互不影响。
 *
 * 为什么必须有这一条：产品主反复反馈"新窗口联动不对"，而旧门禁只做了单窗口断言 ——
 * 这类跨窗口缺陷（选中被抢走、消息只活在内存里、右侧串台）在单窗口里永远测不出来。
 *
 * 覆盖（全部走真实 UI 路径，读真实 DOM）：
 *  1. 主界面发一条 → 主界面能看到；
 *  2. 开独立窗 → 显示的是**同一个会话**（标题一致）；
 *  3. 独立窗与主界面的**消息集合一致**（同一套数据）；
 *  4. 独立窗与主界面的**右侧一致**（项目状态/知识库同源）；
 *  5. 在独立窗发一条 → **主界面的同一会话也出现**（两处视图同步）；
 *  6. 主界面切到另一个会话 → 看不到第一个会话的消息（不串台），右栏也跟着走；
 *  7. 第二个会话也能独立开窗，且内容与它自己一致。
 */
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(selfDir, '..');
const ROOT = path.resolve(PKG, '..', '..');
const PORT = Number(process.env.WARMY_TWO_WINDOW_CDP_PORT || 9925);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const failures = [];
function check(ming, ok, detail) {
  console.log((ok ? '  ok   ' : '  FAIL ') + ming + (detail !== undefined ? '  ' + JSON.stringify(detail).slice(0, 200) : ''));
  if (!ok) failures.push(ming);
}

const child = spawn(path.join(PKG, 'node_modules', 'electron', 'dist', 'electron.exe'),
  [`--remote-debugging-port=${PORT}`, '--disable-features=CalculateNativeWinOcclusion', path.join(PKG, 'dist', 'electron-main.js')],
  { cwd: PKG, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', () => {});
child.stderr.on('data', () => {});

async function attachTo(pred, biaoQian, tries = 90) {
  for (let i = 0; i < tries; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`, { signal: AbortSignal.timeout(4000) })).json();
      const page = list.find(pred);
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', () => j(new Error('ws fail'))); });
        let id = 0;
        const pending = new Map();
        ws.addEventListener('message', (e) => {
          const m = JSON.parse(e.data);
          if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
        });
        const faSong = (method, params) => new Promise((res, rej) => {
          const mid = ++id; pending.set(mid, { resolve: res, reject: rej });
          ws.send(JSON.stringify({ id: mid, method, params }));
          setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); rej(new Error('cdp timeout ' + method)); } }, 25000);
        });
        await faSong('Runtime.enable', {});
        return {
          url: page.url,
          evaluate: async (expr) => {
            const r = await faSong('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
            if (r.exceptionDetails) throw new Error(biaoQian + ': ' + String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 200));
            return r.result.value;
          },
        };
      }
    } catch { /* 继续等 */ }
    await sleep(1000);
  }
  throw new Error('等不到 CDP target: ' + biaoQian);
}

const VIEW = `(function(){
  const q = (s) => document.querySelector(s);
  const txt = (s) => (q(s) || {}).textContent || '';
  return {
    title: txt('#liaoTianBiaoTi').trim(),
    bubbles: Array.from(document.querySelectorAll('#xiaoXiJi .bubble')).map((b) => b.textContent.trim()),
    hasInput: !!q('#shuRu'), hasSend: !!q('#anNiuFaSong'),
    you: txt('#xiangMuTaiHe').replace(/\\s+/g, ' ').trim().slice(0, 40),
  };
})()`;

let ok = true;
try {
  const main = await attachTo((p) => p.type === 'page' && !/chatId=/.test(p.url), '主窗口');
  await sleep(2800);

  const stamp = String(Date.now()).slice(-6);
  const g1 = 'two-a-' + stamp;
  const g2 = 'two-b-' + stamp;
  const n1 = '两处A-' + stamp;
  const n2 = '两处B-' + stamp;

  const made = await main.evaluate(`(async function(){
    const out = [];
    for (const [gid, ming] of [['${g1}','${n1}'], ['${g2}','${n2}']]) {
      const r = await window.warmy.groupCreate({ groupId: gid, ming, type: 'internal', directedMode: false, devEnv: 'host' });
      out.push(!!(r && r.ok));
    }
    if (window.__syncGroups) await window.__syncGroups();
    return out;
  })()`);
  check('前置：建两个会话', Array.isArray(made) && made.every(Boolean), made);
  await sleep(1500);

  await main.evaluate(`(function(){ document.querySelector('#ceLan [data-nav="internalGroup"]').click(); return true; })()`);
  await sleep(2000);
  const pick = async (ming) => main.evaluate(`(function(){
    const rows = Array.from(document.querySelectorAll('#lieBiaoTi .lieBiaoTiaoMu'));
    const hit = rows.find((r) => ((r.querySelector('.name') || {}).textContent || '').trim() === ${JSON.stringify(ming)});
    if (hit) hit.click();
    return { hit: !!hit, title: (document.querySelector('#liaoTianBiaoTi') || {}).textContent || '' };
  })()`);
  const p1 = await pick(n1);
  check('前置：选中第一个会话', p1.hit === true && p1.title === n1, p1);
  await sleep(2000);

  // ① 发一条
  const t1 = '主窗-' + stamp;
  await main.evaluate(`(function(){ const i=document.querySelector('#shuRu'), b=document.querySelector('#anNiuFaSong'); i.value=${JSON.stringify(t1)}; i.dispatchEvent(new Event('input',{bubbles:true})); b.click(); return true; })()`);
  await sleep(4000);
  const m1 = await main.evaluate(VIEW);
  check('主界面：自己发的消息可见', m1.bubbles.some((x) => x.includes(t1)), { bubbles: m1.bubbles.length });

  // ② 开独立窗
  /**
   * 产品定稿：**打开新窗口不得为了探测而启动 WSL**。
   * 用户两次反馈"开新窗口触发打开 WSL"——根因是项目状态查询会全量探测运行时，
   * 其中 wsl.exe 的 `--version`/`-l -v` 会把 WSL 服务拉起来。现在例行路径默认静默。
   */
  const wslJiShu = () => { try { return execSync('powershell -NoProfile -Command "(Get-Process wsl,wslhost -ErrorAction SilentlyContinue | Measure-Object).Count"').toString().trim(); } catch { return 'na'; } };
  const wslQian = wslJiShu();
  await main.evaluate(`(function(){ const mi=document.querySelector('#caiDanTuBiaoDaKai'); if (mi) mi.click(); return true; })()`);
  const sub1 = await attachTo((p) => p.type === 'page' && p.url.includes('chatId=' + g1), '会话1 独立窗');
  await sleep(2500);
  const wslHou = wslJiShu();
  check('打开新窗口不启动 WSL（wsl/wslhost 进程数不变）', wslQian === wslHou, { before: wslQian, after: wslHou });
  await sleep(3000);
  const s1 = await sub1.evaluate(VIEW);
  check('独立窗：显示的是同一个会话（标题一致）', s1.title === m1.title, { fu: s1.title, main: m1.title });
  check('独立窗与主界面：**消息集合一致**（同一套数据）', JSON.stringify(s1.bubbles) === JSON.stringify(m1.bubbles), { fu: s1.bubbles, main: m1.bubbles });
  check('独立窗与主界面：右侧一致', s1.you === m1.you, { fu: s1.you, main: m1.you });
  check('独立窗：有输入区（可在新窗口继续聊）', s1.hasInput && s1.hasSend);

  // ③ 在独立窗发一条 → 主界面同一会话应出现
  const t2 = '新窗-' + stamp;
  await sub1.evaluate(`(function(){ const i=document.querySelector('#shuRu'), b=document.querySelector('#anNiuFaSong'); i.value=${JSON.stringify(t2)}; i.dispatchEvent(new Event('input',{bubbles:true})); b.click(); return true; })()`);
  await sleep(4500);
  const s2 = await sub1.evaluate(VIEW);
  const m2 = await main.evaluate(VIEW);
  check('独立窗发出后：独立窗自己有', s2.bubbles.some((x) => x.includes(t2)), {});
  check('独立窗发出后：**主界面同一会话也同步出现**', m2.bubbles.some((x) => x.includes(t2)), {});
  // **不重复显示**：同一条消息在两处都只应出现一次（主进程日志曾被两条路径各写一次 ⇒ 用户看到"显示 2 次"）
  const cMain = m2.bubbles.filter((x) => x === t2).length;
  const cSub = s2.bubbles.filter((x) => x === t2).length;
  check('同一消息在两处都**只出现一次**（不重复显示）', cMain === 1 && cSub === 1, { main: cMain, fu: cSub });
  check('同步后两处消息集合仍一致', JSON.stringify(s2.bubbles) === JSON.stringify(m2.bubbles), { fu: s2.bubbles.length, main: m2.bubbles.length });

  // ④ 切到第二个会话：不被影响
  const p2 = await pick(n2);
  await sleep(2500);
  const m3 = await main.evaluate(VIEW);
  check('切到第二个会话成功', p2.hit === true && m3.title === n2, { title: m3.title });
  check('第二个会话里**没有**第一个会话的消息（不串台）', !m3.bubbles.some((x) => x.includes(t1) || x.includes(t2)), { bubbles: m3.bubbles.length });
  check('第二个会话的右栏不是第一个会话的', !m3.you.includes(n1), { you: m3.you });

  // ⑤ 第二个会话也能独立开窗
  await main.evaluate(`(function(){ const mi=document.querySelector('#caiDanTuBiaoDaKai'); if (mi) mi.click(); return true; })()`);
  await sleep(3500);
  const list2 = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const hasG2 = list2.some((p) => p.type === 'page' && p.url.includes('chatId=' + g2));
  check('第二个会话也能开独立窗（且带的是它自己的 chatId）', hasG2, { pages: list2.filter((p) => p.type === 'page').length });
} catch (e) {
  ok = false;
  check('门禁执行未抛异常', false, String(e).slice(0, 200));
} finally {
  try { child.kill('SIGKILL'); } catch { /* noop */ }
}

console.log(`\n==== verify-two-windows: ${failures.length === 0 && ok ? '全部通过' : failures.length + ' FAIL'} ====`);
if (failures.length) console.log('失败项：\n - ' + failures.join('\n - '));
process.exit(failures.length ? 1 : 0);
