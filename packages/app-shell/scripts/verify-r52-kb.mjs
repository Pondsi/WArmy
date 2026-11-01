/**
 * verify-r52-kb.mjs（fast 档）—— 第 52 轮项 6/7 的判据：
 *   ① 知识库三层的**内容归层**真值表（私密 / 内部 / 会话）；
 *   ② 内部 → 会话的**脱敏概要**：能力白名单 + 确定性检查器 + 哨兵（canary）；
 *   ③ 归档后的**整理**：重复、前后矛盾、超长的处理真值表；
 *   ④ 主进程接线（写入口按内容升层、归档后派生概要 + 整理、术的总量闸）。
 * ①②③ 都跑真代码（dist 编译产物），不钉字节锚点。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const D = (f) => pathToFileURL(path.join(ROOT, 'packages/app-shell/dist', f)).href;
/** 变异体路径也必须转成 file:// URL —— 裸的 Windows 路径不是合法的 ESM 说明符 */
const U = (p, f) => (p ? pathToFileURL(p).href : D(f));
const FM = await import(U(process.env.V52_KB_FEN, 'zhi-shi-fen-ceng.js'));
const ZL = await import(U(process.env.V52_KB_ZL, 'zhi-shi-zheng-li.js'));
const MAIN = fs.readFileSync(process.env.V52_KB_MAIN || path.join(ROOT, 'packages/app-shell/src/electron-main.ts'), 'utf8');

let okN = 0, failN = 0;
const jian = (l, p, d) => { if (p) { okN++; console.log('  ok  ' + l); } else { failN++; console.log('  FAIL ' + l + (d ? ' ← ' + String(d).slice(0, 150) : '')); } };

// ── ① 内容归层真值表 ─────────────────────────────────────────────
const CENG = [
  ['我确诊了抑郁症，最近在吃药', 'private'],
  ['张同事不靠谱，上次答应的事拖了两周', 'private'],
  ['这个项目报价 3 万，10 月 15 日交付', 'internal'],
  ['用 electron 打包时 nsis 要在装完再删临时目录', 'internal'],
  ['周末做了个贪吃蛇小游戏练手', 'internal'],
  ['以后都用中文回我', 'session'],
  ['我们可以做网页小游戏的开发与验收', 'session'],
  ['验收时要一遍全绿就停下汇报', 'session'],
];
for (const [wen, yao] of CENG) jian('归层 ' + yao + '：' + wen.slice(0, 20), FM.panDingCeng(wen) === yao, '实际=' + FM.panDingCeng(wen));
jian('对人负面评价绝不落会话库（这是"可公开"那一层）', FM.panDingCeng('他觉得那个供应商很讨厌') === 'private');
jian('业务与个人混合时按更严的走（健康 + 项目 ⇒ 私密）', FM.panDingCeng('这个项目我做到一半查出甲状腺结节') === 'private');

// ── 1b. 项 6（第 53 轮）：钱与账的归属细分 ────────────────────────────
{
  const CAI = [
    ['我的信用卡逾期上了征信，还欠五万', 'private'],
    ['我的存款是三十万，银行卡号是 6222 开头', 'private'],
    ['我买房负债两百万，每月还房贷', 'private'],
    ['公司这个项目报价八万，月底结算走公账', 'internal'],
    ['员工工资表本月共十二万，走公司账户发放', 'internal'],
    ['游戏账号充值了 648 买皮肤，属娱乐开销', 'internal'],
    ['工作室这个项目被人告了，正在诉讼阶段', 'internal'],
    ['客户合同尾款三万，发票已开', 'internal'],
    ['我被法院强制执行了，案底也留下了', 'private'],
    ['这个项目让我确诊了抑郁症，一直在吃药', 'private'],
  ];
  for (const [wen, yao] of CAI) jian('财务归属 ' + yao + '：' + wen.slice(0, 18), FM.panDingCeng(wen) === yao, '实际=' + FM.panDingCeng(wen));
  jian('业务标志只让"钱与账"这一类让渡：健康/性向/家庭等绝不因带项目二字就降级',
    FM.panDingCeng('这个项目上线后我离婚了') === 'private' && FM.panDingCeng('合同签了，客户是某公司') === 'internal');
}

