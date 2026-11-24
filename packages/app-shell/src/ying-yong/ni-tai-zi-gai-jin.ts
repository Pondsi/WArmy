/** 拟态全面自我改进：有界台账、受限候选、显式批准、实际策略消费与下一批复盘回滚。 */
export type NiTaiYuYu = 'frequency' | 'style' | 'reply' | 'screen' | 'camera' | 'mic' | 'speaker';
export type NiTaiShiJianLei = 'trigger' | 'complete' | 'fail' | 'revoke' | 'release' | 'feedback';
export interface NiTaiZiGaiShiJian {
  ts: number;
  domain: NiTaiYuYu;
  kind: NiTaiShiJianLei;
  ok: boolean;
  detail?: string;
  durationMs?: number;
}
export interface NiTaiZiGaiCeLue {
  /** 互动频率倍率；只改已有运行的节流/感知间隔，不扩大采集范围。 */
  frequencyScale: number;
  /** 单条回复最多播放的已有动作数。 */
  maxActions: number;
  replyStyle: 'balanced' | 'concise';
  actionStyle: 'natural' | 'calm';
}
export interface NiTaiZiGaiHouXuan {
  id: string;
  domain: NiTaiYuYu;
  patch: Partial<NiTaiZiGaiCeLue>;
  ts: number;
  status: 'suggested' | 'applied' | 'rolled-back' | 'rejected';
  reason: string;
  ceng: number;
  baseVersion: number;
  appliedAt?: number;
  reviewedAt?: number;
  evidence?: {
    sampleCount: number;
    failCount: number;
    revokeCount: number;
    feedbackUp: number;
    feedbackDown: number;
    qualityDelta: number;
    efficiencyGainPct: number;
    costDeltaPct: number;
    unknown: boolean;
    isolated: boolean;
  };
}
export interface NiTaiZiGaiZhuangTai {
  version: number;
  ledger: NiTaiZiGaiShiJian[];
  candidates: NiTaiZiGaiHouXuan[];
  lastReviewAt: number;
  active: NiTaiZiGaiCeLue;
  /** 最近一个已生效候选的前版，供下一批可复现退化时回滚。 */
  previous?: { candidateId: string; policy: NiTaiZiGaiCeLue } | null;
}
export const NI_TAI_ZI_GAI_SHANG = 500;
export const NI_TAI_ZI_GAI_SHEN_CENG = 3;
export const NI_TAI_ZI_GAI_MOREN: NiTaiZiGaiCeLue = { frequencyScale: 1, maxActions: 3, replyStyle: 'balanced', actionStyle: 'natural' };
const YU_YU: readonly string[] = ['frequency', 'style', 'reply', 'screen', 'camera', 'mic', 'speaker'];
const LEI: readonly string[] = ['trigger', 'complete', 'fail', 'revoke', 'release', 'feedback'];
const zhuangTai: readonly string[] = ['suggested', 'applied', 'rolled-back', 'rejected'];
const shu = (v: unknown, xia: number, shang: number, que: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(shang, Math.max(xia, n)) : que;
};
function zhengLiCeLue(raw: unknown): NiTaiZiGaiCeLue {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<NiTaiZiGaiCeLue>;
  return {
    frequencyScale: shu(o.frequencyScale, 0.5, 2, 1),
    maxActions: Math.round(shu(o.maxActions, 1, 3, 3)),
    replyStyle: o.replyStyle === 'concise' ? 'concise' : 'balanced',
    actionStyle: o.actionStyle === 'calm' ? 'calm' : 'natural',
  };
}
/** 候选只接受声明式白名单字段；设备权限/仲裁/固定设备即使出现在旧文件里也不会进入策略。 */
function zhengLiBuFen(raw: unknown): Partial<NiTaiZiGaiCeLue> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const out: Partial<NiTaiZiGaiCeLue> = {};
  if (Object.hasOwn(o, 'frequencyScale')) out.frequencyScale = shu(o.frequencyScale, 0.5, 2, 1);
  if (Object.hasOwn(o, 'maxActions')) out.maxActions = Math.round(shu(o.maxActions, 1, 3, 3));
  if (o.replyStyle === 'concise' || o.replyStyle === 'balanced') out.replyStyle = o.replyStyle;
  if (o.actionStyle === 'calm' || o.actionStyle === 'natural') out.actionStyle = o.actionStyle;
  return out;
}
export function kongNiTaiZiGai(): NiTaiZiGaiZhuangTai {
  return { version: 1, ledger: [], candidates: [], lastReviewAt: 0, active: { ...NI_TAI_ZI_GAI_MOREN }, previous: null };
}
export function guiFanNiTaiZiGai(raw: unknown): NiTaiZiGaiZhuangTai {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<NiTaiZiGaiZhuangTai>;
  const ledger = Array.isArray(o.ledger) ? o.ledger.filter((x) => x && YU_YU.includes(String(x.domain)) && LEI.includes(String(x.kind)) && Number.isFinite(Number(x.ts))).map((x) => ({
    ts: Number(x.ts), domain: x.domain as NiTaiYuYu, kind: x.kind as NiTaiShiJianLei, ok: x.ok !== false,
    detail: String(x.detail || '').slice(0, 120), durationMs: Number.isFinite(Number(x.durationMs)) ? Math.max(0, Number(x.durationMs)) : undefined,
  })).slice(-NI_TAI_ZI_GAI_SHANG) : [];
  const candidates = Array.isArray(o.candidates) ? o.candidates.filter((x) => x && YU_YU.includes(String(x.domain))).map((x) => ({
    id: String(x.id || ''), domain: x.domain as NiTaiYuYu, patch: zhengLiBuFen(x.patch), ts: Number(x.ts) || 0,
    status: zhuangTai.includes(String(x.status)) ? x.status as NiTaiZiGaiHouXuan['status'] : 'suggested',
    reason: String(x.reason || '历史候选').slice(0, 300), ceng: Math.round(shu(x.ceng, 1, NI_TAI_ZI_GAI_SHEN_CENG, 1)),
    baseVersion: Math.max(1, Math.round(Number(x.baseVersion) || 1)), appliedAt: Number(x.appliedAt) || undefined, reviewedAt: Number(x.reviewedAt) || undefined,
    evidence: x.evidence && typeof x.evidence === 'object' ? {
      sampleCount: Math.max(0, Math.round(Number(x.evidence.sampleCount) || 0)), failCount: Math.max(0, Math.round(Number(x.evidence.failCount) || 0)),
      revokeCount: Math.max(0, Math.round(Number(x.evidence.revokeCount) || 0)), feedbackUp: Math.max(0, Math.round(Number(x.evidence.feedbackUp) || 0)),
      feedbackDown: Math.max(0, Math.round(Number(x.evidence.feedbackDown) || 0)), qualityDelta: Number(x.evidence.qualityDelta) || 0,
      efficiencyGainPct: Number(x.evidence.efficiencyGainPct) || 0, costDeltaPct: Number(x.evidence.costDeltaPct) || 0,
      unknown: x.evidence.unknown !== false, isolated: x.evidence.isolated === true,
    } : undefined,
  })).filter((x) => x.id).slice(-50) : [];
  const previous = o.previous && typeof o.previous === 'object' && typeof o.previous.candidateId === 'string'
    ? { candidateId: o.previous.candidateId, policy: zhengLiCeLue(o.previous.policy) } : null;
  /* 旧版只有 applied 候选、没有 active 策略：迁移时恢复最后一次已批准补丁。 */
  const jiYing = candidates.filter((x) => x.status === 'applied').sort((a, b) => b.ts - a.ts)[0];
  const active = o.active && typeof o.active === 'object' ? zhengLiCeLue(o.active) : zhengLiCeLue({ ...NI_TAI_ZI_GAI_MOREN, ...(jiYing?.patch || {}) });
  return { version: Math.max(1, Math.round(Number(o.version) || 1)), ledger, candidates, lastReviewAt: Number(o.lastReviewAt) || 0, active, previous };
}
export function jiLuNiTaiShiJian(st: NiTaiZiGaiZhuangTai, e: Omit<NiTaiZiGaiShiJian, 'ts'>, ts = Date.now()): NiTaiZiGaiZhuangTai {
  return { ...st, ledger: [...st.ledger, { ...e, ts, detail: String(e.detail || '').slice(0, 120), durationMs: Number.isFinite(Number(e.durationMs)) ? Math.max(0, Number(e.durationMs)) : undefined }].slice(-NI_TAI_ZI_GAI_SHANG) };
}
/** 从回复文本提取已有动作标签；稳定去重并执行 maxActions 上限。 */
export function niTaiDongZuoXuanZe(text: string, maxActions = 3): string[] {
  const out: string[] = [];
  const re = /【动作[:：]\s*([^】]{1,80})】/g;
  for (const m of String(text || '').matchAll(re)) {
    const ming = String(m[1] || '').trim();
    if (ming && !out.includes(ming)) out.push(ming);
    if (out.length >= Math.round(shu(maxActions, 1, 3, 3))) break;
  }
  return out;
}
export function niTaiDongZuoXianZhi(policy: NiTaiZiGaiCeLue): number { return policy.actionStyle === 'calm' ? 1 : Math.round(shu(policy.maxActions, 1, 3, 3)); }
/** 频率倍率只改变等待间隔；默认 1 保持原行为，每次提案最多减半/翻倍并由硬包络夹取。 */
export function niTaiShiJianJianGe(baseMs: number, policy: NiTaiZiGaiCeLue, minMs = 5000, maxMs = 300000): number {
  return Math.round(shu(Number(baseMs) / shu(policy.frequencyScale, 0.5, 2, 1), minMs, maxMs, minMs));
}
export function niTaiHuiFengGe(policy: NiTaiZiGaiCeLue): string {
  return policy.replyStyle === 'concise'
    ? '当前已批准回复策略：简洁。先给结论，避免重复铺垫，单次互动回复控制在80字以内。'
    : '当前已批准回复策略：均衡。保持自然简短，先回答用户，再补充必要信息。';
}
function tongJi(st: NiTaiZiGaiZhuangTai, events: NiTaiZiGaiShiJian[]) {
  const fail = events.filter((x) => !x.ok || x.kind === 'fail').length;
  const revoke = events.filter((x) => x.kind === 'revoke').length;
  const up = events.filter((x) => x.domain === 'reply' && x.kind === 'feedback' && x.ok).length;
  const down = events.filter((x) => x.domain === 'reply' && x.kind === 'feedback' && !x.ok).length;
  return { fail, revoke, up, down, failRate: events.length ? fail / events.length : 0 };
}
/** 下一批实测复盘：样本足够且退化可复现才回滚；证据不足只继续观察。 */
export function fuPanNiTaiGaiJin(st: NiTaiZiGaiZhuangTai, now = Date.now()): { state: NiTaiZiGaiZhuangTai; rolledBack: boolean } {
  const c = st.candidates.filter((x) => x.status === 'applied' && x.appliedAt).sort((a, b) => (b.appliedAt || 0) - (a.appliedAt || 0))[0];
  if (!c || !st.previous || st.previous.candidateId !== c.id || c.reviewedAt) return { state: st, rolledBack: false };
  const fresh = st.ledger.filter((x) => x.ts > (c.appliedAt || 0) && x.ts <= now);
  if (fresh.length < 6) return { state: st, rolledBack: false };
  const t = tongJi(st, fresh), base = c.evidence?.sampleCount ? c.evidence.failCount / c.evidence.sampleCount : 0;
  const repeatedFailure = t.fail >= 2 && new Set(fresh.filter((x) => !x.ok).map((x) => x.detail || x.domain)).size < t.fail;
  const sameFailurePersists = base >= 0.95 && t.failRate >= 0.95;
  const degraded = t.revoke >= 2 || (t.fail >= 2 && repeatedFailure && (sameFailurePersists || t.failRate > base + 0.05)) || (t.down >= 2 && t.down > t.up);
  if (!degraded) return { state: { ...st, candidates: st.candidates.map((x) => x.id === c.id ? { ...x, reviewedAt: now } : x) }, rolledBack: false };
  return { state: {
    ...st, version: st.version + 1, lastReviewAt: now, active: { ...st.previous.policy }, previous: null,
    candidates: st.candidates.map((x) => x.id === c.id ? { ...x, status: 'rolled-back', reviewedAt: now } : x),
  }, rolledBack: true };
}
/** 每次最多一个候选；无可靠对照只建议，绝不自动生效。 */
export function tiAnNiTaiGaiJin(st: NiTaiZiGaiZhuangTai, now = Date.now()): { state: NiTaiZiGaiZhuangTai; applied: number; suggested: number; rolledBack: boolean } {
  const review = fuPanNiTaiGaiJin(st, now), base = review.state;
  if (review.rolledBack) return { state: base, applied: 0, suggested: 0, rolledBack: true };
  if (base.candidates.some((x) => x.status === 'suggested')) return { state: base, applied: 0, suggested: 0, rolledBack: false };
  /* 已生效策略必须先完成下一批复盘，不在观察期内叠加新策略。 */
  if (base.candidates.some((x) => x.status === 'applied' && !x.reviewedAt)) return { state: { ...base, lastReviewAt: now }, applied: 0, suggested: 0, rolledBack: false };
  const fresh = base.ledger.filter((x) => x.ts > base.lastReviewAt && x.ts <= now);
  if (!fresh.length) return { state: base, applied: 0, suggested: 0, rolledBack: false };
  const t = tongJi(base, fresh), patch: Partial<NiTaiZiGaiCeLue> = {};
  const pinFan = fresh.filter((x) => x.domain === 'frequency' && x.kind === 'feedback'
    && /^perception-feedback:/.test(x.detail || ''))
    .map((x) => Number(String(x.detail || '').slice('perception-feedback:'.length)))
    .filter((v) => Number.isFinite(v) && v !== 0);
  const noisy = pinFan.filter((v) => v > 0).length, missed = pinFan.filter((v) => v < 0).length;
  if (t.revoke > 0 || t.failRate > 1 / 3 || noisy > missed) patch.frequencyScale = Math.max(0.5, Math.round(base.active.frequencyScale * 0.5 * 100) / 100);
  else if (missed > noisy) patch.frequencyScale = Math.min(2, Math.round(base.active.frequencyScale * 2 * 100) / 100);
  if (t.revoke > 0) patch.maxActions = 1;
  else if (t.fail > fresh.length / 2) patch.maxActions = Math.min(base.active.maxActions, 2);
  if (t.down > t.up || t.fail > fresh.length / 2) patch.replyStyle = 'concise';
  if (t.revoke > 0) patch.actionStyle = 'calm';
  const changed = Object.entries(patch).some(([k, v]) => base.active[k as keyof NiTaiZiGaiCeLue] !== v);
  if (!changed) return { state: { ...base, lastReviewAt: now }, applied: 0, suggested: 0, rolledBack: false };
  const candidate: NiTaiZiGaiHouXuan = {
    id: 'nitai-' + now.toString(36) + '-' + base.candidates.length.toString(36), domain: (t.revoke || noisy || missed) ? 'frequency' : t.down ? 'reply' : 'style',
    patch, ts: now, status: 'suggested', ceng: 1, baseVersion: base.version,
    reason: `依据 ${fresh.length} 条真实台账（失败${t.fail}、撤权${t.revoke}、负反馈${t.down}、太吵${noisy}、漏重要${missed}）提出有界调整；不改变设备权限、仲裁或用户固定选择。`,
    evidence: { sampleCount: fresh.length, failCount: t.fail, revokeCount: t.revoke, feedbackUp: t.up, feedbackDown: t.down,
      qualityDelta: -Math.round(t.failRate * 100), efficiencyGainPct: 0, costDeltaPct: 0, unknown: true, isolated: false },
  };
  return { state: { ...base, lastReviewAt: now, candidates: [...base.candidates, candidate].slice(-50) }, applied: 0, suggested: 1, rolledBack: false };
}
/** 系统消息逐项批准；重复/过期申请不再次生效。 */
export function yingYongNiTaiGaiJin(st: NiTaiZiGaiZhuangTai, id: string, agreed: boolean, now = Date.now()): { state: NiTaiZiGaiZhuangTai; ok: boolean; error?: string; changed: boolean } {
  const c = st.candidates.find((x) => x.id === id && x.status === 'suggested');
  if (!c) return { state: st, ok: false, error: 'not-pending', changed: false };
  if (!agreed) return { state: { ...st, candidates: st.candidates.map((x) => x.id === id ? { ...x, status: 'rejected', reviewedAt: now } : x) }, ok: true, changed: true };
  if (c.baseVersion !== st.version) return { state: st, ok: false, error: 'stale-candidate', changed: false };
  const active = zhengLiCeLue({ ...st.active, ...zhengLiBuFen(c.patch) });
  return { state: {
    ...st, version: st.version + 1, active, previous: { candidateId: c.id, policy: { ...st.active } },
    candidates: st.candidates.map((x) => x.id === id ? { ...x, status: 'applied', appliedAt: now, reviewedAt: undefined } : x),
  }, ok: true, changed: true };
}
