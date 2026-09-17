/**
 * provider 层小工具（无副作用、无依赖）
 */

/** 不建议按字符切断代理对（会产出半个 emoji） */
function isHighSurrogate(ch: string | undefined): boolean {
  if (!ch) return false;
  const c = ch.charCodeAt(0);
  return c >= 0xd800 && c <= 0xdbff;
}

/** 安全截到 max 个字符：不切出半个代理对；max ≤ 0 返回空串 */
export function clipTailSafe(s: string, max: number): string {
  if (max <= 0) return '';
  if (s.length <= max) return s;
  let out = s.slice(0, max);
  if (isHighSurrogate(out[out.length - 1])) out = out.slice(0, -1);
  return out;
}