// ── ② 脱敏概要：只能挑白名单，不能改写原文 ────────────────────────
{
  const nei = '客户甲的项目报价 3 万，2026 年 10 月交付了一个网页小游戏，用的是 canvas 循环；联系人微信 abc@example.com';
  /** 第 53 轮项 7：证据改成**一份一份**（抑制阈值 k=2 才数得准），这里给两份都支持"游戏"这一类 */
  const r = FM.paiShengDuiWaiGaiLao([nei, '另一单：给乙方做了一个 2048 网页游戏，验收跑绿']);
  jian('内部业务内容能派生出概要（不是整条抑制）', r.ok && r.gai.length > 0, JSON.stringify(r.why));
  jian('概要里没有任何数字/日期/金额/邮箱', !/[0-9０-９]/.test(r.gai) && !/example|@|20\d\d|万|元/.test(r.gai), r.gai);
  jian('概要不出现"做过/交付过/客户"这类存在性说法', !/做过|交付过|签约|客户|报价/.test(r.gai), r.gai);
  jian('概要每个短语都在能力白名单里', (() => {
    const ti = r.gai.replace(/^我们可以做这些类型的事：/, '').replace(/。（这是能力类别清单[^）]*）$/, '');
    return ti.split('、').every((x) => FM.NENG_LI_BIAO.some((n) => n.hua === x.trim()));
  })());
  const kong = FM.paiShengDuiWaiGaiLao(['今天天气不错', '今天也不错']);
  jian('白名单挑不出条目 ⇒ 整条抑制（不写没根据的能力）', !kong.ok && kong.gai === '' && /抑制/.test(kong.why.join('')), JSON.stringify(kong));
  const chuan = FM.jianChaGaiLao('我们可以做这些类型的事：给客户甲做过报价 3 万的活。', '给客户甲做过报价 3 万的活');
  jian('手写"改写式概要"必被拦（白名单外 + 数字 + 存在性说法）', chuan.ok === false && chuan.why.length >= 2, chuan.why.join(' | '));
  const canary = FM.jianChaGaiLao('我们可以做这些类型的事：' + FM.NENG_LI_BIAO[0].hua + '（CANARY_7QZ4X）', '原文里有 CANARY_7QZ4X');
  jian('哨兵：注入的假值一旦出现在概要里就判泄露', canary.ok === false && /哨兵/.test(canary.why.join('')), canary.why.join(' | '));
  jian('干净概要过检（哨兵没出现时不误伤）', FM.jianChaGaiLao('我们可以做这些类型的事：' + FM.NENG_LI_BIAO[0].hua + '。（这是能力类别清单，不含具体项目、时间、对象与做法。）', '随便什么原文').ok === true);
  /**
   * **每条判据各有一个"只有它能拦"的样例**（负向验证要求：删掉任何一条都必须有测试变红，
   * 否则那条判据只是摆设）。三份样例都刻意把"违禁内容"塞进固定句式的括号里，
   * 这样"白名单外的残留"这一关看不出来，只有对应那条禁现判据能抓。
   */
  const HUA0 = FM.NENG_LI_BIAO[0].hua;
  jian('判据一（白名单）独力拦下：括号外多了一句白名单外的能力',
    FM.jianChaGaiLao('我们可以做这些类型的事：' + HUA0 + '、代写学术论文。（这是能力类别清单，不含具体项目、时间、对象与做法。）', '原文').ok === false);
  jian('判据二（数字/日期）独力拦下：说明句里被塞进年份',
    FM.jianChaGaiLao('我们可以做这些类型的事：' + HUA0 + '。（这是能力类别清单，起始于 2026 年，不含具体项目、时间、对象与做法。）', '原文').ok === false);
  jian('判据三（存在性说法）独力拦下：说明句里写"我们做过这些"',
    FM.jianChaGaiLao('我们可以做这些类型的事：' + HUA0 + '。（这是能力类别清单，我们做过这些，不含具体项目、时间、对象与做法。）', '原文').ok === false);
  jian('概要长度封顶（不失控吃预算）', FM.shengChengGaiLao(['游戏 文档 语音 门禁 牛马 微信 统计 electron 批量 抓取 定时 技能'], 99, 1).length <= 240);
}

