/**
 * verify-round38-qr.mjs —— 项 1「牛马管理局里微信扫码的二维码没显示」的**真机**证明
 *
 * 用户看到的是**空白**，所以门禁必须按"眼睛里有没有东西"判，而不是按接口返回码判。
 * 三条断言，一条比一条靠近用户的眼睛：
 *  ① 主进程把服务端的 `qrcode_img_content` 交代清楚：**只有按字节魔数确那是图片**才转 data URL，
 *     否则把它当**要编码进二维码的内容**交回渲染层（实测它是 `text/html` 的确认页地址 ——
 *     上一版把它当图片下载下来 base64 塞进 `<img>`，画不出任何东西，就是用户看到的"二维码没有显示"）；
 *  ② 交回来的东西真能变成码：data URL 要 `naturalWidth>0`，地址要短到本地 `qrSvg()` 编得进去；
 *  ③ 走界面那条路：进「我的」→ 选一只牛马 → 社交接入 → 点「微信扫码连接」⇒
 *     弹层里**必须看得见码**（本地画的 SVG 或真图片，宽度 >0），画不出来时**必须看得见一句人话**，
 *     唯独不允许"什么都没有"。
 *
 * ③ 依赖腾讯 iLink 端点（`ilinkai.weixin.qq.com`）。它今天通、明天可能被灰度关掉：
 * 那种情况服务端会给原话，本门禁按②的口径判"**要么有图、要么有话说**"，不因远端策略变化假红，
 * 也不给"空白"放行。
 *
 * 跑法：node dev/gates/verify-round38-qr.mjs
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
const PORT = Number(process.env.R38QR_PORT || 9985);
const { attach, sleep, bootWait } = await import(pathToFileURL(path.join(PKG, 'scripts', 'cdp-lib.mjs')).href);

const shi = []; let ok = 0;
const jian = (l, p, d) => { if (p) { ok += 1; console.log('  ok   ' + l); return; } shi.push(l); console.log('  FAIL ' + l + (d ? ' ← ' + String(d).slice(0, 240) : '')); };

const profile = path.join(os.tmpdir(), 'warmy-r38-qr-' + Date.now());
fs.mkdirSync(profile, { recursive: true });
const peiZhi = {
  yuYan: 'zh-CN', setupDone: true, privacyConsent: true, guideDone: true, providersSeeded: true,
  globalSecurity: 'normal', trustedFolders: [], asrEnabled: false,
  providers: [], specialModels: {},
  instances: [{ id: 'inst-r38qr-1', ming: '牛马-1', name: '牛马-1', status: 'running', defaultModel: '', currentModel: '', chain: [], chainDisabled: [] }],
};
/** 设置必须**开机前就落盘**：开机后再 `settingsSave` 只改了主进程那份，渲染层的 `state.instances`
 *  还是空的 ⇒ 列表里根本没有牛马那一张卡，点不进详情页（第一版就栽在这儿，把"进不去"误报成"二维码没修好"）。 */
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify(peiZhi, null, 2), 'utf8');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.MIMO_KEY_FILE;
const child = spawn(ELECTRON, ['--remote-debugging-port=' + PORT, '--disable-features=CalculateNativeWinOcclusion', '--user-data-dir=' + profile, MAIN],
  { cwd: PKG, stdio: ['ignore', 'ignore', 'ignore'], env });

let c = null;
const js = (e) => c.evaluate('(async function(){ try { return await (' + e + '); } catch (err) { return { __err: String((err && (err.stack||err.message)) || err).slice(0,240) }; } })()');
const dianJi = async (xuan) => await js('(() => { const b = document.querySelector(' + JSON.stringify(xuan) + '); if (b) b.click(); return !!b; })()');

