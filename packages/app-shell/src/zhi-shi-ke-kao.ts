/**
 * 知识库可靠性（第 53 轮项 4，按联网调研落地的三件事）。
 *
 * 调研里反复出现的三个失败模式，以及本模块对应的三条判据：
 *  1. **实体没归一 ⇒ 同一个人/项目被记成好几条**，检索时每条都只带一半事实，越查越像失忆
 *     （业界做法是三层：高分自动合并 / 中分**交人复核** / 低分新建；而且 person/org 这类"错了代价大"的类型要更保守）。
 *  2. **无证据就先信**（evidence-before-belief 的反面）：写库时没有任何原文锚点，等于把模型的猜测当事实存下来，
 *     之后每一轮检索都会把它当"已知"回灌（Mem0 的 ADD-only 回归就是这么把陈旧矛盾堆出来的）。
 *  3. **陈旧内容继续以同等权重在场**：不删除（删了就丢审计线索，见项 5 的"取代不删除"），但**必须显式标陈旧**，
 *     否则模型会把三年前的说法当现状说。
 *
 * 纯函数 ⇒ 门禁跑真值表（`scripts/verify-r53-zhishi.mjs`）；裁决本身不依赖模型自觉，也不依赖网络。
 */

export type ShiTiLike = { id: string; kind: string; ming: string; attrs?: Record<string, string> };
export type GuiYiPan = 'merge' | 'review' | 'new';

/**
 * 高风险类型：**只有归一后完全同名才允许自动合并**。
 * 为什么：把"张工"和"张总"合并成一个 person，之后所有事实都会串到同一个人身上（含评价类），
 * 这是不可逆的污染源；调研里 `protect_node_types` 就是这个意思。项目/组织同理（合并 = 两个客户的账混在一起）。
 */
export const BAO_HU_LEI_XING = ['person', 'org', 'project'];
/** 自动合并阈值（非保护类型）：≥0.92 视为同义写法 */
export const HE_BING_MING = 0.92;
/** 复核阈值：≥0.75 且 <0.92 ⇒ **不自动合并**，另建一条并交给复核（漏合并只是重复，错合并是污染） */
export const FU_HE_MING = 0.75;

/** 归一化名称：去空白与标点、全角转半角、拉丁小写（"W-Army" 与 "w army" 视为同写法） */
export function guiYiMing(ming: string): string {
  return String(ming || '')
    .replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[\s　\p{P}]/gu, '')
    .toLowerCase();
}

/**
 * 名称相似度：**字符二元组的"重合系数 × 长度相近度"**（中文没有空格分词，按字 bigram 最稳）。
 * 为什么不是纯 Jaccard：实体名常见形态是"简称 ⊂ 全称"（`阿里巴巴` vs `阿里巴巴集团`），
 * 纯 Jaccard 给 0.6 会让它直接落到"新建"，两个客户的事实就分家了；重合系数认得这种包含关系。
 * 为什么要再乘长度相近度：不乘的话 `张三` 与 `张三丰` 是 1.0（完全包含），
 * 那正是最贵的错——两个不同的人并成一个。乘上 `√(min/max)` 之后：
 *   阿里巴巴/阿里巴巴集团 ⇒ ≈0.87（落复核带，交人裁）；张三/张三丰 ⇒ ≈0.71（新建，不合并）。
 */
