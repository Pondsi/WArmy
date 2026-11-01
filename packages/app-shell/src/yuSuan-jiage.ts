/**
 * 请求级预算计价（第 44 轮后半 · 用户 #2 / #3 / #4）—— 纯函数、零依赖，门禁可直接 import
 *
 * 用户口径（原话要点）：
 *  · **#2** 「上下文预算应该包含**所有发送给模型的内容**，也就是说这个预算设置多少，就是发送多少内容给模型。」
 *  · **#3** 「道 + 规矩 + 印象 + 产品门禁 + 身份/身份锚 + 人设 + 能力清单 + 知识库 + 归档摘要 + 视图
 *    + 续派指令 + 步骤账本 + 子模型结果，这些应该是**可计算大小的**，再加上一轮对话和附件大小，
 *    这些一起算是**固定大小、最小需求** ⇒ 设置预算时这是**不可再小的预算**；上限可以给到 100%（执行中留空位防超）。」
 *  · **#4** 「预算充足时把最近 5 条 user 原文一起发；**不足时这 5 条也要归档摘要**；
 *    本轮对话本身超长超出预设 ⇒ **本轮原文也要摘要**，确保发送的不超预算。」
 *
 * 修之前的现实：预算只约束"有界视图"那一段，固定开销全在预算之外
 * ⇒ 滑杆设 2 万字符，实际发出去的是"2 万 + 一整套系统提示 + 工具规格"，"设多少发多少"根本没兑现。
 *
 * 本模块只回答三个问题（全部是可测的算术，不做 I/O、不猜供应商）：
 *  ① 这条请求里**每一段**各占多少 token（按 `token-jiliang` 的口径，含校准）；
 *  ② 给定总预算，视图**还能分到多少**（减到负数就是"预算连固定开销都装不下"）；
 *  ③ 装不下时**按用户指定的顺序**该牺牲谁（不许"随便挑一个压"，也不许直接超发）。
 */
import { guJiTokenXiaoZhun, tokenDaoZiFu, shiJueToken, type TokenXiaoZhun } from './token-jiliang.js';

/** 一段的名字（审计与界面都按这个显示，出问题时要能说清"是哪段挤掉了哪段"） */
export interface DuanChengBen {
  ming: string;
  zi: number;
  tokens: number;
  /** 这一段允不允许被压缩/摘要（道、规矩这类一律 false：宁可停止发送也不改用户的原话） */
  keYaSuo: boolean;
}

/**
 * **不可压缩**名单（第 51 轮用户口径）：**只有「道」永远不可压缩**。
 * 术 / 教条(agents.md) / 束缚(Memory.md) / 印象 / 产品门禁 / 身份锚在上下文不足且无其它可压时，
 * 允许按同一比例压缩（道宁可停止发送也不许缩短）。
 */
/**
 * **只有产品硬门禁与「道」永不可压缩**（用户定稿）：其余各层（术/规范/教条/束缚/工具/软门禁/认知/印象）
 * 都可压缩以让上下文符合预算，且**先压别的、最后才压这些**，压缩顺序与优先级一致 —— 优先级高的后压。
 * 名单按段标题前缀匹配（`【道 · …】` / `【产品门禁 · …】`），段标题必须 ≤24 字才认得出来。
 */
export const BU_KE_YA_SUO = ['道', '产品门禁'];
/**
 * 压缩顺序（**从前到后先压谁**）= 分层表的扁平化，唯一事实来源在 `yaSuo-fenCeng.ts`：
 * 第 0 层无名段 → 第 1 层 软门禁/工具/印象/规范 → 第 2 层 身份/认知/束缚/教条 → 第 3 层 术。
 * 第 52 轮用户口径：**不许一次压到极限** —— 先把各层压到半极限（留 72%），走完一轮再来一轮压到真极限。
 * 道与产品门禁在 BU_KE_YA_SUO 里，根本不进这个队列。
 */
export { YA_SUO_XIAN_HOU_PING as YA_SUO_XIAN_HOU } from './yaSuo-fenCeng.js';

/** 多模态 content 是数组：文字块必须计价，图片块按视觉 token 单独算（这里只取文字） */
function wenBenKuai(neng: unknown): string {
  if (typeof neng === 'string') return neng;
  if (!Array.isArray(neng)) return '';
  const chu: string[] = [];
  for (const b of neng) {
    const bbf = b as { type?: string; text?: string };
    if (bbf && (bbf.type === 'text' || typeof bbf.text === 'string')) chu.push(String(bbf.text || ''));
  }
  return chu.join('\n');
}

