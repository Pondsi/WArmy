/**
 * R257：迪文子进程 worker。
 * 零原生模块约定：npm diwen 的可选增强 @node-rs/jieba 是 .node，主/渲染进程绝不加载；
 * 仿 memory-os 先例把迪文整体放进独立 Node 子进程，主进程经 JSON-line RPC 使用。
 * 私有迪文文件由主进程经 DIWEN_PRIVATE_LEXICON 注入；本进程负责校验/合并/挖掘，主进程负责落盘。
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { diwenBaoHouXuan } from './diwen-bridge.js';
const req = createRequire(import.meta.url);
const gengXinDir = String(process.env.WARMY_DIWEN_DIR || '');
let suiBaoDir = '';
try { suiBaoDir = path.dirname(req.resolve('diwen/package.json')); } catch { /* 无随包版时尝试更新目录 */ }
const baoHouXuan = diwenBaoHouXuan([suiBaoDir, gengXinDir]);
let baoDangQian = baoHouXuan[0] || null;
/** 显示实际加载的包版本；DIWEN_VERSION 单独作为格式版本。 */
function baoBanBen() { return baoDangQian?.version || null; }

let dw = null;
/** R259 报障26：原生增强（jieba）要有，且私有词需被分词器认识。
 *  迪文分词层经 createRequire 共享同一 CJS 缓存 ⇒ 在 worker（子进程，native 合规）
 *  补丁 Jieba.withDict：实例创建时自动 addWord 私有词表；refresh 增量补词。
 *  必须在 import diwen 之前补丁；jieba 不可用 → jiebaReady=false → segmentZh:false 回退。 */
const siYouCiBiao = new Set();
try {
  const p0 = String(process.env.DIWEN_PRIVATE_LEXICON || '');
  if (p0 && fs.existsSync(p0)) {
    const a = JSON.parse(fs.readFileSync(p0, 'utf8'));
    if (Array.isArray(a)) for (const r of a) { const w = String(r?.lemma_zh || ''); if (w) siYouCiBiao.add(w); }
  }
} catch { /* 私有表坏 → 空表起步 */ }
const jiebaInstances = new Set();
let jiebaReady = false;
try {
  const reqD = createRequire(path.join(baoDangQian?.dir || suiBaoDir, 'package.json'));
  const jm = reqD('@node-rs/jieba');
  const OrigJieba = jm.Jieba;
  /** native 类静态方法在 strict 下不可写 ⇒ 替换 exports.Jieba 为子类（迪文分词层解构同一 CJS 缓存）。 */
  class WarmyJieba extends OrigJieba {
    static withDict(dict) {
      const inst = super.withDict(dict);
      jiebaInstances.add(inst);
      if (siYouCiBiao.size) { try { inst.loadDict(Buffer.from([...siYouCiBiao].map((w) => w + ' 1000000 n').join('\n') + '\n', 'utf8')); } catch { /* 词形不合 jieba 规矩就跳过 */ } }
      return inst;
    }
  }
  jm.Jieba = WarmyJieba;
  jiebaReady = true;
} catch { jiebaReady = false; }
function buJiebaCi(words) {
  const xin = [];
  for (const w of words) {
    if (!w || siYouCiBiao.has(w)) continue;
    siYouCiBiao.add(w);
    xin.push(w);
  }
  if (!xin.length) return;
  const buf = Buffer.from(xin.map((w) => w + ' 1000000 n').join('\n') + '\n', 'utf8');
  for (const inst of jiebaInstances) { try { inst.loadDict(buf); } catch { /* skip */ } }
}
/* 按 package.main 加载最高的完整版本；支持 npm index.mjs 与历史 src/index.js 布局。 */
for (const bao of baoHouXuan) {
  try {
    dw = await import(pathToFileURL(bao.entry).href);
    baoDangQian = bao;
    break;
  } catch { dw = null; }
}
if (!dw) baoDangQian = null;

const siYouPath = () => String(process.env.DIWEN_PRIVATE_LEXICON || '');
const siYouBaoDir = () => String(process.env.DIWEN_PRIVATE_DIR || '');
/** R263：pinyin-pro（纯 JS，子进程合规）——私有概念 pinyin 逐字带调（最新规范必需） */
let pinYinFn = null;
try { pinYinFn = req('pinyin-pro').pinyin; } catch { pinYinFn = null; }
const pinYinOf = (w) => {
  if (!pinYinFn) return [];
  try { return pinYinFn(String(w || ''), { toneType: 'symbol', type: 'array' }); } catch { return []; }
};
/** worker 自持词典引用：npm loadLexicon(noCache) 不回写模块缓存，刷新后必须换引用。 */
let lexHuan = null;
const lex = () => { if (!lexHuan) lexHuan = dw.loadLexicon(); return lexHuan; };
let indexLex = null, indexHuan = null;
const ciGenIndex = () => { const l = lex(); if (indexLex !== l) { indexLex = l; indexHuan = dw.rootIndex(l); } return indexHuan; };
/** 映射契约：确定性词典最长匹配（segmentZh:false）——保证私有词根必中（bundle 经 ESM 引 jieba，CJS 补丁触及不到其分词）。
 *  jieba 原生增强仍加载（jiebaReady 状态供设置页展示/后续 NL 质量增强）。 */
