/**
 * R296 自驱（self-drive）唯一 owner：总结时扫描所有有牛马的会话，对符合条件者用该会话牛马自主发起一次"下一步计划"对话。
 *
 * 牛马选择（注入 xuanNiuMa 按会话类型决定）：项目＝值班者；群聊＝任意可用牛马（随机）；
 * 我的牛马＝该会话唯一牛马；联系人＝任意可用牛马（随机）。
 *
 * 跳过规则（任一命中即跳过，防反复打扰/重复改进）：
 *  · 右键菜单「自驱」未勾选（autoDrive=false）；
 *  · 该牛马调用链模型均无法使用（或其他异常 ⇒ 选不出可用牛马）；
 *  · 会话最近一条回复在 12 小时内（还在活跃，不打扰）；
 *  · 该会话 66 小时内已自驱过（冷却）；
 *  · 该会话累计已自驱 3 次（上限，防反复对同一会话自驱）。
 *
 * 自驱内容：查看上下文/历史等该会话全部内容 → 给出下一步计划＋方案/理由/优缺点/成本/效果 →
 * 询问用户是否按此计划进行还是有其他打算；以牛马对话形式自主发出（用户未查看 ⇒ 未读样式由宿主写入路径自然产生）。
 * 增量：提示词带上次自驱时间，聚焦新增内容；状态（lastTs/count）落盘持久化。构造无副作用。
 */
export const ZI_QU_HUI_FU_LENG = 12 * 3600 * 1000;   // 最近回复 12h 内跳过
export const ZI_QU_LENG_QUE = 66 * 3600 * 1000;      // 66h 冷却
export const ZI_QU_SHANG_XIAN = 3;                    // 累计 3 次上限

export interface ZiQuNiuMa { id: string; ming: string; lian: string[] }
export interface ZiQuZhuangTai { lastTs: number; count: number; enabled?: boolean }
export interface ZiQuJieGuo { ok: boolean; skipped?: string; reason?: string }

export interface ZiQuYiLai {
  /** 枚举所有有牛马存在的会话 id */
  suoYouHuiHua: () => string[];
  /** 右键菜单「自驱」开关（默认 true） */
  ziQuKai: (sid: string) => boolean;
  /** 按会话类型选牛马：项目值班/群聊随机/我的唯一/联系人随机；选不出返回 null */
  xuanNiuMa: (sid: string) => ZiQuNiuMa | null;
  /** 模型是否可用（可解析供应商且有凭证/ollama） */
  moXingKeYong: (mo: string) => Promise<boolean>;
  /** 会话最近一条回复（assistant）的时间戳；无回复返回 0 */
  zuiJinHuiFuTs: (sid: string) => number;
  /** 读会话日志（构造上下文用） */
  duRiZhi: (sid: string) => Array<{ role?: string; content?: string; ts?: number; seq?: number; hidden?: boolean }> | undefined;
  /** 会话名 */
  sessionMingOf: (sid: string) => string;
  /** 用指定模型跑一次计划生成（provider chat），返回文本；失败抛错 */
  qingQiuMoXing: (mo: string, prompt: string) => Promise<string>;
  /** 以牛马对话形式自主发出（写 assistant 日志＋广播，未读样式由宿主自然产生） */
  faSongZiQu: (sid: string, ming: string, content: string) => void;
  duZhuangTai: () => Record<string, ZiQuZhuangTai>;
  cunZhuangTai: (j: Record<string, ZiQuZhuangTai>) => void;
  auditLog: (op: string, detail: unknown) => void;
  shiZhong: () => number;
}

