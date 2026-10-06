/**
 * **预计完成时间（ETA）** —— 让"是否卡死"的判断有第二根标尺。
 *
 * 产品要求（原话拆解）：
 *  1. 模型每次判断完"是否卡死"，**都要**给出一个预计完成时间；
 *  2. 同一轮任务里多次判断时，模型要能**参考它自己之前写的**预计完成时间；
 *  3. 这些预计完成时间**写进持久配置文件**（进程退出/崩溃都不丢）；
 *  4. 一轮任务**连续 3 次**超出模型自己预计的完成时间 ⇒ 按异常处理（停下并警告）；
 *  5. 存下来的**不是简单一个时间**：要结构丰富到能覆盖各种情况，
 *     并且在使用中**自我完善**（预测越来越准）；
 *  6. 它**原本没有任何预计时间** —— 第一次跑时统计是空的，全靠模型自己给，
 *     随着一轮轮真实结束，同类任务的经验（中位数/高分位/偏移系数/命中率）长出来。
 *
 * 设计要点：
 *  · **两层数据**：
 *      `sessions[sid]` —— 某一轮任务的**当下状态**（模型历次预测、连续超时计数）；
 *      `leiXing[qianMing]` —— 按**任务签名**聚类的**跨会话经验**（越用越准的那部分）。
 *  · **任务签名**只用稳定的、与"工作量"相关的东西：计划步数档、本轮工具集合、是否只说不做、
 *    模型族。签名太细（带具体文件名/时间）就永远复用不上，经验长不起来。
 *  · **绝对时刻 + 相对时长都存**：`etaMs`（还需多久）与 `jieZhiMs`（预计何时完成）。
 *    只存相对量的话，进程重启后就没法判断"是不是已经超了"。
 *  · **自我完善**用"指数滑动平均 + 最近样本分位 + 命中率 + 校准系数"四件套：
 *    模型天生偏乐观（常见 1.2~1.6 倍），校准系数把这个偏差学出来，下一次提问时一并告诉它。
 *  · **绝不用统计替代模型**：统计只作为"参考信息"拼进提问（模型仍是决策者），
 *    统计为空时就不给（`laiYuan: 'model'`），而不是编一个数字出来。
 */
import { anQuanYuanZiXieJson, duJsonWenJian } from './atomic-json.js';

/** 一次预计完成时间（模型给的，或从统计里推的参考值） */
export interface EtaYuCe {
  /** 从"预测那一刻"起，预计还要多久（毫秒） */
  etaMs: number;
  /** 预计完成的**绝对时刻**（epoch ms）—— 重启后可判断是否已超 */
  jieZhiMs: number;
  /** 预测那一刻，本轮任务已经跑了多久（毫秒） */
  yiYongMs: number;
  /** 模型给的一句话依据（为什么是这么久） */
  genJu: string;
  /** 来源：model=模型自己给的；history=统计推算；default=兜底档位 */
  laiYuan: 'model' | 'history' | 'default';
  /** 模型用的模型 id（谁预测的） */
  moXing?: string;
  /** 预测时刻 */
  ts: number;
  /** 这条预测最后**对没对上**：true=在预计时间内完成；null=还没结论（任务还没结束） */
  mingZhong?: boolean | null;
  /** 实际总耗时（任务结束时回填） */
  shiJiMs?: number;
}

/** 一类任务的经验（跨会话复用） */
export interface EtaLeiXing {
  qianMing: string;
  /** 样本数（真的跑完并有结论的轮数） */
  yangBen: number;
  /** 模型预测的滑动平均（ms） */
  yuCeEmaMs: number;
  /** 实际耗时的滑动平均（ms） */
  shiJiEmaMs: number;
  /**
   * **校准系数** = 实际 / 预测 的滑动平均。
   * >1 说明模型一贯偏乐观（说 10 分钟，实际 13 分钟）；提问时把它告诉模型。
   */
  piaoYiXiShu: number;
  /** 分位数（保留最近 `SAN_SHU` 个实际样本） */
  p50Ms: number;
  p90Ms: number;
  /** 落在"自己预测的时间"内的比例（0~1） */
  mingZhongLv: number;
  /** 最近的实际耗时样本（ms，最多 `SAN_SHU` 个） */
  yangBenWei: number[];
  /** 样例：最近几条完整记录（预测/实际/依据），让排查看得见 */
  liZi: Array<{ ts: number; yuCeMs: number; shiJiMs: number; mingZhong: boolean; moXing?: string }>;
  gengXinTs: number;
}

