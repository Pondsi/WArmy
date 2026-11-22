/**
 * R291：工具表「稳定前缀」规范化（模型无关的 prompt/KV 缓存命中优化）。
 *
 * 原理（见 docs/CACHE-HIT-R291.md 的数学证明）：prefix cache 命中＝与上一请求
 * 从 token 0 起的最长公共前缀(LCP)。工具定义位于前部，若其**顺序/键序**逐轮变化，
 * 会在前部引入差异点，使 LCP 截断、其后全部重算。本模块把工具表规范化为：
 *   · 按 name 稳定排序（集合不变，仅顺序确定）；
 *   · 每个 schema 递归按键排序（canonical JSON，插入序确定）；
 * 从而同一配置下逐轮字节一致，LCP 最大化。不增删工具、不改语义 ⇒ 功能/外观/性能不变。
 * 纯函数、无副作用，门禁可直接断言。
 */
export interface GongJuGuiGeLike { name?: string; function?: { name?: string } }
const mingOf = (s: unknown): string => { const o = (s || {}) as GongJuGuiGeLike; return String(o.name || o.function?.name || ''); };

/** 递归按键排序，返回新对象（不改动入参），保证 JSON.stringify 插入序确定 */
export function jianPaiXu(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(jianPaiXu);
  if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) out[k] = jianPaiXu(o[k]);
    return out;
  }
  return x;
}

/** 稳定排序＋规范化工具表；集合不变（mask 不 remove 的排序版），仅确定顺序/键序 */
export function wenDingGongJuBiao<T>(specs: readonly T[]): T[] {
  const fu = specs.map((s) => jianPaiXu(s) as T);
  fu.sort((a, b) => mingOf(a).localeCompare(mingOf(b)));
  return fu;
}

/** 两个工具表是否"同集合"（用于断言规范化不增删工具） */
export function tongJiHe(a: readonly unknown[], b: readonly unknown[]): boolean {
  const ka = a.map(mingOf).sort().join('|');
  const kb = b.map(mingOf).sort().join('|');
  return ka === kb;
}

/** 最长公共前缀长度（字符级，近似 token 级单调性）——供命中率度量/证明 */
export function zuiChangGongGongQianZhui(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}
