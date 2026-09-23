// cdp-lib.mjs — 确定性 CDP 客户端（%TEMP%\perf 下的测试基础设施，不属于产品代码）
//
// 设计目标（针对今天暴露的两类可靠性问题）：
//  1) 每次 CDP 调用都有**超时**：不再出现"某个 Runtime.evaluate / Page.captureScreenshot
//     永不返回 -> 整个用例永久挂住"。超时会明确指出卡在哪一步、等了多久。
//  2) ws 断开 / error 时，所有在飞的调用立即以明确错误 reject，而不是永远 pending。
//  3) 用"等条件成立"（waitFor 轮询）替代固定 sleep：页面什么时候就绪由 DOM 说，不由秒表说。
//  4) 截图是可选的取证，超时只 WARN，绝不影响判定（Page.captureScreenshot 在窗口被遮挡时
//     等不到合成帧，会永久挂住 —— 见 reports 里的现场取证）。
//
// 注意：这里只读产品 DOM / 调条件等待，不改产品行为。

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CdpTimeout extends Error {}

export async function attach(port, opts = {}) {
  const callTimeout = opts.callTimeout ?? 10000;
  const biaoQian = opts.biaoQian || ('cdp:' + port);
  const t0 = Date.now();
  const res = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(5000) });
  const list = await res.json();
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error(`[${biaoQian}] 没有 page target（渲染进程可能已崩）`);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await Promise.race([
    new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', () => j(new Error(`[${biaoQian}] ws 连接失败`))); }),
    sleep(5000).then(() => { throw new Error(`[${biaoQian}] ws 连接超时 5s`); }),
  ]);

  let id = 0;
  const pending = new Map();          // id -> {resolve, reject, method, params, t0, timer}
  const events = [];                  // 收到的事件（用于收集 console 错误等）
  let closed = null;                  // 断开原因；断开后所有 faSong 直接失败

  const failAll = (why) => {
    closed = why;
    for (const [pid, p] of pending) { clearTimeout(p.timer); p.reject(new Error(`[${biaoQian}] ${why}（在 ${p.method} 上）`)); pending.delete(pid); }
  };
  ws.addEventListener('message', (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }        // 坏帧不再静默吞掉响应分发
    try {
      if (m.id !== undefined && pending.has(m.id)) {
        const p = pending.get(m.id);
        clearTimeout(p.timer);
        pending.delete(m.id);
        const dt = Date.now() - p.t0;
        if (m.error) p.reject(new Error(`[${biaoQian}] CDP 错误 @${p.method}: ${JSON.stringify(m.error).slice(0, 200)}`));
        else { const res = m.result || {}; res.__ms = dt; p.resolve(res); }
        return;
      }
      if (m.method) { events.push(m); if (events.length > 4000) events.shift(); }
    } catch (err) {
      // 客户端自身出 bug 时，让对应的调用以错误结束，而不是把整个进程崩掉
      const p = m && m.id !== undefined ? pending.get(m.id) : null;
      if (p) { clearTimeout(p.timer); pending.delete(m.id); p.reject(err); } else console.error('[cdp-lib] 事件处理异常: ' + err.message);
    }
  });
  ws.addEventListener('close', () => failAll('CDP 连接已断开'));
  ws.addEventListener('error', () => failAll('CDP 连接出错'));

  function faSong(method, params = {}, o = {}) {
    if (closed) return Promise.reject(new Error(`[${biaoQian}] 连接已关闭（${closed}），无法执行 ${method}`));
    const timeout = o.timeout ?? callTimeout;
    const i = ++id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(i);
        const detail = o.probe ? ` 现场: ${(() => { try { return JSON.stringify(o.probe()); } catch { return 'probe 失败'; } })()}` : '';
        reject(new CdpTimeout(`[${biaoQian}] CDP 调用超时 ${timeout}ms: ${method} ${JSON.stringify(params).slice(0, 120)}${detail}`));
      }, timeout);
      pending.set(i, { resolve, reject, timer, method, params, t0: Date.now() });
      try { ws.send(JSON.stringify({ id: i, method, params })); } catch (err) {
        clearTimeout(timer); pending.delete(i);
        reject(new Error(`[${biaoQian}] ws.faSong 失败 @${method}: ${err.message}`));
      }
    });
  }

  const client = {
    biaoQian, page, port,
    get eventCount() { return events.length; },
    // 标准 CDP 客户端 API 名；faSong 是内部改名残留，两者等价
    send: faSong,
    faSong,
    async evaluate(expr, o = {}) {
      const r = await faSong('Runtime.evaluate', {
        expression: expr, returnByValue: true, awaitPromise: o.awaitPromise !== false,
      }, o);
      if (r.exceptionDetails) return { __exc: String(r.exceptionDetails.text || '').slice(0, 200) };
      return r.result ? r.result.value : undefined;
    },
    /** 等条件成立。expr 求值为真即返回该值；超时抛错并带上最后一次的值/异常。 */
    async waitFor(expr, o = {}) {
      const timeout = o.timeout ?? 8000;
      const poll = o.poll ?? 60;
      const started = Date.now();
      let last, lastExc = null;
      for (;;) {
        try {
          last = await client.evaluate(expr, { awaitPromise: o.awaitPromise !== false, timeout: Math.max(2000, timeout) });
          if (last && typeof last === 'object' && last.__exc !== undefined) { lastExc = last.__exc; last = undefined; }
          else if (last && last !== false && String(last).slice(0, 4) !== 'ERR ') {
            if (typeof last === 'string' && last.startsWith('EXC ')) { lastExc = last; last = undefined; }
            else return last;
          }
        } catch (e) { lastExc = e.message.slice(0, 120); last = undefined; }
        if (Date.now() - started > timeout) {
          throw new Error(`等待条件超时 ${timeout}ms: ${o.biaoQian || expr.slice(0, 90)}  最后观测值=${String(JSON.stringify(last)).slice(0, 160)}`
            + (lastExc ? `  最后异常=${lastExc}` : ''));
        }
        await sleep(poll);
      }
    },
    /** 条件成立返回 true，超时返回 false，不抛错（用于"尝试点击 -> 判断是否生效"） */
    async waitForQuiet(expr, o = {}) {
      try { await client.waitFor(expr, o); return true; } catch { return false; }
    },
    /** 等一个值"稳定下来"（连续 samples 次取样相同）——用于 CSS transition 这类需要真的产帧才会到位的属性。
     *  可以要求它与某个旧值不同（mustDifferFrom），这样"过渡没开始"也能被识别出来。 */
    async waitStable(expr, o = {}) {
      const timeout = o.timeout ?? 4000;
      const poll = o.poll ?? 60;
      const need = o.samples ?? 3;
      const started = Date.now();
      let prev = '\u0000none';
      let same = 0;
      let val;
      for (;;) {
        val = await client.evaluate(expr);
        if (val && typeof val === 'object' && val.__exc !== undefined) val = 'EXC ' + val.__exc.slice(0, 60);
        if (val === prev) same++; else { same = 1; prev = val; }
        const differs = o.mustDifferFrom === undefined || val !== o.mustDifferFrom;
        if (same >= need && differs) return val;
        if (Date.now() - started > timeout) {
          throw new Error(`等待取值稳定超时 ${timeout}ms: ${o.biaoQian || expr.slice(0, 60)}  最后值=${JSON.stringify(val).slice(0, 120)}`);
        }
        await sleep(poll);
      }
    },
    async center(sel) {
      return client.evaluate(`(function(){const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;if(e.scrollIntoView)e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();if(r.width===0&&r.height===0)return null;return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
    },
    async hitTest(x, y) {
      return client.evaluate(`(function(){const e=document.elementFromPoint(${x},${y});if(!e)return 'null';return e.id?('#'+e.id):(e.className?('.'+String(e.className).split(' ')[0]):e.tagName);})()`);
    },
    async mouseClick(x, y, o = {}) {
      await faSong('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await faSong('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1 });
      await sleep(o.hold ?? 40);
      await faSong('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0 });
    },
    /** 真实鼠标点击（坐标点击，和真人一致）。返回命中的元素描述，方便诊断"点空了"。 */
    async clickSelector(sel, o = {}) {
      const p = await client.center(sel);
      if (!p) throw new Error(`找不到可点元素（不存在或尺寸为 0）: ${sel}`);
      const hit = await client.hitTest(p.x, p.y);
      await client.mouseClick(p.x, p.y, o);
      return { x: p.x, y: p.y, hit };
    },
    /** 点一次并等条件成立；条件不成立就再点（最多 tries 次）。用于布局/首帧抖动导致的偶发点空。 */
    async clickUntil(sel, cond, o = {}) {
      const tries = o.tries ?? 3;
      const perTry = o.timeout ?? 2500;
      const trail = [];
      let last = null;
      for (let i = 1; i <= tries; i++) {
        try {
          last = await client.clickSelector(sel, o);
          trail.push(`#${i} 点(${last.x},${last.y}) 命中=${last.hit}`);
        } catch (e) {
          // 重渲染间隙元素可能短暂不可见：记轨迹后重试，不把整套验收打死
          trail.push(`#${i} ${String(e.message).slice(0, 90)}`);
          last = last || { ok: false };
          await sleep(o.gap ?? 150);
          continue;
        }
        if (await client.waitForQuiet(cond, { timeout: perTry, poll: 50 })) return { ok: true, tries: i, trail, ...last };
        await sleep(o.gap ?? 150);
      }
      return { ok: false, tries, trail, ...(last || {}) };
    },
    /** 取证截图：带超时；失败只 WARN 不影响判定（窗口被遮挡时 captureScreenshot 会等不到帧）。 */
    async snap(file, o = {}) {
      const fs = await import('node:fs');
      const t = Date.now();
      try {
        const r = await faSong('Page.captureScreenshot', { format: 'png' }, { timeout: o.timeout ?? 8000 });
        if (r.data) { fs.writeFileSync(file, Buffer.from(r.data, 'base64')); return { ok: true, ms: Date.now() - t }; }
        return { ok: false, reason: '无 data' };
      } catch (e) {
        return { ok: false, reason: e.message.slice(0, 120) };
      }
    },
    /** 收集控制台错误（Runtime.enable 之后才开始计入） */
    errors() {
      const out = [];
      for (const m of events) {
        if (m.method === 'Runtime.exceptionThrown') out.push('EXC ' + JSON.stringify(m.params.exceptionDetails.exception || {}).slice(0, 140));
        else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') out.push('CONSOLE ' + (m.params.args || []).map((a) => a.value || a.description || '').join(' ').slice(0, 140));
      }
      return out;
    },
    close() { try { ws.close(); } catch { /* noop */ } },
  };
  client.__t0 = t0;
  return client;
}

/** 三个 host 的端口约定（与 run-all-verify.py 一致） */
export const PORTS = { desktop: 9222, mobile: 9333, realapp: 9444 };

/** 预览壳启动完成的既有可观测信号（app.js 启动 IIFE 末尾赋值，无需产品改动） */
export const BOOT_DONE = 'typeof window.__saveState === "function"';

export async function bootWait(client, extra = '', timeout = 20000) {
  return client.waitFor(`${BOOT_DONE} && (${extra || 'true'})`, { timeout, biaoQian: '页面启动完成（__saveState 就绪）' + (extra ? ' + ' + extra : '') });
}

export function reporter() {
  const results = [];
  const ok = (c, l, extra) => { results.push(!!c); console.log((c ? '  PASS ' : '  FAIL ') + l + (extra !== undefined ? ' -> ' + extra : '')); return !!c; };
  const warn = (l) => console.log('  WARN ' + l);
  return {
    ok, warn, results,
    summary(ming) {
      const pass = results.filter(Boolean).length;
      console.log('\n' + ming + ': ' + pass + '/' + results.length + ' 通过');
      return pass === results.length;
    },
  };
}
