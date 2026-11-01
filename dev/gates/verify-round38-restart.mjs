/**
 * verify-round38-restart.mjs —— 项 2 / 项 8 的**真机**证明：应用重启以后
 *   ① 已完成那一轮的「执行过程 + 所用模型 + 词元 + 思考分段」还在（项 8：以前重开就空白）；
 *   ② 被拦腰杀掉的那一轮，**思考 / 中间回复 / 工具操作**不消失，并且界面认出"这一轮被打断"，
 *      把「继续 / 重试」点亮（项 2：以前重启后只剩用户自己那句话）。
 *
 * 为什么要真跑一轮：这两条全靠**流式与落盘的实际时序**（旁路元数据 chat-meta.json + 半成品每 2 秒落盘），
 * 静态断言只能证明"代码写了"，证明不了"重启后画得出来"。
 *
 * 授权卡**像用户一样点「同意」**（写工作区外的文件必定弹卡；不批就永远等不到回复 ——
 * 第一版就栽在这儿，把"卡在授权上"误报成"重启后内容消失"）。
 *
 * 全程只在自己的临时 profile + profile 里的工作目录动，不碰用户桌面。
 * 跑法：MIMO_KEY_FILE="<密钥文件>" node dev/gates/verify-round38-restart.mjs
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
const { attach, sleep } = await import(pathToFileURL(path.join(PKG, 'scripts', 'cdp-lib.mjs')).href);

const KEY_FILE = String(process.env.MIMO_KEY_FILE || '');
if (!KEY_FILE || !fs.existsSync(KEY_FILE)) { console.log('缺 MIMO_KEY_FILE'); process.exit(2); }
const MI_YAO = fs.readFileSync(KEY_FILE, 'utf8').split(/\r?\n/)[0].trim();
const JIDI = 'https://token-plan-cn.xiaomimimo.com/v1';
const MO_XING = 'mimo-v2.6-flash';
const PORT = Number(process.env.R38RS_PORT || 9987);
const BIAO_JI = 'R38KEEP' + Date.now().toString(36).toUpperCase();

const shi = []; let ok = 0;
const jian = (l, p, d) => { if (p) { ok += 1; console.log('  ok   ' + l); return; } shi.push(l); console.log('  FAIL ' + l + (d ? ' ← ' + String(d).slice(0, 260) : '')); };

const profile = path.join(os.tmpdir(), 'warmy-r38-restart-' + Date.now());
const gongZuo = path.join(profile, 'ws');
fs.mkdirSync(gongZuo, { recursive: true });
const wenJianLu = path.join(gongZuo, BIAO_JI + '.txt');
const peiZhi = {
  yuYan: 'zh-CN', setupDone: true, privacyConsent: true, guideDone: true, providersSeeded: true,
  globalSecurity: 'normal', trustedFolders: [gongZuo], asrEnabled: false,
  providers: [{ id: 'mimo-r38rs', biaoQian: 'MiMo（本轮）', protocol: 'openai-compatible', baseURL: JIDI, defaultModel: '', models: [MO_XING], staleModels: [], hasKey: false }],
  specialModels: { chatChain: [MO_XING], asrChain: [], asrDisabled: [] },
  instances: [{ id: 'inst-r38rs-1', ming: '牛马-1', name: '牛马-1', status: 'running', defaultModel: 'MiMo（本轮） · ' + MO_XING, currentModel: MO_XING, chain: ['MiMo（本轮） · ' + MO_XING], chainDisabled: [] }],
};
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify(peiZhi, null, 2), 'utf8');

const qiDong = () => {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  return spawn(ELECTRON, ['--remote-debugging-port=' + PORT, '--disable-features=CalculateNativeWinOcclusion', '--user-data-dir=' + profile, MAIN],
    { cwd: PKG, stdio: ['ignore', 'ignore', 'ignore'], env });
};
const dengDuan = async () => {
  for (let i = 0; i < 90; i++) { try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) return true; } catch { /* 还没起 */ } await sleep(1000); }
  return false;
};
const guan = async (zi) => {
  try {
    const g = await attach(PORT, { biaoQian: 'r38rs-guan', callTimeout: 8000 });
    try { await g.send('Browser.close'); } catch { /* noop */ }
    try { g.close(); } catch { /* noop */ }
  } catch { /* 进程已经没了 */ }
  for (let i = 0; i < 24; i++) { if (!zi || zi.exitCode !== null) break; await sleep(700); }
  try { if (zi && zi.exitCode === null) zi.kill(); } catch { /* noop */ }
  await sleep(2500);
};

