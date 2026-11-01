/**
 * verify-changwen-tingzhi —— 第 51 轮：长文「慢写 / 复读 / 卡住」判定（真函数三形状）
 * 用户口径：联网学业界最佳做法（distinct-n / 压缩比 / 新增信息量）后用到项目里。
 * 形状：
 *  · 正常稿：continue（不动作）
 *  · 慢写稿（每段都写新内容但短）：nudge，不 abort
 *  · 复读稿（重复同一段）：abort，理由带「复读」
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mod = await import(pathToFileURL(path.join(ROOT, 'packages/app-shell/dist/chang-wen-ting-zhi.js')).href).catch(() => null);

let okN = 0, failN = 0;
const ok = (m) => { okN++; console.log('  ok  ' + m); };
const bad = (m) => { failN++; console.log('  FAIL ' + m); };
const need = (c, m) => (c ? ok(m) : bad(m));

if (!mod || typeof mod.panDuanTingZhi !== 'function') {
  console.log('  FAIL 取不到 panDuanTingZhi（编译产物缺失）');
  console.log('\n==== verify-changwen-tingzhi: 0 ok / 1 FAIL ====');
  process.exit(1);
}
const { panDuanTingZhi, siGramChongFu, yaSuoBi, xinZengXinXi } = mod;

// 基础指标自证
need(siGramChongFu('这是一段完全不同的文字内容测试用') < 0.35, '正常文本 4-gram 重复率低');
need(siGramChongFu('重复重复重复重复重复重复重复重复重复重复') > 0.35, '高度重复文本 4-gram 重复率高');
need(yaSuoBi(('这是一段自然语言，有足够的变化和不同的词汇，用来测试压缩比是否正常。'.repeat(20))) < 0.9, '正常文本（够长）压缩比合理');
need(xinZengXinXi('第 7 章 新的结论：值 12345，另有新实体乙', '第 1 章 旧结论 111') > 0.01, '新段有新增信息');

// 三形状
const zhengChang = [
  '第一章讲的是钟表铺的老匠人，他每天清晨擦拭柜台，记录每一块表的状态。',
  '第二章转到徒弟身上，他学会了拆解游丝，也第一次独立修好一块怀表。',
  '第三章写铺子遇到的难题：一场大雨淹了后院，零件生锈，他们连夜抢救。',
];
const r1 = panDuanTingZhi(zhengChang, '', 0);
need(r1.dong === 'continue', `正常稿 ⇒ continue（实际 ${r1.dong}：${r1.liYou}）`);

const manXie = [
  '第 4 章：匠人打开抽屉，取出一枚新游丝，编号 88213，放在绒布上。',
  '第 5 章：徒弟量了摆轮直径 12.4 毫米，记在册子第 37 页。',
  '第 6 章：他们把怀表装回壳里，试走了 3 小时，误差 4 秒。',
];
const r2 = panDuanTingZhi(manXie, zhengChang.join('\n'), 0);
need(r2.dong !== 'abort', `慢写稿 ⇒ 不 abort（实际 ${r2.dong}）`);

const fuDu = Array(3).fill('这一段完全是重复的内容，同样的句子一遍又一遍地出现，没有任何新信息。');
const r3 = panDuanTingZhi(fuDu, fuDu.join('\n'), 0);
need(r3.dong === 'abort' && /复读/.test(r3.liYou), `复读稿 ⇒ abort（实际 ${r3.dong}：${r3.liYou}）`);

const kaZhu = ['好的。', '行吧。', '可以。'];
const r4 = panDuanTingZhi(kaZhu, kaZhu.join('\n'), 2);
need(r4.dong === 'abort', `无新增且 nudge 满 2 次 ⇒ abort（实际 ${r4.dong}：${r4.liYou}）`);

// 接线：宿主真的用上了
import fs from 'node:fs';
const em = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/electron-main.ts'), 'utf8');
need(/panDuanTingZhi\(zhuang\.duan/.test(em), '宿主在长文进度判定里调用 panDuanTingZhi');
need(/chat\.length-stall-content/.test(em), '内容层停滞进审计（可追溯）');

console.log(`\n==== verify-changwen-tingzhi: ${okN} ok / ${failN} FAIL ====`);
process.exit(failN ? 1 : 0);