export function mingXiangSi(a: string, b: string): number {
  const x = guiYiMing(a), y = guiYiMing(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const set = (s: string) => {
    const m = new Set<string>();
    if (s.length === 1) m.add(s);
    for (let i = 0; i + 1 < s.length; i++) m.add(s.slice(i, i + 2));
    return m;
  };
  const A = set(x), B = set(y);
  let gong = 0;
  for (const k of A) if (B.has(k)) gong++;
  const zuiDuan = Math.min(A.size, B.size), zuiChang = Math.max(A.size, B.size);
  if (!zuiDuan) return 0;
  return (gong / zuiDuan) * Math.sqrt(zuiDuan / zuiChang);
}

export type GuiYiJieGuo = {
  pan: GuiYiPan;
  /** 自动合并时给出的目标 id；其余情形是新建用的 id 建议 */
  biaoId: string;
  deFen: number;
  duiXiang?: ShiTiLike;
  liYou: string;
};

/**
 * 三层裁决（**同 kind 才比**：跨 kind 的相似是巧合，不是同一件事）：
 *  · 保护类型 + 归一后完全同名 ⇒ merge；保护类型但只是相似 ⇒ review（交人/交模型复核，绝不自动合并）；
 *  · 非保护类型 ≥0.92 ⇒ merge；≥0.75 ⇒ review；其余 ⇒ new。
 */
export function guiYiPanDing(xuan: { kind: string; ming: string }, yiYou: ShiTiLike[]): GuiYiJieGuo {
  const baoHu = BAO_HU_LEI_XING.includes(String(xuan.kind || ''));
  let zuiJia: ShiTiLike | null = null, zuiGao = 0;
  for (const e of (Array.isArray(yiYou) ? yiYou : [])) {
    if (String(e?.kind || '') !== String(xuan.kind || '')) continue;
    const f = mingXiangSi(e.ming, xuan.ming);
    if (f > zuiGao) { zuiGao = f; zuiJia = e; }
  }
  if (!zuiJia) return { pan: 'new', biaoId: '', deFen: 0, liYou: '库里没有同 kind 的候选' };
  if (baoHu) {
    if (zuiGao === 1) return { pan: 'merge', biaoId: zuiJia.id, deFen: 1, duiXiang: zuiJia, liYou: '保护类型且归一后完全同名 ⇒ 同义写法，自动合并' };
    if (zuiGao >= FU_HE_MING) return { pan: 'review', biaoId: '', deFen: zuiGao, duiXiang: zuiJia, liYou: `保护类型只差 ${Math.round(zuiGao * 100)}% 相同 ⇒ 不自动合并（错合并会把两个人的事实串在一起）` };
  } else if (zuiGao >= HE_BING_MING) {
    return { pan: 'merge', biaoId: zuiJia.id, deFen: zuiGao, duiXiang: zuiJia, liYou: '非保护类型且相似度达合并阈 ⇒ 自动合并' };
  } else if (zuiGao >= FU_HE_MING) {
    return { pan: 'review', biaoId: '', deFen: zuiGao, duiXiang: zuiJia, liYou: '落在复核带 ⇒ 另建一条并标出候选，等复核' };
  }
  return { pan: 'new', biaoId: '', deFen: zuiGao, liYou: `最高相似只有 ${Math.round(zuiGao * 100)}% ⇒ 新建` };
}

/** 需要证据的来源前缀（宿主自己产的派生条目也算有证据：`prompt:overflow` / `derived:` 都来自真实原文或真实文件） */
export interface ZhengJuQingQiu { neiRong: string; anchors?: unknown[]; laiYuan?: string; zhengWen?: string }
export interface ZhengJuJieGuo { ok: boolean; deFen: number; liYou: string; huLue?: string }

/** 含糊措辞（猜测/转述）——不是拒写理由，但必须标成"待核"，让读的一侧知道这不是核定事实 */
const HU_HU = /大概|也许|应该是|可能是|听说|据说是|估计|记不太清|不太确定|如果没记错/;

/**
 * 最长连续重合（长度 + 片段）。**必须算真值**：只按"够不够 10 字"探测会把实际重合 9 字报成 0 字，
 * 那是往审计和用户回包里写一句假话（拒写的理由得能被核对）。滚动两行的 DP，两边各夹 4000 字（只在写入侧算一次，不在每轮热路径）。
 */
export function zuiChangLianChong(a: string, b: string, shangXian = 4000): { changDu: number; pianDuan: string } {
  const x = String(a || '').slice(0, shangXian);
  const y = String(b || '').slice(0, shangXian);
  if (!x || !y) return { changDu: 0, pianDuan: '' };
  let zui = 0, jieShu = 0;
  let qian = new Uint16Array(y.length + 1);
  let hou = new Uint16Array(y.length + 1);
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      hou[j] = x[i - 1] === y[j - 1] ? (qian[j - 1] ?? 0) + 1 : 0;
      if ((hou[j] ?? 0) > zui) { zui = hou[j] ?? 0; jieShu = j; }
    }
    const t = qian; qian = hou; hou = t; hou.fill(0);
  }
  return { changDu: zui, pianDuan: zui ? y.slice(jieShu - zui, jieShu) : '' };
}

