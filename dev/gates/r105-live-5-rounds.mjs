/**
 * r105-live-5-rounds.mjs —— 第 105 轮 5 轮真实验收（MiMo，不用 DeepSeek）：
 * R1 纯问答 / R2 多工具+中间回复切段 / R3 中途停止+继续 / R4 设置+4K+短问答 / R5 上下文记忆。
 * 用 MiMo（不读 DeepSeek key）跑一个“先说明、再调用工具、再说明、再调用工具”的任务，
 * 检查界面是否变成：
 *   · 多个默认折叠的「执行过程」段；
 *   · 中间回复是无标题、不可折叠的浮雕卡；
 *   · 不再出现旧“过程引用卡”。
 *
 * 临时 profile + 独立端口，不碰真实 profile。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PKG = path.join(ROOT, 'packages/app-shell');
const { attach, sleep } = await import(pathToFileURL(path.join(PKG, 'scripts/cdp-lib.mjs')).href);
const KEY_DIR = process.env.WARMY_KEY_DIR || path.dirname(ROOT);
const PORT = 9910;
const MI = 'mimo-v2.6-pro';
const BASE = 'https://token-plan-cn.xiaomimimo.com/v1';
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('PASS ' + n + (d ? ' (' + d + ')' : '')); } else { fails.push(n + (d ? ' :: ' + d : '')); console.log('FAIL ' + n + (d ? ' ' + d : '')); } };
function firstKey(re) {
  try {
    for (const f of fs.readdirSync(KEY_DIR)) {
      if (!/\.txt$/i.test(f)) continue;
      const p = path.join(KEY_DIR, f);
      if (fs.statSync(p).size > 2 * 1024 * 1024) continue;
      const t = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
      if (/tp-[A-Za-z0-9]{20,}/.test(t)) { const m = t.match(re); if (m) return m[0]; }
    }
  } catch { /* noop */ }
  return '';
}
const KEY = firstKey(/tp-[A-Za-z0-9]{20,}/);
if (!KEY) { console.error('没有 MiMo token'); process.exit(2); }
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-r105-seg-'));
const tag = 'R105-' + Math.random().toString(36).slice(2, 8).toUpperCase();
const instance = {
  id: 'n01', ming: '分段验收牛马', name: '分段验收牛马', status: 'running', dutyEligible: true, notify: true,
  model: MI, defaultModel: MI, chain: [MI], chainDisabled: [], persona: '需要用工具时真的执行；在每次工具调用前先用一句自然语言说明。',
};
const settings = {
  yuYan: 'zh-CN', setupDone: true, privacyConsent: true, guideDone: true, guideChatDone: true, providersSeeded: true,
  timezone: 'Asia/Shanghai',
  providers: [{ id: 'mimo', biaoQian: 'MiMo', protocol: 'openai-compatible', baseURL: BASE, models: [MI], defaultModel: '', staleModels: [], hasKey: true }],
  modelCaps: { [MI]: { contextLen: 128000, kind: 'chat', tools: true, vision: false } },
  specialModels: { chatChain: [MI], organizerChain: [MI] },
  instances: [instance],
  activeProvider: { presetId: 'mimo', baseURL: BASE, model: MI, protocol: 'openai-compatible' },
  contextBudgetPercent: 60, modelContextTokens: 128000, contextToolMaxRounds: 8, autoSummary: true,
  globalSecurity: 'normal', askOnExceed: false,
};
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify(settings, null, 2), 'utf8');

