/**
 * 第 44 轮后半 · 用户 #2/#3/#4：**上下文预算 = 所有发给模型的内容**（fast 档）
 *
 * 改之前的现实（自查实录）：预算只管"有界视图"那一段。固定开销 —— 道、规矩、印象、产品门禁、
 * 身份/身份锚、人设、能力清单、知识库、归档摘要、续派指令、步骤账本、子模型结果、工具规格 ——
 * **全在预算之外**。于是"滑杆设 2 万字符"实际发出去的是"2 万 + 一整套系统提示 + 工具 JSON"，
 * 用户那句"这个预算设置多少，就是发送多少内容给模型"根本没兑现。
 *
 * 这支门禁钉的是**算术与接线**：
 *  ① 分段成本可算、可加、不漏项（工具规格也算）；
 *  ② 视图只拿"整条预算 − 固定 − 工具 − 图片 − 执行余量"的余额；
 *  ③ 装不下时按**用户点名的顺序**降级：先摘要「最近 5 条 user 原文」→ 再摘要本轮 → 再收缩视图 →
 *    最后停止发送（不许"随便挑一段压"，也不许"就这一轮大所以超了"）；
 *  ④ 滑杆下限 = 实测固定开销（不是拍脑袋的 2048），上限仍可 100%；
 *  ⑤ 负向对照：旧口径（视图 = 整条预算）在同一组数字下**必然超预算** ⇒ 这些断言能失败。
 *
 * 用法：node dev/gates/verify-r44-yuSuan.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const GEN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const du = (p) => fs.readFileSync(path.join(GEN, p), 'utf8');
const Y = await import('../../packages/app-shell/dist/yuSuan-jiage.js')
  .catch(() => import(path.join(GEN, 'packages/app-shell/dist/yuSuan-jiage.js')));
const ZHAI = await import(pathToFileURL(path.join(GEN, 'packages/app-shell/dist/zhai-yao-he-bing.js')).href);
const ZAN_BIAN = await import(pathToFileURL(path.join(GEN, 'packages/app-shell/dist/executor.js')).href);
const { chaiFenDuan, jiageQingQiu, fenPeiYuSuan, JIANG_JI, SHI_TU_ZUI_XIAO_TOKENS, YUAN_WEN_ZUI_XIAO_SHI_TU, ZHI_XING_YU_LIANG, tuChengBen, keYiFenCi, TU_ZHANG_SHANG_XIAN, TU_JIANG_JI_BIAN_CHANG, SHI_JUE_JIA_JIA } = Y;

const jie = [];
const jian = (ming, ok, xiang) => { jie.push({ ming, ok: ok === true, xiang: xiang === undefined ? '' : String(xiang) }); };

const DAO = '【道 · 全局最高优先级】\n永远诚实，不许编造。'.repeat(4);
const GUI = '【规矩 · 仅次于「道」】\n改代码必须跑门禁。'.repeat(4);
const YIN = '【印象 · 牛马对用户的长期理解（低于「规矩」）】\n用户偏好中文回复。'.repeat(4);
const NENG = '【能力清单】write_file / open_path / run_shell / make_pptx'.repeat(6);
const GONGJU = JSON.stringify([{ type: 'function', function: { name: 'write_file', description: '写文件', parameters: {} } }, { type: 'function', function: { name: 'run_shell', description: '执行命令', parameters: {} } }]);

// ── ① 分段成本 ──
const duan = chaiFenDuan([{ role: 'system', content: `${DAO}\n${GUI}` }, { role: 'system', content: `${YIN}\n${NENG}` }]);
jian('固定开销按【标签】切段（每段都能单独报大小，用户 #3 要"可计算"）',
  duan.length >= 4 && duan.some((d) => d.ming.startsWith('道')) && duan.some((d) => d.ming.startsWith('规矩'))
  && duan.some((d) => d.ming.startsWith('印象')) && duan.some((d) => d.ming.startsWith('能力清单')),
  duan.map((d) => `${d.ming}=${d.tokens}`).join(' '));
jian('每段都有正的 token 成本（不许"段存在但算 0"）', duan.every((d) => d.tokens > 0 && d.zi > 0));
// 第 51 轮口径：**只有「道」永远不可压缩**；术/教条/束缚/印象/门禁/身份都可压
jian('只有「道」标为**不可压缩**（宁可停止发送也不改用户原话）',
  duan.filter((d) => d.ming.startsWith('道')).every((d) => d.keYaSuo === false)
  && duan.filter((d) => /^(规矩|印象|产品门禁|身份锚)/.test(d.ming)).every((d) => d.keYaSuo === true));
jian('其它段（能力清单等）允许压缩/节选', duan.filter((d) => d.ming.startsWith('能力清单')).every((d) => d.keYaSuo === true));
jian('无标签的正文归入「未标注」而不是被丢掉（丢了就等于少算成本）',
  chaiFenDuan([{ role: 'system', content: '这段没有任何标签。'.repeat(3) }]).every((d) => d.ming === '未标注'));
jian('多模态消息：文字块照常计价，图片块不占字符成本（图片另按视觉 token 算）',
  (() => {
    const d = chaiFenDuan([{ role: 'user', content: [{ type: 'text', text: '【本轮】看图说三个字' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] }]);
    const c = jiageQingQiu({ shangXiaWen: [], benLunZi: '', shiJueTok: 0 });
    const d2 = chaiFenDuan([{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] }]);
    return d.some((x) => x.tokens > 0 && x.ming === '本轮') && d2.length === 0 && c.shiJue === 0;
  })());

const cheng = jiageQingQiu({ shangXiaWen: [{ role: 'system', content: DAO }, { role: 'system', content: NENG }], gongJuWen: GONGJU, benLunZi: '帮我把这段整理成表格' });
jian('整条成本 = 固定 + 工具 + 视图 + 本轮（分项相加，不许漏工具）',
  cheng.zong === cheng.guDing + cheng.gongJu + cheng.shiTu + cheng.benLun + cheng.shiJue, JSON.stringify({ g: cheng.guDing, j: cheng.gongJu, b: cheng.benLun }));
const cheng2 = jiageQingQiu({ shangXiaWen: [{ role: 'system', content: DAO }, { role: 'system', content: NENG }], gongJuWen: '', benLunZi: '帮我把这段整理成表格' });
jian('加上工具规格后总成本必须变大（旧实现根本没算这一段）', cheng.zong > cheng2.zong, `${cheng.zong} vs ${cheng2.zong}`);
jian('视图那段单独可查（渲染完再量一次时用它记账）',
  jiageQingQiu({ shangXiaWen: [], shiTuZi: 'x'.repeat(4000) }).shiTu > 0);

// ── ② 分配：视图只拿余额 ──
const YS = 8000;
const fp = fenPeiYuSuan({ yuSuanTokens: YS, guDingTokens: cheng.guDing, gongJuTokens: cheng.gongJu, benLunTokens: cheng.benLun });
const qiWang = Math.floor(YS * (1 - ZHI_XING_YU_LIANG)) - cheng.guDing - cheng.gongJu - cheng.benLun;
jian('视图额度 = 预算×(1−执行余量) − 固定 − 工具 − 本轮（精确等式，不是"约等于"）',
  fp.shiTuTokens === qiWang, `得 ${fp.shiTuTokens} 期望 ${qiWang}`);
jian('视图额度严格小于预算（预算终于"包含全部发送内容"了）', fp.shiTuTokens < YS);
jian('留了执行余量（不贴边：视图额度 ≤ 预算×(1−余量)）', fp.shiTuTokens <= Math.floor(YS * (1 - ZHI_XING_YU_LIANG)));
jian('执行余量是个正常比例（0 < 余量 ≤ 0.5）', ZHI_XING_YU_LIANG > 0 && ZHI_XING_YU_LIANG <= 0.5);
// 负向对照：旧口径把整条预算都给视图 ⇒ 实际发送 = 视图 + 固定 + 工具 ⇒ 必超
const JIU_SHI_TU = YS;
const JIU_ZONG = JIU_SHI_TU + cheng.guDing + cheng.gongJu + cheng.benLun;
jian('负向对照成立：旧口径（视图=整条预算）在同一组数字下**必然超预算**',
  JIU_ZONG > YS && fp.shiTuTokens <= YS, `旧口径实际发 ${JIU_ZONG} > 预算 ${YS}；新口径视图 ${fp.shiTuTokens}`);

// ── ③ 降级阶梯（用户 #4 点名的顺序）＋ 两条边界 ──
/** 边界 A：**不许假装装不下** —— 不知道窗口时，预算低于实测下限就抬到下限，视图至少保住最小值 */
const tai = fenPeiYuSuan({ yuSuanTokens: 4000, guDingTokens: 3800, gongJuTokens: 900, benLunTokens: 300 });
jian('预算低于固定开销实测下限时把生效预算**抬到下限**（真机红过：不抬就把视图算成 0，等于假装模型失忆）',
  tai.shiTuTokens >= SHI_TU_ZUI_XIAO_TOKENS && tai.shengXiaoTokens > 4000,
  `视图 ${tai.shiTuTokens} 生效预算 ${tai.shengXiaoTokens} 下限 ${tai.zuiXiaoYuSuan}`);
jian('视图放不下「最近 5 条原文」时，第一级动作就是摘要这一段（#4）',
  tai.jiangJi[0] === JIANG_JI.ZHAIYAO_ZUIJIN5, tai.jiangJi.join(' → '));
jian('抬到下限后不再判"超"（装得下就别喊装不下）', tai.chaoYu === false && tai.chuangKouBuGou === false);
/** 边界 B：**不许偷偷超发** —— 窗口真的小于固定开销时，如实报并走到"停止发送" */
const xia = fenPeiYuSuan({ yuSuanTokens: 4000, guDingTokens: 3800, gongJuTokens: 900, benLunTokens: 300, chuangKouTokens: 4000 });
jian('窗口装不下固定开销 ⇒ 如实报 chuangKouBuGou（不能靠抬下限假装能发）',
  xia.chuangKouBuGou === true && xia.chaoYu === true, JSON.stringify({ biao: xia.shengXiaoTokens, ke: xia.shiTuTokens }));
jian('最后一级是「停止发送」，不许"就这一轮大所以超了"',
  xia.jiangJi[xia.jiangJi.length - 1] === JIANG_JI.TINGZHI, xia.jiangJi.join(' → '));
jian('视图收缩排在摘要之后（先牺牲冗余原文，最后才牺牲视图）',
  xia.jiangJi.indexOf(JIANG_JI.SHOU_SHITU) > xia.jiangJi.indexOf(JIANG_JI.ZHAIYAO_ZUIJIN5));
jian('生效预算永远不超过"窗口扣掉执行余量"（抬下限也不越窗）',
  xia.shengXiaoTokens <= Math.floor(4000 * (1 - ZHI_XING_YU_LIANG)));
/** 本轮超长与图片阶梯 */
const chaoChang = fenPeiYuSuan({ yuSuanTokens: 6000, guDingTokens: 1500, gongJuTokens: 300, benLunTokens: 3800 });
jian('本轮自己就吃光视图 ⇒ 「本轮原文也要摘要」出现在动作里，且排在原文摘要之后',
  chaoChang.jiangJi.includes(JIANG_JI.ZHAIYAO_BENLUN)
  && chaoChang.jiangJi.indexOf(JIANG_JI.ZHAIYAO_BENLUN) > chaoChang.jiangJi.indexOf(JIANG_JI.ZHAIYAO_ZUIJIN5),
  chaoChang.jiangJi.join(' → '));
const tuDing = fenPeiYuSuan({ yuSuanTokens: 6000, guDingTokens: 2000, gongJuTokens: 500, benLunTokens: 200, shiJueTokens: 2200 });
jian('图片占掉大半视图 ⇒ 先降分辨率再减张数（#5 的阶梯，顺序不许颠倒）',
  tuDing.jiangJi.includes(JIANG_JI.DI_FENBIANLV)
  && tuDing.jiangJi.indexOf(JIANG_JI.JIAN_ZHANGSHU) > tuDing.jiangJi.indexOf(JIANG_JI.DI_FENBIANLV),
  tuDing.jiangJi.join(' → '));
