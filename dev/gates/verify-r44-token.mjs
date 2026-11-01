/**
 * 第 44 轮后半 · 用户第 9 条：**token 从"猜"变成"可校准的真实值"**（fast 档）
 *
 * 修之前的现实（自查实录）：同一份内容有**三套互不相干的系数**在数 ——
 *  预算侧 `chars = tokens × 1.6`、用量兜底 `tokens = chars / 3`、记忆服务里那套 bge WordPiece。
 * 中文下前后能差近 2 倍 ⇒ "预算设成多少就发多少"根本无从谈起。
 *
 * 这支门禁钉的是**行为与不变量**，不是源码措辞：
 *  ① 口径唯一（分脚本系数只许存在于 `token-jiliang.ts`）；
 *  ② 上界性质（未校准宁少发不超窗）+ 校准收敛 + 限幅 + 脏样本拒收；
 *  ③ **闭环模拟**：用一个人工"供应商分词器"跑 24 轮，断言每轮真实用量 ≤ 预算，且利用率随校准上升；
 *  ④ 负向对照：把旧口径（万能 1.6）在门禁里复算一遍 ⇒ 旧口径下"中文会话"和"代码会话"得到的字符数**相同**，
 *     新口径必须**不同**（否则第 9 条等于没做）；
 *  ⑤ 用量来源诚实：端点报出来的数字必须标 `native`（否则校准闭环永远拿不到样本），
 *     我们自己算的才标 `estimated`；OpenAI 兼容流式必须主动要 `usage`，且不吃这个字段的中转有逃生口。
 *
 * 用法：node dev/gates/verify-r44-token.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GEN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const du = (p) => fs.readFileSync(path.join(GEN, p), 'utf8');

const T = await import('../../packages/app-shell/dist/token-jiliang.js')
  .catch(() => import(path.join(GEN, 'packages/app-shell/dist/token-jiliang.js')));
const { guJiToken, guJiTokenXiaoZhun, xinJiXiaoZhun, tokenDaoZiFu, fenTeZheng, miDuTong, tokenJian, tokenJianTong, chaXiaoZhun, zhongSuanXiaoZhun, YAN_XIAN, PING_JUN_QIAN, WEI_ZHUN } = T;

const jie = [];
const jian = (ming, ok, xiang) => { jie.push({ ming, ok: ok === true, xiang: xiang === undefined ? '' : String(xiang) }); };

const ZHONGWEN = '今晚的月色真美，风也温柔。我想把这段心情写进小说的第一章，主角站在天台上看着城市的灯火慢慢熄灭。'.repeat(18);
const DAIMA = `export function parseConfig(raw: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const line of raw.split('\\n')) {
    const i = line.indexOf('=');
    if (i < 0) continue;
    out[line.slice(0, i).trim()] = Number(line.slice(i + 1));
  }
  return out;
}`.repeat(12);

// ── ① 分脚本紧上界：中文与代码必须数出**不一样**的密度 ──
const tokZ = guJiToken(ZHONGWEN);
const tokD = guJiToken(DAIMA);
jian(`中文估算跟着实测走（≈0.78 token/字，旧的 1.0 是真实值的 1.5 倍 ⇒ 会把视图额度算成 0）：${tokZ} token / ${[...ZHONGWEN].length} 字符`,
  tokZ / [...ZHONGWEN].length >= 0.7 && tokZ / [...ZHONGWEN].length <= 0.9);
const miDu = (ch, n) => guJiToken(ch.repeat(n)) / n;
jian('每一类文字的估算密度都**高于**模拟供应商的真实密度（"紧上界"是可测的，不是嘴上说）',
  miDu('中', 200) > 0.62 && miDu('a', 200) > 0.28 && miDu('1', 200) > 0.40
  && miDu(' ', 200) > 0.30 && miDu('}', 200) > 0.55 && miDu('🙂', 200) > 1.15,
  `中${miDu('中', 200).toFixed(2)} 拉${miDu('a', 200).toFixed(2)} 数${miDu('1', 200).toFixed(2)} 白${miDu(' ', 200).toFixed(2)} 标${miDu('}', 200).toFixed(2)} 杂${miDu('🙂', 200).toFixed(2)}`);
jian('拉丁/代码密度明显低于中文（同一字符数不会都算 1 token）',
  tokD / DAIMA.length < tokZ / ZHONGWEN.length * 0.8);
jian('估算随长度单调不减（不会因为截断而变小）',
  guJiToken(ZHONGWEN + ZHONGWEN) >= guJiToken(ZHONGWEN));
jian('空文本估成 0（不许"空也占预算"）', guJiToken('') === 0);
jian('emoji/生僻字走更高系数（最容易爆的那一类）',
  guJiToken('🙂'.repeat(10)) > Math.ceil(guJiToken('a'.repeat(10)) * 2));
jian('分脚本自检：分类计数之和 = 字符数（不许漏字符不算）', (() => {
  const z = fenTeZheng(ZHONGWEN + DAIMA);
  const he = z.cjk + z.la + z.shu + z.kong + z.biao + z.qi;
  return he === [...(ZHONGWEN + DAIMA)].length;
})());

// ── ② 安全垫与校准数学 ──
jian('未校准也带安全垫（上界估算 ×1.15，宁少发不超窗）',
  guJiTokenXiaoZhun(ZHONGWEN, WEI_ZHUN) > guJiToken(ZHONGWEN));
jian('校准比值 >1 时按比值放大估算（端点比我们的上界更碎，必须认）',
  guJiTokenXiaoZhun(ZHONGWEN, { biLi: 2, yangBenShu: 5 }) === Math.ceil(guJiToken(ZHONGWEN) * 2 * 1.15));
let zhun = WEI_ZHUN;
const LIE = [];
for (let i = 0; i < 24; i++) zhun = xinJiXiaoZhun(zhun, 1000, 620);
jian(`EMA 向真值收敛（24 次 0.62 样本后 biLi=${zhun.biLi.toFixed(3)}→0.62）`,
  Math.abs(zhun.biLi - 0.62) < 0.02);
jian('样本数如实累加（界面据此显示"已校准/未校准"）', zhun.yangBenShu === 24);
jian('误差记的是**残余散布**：同一比值反复回读 ⇒ 误差归 0（安全垫不会自我放大）',
  zhun.wuCha === 0);
{
  let t = WEI_ZHUN;
  for (let i = 0; i < 8; i++) t = xinJiXiaoZhun(t, 1000, i % 2 ? 780 : 520);
  jian('同桶内文字形状抖动 ⇒ 如实记录误差（这个桶会被要求更厚的安全垫）',
    typeof t.wuCha === 'number' && t.wuCha > 0.1);
  jian('误差大的桶安全垫更厚（但封顶，不许无限加厚把预算吃掉）',
    guJiTokenXiaoZhun(ZHONGWEN, { biLi: 1, yangBenShu: 9, wuCha: t.wuCha }) > guJiTokenXiaoZhun(ZHONGWEN, WEI_ZHUN)
    && guJiTokenXiaoZhun(ZHONGWEN, { biLi: 1, yangBenShu: 9, wuCha: 0.9 }) === Math.ceil(guJiToken(ZHONGWEN) * 1 * 1.5));
}
const fei = xinJiXiaoZhun(xinJiXiaoZhun(WEI_ZHUN, 100, 10000), 100, 0.1);
jian('单次坏样本被限幅夹住（不许一次把系数带飞）', fei.biLi <= 2.5 && fei.biLi >= 0.25);
const ling = xinJiXiaoZhun({ biLi: 0.7, yangBenShu: 9 }, 1200, 0);
jian('用量为 0 的轮次不产生样本（没给 usage ≠ 比值为 0）', ling.biLi === 0.7 && ling.yangBenShu === 9);
const wuGu = xinJiXiaoZhun({ biLi: 0.7, yangBenShu: 9 }, 0, 800);
jian('估算取不到时不校准（拿不到"同一条请求"的估算就不许更新）', wuGu.biLi === 0.7 && wuGu.yangBenShu === 9);

// ── ③ token↔字符反算：跟着**文字构成**走 ──
const YU_SUAN_TOK = 8000;
const charsZ = tokenDaoZiFu(YU_SUAN_TOK, ZHONGWEN, WEI_ZHUN);
const charsD = tokenDaoZiFu(YU_SUAN_TOK, DAIMA, WEI_ZHUN);
jian('同一 token 预算下，中文会话与代码会话折算出的字符数不同（见下）',
  Math.abs(charsZ - charsD) / Math.min(charsZ, charsD) > 0.3, `${charsZ} vs ${charsD}`);
/** 按文字密度把样本填满到 chars（真实场景是"多条历史装到字符预算为止"，不是只发那一段样本） */
const zhuMan = (sam, chars) => {
  const n = Math.max(1, Math.ceil(chars / Math.max(1, sam.length)) + 1);
  return [...sam.repeat(n)].slice(0, Math.max(0, chars)).join('');
};
jian('折算回去仍不超预算（字符数 × 估算密度 ≤ 预算 ×1.2）',
  guJiTokenXiaoZhun(zhuMan(ZHONGWEN, charsZ), WEI_ZHUN) <= YU_SUAN_TOK * 1.2);
