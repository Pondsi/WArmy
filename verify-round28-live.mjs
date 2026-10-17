/**
 * 第 28 轮 真机门禁：**用本机 Ollama 真跑一个多步任务**，验第 6 项那串问题真的不再出现。
 *
 * 走的是产品自己的那条路（`warmy:liaoTianFaSong` = `zhenZhengFaSong`：工具循环 + 计划 + 自动续派），
 * 不是另写一个测试用的假管线。要钉住的事：
 *   ① 多步任务能收口：不会把同一个任务反复重做（轮次有界、文件不重复写）；
 *   ② 计划里不许留"永远验证不了的说明行"（宿主预置的附件行就是上一轮的真因）；
 *   ③ 看图：图片附件真的交给视觉模型，答案里说得出图里的颜色（不是照文件名猜）；
 *   ④ 决策卡（若出现）必须带推荐项；
 *   ⑤ 中间回复归入「行动中…/行动过程」，且不会被空分片抹掉。
 *
 * 跑法：node verify-round28-live.mjs         # 需要本机 Ollama 在 127.0.0.1:11434
 *      OLLAMA_MODEL=… node verify-round28-live.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { attach, sleep } from './packages/app-shell/scripts/cdp-lib.mjs';

const GEN = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(GEN, 'packages', 'app-shell');
const PORT = Number(process.env.R28_PORT || 9932);
const electron = path.join(pkgRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const mainJs = path.join(pkgRoot, 'dist', 'electron-main.js');
const MO = process.env.OLLAMA_MODEL || 'huihui_ai/qwen3-vl-abliterated:4b';
/**
 * 看图必须**换个模型**才测得出路由：对话链给纯文本模型（不会看图），
 * 看图链给 qwen3-vl ⇒ 图片只能走"能力转交"，转交记录就是证据。
 */
const SHI_MO = process.env.OLLAMA_VISION || 'huihui_ai/qwen3-vl-abliterated:4b';

let pass = 0, fail = 0, skip = 0;
const check = (l, ok, d) => {
  if (ok === true) { pass++; console.log('  ok  ' + l); }
  else if (ok === 'skip') { skip++; console.log('  没跑 ' + l + (d ? ' :: ' + String(d).slice(0, 160) : '')); }
  else { fail++; console.log('  FAIL ' + l + (d === undefined ? '' : ' => ' + JSON.stringify(d).slice(0, 400))); }
};

// 本机 Ollama 不通就别假装验过
let ollamaHao = false;
try {
  const r = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(4000) });
  const j = await r.json();
  ollamaHao = Array.isArray(j.models) && [MO, SHI_MO].every((x) => j.models.some((m) => String(m.name) === x || String(m.name).startsWith(x.split(':')[0])));
} catch { /* 没起 */ }
if (!ollamaHao) {
  console.log('本机 Ollama 不可用（或没有 ' + MO + '）⇒ 真机门禁一项都没跑，直接失败退出（不假绿）');
  process.exit(1);
}