/** 按行首的 `【…】` 标签切段：固定开销段全都带这个形状（第 35/36/37 轮起的既定注入格式） */
export function chaiFenDuan(xiaoXiJi: Array<{ role?: string; content?: unknown }>, zhun?: TokenXiaoZhun | null): DuanChengBen[] {
  const duan: DuanChengBen[] = [];
  for (const m of Array.isArray(xiaoXiJi) ? xiaoXiJi : []) {
    const zi = wenBenKuai(m?.content);
    if (!zi.trim()) continue;
    for (const kuai of qieKuai(zi, zhun)) {
      duan.push({ ming: kuai.ming, zi: kuai.zi.length, tokens: kuai.tokens, keYaSuo: !BU_KE_YA_SUO.some((b) => kuai.ming.startsWith(b)) });
    }
  }
  return duan;
}
/** 把一段正文按 `【标签】` 切成块（没有标签的前导文字归入「未标注」） */
function qieKuai(zi: string, zhun?: TokenXiaoZhun | null): Array<{ ming: string; zi: string; tokens: number }> {
  const chu: Array<{ ming: string; zi: string; tokens: number }> = [];
  const biao = Array.from(zi.matchAll(/【([^】\n]{1,24})】/g));
  const di = biao.length ? biao[0] : undefined;
  if (!di) return [{ ming: '未标注', zi, tokens: guJiTokenXiaoZhun(zi, zhun || null) }];
  const tou = zi.slice(0, di.index ?? 0).trim();
  if (tou) chu.push({ ming: '未标注', zi: tou, tokens: guJiTokenXiaoZhun(tou, zhun || null) });
  for (let i = 0; i < biao.length; i++) {
    const b = biao[i];
    if (!b) continue;
    const nx = biao[i + 1];
    const kai = b.index ?? 0;
    const jie = nx && typeof nx.index === 'number' ? nx.index : zi.length;
    const kuai = zi.slice(kai, jie);
    chu.push({ ming: String(b[1]), zi: kuai, tokens: guJiTokenXiaoZhun(kuai, zhun || null) });
  }
  return chu;
}

/** 一条请求的分段成本 */
export interface QingQiuChengBen {
  guDing: number;      // 固定开销（所有 system 段）
  gongJu: number;      // 工具规格（也占输入）
  shiTu: number;       // 有界视图
  benLun: number;      // 本轮用户输入 / 续派指令
  daiRu: number;       // 迟注入层：步骤账本 + 子模型结果 + 分次看图描述（渲染之后才追加，必须预先预留）
  keYaSuo: number;     // 固定开销里**允许压缩**的那一段（能力清单/知识库/人设…）
  buKeYaSuo: number;   // 固定开销里**动都不许动**的那一段（道/规矩/印象/门禁/身份锚）
  shiJue: number;      // 图片视觉 token（按真实像素算）
  zong: number;        // 合计（= 真正要发给模型的全部内容）
  mingXi: DuanChengBen[];
}

/**
 * 迟注入层的**份额上限**（字符）。ADR000「注入量恒定」的落点：
 * 这一段是在**视图渲染之后**才拼上去的（账本要等上一轮的执行结果、子模型结果要等转交跑完），
 * 所以只能在分配前先按上限预留、注入时按下限截断 —— 两头都钉死，它才不会随图片张数/子任务数无限涨。
 */
export const DAI_RU_CENG_ZUI_DA_ZI = 6000;
/** 步骤账本单独的上限（它和子模型结果两段都会同时出现，不能共用一份额度） */
export const ZHANG_BEN_ZUI_DA_ZI = 4000;

/**
 * 给一条请求算成本。
 * `shiTuZi`/`benLunZi` 用调用方**实际要发**的正文，不重新猜；`zhun` 是该校准桶的系数（同一条请求只许用同一个系数）。
 */
