/**
 * 第 18 轮追加验收：Ollama 视觉模型 + 图片 + 工具（复现 Failed to tokenize prompt）。
 * 必须真实 Ollama 对话与工具调用；连续 3 轮。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PKG = path.join(ROOT, 'packages', 'app-shell');
const ROUND = (() => { const i = process.argv.indexOf('--round'); return i >= 0 ? String(process.argv[i + 1] || '1') : '1'; })();
const PORT = 9720 + (Number(ROUND) || 1);
const DATA = path.join(process.env.APPDATA || '', '@warmy', 'app-shell');
const MARK = `R18B-${ROUND}-${Date.now().toString(36)}`;
const key = (() => {
  const k = String(process.env.MIMO_KEY || '').trim();
  if (k) return k;
  const f = String(process.env.MIMO_KEY_FILE || '').trim();
  if (f) { try { return fs.readFileSync(f, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || ''; } catch { /* */ } }
  return '';
})();

// 复现现场：当时崩的就是这只视觉模型
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'lileilei999/qwen3.5-9b-abliterated-vision:latest';

function seed() {
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* */ }
  fs.mkdirSync(DATA, { recursive: true });
  // 1x1 PNG
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  const imgPath = path.join(DATA, 'seed-tiny.png');
  fs.writeFileSync(imgPath, png);

  const s = {
    yuYan: 'zh-CN', setupDone: true, guideDone: true, privacyConsent: true, providersSeeded: true,
    asrEnabled: true, asrLang: 'auto', globalSecurity: 'full', askOnExceed: false, autoSelectRecommended: true,
    providers: [
      {
        id: 'ollama-r18b', biaoQian: 'Ollama(r18b)', protocol: 'ollama', baseURL: 'http://127.0.0.1:11434',
        defaultModel: OLLAMA_MODEL, models: [OLLAMA_MODEL], staleModels: {}, hasKey: false,
      },
      {
        id: 'mimo-r18b', biaoQian: 'MiMo(r18b)', protocol: 'openai-compatible',
        baseURL: 'https://token-plan-cn.xiaomimimo.com/v1',
        defaultModel: 'mimo-v2.5',
        models: ['mimo-v2.5', 'mimo-v2.5-asr', 'mimo-v2.6-flash'],
        staleModels: {}, hasKey: !!key,
      },
    ],
    specialModels: {
      chatChain: [`Ollama(r18b) · ${OLLAMA_MODEL}`],
      imageUndChain: [`Ollama(r18b) · ${OLLAMA_MODEL}`],
      asrChain: ['mimo-v2.5-asr'], ttsChain: [], embedChain: [],
    },
    instances: [{
      id: 'inst-r18b', ming: '牛马-1', name: '牛马-1', status: 'running',
      model: `Ollama(r18b) · ${OLLAMA_MODEL}`,
      availableModels: [`Ollama(r18b) · ${OLLAMA_MODEL}`, 'MiMo(r18b) · mimo-v2.5'],
      chain: [`Ollama(r18b) · ${OLLAMA_MODEL}`],
      chainDisabled: [], smartMode: false, allModels: true,
      defaultModel: `Ollama(r18b) · ${OLLAMA_MODEL}`, currentModel: '',
      avatarPreset: 1, avatarDataUrl: '',
    }],
    modelCaps: {
      [OLLAMA_MODEL]: { contextLen: 32768, kind: 'chat', tools: true, vision: true, mediaFormats: ['png', 'jpeg', 'webp'] },
      'mimo-v2.5': { kind: 'chat', tools: true, vision: 'unknown', contextLen: 32768 },
      'mimo-v2.5-asr': { kind: 'asr', tools: false, vision: false, mediaFormats: ['wav', 'mp3'] },
    },
  };
  fs.writeFileSync(path.join(DATA, 'settings.json'), JSON.stringify(s, null, 2), 'utf8');
  if (key) {
    fs.mkdirSync(path.join(DATA, 'secure'), { recursive: true });
    fs.writeFileSync(path.join(DATA, 'secure', 'keys.enc.json'), JSON.stringify({
      'mimo-r18b': { v: 2, protector: 'plain', data: Buffer.from(key, 'utf8').toString('base64') },
    }), 'utf8');
  }
  return imgPath;
}

