/**
 * verify-r53-zhishi.mjs（fast 档）—— 第 53 轮项 4「知识库更智能、更健全、更可靠」的判据。
 *
 * 调研里最常被证实的三种坏法，本模块各给一条能真失败的判据：
 *  ① **实体没归一** ⇒ 同一个人/项目被记成好几条，每条只带一半事实，越查越像失忆；
 *     修法是三层裁决（高分自动合并 / 中分新建并交复核 / 低分新建），而且 person·org·project 是**保护类型**，
 *     只有归一后完全同名才允许自动合并 —— 错合并会把两个人的事实串在一起，不可逆。
 *  ② **无证据就先信**（evidence-before-belief 的反面）⇒ 模型的新结论被当事实入库，之后每轮检索都回灌成"已知"；
 *     修法是写入口的证据闸：要么带锚点，要么宿主派生来源，要么能在**用户原话**里找到 ≥10 字连续重合。
 *  ③ **陈旧内容以同等权重在场** ⇒ 不删除（删了丢审计线索），但必须显式标陈旧，且不拿记录时间冒充事情有多旧。
 *
 * 阈值与名单只住在纯模块 `zhi-shi-ke-kao.ts` 里一份（主进程再抄一份就是下一个不一致的源头）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const U = (p, f) => (p ? pathToFileURL(p).href : pathToFileURL(f).href);
const KK = await import(U(process.env.V53_KK, path.join(ROOT, 'packages/app-shell/dist/zhi-shi-ke-kao.js')));
const MAIN = fs.readFileSync(process.env.V53_MAIN || path.join(ROOT, 'packages/app-shell/src/electron-main.ts'), 'utf8');

let okN = 0, failN = 0;
const jian = (l, p, d) => { if (p) { okN++; console.log('  ok  ' + l); } else { failN++; console.log('  FAIL ' + l + (d ? ' ← ' + String(d).slice(0, 160) : '')); } };
const D = 86400000;

// ── 1. 名称归一与相似度 ───────────────────────────────────────────
{
  jian('归一化把全角/空白/标点都抹平（"Ｗ-Ａｒｍｙ" 与 "w army" 视为同一写法）',
    KK.guiYiMing('Ｗ-Ａｒｍｙ') === KK.guiYiMing('w army'), KK.guiYiMing('Ｗ-Ａｒｍｙ') + ' vs ' + KK.guiYiMing('w army'));
  jian('相似度对大小写与标点不敏感（同一句话多个句号 ⇒ 1）',
    KK.mingXiangSi('登录窗口记住上次位置', '登录窗口记住上次位置。') === 1);
  jian('相似度对称（A→B 与 B→A 必须同一个分数，否则裁决看输入顺序）',
    KK.mingXiangSi('张三丰', '张三') === KK.mingXiangSi('张三', '张三丰'));
  jian('只差一个字的人名 ⇒ 低分（编辑距离会给高分，那正是最贵的错：张三/张工 被并成一个人）',
    KK.mingXiangSi('张三', '张工') < KK.FU_HE_MING, KK.mingXiangSi('张三', '张工'));
  jian('空名字不算相似（不许把空串当成"和谁都像"）', KK.mingXiangSi('', '任意') === 0 && KK.mingXiangSi('任意', '') === 0);
}

// ── 2. 三层裁决 ──────────────────────────────────────────────────
{
  const ku = [
    { id: 'p1', kind: 'person', ming: '张三' },
    { id: 'p2', kind: 'person', ming: '阿里巴巴集团' },
    { id: 'c1', kind: 'concept', ming: '登录窗口记住上次位置' },
    { id: 'g1', kind: 'goal', ming: '每周汇报都要给出证据与下一步' },
  ];
  const a = KK.guiYiPanDing({ kind: 'person', ming: '张三' }, ku);
  jian('保护类型且归一后完全同名 ⇒ 自动合并（同义写法该并）', a.pan === 'merge' && a.biaoId === 'p1', JSON.stringify(a));
  const b = KK.guiYiPanDing({ kind: 'person', ming: '阿里 巴巴 集团' }, ku);
  jian('保护类型只差排版 ⇒ 仍然合并（归一化负责这个）', b.pan === 'merge' && b.biaoId === 'p2', JSON.stringify(b));
  const c = KK.guiYiPanDing({ kind: 'person', ming: '阿里巴巴' }, ku);
  jian('保护类型只是"很像" ⇒ **不自动合并**，交复核（错合并把两个客户的事实串在一起）',
    c.pan === 'review' && c.biaoId === '' && !!c.duiXiang, JSON.stringify(c));
  const d = KK.guiYiPanDing({ kind: 'org', ming: '阿里巴巴集团' }, ku);
  jian('跨 kind 不合并（同名的组织和人是两码事）', d.pan === 'new', JSON.stringify(d));
  const e = KK.guiYiPanDing({ kind: 'concept', ming: '登录窗口记住上次位置。' }, ku);
  jian('非保护类型高分 ⇒ 自动合并', e.pan === 'merge' && e.biaoId === 'c1' && e.deFen >= KK.HE_BING_MING, JSON.stringify(e));
  const f = KK.guiYiPanDing({ kind: 'concept', ming: '每周汇报给出证据与下一步' }, ku);
  jian('非保护类型落在复核带 ⇒ 新建 + 标复核，**不**自动合并（漏合并只是重复，错合并是污染）',
    (f.pan === 'review' || f.pan === 'new') && f.biaoId === '', JSON.stringify(f));
  const g = KK.guiYiPanDing({ kind: 'concept', ming: '完全无关的一条' }, ku);
  jian('库里没有像的 ⇒ 新建', g.pan === 'new' && g.deFen < KK.FU_HE_MING, JSON.stringify(g));
  jian('空库 ⇒ 新建（第一条不许被"和谁复核"卡住）', KK.guiYiPanDing({ kind: 'person', ming: '新人' }, []).pan === 'new');
  jian('阈值是"合并阈 ≥ 复核阈"且都在 0..1 内（否则复核带是空的）',
    KK.HE_BING_MING >= KK.FU_HE_MING && KK.FU_HE_MING > 0 && KK.HE_BING_MING <= 1);
  jian('保护类型名单确实盖住人/组织/项目（评价类事实串人的代价最高）',
    ['person', 'org', 'project'].every((k) => KK.BAO_HU_LEI_XING.includes(k)));
}

// ── 3. 证据闸（evidence-before-belief）───────────────────────────
{
  const yuanWen = '用户说：这个项目的验收标准是双击后窗口在上次位置出现，别再改回去。';
  const z = (q) => KK.jianChaYouZhengJu({ zhengWen: yuanWen, ...q });
  jian('带原文锚点 ⇒ 放行（第一优先，不看措辞）', z({ neiRong: '随便什么', anchors: [{ seq: 1 }] }).ok === true);
  jian('宿主派生来源 ⇒ 放行（脱敏概要/溢出条目本来就是从真原文来的）',
    z({ neiRong: '我们可以做这些类型的事', laiYuan: 'derived:redaction' }).ok === true
    && z({ neiRong: '溢出条目', laiYuan: 'prompt:overflow' }).ok === true);
  const chong = z({ neiRong: '验收标准是双击后窗口在上次位置出现', laiYuan: 'tool:knowledge_add' });
  jian('与用户原话连续重合 ≥10 字 ⇒ 放行，并把重合片段报出来（可核对）',
    chong.ok === true && chong.huLue && chong.huLue.length >= 10, JSON.stringify(chong));
  jian('只差空白也算重合（不因排版/换行误拒真人说的话）',
    z({ neiRong: '验收标准 是双击后窗口\n在上次位置出现', laiYuan: 'tool:knowledge_add' }).ok === true);
  const jie = z({ neiRong: '验收标准是双击后窗，我认为下季度他们还会加预算', laiYuan: 'tool:knowledge_add' });
  jian('只重合 9 个字（差一个字）⇒ 拒，而且**如实报出真实重合长度**（不许把 9 字报成 0 字糊弄日志）',
    jie.ok === false && /最长只连续重合 9 字/.test(jie.liYou), JSON.stringify(jie));
  const cai = z({ neiRong: '客户下个季度会把合同续到 50 万', laiYuan: 'tool:knowledge_add' });
  jian('原话里没有的结论 ⇒ 拒写，并给可执行的补救（摘原话 / 带 anchor / 明写待核）',
    cai.ok === false && /anchor/.test(cai.liYou) === false && /先别入库|不许|待核|摘/.test(cai.liYou), JSON.stringify(cai));
  const hu = z({ neiRong: '大概是去年签的吧，我听说他们换甲方了', laiYuan: 'tool:knowledge_add' });
  jian('含糊措辞且毫无依据 ⇒ 拒（猜测不许当事实入库），理由里点明"推测/待核"',
    hu.ok === false && /推测|待核/.test(hu.liYou), JSON.stringify(hu));
  jian('正文空白 ⇒ 拒（谈不上证据）', z({ neiRong: '   ', laiYuan: 'tool:knowledge_add' }).ok === false);
  jian('没有原文可比时 ⇒ 只有锚点/派生来源能过（不许"没有原文就随便写"）',
    KK.jianChaYouZhengJu({ neiRong: '随便一条结论', laiYuan: 'tool:knowledge_add', zhengWen: '' }).ok === false
    && KK.jianChaYouZhengJu({ neiRong: '随便一条结论', laiYuan: 'archive:core', zhengWen: '' }).ok === true);
  jian('含糊措辞判定只有一份（写侧拒、读侧标"待核"用同一个判据）',
    KK.shiHuHan('大概是这样') && KK.shiHuHan('听说换人了') && !KK.shiHuHan('验收标准是窗口记住位置'));
  jian('最长连续重合算的是**真值**（差一个字 ⇒ 9，不是被阈值探测糊成 0）',
    KK.zuiChangLianChong('验收标准是双击后窗，别的话', '这个项目的验收标准是双击后窗口在上次位置出现').changDu === 9,
    KK.zuiChangLianChong('验收标准是双击后窗，别的话', '这个项目的验收标准是双击后窗口在上次位置出现').changDu);
  jian('片段取的是原文里那段（可被 grep 核对，不是口头保证）',
    KK.zuiChangLianChong('验收标准是双击后窗口在上次位置出现', '这个项目的验收标准是双击后窗口在上次位置出现，别再改回去').pianDuan === '验收标准是双击后窗口在上次位置出现');
  jian('没有原文可比 ⇒ 0（不编造重合）', KK.zuiChangLianChong('随便一句', '').changDu === 0);
}

// ── 4. 陈旧度（降权不删除，按发生时间算）─────────────────────────
{
  const now = new Date(2026, 9, 21).getTime();
  const jin = KK.chenJiuFen({ jiluTs: now, ts: now }, now);
  jian('今天记的 ⇒ 不陈旧（分数 1、无标签）', jin.deFen === 1 && jin.biao === '', JSON.stringify(jin));
  const ban = KK.chenJiuFen({ jiluTs: now - KK.CHEN_JIU_BAN_SHUAI_RI * D }, now);
  jian(`满一个半衰期（${KK.CHEN_JIU_BAN_SHUAI_RI} 天）⇒ 分数约 0.5 并开始挂陈旧标签`,
    Math.abs(ban.deFen - 0.5) < 0.02 && /陈旧/.test(ban.biao), JSON.stringify(ban));
  const jiu = KK.chenJiuFen({ jiluTs: now - 3000 * D }, now);
  jian('三年 ⇒ 分数停在下限（**降权不淘汰、更不删除**，删除会丢审计线索）',
    jiu.deFen === KK.CHEN_JIU_XIA_XIAN && jiu.deFen > 0, JSON.stringify(jiu));
  const qu = KK.chenJiuFen({ shiXiaoTs: now - D, jiluTs: now - 3 * D }, now);
  jian('已被取代 ⇒ 分数 0 且标签说清"被更新的说法取代"', qu.deFen === 0 && /取代/.test(qu.biao), JSON.stringify(qu));
  const f = KK.chenJiuFen({ jiluTs: now, fashengTs: now - 400 * D }, now);
  jian('"三年前的事、昨天才告诉我" ⇒ 按**发生时间**判陈旧（不是按记录时间装作很新）',
    f.tianShu >= 400 && /陈旧/.test(f.biao), JSON.stringify(f));
  const wu = KK.chenJiuFen({}, now);
  jian('完全没有时间信息 ⇒ 分数 1 且不打标签（不假装知道新旧）', wu.deFen === 1 && wu.biao === '', JSON.stringify(wu));
  jian('下限 > 0 ⇒ 陈旧条目仍然可被召回（"永远可回忆"不被衰减偷偷废掉）', KK.CHEN_JIU_XIA_XIAN > 0);
}

// ── 5. 主进程接线 ────────────────────────────────────────────────
{
  jian('knowledge_add 写实体先过三层裁决，合并时复用已有 id（不再各写各的）',
    /guiYiPanDing\(\{ kind: String\(eIn\.kind \|\| 'concept'\), ming: String\(eIn\.ming\) \}, kb\.listEntities\(\)\)/.test(MAIN)
    && /pan\.pan === 'merge' \? pan\.biaoId/.test(MAIN));
  jian('复核带 ⇒ 新建 + 落审计 kb.entity-review（把"很像但没并"这件事留痕，等人或模型来裁）',
    /try \{\s*\n?\s*audit\?\.log\('kb\.entity-review'/.test(MAIN) && /deFen: Math\.round\(pan\.deFen \* 100\) \/ 100/.test(MAIN)
    && /没有自动合并/.test(MAIN));
  jian('事件写入口有证据闸，不过就拒（宁可不入库，也不把猜测沉淀成"已知"）',
    /jianChaYouZhengJu\(\{ neiRong: jieShi, anchors: \[\], laiYuan: 'tool:knowledge_add', zhengWen: benLunYuanWen\(sessionId\) \}\)/.test(MAIN)
    && /if \(!zj\.ok\) \{/.test(MAIN));
  jian('拒写理由回给模型（含补救做法），并且不静默吞：审计 kb.evidence-denied',
    /kb\.evidence-denied/.test(MAIN) && /anchor/.test(MAIN) && /这条\*\*事件没写\*\*/.test(MAIN));
  jian('证据只比**用户原话**（模型自己的输出当依据 = 猜测自我印证）',
    /function benLunYuanWen[\s\S]{0,700}guiYiJiaoSe\(x\.role\) === 'user'/.test(MAIN)
    && !/function benLunYuanWen[\s\S]{0,700}=== 'assistant'/.test(MAIN));
  jian('检索结果挂陈旧标签（旧说法不让它冒充现状）',
    /const cj = chenJiuFen\(\{ jiluTs: e\.jiluTs, fashengTs: e\.fashengTs/.test(MAIN) && /〔\$\{cj\.biao\}〕/.test(MAIN));
  jian('检索结果挂"待核"标签（含糊措辞原样呈现，但标明不是核定事实）',
    /shiHuHan\(String\(e\.biaoTi\) \+ String\(e\.result \|\| ''\)\)/.test(MAIN) && /待核：原话带/.test(MAIN));
  jian('阈值与保护名单只有一份：主进程里没有另抄 0.92/0.75/90 天',
    !/0\.92|HE_BING_MING = /.test(MAIN) && !/FU_HE_MING/.test(MAIN) && !/CHEN_JIU_BAN_SHUAI_RI/.test(MAIN)
    && !/BAO_HU_LEI_XING/.test(MAIN));
  jian('纯模块被真实消费（不是写了没人调用）',
    /import \{ guiYiPanDing, jianChaYouZhengJu, chenJiuFen, shiHuHan \} from '\.\/zhi-shi-ke-kao\.js'/.test(MAIN)
    && ['guiYiPanDing(', 'jianChaYouZhengJu(', 'chenJiuFen(', 'shiHuHan('].every((f) => MAIN.includes(f)));
}

// ── 6. 写时去重与取代（第 53 轮补，Mem0 更新阶段的 NOOP/UPDATE 两件事）──
{
  const KBSRC = fs.readFileSync(path.join(ROOT, 'packages/knowledge-base/src/index.ts'), 'utf8');
  jian('同标题 + 同实体 + 同内容 ⇒ **NOOP 不重复写**（同一句存成 N 条会挤占检索名额）',
    /if \(yiYang\) \{[\s\S]{0,220}?kb\.write-noop/.test(MAIN) && /事件已存在（同标题、同实体、同内容/.test(MAIN));
  jian('同标题 + 同实体但内容不同 ⇒ 旧说法被取代（打 shiXiaoTs，不删除）',
    /kb\.superseded-on-write/.test(MAIN) && /for \(const id of quDai\) kb\.supersedeEvent\(id\)/.test(MAIN));
  jian('新说法带 quDaiIds（审计能回答"这条为什么现在长这样"，与 yinZi 的"我由谁派生"分开）',
    /quDaiIds: quDai\.length \? quDai : undefined/.test(MAIN) && /quDaiIds\?: string\[\]/.test(KBSRC));
  jian('没有共同实体就不算同一个说法（不跨实体乱取代；查询侧仍然按标题+实体双条件）',
    /\(!ids\.length \|\| \(\(e\.entityIds \|\| \[\]\)\.some\(\(x\) => ids\.includes\(String\(x\)\)\)\)\)/.test(MAIN));
  jian('陈旧度参与排序：先命中轴、再陈旧度、最后新近（三年前的旧事不许压过最近说法）',
    /paiXu\(a\) - paiXu\(b\)[\s\S]{0,280}?chenJiuFen\(b, (?:Date\.now\(\)|xianZai)\)\.deFen - chenJiuFen\(a, (?:Date\.now\(\)|xianZai)\)\.deFen/.test(MAIN));
  jian('排序仍以时间命中为第一关键字（第 53 轮项 5 的承诺没有被这次排序改动推翻）',
    /shiJianLiu\.slice\(\)\.sort\(\(a, b\) => paiXu\(a\) - paiXu\(b\)/.test(MAIN));
}

console.log(`==== verify-r53-zhishi: ${okN} ok / ${failN} FAIL ====`);
process.exit(failN ? 1 : 0);