let c = null;
const lianJie = async () => { c = await attach(PORT, { biaoQian: 'r38rs', callTimeout: 120000 }); await c.send('Runtime.enable'); };
const js = (e) => c.evaluate('(async function(){ try { return await (' + e + '); } catch (err) { return { __err: String((err && (err.stack||err.message)) || err).slice(0,240) }; } })()');
const daKa = async () => {
  const r = await js('window.warmy.aiQuestionList()');
  const chu = [];
  for (const q of (r && r.items) || []) {
    if (q.status !== 'pending') continue;
    const xuan = q.options || [];
    const tong = xuan.find((o) => /同意|允许/.test(String(o.biaoQian || '')));
    const ju = xuan.find((o) => /拒绝/.test(String(o.biaoQian || '')));
    const ting = xuan.find((o) => /停止|取消/.test(String(o.biaoQian || '')));
    /**
     * **只批"目标在本门禁自己的临时目录"这一种授权**，其它一律拒绝。
     * 真机教训：以前无脑点「同意」，模型顺手把一篇作文写到了**用户桌面**上 ——
     * 门禁不许污染用户的机器，更不能靠"我猜它要写哪儿"。
     */
    const zhuan = (s) => String(s || '').replace(/\\\\/g, '/').replace(/\\/g, '/');
    const keYi = !!tong && zhuan(JSON.stringify(q)).includes(zhuan(gongZuo));
    const t = keYi ? tong : (ju || ting || (xuan[0] || null));
    chu.push(String(q.biaoTi || '') + (keYi ? '→同意(就在自己的目录)' : '→拒绝(不在自己的目录)'));
    if (t) await js('window.warmy.aiQuestionAnswer(' + JSON.stringify({ id: q.id, optionId: t.id }) + ')');
  }
  return chu;
};
const faSong = (neiRong) => js('(() => { window.__r38rs = { res: null }; const p = window.warmy.chatSend({ sessionId: '
  + JSON.stringify(sid) + ', content: ' + JSON.stringify(neiRong) + ', insertMode: "outer", ming: "牛马-1", thinkLevel: "auto", xiaoDiShuLiang: "auto",'
  + ' moXingJueCe: { urgency: "P2", defaultModel: "' + MO_XING + '", chain: [], chainDisabled: [] }, jiaQiangHuiFu: false });'
  + ' if (p && p.then) p.then((r) => { window.__r38rs.res = r || true; }).catch((e) => { window.__r38rs.res = { err: String(e).slice(0,160) }; });'
  + ' return true; })()');

