#!/usr/bin/env node
/**
 * verify-office-ooxml —— 真·Office 文件门禁。
 * 真事故：write_file 写 .pptx 得到改后缀的文本文件，PowerPoint 打不开；
 * AI 还谎称「生成成功」。这里断言：生成器产出的是**合法 OOXML 包**，
 * 且 write_file 拒写 Office 二进制格式。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(here, '..');
const dist = path.join(pkgRoot, 'dist', 'work-tools.js');
if (!fs.existsSync(dist)) { console.error('缺构建产物，请先 build：' + dist); process.exit(2); }
const W = await import(pathToFileURL(dist).href);

let pass = 0, fail = 0;
const failures = [];
const check = (biaoQian, ok, detail) => {
  if (ok) { pass++; console.log('  PASS', biaoQian, detail ? '=> ' + JSON.stringify(detail).slice(0, 160) : ''); }
  else { fail++; failures.push(biaoQian); console.log('  FAIL', biaoQian, detail ? '=> ' + JSON.stringify(detail).slice(0, 200) : ''); }
};

const base = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'warmy-office-'));
console.log('临时工作区:', base);

/** 读 zip 中心目录里的条目名（不依赖解压实现） */
function zipNames(buf) {
  const names = [];
  let off = 0;
  while (off + 30 <= buf.length) {
    if (buf.readUInt32LE(off) !== 0x04034b50) break;
    const csize = buf.readUInt32LE(off + 18);
    const nlen = buf.readUInt16LE(off + 26);
    const elen = buf.readUInt16LE(off + 28);
    names.push(buf.subarray(off + 30, off + 30 + nlen).toString('utf8'));
    off += 30 + nlen + elen + csize;
  }
  return names;
}
function zipEntry(buf, want) {
  let off = 0;
  while (off + 30 <= buf.length) {
    if (buf.readUInt32LE(off) !== 0x04034b50) break;
    const method = buf.readUInt16LE(off + 8);
    const csize = buf.readUInt32LE(off + 18);
    const nlen = buf.readUInt16LE(off + 26);
    const elen = buf.readUInt16LE(off + 28);
    const name = buf.subarray(off + 30, off + 30 + nlen).toString('utf8');
    const start = off + 30 + nlen + elen;
    if (name === want) {
      const raw = buf.subarray(start, start + csize);
      return method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw);
    }
    off = start + csize;
  }
  return null;
}

console.log('\n[1] write_file 拒写 Office 二进制（杜绝假文件）');
{
  for (const ext of ['docx', 'pptx', 'xlsx']) {
    const r = W.runWorkTool(base, { function: { name: 'write_file', arguments: { path: 'x.' + ext, content: '这是测试' } } });
    check(`write_file 写 .${ext} 被拒`, r.ok === false && /make_docx|make_pptx|office-binary/.test(r.content + (r.meta.error || '')), r.meta.error);
  }
  check('假文件没有落盘', !fs.existsSync(path.join(base, 'x.pptx')) && !fs.existsSync(path.join(base, 'x.docx')));
}

console.log('\n[2] make_docx 产出合法 OOXML 包');
{
  const r = W.runWorkTool(base, { function: { name: 'make_docx', arguments: { path: 'out/a.docx', paragraphs: ['我是谁', '你是谁'] } } }, false, pkgRoot);
  check('make_docx 成功', r.ok === true, r.content);
  const buf = fs.readFileSync(path.join(base, 'out', 'a.docx'));
  check('是 zip（PK 头）', buf.subarray(0, 2).toString() === 'PK');
  const names = zipNames(buf);
  check('含 word/document.xml', names.includes('word/document.xml'), names);
  check('含 [Content_Types].xml', names.includes('[Content_Types].xml'));
  check('含 _rels/.rels', names.includes('_rels/.rels'));
  const doc = zipEntry(buf, 'word/document.xml');
  const xml = doc ? doc.toString('utf8') : '';
  check('document.xml 含两段文字', xml.includes('我是谁') && xml.includes('你是谁'), xml.slice(0, 120));
  check('document.xml 是合法 XML 根', xml.includes('<w:document') && xml.includes('</w:document>'));
}

console.log('\n[3] make_pptx 产出合法 OOXML 包（真模板填字）');
{
  const r = W.runWorkTool(base, { function: { name: 'make_pptx', arguments: { path: 'out/b.pptx', slides: [{ title: '第一页', body: ['这是测试'] }, { title: '第二页', body: ['A'] }] } } }, false, pkgRoot);
  check('make_pptx 成功', r.ok === true, r.content);
  const buf = fs.readFileSync(path.join(base, 'out', 'b.pptx'));
  check('是 zip（PK 头）', buf.subarray(0, 2).toString() === 'PK');
  const names = zipNames(buf);
  check('含 presentation.xml', names.includes('ppt/presentation.xml'), names.slice(0, 12));
  check('含 slide1 与 slide2', names.includes('ppt/slides/slide1.xml') && names.includes('ppt/slides/slide2.xml'), names.filter((n) => /slides\/slide\d/.test(n)));
  check('含幻灯片母版与版式', names.some((n) => /slideMaster/.test(n)) && names.some((n) => /slideLayout/.test(n)));
  const s1 = zipEntry(buf, 'ppt/slides/slide1.xml');
  const x1 = s1 ? s1.toString('utf8') : '';
  check('slide1 含标题与正文', x1.includes('第一页') && x1.includes('这是测试'), x1.slice(0, 120));
  const pres = zipEntry(buf, 'ppt/presentation.xml');
  const xp = pres ? pres.toString('utf8') : '';
  check('presentation 登记了 2 张幻灯片', (xp.match(/<p:sldId /g) || []).length === 2, (xp.match(/<p:sldId [^>]*>/g) || []));
}

console.log('\n[4] 缺模板时如实失败（不假装成功）');
{
  const r = W.runWorkTool(base, { function: { name: 'make_pptx', arguments: { path: 'out/c.pptx', slides: [{ title: 'a' }] } } }, false, path.join(pkgRoot, 'no-such'));
  check('失败且带 template-missing', r.ok === false && /template-missing/.test(r.meta.error || ''), r.meta.error);
  check('没有产出假文件', !fs.existsSync(path.join(base, 'out', 'c.pptx')));
}

try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* noop */ }
console.log(`\n==== verify-office-ooxml: ${pass} ok / ${fail} FAIL ====`);
if (fail) console.log('失败项：\n - ' + failures.join('\n - '));
process.exit(fail ? 1 : 0);
