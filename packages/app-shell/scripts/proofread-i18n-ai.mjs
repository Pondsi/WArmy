#!/usr/bin/env node
/**
 * #109 模型逐条校对（受控）：只改措辞，不改键/占位符/结构/专名/联系方式。
 *
 * 用法（默认 dry-run，只打印 diff，不写文件）：
 *   WARMY_MIMO_KEY_FILE=<密钥文件> node packages/app-shell/scripts/proofread-i18n-ai.mjs [--apply] [lang ...]
 *
 * 默认校对 10 个高价值键：privacy.body/ti + 9 个 llm.* 提示词片段。
 * 任何一条校验不过 ⇒ 整批不写；模型不许新增/删除键。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const I18N = path.join(ROOT, 'packages/app-shell/src/i18n');
const KEYS = ['privacy.body', 'privacy.ti', 'llm.identityAnchor', 'llm.delegateUseIt', 'llm.modelLine', 'shejiao.hint', 'model.kindHint.fenLei', 'settings.skillsHotReload', 'model.kindHint.imageUnd', 'model.kindHint.chat', 'model.kindHint.reasoning'];
const LANGS = ['zh-TW', 'en-US', 'ja', 'ko', 'fr', 'es', 'pt', 'ru', 'eo'];
const NAMES = { 'zh-TW': '繁體中文', 'en-US': 'English', ja: '日本語', ko: '한국어', fr: 'français', es: 'español', pt: 'português', ru: 'русский', eo: 'Esperanto' };

/** 纯函数：一批校对结果的硬校验（门禁可直接调用，不需要网络） */
export function validateProofread(src, got, opts = {}) {
  const problems = [];
  if (!got || typeof got !== 'object' || Array.isArray(got)) return ['not-object'];
  const a = Object.keys(src).sort(); const b = Object.keys(got).sort();
  if (JSON.stringify(a) !== JSON.stringify(b)) problems.push('keys-changed');
  const ph = (s) => (String(s).match(/\{[a-zA-Z0-9_]+\}/g) || []).sort().join(',');
  for (const k of a) {
    const before = String(src[k] ?? ''); const after = String(got[k] ?? '');
    if (!after.trim()) problems.push('empty:' + k);
    if (ph(before) !== ph(after)) problems.push('placeholder:' + k);
    if (/Public@numumu\.com/.test(before) && !/Public@numumu\.com/.test(after)) problems.push('contact:' + k);
    if (/https?:\/\//.test(before) && !/https?:\/\//.test(after)) problems.push('url:' + k);
    const max = opts.maxLen && opts.maxLen[k];
    if (max && after.length > max) problems.push('too-long:' + k);
    if (after.length > before.length * 2 + 200) problems.push('growth:' + k);
  }
  return problems;
}

const KEY_FILE = String(process.env.WARMY_MIMO_KEY_FILE || '').trim();
const BASE = String(process.env.WARMY_MIMO_BASE || 'https://token-plan-cn.xiaomimimo.com/v1').replace(/\/+$/, '');
const MODEL = String(process.env.WARMY_MIMO_MODEL || 'mimo-v2.6-flash');
const APPLY = process.argv.includes('--apply');
const langs = process.argv.slice(2).filter((x) => NAMES[x]);
const targets = langs.length ? langs : LANGS;

async function chat(system, user, maxTokens = 16000) {
  const key = fs.readFileSync(KEY_FILE, 'utf8').split(/\r?\n/)[0].trim();
  const r = await fetch(BASE + '/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, temperature: 0.1, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    signal: AbortSignal.timeout(240000),
  });
  const j = await r.json().catch(() => null);
  const out = String(j?.choices?.[0]?.message?.content || '').trim();
  if (!r.ok || !out) throw new Error('http-' + r.status);
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

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  if (!KEY_FILE || !fs.existsSync(KEY_FILE)) { console.error('请设置 WARMY_MIMO_KEY_FILE'); process.exit(2); }
  let changed = 0;
  for (const lang of targets) {
    const p = path.join(I18N, lang + '.json');
    const pack = JSON.parse(fs.readFileSync(p, 'utf8'));
    const src = Object.fromEntries(KEYS.filter((k) => typeof pack[k] === 'string').map((k) => [k, pack[k]]));
    if (!Object.keys(src).length) continue;
    const name = NAMES[lang];
    const sys = `You are a meticulous proofreader. Proofread the JSON values into ${name}. `
      + `Only fix grammar, wording and consistency. Do NOT change keys, numbers, URLs, emails, product names (WArmy, FWArmy, Ollama, GitHub, Hugging Face, Ed25519, BIP-39), or placeholders like {ming}/{model}. `
      + `Do NOT add, remove, merge or soften any promise. Output only one JSON object with exactly the same keys.`;
    try {
      console.log(`${lang}: 校对 ${Object.keys(src).length} 个键…`);
      const raw = await chat(sys, JSON.stringify(src));
      const got = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
      const bad = validateProofread(src, got);
      if (bad.length) { console.log(`${lang}: 拒绝写入 ← ${bad.join(', ')}`); continue; }
      const diff = Object.keys(src).filter((k) => src[k] !== got[k]);
      console.log(`${lang}: ${diff.length} 个键有改动${diff.length ? '：' + diff.join(', ') : ''}`);
      if (APPLY && diff.length) {
        let text = fs.readFileSync(p, 'utf8');
        for (const k of diff) text = setLineKey(text, k, String(got[k]));
        fs.writeFileSync(p, text);
        changed += 1;
      }
    } catch (e) {
      console.log(`${lang}: 失败，未写入 ← ${String(e && e.message || e).slice(0, 160)}`);
    }
  }
  console.log(`完成：${changed} 个语言写入${APPLY ? '' : '（dry-run）'}`);
}
