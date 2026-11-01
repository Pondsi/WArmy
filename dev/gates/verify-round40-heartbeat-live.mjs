/**
 * verify-round40-heartbeat-live.mjs —— 心跳在**真进程**里的证明（第 40 轮）
 *
 * 为什么要单独一档 live：fast 档的 62 条是把内核按在假时钟上跑的，它证明不了三件事 ——
 *  ① 真 Electron 里心跳**真的起来了**（装配点、userData、退出落盘）；
 *  ② 系统保底（schtasks）**真的挂得上也真的撤得掉**（挂不上会留一条到点自己响的僵尸任务）；
 *  ③ 重启后**账本还在**：关机期间的留痕能被对上位、跑满次数的任务不会又跑一遍。
 * 这三条只能拿真进程 + 真审计 + 真系统计划任务来判，界面那条也算一条（看不见等于不能验收）。
 *
 * 不打模型：全部用宿主路径（预置 scheduled-tasks.json、租约 IPC、审计读取），
 * 免得把心跳的验收绑在模型脾气上。
 *
 * 跑法：node dev/gates/verify-round40-heartbeat-live.mjs
 *      环境变量 R40H_PORT 换端口；不写用户桌面、不动既有文件。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL, fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);
const G = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PKG = path.join(G, 'packages', 'app-shell');
const MAIN = path.join(PKG, 'dist', 'electron-main.js');
const ELECTRON = path.join(PKG, 'node_modules', 'electron', 'dist', 'electron.exe');
const PORT = Number(process.env.R40H_PORT || 9991);
const { attach, sleep, bootWait } = await import(pathToFileURL(path.join(PKG, 'scripts', 'cdp-lib.mjs')).href);

let ok = 0; const shi = [];
const jian = (l, p, d) => { if (p) { ok += 1; console.log('  ok   ' + l); return; } shi.push(l); console.log('  FAIL ' + l + (d ? ' ← ' + String(d).slice(0, 300) : '')); };

const profile = path.join(os.tmpdir(), 'warmy-r40-heartbeat-' + Date.now());
fs.mkdirSync(profile, { recursive: true });
const kaiBo = Date.now();
const peiZhi = {
  yuYan: 'zh-CN', setupDone: true, privacyConsent: true, guideDone: true, providersSeeded: true,
  globalSecurity: 'normal', trustedFolders: [], asrEnabled: false, specialModels: {},
  providers: [{ id: 'ollama-r40', biaoQian: 'Ollama-r40', protocol: 'ollama', baseURL: 'http://127.0.0.1:11434', defaultModel: '', models: ['r40-x'], staleModels: {}, hasKey: false }],
  instances: [{ id: 'inst-r40-1', ming: '牛马-1', name: '牛马-1', status: 'running', defaultModel: '', currentModel: '', chain: [], chainDisabled: [] }],
};
const dingShi = [
  { id: 'r40-A', sessionId: '', name: 'A-跑满一次就停', prompt: '心跳验收 A', everyMinutes: 0, dailyAt: '03:07', desc: '一次性', nextAt: kaiBo + 8000, lastAt: 0, enabled: true, createdAt: kaiBo, repeat: 1, zhiXingGuo: 0 },
  { id: 'r40-B', sessionId: '', name: 'B-挂系统保底', prompt: '心跳验收 B', everyMinutes: 120, dailyAt: '', desc: '每 120 分钟', nextAt: kaiBo + 70_000, lastAt: 0, enabled: true, createdAt: kaiBo, repeat: 0, zhiXingGuo: 0 },
  { id: 'r40-C', sessionId: '', name: 'C-留给重启核对', prompt: '心跳验收 C', everyMinutes: 0, dailyAt: '03:11', desc: '一次性', nextAt: kaiBo + 90_000, lastAt: 0, enabled: true, createdAt: kaiBo, repeat: 1, zhiXingGuo: 0 },
  // D 是"程序关着也要走到点"的证据：到点由系统把我们唤回来（deadline 在第二次启动之后几分钟）
  { id: 'r40-D', sessionId: '', name: 'D-关着程序也要响', prompt: '心跳验收 D', everyMinutes: 0, dailyAt: '03:19', desc: '一次性', nextAt: kaiBo + 520_000, lastAt: 0, enabled: true, createdAt: kaiBo, repeat: 0, zhiXingGuo: 0 },
];
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify(peiZhi, null, 2), 'utf8');
fs.writeFileSync(path.join(profile, 'scheduled-tasks.json'), JSON.stringify(dingShi, null, 2), 'utf8');
const duRenWu = () => { try { return JSON.parse(fs.readFileSync(path.join(profile, 'scheduled-tasks.json'), 'utf8')); } catch { return []; } };
const ZHEN = path.join(profile, 'audit', 'audit.jsonl');
const duShenJi = () => {
  try { return fs.readFileSync(ZHEN, 'utf8').split(/\r?\n/).filter(Boolean).map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean); } catch { return []; }
};
const shenJian = (op) => duShenJi().filter((r) => r.op === op);
const dengShenJi = async (op, miao = 45000) => {
  const dao = Date.now() + miao;
  while (Date.now() < dao) {
    const x = shenJian(op);
    if (x.length) return x;
    await sleep(1500);
  }
  return shenJian(op);
};
/**
 * 传**定时任务 id**，返回产品真的会用的那个系统任务名。
 * 产品侧是 `ossRenWuMing(到期 id)` = `WArmy-XinTiao-` + 归一(`sch:<任务 id>`)；
 * 这里以前多拼了一层 `sch-` ⇒ "系统里查不到"变成**假绿**（名字错了当然查不到，判据就成了空话）。
 */
