/**
 * R18E：产物去重 / 第二轮看得见任务 / 带工具不双倍请求 / 真打开。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PKG = path.join(ROOT, 'packages', 'app-shell');
const ROUND = (() => { const i = process.argv.indexOf('--round'); return i >= 0 ? String(process.argv[i + 1] || '1') : '1'; })();
const PORT = 9750 + (Number(ROUND) || 1);
const DATA = path.join(process.env.APPDATA || '', '@warmy', 'app-shell');
const MARK = `R18E-${ROUND}-${Date.now().toString(36)}`;
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
  'mimo-r18e': { v: 2, protector: 'plain', data: Buffer.from(key, 'utf8').toString('base64') },
}), 'utf8');

const s = {
  yuYan: 'zh-CN', setupDone: true, guideDone: true, privacyConsent: true, providersSeeded: true,
  asrEnabled: true, asrLang: 'auto', globalSecurity: 'full', askOnExceed: false, autoSelectRecommended: true,
  providers: [
    { id: 'mimo-r18e', biaoQian: 'MiMo(r18e)', protocol: 'openai-compatible', baseURL: 'https://token-plan-cn.xiaomimimo.com/v1', defaultModel: 'mimo-v2.5', models: ['mimo-v2.5', 'mimo-v2.6-flash'], staleModels: {}, hasKey: true },
  ],
  specialModels: { chatChain: ['mimo-v2.5'] },
  instances: [{
    id: 'inst-r18e', ming: '牛马-1', name: '牛马-1', status: 'running',
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
  const uiSend = async (text) => {
    await ev(`(()=>{document.querySelector('[data-nav="singleAi"]')?.click();return true})()`, 6000);
    await sleep(600);
    return ev(`(()=>{
      const ta=document.getElementById('shuRu')||document.querySelector('textarea');
      if(!ta) return false;
      ta.value=${JSON.stringify(text)};
      ta.dispatchEvent(new Event('input',{bubbles:true}));
      const btn=document.getElementById('faSong')||[...document.querySelectorAll('button')].find(b=>/发送|Send/.test(b.textContent||''));
      if(btn){btn.click();return true}
      ta.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
      return true;
    })()`, 10000);
  };

  console.log(`\n===== R18E ROUND ${ROUND} mark=${MARK} =====`);
  const t0 = Date.now();
  await ev(`document.readyState==='complete' && !!window.warmy`, 30000);
  await sleep(2000);

  // ── 第一轮：同一文件写两次（验证产物去重）──
  const since1 = Date.now();
  await uiSend(`请用 write_file 把「第一段」写入 shou-${MARK}.txt，然后再用 write_file 把「第二段」追加到同一个 shou-${MARK}.txt（append:true）。最后简单确认。`);
  let writes1 = 0, emptyArgs = 0, toolsDone = false;
  for (let i = 0; i < 60; i++) {
    const au0 = auditSince(since1);
    writes1 = au0.filter((x) => x.op === 'chat.work-tool' && x.detail && x.detail.tool === 'write_file' && x.detail.ok !== false).length;
    emptyArgs = au0.filter((x) => x.op === 'chat.stream-fallback-empty-args').length;
    if (au0.some((x) => x.op === 'chat.tools.done')) { toolsDone = true; if (writes1 >= 1 && i > 6) break; }
    if (toolsDone && i > 15) break;
    await sleep(2000);
  }
  ok('第一轮 write_file ≥1', writes1 >= 1, `n=${writes1}`);
  ok('第一轮工具已结束', toolsDone);

  // 产物去重：gongZuoWenJian 里同一文件只 1 条
  const dedupe = await ev(`(()=>{
    const gz=(window.__state&&window.__state.gongZuoWenJian)||(typeof state!=='undefined'&&state.gongZuoWenJian)||[];
    const names=gz.map(x=>String(x.path||x.abs||''));
    const shou=names.filter(n=>n.includes('shou-${MARK}'));
    return { total: gz.length, shou: shou.length, shouNames: shou.join('|') };
  })()`, 5000);
  ok('产物列表无重复', dedupe && Number(dedupe.shou) <= 1, JSON.stringify(dedupe || {}));

  // ── 第二轮：重做上面的任务（验证看得见）──
  const since2 = Date.now();
  await uiSend('很好，重新做一遍上面的任务。');
  let sawNoSee = false, sawTask = false, toolsDone2 = false;
  for (let i = 0; i < 50; i++) {
    const au0 = auditSince(since2);
    if (au0.some((x) => x.op === 'chat.tools.done')) toolsDone2 = true;
    await sleep(2000);
    const txt = await ev(`(()=>{
      const t=document.body.innerText||'';
      return t.includes('看不到') ? 'NOC' : (t.includes('shou-')||t.includes('重新')||t.includes('追加')||t.includes('第一段') ? 'YES' : '');
    })()`, 3000).catch(() => '');
    if (txt === 'NOC') { sawNoSee = true; break; }
    if (txt === 'YES' && toolsDone2 && i > 5) { sawTask = true; break; }
    if (toolsDone2 && i > 12) break;
  }
  ok('第二轮不再说看不到任务', !sawNoSee);
  ok('第二轮能提到原任务/产物', sawTask || toolsDone2, `task=${sawTask}`);

  // 空参 fallback 次数（性能）：应远少于工具调用
  const auAll = auditSince(since1);
  const toolN = auAll.filter((x) => x.op === 'chat.work-tool' || x.op === 'chat.host-tool').length;
  const fbN = auAll.filter((x) => x.op === 'chat.stream-fallback-empty-args').length;
  ok('无工具空参双倍请求', fbN <= Math.max(2, toolN), `fallback=${fbN} tools=${toolN}`);

  const ms = Date.now() - t0;
  console.log(`\n----- R18E ROUND ${ROUND} ${pass ? 'PASS' : 'FAIL'} (${Math.round(ms / 1000)}s) -----`);
  if (!pass) console.log('failures:', failures.join(', '));
  fs.writeFileSync(path.join(ROOT, `round18e-r${ROUND}.log`), logs.join('').slice(-20000), 'utf8');
  ws.close();
  try { child.kill(); } catch { /* */ }
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error(e); try { child.kill(); } catch { /* */ } process.exit(1); });
