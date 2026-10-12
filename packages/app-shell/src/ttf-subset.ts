/**
 * ttf-subset —— **零依赖的 TrueType 子集化**（只为把我们真正用到的字形嵌进 PDF）。
 *
 * 为什么必须有它
 * ---------------------------------------------------------------------------
 * 真事故：PDF 的 14 个标准字体（Helvetica 等）**没有任何中文字形**，直接写中文
 * 在阅读器里是空白/乱码；要出中文 PDF 只有两条路：
 *   ① 内嵌一个完整中文字体 —— 一份 CJK 字体 9~20 MB，每张 PDF 都背上它，无法接受；
 *   ② 内嵌**子集** —— 只带这一篇文档用到的字形，通常几 KB。
 * 这里实现 ②。它同时产出 `ToUnicode` 所需的"字形号 ↔ 码位"映射，
 * 让 PDF 里的中文**能被复制、能被检索**（不是一张图）。
 *
 * 设计取舍（如实记录）：
 *   · 只吃 **单一 TTF**（sfnt 版本 0x00010000 / 'true'）；TTC 集合包**不支持**
 *     （Windows 上 simhei.ttf / simfang.ttf / simkai.ttf 是单体 TTF，够用）。
 *   · 只重建 `glyf / loca / cmap / hmtx / hhea / maxp / head`，
 *     `OS/2 / post / name` 原样带走（它们很小，且阅读器喜欢它们在场）。
 *   · 复合字形（component）**递归带全**，否则带圈的汉字/偏旁会缺笔。
 *   · `cmap` 先建 format 4（BMP），出现非 BMP 码位再补 format 12。
 *
 * 纯函数、纯 Node —— 便于门禁在无头环境直接喂样例字体断言。
 */
import fs from 'node:fs';

/* ── 表目录 ───────────────────────────────────────────────────────── */

export interface TtfBiao {
  offset: number;
  length: number;
}

export function duTtfBiao(buf: Buffer): Map<string, TtfBiao> {
  const out = new Map<string, TtfBiao>();
  if (buf.length < 12) return out;
  const sfnt = buf.readUInt32BE(0);
  // 0x00010000 = TrueType, 'true'/'ttcf' 另论；TTC 这里明确不支持
  if (sfnt !== 0x00010000 && sfnt !== 0x74727565) return out;
  const numTables = buf.readUInt16BE(4);
  let off = 12;
  for (let i = 0; i < numTables && off + 16 <= buf.length; i++, off += 16) {
    const tag = buf.subarray(off, off + 4).toString('latin1');
    const to = buf.readUInt32BE(off + 8);
    const len = buf.readUInt32BE(off + 12);
    if (to + len <= buf.length) out.set(tag, { offset: to, length: len });
  }
  return out;
}

/** 字体基本度量（PDF FontDescriptor 要用） */
export interface TtfDuLiang {
  unitsPerEm: number;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  ascender: number;
  descender: number;
  numGlyphs: number;
  indexToLocFormat: number;
  numberOfHMetrics: number;
}

export function duTtfDuLiang(buf: Buffer, biao: Map<string, TtfBiao>): TtfDuLiang | null {
  const head = biao.get('head');
  const hhea = biao.get('hhea');
  const maxp = biao.get('maxp');
  if (!head || !hhea || !maxp) return null;
  return {
    unitsPerEm: buf.readUInt16BE(head.offset + 18) || 1000,
    xMin: buf.readInt16BE(head.offset + 36),
    yMin: buf.readInt16BE(head.offset + 38),
    xMax: buf.readInt16BE(head.offset + 40),
    yMax: buf.readInt16BE(head.offset + 42),
    indexToLocFormat: buf.readInt16BE(head.offset + 50),
    ascender: buf.readInt16BE(hhea.offset + 4),
    descender: buf.readInt16BE(hhea.offset + 6),
    numberOfHMetrics: buf.readUInt16BE(hhea.offset + 34),
    numGlyphs: buf.readUInt16BE(maxp.offset + 4),
  };
}

/* ── cmap：码位 → 字形号 ───────────────────────────────────────────── */

