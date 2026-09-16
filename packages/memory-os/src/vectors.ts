/**
 * 向量 int8 BLOB 存取 + RRF 融合检索
 */
export function quantizeVectorToFloat32(vec: number[]): Float32Array {
  return Float32Array.from(vec);
}

export function quantizeToInt8(vec: number[]): { data: Int8Array; scale: number } {
  let max = 0;
  for (const v of vec) {
    const a = Math.abs(v);
    if (a > max) max = a;
  }
  const scale = max > 0 ? max / 127 : 1;
  const data = new Int8Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    data[i] = Math.round((vec[i] ?? 0) / scale);
  }
  return { data, scale };
}

export function dequantizeFromInt8(data: Int8Array, scale: number): Float32Array {
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    out[i] = (data[i] ?? 0) * scale;
  }
  return out;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

/** RRF 融合：fts_uni ∪ fts_tri ∪ 向量 */
export interface RrfSource {
  id: string;
  score: number;
  source: 'fts_uni' | 'fts_tri' | 'vector';
}

export function rrfFusion(sources: RrfSource[], k = 60): Array<{ id: string; rrfScore: number; sources: string[] }> {
  const map = new Map<string, { rrfScore: number; sources: Set<string> }>();
  for (const s of sources) {
    const cur = map.get(s.id) || { rrfScore: 0, sources: new Set<string>() };
    // RRF: 1 / (k + rank)，用 score 近似 rank
    cur.rrfScore += 1 / (k + (1 - s.score) * 100);
    cur.sources.add(s.source);
    map.set(s.id, cur);
  }
  return [...map.entries()]
    .map(([id, v]) => ({ id, rrfScore: v.rrfScore, sources: [...v.sources] }))
    .sort((a, b) => b.rrfScore - a.rrfScore);
}
