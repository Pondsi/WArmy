/**
 * AI 工作中向人类求助的**选项卡**（会话内，不是创建项目表单）。
 *
 * 语义：
 * - 值班/工具执行需要人类决策时，开出一张卡：标题 + 选项 + **永远有「其他」自定义输入**
 * - 人类点选后，下一轮上下文注入：`[人类决策] <question> → <choice>`
 * - 不代替权限审批卡；这里只做「决策选择」
 * - 去重：同一 groupId+question 未答时只保留一张（避免刷屏）
 */
import crypto from 'node:crypto';

export const AI_QUESTION_CUSTOM = '__custom__';

export interface AiWenTiXuanXiang {
  id: string;
  biaoQian: string;
  description?: string;
  /** 模型自评的**最优方案**：界面上标「推荐」，并且「自动选择」开着时按它执行 */
  tuiJian?: boolean;
  /** R167：模型自评置信度（0~1 或 0~100），供「单一明显可用」硬门禁判定 */
  keXinDu?: number;
  confidence?: number;
}

export interface AiWenTi {
  id: string;
  /** 由宿主创建入口指定，不能根据回复里的“允许”等字眼猜授权类型。 */
  kind?: 'authorization' | 'choice';
  /** R300：一次性授权卡不可去重、不可重放，回答必须携带 nonce。 */
  oneTime?: boolean;
  nonce?: string;
  groupId: string;
  sessionId?: string;
  biaoTi: string;
  ti?: string;
  options: AiWenTiXuanXiang[];
  /** 恒 true：产品要求永远提供「其他，用户自行输入」 */
  allowCustom: true;
  createdAt: number;
  status: 'pending' | 'answered' | 'cancelled';
  answer?: { optionId: string; biaoQian: string; customText?: string; answeredAt: number };
}

export class AiWenTiZhongXin {
  private items = new Map<string, AiWenTi>();
  /** 异步通知让同一调用栈的自动选择先结束，避免播报已自动回答的卡。 */
  onChanged?: () => void;
  private tongZhi(): void { queueMicrotask(() => this.onChanged?.()); }

  daKai(shuRu: {
    kind?: 'authorization' | 'choice';
    groupId: string;
    sessionId?: string;
    biaoTi: string;
    ti?: string;
    options: Array<{ id?: string; biaoQian: string; description?: string; tuiJian?: boolean; keXinDu?: number; confidence?: number }>;
    dedupe?: boolean;
    oneTime?: boolean;
    nonce?: string;
  }): AiWenTi {
    const groupId = String(shuRu.groupId || '');
    const biaoTi = String(shuRu.biaoTi || '').trim();
    const oneTime = shuRu.oneTime === true;
    const nonce = String(shuRu.nonce || '').trim();
    if (oneTime && !nonce) throw new Error('one-time-nonce-required');
    if (!oneTime && shuRu.dedupe !== false) {
      const shiShouQuan = (shuRu.kind || 'choice') === 'authorization';
      for (const q of this.items.values()) {
        if (q.groupId !== groupId || q.status !== 'pending' || q.biaoTi !== biaoTi || q.oneTime) continue;
        if (!shiShouQuan) return q; // 选择卡：同标题未答只留一张（避免刷屏，产品原契约）
        /** 授权卡必须严格匹配：同标题不同操作对象/选项绝不能复用旧授权（R232 安全口径） */
        if (q.kind === 'authorization' && q.ti === String(shuRu.ti || '')
                  && JSON.stringify(q.options.map((o) => [o.biaoQian, o.description || '']))
                    === JSON.stringify((shuRu.options || []).filter((o) => o && String(o.biaoQian || '').trim()).map((o) => [String(o.biaoQian).trim(), o.description || '']))) return q;
      }
    }
    const options = (shuRu.options || [])
      .filter((o) => o && String(o.biaoQian || '').trim())
      .map((o) => ({
        id: String(o.id || crypto.randomBytes(4).toString('hex')),
        biaoQian: String(o.biaoQian).trim(),
        ...(o.description ? { description: String(o.description) } : {}),
        ...(o.tuiJian ? { tuiJian: true } : {}),
        ...(o.keXinDu !== undefined ? { keXinDu: Number(o.keXinDu) } : {}),
        ...(o.confidence !== undefined ? { confidence: Number(o.confidence) } : {}),
      }));
    const q: AiWenTi = {
      id: 'q' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex'),
      groupId,
      kind: shuRu.kind || 'choice',
      ...(oneTime ? { oneTime: true, nonce } : {}),
      sessionId: shuRu.sessionId,
      biaoTi,
      ti: shuRu.ti ? String(shuRu.ti) : '',
      options,
      allowCustom: true,
      createdAt: Date.now(),
      status: 'pending',
    };
    this.items.set(q.id, q);
    this.tongZhi();
    return q;
  }

  answer(id: string, optionId: string, customText?: string, expectedNonce?: string): { ok: boolean; question?: AiWenTi; inject?: string; error?: string } {
    const q = this.items.get(String(id || ''));
    if (!q) return { ok: false, error: 'not-found' };
    if (q.status === 'answered') {
      if (q.oneTime) return { ok: false, error: 'card-already-answered' };
      return { ok: true, question: q, inject: this.injectLine(q) };
    }
    if (q.status !== 'pending') return { ok: false, error: 'card-not-pending' };
    if (q.oneTime && (!expectedNonce || q.nonce !== expectedNonce)) return { ok: false, error: 'nonce-mismatch' };
    if (optionId === AI_QUESTION_CUSTOM || optionId === 'custom' || optionId === 'other') {
      const text = String(customText || '').trim();
      if (!text) return { ok: false, error: 'custom-text-required' };
      q.answer = { optionId: AI_QUESTION_CUSTOM, biaoQian: '其他', customText: text, answeredAt: Date.now() };
    } else {
      const opt = q.options.find((o) => o.id === optionId);
      if (!opt) return { ok: false, error: 'option-not-found' };
      q.answer = { optionId: opt.id, biaoQian: opt.biaoQian, answeredAt: Date.now() };
    }
    q.status = 'answered';
    this.items.set(q.id, q);
    this.tongZhi();
    return { ok: true, question: q, inject: this.injectLine(q) };
  }

  injectLine(q: AiWenTi): string {
    if (!q.answer) return '';
    const extra = q.answer.customText ? `（自定义）${q.answer.customText}` : '';
    return `[人类决策] ${q.biaoTi} → ${q.answer.biaoQian}${extra}`;
  }

  LieBiao(groupId?: string): AiWenTi[] {
    return [...this.items.values()]
      .filter((q) => !groupId || q.groupId === groupId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  pending(groupId?: string): AiWenTi[] {
    return this.LieBiao(groupId).filter((q) => q.status === 'pending');
  }

  /** 会话上下文里拼进未答/已答决策（有界） */
  contextFor(groupId: string): string {
    const HangJi = this.LieBiao(groupId)
      .filter((q) => q.status === 'answered' || q.status === 'pending')
      .slice(0, 5)
      .map((q) => (q.status === 'answered' ? this.injectLine(q) : `[待人类决策] ${q.biaoTi}（选项：${q.options.map((o) => o.biaoQian).join(' / ')} / 其他）`));
    return HangJi.length ? `[决策卡]\n${HangJi.join('\n')}` : '';
  }

  cancel(id: string): boolean {
    const q = this.items.get(String(id || ''));
    if (!q || q.status !== 'pending') return false;
    q.status = 'cancelled';
    this.tongZhi();
    return true;
  }
}
