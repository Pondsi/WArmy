/**
 * verify-r48-nengli-tongbu.mjs —— 模型能力（窗口 / 看图 / 工具）随设置**当场**生效 + 「手动添加模型」真的落盘（第 48 轮，真机 Ollama）
 *
 * 为什么有这支门禁（第 48 轮 `verify-round34-live` 本地腿 7 条红的共同根因）：
 *   设置里写进了 `modelCaps[模型].contextLen = 131072`，主进程的内存能力表却只在**启动时**读一次 ⇒
 *   预算按 32K 兜底 ⇒ 工具面被裁到 11 条（make_pptx / wait_seconds 没了）、两张图被减掉、输出留位压到 2048、
 *   27B 的思考吃光输出 ⇒ 空回复。额度窗读的却是落盘那份（显示 128K）—— 同一个模型两处口径打架。
 *   顺藤摸到的第二个洞：「手动添加模型」只把能力写进渲染层一个**没人读**的 `state.modelCaps`，
 *   供应商的模型列表也没落盘 ⇒ 主进程从来不知道它的窗口，重启后连模型都没了。
 *
 * 三段，全部打在真进程上（不 mock、不读源码）：
 *   A. 设置 API 写进 `modelCaps` ⇒ **不重启**，预算窗口立刻等于写进去的值（修之前停在 32768）；
 *   B. 走真界面「设置 → 模型 → 手动添加模型」，真的对本机 Ollama 做一次验证 ⇒ 能力落盘、供应商模型列表落盘、
 *      预算与额度窗都按用户填的窗口/输出上限走；
 *   C. 同一个 profile 重启 ⇒ B 的结果一条不丢。
 *
 * 跑法：node dev/gates/verify-r48-nengli-tongbu.mjs   （要本机 Ollama 在 127.0.0.1:11434；不要密钥）
 * 负向验证：`R48N_MAIN_JS=<去掉同步那一行的主进程副本>` 跑 A 段必须红（见交接文档 §17）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const G = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PKG = path.join(G, 'packages', 'app-shell');
const MAIN = process.env.R48N_MAIN_JS ? path.resolve(process.env.R48N_MAIN_JS) : path.join(PKG, 'dist', 'electron-main.js');
const ELECTRON = path.join(PKG, 'node_modules', 'electron', 'dist', 'electron.exe');
const PORT = Number(process.env.R48N_PORT || 9963);
const OLLAMA = 'http://127.0.0.1:11434';
const PID = 'ollama-r48n';
const { attach, sleep, bootWait } = await import(pathToFileURL(path.join(PKG, 'scripts', 'cdp-lib.mjs')).href);

let ok = 0; const shi = [];
const jian = (l, p, d) => { if (p) { ok += 1; console.log('  ok   ' + l); return; } shi.push(l); console.log('  FAIL ' + l + (d !== undefined ? ' ← ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 320) : '')); };

/** 本机真有的两个可对话模型（小的优先；没有就判红，不跳过） */
const tags = await fetch(OLLAMA + '/api/tags', { signal: AbortSignal.timeout(8000) }).then((r) => r.json()).catch(() => null);
const ming = (tags && Array.isArray(tags.models) ? tags.models : []).map((m) => ({ n: String(m.name || ''), s: Number(m.size) || 0, f: String((m.details && m.details.family) || '') }));
const keLiao = ming.filter((m) => m.n && m.s > 0 && !/bert|embed|whisper/i.test(m.n + ' ' + m.f)).sort((a, b) => a.s - b.s);
const M1 = (ming.find((m) => m.n === 'huihui_ai/qwen3-vl-abliterated:4b') || keLiao[0] || {}).n;
const M2 = (ming.find((m) => m.n === 'huihui_ai/qwen3-vl-abliterated:8b') || keLiao.find((m) => m.n !== M1) || {}).n;
if (!M1 || !M2) {
  jian('本机 Ollama 至少有两个可对话的模型（本门禁要真供应商）', false, ming.map((m) => m.n));
  console.log(`\n[verify-r48-nengli-tongbu] ${ok} ok / ${shi.length} FAIL`);
  process.exit(1);
}
console.log(`模型：A 段 ${M1} · B/C 段 ${M2}`);

