/**
 * R297 自驱质量自我改进唯一 owner（数学方案：UCB1 多臂赌博机）。
 *
 * 自驱提示词由「元素」组成（计划方案/理由/优缺点/成本/效果/询问用户 为内建必选基线；模型可在总结时自由增删可选元素）。
 * 每个可选元素是一个「臂」；用户反馈是奖励。用 UCB1（Auer, Cesa-Bianchi & Fischer 2002）选择元素：
 *   score_i = mean_i + sqrt(2 ln T / n_i)（n_i=0 时 +∞ 优先探索）。
 * UCB1 有 proved  regret 界 R_T ≤ O(√(K T ln T))（sublinear）⇒ 平均奖励收敛到最优臂，
 * 即自驱质量随反馈持续提升（数学证明见 docs/ZI-QU-ZHI-LIANG-R297.md）。
 *
 * 反馈信号（用户对该次自驱的下一条回复）→ 奖励：
 *   赞同 agree=+1（好自驱）；不赞同 disagree=-1（坏自驱，总结分析不赞同什么/为何）；
 *   追问细节 ask-detail=+0.2（有参与但缺细节 ⇒ 下次把该细节预先一次性告知）；
 *   无回复 no-reply=-0.3（弱负、不确定：可能质量不高/用户没兴趣/进度不在计划内/没看懂，不重罚）；
 *   其他 other=0。
 * 总结时：模型看元素注册表＋反馈台账＋UCB1 统计，裁决增删/调整元素（语义演化），与 UCB1（统计选择）互补。
 * 状态落盘持久化；构造无副作用。
 */
export type ZiQuSignal = 'agree' | 'disagree' | 'ask-detail' | 'no-reply' | 'other';
export const ZI_QU_REWARD: Record<ZiQuSignal, number> = { agree: 1, disagree: -1, 'ask-detail': 0.2, 'no-reply': -0.3, other: 0 };
export const ZI_QU_WU_HUI_FU_MS = 24 * 3600 * 1000;  // 24h 无回复 ⇒ no-reply 反馈
export const ZI_QU_KE_XUAN_SHANG_XIAN = 4;            // 每次自驱最多纳入的可选元素数

export interface ZiQuYaoSu {
  id: string; ming: string; fragment: string;
  mandatory: boolean;
  trials: number; rewardSum: number;
  source: 'builtin' | 'model';
  removed?: boolean;
}
export interface ZiQuFanKui { ts: number; sid: string; signal: ZiQuSignal; reward: number; elements: string[]; reason?: string; detailTopic?: string }
export interface ZiQuPending { ts: number; elements: string[]; detailTopic?: string }
export interface ZiQuZhiLiangZhuangTai {
  yaoSu: ZiQuYaoSu[];
  ledger: ZiQuFanKui[];
  totalPulls: number;
  pending: Record<string, ZiQuPending>;
}
export interface ZiQuYaoSuCaiJue { add?: Array<{ id?: string; ming?: string; fragment?: string }>; remove?: string[] }

const MO_REN_YAO_SU: ZiQuYaoSu[] = [
  { id: 'plan', ming: '计划方案', fragment: '计划方案（具体怎么做）', mandatory: true, trials: 0, rewardSum: 0, source: 'builtin' },
  { id: 'reason', ming: '理由', fragment: '理由（为什么这样推进）', mandatory: true, trials: 0, rewardSum: 0, source: 'builtin' },
  { id: 'proscons', ming: '优缺点', fragment: '优缺点', mandatory: true, trials: 0, rewardSum: 0, source: 'builtin' },
  { id: 'cost', ming: '成本', fragment: '成本（时间/token/资源）', mandatory: true, trials: 0, rewardSum: 0, source: 'builtin' },
  { id: 'effect', ming: '预期效果', fragment: '预期效果', mandatory: true, trials: 0, rewardSum: 0, source: 'builtin' },
  { id: 'ask', ming: '询问用户', fragment: '最后询问用户：是否按此计划进行，还是有其他打算', mandatory: true, trials: 0, rewardSum: 0, source: 'builtin' },
];
const LEDGER_SHANG = 300;