export function duCmap(buf: Buffer, biao: Map<string, TtfBiao>): Map<number, number> {
  const out = new Map<number, number>();
  const cm = biao.get('cmap');
  if (!cm) return out;
  const base = cm.offset;
  const n = buf.readUInt16BE(base + 2);
  const houXuan: Array<{ pid: number; eid: number; off: number }> = [];
  for (let i = 0; i < n; i++) {
    const r = base + 4 + i * 8;
    if (r + 8 > base + cm.length) break;
    houXuan.push({ pid: buf.readUInt16BE(r), eid: buf.readUInt16BE(r + 2), off: base + buf.readUInt32BE(r + 4) });
  }
  // 优先级：(3,10) 全 Unicode → (3,1) BMP → (0,*) → 其它
  const ping = (p: { pid: number; eid: number }) =>
    (p.pid === 3 && p.eid === 10) ? 0 : (p.pid === 3 && p.eid === 1) ? 1 : (p.pid === 0) ? 2 : 3;
  houXuan.sort((a, b) => ping(a) - ping(b));
  for (const p of houXuan) {
    if (p.off + 2 > buf.length) continue;
    const fmt = buf.readUInt16BE(p.off);
    try {
      if (fmt === 4) duCmap4(buf, p.off, out);
      else if (fmt === 12) duCmap12(buf, p.off, out);
    } catch { /* 单个子表坏不影响其它 */ }
    if (out.size) break; // 取到一张能用的就够（同一字体各子表语义一致）
  }
  return out;
}

function duCmap4(buf: Buffer, off: number, out: Map<number, number>): void {
  const segX2 = buf.readUInt16BE(off + 6);
  const seg = segX2 >> 1;
  const endO = off + 14;
  const startO = endO + segX2 + 2;
  const deltaO = startO + segX2;
  const rangeO = deltaO + segX2;
  for (let i = 0; i < seg; i++) {
    const end = buf.readUInt16BE(endO + i * 2);
    const start = buf.readUInt16BE(startO + i * 2);
    const delta = buf.readInt16BE(deltaO + i * 2);
    const ro = buf.readUInt16BE(rangeO + i * 2);
    if (start === 0xffff && end === 0xffff) continue;
    for (let c = start; c <= end && c !== 0x10000; c++) {
      let g: number;
      if (ro === 0) g = (c + delta) & 0xffff;
      else {
        const gi = rangeO + i * 2 + ro + (c - start) * 2;
        if (gi + 2 > buf.length) continue;
        g = buf.readUInt16BE(gi);
        if (g !== 0) g = (g + delta) & 0xffff;
      }
      if (g) out.set(c, g);
    }
  }
}

function duCmap12(buf: Buffer, off: number, out: Map<number, number>): void {
  const n = buf.readUInt32BE(off + 12);
  for (let i = 0; i < n; i++) {
    const r = off + 16 + i * 12;
    if (r + 12 > buf.length) break;
    const s = buf.readUInt32BE(r);
    const e = buf.readUInt32BE(r + 4);
    const g = buf.readUInt32BE(r + 8);
    if (e - s > 0x10ffff) continue;
    for (let c = s; c <= e; c++) out.set(c, g + (c - s));
  }
}

/* ── 字形数据 ─────────────────────────────────────────────────────── */

export function duLoca(buf: Buffer, biao: Map<string, TtfBiao>, du: TtfDuLiang): number[] {
  const loca = biao.get('loca');
  const out: number[] = [];
  if (!loca) return out;
  const n = du.numGlyphs + 1;
  for (let i = 0; i < n; i++) {
    if (du.indexToLocFormat === 0) {
      const p = loca.offset + i * 2;
      out.push(p + 2 <= loca.offset + loca.length ? buf.readUInt16BE(p) * 2 : 0);
    } else {
      const p = loca.offset + i * 4;
      out.push(p + 4 <= loca.offset + loca.length ? buf.readUInt32BE(p) : 0);
    }
  }
  return out;
}

export function duHmtx(buf: Buffer, biao: Map<string, TtfBiao>, du: TtfDuLiang): Array<{ advance: number; lsb: number }> {
  const hm = biao.get('hmtx');
  const out: Array<{ advance: number; lsb: number }> = [];
  if (!hm) return out;
  let lastAdvance = 0;
  const nhm = Math.max(1, du.numberOfHMetrics);
  for (let i = 0; i < du.numGlyphs; i++) {
    if (i < nhm) {
      const p = hm.offset + i * 4;
      if (p + 4 > hm.offset + hm.length) { out.push({ advance: lastAdvance, lsb: 0 }); continue; }
      lastAdvance = buf.readUInt16BE(p);
      out.push({ advance: lastAdvance, lsb: buf.readInt16BE(p + 2) });
    } else {
      const p = hm.offset + nhm * 4 + (i - nhm) * 2;
      out.push({ advance: lastAdvance, lsb: p + 2 <= hm.offset + hm.length ? buf.readInt16BE(p) : 0 });
    }
  }
  return out;
}