const profile = path.join(os.tmpdir(), 'warmy-r48-nengli-' + Date.now());
fs.mkdirSync(profile, { recursive: true });
const sheZhiWen = path.join(profile, 'settings.json');
fs.writeFileSync(sheZhiWen, JSON.stringify({
  yuYan: 'zh-CN', setupDone: true, privacyConsent: true, guideDone: true, providersSeeded: true,
  globalSecurity: 'normal', trustedFolders: [], asrEnabled: false, specialModels: {},
  providers: [{ id: PID, biaoQian: 'Ollama-r48n', protocol: 'ollama', baseURL: OLLAMA, defaultModel: '', models: [M1], staleModels: {}, hasKey: false }],
  activeProvider: { presetId: PID, baseURL: OLLAMA, model: M1, protocol: 'ollama' },
  instances: [],
}, null, 2), 'utf8');
const du = () => JSON.parse(fs.readFileSync(sheZhiWen, 'utf8'));
const shenJi = () => {
  try {
    return fs.readFileSync(path.join(profile, 'audit', 'audit.jsonl'), 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
};

let child = null;
let c = null;
const js = (e) => c.evaluate('(async function(){ try { return await (' + e + '); } catch (err) { return { __err: String((err && (err.stack||err.message)) || err).slice(0,240) }; } })()');

async function qiDong(biao) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.MIMO_KEY_FILE;
  child = spawn(ELECTRON, ['--remote-debugging-port=' + PORT, '--disable-features=CalculateNativeWinOcclusion', '--user-data-dir=' + profile, MAIN],
    { cwd: PKG, stdio: ['ignore', 'ignore', 'ignore'], env });
  let lian = false;
  for (let i = 0; i < 90; i++) { try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) { lian = true; break; } } catch { /* 还没起 */ } await sleep(1000); }
  if (!lian) throw new Error(biao + '：CDP 起不来');
  c = await attach(PORT, { biaoQian: 'r48n', callTimeout: 240000 });
  await c.send('Runtime.enable');
  try { await bootWait(c, '', 60000); } catch { /* 起没起全由后面的断言判 */ }
  await sleep(1500);
}
async function guanBi() {
  try { c && c.close && c.close(); } catch { /* noop */ }
  c = null;
  if (child && child.pid) {
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { /* 已退出 */ }
    for (let i = 0; i < 40 && child.exitCode === null; i++) await sleep(250);
  }
  child = null;
  await sleep(1200);
}
const yuSuan = () => js(`window.warmy.shangXiaWenYuSuan({ sessionId: 'r48n-wu-hui-hua' })`);

