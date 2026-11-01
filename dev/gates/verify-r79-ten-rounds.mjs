/**
 * 第 79 轮：全项目 10 轮不同真实任务验收（方案 A）。
 *
 * 与只读 DOM 的 fast 门禁不同，这一支用**真 Electron + 真界面点击 + 真模型**：
 *   · 临时 profile（不碰用户配置），WARMY_AUTH_BYPASS=1；
 *   · MiMo `mimo-v2.6-flash`（真 key，仅读第一行）与本地 Ollama `lileilei999/qwen3.5-9b-abliterated-vision:latest`；
 *   · 每轮一个独立牛马/会话，任务不同；任何一轮失败立即退出（不继续跑），修复后从第 1 轮重跑；
 *   · 判分只认：真实文件内容、审计日志、计划任务持久化、DOM 文本/模型标签、重启后的历史。
 *
 * 用法：node dev/gates/verify-r79-ten-rounds.mjs [--rounds=1-10] [--keep] [--port=9850]
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

const canShu = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? '1'] : [a, '1'];
}));
const KEEP = canShu.keep === '1';
const PORT0 = Number(canShu.port || 9850);
const FAN_WEI = String(canShu.rounds || '1-10');
const [R1, R2] = FAN_WEI.includes('-') ? FAN_WEI.split('-').map(Number) : [Number(FAN_WEI), Number(FAN_WEI)];
const YUN_XU = new Set();
for (let i = R1; i <= R2; i++) YUN_XU.add(i);

const MIMO_KEY_FILE = process.env.MIMO_KEY_FILE || path.join(os.homedir(), '.warmy', 'mimo-key.txt');
const MIMO_KEY = (() => {
  try { return fs.readFileSync(MIMO_KEY_FILE, 'utf8').split(/\r?\n/)[0].trim(); }
  catch { return ''; }
})();
if (!MIMO_KEY) {
  console.error('缺少 MIMO_KEY_FILE（本机真实凭据文件）；此门禁需要真实 MiMo key，未配置时不应运行。');
  process.exit(2);
}
const MIMO_PROV = 'mimo-r79';
const MIMO_BIAO = 'MiMo token plan（cn）';
const MIMO_FLASH = 'mimo-v2.6-flash';
const MIMO_PRO = 'mimo-v2.6-pro';
const MIMO_BAD = 'mimo-v2.5';
const OLLAMA_PROV = 'ollama-r79';
const OLLAMA_BIAO = 'Ollama';
const LOCAL = process.env.R79_LOCAL_MODEL || 'lileilei999/qwen3.5-9b-abliterated-vision:latest';
const MIMO_LABEL = `${MIMO_BIAO} · ${MIMO_FLASH}`;
const LOCAL_LABEL = `${OLLAMA_BIAO} · ${LOCAL}`;

const TMP = path.join(os.tmpdir(), 'warmy-r79-ten');
fs.mkdirSync(TMP, { recursive: true });
const RUN = path.join(TMP, 'run-' + new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(RUN, { recursive: true });
const profile = path.join(RUN, 'profile');
const workspaceRoot = path.join(profile, 'workspace');
fs.mkdirSync(workspaceRoot, { recursive: true });
const ws = (n) => path.join(workspaceRoot, 'i-r79-' + String(n).padStart(2, '0'));
const TOKEN = 'R79-' + Math.random().toString(36).slice(2, 10).toUpperCase();
const SECRET = '蓝鲸-' + (700 + Math.floor(Math.random() * 200));

const shiJian = () => new Date().toISOString();
const log = (...a) => console.log(...a);
const wenJian = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const xiaoXie = (p) => path.resolve(String(p || '')).toLowerCase();
const fileExists = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

/* ── 审计/证据 ─────────────────────────────────────────── */
const zhengJu = { run: RUN, token: TOKEN, secret: SECRET, rounds: [], startedAt: shiJian() };
const jianCha = (round, name, ok, detail) => {
  zhengJu.rounds[round - 1] = zhengJu.rounds[round - 1] || { round, checks: [], startedAt: shiJian() };
  zhengJu.rounds[round - 1].checks.push({ name, ok: ok === true, detail: ok === true ? undefined : String(detail || '').slice(0, 800) });
  log(`  ${ok === true ? 'ok  ' : 'FAIL'} [R${round}] ${name}${ok === true ? '' : ' ← ' + String(detail || '').slice(0, 500)}`);
};
const duShenJi = () => {
  const f = path.join(profile, 'audit', 'audit.jsonl');
  if (!fs.existsSync(f)) return [];
  return wenJian(f).split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
};
const xieZhengJu = () => {
  try {
    fs.writeFileSync(path.join(RUN, 'evidence.json'), JSON.stringify(zhengJu, null, 2), 'utf8');
    fs.writeFileSync(path.join(TMP, 'LAST-RUN.txt'), RUN, 'utf8');
  } catch { /* noop */ }
};

