/**
 * 压力档 A 的"真浏览器"夹具（由 `verify-r46-youxi.mjs` 用 Electron 以**应用模式**拉起）
 *
 *   argv: [临时应用目录(见 package.json 的 main 指到这里), 要验收的游戏文件绝对路径]
 *   stdout 最后一行：`R46RESULT {…}`
 *
 * 为什么要专门起一个 Chromium 跑产物：只看"文件里有 canvas / addEventListener"是字面判据，
 * 证明不了能玩。这里用真实渲染进程采三件事：
 *  ① 加载有没有失败 / 渲染进程有没有崩 / 控制台有没有 error；
 *  ② **什么都不按**隔 1.5 秒取两次画布像素指纹 —— 不一样才说明游戏循环在跑（静态图会一模一样）；
 *  ③ 空闲不动时先点画布、再按 Enter/W/A/S/D 与四个方向键各一次，隔 1.6 秒连取两次；
 *     仍然一动不动才**单按一次空格**（打砖块类的发球键）再连取两次。三条里任一段自己变过 ⇒ 循环在跑。
 * 合成按键**派发在画布上**（bubbles 经过 document → window），一次投递同时喂给三种监听位置；
 * 派发在 window 上时事件路径里没有 document，监听 document 的游戏一个键都收不到（第 53 轮假红根因）。
 * 窗口必须 `show: true` + `backgroundThrottling: false`：隐藏窗里 Chromium 会节流 rAF，
 * 会把"能跑的游戏"误判成"没在动"（仪器自伤，不是产品问题）。
 */
const { app, BrowserWindow } = require('electron');
const url = require('node:url');

const wen = process.argv[process.argv.length - 1];
const cuo = [];
const jie = { ok: false, jiaZaiWan: false, hasCanvas: false, ziDong: false, jianPan: false, jieZhu: 0, zhenShu: 0, cuo };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 画布像素指纹（只采样步长 997 的字节，够区分"动了没有"，不必全量） */
const PIAO = `() => {
  var cv = document.querySelector('canvas');
  if (!cv) return 'NOCANVAS';
  try {
    var w = cv.width || cv.clientWidth || 1;
    var h = cv.height || cv.clientHeight || 1;
    var d = cv.getContext('2d').getImageData(0, 0, w, h).data;
    var x = 0;
    for (var i = 0; i < d.length; i += 997) { x = (x * 31 + d[i]) >>> 0; }
    return String(x) + ':' + w + 'x' + h;
  } catch (e) { return 'ERR:' + e.message; }
}`;

/**
 * 合成按键的派发目标（第 53 轮仪器修正）：**派发在画布上**，`bubbles` 让它依次经过 canvas → document → window，
 * 一次投递就能同时喂给监听 canvas / document / window 的游戏。
 * 真机教训：上一版只往 `window` 上派发 ⇒ 事件路径里**没有 document**，监听 `document` 的游戏一个键都收不到
 * （打砖块收不到空格 ⇒ 球永远发不出去 ⇒ 「游戏循环真跑」假红；复现读数：window 派发 moving=false，
 * document/canvas 派发 moving=true）。
 */
const PAI_FA = (jian) => `(() => {
  var host = document.querySelector('canvas') || document;
  for (const [k, c] of ${JSON.stringify(jian)}) {
    host.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: c, bubbles: true }));
    host.dispatchEvent(new KeyboardEvent('keyup', { key: k, code: c, bubbles: true }));
  }
  return 1;
})()`;
const FANG_XIANG = [['ArrowLeft', 'ArrowLeft'], ['ArrowRight', 'ArrowRight'], ['ArrowUp', 'ArrowUp'], ['ArrowDown', 'ArrowDown']];
/**
 * 方向键按下去，**页面自己的处理器有没有真的接住**（行为证据，不是关键词）：
 * 事件带 `cancelable: true` 派发，回来读 `defaultPrevented` —— 只有页面里的处理器调了
 * `e.preventDefault()` 才会是 true。
 * 为什么需要这条：真机读数显示贪吃蛇**加载后 1.9 秒就自己撞墙结束**（仪器在 2.7 秒才按键），
 * 死画面上"像素变没变"这条量不到任何东西 ⇒ 把合法游戏判成"键盘没接上"。
 * 它同时也是一条**更硬**的要求：没有任何键盘处理（或处理器不认方向键）的页面在这里必然给 0。
 */
