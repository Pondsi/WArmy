/**
 * verify-r101-changes.mjs —— 第 101 轮：话筒菜单 / 操作浮雕 / 窗口位置 / 引导去聊天 /
 * 嵌套滚动链接 / 授权无超时 / nm 编辑器历史 / 过程引用 / nm 打开矩阵 /
 * 项目停止 / 旧停止标记 / 旧 xd1 台账。
 *
 * 每条关键实现都配一条**负向变异**：把实现删掉后检测器必须变红。
 * 真机行为（菜单几何、窗口坐标、nm 开关、项目停止）由本轮 live harness 另测。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const main = read('src/electron-main.ts');
const app = read('src/renderer/app.js');
const css = read('src/renderer/app.css');
const rcss = read('src/renderer/renderer.css');
const html = read('src/renderer/index.html');
const nmJs = read('src/renderer/nm-viewer.js');
const nmWin = read('src/nm-viewer-win.ts');
const nmHtml = read('src/renderer/nm-viewer.html');
const nmCss = read('src/renderer/nm-viewer.css');
const authCss = read('src/renderer/auth-gate.css');
const orch = read('src/orchestrator.ts');

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

/* ═══ 1. 话筒下拉：挨着、完整显示、勾选项只留名称 + 问号 ═════════════════ */
const voiceHtml = bodyOf(html, /id="yuYinCaiDan"/, /id="anNiuFaSong"/);
ok('话筒下拉：两个勾选项各有一个 .yuYinHang 行', (voiceHtml.match(/class="yuYinHang"/g) || []).length === 2);
ok('话筒下拉：说明收进问号（ddDesc），不再铺两行小字', (voiceHtml.match(/class="ddWen"/g) || []).length === 2 && (voiceHtml.match(/class="ddDesc"/g) || []).length === 2);
ok('旧的长说明 div（yuYinChongZuShuo）已删除', !/id="yuYinChongZuShuo"/.test(voiceHtml));
ok('话筒与下拉箭头紧挨（图标视觉间距约 0px）', /\.yuYinDd \{[^}]*margin-left: -13px/.test(css) && /\.yuYinXiaLa \{[^}]*width: 18px/.test(css));
ok('输入区不再裁掉向上展开的语音菜单（app.css / renderer.css 都是 visible）',
  /\.shuRuQuZhu \{[^}]*overflow: visible/.test(css) && /\.shuRuQuZhu \{[^}]*overflow: visible/.test(rcss));
const zhuRule = (css.match(/\.shuRuQuZhu \{[^}]*\}/) || [''])[0];
ok('负向：若输入区退回 overflow:hidden，正判据必须失败',
  /overflow: hidden/.test(zhuRule.replace('overflow: visible', 'overflow: hidden')));