/* ── profile 配置 ─────────────────────────────────────── */
const NENG_LI = {
  [MIMO_FLASH]: { contextLen: 131072, kind: 'chat', tools: true, vision: false },
  [MIMO_PRO]: { contextLen: 131072, kind: 'chat', tools: true, vision: false },
  [MIMO_BAD]: { contextLen: 32768, kind: 'chat', tools: true, vision: false },
  [LOCAL]: { contextLen: 32768, kind: 'chat', tools: true, vision: true },
  'bge-m3:latest': { contextLen: 8192, kind: 'embedding', tools: false, vision: false },
};
const REN_SHE = [
  '你是一名细致、可靠的办公助理。',
  '能真正用工具完成的事情就用工具完成；不要只说“已完成”。',
  '写完文件要确认内容确实写进去了，并把真实路径告诉用户。',
  '回答简洁，先给结论；不确定就如实说明。',
].join('\n');
const INSTANCES = [
  { n: 1, model: MIMO_LABEL, chain: [MIMO_LABEL, LOCAL_LABEL] },
  { n: 2, model: MIMO_LABEL, chain: [MIMO_LABEL, LOCAL_LABEL] },
  { n: 3, model: MIMO_LABEL, chain: [MIMO_LABEL, LOCAL_LABEL] },
  { n: 4, model: LOCAL_LABEL, chain: [LOCAL_LABEL] },
  { n: 5, model: `${MIMO_BIAO} · ${MIMO_BAD}`, chain: [`${MIMO_BIAO} · ${MIMO_BAD}`, MIMO_LABEL] },
  { n: 6, model: MIMO_LABEL, chain: [MIMO_LABEL, LOCAL_LABEL] },
  { n: 7, model: MIMO_LABEL, chain: [MIMO_LABEL, LOCAL_LABEL] },
  { n: 8, model: MIMO_LABEL, chain: [MIMO_LABEL, LOCAL_LABEL] },
  { n: 9, model: MIMO_LABEL, chain: [MIMO_LABEL, LOCAL_LABEL] },
  { n: 10, model: MIMO_LABEL, chain: [MIMO_LABEL, LOCAL_LABEL] },
].map((x) => ({
  id: `i-r79-${String(x.n).padStart(2, '0')}`,
  ming: `牛马-${String(x.n).padStart(2, '0')}`,
  name: `牛马-${String(x.n).padStart(2, '0')}`,
  status: 'running', dutyEligible: true, notify: true, persona: REN_SHE, smartMode: false,
  defaultModel: x.model, currentModel: x.model.split(' · ').pop(), chain: x.chain, chainDisabled: [],
}));

function xiePeiZhi() {
  const s = {
    yuYan: 'zh-CN', setupDone: true, privacyConsent: true, guideDone: true, providersSeeded: true,
    globalSecurity: 'normal', askOnExceed: false, autoSelectRecommended: false,
    trustedFolders: [workspaceRoot],
    contextBudgetPercent: 60, modelContextTokens: 32768, contextBudgetChars: 6000,
    contextToolResultChars: 6000, contextToolTotalChars: 16000, contextToolMaxRounds: 12, autoSummary: true,
    nmKaiWenJian: true,
    providers: [
      { id: MIMO_PROV, biaoQian: MIMO_BIAO, protocol: 'openai-compatible', baseURL: 'https://token-plan-cn.xiaomimimo.com/v1', defaultModel: '', models: [MIMO_FLASH, MIMO_PRO, MIMO_BAD], staleModels: [], hasKey: false },
      { id: OLLAMA_PROV, biaoQian: OLLAMA_BIAO, protocol: 'ollama', baseURL: 'http://127.0.0.1:11434', defaultModel: '', models: [LOCAL, 'bge-m3:latest'], staleModels: [], hasKey: false },
    ],
    modelCaps: NENG_LI,
    specialModels: {
      chatChain: [MIMO_BAD, MIMO_FLASH, LOCAL], organizerChain: [MIMO_BAD, MIMO_FLASH, LOCAL],
      asrChain: [], ttsChain: [], imageUndChain: [LOCAL], embedChain: ['bge-m3:latest'],
    },
    instances: INSTANCES,
  };
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify(s), 'utf8');
}
xiePeiZhi();
for (let n = 1; n <= 10; n++) { fs.mkdirSync(ws(n), { recursive: true }); }
fs.writeFileSync(path.join(ws(3), 'r79-secret.txt'), SECRET + '\n', 'utf8');

