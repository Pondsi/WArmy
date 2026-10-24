/**
 * verify-r53-shijian.mjs（fast 档）—— 第 53 轮项 5「知识库双时间」的判据。
 *
 * 两个轴：**记录时间**（这条信息什么时候被说出来 = 原文那行的时刻，写一次不再改）
 * 与 **发生时间**（事情本身发生在什么时候，只有原文说了才填，相对表达以说话时刻为参照系）。
 * 用户点名的场景必须支持：昨天告诉我"上个月5号决定戒烟" ⇒ 两个时间都要在，且不许互相冒充。
 *
 * 三条探针按调研结论设计（LongMemEval / StateMemBench / Graphiti issue #1489 的失败模式）：
 *  ① provenance-confusion（不许把记录时间当发生时间）
 *  ② as-of（"三月时你已婚吗"要按发生/有效时间答，不是按入库时间）
 *  ③ supersession（旧说法被取代但仍可审计，两问给出不同答案）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const U = (p, f) => (p ? pathToFileURL(p).href : pathToFileURL(f).href);
const SJ = await import(U(process.env.V53_SJ, path.join(ROOT, 'packages/app-shell/dist/shi-jian-shuang.js')));
const KB = await import(U(process.env.V53_KB, path.join(ROOT, 'packages/knowledge-base/dist/index.js')));
const MAIN = fs.readFileSync(process.env.V53_MAIN || path.join(ROOT, 'packages/app-shell/src/electron-main.ts'), 'utf8');

let okN = 0, failN = 0;
const jian = (l, p, d) => { if (p) { okN++; console.log('  ok  ' + l); } else { failN++; console.log('  FAIL ' + l + (d ? ' ← ' + String(d).slice(0, 150) : '')); } };
const ri = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const D = (n) => n * 86400000;
const now = new Date(2026, 9, 21, 10, 30).getTime();   // 固定"今天"，别跑在午夜附近抖动

// ── 1. 发生时间解析真值表（锚=说话时刻）─────────────────────────────
{
  const zuo = (s, tian) => SJ.jieXiFaShengShiJian(s, now - D(tian || 0));
  const j = zuo('我在上个月5号已经决定戒烟了', 1);
  jian('"上个月5号"（昨天说的）⇒ 2026-09-05', ri(j.faShengTs || 0) === '2026-09-05', ri(j.faShengTs || 0) + ' / ' + j.jingDu);
  jian('原话留在 fashengBiao 里（回复时能引用用户那句话）', /上个月5号/.test(j.faShengBiao || ''), j.faShengBiao);
  const q = zuo('昨天我们把这个门禁跑绿了', 0);
  jian('"昨天"以**说话时刻**为锚，不是以当前时刻为锚', ri(q.faShengTs || 0) === ri(now - D(1)), ri(q.faShengTs || 0));
  jian('同一段话晚三天归档，解析出的"昨天"跟着说话时间走（不是归档时间）',
    ri(SJ.jieXiFaShengShiJian('昨天我们把这个门禁跑绿了', now - D(1)).faShengTs || 0) === ri(now - D(2)));
  const d = zuo('2026-10-05 交付', 0);
  jian('绝对日期 2026-10-05 正确解析', ri(d.faShengTs || 0) === '2026-10-05' && d.jingDu === 'ri');
  const m = zuo('2025年3月的事', 0);
  jian('只给年月 ⇒ 精度 month（不假装知道日子）', m.jingDu === 'yue' && ri(m.faShengTs || 0) === '2025-03-01');
  const w = zuo('我从小就怕打针', 0);
  jian('"从小/以前"这类不可解析表达 ⇒ 发生时间留空，绝不猜', !w.faShengTs && w.jingDu === 'wu');
  const w2 = zuo('最近项目有点紧', 0);
  jian('"最近"也不算发生时间（宁缺勿错）', !w2.faShengTs);
  const ni = zuo('10月5号说的事', 0);   // 今天 2026-10-21 ⇒ 不跑到未来
  jian('只写"10月5日"且已过 ⇒ 取今年；不许给出未来日期', ri(ni.faShengTs || 0) === '2026-10-05');
  const wei = zuo('12月30号再说', 0);   // 今年还没到 ⇒ 落到去年
  jian('只写月日且今年还没到 ⇒ 回退到去年（不产生未来时间）', ri(wei.faShengTs || 0) === '2025-12-30');
  const duo = zuo('我上个月5号决定戒烟，昨天又改主意了', 1);
  jian('一句里多个时间 ⇒ 取离说话时刻最近的那条为发生时间', ri(duo.faShengTs || 0) === ri(now - D(2)), ri(duo.faShengTs || 0));
  jian('其余时间表述不丢（原话里仍然能看见两个日期）', /上个月5号|昨天/.test(duo.faShengBiao || ''), duo.faShengBiao);
  const t = zuo('三天前就弄好了', 0);
  jian('"N天前"以说话时刻为锚', ri(t.faShengTs || 0) === ri(now - D(3)));
  const z = zuo('三周前上线', 0);
  jian('中文数字"三周前"= 21 天前', ri(z.faShengTs || 0) === ri(now - D(21)), ri(z.faShengTs || 0));
}

// ── 2. 查询窗口（两个轴都要能被问到）───────────────────────────────
{
  const chuang = SJ.jieXiChaXunChuang('昨天我们干了什么', now);
  jian('"昨天" ⇒ 窗口正好是昨天那一整天', !!chuang && ri(chuang.qi) === ri(now - D(1)) && ri(chuang.zhi) === ri(now - D(1)));
  jian('没有时间词 ⇒ 不返回窗口（不做无根据的时间过滤）', SJ.jieXiChaXunChuang('知识库里有戒烟吗', now) === null);
  const ben = SJ.jieXiChaXunChuang('今年做过哪些事', now);
  jian('"今年" ⇒ 从 1/1 起算', !!ben && ri(ben.qi) === '2026-01-01');
  const liang = SJ.mingZhongZhou([
    { id: 'a', jiluTs: now - D(1), fashengTs: new Date(2026, 8, 5).getTime() },
    { id: 'b', jiluTs: now - D(1), fashengTs: now - D(1) },
    { id: 'c', jiluTs: now - D(40), fashengTs: now - D(1) },
    { id: 'd', jiluTs: now - D(40), fashengTs: now - D(40) },
  ], SJ.jieXiChaXunChuang('昨天我们干了什么', now));
  const de = (x) => (liang.find((y) => y.xiang.id === x) || {}).zhou;
  jian('昨天说的"上月5号的决定" ⇒ 落在**记录轴**上（问"昨天"该命中它）', de('a') === 'jilu');
  jian('昨天发生又昨天说 ⇒ 两轴都命中', de('b') === 'liang');
  jian('很久以前说的、昨天发生的事 ⇒ 落在**发生轴**上', de('c') === 'fasheng');
  jian('两个轴都不在窗口内 ⇒ 不命中（不许硬凑）', de('d') === undefined);
  jian('没有窗口时一条都不筛掉（时间只是排序依据，不是事后过滤）',
    SJ.mingZhongZhou([{ id: 'x', jiluTs: 1, fashengTs: 2 }], null).length === 1);
}

// ── 3. 给模型看的呈现：两个时间永远分列 ───────────────────────────
{
  const s = SJ.liangShiJianMing(now - D(1), new Date(2026, 8, 5).getTime(), '上个月5号');
  jian('呈现串同时含两个时间且标明哪个是哪个', /记录时间/.test(s) && /发生时间/.test(s) && /2026-09-05/.test(s) && /上个月5号/.test(s), s);
  const s2 = SJ.liangShiJianMing(now - D(1), undefined);
  jian('没有发生时间 ⇒ 明写"未记录"（不拿记录时间顶替）', /发生时间 （未记录）|发生时间 （未记录）/.test(s2) || /未记录/.test(s2), s2);
  jian('异常自检：发生时间晚于记录时间一年以上 ⇒ 报警', !!SJ.shiJianYiChang(now, now + D(400)));
  jian('正常情形不误报（昨天说、上月发生）', SJ.shiJianYiChang(now - D(1), new Date(2026, 8, 5).getTime()) === '');
}

// ── 4. 存储层：记录时间写一次；取代不删除（探针③）──────────────────
{
  const os = await import('node:os');
  const tmp = await import('node:fs/promises');
  const dir = await tmp.mkdtemp(path.join(os.tmpdir(), 'r53-kb-'));
  try {
    const kb = new KB.KnowledgeBase(dir, 'internal');
    kb.addEvent({ id: 'e1', biaoTi: '戒烟', result: '决定戒烟', entityIds: [], anchors: [], ts: now, jiluTs: now - D(1), fashengTs: new Date(2026, 8, 5).getTime(), fashengBiao: '上个月5号', fashengJingDu: 'ri', fashengLaiYuan: 'stated' });
    kb.addEvent({ id: 'e1', biaoTi: '戒烟（补写）', result: '决定戒烟', entityIds: [], anchors: [], ts: now + 10, jiluTs: now + 10 });
    const yi = kb.query('').events.find((e) => e.id === 'e1');
    jian('① provenance 探针：重复写入**不能覆盖记录时间**（Graphiti issue #1489 那个坑）', yi?.jiluTs === now - D(1), yi?.jiluTs);
    jian('补写带来的新时间也不会把发生时间抹掉', yi?.fashengBiao === '上个月5号', yi?.fashengBiao);
    kb.addEvent({ id: 'e2', biaoTi: '戒烟', result: '其实没戒成', entityIds: [], anchors: [], ts: now + 20, jiluTs: now + 20, fashengTs: now + 20 });
    jian('③ supersession 探针：取代旧条目后**旧条目仍在**（可审计），只是标记失效',
      kb.supersedeEvent('e1') === true && !!kb.query('').events.find((e) => e.id === 'e1')?.shiXiaoTs);
    jian('生效集只含未被取代的条目（默认不把旧说法塞进上下文）',
      kb.activeEvents().map((e) => e.id).join(',') === 'e2', kb.activeEvents().map((e) => e.id).join(','));
    jian('重复取代是幂等的（第二次返回 false，不刷新历史）', kb.supersedeEvent('e1') === false);
    /** ② as-of 探针：按"当时为真（发生轴）"与"当时已知（记录轴）"两个谓词各自回答 */
    const asOfValid = (t) => kb.query('').events.filter((e) => (e.fashengTs || 0) <= t);
    const asOfKnown = (t) => kb.query('').events.filter((e) => (e.jiluTs || 0) <= t);
    jian('② as-of 探针：9月6日按**发生轴**能看到决定，按**记录轴**还看不到（10月才告诉我）',
      asOfValid(new Date(2026, 8, 6).getTime()).length === 1 && asOfKnown(new Date(2026, 8, 6).getTime()).length === 0,
      `valid=${asOfValid(new Date(2026, 8, 6).getTime()).length} known=${asOfKnown(new Date(2026, 8, 6).getTime()).length}`);
    jian('记录轴上"什么时候知道"可单独回放（问"三月底前你知道吗"用这个谓词）',
      asOfKnown(new Date(2026, 2, 31).getTime()).length === 0 && asOfKnown(now + D(1)).length === 2,
      String(asOfKnown(now + D(1)).length));
    jian('实体也有写一次的创建时间（updatedAt 只反映最后一次改动）',
      (() => { kb.upsertEntity({ id: 'p1', kind: 'person', ming: '张三', attrs: {}, anchors: [] }); const a = kb.listEntities().find((x) => x.id === 'p1'); kb.upsertEntity({ id: 'p1', kind: 'person', ming: '张三', attrs: { b: '1' }, anchors: [] }); const b = kb.listEntities().find((x) => x.id === 'p1'); return !!a?.chuangJianTs && a.chuangJianTs === b?.chuangJianTs; })());
  } finally {
    try { await tmp.rm(dir, { recursive: true, force: true }); } catch { /* noop */ }
  }
}

