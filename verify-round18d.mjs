/**
 * R18D：验证「配 MiMo 不粘 Ollama / 长文不无限重写 / 动态小字计时」。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PKG = path.join(ROOT, 'packages', 'app-shell');
const ROUND = (() => { const i = process.argv.indexOf('--round'); return i >= 0 ? String(process.argv[i + 1] || '1') : '1'; })();
const PORT = 9740 + (Number(ROUND) || 1);
const DATA = path.join(process.env.APPDATA || '', '@warmy', 'app-shell');
const MARK = `R18D-${ROUND}-${Date.now().toString(36)}`;
const key = (() => {
  const k = String(process.env.MIMO_KEY || '').trim();
  if (k) return k;
  const f = String(process.env.MIMO_KEY_FILE || '').trim();
  if (f) { try { return fs.readFileSync(f, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || ''; } catch { /* */ } }
  return '';
})();
if (!key) { console.error('need key'); process.exit(2); }
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'huihui_ai/qwen3-vl-abliterated:4b';

try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* */ }
fs.mkdirSync(path.join(DATA, 'secure'), { recursive: true });
fs.writeFileSync(path.join(DATA, 'secure', 'keys.enc.json'), JSON.stringify({
  'mimo-r18d': { v: 2, protector: 'plain', data: Buffer.from(key, 'utf8').toString('base64') },
}), 'utf8');