const imgPath = seed();
const env = { ...process.env, ...(key ? { MIMO_KEY: key } : {}) };
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
  await sleep(3500);
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

  console.log(`\n===== R18B ROUND ${ROUND} mark=${MARK} model=${OLLAMA_MODEL} =====`);
  const t0 = Date.now();
  await ev(`document.readyState==='complete' && !!window.warmy`, 30000);
  await sleep(2500);
  await ev(`(()=>{document.querySelector('[data-nav="singleAi"]')?.click();return true})()`, 8000);
  await sleep(1200);

  // 带图 + 工具任务（复现 tokenize 失败）
  const since = Date.now();
  const sent = await ev(`(()=>{
    const ta=document.getElementById('shuRu')||document.querySelector('textarea');
    if(!ta) return false;
    ta.value='请先描述我发的这张图（一句话），然后立刻用 write_file 在工作区生成 hello-${MARK}.txt，content 写：${MARK}。必须调用工具。';
    ta.dispatchEvent(new Event('input',{bubbles:true}));
    return true;
  })()`, 8000);
  ok('消息已写入', !!sent);

  // 注入图片附件
  await ev(`(()=>{
    try {
      const abs = ${JSON.stringify(imgPath)};
      // 走内部 attachments 通道
      if (window.warmy && window.warmy.__testInjectAttach) {
        window.warmy.__testInjectAttach({ path: abs, name: 'seed-tiny.png' });
        return 'api';
      }
      // 兜底：直接改 state（若暴露）
      return 'no-api';
    } catch(e) { return 'err:'+e.message; }
  })()`, 8000);

  // 按 UI 同款 payload 发送（含图片附件 + 工具任务）
  const sent2 = await ev(`(async ()=>{
    try {
      const abs = ${JSON.stringify(imgPath)};
      const inst = (window.__state && window.__state.instances && window.__state.instances[0]) || null;
      const chatId = 'inst-r18b';
      const r = await window.warmy.chatSend({
        sessionId: chatId,
        model: 'lileilei999/qwen3.5-9b-abliterated-vision:latest',
        content: '请先描述我发的这张图（一句话），然后立刻用 write_file 在工作区生成 hello-${MARK}.txt，content 写：${MARK}。必须调用工具。',
        attachments: [{ name: 'seed-tiny.png', path: abs, dataUrl: '' }],
        ming: (inst && (inst.ming || inst.name)) || '牛马-1',
        thinkLevel: 'auto',
        xiaoDiShuLiang: 0,
        moXingJueCe: {
          urgency: 'P2',
          defaultModel: 'lileilei999/qwen3.5-9b-abliterated-vision:latest',
          chain: ['Ollama(r18b) · lileilei999/qwen3.5-9b-abliterated-vision:latest'],
          chainDisabled: (inst && inst.chainDisabled) || [],
        },
      });
      return !!(r && (r.ok || r.reply));
    } catch (e) { return 'err:' + (e && e.message); }
  })()`, 240000);
  ok('已发送（含图片附件）', sent2 === true, String(sent2).slice(0, 80));

  // 等工具结束
  let sawWrite = false, sawGoodWrite = false, sawDone = false, sawTokenize = false, sawInterrupt = false;
  for (let i = 0; i < 150; i++) {
    // 自动应答决策卡/授权卡（无人值守测试不能卡在弹卡上）
    await ev(`(()=>{
      let n = 0;
      document.querySelectorAll('.aiqKa button, .aiqOpts button').forEach((b) => {
        const t = (b.textContent || '');
        if (/同意|允许|本次允许|推荐|继续|确定|好的|Yes|Allow/i.test(t)) { try { b.click(); n++; } catch {} }
      });
      return n;
    })()`, 2000).catch(() => null);
    const au0 = auditSince(since);
    const writes = au0.filter((x) => x.op === 'chat.work-tool' && x.detail && x.detail.tool === 'write_file');
    if (writes.length) sawWrite = true;
    if (writes.some((x) => x.detail.ok !== false && Number(x.detail.bytes || 0) > 0)) sawGoodWrite = true;
    if (au0.some((x) => x.op === 'chat.tools.done')) sawDone = true;
    if (au0.some((x) => JSON.stringify(x).includes('tokenize'))) sawTokenize = true;
    if (au0.some((x) => x.op === 'plan.task-interrupted')) sawInterrupt = true;
    if (sawGoodWrite && sawDone) break;
    if (sawDone && i > 25) break;
    await sleep(2000);
  }

  ok('无 Failed to tokenize prompt', !sawTokenize, sawTokenize ? '仍出现分词失败' : '');
  ok('无 task-interrupted 死循环', !sawInterrupt);
  ok('真实 write_file 有调用', sawWrite);
  ok('write_file 成功落盘', sawGoodWrite);

  // 磁盘
  let found = false; let txt = '';
  const walk = (d) => {
    try {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name);
        if (f.isDirectory()) walk(p);
        else if (f.name.includes(MARK)) { found = true; try { txt = fs.readFileSync(p, 'utf8').slice(0, 80); } catch { /* */ } }
      }
    } catch { /* */ }
  };
  walk(path.join(DATA, 'workspace'));
  ok('hello 文件真实落盘', found);
  ok('文件内容含标记', !found || txt.includes(MARK), txt.slice(0, 40));

  // 模型确为 Ollama 视觉模型
  const au = auditSince(since);
  const picked = au.find((x) => x.op === 'chat.model-picked');
  ok('使用 Ollama 模型', !!(picked && /ollama|qwen3\.5|vision/i.test(JSON.stringify(picked.detail))), JSON.stringify(picked?.detail?.model || ''));

  const ms = Date.now() - t0;
  console.log(`\n----- R18B ROUND ${ROUND} ${pass ? 'PASS' : 'FAIL'} (${Math.round(ms / 1000)}s) -----`);
  if (!pass) console.log('failures:', failures.join(', '));
  fs.writeFileSync(path.join(ROOT, `round18b-r${ROUND}.log`), logs.join('').slice(-20000), 'utf8');
  ws.close();
  try { child.kill(); } catch { /* */ }
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error(e); try { child.kill(); } catch { /* */ } process.exit(1); });