/** UCB1 分数（n=0 ⇒ +∞ 优先探索；否则 mean + sqrt(2 ln T / n)）。proved sublinear regret。 */
export function ucb1Score(s: { trials: number; rewardSum: number }, totalPulls: number): number {
  if (s.trials <= 0) return Number.POSITIVE_INFINITY;
  const mean = s.rewardSum / s.trials;
  return mean + Math.sqrt((2 * Math.log(Math.max(1, totalPulls))) / s.trials);
}

/** 确定性反馈信号分类（不赞同优先〔否定更强〕→ 追问细节 → 赞同 → 其他）。总结时模型可更精确重判。 */
export function fenLeiXinHao(wen: string): ZiQuSignal {
  const s = String(wen || '');
  if (/不要|不行|反对|不对|不好|不同意|不赞同|错了|不是这|别这样|停止|取消/.test(s)) return 'disagree';
  if (/？|\?|详细|具体|怎么|为什么|展开|细节|能不能说|多说|举例/.test(s)) return 'ask-detail';
  if (/同意|赞同|可以|不错|好的|就这样|继续|按这个|没问题|支持|赞成|行/.test(s)) return 'agree';
  return 'other';
}

export interface ZiQuZhiLiangYiLai {
  du: () => ZiQuZhiLiangZhuangTai | undefined;
  cun: (j: ZiQuZhiLiangZhuangTai) => void;
  auditLog: (op: string, detail: unknown) => void;
  shiZhong: () => number;
}