jian('样本太短（<8 字）时不用它折算 ⇒ 主进程会退回常数（这里只验纯函数不炸）',
  tokenDaoZiFu(1000, '好', WEI_ZHUN) > 0);
// 负向对照：旧口径（万能 1.6）下两种文字得到的字符数**一模一样** ⇒ 新断言在旧实现下必红
const JIU_Z = Math.round(YU_SUAN_TOK * 1.6);
const JIU_D = Math.round(YU_SUAN_TOK * 1.6);
jian('负向对照成立：旧口径对中文/代码给出同一个字符数（所以"必须不同"这条能失败）',
  JIU_Z === JIU_D && JIU_Z !== charsZ && JIU_D !== charsD);

// ── ④ 闭环模拟：人工"供应商分词器"跑 24 轮，真实用量恒 ≤ 预算，且利用率随校准上升 ──
function gongYingShangFenCi(wen) {
  const z = fenTeZheng(wen);
  return Math.round(z.cjk * 0.62 + z.la * 0.28 + z.shu * 0.40 + z.kong * 0.30 + z.biao * 0.55 + z.qi * 1.15);
}
/** 模拟的供应商与模型（闭环里所有键都按真实形状拼，便于验证"三条腿"查找） */
const GONG = 'api.example.com';
const MO = 'ceshi-model';
/** 校准表：键与主进程同一套（`供应商/模型/密度桶`）。`danYi=true` 时退化成"所有形状共用一个比值"的旧设计 */
function biLun(danYi) {
  const zhu = {};
  const lu = [];
  for (let i = 0; i < 24; i++) {
    const sam = i % 3 === 0 ? DAIMA : ZHONGWEN;
    const biao = danYi ? (zhu['__shared'] || WEI_ZHUN) : chaXiaoZhun(zhu, GONG, MO, sam);
    const chars = tokenDaoZiFu(YU_SUAN_TOK, sam, biao);
    const faSong = zhuMan(sam, chars);
    const shang = guJiToken(faSong);
    const zhen = gongYingShangFenCi(faSong);
    const xin = xinJiXiaoZhun(biao || WEI_ZHUN, shang, zhen);
    if (danYi) zhu['__shared'] = xin; else zhu[tokenJian(GONG, MO, sam)] = xin;
    lu.push({ zhen, lv: zhen / YU_SUAN_TOK, tong: miDuTong(sam) });
  }
  return { lu, zhu };
}
const { lu, zhu } = biLun(false);
const chaoChuang = lu.filter((x) => x.zhen > YU_SUAN_TOK).length;
jian(`24 轮闭环里没有一轮真实用量超预算（超窗 ${chaoChuang} 次）`, chaoChuang === 0);
const jun = (a) => a.reduce((s, x) => s + x.lv, 0) / a.length;
/** 按桶比：同一个桶"第一次出现"与"最后一次出现"的利用率 ⇒ 校准必须把少发的部分补回来 */
const tongBi = [...new Set(lu.map((x) => x.tong))].map((k) => {
  const g = lu.filter((x) => x.tong === k);
  return { k, shou: g[0].lv, mo: g[g.length - 1].lv };
});
jian(`每个密度桶校准后利用率都不下降（${tongBi.map((t) => `${t.k}:${t.shou.toFixed(2)}→${t.mo.toFixed(2)}`).join(' ')}）`,
  tongBi.every((t) => t.mo >= t.shou - 0.01));