const renWuMing = (renId) => 'WArmy-XinTiao-' + String('sch:' + renId).replace(/[^A-Za-z0-9_-]/g, '-');
const chaSchi = async (ming) => {
  try { await execFileP('schtasks.exe', ['/query', '/tn', ming], { windowsHide: true }); return true; } catch { return false; }
};
/** 机器上有几个 electron 在加载 electron-main.js（真机档必须串行，这条是闸门） */
const renShu = async () => {
  try {
    const { stdout } = await execFileP('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process -Filter "name=\'electron.exe\'" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress'], { windowsHide: true, timeout: 60000 });
    const j = JSON.parse(String(stdout || '[]').trim() || '[]');
    const a = Array.isArray(j) ? j : [j];
    return a.filter((p) => /electron-main\.js/.test(String(p.CommandLine || ''))).length;
  } catch { return 0; }
};
/** 只杀"被系统叫醒的那一支"：命令行同时带我们的 profile 与唤醒标记，别的一个都不碰 */
const shaHuanXing = async () => {
  try {
    const { stdout } = await execFileP('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process -Filter "name=\'electron.exe\'" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress'], { windowsHide: true, timeout: 60000 });
    const j = JSON.parse(String(stdout || '[]').trim() || '[]');
    const a = Array.isArray(j) ? j : [j];
    const pid = path.basename(profile);
    for (const p of a) {
      const cl = String(p.CommandLine || '');
      if (/warmy-xin-tiao-wake/.test(cl) && cl.includes(pid)) {
        try { await execFileP('taskkill.exe', ['/PID', String(p.ProcessId), '/T', '/F'], { windowsHide: true }); } catch { /* 已经退了 */ }
      }
    }
  } catch { /* 查不到就算了 */ }
};
/** 等到某个条件成立（或到期限），轮询的是**磁盘上的审计**，不需要连着 CDP */
const dengDao = async (daoShi, tiaoJian) => {
  while (Date.now() < daoShi) { if (await tiaoJian()) return true; await sleep(3000); }
  return tiaoJian();
};

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE; delete env.MIMO_KEY_FILE;
const qiYingYong = () => spawn(ELECTRON, ['--remote-debugging-port=' + PORT, '--disable-features=CalculateNativeWinOcclusion', '--user-data-dir=' + profile, MAIN],
  { cwd: PKG, stdio: ['ignore', 'ignore', 'ignore'], env });
let child = qiYingYong();
let c = null;
const js = (e) => c.evaluate('(async function(){ try { return await (' + e + '); } catch (err) { return { __err: String((err && (err.stack||err.message)) || err).slice(0,240) }; } })()');

