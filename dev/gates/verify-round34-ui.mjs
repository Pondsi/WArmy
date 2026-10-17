/**
 * verify-round34-ui.mjs —— 第 34 轮 第四列卡片 / 设置页 的界面验收（确定性夹具）
 *
 * 为什么要有这一层（项 12 的教训）：以前"看界面对不对"是人在真机上顺手点两下，
 * 每次点的东西不一样、每次数据不一样 ⇒ 说"过了"其实没测到。
 * 这里把**触发条件本身做成夹具**：授权卡存了 53px 收起高度、分身卡 4 种状态各一条、
 * 计划卡 4 种状态混排、自定义卡片一张 —— 于是"能不能展开/折得起来/排得对"每次都能重放。
 *
 * 用法：node verify-round34-ui.mjs         （默认端口 9571）
 *       R34UI_PORT=9580 node verify-round34-ui.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
const __ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const GEN = __ROOT;
const pkgRoot = path.join(GEN, 'packages', 'app-shell');
const { attach, sleep, bootWait } = await import(pathToFileURL(path.join(pkgRoot, 'scripts', 'cdp-lib.mjs')).href);
const electron = path.join(pkgRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const mainJs = path.join(pkgRoot, 'dist', 'electron-main.js');
const PORT = Number(process.env.R34UI_PORT || 9571);
const SID = 'inst-r34ui-1';
const FU_ZE = '牛马-1';
const profile = path.join(os.tmpdir(), 'warmy-r34-ui-' + Date.now());
fs.mkdirSync(profile, { recursive: true });

/* ── 夹具 ─────────────────────────────────────────────────────────────── */
const now = Date.now();
const shouQuan = [
  { id: 'g1', text: 'AI 请求访问工作区外的文件\n操作：write_file 路径：Desktop/甲.txt （拒绝 = 改用工作区内路径）', ts: now - 5 * 60000 },
  { id: 'g2', text: 'AI 请求访问工作区外的文件\n操作：make_pptx 路径：Desktop/乙.pptx （拒绝 = 改用工作区内路径）', ts: now - 4 * 60000 },
  { id: 'g3', text: 'AI 请求打开工作区外的文件\n路径：Desktop/乙.pptx （拒绝 = 只能开工作区内文件）', ts: now - 3 * 60000 },
];
/**
 * 关键夹具①：授权卡高度 = **53px（收起态高度）**。
 * 真机 bug 就是它把展开后的卡压成一条缝（"无法展开"）；把它写进 settings 就能稳定复现。
 */
/** 关键夹具②：卡片顺序里授权卡**排在中间**（真机 bug 是它每次都回到最顶） */
const yaoShunXu = ['mianBanMoXingMgrKuai', 'mianBanJiHuaKuai', 'mianBanShouQuanKuai', 'mianBanFenShenKuai', 'xiangMuWenJianJiKuai'];
const settings = {
  yuYan: 'zh-CN', setupDone: true, privacyConsent: true, guideDone: true, providersSeeded: true,
  instances: [{ id: SID, ming: FU_ZE, name: FU_ZE, status: 'running', dutyEligible: true, notify: true, model: 'mimo-v2.6-flash', chain: ['mimo-v2.6-flash', 'ollama-demo'], chainDisabled: [] }],
  providers: [
    { id: 'mimo-r34ui', biaoQian: 'MiMo（UI 验收）', protocol: 'openai-compatible', baseURL: 'https://example.invalid/v1', models: ['mimo-v2.6-flash'], hasKey: false },
    { id: 'ollama-r34ui', biaoQian: 'Ollama（UI 验收）', protocol: 'ollama', baseURL: 'http://127.0.0.1:11434', models: ['ollama-demo'], hasKey: false },
  ],
  authGrants: { [SID]: shouQuan },
  panCards: { single: yaoShunXu, internal: yaoShunXu },
  panelCardHeights: { mianBanShouQuanKuai: 53, mianBanJiHuaKuai: 240, mianBanFenShenKuai: 200 },
  customCards: [{ kind: 'single', req: '这一段是需求内容，用来验证自定义卡片能不能折叠', res: '这一段是成果内容' }],
  panelCardCollapsed: {},
};
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify(settings, null, 2));

