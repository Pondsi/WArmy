/**
 * 计划2：摘要质量 — 结构化提炼 / 归档落盘 / 知识事件 / 项目侧面板 / 跳转回退
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tiQuJieGouHuaZhaiYao, congGuiDangTiQuZhiShi, ZhiShiGuiDangQi, heBingYongHuPianHao } from '../dist/archive-cleanup.js';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(selfDir, '..', '..', '..');
let pass = 0, fail = 0;
function check(l, ok, d) {
  if (ok) { pass++; console.log('  ok  ' + l); }
  else { fail++; console.log('  FAIL ' + l, d ?? ''); }
}

// ── 1. extractStructuredSummary 模式匹配 ──
const text = [
  'user: 我们决定使用端口 59599',
  'assistant: 决定：先做文档门禁',
  'assistant: 待办 补齐 ja 语言包',
  'assistant: 风险 容器未就绪时不能假装主机开发',
  'assistant: 今天同步了看板进度',
  'assistant: 又聊了一些无关细节',
].join('\n');
const st = tiQuJieGouHuaZhaiYao({ groupId: 'g1', title: '摘要质量', text });
check('structured has decisions', st.decisions.some((d) => /决定/.test(d)), st.decisions);
check('structured has todos', st.todos.some((d) => /待办/.test(d)), st.todos);
check('structured has risks', st.risks.some((d) => /风险/.test(d)), st.risks);
check('structured has bullets', Array.isArray(st.bullets) && st.bullets.length >= 1);
check('structured title bounded', st.title.length <= 100);

// ── 2. extractKnowledgeFromArchive 用结构化事件 ──
const ex = congGuiDangTiQuZhiShi({
  groupId: 'g1',
  title: '发布准备',
  summary: '决定：验证 docs\n待办：推送 GitHub\n今天开了会',
});
check('extraction entities', ex.entities.length >= 1);
check('extraction events from structured', ex.events.length >= 1 && ex.events.some((e) => /决定|验证|docs|推送|GitHub|发布/.test((e.title || '') + (e.result || ''))), ex.events);
check('extraction event result non-empty', !!ex.events[0]?.result);

// ── 3. KnowledgeArchiver 持久化 structured ──
const tmp = path.join(os.tmpdir(), 'warmy-summary-q-' + Date.now());
const arch = new ZhiShiGuiDangQi(tmp);
const entry = arch.archive({
  id: 'arc-t1',
  groupId: 'g1',
  title: '会话摘要',
  summary: '## 决策\n- 用 59599',
  anchors: [{ file: 'chat-log', seq: 12, recordId: 'seq:12' }],
  structured: { bullets: ['要点A'], decisions: ['用 59599'], todos: [], risks: [] },
});
check('archive entry keeps structured', entry.structured && entry.structured.decisions[0] === '用 59599', entry.structured);
const listed = arch.list('g1');
check('archive list returns structured', listed[listed.length - 1]?.structured?.decisions?.length === 1);
check('archive entry has anchors for jump', Array.isArray(entry.anchors) && entry.anchors[0].seq === 12);

// ── 4. 用户偏好合并 ──
const pref = heBingYongHuPianHao(tmp, [{ key: 'preference.port', value: '59599', source: 'archive:g1' }]);
check('mergeUserPreferences ok', pref.ok === true && pref.count >= 0);

// ── 5. 源码断言：项目侧面板 + 跳转回退 + session-summary 锚点 ──
const app = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/app.js'), 'utf8');
const main = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/electron-main.ts'), 'utf8');
const archiveSrc = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/archive-cleanup.ts'), 'utf8');
// 右栏分区：唯一权威是 applyPanelVisibility（按会话类型给每个卡片开关）。
// 历史写法（kind === 'internal' || chat）已重构 —— 断言改为规则本身，避免再次被重构打脸。
check('panel 分区函数唯一权威 (applyPanelVisibility)', /function applyPanelVisibility/.test(app));
check('panelVisibilityFor: 项目/聊天显示摘要', /summary:\s*kind === 'internal' \|\| chat/.test(app));
check('panelVisibilityFor: 项目/聊天显示知识库', /kb:\s*kind === 'internal' \|\| chat/.test(app));
check('panelVisibilityFor: 成员仅项目/群聊', /members:\s*group/.test(app));
check('panel 未选会话时全隐藏', /if \(!kind \|\| kind === 'none'\)/.test(app));
check('renderList 收口刷新分区', /function renderList\(\)\s*\{[\s\S]{0,120}refreshPanelVisibility/.test(app));
check('structured rows clickable jump', /data-jump-st/.test(app));
check('jump fallback uses structured text', /st\.decisions && st\.decisions\[0\]/.test(app));
check('jump fallback opens chat when no hit', /hits\.length[\s\S]*openChat/.test(app));
check('session-summary attaches anchors from logs', /anchors[\s\S]*seq: Number\(l\.seq/.test(main) && /recordId: `seq:\$\{l\.seq\}`/.test(main));
check('session-summary stores structured', /structured:\s*\{[\s\S]*bullets:/.test(main));
check('档案条目有可选 structured 字段（改名后：ArchiveEntry/GuiDangJieGou）', /structured\?: GuiDangJieGou/.test(archiveSrc));
check('extractKnowledge uses structured events', /structured\.decisions\[0\]/.test(archiveSrc));

// ── 6. gateVerify 类型选择源码断言 ──
check('gateVerifyForProjectType exists', /function gateVerifyForProjectType/.test(main));
check('create always writes gateVerify', /gateVerify:\s*gateVerifyForProjectType/.test(main));
check('code project adds router+memory gates', /verify-router-queue\.mjs/.test(main) && /verify-memory\.mjs/.test(main));

console.log(`\n==== verify-summary-quality: ${pass} ok / ${fail} FAIL ====`);
process.exit(fail === 0 ? 0 : 1);
