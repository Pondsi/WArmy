/**
 * R301：有证据的渐进召回 + 召回轨迹诊断 + 虚拟目录三级展开。
 * 先授权再检索、先短卡再原文；词法/向量 RRF 由 memory-os 提供，本层只做查询变体、一跳扩展、规则重排与有界轨迹。
 * 轨迹仅按 ID/hash/计数关联，不记密钥、完整查询或正文；URI 不暴露真实私密路径。
 */
import crypto from 'node:crypto';

export interface ZhaoHuiKa {
  id: string;
  text?: string;
  score?: number;
  sources?: string[];
  ts?: number;
  entityIds?: string[];
}
export interface ZhaoHuiJieGuo {
  cards: ZhaoHuiKa[];
  scopeStats?: { authorizedRecords: number; deniedRecords: number };
  channels?: Array<{ channel: string; used: boolean; hits: number }>;
  timings?: { totalMs: number };
}
export interface ZhaoHuiYiLai {
  recall: (query: string, opts: { scope?: unknown; limit?: number; deadline?: number }) => Promise<ZhaoHuiJieGuo>;
  entities?: () => Array<{ id: string; ming: string; aliases?: string[]; eventIds?: string[] }>;
  /** 有界加密本地轨迹（宿主提供）；本层只传 ID/hash/计数。 */
  trace?: (rec: ZhaoHuiGuiJi) => void;
  now?: () => number;
}
export interface ZhaoHuiGuiJi {
  sessionId: string;
  queryHash: string;
  ts: number;
  ms: number;
  variants: number;
  stages: {
    authorized: number;
    denied: number;
    channels: Array<{ channel: string; used: boolean; hits: number }>;
    candidates: number;
    oneHop: number;
    returned: number;
    budgetCut: number;
  };
}

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

/** 最多三个查询变体：原查询 + 实体/别名扩展 + 时间词；确定性顺序，便于缓存与复现。 */
export function bianTiChaXun(query: string, entities: Array<{ ming: string; aliases?: string[] }> = []): string[] {
  const q = String(query || '').trim();
  const out = [q];
  const lower = q.toLowerCase();
  for (const e of entities) {
    if (out.length >= 3) break;
    const names = [e.ming, ...(e.aliases || [])].filter(Boolean);
    if (names.some((n) => lower.includes(String(n).toLowerCase()))) {
      const kuo = names.join(' ');
      if (!out.includes(kuo)) out.push(kuo);
    }
  }
  const shiJian = q.match(/\d{4}[-/年]\d{1,2}[-/月]?\d{0,2}|昨天|今天|上周|上个月|去年/g);
  if (shiJian && out.length < 3) {
    const bian = q + ' ' + shiJian.join(' ');
    if (!out.includes(bian)) out.push(bian);
  }
  return out.slice(0, 3);
}

/** 渐进召回：授权过滤前置；缺证据时最多三个变体；单次≤20卡、≤800ms；一跳实体扩展≤32＋规则重排。 */
export async function jianJinZhaoHui(yiLai: ZhaoHuiYiLai, o: {
  sessionId: string; query: string; scope?: unknown; limit?: number; deadlineMs?: number;
}): Promise<{ cards: ZhaoHuiKa[]; guiJi: ZhaoHuiGuiJi }> {
  const now = yiLai.now || (() => Date.now());
  const t0 = now();
  const limit = Math.min(20, Math.max(1, o.limit || 20));
  const deadline = t0 + Math.min(800, Math.max(50, o.deadlineMs || 800));
  const entities = yiLai.entities?.() || [];
  const variants = bianTiChaXun(o.query, entities);
  const byId = new Map<string, ZhaoHuiKa>();
  let scopeStats: ZhaoHuiJieGuo['scopeStats'];
  let channels: ZhaoHuiJieGuo['channels'] = [];
  let candidates = 0;
  for (const v of variants) {
    if (now() >= deadline) break;
    const r = await yiLai.recall(v, { scope: o.scope, limit, deadline });
    scopeStats = r.scopeStats || scopeStats;
    channels = r.channels || channels;
    candidates += r.cards.length;
    for (const c of r.cards) if (!byId.has(c.id)) byId.set(c.id, c);
    if (byId.size > 0) break; /* 有证据即止，不做无差别多查询 */
  }
  let cards = [...byId.values()];
  /* 一跳实体/时间扩展：授权候选内最多 32 个相关实体命中的卡片，规则化重排（共享实体+新近），不引入大重排模型。 */
  const hitEntities = new Set<string>();
  for (const c of cards) for (const e of c.entityIds || []) hitEntities.add(e);
  let oneHop = 0;
  if (hitEntities.size && cards.length < limit) {
    const related = new Set<string>();
    for (const e of entities) {
      if (related.size >= 32) break;
      if (hitEntities.has(e.id)) for (const ev of e.eventIds || []) related.add(ev);
    }
    for (const c of cards) {
      if (oneHop >= 32) break;
      if ((c.entityIds || []).some((e) => hitEntities.has(e))) oneHop++;
    }
    cards.sort((a, b) => {
      const gongA = (a.entityIds || []).filter((e) => hitEntities.has(e)).length;
      const gongB = (b.entityIds || []).filter((e) => hitEntities.has(e)).length;
      return (gongB - gongA) || ((b.ts || 0) - (a.ts || 0)) || ((b.score || 0) - (a.score || 0));
    });
    void related;
  }
  const budgetCut = Math.max(0, cards.length - limit);
  cards = cards.slice(0, limit);
  const guiJi: ZhaoHuiGuiJi = {
    sessionId: o.sessionId, queryHash: sha(o.query), ts: t0, ms: now() - t0, variants: variants.length,
    stages: {
      authorized: scopeStats?.authorizedRecords ?? 0, denied: scopeStats?.deniedRecords ?? 0,
      channels: channels.map((c) => ({ channel: c.channel, used: c.used, hits: c.hits })),
      candidates, oneHop, returned: cards.length, budgetCut,
    },
  };
  try { yiLai.trace?.(guiJi); } catch { /* 轨迹失败不影响召回 */ }
  return { cards, guiJi };
}

/** 虚拟目录 URI：只暴露逻辑层与 ID，不含真实私密路径。 */
export function jiYiUri(ceng: string, id: string): string {
  return 'jiyi://' + encodeURIComponent(ceng) + '/' + encodeURIComponent(id);
}
export interface MuLuJieDian { uri: string; ceng: string; id: string; L0: string; L1?: { goals?: string[]; decisions?: string[]; todos?: string[]; risks?: string[]; source?: string }; }
/** L0 一句摘要 / L1 目标·决定·待办·风险与来源 / L2 分页取原文（原文走 retrieve，不在此复制）。 */
export function muLuSanJi(items: Array<{ id: string; ceng: string; summary: string; goals?: string[]; decisions?: string[]; todos?: string[]; risks?: string[]; source?: string }>): MuLuJieDian[] {
  return items.map((x) => ({
    uri: jiYiUri(x.ceng, x.id), ceng: x.ceng, id: x.id, L0: String(x.summary || '').slice(0, 120),
    L1: { goals: x.goals, decisions: x.decisions, todos: x.todos, risks: x.risks, source: x.source },
  }));
}