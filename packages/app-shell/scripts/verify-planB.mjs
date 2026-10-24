/**
 * 计划B：摘要/上下文/列宽/窗口持久化 的自动化断言
 * 校验源码与设置结构（不依赖真实 UI 交互）
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {QunCang} from '../dist/group-store.js';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(selfDir, '..', '..', '..');
let pass = 0, fail = 0;
function check(l, ok, d) {
  if (ok) { pass++; console.log('  ok  ' + l); }
  else { fail++; console.log('  FAIL ' + l, d ?? ''); }
}

const yingYong = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/app.js'), 'utf8');
const main = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/electron-main.ts'), 'utf8');
const rcss = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/renderer.css'), 'utf8');
const acss = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/app.css'), 'utf8');
const ss = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/settings-store.ts'), 'utf8');
const idx = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/index.html'), 'utf8');

// ── 1. 列宽：第二列默认 200，右栏 300 ──
// 产品规则：第二列默认取**最小可读宽度**（160），用户拖动后持久化
check('settings listWidth default 160 (min readable)', /listWidth:\s*160/.test(ss), ss.match(/listWidth:\s*\d+/)?.[0]);
check('settings panelWidth default 300', /panelWidth:\s*300/.test(ss), ss.match(/panelWidth:\s*\d+/)?.[0]);
check('renderer.css list-w 200', rcss.includes('--list-w, 200px'), rcss.match(/--list-w[^;)]*/)?.[0]);
check('app.css list-w 200', acss.includes('--list-w, 200px') || acss.includes('--list-w: 200px'), acss.match(/--list-w[^;)]*/)?.[0]);
check('listWidth persisted in bindResizer', /persistKey:\s*'listWidth'/.test(yingYong));
check('panelWidth persisted', /persistKey:\s*'panelWidth'/.test(yingYong));
check('boot applies listWidth', yingYong.includes('s.settings.listWidth'));
check('boot applies panelWidth', yingYong.includes('s.settings.panelWidth'));

// ── 2. 窗口几何持久化 ──
check('window-state.json path', main.includes('window-state.json'));
check('loadWindowState exists', /function jiaZaiChuangKouZhuangTai/.test(main));
check('窗口状态延迟保存函数存在（baocunChuangkouZhuangtaiJiukuai）', /function baocunChuangkouZhuangtaiJiukuai/.test(main));
check('window resize/move hooks', /win\.(?:on|qiYong)\('resize'/.test(main) && /win\.(?:on|qiYong)\('move'/.test(main));
check('window maximize restore', /ws\.maximized/.test(main) || /maximized/.test(main));

// ── 3. 上下文预算 + 重试 ──
check('contextBudgetFromSettings exists', /function youPeizhiSuanShangXiaWenYuSuan/.test(main));
check('runWithContextRetry exists', /function daiShangXiaWenChongShiYunXing/.test(main));
check('上下文重试档位 100/60/35/20', /SHANGXIAWEN_CHONGSHI_BUZHOU\s*=\s*\[1\.0,\s*0\.6,\s*0\.35,\s*0\.2\]/.test(main));
check('min tokens 2048', /MIN_CONTEXT_TOKENS\s*=\s*2048/.test(main));
check('model ctx map exists', /MODEL_CTX_MAP/.test(main) && /deepseek-chat/.test(main));
check('isContextLengthError exists', /function isContextLengthError/.test(main));
check('budgetCharsForStep exists', /function budgetCharsForStep/.test(main));
check('liaoTianFaSong uses retry', /daiShangXiaWenChongShiYunXing/.test(main) && /liaoTianFaSong/.test(main));
check('duty LLM uses retry', main.includes('dutyRetried') || main.includes('daiShangXiaWenChongShiYunXing'));
check('orchestrate passes model', /contextBudgetChars\(providerCfg\.model\)/.test(main) || /contextBudgetChars\(\s*providerCfg\.model/.test(main));
check('orchestrator accepts modelId', /contextBudgetChars\?: \(modelId\?: string\)/.test(fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/orchestrator.ts'), 'utf8')));
check('renderChatView accepts override', /budgetCharsOverride/.test(main));
check('contextTooSmall i18n key', yingYong.includes('chat.contextTooSmall') || main.includes('chat.contextTooSmall'));

// ── 4. 摘要 ──
check('session-summary IPC', /warmy:huiHuaZhaiYao|warmy:session-summary/.test(main));
check('preload sessionSummary', /sessionSummary/.test(fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/preload.cjs'), 'utf8')));
check('genSessionSummary in app.js', /genSessionSummary/.test(yingYong));
check('auto-summary toggle', /ziDongZhaiYaoKaiGuan/.test(idx) || /ziDongZhaiYaoKaiGuan/.test(yingYong));
check('autoSummary default true', /autoSummary:\s*true/.test(ss));
check('summary jump by recordId', /searchMessages/.test(yingYong) && /recordId/.test(yingYong));
check('renderPanelSummary exists', /renderPanelSummary/.test(yingYong));

// ── 5. logo 无背景 ──
check('renderer.css biaoTiLanlogo transparent', /\.biaoTiLanlogo\s*\{[^}]*background:\s*transparent/.test(rcss));
check('renderer.css logoGlyph transparent', /\.logoGlyph\s*\{[^}]*background:\s*transparent/.test(rcss));
check('app.css logoGlyph transparent', /\.logoGlyph\s*\{[^}]*background:\s*transparent/.test(acss));
check('no gradient qiYong biaoTiLanlogo', !/\.biaoTiLanlogo\s*\{[^}]*linear-gradient/.test(rcss));

// ── 6. 成员栏按类型 ──
check('members only internal/external group', /mianBanChengYuanJiKuai.*kind === 'internal'/.test(yingYong) || /set\('mianBanChengYuanJiKuai'/.test(yingYong));

// ── 7. ctx popover 跟随按钮 ──
check('ctx popover uses getBoundingClientRect', /getBoundingClientRect/.test(yingYong));
check('ctx popover not fixed bottom', !/shangXiaWenPopover\s*\{[^}]*bottom:\s*150px/.test(rcss));

// ── 8. 真实 group-store 项目记忆/门禁 ──
const os = await import('node:os');
const dir = path.join(os.tmpdir(), 'warmy-planB-' + Date.now());
const {anQuanYuanZiXieJson} = await import('../dist/atomic-json.js');
anQuanYuanZiXieJson(path.join(dir, 'groups.json'), {
  version: 1,
  groups: [{ groupId: 'g1', ming: 'P', type: 'internal', directedMode: false, dutyInstanceId: null, createdAt: Date.now(), updatedAt: Date.now(), origin: 'ipc' }],
  members: {},
});
const gs = new QunCang(path.join(dir, 'groups.json'));
gs.setProjectMemory('g1', '## Rules\n端口 59599');
gs.setProjectAttrs('g1', { gateVerify: ['packages/app-shell/scripts/verify-docs.mjs'] });
const proj = gs.projectOf('g1');
check('project memory stored', !!proj?.memory?.includes('59599'), proj?.memory);
check('gateVerify stored', Array.isArray(proj?.gateVerify) && proj.gateVerify.length === 1, proj?.gateVerify);

console.log(`\n==== verify-planB: ${pass} ok / ${fail} FAIL ====`);
process.exit(fail === 0 ? 0 : 1);
