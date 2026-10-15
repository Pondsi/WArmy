/**
 * 第 18 轮 C：验证「配了 MiMo 却用 Ollama / 反复授权 / 计划卡不生成 / 任务完不成」。
 * 真实 MiMo + Ollama 在场；连续 3 轮。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PKG = path.join(ROOT, 'packages', 'app-shell');
const ROUND = (() => { const i = process.argv.indexOf('--round'); return i >= 0 ? String(process.argv[i + 1] || '1') : '1'; })();
const PORT = 9730 + (Number(ROUND) || 1);
const DATA = path.join(process.env.APPDATA || '', '@warmy', 'app-shell');
const MARK = `R18C-${ROUND}-${Date.now().toString(36)}`;
const key = (() => {
  const k = String(process.env.MIMO_KEY || '').trim();
  if (k) return k;
  const f = String(process.env.MIMO_KEY_FILE || '').trim();
  if (f) { try { return fs.readFileSync(f, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || ''; } catch { /* */ } }
  return '';
})();
if (!key) { console.error('need MIMO_KEY_FILE'); process.exit(2); }

const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'huihui_ai/qwen3-vl-abliterated:4b';

try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* */ }
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(path.join(DATA, 'secure'), { recursive: true });
fs.writeFileSync(path.join(DATA, 'secure', 'keys.enc.json'), JSON.stringify({
  'mimo-r18c': { v: 2, protector: 'plain', data: Buffer.from(key, 'utf8').toString('base64') },
}), 'utf8');

const s = {
  yuYan: 'zh-CN', setupDone: true, guideDone: true, privacyConsent: true, providersSeeded: true,
  asrEnabled: true, asrLang: 'auto', globalSecurity: 'normal', askOnExceed: true,
  autoSelectRecommended: true,
  providers: [
    {
      id: 'ollama-r18c', biaoQian: 'Ollama(r18c)', protocol: 'ollama', baseURL: 'http://127.0.0.1:11434',
      defaultModel: OLLAMA_MODEL, models: [OLLAMA_MODEL], staleModels: {}, hasKey: false,
    },
    {
      id: 'mimo-r18c', biaoQian: 'MiMo(r18c)', protocol: 'openai-compatible',
      baseURL: 'https://token-plan-cn.xiaomimimo.com/v1',
      defaultModel: 'mimo-v2.5', models: ['mimo-v2.5', 'mimo-v2.5-asr', 'mimo-v2.6-flash'],
      staleModels: {}, hasKey: true,
    },
  ],
  specialModels: {
    // 白名单同时含复合名与裸 id，验证归一匹配
    chatChain: [`MiMo(r18c) · mimo-v2.5`, `Ollama(r18c) · ${OLLAMA_MODEL}`, 'mimo-v2.5', OLLAMA_MODEL],
  },
  instances: [{
    id: 'inst-r18c', ming: '牛马-1', name: '牛马-1', status: 'running',
    // 用户配置的是 MiMo
    model: 'mimo-v2.5',
    defaultModel: 'mimo-v2.5',
    availableModels: ['mimo-v2.5', `Ollama(r18c) · ${OLLAMA_MODEL}`],
    chain: ['mimo-v2.5', `Ollama(r18c) · ${OLLAMA_MODEL}`],
    chainDisabled: [], smartMode: false, allModels: true,
    currentModel: '',
    avatarPreset: 1, avatarDataUrl: '',
  }],
  modelCaps: {
    'mimo-v2.5': { kind: 'chat', tools: true, vision: 'unknown', contextLen: 32768 },
    [OLLAMA_MODEL]: { kind: 'chat', tools: true, vision: true, contextLen: 32768 },
    'mimo-v2.5-asr': { kind: 'asr', tools: false, vision: false, mediaFormats: ['wav', 'mp3'] },
  },
};
fs.writeFileSync(path.join(DATA, 'settings.json'), JSON.stringify(s, null, 2), 'utf8');

const env = { ...process.env, MIMO_KEY: key };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(path.join(PKG, 'node_modules', 'electron', 'dist', 'electron.exe'),
  [`--remote-debugging-port=${PORT}`, path.join(PKG, 'dist', 'electron-main.js')],
  { cwd: PKG, stdio: ['ignore', 'pipe', 'pipe'], env });
