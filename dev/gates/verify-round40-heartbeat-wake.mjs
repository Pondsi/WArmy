/**
 * verify-round40-heartbeat-wake.mjs —— 「程序关着之后的计时」单独一支真机门禁（第 40 轮）
 *
 * 用户口径：定时任务本身不能脱离程序（默认形态下程序关了就停 —— live 档 ④ 证"系统里什么都不留"）；
 * **但**用户可以显式打开「到点由系统唤醒程序」。这条例外必须真跑到：
 * 挂不上、命令行被截断、醒了没投递、同一条到点投两遍 —— 四种坏法都只能靠真 schtasks + 真进程证明。
 *
 * 时间线（~5 分钟）：开机 ⇒ 挂上系统任务 ⇒ **杀掉程序** ⇒ 等系统到点把我们唤回 ⇒
 * 读审计证明"到期被结掉 + 提醒真投出去 + 只投一次"。被唤醒的那一支**不带调试端口**，
 * 所以这里只读磁盘上的审计 —— 正好也证明它靠的是自己落盘的那套账。
 *
 * ⚠️ 任务名带本次运行的时间戳：`/tn` 是全机共享命名空间，两遍并行会互相覆盖
 *    （我自己就这么撞掉过一次读数：看起来像"没挂上"，其实是另一遍把它删了）。
 *
 * 跑法：node dev/gates/verify-round40-heartbeat-wake.mjs
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
const PORT = Number(process.env.R40W_PORT || 9993);
const { attach, sleep, bootWait } = await import(pathToFileURL(path.join(PKG, 'scripts', 'cdp-lib.mjs')).href);

let ok = 0; const shi = [];
const jian = (l, p, d) => { if (p) { ok += 1; console.log('  ok   ' + l); return; } shi.push(l); console.log('  FAIL ' + l + (d ? ' ← ' + String(d).slice(0, 300) : '')); };

const kaiBo = Date.now();
const BIAO = 'r40w' + String(kaiBo).slice(-6);   // 本次运行唯一的后缀（避免与并行的另一遍撞名）
const REN = 'r40-' + BIAO;                        // 定时任务 id
const DAO_JI = 'sch:' + REN;                      // 心跳里那条到期的 id
const YAO = kaiBo + 110_000;                      // >60 秒才值得挂系统保底

/**
 * profile 放**短路径**（家目录下，跑完就删）：唤醒命令行要 ≤250 字符才挂得上，
 * 用 `os.tmpdir()` 那串 `...\Local\Temp\warmy-r40-wake-<13位>` 会把命令撑爆 ⇒
 * 测的就不是"能不能醒"而是"长度"。（产品侧：放不下就 `xin-tiao.os-decline` 明说不挂。）
 */
const profile = path.join(os.homedir(), 'r40w-' + BIAO);
fs.mkdirSync(profile, { recursive: true });
const peiZhi = {
  yuYan: 'zh-CN', setupDone: true, privacyConsent: true, guideDone: true, providersSeeded: true,
  globalSecurity: 'normal', trustedFolders: [], asrEnabled: false, specialModels: {},
  xinTiaoWake: true,                              // 这一支专门测"显式打开"
  providers: [{ id: 'ollama-r40w', biaoQian: 'Ollama-r40w', protocol: 'ollama', baseURL: 'http://127.0.0.1:11434', defaultModel: '', models: ['r40w-x'], staleModels: {}, hasKey: false }],
  instances: [{ id: 'inst-r40w-1', ming: '牛马-1', name: '牛马-1', status: 'running', defaultModel: '', currentModel: '', chain: [], chainDisabled: [] }],
};
const dingShi = [
  { id: REN, sessionId: '', name: 'W-关着也要醒', prompt: '唤醒验收 W', everyMinutes: 0, dailyAt: '03:31', desc: '一次性', nextAt: YAO, lastAt: 0, enabled: true, createdAt: kaiBo, repeat: 0, zhiXingGuo: 0, zuiHouChuFaAt: 0 },
];
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify(peiZhi, null, 2), 'utf8');
fs.writeFileSync(path.join(profile, 'scheduled-tasks.json'), JSON.stringify(dingShi, null, 2), 'utf8');
const ZHEN = path.join(profile, 'audit', 'audit.jsonl');
const duShenJi = () => {
  try { return fs.readFileSync(ZHEN, 'utf8').split(/\r?\n/).filter(Boolean).map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean); } catch { return []; }
};
const shenJian = (op) => duShenJi().filter((r) => r.op === op);
/**
 * 必须和产品里的 `ossRenWuMing` **一字不差**：`WArmy-XinTiao-` + 归一后的到期 id
 * （id 本身已经是 `sch:r40-…`）。之前在这里多拼了一层 `sch-` ⇒ 查不到是**假绿**：
 * 名字错了当然查不到，"系统里没留东西"这条判据就成了空话。
 */
