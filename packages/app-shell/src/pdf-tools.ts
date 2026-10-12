/**
 * pdf-tools —— **零依赖的 PDF 生成与文本抽取**。
 *
 * 为什么必须有它
 * ---------------------------------------------------------------------------
 * 真事故：产品有 make_docx / make_pptx，用户要 pdf 时模型只能用 write_file 写一个
 * 后缀叫 .pdf 的文本文件 —— 打开是乱码，等于骗人。而 AI 干活（合同、报告、发票）
 * 有相当一部分要求 PDF。这里补齐生成。
 *
 * 中文必须**不是图**：
 *   PDF 14 个标准字体没有中文字形，直接写中文在阅读器里是空白。所以这里
 *   ① 找一份系统中的 CJK TrueType 单体字体；
 *   ② 用 `ttf-subset.ts` 只把它这篇文档用到的字形切出来（几 KB）；
 *   ③ 以 Identity-H + CIDFontType2 内嵌，并写 `ToUnicode` ——
 *      于是 PDF 里的中文**可以复制、可以检索**，不是一张贴图。
 *
 * 读取侧同样是**如实**的：
 *   能抽到文本就返回文本；抽不到（扫描件、纯图片页）就说"抽不到，需要 OCR"，
 *   绝不返回一段看着像正文的幻觉。
 *
 * 纯函数、纯 Node —— 门禁可在无头环境直接断言（见 scripts/verify-office-xlsx-pdf.mjs）。
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { ziJiHua, zhaoCjkZiTi, type TtfDuLiang } from './ttf-subset.js';

/* ────────────────────────────── 生成 ────────────────────────────── */

export interface PdfDuanLuo {
  text: string;
  /** 字号（pt），默认 12 */
  size?: number;
  /** 伪粗体（同一段文字描边叠画一次，不需要另配粗体字体） */
  bold?: boolean;
  /** 段前额外留白（pt） */
  spaceBefore?: number;
  /** 左缩进（pt） */
  indent?: number;
}

export interface PdfXuanXiang {
  /** 交给阅读器显示的标题（写入 /Title） */
  title?: string;
  author?: string;
  /** 显式指定字体；不给就用系统 CJK 字体 */
  fontPath?: string;
  pageSize?: 'A4' | 'Letter';
}

export interface PdfJieGuo {
  ok: boolean;
  buffer?: Buffer;
  /** 用到的字体路径（没字体时为空，此时 ok=false） */
  fontPath?: string;
  /** 字体里缺字形、无法还原的字符（如实上报） */
  queShi?: string[];
  error?: string;
}

const A4 = { w: 595.28, h: 841.89 };
const LETTER = { w: 612, h: 792 };
const YU = 72;         // 页边距（1 英寸）

/** UTF-16BE 字节（Node 只有 utf16le，BE 要自己拼） */
function utf16beBuf(s: string): Buffer {
  const t = String(s ?? '');
  const b = Buffer.alloc(t.length * 2);
  for (let i = 0; i < t.length; i++) b.writeUInt16BE(t.charCodeAt(i), i * 2);
  return b;
}

function utf16beHex(s: string): string {
  return utf16beBuf(s).toString('hex').toUpperCase();
}

function jiao(s: string): string { // PDF 字面量转义
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/\r/g, '\\r');
}

function pdfWenZi(s: string): string { // PDFDocEncoding 近似（仅标题/作者这类元信息）
  return s.replace(/[^\x20-\x7e]/g, '?');
}

/** UTF-16BE 十六进制串（PDF 文本字符串用） */
function utf16Hex(s: string): string {
  return '<' + utf16beHex(s) + '>';
}

/**
 * 生成 PDF。
 * 中文字形全部来自内嵌子集字体；ASCII 也走同一字体（保证基线一致、不出现双字体跳字）。
 */