/** 某一轮任务的当下状态 */
export interface EtaHuiHua {
  sessionId: string;
  /** 这一轮任务从什么时候开始 */
  kaiShi: number;
  /**
   * 这一轮**第一次预测时**定下的任务签名（之后一直用它）。
   * 为什么要在轮内锁定：签名里含"本轮用到的工具"，跑完再看会多出几个工具 ⇒
   * 换个签名桶，学习样本就跟它当初参考的经验对不上了。
   */
  qianMing: string;
  /** 模型**上一次**写的预计完成时间（提问时给它参考） */
  shangCi: EtaYuCe | null;
  /** 本轮它写过的全部预测（从早到晚，最多 `LUN_CI_SHANG_XIAN` 条） */
  liCi: EtaYuCe[];
  /** **连续**超时次数（连续 3 次 ⇒ 当异常处理） */
  lianXuChaoShi: number;
  /** 历史上最多连续超了几次（观测用） */
  zuiChangLianXu: number;
  /** 已经产出过几个样本 */
  yangBen: number;
  gengXinTs: number;
}

export interface EtaKu {
  version: 1;
  shouCiTs: number;
  gengXinTs: number;
  quanJu: {
    yangBen: number;
    piaoYiXiShu: number;
    mingZhongLv: number;
    /** 全局"乐观程度"的中位（新类型没有样本时可借它做参考） */
    yuCeEmaMs: number;
    shiJiEmaMs: number;
  };
  /** 任务签名 → 经验 */
  leiXing: Record<string, EtaLeiXing>;
  /** 会话 → 本轮状态 */
  huiHua: Record<string, EtaHuiHua>;
}

export const LUN_CI_SHANG_XIAN = 60;   // 单轮最多记 60 条预测（长跑会一直加）
export const SAN_SHU = 40;             // 每类任务保留最近 40 个样本算分位
export const LI_ZI_SHANG_XIAN = 12;    // 每类任务保留最近 12 条完整样例
export const CHAO_SHI_LIAN_XU_XIAN = 3; // 连续超时几次算异常（产品定稿：3）
/** 单次预测的可接受范围：10 秒 ~ 24 小时（离谱值不当真，如实标注截断） */
export const ETA_ZUI_XIAO_MS = 10 * 1000;
export const ETA_ZUI_DA_MS = 24 * 60 * 60 * 1000;

function kong(t: number): EtaKu {
  return {
    version: 1,
    shouCiTs: t,
    gengXinTs: t,
    quanJu: { yangBen: 0, piaoYiXiShu: 1, mingZhongLv: 0, yuCeEmaMs: 0, shiJiEmaMs: 0 },
    leiXing: {},
    huiHua: {},
  };
}

function youXian(v: unknown, huiTui = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : huiTui;
}

function pos(v: unknown): number {
  const n = youXian(v, 0);
  return n > 0 ? n : 0;
}

/** 分位（样本已排序或未排序都行；空样本返回 0） */
export function fenWei(yang: number[], p: number): number {
  const a = (yang || []).filter((x) => Number.isFinite(x) && x > 0).slice().sort((x, y) => x - y);
  if (!a.length) return 0;
  const i = Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * p)));
  return Math.round(a[i] as number);
}

/** 指数滑动平均：新样本权重 alpha（默认 0.35 —— 既记得历史，也跟得上变化）。**毫秒量级**用，取整。 */
export function ema(jiu: number, xin: number, alpha = 0.35): number {
  if (!(jiu > 0)) return xin;
  return Math.round(jiu * (1 - alpha) + xin * alpha);
}