const tuKuan = fenPeiYuSuan({ yuSuanTokens: 40000, guDingTokens: 8000, gongJuTokens: 2000, benLunTokens: 500, shiJueTokens: 1000 });
jian('预算充足 ⇒ 一个降级动作都不许做（把"能装下"也判成超 = 打扰用户）',
  tuKuan.chaoYu === false && tuKuan.jiangJi.length === 0 && tuKuan.shiTuTokens > YUAN_WEN_ZUI_XIAO_SHI_TU, `视图 ${tuKuan.shiTuTokens}`);

// ── ④ 最小预算（滑杆下限） ──
jian('最小预算 = 固定 + 工具 + 本轮 + 图片 + 视图最小，再按执行余量放大',
  fenPeiYuSuan({ yuSuanTokens: 1, guDingTokens: 3000, gongJuTokens: 1000, benLunTokens: 200, shiJueTokens: 0 }).zuiXiaoYuSuan
  >= 3000 + 1000 + 200 + SHI_TU_ZUI_XIAO_TOKENS);
jian('固定开销越大 ⇒ 最小预算越大（单调，不是常数下限）',
  fenPeiYuSuan({ yuSuanTokens: 1, guDingTokens: 5000, gongJuTokens: 0, benLunTokens: 0 }).zuiXiaoYuSuan
  > fenPeiYuSuan({ yuSuanTokens: 1, guDingTokens: 2000, gongJuTokens: 0, benLunTokens: 0 }).zuiXiaoYuSuan);
jian('视图有下限（预算再小也不给"空视图"，那是第 21 轮的真事故）',
  SHI_TU_ZUI_XIAO_TOKENS >= 256);

// ── ⑤ 脏输入不许抛（这条跑在每一轮发送前） ──
jian('脏输入不抛：NaN / 负数 / undefined / 空数组', (() => {
  try {
    chaiFenDuan(undefined); chaiFenDuan([{ role: 'system', content: null }]);
    jiageQingQiu({}); jiageQingQiu({ shangXiaWen: [{ content: 123 }], gongJuWen: undefined });
    fenPeiYuSuan({ yuSuanTokens: NaN, guDingTokens: -5, gongJuTokens: undefined, benLunTokens: Infinity });
    return true;
  } catch { return false; }
})());
jian('极端：预算只有 1 token ⇒ 视图仍保住最小额度（绝不出现"空视图"，也不出现负额度）',
  (() => {
    const x = fenPeiYuSuan({ yuSuanTokens: 1, guDingTokens: 9000, gongJuTokens: 100, benLunTokens: 10 });
    return x.shiTuTokens >= SHI_TU_ZUI_XIAO_TOKENS && x.chaoYu === false;
  })());
jian('极端 + 窗口真的小 ⇒ 判超、给出停止发送（不靠抬下限偷偷发出去）',
  (() => {
    const x = fenPeiYuSuan({ yuSuanTokens: 1, guDingTokens: 9000, gongJuTokens: 100, benLunTokens: 10, chuangKouTokens: 8000 });
    return x.chuangKouBuGou === true && x.chaoYu === true && x.jiangJi.includes(JIANG_JI.TINGZHI);
  })());
jian('「最近 5 条原文」的保留门槛是明确的（不是随手挑的数：视图 < 2048 token 就摘要）',
  YUAN_WEN_ZUI_XIAO_SHI_TU > SHI_TU_ZUI_XIAO_TOKENS && YUAN_WEN_ZUI_XIAO_SHI_TU <= 8192);

