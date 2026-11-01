/**
 * 认知预设多语言流水线（第 57 轮 · 方案 A：分批机器翻译 + 校验）。
 *
 * 用法：
 *   node dev/i18n/translate-personas.mjs --lang=en-US --field=name,sub
 *   node dev/i18n/translate-personas.mjs --lang=all --field=name,sub --concurrency=2
 *   node dev/i18n/translate-personas.mjs --lang=ja --field=content --batch=4   （正文，慢）
 *
 * 设计（为什么这样才可靠）：
 *  · **可续跑**：每翻完一批就写盘（`src/i18n/persona/<lang>.json`），进度写在 `persona/<lang>.progress.json`；
 *    中断后重跑只补缺的 id，不会重复烧钱。
 *  · **术语表**：`dev/i18n/persona-glossary.json`（可选）里的固定译法会拼进提示词，保证跨批次一致
 *    （行业做法：glossary + translation memory，别让模型每批自由发挥）。
 *  · **确定性校验**：每批结果必须能 JSON.parse、id 不多不少、字段非空、长度比在 0.4–3.0、拉丁/西里尔语言不许残留汉字；
 *    不合格的条目留在待办里（下一轮重试），**绝不把坏数据写进可用文件**。
 *  · **不碰中文基线**：zh-CN 直接跳过（原文就是中文）；zh-TW 由模型转写（用语按台湾用法）。
 *
 * 注意：密钥只从 `MIMO_KEY_FILE` 的第一行读，绝不打印、绝不落盘。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const I18N = path.join(ROOT, 'packages/app-shell/src/i18n');
const OUT = path.join(I18N, 'persona');
const BASE = 'https://token-plan-cn.xiaomimimo.com/v1/chat/completions';
const MODEL = process.env.MIMO_MODEL || 'mimo-v2.6-flash';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)=(.*)$/.exec(a);
  return m ? [m[1], m[2]] : [a.replace(/^--/, ''), '1'];
}));
const LANG = String(args.lang || 'en-US');
const FIELDS = String(args.field || 'name,sub').split(',').map((x) => x.trim()).filter(Boolean);
const BATCH = Math.max(1, Number(args.batch) || (FIELDS.includes('content') ? 3 : 20));
const CONC = Math.max(1, Math.min(3, Number(args.concurrency) || 2));
const LANGS = LANG === 'all'
  ? ['zh-TW', 'en-US', 'ja', 'ko', 'fr', 'es', 'pt', 'ru', 'eo']
  : [LANG];

function duMiYao() {
  const f = process.env.MIMO_KEY_FILE;
  if (!f) throw new Error('没有 MIMO_KEY_FILE');
  const s = fs.readFileSync(f, 'utf8').split(/\r?\n/).map((x) => x.trim()).filter(Boolean)[0];
  if (!s) throw new Error('MIMO_KEY_FILE 第一行是空的');
  return s;
}
function duMoBan() {
  const p = path.join(ROOT, 'packages/app-shell/src/renderer/persona-templates.js');
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(p, 'utf8'), ctx);
  const groups = ctx.window.__PERSONA_TPL || {};
  const items = [];
  for (const cat of Object.keys(groups)) for (const x of groups[cat]) items.push({ id: x.id, cat, sub: x.sub, name: x.name, content: x.content });
  return items;
}
const YU_MING = { 'zh-TW': 'Traditional Chinese (Taiwan usage)', 'en-US': 'English', ja: 'Japanese', ko: 'Korean', fr: 'French', es: 'Spanish', pt: 'Portuguese', ru: 'Russian', eo: 'Esperanto' };
const LIU_HAN = ['zh-CN'].includes; // 只为可读性占位
function youHan(wen) { return /[\u3400-\u9fff]/.test(String(wen || '')); }
function changDuBi(yuan, yi) { const a = String(yuan || '').length || 1; return String(yi || '').length / a; }

const GLOSSARY = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'dev/i18n/persona-glossary.json'), 'utf8')); } catch { return {}; }
})();

async function fanYi(key, lang, batch, zhongWen) {
  const gu = GLOSSARY[lang] || {};
  const guWen = Object.keys(gu).length ? '\nTerminology (must use): ' + Object.entries(gu).map(([a, b]) => `${a}=${b}`).join('; ') : '';
  const sys = `You are a professional localizer for an AI-agent product. Translate the given Chinese template metadata into ${YU_MING[lang] || lang}.` +
    ` Rules: keep the meaning; be concise (similar length); for a two-part name keep the "·" separator; no quotes around values; no explanations; NEVER leave Chinese characters in the output (transliterate names and terms into the target script).` + guWen +
    `\nOutput ONLY a JSON object mapping each input id to an object containing exactly the requested fields (${FIELDS.join(', ')}).`;
  const user = JSON.stringify(Object.fromEntries(batch.map((x) => [x.id, Object.fromEntries(FIELDS.map((f) => [f, x[f]]))])));
  for (let t = 0; t < 3; t++) {
    const r = await fetch(BASE, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, temperature: 0, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] }),
      /** 网络挂起必须能自己醒来：没有超时会把整条流水线永久卡死（本轮真踩到） */
      signal: AbortSignal.timeout(180_000),
    });
    if (!r.ok) { if (r.status === 429 || r.status >= 500) { await new Promise((z) => setTimeout(z, 1500 * (t + 1))); continue; } throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 160)); }
    const j = await r.json();
    const txt = String(j?.choices?.[0]?.message?.content || '');
    const m = /\{[\s\S]*\}/.exec(txt);
    if (!m) continue;
    try { return JSON.parse(m[0]); } catch { /* 下一轮重试 */ }
  }
  throw new Error('模型没给出可解析的 JSON');
}