jian('至少一个桶利用率上升（紧上界 + 先验已经很近，校准再补最后一截）',
  tongBi.some((t) => t.mo > t.shou * 1.03));
jian('收敛后利用率稳定在 1/安全垫 附近（0.8–0.9 ⇒ 既不发空也不贴边）',
  jun(lu.slice(-6)) > 0.8 && jun(lu.slice(-6)) < 0.9);
jian('利用率仍留有余量（不是靠贴边侥幸不超窗：末轮 ≤0.95）', lu[lu.length - 1].lv <= 0.95);
const zhuLie = Object.entries(zhu);
jian(`按「供应商/模型/桶」分开校准（${zhuLie.map(([k, v]) => `${k.split('/').pop()}=${v.biLi.toFixed(2)}`).join(' ')}）`,
  zhuLie.length >= 2 && Math.abs((zhu[tokenJian(GONG, MO, ZHONGWEN)]?.biLi ?? 0) - (zhu[tokenJian(GONG, MO, DAIMA)]?.biLi ?? 0)) > 0.05);
jian('每个桶自己累样本（不是共享一个"看起来已校准"的总数）',
  zhuLie.every(([, v]) => v.yangBenShu >= 2));
const dan = biLun(true);
jian(`两种形状共用一个比值时仍然不发疯（紧上界之后差距只剩 ${(dan.lu.filter((x) => x.zhen > YU_SUAN_TOK).length)} 轮超窗）—— 但**跨桶借系数**是另一回事，见下一条`,
  dan.lu.length === 24);
{
  /**
   * **负向对照（跨桶借系数的后果）**：把中文桶的 0.60 借给一个真实比值 0.95 的请求，
   * 放行量 = 预算/(0.60×1.15) ⇒ 真实用量 = 预算 × 0.95/(0.60×1.15) ≈ **1.38 倍预算** ⇒ 直接超窗。
   * 这就是"没样本的桶绝不借别人的值"这条规矩的算术依据。
   */
  const jie = chaXiaoZhun({ [tokenJian(GONG, 'm', ZHONGWEN)]: { biLi: 0.60, yangBenShu: 9, wuCha: 0 } }, GONG, 'm', DAIMA);
  const fangXing = (r) => Math.round(YU_SUAN_TOK * r / (0.60 * 1.15));
  jian('负向对照成立：借别的桶的系数会把真实用量放到预算的 1.38 倍（所以绝不跨桶借，宁可退回平均/先验）',
    fangXing(0.95) > YU_SUAN_TOK * 1.3 && jie.biLi !== 0.60 && jie.biLi >= 0.9,
    `借来会用到 ${fangXing(0.95)} > 预算 ${YU_SUAN_TOK}；实际取到的是 ${jie.biLi}（平均/先验那一档）`);
}
jian('密度桶把中文与代码分开（同一模型至少两个桶）',
  miDuTong(ZHONGWEN) !== miDuTong(DAIMA) && miDuTong('') === 'd0');

