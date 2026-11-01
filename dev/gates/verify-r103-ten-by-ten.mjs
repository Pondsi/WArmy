/**
 * R103 项目验收：10 牛马 × 10 项目 × 每项目 10 轮（10×10）。
 *
 * 基于 R98 harness，但按用户第 103 轮口径调整：
 *  · **只使用 MiMo + 本地 Ollama，绝不读取/使用 DeepSeek key**；
 *  · 10 个项目 × 10 轮（不是 5 项目）；
 *  · 项目之间**分批派发**（默认 2 个项目并发），避免 20 个执行者同时打爆本地 27B/云端限流；
 *  · 其余断言保留：值班委派、2 个执行者、真实产物、项目知识库验收码、黑板、上下文压缩、
 *    提示词压缩、对话历史与重启恢复。
 *
 * 运行：node dev/gates/verify-r103-ten-by-ten.mjs
 * 可选：WARMY_ACCEPT_RUNS=1；WARMY_KEY_DIR=<放 key 的目录>；WARMY_R103_BATCH=2
 *
 * 安全：只从本地文件提取 MiMo token，**任何日志都不打印密钥**；不读取 DeepSeek 形状 key。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PKG = path.join(ROOT, 'packages/app-shell');
const { attach, sleep } = await import(pathToFileURL(path.join(PKG, 'scripts/cdp-lib.mjs')).href);
// 密钥目录默认取仓库的上一级（用户放 key 的工作区），不在仓库里写任何密钥文件名
const KEY_DIR = process.env.WARMY_KEY_DIR || path.dirname(ROOT);
const RUNS = Math.max(1, Math.floor(Number(process.env.WARMY_ACCEPT_RUNS) || 1));
/** 项目并发批大小：默认 2；本地 27B 不作为执行者，9B 每批最多 2 个 */
const BATCH = Math.max(1, Math.min(5, Math.floor(Number(process.env.WARMY_R103_BATCH) || 2)));

const ROUNDS = 10;
const PROJECT_COUNT = 10;
const MI = 'mimo-v2.6-pro';
const JIU_B = 'lileilei999/qwen3.5-9b-abliterated-vision:latest';
const Q27 = 'qwen3.8-27b:iq3-128K';
const Q27B = 'Qwen3.8-27B-Uncensored:iq3_m-128K';
const Q27C = 'batiai/qwen3.8-27b:iq3';
const NIUMAS = [
  { id: 'n01', ming: '验收牛马-01', model: MI, provider: 'mimo' },
  { id: 'n02', ming: '验收牛马-02', model: MI, provider: 'mimo' },
  { id: 'n03', ming: '验收牛马-03', model: MI, provider: 'mimo' },
  { id: 'n04', ming: '验收牛马-04', model: MI, provider: 'mimo' },
  { id: 'n05', ming: '验收牛马-05', model: MI, provider: 'mimo' },
  { id: 'n06', ming: '验收牛马-06', model: JIU_B, provider: 'ollama' },
  { id: 'n07', ming: '验收牛马-07', model: JIU_B, provider: 'ollama' },
  { id: 'n08', ming: '验收牛马-08', model: Q27, provider: 'ollama' },
  { id: 'n09', ming: '验收牛马-09', model: Q27B, provider: 'ollama' },
  { id: 'n10', ming: '验收牛马-10', model: Q27C, provider: 'ollama' },
];
/**
 * 每项目 5 只成员；5 个 MiMo pro 中取 3 个做执行者，2 个本地模型做纯调度/值班。
 * 第 2 次运行证明 MiMo flash（以及弱本地 9B）会只回正文不写文件；这是模型能力，不是应用逻辑。
 * 本轮 10×10 只验应用编排，所以执行者统一用能稳定守工具指令的 MiMo pro；本地模型仍参与值班/调度。
 */
const PROJECTS = [
  { key: 'A', id: 'r103-p01', ming: '验收项目一', members: ['n01', 'n02', 'n03', 'n06', 'n07'], pure: ['n06', 'n07'] },
  { key: 'B', id: 'r103-p02', ming: '验收项目二', members: ['n02', 'n03', 'n04', 'n07', 'n08'], pure: ['n07', 'n08'] },
  { key: 'C', id: 'r103-p03', ming: '验收项目三', members: ['n03', 'n04', 'n05', 'n08', 'n09'], pure: ['n08', 'n09'] },
  { key: 'D', id: 'r103-p04', ming: '验收项目四', members: ['n04', 'n05', 'n01', 'n09', 'n10'], pure: ['n09', 'n10'] },
  { key: 'E', id: 'r103-p05', ming: '验收项目五', members: ['n05', 'n01', 'n02', 'n06', 'n10'], pure: ['n06', 'n10'] },
  { key: 'F', id: 'r103-p06', ming: '验收项目六', members: ['n01', 'n03', 'n04', 'n07', 'n08'], pure: ['n07', 'n08'] },
  { key: 'G', id: 'r103-p07', ming: '验收项目七', members: ['n02', 'n04', 'n05', 'n08', 'n09'], pure: ['n08', 'n09'] },
  { key: 'H', id: 'r103-p08', ming: '验收项目八', members: ['n03', 'n05', 'n01', 'n09', 'n10'], pure: ['n09', 'n10'] },
  { key: 'I', id: 'r103-p09', ming: '验收项目九', members: ['n04', 'n01', 'n02', 'n06', 'n07'], pure: ['n06', 'n07'] },
  { key: 'J', id: 'r103-p10', ming: '验收项目十', members: ['n05', 'n02', 'n03', 'n07', 'n08'], pure: ['n07', 'n08'] },
];

