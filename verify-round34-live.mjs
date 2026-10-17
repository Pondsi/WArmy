/**
 * 第 34 轮 项 12 真机回放门禁（τ-bench 式 pass^k）。
 *
 * 以前的真机门禁"都说通过了，实际每次都有同样的问题"：场景是自己编的简化版、只看模型回了什么。
 * 这一版改成：
 *   ① **原样重放**出事的那条消息 + 两个附件（截图 png + 自带 svg），配置照搬出事环境
 *      （默认模型 MiMo mimo-v2.6-flash、看图链头是本地 27B 视觉模型、安全档「普通 + 超出询问」、
 *      上下文/工具预算参数与真机一致），授权卡像用户一样点「同意」；
 *   ② 每次都是**全新 profile**（互不串记忆），连续跑 k 次，**k 次全过才算过**（pass^k）；
 *   ③ 判分只认**世界状态 + 轨迹**：审计日志（工具/续派/卡片）、Ollama server.log、桌面目录差分、
 *      文件真实内容；模型自己说"完成了"不算数。
 *
 * open_path 走 WARMY_OPEN_PATH_DRYRUN=1：整条授权/解析/记账路径照走，只是不真的弹出程序窗口
 * （否则 Office 会锁住测试产物、也会在用户桌面上弹一堆窗口）。
 *
 * 跑法：MIMO_KEY_FILE=<key 文件，只取第一行> node verify-round34-live.mjs [--trials=3] [--ollama-trials=1] [--all] [--keep]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { attach, sleep } from './packages/app-shell/scripts/cdp-lib.mjs';
import { renJiaoFu } from './verify-round34-jiaofu.mjs';

const GEN = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(GEN, 'packages', 'app-shell');
const electron = path.join(pkgRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const mainJs = path.join(pkgRoot, 'dist', 'electron-main.js');
const FIX = path.join(GEN, 'scripts', 'fixtures', 'r34-replay');
const TU_PNG = path.join(FIX, '屏幕截图 221628.png');
const TU_SVG = path.join(FIX, '音频文件.svg');
const { tiQuWenDang } = await import(pathToFileURL(path.join(pkgRoot, 'dist', 'doc-extract.js')).href);

const canShu = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? '1'] : [a, '1'];
}));
const MIMO_CI = Number(canShu.trials ?? 3);
const OLLAMA_CI = Number(canShu['ollama-trials'] ?? 1);
const QUAN_PAO = canShu.all === '1';
const LIU = canShu.keep === '1';
const PORT0 = Number(canShu.port || process.env.R34_PORT || 9971);

/** 出事那条消息，一字不改 */
const TI_SHI = [
  '告诉我你是谁，我是谁，你在使用什么模型。你知道为什么要使用这个模型吗？',
  '在我的桌面上生成一个txt文本，生成一个ppt，写入 你是谁，我是谁。',
  '然后打开这2个文件，让我验收。',
  '完成后等待30秒，然后写一个6000字的小说，随便写点什么，发给我看看。',
  '然后告诉我，你可以看到我提供的这个截图吗？',
  '可以看到我添加的文件吗？里面是什么内容。',
].join('\n');

const MIMO_ID = 'mimo-token-plan-r34';
const MIMO_BIAO = 'MiMo token plan（cn）';
const MIMO_MO = ['mimo-v2.5', 'mimo-v2.5-asr', 'mimo-v2.5-pro', 'mimo-v2.5-tts', 'mimo-v2.5-tts-voiceclone', 'mimo-v2.5-tts-voicedesign', 'mimo-v2.6-flash', 'mimo-v2.6-pro'];
const MIMO_CHAT = 'mimo-v2.6-flash';
const OLLAMA_ID = 'ollama-r34';
const VL_TOU = process.env.R34_VL_HEAD || 'orcarouter/Qwen3.8-27B-Uncensored:q4_K_M-128K';
const VL_4B = 'huihui_ai/qwen3-vl-abliterated:4b';
const VL_8B = 'huihui_ai/qwen3-vl-abliterated:8b';
/** 本机试验用能装进 24G 显存的最强视觉模型（8B 写不出 6000 字、也读不懂 svg，那是模型能力，不是宿主问题） */
const OLLAMA_CHAT = process.env.R34_OLLAMA_CHAT || VL_TOU;

const ZHI_NENG = { contextLen: 0, kind: 'chat', tools: true, vision: 'unknown' };
const KAN_TU = (n) => ({ contextLen: n, kind: 'chat', tools: true, vision: true, mediaFormats: ['png', 'jpeg', 'webp', 'gif'] });
const YIN = (kind) => ({ contextLen: 0, kind, tools: false, vision: false, mediaFormats: ['wav', 'mp3'] });
const NENG_LI = {
  'mimo-v2.5': ZHI_NENG, 'mimo-v2.5-pro': ZHI_NENG, 'mimo-v2.6-flash': ZHI_NENG, 'mimo-v2.6-pro': ZHI_NENG,
  'mimo-v2.5-asr': YIN('asr'), 'mimo-v2.5-tts': YIN('tts'), 'mimo-v2.5-tts-voiceclone': YIN('tts'), 'mimo-v2.5-tts-voicedesign': YIN('tts'),
  [VL_TOU]: KAN_TU(131072), [VL_4B]: KAN_TU(262144), [VL_8B]: KAN_TU(262144),
  'bge-m3:latest': { contextLen: 8192, kind: 'embedding', tools: false, vision: false },
};

/** 自写的人设（长度与真机那份相当；不抄用户内容） */
const REN_SHE = [
  '你是一名细致、可靠的办公助理，服务对象是一位独立开发者。',
  '工作原则：先弄清楚用户到底要什么，再动手；能用工具真正完成的事情就用工具完成，不要只在嘴上说"已完成"。',
  '涉及文件时，写清楚文件的完整路径；生成文档后要确认内容确实写进去了。',
  '回答要条理清楚，先给结论再给细节；不确定的地方如实说明，不编造事实。',
  '用户让你等一等、再继续的时候，严格按顺序执行，不要提前做后面的步骤，也不要把已经做完的步骤重做一遍。',
  '写长文时注意结构完整：有开头、发展、高潮和结尾，人物前后一致，避免大段重复。',
  '遇到权限或路径问题，先说明原因，再给出可行的替代办法。',
  '和用户沟通时语气友好、简洁，不堆砌客套话；用户的时间很宝贵。',
].join('\n');

