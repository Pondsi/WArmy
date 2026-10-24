/**
 * shi-chang.ts —— **用户原话里的"要等多久"**（第 39 轮，从 electron-main 里搬出来）
 *
 * 搬出来的理由：真机红过一次 —— 用户说"完成后等待 30 秒"，模型 `wait_seconds(20)` 就往下走，
 * 而宿主原来只数**等待的次数**、不算**累计秒数** ⇒ 少等 10 秒也算"等过了"。
 * 这种解析函数埋在 2 万行的主进程里就**没人测得动**（只能 grep 字符串，而 grep 证明不了口径），
 * 所以放到这个零依赖模块里，门禁可以直接 import 编译产物拿真实措辞跑断言。
 */

/** 中文/阿拉伯数字都行：`30`、`三十`、`两`、`十五`、`半`(=0.5)；认不出来返回 NaN（**不猜**） */
export function hanZiShu(s: string): number {
  const D: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const t = String(s || '').trim();
  if (!t) return NaN;
  if (/^\d+(?:\.\d+)?$/.test(t)) return Number(t);
  if (t === '半') return 0.5;
  if (t === '十') return 10;
  if (t.includes('十')) {
    const fen = t.split('十');
    const zuo = fen[0] ? (D[fen[0]] ?? NaN) : 1;
    const you = fen[1] ? (D[fen[1]] ?? 0) : 0;
    if (!Number.isFinite(zuo)) return NaN;
    return zuo * 10 + you;
  }
  return D[t] ?? NaN;
}

/**
 * 轮询/间隔不算"一次性欠账"：`每隔 10 秒看看`、`每 5 分钟提醒一次`、`直到…`、`反复…` ⇒
 * 这类句子交给原来的**次数**口径，秒数口径返回 0（否则会把"每隔 10 秒"当成只许等 10 秒）。
 */
const LUN_XUN = /每隔|每\s*(?:\d+|[一二两三四五六七八九十]+)\s*(?:秒|分钟|小时)|轮询|直到|反复|every\s+\d|\bpoll|\buntil\b/i;
const SHI_CHANG = /(?:(\d+(?:\.\d+)?|[零一二两三四五六七八九十百半]+)\s*(秒钟|秒|分钟|个?小时|seconds?|secs?|minutes?|mins?|hours?)|(半)\s*(分钟|个?小时|hours?|mins?))/gi;

/**
 * **用户要求累计等多久（秒）**：把原话里所有时长**加总**
 * （"先等 10 秒再等 20 秒" ⇒ 30；"等待 30 秒" ⇒ 30；"半分钟" ⇒ 30；"两分钟" ⇒ 120）。
 * 超过一天（86400 秒）判成解析出错 ⇒ 返回 0：宁可回到"不算秒数"，也不许拿一个荒唐值去催模型等一天。
 */
export function yaoQiuDengDaiMiaoShu(yuanWen: string): number {
  const s = String(yuanWen || '');
  if (LUN_XUN.test(s)) return 0;
  let he = 0;
  let m: RegExpExecArray | null;
  SHI_CHANG.lastIndex = 0;
  while ((m = SHI_CHANG.exec(s))) {
    const dan = String(m[2] || m[4] || '').toLowerCase();
    const bei = /秒|sec/.test(dan) ? 1 : /分钟|min/.test(dan) ? 60 : /小时|hour/.test(dan) ? 3600 : 0;
    const n = m[3] === '半' ? 0.5 : hanZiShu(String(m[1] || ''));
    if (Number.isFinite(n) && bei) he += n * bei;
  }
  return he > 0 && he <= 86400 ? Math.round(he) : 0;
}

/** **要求等几回**（原来的次数口径，与秒数口径配合使用） */
export function yuanWenDengDaiCiShu(yuanWen: string): number {
  const s = String(yuanWen || '');
  if (LUN_XUN.test(s)) return 0;
  const m = s.match(/(?:\d+(?:\.\d+)?|[零一二两三四五六七八九十百半]+)\s*(?:秒钟|秒|分钟|个?小时|seconds?|secs?|minutes?|mins?|hours?)/gi);
  return m ? m.length : 0;
}
