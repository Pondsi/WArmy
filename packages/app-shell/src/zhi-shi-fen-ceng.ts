/**
 * 知识库分层与「内部 → 会话」**脱敏概要**（第 52 轮项 6）。
 *
 * 三层的定义（用户定稿，这里是唯一口径）：
 *  · `private` 私密库 —— **不可公开**的个人情况、对人对事的评价（敏感事件的评价也落这里）；
 *  · `internal` 内部库 —— 工作/业务相关内容（含敏感业务信息、游戏娱乐等非隐私、非个人特性的内容）；
 *  · `session` 会话库 —— 可对外公开、与业务无关、非敏感、非个人的内容。
 *
 * 新功能：一次归档写完内部库之后，从这批内部内容里**提取一份脱敏概要**放进会话库。
 * 硬口径：概要**只能写"我们能做某类业务"**这个级别，**不得**出现具体业务信息、价格、日期、客户、方法，
 * 也**不得**提示"做过 / 什么时候做过 / 怎么做的"。
 *
 * 为什么不用"让模型改写一遍再打码"：业界 2024–2026 的结论是自由改写**必然漏**——
 * 摘要本身就是泄露面（成员推断 AUC>64%）、风格与残留细节能被反推出年龄/地域/存在性事实，
 * 被抹掉的数字还会被重建。所以这里用**能力白名单 + 确定性检查器**：
 * 概要不是"改写原文"，而是**从允许清单里挑条目**——原文里的价格/日期/客户在概要里根本没有可表达的槽位。
 * 参考：FlowSeal / IFC 的"降密函数在被污染上下文之外"、GraphRAG 的分层社区报告、k-匿名 generalization+suppression。
 *
 * 纯函数模块 ⇒ 门禁可以直接跑真值表与 canary（scripts/verify-r52-tumin.mjs）。
 */
import { minGanLeiMing } from './yinxiang-guolv.js';

export type ZhishiCengMing = 'private' | 'internal' | 'session';

/**
 * 能力白名单：**会话库唯一允许出现的表述**。每条都是一个"能力类别"，不含时间、数字、对象名。
 * 新增条目必须同时能过 `jianChaGaiLao`（不许往里塞带数字/日期的句子）。
 */
export const NENG_LI_BIAO: Array<{ id: string; hua: string; ci: RegExp }> = [
  { id: 'youxi', hua: '网页小游戏的开发与验收', ci: /贪吃蛇|打砖块|2048|小游戏|网页游戏|游戏循环|canvas/i },
  /** 短语里**不许出现顿号**：顿号就是概要的分隔符，带顿号的条目永远过不了检查器（第 53 轮 `verify-r53-tumin` 逐条自检抓出来的） */
  { id: 'wendang', hua: '文档表格与演示文稿自动生成', ci: /make_docx|make_xlsx|make_pptx|Word|PPT|Excel|pdf|文档生成/i },
  { id: 'yuyin', hua: '本地语音识别与语音合成', ci: /sherpa|ASR|TTS|语音识别|语音合成|话筒/i },
  { id: 'duoniu', hua: '多智能体协作与任务编排', ci: /牛马|子代理|subagent|黑板|派单|plan_update|多智能体/i },
  { id: 'qudao', hua: '外部通讯渠道的接入', ci: /微信|飞书|ClawBot|iLink|邮件|社交接入/i },
  { id: 'jianyan', hua: '自动化验收与门禁体系', ci: /门禁|verify-|验收|回归|GATE-MANIFEST|自检脚本/i },
  { id: 'shuju', hua: '数据整理与统计分析', ci: /统计|报表|csv|xlsx 分析|汇总|看板/i },
  { id: 'zhuomian', hua: '桌面应用与安装交付', ci: /electron|安装包|nsis|桌面应用|托盘|窗口/i },
  { id: 'wenjian', hua: '批量文件与目录的读写整理', ci: /write_file|read_file|list_dir|批量|目录整理|重命名/i },
  { id: 'wangye', hua: '网页抓取与结构化研究', ci: /fetch_url|web_search|爬虫|抓取|research/i },
  { id: 'guihua', hua: '定时任务与计划调度', ci: /schedule_task|定时|计划任务|心跳|cron/i },
  { id: 'jieneng', hua: '技能包的安装与复用', ci: /SKILL\.md|技能包|install_skill|frontmatter/i },
];