let tongGuo = 0;
let shiBai = 0;
const zongBaoGao = [];

function ziShu(s) { return [...String(s || '').replace(/\s+/g, '')].length; }
function xiaoXie(p) { return path.resolve(String(p || '')).toLowerCase(); }

/** 系统登记的桌面（已知文件夹可被重定向到别的盘，home\Desktop 不一定是它） */
function zhenZhuoMian() {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "[Console]::OutputEncoding=[Text.Encoding]::UTF8; [Environment]::GetFolderPath('Desktop')"], { encoding: 'utf8', windowsHide: true });
    const p = String(out || '').trim();
    if (p && fs.existsSync(p)) return p;
  } catch { /* 退回惯例名 */ }
  return path.join(os.homedir(), 'Desktop');
}

function muLuKuaiZhao(dir) {
  try { return new Set(fs.readdirSync(dir)); } catch { return new Set(); }
}

function ollamaRiZhiLu() {
  return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Ollama', 'server.log');
}
function wenJianDaXiao(f) { try { return fs.statSync(f).size; } catch { return 0; } }
function duXinZengRiZhi(f, cong) {
  try {
    const st = fs.statSync(f);
    if (st.size <= cong) return '';
    const fd = fs.openSync(f, 'r');
    const n = st.size - cong;
    const b = Buffer.alloc(n);
    fs.readSync(fd, b, 0, n, cong);
    fs.closeSync(fd);
    return b.toString('utf8');
  } catch { return ''; }
}

function duShenJi(profile, t0) {
  const f = path.join(profile, 'audit', 'audit.jsonl');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter((r) => r && Number(r.ts) >= t0 - 2000);
}

function lieWenJian(dir, out = [], shen = 0) {
  if (shen > 4) return out;
  let ming = [];
  try { ming = fs.readdirSync(dir); } catch { return out; }
  for (const m of ming) {
    const p = path.join(dir, m);
    try {
      const st = fs.statSync(p);
      if (st.isDirectory()) lieWenJian(p, out, shen + 1);
      else out.push(p);
    } catch { /* noop */ }
  }
  return out;
}

function duWenBen(p) {
  try {
    if (/\.(txt|md|markdown)$/i.test(p)) return fs.readFileSync(p, 'utf8');
    if (/\.(pptx|docx|xlsx|pdf)$/i.test(p)) {
      const r = tiQuWenDang(p, { maxChars: 200000 });
      return r && r.ok ? String(r.text || '') : '';
    }
  } catch { /* noop */ }
  return '';
}

async function dengCdp(port) {
  for (let i = 0; i < 120; i += 1) {
    try {
      const rr = await fetch('http://127.0.0.1:' + port + '/json', { signal: AbortSignal.timeout(1200) });
      if (rr.ok) return true;
    } catch { /* 等 */ }
    await sleep(500);
  }
  return false;
}

function shaJinCheng(child) {
  if (!child || !child.pid) return;
  try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { /* 已退出 */ }
  try { child.kill('SIGKILL'); } catch { /* noop */ }
}

