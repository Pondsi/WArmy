/**
 * verify-r54-i18n-defaults.mjs（fast 档）—— 第 54 轮项 1「默认文字 10 种语言 + 切语言跟着变」。
 *
 * 判据分三层：
 *  ① **内容**：10 种语言的道/术都齐全、结构一致（道 6 节 43 条 / 术 4 节 25 条）、零空行、无反引号；
 *  ② **上限**：每种语言的正文都在**该语言折算后**的上限内（否则自愈会把规则搬走 —— 那是"翻译害的"）；
 *  ③ **切换语义**：只有"内容仍是任一语言出厂稿"的层才跟着换；用户改过的必须保持原样（改用户的字比不翻译更糟）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const U = (f) => pathToFileURL(path.join(ROOT, f)).href;
const MY = await import(process.env.V54_IDX ? pathToFileURL(process.env.V54_IDX).href : U('packages/app-shell/dist/mo-ren-yu-yan/index.js'));
const TX = await import(process.env.V54_TX ? pathToFileURL(process.env.V54_TX).href : U('packages/app-shell/dist/ti-shi-shang-xian.js'));
const MAIN = fs.readFileSync(process.env.V54_MAIN || path.join(ROOT, 'packages/app-shell/src/electron-main.ts'), 'utf8');

let okN = 0, failN = 0;
const jian = (l, p, d) => { if (p) { okN++; console.log('  ok  ' + l); } else { failN++; console.log('  FAIL ' + l + (d ? ' ← ' + String(d).slice(0, 150) : '')); } };
const YU_YAN = ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko', 'fr', 'es', 'pt', 'ru', 'eo'];

jian('10 种语言（与 i18n 语言包同键）都有出厂稿',
  YU_YAN.every((l) => MY.MO_REN_YU_YAN[l]) && MY.MO_REN_YU_YAN_KE.length === 10, MY.MO_REN_YU_YAN_KE.join(','));
jian('折算系数表覆盖同一组语言（新增语言忘补系数会漏掉）',
  YU_YAN.every((l) => typeof TX.YU_YAN_ZI_SHU_BEI_LV[l] === 'number'), Object.keys(TX.YU_YAN_ZI_SHU_BEI_LV).join(','));

{
  const cuo = [];
  for (const l of YU_YAN) {
    const x = MY.MO_REN_YU_YAN[l] || { dao: '', shu: '' };
    const d = String(x.dao || ''), s = String(x.shu || '');
    const jie = (t) => (t.match(/^## /gm) || []).length;
    const tiao = (t) => (t.match(/^\d+\. /gm) || []).length;
    if (!d.trim() || !s.trim()) cuo.push(`${l}:空`);
    if (jie(d) !== 6 || tiao(d) !== 43) cuo.push(`${l}:道 ${jie(d)}节/${tiao(d)}条`);
    if (jie(s) !== 4 || tiao(s) !== 25) cuo.push(`${l}:术 ${jie(s)}节/${tiao(s)}条`);
    if (/\n\s*\n/.test(d) || /\n\s*\n/.test(s)) cuo.push(`${l}:有空行`);
    if (/`|\$\{/.test(d) || /`|\$\{/.test(s)) cuo.push(`${l}:含反引号/插值`);
  }
  jian('每种语言的结构与中文源一致（道 6 节 43 条、术 4 节 25 条），零空行、无反引号', cuo.length === 0, cuo.join(' | '));
}

{
  const chao = [];
  for (const l of YU_YAN) {
    const x = MY.MO_REN_YU_YAN[l] || { dao: '', shu: '' };
    const d = TX.shangXianOf('道', l), s = TX.shangXianOf('术', l);
    if (x.dao.length > d) chao.push(`${l}:道 ${x.dao.length}>${d}`);
    if (x.shu.length > s) chao.push(`${l}:术 ${x.shu.length}>${s}`);
  }
  jian('每种语言的出厂稿都在**该语言折算后**的上限内（否则自愈会把规则搬进知识库）', chao.length === 0, chao.join(' | '));
  jian('折算系数对非中文语言是放大（否则俄语/法语一定会被压）',
    TX.shangXianOf('道', 'ru') > TX.shangXianOf('道', 'zh-CN') && TX.shangXianOf('道', 'fr') > TX.shangXianOf('道', 'zh-CN'));
  jian('中文基准值没变（旧门禁的 2600/4200 仍然是中文口径）',
    TX.shangXianOf('道', 'zh-CN') === 2600 && TX.shangXianOf('术', 'zh-CN') === 4200);
}

jian('未改过的内容可识别（任意语言的出厂稿都算"出厂"）',
  YU_YAN.every((l) => { const x = MY.MO_REN_YU_YAN[l] || {}; return !!x.dao && MY.shiChuChangGao(x.dao); }));
jian('改过的内容不会被误判成出厂稿（用户加一句就要保住）',
  MY.shiChuChangGao(MY.MO_REN_YU_YAN['zh-CN'].dao + '\n我加的一条') === false && MY.shiChuChangGao('') === false);
jian('未知语言回落 zh-CN 且**绝不返回空串**（空串会把用户的道清掉）',
  MY.quMoRen('xx-YY').dao === MY.MO_REN_YU_YAN['zh-CN'].dao && MY.quMoRen('xx-YY').shu.length > 0);

jian('默认称呼也是 10 种语言，且"没改过"用同一套判据',
  YU_YAN.every((l) => !!(MY.YONG_HU_MING_MO_REN || {})[l]) && MY.shiMoRenYongHuMing('老板') && MY.shiMoRenYongHuMing('Boss')
  && !MY.shiMoRenYongHuMing('老王'));

// ── 接线 ──────────────────────────────────────────────────────────
jian('播种用当前语言（不再写死中文常量）',
  /const mo = quMoRen\(dangQianYuYan\(\)\);/.test(MAIN) && /fs\.writeFileSync\(p, mo\.dao/.test(MAIN) && /fs\.writeFileSync\(p, mo\.shu/.test(MAIN));
jian('切语言时**只换没改过的**：改过的留审计且不动文件',
  /if \(!shiChuChangGao\(cur\)\) \{\s*\n\s*audit\?\.log\('prompt\.default-kept-user-edited'/.test(MAIN)
  && /fs\.writeFileSync\(p, x\.wen, 'utf8'\)/.test(MAIN));
jian('覆盖前留 .bak-lang（与其它自动改写的回退口径一致）', /\.bak-lang-/.test(MAIN));
jian('保存设置/首启选了语言 ⇒ 当场同步（不是等下次重启）',
  /if \(partial && typeof \(partial as \{ yuYan\?: unknown \}\)\.yuYan === 'string'\)[\s\S]{0,200}?moRenYuYanTongBu\(\)/.test(MAIN)
  && /if \(payload\.yuYan\) \{[\s\S]{0,160}?moRenYuYanTongBu\(\)/.test(MAIN));
jian('默认称呼也随语言换（改过的保留）',
  /settings\.username-relocalized/.test(MAIN) && /if \(!shiMoRenYongHuMing\(cur\)\) return;/.test(MAIN));
jian('渲染层拿到的上限是**按当前语言折算**的（不是中文数字硬塞）',
  /for \(const c of Object\.keys\(TI_SHI_SHANG_XIAN\)\) biao\[c\] = shangXianOf\(c, lang\);/.test(MAIN));
jian('语言键与 i18n 语言包一致（少一种当场红）', (() => {
  const dir = path.join(ROOT, 'packages/app-shell/src/i18n');
  const packs = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
  return YU_YAN.every((l) => packs.includes(l)) && packs.length === 10;
})(), (() => fs.readdirSync(path.join(ROOT, 'packages/app-shell/src/i18n')).join(','))());

console.log(`==== verify-r54-i18n-defaults: ${okN} ok / ${failN} FAIL ====`);
process.exit(failN ? 1 : 0);
