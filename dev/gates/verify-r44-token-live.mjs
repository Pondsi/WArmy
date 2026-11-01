/**
 * verify-r44-token-live.mjs —— token 真实化在**真进程 + 真模型**里的证明（第 44 轮后半 · 用户第 9 条）
 *
 * fast 档（`verify-r44-token`）证的是数学；这一档证的是**接线**：
 *  ① 一轮真对话后，校准表里**真的多了一条原生样本**（不是把自己的猜测当真数）；
 *  ② 键的形状是 `供应商 / 模型 / 密度桶`，并且**落到盘上**（跨重启累计）；
 *  ③ 校准值**真的进了预算**：同一条会话、同样的内容，带表与不带表读到的字符预算，
 *     比值必须等于 `biLi × 安全垫 / 1.15`（±12%）—— 不是"变了就行"，是"按公式变"；
 *  ④ 中文会话与代码会话在同一模型同一百分比下折算出的字符数不同（旧口径必然相同）；
 *  ⑤ 不超窗：原生 prompt token ≤ 该会话真实模型的窗口；且这一轮没撞到 context 类红；
 *  ⑥ 供应商分段是真的：云端那条键必须带云端域名（同模型挂两家不许共用系数）；
 *  ⑦ 回读全部进观测史，**归档时按观测史重算**（用户："记录供应商给出的 token 计量，归档时据此更新算法"）；
 *  ⑧ 重启后"这个会话用的什么模型"不许丢（真缺陷：内存表一重启就空 ⇒ 预算按全局默认模型的窗口算）。
 *
 * 跑法：node dev/gates/verify-r44-token-live.mjs
 *      需要本机 Ollama（真模型真回复；会先逐个探活再选）；给 MIMO_KEY_FILE（只取第一行）时多跑一条云端腿。
 *      R44T_PORT 换端口；R44T_MODEL 指定本地模型；只用临时 profile，不写用户桌面。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const G = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PKG = path.join(G, 'packages', 'app-shell');
const MAIN = path.join(PKG, 'dist', 'electron-main.js');
const ELECTRON = path.join(PKG, 'node_modules', 'electron', 'dist', 'electron.exe');
const PORT = Number(process.env.R44T_PORT || 9977);
const { attach, sleep, bootWait } = await import(pathToFileURL(path.join(PKG, 'scripts', 'cdp-lib.mjs')).href);
const { YAN_XIAN } = await import(pathToFileURL(path.join(PKG, 'dist', 'token-jiliang.js')).href);

let ok = 0; const shi = [];
const jian = (l, p, d) => { if (p) { ok += 1; console.log('  ok   ' + l); return; } shi.push(l); console.log('  FAIL ' + l + (d ? ' ← ' + String(d).slice(0, 300) : '')); };
const say = (s) => console.log('  · ' + s);

/**
 * 选一个**探活成功**的本地模型。
 * 真机教训：按名字猜"这模型能用"结果 Ollama 回 `does not support chat`，整支门禁被一条模型可用性拖红；
 * 度量准不准跟模型大小无关 ⇒ 先用一次最小请求真问一句，能答才用（也顺带选到快的）。
 */
async function tanHuo(name) {
  try {
    const r = await fetch('http://127.0.0.1:11434/api/chat', {
      method: 'POST', signal: AbortSignal.timeout(60000),
      body: JSON.stringify({ model: name, stream: false, messages: [{ role: 'user', content: '只回两个字：好的' }], options: { num_ctx: 2048, think: false } }),
    });
    if (!r.ok) return false;
    const j = await r.json();
    return String(j?.message?.content || '').trim().length > 0;
  } catch { return false; }
}
let bendiMo = '';
{
  let ke = [];
  try {
    const j = await (await fetch('http://127.0.0.1:11434/api/tags')).json();
    ke = (j.models || []).map((m) => ({ name: String(m.name || ''), GB: Math.round((Number(m.size) || 0) / 1e9) }))
      .filter((m) => m.name && !/embed|bge|minilm|clip|whisper|tts/i.test(m.name));
  } catch { /* 本机没起 Ollama */ }
  if (!ke.length) { console.log('本机 Ollama 没有可用的对话模型 ⇒ 整支不跑（不假绿）'); process.exit(1); }
  const yuXian = process.env.R44T_MODEL
    ? [process.env.R44T_MODEL]
    : ke.sort((a, b) => a.GB - b.GB).map((m) => m.name).slice(0, 3).map((n) => n);
  for (const n of yuXian) {
    if (await tanHuo(n)) { bendiMo = n; break; }
    say(`模型 ${n} 探活失败，换下一个`);
  }
}
if (!bendiMo) { console.log('候选模型全部探活失败 ⇒ 整支不跑（不假绿）'); process.exit(1); }
say('本地模型（已探活）：' + bendiMo);

