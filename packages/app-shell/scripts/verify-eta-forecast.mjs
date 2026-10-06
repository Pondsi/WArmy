/**
 * 门禁：**预计完成时间（ETA）** —— 模型每次判完"是否卡死"都要给一个，写进持久配置，
 * 连续 3 次超出按异常处理，并且**在使用中自我完善**（越用越准）。
 *
 * 产品要求（逐条对应断言）：
 *   ① 每次判断都要有预计完成时间（模型给；没给就按经验推算并**如实标注来源**）；
 *   ② 同一轮多次判断时，模型要能**参考它自己之前写的**（提问文本里必须有，且带"超了没"）；
 *   ③ 写进**持久配置文件**（真的落盘，重新加载还在）；
 *   ④ 连续 **3** 次超出 ⇒ 当异常处理；中途一次没超 ⇒ 计数归零；
 *   ⑤ 存下来的**不是简单一个时间**：绝对时刻 + 相对时长 + 依据 + 来源 + 模型 + 结论回填；
 *   ⑥ **原本没有任何预计时间**：第一次跑时统计为空，提问里明说"没有历史"，不编数字；
 *   ⑦ 使用中**自我完善**：真实跑完的轮次进统计（中位数/90 分位/偏移系数/命中率），
 *      同类任务的下一次参考里看得到。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(selfDir, '..');

const {
  EtaZhangBen, renWuQianMing, jiaEtaMiao, shuoShiChang, fenWei, ema, CHAO_SHI_LIAN_XU_XIAN,
} = await import(new URL('../dist/eta-forecast.js', import.meta.url).href);

let pass = 0;
let fail = 0;
function check(l, ok, d) {
  if (ok) { pass++; console.log('  ok  ' + l); }
  else { fail++; console.log('  FAIL ' + l, d === undefined ? '' : JSON.stringify(d).slice(0, 400)); }
}

const tmp = path.join(os.tmpdir(), 'warmy-eta-gate');
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
const wenJian = path.join(tmp, 'eta.json');

// ── ① 全新账本：没有任何预计时间，也不许编数字 ──
const cang = new EtaZhangBen(wenJian, 1_000_000);
check('全新账本：经验表为空', Object.keys(cang.kuaiZhao().leiXing).length === 0);
check('全新账本：没有任何会话状态', Object.keys(cang.kuaiZhao().huiHua).length === 0);
check('全新账本：全局样本数 = 0（它原本没有任何预计时间）', cang.kuaiZhao().quanJu.yangBen === 0);
const ming = renWuQianMing({ buShu: 5, gongJuMing: ['read_file', 'write_file'], zhiShuoBuZuo: false, moXing: 'mimo-v2.5-pro' });
check('没有经验时经验查询返回 null（不编）', cang.jingYan(ming) === null);
const wen0 = cang.canKaoWenBen('s1', ming, 1_000_000);
check('没有经验时提问文本**明说没有历史**', /还没有历史记录/.test(wen0), wen0.slice(0, 160));

// ── ② 模型给出预计完成时间 → 记进账本 ──
const T0 = 1_000_000_000;
const h = cang.kaiShiLun('s1', T0, ming);
check('一轮任务开工：kaiShi 记下来了', h.kaiShi === T0);
const yu1 = cang.jiYuCe('s1', { etaMs: 5 * 60 * 1000, genJu: '看起来还剩 3 步', laiYuan: 'model', moXing: 'mimo-v2.5-pro' }, T0 + 60_000);
check('预测是"丰富"的：相对时长 + 绝对时刻 + 依据 + 来源 + 模型 + 结论位', yu1.etaMs === 300000 && yu1.jieZhiMs === T0 + 60_000 + 300_000 && yu1.genJu && yu1.laiYuan === 'model' && yu1.moXing === 'mimo-v2.5-pro' && yu1.mingZhong === null, yu1);
check('预测记下了"当时已经跑了多久"', yu1.yiYongMs === 60_000, yu1.yiYongMs);

// 还没到点 → 不算超时
const chaoA = cang.panChaoShi('s1', T0 + 120_000);
check('没到预计完成时间 ⇒ 不算超时', chaoA.chaoShi === false && chaoA.lianXu === 0, chaoA);

// 第一次预测之前没有"上一次" ⇒ 谈不上超时
const cangB = new EtaZhangBen(path.join(tmp, 'b.json'), T0);
cangB.kaiShiLun('sb', T0);
check('还没有上一次预测 ⇒ chaoShi = null（不是"超了"）', cangB.panChaoShi('sb', T0 + 10_000_000).chaoShi === null);

// ── ② 多次判断：提问文本里必须带"它自己之前写的" ──
const wen1 = cang.canKaoWenBen('s1', ming, T0 + 400_000);   // 已过原定截止（T0+360000）
check('提问文本带上了"你本轮已经写过 N 次预计完成时间"', /你本轮已经写过 1 次预计完成时间/.test(wen1), wen1.slice(0, 200));
check('提问文本标出这条预测**已经超出**（并给出超了多久）', /已经超出/.test(wen1), wen1.slice(0, 240));
check('提问文本带上模型自己写的依据', /看起来还剩 3 步/.test(wen1), wen1.slice(0, 240));

const chaoB = cang.panChaoShi('s1', T0 + 400_000);
check('超过预计完成时间 ⇒ 连续计数 1', chaoB.chaoShi === true && chaoB.lianXu === 1 && chaoB.yiChang === false, chaoB);
const yu2 = cang.jiYuCe('s1', { etaMs: 8 * 60 * 1000, genJu: '上次估少了', laiYuan: 'model' }, T0 + 400_000);
check('第二次预测写进去了（同一轮里可以多次写）', cang.huiHua('s1').liCi.length === 2 && cang.huiHua('s1').shangCi.ts === yu2.ts);

// 这次没超 → 连续计数归零（"连续"的语义）
const chaoC = cang.panChaoShi('s1', T0 + 500_000);
check('这次在预计时间内 ⇒ 连续计数归零（真"连续"）', chaoC.chaoShi === false && chaoC.lianXu === 0, chaoC);

// ── ④ 连续 3 次超出 ⇒ 异常 ──
const cangC = new EtaZhangBen(path.join(tmp, 'c.json'), T0);
cangC.kaiShiLun('sc', T0);
let yiChangZai = -1;
for (let i = 0; i < 4; i++) {
  cangC.jiYuCe('sc', { etaMs: 60_000, laiYuan: 'model' }, T0 + i * 2_000_000);
  const r = cangC.panChaoShi('sc', T0 + i * 2_000_000 + 120_000);   // 每次都超出
  if (r.yiChang && yiChangZai < 0) yiChangZai = r.lianXu;
}
check(`连续超出第 ${CHAO_SHI_LIAN_XU_XIAN} 次判定异常（门禁读到 ${yiChangZai}）`, yiChangZai === CHAO_SHI_LIAN_XU_XIAN, { yiChangZai });
check('异常阈值是 3（产品定稿）', CHAO_SHI_LIAN_XU_XIAN === 3);

// ── ⑦ 自我完善：真实跑完的轮次进统计 ──
const cangX = new EtaZhangBen(path.join(tmp, 'x.json'), T0);
// 三轮同类任务：模型每次都估 5 分钟，实际分别 8/9/10 分钟（模型偏乐观）
let shiJi = [8, 9, 10];
let t = T0;
for (const m of shiJi) {
  cangX.kaiShiLun('sx', t, ming);
  cangX.jiYuCe('sx', { etaMs: 300_000, laiYuan: 'model', moXing: 'm' }, t + 1000);
  cangX.xueXi('sx', { shiJiMs: m * 60_000, now: t + m * 60_000 });
  cangX.jieShuLun('sx');
  t += 10 * 24 * 3600 * 1000;   // 换一轮（时间往前推）
}
const jing = cangX.jingYan(ming);
check('经验表长出了这类任务（跨轮累积）', !!jing && jing.yangBen === 3, jing && { yangBen: jing.yangBen });
check('中位数/90 分位是真实耗时分位（8~10 分钟一带）', jing.p50Ms >= 8 * 60_000 && jing.p90Ms >= jing.p50Ms && jing.p90Ms <= 10 * 60_000, { p50: jing.p50Ms, p90: jing.p90Ms });
check('学出了"模型偏乐观"的偏移系数（>1.5）', jing.piaoYiXiShu > 1.5, jing.piaoYiXiShu);
check('预测命中率被如实记下（三轮全超 ⇒ 接近 0）', jing.mingZhongLv < 0.3, jing.mingZhongLv);
check('样例留痕（预测/实际/是否命中）', jing.liZi.length === 3 && jing.liZi[0].shiJiMs === 8 * 60_000, jing.liZi);
const wenX = cangX.canKaoWenBen('sx2', ming, t);
check('同类任务的**下一次**参考里看得到这些统计', /实际耗时中位数/.test(wenX) && /命中率/.test(wenX) && /偏乐观|偏保守/.test(wenX), wenX.slice(0, 300));
check('参考文本里没有"还没有历史"（已经有经验了）', !/还没有历史记录/.test(wenX));

// 签名聚类：不同工作量 → 不同桶；同工作量 → 同桶
const mingXiao = renWuQianMing({ buShu: 2, gongJuMing: ['read_file'], moXing: 'mimo-v2.5-pro' });
const mingDa = renWuQianMing({ buShu: 30, gongJuMing: ['read_file', 'write_file', 'run_shell'], moXing: 'mimo-v2.5-pro' });
check('签名按步数分档（小任务/大任务不同桶）', mingXiao !== mingDa && /步数=1-3/.test(mingXiao) && /步数=21\+/.test(mingDa), { mingXiao, mingDa });
check('签名对工具顺序不敏感（同一批工具 = 同一桶）', renWuQianMing({ buShu: 5, gongJuMing: ['b', 'a'] }) === renWuQianMing({ buShu: 5, gongJuMing: ['a', 'b'] }));
check('签名剥掉模型版本尾巴（同一模型不同版本同桶）', renWuQianMing({ buShu: 5, moXing: 'mimo-v2.5-pro' }) === renWuQianMing({ buShu: 5, moXing: 'MIMO-V2.5-PRO' }));

// ── ③ 持久化：真的落盘，重新加载还在 ──
cang.baCun();
const yuanWen = fs.readFileSync(wenJian, 'utf8');
check('文件真的写出来了', yuanWen.length > 50, yuanWen.length);
const duan = JSON.parse(yuanWen);
check('文件结构不是"一个时间"：含版本/全局/类型经验/会话状态', duan.version === 1 && !!duan.quanJu && !!duan.leiXing && !!duan.huiHua, Object.keys(duan));
check('会话状态里有历次预测与连续超时计数', Array.isArray(duan.huiHua.s1.liCi) && duan.huiHua.s1.liCi.length === 2 && typeof duan.huiHua.s1.lianXuChaoShi === 'number', duan.huiHua.s1);
check('预测条目含绝对截止时刻（重启后能判超时）', duan.huiHua.s1.liCi[0].jieZhiMs > 0 && duan.huiHua.s1.liCi[0].etaMs > 0, duan.huiHua.s1.liCi[0]);
const cangZai = new EtaZhangBen(wenJian, T0);
check('重新加载后同一轮状态还在（进程退出不丢）', !!cangZai.huiHua('s1') && cangZai.huiHua('s1').liCi.length === 2);
check('重新加载后"连续超时"计数还在', cangZai.huiHua('s1').lianXuChaoShi === 0, cangZai.huiHua('s1').lianXuChaoShi);
const cangZaiX = new EtaZhangBen(path.join(tmp, 'x.json'), T0);
check('重新加载后同类任务的经验还在（"越用越准"的基础）', !!cangZaiX.jingYan(ming) && cangZaiX.jingYan(ming).yangBen === 3);

// ── 边界：模型的离谱值要被夹住，坏值不写进来 ──
check('离谱的大值被夹到 24 小时', jiaEtaMiao(999999999) === 24 * 60 * 60 * 1000, jiaEtaMiao(999999999));
check('过小的值被抬到 10 秒（0/负数/非数字都不接受）', jiaEtaMiao(0.001) === 10_000 && jiaEtaMiao(0) === null && jiaEtaMiao(-5) === null && jiaEtaMiao('abc') === null, [jiaEtaMiao(0.001), jiaEtaMiao(0), jiaEtaMiao(-5), jiaEtaMiao('abc')]);
check('人话时长格式（秒/分/小时）', shuoShiChang(45_000) === '45 秒' && /^2 分 5 秒$/.test(shuoShiChang(125_000)) && /^2 小时 5 分$/.test(shuoShiChang(7_500_000)), [shuoShiChang(45_000), shuoShiChang(125_000), shuoShiChang(7_500_000)]);
check('分位函数对空样本返回 0（不炸）', fenWei([], 0.5) === 0 && fenWei([1000], 0.9) === 1000);
check('滑动平均：首个样本直接采纳', ema(0, 500) === 500 && ema(500, 1000, 0.5) === 750);

// ── 收尾：一轮结束清状态，但经验留在库里 ──
cangZai.jieShuLun('s1');
check('一轮结束后"当下状态"清掉（不会无限累积）', cangZai.huiHua('s1') === null);
check('但经验表不受影响（学到的留住）', !!cangZaiX.jingYan(ming));

// ── 主进程接线（静态不变量）──
const emTs = fs.readFileSync(path.join(pkgRoot, 'src', 'electron-main.ts'), 'utf8');
check('判卡死时**要求模型给预计完成时间**（etaSeconds）', /"etaSeconds"/.test(emTs) && /etaSeconds/.test(emTs));
check('提问里带上模型自己写过的预测 + 同类经验', /canKaoWenBen\(sessionId, qianMing\)/.test(emTs) && /本轮已经跑了/.test(emTs));
check('连续 3 次超出 ⇒ 按异常处理并写进聊天记录', /err\.plan-eta-anomaly/.test(emTs) && /llm\.etaAnomaly/.test(emTs) && /chao\.yiChang/.test(emTs));
check('模型没给预计时间时按经验推算并如实标注来源', /function yuceTuSuan/.test(emTs) && /laiYuan: 'history'/.test(emTs) && /laiYuan: 'default'/.test(emTs));
check('每轮任务收尾时学习（预测 vs 实际）', /xueXi\(sessionId, \{ shiJiMs: Date\.now\(\) - h\.kaiShi \}\)/.test(emTs));
check('异常/出错中止的轮次不进学习样本', /jieShuLun\(sessionId\);   \/\/ 异常中止的轮次\*\*不进学习样本\*\*/.test(emTs));
check('退出前落盘（节流里那次不丢）', /etaZhangBen\?\.baCun\(\)/.test(emTs));
check('持久文件是 userData/eta.json', /path\.join\(app\.getPath\('userData'\), 'eta\.json'\)/.test(emTs));
check('聊天记录里如实告诉用户"这一声/这个数"是不是模型给的', /该预计值不是模型给的/.test(emTs));
check('预警点系统小字带上了预计完成时间', /llm\.stallEtaOk/.test(emTs) && /llm\.stallEtaOver/.test(emTs));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n==== verify-eta-forecast: ${pass} ok / ${fail} FAIL ====`);
process.exit(fail ? 1 : 0);