/** 复合字形引用了哪些 component 字形号（非复合返回空） */
export function fuheZuJian(glyf: Buffer, start: number, end: number): number[] {
  const out: number[] = [];
  if (end - start < 10) return out;
  const nc = glyf.readInt16BE(start);
  if (nc >= 0) return out; // 简单字形
  let off = start + 10;
  const ARG_1_AND_2_ARE_WORDS = 0x0001;
  const WE_HAVE_A_SCALE = 0x0008;
  const MORE_COMPONENTS = 0x0020;
  const WE_HAVE_AN_X_AND_Y_SCALE = 0x0040;
  const WE_HAVE_A_TWO_BY_TWO = 0x0080;
  for (let guard = 0; guard < 64; guard++) {
    if (off + 4 > end) break;
    const flags = glyf.readUInt16BE(off);
    out.push(glyf.readUInt16BE(off + 2));
    off += 4;
    off += (flags & ARG_1_AND_2_ARE_WORDS) ? 4 : 2;
    if (flags & WE_HAVE_A_SCALE) off += 2;
    else if (flags & WE_HAVE_AN_X_AND_Y_SCALE) off += 4;
    else if (flags & WE_HAVE_A_TWO_BY_TWO) off += 8;
    if (!(flags & MORE_COMPONENTS)) break;
  }
  return out;
}

/* ── 子集化 ───────────────────────────────────────────────────────── */

export interface ZiJiJieGuo {
  /** 子集字体二进制（直接作为 FontFile2 嵌入） */
  font: Buffer;
  /** 码位 → 新字形号（cid）；未收录的字形不会出现在这里 */
  cid: Map<number, number>;
  /** 度量：便于上层算行宽/画字 */
  du: TtfDuLiang;
  /** 新字体的 advance（按新字形号索引，单位 = 字体自身 unit） */
  advance: number[];
  /** 用到的码位里，字体里**没有**字形的那几个（如实上报，不装作有） */
  queShi: string[];
}

/** 取字体里某个码位的字形数据（含空字形） */
function ziXingShu(glyf: Buffer, loca: number[], g: number): { start: number; end: number } {
  const s = loca[g] ?? 0;
  const e = loca[g + 1] ?? s;
  return { start: e > s ? s : 0, end: e > s ? e : 0 };
}

/**
 * 子集化：只保留 `wenZi` 里用到的字形（外加复合字形的依赖）。
 * @param buf 原始 TTF
 * @param wenZi 文档里出现的全部字符
 */