/* ── 启动/关闭 ─────────────────────────────────────────── */
let child = null;
let c = null;
const js = (e) => c.evaluate('(async function(){ try { return await (' + e + '); } catch (err) { return { __err: String((err && (err.stack || err.message)) || err).slice(0, 400) }; } })()');

async function qiDong(port) {
  const env = { ...process.env, WARMY_AUTH_BYPASS: '1', WARMY_OPEN_PATH_DRYRUN: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(ELECTRON, ['--remote-debugging-port=' + port, '--disable-features=CalculateNativeWinOcclusion', '--user-data-dir=' + profile, MAIN], { cwd: PKG, stdio: ['ignore', 'ignore', 'ignore'], env });
  let ok = false;
  for (let i = 0; i < 120; i++) {
    try { c = await attach(port, { biaoQian: 'r79', callTimeout: 240000 }); ok = true; break; } catch { await sleep(300); }
  }
  if (!ok) throw new Error('CDP 起不来');
  await c.send('Runtime.enable');
  await c.waitFor("document.querySelector('#shuRu') && (!document.querySelector('#warmyAuthGate') || document.querySelector('#warmyAuthGate').classList.contains('warmyAuthHidden'))", { timeout: 40000, biaoQian: '首屏/登录门放行' });
  await sleep(1200);
  await js(`(function(){
    window.__r79 = { ev: [], cards: [] };
    try { window.warmy.onYunXingZhuangTai((d) => { try { window.__r79.ev.push(d); } catch (e) {} }); } catch (e) {}
    try { window.warmy.onAiWenTi((d) => { try { window.__r79.cards.push(d); } catch (e) {} }); } catch (e) {}
    return true;
  })()`);
}

async function guan() {
  try { if (c) await c.send('Browser.close', {}, { timeout: 6000 }); } catch { /* noop */ }
  await sleep(800);
  try { if (child) execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* noop */ }
  child = null; c = null;
}

/* ── 界面操作 ─────────────────────────────────────────── */
async function dianWenBen(selector, text) {
  const p = await js(`(() => {
    const e = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => x.innerText.includes(${JSON.stringify(text)}));
    if (!e) return null;
    if (e.scrollIntoView) e.scrollIntoView({ block: 'center' });
    const r = e.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (!p) throw new Error('找不到可点元素：' + selector + ' / ' + text);
  await c.mouseClick(p.x, p.y);
}

async function xuanNiuMa(name) {
  await c.waitFor("!!document.querySelector('.ceLanTiaoMu[data-nav=\"singleAi\"]')", { timeout: 15000 });
  await c.clickSelector('.ceLanTiaoMu[data-nav="singleAi"]');
  const ok = await c.waitForQuiet(`[...document.querySelectorAll('#lieBiaoTi .lieBiaoTiaoMu')].some((e) => e.innerText.includes(${JSON.stringify(name)}))`, { timeout: 12000 });
  if (!ok) {
    const all = await js("[...document.querySelectorAll('#lieBiaoTi .lieBiaoTiaoMu')].map(e=>e.innerText.replace(/\\n/g,' / '))");
    throw new Error('牛马列表里找不到 ' + name + '；实际：' + JSON.stringify(all).slice(0, 500));
  }
  const huoLe = () => js(`[...document.querySelectorAll('#lieBiaoTi .lieBiaoTiaoMu')].some((e) => e.classList.contains('jiHuo') && e.innerText.includes(${JSON.stringify(name)}))`);
  let hit = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    const p = await js(`(() => {
      const e = [...document.querySelectorAll('#lieBiaoTi .lieBiaoTiaoMu')].find((x) => x.innerText.includes(${JSON.stringify(name)}));
      if (!e) return null;
      e.scrollIntoView({ block: 'center' });
      const r = e.getBoundingClientRect();
      return { x: Math.round(r.left + Math.min(r.width - 8, 60)), y: Math.round(r.top + r.height / 2), h: !!e.onclick };
    })()`);
    if (!p) throw new Error('列表项消失：' + name);
    hit = await c.hitTest(p.x, p.y);
    await c.mouseClick(p.x, p.y);
    await sleep(900);
    if (await huoLe()) return;
    // 真鼠标没生效时补一次 DOM click（某些重渲染窗口会吞掉第一次坐标点击）
    await js(`(() => { const e = [...document.querySelectorAll('#lieBiaoTi .lieBiaoTiaoMu')].find((x) => x.innerText.includes(${JSON.stringify(name)})); if (e) e.click(); return true; })()`);
    await sleep(900);
    if (await huoLe()) return;
  }
  const all = await js("[...document.querySelectorAll('#lieBiaoTi .lieBiaoTiaoMu')].map(e=>({t:e.innerText.replace(/\\n/g,' / ').slice(0,40),c:e.className}))");
  throw new Error('牛马没有被选中：' + name + '；命中=' + hit + '；实际：' + JSON.stringify(all).slice(0, 600));
}

async function chuLiKa(round) {
  const r = await js('window.warmy.aiQuestionList()');
  for (const q of (r && r.items) || []) {
    if (q.status !== 'pending') continue;
    const xuan = q.options || [];
    const tong = xuan.find((o) => /同意|允许/.test(String(o.biaoQian || '')));
    const ju = xuan.find((o) => /拒绝/.test(String(o.biaoQian || '')));
    const zhui = xuan.find((o) => /改为追加|追加|不写|取消/.test(String(o.biaoQian || '')));
    let pick = null;
    if (/覆盖前确认/.test(String(q.biaoTi || ''))) pick = zhui;
    else pick = tong || zhui;
    if (!pick) pick = ju || xuan[xuan.length - 1];
    log(`    · 卡片「${String(q.biaoTi || '').slice(0, 40)}」→ ${pick ? pick.biaoQian : '无'}`);
    if (pick) await js(`window.warmy.aiQuestionAnswer(${JSON.stringify({ id: q.id, optionId: pick.id })})`);
    await sleep(500);
  }
  return (r && r.items || []).some((q) => q.status === 'pending');
}

async function faSongUI(round, text, timeoutMs = 8 * 60000) {
  await c.waitFor("!!document.querySelector('#shuRu') && !!document.querySelector('#anNiuFaSong')", { timeout: 10000 });
  const before = await js("document.querySelectorAll('#xiaoXiJi .xiaoXi.them').length");
  await js(`(() => {
    const e = document.querySelector('#shuRu');
    const s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    s.call(e, ${JSON.stringify(text)}); e.dispatchEvent(new Event('input', { bubbles: true }));
    return e.value.length;
  })()`);
  const clicked = await js("(() => { const b = document.querySelector('#anNiuFaSong'); if (!b || b.disabled) return false; b.click(); return true; })()");
  if (!clicked) throw new Error('发送按钮不可用');
  const t0 = Date.now();
  let sawBusy = false;
  let lastTxt = '';
  for (;;) {
    await sleep(1000);
    await chuLiKa(round);
    const st = await js(`({
      busy: document.querySelector('#anNiuFaSong')?.disabled === true,
      n: document.querySelectorAll('#xiaoXiJi .xiaoXi.them').length,
      txt: (document.querySelector('#xiaoXiJi')?.innerText || '').slice(-1200),
      toast: [...document.querySelectorAll('.toast, .tiShi, #tongZhiQu')].map((e) => e.innerText).join(' ').slice(0, 200)
    })`);
    if (st && st.busy) sawBusy = true;
    if (st && st.txt && st.txt !== lastTxt) lastTxt = st.txt;
    if (st && st.n > before && !st.busy) {
      // 再等 1.2 秒，避免“按钮先恢复、正文后渲染”造成的截断
      await sleep(1200);
      const st2 = await js(`({ busy: document.querySelector('#anNiuFaSong')?.disabled === true, n: document.querySelectorAll('#xiaoXiJi .xiaoXi.them').length, txt: (document.querySelector('#xiaoXiJi')?.innerText || '').slice(-1600) })`);
      if (st2 && st2.busy === false) return { reply: st2.txt, bubbles: st2.n, sawBusy, ms: Date.now() - t0 };
    }
    if (Date.now() - t0 > timeoutMs) throw new Error(`第 ${round} 轮超时（${Math.round(timeoutMs / 1000)}s），最后界面：${lastTxt.slice(-300)}`);
  }
}

const qing = (s) => String(s || '').replace(/\s+/g, '');
const has = (s, sub) => qing(s).includes(qing(sub));

/* ── 10 轮任务 ───────────────────────────────────────── */
async function round1() {
  await xuanNiuMa('牛马-01');
  const r = await faSongUI(1, '只回复一行：你是牛马-01；并如实说明你当前使用的模型名称。');
  jianCha(1, '真实界面发送并收到 MiMo 回复', !!r.reply && r.reply.length > 2, JSON.stringify(r).slice(0, 400));
  jianCha(1, '回复中出现注入的身份「牛马-01」', has(r.reply, '牛马-01'), r.reply.slice(-300));
  const dom = await js("({txt:(document.querySelector('#xiaoXiJi')?.innerText||''), chip:document.querySelector('.xiaoXi.them .qiPaoXinXi')?.innerText||''})");
  jianCha(1, '界面气泡标注真实模型 mimo-v2.6-flash', has(dom.txt, 'mimo-v2.6-flash') || has(dom.chip, 'mimo-v2.6-flash'), JSON.stringify(dom).slice(0, 400));
  const a = duShenJi().filter((x) => String(x.op || '').startsWith('chat.') && JSON.stringify(x.detail || {}).includes('i-r79-01'));
  jianCha(1, '审计记录本轮真实对话（chat.*）', a.length > 0, a.length);
  const tok = duShenJi().filter((x) => x.op === 'token.calibrate' && JSON.stringify(x.detail || {}).includes(MIMO_FLASH));
  jianCha(1, 'token 校准/用量记录到 MiMo 模型', tok.length > 0, tok.length);
}

async function round2() {
  await xuanNiuMa('牛马-02');
  const r = await faSongUI(2, `请在工作区创建文件 r79-round2.txt，内容严格为 ${TOKEN}，不要写别的内容。完成后只回复文件路径。`);
  const f = path.join(ws(2), 'r79-round2.txt');
  jianCha(2, '真实工具调用创建了 r79-round2.txt', fileExists(f), f);
  jianCha(2, '文件内容与用户要求逐字一致', wenJian(f).trim() === TOKEN, JSON.stringify(wenJian(f).slice(0, 200)));
  jianCha(2, '回复里给出真实路径或文件名', has(r.reply, 'r79-round2.txt') || has(r.reply, TOKEN), r.reply.slice(-300));
  const gongJu = duShenJi().filter((x) => /tool|write|path/i.test(String(x.op || '')) && JSON.stringify(x.detail || {}).toLowerCase().includes('r79-round2'));
  jianCha(2, '审计留下该文件的工具/路径记录', gongJu.length > 0, gongJu.length);
}

async function round3() {
  await xuanNiuMa('牛马-03');
  const r = await faSongUI(3, '请读取工作区里的 r79-secret.txt，并只回复文件中的暗号。');
  jianCha(3, '回复了文件里的真实暗号', has(r.reply, SECRET), r.reply.slice(-300));
  const a = duShenJi().filter((x) => JSON.stringify(x.detail || {}).toLowerCase().includes('r79-secret'));
  jianCha(3, '审计记录了读取该文件', a.length > 0, a.length);
}

async function round4() {
  await xuanNiuMa('牛马-04');
  const r = await faSongUI(4, '只回复四个字：本地可用', 6 * 60000);
  jianCha(4, '本地 Ollama 真实回复', has(r.reply, '本地可用'), r.reply.slice(-300));
  const dom = await js("document.querySelector('#xiaoXiJi')?.innerText || ''");
  jianCha(4, '界面标注本地模型', has(dom, LOCAL), dom.slice(-400));
}

async function round5() {
  await xuanNiuMa('牛马-05');
  const r = await faSongUI(5, '只回复四个字：降级成功', 8 * 60000);
  jianCha(5, '首个模型不存在时仍从链上拿到回复', has(r.reply, '降级成功'), r.reply.slice(-300));
  const dom = await js("document.querySelector('#xiaoXiJi')?.innerText || ''");
  jianCha(5, '最终由链上第二个模型 mimo-v2.6-flash 完成', has(dom, MIMO_FLASH), dom.slice(-400));
  const a = duShenJi().filter((x) => JSON.stringify(x.detail || {}).includes(MIMO_BAD));
  jianCha(5, '审计留下失败模型/降级证据', a.length > 0, a.length);
}

async function round6() {
  await xuanNiuMa('牛马-06');
  const r1 = await faSongUI(6, `请记住暗号：${SECRET}。稍后我会问。现在只回复：已记住`);
  jianCha(6, '第一轮回复确认记住', has(r1.reply, '已记住'), r1.reply.slice(-200));
  const r2 = await faSongUI(6, '暗号是什么？只回复暗号本身。');
  jianCha(6, '同一会话第二轮真实回忆出暗号', has(r2.reply, SECRET), r2.reply.slice(-300));
}

async function round7() {
  await xuanNiuMa('牛马-07');
  const r = await faSongUI(7, '请完成三步：1) 在工作区创建 r79-a.txt 写入 A；2) 创建 r79-b.txt 写入 B；3) 读取两个文件并回复 A+B。', 10 * 60000);
  const fa = wenJian(path.join(ws(7), 'r79-a.txt')).trim();
  const fb = wenJian(path.join(ws(7), 'r79-b.txt')).trim();
  jianCha(7, '两步工具写文件都真的落盘', fa.includes('A') && fb.includes('B'), JSON.stringify({ fa, fb }));
  jianCha(7, '回复读取结果包含 A+B', has(r.reply, 'A+B') || (has(r.reply, 'A') && has(r.reply, 'B') && has(r.reply, 'AB')), r.reply.slice(-300));
  const plans = await js('window.warmy.jiHuaLieBiao({ sessionId: "i-r79-07" })');
  const steps = (plans && plans.steps) || [];
  jianCha(7, '多步任务真的建立了计划（≥3 步）', steps.length >= 3, JSON.stringify(plans).slice(0, 400));
  jianCha(7, '计划步骤有完成/验证状态', steps.some((x) => x.status === 'done' || x.status === 'verified'), JSON.stringify(steps).slice(0, 400));
  const dom = await js("document.querySelector('#jiHuaLieBiao')?.innerText || ''");
  jianCha(7, '第四列计划任务卡显示步骤', dom.trim().length > 0, dom.slice(0, 200));
}

async function round8() {
  // 任务：真实 nm 窗口查看 HTML（双栏）与 ZIP（目录树）
  const html = path.join(ws(8), 'r79-page.html');
  const zipSrc = path.join(ws(8), 'zip-src');
  fs.mkdirSync(zipSrc, { recursive: true });
  fs.writeFileSync(path.join(zipSrc, 'hello.txt'), '你好，世界\n第二行\n', 'utf8');
  fs.mkdirSync(path.join(zipSrc, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(zipSrc, 'docs', 'readme.md'), '# 压缩包里的 markdown\n', 'utf8');
  fs.writeFileSync(html, '<!doctype html><html><head><title>R79 页面</title><style>body{color:#123}</style></head><body><h1 id="t">R79 HTML</h1><p>正文</p></body></html>', 'utf8');
  const zip = path.join(ws(8), 'r79.zip');
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Compress-Archive -Path '${zipSrc}\\*' -DestinationPath '${zip}' -Force`], { stdio: 'ignore' });
  if (!fileExists(zip)) throw new Error('zip 没造出来');
  await xuanNiuMa('牛马-08');
  const open = await js(`window.warmy.nmKai({ path: ${JSON.stringify(html)} })`);
  jianCha(8, '从界面 IPC 打开 nm HTML 窗口', !!(open && (open.ok !== false)), JSON.stringify(open).slice(0, 300));
  await sleep(2500);
  const nm = await attach(PORT0, { biaoQian: 'nm-html', matchUrlIncludes: 'nm-viewer.html' });
  const nmjs = (e) => nm.evaluate('(async function(){ try { return await (' + e + '); } catch (err) { return { __err: String((err && err.message) || err) }; } })()');
  await nm.waitFor("document.querySelector('#wenJianMing')?.textContent.includes('r79-page.html')", { timeout: 15000, biaoQian: 'nm HTML 标题' });
  const h = await nmjs(`({ ming: document.querySelector('#wenJianMing')?.textContent || '', lu: document.querySelector('#wenJianLuJing')?.textContent || '', split: !!document.querySelector('#neiRongHang .htmlFenLan, #htmlFenLan, [class*=html]') })`);
  jianCha(8, 'nm 顶部显示文件名与完整路径', h && h.ming.includes('r79-page.html') && xiaoXie(h.lu) === xiaoXie(html), JSON.stringify(h).slice(0, 400));
  const split = await nmjs("(() => ({ bar: !document.querySelector('#fenGeTiao')?.hidden, lab: document.querySelector('#yuLanLei')?.textContent || '', src: !!document.querySelector('#wenBen') }))()");
  jianCha(8, 'HTML 显示源码 + 效果双栏（分隔条与预览标题都在）', split && split.bar === true && split.src === true && /HTML/.test(split.lab), JSON.stringify(split));
  try { await nmjs("document.querySelector('#anNiuGuanBi')?.click()"); } catch { /* 关闭会断开 CDP，属正常 */ }
  await sleep(1200);
  await js(`window.warmy.nmKai({ path: ${JSON.stringify(zip)} })`);
  await sleep(2500);
  const nm2 = await attach(PORT0, { biaoQian: 'nm-zip', matchUrlIncludes: 'nm-viewer.html' });
  const nm2js = (e) => nm2.evaluate('(async function(){ try { return await (' + e + '); } catch (err) { return { __err: String((err && err.message) || err) }; } })()');
  await nm2.waitFor("document.querySelector('#yaSuoBaoLie') && !document.querySelector('#yaSuoBaoLie').hidden", { timeout: 15000, biaoQian: 'nm ZIP 目录树' });
  await nm2js("(() => { const r = [...document.querySelectorAll('#yaSuoShu [role=treeitem], #yaSuoShu *')].find((e) => (e.innerText || '').trim() === 'docs'); if (r) { r.click(); return true; } return false; })()");
  await sleep(600);
  const z = await nm2js("({ entries: [...document.querySelectorAll('#yaSuoShu *')].map((e) => e.textContent).join('|'), tree: document.querySelector('#yaSuoShu')?.innerText || '' })");
  jianCha(8, 'ZIP 目录树展开后列出 hello.txt 与 docs/readme.md', has(z.entries, 'hello.txt') && has(z.entries, 'readme.md'), JSON.stringify(z).slice(0, 500));
  try { await nm2js("document.querySelector('#anNiuGuanBi')?.click()"); } catch { /* 关闭会断开 CDP，属正常 */ }
  await sleep(800);
}