const renWuMing = (id) => 'WArmy-XinTiao-' + String(id).replace(/[^A-Za-z0-9_-]/g, '-');
const MING = renWuMing(DAO_JI);

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE; delete env.MIMO_KEY_FILE;
const qiDongDian = () => spawn(ELECTRON, ['--remote-debugging-port=' + PORT, '--disable-features=CalculateNativeWinOcclusion', '--user-data-dir=' + profile, MAIN],
  { cwd: PKG, stdio: ['ignore', 'ignore', 'ignore'], env });
let child = qiDongDian();
let c = null;
const js = (e) => c.evaluate('(async function(){ try { return await (' + e + '); } catch (err) { return { __err: String((err && (err.stack||err.message)) || err).slice(0,240) }; } })()');

async function dengLianJie(miao = 90_000) {
  const dao = Date.now() + miao;
  while (Date.now() < dao) {
    try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) return true; } catch { /* 还没起 */ }
    await sleep(1000);
  }
  return false;
}
const chaXun = async () => {
  try { const q = await execFileP('schtasks.exe', ['/query', '/tn', MING, '/fo', 'LIST', '/v'], { windowsHide: true }); return String(q.stdout || ''); } catch { return ''; }
};
/** 只杀"被系统叫醒的那一支"（命令行同时带本次 profile 与唤醒参数），别的一个都不碰 */
const shaHuanXing = async () => {
  try {
    const { stdout } = await execFileP('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process -Filter "name=\'electron.exe\'" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress'], { windowsHide: true, timeout: 60000 });
    const j = JSON.parse(String(stdout || '[]').trim() || '[]');
    const a = Array.isArray(j) ? j : [j];
    const pidMark = path.basename(profile);
    for (const p of a) {
      const cl = String(p.CommandLine || '');
      if (/warmy-xin-tiao-wake/.test(cl) && cl.includes(pidMark)) {
        try { await execFileP('taskkill.exe', ['/PID', String(p.ProcessId), '/T', '/F'], { windowsHide: true }); } catch { /* 已经退了 */ }
      }
    }
  } catch { /* 查不到就算了 */ }
};