const t0All = Date.now();
let assertionCount = 0;
let failure = null;

function jian(name, cond, detail = '') {
  assertionCount += 1;
  if (cond) return true;
  const e = new Error(`${name}${detail ? '：' + detail : ''}`);
  e.__gateName = name;
  throw e;
}

/**
 * 只按**令牌形状**认密钥，不按文件名认：把密钥目录里的文本读进来，再按各家前缀提取。
 * 这样仓库里不会出现任何“某某 key 文件名”，也不会写死用户目录。
 */
function allKeyText() {
  try {
    const bufs = [];
    for (const f of fs.readdirSync(KEY_DIR)) {
      if (!/\.txt$/i.test(f)) continue;
      try {
        const p = path.join(KEY_DIR, f);
        if (fs.statSync(p).size > 2 * 1024 * 1024) continue;
        const txt = fs.readFileSync(p, 'utf8');
        // 只保留含 MiMo token 形状的文件；不把 DeepSeek 等其它 key 带进后续流程
        if (/tp-[A-Za-z0-9]{20,}/.test(txt)) bufs.push(txt);
      } catch { /* 跳过读不动的文件 */ }
    }
    return bufs.join('\n').replace(/^\uFEFF/, '');
  } catch { return ''; }
}
const ALL_KEY_TEXT = allKeyText();
const firstKey = (re) => ALL_KEY_TEXT.match(re)?.[0] || '';
/** 只认 MiMo token；**不提取/不使用 DeepSeek key** */
const KEY = { mimo: firstKey(/tp-[A-Za-z0-9]{20,}/) };
jian('密钥文件里能找到 MiMo token', !!KEY.mimo, '没有从本地 key 文件提取到 MiMo token');
jian('本轮只提取 MiMo token（不读取 DeepSeek key）', Object.keys(KEY).length === 1 && Object.keys(KEY)[0] === 'mimo');

const PROVIDERS = {
  mimo: { id: 'mimo', biaoQian: 'MiMo', protocol: 'openai-compatible', baseURL: 'https://token-plan-cn.xiaomimimo.com/v1', models: ['mimo-v2.6-flash', 'mimo-v2.6-pro'] },
  ollama: {
    id: 'ollama', biaoQian: 'Ollama', protocol: 'ollama', baseURL: 'http://127.0.0.1:11434',
    models: ['qwen3.8-27b:iq3-128K', 'Qwen3.8-27B-Uncensored:iq3_m-128K', 'batiai/qwen3.8-27b:iq3', 'lileilei999/qwen3.5-9b-abliterated-vision:latest'],
  },
};

function profilesOf() { try { return fs.readdirSync(os.tmpdir()).filter((x) => x.startsWith('warmy-r103-10x10-')).map((x) => path.join(os.tmpdir(), x)); } catch { return []; } }
function cleanOldProfiles() {
  for (const p of profilesOf()) { try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* noop */ } }
}
function readAudit(profile) {
  const f = path.join(profile, 'audit', 'audit.jsonl');
  try {
    return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}
function eventsOf(audit, op, groupId, since = 0) {
  return audit.filter((e) => e && e.op === op && e.ts >= since && (!groupId || String(e.detail?.groupId || '') === groupId));
}
function rand6() { return Math.random().toString(36).slice(2, 8).toUpperCase(); }
function shuffle(a) {
  const x = a.slice();
  for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; }
  return x;
}
function fileTexts(dir) {
  const out = {};
  try {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      try { if (fs.statSync(p).isFile()) out[f] = fs.readFileSync(p, 'utf8'); } catch { /* noop */ }
    }
  } catch { /* noop */ }
  return out;
}

/** 超限提示词：启动自检必须把它压回上限，且末尾要点标记不能被吞 */
function seedOverCapPrompts(profile) {
  const shu = ['# 验收术层', ...Array.from({ length: 80 }, (_, i) => `${i + 1}. 第 ${i + 1} 条做事准则：先确认目标、边界与验收标准，再开始动手；每一步都要真的调用工具完成，产物必须真实落盘并回读校验；遇到阻塞要如实说明原因和下一步，不许假装完成，也不许用口头描述代替实际动作。`), 'MUST-KEEP-SHU-R103'].join('\n');
  const yin = ['# 验收印象层', ...Array.from({ length: 55 }, (_, i) => `${i + 1}. 第 ${i + 1} 条协作印象：值班者要交代清楚谁做了什么、产物在哪里；执行者要交回可核实的结论与路径，遇到问题如实上报。`), 'MUST-KEEP-YIN-R103'].join('\n');
  fs.writeFileSync(path.join(profile, 'shu.md'), shu, 'utf8');
  fs.writeFileSync(path.join(profile, 'yinxiang.md'), yin, 'utf8');
  return { shu: shu.length, yin: yin.length };
}

/**
 * 盘点“可使用的供应商模型”：能列出模型的就全收；列不出来但已实测可用的保底清单照样保留。
 * 只读取、不打印密钥。
 */
