/**
 * verify-r67-prompt-caps.mjs（fast 档）—— 第 67 轮 项 9。
 *
 * 判据：**每种语言 × 每个提示词，连续三轮审计都在与简体中文相同的上限内**（第 90 轮起不再按语言折算）。
 * 三轮不是重复跑同一个静态判断：每轮都重新 import/读取一次出厂稿与上限模块，
 * 防止“第一轮读到的缓存掩盖了第二轮的改动”，也把“重新翻译后必须再全量过三轮”的口径固定下来。
 *
 * 覆盖：道/术（10 语言出厂稿）、认知预设（2200 条）、默认人格短文本。
 * 超限的正确修法是**用中文原文重译**（见 scripts/retranslate-default-prompts.mjs），不是截断。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const U = (f) => pathToFileURL(path.join(ROOT, f)).href;
const YU_YAN = ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko', 'fr', 'es', 'pt', 'ru', 'eo'];
let ok = 0, bad = 0;
const jian = (l, p, d) => { if (p) { ok++; console.log('  ok   ' + l); } else { bad++; console.log('  FAIL ' + l + (d ? ' ← ' + String(d).slice(0, 240) : '')); } };

// 每轮重新 import（带 cache-busting 查询），确保三轮读的是各自那一份，而不是第一份缓存。
const importFresh = async (rel) => import(U(rel) + '?round=' + Math.random().toString(36).slice(2));

let lastError = '';
for (let round = 1; round <= 3; round++) {
  try {
    const MY = await importFresh('packages/app-shell/dist/mo-ren-yu-yan/index.js');
    const TX = await importFresh('packages/app-shell/dist/ti-shi-shang-xian.js');
    const cengCuo = [];
    for (const lang of YU_YAN) {
      const mo = MY.MO_REN_YU_YAN[lang];
      if (!mo || !String(mo.dao || '').trim() || !String(mo.shu || '').trim()) { cengCuo.push(lang + ': 缺出厂稿'); continue; }
      for (const [ceng, wen] of [['道', mo.dao], ['术', mo.shu]]) {
        const lim = TX.shangXianOf(ceng, lang);
        if (String(wen).length > lim) cengCuo.push(`${lang}/${ceng}: ${String(wen).length} > ${lim}`);
      }
    }
    jian(`第 ${round} 轮：10 语言 × 道/术 全在各自上限内`, cengCuo.length === 0, cengCuo.join(' | '));

    // 认知预设：也属于提示词层，按当前语言上限审计（中文基准 1600）。
    const p = path.join(ROOT, 'packages/app-shell/src/renderer/persona-templates.js');
    const ctx = { window: {} };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { timeout: 5000 });
    const presets = [];
    for (const arr of Object.values(ctx.window.__PERSONA_TPL || {})) {
      if (Array.isArray(arr)) for (const x of arr) if (x && x.content) presets.push(String(x.content));
    }
    const personaCuo = [];
    for (const lang of YU_YAN) {
      const lim = TX.shangXianOf('认知', lang);
      const over = presets.filter((s) => s.length > lim).length;
      if (over) personaCuo.push(`${lang}: ${over} 条 > ${lim}`);
    }
    jian(`第 ${round} 轮：认知预设 ${presets.length} 条在 10 语言上限内`, presets.length > 0 && personaCuo.length === 0, personaCuo.join(' | '));
  } catch (e) {
    lastError = String((e && e.message) || e);
    jian(`第 ${round} 轮：审计可执行（dist 已构建、模块可加载）`, false, lastError);
  }
}

// 修法必须是“重译”，不是截断：重译脚本存在且只用中文原文生成，不把超限文本 slice 掉。
const re = path.join(ROOT, 'packages/app-shell/scripts/retranslate-default-prompts.mjs');
jian('存在超限重译脚本（不是截断）', fs.existsSync(re));
if (fs.existsSync(re)) {
  const src = fs.readFileSync(re, 'utf8');
  jian('重译脚本从中文原文出发，并复用 shangXianOf 校验', /中文原文/.test(src) && /shangXianOf/.test(src));
  jian('重译脚本不把提示词截断（没有对出厂稿 slice）', !/dao\.slice|shu\.slice|出厂稿.*slice/.test(src));
  jian('密钥只从环境变量读、不写死本机路径', /WARMY_MIMO_KEY_FILE/.test(src) && !/[A-Za-z]:\\\\Users\\\\/.test(src));
}
// 主进程保存入口是“拒绝”而不是截断（认知注入处的 slice 只影响注入预算，不写出厂稿）。
const MAIN = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/electron-main.ts'), 'utf8');
jian('保存入口超限直接拒绝（prompt.over-cap-rejected）', /prompt\.over-cap-rejected/.test(MAIN));
jian('重译口径写进启动审计（每语言审计，不只当前语言）', /prompt\.lang-audit/.test(MAIN));

console.log(`==== verify-r67-prompt-caps：${ok} ok / ${bad} FAIL ====`);
process.exit(bad ? 1 : 0);