export function shengChengPdf(duanLuo: PdfDuanLuo[], opts: PdfXuanXiang = {}): PdfJieGuo {
  const allText = (duanLuo || []).map((d) => String(d?.text ?? '')).join('\n') + ' \n';
  const fontPath = opts.fontPath || zhaoCjkZiTi();
  if (!fontPath || !fs.existsSync(fontPath)) {
    return { ok: false, error: 'no-cjk-font（系统里找不到可内嵌的 CJK TrueType 单体字体；可设 WARMY_PDF_FONT 指定 .ttf）' };
  }
  let ttf: Buffer;
  try { ttf = fs.readFileSync(fontPath); } catch (e) {
    return { ok: false, error: 'font-read-failed: ' + String((e as Error)?.message || e) };
  }
  const zi = ziJiHua(ttf, allText);
  if (!zi) return { ok: false, error: 'font-unsupported（字体无法子集化；TTC 集合包不支持，请用 .ttf）' };

  const du: TtfDuLiang = zi.du;
  const upe = du.unitsPerEm || 1000;
  const kuai = 1000 / upe; // 字体单位 → PDF 文本空间
  const zhiKuan = (ch: string): number => {
    const cp = ch.codePointAt(0) ?? 0;
    const g = zi.cid.get(cp);
    const adv = g === undefined ? 0 : (zi.advance[g] ?? 0);
    return adv * kuai;
  };

  const { w: PW, h: PH } = opts.pageSize === 'Letter' ? LETTER : A4;
  const W = PW - YU * 2;
  const pages: string[] = [];      // 每页的内容流（未压缩）
  let cur: string[] = [];
  let y = PH - YU;
  const HANG = 1.45;

  const xinYe = () => { pages.push(cur.join('\n')); cur = []; y = PH - YU; };
  const xieDuan = (d: PdfDuanLuo) => {
    const size = Math.max(6, Number(d.size) || 12);
    const indent = Math.max(0, Number(d.indent) || 0);
    const lh = size * HANG;
    const di = d.spaceBefore ? Math.max(0, d.spaceBefore) : 0;
    y -= di;
    // 逐字折行（按真实 advance 宽度量，中英混排都准）
    const yuan = String(d?.text ?? '');
    const ziHang: string[] = [];
    for (const l of yuan.split(/\r?\n/)) {
      if (!l) { ziHang.push(''); continue; }
      let cur2 = '';
      let w = 0;
      for (const ch of l) {
        const cwPt = (zhiKuan(ch) * size) / 1000; // advance(字体单位) → pt
        if (w + cwPt > W - indent && cur2) { ziHang.push(cur2); cur2 = ''; w = 0; }
        cur2 += ch;
        w += cwPt;
      }
      ziHang.push(cur2);
    }
    for (const l of ziHang) {
      if (y - lh < YU) xinYe();
      y -= lh;
      const hex = [...l].map((ch) => {
        const g = zi.cid.get(ch.codePointAt(0) ?? 0);
        return (g === undefined ? 0 : g).toString(16).padStart(4, '0');
      }).join('');
      cur.push('BT');
      cur.push(`/F1 ${size} Tf`);
      if (d.bold) cur.push('0.6 w 2 Tr'); // 描边填充 = 伪粗
      cur.push(`1 0 0 1 ${(YU + indent).toFixed(2)} ${y.toFixed(2)} Tm`);
      cur.push(`<${hex.toUpperCase()}> Tj`);
      if (d.bold) cur.push('0 Tr');
      cur.push('ET');
    }
    y -= size * 0.35;
  };

  for (const d of duanLuo || []) xieDuan(d);
  if (!pages.length) xinYe();
  else if (cur.length) pages.push(cur.join('\n'));

  // 对象编号
  const OBJ = { catalog: 1, pages: 2, font: 3, cid: 4, desc: 5, tounicode: 6, fontfile: 7, info: 8 };
  const pageObjBase = 20;
  const contentObjBase = pageObjBase + pages.length;
  const objs: Array<{ id: number; body: string; stream?: Buffer; extraHeader?: string }> = [];

  const kids = pages.map((_, i) => `${pageObjBase + i} 0 R`).join(' ');
  objs.push({ id: OBJ.catalog, body: `<< /Type /Catalog /Pages ${OBJ.pages} 0 R >>` });
  objs.push({ id: OBJ.pages, body: `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>` });
  objs.push({ id: OBJ.font, body: `<< /Type /Font /Subtype /Type0 /BaseFont /WArmyEmbedded /Encoding /Identity-H /DescendantFonts [${OBJ.cid} 0 R] /ToUnicode ${OBJ.tounicode} 0 R >>` });

  // 宽度表：只列用到的 CID（按 cid 升序，分段连续压缩）
  const cidList = [...zi.cid.values()].sort((a, b) => a - b);
  const wSeg: string[] = [];
  {
    let i = 0;
    while (i < cidList.length) {
      let j = i;
      while (j + 1 < cidList.length && cidList[j + 1] === cidList[j]! + 1) j++;
      const widths = cidList.slice(i, j + 1).map((g) => Math.round((zi.advance[g] ?? 0) * kuai));
      wSeg.push(`[${cidList[i]} [${widths.join(' ')}]]`);
      i = j + 1;
    }
  }
  objs.push({ id: OBJ.cid, body: `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /WArmyEmbedded `
    + `/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> `
    + `/FontDescriptor ${OBJ.desc} 0 R /CIDToGIDMap /Identity /DW 1000 /W [${wSeg.join(' ')}] >>` });
  objs.push({ id: OBJ.desc, body: `<< /Type /FontDescriptor /FontName /WArmyEmbedded /Flags 4 `
    + `/FontBBox [${Math.round(du.xMin * kuai)} ${Math.round(du.yMin * kuai)} ${Math.round(du.xMax * kuai)} ${Math.round(du.yMax * kuai)}] `
    + `/ItalicAngle 0 /Ascent ${Math.round(du.ascender * kuai)} /Descent ${Math.round(du.descender * kuai)} `
    + `/CapHeight ${Math.round(du.ascender * kuai)} /StemV 80 /FontFile2 ${OBJ.fontfile} 0 R >>` });

  objs.push({ id: OBJ.tounicode, body: '', stream: Buffer.from(toUnicodeCmap(zi.cid), 'utf8') });
  objs.push({ id: OBJ.fontfile, body: '', stream: zi.font, extraHeader: `/Length1 ${zi.font.length} ` });

  objs.push({ id: OBJ.info, body: `<< /Producer (WArmy) /Creator (WArmy) `
    + (opts.title ? `/Title <${utf16beHex(opts.title)}> ` : '')
    + (opts.author ? `/Author <${utf16beHex(opts.author)}> ` : '')
    + `/CreationDate (D:${pdfShiJian(new Date())}) >>` });

  pages.forEach((content, i) => {
    const cBuf = zlib.deflateSync(Buffer.from(content, 'utf8'));
    objs.push({
      id: pageObjBase + i,
      body: `<< /Type /Page /Parent ${OBJ.pages} 0 R /MediaBox [0 0 ${PW.toFixed(2)} ${PH.toFixed(2)}] `
        + `/Resources << /Font << /F1 ${OBJ.font} 0 R >> /ProcSet [/PDF /Text] >> /Contents ${contentObjBase + i} 0 R >>`,
    });
    objs.push({ id: contentObjBase + i, body: '', stream: cBuf, extraHeader: '/Filter /FlateDecode ' });
  });

  return { ok: true, buffer: zuPdf(objs, OBJ.catalog, OBJ.info), fontPath, queShi: zi.queShi };
}

