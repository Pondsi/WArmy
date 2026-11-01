import crypto from 'node:crypto';

/**
 * 工具调用指纹：同一工具 + **完全相同的参数**（键序无关）⇒ 同一指纹；只要有一个字节不同 ⇒ 不同指纹。
 *
 * 前 400 字是给人看的预览（判异常的提示词与审计里会截一段显示）；**唯一性靠全文哈希**。
 * 旧版只取前 400 字：键排序后 `content` 排在 `path` 前面，两个只差路径的长正文调用撞成同一指纹 ——
 * 第 48 轮真机，本地 27B 把一段小说写进了拼错名字的文件，改去正确文件追加同一段时被当成"原样重复"连拦两次，
 * 整轮被记成 `tool-repeat-3x`。
 */
export function gongJuZhiWen(ming: string, can: unknown): string {
  let s = '';
  try {
    const raw = typeof can === 'string' ? can : JSON.stringify(can ?? {});
    const obj = JSON.parse(raw || '{}');
    const wen = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(wen);
      if (v && typeof v === 'object') {
        const o: Record<string, unknown> = {};
        for (const k of Object.keys(v as Record<string, unknown>).sort()) o[k] = wen((v as Record<string, unknown>)[k]);
        return o;
      }
      return v;
    };
    s = JSON.stringify(wen(obj));
  } catch { s = String(can ?? ''); }
  const hao = crypto.createHash('sha256').update(ming + '\u0000' + s).digest('hex').slice(0, 20);
  return ming + '|' + s.slice(0, 400) + '#' + hao;
}
