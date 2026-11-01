/**
 * model-pick —— 牛马模型路由（纯函数，可无头断言）。
 *
 * 第 99 轮用户口径：
 *   · 调用链勾选「智能模式」⇒ 综合**难易（1-5）**与**急缓（1-5）**挑链位：
 *       难 ⇒ 更强模型；急 ⇒ 更快/云端模型；两者冲突时**难易优先**（不能为了快把难题交给弱模型）。
 *   · 没勾选 ⇒ 默认模型优先，失败后**严格按调用链顺序**逐个试（急缓不影响链位）。
 *   · 单聊/项目都一样：模型只能来自该牛马自己的调用链；值班者不能指定模型。
 *
 * 决策顺序：
 *   1. 消息显式指定了模型（用户手动选）→ 用它；
 *   2. 智能模式：在调用链内按 `nan`/`ji` 打分选一个；不把默认模型当硬指定；
 *   3. 非智能：牛马默认模型优先；默认不行后从链头开始严格按顺序逐个试
 *      （跳过禁用、不存在、本轮已失败）；
 *   4. 链为空/都不可用 → 角色表（固定 duty → executor → summary）；
 *   5. 仍没有 → 任意真实可用模型 → 兜底。
 *
 * 不变量：**永不返回被禁用的模型**；任何输入不抛错；返回的 model 一定是纯模型 id。
 */
import { guSuanMoXingQiangDu, guSuanMoXingSuDu } from './mo-xing-qiang-du.js';

export type JinjiduJibie = 'P0' | 'P1' | 'P2' | 'P3' | 'P4';

export interface MoXingJueCeShuRu {
  /** 消息里显式指定的模型（最高优先） */
  explicit?: string;
  /** 牛马的默认模型；`__smart__` 或空串 = 按调用链顺序 */
  defaultModel?: string;
  /** 模型调用链（顺序即优先级） */
  chain?: string[];
  /** 被禁用的模型（绝不选中） */
  chainDisabled?: string[];
  /**
   * 牛马管理局「调用链 → 智能模式」勾选状态。
   * true = 按任务难易度的 modelTier 挑链位；false = 严格按调用链顺序。
   * 不传时兼容旧语义：默认模型为空/`__smart__` 视为智能。
   */
  smartMode?: boolean;
  /** 难易度分类器给的模型档（smartMode=true 时用；不传按 mid） */
  modelTier?: 'high' | 'mid' | 'low';
  /** 五级难易（1 极易 … 5 很难）；给了就优先用它，比 modelTier 细 */
  nan?: number;
  /** 五级急缓（1 极缓 … 5 很急）；智能模式下急 ⇒ 更快/云端 */
  ji?: number;
  /** @deprecated 第 98 轮起模型选型不再看 P 档；保留字段只为兼容旧调用方 */
  urgency?: JinjiduJibie | string;
  /** 角色模型表（duty/executor/summary）—— 调用链为空时按固定顺序用 */
  roles?: { duty?: string; executor?: string; summary?: string };
  /** 最终兜底 */
  fallback?: string;
  /** **真实存在的模型**（所有供应商的 models 合集） */
  keYongMoXing?: string[];
  /** 本地/免费模型（智能模式 low 档优先选它们；非智能模式忽略） */
  benDiMoXing?: string[];
  /** 本轮失败后要跳过的模型（自动降级用） */
  tiaoGuo?: string[];
}

export interface MoXingJueCeJieGuo {
  model: string;
  /** 决策依据（审计/可观测用；不是给用户看的文案） */
  why: 'explicit' | 'default' | 'chain' | 'smart' | 'role-duty' | 'role-executor' | 'role-summary' | 'fallback' | 'fallback-disabled';
  /** 本次选中的是调用链第几个（0 起，按启用/存在的链计算）；非链选为 -1 */
  chainIndex: number;
}

const isSmart = (v: unknown) => !v || v === '__smart__';

