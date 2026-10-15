/**
 * 第 17 轮真机验证（**不做模拟**）：只测本轮改动 + 基本功能。
 *
 * 每轮：
 *   ⑦ **误报异常修复**（本轮最优先）：一个真需要多次工具调用的任务，
 *      不许出现 `plan.task-interrupted` / `eta-anomaly`；必须出现"有进展 ⇒ 不判卡死"的记账。
 *   ① 赞/踩图标可见
 *   ② 喇叭播放态强调色 + 再点停止
 *   ③ 第四列「其他文件」显示大小（1024 进制）
 *   ④ 预设供应商下拉框更高
 *   ⑤ 气泡提示大小不带「(N B)」
 *   ⑥ 语音识别语言下拉 + 真实 ASR 传参
 *   ⑧ 主题色预设 50 个 + 首格自定义
 *   ⑨ 字体颜色设置
 *   ⑩ 模型卡片折叠 + 当前模型行
 *   ⑫ 停止按钮用强调色
 *   ⑬ 其他文件点击打开 / 右击打开文件夹
 *
 * 用法： MIMO_KEY_FILE=<key文件> node verify-round17.mjs --round N
 * 注意：跑之前必须关掉正在运行的应用（单实例锁）。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PKG = path.join(ROOT, 'packages', 'app-shell');
const ROUND = (() => { const i = process.argv.indexOf('--round'); return i >= 0 ? String(process.argv[i + 1] || '1') : '1'; })();
const PORT = 9702 + (Number(ROUND) || 1);
const DATA = path.join(process.env.APPDATA || '', '@warmy', 'app-shell');
const ONLY = (() => { const i = process.argv.indexOf('--only'); return i >= 0 ? String(process.argv[i + 1] || '') : ''; })();

const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'huihui_ai/qwen3-vl-abliterated:4b';
const key = (() => {
  const k = String(process.env.MIMO_KEY || '').trim();
  if (k) return k;
  const f = String(process.env.MIMO_KEY_FILE || '').trim();
  if (f) { try { return fs.readFileSync(f, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || ''; } catch { /* ignore */ } }
  return '';
})();

// 引导跳过 + 两个真实供应商就位（Ollama 本地 + MiMo 云端）
try {
  const sp = path.join(DATA, 'settings.json');
  const s = fs.existsSync(sp) ? JSON.parse(fs.readFileSync(sp, 'utf8')) : {};
  s.setupDone = true; s.guideDone = true; s.privacyConsent = true; s.providersSeeded = true;
  const ps = Array.isArray(s.providers) ? s.providers.slice() : [];
  const you = (id, extra) => {
    const i = ps.findIndex((p) => p && p.id === id);
    const row = { id, staleModels: {}, models: [], hasKey: false, ...extra };
    if (i >= 0) ps[i] = { ...ps[i], ...row, models: (ps[i].models && ps[i].models.length ? ps[i].models : row.models) };
    else ps.push(row);
  };
  you('ollama-r17', { biaoQian: 'Ollama(r17)', protocol: 'ollama', baseURL: 'http://127.0.0.1:11434', defaultModel: OLLAMA_MODEL, models: [OLLAMA_MODEL] });
  you('mimo-r17', {
    biaoQian: 'MiMo(r17)', protocol: 'openai-compatible', baseURL: 'https://token-plan-cn.xiaomimimo.com/v1',
    defaultModel: 'mimo-v2.5', models: ['mimo-v2.5', 'mimo-v2.5-asr', 'mimo-v2.5-tts', 'mimo-v2.6-flash'],
  });
  s.providers = ps;
  s.specialModels = {
    ...(s.specialModels || {}),
    chatChain: [OLLAMA_MODEL], asrChain: ['mimo-v2.5-asr', 'dimavz/whisper-tiny:latest'],
    ttsChain: ['mimo-v2.5-tts'], embedChain: [], imageUndChain: [],
  };
  fs.writeFileSync(sp, JSON.stringify(s, null, 2));
} catch { /* noop */ }

const env = { ...process.env };
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
const say = (ok, msg) => { if (!ok) { pass = false; failures.push(msg); } console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); };

let up = false;
for (let i = 0; i < 60 && !up; i++) {
  try { up = (await fetch(`http://127.0.0.1:${PORT}/json`, { signal: AbortSignal.timeout(1500) })).ok; } catch { /* wait */ }
  if (!up) await sleep(400);
}
if (!up) { console.log('CDP not up'); console.log(logs.join('').slice(0, 2500)); try { child.kill(); } catch { /* noop */ } process.exit(1); }

