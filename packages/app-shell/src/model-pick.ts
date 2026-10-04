/**
 * model-pick —— 「智能选模型」的**真实**决策器（纯函数，可无头断言）。
 *
 * 实测缺陷（本轮修）：界面上「智能选择」是个**空壳** ——
 *   · 选了「智能」时 `defaultModel` 存成空串；
 *   · 发消息时实际用的是 `xiaoXi.model || providerCfg.model`（= 当前供应商的模型）；
 *   · `pickModelForUrgency` 被 import 了却**从未调用**。
 * 也就是说：以前「智能」= 随便拿当前供应商的模型，跟"智能"没关系。
 *
 * 现在的决策顺序（产品语义）：
 *   1. 显式指定了模型（消息里带 model）→ 用它；
 *   2. 牛马的「默认模型」不是「智能」→ 用它（但必须是**启用**中的模型）；
 *   3. 「智能」→ 按**模型调用链 + 紧急度**挑：
 *        P0/P1（要强）→ 调用链第 1 个启用模型
 *        P2（默认）  → 调用链第 2 个（没有则第 1 个）
 *        P3（省着用）→ 调用链最后 1 个（没有则第 1 个）
 *      被「禁用」的模型**绝不会**被选中；
 *   4. 调用链为空 → 交给角色模型表（duty/executor/summary，见 model-roles）；
 *   5. 还没有 → 兜底模型。
 *
 * 不变量：**永不返回被禁用的模型**；任何输入不抛错。
 */

export type JinjiduJibie = 'P0' | 'P1' | 'P2' | 'P3';

export interface MoXingJueCeShuRu {
  /** 消息里显式指定的模型（最高优先） */
  explicit?: string;
  /** 牛马的默认模型；`__smart__` 或空串 = 智能 */
  defaultModel?: string;
  /** 模型调用链（顺序即优先级） */
  chain?: string[];
  /** 被禁用的模型（绝不选中） */
  chainDisabled?: string[];
  /** 紧急度 */
  urgency?: JinjiduJibie | string;
  /** 角色模型表（duty/executor/summary）—— 调用链为空时用 */
  roles?: { duty?: string; executor?: string; summary?: string };
  /** 最终兜底 */
  fallback?: string;
  /**
   * **真实存在的模型**（所有供应商的 models 合集）。
   * 真事故：以前"智能"会落到一个**不存在**的模型上（或某个空供应商的默认值），
   * 一调用就报错。现在只从这份清单里挑 —— 挑出来的一定跑得起来。
   */
  keYongMoXing?: string[];
  /** 本轮失败后要跳过的模型（自动降级用） */
  tiaoGuo?: string[];
}

export interface MoXingJueCeJieGuo {
  model: string;
  /** 决策依据（审计/可观测用；不是给用户看的文案） */
  why: 'explicit' | 'default' | 'chain-p0p1' | 'chain-p2' | 'chain-p3' | 'chain-fallback' | 'role-duty' | 'role-executor' | 'role-summary' | 'fallback' | 'fallback-disabled';
  /** 「智能」路径下的真实决策点：这次选中的是调用链第几个（0 起）；非智能为 -1 */
  chainIndex: number;
}

const isSmart = (v: unknown) => !v || v === '__smart__';

/**
 * 「供应商名 · 模型名」是**界面展示**用的复合标签（管理模型里区分同名模型），
 * 发给 API 的必须是**纯模型 id** —— 实测把复合串发出去会直接 HTTP 400
 * （`you passed DeepSeek · deepseek-flash`）。
 * 统一在发送/决策边界剥掉前缀，历史里已存的复合串也能被吃掉。
 */
export function jieMoXingMing(ming: string | undefined | null): string {
  const s = String(ming || '').trim();
  if (!s) return '';
  const i = s.lastIndexOf(' · ');
  return i >= 0 ? s.slice(i + 3).trim() : s;
}

/** 启用中的调用链（去掉禁用、去空、去重，保序） */
export function qiYongLian(chain?: string[], disabled?: string[]): string[] {
  const off = new Set((disabled || []).map((s) => String(s)));
  const out: string[] = [];
  for (const m of chain || []) {
    const s = String(m || '').trim();
    if (!s || off.has(s) || out.includes(s)) continue;
    out.push(s);
  }
  return out;
}

/**
 * 「智能」在给定紧急度下挑调用链的第几个。
 * 返回 -1 表示链条里没有可用项（调用方继续走角色表/兜底）。
 */
export function zhiNengTiaoLian(chain: string[], urgency?: string): number {
  const n = chain.length;
  if (n === 0) return -1;
  const u = String(urgency || 'P2');
  if (u === 'P0' || u === 'P1') return 0;           // 要最强 ⇒ 链头
  if (u === 'P2') return n > 1 ? 1 : 0;             // 默认 ⇒ 第二个，没有就第一个
  return n - 1;                                     // P3 ⇒ 链尾（最省）
}