try {
  let lian = false;
  for (let i = 0; i < 90; i++) { try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) { lian = true; break; } } catch { /* 还没起 */ } await sleep(1000); }
  if (!lian) { jian('CDP 起得来', false, 'timeout'); process.exit(1); }
  c = await attach(PORT, { biaoQian: 'r38qr', callTimeout: 60000 });
  await c.send('Runtime.enable');
  try { await bootWait(c, '', 45000); } catch { /* 起没起全由后面的断言判 */ }
  await sleep(3000);

  /* ── ① 主进程取回二维码并转 data URL ─────────────────────────────── */
  const r1 = await js('window.warmy.sheJiaoSaoMaKaiShi({ pingTai:"ilink", instId:"inst-r38qr-1" })');
  const img = String((r1 && r1.img) || '');
  const neiRong = String((r1 && r1.tuNeiRong) || '');
  console.log('  · 接口返回：' + JSON.stringify({ ok: r1 && r1.ok, dataUrl: img.slice(0, 24), neiRongChang: neiRong.length, cuo: String((r1 && (r1.cuo || r1.error)) || '').slice(0, 60), yuan: String((r1 && r1.imgYuan) || '').slice(0, 52) }).slice(0, 260));
  jian('① 申请二维码这一步本身有交代（要么给内容，要么带服务端原话）',
    !!r1 && !r1.__err && (!!r1.ok || String(r1.cuo || r1.error || '').length > 3), JSON.stringify(r1 || {}).slice(0, 200));
  jian('① ok 时二选一：**真图片字节**转的 data URL，或**要本地编码的内容**（绝不再把 text/html 当图片塞给 img）',
    !r1 || !r1.ok || /^data:image\/[a-z+]+;base64,/i.test(img) || /^https?:\/\//i.test(neiRong),
    'img=' + img.slice(0, 40) + ' tuNeiRong=' + neiRong.slice(0, 40));

  /* ── ② 这份东西在本 CSP 下真能变成看得见的码 ─────────────────────── */
  if (img.length > 100) {
    const ran = await js('(async () => { const i = new Image(); i.src = ' + JSON.stringify(img) + ';'
      + 'await (i.decode ? i.decode().catch(()=>{}) : new Promise((res)=>{ i.onload=res; i.onerror=res; }));'
      + 'return { kuan: i.naturalWidth, gao: i.naturalHeight }; })()');
    console.log('  · 渲染出来：' + JSON.stringify(ran));
    jian('② 服务端真给了图片字节 ⇒ 在这台机器上画得出来（naturalWidth>0，CSP 放行 data:）',
      !!ran && Number(ran.kuan) > 0 && Number(ran.gao) > 0, JSON.stringify(ran).slice(0, 120));
  } else if (/^https?:\/\//i.test(neiRong)) {
    jian('② 服务端给的是**确认页地址**（text/html 那一类）⇒ 交回本地画码，地址短到编得进二维码',
      neiRong.length < 900, '长度=' + neiRong.length);
  } else {
    jian('② 既没有图也没有内容时，必须有一句人话解释（不许空白）',
      String((r1 && (r1.cuo || r1.error)) || '').length > 3, '既没有图也没有原话 ⇒ 就是用户看到的空白');
  }

  /* ── ③ 走界面：点「微信扫码连接」⇒ 弹层要么有图、要么有原话 ──────── */
  await dianJi('[data-nav="singleAi"]');
  await sleep(2500);
  await dianJi('.lieBiaoHqTuBiao');
  let zhaoDao = false;
  for (let i = 0; i < 12 && !zhaoDao; i++) {
    await sleep(1200);
    zhaoDao = !!(await js('!!document.querySelector(\'[data-sj-host]\')'));
    if (!zhaoDao && i === 2) { await dianJi('.lieBiaoKa'); await sleep(800); await dianJi('#lieBiaoTi .lieBiaoTiaoMu'); }
  }
  const zaiKuai = await js('(() => { const h = document.querySelector(\'[data-sj-host]\');'
    + ' const b = document.querySelector(\'[data-sj-qr="ilink"]\');'
    + ' return { youKuai: !!h, youAnNiu: !!b, wenAn: h ? (h.innerText || "").slice(0, 60) : "" }; })()');
  console.log('  · 社交接入块：' + JSON.stringify(zaiKuai).slice(0, 200));
  if (!zaiKuai || !zaiKuai.youKuai) {
    const chao = await js('(() => { const ka = [...document.querySelectorAll(".lieBiaoKa")];'
      + ' const xq = document.getElementById("shiLiXiangQing");'
      + ' const tou = document.querySelector(".lieBiaoTi");'
      + ' return { kaShu: ka.length, kaWen: ka.slice(0, 4).map((n) => (n.innerText || "").replace(/\\s+/g, " ").slice(0, 26)),'
      + '   lieBiaoTi: tou ? (tou.innerText || "").slice(0, 30) : "", xiangQingCunZai: !!xq,'
      + '   xiangQingYinCang: xq ? xq.classList.contains("yinCang") : null,'
      + '   kongTaiZai: !!document.getElementById("kongTai"),'
      + '   ceLanJiHuo: [...document.querySelectorAll(".ceLanTiaoMu.jiHuo")].map((n) => n.getAttribute("data-nav")).join(",") }; })()');
    console.log('  · 现场诊断：' + JSON.stringify(chao).slice(0, 500));
  }
  jian('③ 牛马详情里能看到「社交接入」这块和微信那个按钮',
    !!zaiKuai && zaiKuai.youKuai && zaiKuai.youAnNiu, JSON.stringify(zaiKuai).slice(0, 160));
  if (zaiKuai && zaiKuai.youAnNiu) {
    await js('(() => { const b = document.querySelector(\'[data-sj-qr="ilink"]\'); if (b) b.click(); return !!b; })()');
    await sleep(9000);
    const ceng = await js('(() => { const c = document.querySelector(".sjQrCeng"); if (!c) return { ceng: false };'
      + ' const im = c.querySelector("img"); const sv = c.querySelector("svg"); const zi = (c.innerText || "").trim();'
      + ' const keJian = (n) => !!n && (n.getBoundingClientRect().width || 0) > 0;'
      + ' return { ceng: true, tu: !!im, kuan: im ? im.naturalWidth : 0,'
      + '   svg: !!sv, svgKuan: sv ? Math.round(sv.getBoundingClientRect().width) : 0,'
      + '   ziChang: zi.length, zi: zi.slice(0, 90), zhao: keJian(im || sv) }; })()');
    console.log('  · 弹层：' + JSON.stringify(ceng).slice(0, 240));
    jian('③ 点了按钮以后**眼睛里看得见码**（本地画的 SVG 或真图片，宽 >0）——空白就是没修好',
      !!ceng && ceng.ceng === true && (ceng.zhao === true || (ceng.tu && Number(ceng.kuan) > 0) || Number(ceng.svgKuan) > 0),
      JSON.stringify(ceng).slice(0, 200));
    jian('③ 万一画不出来，也要看得见一句人话（原因/状态），不是静默',
      !!ceng && (ceng.zhao === true || Number(ceng.ziChang) > 6), JSON.stringify(ceng).slice(0, 160));
  }
} finally {
  try { if (c) c.close(); } catch { /* noop */ }
  try { if (child && !child.killed) child.kill(); } catch { /* noop */ }
  await sleep(2500);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
}
console.log(`\n==== verify-round38-qr：${ok} ok / ${shi.length} FAIL ====`);
for (const s of shi) console.log('  FAIL ' + s);
process.exit(shi.length ? 1 : 0);
