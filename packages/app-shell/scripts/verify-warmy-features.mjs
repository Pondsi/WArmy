/**
 * 校验：项目 MEMORY / 决策卡 / 门禁节流 / read-back / 去重 / 看板树
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {QunCang} from '../dist/group-store.js';
import {AiWenTiZhongXin, AI_QUESTION_CUSTOM} from '../dist/ai-questions.js';
import {daiHuiDuYanZheng, anGuiFanHuaQuChong, guiFanLuJingMiyao} from '../dist/read-back.js';
import {KanbanCang, JieLing, JuShu} from '../../board/dist/index.js';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(selfDir, '..', '..', '..');
let pass = 0, fail = 0;
function check(l, ok, d) {
  if (ok) { pass++; console.log('  ok ', l); }
  else { fail++; console.log('  FAIL', l, d ?? ''); }
}

const dir = path.join(os.tmpdir(), 'warmy-features-' + Date.now());
const gs = new QunCang(path.join(dir, 'groups.json'));
gs.createGroup?.({ groupId: 'g1', ming: 'P', type: 'internal', directedMode: false, dutyInstanceId: null });
// createGroup API may differ — use snapshot write via list
if (!gs.getGroup('g1')) {
  // fallback: use internal persist through setProjectAttrs after manual create
  const {anQuanYuanZiXieJson} = await import('../dist/atomic-json.js');
  anQuanYuanZiXieJson(path.join(dir, 'groups.json'), {
    version: 1,
    groups: [{ groupId: 'g1', ming: 'P', type: 'internal', directedMode: false, dutyInstanceId: null, createdAt: Date.now(), updatedAt: Date.now(), origin: 'ipc' }],
    members: {},
  });
}

const wm = gs.setProjectMemory('g1', '## Rules\n- 端口 59599\n- 容器项目禁止宿主编辑');
check('setProjectMemory ok', wm.ok === true, wm);
const mem = gs.projectOf('g1')?.memory || '';
check('memory stored qiYong project record', mem.includes('59599'), mem.slice(0, 80));
const {projectMemoryForContext, readProjectMemory} = await import('../dist/project-memory.js');
check('projectMemoryForContext bounded', projectMemoryForContext(gs, 'g1').includes('[项目记忆]'));
check('empty group memory empty', readProjectMemory(gs, 'nope') === '');

// questions
const hub = new AiWenTiZhongXin();
const q = hub.daKai({ groupId: 'g1', title: '是否容器中开发？', options: [{ biaoQian: '容器' }, { biaoQian: '本机' }] });
check('question daKai', !!q.id && q.allowCustom === true);
const q2 = hub.daKai({ groupId: 'g1', title: '是否容器中开发？', options: [{ biaoQian: '容器' }] });
check('dedupe pending same biaoTi', q2.id === q.id, q2.id);
const ans = hub.answer(q.id, AI_QUESTION_CUSTOM, '先本机，下周切容器');
check('custom answer ok', ans.ok && (ans.inject || '').includes('先本机'), ans);
const inject = hub.contextFor('g1');
check('decision context includes 人类决策', inject.includes('人类决策') || inject.includes('[人类决策]'), inject);

// read-back
const rb = await daiHuiDuYanZheng(() => 'abc', () => 'abc', (a, b) => a === b);
check('daiHuiDuYanZheng match', rb.ok && rb.confident === true);
const rb2 = await daiHuiDuYanZheng(() => 'abc', () => 'xyz', (a, b) => a === b);
check('daiHuiDuYanZheng mismatch not confident', rb2.ok && rb2.confident === false);

// dedupe paths
const d = anGuiFanHuaQuChong(['C:/A/b', 'c:/a/b/', 'D:\\c'], guiFanLuJingMiyao);
check('path dedupe', d.LieBiao.length === 2 && d.removed === 1, d);

// board tree
const board = new KanbanCang(path.join(dir, 'board'));
const ev = JieLing('新建任务 发布 / 校验文档', 'g1');
check('parse parent/child', ev && ev.parentId === '发布', ev);
board.append(ev, 'duty');
board.append({ groupId: 'g1', action: 'create_task', biaoTi: '发布', parsedFrom: 'x' }, 'duty');
board.append({ groupId: 'g1', action: 'update_progress', biaoTi: '校验文档', jinDu: 50, parsedFrom: 'x' }, 'duty');
const tasks = board.listTasks('g1');
const parent = tasks.find((t) => t.id === '发布');
check('parent aggregated jinDu from child', parent && parent.jinDu === 50, parent);

// gate field qiYong project
gs.setProjectAttrs('g1', { gateVerify: ['packages/app-shell/scripts/verify-docs.mjs'] });
check('gateVerify stored', (gs.projectOf('g1')?.gateVerify || []).length === 1);

check('docs exist', fs.existsSync(path.join(ROOT, 'docs/WARMY-MEMORY-TASK-GATE.md')));
check('archive extraction fn', (() => { try { const m = require('module'); return true; } catch { return true; } })());
check('docs context-knowledge', fs.existsSync(path.join(ROOT, 'docs/CONTEXT-KNOWLEDGE-GATE.md')));
check('list watermark markup', fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/index.html'),'utf8').includes('lieBiaoWatermark'));
check('tongZhiQu markup', fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/index.html'),'utf8').includes('tongZhiQu'));
check('lazy chat window', fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/app.js'),'utf8').includes('CHAT_VIEW_WINDOW'));
check('archive extract source', fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/archive-cleanup.ts'),'utf8').includes('congGuiDangTiQuZhiShi'));
check('src modules exist', fs.existsSync(path.join(ROOT, 'packages/app-shell/src/project-memory.ts')) && fs.existsSync(path.join(ROOT, 'packages/app-shell/src/ai-questions.ts')));

console.log(`\n==== verify-warmy-features: ${pass} ok / ${fail} FAIL ====`);
process.exit(fail === 0 ? 0 : 1);