/**
 * 「供应商名 · 模型名」是**界面展示**用的复合标签，发给 API 的必须是纯模型 id。
 * 统一在选型边界剥掉前缀，历史里已存的复合串也能被吃掉。
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

/** 决策入口：任何输入都不抛错。**返回的 model 一定是纯模型 id**（复合展示标签会被剥掉） */
export function jueCeMoXing(shuRu: MoXingJueCeShuRu = {}): MoXingJueCeJieGuo {
  const fallback = jieMoXingMing(shuRu.fallback || 'deepseek-chat') || 'deepseek-chat';
  const tiaoGuo = new Set((shuRu.tiaoGuo || []).map((m) => jieMoXingMing(m)));
  const explicit = String(shuRu.explicit || '').trim();
  if (explicit && !tiaoGuo.has(jieMoXingMing(explicit))) {
    return { model: jieMoXingMing(explicit), why: 'explicit', chainIndex: -1 };
  }

  const disabled = (shuRu.chainDisabled || []).map((s) => String(s));
  /** 禁用名单里存的可能是复合展示标签，判“是否被禁用”一律按纯模型 id 比对 */
  const beiJinYong = (m: string) => disabled.some((d) => jieMoXingMing(d) === jieMoXingMing(m));
  /** 只允许挑“供应商里真有的模型” */
  const keYong = (shuRu.keYongMoXing || []).map((m) => jieMoXingMing(m)).filter(Boolean);
  const zaiQingDan = (m: string) => {
    const s = jieMoXingMing(m);
    return !s ? false : (keYong.length === 0 || keYong.includes(s));
  };
  const keYongQie = (m: string) => {
    const s = jieMoXingMing(m);
    return !!s && zaiQingDan(s) && !beiJinYong(s) && !tiaoGuo.has(s);
  };

  const dm = String(shuRu.defaultModel || '');
  /** 智能模式：显式传了就用；旧调用方没传时按 defaultModel 是否为空/`__smart__` 推断 */
  const zhiNeng = typeof shuRu.smartMode === 'boolean' ? shuRu.smartMode : isSmart(dm);
  const lian = qiYongLian(shuRu.chain, disabled).filter((m) => zaiQingDan(m));

  // 1) 智能模式：在调用链内综合“难易 + 急缓”打分挑链位
  if (zhiNeng) {
    const di = new Set((shuRu.benDiMoXing || []).map((m) => jieMoXingMing(m)).filter(Boolean));
    const shiBenDi = (m: string) => di.has(jieMoXingMing(m));
    const keLian = lian
      .map((m, i) => ({ m: jieMoXingMing(m), i }))
      .filter((x) => x.m && !tiaoGuo.has(x.m) && !beiJinYong(x.m));
    if (keLian.length) {
      const nan = Number(shuRu.nan);
      const needQ = Number.isFinite(nan) && nan >= 1 && nan <= 5
        ? Math.round(nan)
        : (shuRu.modelTier === 'high' ? 5 : shuRu.modelTier === 'low' ? 1 : 3);
      const jiRaw = Number(shuRu.ji);
      const ji = Number.isFinite(jiRaw) && jiRaw >= 1 && jiRaw <= 5
        ? Math.round(jiRaw)
        : (shuRu.urgency === 'P0' ? 5 : shuRu.urgency === 'P1' ? 4 : shuRu.urgency === 'P3' ? 2 : shuRu.urgency === 'P4' ? 1 : 3);
      const daFen = keLian.map((x) => {
        const q = guSuanMoXingQiangDu(x.m);
        const su = guSuanMoXingSuDu(x.m);
        const ben = shiBenDi(x.m);
        /** 难易优先：低于需求的模型重罚，高于需求的轻奖（避免盲目堆最强） */
        let score = q < needQ ? -(needQ - q) * 40 : (q - needQ) * 5;
        if (needQ >= 5 && q >= 5) score += 30;
        /** 难任务仍优先云端强模型；易任务优先本地/免费（智能模式的历史口径） */
        if (needQ >= 4 && !ben) score += 10;
        if (needQ <= 2 && ben) score += 15;
        if (ji >= 4) {
          score += (su - 3) * 15;
          score += ben ? -8 : 12;
          if (ji >= 5) {
            score += su >= 4 ? 10 : 0;
            /** 很急时**明确点名** flash/turbo/instant 这类快模型（用户口径：优先云端、带 flash、token 快） */
            if (/flash|turbo|instant|fast|haiku/i.test(x.m)) score += 12;
          }
        } else if (ji <= 2) {
          score += (q - 3) * 10;
        } else {
          score += (q - 3) * 4 + (su - 3) * 4;
        }
        /** 同分时链位靠前者优先（稳定、可解释） */
        return { ...x, score, q, su, ben };
      });
      daFen.sort((a, b) => b.score - a.score || a.i - b.i);
      const pick = daFen[0]!;
      return { model: pick.m, why: 'smart', chainIndex: pick.i };
    }
    // 智能模式但链为空/都不可用 ⇒ 落到角色表/兜底
  }

  // 2) 非智能：默认模型优先；默认不行后再严格按调用链顺序
  if (!zhiNeng) {
    const d = jieMoXingMing(dm);
    if (d && keYongQie(d)) return { model: d, why: 'default', chainIndex: -1 };
    // 默认不可用/已失败/被禁用 ⇒ 继续严格按调用链往下试
    for (let i = 0; i < lian.length; i++) {
      const m = jieMoXingMing(lian[i]);
      if (!m || tiaoGuo.has(m) || beiJinYong(m)) continue;
      return { model: m, why: 'chain', chainIndex: i };
    }
  }

  // 3) 角色表：固定顺序，不再按紧急度挑 duty/executor/summary
  const roles: Array<{ m?: string; why: MoXingJueCeJieGuo['why'] }> = [
    { m: shuRu.roles?.duty, why: 'role-duty' },
    { m: shuRu.roles?.executor, why: 'role-executor' },
    { m: shuRu.roles?.summary, why: 'role-summary' },
  ];
  for (const r of roles) {
    const m = jieMoXingMing(r.m);
    if (m && keYongQie(m)) return { model: m, why: r.why, chainIndex: -1 };
  }

  // 4) 任意真实可用模型（仍按清单顺序，不跳着挑）
  const sheng = keYong.filter((m) => keYongQie(m));
  if (sheng.length) return { model: jieMoXingMing(sheng[0]!), why: 'chain', chainIndex: -1 };

  // 5) 兜底（前面的“任意可用模型”已经覆盖了还有别的可用的情形）
  if (disabled.some((d) => jieMoXingMing(d) === fallback)) {
    return { model: fallback, why: 'fallback-disabled', chainIndex: -1 };
  }
  return { model: fallback, why: 'fallback', chainIndex: -1 };
}
