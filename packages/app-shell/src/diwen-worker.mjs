/**
 * R257：迪文子进程 worker。
 * 零原生模块约定：npm diwen 的可选增强 @node-rs/jieba 是 .node，主/渲染进程绝不加载；
 * 仿 memory-os 先例把迪文整体放进独立 Node 子进程，主进程经 JSON-line RPC 使用。
 * 私有迪文文件由主进程经 DIWEN_PRIVATE_LEXICON 注入；本进程负责校验/合并/挖掘，主进程负责落盘。
 */
import fs from 'node:fs';
import readline from 'node:readline';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const req = createRequire(import.meta.url);
/** npm 包版本（DIWEN_VERSION 是格式版本，不是包版本）。 */
function baoBanBen() {
  try { return JSON.parse(fs.readFileSync(req.resolve('diwen/package.json'), 'utf8')).version; } catch { return dw ? dw.DIWEN_VERSION : null; }
}

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
  const reqD = createRequire(req.resolve('diwen/package.json'));
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
try { dw = await import('diwen'); } catch {
  const dir = String(process.env.WARMY_DIWEN_DIR || '');
  if (dir) { try { dw = await import(pathToFileURL(dir.replace(/\\/g, '/') + '/src/index.js').href); } catch { dw = null; } }
}

const siYouPath = () => String(process.env.DIWEN_PRIVATE_LEXICON || '');
/** worker 自持词典引用：npm loadLexicon(noCache) 不回写模块缓存，刷新后必须换引用。 */
let lexHuan = null;
const lex = () => { if (!lexHuan) lexHuan = dw.loadLexicon(); return lexHuan; };
/** 映射契约：确定性词典最长匹配（segmentZh:false）——保证私有词根必中（bundle 经 ESM 引 jieba，CJS 补丁触及不到其分词）。
 *  jieba 原生增强仍加载（jiebaReady 状态供设置页展示/后续 NL 质量增强）。 */
const yingShe = (text) => dw.mapText(String(text || ''), lex(), { segmentZh: false, warnDegraded: false });
function duSiYou() {
  const p = siYouPath();
  if (!p || !fs.existsSync(p)) return [];
  try { const a = JSON.parse(fs.readFileSync(p, 'utf8')); return Array.isArray(a) ? a : []; } catch { return []; }
}
function jiChu() { return lex().roots.filter((r) => !r.private); }
const HAN = (ch) => { const c = ch.codePointAt(0) || 0; return c >= 0x4e00 && c <= 0x9fff; };
const ciGanJing = (w) => w && !w.includes('_') && !['__proto__', 'constructor', 'prototype'].includes(w) && [...w].length <= 24;

/** 构造一条私有词根（id/字形坐标自动取空闲位），相对基础+现有私有做碰撞校验。 */
function gouZaoSiYou(word, meaning, bfoType, source) {
  if (!dw) return { ok: false, errors: ['迪文不可用'] };
  const base = jiChu();
  const cur = duSiYou();
  if (cur.length >= (dw.MAX_CUSTOM_ROOTS || 695)) return { ok: false, errors: ['私有迪文已达上限'] };
  if (!ciGanJing(String(word || ''))) return { ok: false, errors: ['概念词须为≤24字中文/词形，不含内部标记'] };
  const usedIds = new Set([...base.map((r) => r.id), ...cur.map((r) => r.id)]);
  let id = dw.PRIVATE_ID_MIN;
  while (usedIds.has(id)) id += 1;
  if (id > dw.PRIVATE_ID_MAX) return { ok: false, errors: ['私有 ID 分区已满'] };
  const coord = dw.freeCoordinates([...base, ...cur], 1)[0];
  if (!coord) return { ok: false, errors: ['无空闲字形坐标'] };
  const bfoOk = ['Object', 'Process', 'Quality', 'Role', 'Function', 'Site', 'MaterialEntity'];
  const root = {
    id, s3a: coord.s3a, s3b: coord.s3b,
    field: 'userPrivate',
    lemma_zh: String(word),
    bfo_type: bfoOk.includes(String(bfoType)) ? String(bfoType) : 'Object',
    place: [{ role: 'C', type: 'Any' }],
    nsm: ['SOMETHING'],
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

function chuLi(req) {
  const { id, fn, args } = req || {};
  const hui = (ok, result, error) => process.stdout.write(JSON.stringify({ id, ok, result, error }) + '\n');
  try {
    if (fn === 'ping') return hui(true, { ok: !!dw, version: dw ? dw.DIWEN_VERSION : null });
    if (!dw) return hui(false, null, '迪文不可用');
    if (fn === 'status') {
      const l = lex();
      return hui(true, { version: baoBanBen(), format: dw.DIWEN_VERSION, size: l.size, privateCount: l.privateCount || 0, jieba: jiebaReady });
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
    if (fn === 'improve') return hui(true, waJue(args.text));
    if (fn === 'call') {
      /** mapText 统一走确定性最长匹配 + 自持词典（私有词根生效）；其余导出原样转发。 */
      if (args.fn === 'mapText') return hui(true, yingShe(args.args && args.args[0]));
      const f = dw[args.fn];
      if (typeof f !== 'function') return hui(false, null, '未知导出: ' + args.fn);
      return hui(true, f(...(args.args || [])));
    }
    return hui(false, null, '未知方法: ' + fn);
  } catch (e) { return hui(false, null, String((e && e.message) || e).slice(0, 300)); }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => { try { chuLi(JSON.parse(line)); } catch { /* 坏行忽略 */ } });
rl.on('close', () => process.exit(0));
process.stdout.write(JSON.stringify({ id: 0, ok: true, result: { ready: true, ok: !!dw } }) + '\n');