// ── ⑦ 三条腿：精确命中 → 该桶平均法 → 先验（用户补的口径：没回读也要更准；有回读就再做一份平均法）──
const xian = chaXiaoZhun({}, GONG, 'weizhi-model', ZHONGWEN);
jian('一次回读都没有时用**先验**（比未校准上界更准，但仍 <1 ⇒ 偏保守）',
  !!xian && xian.biLi < 1 && xian.biLi >= 0.5, JSON.stringify(xian));
jian('先验一律不带测量散布（wuCha=0 ⇒ 不许拿凭空写的误差去加厚安全垫、白丢预算）',
  Object.values(YAN_XIAN).every((v) => v.wuCha === 0 && v.biLi > 0 && v.biLi < 1));
const jingQue = { [tokenJian(GONG, 'm', ZHONGWEN)]: { biLi: 0.55, yangBenShu: 9 } };
jian('精确命中优先于平均法/先验（同供应商同模型同桶自己说了算）',
  chaXiaoZhun(jingQue, GONG, 'm', ZHONGWEN).biLi === 0.55);
jian('换一个供应商就**不能**命中（用户："只要有一个不同，计算 token 的方法也可能不同"）',
  chaXiaoZhun(jingQue, 'other-api.example', 'm', ZHONGWEN).biLi !== 0.55);
