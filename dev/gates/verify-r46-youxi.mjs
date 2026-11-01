/**
 * 压力档 A（第 45 轮 · 用户点名的两套新压力档之一）：**让真模型连做 6 轮网页小游戏，每轮都当场验收**
 *
 * 为什么是"6 轮 + 每轮验收"而不是"1 轮看它写不写得出来"：
 *  · 单轮能写对，不代表改 5 次之后还能跑（真实缺陷都出现在迭代第 3–4 轮：加功能时把主循环改坏、
 *    改样式时把事件绑丢了）；
 *  · 只看"文件里有 canvas 这个词"是字面判据，证明不了能玩 ⇒ 最后一轮必须**真的在 Chromium 里跑起来**，
 *    按下键之后画面/状态得动起来。
 *
 * 全程真跑（无任何模拟）：真 Electron + 真 Ollama 模型 + 真工具落盘 + 真浏览器目标加载产物。
 * 独立 user-data-dir 与独立调试端口，不动用户正在用的实例。
 *
 * 用法：`node dev/gates/verify-r46-youxi.mjs`（需要本机 Ollama 在跑；`OLLAMA_MODEL=...` 可指定模型）
 *      `KEEP=1` 保留临时产物目录与截图便于复盘。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const GEN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PKG = path.join(GEN, 'packages', 'app-shell');
const { attach, sleep } = await import(pathToFileURL(path.join(PKG, 'scripts', 'cdp-lib.mjs')).href);

const PORT = Number(process.env.R46_PORT || 9946);
/**
 * 一轮对话的预算（毫秒）。本机 Ollama 上的 27B q4 改一个单文件游戏，实测**单轮 700+ 秒**；
 * 默认给 30 分钟，`R46_LUN_MIAO` 可调。宁可等，也不许仪器先超时把整档带走。
 */
const YI_LUN_CHAO_SHI = Math.max(120_000, Number(process.env.R46_LUN_MIAO || 1_800_000));
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || '';
const KEEP = process.env.KEEP === '1';
const PROFILE = path.join(os.tmpdir(), 'warmy-r46-youxi-profile-' + Date.now());
const SID = 'r46-youxi';
const electron = path.join(PKG, 'node_modules', 'electron', 'dist', 'electron.exe');
const mainJs = path.join(PKG, 'dist', 'electron-main.js');

let pass = 0; let fail = 0; let skip = 0;
const ok = (ming, jz, xiang) => {
  if (jz === true) { pass++; console.log(`  ok   ${ming}`); return true; }
  if (jz === 'skip') { skip++; console.log(`  SKIP ${ming} —— ${xiang === undefined ? '' : String(xiang).slice(0, 200)}`); return false; }
  fail++; console.log(`  FAIL ${ming} —— ${xiang === undefined ? '' : JSON.stringify(xiang).slice(0, 300)}`); return false;
};

/** 探活：找一个**真的能带工具对话**的本机模型（不能靠名字猜，真机事故：名字像能用的其实不支持 chat） */
async function xuanZeMoXing() {
  if (OLLAMA_MODEL) return OLLAMA_MODEL;
  const lie = await new Promise((res) => {
    const q = http.get('http://127.0.0.1:11434/api/tags', (r) => {
      let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d).models || []); } catch { res([]); } });
    });
    q.on('error', () => res([])); q.setTimeout(6000, () => { q.destroy(); res([]); });
  });
  const qu = async (mo) => new Promise((res) => {
    const ti = JSON.stringify({
      model: mo, stream: false, messages: [{ role: 'user', content: '只回答两个字：收到' }],
      tools: [{ type: 'function', function: { name: 'ping', description: '探针', parameters: { type: 'object', properties: {} } } }],
    });
    const q = http.request('http://127.0.0.1:11434/api/chat', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(ti) } }, (r) => {
      let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { const j = JSON.parse(d); res(!!(j.message || j.response || j.choices)); } catch { res(false); } });
    });
    q.on('error', () => res(false)); q.setTimeout(30000, () => { q.destroy(); res(false); }); q.write(ti); q.end();
  });
  for (const m of lie) {
    const n = String(m.name || '');
    if (!n) continue;
    if (await qu(n)) return n;
  }
  return '';
}

/**
 * **模型选择**（第 51 轮）：给 `MIMO_KEY_FILE` 时优先用云端 MiMo（工具调用更稳，多轮改写不易漏改）；
 * 否则用本机 Ollama 探测可用模型。两条都是真供应商，不掺假。
 */
const MIMO_KEY_FILE = String(process.env.MIMO_KEY_FILE || '').trim();
const MIMO_KEY = (() => {
  try {
    if (!MIMO_KEY_FILE) return '';
    return String(fs.readFileSync(MIMO_KEY_FILE, 'utf8').split(/\r?\n/)[0] || '').trim();
  } catch { return ''; }
})();
const YONG_MIMO = !!MIMO_KEY && process.env.R46_OLLAMA !== '1';
const MOXING = YONG_MIMO ? (process.env.R46_MIMO_MODEL || 'mimo-v2.6-flash') : await xuanZeMoXing();
if (!MOXING) { console.log('FAIL 本机 Ollama 里没有可用的对话模型（探活全失败）—— 压力档 A 要求真模型，不许降级成模拟'); process.exit(1); }
console.log(`压力档 A · 真模型 = ${MOXING} · 独立 profile = ${PROFILE}`);