async function inventoryModels() {
  const fetched = {};
  async function openaiList(p) {
    try {
      const r = await fetch(p.baseURL + '/models', { headers: { Authorization: 'Bearer ' + KEY[p.id] }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) return [];
      const j = await r.json();
      return Array.isArray(j?.data) ? j.data.map((m) => String(m.id || m.name || '')).filter(Boolean) : [];
    } catch { return []; }
  }
  fetched.mimo = (await openaiList(PROVIDERS.mimo)).filter((m) => !/-(asr|tts|voice)/i.test(m));
  try {
    const r = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(20000) });
    const j = await r.json();
    fetched.ollama = (j.models || []).map((m) => String(m.name || '')).filter((m) => m && !/(bge|whisper|embed|minilm|nomic)/i.test(m));
  } catch { fetched.ollama = []; }
  for (const [id, p] of Object.entries(PROVIDERS)) {
    const all = [...new Set([...(p.models || []), ...(fetched[id] || [])])].filter(Boolean).sort();
    p.models = all;
    jian(`供应商 ${id} 至少有一个可用模型`, all.length > 0);
  }
  for (const n of NIUMAS) jian(`牛马 ${n.ming} 的默认模型属于 ${n.provider}`, PROVIDERS[n.provider].models.includes(n.model), n.model);
  return fetched;
}

async function waitBoot(c) {
  for (let i = 0; i < 160; i++) {
    const v = await c.evaluate('window.__warmyBootDataReady === true').catch(() => false);
    if (v === true) { await sleep(800); return; }
    await sleep(250);
  }
  throw new Error('等待应用启动数据就绪超时');
}
async function waitTenRunning(c) {
  // 启动时渲染层按顺序 await spawnInstance；10 只要 30–60 秒，给足两分钟
  for (let i = 0; i < 480; i++) {
    const x = await c.evaluate('window.warmy.listInstances()').catch(() => null);
    if (Array.isArray(x) && x.length === 10 && x.every((n) => n.status === 'running')) return x;
    await sleep(250);
  }
  throw new Error('等待 10 只牛马全部 running 超时');
}
async function waitPortClosed(port) {
  for (let i = 0; i < 80; i++) {
    try { await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(500) }); } catch { return; }
    await sleep(250);
  }
}
function launch(profile, port) {
  const env = { ...process.env, WARMY_AUTH_BYPASS: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  return spawn(path.join(PKG, 'node_modules/electron/dist/electron.exe'), ['--remote-debugging-port=' + port, '--user-data-dir=' + profile, path.join(PKG, 'dist/electron-main.js')], { cwd: PKG, stdio: ['ignore', 'ignore', 'ignore'], env });
}
function killTree(child) {
  try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* noop */ }
}
async function connect(port) {
  let c = null;
  for (let i = 0; i < 160; i++) {
    try { c = await attach(port, { biaoQian: 'r103-10x10', callTimeout: 360000 }); break; } catch { await sleep(300); }
  }
  if (!c) throw new Error('CDP 连接失败');
  await c.send('Runtime.enable');
  return c;
}
const js = (c, expr) => c.evaluate('(async function(){ try { return await (' + expr + '); } catch (err) { return { __err: String((err && (err.stack || err.message)) || err).slice(0, 1200) }; } })()', { timeout: 360000 });
function unerr(x, what) {
  if (x && x.__err) throw new Error(`${what} 抛错：${x.__err}`);
  return x;
}

async function setUpProfile(profile) {
  fs.mkdirSync(profile, { recursive: true });
  const promptSizes = seedOverCapPrompts(profile);
  const instances = NIUMAS.map((n) => ({
    id: n.id, ming: n.ming, name: n.ming,
    status: 'running', dutyEligible: true, notify: true,
    model: n.model, defaultModel: n.model, chain: [n.model], chainDisabled: [],
    persona: '你是项目里的执行牛马。需要用工具时真的去做；完成必须交回可核实的产物与结论；不许假装完成。',
  }));
  const settings = {
    yuYan: 'zh-CN', setupDone: true, privacyConsent: true, guideDone: true, guideChatDone: true, providersSeeded: true,
    timezone: 'Asia/Shanghai',
    providers: Object.values(PROVIDERS).map((p) => ({
      id: p.id, biaoQian: p.biaoQian, protocol: p.protocol, baseURL: p.baseURL,
      models: p.models, defaultModel: '', staleModels: [],
      hasKey: p.id !== 'ollama',
    })),
    modelCaps: Object.fromEntries(NIUMAS.map((n) => [n.model, {
      contextLen: n.provider === 'ollama' ? 32768 : 128000, kind: 'chat', tools: true, vision: false,
    }])),
    specialModels: { chatChain: [MI], organizerChain: [MI] },
    instances,
    activeProvider: { presetId: 'mimo', baseURL: PROVIDERS.mimo.baseURL, model: MI, protocol: 'openai-compatible' },
    contextBudgetPercent: 60, modelContextTokens: 128000, contextToolMaxRounds: 4, autoSummary: true,
    globalSecurity: 'normal', askOnExceed: false,
  };
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify(settings, null, 2), 'utf8');
  return { promptSizes };
}

async function verifyPromptCompression(c, profile, bootTs) {
  // 启动自检在 yindao 之后跑；给 30 秒落盘
  for (let i = 0; i < 150; i++) {
    const au = readAudit(profile);
    const shu = eventsOf(au, 'prompt.compressed', '', bootTs).filter((e) => e.detail?.ceng === '术');
    const yin = eventsOf(au, 'prompt.compressed', '', bootTs).filter((e) => e.detail?.ceng === '印象');
    if (shu.length && yin.length) {
      const shuTxt = fs.existsSync(path.join(profile, 'shu.md')) ? fs.readFileSync(path.join(profile, 'shu.md'), 'utf8') : '';
      const yinTxt = fs.existsSync(path.join(profile, 'yinxiang.md')) ? fs.readFileSync(path.join(profile, 'yinxiang.md'), 'utf8') : '';
      jian('提示词压缩：术层压回上限', shuTxt.length <= 4200, `压缩后 ${shuTxt.length} 字`);
      jian('提示词压缩：印象层压回上限', yinTxt.length <= 2600, `压缩后 ${yinTxt.length} 字`);
      jian('提示词压缩：术层关键要点未丢', shuTxt.includes('MUST-KEEP-SHU-R103'));
      jian('提示词压缩：印象层关键要点未丢', yinTxt.includes('MUST-KEEP-YIN-R103'));
      jian('提示词压缩：没有压不动就放弃', !eventsOf(au, 'prompt.still-over-cap', '', bootTs).length);
      return { shu, yin, sizes: { shu: shuTxt.length, yin: yinTxt.length } };
    }
    await sleep(200);
  }
  throw new Error('等待 prompt.compressed（术/印象）超时');
}