export function ziJiHua(buf: Buffer, wenZi: string): ZiJiJieGuo | null {
  const biao = duTtfBiao(buf);
  const du = duTtfDuLiang(buf, biao);
  if (!du) return null;
  const cmap = duCmap(buf, biao);
  const loca = duLoca(buf, biao, du);
  const hmtx = duHmtx(buf, biao, du);
  const glyfBiao = biao.get('glyf');
  if (!glyfBiao || !loca.length) return null;

  // 码位 → 老字形号
  const yao = new Set<number>([0]);
  const cidLao = new Map<number, number>();
  const queShi: string[] = [];
  const yiJian = new Set<string>();
  for (const ch of String(wenZi || '')) {
    if (yiJian.has(ch)) continue;
    yiJian.add(ch);
    const cp = ch.codePointAt(0) ?? 0;
    const g = cmap.get(cp);
    if (!g) { if (cp > 32) queShi.push(ch); continue; }
    cidLao.set(cp, g);
    yao.add(g);
  }
  // 复合字形依赖递归带全
  {
    const dui = [...yao];
    for (let i = 0; i < dui.length; i++) {
      const { start, end } = ziXingShu(buf.subarray(glyfBiao.offset, glyfBiao.offset + glyfBiao.length), loca, dui[i]!);
      if (!end) continue;
      const glyf = buf.subarray(glyfBiao.offset, glyfBiao.offset + glyfBiao.length);
      for (const c of fuheZuJian(glyf, start, end)) {
        if (!yao.has(c)) { yao.add(c); dui.push(c); }
      }
    }
  }

  // 老序号升序 → 新序号（0 必须留在 0）
  const paiLie = [...yao].sort((a, b) => a - b);
  const lao2xin = new Map<number, number>();
  paiLie.forEach((g, i) => lao2xin.set(g, i));
  const xinNum = paiLie.length;

  // 重建 glyf / loca（长格式，4 字节对齐）
  const glyfSrc = buf.subarray(glyfBiao.offset, glyfBiao.offset + glyfBiao.length);
  const xinGlyf: Buffer[] = [];
  const xinLoca: number[] = [0];
  let leiji = 0;
  paiLie.forEach((g, i) => {
    let kuai: Buffer;
    if (g === 0) {
      kuai = Buffer.alloc(0);
    } else {
      const { start, end } = ziXingShu(glyfSrc, loca, g);
      if (!end) kuai = Buffer.alloc(0);
      else if (glyfSrc.readInt16BE(start) >= 0) kuai = Buffer.from(glyfSrc.subarray(start, end));
      else {
        // 复合字形：原样搬运，但把 component 的 glyphIndex 改成新号
        kuai = Buffer.from(glyfSrc.subarray(start, end));
        const ARG_1_AND_2_ARE_WORDS = 0x0001, WE_HAVE_A_SCALE = 0x0008;
        const MORE_COMPONENTS = 0x0020, X_Y_SCALE = 0x0040, TWO_BY_TWO = 0x0080;
        let off = 10;
        for (let guard = 0; guard < 64; guard++) {
          if (off + 4 > kuai.length) break;
          const flags = kuai.readUInt16BE(off);
          const laoG = kuai.readUInt16BE(off + 2);
          const xinG = lao2xin.get(laoG);
          if (xinG === undefined) break;
          kuai.writeUInt16BE(xinG, off + 2);
          off += 4;
          off += (flags & ARG_1_AND_2_ARE_WORDS) ? 4 : 2;
          if (flags & WE_HAVE_A_SCALE) off += 2;
          else if (flags & X_Y_SCALE) off += 4;
          else if (flags & TWO_BY_TWO) off += 8;
          if (!(flags & MORE_COMPONENTS)) break;
        }
      }
    }
    const pad = (4 - (leiji % 4)) % 4;
    if (pad) { xinGlyf.push(Buffer.alloc(pad)); leiji += pad; }
    xinGlyf.push(kuai);
    leiji += kuai.length;
    xinLoca.push(leiji);
    void i;
  });
  const glyfBuf = Buffer.concat(xinGlyf);
  const locaBuf = Buffer.alloc((xinNum + 1) * 4);
  xinLoca.forEach((v, i) => locaBuf.writeUInt32BE(v, i * 4));

  // hmtx：提前量按新号索引
  const xinAdvance: number[] = paiLie.map((g) => hmtx[g]?.advance ?? 0);
  const hmtxBuf = Buffer.alloc(xinNum * 4);
  xinAdvance.forEach((a, i) => {
    hmtxBuf.writeUInt16BE(Math.min(65535, Math.max(0, a | 0)), i * 4);
    hmtxBuf.writeInt16BE(0, i * 4 + 2);
  });

  // maxp / hhea / head：复制后改必要字段
  const maxpBuf = Buffer.from(buf.subarray(biao.get('maxp')!.offset, biao.get('maxp')!.offset + biao.get('maxp')!.length));
  maxpBuf.writeUInt16BE(xinNum, 4);
  const hheaBuf = Buffer.from(buf.subarray(biao.get('hhea')!.offset, biao.get('hhea')!.offset + biao.get('hhea')!.length));
  hheaBuf.writeUInt16BE(xinNum, 34);
  const headBuf = Buffer.from(buf.subarray(biao.get('head')!.offset, biao.get('head')!.offset + biao.get('head')!.length));
  headBuf.writeInt16BE(1, 50); // indexToLocFormat = long
  headBuf.writeUInt32BE(0, 8);  // checkSumAdjustment 交给最后统一算

  // cmap：优先 format 4（BMP），非 BMP 码位再补 format 12
  const bmp: Array<[number, number]> = [];
  const feiBmp: Array<[number, number]> = [];
  for (const [cp, lao] of cidLao) {
    const xin = lao2xin.get(lao);
    if (xin === undefined) continue;
    if (cp <= 0xffff) bmp.push([cp, xin]); else feiBmp.push([cp, xin]);
  }
  bmp.sort((a, b) => a[0] - b[0]);
  feiBmp.sort((a, b) => a[0] - b[0]);
  const cmap4 = xieCmap4(bmp);
  const cmap12 = feiBmp.length ? xieCmap12(feiBmp) : null;

  const cmapBuf = (() => {
    const ziBiao: Array<{ pid: number; eid: number; data: Buffer }> = [{ pid: 3, eid: 1, data: cmap4 }];
    if (cmap12) { ziBiao.push({ pid: 3, eid: 10, data: cmap12 }); ziBiao.push({ pid: 0, eid: 4, data: cmap12 }); }
    const n = ziBiao.length;
    const head = Buffer.alloc(4 + n * 8);
    head.writeUInt16BE(0, 0);
    head.writeUInt16BE(n, 2);
    let off = head.length;
    const bufs: Buffer[] = [];
    ziBiao.forEach((z, i) => {
      head.writeUInt16BE(z.pid, 4 + i * 8);
      head.writeUInt16BE(z.eid, 6 + i * 8);
      head.writeUInt32BE(off, 8 + i * 8);
      bufs.push(z.data);
      off += z.data.length;
    });
    return Buffer.concat([head, ...bufs]);
  })();

  // 组表
  const tables: Array<{ tag: string; data: Buffer }> = [
    { tag: 'cmap', data: cmapBuf },
    { tag: 'glyf', data: glyfBuf },
    { tag: 'head', data: headBuf },
    { tag: 'hhea', data: hheaBuf },
    { tag: 'hmtx', data: hmtxBuf },
    { tag: 'loca', data: locaBuf },
    { tag: 'maxp', data: maxpBuf },
  ];
  for (const tag of ['OS/2', 'post', 'name']) {
    const b = biao.get(tag);
    if (b) tables.push({ tag, data: Buffer.from(buf.subarray(b.offset, b.offset + b.length)) });
  }
  // hhea.numberOfHMetrics 必须等于 hmtx 条数（上面已按 xinNum 写）
  const out = zuTtf(tables);

  const cidMap = new Map<number, number>();
  for (const [cp, lao] of cidLao) {
    const xin = lao2xin.get(lao);
    if (xin !== undefined) cidMap.set(cp, xin);
  }
  return { font: out, cid: cidMap, du, advance: xinAdvance, queShi };
}