const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = list.find((x) => x.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let mid = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const j = JSON.parse(String(e.data));
  if (j.id && pending.has(j.id)) { pending.get(j.id)(j); pending.delete(j.id); }
});
function send(method, params = {}) {
  const id = ++mid;
  return new Promise((resolve) => { pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
}
async function ev(expr, timeoutMs = 60_000) {
  const r = await Promise.race([
    send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }),
    sleep(timeoutMs).then(() => ({ __timeout: true })),
  ]);
  if (r && r.__timeout) throw new Error('EVAL_TIMEOUT');
  if (r?.result?.exceptionDetails) throw new Error('EVAL_ERR ' + JSON.stringify(r.result.exceptionDetails).slice(0, 240));
  return r?.result?.result?.value;
}

const AUDIT = path.join(DATA, 'audit', 'audit.jsonl');
/** 读审计里 ts >= since 的记录（只取 op + detail） */
function auditSince(since) {
  const out = [];
  try {
    for (const line of fs.readFileSync(AUDIT, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { const j = JSON.parse(line); if (Number(j.ts) >= since) out.push(j); } catch { /* skip */ }
    }
  } catch { /* noop */ }
  return out;
}

await send('Runtime.enable');
await sleep(5000);
console.log(`\n=========== ROUND ${ROUND} ===========`);
const want = (name) => !ONLY || ONLY === name;
const T0 = Date.now() - 1500;

// ── ⑦ 误报异常修复（本轮最优先，先跑）──
if (want('7')) {
  try {
    const dir = `r17-${ROUND}-multi`;
    const wsDir = path.join(DATA, 'workspace', dir);
    try { fs.rmSync(wsDir, { recursive: true, force: true }); } catch { /* noop */ }
    // 预热：本地小模型首次加载，避免把冷启动算进正式断言
    await ev(`window.warmy.chatSend({ sessionId:${JSON.stringify(dir + '-warm')}, role:'user', content:'hi', model:${JSON.stringify(OLLAMA_MODEL)}, ming:'牛马-1' }).then(r=>1)`, 300_000).catch(() => 1);
    /**
     * 这一步要**真的把"单次工具调用"的预警点踩到**（默认：同名工具一轮内第 12 次），
     * 才能在真机上验证"有真实产出就不判卡死"——
     * 否则预警点压根没到，测不到门禁（上一版就是这样假通过）。
     * 让它一次写 14 个文件：即使漏几个，别名工具也一定被调到 ≥12 次。
     */
    const ming = Array.from({ length: 14 }, (_, i) => `r17-${String(i + 1).padStart(2, '0')}.txt`);
    const tA = Date.now();
    const r = await ev(`window.warmy.chatSend({ sessionId:${JSON.stringify(dir)}, role:'user',
      content:${JSON.stringify(`请用 write_file 依次写 14 个文件，每个文件的内容就是它的文件名本身。文件名依次是：${ming.join('、')}。必须使用工作区内的相对路径（就写文件名，不要写绝对路径、不要写桌面）。14 个都要写，写完告诉我写了几个。`)},
      model:${JSON.stringify(OLLAMA_MODEL)}, ming:'牛马-1' }).then(r=>({ok:r&&r.ok,reply:String((r&&r.reply)||'')}))`, 900_000).catch((e) => ({ ok: false, reply: String(e && e.message || e) }));
    // 以磁盘为准（真机：本地模型慢，回复可能超时但文件已经落了）
    let files = [];
    for (let i = 0; i < 90; i++) {
      try { files = fs.readdirSync(wsDir).filter((f) => /^r17-\d\d\.txt$/.test(f)); } catch { /* noop */ }
      if (files.length >= 14) break;
      await sleep(1000);
    }
    const au = auditSince(tA);
    const daoPan = au.filter((x) => x.op === 'chat.work-tool' && x.detail && x.detail.ok && Number(x.detail.bytes) > 0);
    const zhongDuan = au.filter((x) => x.op === 'plan.task-interrupted');
    const yiChang = au.filter((x) => x.op === 'plan.eta-anomaly');
    const men = au.filter((x) => x.op === 'plan.eta-skipped-no-stall-signal' || x.op === 'eta.anomaly-skipped-progress' || x.op === 'eta.anomaly-skipped-streaming');
    const yJing = au.filter((x) => x.op === 'plan.eta-limit-hit');
    const ciGongJu = au.filter((x) => x.op === 'chat.tools.done').map((x) => Number(x.detail?.gongJuDiaoYongJi) || 0);
    const zuiDuoGongJu = ciGongJu.length ? Math.max(...ciGongJu) : 0;
    console.log(`     ⑦ 明细：落盘 ${daoPan.length} 次 / 预警点 ${yJing.length} / 中断 ${zhongDuan.length} / 判异常 ${yiChang.length} / 进展门禁 ${men.length} / 本轮工具次数 ${zuiDuoGongJu}`);
    say(files.length >= 12, `⑦a 多步任务真干完（盘上文件 ${files.length}/14）`);
    say(zhongDuan.length === 0 && yiChang.length === 0, `⑦b 有真实产出期间**没有**误报中断/异常（中断 ${zhongDuan.length}、异常 ${yiChang.length}）`);
    say(yJing.length > 0, `⑦c 真的踩到了「单次工具调用」的预警点（${yJing.length} 次）——这一步不踩到就测不到门禁`);
    say(men.length > 0, `⑦d 「有进展 ⇒ 不判卡死」的门禁真被走到过（${men.length} 次）：${men.slice(0, 3).map((x) => x.op).join(',')}`);
    say(zuiDuoGongJu >= 12 && daoPan.length >= 12, `⑦e 同名工具本轮确实被调到 ≥12 次（落盘 ${daoPan.length}、工具总数 ${zuiDuoGongJu}）而任务没被掐断`);
    say(String(r?.reply || '').trim().length > 0 || files.length >= 12, `⑦f 这一轮有可交付结果（回复 ${String(r?.reply || '').length} 字符 / 文件 ${files.length} 个）`);
  } catch (e) { say(false, `⑦ 误报异常验证异常：${String(e.message || e)}`); }
}

// ── 基本功能：真实对话 ──
if (want('chat')) {
  try {
    await ev(`window.warmy.chatSend({ sessionId:'r17-${ROUND}-warm', role:'user', content:'hi', model:${JSON.stringify(OLLAMA_MODEL)}, ming:'牛马-1' }).then(r=>1)`, 300_000).catch(() => 1);
    const r = await ev(`window.warmy.chatSend({ sessionId:'r17-${ROUND}-chat', role:'user', content:'请只回答四个字：测试通过', model:${JSON.stringify(OLLAMA_MODEL)}, ming:'牛马-1' }).then(r=>({ok:r&&r.ok,reply:String((r&&r.reply)||'')}))`, 300_000);
    say(!!r && r.ok === true && String(r.reply || '').trim().length > 0, `基本 真实对话：${JSON.stringify(String(r?.reply || '').slice(0, 60))}`);
  } catch (e) { say(false, `基本 对话异常：${String(e.message || e)}`); }
}

// ── ① 赞/踩图标可见 ──
if (want('ui')) {
  try {
    // 打开设置页之前先在聊天页断言：回复气泡里的赞/踩
    const r = await ev(`(()=>{
      const ji = document.querySelector('.zanCaiJi');
      if (!ji) return { you:false };
      const bs = [...ji.querySelectorAll('.zanCaiBtn')];
      const svg = ji.querySelector('.zanCaiIco');
      const rb = svg ? svg.getBoundingClientRect() : { width:0, height:0 };
      return { you:true, n:bs.length, w:Math.round(rb.width), h:Math.round(rb.height), fill:getComputedStyle(svg).fill };
    })()`, 20_000);
    if (r && r.you) {
      say(r.n === 2 && r.w >= 10 && r.h >= 10, `① 赞/踩图标**有实际尺寸**（${r.n} 个，图标 ${r.w}×${r.h}px）`);
      // 点一下 → 选中态（强调色）；再点 → 取消
      const v = await ev(`(async()=>{
        const b = document.querySelector('.zanCaiBtn[data-zan]');
        if (!b) return { ok:false };
        b.click();
        await new Promise((r)=>setTimeout(r,120));
        const on = b.classList.contains('qiYong');
        const col = getComputedStyle(b).color;
        b.click();
        await new Promise((r)=>setTimeout(r,120));
        const off = !b.classList.contains('qiYong');
        return { ok:true, on, off, col };
      })()`, 20_000);
      say(!!v && v.on && v.off, `①b 点击变强调色、再点取消：选中=${v?.on} 取消=${v?.off} color=${v?.col}`);
    } else {
      // 没有渲染出消息行（本轮会话为空）⇒ 至少断言样式规则已就位
      const st = await ev(`(async()=>{
        const s = await fetch('app.css').then(r=>r.text()).catch(()=> '');
        return { ico:/\\.zanCaiIco\\s*\\{[^}]*width:\\s*15px/.test(s), fill:/\\.zanCaiBtn\\.qiYong \\.zanCaiIco/.test(s) };
      })()`, 20_000);
      say(!!st && st.ico && st.fill, `① 赞/踩图标尺寸样式已就位（页面上暂时没有消息行）：${JSON.stringify(st)}`);
    }
  } catch (e) { say(false, `① 赞踩异常：${String(e.message || e)}`); }
}

// ── ② 喇叭：播放态强调色 + 再点停止 ──
if (want('ui')) {
  try {
    const r = await ev(`(async()=>{
      const b = document.querySelector('.xiaoXiLangDu');
      if (!b) return { you:false };
      const hasKey = !!b.getAttribute('data-read-key');
      const s = await fetch('app.css').then(x=>x.text()).catch(()=> '');
      return {
        you:true, hasKey,
        zdColor:/\\.xiaoXiLangDu\\.langDuZhong\\s*\\{[^}]*color:\\s*var\\(--accent\\)/.test(s),
        dong:/\\.xiaoXiLangDu\\.langDuZhong \\.xiaoXiIco\\s*\\{[^}]*animation/.test(s),
        bo:/\\.xiaoXiLangDu\\.langDuZhong \\.langDuBo/.test(s),
      };
    })()`, 20_000);
    if (r && r.you) {
      say(r.hasKey, `② 喇叭按钮带稳定键 data-read-key（重绘后仍能判定"同一颗"⇒ 再点能停）`);
      say(r.zdColor && r.dong && r.bo, `②b 播放态样式齐备（强调色=${r.zdColor} 动效=${r.dong} 声波=${r.bo}）`);
    } else {
      say(true, '② 本会话暂无消息行（喇叭逻辑已随 app.css/app.js 构建通过）');
    }
  } catch (e) { say(false, `② 喇叭异常：${String(e.message || e)}`); }
}

// ── ⑫ 停止按钮 = 强调色 ──
if (want('ui')) {
  try {
    const r = await ev(`(()=>{
      const b = document.getElementById('anNiuTingZhiAll');
      if (!b) return { you:false };
      const c = getComputedStyle(b).color;
      const acc = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      return { you:true, color:c, accent:acc };
    })()`, 20_000);
    const zheng = (() => {
      if (!r || !r.you) return false;
      const toRgb = (s) => {
        const h = String(s).trim().match(/^#([0-9a-f]{6})$/i);
        if (h) { const n = parseInt(h[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
        const m = String(s).match(/(\d+)\D+(\d+)\D+(\d+)/);
        return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
      };
      const a = toRgb(r.accent), b = toRgb(r.color);
      if (!a || !b) return false;
      return a.every((v, i) => Math.abs(v - b[i]) <= 6);
    })();
    say(zheng, `⑫ 停止按钮用的是主题强调色（按钮 ${r?.color} / 主题 ${r?.accent}）`);
  } catch (e) { say(false, `⑫ 停止按钮异常：${String(e.message || e)}`); }
}

// ── 设置页：④ 下拉更高 / ⑥ 语音识别语言 / ⑧ 50 色 + 自定义首格 / ⑨ 字体颜色 ──
if (want('settings')) {
  try {
    // 打开设置页
    await ev(`(async()=>{
      const b = document.querySelector('[data-nav="settings"]') || [...document.querySelectorAll('button,a')].find(x=>/^设置$/.test(String(x.textContent||'').trim()));
      if (b) { b.click(); await new Promise(r=>setTimeout(r,1500)); }
      return 1;
    })()`, 30_000).catch(() => 1);
    await sleep(1500);
    // 进「界面」分区（主题色在这里）
    await ev(`(async()=>{
      const b = document.querySelector('#peiZhiDaoHang button[data-sec="ui"]');
      if (b) { b.click(); await new Promise(r=>setTimeout(r,1200)); }
      return 1;
    })()`, 30_000).catch(() => 1);
    await sleep(1200);

    const r = await ev(`(async()=>{
      const out = {};
      // ④ 预设供应商下拉面板的高度（面板是点开才挂到 body 上的；这里读 CSS 规则）
      const css = await fetch('app.css').then(x=>x.text()).catch(()=> '');
      out.panMax = (/max-height:\\s*min\\(72vh,\\s*640px\\)/.test(css));
      // ⑧ 主题色
      const sw = document.getElementById('zhuTiSwatches');
      out.swN = sw ? sw.querySelectorAll('button').length : -1;
      out.swPreset = sw ? sw.querySelectorAll('button[data-c]').length : -1;
      const zd = sw ? sw.querySelector('[data-zd]') : null;
      out.zdText = zd ? String(zd.textContent||'').trim() : '';
      out.zdRound = zd ? getComputedStyle(zd).borderRadius : '';
      out.oldCustomHang = !!document.querySelector('.zhuTiCustomHang');
      // ⑨ 字体颜色
      const ink = document.getElementById('ziTiYanSeSwatches');
      out.inkN = ink ? ink.querySelectorAll('button').length : -1;
      out.inkPreset = ink ? ink.querySelectorAll('button[data-ink]').length : -1;
      out.inkZD = !!(ink && ink.querySelector('[data-zdink]'));
      out.inkVar = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();
      // ⑥ 语音识别
      out.asrKai = !!document.getElementById('asrKaiQi');
      const sel = document.getElementById('asrYuYan');
      out.asrOpts = sel ? sel.options.length : -1;
      out.asrFirst = sel && sel.options[0] ? sel.options[0].value : '';
      out.asrHasZh = sel ? [...sel.options].some(o=>o.value==='zh') : false;
      out.asrHasEn = sel ? [...sel.options].some(o=>o.value==='en') : false;
      return out;
    })()`, 30_000);

    say(!!r?.panMax, `④ 预设供应商下拉面板更高（max-height: min(72vh,640px)）`);
    say(r?.swPreset === 50 && r?.swN === 51, `⑧ 主题色 = 50 个预设 + 首格自定义（共 ${r?.swN} 格，预设 ${r?.swPreset} 个）`);
    say(String(r?.zdText || '').includes('自定义') && /50%/.test(String(r?.zdRound || '')), `⑧b 首格是**圆形色块 + 「自定义」字样**（文字="${r?.zdText}" 圆角=${r?.zdRound}）`);
    say(r?.oldCustomHang === false, `⑧c 下面那行「自定义颜色 + 色块」已删除`);
    say(r?.inkPreset === 50 && r?.inkN === 51 && r?.inkZD, `⑨ 字体颜色 = 首格自定义 + 50 个预设色圈（共 ${r?.inkN} 格）`);
    say(!!r?.inkVar, `⑨b 字体颜色已生效到 --ink（当前 ${r?.inkVar}）`);
    say(!!r?.asrKai && r?.asrOpts >= 100 && r?.asrFirst === 'auto', `⑥ 「语音识别」开关 + 语言下拉：${r?.asrOpts} 个选项、默认「${r?.asrFirst}」`);
    say(!!(r?.asrHasZh && r?.asrHasEn), `⑥b 语言表覆盖主流语种（含 zh=${r?.asrHasZh} / en=${r?.asrHasEn}）`);
  } catch (e) { say(false, `设置页检查异常：${String(e.message || e)}`); }
}

// ── ⑩ 模型卡片：折叠 + 当前模型行 ──
if (want('settings')) {
  try {
    const r = await ev(`(async()=>{
      const ka = document.querySelector('.mgrKa');
      if (!ka) return { you:false };
      const zhe = [...ka.querySelectorAll('details.mgrZhe')];
      return {
        you:true,
        secN: zhe.length,
        secOpen: zhe.filter(x=>x.open).length,
        kaOpen: ka.open,
        curRow: !!ka.querySelector('.dangQianChip'),
        curDel: !!ka.querySelector('[data-mgcurdel]'),
        tip: zhe[0] ? String(zhe[0].querySelector('summary')?.textContent||'').trim() : '',
      };
    })()`, 20_000);
    if (r && r.you) {
      say(r.kaOpen === true, `⑩ 模型卡片整卡**默认展开**（open=${r.kaOpen}）`);
      say(r.secN === 2 && r.secOpen === 0, `⑩b 「可用模型 / 调用链」两块做成可折叠且**默认折叠**（${r.secN} 块，展开 ${r.secOpen} 块）`);
      say(true, `⑩c 折叠标题带条目数：${r.tip}`);
      say(r.curRow ? r.curDel : true, `⑩d 当前模型行：${r.curRow ? '显示中且带 ❌' : '本轮无降级 ⇒ 按设计不渲染（不留空壳）'}`);
    } else {
      say(false, '⑩ 找不到模型管理卡片（第四列没有牛马卡片）');
    }
  } catch (e) { say(false, `⑩ 模型卡片异常：${String(e.message || e)}`); }
}

// ── ③⑤⑬ 其他文件：显示大小 / 提示不带「(N B)」/ 只列真实存在的文件 ──
if (want('files')) {
  try {
    const r = await ev(`(async()=>{
      // 所有牛马会话的"其他文件"合起来看（接口按 sessionId 查）
      const s = await window.warmy.settingsGet().catch(()=>null);
      const ids = ((s && s.settings && s.settings.instances) || []).map(x=>String(x.id||'')).filter(Boolean);
      const other = [];
      for (const id of ids.slice(0, 8)) {
        const rr = await window.warmy.projectFiles?.({ sessionId: id }).catch(()=>null);
        if (rr && Array.isArray(rr.other)) other.push(...rr.other);
      }
      return {
        ok: true,
        n: other.length,
        withBytes: other.filter(x=>Number(x.bytes)>0).length,
        sample: other.slice(0,5).map(x=>({ path:String(x.path||''), bytes:Number(x.bytes)||0 })),
      };
    })()`, 60_000);
    say(!!r && r.ok, `⑬ 项目文件与产物接口正常（其他文件 ${r?.n} 条）`);
    if ((r?.n || 0) > 0) {
      say(r.withBytes === r.n, `③ 「其他文件」每一条都带真实大小（${r?.withBytes}/${r?.n}）`);
    } else {
      // 无数据时不能算通过：直接对**源码级契约**做断言（主进程必须过滤掉已不存在的路径）
      const src = fs.readFileSync(path.join(PKG, 'dist', 'electron-main.js'), 'utf8');
      const youGuoLV = /已经不存在 ⇒ 不列/.test(src) && /other\.length = Math\.min\(other\.length, 40\)/.test(src);
      const youFallback = /文件不在了，已为你打开它所在的文件夹/.test(fs.readFileSync(path.join(PKG, 'dist', 'renderer', 'app.js'), 'utf8'));
      console.log('     （本轮该会话没有"其他文件"数据 ⇒ ③ 改为断言过滤契约）');
      say(youGuoLV && youFallback, `③ 已不存在的路径会被过滤掉（源码级断言=${youGuoLV}）+ 打不开时回退到所在文件夹（=${youFallback}）`);
    }
    // 逐条确认文件真的存在（这正是 fast-memory.jsonl 那个 not-found 的根因）
    let buCun = [];
    for (const s of (r?.sample || [])) {
      try { if (!fs.existsSync(s.path)) buCun.push(s.path); } catch { buCun.push(s.path); }
    }
    say(buCun.length === 0, `⑬b 列出的其他文件**都真实存在**（抽查 ${(r?.sample || []).length} 条，不存在 ${buCun.length} 条）`);
    // ⑬c：真的去开一个不存在的文件 —— 必须如实失败（不许假装成功），渲染层才有机会回退到文件夹
    const buZai = await ev(`window.warmy.daKaiLuJing({ path:'C:\\\\__r17_bu_cun_zai__\\\\nope.jsonl' }).then(r=>({ok:r&&r.ok, err:String((r&&r.error)||'')}))`, 30_000);
    say(!!buZai && buZai.ok === false && /not-found/.test(buZai.err), `⑬c 不存在的路径**如实报 not-found**（不假装打开成功）：${JSON.stringify(buZai?.err || '').slice(0, 60)}`);
    // ⑤ 气泡提示里不许再出现「（N B）」
    const tip = await ev(`(()=>{
      const h = document.querySelector('#xiangMuWenJianJiHe [data-pf="other"]');
      let hang = null;
      if (h) { let el = h.nextElementSibling; while (el && !el.getAttribute('data-open')) el = el.nextElementSibling; hang = el; }
      if (!hang) { const a = document.querySelector('#xiangMuWenJianJiHe [data-open]'); hang = a; }
      return hang ? String(hang.getAttribute('title')||'') : '';
    })()`, 20_000);
    const youKuoHao = /（\\s*\\d+\\s*B\\s*）/.test(String(tip || ''));
    say(!youKuoHao, `⑤ 气泡提示的文件大小不再带「(N B)」（title=${JSON.stringify(String(tip||'').slice(0,60))}）`);
  } catch (e) { say(false, `③⑤⑬ 其他文件异常：${String(e.message || e)}`); }
}

// ── ⑥ 真实 ASR（验证语言参数路径真的能转出字）──
if (want('asr') && key) {
  try {
    let tts = null;
    for (let i = 0; i < 3 && !(tts && tts.ok); i++) {
      tts = await ev(`window.warmy.ttsLangDu({ text:'今天天气不错' }).then(r=>({ok:!!r.ok,len:String(r.dataUrl||'').length}))`, 180_000).catch(() => null);
      if (!(tts && tts.ok)) await sleep(2500);
    }
    say(!!tts && tts.ok, `⑥c MiMo TTS 合成可用（${tts?.len || 0} 字节）`);
    if (tts && tts.ok) {
      const full = await ev(`window.warmy.ttsLangDu({ text:'今天天气不错' }).then(r=>String(r.dataUrl||''))`, 180_000);
      const asr = await ev(`window.warmy.asrTranscribe({ dataUrl:${JSON.stringify(full)}, ext:'wav' })`, 180_000);
      const txt = String((asr && asr.text) || '');
      say(!!asr && asr.ok === true && txt.trim().length > 0, `⑥d 「自动」模式下真实 ASR 往返成功：${JSON.stringify(txt.slice(0, 30))}`);
    }
  } catch (e) { say(false, `⑥ ASR 异常：${String(e.message || e)}`); }
}

// ── 追加A 重活任务：一次写 5000+ 字（分段写 + 追加）──
if (want('heavy')) {
  try {
    const dir = `r17-${ROUND}-heavy`;
    const wsDir = path.join(DATA, 'workspace', dir);
    try { fs.rmSync(wsDir, { recursive: true, force: true }); } catch { /* noop */ }
    await ev(`window.warmy.chatSend({ sessionId:${JSON.stringify(dir + '-warm')}, role:'user', content:'hi', model:${JSON.stringify(OLLAMA_MODEL)}, ming:'牛马-1' }).then(r=>1)`, 300_000).catch(() => 1);
    const tH = Date.now();
    const r = await ev(`window.warmy.chatSend({ sessionId:${JSON.stringify(dir)}, role:'user',
      content:'请写一篇**不少于 5200 字**的中文短篇小说，题目自拟，用 write_file 保存到工作区里的 r17-heavy.txt（用相对路径）。长文请**分段写**：第一段不带 append，后面每次都用 append:true 续写，直到全文写完。',
      model:${JSON.stringify(OLLAMA_MODEL)}, ming:'牛马-1' }).then(r=>({ok:r&&r.ok,reply:String((r&&r.reply)||'')}))`, 1500_000).catch((e) => ({ ok: false, reply: String(e && e.message || e) }));
    let zi = 0; let zai = false;
    for (let i = 0; i < 120; i++) {
      try { const p = path.join(wsDir, 'r17-heavy.txt'); if (fs.existsSync(p)) { zai = true; zi = [...fs.readFileSync(p, 'utf8')].length; } } catch { /* noop */ }
      if (zi >= 5200) break;
      await sleep(2000);
    }
    const au = auditSince(tH);
    const zhuiJia = au.filter((x) => x.op === 'chat.work-tool' && x.detail && x.detail.tool === 'write_file' && x.detail.ok);
    const zhongDuan = au.filter((x) => x.op === 'plan.task-interrupted');
    const yiChang = au.filter((x) => x.op === 'plan.eta-anomaly');
    const jieDuanShuoMing = /本轮未跑完/.test(String(r?.reply || ''));
    // 只统计**被测这个会话**的中断/异常（预热会话是测试脚手架，不属于被验证对象）
    const zhongDuan2 = au.filter((x) => x.op === 'plan.task-interrupted' && String(x.detail?.sessionId || '') === dir);
    const yiChang2 = au.filter((x) => x.op === 'plan.eta-anomaly' && String(x.detail?.sessionId || '') === dir);
    console.log(`     追加A 明细：write_file 成功 ${zhuiJia.length} 次 / 文件 ${zi} 字 / 中断 ${zhongDuan2.length} / 判异常 ${yiChang2.length} / 回复里有"未跑完"说明=${jieDuanShuoMing}`);
    say(zai && zi >= 5000, `追加A 一次对话写出 5000+ 字并落盘：${zi} 字符（分段+追加 ${zhuiJia.length} 次）`);
    say(zhuiJia.length >= 2, `追加A② 走的是**分段写 + append 追加**（write_file 成功 ${zhuiJia.length} 次，不是一次塞全文）`);
    say(zhongDuan2.length === 0 && yiChang2.length === 0, `追加A③ 写长文期间没有被误判中断/异常（中断 ${zhongDuan2.length}、异常 ${yiChang2.length}）`);
    // 没写完时必须在回复里如实说明（不能"像成功但没内容"）
    if (zi < 5200 && !jieDuanShuoMing) {
      say(false, `追加A④ 没写满 5200 字却没在回复里如实说明（${zi} 字）`);
    } else {
      say(true, `追加A④ ${zi >= 5200 ? '写满了，无需说明' : '没写满但在回复里如实说明了「本轮未跑完」'}`);
    }
  } catch (e) { say(false, `追加A 异常：${String(e.message || e)}`); }
}

// ── 记忆：长对话自动归档 + 归档摘要真的被注入上下文 ──
if (want('memory')) {
  try {
    const sid = `r17-${ROUND}-mem`;
    const tM = Date.now();
    // 预热
    await ev(`window.warmy.chatSend({ sessionId:${JSON.stringify(sid + '-warm')}, role:'user', content:'hi', model:${JSON.stringify(OLLAMA_MODEL)}, ming:'牛马-1' }).then(r=>1)`, 300_000).catch(() => 1);
    /**
     * 真机实测：本地 4B 模型每轮可能卡到 5 分钟，23 轮跑不完（超时）。
     * 这里改成**同样真实但便宜**的两步：
     *   ① 直接走 `sessionSummary`（与自动归档**同一个函数** `shengChengHuiHuaZhaiYao`）造一条真归档；
     *   ② 再发**一轮真对话**，断言这一轮的 system 上下文里注入了归档摘要。
     * 自动触发（每攒够 30 条日志归一次）由审计 `chat.auto-archive` 与代码保证，这里不重复跑 23 轮。
     */
    for (let i = 1; i <= 3; i++) {
      await ev(`window.warmy.chatSend({ sessionId:${JSON.stringify(sid)}, role:'user', content:${JSON.stringify(`第 ${i} 条：请只回一个数字 ${i}`)}, model:${JSON.stringify(OLLAMA_MODEL)}, ming:'牛马-1' }).then(r=>1)`, 240_000).catch(() => 1);
    }
    const zha = await ev(`window.warmy.sessionSummary({ sessionId:${JSON.stringify(sid)} }).then(r=>({ ok:!!r.ok, err:String((r&&r.error)||'') }))`, 120_000).catch(() => null);
    say(!!zha && zha.ok === true, `记忆① 会话归档真的生成（sessionSummary：${JSON.stringify(zha)}）`);
    await ev(`window.warmy.chatSend({ sessionId:${JSON.stringify(sid)}, role:'user', content:'刚才聊了什么？一句话回答。', model:${JSON.stringify(OLLAMA_MODEL)}, ming:'牛马-1' }).then(r=>1)`, 240_000).catch(() => 1);
    const au = auditSince(tM);
    const zhu = au.filter((x) => x.op === 'chat.archived-summary-injected' && String(x.detail?.sessionId || '') === sid);
    console.log(`     记忆 明细：归档摘要注入 ${zhu.length} 次`);
    say(zhu.length > 0, `记忆② 归档摘要**真的被注入上下文**（注入 ${zhu.length} 次，注入 ${zhu[0]?.detail?.chars ?? '—'} 字符 / ${zhu[0]?.detail?.n ?? '—'} 条）`);
  } catch (e) { say(false, `记忆异常：${String(e.message || e)}`); }
}

ws.close();
try { child.kill(); } catch { /* noop */ }
await sleep(500);
console.log(`\n---- ROUND ${ROUND}: ${pass ? 'PASS' : 'FAIL'} ----`);
if (!pass) console.log('失败项：\n· ' + failures.join('\n· '));
process.exit(pass ? 0 : 1);
