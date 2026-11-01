/**
 * verify-round40-heartbeat.mjs —— 第 40 轮「心跳 = 全应用唯一计时源」的**行为**门禁
 *
 * 为什么必须跑到出结果：计时/额度这一类东西用 grep 断言毫无价值（第 39 轮的教训）。
 * 这里注入假时钟 + 假定时器，直接驱动 `packages/app-shell/dist/xin-tiao.js` 的**真内核**，
 * 断言的是"补跑了几次、迟到有没有留痕、会不会并发、坏了退避多少、时钟跳变说不说实话、
 * 等待准不准点、重启后关机期间的到期补没补"。
 *
 * 覆盖的口径（缺一条就要复发本轮要修的坏行为）：
 *  ① 一次 tick 最多补一次，但**如实记**合并掉几次错过（不刷屏也不静默吞）；
 *  ② 迟到超过宽限 ⇒ 跳过并累计，任务**不被丢掉**（下次照样排）；
 *  ③ 重入保护：上一轮没跑完绝不并发，完成后必须恢复；
 *  ④ 错误隔离 + 2 的幂退避：坏任务不拖垮同心跳的其他任务，也不消失；
 *  ⑤ 一次性到期：短等待不动用系统、长等待才挂系统保底；触发/撤销都要把系统那条收干净；
 *  ⑥ 落盘 + 重启补跑：关机期间到过点的事，重启后补触发并带原上下文与迟到时长；
 *  ⑦ 时钟不可信要如实说（回拨 / 隔很久没跳），不假装正常；
 *  ⑧ 等待走心跳且**准点**、可并发、可取消、0 秒不等待；
 *  ⑨ 心跳没起来时等待降级但不挂死，且降级要看得见；
 *  ⑩ 主进程接线：五个周期任务都注册进心跳、租约 sweep 真的被调、wait_seconds 走心跳、
 *     定时任务 repeat 真的递减、系统保底用 execFile 数组参数（不过 shell）且分钟**向上取整**。
 *
 * 跑法：node dev/gates/verify-round40-heartbeat.mjs
 */
import { chuangjianXinTiao } from '../../packages/app-shell/dist/xin-tiao.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const main = fs.readFileSync(path.join(root, 'packages/app-shell/src/electron-main.ts'), 'utf8');

let ok = 0;
const shi = [];
const jian = (ming, panding, xuan) => {
  if (panding) { ok += 1; return; }
  shi.push(ming + (xuan === undefined ? '' : '  ← ' + String(xuan).slice(0, 260)));
};

/* ── 假时钟 + 假定时器：不推进时间就什么都不发生，推进多少算多少 ── */
let now = 1_700_000_000_000;
const hs = new Map();
let hid = 0;
const zaoShiZhong = (ms, fn) => { const id = ++hid; hs.set(id, { at: now + ms, fn }); return id; };
const qingShiZhong = (h) => hs.delete(h);
function advance(ms) {
  const target = now + ms;
  for (;;) {
    let nx = null;
    for (const [id, t] of hs) if (t.at <= target && (!nx || t.at < nx[1].at)) nx = [id, t];
    if (!nx) break;
    now = Math.max(now, nx[1].at);
    hs.delete(nx[0]);
    nx[1].fn();
  }
  now = target;
}
const wei = () => new Promise((r) => setImmediate(r));
function mk(opts = {}) {
  const shi2 = [];
  const xt = chuangjianXinTiao({ now: () => now, danDiao: () => now, tiaoduMs: 2000, zaoShiZhong, qingShiZhong, onShiJian: (e) => shi2.push(e), ...opts });
  return { xt, shi: shi2 };
}

/* ① 错过合并 */
{
  const { xt } = mk();
  let pao = 0, last = null;
  xt.zhuCe({ id: 'a', ming: 'A', meiMs: 10_000, run: (ci) => { pao += 1; last = ci; } });
  xt.qiDong();
  advance(10_000);
  jian('① 到点跑第一次', pao === 1, 'pao=' + pao);
  xt.tingZhi();
  advance(35_000);
  xt.qiDong();
  const zt = xt.zhuangTai().ren.find((r) => r.id === 'a');
  jian('① 迟到 25 秒 ⇒ 一次 tick 只补跑一次（不刷屏）', pao === 2, 'pao=' + pao);
  jian('① 合并次数如实记 queGuoCiShu=3', last && last.queGuoCiShu === 3, JSON.stringify(last && { q: last.queGuoCiShu, t: last.tuoYanMs }));
  jian('① 补跑标明 buPao 与迟到时长（用户要看得见"这是补的"）', last && last.buPao === true && last.tuoYanMs === 25_000);
  jian('① 欠账累计进账本 queGuoZong', zt.queGuoZong >= 2, JSON.stringify({ q: zt.queGuoZong, c: zt.ciShu }));
  jian('① 补跑后按对齐周期排下一次（不越跑越密）', zt.xiaCiAt > now);
  xt.tingZhi();
}