const miYaoLu = process.env.MIMO_KEY_FILE || '';
const miYao = miYaoLu ? String((() => { try { return fs.readFileSync(miYaoLu, 'utf8').split(/\r?\n/)[0]; } catch { return ''; } })() || '').trim() : '';
const MIMO_ID = 'mimo-r44t';
const MIMO_HOST = 'token-plan-cn.xiaomimimo.com';
const MIMO_MO = 'mimo-v2.6-flash';

const profile = path.join(os.tmpdir(), 'warmy-r44-token-' + Date.now());
fs.mkdirSync(profile, { recursive: true });
const peiZhi = {
  yuYan: 'zh-CN', setupDone: true, privacyConsent: true, guideDone: true, providersSeeded: true,
  globalSecurity: 'normal', trustedFolders: [], asrEnabled: false, specialModels: {}, contextBudgetPercent: 60,
  providers: [{
    id: 'ollama-r44t', biaoQian: 'Ollama-r44t', protocol: 'ollama',
    baseURL: 'http://127.0.0.1:11434', defaultModel: bendiMo, models: [bendiMo], staleModels: {}, hasKey: false,
  }],
  instances: [{ id: 'inst-r44t-1', ming: '牛马-1', name: '牛马-1', status: 'running', defaultModel: bendiMo, currentModel: bendiMo, chain: [bendiMo], chainDisabled: [] }],
};
if (miYao) {
  peiZhi.providers.push({ id: MIMO_ID, biaoQian: 'MiMo-r44t', protocol: 'openai-compatible', baseURL: `https://${MIMO_HOST}/v1`, defaultModel: MIMO_MO, models: [MIMO_MO], staleModels: [], hasKey: false });
}
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify(peiZhi, null, 2), 'utf8');

const ZHEN = path.join(profile, 'audit', 'audit.jsonl');
const BIAO = path.join(profile, 'token-calibration.json');
const GUAN_CE = path.join(profile, 'token-observations.jsonl');
const duBiao = () => { try { return JSON.parse(fs.readFileSync(BIAO, 'utf8')); } catch { return {}; } };
/** 审计把业务字段装在 `detail` 里（真机教训：直接读 `r.model` 读到 undefined ⇒ 仪器自己红一串，产品其实是好的） */
const xiang = (r) => (r && r.detail && Object.keys(r.detail).length ? r.detail : (r || {}));
const duShenJi = () => { try { return fs.readFileSync(ZHEN, 'utf8').split(/\r?\n/).filter(Boolean).map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean); } catch { return []; } };
const shenJi = (op) => duShenJi().filter((r) => r.op === op);
const dengShenJi = async (op, miao = 90000) => {
  const dao = Date.now() + miao;
  while (Date.now() < dao) {
    const x = shenJi(op);
    if (x.length) return x;
    await sleep(1200);
  }
  return shenJi(op);
};