const yingShe = (text) => {
  const source = String(text || '');
  const m = dw.mapText(source, lex(), { segmentZh: false, warnDegraded: false });
  const contract = dw.wrapAsFillContract(m, source);
  const doc = dw.fillContractToDoc(contract, source);
  /* 实际 npm mapText.roots 是概念 ID；用 schema 的合法 ref 保留私有空坐标身份。 */
  if (Array.isArray(m.roots) && m.roots.length === doc.words.length) {
    doc.words = doc.words.map((w, i) => {
      const id = Number(m.roots[i]);
      return Number.isSafeInteger(id) && ciGenIndex().byId.has(id)
        ? { ...w, ref: { scheme: 'diwen', id: String(id), type: 'Any' } } : w;
    });
  }
  return { ...m, doc, semanticApproval: false };
};
function duSiYou() {
  const p = siYouPath();
  if (!p || !fs.existsSync(p)) return [];
  try { const a = JSON.parse(fs.readFileSync(p, 'utf8')); return Array.isArray(a) ? a : []; } catch { return []; }
}
function jiChu() { return lex().roots.filter((r) => !r.private); }
const HAN = (ch) => { const c = ch.codePointAt(0) || 0; return c >= 0x4e00 && c <= 0x9fff; };
/** R280：BFO 类型→中文标签（确定唯一自然语渲染用，固定映射不随模型变） */
const BFO_ZH = { Object: '实体', Process: '过程', Quality: '性质', Role: '角色', Function: '功能', Site: '场所', MaterialEntity: '物质实体' };
/**
 * R280：迪文→**确定唯一自然语**（供大语言模型作输入）：无需优美但必须准确无误。
 * 确定性：同 doc 必同串（固定模板＋保序＋不采样）；未映射片段逐字保留（不丢信息）。
 */
function renderDiwen(doc) {
  if (!doc || typeof doc !== 'object') return '';
  const parts = [];
  const words = Array.isArray(doc.words) ? doc.words : [];
  for (const w of words) {
    if (!w || typeof w !== 'object') continue;
    if (!w.surface && !w.lemma_zh && !w.lemma) {
      const index = ciGenIndex();
      const id = w.ref?.scheme === 'diwen' ? Number(w.ref.id) : NaN;
      const root = Number.isSafeInteger(id) ? index.byId.get(id) : index.byCoord.get(`${w.s3a},${w.s3b}`);
      if (root) {
        const rendered = dw.renderConcept(root.id, { mode: 'canonical', lex: lex() });
        const definition = String(root.definitionZh || rendered.definition || '');
        if (definition) { parts.push(`「${root.lemma_zh}」：${definition}`); continue; }
        if (rendered.ok && rendered.text) { parts.push(rendered.text); continue; }
      }
      /* 没有可验证身份时保留原文，不输出空概念或猜近邻词义。 */
      if (doc.reasoning) return String(doc.reasoning);
      continue;
    }
    const surface = String(w.surface || w.lemma_zh || '');
    const lemma = String(w.lemma_zh || w.lemma || surface);
    const bfo = BFO_ZH[String(w.bfo_type || w.bfo || '')] || String(w.bfo_type || w.bfo || '');
    const def = String(w.definitionZh || w.definition || '');
    const place = Array.isArray(w.place) ? w.place.map((p) => `${String((p || {}).role || '')}:${String((p || {}).type || '')}`).join(',') : '';
    const nsm = Array.isArray(w.nsm) ? w.nsm.map(String).join('/') : '';
    let s = `「${surface}」=概念「${lemma}」`;
    if (bfo) s += `（类型:${bfo}）`;
    if (def) s += `：${def}`;
    if (place) s += `［位置:${place}］`;
    if (nsm) s += `［义原:${nsm}］`;
    parts.push(s);
  }
  const unc = Array.isArray(doc.uncovered) ? doc.uncovered.map((u) => String((u || {}).surface || u || '')).filter(Boolean) : [];
  if (unc.length) parts.push('未映射原文片段（逐字保留）：' + unc.join('、'));
  return parts.join('；');
}
const ciGanJing = (w) => w && !w.includes('_') && !['__proto__', 'constructor', 'prototype'].includes(w) && [...w].length <= 24;

