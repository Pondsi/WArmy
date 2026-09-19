/**
 * 计划D：orchestrator 重试 / gateVerify / 项目侧摘要 的断言
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { GroupStore } from '../dist/group-store.js';
import { AiQuestionHub, AI_QUESTION_CUSTOM } from '../dist/ai-questions.js';
import { withReadBack, dedupeByNorm, normPathKey } from '../dist/read-back.js';
import { parseBoardCommand, withTreeAggregation, BoardStore } from '../../board/dist/index.js';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(selfDir, '..', '..', '..');
let pass = 0, fail = 0;
function check(l, ok, d) {
  if (ok) { pass++; console.log('  ok  ' + l); }
  else { fail++; console.log('  FAIL ' + l, d ?? ''); }
}

const main = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/electron-main.ts'), 'utf8');
const orch = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/orchestrator.ts'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/app.js'), 'utf8');

// ── orchestrator 重试语义 ──
check('orchestrator deps has projectMemory', /projectMemory\s*\?/.test(orch));
check('orchestrator deps has decisionContext', /decisionContext\s*\?/.test(orch));
check('orchestrator deps has runProjectGate', /runProjectGate\s*\?/.test(orch));
check('orchestrator injects projectMemory into contextItems', /projectMemory\(/.test(orch));
check('orchestrator injects decisionContext', /decisionContext\(/.test(orch));
check('orchestrator gateReason from complete_task', /complete_task/.test(orch));
check('orchestrator gateReason from verify/gate', /验收|门禁|verify|gate/i.test(orch));
check('orchestrator runWithContextRetry called on chat-send', /runWithContextRetry/.test(main));
check('main wires runProjectGate', /runProjectGate:\s*async \(gid, reason\)/.test(main));
check('main wires projectMemory', /projectMemory:\s*\(gid\)/.test(main));
check('main wires decisionContext', /decisionContext:\s*\(gid\)/.test(main));
check('main DEFAULT_GATE_VERIFY', /DEFAULT_GATE_VERIFY/.test(main));
check('main passes gateVerify on group create', /gateVerify:\s*DEFAULT_GATE_VERIFY/.test(main));
check('main context-too-small message', /contextTooSmall/.test(main));
check('runProjectGateOnce exists', /function runProjectGateOnce/.test(main));
check('gate throttle 3s', /gateRuns/.test(main) && /3000/.test(main));

// ── 项目侧摘要 ──
check('session-summary IPC', /warmy:session-summary/.test(main));
check('session-summary uses archiver', /archiver\?\.archive/.test(main));
check('session-summary extracts knowledge', /extractKnowledgeFromArchive/.test(main));
check('session-summary merges user prefs', /mergeUserPreferences/.test(main));
check('summary button in renderer', /btn-gen-summary/.test(app));
check('auto-summary toggle in renderer', /auto-summary-toggle/.test(app));
check('autoSummary default on in settings', /autoSummary:\s*true/.test(fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/settings-store.ts'), 'utf8')));

// ── 决策卡 ──
const hub = new AiQuestionHub();
const q = hub.open({ groupId: 'g1', title: '是否容器中开发？', options: [{ label: '容器' }, { label: '本机' }] });
check('ai question allowCustom', q.allowCustom === true);
// 去重：同标题且仍 pending 时应返回同一张卡
const q2 = hub.open({ groupId: 'g1', title: '是否容器中开发？', options: [{ label: 'x' }] });
check('ai question dedupe pending same title', q2.id === q.id, q2.id);
const ans = hub.answer(q.id, AI_QUESTION_CUSTOM, '先本机');
check('ai question custom answer', ans.ok === true && ans.inject.includes('先本机'), ans.inject);
// 回答后新卡可再开
const q3 = hub.open({ groupId: 'g1', title: '是否容器中开发？', options: [{ label: '容器' }] });
check('ai question new after answered', q3.id !== q.id, q3.id);

// ── read-back / dedupe ──
const rb = await withReadBack(() => 'x', () => 'x', (a, b) => a === b);
check('read-back confident match', rb.confident === true);
const d = dedupeByNorm(['C:/a/b', 'c:/a/b/'], normPathKey);
check('path dedupe', d.list.length === 1 && d.removed === 1, d);

// ── board tree ──
const board = new BoardStore(path.join(os.tmpdir(), 'warmy-planD-' + Date.now()));
const ev = parseBoardCommand('新建任务 发布 / 校验文档', 'g1');
check('board parse parent/child', ev && ev.parentId === '发布', ev);
board.append(ev, 'duty');
board.append({ groupId: 'g1', action: 'update_progress', title: '校验文档', progress: 80, parsedFrom: 'x' }, 'duty');
const tasks = board.listTasks('g1');
const parent = tasks.find((t) => t.id === '发布');
check('board parent aggregated progress', parent && parent.progress === 80, parent);

// ── 项目记忆 + 门禁 (group-store) ──
const dir = path.join(os.tmpdir(), 'warmy-planD-gs-' + Date.now());
const { writeJsonAtomicSafe } = await import('../dist/atomic-json.js');
writeJsonAtomicSafe(path.join(dir, 'groups.json'), {
  version: 1,
  groups: [{ groupId: 'g1', name: 'P', type: 'internal', directedMode: false, dutyInstanceId: null, createdAt: Date.now(), updatedAt: Date.now(), origin: 'ipc' }],
  members: {},
});
const gs = new GroupStore(path.join(dir, 'groups.json'));
gs.setProjectMemory('g1', '## Rules\n- 端口 59599');
gs.setProjectAttrs('g1', { gateVerify: ['packages/app-shell/scripts/verify-docs.mjs', 'packages/app-shell/scripts/verify-i18n-locales.mjs'] });
const p = gs.projectOf('g1');
check('project memory in group-store', p?.memory?.includes('59599'));
check('gateVerify two scripts', Array.isArray(p?.gateVerify) && p.gateVerify.length === 2, p?.gateVerify);
check('normalizeProject preserves memory', gs.projectOf('g1')?.memory?.includes('59599'));

console.log(`\n==== verify-planD: ${pass} ok / ${fail} FAIL ====`);
process.exit(fail === 0 ? 0 : 1);
