/**
 * R18F：验证「不会长时间无回复」——带工具任务应有流式/进展，最终有回复。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PKG = path.join(ROOT, 'packages', 'app-shell');
const ROUND = (() => { const i = process.argv.indexOf('--round'); return i >= 0 ? String(process.argv[i + 1] || '1') : '1'; })();
const PORT = 9760 + (Number(ROUND) || 1);
const DATA = path.join(process.env.APPDATA || '', '@warmy', 'app-shell');
const MARK = `R18F-${ROUND}-${Date.now().toString(36)}`;
const key = (() => {
  const k = String(process.env.MIMO_KEY || '').trim();
  if (k) return k;
  const f = String(process.env.MIMO_KEY_FILE || '').trim();
  if (f) { try { return fs.readFileSync(f, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || ''; } catch { /* */ } }
  return '';
})();
if (!key) { console.error('need key'); process.exit(2); }

try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* */ }
fs.mkdirSync(path.join(DATA, 'secure'), { recursive: true });
fs.writeFileSync(path.join(DATA, 'secure', 'keys.enc.json'), JSON.stringify({
  'mimo-r18f': { v: 2, protector: 'plain', data: Buffer.from(key, 'utf8').toString('base64') },
}), 'utf8');

const s = {
  yuYan: 'zh-CN', setupDone: true, guideDone: true, privacyConsent: true, providersSeeded: true,
  asrEnabled: true, asrLang: 'auto', globalSecurity: 'full', askOnExceed: false, autoSelectRecommended: true,
  providers: [
    { id: 'mimo-r18f', biaoQian: 'MiMo(r18f)', protocol: 'openai-compatible', baseURL: 'https://token-plan-cn.xiaomimimo.com/v1', defaultModel: 'mimo-v2.5', models: ['mimo-v2.5', 'mimo-v2.6-flash'], staleModels: {}, hasKey: true },
  ],
  specialModels: { chatChain: ['mimo-v2.5'] },
  instances: [{
    id: 'inst-r18f', ming: '牛马-1', name: '牛马-1', status: 'running',
    model: 'mimo-v2.5', defaultModel: 'mimo-v2.5',
    availableModels: ['mimo-v2.5'], chain: ['mimo-v2.5'], chainDisabled: [],
    smartMode: false, allModels: true, currentModel: '', avatarPreset: 1, avatarDataUrl: '',
  }],
  modelCaps: { 'mimo-v2.5': { kind: 'chat', tools: true, vision: 'unknown', contextLen: 32768 } },
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

  console.log(`\n===== R18F ROUND ${ROUND} mark=${MARK} =====`);
  const t0 = Date.now();
  await ev(`document.readyState==='complete' && !!window.warmy`, 30000);
  await sleep(2000);
  await ev(`(()=>{document.querySelector('[data-nav="singleAi"]')?.click();return true})()`, 8000);
  await sleep(800);

  const since = Date.now();
  await ev(`(()=>{
    const ta=document.getElementById('shuRu')||document.querySelector('textarea');
    if(!ta) return false;
    ta.value='请生成 hang-${MARK}.txt，内容写一行「${MARK}」。用 write_file。完成后用一句话确认。';
    ta.dispatchEvent(new Event('input',{bubbles:true}));
    const btn=document.getElementById('faSong')||[...document.querySelectorAll('button')].find(b=>/发送|Send/.test(b.textContent||''));
    if(btn){btn.click();return true}
    ta.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    return true;
  })()`, 10000);

  // 关键：90 秒内必须看到工具或流式进展；180 秒内必须有 tools.done
  let sawToolEarly = false, sawStream = false, sawDone = false, sawReply = false;
  let maxSilent = 0, lastAct = Date.now();
  for (let i = 0; i < 60; i++) {
    const au0 = auditSince(since);
    const act = au0.some((x) => x.op === 'chat.work-tool' || x.op === 'chat.host-tool' || x.op === 'chat.stream-fallback-empty-args');
    if (act) {
      if (Date.now() - t0 < 90000) sawToolEarly = true;
      lastAct = Date.now();
    }
    if (au0.some((x) => x.op === 'chat.tools.done')) sawDone = true;
    // 流式小字/回复
    const ui = await ev(`(()=>{
      const t=document.body.innerText||'';
      const st=document.getElementById('yunXingZhuangTai');
      return { hasMark: t.includes('${MARK}'), busy: !!(st && !st.classList.contains('yinCang')), len: t.length };
    })()`, 2000).catch(() => null);
    if (ui && ui.hasMark) sawReply = true;
    if (ui && ui.busy) sawStream = true;
    maxSilent = Math.max(maxSilent, Date.now() - lastAct);
    if (sawDone && sawReply && i > 8) break;
    if (sawDone && i > 20) break;
    await sleep(2000);
  }

  ok('90 秒内有工具进展', sawToolEarly);
  ok('最终 tools.done', sawDone);
  ok('最终有回复/标记', sawReply);
  ok('无 4 分钟静默', maxSilent < 180000, `maxSilent=${Math.round(maxSilent/1000)}s`);

  // 文件落盘
  let found = false;
  const walk = (d) => {
    try {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name);
        if (f.isDirectory()) walk(p);
        else if (f.name.includes(`hang-${MARK}`)) found = true;
      }
    } catch { /* */ }
  };
  walk(path.join(DATA, 'workspace'));
  ok('文件落盘', found);

  const ms = Date.now() - t0;
  console.log(`\n----- R18F ROUND ${ROUND} ${pass ? 'PASS' : 'FAIL'} (${Math.round(ms / 1000)}s) -----`);
  if (!pass) console.log('failures:', failures.join(', '));
  fs.writeFileSync(path.join(ROOT, `round18f-r${ROUND}.log`), logs.join('').slice(-20000), 'utf8');
  ws.close();
  try { child.kill(); } catch { /* */ }
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error(e); try { child.kill(); } catch { /* */ } process.exit(1); });
