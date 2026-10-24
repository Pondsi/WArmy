/**
 * verify-hard-gates.mjs（fast 档）—— 第 61 轮：**重新检查产品硬门禁的"效果只增不减"**。
 *
 * 背景：硬门禁在第 41/51/52 轮被改过（新增 D、撤除 E 并移入「术」、A/B/C 措辞调整）。
 * 用户口径：硬门禁质量优先；**不能确认质量就不改**。所以这份门禁不改条款，只把每条要求的
 * **可核对锚点**钉住 —— 以后谁再改硬门禁，少一条就红；同时核对"宿主真的在强制"的两处声明。
 *
 * 判据分四组：
 *  ① 条款仍在（A 四步/判定表/禁止项、B 计划规则、C 后台制度、D 冲突规则）；
 *  ② 撤除的 E 没有丢效果：句式纪律必须原样在用户的「术」里（80% 置信度 + 预警例外 + 自查）；
 *  ③ 宿主强制点真实存在（B 的 plan.missing、D 的软门禁冲突检查），不是只写在提示词里；
 *  ④ 注入只有一处、顺序仍是硬门禁在最前、硬门禁不进压缩队列。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const U = (f) => pathToFileURL(path.join(ROOT, f)).href;
const R = await import(U('packages/app-shell/dist/builtin-rules.js'));
const SHU = await import(U('packages/app-shell/dist/shu-default.js'));
const MAIN = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/electron-main.ts'), 'utf8');

const M = String(R.CHANPIN_MENJIN || '');
const S = String(SHU.SHU_MOREN || '');
let okN = 0, failN = 0;
const jian = (l, p, d) => { if (p) { okN++; console.log('  ok  ' + l); } else { failN++; console.log('  FAIL ' + l + (d ? ' ← ' + String(d).slice(0, 150) : '')); } };

// ── ① 条款仍在（含顺序与完整性，不只看关键词） ─────────────
const A_BU = ['1. **先验证**', '2. **按下面的判定表', '3. **写进「设置」', '4. **在回复里交代'];
const aShunXu = (s) => {
  const p = A_BU.map((x) => s.indexOf(x));
  return p.every((x) => x >= 0) && p.every((x, i) => i === 0 || x > p[i - 1]);
};
jian('A：四步顺序完整体（先验证 → 固化 → 写进设置 → 回复交代）', aShunXu(M));
jian('A：判定表三行都在（skill / 门禁 / 插件），不是只出现关键词',
  /\|.*\*\*skill\*\*.*\|/.test(M) && /\|.*\*\*门禁\*\*.*\|/.test(M) && /\|.*\*\*插件\*\*.*\|/.test(M) && /SKILL\.md/.test(M));
jian('A：明令禁止"只留在聊天里"（这是 A 存在的理由）',
  /禁止.*只写在聊天里|只写在聊天里/.test(M) && /不许说「配好了」/.test(M));
jian('A：做不到时必须明说并给出用户要做的事',
  /做不到就明说/.test(M) && /依赖/.test(M));

jian('B：明确「步骤 ≥3 才建」与「2–10 步」（不是只提 plan_update）',
  /步骤 ≥3 才建/.test(M) && /2–10 步/.test(M) && /可验证的动作/.test(M));
jian('B：同一时刻只 1 步 doing；verified 只能由 plan_verify 给出',
  /只允许 1 步 `doing`|只允许 1 步 doing/.test(M) && /`verified` 只能由 `plan_verify` 给出|verified 只能由 plan_verify 给出/.test(M));
jian('B：收尾要验最后一步，没走完要如实说卡在哪', /最后一步 `plan_verify`|最后一步 plan_verify/.test(M) && /卡在哪一步/.test(M));

jian('C：三条触发条件同时满足（在跑 + 没别的活 + ≥5 分钟）',
  /同时满足，缺一不触发/.test(M) && /≥5 分钟/.test(M) && /没有你能干的活/.test(M));
jian('C：五件必报的五个编号都在（①跑什么 ②多久/几点完 ③不用值守 ④计划任务可见 ⑤可继续交代）',
  ['①', '②', '③', '④', '⑤'].every((x) => M.includes(x)) && /预计几点几分完成/.test(M) && /不用你值守/.test(M) && /计划任务/.test(M));
jian('C：禁止空转轮询、跑完必须自己收结果并汇报、失败也要如实报',
  /不要空转轮询/.test(M) && /不要为了"看看好了没"去读文件|不要为了.*看看好了没.*读文件/.test(M) && /收结果 → 汇报/.test(M) && /失败也必须自己启动/.test(M));

jian('D：软门禁不得与硬门禁冲突；冲突按硬门禁执行并立刻修正',
  /软门禁永远不得与硬门禁冲突|不得.*与硬门禁/.test(M) && /按硬门禁执行/.test(M) && /立刻修正/.test(M));
jian('D：四条都在（冲突检查/立刻改/不再三次论证/说哪条+最坏情况+无权改）',
  /必须先做冲突检查/.test(M) && /立刻修正/.test(M) && /不再需要三次论证/.test(M) && /必须说出\*\*是哪一条\*\*/.test(M) && /最坏会发生什么/.test(M) && /没有能力.*修改或跳过/.test(M));