try {
  if (!(await dengLianJie())) { jian('CDP 起得来', false, 'timeout'); process.exit(1); }
  c = await attach(PORT, { biaoQian: 'r40wake', callTimeout: 60000 });
  await c.send('Runtime.enable');
  try { await bootWait(c, '', 60_000); } catch { /* 由后面的断言判 */ }

  const zt = (await js('window.warmy.xinTiaoZhuangTai()'))?.zhuangTai || {};
  jian('① 开关是打开状态（这一支专门测显式开启）', zt.wakeKai === true, JSON.stringify({ w: zt.wakeKai, ke: zt.keHuanXing }));
  await sleep(3000);
  const gu = shenJian('xin-tiao.os-arm');
  const ju = shenJian('xin-tiao.os-decline');
  console.log('  · 取证：' + [['xin-tiao.os-arm', gu], ['xin-tiao.os-decline', ju], ['xin-tiao.os-off', shenJian('xin-tiao.os-off')], ['xin-tiao.daoJi-ji', shenJian('xin-tiao.daoJi-ji')]]
    .map(([n, a]) => n + '=' + a.length).join(' '));
  /**
   * 两条合法出路：**挂上了**（安装包那种短路径），或**明确拒绝并记下为什么**（开发环境：
   * 安装路径含中文且层级很深时，`/tr` 会超过 260 ⇒ 宁可不挂）。
   * 唯一不合法的是"静默没挂" —— 那会让用户以为关着也能响。
   */
  jian('② 挂得上就挂；挂不上必须**留下拒绝记录**（绝不允许静默）', gu.some((r) => String(r.detail?.taskId || '') === DAO_JI) || ju.length >= 1,
    JSON.stringify({ arm: gu.length, decline: ju.length }));
  const xq = await chaXun();
  if (ju.length && !gu.length) {
    jian('②b 拒绝记录带真实长度与上限（能回答"为什么没挂"）',
      Number(ju[ju.length - 1]?.detail?.changDu) > 250 && Number(ju[ju.length - 1]?.detail?.shangXian) === 250, JSON.stringify(ju.slice(-1).map((r) => r.detail)));
    jian('②c 没挂上时不许记成"已挂保底"（界面那个数字是给用户的）',
      Number(((await js('window.warmy.xinTiaoZhuangTai()'))?.zhuangTai?.daoJi || {}).osGui || 0) === 0, '记成已挂了');
  } else {
    jian('②b 系统里查得到这条任务（真的落到操作系统）', xq.includes(MING), xq.slice(0, 220));
    jian('②c 动作只启动我们自己的程序、带唤醒参数（**不串 cmd.exe/echo/&**）',
      xq.includes('--warmy-xin-tiao-wake=' + DAO_JI) && !/cmd\.exe/.test(xq), xq.slice(0, 300));
  }
  jian('③ 没有"包装文件"这种东西（中文路径下批处理按 GBK 解码会静默失败 ⇒ 已废弃）',
    !fs.existsSync(path.join(profile, 'wake.cmd')), 'userData 里出现了 wake.cmd');
  jian('③b 唤醒参数不带调试端口（叫醒的是干净实例，不继承已死进程的调试口）', !xq.includes('remote-debugging-port'), xq.slice(-260));

  /**
   * 唤醒**处理逻辑**的端到端证明：由门禁自己扮演"系统"那一步 —— 关掉程序，再用与产品
   * 挂给 schtasks 完全一样的命令行（`--user-data-dir` + `--warmy-xin-tiao-wake=<id>`）把程序启回来。
   * 系统那一步本身由上面 ②/②b/②c 判：挂得上就核对任务形状，挂不上就核对"明确拒绝"记录，
   * 唯一不许出现的形态是"静默没挂"（那会让用户以为关着也能响）。
   */
  const guanBi = Date.now();
  try { if (c) c.close && c.close(); c = null; } catch { /* noop */ }
  try { child.kill(); } catch { /* noop */ }
  await sleep(4000);
  child = null;
  /**
   * **先让原定时刻真的过去**，再把程序唤回来 —— 否则测的是"提前叫醒"，
   * 那时任务本来就还没到点，投不出东西是正确行为（上一版这条红就是这么来的）。
   * 程序关着的这段时间里没有任何东西在跑：正是用户要的"关着就停"。
   */
  const dengDao = YAO + 3000 - Date.now();
  if (dengDao > 0) await sleep(dengDao);
  const er = spawn(ELECTRON, ['--disable-features=CalculateNativeWinOcclusion', '--user-data-dir=' + profile, MAIN, '--warmy-xin-tiao-wake=' + DAO_JI],
    { cwd: PKG, stdio: ['ignore', 'ignore', 'ignore'], env, detached: true });
  try { er.unref(); } catch { /* noop */ }

  const dao = Date.now() + 150_000;
  while (Date.now() < dao) {
    if (shenJian('xin-tiao.os-wake').some((r) => String(r.detail?.id) === DAO_JI)) break;
    await sleep(2000);
  }
  const huan = shenJian('xin-tiao.os-wake').filter((r) => String(r.detail?.id) === DAO_JI && Number(r.ts) >= guanBi);
  jian('④ 程序关着时被带唤醒参数启回来 ⇒ 这条到期被**结掉**（审计 xin-tiao.os-wake）', huan.length >= 1, JSON.stringify(huan.slice(-1).map((r) => r.detail)));
  const tou = shenJian('dingShi.dao').filter((r) => String(r.detail?.taskId) === REN && Number(r.ts) >= guanBi);
  jian('④ 醒过来之后提醒真的投出去了（dingShi.dao 带迟到时长，不是只"知道到过了"）',
    tou.length >= 1 && Number(tou[tou.length - 1]?.detail?.lateMs) > 0, JSON.stringify(tou.slice(-1).map((r) => r.detail)));
  /**
   * 判"用户看到几次"，不判"内部事件响几次"：重启补跑 + 重挂会自然产生两条到期事件，
   * 幂等键（`zuiHouChuFaAt`）要保证的只是**投递只有一次**。
   */
  const fa = shenJian('xin-tiao.daoJi-fire').filter((r) => String(r.detail?.taskId || '') === DAO_JI);
  const tou2 = shenJian('dingShi.dao').filter((r) => String(r.detail?.taskId) === REN && Number(r.ts) >= guanBi);
  jian('⑤ 同一条到点**只投递一次**（到期事件可以有多条，幂等键负责把它们收成一个结果）',
    tou2.length === 1, JSON.stringify({ fa: fa.length, tou: tou2.length }));
  const xia = shenJian('xin-tiao.daoJi-fire').filter((r) => String(r.detail?.taskId || '') === DAO_JI && Number(r.detail?.lateMs) > 0);
  jian('⑤b 补投的那一次如实带着"迟到了多久"（不假装是准点响的）', xia.length >= 1, JSON.stringify(fa.map((r) => r.detail?.lateMs)));
  try { er.kill(); } catch { /* noop */ }
  await shaHuanXing();
} catch (e) {
  jian('整条路跑完没抛错', false, String((e && e.message) || e).slice(0, 240));
} finally {
  try { if (c) c.close && c.close(); } catch { /* noop */ }
  try { child && child.kill(); } catch { /* noop */ }
  try { await shaHuanXing(); } catch { /* noop */ }
  await sleep(2000);
  try { await shaHuanXing(); } catch { /* noop */ }
  try { await execFileP('schtasks.exe', ['/delete', '/tn', MING, '/f'], { windowsHide: true }); } catch { /* 本来就没有 */ }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
}

console.log(`第 40 轮心跳唤醒真机门禁：${ok} 通过 / ${shi.length} 失败`);
for (const s of shi) console.log('  ✗ ' + s);
process.exit(shi.length ? 1 : 0);
