/**
 * R298：确定性内容迪文 sidecar owner（深度融合、可禁用、不丢原文）。
 *
 * 口径（用户 2026-11-23）：
 *  · 所有自动进化/总结自我改进/预测文件/预测规则等**确定性内容**可用迪文；
 *    不确定/创意内容（聊天正文、自由文本、用户可见自然语）绝不迪文化。
 *  · 迪文内置（npm diwen + 子进程 worker），非插件、不可拆分；加密随包（AES-256-GCM data.enc），
 *    本层不触碰核心数据，私有概念为本地 plain JSON（与公开仓库口径一致）。
 *  · 禁用迪文：sidecar 仅作机器旁路被忽略，**原文永在**（第一投影），相关功能照常；
 *  · 再启用：空闲总结分批把未迪文/已变更的条目改造（hash 比对，有界 cap）。
 *
 * 数学可行性：
 *  · 变换 T(s) = (s, M(s))，M 为 NL→迪文的部分映射（Axiom ② 需 WSD；Axiom ④ 无概念⇒逐字保留）。
 *    第一投影恒等 ⇒ T 单射 ⇒ **零信息丢失**，与覆盖率无关（覆盖率 c<1 只影响压缩收益，不影响正确性）。
 *  · 渲染 R(doc) 为确定函数（Axiom ①：同 doc 必同串，218k 全库 round-trip 0 失败）⇒ 跨轮/跨模型零漂移。
 *  · hash 一致性：sidecar 记录原文 hash；原文变更 ⇒ hash 不配 ⇒ 视为未改造重新排队 ⇒ 不会拿旧迪文渲染新原文。
 *  · 收益（已测，相对自然语定义而非裸词）：坐标引用 −73.9% tokens；by id −84.5%（cl100k_base 实测）。
 *
 * 纯函数、无 IO —— 门禁直接 import 编译产物断言。
 */
export interface QueDingCunTiaoMu { id: string; text: string }
export interface SidecarJiLu { hash: string; doc: unknown; ts: number; xuanRan?: string }
/** store → entryId → 记录 */
export type Sidecar = Record<string, Record<string, SidecarJiLu>>;

/** 确定性存储注册表（A 类：机器侧确定性内容；数值参数本身已机器精确，NL 描述字段才迪文化）。 */
export const QUE_DING_CUN = [
  { id: 'harness-guards', ming: '自动进化守卫（名称/描述）', nl: true },
  { id: 'zi-qu-zhi-liang', ming: '自驱质量元素（片段文本）', nl: true },
  { id: 'lu-you-yu-ce', ming: '路由预测（数值参数已机器精确；无 NL 字段⇒不改造）', nl: false },
  { id: 'eta', ming: '预测钳制（数值已机器精确；理由字段如有则改造）', nl: true },
] as const;

/** FNV-1a 32 位稳定哈希（hex）——确定性、无依赖、跨进程一致。 */
export function hashWenBen(t: string): string {
  let h = 0x811c9dc5;
  const s = String(t ?? '');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return ('00000000' + h.toString(16)).slice(-8);
}

export function kongSidecar(): Sidecar { return {}; }

export function guiFanSidecar(j: unknown): Sidecar {
  const out: Sidecar = {};
  if (!j || typeof j !== 'object') return out;
  for (const [cun, zhi] of Object.entries(j as Record<string, unknown>)) {
    if (!zhi || typeof zhi !== 'object') continue;
    const nei: Record<string, SidecarJiLu> = {};
    for (const [id, lu] of Object.entries(zhi as Record<string, unknown>)) {
      const o = lu as Partial<SidecarJiLu>;
      if (o && typeof o.hash === 'string' && o.doc !== undefined) nei[id] = { hash: o.hash, doc: o.doc, ts: Number(o.ts) || 0, ...(typeof o.xuanRan === 'string' ? { xuanRan: o.xuanRan } : {}) };
    }
    out[cun] = nei;
  }
  return out;
}

/** 待改造清单：缺记录或 hash 不配（原文已变）的条目；稳定顺序（按入参），有界 cap。 */
export function daiGaiZao(cun: string, entries: QueDingCunTiaoMu[], sc: Sidecar, cap: number): string[] {
  const ji = sc[cun] || {};
  const out: string[] = [];
  for (const e of entries) {
    if (out.length >= Math.max(0, Math.floor(cap))) break;
    const lu = ji[e.id];
    if (!lu || lu.hash !== hashWenBen(e.text)) out.push(e.id);
  }
  return out;
}

/** 附加改造结果（不可变）：仅当 doc 非空才记；原文 hash 绑定；xuanRan 为改造时预算的确定渲染（同步读）。 */
export function fuJiaGaiZao(sc: Sidecar, cun: string, id: string, text: string, doc: unknown, ts?: number, xuanRan?: string): Sidecar {
  if (doc === undefined || doc === null) return sc;
  return { ...sc, [cun]: { ...(sc[cun] || {}), [id]: { hash: hashWenBen(text), doc, ts: Number(ts) || Date.now(), ...(xuanRan ? { xuanRan } : {}) } } };
}

/** 用户可见/禁用回退：**恒返原文**（第一投影；迪文只给机器）。 */
export function duYuanWen(_sc: Sidecar, _cun: string, _id: string, text: string): string {
  return String(text ?? '');
}

/** 模型输入（同步）：sidecar 存在且 hash 配且有预算渲染 ⇒ 用确定渲染；否则原文。
 *  禁用时宿主传空 sidecar ⇒ 恒原文；hash 不配（原文已变）⇒ 原文（不拿旧迪文渲染新原文）。 */
export function moXingWenBen(sc: Sidecar, cun: string, id: string, text: string): string {
  const lu = (sc[cun] || {})[id];
  if (!lu || lu.hash !== hashWenBen(text) || !lu.xuanRan) return String(text ?? '');
  return lu.xuanRan;
}