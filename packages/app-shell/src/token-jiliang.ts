/**
 * 单一 token 计量口径（零依赖纯函数，主进程与门禁 import 同一份 —— 与 `mo-xing-gui-ge.ts` 同一套做法）
 *
 * 为什么要单独成模块（2026-10-19 用户第 9 条点名"token 是猜的，优先完善"）：
 * 真查一遍发现**同一份内容在三个地方按三种互不相干的系数在数**：
 *  · 预算侧 `chars = tokens × 1.6`（旧 `CHARS_PER_TOKEN_EST`）
 *  · 用量看板兜底 `tokens = chars / 3`（端点没吐 usage 时）
 *  · 记忆服务的 `tokenizer.ts` 是 bge 的 WordPiece —— 它数的是**嵌入模型**的 token，不是对话模型的
 * 中文下这三者能差近 2 倍 ⇒ "预算设成多少就该发多少"根本无从谈起（发多了被服务端 400，发少了用户以为还有空间）。
 *
 * 设计（两遍走，永不假装精确）：
 *  ① **发送前**用"保守上界估算 × 该模型的校准系数"决定装多少 —— 上界的意思是**宁可少发也不超窗**，
 *     因为超一次价的代价（整轮失败 + 用户看到红）远大于少发几条历史。
 *  ② **发送后**拿供应商回传的真实 `usage.prompt_tokens`（OpenAI 兼容端点 / Ollama 的 `prompt_eval_count`）
 *     跟当时那条请求的估算值比对，得到比值 `真实/估算`，按模型维度 EMA 更新校准表。
 *     ⇒ 跑几十轮以后估算会贴近真实；没有 usage 的端点则**一直停留在保守上界**，并如实标 `estimated`。
 *
 * 刻意不做的事：不在这里猜任何供应商的真实分词器（那需要每个模型带一份 vocab，且不同供应商同模型也不同版本）。
 * 我们要的是"预算可控 + 误差可观测 + 误差随使用收敛"，不是"自称精确"。
 */

/** 一个模型维度的校准状态 */
export interface TokenXiaoZhun {
  /** 真实 token / 本模块的保守估算。估算取上界 ⇒ 正常应 ≤1；>1 说明上界取低了，会被限幅并要求重估 */
  biLi: number;
  /** 参与过 EMA 的样本数（0 ⇒ 未校准，纯上界） */
  yangBenShu: number;
  /** 最近一次观测到的相对误差（|真实−估算|/真实），给界面/门禁看"现在还准不准" */
  wuCha?: number;
}

export const WEI_ZHUN: TokenXiaoZhun = { biLi: 1, yangBenShu: 0 };
/** 比值限幅：超出这个区间说明文本形状异常（超长 ASCII、二进制样内容），不让一次坏样本把系数带飞 */
const BI_LIM = { xia: 0.25, shang: 2.5 };
/** EMA 步长：够快收敛，又不会被单轮抖动主导 */
const YI_BA = 0.3;

