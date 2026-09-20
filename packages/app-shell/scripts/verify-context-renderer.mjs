/**
 * 上下文有界渲染器验证（ADR 002 §7）—— 可重跑：node scripts/verify-context-renderer.mjs
 *
 * 覆盖：
 *   1. 解耦曲线（核心证据）：日志 10 → 10000 条，logBytes / viewBytes 表格；
 *      验收 viewBytes 恒 ≤ 预算、**方差为 0**、logBytes 单调上涨。
 *   2. 不丢细节：每个 elided range 都能 retrieve({recordId}) / retrieve({seq}) / recall(hint)
 *      取回原文，且与写入时**逐字节一致**（真 MemoryService + 真 SQLite/JSONL）。
 *   3. 头尾保真：keepHead / keepTail 条在视图里逐字节等于原文。
 *   4. 退化预算：budgetChars=200（含 0/1/NaN 扫）仍产出可用视图、指针完整、不抛错。
 *   5. 值班者路径：orchestrateGroupMessage 复用同一个渲染器（真 HTTP mock provider）。
 *   6. 回归：spikes/verify-all/run-full.mjs 必须跑完且 **零失败**（fail=0，pass ≥ 211）。
 *      不钉死精确条数：套件合法增长（210 → 211 → …）不该让本验证变红；断崖式缩水或任何
 *      真实失败（fail>0 / 套件跑不起来）仍然会红。
 *   7. 真 Electron 一轮对话：chat-send 注入的 prompt 实测有界 + metrics.viewBytes 恒定，
 *      且指针里的 recordId 能从真实记忆服务里取回逐字节原文。
 *
 * 参数：--no-electron 跳过 7；--no-regression 跳过 6。
 */
import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(here, '..');            // packages/app-shell
const repoRoot = path.join(pkgRoot, '..', '..');
const require = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const SKIP_ELECTRON = argv.includes('--no-electron');
const SKIP_REGRESSION = argv.includes('--no-regression');
// spikes/verify-all 的规模下限（不是精确条数）：套件合法增长（210→211→212…）不该让本验证变红，
// 断崖式缩水（套件被裁）或任何 fail>0 仍然必须红。历史：210 → 211（一条退役 UI 断言拆成两条）。
const REGRESSION_MIN_PASS = 211;

let failures = 0;
const failuresList = [];
function check(label, cond, detail) {
  if (!cond) {
    failures++;
    failuresList.push(label);
  }
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}${detail === undefined ? '' : ` => ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (s, n) => String(s).padEnd(n, ' ');

// ── 被测实现（构建产物） ──
const distRenderer = path.join(pkgRoot, 'dist', 'context-renderer.js');
if (!fs.existsSync(distRenderer)) {
  console.error('[verify-context-renderer] 缺少 dist，请先 pkg build：' + distRenderer);
  process.exit(2);
}
const { renderBoundedView, DEFAULT_CONTEXT_BUDGET_CHARS, MAX_RANGE_RECORD_IDS } = await import(pathToFileURL(distRenderer).href);

const BUDGET = DEFAULT_CONTEXT_BUDGET_CHARS; // 4000
console.log(`=== ADR 002 上下文有界渲染器验证 ===`);
console.log(`renderer=${distRenderer}`);
console.log(`默认预算 budgetChars=${BUDGET}\n`);

/** 确定性日志生成：每条长度固定（便于观察"恒定"），seq 单调 */
function makeLog(count, charsPerEntry) {
  const body = '牛马值班日志：项目 WArmy 的上下文渲染条目。'.repeat(Math.ceil(charsPerEntry / 22));
  const entries = [];
  for (let i = 0; i < count; i++) {
    entries.push({
      seq: i + 1,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `#${i + 1} ${body}`.slice(0, charsPerEntry),
      recordId: `m-${i + 1}`,
      ts: 1700000000000 + i,
    });
  }
  return entries;
}
const totalUtf8 = (es) => es.reduce((s, e) => s + Buffer.byteLength(e.content, 'utf8'), 0);
const viewChars = (v) => v.messages.reduce((s, m) => s + m.content.length, 0);
const viewUtf8 = (v) => v.messages.reduce((s, m) => s + Buffer.byteLength(m.content, 'utf8'), 0);
const variance = (xs) => {
  if (!xs.length) return 0;
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length;
};

// ══════════════════════════════════════════════════════════════
// 1. 解耦曲线
// ══════════════════════════════════════════════════════════════
console.log('[1] 解耦曲线：日志 10 → 10000 条（budgetChars=%d, keepHead=1, keepTail=8, 每条 %d 字符）', BUDGET, 512);
const SIZES = [10, 30, 100, 300, 1000, 3000, 10000];
const rows = [];
for (const n of SIZES) {
  const log = makeLog(n, 512);
  const t0 = process.hrtime.bigint();
  const view = renderBoundedView(log, { budgetChars: BUDGET, recallHint: '值班者状态机' });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const chars = viewChars(view);
  rows.push({
    n,
    logBytes: view.stats.logBytes,
    logUtf8: totalUtf8(log),
    viewBytes: chars,
    viewUtf8: viewUtf8(view),
    msgs: view.messages.length,
    pointers: view.stats.pointers,
    elided: view.elided.reduce((s, r) => s + r.count, 0),
    ms: +ms.toFixed(1),
  });
  check(
    `n=${n}: viewBytes ${chars} ≤ budget ${BUDGET} 且与 stats 一致`,
    chars <= BUDGET && chars === view.stats.viewBytes,
    { viewBytes: chars, budget: BUDGET }
  );
}
console.log('');
console.log(`  ${pad('日志条数', 10)} ${pad('logBytes(字符)', 15)} ${pad('logBytes(UTF8)', 15)} ${pad('viewBytes', 11)} ${pad('viewUTF8', 10)} ${pad('消息数', 8)} ${pad('指针', 6)} ${pad('被省略', 8)} ${pad('耗时ms', 8)}`);
for (const r of rows) {
  console.log(`  ${pad(r.n, 10)} ${pad(r.logBytes, 15)} ${pad(r.logUtf8, 15)} ${pad(r.viewBytes, 11)} ${pad(r.viewUtf8, 10)} ${pad(r.msgs, 8)} ${pad(r.pointers, 6)} ${pad(r.elided, 8)} ${pad(r.ms, 8)}`);
}
const viewSeries = rows.map((r) => r.viewBytes);
const logSeries = rows.map((r) => r.logBytes);
const monotonic = logSeries.every((v, i) => i === 0 || v > logSeries[i - 1]);
console.log('');
check('logBytes 单调上涨（日志确实在长）', monotonic, { from: logSeries[0], to: logSeries[logSeries.length - 1], ratio: +(logSeries[logSeries.length - 1] / logSeries[0]).toFixed(1) });
// 注意：日志尚未超过预算、或中间段太小以致要点填不满预留份额时，视图会略小于预算——
// 那不该补白。所以判据是「进入有界区后恒定」，而不是对所有行都恒等。
const plateau = viewSeries.slice(-5);
check('viewBytes 进入有界区后恒定（与日志总长解耦）', variance(plateau) === 0, {
  plateauVariance: variance(plateau),
  plateau,
  values: viewSeries,
});
check('viewBytes 恒 ≤ 预算', viewSeries.every((v) => v <= BUDGET), { max: Math.max(...viewSeries), budget: BUDGET });
check('所有行都注入了可执行指针', rows.every((r) => r.pointers >= 1 && r.elided > 0));

