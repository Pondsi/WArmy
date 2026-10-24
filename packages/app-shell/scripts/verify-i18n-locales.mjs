/**
 * i18n self-check across ALL supported yuYan packs.
 *
 * Checks:
 *  1. All 10 packs exist
 *  2. Key sets are EQUAL (including brand.tagline)
 *  3. No duplicate keys in raw JSON
 *  4. Placeholders match across packs
 *  5. Wrong-script: no CJK in ru/es/fr/pt/eo (except 4 documented exceptions);
 *     no Cyrillic in ja/ko/zh-*; ja/ko brand strings are owner-supplied names
 *
 * Usage: node packages/app-shell/scripts/verify-i18n-locales.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const i18nDir = path.join(selfDir, '..', 'src', 'i18n');

const LOCALES = ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko', 'ru', 'es', 'fr', 'pt', 'eo'];
const EXCEPTION_KEYS = new Set(['yingYong.zhName', 'app.zhName', 'settings.localeZh', 'about.copyrightBody', 'llm.toolRecallDesc']);
const LATIN_LOCALES = new Set(['ru', 'es', 'fr', 'pt', 'eo']); // wrong-script: no CJK (except exceptions)
const CYRILLIC_FORBIDDEN = new Set(['ja', 'ko', 'zh-CN', 'zh-TW']);
const CJK = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]/;
const CYRILLIC = /[\u0400-\u04FF]/;

const EXPECTED_BRAND = {
  'zh-CN': { 'brand.name': '无限牛马', 'brand.tagline': '让AI成为你的无限牛马' },
  'zh-TW': { 'brand.name': '無限牛馬', 'brand.tagline': '讓AI成為你的無限牛馬' },
  ja: {
    'brand.name': '無限社畜',
    'brand.tagline': 'AIがあなたの社畜になって、無限に働きます。',
    'yingYong.displayName': '無限社畜',
    'brand.fu': 'WArmy (Workhorse Army)',
  },
  ko: {
    'brand.name': '무한 사축',
    'brand.tagline': 'AI가 당신 대신 사축처럼 일해줍니다.',
    'yingYong.displayName': '무한 사축',
    'brand.fu': 'WArmy (Workhorse Army)',
  },
};

const PH = /\{[^{}]+\}|%[sd]|%\d+\$[sd]/g;

let pass = 0;
let fail = 0;
const failures = [];

function check(biaoQian, ok, detail) {
  if (ok) {
    pass += 1;
    console.log(`  ok  ${biaoQian}`);
  } else {
    fail += 1;
    failures.push({ biaoQian, detail });
    console.log(`  FAIL ${biaoQian}`, detail ?? '');
  }
}

function readRaw(loc) {
  return fs.readFileSync(path.join(i18nDir, `${loc}.json`), 'utf8');
}

function parseCountDupes(raw) {
  // Count duplicate keys in raw JSON object text (top-level "key":)
  const keys = [];
  const re = /^\s*"((?:\\.|[^"\\])*)"\s*:/gm;
  let m;
  while ((m = re.exec(raw))) {
    keys.push(JSON.parse(`"${m[1]}"`));
  }
  const seen = new Set();
  const dupes = [];
  for (const k of keys) {
    if (seen.has(k)) dupes.push(k);
    seen.add(k);
  }
  return { keys, dupes };
}

function phs(value) {
  return [...String(value ?? '').matchAll(PH)].map((x) => x[0]).sort().join('|');
}

console.log('i18n self-check — all packs\n');

// 1. packs exist
const packs = {};
const raws = {};
for (const loc of LOCALES) {
  const p = path.join(i18nDir, `${loc}.json`);
  const exists = fs.existsSync(p);
  check(`pack exists: ${loc}.json`, exists, p);
  if (!exists) continue;
  raws[loc] = readRaw(loc);
  packs[loc] = JSON.parse(raws[loc]);
}

if (Object.keys(packs).length !== LOCALES.length) {
  console.log('\nCannot continue — missing packs.');
  process.exit(1);
}

// 2. key counts + equality
const refKeys = Object.keys(packs['zh-CN']).sort();
console.log('\nkey counts per pack:');
for (const loc of LOCALES) {
  const n = Object.keys(packs[loc]).length;
  console.log(`  ${loc}: ${n}`);
  check(`${loc} key count equals zh-CN (${refKeys.length})`, n === refKeys.length, { n, ref: refKeys.length });
}

const refSet = new Set(refKeys);
for (const loc of LOCALES) {
  const keys = Object.keys(packs[loc]);
  const missing = refKeys.filter((k) => !(k in packs[loc]));
  const extra = keys.filter((k) => !refSet.has(k));
  check(`${loc} key set EQUAL to zh-CN`, missing.length === 0 && extra.length === 0, { missing: missing.slice(0, 8), extra: extra.slice(0, 8) });
}

// brand.tagline present
check('brand.tagline present in zh-CN', typeof packs['zh-CN']['brand.tagline'] === 'string' && packs['zh-CN']['brand.tagline'].length > 0);
check('brand.tagline present in en-US', typeof packs['en-US']['brand.tagline'] === 'string' && packs['en-US']['brand.tagline'].length > 0);

// 3. duplicate keys
for (const loc of LOCALES) {
  const { dupes } = parseCountDupes(raws[loc]);
  check(`${loc} no duplicate keys`, dupes.length === 0, dupes.slice(0, 5));
}

// 4. placeholders match across packs (vs zh-CN canonical)
for (const loc of LOCALES) {
  const bad = [];
  for (const k of refKeys) {
    const a = phs(packs['zh-CN'][k]);
    const b = phs(packs[loc][k]);
    if (a !== b) bad.push({ k, zh: a, loc: b });
  }
  check(`${loc} placeholders match zh-CN`, bad.length === 0, bad.slice(0, 5));
}

// 5. wrong-script
for (const loc of LATIN_LOCALES) {
  const bad = [];
  for (const k of refKeys) {
    if (EXCEPTION_KEYS.has(k)) continue;
    const v = String(packs[loc][k] ?? '');
    if (CJK.test(v)) bad.push({ k, v: v.slice(0, 60) });
  }
  check(`${loc} no CJK outside exceptions`, bad.length === 0, bad.slice(0, 8));
}

for (const loc of CYRILLIC_FORBIDDEN) {
  const bad = [];
  for (const k of refKeys) {
    const v = String(packs[loc][k] ?? '');
    if (CYRILLIC.test(v)) bad.push({ k, v: v.slice(0, 60) });
  }
  check(`${loc} no Cyrillic`, bad.length === 0, bad.slice(0, 5));
}

// ja/ko brand must be owner-supplied (not Chinese 无限牛马 as brand.name)
for (const loc of ['ja', 'ko']) {
  const exp = EXPECTED_BRAND[loc];
  for (const [k, want] of Object.entries(exp)) {
    check(`${loc} ${k} === owner string`, packs[loc][k] === want, { got: packs[loc][k], want });
  }
  check(
    `${loc} brand.name is not Chinese 无限牛马`,
    packs[loc]['brand.name'] !== '无限牛马',
    packs[loc]['brand.name'],
  );
}

// zh brands
for (const loc of ['zh-CN', 'zh-TW']) {
  const exp = EXPECTED_BRAND[loc];
  for (const [k, want] of Object.entries(exp)) {
    check(`${loc} ${k} correct`, packs[loc][k] === want, { got: packs[loc][k], want });
  }
}

// en/other brand ming is WArmy
for (const loc of ['en-US', 'ru', 'es', 'fr', 'pt', 'eo']) {
  check(`${loc} brand.name === WArmy`, packs[loc]['brand.name'] === 'WArmy', packs[loc]['brand.name']);
  check(`${loc} yingYong.enName === WArmy`, packs[loc]['yingYong.enName'] === 'WArmy', packs[loc]['yingYong.enName']);
}

// zh-CN brand.fu / yingYong.subtitle (owner naming)
check('zh-CN brand.fu === WArmy（Workhorse Army）', packs['zh-CN']['brand.fu'] === 'WArmy（Workhorse Army）', packs['zh-CN']['brand.fu']);
check('zh-CN yingYong.subtitle === Workhorse Army', packs['zh-CN']['yingYong.subtitle'] === 'Workhorse Army', packs['zh-CN']['yingYong.subtitle']);
check('en-US yingYong.subtitle === official tagline', packs['en-US']['yingYong.subtitle'] === 'An infinite army of AI workhorses working for you.', packs['en-US']['yingYong.subtitle']);
  check('en-US brand.tagline === official tagline', packs['en-US']['brand.tagline'] === 'An infinite army of AI workhorses working for you.', packs['en-US']['brand.tagline']);

// no stale brand token in ANY pack value
// (regex assembled so this self-check file itself contains no legacy brand literals)
const STALE_BRAND = new RegExp(['CC(?:', 'Army|ARMY)', '|Corporate Cat(?:', 'tle|le)'].join(''), 'i');
for (const loc of LOCALES) {
  const bad = [];
  for (const k of refKeys) {
    const v = String(packs[loc][k] ?? '');
    if (STALE_BRAND.test(v)) bad.push({ k, v: v.slice(0, 70) });
  }
  check(`${loc} no legacy brand token in values`, bad.length === 0, bad.slice(0, 6));
}

// ja/ko chanPin ming exact (no WArmy suffix qiYong brand.name)
check("ja brand.name === '無限社畜'", packs['ja']['brand.name'] === '無限社畜', packs['ja']['brand.name']);
check("ko brand.name === '무한 사축'", packs['ko']['brand.name'] === '무한 사축', packs['ko']['brand.name']);
check('zh-CN brand.name === 无限牛马', packs['zh-CN']['brand.name'] === '无限牛马', packs['zh-CN']['brand.name']);
check('zh-TW brand.name === 無限牛馬', packs['zh-TW']['brand.name'] === '無限牛馬', packs['zh-TW']['brand.name']);
// 4 documented exceptions still present and correctly spelled
check("zh-CN yingYong.zhName === '无限牛马'", packs['zh-CN']['yingYong.zhName'] === '无限牛马', packs['zh-CN']['yingYong.zhName']);
check("en-US yingYong.zhName === '无限牛马' (Chinese-in-English exception)", packs['en-US']['yingYong.zhName'] === '无限牛马', packs['en-US']['yingYong.zhName']);

// 4 documented exceptions may contain CJK even in Latin packs
for (const loc of LATIN_LOCALES) {
  for (const k of EXCEPTION_KEYS) {
    check(`${loc} exception key present: ${k}`, typeof packs[loc][k] === 'string');
  }
}


for (const loc of ['en-US', 'ru', 'es', 'fr', 'pt', 'eo']) {
  check(`${loc} brand.fu === Workhorse Army`, packs[loc]['brand.fu'] === 'Workhorse Army', packs[loc]['brand.fu']);
}
check("ja brand.fu === 'WArmy (Workhorse Army)'", packs['ja']['brand.fu'] === 'WArmy (Workhorse Army)', packs['ja']['brand.fu']);
check("ko brand.fu === 'WArmy (Workhorse Army)'", packs['ko']['brand.fu'] === 'WArmy (Workhorse Army)', packs['ko']['brand.fu']);
check('ja settings.section.ui is インターフェース', packs['ja']['settings.section.ui'] === 'インターフェース', packs['ja']['settings.section.ui']);
check('ko settings.section.ui is 인터페이스', packs['ko']['settings.section.ui'] === '인터페이스', packs['ko']['settings.section.ui']);
// Workhorse chanPin terms (nav)
check('zh-CN nav.singleAi = 我的牛马', packs['zh-CN']['nav.singleAi'] === '我的牛马', packs['zh-CN']['nav.singleAi']);
check('en-US nav.singleAi = My Workhorses', packs['en-US']['nav.singleAi'] === 'My Workhorses', packs['en-US']['nav.singleAi']);
check('ja nav.singleAi = マイ社畜たち', packs['ja']['nav.singleAi'] === 'マイ社畜たち', packs['ja']['nav.singleAi']);
check('ko nav.singleAi = 일꾼들', packs['ko']['nav.singleAi'] === '일꾼들', packs['ko']['nav.singleAi']);
check('ja cattle.biaoTi = 社畜', packs['ja']['cattle.biaoTi'] === '社畜', packs['ja']['cattle.biaoTi']);
check('en-US cattle.biaoTi = Workhorses', packs['en-US']['cattle.biaoTi'] === 'Workhorses', packs['en-US']['cattle.biaoTi']);
check('en-US no My Agents in nav.singleAi', packs['en-US']['nav.singleAi'] !== 'My Agents');
check('ja nav.singleAi not English My Agents', packs['ja']['nav.singleAi'] !== 'My Agents');

// ── 键值质量：新增的界面状态键必须 10 包同集且非空 ──
{
  const busyKeys = ['chat.busy.1', 'chat.busy.2', 'chat.busy.8', 'chat.busy.done', 'chat.busy.still', 'chat.busy.fail'];
  for (const k of busyKeys) {
    const missing = Object.keys(packs).filter((loc) => !String(packs[loc][k] || '').trim());
    check(`所有语言包都有非空的 ${k}`, missing.length === 0, missing.join(',') || 'ok');
  }
  const empties = [];
  for (const loc of Object.keys(packs)) {
    for (const [k, v] of Object.entries(packs[loc])) {
      if (v === '' || v === null || v === undefined) empties.push(`${loc}:${k}`);
    }
  }
  check('没有任何语言包存在空值', empties.length === 0, empties.slice(0, 8).join(',') || 'ok');
  // 引导文案里的图标占位符必须每包都在（图标由渲染层替换，翻译里保持纯文本）
  for (const loc of Object.keys(packs)) {
    const b2 = String(packs[loc]['guide.step2.body'] || '');
    if (!b2.includes('{icon:niuMa}') || !b2.includes('{icon:guanLiJu}')) {
      check(`${loc} guide.step2.body 含图标占位符`, false, b2.slice(0, 80));
    }
  }
  check('所有语言包的 guide.step2.body 都含图标占位符', true);
}

/**
 * ── 第 44 轮：**文本出口必须替换干净**（占位符漏填 / 裸键名直出）────────────────
 * 起因是真机取证抓到的两条：
 *  · 主进程 `tiHuan()` 漏填 `{k}` ⇒ 模型收到字面量"每次只增加不到 {k} 字"；
 *  · 同一条文案里 `{y}` 用了**两遍**，而 `.replace('{y}', …)`（串形式）**只换第一处**
 *    ⇒ 句子结尾还是"完成情况与字数（{y} 字）"。修完 `{k}` 复跑才露出这一条。
 * 顺带一次全仓扫描又抓到 14 处：渲染层 `fmtKey` 只认两参 `fmtKey(k, vars)`，
 * 却有人按 `fmtKey(k, '兜底 {n}', { n })` 三参写（兜底串被当成 vars ⇒ 界面直接印**键名**），
 * 还有 9 处模板写 `{name}` 而调用点传 `ming`（确认框里显示"这会停止「{name}」"，用户看不出停的是哪个）。
 * ⇒ 判据写成**行为不变量**，不钉任何一句文案的措辞（钉措辞＝下次改文案就红）。
 */
{
  const srcDir = path.join(selfDir, '..', 'src');
  const duZhanWei = (s) => [...new Set(String(s).match(/\{(\w+)\}/g) || [])].map((x) => x.slice(1, -1));
  const ciShu = (s, t) => (String(s).match(new RegExp('\\{' + t + '\\}', 'g')) || []).length;
  /** 花括号配平，取出实参对象那一整段；返回 null 表示这一眼看上去不是对象字面量 */
  const duiXiang = (S, from) => {
    const i = S.indexOf('{', from);
    if (i < 0 || i - from > 60) return null;
    let depth = 0, inS = null;
    for (let j = i; j < S.length; j++) {
      const c = S[j];
      if (inS) { if (c === '\\') j++; else if (c === inS) inS = null; continue; }
      if (c === '"' || c === "'" || c === '`') { inS = c; continue; }
      if (c === '{' || c === '(' || c === '[') depth++;
      else if (c === '}' || c === ')' || c === ']') { depth--; if (!depth) return S.slice(i + 1, j); }
    }
    return null;
  };
  /** 顶层逗号切段取属性名（`x:` 与 简写 `x` 都认；嵌套对象/三元不算） */
  const shuXingMing = (duan) => {
    const out = new Set();
    let depth = 0, inS = null, seg = '';
    const flush = () => {
      const s = seg.trim(); seg = '';
      if (!s) return;
      let m = /^(\w+)\s*:/.exec(s); if (m) { out.add(m[1]); return; }
      m = /^(\w+)$/.exec(s); if (m) out.add(m[1]);
    };
    for (let k = 0; k < duan.length; k++) {
      const c = duan[k];
      if (inS) { if (c === '\\') { seg += c; k++; if (k < duan.length) seg += duan[k]; continue; } if (c === inS) inS = null; seg += c; continue; }
      if (c === '"' || c === "'" || c === '`') { inS = c; seg += c; continue; }
      if (c === '{' || c === '(' || c === '[') { depth++; seg += c; continue; }
      if (c === '}' || c === ')' || c === ']') { depth--; seg += c; continue; }
      if (c === ',' && depth === 0) { flush(); continue; }
      seg += c;
    }
    flush();
    return out;
  };

  const APP = fs.readFileSync(path.join(srcDir, 'renderer', 'app.js'), 'utf8');
  const MEI = fs.readFileSync(path.join(srcDir, 'electron-main.ts'), 'utf8');

  // ① 渲染层 fmtKey：键要么在 10 包里都有，要么调用点显式带兜底串；实参必须覆盖模板的全部令牌
  const queJian = [], queShiCan = [];
  let at = -1;
  while ((at = APP.indexOf('fmtKey(', at + 1)) >= 0) {
    const m = /^fmtKey\(\s*(['"])([a-zA-Z0-9._]+)\1\s*(\+)?/.exec(APP.slice(at, at + 220));
    if (!m || m[3]) continue; // 动态拼键（`'console.cat.' + cat`）由调用点自己判，不在这里管
    const k = m[2];
    const zai = LOCALES.filter((loc) => typeof packs[loc][k] !== 'string');
    const houMian = APP.slice(at + m[0].length, at + m[0].length + 40);
    const daiDouDi = /^\s*,\s*(['"])/.test(houMian);
    if (zai.length && !daiDouDi) { queJian.push(`${k}（10 包里都没有，界面会直接显示键名）`); continue; }
    const moBan = typeof packs['zh-CN'][k] === 'string' ? packs['zh-CN'][k] : (m[0], '');
    if (!moBan) continue;
    const yao = duZhanWei(moBan);
    if (!yao.length) continue;
    /** 兜底串形式：vars 在第三参；两参形式：vars 在第二参 */
    const qi = daiDouDi ? APP.indexOf('{', APP.indexOf(',', APP.indexOf("'", at + m[0].length) + 1)) : at + m[0].length;
    const duan = duiXiang(APP, qi);
    const gei = duan ? shuXingMing(duan) : new Set();
    const lou = yao.filter((n) => !gei.has(n));
    if (lou.length) queShiCan.push(`${k} 模板要 {${yao.join('},{')}}，调用点只给了 {${[...gei].join(', ') || '无'}} ⇒ 界面留着 {${lou.join('},{')}}`);
  }
  check('渲染层 fmtKey：引用的键都在语言包里（或调用点自带兜底串）', queJian.length === 0, queJian.slice(0, 6).join(' | ') || 'ok');
  check('渲染层 fmtKey：实参覆盖模板里的每一个占位符（不许把 {name} 原样印在界面上）', queShiCan.length === 0, queShiCan.slice(0, 6).join(' | ') || 'ok');

  // ② 主进程 + 渲染层：模板里出现 ≥2 次的令牌，不许用**串形式** replace（只换第一处）
  const diPai = [];
  const zhenWen = (S, before) => {
    const qian = S.slice(Math.max(0, before - 3000), before);
    const ms = [...qian.matchAll(/t(?:Main|Or)?\(\s*(['"])([a-zA-Z0-9._]+)\1(?:\s*,\s*(['"])((?:[^\\]|\\.)*?)\3)?/g)];
    if (!ms.length) return null;
    const m = ms[ms.length - 1];
    const k = m[2];
    return { k, wen: typeof packs['zh-CN'][k] === 'string' ? packs['zh-CN'][k] : (m[4] || '') };
  };
  for (const [ming, S] of [['electron-main.ts', MEI], ['app.js', APP]]) {
    for (const m of S.matchAll(/\.replace\(\s*(['"])\\?\{(\w+)\\?\}\1/g)) {
      const z = zhenWen(S, m.index);
      if (!z || !z.wen) continue;
      if (ciShu(z.wen, m[2]) > 1) diPai.push(`${ming} 键=${z.k} 令牌 {${m[2]}} 在文案里出现 ${ciShu(z.wen, m[2])} 次，却用串形式 replace ⇒ 会留下字面量`);
    }
  }
  check('重复使用的占位符一律用带 g 的正则替换（串形式 replace 只换第一处）', diPai.length === 0, diPai.slice(0, 6).join(' | ') || 'ok');

  /**
   * ③ **共享替换器**也要管：`const tiHuan = (s) => s.replace('{y}', …)` 这种"把一串 replace 抽成一个函数、
   * 再 `tiHuan(tMain('k', 兜底))` 调用"的写法，上面按调用点就近找文案的判据**看不见它**
   * （替换器定义在文案前面，往后找不到键）。真机那条 `{y}` 用两遍的漏替换就是躲在这里的。
   * ⇒ 单独一条：收集每个替换器用**串形式**替换了哪些令牌，再看喂给它的文案里该令牌出现几次。
   */
  const tiHuanBing = [];
  for (const m of MEI.matchAll(/(?:const|let)\s+(\w+)\s*=\s*\(\s*s\s*(?::[^)]*)?\)\s*(?:[^=]|=(?!=)){0,40}=>\s*s\.replace\(/g)) {
    const ming = m[1];
    const jieShu = MEI.indexOf(';\n', m.index);
    const duan = MEI.slice(m.index, jieShu > 0 && jieShu - m.index < 1600 ? jieShu : m.index + 1600);
    const chuanXing = new Set([...duan.matchAll(/\.replace\(\s*['"]\{(\w+)\}['"]/g)].map((x) => x[1]));
    if (!chuanXing.size) continue;
    for (const call of MEI.matchAll(new RegExp(ming + '\\(\\s*t(?:Main|Or)?\\(\\s*([\'"])([a-zA-Z0-9.]+)\\1(?:\\s*,\\s*([\'"])((?:[^\\\\]|\\\\.)*?)\\3)?', 'g'))) {
      const k = call[2];
      const wen = typeof packs['zh-CN'][k] === 'string' ? packs['zh-CN'][k] : (call[4] || '');
      for (const t of chuanXing) {
        if (ciShu(wen, t) > 1) tiHuanBing.push(`替换器 ${ming} 用串形式换 {${t}}，而文案（键=${k}）里它出现 ${ciShu(wen, t)} 次 ⇒ 后面那次留字面量`);
      }
    }
  }
  check('共享替换器（tiHuan 这类）里，出现多次的占位符也必须用 /g', tiHuanBing.length === 0, tiHuanBing.slice(0, 6).join(' | ') || 'ok');
}


console.log(`\n==== i18n self-check: ${pass} ok / ${fail} FAIL ====\n`);

if (fail) {
  console.log('Failures:', JSON.stringify(failures, null, 2));
  process.exit(1);
}
process.exit(0);
