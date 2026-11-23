/**
 * R298：总结/批量改造的工作量判断 owner（判断本身纳入自我改进正循环）。
 *
 * 口径（用户 2026-11-23）：总结时判断当前情况与工作量，确保不太长占用/太多资源影响使用；
 * 判断后实施，事后反馈复盘给出更好的判断方法，下次用更好的方法判断后验证效果，再决定下一步更改。
 *
 * 数学可行性（AIMD，加性增/乘性减）：
 *  · 硬守卫（不可学习）：前台活跃/资源越线 ⇒ 跳过。前台优先是不变量，任何反馈不得放宽。
 *  · 可学习参数仅 cap（每轮处理条数）∈ [capMin, capMax]。
 *  · 复盘规则：实测耗时 > 预算 或 观察到前台影响 ⇒ cap ← max(capMin, ⌊cap/2⌋)（乘性减，快速退让）；
 *    否则 cap ← min(capMax, cap+2)（加性增，温和探测）。
 *  · 收敛性：乘性减保证越界后几何级 retreat；加性增在安全域内线性爬升；cap 有界 ⇒ 序列必进入
 *    [capMin, capMax] 的不变区间并在预算约束附近振荡（标准 AIMD 收敛论证，见 Chiu-Jain 1989）。
 *  · 正循环可验证：判断→实施→度量→调整→下一轮判断用新 cap；专项测试模拟过载→收缩→恢复→爬升。
 *
 * 纯函数、无 IO —— 门禁直接 import 编译产物断言。
 */
export const GZ_MO_REN = { cap: 20, capMax: 40, capMin: 2, yuSuanMs: 8000, liShiShang: 200 } as const;

export interface GzLiangLiShi { ts: number; cap: number; processed: number; haoShiMs: number; qianTaiYingXiang: boolean }
export interface GzLiangZhuangTai { cap: number; liShi: GzLiangLiShi[] }

export function kongGzLiang(): GzLiangZhuangTai { return { cap: GZ_MO_REN.cap, liShi: [] }; }

export function guiFanGzLiang(j: unknown): GzLiangZhuangTai {
  const o = (j && typeof j === 'object' ? j : {}) as Partial<GzLiangZhuangTai>;
  const cap = Number.isFinite(Number(o.cap)) ? Math.max(GZ_MO_REN.capMin, Math.min(GZ_MO_REN.capMax, Math.floor(Number(o.cap)))) : GZ_MO_REN.cap;
  const liShi = Array.isArray(o.liShi) ? o.liShi.filter((x) => x && Number.isFinite(Number(x.ts)) && Number.isFinite(Number(x.haoShiMs))).slice(-GZ_MO_REN.liShiShang) : [];
  return { cap, liShi };
}

/** 判断：返回本轮 cap 或跳过原因。资源准入（CPU/RAM）由宿主资源层负责；这里管工作量/前台/历史。 */
export function panDuanGongZuoLiang(
  shu: { daiChuLi: number; qianTaiHuoYue: boolean },
  st: GzLiangZhuangTai,
): { cap: number; tiaoGuo: boolean; liYou: string } {
  if (shu.daiChuLi <= 0) return { cap: 0, tiaoGuo: true, liYou: 'nothing' };
  if (shu.qianTaiHuoYue) return { cap: 0, tiaoGuo: true, liYou: 'foreground' };
  const cap = Math.max(GZ_MO_REN.capMin, Math.min(GZ_MO_REN.capMax, st.cap, Math.floor(shu.daiChuLi)));
  return { cap, tiaoGuo: false, liYou: 'ok' };
}

/** 复盘：实测反馈 → 调整 cap（AIMD）＋有界历史。返回新状态（不改入参）。 */
export function fuPanGongZuoLiang(
  st: GzLiangZhuangTai,
  r: { processed: number; haoShiMs: number; qianTaiYingXiang: boolean; ts?: number },
): GzLiangZhuangTai {
  const chao = r.haoShiMs > GZ_MO_REN.yuSuanMs || r.qianTaiYingXiang;
  const cap = chao
    ? Math.max(GZ_MO_REN.capMin, Math.floor(st.cap / 2))
    : Math.min(GZ_MO_REN.capMax, st.cap + 2);
  const liShi = [...st.liShi, { ts: Number(r.ts) || Date.now(), cap: st.cap, processed: Math.max(0, Math.floor(r.processed)), haoShiMs: Math.max(0, Math.round(r.haoShiMs)), qianTaiYingXiang: !!r.qianTaiYingXiang }].slice(-GZ_MO_REN.liShiShang);
  return { cap, liShi };
}