export function jiageQingQiu(p: {
  shangXiaWen?: Array<{ role?: string; content?: unknown }>;
  shiTuZi?: string;
  benLunZi?: string;
  daiRuZi?: string;
  daiRuTok?: number;
  gongJuWen?: string;
  shiJueTok?: number;
  zhun?: TokenXiaoZhun | null;
}): QingQiuChengBen {
  const mingXi = chaiFenDuan(p.shangXiaWen || [], p.zhun || null);
  const er = (zh: string): number => (zh ? guJiTokenXiaoZhun(zh, p.zhun || null) : 0);
  const guDing = mingXi.reduce((s, d) => s + d.tokens, 0);
  const gongJu = er(String(p.gongJuWen || ''));
  const shiTu = er(String(p.shiTuZi || ''));
  const benLun = er(String(p.benLunZi || ''));
  const shiJue = Math.max(0, Number(p.shiJueTok) || 0);
  const daiRu = Math.max(0, Number(p.daiRuTok) || 0) + (p.daiRuZi ? er(String(p.daiRuZi)) : 0);
  /**
   * 固定开销分成两半报（第 45 轮补）：`keYaSuo` 标了很久却没人执行过压缩 —— 分段成本必须能说出
   * "哪一段还能动、动完能省多少"，否则"窗口装不下"只能直接跳到停止发送。
   */
  const keYaSuo = mingXi.reduce((s, d) => s + (d.keYaSuo ? d.tokens : 0), 0);
  return { guDing, gongJu, keYaSuo, buKeYaSuo: guDing - keYaSuo, shiTu, benLun, daiRu, shiJue, zong: guDing + gongJu + shiTu + benLun + daiRu + shiJue, mingXi };
}

/** 降级动作（顺序由用户 #4 点名，不许改顺序：先摘要最近 5 条原文 → 再摘要本轮 → 再收缩视图 → 最后停止发送） */
export const JIANG_JI = {
  ZHAIYAO_ZUIJIN5: 'zhaiyao-zuijin5-yonghu',
  ZHAIYAO_BENLUN: 'zhaiyao-benlun-shuru',
  SHOU_SHITU: 'shousuo-shitu',
  YA_SUO_GU_DING: 'yasuo-ke-yasuo-duan',
  /**
   * 让出**我们自己加的**余量（2% 安全垫 + 多余的输出留位 + 5%→2% 执行余量）。
   * 排在「压缩固定段 / 收窄工具面」之后、**停止发送之前**：能发就别停。
   */
  RANG_CHU_YU_LIANG: 'rangchu-yuliang',
  DI_FENBIANLV: 'di-tupian-fenbianlv',
  JIAN_ZHANGSHU: 'jian-tupian-zhangshu',
  TINGZHI: 'tingzhi-bu-fasong',
} as const;
export type JiangJiCao = (typeof JIANG_JI)[keyof typeof JIANG_JI];

/** 视图至少要留多少 token（留 0 = 模型看不到任何历史 = 真事故里的"假装失忆"） */
export const SHI_TU_ZUI_XIAO_TOKENS = 512;
/**
 * 「最近 5 条 user 原文」要留着，视图至少得有这么宽（第 44 轮 · 用户 #4 的"充足/不充足"分界）。
 * 低于它就不再是"要不要多留一点"的问题，而是"留了就没地方放历史"⇒ 按 #4 摘要这一段。
 */
export const YUAN_WEN_ZUI_XIAO_SHI_TU = 2048;
/** 执行余量比例：预算的这部分**故意不装满**，留给输出前的模板 token 与估算误差 */
export const ZHI_XING_YU_LIANG = 0.05;
/** 视图最小值与"绝对下限"（两个都是产品铁律：视图不许为 0，预算不许低于 2048 token） */
export const MIN_CONTEXT_TOKENS = 2048;
export const MIN_CONTEXT_BUDGET_CHARS = 200;
/** **窗口安全垫**（用户："预算要预留一点点，防止溢出模型的上下文"）：窗口的 2%，且不少于 128 token */
export const CHUANG_KOU_YU_LIANG_BI = 0.02;
export const CHUANG_KOU_YU_LIANG_ZUI_SHAO = 128;
/**
 * 「让出余量」这一级能退到哪（阶梯里排在**停止发送之前**，见 `JIANG_JI.RANG_CHU_YU_LIANG`）。
 * 为什么敢让：预算用的是**分脚本上界**估算，实测真实/上界 ≈0.64（中文）–0.89（代码）⇒ 上界本身
 * 就已经比 2% 安全垫厚得多；真正不能全让的是**输出留位**（模型还得有话可说），所以它留一个地板。
 * 反过来说：宁可让出我们自己加的垫子把这一轮发出去，也不许在"固定开销 + 工具"差一点点时
 * 直接拒发 —— 真机抓到过：模型窗口未知 ⇒ 兜底窗口偏小 ⇒ 道（不可压缩）+ 工具顶满 ⇒ 整轮停止发送，
 * 用户看到的是"什么都没干"（`chat.budget.stop-send`，缺 3356 token）。
 *
 * ⚠️ 地板取 **2048** 而不是 1024：发送侧的输出上限本来就有"保底 2048"这条规矩
 * （思考模型的 thinking 会吃光小配额 ⇒ content 变空）。两边必须同一个数，否则
 * "输入按 1024 的留位放行、输出仍按 2048 发"就又变成两边各算一次 ⇒ 顶窗。
 */
