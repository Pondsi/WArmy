/**
 * verify-r50-plan-schedule —— 第 50 轮：计划/定时「变更不删旧」+ 软门禁分区可见
 * 判据全是源码层真值（纯读，不起 Electron），对应用户口径：
 *   1) 计划中途变更：旧步骤保留并标「已停止」，再加新的
 *   2) 定时任务变更：旧条禁用留档，再挂新条（Temporal 禁旧启新）
 *   3) 设置→门禁：软硬分区展示，空软门禁也有说明（不是「没有软门禁」）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const MAIN = path.join(ROOT, 'packages/app-shell/src/electron-main.ts');
const APP = path.join(ROOT, 'packages/app-shell/src/renderer/app.js');
const ZH = path.join(ROOT, 'packages/app-shell/src/i18n/zh-CN.json');

let okN = 0, failN = 0;
const ok = (m) => { okN++; console.log('  ok  ' + m); };
const bad = (m) => { failN++; console.log('  FAIL ' + m); };
const need = (cond, m) => (cond ? ok(m) : bad(m));

const em = fs.readFileSync(MAIN, 'utf8');
const ap = fs.readFileSync(APP, 'utf8');
const zh = JSON.parse(fs.readFileSync(ZH, 'utf8'));

// ── 1. 计划：deleted/removed ⇒ 标 blocked 留档，不抹条 ─────────────────
need(/zt0 === 'deleted' \|\| zt0 === 'removed'/.test(em), 'plan_update 仍识别 deleted/removed');
need(/status: 'blocked' as const/.test(em) && /计划变更已停止/.test(em),
  '被删步骤标 blocked（已停止）并写「计划变更已停止」留档');
need(em.indexOf('计划变更已停止') > em.indexOf("zt0 === 'deleted'"),
  '停止文案出现在 deleted 处理分支之后');
need(/const baoLiu = jiu[\s\S]{0,400}status: 'blocked' as const/.test(em),
  '未再出现在新计划里的旧步骤：pending/doing 改标 blocked 而不是留成待办');
need(/已停止（旧步骤保留）/.test(em), '旧步骤保留的 note 文案在');

// ── 2. 定时：同名替换 ⇒ 旧条 status=stopped + replacedBy，不 splice ──
need(/replaced-by-new/.test(em) && /replacedBy = ren.id/.test(em),
  'schedule_task 同名替换：旧条 stoppedReason=replaced-by-new、replacedBy=新 id');
need(/dingShi\.superseded/.test(em), '替换动作进审计 dingShi.superseded');
need(/status\?: 'active' \| 'stopped'/.test(em), 'DingShiRenWu 带 status: active|stopped');
// 软删：不再 splice 抹条
const shanChu = em.slice(em.indexOf("warmy:dingShiRenWuShanChu"), em.indexOf("warmy:dingShiRenWuShanChu") + 1800);
need(!/dingShiRenWuJi\.splice/.test(shanChu), 'dingShiRenWuShanChu 不再 splice 硬删');
need(/status = 'stopped'/.test(shanChu) && /user-delete/.test(shanChu),
  '删除改为软删：status=stopped + user-delete 留档');
need(/dingShi\.soft-delete/.test(shanChu), '软删进审计 dingShi.soft-delete');
// 跑满 repeat 也标 stopped
need(/repeat-exhausted/.test(em), 'repeat 跑满标 stoppedReason=repeat-exhausted');

// ── 3. 渲染层：软硬分区 + 空软门禁说明 + 定时「已停止」可见 ──────────
need(/gate\.hardSection/.test(ap) && /gate\.softSection/.test(ap),
  '门禁面板有「硬门禁 / 软门禁」分区标题');
need(/gate\.softEmpty/.test(ap), '软门禁为空时显示说明（不是静默不渲染）');
need(/anNiuTianJiaMenJin/.test(ap), '「新增软门禁」按钮仍在');
need(/panel\.schedule\.replaced/.test(ap) && /panel\.schedule\.stopped/.test(ap),
  '定时任务卡片显示「已停止 / 已被新任务替换」');
need(/stoppedReason/.test(ap), '渲染层读 stoppedReason 区分停止原因');
// 软删后不从本地列表抹掉
need(!/state\.dingShiRenWu = \(state\.dingShiRenWu \|\| \[\]\)\.filter\(\(x\) => x\.id !== b\.getAttribute\('data-sch-del'\)\)/.test(ap),
  '软删后不再从本地 state 过滤掉条目（留档可见）');

// ── 4. i18n：新键 10 包齐 ────────────────────────────────────────────
const NEW_KEYS = [
  'panel.schedule.replaced', 'panel.schedule.softDeleted', 'panel.schedule.exhausted',
  'panel.schedule.userPause', 'panel.schedule.stopped', 'panel.schedule.replacedBy',
  'panel.schedule.delFail', 'gate.hardSection', 'gate.hardSectionHint',
  'gate.softSection', 'gate.softSectionHint', 'gate.softEmpty',
];
const locDir = path.join(ROOT, 'packages/app-shell/src/i18n');
const locs = fs.readdirSync(locDir).filter((f) => f.endsWith('.json'));
need(locs.length >= 10, `语言包数 ${locs.length} ≥ 10`);
let keysOk = true;
for (const f of locs) {
  const j = JSON.parse(fs.readFileSync(path.join(locDir, f), 'utf8'));
  for (const k of NEW_KEYS) {
    if (!j[k] || !String(j[k]).trim()) { keysOk = false; bad(`${f} 缺 ${k}`); }
  }
}
if (keysOk) ok(`新 ${NEW_KEYS.length} 键在 ${locs.length} 个语言包里均非空`);

// ── 5. zh 文案与用户口径对齐 ─────────────────────────────────────────
need(zh['panel.plan.st.blocked'] === '已停止', '计划 blocked 显示为「已停止」');
need(zh['gate.softEmpty'].includes('不是没有功能'), '软门禁空态明确说明「不是没有功能」');
need(zh['panel.schedule.replaced'] === '已被新任务替换', '定时替换文案正确');

console.log(`\n==== verify-r50-plan-schedule: ${okN} ok / ${failN} FAIL ====`);
process.exit(failN ? 1 : 0);
