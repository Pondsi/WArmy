/**
 * R287 P4-4：归档游标唯一 owner（自 electron-main 迁出，行为逐字保持）。
 * 总结增量游标（sessionId → 上次总结到的末 seq/ts）读写＋消息时间戳提取（优先 seq，缺则 ts）。
 * 增量是自动总结的关键：下次只总结新内容，不每次从头重做（省调用、不塞重复条目）。
 * 设置快照读写窄注入；游标写失败不影响本次总结；构造无副作用。
 */
export type GuiDangYouBiaoJi = Record<string, number>;
export interface GuiDangYouBiaoYiLai {
  duSheZhi: () => unknown;
  cunSheZhi: (j: { archiveCursors: GuiDangYouBiaoJi }) => void;
}

export function chuangJianGuiDangYouBiao(yiLai: GuiDangYouBiaoYiLai) {
  /** 总结游标：sessionId → 上次总结到的最后一条消息的 seq/ts */
  function guiDangYouBiaoQu(): GuiDangYouBiaoJi {
    try {
      const s = yiLai.duSheZhi() as { archiveCursors?: GuiDangYouBiaoJi } | undefined;
      return (s?.archiveCursors && typeof s.archiveCursors === 'object') ? { ...s.archiveCursors } : {};
    } catch { return {}; }
  }
  function guiDangYouBiaoCun(next: GuiDangYouBiaoJi): void {
    try { yiLai.cunSheZhi({ archiveCursors: next }); } catch { /* 游标写失败不影响本次总结 */ }
  }
  /** 一条消息的时间戳（用来推进游标）：优先 seq，没有就用 ts */
  function xiaoXiShiJian(x: { seq?: number | string; ts?: number | string } | null | undefined): number {
    const n = Number(x && (x.seq ?? x.ts)) || 0;
    return n;
  }
  return { guiDangYouBiaoQu, guiDangYouBiaoCun, xiaoXiShiJian };
}