export function chuangJianZiQuZhiLiang(yiLai: ZiQuZhiLiangYiLai) {
  let zt: ZiQuZhiLiangZhuangTai = { yaoSu: MO_REN_YAO_SU.map((x) => ({ ...x })), ledger: [], totalPulls: 0, pending: {} };
  let yiDu = false;
  function duHui(): void {
    if (yiDu) return;
    yiDu = true;
    try {
      const j = yiLai.du();
      if (j && Array.isArray(j.yaoSu) && j.yaoSu.length) {
        const you = new Map(j.yaoSu.map((x) => [x.id, x]));
        for (const mo of MO_REN_YAO_SU) if (!you.has(mo.id)) you.set(mo.id, { ...mo });
        zt.yaoSu = [...you.values()];
        zt.ledger = Array.isArray(j.ledger) ? j.ledger.slice(-LEDGER_SHANG) : [];
        zt.totalPulls = Number(j.totalPulls) || 0;
        zt.pending = (j.pending && typeof j.pending === 'object') ? j.pending : {};
      }
    } catch { /* 读不回按内建 */ }
  }
  function luoPan(): void { try { yiLai.cun({ ...zt, ledger: zt.ledger.slice(-LEDGER_SHANG) }); } catch { /* noop */ } }
  function huoYaoSu(): ZiQuYaoSu[] { duHui(); return zt.yaoSu.filter((x) => !x.removed); }

  /** UCB1 选择：必选全纳入＋可选按 UCB1 分数取前 N。返回选中元素 id。 */
  function xuanYaoSu(): string[] {
    duHui();
    const huo = huoYaoSu();
    const bi = huo.filter((x) => x.mandatory).map((x) => x.id);
    const ke = huo.filter((x) => !x.mandatory)
      .map((x) => ({ id: x.id, score: ucb1Score(x, zt.totalPulls) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, ZI_QU_KE_XUAN_SHANG_XIAN)
      .map((x) => x.id);
    return [...bi, ...ke];
  }

  /** 构造演化提示词：必选＋UCB1 可选元素 fragment＋上次追问细节预告＋上下文。返回 prompt 与选中元素。 */
  function gouZaoTiShi(sid: string, ming: string, shangCiTs: number, shangXiaWen: string, huiHuaMing: string): { prompt: string; elements: string[] } {
    duHui();
    const elements = xuanYaoSu();
    const huo = huoYaoSu();
    const youXiao = elements.map((id) => huo.find((x) => x.id === id)).filter((x): x is ZiQuYaoSu => !!x);
    // 必选里 ask 单独放最后；其余按编号列出
    const lieBiao = youXiao.filter((x) => x.id !== 'ask');
    const ask = youXiao.find((x) => x.id === 'ask');
    const bianHao = lieBiao.map((x, i) => `${i + 1}. ${x.fragment}`).join('；');
    const xinZeng = shangCiTs > 0
      ? `上次自驱以来（${new Date(shangCiTs).toISOString()} 之后）请聚焦新增内容，不要重复改进/查看过的旧内容。`
      : '这是本会话首次自驱。';
    // 上次该会话追问细节 ⇒ 这次预先一次性告知
    const shangCi = [...zt.ledger].reverse().find((x) => x.sid === sid && x.signal === 'ask-detail' && x.detailTopic);
    const xiJieYuGao = shangCi ? `\n上次用户追问了「${shangCi.detailTopic}」，这次请预先一次性把相关细节讲清楚，不要等用户再问。` : '';
    const prompt = `你是牛马「${ming}」，正在对会话「${huiHuaMing}」做一次自驱（自主推进）。${xinZeng}\n`
      + '请查看下面本会话的上下文与历史记录等全部内容，然后给出**下一步计划**，并逐项说明：\n'
      + (bianHao || '计划方案') + '。'
      + (ask ? `\n${ask.fragment}。` : '\n最后询问用户是否按此计划进行。')
      + '\n语气自主、简洁、可执行；不要寒暄，不要替用户拍板。' + xiJieYuGao + '\n\n'
      + '【会话上下文/历史】\n' + (shangXiaWen || '（本会话暂无内容）');
    return { prompt, elements };
  }

  /** 记录一次自驱发出（待反馈）。 */
  function jiLuFaSong(sid: string, elements: string[]): void {
    duHui();
    zt.pending[sid] = { ts: yiLai.shiZhong(), elements: [...elements] };
    luoPan();
  }

  /** 内部：把反馈计入元素统计＋台账。 */
  function jiFanKui(sid: string, signal: ZiQuSignal, reason?: string, detailTopic?: string): void {
    const pd = zt.pending[sid];
    if (!pd) return;
    const reward = ZI_QU_REWARD[signal];
    for (const id of pd.elements) {
      const s = zt.yaoSu.find((x) => x.id === id);
      if (s) { s.trials += 1; s.rewardSum += reward; }
    }
    zt.totalPulls += 1;
    zt.ledger.push({ ts: yiLai.shiZhong(), sid, signal, reward, elements: [...pd.elements], reason, detailTopic });
    if (zt.ledger.length > LEDGER_SHANG) zt.ledger = zt.ledger.slice(-LEDGER_SHANG);
    delete zt.pending[sid];
    try { yiLai.auditLog('ziQu.feedback', { sessionId: sid, signal, reward, elements: pd.elements }); } catch { /* noop */ }
    luoPan();
  }

  /** 用户回复捕获：分类信号＋记录（追问细节提取主题）。有 pending 才记。 */
  function yongHuHuiFu(sid: string, wen: string): ZiQuSignal | null {
    duHui();
    if (!zt.pending[sid]) return null;
    const signal = fenLeiXinHao(wen);
    let detailTopic: string | undefined;
    if (signal === 'ask-detail') detailTopic = String(wen || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    jiFanKui(sid, signal, undefined, detailTopic);
    return signal;
  }

  /** 超时未回复扫描：pending 超过 24h ⇒ no-reply 弱负反馈（不确定，不重罚）。 */
  function saoMiaoWuHuiFu(): number {
    duHui();
    const now = yiLai.shiZhong();
    let n = 0;
    for (const sid of Object.keys(zt.pending)) {
      const pd = zt.pending[sid];
      if (pd && now - pd.ts >= ZI_QU_WU_HUI_FU_MS) { jiFanKui(sid, 'no-reply'); n++; }
    }
    return n;
  }

  /** 总结裁决演化元素：增（模型新元素， fragment 收窄防注入）/删（标记 removed，内建必选不可删）。 */
  function yanHuaYaoSu(pan: ZiQuYaoSuCaiJue): { add: number; remove: number } {
    duHui();
    let add = 0, remove = 0;
    for (const r of pan.remove || []) {
      const s = zt.yaoSu.find((x) => x.id === r);
      if (s && !s.mandatory && !s.removed) { s.removed = true; remove++; }
    }
    for (const a of pan.add || []) {
      const id = String(a.id || '').trim().slice(0, 40);
      const fragment = String(a.fragment || '').trim().slice(0, 200);
      if (!id || !fragment || zt.yaoSu.some((x) => x.id === id)) continue;
      zt.yaoSu.push({ id, ming: String(a.ming || id).slice(0, 40), fragment, mandatory: false, trials: 0, rewardSum: 0, source: 'model' });
      add++;
    }
    if (add || remove) { try { yiLai.auditLog('ziQu.template-evolved', { add, remove }); } catch { /* noop */ } luoPan(); }
    return { add, remove };
  }

  /** 总结提示词段：元素注册表＋UCB1 统计＋近期反馈＋演化裁决格式。 */
  function zongJieDuan(): string {
    duHui();
    const biao = huoYaoSu().map((x) => `- ${x.id}｜${x.ming}｜${x.mandatory ? '必选' : '可选'}｜试 ${x.trials} 奖 ${x.rewardSum.toFixed(2)}｜UCB1 ${x.trials ? ucb1Score(x, zt.totalPulls).toFixed(3) : '∞(待探索)'}${x.source === 'model' ? '｜模型 added' : ''}`).join('\n');
    const fk = zt.ledger.slice(-15).map((x) => `- ${x.sid} ${x.signal}(${x.reward})${x.reason ? ' ' + x.reason.slice(0, 50) : ''}${x.detailTopic ? ' 追问:' + x.detailTopic.slice(0, 30) : ''}`).join('\n');
    return '\n【自驱质量自我改进（UCB1 多臂赌博机，proved sublinear regret ⇒ 质量持续提升）】\n'
      + '元素注册表（必选为基线，可选由 UCB1 按反馈选择）：\n' + biao
      + '\n近期用户反馈（赞同+1/不赞同-1/追问细节+0.2/无回复-0.3弱负不确定/其他0）：\n' + (fk || '（无）')
      + '\n请分析反馈以提升自驱质量：不赞同⇒分析不赞同什么/为何；追问细节⇒下次预先告知；无回复⇒可能质量不高/没兴趣/不在计划/没看懂（不确定，勿过度归因）。'
      + '可自由增删可选元素（必选不可删）。在整理结果末尾单独一行输出：【自驱裁决】{"add":[{"id":"risk","ming":"风险预警","fragment":"潜在风险与规避"}],"remove":["id"]}'
      + '（fragment≤200字、id≤40字、不重复；没有可改就输出空 add/remove。）\n';
  }

  /** 解析总结里的自驱裁决块。 */
  function jieXiCaiJue(txt: string): ZiQuYaoSuCaiJue | null {
    const m = /【自驱裁决】\s*(\{[\s\S]*?\})\s*(?:\n|$)/.exec(String(txt || ''));
    if (!m || !m[1]) return null;
    try {
      const j = JSON.parse(m[1]) as ZiQuYaoSuCaiJue;
      return { add: Array.isArray(j.add) ? j.add : [], remove: Array.isArray(j.remove) ? j.remove.map(String) : [] };
    } catch { return null; }
  }
  function boLiCaiJueKuai(txt: string): string {
    return String(txt || '').replace(/\n?【自驱裁决】\s*\{[\s\S]*?\}\s*(?:\n|$)/, '').trim();
  }

  return {
    xuanYaoSu, gouZaoTiShi, jiLuFaSong, yongHuHuiFu, saoMiaoWuHuiFu, yanHuaYaoSu, zongJieDuan, jieXiCaiJue, boLiCaiJueKuai,
    get yaoSu() { duHui(); return zt.yaoSu; },
    get ledger() { duHui(); return zt.ledger; },
    get totalPulls() { duHui(); return zt.totalPulls; },
  };
}