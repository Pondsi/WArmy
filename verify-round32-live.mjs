/**
 * 第 32 轮 项 11 真机门禁：**无最终回复**的根因回归。
 *
 * 复现条件（与用户现场一致）：
 *   · 一个**全新的 userData**（没有 `knowledge/` 目录 —— 首启/清理后就是这个状态）
 *   · 有附件 + 会让模型"声称完成"的指令（触发 false-claim 分支）
 * 旧代码在 `KnowledgeBase.save()` 抛 ENOENT ⇒ 整轮失败 ⇒ 换模型也全失败 ⇒ 永远没有最终回复。
 *
 * 断言：
 *   ① 真跑一轮拿到**非空最终回复**（ok:true）；
 *   ② 审计里**没有** `chat.model-degraded … ENOENT`；
 *   ③ `knowledge/knowledge.json` 被**自愈创建**出来。
 *
 * 跑法：node verify-round32-live.mjs   （需要本机 Ollama 在 127.0.0.1:11434）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { attach, sleep } from './packages/app-shell/scripts/cdp-lib.mjs';

const GEN = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(GEN, 'packages', 'app-shell');
const PORT = Number(process.env.R32_PORT || 9955);
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
  console.log('本机 Ollama 不可用（或没有 ' + MO + '）⇒ 真机门禁不跑（不假绿）');
  process.exit(1);
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const profile = path.join(os.tmpdir(), 'warmy-r32-live-' + Date.now());
fs.mkdirSync(profile, { recursive: true });

const child = spawn(electron, [
  '--remote-debugging-port=' + PORT,
  '--disable-features=CalculateNativeWinOcclusion',
  '--user-data-dir=' + profile,
  mainJs,
], { cwd: pkgRoot, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false, env });

let c = null;
const jieShu = () => {
  try { if (c) c.close(); } catch { /* noop */ }
  try { child.kill('SIGKILL'); } catch { /* noop */ }
};
async function js(biaoDaShi) {
  return c.evaluate('(async function(){ try { return await (' + biaoDaShi + '); } catch (e) { return { __err: String((e && (e.stack || e.message)) || e).slice(0, 300) }; } })()');
}
async function pao(name, payloadJs, fenZhong) {
  await js(`(function(){ window[${JSON.stringify('__r32_' + name)}] = { done: false }; window.warmy.chatSend(${payloadJs}).then((r) => { window[${JSON.stringify('__r32_' + name)}] = { done: true, r: r }; }).catch((e) => { window[${JSON.stringify('__r32_' + name)}] = { done: true, err: String((e && e.message) || e) }; }); return true; })()`);
  const dao = Date.now() + fenZhong * 60000;
  for (;;) {
    await sleep(5000);
    const s = await js(`(function(){ return window[${JSON.stringify('__r32_' + name)}] || { done: false }; })()`);
    if (s && s.done) return s.r || { ok: false, error: s.err || 'unknown' };
    if (Date.now() > dao) return { ok: false, error: 'timeout-' + fenZhong + 'min' };
  }
}

