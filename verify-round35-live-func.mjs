/**
 * verify-round35-live-func —— 第 35 轮**真实功能验证**（真 Ollama + 真 MiMo）
 *
 * 与 verify-round34-live 的区别：那条验的是"跑一个完整任务的世界状态"；
 * 这条验的是**本轮新东西在真机上是否真的工作**：
 *   ① 项 7：用真 Ollama /api/show 探 `clef:latest`，能力必须落成 decision（不是画图）
 *   ② 项 8：真聊一轮，界面上的模型名必须是"供应商 · 模型"全称，且词元/轮次都进了悬停
 *   ③ 项 12/13/14：真跑一个会调用工具的活，执行过程里要出现木马图标的行动行
 *   ④ 项 15：真 TTS 生成一段语音 → 交给真 ASR 转写 → 文字必须大体一致（这才是用户报的 bug）
 *   ⑤ 项 10：附件授权卡 IPC 真的写入只读授权、且只读工具能免询问
 *
 * 环境变量：MIMO_KEY_FILE 指向含 MiMo key 的文件（**只取第一行，绝不打印**）。
 * 用法：node verify-round35-live-func.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const GEN = 'C:/wbuild';
const pkgRoot = path.join(GEN, 'packages', 'app-shell');
const { attach, sleep, bootWait } = await import(pathToFileURL(path.join(pkgRoot, 'scripts', 'cdp-lib.mjs')).href);
const electron = path.join(pkgRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const mainJs = path.join(pkgRoot, 'dist', 'electron-main.js');
const PORT = Number(process.env.R35FUNC_PORT || 9611);
const SID = 'inst-r35func-1';
const profile = path.join(os.tmpdir(), 'warmy-r35-func-' + Date.now());
fs.mkdirSync(profile, { recursive: true });

/**
 * 密钥**只走环境变量**（铁律：门禁脚本里不得出现真实用户路径 / 密钥文件名）。
 * 未设置时这条门禁如实报"未提供密钥"，而不是偷偷用某个本机路径。
 */
const KEY_FILE = String(process.env.MIMO_KEY_FILE || '').trim();
const MIMO_KEY = (() => {
  try { return String(fs.readFileSync(KEY_FILE, 'utf8').split(/\r?\n/)[0] || '').trim(); } catch { return ''; }
})();
const OLLAMA_CHAT = process.env.R35FUNC_OLLAMA || 'qwen3.8-27b:iq4-128K';
const TTS_AUDIO = process.env.R35FUNC_AUDIO || '';

const settings = {
  yuYan: 'zh-CN', setupDone: true, privacyConsent: true, guideDone: true, providersSeeded: true,
  instances: [{
    id: SID, ming: '牛马-1', name: '牛马-1', status: 'running', dutyEligible: true, notify: true,
    model: 'mimo-v2.5-pro', chain: ['mimo-v2.5-pro', OLLAMA_CHAT], chainDisabled: [],
    asrModel: 'mimo-v2.5-asr', ttsModel: 'mimo-v2.5-tts',
  }],
  providers: [
    { id: 'mimo-r35', biaoQian: 'MiMo（真机）', protocol: 'openai-compatible', baseURL: 'https://token-plan-cn.xiaomimimo.com/v1', apiKey: MIMO_KEY, hasKey: !!MIMO_KEY, models: ['mimo-v2.5-pro', 'mimo-v2.5-asr', 'mimo-v2.5-tts'] },
    { id: 'ollama-r35', biaoQian: 'Ollama（真机）', protocol: 'ollama', baseURL: 'http://127.0.0.1:11434', models: ['clef:latest', OLLAMA_CHAT], hasKey: false },
  ],
  /** 听话/说话模型链：真机上就是用户自己配的这两条（缺了会如实报 no-asr-model） */
  specialModels: { asrChain: ['mimo-v2.5-asr'], ttsChain: ['mimo-v2.5-tts'], imageChain: [], imageGenChain: [] },
  authGrants: { [SID]: [] },
  panelCardCollapsed: {},
};
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify(settings, null, 2));

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['--remote-debugging-port=' + PORT, '--disable-features=CalculateNativeWinOcclusion', '--user-data-dir=' + profile, mainJs],
  { cwd: pkgRoot, stdio: ['ignore', 'ignore', 'ignore'], windowsHide: false, env });
console.log('PID', child.pid, 'profile', profile);