async function createProjects(c, profile) {
  const out = [];
  for (const p of PROJECTS) {
    const code = (p.key + rand6() + rand6()).replace(/[^A-Z0-9]/g, '').slice(0, 8);
    p.code = code;
    const created = unerr(await js(c, `window.warmy.groupCreate({ groupId: ${JSON.stringify(p.id)}, ming: ${JSON.stringify(p.ming)}, type: 'internal', directedMode: false, devEnv: 'host' })`), 'groupCreate');
    jian(`项目 ${p.key} 创建成功`, created?.ok === true, JSON.stringify(created).slice(0, 300));
    for (const id of p.members) {
      const r = unerr(await js(c, `window.warmy.groupJoinInstance(${JSON.stringify(p.id)}, ${JSON.stringify(id)})`), 'groupJoinInstance');
      jian(`项目 ${p.key} 加入 ${id}`, r?.ok === true);
    }
    const mem = [
      `【项目知识库】`,
      `验收码：${code}`,
      `项目：${p.ming}`,
      `规则：值班者必须把任务完整交给执行者；执行者必须真的写文件并用 jiao_fu 交付绝对路径；回复必须逐个汇报执行者与产物。`,
      `背景：本项目由 ${p.members.length} 只牛马协作，所有产物落在本项目工作区，互不覆盖。`,
      `补充：本项目的验收码只存在于项目记忆中，用户消息不会重复它；执行者必须从项目记忆里读取并写进产物。`,
      ...Array.from({ length: 12 }, (_, i) => `补充约定 ${i + 1}：${p.key} 项目第 ${i + 1} 条协作约定，保持产物可读、可核实、可回读。`),
    ].join('\n');
    const set = unerr(await js(c, `window.warmy.projectMemorySet({ sessionId: ${JSON.stringify(p.id)}, memory: ${JSON.stringify(mem)} })`), 'projectMemorySet');
    jian(`项目 ${p.key} 知识库写入并回读`, set?.ok === true && set?.readBack !== false, JSON.stringify(set).slice(0, 300));
    // 纯调度成员：只标 pureDispatcher，不参与执行；随后再设真正值班者覆盖 fixedDuty
    for (const id of (p.pure || [])) {
      const r = unerr(await js(c, `window.warmy.groupSetDuty({ groupId: ${JSON.stringify(p.id)}, instanceId: ${JSON.stringify(id)}, pureDispatcher: true })`), 'groupSetPure');
      jian(`项目 ${p.key} ${id} 设为纯调度`, r?.ok === true);
    }
    const dutyOrder = shuffle(p.members);
    p.dutyOrder = [...dutyOrder, ...dutyOrder];
    const d0 = unerr(await js(c, `window.warmy.groupSetDuty({ groupId: ${JSON.stringify(p.id)}, instanceId: ${JSON.stringify(p.dutyOrder[0])} })`), 'groupSetDuty');
    jian(`项目 ${p.key} 初始值班设置`, d0?.ok === true && d0?.dutyId === p.dutyOrder[0], JSON.stringify(d0).slice(0, 200));
    const duty = unerr(await js(c, `window.warmy.groupDuty(${JSON.stringify(p.id)})`), 'groupDuty');
    jian(`项目 ${p.key} 成员数为 5`, Array.isArray(duty?.members) && duty.members.length === 5, String(duty?.members?.length));
    out.push(p);
  }
  return out;
}

/**
 * 每轮把值班者随机轮换到 5 只牛马中的一只，同时保证**恰好 2 个执行者**：
 *  · 值班者是基础纯调度成员 ⇒ 临时再纯调度一只可执行成员（否则 3 个执行者全上）；
 *  · 值班者是可执行成员 ⇒ 另外 2 个可执行成员执行。
 * 5 只牛马都会轮到值班；纯调度成员不参与执行。
 */
async function applyDuty(c, p, round) {
  const duty = p.dutyOrder[(round - 1) % p.members.length];
  const basePure = p.pure || [];
  const nonPure = p.members.filter((id) => !basePure.includes(id));
  const tempPure = basePure.includes(duty) ? (nonPure[nonPure.length - 1] || '') : '';
  for (const id of p.members) {
    const pure = basePure.includes(id) || id === tempPure;
    const r = unerr(await js(c, `window.warmy.groupSetDuty({ groupId: ${JSON.stringify(p.id)}, instanceId: ${JSON.stringify(id)}, pureDispatcher: ${pure} })`), 'groupSetDuty/pure');
    jian(`R${round} ${p.key} ${id} 调度标记`, r?.ok === true);
  }
  const d = unerr(await js(c, `window.warmy.groupSetDuty({ groupId: ${JSON.stringify(p.id)}, instanceId: ${JSON.stringify(duty)} })`), 'groupSetDuty');
  jian(`R${round} ${p.key} 值班轮换生效`, d?.ok === true && d?.dutyId === duty, JSON.stringify(d).slice(0, 300));
  p.currentDuty = duty;
  p.tempPure = tempPure;
  return duty;
}