function pdfShiJian(d: Date): string {
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** ToUnicode：让内嵌子集里的中文能被复制/检索 */
function toUnicodeCmap(cid: Map<number, number>): string {
  const pairs = [...cid.entries()].map(([cp, g]) => [g, cp] as [number, number]);
  pairs.sort((a, b) => a[0] - b[0]);
  const head = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n'
    + '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n'
    + '/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n'
    + '1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n';
  const chunks: string[] = [];
  for (let i = 0; i < pairs.length; i += 100) {
    const part = pairs.slice(i, i + 100);
    chunks.push(`${part.length} beginbfchar\n` + part.map(([g, cp]) => {
      const uni = cp <= 0xffff
        ? cp.toString(16).padStart(4, '0')
        : utf16beHex(String.fromCodePoint(cp));
      return `<${g.toString(16).padStart(4, '0')}> <${uni.toUpperCase()}>`;
    }).join('\n') + '\nendbfchar');
  }
  const tail = 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n';
  return head + (chunks.length ? chunks.join('\n') + '\n' : '') + tail;
}

function zuPdf(objs: Array<{ id: number; body: string; stream?: Buffer; extraHeader?: string }>, root: number, info: number): Buffer {
  const maxId = objs.reduce((m, o) => Math.max(m, o.id), 0);
  const parts: Buffer[] = [];
  let pos = 0;
  const offsets = new Map<number, number>();
  const push = (b: Buffer) => { parts.push(b); pos += b.length; };
  push(Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1'));
  const sorted = [...objs].sort((a, b) => a.id - b.id);
  for (const o of sorted) {
    offsets.set(o.id, pos);
    if (o.stream) {
      const head = `${o.id} 0 obj\n<< /Length ${o.stream.length} ${o.extraHeader || ''}>>\nstream\n`;
      push(Buffer.from(head, 'latin1'));
      push(o.stream);
      push(Buffer.from('\nendstream\nendobj\n', 'latin1'));
    } else {
      push(Buffer.from(`${o.id} 0 obj\n${o.body}\nendobj\n`, 'latin1'));
    }
  }
  const xrefPos = pos;
  const lines: string[] = [`xref`, `0 ${maxId + 1}`, `0000000000 65535 f `];
  for (let i = 1; i <= maxId; i++) {
    const off = offsets.get(i);
    lines.push(off === undefined ? `0000000000 65535 f ` : `${String(off).padStart(10, '0')} 00000 n `);
  }
  const xref = lines.join('\n') + '\n';
  push(Buffer.from(xref, 'latin1'));
  push(Buffer.from(`trailer\n<< /Size ${maxId + 1} /Root ${root} 0 R /Info ${info} 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(parts);
}

/* ────────────────────────────── 读取 ────────────────────────────── */

export interface PdfChaiGuo {
  ok: boolean;
  text: string;
  /** 页数（能从 /Type /Page 数出来时给出） */
  pages?: number;
  error?: string;
  /** 扫不出文本时的提示（例如扫描件） */
  hint?: string;
}

/** 取对象流：返回 [{dict, data}]（已按 /Filter 解压） */
function quLiu(buf: Buffer): Array<{ dict: string; data: Buffer }> {
  const out: Array<{ dict: string; data: Buffer }> = [];
  const s = buf.toString('latin1');
  const re = /(\d+)\s+(\d+)\s+obj\b([\s\S]*?)endobj/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const body = m[3] || '';
    const si = body.indexOf('stream');
    if (si < 0) continue;
    const dict = body.slice(0, si);
    let p = si + 6;
    if (body[p] === '\r') p++;
    if (body[p] === '\n') p++;
    let end = body.indexOf('endstream', p);
    if (end < 0) end = body.length;
    const raw = Buffer.from(body.slice(p, end), 'latin1');
    // 显式标 Buffer：inflateSync 返回 Buffer<ArrayBufferLike>，与 Buffer.from 的 Buffer<ArrayBuffer> 在 @types/node 新版下不兼容（CI typecheck 红）
    let data: Buffer = raw;
    if (/\/FlateDecode/.test(dict)) {
      try { data = zlib.inflateSync(raw); } catch { try { data = zlib.inflateRawSync(raw); } catch { continue; } }
    }
    out.push({ dict, data });
  }
  return out;
}

/** 解析 ToUnicode CMap（bfchar + bfrange） */
function chaiToUnicode(txt: string, into: Map<number, string>): void {
  for (const blk of txt.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const p of (blk[1] || '').matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      into.set(parseInt(p[1]!, 16), hexToStr(p[2]!));
    }
  }
  for (const blk of txt.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const p of (blk[1] || '').matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const a = parseInt(p[1]!, 16), b = parseInt(p[2]!, 16);
      const base = hexToStr(p[3]!);
      for (let c = a; c <= b && c - a < 4096; c++) {
        const last = base.codePointAt(Math.max(0, base.length - 1)) ?? 0;
        into.set(c, base.slice(0, -1) + String.fromCodePoint(last + (c - a)));
      }
    }
  }
}

function hexToStr(h: string): string {
  const b = Buffer.from(h, 'hex');
  let s = '';
  for (let i = 0; i + 1 < b.length; i += 2) {
    const u = b.readUInt16BE(i);
    if (u !== 0) s += String.fromCharCode(u);
  }
  return s;
}

/** 从内容流里抽文本（Tj / TJ / ' / " 都认；按 TJ 的间隙补空格） */
function chaiNeiRong(txt: string, tounicode: Map<number, string>): string {
  const out: string[] = [];
  const re = /(\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]*>)\s*(Tj|TJ|'|")|(\[(?:[^\][]|\\.)*\])\s*TJ|(Td|TD|T\*|ET)/g;
  let m: RegExpExecArray | null;
  const decode = (tok: string): string => {
    if (tok.startsWith('<')) {
      const h = tok.slice(1, -1).replace(/\s+/g, '');
      if (!h) return '';
      // 两字节一个 code（Identity-H）
      if (h.length % 4 === 0 && tounicode.size) {
        let s = '';
        for (let i = 0; i < h.length; i += 4) {
          const code = parseInt(h.slice(i, i + 4), 16);
          s += tounicode.get(code) ?? '';
        }
        return s;
      }
      const b = Buffer.from(h.length % 2 ? h + '0' : h, 'hex');
      if (tounicode.size) {
        let s = '';
        for (const byte of b) s += tounicode.get(byte) ?? '';
        if (s) return s;
      }
      return b.toString('latin1');
    }
    // 字面量：解开转义
    const inner = tok.slice(1, -1);
    let s = '';
    for (let i = 0; i < inner.length; i++) {
      const c = inner[i]!;
      if (c !== '\\') { s += c; continue; }
      const n = inner[++i];
      if (n === undefined) break;
      if (n === 'n') s += '\n';
      else if (n === 'r') s += '\r';
      else if (n === 't') s += '\t';
      else if (n === 'b') s += '\b';
      else if (n === 'f') s += '\f';
      else if (n >= '0' && n <= '7') {
        let oct = n;
        while (oct.length < 3) {
          const nx = inner[i + 1];
          if (nx === undefined || nx < '0' || nx > '7') break;
          oct += inner[++i];
        }
        s += String.fromCharCode(parseInt(oct, 8));
      } else s += n;
    }
    return s;
  };
  while ((m = re.exec(txt))) {
    if (m[3] !== undefined) {
      // TJ 数组：逐段解码，间隙过大补空格
      const arr = m[3];
      let s = '';
      for (const t of arr.matchAll(/(\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]*>)|(-?\d+(?:\.\d+)?)/g)) {
        if (t[1]) s += decode(t[1]);
        else {
          const gap = parseFloat(t[2]!);
          if (Number.isFinite(gap) && gap < -180) s += ' ';
        }
      }
      out.push(s);
      continue;
    }
    if (m[1]) out.push(decode(m[1]));
    else if (m[4]) { if (out.length && !/\s$/.test(out[out.length - 1]!)) out.push('\n'); }
  }
  return out.join('');
}

/** 读 PDF 正文（best-effort；抽不到就如实说"抽不到"） */
export function duPdfBuf(buf: Buffer): PdfChaiGuo {
  try {
    const head = buf.subarray(0, 1024).toString('latin1');
    if (!/^%PDF-/.test(head)) return { ok: false, text: '', error: 'not-a-pdf' };
    const liu = quLiu(buf);
    const tounicode = new Map<number, string>();
    for (const l of liu) {
      const t = l.data.toString('latin1');
      if (/beginbfchar|beginbfrange/.test(t)) chaiToUnicode(t, tounicode);
    }
    const buFen: string[] = [];
    for (const l of liu) {
      const t = l.data.toString('latin1');
      if (/beginbfchar|beginbfrange/.test(t)) continue;      // ToUnicode 本身不是正文
      if (!/T[jJ]|Td|TD|Tm/.test(t)) continue;               // 不是文本内容流
      const s = chaiNeiRong(t, tounicode);
      if (s.trim()) buFen.push(s);
    }
    const text = buFen.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    const pageCount = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    if (!text) {
      return {
        ok: false, text: '', pages: pageCount || undefined,
        error: 'pdf-text-none',
        hint: '这份 PDF 里抽不到文本层（多半是扫描件/纯图片页）。要读内容需要 OCR（视觉模型逐页看图），不要在正文里编造内容。',
      };
    }
    return { ok: true, text, pages: pageCount || undefined };
  } catch (e) {
    return { ok: false, text: '', error: String((e as Error)?.message || e) };
  }
}

export function duPdf(p: string): PdfChaiGuo {
  try {
    return duPdfBuf(fs.readFileSync(p));
  } catch (e) {
    return { ok: false, text: '', error: String((e as Error)?.message || e) };
  }
}