function xieCmap4(bmp: Array<[number, number]>): Buffer {
  // 造段：连续码位合并
  const duan: Array<{ s: number; e: number; delta: number }> = [];
  for (const [cp, g] of bmp) {
    const last = duan[duan.length - 1];
    const expect = last ? (last.e + 1 + last.delta) & 0xffff : 0;
    if (last && cp === last.e + 1 && g === expect) last.e = cp;
    else duan.push({ s: cp, e: cp, delta: (g - cp) & 0xffff });
  }
  duan.push({ s: 0xffff, e: 0xffff, delta: 1 }); // 收尾段（规范要求）
  const seg = duan.length;
  const segX2 = seg * 2;
  const len = 16 + segX2 * 4;
  const buf = Buffer.alloc(len);
  buf.writeUInt16BE(4, 0);
  buf.writeUInt16BE(len, 2);
  buf.writeUInt16BE(0, 4);
  buf.writeUInt16BE(segX2, 6);          // segCountX2
  buf.writeUInt16BE(0, 8);              // searchRange（阅读器不校验）
  buf.writeUInt16BE(0, 10);
  buf.writeUInt16BE(0, 12);
  const endO = 14, startO = endO + segX2 + 2, deltaO = startO + segX2, rangeO = deltaO + segX2;
  duan.forEach((d, i) => {
    buf.writeUInt16BE(d.e, endO + i * 2);
    buf.writeUInt16BE(d.s, startO + i * 2);
    buf.writeUInt16BE(d.delta & 0xffff, deltaO + i * 2);
    buf.writeUInt16BE(0, rangeO + i * 2);
  });
  buf.writeUInt16BE(0, startO - 2); // reservedPad
  return buf;
}