const ROUND_THEMES = ['春分', '夏至', '秋分', '冬至', '星河', '潮汐', '松风', '灯火', '远山', '归途'];

function roundContent(p, round, token) {
  const theme = ROUND_THEMES[(round - 1) % ROUND_THEMES.length];
  const base = `第 ${round} 轮任务（本轮主题：${theme}）：请每位执行者各自创建一个文本文件。`
    + `文件名由 项目ID、轮次、你的牛马名 三段组成，扩展名用 txt。`
    + `正文第一行写项目记忆中的验收码（只从项目记忆里找，用户消息没有它）；第二行写本轮标记 ${token}；第三行写本轮主题 ${theme}；第四行写你的牛马名。`
    + `完成后用 jiao_fu 提交产物绝对路径。`;
  if (round !== 4) return base;
  const pad = Array.from({ length: 700 }, (_, i) => `背景资料 ${i + 1}：这是一段与任务无关的长背景，用来验证上下文压缩不会把真正的指令挤掉。`).join(' ');
  return base + '\n\n' + pad;
}

async function runWave(c, projects, round) {
  const calls = projects.map((p) => {
    const token = `${p.key}-R${String(round).padStart(2, '0')}-${rand6()}`;
    p.lastToken = token;
    return { p, token, payload: { groupId: p.id, content: roundContent(p, round, token), urgency: 'P2' } };
  });
  // 与界面发送同一条记账路径：用户气泡先落主进程日志（tuisongXiaoxi -> chatLogAppend）
  for (const { p, payload } of calls) {
    const lr = unerr(await js(c, `window.warmy.chatLogAppend({ sessionId: ${JSON.stringify(p.id)}, role: 'user', content: ${JSON.stringify(payload.content)} })`), 'chatLogAppend/user');
    jian(`R${round} ${p.key} 用户消息落日志`, lr?.ok === true);
  }
  const expr = `(async function(){
    const xs = ${JSON.stringify(calls.map((x) => x.payload))};
    const out = new Array(xs.length);
    let next = 0;
    let stop = false;
    async function worker() {
      for (;;) {
        if (stop) return;
        const i = next++;
        if (i >= xs.length) return;
        const x = xs[i];
        await new Promise((r) => setTimeout(r, i * 120));
        try {
          out[i] = { groupId: x.groupId, r: await window.warmy.groupOrchestrate(x) };
          if (!out[i].r || out[i].r.ok !== true || out[i].r.action !== 'dispatch') stop = true;
        } catch (e) {
          out[i] = { groupId: x.groupId, err: String((e && (e.stack || e.message)) || e) };
          stop = true;
        }
      }
    }
    // 10 个项目分批派发（默认 2 个并发）。首个意外失败立即停止新派发，已在途的收敛后返回。
    await Promise.all(Array.from({ length: ${BATCH} }, () => worker()));
    return out;
  })()`;
  const waveTs = Date.now();
  for (const p of projects) p.finalTs = waveTs;
  let results;
  try {
    results = await c.evaluate(expr, { timeout: 600000 });
  } catch (e) {
    throw new Error(`第 ${round} 轮分批派发失败：${String(e?.message || e).slice(0, 500)}`);
  }
  if (!Array.isArray(results)) throw new Error(`第 ${round} 轮返回不是数组：${JSON.stringify(results).slice(0, 500)}`);
  /**
   * 只有**明确可归因于供应商瞬时故障**（429/5xx/超时/连接重置）才允许重派，最多 3 次。
   * 缺产物、业务错误、无返回一律不重派 —— 否则就是用重派掩盖首发失败。
   * 每次尝试都记录；重派次数在日志与汇总里可见。
   */
  const linShi = /MODEL_UNAVAILABLE|PROTO_TIMEOUT|HTTP (429|5\d\d)|timeout|fetch failed|ECONNRESET|socket hang up/i;
  for (const { p, payload } of calls) {
    let got = results.find((x) => x.groupId === p.id);
    const attempts = [];
    for (let shi = 0; shi < 3; shi++) {
      const errText = String(got?.err || '');
      const yiChuCuo = (got?.r?.zhengLiu || []).find((x) => x.error && linShi.test(String(x.error)));
      const shunShi = linShi.test(errText) || !!yiChuCuo;
      if (!shunShi) break;
      attempts.push({ attempt: shi + 1, err: errText.slice(0, 200) || String(yiChuCuo?.error || '').slice(0, 200) });
      p.retries = (p.retries || 0) + 1;
      p.retryReasons = p.retryReasons || [];
      p.retryReasons.push(attempts[attempts.length - 1]);
      console.log(`  run ${p.runTag || ''} R${round} ${p.key} 供应商瞬时故障，记录重派 ${shi + 1}/3：${attempts[attempts.length - 1].err}`);
      await sleep(1500 + shi * 1500);
      p.finalTs = Date.now();
      const rr = await c.evaluate(`window.warmy.groupOrchestrate(${JSON.stringify(payload)}).then((r) => ({ groupId: ${JSON.stringify(p.id)}, r })).catch((e) => ({ groupId: ${JSON.stringify(p.id)}, err: String((e && (e.stack || e.message)) || e) }))`, { timeout: 360000 });
      got = rr;
      if (got?.r?.ok === true && got.r.action === 'dispatch' && (got.r.zhengLiu || []).every((x) => !x.error)) break;
    }
    if (attempts.length) {
      console.log(`  run ${p.runTag || ''} R${round} ${p.key} 重派记录：${attempts.length} 次（全部保留在 p.retryReasons）`);
    }
    const idx = results.findIndex((x) => x.groupId === p.id);
    if (idx >= 0) results[idx] = got;
  }
  const audit = readAudit(projects[0].profile);
  for (const { p, token } of calls) {
    const got = results.find((x) => x.groupId === p.id);
    if (!got) throw new Error(`第 ${round} 轮 ${p.key} 没有返回`);
    if (got.err) throw new Error(`第 ${round} 轮 ${p.key} 抛错：${got.err.slice(0, 800)}`);
    const r = got.r;
    jian(`R${round} ${p.key} 派发成功`, r?.ok === true && r?.action === 'dispatch', JSON.stringify(r).slice(0, 500));
    jian(`R${round} ${p.key} 值班者正确`, r?.dutyId === p.currentDuty, `dutyId=${r?.dutyId} 期望=${p.currentDuty}`);
    jian(`R${round} ${p.key} 确实委派了 2 个执行者`, Array.isArray(r?.executorIds) && r.executorIds.length === 2, JSON.stringify(r?.executorIds));
    jian(`R${round} ${p.key} 执行者不含值班者`, !(r?.executorIds || []).includes(r?.dutyId));
    jian(`R${round} ${p.key} 每个执行者都有蒸馏结果`, Array.isArray(r?.zhengLiu) && r.zhengLiu.length === r.executorIds.length, `${r?.zhengLiu?.length}/${r?.executorIds?.length}`);
    const done = (r.zhengLiu || []).filter((x) => !x.error);
    jian(`R${round} ${p.key} 执行者全部完成（无崩溃）`, done.length === 2, JSON.stringify(r.zhengLiu || []).slice(0, 800));
    jian(`R${round} ${p.key} 执行者都有产物`, done.every((x) => Array.isArray(x.artifacts) && x.artifacts.length > 0), JSON.stringify(done).slice(0, 800));
    const unv = done.flatMap((x) => (x.unverified || []).map(String));
    const duLi = (wen, ming) => {
      if (!ming) return false;
      if (/[\\/]/.test(ming)) return wen.includes(ming);
      const esc = ming.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp('(^|[\\s`"（(【])' + esc + '(?=$|[\\s`"）)】,，。;；])').test(wen);
    };
    /**
     * “没找到/未核实”的警告行本身会写出那个路径，不能算“冒充真产物”；
     * 只检查去掉这些警告行后的正文，若仍把未核实路径当真产物才判红。
     */
    const jingGao = /没找到|未核实|未验证|unverified|not\s*found|说产出了但没找到/i;
    const replyZhengWen = String(r.reply || '').split('\n').filter((line) => !jingGao.test(line)).join('\n');
    jian(`R${round} ${p.key} 未核实产物没有冒充真产物`, unv.every((u) => !duLi(replyZhengWen, u) && !duLi(replyZhengWen, path.basename(u))), JSON.stringify({ unv, reply: String(r.reply || '').slice(0, 600) }));
    const texts = [];
    for (const x of done) {
      for (const f of x.artifacts) {
        const pth = String(f);
        jian(`R${round} ${p.key} 产物存在`, fs.existsSync(pth), pth);
        const body = fs.readFileSync(pth, 'utf8');
        texts.push({ ming: x.ming, path: pth, body });
      }
    }
    jian(`R${round} ${p.key} 使用了项目知识库验收码`, texts.length > 0 && texts.every((x) => x.body.includes(p.code)), `code=${p.code} bodies=${texts.map((x) => x.body.slice(0, 80)).join(' | ').slice(0, 600)}`);
    const theme = ROUND_THEMES[(round - 1) % ROUND_THEMES.length];
    jian(`R${round} ${p.key} 写入了本轮主题 ${theme}`, texts.length > 0 && texts.every((x) => x.body.includes(theme)), `theme=${theme} bodies=${texts.map((x) => x.body.slice(0, 120)).join(' | ').slice(0, 600)}`);
    jian(`R${round} ${p.key} 写入了本轮标记`, texts.length > 0 && texts.every((x) => x.body.includes(token)), `token=${token}`);
    // 逐执行者：每个执行者自己的产物必须独立含有验收码/主题/标记，不能一个正确文件替另一个空文件过关
    for (const x of done) {
      const own = texts.filter((t) => t.ming === x.ming);
      jian(`R${round} ${p.key} ${x.ming} 自己的产物带验收码`, own.length > 0 && own.every((t) => t.body.includes(p.code)), own.map((t) => t.body.slice(0, 80)));
      jian(`R${round} ${p.key} ${x.ming} 自己的产物带本轮主题`, own.length > 0 && own.every((t) => t.body.includes(theme)), own.map((t) => t.body.slice(0, 80)));
      jian(`R${round} ${p.key} ${x.ming} 自己的产物带本轮标记`, own.length > 0 && own.every((t) => t.body.includes(token)), own.map((t) => t.body.slice(0, 80)));
    }
    jian(`R${round} ${p.key} 值班者回复逐个汇报执行者`, done.every((x) => String(r.reply || '').includes(x.ming)), String(r.reply || '').slice(0, 800));
    jian(`R${round} ${p.key} 值班者回复带产物`, done.every((x) => String(r.reply || '').includes(path.basename(x.artifacts[0]))), String(r.reply || '').slice(0, 800));
    jian(`R${round} ${p.key} 任务黑板有账`, Number(r?.renWuHeiBan?.tiaoShu || 0) >= done.length, JSON.stringify(r?.renWuHeiBan));
    jian(`R${round} ${p.key} 黑板已落盘`, Number(r?.renWuHeiBan?.yiLuoPan || 0) > 0, JSON.stringify(r?.renWuHeiBan));
    const ctx = eventsOf(audit, 'group.executor-context', p.id, p.finalTs || waveTs);
    jian(`R${round} ${p.key} 每个执行者都记了上下文尺寸`, ctx.length >= r.executorIds.length, `${ctx.length}/${r.executorIds.length}`);
    jian(`R${round} ${p.key} 执行者提示词有界`, ctx.every((e) => Number(e.detail?.promptChars || 0) <= 16000), JSON.stringify(ctx.map((e) => e.detail)).slice(0, 800));
    if (round === 4) {
      jian(`R4 ${p.key} 超长输入确实被压缩`, ctx.some((e) => Number(e.detail?.yuanWenChars || 0) >= 20000), JSON.stringify(ctx.map((e) => e.detail)).slice(0, 800));
      jian(`R4 ${p.key} 压缩后提示有界`, ctx.every((e) => Number(e.detail?.promptChars || 0) <= 16000), JSON.stringify(ctx.map((e) => e.detail)).slice(0, 800));
      jian(`R4 ${p.key} 任务 brief 被压到短版`, ctx.every((e) => Number(e.detail?.briefChars || 0) <= 2000), JSON.stringify(ctx.map((e) => e.detail)).slice(0, 800));
    }
    const doneAudit = eventsOf(audit, 'group.executor-done', p.id, p.finalTs || waveTs);
    jian(`R${round} ${p.key} 执行留痕完整`, doneAudit.length >= r.executorIds.length, `${doneAudit.length}/${r.executorIds.length}`);
    jian(`R${round} ${p.key} 执行留痕无错误`, doneAudit.every((e) => !e.detail?.error), JSON.stringify(doneAudit.filter((e) => e.detail?.error).map((e) => e.detail)).slice(0, 800));
    const workAudit = eventsOf(audit, 'group.work-tool', p.id, p.finalTs || waveTs);
    jian(`R${round} ${p.key} 真的调用了写文件工具`, workAudit.some((e) => e.detail?.ok === true && /write_file|edit_file|append_file/.test(String(e.detail?.tool || ''))), JSON.stringify(workAudit.map((e) => e.detail)).slice(0, 800));
    const dutyAfter = unerr(await js(c, `window.warmy.groupDuty(${JSON.stringify(p.id)})`), 'groupDuty');
    jian(`R${round} ${p.key} 轮末回到空闲`, dutyAfter?.state === 'idle', JSON.stringify(dutyAfter?.state));
    p.lastReply = String(r.reply || '');
    p.lastArtifacts = done.flatMap((x) => x.artifacts);
    const ar = unerr(await js(c, `window.warmy.chatLogAppend({ sessionId: ${JSON.stringify(p.id)}, role: 'assistant', content: ${JSON.stringify(String(r.reply || ''))} })`), 'chatLogAppend/assistant');
    jian(`R${round} ${p.key} 值班者回复落日志`, ar?.ok === true);
  }
  return { waveTs, results };
}

