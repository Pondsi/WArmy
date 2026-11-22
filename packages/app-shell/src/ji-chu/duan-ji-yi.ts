/**
 * R287 P5-5：短记忆频率/归一/匹配纯函数唯一 owner（自 electron-main 迁出，行为逐字保持）。
 *  · duanJiYiNorm：去空白与标点、转小写（归一化键）；
 *  · duanJiYiHash：归一化后 sha1 前 16 位；
 *  · shiDuanJiYiTiao：一行是不是短记忆条目（`- xxx`）；
 *  · riQiKaiShi：时间戳归一到当天零点；
 *  · duanJiYiShiYongFen：窗口内时间衰减使用分（180 天半衰期，useLog 优先，老数据回退 useCount/lastUsedAt）；
 *  · duanJiYiZhaoShiJian：短记忆文本匹配本会话可读知识事件（最长公共包含，≥6 字）；
 *  · duanJiYiYuYaoDianChongFu：短记忆是否与总结要点重复。
 * 零依赖纯函数（crypto＋日期），门禁可直接 import 跑断言。
 */
import crypto from 'node:crypto';

export const RI_HAO_MIAO = 86_400_000;
export const DUAN_JIYI_BAN_SHUAI_RI = 180;
export const DUAN_JIYI_CHUANG_RI = 1000;
export const DUAN_JIYI_ZUI_CHANG_RI = 2000;

export function duanJiYiNorm(s: unknown): string {
  return String(s || '').replace(/[\s\p{P}]/gu, '').toLowerCase();
}
export function duanJiYiHash(s: unknown): string {
  return crypto.createHash('sha1').update(duanJiYiNorm(s)).digest('hex').slice(0, 16);
}
/** 一行是不是短记忆里的“条目”（`- xxx`） */
export function shiDuanJiYiTiao(line: string): boolean {
  return /^\s*-\s+\S/.test(String(line || ''));
}
export function riQiKaiShi(ts: number): number {
  const d = new Date(Number(ts) || Date.now());
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
/** 一条事件在某窗口内的**时间衰减使用分**（useLog 优先；老数据回退 useCount/lastUsedAt） */
export function duanJiYiShiYongFen(
  e: { useLog?: number[]; useCount?: number; lastUsedAt?: number; ts?: number },
  chuang: { start: number; end: number; today: number; capped?: boolean },
  huiHuaNei: boolean,
): number {
  const end = huiHuaNei && !chuang.capped ? chuang.end : chuang.today;
  const start = huiHuaNei && !chuang.capped ? chuang.start : chuang.today - DUAN_JIYI_CHUANG_RI * RI_HAO_MIAO;
  const fen = (t: number): number => {
    const day = Math.max(0, (end - riQiKaiShi(t)) / RI_HAO_MIAO);
    return Math.pow(0.5, day / DUAN_JIYI_BAN_SHUAI_RI);
  };
  const log = Array.isArray(e.useLog) ? e.useLog.filter((t) => Number(t) >= start && Number(t) <= end + RI_HAO_MIAO) : [];
  if (log.length) return log.reduce((n, t) => n + fen(Number(t)), 0);
  const n = Math.max(0, Number(e.useCount) || 0);
  const last = Number(e.lastUsedAt) || Number(e.ts) || 0;
  if (!n || !last) return 0;
  return n * fen(last);
}
/** 把一条短记忆文本匹配到本会话可读的知识事件（用于判断来源层/频率） */
export function duanJiYiZhaoShiJian<T extends { biaoTi?: string; result?: string }>(line: string, events: readonly T[]): T | null {
  const k = duanJiYiNorm(line);
  if (k.length < 6) return null;
  let best: T | null = null;
  let bestLen = 0;
  for (const e of events) {
    const t = duanJiYiNorm(String((e as { biaoTi?: string }).biaoTi || '') + String((e as { result?: string }).result || ''));
    if (!t) continue;
    if (t.includes(k) || k.includes(t)) {
      const len = Math.min(k.length, t.length);
      if (len >= 6 && len > bestLen) { best = e; bestLen = len; }
    }
  }
  return best;
}
export function duanJiYiYuYaoDianChongFu(text: string, yaoDian: readonly string[]): boolean {
  const k = duanJiYiNorm(text);
  if (k.length < 6) return false;
  return yaoDian.some((y) => {
    const t = duanJiYiNorm(y);
    return t.length >= 6 && (t.includes(k) || k.includes(t)) && Math.min(t.length, k.length) >= 6;
  });
}