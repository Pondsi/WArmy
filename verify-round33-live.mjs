/**
 * 第 33 轮 项 4 真机门禁：**常见多任务都要能顺利跑完**（不再卡在"等待30秒"、不再重复生成）。
 *
 * 场景（都走产品自己的入口 warmy:chatSend = zhenZhengFaSong）：
 *   A. 多步 + 等待：建文件 → 等 5 秒 → 汇报（真机卡死的就是这一类）
 *   B. 多步 + 两产物 + 打开
 * 断言：
 *   ① 每个场景都拿到**非空最终回复**；
 *   ② 计划里**没有**留给用户看的悬挂 `pending/doing`（全部完成/验证/明确跳过）；
 *   ③ **没有** `plan.auto-continue-step-skipped`（等待类步骤不再被反复续派到顶）；
 *   ④ 没有因 EBUSY 而多产出的重复文件。
 *
 * 跑法：node verify-round33-live.mjs   （需要本机 Ollama）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { attach, sleep } from './packages/app-shell/scripts/cdp-lib.mjs';

const GEN = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(GEN, 'packages', 'app-shell');
const PORT = Number(process.env.R33_PORT || 9966);
const electron = path.join(pkgRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const mainJs = path.join(pkgRoot, 'dist', 'electron-main.js');
const MO = process.env.OLLAMA_MODEL || 'huihui_ai/qwen3-vl-abliterated:4b';

let pass = 0, fail = 0;
const check = (l, ok, d) => {
  if (ok === true) { pass++; console.log('  ok  ' + l); }
  else { fail++; console.log('  FAIL ' + l + (d === undefined ? '' : ' => ' + JSON.stringify(d).slice(0, 300))); }
};

let ollamaHao = false;
try {
  const r = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(4000) });
  const j = await r.json();
  ollamaHao = Array.isArray(j.models) && j.models.some((m) => String(m.name) === MO);
} catch { /* 没起 */ }
if (!ollamaHao) {
  console.log('本机 Ollama 不可用（或没有 ' + MO + '）⇒ 不跑（不假绿）');
  process.exit(1);
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const profile = path.join(os.tmpdir(), 'warmy-r33-live-' + Date.now());
fs.mkdirSync(profile, { recursive: true });
const child = spawn(electron, [
  '--remote-debugging-port=' + PORT,
  '--disable-features=CalculateNativeWinOcclusion',
  '--user-data-dir=' + profile,
  mainJs,
], { cwd: pkgRoot, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false, env });

let c = null;
const jieShu = () => { try { if (c) c.close(); } catch { /* noop */ } try { child.kill('SIGKILL'); } catch { /* noop */ } };
async function js(e) {
  return c.evaluate('(async function(){ try { return await (' + e + '); } catch (err) { return { __err: String((err && (err.stack || err.message)) || err).slice(0, 300) }; } })()');
}
async function pao(name, payloadJs, fenZhong) {
  const k = '__r33_' + name;
  await js(`(function(){ window[${JSON.stringify(k)}] = { done: false }; window.warmy.chatSend(${payloadJs}).then((r) => { window[${JSON.stringify(k)}] = { done: true, r: r }; }).catch((e) => { window[${JSON.stringify(k)}] = { done: true, err: String((e && e.message) || e) }; }); return true; })()`);
  const dao = Date.now() + fenZhong * 60000;
  for (;;) {
    await sleep(5000);
    const s = await js(`(function(){ return window[${JSON.stringify(k)}] || { done: false }; })()`);
    if (s && s.done) return s.r || { ok: false, error: s.err || 'unknown' };
    if (Date.now() > dao) return { ok: false, error: 'timeout-' + fenZhong + 'min' };
  }
}

/** 一次场景：发任务 → 等回复 → 读计划 → 断言 */
async function changJing(name, sid, content, fenZhong) {
  console.log('\n--- 场景 ' + name + ' ---');
  await js(`(async function(){
    await window.warmy.toolEnable({ name: 'write_file', enabled: true });
    await window.warmy.toolEnable({ name: 'open_path', enabled: true });
    await window.warmy.groupCreate({ groupId: ${JSON.stringify(sid)}, ming: 'R33 ' + ${JSON.stringify(name)}, type: 'internal', directedMode: false, devEnv: 'host' });
    return true;
  })()`.replace(/\n\s*/g, ' '));
  const t0 = Date.now();
  const fa = await pao(name.replace(/[^a-zA-Z0-9]/g, ''), `{ sessionId: ${JSON.stringify(sid)}, content: ${JSON.stringify(content)}, ming: '验收牛马', role: 'user' }`, fenZhong);
  const miao = Math.round((Date.now() - t0) / 1000);
  console.log('  · ok=' + fa.ok + ' 用时 ' + miao + 's 回复=' + String(fa.reply || '').replace(/\n/g, ' ').slice(0, 100));
  check(name + '：拿到非空最终回复', fa.ok === true && String(fa.reply || '').trim().length > 8, { ok: fa.ok, err: fa.error });
  const jiHua = await js(`(async function(){ const r = await window.warmy.jiHuaLieBiao({ sessionId: ${JSON.stringify(sid)} }); return r || { ok: false }; })()`);
  const bu = ((jiHua && jiHua.steps) || []).filter((x) => x.leiXing !== 'info');
  const xuan = bu.filter((x) => x.status === 'pending' || x.status === 'doing');
  console.log('  · 计划：', bu.map((x) => x.id + '=' + x.status).join(' ') || '(无计划)');
  check(name + '：计划不留悬挂 pending/doing', xuan.length === 0, xuan.map((x) => x.id + ':' + x.title));
  return { fa, bu };
}

console.log('=== verify-round33-live（多任务顺利跑完）===');
try {
  let shang = false;
  for (let i = 0; i < 120; i += 1) {
    try { const rr = await fetch('http://127.0.0.1:' + PORT + '/json', { signal: AbortSignal.timeout(1200) }); if (rr.ok) { shang = true; break; } } catch { /* 等 */ }
    await sleep(500);
  }
  if (!shang) { console.log('CDP 起不来'); jieShu(); process.exit(2); }
  await sleep(6000);
  c = await attach(PORT, { biaoQian: 'r33live', callTimeout: 120000 });
  await c.send('Runtime.enable');
  await sleep(2000);

  await js(`(async function(){
    await window.warmy.settingsSave({
      yuYan: 'zh-CN', setupDone: true, privacyConsent: true, guideDone: true,
      providers: [{ id: 'ollama', biaoQian: 'Ollama', protocol: 'ollama', baseURL: 'http://127.0.0.1:11434', defaultModel: ${JSON.stringify(MO)}, models: [${JSON.stringify(MO)}], staleModels: [], hasKey: true }],
      specialModels: { chatChain: [${JSON.stringify(MO)}], chatDisabled: [], chatManual: true, asrChain: [], ttsChain: [], embedChain: [], imageUndChain: [], imageUndDisabled: [] },
    });
    return true;
  })()`.replace(/\n\s*/g, ' '));

  const biao = 'r33-' + Date.now().toString(36);
  // A. 多步 + 等待（真机卡死的就是这一类）
  await changJing('A等待',
    'inst-' + biao + '-a',
    '请分三步做：① 在我的工作区创建文件 ' + biao + '-a.txt，内容写 hello；② 等待 5 秒（用 wait_seconds）；③ 用一句话告诉我结果和文件完整路径。',
    10);

  // B. 多步 + 两产物 + 打开
  await changJing('B两产物',
    'inst-' + biao + '-b',
    '请分三步做：① 在我的工作区创建 ' + biao + '-b1.txt（内容写 A）；② 创建 ' + biao + '-b2.txt（内容写 B）；③ 用 open_path 打开第一个文件，并告诉我两个文件的完整路径。',
    10);

  // 审计：不许有"跳过步骤"与重复产物
  const auditLu = path.join(profile, 'audit', 'audit.jsonl');
  const au = fs.existsSync(auditLu) ? fs.readFileSync(auditLu, 'utf8') : '';
  const tiao = au.split('\n').filter((l) => l.includes('auto-continue-step-skipped'));
  check('没有「反复续派到顶被迫跳过步骤」', tiao.length === 0, tiao.slice(0, 2).map((x) => x.slice(0, 160)));
  const eb = au.split('\n').filter((l) => l.includes('file-locked') || l.includes('EBUSY'));
  check('没有 EBUSY 造成的写盘失败', eb.length === 0, eb.slice(0, 2).map((x) => x.slice(0, 160)));
  check('有按证据自动验证的审计（证明兜底真的生效）', au.includes('plan.evidence-autoverify') || au.includes('plan_verify'));

  console.log('\n==== verify-round33-live：过 ' + pass + ' · 败 ' + fail + ' ====');
  jieShu();
  process.exit(fail ? 1 : 0);
} catch (e) {
  console.log('异常：', String((e && e.message) || e).slice(0, 300));
  jieShu();
  process.exit(2);
}