export const SHU_CHU_LIU_WEI_DI_BAO = 2048;
export const SHU_CHU_LIU_WEI_ZUI_DUO_BI = 0.04;
/** 让出安全垫之后，执行余量退到这个数（不是 0：模板 token 与估算误差总要留一点） */
export const ZHI_XING_YU_LIANG_RANG_HOU = 0.02;

/** 「让出余量」后的可装输入窗口（纯函数：主进程与门禁共用同一份算术） */
export function rangChuYuLiang(p: {
  maxTokens?: number;
  anQuanChuangKou?: number;
  yuZhanTok?: number;
}): { keZhuang: number; yuLiangBi: number; rangChu: number; yuZhanXin: number; mingXi: string } {
  const chuangKou = Math.max(0, Number(p.maxTokens) || Number(p.anQuanChuangKou) || 0);
  const yuanKeZhuang = Math.max(MIN_CONTEXT_TOKENS, (Number(p.anQuanChuangKou) || chuangKou) - Math.max(0, Number(p.yuZhanTok) || 0));
  /** 输出留位：不超过窗口的 4%，但不少于 1024（模型至少要能回一小段，剩下的交给续派） */
  const yuZhanXin = Math.min(Math.max(0, Number(p.yuZhanTok) || 0),
    Math.max(SHU_CHU_LIU_WEI_DI_BAO, Math.floor(chuangKou * SHU_CHU_LIU_WEI_ZUI_DUO_BI)));
  const keZhuang = Math.max(MIN_CONTEXT_TOKENS, chuangKou - yuZhanXin);
  return {
    keZhuang,
    yuLiangBi: ZHI_XING_YU_LIANG_RANG_HOU,
    rangChu: Math.max(0, keZhuang - yuanKeZhuang),
    yuZhanXin,
    mingXi: `安全垫让完 + 输出留位 ${Math.max(0, Number(p.yuZhanTok) || 0)}→${yuZhanXin} + 执行余量 ${ZHI_XING_YU_LIANG}→${ZHI_XING_YU_LIANG_RANG_HOU}`,
  };
}

/** 没有形状样本时的换算兜底（历史上那个"万能 1.6"）：只在**拿不到样本**时用它，且如实留在名字里 */
export const WU_YANG_BEN_BEI_JIAN = 1.6;

export interface PeiZhiYuSuan {
  chars: number;
  percent: number;
  tokens: number;
  maxTokens: number;
  minPercent: number;
  anQuanChuangKou: number;
  yuLiangTok: number;
}

/**
 * 配置 → 这条请求的预算（**纯函数，主进程与压力档共用同一份**）。
 * 抽出来的原因有两个真事故：
 *  ① 压力档 `verify-memory-stress` 以前"逐行复刻"这段算术，还带着那个万能系数 1.6 ——
 *    产品改了它不知道 ⇒ 压测跑得比生产宽，测得再绿也证不了产品；
 *  ② 溢出保护（窗口 − 2% 安全垫 − 本轮输出预留）后来才补进主进程，复刻那份永远落后一步。
 * 现在两边都调这里，**窗口表 / 输出上限仍由调用方按事实传入**（本模块不猜任何供应商规格）。
 */
/**
 * 窗口未知时的兜底（第 51 轮用户口径）：
 *   ① 先从**模型名**里解析（`-128K` / `:32k` / `_1M` / `-128000`）；
 *   ② 解析不到再按 **128K** 计算（不再用 32768 保守值 —— 用户明确要求两处口径统一）。
 * 只认"像窗口"的记号：带 k/m/千位数字，避免把 `qwen3.8-27b` 里的 27 当成窗口。
 */