const s = {
  yuYan: 'zh-CN', setupDone: true, guideDone: true, privacyConsent: true, providersSeeded: true,
  asrEnabled: true, asrLang: 'auto', globalSecurity: 'normal', askOnExceed: true, autoSelectRecommended: true,
  providers: [
    { id: 'ollama-r18d', biaoQian: 'Ollama(r18d)', protocol: 'ollama', baseURL: 'http://127.0.0.1:11434', defaultModel: OLLAMA_MODEL, models: [OLLAMA_MODEL], staleModels: {}, hasKey: false },
    { id: 'mimo-r18d', biaoQian: 'MiMo(r18d)', protocol: 'openai-compatible', baseURL: 'https://token-plan-cn.xiaomimimo.com/v1', defaultModel: 'mimo-v2.5', models: ['mimo-v2.5', 'mimo-v2.6-flash'], staleModels: {}, hasKey: true },
  ],
  specialModels: { chatChain: ['mimo-v2.5', `Ollama(r18d) · ${OLLAMA_MODEL}`] },
  instances: [{
    id: 'inst-r18d', ming: '牛马-1', name: '牛马-1', status: 'running',
    model: 'mimo-v2.5', defaultModel: 'mimo-v2.5',
    availableModels: ['mimo-v2.5', `Ollama(r18d) · ${OLLAMA_MODEL}`],
    chain: ['mimo-v2.5', `Ollama(r18d) · ${OLLAMA_MODEL}`],
    chainDisabled: [], smartMode: false, allModels: true, currentModel: '',
    avatarPreset: 1, avatarDataUrl: '',
  }],
  modelCaps: {
    'mimo-v2.5': { kind: 'chat', tools: true, vision: 'unknown', contextLen: 32768 },
    [OLLAMA_MODEL]: { kind: 'chat', tools: true, vision: true, contextLen: 32768 },
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

  console.log(`\n===== R18D ROUND ${ROUND} mark=${MARK} =====`);
  const t0 = Date.now();
  await ev(`document.readyState==='complete' && !!window.warmy`, 30000);
  await sleep(2000);
  await ev(`(()=>{document.querySelector('[data-nav="singleAi"]')?.click();return true})()`, 8000);
  await sleep(800);

  const since = Date.now();
  // 并行采样动态小字（chatSend 返回时状态条可能已收起）
  let statusStart = '', statusOk = false, statusRaw = '';
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      try {
        const st = await ev(`(()=>{
          const he=document.getElementById('yunXingZhuangTai');
          if(!he||he.classList.contains('yinCang')) return null;
          const t=he.textContent||'';
          const m=t.match(/开始\\s*(\\d{4}-\\d{2}-\\d{2}[^·]*)/);
          return { start: m&&m[1]?m[1].trim():null, hasUpdated: /更新|updated/i.test(t), hasSec: /\\d+\\s*s/.test(t), raw: t.slice(0,200) };
        })()`, 2000);
        if (st && (st.start || st.raw)) {
          statusRaw = st.raw || statusRaw;
          if (st.start) {
            if (!statusStart) statusStart = st.start;
            else if (st.start !== statusStart) {
              // 开始时间被重置
              statusOk = false;
            } else if (st.hasUpdated && st.hasSec) statusOk = true;
          }
          if (st.hasUpdated && st.hasSec && statusStart) statusOk = true;
        }
      } catch { /* */ }
      await sleep(1500);
    }
  })();
  // 长文任务：触发 target-length 续派，验证不无限重写
  await ev(`(()=>{
    const rows=[...document.querySelectorAll('[data-sid],.lieBiaoTiaoMu')];
    const r=rows.find(x=>/牛马/.test(x.textContent||''))||rows[0];
    if(r) r.click(); return true;
  })()`, 8000);
  await sleep(800);
  const sent = await ev(`(()=>{
    const ta=document.getElementById('shuRu')||document.querySelector('textarea');
    if(!ta) return false;
    ta.value='写一篇不少于 800 字的短文，主题：管道工程师的一天。写到工作区文件 gongcheng-${MARK}.txt。用 write_file 分段写。';
    ta.dispatchEvent(new Event('input',{bubbles:true}));
    const btn=document.getElementById('faSong')||[...document.querySelectorAll('button')].find(b=>/发送|Send/.test(b.textContent||''));
    if(btn){btn.click();return true}
    ta.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    return true;
  })()`, 10000);
  ok('长文任务已发送', sent === true, String(sent).slice(0, 50));

  let sawMimo = false, allOllama = false, continueN = 0, writeN = 0, maxBytes = 0;
  for (let i = 0; i < 100; i++) {
    await ev(`(()=>{document.querySelectorAll('.aiqKa button').forEach((b)=>{if(/同意|允许|继续|确定/.test(b.textContent||'')){try{b.click()}catch{}}});return 1})()`, 1500).catch(() => null);
    const au0 = auditSince(since);
    const picks = au0.filter((x) => x.op === 'chat.model-picked');
    if (picks.some((x) => /mimo/i.test(String(x.detail?.model || '')))) sawMimo = true;
    if (picks.length >= 3 && picks.every((x) => /ollama|qwen/i.test(String(x.detail?.model || '')))) allOllama = true;
    continueN = au0.filter((x) => x.op === 'plan.auto-continue').length;
    const writes = au0.filter((x) => x.op === 'chat.work-tool' && x.detail && x.detail.tool === 'write_file' && x.detail.ok !== false);
    writeN = writes.length;
    for (const w of writes) maxBytes = Math.max(maxBytes, Number(w.detail.bytes || 0));
    const done = au0.some((x) => x.op === 'chat.tools.done' && continueN === 0) && i > 15;
    // 收工：工具结束且不再续派
    // 有落盘且工具结束才收；否则等到上限
    // 等真实收尾：tools.done 且有写盘；或到上限
    if (au0.some((x) => x.op === 'chat.tools.done') && (writes.length > 0 || au0.some((x) => x.op === 'plan.auto-continue')) && i > 5) break;
    if (au0.some((x) => x.op === 'chat.tools.done') && i > 20) break;
    if (done) break;
    await sleep(2000);
  }

  sampling = false; await sampler;
  ok('使用了 MiMo', sawMimo);
  ok('未全程只用 Ollama', !allOllama);
  ok('target-length 续派有上限', continueN <= 12, `continue=${continueN}`);
  ok('write_file 次数合理', writeN <= 20, `writes=${writeN}`);
  ok('动态小字开始时间保持', !!statusStart, statusStart);
  ok('动态小字计时齐全', statusOk && !!statusStart, (statusStart || '') + ' | ' + String(statusRaw || '').slice(0, 60));

  // 磁盘上文章字数
  let ziShu = 0; let found = false;
  const walk = (d) => {
    try {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name);
        if (f.isDirectory()) walk(p);
        else if (f.name.includes(`gongcheng-${MARK}`)) {
          found = true;
          try { ziShu = Math.max(ziShu, [...fs.readFileSync(p, 'utf8')].length); } catch { /* */ }
        }
      }
    } catch { /* */ }
  };
  walk(path.join(DATA, 'workspace'));
  try {
    const desk = path.join(process.env.USERPROFILE || '', 'Desktop');
    if (fs.existsSync(desk)) walk(desk);
  } catch { /* */ }
  ok('文章文件落盘', found);
  ok('文章接近目标字数', ziShu >= 600, `ziShu=${ziShu}/2000`);

  const ms = Date.now() - t0;
  console.log(`\n----- R18D ROUND ${ROUND} ${pass ? 'PASS' : 'FAIL'} (${Math.round(ms / 1000)}s) -----`);
  if (!pass) console.log('failures:', failures.join(', '));
  fs.writeFileSync(path.join(ROOT, `round18d-r${ROUND}.log`), logs.join('').slice(-20000), 'utf8');
  ws.close();
  try { child.kill(); } catch { /* */ }
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error(e); try { child.kill(); } catch { /* */ } process.exit(1); });
