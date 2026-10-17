/**
 * doc-extract —— **文档抽取的统一入口**。
 *
 * 为什么必须"统一"
 * ---------------------------------------------------------------------------
 * 真事故：模型拿到一个 .pdf，不知道该用哪个工具，就去 `read_file` 硬读二进制，
 * 拿回一堆乱码还给用户"总结"；或者明明有 xlsx 却问用户"能不能转成 csv"。
 * 工具面越碎，模型越容易挑错。所以这里收成**一个** `read_document`：
 *   · 按**后缀 + 魔数**认格式（后缀骗人时不认后缀）；
 *   · 交给对应解析器（docx/xlsx/pptx/pdf）；
 *   · 认不出、或格式对但抽不到内容（扫描件）时**如实说**，绝不返回幻觉正文。
 *
 * 纯函数、纯 Node —— 与 work-tools 同一条纪律，门禁可无头断言。
 */
import fs from 'node:fs';
import path from 'node:path';
import { duDocx, duPptx } from './agent-tools.js';
import { duXlsx } from './office-tools.js';
import { duPdf } from './pdf-tools.js';

export type WenDangGeShi = 'docx' | 'xlsx' | 'pptx' | 'pdf' | 'text' | 'unknown';

export interface WenDangJieGuo {
  ok: boolean;
  format: WenDangGeShi;
  /** 抽取出的正文（文本格式即原文） */
  text: string;
  /** 表格文档：每个工作表 */
  sheets?: Array<{ name: string; rows: string[][] }>;
  /** 演示文档：每页文本 */
  slides?: string[];
  /** 页数（PDF 能数出来时） */
  pages?: number;
  bytes: number;
  error?: string;
  /** 失败时给模型的可操作提示（别让它换个工具乱试） */
  hint?: string;
}

/** 认格式：**魔数优先**（后缀可以骗人），再退回后缀 */
export function renWenDangGeShi(p: string, buf?: Buffer): WenDangGeShi {
  const ext = path.extname(String(p || '')).toLowerCase().replace(/^\./, '');
  const head = buf && buf.length >= 8 ? buf.subarray(0, 8) : null;
  // zip 容器：docx/xlsx/pptx 都是 zip，靠 [Content_Types].xml 里的部件名区分
  if (head && head.readUInt32LE(0) === 0x04034b50) {
    if (buf) {
      const s = buf.toString('latin1');
      if (/word\/document\.xml/.test(s)) return 'docx';
      if (/xl\/workbook\.xml/.test(s)) return 'xlsx';
      if (/ppt\/presentation\.xml/.test(s)) return 'pptx';
    }
    if (ext === 'docx' || ext === 'xlsx' || ext === 'pptx') return ext;
    return 'unknown';
  }
  if (head && head.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (ext === 'txt' || ext === 'md' || ext === 'csv' || ext === 'tsv' || ext === 'json' || ext === 'log') return 'text';
  if (ext === 'docx' || ext === 'xlsx' || ext === 'pptx' || ext === 'pdf') return ext;
  return 'unknown';
}

/**
 * 抽一份文档的正文。
 * @param p 文件路径
 * @param opts.maxChars 文本类返回上限（默认 20000）
 */
export function tiQuWenDang(p: string, opts: { maxChars?: number } = {}): WenDangJieGuo {
  const cap = Math.max(200, Math.min(Number(opts.maxChars) || 20000, 200000));
  let buf: Buffer;
  try {
    if (!fs.existsSync(p)) return { ok: false, format: 'unknown', text: '', bytes: 0, error: 'not-found' };
    if (fs.statSync(p).isDirectory()) {
      return { ok: false, format: 'unknown', text: '', bytes: 0, error: 'is-a-directory', hint: '这是目录，用 list_dir 看里面有什么。' };
    }
    buf = fs.readFileSync(p);
  } catch (e) {
    return { ok: false, format: 'unknown', text: '', bytes: 0, error: String((e as Error)?.message || e) };
  }
  const bytes = buf.length;
  const fmt = renWenDangGeShi(p, buf);

  if (fmt === 'text') {
    const text = buf.toString('utf8');
    const cut = text.length > cap;
    return { ok: true, format: 'text', text: cut ? text.slice(0, cap) : text, bytes, ...(cut ? { hint: `原文 ${text.length} 字符，已截断到 ${cap}。` } : {}) };
  }
  if (fmt === 'docx') {
    const r = duDocx(p);
    if (!r.ok) return { ok: false, format: 'docx', text: '', bytes, error: r.error || 'docx-parse-failed' };
    const cut = r.text.length > cap;
    return { ok: true, format: 'docx', text: cut ? r.text.slice(0, cap) : r.text, bytes, ...(cut ? { hint: `正文 ${r.text.length} 字符，已截断。` } : {}) };
  }
  if (fmt === 'pptx') {
    const r = duPptx(p);
    if (!r.ok) return { ok: false, format: 'pptx', text: '', bytes, error: r.error || 'pptx-parse-failed' };
    const ping = r.slides.map((s, i) => `--- 第 ${i + 1} 页 ---\n${s}`);
    const text = ping.join('\n');
    const cut = text.length > cap;
    return { ok: true, format: 'pptx', text: cut ? text.slice(0, cap) : text, slides: r.slides, bytes, ...(cut ? { hint: `共 ${r.slides.length} 页，已截断。` } : {}) };
  }
  if (fmt === 'xlsx') {
    const r = duXlsx(p);
    if (!r.ok) return { ok: false, format: 'xlsx', text: '', bytes, error: r.error || 'xlsx-parse-failed' };
    const text = r.sheets.map((s) =>
      `--- 工作表 ${s.name}（${s.rows.length} 行）---\n` + s.rows.map((h) => h.join('\t')).join('\n')).join('\n\n');
    const cut = text.length > cap;
    return { ok: true, format: 'xlsx', text: cut ? text.slice(0, cap) : text, sheets: r.sheets, bytes, ...(cut ? { hint: '表格较大，已截断；需要特定区域请说清范围。' } : {}) };
  }
  if (fmt === 'pdf') {
    const r = duPdf(p);
    if (!r.ok) {
      return {
        ok: false, format: 'pdf', text: '', bytes, pages: r.pages,
        error: r.error || 'pdf-parse-failed',
        hint: r.hint || '这份 PDF 抽不出文本层。请不要编造内容：要么让用户导出文本，要么用能看图的视觉模型逐页读。',
      };
    }
    const cut = r.text.length > cap;
    return { ok: true, format: 'pdf', text: cut ? r.text.slice(0, cap) : r.text, bytes, pages: r.pages, ...(cut ? { hint: 'PDF 正文较长，已截断。' } : {}) };
  }
  if (/\.(png|jpe?g|gif|webp|bmp|svg|ico|avif)$/i.test(p)) {
    return {
      ok: false, format: 'unknown', text: '', bytes,
      error: 'is-an-image',
      hint: '这是图片，不是文档。聊天里附上的图片已经交给看图模型看过，描述就在上下文里，直接用那份描述回答；不要再反复读取这张图。',
    };
  }
  return {
    ok: false, format: 'unknown', text: '', bytes,
    error: 'unknown-format',
    hint: '认不出这是什么文档（后缀与文件头都不像 docx/xlsx/pptx/pdf）。用 read_file 看文本，或 list_dir 确认是哪个文件。',
  };
}