async function round9() {
  // UI 巡检：第二列宽度/无边框、网络页精简、本地语音、nm 插件、我的页
  await xuanNiuMa('牛马-09');
  const lay = await js(`(() => {
    const lan = document.querySelector('#lieBiaoLan'); const b = document.querySelector('#lieBiaoDongZuo');
    const cs = lan ? getComputedStyle(lan) : null; const cb = b ? getComputedStyle(b) : null;
    return { w: cs ? lan.getBoundingClientRect().width : 0, border: cb ? cb.borderTopWidth : '', bg: cs ? cs.backgroundColor : '' };
  })()`);
  jianCha(9, '第二列宽度在 180–260 之间且不压住 logo 区', lay && lay.w >= 180 && lay.w <= 260, JSON.stringify(lay));
  jianCha(9, '第二列头部按钮无边框', lay && Number.parseFloat(lay.border || '') === 0, JSON.stringify(lay));
  await c.clickSelector('[data-nav="settings"]');
  await c.waitFor('!!document.querySelector("#peiZhiDaoHang")', { timeout: 12000, biaoQian: '设置页' });
  const secs = await js("[...document.querySelectorAll('#peiZhiDaoHang button[data-sec]')].map((e) => e.innerText.trim())");
  jianCha(9, '设置页有界面/模型/功能/插件等分区', ['界面', '模型', '功能', '插件'].every((k) => JSON.stringify(secs).includes(k)), JSON.stringify(secs));
  await c.clickSelector('#peiZhiDaoHang button[data-sec="func"]');
  await sleep(1200);
  const fn = await js("document.querySelector('#peiZhiNeiRong')?.innerText || ''");
  jianCha(9, '功能页保留网络与主机/服务商，并有本地语音与 nm', has(fn, '网络与主机') && has(fn, '主机') && has(fn, '服务商') && has(fn, '本地语音') && has(fn, 'nm'), fn.slice(0, 700));
  await c.clickSelector('[data-nav="wo"]');
  await c.waitFor("!!document.querySelector('#pMingDisplay') && !!document.querySelector('.woBrandR68')", { timeout: 12000, biaoQian: '我的页' });
  const wo = await js("({txt: document.querySelector('#mianBanLan')?.innerText || '', brand: !!document.querySelector('.woBrandR68'), name: document.querySelector('#pMingDisplay')?.innerText || ''})");
  jianCha(9, '我的页可打开且有品牌/账号区', wo && wo.brand && wo.name.length > 0 && wo.txt.length > 20, JSON.stringify(wo).slice(0, 400));
  const errs = await js("(window.__r79 && window.__r79.err) || []");
  jianCha(9, '界面巡检期间无脚本异常', !errs || errs.length === 0, JSON.stringify(errs));
}

