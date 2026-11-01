/**
 * verify-r56-preset-i18n.mjs（fast 档）—— 第 56 轮项 3：认知预设分类/默认牛马名的 10 语言版本。
 *
 * 不做整库翻译的**假承诺**：分类名（下拉框可见）与 51 个内置牛马模板名先落地；
 * 2200 条认知模板的正文仍是中文（分批翻译，见交接 §44）。判据只钉"已经承诺的那部分真的齐、真的不是占位"。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DIR = path.join(ROOT, 'packages/app-shell/src/i18n');
const YU_YAN = ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko', 'fr', 'es', 'pt', 'ru', 'eo'];
const CATS = ['office', 'code', 'teacher', 'research', 'law', 'medical', 'agri', 'home', 'politics', 'sociology', 'writing', 'psych', 'friend'];

const niu = (() => {
  const s = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/niu-ma-templates.js'), 'utf8');
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(s, ctx);
  return ctx.window.__NIU_MA_TEMPLATES;
})();
const WORKERS = niu.map((x) => x.id);

let okN = 0, failN = 0;
const jian = (l, p, d) => { if (p) { okN++; console.log('  ok  ' + l); } else { failN++; console.log('  FAIL ' + l + (d ? ' ← ' + String(d).slice(0, 160) : '')); } };

const packs = {};
for (const l of YU_YAN) packs[l] = JSON.parse(fs.readFileSync(path.join(DIR, l + '.json'), 'utf8'));

const que = [];
for (const l of YU_YAN) {
  for (const c of CATS) if (!String(packs[l]['preset.cat.' + c] || '').trim()) que.push(`${l}:cat.${c}`);
  for (const w of WORKERS) if (!String(packs[l]['preset.worker.' + w] || '').trim()) que.push(`${l}:worker.${w}`);
}
jian('10 种语言 ×（13 个分类 + 51 个牛马模板名）全部存在且非空', que.length === 0, que.slice(0, 8).join(', '));

{
  /**
   * 只对**非汉字语言**要求"与中文不同"：日语/韩语/繁体里有些分类名本来就该是同样的汉字（社会学研究/家政生活），
   * 强行要求不同会逼出假翻译。拉丁/西里尔语言若与中文一模一样，才是占位。
   */
  const FEI_HAN = ['en-US', 'fr', 'es', 'pt', 'ru', 'eo'];
  const yiyang = [];
  for (const l of FEI_HAN) {
    for (const c of CATS) {
      const z = String(packs['zh-CN']['preset.cat.' + c] || '');
      const v = String(packs[l]['preset.cat.' + c] || '');
      if (v === z) yiyang.push(`${l}:${c}`);
    }
  }
  jian('拉丁/西里尔语言的分类名不是中文原样照抄（占位会当场红）', yiyang.length === 0, yiyang.slice(0, 8).join(', '));
}
jian('牛马模板名保留"角色·别称"两段结构（丢了别称 = 翻译不完整）',
  YU_YAN.every((l) => WORKERS.every((w) => String(packs[l]['preset.worker.' + w] || '').includes('·'))));

jian('渲染层分类下拉用翻译键（不是直接显示中文对象键）',
  /const CAT_ID = \{ '办公专业': 'office'/.test(fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/app.js'), 'utf8'))
  && /catMing\(cat\)/.test(fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/app.js'), 'utf8')));
jian('键名与 i18n 语言包同键（10 个包都在）', YU_YAN.length === 10 && YU_YAN.every((l) => packs[l] && typeof packs[l] === 'object'));

console.log(`==== verify-r56-preset-i18n: ${okN} ok / ${failN} FAIL ====`);
process.exit(failN ? 1 : 0);
