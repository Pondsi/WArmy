/**
 * 一次性：给全部语言包补 `llm.delegateUseIt`（能力转交结果的使用约束）。
 * 幂等。为什么必须补齐：`verify-i18n-locales` 要求各语言包**键集合完全一致**。
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = 'packages/app-shell/src/i18n';
const ZH = '\n（上面这些子任务**已经由本机的专业模型替你完成**了：请**直接用这些结果**回答用户。不要再说"我看不了图 / 我读不了音频 / 我没有这个能力"——那是事实错误，能力已经由子任务补齐。若结果本身不足以回答，就说明缺什么。）';
const EN = '\n(These sub-tasks have **already been completed for you by this machine\'s specialist models**: answer the user **using those results directly**. Do not say "I cannot see images / cannot read audio / I lack that capability" — that is factually wrong, the capability was filled in by the sub-task. If the results are not enough, say what is missing.)';

const MAP = { 'zh-CN': ZH, 'zh-TW': ZH, ja: EN, ko: EN, fr: EN, es: EN, pt: EN, ru: EN, eo: EN, 'en-US': EN };

let n = 0;
for (const [loc, val] of Object.entries(MAP)) {
  const f = path.join(DIR, `${loc}.json`);
  const pack = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (pack['llm.delegateUseIt'] === val) { console.log(`skip ${loc}`); continue; }
  pack['llm.delegateUseIt'] = val;
  fs.writeFileSync(f, JSON.stringify(pack, null, 2) + '\n', 'utf8');
  console.log(`patched ${loc}`);
  n++;
}
console.log(`done ${n}`);