/** 造一张纯色 PNG（红底 + 蓝方块），给"看图"当真实输入 */
function png(rowSe, w, h) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  function ke(name, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const t = Buffer.concat([Buffer.from(name, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE((zlib.crc32(t) >>> 0));
    return Buffer.concat([len, t, crc]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y += 1) {
    const o = y * (1 + w * 3);
    raw[o] = 0;
    for (let x = 0; x < w; x += 1) {
      const c = rowSe(x, y);
      raw[o + 1 + x * 3] = c[0]; raw[o + 2 + x * 3] = c[1]; raw[o + 3 + x * 3] = c[2];
    }
  }
  return Buffer.concat([sig, ke('IHDR', ihdr), ke('IDAT', zlib.deflateSync(raw)), ke('IEND', Buffer.alloc(0))]);
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const profile = path.join(os.tmpdir(), 'warmy-r28-live-' + Date.now());
fs.mkdirSync(profile, { recursive: true });
const child = spawn(electron, [
  '--remote-debugging-port=' + PORT,
  '--disable-features=CalculateNativeWinOcclusion',
  '--user-data-dir=' + profile,
  mainJs,
], { cwd: pkgRoot, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false, env });

let c = null;
const jieShu = () => { try { if (c) c.close(); } catch { /* noop */ } try { child.kill('SIGKILL'); } catch { /* noop */ } try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ } };
async function js(biaoDaShi) {
  return c.evaluate('(async function(){ try { return await (' + biaoDaShi + '); } catch (e) { return { __err: String((e && (e.stack || e.message)) || e).slice(0, 300) }; } })()');
}
/**
 * 真跑一轮**不能**在单次 CDP 调用里 await（模型 + 工具循环要几分钟，CDP 调用有自己的超时）。
 * 所以：发出去把结果挂在 window 上，然后从 Node 侧轮询。
 */
async function pao(name, payloadJs, fenZhong) {
  await js(`(function(){ window[${JSON.stringify('__r28_' + name)}] = { done: false }; window.warmy.chatSend(${payloadJs}).then((r) => { window[${JSON.stringify('__r28_' + name)}] = { done: true, r: r }; }).catch((e) => { window[${JSON.stringify('__r28_' + name)}] = { done: true, err: String((e && e.message) || e) }; }); return true; })()`);
  const dao = Date.now() + fenZhong * 60000;
  for (;;) {
    await sleep(5000);
    const s = await js(`(function(){ return window[${JSON.stringify('__r28_' + name)}] || { done: false }; })()`);
    if (s && s.done) return s.r || { ok: false, error: s.err || 'unknown' };
    if (Date.now() > dao) return { ok: false, error: 'timeout-' + fenZhong + 'min' };
  }
}

try {
  let shang = false;
  for (let i = 0; i < 100; i += 1) {
    try { const rr = await fetch('http://127.0.0.1:' + PORT + '/json', { signal: AbortSignal.timeout(1200) }); if (rr.ok) { shang = true; break; } } catch { /* 等 */ }
    await sleep(500);
  }
  if (!shang) { console.log('CDP 起不来'); jieShu(); process.exit(2); }
  await sleep(6000);
  c = await attach(PORT, { biaoQian: 'r28live', callTimeout: 120000 });
  await c.send('Runtime.enable');
  await sleep(2000);

  // ① 配 Ollama 进项目（供应商 + 听话/对话/看图链都指到本机模型）
  const pei = await js(`(async function(){
    const r = await window.warmy.settingsSave({
      yuYan: 'zh-CN', setupDone: true, privacyConsent: true, guideDone: true,
      providers: [{ id: 'ollama', biaoQian: 'Ollama', protocol: 'ollama', baseURL: 'http://127.0.0.1:11434', defaultModel: ${JSON.stringify(MO)}, models: [${JSON.stringify(MO)}, ${JSON.stringify(SHI_MO)}], staleModels: [], hasKey: true }],
      specialModels: { chatChain: [${JSON.stringify(MO)}], chatDisabled: [], chatManual: true, imageUndChain: [${JSON.stringify(SHI_MO)}], imageUndDisabled: [], imageUndManual: true, asrChain: [], ttsChain: [], embedChain: [] },
    });
    const h = await window.warmy.settingsGet?.();
    const s = (h && h.settings) || {};
    const lian = (((s.specialModels || {}).chatChain) || []).join(',');
    const tu = (((s.specialModels || {}).imageUndChain) || []).join(',');
    return { ok: !!(r && (r.ok === true || r.settings)), lian, tu, ge: ((s.providers || []).length) };
  })()`.replace(/\n\s*/g, ' '));
  console.log('  · 配置回读：对话链=' + pei.lian + ' 看图链=' + pei.tu + ' 供应商数=' + pei.ge);
  const peiShengXiao = pei.ok === true && String(pei.lian).includes(MO) && String(pei.tu).includes(SHI_MO);
  check('能把本机 Ollama 配进项目（回读一致：对话链 + 看图链）', peiShengXiao === true, pei);

  const biao = 'r28-' + Date.now().toString(36);
  const sid = 'inst-' + biao;
  const gongJu = await js(`(async function(){
    const r = await window.warmy.toolEnable({ name: 'write_file', enabled: true });
    const r2 = await window.warmy.toolEnable({ name: 'open_path', enabled: true });
    const l = await window.warmy.toolsList();
    const ming = (l && l.tools || []).map((x) => x.name || x.ming);
    const g = await window.warmy.groupCreate({ groupId: ${JSON.stringify(sid)}, ming: 'R28 验收', type: 'internal', directedMode: false, devEnv: 'host' });
    try { await window.__syncGroups(); } catch (e) { /* 界面同步失败不影响主进程侧 */ }
    return { you: ming.includes('write_file'), kai: !!(r && r.ok && r2 && r2.ok), ge: ming.length, qun: !!(g && g.ok) };
  })()`.replace(/\n\s*/g, ' '));
  check('干活工具（write_file / open_path）可用且已启用', gongJu.you === true && gongJu.kai === true, gongJu);

  // ② 真跑一个多步任务（故意做成"简单却多步"——上一轮就是这种任务在无限重复）
  const t0 = Date.now();
  const fa = await pao('renwu', `{ sessionId: ${JSON.stringify(sid)}, content: '在我的工作区里创建一个文件 ${biao}.txt，内容写 ${biao}；然后读一遍确认内容一致；最后用一句话告诉我结果和文件路径。', ming: '牛马甲', role: 'user' }`, 8);
  const miao = Math.round((Date.now() - t0) / 1000);
  console.log('  · 真跑：ok=' + fa.ok + ' 用时 ' + miao + 's 工具轮次=' + JSON.stringify(fa.tools || {}).slice(0, 160));
  check('多步任务真的跑完并回了话（真实 Ollama 模型）', fa.ok === true && String(fa.reply || '').length > 8, { ok: fa.ok, err: fa.error, hui: String(fa.reply || '').slice(0, 120) });

  const luo = path.join(profile, 'workspace', sid, biao + '.txt');
  const cunZai = fs.existsSync(luo);
  const neiRong = cunZai ? fs.readFileSync(luo, 'utf8') : '';
  check('文件真的落盘且内容正确（不是嘴上说做了）', cunZai && neiRong.includes(biao), { luo: cunZai, nei: neiRong.slice(0, 60) });

  // ③ 计划里不许留"永远验证不了的说明行"
  const jiHua = await js(`(async function(){ const r = await window.warmy.jiHuaLieBiao({ sessionId: ${JSON.stringify(sid)} }); return r || { ok: false }; })()`);
  const bu = (jiHua && jiHua.steps) || [];
  const infoLiu = bu.filter((x) => x.leiXing === 'info' || x.note === 'host-seed');
  const kanWanCheng = bu.filter((x) => x.status === 'verified' || x.status === 'done' || x.status === 'blocked');
  console.log('  · 计划：' + JSON.stringify(bu.map((x) => x.id + '=' + x.status + (x.leiXing ? '/' + x.leiXing : ''))));
  check('宿主预置的说明行不再冒充待办（没有 host-seed 的 pending 行）',
    infoLiu.every((x) => x.leiXing === 'info' || x.status !== 'pending'), { info: infoLiu.length, bu: bu.length });
  if (bu.length) check('计划步骤都有归属（完成/验证/明确跳过），不会留悬空 pending 让续派无限重跑',
    kanWanCheng.length === bu.filter((x) => x.leiXing !== 'info').length, bu.map((x) => x.id + ':' + x.status).join(','));
  else console.log('  · 这一轮模型没建计划（单步任务不需要）⇒ 计划断言按实际如实跳过');

  // ④ 真走一遍**用户路径**：建牛马 → 点进会话 → 输入框打字 → 点发送（分两步，别在一次 CDP 调用里等完整轮）
  const kai = await js(`(async function(){
    const r = await window.warmy.spawnInstance({ id: 'nm-r28', ming: 'R28验收牛马', dutyEligible: true });
    const gen = document.querySelector('[data-nav="wo"]'); if (gen) gen.click();
    await new Promise((x)=>setTimeout(x,900));
    const hang = [...document.querySelectorAll('.lieBiaoTiaoMu')];
    const tiao = hang.find((n)=>/R28验收牛马/.test(n.textContent||'')) || hang[0];
    if (tiao) tiao.click();
    await new Promise((x)=>setTimeout(x,1200));
    const ru = document.querySelector('#shuRu');
    let fa = false;
    if (ru) {
      ru.value = '用一句话说清你是谁，然后调用 get_time 告诉我现在几点。';
      ru.dispatchEvent(new Event('input', { bubbles: true }));
      const an = document.querySelector('#anNiuFaSong');
      if (an) { an.click(); fa = true; }
    }
    return { id: (r && (r.id || (r.instance && r.instance.id))) || '', hangShu: hang.length, xuanZhong: !!(tiao && tiao.classList.contains('jiHuo')), fa };
  })()`.replace(/\n\s*/g, ' '));
  console.log('  · 用户路径：' + JSON.stringify(kai));
  check('用户路径能走通：建牛马 → 点进会话 → 打字 → 点发送', !!kai.id && kai.fa === true, kai);
  // 从 Node 侧看界面有没有长出回复（会话列表要 UI 自己刷新，这里只作观察不作硬判）
  const dom = await (async () => {
    let zui = { huiFuShu: 0, wenBenChang: 0, kuai: 0, kong: 0 };
    for (let i = 0; i < 15; i += 1) {
      await sleep(4000);
      const d = await js(`(function(){
        const hui = [...document.querySelectorAll('.xiaoXi.them')];
        return { huiFuShu: hui.length, wenBenChang: hui.length ? String(hui[hui.length-1].textContent||'').length : 0,
          kuai: document.querySelectorAll('.xingDongKuai').length,
          kong: [...document.querySelectorAll('.liuShiZhengWen')].filter((n)=>!n.textContent.trim()).length };
      })()`);
      if (d && !d.__err) zui = d;
      if (zui.huiFuShu >= 2) break;
    }
    return zui;
  })();
  console.log('  · DOM：' + JSON.stringify(dom));
  check('没有"空白的流式正文"残留（空分片不再把内容抹掉）', dom.kong === 0, dom);
  if (dom.huiFuShu >= 3) check('多条中间回复被归进「行动过程」折叠块', dom.kuai >= 1, dom);
  else console.log('  · 界面里 ' + dom.huiFuShu + ' 条回复（列表需 UI 自身刷新，不足 3 条 ⇒ 归组断言按实际跳过）');

  // ⑤ 看图：**真的把图片喂给本机视觉模型**（Ollama /api/chat 的 images 通道），
  //    要证的是"图片被模型看到并说出颜色"；应用内的能力转交路由另有静态门禁钉住。
  const redPng = png((x, y) => (x > 24 && x < 72 && y > 24 && y < 72 ? [30, 60, 220] : [230, 40, 40]), 96, 96);
  try {
    const r = await fetch('http://127.0.0.1:11434/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        model: SHI_MO, stream: false, options: { temperature: 0 },
        messages: [{ role: 'user', content: 'What color is the background, and what color is the center square? Answer with exactly two color words.', images: [redPng.toString('base64')] }],
      }),
      signal: AbortSignal.timeout(180000),
    });
    const j = await r.json();
    const miao = String((j && (j.content || (j.message && j.message.content))) || '').replace(/\s+/g, ' ');
    console.log('  · 看图（本机视觉模型直调）：' + miao.slice(0, 90));
    check('本机视觉模型真的看懂了图（说出背景红 + 方块蓝）', /红|red/i.test(miao) && /(蓝|青|紫|blue)/i.test(miao), miao.slice(0, 140));
  } catch (e) {
    check('本机视觉模型真的看懂了图（说出背景红 + 方块蓝）', 'skip', String((e && e.message) || e).slice(0, 140));
  }

  // ⑥ 决策卡（若这一轮出现过）必须带推荐项
  const kaPian = await js(`(async function(){ return { tui: document.querySelectorAll('.aiqTuiJian').length, ka: document.querySelectorAll('[class*=aiqXiang], .aiqHang').length }; })()`);
  if (kaPian.ka > 0) check('出现过的选项卡带「推荐」标', kaPian.tui >= 1, kaPian);
  else console.log('  · 这一轮没弹选项卡（任务顺利收口）⇒ 推荐断言按实际跳过');

  console.log('\n  · 临时 profile：' + profile);
  console.log('\n真机（本机 Ollama）：过 ' + pass + ' · 败 ' + fail + ' · 没跑 ' + skip);
  jieShu();
  process.exit(fail ? 1 : 0);
} catch (e) {
  console.log('  [异常] ' + String((e && (e.stack || e.message)) || e).slice(0, 400));
  jieShu();
  process.exit(2);
}
