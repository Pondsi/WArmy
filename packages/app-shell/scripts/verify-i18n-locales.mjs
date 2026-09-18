/**
 * i18n self-check across ALL supported locale packs.
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
import { fileURLToPath } from 'node:url';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const i18nDir = path.join(selfDir, '..', 'src', 'i18n');

const LOCALES = ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko', 'ru', 'es', 'fr', 'pt', 'eo'];
const EXCEPTION_KEYS = new Set(['app.zhName', 'settings.localeZh', 'about.copyrightBody', 'llm.toolRecallDesc']);
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
    'app.displayName': '無限社畜',
    'brand.sub': '無限社畜 / WArmy (Workhorse Army)',
  },
  ko: {
    'brand.name': '무한 사축',
    'brand.tagline': 'AI가 당신 대신 사축처럼 일해줍니다.',
    'app.displayName': '무한 사축',
    'brand.sub': '무한 사축 / WArmy (Workhorse Army)',
  },
};

const PH = /\{[^{}]+\}|%[sd]|%\d+\$[sd]/g;

let pass = 0;
let fail = 0;
const failures = [];

function check(label, ok, detail) {
  if (ok) {
    pass += 1;
    console.log(`  ok  ${label}`);
  } else {
    fail += 1;
    failures.push({ label, detail });
    console.log(`  FAIL ${label}`, detail ?? '');
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

// en/other brand name is WArmy
for (const loc of ['en-US', 'ru', 'es', 'fr', 'pt', 'eo']) {
  check(`${loc} brand.name === WArmy`, packs[loc]['brand.name'] === 'WArmy', packs[loc]['brand.name']);
  check(`${loc} app.enName === WArmy`, packs[loc]['app.enName'] === 'WArmy', packs[loc]['app.enName']);
}

// zh-CN brand.sub / app.subtitle (owner naming)
check('zh-CN brand.sub === WArmy（Workhorse Army）', packs['zh-CN']['brand.sub'] === 'WArmy（Workhorse Army）', packs['zh-CN']['brand.sub']);
check('zh-CN app.subtitle === Workhorse Army', packs['zh-CN']['app.subtitle'] === 'Workhorse Army', packs['zh-CN']['app.subtitle']);
check('en-US app.subtitle === official tagline', packs['en-US']['app.subtitle'] === 'An infinite army of AI workhorses working for you.', packs['en-US']['app.subtitle']);
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

// ja/ko product name exact (no WArmy suffix on brand.name)
check("ja brand.name === '無限社畜'", packs['ja']['brand.name'] === '無限社畜', packs['ja']['brand.name']);
check("ko brand.name === '무한 사축'", packs['ko']['brand.name'] === '무한 사축', packs['ko']['brand.name']);
check('zh-CN brand.name === 无限牛马', packs['zh-CN']['brand.name'] === '无限牛马', packs['zh-CN']['brand.name']);
check('zh-TW brand.name === 無限牛馬', packs['zh-TW']['brand.name'] === '無限牛馬', packs['zh-TW']['brand.name']);
// 4 documented exceptions still present and correctly spelled
check("zh-CN app.zhName === '无限牛马'", packs['zh-CN']['app.zhName'] === '无限牛马', packs['zh-CN']['app.zhName']);
check("en-US app.zhName === '无限牛马' (Chinese-in-English exception)", packs['en-US']['app.zhName'] === '无限牛马', packs['en-US']['app.zhName']);

// 4 documented exceptions may contain CJK even in Latin packs
for (const loc of LATIN_LOCALES) {
  for (const k of EXCEPTION_KEYS) {
    check(`${loc} exception key present: ${k}`, typeof packs[loc][k] === 'string');
  }
}

console.log(`\n==== i18n self-check: ${pass} ok / ${fail} FAIL ====\n`);
if (fail) {
  console.log('Failures:', JSON.stringify(failures, null, 2));
  process.exit(1);
}
process.exit(0);