/** 预置 settings.json：跳过首启引导 + 只挂这台 Ollama（不需要密钥） */
fs.mkdirSync(path.join(PROFILE, 'workspace', SID), { recursive: true });
fs.writeFileSync(path.join(PROFILE, 'settings.json'), JSON.stringify({
  setupDone: true, guideDone: true, privacyConsent: true, providersSeeded: true,
  providers: YONG_MIMO
    ? [{ id: 'mimo-r46', biaoQian: 'MiMo(r46)', protocol: 'openai-compatible', baseURL: 'https://token-plan-cn.xiaomimimo.com/v1', defaultModel: MOXING, models: [MOXING], hasKey: true, staleModels: {} }]
    : [{ id: 'ollama-r46', biaoQian: 'Ollama(r46)', protocol: 'ollama', baseURL: 'http://127.0.0.1:11434', defaultModel: MOXING, models: [MOXING], hasKey: false, staleModels: {} }],
  instances: [],
  specialModels: { chatChain: [MOXING] },
  contextBudgetPercent: 60,
}), 'utf8');

const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [
  `--remote-debugging-port=${PORT}`,
  '--disable-features=CalculateNativeWinOcclusion',
  `--user-data-dir=${PROFILE}`,
  mainJs,
], { cwd: PKG, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false, env });
child.stdout.on('data', () => { /* 吞掉，避免管道写满把进程卡住 */ });
child.stderr.on('data', () => { /* noop */ });

const WS = path.join(PROFILE, 'workspace', SID);
const zhaoWenJian = (ming) => {
  for (const lu of [path.join(WS, ming), path.join(WS, 'workspace', SID, ming)]) {
    if (fs.existsSync(lu)) return lu;
  }
  try {
    for (const f of fs.readdirSync(WS, { recursive: true })) {
      if (String(f).endsWith(ming)) return path.join(WS, String(f));
    }
  } catch { /* 目录还没建 */ }
  // 工作区之外也别漏：模型可能写到 profile 里别处（整个 profile 扫一遍，最多一层深）
  try {
    for (const f of fs.readdirSync(PROFILE, { recursive: true })) {
      if (String(f).endsWith(ming)) return path.join(PROFILE, String(f));
    }
  } catch { /* noop */ }
  return '';
};
/**
 * **等产物出现**再判：工具落盘与 IPC 返回之间有一小段窗口（真机量到过 1–3 秒）。
 * 立刻判"没文件"会把"其实写了、只是还没落盘"误报成口头执行 —— 那是仪器冤枉产品。
 */
async function dengWenJian(ming, miaoShu = 30_000) {
  const t0 = Date.now();
  for (;;) {
    const lu = zhaoWenJian(ming);
    if (lu) return lu;
    if (Date.now() - t0 > miaoShu) return '';
    await sleep(1000);
  }
}

let c = null;
const shouWei = () => { try { c && c.close(); } catch { /* noop */ } try { child.kill('SIGKILL'); } catch { /* noop */ } };
process.on('exit', () => { if (!KEEP) { try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch { /* noop */ } } });

async function dengQiDong() {
  // 先等 CDP 端口本身起来，再连（顺序反了会一直抛"没有 page target"）
  let shang = false;
  for (let i = 0; i < 200; i++) {
    try {
      const rr = await fetch('http://127.0.0.1:' + PORT + '/json', { signal: AbortSignal.timeout(1200) });
      if (rr.ok) { shang = true; break; }
    } catch { /* 还没起 */ }
    await sleep(500);
  }
  if (!shang) return false;
  await sleep(6000);
  for (let i = 0; i < 30; i++) {
    try {
      c = await attach(PORT, { biaoQian: 'r46youxi', callTimeout: 30000 });
      await c.send('Runtime.enable');
      // cdp-lib 的 evaluate **直接返回求值结果**（不是 CDP 信封），别再去摸 .result.value
      const zhi = await c.evaluate('typeof window.warmy === "object" && typeof window.warmy.chatSend === "function"');
      if (zhi === true) return true;
    } catch { /* 渲染进程还在起 */ }
    await sleep(2000);
  }
  return false;
}
/**
 * 一次 CDP 求值。**超时/断开都不许把整档带走**：如实返回 `{__chaoshi}`，由调用方判这一轮红。
 * 真机事故：第 2 轮实际跑了 718 秒，而内层 CDP 超时写的是 600 秒 ⇒ 抛出去被最外层 catch 接住，
 * 整档在第 1 轮就收工，后面 5 轮一行读数都没有。那不是产品红，是**仪器把自己掐死了**。
 * 所以现在：内层超时 = 调用方给的预算 + 30 秒（永远比外层晚炸），且异常就地转成读数。
 */
async function js(biaoDa, chaoShi = YI_LUN_CHAO_SHI) {
  try {
    const zhi = await c.evaluate(`(async function(){ try { return await (${biaoDa}); } catch (e) { return { __err: String((e && (e.message || e)) || e).slice(0,240) }; } })()`, { awaitPromise: true, timeout: chaoShi + 30_000 });
    return zhi === undefined ? null : zhi;
  } catch (e) {
    return { __chaoshi: String((e && (e.message || e)) || e).slice(0, 200) };
  }
}
/**
 * 发一轮对话。本机 27B 模型改一个文件要 10 分钟量级（实测第 2 轮 718 秒）⇒ 预算给足，
 * 并且**每轮都打出耗时**：读日志的人要能分清"模型慢"与"卡住了"。
 */
