/**
 * verify-budget-per-executor —— 第 51 轮：上下文预算按执行者取
 * 用户口径：
 *  · 子执行者/分身：用**牛马管理局里该牛马配置的上下文预算**（不是聊天框滑杆）
 *  · 我的牛马自执行 / 项目值班者自执行：用聊天框下面的预算
 *  · 群聊：无聊天框预算，按牛马自身配置
 *  · 派发前先压缩到执行者预算内，超了先收缩毯、再换人；仍不可行就如实告知
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MAIN = path.join(ROOT, 'packages/app-shell/src/electron-main.ts');
const ORC = path.join(ROOT, 'packages/app-shell/src/orchestrator.ts');

let okN = 0, failN = 0;
const ok = (m) => { okN++; console.log('  ok  ' + m); };
const bad = (m) => { failN++; console.log('  FAIL ' + m); };
const need = (c, m) => (c ? ok(m) : bad(m));

const em = fs.readFileSync(MAIN, 'utf8');
const orc = fs.readFileSync(ORC, 'utf8');

need(/function zhiXingZheYuSuanBaiFenBi\(instId\?: string\)/.test(em), '有按执行者取预算的纯函数');
need(/laiYuan: 'instance' \| 'global'/.test(em), '返回里标明预算来源（instance/global）');
need(/chat\.xiaodi-budget-source/.test(em), '分身预算来源进审计');
need(/function toolLimits\(instId\?: string\)/.test(em), 'toolLimits 支持按执行者取');
need(/toolLimits: deps\.toolLimits\?\.\(zxId\)/.test(orc), '执行者分发时传自己的 id 取限额');
need(/contextBudgetChars\?: \(modelId\?: string, yangBenWen\?: string, instId\?: string\)/.test(orc), '预算函数支持执行者 id 通道');

// 派发前压缩/换人：已有毯闸 + 预算阶梯（引用既有实现，不重复造）
need(/ZHAN_BIAN_ZONG_ZI_SHANG_XIAN/.test(fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/executor.ts'), 'utf8')), '执行者毯有尺寸闸');
need(/jiangJi|JIANG_JI/.test(em), '主路径有降级阶梯（预算不足时收缩）');

console.log(`\n==== verify-budget-per-executor: ${okN} ok / ${failN} FAIL ====`);
process.exit(failN ? 1 : 0);
