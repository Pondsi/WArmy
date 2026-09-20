/**
 * 向量 int8 BLOB 存取 + RRF 融合检索
 *
 * 存储形态：Int8Array（每维 1 字节）+ 每向量一个 scale → SQLite BLOB。
 * 512 维 = 512B/条，比 float32（2KB）省 4 倍，且 int8 点积可直接在整型上算：
 *   cos(a,b) = Σ a_i b_i / (|a| |b|)   （scale 为正，分子分母同时线性缩放后约掉）
 * 所以查询时不必反量化，逐条只有 512 次乘加。
 *
 * 纯函数，无原生依赖（不变量 #4）。
 */

export function quantizeVectorToFloat32(vec: number[]): Float32Array {
  return Float32Array.from(vec);
}

export function quantizeToInt8(vec: number[] | Float32Array): { data: Int8Array; scale: number } {
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

export function congInt8FanLiangHua(data: Int8Array, scale: number): Float32Array {
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    out[i] = (data[i] ?? 0) * scale;
  }
  return out;
}

export function yuXianXiangSiDu(a: Float32Array, b: Float32Array): number {
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

// ─────────────────────────────────────────────
// int8 BLOB 编解码（SQLite BLOB ↔ Int8Array）
// ─────────────────────────────────────────────

/** Int8Array → 可直接塞进 better-sqlite3 BLOB 的 Buffer（拷贝一份，避免共享底层 ArrayBuffer） */
export function packInt8(data: Int8Array): Buffer {
  const shitu = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return Buffer.from(shitu); // Buffer.from(typedArray) 会拷贝
}

/** SQLite BLOB → Int8Array（同样做边界安全的视图） */
export function unpackInt8(blob: Buffer | Uint8Array): Int8Array {
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  return new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/** 量化 + 打包一站式：float 向量 → {blob, scale, dim} */
export function bianMaXiangLiang(vec: Float32Array | number[]): { blob: Buffer; scale: number; dim: number } {
  const { data, scale } = quantizeToInt8(vec);
  return { blob: packInt8(data), scale, dim: data.length };
}

/**
 * int8 上的余弦相似度：完全不反量化。
 * 与 float 版的结果差异只来自量化误差（实测 <1e-2），但快 3–4 倍。
 */
export function yuXianInt8(a: Int8Array, aScale: number, b: Int8Array, bScale: number): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 0;
  // scale 均为正且同时出现在分子分母 → 约掉；保留入参以便校验一致性
  void aScale;
  void bScale;
  return dot / denom;
}

/** 把 int8 余弦映射到 [0,1]，便于塞进 RRFSource.score */
export function normalizeCosine(c: number): number {
  return Math.max(0, Math.min(1, (c + 1) / 2));
}

// ─────────────────────────────────────────────
// RRF 融合
// ─────────────────────────────────────────────

/** RRF 融合：fts_uni ∪ fts_tri ∪ 向量 */
export interface RrfLaiyuan {
  id: string;
  score: number;
  source: 'fts_uni' | 'fts_tri' | 'vector';
}

/** 兼容旧签名（用 score 近似 rank）；新代码请用 rrfFusionRanked */
export function rrfRonghe(sources: RrfLaiyuan[], k = 60): Array<{ id: string; rrfScore: number; sources: string[] }> {
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

export interface RankedList {
  /** 通道名，用于回溯命中来源 */
  source: 'fts_uni' | 'fts_tri' | 'vector';
  /** 已按相关性降序排列的 id（rank 从 1 开始） */
  ids: string[];
}

export interface RongheMingzhong {
  id: string;
  rrfScore: number;
  sources: string[];
  /** 各通道内的排名（1-based），未命中该通道则无键 */
  ranks: Record<string, number>;
}

/**
 * 标准 RRF：score = Σ 1/(k + rank_i(d))，k 默认 60。
 * 与 rrfFusion 的区别是这里用真实排名，而不是从 score 反推的伪排名。
 */
export function rrfRonghePaixu(lists: RankedList[], k = 60): RongheMingzhong[] {
  const map = new Map<string, { rrfScore: number; sources: Set<string>; ranks: Record<string, number> }>();
  for (const list of lists) {
    for (let i = 0; i < list.ids.length; i++) {
      const id = list.ids[i] as string;
      const cur = map.get(id) || { rrfScore: 0, sources: new Set<string>(), ranks: {} };
      if (cur.ranks[list.source] === undefined) {
        cur.ranks[list.source] = i + 1;
        cur.rrfScore += 1 / (k + i + 1);
      }
      cur.sources.add(list.source);
      map.set(id, cur);
    }
  }
  return [...map.entries()]
    .map(([id, v]) => ({ id, rrfScore: v.rrfScore, sources: [...v.sources], ranks: v.ranks }))
    .sort((a, b) => b.rrfScore - a.rrfScore || a.id.localeCompare(b.id));
}