/** 一次试验：全新 profile → 照真机配置 → 原样发消息 → 像用户一样批授权卡 → 等整轮真的结束 → 按事实判分 */
async function yiCi(xu, lei, miYao, kanTuLian) {
  const biao = `r34-${lei}-${xu}`;
  const SID = 'inst-' + Date.now().toString(36) + '-r34' + lei[0] + xu;
  const port = PORT0 + zongBaoGao.length;
  const profile = path.join(os.tmpdir(), 'warmy-r34-live-' + Date.now() + '-' + lei + xu);
  fs.mkdirSync(profile, { recursive: true });
  const zhuoMian = zhenZhuoMian();
  const jiaZhuoMian = path.join(os.homedir(), 'Desktop');
  const jiaZhuoMianYuanYou = fs.existsSync(jiaZhuoMian);
  const zhuoMianQian = muLuKuaiZhao(zhuoMian);
  const ollamaLu = ollamaRiZhiLu();
  const ollamaQian = wenJianDaXiao(ollamaLu);
  const bao = { biao, lei, SID, profile, jianCha: [], zhiBiao: {}, guiJi: [], xiaoXi: [] };
  const jian = (ming, ok, xiang) => {
    bao.jianCha.push({ ming, ok: ok === true, xiang });
    console.log((ok === true ? '  ok   ' : '  FAIL ') + ming + (ok === true || xiang === undefined ? '' : ' => ' + JSON.stringify(xiang).slice(0, 400)));
  };
  console.log(`\n=== 试验 ${biao}（${lei === 'mimo' ? MIMO_CHAT : OLLAMA_CHAT}）sid=${SID} ===`);

  const env = { ...process.env, WARMY_OPEN_PATH_DRYRUN: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, [
    '--remote-debugging-port=' + port,
    '--disable-features=CalculateNativeWinOcclusion',
    '--user-data-dir=' + profile,
    mainJs,
  ], { cwd: pkgRoot, stdio: ['ignore', 'ignore', 'ignore'], windowsHide: false, env });
  let c = null;
  const js = (e) => c.evaluate('(async function(){ try { return await (' + e + '); } catch (err) { return { __err: String((err && (err.stack || err.message)) || err).slice(0, 300) }; } })()');
  const xinZengZhuoMian = new Set();
  try {
    if (!(await dengCdp(port))) { jian('CDP 起得来', false, 'timeout'); return bao; }
    await sleep(6000);
    c = await attach(port, { biaoQian: 'r34live' + xu, callTimeout: 180000 });
    await c.send('Runtime.enable');
    await sleep(1500);

    const shiMimo = lei === 'mimo';
    const morenMo = shiMimo ? `${MIMO_BIAO} · ${MIMO_CHAT}` : `Ollama · ${OLLAMA_CHAT}`;
    const lian = shiMimo
      ? [`${MIMO_BIAO} · mimo-v2.6-flash`, `${MIMO_BIAO} · mimo-v2.5`, `${MIMO_BIAO} · mimo-v2.5-pro`, `${MIMO_BIAO} · mimo-v2.6-pro`, ...kanTuLian.map((m) => 'Ollama · ' + m)]
      : [`Ollama · ${OLLAMA_CHAT}`];
    const gongYing = [
      { id: 'deepseek', biaoQian: 'DeepSeek', protocol: 'openai-compatible', baseURL: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat', models: [], staleModels: [], hasKey: false },
      ...(shiMimo ? [{ id: MIMO_ID, biaoQian: MIMO_BIAO, protocol: 'openai-compatible', baseURL: 'https://token-plan-cn.xiaomimimo.com/v1', defaultModel: '', models: MIMO_MO, staleModels: [], hasKey: false }] : []),
      { id: OLLAMA_ID, biaoQian: 'Ollama', protocol: 'ollama', baseURL: 'http://127.0.0.1:11434', defaultModel: '', models: [...new Set([...kanTuLian, OLLAMA_CHAT, 'bge-m3:latest'])], staleModels: [], hasKey: false },
    ];
    const peiZhi = {
      yuYan: 'zh-CN', setupDone: true, privacyConsent: true, guideDone: true, providersSeeded: true,
      globalSecurity: 'normal', askOnExceed: true, autoSelectRecommended: false, trustedFolders: [],
      modelContextTokens: 32768, contextBudgetChars: 4000, contextToolResultChars: 4000, contextToolTotalChars: 12000,
      contextToolMaxRounds: 12, contextBudgetPercent: 60, autoSummary: true,
      providers: gongYing,
      modelCaps: NENG_LI,
      specialModels: {
        chatChain: shiMimo ? ['mimo-v2.5', 'mimo-v2.5-pro', 'mimo-v2.6-flash', 'mimo-v2.6-pro', ...kanTuLian] : [OLLAMA_CHAT],
        organizerChain: shiMimo ? ['mimo-v2.5', 'mimo-v2.5-pro', 'mimo-v2.6-flash', 'mimo-v2.6-pro'] : [OLLAMA_CHAT],
        asrChain: shiMimo ? ['mimo-v2.5-asr'] : [],
        ttsChain: shiMimo ? ['mimo-v2.5-tts', 'mimo-v2.5-tts-voiceclone', 'mimo-v2.5-tts-voicedesign'] : [],
        imageUndChain: kanTuLian,
        embedChain: ['bge-m3:latest'],
      },
      instances: [{
        id: SID, ming: '牛马-1', name: '牛马-1', status: 'running', dutyEligible: true, notify: true,
        model: 'deepseek-chat', persona: REN_SHE, smartMode: false,
        defaultModel: morenMo, currentModel: shiMimo ? MIMO_CHAT : OLLAMA_CHAT, chain: lian, chainDisabled: [],
      }],
    };
    await js(`window.warmy.settingsSave(${JSON.stringify(peiZhi)})`);
    if (shiMimo) {
      const k = await js(`window.warmy.providerKeySet(${JSON.stringify({ providerId: MIMO_ID, apiKey: miYao })})`);
      if (!k || k.ok === false) { jian('MiMo 密钥写入', false, k && (k.error || k.__err)); return bao; }
    }
    await sleep(2500);
    const hui = await js('window.warmy.settingsGet()');
    jian('配置落盘（实例/安全档/看图链）', JSON.stringify(hui || {}).includes(SID) && JSON.stringify(hui || {}).includes(kanTuLian[0]), 'settings-missing');

    await js(`(function(){
      window.__r34 = { ev: [], cards: [], fa: { done: false } };
      window.warmy.onYunXingZhuangTai((d) => { try { window.__r34.ev.push(d); } catch (e) { /* noop */ } });
      window.warmy.onAiWenTi((d) => { try { window.__r34.cards.push(d); } catch (e) { /* noop */ } });
      return true;
    })()`.replace(/\n\s*/g, ' '));

    const t0 = Date.now();
    const zaiTu = [{ name: path.basename(TU_PNG), path: TU_PNG }, { name: path.basename(TU_SVG), path: TU_SVG }];
    const jiChu = {
      sessionId: SID, content: TI_SHI, insertMode: 'outer', ming: '牛马-1', thinkLevel: 'auto', xiaoDiShuLiang: 'auto',
      moXingJueCe: { urgency: 'P2', defaultModel: morenMo, chain: lian, chainDisabled: [] },
      jiaQiangHuiFu: false,
    };
    // 附件和界面一样：先用 wenJianYuLan 读缩略图 dataUrl，再连同路径一起交给 chatSend
    await js(`(function(){
      const x = window.__r34;
      (async () => {
        const fuJian = ${JSON.stringify(zaiTu)};
        for (const a of fuJian) { try { const r = await window.warmy.wenJianYuLan({ path: a.path }); a.dataUrl = (r && r.ok && r.dataUrl) || ''; } catch (e) { a.dataUrl = ''; } }
        return window.warmy.chatSend(Object.assign(${JSON.stringify(jiChu)}, { attachments: fuJian }));
      })().then((r) => { x.fa = { done: true, r: r, at: Date.now() }; }, (e) => { x.fa = { done: true, err: String((e && e.message) || e), at: Date.now() }; });
      return true;
    })()`.replace(/\n\s*/g, ' '));

    /** 像用户一样处理卡片：工作区外的授权卡点「同意」；其它卡一律记失败并点「停止」（简单任务不该走到决策卡） */
    const kaPian = [];
    const yiDa = new Set();
    const chuLiKa = async () => {
      const r = await js('window.warmy.aiQuestionList()');
      for (const q of (r && r.items) || []) {
        if (q.status !== 'pending' || yiDa.has(q.id)) continue;
        yiDa.add(q.id);
        const xuan = q.options || [];
        const tong = xuan.find((o) => /同意|允许/.test(String(o.biaoQian || '')));
        const ju = xuan.find((o) => /拒绝/.test(String(o.biaoQian || '')));
        const shouQuan = !!(tong && ju);
        let xuanZhong;
        if (shouQuan && /工作区外/.test(String(q.biaoTi || ''))) xuanZhong = tong;
        else if (shouQuan) xuanZhong = ju;
        else xuanZhong = xuan.find((o) => /停止/.test(String(o.biaoQian || ''))) || ju || xuan[xuan.length - 1];
        const ji = { ts: Date.now(), biaoTi: String(q.biaoTi || ''), ti: String(q.ti || ''), shouQuan, daAn: xuanZhong ? xuanZhong.biaoQian : '' };
        kaPian.push(ji);
        console.log(`  · 卡片 +${Math.round((ji.ts - t0) / 1000)}s「${ji.biaoTi}」→ ${ji.daAn}`);
        if (xuanZhong) await js(`window.warmy.aiQuestionAnswer(${JSON.stringify({ id: q.id, optionId: xuanZhong.id })})`);
      }
    };

    const chaoShi = (shiMimo ? 25 : 40) * 60000;
    let fa = null;
    let jieShuAt = 0;
    let shangBao = Date.now();
    for (;;) {
      await sleep(1500);
      await chuLiKa();
      const s = await js(`(function(){
        const x = window.__r34;
        const f = x.fa && x.fa.done ? { done: true, at: x.fa.at, ok: !!(x.fa.r && x.fa.r.ok), planPending: !!(x.fa.r && x.fa.r.planPending), err: x.fa.err || (x.fa.r && x.fa.r.error) || '', moXing: (x.fa.r && x.fa.r.moXing) || '', tools: (x.fa.r && x.fa.r.tools) || null, reply: String((x.fa.r && x.fa.r.reply) || '').slice(0, 200) } : { done: false };
        return { fa: f, ev: x.ev.filter((e) => e && e.sessionId === ${JSON.stringify(SID)}) };
      })()`.replace(/\n\s*/g, ' '));
      if (s && s.fa && s.fa.done && !fa) {
        fa = s.fa;
        console.log(`  · chatSend 回包 +${Math.round((fa.at - t0) / 1000)}s ok=${fa.ok} planPending=${fa.planPending} 模型=${fa.moXing} ${fa.err ? '错=' + String(fa.err).slice(0, 120) : ''}`);
      }
      if (fa) {
        if (!fa.ok || !fa.planPending) { jieShuAt = fa.at; break; }
        const guan = ((s && s.ev) || []).find((e) => e.kai === false && Number(e.ts) >= fa.at);
        if (guan) { jieShuAt = Number(guan.ts); break; }
      }
      if (Date.now() - shangBao > 30000) {
        shangBao = Date.now();
        const sj = duShenJi(profile, t0);
        const zui = sj.slice(-1)[0];
        console.log(`  · 进行中 +${Math.round((Date.now() - t0) / 1000)}s 审计 ${sj.length} 条，最近：${zui ? zui.op : '-'}`);
        // 已经登记了中断/异常、之后 45 秒审计一条都没动 ⇒ 这一轮已经停在那里了，不再干等到超时
        const zhongDuan = sj.some((r) => /^plan\.(task-interrupted|eta-anomaly)$/.test(String(r.op)));
        if (zhongDuan && zui && Date.now() - Number(zui.ts) > 45000) {
          console.log('  · 已登记中断且 45 秒没有新动作 ⇒ 提前收尾');
          jieShuAt = Date.now();
          break;
        }
      }
      if (Date.now() - t0 > chaoShi) break;
    }
    jian('整轮在时限内真正结束（不是被超时掐断）', jieShuAt > 0, { fa: fa && { ok: fa.ok, err: fa.err }, chaoShiFen: chaoShi / 60000 });
    if (fa) jian('主轮 chatSend ok', fa.ok === true, fa.err);
    // 静默核对：结束信号之后 6 秒内不许再有续派/新一轮（"看起来停了其实还在跑"）
    await sleep(6000);
    await chuLiKa();
    const sj = duShenJi(profile, t0);
    const hou = sj.filter((r) => jieShuAt && Number(r.ts) > jieShuAt + 500 && /^(plan\.auto-continue$|chat\.tools\.done)/.test(String(r.op)));
    jian('结束后没有再偷偷续派', jieShuAt > 0 && hou.length === 0, hou.map((r) => r.op));

    const op = (name) => sj.filter((r) => r.op === name);
    const d = (r) => r.detail || {};
    // —— 轨迹 ——
    for (const r of sj) {
      if (/^(chat\.work-tool|chat\.host-tool|open_path\.try|plan\.auto-continue|plan\.gate|plan\.verify|plan\.evidence|auth\.|chat\.capability|capability-chain|chat\.attachments|chat\.model-picked|plan\.talk-only|plan\.open-left|chat\.tools\.done)/.test(String(r.op))) {
        const x = d(r);
        bao.guiJi.push(`+${Math.round((r.ts - t0) / 1000)}s ${r.op} ${[x.tool, x.ok === undefined ? '' : 'ok=' + x.ok, x.why, x.step, x.path, x.abs, x.result, x.model, x.cap, x.ms === undefined ? '' : x.ms + 'ms', x.error, x.lunShu === undefined ? '' : 'lun=' + x.lunShu, x.tingZhiYuanYin].filter((v) => v !== undefined && v !== '').join(' ')}`.slice(0, 220));
      }
    }
    console.log('  · 轨迹：\n    ' + bao.guiJi.join('\n    '));

    // —— A. 不循环、不中断、不卡（用户的原始投诉）——
    const jinQu = ['plan.auto-continue-repeat-anomaly', 'plan.task-interrupted', 'plan.paused-no-progress', 'plan.auto-continue-capped',
      'plan.paused-step-capped', 'plan.auto-continue-step-skipped', 'chat.tool-repeat-3x', 'chat.tool-repeat-stopped',
      'plan.auto-continue-fail', 'plan.long-text-short', 'plan.open-left', 'plan.auto-continue-skip-hard-error', 'plan.auto-continue-length-capped',
      'plan.eta-anomaly'];
    const chuXian = sj.filter((r) => jinQu.includes(String(r.op)));
    jian('没有循环/中断/空转/到顶/没写够的事件', chuXian.length === 0, chuXian.map((r) => r.op + ' ' + JSON.stringify(d(r)).slice(0, 120)));
    const jueCe = kaPian.filter((k) => !k.shouQuan);
    jian('没有弹出决策卡（简单任务不该走到"请你选下一步"）', jueCe.length === 0, jueCe.map((k) => k.biaoTi));
    const xu2 = op('plan.auto-continue').map((r) => String(d(r).why || ''));
    const ji = (w) => xu2.filter((x) => x === w).length;
    bao.zhiBiao.xuPai = { zong: xu2.length, targetLength: ji('target-length'), completionCheck: ji('completion-check'), planPending: ji('plan-pending'), talkOnly: ji('talk-only') };
    jian('续派有节制：完成核对≤1、截断续做≤1、只说不做≤1、写长文续写≤6', ji('completion-check') <= 1 && ji('plan-pending') <= 1 && ji('talk-only') <= 1 && ji('target-length') <= 6, bao.zhiBiao.xuPai);

    // —— B. 世界状态：桌面上真的有、只有一份、内容对 ——
    const zhuoMianHou = muLuKuaiZhao(zhuoMian);
    for (const m of zhuoMianHou) if (!zhuoMianQian.has(m)) xinZengZhuoMian.add(m);
    const xin = [...xinZengZhuoMian].map((m) => {
      const p = path.join(zhuoMian, m);
      let wen = '';
      try { if (fs.statSync(p).isFile()) wen = duWenBen(p); } catch { /* noop */ }
      return { m, p, wen };
    });
    bao.zhiBiao.zhuoMianXinZeng = xin.map((x) => x.m + `(${ziShu(x.wen)}字)`);
    console.log('  · 桌面新增：' + (bao.zhiBiao.zhuoMianXinZeng.join('、') || '（无）'));
    /**
     * **交付物按"证据强度"认，绝不按文件名猜**（用户原话只有「生成一个txt文本，生成一个ppt，写入 你是谁，我是谁」，
     * **没规定文件名**）。这一段本轮我改错过一次：嫌旧的"正文含两句 + <2000 字"不稳，换成按文件名认 ⇒
     * 真机 r36-ollama-4 模型自己起名 `身份.txt` / `身份.pptx`，被判"没有交付物"，一条**假红**级联成四条红。
     * 判据已抽成纯函数 `verify-round34-jiaofu.mjs`（可离线回放）：**轨迹（30 秒等待前打开的那两份）
     * > 正文关键词 > 文件名关键词**，取到就停；后面三条判分（允许打开 / 桌面不许多出 / 长文只有一份）
     * 共用这同一份结果，不会再互相打脸。
     */
    const kaiShiJian = op('open_path.try').map((r) => ({ abs: String(d(r).abs || ''), ts: Number(r.ts) }));
    const dengYan = op('chat.host-tool').filter((r) => d(r).tool === 'wait_seconds' && d(r).ok === true);
    const dengKai0 = dengYan.length ? Math.min(...dengYan.map((r) => Number(r.ts) - Number(d(r).ms || 0))) : null;
    const ren = renJiaoFu({
      xin, kai: kaiShiJian, dengKai: dengKai0,
      shuXie: op('chat.work-tool').filter((r) => d(r).ok === true && d(r).path).map((r) => ({ p: String(d(r).abs || d(r).path) })),
    });
    const txt = ren.txt;
    const ppt = ren.ppt;
    bao.zhiBiao.jiaoFuFangShi = ren.fangshi;
    console.log('  · 交付物认定：' + ren.fangshi + '（' + ren.liyou + '）→ ' + [...txt, ...ppt].map((x) => x.m).join('、'));
    /**
     * ⚠️ **故意不判"文件里必须逐字写着你是谁/我是谁"**：那是模型措辞自由，判死了就是又一次假红
     * （r36-ollama-4 的 `身份.txt` 写的是"我是牛马-1，你是老板"——语义正是用户要的那两句）。
     * 硬判的是：找到了这一份、这一份非空、ppt 里真有内容（下一条按文件系统事实判空壳）。
     */
    jian('桌面上找到了用户要的那份 txt 交付物（按轨迹/正文认，文件名随模型）',
      txt.length === 1 && ziShu(txt[0].wen) >= 1, xin.map((x) => x.m + ':' + ziShu(x.wen)));
    jian('桌面上恰好一个 pptx，并且真写了内容（不是空壳）',
      ppt.length === 1 && ziShu(ppt[0].wen) >= 20, xin.map((x) => x.m + ':' + ziShu(x.wen)));
    /**
     * **不许有空壳交付物**（真机 r35-live5-ollama-4：make_pptx 参数里没有正文，旧代码照样写出一个
     * "成功"的 pptx，打开只有模板占位字 ⇒ 审计全绿、计划步骤还被自动判成已完成，用户拿到一份空文件）。
     * 这条按文件系统事实判：桌面上每个办公文件抽出来的正文净字数必须 ≥20。
     */
    const kongKe = xin.filter((x) => /\.(pptx?|docx?|xlsx?|pdf)$/i.test(x.m) && ziShu(x.wen) < 20);
    jian('生成的办公文件不是空壳（正文净字数 ≥20，不许只有模板占位字）', kongKe.length === 0, kongKe.map((x) => x.m + ':' + ziShu(x.wen)));
    const chongMing = xin.filter((x) => /\(\d+\)\.[A-Za-z0-9]+$/.test(x.m) || /-\d{6,}\.[A-Za-z0-9]+$/.test(x.m));
    jian('没有重复生成的 "名 (2)" / 时间后缀副本', chongMing.length === 0, chongMing.map((x) => x.m));
    if (!jiaZhuoMianYuanYou && xiaoXie(zhuoMian) !== xiaoXie(jiaZhuoMian)) {
      jian('没有凭空造出一个假"桌面"文件夹（home\\Desktop）', !fs.existsSync(jiaZhuoMian), jiaZhuoMian);
    }
    const daKai = op('open_path.try').map((r) => xiaoXie(d(r).abs));
    const daKaiCi = {};
    for (const a of daKai) daKaiCi[a] = (daKaiCi[a] || 0) + 1;
    bao.zhiBiao.daKai = daKaiCi;
    const daKaiTxt = txt[0] ? daKaiCi[xiaoXie(txt[0].p)] || 0 : 0;
    const daKaiPpt = ppt[0] ? daKaiCi[xiaoXie(ppt[0].p)] || 0 : 0;
    jian('两个文件各打开恰好一次（打开的就是桌面上那两个）', daKaiTxt === 1 && daKaiPpt === 1, daKaiCi);
    const deng = op('chat.host-tool').filter((r) => d(r).tool === 'wait_seconds' && d(r).ok === true);
    const dengMs = deng.reduce((a, r) => a + Number(d(r).ms || 0), 0);
    bao.zhiBiao.dengDaiMs = dengMs;
    jian('真的等了 30 秒且只等了一回（29.5s ≤ 总等待 ≤ 45s）', dengMs >= 29500 && dengMs <= 45000, { ci: deng.length, dengMs });
    const yanShouLu = new Set([txt[0] && xiaoXie(txt[0].p), ppt[0] && xiaoXie(ppt[0].p)].filter(Boolean));
    const yanShouDaKai = op('open_path.try').filter((r) => yanShouLu.has(xiaoXie(d(r).abs)));
    if (deng.length && yanShouDaKai.length) {
      // 只比较「打开桌面那两个验收文件」和「开始等待」的先后；之后打开小说等其它文件不算
      const dengKai = Math.min(...deng.map((r) => Number(r.ts) - Number(d(r).ms || 0)));
      const zuiWanDaKai = Math.max(...yanShouDaKai.map((r) => Number(r.ts)));
      jian('先打开文件、再等待（按用户给的顺序）', zuiWanDaKai <= dengKai + 1500, { daKai: zuiWanDaKai - t0, dengKai: dengKai - t0 });
    }
    const gongZuoQuGen = xiaoXie(path.join(profile, 'workspace'));
    const gongZuoQuWai = op('auth.grant-once').filter((r) => d(r).tool === 'open_path' && xiaoXie(d(r).abs).startsWith(gongZuoQuGen + path.sep));
    jian('没有为工作区内的文件弹「打开工作区外」授权卡', gongZuoQuWai.length === 0, gongZuoQuWai.map((r) => d(r).abs));
    const xieHuiGongZuoQu = op('auth.grant-once').filter((r) => /^(write_file|make_pptx|make_docx|make_xlsx|make_pdf)$/.test(String(d(r).tool)) && /^(?:~\/)?(?:Desktop|桌面)\//i.test(String(d(r).path || '')));
    const xieHou = xieHuiGongZuoQu.map((g) => sj.find((r) => r.op === 'chat.work-tool' && Number(r.ts) >= Number(g.ts) && d(r).tool === d(g).tool));
    const luoCuo = xieHou.filter((r) => r && d(r).ok === true && !path.isAbsolute(String(d(r).path || '')));
    jian('授权写 Desktop/… 后真的写到了系统桌面（没被改写回工作区）', luoCuo.length === 0, luoCuo.map((r) => d(r).path));

    // —— C. 回复内容 ——
    const xx = await js(`window.warmy.chatMessages(${JSON.stringify({ sessionId: SID, limit: 200 })})`);
    const zhuShou = ((xx && xx.xiaoXiJi) || []).filter((m) => m && m.role === 'assistant' && !m.system && Number(m.ts || 0) >= t0 - 1000);
    bao.xiaoXi = zhuShou.map((m) => ({ ts: m.ts, moXing: m.moXing, text: String(m.text || '') }));
    const quanWen = zhuShou.map((m) => String(m.text || '')).join('\n');
    const gongZuoQu = lieWenJian(path.join(profile, 'workspace'));
    /** 小说候选：**按路径身份**排除已经认下的交付物（不再用"文件名里有没有你是谁"猜 —— 模型爱自己起名） */
    const jiaoFuLuJing = new Set([txt[0] && xiaoXie(txt[0].p), ppt[0] && xiaoXie(ppt[0].p)].filter(Boolean));
    const xiaoShuoWenJian = [...xin.map((x) => x.p), ...gongZuoQu]
      .filter((p) => /\.(txt|md|markdown)$/i.test(p) && !jiaoFuLuJing.has(xiaoXie(p)))
      .map((p) => ({ p, n: ziShu(duWenBen(p)) }))
      .sort((a, b) => b.n - a.n)[0];
    const huiFuChang = zhuShou.map((m) => ziShu(m.text)).filter((n) => n >= 800).reduce((a, b) => a + b, 0);
    const xiaoShuo = Math.max(huiFuChang, xiaoShuoWenJian ? xiaoShuoWenJian.n : 0);
    bao.zhiBiao.xiaoShuo = { huiFuChang, wenJian: xiaoShuoWenJian ? path.basename(xiaoShuoWenJian.p) + ':' + xiaoShuoWenJian.n : '' };
    jian('6000 字的小说真的写出来了（≥5700 字，回复或文件）', xiaoShuo >= 5700, bao.zhiBiao.xiaoShuo);
    jian('回复里说了在用什么模型', shiMimo ? /mimo/i.test(quanWen) : /qwen|huihui|ollama/i.test(quanWen), quanWen.slice(0, 200));
    jian('看到了截图里的内容（WArmy / 第四列 / 全面验证）', /WArmy|第四列|全面验证/i.test(quanWen), quanWen.slice(-400));
    jian('看到了 svg 里画的东西（音符/音乐）', /音符|音乐|乐符|乐谱|旋律|music|♪|♫|♩|🎵/i.test(quanWen), quanWen.slice(-400));
    const noReply = zhuShou.filter((m) => /NO[\\_]?_?REPLY/i.test(String(m.text || '')));
    jian('界面上看不到 NO_REPLY 这类内部记号', noReply.length === 0, noReply.map((m) => String(m.text).slice(0, 80)));
    const zuiHou = zhuShou[zhuShou.length - 1];
    jian('最后一条回复非空', !!zuiHou && ziShu(zuiHou.text) > 8, zuiHou && String(zuiHou.text).slice(0, 80));
    const guiYi = op('chat.attachments-normalized')[0];
    jian('两张附件都转成了模型能看的位图（svg 也转了）', !!guiYi && Number(d(guiYi).images) === 2 && Number(d(guiYi).skipped) === 0, guiYi && d(guiYi));
    if (shiMimo) {
      const wei = op('chat.capability-delegate').filter((r) => d(r).cap === 'imageUnd');
      const yong = op('capability-chain.used').filter((r) => d(r).lei === 'imageUnd');
      jian('看图转交给了看图链上的模型', wei.length >= 1 && yong.length >= 1, { wei: wei.length, yong: yong.map((r) => d(r).model) });
      const tou = op('chat.model-picked')[0];
      jian('主模型是默认的 mimo-v2.6-flash', !!tou && d(tou).model === MIMO_CHAT && d(tou).provider === MIMO_ID, tou && d(tou));
    }

    // —— D. 计划卫生 ——
    const jh = await js(`window.warmy.jiHuaLieBiao(${JSON.stringify({ sessionId: SID })})`);
    const bu = ((jh && jh.steps) || []).filter((x) => x && x.leiXing !== 'info');
    bao.zhiBiao.jiHua = bu.map((x) => `${x.id}=${x.status}`);
    const xuan2 = bu.filter((x) => x.status === 'pending' || x.status === 'doing');
    jian('计划里没有悬挂的 pending/doing', xuan2.length === 0, xuan2.map((x) => x.id + ':' + x.title));
    jian('计划不是宿主按句拆的（没有 host-seed）', !bu.some((x) => x.note === 'host-seed') && op('plan.host-seed').length === 0, bu.map((x) => x.note).slice(0, 4));

    // —— E. 供应商层 ——
    const xinRiZhi = duXinZengRiZhi(ollamaLu, ollamaQian);
    const huai = xinRiZhi.split('\n').filter((l) => /\[GIN\]/.test(l) && /\|\s*(4\d\d|5\d\d)\s*\|/.test(l) && /api\/chat/.test(l));
    jian('Ollama 没有 4xx/5xx 的对话请求', huai.length === 0, huai.slice(0, 3));

    // —— F. 授权卡 ——
    const sq = kaPian.filter((k) => k.shouQuan);
    const sqJian = {};
    for (const k of sq) { const kk = k.biaoTi + '|' + k.ti; sqJian[kk] = (sqJian[kk] || 0) + 1; }
    const chongSq = Object.entries(sqJian).filter(([, n]) => n > 1);
    jian('同一个授权（同操作同路径）没有问第二遍', chongSq.length === 0, chongSq.map(([k, n]) => k.slice(0, 100) + ' ×' + n));
    jian('授权卡都是认得的两类（访问/打开工作区外的文件）', sq.every((k) => /工作区外/.test(k.biaoTi)), sq.map((k) => k.biaoTi));

    // 测试产物归属：只认审计里本会话写过/打开过的文件名（放在后面的检查之前：哪项检查抛错也不影响清理）
    const shenJiMing = new Set();
    for (const r of sj) {
      for (const v of [d(r).path, d(r).abs]) if (v) shenJiMing.add(path.basename(String(v)).toLowerCase());
    }
    bao.qingLi = [...xinZengZhuoMian].filter((m) => shenJiMing.has(m.toLowerCase()));
    bao.weiZhiXinZeng = [...xinZengZhuoMian].filter((m) => !shenJiMing.has(m.toLowerCase()));

    // —— G. 轨迹精确性（"结果对了但绕了三圈、重做了一遍"也算没过；以前的门禁只看结果，所以总是假绿）——
    const jieDuan = op('chat.tools.done').filter((r) => /^(max-rounds|max-rounds-extended|budget|error)$/.test(String(d(r).tingZhiYuanYin || '')));
    jian('没有哪一轮是被工具轮数/预算上限截断或出错收场的', jieDuan.length === 0, jieDuan.map((r) => `${d(r).tingZhiYuanYin} lun=${d(r).lunShu}`));
    const xuPaiCi = op('plan.auto-continue').length;
    const zhiLingDao = op('chat.internal-directive-attached').length;
    jian('每一次续派的指令都真的送到了模型眼前', zhiLingDao >= xuPaiCi, { xuPai: xuPaiCi, daoDa: zhiLingDao });
    const zhangTiaoGuo = op('chat.step-ledger-skipped').filter((r) => d(r).why === 'last-not-user');
    jian('续接轮的「已做完」日志没有因为消息顺序被跳过', zhangTiaoGuo.length === 0, zhangTiaoGuo.map((r) => d(r).lastRole));
    const zhengXie = {};
    for (const r of op('chat.work-tool')) {
      const x = d(r);
      if (x.ok !== true || !x.path) continue;
      if (!((x.tool === 'write_file' && x.appended !== true) || /^make_(pptx|docx|xlsx|pdf)$/.test(String(x.tool)))) continue;
      const k = path.basename(String(x.path)).toLowerCase();
      zhengXie[k] = (zhengXie[k] || 0) + 1;
    }
    const chongXie = Object.entries(zhengXie).filter(([, n]) => n > 1);
    jian('同一个文件没有被整篇重写/重新生成第二遍', chongXie.length === 0, chongXie.map(([k, n]) => k + ' ×' + n));
    const jiaoFu = new Set([txt[0], ppt[0]].filter(Boolean).map((x) => x.m.toLowerCase()));
    const gongZuoQuChong = gongZuoQu.filter((p) => jiaoFu.has(path.basename(p).toLowerCase()));
    jian('工作区里没有桌面交付物的同名副本（没有写错地方再补一份）', gongZuoQuChong.length === 0, gongZuoQuChong.map((p) => path.basename(p)));
    const yunXuKai = new Set([txt[0] && xiaoXie(txt[0].p), ppt[0] && xiaoXie(ppt[0].p), xiaoShuoWenJian && xiaoXie(xiaoShuoWenJian.p)].filter(Boolean));
    const kaiCuo = Object.entries(daKaiCi).filter(([a, n]) => !yunXuKai.has(a) || n > 1);
    jian('打开的只有 txt、ppt（外加最多一次小说文件），每个只开一次', kaiCuo.length === 0, kaiCuo.map(([a, n]) => path.basename(a) + ' ×' + n));
    const zhuoMianYunXu = new Set([...jiaoFu, ...(xiaoShuoWenJian ? [path.basename(xiaoShuoWenJian.p).toLowerCase()] : [])]);
    const zhuoMianDuo = xin.filter((x) => shenJiMing.has(x.m.toLowerCase()) && !zhuoMianYunXu.has(x.m.toLowerCase()));
    jian('桌面上没有多出别的东西（脚本、草稿、副本）', zhuoMianDuo.length === 0, zhuoMianDuo.map((x) => x.m));
    /**
     * **"长文只有一份"只数小说那一份**：短交付物本身就可能写八九百字，
     * 把它算进"长文"会在模型其实做对的时候误红（真机 r35-live5 的判分噪声来源之一）⇒ 按路径身份排除交付物。
     */
    const changWen = [...xin.map((x) => x.p), ...gongZuoQu]
      .filter((p) => /\.(txt|md|markdown)$/i.test(p) && !jiaoFuLuJing.has(xiaoXie(p)) && ziShu(duWenBen(p)) >= 800);
    jian('长文只有一份（没有把小说另写一遍）', changWen.length <= 1, changWen.map((p) => path.basename(p) + ':' + ziShu(duWenBen(p))));
    const chongZuo = op('chat.step-replay-skip').length;
    bao.zhiBiao.chongZuoLanJie = chongZuo;
    jian('模型想重做已完成步骤的次数 ≤ 2（被宿主拦下的也算）', chongZuo <= 2, chongZuo);
    bao.zhiBiao.ziShuJinDu = op('chat.length-progress').length;
    bao.zhiBiao.shouQuanKa = sq.length;
    bao.zhiBiao.yongShiMiao = Math.round(((jieShuAt || Date.now()) - t0) / 1000);
    bao.zhiBiao.lunShu = op('chat.tools.done').length;
    bao.zhiBiao.gongJu = op('chat.work-tool').length + op('chat.host-tool').length;
    console.log('  · 指标：' + JSON.stringify(bao.zhiBiao));
    return bao;
  } catch (e) {
    jian('试验过程没有异常', false, String((e && e.stack) || e).slice(0, 300));
    return bao;
  } finally {
    try { if (c) c.close(); } catch { /* noop */ }
    shaJinCheng(child);
    await sleep(2500);
    // 中途抛错没走到归属那一步：按全新 profile 的整份审计 + 桌面差分补算（否则测试产物会留在用户桌面上）
    if (!bao.qingLi) {
      try {
        for (const m of muLuKuaiZhao(zhuoMian)) if (!zhuoMianQian.has(m)) xinZengZhuoMian.add(m);
        const ming = new Set();
        for (const r of duShenJi(profile, 0)) for (const v of [(r.detail || {}).path, (r.detail || {}).abs]) if (v) ming.add(path.basename(String(v)).toLowerCase());
        bao.qingLi = [...xinZengZhuoMian].filter((m) => ming.has(m.toLowerCase()));
        bao.weiZhiXinZeng = [...xinZengZhuoMian].filter((m) => !ming.has(m.toLowerCase()));
      } catch { /* noop */ }
    }
    // 清理：桌面上只删本次试验新出现、且审计里是本会话写的文件；假"桌面"文件夹是本次造出来的才删
    for (const m of bao.qingLi || []) {
      try { fs.rmSync(path.join(zhuoMian, m), { recursive: true, force: true }); } catch { /* noop */ }
    }
    if (!jiaZhuoMianYuanYou && fs.existsSync(jiaZhuoMian) && xiaoXie(zhuoMian) !== xiaoXie(jiaZhuoMian)) {
      try { fs.rmSync(jiaZhuoMian, { recursive: true, force: true }); } catch { /* noop */ }
    }
    if (bao.weiZhiXinZeng && bao.weiZhiXinZeng.length) console.log('  · 桌面上还有不归本次试验的新文件（未动）：' + bao.weiZhiXinZeng.join('、'));
    const guo = bao.jianCha.length > 0 && bao.jianCha.every((x) => x.ok);
    bao.guo = guo;
    if (guo && !LIU) { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ } }
    else console.log('  · profile 保留以便复盘：' + profile);
  }
}

console.log('=== verify-round34-live（真机原样回放 · pass^k）===');
if (!fs.existsSync(TU_PNG) || !fs.existsSync(TU_SVG)) { console.log('缺回放附件：' + FIX); process.exit(2); }
let biaoQian = [];
try {
  const r = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(5000) });
  biaoQian = ((await r.json()).models || []).map((m) => String(m.name));
} catch { /* 没起 */ }
const kanTuLian = [VL_TOU, VL_4B, VL_8B].filter((m) => biaoQian.includes(m));
if (!kanTuLian.length) { console.log('本机 Ollama 不可用或没有视觉模型 ⇒ 不跑（不假绿）'); process.exit(1); }
let miYao = '';
const keyLu = process.env.MIMO_KEY_FILE || '';
if (MIMO_CI > 0) {
  try { miYao = String(fs.readFileSync(keyLu, 'utf8').split(/\r?\n/)[0] || '').trim(); } catch { miYao = ''; }
  if (!miYao) { console.log('没有 MIMO_KEY_FILE（只取第一行）⇒ MiMo 试验不跑（不假绿）'); process.exit(1); }
}
if (OLLAMA_CI > 0 && !biaoQian.includes(OLLAMA_CHAT)) { console.log('Ollama 没有 ' + OLLAMA_CHAT + ' ⇒ 不跑'); process.exit(1); }
console.log('看图链：' + kanTuLian.join(' → '));