const huanJing = { ...process.env }; delete huanJing.ELECTRON_RUN_AS_NODE; delete huanJing.MIMO_KEY_FILE;
let c = null;
let child = null;
const qiDong = async (tag) => {
  if (child) { try { child.kill(); } catch { /* 已退 */ } await sleep(3000); }
  child = spawn(ELECTRON, ['--remote-debugging-port=' + PORT, '--disable-features=CalculateNativeWinOcclusion', '--user-data-dir=' + profile, MAIN],
    { cwd: PKG, stdio: ['ignore', 'ignore', 'ignore'], env: huanJing });
  let lian = false;
  for (let i = 0; i < 90; i++) { try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) { lian = true; break; } } catch { /* 还没起 */ } await sleep(1000); }
  if (!lian) throw new Error('CDP 起不来（' + tag + '）');
  c = await attach(PORT, { biaoQian: 'r44token', callTimeout: 300000 });
  await c.send('Runtime.enable');
  try { await bootWait(c, '', 90000); } catch { /* 起没起全由后面的断言判 */ }
  await sleep(4000);
  say('已启动（' + tag + '）');
};
const js = (e) => c.evaluate('(async function(){ try { return await (' + e + '); } catch (err) { return { __err: String((err && (err.stack||err.message)) || err).slice(0,200) }; } })()');
const send = (sessionId, content, model) => js(
  `window.warmy.chatSend({ sessionId:${JSON.stringify(sessionId)}, role:'user', content:${JSON.stringify(content)}, model:${JSON.stringify(model)}, ming:'牛马-1' }).then(r=>({ok:!!(r&&r.ok),reply:String((r&&r.reply)||'').slice(0,120),error:String((r&&r.error)||'')}))`
);
const yuSuan = (sessionId) => js(`window.warmy.shangXiaWenYuSuan({ sessionId:${JSON.stringify(sessionId)} })`);

const SID_ZH = 'r44t-zhongwen';
const SID_CODE = 'r44t-daima';
const ZH_NEI = '用一句话告诉我：今天适合出门散步吗？只回一句话，别用工具。';
const DAI_MA = '只回两个字：收到。不要解释。\n' + `function kanChongHeLu(a, b) {\n  const m = new Map();\n  for (let i = 0; i + 8 <= a.length; i += 1) { const k = a.slice(i, i + 8); m.set(k, (m.get(k) || 0) + 1); }\n  let zhong = 0;\n  for (let i = 0; i + 8 <= b.length; i += 1) { if (m.has(b.slice(i, i + 8))) zhong += 1; }\n  return zhong / Math.max(1, b.length - 7);\n}\n`.repeat(12);