/* ② 迟到超宽限：跳过但不丢 */
{
  const { xt, shi: s } = mk();
  let pao = 0;
  xt.zhuCe({ id: 'b', ming: 'B', meiMs: 10_000, chiXianMs: 15_000, run: () => { pao += 1; } });
  xt.qiDong();
  advance(10_000);
  xt.tingZhi();
  advance(70_000);
  xt.qiDong();
  const zt = xt.zhuangTai().ren.find((r) => r.id === 'b');
  jian('② 迟到 70 秒（宽限 15 秒）⇒ 不硬补', pao === 1, 'pao=' + pao);
  jian('② 但记 skip-late 并累计跳过次数（不静默吞）', s.filter((e) => e.type === 'skip-late').length >= 1 && zt.tiaoGuoChi >= 6, JSON.stringify({ t: zt.tiaoGuoChi }));
  jian('② 跳过后仍排下一次（任务没被丢掉）', zt.xiaCiAt > now);
  xt.tingZhi();
}

/* ③ 重入保护 */
{
  const { xt, shi: s } = mk();
  let jie = null, pao = 0;
  xt.zhuCe({ id: 'c', ming: 'C', meiMs: 5_000, run: () => new Promise((res) => { pao += 1; jie = res; }) });
  xt.qiDong();
  advance(5_000);
  advance(20_000);
  jian('③ 挂着的任务在完成前只跑一次（绝不并发）', pao === 1, 'pao=' + pao);
  jian('③ 期间每次到点都记 skip-busy', s.filter((e) => e.type === 'skip-busy').length >= 1);
  jian('③ 账本上看得见"正忙"', xt.zhuangTai().ren.find((r) => r.id === 'c').zaiTuan === true);
  jie && jie();
  await wei();
  jian('③ 异步任务完成后必须清占用（漏清就等于任务永久废掉）', xt.zhuangTai().ren.find((r) => r.id === 'c').zaiTuan === false);
  advance(10_000);
  jian('③ 完成后恢复调度', pao === 2, 'pao=' + pao);
  xt.tingZhi();
}

/* ④ 错误隔离 + 退避 */
{
  const { xt, shi: s } = mk();
  let hao = 0;
  xt.zhuCe({ id: 'd', ming: 'D', meiMs: 5_000, run: () => { throw new Error('坏了'); } });
  xt.zhuCe({ id: 'e', ming: 'E', meiMs: 5_000, run: () => { hao += 1; } });
  xt.qiDong();
  advance(60_000);
  const zd = xt.zhuangTai().ren.find((r) => r.id === 'd');
  jian('④ 坏任务连续失败被计数', zd.lianXuShiBai >= 2, JSON.stringify({ b: zd.lianXuShiBai, c: zd.ciShu }));
  jian('④ 失败按 2 的幂退避（下次到期被推远）', zd.xiaCiAt - now > 20_000, JSON.stringify({ c: zd.xiaCiAt - now }));
  jian('④ 同一心跳下的好任务照常跑（错误隔离）', hao >= 8, 'hao=' + hao);
  jian('④ 错误详情进事件流（要能回答"为什么没跑"）', s.some((e) => e.type === 'err' && /坏了/.test(String(e.xiangxi.cuo))));
  xt.tingZhi();
}

/* ⑤ 一次性到期与系统保底 */
{
  const os = [];
  const { xt, shi: s } = mk({ osShouShi: { chuangJian: (x) => { os.push(x); }, shanChu: (id) => { os.push({ shan: id }); } }, osZhiShangMs: 60_000 });
  xt.qiDong();
  xt.daoJiShenQing({ id: 's5', miao: 5, beiZhu: '短' });
  xt.daoJiShenQing({ id: 's120', miao: 120, beiZhu: '长' });
  advance(5_000);
  const f5 = s.filter((e) => e.type === 'daoJi-fire' && e.id === 's5');
  jian('⑤ 5 秒到期由心跳准点触发（迟到 < 1 秒）', f5.length === 1 && Number(f5[0].xiangxi.lateMs) <= 1000, JSON.stringify(f5[0] && f5[0].xiangxi.lateMs));
  jian('⑤ 来源标 xin-tiao（本机心跳，不是补跑也不是系统）', f5.length === 1 && f5[0].xiangxi.laiYuan === 'xin-tiao');
  jian('⑤ 短等待不动用系统保底（心跳够用就不惊动操作系统）', !os.some((x) => x.id === 's5'));
  jian('⑤ 长等待（≥60 秒）才挂系统保底', os.some((x) => x.id === 's120'));
  advance(120_000);
  jian('⑤ 长到期到点触发', s.filter((e) => e.type === 'daoJi-fire' && e.id === 's120').length === 1);
  jian('⑤ 触发后把系统那条撤掉（不留会自己响的僵尸计划任务）', os.some((x) => x.shan === 's120'));
  jian('⑤ 系统留痕不会二次触发（同一到期只发一次）', (() => { const r = xt.waiBuDaoQi('s120', 0); return r.ok === true && r.yiFaGuo === true; })());
  jian('⑤ 撤销到期会把系统保底一起撤', (() => { xt.daoJiShenQing({ id: 's9', miao: 300 }); const b = xt.daoJiQuXiao('s9'); return b === true && os.some((x) => x.shan === 's9'); })());
  jian('⑤ 同 id 再登记 = 覆盖到期时间（定时任务每轮都要重挂下一次）', (() => {
    xt.daoJiShenQing({ id: 'dup', miao: 300, beiZhu: '第一次' });
    const a = xt.daoJiLieBiao().find((d) => d.id === 'dup').yaoAt;
    xt.daoJiShenQing({ id: 'dup', miao: 900, beiZhu: '第二次' });
    const lie = xt.daoJiLieBiao().filter((d) => d.id === 'dup');
    return lie.length === 1 && lie[0].yaoAt > a && lie[0].beiZhu === '第二次';
  })(), JSON.stringify(xt.daoJiLieBiao().filter((d) => d.id === 'dup').map((d) => d.beiZhu)));
  xt.tingZhi();
}

