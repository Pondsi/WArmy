/**
 * R297 自驱质量自我改进唯一 owner（数学方案：UCB1 多臂赌博机）。
 *
 * 自驱提示词由「元素」组成（计划/确认必留；理由、优缺点、成本、效果是可改可删的初始模板）。
 * 每个可选元素是一个「臂」；用户反馈是奖励。用 UCB1（Auer, Cesa-Bianchi & Fischer 2002）选择元素：
 *   score_i = mean_i + sqrt(2 ln T / n_i)（n_i=0 时 +∞ 优先探索）。
 * 标准 UCB1 在固定单臂、独立平稳奖励前提下有次线性 regret 界；这里多元素共享反馈是启发式，
 * 不承诺质量单调提升。硬约束由独立程序保证（适用边界见 docs/ZI-QU-ZHI-LIANG-R297.md）。
 *
 * 反馈信号（用户对该次自驱的下一条回复）→ 奖励：
 *   赞同 agree=+1（好自驱）；不赞同 disagree=-1（坏自驱，总结分析不赞同什么/为何）；
 *   追问细节 ask-detail=+0.2（有参与但缺细节 ⇒ 下次把该细节预先一次性告知）；
 *   无回复 no-reply=-0.3（弱负、不确定：可能质量不高/用户没兴趣/进度不在计划内/没看懂，不重罚）；
 *   其他 other=0。
 * 总结时：模型看元素注册表＋反馈台账＋UCB1 统计，裁决增删/调整元素（语义演化），与 UCB1（统计选择）互补。
 * 状态落盘持久化；构造无副作用。
 */
import { guiFanZiQuYueShu, gaiJinZiQuYueShu, ziQuPianDuanAnQuan, type ZiQuYingYueShu, type ZiQuYingJianYan, type ZiQuNeiRongXiang } from '../ji-chu/zi-qu-ying-yue-shu.js';

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
  constraints?: ZiQuYingYueShu;
  outputChecks?: Array<ZiQuYingJianYan & { ts: number; sid: string }>;
}
export interface ZiQuYaoSuCaiJue { add?: Array<{ id?: string; ming?: string; fragment?: string }>; remove?: string[]; update?: Array<{ id?: string; ming?: string; fragment?: string }>; constraints?: unknown }

const MO_REN_YAO_SU: ZiQuYaoSu[] = [
  { id: 'plan', ming: '计划方案', fragment: '计划方案（具体怎么做）', mandatory: true, trials: 0, rewardSum: 0, source: 'builtin' },
  { id: 'reason', ming: '理由', fragment: '理由（为什么这样推进）', mandatory: false, trials: 0, rewardSum: 0, source: 'builtin' },
  { id: 'proscons', ming: '优缺点', fragment: '优缺点', mandatory: false, trials: 0, rewardSum: 0, source: 'builtin' },
  { id: 'cost', ming: '成本', fragment: '成本（时间/token/资源）', mandatory: false, trials: 0, rewardSum: 0, source: 'builtin' },
  { id: 'effect', ming: '预期效果', fragment: '预期效果', mandatory: false, trials: 0, rewardSum: 0, source: 'builtin' },
  { id: 'ask', ming: '询问用户', fragment: '最后询问用户：是否按此计划进行，还是有其他打算', mandatory: true, trials: 0, rewardSum: 0, source: 'builtin' },
];
const LEDGER_SHANG = 300;