const jiHua = [...Array(MIMO_CI).fill('mimo'), ...Array(OLLAMA_CI).fill('ollama')];
for (let i = 0; i < jiHua.length; i += 1) {
  const bao = await yiCi(i + 1, jiHua[i], miYao, kanTuLian);
  zongBaoGao.push(bao);
  if (bao.guo) tongGuo += 1; else shiBai += 1;
  if (!bao.guo && !QUAN_PAO) { console.log('\n（第 ' + (i + 1) + ' 次没过：pass^k 已经不可能，停在这里先复盘；要跑满加 --all）'); break; }
}
const baoGaoLu = path.join(os.tmpdir(), 'warmy-r34-live-report-' + Date.now() + '.json');
try { fs.writeFileSync(baoGaoLu, JSON.stringify(zongBaoGao, null, 2)); } catch { /* noop */ }
console.log('\n==== verify-round34-live：试验 ' + zongBaoGao.length + ' 次 · 过 ' + tongGuo + ' · 败 ' + shiBai + '（pass^k 要求全过）====');
for (const b of zongBaoGao) console.log(`  ${b.guo ? 'PASS' : 'FAIL'} ${b.biao} 用时 ${b.zhiBiao.yongShiMiao || '?'}s 续派 ${JSON.stringify(b.zhiBiao.xuPai || {})} 失败项 ${b.jianCha.filter((x) => !x.ok).map((x) => x.ming).join('；') || '无'}`);
console.log('报告：' + baoGaoLu);
process.exit(shiBai || zongBaoGao.length < jiHua.length ? 1 : 0);
