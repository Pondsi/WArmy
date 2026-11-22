/**
 * R287 P4-2：自动归档触发规则唯一 owner（自 electron-main 迁出，行为逐字保持）。
 * 口径：每攒够 GUI_DANG_MEI_LUN 条新日志才归一次（不写爆总结）；只在本轮真收尾后触发；
 * 在途跳过（会话正在生成）**不推进水位**（下一轮补，丢的是原文不是摘要）；
 * 总结调用链均不可用⇒系统消息（不弹窗）；失败只记审计、不影响对话。
 * 水位 Map 模块内部持有（唯一 owner）；设置/日志/末 seq/归档管线/系统消息/审计/错误净化窄注入。构造无副作用。
 */
export interface GuiDangJieGuo {
  ok: boolean; tiaoShu?: number; zhiShiJian?: string; jiangJi?: boolean; guiDangHeXin?: boolean; skipped?: string; error?: string;
}
export interface ZiDongGuiDangYiLai {
  duSheZhi: () => unknown;
  duRiZhi: (sid: string) => Array<{ seq?: number | string }> | undefined;
  zuiHouSeq: () => number;
  guiDang: (sid: string, opts: { auto: boolean }) => Promise<GuiDangJieGuo>;
  xiTongXiaoXi: (key: string, title: string, body: string) => void;
  auditLog: (op: string, detail: unknown) => void;
  jingCuoWu: (e: unknown) => string;
}

/** 每攒够这么多条新日志才自动归一次 */
const GUI_DANG_MEI_LUN = 30;

export function chuangJianZiDongGuiDang(yiLai: ZiDongGuiDangYiLai) {
  /** 自动归档水位：sessionId → 上次触发时的末 seq（在途跳过须退回） */
  const guiDangZuiHouXu = new Map<string, number>();
  async function ziDongGuiDangRuGuoXuYao(sessionId: string): Promise<void> {
    try {
      const k = String(sessionId || '');
      if (!k) return;
      if ((yiLai.duSheZhi() as { autoSummary?: boolean } | undefined)?.autoSummary === false) return;
      const rizhi = yiLai.duRiZhi(k) || [];
      if (rizhi.length < GUI_DANG_MEI_LUN + 10) return;
      const zuiHou = Number(rizhi[rizhi.length - 1]?.seq || 0) || yiLai.zuiHouSeq();
      const shangCi = guiDangZuiHouXu.get(k) || 0;
      if (zuiHou - shangCi < GUI_DANG_MEI_LUN) return;
      guiDangZuiHouXu.set(k, zuiHou);
      /** 自动总结 = 立即总结的同一管线（用户定稿）：自动入口只调归档管线，它内部再调摘要核心。 */
      const r = await yiLai.guiDang(k, { auto: true });
      /* R272 项9：总结调用链均不可用⇒系统消息（不弹窗）；模型异常不影响程序本身 */
      if (r && r.ok === false && r.skipped !== 'in-flight') {
        try { yiLai.xiTongXiaoXi('system', '自动总结', '自动总结未能完成（总结模型调用链均不可用或返回空）。可在 设置→功能→总结 调整调用链。'); } catch { /* noop */ }
      }
      /** 跳过时不许推进水位（第 52 轮）：会话正在生成⇒本轮跳过，水位照推进则被跳过的那几十条永远不会被总结。 */
      if (r && r.skipped === 'in-flight') guiDangZuiHouXu.set(k, shangCi);
      yiLai.auditLog('chat.auto-archive', { sessionId: k, ok: !!r.ok, seq: zuiHou, at: Math.max(0, zuiHou - shangCi), jiangJi: !!r.jiangJi, guiDangHeXin: !!r.guiDangHeXin, tiaoguo: r.skipped === 'in-flight' ? 'in-flight' : '' });
    } catch (e) {
      try { yiLai.auditLog('chat.auto-archive-fail', { sessionId, error: yiLai.jingCuoWu(e).slice(0, 140) }); } catch { /* noop */ }
    }
  }
  return { ziDongGuiDangRuGuoXuYao };
}