/** 决策入口：任何输入都不抛错。**返回的 model 一定是纯模型 id**（复合展示标签会被剥掉） */
export function jueCeMoXing(shuRu: MoXingJueCeShuRu = {}): MoXingJueCeJieGuo {
  const fallback = jieMoXingMing(shuRu.fallback || 'deepseek-chat') || 'deepseek-chat';
  /**
   * 本轮失败要跳过的（自动降级用）——**先算出来**，显式/默认也要尊重它：
   * 真事故：显式模型失败后下一轮还返回同一个显式模型 ⇒ 只试 1 次就断，
   * 调用链后面的模型根本没轮到（用户要求：整条链都得试完）。
   */
  const tiaoGuo = new Set((shuRu.tiaoGuo || []).map((m) => jieMoXingMing(m)));
  const explicit = String(shuRu.explicit || '').trim();
  if (explicit && !tiaoGuo.has(jieMoXingMing(explicit))) {
    return { model: jieMoXingMing(explicit), why: 'explicit', chainIndex: -1 };
  }

  const disabled = (shuRu.chainDisabled || []).map((s) => String(s));
  /** 禁用名单里存的可能是复合展示标签，判"是否被禁用"一律按纯模型 id 比对 */
  const beiJinYong = (m: string) => disabled.some((d) => jieMoXingMing(d) === jieMoXingMing(m));
  /**
   * **真实存在**过滤：只允许挑"供应商里真有的模型"。
   * 真事故：以前"智能"会落到一个不存在的模型上，一调用就报错。
   */
  const keYong = (shuRu.keYongMoXing || []).map((m) => jieMoXingMing(m)).filter(Boolean);
  const zaiQingDan = (m: string) => {
    const s = jieMoXingMing(m);
    return !s ? false : (keYong.length === 0 || keYong.includes(s));
  };
  const keYongQie = (m: string) => zaiQingDan(m) && !beiJinYong(m) && !tiaoGuo.has(jieMoXingMing(m));
  const dm = String(shuRu.defaultModel || '');
  /** 已经在降级（本轮有失败过的模型）⇒ 后续按**调用链原顺序**依次试完，不再按紧急度跳着挑 */
  const zaiJiangJi = tiaoGuo.size > 0;

  // 2) 显式默认模型（非「智能」）：必须不在禁用名单里、且真的存在
  if (!isSmart(dm)) {
    const d = dm.trim();
    if (d && keYongQie(d)) return { model: jieMoXingMing(d), why: 'default', chainIndex: -1 };
    // 显式默认不可用（被禁/不存在/本轮已失败）⇒ 顺着降级继续往下挑，不当场报错
  }

  // 3) 「智能」→ 调用链 + 紧急度（只从**存在且启用**的里挑）
  //    首次按紧急度挑；**降级中按链原顺序**取下一个没试过的（把整条链跑完）
  const lianQuan = qiYongLian(shuRu.chain, disabled).filter((m) => zaiQingDan(m));
  const lian = lianQuan.filter((m) => !tiaoGuo.has(jieMoXingMing(m)));
  if (lian.length) {
    let mo: string;
    let idx: number;
    if (zaiJiangJi) {
      // 降级：按链顺序取第一个还没失败的
      idx = 0;
      mo = String(lian[0] ?? '');
    } else {
      idx = zhiNengTiaoLian(lian, shuRu.urgency);
      mo = String(lian[Math.max(0, idx)] ?? '');
    }
    if (mo) {
      const why = zaiJiangJi
        ? 'chain-fallback'
        : (shuRu.urgency === 'P0' || shuRu.urgency === 'P1')
          ? 'chain-p0p1'
          : (shuRu.urgency === 'P2' ? 'chain-p2' : 'chain-p3');
      return { model: jieMoXingMing(mo), why, chainIndex: Math.max(0, idx) };
    }
  }
  // 3b) 调用链里没剩下可用的 ⇒ 退回**任何**真实存在的启用模型（自动降级的落点）
  if (lian.length === 0) {
    const sheng = keYong.filter((m) => keYongQie(m));
    if (sheng.length) {
      // 降级中按清单顺序试完；首次仍按紧急度
      const i2 = zaiJiangJi ? 0 : zhiNengTiaoLian(sheng, shuRu.urgency);
      const mo2 = sheng[Math.max(0, i2)] ?? sheng[0] ?? '';
      return { model: jieMoXingMing(mo2), why: 'chain-fallback', chainIndex: Math.max(0, i2) };
    }
  }

  // 4) 角色表（同样不许选被禁用的/不存在的/已失败的）
  const r = shuRu.roles || {};
  const u = String(shuRu.urgency || 'P2');
  const houXuan = (u === 'P0' || u === 'P1')
    ? [r.duty]
    : u === 'P2'
      ? [r.executor, r.duty]
      : [r.summary, r.duty];
  for (const c of houXuan) {
    const m = String(c || '').trim();
    if (m && keYongQie(m)) return { model: jieMoXingMing(m), why: (u === 'P2' ? 'role-executor' : u === 'P3' ? 'role-summary' : 'role-duty'), chainIndex: -1 };
  }

  // 5) 兜底：若兜底本身不可用，但清单里还有别的可用项 ⇒ 用别的（**宁可降级也不报错**）
  if (!keYongQie(fallback)) {
    const sheng = keYong.filter((m) => keYongQie(m));
    if (sheng.length) return { model: jieMoXingMing(sheng[0]!), why: 'chain-fallback', chainIndex: 0 };
  }
  //    真没有任何可用项 ⇒ 仍返回兜底（否则这一轮没法对话），但如实标注
  if (disabled.some((d) => jieMoXingMing(d) === fallback)) {
    return { model: fallback, why: 'fallback-disabled', chainIndex: -1 };
  }
  return { model: fallback, why: 'fallback', chainIndex: -1 };
}
