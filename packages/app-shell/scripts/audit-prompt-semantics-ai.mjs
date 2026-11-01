#!/usr/bin/env node
/**
 * 提示词大意审计（#26 后续）：逐语言把「道/术」与中文源对比，找漏条、增条、反义/承诺漂移。
 *
 * 用法：WARMY_MIMO_KEY_FILE=<密钥文件> node packages/app-shell/scripts/audit-prompt-semantics-ai.mjs [lang ...]
 * 输出：每语言每层 {ok, issues[]}；不写任何文件。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const KEY_FILE = String(process.env.WARMY_MIMO_KEY_FILE || '').trim();
const BASE = String(process.env.WARMY_MIMO_BASE || 'https://token-plan-cn.xiaomimimo.com/v1').replace(/\/+$/, '');
const MODEL = String(process.env.WARMY_MIMO_MODEL || 'mimo-v2.6-flash');
const M = await import(pathToFileURL(path.resolve(ROOT, 'packages/app-shell/dist/mo-ren-yu-yan/index.js')).href);
const zhDao = String(M.MO_REN_YU_YAN['zh-CN'].dao || '');
const zhShu = String(M.MO_REN_YU_YAN['zh-CN'].shu || '');
const NAMES = { 'zh-TW': '繁體中文', 'en-US': 'English', ja: '日本語', ko: '한국어', fr: 'français', es: 'español', pt: 'português', ru: 'русский', eo: 'Esperanto' };

async function chat(system, user) {
  const key = fs.readFileSync(KEY_FILE, 'utf8').split(/\r?\n/)[0].trim();
  const r = await fetch(BASE + '/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, temperature: 0, max_tokens: 3000, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    signal: AbortSignal.timeout(180000),
  });
  const j = await r.json().catch(() => null);
  const out = String(j?.choices?.[0]?.message?.content || '').trim();
  if (!r.ok || !out) throw new Error('http-' + r.status);
  return out;
}

const langs = process.argv.slice(2).filter((x) => NAMES[x]);
const targets = langs.length ? langs : Object.keys(NAMES);
for (const lang of targets) {
  const pack = M.MO_REN_YU_YAN[lang] || {};
  for (const [ceng, src, dst] of [['道', zhDao, String(pack.dao || '')], ['术', zhShu, String(pack.shu || '')]]) {
    try {
      const sys = `You audit translations. Compare the Chinese ${ceng} with its ${NAMES[lang]} translation. `
        + `Check: all numbered items/headings present and in order; no added promises; no softened prohibitions; no reversed meaning; no omitted exception. `
        + `Output ONLY JSON: {"ok":true|false,"issues":["..."],"score":0-100}. Max 6 issues, each one short sentence.`;
      const raw = await chat(sys, JSON.stringify({ chinese: src, translation: dst }));
      const j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
      console.log(`${lang} ${ceng}: score=${j.score} ok=${j.ok} issues=${JSON.stringify(j.issues || []).slice(0, 500)}`);
    } catch (e) {
      console.log(`${lang} ${ceng}: AUDIT-FAIL ${String(e && e.message || e).slice(0, 160)}`);
    }
  }
}
