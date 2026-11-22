/**
 * R287 P4-3：ASR 静音/无语音判定纯函数唯一 owner（自 electron-main 迁出，行为逐字保持）。
 *  · asrWuYuYin：端点结果无语音判定（no_speech 标志 / no_speech_prob≥0.85 且 avg_logprob≤-0.8 / 全 segments 命中）；
 *  · asrPcm16JingYin：仅解析完整 RIFF/WAVE PCM16 测静音（RMS<0.003 且 peak<0.02），不把浮点/压缩/8bit 音频当 int16。
 * 纯函数、无副作用、零依赖；门禁可直接 import 跑断言（同 gong-ju-fen-dang/gong-ju-wen-ding 范式）。
 */

/** 端点报告无有效语音（顶层或 choices[0].message 同判） */
export function asrWuYuYin(d: unknown): boolean {
  const x = d as { no_speech?: boolean; no_speech_prob?: number; avg_logprob?: number; segments?: unknown[] } | null;
  if (!x) return false;
  if (x.no_speech === true) return true;
  const wuYuYin = (v: unknown) => {
    const s = v as { no_speech_prob?: number; avg_logprob?: number } | null;
    return typeof s?.no_speech_prob === 'number' && s.no_speech_prob >= 0.85
      && typeof s.avg_logprob === 'number' && s.avg_logprob <= -0.8;
  };
  return wuYuYin(x) || (Array.isArray(x.segments) && x.segments.length > 0 && x.segments.every(wuYuYin));
}

/** 仅解析完整 RIFF/WAVE PCM16；不可把浮点/压缩/8bit 音频当 int16 测静音。 */
export function asrPcm16JingYin(buf: Buffer, geShi: string): boolean {
  if (geShi.toLowerCase() !== 'wav' || buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF'
    || buf.toString('ascii', 8, 12) !== 'WAVE') return false;
  const end = buf.readUInt32LE(4) + 8;
  if (end > buf.length || end < 44) return false;
  let rate = 0, align = 0, pcm16 = false;
  const data: Array<{ start: number; len: number }> = [];
  let off = 12;
  while (off + 8 <= end) {
    const id = buf.toString('ascii', off, off + 4), len = buf.readUInt32LE(off + 4), start = off + 8;
    if (start + len > end) return false;
    if (id === 'fmt ') {
      if (len < 16) return false;
      const channels = buf.readUInt16LE(start + 2);
      rate = buf.readUInt32LE(start + 4);
      align = buf.readUInt16LE(start + 12);
      pcm16 = buf.readUInt16LE(start) === 1 && buf.readUInt16LE(start + 14) === 16
        && channels > 0 && align === channels * 2 && rate > 0
        && buf.readUInt32LE(start + 8) === rate * align;
    } else if (id === 'data') data.push({ start, len });
    off = start + len + (len % 2);
  }
  if (off !== end || !pcm16 || !data.length || data.some((d) => d.len % align !== 0)) return false;
  const bytes = data.reduce((n, d) => n + d.len, 0);
  if (bytes / (rate * align) < 0.1) return false;
  let sum = 0, peak = 0;
  for (const d of data) {
    for (let i = d.start; i < d.start + d.len; i += 2) {
      const v = buf.readInt16LE(i) / 32768;
      sum += v * v;
      peak = Math.max(peak, Math.abs(v));
    }
  }
  return Math.sqrt(sum / (bytes / 2)) < 0.003 && peak < 0.02;
}