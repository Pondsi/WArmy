/** R232：语音只解析明确选项，不用模型猜授权；卡片身份与选项绑定，防止旧音频回答新卡。 */
import { createHash } from 'node:crypto';
import type { AiWenTi } from './ai-questions.js';
export function kaPianYuYinZhiWen(q: AiWenTi): string {
  return createHash('sha256').update(JSON.stringify([q.id, q.sessionId || q.groupId, q.kind, q.createdAt, q.biaoTi, q.ti, q.options.map((o) => [o.id, o.biaoQian, o.description])])).digest('hex');
}
export type YuYinXuanZe = { kind: 'option'; optionId: string } | { kind: 'custom'; text: string } | { kind: 'invalid' };
export function jieXiKaPianYuYin(text: string, q: AiWenTi): YuYinXuanZe {
  if (q.status !== 'pending' || q.options.length === 0) return { kind: 'invalid' };
  const yuan = String(text || '').normalize('NFKC').trim();
  if (!yuan || yuan.length > 2000) return { kind: 'invalid' };
  const wen = yuan.replace(/[。.!！?？,，\s]+$/gu, '').trim();
  const m = /^(?:我选|选择|选|选项|option\s*|choose\s*)?\s*([A-Z]|[1-9]|1[0-9]|2[0-6])$/iu.exec(wen);
  const zhong = /^(?:我选|选择|选)?(?:第)?([一二三四五六七八九十])(?:个|项)?$/u.exec(wen);
  let idx = -1;
  if (m?.[1]) idx = /^[a-z]$/i.test(m[1]) ? m[1].toUpperCase().charCodeAt(0) - 65 : Number(m[1]) - 1;
  else if (zhong?.[1]) idx = '一二三四五六七八九十'.indexOf(zhong[1]);
  if (m || zhong) return q.options[idx] ? { kind: 'option', optionId: q.options[idx]!.id } : { kind: 'invalid' };
  const exact = q.options.filter((o) => o.biaoQian.normalize('NFKC').trim() === wen);
  if (exact.length === 1) return { kind: 'option', optionId: exact[0]!.id };
  return { kind: 'custom', text: yuan };
}
export function kaPianYuYinWen(q: AiWenTi, labels: { authorization: string; choice: string; hint: string }): string {
  const opts = q.options.map((o, i) => `${i < 26 ? String.fromCharCode(65 + i) + '/' : ''}${i + 1}: ${o.biaoQian.slice(0, 48)}`).join('；');
  return `${q.kind === 'authorization' ? labels.authorization : labels.choice}。${q.biaoTi.slice(0, 80)}。${opts}。${labels.hint}`;
}