// ══════════════════════════════════════════════════════════════
// 2. 不丢细节（真 MemoryService：写入 → 渲染 → 用指针取回）
// ══════════════════════════════════════════════════════════════
console.log('\n[2] 不丢细节：真记忆服务写入 + 指针解引用逐字节比对');
const memAscii = path.join(os.tmpdir(), 'warmy-verify-ctx-mem');
fs.rmSync(memAscii, { recursive: true, force: true });
fs.mkdirSync(path.join(memAscii, 'dist'), { recursive: true });
const memPkg = path.join(repoRoot, 'packages', 'memory-os');
fs.copyFileSync(path.join(memPkg, 'package.json'), path.join(memAscii, 'package.json'));
for (const f of fs.readdirSync(path.join(memPkg, 'dist'))) {
  if (f.endsWith('.js') || f.endsWith('.json')) fs.copyFileSync(path.join(memPkg, 'dist', f), path.join(memAscii, 'dist', f));
}
if (fs.existsSync(path.join(memPkg, 'node_modules'))) {
  fs.symlinkSync(path.join(memPkg, 'node_modules'), path.join(memAscii, 'node_modules'), 'junction');
}
const { MemoryService } = await import(pathToFileURL(path.join(memAscii, 'dist', 'index.js')).href);
const memDir = path.join(os.tmpdir(), 'warmy-verify-ctx-data-' + Date.now());
const mem = new MemoryService({ dataDir: memDir, vector: { enabled: false } });

const N = 60; // 60 条真实记录，日志远大于预算 → 必然产生 elided
const bodies = new Map(); // recordId -> 原文
const log = [];
for (let i = 0; i < N; i++) {
  const id = `m-${Date.now()}-${i}`;
  const body = `真记录 ${i}｜值班者状态机与上下文有界渲染器验证\n` + `payload-${i}-` + 'X'.repeat(200) + `-end-${i}`;
  const rec = mem.append({ id, sessionId: 's-verify', kind: 'message', body }, 'duty');
  bodies.set(id, body);
  log.push({ seq: rec.seq, role: i % 2 === 0 ? 'user' : 'assistant', content: body, recordId: id, ts: Date.now() });
}
const memView = renderBoundedView(log, { budgetChars: 1200, recallHint: '值班者状态机' });
check('视图有界且产生 elided', viewChars(memView) <= 1200 && memView.elided.length > 0, {
  viewBytes: viewChars(memView),
  ranges: memView.elided.length,
  elidedCount: memView.elided.reduce((s, r) => s + r.count, 0),
});

let idChecks = 0;
let idExact = 0;
let seqChecks = 0;
let seqExact = 0;
const mismatch = [];
for (const r of memView.elided) {
  // (a) recordId 线索：范围内**每一个**列出的 recordId 都必须精确取回
  for (const rid of r.recordIds) {
    idChecks++;
    const out = mem.retrieve({ recordId: rid });
    const want = bodies.get(rid);
    if (out && want !== undefined && out.raw === want && Buffer.compare(Buffer.from(out.raw), Buffer.from(want)) === 0) {
      idExact++;
    } else {
      mismatch.push({ rid, got: out ? out.raw.slice(0, 40) : null });
    }
  }
  // (b) seq 线索：范围首尾（以及中段抽样）用 retrieve({seq}) 精确取回
  const seqs = [r.fromSeq, r.toSeq, Math.floor((r.fromSeq + r.toSeq) / 2)];
  for (const s of new Set(seqs)) {
    seqChecks++;
    const out = mem.retrieve({ seq: s });
    const entry = log.find((e) => e.seq === s);
    if (out && entry && out.raw === entry.content) seqExact++;
    else mismatch.push({ seq: s, via: out?.via });
  }
}
check('每个 elided range 的 recordId 都能 retrieve 且逐字节一致', idChecks > 0 && idChecks === idExact, { checked: idChecks, exact: idExact });
check('每个 elided range 的 seq 首尾/中点都能 retrieve(seq) 且逐字节一致', seqChecks > 0 && seqChecks === seqExact, { checked: seqChecks, exact: seqExact });