/* ⑤b 钩子说"没挂"就不许记成"已挂" */
{
  const n = mk({ osShouShi: { chuangJian: () => false, shanChu: () => { } }, osZhiShangMs: 60_000 });
  n.xt.qiDong();
  n.xt.daoJiShenQing({ id: 'no-arm', miao: 300, beiZhu: '钩子说不挂' });
  await wei();
  const dj = (n.xt.zhuangTai() || {}).daoJi || {};
  jian('⑤ 钩子明说"没挂"（唤醒开关关着 / 命令太长）⇒ 账本不许记成已挂保底（界面那个数字是给用户的）',
    Number(dj?.osGui) === 0 && !n.shi.some((e) => e.type === 'os-arm'), JSON.stringify(dj));
  jian('⑤ 卸下保底只清"挂了"的标记，到期记录本身还在（关开关 ≠ 取消任务）', (() => {
    const y = n.xt.daoJiLieBiao().find((d) => d.id === 'no-arm');
    return !!y && y.yiFa === false;
  })());
  n.xt.tingZhi();
}

/* ⑥ 落盘 + 重启补跑 */
{
  const wj = path.join(root, '.r40-gate-xintiao.json');
  try { fs.unlinkSync(wj); } catch { /* noop */ }
  const a = mk({ wenjian: wj });
  a.xt.zhuCe({ id: 'r', ming: 'R', meiMs: 60_000, chiXianMs: 600_000, run: () => { } });
  a.xt.daoJiShenQing({ id: 'dj', miao: 120, beiZhu: '重启前登记的到期', chang: { sessionId: 'S1' } });
  a.xt.qiDong();
  advance(60_000);
  a.xt.tingZhi();
  const cun = JSON.parse(fs.readFileSync(wj, 'utf8'));
  jian('⑥ 账本真的落盘（周期下次到期 + 一次性到期都在文件里）', !!cun.ren.r && (cun.daoJi || []).some((x) => x.id === 'dj'), JSON.stringify({ ren: Object.keys(cun.ren || {}), dj: (cun.daoJi || []).map((x) => x.id) }));
  advance(180_000);
  const b = mk({ wenjian: wj });
  let paoB = 0, ciB = null;
  b.xt.zhuCe({ id: 'r', ming: 'R', meiMs: 60_000, chiXianMs: 600_000, run: (ci) => { paoB += 1; ciB = ci; } });
  b.xt.qiDong();
  jian('⑥ 重启后过期任务补跑一次并标 buPao', paoB === 1 && ciB && ciB.buPao === true && ciB.tuoYanMs >= 120_000, JSON.stringify(ciB && { b: ciB.buPao, t: ciB.tuoYanMs }));
  const dj = b.xt.zuiJinShiJian(200).filter((e) => e.type === 'daoJi-fire' && e.id === 'dj');
  jian('⑥ 关机期间到过点的一次性到期，重启后补触发并说明来源', dj.length === 1 && dj[0].xiangxi.laiYuan === 'buPao', JSON.stringify(dj[0] && dj[0].xiangxi));
  jian('⑥ 补触发带上原本挂着的上下文（会话不能认错）', dj.length === 1 && dj[0].xiangxi.chang.sessionId === 'S1');
  b.xt.tingZhi();
  try { fs.unlinkSync(wj); } catch { /* noop */ }
}