/** 构造一条私有词根（R263 最新规范：id∈[699051,1048576)、无字形坐标 s3a/s3b=null、pinyin 逐字带调、definitionZh 必需）。 */
function gouZaoSiYou(word, meaning, bfoType, source) {
  if (!dw) return { ok: false, errors: ['迪文不可用'] };
  const base = jiChu();
  const cur = duSiYou();
  if (cur.length >= (dw.MAX_CUSTOM_ROOTS || 145)) return { ok: false, errors: ['私有迪文已达上限'] };
  if (!ciGanJing(String(word || ''))) return { ok: false, errors: ['概念词须为≤24字中文/词形，不含内部标记'] };
  const usedIds = new Set([...base.map((r) => r.id), ...cur.map((r) => r.id)]);
  let id = dw.PRIVATE_ID_MIN;
  while (usedIds.has(id)) id += 1;
  if (id > dw.PRIVATE_ID_MAX) return { ok: false, errors: ['私有 ID 分区已满'] };
  const bfoOk = ['Object', 'Process', 'Quality', 'Role', 'Function', 'Site', 'MaterialEntity'];
  const tpl = (dw.privateTemplate && dw.privateTemplate()[0]) || {};
  const root = {
    id, s3a: null, s3b: null,
    field: tpl.field || 'privateDomain',
    lemma_zh: String(word),
    bfo_type: bfoOk.includes(String(bfoType)) ? String(bfoType) : 'Object',
    place: [{ role: 'C', type: 'Object' }],
    nsm: ['SOMETHING'],
    pinyin: pinYinOf(word),
    definitionZh: String(meaning || word).slice(0, 200),
    source: source === 'summary' ? 'summary' : 'user',
    createdAt: Date.now(),
  };
  const v = dw.validatePrivateRoots([...cur, root], base);
  if (!v.valid) return { ok: false, errors: v.errors };
  return { ok: true, root, all: v.roots };
}

/** 总结完善：未覆盖片段滑窗 n-gram 计频（≥2 次、2..6 字、全中文、词表未收录、本身不可映射），
 *  优先最长词（跳过已选词的子串），每轮≤3 → 私有词根。 */
function waJue(text) {
  if (!dw) return { ok: false, errors: ['迪文不可用'] };
  const m = yingShe(String(text || '').slice(0, 6000));
  const freq = new Map();
  for (const sp of m.uncovered || []) {
    const t = String(sp.surface || '');
    for (let len = 2; len <= 6; len += 1) {
      for (let i = 0; i + len <= t.length; i += 1) {
        const w = t.slice(i, i + len);
        if ([...w].every(HAN)) freq.set(w, (freq.get(w) || 0) + 1);
      }
    }
  }
  const base = jiChu();
  const cur = duSiYou();
  const yiYou = new Set([...base, ...cur].map((r) => r.lemma_zh));
  const houXuan = [...freq.entries()].filter(([w, n]) => n >= 2 && !yiYou.has(w))
    .sort((a, b) => (b[1] - a[1]) || (b[0].length - a[0].length));
  const added = [];
  let all = cur;
  for (const [w] of houXuan) {
    if (added.length >= 3) break;
    if (added.some((r) => r.lemma_zh.includes(w))) continue; // 最长词优先
    let keYingShe = false;
    try { keYingShe = yingShe(w).status === 'STRUCTURED'; } catch { keYingShe = true; }
    if (keYingShe) continue; // 本身已可映射 ⇒ 不缺概念
    const r = gouZaoSiYou(w, '总结自动完善：会话高频未覆盖概念', 'Object', 'summary');
    if (r.ok) { added.push(r.root); all = r.all; }
  }
  return { ok: true, added, all };
}

