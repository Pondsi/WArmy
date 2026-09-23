/**
 * 计划D：orchestrator 重试 / gateVerify / 项目侧摘要 的断言
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {QunCang} from '../dist/group-store.js';
import {AiWenTiZhongXin, AI_QUESTION_CUSTOM} from '../dist/ai-questions.js';
import {daiHuiDuYanZheng, anGuiFanHuaQuChong, guiFanLuJingMiyao} from '../dist/read-back.js';
import {JieLing, JuShu, KanbanCang} from '../../board/dist/index.js';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(selfDir, '..', '..', '..');
let pass = 0, fail = 0;
function check(l, ok, d) {
  if (ok) { pass++; console.log('  ok  ' + l); }
  else { fail++; console.log('  FAIL ' + l, d ?? ''); }
}

const main = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/electron-main.ts'), 'utf8');
const orch = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/orchestrator.ts'), 'utf8');
const yingYong = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/app.js'), 'utf8');

// ── orchestrator 重试语义 ──
check('orchestrator deps has projectMemory', /projectMemory\s*\?/.test(orch));
check('orchestrator deps has decisionContext', /decisionContext\s*\?/.test(orch));
check('orchestrator deps has runProjectGate', /runProjectGate\s*\?/.test(orch));
check('orchestrator injects projectMemory into contextItems', /projectMemory\(/.test(orch));
check('orchestrator injects decisionContext', /decisionContext\(/.test(orch));
check('orchestrator gateReason from complete_task', /complete_task/.test(orch));
check('orchestrator gateReason from verify/menjin', /验收|门禁|verify|gate/i.test(orch));
check('orchestrator runWithContextRetry called qiYong chat-send', /daiShangXiaWenChongShiYunXing/.test(main));
check('main wires runProjectGate', /runProjectGate:\s*async \((?:gid|qunId|groupId)/.test(main));
check('main wires projectMemory', /projectMemory:\s*\((?:gid|qunId|groupId)/.test(main));
check('main wires decisionContext', /decisionContext:\s*\((?:gid|qunId|groupId)/.test(main));
check('main DEFAULT_GATE_VERIFY', /DEFAULT_GATE_VERIFY/.test(main));
check('main gateVerifyForProjectType', /function gateVerifyForProjectType/.test(main));
check('main passes gateVerify qiYong group create', /gateVerify:\s*gateVerifyForProjectType/.test(main));
check('main context-too-small message', /contextTooSmall/.test(main));
check('yunxingXiangmuMenjinYici exists', /function yunxingXiangmuMenjinYici/.test(main));
check('门禁节流 3s（运行记录 + 3000ms 窗口）', /3000/.test(main) && /Menjin|menjin/.test(main));
const archiveSrc = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/archive-cleanup.ts'), 'utf8');
check('tiQuJieGouHuaZhaiYao exists', /export function tiQuJieGouHuaZhaiYao/.test(archiveSrc));
check('档案条目有可选 structured 字段（ArchiveEntry.structured?: GuiDangJieGou）', /structured\?: GuiDangJieGou/.test(archiveSrc));
check('session-summary stores structured', /structured:\s*\{[\s\S]*bullets:/.test(main));
check('extractKnowledge uses structured events', /structured\.decisions\[0\]/.test(archiveSrc));
check('panel summary shown for projects (via panelVisibilityFor)', /summary:\s*kind === 'internal' \|\| chat/.test(yingYong));

// ── 项目侧摘要 ──
check('session-summary IPC', /warmy:huiHuaZhaiYao/.test(main));
check('session-summary uses archiver', /archiver\?\.archive/.test(main));
check('会话摘要会提炼知识（改名后：extractKnowledgeFromArchive）', /congGuiDangTiQuZhiShi/.test(main));
check('会话摘要会合并用户偏好（改名后：mergeUserPreferences）', /heBingYongHuPianHao/.test(main));
check('summary button in renderer', /anNiuGenZhaiYao/.test(yingYong));
check('auto-summary toggle in renderer', /ziDongZhaiYaoKaiGuan/.test(yingYong));
check('autoSummary default qiYong in settings', /autoSummary:\s*true/.test(fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/settings-store.ts'), 'utf8')));

// ── 决策卡 ──
const hub = new AiWenTiZhongXin();
const q = hub.daKai({ groupId: 'g1', title: '是否容器中开发？', options: [{ biaoQian: '容器' }, { biaoQian: '本机' }] });
check('ai question allowCustom', q.allowCustom === true);
// 去重：同标题且仍 pending 时应返回同一张卡
const q2 = hub.daKai({ groupId: 'g1', title: '是否容器中开发？', options: [{ biaoQian: 'x' }] });
check('ai question dedupe pending same biaoTi', q2.id === q.id, q2.id);
const ans = hub.answer(q.id, AI_QUESTION_CUSTOM, '先本机');
check('ai question custom answer', ans.ok === true && ans.inject.includes('先本机'), ans.inject);
// 回答后新卡可再开
const q3 = hub.daKai({ groupId: 'g1', title: '是否容器中开发？', options: [{ biaoQian: '容器' }] });
check('ai question new after answered', q3.id !== q.id, q3.id);

// ── read-back / dedupe ──
const rb = await daiHuiDuYanZheng(() => 'x', () => 'x', (a, b) => a === b);
check('read-back confident match', rb.confident === true);
const d = anGuiFanHuaQuChong(['C:/a/b', 'c:/a/b/'], guiFanLuJingMiyao);
check('path dedupe', d.LieBiao.length === 1 && d.removed === 1, d);

// ── board tree ──
const board = new KanbanCang(path.join(os.tmpdir(), 'warmy-planD-' + Date.now()));
const ev = JieLing('新建任务 发布 / 校验文档', 'g1');
check('board parse parent/child', ev && ev.parentId === '发布', ev);
board.append(ev, 'duty');
board.append({ groupId: 'g1', action: 'update_progress', biaoTi: '校验文档', jinDu: 80, parsedFrom: 'x' }, 'duty');
const tasks = board.listTasks('g1');
const parent = tasks.find((t) => t.id === '发布');
check('board parent aggregated jinDu', parent && parent.jinDu === 80, parent);

// ── 项目记忆 + 门禁 (group-store) ──
const dir = path.join(os.tmpdir(), 'warmy-planD-gs-' + Date.now());
const {anQuanYuanZiXieJson} = await import('../dist/atomic-json.js');
anQuanYuanZiXieJson(path.join(dir, 'groups.json'), {
  version: 1,
  groups: [{ groupId: 'g1', ming: 'P', type: 'internal', directedMode: false, dutyInstanceId: null, createdAt: Date.now(), updatedAt: Date.now(), origin: 'ipc' }],
  members: {},
});
const gs = new QunCang(path.join(dir, 'groups.json'));
gs.setProjectMemory('g1', '## Rules\n- 端口 59599');
gs.setProjectAttrs('g1', { gateVerify: ['packages/app-shell/scripts/verify-docs.mjs', 'packages/app-shell/scripts/verify-i18n-locales.mjs'] });
const p = gs.projectOf('g1');
check('project memory in group-store', p?.memory?.includes('59599'));
check('gateVerify two scripts', Array.isArray(p?.gateVerify) && p.gateVerify.length === 2, p?.gateVerify);
check('normalizeProject preserves memory', gs.projectOf('g1')?.memory?.includes('59599'));

console.log(`\n==== verify-planD: ${pass} ok / ${fail} FAIL ====`);
process.exit(fail === 0 ? 0 : 1);