const JIE_ZHU = `(() => {
  var host = document.querySelector('canvas') || document; var jie = 0;
  for (const [k, c] of ${JSON.stringify(FANG_XIANG)}) {
    const ev = new KeyboardEvent('keydown', { key: k, code: c, bubbles: true, cancelable: true });
    host.dispatchEvent(ev);
    if (ev.defaultPrevented) jie++;
    host.dispatchEvent(new KeyboardEvent('keyup', { key: k, code: c, bubbles: true }));
  }
  return jie;
})()`;

async function zhu() {
  await app.whenReady();
  const win = new BrowserWindow({
    show: true, width: 900, height: 640, title: 'WArmy 压力档 A 夹具',
    webPreferences: { backgroundThrottling: false, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  win.webContents.on('console-message', (_e, level, message) => { if (Number(level) >= 3) cuo.push(String(message).slice(0, 160)); });
  win.webContents.on('did-fail-load', (_e, code, desc) => { cuo.push('did-fail-load ' + code + ' ' + desc); });
  win.webContents.on('render-process-gone', () => { cuo.push('render-process-gone'); });
  await win.loadURL(url.pathToFileURL(wen).href);
  jie.jiaZaiWan = true;
  await sleep(1200);
  jie.hasCanvas = await win.webContents.executeJavaScript(
    `!!document.querySelector('canvas') && ((document.querySelector('canvas').width || document.querySelector('canvas').clientWidth) > 0)`,
  );
  const p1 = String(await win.webContents.executeJavaScript('(' + PIAO + ')()'));
  await sleep(1500);
  const p2 = String(await win.webContents.executeJavaScript('(' + PIAO + ')()'));
  /**
   * 证据位（不参与判据）：空闲 500ms 内渲染进程出了多少帧。
   * 用途是把两类红分开：**页面根本没在出帧**（仪器自伤/脚本卡死）与**在出帧但状态机静止**
   * （合法待发球画面，比如打砖块没发球）。判据仍然只看像素有没有随时间变，不因为这个数放松。
   */
  jie.zhenShu = await win.webContents.executeJavaScript(
    `new Promise((res) => { var n = 0, t0 = performance.now(); var f = () => { n++; if (performance.now() - t0 < 500) requestAnimationFrame(f); else res(n); }; requestAnimationFrame(f); })`,
  );
  /**
   * **开始键后再看循环**（第 50 轮仪器修正）：
   * 很多网页游戏是「空格/回车开始」——静止开始画面本身是合法交互，不该判成"没跑游戏循环"。
   * 真正的不变量是：**循环一旦跑起来就必须自己动**（不是每按一次才走一格）。
   * 所以：空闲 p1≠p2 ⇒ ziDong；否则按空格/回车起跑，再隔 1.5s 取两次，pS1≠pS2 也算 ziDong。
   */
  /**
   * **起跑后再看循环**（第 51 轮修正 2）：
   * 打砖块这类游戏是「按键/点击**发球**，之后自己动」——发球前静止是**合法**的。
   * 所以顺序改成：① 空闲不动 ⇒ 点画布 + W/A/S/D/空格/回车各按一次；
   * ② **再按方向键**（发球）；③ 发球后连测两次，`pS1≠pS2` ⇒ 循环真的在跑；
   * ④ 键盘判据看「发球后的状态 ≠ 发球前」。
   */
  /**
   * **起跑后再看循环（第 51 轮修正 3）**
   *
   * 真机教训：**空格在打砖块里是"暂停"** —— 上一版为了"开始"连按空格，把正在跑的游戏按停了，
   * 于是「循环在跑」和「键盘接上了」双双判红（其实两次都是仪器自己干的）。
   * 现在：
   *  · 空闲就动 ⇒ 直接算循环在跑，**不按任何键**打搅它；
   *  · 空闲不动 ⇒ 只点画布 + Enter/W/A/S/D（**绝不按空格**），再按方向键发球；
   *  · 发球后连测两次 `pS1/pS2`；键盘判据看「发球前 → 发球后」是否变化。
   */
  let pS1 = '', pS2 = '', pT1 = '', pT2 = '';
  const qiDong = p1 !== p2;
  if (!qiDong) {
    await win.webContents.executeJavaScript(
      `(() => {
        var cv = document.querySelector('canvas');
        if (cv) { const r = cv.getBoundingClientRect(); const o = { clientX: r.left + r.width/2, clientY: r.top + r.height/2, bubbles: true }; cv.dispatchEvent(new MouseEvent('click', o)); cv.dispatchEvent(new MouseEvent('mousedown', o)); document.dispatchEvent(new MouseEvent('click', o)); }
        return 1;
      })()`,
    );
    await win.webContents.executeJavaScript(PAI_FA([['Enter', 'Enter'], ['w', 'KeyW'], ['a', 'KeyA'], ['s', 'KeyS'], ['d', 'KeyD']]));
    await sleep(400);
    jie.jieZhu = await win.webContents.executeJavaScript(JIE_ZHU);
    await sleep(300);
    pS1 = String(await win.webContents.executeJavaScript('(' + PIAO + ')()'));
    await sleep(1600);
    pS2 = String(await win.webContents.executeJavaScript('(' + PIAO + ')()'));
    /**
     * **仍然一动不动 ⇒ 只按一次空格再试**（第 53 轮修正 4）：
     * 打砖块/弹球类的"发球键"就是空格，空格不在 Enter/WASD/方向键里 ⇒ 这一类只能靠这一次空格起跑。
     * 第 51 轮那次假红是**连按空格**把正在跑的游戏按停；这里只在「所有键都试完、画面仍然冻结」时才按，
     * 此刻没有"正在动"可被按停，空格只可能让它开始动。判据本身一分没降：仍要求 1.6 秒里像素自己变。
     */
    if (pS1 && pS2 && pS1 === pS2) {
      await win.webContents.executeJavaScript(PAI_FA([[' ', 'Space']]));
      await sleep(400);
      pT1 = String(await win.webContents.executeJavaScript('(' + PIAO + ')()'));
      await sleep(1600);
      pT2 = String(await win.webContents.executeJavaScript('(' + PIAO + ')()'));
    }
  } else {
    /** 已经在动：先量一次，按方向键，再量一次（不按空格，免得把正在跑的按停） */
    pS1 = p2;
    jie.jieZhu = await win.webContents.executeJavaScript(JIE_ZHU);
    await sleep(1200);
    pS2 = String(await win.webContents.executeJavaScript('(' + PIAO + ')()'));
  }
  const p3 = pT2 || pS2;
  jie.p1 = p1; jie.p2 = p2; jie.p3 = p3; jie.pS1 = pS1; jie.pS2 = pS2; jie.pT1 = pT1; jie.pT2 = pT2;
  const jiChu = !p1.startsWith('ERR') && !p1.startsWith('NOCANVAS');
  /** 循环在跑：空闲自己动，或发球后自己动，或单按一次空格后自己动 */
  jie.ziDong = jiChu && (qiDong || !!(pS1 && pS2 && pS1 !== pS2) || !!(pT1 && pT2 && pT1 !== pT2));
  /** 键盘接上：按键前后画面变了，**或**页面自己的处理器确实接住了方向键（preventDefault 行为证据） */
  jie.jianPan = !!(pS1 && pS2 && pS1 !== pS2) || p2 !== p3 || Number(jie.jieZhu) > 0;
  jie.ok = true;
  console.log('R46RESULT ' + JSON.stringify(jie));
  app.exit(0);
}

zhu().catch((e) => {
  cuo.push(String((e && e.message) || e).slice(0, 200));
  console.log('R46RESULT ' + JSON.stringify(jie));
  app.exit(1);
});
