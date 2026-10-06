/**
 * 门禁：**「加强 AI 语言约束」这个勾真的生效吗**（用户明确要求"验证它"）。
 *
 * 只读代码是证明不了"真的生效"的，所以这里做**端到端**验证：
 *   全新 profile 起真 Electron → 把这个勾**打开** → 发一条消息
 *   （指向一个连不上的本地 Ollama：请求会失败，但**提示词是在发请求之前拼好的**）
 *   → 去审计日志里查 `chat.lang-constraint`：
 *       勾上  ⇒ 必须有一条 on:true，且带上目标语言、注入字符数 > 0；
 *       不勾  ⇒ 必须 on:false（不干涉模型自己选语言）。
 *   两次对照 ⇒ 这个勾**真的改变了发给模型的东西**，不是摆设。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { attach, sleep } from './cdp-lib.mjs';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(selfDir, '..');
const PORT = Number(process.env.WARMY_LANG_CDP_PORT || 9988);
const electron = path.join(pkgRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const mainJs = path.join(pkgRoot, 'dist', 'electron-main.js');
const profile = path.join(os.tmpdir(), 'warmy-lang-gate-profile');

let pass = 0;
let fail = 0;
function check(l, ok, d) {
  if (ok) { pass++; console.log('  ok  ' + l); }
  else { fail++; console.log('  FAIL ' + l, d === undefined ? '' : JSON.stringify(d).slice(0, 400)); }
}

fs.rmSync(profile, { recursive: true, force: true });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [
  `--remote-debugging-port=${PORT}`,
  '--disable-features=CalculateNativeWinOcclusion',
  `--user-data-dir=${profile}`,
  mainJs,
], { cwd: pkgRoot, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false, env });

async function waitCdp(secs = 40) {
  for (let i = 0; i < secs; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json`, { signal: AbortSignal.timeout(1200) }); if (r.ok) return true; } catch { /* retry */ }
    await sleep(500);
  }
  return false;
}

/** 审计日志里所有 chat.lang-constraint 记录 */
function duLangJiLu() {
  const p = path.join(profile, 'audit', 'audit.jsonl');
  try {
    return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((x) => x && x.op === 'chat.lang-constraint')
      .map((x) => x.detail || {});
  } catch { return []; }
}

let c = null;
function jieShu() {
  try { if (c) c.close(); } catch { /* noop */ }
  try { child.kill('SIGKILL'); } catch { /* noop */ }
}

try {
  if (!(await waitCdp())) { console.error('CDP not up'); jieShu(); process.exit(2); }
  await sleep(4500);
  c = await attach(PORT, { biaoQian: 'lang-gate', callTimeout: 30000 });
  await c.send('Runtime.enable');

  // ① 装一个"连不上的本地 Ollama"当模型：请求必然失败，但提示词已经拼好了
  const zhunBei = await c.evaluate(`(async function(){
    const r1 = await window.warmy.settingsSave({
      activeProvider: { presetId: 'ollama-lang-gate', apiKey: '', baseURL: 'http://127.0.0.1:9', model: 'gate-model', protocol: 'ollama' },
      providers: [{ id: 'ollama-lang-gate', protocol: 'ollama', models: ['gate-model'], defaultModel: 'gate-model' }],
      yuYan: 'zh-CN',
    });
    const r2 = await window.warmy.settingsGet();
    return { save: r1 && r1.ok, preset: r2 && r2.settings && r2.settings.activeProvider && r2.settings.activeProvider.presetId };
  })()`);
  console.log('  · 准备: ' + JSON.stringify(zhunBei));
  check('能写入"语言 + 供应商"设置（门禁自身前置条件）', zhunBei.save === true, zhunBei);

  // ② 关闭这个勾 → 发一条消息 → 应当是 on:false
  await c.evaluate(`(async function(){
    await window.warmy.settingsSave({ strictAiLanguage: false, yuYan: 'zh-CN' });
    await window.warmy.chatSend({ sessionId: 'lang-gate-s', content: '门禁：关掉语言约束时说一句' }).catch(() => null);
    return true;
  })()`);
  await sleep(2500);
  const guan = duLangJiLu();
  console.log('  · 关掉时: ' + JSON.stringify(guan.slice(-2)));
  check('关掉这个勾 ⇒ 审计里 on:false（不注入约束）', guan.some((x) => x.on === false) && !guan.some((x) => x.on === true), guan.slice(-3));

  // ③ 打开这个勾 → 再发一条 → 应当是 on:true 且带上目标语言与注入字符数
  await c.evaluate(`(async function(){
    await window.warmy.settingsSave({ strictAiLanguage: true, yuYan: 'zh-CN' });
    await window.warmy.chatSend({ sessionId: 'lang-gate-s', content: '门禁：打开语言约束时说一句' }).catch(() => null);
    return true;
  })()`);
  await sleep(3000);
  const kai = duLangJiLu();
  const zuiHou = kai[kai.length - 1] || {};
  console.log('  · 打开时: ' + JSON.stringify(zuiHou));
  check('打开这个勾 ⇒ 审计里 on:true（真的注入了约束）', zuiHou.on === true, zuiHou);
  check('注入时带上了目标语言（简中 → zh-CN）', zuiHou.lang === 'zh-CN', zuiHou);
  check('确实注入了内容（字符数 > 0）', Number(zuiHou.chars) > 10, zuiHou);
  check('开关两次的结果确实不同（不是恒真/恒假）', kai.some((x) => x.on === false) && kai.some((x) => x.on === true), kai.map((x) => x.on));

  // ④ 静态：约束文案 10 语言齐备，且标签里那对括号已去掉（本轮产品要求）
  const i18nDir = path.join(pkgRoot, 'src', 'i18n');
  let queShi = 0;
  let haiYouKuoHao = 0;
  for (const fn of fs.readdirSync(i18nDir).filter((x) => x.endsWith('.json'))) {
    const o = JSON.parse(fs.readFileSync(path.join(i18nDir, fn), 'utf8'));
    if (!o['llm.strictLanguage'] || !String(o['llm.strictLanguage']).trim()) { queShi++; console.log('  缺 llm.strictLanguage:', fn); }
    const biao = String(o['settings.strictAiLanguage'] || '');
    if (/[（(].*[）)]/.test(biao)) { haiYouKuoHao++; console.log('  标签里还有括号:', fn, biao); }
  }
  check('10 语言都有「语言约束」提示词', queShi === 0, { queShi });
  check('设置项标签已去掉括号里的那截说明（10 语言都干净）', haiYouKuoHao === 0, { haiYouKuoHao });

  const emTs = fs.readFileSync(path.join(pkgRoot, 'src', 'electron-main.ts'), 'utf8');
  check('源码：只有勾上才注入（勾上/没勾两条审计）', /const yueGe = .*strictAiLanguage/.test(emTs) && /if \(yueGe\) \{/.test(emTs) && /on: true/.test(emTs) && /on: false/.test(emTs), 'gating');
  check('源码：目标语言取自界面语言设置（不是写死中文）', /yuYan\?: string/.test(emTs) && /app\.getLocale\(\)/.test(emTs));
} catch (e) {
  console.error('门禁异常: ' + ((e && e.stack) || e));
  fail += 1;
}

jieShu();
await sleep(600);
try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch { /* noop */ }
console.log(`\n==== verify-strict-language: ${pass} ok / ${fail} FAIL ====`);
process.exit(fail ? 1 : 0);