export function congMingZiCaiChuangKou(modelId?: string): number {
  const s = String(modelId || '');
  if (!s) return 0;
  const gui = /(?:^|[^a-z0-9])(\d{1,4})\s*([km])(?![a-z])/gi;
  let zuiDa = 0;
  for (const m of s.matchAll(gui)) {
    const n = Number(m[1]);
    const dan = String(m[2]).toLowerCase();
    const tok = dan === 'm' ? n * 1_000_000 : n * 1000;
    if (tok >= 4096 && tok <= 10_000_000) zuiDa = Math.max(zuiDa, tok);
  }
  if (zuiDa) return zuiDa;
  const chun = /(?:^|[^0-9])(\d{5,7})(?![0-9])/.exec(s);
  if (chun) {
    const tok = Number(chun[1]);
    if (tok >= 4096 && tok <= 10_000_000) return tok;
  }
  return 0;
}
/** 窗口未知时的统一兜底（用户口径：128K） */
export const MO_XING_CHUANG_KOU_DOU_DI = 128000;

export function peizhiYuSuan(p: {
  percent?: number;
  windowTokens?: number;
  fallbackTokens?: number;
  shuChuYueDing?: number;
  yangBen?: string;
  zhun?: TokenXiaoZhun | null;
  /** 没样本时的兜底系数（默认 1.6；调用方可以显式传自己的常数，方便门禁核对来源） */
  charBeiJian?: number;
}): PeiZhiYuSuan {
  const pct = Number.isFinite(Number(p.percent)) ? Math.min(100, Math.max(10, Math.round(Number(p.percent)))) : 60;
  const w = Number(p.windowTokens) || 0;
  const youZhenShi = w >= 4096;
  const fb = Number(p.fallbackTokens) || 0;
  const maxTokens = youZhenShi ? w : (Number.isFinite(fb) && fb >= 4096 ? fb : MO_XING_CHUANG_KOU_DOU_DI);
  const minPercent = Math.min(100, Math.ceil((MIN_CONTEXT_TOKENS / maxTokens) * 100));
  const effPercent = Math.max(pct, minPercent);
  let tokens = Math.max(MIN_CONTEXT_TOKENS, Math.round((effPercent / 100) * maxTokens));
  /** 官方写过的输出上限 ⇒ 给输出留位（不留 = 压力档测的比生产宽） */
  const shuChu = Math.max(0, Number(p.shuChuYueDing) || 0);
  if (shuChu > 0) tokens = Math.min(tokens, Math.max(MIN_CONTEXT_TOKENS, maxTokens - shuChu));
  /** 溢出保护：无论上面怎么算，最终都不许贴到窗口边缘 */
  const yuLiangTok = Math.max(CHUANG_KOU_YU_LIANG_ZUI_SHAO, Math.floor(maxTokens * CHUANG_KOU_YU_LIANG_BI));
  const anQuanChuangKou = Math.max(MIN_CONTEXT_TOKENS, maxTokens - yuLiangTok);
  if (tokens > anQuanChuangKou) tokens = anQuanChuangKou;
  /**
   * token → 字符**不再乘那个万能 1.6**：拿这段会话的真实文本做样本，走分脚本上界 + 该模型的校准比值反算 ⇒
   * 纯中文会话与纯代码会话折算出的字符数不一样，这才是"预算设多少就发多少"的前提。
   * 样本不足 8 字（新会话 / 读失败）才退回文档化兜底常数。
   */
  const ben = String(p.yangBen || '').slice(0, 60000);
  const chars = Math.max(MIN_CONTEXT_BUDGET_CHARS, ben.length >= 8
    ? tokenDaoZiFu(tokens, ben, p.zhun ?? null)
    : Math.round(tokens * (Number(p.charBeiJian) || WU_YANG_BEN_BEI_JIAN)));
  return { chars, percent: effPercent, tokens, maxTokens, minPercent, anQuanChuangKou, yuLiangTok };
}