/** 会话库概要里**永远不许出现**的形态（数字/日期/金额/路径/联系方式/存在性说法/对象专名） */
export const BU_KE_CHU_XIAN: Array<{ lei: string; re: RegExp }> = [
  { lei: '任何数字（含年份、数量、价格档位）', re: /[0-9０-９]/ },
  { lei: '金额与货币', re: /[¥$€￥]|\d+\s*(元|块|万|千|w|k)\b/i },
  { lei: '日期与时间', re: /\d{4}\s*年|\d{1,2}\s*月|\d{1,2}\s*日|周[一二三四五六日]|星期|ISO/ },
  { lei: '路径与网址', re: /[A-Za-z]:[\\/]|https?:|\/\/|\.com|\.cn|\.net/i },
  { lei: '联系方式', re: /@[^\s]+\.[a-z]{2,}|1[3-9]\d{9}/i },
  { lei: '存在性说法（做过/什么时候做的/怎么做的）', re: /做过|完成过|交付过|签约|承接|报价|成交价|合同|于.{0,6}年|某年|上个月|去年|上次那单/ },
  { lei: '对象与专名指向', re: /客户|甲方|某公司|某位|名字叫|名叫|老板叫|他叫|她叫/ },
];

/**
 * 内部/业务内容的判据：**只认"这是工作业务的具体内容"的硬标志**（钱、合同、客户、交付、项目、产品工程）。
 * 刻意不含"验收/测试/代码/任务"这类通用词 —— 否则用户一句"以后验收都跑绿再说"就被塞进内部库，
 * 群聊（只能写会话库）会拒绝一切正常工作话题。**升层过头=可用性问题，判漏=泄露问题**，
 * 这里靠"敏感词命中即升"保证不泄露，靠"窄口径"保证不误伤。
 */
const YE_WU = /报价|价格|成本|结算|发票|合同|招标|中标|订单|营收|工资|客户|甲方|某公司|乙方|业务方|供应商|项目|交付|上线|部署|打包|安装包|游戏|娱乐|充值|账号|产品设计|需求文档/i;
/** 对人对事的评价（这类是"不可公开"的，落私密库） */
const PING_JIA = /不靠谱|不可靠|让人失望|不专业|拖后腿|信不过|讨厌|反感|人品|情商|脾气|偷懒|不负责|不守信/;

/**
 * 这份文本是不是**纯能力清单**：去掉固定句式后，每一段都必须在白名单里。
 * 白名单短语本身就是"可对外的能力类别"（不含项目、时间、对象、做法），
 * 所以单独写一句"我们可以做网页小游戏的开发与验收"也算会话层，不必带整句句式。
 */
export function shiNengLiQingDan(wen: string): boolean {
  let s = String(wen || '').trim();
  if (!s) return false;
  s = s.replace(/。（这是能力类别清单[^）]*）$/, '');
  for (const q of ['我们可以做这些类型的事：', '我们可以做', '我们能做', '可以承接的能力类型：']) {
    if (s.startsWith(q)) { s = s.slice(q.length); break; }
  }
  const YunXu = new Set(NENG_LI_BIAO.map((x) => x.hua));
  const duan = s.split('、').map((x) => x.trim().replace(/[。！!]$/, '')).filter(Boolean);
  return duan.length > 0 && duan.every((d) => YunXu.has(d));
}

/**
 * **财务/法律的归属细分**（第 53 轮项 6 用户口径）：
 * 业务、工作、游戏、娱乐里的钱与账（报价、成本、结算、发票、员工工资、充值、游戏账号…）**属内部库**；
 * **只有个人的钱与账**（我的存款/负债/信用卡/贷款/征信/破产/银行账号…）才进私密库。
 * 判据：命中"财务法律类"敏感词时，若同一句里带**明确的业务主体标志** ⇒ 内部库；否则 ⇒ 私密库。
 * 其余敏感类（健康、性向、宗教政治、家庭身份、生育、身份账户）与"对人对事的评价"**一律私密**，不参与这次让渡。
 */
