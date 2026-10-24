#!/usr/bin/env node
/**
 * 用 AI 把中文法律全文与英文提示词片段翻译到其余语言，消灭“英文兜底”。
 *
 * 用法：
 *   WARMY_MIMO_KEY_FILE=<密钥文件> node packages/app-shell/scripts/translate-i18n-ai.mjs --apply [lang ...]
 * 不传 lang 默认 zh-TW ja ko fr es pt ru eo；不传 --apply 只做 dry-run。
 *
 * 约束：
 *  · 只改指定键（privacy.body / privacy.ti / 9 个 llm.* 提示词片段），不碰其它文案；
 *  · 联系方式行统一替换成该语言 about.contactBody（保证邮箱/仓库地址逐字一致、只出现一次）；
 *  · 占位符 {ming}/{model} 必须原样保留；不通过就跳过该语言并如实打印。
 *  · 不打印密钥。翻译结果仍需发布前人工抽检（法律含义不能只靠模型）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const I18N = path.join(ROOT, 'packages/app-shell/src/i18n');
const KEY_FILE = String(process.env.WARMY_MIMO_KEY_FILE || '').trim();
const BASE = String(process.env.WARMY_MIMO_BASE || 'https://token-plan-cn.xiaomimimo.com/v1').replace(/\/+$/, '');
const MODEL = String(process.env.WARMY_MIMO_MODEL || 'mimo-v2.6-flash');
const APPLY = process.argv.includes('--apply');
const NAMES = { 'zh-TW': '繁體中文', ja: '日本語', ko: '한국어', fr: 'français', es: 'español', pt: 'português', ru: 'русский', eo: 'Esperanto' };
const SHORT_KEYS = ['llm.identityAnchor', 'llm.delegateUseIt', 'llm.modelLine', 'shejiao.hint', 'model.kindHint.fenLei', 'settings.skillsHotReload', 'model.kindHint.imageUnd', 'model.kindHint.chat', 'model.kindHint.reasoning'];

if (!KEY_FILE || !fs.existsSync(KEY_FILE)) { console.error('请设置 WARMY_MIMO_KEY_FILE（第一行是密钥）'); process.exit(2); }
const KEY = fs.readFileSync(KEY_FILE, 'utf8').split(/\r?\n/)[0].trim();
if (!KEY) { console.error('密钥文件第一行为空'); process.exit(2); }

const langs = process.argv.slice(2).filter((x) => NAMES[x]);
const targets = langs.length ? langs : Object.keys(NAMES);
const readJson = (l) => JSON.parse(fs.readFileSync(path.join(I18N, l + '.json'), 'utf8'));
const zh = readJson('zh-CN');

async function chat(system, user, maxTokens = 8000) {
  const r = await fetch(BASE + '/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, temperature: 0.1, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    signal: AbortSignal.timeout(240000),
  });
  const j = await r.json().catch(() => null);
  const out = String(j?.choices?.[0]?.message?.content || '').trim();
  if (!r.ok || !out) throw new Error('http-' + r.status + ' ' + String(j?.error?.message || '').slice(0, 120));
  return out.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim();
}

function setLineKey(src, key, value) {
  const lines = src.split('\n');
  const prefix = '  ' + JSON.stringify(key) + ':';
  const idx = lines.findIndex((l) => l.startsWith(prefix));
  if (idx < 0) throw new Error('key-not-found ' + key);
  const comma = /,\s*$/.test(lines[idx]) ? ',' : '';
  lines[idx] = prefix + ' ' + JSON.stringify(value) + comma;
  return lines.join('\n');
}

function normalizeContact(text, about) {
  const lines = text.split('\n');
  const idx = lines.map((l, i) => (l.includes('Public@numumu.com') || l.includes('232307860@qq.com') ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return text.trimEnd() + '\n\n' + about;
  lines[idx[0]] = about;
  for (const i of idx.slice(1).reverse()) lines.splice(i, 1);
  return lines.join('\n');
}

const legalSys = (name) => `You are a professional legal/technical translator. Translate the user's Simplified Chinese privacy-and-terms text into ${name}. `
  + `Keep ALL 13 numbered sections and their order; do not add, remove, merge, summarize or soften any promise. `
  + `Use Arabic numerals (1., 2., ... 13.) for section numbers. Do NOT leave Chinese characters in the output; the only exception is the product name 无限牛马 (you may render it as WArmy instead). `
  + `Translate ordinary Chinese words (e.g. 局域网 = local network, 牛马 = workhorse); do not copy them. `
  + `Keep emails, URLs, product names (WArmy, FWArmy, Ollama, GitHub, Hugging Face, Windows, macOS, Linux) unchanged. `
  + `Output only the translation, no commentary, no code fences, no extra headings.`;
const shortSys = (name) => `Translate each JSON value into ${name}. Keep the JSON keys unchanged and keep placeholders like {ming} and {model} exactly. Output only one JSON object, no code fences.`;

let changed = 0;
for (const lang of targets) {
  const name = NAMES[lang];
  const pack = readJson(lang);
  const about = String(pack['about.contactBody'] || '');
  if (!about.includes('232307860@qq.com')) { console.log(`${lang}: 跳过（about.contactBody 不是标准联系方式）`); continue; }
  try {
    console.log(`${lang}: 翻译法律全文…`);
    const legalCheck = (s) => s.length >= 1200 && (s.match(/Public@numumu\.com/g) || []).length === 1
      && s.includes('232307860@qq.com') && s.includes('https://github.com/Pondsi/WArmy')
      && (['ja', 'ko', 'zh-TW'].includes(lang) || !/[\u4e00-\u9fff]/.test(s.replace(/无限牛马/g, '')));
    let legal = '';
    for (let attempt = 1; attempt <= 2; attempt++) {
      legal = normalizeContact(await chat(legalSys(name), String(zh['privacy.body'] || '')), about);
      if (legalCheck(legal)) break;
      console.log(`${lang}: 第 ${attempt} 次译文不合格（长度/联系方式/残留中文），重试…`);
    }
    if (!legalCheck(legal)) throw new Error('legal-shape-check-failed len=' + legal.length);
    console.log(`${lang}: 翻译 ${SHORT_KEYS.length} 个提示词片段…`);
    const en = readJson('en-US');
    const src = Object.fromEntries(SHORT_KEYS.map((k) => [k, String(en[k] || '')]));
    let got = null;
    for (let attempt = 1; attempt <= 2 && !got; attempt++) {
      try {
        const raw = await chat(shortSys(name), JSON.stringify(src), 4000);
        const j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
        for (const k of SHORT_KEYS) {
          const v = String(j[k] || '').trim();
          if (!v) throw new Error('short-empty ' + k);
          for (const ph of ['{ming}', '{model}']) {
            if (src[k].includes(ph) && !v.includes(ph)) throw new Error('placeholder-lost ' + k + ' ' + ph);
          }
        }
        got = j;
      } catch (e) {
        console.log(`${lang}: 提示词片段第 ${attempt} 次不合格 ← ${String(e && e.message || e).slice(0, 120)}`);
      }
    }
    if (!got) throw new Error('short-translation-failed');
    if (APPLY) {
      let text = fs.readFileSync(path.join(I18N, lang + '.json'), 'utf8');
      for (const k of ['privacy.body', 'privacy.ti']) text = setLineKey(text, k, legal);
      for (const k of SHORT_KEYS) text = setLineKey(text, k, String(got[k]).trim());
      fs.writeFileSync(path.join(I18N, lang + '.json'), text);
      changed += 1;
      console.log(`${lang}: 已写入`);
    } else {
      console.log(`${lang}: dry-run 通过（legal ${legal.length} 字符）`);
    }
  } catch (e) {
    console.log(`${lang}: 失败，未写入 ← ${String(e && e.message || e).slice(0, 200)}`);
  }
}
console.log(`完成：${changed} 个语言写入${APPLY ? '' : '（dry-run）'}`);