export function chuangJianZiQu(yiLai: ZiQuYiLai) {
  /** 构造自驱提示词：查看会话全部内容 → 下一步计划（方案/理由/优缺点/成本/效果）→ 询问用户。聚焦上次自驱后的新增内容。 */
  function gouZaoTiShi(sid: string, ming: string, shangCiTs: number): string {
    const lie = yiLai.duRiZhi(sid) || [];
    const shangXiaWen = lie
      .filter((x) => !x.hidden && String(x.content || '').trim())
      .slice(-60)
      .map((x) => `[${String(x.role || '')}] ${String(x.content || '').slice(0, 600)}`)
      .join('\n')
      .slice(0, 12000);
    const xinZeng = shangCiTs > 0
      ? `上次自驱以来（${new Date(shangCiTs).toISOString()} 之后）请聚焦新增内容，不要重复改进/查看过的旧内容。`
      : '这是本会话首次自驱。';
    return `你是牛马「${ming}」，正在对会话「${yiLai.sessionMingOf(sid)}」做一次自驱（自主推进）。${xinZeng}\n`
      + '请查看下面本会话的上下文与历史记录等全部内容，然后给出**下一步计划**，并逐项说明：\n'
      + '1. 计划方案（具体怎么做）；2. 理由（为什么这样推进）；3. 优缺点；4. 成本（时间/token/资源）；5. 预期效果。\n'
      + '最后**询问用户**：是否按此计划进行，还是有其他打算。语气自主、简洁、可执行；不要寒暄，不要替用户拍板。\n\n'
      + '【会话上下文/历史】\n' + (shangXiaWen || '（本会话暂无内容）');
  }

  /** 对单个会话尝试自驱；返回跳过原因或成功。 */
  async function ziQuYiGe(sid0: string): Promise<ZiQuJieGuo> {
    const sid = String(sid0 || '');
    if (!sid) return { ok: false, skipped: 'bad-session' };
    if (!yiLai.ziQuKai(sid)) return { ok: false, skipped: 'disabled' };
    const zt = yiLai.duZhuangTai();
    const cur = zt[sid] || { lastTs: 0, count: 0 };
    const now = yiLai.shiZhong();
    if (cur.count >= ZI_QU_SHANG_XIAN) return { ok: false, skipped: 'max-count' };
    if (cur.lastTs > 0 && now - cur.lastTs < ZI_QU_LENG_QUE) return { ok: false, skipped: 'cooldown' };
    const zuiJin = yiLai.zuiJinHuiFuTs(sid);
    if (zuiJin > 0 && now - zuiJin < ZI_QU_HUI_FU_LENG) return { ok: false, skipped: 'recent-reply' };
    const niuMa = yiLai.xuanNiuMa(sid);
    if (!niuMa) return { ok: false, skipped: 'no-workhorse' };
    const keYong: string[] = [];
    for (const m of niuMa.lian || []) { if (m && await yiLai.moXingKeYong(m)) keYong.push(m); }
    if (!keYong.length) return { ok: false, skipped: 'unavailable' };
    const prompt = gouZaoTiShi(sid, niuMa.ming, cur.lastTs);
    let content = '';
    let yongMo = '';
    for (const mo of keYong) {
      try {
        const txt = await yiLai.qingQiuMoXing(mo, prompt);
        if (String(txt || '').trim()) { content = String(txt).trim(); yongMo = mo; break; }
      } catch { /* 顺延链上下一个模型 */ }
    }
    if (!content) {
      try { yiLai.auditLog('ziQu.model-fail', { sessionId: sid, workhorse: niuMa.id }); } catch { /* noop */ }
      return { ok: false, skipped: 'model-fail' };
    }
    try { yiLai.faSongZiQu(sid, niuMa.ming, content); } catch { /* 发送失败不更新状态 */ return { ok: false, skipped: 'send-fail' }; }
    const xin = yiLai.duZhuangTai();
    xin[sid] = { ...xin[sid], lastTs: now, count: (xin[sid]?.count || cur.count) + 1 };
    try { yiLai.cunZhuangTai(xin); } catch { /* 落盘失败不影响本次 */ }
    try { yiLai.auditLog('ziQu.done', { sessionId: sid, workhorse: niuMa.id, model: yongMo, count: xin[sid].count }); } catch { /* noop */ }
    return { ok: true };
  }

  /** 扫描所有有牛马的会话，逐个尝试自驱（跳过规则在 ziQuYiGe 内）。 */
  async function ziQuSaoMiao(): Promise<{ zong: number; qu: number; tiao: number }> {
    let zong = 0, qu = 0, tiao = 0;
    for (const sid of yiLai.suoYouHuiHua()) {
      zong++;
      const r = await ziQuYiGe(sid);
      if (r.ok) qu++; else tiao++;
    }
    try { yiLai.auditLog('ziQu.scan', { zong, qu, tiao }); } catch { /* noop */ }
    return { zong, qu, tiao };
  }

  return { ziQuYiGe, ziQuSaoMiao, gouZaoTiShi };
}