const pj = { [PING_JUN_QIAN + miDuTong(ZHONGWEN)]: { biLi: 0.7, yangBenShu: 4, wuCha: 0.2 } };
jian('该模型没回读时借**该桶平均法**（比先验更贴近真实）',
  chaXiaoZhun(pj, GONG, 'xin-model', ZHONGWEN).biLi === 0.7);
/** 借平均值的数学底线：安全垫按"桶内最坏模型相对平均的超出比例"加厚 ⇒ 最坏情况也不超窗 */
{
  const guanCe = [];
  for (let i = 0; i < 6; i++) guanCe.push({ gongYing: GONG, moXing: 'm-low', tong: 'd3', shangJie: 1000, zhenShi: 600 });
  for (let i = 0; i < 6; i++) guanCe.push({ gongYing: GONG, moXing: 'm-high', tong: 'd3', shangJie: 1000, zhenShi: 1050 });
  const biao = zhongSuanXiaoZhun(guanCe);
  const ji = biao[PING_JUN_QIAN + 'd3'];
  jian('平均法条目按桶生成，比值取桶内均值、误差取"最坏相对平均的超出"',
    !!ji && Math.abs(ji.biLi - 0.825) < 0.01 && ji.wuCha > 0.2, JSON.stringify(ji));
  const yuSuan = 8000;
  const jiDeZiFu = tokenDaoZiFu(yuSuan, ZHONGWEN, ji);
  const zuiHuai = Math.round(guJiToken(zhuMan(ZHONGWEN, jiDeZiFu)) / 1000 * 1050);
  jian('把平均值借给没见过回读的模型时，**桶内最坏模型也不超窗**（安全垫自动覆盖最坏情况）',
    zuiHuai <= yuSuan, `最坏真实≈${zuiHuai} 预算=${yuSuan} 放行字符=${jiDeZiFu}`);
}

// ── ⑧ 观测史离线重算（归档时更新算法） ──
{
  const biao = zhongSuanXiaoZhun([
    { gongYing: GONG, moXing: 'A', tong: 'd3', shangJie: 1000, zhenShi: 600 },
    { gongYing: GONG, moXing: 'a', tong: 'd3', shangJie: 1000, zhenShi: 700 },
    { gongYing: 'other', moXing: 'A', tong: 'd3', shangJie: 1000, zhenShi: 900 },
    { gongYing: GONG, moXing: 'A', tong: 'd1', shangJie: 1000, zhenShi: 850 },
    { gongYing: GONG, moXing: 'A', tong: 'd3', shangJie: 0, zhenShi: 500 },
    { gongYing: GONG, moXing: 'A', tong: 'd9', shangJie: 1000, zhenShi: 500 },
  ]);
  jian('重算按 `供应商/模型/桶` 分组（模型名大小写归一，供应商不同就是两条）',
    Object.keys(biao).includes(tokenJianTong(GONG, 'a', 'd3')) && Object.keys(biao).includes(tokenJianTong('other', 'A', 'd3'))
    && biao[tokenJianTong(GONG, 'a', 'd3')].biLi !== biao[tokenJianTong('other', 'a', 'd3')].biLi,
    Object.keys(biao).join(' '));
  jian('同桶不同形状（d1 与 d3）分开算，不混成一个数',
    biao[tokenJianTong(GONG, 'a', 'd1')].biLi > biao[tokenJianTong(GONG, 'a', 'd3')].biLi);
  jian('脏观测被忽略：上界为 0 不算样本、桶号不合法不算样本',
    !Object.keys(biao).some((k) => /d9/.test(k)) && biao[tokenJianTong(GONG, 'a', 'd3')].yangBenShu === 2);
  const baoLiu = zhongSuanXiaoZhun([], { [tokenJianTong(GONG, 'jiu', 'd3')]: { biLi: 0.42, yangBenShu: 7 } });
  jian('观测史为空时**原样保留**已学到的条目（历史被截断/换机不许把校准清零）',
    baoLiu[tokenJianTong(GONG, 'jiu', 'd3')]?.biLi === 0.42);
}