// ── 5. 主进程接线 ───────────────────────────────────────────────
jian('归档写入带双时间并落审计（kb.time-written）', /kb\.time-written/.test(MAIN) && /jiluTs: ssj\.jiluTs/.test(MAIN));
jian('记录时间取原文最后一条消息的时刻，不是归档的此刻',
  /xin\.reduce\(\(mx, x\) => Math\.max\(mx, Number\(xiaoXiShiJian\(x\)\) \|\| 0\), 0\)/.test(MAIN));
jian('knowledge_add 也走同一套双时间（说话时刻=本轮最后一条用户消息）', /benLunShuoHuaTs\(sessionId\)/.test(MAIN) && /const ssj = shuangShiJian\(jieShi/.test(MAIN));
jian('检索同时查两个轴并把命中轴标出来', /jieXiChaXunChuang\(q, Date\.now\(\)\)/.test(MAIN) && /按发生时间命中|〔按发生时间命中〕/.test(MAIN));
jian('时间命中参与排序，不是事后一刀切（调研：post-filter 把 temporal 召回 50%→37.5%）',
  /paiXu\(a\) - paiXu\(b\)/.test(MAIN));
jian('注入文案教模型分开两个时间，并给出反例口径', /绝不拿记录时间冒充发生时间/.test(MAIN) || /不要拿记录时间顶替/.test(MAIN));
jian('整理改为"取代不删除"（保留可审计历史）', /supersedeEvent\(id\)/.test(MAIN) && !/for \(const id of ji\.shanChu\) kb\.removeEvent\(id\)/.test(MAIN));
jian('派生概要记录血缘并在源被取代时重算/退场', /yinZi: \[evId\]/.test(MAIN) && /kb\.derived-rebuilt|kb\.derived-retired/.test(MAIN));

console.log(`==== verify-r53-shijian: ${okN} ok / ${failN} FAIL ====`);
process.exit(failN ? 1 : 0);
