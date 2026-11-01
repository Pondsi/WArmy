/**
 * verify-r44-ui.mjs —— 第 44 轮变更的门禁（用户项 1/2/3/4）
 *
 * 为什么这一支必须**量像素**（第 44 轮的核心教训）：
 *   用户项 3「授权卡按钮不对齐，这个还是没有修好」——前几轮的门禁是**读 CSS 源码文本**的
 *   （`verify-round37-changes.mjs` 里那句正则测 `app.css` 字符串），
 *   而 index.html 里 **renderer.css 后加载会覆盖** ⇒ 源码里规则在、界面照样歪 ⇒ "绿了但用户还是看着红"。
 *   这一支改成在真 Electron 里 `getBoundingClientRect()` + `getComputedStyle()` 量，
 *   并且**两份 CSS 都查**，任何一份缺规则直接红。
 *
 * 用法：node dev/gates/verify-r44-ui.mjs
 *       R44_PORT=9611 node dev/gates/verify-r44-ui.mjs   （默认 9601）
 *       R44_SKIP_MODEL=1 …                                只跑静态 + 界面（不跑真实 Ollama 那一轮）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PKG = path.join(__ROOT, 'packages', 'app-shell');
const ELECTRON = path.join(PKG, 'node_modules', 'electron', 'dist', 'electron.exe');
const MAIN = path.join(PKG, 'dist', 'electron-main.js');
const { attach, sleep } = await import(pathToFileURL(path.join(PKG, 'scripts', 'cdp-lib.mjs')).href);
const GG = await import(pathToFileURL(path.join(PKG, 'dist', 'mo-xing-gui-ge.js')).href);

const PORT = Number(process.env.R44_PORT || 9601);
const TIAO_WEN = (m) => String(m).replace(/\r?\n/g, ' ').trim();

let ok = 0; const hong = [];
const jian = (l, p, d) => { if (p) { ok += 1; console.log('  ok   ' + l); return; } hong.push(l); console.log('  FAIL ' + l + (d ? ' ← ' + TIAO_WEN(d).slice(0, 300) : '')); };

/* ══ A. 静态：换算口径 + 官方表 + 两份 CSS 都有规则 ══════════════════════ */
console.log('A. 静态断言（换算与样式表）');
{
  /** 用户项 2：1M 的模型不许显示成 1048.576k —— 逐个数钉死 */
  const QING = [
    [1048576, 1, 'm'], [1000000, 1, 'm'], [131072, 128, 'k'], [262144, 256, 'k'],
    [16384, 16, 'k'], [384000, 384, 'k'], [32768, 32, 'k'], [65536, 64, 'k'], [200000, 200, 'k'],
  ];
  for (const [t, n, u] of QING) {
    const z = GG.zhanShiDanWei(t);
    jian('换算 ' + t + ' ⇒ ' + n + u, z.num === n && z.unit === u && z.tokens === t, JSON.stringify(z));
  }
  const m = GG.zhanShiDanWei(1048577);
  jian('不能整除时最多 2 位小数，且精确值仍带得出（1048577）', m.unit === 'm' && String(m.num).length <= 4 && m.tokens === 1048577, JSON.stringify(m));
  jian('自查器能抓住"1048.576k"这一类（用户截图里的那一条）',
    GG.panZeZhanShi('mimo', { num: 1048.576, unit: 'k', tokens: 1048576 }).length >= 2, JSON.stringify(GG.panZeZhanShi('mimo', { num: 1048.576, unit: 'k', tokens: 1048576 })));
  jian('自查器对正确的读数不误报（1m / 128k）',
    GG.panZeZhanShi('a', GG.zhanShiDanWei(1048576)).length === 0 && GG.panZeZhanShi('b', GG.zhanShiDanWei(131072)).length === 0);

  /** 官方规格表（第 44 轮按官网核对）：值与来源都要在 */
  const ti = GG.chaMoXingGuiGe('mimo-v2.5');
  jian('MiMo v2.5 官方规格：窗口 1M / 输出 128K / RPM 100 / TPM 10M',
    !!ti && ti.chuangKou === 1000000 && ti.shuChu === 128000 && ti.rpm === 100 && ti.tpm === 10000000, JSON.stringify(ti));
  jian('MiMo 系输入模态按官方页登记（不是"只读文本"）', !!ti && (ti.inTypes || []).includes('image'), JSON.stringify(ti && ti.inTypes));
  const ds = GG.chaMoXingGuiGe('deepseek-chat');
  jian('deepseek-chat 已按官方改为 1M（旧表 65536 是 16 倍错误）', !!ds && ds.chuangKou === 1000000 && ds.heShiRi === '2026-10-19', JSON.stringify(ds));
  jian('带供应商前缀的名字也查得到（vendor/mimo-v2.5）', !!GG.chaMoXingGuiGe('xiaomi/mimo-v2.5'));
  jian('未核对的历史条目必须标 heShiRi:null（不许把没根据的数装成核实过的）',
    GG.chaMoXingGuiGe('gpt-4o') && GG.chaMoXingGuiGe('gpt-4o').heShiRi === null);

  /** 两份 CSS 都要有本轮新增的规则（renderer.css 后加载 ⇒ 只写一份等于没写） */
  const app = fs.readFileSync(path.join(PKG, 'src', 'renderer', 'app.css'), 'utf8');
  const ren = fs.readFileSync(path.join(PKG, 'src', 'renderer', 'renderer.css'), 'utf8');
  for (const xuan of ['.siKaoKuai > summary', '.xingDongXiang', '#shouQuanKaiGuan', '.aiqOpts > button', '.moXingYuEDan .mqHang']) {
    jian('CSS 两份都有「' + xuan + '」', app.includes(xuan) && ren.includes(xuan), 'app=' + app.includes(xuan) + ' ren=' + ren.includes(xuan));
  }
  /** 额度窗紧凑：两栏网格；且数字栏旁边有精确 token 行 */
  jian('额度窗两栏网格写在两份 CSS（grid-template-columns: 1fr 1fr）',
    /mqHang[\s\S]{0,120}grid-template-columns:\s*1fr 1fr/.test(app) && /mqHang[\s\S]{0,120}grid-template-columns:\s*1fr 1fr/.test(ren));
  /** 渲染层：授权卡「添加」不许再挂到卡片根（挂根 = 自成一行 = 用户看到的歪） */
  const rendererJs = fs.readFileSync(path.join(PKG, 'src', 'renderer', 'app.js'), 'utf8');
  const mainSrc = fs.readFileSync(path.join(PKG, 'src', 'electron-main.ts'), 'utf8');
  jian('「添加」挂到标题行 #shouQuanKaiGuan（源码）', rendererJs.includes("kuai.querySelector('#shouQuanKaiGuan')"), '源码里没有这一句');
  jian('「添加」不再挂到卡片根（旧的 `const h2 = …` 写法必须消失）', !rendererJs.includes('const h2 = kuai.querySelector'), '还留着挂根的写法');
  jian('「添加」不再带内联 marginLeft（内联样式会盖过 CSS）', !/tianAdd\.style\.marginLeft/.test(rendererJs));
  /** 必填：确定按钮要真的 disabled，不是点了才报错 */
  jian('输入/输出类型没勾全 ⇒ 确定按钮 disabled（源码）', /anOk\.disabled\s*=\s*que\.length > 0/.test(rendererJs));
  /** 第 44 轮自查补的两条回归（都是"门禁过了但界面还是错的"那一类，量出来才算） */
  jian('「添加」插在折叠箭头**之前**（箭头必须还是行末）', /tou\.insertBefore\(tianAdd,\s*tou\.querySelector\('\.jianTou'\)/.test(rendererJs));
  jian('额度来源分层：自动快照不许被说成"你的设置"（ziDong 参与判定）', /function shiYongHuRenDing/.test(mainSrc) && /shiYongHuRenDing\(cun\)/.test(mainSrc));
  jian('预算用的窗口同样只认"用户认定过"的快照（否则旧 128K 永远留在预算里）', /shiYongHuRenDing\(fu\)\s*&&\s*fu\?\.ctx/.test(mainSrc));
}

/* ══ B. 真机：量像素 ═══════════════════════════════════════════════════ */
console.log('\nB. 真机断言（Electron + CDP 量盒模型）');
const profile = path.join(os.tmpdir(), 'warmy-r44-ui-' + Date.now());
const gongZuo = path.join(profile, 'ws');
fs.mkdirSync(gongZuo, { recursive: true });
const now = Date.now();
const BIAO_JI = 'R44UI' + now.toString(36).toUpperCase();
const wenJianLu = path.join(gongZuo, BIAO_JI + '.txt');

/** 本地 Ollama 真模型（用户口径：真实对话 + 真实工具调用）；取一个能调工具、能看图优先 */
let benDiMoXing = '';
try {
  const tg = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(6000) }).then((r) => r.json());
  const lie = (tg.models || []).map((m) => String(m.name));
  for (const n of lie) {
    try {
      const s = await fetch('http://127.0.0.1:11434/api/show', { method: 'POST', body: JSON.stringify({ model: n }), signal: AbortSignal.timeout(6000) }).then((r) => r.json());
      const caps = Object.keys(s.model_info || {}).map((k) => k.toLowerCase()).join(',');
      const can = String(s.capabilities || '').toLowerCase();
      if (can.includes('tools') || /tools/.test(caps)) { benDiMoXing = n; break; }
    } catch { /* 单模型查不到就跳过 */ }
  }
  if (!benDiMoXing) benDiMoXing = lie[0] || '';
} catch { /* Ollama 没起 ⇒ 下面真机段会红并说明原因 */ }
console.log('  · 本地真模型：' + (benDiMoXing || '（Ollama 不可用）'));