/** 关键夹具③：分身 4 种状态各一条（顺序故意打乱，看显示排序对不对） */
const xiaoDi = { items: [
  { id: 'xd-run', ming: FU_ZE + '-小弟1号', fuMing: FU_ZE, hao: 1, createdAt: now - 600000, sessionId: SID, task: '正在跑：把小说写完并保存到桌面', model: 'MiMo（UI 验收） · mimo-v2.6-flash', modelId: 'mimo-v2.6-flash', presetId: 'mimo-r34ui', status: 'running' },
  { id: 'xd-done', ming: FU_ZE + '-小弟2号', fuMing: FU_ZE, hao: 2, createdAt: now - 500000, sessionId: SID, task: '已经做完：生成桌面 PPT 并打开', model: 'Ollama（UI 验收） · ollama-demo', modelId: 'ollama-demo', presetId: 'ollama-r34ui', status: 'done', endedAt: now - 400000 },
  { id: 'xd-stop', ming: FU_ZE + '-小弟3号', fuMing: FU_ZE, hao: 3, createdAt: now - 300000, sessionId: SID, task: '被用户停止：读取工作区清单', model: 'MiMo（UI 验收） · mimo-v2.6-flash', modelId: 'mimo-v2.6-flash', presetId: 'mimo-r34ui', status: 'stopped', endedAt: now - 200000 },
  { id: 'xd-fail', ming: FU_ZE + '-小弟4号', fuMing: FU_ZE, hao: 4, createdAt: now - 100000, sessionId: SID, task: '异常停止：写长文时供应商报错', model: 'MiMo（UI 验收） · mimo-v2.6-flash', modelId: 'mimo-v2.6-flash', presetId: 'mimo-r34ui', status: 'failed', endedAt: now - 50000 },
] };
fs.writeFileSync(path.join(profile, 'xiaodi.json'), JSON.stringify(xiaoDi, null, 2));

/** 关键夹具④：计划 4 种状态混排（刚创建的在最前，验证"做完的浮到上面"） */
const plans = { version: 1, savedAt: now, plans: { [SID]: [
  { id: 'T1', title: '第一个创建的：已经完成', status: 'verified', ts: now - 900000 },
  { id: 'T2', title: '第二个创建的：正卡在人工确认', status: 'blocked', ts: now - 800000 },
  { id: 'T3', title: '第三个创建的：正在做', status: 'doing', ts: now - 700000 },
  { id: 'T4', title: '第四个创建的：还没开始', status: 'pending', ts: now - 600000 },
  { id: 'T5', title: '第五个创建的：也完成了', status: 'done', ts: now - 500000 },
] } };
fs.writeFileSync(path.join(profile, 'plans.json'), JSON.stringify(plans, null, 2));

/** 关键夹具⑤：工作区里有两个产物文件（文件产物卡 + 监听目标） */
const gongZuoQu = path.join(profile, 'workspace', SID);
fs.mkdirSync(gongZuoQu, { recursive: true });
fs.writeFileSync(path.join(gongZuoQu, '在线变化.txt'), '第一版内容\n');
fs.writeFileSync(path.join(gongZuoQu, '会消失.txt'), '马上就要被删掉\n');

/* ── 启动被测应用 ─────────────────────────────────────────────────────── */
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['--remote-debugging-port=' + PORT, '--disable-features=CalculateNativeWinOcclusion', '--user-data-dir=' + profile, mainJs],
  { cwd: pkgRoot, stdio: ['ignore', 'ignore', 'ignore'], windowsHide: false, env });
fs.writeFileSync(path.join(os.tmpdir(), 'r34-ui.pid'), String(child.pid) + '\n' + profile + '\n');
console.log('PID', child.pid, 'profile', profile);

let c = null;
const jie = [];
const panding = (ming, zhen, xiang) => { jie.push({ ming, ok: !!zhen, xiang: xiang === undefined ? '' : String(xiang).slice(0, 300) }); };

async function dengCdp() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const j = await r.json();
      if (j.some((x) => x.type === 'page' && /index\.html/.test(x.url))) return true;
    } catch { /* 还没起来 */ }
    await sleep(500);
  }
  return false;
}

