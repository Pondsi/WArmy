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
 *  · 连续 3 次自驱未获用户回复（用户发消息即重置连续计数）⇒ 自动取消勾选「自驱」，
 *    等用户重新勾选才恢复（不是累计总数上限；count 仅作历史统计）。
 *
 * 自驱内容：查看上下文/历史等该会话全部内容 → 给出下一步计划＋方案/理由/优缺点/成本/效果 →
 * 询问用户是否按此计划进行还是有其他打算；以牛马对话形式自主发出（用户未查看 ⇒ 未读样式由宿主写入路径自然产生）。
 * 增量：提示词带上次自驱时间，聚焦新增内容；状态（lastTs/count）落盘持久化。构造无副作用。
 */
import { guiFanZiQuYueShu, jianYanZiQuZhengWen, jieXiZiQuShengCheng, ziQuShengChengTiShi, ziQuXiuFuTiShi, ZI_QU_MO_REN_XIANG, ZI_QU_QING_QIU_SHANG_XIAN, type ZiQuYingYueShu, type ZiQuYingJianYan, type ZiQuNeiRongXiang } from '../ji-chu/zi-qu-ying-yue-shu.js';

export const ZI_QU_HUI_FU_LENG = 12 * 3600 * 1000;   // 最近回复 12h 内跳过
export const ZI_QU_LENG_QUE = 66 * 3600 * 1000;      // 66h 冷却
export const ZI_QU_SHANG_XIAN = 3;                    // 连续 3 次未获回复⇒自动取消勾选（非累计总数）

export interface ZiQuNiuMa { id: string; ming: string; lian: string[] }
export interface ZiQuZhuangTai { lastTs: number; count: number; enabled?: boolean; lianXu?: number }
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
  /** 复用宿主已知密钥脱敏器；输入脱敏，输出发现凭据则整份拒绝。 */
  tuoMin?: (wen: string) => string;
  /** 以牛马对话形式自主发出（写 assistant 日志＋广播，未读样式由宿主自然产生） */
  faSongZiQu: (sid: string, ming: string, content: string) => void;
  /** 连续上限到达：宿主取消勾选「自驱」（落盘＋通知界面），等用户重新勾选 */
  guanBiZiQu?: (sid: string) => void;
  duZhuangTai: () => Record<string, ZiQuZhuangTai>;
  cunZhuangTai: (j: Record<string, ZiQuZhuangTai>) => void;
  auditLog: (op: string, detail: unknown) => void;
  shiZhong: () => number;
  /** R297 质量自我改进（可选）：演化提示词＋记录待反馈。未提供则用内建基线提示词。 */
  zhiLiang?: {
    gouZaoTiShi: (sid: string, ming: string, shangCiTs: number, shangXiaWen: string, huiHuaMing: string) => { prompt: string; elements: string[]; sections?: ZiQuNeiRongXiang[] };
    jiLuFaSong: (sid: string, elements: string[]) => void;
    huoYingYueShu?: () => ZiQuYingYueShu;
    jiLuYingJianYan?: (sid: string, report: ZiQuYingJianYan) => void;
  };
}