console.log('=== verify-round32-live（项 11 根因回归）===');
console.log('  · profile =', profile);
try {
  let shang = false;
  for (let i = 0; i < 120; i += 1) {
    try { const rr = await fetch('http://127.0.0.1:' + PORT + '/json', { signal: AbortSignal.timeout(1200) }); if (rr.ok) { shang = true; break; } } catch { /* 等 */ }
    await sleep(500);
  }
  if (!shang) { console.log('CDP 起不来'); jieShu(); process.exit(2); }
  await sleep(6000);
  c = await attach(PORT, { biaoQian: 'r32live', callTimeout: 120000 });
  await c.send('Runtime.enable');
  await sleep(2000);

  // 关键前置：**运行中**把 knowledge 目录删掉（复现首启/清理后的现场）
  // 注意：构造器启动时会建一次目录，所以"删掉之后再跑一轮"才是真正的复现条件。
  const kbLu = path.join(profile, 'knowledge');
  console.log('  · 启动后 knowledge 目录存在？', fs.existsSync(kbLu));
  fs.rmSync(kbLu, { recursive: true, force: true });
  check('起始状态没有 knowledge 目录（复现用户现场）', fs.existsSync(kbLu) === false, { kbLu });

  // 配 Ollama
  await js(`(async function(){
    await window.warmy.settingsSave({
      yuYan: 'zh-CN', setupDone: true, privacyConsent: true, guideDone: true,
      providers: [{ id: 'ollama', biaoQian: 'Ollama', protocol: 'ollama', baseURL: 'http://127.0.0.1:11434', defaultModel: ${JSON.stringify(MO)}, models: [${JSON.stringify(MO)}], staleModels: [], hasKey: true }],
      specialModels: { chatChain: [${JSON.stringify(MO)}], chatDisabled: [], chatManual: true, asrChain: [], ttsChain: [], embedChain: [], imageUndChain: [], imageUndDisabled: [] },
    });
    return true;
  })()`.replace(/\n\s*/g, ' '));

  const biao = 'r32-' + Date.now().toString(36);
  const sid = 'inst-' + biao;
  await js(`(async function(){
    await window.warmy.toolEnable({ name: 'write_file', enabled: true });
    await window.warmy.groupCreate({ groupId: ${JSON.stringify(sid)}, ming: 'R32 验收', type: 'internal', directedMode: false, devEnv: 'host' });
    return true;
  })()`.replace(/\n\s*/g, ' '));

  // 真跑一轮：要求动手 + 会诱导"声称完成"（正是用户现场的分支）
  const t0 = Date.now();
  const fa = await pao('renwu', `{ sessionId: ${JSON.stringify(sid)}, content: '在我的工作区里创建文件 ${biao}.txt（内容写 ${biao}），然后用一句话告诉我结果和完整路径。', ming: '验收牛马', role: 'user' }`, 8);
  const miao = Math.round((Date.now() - t0) / 1000);
  console.log('  · 真跑 ok=' + fa.ok + ' 用时 ' + miao + 's 回复长度=' + String(fa.reply || '').length);
  console.log('  · 回复片段：' + String(fa.reply || '').replace(/\n/g, ' ').slice(0, 120));

  check('① 真跑一轮拿到非空最终回复（不再"计划都完成却没有回复"）',
    fa.ok === true && String(fa.reply || '').trim().length > 8,
    { ok: fa.ok, err: fa.error, hui: String(fa.reply || '').slice(0, 120) });

  // 审计：不许有 ENOENT 造成的模型降级
  const auditLu = path.join(profile, 'audit', 'audit.jsonl');
  const auditWen = fs.existsSync(auditLu) ? fs.readFileSync(auditLu, 'utf8') : '';
  const enoentHang = auditWen.split('\n').filter((l) => l.includes('ENOENT'));
  check('② 审计里没有 ENOENT 引发的模型降级', enoentHang.length === 0, enoentHang.slice(0, 2).map((x) => x.slice(0, 160)));

  // knowledge 自愈
  const kbXin = fs.existsSync(path.join(kbLu, 'knowledge.json'));
  check('③ knowledge.json 被自愈创建（写盘不再中断整轮）', kbXin === true, { kbLu: kbXin });

  // 文件真的落盘
  const luo = path.join(profile, 'workspace', sid, biao + '.txt');
  const cunZai = fs.existsSync(luo);
  if (cunZai) check('④ 产物真的落盘（不是嘴上说做了）', fs.readFileSync(luo, 'utf8').includes(biao));
  else console.log('  · 模型没落盘（本机小模型的自由度）⇒ 这一项不计入硬门禁');

  console.log('\n==== verify-round32-live：过 ' + pass + ' · 败 ' + fail + ' ====');
  jieShu();
  process.exit(fail ? 1 : 0);
} catch (e) {
  console.log('异常：', String((e && e.message) || e).slice(0, 300));
  jieShu();
  process.exit(2);
}