export interface FenPeiJieGuo {
  /** 视图还能分到多少 token（负数表示连固定开销都装不下） */
  shiTuTokens: number;
  /** 这条请求的"最小可用预算"：固定开销 + 本轮 + 图片 + 视图下限 + 执行余量（滑杆的下限就该抬到这里） */
  zuiXiaoYuSuan: number;
  chaoYu: boolean;
  /** **生效预算**：用户设的与实测下限取大，再被模型窗口封顶（见下面两条边界） */
  shengXiaoTokens: number;
  /** 窗口本身装不下固定开销 ⇒ 只能如实降级/停止，不许偷偷超发 */
  chuangKouBuGou: boolean;
  jiangJi: JiangJiCao[];
}

/**
 * 预算分配 + 该走哪几步降级。`yuSuanTokens` 是**整条请求**的预算（不是视图预算）—— 这是本次改造的核心口径差。
 *
 * 两条边界（真机各红过一次，别退回单条）：
 *  · **不许假装装不下**：用户预算低于实测固定开销时，把生效预算**抬到下限**，
 *    否则"固定开销 + 工具"一算就吃掉整个预算 ⇒ 视图额度算成 0 ⇒ 模型真的开始失忆（第 44 轮真机：
 *    预算 19661、固定+工具 算出 31719 ⇒ 视图 0）；
 *  · **不许偷偷超发**：抬也不能抬过窗口 —— 窗口装不下固定开销时如实报 `chuangKouBuGou`，
 *    由调用方按阶梯走到"停止发送"。
 */
export function fenPeiYuSuan(p: {
  yuSuanTokens: number;
  guDingTokens: number;
  gongJuTokens: number;
  benLunTokens: number;
  shiJueTokens?: number;
  /** 迟注入层（账本 + 子模型结果 + 分次看图描述）预留的 token */
  daiRuTokens?: number;
  zuiXiaoShiTu?: number;
  yuLiangBi?: number;
  /** 模型窗口（token）。传 0 = 不知道窗口 ⇒ 不做窗口封顶（也就失去"不超窗"的保证，调用方要如实说明） */
  chuangKouTokens?: number;
  /** 本轮输入是否已经大到需要摘要（调用方按阈值判，这里只按事实排动作） */
  benLunChaoChang?: boolean;
  /**
   * 调用方**还能让出多少自己留的余量**（`rangChuYuLiang()` 算出来的 `rangChu`）。
   * 传 0 = 已经让过了/没得让 ⇒ 阶梯直接跳到停止发送，不会重复让。
   */
  keRangTokens?: number;
}): FenPeiJieGuo {
  const yu = Math.max(1, Number(p.yuSuanTokens) || 1);
  const gd = Math.max(0, Number(p.guDingTokens) || 0);
  const gj = Math.max(0, Number(p.gongJuTokens) || 0);
  const bl = Math.max(0, Number(p.benLunTokens) || 0);
  const sj = Math.max(0, Number(p.shiJueTokens) || 0);
  const dr = Math.max(0, Number(p.daiRuTokens) || 0);
  const zx = Math.max(0, Number(p.zuiXiaoShiTu ?? SHI_TU_ZUI_XIAO_TOKENS));
  const yl = Math.min(0.5, Math.max(0, Number(p.yuLiangBi ?? ZHI_XING_YU_LIANG)));
  const zuiXiaoYuSuan = Math.ceil((gd + gj + bl + sj + dr + zx) / (1 - yl));
  // 用户预算先扣掉执行余量；窗口同样按余量折算后才当地板的上限（两条都扣过，不重复扣）
  const yuKe = Math.floor(yu * (1 - yl));
  const chuangKou = Number(p.chuangKouTokens) > 0 ? Math.floor(Number(p.chuangKouTokens) * (1 - yl)) : 0;
  const biao = chuangKou > 0
    ? Math.min(Math.max(yuKe, gd + gj + bl + sj + dr + zx), chuangKou)
    : Math.max(yuKe, gd + gj + bl + sj + dr + zx);
  const keYong = biao - gd - gj - bl - sj - dr;
  const chuangKouBuGou = chuangKou > 0 && chuangKou < gd + gj + bl + sj + dr + zx;
  const jiangJi: JiangJiCao[] = [];
  /**
   * 降级阶梯按**用户 #4 点名的顺序**排，而且每一级都问"到底缺不缺这块地方"：
   *  · 视图宽到装得下「最近 5 条原文 + 一点历史」⇒ 原文留着，什么都不动；
   *  · 视图紧到放不下原文 ⇒ 先把这一段摘要成短摘录 + 可执行指针（原文永远在日志里，retrieve 得回）；
   *  · 本轮自己就吃光视图 ⇒ 本轮原文也要摘要；
   *  · 图片占得太多 ⇒ 先降分辨率再减张数（#5 的阶梯）；
   *  · 还是不够 ⇒ 收缩视图；窗口连固定开销都放不下 ⇒ **停止发送**并如实报原因。
   */
  if (keYong < YUAN_WEN_ZUI_XIAO_SHI_TU) jiangJi.push(JIANG_JI.ZHAIYAO_ZUIJIN5);
  if (bl > Math.max(zx, keYong * 0.6) || p.benLunChaoChang) jiangJi.push(JIANG_JI.ZHAIYAO_BENLUN);
  if (sj > Math.max(zx, keYong * 0.5)) { jiangJi.push(JIANG_JI.DI_FENBIANLV); jiangJi.push(JIANG_JI.JIAN_ZHANGSHU); }
  if (keYong < zx) jiangJi.push(JIANG_JI.SHOU_SHITU);
  /** 窗口连固定开销都放不下 ⇒ 先压**允许压缩的那几段**（能力清单/知识库/人设/工具长尾），压完还装不下才停 */
  if (keYong < 0 || chuangKouBuGou) jiangJi.push(JIANG_JI.YA_SUO_GU_DING);
  /**
   * 还差一点点，而差的是**我们自己留的垫子** ⇒ 先让垫子（`rangChuYuLiang`），别急着拒发。
   * 真机事故：模型窗口未知 ⇒ 兜底窗口偏小 ⇒ 道（不可压缩）+ 工具顶满 ⇒ `que:3356` 直接停止发送，
   * 用户看到的是"什么都没干"。让出 2% 安全垫 + 多余的输出留位就装得下。
   */
  const keRang = Math.max(0, Number(p.keRangTokens) || 0);
  if ((keYong < 0 || chuangKouBuGou) && keRang > 0) jiangJi.push(JIANG_JI.RANG_CHU_YU_LIANG);
  if (keYong < 0 || chuangKouBuGou) jiangJi.push(JIANG_JI.TINGZHI);
  return { shiTuTokens: Math.max(0, keYong), zuiXiaoYuSuan, shengXiaoTokens: biao, chaoYu: keYong < zx, chuangKouBuGou, jiangJi };
}