try {
  await qiDong('第 1 次启动');

  // ── A. 设置 API 写 modelCaps ⇒ 不重启，预算窗口立刻跟上 ──
  const a0 = await yuSuan();
  jian('A0 预算查询问的就是 A 段模型，且起步窗口**不是**待会儿要写的 65536（否则这段区分不出修没修）',
    !!a0 && a0.ok === true && a0.model === M1 && Number(a0.maxTokens) !== 65536, a0);
  const bao = await js(`window.warmy.settingsSave(${JSON.stringify({ modelCaps: { [M1]: { contextLen: 65536, kind: 'chat', tools: true, vision: true } } })})`);
  const a1 = await yuSuan();
  jian('A1 写进 modelCaps 后**不重启**，预算窗口当场 = 65536（修之前停在兜底的 32768：能力表只在启动时读一次）',
    !!bao && bao.ok === true && !!a1 && Number(a1.maxTokens) === 65536, { bao: bao && bao.ok, a0: a0 && a0.maxTokens, a1: a1 && a1.maxTokens });
  const capA = await js(`window.warmy.modelCapsGet()`);
  const nA = capA && capA.caps && capA.caps[M1];
  jian('A2 能力表（落盘 + 内存合并的那份）读得到窗口与看图/工具能力',
    !!nA && Number(nA.contextLen) === 65536 && nA.vision === true && nA.tools === true, nA);
  const tongBu = shenJi().filter((r) => r.op === 'model.caps-synced');
  jian('A3 同步留了审计（model.caps-synced · from=settings-save）', tongBu.some((r) => r.detail && r.detail.from === 'settings-save' && r.detail.n >= 1), tongBu.map((r) => r.detail));

  // ── B. 手动添加模型：真实 IPC + 落盘（弹窗 UI 用静态断言防删） ──
  const appJs = fs.readFileSync(path.join(PKG, 'src', 'renderer', 'app.js'), 'utf8');
  jian('B0 手动添加模型的 UI 入口仍在（供应商卡片 data-manual-add + shouDongMoXingTan 弹窗）',
    /data-manual-add=/.test(appJs) && /shouDongMoXingTan/.test(appJs) && /shouDongMoXingYanZheng/.test(appJs));
  const tian = await js(`window.warmy.shouDongMoXingYanZheng({ providerId: ${JSON.stringify(PID)}, model: ${JSON.stringify(M2)}, contextLen: 48000, maxOut: 4000, inputTypes: ['text','image'], outputTypes: ['text'], caps: ['chat','tools','vision'] })`);
  jian('B1 手动添加走真实 IPC（48k 窗口 / 4k 输出 / 输入含图像 / 对话+工具+看图）',
    !!tian && tian.ok === true && !tian.__err, tian);
  const s3b = await js('window.warmy.settingsGet()');
  const provs = ((s3b && s3b.settings && s3b.settings.providers) || []).map((x) => x && x.id === PID ? { ...x, models: [...new Set([...(x.models || []), M2])] } : x);
  const saveB = await js(`window.warmy.settingsSave(${JSON.stringify({ providers: provs })})`);
  const pan = du();
  const gy = (pan.providers || []).find((x) => x && x.id === PID);
  jian('B2 供应商的模型列表落盘了这个手动加的模型（不是只改内存）',
    !!saveB && saveB.ok === true && !!gy && Array.isArray(gy.models) && gy.models.includes(M2), { save: saveB && saveB.ok, models: gy && gy.models });
  const nP = pan.modelCaps && pan.modelCaps[M2];
  jian('B3 能力落盘：窗口 48000、输出 4000、对话类、能用工具、能看图（单位 k = 1000）',
    !!nP && Number(nP.contextLen) === 48000 && Number(nP.maxOut) === 4000 && nP.kind === 'chat' && nP.tools === true && nP.vision === true, nP);
  const ma = shenJi().filter((r) => r.op === 'model.manual-add');
  jian('B4 留了审计（model.manual-add，带模型与窗口）', ma.some((r) => r.detail && r.detail.model === M2 && r.detail.contextLen === 48000), ma.map((r) => r.detail));
  const capB = await js('window.warmy.modelCapsGet()');
  const nB = capB && capB.caps && capB.caps[M2];
  jian('B5 界面能力表立刻有它（徽章/警示图标可用）', !!nB && nB.vision === true && nB.tools === true, nB);
  const qie = await js(`window.warmy.setProvider(${JSON.stringify({ presetId: PID, protocol: 'ollama', baseURL: OLLAMA, model: M2 })})`);
  const b7 = await yuSuan();
  jian('B7 切到这个模型后，预算窗口 = 用户填的 48000（主进程真的知道它的窗口）',
    !!qie && qie.ok === true && !!b7 && b7.model === M2 && Number(b7.maxTokens) === 48000, { model: b7 && b7.model, maxTokens: b7 && b7.maxTokens });
  const e8 = await js(`window.warmy.modelQuotaGet({ modelId: ${JSON.stringify(M2)} })`);
  jian('B8 额度窗的默认值也按它走：窗口 48000 / 输出 4000，来源如实写「拉取信息」以外的猜测一个都没有',
    !!e8 && e8.ok === true && e8.moren && e8.moren.ctx && e8.moren.ctx.tokens === 48000 && e8.moren.out && e8.moren.out.tokens === 4000
    && e8.laiYuan && !/默认 128K/.test(String(e8.laiYuan.chuangKou || '')) && !/未规定/.test(String(e8.laiYuan.shuChu || '')),
    e8 && { moren: e8.moren, laiYuan: e8.laiYuan });

  // ── C. 同一个 profile 重启 ⇒ 一条不丢 ──
  await guanBi();
  await qiDong('第 2 次启动');
  const c1 = await yuSuan();
  jian('C1 重启后预算仍按 48000 算（能力从落盘读回）', !!c1 && c1.model === M2 && Number(c1.maxTokens) === 48000, { model: c1 && c1.model, maxTokens: c1 && c1.maxTokens });
  const s2 = await js(`window.warmy.settingsGet()`);
  const gy2 = s2 && s2.settings && (s2.settings.providers || []).find((p) => p && p.id === PID);
  jian('C2 重启后供应商模型列表里还有它', !!gy2 && Array.isArray(gy2.models) && gy2.models.includes(M2), gy2 && gy2.models);
  const cap2 = await js(`window.warmy.modelCapsGet()`);
  const n2 = cap2 && cap2.caps && cap2.caps[M2];
  jian('C3 重启后能力表里窗口/看图/工具都在', !!n2 && Number(n2.contextLen) === 48000 && n2.vision === true && n2.tools === true, n2);
  const a2 = cap2 && cap2.caps && cap2.caps[M1];
  jian('C4 A 段经设置 API 写进去的那条重启后也在（落盘与内存是同一份事实）', !!a2 && Number(a2.contextLen) === 65536, a2);
} catch (e) {
  jian('整条路跑完没抛错', false, String((e && e.message) || e).slice(0, 240));
} finally {
  await guanBi();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 句柄可能还没放，下面再试一次 */ }
  if (fs.existsSync(profile)) { await sleep(2500); try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 留给收尾清理 */ } }
}
console.log(`\n[verify-r48-nengli-tongbu] ${ok} ok / ${shi.length} FAIL`);
process.exit(shi.length ? 1 : 0);