async function chuLi(req) {
  const { id, fn, args } = req || {};
  const hui = (ok, result, error) => process.stdout.write(JSON.stringify({ id, ok, result, error }) + '\n');
  try {
    if (fn === 'ping') return hui(true, { ok: !!dw, version: dw ? dw.DIWEN_VERSION : null });
    if (!dw) return hui(false, null, '迪文不可用');
    if (fn === 'status') {
      const l = lex();
      return hui(true, { version: baoBanBen(), format: dw.DIWEN_VERSION, size: l.size, privateCount: l.privateCount || 0, jieba: jiebaReady,
        source: baoDangQian?.dir === suiBaoDir ? 'bundled' : 'update',
        dataFormat: fs.existsSync(path.join(baoDangQian.dir, 'dist', 'data.gz')) ? 'gzip' : 'legacy', semanticApproval: false });
    }
    if (fn === 'refresh') {
      lexHuan = dw.loadLexicon(undefined, { noCache: true });
      buJiebaCi((lexHuan.roots || []).filter((r) => r.private).map((r) => String(r.lemma_zh || '')));
      return hui(true, { ok: true });
    }
    if (fn === 'kbQuery') {
      const kb = dw.createKB(args.entries || []);
      const r = kb.query(String(args.query || ''), { validate: dw.validateDocument });
      return hui(true, { state: r.state });
    }
    if (fn === 'privateList') return hui(true, duSiYou());
    if (fn === 'privateAdd') return hui(true, gouZaoSiYou(args.word, args.meaning, args.bfoType, args.source));
    if (fn === 'privateRemove') {
      const cur = duSiYou();
      const all = cur.filter((r) => Number(r.id) !== Number(args.id));
      const v = dw.validatePrivateRoots(all, jiChu());
      return hui(true, v.valid ? { ok: true, all: v.roots } : { ok: false, errors: v.errors });
    }
    /* R263：私有包 CLI 同口径的程序化 API（导入/导出/卸载/列出；冲突自动裁决，基础不可变） */
    if (fn === 'pkgList') {
      const dir = siYouBaoDir();
      let lie = [];
      try { lie = dw.listPrivatePackages(dir || undefined) || []; } catch { lie = []; }
      const legacy = duSiYou();
      if (legacy.length) lie = [...lie, { namespace: '__legacy__', name: '本机单文件私有概念', concepts: legacy.length, legacy: true }];
      return hui(true, lie);
    }
    if (fn === 'pkgImport') {
      const pkg = dw.readPrivatePackage(String(args.path || ''));
      const base = jiChu();
      let installed = [];
      try { installed = dw.listPrivatePackages(siYouBaoDir() || undefined) || []; } catch { installed = []; }
      const v = dw.validatePrivatePackage(pkg, base, installed);
      if (!v.valid) return hui(true, { ok: false, errors: v.errors, conflicts: v.conflicts || null });
      const r = dw.importPrivatePackage(pkg, base, installed, { dir: siYouBaoDir() || undefined });
      lexHuan = dw.loadLexicon(undefined, { noCache: true });
      return hui(true, { ok: (r.errors || []).length === 0, ...r });
    }
    if (fn === 'pkgExport') {
      const l = lex();
      const pkg = dw.exportPrivatePackage(l, { namespace: String(args.namespace || 'warmy.local'), name: String(args.name || 'warmy-private'), candidates: true, enhance: true });
      dw.writePrivatePackage(String(args.path || ''), pkg, { zip: false });
      return hui(true, { ok: true, concepts: (pkg.concepts || []).length, warnings: pkg.warnings || [] });
    }
    if (fn === 'pkgUninstall') {
      const ns = String(args.namespace || '');
      if (ns === '__legacy__') {
        const v = dw.validatePrivateRoots([], jiChu());
        lexHuan = dw.loadLexicon(undefined, { noCache: true });
        return hui(true, { ok: true, all: v.roots, legacyCleared: true });
      }
      const r = dw.uninstallPrivatePackage(ns, { dir: siYouBaoDir() || undefined });
      lexHuan = dw.loadLexicon(undefined, { noCache: true });
      return hui(true, { ok: !r.notFound, ...r });
    }
    if (fn === 'improve') return hui(true, waJue(args.text));
    /* R280：迪文→确定唯一自然语（LLM 输入通道） */
    if (fn === 'render') return hui(true, { text: renderDiwen(args && args.doc) });
    if (fn === 'call') {
      /** mapText 统一走确定性最长匹配 + 自持词典（私有词根生效）；其余导出原样转发。 */
      if (args.fn === 'mapText') return hui(true, yingShe(args.args && args.args[0]));
      const f = dw[args.fn];
      if (typeof f !== 'function') return hui(false, null, '未知导出: ' + args.fn);
      /* 最新公共 API 含 Promise 返回值，必须等待再序列化，不能把 Promise 当作 {} 成功回执。 */
      return hui(true, await f(...(args.args || [])));
    }
    return hui(false, null, '未知方法: ' + fn);
  } catch (e) { return hui(false, null, String((e && e.message) || e).slice(0, 300)); }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => { try { void chuLi(JSON.parse(line)); } catch { /* 坏行忽略 */ } });
rl.on('close', () => process.exit(0));
process.stdout.write(JSON.stringify({ id: 0, ok: true, result: { ready: true, ok: !!dw } }) + '\n');