// ─────────────────────────────────────────────
// 图片（第 44 轮 · 用户 #5）：计入预算 + 张数/大小上限 + 降分辨率 + 分次判断
// ─────────────────────────────────────────────

/** 单轮最多喂给模型几张图（超出按"减张数"降级，并如实告诉用户是哪几张没喂） */
export const TU_ZHANG_SHANG_XIAN = 8;
/** 单张图片解码前的字节上限（原 6MB 散在两处，这里收成一个口径） */
export const TU_MEI_ZHANG_ZI_JIE = 6 * 1024 * 1024;
/** 规范化后 dataURL 的字符上限（base64 膨胀 4/3，与上一条不是同一个判据） */
export const TU_DATA_URL_ZI_SHU = 8 * 1024 * 1024;
/** 降分辨率那一档把最长边压到多少像素 */
export const TU_JIANG_JI_BIAN_CHANG = 1024;
/**
 * 视觉 token 的**加价系数**：`shiJueToken()` 按像素网格估的是"补丁数"，
 * 各家还会加边界/缩放的开销，且估算误差只会朝"低估"方向咬人 ⇒ 统一乘一个垫高，宁可多留地方。
 */
export const SHI_JUE_JIA_JIA = 1.2;

export interface TuChengBenJieGuo {
  /** 这一轮真正进请求的图片总视觉 token（已按上限裁过张数、已加价） */
  shiJueTok: number;
  /** **逐张**的视觉 token（与传入顺序一致）：减张数那一档要知道每张各占多少 */
  geZhangTok: number[];
  /** 被"张数上限"挡在外面的图片数（调用方要如实写进"未喂给模型"） */
  diZhang: number;
  /** 最长边超过这一档 ⇒ 该降分辨率 */
  yaoJiangJi: boolean;
  /** 单张最大的那张（分次判断要用它，不是平均值） */
  zuiDaDanZhangTok: number;
  zhangShu: number;
}

/**
 * 图片成本：**按真实像素算，不按文件字节猜**（同一张 1024×1024 存成 PNG 还是 JPEG 字节差 10 倍，
 * 但模型吃的补丁数是一样的）。张数上限在这里一次性裁掉，调用方拿到的就是"将要发出去的那几张"的成本。
 */
