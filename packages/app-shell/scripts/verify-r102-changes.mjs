/**
 * verify-r102-changes.mjs —— 第 102 轮：滚动摘要语义 / 引导卡去聊天 / nm 与主窗口最大化。
 *
 * 静态度：
 *   · 主窗口预留式最大化的纯几何真值表（左右上下 / 多边 / 负坐标副屏 / 任务栏 / 夹取）；
 *   · 未查看摘要只由真实新回复登记，上翻不生成，查看后清除；
 *   · 引导卡「去聊天」只清理挡路窗口，绝不自动最小化；
 *   · nm 自己最大化仍走系统原生最大化；
 *   · 左右吸附校准方向（本轮真机发现的既有 bug）。
 * 真机几何/焦点/气泡由 dev/gates/verify-r102-live.mjs 另测。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const app = read('src/renderer/app.js');
const main = read('src/electron-main.ts');
const nm = read('src/nm-viewer-win.ts');
const pp = read('src/protected-paths.ts');
const wt = read('src/work-tools.ts');

let pass = 0;
const ok = (name, cond) => { assert.ok(cond, name); pass++; console.log('PASS ' + name); };
const neg = (name, cond) => { assert.ok(!cond, name); pass++; console.log('PASS ' + name); };
const bodyOf = (src, startRe, endRe) => {
  const i = src.search(startRe);
  if (i < 0) return '';
  const rest = src.slice(i);
  const j = rest.search(endRe);
  return j < 0 ? rest : rest.slice(0, j);
};

/* ═══ 1. 纯几何：主窗口最大化预留第四列 ═══════════════════════════════════ */
const tree = ts.createSourceFile('nm.ts', nm, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const pick = (name) => {
  let out = null;
  const walk = (n) => {
    if (out) return;
    if (ts.isFunctionDeclaration(n) && n.name?.text === name) out = n.getText(tree);
    if (!out) ts.forEachChild(n, walk);
  };
  walk(tree);
  if (!out) throw new Error('missing ' + name);
  return out.replace(/^\s*export\s+/gm, '');
};
const runPure = (src) => {
  const ctx = vm.createContext({});
  const jsOut = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText;
  vm.runInContext(jsOut, ctx);
  return ctx;
};
const pureSrc = pick('nmJiSuanZhuZuiDaBuJu');
const P = runPure(pureSrc).nmJiSuanZhuZuiDaBuJu;
const K = (x, y, width, height) => ({ x, y, width, height });
const eq = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
const find = (r, bian) => (r && r.nm || []).find((x) => x.bian === bian);
const WA = K(0, 0, 3440, 1392);

{
  const r = P(WA, 420, ['you']);
  ok('右侧吸附：主窗口占左侧剩余宽度', eq(r.zhu, K(0, 0, 3020, 1392)));
  ok('右侧吸附：nm 正好放进右边预留条', eq(find(r, 'you').kuang, K(3020, 0, 420, 1392)));
}
{
  const r = P(WA, 420, ['zuo']);
  ok('左侧吸附：主窗口右移，左边留条', eq(r.zhu, K(420, 0, 3020, 1392)) && eq(find(r, 'zuo').kuang, K(0, 0, 420, 1392)));
}
{
  const r = P(WA, 300, ['shang']);
  ok('上侧吸附：主窗口下移，上边留条', eq(r.zhu, K(0, 300, 3440, 1092)) && eq(find(r, 'shang').kuang, K(0, 0, 3440, 300)));
}
{
  const r = P(WA, 300, ['xia']);
  ok('下侧吸附：主窗口缩短，下边留条', eq(r.zhu, K(0, 0, 3440, 1092)) && eq(find(r, 'xia').kuang, K(0, 1092, 3440, 300)));
}
{
  const r = P(WA, 300, ['zuo', 'you']);
  ok('左右同时吸附：主窗口居中缩窄，两条竖带各自贴边',
    eq(r.zhu, K(300, 0, 2840, 1392)) && eq(find(r, 'zuo').kuang, K(0, 0, 300, 1392))
    && eq(find(r, 'you').kuang, K(3140, 0, 300, 1392)));
}
{
  const r = P(WA, 300, ['zuo', 'you', 'shang', 'xia']);
  ok('四边同时吸附：主窗口在中央，上下条不压左右条（角上不重叠）',
    eq(r.zhu, K(300, 300, 2840, 792))
    && eq(find(r, 'shang').kuang, K(300, 0, 2840, 300))
    && eq(find(r, 'xia').kuang, K(300, 1092, 2840, 300))
    && eq(find(r, 'zuo').kuang, K(0, 0, 300, 1392))
    && eq(find(r, 'you').kuang, K(3140, 0, 300, 1392)));
  const nmRects = r.nm.map((x) => x.kuang);
  for (let i = 0; i < nmRects.length; i += 1) {
    for (let j = i + 1; j < nmRects.length; j += 1) {
      const a = nmRects[i], b = nmRects[j];
      const overlap = !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
      assert.ok(!overlap, 'nm reserved strips must not overlap');
      pass++;
    }
  }
  console.log('PASS 四边预留条两两不重叠');
}
{
  const wa2 = K(-2560, -200, 2560, 1400);
  const r = P(wa2, 400, ['you']);
  ok('副屏负坐标：预留条仍贴该显示器工作区右缘',
    eq(r.zhu, K(-2560, -200, 2160, 1400)) && eq(find(r, 'you').kuang, K(-400, -200, 400, 1400)));
}
{
  const r = P(K(0, 0, 1920, 1000), 300, ['you']);
  ok('任务栏：几何只用 workArea（高度 1000，不是显示器 1080）', find(r, 'you').kuang.height === 1000 && r.zhu.height === 1000);
}
{
  ok('预留条厚度下限 220', find(P(WA, 1, ['you']), 'you').kuang.width === 220);
  ok('预留条厚度上限 480', find(P(WA, 9999, ['you']), 'you').kuang.width === 480);
  ok('没有吸附方向：返回 null（不能假装预留）', P(WA, 300, []) === null);
  ok('工作区太小：返回 null（不能把主窗口挤成负数）', P(K(0, 0, 640, 480), 300, ['zuo', 'you']) === null);
  const dup = P(WA, 300, ['you', 'you']);
  ok('重复方向会去重', dup.nm.length === 1 && dup.nm[0].bian === 'you');
}
{
  const bad = pureSrc.replace("kuang: { x: wa.x + wa.width - p", "kuang: { x: wa.x");
  const B = runPure(bad).nmJiSuanZhuZuiDaBuJu;
  neg('负向：把右侧预留条放到左边后，几何判据必须失败', eq(find(B(WA, 420, ['you']), 'you').kuang, K(3020, 0, 420, 1392)));
}

/* ═══ 2. 未查看新回复摘要 ═══════════════════════════════════════════════ */
ok('按会话保存「未查看的新回复」', /const chatUnreadNewest = new Map\(\)/.test(app));
ok('只有对方/牛马回复才登记未查看摘要',
  /const shiXinHuiFu = role === 'them' && !\(opts && opts\.system\) && !\(opts && opts\.stopped\) && !\(opts && opts\.self\)/.test(app)
  && /if \(shiXinHuiFu\) setUnreadNewest\(chatId, text, role/.test(app));
const scrollHandler = bodyOf(app, /heZi\.addEventListener\('scroll'/, /const last = heZi\.lastElementChild/);
neg('用户上翻本身不再生成摘要（旧「取最后一条当新回复」已删除）',
  /pendingNewest\s*=\s*\{\s*text:\s*String\(zui\.text/.test(scrollHandler));
ok('滚到底会清掉未查看摘要',
  /clearUnreadNewest\(id2\)/.test(scrollHandler) && /clearUnreadNewest\(sid\)/.test(bodyOf(app, /function scrollToBottom/, /function renderChat/)));
ok('重画时不拿历史最后一条冒充新回复，只同步未查看表',
  /syncPendingNewest\(sid\)/.test(bodyOf(app, /const last = heZi\.lastElementChild/, /被打断的任务/)));
const aff = bodyOf(app, /function updateScrollAffordances/, /function scrollToBottom/);
ok('摘要气泡只在有未查看新回复时显示（没有就只剩箭头）', /zaiDiBu \|\| !pendingNewest/.test(aff));
ok('负向：把旧的「上翻就塞摘要」加回滚动处理，检测器会变红',
  /pendingNewest\s*=\s*\{\s*text:\s*String\(zui\.text/.test(
    scrollHandler.replace('const zaiDi = isAtBottom(heZi);',
      "const zaiDi = isAtBottom(heZi); const zui = msgsOf(String(state.selectedChat?.id || '')).slice(-1)[0]; if (!zaiDi && zui) pendingNewest = { text: String(zui.text || ''), role: zui.role };"),
  ));

/* ═══ 3. 引导卡「去聊天」：清理挡路窗口、不收起引导卡 ═══════════════════ */
const sgQing = bodyOf(app, /function sgQingDangLuChuangKou\(\)/, /function sgGoChat\(\)/);
const goChat = bodyOf(app, /function sgGoChat\(\)/, /async function sgSave/);
ok('去聊天前会关掉牛马设置/创建弹窗并离开设置页',
  /closeNiuMaSettings\(\)/.test(sgQing) && /duiHuaKuangGen/.test(sgQing) && /setNav\('singleAi'\)/.test(sgQing));
ok('去聊天：清理后打开会话', /sgQingDangLuChuangKou\(\)/.test(goChat) && /openChat\('single'/.test(goChat));
neg('去聊天不再自动最小化引导卡', /sgMinimize\(\)/.test(goChat));
ok('负向：把 sgMinimize 加回去后，检测器会变红',
  /sgMinimize\(\)/.test(goChat.replace('sgQingDangLuChuangKou();', 'sgQingDangLuChuangKou(); sgMinimize();')));
neg('负向：删掉清理调用后，清理判据会失败', /sgQingDangLuChuangKou\(\)/.test(goChat.replace('sgQingDangLuChuangKou();', '')));

/* ═══ 3.5 完全授权边界（用户第 5 项选 A：保持现状） ═══════════════════════ */
ok('完全授权边界：程序安装目录始终受保护', /程序安装目录/.test(pp) && /for \(const d of programDirs\)/.test(pp));
ok('完全授权边界：其他会话工作区 / 历史 / 记忆受保护',
  /其他会话的工作区/.test(pp) && /会话历史 \/ 记忆数据/.test(pp));
ok('完全授权文件工具仍先查禁止区（只有一次性授权才放行）',
  /const why = protectedPathReason\(abs, baseDir\)/.test(wt)
  && /consumeProtectedOnce\(abs\)/.test(wt) && /protected-path:/.test(wt));
ok('主进程对受保护路径先弹卡，用户同意后才 grantProtectedOnce',
  /else if \(ask \|\| baoHu\)/.test(main) && /if \(baoHu\) grantProtectedOnce\(absT\)/.test(main));
ok('完全授权命令触及禁止区也先弹卡（同意 = 仅这一次）',
  /const keWen = dang === 'full' \|\| yaoWen2/.test(main) && /同意 = 仅这一次放行/.test(main));
neg('负向：删掉文件工具的禁止区检查后，判据会失败',
  /const why = protectedPathReason\(abs, baseDir\)/.test(wt.replace('const why = protectedPathReason(abs, baseDir);', '')));

/* ═══ 4. 最大化接线（主窗口 / nm / 还原 / 左右边方向） ═════════════════ */
const zd = bodyOf(main, /chuliIpc\('warmy:winZuiDaHua'/, /chuliIpc\('warmy:winQuanPing'/);
ok('主窗口最大化：有吸附走预留布局，已激活则还原',
  /nmZhuZuiDaHuaKai\(zhuZuiDaMianBanKuan\(wa\.width\)\)/.test(zd)
  && /nmZhuZuiDaHuaGuan\(\)/.test(zd) && /nmZhuZuiDaXiFuCe\(\)\.length > 0/.test(zd));
ok('主窗口没有吸附时仍走原生最大化', /sender\.maximize\(\)/.test(zd) && /sender\.isMaximized\(\)/.test(zd));
ok('nm/独立会话窗点最大化仍走各自窗口的原生最大化',
  /sender\.id === win\.id/.test(zd) && /sender\.isMaximized\(\)\) sender\.unmaximize\(\)/.test(zd));
const sysMax = bodyOf(main, /function zhuanHuanXiTongZuiDaHua/, /chuliIpc\('warmy:winZuiDaHua'/);
ok('系统原生最大化（Win+Up/贴靠布局）也转成预留第四列布局',
  /nmZhuZuiDaXiFuCe\(\)\.length === 0/.test(sysMax) && /nmZhuZuiDaHuaKai\(zhuZuiDaMianBanKuan\(wa\.width\)\)/.test(sysMax)
  && /win\.on\('maximize', \(\) => \{[\s\S]{0,400}zhuanHuanXiTongZuiDaHua\(\)/.test(main));
const mainWithoutSysMaxCall = main.replace('try { zhuanHuanXiTongZuiDaHua(); } catch { /* 转换失败就保持系统最大化 */ }', '');
neg('负向：删掉系统最大化转换调用后，判据会失败',
  /win\.on\('maximize', \(\) => \{[\s\S]{0,400}zhuanHuanXiTongZuiDaHua\(\)/.test(mainWithoutSysMaxCall));
ok('主窗口状态回报预留状态与工作区（真机门禁/界面可核实）',
  /customMaximized: !!zt\.active/.test(main) && /workArea: wa/.test(main));
const kai = bodyOf(nm, /export function nmZhuZuiDaHuaKai/, /export function nmZhuZuiDaHuaGuan/);
ok('预留布局：纯几何 + 保存原矩形/最小尺寸 + 临时放宽最小尺寸',
  /nmJiSuanZhuZuiDaBuJu\(/.test(kai) && /zhuZuiDaCun = cun/.test(kai)
  && /xiZhengMainZuiXiao/.test(kai) && /xiZhengNmZuiXiao/.test(kai));
ok('布局期间挡住吸附回流（move/resize 不会把刚贴好的边误判成拖开）',
  (nm.match(/Date\.now\(\) < zhuZuiDaBuJuZhi/g) || []).length >= 2);
const guan = bodyOf(nm, /export function nmZhuZuiDaHuaGuan/, /export function nmZhuZuiDaHuaZhuangTai/);
ok('还原：双方最小尺寸与矩形都恢复', /setMinimumSize\(x\.zuiXiao\[0\]/.test(guan) && /setBounds\(cun\.zhu\)/.test(guan) && /setBounds\(x\.kuang\)/.test(guan));
const shou = bodyOf(nm, /function shouLianYiBian/, /function xiFuXinBian/);
const you = bodyOf(shou, /if \(bian === 'you'\)/, /if \(bian === 'zuo'\)/);
const zuo = bodyOf(shou, /if \(bian === 'zuo'\)/, /if \(bian === 'xia'\)/);
ok('左右吸附校准方向正确（bian 是本窗自己的边）',
  /\(b\.x \+ b\.width\) - ob\.x/.test(you) && /b\.x - \(ob\.x \+ ob\.width\)/.test(zuo));
neg('负向：左右两支写反（旧 bug）时检测器会失败',
  /const gap = \(b\.x \+ b\.width\) - ob\.x;/.test(you.replace(/const gap = \(b\.x \+ b\.width\) - ob\.x;/, 'const gap = b.x - (ob.x + ob.width);'))
  && /const gap = b\.x - \(ob\.x \+ ob\.width\);/.test(zuo));
ok('nm 窗口列表回报真实矩形与最大化状态（真机门禁不猜）', /kuang: z\.win\.getBounds\(\), max: z\.win\.isMaximized\(\)/.test(nm));

console.log(`\nverify-r102-changes: ${pass} PASS / 0 FAIL`);
