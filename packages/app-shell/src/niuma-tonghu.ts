/**
 * niuma-tonghu —— 牛马（智能体）之间的**直接互通协议** v1（第 51 轮）
 *
 * 参考：A2A v1.0 消息信封（message_id / context_id / task_id / from / intent / capabilities / parts / metadata）、
 * LangGraph handoff、MCP（agent↔工具，不是 agent↔agent）。
 *
 * 设计要点：
 *  · **事实只从黑板取**：payload 里放的是 `facts_ref`（黑板条目 id），不复制事实正文 ⇒ 不产生第二事实源。
 *  · **印象交换可选**：`impression_ok=false` 或 `impression=null` 表示不交换；
 *    只有双方都同意才交换（默认关闭，避免把「认知」与「印象」混为一谈）。
 *  · **幂等**：`idem_key = task_id#seq`；重复收到同一 key 只回缓存 ack。
 *  · **有界**：单条 ≤800 字；预算计入执行者固定上限。
 *  · 与黑板并行存在：对话不消解冲突，同主题异说一律落成黑板冲突条目交人裁决。
 */

export type NiumaJueSe = 'duty' | 'exec' | 'clone';
export type NiumaYiTu = 'ask' | 'answer' | 'delegate' | 'handoff' | 'conflict' | 'ack';

export interface NiumaXinFeng {
  v: 'warmy.chat/1';
  message_id: string;
  idem_key: string;
  context_id: string;
  task_id: string;
  from: { role: NiumaJueSe; id: string; stamp?: string };
  to: { role: NiumaJueSe; id: string };
  intent: NiumaYiTu;
  capabilities?: { extensions?: string[]; impression_ok?: boolean };
  payload?: {
    /** 认知：目标/边界/阻塞，以及黑板指针（不复制事实正文） */
    cognition?: { goal?: string; blockers?: string[]; facts_ref?: string[] };
    /** 印象：仅在双方同意时出现；没有就是 null */
    impression?: { text?: string; from_session?: string } | null;
    /** 回答/委托正文（有界） */
    text?: string;
  };
  refs?: { blackboard?: string[]; reply_to?: string };
  budget?: { max_chars?: number; ttl_s?: number };
}

export interface NiumaTonghuZhuangTai {
  jieduan: 'IDLE' | 'OFFER' | 'NEGOTIATE' | 'EXCHANGING' | 'DONE' | 'BLOCKED' | 'ABORTED';
  /** 已处理的幂等键（去重） */
  yichuli: Set<string>;
  kaishiAt: number;
  ttlS: number;
}

export function xinZhuangTai(ttlS = 120): NiumaTonghuZhuangTai {
  return { jieduan: 'IDLE', yichuli: new Set(), kaishiAt: Date.now(), ttlS };
}

/** 构造一条互通消息（自动补 v / idem_key / 边界） */
export function zaoXinFeng(p: {
  from: { role: NiumaJueSe; id: string };
  to: { role: NiumaJueSe; id: string };
  intent: NiumaYiTu;
  taskId: string;
  seq: number;
  contextId?: string;
  cognition?: { goal?: string; blockers?: string[]; facts_ref?: string[] };
  impression?: { text?: string; from_session?: string } | null;
  impressionOk?: boolean;
  text?: string;
  replyTo?: string;
}): NiumaXinFeng {
  const maxChars = 800;
  const cut = (s?: string) => (s ? String(s).slice(0, maxChars) : undefined);
  return {
    v: 'warmy.chat/1',
    message_id: 'msg-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
    idem_key: p.taskId + '#' + p.seq,
    context_id: p.contextId || p.taskId,
    task_id: p.taskId,
    from: p.from,
    to: p.to,
    intent: p.intent,
    capabilities: { extensions: ['urn:warmy:cognition:v1', 'urn:warmy:impression:v1'], impression_ok: p.impressionOk === true },
    payload: {
      cognition: p.cognition,
      impression: p.impressionOk === true ? (p.impression || null) : null,
      text: cut(p.text),
    },
    refs: { blackboard: p.cognition?.facts_ref, reply_to: p.replyTo },
    budget: { max_chars: maxChars, ttl_s: 120 },
  };
}

/** 校验：形状、长度、必填、印象开关 */
export function yanZheng(x: unknown): { ok: boolean; cuo?: string } {
  const m = x as NiumaXinFeng;
  if (!m || typeof m !== 'object') return { ok: false, cuo: 'not-object' };
  if (m.v !== 'warmy.chat/1') return { ok: false, cuo: 'bad-version' };
  if (!m.message_id || !m.idem_key || !m.task_id) return { ok: false, cuo: 'missing-id' };
  if (!m.from?.id || !m.to?.id) return { ok: false, cuo: 'missing-peer' };
  if (!['ask', 'answer', 'delegate', 'handoff', 'conflict', 'ack'].includes(m.intent)) return { ok: false, cuo: 'bad-intent' };
  const wen = String(m.payload?.text || '');
  const max = Math.min(2000, Number(m.budget?.max_chars) || 800);
  if (wen.length > max) return { ok: false, cuo: 'too-long' };
  if (m.payload?.impression && m.capabilities?.impression_ok !== true) return { ok: false, cuo: 'impression-not-agreed' };
  return { ok: true };
}

/** 收一条消息：去重 + TTL + 印象准入 */
export function shouXin(z: NiumaTonghuZhuangTai, x: unknown): { ok: boolean; chongFu?: boolean; cuo?: string; xiaoXi?: NiumaXinFeng } {
  const y = yanZheng(x);
  if (!y.ok) return { ok: false, cuo: y.cuo };
  const m = x as NiumaXinFeng;
  if (z.ttlS <= 0 || Date.now() - z.kaishiAt > z.ttlS * 1000) {
    z.jieduan = 'ABORTED';
    return { ok: false, cuo: 'ttl-expired' };
  }
  if (z.yichuli.has(m.idem_key)) return { ok: true, chongFu: true, xiaoXi: m };
  z.yichuli.add(m.idem_key);
  z.jieduan = 'EXCHANGING';
  return { ok: true, xiaoXi: m };
}

/** 交换「认知 ↔ 印象」：双方同意才交换；返回对方该看到的印象文本（没有就空） */
export function jiaoHuanRenZhiYinXiang(w: {
  woDeRenZhi: string;
  duiFangTongYi: boolean;
  duiFangYinXiang?: string;
  woDeYinXiang?: string;
}): { geiDuiFangDeRenZhi: string; woDeDaoDeYinXiang: string; shuoMing: string } {
  if (!w.duiFangTongYi) {
    return { geiDuiFangDeRenZhi: '', woDeDaoDeYinXiang: '', shuoMing: '对方没有开启印象交换：只交换认知，不传印象' };
  }
  return {
    geiDuiFangDeRenZhi: String(w.woDeRenZhi || ''),
    woDeDaoDeYinXiang: String(w.duiFangYinXiang || ''),
    shuoMing: '双方同意：我给出自己的认知作为对方的印象；我收到对方的认知作为我的印象',
  };
}
