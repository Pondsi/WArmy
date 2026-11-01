/** 10-language default prompt limits: dao/shu and persona presets must stay within their layer caps. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TX = await import(pathToFileURL(path.join(ROOT, 'packages/app-shell/dist/ti-shi-shang-xian.js')).href);
const M = await import(pathToFileURL(path.join(ROOT, 'packages/app-shell/dist/mo-ren-yu-yan/index.js')).href);
const LANGS = ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko', 'fr', 'es', 'pt', 'ru', 'eo'];
let okN = 0, failN = 0;
const ok = (m) => { okN++; console.log('  ok  ' + m); };
const bad = (m) => { failN++; console.log('  FAIL ' + m); };
for (const lang of LANGS) {
  for (const [key, ceng] of [['dao', '道'], ['shu', '术']]) {
    const text = String((M.MO_REN_YU_YAN[lang] || {})[key] || '');
    const r = TX.chaoShangXian(ceng, text, lang);
    (text && !r.chao ? ok : bad)(`${lang} ${ceng} ${r.ziShu}/${r.shangXian}`);
  }
}
for (const file of fs.readdirSync(path.join(ROOT, 'packages/app-shell/src/i18n/persona')).filter((x) => x.endsWith('.json') && !x.includes('.progress'))) {
  const lang = file.replace('.json', '');
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/i18n/persona', file), 'utf8'));
  const over = Object.entries(data).filter(([, v]) => String(v?.content || '').length > TX.shangXianOf('认知', lang));
  (over.length === 0 ? ok : bad)(`${lang} persona ${Object.keys(data).length} presets within 认知 ${TX.shangXianOf('认知', lang)}` + (over.length ? ' over: ' + over.map(([k]) => k).join(',') : ''));
}
console.log(`\nverify-r78-prompt-limits: ${okN} ok / ${failN} FAIL`);
process.exitCode = failN ? 1 : 0;