const peiZhi = {
  yuYan: 'zh-CN', setupDone: true, privacyConsent: true, guideDone: true, providersSeeded: true,
  globalSecurity: 'normal', trustedFolders: [gongZuo], asrEnabled: false,
  providers: [
    { id: 'ollama-r44', biaoQian: 'Ollama（第 44 轮）', protocol: 'ollama', baseURL: 'http://127.0.0.1:11434', defaultModel: '', models: benDiMoXing ? [benDiMoXing] : [], staleModels: [], hasKey: false },
    /** 额度窗只读设置与官方表，不调这个端点 ⇒ 地址写真的、没有 key 也不影响本档 */
    { id: 'mimo-r44', biaoQian: 'MiMo（第 44 轮）', protocol: 'openai-compatible', baseURL: 'https://token-plan-cn.xiaomimimo.com/v1', defaultModel: '', models: ['mimo-v2.5', 'mimo-v2.5-pro', 'mimo-v2.6-flash'], staleModels: [], hasKey: false },
  ],
  specialModels: { chatChain: benDiMoXing ? [benDiMoXing] : [], asrChain: [], asrDisabled: [] },
  instances: [{ id: 'inst-r44-1', ming: '牛马-1', name: '牛马-1', status: 'running', defaultModel: 'Ollama（第 44 轮） · ' + benDiMoXing, currentModel: benDiMoXing, chain: ['Ollama（第 44 轮） · ' + benDiMoXing], chainDisabled: [] }],
  /** 项 3 夹具：授权卡有内容（3 条 = 能同时量到标题行的「添加」与每行的「撤销」） */
  authGrants: { 'inst-r44-1': [
    { id: 'g1', text: 'AI 请求访问工作区外的文件\n操作：write_file 路径：Desktop/甲.txt', ts: now - 300000 },
    { id: 'g2', text: 'AI 请求访问工作区外的文件\n操作：make_pptx 路径：Desktop/乙.pptx', ts: now - 240000 },
    { id: 'g3', text: 'AI 请求打开工作区外的文件\n路径：Desktop/丙.txt', ts: now - 180000 },
  ] },
  /** 项 2 夹具：一条"上一版换算残渣"的历史记录 ⇒ 界面必须读成 1m，而不是 1048.576k */
  modelQuota: { 'mimo-v2.5': { ctxNum: 1048.576, ctxUnit: 'k', rpm: 524, tpm: 2097152, inTypes: ['text'], outTypes: ['text'], ziDong: true } },
};
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify(peiZhi, null, 2), 'utf8');