let child = null;
let sid = '';
try {
  /* ══ 第一次开机：真跑一整轮（带工具调用） ══ */
  child = qiDong();
  if (!(await dengDuan())) { jian('第一次启动起得来', false, 'CDP 超时'); process.exit(1); }
  await sleep(6000);
  await lianJie();
  await js('window.warmy.providerKeySet(' + JSON.stringify({ providerId: 'mimo-r38rs', apiKey: MI_YAO }) + ')');
  await sleep(2000);
  await js('(() => { const b = document.querySelector(\'[data-nav="singleAi"]\'); if (b) b.click(); return !!b; })()');
  await sleep(3000);
  sid = String((await js('window.__r35 && window.__r35.huiHua()')) || '');
  jian('界面里有一个当前会话（单聊）', sid.length > 1, 'sid=' + sid);

  const tiShi = '用 write_file 工具把一行字 ' + BIAO_JI + ' 写进文件 ' + wenJianLu
    + '，写完以后回我一句「写好了」并说明文件在哪。';
  await faSong(tiShi);
  let wanCheng = null;
  const t0 = Date.now();
  for (let i = 0; i < 80 && !wanCheng; i++) {
    const ka = await daKa();
    if (ka.length) console.log('  · 卡片 +' + Math.round((Date.now() - t0) / 1000) + 's ' + ka.join(' ⏐ ').slice(0, 120));
    await sleep(4000);
    const z = await js('window.__r38rs && window.__r38rs.res');
    if (z && !(z.__err || z.err)) wanCheng = z;
    else if (z && z.err) { console.log('  · chatSend 报错：' + String(z.err).slice(0, 140)); wanCheng = z; }
  }
  const qian = await js('(() => { const ti = [...document.querySelectorAll("[title]")].map((n) => String(n.getAttribute("title") || ""));'
    + ' return { duan: document.querySelectorAll(".siKaoDuanKuai").length,'
    + '   cao: document.querySelectorAll(".xingDongHang").length,'
    + '   moXingTi: ti.filter((s) => /模型/.test(s)).length,'
    + '   ciShu: ti.filter((s) => /输入\\d+，输出\\d+/.test(s)).length }; })()');
  console.log('  · 完成轮现场：' + JSON.stringify(qian).slice(0, 200));
  jian('① 跑完这一轮（chatSend 真的回来了，不是卡在授权上）', !!wanCheng && !wanCheng.err, JSON.stringify(wanCheng || {}).slice(0, 160));
  jian('① 这一轮确实动了工具（界面上有执行过程的操作行）', Number(qian.cao) >= 1, JSON.stringify(qian).slice(0, 160));
  jian('① 文件真的写出来了（工具不是假装成功）', fs.existsSync(wenJianLu) && String(fs.readFileSync(wenJianLu, 'utf8')).includes(BIAO_JI), wenJianLu);
  jian('① 没重启前就带着模型与词元的悬停信息（这才谈得上"重启后还在"）',
    Number(qian.moXingTi) >= 1 && Number(qian.ciShu) >= 1, JSON.stringify(qian).slice(0, 200));

  /* ══ 发一条长任务，等它开始吐字并且半成品已落盘 ⇒ 直接杀掉进程 ══ */
  const shaMingAt = Date.now();
  /**
   * 题目要**足够长**（第 48 轮改）：900 字时快模型十来秒就写完了 ⇒ 杀的时候这一轮其实已经结束，
   * 旧版靠"上一轮写完却没清掉的半成品"才过 —— 那正是第 48 轮修掉的假"被中断"缺陷（#21）。
   * 现在要 3000 字、分 6 段，并且下面明确断言"杀的那一刻这一轮还没写完"。
   */
  const changTi = '请写一篇 3000 字左右的说明文，分 6 段逐段展开，题目是「' + BIAO_JI + '：一次被中断的对话」。**只在对话里写出来，不要创建、不要修改任何文件**。现在就从第一段开始写，写完再停。';
  await faSong(changTi);
  /**
   * 要"杀掉一个**用户已经看得见内容**的轮次"才有意义：光有 `[data-streaming="1"]` 这个壳不算
   * （它可能是"思考中…"的空气泡，那时候本来就没有东西可保留，判它红是我写错判据）。
   */
  let kanJian = 0;
  for (let i = 0; i < 60 && kanJian < 60; i++) {
    await daKa();
    await sleep(2000);
    const z = await js('(() => { const n = document.querySelector(\'[data-streaming="1"]\');'
      + ' const zi = n ? String(n.innerText || "").replace(/\\s+/g, "").length : 0;'
      + ' const duan = window.__siKaoDuan ? window.__siKaoDuan.qu(' + JSON.stringify(sid) + ').length : 0;'
      + ' return Math.max(zi, duan ? 61 : 0); })()');
    kanJian = Number(z) || 0;
  }
  console.log('  · 中断前看得见的内容长度=' + kanJian);
  jian('② 真的抓到了"正在吐字"的那一刻（界面上已经有内容才杀掉）', kanJian >= 60, '长度=' + kanJian);
  const metaLu = path.join(profile, 'chat-meta.json');
  /** 半成品挂在**哪个会话键**下不由我们规定（完成核对轮可能用别的 sid）⇒ 扫全部会话，按时间判，不猜键。 */
  const zhaoBanChengPin = () => {
    try {
      const j = JSON.parse(fs.readFileSync(metaLu, 'utf8'));
      for (const [k, v] of Object.entries(j.sessions || {})) {
        /** 判据是"文件里存着一份这一轮的半成品"，不是"它的时间戳必须晚于我记的那一秒"——
         *  渲染层的快照可能比这一轮的 user 消息早半秒（同一轮里先建了台账），卡时间戳会假红。 */
        if (v && v.jinXing && Number(v.jinXing.ts) >= shaMingAt - 60000) return { ...v.jinXing, _sid: k };
      }
    } catch { /* 还没落盘 */ }
    return null;
  };
  /** 写盘的节奏由渲染层的 2 秒节流 + 主进程的 800ms 防抖决定，真机上还会被模型停顿拖着；
   *  所以这里只给 40 秒的**等待窗口**，判据放到**杀掉之后**读文件 —— 那时启动 2 还没开始，
   *  文件里的半成品只可能是启动 1 写的，这才是"崩溃前已经落盘"的干净证据（边杀边读会跟防抖赛跑）。 */
  let dengChu = null;
  for (let i = 0; i < 20 && !dengChu; i++) {
    await daKa();
    dengChu = zhaoBanChengPin();
    if (!dengChu) await sleep(2000);
  }
  const shaShiYiWan = await js('window.__r38rs && window.__r38rs.res');
  jian('② 杀的那一刻这一轮确实还没写完（chatSend 还没回来；否则不是"中途被杀"，是仪器没抓到时机）', !shaShiYiWan, JSON.stringify(shaShiYiWan || null).slice(0, 120));
  await guan(child); child = null;
  const luoPan = dengChu || zhaoBanChengPin();
  const shenJiLu = (op) => { const f = path.join(profile, 'audit', 'audit.jsonl'); if (!fs.existsSync(f)) return []; return fs.readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => l.includes(op)); };
  console.log('  · 半成品写入审计=' + shenJiLu('chat.inflight-write').length + ' 次，最后一条=' + String(shenJiLu('chat.inflight-write').slice(-1)[0] || '').slice(0, 150));
  console.log('  · 杀掉后文件里的半成品：' + JSON.stringify(luoPan ? { sid: luoPan._sid, duan: (luoPan.reasoningDuan || []).length, zi: String(luoPan.content || '').length } : null).slice(0, 160));
  jian('② 中断前已把半成品落到 chat-meta.json（不落地就必定"全部消失"）', !!luoPan, 'meta在=' + fs.existsSync(metaLu));

  /* ══ 第二次开机（同一个 profile）：界面上到底还看得见什么 ══ */
  child = qiDong();
  if (!(await dengDuan())) { jian('第二次启动起得来', false, 'CDP 超时'); process.exit(1); }
  await sleep(6000);
  await lianJie();
  await js('(() => { const b = document.querySelector(\'[data-nav="singleAi"]\'); if (b) b.click(); return !!b; })()');
  await sleep(4000);
  /** 取证：日志侧到底带回了什么（模型/词元/分段/操作），别只靠界面猜 */
  const zhi = await js('window.warmy.chatMessages({ sessionId: ' + JSON.stringify(sid) + ' })');
  const qiDongTai = shenJiLu('chat.meta.loaded').concat(shenJiLu('chat.meta.merged'), shenJiLu('chat.history.restore'));
  console.log('  · 开机侧账：' + JSON.stringify(qiDongTai.slice(-4).map((l) => String(l).slice(0, 120))).slice(0, 520));
  console.log('  · 日志侧：' + JSON.stringify(((zhi && zhi.xiaoXiJi) || []).map((m) => ({
    r: String(m.role || '').slice(0, 3), len: String(m.text || '').length, mo: String(m.moXing || '').slice(0, 16),
    ci: Number(m.promptTokens || 0) + '/' + Number(m.completionTokens || 0), duan: (m.reasoningDuan || []).length,
    xd: (m.xingDong || []).length,
  }))).slice(0, 420));
  try {
    const j = JSON.parse(fs.readFileSync(metaLu, 'utf8'));
    console.log('  · 旁路文件：' + Object.entries(j.sessions || {}).map(([k, v]) => k + '{msgs:' + ((v && v.msgs) || []).length
      + ' 每条=' + ((v && v.msgs) || []).map((m) => (m.role === 'assistant' ? '[' + (String(m.moXing || '') ? '有模型' : '无模型') + (Number(m.promptTokens || 0) > 0 ? '+有词元' : '+无词元') + ']' : '')).join('')
      + ',xd:' + ((v && v.xingDong) || []).length + ',jin:' + (v && v.jinXing ? String(v.jinXing.content || '').length + '字' : '无') + '}').join(' ').slice(0, 400));
  } catch { /* 读不到就用界面判 */ }
  const hou = await js('(() => { const ti = [...document.querySelectorAll("[title]")].map((n) => String(n.getAttribute("title") || ""));'
    + ' return { sid: window.__r35 ? window.__r35.huiHua() : "",'
    + '   duan: document.querySelectorAll(".siKaoDuanKuai").length,'
    + '   cao: document.querySelectorAll(".xingDongHang").length,'
    + '   moXingTi: ti.filter((s) => /模型/.test(s)).length,'
    + '   ciShu: ti.filter((s) => /输入\\d+，输出\\d+/.test(s)).length,'
    + '   baoZhi: document.querySelectorAll(".zhongDuanBaoZhi").length,'
    + '   anNiu: document.querySelectorAll(".huiFuRenWuBtn:not([disabled])").length }; })()');
  console.log('  · 重启后现场：' + JSON.stringify(hou).slice(0, 260));
  jian('② 重启后还是那一只会话', String(hou.sid || '') === sid, 'sid2=' + hou.sid);
  jian('项8 重启后「执行过程」还在（操作行 >0，以前重开就空白）', Number(hou.cao) >= 1, JSON.stringify(hou).slice(0, 200));
  jian('项8 重启后回复下方仍带着所用模型与词元（悬停信息不是空的）',
    Number(hou.moXingTi) >= 1 && Number(hou.ciShu) >= 1, JSON.stringify(hou).slice(0, 200));
  jian('项2 被中断那一轮的思考/中间回复没消失：界面上出现「中断保留」块', Number(hou.baoZhi) >= 1, JSON.stringify(hou).slice(0, 200));
  jian('项2 界面认出这一轮被打断并点亮「继续 / 重试」', Number(hou.anNiu) >= 1, JSON.stringify(hou).slice(0, 200));

  /* 按钮不是摆设：点下去真的接着跑 */
  const dian = await js('(() => { const b = document.querySelector(\'.huiFuRenWuBtn:not([disabled])\'); if (!b) return false; b.click(); return true; })()');
  let youDong = false;
  for (let i = 0; i < 20 && !youDong; i++) {
    await daKa();
    await sleep(3000);
    youDong = !!(await js('!!document.querySelector(\'[data-streaming="1"]\')'));
  }
  jian('项2 「继续 / 重试」点下去真的会跑（界面出现流式气泡），不是个死按钮', dian === true && youDong, '点=' + JSON.stringify(dian) + ' 动了=' + youDong);
} finally {
  try { if (c) c.close(); } catch { /* noop */ }
  await guan(child);
  if (!process.argv.includes('--keep')) {
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
  } else console.log('  · 保留 profile：' + profile);
}
console.log(`\n==== verify-round38-restart：${ok} ok / ${shi.length} FAIL ====`);
for (const s of shi) console.log('  FAIL ' + s);
process.exit(shi.length ? 1 : 0);