/**
 * 证据闸（evidence-before-belief）：**这条内容是不是从原文里来的？**
 * 满足任一即算有证据：① 带锚点；② 来源是宿主派生（`derived:` / `prompt:` 前缀）；
 * ③ 能在本轮原文里找到 ≥10 字连续片段（与「印象」的幻觉硬闸同一条口径，不留两套）。
 * 都不满足 ⇒ 拒写并给出可执行的补救（把原话摘一句进来 / 带 anchor / 或明说是推测并等复核）。
 */
export function jianChaYouZhengJu(q: ZhengJuQingQiu): ZhengJuJieGuo {
  const nei = String(q?.neiRong || '').replace(/\s+/g, '');
  const yuan = String(q?.zhengWen || '').replace(/\s+/g, '');
  const lei = String(q?.laiYuan || '');
  if ((Array.isArray(q?.anchors) ? q.anchors.length : 0) > 0) return { ok: true, deFen: 1, liYou: '带原文锚点' };
  if (/^(derived|prompt|tool:knowledge_add_host):/.test(lei) || lei.startsWith('archive')) return { ok: true, deFen: 1, liYou: '来源是宿主产出的派生条目：' + lei };
  if (!nei) return { ok: false, deFen: 0, liYou: '正文是空的，谈不上证据' };
  const ch = zuiChangLianChong(nei, yuan);
  if (ch.changDu >= 10) return { ok: true, deFen: Math.min(1, ch.changDu / 20), liYou: `与原文连续重合 ${ch.changDu} 字`, huLue: ch.pianDuan };
  if (shiHuHan(String(q?.neiRong || ''))) return { ok: false, deFen: 0, liYou: `含糊措辞（猜测/转述）且与原文最长只重合 ${ch.changDu} 字 ⇒ 不许当事实入库；要留就明写"待核"并给出来源` };
  return { ok: false, deFen: 0, liYou: `正文与本轮原文最长只连续重合 ${ch.changDu} 字（要求 ≥10）⇒ 这是新结论，不是原文里的事实，先别入库` };
}

/** 含糊措辞判定（写侧与读侧共用一份，不留两套） */
export function shiHuHan(neiRong: string): boolean {
  return HU_HU.test(String(neiRong || ''));
}

/** 陈旧：半衰期 90 天，指数衰减，**下限 0.35**（降权不淘汰，更不删除——删除会丢审计线索） */
export const CHEN_JIU_BAN_SHUAI_RI = 90;
export const CHEN_JIU_XIA_XIAN = 0.35;
export interface ChenJiuQing { jiluTs?: number; fashengTs?: number; ts?: number; shiXiaoTs?: number; beiSongDu?: number }
export type ChenJiuJieGuo = { deFen: number; tianShu: number; biao: string };

/**
 * 陈旧度：以**发生时间**为准（事情本身多旧），没有发生时间才退回记录时间/写入时间；
 * 已取代（`shiXiaoTs`）的直接 0。`biao` 是给模型看的标签文本——不标就等于让它把旧说法当现状。
 */
export function chenJiuFen(q: ChenJiuQing, xianZai: number): ChenJiuJieGuo {
  if (q?.shiXiaoTs) return { deFen: 0, tianShu: 0, biao: '已被更新的说法取代' };
  const ji = Number(q?.fashengTs) || Number(q?.jiluTs) || Number(q?.ts) || 0;
  if (!ji) return { deFen: 1, tianShu: 0, biao: '' };
  const tian = Math.max(0, (Number(xianZai) - ji) / 86400000);
  const deFen = Math.max(CHEN_JIU_XIA_XIAN, Math.pow(0.5, tian / CHEN_JIU_BAN_SHUAI_RI));
  return {
    deFen,
    tianShu: Math.round(tian),
    biao: deFen < 0.6 ? `陈旧 ${Math.round(tian)} 天（按 ${CHEN_JIU_BAN_SHUAI_RI} 天半衰期降权，仍需当面核对再用）` : '',
  };
}