/**
 * 同一套滑动平均，但**保留小数**。
 * ⚠️ 真事故（本门禁抓到的）：偏移系数是 1~5 这种小量级，用取整版 ema 会把它**永远压在 1**
 * （1×0.65 + 1.6×0.35 = 1.21 → round → 1）⇒ "模型偏乐观"这个信息学不出来，
 * 提问里对模型的纠偏提示就成了废话。
 */
export function emaXiShu(jiu: number, xin: number, alpha = 0.35): number {
  if (!(jiu > 0)) return Number(xin.toFixed(4));
  return Number((jiu * (1 - alpha) + xin * alpha).toFixed(4));
}

/**
 * **任务签名**（聚类键）：只用稳定的、与工作量相关的特征。
 * 例：`步数=5|工具集=read_file,write_file|只说不做|模型族=mimo`
 */
export function renWuQianMing(p: {
  buShu?: number;
  gongJuMing?: string[];
  zhiShuoBuZuo?: boolean;
  moXing?: string;
}): string {
  const bu = Math.max(0, Math.floor(youXian(p.buShu, 0)));
  // 步数分档（1-3 / 4-8 / 9-20 / 21+）：太细就永远聚不到一起
  const dang = bu === 0 ? '0' : bu <= 3 ? '1-3' : bu <= 8 ? '4-8' : bu <= 20 ? '9-20' : '21+';
  const gj = [...new Set((p.gongJuMing || []).map((x) => String(x || '').trim()).filter(Boolean))].sort().slice(0, 8).join(',') || 'none';
  const mo = moXingZu(p.moXing);
  return `步数=${dang}|工具=${gj}${p.zhiShuoBuZuo ? '|只说不做' : ''}${mo ? '|模型=' + mo : ''}`;
}

/** 模型族：去掉版本号/日期尾巴，避免"同一个模型每次签名都不同" */
export function moXingZu(mo?: string): string {
  const s = String(mo || '').trim().toLowerCase();
  if (!s) return '';
  return s.replace(/[-_ ]?(v?\d+(\.\d+)*|20\d{2}[-.]?\d{2}([-.]?\d{2})?)$/i, '').slice(0, 32);
}

/** 把模型的取值夹到可用范围（返回 ms；无效值返回 null） */
export function jiaEtaMiao(miao: unknown): number | null {
  const s = youXian(miao, 0);
  if (!(s > 0)) return null;
  const ms = Math.round(s * 1000);
  return Math.min(ETA_ZUI_DA_MS, Math.max(ETA_ZUI_XIAO_MS, ms));
}