/* ⑦ 时钟跳变说实话 */
{
  const wj = path.join(root, '.r40-gate-clock.json');
  try { fs.unlinkSync(wj); } catch { /* noop */ }
  const a = mk({ wenjian: wj });
  a.xt.zhuCe({ id: 'k', ming: 'K', meiMs: 10_000, run: () => { } });
  a.xt.qiDong();
  advance(12_000);
  a.xt.tingZhi();
  now -= 300_000;
  const b = mk({ wenjian: wj });
  b.xt.zhuCe({ id: 'k', ming: 'K', meiMs: 10_000, run: () => { } });
  b.xt.qiDong();
  jian('⑦ 墙上钟往回跳 ⇒ 记 clock-back（不假装一切正常）', b.shi.some((e) => e.type === 'clock-back'), JSON.stringify(b.shi.filter((e) => e.type === 'clock-back')[0] || null));
  b.xt.tingZhi();
  now += 1_200_000;
  const c = mk({ wenjian: wj });
  c.xt.zhuCe({ id: 'k', ming: 'K', meiMs: 10_000, run: () => { } });
  c.xt.qiDong();
  jian('⑦ 隔了很久没有心跳（休眠/被关）⇒ 记 long-gap', c.shi.some((e) => e.type === 'long-gap'), JSON.stringify(c.shi.filter((e) => e.type === 'long-gap')[0] || null));
  c.xt.tingZhi();
  try { fs.unlinkSync(wj); } catch { /* noop */ }
}

/* ⑧ 等待走心跳 */
{
  const { xt } = mk();
  xt.qiDong();
  const kai = now;
  const p = xt.dengDai(3);
  advance(3000);
  const r = await p;
  jian('⑧ 3 秒等待由心跳准点到期（不早于 3 秒、不晚于 3.2 秒）', now - kai >= 3000 && now - kai <= 3200, JSON.stringify({ g: now - kai }));
  jian('⑧ 回报带实测耗时与计时节奏（模型要能核对）', r.requestedMs === 3000 && typeof r.waitedMs === 'number' && Number(r.tickMs) === 2000);
  const p1 = xt.dengDai(1);
  const p4 = xt.dengDai(4);
  advance(1000);
  await p1;
  jian('⑧ 并发等待各按各的点到（1 秒先回）', now - kai === 4000, JSON.stringify({ d: now - kai }));
  advance(3000);
  await p4;
  jian('⑧ 4 秒那个也按自己的点到', now - kai === 7000, JSON.stringify({ s: now - kai }));
  const p30 = xt.dengDai(30, { id: 'ke-qu' });
  advance(1000);
  jian('⑧ 等待可取消', xt.dengDaiQuXiao('ke-qu') === true);
  const r30 = await p30;
  jian('⑧ 取消后立刻返回 cancelled（不挂死、不谎报等满了）', r30.cancelled === true && r30.yaoAt > r30.now);
  const r0 = await xt.dengDai(0);
  jian('⑧ 0 秒不等待直接回', r0.waitedMs === 0);
  xt.tingZhi();
}

/* ⑨ 心跳没起来时不许把等待挂死 */
{
  const { xt, shi: s } = mk();
  const p = xt.dengDai(1);
  jian('⑨ 未启动就如实记降级事件 wait-no-heartbeat', s.some((e) => e.type === 'wait-no-heartbeat'));
  advance(1200);
  const r = await p;
  jian('⑨ 降级路径仍能等够（计时源缺失不等于任务失败）', r.requestedMs === 1000, JSON.stringify({ w: r.waitedMs }));
  xt.tingZhi();
}