const YE_WU_ZHU = /项目|业务|公司|客户|甲方|乙方|订单|合同|员工|团队|部门|产品|平台|游戏|娱乐|账号|工作室|供应商|交付|报价|结算|发票|营收|成本|工资表|定价/;
/** 命中即算"财务/法律"这一类敏感（与 `yinxiang-guolv` 的 caiwu-falv 同源口径） */
const CAI_WU_LEI = 'caiwu-falv';

/**
 * 这一段内容该落哪一层（**写入口由它裁决**，模型与用户都不能指定更低的那一层）：
 * 敏感个人情况 / 对人对事的评价 ⇒ private；工作业务 ⇒ internal；其余 ⇒ session。
 * 两个例外：① 能力清单式的公开表述（脱敏概要那种）永远算 session —— 它是**降密之后**的产物；
 * ② 业务/工作/游戏/娱乐的财务信息属 internal，不因"带数字带钱"就被打进私密库（用户口径）。
 */
export function panDingCeng(neiRong: string): ZhishiCengMing {
  const wen = String(neiRong || '');
  if (!wen.trim()) return 'session';
  if (shiNengLiQingDan(wen)) return 'session';
  const lei = minGanLeiMing(wen);
  if (lei && lei !== CAI_WU_LEI) return 'private';
  if (lei === CAI_WU_LEI && !YE_WU_ZHU.test(wen)) return 'private';
  if (PING_JIA.test(wen)) return 'private';
  if (YE_WU.test(wen)) return 'internal';
  return 'session';
}

/** 挑出这份内部内容支撑得起的**能力条目**（只认白名单，不做自由改写） */
export function chouQuNengLi(neiRong: string): string[] {
  const wen = String(neiRong || '');
  return NENG_LI_BIAO.filter((x) => x.ci.test(wen)).map((x) => x.hua);
}

/**
 * **最少佐证条数**（k-匿名里的 k，第 53 轮项 7 按建议加的抑制阈值）。
 * 为什么要有这条：白名单短语本身不含项目信息，但**"能不能凑出这一条"本身就含信息**——
 * 只做过一单网页小游戏就对外说"我们可以做网页小游戏的开发与验收"，在场的人拿会话库 + 一句"上周你们给谁做的？"
 * 就能把这单业务反推出来（调研：存在性泄露 / membership inference，AUC 只靠"有没有这类"就能过 0.5）。
 * 累计 ≥2 条内部事件都支持同一能力 ⇒ 才允许对外说这一类；单条证据一律抑制。
 */
export const TUMIN_ZUI_SHAO_ZHI_CHI = 2;