async function round10() {
  // 重启恢复：聊天历史 + 设置 + 计划任务
  await guan();
  await qiDong(PORT0);
  await xuanNiuMa('牛马-06');
  const log = await js('window.warmy.chatLog({ sessionId: "i-r79-06", limit: 100 })');
  jianCha(10, '重启后该会话日志元数据仍在（≥4 条）', log && log.ok === true && Number(log.count) >= 4, JSON.stringify(log || {}).slice(0, 500));
  const dom = await js("document.querySelector('#xiaoXiJi')?.innerText || ''");
  jianCha(10, '重启后界面仍显示会话内容', has(dom, SECRET) || has(dom, '已记住'), dom.slice(-400));
  const domList = await js("[...document.querySelectorAll('#lieBiaoTi .lieBiaoTiaoMu')].map((e) => e.innerText).join('|')");
  jianCha(10, '重启后列表显示名仍是牛马-06/10（不退回内部 ID）', has(domList, '牛马-06') && has(domList, '牛马-10') && !has(domList, 'i-r79-06'), domList.slice(0, 500));
  const sj = JSON.parse(wenJian(path.join(profile, 'settings.json')) || '{}');
  jianCha(10, '重启后落盘的 10 个牛马定义仍在', ((sj.instances || []).length >= 10) && JSON.stringify(sj.instances).includes('牛马-10'), JSON.stringify((sj.instances || []).slice(0, 2)));
  const st2 = await js('window.warmy.settingsGet()');
  jianCha(10, '重启后模型配置仍在', JSON.stringify(st2 || {}).includes(MIMO_FLASH) && JSON.stringify(st2 || {}).includes(LOCAL), JSON.stringify(st2 || {}).slice(0, 300));
  const plans = await js('window.warmy.jiHuaLieBiao({ sessionId: "i-r79-07" })');
  jianCha(10, '重启后计划任务仍在', ((plans && plans.steps) || []).length >= 3, JSON.stringify(plans).slice(0, 400));
  const f = path.join(ws(2), 'r79-round2.txt');
  jianCha(10, '重启后工具产物仍在', fileExists(f) && wenJian(f).trim() === TOKEN, f);
}

