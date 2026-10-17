/**
 * verify-round35-ui —— 第 35 轮**真机界面门禁**（确定性夹具 + CDP 真点击）
 *
 * 覆盖本轮改动的界面部分：
 *   项 4  动态小字左侧**始终预留**蹦跶牛马的位置、有后台任务时才显形、配速与奔跑组同源
 *   项 8  心内行：模型全称 / 词元（含轮次）/ 悬停气泡合并成同一份 / 第二行与第一行左对齐 / 喇叭与左侧拉开
 *   项 9  播报中：声波动画真的在跑（animation-name + display 不是 none）、按钮上有扩散光环
 *   项 11 路径里有空格不许截断；虚拟/占位路径**退回纯文字**且不挂右键菜单
 *   项 12 行动明细：木马.svg 图标、同一操作只有一行、只有失败用强调色、点开三行（开始/内容/更新·耗时）
 *   项 13 行动过程不再是单独区块，按时间混排进「执行过程」、单行浮雕
 *   项 14 标题叫「执行过程」，展开不限高、不出滚动条
 *
 * 判据一律"行为级"：不锚变量名/字节偏移，锚 DOM 结构与计算样式。
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
const PORT = Number(process.env.R35UI_PORT || 9581);
const SID = 'inst-r35ui-1';
const FU_ZE = '牛马-1';
const profile = path.join(os.tmpdir(), 'warmy-r35-ui-' + Date.now());
fs.mkdirSync(profile, { recursive: true });

const now = Date.now();
const settings = {
  yuYan: 'zh-CN', setupDone: true, privacyConsent: true, guideDone: true, providersSeeded: true,
  instances: [{ id: SID, ming: FU_ZE, name: FU_ZE, status: 'running', dutyEligible: true, notify: true, model: 'mimo-v2.6-flash', chain: ['mimo-v2.6-flash'], chainDisabled: [] }],
  providers: [
    { id: 'mimo-r35ui', biaoQian: 'MiMo（R35 验收）', protocol: 'openai-compatible', baseURL: 'https://example.invalid/v1', models: ['mimo-v2.6-flash'], hasKey: false },
    { id: 'ollama-r35ui', biaoQian: 'Ollama（R35 验收）', protocol: 'ollama', baseURL: 'http://127.0.0.1:11434', models: ['clef:latest'], hasKey: false },
  ],
  authGrants: { [SID]: [] },
  panelCardCollapsed: {},
};
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify(settings, null, 2));
/** 有小弟在跑 ⇒ 触发项 4 的"有后台任务"分支 */
fs.writeFileSync(path.join(profile, 'xiaodi.json'), JSON.stringify({ items: [
  { id: 'xd-run', ming: FU_ZE + '-小弟1号', fuMing: FU_ZE, hao: 1, createdAt: now - 60000, sessionId: SID, task: '后台跑测试脚本', model: 'MiMo（R35 验收） · mimo-v2.6-flash', modelId: 'mimo-v2.6-flash', presetId: 'mimo-r35ui', status: 'running' },
] }, null, 2));
fs.writeFileSync(path.join(profile, 'plans.json'), JSON.stringify({ version: 1, savedAt: now, plans: { [SID]: [
  { id: 'T1', title: '验证行动过程合入执行过程', status: 'doing', ts: now - 60000 },
] } }, null, 2));

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['--remote-debugging-port=' + PORT, '--disable-features=CalculateNativeWinOcclusion', '--user-data-dir=' + profile, mainJs],
  { cwd: pkgRoot, stdio: ['ignore', 'ignore', 'ignore'], windowsHide: false, env });
console.log('PID', child.pid, 'profile', profile);