// ── ⑥ 静态接线：核算必须在渲染之前、工具清单只有一份 ──
const MAIN = du('packages/app-shell/src/electron-main.ts');
const FEN = du('packages/app-shell/src/yaSuo-fenCeng.ts');
const APP = du('packages/app-shell/src/renderer/app.js');
const EXE = du('packages/app-shell/src/executor.ts');
const ORI = du('packages/app-shell/src/orchestrator.ts');
const quChu = (s, re) => (s.match(re) || []).length;
const at = (re) => { const m = MAIN.search(re); return m; };
const idxHeSuan = at(/jiageQingQiu\(\{[\s\S]{0,260}shangXiaWen: shenFenTou/);
const idxRanDuan = at(/const shitu = renderChatView\(sessionId, benLunFaSongWen, shiTuChars\)/);
jian('成本核算发生在视图渲染**之前**（否则视图额度还是按整条预算算 ⇒ 改造等于没做）',
  idxHeSuan > 0 && idxRanDuan > idxHeSuan, `核算@${idxHeSuan} 渲染@${idxRanDuan}`);
jian('旧的"视图直接用整条预算"那一行已经删掉（不许留第二条路）',
  !/renderChatView\(sessionId, xiaoXi\.content, budgetChars\)/.test(MAIN));
jian('工具清单只有一份实现（发送侧与计价侧共用 `zuJingGongJuGuiGe`，不许再抄一份拼接）',
  (MAIN.match(/\[\.\.\.ganHuoTools, \.\.\.jiyiTools/g) || []).length === 1
  && (MAIN.match(/zuJingGongJuGuiGe/g) || []).length >= 3);
jian('本轮用户消息不重复计费（它已经在视图里；只有另外 push 的内部续派指令才计）',
  /benLunZi: shiNeiBuCaiDan \? benLunFaSongWen : ''/.test(MAIN)
  && /let benLunFaSongWen = String\(xiaoXi\.content \|\| ''\)/.test(MAIN));
jian('降级动作真的执行，并在执行后**重新核算**（只列动作不执行 = 假改造）',
  /fp\.jiangJi\.includes\(JIANG_JI\.ZHAIYAO_ZUIJIN5\)[\s\S]{0,200}yaSuoZuiJin5YuanWen\(\)[\s\S]{0,200}chengBen = jiBen\(\)/.test(MAIN));
jian('每一轮的分配结果进审计（固定开销各段大小必须当场看得见）',
  /chat\.budget\.allocated/.test(MAIN) && /duan: chengBen\.mingXi\.map/.test(MAIN) && /zuiXiaoYuSuan: fp\.zuiXiaoYuSuan/.test(MAIN));
jian('滑杆下限来自主进程实测（`zuiXiaoPercent` 一路传到 `ctxMinPercent`）',
  /zuiXiaoPercent: zuiXiao \?/.test(MAIN) && /ctxState\.zuiXiaoPercent = Number\(r\.zuiXiaoPercent\)/.test(APP)
  && /Math\.max\(10, ji, gu\)/.test(APP));
jian('上限仍可 100%（下限封顶在 99，不许把滑杆顶死）', /Math\.min\(99, Math\.max\(10, ji, gu\)\)/.test(APP));
jian('窗口也交给分配器封顶（抬下限不许越窗：`chuangKouTokens` 必须真传，且传的是扣掉输出预留与安全垫之后的窗口）',
  /chuangKouTokens: keZhuangShuRuChuangKou/.test(MAIN));
jian('固定开销超过窗口时界面如实说（不是把滑杆顶到 99% 假装能选）',
  /chuangKouBuGou: chaoChuangKou/.test(MAIN) && /ctx\.budget\.overWindow/.test(APP) && /ctxState\.chuangKouBuGou = r\.chuangKouBuGou === true/.test(APP));
jian('没实测过时界面不许假装量过（catch 分支与 null 都归 0）',
  /ctxState\.zuiXiaoPercent = 0/.test(APP) && /Number\(r\.zuiXiaoPercent\) > 0/.test(APP));
jian('界面显示的是**生效值**（设置值低于下限时，显示下限而不是显示一个不生效的数）',
  /const eff = Math\.max\(Number\(ctxState\.percent\) \|\| 60, minP\)/.test(APP) && /s\.value = String\(eff\)/.test(APP));

// ── ⑦ 溢出保护：窗口要留出输出预留 + 一点点安全垫（用户：预算要预留一点点，防止溢出模型上下文）──
jian('预算的 token 数被"窗口 − 2%（至少 128）"夹住（贴边设预算 = 每次都赌误差方向）',
  (() => {
    const r = Y.peizhiYuSuan({ percent: 100, windowTokens: 8192, charBeiJian: 1.6 });
    return r.yuLiangTok === 163 && r.anQuanChuangKou === 8029 && r.tokens === 8029;
  })(), '算术现在在 yuSuan-jiage.ts（压力档与主进程共用）');
jian('分配用的窗口是「窗口 − 本轮输出预留 − 安全垫」，不是裸窗口',
  /chuangKouTokens: keZhuangShuRuChuangKou/.test(MAIN)
  && /keZhuangShuRuChuangKou[\s\S]{0,160}anQuanChuangKou[\s\S]{0,80}- yuZhanTok/.test(MAIN));
jian('输出预留只有一个算法（发送侧与计价侧共用 `benLunShuChuYuZhan`，两份就会漂移）',
  quChu(MAIN, /benLunShuChuYuZhan\(/g) >= 2 && !/const shuChuShangXian = \(yaoChangWen \|\| jiaQiangHuiFu\) \? 12288 : 4096/.test(MAIN));
jian('输出预留的 12288 / 4096 只出现在常量定义处（别处再写一次就是第二套口径；注释里解释用途不算）',
  (() => {
    const daiMa = MAIN.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    return quChu(daiMa, /12288/g) <= 1 && quChu(daiMa, /\? 4096\b/g) === 0
      && /const SHU_CHU_CHANG = 12288;/.test(daiMa) && /const SHU_CHU_DUAN = 4096;/.test(daiMa);
  })());
jian('输出预留尊重用户在额度里设的上限（`shuChu` > 0 时取 min，取不到才回基础值）',
  /yuE\.shuChu > 0\) return Math\.max\(2048, Math\.min\(base, yuE\.shuChu\)\)/.test(MAIN));

// ── ⑧ 图片（用户 #5）：计入预算、张数/大小上限、降分辨率、分次判断、装不下就停 ──
const tu8 = Array.from({ length: 9 }, () => ({ kuan: 1024, gao: 1024 }));
const cb9 = tuChengBen({ tu: tu8 });
jian('张数真的有上限，而且超出的那张数被如实报出来（静默截断=用户以为图发过去了）',
  cb9.zhangShu === TU_ZHANG_SHANG_XIAN && cb9.diZhang === 9 - TU_ZHANG_SHANG_XIAN, JSON.stringify({ z: cb9.zhangShu, d: cb9.diZhang }));
jian('成本按**像素**算：同尺寸每张一个价，尺寸翻倍 ⇒ 成本翻倍以上（不是按字节猜）',
  (() => {
    const yi = tuChengBen({ tu: [{ kuan: 512, gao: 512 }] }).shiJueTok;
    const da = tuChengBen({ tu: [{ kuan: 2048, gao: 2048 }] }).shiJueTok;
    return yi > 0 && da > yi * 3;
  })(), `${tuChengBen({ tu: [{ kuan: 512, gao: 512 }] }).shiJueTok} vs ${tuChengBen({ tu: [{ kuan: 2048, gao: 2048 }] }).shiJueTok}`);
jian('逐张价与合计对得上（减张数那一档要靠这张表，不能用平均值凑）',
  (() => {
    const c = tuChengBen({ tu: [{ kuan: 800, gao: 600 }, { kuan: 1600, gao: 1200 }, { kuan: 300, gao: 300 }] });
    return c.geZhangTok.length === 3 && c.geZhangTok.reduce((s, x) => s + x, 0) === c.shiJueTok
      && c.zuiDaDanZhangTok === Math.max(...c.geZhangTok);
  })());
jian('每张都带安全加价（宁可多留地方，视觉 token 只会低估不会高估）',
  (() => {
    const c = tuChengBen({ tu: [{ kuan: 1024, gao: 1024 }] });
    return SHI_JUE_JIA_JIA > 1 && c.shiJueTok >= Math.ceil(c.shiJueTok / SHI_JUE_JIA_JIA) * SHI_JUE_JIA_JIA - 1;
  })(), `加价 ${SHI_JUE_JIA_JIA}`);
jian('超过降分辨率边长的图被标成"该降"，已经小的不标（不许对着小图假装降过）',
  tuChengBen({ tu: [{ kuan: TU_JIANG_JI_BIAN_CHANG * 2, gao: TU_JIANG_JI_BIAN_CHANG * 2 }] }).yaoJiangJi === true
  && tuChengBen({ tu: [{ kuan: 512, gao: 512 }] }).yaoJiangJi === false);
jian('脏输入不抛也不给"免费"：空数组/缺像素的项被挡掉，剩下的照常计价',
  (() => {
    const a = tuChengBen({ tu: [] });
    const b = tuChengBen({ tu: [{ kuan: 0, gao: 0 }, { kuan: 640, gao: 480 }] });
    return a.shiJueTok === 0 && a.zhangShu === 0 && b.zhangShu === 1 && b.shiJueTok > 0;
  })());
jian('图片计进整条成本：同一份文字 + 图片，`zong` 必须比不加图时大（图片不许游离在预算外）',
  (() => {
    const t = tuChengBen({ tu: [{ kuan: 1280, gao: 720 }], moXing: 'gpt-4o-mini' }).shiJueTok;
    const wu = jiageQingQiu({ shangXiaWen: [{ role: 'system', content: DAO }], benLunZi: '看图说话', zhun: null });
    const you = jiageQingQiu({ shangXiaWen: [{ role: 'system', content: DAO }], benLunZi: '看图说话', shiJueTok: t, zhun: null });
    return wu.shiJue === 0 && you.shiJue === t && you.zong === wu.zong + t;
  })(), `单张 ${tuChengBen({ tu: [{ kuan: 1280, gao: 720 }], moXing: 'gpt-4o-mini' }).shiJueTok}`);
jian('图片挤掉视图额度：带图的分配结果里视图必须小于不带图的（挤不动就该走阶梯）',
  (() => {
    const t = tuChengBen({ tu: [{ kuan: 2048, gao: 2048 }] }).shiJueTok;
    const wu = fenPeiYuSuan({ yuSuanTokens: 8000, guDingTokens: 1200, gongJuTokens: 800, benLunTokens: 300, chuangKouTokens: 32000 });
    const you = fenPeiYuSuan({ yuSuanTokens: 8000, guDingTokens: 1200, gongJuTokens: 800, benLunTokens: 300, shiJueTokens: t, chuangKouTokens: 32000 });
    return you.shiTuTokens === wu.shiTuTokens - t && you.zuiXiaoYuSuan > wu.zuiXiaoYuSuan;
  })());
jian('图片占到一半以上可用额度 ⇒ 点名"降分辨率 + 减张数"两档（不是直接砍视图）',
  (() => {
    const c = fenPeiYuSuan({ yuSuanTokens: 8000, guDingTokens: 1000, gongJuTokens: 600, benLunTokens: 200, shiJueTokens: 3000, chuangKouTokens: 32000 });
    return c.jiangJi.includes(JIANG_JI.DI_FENBIANLV) && c.jiangJi.includes(JIANG_JI.JIAN_ZHANGSHU);
  })());
jian('没有图片时**不许**凭空喊降分辨率（负向对照：这两档只由图片成本触发）',
  (() => {
    const c = fenPeiYuSuan({ yuSuanTokens: 8000, guDingTokens: 1000, gongJuTokens: 600, benLunTokens: 200, shiJueTokens: 0, chuangKouTokens: 32000 });
    return !c.jiangJi.includes(JIANG_JI.DI_FENBIANLV) && !c.jiangJi.includes(JIANG_JI.JIAN_ZHANGSHU);
  })());
jian('降分辨率排在建张数之前、且都在"停止发送"之前（用户点名的顺序：降分辨率 → 压缩上下文 → 停止）',
  (() => {
    const c = fenPeiYuSuan({ yuSuanTokens: 3000, guDingTokens: 1000, gongJuTokens: 600, benLunTokens: 200, shiJueTokens: 3000, chuangKouTokens: 2000 });
    const i = (x) => c.jiangJi.indexOf(x);
    return i(JIANG_JI.DI_FENBIANLV) >= 0 && i(JIANG_JI.DI_FENBIANLV) < i(JIANG_JI.JIAN_ZHANGSHU)
      && i(JIANG_JI.JIAN_ZHANGSHU) < i(JIANG_JI.TINGZHI) && c.chuangKouBuGou === true;
  })(), '窗口 2000 装不下固定开销 + 3000 图片 ⇒ 三档都要点名');
jian('分次判断：只有一张图 ⇒ 不分次（分一次没有意义，别把简单事情做复杂）',
  keYiFenCi({ tuShu: 1, danZhangTok: 100, keYongTok: 5000, benLunWen: '这张图里有什么' }).keYi === false);
jian('分次判断：本轮要求跨图对比 ⇒ **不许分次**（分开送就看不漏另一张，那是无声的错误）',
  keYiFenCi({ tuShu: 4, danZhangTok: 300, keYongTok: 5000, benLunWen: '对比一下这几张截图，哪张的按钮位置不一样' }).keYi === false
  && keYiFenCi({ tuShu: 4, danZhangTok: 300, keYongTok: 5000, benLunWen: 'these two logs differ, which one has the error' }).keYi === false);
jian('分次判断：单张 + 固定开销放不下 ⇒ 不分次（分多少次都放不下）',
  (() => { const r = keYiFenCi({ tuShu: 3, danZhangTok: 9000, keYongTok: 5000, benLunWen: '每张都讲一下' }); return r.keYi === false && r.yiCiZhang === 0; })());
jian('分次判断：没有对比需求且单张放得下 ⇒ 分次，并给出每次几张',
  (() => { const r = keYiFenCi({ tuShu: 6, danZhangTok: 1000, keYongTok: 2500, benLunWen: '每张图里有什么文字' }); return r.keYi === true && r.yiCiZhang === 2; })());

jian('宿主接线：本轮原文摘要真的执行（摘要后**重新核算**，不是只列动作）',
  /JIANG_JI\.ZHAIYAO_BENLUN\) && benLunFaSongWen\.length > 1500/.test(MAIN)
  && /benLunFaSongWen = jie \+ `…（本轮原文还有/.test(MAIN)
  && /yaSuoBenLun|recall\("/.test(MAIN));
jian('宿主接线：图片成本走唯一算法 `tuChengBen`，且只在"这张图真的会进请求"时才计（转成文字的图不重复收费）',
  /const tuCb = \(\): ReturnType<typeof tuChengBen> => \(zhiJieKanTu && tuKuaiJi\.length/.test(MAIN)
  && /shiJueTok: tuCb\(\)\.shiJueTok/.test(MAIN) && /shiJueTokens: c\.shiJue/.test(MAIN));
jian('宿主接线：张数上限在附件循环里真拦（超出的逐张登记，不是 slice 掉了事）',
  /tuKuaiJi\.length >= TU_ZHANG_SHANG_XIAN/.test(MAIN) && /（单轮最多 \$\{TU_ZHANG_SHANG_XIAN\} 张，超出未喂给模型）/.test(MAIN));
jian('宿主接线：每张图的像素跟着图块存下来（丢了这份就只能按字节猜成本）',
  /const tuCheJi: Array<\{ kuan: number; gao: number \}> = \[\]/.test(MAIN)
  && /tuCheJi\.push\(\{ kuan: zhuan\.tu\.kuan, gao: zhuan\.tu\.gao \}\)/.test(MAIN)
  && /huiHuaTuKuai\.set\(sidT2, \{ kuai: tuKuaiJi\.slice\(\), ming: tuMingJi\.slice\(\), che: tuCheJi\.slice\(\) \}\)/.test(MAIN));
jian('宿主接线：分次发送前有**两道**判断（能分 + 该分），并且真的分批发',
  /const fc = keYiFenCi\(\{/.test(MAIN) && /if \(fc\.keYi\)/.test(MAIN) && /await tuFenCiKanTu\(modelId, tuKuaiJi, tuMingJi, fc\.yiCiZhang\)/.test(MAIN));
jian('宿主接线：降分辨率在减张数**之前**执行，减下来的张逐张写明为什么没喂',
  MAIN.indexOf('tuXiaoShao(') > 0 && MAIN.indexOf('tuXiaoShao(') < MAIN.indexOf('超出本轮预算，第')
  && /（超出本轮预算，第 \$\{i \+ 1\} 张起未喂给模型：单张约 \$\{ge\[i\] \|\| 0\} token/.test(MAIN));
jian('宿主接线：不支持看图的模型收不到图片块（合并前再兜一道，不依赖每条转交分支都不出错）',
  /if \(tuKuaiJi\.length && !moXingKeyiKanTu\(modelId\)\)/.test(MAIN) && /chat\.images-blocked-by-capability/.test(MAIN));
jian('宿主接线：看图能力的判断只有一份（`moXingKeyiKanTu`），不许再在别处内联 vision===true',
  (() => {
    const daiMa = MAIN.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    return quChu(daiMa, /vision === true/g) <= 2 && /function moXingKeyiKanTu/.test(MAIN)
      && !/const nlNow = modelNengLiMeta\.get\(modelId\) \|\| moXingNengLi\(modelId, null\)/.test(MAIN);
  })(), '两处允许：kind 归类与 inTypes 推导（都在唯一那条链上）');
jian('宿主接线：装不下就真的**不发**（走异常系统，带具体原因；不是把请求硬塞出去等 400）',
  /fp\.jiangJi\.includes\(JIANG_JI\.TINGZHI\)/.test(MAIN)
  && /biaoRenWuZhongDuan\(String\(sessionId \|\| ''\), liYou[\s\S]{0,60}'budget-overflow'/.test(MAIN)
  && /chat\.budget\.stop-send/.test(MAIN) && /budgetStopped: true/.test(MAIN));
jian('宿主接线：校准不再一律跳过带图的轮 —— 先扣掉图片的视觉 token 再校准文字系数',
  /const shiJue = qingQiuYouTu\(Qiu\?\.xiaoXiJi\) \? qingQiuShiJueTok\(Qiu\) : 0/.test(MAIN)
  && /tokenZhuJiaoZhun\(gongYingFen, mo, qingQiuGuJiWen\(Qiu\), zhen, shiJue\)/.test(MAIN));

// ── ⑨ 定稿技术要点不许被改造冲掉（ADR000 P3「注入量恒定」/ P5「马尔可夫毯 = O(任务规模)」/ 两条路径同口径 / 宁缺不假 id）──
jian('迟注入层（账本 + 子模型结果 + 分次看图描述）是**预算里的一段**，不是预算之外',
  (() => {
    const wu = jiageQingQiu({ shangXiaWen: [{ role: 'system', content: DAO }], benLunZi: '本轮', zhun: null });
    const you = jiageQingQiu({ shangXiaWen: [{ role: 'system', content: DAO }], benLunZi: '本轮', daiRuZi: '已做完的操作'.repeat(200), zhun: null });
    return wu.daiRu === 0 && you.daiRu > 0 && you.zong === wu.zong + you.daiRu;
  })());
jian('迟注入层挤掉视图额度（同预算下带注入层的视图必须更小），而**份额上限是常数**（不随图片张数/子任务数涨）',
  (() => {
    const a = fenPeiYuSuan({ yuSuanTokens: 8000, guDingTokens: 1000, gongJuTokens: 600, benLunTokens: 300, chuangKouTokens: 32000 });
    const b = fenPeiYuSuan({ yuSuanTokens: 8000, guDingTokens: 1000, gongJuTokens: 600, benLunTokens: 300, daiRuTokens: 1200, chuangKouTokens: 32000 });
    return b.shiTuTokens === a.shiTuTokens - 1200 && Y.DAI_RU_CENG_ZUI_DA_ZI > Y.ZHANG_BEN_ZUI_DA_ZI;
  })(), `注入层 ${Y.DAI_RU_CENG_ZUI_DA_ZI} 字 / 账本 ${Y.ZHANG_BEN_ZUI_DA_ZI} 字`);
jian('宿主真的按上限截断（预留了却不截 = 假预留）：子任务结果与执行日志两处都有截断 + 审计',
  /he\.length > DAI_RU_CENG_ZUI_DA_ZI/.test(MAIN) && /chat\.delegate-capped/.test(MAIN)
  && /zhang\.length > ZHANG_BEN_ZUI_DA_ZI/.test(MAIN) && /chat\.step-ledger-capped/.test(MAIN));
jian('截断后的文本才是发出去的那份（不许截完又拼原文）',
  /\+ he\b/.test(MAIN) && !/\+ jieGuoWenBen\.join\('\\n'\)/.test(MAIN));
jian('注入层的两份额度不共用（账本 + 子模型结果会同时出现，共用一份额度等于少扣一倍）',
  /const zhang = benLunXuJie\.get\(String\(sessionId \|\| ''\)\) \? ZHANG_BEN_ZUI_DA_ZI : 0/.test(MAIN)
  && /return zhang \+ yao;/.test(MAIN));
jian('图片可用额度也减掉注入层（分次判定与减张数都不许把这一段的份额当成自己的）',
  quChu(MAIN, /chengBen\.daiRu - SHI_TU_ZUI_XIAO_TOKENS/g) === 2);
jian('执行者的马尔可夫毯有单条闸（ADR000 P5：上下文 = O(任务规模)，不是 O(日志规模)）',
  (() => {
    const r = ZAN_BIAN.shouZhanBian(['用'.repeat(5000), '短的一条']);
    return r.wen.length < 4000 && r.beiJian === 1 && /按序号回原文里取/.test(r.wen);
  })());
jian('毯的总长闸：超总长的条目**整条丢掉**并如实计数（切成半句比不喂更坏）',
  (() => {
    const r = ZAN_BIAN.shouZhanBian(Array.from({ length: 12 }, (_, i) => `第${i}条 ${'字'.repeat(2000)}`), 9000, 2500);
    return r.diuShu > 0 && r.wen.length <= 9000 && /没有进毯/.test(EXE);
  })(), `丢掉 ${ZAN_BIAN.shouZhanBian(Array.from({ length: 12 }, (_, i) => `第${i}条 ${'字'.repeat(2000)}`), 9000, 2500).diuShu} 条`);
jian('毯体不再裸 join（`contextItems.join` 那份没有闸，是这一档的原罪）', !/renwu\.contextItems\.join\(/.test(EXE) && /shouZhanBian\(renwu\.contextItems/.test(EXE));
jian('群里的用户原话进毯前设闸（10M 的原话以前整段抄进执行者上下文；切口给前缀与提示留位，行为见 verify-r48-heiban ⑦）',
  /yuan\.slice\(0, qieKou\)/.test(ORI) && /const qieKou = ZHAN_BEN_DAN_TIAO_ZI_SHANG_XIAN - \d+/.test(ORI) && /原话过长，未进毯的部分按序号回群日志取/.test(ORI));
/**
 * 多执行者的结论汇总（第 48 轮改成**行为**判据）：以前是"整段拼起来、超 3000 字从尾部一刀截"，
 * 排后面的执行者整段消失。现在每人一节、按公平配额有界（zheng-liu.ts）——这里直接喂 5 个长结论，
 * 看新口径是不是每个人都在、每节都 ≤ 配额；同一组数据下旧口径**必然**丢人（负向对照，证明断言有牙）。
 */
{
  const ZL = await import(pathToFileURL(path.join(GEN, 'packages/app-shell/dist/zheng-liu.js')).href);
  const ming = ['甲', '乙', '丙', '丁', '戊'];
  const peiE = ZL.meiRenPeiE(ming.length);
  const jie = ming.map((m) => ZL.zhengLiu({
    taskId: 't-' + m, jiaoFu: { jieLun: `${m}的结论。`.repeat(200), chanWu: [], shiShi: [], jueDing: [], wenTi: [] },
    zhengWen: '', youGongJu: true, heShi: () => '', stats: { durationMs: 0, promptTokens: 0, completionTokens: 0 },
  }));
  const xinJie = jie.map((z, i) => ZL.zhengLiuXiaoJie(z.jieGuo, ming[i], peiE, z.chaoChang));
  const jiu = ming.map((m) => `【${m}】${`${m}的结论。`.repeat(200)}`).join('\n\n').slice(0, 3000);
  jian('多执行者的结论汇总有界且公平（每人一节 ≤ 配额，排后面的执行者不再整段消失）',
    xinJie.every((s, i) => s.length <= peiE && s.includes(`【${ming[i]}】`)) && ming.some((m) => !jiu.includes(`【${m}】`)),
    `配额 ${peiE} · 新口径各节 ${xinJie.map((s) => s.length).join('/')} · 旧口径保住 ${ming.filter((m) => jiu.includes(`【${m}】`)).length}/5 人`);
}
jian('两条路径同一个口径：群/值班的视图额度也按**余额**（以前只有单聊扣固定开销）',
  /const ji = zuiXiaoJiDangQian\(String\(gongYingFen \|\| ''\), modelId\)/.test(MAIN)
  && MAIN.indexOf('const ji = zuiXiaoJiDangQian') < MAIN.indexOf('function renderChatView'));
jian('实测下限取两侧最大值（被较小的测量冲掉就等于少扣 ⇒ 顶窗）',
  quChu(MAIN, /Math\.max\(cbQun\.guDing, jiu\?\.guDing \|\| 0\)/g) >= 1 && /Math\.max\(chengBen\.guDing, jiu\?\.guDing \|\| 0\)/.test(MAIN));
jian('值班路径自己也要量固定开销（不量就只能按整条预算放行）', /chat\.budget\.duty-measured/.test(MAIN));
/**
 * 锚点口径（第 44 轮后半 · 用户 #7）改成**行为真值表**，不再搜主进程里的字面：
 * 旧断言是 `!/recordId: \`seq:/` + 数几个 `recordId: ''` —— 那是字节锚，重构一下写法就能骗过去。
 * 现在直接调纯函数：喂"真日志 / 缺 id 的日志 / 旧写法的假 id"三种夹具，看它会不会造出解引用不到的锚点。
 */
{
  const MD = await import(pathToFileURL(path.join(GEN, 'packages/app-shell/dist/guiDang-maidian.js')).href);
  const zhen = [
    { seq: 1, recordId: 'm-1001' }, { seq: 2, recordId: '' }, { seq: 3 }, { seq: 4, recordId: 'm-1004' },
    { seq: 5, recordId: 'm-1005' }, { seq: 6, recordId: 'm-1006' }, { seq: 7, recordId: 'm-1007' },
  ];
  const a1 = MD.maidianCongRiZhi(zhen, { zuiDuo: 5 });
  jian('锚点只取最近 N 条、顺序不倒（锚点是"能回去"的线索，不是全量清单）',
    a1.length === 5 && a1[0].seq === 3 && a1[a1.length - 1].seq === 7, JSON.stringify(a1.map((x) => x.seq)));
  jian('有真 id 就逐字用真 id（模型照抄能 retrieve 到）',
    a1.filter((x) => x.recordId === 'm-1005' || x.recordId === 'm-1006').length === 2);
  jian('拿不到真 id ⇒ 留**空串**，不许派生（假 id 会把"查不到"伪装成"查得到"）',
    a1.every((x) => typeof x.recordId === 'string') && a1.some((x) => x.recordId === '') && a1.every((x) => !/^seq/i.test(x.recordId)));
  jian('没有 seq 的条目不许当锚点（宁可少一条，也不许给一个指不到地方的指针）',
    MD.maidianCongRiZhi([{ recordId: 'm-9' }, { seq: 0, recordId: 'm-8' }, { seq: 2, recordId: 'm-2' }]).every((x) => x.seq === 2));
  jian('不变量自检对**真锚点**报 0 违反', MD.maidianWeiFan(a1, zhen).length === 0, JSON.stringify(MD.maidianWeiFan(a1, zhen)));
  /** 负向夹具：旧写法（派生 id）与"日志里没有的 seq"都必须被自检判红，否则这条门禁等于没写 */
  jian('〔能变红〕旧写法 `seq:N` 被自检判成派生假 id',
    MD.maidianWeiFan([{ file: 'chat-log', seq: 12, recordId: 'seq:12' }], zhen).includes('paiShengId'));
  jian('〔能变红〕日志里查不到的 recordId 被自检判成假 id',
    MD.maidianWeiFan([{ file: 'chat-log', seq: 1, recordId: 'm-不存在的' }], zhen).includes('jiaId'));
  jian('〔能变红〕日志里没有的 seq 被自检判成假 seq',
    MD.maidianWeiFan([{ file: 'chat-log', seq: 999, recordId: '' }], zhen).includes('jiaSeq'));
  jian('外部群归档：payload 只有 {file,seq} 时照样不派生 id，有 id 就带上',
    (() => {
      const w = MD.maidianCongWaiBu([{ file: 'ilink', seq: 4 }, { file: 'ilink', seq: 5, recordId: 'm-2005' }]);
      return w.length === 2 && w[0].recordId === '' && w[1].recordId === 'm-2005' && MD.maidianWeiFan(w, [{ seq: 4 }, { seq: 5, recordId: 'm-2005' }]).length === 0;
    })());
  jian('主进程三处归档锚点都走这个纯构造口径（不许再各写一份）',
    (() => {
      const zhu = du('packages/app-shell/src/electron-main.ts');
      return quChu(zhu, /maidianCongRiZhi\(/g) === 1 && quChu(zhu, /maidianCongWaiBu\(/g) === 3
        && !/recordId: `seq:/.test(zhu) && !/recordId: ''\s*\}\)\)/.test(zhu);
    })());
  jian('解引用侧对空 recordId 有回落（空串必须落回 seq 线索，不然"宁缺"变成"丢失"）',
    /if \(anchor\.recordId\)/.test(du('packages/memory-os/src/index.ts')));
}

// ── ⑩ 窗口装不下固定开销时：先压"允许动的部分"，压完还不够才停（停止必须真的传出来）──
const duan2 = chaiFenDuan([{ role: 'system', content: `${DAO}\n${GUI}\n${YIN}\n${NENG}` }]);
jian('固定开销分成"可压缩 / 不许动"两段报（只标不算是第 44 轮留下的空转）',
  (() => {
    const c = jiageQingQiu({ shangXiaWen: [{ role: 'system', content: `${DAO}\n${NENG}` }], zhun: null });
    return c.keYaSuo > 0 && c.buKeYaSuo > 0 && c.keYaSuo + c.buKeYaSuo === c.guDing;
  })());
jian('只有「道」在**不许动**那一侧（教条/印象在上下文不足时可压）',
  (() => {
    const c = jiageQingQiu({ shangXiaWen: [{ role: 'system', content: `${DAO}\n${GUI}\n${YIN}` }], zhun: null });
    return c.buKeYaSuo > 0 && c.keYaSuo > 0 && c.keYaSuo + c.buKeYaSuo === c.guDing;
  })());
jian('「压缩固定段」这一级排在**停止发送之前**（能压就别停，停是最后一级）',
  (() => {
    const c = fenPeiYuSuan({ yuSuanTokens: 3000, guDingTokens: 20000, gongJuTokens: 9000, benLunTokens: 0, chuangKouTokens: 28000 });
    const i = (x) => c.jiangJi.indexOf(x);
    return c.chuangKouBuGou === true && i(JIANG_JI.YA_SUO_GU_DING) >= 0 && i(JIANG_JI.YA_SUO_GU_DING) < i(JIANG_JI.TINGZHI);
  })());
/**
 * 第④·六级「让出余量」：真机事故（`verify-history-persist` 第 [1] 段两条红）——
 * 模型窗口未知 ⇒ 兜底窗口偏小 ⇒ 道（不可压缩）+ 工具顶满 ⇒ `chat.budget.stop-send` 缺 3356 token，
 * 整轮什么都没发。而缺口其实全在**我们自己留的垫子**里（输出留位 12288 + 2% 安全垫 + 5% 执行余量）。
 * 所以：让垫子排在停止发送**之前**，且只让到"模型还能回一小段"的地板。
 */
{
  const { rangChuYuLiang, SHU_CHU_LIU_WEI_DI_BAO, SHU_CHU_LIU_WEI_ZUI_DUO_BI, ZHI_XING_YU_LIANG_RANG_HOU } = Y;
  const anLi = rangChuYuLiang({ maxTokens: 32768, anQuanChuangKou: 32768 - Math.max(128, Math.floor(32768 * 0.02)), yuZhanTok: 12288 });
  jian('让出余量后**真的多出地方**（安全垫让完 + 输出留位退到地板），并且让了多少说得清',
    anLi.rangChu > 0 && anLi.keZhuang > 0 && anLi.keZhuang === 32768 - anLi.yuZhanXin, JSON.stringify(anLi));
  jian('输出留位不许让到 0：地板 = max(2048, 窗口×4%)，且与**发送侧的保底 2048 同源**（两边不同数就会一边放行一边顶窗）',
    anLi.yuZhanXin === Math.max(SHU_CHU_LIU_WEI_DI_BAO, Math.floor(32768 * SHU_CHU_LIU_WEI_ZUI_DUO_BI))
    && anLi.yuZhanXin >= SHU_CHU_LIU_WEI_DI_BAO && SHU_CHU_LIU_WEI_DI_BAO >= 2048);
  jian('留位本来就比地板小 ⇒ 一个字都不让（不许把小窗口的输出挤没）',
    rangChuYuLiang({ maxTokens: 32768, anQuanChuangKou: 32000, yuZhanTok: 512 }).yuZhanXin === 512);
  jian('执行余量退到 2% 就停手（不是 0：模板 token 与估算误差总要留一点）',
    anLi.yuLiangBi === ZHI_XING_YU_LIANG_RANG_HOU && ZHI_XING_YU_LIANG_RANG_HOU > 0 && ZHI_XING_YU_LIANG_RANG_HOU < ZHI_XING_YU_LIANG);
  /**
   * 让完余量之后，**发送侧的 maxTokens 必须跟着降**（本轮自查抓到的真缺陷）：
   * 输入窗口是按"只给输出留 1310"放行的，而 `yunXuShuChu` 另有一处按额度算（长文 12288）——
   * 两边各算一次 ⇒ 输入 + 输出顶穿窗口，供应商 400。这正是这段代码自己注释里警告过的漂移。
   */
  jian('让出余量后**发送侧输出上限跟着降到同一个数**（不许一边放行一边仍要 12288）',
    /if \(rangChuGuo && yuZhanShengXiao > 0\)/.test(MAIN)
    && /yunXuShuChu = Math\.max\(SHU_CHU_LIU_WEI_DI_BAO, Math\.min\(yunXuShuChu, yuZhanShengXiao\)\)/.test(MAIN)
    && /chat\.budget\.output-cap-lowered'/.test(MAIN)
    && /yuZhanShengXiao = rc\.yuZhanXin;/.test(MAIN));
  jian('〔能变红〕没让过余量时不许动发送侧的输出上限（否则每轮都把长文配额砍掉）',
    MAIN.indexOf('if (rangChuGuo && yuZhanShengXiao > 0)') > MAIN.indexOf('let yunXuShuChu = shuChuShangXian;')
    && /let yuZhanShengXiao = 0;/.test(MAIN));
  /** 阶梯顺序与触发条件（含负向对照：装得下 / 没得让 ⇒ 不许出现这一级） */
  const duan = { yuSuanTokens: 3000, guDingTokens: 18751, gongJuTokens: 2926, benLunTokens: 0, chuangKouTokens: 19825 };
  const youRang = fenPeiYuSuan({ ...duan, keRangTokens: anLi.rangChu });
  const i = (x) => youRang.jiangJi.indexOf(x);
  jian('「让出余量」排在压缩固定段之后、**停止发送之前**',
    i(JIANG_JI.YA_SUO_GU_DING) >= 0 && i(JIANG_JI.RANG_CHU_YU_LIANG) > i(JIANG_JI.YA_SUO_GU_DING)
    && i(JIANG_JI.RANG_CHU_YU_LIANG) < i(JIANG_JI.TINGZHI), youRang.jiangJi.join('→'));
  jian('〔能变红〕已经让过了（keRang=0）⇒ 阶梯里不许再有这一级（否则原地打转、永远停在"还能让"）',
    !fenPeiYuSuan({ ...duan, keRangTokens: 0 }).jiangJi.includes(JIANG_JI.RANG_CHU_YU_LIANG));
  jian('〔能变红〕窗口装得下 ⇒ 一级都不该出现（垫子不是白让的）',
    (() => {
      const c = fenPeiYuSuan({ yuSuanTokens: 20000, guDingTokens: 8000, gongJuTokens: 3000, benLunTokens: 0, chuangKouTokens: 28000, keRangTokens: 11633 });
      return !c.chuangKouBuGou && !c.jiangJi.includes(JIANG_JI.RANG_CHU_YU_LIANG) && !c.jiangJi.includes(JIANG_JI.TINGZHI);
    })());
  jian('宿主接线：这一级只在**没让过**时执行一次，并把窗口/余量/审计一起改掉',
    /if \(fp\.jiangJi\.includes\(JIANG_JI\.RANG_CHU_YU_LIANG\) && !rangChuGuo\)/.test(MAIN)
    && /chat\.budget\.give-back-reserve/.test(MAIN)
    && /keRangTokens: rangChuGuo \? 0 :/.test(MAIN));
  jian('让完仍装不下才停止发送（让余量不许变成"偷偷超发"）',
    /rengQue: fp\.jiangJi\.includes\(JIANG_JI\.TINGZHI\)/.test(MAIN)
    && MAIN.indexOf('chat.budget.give-back-reserve') < MAIN.indexOf('chat.budget.stop-send'));
}
jian('缺口按**分配器实际用的那条上限**算（拿裸窗口算会 chao≤0 却仍判装不下 ⇒ 这一趟空转，下一级永远走不到）',
  /const chao = chengBen\.zong \+ SHI_TU_ZUI_XIAO_TOKENS - fp\.shengXiaoTokens/.test(MAIN)
  && !/const chao = chengBen\.zong \+ SHI_TU_ZUI_XIAO_TOKENS - keZhuangShuRuChuangKou/.test(MAIN));
jian('压缩只动可压缩段（不可压名单只有一个来源 BU_KE_YA_SUO；分层表在 yaSuo-fenCeng，不留第二份）',
  /if \(cengOf\(biao, BU_KE_YA_SUO\) === -1\) return;/.test(MAIN)
  && /guiHuaYiLun\(dangQian, lunXian, chaoZi\)/.test(MAIN)
  && /import \{ BENG_DAO, cengOf, guiHuaYiLun/.test(MAIN)
);
jian('压下去的段当场说明"不是删掉了"（截断必须留下可执行的取回路径）', /完整内容由记忆工具 recall\/retrieve 取，不是删掉了/.test(MAIN));
jian('工具面截尾是**计价与发送同一个数**（一边全套一边截尾 = 预算算错）',
  /gongJuWen = await gongJuChengBenWen\(sessionId, xiaoXi\.xiaoDiShuLiang, gongJuZuiDuoShu\)/.test(MAIN)
  && /zuJingGongJuGuiGe\(sessionId, xiaoDiShangXian, jiyiJiuxu, keGanHuo, zuiDuoGongJu\)/.test(MAIN)
  && quChu(MAIN, /xiaoXi\.xiaoDiShuLiang, gongJuZuiDuoShu\)/g) >= 3);
/**
 * 截尾优先级与"说得出名字"（第 48 轮改成**行为**判据：截尾逻辑收进纯模块 `gong-ju-fen-dang.ts`，主进程计价侧与发送侧同调）。
 * 夹具 = 本机真实的工具面形状（26 条：最小干活集 11 + 读取类 + 其它 + 派小弟 + 自定义）。
 */
{
  const FD = await import(pathToFileURL(path.join(GEN, 'packages/app-shell/dist/gong-ju-fen-dang.js')).href);
  const g = (n) => ({ type: 'function', function: { name: n } });
  const quan = ['write_file', 'read_file', 'list_dir', 'edit_file', 'open_path', 'get_time', 'ask_user', 'plan_update', 'run_shell',
    'find_files', 'search_files', 'list_archive', 'read_archive_entry', 'read_document', 'find_skill', 'read_skill',
    'make_pptx', 'make_docx', 'web_fetch', 'spawn_subagent', 'subagent_status', 'recall', 'retrieve', 'zi_ding_a', 'zi_ding_b', 'take_screenshot'].map(g);
  const ZD = new Set(['zi_ding_a', 'zi_ding_b']);
  const r6 = FD.fenDangJieWei(quan, 6, { ziDingMing: ZD });
  const ming6 = r6.liu.map((x) => x.function.name);
  jian('截尾优先级：记忆双刀与**最小干活集**永远先留（真机事故：裁到 6 条时 write_file 被裁掉 ⇒ 模型口头"已写入"而文件不存在）',
    FD.ZUI_XIAO_GAN_HUO_JI.every((n) => ming6.includes(n)) && r6.shou === FD.ZUI_XIAO_GAN_HUO_JI.length && r6.shou > 6,
    `上限 6 ⇒ 实留 ${r6.shou}：${ming6.join(',')}`);
  jian('裁了谁、留了谁必须**说得出名字**（只报"截到 N 条"查不到案发现场；主进程把 liu/diu/点名一起写进 chat.tools.trim-list）',
    r6.diu.length === quan.length - r6.shou && r6.diu.includes('spawn_subagent') && r6.diu.includes('zi_ding_a')
    && /chat\.tools\.trim-list', \{ sessionId, zuiDuo: fd\.shou, baoDi: fd\.baoDi, liu: fd\.liu\.map/.test(MAIN), r6.diu.join(','));
  const wen = '请用 list_archive 查看 r16-1.zip 里有什么文件，把条目名列出来。';
  const dian = FD.dianMingGongJu(wen, quan.map((x) => x.function.name));
  const youDian = FD.fenDangJieWei(quan, 12, { ziDingMing: ZD, dianMing: dian }).liu.map((x) => x.function.name);
  const wuDian = FD.fenDangJieWei(quan, 12, { ziDingMing: ZD }).liu.map((x) => x.function.name);
  jian('用户这一轮点名/明显要用的工具不许被裁（第 48 轮 live 真事故：窗口只够 12 条，list_archive 被裁，模型最后用 open_path 把压缩包打开了）',
    dian.has('list_archive') && youDian.includes('list_archive') && youDian.includes('read_archive_entry') && !wuDian.includes('list_archive'),
    `点名 ${[...dian].join(',')} · 有点名 ⇒ 留 ${youDian.length} 条含 list_archive=${youDian.includes('list_archive')} · 负向（不认点名）⇒ ${wuDian.includes('list_archive')}`);
  {
    const ZW = await import(pathToFileURL(path.join(GEN, 'packages/app-shell/dist/gong-ju-zhi-wen.js')).href);
    const duan = '海风把灯塔的门吹得吱呀作响，'.repeat(60);
    const a = ZW.gongJuZhiWen('write_file', { append: true, content: duan, path: 'Desktop/小说与海.txt' });
    const b = ZW.gongJuZhiWen('write_file', { append: true, content: duan, path: 'Desktop/小说-灯与海.txt' });
    const c = ZW.gongJuZhiWen('write_file', JSON.stringify({ path: 'Desktop/小说-灯与海.txt', content: duan, append: true }));
    const d = ZW.gongJuZhiWen('write_file', { append: true, content: duan + '尾巴不同', path: 'Desktop/小说-灯与海.txt' });
    /** 旧算法（前 400 字截断）复刻一份当负向对照：同一组输入在旧算法下必须撞车，否则这条判据证明不了什么 */
    const jiu = (ming, can) => ming + '|' + JSON.stringify(Object.fromEntries(Object.entries(can).sort(([x], [y]) => (x < y ? -1 : 1)))).slice(0, 400);
    jian('工具指纹按全文区分（第 48 轮 live：只差路径的两次长正文追加撞成"同参重复"被拦两次）：只差路径 ⇒ 不同；只差尾巴 ⇒ 不同；键序不同 ⇒ 相同；预览仍可读',
      a !== b && b === c && b !== d && /^write_file\|\{"append":true,"content":"/.test(b)
      && jiu('write_file', { append: true, content: duan, path: 'Desktop/小说与海.txt' }) === jiu('write_file', { append: true, content: duan, path: 'Desktop/小说-灯与海.txt' })
      && /suanGongJuZhiWen\(ming, can\)/.test(MAIN),
      { a: a.slice(-24), b: b.slice(-24), d: d.slice(-24) });
  }
  jian('点名只认真实存在的工具名（正文里出现"read_file_x"不算点名 read_file；空话 ⇒ 空集）',
    !FD.dianMingGongJu('调用 read_file_x 看看', ['read_file']).has('read_file') && FD.dianMingGongJu('', ['read_file']).size === 0
    && FD.dianMingGongJu('用 read_file 读一下', ['read_file']).has('read_file'));
  {
    const r34Wen = '在我的桌面上生成一个txt文本，生成一个ppt，写入 你是谁，我是谁。\n完成后等待30秒，然后写一个6000字的小说';
    const keYong2 = [...quan.map((x) => x.function.name), 'wait_seconds', 'make_xlsx', 'make_pdf'];
    const quan2 = [...quan, g('wait_seconds')];
    const d34 = FD.dianMingGongJu(r34Wen, keYong2);
    const you34 = FD.fenDangJieWei(quan2, 12, { ziDingMing: ZD, dianMing: d34 }).liu.map((x) => x.function.name);
    const wu34 = FD.fenDangJieWei(quan2, 12, { ziDingMing: ZD }).liu.map((x) => x.function.name);
    jian('用户要的产物类型与等待也算点名（第 48 轮 live：窗口兜底偏小时"生成一个ppt / 等待30秒"里的 make_pptx、wait_seconds 被裁，模型回"本轮无 make_pptx 工具"）',
      d34.has('make_pptx') && d34.has('wait_seconds') && !d34.has('make_xlsx') && !d34.has('make_pdf')
      && you34.includes('make_pptx') && you34.includes('wait_seconds') && !wu34.includes('make_pptx') && !wu34.includes('wait_seconds')
      && FD.dianMingGongJu('今天天气怎么样', keYong2).size === 0
      && FD.dianMingGongJu('帮我做一个 Excel 表格', keYong2).has('make_xlsx')
      && FD.dianMingGongJu('等一会儿再继续', keYong2).has('wait_seconds')
      && !FD.dianMingGongJu('等我想想', keYong2).has('wait_seconds'),
      `点名 ${[...d34].join(',')} · 有点名留 make_pptx=${you34.includes('make_pptx')} wait=${you34.includes('wait_seconds')} · 负向 ${wu34.includes('make_pptx')}/${wu34.includes('wait_seconds')}`);
  }
  jian('点名在**用户轮**算、续派轮沿用；计价侧与发送侧读同一份（主进程接线）',
    /internal !== true\) \{\s*try \{ benLunDianMingGongJu\.set\(String\(sessionId \|\| ''\), dianMingGongJu\(/.test(MAIN)
    && /const dianMing = benLunDianMingGongJu\.get\(String\(sessionId \|\| ''\)\)/.test(MAIN));
  /**
   * 完成核对轮不许整篇重写已交付文件（第 48 轮 live 真事故：r34 MiMo 腿核对轮把 8326 字小说整篇重发，白烧 330 秒）。
   * 主进程内部函数跑不进 fast 档 ⇒ 这里钉**接线关系**（拦截在 runWorkTool 之前、只认核对轮、只拦非追加的 write_file、
   * 只拦本任务写过且磁盘上有内容的），行为由 live 档 `verify-round34-live` 的"同一个文件没有被整篇重写"兜底。
   */
  {
    const han = (MAIN.match(/function heDuiLunChongXieZuDang\([\s\S]*?\n}\n/) || [''])[0];
    jian('完成核对轮里整篇重写本任务已交付的文件 ⇒ 宿主拦下（不执行、不走授权、回可执行的替代做法）',
      /if \(gongJuMing !== 'write_file' \|\| !heDuiLunZhong\.has\(sid\)\) return null;/.test(han) && /if \(shiZhuiJia\(a\)\) return null;/.test(han)
      && /if \(!jiu \|\| zi <= 0\) return null;/.test(han) && /plan_verify/.test(han) && /append:true/.test(han) && /edit_file/.test(han)
      && /heDuiLunChongXieZuDang\(String\(sessionId \|\| ''\), base, gongJuMing, call\)/.test(MAIN)
      && /daiHuiDang\(String\(sessionId \|\| ''\), \(\) => runWorkTool\(base, call/.test(MAIN)
      && MAIN.indexOf('heDuiLunChongXieZuDang') < MAIN.indexOf('runWorkTool(base, call')
      && /if \(xiaoXi\.ziYouHuiDa === true\) heDuiLunZhong\.add\(String\(sessionId \|\| ''\)\);\s*else heDuiLunZhong\.delete\(/.test(MAIN));
  }
}
jian('压缩有下限：段内至少留 600 字、整体最多压掉 55%，且不许一刀切到极限（第 52 轮分层）',
  /export const YA_SUO_DI_XIAN = 600/.test(FEN)
  && /Math\.min\(Math\.max\(YA_SUO_DI_XIAN, Math\.floor\(yuanShi \* YA_SUO_ZHEN\)\), yuanShi\)/.test(FEN)
  && /Math\.floor\(keZi \* 0\.55\)/.test(MAIN)
  && !/Math\.max\(0\.45, Math\.min\(0\.95/.test(MAIN)
  && !/Math\.max\(0\.15,/.test(MAIN));
jian('停止原因点名**最大的那一段**（不说出是哪段，用户只能猜该调哪个设置）',
  /const zuiDa = \(chengBen\.mingXi \|\| \[\]\)\.slice\(\)\.sort\(\(a, b\) => b\.tokens - a\.tokens\)\[0\]/.test(MAIN)
  && /tMain\('chat\.budget\.stopLargest', '最大的一段是「\{m\}」= \{t\} token（\{k\}）'\)\s*\n\s*\.replace\('\{m\}'/.test(MAIN)
  && /注入层 \$\{chengBen\.daiRu\}/.test(MAIN));
jian('停止发送真的结束这一轮（在收缩重试的回调里 return 会被壳吞成"上下文太小"，具体原因全丢）',
  /return \{ tingZhi: \{/.test(MAIN)
  && MAIN.indexOf('const tingZhi = (chongshi.result as') > 0
  && MAIN.indexOf('const tingZhi = (chongshi.result as') < MAIN.indexOf('if (chongshi.gaveUp || !chongshi.result?.loop)'));
jian('停止的原因里带得上"已经压到什么程度"（还差多少、各段多大、能怎么办）',
  /窗口可用 \$\{keZhuangShuRuChuangKou\} token，固定开销 \$\{chengBen\.guDing\}/.test(MAIN)
  && /把上下文预算滑杆调大、减少图片张数、换一个窗口更大的模型/.test(MAIN));

// ── ⑪ 宿主前置召回（记忆 #8：文档说宿主主动召回，代码里却只有模型自己调 recall）──
jian('宿主真的在装配阶段召回（不是等模型调工具；模型不知道视图里少了什么）',
  /memory\.recallScoped\(chaXun, 3, \{ sessionId: String\(sessionId \|\| ''\) \}, \{ deadline: jieZhi \}\)/.test(MAIN)
  && /【前置召回 · 宿主按本轮内容主动取回的历史线索/.test(MAIN));
jian('召回段在计价**之前**进 shenFenTou（视图拿的是扣掉它之后的余额，不是额外加）',
  MAIN.indexOf('const cai = zheng.length > fenE') < MAIN.indexOf('const jiBen = (): ReturnType<typeof jiageQingQiu>'));
jian('召回份额有界：条数 ≤3、每条 ≤200 字、整段按预算比例并夹在 600–2400 字',
  /ka\.slice\(0, 3\)/.test(MAIN) && /\.slice\(0, 200\)\}`;/.test(MAIN)
  && /Math\.min\(2400, Math\.max\(600, Math\.round\(\(Number\(suanBen\.chars\) \|\| 0\) \* 0\.06\)/.test(MAIN));
jian('召回不许拖住这一轮（超时/未就绪/报错都按"没召回"，并留下原因）',
  /setTimeout\(\(\) => res\(null\), 800\)/.test(MAIN)
  && /memory && memory\.isReady && chaXun\.length >= 4/.test(MAIN)
  && /chat\.pre-recall-skipped/.test(MAIN) && /chat\.pre-recall-failed/.test(MAIN));
jian('用户能关掉（preRecall 开关，默认开），关掉也要留痕',
  /as \{ preRecall\?: boolean \} \| undefined\)\?\.preRecall !== false/.test(MAIN) && /yinWei: !kaiGuan \? '开关关闭'/.test(MAIN));
jian('工具面收窄时必须当场告诉模型（说了有什么就得真有什么）',
  /【本轮工具面收窄】这一轮只暴露 \$\{gongJuZuiDuoShu\} 条工具/.test(MAIN));

// ── ⑫ 归档摘要注入（用户 #10：摘要自身不膨胀 + 永远知道何时/如何/从哪里/怎么取回）──
const ge = (n, zi = 600) => Array.from({ length: n }, (_, i) => ({ ts: 1000 + i, summary: `## 要点\n- 第${i}件事的结论\n- 重复的一句话` + (zi > 0 ? '' : '') }));
jian('注入总量与归档条数**无关**（100 条归档也只吃这份份额 ⇒ 摘要不会滚大）',
  (() => {
    const a = ZHAI.jiYaoZhuRu({ quanBu: ge(8), fenE: 2400 });
    const b = ZHAI.jiYaoZhuRu({ quanBu: ge(100), fenE: 2400 });
    return a.duan.length <= 2400 && b.duan.length <= 2400 && b.weiFuGai > 0;
  })(), `100 条时未覆盖 ${ZHAI.jiYaoZhuRu({ quanBu: ge(100), fenE: 2400 }).weiFuGai} 条`);
jian('装不下的条数必须**写在正文里**（模型以为自己看到了全部 = 第 17 轮压测里"中段事实不可见"的老病）',
  (() => {
    const r = ZHAI.jiYaoZhuRu({ quanBu: ge(40), fenE: 1800 });
    return r.weiFuGai > 0 && /没有\*\*被放进这段上下文/.test(r.duan) && /recall\("关键词"\)/.test(r.duan);
  })());
jian('重复的小节头被去掉（多条并列时"## 要点"出现 N 次只是浪费份额）',
  (() => {
    const r = ZHAI.jiYaoZhuRu({ quanBu: Array.from({ length: 20 }, (_, i) => ({ ts: i, summary: `## 要点\n- 同一句话\n- 第${i}件独有` })), fenE: 3000 });
    return (r.duan.match(/同一句话/g) || []).length === 1 && !/^## /m.test(r.duan);
  })());
jian('份额随本轮预算缩放并夹在上下限之间（0 预算 = 不给，常数 3000 的日子结束）',
  ZHAI.jiYaoFenE(0) === 0 && ZHAI.jiYaoFenE(10000) === 1200 && ZHAI.jiYaoFenE(200000) === 8000);
jian('脏输入不抛：空数组 / 缺 summary 的条目被过滤掉',
  (() => {
    const a = ZHAI.jiYaoZhuRu({ quanBu: [], fenE: 2000 });
    const b = ZHAI.jiYaoZhuRu({ quanBu: [{ ts: 1, summary: '' }, { ts: 2, summary: '   ' }, { ts: 3, summary: '有内容的一条' }], fenE: 2000 });
    return a.duan === '' && a.weiFuGai === 0 && b.fuGai.tiaoShu >= 1;
  })());
jian('宿主接线：注入点改走合并器（旧的 `末 8 条 → 截 3000 字` 必须消失，不留第二条路）',
  /jiYaoZhuRu\(\{\s*\n?\s*quanBu: gui\.map/.test(MAIN) && /jiYaoFenE\(Number\(suanBen\?\.chars\)/.test(MAIN)
  && !/gui\.slice\(-8\)\.map\(\(x\) => String\(x\.summary/.test(MAIN));
jian('宿主接线：审计说得清"注入了几条 / 总共几条 / 几条没覆盖 / 用了多少份额"',
  /weiFuGai: zhu\.weiFuGai, chars: zhu\.zi, fenE/.test(MAIN) && /quanBu: gui\.length/.test(MAIN));
jian('宿主接线：覆盖说明带序号范围，且占位符替换在**翻译结果**上（不许把 {a} 漏给用户）',
  /tMain\('llm\.archivedCoverage'[^)]*\)\s*\n?\s*\.replace\('\{a\}'/.test(MAIN)
  && !/tMain\('llm\.archivedCoverage', '[^']*'\s*\n?\s*\.replace\(\{a\}/.test(MAIN));
/**
 * #10 的后半「永远可自行回忆」：没进上下文的那几次归档，指针必须**真的可执行**。
 * 真缺陷：摘要此前只落 `archives.jsonl`（界面读得到、模型读不到），正文却写着"用 recall 取" ⇒
 * 与 #7 的假 recordId 同一类病（指针指了一条走不通的路）。现在摘要也回写记忆库（`kind:'archive'`、
 * id = 归档自己的真 id），指针直接给 `retrieve(recordId="arc-…")`。
 */
jian('没进上下文的归档给出**真 recordId** 指针（不是只说一句"用 recall 取"）',
  (() => {
    const r = ZHAI.jiYaoZhuRu({ quanBu: ge(40).map((x, i) => ({ ...x, id: 'arc-' + i })), fenE: 1800 });
    return r.weiFuGai > 0 && /retrieve\(recordId="arc-\d+"/.test(r.duan) && /recall\("关键词"\)/.test(r.duan);
  })(), ZHAI.jiYaoZhuRu({ quanBu: ge(40).map((x, i) => ({ ...x, id: 'arc-' + i })), fenE: 1800 }).duan.slice(-160));
jian('〔能变红〕拿不到归档 id 时**不许编一个**（宁可只留 recall 这条路，也不给假指针）',
  (() => {
    const r = ZHAI.jiYaoZhuRu({ quanBu: ge(40), fenE: 1800 });
    return r.weiFuGai > 0 && !/retrieve\(recordId=/.test(r.duan) && /recall\("关键词"\)/.test(r.duan);
  })());
jian('宿主接线：归档摘要**回写记忆库**（kind=archive、写入者 memory-service、id 用归档真 id，且**等写完再记成功**）',
  /kind: 'archive'/.test(MAIN) && /entityType: 'archive'/.test(MAIN)
  && /id: String\(entry\.id\)/.test(MAIN)
  /** 必须 await：append 走 IPC 返回 Promise，不等它 ⇒ 失败逃出 try 成未处理 rejection，而"成功"审计已经先写了 */
  && /const hui = await memory\.append\(\{/.test(MAIN) && /\}, 'memory-service'\)/.test(MAIN)
  && /if \(hui && hui\.ok === false\) throw new Error/.test(MAIN)
  && MAIN.indexOf("audit?.log('guiDang.huiXie'") > MAIN.indexOf('const hui = await memory.append({')
  && /guiDang\.huiXie-fail'/.test(MAIN));
jian('回写的摘要**不会被当成聊天消息重放**（重启重建只认 kind === message）',
  /if \(String\(r\['kind'\] \?\? ''\) !== 'message'\) continue;/.test(MAIN));
jian('注入时把归档 id 一起交给合并器（不给 id 就只能写"用 recall 取"这句空指针）',
  /id: String\(\(x as \{ id\?: string \}\)\.id \|\| ''\)/.test(MAIN));

// ── ⑬ 配置→预算的算术只有一份（压力档以前"逐行复刻"这段，产品改了它不知道 ⇒ 测的是假数）──
const PS = Y.peizhiYuSuan;
jian('`peizhiYuSuan` 是纯函数且把四步都算完（百分比→窗口→输出留位→2% 安全垫→字符）',
  (() => {
    const r = PS({ percent: 60, windowTokens: 32768, shuChuYueDing: 0, charBeiJian: 1.6 });
    return r.tokens === 19661 && r.percent === 60 && r.maxTokens === 32768
      && r.anQuanChuangKou === 32113 && r.yuLiangTok === 655 && r.chars === Math.round(19661 * 1.6);
  })(), JSON.stringify(PS({ percent: 60, windowTokens: 32768, shuChuYueDing: 0, charBeiJian: 1.6 })));
jian('输出留位排在安全垫**之前**（先扣官方写过的输出上限，再留 2%）',
  (() => {
    const a = PS({ percent: 100, windowTokens: 100000, shuChuYueDing: 20000, charBeiJian: 1.6 });
    return a.tokens === 80000 && a.anQuanChuangKou === 98000;
  })());
jian('滑杆低于下限时抬到下限（2048 token 的视图下限不许被"设得小"绕过）',
  (() => {
    const d = PS({ percent: 1, windowTokens: 32768, charBeiJian: 1.6 });
    const xiao = PS({ percent: 1, windowTokens: 4096, charBeiJian: 1.6 });
    /** 滑杆自身夹在 10..100；窗口太小时光凭 10% 连 2048 token 都不够 ⇒ 再被窗口推出的下限抬起来 */
    return d.percent === 10 && d.tokens >= 2048 && xiao.percent === 50 && xiao.minPercent === 50 && xiao.tokens === 2048;
  })());
jian('预算永远不贴窗口边缘（贴边 = 每次都赌误差方向）',
  (() => {
    const r = PS({ percent: 100, windowTokens: 8192, charBeiJian: 1.6 });
    return r.tokens === r.anQuanChuangKou && r.tokens < r.maxTokens;
  })());
jian('没有真实窗口时用兜底窗口，而不是把预算算成 0',
  PS({ percent: 60, windowTokens: 0, fallbackTokens: 200000, charBeiJian: 1.6 }).maxTokens === 200000
  && PS({ percent: 60, windowTokens: 0, charBeiJian: 1.6 }).maxTokens === 128000);
jian('有形状样本时按样本折算（中文与代码折算出的字符数必须不同 —— 这才是"设多少发多少"的前提）',
  (() => {
    const zhong = PS({ percent: 60, windowTokens: 32768, yangBen: '这是一个纯中文的会话样本，用来折算字符数。'.repeat(20), charBeiJian: 1.6 });
    const dai = PS({ percent: 60, windowTokens: 32768, yangBen: 'function foo(a,b){return a+b;} // js sample'.repeat(20), charBeiJian: 1.6 });
    return zhong.tokens === dai.tokens && Math.abs(zhong.chars - dai.chars) > 2000;
  })(), '中文/代码同 token 数下不同字符数');
jian('主进程**不再自己算这套**（只剩取事实 + 调用；算术留在一处）',
  /const pei = peizhiYuSuan\(\{[\s\S]{0,300}windowTokens: maxTokens/.test(MAIN)
  && !/const CHUANG_KOU_YU_LIANG = Math\.max\(128, Math\.floor\(maxTokens \* 0\.02\)\)/.test(MAIN)
  && !/const chars = yangBen\.length >= 8\n\s*\? Math\.max\(200, tokenDaoZiFu/.test(MAIN));
jian('万能 1.6 只有一份，并且只作为"取不到样本"的兜底（不许再当主口径）',
  /const CHARS_PER_TOKEN_EST = WU_YANG_BEN_BEI_JIAN;/.test(MAIN) && Y.WU_YANG_BEN_BEI_JIAN === 1.6
  && /ben\.length >= 8/.test(du('packages/app-shell/src/yuSuan-jiage.ts')));

// ── ⑭ 产物审计：说了"已写入 X"就必须真有其文件（压力档 A 第一轮抓到的口头执行）──
const CW = await import(pathToFileURL(path.join(GEN, 'packages/app-shell/dist/chanwu-shenji.js')).href);
jian('声称里有完成时态 + 带扩展名的文件名才算"产物声称"（"我打算写 x.html"不算）',
  (() => {
    const a = CW.shengChengDeWenJian('我打算把 youxi.html 写一下');
    const b = CW.shengChengDeWenJian('文件已写入：/workspace/youxi.html');
    return a.length === 0 && b.length === 1 && b[0].endsWith('youxi.html');
  })(), JSON.stringify(CW.shengChengDeWenJian('文件已写入：/workspace/youxi.html')));
jian('版本号/小数点不许被当成文件名（扩展名白名单），Windows 绝对路径要整条截到',
  (() => {
    const yi = CW.shengChengDeWenJian('已经保存了 report.docx（版本从 v3.5 升上来）');
    const lu = CW.shengChengDeWenJian('已写入 C:\\Users\\p\\Desktop\\r16.txt');
    return yi.length === 1 && yi[0].endsWith('report.docx') && !/\d\.\d/.test(yi[0])
      && lu.length === 1 && /^C:/i.test(lu[0].trim()) && lu[0].includes('Desktop');
  })(), JSON.stringify([CW.shengChengDeWenJian('已经保存了 report.docx（版本从 v3.5 升上来）'), CW.shengChengDeWenJian('已写入 C:\\Users\\p\\Desktop\\r16.txt')]));
jian('绝对路径存在 ⇒ 满足；工作区按同名找到 ⇒ 也满足',
  (() => {
    const r1 = CW.chanWuShenJi({ huiFu: '已写入 /tmp/a.html', gongJuTiaoYongShu: 0, cunZai: (x) => x === '/tmp/a.html', zaiGongZuoQu: () => '' });
    const r2 = CW.chanWuShenJi({ huiFu: '已写入 a.html', gongJuTiaoYongShu: 0, cunZai: () => false, zaiGongZuoQu: (m) => m === 'a.html' ? '/ws/a.html' : '' });
    return r1.kouTouZhiXing === false && r1.queShao.length === 0 && r2.kouTouZhiXing === false && r2.zhaoDao.length === 1;
  })());
jian('负向对照：说了没做 ⇒ 判口头执行；**但本轮真调过工具就不在这里判死**（交给工具自己的读回核对）',
  (() => {
    const que = CW.chanWuShenJi({ huiFu: '文件已写入：/workspace/youxi.html ✅', gongJuTiaoYongShu: 0, cunZai: () => false, zaiGongZuoQu: () => '' });
    const diao = CW.chanWuShenJi({ huiFu: '文件已写入：/workspace/youxi.html ✅', gongJuTiaoYongShu: 3, cunZai: () => false, zaiGongZuoQu: () => '' });
    return que.kouTouZhiXing === true && que.queShao.length === 1 && diao.kouTouZhiXing === false;
  })());
jian('宿主接线：主进程按"东西在不在"判（不再只看工具计数），并把缺哪个点名给用户',
  /shenJi = chanWuShenJi\(\{/.test(MAIN)
  && /if \(pan\.kouTou \|\| \(shenJi && shenJi\.kouTouZhiXing\)\)/.test(MAIN)
  && /chat\.artifact-audit/.test(MAIN)
  && /chanWuKouTouTiShi\(shenJi\.queShao\)/.test(MAIN));

/**
 * ── ⑮ 设置持久化的字段必须在接口里声明（第 44 轮自查缺陷 ⑥）──
 * 真缺陷：15 个字段一直在往 `settings.json` 里写，`YingYongPeizhi` 里一个都没声明，
 * 全靠 `save({...} as never)` 把编译器绕过去 ⇒ 改字段名/删字段时**没有任何一处会报错**，
 * "设置里到底存了什么"只能全文搜索。这条门禁做**结构对账**（不是字节锚）：
 * 把主进程里所有 `settingsStore.save({ ... } as never)` 的顶层键抽出来，逐个查接口声明。
 */
{
  const peiZhi = du('packages/app-shell/src/settings-store.ts');
  const kai = peiZhi.indexOf('export interface YingYongPeizhi {');
  const guan = peiZhi.indexOf('\n}\n', kai);
  const jieKou = kai >= 0 && guan > kai ? peiZhi.slice(kai, guan) : '';
  const shengMing = new Set([...jieKou.matchAll(/^ {2}([A-Za-z_][\w]*)\??\s*:/gm)].map((m) => m[1]));
  /**
   * 抽 `settingsStore.save({ … })` 的**顶层键**。
   * ⚠️ 不能用 `save\(\{([\s\S]*?)\}\s*as never\)` 这种懒匹配：它会从这一处 `save({` 一路吃到
   * **后面另一个调用**的 `} as never)`（真机跑出来把 `congYuSheChuangJian(…, {…} as never)` 的
   * presetId/baseURL 也算成了设置字段）。这里按括号配对扫，并跳过字符串与注释。
   */
  const saoma = (wen) => {
    const chu = [];
    const re = /settingsStore\??\.save\(\s*\{/g;
    let m;
    while ((m = re.exec(wen))) {
      let i = re.lastIndex;
      let shen = 1;
      const qi = i;
      while (i < wen.length && shen > 0) {
        const ch = wen[i];
        if (ch === '"' || ch === "'" || ch === '`') {
          const yin = ch; i++;
          while (i < wen.length && wen[i] !== yin) { if (wen[i] === '\\') i++; i++; }
        } else if (ch === '/' && wen[i + 1] === '/') { while (i < wen.length && wen[i] !== '\n') i++; }
        else if (ch === '/' && wen[i + 1] === '*') { i += 2; while (i < wen.length && !(wen[i] === '*' && wen[i + 1] === '/')) i++; i++; }
        else if (ch === '{' || ch === '[' || ch === '(') shen++;
        else if (ch === '}' || ch === ']' || ch === ')') shen--;
        i++;
      }
      chu.push(wen.slice(qi, i - 1));
      re.lastIndex = i;
    }
    return chu;
  };
  const cengJian = new Set();
  for (const can of saoma(MAIN)) {
    let shen = 0;
    for (let i = 0; i < can.length; i++) {
      const ch = can[i];
      if (ch === '"' || ch === "'" || ch === '`') {
        const yin = ch; i++;
        while (i < can.length && can[i] !== yin) { if (can[i] === '\\') i++; i++; }
        continue;
      }
      if (ch === '{' || ch === '[' || ch === '(') { shen++; continue; }
      if (ch === '}' || ch === ']' || ch === ')') { shen--; continue; }
      if (shen !== 0) continue;
      const mm = /^([A-Za-z_][\w]*)\s*:/.exec(can.slice(i));
      /** 只认"逗号/开头之后"的键，避免把 `a ? b : c` 里的 `b :` 当成键 */
      if (mm && (i === 0 || /[,{\s]/.test(can[i - 1]))) { cengJian.add(mm[1]); i += mm[0].length - 1; }
    }
  }
  const que = [...cengJian].filter((k) => !shengMing.has(k));
  jian('接口确实抽到了（抽取口径坏了这条就等于没测）', shengMing.size > 40 && jieKou.includes('contextBudgetPercent'), `声明 ${shengMing.size} 个字段`);
  jian('写入侧抽的是**顶层键**（把嵌套对象或别的调用的键算进来 = 仪器自己在编）',
    cengJian.size >= 10 && !cengJian.has('presetId') && !cengJian.has('baseURL') && !cengJian.has('fenLeiChain'),
    `抽到 ${cengJian.size} 个：${[...cengJian].sort().join(',')}`);
  jian('写进 settings.json 的每个字段都在 `YingYongPeizhi` 里声明过（`as never` 绕过编译器 ⇒ 只能靠对账）',
    que.length === 0, `缺声明：${que.join(',') || '（无）'}`);
  jian('〔能变红〕伪造一个未声明字段，对账必须报出来（否则这条门禁永远绿）',
    [...cengJian, 'jiaDeZiDuanMeiShengMing'].filter((k) => !shengMing.has(k)).includes('jiaDeZiDuanMeiShengMing'));
  jian('〔能变红〕接口里删掉一个正在写的字段也必须报出来',
    (() => {
      const shao = new Set([...shengMing].filter((k) => k !== 'archiveCursors'));
      return [...cengJian].filter((k) => !shao.has(k)).includes('archiveCursors') || !cengJian.has('archiveCursors');
    })());
}

/**
 * ── ⑯ 云端风控拒绝不是回答（第 45 轮真机 · verify-round18 抓到的）──
 * 现象：MiMo 网关把 `The request was rejected because it was considered high risk` 当**助手正文**回过来，
 * 产品照单全收 ⇒ 写进历史、ok:true、`gongJuDiaoYongJi:0`，用户只看到一句莫名其妙的英文。
 * 口径：这类网关样板话按"这一档模型这次没做成"处理 ⇒ 原地重试一次 → 换下一只 → 全被拦才如实报（带原文）。
 */
{
  const FK = await import(pathToFileURL(path.join(GEN, 'packages/app-shell/dist/fengKong-ju-jue.js')).href);
  const zhen = 'The request was rejected because it was considered high risk';
  jian('网关风控样板话被判成"不是回答"（英文 high risk / content policy / 中文风控拦截都算）',
    FK.panFengKongJuJue({ huiFu: zhen }) === 'high-risk'
    && FK.panFengKongJuJue({ huiFu: 'This prompt was blocked by the content policy.' }) === 'content-policy'
    && FK.panFengKongJuJue({ huiFu: '请求被风控拦截，请重试。' }) === '风控拦截');
  jian('〔能变红〕模型**正常拒绝用户**是合法回答，不许当成网关故障（否则会无限换模型）',
    FK.panFengKongJuJue({ huiFu: '我不能帮你写这段代码，因为它会绕过登录校验。可以改成……' }) === ''
    && FK.panFengKongJuJue({ huiFu: '好的，已经写完了。' }) === '');
  jian('〔能变红〕本轮真的调过工具 ⇒ 那句短话是过程说明，不判风控',
    FK.panFengKongJuJue({ huiFu: zhen, benLunGongJuShu: 2 }) === '');
  jian('长回答里偶然提到 policy 不算（只有短样板话才算，避免误杀真回答）',
    FK.panFengKongJuJue({ huiFu: ('这一段的实现说明。'.repeat(60)) + 'content policy' }) === '');
  jian('报给用户的话带**供应商原文**与已换过的模型（不许只说"失败了"）',
    (() => {
      const t = FK.fengKongJuJueTiShi({ yuanWen: zhen, ming: 'high-risk', yiShiBai: ['mimo-v2.5'] });
      return t.includes(zhen.slice(0, 40)) && t.includes('mimo-v2.5') && /重试/.test(t);
    })());
  jian('宿主接线：判定在**写历史之前**、抛出去走同一条降级链，并留两条审计',
    /const fengKongMing = panFengKongJuJue\(\{ huiFu: reply, benLunGongJuShu: Number\(loop\.gongJuDiaoYongJi \|\| 0\) \}\);/.test(MAIN)
    && /chat\.provider-moderation'/.test(MAIN) && /chat\.moderation-retry'/.test(MAIN)
    && /fengKong: true/.test(MAIN)
    && MAIN.indexOf('panFengKongJuJue(') < MAIN.indexOf("kind: 'message', role: 'assistant', ti: reply"));
  jian('风控**先原地重试一次同一只模型**（单模型链换无可换 ⇒ 直接换等于白等一轮），仍被拦才计入失败',
    /\(e as \{ fengKong\?: boolean \}\)\?\.fengKong && !fengKongChongShi\.has\(modelId\)/.test(MAIN)
    && MAIN.indexOf('fengKongChongShi.add(modelId)') < MAIN.indexOf('yiShiBai.push(modelId);', MAIN.indexOf('fengKongChongShi.add(modelId)')));
  /** 两条路径同一个口径（ADR000/MEMORY-SYSTEM 的定稿要点）：群/值班路径也要判，不许只修单聊 */
  jian('群/值班路径**同一套判据**（原地重试一次，仍被拦就如实说明，不把网关那句英文当回答发进群）',
    quChu(MAIN, /panFengKongJuJue\(/g) >= 3
    && /lu: 'duty', yuanWen: yuanWen\.slice\(0, 200\)/.test(MAIN)
    && /llmReply = zaiShi \|\| fengKongJuJueTiShi\(\{ yuanWen, ming: fkMing, yiShiBai: \[zhibanMoxing\], t: tMain \}\)/.test(MAIN));
  jian('〔能变红〕供应商原文里的 `$&` / `$1` 原样保留（字符串式 replace 会把它们当替换模式吃掉）',
    (() => {
      const t = FK.fengKongJuJueTiShi({ yuanWen: 'rejected $& high risk $1', ming: 'high-risk' });
      return t.includes('rejected $& high risk $1');
    })());
  jian('报给用户的话走**翻译**（宿主传 tMain），占位符在翻译结果上替换、不漏 {xxx}',
    (() => {
      const yi = { 'chat.moderation.blocked': 'BLOCKED({ming})', 'chat.moderation.tried': ' TRIED[{list}]', 'chat.moderation.raw': ' RAW<{raw}>', 'chat.moderation.tip': ' TIP' };
      const t = FK.fengKongJuJueTiShi({ yuanWen: 'x', ming: 'hr', yiShiBai: ['m1'], t: (k, d) => yi[k] || d });
      return t === 'BLOCKED(hr) TRIED[m1] RAW<x> TIP' && !/\{\w+\}/.test(t)
        && /fengKongJuJueTiShi\(\{ yuanWen: String\(reply \|\| ''\), ming: fengKongMing, yiShiBai: \[\.\.\.yiShiBai, modelId\], t: tMain \}\)/.test(MAIN);
    })());
  jian('新文案在 **10 个语言包**里都有、且占位符与中文一致（软门禁规则也按 i18n 键出）',
    (() => {
      const DIR = path.join(GEN, 'packages/app-shell/src/i18n');
      const jian2 = ['chat.moderation.blocked', 'chat.moderation.tried', 'chat.moderation.raw', 'chat.moderation.tip', 'chat.softGate.head',
        'softGate.openaiAuth', 'softGate.anthropicAuth', 'softGate.ollamaLocal', 'softGate.mimoSiteKey', 'softGate.deepgramAsr', 'softGate.assemblyaiAsr'];
      const zw = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
      const bao = fs.readdirSync(DIR).filter((x) => x.endsWith('.json'));
      const zh = JSON.parse(fs.readFileSync(path.join(DIR, 'zh-CN.json'), 'utf8'));
      return bao.length === 10 && bao.every((f) => {
        const j = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
        return jian2.every((k) => typeof j[k] === 'string' && j[k].length > 0 && zw(j[k]) === zw(zh[k]));
      }) && /x\.i18n \? tMain\(x\.i18n, x\.message\) : x\.message/.test(MAIN)
        && /tMain\('chat\.softGate\.head'/.test(MAIN);
    })());
}

const hong = jie.filter((x) => !x.ok).length;
for (const x of jie) console.log(`${x.ok ? 'PASS' : 'FAIL'} ${x.ming}${x.xiang ? ` —— ${x.xiang}` : ''}`);
console.log(`\n==== verify-r44-yuSuan：${jie.length - hong} ok / ${hong} FAIL ====`);
process.exit(hong ? 1 : 0);
