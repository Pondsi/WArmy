/**
 * 门禁：**行为级的「预计完成时间 + 轮次/时间上限」**（两个文件 + 判断闭环）。
 *
 * 产品需求（逐条对应断言）：
 *   ① 每类行为都有自己的两把尺子，**首次的数是固定的**，且取值有据可查（不许拍脑袋）；
 *   ② 时间到 / 次数到 ⇒ 判一次；
 *   ③ **判断前先看临时文件**：同一轮里"有过超时"就必须存在记录，里面有上次预测的**完成时间戳**；
 *      累计 3 次超出 ⇒ **直接判异常**（不再问模型）；
 *   ④ 没到 3 次 ⇒ 模型判：判卡死 ⇒ 异常；判没卡死 ⇒ **重新预测**（模型给 → 持久文件的方法 → 首次固定值）；
 *   ⑤ 持久文件里存的是**方法库**（按行为×签名聚类：样本/中位/90 分位/偏移系数/命中率），越用越准；
 *      它**开工时是空的** —— 没有方法就明说"没有历史"，不编数字；
 *   ⑥ 两个文件必须分开：持久是资产、临时是本轮账本；一轮收尾临时清空、经验留下。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(selfDir, '..');

const {
  EtaZhangBen, EtaLinShi, XING_WEI_MOREN, xingWeiGui, CHAO_SHI_LIAN_XU_XIAN, PAN_MO_XING_SHANG_XIAN,
  renWuQianMing, jiaEtaMiao, shuoShiChang, fenWei, ema, emaXiShu,
} = await import(new URL('../dist/eta-forecast.js', import.meta.url).href);

let pass = 0;
let fail = 0;
function check(l, ok, d) {
  if (ok) { pass++; console.log('  ok  ' + l); }
  else { fail++; console.log('  FAIL ' + l, d === undefined ? '' : JSON.stringify(d).slice(0, 400)); }
}

const tmp = path.join(os.tmpdir(), 'warmy-eta2-gate');
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
const chiJiu = path.join(tmp, 'eta.json');
const linShi = path.join(tmp, 'eta-live.json');
const T0 = 1_000_000_000;

// ── ① 五类行为各有固定初始值，且"不同行为不同数" ──
const LEI = ['duiHua', 'gongJu', 'dengDaiHuiFu', 'dengDaiXingDong', 'ziDongXuPai'];
check('五类行为都定义了固定初始值', LEI.every((x) => XING_WEI_MOREN[x] && XING_WEI_MOREN[x].miao > 0 && XING_WEI_MOREN[x].lun > 0), Object.keys(XING_WEI_MOREN));
const shiJian = LEI.map((x) => XING_WEI_MOREN[x].miao);
const ciShu = LEI.map((x) => XING_WEI_MOREN[x].lun);
check('不同行为的时间上限确实不同（不是一刀切）', new Set(shiJian).size >= 4, shiJian);
check('不同行为的次数上限确实不同', new Set(ciShu).size >= 3, ciShu);
check('每个初始值都写了依据（有据可查，不是拍脑袋）', LEI.every((x) => String(XING_WEI_MOREN[x].ju || '').length > 20 && /秒|分钟|轮|次/.test(XING_WEI_MOREN[x].ju)), LEI.map((x) => XING_WEI_MOREN[x].ju.length));
check('工具调用比对话轮"短"（读文件不该等 5 分钟）', XING_WEI_MOREN.gongJu.miao < XING_WEI_MOREN.duiHua.miao);
check('等待行动完成比单次工具调用"长"（构建/子代理天然更久）', XING_WEI_MOREN.dengDaiXingDong.miao > XING_WEI_MOREN.gongJu.miao);
check('异常阈值 = 3 次、判断最多换 5 个模型', CHAO_SHI_LIAN_XU_XIAN === 3 && PAN_MO_XING_SHANG_XIAN === 5);

// ── ⑤ 持久文件：方法库，开工时是空的 ──
const cang = new EtaZhangBen(chiJiu, T0);
check('持久文件开工时没有任何方法（它原本就是空的）', Object.keys(cang.kuaiZhao().fangFa).length === 0);
check('没有方法时查询返回 null（绝不编数字）', cang.chaFangFa('gongJu', 'x') === null);
check('没有方法时参考文本明说"还没有历史记录"', /还没有历史记录/.test(cang.canKaoWenBen('gongJu', 'x')));
check('没有方法时"按方法预测"返回 null（交给模型自己估）', cang.yuCeByFangFa('gongJu', 'x') === null);

// ── ③ 临时文件：本轮账本，第一次访问就按固定值立好预警点 ──
const huo = new EtaLinShi(linShi, T0);
const w = huo.xingWei('s1', 'gongJu', T0);
check('临时文件里这个行为的预警点 = 该类行为的固定初始值', w.yuJingMiao === xingWeiGui('gongJu').miao && w.yuJingLun === xingWeiGui('gongJu').lun, { miao: w.yuJingMiao, lun: w.yuJingLun });
check('还没有上次预测 ⇒ panChaoShi 报"空缺"（不是"超了"）', (() => { const r = huo.panChaoShi('s1', 'gongJu', T0); return r.kuiShi === true && r.chaoShi === false && r.yiChang === false; })());
check('临时文件真的落盘了（判断前读得到）', fs.existsSync(linShi), linShi);
const duHuo = JSON.parse(fs.readFileSync(linShi, 'utf8'));
check('临时文件结构：会话 → 行为 → {超时次数, 上次预测}', !!(duHuo.huiHua.s1.xingWei.gongJu && duHuo.huiHua.s1.xingWei.gongJu.chaoShiCiShu === 0), Object.keys(duHuo.huiHua.s1.xingWei));

// 模型给出预测 ⇒ 临时文件记下"完成时间戳"
const yu1 = huo.jiYuCe('s1', 'gongJu', { etaMs: 60_000, genJu: '读一个文件', laiYuan: 'model', moXing: 'm' }, T0 + 10_000);
check('预测记录含**绝对完成时间戳**（重启后能判超没超）', yu1.jieZhiMs === T0 + 10_000 + 60_000 && yu1.etaMs === 60_000, yu1);
check('预测记下"当时已经跑了多久"与来源', yu1.yiYongMs === 10_000 && yu1.laiYuan === 'model', yu1);
const duHuo2 = JSON.parse(fs.readFileSync(linShi, 'utf8'));
check('临时文件里真的写进了上次预测的完成时间戳', duHuo2.huiHua.s1.xingWei.gongJu.shangCiYuCe.jieZhiMs === yu1.jieZhiMs, duHuo2.huiHua.s1.xingWei.gongJu.shangCiYuCe);

// 没到点 ⇒ 不算超
check('没到预计完成时间 ⇒ 不算超时、计数不动', (() => { const r = huo.panChaoShi('s1', 'gongJu', T0 + 30_000); return r.chaoShi === false && r.ciShu === 0 && r.lianXu === 0; })());
// 超了 ⇒ 计数 +1
const chao1 = huo.panChaoShi('s1', 'gongJu', T0 + 100_000);
check('超过预计完成时间 ⇒ 累计次数 +1', chao1.chaoShi === true && chao1.ciShu === 1 && chao1.yiChang === false, chao1);

// ── ③ 累计 3 次 ⇒ 直接异常 ──
let yiChangZai = -1;
for (let i = 2; i <= 4; i++) {
  huo.jiYuCe('s2', 'gongJu', { etaMs: 60_000, laiYuan: 'model' }, T0 + i * 1_000_000);
  const r = huo.panChaoShi('s2', 'gongJu', T0 + i * 1_000_000 + 120_000);
  if (r.yiChang && yiChangZai < 0) yiChangZai = r.ciShu;
}
check(`累计超出第 ${CHAO_SHI_LIAN_XU_XIAN} 次判定异常（门禁读到 ${yiChangZai}）`, yiChangZai === 3, { yiChangZai });
check('异常后仍能读到"上次预测"（要如实告诉用户它预计还剩多久）', !!huo.panChaoShi('s2', 'gongJu', T0 + 9e9).shangCi);

// ── 中途没超 ⇒ 计数归零（"连续/累计"的语义都要对） ──
const huo3 = new EtaLinShi(path.join(tmp, 'live3.json'), T0);
huo3.jiYuCe('s3', 'gongJu', { etaMs: 60_000, laiYuan: 'model' }, T0);
huo3.panChaoShi('s3', 'gongJu', T0 + 120_000);            // 超一次
const huiLuo = huo3.panChaoShi('s3', 'gongJu', T0 + 130_000); // 已经重新预测过？没有 ⇒ 仍算超
huo3.jiYuCe('s3', 'gongJu', { etaMs: 600_000, laiYuan: 'model' }, T0 + 200_000);
const huiLuo2 = huo3.panChaoShi('s3', 'gongJu', T0 + 300_000); // 这次在预计时间内
check('这次在预计时间内 ⇒ **连续**计数归零（累计次数保留）', huiLuo2.chaoShi === false && huiLuo2.lianXu === 0 && huiLuo2.ciShu >= 1, { huiLuo, huiLuo2 });

// ── 预警点"加一档"（判没卡死之后） ──
const dang = huo3.jiaYiDang('s3', 'gongJu', T0 + 300_000);
check('判"没卡死"⇒ 预警点加一档（时间与次数都往后放）', dang.yuJingMiao > XING_WEI_MOREN.gongJu.miao && dang.yuJingLun > XING_WEI_MOREN.gongJu.lun, dang);

// ── ⑤ 自我完善：真实跑完的轮次进方法库 ──
const cangX = new EtaZhangBen(path.join(tmp, 'eta-x.json'), T0);
const qm = renWuQianMing({ gongJu: 'read_file', buShu: 3, gongJuMing: ['read_file', 'write_file'] });
for (const [yu, shi] of [[30_000, 48_000], [30_000, 54_000], [30_000, 60_000]]) {
  cangX.jiFangFa('gongJu', qm, { yuCeMs: yu, shiJiMs: shi, mingZhong: shi <= yu, moXing: 'm' }, T0);
}
const f = cangX.chaFangFa('gongJu', qm);
check('方法库长出了这类行为（样本数 = 3）', !!f && f.yangBen === 3, f && f.yangBen);
check('方法库记下中位/90 分位（真实耗时）', f.p50Ms >= 48_000 && f.p90Ms >= 54_000 && f.p90Ms <= 60_000, { p50: f.p50Ms, p90: f.p90Ms });
check('方法库学出"模型偏乐观"的偏移系数（>1.5）', f.piaoYiXiShu > 1.5, f.piaoYiXiShu);
check('方法库记下命中率（三次全超 ⇒ 接近 0）', f.mingZhongLv < 0.35, f.mingZhongLv);
check('方法库留痕（预测/实际/是否命中）', f.liZi.length === 3 && f.liZi[0].shiJiMs === 48_000, f.liZi);
const canKao = cangX.canKaoWenBen('gongJu', qm);
check('下一次参考里看得到这些统计（越用越准的输入）', /中位数/.test(canKao) && /命中率/.test(canKao) && /偏乐观|偏保守/.test(canKao), canKao.slice(0, 200));
check('有方法之后"按方法预测"给得出数（标注为 fangFa）', (() => { const y = cangX.yuCeByFangFa('gongJu', qm, T0); return !!y && y.laiYuan === 'fangFa' && y.etaMs >= f.p50Ms; })());

// ── 两个文件真的分开：各写各的，互不污染 ──
cangX.baCun();
const kuChiJiu = JSON.parse(fs.readFileSync(path.join(tmp, 'eta-x.json'), 'utf8'));
check('持久文件里**没有**本轮状态（只有方法库 + 全局统计）', kuChiJiu.version === 2 && !!kuChiJiu.fangFa && !kuChiJiu.huiHua, Object.keys(kuChiJiu));
const kuLinShi = JSON.parse(fs.readFileSync(linShi, 'utf8'));
check('临时文件里**没有**方法库（只有本轮状态）', kuLinShi.version === 1 && !!kuLinShi.huiHua && !kuLinShi.fangFa, Object.keys(kuLinShi));
check('临时文件记住"这一轮什么时候开始的"（算已用时长要用）', typeof kuLinShi.huiHua.s1.kaiShi === 'number' && kuLinShi.huiHua.s1.kaiShi === T0, kuLinShi.huiHua.s1);

// 重新加载：方法库还在（资产不丢）
const cangZai = new EtaZhangBen(path.join(tmp, 'eta-x.json'), T0);
check('重新加载后方法库还在（跨会话复用）', !!cangZai.chaFangFa('gongJu', qm) && cangZai.chaFangFa('gongJu', qm).yangBen === 3);

// 一轮收尾：临时清空、经验留下
const huoZ = new EtaLinShi(path.join(tmp, 'live-z.json'), T0);
huoZ.huiHua('sz', T0);
huoZ.jiYuCe('sz', 'ziDongXuPai', { etaMs: 300_000, laiYuan: 'model' }, T0 + 1000);
const xue = huoZ.xueXi('sz', 'ziDongXuPai', qm, cangZai, T0 + 240_000);
check('收尾时学到样本（预测 5 分钟 / 实际 4 分钟 ⇒ 命中）', xue.xueLe === true && xue.mingZhong === true && xue.shiJiMs === 240_000, xue);
huoZ.jieShuLun('sz');
check('收尾后本轮状态清空（不会污染下一次判断）', huoZ.huiHua('sz').xingWei.ziDongXuPai === undefined, huoZ.huiHua('sz').xingWei);
check('但方法库不受影响（学到的留住）', !!cangZai.chaFangFa('ziDongXuPai', qm));

// ── 边界 ──
check('离谱大值被夹到 24 小时', jiaEtaMiao(9e9) === 24 * 60 * 60 * 1000, jiaEtaMiao(9e9));
check('0/负数/非数字一律不接受', jiaEtaMiao(0) === null && jiaEtaMiao(-1) === null && jiaEtaMiao('x') === null);
check('人话时长格式', shuoShiChang(45_000) === '45 秒' && /^2 分 5 秒$/.test(shuoShiChang(125_000)) && /^2 小时 5 分$/.test(shuoShiChang(7_500_000)));
check('分位/滑平均：空样本不炸，小量级比值不被取整压平', fenWei([], 0.9) === 0 && ema(0, 1234) === 1234 && emaXiShu(1, 1.6, 0.35) > 1.1, emaXiShu(1, 1.6, 0.35));
check('签名按行为+工具+步数分档（同类才聚得起来）', renWuQianMing({ gongJu: 'read_file', buShu: 2 }) !== renWuQianMing({ gongJu: 'run_shell', buShu: 30 }));

// ── 主进程接线（静态不变量） ──
const emTs = fs.readFileSync(path.join(pkgRoot, 'src', 'electron-main.ts'), 'utf8');
check('两个文件都在 userData 下（eta.json / eta-live.json）', /'eta\.json'/.test(emTs) && /'eta-live\.json'/.test(emTs));
check('五类行为都接进了执行路径', ['duiHua', 'gongJu', 'dengDaiHuiFu', 'dengDaiXingDong', 'ziDongXuPai'].every((x) => new RegExp(`xingWei: '${x}'`).test(emTs) || new RegExp(`'${x}'`).test(emTs)), '行为覆盖');
check('判断顺序：先读临时文件 → 3 次就异常 → 才请模型', /panChaoShi\(sessionId, x\)/.test(emTs) && /chao\.yiChang/.test(emTs) && /await panDuanKaSi\(/.test(emTs));
check('模型没给预计值时：持久文件的方法 → 首次固定值（并如实标注来源）', /yuCeByFangFa\(x, qianMing\)/.test(emTs) && /laiYuan: 'fangFa'/.test(emTs) && /laiYuan: 'moren'/.test(emTs));
check('换模型顺序：正在用的 → 该牛马调用链 → 云 → 本地（最多 5 个）', /jia\(dangQianMoXing\)/.test(emTs) && /lianMingOf\(sessionId\)/.test(emTs) && /KASI_CHANGSHI/.test(emTs));
check('判异常后**拦住后续动作**（续派判据里检查标记）', /quEtaYiChang\(sessionId\)\) return \{ jiXu: false, liYou: 'eta-anomaly' \}/.test(emTs));
check('命中上限与异常都写进审计（可追溯）', /plan\.eta-limit-hit/.test(emTs) && /plan\.eta-anomaly/.test(emTs) && /plan\.eta-learn/.test(emTs));
check('退出前两个文件都落盘', /etaBaCun\(\)/.test(emTs));
check('聊天里给出"这个预计值不是模型给的"的如实标注', /eta\.notFromModel/.test(emTs));

// ── i18n：行为名与判断文案 10 语言齐备 ──
const i18nDir = path.join(pkgRoot, 'src', 'i18n');
const KEYS = ['eta.xw.duiHua', 'eta.xw.gongJu', 'eta.xw.dengDaiHuiFu', 'eta.xw.dengDaiXingDong', 'eta.xw.ziDongXuPai', 'eta.anomalyOverrun', 'eta.anomalyStalled', 'eta.anomalyStop', 'eta.continueWithEta', 'eta.notFromModel'];
let yuYanQue = 0;
for (const fn of fs.readdirSync(i18nDir).filter((x) => x.endsWith('.json'))) {
  const o = JSON.parse(fs.readFileSync(path.join(i18nDir, fn), 'utf8'));
  for (const k of KEYS) if (!o[k] || !String(o[k]).trim()) { yuYanQue++; console.log('  缺键', fn, k); }
}
check('10 个语言包都有行为名与判断文案（不出现半截文案）', yuYanQue === 0, { yuYanQue });

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n==== verify-eta-forecast: ${pass} ok / ${fail} FAIL ====`);
process.exit(fail ? 1 : 0);