const logs = [];
child.stdout.on('data', (d) => logs.push(String(d)));
child.stderr.on('data', (d) => logs.push(String(d)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WebSocket = globalThis.WebSocket;
let pass = true;
const failures = [];
function ok(name, cond, extra = '') {
  if (cond) console.log(`  ok  ${name}${extra ? ' — ' + extra : ''}`);
  else { pass = false; failures.push(name); console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
}
function auditSince(since) {
  try {
    const f = path.join(DATA, 'audit', 'audit.jsonl');
    if (!fs.existsSync(f)) return [];
    return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((x) => x && x.ts >= since);
  } catch { return []; }
}

async function main() {
  await sleep(3000);
  let wsUrl = '';
  for (let i = 0; i < 24; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      const page = list.find((x) => x.type === 'page');
      if (page) { wsUrl = page.webSocketDebuggerUrl; break; }
    } catch { /* */ }
    await sleep(500);
  }
  if (!wsUrl) { console.error('no CDP'); child.kill(); process.exit(1); }
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let mid = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((res) => {
    const id = ++mid; pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const ev = async (expr, timeoutMs = 60000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      const v = r?.result?.result?.value;
      if (v !== undefined && v !== null && v !== false && v !== '') return v;
      await sleep(400);
    }
    return null;
  };

  console.log(`\n===== R18C ROUND ${ROUND} mark=${MARK} =====`);
  const t0 = Date.now();
  await ev(`document.readyState==='complete' && !!window.warmy`, 30000);
  await sleep(2000);
  await ev(`(()=>{document.querySelector('[data-nav="singleAi"]')?.click();return true})()`, 8000);
  await sleep(1000);
  await ev(`(()=>{
    const rows=[...document.querySelectorAll('[data-sid],.lieBiaoTiaoMu')];
    const r=rows.find(x=>/牛马/.test(x.textContent||''))||rows[0];
    if(r) r.click(); return true;
  })()`, 8000);
  await sleep(1000);

  const since = Date.now();
  // 多步任务：生成两个文件（触发计划 + 授权 + 完成）
  const sent = await ev(`(async ()=>{
    try {
      const r = await window.warmy.chatSend({
        sessionId: 'inst-r18c',
        content: '请做两件事：1) 在工作区生成 a-${MARK}.txt 内容写 A-${MARK}；2) 在工作区生成 b-${MARK}.txt 内容写 B-${MARK}。做完后简单确认。',
        ming: '牛马-1', thinkLevel: 'auto', xiaoDiShuLiang: 0,
        moXingJueCe: { urgency: 'P2', defaultModel: 'mimo-v2.5', chain: ['mimo-v2.5'], chainDisabled: [] },
      });
      return !!(r && (r.ok || r.reply));
    } catch (e) { return 'err:' + (e && e.message); }
  })()`, 240000);
  ok('消息已发送', sent === true, String(sent).slice(0, 60));

  let sawMimo = false, sawOllamaOnly = false, sawPlan = false, sawWrite = false, sawDone = false;
  let planSteps = 0, authPops = 0, authPass = 0;
  for (let i = 0; i < 90; i++) {
    await ev(`(()=>{
      document.querySelectorAll('.aiqKa button').forEach((b) => {
        const t = (b.textContent || '');
        if (/同意|允许|本次允许|推荐|继续|确定/.test(t)) { try { b.click(); } catch {} }
      });
      return 1;
    })()`, 2000).catch(() => null);
    const au0 = auditSince(since);
    const picks = au0.filter((x) => x.op === 'chat.model-picked');
    if (picks.some((x) => /mimo/i.test(String(x.detail?.model || '')))) sawMimo = true;
    // 若第一轮就完全没碰 mimo、只用 ollama ⇒ 问题
    if (picks.length && picks.every((x) => /ollama|qwen/i.test(String(x.detail?.model || '')))) sawOllamaOnly = true;
    if (au0.some((x) => x.op === 'plan.host-seed' || (x.detail && x.detail.tool === 'plan_update'))) sawPlan = true;
    const writes = au0.filter((x) => x.op === 'chat.work-tool' && x.detail && x.detail.tool === 'write_file' && x.detail.ok !== false);
    if (writes.length) sawWrite = true;
    if (au0.some((x) => x.op === 'chat.tools.done')) sawDone = true;
    try {
      const plans = JSON.parse(fs.readFileSync(path.join(DATA, 'plans.json'), 'utf8'));
      planSteps = ((plans.plans || {})['inst-r18c'] || []).length;
    } catch { /* */ }
    authPops = au0.filter((x) => x.op === 'aiq.open' || x.op === 'auth.request').length;
    authPass = au0.filter((x) => x.op === 'auth.auto-pass').length;
    if (sawWrite && sawDone && planSteps > 0) break;
    if (sawDone && i > 20) break;
    await sleep(2000);
  }

  ok('使用了配置的 MiMo 模型', sawMimo);
  ok('不是只用 Ollama', !sawOllamaOnly || sawMimo);
  ok('计划卡有步骤', planSteps > 0, `steps=${planSteps}`);
  ok('plan_update/host-seed 有记录', sawPlan);
  ok('write_file 成功', sawWrite);
  ok('工具循环已结束', sawDone);

  // 两个文件落盘
  let fa = false, fb = false;
  const walk = (d) => {
    try {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name);
        if (f.isDirectory()) walk(p);
        else {
          if (f.name.includes(`a-${MARK}`)) fa = true;
          if (f.name.includes(`b-${MARK}`)) fb = true;
        }
      }
    } catch { /* */ }
  };
  walk(path.join(DATA, 'workspace'));
  ok('a 文件落盘', fa);
  ok('b 文件落盘', fb);

  // 授权：auto-pass 应≥0，但同一目录第二次不应弹新卡（用 auth.auto-pass 观察）
  ok('授权未失控（auto-pass 或无弹卡）', authPass >= 0 && authPops < 8, `pass=${authPass} pop=${authPops}`);

  const ms = Date.now() - t0;
  console.log(`\n----- R18C ROUND ${ROUND} ${pass ? 'PASS' : 'FAIL'} (${Math.round(ms / 1000)}s) -----`);
  if (!pass) console.log('failures:', failures.join(', '));
  fs.writeFileSync(path.join(ROOT, `round18c-r${ROUND}.log`), logs.join('').slice(-20000), 'utf8');
  ws.close();
  try { child.kill(); } catch { /* */ }
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error(e); try { child.kill(); } catch { /* */ } process.exit(1); });