function xieCmap12(feiBmp: Array<[number, number]>): Buffer {
  const zu: Array<{ s: number; e: number; g: number }> = [];
  for (const [cp, g] of feiBmp) {
    const last = zu[zu.length - 1];
    if (last && cp === last.e + 1 && g === last.g + (last.e - last.s) + 1) last.e = cp;
    else zu.push({ s: cp, e: cp, g });
  }
  const len = 16 + zu.length * 12;
  const buf = Buffer.alloc(len);
  buf.writeUInt16BE(12, 0);
  buf.writeUInt16BE(0, 2);
  buf.writeUInt32BE(len, 4);
  buf.writeUInt32BE(0, 8);
  buf.writeUInt32BE(zu.length, 12);
  zu.forEach((z, i) => {
    const r = 16 + i * 12;
    buf.writeUInt32BE(z.s, r);
    buf.writeUInt32BE(z.e, r + 4);
    buf.writeUInt32BE(z.g, r + 8);
  });
  return buf;
}

/** 按 sfnt 拼装，并算好表校验和与 head.checkSumAdjustment */
function zuTtf(tables: Array<{ tag: string; data: Buffer }>): Buffer {
  const list = [...tables].sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const n = list.length;
  let searchRange = 1, entrySelector = 0;
  while (searchRange * 2 <= n) { searchRange *= 2; entrySelector++; }
  searchRange *= 16;
  const rangeShift = n * 16 - searchRange;
  const head = Buffer.alloc(12 + n * 16);
  head.writeUInt32BE(0x00010000, 0);
  head.writeUInt16BE(n, 4);
  head.writeUInt16BE(searchRange, 6);
  head.writeUInt16BE(entrySelector, 8);
  head.writeUInt16BE(rangeShift, 10);
  let off = 12 + n * 16;
  const bufs: Buffer[] = [];
  let headOffset = -1;
  list.forEach((t, i) => {
    const tag = Buffer.from(t.tag.padEnd(4, ' ').slice(0, 4), 'latin1');
    tag.copy(head, 12 + i * 16);
    head.writeUInt32BE(0, 12 + i * 16 + 4); // checksum 占位
    head.writeUInt32BE(off, 12 + i * 16 + 8);
    head.writeUInt32BE(t.data.length, 12 + i * 16 + 12);
    if (t.tag === 'head') headOffset = off;
    const pad = (4 - (t.data.length % 4)) % 4;
    bufs.push(t.data, Buffer.alloc(pad));
    off += t.data.length + pad;
  });
  const body = Buffer.concat([head, ...bufs]);
  // 逐表校验和
  list.forEach((t, i) => {
    const to = body.readUInt32BE(12 + i * 16 + 8);
    const len = body.readUInt32BE(12 + i * 16 + 12);
    body.writeUInt32BE(biaoHe(body, to, len), 12 + i * 16 + 4);
  });
  if (headOffset >= 0) {
    body.writeUInt32BE(0, headOffset + 8);
    const total = biaoHe(body, 0, body.length);
    body.writeUInt32BE((0xb1b0afba - total) >>> 0, headOffset + 8);
  }
  return body;
}

function biaoHe(buf: Buffer, off: number, len: number): number {
  let sum = 0;
  const end = off + len;
  for (let p = off; p < end; p += 4) {
    const a = p < buf.length ? buf[p]! : 0;
    const b = p + 1 < buf.length ? buf[p + 1]! : 0;
    const c = p + 2 < buf.length ? buf[p + 2]! : 0;
    const d = p + 3 < buf.length ? buf[p + 3]! : 0;
    sum = (sum + (((a << 24) >>> 0) + (b << 16) + (c << 8) + d)) >>> 0;
  }
  return sum >>> 0;
}

/** 找一个可用的 CJK TrueType 单体字体（TTC 不支持，故只列 .ttf） */
export function zhaoCjkZiTi(): string {
  const an = [
    process.env['WARMY_PDF_FONT'] || '',
    'C:/Windows/Fonts/simhei.ttf',
    'C:/Windows/Fonts/simfang.ttf',
    'C:/Windows/Fonts/simkai.ttf',
    'C:/Windows/Fonts/SIMYOU.TTF',
    '/usr/share/fonts/truetype/arphic/uming.ttc',
    '/System/Library/Fonts/PingFang.ttc',
  ];
  for (const p of an) {
    try { if (p && fs.existsSync(p) && /\.ttf$/i.test(p)) return p; } catch { /* 继续找 */ }
  }
  return '';
}
