/**
 * diwen-i5 —— I5 协作词表（R212）。
 *
 * 智能体间协作消息的 7 类言语行为（承诺/质询/证据/拒绝/请求/汇报/纠错）→ 迪文映射。
 * 词根表已到位（迪文 3039 词根/36 框架），本表把协作语义归类并走迪文三态门控：
 *  · 确定（STRUCTURED）→ 迪文机器层 + GCF（机器看，省 token、可验证）；
 *  · 不确定 → 回退原文；没有 → 不编。
 * 红线：迪文只给机器看；用户可见内容一律原文（见 diwen-bridge）。
 *
 * 归类是关键词启发式（确定性、可测），不是模型翻译；归类失败回 null（仍走原文）。
 */
import { diwenHua, type DiwenHuaJieGuo } from './diwen-bridge.js';

export type I5LeiXing = 'chengNuo' | 'zhiXun' | 'zhengJu' | 'juJue' | 'qingQiu' | 'huiBao' | 'jiuCuo';

/** 7 类协作言语行为 + 归类关键词（顺序即优先级，越靠前越先匹配）。 */
export const I5_CI_BIAO: Array<{ lei: I5LeiXing; ming: string; guanJian: RegExp }> = [
  { lei: 'chengNuo', ming: '承诺', guanJian: /承诺|保证|必定|按时交付|负责到底/ },
  { lei: 'zhiXun', ming: '质询', guanJian: /为什么|为何|请问|质疑|质询|怎么回事/ },
  { lei: 'juJue', ming: '拒绝', guanJian: /拒绝|不能执行|不予|驳回|反对/ },
  { lei: 'jiuCuo', ming: '纠错', guanJian: /纠正|写错|错了|改正|修正|有误/ },
  { lei: 'qingQiu', ming: '请求', guanJian: /请帮|请求|帮忙|请你|能否|麻烦/ },
  { lei: 'huiBao', ming: '汇报', guanJian: /汇报|报告|结果如下|总结|已完成/ },
  { lei: 'zhengJu', ming: '证据', guanJian: /证据|证明|凭证|作为证据|已生成的文件/ },
];

/** 把协作消息归类到 7 类之一；归不出回 null（不强行归类）。 */
export function fenLeiI5(text: string): I5LeiXing | null {
  const t = String(text || '');
  if (!t.trim()) return null;
  for (const c of I5_CI_BIAO) if (c.guanJian.test(t)) return c.lei;
  return null;
}

/** 类型 → 中文名（汇报/展示用）。 */
export function i5MingOf(lei: I5LeiXing | null): string {
  return I5_CI_BIAO.find((c) => c.lei === lei)?.ming || '';
}

export interface I5JiaoHuanJieGuo {
  lei: I5LeiXing | null;
  ming: string;
  mode: DiwenHuaJieGuo['mode'];
  diwen?: any;
  gcf?: string;
  yuanWen: string;
}

/**
 * 协作消息迪文化交换载荷：归类 + 三态门控。
 * 机器间用 diwen/gcf（结构化、省 token）；用户可见用 yuanWen（恒原文）。
 */
export async function i5JiaoHuan(text: string): Promise<I5JiaoHuanJieGuo> {
  const lei = fenLeiI5(text);
  const r = await diwenHua({ text });
  return { lei, ming: i5MingOf(lei), mode: r.mode, diwen: r.diwen, gcf: r.gcf, yuanWen: r.text };
}