/** 正则转义（自更新能力的匹配关键词要拼进 RegExp） */
function zhuanYiRe(s: string): string {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * **自更新白名单的准入检查**（第 54 轮项 3）：模型可以提案新的"能力类别"，但每一条都要过这里。
 * 白名单是"可对外的唯一出口"，所以准入门槛比普通文本更严：不许带数字/标点/路径/对象指向/存在性说法，
 * 必须配 ≥1 个能用来判断"哪条内部内容支持它"的匹配关键词。**不靠模型自觉，靠这个函数**。
 */
export function jianChaXinNengLi(hua: string, ci: string[], yiYou: string[] = []): { ok: boolean; why: string[] } {
  const why: string[] = [];
  const s = String(hua || '').trim();
  const YunXu = new Set<string>([...NENG_LI_BIAO.map((x) => x.hua), ...(Array.isArray(yiYou) ? yiYou : [])]);
  if (!s) why.push('短语为空');
  if (s.length > 14) why.push(`短语 ${s.length} 字 > 14（概要总长封顶守不住）`);
  if (/[、，。；：！？,.;:!?]/.test(s)) why.push('短语里不能有标点（顿号是概要的分隔符）');
  if (/[0-9０-９]/.test(s)) why.push('短语里不能有数字');
  if (/[A-Za-z]:[\\/]|https?:|@/.test(s)) why.push('短语里不能有路径/网址/邮箱');
  if (/客户|甲方|乙方|某公司|某位|老板|做过|交付过|签约|报价|合同|我们/.test(s)) why.push('短语里不能有对象指向、存在性说法或主语');
  for (const x of BU_KE_CHU_XIAN) if (x.re.test(s)) why.push('短语命中禁现形态：' + x.lei);
  if (YunXu.has(s)) why.push('已经有一条同样的能力');
  const zi = (Array.isArray(ci) ? ci : []).map((x) => String(x || '').trim()).filter(Boolean);
  if (!zi.length) why.push('至少要给一个匹配关键词（没有它，这条能力永远判断不出"哪条内部内容支持它"）');
  if (zi.length > 6) why.push(`关键词最多 6 个（给了 ${zi.length}）`);
  for (const c of zi) {
    if (c.length < 2 || c.length > 12) why.push(`关键词「${c.slice(0, 10)}」长度要在 2..12`);
    if (/[、，。；：！？,.;:!?]/.test(c)) why.push(`关键词「${c.slice(0, 10)}」不能有标点`);
    if (/客户|甲方|乙方|某公司/.test(c)) why.push(`关键词「${c.slice(0, 10)}」不能是对象名`);
    if (/[0-9０-９]/.test(c)) why.push(`关键词「${c.slice(0, 10)}」不能有数字`);
  }
  return { ok: why.length === 0, why };
}

export type NengLiTiao = { id: string; hua: string; ci: RegExp };

/**
 * 合并「内置 12 类」+「自更新条目」：非法/重复条目**直接丢弃**（一条坏条目不许拖垮整张表），
 * 总量封顶（默认最多再收 32 条 —— 白名单无限膨胀会稀释 k-匿名的意义）。
 * 返回的形状与 `NENG_LI_BIAO` 一致，生成器/检查器不用改判据。
 */
export function heBingNengLi(extra: Array<{ id?: string; hua?: string; ci?: string[] }>, zuiDuo = 32): NengLiTiao[] {
  const jian = new Set(NENG_LI_BIAO.map((x) => x.hua));
  const out: NengLiTiao[] = NENG_LI_BIAO.map((x) => ({ ...x }));
  for (const x of (Array.isArray(extra) ? extra : [])) {
    if (out.length >= NENG_LI_BIAO.length + zuiDuo) break;
    const hua = String(x?.hua || '').trim();
    const ci = (Array.isArray(x?.ci) ? x.ci : []).map((y) => String(y || '').trim()).filter(Boolean);
    if (!jianChaXinNengLi(hua, ci, [...jian]).ok) continue;
    if (jian.has(hua)) continue;
    jian.add(hua);
    out.push({ id: String(x?.id || ('z-' + out.length)), hua, ci: new RegExp(ci.map(zhuanYiRe).join('|'), 'i') });
  }
  return out;
}

/** 按"多少条**独立证据**支持这一能力"计数（**同一句话重复出现只算一条**：否则复制粘贴就能把 k=2 凑出来） */
export function jiShuZhiChi(zhengJu: string[], biao: NengLiTiao[] = NENG_LI_BIAO): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of biao) out[x.id] = 0;
  const yiJianGuo = new Set<string>();
  for (const yi of (Array.isArray(zhengJu) ? zhengJu : [])) {
    const wen = String(yi || '').replace(/\s+/g, '');
    if (!wen || yiJianGuo.has(wen)) continue;
    yiJianGuo.add(wen);
    for (const x of biao) if (x.ci.test(wen)) out[x.id] = (out[x.id] || 0) + 1;
  }
  return out;
}
/** 支持数达到阈值的**白名单短语**，按白名单原顺序给出（顺序固定 ⇒ 同一批证据每次生成的概要一模一样） */
export function nengLiYouZhiChi(zhengJu: string[], zuiShao = TUMIN_ZUI_SHAO_ZHI_CHI, biao: NengLiTiao[] = NENG_LI_BIAO): string[] {
  const ji = jiShuZhiChi(zhengJu, biao);
  return biao.filter((x) => (ji[x.id] || 0) >= zuiShao).map((x) => x.hua);
}

/**
 * 生成概要：**没得挑就整条抑制**（宁可会话库空着，也不拿一句没根据的话去对外）。
 * 输出是固定句式 + 白名单短语，不掺原文。证据按"一份一份"给（一条内部事件 = 一份），
 * 支持数不足 `zuiShao` 的能力连挑都不挑 —— 抑制阈值在这里，不在调用方。
 */
