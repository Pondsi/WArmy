/**
 * verify-at-tidao —— 第 51 轮：@ 下拉（按用户九条口径）
 *
 * 1 非字母类（日/韩）自动首字母  2 群/项目只列本会话牛马  3 联系人不弹
 * 4 我的牛马列全部会话+图标      5 无手填读音设置          6 日文覆盖假名/汉字
 * 7 连续输入的结束条件            8 空格/退格/回车/输入法语义
 * 9 中文按输入法上屏字搜（回车上屏按字母搜、空格上屏按字搜）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP = path.join(ROOT, 'packages/app-shell/src/renderer/app.js');
const CSS = path.join(ROOT, 'packages/app-shell/src/renderer/app.css');
const HTML = path.join(ROOT, 'packages/app-shell/src/renderer/index.html');
const DUYIN = path.join(ROOT, 'packages/app-shell/src/du-yin.ts');

let okN = 0, failN = 0;
const ok = (m) => { okN++; console.log('  ok  ' + m); };
const bad = (m) => { failN++; console.log('  FAIL ' + m); };
const need = (c, m) => (c ? ok(m) : bad(m));

const ap = fs.readFileSync(APP, 'utf8');
const css = fs.readFileSync(CSS, 'utf8');
const html = fs.readFileSync(HTML, 'utf8');
const dy = fs.readFileSync(DUYIN, 'utf8');

// ── 1 + 6：非字母类自动首字母（含日文汉字/假名、韩文初声）──
const mod = await import(pathToFileURL(path.join(ROOT, 'packages/app-shell/dist/du-yin.js')).href).catch(() => null);
if (mod && typeof mod.souSuoZhuYao === 'function') {
  /**
   * 第 51/52 轮改口径：**中文名的拼音只在"单个字母"时优先；查询 ≥2 个字母就不再走中文拼音**
   * （真机：打 `xn` 想把"小牛"顶上来，结果把一堆不相干的中文名塞进候选，@ 列表变得看不懂）。
   * 日/韩不受这条影响 —— 它们的拉丁化本来就是首字母表（初声/假名），始终按首字母与全读命中。
   */
  need(mod.souSuoZhuYao('小牛', 'xn') === 4, `中文 ≥2 字母不再优先拼音：小牛/xn → 4 不命中（实际 ${mod.souSuoZhuYao('小牛', 'xn')}）`);
  need(mod.souSuoZhuYao('小牛', 'xiaoniu') === 4, `中文全拼同样不优先：小牛/xiaoniu → 4（实际 ${mod.souSuoZhuYao('小牛', 'xiaoniu')}）`);
  need(mod.souSuoZhuYao('牛马一', 'nm') === 4, `中文两字母首拼同样不命中：牛马一/nm → 4（实际 ${mod.souSuoZhuYao('牛马一', 'nm')}）`);
  need(mod.souSuoZhuYao('小牛', 'x') === 1, `单个字母仍走拼音首字母：小牛/x → 1（实际 ${mod.souSuoZhuYao('小牛', 'x')}）`);
  need(mod.souSuoZhuYao('김철수', 'gcs') === 1, `韩文初声（≥2 字母不受影响）：김철수/gcs → 1（实际 ${mod.souSuoZhuYao('김철수', 'gcs')}）`);
  need(mod.souSuoZhuYao('山田', 'yamada') === 2, `日文汉字全读音：山田/yamada → 2（实际 ${mod.souSuoZhuYao('山田', 'yamada')}）`);
  need(mod.souSuoZhuYao('やまだ', 'ymd') === 1, `日文假名首字母：やまだ/ymd → 1（实际 ${mod.souSuoZhuYao('やまだ', 'ymd')}）`);
  need(mod.souSuoZhuYao('山田', 'yd') === 1, `日文汉字首字母：山田/yd → 1（实际 ${mod.souSuoZhuYao('山田', 'yd')}）`);
  need(mod.souSuoZhuYao('coder-1', 'co') === 0, `字母名前缀：coder-1/co → 0（实际 ${mod.souSuoZhuYao('coder-1', 'co')}）`);
} else {
  bad('取不到 du-yin 编译产物');
}
/**
 * Unihan 表在 `du-yin.ts` 里是**数据行**（`字 z:中文拼音|日文音读|日文训读…`；`z:` 前缀=中文拼音，
 * 无前缀=日文读法）。旧断言钉的是生成脚本里的字段名 `kJapaneseOn/kJapaneseKun`，产物里根本没有 ⇒ 恒红。
 * 改成数"确实带日文读法的行数"——这才是要证明的事。
 */