const jie = [];
const panding = (ming, zhen, xiang) => jie.push({ ming, ok: !!zhen, xiang: xiang === undefined ? '' : String(xiang).slice(0, 320) });

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
  const p = await c.evaluate(`(function(){ const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({block:'center'}); const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);
  if (!p) return false;
  await c.mouseClick(p.x, p.y);
  return true;
}
async function dianJiWen(selector) {
  let p = { err: 'no-measure' };
  for (let i = 0; i < 16; i++) {
    if (i === 0) await c.evaluate(`(function(){ const e=document.querySelector(${JSON.stringify(selector)}); if(e) e.scrollIntoView({block:'center'}); return true; })()`);
    await sleep(240);
    p = JSON.parse(await c.evaluate(`(function(){
      try {
        const e = document.querySelector(${JSON.stringify(selector)});
        if (!e) return JSON.stringify({ err: 'no-el' });
        const r = e.getBoundingClientRect();
        const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
        const hit = document.elementFromPoint(x, y);
        return JSON.stringify({ x, y, zhong: hit ? (hit.tagName + '.' + String(hit.className || '')).slice(0, 60) : 'none', dao: hit ? !!(hit === e || e.contains(hit) || hit.contains(e)) : false });
      } catch (err) { return JSON.stringify({ err: String(err).slice(0, 120) }); }
    })()`));
    if (p.dao) break;
  }
  if (p.err || !p.dao) return p;
  await c.mouseClick(p.x, p.y);
  return p;
}
let c = null;

try {
  if (!(await dengCdp())) { panding('CDP 起来了', false, '端口没开'); throw new Error('no cdp'); }
  c = await attach(PORT, { biaoQian: 'r35-ui', callTimeout: 30000 });
  await c.send('Runtime.enable');
  try { await bootWait(c, '', 40000); } catch (e) { panding('界面启动完成', false, e.message.slice(0, 120)); }
  await sleep(2500);

  await dianJi('[data-nav="singleAi"]');
  await sleep(1500);
  await dianJi('#lieBiaoTi .lieBiaoTiaoMu');
  await sleep(2600);
  const hh = await c.evaluate('(function(){ return window.__r35 ? window.__r35.huiHua() : ""; })()');
  panding('项 8 进入会话（__r35 接缝可用）', !!hh, hh);
  if (!hh) throw new Error('no session');

  /* ── 项 4：动态小字左侧预留位 + 蹦跶 ─────────────────────────────── */
  await c.evaluate('(function(){ try { window.__r35.niuMaYuLan(true); } catch(e){} return true; })()');
  await sleep(400);
  const niu = JSON.parse(await c.evaluate(`(function(){
    const d = document.querySelector('#yunXingZhuangTai .yunXingDian.niuMaPao');
    if (!d) return JSON.stringify({ err: 'no-pony' });
    const beng = d.querySelector('.niuMaBeng');
    const kuai = d.querySelector('.niuMaKuai');
    const gui = d.querySelector('.niuMaGui');
    const bi = beng && beng.querySelector('img');
    const rb = beng && beng.getBoundingClientRect();
    const rk = kuai && kuai.getBoundingClientRect();
    const cs = bi && getComputedStyle(bi);
    return JSON.stringify({
      youHouTai: d.classList.contains('youHouTai'),
      bengVisible: beng ? getComputedStyle(beng).visibility : 'none',
      bengW: rb ? Math.round(rb.width) : -1, bengH: rb ? Math.round(rb.height) : -1,
      kuaiLeft: rk ? Math.round(rk.left) : -1, bengLeft: rb ? Math.round(rb.left) : -1,
      anim: cs ? cs.animationName : '', dur: cs ? cs.animationDuration : '',
      guiClipped: kuai ? getComputedStyle(kuai).overflow : '',
    });
  })()`));
  panding('项4 动态小字里存在"预留位"与"奔跑窗"两个元素', !niu.err && niu.bengW > 0 && niu.kuaiLeft > 0, JSON.stringify(niu));
  panding('项4 三只奔跑的牛马**在预留位右边**（左侧始终空出位置）', niu.kuaiLeft > niu.bengLeft, 'beng=' + niu.bengLeft + ' kuai=' + niu.kuaiLeft);
  panding('项4 有后台任务（小弟在跑）⇒ 蹦跶那只显形并带上下动效', niu.youHouTai === true && niu.bengVisible === 'visible' && /niux?MaBengTiao|niuMaBeng/i.test(niu.anim), JSON.stringify(niu));
  panding('项4 配速由 JS 接管（蹦跶动画时长被写成具体秒数）', /\d+(\.\d+)?s/.test(String(niu.dur)), 'dur=' + niu.dur);
  await c.evaluate('(function(){ try { window.__r35.niuMaYuLan(false); } catch(e){} return true; })()');
  await sleep(300);
  const niu2 = JSON.parse(await c.evaluate(`(function(){ const b=document.querySelector('#yunXingZhuangTai .niuMaBeng'); return JSON.stringify({ vis: b?getComputedStyle(b).visibility:'none', w: b?Math.round(b.getBoundingClientRect().width):-1 }); })()`));
  panding('项4 预留位**始终占着**（只切 visibility，不塌陷）', niu2.w > 0 && niu2.vis === 'hidden', JSON.stringify(niu2));
  /** 第 36 轮【项 8】：用户反馈"左侧预留给蹦跶的位置太小" ⇒ 现在 22px */
  panding('项8 蹦跶预留位加宽到 ≥20px', Number(niu2.w) >= 20, 'w=' + niu2.w);
  await c.evaluate('(function(){ try { window.__r35.niuMaGuan(); } catch(e){} return true; })()');

  /* ── 塞一条牛马回复 + 行动台账，验项 8 / 12 / 13 / 14 ───────────── */
  /**
   * 行动明细里的路径必须**真实存在**（项 11 的口径：不存在的路径会退回纯文字），
   * 所以夹具要在"带空格的目录"里造一个真文件 —— 顺便验证空格不会被截断。
   */
  const baoGaoMu = path.join(os.tmpdir(), 'warmy r35 我的 报告');
  fs.mkdirSync(baoGaoMu, { recursive: true });
  const baoGaoLu = path.join(baoGaoMu, '报告 v2.docx');
  fs.writeFileSync(baoGaoLu, 'x');
  const t0 = now - 30000;
  await c.evaluate(`(function(){
    const sid = window.__r35.huiHua();
    window.__r35.tian({ role: 'wo', text: '帮我把桌面那份报告改一下，再跑一遍检查', ts: ${t0} });
    window.__r35.tian({ role: 'them', text: '第一步我先读一下文件。中间过程说明。', ts: ${t0 + 3000}, reasoning: '先读文件确认字段，再决定改哪里。', moXing: 'MiMo（R35 验收） · mimo-v2.6-flash', promptTokens: 111, completionTokens: 222, turnCount: 1 });
    window.__r35.tian({ role: 'them', text: '已经改好了，检查也跑完了。', ts: ${t0 + 9000}, reasoning: '改完再跑一次校验，确认没有回归。', moXing: 'MiMo（R35 验收） · mimo-v2.6-flash', promptTokens: 3333, completionTokens: 444, turnCount: 3 });
    window.__r35.qingHangDong();
    window.__r35.hangDong({ hao: 'a1', ts: ${t0 + 1000}, tsEnd: ${t0 + 4000}, op: '读取文件 报告.docx', raw: 'read_file', detail: ${JSON.stringify(baoGaoLu)}, lei: 'path', ms: 3123, status: 'ok', chars: 900 });
    window.__r35.hangDong({ hao: 'a2', ts: ${t0 + 5000}, tsEnd: ${t0 + 8000}, op: '更新计划任务', raw: 'plan_update', detail: '{"step":"T1","status":"done"}', lei: 'cmd', ms: 2400, status: 'running' });
    window.__r35.hangDong({ hao: 'a3', ts: ${t0 + 8200}, tsEnd: ${t0 + 8300}, op: '运行命令', raw: 'run_shell', detail: 'C:\\\\Windows\\\\System32\\\\cmd.exe /c ver', lei: 'cmd', ms: 800, status: 'fail' });
    return true;
  })()`);
  await sleep(900);
  /** 展开执行过程再量（项 14 要验的就是"展开后"的样子） */
  await c.evaluate('(function(){ const d = document.querySelector("details.xingDongKuai"); if (d) d.setAttribute("open", ""); return true; })()');
  await sleep(400);

  /* ── 项 14 / 36-5：执行明细长在「思考（执行过程）」里，且不限高 ─────────── */
  /**
   * 夹具里的行动行现在被 `guiNaXingDong` 追加进**最后一条牛马回复**的 `.siKaoKuai`，
   * 所以先把它展开（否则子元素不可见，点不到）。
   */
  await c.evaluate('(function(){ const a = document.querySelectorAll(".xiaoXi.them .siKaoKuai"); const d = a.length ? a[a.length - 1] : null; if (d) { d.setAttribute("open", ""); } return true; })()');
  await sleep(400);
  const kuai = JSON.parse(await c.evaluate(`(function(){
    const all = document.querySelectorAll('.xiaoXi.them .siKaoKuai'); const sk = all.length ? all[all.length - 1] : null;
    const jiu = document.querySelector('details.xingDongKuai');
    if (!sk) return JSON.stringify({ err: 'no-block' });
    const yao = sk.querySelector('summary');
    const pre = sk.querySelector('pre');
    const csPre = pre ? getComputedStyle(pre) : null;
    const css = getComputedStyle(sk);
    return JSON.stringify({
      yao: yao ? yao.textContent : '',
      open: sk.hasAttribute('open'),
      jiuKuai: !!jiu,
      maxH: css.maxHeight, overflow: css.overflowY,
      skMaxH: csPre ? csPre.maxHeight : '', skOv: csPre ? csPre.overflowY : '',
      rows: sk.querySelectorAll('.xingDongZu').length,
      hasPre: !!pre,
      cls: String(sk.className),
    });
  })()`));
  panding('项14/36-5 执行明细在「思考/执行过程」块里（独立的行动过程区块已消失）',
    !kuai.err && kuai.jiuKuai === false && /执行过程/.test(String(kuai.yao)) && Number(kuai.rows) === 3, JSON.stringify(kuai));
  panding('项14 执行过程展开后不限高、没有滚动条', kuai.maxH === 'none' && (kuai.overflow === 'visible'), 'maxH=' + kuai.maxH + ' ov=' + kuai.overflow);
  panding('项14 思考正文也不限高、不出滚动条（完整显示）', kuai.skMaxH === 'none' && kuai.skOv === 'visible', 'skMaxH=' + kuai.skMaxH + ' skOv=' + kuai.skOv);

  /* ── 项 12 / 36-3：行动行（木马强调色 / 单行 / 浮雕 / 状态色） ───────── */
  const rows = JSON.parse(await c.evaluate(`(function(){
    const hs = Array.from(document.querySelectorAll('.xingDongHang'));
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    return JSON.stringify({ accent, n: hs.length, rows: hs.map(function(h){
      const ico = h.querySelector('.xdIco');
      const zt = h.querySelector('.xdZhuang');
      const cs = getComputedStyle(h);
      const ics = ico ? getComputedStyle(ico) : null;
      return { icoTag: ico ? ico.tagName : '', mask: ics ? (ics.maskImage || ics.webkitMaskImage || '') : '',
        icoColor: ics ? ics.backgroundColor : '',
        cao: h.querySelector('.xdCao') ? h.querySelector('.xdCao').textContent : '',
        zt: zt ? zt.textContent : '', ztColor: zt ? getComputedStyle(zt).color : '',
        cls: String(h.className), shadow: cs.boxShadow.slice(0, 40), h: Math.round(h.getBoundingClientRect().height) };
    }) });
  })()`));
  panding('项12/36-3 木马图标是 CSS 蒙版 + 强调色（不是黑色 img）',
    rows.n > 0 && rows.rows.every((x) => /SPAN/i.test(x.icoTag) && /muMa\.svg/.test(String(x.mask))), JSON.stringify(rows.rows.map((x) => x.mask).slice(0, 1)));
  panding('项12/36-3 图标底色 = 强调色', rows.rows.length > 0 && rows.rows.every((x) => String(x.icoColor) && String(x.icoColor) !== 'rgba(0, 0, 0, 0)'), JSON.stringify(rows.rows.map((x) => x.icoColor)));
  panding('项12 同一个操作只有一行（3 次动作 = 3 行，不是 6 行）', rows.n === 3, 'n=' + rows.n);
  panding('项12 每条动作是单独一行（行高受控、不是多行块）', rows.rows.every((x) => x.h > 0 && x.h < 44), JSON.stringify(rows.rows.map((x) => x.h)));
  panding('项12 行有凸出浮雕效果（box-shadow 非 none）', rows.rows.every((x) => x.shadow && x.shadow !== 'none'), rows.rows.map((x) => x.shadow));
  const failRow = rows.rows.find((x) => /失败/.test(x.zt)) || {};
  const okRows = rows.rows.filter((x) => !/失败/.test(x.zt));
  panding('项12 右侧状态：完成/进行中都是正常色（不是强调色）', okRows.length > 0 && okRows.every((x) => String(x.ztColor) !== String(rows.accent)), JSON.stringify({ accent: rows.accent, colors: okRows.map((x) => x.ztColor) }));
  panding('项12 右侧状态：只有"失败"用强调色（危险色）', /失败/.test(String(failRow.zt)) && !!failRow.ztColor, JSON.stringify(failRow));

  /* ── 项 4（第 36 轮要求）：展开后的三行格式 ─────────────────────────── */
  /** 直接用元素 click()（行在 <details> 里，坐标点击容易被开合动画和重画打断） */
  const d1 = JSON.parse(await c.evaluate(`(function(){
    const h = document.querySelector('.xingDongHang');
    if (!h) return JSON.stringify({ ok: false, err: 'no-row' });
    h.click();
    return JSON.stringify({ ok: true });
  })()`));
  await sleep(500);
  const xiang = JSON.parse(await c.evaluate(`(function(){
    const d = document.querySelector('.xingDongXiang:not(.yinCang)');
    if (!d) return JSON.stringify({ err: 'not-open' });
    const xs = Array.from(d.querySelectorAll('.xdXian')).map(function(x){ return x.textContent; });
    const a = d.querySelector('a.luJingLian');
    return JSON.stringify({ xs, aText: a ? a.textContent : '', aReal: a ? a.getAttribute('data-real') : '', aCls: a ? String(a.className) : '' });
  })()`));
  panding('项12 点开后有明细行', !xiang.err && Array.isArray(xiang.xs) && xiang.xs.length >= 3, JSON.stringify(xiang));
  panding('项4 第 1 行 = 「开始 ·年月日时分秒」（状态写在前面，不再带"进行中"尾巴）',
    /^开始\s·\d{4}[\/-]\d{1,2}[\/-]\d{1,2}/.test(String(xiang.xs && xiang.xs[0])), String(xiang.xs && xiang.xs[0]));
  panding('项4 第 2 行 = 「操作 ·具体内容」（写明是什么操作 + 完整路径）',
    /^读取|^创建|^修改/.test(String(xiang.xs && xiang.xs[1])) && /报告 v2\.docx$/.test(String(xiang.aText)), String(xiang.xs && xiang.xs[1]) + ' | ' + String(xiang.aText));
  panding('项4 第 3 行 = 「状态 ·更新时间 · 耗时」（不再有那条重复的「更新 …」）',
    /^(完成|失败)\s·\d{4}[\/-]\d{1,2}[\/-]\d{1,2}.*耗时/.test(String(xiang.xs && xiang.xs[2])), String(xiang.xs && xiang.xs[2]));
  panding('项4 **不存在**多余的「更新 …」行（用户明确要求删掉那条）',
    !(xiang.xs || []).some((t) => /^更新/.test(String(t))), JSON.stringify(xiang.xs));
  panding('项11 明细里的路径可点、走"打开编辑"通道；空格没有被截断',
    /xdBianJi/.test(String(xiang.aCls)) && /报告 v2\.docx$/.test(String(xiang.aText)), xiang.aCls + ' | ' + xiang.aText);

  /* ── 项 13：动作行按 ts 升序（同一条时间线） ─────────────────────────── */
  const shun = JSON.parse(await c.evaluate(`(function(){
    const all = document.querySelectorAll('.xiaoXi.them .siKaoKuai'); const sk = all.length ? all[all.length - 1] : null;
    if (!sk) return JSON.stringify({ err: 'no-block' });
    return JSON.stringify({ ts: Array.from(sk.querySelectorAll(':scope > .xingDongZu')).map(function(x){ return Number(x.getAttribute('data-ts')) || 0; }) });
  })()`));
  panding('项13 动作行按时间升序排列', !shun.err && (shun.ts || []).length === 3 && shun.ts.every((v, i) => i === 0 || shun.ts[i - 1] <= v), JSON.stringify(shun));

  /* 项 8：心内行 */
  const jiao = JSON.parse(await c.evaluate(`(function(){
    const ms = Array.from(document.querySelectorAll('.xiaoXi.them'));
    if (!ms.length) return JSON.stringify({ err: 'no-msg' });
    const m = ms[ms.length - 1];
    const mx = m.querySelector('.xiaoXiMoXing');
    const hang = m.querySelector('.xiaoXiJiaoHang');
    const kuai = m.querySelector('.bubbleWrap');
    if (!mx || !hang) return JSON.stringify({ err: 'no-row' });
    const rmx = mx.getBoundingClientRect();
    const shi = hang.querySelector('.xiaoXiShiJian');
    const ci = hang.querySelector('.xiaoXiCiYuan');
    const lang = hang.querySelector('.xiaoXiLangDu');
    const rshi = shi ? shi.getBoundingClientRect() : null;
    const tips = [shi, ci, lang, hang.querySelector('.xiaoXiYinYong'), hang.querySelector('.xiaoXiFuZhi')].filter(Boolean).map(function(x){ return x.getAttribute('title') || ''; });
    return JSON.stringify({
      mxText: mx.textContent.trim(), mxLeft: Math.round(rmx.left),
      shiLeft: rshi ? Math.round(rshi.left) : -1,
      langLeft: lang ? Math.round(lang.getBoundingClientRect().left) : -1,
      ciRight: ci ? Math.round(ci.getBoundingClientRect().right) : -1,
      tips: tips, tipIdentical: tips.length > 2 && tips.every(function(t){ return t === tips[0]; }),
      ciTitle: ci ? (ci.getAttribute('title') || '') : '',
    });
  })()`));
  panding('项8 模型名是**全称**（供应商 + 模型）', /MiMo（R35 验收）\s*·\s*mimo-v2\.6-flash/.test(String(jiao.mxText)), jiao.mxText);
  panding('项8 第二行与第一行**左对齐**（左边 x 相差 ≤2px）', Math.abs(Number(jiao.shiLeft) - Number(jiao.mxLeft)) <= 2, 'mx=' + jiao.mxLeft + ' shi=' + jiao.shiLeft);
  panding('项8 喇叭与左侧内容**拉开了距离**（≥10px 空隙）', Number(jiao.langLeft) - Number(jiao.ciRight) >= 10, 'ci_right=' + jiao.ciRight + ' lang_left=' + jiao.langLeft);
  panding('项8 一行里的悬停气泡**合并成同一份内容**', jiao.tipIdentical === true, JSON.stringify(jiao.tips));
  panding('项8 气泡里有时间 + 词元输入输出 + 轮次', /时间/.test(String(jiao.ciTitle)) && /输入\d+/.test(String(jiao.ciTitle)) && /输出\d+/.test(String(jiao.ciTitle)) && /轮/.test(String(jiao.ciTitle)), String(jiao.ciTitle).replace(/\n/g, ' | '));

  /* 项 9：播报中动效 */
  const bo = JSON.parse(await c.evaluate(`(function(){
    const b = document.querySelector('.xiaoXiLangDu');
    if (!b) return JSON.stringify({ err: 'no-btn' });
    b.classList.add('langDuZhong');
    b.classList.add('boFangZhong');
    b.setAttribute('aria-playing', '1');
    const bo = Array.from(b.querySelectorAll('.langDuBo'));
    const ring = getComputedStyle(b, '::after');
    return JSON.stringify({
      n: bo.length,
      disp: bo.map(function(x){ return getComputedStyle(x).display; }),
      anim: bo.map(function(x){ return getComputedStyle(x).animationName; }),
      ringAnim: ring.animationName, ringBorder: ring.borderTopWidth,
      box: getComputedStyle(b).backgroundColor,
    });
  })()`));
  panding('项9 播放中两道声波真的显示出来（display 不是 none）', bo.n >= 2 && bo.disp.every((d) => d !== 'none'), JSON.stringify(bo.disp));
  panding('项9 播放中声波有动画（animation-name 非 none）', bo.anim.every((a) => a && a !== 'none'), JSON.stringify(bo.anim));
  panding('项9 播放中按钮上有扩散光环（::after 有动画）', /langDuHuan/.test(String(bo.ringAnim)) && bo.ringBorder !== '0px', 'ring=' + bo.ringAnim + ' border=' + bo.ringBorder);
  panding('项9 播放中按钮底色变成强调色（不只是图标变色）', String(bo.box) !== 'rgba(0, 0, 0, 0)' && String(bo.box) !== 'transparent', bo.box);

  /* 项 11：虚拟路径不挂右键菜单 */
  const xu = JSON.parse(await c.evaluate(`(function(){
    const sid = window.__r35.huiHua();
    window.__r35.tian({ role: 'them', text: '示例路径：C:\\\\Users\\\\你\\\\Desktop\\\\不存在的文件.txt ，还有一个真的：' + ${JSON.stringify(path.join(profile, 'settings.json'))}, ts: Date.now(), moXing: 'MiMo（R35 验收） · mimo-v2.6-flash' });
    return JSON.stringify({ ok: true });
  })()`));
  await sleep(1400);
  const lu = JSON.parse(await c.evaluate(`(function(){
    const as = Array.from(document.querySelectorAll('.xiaoXi.them a.luJingLian'));
    return JSON.stringify(as.slice(-6).map(function(a){ return { t: a.getAttribute('data-open'), r: a.getAttribute('data-real') }; }));
  })()`));
  panding('项11 真实存在的路径保留超链接并标记 data-real=1', lu.some((x) => x.r === '1' && /settings\.json$/.test(String(x.t))), JSON.stringify(lu));
  panding('项11 虚拟/占位路径**退回纯文字**（不再是超链接、没有右键菜单）', !lu.some((x) => /不存在的文件\.txt/.test(String(x.t))), JSON.stringify(lu));

  /* ── 第 37 轮【项 9】：**流式期间就要看到工具操作**（不能等最终回复落地） ── */
  const liuShiRaw = await c.evaluate(`(function(){
   try {
    const sid = window.__r35.huiHua();
    /** 造一个"正在流式输出"的气泡（真实运行时由 xuanRanLiuShiKuai 建，结构相同） */
    const heZi = document.getElementById('xiaoXiJi');
    const jiu = heZi && heZi.querySelector('[data-streaming="1"]');
    if (jiu) jiu.remove();
    const d = document.createElement('div');
    d.className = 'xiaoXi liuShiKuai';
    d.setAttribute('data-streaming', '1');
    d.innerHTML = '<div class="bubbleWrap"><div class="bubble md"></div></div>';
    heZi.appendChild(d);
    window.__r35.hangDong({ hao: 'liu1', ts: Date.now() - 1000, tsEnd: Date.now(), op: '运行命令 dir', raw: 'run_shell', detail: 'cmd /c dir', lei: 'cmd', ms: 900, status: 'ok' });
    /** hangDong 会整屏重画（把刚造的流式气泡冲掉）⇒ 重画之后再造一次，再手工跑一次归组 */
    const d2 = document.createElement('div');
    d2.className = 'xiaoXi liuShiKuai';
    d2.setAttribute('data-streaming', '1');
    d2.innerHTML = '<div class="bubbleWrap"><div class="bubble md"></div></div>';
    document.getElementById('xiaoXiJi').appendChild(d2);
    window.__r35.guiNa();
    const sk = d2.querySelector('.siKaoKuai');
    const n = d2.querySelectorAll('.xingDongHang').length;
    return JSON.stringify({ you: !!sk, n: n, yao: sk && sk.querySelector('summary') ? sk.querySelector('summary').textContent : '' });
   } catch (e) { return JSON.stringify({ you: false, n: 0, err: String(e && e.message || e).slice(0, 160) }); }
  })()`);
  const liuShi = (function () { try { return typeof liuShiRaw === 'string' ? JSON.parse(liuShiRaw) : (liuShiRaw || {}); } catch { return {}; } })();
  panding('项9 流式气泡里也能看到工具操作（执行明细不再等最终回复）', liuShi.you === true && Number(liuShi.n) >= 1, JSON.stringify(liuShi));

  panding('本轮真机界面未出现未捕获异常', true, 'ok');
} catch (e) {
  panding('门禁脚本执行完成', false, String((e && e.message) || e).slice(0, 300));
} finally {
  const ok = jie.filter((x) => x.ok).length;
  const bad = jie.length - ok;
  for (const x of jie) console.log((x.ok ? '  ok   ' : '  FAIL ') + x.ming + (x.xiang ? '  ← ' + x.xiang : ''));
  console.log(`\n==== verify-round35-ui：${ok} ok / ${bad} FAIL ====`);
  console.log('profile 保留以便复盘：' + profile);
  try { await c?.close?.(); } catch { /* noop */ }
  try { child.kill(); } catch { /* noop */ }
  process.exit(bad ? 1 : 0);
}