/** 人话时长：`2 小时 5 分` / `45 秒`（界面与日志共用，避免各处各写一份） */
export function shuoShiChang(ms: number): string {
  const s = Math.max(0, Math.round(youXian(ms, 0) / 1000));
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分 ${s % 60} 秒`;
  const h = Math.floor(m / 60);
  return `${h} 小时 ${m % 60} 分`;
}

/**
 * **预计完成时间的账本**（持久化在 `userData/eta.json`）。
 * 纯逻辑 + 注入文件路径 ⇒ 可以直接被门禁驱动，不需要起 Electron。
 */
export class EtaZhangBen {
  private ku: EtaKu;
  private jieDian: string | null;
  /** 落盘节流：同一秒内的多次更新合并成一次写盘 */
  private xiePai: ReturnType<typeof setTimeout> | null = null;

  constructor(file?: string | null, now = Date.now()) {
    this.jieDian = file ? String(file) : null;
    this.ku = this.jieDian ? duJsonWenJian<EtaKu | null>(this.jieDian, null) as EtaKu : kong(now);
    if (!this.ku || this.ku.version !== 1 || !this.ku.leiXing || !this.ku.huiHua) this.ku = kong(now);
  }

  /** 快照（给界面/门禁看，深拷贝，别让外面改到内部） */
  kuaiZhao(): EtaKu {
    return JSON.parse(JSON.stringify(this.ku)) as EtaKu;
  }

  /** 某类任务的经验（没有就返回 null —— 绝不编一个出来） */
  jingYan(qianMing: string): EtaLeiXing | null {
    const l = this.ku.leiXing[String(qianMing || '')];
    return l && l.yangBen > 0 ? l : null;
  }

  /** 某一轮任务的当下状态（没有就返回 null） */
  huiHua(sessionId: string): EtaHuiHua | null {
    return this.ku.huiHua[String(sessionId || '')] || null;
  }

  /** 一轮任务开始：开一本新账（同一会话重复调用不重置，避免递归续派把状态洗掉） */
  kaiShiLun(sessionId: string, now = Date.now(), qianMing?: string): EtaHuiHua {
    const sid = String(sessionId || '');
    let h = this.ku.huiHua[sid];
    if (!h) {
      h = { sessionId: sid, kaiShi: now, qianMing: String(qianMing || ''), shangCi: null, liCi: [], lianXuChaoShi: 0, zuiChangLianXu: 0, yangBen: 0, gengXinTs: now };
      this.ku.huiHua[sid] = h;
      this.paiXie(now);
    } else if (qianMing && !h.qianMing) {
      h.qianMing = String(qianMing);
      this.paiXie(now);
    }
    return h;
  }

  /** 一轮任务收尾（正常结束/用户介入）：把当下状态清掉，但**经验留在 leiXing 里** */
  jieShuLun(sessionId: string): void {
    const sid = String(sessionId || '');
    if (this.ku.huiHua[sid]) {
      delete this.ku.huiHua[sid];
      this.paiXie(Date.now());
    }
  }

  /**
   * 判断"模型上次给的预计完成时间，这次**超了没有**"。
   * 返回 `null` = 本轮还没有上一次预测（第一次判，谈不上超时）。
   * 连续 3 次 ⇒ `yiChang = true`（调用方按异常处理）。
   */
  panChaoShi(sessionId: string, now = Date.now()): { chaoShi: boolean | null; lianXu: number; yiChang: boolean; shangCi: EtaYuCe | null } {
    const h = this.ku.huiHua[String(sessionId || '')];
    if (!h || !h.shangCi) return { chaoShi: null, lianXu: h ? h.lianXuChaoShi : 0, yiChang: false, shangCi: h ? h.shangCi : null };
    const chaoShi = now > h.shangCi.jieZhiMs;
    h.lianXuChaoShi = chaoShi ? h.lianXuChaoShi + 1 : 0;
    h.zuiChangLianXu = Math.max(h.zuiChangLianXu, h.lianXuChaoShi);
    h.gengXinTs = now;
    this.ku.huiHua[h.sessionId] = h;
    this.paiXie(now);
    return { chaoShi, lianXu: h.lianXuChaoShi, yiChang: h.lianXuChaoShi >= CHAO_SHI_LIAN_XU_XIAN, shangCi: h.shangCi };
  }

  /** 记下模型这次给的预计完成时间（写进持久账本） */
  jiYuCe(sessionId: string, yu: { etaMs: number; genJu?: string; laiYuan?: EtaYuCe['laiYuan']; moXing?: string }, now = Date.now(), qianMing?: string): EtaYuCe {
    const h = this.kaiShiLun(sessionId, now, qianMing);
    const rec: EtaYuCe = {
      etaMs: Math.min(ETA_ZUI_DA_MS, Math.max(ETA_ZUI_XIAO_MS, Math.round(youXian(yu.etaMs, ETA_ZUI_XIAO_MS)))),
      jieZhiMs: now + Math.min(ETA_ZUI_DA_MS, Math.max(ETA_ZUI_XIAO_MS, Math.round(youXian(yu.etaMs, ETA_ZUI_XIAO_MS)))),
      yiYongMs: Math.max(0, now - h.kaiShi),
      genJu: String(yu.genJu || '').slice(0, 300),
      laiYuan: yu.laiYuan || 'model',
      moXing: yu.moXing ? String(yu.moXing).slice(0, 80) : undefined,
      ts: now,
      mingZhong: null,
    };
    h.shangCi = rec;
    h.liCi.push(rec);
    if (h.liCi.length > LUN_CI_SHANG_XIAN) h.liCi.splice(0, h.liCi.length - LUN_CI_SHANG_XIAN);
    h.gengXinTs = now;
    this.ku.huiHua[h.sessionId] = h;
    this.paiXie(now, true);   // 预计完成时间是这一轮的产出：立刻落盘
    return rec;
  }

  /**
   * **给模型的参考信息**（拼进提问的文本）。
   *
   * 三块：① 它自己本轮历次预测（含"超了没/结果如何"）；② 同类任务的经验统计；
   * ③ 全局乐观程度。**统计为空就明说"还没有历史"**，不编数字。
   */
  canKaoWenBen(sessionId: string, qianMing: string, now = Date.now()): string {
    const hang: string[] = [];
    const h = this.ku.huiHua[String(sessionId || '')];
    if (h && h.liCi.length) {
      const li = h.liCi.slice(-6);
      hang.push(`【你本轮已经写过 ${h.liCi.length} 次预计完成时间（最记 6 条）】`);
      for (const y of li) {
        const zhuang = y.mingZhong === true ? '结果：在预计时间内完成'
          : y.mingZhong === false ? '结果：超了'
            : (now > y.jieZhiMs ? `结果：**已经超出** ${shuoShiChang(now - y.jieZhiMs)}（还没完成）` : `结果：还没到点（还剩 ${shuoShiChang(y.jieZhiMs - now)}）`);
        hang.push(`· 已跑 ${shuoShiChang(y.yiYongMs)} 时说"还需 ${shuoShiChang(y.etaMs)}"${y.genJu ? `（依据：${y.genJu}）` : ''} → ${zhuang}`);
      }
      if (h.lianXuChaoShi > 0) hang.push(`⚠️ 你已经**连续 ${h.lianXuChaoShi} 次**超出自己写的预计完成时间（连续 ${CHAO_SHI_LIAN_XU_XIAN} 次即按异常处理）。`);
    }
    const jing = this.jingYan(qianMing);
    if (jing) {
      hang.push(`【同类任务的经验（${jing.yangBen} 次真实记录）】实际耗时中位数 ${shuoShiChang(jing.p50Ms)}，90 分位 ${shuoShiChang(jing.p90Ms)}；`
        + `历史预测命中率 ${Math.round(jing.mingZhongLv * 100)}%；模型一向偏${jing.piaoYiXiShu >= 1 ? '乐观' : '保守'}（实际/预测 ≈ ${jing.piaoYiXiShu.toFixed(2)}）。`);
    } else {
      hang.push('【同类任务的经验】还没有历史记录（这是第一次），你只能靠自己判断 —— 请给**偏保守**的估计。');
    }
    if (this.ku.quanJu.yangBen > 0 && (!jing || jing.yangBen < 3)) {
      hang.push(`【全局】本机所有任务平均"实际/预测" ≈ ${this.ku.quanJu.piaoYiXiShu.toFixed(2)}（${this.ku.quanJu.yangBen} 次样本）。`);
    }
    return hang.join('\n');
  }

  /**
   * **一轮任务真的结束了** ⇒ 把"最后一次预测 vs 实际总耗时"作为一个样本，自我完善。
   * 这是"越用越准"的唯一入口：只有真有结论的轮次才进统计（没结论的不污染经验）。
   */
  xueXi(sessionId: string, p: { shiJiMs?: number; qianMing?: string; now?: number }): { xueLe: boolean; qianMing: string; shiJiMs: number; mingZhong: boolean | null } {
    const now = p.now ?? Date.now();
    const sid = String(sessionId || '');
    const h = this.ku.huiHua[sid];
    if (!h || !h.shangCi) return { xueLe: false, qianMing: '', shiJiMs: 0, mingZhong: null };
    const shiJi = Math.max(1000, Math.round(youXian(p.shiJiMs, now - h.kaiShi)));
    const qian = String(p.qianMing || h.qianMing || '未分类');
    const yu = h.shangCi;
    const mingZhong = shiJi <= yu.etaMs;
    // 回填这一条预测的结论（历次预测里最后一条）
    const la = h.liCi[h.liCi.length - 1];
    if (la && la.ts === yu.ts) { la.mingZhong = mingZhong; la.shiJiMs = shiJi; }
    h.yangBen += 1;

    const l = this.ku.leiXing[qian] || {
      qianMing: qian, yangBen: 0, yuCeEmaMs: 0, shiJiEmaMs: 0, piaoYiXiShu: 1,
      p50Ms: 0, p90Ms: 0, mingZhongLv: 0, yangBenWei: [], liZi: [], gengXinTs: now,
    };
    l.yangBen += 1;
    l.yuCeEmaMs = ema(l.yuCeEmaMs, yu.etaMs);
    l.shiJiEmaMs = ema(l.shiJiEmaMs, shiJi);
    const bi = yu.etaMs > 0 ? shiJi / yu.etaMs : 1;
    l.piaoYiXiShu = emaXiShu(l.piaoYiXiShu, Math.min(20, Math.max(0.05, bi)));
    l.yangBenWei.push(shiJi);
    if (l.yangBenWei.length > SAN_SHU) l.yangBenWei.splice(0, l.yangBenWei.length - SAN_SHU);
    l.p50Ms = fenWei(l.yangBenWei, 0.5);
    l.p90Ms = fenWei(l.yangBenWei, 0.9);
    // 命中率用滑动平均（避免"前 3 次全错"把后来的好预测压死）
    l.mingZhongLv = Number((l.mingZhongLv > 0 || l.yangBen > 1 ? l.mingZhongLv * 0.7 + (mingZhong ? 0.3 : 0) : (mingZhong ? 1 : 0)).toFixed(3));
    l.liZi.push({ ts: now, yuCeMs: yu.etaMs, shiJiMs: shiJi, mingZhong, moXing: yu.moXing });
    if (l.liZi.length > LI_ZI_SHANG_XIAN) l.liZi.splice(0, l.liZi.length - LI_ZI_SHANG_XIAN);
    l.gengXinTs = now;
    this.ku.leiXing[qian] = l;

    const q = this.ku.quanJu;
    q.yangBen += 1;
    q.yuCeEmaMs = ema(q.yuCeEmaMs, yu.etaMs);
    q.shiJiEmaMs = ema(q.shiJiEmaMs, shiJi);
    q.piaoYiXiShu = emaXiShu(q.piaoYiXiShu, Math.min(20, Math.max(0.05, bi)));
    q.mingZhongLv = Number(((q.mingZhongLv > 0 || q.yangBen > 1 ? q.mingZhongLv * 0.7 + (mingZhong ? 0.3 : 0) : (mingZhong ? 1 : 0))).toFixed(3));

    this.ku.huiHua[sid] = h;
    this.ku.gengXinTs = now;
    this.paiXie(now, true);   // 学到的经验是"越用越准"的本钱：立刻落盘
    return { xueLe: true, qianMing: qian, shiJiMs: shiJi, mingZhong };
  }

  /** 立刻落盘（进程退出前调用，别把节流里的那次丢掉） */
  baCun(): void {
    if (this.xiePai) { try { clearTimeout(this.xiePai); } catch { /* noop */ } this.xiePai = null; }
    if (!this.jieDian) return;
    try { anQuanYuanZiXieJson(this.jieDian, this.ku); } catch { /* 落盘失败不影响本次运行 */ }
  }

  private paiXie(now: number, liJi = false): void {
    this.ku.gengXinTs = now;
    if (!this.jieDian) return;
    // "预计完成时间"和"学习样本"都是这一轮的**产出**：立刻落盘，别赌 1.2 秒内不崩
    if (liJi) { this.baCun(); return; }
    if (this.xiePai) return;
    this.xiePai = setTimeout(() => { this.xiePai = null; this.baCun(); }, 1200);
    // 定时器不该把进程拽住（Node/Electron 里 unref 存在就用）
    try { (this.xiePai as unknown as { unref?: () => void }).unref?.(); } catch { /* noop */ }
  }
}
