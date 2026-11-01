/**
 * verify-parallel-serial —— 第 51 轮：派发前必须判「并行 / 接力」（硬门禁）
 * 用户口径：
 *  · 我的牛马：派发者判断重复/同资源 ⇒ 接力；互不干扰 ⇒ 并行
 *  · 项目：值班者决定，同样要判
 *  · 群聊：只能聊天，默认并行（不涉及工具/分身）
 * 判据用**真函数**（import 编译产物），不靠字面。
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mod = await import(pathToFileURL(path.join(ROOT, 'packages/app-shell/dist/pai-fa-pan-ding.js')).href).catch(() => null);

let okN = 0, failN = 0;
const ok = (m) => { okN++; console.log('  ok  ' + m); };
const bad = (m) => { failN++; console.log('  FAIL ' + m); };
const need = (c, m) => (c ? ok(m) : bad(m));

if (!mod || typeof mod.panDuanPaiFa !== 'function' || typeof mod.paiFaZiYuanJian !== 'function') {
  console.log('  FAIL 编译产物里取不到 panDuanPaiFa / paiFaZiYuanJian（pai-fa-pan-ding 导出缺失）');
  console.log('\n==== verify-parallel-serial: 0 ok / 1 FAIL ====');
  process.exit(1);
}
const { panDuanPaiFa, paiFaZiYuanJian } = mod;

// ── 1. 资源键提取 ────────────────────────────────────────────────────
need(paiFaZiYuanJian('把结果写到 C:\\Users\\p\\Desktop\\a.txt').some((k) => k.startsWith('path:')), '能提取绝对路径');
need(paiFaZiYuanJian('生成 report.docx 并检查').some((k) => k === 'file:report.docx'), '能提取文件名');
need(paiFaZiYuanJian('运行 npm test 再跑 node build.js').filter((k) => k.startsWith('cmd:')).length >= 2, '能提取命令');
need(paiFaZiYuanJian('你好，随便聊聊').length === 0, '纯聊天不产生资源键');

// ── 2. 冲突 ⇒ 接力；无冲突 ⇒ 并行 ────────────────────────────────────
const tongWenJian = panDuanPaiFa([
  { task: '写 Desktop/a.txt 的第一段' },
  { task: '把 Desktop/a.txt 改成两段' },
]);
need(tongWenJian.fangShi === 'serial' && tongWenJian.chongTu.length > 0, '同一文件两个任务 ⇒ 接力（并给出冲突键）');

const buTong = panDuanPaiFa([
  { task: '写 Desktop/a.txt' },
  { task: '写 Desktop/b.txt' },
]);
need(buTong.fangShi === 'parallel' && buTong.chongTu.length === 0, '不同文件 ⇒ 并行');

const sameCmd = panDuanPaiFa([
  { task: '运行 npm test' },
  { task: '再运行 npm test 一次' },
]);
need(sameCmd.fangShi === 'serial', '同一命令 ⇒ 接力');

const active = panDuanPaiFa([{ task: '写 Desktop/c.txt' }], ['file:c.txt']);
need(active.fangShi === 'serial', '与已在跑的任务共享资源 ⇒ 接力');

const chat = panDuanPaiFa([{ task: '聊聊今天天气' }, { task: '再聊聊别的' }]);
need(chat.fangShi === 'parallel', '群聊式纯聊天 ⇒ 并行');

// ── 3. 主路径接线：派发前必须调用判定并留痕 ──────────────────────────
import fs from 'node:fs';
const em = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/electron-main.ts'), 'utf8');
need(/panDuanPaiFa\(\[\{ task: String\(args\.task/.test(em), 'spawn_subagent 派发前调用 panDuanPaiFa');
need(/chat\.xiaodi-dispatch-plan/.test(em), '判定结果进审计（可追溯）');
need(/不能并行派发/.test(em), '冲突时如实拒绝并说明（不静默并行）');
need(/paiFaZhanYong/.test(em), '有在跑资源占用表');
need(/释放它占的资源键/.test(em), '子任务结束释放资源键');

// ── 4. 项目：值班者派多执行者也要判（写同文件⇒接力，纯分析⇒并行） ──
if (typeof mod.xuYaoJieLi === 'function') {
  const xie = mod.xuYaoJieLi('请把结论写入 report.docx，并保存到桌面');
  need(xie.fangShi === 'serial' && xie.chongTu.length > 0, '项目 brief 要写具体文件 ⇒ 接力');
  const fenXi = mod.xuYaoJieLi('各自分析这份日志的异常原因，给结论');
  need(fenXi.fangShi === 'parallel', '纯分析 brief ⇒ 并行');
} else {
  bad('缺少 xuYaoJieLi（项目派发判定）');
}
import fs2 from 'node:fs';
const orc = fs2.readFileSync(path.join(ROOT, 'packages/app-shell/src/orchestrator.ts'), 'utf8');
need(/const paiFa = xuYaoJieLi\(p\.brief\)/.test(orc), '值班者派发前调用 xuYaoJieLi');
need(/paiFa\.fangShi === 'serial'/.test(orc), '接力时按顺序 await');
need(/orchestrator\.dispatch-plan/.test(orc), '派发决策进审计');

console.log(`\n==== verify-parallel-serial: ${okN} ok / ${failN} FAIL ====`);
process.exit(failN ? 1 : 0);