export function chuangJianZiQu(yiLai: ZiQuYiLai) {
  const zaiQu = new Set<string>();
  /** 构造会话上下文摘要（最近 60 条非隐藏，每条≤600 字，总≤12000 字）。 */
  function buildShangXiaWen(sid: string): string {
    const lie = yiLai.duRiZhi(sid) || [];
    return lie
      .filter((x) => !x.hidden && String(x.content || '').trim())
      .slice(-60)
      .map((x) => `[${String(x.role || '')}] ${String(x.content || '').slice(0, 600)}`)
      .join('\n')
      .slice(0, 12000);
  }
  /** 构造自驱提示词（内建基线）：查看会话全部内容 → 下一步计划（方案/理由/优缺点/成本/效果）→ 询问用户。聚焦上次自驱后的新增内容。 */
  function gouZaoTiShi(sid: string, ming: string, shangCiTs: number): string {
    const shangXiaWen = buildShangXiaWen(sid);
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
  async function ziQuYiGeBen(sid0: string): Promise<ZiQuJieGuo> {
    const sid = String(sid0 || '');
    if (!sid) return { ok: false, skipped: 'bad-session' };
    if (!yiLai.ziQuKai(sid)) return { ok: false, skipped: 'disabled' };
    const zt = yiLai.duZhuangTai();
    const cur = zt[sid] || { lastTs: 0, count: 0 };
    const now = yiLai.shiZhong();
    if (cur.lastTs > 0 && now - cur.lastTs < ZI_QU_LENG_QUE) return { ok: false, skipped: 'cooldown' };
    const zuiJin = yiLai.zuiJinHuiFuTs(sid);
    if (zuiJin > 0 && now - zuiJin < ZI_QU_HUI_FU_LENG) return { ok: false, skipped: 'recent-reply' };
    const niuMa = yiLai.xuanNiuMa(sid);
    if (!niuMa) return { ok: false, skipped: 'no-workhorse' };
    const keYong: string[] = [];
    for (const m of niuMa.lian || []) { if (m && await yiLai.moXingKeYong(m)) keYong.push(m); }
    if (!keYong.length) return { ok: false, skipped: 'unavailable' };
    /* R297：有质量模块则用演化提示词（UCB1 选元素）＋记录待反馈；否则内建基线。 */
    let prompt: string;
    let elements: string[];
    let sections = [...ZI_QU_MO_REN_XIANG];
    const policy = guiFanZiQuYueShu(yiLai.zhiLiang?.huoYingYueShu?.());
    if (yiLai.zhiLiang) {
      const r = yiLai.zhiLiang.gouZaoTiShi(sid, niuMa.ming, cur.lastTs, buildShangXiaWen(sid), yiLai.sessionMingOf(sid));
      prompt = r.prompt; elements = r.elements;
      if (r.sections) sections = r.sections;
    } else {
      prompt = gouZaoTiShi(sid, niuMa.ming, cur.lastTs);
      elements = ['plan', 'reason', 'proscons', 'cost', 'effect', 'ask'];
    }
    prompt = ziQuShengChengTiShi(yiLai.tuoMin ? yiLai.tuoMin(prompt) : prompt, sections, policy);
    let content = '';
    let yongMo = '';
    let calls = 0, yiXiuFu = false, youWeiGui = false;
    const jiYan = (report: ZiQuYingJianYan) => {
      try { yiLai.zhiLiang?.jiLuYingJianYan?.(sid, report); } catch { /* 台账失败不放开安全闸 */ }
      try { yiLai.auditLog('ziQu.output-check', { sessionId: sid, ok: report.ok, chars: report.chars, codes: report.codes }); } catch { /* 不记录候选正文 */ }
    };
    for (const mo of keYong) {
      if (calls >= ZI_QU_QING_QIU_SHANG_XIAN) break;
      try {
        calls++;
        let candidate = jieXiZiQuShengCheng(await yiLai.qingQiuMoXing(mo, prompt), sections, policy, yiLai.tuoMin);
        jiYan(candidate.report);
        if (!candidate.report.ok) {
          youWeiGui = true;
          if (!yiXiuFu && calls < ZI_QU_QING_QIU_SHANG_XIAN) {
            yiXiuFu = true; calls++;
            candidate = jieXiZiQuShengCheng(await yiLai.qingQiuMoXing(mo, ziQuXiuFuTiShi(prompt, candidate.report)), sections, policy, yiLai.tuoMin);
            jiYan(candidate.report);
          }
        }
        if (candidate.report.ok && candidate.content) { content = candidate.content; yongMo = mo; break; }
      } catch { /* 请求/校验失败均不能放行，受限顺延模型链 */ }
    }
    if (!content) {
      const skipped = youWeiGui ? 'content-rejected' : 'model-fail';
      try { yiLai.auditLog('ziQu.model-fail', { sessionId: sid, workhorse: niuMa.id, skipped, calls }); } catch { /* noop */ }
      return { ok: false, skipped };
    }
    // 请求期间用户可能关掉自驱或继续对话；不得把过时提案送出。
    if (!yiLai.ziQuKai(sid) || yiLai.zuiJinHuiFuTs(sid) > zuiJin) return { ok: false, skipped: 'session-changed' };
    const finalReport = jianYanZiQuZhengWen(content, guiFanZiQuYueShu(yiLai.zhiLiang?.huoYingYueShu?.()), yiLai.tuoMin);
    if (!finalReport.ok) { jiYan(finalReport); return { ok: false, skipped: 'content-rejected' }; }
    try { yiLai.faSongZiQu(sid, niuMa.ming, content); } catch { /* 发送失败不更新状态 */ return { ok: false, skipped: 'send-fail' }; }
    try { yiLai.zhiLiang?.jiLuFaSong(sid, elements); } catch { /* 记录待反馈失败不挡自驱 */ }
    const xin = yiLai.duZhuangTai();
    const lianXu = (xin[sid]?.lianXu || cur.lianXu || 0) + 1;
    xin[sid] = { ...xin[sid], lastTs: now, count: (xin[sid]?.count || cur.count) + 1, lianXu };
    try { yiLai.cunZhuangTai(xin); } catch { /* 落盘失败不影响本次 */ }
    try { yiLai.auditLog('ziQu.done', { sessionId: sid, workhorse: niuMa.id, model: yongMo, count: xin[sid].count, lianXu }); } catch { /* noop */ }
    /** 连续 3 次未获用户回复 ⇒ 自动取消勾选，等用户重新勾选（用户发消息会重置 lianXu） */
    if (lianXu >= ZI_QU_SHANG_XIAN) {
      try { yiLai.guanBiZiQu?.(sid); } catch { /* 宿主关闭失败不放开连续闸：下一轮仍会因 enabled=false 跳过 */ }
      try { yiLai.auditLog('ziQu.auto-off', { sessionId: sid, lianXu }); } catch { /* noop */ }
    }
    return { ok: true };
  }

  /** 用户在该会话发了消息 ⇒ 连续计数清零（不再视为“连续未获回复”）。 */
  function yongHuHuiFu(sid0: string): void {
    const sid = String(sid0 || '');
    if (!sid) return;
    const z = yiLai.duZhuangTai();
    const cur = z[sid];
    if (!cur || !(cur.lianXu || 0)) return;
    z[sid] = { ...cur, lianXu: 0 };
    try { yiLai.cunZhuangTai(z); } catch { /* noop */ }
  }

  /** 同会话只允许一个在途自驱，避免并发扫描重复发出和覆盖 pending。 */
  async function ziQuYiGe(sid0: string): Promise<ZiQuJieGuo> {
    const sid = String(sid0 || '');
    if (zaiQu.has(sid)) return { ok: false, skipped: 'in-progress' };
    zaiQu.add(sid);
    try { return await ziQuYiGeBen(sid); } finally { zaiQu.delete(sid); }
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

  return { ziQuYiGe, ziQuSaoMiao, gouZaoTiShi, yongHuHuiFu };
}