async function verifyChatLog(c, projects, expectRounds) {
  for (const p of projects) {
    const log = unerr(await js(c, `window.warmy.chatMessages({ sessionId: ${JSON.stringify(p.id)}, limit: 1000 })`), 'chatMessages');
    jian(`项目 ${p.key} 对话日志存在`, log?.ok === true && Array.isArray(log.xiaoXiJi), JSON.stringify(log).slice(0, 300));
    const users = log.xiaoXiJi.filter((m) => m.role === 'user');
    const assistants = log.xiaoXiJi.filter((m) => m.role === 'assistant');
    jian(`项目 ${p.key} 记满 ${expectRounds} 轮用户消息`, users.length >= expectRounds, `users=${users.length}`);
    jian(`项目 ${p.key} 记满 ${expectRounds} 轮回复`, assistants.length >= expectRounds, `assistants=${assistants.length}`);
    for (let r = 1; r <= expectRounds; r++) {
      const prefix = `${p.key}-R${String(r).padStart(2, '0')}-`;
      jian(`项目 ${p.key} 第 ${r} 轮标记进了历史`, users.some((m) => String(m.text || '').includes(prefix)), `prefix=${prefix}`);
    }
    jian(`项目 ${p.key} 回复非空`, assistants.every((m) => String(m.text || '').trim().length > 0));
  }
}

