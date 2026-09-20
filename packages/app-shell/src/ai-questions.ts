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
  label: string;
  description?: string;
}

export interface AiWenTi {
  id: string;
  groupId: string;
  sessionId?: string;
  title: string;
  body?: string;
  options: AiWenTiXuanXiang[];
  /** 恒 true：产品要求永远提供「其他，用户自行输入」 */
  allowCustom: true;
  createdAt: number;
  status: 'pending' | 'answered' | 'cancelled';
  answer?: { optionId: string; label: string; customText?: string; answeredAt: number };
}

export class AiWenTiZhongXin {
  private items = new Map<string, AiWenTi>();

  open(input: {
    groupId: string;
    sessionId?: string;
    title: string;
    body?: string;
    options: Array<{ id?: string; label: string; description?: string }>;
    dedupe?: boolean;
  }): AiWenTi {
    const groupId = String(input.groupId || '');
    const title = String(input.title || '').trim();
    if (input.dedupe !== false) {
      for (const q of this.items.values()) {
        if (q.groupId === groupId && q.status === 'pending' && q.title === title) return q;
      }
    }
    const options = (input.options || [])
      .filter((o) => o && String(o.label || '').trim())
      .map((o) => ({
        id: String(o.id || crypto.randomBytes(4).toString('hex')),
        label: String(o.label).trim(),
        ...(o.description ? { description: String(o.description) } : {}),
      }));
    const q: AiWenTi = {
      id: 'q-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex'),
      groupId,
      sessionId: input.sessionId,
      title,
      body: input.body ? String(input.body) : '',
      options,
      allowCustom: true,
      createdAt: Date.now(),
      status: 'pending',
    };
    this.items.set(q.id, q);
    return q;
  }

  answer(id: string, optionId: string, customText?: string): { ok: boolean; question?: AiWenTi; inject?: string; error?: string } {
    const q = this.items.get(String(id || ''));
    if (!q) return { ok: false, error: 'not-found' };
    if (q.status === 'answered') {
      return { ok: true, question: q, inject: this.injectLine(q) };
    }
    if (optionId === AI_QUESTION_CUSTOM || optionId === 'custom' || optionId === 'other') {
      const text = String(customText || '').trim();
      if (!text) return { ok: false, error: 'custom-text-required' };
      q.answer = { optionId: AI_QUESTION_CUSTOM, label: '其他', customText: text, answeredAt: Date.now() };
    } else {
      const opt = q.options.find((o) => o.id === optionId);
      if (!opt) return { ok: false, error: 'option-not-found' };
      q.answer = { optionId: opt.id, label: opt.label, answeredAt: Date.now() };
    }
    q.status = 'answered';
    this.items.set(q.id, q);
    return { ok: true, question: q, inject: this.injectLine(q) };
  }

  injectLine(q: AiWenTi): string {
    if (!q.answer) return '';
    const extra = q.answer.customText ? `（自定义）${q.answer.customText}` : '';
    return `[人类决策] ${q.title} → ${q.answer.label}${extra}`;
  }

  list(groupId?: string): AiWenTi[] {
    return [...this.items.values()]
      .filter((q) => !groupId || q.groupId === groupId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  pending(groupId?: string): AiWenTi[] {
    return this.list(groupId).filter((q) => q.status === 'pending');
  }

  /** 会话上下文里拼进未答/已答决策（有界） */
  contextFor(groupId: string): string {
    const lines = this.list(groupId)
      .filter((q) => q.status === 'answered' || q.status === 'pending')
      .slice(0, 5)
      .map((q) => (q.status === 'answered' ? this.injectLine(q) : `[待人类决策] ${q.title}（选项：${q.options.map((o) => o.label).join(' / ')} / 其他）`));
    return lines.length ? `[决策卡]\n${lines.join('\n')}` : '';
  }

  cancel(id: string): boolean {
    const q = this.items.get(String(id || ''));
    if (!q || q.status !== 'pending') return false;
    q.status = 'cancelled';
    return true;
  }
}
