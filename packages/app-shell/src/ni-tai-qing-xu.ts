/**
 * R260 项「拟态情绪反馈」：情绪状态机（valence 愉悦度 [-1,1] × arousal 唤醒度 [0,1]）→ 表情/动作/语气。
 *
 * 拟人黏性：模型给情绪标签（或宿主从回复情感分析得出）→ 映射到拟态预设动作 + 语气；
 * 情绪随时间**指数衰减回中性**（不一直亢奋/低落）。纯函数、可测；动作 id 与拟态预设动作表一致。
 * 过度拟人防护：只映射到已有预设动作，不臆造新动作；中性即 idle 呼吸。
 */

export interface QingXuZhuangTai { valence: number; arousal: number; ts: number }
export interface QingXuBiaoDa { dongZuo: string; biaoQing: string; yuQi: string }

const jia = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : 0));

/** 归一化情绪状态（valence [-1,1]，arousal [0,1]）。 */
export function guiYiQingXu(valence: number, arousal: number, ts = Date.now()): QingXuZhuangTai {
  return { valence: jia(valence, -1, 1), arousal: jia(arousal, 0, 1), ts };
}

/** 情绪 → 动作/表情/语气（象限映射；动作 id 对齐拟态预设动作表）。 */
export function qingXuDongZuo(valence: number, arousal: number): QingXuBiaoDa {
  const v = jia(valence, -1, 1);
  const a = jia(arousal, 0, 1);
  if (a >= 0.6 && Math.abs(v) < 0.25) return { dongZuo: 'jingYa', biaoQing: '惊讶', yuQi: 'jingHu' };
  if (v >= 0.25) {
    return a >= 0.5
      ? { dongZuo: 'kaiXin', biaoQing: '开心', yuQi: 'qingKuai' }
      : { dongZuo: 'haiXiu', biaoQing: '温柔', yuQi: 'wenRou' };
  }
  if (v <= -0.25) {
    return a >= 0.5
      ? { dongZuo: 'shengQi', biaoQing: '生气', yuQi: 'jiZao' }
      : { dongZuo: 'weiQu', biaoQing: '委屈', yuQi: 'diChen' };
  }
  return a >= 0.6
    ? { dongZuo: 'siKao', biaoQing: '专注', yuQi: 'renZhen' }
    : { dongZuo: 'huXi', biaoQing: '平静', yuQi: 'pingJing' };
}

/** 指数衰减回中性：半衰期 halfLifeMs（默认 60s）；dt 越大越接近 0。 */
export function qingXuShuaiJian(zt: QingXuZhuangTai, dtMs: number, halfLifeMs = 60000): QingXuZhuangTai {
  const dt = Math.max(0, Number(dtMs) || 0);
  const k = Math.pow(0.5, dt / Math.max(1, halfLifeMs));
  return { valence: jia(zt.valence * k, -1, 1), arousal: jia(zt.arousal * k, 0, 1), ts: zt.ts + dt };
}