/* ⑩ 主进程接线（这部分只能核"接上了没有"，跑到出结果由 live 档负责） */
{
  jian('⑩ 心跳注册了六个周期任务（巡检/租约回收/孤儿回收/校时/状态同步/落盘兜底）',
    ['dingShi.chunKao', 'zuYue.huiShou', 'guEr.huiShou', 'shiZhong.yangBen', 'zhuangTai.tongBu', 'chiJiuHua.luoPan'].every((id) => main.includes("id: '" + id + "'")),
    JSON.stringify(['dingShi.chunKao', 'zuYue.huiShou', 'guEr.huiShou', 'shiZhong.yangBen', 'zhuangTai.tongBu', 'chiJiuHua.luoPan'].filter((id) => !main.includes("id: '" + id + "'"))));
  jian('⑩ 断点续传：队列/预计完成时间/定时任务由心跳定期落盘（原来只在退出时落）', (() => {
    const k = main.indexOf("id: 'chiJiuHua.luoPan'");
    const w = k > 0 ? main.slice(k, k + 900) : '';
    return /luoPanLuYouQiDuiLie\(\)/.test(w) && /etaBaCun\(\)/.test(w) && /baoCunDingShi\(\)/.test(w);
  })());
  /** 只看函数体、并且**先去掉注释**：注释里写着"不再串 cmd.exe"不该被当成代码扫出来 */
  const quZhu = (ming) => {
    const k = main.indexOf(ming);
    const w = k > 0 ? main.slice(k, k + 2600) : '';
    return w.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  };
  jian('⑩ 定时任务**不脱离程序**：默认完全在进程内，"到点唤醒程序"要用户显式打开（默认关）',
    /\?\.xinTiaoWake === true/.test(quZhu('function xinTiaoWakeKai')), '开关默认值不是"关"');
  jian('⑩ 开关关着就**不往系统里挂任何东西**（每次挂的时候现读，不是启动时读一次）',
    /if \(!xinTiaoWakeKai\(\)\)/.test(quZhu('function chouJianOSShouShi')) && /'xin-tiao\.os-off'/.test(quZhu('function chouJianOSShouShi')));
  jian('⑩ 关下去**当场卸下**已经挂上的系统任务（"能主动完全关闭"才算真的关闭）',
    /osXieZai\(\)/.test(quZhu("chuliIpc('warmy:xinTiaoWakeSheZhi'"))
    && /async osXieZai\(\)/.test(fs.readFileSync(path.join(root, 'packages/app-shell/src/xin-tiao.ts'), 'utf8')));
  jian('⑩ 打开开关时把**已经排着的到期重挂**（不然要等下一个周期才生效，看着就像开关没用）',
    /chongGua \+= 1/.test(quZhu("chuliIpc('warmy:xinTiaoWakeSheZhi'")));
  jian('⑩ 卸下只撤系统那一条、到期记录本身保留（关开关不等于取消用户的定时任务）', (() => {
    const y = fs.readFileSync(path.join(root, 'packages/app-shell/src/xin-tiao.ts'), 'utf8');
    const k = y.indexOf('async osXieZai');
    const w = k > 0 ? y.slice(k, k + 700) : '';
    return /d\.osGui = false/.test(w) && /shiJian\('os-disarm'/.test(w) && !/daoJi = this\.daoJi\.filter/.test(w);
  })());
  jian('⑩ 真开着唤醒时被系统唤回并结掉到期（唤醒参数 + 正在跑/冷启动两个入口）',
    /--warmy-xin-tiao-wake=/.test(main) && /chuliHuanXing\(huanId, 'second-instance'\)/.test(main) && /chuliHuanXing\(quHuanXingId\(process\.argv/.test(main), '唤醒链路没接上');
  jian('⑩ 系统任务的动作**只有启动我们自己的程序**（不再串 cmd.exe/echo/& —— 上一版被截断成只剩第一个 token）', (() => {
    const w = quZhu('function chouJianOSShouShi');
    return !/cmd\.exe/.test(w) && !/ & /.test(w)
      && /const tr = xinTiaoHuanXingMingLing\(x\.id\)/.test(w) && /'\/tr', tr/.test(w);
  })());
  jian('⑩ 唤醒只沿用"哪个数据目录"（不把上一支已死进程的调试端口带进新实例）',
    /\/\^--user-data-dir=/.test(main) && !/remote-debugging-port.*filter/.test(main));
  jian('⑩ 命令行长到装不下（schtasks /tr 上限 260）⇒ **不挂**并如实记一条，绝不写半截命令',
    /mingLing\.length > 250/.test(quZhu('function xinTiaoHuanXingMingLing'))
    && /'xin-tiao\.os-decline'/.test(quZhu('function xinTiaoHuanXingMingLing')) && !/os-mark-only|os-skip/.test(main));
  /**
   * ⑩ 唤醒这一条的口径改了（2026-10-19 用户："心跳没有什么需要设置的，无需显示在界面上，删除掉"）：
   * **默认关 + 关掉时卸下系统计划任务**这两点照旧要判（那是"程序不许自己复活"的硬要求），
   * 但**判据落在主进程与 IPC 上，不再要求界面上有个勾**。通道留着是给运维/门禁当场验证用的，
   * 撤掉通道等于把能力一起撤了 —— 那不是用户要的。
   */
  jian('⑩ 唤醒仍默认关、通道仍在（IPC + preload），但**界面上不再有开关**',
    /chuliIpc\('warmy:xinTiaoWakeSheZhi'/.test(main)
    && fs.readFileSync(path.join(root, 'packages/app-shell/src/preload.cjs'), 'utf8').includes('xinTiaoWakeSheZhi')
    && !fs.readFileSync(path.join(root, 'packages/app-shell/src/renderer/app.js'), 'utf8').includes('xinTiaoWakeKai')
    && /\?\.xinTiaoWake === true/.test(quZhu('function xinTiaoWakeKai'))
    && fs.readFileSync(path.join(root, 'packages/app-shell/src/i18n/eo.json'), 'utf8').includes('xinTiao.wakeOffHint'));
  jian('⑩ 旧的自建 setInterval 巡检已经撤掉（计时源只能有一个）',
    !/setInterval\(\(\) => \{\s*\n\s*const now = Date\.now\(\);\s*\n\s*for \(const ren of dingShiRenWuJi\)/.test(main));
  jian('⑩ 租约 sweep 真的被心跳调用（原来注释说"可在心跳里调"却没人调）',
    /leases\?\.sweep\(\)/.test(main) && /zuYue\.swept/.test(main));
  jian('⑩ wait_seconds 走心跳等待并如实回报计时源',
    /dengDaiTongGuoXinTiao|huoQuXinTiao\(\)\.dengDai/.test(main) && /jiShiYuan: 'xin-tiao'/.test(main));
  jian('⑩ 停止本轮时撤销在飞的等待（不能点完停止还在背后数秒）',
    /keng\.dengDaiQuXiao\(dengId\)/.test(main) && /addEventListener\('abort', onAbort/.test(main));
  jian('⑩ 定时任务 repeat 真的递减并跑满自动停用',
    /ren\.zhiXingGuo = Math\.max\(0, Number\(ren\.zhiXingGuo\) \|\| 0\) \+ 1/.test(main)
    && /ren\.repeat > 0 && ren\.zhiXingGuo >= ren\.repeat/.test(main) && /dingShi\.exhausted/.test(main));
  jian('⑩ 到点广播带上迟到时长与补跑标记（界面/模型都要看得见"这是补的"）',
    /lateMs, buPao: ci\.buPao \|\| lateMs > 60_000/.test(main));
  jian('⑩ 删/停定时任务会把心跳闹钟与系统那条一起撤',
    /daoJiQuXiao\('sch:' \+ String\(p0\?\.id/.test(main) && /xinTiao\?\.daoJiQuXiao\('sch:' \+ it\.id\)/.test(main));
  jian('⑩ 系统保底用 execFile 数组参数（不过 shell，中文路径不会被拼进命令）',
    /execFile\('schtasks\.exe', args, \{ windowsHide: true \}/.test(main) && !/execSync\([^)]*schtasks/.test(main));
  jian('⑩ 系统保底只到分钟 ⇒ 时间向上取整（宁可晚留痕，不能早于约定时间）',
    /Math\.ceil\(Math\.max\(0, Number\(x\.yaoAt\)/.test(main) && /\/ 60_000\) \* 60_000/.test(main));
  jian('⑩ 退出前落盘（不落就等于"提醒莫名其妙少了"）',
    /xinTiao\?\.guanBi\(\)/.test(main));
  jian('⑩ 审计按类型采样：异常一条不落，成功回执不刷屏',
    /audit\?\.log\('xin-tiao\.' \+ e\.type/.test(main) && /if \(hao <= 3000 && ci % 30 !== 0\) return;/.test(main));
  jian('⑩ 联网校时进心跳（偏差>5 秒记审计并推控制台）',
    /shiZhong\.sample/.test(main) && /clock\.drift/.test(main) && /shiZhong\.unavailable/.test(main));
  /** 状态要**读得到**（IPC + 审计），但**不再做成设置分区** —— 用户 2026-10-19：心跳没有需要设置的东西 */
  jian('⑩ 心跳状态读得到（IPC + preload + 审计），且设置里没有这个分区',
    /chuliIpc\('warmy:xinTiaoZhuangTai'/.test(main)
    && fs.readFileSync(path.join(root, 'packages/app-shell/src/preload.cjs'), 'utf8').includes('xinTiaoZhuangTai')
    && /audit\?\.log\('xin-tiao\./.test(main)
    && !fs.readFileSync(path.join(root, 'packages/app-shell/src/renderer/app.js'), 'utf8').includes('data-sec="xintiao"'));
  jian('⑪ 内核只用一套自续期定时器（去掉注释后的产物里没有 setInterval 调用）', (() => {
    const raw = fs.readFileSync(path.join(root, 'packages/app-shell/dist/xin-tiao.js'), 'utf8');
    const daiMa = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    return !/setInterval\(/.test(daiMa) && /zaoShiZhong/.test(daiMa);
  })());
  jian('⑫ 环境存活探针注册进心跳，并且量的是真事实（磁盘 statfs + 进程 RSS），不是又一个 setInterval', (() => {
    const k = main.indexOf('function tanZhenHuanJing');
    const w = k > 0 ? main.slice(k, k + 2000) : '';
    return main.includes("id: 'huanJing.tanZhen'")
      && /statfsSync/.test(w) && /huanJing\.disk-low/.test(w) && /process\.memoryUsage\(\)\.rss/.test(w) && /huanJing\.mem-high/.test(w);
  })());
  jian('⑫ 探针只在**跨阈值那一刻**报（不刷屏），恢复也如实记一条',
    /if \(di !== huanJingZhuangTai\.diPanLow\)/.test(main) && /huanJing\.disk-recover/.test(main) && /huanJing\.mem-recover/.test(main));
  jian('⑫ 广播与 IPC 读回用**同一份**状态构造（真机 r40-live 红过：面板有环境读数、读接口没有）',
    (main.match(/xinTiaoZhuangTaiDuiXiang\(\)/g) || []).length >= 2
    && !/zhuangTai: \{ \.\.\.huoQuXinTiao\(\)\.zhuangTai\(\)/.test(main));
  jian('⑫ 命令行放不下时**明说不挂**（`xin-tiao.os-decline`），绝不写中文路径下会静默失败的 wake.cmd 包装',
    /mingLing\.length > 250/.test(quZhu('function xinTiaoHuanXingMingLing'))
    && /'xin-tiao\.os-decline'/.test(quZhu('function xinTiaoHuanXingMingLing'))
    && !/writeFileSync\([^)]*wake\.cmd/.test(main));
  jian('⑫ kanPao 的任务每次进程启动都先跑一次（重启后也要有数，不能等满一个周期）',
    /if \(ren\.kanPao\) zhang\.xiaCiAt = Math\.min\(zhang\.xiaCiAt, this\.now\(\)\)/.test(fs.readFileSync(path.join(root, 'packages/app-shell/src/xin-tiao.ts'), 'utf8')));
}

/* ── ⑫ 同一批真机红的另一半：核对轮只动嘴就把欠账放过去 ── */
{
  jian('⑫ 核对轮"0 工具 + 没走 NO_REPLY + 计划仍为空"⇒ 补一次必须动手的核对',
    /z\.heDui >= 1 && !z\.heDuiEr/.test(main)
    && /shangLun\?\.noReply !== true/.test(main)
    && /\(Number\(shangLun\?\.diaoYongJi\) \|\| 0\) === 0/.test(main));
  jian('⑫ 补核对**最多一次**（不追着模型要说法）', /z\.heDuiEr = 1;/.test(main) && !/z\.heDuiEr \+= /.test(main));
  jian('⑫ 补派走同一个续派账本（受"连续两次无新事实就停"和总硬顶约束）',
    /return pai\('completion-check'\);\s*\}\s*\n\s*\/\*\*/.test(main) || /pai\('completion-check'\)/.test(main));
  jian('⑫ 核对指令里写进宿主实测的等待欠账（用户要 30 秒、实测只等 20 秒要点名）',
    /dengYao > 0 && dengYi < dengYao/.test(main)
    && /wait_seconds\(seconds=\$\{Math\.max\(1, Math\.round\(dengYao - dengYi\)\)\}\)/.test(main)
    && /miaoLeiJi/.test(main));
  jian('⑫ 没建计划时的话说清"清单里没有的那件就是没做"（不许只用文字报完成）',
    /用户要而清单里没有的那一件，就是还没做/.test(main));
}

/* ── ⑬ 单次执行超时：重入保护不能变成永久卡死 ── */
{
  const { xt, shi: s } = mk();
  const jia = [];                       // 每次执行都留一个"晚到完成"的把手
  let ciShuZhi = 0;
  xt.zhuCe({ id: 't', ming: 'T', meiMs: 5_000, chaoShiMs: 8_000, run: () => new Promise((res) => { jia.push(res); }) });
  xt.qiDong();
  advance(5_000);                       // 第一次开始跑，永不返回
  jian('⑬ 任务在跑时被占用（重入保护生效）', xt.zhuangTai().ren.find((r) => r.id === 't').zaiTuan === true);
  advance(8_001);                       // 正好越过 8 秒超时、还没到下一次执行
  const z1 = xt.zhuangTai().ren.find((r) => r.id === 't');
  jian('⑬ 挂死任务被超时掐掉并**释放占用**（否则它再也不跑，只会一直显示"正忙"）',
    s.some((e) => e.type === 'timeout' && e.id === 't') && z1.zaiTuan === false, JSON.stringify({ e: s.filter((x) => x.type === 'timeout').length, z: z1.zaiTuan }));
  jian('⑬ 超时后至少隔一个周期才再试（不许立刻又撞进同一个挂死里）', z1.xiaCiAt - now >= 5_000 - 50, JSON.stringify({ cha: z1.xiaCiAt - now }));
  jian('⑬ 超时次数单独记账 chaoShuCi', Number(z1.chaoShuCi) === 1, JSON.stringify({ c: z1.chaoShuCi }));
  jian('⑬ 原因写进 lastSkip=timeout（"为什么没跑"要能当场回答）', z1.lastSkip && z1.lastSkip.yuanYin === 'timeout', JSON.stringify(z1.lastSkip));
  advance(6_000);                       // 第二次执行开始
  const z2 = xt.zhuangTai().ren.find((r) => r.id === 't');
  jian('⑬ 超时之后任务真的恢复调度（没被永久废掉）', jia.length >= 2 && z2.zaiTuan === true, JSON.stringify({ p: jia.length, z: z2.zaiTuan }));
  ciShuZhi = Number(z2.ciShu);
  jia[0] && jia[0]();                   // **第一次**的完成晚到了
  await wei();
  const z3 = xt.zhuangTai().ren.find((r) => r.id === 't');
  jian('⑬ 晚到的完成不许结掉下一次的账（否则两个执行同时在跑，重入保护就白写）',
    z3.zaiTuan === true && Number(z3.ciShu) === ciShuZhi, JSON.stringify({ z: z3.zaiTuan, c: z3.ciShu, q: ciShuZhi }));
  xt.tingZhi();
}

/* ⑭ 为什么没跑：lastSkip 的可观测性 */
{
  const { xt } = mk();
  xt.zhuCe({ id: 'q', ming: 'Q', meiMs: 10_000, chiXianMs: 5_000, run: () => { } });
  xt.qiDong();
  advance(10_000);                      // 正常到点跑一次（这一步不该有原因）
  const z0 = xt.zhuangTai().ren.find((r) => r.id === 'q');
  jian('⑭ 正常跑过 ⇒ 没有原因可报（不许留旧原因误导）', z0.lastSkip === null, JSON.stringify(z0.lastSkip));
  xt.tingZhi();
  advance(40_000);                      // 心跳停了 40 秒（进程被关/睡眠）
  xt.qiDong();
  const z1 = xt.zhuangTai().ren.find((r) => r.id === 'q');
  jian('⑭ 迟到超过宽限 ⇒ 原因写的是 late + 迟到多久（借 OpenClaw 的 skip reason 口径）',
    z1.lastSkip && z1.lastSkip.yuanYin === 'late' && Number(z1.lastSkip.xiangxi.tuoYanMs) >= 30_000, JSON.stringify(z1.lastSkip));
  xt.tingZhi();
}

/* ⑮ 心跳自检：主进程被卡住要能自己承认 */
{
  const { xt, shi: s } = mk();
  xt.zhuCe({ id: 'k', ming: 'K', meiMs: 10_000, run: () => { } });
  xt.qiDong();
  /**
   * 这里**不能用 advance()**：它会把中间每一跳都补上，间隔永远是 2 秒，测不出"卡住"。
   * 真实事故形态是"时钟走了 40 秒但一次 tick 都没发生"（事件循环被大 JSON/同步 IO 占住），
   * 所以直接推单调钟再手动跳一次。
   */
  now += 40_000;
  xt.tiaoCi('test');
  jian('⑮ 两跳之间真实间隔远超节奏 ⇒ 记 tick-starved（"任务没跑"不归错到任务头上）',
    s.some((e) => e.type === 'tick-starved'), JSON.stringify(s.filter((e) => e.type === 'tick-starved').slice(0, 1)));
  now += 2_000;
  const qian = s.filter((e) => e.type === 'tick-starved').length;
  xt.tiaoCi('test');
  jian('⑮ 正常节奏下不刷 tick-starved（只在大间隔时报一次）',
    s.filter((e) => e.type === 'tick-starved').length === qian, JSON.stringify({ qian, hou: s.filter((e) => e.type === 'tick-starved').length }));
  xt.tingZhi();
}

/* ⑯ 到点执行必须幂等（计时是 at-least-once，副作用要自己防重复） */
{
  jian('⑯ 定时任务用"原定到点时刻"当幂等键：崩在触发后、落盘前 ⇒ 重启不再投第二遍',
    /ren\.zuiHouChuFaAt === yuan/.test(main) && /ren\.zuiHouChuFaAt = yuan/.test(main) && /dingShi\.idempotent-skip/.test(main));
  jian('⑯ 幂等键随任务落盘（不然重启后键也丢了，等于没做）',
    /zuiHouChuFaAt: number;/.test(main) && /zuiHouChuFaAt: 0,/.test(main));
}

/* ── ⑬ 交付齐全但漏报引擎 ⇒ 宿主兜底把"本轮实际引擎"报出来 ── */
{
  const k = main.indexOf('chat.model-selfreport-surfaced');
  const w = k > 0 ? main.slice(k - 1700, k + 200) : '';
  jian('⑬ 用户问了"用的什么模型"而回复里没有引擎名 ⇒ 宿主把自己知道的事实贴上去（不是替模型编话）',
    k > 0 && /yaoQiuBao && !yiJingShuo && benFaYinQing/.test(w));
  jian('⑬ 模型自己已经报过名就**不重复**贴（不许出现两段一样的话）', /yiJingShuo/.test(w) && /benFaYinQing\.length >= 3/.test(w));
  jian('⑬ 兜底文案在 10 个语言包里都齐', (() => {
    const ming = ['zh-CN', 'zh-TW', 'en-US', 'ja', 'fr', 'es', 'pt', 'ru', 'ko', 'eo'];
    return ming.every((yu) => fs.readFileSync(path.join(root, 'packages/app-shell/src/i18n/' + yu + '.json'), 'utf8').includes('chat.modelReportNote'));
  })());
}

console.log(`第 40 轮心跳行为门禁：${ok} 通过 / ${shi.length} 失败`);
for (const s of shi) console.log('  ✗ ' + s);
process.exit(shi.length ? 1 : 0);
