/**
 * R287 P3：ETA once 放行夹区间·扩展审批唯一 owner（自 electron-main 迁出）。
 * 行为保持：多条申请合并为单条（取并集最大请求）、用户填具体区间（留空＝不变）、
 * 审批后 yingYongClamp 直接应用、系统消息仅未读提示。构造无副作用。
 */
export interface EtaJiaQuJianYiLai {
  duClamp: () => { minMs: number; maxMs: number };
  yingYongClamp: (minMs: number, maxMs: number) => void;
  jiXiTongXiaoXi: (kind: 'system', title: string, body: string) => void;
  auditLog: (op: string, detail: unknown) => void;
}
export interface JiaQuJianShenPi { reqMin: number; reqMax: number; curMin: number; curMax: number }

export function chuangJianEtaJiaQuJian(yiLai: EtaJiaQuJianYiLai) {
  let pendingClampShenPi: JiaQuJianShenPi | null = null;
  /** 多条合并为一个：取并集的最大请求 */
  function qingQiuClampKuoZhang(reqMin: number, reqMax: number): void {
    const cur = yiLai.duClamp();
    pendingClampShenPi = pendingClampShenPi
      ? { reqMin: Math.min(pendingClampShenPi.reqMin, reqMin), reqMax: Math.max(pendingClampShenPi.reqMax, reqMax), curMin: cur.minMs, curMax: cur.maxMs }
      : { reqMin, reqMax, curMin: cur.minMs, curMax: cur.maxMs };
    try {
      yiLai.jiXiTongXiaoXi('system', 'ETA 放行窗口扩展申请',
        `模型想把 once 放行夹区间扩到 [${(reqMin / 60000).toFixed(3)}, ${(reqMax / 60000).toFixed(3)}] 分钟（超出硬区间 [0.1,600]）。当前 [${(cur.minMs / 60000).toFixed(3)}, ${(cur.maxMs / 60000).toFixed(3)}]。请在系统消息里填写批准的区间（留空＝不变）。`);
    } catch { /* noop */ }
  }
  function zhuCeIpc(zhuCe: (channel: string, fn: (event: any, ...args: any[]) => any) => void): void {
    zhuCe('warmy:etaClampShenPiQu', () => ({ ok: true, pending: pendingClampShenPi }));
    zhuCe('warmy:etaClampShenPiQue', (_e, p0?: { minMin?: number | string; maxMin?: number | string }) => {
      if (!pendingClampShenPi) return { ok: false, error: 'no-pending' };
      const cur = yiLai.duClamp();
      const mn = String(p0?.minMin ?? '').trim() === '' ? cur.minMs : Number(p0?.minMin) * 60000;
      const mx = String(p0?.maxMin ?? '').trim() === '' ? cur.maxMs : Number(p0?.maxMin) * 60000;
      yiLai.yingYongClamp(mn, mx);
      pendingClampShenPi = null;
      try { yiLai.auditLog('eta.clamp-approved', { clamp: yiLai.duClamp() }); } catch { /* noop */ }
      return { ok: true, clamp: yiLai.duClamp() };
    });
  }
  return { qingQiuClampKuoZhang, zhuCeIpc, get pending() { return pendingClampShenPi; } };
}
