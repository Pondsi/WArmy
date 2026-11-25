/**
 * R301：AI 语言治理闭环。
 * 总结读取侧记→分类→只允许有界声明式候选（提示片段/例子/检测参数）→硬门禁直接拒绝、
 * 软门禁/安全影响走第一列系统消息申请（批准前不生效）→留出样本回放（误判/漏判/语义损失不增且有正向证据才启用）→次轮检查退化即回滚。
 * 不执行模型生成的代码/任意正则/新工具；原文保护、权限、隐私、两次限额等硬门禁不可学习覆盖。
 */
import type { YuYanCeJi } from './ai-yu-yan-yue-shu.js';

export type FenLei = '检测误判' | '模型未遵从' | '任务例外漏识别' | '提示不清' | '供应商能力限制' | '观察';
export interface HouXuan {
  id: string;
  kind: 'prompt' | 'example' | 'param';
  /** 声明式内容：提示片段/例子文本/检测参数（latinMin/scriptMin/margin）。不含代码/正则/工具。 */
  payload: Record<string, unknown>;
  fenLei: FenLei;
  basis: string;
}
export interface MenJinJieGuo { allow: boolean; hard: boolean; reason: string; needsApproval: boolean }
export interface HuiFangZhiBiao { falsePos: number; falseNeg: number; semanticLoss: number; benefit: number }

/** 按侧记与上下文分类；证据不足只观察，不臆断。 */
export function fenLeiCeJi(rec: YuYanCeJi, ctx: { detectionUnknown?: boolean; exceptionMissed?: boolean; providerLimited?: boolean } = {}): FenLei {
  if (ctx.detectionUnknown) return '检测误判';
  if (ctx.exceptionMissed) return '任务例外漏识别';
  if (ctx.providerLimited) return '供应商能力限制';
  if (rec.fallback && rec.mismatch) return '模型未遵从';
  if (rec.complaint && !rec.mismatch) return '提示不清';
  return '观察';
}

const HARD_KEYS = ['原文保护', '权限', '隐私', '两次限额', 'hardGate', 'permission', 'privacy', 'originalText'];
/** 硬门禁不可学习覆盖；候选只能是声明式 prompt/example/param，且不得携带代码/正则/工具。 */
export function yingMenJin(h: HouXuan): MenJinJieGuo {
  const text = JSON.stringify(h.payload || {});
  if (!['prompt', 'example', 'param'].includes(h.kind)) return { allow: false, hard: true, reason: '非声明式候选', needsApproval: false };
  if (/(?:function\s*\(|=>|new\s+RegExp|eval\(|require\(|import\s|child_process|exec\()/i.test(text)) return { allow: false, hard: true, reason: '含代码/正则/工具，拒绝', needsApproval: false };
  if (HARD_KEYS.some((k) => text.includes(k))) return { allow: false, hard: true, reason: '触及硬门禁，不可学习覆盖', needsApproval: false };
  if (h.kind === 'param') {
    const p = h.payload as { latinMin?: number; scriptMin?: number; margin?: number };
    for (const v of [p.latinMin, p.scriptMin, p.margin]) if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v) || v < 0)) return { allow: false, hard: true, reason: '检测参数非法', needsApproval: false };
    if ((p.latinMin ?? 80) < 40 || (p.scriptMin ?? 20) < 10) return { allow: false, hard: true, reason: '门槛过低会放大误判', needsApproval: false };
  }
  /* 其余安全影响/软门禁变更：需用户批准（第一列系统消息），批准前不生效。 */
  return { allow: true, hard: false, reason: '软门禁/安全影响，需批准', needsApproval: true };
}

/** 留出样本回放：误判/漏判/语义损失不增，且综合收益有正向证据才启用。样本不足只观察。 */
export function liuChuHuiFang(before: HuiFangZhiBiao, after: HuiFangZhiBiao, samples: number): { enable: boolean; reason: string } {
  if (samples < 30) return { enable: false, reason: '样本不足，只观察' };
  if (after.falsePos > before.falsePos || after.falseNeg > before.falseNeg || after.semanticLoss > before.semanticLoss) return { enable: false, reason: '误判/漏判/语义损失增加' };
  if (after.benefit <= before.benefit) return { enable: false, reason: '无正向收益证据' };
  return { enable: true, reason: '留出回放正向' };
}

/** 次轮验证：新反馈出现退化即回滚。 */
export function xiaLunYanZheng(prev: HuiFangZhiBiao, current: HuiFangZhiBiao): { rollback: boolean; reason: string } {
  if (current.falsePos > prev.falsePos || current.falseNeg > prev.falseNeg || current.semanticLoss > prev.semanticLoss || current.benefit < prev.benefit) {
    return { rollback: true, reason: '次轮反馈退化' };
  }
  return { rollback: false, reason: '保持' };
}

export interface ZhiLiZhuangTai { id: string; houXuan: HouXuan; zhuangTai: 'pending' | 'approved' | 'rejected' | 'rolledback'; metrics?: HuiFangZhiBiao }
/** 从侧记生成有界候选（仅声明式）；同一分类最多一条，避免堆积。 */
export function shengChengHouXuan(records: readonly YuYanCeJi[]): HouXuan[] {
  const by = new Map<FenLei, number>();
  for (const r of records) {
    const f = fenLeiCeJi(r);
    by.set(f, (by.get(f) || 0) + 1);
  }
  const out: HouXuan[] = [];
  if ((by.get('模型未遵从') || 0) >= 2) out.push({ id: 'prompt-follow', kind: 'prompt', payload: { fragment: '自然语言正文必须使用目标语言；代码/路径/引语/专名保留原文。' }, fenLei: '模型未遵从', basis: '多次回退仍不合规' });
  if ((by.get('任务例外漏识别') || 0) >= 2) out.push({ id: 'example-exception', kind: 'example', payload: { text: '日语解释中保留 `npm test`；翻译任务只译目标段。' }, fenLei: '任务例外漏识别', basis: '例外片段被误纠' });
  if ((by.get('检测误判') || 0) >= 2) out.push({ id: 'param-margin', kind: 'param', payload: { margin: 0.3 }, fenLei: '检测误判', basis: '相近语误判偏多' });
  return out;
}