try {
  await qiDong('第 1 次（空校准表）');
  if (miYao) { try { await js(`window.warmy.providerKeySet({ providerId:${JSON.stringify(MIMO_ID)}, apiKey:${JSON.stringify(miYao)} })`); } catch { /* 由云端腿自己如实报 */ } }

  const kong = await yuSuan(SID_ZH);
  jian('预算 IPC 活着（ok + tokens + chars + 窗口都在）',
    !!kong && kong.ok === true && kong.tokens > 0 && kong.chars > 0 && kong.maxTokens > 0, JSON.stringify(kong));
  jian('会话还没有内容时走常数兜底（chars = tokens×1.6），不返回 0、也不拿空样本猜',
    !!kong && Math.abs(kong.chars - kong.tokens * 1.6) < Math.max(2, kong.tokens * 0.01), JSON.stringify(kong));

  // ── ① 真对话一轮（中文）⇒ 校准表必须多出**原生**样本 ──
  const r1 = await send(SID_ZH, ZH_NEI, bendiMo);
  jian('本地真模型一轮真对话成功（有回复）', !!r1 && r1.ok === true && r1.reply.length > 0, JSON.stringify(r1));
  const CHAO_OPS = new Set(['chat.context-overflow-retry', 'chat.tools.degraded']);
  const chaoHong = duShenJi().filter((r) => CHAO_OPS.has(String(r.op)));
  jian('这一轮没有撞到上下文超限/工具降级（没被服务端 400 掐死）', chaoHong.length === 0, JSON.stringify(xiang(chaoHong[0] || {})));

  const cal = await dengShenJi('token.calibrate');
  jian('审计里出现了 token.calibrate（供应商回读的真实用量被用上了）', cal.length > 0, '（等了 90s 没有 ⇒ 端点没给原生用量）');
  const ben = xiang(cal[cal.length - 1]);
  const keyZhi = String(ben.model || '');
  const yZh0 = await yuSuan(SID_ZH);
  /**
   * **用户 #2 的正面兑现**：预算设多少，就发多少内容给模型。
   * 这里拿三个真数比：① 装配时量出来的整条预算（`chat.budget.allocated`）② 视图分到的额度
   * ③ 供应商回读的**真实 prompt token**。旧实现里 ③ 一定 > ①（固定开销全在预算之外）。
   */
  const pei = xiang(shenJi('chat.budget.allocated').map(xiang).filter((d) => Number(d.yuSuanTokens) > 0).pop() || {});
  jian('装配时算了整条成本：固定开销被量出来、分段表非空（#3 的"可计算大小"）',
    Number(pei.guDing) > 0 && Number(pei.gongJu) > 0 && Array.isArray(pei.duan) && pei.duan.length > 0,
    JSON.stringify(pei).slice(0, 240));
  jian('视图额度 > 0 且 **小于**整条预算（预算终于"包含所有发给模型的内容"）',
    Number(pei.shiTuTokens) > 0 && Number(pei.shiTuTokens) < Number(pei.yuSuanTokens),
    `视图 ${pei.shiTuTokens} / 预算 ${pei.yuSuanTokens}`);
  jian('这一轮**真实发送的 prompt token ≤ 用户设的预算**（不是"看起来有界"）',
    Number(ben.zhenShi) > 0 && Number(ben.zhenShi) <= Number(pei.yuSuanTokens),
    `真实 ${ben.zhenShi} vs 预算 ${pei.yuSuanTokens}（固定 ${pei.guDing} + 工具 ${pei.gongJu}）`);
  jian('滑杆下限由实测固定开销抬起（且不顶死：≤99），界面据此不能再让用户选到"装不下"的值',
    Number(yZh0.zuiXiaoPercent) >= 1 && Number(yZh0.zuiXiaoPercent) <= 99 && Number(yZh0.guDingTokens) > 0,
    `下限 ${yZh0 && yZh0.zuiXiaoPercent}% 固定 ${yZh0 && yZh0.guDingTokens} tok`);
  jian('校准键的形状是 `供应商/模型/密度桶` 三段（换供应商不许共用系数）',
    /^.+\/.+\/d[123]$/.test(keyZhi) && keyZhi.includes('127.0.0.1:11434'), keyZhi || '(无)');
  jian('比值落在限幅内 [0.25, 2.5] 且样本数 ≥1',
    Number.isFinite(Number(ben.biLi)) && ben.biLi >= 0.25 && ben.biLi <= 2.5 && Number(ben.n) >= 1, JSON.stringify(ben));
  jian('同时记了上界与真实值（"这轮估得准不准"当场可查）',
    Number(ben.shangJie) > 0 && Number(ben.zhenShi) > 0, JSON.stringify(ben));
  jian('上界与真实值在同一量级（差 ≤2 倍 ⇒ 估算不是瞎猜，误差可被校准吸收）',
    Number(ben.shangJie) >= Number(ben.zhenShi) * 0.5, `上界=${ben.shangJie} 真实=${ben.zhenShi}`);
  jian('记了残余误差 wuCha（决定这个桶的安全垫厚度）', Number.isFinite(Number(ben.wuCha)), JSON.stringify(ben));
  jian('真实输入 token ≤ 该会话真实模型的窗口（发送前就守住，不靠服务端报错）',
    Number(ben.zhenShi) > 0 && Number(ben.zhenShi) <= Number(yZh0.maxTokens || 0), `zhenShi=${ben.zhenShi} 窗口=${yZh0 && yZh0.maxTokens}`);
  jian('预算 IPC 报的模型就是这个会话真正用的模型（不是全局默认）',
    String(yZh0.model || '').toLowerCase() === String(bendiMo).toLowerCase(), `${yZh0 && yZh0.model} vs ${bendiMo}`);

  const biao1 = duBiao();
  jian('校准表落盘（token-calibration.json）且键带供应商与密度桶',
    Object.keys(biao1).some((k) => /\/d[123]$/.test(k)), JSON.stringify(biao1).slice(0, 200));
  jian('每一次回读都追加了一条观测（归档时按全量记录重算，不只看在线 EMA）',
    fs.existsSync(GUAN_CE) && fs.readFileSync(GUAN_CE, 'utf8').split(/\r?\n/).filter(Boolean).length >= 1,
    fs.existsSync(GUAN_CE) ? '' : '没有 token-observations.jsonl');

  // ── ② 第二条会话：代码形状 ⇒ 折算出的字符预算必须不同 ──
  const r2 = await send(SID_CODE, DAI_MA, bendiMo);
  jian('第二轮（贴代码）真对话成功', !!r2 && r2.ok === true, JSON.stringify(r2));
  const yZh = await yuSuan(SID_ZH);
  const yCode = await yuSuan(SID_CODE);
  jian('同一模型、同一百分比：中文会话与代码会话的字符预算不同（口径跟着文字构成走）',
    !!yZh && !!yCode && yZh.chars > 0 && yCode.chars > 0 && Math.abs(yZh.chars - yCode.chars) / Math.min(yZh.chars, yCode.chars) > 0.08,
    `zh=${yZh && yZh.chars} code=${yCode && yCode.chars}`);
  jian('两者的 token 预算相同（变的只是 token↔字符的折算，没有偷改预算）',
    !!yZh && !!yCode && yZh.tokens === yCode.tokens, `zh=${yZh && yZh.tokens} code=${yCode && yCode.tokens}`);

  // ── ③ 归档 ⇒ 按观测史重算（用户第 9 条补充） ──
  const gui = await js(`window.warmy.sessionSummary({ sessionId:${JSON.stringify(SID_ZH)}, auto:true })`);
  jian('会话摘要（归档）真的生成了', !!gui && gui.ok === true, JSON.stringify(gui).slice(0, 160));
  const chong = xiang((shenJi('token.recalc-at-archive')[0]) || {});
  jian('归档时按观测史重算了校准表（审计给出观测量与模型条目数）',
    Number(chong.guanCe) >= 1 && Number(chong.moXingShu) >= 1, JSON.stringify(chong));
  const guAN = fs.readFileSync(GUAN_CE, 'utf8').split(/\r?\n/).filter(Boolean).map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
  jian('观测记录结构可重算（每条都带 供应商/模型/桶/上界/真实）',
    guAN.length >= 1 && guAN.every((x) => x.gongYing && x.moXing && /^d[123]$/.test(String(x.tong)) && Number(x.shangJie) > 0 && Number(x.zhenShi) > 0),
    JSON.stringify(guAN[0] || {}).slice(0, 200));
  jian('平均法条目只在"某模型样本够多"时才生成（刚跑两轮的现场不该凭空冒出平均值）',
    !Object.keys(duBiao()).some((k) => k.startsWith('@avg/')) || Object.values(duBiao()).filter((v) => v && v.yangBenShu >= 3).length >= 1,
    Object.keys(duBiao()).join(' '));

  /** 归档重算**之后**的表才是重启后应当看到的那份（重算前读到的是在线 EMA 的中间态，两者不该拿来比） */
  const biaoSuanHou = duBiao();

  // ── ④ 校准必须**按公式**改变预算：带表读一次，删表重启再读一次 ──
  await qiDong('第 2 次（带着校准表重启）');
  const biao2 = duBiao();
  const xiao = biao2[keyZhi] || biaoSuanHou[keyZhi] || null;
  /** chat-meta 是"记忆服务起来之后"才读进内存的，可能要等几秒 ⇒ 轮询而不是拍一次就算红 */
  let moXingHui = '';
  for (let i = 0; i < 15 && moXingHui !== String(bendiMo).toLowerCase(); i++) {
    moXingHui = String((await yuSuan(SID_ZH))?.model || '').toLowerCase();
    if (moXingHui !== String(bendiMo).toLowerCase()) await sleep(2000);
  }
  jian('重启后"这个会话用的什么模型"还在（内存表丢了也要能从会话元数据还原 ⇒ 窗口不许错一位）',
    moXingHui === String(bendiMo).toLowerCase(), `还原成 ${moXingHui || '(空)'}`);
  jian('重启后校准表还在、内容与归档重算后一致（跨重启累计，不是每轮从零开始）',
    Object.keys(biao2).length > 0 && JSON.stringify(biao2[keyZhi] || {}) === JSON.stringify(biaoSuanHou[keyZhi] || {}),
    `${JSON.stringify(biao2).slice(0, 200)} vs ${JSON.stringify(biaoSuanHou).slice(0, 200)}`);
  const yuSuan_biao = await yuSuan(SID_ZH);

  /**
   * **证明"预算真的读了校准表"不能指望真实比值碰巧离先验很远**（第 48 轮真机两遍红的真因）：
   * 先验是第 44 轮按真机回读重定标的（d3 ≈ 0.9），而这只 4B 模型实测比值 0.88–0.89 ⇒ 比值×垫子与先验×垫子
   * 差不到 0.5%，有表/无表四舍五入成**同一个字符数**——产品是对的，是旧判据假设了"校准值一定离先验远"。
   * 所以另写一份**人为偏离**的校准值（0.6）重启，按公式核对：这一条与模型真实比值无关，必然判得出表有没有被读。
   */
  const PIAN_BI = 0.6;
  fs.writeFileSync(BIAO, JSON.stringify({ ...biao2, [keyZhi]: { biLi: PIAN_BI, yangBenShu: 5, wuCha: 0 } }), 'utf8');
  await qiDong('第 2b 次（人为偏离的校准值 0.6）');
  const yuSuan_pian = await yuSuan(SID_ZH);

  /** 删表必须在第 3 次启动**之前**：进程一起来就会把表读进内存（懒加载），起来之后再删等于没删 */
  fs.rmSync(BIAO, { force: true });
  await qiDong('第 3 次（表已删）');
  const yuSuan_wu = await yuSuan(SID_ZH);
  /**
   * 删表 ≠ 回到"未校准上界"。查系数是**三条腿**：精确命中 → 该桶平均法 → **先验**（`YAN_XIAN`）。
   * 刚跑完两轮的现场既没有该桶平均法条目，就应当落到先验 ⇒ 期望值必须按先验算，
   * 按 1.0 算会把"更准的兜底"误判成"没生效"（第一遍真机就这么红的）。
   */
  const tongHao = keyZhi.slice(keyZhi.lastIndexOf('/') + 1);
  const xian = YAN_XIAN[tongHao] || { biLi: 1, wuCha: 0 };
  const dian = (v) => 1.15 + Math.min(0.35, Math.max(0, Number(v && v.wuCha) || 0));
  const jiaBi = (v) => Number.isFinite(Number(v && v.biLi)) ? Math.min(2.5, Math.max(0.25, Number(v.biLi))) : 1;
  const xiaoBi = xiao ? jiaBi(xiao) : 1;
  const expected = yuSuan_biao && yuSuan_biao.chars
    ? Math.round(yuSuan_biao.chars * (xiaoBi * dian(xiao)) / (jiaBi(xian) * dian(xian)))
    : 0;
  const qiPian = yuSuan_wu && yuSuan_wu.chars ? Math.round(yuSuan_wu.chars * (jiaBi(xian) * dian(xian)) / (PIAN_BI * dian({ wuCha: 0 }))) : 0;
  jian('预算**真的读了校准表**：人为写入比值 0.6 后字符数按公式放大（chars(0.6) ≈ chars(先验) × 先验×垫子 / (0.6×1.15)，±3%；表是摆设 ⇒ 不变）',
    !!yuSuan_pian && !!yuSuan_wu && qiPian > 0 && yuSuan_pian.chars > yuSuan_wu.chars && Math.abs(yuSuan_pian.chars - qiPian) / qiPian < 0.03,
    `偏离值=${yuSuan_pian && yuSuan_pian.chars} 期望≈${qiPian} 先验=${yuSuan_wu && yuSuan_wu.chars}`);
  jian('两种状态下视图都不许被算成 0（预算低于固定开销实测下限时**抬到下限**，不许假装装不下）',
    !!yuSuan_wu && !!yuSuan_biao && yuSuan_wu.chars >= 200 && yuSuan_biao.chars >= 200,
    `有表=${yuSuan_biao && yuSuan_biao.chars} 无表=${yuSuan_wu && yuSuan_wu.chars}`);
  jian('变化量符合公式 chars(无表) = chars(有表) × (biLi×垫子) / (先验×先验垫子)（±12%，不是随机漂移）',
    expected > 0 && !!yuSuan_wu && Math.abs(yuSuan_wu.chars - expected) / expected < 0.12,
    `期望≈${expected} 实得=${yuSuan_wu && yuSuan_wu.chars} 系数=${xiao ? Number(xiao.biLi).toFixed(3) : '(无)'}`);
  {
    /** 真实校准值相对先验的**方向**：比先验小 ⇒ 放行更多；比先验大 ⇒ 放行更少（更保守）；贴着先验（<0.5%）⇒ 两者几乎一样 */
    const pv = xiaoBi * dian(xiao);
    const px = jiaBi(xian) * dian(xian);
    const fang = pv < px * 0.995 ? 'duo' : pv > px * 1.005 ? 'shao' : 'ping';
    const a = Number(yuSuan_biao && yuSuan_biao.chars) || 0;
    const b = Number(yuSuan_wu && yuSuan_wu.chars) || 0;
    const dui = fang === 'duo' ? a > b : fang === 'shao' ? a < b : b > 0 && Math.abs(a - b) / b <= 0.01;
    jian('真实校准值与先验的方向对得上（实测比先验低 ⇒ 放行更多；高 ⇒ 放行更少；贴着先验 ⇒ 差 ≤1%）',
      a > 0 && b > 0 && dui, `实测 ${xiaoBi.toFixed(4)}×${dian(xiao).toFixed(3)} vs 先验 ${jiaBi(xian)}×${dian(xian).toFixed(3)} ⇒ ${fang} · 有表=${a} 先验=${b}`);
  }
  jian('两种情况下 token 预算不变（窗口与百分比都没动）',
    !!yuSuan_wu && !!yuSuan_biao && yuSuan_wu.tokens === yuSuan_biao.tokens, `${yuSuan_wu && yuSuan_wu.tokens} vs ${yuSuan_biao && yuSuan_biao.tokens}`);

  // ── ⑤ 云端腿：拿得到用量就校准；拿不到用量**不许**假装有真实样本 ──
  if (miYao) {
    const r3 = await send('r44t-mimo', '只回两个字：在的。', MIMO_MO);
    jian('MiMo 云端一轮真对话成功', !!r3 && r3.ok === true, JSON.stringify(r3));
    const yun = shenJi('token.calibrate').map(xiang).filter((d) => /mimo/i.test(String(d.model || '')));
    const biaoYunKeys = Object.keys(duBiao()).filter((k) => /mimo/i.test(k));
    if (yun.length) {
      jian('云端也拿到了原生用量并校准（比值在限幅内）',
        yun.every((d) => d.biLi >= 0.25 && d.biLi <= 2.5), JSON.stringify(yun[yun.length - 1]));
      jian('云端条目按**云端域名**分开存（与本机同模型不同供应商绝不共用系数）',
        biaoYunKeys.some((k) => k.includes(MIMO_HOST)), biaoYunKeys.join(' '));
    } else {
      jian('云端没给原生用量 ⇒ 表里绝不能出现云端条目（不许把自己的猜测当真数）',
        biaoYunKeys.length === 0, JSON.stringify(biaoYunKeys));
      say('这一遍云端端点没回原生 usage ⇒ 按未校准上界跑（判据已如实改走"不许假装"这条）');
    }
  } else {
    say('没给云端密钥 ⇒ 云端腿不跑（不算绿也不算红）');
  }
} catch (e) {
  jian('整条路跑完没抛错', false, String((e && e.message) || e).slice(0, 260));
} finally {
  try { if (c && c.close) c.close(); } catch { /* 已经断了 */ }
  try { if (child) child.kill(); } catch { /* 已退 */ }
  await sleep(2000);
  for (let i = 0; i < 20 && fs.existsSync(profile); i++) { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { await sleep(500); } }
}
console.log('\n==== verify-r44-token-live：' + ok + ' ok / ' + shi.length + ' FAIL ====');
for (const s of shi) console.log('  ✗ ' + s);
process.exit(shi.length ? 1 : 0);
