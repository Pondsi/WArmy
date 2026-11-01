/**
 * 第 90 轮：10 种语言 × 所有默认提示词 × 10 轮全量检查。
 *
 * 判据：
 *  ① 每层上限在 10 种语言下都与 zh-CN **完全相同**（不再按语言折算；总量闸也按原始字符）；
 *  ② 所有按语言分发的默认提示词都在对应上限内：道/术 10 语言、认知预设 2200 条 × 9 个 JSON + zh-CN；
 *  ③ 中文保持完整结构；其它语言保留全部章节与主要条目；
 *  ④ 每轮重新 import dist、重新读 JSON，避免缓存掩盖问题；每轮同时跑 r78/r54。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LANGS = ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko', 'fr', 'es', 'pt', 'ru', 'eo'];
const PJSON = ['en-US', 'eo', 'es', 'fr', 'ja', 'ko', 'pt', 'ru', 'zh-TW'];
const U = (rel) => pathToFileURL(path.join(ROOT, rel)).href;
const load = async (rel) => import(U(rel) + '?r=' + Math.random().toString(36).slice(2));
const errors = [];
const fail = (round, msg) => errors.push(`round ${round}: ${msg}`);

for (let round = 1; round <= 10; round++) {
  const TX = await load('packages/app-shell/dist/ti-shi-shang-xian.js');
  const MY = await load('packages/app-shell/dist/mo-ren-yu-yan/index.js');
  const layers = Object.keys(TX.TI_SHI_SHANG_XIAN);
  let capsEqual = 0;
  for (const l of layers) for (const lang of LANGS) {
    if (TX.shangXianOf(l, lang) === TX.shangXianOf(l, 'zh-CN')) capsEqual++;
    else fail(round, `cap ${l}/${lang}=${TX.shangXianOf(l, lang)} != zh=${TX.shangXianOf(l, 'zh-CN')}`);
  }
  if (LANGS.some((l) => TX.YU_YAN_ZI_SHU_BEI_LV[l] !== 1)) fail(round, 'language factor != 1');

  const daoMax = Math.max(...LANGS.map((l) => MY.MO_REN_YU_YAN[l].dao.length));
  const shuMax = Math.max(...LANGS.map((l) => MY.MO_REN_YU_YAN[l].shu.length));
  for (const l of LANGS) {
    const x = MY.MO_REN_YU_YAN[l];
    if (!x || !x.dao || !x.shu) fail(round, `${l} missing dao/shu`);
    if (x.dao.length > TX.shangXianOf('道', l)) fail(round, `${l} dao ${x.dao.length}>${TX.shangXianOf('道', l)}`);
    if (x.shu.length > TX.shangXianOf('术', l)) fail(round, `${l} shu ${x.shu.length}>${TX.shangXianOf('术', l)}`);
    const jd = (x.dao.match(/^## /gm) || []).length, td = (x.dao.match(/^\d+\. /gm) || []).length;
    const js = (x.shu.match(/^## /gm) || []).length, ts = (x.shu.match(/^\d+\. /gm) || []).length;
    if (l === 'zh-CN' || l === 'zh-TW') {
      if (jd !== 6 || td !== 43 || js !== 4 || ts !== 25) fail(round, `${l} structure ${jd}/${td} ${js}/${ts}`);
    } else if (jd < 6 || td < 8 || js < 4 || ts < 10) fail(round, `${l} condensed structure ${jd}/${td} ${js}/${ts}`);
  }

  let personaMax = 0, personaEntries = 0;
  for (const l of PJSON) {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/app-shell/dist/i18n/persona', l + '.json'), 'utf8'));
    const vals = Object.values(j);
    if (vals.length !== 2200) fail(round, `${l} persona count ${vals.length}`);
    for (const v of vals) {
      const s = v && typeof v.content === 'string' ? v.content : '';
      if (!s.trim()) { fail(round, `${l} empty persona content`); break; }
      if (s.length > 1600) { fail(round, `${l} persona ${s.length}>1600`); break; }
      if (s.length > personaMax) personaMax = s.length;
      personaEntries++;
    }
  }
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'packages/app-shell/dist/renderer/persona-templates.js'), 'utf8'), ctx, { timeout: 5000 });
  let zhPersona = 0, zhMax = 0;
  for (const arr of Object.values(ctx.window.__PERSONA_TPL || {})) for (const x of arr || []) {
    const s = x && x.content ? String(x.content) : '';
    if (!s) fail(round, 'zh-CN empty persona');
    if (s.length > 1600) fail(round, `zh-CN persona ${s.length}>1600`);
    zhPersona++;
    if (s.length > zhMax) zhMax = s.length;
  }
  if (zhPersona !== 2200) fail(round, `zh-CN persona count ${zhPersona}`);

  const main = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/electron-main.ts'), 'utf8');
  if (!/const zong = ming\.reduce\(\(n, m\) => n \+ m\.ziShu, 0\)/.test(main)) fail(round, 'total cap not raw chars');

  const r78 = spawnSync(process.execPath, ['dev/gates/verify-r78-prompt-limits.mjs'], { cwd: ROOT, encoding: 'utf8' });
  const r54 = spawnSync(process.execPath, ['packages/app-shell/scripts/verify-r54-i18n-defaults.mjs'], { cwd: ROOT, encoding: 'utf8' });
  if (r78.status !== 0) fail(round, 'verify-r78 failed\n' + (r78.stdout || '').split('\n').filter((x) => x.includes('FAIL')).join('\n'));
  if (r54.status !== 0) fail(round, 'verify-r54 failed\n' + (r54.stdout || '').split('\n').filter((x) => x.includes('FAIL')).join('\n'));

  console.log(`round ${round}: capsEqual=${capsEqual}/${layers.length * LANGS.length}, daoMax=${daoMax}, shuMax=${shuMax}, personaMax=${personaMax}, personaEntries=${personaEntries}, zhPersona=${zhPersona}/${zhMax}, r78=${r78.status === 0 ? 'ok' : 'FAIL'}, r54=${r54.status === 0 ? 'ok' : 'FAIL'}`);
}
if (errors.length) {
  console.log('\nFAILURES:');
  for (const e of errors.slice(0, 40)) console.log('  ' + e);
  process.exit(1);
}
console.log('\nALL 10 ROUNDS PASSED');