// ── ③ 归档后整理：重复 / 矛盾 / 超长 ─────────────────────────────
{
  const ji = ZL.guiHuaZhengLi([
    { id: 'a', biaoTi: '会话归档：登录窗口', result: '窗口记住上次位置', ts: 1 },
    { id: 'b', biaoTi: '会话归档：登录窗口 ', result: '窗口记住上次位置。', ts: 2 },
    { id: 'c', biaoTi: '会话归档：登录窗口', result: '窗口每次都在中央弹出', ts: 3 },
    { id: 'd', biaoTi: '另一件事', result: 'x'.repeat(900), ts: 1 },
  ]);
  jian('同一件事的重复只留最新一条', ji.shanChu.includes('a') && ji.shanChu.includes('b'), JSON.stringify(ji.shanChu));
  jian('前后矛盾的说法保留新的（c 留、a/b 删）', !ji.shanChu.includes('c'));
  jian('超长结果列入改写（截到 500 字）', ji.gaiXie.some((g) => g.id === 'd' && (g.result || '').length <= ZL.JIE_GUO_MAX));
  jian('统计口径如实（4 条整理后剩 2 条）', ji.yuan === 4 && ji.hou === 2, ji.yuan + '/' + ji.hou);
  const dan = ZL.guiHuaZhengLi([{ id: 'only', biaoTi: '一件事', result: 'ok', ts: 1 }]);
  jian('没有重复时不动任何东西（整理不许误删唯一条目）', dan.shanChu.length === 0 && dan.gaiXie.length === 0);
  const kong = ZL.guiHuaZhengLi([]);
  jian('空库整理安全（不炸、不删）', kong.yuan === 0 && kong.shanChu.length === 0);
}

// ── ④ 主进程接线 ────────────────────────────────────────────────
jian('写入口按内容敏感度**升层**（判成私密的句子不会留在会话库）',
  /const xuYao = neiRong[\s\S]{0,120}panDingCeng\(String\(neiRong\)\)/.test(MAIN)
  && /kb\.layer-raised/.test(MAIN));
jian('knowledge_add 把内容交给层级判据（不是只认模型传来的 layer 参数）',
  /kbWritable\(sessionId, ceng, neiRong\)/.test(MAIN));
jian('拒绝时如实说明"内容比可写层更敏感"，不让模型以为再试一次就行',
  /敏感度\*\*高于本会话能写的层/.test(MAIN));
jian('归档完成后派生脱敏概要并只写会话库',
  /paiShengDuiWaiGaiLao\(\[zhengLi/.test(MAIN) && /knowledge\.session\.addEvent/.test(MAIN)
  && /kb\.tumin-written/.test(MAIN) && /kb\.tumin-suppressed/.test(MAIN));
jian('抑制阈值数得准：证据按条给，且**排除刚写入的那条**（同一件事不能被数两次凑 k）',
  /e\.id !== evId && !e\.shiXiaoTs/.test(MAIN) && /\.\.\.bieDe\], undefined, nengLiBiao\(\)\)/.test(MAIN));
jian('概要不过检查就不写（宁缺勿泄）', /if \(!dm\.ok \|\| !dm\.gai\)/.test(MAIN));
jian('归档后按可写层逐层整理并落审计', /guiHuaZhengLi\(quan\.map/.test(MAIN) && /kb\.tidy/.test(MAIN));
jian('整理只**取代**重复/过时项并截断超长，不整层清空（第 53 轮项 5：取代不删除，旧说法留着可审计）',
  /for \(const id of ji\.shanChu\) \{ if \(kb\.supersedeEvent\(id\)\)/.test(MAIN) && !/kb\.removeEvent\(quan\./.test(MAIN));
jian('术归纳有总量闸（超上限停止追加，用户手写的不动；闸值取自第 53 轮的唯一上限表，不再写死 8000）',
  /function shuZongLiangMax\(\): number \{ return shangXianOf\('术', dangQianYuYan\(\)\); \}/.test(MAIN) && /shu\.over-cap/.test(MAIN) && /yuan\.length > shuZongLiangMax\(\)/.test(MAIN));
jian('归档跳过在途轮次的同时不推进游标（跳过≠丢掉）',
  /if \(r && r\.skipped === 'in-flight'\) guiDangZuiHouXu\.set\(k, shangCi\)/.test(MAIN)
  && /chat\.archive-skipped-inflight/.test(MAIN));
jian('自动与手动归档用同一个整理模型（设置里的归档模型）',
  /opts\?\.moXing \|\| ''\)\.trim\(\)[\s\S]{0,120}archiveModel/.test(MAIN));

console.log(`==== verify-r52-kb: ${okN} ok / ${failN} FAIL ====`);
process.exit(failN ? 1 : 0);