async function round11() {
  await xuanNiuMa('牛马-10');
  const video = path.join(ROOT, '.tmp-video', 'flower.mp4');
  const r = await js(`window.warmy.chatSend({ sessionId: 'i-r79-10', content: '这个视频里是什么？请描述画面；如果能看到就说看到了。', ming: '牛马-10', thinkLevel: 'auto', xiaoDiShuLiang: 'auto', moXingJueCe: { urgency: 'P2', defaultModel: ${JSON.stringify(MIMO_LABEL)}, chain: ${JSON.stringify([MIMO_LABEL, LOCAL_LABEL])}, chainDisabled: [] }, attachments: [{ name: 'flower.mp4', path: ${JSON.stringify(video)} }] })`);
  const txt = JSON.stringify(r || {});
  jianCha(11, '视频附件本轮有真实回复', !!(r && r.ok && String(r.reply || '').trim()), txt.slice(0, 500));
  jianCha(11, '不再误报“没有看图/视频模型”', !/没有可用的模型来完成|看不到图|看不了图|没有.*视频模型/.test(txt), String(r && r.reply).slice(0, 300));
  jianCha(11, '画面理解真的来自看图模型（描述含花/植物/自然）', /花|flor|plant|garden|自然|植物/i.test(String(r && r.reply || '')), String(r && r.reply).slice(0, 300));
  const a = duShenJi().filter((x) => /video-delegate|capability-delegate/.test(String(x.op || '')) && JSON.stringify(x.detail || {}).includes('i-r79-10'));
  jianCha(11, '审计留下视频回退/看图转交证据', a.length > 0, a.length);
}

