/**
 * 第 19 轮验收：本轮 UI/设置改动 + 真实 Ollama/MiMo 基本对话与工具。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PKG = path.join(ROOT, 'packages', 'app-shell');
const ROUND = (() => { const i = process.argv.indexOf('--round'); return i >= 0 ? String(process.argv[i + 1] || '1') : '1'; })();
const PORT = 9770 + (Number(ROUND) || 1);
const DATA = path.join(process.env.APPDATA || '', '@warmy', 'app-shell');
const MARK = `R19-${ROUND}-${Date.now().toString(36)}`;
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
  'mimo-r19': { v: 2, protector: 'plain', data: Buffer.from(key, 'utf8').toString('base64') },
}), 'utf8');

const s = {
  yuYan: 'zh-CN', setupDone: true, guideDone: true, privacyConsent: true, providersSeeded: true,
  asrEnabled: true, asrLang: 'auto', globalSecurity: 'full', askOnExceed: false, autoSelectRecommended: true,
  providers: [
    { id: 'ollama-r19', biaoQian: 'Ollama(r19)', protocol: 'ollama', baseURL: 'http://127.0.0.1:11434', defaultModel: OLLAMA_MODEL, models: [OLLAMA_MODEL], staleModels: {}, hasKey: false },
    { id: 'mimo-r19', biaoQian: 'MiMo(r19)', protocol: 'openai-compatible', baseURL: 'https://token-plan-cn.xiaomimimo.com/v1', defaultModel: 'mimo-v2.5', models: ['mimo-v2.5'], staleModels: {}, hasKey: true },
  ],
  specialModels: { chatChain: ['mimo-v2.5', `Ollama(r19) · ${OLLAMA_MODEL}`] },
  instances: [{
    id: 'inst-r19', ming: '牛马-1', name: '牛马-1', status: 'running',
    model: 'mimo-v2.5', defaultModel: 'mimo-v2.5',
    availableModels: ['mimo-v2.5', `Ollama(r19) · ${OLLAMA_MODEL}`],
    chain: ['mimo-v2.5'], chainDisabled: [], smartMode: false, allModels: true, currentModel: '',
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

  console.log(`\n===== R19 ROUND ${ROUND} mark=${MARK} =====`);
  const t0 = Date.now();
  await ev(`document.readyState==='complete' && !!window.warmy`, 30000);
  await sleep(2000);

  // ── 源码/设置静态断言 ──
  const app = fs.readFileSync(path.join(PKG, 'src/renderer/app.js'), 'utf8');
  const em = fs.readFileSync(path.join(PKG, 'src/electron-main.ts'), 'utf8');
  const css = fs.readFileSync(path.join(PKG, 'src/renderer/app.css'), 'utf8');
  const ac = fs.readFileSync(path.join(PKG, 'src/archive-cleanup.ts'), 'utf8');
  ok('① 自动添加模型', app.includes('自动添加模型'));
  ok('② 手动添加模型+弹窗', app.includes('手动添加模型') && app.includes('kaiShouDongMoXing'));
  ok('③ 复制=文件本体', em.includes('Set-Clipboard -LiteralPath') && app.includes('已复制文件'));
  ok('④⑤ 偏好 v3 软门禁', ac.includes('soft-gate') && ac.includes('biaoJiZanShiTiaoGuo') && ac.includes('RuanMenJinGuiZe'));
  ok('⑧ 协议选择框', app.includes("['openai-compatible', 'openai', 'anthropic']"));
  ok('⑨ 决策卡 24h', em.includes('24 * 60 * 60 * 1000'));
  ok('⑩ 配速 1.7 倍', app.includes('/ 1.7'));
  ok('⑫ 问号仅 pending', app.includes('status === \'pending\''));
  ok('⑬ 分身卡片布局', app.includes('fenShenHang1') && app.includes('title='));
  ok('⑯ 计划竖条', css.includes('data-st="pending"') && css.includes('line-through'));
  ok('⑰ 赞踩在模型行', app.includes('xiaoXiMoXing') && app.includes('zanCaiJi'));
  ok('⑱ 预算跟模型', app.includes('ctxLoad()'));
  ok('⑮ 时间戳后缀', em.includes('当前时间：'));

  // ── 真实对话 + 工具 ──
  await ev(`(()=>{document.querySelector('[data-nav="singleAi"]')?.click();return true})()`, 8000);
  await sleep(800);
  const since = Date.now();
  await ev(`(()=>{
    const ta=document.getElementById('shuRu')||document.querySelector('textarea');
    if(!ta) return false;
    ta.value='用 write_file 在工作区生成 ok-${MARK}.txt，内容写 ${MARK}。然后一句话确认。';
    ta.dispatchEvent(new Event('input',{bubbles:true}));
    const btn=document.getElementById('faSong')||[...document.querySelectorAll('button')].find(b=>/发送|Send/.test(b.textContent||''));
    if(btn){btn.click();return true}
    ta.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    return true;
  })()`, 10000);

  let sawWrite = false, sawDone = false;
  for (let i = 0; i < 80; i++) {
    const au0 = auditSince(since);
    if (au0.some((x) => x.op === 'chat.work-tool' && x.detail && x.detail.tool === 'write_file' && x.detail.ok !== false)) sawWrite = true;
    if (au0.some((x) => x.op === 'chat.tools.done')) sawDone = true;
    if (sawWrite && sawDone && i > 5) break;
    await sleep(2000);
  }
  ok('真实 write_file 成功', sawWrite);
  ok('工具循环结束', sawDone);

  // 设置页：按钮文案
  await ev(`(()=>{const b=document.querySelector('[data-nav="settings"]');if(b)b.click();return true})()`, 6000);
  await sleep(800);
  await ev(`(()=>{
    const t=[...document.querySelectorAll('button,a,[data-sec]')].find(x=>/模型|model/i.test(x.textContent||x.getAttribute?.('data-sec')||''));
    if(t) t.click(); return true;
  })()`, 6000);
  await sleep(1200);
  const btnText = await ev(`(()=>{
    const html=document.body.innerHTML||'';
    return {
      auto: html.includes('data-fetch') && html.includes('自动添加模型'),
      manual: html.includes('data-manual-add'),
      proto: html.includes('openai-compatible'),
    };
  })()`, 5000);
  ok('设置页显示自动/手动添加模型', btnText && btnText.auto && btnText.manual, JSON.stringify(btnText || {}));
  ok('设置页显示协议选择', btnText && btnText.proto);

  const ms = Date.now() - t0;
  console.log(`\n----- R19 ROUND ${ROUND} ${pass ? 'PASS' : 'FAIL'} (${Math.round(ms / 1000)}s) -----`);
  if (!pass) console.log('failures:', failures.join(', '));
  fs.writeFileSync(path.join(ROOT, `round19-r${ROUND}.log`), logs.join('').slice(-20000), 'utf8');
  ws.close();
  try { child.kill(); } catch { /* */ }
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error(e); try { child.kill(); } catch { /* */ } process.exit(1); });