/** 分脚本计数（用于估算与自检，不对外承诺"这就是 token"） */
export interface WenBenTeZheng { cjk: number; la: number; shu: number; kong: number; biao: number; qi: number }
export function fenTeZheng(wen: string): WenBenTeZheng {
  const z = { cjk: 0, la: 0, shu: 0, kong: 0, biao: 0, qi: 0 } as WenBenTeZheng;
  for (const ch of String(wen || '')) {
    const c = ch.codePointAt(0) || 0;
    if (c >= 0x3040 && c <= 0x9fff || c >= 0xac00 && c <= 0xd7af || c >= 0x3400 && c <= 0x4dbf) z.cjk++;
    else if (c >= 0x41 && c <= 0x5a || c >= 0x61 && c <= 0x7a) z.la++;
    else if (c >= 0x30 && c <= 0x39) z.shu++;
    else if (ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r' || ch === '　') z.kong++;
    else if (c < 0x80) z.biao++;
    else z.qi++;
  }
  return z;
}

/**
 * 每类的系数（**紧上界**：宁高不低，但不许高得离谱）。
 *
 * ⚠️ 第 44 轮后半按**真机回读**重定过一次，理由写在这里免得下一轮又被"保守一点总没错"推回去：
 * 旧系数（CJK 1.0、ASCII 标点 1.0）实测是真实分词的 **1.47–1.55 倍**（本机两条：
 * `上界 34550 / 真实 22204 = 1.55`；`固定+工具 上界 34173 / 真实 23211 = 1.47`）。
 * 后果不是"多留点空位"那么客气 —— 预算 19661 token 的 32K 窗口模型上，固定开销"算出来"就占 20522，
 * **视图额度直接算成 0**，门禁当场红（`verify-r44-token-live`）。过度保守 = 假装装不下 = 真功能受损。
 * 现在按实测除回去（≈×0.75），再叠 1.15 的安全垫，落在"真实值 ×1.1 左右"：既不超窗，也不假装超窗。
 * 剩下的模型差异交给校准（供应商回读是最终裁判），不靠把系数放大来兜。
 *  · CJK：主流 BPE 实测 0.6–0.7 token/字 ⇒ 0.75（仍略高）
 *  · 拉丁词：≈0.24–0.30 ⇒ 0.26
 *  · 数字：分组切，密度高 ⇒ 0.40
 *  · 空白/换行：常与前词合并 ⇒ 0.30
 *  · ASCII 标点：JSON/代码里大量 `":,{}` 会被并成片段 ⇒ 0.50（旧值 1.0 是主要的高估来源）
 *  · 其它（emoji、生僻字、变体选择符）⇒ 1.20（最容易爆，仍给高）
 */
const XI_SHU = { cjk: 0.78, la: 0.30, shu: 0.45, kong: 0.35, biao: 0.60, qi: 1.30 };

/** 保守 token 估算（未校准的上界） */
export function guJiToken(wen: string): number {
  const z = fenTeZheng(wen);
  return Math.ceil(z.cjk * XI_SHU.cjk + z.la * XI_SHU.la + z.shu * XI_SHU.shu
    + z.kong * XI_SHU.kong + z.biao * XI_SHU.biao + z.qi * XI_SHU.qi);
}

/**
 * 校准后的估算：`真实 ≈ 上界 × biLi`，再乘**安全垫**。
 * 垫子基础 1.15（供应商按 chat 模板另加的控制 token + 校准本身的误差）；
 * 这个桶最近误差越大 ⇒ 垫子越厚（最多再 +0.35）：宁可少发（可观测），不许超窗（整轮红）。
 */
export function guJiTokenXiaoZhun(wen: string, zhun?: TokenXiaoZhun | null): number {
  const base = guJiToken(wen);
  const bi = zhun && zhun.yangBenShu > 0 && Number.isFinite(zhun.biLi)
    ? Math.min(BI_LIM.shang, Math.max(BI_LIM.xia, zhun.biLi)) : 1;
  const wu = zhun && Number.isFinite(zhun.wuCha as number) ? Math.max(0, Number(zhun.wuCha) || 0) : 0;
  const dian = 1.15 + Math.min(0.35, wu);
  return Math.ceil(base * bi * dian);
}

/**
 * **密度桶**：同一个模型在"中文密集"和"代码/英文密集"上的 真实token/我们的估算 差别很大
 * （实测口径：中文约 0.6–0.7，代码约 0.9–1.0）。一个模型只存一个比值 ⇒ 中文明显低估、代码明显高估，
 * 来回切换文字形状时永远在追一个追不上的数（第 44 轮 fast 门禁的闭环模拟就是这么红的：24 轮里 7 轮超窗）。
 * ⇒ 校准表按 `模型 / 密度桶` 存，估算与校准用的是**同一份构成**，闭环才闭合。
 * 只看有界前缀（≤4000 字符）⇒ 2M 的一轮里也是 O(1)。
 */
export function miDuTong(wen: string): string {
  const z = [...String(wen || '')];
  if (!z.length) return 'd0';
  const qu = z.length > 4000 ? z.slice(0, 4000).join('') : z.join('');
  const mi = guJiToken(qu) / Math.max(1, [...qu].length);
  // 阈值跟着 XI_SHU 的重定标一起挪：纯代码/JSON ≈0.3–0.45，中英混排 ≈0.45–0.6，中文密集 ≥0.6
  return mi < 0.45 ? 'd1' : mi < 0.60 ? 'd2' : 'd3';
}

/**
 * 用量回读 ⇒ 更新校准。
 * ⚠️ `shangJie` 必须是**未校准的上界**（`guJiToken`），不是"本轮实际放行的量"：
 * 比值是相对上界定义的，拿已放行的数当分母会让系数自我复合，换一次文字形状就再也收敛不了
 * （第 44 轮 fast 门禁的 24 轮闭环模拟就是这么红的）。
 * `wuCha` 记的是**去掉安全垫之后**的残余误差（`|真实 − 上界×比值| / 真实`）：
 * 它只反映"同一个桶里的文字形状有多不稳"，所以拿它调安全垫不会自我放大。
 * 返回新状态（纯函数，不写盘 —— 写盘由主进程做，便于门禁注入）。
 */
export function xinJiXiaoZhun(zhun: TokenXiaoZhun, shangJie: number, zhen: number): TokenXiaoZhun {
  const g = Number(shangJie) || 0;
  const z = Number(zhen) || 0;
  if (g <= 0 || z <= 0) return zhun;
  const raw = z / g;
  if (!Number.isFinite(raw) || raw <= 0) return zhun;
  const bi = Math.min(BI_LIM.shang, Math.max(BI_LIM.xia, raw));
  const xinBi = zhun.yangBenShu > 0 ? zhun.biLi * (1 - YI_BA) + bi * YI_BA : bi;
  return { biLi: xinBi, yangBenShu: zhun.yangBenShu + 1, wuCha: Math.abs(z - g * xinBi) / z };
}

/** 反算：给定 token 预算，该换成多少"字符"喂给只认字符的旧裁剪层（视图渲染层仍以字符为单位工作） */
export function tokenDaoZiFu(tokens: number, wen: string, zhun?: TokenXiaoZhun | null): number {
  const t = Math.max(1, Number(tokens) || 1);
  const z = String(wen || '');
  if (!z.length) return Math.max(1, Math.round(t * 4));
  const guJ = guJiTokenXiaoZhun(z, zhun);
  return Math.max(1, Math.round(z.length * (t / guJ)));
}

/**
 * ── 键、先验与离线重算（第 44 轮后半，用户当场补的口径）──
 * 用户原话要点：①校准必须精确到**某个供应商的某个模型**，只要有一个不同，分词方法就可能不同，不能混；
 * ②一次回读都没有时，也要有**比现在更准**的兜底算法；③已经拿到一些回读后，另做一份**平均 token 算法**
 * 给还没回读的模型用；④把供应商给的 token 计量**记下来**，归档时按这些记录**重算**我们的算法。
 */

/** 校准表的一条观测（供应商报的原始计量，append-only 存盘，归档时用来重算） */
export interface GuanCe { gongYing: string; moXing: string; tong: string; shangJie: number; zhenShi: number }

/** 校准表的键 = `供应商 / 模型 / 密度桶`（三段都在内 ⇒ 换供应商、换模型、换文字形状都不混） */
export function tokenJianTong(gongYing: string, moXing: string, tong: string): string {
  const m = String(moXing || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!m) return '';
  const g = String(gongYing || '').trim().toLowerCase().replace(/\s+/g, '');
  const b = String(tong || '').trim();
  if (!/^d[123]$/.test(b)) return '';
  return `${g || '?'}/${m}/${b}`;
}
/** 从**特征文字**现算桶号并拼键（估算与校准走同一个函数 ⇒ 键不会两边算成两个） */
export function tokenJian(gongYing: string, moXing: string, teZhengWen: string): string {
  return tokenJianTong(gongYing, moXing, miDuTong(teZhengWen));
}
/** 跨模型的平均法条目放在保留前缀下（绝不可能与真实模型键撞） */
export const PING_JUN_QIAN = '@avg/';
export function pingJunTongJian(teZhengWen: string): string { return PING_JUN_QIAN + miDuTong(teZhengWen); }

/**
 * **默认先验**（一次回读都没有时的兜底）。
 * 第 44 轮后半按真机回读重定标之后，本模块的估算本身已经贴近真实（上界/真实 ≈ 1.1–1.2），
 * 所以先验只是"再收一点点"（0.90–0.95），既不假装精确，也不靠放大系数来兜安全。
 * `wuCha: 0` 是刻意的：**先验没有测量到的散布**，不许拿它去加厚安全垫（那等于凭空多留空位）。
 * 真机读数（同一台机器、不同供应商）：中文密集请求 上界 34550 / 真实 22204；
 * 固定+工具 上界 34173 / 真实 23211 ⇒ 重定标后比值回到 ≈0.85–0.9。
 */
export const YAN_XIAN: Record<string, TokenXiaoZhun> = {
  d1: { biLi: 0.95, yangBenShu: 3, wuCha: 0 },
  d2: { biLi: 0.93, yangBenShu: 3, wuCha: 0 },
  d3: { biLi: 0.90, yangBenShu: 3, wuCha: 0 },
};

const JIA_QU = (v: number) => Math.min(BI_LIM.shang, Math.max(BI_LIM.xia, v));

/**
 * 由观测史**离线重算**整张校准表（归档时调用）。
 * · 每个 `供应商/模型/桶`：比值 = 各样本 `真实/上界` 的均值，`wuCha` = 组内的平均残余散布；
 * · `@avg/桶`：该桶内**样本够多（≥3）**的那些模型的均值，`wuCha` 取"最坏模型相对平均的超出比例"
 *   ⇒ 借平均值给没回读过的模型时，安全垫自动覆盖观测到的最坏情况，不会把预算放宽到超窗；
 * · 观测史里没出现的键**原样保留**（历史被截断/换机时不许把已学到的清掉）。
 */
export function zhongSuanXiaoZhun(obs: GuanCe[], jiu: Record<string, TokenXiaoZhun> = {}): Record<string, TokenXiaoZhun> {
  const xin: Record<string, TokenXiaoZhun> = { ...jiu };
  const fenZu = new Map<string, number[]>();
  for (const o of Array.isArray(obs) ? obs : []) {
    const s = Number(o?.shangJie) || 0;
    const z = Number(o?.zhenShi) || 0;
    if (s <= 0 || z <= 0) continue;
    const jian = tokenJianTong(String(o?.gongYing || ''), String(o?.moXing || ''), String(o?.tong || ''));
    if (!jian) continue;
    const Lie = fenZu.get(jian);
    if (Lie) Lie.push(z / s); else fenZu.set(jian, [z / s]);
  }
  for (const [jian, bi] of fenZu) {
    const jun = bi.reduce((a, b) => a + b, 0) / bi.length;
    const san = bi.reduce((a, b) => a + Math.abs(b - jun), 0) / bi.length;
    xin[jian] = { biLi: JIA_QU(jun), yangBenShu: bi.length, wuCha: san };
  }
  const tongNei = new Map<string, number[]>();
  for (const [jian, v] of Object.entries(xin)) {
    if (jian.startsWith(PING_JUN_QIAN)) continue;
    const b = jian.slice(jian.lastIndexOf('/') + 1);
    if (!YAN_XIAN[b] || v.yangBenShu < 3) continue;
    const Lie = tongNei.get(b);
    if (Lie) Lie.push(v.biLi); else tongNei.set(b, [v.biLi]);
  }
  for (const [b, Lie] of tongNei) {
    const jun = Lie.reduce((s, x) => s + x, 0) / Lie.length;
    const zuiHuai = Math.max(...Lie);
    xin[PING_JUN_QIAN + b] = { biLi: JIA_QU(jun), yangBenShu: Lie.length, wuCha: Math.max(0, zuiHuai / (jun || 1) - 1) };
  }
  return xin;
}

/**
 * 查该用哪个系数：①精确命中（同供应商同模型同桶）→ 用它；②该桶的平均法条目 → 用平均值（安全垫已按散布加厚）；
 * ③都没有 → 用**先验**（仍比旧的"万能 1.6"准，且偏保守）。
 * 返回的是副本：先验表是共享常量，不许被调用方写脏。
 */
export function chaXiaoZhun(biao: Record<string, TokenXiaoZhun> | Map<string, TokenXiaoZhun>, gongYing: string, moXing: string, teZhengWen: string): TokenXiaoZhun | null {
  const get = (k: string): TokenXiaoZhun | undefined => (biao instanceof Map ? biao.get(k) : (biao || {})[k]);
  const zhun = get(tokenJian(gongYing, moXing, teZhengWen));
  if (zhun && zhun.yangBenShu > 0) return { ...zhun };
  const b = miDuTong(teZhengWen);
  const pj = get(PING_JUN_QIAN + b);
  if (pj && pj.yangBenShu > 0) return { ...pj };
  const x = YAN_XIAN[b];
  return x ? { ...x } : null;
}

/**
 * 视觉 token 估算（用户第 5 条：图片怎么进预算）。
 * 三家口径 + 未知族保守：
 *  · qwen-vl / mimo-vl 一类 patch 制：⌈w/28⌉×⌈h/28⌉，再夹到 [4, 1280]
 *  · gpt-4o 一类 tile 制：85 + tiles×170
 *  · 未知族：按 patch 制算完再取 1.3 倍余量
 * ⚠️ 字节（8MB 上限）防的是**内存爆**，与这里的 token 是两件事，两条都要守。
 */
export function shiJueToken(kuan: number, gao: number, zu?: string): number {
  const w = Math.max(1, Math.floor(Number(kuan) || 0));
  const h = Math.max(1, Math.floor(Number(gao) || 0));
  if (!w || !h) return 0;
  const xiang = String(zu || '').toLowerCase();
  if (xiang.includes('gpt') || xiang.includes('o4') || xiang.includes('o3')) {
    const tiles = Math.max(1, Math.ceil(w / 512) * Math.ceil(h / 512));
    return 85 + tiles * 170;
  }
  const patch = Math.max(1, Math.ceil(w / 28)) * Math.max(1, Math.ceil(h / 28));
  const base = Math.min(1280, Math.max(4, patch));
  return Math.ceil(xiang ? base : base * 1.3);
}
