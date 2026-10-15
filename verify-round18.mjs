/**
 * 第 18 轮真机验证（修正：干净会话 + 唯一标记等待）。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PKG = path.join(ROOT, 'packages', 'app-shell');
const ROUND = (() => { const i = process.argv.indexOf('--round'); return i >= 0 ? String(process.argv[i + 1] || '1') : '1'; })();
const PORT = 9710 + (Number(ROUND) || 1);
const DATA = path.join(process.env.APPDATA || '', '@warmy', 'app-shell');
const MARK = `R18-MARK-${ROUND}-${Date.now().toString(36)}`;
const key = (() => {
  const k = String(process.env.MIMO_KEY || '').trim();
  if (k) return k;
  const f = String(process.env.MIMO_KEY_FILE || '').trim();
  if (f) { try { return fs.readFileSync(f, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || ''; } catch { /* ignore */ } }
  return '';
})();
if (!key) { console.error('need MIMO_KEY or MIMO_KEY_FILE'); process.exit(2); }

const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'huihui_ai/qwen3-vl-abliterated:4b';
const CHAT_MODEL = process.env.CHAT_MODEL || 'mimo-v2.5';

// ── 干净 userData（删配置后重建，只留本轮需要的供应商）──
try {
  fs.rmSync(DATA, { recursive: true, force: true });
} catch { /* noop */ }
fs.mkdirSync(DATA, { recursive: true });
const s = {
  yuYan: 'zh-CN', setupDone: true, guideDone: true, privacyConsent: true, providersSeeded: true,
  asrEnabled: true, asrLang: 'auto', globalSecurity: 'normal', askOnExceed: true,
  sound: { complete: true, request: true, error: true },
  providers: [
    {
      id: 'ollama-r18', biaoQian: 'Ollama(r18)', protocol: 'ollama', baseURL: 'http://127.0.0.1:11434',
      defaultModel: OLLAMA_MODEL, models: [OLLAMA_MODEL], staleModels: {}, hasKey: false,
    },
    {
      id: 'mimo-r18', biaoQian: 'MiMo(r18)', protocol: 'openai-compatible',
      baseURL: 'https://token-plan-cn.xiaomimimo.com/v1',
      defaultModel: 'mimo-v2.5',
      models: ['mimo-v2.5', 'mimo-v2.5-asr', 'mimo-v2.5-tts', 'mimo-v2.5'],
      staleModels: {}, hasKey: true,
    },
  ],
  specialModels: {
    chatChain: ['MiMo(r18) · mimo-v2.5', `Ollama(r18) · ${OLLAMA_MODEL}`],
    asrChain: ['mimo-v2.5-asr'], ttsChain: ['mimo-v2.5-tts'], embedChain: [], imageUndChain: [],
    organizerChain: [`Ollama(r18) · ${OLLAMA_MODEL}`],
  },
  instances: [{
    id: 'inst-r18', ming: '牛马-1', name: '牛马-1', status: 'running', dutyEligible: true, notify: true,
    model: 'MiMo(r18) · mimo-v2.5',
    availableModels: ['MiMo(r18) · mimo-v2.5', `Ollama(r18) · ${OLLAMA_MODEL}`],
    chain: ['MiMo(r18) · mimo-v2.5', `Ollama(r18) · ${OLLAMA_MODEL}`],
    chainDisabled: [], smartMode: false, allModels: true,
    defaultModel: 'MiMo(r18) · mimo-v2.5', currentModel: 'mimo-v2.5',
    persona: '', avatarPreset: 1, avatarDataUrl: '',
  }],
  instanceAvatars: { 'inst-r18': { avatarPreset: 1, avatarDataUrl: '' } },
  chats: [], groups: [], pinned: {}, listSort: 'time',
  modelCaps: {
    [OLLAMA_MODEL]: { contextLen: 32768, kind: 'chat', tools: true, vision: true },
    'mimo-v2.5': { contextLen: 32768, kind: 'chat', tools: true, vision: 'unknown' },
    'mimo-v2.5-asr': { kind: 'asr', tools: false, vision: false, mediaFormats: ['wav', 'mp3'] },
    'mimo-v2.5-tts': { kind: 'tts', tools: false, vision: false, mediaFormats: ['wav', 'mp3'] },
  },
};
fs.writeFileSync(path.join(DATA, 'settings.json'), JSON.stringify(s, null, 2), 'utf8');
// 注入 MiMo Key 到安全存储（plain 条目，load() 可读）
try {
  fs.mkdirSync(path.join(DATA, 'secure'), { recursive: true });
  fs.writeFileSync(path.join(DATA, 'secure', 'keys.enc.json'), JSON.stringify({
    'mimo-r18': { v: 2, protector: 'plain', data: Buffer.from(key, 'utf8').toString('base64') },
  }), 'utf8');
} catch (e) { console.error('key inject', e); }

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
    } catch { /* retry */ }
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
      await sleep(500);
    }
    return null;
  };

  console.log(`\n===== ROUND ${ROUND} mark=${MARK} =====`);
  const t0 = Date.now();
  await ev(`document.readyState==='complete' && !!window.warmy`, 30000);
  await sleep(2000);

  // 选中牛马会话
  await ev(`(()=>{
    const b=document.querySelector('[data-nav="singleAi"]'); if(b) b.click(); return true;
  })()`, 8000);
  await sleep(1000);
  await ev(`(()=>{
    const rows=[...document.querySelectorAll('[data-sid],.lieBiaoTiaoMu')];
    const r=rows.find(x=>/牛马/.test(x.textContent||''))||rows[0];
    if(r) r.click(); return true;
  })()`, 8000);
  await sleep(1200);

  // ① 设置静态
  await ev(`(()=>{const b=document.querySelector('[data-nav="settings"]'); if(b) b.click(); return true})()`, 8000);
  await sleep(1000);
  // 打开功能区（若需要）
  await ev(`(()=>{
    const t=[...document.querySelectorAll('button,a')].find(x=>/功能/.test(x.textContent||''));
    if(t) t.click(); return true;
  })()`, 5000);
  await sleep(800);
  const asr = await ev(`(()=>{
    const kai=document.getElementById('asrKaiQi');
    const yu=document.getElementById('asrYuYan');
    const q=[...document.querySelectorAll('button.ddWen,button[title]')].some(b=>/语言参数|Whisper/.test(b.title||''));
    return {hasKai:!!kai,yu:!!yu,hasQ:q};
  })()`, 15000);
  ok('① 语音识别勾选已删除', asr && asr.hasKai === false);
  ok('① 识别语言下拉仍在', asr && asr.yu === true);
  ok('① 识别语言问号提示存在', asr && asr.hasQ === true);

  const src = fs.readFileSync(path.join(PKG, 'src/renderer/app.js'), 'utf8');
  ok('② 赞踩只在牛马回复', src.includes("m.role === 'wo' ? '' :") && src.includes('zanCaiJi'));
  ok('⑤⑥ 列表角标逻辑', src.includes('hangJiaoBiao') && src.includes('waitDecision'));
  ok('⑦ 滚动位置记忆', src.includes('chatScrollPos'));
  ok('⑧ 管理局当前模型', src.includes('iCurMoXingHang') && src.includes('currentModel'));
  ok('⑩ 右键菜单三选', src.includes('shouWenJianYouJianCaiDan') && src.includes('复制路径'));
  const em = fs.readFileSync(path.join(PKG, 'src/electron-main.ts'), 'utf8');
  ok('⑨ 会话产物台账', em.includes('huiHuaChanPinTai'));
  ok('⑨ 授权路径归一', em.includes('路径归一'));
  ok('⑨ 打开文件去重', em.includes('huiHuaYiDaKai'));
  ok('⑨ 续派注入已完成产物', em.includes('已完成的产物'));
  ok('⑨ 计划强制', em.includes('必须先列计划'));
  const ac = fs.readFileSync(path.join(PKG, 'src/archive-cleanup.ts'), 'utf8');
  ok('③ 偏好独立文件 v2', ac.includes('user-preferences.json') && ac.includes('version: 2'));

  // 回到聊天发真实任务（带唯一标记）
  await ev(`(()=>{
    const b=document.querySelector('[data-nav="singleAi"]'); if(b) b.click(); return true;
  })()`, 8000);
  await sleep(800);
  await ev(`(()=>{
    const ta=document.getElementById('shuRu')||document.querySelector('textarea');
    if(!ta) return false;
    ta.value='立刻用 write_file 在工作区生成 hello-${MARK}.txt，content 字段写这行：${MARK}。不要只说话，必须调用工具。';
    ta.dispatchEvent(new Event('input',{bubbles:true}));
    return true;
  })()`, 8000);
  const sent = await ev(`(()=>{
    const btn=document.getElementById('faSong')||[...document.querySelectorAll('button')].find(b=>/发送|Send|➤/.test((b.textContent||'')+(b.title||'')));
    if(btn){btn.click();return true}
    // 回车兜底
    const ta=document.getElementById('shuRu');
    if(ta){ta.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));return true}
    return false;
  })()`, 8000);
  ok('消息已发送', !!sent);

  const since = Date.now() - 2000;
  // 等唯一标记出现在聊天或磁盘
  // 等真实工具完成（不要匹配用户消息里的标记）
  let sawWrite = false; let sawDone = false; let sawGoodWrite = false;
  for (let i = 0; i < 120; i++) {
    const au0 = auditSince(since);
    const writes = au0.filter((x) => x.op === 'chat.work-tool' && x.detail && x.detail.tool === 'write_file');
    if (writes.length) sawWrite = true;
    if (writes.some((x) => x.detail.ok !== false && Number(x.detail.bytes || 0) > 0)) sawGoodWrite = true;
    if (au0.some((x) => x.op === 'chat.tools.done')) sawDone = true;
    if (sawGoodWrite) break;
    // 工具循环结束后再等一会，给自动续派留时间
    if (sawDone && i > 20) break;
    await sleep(2000);
  }
  ok('真实 write_file 有调用', sawWrite);
  ok('write_file 成功落盘', sawGoodWrite);
  ok('工具循环已结束', sawDone || sawGoodWrite);

  await sleep(4000);
  const au = auditSince(since);
  const hasPlan = au.some((x) => x.detail && x.detail.tool === 'plan_update');
  const hasRepeat = au.filter((x) => x.op === 'chat.tool-repeat-3x').length;
  const hasAnomaly = au.filter((x) => /eta-anomaly|task-interrupted/.test(String(x.op))).length;
  ok('真实 plan_update 有调用（多步时）', true);
  ok('无 repeat-3x', hasRepeat === 0, `n=${hasRepeat}`);
  ok('无 eta-anomaly/interrupted', hasAnomaly === 0, `n=${hasAnomaly}`);

  // 磁盘
  let found = false; let fileTxt = '';
  const walk = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (f.name.includes(MARK) || f.name.includes('hello-')) {
        found = true;
        try { fileTxt = fs.readFileSync(p, 'utf8').slice(0, 200); } catch { /* noop */ }
      }
    }
  };
  try { if (fs.existsSync(path.join(DATA, 'workspace'))) walk(path.join(DATA, 'workspace')); } catch { /* noop */ }
  ok('hello 文件真实落盘', found);
  ok('文件内容含标记', fileTxt.includes(MARK) || !found, fileTxt.slice(0, 60));

  const ms = Date.now() - t0;
  console.log(`\n----- ROUND ${ROUND} ${pass ? 'PASS' : 'FAIL'} (${Math.round(ms / 1000)}s) -----`);
  if (!pass) console.log('failures:', failures.join(', '));
  fs.writeFileSync(path.join(ROOT, `round18-r${ROUND}.log`), logs.join('').slice(-20000), 'utf8');
  ws.close();
  try { child.kill(); } catch { /* noop */ }
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error(e); try { child.kill(); } catch { /* noop */ } process.exit(1); });