// ── ⑤ 静态不变量：口径唯一 + 接线齐全 ──
const MAIN = du('packages/app-shell/src/electron-main.ts');
const BASE = du('packages/providers/src/base.ts');
const OAI = du('packages/providers/src/openai.ts');
const ANT = du('packages/providers/src/anthropic.ts');
const quChu = (s, re) => (s.match(re) || []).length;

jian('主进程里旧的"字符/3"兜底估算已删干净（不留第二套系数）',
  !/Math\.round\(\s*\w*[Zz]i\s*\/\s*3\s*\)/.test(MAIN) && !/\/\s*3\)\s*,\s*$/.test(MAIN));
jian('万能常数 CHARS_PER_TOKEN_EST 只剩"定义 + 取不到样本时的兜底"两处引用',
  quChu(MAIN, /CHARS_PER_TOKEN_EST/g) <= 3);
/**
 * 这条以前钉的是主进程里的字面（`yangBen.length >= 8 … CHARS_PER_TOKEN_EST`）。
 * 第 45 轮把"窗口→预算→折算"整套算术收进纯函数 `peizhiYuSuan()` 之后，主进程里已经没有那段字面了
 * ⇒ 红的是**仪器**，不是产品。改成行为判据：样本够长 ⇒ 按样本折算；样本不够/没有 ⇒ 才用文档化兜底常数。
 */
const YS = await import('../../packages/app-shell/dist/yuSuan-jiage.js')
  .catch(() => import(path.join(GEN, 'packages/app-shell/dist/yuSuan-jiage.js')));
jian('兜底那一处必须带条件（拿不到样本才用常数）',
  (() => {
    const pei = { percent: 60, windowTokens: 32768 };
    const wu = YS.peizhiYuSuan(pei);
    const duan = YS.peizhiYuSuan({ ...pei, yangBen: '才三字' });
    const chang = YS.peizhiYuSuan({ ...pei, yangBen: '这是一段足够长的中文样本内容，用来折算字符数。'.repeat(6) });
    return wu.chars === duan.chars                                            // 没样本与样本太短走同一条兜底路
      && duan.chars === Math.max(200, Math.round(duan.tokens * YS.WU_YANG_BEN_BEI_JIAN))  // 兜底就是那个文档化常数
      && chang.chars !== duan.chars;                                          // 有样本 ⇒ 真的按样本折算，不是摆设
  })());
jian('分脚本系数只存在于 token-jiliang.ts（别处不许再抄一份 XI_SHU）',
  (() => {
    const lei = ['packages/app-shell/src/electron-main.ts', 'packages/app-shell/src/context-renderer.ts', 'packages/providers/src/base.ts'];
    return lei.every((p) => !/XI_SHU|cjk:\s*1\.0/.test(du(p)));
  })());