async function pao(lang) {
  if (lang === 'zh-CN') return;
  fs.mkdirSync(OUT, { recursive: true });
  const chuP = path.join(OUT, lang + '.json');
  const jinP = path.join(OUT, lang + '.progress.json');
  const quan = duMoBan();
  const chu = fs.existsSync(chuP) ? JSON.parse(fs.readFileSync(chuP, 'utf8')) : {};
  const jin = fs.existsSync(jinP) ? JSON.parse(fs.readFileSync(jinP, 'utf8')) : { done: [] };
  const yi = new Set(jin.done || []);
  const dai = quan.filter((x) => FIELDS.some((f) => !chu[x.id] || !String(chu[x.id][f] || '').trim()) && !yi.has(x.id + ':' + FIELDS.join(',')));
  console.log(`[${lang}] 待翻 ${dai.length} / ${quan.length}，每批 ${BATCH}，并发 ${CONC}`);
  let i = 0, hao = 0, huai = 0;
  const key = duMiYao();

  const cunPan = () => {
    /** 并发 worker 不能共用同一个 .tmp：Windows 上 rename 会 EPERM（本轮 zh-TW 真踩到） */
    const tmp = chuP + '.' + process.pid + '.' + Math.random().toString(36).slice(2) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(chu, null, 1), 'utf8');
    for (let t = 0; t < 6; t++) {
      try { fs.renameSync(tmp, chuP); break; } catch (e) {
        if (t === 5) {
          /** 极端情况下 rename 被占用：直接覆盖写一次，至少不丢已翻好的条目 */
          fs.writeFileSync(chuP, JSON.stringify(chu, null, 1), 'utf8');
          try { fs.rmSync(tmp, { force: true }); } catch { /* noop */ }
          break;
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30 * (t + 1));
      }
    }
    fs.writeFileSync(jinP, JSON.stringify({ done: [...yi] }, null, 0), 'utf8');
  };
  /** 单条校验；不合格返回原因（便于日志定位，绝不把坏数据写进可用文件） */
  const jiaoYan = (x, o) => {
    if (!o || typeof o !== 'object') return { ok: false, why: 'missing' };
    const xie = {};
    for (const f of FIELDS) {
      const v = String(o[f] || '').trim();
      if (!v) return { ok: false, why: `${f}:empty` };
      if (youHan(v) && !['zh-TW', 'ja', 'ko'].includes(lang)) return { ok: false, why: `${f}:cjk` };
      const bi = changDuBi(x[f], v);
      /**
       * 中文 → 拉丁/西里尔通常涨 3–5 倍字符；正文按 0.2–6 卡。
       * 短名/副标题不能只按正文倍数：中文「店长」2 字，英文 "Store Manager" 13 字（6.5×）是合格译文，
       * 「冷链储运」4 字译成 "Cold Chain Storage & Transport" 也超过 6×。短字段单独放宽到 12×。
       */
      const xia = 0.2;
      const shang = f === 'content' ? 6.0 : 12.0;
      if (bi < xia || bi > shang) return { ok: false, why: `${f}:ratio=${bi.toFixed(2)}` };
      xie[f] = v;
    }
    return { ok: true, xie };
  };
  /**
   * 一批失败时**二分重试**：整批 JSON 解析失败/漏条目是很常见的模型行为，
   * 老实现把整批 20 条都记成失败，导致 242/330 这种大批缺口。现在 20→10→5→2→1
   * 逐层缩小，只把真正译不出的单条留在待办里。
   */
  const chongShi = async (pi, shen) => {
    if (!pi.length) return;
    let r;
    try {
      r = await fanYi(key, lang, pi, '');
    } catch (e) {
      if (pi.length > 1 && shen < 6) {
        const ban = Math.ceil(pi.length / 2);
        await chongShi(pi.slice(0, ban), shen + 1);
        await chongShi(pi.slice(ban), shen + 1);
      } else {
        huai++;
        console.log(`[${lang}] 单条失败 ${pi[0].id}：` + String(e).slice(0, 120));
      }
      return;
    }
    const huaiTiao = [];
    for (const x of pi) {
      const j = jiaoYan(x, r && r[x.id]);
      if (!j.ok) { huaiTiao.push({ x, why: j.why }); continue; }
      chu[x.id] = { ...(chu[x.id] || {}), ...j.xie };
      yi.add(x.id + ':' + FIELDS.join(','));
      hao++;
    }
    if (huaiTiao.length && pi.length > 1 && shen < 6) {
      const ban = Math.ceil(huaiTiao.length / 2);
      await chongShi(huaiTiao.slice(0, ban).map((z) => z.x), shen + 1);
      await chongShi(huaiTiao.slice(ban).map((z) => z.x), shen + 1);
      return;
    }
    for (const z of huaiTiao) {
      huai++;
      console.log(`[${lang}] 单条不合格 ${z.x.id}：${z.why}`);
    }
    cunPan();
  };

  const gong = async () => {
    let shangCi = 0;
    while (i < dai.length) {
      const pi = dai.slice(i, i + BATCH); i += BATCH;
      await chongShi(pi, 0);
      cunPan();
      if (i - shangCi >= BATCH * 10 || i >= dai.length) {
        shangCi = i;
        console.log(`[${lang}] 进度 ${Math.min(i, dai.length)}/${dai.length}（成功 ${hao}，失败/不合格 ${huai}）`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONC }, gong));
  console.log(`[${lang}] 完成：成功 ${hao}，失败/不合格 ${huai}，累计条目 ${Object.keys(chu).length}`);
}

for (const l of LANGS) {
  try { await pao(l); } catch (e) { console.log('[' + l + '] 中止：' + String(e).slice(0, 160)); }
}