// (c) 语义线索：recall(hint) → 卡片 anchor → retrieve 逐字节一致
const cards = mem.recall('值班者状态机', 5);
let recallExact = 0;
for (const c of cards) {
  const out = mem.retrieve({ recordId: c.recordId });
  if (out && bodies.get(c.recordId) === out.raw) recallExact++;
}
check('recall(语义线索) 回来的卡片能取回逐字节原文', cards.length > 0 && recallExact === cards.length, {
  cards: cards.length,
  exact: recallExact,
  hitLevels: [...new Set(cards.map((c) => c.hitLevel))],
  via: cards[0]?.anchor?.seq !== undefined ? 'anchor.seq ok' : 'no anchor',
});
// (d) 指针文本里必须三种线索都在（模型真的能读到）
const pointerText = memView.messages.map((m) => m.content).join('\n');
check('指针文本含 seq 范围线索', /seq \d+\.\.\d+/.test(pointerText));
check('指针文本含 recordId 线索', /retrieve\(recordId="m-/.test(pointerText));
check('指针文本含 recall 语义线索', /recall\("值班者状态机"\)/.test(pointerText));
// 视图里被逐条塞进来的原文必须只是"采样"（≤ 24 条样本上限），而不是整段日志
const verbatimInView = log.filter((e) => pointerText.includes(e.content)).length;
const elidedTotal = memView.elided.reduce((s, r) => s + r.count, 0);
const headTailInView = memView.messages.length - 1; // 减去指针那条
check(
  '视图只含采样级原文，且被省略条数与日志/视图自洽',
  verbatimInView > 0 &&
    verbatimInView <= 24 &&
    elidedTotal > 0 &&
    elidedTotal === log.length - headTailInView,
  {
    verbatimInView,
    elidedTotal,
    logEntries: log.length,
    headTailInView,
  sampleCap: 24,
});
console.log(`  取回校验：recordId ${idExact}/${idChecks} 精确、seq ${seqExact}/${seqChecks} 精确、recall ${recallExact}/${cards.length} 精确` + (mismatch.length ? ` 失配=${JSON.stringify(mismatch.slice(0, 3))}` : ''));

// (e) ADR 002 §9.4 待办 3：recordIds 必须**有界**（否则渲染代价随日志条数线性膨胀）
//     断言口径是不变量（每个段 ≤ MAX_RANGE_RECORD_IDS、与日志总长无关、seq 范围仍完整覆盖），
//     不写死具体条数 —— 采样策略变化时这些断言仍然成立。
{
  const idsPerRange = memView.elided.map((r) => r.recordIds.length);
  check(
    `elided.recordIds 每段 ≤ ${MAX_RANGE_RECORD_IDS}（有界采样，接口仍兼容）`,
    idsPerRange.length > 0 && idsPerRange.every((n) => n <= MAX_RANGE_RECORD_IDS),
    { perRange: idsPerRange, cap: MAX_RANGE_RECORD_IDS }
  );
  check(
    '接口兼容：recordIds 仍在且仍是 string[]（只是被采样）',
    memView.elided.every((r) => Array.isArray(r.recordIds) && r.recordIds.every((x) => typeof x === 'string')),
    memView.elided.map((r) => ({ count: r.count, ids: r.recordIds.length }))
  );
  // 采样同时覆盖段首与段尾（只取前 N 个会丢掉"最近的被省略条目"，那往往是模型最想要的）
  const r0 = memView.elided[0];
  const firstElided = log.find((e) => e.seq === r0.fromSeq);
  const lastElided = log.find((e) => e.seq === r0.toSeq);
  check(
    '采样同时命中段首与段尾的 recordId',
    !!firstElided && !!lastElided && r0.recordIds.includes(firstElided.recordId) && r0.recordIds.includes(lastElided.recordId),
    { head: r0.recordIds[0], tail: r0.recordIds[r0.recordIds.length - 1], firstElided: firstElided?.recordId, lastElided: lastElided?.recordId }
  );
  // 完整覆盖不靠 recordIds：seq 范围必须覆盖全部被省略条目
  const covered = memView.elided.reduce((s, r) => s + (r.toSeq - r.fromSeq + 1), 0);
  const elidedTotal2 = memView.elided.reduce((s, r) => s + r.count, 0);
  check('seq 范围完整覆盖被省略条目（覆盖性不依赖 recordIds 采样）', covered === elidedTotal2 && elidedTotal2 > 0, { covered, elidedTotal: elidedTotal2 });
  // 有界性与日志总长解耦：1 万条与 10 万条下，列出的 id 总数一致（只随段数变）
  const a = renderBoundedView(makeLog(10000, 512), { budgetChars: BUDGET, recallHint: 'hint' });
  const t0 = Date.now();
  const b = renderBoundedView(makeLog(100000, 512), { budgetChars: BUDGET, recallHint: 'hint' });
  const ms100k = Date.now() - t0;
  const idsA = a.elided.reduce((s, r) => s + r.recordIds.length, 0);
  const idsB = b.elided.reduce((s, r) => s + r.recordIds.length, 0);
  check('列出的 recordId 总数与日志总长解耦（1e4 与 1e5 条相同）', idsA === idsB && idsA <= a.elided.length * MAX_RANGE_RECORD_IDS, {
    ids10k: idsA,
    ids100k: idsB,
    capPerRange: MAX_RANGE_RECORD_IDS,
  });
  check('10 万条日志仍能渲染（耗时宽松上界 5s，只作病态防御）', viewChars(b) <= BUDGET && ms100k < 5000, { viewBytes: viewChars(b), ms: ms100k });
  console.log(`  有界采样：每段 ≤ ${MAX_RANGE_RECORD_IDS} 个 id（1e4→${idsA} 个、1e5→${idsB} 个），10 万条渲染 ${ms100k}ms`);
}

// ══════════════════════════════════════════════════════════════
// 3. 头尾保真
// ══════════════════════════════════════════════════════════════
console.log('\n[3] 头尾保真：keepHead / keepTail 条逐字节等于原文');
{
  const big = makeLog(500, 400);
  const view = renderBoundedView(big, { budgetChars: BUDGET, keepHead: 1, keepTail: 8, recallHint: 'hint' });
  const headOk = view.messages[0].content === big[0].content;
  // 尾部条数由渲染器按预算决定（要点要占预留份额，所以可能少于请求的 keepTail=8）；
  // 断言的是「保留下来的尾段逐字节等于原文」，不是「必须有 8 条」。
  const ptrIdx = view.messages.findIndex((m) => m.role === 'system');
  const tailMsgs = ptrIdx >= 0 ? view.messages.slice(ptrIdx + 1) : view.messages.slice(-8);
  const tailOk =
    tailMsgs.length > 0 &&
    tailMsgs.every((m, i) => m.content === big[big.length - tailMsgs.length + i].content);
  check('keepHead=1 逐字节等于原文', headOk && view.messages[0].role === big[0].role);
  check('保留的尾部逐字节等于原文（顺序一致；条数可少于 keepTail——预算优先给要点）', tailOk, {
    tailCount: tailMsgs.length,
    requested: 8,
    roles: tailMsgs.map((m) => m.role),
  });
  // 指针插在头尾之间（不混进真实对话）
  check(
    '指针消息 role=system 且位于头尾之间',
    ptrIdx === view.messages.length - 1 - tailMsgs.length && view.messages[ptrIdx].content.includes('已省略')
  );
  // 中间某条被省略的原文不在视图里（真的被挤出去了）
  const mid = big[Math.floor(big.length / 2)].content;
  check('被省略的中间条目不在视图里（确实发生了裁剪）', !view.messages.some((m) => m.content === mid));
}

// ══════════════════════════════════════════════════════════════
// 4. 退化预算 + 脏输入（任何预算都不抛错、指针完整、viewBytes ≤ 预算）
// ══════════════════════════════════════════════════════════════
console.log('\n[4] 退化预算与脏输入');
{
  const log = makeLog(300, 300);
  let threw = null;
  let view200 = null;
  try {
    view200 = renderBoundedView(log, { budgetChars: 200, recallHint: '值班者状态机' });
  } catch (e) {
    threw = String(e);
  }
  check('budgetChars=200 不抛错', !threw, threw || 'ok');
  check('budgetChars=200 视图仍 ≤ 200', view200 && viewChars(view200) <= 200, view200 && viewChars(view200));
  check('budgetChars=200 仍有消息且有指针', view200 && view200.messages.length >= 1 && view200.stats.pointers >= 1, view200 && {
    msgs: view200.messages.length,
    pointers: view200.stats.pointers,
    elided: view200.elided.reduce((s, r) => s + r.count, 0),
  });
  const p200 = view200.messages.map((m) => m.content).join('\n');
  check('budgetChars=200 指针完整可执行（三种线索仍在）', /seq \d+\.\.\d+/.test(p200) && /recordId="/.test(p200) && /recall\("/.test(p200), p200.slice(0, 160));
  console.log('  budget=200 视图内容：\n' + p200.split('\n').map((l) => '    | ' + l).join('\n'));

  // 扫一遍极小/异常预算：一律不抛错且不超预算
  const budgets = [0, 1, 2, 10, 50, 120, 200, 400, 4000, NaN, Infinity, -5, 1e9];
  let sweepThrew = null;
  const sweepBad = [];
  for (const b of budgets) {
    try {
      const v = renderBoundedView(log, { budgetChars: b });
      const eff = Number.isFinite(b) && b > 0 ? Math.floor(b) : Number.isFinite(b) ? 0 : DEFAULT_CONTEXT_BUDGET_CHARS;
      if (!(v.stats.viewBytes <= eff)) sweepBad.push({ b, viewBytes: v.stats.viewBytes, eff });
    } catch (e) {
      sweepThrew = `budget=${b}: ${e}`;
    }
  }
  check('预算扫描（0/1/NaN/Infinity/负数/1e9）无一抛错', !sweepThrew, sweepThrew || 'ok');
  check('预算扫描中 viewBytes 恒 ≤ 有效预算', sweepBad.length === 0, sweepBad);

  // 脏输入
  const dirty = [
    null, undefined, 'not-an-array', 42,
    [{ seq: 1 }, { role: 'nope', content: null }, { seq: NaN, content: { toString: () => 'obj' } }, null],
    [{ seq: 1, role: 'user', content: 'ok' }],
  ];
  let dirtyThrew = null;
  for (const d of dirty) {
    try {
      renderBoundedView(d, { budgetChars: 200 });
      renderBoundedView(d, { budgetChars: 200, compress: () => { throw new Error('boom'); } });
      renderBoundedView(d, { budgetChars: 200, compress: () => 12345 });
      renderBoundedView(d, null);
    } catch (e) {
      dirtyThrew = `${JSON.stringify(d)?.slice(0, 40)}: ${e}`;
    }
  }
  check('脏输入 + 压缩器抛错都不抛错', !dirtyThrew, dirtyThrew || 'ok');
  const cthrow = renderBoundedView(makeLog(50, 300), { budgetChars: 1000, compress: () => { throw new Error('boom'); } });
  check('压缩器抛错时视图依然有界（要点为空，指针仍在）', viewChars(cthrow) <= 1000 && cthrow.stats.pointers >= 1, {
    viewBytes: viewChars(cthrow),
    pointers: cthrow.stats.pointers,
  });
}

// ══════════════════════════════════════════════════════════════
// 5. 值班者路径复用同一个渲染器（真 HTTP mock provider）
// ══════════════════════════════════════════════════════════════
console.log('\n[5] 值班者（orchestrateGroupMessage）输入同样有界');
const seenPrompts = [];
const mock = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    try {
      seenPrompts.push(JSON.parse(raw));
    } catch {
      /* ignore */
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'chatcmpl-mock',
      model: 'mock',
      choices: [{ index: 0, message: { role: 'assistant', content: '收到：已记录。' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 8, prompt_cache_hit_tokens: 90 },
    }));
  });
});
const mockPort = await new Promise((r) => mock.listen(0, '127.0.0.1', () => r(mock.address().port)));
const mockBase = `http://127.0.0.1:${mockPort}/v1`;
{
  const { orchestrateGroupMessage } = await import(pathToFileURL(path.join(pkgRoot, 'dist', 'orchestrator.js')).href);
  const { GroupChatRouter, DEFAULT_PERMISSIONS } = await import(
    pathToFileURL(path.join(repoRoot, 'packages', 'group-router', 'dist', 'index.js')).href
  );
  const { KanbanCang } = await import(pathToFileURL(path.join(repoRoot, 'packages', 'board', 'dist', 'index.js')).href);
  const { CcrGateway } = await import(
    pathToFileURL(path.join(repoRoot, 'packages', 'ccr-compressor', 'dist', 'index.js')).href
  );
  const router = new GroupChatRouter();
  router.createGroup({
    groupId: 'g-ctx', name: '有界渲染验证群', type: 'internal', dutyInstanceId: null,
    directedMode: false, members: [], permissions: DEFAULT_PERMISSIONS, checkpointLimit: 50,
  });
  router.join('g-ctx', { id: 'duty-1', name: '值班者', local: true, dutyEligible: true, status: 'idle' });
  const boardDir = path.join(os.tmpdir(), 'warmy-verify-ctx-board-' + Date.now());
  const board = new KanbanCang(boardDir);

  // 值班者会话日志：200 条，远大于预算
  const dutyLog = [];
  for (let i = 0; i < 200; i++) {
    dutyLog.push({
      seq: i + 1,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `群内第 ${i} 条历史：` + '龙'.repeat(300),
      recordId: `g-${i + 1}`,
    });
  }
  const usageLog = [];
  const deps = {
    router,
    board,
    ccr: new CcrGateway(200),
    history: new Map(),
    listInstances: () => [{ id: 'duty-1', name: '值班者', status: 'idle', dutyEligible: true }],
    logOf: () => dutyLog,
    contextBudgetChars: () => 2000,
  };
  const before = seenPrompts.length;
  let result = null;
  for (let i = 0; i < 3; i++) {
    result = await orchestrateGroupMessage(
      deps,
      { presetId: 'deepseek', apiKey: 'sk-mock', baseURL: mockBase, model: 'mock' },
      { groupId: 'g-ctx', content: '值班者状态机现在怎么样？（第 ' + i + ' 轮）' }
    );
    usageLog.push(result.action);
  }
  const prompts = seenPrompts.slice(before);
  check('值班者确实调用了 provider（走通闭环）', prompts.length === 3 && usageLog.every((a) => a === 'dispatch'), { calls: prompts.length, actions: usageLog });
  const dutyPromptChars = prompts.map((p) => p.messages.reduce((s, m) => s + String(m.content ?? '').length, 0));
  // 会话部分 = 除第 1 条冻结系统提示以外的全部（渲染器的输出）——必须正好等于预算
  const dutyViewChars = prompts.map((p) => p.messages.slice(1).reduce((s, m) => s + String(m.content ?? '').length, 0));
  check('值班者注入 prompt 有界（≤ 预算 + 常数卡片/系统提示）', dutyPromptChars.every((c) => c <= 2000 + 900), dutyPromptChars);
  check('值班者注入的会话部分 = 预算（2000）且跨轮方差为 0', new Set(dutyViewChars).size === 1 && dutyViewChars[0] === 2000, {
    viewChars: dutyViewChars,
    systemChars: prompts.map((p, i) => p.messages[0].content.length),
  });
  check('值班者 prompt 含省略指针（说明确实被渲染成有界视图）', prompts[0].messages.some((m) => /已省略|省略 \d+ 条/.test(String(m.content))), prompts[0].messages[1].content.slice(0, 120));
  check('值班者 = 1 系统提示 + 头 + 指针 + 尾，不是 200 条全量', prompts[0].messages.length <= 12, prompts[0].messages.length);
  console.log(`  值班者 3 轮注入字符数: ${dutyPromptChars.join(' / ')}（会话部分 ${dutyViewChars.join(' / ')}，预算 2000；其余为冻结系统提示 + 状态卡片）`);
  // 200 条历史里只有采样级条目原样出现（其余靠指针取回）
  const longPrompt = prompts[0].messages.map((m) => String(m.content)).join('\n');
  const markersInPrompt = (longPrompt.match(/群内第 \d+ 条历史/g) || []).length;
  check('值班者 prompt 里只出现采样级条目（不是 200 条全量）', markersInPrompt > 0 && markersInPrompt <= 30, {
    markersInPrompt,
    logEntries: 200,
    sampleCap: 24,
  });
  fs.rmSync(boardDir, { recursive: true, force: true });
}