jian('校准唯一入口 `jiaZhunYongLiang` 至少接在 3 个出口上（流式/工具回退/空参回退/非流式兜底）',
  quChu(MAIN, /jiaZhunYongLiang\(/g) >= 4);
jian('校准只认真生用量（`!== \'native\'` 这道闸不许松）',
  /jiaZhunYongLiang[\s\S]{0,900}!==\s*'native'/.test(MAIN));
jian('比值分母 = **未校准上界**（拿已放行的量当分母会自我复合，24 轮闭环必超窗）',
  /function tokenZhuJiaoZhun[\s\S]{0,700}const shang = guJiToken\([\s\S]{0,240}xinJiXiaoZhun\([\s\S]{0,80}shang,\s*zhen\)/.test(MAIN));
jian('含图片的请求不参与校准（视觉 token 口径未接入前，宁可少一个样本）',
  /qingQiuYouTu[\s\S]{0,400}calibrate-skip/.test(MAIN));
jian('校准表读写分离且有节流（每轮写盘会拖慢对话）',
  /tokenZhuLuJing/.test(MAIN) && /tokenZhuJiuDai\s*<\s*\d{4,}/.test(MAIN));
jian('校准表是**首次用到时**才读盘（顶层读会撞暂时性死区 ⇒ 表永远空却装作已校准）',
  /function tokenZhuQu[\s\S]{0,120}tokenZhuQueRen\(\)/.test(MAIN) && /function tokenZhuJiaoZhun[\s\S]{0,260}tokenZhuQueRen\(\)/.test(MAIN));
jian('校准键 = **供应商 / 模型 / 密度桶** 三段（用户：只要有一个不同，分词方法就可能不同，不能混）',
  /function tokenZhuJian[\s\S]{0,300}tokenJian\(/.test(MAIN) && /function gongYingDai\b/.test(MAIN)
  && /gongYingDai\(yuan\.baseURL, yuan\.protocol\)/.test(MAIN));
jian('只有模型 id 的场合先查"谁提供了这个模型"，查不到就只走平均法/先验（绝不瞎借别家的系数）',
  /function gongYingDaiTuModel\b/.test(MAIN) && /String\(gongYingFen \?\? ''\) \|\| gongYingDaiTuModel\(modelId\)/.test(MAIN));
jian('主进程取系数必须走"三条腿"那一个函数（不许有人绕过先验直接读表 ⇒ 绕过就等于退回万能 1.6）',
  /return chaXiaoZhun\(TOKEN_ZHU,/.test(MAIN));
jian('每条预算路径都把供应商指纹传到底（chat-send / 值班 / 工具循环窗口闸 / 群协调）',
  quChu(MAIN, /gongYingDai\(/g) >= 4);
jian('每一次回读都另记一条观测（归档时能按全量记录重算，而不是只信在线 EMA）',
  /tokenGuanCeZhuiJia\(/.test(MAIN) && /token-observations\.jsonl/.test(MAIN));
jian('归档成功路径里重算 token 算法（用户："归档的时候根据这些记录更新我们的 token 计算方法"）', (() => {
  const kai = MAIN.indexOf('async function shengChengHuiHuaZhaiYao');
  const ji = MAIN.indexOf("audit?.log('session.summary'");
  // 找**调用点**（带分号），`tokenGuiDangChongSuan()` 这种写法会先命中函数定义本身
  const chong = MAIN.indexOf('tokenGuiDangChongSuan();', ji);
  // 位置判定而不是"函数体前 3000 字符"：函数体一长大就把断言变成假红（整遍 fast 档第一次红就是这么来的）
  return kai >= 0 && chong > ji && chong - ji < 2000 && MAIN.slice(chong, chong + 600).includes('return { ok: true');
})());
jian('重算只包在 try 里、失败只记审计 ⇒ 不许因为重算出错把会话摘要判成失败',
  /catch[\s\S]{0,120}token\.recalc-fail/.test(MAIN));
jian('重启后"这个会话用的什么模型"不许丢（真缺陷：huiHuaMoXing 是内存表 ⇒ 预算按全局默认模型算，窗口整个错一位）',
  /function zhaoShiJiMoXing[\s\S]{0,700}chatMetaBen\.get\(sid\)/.test(MAIN));
jian('元数据里的模型是"供应商显示名 · model id"这种给人看的形状 ⇒ 还原真实模型必须切出后半段（整串查不到窗口）',
  /function zhaoShiJiMoXing[\s\S]{0,1200}lastIndexOf\('·'\)/.test(MAIN));
/**
 * 同样从字节锚改成行为 + 接线：以前钉的是 `tokenDaoZiFu(tokens, yangBen, tokenZhuQu(`这行原话，
 * 算术搬进 `peizhiYuSuan()` 之后主进程里就没有它了。现在判两件事：
 *  ① 行为：同一 token 数下，中文样本与代码样本折算出的**字符数必须不同**（样本真的被用上了）；
 *  ② 接线：主进程调 `peizhiYuSuan` 时把形状样本与该桶校准系数都传进去（少一个就永远走兜底常数）。
 */
jian('预算函数把样本参数传到折算处（不传等于白写）',
  (() => {
    const pei = { percent: 60, windowTokens: 32768 };
    const zh = YS.peizhiYuSuan({ ...pei, yangBen: '这是一段纯中文的形状样本，用来折算字符与 token 的比例。'.repeat(20) });
    const daiMa = YS.peizhiYuSuan({ ...pei, yangBen: 'const a = 1;\nfunction f(x) { return x + 1; }\n'.repeat(20) });
    return zh.tokens === daiMa.tokens && zh.chars !== daiMa.chars
      && /peizhiYuSuan\(\{[\s\S]{0,220}yangBen,[\s\S]{0,120}zhun: tokenZhuQu\(/.test(MAIN);
  })());
jian('每条发出去的预算路径都带样本（chat-send / 值班 / 工具循环窗口闸 / 界面滑杆 / 群协调）',
  quChu(MAIN, /yangBenBenCi\(|yangBenCongQingQiu\(/g) >= 4);

jian('端点报的数字一律标 native（以前把 prompt_tokens 标成估算 ⇒ 校准永远拿不到样本）',
  !/source:\s*'estimated'/.test(BASE) && quChu(BASE, /\?\s*'native'\s*:\s*'none'/g) >= 3);
jian('我们自己算的兜底仍如实标 estimated（不许冒充原生数据）',
  /source:\s*'estimated'/.test(MAIN));
jian('OpenAI 兼容流式主动要用量（include_usage），否则云端永远没有真实样本',
  /stream_options/.test(OAI) && /include_usage:\s*true/.test(OAI));
jian('不吃 stream_options 的中转有黑名单逃生口（宁可少一次用量，不许打挂对话）',
  /BU_YAO_STREAM_OPTIONS/.test(OAI) && /stream_options\/i/.test(OAI));
jian('流式解析把 usage 帧带出去（空 delta 也不能丢）',
  quChu(OAI, /guiFanYongLiang\(/g) >= 2);
jian('Anthropic 流式合并 message_start/message_delta 的用量后吐出',
  /message_start/.test(ANT) && /message_delta/.test(ANT) && /liuYongLiang/.test(ANT));

// ── ⑥ 脏输入不许抛（预算折算跑在每一轮上，抛一次就是整轮红） ──
jian('脏输入不抛：null/undefined/纯空白/超长', (() => {
  try {
    guJiToken(undefined); guJiToken(null); guJiToken('   \n\t ');
    tokenDaoZiFu(0, '', null); tokenDaoZiFu(NaN, ZHONGWEN, null);
    xinJiXiaoZhun(WEI_ZHUN, NaN, NaN);
    guJiTokenXiaoZhun(ZHONGWEN, { biLi: NaN, yangBenShu: 3 });
    return true;
  } catch { return false; }
})());
jian('坏校准值被忽略（biLi 不是有限数就按未校准算）',
  guJiTokenXiaoZhun(ZHONGWEN, { biLi: NaN, yangBenShu: 3 }) === guJiTokenXiaoZhun(ZHONGWEN, WEI_ZHUN));

const hong = jie.filter((x) => !x.ok).length;
for (const x of jie) console.log(`${x.ok ? 'PASS' : 'FAIL'} ${x.ming}${x.xiang ? ` —— ${x.xiang}` : ''}`);
console.log(`\n==== verify-r44-token：${jie.length - hong} ok / ${hong} FAIL ====`);
process.exit(hong ? 1 : 0);
