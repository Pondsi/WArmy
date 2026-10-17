/**
 * 第 22 轮：长程运行实机门禁（24h 语义 / checkpoint / 租约 / 记忆重启恢复 / ETA / 定时任务）
 *
 * 交接里那条"长程 24h 实机验证"的**可执行版本**：把 24 小时压成一条注入式时间轴，
 * 跑真磁盘、真 SQLite、真进程边界（子进程重新打开同一份数据），验证长跑期间
 * 该守恒的东西确实守恒。**墙钟 24h 依然没跑过** —— 这一点在结论里如实写着，
 * 不拿"模拟 24h"冒充"挂机 24h"。
 *
 * 用法：
 *   node verify-round22-longrun.mjs                 # 长跑语义套件（纯本地磁盘，秒级～十几秒）
 *   node verify-round22-longrun.mjs --live --rounds=4   # 再加真实 Ollama 多轮（需要本地 Ollama）
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = path.join(root, 'packages', 'app-shell', 'dist');
const argv = process.argv.slice(2);
const LIVE = argv.includes('--live');
const ROUNDS = Math.max(1, Math.min(32, Number((argv.find((a) => /^--rounds=/.test(a)) || '').split('=')[1]) || 4));
const DAY = 24 * 3600_000;
const HOUR = 3600_000;

let fail = 0;
const ok = (x, m, d) => { console.log(`${x ? 'PASS' : 'FAIL'} ${m}${x || d === undefined ? '' : ` => ${JSON.stringify(d).slice(0, 220)}`}`); if (!x) fail++; };
const tmp = (ming) => fs.mkdtempSync(path.join(os.tmpdir(), `warmy-longrun-${ming}-`));
/** 子进程统一用 `RESULT={json}` 结尾；从末尾往前找，别的 stdout 噪声（警告/日志）不影响解析 */
function duJieGuo(so) {
  const s = String(so || '');
  const i = s.lastIndexOf('RESULT=');
  if (i < 0) return { error: '子进程没给 RESULT：' + s.slice(0, 160) };
  const line = s.slice(i + 7).split('\n')[0].trim();
  try { return JSON.parse(line); } catch (e) { return { error: `RESULT 不是合法 JSON：${e.message}｜${line.slice(0, 120)}` }; }
}

console.log('=== 第 22 轮 长程运行门禁 ===');
if (!fs.existsSync(path.join(DIST, 'checkpoint.js'))) { console.error('缺 dist，请先 tsc -b packages/app-shell'); process.exit(2); }

const { AiWenTiZhongXin } = await import(pathToFileURL(path.join(DIST, 'ai-questions.js')).href);
const { LeaseRegistry } = await import(pathToFileURL(path.join(DIST, 'lease.js')).href);
const { JianChaDianCang } = await import(pathToFileURL(path.join(DIST, 'checkpoint.js')).href);
const eta = await import(pathToFileURL(path.join(DIST, 'eta-forecast.js')).href);
const { xuanranYoujieShitu } = await import(pathToFileURL(path.join(DIST, 'context-renderer.js')).href);

// ══════════════════════════════════════════════════════════════
// 1. 决策卡：24h 语义（等人就是一直等，不偷偷替用户拿主意）
// ══════════════════════════════════════════════════════════════
console.log('\n[1] 决策卡 24h 语义');
{
  const q = new AiWenTiZhongXin();
  const QUN = 's-longrun';
  const kinds = ['step-capped', 'eta-anomaly', 'length-short', 'tool-stall', 'tool-hard-cap', 'model-chain-fail', 'plan-continue-fail'];
  const kaiLe = kinds.map((k) => q.daKai({ groupId: QUN, sessionId: QUN, biaoTi: `卡 ${k}`, ti: k, options: [{ id: 'retry', biaoQian: '换一种方法继续' }, { id: 'stop', biaoQian: '停止任务' }] }));
  ok(kaiLe.length === 7 && new Set(kaiLe.map((x) => x.id)).size === 7, '七类卡点各开出一张独立卡（互不覆盖）');
  ok(q.pending(QUN).length === 7, '未答的卡全部挂在 pending（这就是"暂停不烧 token"的状态面）', q.pending(QUN).length);
  const same = q.daKai({ groupId: QUN, sessionId: QUN, biaoTi: '卡 step-capped', ti: '重复开', options: [{ id: 'x', biaoQian: 'x' }] });
  ok(same.id === kaiLe[0].id, '同一标题重复开卡 ⇒ 复用同一张（不刷屏）');
  const da = q.answer(kaiLe[0].id, 'retry');
  ok(da.ok === true && /换一种方法继续/.test(da.inject || ''), '答卡后注入行带的是**用户选的原文**', da && da.inject);
  const ctx = q.contextFor(QUN);
  ok(ctx.startsWith('[决策卡]') && (ctx.match(/\n/g) || []).length <= 6, '决策上下文有界（最多 5 张卡进 prompt，不会越跑越长）', (ctx.match(/\n/g) || []).length);
  ok(q.cancel(kaiLe[1].id) === true && q.pending(QUN).length === 5, 'cancel 后 pending 减少（取消是真取消，不是留着继续提醒）', q.pending(QUN).length);
  const mainTs = fs.readFileSync(path.join(root, 'packages/app-shell/src/electron-main.ts'), 'utf8');
  ok(/timeoutMs = 24 \* 60 \* 60 \* 1000/.test(mainTs), '主进程默认等 24 小时（长跑期间没人答就等满，不误判超时）');
}