const riBenHang = dy.split('\n').filter((l) => /^[^\u0000-\u007F]{1,3} [^\n]*\|[a-z]{2,}/.test(l)).length;
need(riBenHang > 500, `日文音读/训读在表里（${riBenHang} 行带无前缀拉丁读法）`);
need(/KANA/.test(dy) && /HANGUL_CHO/.test(dy), '假名表与韩文初声表在');

// ── 2/3/4：列表范围 ──
need(/groupMembers/.test(ap) && /只列\*\*该会话里的牛马\*\*/.test(ap), '群/项目只列本会话牛马');
need(/keTan[\s\S]{0,200}internal[\s\S]{0,80}extgroup[\s\S]{0,80}single/.test(ap), '仅 internal/extgroup/single 弹出（联系人不弹）');
need(/kind === 'extdm' \|\| c\.kind === 'extchat'/.test(ap), '我的牛马里包含联系人');
need(/g\.type === 'internal' \? 'internal' : 'extgroup'/.test(ap), '我的牛马里包含群/项目');
need(/AT_SVG\[x\.kind\]/.test(ap), '选项带第一列图标');
need(/AT_SVG/.test(ap) && /viewBox="0 0 100 100"/.test(ap), '图标复用第一列 SVG');

// ── 5：无手填读音 ──
need(!/iPinYin/.test(ap), '设置里已去掉手填读音');

// ── 7：连续输入结束条件 ──
need(/const duanXu = \(\) => \{ st\.newSearch = true; \}/.test(ap), '连续输入结束 ⇒ 之后算新搜索');
need(/ArrowDown[\s\S]{0,200}duanXu\(\)/.test(ap), '↑↓ 结束连续输入');
need(/document\.addEventListener\('mousedown'/.test(ap) && /guan\(false\)/.test(ap), '鼠标点别处关闭');
need(/window\.addEventListener\('blur'/.test(ap), '失焦关闭');
need(/!\/\^\[0-9a-zA-Z\]\$\/\.test\(e\.key\)\) duanXu\(\)/.test(ap), '非字母数字键结束连续输入');

// ── 8：键位语义 ──
need(/e\.key === ' '/.test(ap) && /普通 @/.test(ap), '@ 后空格 = 普通关掉');
need(/Backspace/.test(ap) && /删掉 @/.test(ap), '默认序退格 = 关掉并删 @');
need(/composing\) return; \/\/ 其余按键交给输入法/.test(ap), '候选期其余按键交给输入法');
need(/e\.key === 'Enter'[\s\S]{0,220}composing\) \{[\s\S]{0,120}duanXu\(\)/.test(ap), '候选中回车 = 保持结果、结束这段');
need(/if \(it\) chaRu\(it\.ming\); else guan\(true\)/.test(ap), '非候选回车 = 选中当前项');

// ── 9：输入法上屏 ──
need(/compositionstart/.test(ap) && /compositionend/.test(ap), '有输入法组合事件');
need(/if \(!st\.frozen && hid\.value && hid\.value\.length >= 1\)/.test(ap), '候选期只用第一个字母提示');
need(/st\.frozen = true/.test(ap), '第二个拼音起冻结到上屏');
need(/const shang = String\(\(e && e\.data\) \|\| hid\.value \|\| ''\)/.test(ap), '按上屏结果搜索（字母或字）');
need(/hid\.value = st\.query/.test(ap), '连续上屏累积搜索串');

// ── 显示：查询串不进消息框 ──
need(/atShuRu/.test(ap) && /\.atShuRu\{/.test(css), '隐藏输入法目标（候选框照常弹）');
need(/opacity:0/.test(css) && /caret-color:transparent/.test(css), '隐藏输入不显示字');
need(/du-yin\.js/.test(html), 'index.html 加载 du-yin');

console.log(`\n==== verify-at-tidao: ${okN} ok / ${failN} FAIL ====`);
process.exit(failN ? 1 : 0);