async function faSong(neiRong, chaoShi = YI_LUN_CHAO_SHI) {
  const t0 = Date.now();
  const r = await js(`window.warmy.chatSend({ sessionId: ${JSON.stringify(SID)}, content: ${JSON.stringify(neiRong)}, role: 'user', ming: '牛马-1', model: ${JSON.stringify(MOXING)} }).then(r => ({ ok: !!(r && r.ok), reply: String((r && r.reply) || '').slice(0, 400), err: String((r && (r.error || '')) ), code: String((r && (r.code || '')) ), needsKey: !!(r && r.needsKey), skipped: String((r && (r.skipped || '')) ), keys: r ? Object.keys(r).slice(0, 12).join(',') : '' }))`, chaoShi);
  const miao = Math.round((Date.now() - t0) / 1000);
  if (!r) {
    console.log(`  · 这一轮用了 ${miao} 秒（evaluate 返回空）`);
    return { ok: false, reply: '', err: 'evaluate-null', __err: 'evaluate-null' };
  }
  if (r && (r.__chaoshi || r.__err)) console.log(`  · 这一轮**没拿到回复**（${miao} 秒）：${String(r.__chaoshi || r.__err).slice(0, 180)}`);
  else {
    const zi = String((r && r.reply) || '').length;
    console.log(`  · 这一轮用了 ${miao} 秒（回复 ${zi} 字）`);
    /** 0 字/秒级返回多半是 IPC 立刻失败 —— 必须把 err 打出来，否则只看到「0 字」会误判成模型慢 */
    if (zi === 0) console.log(`  · 空回复详情：ok=${r && r.ok} err=${String((r && r.err) || '').slice(0, 200)} code=${r && r.code} needsKey=${r && r.needsKey} skipped=${r && r.skipped} keys=${r && r.keys}`);
  }
  return r;
}