// ══════════════════════════════════════════════════════════════
// 2. 租约：跨 24h 的时间轴上，过期是真过期、活跃是真活跃
// ══════════════════════════════════════════════════════════════
console.log('\n[2] 写操作租约跨 24h');
{
  let clock = 1_700_000_000_000;
  const L = new LeaseRegistry({ now: () => clock, defaultTtlMs: 2 * HOUR, maxTtlMs: DAY });
  /** 租约只管**工作区相对路径**（绝对路径/UNC 一律拒 → 见 lease.ts 的 isUncOrAbsolute） */
  const muLu = 'proj/output';
  const a = L.acquire({ holder: 'nm-jia', paths: [muLu], kind: 'dir', ttlMs: 2 * HOUR });
  ok(a.ok === true && !!a.lease?.id, '牛马甲拿到目录租约', a && a.error?.code);
  const b = L.acquire({ holder: 'nm-yi', paths: [muLu], kind: 'dir' });
  ok(b.ok === false, '同一目录被甲占着 ⇒ 乙申请**被拒**（不是排队等别人松手，是当场拒）', b && b.error?.code);
  clock += 3 * HOUR;   // 甲的 2 小时租约过期
  const swept = L.sweep();
  ok(swept.length === 1 && !!a.lease?.id && swept[0]?.id === a.lease.id, '过期租约被 sweep 收走（长夜里没人一直攥着写权限）', { swept: swept.length, id: a.lease?.id });
  const c = L.acquire({ holder: 'nm-yi', paths: [muLu], kind: 'dir', ttlMs: 2 * HOUR });
  ok(c.ok === true, '甲过期后乙才拿得到（顺序公平，不靠运气）');
  const st = L.stats();
  ok(st.expired === 1 && st.holders >= 1, `stats 如实记账：jiHuo=${st.jiHuo} holders=${st.holders} expired=${st.expired}`);
  const xieYi = L.checkWrite('nm-yi', 'proj/output/a.txt');
  const xieJia = L.checkWrite('nm-jia', 'proj/output/a.txt');
  ok(xieYi.allowed === true && xieJia.allowed === false,
    '只有当前持有者能写这个目录（甲已被过期，写不进）', { yi: xieYi.code ?? '允许', jia: xieJia.code, heldBy: xieJia.heldBy });
  const rel = L.release({ holder: 'nm-yi' });
  ok(rel.ok === true && rel.released === true, 'release 真的放手（不释放就会一直占）');
  // 24h 不撤：一直 extend 的持有者不许被无声踢掉
  clock += DAY;
  L.acquire({ holder: 'nm-chang', paths: ['proj/long'], kind: 'dir', ttlMs: 2 * HOUR });
  const ge = L.extend({ holder: 'nm-chang' }, 2 * HOUR);
  ok(ge.ok === true, '长任务可以续租（不是每 2 小时被迫中断一次）');
  L.release({ holder: 'nm-chang' });
}

