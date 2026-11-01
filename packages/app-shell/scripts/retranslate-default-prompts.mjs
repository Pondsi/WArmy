#!/usr/bin/env node
/**
 * retranslate-default-prompts.mjs —— 第 67 轮 项 9 的“超限时重译”工具（不是截断）。
 *
 * 只在某种语言的道/术**超过该语言折算上限**时运行：
 *   ① 以中文原文为源，请 MiMo 重新完整翻译（保留 6 节 43 条 / 4 节 25 条的结构）；
 *   ② 对译文做结构守恒 + 上限校验；任何一项不通过就**不写文件**，把差异打出来让人处理；
 *   ③ 通过才写回 mo-ren-yu-yan/<lang>.ts，并在下一轮门禁里重新跑三轮。
 *
 * 密钥只从 WARMY_MIMO_KEY_FILE 指向的文件第一行读取，绝不打印。
 * 用法：
 *   WARMY_MIMO_KEY_FILE=<密钥文件> node packages/app-shell/scripts/retranslate-default-prompts.mjs [lang ...]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shangXianOf } from '../dist/ti-shi-shang-xian.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DIR = path.join(ROOT, 'packages/app-shell/src/mo-ren-yu-yan');
const LIMIT = { 道: 2600, 术: 4200 };
const BEI = { 'zh-CN': 1, 'zh-TW': 1.05, 'en-US': 3.75, ja: 1.5, ko: 1.75, fr: 4, es: 3.9, pt: 3.75, ru: 3.3, eo: 3.6 };
const NAMES = { 'zh-TW': '繁體中文', 'en-US': 'English', ja: '日本語', ko: '한국어', fr: 'français', es: 'español', pt: 'português', ru: 'русский', eo: 'Esperanto' };
const keyFile = String(process.env.WARMY_MIMO_KEY_FILE || '').trim();
const BASE = String(process.env.WARMY_MIMO_BASE || 'https://token-plan-cn.xiaomimimo.com/v1').replace(/\/+$/, '');
const MODEL = String(process.env.WARMY_MIMO_MODEL || 'mimo-v2.6-flash');
if (!keyFile || !fs.existsSync(keyFile)) {
  console.error('请先设置 WARMY_MIMO_KEY_FILE（文件第一行是密钥）。');
  process.exit(2);
}
const KEY = fs.readFileSync(keyFile, 'utf8').split(/\r?\n/)[0].trim();
if (!KEY) { console.error('密钥文件第一行为空。'); process.exit(2); }

const zhSrc = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/dao-default.ts'), 'utf8');
const zhShuSrc = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/shu-default.ts'), 'utf8');
const pick = (s, n) => (s.match(new RegExp(`export const ${n} = \`([\\s\\S]*?)\`;`)) || [])[1] || '';
const ZH = { dao: pick(zhSrc, 'DAO_MOREN'), shu: pick(zhShuSrc, 'SHU_MOREN') };
const jie = (s) => (s.match(/^## /gm) || []).length;
const tiao = (s) => (s.match(/^\d+\. /gm) || []).length;
const want = { dao: { jie: jie(ZH.dao), tiao: tiao(ZH.dao) }, shu: { jie: jie(ZH.shu), tiao: tiao(ZH.shu) } };

const readLang = (lang) => {
  const p = path.join(DIR, lang + '.ts');
  if (!fs.existsSync(p)) return null;
  const s = fs.readFileSync(p, 'utf8');
  return { path: p, dao: pick(s, 'DAO_MOREN'), shu: pick(s, 'SHU_MOREN') };
};

async function translate(text, lang, ceng) {
  const lim = shangXianOf(ceng, lang);
  const sys = `You are a professional technical translator. Translate the user's Chinese prompt into ${NAMES[lang] || lang}. `
    + `Keep EVERY heading (## ...), numbered item and its order; do not merge, omit, summarize or add items. `
    + `The translated text MUST be no longer than ${lim} characters. Output only the translation, no commentary, no backticks.`;
  const r = await fetch(BASE + '/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.1,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: text },
      ],
    }),
    signal: AbortSignal.timeout(180000),
  });
  const j = await r.json().catch(() => null);
  const out = String(j?.choices?.[0]?.message?.content || '').trim();
  if (!r.ok || !out) throw new Error('translate-http-' + r.status);
  return out;
}

const FORCE = process.argv.includes('--force');
const langs = process.argv.slice(2).filter((x) => NAMES[x]);
const targets = langs.length ? langs : Object.keys(NAMES);
let changed = 0, failed = 0;
for (const lang of targets) {
  const cur = readLang(lang);
  if (!cur) { console.log(`${lang}: 跳过（没有文件）`); continue; }
  const next = { ...cur };
  for (const ceng of ['dao', 'shu']) {
    const lim = shangXianOf(ceng === 'dao' ? '道' : '术', lang);
    if (!FORCE && String(cur[ceng]).length <= lim) { console.log(`${lang}/${ceng}: ${String(cur[ceng]).length} ≤ ${lim}，无需重译`); continue; }
    console.log(`${lang}/${ceng}: ${String(cur[ceng]).length} > ${lim}，重新翻译…`);
    try {
      const t = await translate(ZH[ceng], lang, ceng === 'dao' ? '道' : '术');
      const w = want[ceng];
      if (String(t).length > lim || jie(t) !== w.jie || tiao(t) !== w.tiao || /`|\$\{/.test(t)) {
        throw new Error(`译文不合格：len=${String(t).length}/${lim} 节=${jie(t)}/${w.jie} 条=${tiao(t)}/${w.tiao}`);
      }
      next[ceng] = t;
    } catch (e) {
      failed++;
      console.error(`${lang}/${ceng}: 重译失败，保持原文 —— ${String((e && e.message) || e)}`);
    }
  }
  if (next.dao === cur.dao && next.shu === cur.shu) continue;
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  const body = `/** 由 retranslate-default-prompts.mjs 重译（结构守恒 + 上限校验通过）。 */\n`
    + `export const DAO_MOREN = \`${esc(next.dao)}\`;\n\n`
    + `export const SHU_MOREN = \`${esc(next.shu)}\`;\n`;
  fs.writeFileSync(cur.path, body, 'utf8');
  changed++;
  console.log(`${lang}: 已重译并写回（道 ${String(next.dao).length}、术 ${String(next.shu).length} 字符）`);
}
console.log(`完成：重写 ${changed} 个语言文件，失败 ${failed} 处。请重新构建并跑 verify-r67-prompt-caps 的三轮门禁。`);
process.exit(failed ? 1 : 0);