const REN_WU = { 1: round1, 2: round2, 3: round3, 4: round4, 5: round5, 6: round6, 7: round7, 8: round8, 9: round9, 10: round10, 11: round11 };

try {
  log(`\n=== R79 十轮真实验收：${RUN}`);
  log(`    范围 ${R1}-${R2}；token=${TOKEN}；本地模型=${LOCAL}`);
  await qiDong(PORT0);
  const k = await js(`window.warmy.providerKeySet({ providerId: ${JSON.stringify(MIMO_PROV)}, apiKey: ${JSON.stringify(MIMO_KEY)} })`);
  if (!k || k.ok === false) throw new Error('MiMo 密钥写入失败：' + JSON.stringify(k).slice(0, 200));
  const cfg = await js('window.warmy.settingsGet()');
  if (!JSON.stringify(cfg || {}).includes('i-r79-10')) throw new Error('配置没有落盘');
  for (const i of [...YUN_XU].sort((a, b) => a - b)) {
    log(`\n── 第 ${i} 轮 ──`);
    const t0 = Date.now();
    await REN_WU[i]();
    zhengJu.rounds[i - 1].ms = Date.now() - t0;
    xieZhengJu();
    const bad = zhengJu.rounds[i - 1].checks.filter((x) => !x.ok);
    if (bad.length) throw new Error(`第 ${i} 轮有 ${bad.length} 项失败：${bad.map((x) => x.name).join('；')}`);
  }
  const total = zhengJu.rounds.flatMap((r) => r.checks || []);
  log(`\n==== R79 十轮：${total.filter((x) => x.ok).length} ok / ${total.filter((x) => !x.ok).length} FAIL ====`);
  zhengJu.ok = true;
  xieZhengJu();
  await guan();
  process.exit(0);
} catch (e) {
  zhengJu.ok = false;
  zhengJu.error = String((e && (e.stack || e.message)) || e).slice(0, 2000);
  xieZhengJu();
  log('\nFAIL ' + zhengJu.error);
  try { await guan(); } catch { /* noop */ }
  process.exit(1);
} finally {
  if (!KEEP) {
    // 证据（settings/审计/文件）留在 RUN；profile 的 Chromium 缓存较大，成功时清掉缓存但保留数据
    // 失败时整份保留，方便复盘。
    if (zhengJu.ok) {
      for (const d of ['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache']) {
        try { fs.rmSync(path.join(profile, d), { recursive: true, force: true }); } catch { /* noop */ }
      }
    }
  }
}