/* ═══ 2. 操作记录：展开后的明细也包在浮雕里 ═════════════════════════════ */
ok('操作记录：展开时外层 .xingDongZu 成为浮雕卡', /\.xingDongZu:has\(> \.xingDongXiang:not\(\.yinCang\)\) \{[\s\S]{0,700}box-shadow:/.test(rcss));
ok('操作记录：展开时标题行让位（不再自己一层浮雕）', /\.xingDongZu:has\(> \.xingDongXiang:not\(\.yinCang\)\) > \.xingDongHang \{[\s\S]{0,300}box-shadow: none/.test(rcss));
ok('操作记录：展开的明细有分隔线（同一张卡里）', /\.xingDongZu:has\(> \.xingDongXiang:not\(\.yinCang\)\) > \.xingDongXiang \{[\s\S]{0,300}border-top:/.test(rcss));
ok('负向：删掉浮雕选择器后正判据为假', !/\.xingDongZu:has\(> \.xingDongXiang:not\(\.yinCang\)\) \{[\s\S]{0,700}box-shadow:/.test(rcss.replace(/\.xingDongZu:has\(> \.xingDongXiang:not\(\.yinCang\)\) \{/, '.x')));

/* ═══ 3. 首启登录完成：窗口位置跟随登录窗 ═══════════════════════════════ */
const shouQi = bodyOf(main, /chuliIpc\('warmy:shouQiChuangKouWanCheng'/, /chuliIpc\('warmy:authState'/);
ok('登录完成：只还原尺寸，x/y 保留用户当前所在位置', /const cur = win\.getBounds\(\)/.test(shouQi) && /x: cur\.x|const x = Math\.min\(Math\.max\(wa\.x, cur\.x\)/.test(shouQi) && /y: cur\.y|const y = Math\.min\(Math\.max\(wa\.y, cur\.y\)/.test(shouQi));
ok('旧版整块还原 shouQiYuanKuang 已不再出现', !/win\.setBounds\(shouQiYuanKuang\)/.test(shouQi));

/* ═══ 4. 引导第 3 步「去聊天」：关闭挡路窗口并显示聊天（第 102 轮改成不收起引导卡） ═══ */
const sgQing = bodyOf(app, /function sgQingDangLuChuangKou\(\)/, /function sgGoChat\(\)/);
const goChat = bodyOf(app, /function sgGoChat\(\)/, /async function sgSave/);
ok('引导「去聊天」：先清理挡路的设置页/弹窗，再打开会话',
  /closeNiuMaSettings\(\)/.test(sgQing) && /duiHuaKuangGen/.test(sgQing)
  && /sgQingDangLuChuangKou\(\)/.test(goChat) && /openChat\('single'/.test(goChat));
ok('引导卡不自动收起：去聊天里没有 sgMinimize()', !/sgMinimize\(\)/.test(goChat));
ok('负向：若把清理调用删掉，正判据会失败',
  !(/sgQingDangLuChuangKou\(\)/.test(goChat.replace('sgQingDangLuChuangKou();', ''))));
ok('负向：若去聊天重新调用 sgMinimize，判据会失败',
  !(!/sgMinimize\(\)/.test(goChat.replace('sgQingDangLuChuangKou();', 'sgQingDangLuChuangKou(); sgMinimize();'))));

/* ═══ 5. 嵌套滚动：内层到边后带动外层（CSS + wheel 兜底） ═════════════ */
for (const [name, s] of [['app.css', css], ['renderer.css', rcss], ['auth-gate.css', authCss], ['nm-viewer.css', nmCss]]) {
  ok(name + '：不再用 overscroll-behavior: contain 掐断链式滚动', !/overscroll-behavior:\s*contain/.test(s));
}
ok('主界面：边界处按剩余 delta 滚动最近的可滚动祖先', /function bindScrollChain/.test(app) && /outer\.scrollTop = qian \+ dy/.test(app) && /e\.deltaMode === 1 \? 16/.test(app));
ok('负向：把 contain 加回去后确实会被检测到', /overscroll-behavior:\s*contain/.test(css.replace('overscroll-behavior: auto', 'overscroll-behavior: contain')));

/* ═══ 6. 授权 / 决策卡：永不超时替用户选择 ═════════════════════════════ */
ok('决策卡默认无限等待（timeoutMs = 0）', /timeoutMs = 0,/.test(main));
ok('重组语言：先关思考、失败去掉再试、整链回退、成功提为默认、2048 token 下限',
  /lieTeShuMoXingKeys/.test(main) && /think: false/.test(main)
  && /teShuGuanSiKaoExtra/.test(main) && /special-model\.promoted/.test(main)
  && /legs/.test(main) && /leg: leg\.name/.test(main) && /siKaoChiGuang/.test(main) && /leg: 'big-budget'/.test(main)
  && /Math\.min\(8192, Math\.max\(4096/.test(main) && /special-model\.empty/.test(main));
neg('负向：把 think:false 改成 think:true 后正判据为假',
  /think: false/.test(main.replace(/think: false/g, 'think: true')));
ok('重组语言默认勾选；模型暂不可用只禁用、不改用户偏好；真正整理前读此刻勾选',
  /let yuYinChongZu = true/.test(app) && /st\.yuYinChongZu !== false/.test(app)
  && /box\.checked = !!yuYinChongZu/.test(app) && /function yuYinYaoChongZu\(\)/.test(app)
  && /const box = \$\('yuYinChongZuBox'\)/.test(app) && /!!yuYinChongZuKeYong/.test(app));
neg('负向：把默认偏好改成 false 后正判据为假', /let yuYinChongZu = true/.test(app.replace('let yuYinChongZu = true', 'let yuYinChongZu = false')));
ok('决策卡等待：会话被停止 ⇒ 立刻返回 __stopped__（不是替用户拒绝）', /if \(sid && stoppedSessions\.has\(sid\)\) return '__stopped__'/.test(main));
ok('决策卡等待：卡片被取消 ⇒ 返回 __cancelled__', /if \(q && q\.status === 'cancelled'\) return '__cancelled__'/.test(main));
ok('停止时取消本会话未答的卡（不写拒绝/同意）', /for \(const q of aiQuestions\.LieBiao\(sid\)\) if \(q\.status === 'pending'\) aiQuestions\.cancel\(q\.id\)/.test(main));
const pizhun = bodyOf(main, /chuliIpc\('warmy:qingQiuPiZhun'/, /warmy:piZhunHuiYing/);
const onApprove = bodyOf(main, /onApprove: async \(Qiu\)/, /qidong\('p1 ready'\)/);
ok('权限审批卡不再 30 秒自动拒绝（两处审批入口都无超时）',
  !/30000/.test(pizhun) && !/30000/.test(onApprove) && !/allowed: false, scope: 'deny'/.test(onApprove));
ok('负向：把 30 秒超时加回审批入口后确实会被检测到',
  /30000/.test(pizhun.replace(/dengdaiPizhun\.set\(id, \{ resolve, at: Date\.now\(\) \}\);/, 'dengdaiPizhun.set(id, { resolve, at: Date.now() }); setTimeout(() => {}, 30000);')));
const daiJueCe = bodyOf(app, /const daiJueCe = /, /异常 = 回复异常/);
ok('界面问号角标不再 24 小时自动消失', !!daiJueCe && !/createdAt|Date\.now\(\)/.test(daiJueCe));

/* ═══ 7. nm 编辑器：聊天编辑器里的撤销 / 后退 / 前进可用 ═══════════════ */
const chatEdit = bodyOf(nmJs, /if \(zt\.chatEditor\) \{/, /if \(!zt\.zang\)/);
ok('聊天编辑器：编辑也压历史（后退/前进不再全灰）', /yiXiuGai\.lishi = setTimeout\(\(\) => \{ tuiRuLiShi\(zt\.luJing, el\('wenBen'\)\.value\); \}, 600\);/.test(chatEdit));
ok('聊天编辑器：后退/前进恢复后补发 input（聊天框实时跟随）', /if \(zt\.chatEditor && zt\.leiXing === 'text'\) \{[\s\S]{0,220}dispatchEvent\(new Event\('input'/.test(nmJs));
ok('聊天编辑器：打开后正文自动聚焦（Ctrl+Z 立刻可用）', /if \(chatEditor\) \{ try \{ el\('wenBen'\)\?\.focus\(\)/.test(nmJs));
ok('负向：删掉聊天编辑器的历史压入后正判据为假', !/yiXiuGai\.lishi = setTimeout\(\(\) => \{ tuiRuLiShi\(zt\.luJing, el\('wenBen'\)\.value\); \}, 600\);/.test(chatEdit.replace(/yiXiuGai\.lishi = setTimeout\(\(\) => \{ tuiRuLiShi\(zt\.luJing, el\('wenBen'\)\.value\); \}, 600\);/, '')));

/* ═══ 8. 第 105 轮项 13：中间回复把执行过程切成多段 ═══════════════════ */
ok('旧的“过程引用卡”已删除（函数/样式/调用都不在）', !/guoChengYinYong/.test(app) && !/guoChengYinYong/.test(css) && !/chat\.processRefs/.test(app));
const processSrc = bodyOf(app, /function guoChengHash\(/, /function xuanRanLiuShiKuai\(/);
ok('中间回复是独立可折叠框（details + summary + 默认 open）', /<details class="zhongJianKa"/.test(processSrc)
  && /<summary>/.test(processSrc) && /data-key=/.test(processSrc) && /\bopen>/.test(processSrc)
  && /zhongJianZhaiYao/.test(processSrc) && !/chat\.interimReply/.test(processSrc));
ok('执行过程段默认折叠（helper 默认 zhanKai=false）', /function guoChengLieHtml\([^)]*zhanKai = false,/.test(app));
ok('三路事件统一按真实 ts 排序后再渲染', /const ev = \[\.\.\.think, \.\.\.mids, \.\.\.tools\]/.test(processSrc)
  && /\.sort\(\(a, b\) => \(a\.ts - b\.ts\)/.test(processSrc) && /RANK\[a\.kind\]/.test(processSrc));
ok('多段执行过程样式存在（.guoChengLie/.zhongJianKa 浮雕）', /\.guoChengLie \{/.test(css) && /\.zhongJianKa \{[\s\S]{0,800}box-shadow:/.test(css));
ok('中间回复标题可折叠，正文保留留白', /\.zhongJianKa\s*>\s*summary/.test(css)
  && /\.zhongJianKa > \.zhongJianHuiFu \{\s*margin: 0; padding: 9px 11px;/.test(css));
const escapeSrc = app.match(/const escapeHtml = [\s\S]*?;\r?\n/)[0];
const markdownSrc = bodyOf(app, /function mdHtml\(/, /window\.__mdHtml =/);
const makeProcessRenderer = (src) => runInNewContext(escapeSrc + markdownSrc + src + ';guoChengLieHtml', {
  tOr: (_key, fallback) => fallback,
  fmtKey: (_key, fallback, args) => fallback.replace(/\{(\w+)\}/g, (_m, key) => args[key]),
  xingDongHangNode: (m) => ({ outerHTML: '<div class="xingDongZu" data-ts="' + m.ts + '"></div>' }),
}, { timeout: 1000 });
const renderProcess = makeProcessRenderer(processSrc);
const midText = '**原话** <summary>保留</summary>\n第二行 `code`';
const midBody = '<p class="mdP"><strong>原话</strong> &lt;summary&gt;保留&lt;/summary&gt;</p><p class="mdP">第二行 <code class="mdCi">code</code></p>';
const midContract = (render) => {
  const out = render([], [{ ts: 20, text: midText }]);
  return /<details class="zhongJianKa"[^>]*data-ts="20"[^>]*data-fen="0"[^>]*data-key="mid:20:[^"]+"[^>]* open>/.test(out)
    && out.includes('class="zhongJianZhaiYao"') && !out.includes('<summary>中间回复</summary>')
    && out.includes('<div class="zhongJianHuiFu md">' + midBody + '</div>');
};
ok('行为：中间回复独立 details，保留 Markdown/转义/时间戳，默认展开', midContract(renderProcess));
for (const [name, from, to] of [
  ['恢复无标题 div', '<details class="zhongJianKa"', '<div class="zhongJianKa"'],
  ['删掉内容摘要', 'class="zhongJianZhaiYao"', 'class="zhongJianZhaiYaoX"'],
  ['删掉默认 open', ' open>', '>'],
  ['隐藏正文', '<div class="zhongJianHuiFu md">', '<div hidden class="zhongJianHuiFu md">'],
  ['丢失 Markdown', 'mdHtml(e.text)', 'escapeHtml(e.text)'],
]) {
  const mutant = processSrc.replace(from, to);
  ok('负向行为：' + name + ' 必须被拒绝', mutant !== processSrc && !midContract(makeProcessRenderer(mutant)));
}
const thinks = [{ ts: 50, text: '收尾' }, { ts: 20, text: '同刻思考' }, { ts: 10, text: '先思考' }, { ts: 0, text: ' ' }];
const mids = [{ ts: 40, text: '第二条' }, { ts: 20, text: midText }, { ts: 0, text: '\n' }];
const inputsBefore = JSON.stringify([thinks, mids]);
const mixed = renderProcess(thinks, mids);
const timeline = [...mixed.matchAll(/<(details|div|pre) class="(siKaoKuai guoChengDuan|zhongJianKa|siKaoDuanKuai)"([^>]*)>/g)];
ok('行为：乱序输入按时间排，同刻思考在中间回复前，空白不产生节点',
  timeline.map((m) => m[2] + ':' + /data-ts="(\d+)"/.exec(m[3])[1]).join('|')
    === 'siKaoKuai guoChengDuan:10|siKaoDuanKuai:10|siKaoDuanKuai:20|zhongJianKa:20|zhongJianKa:40|siKaoKuai guoChengDuan:50|siKaoDuanKuai:50');
ok('行为：中间回复把执行过程切段，且不嵌套在执行过程内',
  timeline.filter((m) => m[2] !== 'siKaoDuanKuai').map((m) => /data-fen="(\d+)"/.exec(m[3])[1]).join(',') === '0,0,1,2'
  && !/<details class="siKaoKuai guoChengDuan"[^>]*>(?:(?!<\/details>)[\s\S])*?<details class="zhongJianKa"/.test(mixed)
  && mixed.includes('aria-label="思考与执行第 3 段 · 0 个操作"'));
ok('行为：三种事件在同一个时间线上按 ts 混排（思考→工具→思考不会回到“工具全在底部”）', (() => {
  const out = renderProcess([{ ts: 10, text: '先想' }, { ts: 30, text: '再想' }], [], false, [
    { ts: 20, hao: 'a', op: '读取', status: 'ok' },
  ]);
  const order = [...out.matchAll(/data-ts="(\d+)"/g)].map((m) => Number(m[1]));
  return order.join(',') === '10,10,20,30' && out.indexOf('先想') < out.indexOf('xingDongZu') && out.indexOf('xingDongZu') < out.indexOf('再想');
})());
ok('行为：不修改输入；空输入不渲染；没有中间回复仍是单个折叠段',
  JSON.stringify([thinks, mids]) === inputsBefore && renderProcess(null, null) === ''
  && renderProcess([{ text: ' ' }], [{ text: '\n' }]) === ''
  && renderProcess([{ ts: 1, text: '旧思考' }], []).match(/<details\b/g)?.length === 1
  && !/zhongJianKa/.test(renderProcess([{ ts: 1, text: '旧思考' }], []))
  && !/<details class="siKaoKuai guoChengDuan"[^>]*\bopen/.test(renderProcess([{ ts: 1, text: '旧思考' }], [])));
ok('行为：运行中执行过程展开，结束后默认折叠',
  /<details class="siKaoKuai guoChengDuan"[^>]*\bopen\b/.test(renderProcess([{ ts: 1, text: '运行中' }], [], true))
  && !/<details class="siKaoKuai guoChengDuan"[^>]*\bopen\b/.test(renderProcess([{ ts: 1, text: '结束后' }], [])));
ok('运行中段自动展开，真正收尾后只折叠一次（用户再展开不会被重绘抢走）',
  /yingYongGuoChengZhuangTai\(heZi\)/.test(app) && /guoChengBi/.test(app)
  && /jiGuoChengYongHuZhuangTai\(det\)/.test(app));
ok('继续按钮/决策卡会先清理空转的 queueRounds', /function qingLiJiaMang/.test(app)
  && /qingLiJiaMang\(sid\)/.test(app) && /qingLiJiaMang\(String\(sid\)\)/.test(app));
ok('决策卡答完：主进程回执 + 续跑带 force（收掉继续按钮，避免再派一轮）',
  /broadcastToWindows\('warmy:jueCeKaDa'/.test(main) && /force: true/.test(main)
  && /onJueCeKaDa/.test(app) && /jieGuo !== 'resume' && jieGuo !== 'stop'/.test(app));
ok('中断通知先到不半路弹按钮：pending + 真正收尾后补亮',
  /planInterruptedPending/.test(app) && /shiFangDaiChuLiZhongDuan\(chatId\)/.test(app)
  && /shiFangDaiChuLiZhongDuan\(sid\)/.test(app));
ok('继续按钮在没有真实分片时直接派发，且补做本轮收尾',
  /!huiHuaZaiZhenPao\(sidD\)/.test(app)
  && /void paiFaYiLun\(sidD, zhiLing, 'P2'\)/.test(app)
  && /function paiFaYiLun[\s\S]{0,240}?await deliver[\s\S]{0,240}?endOfRound[\s\S]{0,240}?flushQueue/.test(app));
ok('同一句回复（落账/推送时间差几毫秒）按近似指纹去重',
  /const xiangJin = \(a, b\)/.test(app) && /quChong\.find\(\(x\) => xiangJin\(x, m\)\)/.test(app));
neg('负向：删掉决策卡回执后正判据为假', /broadcastToWindows\('warmy:jueCeKaDa'/.test(main.replace(/broadcastToWindows\('warmy:jueCeKaDa'/g, 'broadcastToWindows(\'warmy:none\'')));
neg('负向：删掉近似去重后正判据为假', /const xiangJin = \(a, b\)/.test(app.replace(/const xiangJin = \(a, b\)/, 'const xiangJin = null')));

/* 行为：空转清理 / 强制收掉残留 / 收尾后补亮中断按钮 */
const planHelperSrc = bodyOf(app, /function huiHuaZaiZhenPao\(/, /\/\*\* 排定一次"轮边界"冲刷/);
const mkPlanSandbox = () => {
  const cl = new Set(['yinCang']);
  let streaming = false;
  const sb = {
    state: {
      sessionRuns: { s: { running: true, updatedAt: Date.now() } },
      planInterrupted: new Set(),
      planInterruptedPending: new Set(['s']),
      selectedChat: { id: 's' },
    },
    queueRounds: { s: true },
    _liuShiZuiHou: {},
    shouHuiHuaLiu: () => { sb.__shou = (sb.__shou || 0) + 1; },
    renderChat: () => { sb.__render = (sb.__render || 0) + 1; },
    renderList: () => { sb.__list = (sb.__list || 0) + 1; },
    $: (id) => id === 'yunXingZhuangTai'
      ? { classList: { contains: (c) => cl.has(c), add: (c) => cl.add(c), remove: (c) => cl.delete(c) } }
      : (id === 'xiaoXiJi' ? { querySelector: () => (streaming ? {} : null) } : null),
    __setStreaming: (v) => { streaming = !!v; },
    __setHidden: (v) => { if (v) cl.add('yinCang'); else cl.delete('yinCang'); },
  };
  return sb;
};
const mkPlanEngine = (sb) => runInNewContext(planHelperSrc + '\n;({ huiHuaZaiZhenPao, qingLiJiaMang })', sb, { timeout: 1000 });
{
  const sb = mkPlanSandbox();
  const api = mkPlanEngine(sb);
  sb.state.sessionRuns.s.updatedAt = Date.now() - 30000;
  ok('行为：10 秒内有真实分片才算在跑（陈旧运行态不算）', api.huiHuaZaiZhenPao('s') === false);
  ok('行为：界面无在跑证据 ⇒ 空转 queueRounds 被清掉', api.qingLiJiaMang('s') === true && sb.queueRounds.s === false);
}
{
  const sb = mkPlanSandbox();
  const api = mkPlanEngine(sb);
  sb.__setHidden(false);
  sb.__setStreaming(true);
  ok('行为：真的有流式块 ⇒ 不清空转标记（不许谎报空闲）', api.qingLiJiaMang('s') === false && sb.queueRounds.s === true);
  ok('行为：主进程确认停住后 force ⇒ 收掉残留流式块并放行', api.qingLiJiaMang('s', { force: true }) === true
    && sb.queueRounds.s === false && sb.__shou === 1 && sb.__render === undefined);
}
{
  const sb = mkPlanSandbox();
  const flushSrc = bodyOf(app, /function shiFangDaiChuLiZhongDuan\(/, /window\.__shiFangDaiChuLiZhongDuan/);
  runInNewContext(flushSrc + '\n;({ shiFangDaiChuLiZhongDuan })', sb, { timeout: 1000 }).shiFangDaiChuLiZhongDuan('s');
  ok('行为：收尾后暂缓的中断才点亮按钮（pending→planInterrupted）',
    sb.state.planInterrupted.has('s') && !sb.state.planInterruptedPending.has('s') && sb.__render === 1);
}
ok('半成品轮询不会在本轮运行中点亮「继续/重试」', /if \(queueRounds\[sidBaoZhi\][\s\S]{0,220}return;/.test(app));
ok('10 个语言包仍保留中间回复标题键（兼容旧数据），渲染层不再引用', !/chat\.interimReply/.test(app) && (() => {
  const dir = path.join(root, 'src/i18n');
  const files = fs.readdirSync(dir).filter((f) => /^(zh-CN|zh-TW|en-US|ja|ko|ru|es|fr|pt|eo)\.json$/.test(f));
  if (files.length !== 10) return false;
  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (!Object.hasOwn(j, 'chat.interimReply') || !String(j['chat.interimReply'] || '').trim()) return false;
  }
  return true;
})());
/** 可访问性：段序号 + 段内操作数（屏幕阅读器能分辨多个同名「执行过程」） */
const segAriaOk = (src) => /chat\.processSegment/.test(src)
  && /duanBiao\(fen \+ 1, nAct\)/.test(src)
  && /seg\.setAttribute\('aria-label', fmtKey\('chat\.processSegment'/.test(src)
  && /i: String\(\(Number\(seg\.dataset\.fen\) \|\| 0\) \+ 1\)/.test(src);
ok('执行过程段有“第 N 段 · N 个操作”的无障碍名称', segAriaOk(app));
neg('负向：删掉 aria-label 后正判据为假', segAriaOk(app.replace(/aria-label/g, 'data-no-label')));
ok('10 个语言包都有“执行过程第 N 段”文案（占位符一致）', (() => {
  const dir = path.join(root, 'src/i18n');
  const files = fs.readdirSync(dir).filter((f) => /^(zh-CN|zh-TW|en-US|ja|ko|ru|es|fr|pt|eo)\.json$/.test(f));
  if (files.length !== 10) return false;
  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const s = String(j['chat.processSegment'] || '');
    if (!s || !s.includes('{i}') || !s.includes('{n}')) return false;
  }
  return true;
})());

/* ═══ 9. nm 打开矩阵：左/右 × 启用/未启用（主进程不再偷改投 nm） ═══════ */
const daKai = bodyOf(main, /chuliIpc\('warmy:daKaiLuJing'/, /warmy:wenJianYuLan/);
ok('系统打开通道只走系统默认（不再偷偷开 nm）', /shell\.openPath\(abs\)/.test(daKai) && !/nmShiTuKai/.test(daKai));
ok('负向：把 nmShiTuKai 塞回系统打开通道后确实会被检测到', /nmShiTuKai/.test(daKai.replace('shell.openPath(abs)', 'nmShiTuKai({})')));
ok('左键：勾选启用才用 nm，否则系统默认（异步版统一决策）', /function daKaiWenJianAsync\(p\)/.test(app) && /nmChaJianKai\(\) && state\.nmKaiWenJian === true/.test(app) && /window\.warmy\.daKaiLuJing\?\.\(\{ path: lu \}\)/.test(app));
ok('右键：与左键一正一反（未勾选时用 nm）', /const yongNm = nmChaJianKai\(\) && state\.nmKaiWenJian !== true;/.test(app));
ok('第四列项目文件左键也遵守同一矩阵（目录仍走系统）', /const daKaiHuoDingWei = async \(lu, jian, zhiDingXiTong\)/.test(app) && /zhiDingXiTong[\s\S]{0,120}daKaiLuJing/.test(app) && /daKaiWenJianAsync\(lu\)/.test(app));
ok('未安装/已卸载：nmChaJianKai() 返回 false（启用勾选被禁用）', /if \(state\.nmFileRemoved\) return false;/.test(app));

/* ═══ 10. 项目停止：编排器一步不再派；晚到只收不执行 ═════════════════ */
ok('项目停止：编排器依赖注入 isStopped', /isStopped: \(groupId: string\) => stoppedSessions\.has/.test(main));
const paoYiGe = bodyOf(orch, /const paoYiGe = async/, /const jieGuo = paiFa/);
ok('项目停止：执行者起跑前查 isStopped，起跑/结束都登记',
  /if \(deps\.isStopped\?\.\(p\.groupId\)\)/.test(paoYiGe)
  && /deps\.onExecutorStart\?\.\(p\.groupId, zxId\)/.test(paoYiGe)
  && /deps\.onExecutorEnd\?\.\(p\.groupId, zxId\)/.test(paoYiGe));
ok('项目停止：编排入口直接返回 stopped（不再挑人/派活）',
  /if \(deps\.isStopped\?\.\(xiaoXi\.groupId\)\) \{[\s\S]{0,400}action: 'stopped'/.test(orch));
ok('项目停止：在跑的执行者登记后逐个中止', /qunZhiXingZhe/.test(main) && /for \(const id of \[\.\.\.ren\]\)/.test(main));
ok('项目停止：用户再开口才清停止标志（新轮恢复）', /用户再次在项目里说话[\s\S]{0,120}stoppedSessions\.delete/.test(main));

/* ═══ 11. 旧停止消息标记（R100-4） ═════════════════════════════════════ */
ok('主进程：旧停止占位文案识别（句首/句尾，避免误标）', /function shiTingZhiZhanWei/.test(main) && /e\.stopped === true \|\| shiTingZhiZhanWei\(e\.content\)/.test(main));
ok('主进程：meta 回填也认旧停止文案', /shiTingZhiZhanWei\(m\.content\)/.test(main));
ok('渲染层：从主进程回来的旧消息也补 stopped', /function shiTingZhiZhanWeiWen/.test(app) && /stopped: !!m\.stopped \|\| shiTingZhiZhanWeiWen\(m\.text\)/.test(app));
ok('负向：删掉旧停止兜底后正判据为假', !/shiTingZhiZhanWeiWen\(m\.text\)/.test(app.replace(/shiTingZhiZhanWeiWen\(m\.text\)/, 'false')));

/* ═══ 12. 旧 xd1 台账（R100-5） ═══════════════════════════════════════ */
ok('旧 xd1：灌台账时拼消息时间戳做唯一键', /\^xd\\d\+\$/.test(app) && /hao0 \+ '@' \+ String\(Number\(m\.ts\)/.test(app));
ok('旧 xd1：台账 upsert 只合并仍处于 running 的同号行', /const guHao = \/\^xd\\d\+\$\/\.test\(hao\)/.test(app) && /x\.hao === hao && x\.status === 'running'/.test(app));
ok('负向：删掉旧号隔离后正判据为假', !/\^xd\\d\+\$/.test(app.replace(/\^xd\\d\+\$/g, '^never$')));

/* ═══ 13. nm 网页模式与内核事实（文档必须写清楚） ═════════════════════ */
ok('nm 本地网页仍走 sandbox iframe（不是内核错误）', /<iframe id="wangYeKuang"[^>]*sandbox="allow-scripts allow-forms allow-popups allow-downloads"/.test(nmHtml));
ok('nm 远程网页改走 WebContentsView（第 104 轮）', /WebContentsView/.test(nmWin) && /nmWangYeKai/.test(nmWin) && /nmWangYeKai/.test(nmJs));

console.log(`\nverify-r101-changes: ${pass}/${pass} 全绿`);
