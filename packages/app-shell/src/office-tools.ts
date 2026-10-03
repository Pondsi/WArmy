/**
 * office-tools —— 让牛马能产出**真正的** .docx / .pptx（可被 Word / PowerPoint 打开）。
 *
 * 为什么必须有这个模块
 * ---------------------------------------------------------------------------
 * 真事故：用户让 AI「生成一个 ppt 和 word」，工具箱里只有纯文本 write_file ⇒
 * 它把「这是测试」写进 'xx.pptx'，得到的是**改了后缀的文本文件**，PowerPoint 打不开；
 * 甚至干脆谎称完成（界面上既没内容也没文件）。
 *
 * 做法（零第三方依赖，纯 Node）：
 *  · .docx —— 按 OOXML 最小结构现拼（[Content_Types] + _rels + word/document.xml），用 deflateRaw 打包 zip。
 *  · .pptx —— 用随包的**真模板**（由 python-pptx 生成，见 assets/tpl.pptx），运行时只替换文字并按需克隆幻灯片。
 *    用模板而不是现拼，是因为 PowerPoint 对 pptx 结构很挑剔，模板保证能打开。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/* ────────────────────────────── zip 读写 ────────────────────────────── */

export interface ZipTiaoMu { name: string; data: Buffer }

const CRC_BIAO = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    const b = buf.readUInt8(i);
    c = CRC_BIAO[(c ^ b) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** 写一个 zip（全 deflate，够 Word/PowerPoint 认） */
export function xieZip(items: ZipTiaoMu[]): Buffer {
  const ju: Buffer[] = [];
  const zhong: Buffer[] = [];
  let pianYi = 0;
  for (const it of items) {
    const ming = Buffer.from(it.name.split(path.sep).join('/'), 'utf8');
    const yuan = it.data;
    const ya = zlib.deflateRawSync(yuan, { level: 6 });
    const crc = crc32(yuan);
    const t1 = Buffer.alloc(30);
    t1.writeUInt32LE(0x04034b50, 0);
    t1.writeUInt16LE(20, 4);          // version needed
    t1.writeUInt16LE(0x0800, 6);      // flags: UTF-8
    t1.writeUInt16LE(8, 8);           // method: deflate
    t1.writeUInt16LE(0, 10);          // time
    t1.writeUInt16LE(0x21, 12);       // date (1980-01-01)
    t1.writeUInt32LE(crc, 14);
    t1.writeUInt32LE(ya.length, 18);
    t1.writeUInt32LE(yuan.length, 22);
    t1.writeUInt16LE(ming.length, 26);
    t1.writeUInt16LE(0, 28);
    ju.push(t1, ming, ya);

    const t2 = Buffer.alloc(46);
    t2.writeUInt32LE(0x02014b50, 0);
    t2.writeUInt16LE(20, 4);
    t2.writeUInt16LE(20, 6);
    t2.writeUInt16LE(0x0800, 8);
    t2.writeUInt16LE(8, 10);
    t2.writeUInt16LE(0, 12);
    t2.writeUInt16LE(0x21, 14);
    t2.writeUInt32LE(crc, 16);
    t2.writeUInt32LE(ya.length, 20);
    t2.writeUInt32LE(yuan.length, 24);
    t2.writeUInt16LE(ming.length, 28);
    t2.writeUInt16LE(0, 30);
    t2.writeUInt16LE(0, 32);
    t2.writeUInt16LE(0, 34);
    t2.writeUInt16LE(0, 36);
    t2.writeUInt32LE(0, 38);
    t2.writeUInt32LE(pianYi, 42);
    zhong.push(t2, ming);
    pianYi += t1.length + ming.length + ya.length;
  }
  const zhongBuf = Buffer.concat(zhong);
  const wei = Buffer.alloc(22);
  wei.writeUInt32LE(0x06054b50, 0);
  wei.writeUInt16LE(0, 4);
  wei.writeUInt16LE(0, 6);
  wei.writeUInt16LE(items.length, 8);
  wei.writeUInt16LE(items.length, 10);
  wei.writeUInt32LE(zhongBuf.length, 12);
  wei.writeUInt32LE(pianYi, 16);
  wei.writeUInt16LE(0, 20);
  return Buffer.concat([...ju, zhongBuf, wei]);
}

/** 解 zip（只认标准 local header；store/deflate 都支持） */
export function duZip(buf: Buffer): ZipTiaoMu[] {
  const out: ZipTiaoMu[] = [];
  let off = 0;
  while (off + 30 <= buf.length) {
    const sig = buf.readUInt32LE(off);
    if (sig !== 0x04034b50) break;
    const fangShi = buf.readUInt16LE(off + 8);
    const compSize = buf.readUInt32LE(off + 18);
    const rawSize = buf.readUInt32LE(off + 22);
    const nameLen = buf.readUInt16LE(off + 26);
    const extraLen = buf.readUInt16LE(off + 28);
    const ming = buf.subarray(off + 30, off + 30 + nameLen).toString('utf8');
    const shuStart = off + 30 + nameLen + extraLen;
    const shu = buf.subarray(shuStart, shuStart + compSize);
    let yuan: Buffer;
    if (fangShi === 0) yuan = Buffer.from(shu);
    else if (fangShi === 8) yuan = zlib.inflateRawSync(shu);
    else throw new Error('zip-method-unsupported:' + fangShi);
    if (rawSize && yuan.length !== rawSize) { /* 容错：以实际解压为准 */ }
    out.push({ name: ming, data: yuan });
    off = shuStart + compSize;
  }
  return out;
}

/** XML 文本转义 */
function tao(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/* ────────────────────────────── .docx ────────────────────────────── */

/** 生成真 .docx：每段一个 <w:p> */
export function shengChengDocx(duanJi: string[]): Buffer {
  const duan = (duanJi && duanJi.length ? duanJi : ['']).map((s) =>
    `<w:p><w:r><w:t xml:space="preserve">${tao(s)}</w:t></w:r></w:p>`).join('');
  const doc =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${duan}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>` +
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>' +
    '</w:sectPr></w:body></w:document>';
  const ct =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '</Types>';
  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>';
  return xieZip([
    { name: '[Content_Types].xml', data: Buffer.from(ct, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rels, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(doc, 'utf8') },
  ]);
}

/* ────────────────────────────── .pptx ────────────────────────────── */

export interface HuanDengPian { title?: string; body?: string[] }

/**
 * 用真模板生成 .pptx：替换 {{TITLE}}/{{BODY}}，需要几张就克隆几张。
 * @param muBanLu 模板文件路径（assets/tpl.pptx）
 */
export function shengChengPptx(muBanLu: string, pianJi: HuanDengPian[]): Buffer {
  const muBan = duZip(fs.readFileSync(muBanLu));
  const byName = new Map(muBan.map((z) => [z.name, z.data]));
  const slide1 = byName.get('ppt/slides/slide1.xml');
  const slide1Rels = byName.get('ppt/slides/_rels/slide1.xml.rels');
  const pres = byName.get('ppt/presentation.xml');
  const presRels = byName.get('ppt/_rels/presentation.xml.rels');
  const ct = byName.get('[Content_Types].xml');
  if (!slide1 || !slide1Rels || !pres || !presRels || !ct) throw new Error('pptx-template-broken');

  const n = Math.max(1, Math.min(100, pianJi.length || 1));
  const zhengWen = (lines: string[]) => {
    const duan = (lines && lines.length ? lines : ['']).map((s) =>
      `<a:p><a:r><a:t>${tao(s)}</a:t></a:r></a:p>`).join('');
    return duan;
  };
  const gai = (xml: Buffer, p: HuanDengPian): Buffer => {
    let s = xml.toString('utf8');
    s = s.replace(/<a:t>\{\{TITLE\}\}<\/a:t>/g, `<a:t>${tao(p.title || '')}</a:t>`);
    // 正文占位：整段替换成多段 <a:p>
    s = s.replace(/<a:p><a:r><a:t>\{\{BODY\}\}<\/a:t><\/a:r><\/a:p>/g, zhengWen(p.body || []));
    return Buffer.from(s, 'utf8');
  };

  const out: ZipTiaoMu[] = [];
  for (const z of muBan) {
    if (z.name === 'ppt/slides/slide1.xml') { out.push({ name: z.name, data: gai(z.data, pianJi[0] || {}) }); continue; }
    if (z.name === 'ppt/presentation.xml') {
      // 追加 slideN 的 sldId
      let s = z.data.toString('utf8');
      const tiao = Array.from({ length: n }, (_, i) => `<p:sldId id="${256 + i}" r:id="rIdS${i + 1}"/>`).join('');
      s = s.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, `<p:sldIdLst>${tiao}</p:sldIdLst>`);
      out.push({ name: z.name, data: Buffer.from(s, 'utf8') });
      continue;
    }
    if (z.name === 'ppt/_rels/presentation.xml.rels') {
      let s = z.data.toString('utf8');
      const add = Array.from({ length: n }, (_, i) =>
        `<Relationship Id="rIdS${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join('');
      s = s.replace('</Relationships>', add + '</Relationships>');
      out.push({ name: z.name, data: Buffer.from(s, 'utf8') });
      continue;
    }
    if (z.name === '[Content_Types].xml') {
      let s = z.data.toString('utf8');
      // 补齐 slideN 的 Override（slide1 模板里已有，避免重复）
      const yiYou = new Set(Array.from(s.matchAll(/PartName="([^"]+)"/g)).map((m) => m[1]));
      let add = '';
      for (let i = 1; i <= n; i++) {
        const p = `/ppt/slides/slide${i}.xml`;
        if (!yiYou.has(p)) add += `<Override PartName="${p}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`;
      }
      s = s.replace('</Types>', add + '</Types>');
      out.push({ name: z.name, data: Buffer.from(s, 'utf8') });
      continue;
    }
    if (/^ppt\/slides\/_rels\//.test(z.name)) {
      // slide1 的 rels 保留；其余 slideN 的 rels 在下面统一补
      out.push(z);
      continue;
    }
    out.push(z);
  }
  // 克隆 slideN.xml / slideN.xml.rels（N>1）
  for (let i = 2; i <= n; i++) {
    out.push({ name: `ppt/slides/slide${i}.xml`, data: gai(slide1, pianJi[i - 1] || {}) });
    out.push({ name: `ppt/slides/_rels/slide${i}.xml.rels`, data: Buffer.from(slide1Rels) });
  }
  return xieZip(out);
}

/** 生成器可用性（缺模板就如实告诉模型，别装作能出） */
export function keYongPptx(muBanLu: string): boolean {
  try { return fs.existsSync(muBanLu) && duZip(fs.readFileSync(muBanLu)).some((z) => z.name === 'ppt/slides/slide1.xml'); }
  catch { return false; }
}