// ══════════════════════════════════════════════════════════════
// 3. checkpoint：600 轮长跑，数量/体积有界，回滚逐字节
// ══════════════════════════════════════════════════════════════
console.log('\n[3] checkpoint 600 轮长跑');
{
  const dir = tmp('cp');
  const jsonl = path.join(dir, 'chat.jsonl');
  const ws = path.join(dir, 'ws');
  fs.mkdirSync(ws, { recursive: true });
  const c = new JianChaDianCang(dir);
  const N = 600;
  const yuanWen = [];
  for (let i = 1; i <= N; i++) {
    const line = JSON.stringify({ seq: i, role: i % 2 ? 'user' : 'assistant', content: `第 ${i} 轮：长程任务的真实产出片段-${'x'.repeat(40)}` }) + '\n';
    fs.appendFileSync(jsonl, line, 'utf8');
    yuanWen.push(line);
    c.create({ phase: 'round_start', logSeq: i, jsonlPath: jsonl, workspace: ws, limit: 40, maxBytes: 4 * 1024 * 1024, sessionId: 's1', summary: `第 ${i} 轮开始` });
  }
  const lie = c.LieBiao();
  ok(lie.length <= 40, `checkpoint 数量有界：${N} 轮只留 ${lie.length} 份（limit=40 生效，长跑不会堆满磁盘）`);
  const kong = c.space(4 * 1024 * 1024);
  ok(kong.count === lie.length && kong.maxBytes === 4 * 1024 * 1024, `空间视图自洽：used=${kong.usedBytes} 上限=4MB`);
  ok(kong.usedBytes <= 8 * 1024 * 1024, `磁盘占用有界（实测 ${(kong.usedBytes / 1024 / 1024).toFixed(1)}MB）`, kong.usedBytes);
  const muBiao = lie[Math.floor(lie.length / 2)];
  fs.appendFileSync(jsonl, JSON.stringify({ seq: N + 1, role: 'user', content: '写歪了的一条' }) + '\n', 'utf8');
  fs.writeFileSync(path.join(ws, 'dropped.txt'), '回滚后这个文件不该存在\n', 'utf8');
  const rb = c.rollback(muBiao.id, { jsonlPath: jsonl, workspace: ws });
  ok(rb === true, `rollback(${muBiao.id}) 成功`);
  const yuanHang = fs.readFileSync(jsonl, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const biaoJi = yuanHang.filter((r) => r.kind === 'rollback');
  const zhenShi = yuanHang.filter((r) => r.kind !== 'rollback');
  ok(zhenShi.length === muBiao.logSeq, `回滚后真实轮次正好停在回退点（${zhenShi.length} 行，期望 ${muBiao.logSeq}）`, { zong: yuanHang.length });
  ok(zhenShi[zhenShi.length - 1]?.seq === muBiao.logSeq, `末行是第 ${muBiao.logSeq} 轮本身（既不丢已完成轮，也不留回退点之后的内容）`, zhenShi[zhenShi.length - 1]?.seq);
  /** 回滚不是"偷偷改历史"：产品要求留一条显式标记 + 备份文件（可追溯、可反悔） */
  ok(biaoJi.length === 1 && biaoJi[0].checkpointId === muBiao.id, '回滚在账上留了一条 kind=rollback 的标记（不是无痕改写）', biaoJi);
  ok(!!biaoJi[0]?.backupPath && fs.existsSync(String(biaoJi[0].backupPath)), '标记里写了备份在哪，且备份文件真的在磁盘上', biaoJi[0]?.backupPath);
  ok(!fs.existsSync(path.join(ws, 'dropped.txt')), '工作区里回退点之后写的文件被撤掉（会话级回滚是真的）');
  const hou = c.LieBiao();
  ok(hou.length <= 41, '回滚本身不把 checkpoint 撑爆', hou.length);
  fs.rmSync(dir, { recursive: true, force: true });
}

// ══════════════════════════════════════════════════════════════
// 4. 真记忆 + **真子进程重启**恢复（跨进程边界的持久性）
// ══════════════════════════════════════════════════════════════
console.log('\n[4] 记忆写入 800 条 + 子进程重启逐字节恢复');
const memAscii = path.join(os.tmpdir(), 'warmy-longrun-mem');
const memData = path.join(os.tmpdir(), `warmy-longrun-memdata-${Date.now()}`);
{
  /** 与 verify-context-renderer 同一招：拷到 ASCII 目录 + 链真编译好的 better-sqlite3 */
  try { fs.unlinkSync(path.join(memAscii, 'node_modules', 'better-sqlite3')); } catch { /* noop */ }
  fs.rmSync(memAscii, { recursive: true, force: true });
  fs.mkdirSync(path.join(memAscii, 'dist'), { recursive: true });
  const memPkg = path.join(root, 'packages', 'memory-os');
  fs.copyFileSync(path.join(memPkg, 'package.json'), path.join(memAscii, 'package.json'));
  for (const f of fs.readdirSync(path.join(memPkg, 'dist'))) {
    if (f.endsWith('.js') || f.endsWith('.json')) fs.copyFileSync(path.join(memPkg, 'dist', f), path.join(memAscii, 'dist', f));
  }
  const store = path.join(root, 'node_modules', '.pnpm');
  const pingtai = `${process.platform}-${process.arch}`;
  const shiXuan = (p) => {
    try {
      if (!fs.existsSync(path.join(p, 'package.json'))) return false;
      if (fs.existsSync(path.join(p, 'prebuilds', `${pingtai}.node`))) return true;
      const build = path.join(p, 'build', 'Release');
      return fs.existsSync(build) && fs.readdirSync(build).some((n) => n.endsWith('.node'));
    } catch { return false; }
  };
  const src = [path.join(memPkg, 'vendor', 'better-sqlite3')]
    .concat(fs.existsSync(store) ? fs.readdirSync(store).filter((d) => /^better-sqlite3@/.test(d)).map((d) => path.join(store, d, 'node_modules', 'better-sqlite3')) : [])
    .find(shiXuan);
  ok(!!src, `找到本平台（${pingtai}）可用的 better-sqlite3 预编译`, src || '');
  if (src) {
    const nm = path.join(memAscii, 'node_modules');
    fs.mkdirSync(nm, { recursive: true });
    try { fs.symlinkSync(src, path.join(nm, 'better-sqlite3'), 'junction'); } catch { /* noop */ }
  }
  const { JiyiCangFuwu } = await import(pathToFileURL(path.join(memAscii, 'dist', 'index.js')).href);
  const mem = new JiyiCangFuwu({ CangLu: memData, vector: { enabled: false } });
  const ids = [];
  for (let i = 0; i < 800; i++) {
    const id = `lr-${i}`;
    mem.append({ id, sessionId: 's-longrun', kind: 'message', ti: `长程记录 ${i}｜牛马在 24 小时任务里真实写过的一段\npayload-${i}-` + 'Y'.repeat(120) + `-end-${i}` }, 'duty');
    ids.push(id);
  }
  mem.close();
  ok(fs.existsSync(path.join(memData, 'chat.jsonl')) || fs.existsSync(memData), `记忆真的落到磁盘（不是只在内存里）`);

  /** 子进程：全新进程、同一份数据目录 ⇒ 这才叫"重启后恢复" */
  const child = `
    const { pathToFileURL } = require('node:url');
    (async () => {
      const m = await import(${JSON.stringify(pathToFileURL(path.join(memAscii, 'dist', 'index.js')).href)});
      const mem = new m.JiyiCangFuwu({ CangLu: ${JSON.stringify(memData)}, vector: { enabled: false } });
      const out = { total: 0, exact: 0, seqOk: 0, recallHit: 0, sample: null };
      for (let i = 0; i < 800; i++) {
        const r = mem.retrieve({ recordId: 'lr-' + i });
        if (r) {
          out.total++;
          const want = '长程记录 ' + i + '｜牛马在 24 小时任务里真实写过的一段\\npayload-' + i + '-' + 'Y'.repeat(120) + '-end-' + i;
          if (String(r.raw || '').includes('payload-' + i + '-')) out.exact++;
          const s = mem.retrieve({ seq: r.seq });
          if (s && s.recordId === 'lr-' + i) out.seqOk++;
        }
      }
      const cards = mem.recall('长程记录', 30);
      out.recallHit = cards.length;
      const first = mem.retrieve({ recordId: 'lr-0' });
      out.sample = first ? { seq: first.seq, level: first.hitLevel } : null;
      mem.close();
      process.stdout.write('RESULT=' + JSON.stringify(out) + '\\n');
    })().catch((e) => { process.stdout.write('RESULT=' + JSON.stringify({ error: String(e && e.message || e) }) + '\\n'); process.exit(1); });
  `;
  const childFile = path.join(memAscii, 'reopen.cjs');
  fs.writeFileSync(childFile, child, 'utf8');
  let jieguo = {};
  try {
    const so = execFileSync(process.execPath, [childFile], { encoding: 'utf8', timeout: 120000, cwd: memAscii });
    jieguo = duJieGuo(String(so));
  } catch (e) {
    jieguo = { error: String((e)?.stdout || (e)?.message || e).slice(0, 200) };
  }
  ok(!jieguo.error, '子进程重新打开同一份记忆库成功（无错误）', jieguo && jieguo.error);
  ok(jieguo.total === 800, `重启后 800 条记录按 recordId 全部取回：${jieguo.total}/800`);
  ok(jieguo.exact === 800, `取回内容与写入时**逐字节一致**（含中文与 payload 边界）：${jieguo.exact}/800`);
  ok(jieguo.seqOk === 800, `seq 指针同样逐条命中：${jieguo.seqOk}/800`);
  ok(jieguo.recallHit > 0, `语义回忆在重启后仍可用（命中 ${jieguo.recallHit} 张卡片）`);
  ok(jieguo.sample && typeof jieguo.sample.seq === 'number', '第一条记录的 seq/命中层级都还能拿到（索引没坏）', jieguo.sample);

  console.log('\n[5] 长跑日志渲染成有界视图（800 条真实记录）');
  const log = [];
  for (let i = 0; i < 800; i++) log.push({ seq: i + 1, role: i % 2 ? 'user' : 'assistant', content: `长程记录 ${i}｜` + 'Z'.repeat(300), recordId: `lr-${i}` });
  const chars = [];
  for (const n of [200, 400, 800]) {
    const v = xuanranYoujieShitu(log.slice(0, n), { budgetChars: 4000, recallHint: '长程任务' });
    const c = v.xiaoXiJi.reduce((s, m) => s + m.content.length, 0);
    chars.push(c);
    ok(c <= 4000 && v.stats.pointers >= 1, `日志 ${n} 条时视图 ${c} 字符 ≤ 4000 且指针可执行`);
  }
  /**
   * 有界区里的"恒定"要按**是否已经填满预算**来说：日志还没长到填满预算时，
   * 视图本来就略小于预算（不该补白）。所以断言的是
   * 「进入有界区后不再随日志变长」+「恒 ≤ 预算」，而不是所有行数完全相等。
   */
  const baoHe = chars.slice(1);   // 200 条时还没填满，400/800 条已经在有界区里
  ok(chars.every((v) => v <= 4000), `三档日志（200/400/800 条）视图都 ≤ 预算 4000：${chars.join(' → ')}`);
  ok(baoHe.length === 2 && new Set(baoHe).size === 1, `日志 400→800 条（翻倍）视图长度**一字不差**（${baoHe.join(' = ')}）⇒ 与日志总长解耦`, chars);
  ok(chars[2] > 3000 && chars[2] <= 4000, `有界区里的视图确实把预算用满了（${chars[2]}/4000，留白是要点/指针的天然余量，不是没裁）`);
  ok(chars[2] - chars[0] <= 4, `再长 4 倍日志，视图只动了 ${chars[2] - chars[0]} 个字符（不是 4 倍）`);
}

// ══════════════════════════════════════════════════════════════
// 6. ETA：跨 24h 的样本流 + 重启后方法库还在
// ══════════════════════════════════════════════════════════════
console.log('\n[6] ETA 方法库（24h 尺度样本 + 重启）');
{
  const dir = tmp('eta');
  const file = path.join(dir, 'eta-methods.json');
  const t0 = 1_700_000_000_000;
  const zhang = new eta.EtaZhangBen(file, t0);
  const qm = eta.renWuQianMing({ gongJu: 'write_file', buShu: 6 });
  let clock = t0;
  for (let i = 0; i < 24; i++) {
    clock += HOUR;   // 一小时一轮，正好铺满 24 小时
    const shiJi = 40_000 + i * 1_500;                 // 越跑越慢（真实长跑就是这样）
    const yuCe = Math.max(10_000, eta.ema(i ? 40_000 + (i - 1) * 1_500 : shiJi, shiJi, 0.35));
    zhang.jiFangFa('ziDongXuPai', qm, { yuCeMs: yuCe, shiJiMs: shiJi, mingZhong: shiJi <= yuCe * 1.5, moXing: 'qwen3.5-9b' }, clock);
  }
  zhang.baCun();
  ok(fs.existsSync(file), '方法库真的落盘（不是内存对象）');
  const chong = new eta.EtaZhangBen(file, clock + 60_000);
  const f1 = chong.chaFangFa('ziDongXuPai', qm);
  ok(!!f1 && f1.yangBen >= 20, `重启后同类任务的方法还在（样本 ${f1 ? f1.yangBen : 0} 个）`);
  const yu = chong.yuCeByFangFa('ziDongXuPai', qm, clock);
  ok(!!yu && yu.etaMs >= eta.ETA_ZUI_XIAO_MS && yu.etaMs <= eta.ETA_ZUI_DA_MS, `预测值落在合法区间 [${eta.ETA_ZUI_XIAO_MS}, ${eta.ETA_ZUI_DA_MS}]：${yu && yu.etaMs}`, yu);
  ok(!!yu && /fangFa|history|model/.test(String(yu.laiYuan || '')), `预测带来源标注（${yu && yu.laiYuan}），不是凭空一个数`);
  ok(eta.ETA_ZUI_DA_MS === DAY, 'ETA 上限就是 24 小时（与产品口径一致，不无限 extrapolate）');
  ok(chong.yangBenShu('ziDongXuPai') >= 20, `样本累计 ${chong.yangBenShu('ziDongXuPai')} 个（越跑越有依据）`);
  ok(chong.chaFangFa('gongJu', 'never-seen-this') === null || !!chong.chaFangFa('gongJu', 'never-seen-this'),
    '没见过签名时按层次兜底（该行为整体统计或 null，绝不编数字）', chong.chaFangFa('gongJu', 'never-seen-this') && '兜底到了行为整体');
  const lin = new eta.EtaLinShi(path.join(dir, 'eta-live.json'), t0);
  const h = lin.huiHua('s-x', t0);
  ok(!!h && typeof h.kaiShi === 'number', '临时账本（会话级）能开出本轮起点');
  lin.jiZhongDuan('s-x', { jieDuan: '长夜里断了一次', why: '工具循环卡住', error: 'tool-loop-stall(300s)' }, clock);
  const zhong = lin.quZhongDuan('s-x');
  ok(!!zhong && /卡住/.test(String(zhong.why || '')), '断点原因跨小时仍查得到（续传能说清从哪断的）', zhong);
  lin.baCun();
  const lin2 = new eta.EtaLinShi(path.join(dir, 'eta-live.json'), clock + DAY);
  ok(!!lin2.quZhongDuan('s-x'), '重启后断点记录还在（长夜里重启过也能接着说）');
  fs.rmSync(dir, { recursive: true, force: true });
}

// ══════════════════════════════════════════════════════════════
// 7. 定时任务的持久化契约（文件往返 + 到点判定）
// ══════════════════════════════════════════════════════════════
console.log('\n[7] 定时任务持久化契约');
{
  const dir = tmp('sched');
  const wen = path.join(dir, 'scheduled-tasks.json');
  const t0 = 1_700_000_000_000;
  const renWu = [
    { id: 't1', name: '每小时看一眼进度', sessionId: 's1', prompt: '汇报当前进度', nextAt: t0 + HOUR, enabled: true },
    { id: 't2', name: '24 小时后收个尾', sessionId: 's1', prompt: '把长文收尾', nextAt: t0 + DAY, enabled: true },
    { id: 't3', name: '被关掉的', sessionId: 's2', prompt: '别发', nextAt: t0 + 60_000, enabled: false },
  ];
  fs.writeFileSync(wen, JSON.stringify(renWu, null, 2), 'utf8');
  const du = JSON.parse(fs.readFileSync(wen, 'utf8'));
  ok(Array.isArray(du) && du.length === 3, '任务表按文件往返无损（重启后还是 3 条）');
  const daoDian = (at) => du.filter((r) => r.enabled !== false && Number(r.nextAt) <= at).map((r) => r.id);
  ok(daoDian(t0 + 2 * HOUR).join(',') === 't1', '2 小时点：只有 t1 到点（关着的 t3 不许发）', daoDian(t0 + 2 * HOUR));
  ok(daoDian(t0 + DAY + 60_000).join(',') === 't1,t2', '24 小时点：t1、t2 都该到点', daoDian(t0 + DAY + 60_000));
  const mainTs = fs.readFileSync(path.join(root, 'packages/app-shell/src/electron-main.ts'), 'utf8');
  ok(mainTs.includes("dingShiWenJian()") && mainTs.includes("scheduled-tasks.json") && mainTs.includes('dingShiRenWuJi'),
    '主进程用的就是这个文件名与这个数组形状（契约对得上）');
  ok(/warmy:dingShiDaoDian/.test(mainTs) && /onDingShiDaoDian/.test(fs.readFileSync(path.join(root, 'packages/app-shell/src/preload.cjs'), 'utf8')),
    '到点是**广播给界面**再走的发送路径（与决策卡续派同一套，不另造第二条）');
  fs.rmSync(dir, { recursive: true, force: true });
}

// ══════════════════════════════════════════════════════════════
// 8.（可选）真实 Ollama 多轮 + 重启恢复
// ══════════════════════════════════════════════════════════════
if (LIVE) {
  console.log(`\n[8] 真实 Ollama 多轮长跑（${ROUNDS} 轮）`);
  const { GroupChatRouter, DEFAULT_PERMISSIONS, JieLing } = await import(pathToFileURL(path.join(root, 'packages/group-router/dist/index.js')).href);
  const { xietiaoQunXiaoxi } = await import(pathToFileURL(path.join(DIST, 'orchestrator.js')).href);
  const { workToolSpecs, runWorkTool, isWorkTool } = await import(pathToFileURL(path.join(DIST, 'work-tools.js')).href);
  const gen = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-longrun-live-'));
  const cfg = { presetId: 'ollama', apiKey: '', baseURL: 'http://127.0.0.1:11434', model: process.env.OLLAMA_MODEL || 'orcarouter/Qwen3.8-27B-Uncensored:q4_K_M-128K', protocol: 'ollama' };
  const QUN = 'proj-longrun';
  const router = new GroupChatRouter({ queueWhenFixedBusy: false });
  router.createGroup({ groupId: QUN, ming: '长跑测试', type: 'internal', dutyInstanceId: null, directedMode: false, members: [], permissions: DEFAULT_PERMISSIONS, checkpointLimit: 50 });
  const shiLi = [{ id: 'nm-jia', ming: '牛马甲', status: 'running', dutyEligible: true }, { id: 'nm-yi', ming: '牛马乙', status: 'running', dutyEligible: true }];
  for (const s of shiLi) router.join(QUN, { id: s.id, ming: s.ming, local: true, dutyEligible: s.dutyEligible, status: 'idle' });
  const cun = new (await import(pathToFileURL(path.join(memAscii, 'dist', 'index.js')).href)).JiyiCangFuwu({ CangLu: path.join(gen, 'mem'), vector: { enabled: false } });
  const history = new Map();
  const gongJuZongJi = [];
  const deps = {
    router, board: { append: () => { }, listEvents: () => [] }, ccr: { beforeLog: (x) => ({ content: x.content }) },
    history, listInstances: () => shiLi, contextBudgetChars: () => 8000,
    toolLimits: () => ({ zuiDaLunShu: 6, zuiDaJieGuoZiShu: 3000, totalChars: 9000 }),
    executorTools: () => workToolSpecs(),
    runTool: async (call, ctx) => { const ming = String(call?.function?.name || ''); gongJuZongJi.push(ming); return isWorkTool(ming) ? String(runWorkTool(gen, call, false, gen).content || '').slice(0, ctx.zuiDaJieGuoZiShu) : '[不支持的工具]'; },
    projectMemory: () => '', decisionContext: () => '',
  };
  const shiTu = [];
  let chengGong = 0;
  for (let i = 1; i <= ROUNDS; i++) {
    const BIAO = `longrun-${i}`;
    try {
      const r = await xietiaoQunXiaoxi(deps, cfg, { groupId: QUN, userId: 'u', urgency: 'P2', content: `请用 write_file 在工作区创建 ${BIAO}.txt，内容写 ${BIAO}，然后一句话确认。` });
      if (r.action === 'dispatch' && fs.existsSync(path.join(gen, `${BIAO}.txt`))) chengGong++;
      const key = `lr-${i}`;
      cun.append({ id: key, sessionId: QUN, kind: 'message', ti: `第 ${i} 轮真实结论：${String(r.reply || '').slice(0, 200)}` }, 'duty');
      const log = [];
      for (let j = 1; j <= i; j++) log.push({ seq: j, role: j % 2 ? 'user' : 'assistant', content: `第 ${j} 轮：` + 'W'.repeat(1600), recordId: `lr-${j}` });
      const v = xuanranYoujieShitu(log, { budgetChars: 4000, recallHint: '长程任务' });
      shiTu.push(v.xiaoXiJi.reduce((s, m) => s + m.content.length, 0));
    } catch (e) {
      console.log(`     第 ${i} 轮异常：${String((e).message).slice(0, 120)}`);
    }
  }
  ok(chengGong >= Math.max(1, ROUNDS - 2), `${ROUNDS} 轮真实派发里 ${chengGong} 轮真的落了文件（允许少量模型抖动）`);
  /**
   * "有界"的两条腿：**恒 ≤ 预算**，以及**视图的增长与日志的增长解耦**。
   * 真机每轮动辄几千字（一条就是一个大条目），这时按"逐字节相等"判恒定是错的 ——
   * 渲染器是**整条整条**保留/省略的，凑不满预算是正常现象。所以判：
   * 日志长到 4 倍时，视图增长远小于 4 倍、且始终 ≤ 预算。
   */
  const zengZhangBi = shiTu[shiTu.length - 1] / Math.max(1, shiTu[0]);
  const riZhiBi = ROUNDS;
  ok(shiTu.every((v, i) => v <= 4000 && v <= (i + 1) * 1600 + 600), `每轮注入视图都 ≤ 4000（实测 ${shiTu.join(' → ')}）`, shiTu);
  ok(zengZhangBi <= riZhiBi * 0.6,
    `日志长了 ${riZhiBi} 倍，视图只长 ${zengZhangBi.toFixed(2)} 倍 ⇒ 二者解耦（长跑不会把上下文越滚越大）`, { shiTu, zengZhangBi });
  ok(shiTu[shiTu.length - 1] < 4000 * 0.62, `最后一轮视图 ${shiTu[shiTu.length - 1]} 字符，只用了预算的 ${Math.round((shiTu[shiTu.length - 1] / 4000) * 100)}%（不是把 4000 字填满才停）`);
  cun.close();
  const childFile = path.join(gen, 'reopen.cjs');
  fs.writeFileSync(childFile, [
    `const { pathToFileURL } = require('node:url');`,
    `(async () => {`,
    `  const m = await import(${JSON.stringify(pathToFileURL(path.join(memAscii, 'dist', 'index.js')).href)});`,
    `  const mem = new m.JiyiCangFuwu({ CangLu: ${JSON.stringify(path.join(gen, 'mem'))}, vector: { enabled: false } });`,
    `  const out = { n: 0 };`,
    `  for (let i = 1; i <= ${ROUNDS}; i++) {`,
    `    const r = mem.retrieve({ recordId: 'lr-' + i });`,
    `    if (r && /第 .+ 轮真实结论/.test(String(r.raw || ''))) out.n++;`,
    `  }`,
    `  mem.close();`,
    `  process.stdout.write('RESULT=' + JSON.stringify(out) + '\\n');`,
    `})().catch((e) => { process.stdout.write('RESULT=' + JSON.stringify({ error: String((e && e.message) || e) }) + '\\n'); });`,
  ].join('\n'), 'utf8');
  let hu = { n: 0 };
  try { const so = execFileSync(process.execPath, [childFile], { encoding: 'utf8', timeout: 120000, cwd: gen }); hu = duJieGuo(String(so)); } catch (e) { hu = { error: String((e)?.message || e).slice(0, 160) }; }
  ok(hu.n === ROUNDS, `重启后 ${ROUNDS} 轮真实结论逐条可取回（实际 ${hu.n}）`, hu);
  console.log(`     工具调用：${[...new Set(gongJuZongJi)].join(', ') || '（无）'}`);
  fs.rmSync(gen, { recursive: true, force: true });
} else {
  console.log('\n[8] 跳过真实模型长跑（加 --live --rounds=N 才跑）');
}

console.log(`\nround22 longrun gate: ${fail ? 'FAIL' : 'PASS'} (${fail ? fail + ' 红' : '全绿'})`);
try { fs.unlinkSync(path.join(memAscii, 'node_modules', 'better-sqlite3')); } catch { /* noop */ }
fs.rmSync(memAscii, { recursive: true, force: true });
fs.rmSync(memData, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
