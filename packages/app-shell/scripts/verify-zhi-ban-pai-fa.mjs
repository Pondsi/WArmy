#!/usr/bin/env node
/**
 * verify-zhi-ban-pai-fa —— 项目值班者派发计划（纯函数）。
 *
 * 用户口径：
 *  · 紧急度 P0–P3 只影响投递/插话/队列；难易度（重要×复杂）影响挑谁、思考多深；
 *  · 值班者可选执行者、思考级别、插话方式（停止/加急/插入/排队）；
 *  · **不能指定模型**（计划里不得出现 model 字段）。
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, '..', 'dist', 'zhi-ban-pai-fa.js');
const distDu = path.join(here, '..', 'dist', 'nan-yi-du.js');
if (!fs.existsSync(dist) || !fs.existsSync(distDu)) {
  console.error('缺少构建产物，请先 build：' + dist);
  process.exit(2);
}
const M = await import(pathToFileURL(dist).href);
const D = await import(pathToFileURL(distDu).href);
const distRt = path.join(here, '..', 'dist', 'runtime.js');
const RT = fs.existsSync(distRt) ? await import(pathToFileURL(distRt).href) : null;

let pass = 0, fail = 0;
const failures = [];
function check(label, cond, data) {
  const s = data === undefined ? '' : ` => ${typeof data === 'string' ? data : JSON.stringify(data)}`;
  if (cond) { pass++; console.log(`  [PASS] ${label}${s}`); }
  else { fail++; failures.push(label); console.log(`  [FAIL] ${label}${s}`); }
}

const houXuan = (id, ming, extra = {}) => ({ id, ming, status: 'running', order: Number(id.replace(/\D/g, '')) || 0, ...extra });
const du = (thinkLevel = 'l4', nan = 3, za = 3, ji = 3) => ({
  nan, za, ji, importance: 3,
  modelTier: nan >= 4 ? 'high' : nan <= 2 ? 'low' : 'mid',
  thinkLevel,
  combo: `${nan >= 4 ? '难' : '易'}${za >= 4 ? '杂' : '简'}${ji >= 4 ? '急' : '缓'}`,
});

console.log('[1] 按人设/擅长挑人（不是死板取前两个）');
{
  const plan = M.paiFaZhiXingZhe({
    urgency: 'P2',
    content: '请给网页做一个前端界面，包含按钮和表单',
    difficulty: du('l4'),
    candidates: [
      houXuan('a1', '测试牛马', { persona: '擅长测试、验收、回归' }),
      houXuan('a2', '前端牛马', { persona: '资深前端工程师，React/Vue/HTML/CSS' }),
      houXuan('a3', '通用牛马', { persona: '什么都能干一点' }),
    ],
  });
  check('前端任务优先选中前端牛马', plan.assignments[0]?.executorId === 'a2', plan.assignments);
  check('默认派 2 个执行者', plan.assignments.length === 2, plan.assignments.length);
  check('计划里没有 model 字段', !JSON.stringify(plan).includes('"model"'), JSON.stringify(plan));
  check('硬约束 modelLocked', plan.modelLocked === true);
}

console.log('[2] 紧急度只影响插话，不影响思考级别');
{
  const idle = M.paiFaZhiXingZhe({ urgency: 'P3', content: '写个报告', difficulty: du('l6', 3, 3, 2), candidates: [houXuan('b1', '写作牛马', { persona: '文案写作' })] });
  const busy = M.paiFaZhiXingZhe({ urgency: 'P3', content: '写个报告', difficulty: du('l6', 3, 3, 2), candidates: [houXuan('b1', '写作牛马', { persona: '文案写作', busy: true })] });
  check('空闲目标无需插话', idle.assignments[0]?.interrupt === 'none', idle.assignments[0]);
  check('忙碌目标 P3 ⇒ 排队', busy.assignments[0]?.interrupt === 'queue', busy.assignments[0]);
  check('插话等级不改思考级别', idle.assignments[0]?.thinkLevel === busy.assignments[0]?.thinkLevel, [idle.assignments[0]?.thinkLevel, busy.assignments[0]?.thinkLevel]);
}

console.log('[3] 忙碌目标的插话方式（五级急缓）');
{
  const make = (urgency, busy, stopIntent = false) => M.paiFaZhiXingZhe({
    urgency, content: '干活', difficulty: du('l4', 3, 3, M.jiCongP(urgency)), stopIntent,
    candidates: [houXuan('c1', '牛马一', { busy }), houXuan('c2', '牛马二')],
  });
  check('很急 + 明确要求停止 ⇒ stop', make('P0', true, true).assignments.find((x) => x.executorId === 'c1')?.interrupt === 'stop');
  check('较急 + 忙碌 ⇒ urgent', make('P1', true).assignments.find((x) => x.executorId === 'c1')?.interrupt === 'urgent');
  check('适中 + 忙碌 ⇒ insert', make('P2', true).assignments.find((x) => x.executorId === 'c1')?.interrupt === 'insert');
  check('较缓 + 忙碌 ⇒ queue', make('P3', true).assignments.find((x) => x.executorId === 'c1')?.interrupt === 'queue');
  check('极缓 + 忙碌 ⇒ queue', make('P4', true).assignments.find((x) => x.executorId === 'c1')?.interrupt === 'queue');
}

console.log('[4] 空闲优先；P0 才允许为强匹配抢忙碌目标');
{
  const mk = (urgency) => M.paiFaZhiXingZhe({
    urgency, content: '前端界面',
    difficulty: du('l4', 3, 3, M.jiCongP(urgency)),
    candidates: [
      houXuan('d1', '通用牛马', { persona: '通用', busy: false }),
      houXuan('d2', '前端牛马', { persona: '前端专家', busy: true }),
    ],
  });
  check('P2 优先空闲（不抢正在忙的）', mk('P2').assignments[0]?.executorId === 'd1', mk('P2').assignments[0]);
  check('P0 允许抢忙碌的强匹配目标', mk('P0').assignments[0]?.executorId === 'd2', mk('P0').assignments[0]);
}

console.log('[5] 思考级别：牛马自己选定就不覆盖；auto 才按难易度');
{
  const own = M.paiFaZhiXingZhe({ urgency: 'P2', content: '随便聊聊', difficulty: du('l1'), candidates: [houXuan('e1', '固定档', { thinkLevel: 'l3' })] });
  const auto = M.paiFaZhiXingZhe({ urgency: 'P2', content: '做一个复杂系统，涉及多步推理和代码', difficulty: du('l6'), candidates: [houXuan('e2', '自动档', { thinkLevel: 'auto' })] });
  check('牛马选 l3 ⇒ 计划写 auto（不覆盖）', own.assignments[0]?.thinkLevel === 'auto', own.assignments[0]);
  check('auto + 高难 ⇒ 高思考 l6', auto.assignments[0]?.thinkLevel === 'l6', auto.assignments[0]);
}

console.log('[6] 纯调度成员不参与执行；空候选不崩');
{
  const plan = M.paiFaZhiXingZhe({ urgency: 'P2', content: '干活', difficulty: du(), candidates: [houXuan('f1', '纯调度', { pureDispatcher: true }), houXuan('f2', '执行者')] });
  check('pureDispatcher 被排除', plan.assignments.every((x) => x.executorId !== 'f1'), plan.assignments);
  const empty = M.paiFaZhiXingZhe({ urgency: 'P2', content: '干活', difficulty: du(), candidates: [] });
  check('没有候选 ⇒ 空计划，不抛错', empty.assignments.length === 0, empty.assignments);
}

console.log('[7] 派发顺序：停止/加急 > 插入/普通 > 排队');
{
  const rank = (m) => M.paiFaXianHou({ executorId: 'x', ming: 'x', thinkLevel: 'auto', interrupt: m, why: '' });
  check('stop 最前', rank('stop') < rank('urgent'));
  check('urgent 先于 insert', rank('urgent') < rank('insert'));
  check('queue 最后', rank('queue') > rank('insert'));
}

console.log('[8] 难易度估计与护栏（三轴独立）');
{
  const high = D.guSuanZhongYaoFuZa('生产环境付款、删除数据库、发布上线，并分多步逐个修复');
  const simple = D.guSuanZhongYaoFuZa('你好');
  check('高风险多步任务判高思考 l6', high.thinkLevel === 'l6', high);
  check('简单短句不被抬成 high', high.thinkLevel !== simple.thinkLevel && simple.modelTier !== 'high', simple);
  check('标签识别前端', M.renWuBiaoQian('给网页做前端界面').includes('前端'), M.renWuBiaoQian('给网页做前端界面'));
}

console.log('[9] 五级三轴：难/易 × 杂/简 × 急/缓');
{
  const J = (nan, za, urg, conf = 0.8, imp = 3) => D.panDuanNanZa(nan, za, imp, conf, urg);
  const an = [
    ['很难·很杂·较急', J(5, 5, 'P1'), 'high', 'l6'],
    ['很难·很杂·急缓适中', J(5, 5, 'P2'), 'high', 'l6'],
    ['很难·极简·较急', J(5, 1, 'P1'), 'high', 'l6'],
    ['较难·极简·急缓适中', J(4, 1, 'P2'), 'high', 'l3'],
    ['较易·很杂·较急', J(2, 5, 'P1'), 'low', 'l6'],
    ['较易·很杂·急缓适中', J(2, 5, 'P2'), 'low', 'l6'],
    ['较易·极简·较急', J(2, 1, 'P1'), 'low', 'l1'],
    ['较易·极简·急缓适中', J(2, 1, 'P2'), 'low', 'l1'],
    ['极易·极简·极缓', J(1, 1, 'P4'), 'low', 'off'],
  ];
  for (const [combo, r, mt, tl] of an) {
    check(`${combo} ⇒ 模型 ${mt} / 思考 ${tl}`, r.combo === combo && r.modelTier === mt && r.thinkLevel === tl, r);
  }
  const ji = J(4, 3, 'P1', 0.7, 3);
  const huan = J(4, 3, 'P2', 0.7, 3);
  check('急/缓不改变模型与思考（难/杂已定下限）', ji.modelTier === huan.modelTier && ji.thinkLevel === huan.thinkLevel, [ji, huan]);
  check('已经顶模型仍可能失手（低置信）⇒ 简任务也抬思考',
    J(4, 1, 'P2', 0.4, 3).thinkLevel === 'l6', J(4, 1, 'P2', 0.4, 3));
  check('难与杂独立：难简用高模型，易杂用高思考',
    J(4, 1, 'P2').modelTier === 'high' && J(4, 1, 'P2').thinkLevel !== 'l6'
    && J(1, 5, 'P2').modelTier === 'low' && J(1, 5, 'P2').thinkLevel === 'l6',
    [J(4, 1, 'P2'), J(1, 5, 'P2')]);
  check('很急且任务简单 ⇒ 思考可低一档，但不低于下限',
    J(2, 1, 'P0', 0.8, 1).thinkLevel === 'l1',
    J(2, 1, 'P0', 0.8, 1));
}

console.log('[10] 实例上限：低配机器也允许 10 只');
{
  check('2 核/8 核都至少 10', !!RT && RT.jianYiZuiDaShiLiShu(2) === 10 && RT.jianYiZuiDaShiLiShu(8) === 10, RT ? [RT.jianYiZuiDaShiLiShu(2), RT.jianYiZuiDaShiLiShu(8)] : 'no runtime dist');
  check('高配仍封顶 16', !!RT && RT.jianYiZuiDaShiLiShu(32) === 16, RT ? RT.jianYiZuiDaShiLiShu(32) : 'no runtime dist');
}

console.log('[11] 值班者自执行：门槛保留 + 全失败无条件兜底 + 用户禁止例外');
{
  const K = M.zhiBanKeZiXing;
  const Y = M.yongHuJinZhiZhiBanZiZuo;
  const Q = M.yongHuYaoQiuZhiBanZiZuo;
  check('门槛保留：执行者 70%>65%、值班 40%<45% ⇒ 可以',
    K({ hasExecutor: true, executorConfidence: 0.7, dutyConfidence: 0.4 }).ok === true);
  check('门槛保留：执行者仍可能完成、值班不低 ⇒ 不可以',
    K({ hasExecutor: true, executorConfidence: 0.7, dutyConfidence: 0.6 }).ok === false);
  check('全失败：即使值班置信度很高，也不再卡 65/45 ⇒ 可以',
    K({ hasExecutor: true, allExecutorsFailed: true, executorConfidence: 0.2, dutyConfidence: 0.9 }).ok === true);
  check('用户明确禁止：全失败也不兜底',
    K({ hasExecutor: true, allExecutorsFailed: true, userForbidden: true }).ok === false);
  check('用户既要求又禁止：禁止优先',
    K({ userAsked: true, userForbidden: true }).ok === false);
  check('识别禁止：不要让值班者自己执行', Y('不要让值班者自己执行') === true);
  check('识别禁止：值班者不要自己做', Y('值班者不要自己做') === true);
  check('识别禁止：只调度，别让值班者兜底', Y('只调度，别让值班者兜底') === true);
  check('识别禁止：值班者不用自己执行', Y('值班者不用自己执行') === true);
  check('不误判：值班者自己执行', Y('值班者自己执行') === false);
  check('不误判：让值班者自己执行', Y('让值班者自己执行') === false);
  check('原有要求识别仍工作', Q('值班者你自己来做') === true);
  const orch = fs.readFileSync(path.join(here, '..', 'src', 'orchestrator.ts'), 'utf8');
  check('编排器两处都传“全失败 + 用户禁止”',
    (orch.match(/allExecutorsFailed: true/g) || []).length >= 2
    && (orch.match(/userForbidden: jinZhiZhiBanZiZuo/g) || []).length >= 2);
  check('负向：删掉全失败标记后，检测器会变红',
    !/allExecutorsFailed: true/.test(orch.replace(/allExecutorsFailed: true,/g, '')));
}

console.log('');
if (fail) {
  console.log(`==== verify-zhi-ban-pai-fa: ${pass} ok / ${fail} FAIL ====`);
  console.log('失败项：' + failures.join('；'));
  process.exit(1);
}
console.log(`==== verify-zhi-ban-pai-fa: ${pass} ok / 0 FAIL ====`);