const env = { ...process.env, WARMY_AUTH_BYPASS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(path.join(PKG, 'node_modules/electron/dist/electron.exe'), ['--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, path.join(PKG, 'dist/electron-main.js')], { cwd: PKG, stdio: ['ignore', 'ignore', 'ignore'], env });
const fail = (e) => { console.error('FAIL', e && e.message); fails.push(String(e && e.message)); };
try {
  let c = null;
  for (let i = 0; i < 160; i++) { try { c = await attach(PORT, { biaoQian: 'r105-seg', callTimeout: 240000 }); break; } catch { await sleep(300); } }
  if (!c) throw new Error('CDP 连接失败');
  for (let i = 0; i < 160; i++) { const v = await c.evaluate('window.__warmyBootDataReady === true').catch(() => false); if (v) break; await sleep(300); }
  await sleep(1500);
  const keySet = await c.evaluate(`window.warmy.providerKeySet({ providerId: 'mimo', apiKey: ${JSON.stringify(KEY)} })`, { awaitPromise: true });
  ok('MiMo 密钥写入 SecureKeyStore', keySet && keySet.ok === true);
  const sp = await c.evaluate(`window.warmy.setProvider({ presetId: 'mimo', baseURL: ${JSON.stringify(BASE)}, protocol: 'openai-compatible', model: ${JSON.stringify(MI)} })`, { awaitPromise: true });
  ok('MiMo 供应商可用', sp && sp.ok === true);
  for (let i = 0; i < 160; i++) { const x = await c.evaluate('window.warmy.listInstances()').catch(() => null); if (Array.isArray(x) && x.some((n) => n.status === 'running')) break; await sleep(300); }
  // 临时 profile 没有默认会话：先落一条用户日志，再重载让会话列表恢复
  await c.evaluate("window.warmy.chatLogAppend({ sessionId: 'n01', role: 'user', content: '第105轮分段验收会话' })", { awaitPromise: true }).catch(() => {});
  await c.evaluate('location.reload()', { awaitPromise: true }).catch(() => {});
  await sleep(2500);
  for (let i = 0; i < 100; i++) { const v = await c.evaluate('window.__warmyBootDataReady === true').catch(() => false); if (v) break; await sleep(300); }
  await sleep(1000);
  // 进入单聊并选中第一个会话
  await c.evaluate(`document.querySelector('[data-nav="singleAi"]')?.click()`, { awaitPromise: true }).catch(() => {});
  await sleep(500);
  await c.evaluate(`(function(){const it=document.querySelector('#lieBiaoTi .lieBiaoTiaoMu'); if(it) it.click(); return true;})()`, { awaitPromise: true }).catch(() => {});
  await sleep(800);
  const sid = await c.evaluate(`(async function(){const all=[...document.querySelectorAll('#lieBiaoTi .lieBiaoTiaoMu')]; const cur=all.find(x=>x.classList.contains('xuanZhong'))||all[0]; cur?.click(); await new Promise(r=>setTimeout(r,500)); return Object.keys(window.__msgs||{})[0] || (await window.warmy.chatMessages({sessionId:'n01'})).ok && 'n01' || '';})()`, { awaitPromise: true }).catch(() => '');
  ok('选中一个真实会话', !!sid, String(sid || ''));
  const count = () => c.evaluate(`(window.__msgs[${JSON.stringify(sid)}]||[]).length`);
  const busy = () => c.evaluate(`!document.getElementById('yunXingZhuangTai')?.classList.contains('yinCang')`);
  const sendPrompt = async (text, timeout = 300000) => {
    const n0 = await count();
    await c.evaluate(`(function(){const t=document.getElementById('shuRu'); t.value=${JSON.stringify(text)}; t.dispatchEvent(new Event('input',{bubbles:true})); document.getElementById('anNiuFaSong').click(); return true;})()`, { awaitPromise: true });
    const t0 = Date.now();
    for (;;) {
      await sleep(900);
      const last = await c.evaluate(`JSON.stringify((window.__msgs[${JSON.stringify(sid)}]||[]).slice(-1)[0]||null)`, { awaitPromise: true });
      const n = await count();
      const b = await busy();
      if (!b && n > n0 && last && JSON.parse(last).role === 'them') return JSON.parse(last);
      if (Date.now() - t0 > timeout) {
        const dbg = await c.evaluate(`(()=>{const arr=window.__msgs[${JSON.stringify(sid)}]||[]; const last=arr[arr.length-1]; return {n:arr.length,last:last&&{role:last.role,text:String(last.text||'').slice(0,100),ts:last.ts,stopped:!!last.stopped},busy:!document.getElementById('yunXingZhuangTai')?.classList.contains('yinCang'),sendDisabled:!!document.getElementById('anNiuFaSong')?.disabled,input:String(document.getElementById('shuRu')?.value||'').slice(0,60),status:String(document.getElementById('yunXingZhuangTai')?.innerText||'').slice(0,120)};})()`, { awaitPromise: true }).catch(() => null);
        throw new Error('模型回复超时：' + text.slice(0, 30) + ' :: ' + JSON.stringify(dbg));
      }
    }
  };
  /** 第 1 轮：纯问答（与后面几轮内容完全不同） */
  const m1 = await sendPrompt('请只回答一个数字，不要解释：13 × 7 等于多少？');
  ok('R1 纯问答正确（91）', /91/.test(String(m1.text || '')), String(m1.text).slice(0, 40));
  ok('R1 旧过程引用卡不存在', (await c.evaluate(`document.querySelectorAll('.guoChengYinYong').length`, { awaitPromise: true })) === 0);
  /** 第 2 轮：多工具 + 中间回复切段 */
  const n0 = await count();
  const prompt = `请分两步完成，并严格遵守：每一步开始前先用一句自然语言告诉我要做什么（这句话要显示在聊天里），然后再调用工具；不要一次调用两个工具。\n第一步：用 write_file 在工作区写文件 ${tag}-A.txt，内容 ${tag}-A。\n第二步：用 write_file 在工作区写文件 ${tag}-B.txt，内容 ${tag}-B。\n最后用一句话确认两个文件都已写好。`;
  await c.evaluate(`(function(){const t=document.getElementById('shuRu'); t.value=${JSON.stringify(prompt)}; t.dispatchEvent(new Event('input',{bubbles:true})); document.getElementById('anNiuFaSong').click(); return true;})()`, { awaitPromise: true });
  const t0 = Date.now();
  let last = null;
  for (;;) {
    await sleep(1000);
    last = await c.evaluate(`JSON.stringify((window.__msgs[${JSON.stringify(sid)}]||[]).slice(-1)[0]||null)`, { awaitPromise: true });
    const n = await count();
    const b = await busy();
    if (!b && n > n0 && last && JSON.parse(last).role === 'them') break;
    if (Date.now() - t0 > 300000) throw new Error('模型回复超时');
  }
  const m = JSON.parse(last || '{}');
  ok('最终回复非空', String(m.text || '').trim().length > 0, String(m.text).slice(0, 60));
  ok('最终回复没有承诺“稍后做”而实际没调用工具', !/稍后|马上|将会/.test(String(m.text||'')) || /已|完成|写好/.test(String(m.text||'')));
  const ui = await c.evaluate(`(() => {
    const msgs = [...document.querySelectorAll('#xiaoXiJi .xiaoXi')].filter(x => x.dataset.role === 'them');
    const msg = msgs[msgs.length - 1];
    if (!msg) return null;
    return {
      seg: [...msg.querySelectorAll('.guoChengDuan')].map(x => ({ fen: Number(x.dataset.fen) || 0, open: x.open, acts: x.querySelectorAll('.xingDongZu').length, aria: x.getAttribute('aria-label') || '' })),
      mid: [...msg.querySelectorAll('.zhongJianKa')].map(x => {
        const body = x.querySelector('.zhongJianHuiFu');
        return { tag: x.tagName, hasOpen: x.hasAttribute('open'), summaries: x.querySelectorAll('summary').length,
          inProcess: !!x.closest('details.guoChengDuan'),
          visible: !!body && body.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && body.getBoundingClientRect().height > 0,
          text: (body?.innerText || '').slice(0, 80) };
      }),
      old: msg.querySelectorAll('.guoChengYinYong').length,
      acts: msg.querySelectorAll('.xingDongZu').length,
    };
  })()`, { awaitPromise: true });
  ok('旧过程引用卡不存在', ui && ui.old === 0, JSON.stringify(ui).slice(0, 200));
  ok('至少一个执行过程段', ui && ui.seg.length >= 1, JSON.stringify(ui).slice(0, 300));
  ok('所有执行过程段默认折叠', ui && ui.seg.every((x) => x.open === false), JSON.stringify(ui?.seg));
  ok('每个思考与执行段都有段序号+操作数的无障碍名称', ui && ui.seg.every((x) => /思考与执行第 \d+ 段 · \d+ 个操作/.test(x.aria) && x.aria.includes('第 ' + (x.fen + 1) + ' 段') && x.aria.includes(x.acts + ' 个操作')), JSON.stringify(ui?.seg));
  ok('至少一条中间回复浮雕卡', ui && ui.mid.length >= 1, JSON.stringify(ui).slice(0, 300));
  ok('中间回复卡是 details + summary（默认展开，不在执行段内）', ui && ui.mid.every((x) => x.tag === 'DETAILS' && x.hasOpen && x.summaries === 1 && !x.inProcess), JSON.stringify(ui?.mid));
  ok('执行过程折叠时中间回复正文仍可见', ui && ui.mid.every((x) => x.visible && x.text.trim().length > 0), JSON.stringify(ui?.mid));
  ok('有真实工具操作行', ui && ui.acts >= 1, String(ui?.acts));
  /** 第 3 轮：中途停止 + 停止后继续 */
  const stopPrompt = '请完成一个 6 步任务，每一步都必须调用工具：1) 写 ' + tag + '-S1.txt；2) 读回；3) 追加第二段；4) 再读回；5) 写 ' + tag + '-S2.txt；6) 读回并总结。每完成一步先告诉我进度。';
  const stopT0 = Date.now();
  await c.evaluate(`(function(){const t=document.getElementById('shuRu'); t.value=${JSON.stringify(stopPrompt)}; t.dispatchEvent(new Event('input',{bubbles:true})); document.getElementById('anNiuFaSong').click(); return true;})()`, { awaitPromise: true });
  for (let i = 0; i < 40; i++) { await sleep(500); if (await busy()) break; }
  await sleep(1800);
  const stopTs = Date.now();
  await c.evaluate(`document.getElementById('anNiuTingZhiAll')?.click()`, { awaitPromise: true }).catch(() => {});
  await sleep(1600);
  const mStop = JSON.parse(await c.evaluate(`JSON.stringify((window.__msgs[${JSON.stringify(sid)}]||[]).slice(-1)[0]||null)`, { awaitPromise: true }) || '{}');
  ok('R3 停止后出现 stopped 气泡', mStop && mStop.stopped === true, String(mStop && mStop.text).slice(0, 40));
  const actsAfter = await c.evaluate(`JSON.stringify((window.__xingDongQu?window.__xingDongQu(${JSON.stringify(sid)}):[]).filter(a => Number(a.ts) > ${stopTs}))`, { awaitPromise: true });
  await sleep(2500);
  const actsLater = await c.evaluate(`JSON.stringify((window.__xingDongQu?window.__xingDongQu(${JSON.stringify(sid)}):[]).filter(a => Number(a.ts) > ${stopTs}))`, { awaitPromise: true });
  ok('R3 停止后不再执行新操作', JSON.parse(actsLater || '[]').length === 0, actsLater.slice(0, 120));
  const mAfter = await sendPrompt('请只回答一个数字，不要解释：2 + 3 等于多少？');
  ok('R3 停止后还能继续对话（5）', /5/.test(String(mAfter.text || '')), String(mAfter.text).slice(0, 30));
  /** 第 4 轮：设置 / 4K 布局 + 短问答（内容不同） */
  await c.evaluate(`window.warmy.settingsSave({ themeMode: 'dark' })`, { awaitPromise: true }).catch(() => {});
  await sleep(500);
  const dark = await c.evaluate(`window.warmy.settingsGet()`, { awaitPromise: true });
  ok('R4 主题设置可保存并回读', dark?.settings?.themeMode === 'dark', JSON.stringify(dark?.settings?.themeMode));
  await c.send('Emulation.setDeviceMetricsOverride', { width: 3840, height: 2160, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  const k4 = await c.evaluate(`({ w: innerWidth, h: innerHeight, sw: document.documentElement.scrollWidth, tb: (document.querySelector('#biaoTiLan')||{getBoundingClientRect:()=>({height:0})}).getBoundingClientRect().height })`, { awaitPromise: true });
  ok('R4 3840×2160@100% 无横向溢出', k4 && k4.w === 3840 && k4.sw <= 3841, JSON.stringify(k4));
  ok('R4 4K@100% 标题栏放大到 46px', k4 && k4.tb >= 45, JSON.stringify(k4));
  await c.send('Emulation.clearDeviceMetricsOverride');
  await c.evaluate(`window.warmy.settingsSave({ themeMode: 'system' })`, { awaitPromise: true }).catch(() => {});
  const m4 = await sendPrompt('请用一句中文短诗描写清晨，不要解释。');
  ok('R4 4K/设置后模型仍能正常回复', String(m4.text || '').trim().length > 0, String(m4.text).slice(0, 40));
  /** 第 5 轮：上下文记忆（不同内容） */
  const m5a = await sendPrompt('请记住数字 517，只回复“记住了”。');
  ok('R5 记住指令有回复', String(m5a.text || '').trim().length > 0);
  const m5b = await sendPrompt('我刚才让你记住的数字是多少？只回答数字，不要解释。');
  ok('R5 下一轮能取回 517', /517/.test(String(m5b.text || '')), String(m5b.text).slice(0, 40));
  console.log('RESULT', JSON.stringify({ tag, sid, text: String(m.text || '').slice(0, 120), ui: ui && { seg: ui.seg, mid: ui.mid, acts: ui.acts } }).slice(0, 900));
  await c.evaluate(`window.warmy.appQuit('r105-seg')`, { awaitPromise: true }).catch(() => {});
  c.close();
} catch (e) { fail(e); }
finally {
  try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* noop */ }
  /** 失败时保留临时 profile 和审计尾，供下一次定位；成功后照常清理 */
  if (fails.length || process.env.R105_KEEP === '1') {
    console.log('PROFILE-KEPT ' + profile);
    try {
      const p = path.join(profile, 'audit', 'audit.jsonl');
      const hang = fs.readFileSync(p, 'utf8').trim().split('\n').slice(-40);
      console.log('AUDIT-TAIL\n' + hang.join('\n'));
    } catch { /* 没有审计文件就只留 profile */ }
  } else {
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
  }
}
console.log(`\nr105-live-5-rounds: ${pass} PASS / ${fails.length} FAIL`);
if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