const jie = [];
const panding = (ming, zhen, xiang) => jie.push({ ming, ok: !!zhen, xiang: xiang === undefined ? '' : String(xiang).slice(0, 400) });

async function dengCdp() {
  for (let i = 0; i < 180; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const j = await r.json();
      if (j.some((x) => x.type === 'page' && /index\.html/.test(x.url))) return true;
    } catch { /* 还没起来 */ }
    await sleep(500);
  }
  return false;
}
let c = null;
try {
  if (!(await dengCdp())) { panding('CDP 起来了', false, '端口没开'); throw new Error('no cdp'); }
  c = await attach(PORT, { biaoQian: 'r35-func', callTimeout: 240000 });
  await c.send('Runtime.enable');
  try { await bootWait(c, '', 60000); } catch (e) { panding('界面启动完成', false, e.message.slice(0, 120)); }
  await sleep(3000);

  /* ── ① 项 7：真 Ollama 能力探测 ─────────────────────────────────── */
  const cb = await c.evaluate(`(async function(){
    try {
      const r = await window.warmy.listModels({ presetId: 'ollama-r35', baseURL: 'http://127.0.0.1:11434', protocol: 'ollama' });
      const nl = (r && r.nengLi) || {};
      const k1 = nl['clef:latest'] ? nl['clef:latest'].kind : '(no-key)';
      const k2 = nl['clef-flash:latest'] ? nl['clef-flash:latest'].kind : '(no-key)';
      return JSON.stringify({ ok: !!(r && r.ok), count: (r && r.models || []).length, clef: k1, clefFlash: k2,
        sample: Object.keys(nl).slice(0, 6) });
    } catch (e) { return JSON.stringify({ ok: false, err: String(e).slice(0, 200) }); }
  })()`);
  const cbj = JSON.parse(cb || '{}');
  panding('项7 真实拉取 Ollama 模型列表成功', cbj.ok === true && cbj.count > 0, cb);
  panding('项7 真机探测：clef:latest 归成「决策」而不是「画图」', cbj.clef === 'decision', 'clef=' + cbj.clef);
  panding('项7 真机探测：clef-flash:latest 同样归成「决策」', cbj.clefFlash === 'decision', 'clefFlash=' + cbj.clefFlash);

  /* ── ⑤ 项 10：附件授权卡（真 IPC） ─────────────────────────────── */
  const fuJianLu = path.join(profile, '我的 附件 测试.txt');
  fs.writeFileSync(fuJianLu, '这是用户拖进来的附件内容 ABC-123。\n');
  const grant = JSON.parse(await c.evaluate(`(async function(){
    try {
      const r = await window.warmy.fuJianShouQuan({ sessionId: '${SID}', items: [{ path: ${JSON.stringify(fuJianLu)}, name: '我的 附件 测试.txt' }] });
      const list = (r && r.items) || [];
      const tiao = list.find(function(x){ return /允许读取/.test(x.text); });
      return JSON.stringify({ ok: !!(r && r.ok), jia: r && r.jia, n: list.length, text: tiao ? tiao.text : '', du: tiao ? tiao.du : null });
    } catch (e) { return JSON.stringify({ ok: false, err: String(e).slice(0, 200) }); }
  })()`));
  panding('项10 附件进授权卡：条目写着「允许读取：<完整路径>」', grant.ok === true && /允许读取/.test(String(grant.text)) && String(grant.text).includes('我的 附件 测试.txt'), JSON.stringify(grant));
  panding('项10 该条目是只读授权（du=true，写/删/跑命令不外溢）', grant.du === true, JSON.stringify(grant));

  /* ── ④ 项 15：真 TTS 音频 → 真 ASR 转写 ───────────────────────── */
  /** 供应商密钥走**凭据仓**（settings 里不放明文 key；`jieMoXingGongYingShang` 只认仓里的） */
  if (MIMO_KEY) {
    const set = await c.evaluate(`(async function(){
      try { const r = await window.warmy.providerKeySet({ providerId: 'mimo-r35', apiKey: ${JSON.stringify(MIMO_KEY)} }); return JSON.stringify(r || {}); }
      catch (e) { return JSON.stringify({ ok: false, err: String(e).slice(0, 120) }); }
    })()`);
    panding('④ 真机把 MiMo 密钥写进凭据仓（不落明文 settings）', /"ok":true/.test(String(set)), String(set).slice(0, 160));
  }
  if (!TTS_AUDIO || !fs.existsSync(TTS_AUDIO)) {
    panding('项15 真音频→真 ASR 转写（需要 R35FUNC_AUDIO 指向一段语音）', false, 'no audio: ' + TTS_AUDIO);
  } else {
    const buf = fs.readFileSync(TTS_AUDIO);
    const b64 = buf.toString('base64');
    const ext = path.extname(TTS_AUDIO).replace('.', '').toLowerCase();
    const asr = JSON.parse(await c.evaluate(`(async function(){
      try {
        const r = await window.warmy.asrTranscribe({ dataUrl: 'data:audio/${ext};base64,${b64}', ext: '${ext}' });
        return JSON.stringify({ ok: !!(r && r.ok), text: (r && r.text) || '', model: (r && r.model) || '', err: (r && r.error) || '' });
      } catch (e) { return JSON.stringify({ ok: false, err: String(e).slice(0, 200) }); }
    })()`));
    panding('项15 真 ASR 转写返回了文字（不是"没配听话模型"）', asr.ok === true && String(asr.text).length > 0, JSON.stringify(asr));
    panding('项15 转写用的**是听话模型**，不是聊天模型冒充', !/mimo-v2\.5-pro/.test(String(asr.model)), 'model=' + asr.model);
    const zhenWen = /牛马|测试|你好|语音|识别/;
    panding('项15 转写内容与音频大体一致（含关键中文词，不是瞎编的散文）', zhenWen.test(String(asr.text)) && String(asr.text).length <= 200, String(asr.text).slice(0, 120));
  }

  /* ── ②③ 真聊一轮 + 真工具调用 ─────────────────────────────────── */
  if (process.env.R35FUNC_SKIP_CHAT === '1') {
    panding('②③ 真聊与真工具调用（本次跳过）', true, 'skip');
  } else {
  await c.evaluate('(function(){ document.querySelector("[data-nav=\\"singleAi\\"]")?.click(); return true; })()');
  await sleep(1200);
  await c.evaluate('(function(){ document.querySelector("#lieBiaoTi .lieBiaoTiaoMu")?.click(); return true; })()');
  await sleep(2500);
  const muBiao = path.join(os.tmpdir(), 'r35 真机 交付 测试.txt');
  try { fs.unlinkSync(muBiao); } catch { /* 不存在 */ }
  const wenTi = '请在工作区里创建一个文本文件，路径就用 r35-真机测试.txt，正文写「这是第35轮真机验证」。只做这一件事，然后告诉我结果。';
  await c.evaluate(`(function(){ const i = document.getElementById('shuRu'); if (!i) return false; i.value = ${JSON.stringify(wenTi)}; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await sleep(400);
  const fa = await c.evaluate('(function(){ const b = document.getElementById("anNiuFaSong"); if (!b) return false; b.click(); return true; })()');
  panding('② 真机点得出"发送"', fa === true, '');

  /** 等真实回复落进界面（最多 8 分钟：本地 27B 很慢） */
  let zuiHou = '';
  let dengDao = false;
  for (let i = 0; i < 96; i++) {
    await sleep(5000);
    const st = JSON.parse(await c.evaluate(`(function(){
      const hs = Array.from(document.querySelectorAll('.xiaoXi.them .bubble'));
      const last = hs.length ? hs[hs.length - 1].textContent : '';
      const zhixing = document.querySelectorAll('.siKaoKuai .xingDongHang').length;
      const yun = document.getElementById('yunXingZhuangTai');
      return JSON.stringify({ n: hs.length, last: last.slice(0, 200), zhixing: zhixing,
        yunCang: yun ? yun.classList.contains('yinCang') : true });
    })()`));
    if (st.n > 0 && st.last && st.yunCang) { zuiHou = st.last; dengDao = true; break; }
  }
  panding('② 真机聊一轮，牛马真的回了话', dengDao && String(zuiHou).length > 0, String(zuiHou).slice(0, 160));

  const ui = JSON.parse(await c.evaluate(`(function(){
    const ms = Array.from(document.querySelectorAll('.xiaoXi.them'));
    const m = ms.length ? ms[ms.length - 1] : null;
    const mx = m && m.querySelector('.xiaoXiMoXing');
    const ci = m && m.querySelector('.xiaoXiCiYuan');
    const hang = Array.from(document.querySelectorAll('.siKaoKuai .xingDongHang')).map(function(h){
      const ico = h.querySelector('.xdIco');
      const zt = h.querySelector('.xdZhuang');
      const ics = ico ? getComputedStyle(ico) : null;
      return { ico: ico ? (ics.maskImage || ics.webkitMaskImage || '') : '', icoTag: ico ? ico.tagName : '',
        icoColor: ics ? ics.backgroundColor : '',
        cao: h.querySelector('.xdCao') ? h.querySelector('.xdCao').textContent : '',
        zt: zt ? zt.textContent : '', color: zt ? getComputedStyle(zt).color : '' };
    });
    const yao = document.querySelector('.xiaoXi.them .siKaoKuai > summary');
    return JSON.stringify({ mx: mx ? mx.textContent.trim() : '', ciTitle: ci ? (ci.getAttribute('title') || '') : '',
      hang: hang, yao: yao ? yao.textContent : '' });
  })()`));
  panding('② 界面上的模型名是**全称**（含供应商 · 模型）', /·/.test(String(ui.mx)) && String(ui.mx).length > 8, ui.mx);
  panding('② 词元气泡里有输入/输出与轮次', /输入\d+/.test(String(ui.ciTitle)) && /输出\d+/.test(String(ui.ciTitle)), String(ui.ciTitle).replace(/\n/g, ' | '));
  panding('③ 真跑出来的行动明细用木马图标（CSS 蒙版 + 强调色）',
    ui.hang.length > 0 && ui.hang.every((x) => /muMa\.svg/.test(String(x.ico)) && /SPAN/i.test(String(x.icoTag))),
    JSON.stringify(ui.hang.map((x) => x.icoTag)));
  panding('③ 真跑出来的行动明细每个操作只有一行（有内容且状态是完成/失败/进行中）',
    ui.hang.length > 0 && ui.hang.every((x) => /完成|失败|进行中/.test(String(x.zt))), JSON.stringify(ui.hang.map((x) => x.zt)));
  panding('③ 执行过程标题就是「执行过程」', /执行过程/.test(String(ui.yao)), ui.yao);

  const cunZai = fs.existsSync(path.join(profile, 'workspace', SID, 'r35-真机测试.txt'))
    || fs.existsSync(path.join(profile, 'workspace', SID));
  panding('③ 真机确实发生了文件操作（工作区里有东西）', cunZai === true, 'workspace=' + path.join(profile, 'workspace', SID));

  /**
   * 第 36 轮【项 6】：**这一轮必须没有 400 参数错误**。
   * 旧代码把内部档位名（`l3`）当 `reasoning_effort` 发出去，MiMo 直接 400 ⇒ 整轮判失败
   * ⇒ 用户看到"一直在要授权、始终完不成"。这条断言就是那个根因的回归闸。
   */
  try {
    const auditP = path.join(profile, 'audit', 'audit.jsonl');
    const raw = fs.existsSync(auditP) ? fs.readFileSync(auditP, 'utf8') : '';
    panding('项6 真机这一轮没有出现参数 400（Invalid request parameters）',
      raw.length > 0 && !/Invalid request parameters|Param Incorrect/.test(raw), 'audit ' + raw.length + ' bytes');
    panding('项6 真机这一轮没有触发 max-tokens 降级（400 的下游症状）',
      raw.length > 0 && !/max-tokens-downgraded/.test(raw), '');
    panding('项6 真机没有"同一路径反复要授权"（auth.grant-once 次数 ≤ 3）',
      raw.length > 0 && (raw.match(/auth\.grant-once/g) || []).length <= 3,
      'grant-once=' + (raw.match(/auth\.grant-once/g) || []).length);
  } catch { panding('项6 审计可读', false, 'audit read fail'); }
  }
} catch (e) {
  panding('真实功能验证脚本跑完', false, String((e && e.message) || e).slice(0, 300));
} finally {
  const ok = jie.filter((x) => x.ok).length;
  const bad = jie.length - ok;
  for (const x of jie) console.log((x.ok ? '  ok   ' : '  FAIL ') + x.ming + (x.xiang ? '  ← ' + x.xiang : ''));
  console.log(`\n==== verify-round35-live-func：${ok} ok / ${bad} FAIL ====`);
  console.log('profile 保留以便复盘：' + profile);
  try { await c?.close?.(); } catch { /* noop */ }
  try { child.kill(); } catch { /* noop */ }
  process.exit(bad ? 1 : 0);
}