// ── ② 撤除的 E 没有丢效果 ─────────────────────────────────
jian('硬门禁里不再有 E（避免双份注入）', !/硬门禁 E|门禁 E：/.test(M) && !/MENJIN_E/.test(fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/builtin-rules.ts'), 'utf8').replace(/第 51 轮曾有[\s\S]*?不要再把它加回来。/, '')));
jian('「不是 X 而是 Y」纪律原样在「术」里（同族句式 + 两个出处）',
  /不是 X，而是 Y/.test(S) && /也许不是 X|并非 X 而是 Y/.test(S) && /出处一 · 纠正/.test(S) && /出处二 · 预警/.test(S));
jian('「术」保留 ≥80% 置信度门槛与"X 指得回那一处"',
  /≥80% 置信度/.test(S) && /指得回那一处/.test(S));
jian('「术」保留预警例外与自查一句（不能把 E 压成只禁不导）',
  /这里 X 是句子的主体/.test(S) && /自查一句/.test(S));
jian('「术」出厂稿在硬上限内（第 53 轮的 4200 字上限）', S.length <= 4200, S.length);

// ── ③ 宿主强制点真实存在 ───────────────────────────────────
jian('B 的宿主强制：一轮工具调用 ≥3 且无计划 ⇒ 审计 plan.missing 并把门禁塞回上下文',
  /plan\.missing/.test(MAIN) && /yiYongCi/.test(MAIN));
jian('D 的宿主强制：改软门禁的入口做冲突检查（IPC 真的存在）',
  /chuliIpc\('warmy:ruanMenJinChongTu'|jianChaRuanMenJin\(String\(payload\?\.neiRong/.test(MAIN));
jian('硬门禁只注入一处（两份=顺序漂移的前兆）',
  (MAIN.match(/CHANPIN_MENJIN\.trim\(\)/g) || []).length === 1
  && !/MENJIN_[ABCD]\b/.test(MAIN));
jian('硬门禁在最前、且不进压缩队列（道与产品门禁都不可压）',
  /【产品门禁 · 最高优先级/.test(MAIN) && /BU_KE_YA_SUO/.test(MAIN) && /道.*产品门禁|产品门禁.*道/.test(MAIN));
jian('源码与产物都还是 A–D 四段，源码里没有 E',
  ['MENJIN_A', 'MENJIN_B', 'MENJIN_C', 'MENJIN_D'].every((x) => new RegExp('export const ' + x + ' =').test(fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/builtin-rules.ts'), 'utf8')))
  && !/MENJIN_E/.test(fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/builtin-rules.ts'), 'utf8'))
  && ['门禁 A', '门禁 B', '门禁 C', '硬门禁 D'].every((x) => M.includes(x)));

// ── ⑤ 负向自证：改坏这些判据必须被判红（证明门禁不是摆设） ──
{
  const B3 = (s) => /步骤 ≥3 才建/.test(s) && /2–10 步/.test(s);
  const C5 = (s) => ['①', '②', '③', '④', '⑤'].every((x) => s.includes(x)) && /收结果 → 汇报/.test(s);
  const D4 = (s) => /必须先做冲突检查/.test(s) && /不再需要三次论证/.test(s) && /最坏会发生什么/.test(s);
  const E0 = (s) => !/门禁 E|MENJIN_E/.test(s);
  jian('自证：基线 4 组判据都能通过', aShunXu(M) && B3(M) && C5(M) && D4(M) && E0(M));
  jian('自证：A 四步顺序调换必须判红', !aShunXu(M.replace('2. **按下面的判定表', 'TMP').replace('3. **写进「设置」', '2. **按下面的判定表').replace('TMP', '3. **写进「设置」')));
  jian('自证：删掉 B 的「步骤 ≥3 才建」必须判红', !B3(M.replace('步骤 ≥3 才建', '')));
  jian('自证：删掉 C 的编号 ⑤ 必须判红', !C5(M.replace('⑤', '')));
  jian('自证：删掉 D 的「最坏会发生什么」必须判红', !D4(M.replace('最坏会发生什么', '')));
  jian('自证：把 E 加回硬门禁必须判红', !E0(M + '\n门禁 E：不是 X 而是 Y'));
  jian('自证：第二处注入 CHANPIN_MENJIN 必须判红',
    ((MAIN + '\nconst menjin2 = CHANPIN_MENJIN.trim()').match(/CHANPIN_MENJIN\.trim\(\)/g) || []).length !== 1);
}

// ── ④ 体积与质量口径 ──────────────────────────────────────
const zong = M.length;
jian('硬门禁体积有记录、且没有被压到伤筋动骨（≥2,000 字符）', zong >= 2000, String(zong));
jian('硬门禁没有空行装饰（省 token；正文内容不变）', !/\n\s*\n/.test(M), String((M.match(/\n\s*\n/g) || []).length));

console.log(`==== verify-hard-gates: ${okN} ok / ${failN} FAIL ====`);
process.exit(failN ? 1 : 0);