async function dianJi(selector) {
  const p = await c.evaluate(`(function(){ const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({block:'center'}); const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  if (!p) return false;
  await c.mouseClick(p.x, p.y);
  return true;
}

/**
 * 取"真的点得到"的坐标：第四列是能滚的长条，元素在视口外时 `elementFromPoint` 命中的是 <html>，
 * 点下去什么都没发生 —— 第一版验收脚本就是这么把好的功能误判成"点标题不能收起"的。
 * 所以每次点之前先滚进视口，并**回读命中元素**确认这一刀砍在了目标上。
 */
async function zuBiao(selector, pianYi) {
  /**
   * 滚动是**平滑动画**（面板 CSS 里有 scroll-behavior），同步/短等量到的都是动画中间帧的坐标 ⇒ 点了个空。
   * 这里等到矩形连续两次不动、并且 `elementFromPoint` 确实命中目标为止（最多 4 秒）。
   */
  let p = { err: 'no-measure' };
  for (let i = 0; i < 16; i++) {
    if (i === 0) await c.evaluate(`(function(){ const e = document.querySelector(${JSON.stringify(selector)}); if (e) e.scrollIntoView({ block: 'center' }); return true; })()`);
    await sleep(260);
    p = JSON.parse(await c.evaluate(`(function(){
      try {
        const e = document.querySelector(${JSON.stringify(selector)});
        if (!e) return JSON.stringify({ err: 'no-el' });
        const r = e.getBoundingClientRect();
        const x = Math.round(r.left + (r.width / 2) + (${Number(pianYi) || 0}));
        const y = Math.round(r.top + r.height / 2);
        const hit = document.elementFromPoint(x, y);
        return JSON.stringify({ x: x, y: y, t: Math.round(r.top), zhong: hit ? (hit.tagName + '.' + String(hit.className || '')).slice(0, 60) : 'none', dao: hit ? !!(hit === e || e.contains(hit) || hit.contains(e)) : false });
      } catch (err) { return JSON.stringify({ err: String(err).slice(0, 120) }); }
    })()`));
    if (p.dao) break;
  }
  return p;
}
async function dianJi2(sel, pianYi) {
  const p = await zuBiao(sel, pianYi);
  if (p.err || !p.dao) return p;
  await c.mouseClick(p.x, p.y);
  return p;
}

/** 真的右键（CDP 输入事件，不是合成事件） */
async function youJian(selector) {
  const p = await c.evaluate(`(function(){ const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({block:'center'}); const r = e.getBoundingClientRect(); return { x: Math.round(r.left + Math.min(60, r.width / 2)), y: Math.round(r.top + r.height / 2) }; })()`);
  if (!p) return false;
  await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'right', clickCount: 1, contextmenu: true });
  await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'right', clickCount: 1, contextmenu: true });
  return true;
}

const kaZhuang = `(function(id){
  const ka = document.getElementById(id);
  if (!ka) return 'no-card';
  const r = ka.getBoundingClientRect();
  const biaoTi = ka.querySelector(':scope > [data-ka-title], :scope > .mianBanKaiGuan, :scope > .mianBanBiaoTi, :scope > h3, :scope > summary');
  const jianTou = biaoTi && biaoTi.querySelector('.jianTou');
  const keJian = Array.from(ka.children).filter(function(x){ return !x.classList.contains('kaGuanBi') && !x.classList.contains('kaTuoBa') && getComputedStyle(x).display !== 'none'; });
  return JSON.stringify({ cls: String(ka.className), h: Math.round(r.height), top: Math.round(r.top),
    inline: ka.getAttribute('style') || '', biaoTi: biaoTi ? biaoTi.className : '-', jianTou: jianTou ? jianTou.textContent : '-',
    keJian: keJian.length, display: getComputedStyle(ka).display, yinCang: ka.classList.contains('yinCang') });
})`;

try {
  if (!(await dengCdp())) { panding('CDP 起来了', false, '端口没开'); throw new Error('no cdp'); }
  c = await attach(PORT, { biaoQian: 'r34-ui', callTimeout: 30000 });
  await c.send('Runtime.enable');
  try { await bootWait(c, '', 40000); } catch (e) { panding('界面启动完成', false, e.message.slice(0, 120)); }
  await sleep(2500);

  /* 进入会话 */
  await dianJi('[data-nav="singleAi"]');
  await sleep(1500);
  await dianJi('#lieBiaoTi .lieBiaoTiaoMu');
  await sleep(2600);
  const selected = await c.evaluate('(function(){ return (window.__panelDebug && window.__panelDebug().selected) ? JSON.stringify(window.__panelDebug().selected) : "none"; })()');
  panding('进入会话（第四列按会话分区）', /"id"/.test(String(selected)), selected);

  /* ── 项 6：授权卡位置 / 默认可见 / 有内容 / 能展开 ─────────────── */
  const shunXu = await c.evaluate('(window.__panCardOrder ? window.__panCardOrder() : []).join(",")');
  /** `__panCardOrder()` 是 DOM 里的**全部**卡（含隐藏的），落盘顺序只覆盖前 5 张 */
  panding('项6 卡片顺序用落盘那份（授权卡不在最顶）', String(shunXu).startsWith(yaoShunXu.join(',')) && String(shunXu).split(',')[2] === 'mianBanShouQuanKuai', shunXu);
  const authKai = await c.evaluate(kaZhuang + "('mianBanShouQuanKuai')");
  const auth = JSON.parse(authKai === 'no-card' ? '{}' : authKai);
  panding('项6 授权卡一进会话就可见（不用等广播）', auth.display !== 'none' && !auth.yinCang, authKai);
  const authHang = await c.evaluate("(function(){ const ul = document.getElementById('shouQuanLieBiao'); if (!ul) return -1; ul.classList.remove('yinCang'); return ul.querySelectorAll('li').length; })()");
  panding('项6 授权卡里有 3 条真实授权', Number(authHang) === 3, 'li=' + authHang);
  /** 关键断言：进会话就该**展开着看到内容**（真机 bug：卡是收着的 / 列表被压成 0，用户以为没授权） */
  const chuShi = JSON.parse(await c.evaluate("(function(){ const ka = document.getElementById('mianBanShouQuanKuai'); const ul = document.getElementById('shouQuanLieBiao'); return JSON.stringify({ cls: String(ka.className), ulCls: String(ul.className), ulH: Math.round(ul.getBoundingClientRect().height), li: ul.querySelectorAll('li').length, inline: ka.getAttribute('style') || '' }); })()"));
  panding('项6 带着"收起态 53px"的历史高度，授权卡仍然展开、3 条授权看得见',
    !/shouQi/.test(chuShi.cls) && !/yinCang/.test(chuShi.ulCls) && chuShi.ulH > 40 && chuShi.li === 3, JSON.stringify(chuShi));
  panding('项6 收起态的 inline 高度不会再夹住展开（53px 被放开/不认）', !/height: 53px/.test(chuShi.inline), chuShi.inline);
  const BIAO_TI = '#shouQuanKaiGuan > span';
  const d1 = await dianJi2(BIAO_TI);
  await sleep(700);
  const shouQi = JSON.parse(await c.evaluate(kaZhuang + "('mianBanShouQuanKuai')"));
  panding('项10 点标题能收起（只剩标题行：可见子元素 ≤ 2、高度很小）',
    d1.dao === true && /shouQi/.test(shouQi.cls) && shouQi.h < 90 && shouQi.keJian <= 2, JSON.stringify(shouQi) + ' 命中=' + d1.zhong);
  const dpan = JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8'));
  panding('项10 收起状态写进设置（重启后还是收起）', dpan.panelCardCollapsed && dpan.panelCardCollapsed.mianBanShouQuanKuai === 1, JSON.stringify(dpan.panelCardCollapsed || {}));
  const d2 = await dianJi2(BIAO_TI);
  await sleep(700);
  const zhanKai = JSON.parse(await c.evaluate("(function(){ const ka = document.getElementById('mianBanShouQuanKuai'); const ul = document.getElementById('shouQuanLieBiao'); return JSON.stringify({ cls: String(ka.className), ulCls: String(ul.className), ulH: Math.round(ul.getBoundingClientRect().height), keJian: ul.querySelectorAll('li').length }); })()"));
  panding('项10 再点标题能展开回来（列表重新可见、有高度）',
    !/shouQi/.test(zhanKai.cls) && !/yinCang/.test(zhanKai.ulCls) && zhanKai.ulH > 40 && zhanKai.keJian === 3, JSON.stringify(zhanKai) + ' 第二击命中=' + d2.zhong + ' dao=' + d2.dao);

  /* ── 项 10：自定义卡片 / 分身卡（.mianBanBiaoTi 那种）也能折叠 ──── */
  const ZI_DING = '#panZiDingYiJi .mianBanKuai[data-custom-card] > h3';
  const cunZai = await c.evaluate(`(function(){ return !!document.querySelector(${JSON.stringify(ZI_DING)}); })()`);
  panding('项10 自定义卡片渲染出来了', cunZai === true, cunZai);
  const ziQian = JSON.parse(await c.evaluate("(function(){ const ka = document.querySelector('#panZiDingYiJi .mianBanKuai[data-custom-card]'); return JSON.stringify({ h: Math.round(ka.getBoundingClientRect().height) }); })()"));
  await dianJi2(ZI_DING); await sleep(700);
  const ziHou = JSON.parse(await c.evaluate("(function(){ const ka = document.querySelector('#panZiDingYiJi .mianBanKuai[data-custom-card]'); return JSON.stringify({ cls: String(ka.className), h: Math.round(ka.getBoundingClientRect().height) }); })()"));
  panding('项10 自定义卡片点标题能收起', /shouQi/.test(ziHou.cls) && ziHou.h < Math.max(48, ziQian.h * 0.4), JSON.stringify(ziHou) + ' 原高 ' + ziQian.h);
  await dianJi2(ZI_DING); await sleep(500);
  const FEN_BIAO = '#mianBanFenShenKuai > .mianBanBiaoTi';
  const fb = await dianJi2(FEN_BIAO);
  await sleep(700);
  const fb1 = JSON.parse(await c.evaluate(kaZhuang + "('mianBanFenShenKuai')"));
  panding('项10 分身卡（标题是 .mianBanBiaoTi）点一下能收起', fb.dao === true && /shouQi/.test(fb1.cls) && fb1.h < 90, JSON.stringify(fb1) + ' 命中=' + fb.zhong);
  await dianJi2(FEN_BIAO); await sleep(700);
  const fb2 = JSON.parse(await c.evaluate(kaZhuang + "('mianBanFenShenKuai')"));
  panding('项10 分身卡能再展开', !/shouQi/.test(fb2.cls), JSON.stringify(fb2));

  /* ── 项 9：分身行（单行 / 状态 / 竖线 / 删除线 / 计数） ─────────── */
  const hang = JSON.parse(await c.evaluate(`(function(){
    const hs = Array.from(document.querySelectorAll('#fenShenLieBiao [data-fs-id]'));
    return JSON.stringify(hs.map(function(h){
      const zt = h.querySelector('.fenShenZt'); const shi = h.querySelector('.fenShenShiJian'); const wen = h.querySelector('.fenShenWen');
      const cs = getComputedStyle(h);
      return { id: h.getAttribute('data-fs-id'), status: h.getAttribute('data-fs-status'), cls: String(h.className),
        zt: zt ? zt.textContent : '', shi: shi ? shi.textContent : '', wen: wen ? wen.textContent : '',
        bar: cs.borderLeftColor, line: (cs.textDecorationLine || '') + '|' + (zt ? getComputedStyle(zt).textDecorationLine : ''),
        h: Math.round(h.getBoundingClientRect().height) };
    }));
  })()`));
  const accent = await c.evaluate("(function(){ return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(); })()");
  panding('项9 四条分身都在，每行只占一行', hang.length === 4 && hang.every((x) => x.h > 0 && x.h < 44), JSON.stringify(hang.map((x) => x.h)));
  panding('项9 每行显示 时分 + 任务(截断) + 状态文字', hang.every((x) => /^\d{2}:\d{2}$/.test(x.shi) && ['进行中', '已完成', '已停止'].includes(x.zt) && x.wen.length > 0 && x.wen.length <= 47),
    JSON.stringify(hang.map((x) => x.shi + '/' + x.zt + '/' + x.wen.length)));
  panding('项11 显示顺序 = 已完成 → 已停止/失败 → 进行中', JSON.stringify(hang.map((x) => x.id)) === JSON.stringify(['xd-done', 'xd-fail', 'xd-stop', 'xd-run']),
    JSON.stringify(hang.map((x) => x.id)));
  panding('项9 进行中有强调色竖线', hang.filter((x) => x.status === 'running').every((x) => /isRun/.test(x.cls) && x.bar && x.bar !== 'rgba(0, 0, 0, 0)'), JSON.stringify(hang.filter((x) => x.status === 'running').map((x) => x.bar)) + ' accent=' + accent);
  panding('项9 已完成的没有竖线、也没有删除线', hang.filter((x) => x.status === 'done').every((x) => !/isRun|isStop/.test(x.cls) && !/line-through/.test(x.line)), JSON.stringify(hang.filter((x) => x.status === 'done').map((x) => x)));
  panding('项9 已停止/失败的没有竖线，但整行有删除线', hang.filter((x) => x.status === 'stopped' || x.status === 'failed').every((x) => /isStop/.test(x.cls) && /line-through/.test(x.line)), JSON.stringify(hang.filter((x) => x.status !== 'running' && x.status !== 'done').map((x) => x.line)));
  const jiShu = await c.evaluate("(function(){ const j = document.getElementById('fenShenJiShu'); return j ? j.textContent : ''; })()");
  panding('项9 标题旁 x:X:X = 运行:失败:已完成', jiShu === '1:1:1', jiShu);

  /* 点开详情 */
  const firstSel = '#fenShenLieBiao [data-fs-id="xd-run"]';
  const di = await dianJi2(firstSel, -60);
  await sleep(700);
  const xiang = await c.evaluate("(function(){ const x = document.querySelector('#fenShenLieBiao .fenShenXiang'); return x ? x.textContent.replace(/\\s+/g,' ') : 'none'; })()");
  panding('项9 点行展开详情：年月日时分秒 + 全文任务 + 派发者牛马名 + 小弟X号 + 模型全称（含供应商）',
    /\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2}/.test(String(xiang)) && /把小说写完并保存到桌面/.test(String(xiang)) && String(xiang).includes(FU_ZE) && /小弟1号/.test(String(xiang)) && /MiMo（UI 验收） · mimo-v2\.6-flash/.test(String(xiang)) && !/inst-/.test(String(xiang)), xiang + ' 命中=' + di.zhong);
  const ti = await c.evaluate(`(function(){ const e = document.querySelector(${JSON.stringify(firstSel)}); return e.getAttribute('title') || ''; })()`);
  panding('项9 悬停气泡五项齐全', /创建时间：/.test(String(ti)) && /任务内容：/.test(String(ti)) && /派发者：/.test(String(ti)) && /执行者：小弟1号/.test(String(ti)) && /模型：MiMo/.test(String(ti)), ti);
  await c.mouseClick(di.x, di.y); await sleep(500);

  /* 右键菜单：停止 / 重试 的可用性 */
  async function caiDan(sel) {
    await c.evaluate("(function(){ document.querySelectorAll('.fenShenHang.xuanZhong').forEach(function(n){ n.classList.remove('xuanZhong'); }); const d = Array.from(document.body.children).filter(function(x){ return x.style && x.style.position === 'fixed'; }); d.forEach(function(x){ x.remove(); }); })()");
    const okClick = await youJian(sel);
    if (!okClick) return null;
    await sleep(500);
    return JSON.parse(await c.evaluate(`(function(){
      const m = Array.from(document.body.children).filter(function(x){ return x.style && x.style.position === 'fixed' && x.querySelector('button'); }).pop();
      if (!m) return JSON.stringify({ menu: false });
      const bs = Array.from(m.querySelectorAll('button')).map(function(b){ return { t: b.textContent.trim(), off: !!b.disabled }; });
      const xuan = document.querySelector('.fenShenHang.xuanZhong');
      const outline = xuan ? getComputedStyle(xuan).outlineWidth : '';
      return JSON.stringify({ menu: true, items: bs, xuan: !!xuan, outline: outline });
    })()`));
  }
  const cdRun = await caiDan(firstSel);
  panding('项9 正在跑的：右键有「停止」「重试」，停止可点、重试灰掉，选中行有强调外框',
    cdRun && cdRun.menu && cdRun.items.length === 2 && cdRun.items[0].t === '停止' && !cdRun.items[0].off && cdRun.items[1].t === '重试' && cdRun.items[1].off && cdRun.xuan && cdRun.outline !== '0px',
    JSON.stringify(cdRun));
  const cdStop = await caiDan('#fenShenLieBiao [data-fs-id="xd-stop"]');
  panding('项9 已停止的：「停止」灰掉、「重试」可点', cdStop && cdStop.items && cdStop.items[0].off === true && cdStop.items[1].off === false, JSON.stringify(cdStop));
  /** 真的点「重试」：主进程要能把这条重跑（这里只验 IPC 通、状态回到进行中） */
  const tongDao = await c.evaluate("(function(){ return typeof window.warmy.xiaoDiChongShi === 'function' && typeof window.warmy.onWenJianBianGeng === 'function'; })()");
  panding('项9/7 preload 暴露 xiaoDiChongShi 与 onWenJianBianGeng', tongDao === true, tongDao);
  const chong = JSON.parse(await c.evaluate(`(async () => { try { const r = await window.warmy.xiaoDiChongShi({ id: 'xd-fail' }); return JSON.stringify(r); } catch (e) { return JSON.stringify({ error: String(e).slice(0,80) }); } })()`));
  panding('项9 「重试」IPC 认账（无 key 时也要如实给出可诊断的结果，不崩）',
    chong && (chong.ok === true || ['provider-not-found', 'no-api-key', 'no-provider'].includes(String(chong.error))), JSON.stringify(chong));
  await c.evaluate("(function(){ document.querySelectorAll('.fenShenHang.xuanZhong').forEach(function(n){ n.classList.remove('xuanZhong'); }); Array.from(document.body.children).filter(function(x){ return x.style && x.style.position === 'fixed'; }).forEach(function(x){ x.remove(); }); })()");

  /* ── 项 11：计划卡显示顺序（编号是"软展示"，可能显示 一/二/W1/—，所以按**状态序列**判） ── */
  const jiHuaDu = "(function(){ return JSON.stringify(Array.from(document.querySelectorAll('#jiHuaLieBiao .jiHuaHang2')).map(function(h){ return { hao: h.getAttribute('data-jh'), zt: ((h.querySelector('.jiHuaZhuangTai')||{}).textContent||'') }; })); })()";
  const rows = JSON.parse(await c.evaluate(jiHuaDu));
  const ztXian = rows.map((r) => r.zt).join(',');
  panding('项11 计划显示顺序 = 已完成 → 已停止 → 进行中 → 刚创建', ztXian === '已完成,已完成,已暂停,进行中,已创建', ztXian);
  /** 编号不能因为我重排**显示**而漂移：连续重画两次，号序列必须一模一样 */
  await c.evaluate('window.__renderJiHuaKa && window.__renderJiHuaKa()');
  await sleep(600);
  const rows2 = JSON.parse(await c.evaluate(jiHuaDu));
  panding('项11 重画两次编号序列不变（只是显示排序，号不重排）', JSON.stringify(rows.map((r) => r.hao)) === JSON.stringify(rows2.map((r) => r.hao)),
    JSON.stringify(rows.map((r) => r.hao)) + ' || ' + JSON.stringify(rows2.map((r) => r.hao)));

  /* ── 项 7：没有刷新按钮 + 文件变化会自动重画 ─────────────────── */
  const noShua = await c.evaluate("(function(){ return !document.getElementById('anNiuShuaXinChanPin') && !document.getElementById('xiangMuWenJianJiHe').innerHTML.includes('anNiuShuaXinChanPin'); })()");
  panding('项7 「↻ 刷新」按钮不在界面上', noShua === true, noShua);
  const bian0 = await c.evaluate("(function(){ return (window.__panelDebug && window.__panelDebug().wenJianBianCi) || 0; })()");
  /** 从外面改文件（模拟用户在资源管理器里动手）⇒ 宿主监听应当广播变化 */
  fs.writeFileSync(path.join(gongZuoQu, '在线变化.txt'), '第二版内容（外部改的）\n');
  await sleep(2200);
  fs.unlinkSync(path.join(gongZuoQu, '会消失.txt'));
  await sleep(2200);
  const bian1 = await c.evaluate("(function(){ return (window.__panelDebug && window.__panelDebug().wenJianBianCi) || 0; })()");
  panding('项7 文件被外部改动/删除时，宿主监听并广播（无需手动刷新）', Number(bian1) > Number(bian0), 'before=' + bian0 + ' after=' + bian1);

  /* ── 项 2 / 项 1：设置页 调用链对齐 + 预设供应商下拉 ───────────── */
  await dianJi('[data-nav="settings"]');
  await sleep(1600);
  /** 设置里"模型"这一栏的入口名字各版都改过 ⇒ 扫全部按钮按文字找，别赌某个 id */
  const daoHang = await c.evaluate(`(function(){
    const zhao = (wen) => Array.from(document.querySelectorAll('button, .ceLanAnNiu, .sheZhiYeQian *, [role=tab]'))
      .find(function(x){ return x.childElementCount === 0 && new RegExp(wen).test(String(x.textContent || '').trim()); });
    const m = zhao('^(模型|模型設定|Model)$');
    if (m) m.click();
    return m ? 'clicked' : 'not-found';
  })()`);
  await sleep(1600);
  const lian = JSON.parse(await c.evaluate(`(function(){
    const hs = Array.from(document.querySelectorAll('.shiLiHang.lianHang'));
    return JSON.stringify(hs.slice(0, 6).map(function(h){
      const ming = h.querySelector('.lianMing'); const btn = h.querySelector('button');
      if (!ming || !btn) return { skip: true };
      const rm = ming.getBoundingClientRect(), rb = btn.getBoundingClientRect(), rh = h.getBoundingClientRect();
      return { wrap: getComputedStyle(h).flexWrap, sameLine: Math.abs((rm.top + rm.height / 2) - (rb.top + rb.height / 2)) < 6,
        nameTop: Math.round(rm.top), btnTop: Math.round(rb.top), rowH: Math.round(rh.height), btnH: Math.round(rb.height), nameH: Math.round(rm.height) };
    }));
  })()`));
  const keCe = lian.filter((x) => !x.skip);
  panding('项2 调用链：模型名称与后面的按钮在同一行、同一中线', keCe.length > 0 && keCe.every((x) => x.sameLine && x.wrap === 'nowrap'), JSON.stringify(keCe));

  const xiaLa = await c.evaluate("(function(){ const b = document.getElementById('provPreset'); if (!b) return 'no-btn'; b.click(); return 'clicked'; })()");
  await sleep(800);
  const xuanXiang = await c.evaluate("(function(){ const p = document.querySelector('.provXiaLaPan'); if (!p) return ''; return Array.from(p.querySelectorAll('[data-pid]')).map(function(x){ return x.textContent.trim(); }).join('|'); })()");
  panding('项1 预设供应商下拉里没有「本地语音识别（本机服务）」', String(xuanXiang).length > 0 && !/本机服务|本地语音识别/.test(String(xuanXiang)), xiaLa + ' → ' + String(xuanXiang).slice(0, 200));
  await c.evaluate("(function(){ const p = document.querySelector('.provXiaLaPan'); if (p) p.remove(); })()");

  /* 项 5：同类文件图标一致（真的调渲染层的分类函数判，不是 grep 字符串） */
  const tuBiao = JSON.parse(await c.evaluate(`(function(){
    const lei = window.__wenJianIcoLei;
    if (typeof lei !== 'function') return JSON.stringify({ err: 'no-fn' });
    const d = (p) => lei(p);
    return JSON.stringify({
      lei: 'ok',
      ppt: [d('a.ppt'), d('a.pptx'), d('a.pptm'), d('a.odp'), d('a.key')],
      biao: [d('a.xls'), d('a.xlsx'), d('a.csv'), d('a.ods'), d('a.numbers')],
      wen: [d('a.txt'), d('a.md'), d('a.docx'), d('a.rtf'), d('a.epub')],
      doc: [d('a.doc'), d('a.docx'), d('a.odt'), d('a.wps')],
      tu: [d('a.jpg'), d('a.jpeg'), d('a.png'), d('a.webp'), d('a.svg')],
      ya: [d('a.zip'), d('a.7z'), d('a.rar'), d('a.tar.gz')],
      dai: [d('a.ts'), d('a.py'), d('a.json'), d('a.html')],
    });
  })()`));
  const tongLei = (arr) => Array.isArray(arr) && arr.every((x) => x === arr[0]);
  panding('项5 PPT 同族全用一个图标（ppt/pptx/pptm/odp/key）', tongLei(tuBiao.ppt) && tuBiao.ppt[0] === 'ppt', JSON.stringify(tuBiao.ppt));
  panding('项5 表格同族（xls/xlsx/csv/ods/numbers）', tongLei(tuBiao.biao) && tuBiao.biao[0] === 'biaoGe', JSON.stringify(tuBiao.biao));
  panding('项5 文本/文档同族（txt/md/rtf/epub 归文本，doc/docx/odt/wps 归文档）',
    tongLei(tuBiao.wen) && tuBiao.wen[0] === 'wenBen' && tongLei(tuBiao.doc) && tuBiao.doc[0] === 'wenBen', JSON.stringify({ wen: tuBiao.wen, doc: tuBiao.doc }));
  panding('项5 图片/压缩包/代码同族', tongLei(tuBiao.tu) && tongLei(tuBiao.ya) && tongLei(tuBiao.dai)
    && tuBiao.tu[0] === 'tuPian' && tuBiao.ya[0] === 'yaSuo' && tuBiao.dai[0] === 'daiMa',
    JSON.stringify({ tu: tuBiao.tu, ya: tuBiao.ya, dai: tuBiao.dai }));
  panding('项5 未知扩展名不会瞎猜成某个已知类（kongBai）', await c.evaluate("(function(){ return window.__wenJianIcoLei('a.zzzunknown') === 'kongBai'; })()") === true);

  /* 项 4：功能页分区顺序（信任文件夹独立成块，排在本地语音之后） */
  const geJu = await c.evaluate(`(function(){
    const yin = document.getElementById('yinPinSheBeiKa'), yu = document.getElementById('benDiYuYinKa'), xin = document.getElementById('xinRenWenJianJiaKa');
    if (!yin || !yu || !xin) return JSON.stringify({ yin: !!yin, yu: !!yu, xin: !!xin });
    const wen = (e) => (e.compareDocumentPosition(yu) & Node.DOCUMENT_POSITION_FOLLOWING) ? 1 : 0;
    return JSON.stringify({ yin: true, yu: true, xin: true,
      yinZaiYuQian: yin.compareDocumentPosition(yu) & Node.DOCUMENT_POSITION_FOLLOWING ? true : false,
      yuZaiXinQian: yu.compareDocumentPosition(xin) & Node.DOCUMENT_POSITION_FOLLOWING ? true : false,
      xinBuZaiYinLi: !xin.closest('#yinPinSheBeiKa'),
      xinShiDuliBlock: xin.classList.contains('sheZhiSection') && xin.classList.contains('sheZhiKa') });
  })()`);
  const gb = JSON.parse(geJu);
  panding('项4 音频设备 → 本地语音与文字互转 → 信任文件夹（三个独立块，顺序正确）',
    gb.yin && gb.yu && gb.xin && gb.yinZaiYuQian && gb.yuZaiXinQian && gb.xinBuZaiYinLi && gb.xinShiDuliBlock, geJu);

  await c.snap?.(path.join(os.tmpdir(), 'r34-ui.png'));
} catch (e) {
  panding('脚本自身跑完（没有抛错）', false, String((e && e.message) || e).slice(0, 200));
} finally {
  const shi = jie.filter((x) => !x.ok);
  for (const x of jie) console.log((x.ok ? '  ok   ' : '  FAIL ') + x.ming + (x.xiang ? '  ← ' + x.xiang : ''));
  console.log(`\n==== verify-round34-ui：${jie.length - shi.length} ok / ${shi.length} FAIL ====`);
  console.log('profile 保留以便复盘：' + profile);
  try { if (c) await c.close(); } catch { /* noop */ }
  try { child.kill(); } catch { /* noop */ }
  process.exit(shi.length ? 1 : 0);
}
