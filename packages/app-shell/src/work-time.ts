/**
 * 第 121 轮：执行时间口径 —— **审批等待不计入执行时间**。
 * 墙钟 = 真正干活 + 等用户点授权/决策卡 + 其它停顿；这里只扣掉审批等待，
 * 不改墙钟本身（界面仍能看出这一轮总共过了多久）。
 */
export function jiSuanGongZuoHaoShi(qiShiMs: number, piZhunKaiShiMs: number, xianZaiMs: number, piZhunXianZaiMs: number): number {
  const a = Number(qiShiMs) || 0;
  const b = Number(xianZaiMs) || 0;
  const w0 = Math.max(0, Number(piZhunKaiShiMs) || 0);
  const w1 = Math.max(0, Number(piZhunXianZaiMs) || 0);
  const deng = Math.max(0, w1 - w0);
  return Math.max(0, b - a - deng);
}