/** 结构判据（不是字面锚：这些是"能不能玩"的必要条件，行为判据在最后一轮） */
const PAN = {
  canvas: (t) => /<canvas/i.test(t),
  xunHuan: (t) => {
    const s = String(t || '');
    if (/requestAnimationFrame|setInterval/i.test(s)) return true;
    /**
     * 自续的 `setTimeout(tick, …)` 也是循环（第 53 轮真机读数）：贪吃蛇写成
     * `function tick(){ …; timer = setTimeout(tick, curMs()); }` —— 全文既没有 rAF 也没有 setInterval，
     * 旧判据按关键词表把它判红，红的是仪器。
     * 现在判的是**行为**：只有"在自己的函数体里把自己再排一次"才算循环；
     * 一次性延时 `setTimeout(yiCi, 500)`（函数体里没有再排自己）必须判假。
     */
    const mingList = [...s.matchAll(/setTimeout\s*\(\s*([A-Za-z_$][\w$]*)\s*[,)]/g)].map((m) => m[1]);
    for (const n of new Set(mingList)) {
      const DING_YI = new RegExp(
        '(?:function\\s+' + n + '\\s*\\([^)]*\\)' +
        '|(?:const|let|var)\\s+' + n + '\\s*=\\s*(?:async\\s+)?(?:function\\s*\\([^)]*\\)|(?:\\([^)]*\\)|[A-Za-z_$][\\w$]*)\\s*=>)' +
        '|' + n + '\\s*=\\s*function\\s*\\([^)]*\\))');
      const m = DING_YI.exec(s);
      if (!m) continue;
      const qi = s.indexOf('{', m.index + m[0].length);
      if (qi < 0) continue;
      let shen = 1, i = qi + 1;
      while (i < s.length && shen > 0) { const c = s[i]; if (c === '{') shen++; else if (c === '}') shen--; i++; }
      if (new RegExp('setTimeout\\s*\\(\\s*' + n + '\\s*[,)]').test(s.slice(qi + 1, i - 1))) return true;
    }
    return false;
  },
  jianPan: (t) => /addEventListener\(\s*['"]keydown|onkeydown|key\s*===?\s*['"]Arrow/i.test(t),
  fenShu: (t) => /(score|分数|得分)/i.test(t),
  /**
   * 碰撞判定：**不看有没有 collision 这个词**。
   * 真机事故：模型写的贪吃蛇是 `if(h.x<0||h.x>=COLS||h.y<0||h.y>=ROWS)return die();` +
   * `if(snake.some(s=>s.x===h.x&&s.y===h.y))return die();` —— 撞墙、撞自己、吃食物全都有，
   * 但全文没有 collision/hit/碰撞 任何一个字，旧判据（关键词表）当场判红，红的是**仪器**。
   * 现在判"判定 + 后果"两段关系：① 有条 if/while 的条件里几何量参与了大小比较（撞边界）
   * 或两个坐标互等（吃到/撞上）；② 命中之后状态真的变了（加分/掉命/结束/消块/反弹）。
   * 反例（`FAN_LI_WU_PENG_ZHUANG`）必须判红 —— 只有匀速移动的方块 + 键盘 + 分数显示，凑不齐这两段。
   */
  pengZhuang: (t) => {
    const kuai = [...String(t).matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join('\n');
    const jian = kuai || String(t);
    const ZUO_BIAO = /(?:\.[xyz]\b|\b(?:x|y|w|h|dx|dy|left|top|right|bottom|cols?|rows?|width|height|GRID|CELL)\b)/;
    let panDing = false;
    for (const m of jian.matchAll(/(?:if|while)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)) {
      const c = String(m[1] || '');
      if (!ZUO_BIAO.test(c)) continue;
      /** 大小比较（撞墙/出界）。`===`/`!==` 单独出现不算：键盘分支 `dir.y!==1` 也长这样 */
      if (/[<>]=?/.test(c.replace(/!==|===/g, ''))) { panDing = true; break; }
      /** 坐标对坐标的相等（吃到食物 / 撞上砖块） */
      if (/\.[xyz]\s*={2,3}\s*[A-Za-z_$][\w$]*\.[xyz]\b/.test(c)) { panDing = true; break; }
    }
    const HOU_GUO = /(?:\bscore\b|得分|分数|\blife\b|\bhp\b|dead|die\s*\(|game ?over|游戏结束|重开|再来一局|splice\(|反向|bounce|(?:d[xy]|vx|vy)\s*=\s*-)/i;
    return panDing && HOU_GUO.test(jian);
  },
  chongKai: (t) => /(restart|reset|重新开始|再来一局|游戏结束|game over)/i.test(t),
  cunDang: (t) => /(localStorage|sessionStorage|indexedDB|document\.cookie)/i.test(t) && /(high|best|最高|topScore|maxScore)/i.test(t),
  /**
   * 暂停/继续：**看行为，不看变量名**。
   * 真机教训：模型写的是 `let paused` + `else if((k === ' ' || k === 'p') ...) paused = !paused;`，
   * 旧判据只认 `key === ' '`（变量叫 k 就漏）⇒ 把"已经做对"判成红。
   */
  zanTing: (t) => (/(pause|paused|暂停|isRunning|running|togglePlay|togglePause|gamePaused|stopLoop)/i.test(t)
    && /(?:key|k|e\.key|event\.key|which|keyCode)\s*===?\s*(?:'\s'|"\s"|'p'|"p"|'P'|"P"|32)/i.test(t))
    || /code\s*===?\s*["'](?:Space|KeyP)["']/i.test(t),
  suDu: (t) => /(speed|速度|level|关卡|difficulty|tick|interval|delay|变快|渐进|progression)/i.test(t),
  wuWangLuo: (t) => !/<script[^>]+src\s*=\s*["'](https?:)?\/\//i.test(t) && !/\bfetch\s*\(\s*["']https?:/i.test(t),
  shuoMing: (t) => /(操作说明|玩法|按键|↑|←|→|空格|Space)/.test(t),
};
/**
 * 仪器自证的**反例**：canvas、requestAnimationFrame、键盘、分数显示全都有，就是没有碰撞。
 * 每条结构判据都必须在它身上给出"该有的过、不该有的红"，否则判据只是关键词表（本轮就栽在这上面）。
 */
const FAN_LI_WU_PENG_ZHUANG = `<!doctype html><html><body><canvas id=c width=400 height=400></canvas><script>
const ctx=c.getContext('2d');let x=0;let score=0;
addEventListener('keydown',e=>{if(e.key==='ArrowLeft')x-=10;else if(e.key==='ArrowRight')x+=10;});
function loop(){ctx.clearRect(0,0,400,400);ctx.fillRect(x,200,20,20);ctx.fillText('分数 '+score,10,10);x=x+1;requestAnimationFrame(loop);}
loop();</script></body></html>`;
ok('仪器自证：反例（有画面/循环/键盘/分数，但没碰撞）必须被碰撞判据判红', PAN.pengZhuang(FAN_LI_WU_PENG_ZHUANG) === false);
ok('仪器自证：反例在其它判据上该绿的仍然绿（说明判据各管各的，不是全都靠关键词）',
  PAN.canvas(FAN_LI_WU_PENG_ZHUANG) === true && PAN.xunHuan(FAN_LI_WU_PENG_ZHUANG) === true
  && PAN.jianPan(FAN_LI_WU_PENG_ZHUANG) === true && PAN.fenShu(FAN_LI_WU_PENG_ZHUANG) === true);

/**
 * 「游戏循环」这条静态判据的**两侧反例**（第 53 轮）：认自续 tick 为循环，但一次性延时不算。
 * 少了后一条，判据就退化成"文件里出现过 setTimeout 字样"。
 */
const FAN_LI_YI_CXING = `<!doctype html><canvas id=c></canvas><script>
var x=c.getContext('2d'); function yiCi(){ x.fillRect(10,10,5,5); } setTimeout(yiCi, 500);</script>`;
ok('仪器自证：一次性 setTimeout（没有自续）必须被"游戏循环"判红', PAN.xunHuan(FAN_LI_YI_CXING) === false);
ok('仪器自证：自续 tick（function 体里再排自己）必须被"游戏循环"判绿',
  PAN.xunHuan('function tick(){ draw(); timer = setTimeout(tick, curMs()); }') === true
  && PAN.xunHuan('const tick = () => { draw(); setTimeout(tick, 150); };') === true);

/**
 * **真跑判据的反例自证**（第 53 轮）：`循环真跑` 这条新增了「所有键都不动 ⇒ 单按一次空格后再看」的补救分支，
 * 必须钉住它拦得住两类假绿：① 静态图（画一次就不动）；② 每按一次才走一格（keydown 推一帧、没有循环）。
 * 两类都必须 `ziDong === false`，否则补救就等于"能亮就算过"。跑不起来判红（"没测到"不算过）。
 */
const JIA_JU = path.join(GEN, 'dev', 'gates', 'r46-chromium-harness.cjs');
const FAN_LI_JING_TAI = `<!doctype html><meta charset=utf-8><canvas id=c width=640 height=480></canvas><script>
var x=c.getContext('2d');x.fillStyle='#123';x.fillRect(0,0,640,480);x.fillStyle='#eee';x.fillRect(100,100,60,30);</script>`;
const FAN_LI_ZOU_YI_GE = `<!doctype html><meta charset=utf-8><canvas id=c width=640 height=480></canvas><script>
var x=c.getContext('2d'),n=0;x.fillStyle='#123';x.fillRect(0,0,640,480);
document.addEventListener('keydown',function(){n++;x.fillStyle='#f0f';x.fillRect((n*37)%600,200,20,20);});</script>`;
const ZIZHENGLU = path.join(os.tmpdir(), 'warmy-r46-zizheng-' + process.pid);
fs.mkdirSync(ZIZHENGLU, { recursive: true });
const LU_JING_TAI = path.join(ZIZHENGLU, 'jing-tai.html');
const LU_ZOU_YI_GE = path.join(ZIZHENGLU, 'zou-yi-ge.html');
fs.writeFileSync(LU_JING_TAI, FAN_LI_JING_TAI, 'utf8');
fs.writeFileSync(LU_ZOU_YI_GE, FAN_LI_ZOU_YI_GE, 'utf8');
const zi1 = await zaiZhenLi(LU_JING_TAI);
ok('仪器自证：静态图必须被"循环真跑"判红', zi1.ok === true && zi1.ziDong === false,
  { ok: zi1.ok, why: zi1.why, ziDong: zi1.ziDong, p1: zi1.p1, pS: [zi1.pS1, zi1.pS2], pT: [zi1.pT1, zi1.pT2], zhenShu: zi1.zhenShu });
const zi2 = await zaiZhenLi(LU_ZOU_YI_GE);
ok('仪器自证：每按一次才走一格（没有循环）必须被"循环真跑"判红', zi2.ok === true && zi2.ziDong === false,
  { ok: zi2.ok, why: zi2.why, ziDong: zi2.ziDong, jianPan: zi2.jianPan, pS: [zi2.pS1, zi2.pS2], pT: [zi2.pT1, zi2.pT2] });
try { fs.rmSync(ZIZHENGLU, { recursive: true, force: true }); } catch { /* 自证夹具删不掉不算红 */ }

function yuFaCheck(t) {
  const ding = [...t.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  if (!ding.length) return { ok: false, why: '页面上没有任何脚本 ⇒ 游戏不可能有逻辑' };
  for (const m of ding) {
    const d = String(m[1] || '');
    if (!d.trim() || /src\s*=/.test(m[0])) continue;
    try { new Function(d); } catch (e) { return { ok: false, why: String(e.message || e).slice(0, 160) }; }
  }
  return { ok: true };
}

/**
 * **在真 Chromium 里跑产物**：把随门禁一起提交的夹具 `r46-chromium-harness.cjs` 放进一个临时应用目录
 * （独立 user-data-dir，不碰用户实例），用仓库里的 electron 二进制以**应用模式**拉起来。
 * 起不来或没输出结果 ⇒ 如实 skip 并带原因（"没测到"绝不计成通过）。
 */
async function zaiZhenLi(wenJian) {
  const mu = path.join(os.tmpdir(), 'warmy-r46-chromium-' + Date.now());
  try {
    fs.mkdirSync(mu, { recursive: true });
    if (!fs.existsSync(JIA_JU)) return { ok: 'skip', why: '夹具文件不存在：' + JIA_JU };
    fs.copyFileSync(JIA_JU, path.join(mu, 'jiaju.cjs'));
    fs.writeFileSync(path.join(mu, 'package.json'), JSON.stringify({ name: 'r46-harness', version: '0.0.0', main: 'jiaju.cjs' }), 'utf8');
    const h = spawn(electron, ['--user-data-dir=' + path.join(mu, 'userdata'), mu, wenJian], { cwd: PKG, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let chu = '';
    h.stdout.on('data', (d) => { chu += String(d); });
    h.stderr.on('data', (d) => { chu += String(d).slice(0, 400); });
    const jieshu = await Promise.race([new Promise((res) => h.on('exit', () => res(chu))), sleep(150_000).then(() => '__chaoshi')]);
    try { h.kill('SIGKILL'); } catch { /* 已经退了 */ }
    const m = /R46RESULT (\{.*\})/.exec(String(jieshu));
    if (!m) return { ok: 'skip', why: (String(jieshu) === '__chaoshi' ? '150 秒没出结果（Chromium 起不来或被系统拦了）' : '夹具没输出结果行') + '：' + String(jieshu).slice(0, 200) };
    try { return JSON.parse(m[1]); } catch (e) { return { ok: 'skip', why: '结果解析失败：' + String((e && e.message) || e).slice(0, 120) }; }
  } finally {
    if (!KEEP) { try { fs.rmSync(mu, { recursive: true, force: true }); } catch { /* 临时目录清不掉不算红 */ } }
    else console.log('  · Chromium 临时夹具目录保留：' + mu);
  }
}

let caiZhenLu = '';
/**
 * 红的时候把应用自己的审计尾巴打出来（**不许写一个日志里搜不到的原因**）：
 * 停止发送 / 预算降级 / 工具被裁 / 产物审计判口头执行，全在 `audit/audit.jsonl` 里有据可查。
 */
function auditWei(tiao = 14) {
  try {
    const f = path.join(PROFILE, 'audit', 'audit.jsonl');
    if (!fs.existsSync(f)) { console.log('  · （没有审计文件：' + f + '）'); return; }
    const xing = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).slice(-tiao);
    console.log(`  · 应用审计最后 ${xing.length} 条（查因用，路径见上）：`);
    for (const l of xing) {
      try {
        const j = JSON.parse(l);
        const d = j.detail || {};
        const yao = ['sessionId', 'que', 'chuangKou', 'guDing', 'gongJu', 'rangChu', 'rengQue', 'zuiDuo', 'baoDi', 'kouTouZhiXing', 'queShao', 'yiZhi', 'reason', 'error']
          .filter((k) => d[k] !== undefined).map((k) => `${k}=${JSON.stringify(d[k])}`).join(' ');
        console.log(`      ${String(j.op || '')} ${yao}`.slice(0, 240));
      } catch { /* 半行不算事 */ }
    }
  } catch (e) { console.log('  · 审计读不出来：' + String((e && e.message) || e).slice(0, 120)); }
}
try {
  if (!await dengQiDong()) { ok('应用启动（独立 profile）', false, '120 次探活失败'); throw new Error('boot-timeout'); }
  ok('应用启动（独立 profile + 独立端口，没动用户的实例）', true);
  /** 云端 MiMo 腿：把密钥交给宿主（不落日志、不打印） */
  if (YONG_MIMO) {
    try {
      const rk = await js('window.warmy.providerKeySet(' + JSON.stringify({ providerId: 'mimo-r46', apiKey: MIMO_KEY }) + ')');
      ok('MiMo 密钥已交给宿主（不打印）', !!(rk && rk.ok !== false));
    } catch (e) { ok('MiMo 密钥已交给宿主（不打印）', false, String((e && e.message) || e)); }
  }

  // ── 第 1 轮：从零做出来 ──
  const r1 = await faSong([
    '我们来做**一个单文件网页小游戏**（打砖块或贪吃蛇都行）。',
    '要求：用 write_file 在当前会话工作区写 `youxi.html`，一个文件就能跑（不要构建、不要外部依赖、不要联网），',
    '必须有：canvas 画面、键盘控制、分数显示、碰撞判定、失败后可重新开始。',
    '写完把绝对路径告诉我。不要只描述打算怎么做，要真的把文件写出来。',
  ].join('\n'));
  caiZhenLu = await dengWenJian('youxi.html');
  /**
   * **产物核对 + 一次纠正**（不是放水）：真机抓到过模型"说文件已写入"但工作区里没有（口头执行）。
   * 第一版当场判红就跑完，看不到它到底能不能把活干完；现在按人驱动它的方式补一轮
   * "你说写了 X，但工作区里没有，请真的调用 write_file 写出来"，仍然没有才算红。
   * "纠正过一次"会明确写进日志与读数 —— 不藏着，读日志的人知道这是修好的还是本来就好的。
   */
  let jiaoZhengCi = 0;
  if (!caiZhenLu) {
    jiaoZhengCi++;
    console.log('  · 第1轮没产出文件 ⇒ 补一轮真做（日志会记下"需要纠正"）');
    await faSong('你刚才说把文件写好了，但我在会话工作区里没有找到 youxi.html。请**真的调用 write_file**把它写出来（内容按上一条要求），写完只回一行绝对路径。');
    caiZhenLu = await dengWenJian('youxi.html', 60_000);
  }
  ok('第1轮：真的产出文件了（口头说写了不算；允许一次纠正并如实记录）', !!caiZhenLu, { reply: r1 && r1.reply, err: r1 && r1.err, jiaoZhengCi });
  if (jiaoZhengCi) console.log('  · 注：第1轮是"纠正后才产出"，不是第一次就做到 —— 这是产品行为问题，已记进交接文档');
  const wen1_0 = caiZhenLu ? fs.readFileSync(caiZhenLu, 'utf8') : '';
  /** 第 1 轮也配同一条反馈（第 53 轮，理由见下面第 4/5 轮那段）：解析不过就把真报错贴回去催一次，判据不动 */
  let wen1 = wen1_0;
  let yF1 = wen1 ? yuFaCheck(wen1) : { ok: false, why: '没有文件可检查' };
  if (wen1 && !yF1.ok) {
    jiaoZhengCi++;
    console.log(`  · 第1轮文件解析不过（${yF1.why}）⇒ 把真报错贴回去催一次`);
    await faSong(`youxi.html 现在**解析不过**：${yF1.why}\n请用 edit_file **只修语法**（不要改功能、不要整篇重写），改完自己确认整段 <script> 能解析。写完只回一行"已修"。`);
    caiZhenLu = await dengWenJian('youxi.html', 90_000) || caiZhenLu;
    wen1 = caiZhenLu ? fs.readFileSync(caiZhenLu, 'utf8') : '';
    yF1 = wen1 ? yuFaCheck(wen1) : { ok: false, why: '没有文件可检查' };
  }
  ok('第1轮：语法过（脚本能编译，否则后面全白测）', yF1.ok === true, { why: yF1.why, jiaoZhengCi });
  for (const [ming, han] of [['canvas 画面', 'canvas'], ['游戏循环', 'xunHuan'], ['键盘控制', 'jianPan'], ['分数显示', 'fenShu'], ['碰撞判定', 'pengZhuang'], ['失败可重开', 'chongKai']]) {
    ok(`第1轮：${ming}`, !!wen1 && PAN[han](wen1));
  }

  // ── 第 2–5 轮：迭代，每轮都验"真的改了"（mtime 必须前进，不许只在嘴上改）──
  const lei = [
    ['第2轮 · 最高分持久化', '给游戏加**最高分记录**：用 localStorage 存，关掉页面再打开还在；界面上要能看到当前分和最高分。改完还是同一个 youxi.html 文件。', 'cunDang'],
    ['第3轮 · 暂停/继续', '加**暂停与继续**：按空格暂停/继续；暂停时画面别继续动。同一个文件改。', 'zanTing'],
    ['第4轮 · 难度递增', '加**难度递增**：分数越高速度越快（或者分关卡），让玩家有 progression。同一个文件改。', 'suDu'],
    ['第5轮 · 双击就能玩 + 玩法说明', '最后：确保**双击文件就能直接玩**（不许联网、不许引外部脚本/样式），并在页面上写清楚**操作说明**（按键是什么、怎么算赢/输）。同一个文件改。', 'wuWangLuo'],
  ];
  for (const [ming, yao, pan] of lei) {
    const qian = caiZhenLu && fs.existsSync(caiZhenLu) ? fs.statSync(caiZhenLu).mtimeMs : 0;
    const r = await faSong(yao + '\n用 edit_file **只改需要改的那几处**（不要整篇重写：本机模型重写一次要十分钟量级）。写完告诉我改了哪几处。必须真的改文件。');
    caiZhenLu = await dengWenJian('youxi.html') || caiZhenLu;
    let hou = caiZhenLu && fs.existsSync(caiZhenLu) ? fs.statSync(caiZhenLu).mtimeMs : 0;
    let gaiDongJiaoZheng = 0;
    if (!(hou > qian)) {
      /** 与第 1 轮同一条规矩：**说了不算**，但也不冤枉"还没落盘"—— 等过、催过一次，仍不动才判红 */
      gaiDongJiaoZheng++;
      console.log(`  · ${ming}：模型回了但文件没动 ⇒ 补一轮"真的改文件"`);
      await faSong('你这一轮**没有真的改动** youxi.html（文件的修改时间没变）。请现在用 write_file 或 edit_file 把上一条要求真的写进同一个文件，写完只回一行"已写入"。');
      caiZhenLu = await dengWenJian('youxi.html', 60_000) || caiZhenLu;
      hou = caiZhenLu && fs.existsSync(caiZhenLu) ? fs.statSync(caiZhenLu).mtimeMs : 0;
    }
    ok(`${ming}：文件真的被动过（mtime 前进；允许一次纠正并如实记录）`, hou > qian && hou > 0, { qian, hou, jiaoZheng: gaiDongJiaoZheng, reply: r && r.reply });
    let t = caiZhenLu ? fs.readFileSync(caiZhenLu, 'utf8') : '';
    /**
     * **判据不成立也要催一次真的补上**（第 50 轮仪器）：
     * 以前只催"文件要动"，模型嘴上说加了暂停/最高分、文件也动了，但里面根本没有对应代码，
     * 判据照样红 —— 人驱动它的方式是"你还没加 X，现在加上"。这里补同一条反馈。
     */
    if (t && !PAN[pan](t)) {
      gaiDongJiaoZheng++;
      const queShi = pan === 'cunDang' ? '最高分要用 localStorage 保存（关掉再打开还在），界面上显示最高分'
        : pan === 'zanTing' ? '空格（或 P）暂停/继续，暂停时画面必须停住；代码里要有 pause/暂停 与对应按键处理'
          : pan === 'suDu' ? '分数越高速度越快（改 speed/interval/tick）或分关卡'
            : '把这一条功能真的写进代码';
      console.log(`  · ${ming}：判据不成立 ⇒ 催一轮补功能（${queShi}）`);
      await faSong(`你还没有真正做到：${queShi}。请用 edit_file 把这些**真的写进 youxi.html 的代码**（不要只改说明文字），写完只回一行"已补上"。`);
      caiZhenLu = await dengWenJian('youxi.html', 90_000) || caiZhenLu;
      t = caiZhenLu ? fs.readFileSync(caiZhenLu, 'utf8') : '';
    }
    ok(`${ming}：判据成立`, !!t && PAN[pan](t));
    /**
     * **改坏了也要把真报错贴回去催一次**（第 53 轮实测）：第 1 遍第 4/5 轮模型把文件改成解析不过
     * （`…59142662`/`…61774383` 产物副本 13:58:22 那份 8063 字，用门禁原样 `yuFaCheck` 复跑判红；
     * `script` 块开闭各 1 个 ⇒ 不是 `</script>` 字面量把块截断的检查器误判），
     * 而旧代码只把红记进台账、**一个字都不告诉模型** ⇒ 它在同一轮里没有机会修，整遍只能红。
     * 同一遍最后那份（14:21）语法是过的 ⇒ 说明"贴真报错回去"这条反馈确实能让它收敛（第 6 轮早就在用）。
     * 判据没动：一轮结束时文件必须解析得过；只是"纠正过一次"如实记进读数。
     */
    let yF = t ? yuFaCheck(t) : { ok: false, why: '没有文件可检查' };
    if (t && !yF.ok) {
      gaiDongJiaoZheng++;
      console.log(`  · ${ming}：改完解析不过（${yF.why}）⇒ 把真报错贴回去催一次`);
      await faSong(`你这次改动把 youxi.html 改成**解析不过**了：${yF.why}\n` +
        '请用 edit_file **只修语法**（不要顺手改功能、不要整篇重写），改完自己确认整段 <script> 能解析。写完只回一行"已修"。');
      caiZhenLu = await dengWenJian('youxi.html', 90_000) || caiZhenLu;
      t = caiZhenLu ? fs.readFileSync(caiZhenLu, 'utf8') : '';
      yF = t ? yuFaCheck(t) : { ok: false, why: '没有文件可检查' };
    }
    ok(`${ming}：改完语法仍然过`, yF.ok === true, { why: yF.why, jiaoZheng: gaiDongJiaoZheng });
  }

  // ── 第 6 轮：真在 Chromium 里跑起来（行为判据，不看字面）──
  const r6 = await faSong('检查一下 youxi.html 有没有明显问题，有就修掉；没问题就只回一句"可以玩"。');
  void r6;
  const zuiZhong = caiZhenLu ? fs.readFileSync(caiZhenLu, 'utf8') : '';
  ok('第6轮：交付页仍然自带全部逻辑（无外链脚本、无联网）', !!zuiZhong && PAN.wuWangLuo(zuiZhong));
  ok('第6轮：页面上写了玩法/按键说明', !!zuiZhong && PAN.shuoMing(zuiZhong));

  /**
   * **开一个真的 Chromium 跑它**：CDP 的 `Target.createTarget` 只能挂在 page 级连接上，
   * 拿浏览器级句柄要另开一条连接 —— 与其在仪器里绕，不如让 Electron 自己以"应用模式"加载这个文件：
   * 写一个 20 行的临时 main（独立 user-data-dir，不碰用户实例），
   * 用 `did-finish-load` / `console-message(level≥3)` / `render-process-gone` 抓真错误，
   * 再用两次像素指纹（中间什么都不做 + 按一次方向键）证明**循环在跑、输入有效**。
   * 起不来就如实 SKIP 并写原因 —— 不许把"没测到"记成"通过"。
   */
  let jia = caiZhenLu ? await zaiZhenLi(caiZhenLu) : { ok: 'skip', why: '第 6 轮没有产物文件可跑（前面就红了）' };
  if (jia.ok === 'skip') ok('第6轮·真跑：在 Chromium 里加载并操作', 'skip', jia.why);
  else {
    /**
     * **验收 → 把真错误原样贴回去 → 让它修 → 再验收**（最多两轮）。
     * 第 6 轮以前是"让它自己检查"，可它看不到浏览器里的报错（真机抓到过一次
     * `ReferenceError: Cannot access 'xxx' before initialization` —— 脚本一崩，画布永远是静态的，
     * 光读源码看不出来）。这一档测的是**整套系统能不能收敛到"真的能玩"**，
     * 所以把 Chromium 的判据当成验收反馈喂回去，才是人驱动它的真实方式；
     * 修不好仍然判红（并且带着原文报错），不粉饰。
     */
    const panJu = (dui) => ([
      ['页面加载完成（无 did-fail-load、渲染进程没崩）', dui.jiaZaiWan === true],
      ['canvas 真的存在且有尺寸', dui.hasCanvas === true],
      ['什么都不按画面也在动，或按开始键后自动移动（游戏循环真跑，不是静态图）', dui.ziDong === true],
      ['按下方向键后状态变了（键盘输入真的接上了）', dui.jianPan === true],
      ['全程没有未捕获异常/控制台错误', (dui.cuo || []).length === 0],
    ]).filter((x) => x[1] !== true).map((x) => x[0]);
    let xiuCi = 0;
    let hongDe = panJu(jia);
    while (hongDe.length && xiuCi < 2) {
      xiuCi++;
      console.log(`  · 真跑判据未过（第 ${xiuCi} 次修）：${hongDe.join('；')}；报错=${JSON.stringify((jia.cuo || []).slice(0, 2)).slice(0, 220)}`);
      await faSong([
        '浏览器实测你这个文件，**没过**：',
        '不通过项：' + hongDe.join('；'),
        ((jia.cuo || []).length ? '控制台/未捕获报错原文：\n' + (jia.cuo || []).slice(0, 4).map((x) => '  - ' + x).join('\n') : ''),
        ((jia.p1 || '') === (jia.p2 || '') ? '而且什么都不按时两次画布像素指纹一模一样（' + String(jia.p1).slice(0, 24) + '）⇒ 动画循环根本没跑起来。' : ''),
        '请用 edit_file / write_file **真的改这个文件**修掉它们（别改功能，只修到能跑：循环要自己持续推进（rAF 或自续的 setInterval/setTimeout 都行）、方向键要真的改变状态、脚本不能有引用未定义变量的错误）。改完只回一行"已修"。',
      ].filter(Boolean).join('\n'));
      jia = await zaiZhenLi(caiZhenLu);
      hongDe = panJu(jia);
    }
    ok('第6轮·真跑：页面加载完成（无 did-fail-load、渲染进程没崩）', jia.jiaZaiWan === true, { xiuCi, jia });
    ok('第6轮·真跑：canvas 真的存在且有尺寸', jia.hasCanvas === true, { xiuCi });
    ok('第6轮·真跑：游戏循环真跑（空闲就动，或按开始键后自动移动）', jia.ziDong === true, { xiuCi, qian: String(jia.p1 || '').slice(0, 24), hou: String(jia.p2 || '').slice(0, 24), pS1: String(jia.pS1 || '').slice(0, 24), pS2: String(jia.pS2 || '').slice(0, 24) });
    ok('第6轮·真跑：按下方向键后状态变了（键盘输入真的接上了）', jia.jianPan === true, { xiuCi, qian: String(jia.p2 || '').slice(0, 24), hou: String(jia.p3 || '').slice(0, 24) });
    ok('第6轮·真跑：全程没有未捕获异常/控制台错误', (jia.cuo || []).length === 0, { xiuCi, cuo: (jia.cuo || []).slice(0, 3) });
    if (xiuCi) console.log(`  · 第6轮经过 ${xiuCi} 次"贴真报错回去修"才验收（读数里带 xiuCi，不藏着）`);
  }
} catch (e) {
  ok('整个压力档 A 跑完没抛', false, String((e && e.message) || e).slice(0, 200));
} finally {
  shouWei();
}

console.log(`\n==== verify-r46-youxi（压力档 A · 6 轮网页小游戏）：过 ${pass} · 败 ${fail} · 跳 ${skip} ====`);
if (fail > 0) auditWei();
if (!KEEP && caiZhenLu) { /* profile 已在 exit 时删除 */ }
console.log(`产物（临时 profile，跑完自动删；KEEP=1 保留）：${PROFILE}`);
process.exit(fail ? 1 : 0);