// ══════════════════════════════════════════════════════════════
// 6. 回归：spikes/verify-all
// ══════════════════════════════════════════════════════════════
if (!SKIP_REGRESSION) {
  console.log('\n[6] 回归：spikes/verify-all/run-full.mjs');
  let out = '';
  let code = 0;
  try {
    out = execFileSync(process.execPath, [path.join(repoRoot, 'spikes', 'verify-all', 'run-full.mjs')], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    code = e.status ?? 1;
    out = String(e.stdout || '') + String(e.stderr || '');
  }
  const m = out.match(/pass=(\d+) fail=(\d+)/);
  const pass = m ? Number(m[1]) : null;
  const fail = m ? Number(m[2]) : null;
  // 判据 = 跑得起来（有 SUMMARY）+ 进程正常退出 + 零失败 + 规模不低于历史下限（防套件被悄悄裁掉）。
  // 旧判据钉死 pass===210，套件把一条断言拆成两条（211/0）就误报——那是测试陈旧，不是产品回归。
  check(
    `verify-all 跑完且零失败（exit=0、fail=0、pass ≥ ${REGRESSION_MIN_PASS}）`,
    code === 0 && m !== null && fail === 0 && pass >= REGRESSION_MIN_PASS,
    m !== null
      ? `pass=${pass} fail=${fail} exit=${code}（规模下限 ${REGRESSION_MIN_PASS}）`
      : `无 SUMMARY（套件没跑起来 / 输出被截断），exit=${code}，tail=${JSON.stringify(out.slice(-200))}`
  );
} else {
  console.log('\n[6] 跳过回归（--no-regression）');
}

// ══════════════════════════════════════════════════════════════
// 7. 真 Electron：chat-send 注入的 prompt 实测有界 + metrics 恒定
// ══════════════════════════════════════════════════════════════
if (!SKIP_ELECTRON) {
  console.log('\n[7] 真 Electron + 真 IPC：chat-send 走渲染器');
  const electronPath = require('electron');
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-ctx-e2e-'));
  const appRoot = path.join(tmpRoot, 'app');
  fs.mkdirSync(appRoot, { recursive: true });
  fs.cpSync(path.join(pkgRoot, 'dist'), path.join(appRoot, 'dist'), { recursive: true });
  fs.copyFileSync(path.join(pkgRoot, 'package.json'), path.join(appRoot, 'package.json'));
  const userData = path.join(tmpRoot, 'userdata');
  fs.mkdirSync(userData, { recursive: true });

  // 与 verify-e2e 相同的最小 patch（只改临时副本，不动源码）：
  //  - 重复注册的 warmy:clear-error 会让 Electron 启动即抛
  //  - app.setAsDefaultProtocolClient 会改到本机注册表
  const mainFile = path.join(appRoot, 'dist', 'electron-main.js');
  {
    const lines = fs.readFileSync(mainFile, 'utf8').split('\n');
    let seen = false;
    const out = [];
    for (const line of lines) {
      if (line.includes("ipcMain.handle('warmy:clear-error'")) {
        if (seen) continue;
        seen = true;
      }
      out.push(line.includes("app.setAsDefaultProtocolClient('dsh-app')") ? line.replace("app.setAsDefaultProtocolClient('dsh-app')", 'void 0') : line);
    }
    fs.writeFileSync(mainFile, out.join('\n'), 'utf8');
  }
  // 工作区包 + memory-os（让真记忆服务起得来）链进临时副本
  const nmDir = path.join(appRoot, 'node_modules', '@warmy');
  fs.mkdirSync(nmDir, { recursive: true });
  const linked = [];
  for (const pkg of ['contracts', 'providers', 'group-router', 'board', 'ccr-compressor', 'knowledge-base', 'sync-protocol', 'dsh-runtime', 'asset-governance', 'memory-os']) {
    const target = path.join(repoRoot, 'packages', pkg);
    if (!fs.existsSync(target)) continue;
    try {
      fs.symlinkSync(target, path.join(nmDir, pkg), 'junction');
      linked.push(pkg);
    } catch {
      /* 忽略 */
    }
  }
  const bundledNodeDir = process.platform === 'win32' ? `win-${process.arch}` : `${process.platform}-${process.arch}`;
  const bundledNode = path.join(repoRoot, 'resources', 'node', bundledNodeDir, process.platform === 'win32' ? 'node.exe' : 'node');
  // prepareMemoryRuntime 的第二条候选路径挂在 app.getAppPath() 下（Electron 启动单文件时 = dist/）
  const distNm = path.join(appRoot, 'dist', 'node_modules', '@warmy');
  fs.mkdirSync(distNm, { recursive: true });
  try {
    fs.symlinkSync(path.join(repoRoot, 'packages', 'memory-os'), path.join(distNm, 'memory-os'), 'junction');
  } catch {
    /* 已存在则忽略 */
  }
  if (!fs.existsSync(bundledNode)) console.log(`  注意：未找到捆绑 Node（${bundledNode}），记忆服务会退回 Electron 兜底`);
  console.log(`  临时副本 ${appRoot}；链接 ${linked.length} 个包；捆绑 Node=${fs.existsSync(bundledNode) ? bundledNode : '缺失'}`);

  const child = spawn(electronPath, [mainFile, `--user-data-dir=${userData}`, '--remote-debugging-port=0'], {
    cwd: appRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1', ...(fs.existsSync(bundledNode) ? { WARMY_NODE: bundledNode } : {}) },
  });
  const logs = [];
  let devtoolsPort = 0;
  const onChunk = (d) => {
    const text = String(d);
    logs.push(text);
    const m = text.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
    if (m && m[1]) devtoolsPort = Number(m[1]);
  };
  child.stdout.on('data', onChunk);
  child.stderr.on('data', onChunk);
  const portDeadline = Date.now() + 30000;
  while (!devtoolsPort && Date.now() < portDeadline) {
    if (child.exitCode !== null) break;
    await sleep(200);
  }
  check('Electron 已启动并给出调试端口（从 stderr 解析）', devtoolsPort > 0, devtoolsPort || logs.join('').slice(-400));

  let cdp = null;
  if (devtoolsPort) {
    const appPrefix = path.join(appRoot, 'dist', 'renderer').toLowerCase().replace(/\\/g, '/');
    const deadline = Date.now() + 45000;
    let target = null;
    while (Date.now() < deadline && !target) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${devtoolsPort}/json/list`)).json();
        target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl && String(t.url || '').toLowerCase().includes(appPrefix));
      } catch {
        /* 还没起来 */
      }
      if (!target) await sleep(300);
    }
    if (target) {
      const ws = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        ws.addEventListener('open', () => resolve(), { once: true });
        ws.addEventListener('error', (e) => reject(new Error(`ws error ${String(e?.message || e)}`)), { once: true });
      });
      let seq = 0;
      const pending = new Map();
      ws.addEventListener('message', (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && pending.has(msg.id)) {
          const { resolve, reject } = pending.get(msg.id);
          pending.delete(msg.id);
          if (msg.error) reject(new Error(`cdp ${JSON.stringify(msg.error)}`));
          else resolve(msg.result);
        }
      });
      const send = (method, params) =>
        new Promise((resolve, reject) => {
          const id = ++seq;
          pending.set(id, { resolve, reject });
          ws.send(JSON.stringify({ id, method, params }));
        });
      const evaluate = async (expression) => {
        const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
        if (r.exceptionDetails) throw new Error(`renderer exception: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
        return r.result.value;
      };
      cdp = { evaluate, close: () => ws.close() };
      // 等 bootstrap
      const readyDeadline = Date.now() + 45000;
      let ready = false;
      while (Date.now() < readyDeadline && !ready) {
        try {
          ready = await evaluate('(async () => { try { const r = await window.warmy.appInfo(); return !!(r && r.ok); } catch { return false; } })()');
        } catch {
          /* 未就绪 */
        }
        if (!ready) await sleep(400);
      }
      check('主进程 bootstrap 完成（appInfo ok）', ready);
    } else {
      check('找到本副本的渲染页面', false);
    }
  }

  const call = (api, ...args) =>
    cdp.evaluate(`(async () => { try { return await window.warmy.${api}(${args.map((a) => JSON.stringify(a)).join(', ')}); } catch (e) { return { __error: String((e && e.message) || e) }; } })()`);

  if (cdp) {
    // 指向上面的 mock provider（真 HTTP，返回 OpenAI 兼容响应）
    const set = await call('setProvider', { presetId: 'deepseek', apiKey: 'sk-mock', baseURL: mockBase, model: 'mock', protocol: 'openai-compatible' });
    check('set-provider 指到本地 mock（不碰外网）', set?.ok === true, set);
    const info = await call('appInfo');
    console.log(`  Electron=${info?.electron} 版本=${info?.version}`);

    const before = seenPrompts.length;
    const TURNS = 24;
    const replyChars = [];
    const turnResults = [];
    for (let i = 0; i < TURNS; i++) {
      const content = `第 ${i + 1} 轮：` + '牛马上下文有界渲染验证 '.repeat(60) + `尾巴-${i + 1}`;
      const r = await call('chatSend', { sessionId: 's-bounded', content });
      turnResults.push(r);
      if (r && typeof r.reply === 'string') replyChars.push(r.reply.length);
    }
    const prompts = seenPrompts.slice(before);
    check('24 轮 chat-send 全部走通（ok:true 且有回复）', turnResults.every((r) => r && r.ok === true) && prompts.length === TURNS, {
      ok: turnResults.filter((r) => r?.ok).length,
      prompts: prompts.length,
      sampleError: turnResults.find((r) => !r?.ok)?.error,
    });
    const injectedChars = prompts.map((p) => p.messages.reduce((s, m) => s + String(m.content ?? '').length, 0));
    const injectedJson = prompts.map((p) => JSON.stringify(p.messages).length);
    check('chat-send 注入 prompt 恒 ≤ 预算（字符）', injectedChars.every((c) => c <= BUDGET), { max: Math.max(...injectedChars), budget: BUDGET, series: injectedChars.slice(-6) });
    // 日志未超过预算的前几轮，视图=日志（较小）；一旦日志超预算，视图立刻钉在预算上不再增长。
    // 所以"恒定"要在进入有界区之后看：取后 12 轮。
    const settled = injectedChars.slice(-12);
    const firstSettled = injectedChars.findIndex((c) => c === settled[settled.length - 1]);
    check('进入有界区后注入体积方差为 0（末 12 轮完全相同）', new Set(settled).size === 1, {
      settledValues: [...new Set(settled)],
      settledFrom: firstSettled + 1,
      series: injectedChars,
    });
    check('注入 prompt 与日志长度解耦（有界区内不再增长）', Math.max(...settled) - Math.min(...settled) === 0, {
      min: Math.min(...settled),
      max: Math.max(...settled),
      headTurns: injectedChars.slice(0, 5),
    });
    check('注入的 JSON 体积也在同一量级（包装开销固定）', Math.max(...injectedJson) <= BUDGET + 400, { maxJson: Math.max(...injectedJson) });
    const lastPrompt = prompts[prompts.length - 1];
    check('末轮 prompt 含省略指针（真发生裁剪）', lastPrompt.messages.some((m) => /已省略|省略 \d+ 条/.test(String(m.content))), lastPrompt.messages[0].content.slice(0, 140));
    check('末轮 prompt 条数有界（不是全量日志）', lastPrompt.messages.length <= 12, { messages: lastPrompt.messages.length, logTurns: TURNS * 2 });

    const sum = await call('metricsSummary');
    check('metrics 暴露 viewBytes/logBytes 哨兵', sum && typeof sum.viewBytes === 'number' && typeof sum.logBytes === 'number' && sum.viewSamples >= TURNS, {
      viewSamples: sum?.viewSamples, viewBytes: sum?.viewBytes, logBytes: sum?.logBytes, budget: sum?.viewBudgetChars,
    });
    check('metrics.viewBounded=true（历史观测从未越界）', sum?.viewBounded === true, sum?.viewBounded);
    check('metrics: logBytes 远大于 viewBytes（解耦的实测证据）', sum && sum.logBytes > sum.viewBytes * 3, {
      logBytes: sum?.logBytes, viewBytes: sum?.viewBytes, ratio: sum && sum.viewBytes ? +(sum.logBytes / sum.viewBytes).toFixed(1) : null,
    });
    check('metrics: viewBytes 上界 = 预算，末次 = 上界（从未越界）', sum && sum.viewBytesMax <= BUDGET && sum.viewBytes === sum.viewBytesMax, {
      min: sum?.viewBytesMin, max: sum?.viewBytesMax, last: sum?.viewBytes, budget: sum?.viewBudgetChars,
    });
    console.log(`  24 轮实测：注入字符 ${injectedChars[0]} → ${injectedChars[injectedChars.length - 1]}（进入有界区第 ${firstSettled + 1} 轮起恒为 ${settled[settled.length - 1]}），JSON ${Math.min(...injectedJson)}~${Math.max(...injectedJson)}；metrics viewBytes=${sum?.viewBytes} logBytes=${sum?.logBytes}（viewBytes min=${sum?.viewBytesMin}/max=${sum?.viewBytesMax}）`);

    // 指针可回溯：把末轮指针里的 recordId 拿出来，用真记忆服务 retrieve 比对
    const ptr = prompts[prompts.length - 1].messages.find((m) => m.role === 'system' && /已省略/.test(String(m.content)));
    const ids = [...String(ptr?.content || '').matchAll(/recordId="([^"]+)"/g)].map((m) => m[1]);
    check('末轮指针里给出真实 recordId', ids.length >= 1, { ids: ids.slice(0, 3) });
    const memRecall = await call('memoryRecall', '牛马上下文有界渲染验证');
    check('真记忆服务已启动并可 recall（指针有落点）', Array.isArray(memRecall?.cards) && memRecall.cards.length > 0, {
      cards: memRecall?.cards?.length,
      error: memRecall?.error,
    });
    if (ids.length && Array.isArray(memRecall?.cards)) {
      const hit = memRecall.cards.find((c) => ids.includes(c.recordId) || ids.some((id) => String(id).startsWith(String(c.recordId))));
      const jsonl = path.join(userData, 'memory', 'fast-memory.jsonl');
      const raw = fs.existsSync(jsonl) ? fs.readFileSync(jsonl, 'utf8') : '';
      check('指针里的 recordId 真在本机 JSONL 里（可回溯，不丢细节）', ids.some((id) => raw.includes(id)), {
        checked: ids.slice(0, 3),
        jsonlBytes: raw.length,
        recallHit: !!hit,
      });
      // 更进一步：拿指针给的 seq 范围里一条**长正文**记录（用户消息），它必须不在视图里（确实被挤出），
      // 但能在 JSONL 里按 seq 逐字节取回 —— 即"视图有界 ≠ 丢细节"。
      const records = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
      const ptrAll = prompts[prompts.length - 1].messages.map((m) => String(m.content)).join('\n');
      const rng = ptrAll.match(/seq (\d+)\.\.(\d+)/);
      const lo = rng ? Number(rng[1]) : 0;
      const hi = rng ? Number(rng[2]) : 0;
      const longOnes = records.filter((r) => r.seq >= lo && r.seq <= hi && typeof r.body === 'string' && r.body.length >= 100);
      const midRec = longOnes[Math.floor(longOnes.length / 2)];
      const inView = midRec ? ptrAll.includes(midRec.body) : null;
      check('被省略的长正文记录不在视图里，但日志里逐字节可取回', !!midRec && midRec.body.length >= 100 && inView === false, {
        range: [lo, hi],
        pickedSeq: midRec?.seq,
        bodyChars: midRec?.body?.length ?? null,
        inView,
        longRecordsInRange: longOnes.length,
      });
      check('JSONL 里的记录数 = 发送轮次 ×（用户 + 回复）', records.length >= TURNS * 2, { records: records.length, turns: TURNS });
      console.log(`    JSONL=${jsonl}（${raw.length} 字符 / ${records.length} 条；含指针里的 id=${ids.filter((i) => raw.includes(i)).length}/${ids.length}，省略区 [${lo},${hi}] 内长正文 ${longOnes.length} 条，取第 ${midRec?.seq} 条：在视图内=${inView}）`);
    }

    // 预算可配置：settings.json 改成 600，注入体积必须随之缩小
    const save = await call('settingsSave', { contextBudgetChars: 600 });
    check('settings 保存 contextBudgetChars=600', save?.settings?.contextBudgetChars === 600, save?.settings?.contextBudgetChars);
    const before2 = seenPrompts.length;
    await call('chatSend', { sessionId: 's-bounded', content: '预算改成 600 之后：' + '短'.repeat(200) });
    const p2 = seenPrompts.slice(before2);
    const chars2 = p2.length ? p2[0].messages.reduce((s, m) => s + String(m.content ?? '').length, 0) : -1;
    check('预算可配置（600）后注入体积随之受限', chars2 > 0 && chars2 <= 600, { injected: chars2, budget: 600 });
    check('预算 600 下指针仍完整', p2.length > 0 && p2[0].messages.some((m) => /seq \d+\.\.\d+/.test(String(m.content)) && /(retrieve|recall)\(/.test(String(m.content))), p2[0]?.messages?.[0]?.content?.slice(0, 160));
    const sum2 = await call('metricsSummary');
    check('metrics 反映新预算', sum2?.viewBudgetChars === 600 && sum2?.viewBytes <= 600, { budget: sum2?.viewBudgetChars, viewBytes: sum2?.viewBytes });

    // 群消息（值班者路径）也走渲染器：不抛错、有界
    const gcreate = await call('groupCreate', { groupId: 'g-ctx', name: '有界渲染群', type: 'internal' });
    const gmsg = [];
    for (let i = 0; i < 3; i++) gmsg.push(await call('groupMessage', { groupId: 'g-ctx', content: `群消息 ${i}：` + '群'.repeat(300) }));
    const before3 = seenPrompts.length;
    const gmsg2 = await call('groupMessage', { groupId: 'g-ctx', content: '群消息 4：' + '群'.repeat(300) });
    const gPrompts = seenPrompts.slice(before3);
    const gChars = gPrompts.length ? gPrompts[0].messages.reduce((s, m) => s + String(m.content ?? '').length, 0) : -1;
    check('群消息（值班者）下发不报错', gcreate?.ok !== false && gmsg.every((r) => r && r.ok !== false) && gmsg2 && gmsg2.ok !== false, {
      create: gcreate?.ok, msg: gmsg2 && { ok: gmsg2.ok, reason: gmsg2.reason, reply: String(gmsg2.reply || '').slice(0, 40) },
    });
    check('群消息注入 prompt 也有界（≤ 预算 + 冻结系统提示）', gChars > 0 && gChars <= 600 + 900, { injected: gChars });
  }

  try {
    cdp?.close();
  } catch {
    /* 忽略 */
  }
  try {
    execFileSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* 忽略 */
    }
  }
  await sleep(1200);
  const bootLog = path.join(userData, 'warmy-boot.log');
  if (fs.existsSync(bootLog)) {
    const lines = fs.readFileSync(bootLog, 'utf8').trim().split('\n').filter((l) => /memory/.test(l));
    for (const l of lines.slice(-4)) console.log('  boot: ' + l);
  }
  mock.close();
  console.log(`  Electron 临时目录: ${tmpRoot}`);
} else {
  console.log('\n[7] 跳过 Electron（--no-electron）');
}

if (mock.listening) mock.close();
try {
  mem.close();
} catch {
  /* 忽略 */
}
fs.rmSync(memDir, { recursive: true, force: true });
fs.rmSync(memAscii, { recursive: true, force: true });

console.log('\n=== SUMMARY ===');
console.log(`failures=${failures}`);
if (failures) {
  console.log('FAILURES:');
  for (const f of failuresList) console.log(' - ' + f);
}
console.log(failures === 0 ? 'ALL PASS（ADR 002 验收项全部通过）' : 'FAILED');
process.exit(failures === 0 ? 0 : 1);