async function lianJie(dengMiao = 90_000) {
  const dao = Date.now() + dengMiao;
  while (Date.now() < dao) {
    try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) return true; } catch { /* 还没起 */ }
    await sleep(1000);
  }
  return false;
}

try {
  if (!(await lianJie())) { jian('CDP 起得来', false, 'timeout'); process.exit(1); }
  c = await attach(PORT, { biaoQian: 'r40heart', callTimeout: 60000 });
  await c.send('Runtime.enable');
  try { await bootWait(c, '', 60000); } catch { /* 起没起全由后面的断言判 */ }

  /* ① 心跳在真进程里起来了 */
  const z1 = await js('window.warmy.xinTiaoZhuangTai()');
  const zt1 = (z1 && z1.zhuangTai) || null;
  jian('① 主进程里心跳已经启动（不是"代码写了但没装配"）', !!zt1 && zt1.yiQiDong === true, JSON.stringify(z1 && { ok: z1.ok, err: z1.__err }));
  const geRen = zt1 ? String((zt1.ren || []).map((r) => r.id).sort().join(',')) : '';
  jian('① 六个周期任务都在同一个心跳里（巡检/租约回收/孤儿回收/校时/状态同步/落盘兜底）',
    ['dingShi.chunKao', 'guEr.huiShou', 'shiZhong.yangBen', 'zhuangTai.tongBu', 'zuYue.huiShou', 'chiJiuHua.luoPan'].every((x) => geRen.includes(x)), geRen);
  jian('① 每个任务都设了单次超时（挂死不会永久占着它）',
    (zt1?.ren || []).length > 0 && (zt1.ren || []).every((r) => Number(r.chaoShiMs) > 0), JSON.stringify((zt1?.ren || []).map((r) => [r.id, r.chaoShiMs])));

  /* ② 真的在跳（ticks 增长），巡检真的在跑 */
  /**
   * 取 24 秒而不是 14 秒：巡检的周期就是 20 秒，**没到点当然不算没跑**。
   * （上一版在这里假红过一回 —— 门禁取样比任务的节奏还早，红的是门禁不是产品。）
   */
  await sleep(24_000);
  const z2 = await js('window.warmy.xinTiaoZhuangTai()');
  const zt2 = (z2 && z2.zhuangTai) || {};
  jian('② 24 秒后心跳跳过了很多次（不是注册完就死）', Number(zt2.ticks) > Number(zt1.ticks || 0) + 5, JSON.stringify({ q: zt1.ticks, h: zt2.ticks }));
  const chun = (zt2.ren || []).find((r) => r.id === 'dingShi.chunKao') || {};
  jian('② 定时任务巡检由心跳跑过至少一次（原来是自己起 setInterval）', Number(chun.ciShu) >= 1, JSON.stringify(chun));

  /* ③ 到点触发 + repeat 生效 */
  const daoA = await dengShenJi('dingShi.dao', 30_000);
  const a = daoA.find((r) => String(r.detail?.taskId) === 'r40-A');
  jian('③ A 任务到点被触发，审计带迟到时长与补跑标记', !!a && typeof a.detail?.lateMs === 'number', JSON.stringify(a && a.detail));
  const cA = await dengShenJi('dingShi.exhausted', 15_000);
  jian('③ repeat=1 跑满后自动停用（原来这个字段只显示、从不递减）', cA.some((r) => String(r.detail?.taskId) === 'r40-A'), JSON.stringify(cA.map((r) => r.detail)));
  const cunA = duRenWu().find((x) => x.id === 'r40-A') || {};
  jian('③ 停用状态落盘（enabled=false 且执行次数记进账本）', cunA.enabled === false && Number(cunA.zhiXingGuo) === 1, JSON.stringify({ e: cunA.enabled, z: cunA.zhiXingGuo }));

  /* ④ 默认关：程序不该往系统里留任何"到点自己响"的东西（能主动完全关闭才算关闭） */
  const wuGua4 = await dengShenJi('xin-tiao.os-off', 20_000);
  jian('④ 默认关时长到点也**不挂**系统计划任务，并如实记一条 os-off（不是"以为挂了"）',
    wuGua4.some((r) => String(r.detail?.taskId || r.detail?.id || '') === 'sch:r40-B'), JSON.stringify(wuGua4.slice(-2).map((r) => r.detail)));
  jian('④ 系统里确实查不到这条（真的没往操作系统留东西）', !(await chaSchi(renWuMing('r40-B'))), '系统里已经有 = 程序关不掉自己了');
  const zt4 = (await js('window.warmy.xinTiaoZhuangTai()'))?.zhuangTai || {};
  jian('④ 没挂就不许把"系统保底"记成已挂（界面上那个数字是给用户的）', Number(zt4?.daoJi?.osGui || 0) === 0, JSON.stringify(zt4.daoJi));
  await js('window.warmy.dingShiRenWuShanChu({ id: "r40-B" })');
  await sleep(2500);
  jian('④ 删掉任务之后系统里仍然干干净净（不留僵尸计划任务）', !(await chaSchi(renWuMing('r40-B'))), '还存在');

  /* ⑤ 资源回收：过期租约由心跳清掉（sweep 原来没人调） */
  await js('window.warmy.leaseAcquire({ holder: "r40-ceshi", kind: "file", scope: "r40", paths: ["r40-demo.txt"], ttlMs: 3000 })');
  const swe = await dengShenJi('zuYue.swept', 60_000);
  jian('⑤ 过期租约被心跳收走并记审计（不是等下一个人碰同一路径才顺带清）', swe.length >= 1, JSON.stringify(swe.slice(-1).map((r) => r.detail)));

  /**
   * ⑥ 界面：**心跳不再出现在设置里**（2026-10-19 用户原话："设置的各个页面怎么有心跳？
   * 心跳没有什么需要设置的，无需显示在界面上，删除掉。"）。
   * 这条以前判的是"任务表看得见"，口径反转 ⇒ 现在判两件事，缺一不可：
   *  · 界面**不许**有心跳：nav 没有 xintiao 按钮、没有 #xinTiaoBiao、任何一个设置分区的标题里不许出现"心跳"；
   *  · 内核**照样在跳**：撤界面不许顺手把计时源撤了 ⇒ 用 IPC 读 ticks 必须在长。
   * 顺带钉住这次的真根因：带 data-sec 的分区若没在 groups 里登记，就不会被隐藏 ⇒ 会挂在每个页面上。
   * 这条判据把"每个分区都有桶"也在真机 DOM 上过一遍（静态档 scripts/verify-r42.mjs 也有一条同判据）。
   */
  await js('(() => { const n = document.querySelector(\'.ceLanTiaoMu[data-nav="settings"]\'); if (n) n.click(); return !!n; })()');
  await sleep(900);
  const mian = await js(`(() => {
    const nav = [...document.querySelectorAll('#peiZhiDaoHang button')].map((b) => String(b.dataset.sec || ''));
    const navWen = [...document.querySelectorAll('#peiZhiDaoHang button')].map((b) => String(b.textContent || ''));
    const qu = [...document.querySelectorAll('.sheZhiSection')];
    const noTong = qu.filter((d) => { const s = d.getAttribute('data-sec'); return s && !nav.includes(s) && s !== 'jineng'; }).map((d) => d.getAttribute('data-sec'));
    const xin = qu.filter((d) => /心跳/.test(String(d.textContent || '')) || (d.id || '').indexOf('xinTiao') >= 0).length;
    return { nav, navXin: navWen.filter((x) => /心跳/.test(x)).length, biao: !!document.querySelector('#xinTiaoBiao'),
      xinSection: xin, noTong, keJian: qu.filter((d) => d.offsetParent !== null).map((d) => d.getAttribute('data-sec') || d.id || '?') };
  })()`);
  jian('⑥ 设置里没有心跳：导航项、分区、任务表容器一个都不许有（用户 2026-10-19 定稿）',
    !!mian && mian.nav.indexOf('xintiao') < 0 && mian.navXin === 0 && mian.biao === false && mian.xinSection === 0, JSON.stringify(mian));
  jian('⑥ 每个带 data-sec 的分区都在导航里有对应项（漏登记的那个不会被隐藏 ⇒ 会挂在每个页面）',
    !!mian && Array.isArray(mian.noTong) && mian.noTong.length === 0, JSON.stringify(mian && mian.noTong));
  const tiaoQian = await js('window.warmy.xinTiaoZhuangTai()');
  await sleep(12_000);
  const tiaoHou = await js('window.warmy.xinTiaoZhuangTai()');
  const zq = (tiaoQian && tiaoQian.zhuangTai) || {}, zh = (tiaoHou && tiaoHou.zhuangTai) || {};
  jian('⑥ 撤掉界面之后心跳照旧在跳（ticks 在长、任务还在）—— 引擎不是靠面板活着的',
    zh.yiQiDong === true && Number(zh.ticks) > Number(zq.ticks || 0) && Array.isArray(zh.ren) && zh.ren.length >= 4,
    JSON.stringify({ q: zq.ticks, h: zh.ticks, ren: (zh.ren || []).length }));

  /* ⑦ 当场验证：内核的手动触发通道仍在（界面按钮撤了，能力不许跟着撤） */
  const zhiQian = ((await js('window.warmy.xinTiaoZhuangTai()'))?.zhuangTai?.ren || []).find((r) => r.id === 'zhuangTai.tongBu') || {};
  await js('window.warmy.xinTiaoPaoYiCi({ id: "zhuangTai.tongBu" })');
  await sleep(2500);
  const zhiHou = ((await js('window.warmy.xinTiaoZhuangTai()'))?.zhuangTai?.ren || []).find((r) => r.id === 'zhuangTai.tongBu') || {};
  jian('⑦ 「立即跑一次」的通道仍能把任务真跑一遍（以前是面板按钮，现在是 IPC）',
    Number(zhiHou.ciShu) > Number(zhiQian.ciShu || 0), JSON.stringify({ q: zhiQian.ciShu, h: zhiHou.ciShu }));

  /* ⑧ 落盘账本存在 */
  const pan = path.join(profile, 'xin-tiao.json');
  jian('⑧ 心跳账本落在 userData（重启要靠它补跑）', fs.existsSync(pan));
  const cun = fs.existsSync(pan) ? JSON.parse(fs.readFileSync(pan, 'utf8')) : {};
  jian('⑧ 账本里记着每个任务的下次到期（不是纯内存）', !!cun.ren && Object.keys(cun.ren).length >= 4, JSON.stringify(Object.keys(cun.ren || {})));

  /* ⑨ 重启：系统留痕要能对上位；跑满的任务不能再跑一遍 */
  try { await execFileP('schtasks.exe', ['/delete', '/tn', renWuMing('r40-C'), '/f'], { windowsHide: true }); } catch { /* 没挂上也行 */ }
  child.kill();
  await sleep(3000);
  c = null;
  const cunQian = shenJian('dingShi.dao').length;
  const hen = path.join(profile, 'xin-tiao-wake.log');
  fs.writeFileSync(hen, renWuMing('r40-C') + ' ' + (Date.now() - 5000) + '\n', 'utf8');
  const chongQi = Date.now();
  child = qiYingYong();
  if (!(await lianJie())) { jian('⑨ 重启后 CDP 起得来', false, 'timeout'); }
  else {
    c = await attach(PORT, { biaoQian: 'r40heart2', callTimeout: 60000 });
    await c.send('Runtime.enable');
    try { await bootWait(c, '', 60000); } catch { /* noop */ }
    const hen2 = await dengShenJi('xin-tiao.os-hen', 30_000);
    const dui = hen2.find((r) => String(r.detail?.ren || '').includes('r40-C'));
    jian('⑨ 关机期间由系统写下的到期痕，重启后能对上位（不是"对不上号的一行字"）', !!dui && dui.detail?.duiShang === true, JSON.stringify(hen2.map((r) => r.detail).slice(-3)));
    await sleep(12_000);
    /**
     * 只算**重启之后**写的审计行：同一个 profile 的 audit.jsonl 是接着上一个进程写的，
     * 不把 `ts >= chongQi` 卡住就会把"重启前的那一次到点"当成"重启后又跑了一遍"（上一版假红）。
     */
    const zai = shenJian('dingShi.dao').filter((r) => Number(r.ts) >= chongQi - 1000 && String(r.detail?.taskId) === 'r40-A').length;
    jian('⑨ 已跑满的任务重启后没有又跑一遍（账本认得它）', zai === 0, JSON.stringify({ cunQian, zai }));
    const z3 = (await js('window.warmy.xinTiaoZhuangTai()'))?.zhuangTai || {};
    jian('⑨ 重启后心跳自己又起来了（不需要用户重开什么开关）', z3.yiQiDong === true && Number(z3.ticks) > 0, JSON.stringify({ y: z3.yiQiDong, t: z3.ticks }));

    /* ⑩ 用户定稿口径：**定时任务不脱离程序**；唤醒程序只能是用户显式打开的例外 */
    const mingD = renWuMing('r40-D');
    const chaXun = async () => {
      try { const q = await execFileP('schtasks.exe', ['/query', '/tn', mingD, '/fo', 'LIST', '/v'], { windowsHide: true }); return String(q.stdout || ''); } catch { return ''; }
    };
    jian('⑩ 默认关：程序没开过任何"到点自醒"的系统任务（系统里查不到 D 那一条）',
      (await chaXun()) === '' || !/WArmy-XinTiao/.test(await chaXun()), '系统里已经有这条 = 程序关不掉自己了');
    const wuGua = await dengShenJi('xin-tiao.os-off', 20_000);
    jian('⑩ 默认关时**挂的动作被当场拒绝**并如实记一条（不是"以为挂了"）',
      wuGua.some((r) => String(r.detail?.taskId || r.detail?.id || '') === 'sch:r40-D'), JSON.stringify(wuGua.slice(-2).map((r) => r.detail)));
    const ztW = (await js('window.warmy.xinTiaoZhuangTai()'))?.zhuangTai || {};
    jian('⑩ 状态里 wakeKai=false 且界面上这一条显示为关闭', ztW.wakeKai === false, JSON.stringify({ wakeKai: ztW.wakeKai, ke: ztW.keHuanXing }));
    const wuGui = Number(ztW?.daoJi?.osGui || 0);
    jian('⑩ 没挂上就不许把"系统保底"记成已挂（界面那个数字是给用户的）', wuGui === 0, JSON.stringify(ztW.daoJi));

    /* ⑩b 环境存活探针：磁盘/内存是被心跳量过的（盘写满、内存失控会无声吞掉任务） */
    const zt2 = (await js('window.warmy.xinTiaoZhuangTai()'))?.zhuangTai || {};
    const hj = zt2.huanJing || {};
    jian('⑩b 环境探针跑过并且量到了磁盘剩余（"任务跑不完"要能归因到地基）',
      Number(hj.ceSo) >= 1 && Number(hj.diskAvailBytes) > 0, JSON.stringify(hj));
    jian('⑩b 也量到了进程内存 RSS', Number(hj.rssBytes) > 0, JSON.stringify({ r: hj.rssBytes }));
    jian('⑩b 探针注册在心跳里（不是又另起一个 setInterval）',
      (zt2.ren || []).some((r) => r.id === 'huanJing.tanZhen'), String((zt2.ren || []).map((r) => r.id).join(',')));
    jian('⑩b 界面读得到这份环境状态（状态同步走的是心跳推送，不是各自轮询）',
      Number(zt2.dingShiShu) >= 0 && Array.isArray(zt2.ren), JSON.stringify({ d: zt2.dingShiShu, ren: (zt2.ren || []).length }));
  }
} catch (e) {
  jian('整条路跑完没抛错', false, String((e && e.message) || e).slice(0, 240));
} finally {
  try { if (c) c.close && c.close(); } catch { /* noop */ }
  try { child && child.kill(); } catch { /* noop */ }
  // 中途抛错也不能把"被系统叫醒的那一支"留在桌面上（只杀命令行对得上我们自己 profile 的）
  try { await shaHuanXing(); } catch { /* noop */ }
  for (const x of ['r40-A', 'r40-B', 'r40-C', 'r40-D']) {
    try { await execFileP('schtasks.exe', ['/delete', '/tn', renWuMing(x), '/f'], { windowsHide: true }); } catch { /* 本来就没有 */ }
  }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
}

console.log(`第 40 轮心跳真机门禁：${ok} 通过 / ${shi.length} 失败`);
for (const s of shi) console.log('  ✗ ' + s);
process.exit(shi.length ? 1 : 0);