export function shengChengGaiLao(zhengJu: string[], zuiDuo = 4, zuiShao = TUMIN_ZUI_SHAO_ZHI_CHI, biao: NengLiTiao[] = NENG_LI_BIAO): string {
  const xuan = nengLiYouZhiChi(zhengJu, zuiShao, biao).slice(0, zuiDuo);
  if (!xuan.length) return '';
  return '我们可以做这些类型的事：' + xuan.join('、') + '。（这是能力类别清单，不含具体项目、时间、对象与做法。）';
}

/**
 * 确定性检查器（**降密的边界由它把关，不由模型自觉**）：
 * ① 每个短语必须在白名单里（含自更新条目）；② 不许出现数字/日期/路径/联系方式/存在性说法/专名指向；
 * ③ 剥掉句式与白名单短语之后**一个字都不许剩**（剩下的那截就是抄进来的原文 —— 比"不许重合 8 字"更强）；
 * ④ 长度封顶（不吃注入预算）；⑤ 原文里的 canary 哨兵（`CANARY_…`）一旦出现在输出即判泄露。
 */
export function jianChaGaiLao(gai: string, yuanWen: string, biao: NengLiTiao[] = NENG_LI_BIAO): { ok: boolean; why: string[] } {
  const out = String(gai || '');
  const yuan = String(yuanWen || '');
  const why: string[] = [];
  if (!out.trim()) return { ok: false, why: ['概要为空'] };
  if (out.length > 240) why.push('概要超长（' + out.length + ' 字 > 240）');
  const YunXu = new Set<string>(biao.map((x) => x.hua));
  const ti = out.replace(/^我们可以做这些类型的事：/, '').replace(/。（这是能力类别清单[^）]*）$/, '');
  for (const duan of ti.split('、')) {
    const d = duan.trim();
    if (!d) continue;
    if (!YunXu.has(d)) why.push('出现白名单外的表述：' + d.slice(0, 24));
  }
  for (const x of BU_KE_CHU_XIAN) if (x.re.test(out)) why.push('命中禁现形态：' + x.lei);
  for (const ma of yuan.match(/CANARY[A-Za-z0-9_-]{4,}/g) || []) if (out.includes(ma)) why.push('哨兵出现在输出里：' + ma);
  /**
   * 剥掉固定句式与白名单短语之后**不许还剩任何字**：
   * 剩下的那截就是"抄进来的原文"（改写式泄露的形态）。原文里出现同样的短语不算泄露——
   * 短语本身在白名单里，判据只看"输出里有没有白名单之外的话"。
   */
  let shengYu = out;
  for (const x of biao) shengYu = shengYu.split(x.hua).join('');
  shengYu = shengYu.replace(/我们可以做这些类型的事：|。?（这是能力类别清单[^）]*）/g, '').replace(/[、，。\s]/g, '');
  if (shengYu) why.push('出现白名单之外的内容：' + shengYu.slice(0, 24));
  return { ok: why.length === 0, why };
}

/**
 * 从内部内容派生一份**可放进会话库**的概要；任何一步不过关就返回空串（调用方落审计、不写库）。
 * `zhengJu` 是**证据的列表**（每条内部事件一项）：调用方要把"这批归档 + 内部库已有的"一起交进来，
 * 抑制阈值才数得准（只给一条 ⇒ 除了 `zuiShao:1` 的测试，正常永远不出货）。
 * `biao` 传"内置 + 自更新"的合并表（第 54 轮：白名单可自我更新，但每一条都过 `jianChaXinNengLi`）。
 */
export function paiShengDuiWaiGaiLao(zhengJu: string[], zuiShao = TUMIN_ZUI_SHAO_ZHI_CHI, biao: NengLiTiao[] = NENG_LI_BIAO): { gai: string; nengLi: string[]; ok: boolean; why: string[] } {
  const yuanWen = (Array.isArray(zhengJu) ? zhengJu : []).join('\n');
  const nengLi = nengLiYouZhiChi(zhengJu, zuiShao, biao);
  const gai = shengChengGaiLao(zhengJu, 4, zuiShao, biao);
  if (!gai) return { gai: '', nengLi, ok: false, why: [`没有达到 ${zuiShao} 条佐证的白名单能力 ⇒ 整条抑制（只做过一单就说"我们会做这一类"，等于把这单业务交给在场的人反推）`] };
  const cha = jianChaGaiLao(gai, yuanWen, biao);
  return { gai: cha.ok ? gai : '', nengLi, ok: cha.ok, why: cha.why };
}