/** UCB1 形式分数：将反馈 [-1,1] 归一到 [0,1] 后加探索半径；不把组合反馈当单臂定理。 */
export function ucb1Score(s: { trials: number; rewardSum: number }, totalPulls: number): number {
  if (s.trials <= 0) return Number.POSITIVE_INFINITY;
  const mean = Math.max(0, Math.min(1, (s.rewardSum / s.trials + 1) / 2));
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
  onFeedback?: () => void;
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
        const safe = j.yaoSu.slice(0, 40).filter((x) => x && typeof x.id === 'string' && /^[a-z][a-z0-9_-]{0,39}$/.test(x.id)
          && ziQuPianDuanAnQuan(x.fragment) && ziQuPianDuanAnQuan(x.ming)
          && Number.isFinite(x.trials) && x.trials >= 0 && Number.isFinite(x.rewardSum));
        const you = new Map(safe.map((x) => [x.id, { ...x, mandatory: false }]));
        for (const mo of MO_REN_YAO_SU) {
          const old = you.get(mo.id);
          you.set(mo.id, { ...(old || mo), mandatory: mo.mandatory, ...(mo.mandatory ? { removed: false } : {}) });
        }
        zt.yaoSu = [...you.values()];
        zt.ledger = Array.isArray(j.ledger) ? j.ledger.slice(-LEDGER_SHANG) : [];
        zt.totalPulls = Number(j.totalPulls) || 0;
        zt.pending = (j.pending && typeof j.pending === 'object') ? j.pending : {};
        if (j.constraints) zt.constraints = guiFanZiQuYueShu(j.constraints);
        if (Array.isArray(j.outputChecks)) zt.outputChecks = j.outputChecks.slice(-100);
      }
    } catch { /* 读不回按内建 */ }
  }
  function luoPan(): void { try { yiLai.cun({ ...zt, ledger: zt.ledger.slice(-LEDGER_SHANG) }); } catch { /* noop */ } }
  function huoYaoSu(): ZiQuYaoSu[] { duHui(); return zt.yaoSu.filter((x) => !x.removed); }
  function huoYingYueShu(): ZiQuYingYueShu { duHui(); return guiFanZiQuYueShu(zt.constraints); }
  function jiLuYingJianYan(sid: string, report: ZiQuYingJianYan): void {
    duHui();
    zt.outputChecks = [...(zt.outputChecks || []), { ts: yiLai.shiZhong(), sid, ok: report.ok, chars: report.chars, codes: [...report.codes] }].slice(-100);
    yiLai.onFeedback?.();
    luoPan();
  }

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
  function gouZaoTiShi(sid: string, ming: string, shangCiTs: number, shangXiaWen: string, huiHuaMing: string): { prompt: string; elements: string[]; sections: ZiQuNeiRongXiang[] } {
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
    return { prompt, elements, sections: lieBiao.map(({ id, ming, fragment }) => ({ id, ming, fragment })) };
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
    yiLai.onFeedback?.();
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
    if (!pan || typeof pan !== 'object') return { add, remove };
    for (const r of Array.isArray(pan.remove) ? pan.remove.slice(0, 40) : []) {
      const s = zt.yaoSu.find((x) => x.id === r);
      if (s && !s.mandatory && !s.removed) { s.removed = true; remove++; }
    }
    for (const a of Array.isArray(pan.add) ? pan.add.slice(0, 20) : []) {
      if (!a || typeof a !== 'object') continue;
      const id = String(a.id || '').trim().slice(0, 40);
      const fragment = String(a.fragment || '').trim().slice(0, 200);
      if (!/^[a-z][a-z0-9_-]{0,39}$/.test(id) || !ziQuPianDuanAnQuan(fragment)
        || !ziQuPianDuanAnQuan(String(a.ming || id))) continue;
      const old = zt.yaoSu.find((x) => x.id === id);
      if (old) {
        if (!old.removed || old.mandatory) continue;
        old.removed = false; old.fragment = fragment; old.ming = String(a.ming || id).slice(0, 40);
        old.trials = 0; old.rewardSum = 0;
      } else {
        if (zt.yaoSu.length >= 40) continue;
        zt.yaoSu.push({ id, ming: String(a.ming || id).slice(0, 40), fragment, mandatory: false, trials: 0, rewardSum: 0, source: 'model' });
      }
      add++;
    }
    let updated = 0, constrained = false;
    for (const u of Array.isArray(pan.update) ? pan.update.slice(0, 20) : []) {
      if (!u || typeof u !== 'object' || !ziQuPianDuanAnQuan(u.fragment)) continue;
      const s = zt.yaoSu.find((x) => x.id === u.id && !x.removed);
      if (!s || (u.ming !== undefined && !ziQuPianDuanAnQuan(u.ming))) continue;
      s.fragment = u.fragment; if (u.ming) s.ming = u.ming;
      s.trials = 0; s.rewardSum = 0; updated++;
    }
    if (pan.constraints !== undefined) {
      const next = gaiJinZiQuYueShu(huoYingYueShu(), pan.constraints);
      if (next) { zt.constraints = next; constrained = true; }
      else { try { yiLai.auditLog('ziQu.constraint-rejected', { reason: 'outside-envelope' }); } catch { /* noop */ } }
    }
    if (add || remove || updated || constrained) { try { yiLai.auditLog('ziQu.template-evolved', { add, remove, updated, constrained }); } catch { /* noop */ } luoPan(); }
    return { add, remove };
  }

  /** 总结提示词段：元素注册表＋UCB1 统计＋近期反馈＋演化裁决格式。 */
  function zongJieDuan(): string {
    duHui();
    const biao = huoYaoSu().map((x) => `- ${x.id}｜${x.ming}｜${x.mandatory ? '必选' : '可选'}｜试 ${x.trials} 奖 ${x.rewardSum.toFixed(2)}｜UCB1 ${x.trials ? ucb1Score(x, zt.totalPulls).toFixed(3) : '∞(待探索)'}${x.source === 'model' ? '｜模型 added' : ''}`).join('\n');
    const fk = zt.ledger.slice(-15).map((x) => `- ${x.sid} ${x.signal}(${x.reward})${x.reason ? ' ' + x.reason.slice(0, 50) : ''}${x.detailTopic ? ' 追问:' + x.detailTopic.slice(0, 30) : ''}`).join('\n');
    const checks = (zt.outputChecks || []).slice(-10).map(({ ok, chars, codes }) => ({ ok, chars, codes }));
    return '\n【自驱质量自我改进（UCB1 形式探索；组合反馈不保证质量单调提升）】\n'
      + '程序硬约束与近期校验统计（没有候选原文，失败不算用户负反馈）：' + JSON.stringify({ constraints: huoYingYueShu(), checks }) + '\n'
      + '可以在120–900非空白Unicode字符包络内调整minChars/maxChars（范围至少80），用forbidAdd补充字面禁说项（最多20条、每条4–60字符）；不可关闭校验、删安全底线或加入任意正则。'
      + '元素注册表（必选为基线，可选由 UCB1 按反馈选择）：\n' + biao
      + '\n近期用户反馈（赞同+1/不赞同-1/追问细节+0.2/无回复-0.3弱负不确定/其他0）：\n' + (fk || '（无）')
      + '\n请分析反馈以提升自驱质量：不赞同⇒分析不赞同什么/为何；追问细节⇒下次预先告知；无回复⇒可能质量不高/没兴趣/不在计划/没看懂（不确定，勿过度归因）。'
      + '理由/优缺点/成本/效果只是初始模板，可自由增删；仅plan/ask为提案和用户确认底线。可用update改进已有元素的fragment；每个新片段也过程序安全闸。'
      + '在结果末尾单独一行输出：【自驱裁决】{"add":[],"remove":[],"update":[],"constraints":{"minChars":180,"maxChars":600,"forbidAdd":[]}}'
      + '（fragment≤200字、id为小写字母数字下划线短横线≤40字；无变化请只输出空add/remove。不要通过字数收窄掩盖失败。）\n';
  }

  /** 解析总结里的自驱裁决块。 */
  function jieXiCaiJue(txt: string): ZiQuYaoSuCaiJue | null {
    const m = /【自驱裁决】\s*(\{[\s\S]*?\})\s*(?:\n|$)/.exec(String(txt || ''));
    if (!m || !m[1]) return null;
    try {
      const j = JSON.parse(m[1]) as ZiQuYaoSuCaiJue;
      if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
      return { add: Array.isArray(j.add) ? j.add : [], remove: Array.isArray(j.remove) ? j.remove.map(String) : [],
        ...(Array.isArray(j.update) ? { update: j.update } : {}), ...(j.constraints !== undefined ? { constraints: j.constraints } : {}) };
    } catch { return null; }
  }
  function boLiCaiJueKuai(txt: string): string {
    return String(txt || '').replace(/\n?【自驱裁决】\s*\{[\s\S]*?\}\s*(?:\n|$)/g, '').trim();
  }

  return {
    xuanYaoSu, gouZaoTiShi, jiLuFaSong, yongHuHuiFu, saoMiaoWuHuiFu, yanHuaYaoSu, zongJieDuan, jieXiCaiJue, boLiCaiJueKuai, huoYingYueShu, jiLuYingJianYan,
    get yaoSu() { duHui(); return zt.yaoSu; },
    get ledger() { duHui(); return zt.ledger; },
    get totalPulls() { duHui(); return zt.totalPulls; },
  };
}