const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(ELECTRON, ['--remote-debugging-port=' + PORT, '--disable-features=CalculateNativeWinOcclusion', '--user-data-dir=' + profile, MAIN],
  { cwd: PKG, stdio: ['ignore', 'ignore', 'ignore'], env });
let c = null;
const js = (e) => c.evaluate('(async function(){ try { return await (' + e + '); } catch (err) { return { __err: String((err && (err.stack || err.message)) || err).slice(0, 260) }; } })()');
const guan = async () => {
  try { const g = await attach(PORT, { biaoQian: 'r44-guan', callTimeout: 8000 }); try { await g.send('Browser.close'); } catch { /* noop */ } try { g.close(); } catch { /* noop */ } } catch { /* 已退 */ }
  for (let i = 0; i < 20; i++) { if (child.exitCode !== null) break; await sleep(700); }
  try { if (child.exitCode === null) child.kill(); } catch { /* noop */ }
};
try {
  let qi = false;
  for (let i = 0; i < 60; i++) { try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) { qi = true; break; } } catch { /* 还没起 */ } await sleep(1000); }
  if (!qi) { jian('CDP 起得来', false, 'timeout'); } else {
    await sleep(6000);
    c = await attach(PORT, { biaoQian: 'r44-ui', callTimeout: 180000 });
    await c.send('Runtime.enable');
    await sleep(2000);

    /* ── 项 3：授权卡按钮对齐（量 rect，不看源码） ── */
    const shouQuan = await js(`(() => {
      const tou = document.querySelector('#shouQuanKaiGuan');
      const tian = document.querySelector('#anNiuShouQuanTianJia');
      const che = document.querySelector('.shouQuanCheXiaoXiao');
      const g = (n) => { if (!n) return null; const r = n.getBoundingClientRect(); const s = getComputedStyle(n); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), h: Math.round(r.height), minH: s.minHeight, pad: s.padding, fs: s.fontSize, disp: s.display }; };
      return { tou: g(tou), tian: g(tian), che: g(che), jianTou: g((tou && tou.querySelector) ? tou.querySelector('.jianTou') : null), tianParentId: tian && tian.parentElement ? tian.parentElement.id : '', tianInlineMl: tian ? String(tian.style.marginLeft || '') : '' };
    })()`);
    jian('项3 「添加」挂在标题行里（不在卡片根自成一行）', shouQuan && shouQuan.tianParentId === 'shouQuanKaiGuan', JSON.stringify(shouQuan && { p: shouQuan.tianParentId }));
    jian('项3 「添加」不再有内联 marginLeft（内联会盖 CSS）', shouQuan && !shouQuan.tianInlineMl, shouQuan && shouQuan.tianInlineMl);
    jian('项3 「添加」的垂直中心在标题行的盒内（同一行，不掉到下一行）',
      !!(shouQuan && shouQuan.tou && shouQuan.tian && shouQuan.tian.top >= shouQuan.tou.top - 2 && shouQuan.tian.bottom <= shouQuan.tou.bottom + 2),
      JSON.stringify(shouQuan && { tou: shouQuan.tou, tian: shouQuan.tian }));
    jian('项3 「添加」与「撤销」盒高一致（±2px）',
      !!(shouQuan && shouQuan.tian && shouQuan.che && Math.abs(shouQuan.tian.h - shouQuan.che.h) <= 2),
      JSON.stringify(shouQuan && { tianH: shouQuan.tian && shouQuan.tian.h, cheH: shouQuan.che && shouQuan.che.h }));
    jian('项3 两个按钮的字号/内边距同一套（不是各长各的）',
      !!(shouQuan && shouQuan.tian && shouQuan.che && shouQuan.tian.fs === shouQuan.che.fs && shouQuan.tian.pad === shouQuan.che.pad),
      JSON.stringify(shouQuan && { tian: shouQuan.tian && [shouQuan.tian.fs, shouQuan.tian.pad], che: shouQuan.che && [shouQuan.che.fs, shouQuan.che.pad] }));
    /** 第 44 轮自查补：把「添加」插进标题行之后，箭头就被挤离行末 —— 旧断言只量"同行/等高"看不见这条 */
    jian('项3 箭头仍是这一行的**最右元素**（「添加」插在它前面）',
      !!(shouQuan && shouQuan.jianTou && shouQuan.tian && shouQuan.jianTou.right >= shouQuan.tian.right - 1),
      JSON.stringify(shouQuan && { jianTouRight: shouQuan.jianTou && shouQuan.jianTou.right, tianRight: shouQuan.tian && shouQuan.tian.right }));

    /* ── 项 3b：审批/决策那一行的按钮等高（once 是主按钮、其余是小按钮） ── */
    const pi = await js(`(() => {
      const z = document.createElement('div'); z.className = 'piZhunKa';
      z.innerHTML = '<div class="aiqOpts"><button class="anNiuXiao">拒绝</button><button class="anNiuZhuYao">仅这一次</button><button class="anNiuXiao">本任务长期</button><button class="anNiuXiao">总是允许</button></div>';
      document.body.appendChild(z);
      const bs = [...z.querySelectorAll('.aiqOpts > button')].map((b) => { const r = b.getBoundingClientRect(); return { h: Math.round(r.height), top: Math.round(r.top), disp: getComputedStyle(b).display }; });
      const gao = bs.map((x) => x.h); const ding = bs.map((x) => x.top);
      const jie = { bs, diffGao: Math.max(...gao) - Math.min(...gao), diffDing: Math.max(...ding) - Math.min(...ding) };
      z.remove(); return jie;
    })()`);
    jian('项3 审批卡四个按钮**等高**（最大差 ≤2px）', !!pi && pi.diffGao <= 2, JSON.stringify(pi && pi.bs));
    jian('项3 审批卡四个按钮**上沿齐平**（最大差 ≤2px）', !!pi && pi.diffDing <= 2, JSON.stringify(pi && { d: pi.diffDing }));

    /* ── 项 1 + 项 2：额度窗（紧凑 / 必填 / 读数） ── */
    /**
     * 额度窗的钩子挂在**渲染「设置 → 模型」列表**的那条路上（`window.__kaiMoXingYuEDu` 由
     * renderProvList 装好）⇒ 必须像用户一样先进设置、点「模型」分区、把折叠的卡展开。
     * 这里照抄 `verify-round39-quota-ui.mjs` 现场踩出来的轮询补点法（点一次会被状态刷新藏掉）。
     */
    let gouZai = false;
    for (let i = 0; i < 16 && !gouZai; i++) {
      await js('(() => { const n = document.querySelector(\'.ceLanTiaoMu[data-nav="settings"]\'); if (n) n.click(); return !!n; })()');
      await sleep(500);
      await js('(() => { const b = document.querySelector(\'#peiZhiDaoHang button[data-sec="model"]\'); if (b) b.click(); return !!b; })()');
      await sleep(300);
      await js('(() => { const ka = document.querySelector("#provLieBiao"); const t = ka && ka.closest(".sheZhiKa"); if (t && t.classList.contains("yinCang")) { const h = document.querySelector("#moXingGuanLiZheDie"); if (h) h.click(); return "zhankai"; } return "yiKai"; })()');
      await sleep(500);
      gouZai = !!(await js('typeof window.__kaiMoXingYuEDu === "function"'));
    }
    jian('进到了「设置 → 模型」（额度窗钩子在）', gouZai, '轮询 16 次仍没有 window.__kaiMoXingYuEDu');
    await js('window.__kaiMoXingYuEDu && window.__kaiMoXingYuEDu("mimo-v2.5")');
    await sleep(2500);
    const e1 = await js(`(() => {
      const mk = document.querySelector('.moXingYuEDan'); if (!mk) return { no: '弹窗没开起来' };
      const r = (s) => { const n = mk.querySelector(s); if (!n) return null; const b = n.getBoundingClientRect(); return { top: Math.round(b.top), h: Math.round(b.height), left: Math.round(b.left), w: Math.round(b.width) }; };
      const ctx = mk.querySelector('#mqCtx'), out = mk.querySelector('#mqOut');
      const danWei = (nm) => (mk.querySelector('input[name=' + nm + ']:checked') || {}).value || '';
      const jing = (id) => { const n = mk.querySelector('.mqJingQue[data-jing="' + id + '"]'); return n ? String(n.textContent || '') : ''; };
      const ka = mk.getBoundingClientRect();
      const dingXing = (id) => { const n = mk.querySelector('#' + id); if (!n) return null; const r = n.getBoundingClientRect(); return Math.round(r.top); };
      const tops = [dingXing('mqCtx'), dingXing('mqOut'), dingXing('mqRpm'), dingXing('mqTpm')].filter((x) => x != null);
      const hangShu = new Set(tops.map((t) => Math.round(t / 4))).size;
      return {
        ctxVal: ctx && ctx.value, ctxUnit: danWei('mqCtxU'), outVal: out && out.value, outUnit: danWei('mqOutU'),
        ctxRow: r('#mqCtx'), outRow: r('#mqOut'), rpmRow: r('#mqRpm'), tpmRow: r('#mqTpm'),
        hangShu,
        jingCtx: jing('mqCtx'), jingOut: jing('mqOut'),
        kuai: Math.round(ka.width), gao: Math.round(ka.height),
        keJian: getComputedStyle(mk).display !== 'none',
        laiYuan: String((mk.querySelector('.mqLai') || {}).textContent || ''),
        guiGe: String((mk.querySelector('.mqGuiGe') || {}).textContent || ''),
      };
    })()`);
    jian('项1 弹窗开起来了（真机有 .moXingYuEDan）', !!e1 && !e1.no, JSON.stringify(e1));
    jian('项1 上下文长度与输出长度在**同一行**（top 相同）',
      !!(e1 && e1.ctxRow && e1.outRow && Math.abs(e1.ctxRow.top - e1.outRow.top) <= 3), JSON.stringify(e1 && { c: e1.ctxRow, o: e1.outRow }));
    jian('项1 rpm 与 tpm 也在**同一行**', !!(e1 && e1.rpmRow && e1.tpmRow && Math.abs(e1.rpmRow.top - e1.tpmRow.top) <= 3), JSON.stringify(e1 && { r: e1.rpmRow, t: e1.tpmRow }));
    jian('项1 四个数字栏只占**两行**（以前一栏一行 = 四行，这就是"更紧凑"要的量）',
      !!(e1 && e1.hangShu === 2), '行数=' + (e1 && e1.hangShu));
    jian('项1 弹窗总高度 ≤480px（两栏并排后不该比原来更高）', !!(e1 && e1.gao > 0 && e1.gao <= 480), '高=' + (e1 && e1.gao));
    /** 用户项 2 的主问题：这条历史记录里存的是 ctxNum:1048.576 / k ⇒ 界面必须读成 1 m */
    jian('项2 1M 的模型显示「1 m」，不再是 1048.576k',
      !!(e1 && String(e1.ctxVal) === '1' && e1.ctxUnit === 'm'), JSON.stringify(e1 && { v: e1.ctxVal, u: e1.ctxUnit }));
    jian('项2 旁边如实写着精确 token 数（= 1,048,576 token）',
      !!(e1 && /1,048,576/.test(e1.jingCtx || '')), JSON.stringify(e1 && e1.jingCtx));
    jian('项2 来源行说得清（你的设置 / 官方规格表都算，不许含糊成"模型报的"）',
      !!(e1 && (e1.laiYuan || '').length >= 6), JSON.stringify(e1 && e1.laiYuan));
    /** 第 44 轮自查补：夹具里这条记录是 `ziDong:true`（自动快照）⇒ 来源**不许**写成"你的设置" */
    jian('项2 自动快照不被冒充成"你的设置"（ziDong 参与来源判定）',
      !!(e1 && (e1.laiYuan || '').indexOf('你的设置') < 0), JSON.stringify(e1 && e1.laiYuan));
    jian('项2 官方规格表那一行在（含核对日期与 RPM/TPM）',
      !!(e1 && /1,000,000/.test(e1.guiGe || '') && /2026-10-19/.test(e1.guiGe || '')), JSON.stringify(e1 && e1.guiGe));

    /* 项 1 的必填：把输入类型全取消 ⇒ 确定必须点不动 */
    const bi = await js(`(() => {
      const mk = document.querySelector('.moXingYuEDan'); if (!mk) return { no: '弹窗不在' };
      const okB = mk.querySelector('#mqOk');
      const before = { disabled: okB.disabled };
      mk.querySelectorAll('input[name=mqIn]').forEach((x) => { x.checked = false; x.dispatchEvent(new Event('change', { bubbles: true })); });
      const afterIn = { disabled: okB.disabled, msg: String((mk.querySelector('#mqMsg') || {}).textContent || '') };
      mk.querySelectorAll('input[name=mqOutT]').forEach((x) => { x.checked = false; x.dispatchEvent(new Event('change', { bubbles: true })); });
      const afterOut = { disabled: okB.disabled };
      mk.querySelector('input[name=mqIn][value=text]').checked = true;
      mk.querySelector('input[name=mqIn][value=text]').dispatchEvent(new Event('change', { bubbles: true }));
      const halfIn = { disabled: okB.disabled };
      mk.querySelector('input[name=mqOutT][value=text]').checked = true;
      mk.querySelector('input[name=mqOutT][value=text]').dispatchEvent(new Event('change', { bubbles: true }));
      const both = { disabled: okB.disabled };
      return { before, afterIn, afterOut, halfIn, both, msg: afterIn.msg };
    })()`);
    jian('项1 打开时是可选状态（原来勾着 ⇒ 确定可点）', !!bi && bi.before && bi.before.disabled === false, JSON.stringify(bi && bi.before));
    jian('项1 取消全部「输入类型」⇒ 确定按钮直接禁用', !!bi && bi.afterIn && bi.afterIn.disabled === true, JSON.stringify(bi && bi.afterIn));
    jian('项1 禁用时说明原因（写清差哪一类，不是闷着灰）',
      !!(bi && bi.afterIn && /输入类型/.test(bi.afterIn.msg || '')), JSON.stringify(bi && bi.afterIn));
    jian('项1 只勾输入不勾输出 ⇒ 仍然禁用（**两类都要至少一个**）',
      !!bi && bi.halfIn && bi.halfIn.disabled === true && bi.afterOut.disabled === true, JSON.stringify(bi && { h: bi.halfIn, o: bi.afterOut }));
    jian('项1 两类各勾上 ⇒ 恢复可点', !!bi && bi.both && bi.both.disabled === false, JSON.stringify(bi && bi.both));

    /* 项 2 的不漂移：不动任何栏直接保存 ⇒ 精确 token 数必须原样保住 */
    const bao = await js(`(async () => {
      const mk = document.querySelector('.moXingYuEDan'); if (!mk) return { no: '弹窗不在' };
      mk.querySelector('#mqOk').click();
      await new Promise((r) => setTimeout(r, 2500));
      const h = await window.warmy.modelQuotaGet({ modelId: 'mimo-v2.5' });
      const d = (h && h.dangQian) || {};
      return { zai: !!document.querySelector('.moXingYuEDan'), num: d.ctx && d.ctx.num, unit: d.ctx && d.ctx.unit, tokens: d.ctx && d.ctx.tokens, ziDong: d.ziDong };
    })()`);
    jian('项2 直接点保存不漂移：窗口仍是精确 1,048,576 token（不是被四舍五入成 1,000,000）',
      !!bao && Number(bao.tokens) === 1048576 && String(bao.num) === '1' && bao.unit === 'm', JSON.stringify(bao));
    jian('项2 用户亲手保存过 ⇒ 这条不再是自动快照（下次拉取不许覆盖）',
      !!bao && bao.ziDong === false, JSON.stringify(bao));

    /* 关弹窗（遮罩点不掉就按取消） */
    await js(`(() => { const b = document.querySelector('.moXingYuEDan #mqCancel'); if (b) b.click(); return true; })()`);
    await sleep(600);

    /* ── 项 4：真实跑一轮 Ollama，量"浮雕到底包住了谁" ── */
    if (process.env.R44_SKIP_MODEL === '1') {
      console.log('  · R44_SKIP_MODEL=1 ⇒ 跳过真实模型那一轮（项 4 的真机测量没跑）');
    } else if (!benDiMoXing) {
      jian('项4 需要本地 Ollama（真实工具调用）', false, 'Ollama /api/tags 不可用 ⇒ 这一档必须接真机，不许跳过判绿');
    } else {
      await js(`(() => { window.__r44 = { ev: [], fa: null }; window.warmy.onYunXingZhuangTai((d) => { try { window.__r44.ev.push(d); } catch (e) {} }); return true; })()`);
      /**
       * 基线要**整棵 profile 树**，不能只看 `ws/`：`write_file` 的相对路径落在应用自己的工作区里，
       * 只盯"我指定的那个目录 + 那个文件名"会把真的写出判成没写出（第 38/44 轮都烧在这类判据上）。
       */
      const HU_HU = /^settings\.json$|^(Cache|Code Cache|GPUCache|Dawn\w*|Network|DIPS\w*|Shared\w*|Local Storage|Session Storage|blob_storage|memory|memory-runtime|audit|checkpoints|scan-dirs|knowledge|board|bus|net|archive|instances|updates|identity|secure)\//;
      const shaMuLu = (dir, base) => {
        base = base || dir; const chu = [];
        let jieDian = [];
        try { jieDian = fs.readdirSync(dir); } catch { return chu; }
        for (const n of jieDian) {
          const p = path.join(dir, n); const xiangDui = path.relative(base, p).replace(/\\/g, '/');
          let st = null; try { st = fs.statSync(p); } catch { continue; }
          if (st.isDirectory()) chu.push(...shaMuLu(p, base));
          else if (!HU_HU.test(xiangDui) && !/\.(log|json|jsonl|sqlite|db|db-wal|db-shm)$/.test(xiangDui)) chu.push(xiangDui);
        }
        return chu;
      };
      const chuShiWenJian = shaMuLu(profile);
      const tiShi = '请在**当前工作区**里新建一个文本文件，文件名 ' + BIAO_JI + '.txt，里面只写一行：' + BIAO_JI + '。做完把文件的完整路径告诉我。不要动工作区外的任何文件。';
      await js(`(() => {
        const j = ${JSON.stringify({
          sessionId: 'inst-r44-1', content: tiShi, insertMode: 'outer', ming: '牛马-1', thinkLevel: 'auto', xiaoDiShuLiang: 'auto',
          moXingJueCe: { urgency: 'P2', defaultModel: benDiMoXing, chain: [benDiMoXing], chainDisabled: [] },
          jiaQiangHuiFu: false,
        })};
        window.warmy.chatSend(j).then((r) => { window.__r44.fa = { done: true, r: r }; }, (e) => { window.__r44.fa = { done: true, err: String((e && e.message) || e) }; });
        return true;
      })()`);
      let wan = null;
      for (let i = 0; i < 150; i++) {
        /** 授权卡只批"目标在本门禁自己的临时目录"那一种，其它一律拒绝（门禁不许污染用户的机器） */
        await js(`(async () => {
          const r = await window.warmy.aiQuestionList();
          for (const q of (r && r.items) || []) {
            if (q.status !== 'pending') continue;
            const x = q.options || [];
            const tong = x.find((o) => /同意|允许/.test(String(o.biaoQian || '')));
            const ju = x.find((o) => /拒绝/.test(String(o.biaoQian || '')));
            const wen = String(q.biaoTi || '') + ' ' + String(q.ti || '');
            /** 只批"目标在本门禁自己的临时目录（warmy-r44-ui-*）"那一种，其它一律拒绝 ⇒ 门禁绝不污染用户的机器 */
            const keYi = !!tong && wen.indexOf('warmy-r44-ui-') >= 0;
            const t = keYi ? tong : (ju || x[x.length - 1]);
            try { await window.warmy.aiQuestionAnswer({ id: q.id, optionId: t && t.id }); } catch (e) {}
          }
          return true;
        })()`);
        const z = await js('window.__r44 && window.__r44.fa');
        if (z && z.done) { wan = z; break; }
        await sleep(2000);
      }
      jian('项4 真跑了一轮（chatSend 真回来，不是卡住）', !!wan && !wan.err, JSON.stringify(wan || {}).slice(0, 200));
      /**
       * 工具真的写出了文件 —— 判据是**"工作区里出现了新文件"**，不是"出现了我指定的那个名字"：
       * 模型有权利按题目自己起名（写死文件名会把产品对判成错，第 38 轮为这条烧过一整遍验收）。
       */
      const xianZai = shaMuLu(profile);
      const xinZeng = xianZai.filter((n) => !chuShiWenJian.includes(n));
      const neiRong = xinZeng.map((n) => { try { const p = path.join(profile, n); return n + ':' + fs.statSync(p).size + 'B'; } catch { return n + ':?'; } });
      const caoZuoWen = await js('(() => [...document.querySelectorAll(".xingDongHang")].map((h) => String(h.innerText || "").replace(/\\s+/g," ").slice(0,80)))()');
      jian('项4 工具真的写出了新文件（不是假装成功；文件名与落点由模型自己定）', xinZeng.length >= 1, '新文件=' + JSON.stringify(xinZeng).slice(0, 200));
      console.log('  · 本轮新写出：' + JSON.stringify(neiRong).slice(0, 260));
      console.log('  · 界面上的操作行：' + JSON.stringify(caoZuoWen).slice(0, 420));

      /* 打开会话视图：挑一条**看得见**的操作行展开，量"带 inset 浮雕的元素"包住了谁 */
      /**
       * ⚠️ 必须先**回到会话**再量：上面测额度窗时我们把界面切到了「设置 → 模型」，
       * 那时聊天区是 `display:none` ⇒ 所有 rect 都是 0×0，"看得见"判据会假红（第 44 轮现场踩过两次）。
       */
      await js('(() => { const n = document.querySelector(\'.ceLanTiaoMu[data-nav="singleAi"]\'); if (n) n.click(); return !!n; })()');
      await sleep(800);
      await js('(() => { const x = document.querySelector("#lieBiaoTi .lieBiaoTiaoMu"); if (x) x.click(); return !!x; })()');
      await sleep(1200);
      const jie = await js(`(() => {
        const keJian = (n) => { if (!n) return false; const r = n.getBoundingClientRect(); return r.height > 4 && r.width > 4; };
        /** 执行过程块可能是折叠的 ⇒ 先把所有 details 打开，再挑一条真有尺寸的记录行 */
        document.querySelectorAll('details.siKaoKuai').forEach((d) => d.setAttribute('open', ''));
        const hang = [...document.querySelectorAll('.xingDongHang')].find((h) => { const z = h.parentElement; const d = z && z.querySelector ? z.querySelector('.xingDongXiang') : null; return keJian(h) && d; });
        if (!hang) return {
          no: '界面上没有**看得见**的操作行与明细（.xingDongHang）',
          /** 取不到就如实把现场打出来，别让我在这儿猜（每条行的高度、父节点、有没有明细、祖先是什么） */
          chang: document.querySelectorAll('.xingDongHang').length,
          xiang: [...document.querySelectorAll('.xingDongHang')].slice(0, 6).map((h) => {
            const z = h.parentElement; const d = z && z.querySelector ? z.querySelector('.xingDongXiang') : null;
            const r = h.getBoundingClientRect();
            return { fu: z ? String(z.className) : '', selfH: Math.round(r.height), selfW: Math.round(r.width), youDet: !!d, detDisplay: d ? getComputedStyle(d).display : '', zuXian: (() => { let p = h.parentElement; const s = []; while (p && s.length < 4) { s.push(String(p.className || p.tagName)); p = p.parentElement; } return s; })() };
          }),
        };
        const det = hang.parentElement.querySelector('.xingDongXiang');
        const kaiShi = { hangH: Math.round(hang.getBoundingClientRect().height), detYin: getComputedStyle(det).display, hangHou: det.getBoundingClientRect().height };
        if (getComputedStyle(det).display === 'none') hang.click();
        const biao = (hang.closest ? hang.closest('details') : null) || document.querySelector('.siKaoKuai') || document.querySelector('.xingDongKuai');
        const b = (n) => { if (!n) return null; const r = n.getBoundingClientRect(); const s = getComputedStyle(n); return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), shadow: String(s.boxShadow || 'none').slice(0, 90), border: String(s.borderColor).slice(0, 30), bg: s.backgroundColor.slice(0, 34), disp: s.display }; };
        const hr = hang.getBoundingClientRect();
        const dr = det.getBoundingClientRect();
        const kuai = b(biao);
        const yao = biao && biao.querySelector ? biao.querySelector('summary') : null;
        /** 从明细往上找：有没有哪个**祖先**自己带 inset 浮雕并且把明细整个框住 */
        const baoZhu = [];
        let p = det.parentElement;
        while (p && p !== document.body) {
          const s = getComputedStyle(p); const sh = String(s.boxShadow || 'none');
          if (sh.indexOf('inset') >= 0 && dr.height > 0) {
            const pr = p.getBoundingClientRect();
            if (dr.top >= pr.top - 1 && dr.bottom <= pr.bottom + 1 && (pr.bottom - pr.top) > (dr.height + 8)) baoZhu.push(String(p.className || p.tagName));
          }
          p = p.parentElement;
        }
        return {
          kaiShi, kai: getComputedStyle(det).display,
          jieGou: hang.contains(det),
          kuai, biaoName: biao ? String(biao.className) : '', yao: b(yao),
          hang: b(hang), det: b(det),
          xiangHan: !!(hr.height > 0 && dr.height > 0 && dr.top >= hr.top - 1 && dr.bottom <= hr.bottom + 1),
          baoZhu,
        };
      })()`);
      jian('项4 界面上真的有**看得见的**操作行与展开明细', !jie.no, JSON.stringify(jie).slice(0, 700));
      jian('项4 点得开（展开后明细可见）', !jie.no && jie.kai !== 'none', JSON.stringify(jie && jie.kai));
      jian('项4 明细在结构上就是行的**兄弟**（不是塞进行里头的子节点）',
        !jie.no && jie.jieGou === false, JSON.stringify(jie && jie.jieGou));
      jian('项4 展开的明细**矩形不在操作行那条浮雕里**（两者互不包含，各自一条）',
        !jie.no && jie.xiangHan === false && jie.det && jie.det.h > 4 && jie.hang && jie.hang.h > 4,
        JSON.stringify(jie && { hang: jie.hang && jie.hang.h, det: jie.det && jie.det.h, xiangHan: jie.xiangHan }));
      jian('项4 明细自己的盒子不再带浮雕（平面 + 左侧归属线）',
        !jie.no && jie.det && String(jie.det.shadow || '') === 'none', JSON.stringify(jie && jie.det && jie.det.shadow));
      /* 第 65 轮 项 16/31：浮雕从「折叠条」挪到**外层容器**，展开的明细也必须在浮雕里 */
      const kuaiYin = !!(jie.kuai && String(jie.kuai.shadow).indexOf('inset') >= 0);
      jian('项4 外层容器（执行过程那一大块）**带浮雕**，把展开内容一起包住',
        !jie.no && kuaiYin, JSON.stringify(jie && jie.kuai));
      jian('项4 **至少有一个带 inset 浮雕的祖先把整条明细框住**（外层容器包含展开内容）',
        !jie.no && Array.isArray(jie.baoZhu) && jie.baoZhu.length >= 1, JSON.stringify(jie && jie.baoZhu));
      jian('项4 明细矩形落在这个浮雕容器的内边界里（不是只包住标题）',
        !jie.no && Array.isArray(jie.baoZhu) && jie.baoZhu.length >= 1 &&
        !!(jie.kuai && jie.det && jie.kuai.top <= jie.det.top && jie.kuai.bottom >= jie.det.bottom),
        JSON.stringify(jie && { kuai: jie.kuai && [jie.kuai.top, jie.kuai.bottom], det: jie.det && [jie.det.top, jie.det.bottom] }));
      jian('项4 折叠条（summary）本身是平的 —— 浮雕在容器上，不重复叠一层',
        !jie.no && jie.yao && String(jie.yao.shadow).indexOf('inset') < 0, JSON.stringify(jie && jie.yao));
    }
  }
} catch (e) {
  jian('整条路跑完没抛错', false, String((e && e.message) || e).slice(0, 240));
} finally {
  try { if (c && c.close) c.close(); } catch { /* noop */ }
  try { await guan(); } catch { /* noop */ }
  try { if (child && child.exitCode === null) child.kill(); } catch { /* noop */ }
  await sleep(2500);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 留着复盘也不影响判定 */ }
}
console.log('\n==== verify-r44-ui：' + ok + ' ok / ' + hong.length + ' FAIL ====');
if (hong.length) console.log(hong.map((x) => '  ✗ ' + x).join('\n'));
process.exit(hong.length ? 1 : 0);