async function verifyWorkspace(projects) {
  for (const p of projects) {
    const dir = path.join(p.profile, 'workspace', p.id);
    const files = fileTexts(dir);
    const txt = Object.entries(files).filter(([f]) => /\.txt$/i.test(f));
    // 模型可能给不同轮次复用同一个文件名（后来的覆盖前面的）⇒ 不按文件数判，按“每轮标记是否还在”判
    jian(`项目 ${p.key} 工作区有产物`, txt.length >= 10, `txt=${txt.length}`);
    jian(`项目 ${p.key} 工作区产物含验收码`, txt.some(([, b]) => b.includes(p.code)));
    for (let r = 1; r <= ROUNDS; r++) {
      const prefix = `${p.key}-R${String(r).padStart(2, '0')}-`;
      jian(`项目 ${p.key} 第 ${r} 轮产物留在工作区`, txt.some(([, b]) => b.includes(prefix)), `prefix=${prefix}`);
    }
  }
}

async function runOnce(run) {
  const port = 9900 + run;
  const profile = path.join(os.tmpdir(), `warmy-r103-10x10-${Date.now()}-${run}`);
  const promptSizes = (await setUpProfile(profile)).promptSizes;
  const bootTs = Date.now();
  let child = launch(profile, port);
  let c = null;
  try {
    c = await connect(port);
    await waitBoot(c);
    // 密钥只进 SecureKeyStore，不打印
    for (const [id, key] of Object.entries(KEY)) {
      const r = unerr(await js(c, `window.warmy.providerKeySet({ providerId: ${JSON.stringify(id)}, apiKey: ${JSON.stringify(key)} })`), 'providerKeySet');
      jian(`运行 ${run}：${id} 密钥可用`, r?.ok === true, JSON.stringify(r).slice(0, 200));
    }
    const sp = unerr(await js(c, `window.warmy.setProvider({ presetId: 'mimo', baseURL: ${JSON.stringify(PROVIDERS.mimo.baseURL)}, protocol: 'openai-compatible', model: ${JSON.stringify(MI)} })`), 'setProvider');
    jian(`运行 ${run}：值班供应商可用`, sp?.ok === true && sp?.providerCfg?.apiKey === '***', JSON.stringify(sp).slice(0, 200));
    const inst = await waitTenRunning(c);
    jian(`运行 ${run}：10 只牛马都在运行`, inst.length === 10);

    const comp = await verifyPromptCompression(c, profile, bootTs);
    console.log(`  run ${run} 提示词压缩：术 ${promptSizes.shu}→${comp.sizes.shu}，印象 ${promptSizes.yin}→${comp.sizes.yin}`);

    const projects = await createProjects(c, profile);
    for (const p of projects) p.profile = profile;
    const roundTimes = [];
    for (let round = 1; round <= ROUNDS; round++) {
      const rt0 = Date.now();
      for (const p of projects) await applyDuty(c, p, round);
      await runWave(c, projects, round);
      roundTimes.push(Date.now() - rt0);
      console.log(`  run ${run} R${String(round).padStart(2, '0')} 10/10 项目，${(roundTimes[roundTimes.length - 1] / 1000).toFixed(1)}s`);
    }
    await verifyChatLog(c, projects, ROUNDS);
    await verifyWorkspace(projects);
    for (const p of projects) {
      const d = unerr(await js(c, `window.warmy.groupDuty(${JSON.stringify(p.id)})`), 'groupDuty');
      jian(`项目 ${p.key} 最终值班态可读`, d?.ok === true && d?.members?.length === 5, JSON.stringify(d).slice(0, 300));
    }

    // 重启：历史必须还在
    killTree(child);
    await waitPortClosed(port);
    child = launch(profile, port);
    c = await connect(port);
    await waitBoot(c);
    const sp2 = unerr(await js(c, `window.warmy.setProvider({ presetId: 'mimo', baseURL: ${JSON.stringify(PROVIDERS.mimo.baseURL)}, protocol: 'openai-compatible', model: ${JSON.stringify(MI)} })`), 'setProvider(restart)');
    jian(`运行 ${run}：重启后供应商可恢复`, sp2?.ok === true);
    const inst2 = await waitTenRunning(c);
    jian(`运行 ${run}：重启后 10 只牛马仍在`, inst2.length === 10);
    await verifyChatLog(c, projects, ROUNDS);
    const au2 = readAudit(profile);
    const restore = au2.filter((e) => e.op === 'chat.history.restore' && e.ts > bootTs).slice(-1)[0];
    jian(`运行 ${run}：重启恢复日志有记录`, !!restore && Number(restore.detail?.entries || 0) >= 20, JSON.stringify(restore?.detail || {}).slice(0, 300));
    for (const p of projects) {
      const d = unerr(await js(c, `window.warmy.groupDuty(${JSON.stringify(p.id)})`), 'groupDuty(restart)');
      jian(`运行 ${run}：重启后项目 ${p.key} 成员恢复`, d?.ok === true && d?.members?.length === 5, JSON.stringify(d).slice(0, 300));
    }
    console.log(`  run ${run} 重启后历史与成员恢复通过`);
    killTree(child);
    await waitPortClosed(port);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
    return { run, ms: Date.now() - t0All, rounds: roundTimes };
  } catch (e) {
    failure = { run, message: String(e?.message || e), profile, at: Date.now() };
    try { killTree(child); } catch { /* noop */ }
    try {
      const dump = path.join(os.tmpdir(), `warmy-r103-failure-${run}-${Date.now()}.json`);
      fs.writeFileSync(dump, JSON.stringify({ run, error: String(e?.stack || e), profile, auditTail: readAudit(profile).slice(-40), gate: e?.__gateName || '' }, null, 2), 'utf8');
      failure.dump = dump;
    } catch { /* noop */ }
    throw e;
  }
}

cleanOldProfiles();
console.log(`R103 项目验收：${NIUMAS.length} 牛马 × ${PROJECT_COUNT} 项目 × ${ROUNDS} 轮 × 连续 ${RUNS} 遍`);
const inv = await inventoryModels();
console.log(`  模型盘点：${Object.entries(PROVIDERS).map(([id, p]) => `${id}=${p.models.length}`).join(', ')}`);
for (let run = 1; run <= RUNS; run++) {
  const r = await runOnce(run);
  console.log(`RUN ${run}/${RUNS} PASS（累计 ${(r.ms / 1000).toFixed(1)}s，轮时 ${r.rounds.map((x) => (x / 1000).toFixed(1)).join('/')}s）`);
}
console.log(`ALL ${RUNS} RUNS PASS，共 ${assertionCount} 条断言，用时 ${((Date.now() - t0All) / 1000).toFixed(1)}s`);
process.exit(0);