export function tuChengBen(p: {
  tu: Array<{ kuan?: number; gao?: number; bianChang?: number }>;
  moXing?: string;
  zhangShangXian?: number;
}): TuChengBenJieGuo {
  const shangXian = Math.max(1, Number(p.zhangShangXian ?? TU_ZHANG_SHANG_XIAN));
  const yao = (Array.isArray(p.tu) ? p.tu : []).filter((t) => t && (Number(t.kuan) > 0 || Number(t.gao) > 0 || Number(t.bianChang) > 0));
  const liu = yao.slice(0, shangXian);
  const ge = liu.map((t) => {
    const bian = Math.max(1, Number(t.bianChang) || Math.max(Number(t.kuan) || 1, Number(t.gao) || 1));
    const k = Math.max(1, Number(t.kuan) || bian);
    const g = Math.max(1, Number(t.gao) || bian);
    return Math.ceil(shiJueToken(k, g, p.moXing) * SHI_JUE_JIA_JIA);
  });
  return {
    shiJueTok: ge.reduce((s, x) => s + x, 0),
    geZhangTok: ge,
    diZhang: Math.max(0, yao.length - liu.length),
    yaoJiangJi: liu.some((t) => Math.max(Number(t.kuan) || 1, Number(t.gao) || 1) > TU_JIANG_JI_BIAN_CHANG),
    zuiDaDanZhangTok: ge.length ? Math.max(...ge) : 0,
    zhangShu: ge.length,
  };
}

/**
 * "不可分割需求"的措辞：命中任意一条就说明模型必须**同时**看到这些图
 * （对比、找差异、前后状态、哪一张更好……）。宁可少分也不让模型看漏 —— 看漏是无声的错误。
 */
const BU_KE_FEN_CI = /(对比|比较|比一下|哪个更|哪张|哪些不同|不同之处|差别|差异|区别|变化|一致|一样吗|相同点|前后|对照|逐张比对|有没有变|consist|compar|diff(erence)?|which (one|image)|vs\.?)/i;

export interface FenCiPanDing {
  keYi: boolean;
  yuanYin: string;
  /** 一次请求放得下几张（可分次时才给） */
  yiCiZhang: number;
}

/**
 * **分次发送前的判断**（用户 #5 原话）： *  · 前提："单张图片加上其余的固定开销没有超出预算" —— 单张都放不下，分多少次都放不下；
 *  · 判据："确定无需关注图片间的差异，无需对这些图片进行对比等不可分割的需求" ——
 *    只要本轮文字要模型跨图比较，分次就等于让模型看漏另一张 ⇒ **不许分次**，改走阶梯。
 * `keYongTok` 是"扣掉固定开销、工具、本轮与执行余量之后还能放图片的额度"。
 */
export function keYiFenCi(p: {
  tuShu: number;
  danZhangTok: number;
  keYongTok: number;
  benLunWen?: string;
}): FenCiPanDing {
  const zhang = Math.max(0, Number(p.tuShu) || 0);
  const ke = Math.max(0, Number(p.keYongTok) || 0);
  const wen = String(p.benLunWen || '');
  if (zhang <= 1) return { keYi: false, yuanYin: '只有一张图片，分次没有意义', yiCiZhang: Math.max(1, zhang) };
  const ming = BU_KE_FEN_CI.exec(wen);
  if (ming) return { keYi: false, yuanYin: `本轮要求跨图对照（命中「${ming[0]}」），分开送就看不全，不分次`, yiCiZhang: zhang };
  if (Number(p.danZhangTok) > ke) {
    return { keYi: false, yuanYin: `单张图片 ${Math.round(Number(p.danZhangTok) || 0)} token 已超出去除固定开销后可用的 ${ke} token ⇒ 分次也装不下`, yiCiZhang: 0 };
  }
  const yiCi = Math.max(1, Math.floor(ke / Math.max(1, Number(p.danZhangTok) || 1)));
  return { keYi: true, yuanYin: `单张加固定开销放得下，且本轮没有跨图对比需求 ⇒ 可分 ${Math.ceil(zhang / yiCi)} 次、每次 ${Math.min(zhang, yiCi)} 张`, yiCiZhang: Math.min(zhang, yiCi) };
}
