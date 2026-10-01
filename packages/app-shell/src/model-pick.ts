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
}

export interface MoXingJueCeJieGuo {
  model: string;
  /** 决策依据（审计/可观测用；不是给用户看的文案） */
  why: 'explicit' | 'default' | 'chain-p0p1' | 'chain-p2' | 'chain-p3' | 'role-duty' | 'role-executor' | 'role-summary' | 'fallback' | 'fallback-disabled';
  /** 「智能」路径下的真实决策点：这次选中的是调用链第几个（0 起）；非智能为 -1 */
  chainIndex: number;
}

const isSmart = (v: unknown) => !v || v === '__smart__';

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

/** 决策入口：任何输入都不抛错 */
export function jueCeMoXing(shuRu: MoXingJueCeShuRu = {}): MoXingJueCeJieGuo {
  const fallback = String(shuRu.fallback || 'deepseek-chat');
  const explicit = String(shuRu.explicit || '').trim();
  if (explicit) return { model: explicit, why: 'explicit', chainIndex: -1 };

  const disabled = (shuRu.chainDisabled || []).map((s) => String(s));
  const dm = String(shuRu.defaultModel || '');

  // 2) 显式默认模型（非「智能」）：必须不在禁用名单里
  if (!isSmart(dm)) {
    const d = dm.trim();
    if (d && !disabled.includes(d)) return { model: d, why: 'default', chainIndex: -1 };
  }

  // 3) 「智能」→ 调用链 + 紧急度
  const lian = qiYongLian(shuRu.chain, disabled);
  const idx = zhiNengTiaoLian(lian, shuRu.urgency);
  if (idx >= 0) {
    const why = (shuRu.urgency === 'P0' || shuRu.urgency === 'P1')
      ? 'chain-p0p1'
      : (shuRu.urgency === 'P2' ? 'chain-p2' : 'chain-p3');
    const mo = String(lian[idx] ?? '');
    return { model: mo, why, chainIndex: idx };
  }

  // 4) 角色表（同样不许选被禁用的）
  const r = shuRu.roles || {};
  const u = String(shuRu.urgency || 'P2');
  const keYong = (m?: string) => {
    const s = String(m || '').trim();
    return s && !disabled.includes(s) ? s : '';
  };
  const houXuan = (u === 'P0' || u === 'P1')
    ? [r.duty]
    : u === 'P2'
      ? [r.executor, r.duty]
      : [r.summary, r.duty];
  for (const c of houXuan) {
    const m = keYong(c);
    if (m) return { model: m, why: (u === 'P2' ? 'role-executor' : u === 'P3' ? 'role-summary' : 'role-duty'), chainIndex: -1 };
  }

  // 5) 兜底：若兜底本身被禁用，且角色表里也没有可用项 ——
  //    **仍然返回兜底**（否则这一轮没法对话），但如实标注 why='fallback-disabled'，
  //    调用方可据此提示用户「这个模型被禁用了，但没有别的可选」。
  if (disabled.includes(fallback)) {
    return { model: fallback, why: 'fallback-disabled', chainIndex: -1 };
  }
  return { model: fallback, why: 'fallback', chainIndex: -1 };
}
