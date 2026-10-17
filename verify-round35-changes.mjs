/**
 * verify-round35-changes —— 第 35 轮**静态 + 单元门禁**（不跑真机）
 *
 * 每条都写成"少了它这轮需求就复发"的形式；判**行为与关系**，不锚变量名/字节偏移。
 * 真机界面部分见 `verify-round35-ui.mjs`。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

const GEN = 'C:/wbuild';
const SRC = path.join(GEN, 'packages/app-shell/src');
const DIST = path.join(GEN, 'packages/app-shell/dist');
const PROV = path.join(GEN, 'packages/providers/dist');

const rd = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const main = rd(path.join(SRC, 'electron-main.ts'));
const appJs = rd(path.join(SRC, 'renderer/app.js'));
const appCss = rd(path.join(SRC, 'renderer/app.css'));
const rendCss = rd(path.join(SRC, 'renderer/renderer.css'));
const preload = rd(path.join(SRC, 'preload.cjs'));
const rules = rd(path.join(SRC, 'builtin-rules.ts'));
const ollamaTs = rd(path.join(GEN, 'packages/providers/src/ollama.ts'));
const nengLiTs = rd(path.join(GEN, 'packages/providers/src/mo-xing-neng-li.ts'));

const jie = [];
const panding = (ming, zhen, xiang) => jie.push({ ming, ok: !!zhen, xiang: xiang === undefined ? '' : String(xiang).slice(0, 300) });
/** 取一段代码窗口（判"顺序/包含"这类关系时用，不锚绝对行号） */
const win = (s, zhong, hou = 1200, qian = 200) => {
  const i = s.indexOf(zhong);
  if (i < 0) return '';
  return s.slice(Math.max(0, i - qian), i + hou);
};

/* ═══ 项 1：用户新增能力必须落成 skill / 门禁 / 插件 ═══════════════════ */
panding('项1 门禁 A 存在（可复用能力必须固化，不许只留在聊天里）',
  /门禁 A/.test(rules) && /可复用能力/.test(rules) && /先验证/.test(rules), 'builtin-rules.ts');
panding('项1 门禁 A 给出了 skill / 门禁 / 插件 三档判定表（含"靠谁强制"的判断依据）',
  /skill/.test(rules) && /门禁/.test(rules) && /插件/.test(rules) && /谁来强制/.test(rules));
panding('项1 门禁 A 明确禁止"只写在聊天里 / 只把 key 存进设置却不给能力"',
  /只写在聊天里/.test(rules) && /不给能力/.test(rules));
panding('项1 门禁文本每一轮都注入系统提示（宿主接线，不靠模型自觉）',
  /const menjin = CHANPIN_MENJIN\.trim\(\)/.test(main)
  && /shenFenTou\.push\(\{[\s\S]{0,300}产品门禁/.test(win(main, 'const menjin = CHANPIN_MENJIN', 700, 60)));

/* ═══ 项 2：所有任务都要进计划任务（含宿主校验） ═══════════════════════ */
panding('项2 门禁 B 存在（先建计划再动手 / ≥3 步 / 动词开头 / plan_verify 收尾）',
  /门禁 B/.test(rules) && /plan_update/.test(rules) && /plan_verify/.test(rules));
panding('项2 宿主校验：一轮里第 3 次工具调用仍无计划 ⇒ 记 plan.missing 审计',
  /plan\.missing/.test(main) && /yiYongCi === 3/.test(win(main, 'plan.missing', 900, 900)));
panding('项2 宿主校验的条款是 hidden system（进模型上下文、不进聊天记录）',
  /plan\.missing/.test(main) && /hidden: true/.test(win(main, 'plan.missing', 1400, 200)));
panding('项2 hidden 条目只进镜像（模型上下文），不写用户可见聊天记录',
  /if \(\(entry as \{ hidden\?: boolean \}\)\.hidden\) \{/.test(main) && /jingXiangXieRu\(key, tiaoMu\.role, tiaoMu\.content\)/.test(main));

/* ═══ 项 3：后台任务制度（硬门禁） ═══════════════════════════════════ */
const c3 = win(rules, '门禁 C', 2200, 100);
panding('项3 门禁 C 触发条件是"≥5 分钟无活可干"',
  /≥5 分钟/.test(c3) || /5 分钟/.test(c3), c3.slice(0, 80));
for (const [ming, re] of [
  ['先回复一次再等', /先回复一次/],
  ['说明在跑什么', /现在在跑什么/],
  ['预计几点几分完成', /几点几分完成/],
  ['无需值守', /不用你值守|无需值守/],
  ['计划任务里能看到', /计划任务/],
  ['完成后自己启动汇报', /自己.{0,6}启动|由\*\*你自己\*\*启动/],
  ['禁止空转轮询', /空转轮询/],
]) panding('项3 门禁 C 要素：' + ming, re.test(c3), '');
panding('项3 门禁 C 要求该任务在计划里用强调色标"进行中"、完成恢复',
  /强调色/.test(c3) && /进行中/.test(c3) && /恢复/.test(c3));

/* ═══ 项 4：动态小字左侧始终预留蹦跶位 ═════════════════════════════════ */
panding('项4 渲染层有"预留位"元素常量，并与奔跑组同时渲染',
  /NIUMA_BENG/.test(appJs) && /niuMaBeng/.test(appJs) && /niuMaKuai/.test(appJs));
panding('项4 预留位**始终占位**、只在有后台任务时显形（visibility 切换，不塌陷）',
  /\.niuMaBeng\s*\{[^}]*visibility: hidden/.test(appCss.replace(/\n\s*/g, ' ')) && /youHouTai .niuMaBeng \{ visibility: visible/.test(appCss.replace(/\n\s*/g, ' ')));
panding('项4 蹦跶动画与奔跑组同一套配速（JS 写 animationDuration）',
  /animationDuration/.test(appJs) && /niuMaBengTiao/.test(appCss));
panding('项4 有后台任务时切换 youHouTai（由分身"在跑"数量驱动）',
  /niuMaBengGengXin\(run\)/.test(appJs) && /youHouTai/.test(appJs));

/* ═══ 项 5：内置"改造本项目"技能 ═══════════════════════════════════════ */
panding('项5 内置技能文本符合 SKILL.md 规范（真跑解析器，不是查字符串）',
  await (async () => {
    try {
      const r = await import(pathToFileURL(path.join(DIST, 'builtin-rules.js')).href);
      const s = await import(pathToFileURL(path.join(DIST, 'skill-md.js')).href);
      const jie1 = s.jieXiSkillMd(r.ZIZHU_GAIZAO_SKILL);
      return jie1.valid === true && /self-modify/.test(String(jie1.frontmatter.name))
        && String(jie1.frontmatter.description || '').length > 20;
    } catch (e) { panding('项5 解析器可加载', false, String(e).slice(0, 140)); return false; }
  })());
/**
 * 第 37 轮改口径：这个技能**不再是"参与上游开发"**，而是"帮用户改造本机这一份"。
 * 所以判据从"有没有仓库地图"改成"有没有改造本机的方法 + 风险分层 + 自证 + 回滚"，
 * 并且**反向**要求它不含本机路径 / 仓库内部文件名 / 密钥。
 */
panding('项5 技能教的是"怎么改造本机这份"（形态判断 + 风险分层 + 自证 + 回滚）',
  /源码形态/.test(rules) && /打包形态/.test(rules) && /回滚/.test(rules) && /改完必须自证/.test(rules)
  && /不要把什么写进任何文件/.test(rules));
panding('项5 技能里**不许**有仓库地图 / 本机路径 / 密钥',
  !/仓库地图/.test(rules) && !/packages\/app-shell/.test(rules) && !/Users[\\/]/.test(rules) && !/ghp_|sk-|apiKey/.test(rules));
panding('项5 技能在启动时播种到**默认技能目录**（scan-dirs/skills，与设置里那个默认目录一致）',
  /warmy-self-modify/.test(main) && /moRenSaoMiaoLuJing\('skills'\)/.test(main) && /bo\('warmy-self-modify'/.test(main));

/* ═══ 项 7：模型能力分类（clef 不该被标"画图"） ════════════════════════ */
panding('项7 Ollama 不会再因为"有 vision 没 completion"就判成 image（画图）',
  /kind = 'imageUnd'/.test(ollamaTs) && !/!caps\.some\(\(c\) => \/completion\|generate\|chat\/\.test\(c\)\)\) kind = 'image'/.test(ollamaTs));
panding('项7 名字像生成模型（flux/sdxl）也归"图像理解"而不是"生成"（Ollama 不会出图）',
  /stable-diffusion\|sdxl\|flux\|text-to-image\/\.test\(quanMing\)\) \{ kind = 'imageUnd'/.test(ollamaTs));
panding('项7 落盘的能力有版本号；版本不符则不采信旧的 kind（错标签不会永久粘住）',
  /CAPS_VERSION/.test(main) && /modelCapsVersion/.test(main) && /banBenDui \? String/.test(main));
panding('项7 界面：不认识的模型标"未知"，不再假装成"对话"',
  /model\.chip\.unknown/.test(appJs) && /k === 'unknown'/.test(win(appJs, "model.chip.unknown", 300, 300)));

/* ═══ 项 8：心内行信息 ═════════════════════════════════════════════════ */
panding('项8 主进程写日志时把模型名拼成"供应商 · 模型"全称',
  /gongYingShangXianShiMing\(String\(zhu\.presetId/.test(main) && /' · ' \+ \(modelId/.test(main));
panding('项8 轮次（turnCount）写进日志并随 liaoTianXiaoXiJi 回传',
  /turnCount: Number\(loop\.lunShu \|\| 1\)/.test(main) && /turnCount: Number\(\(e as/.test(main));
panding('项8 第二行与第一行左对齐（不再有内联 margin-left 缩进）',
  /xiaoXiJiaoHang" style="margin-left:12px/.test(appJs) === false && /\.xiaoXiJiaoHang \{[^}]*margin-left: 0/.test(appCss.replace(/\n\s*/g, ' ')));
panding('项8 喇叭与左侧内容拉开距离（margin-left ≥10px）',
  /\.xiaoXiLangDu \{ margin-left: 1[0-9]px; \}/.test(appCss.replace(/\n\s*/g, ' ')));
panding('项8 一行里的气泡合并成同一份内容（同一个 tip 变量供给时间/词元/喇叭/引用/复制）',
  (appJs.match(/title="' \+ escapeHtml\(tip\)/g) || []).length >= 3 && /const tip = tiao\.filter\(Boolean\)\.join/.test(appJs));
panding('项8 tip 里有时间 / 模型 / 输入输出 / 轮次四类事实',
  /chat\.tipTime/.test(appJs) && /chat\.tipModel/.test(appJs) && /chat\.tokensFmt/.test(appJs) && /chat\.tipTurns/.test(appJs));

/* ═══ 项 9：喇叭播放动效 ═══════════════════════════════════════════════ */
panding('项9 声波弧以喇叭口为原点扩散（transform-box: fill-box）',
  /transform-box: fill-box/.test(appCss) && /transform-origin: left center/.test(appCss));
panding('项9 播放中按钮有扩散光环（::after + 动画）',
  /\.xiaoXiLangDu\.boFangZhong::after/.test(appCss) && /langDuHuan/.test(appCss));
panding('项9 非播放态声波隐藏（否则两道弧一直挂着）',
  /\.xiaoXiLangDu \.langDuBo \{ display: none; \}/.test(appCss.replace(/\n\s*/g, ' ')));

/* ═══ 项 10：用户附件自动进授权卡（读权限） ════════════════════════════ */
panding('项10 主进程有"附件进授权卡"的入口，且条目标成只读授权（du:true）',
  /warmy:fuJianShouQuan/.test(main) && /du: true/.test(main) && /允许读取：/.test(main));
panding('项10/36-6 越权守卫先看授权卡里的**路径授权**，命中就免询问（按读/写分档）',
  /luJingQuanPiPei/.test(main) && /gongJuQuanLei/.test(main) && /const yaoLei = gongJuQuanLei/.test(main));
panding('项10 渲染层发送时把附件路径交给授权卡（不用用户再点一次）',
  /fuJianShouQuan\?\.\(\{ sessionId: chatId, items: lu \}\)/.test(appJs));
panding('项10 preload 暴露 fuJianShouQuan', /fuJianShouQuan:/.test(preload));
panding('项10/36-6 只读豁免**不外溢**（写授权覆盖读；读授权不覆盖写；写/删/跑命令照旧问）',
  /if \(c === 'write'\) return x;/.test(main) && /if \(c === 'read'\) return yao === 'read' \? x : null;/.test(main)
  && /else if \(ask\) \{/.test(win(main, 'const yaoLei = gongJuQuanLei', 1400)));

/* ═══ 项 11：路径右键菜单只有真实完整路径才有 ══════════════════════════ */
panding('项11 路径正则允许单个内部空格（不会被空格截断）',
  /\(\?=\[\^\\s\]\)/.test(appJs) && /A-Za-z0-9\._~/.test(appJs));
panding('项11 路径必须从分隔符后开始（不会把前一句散文一起吞进路径）',
  /\(\^\|\[\\s/.test(appJs) && /\(m0, pre, m\) =>/.test(appJs) && /return pre \+ '<a class="pfLink luJingLian"/.test(appJs));
panding('项11 渲染后向主进程核存在性，虚拟/占位路径退回纯文字',
  /luJingCunZai/.test(appJs) && /replaceWith\(document\.createTextNode/.test(appJs));
panding('项11 右键菜单只在 data-real=1 时弹出',
  /luLian\.getAttribute\('data-real'\) === '1'/.test(appJs));
panding('项11 末尾散文被逐级剥离（多候选存在性探测）',
  /luJingHouXuan/.test(appJs) && /lastIndexOf\(' '\)/.test(win(appJs, 'function luJingHouXuan', 400)));

/* ═══ 项 12：行动明细（木马图标 / 去重 / 状态语义 / 三行明细） ══════════ */
panding('项12 图标文件到位（resources 里的木马.svg 被复制进渲染层图标目录）',
  fs.existsSync(path.join(SRC, 'renderer/icons/muMa.svg')));
panding('项12/36-3 行动行用木马.svg 作图标（并且取强调色：CSS 蒙版而不是 img）',
  /icons\/muMa\.svg/.test(appCss) && /background-color: var\(--accent\)/.test(win(appCss, '.xingDongHang .xdIco', 400))
  && /class="xdIco"/.test(appJs));
panding('项12 同一操作只写一次：start 建条目、finish 按 hao 改同一条',
  /const you = arr\.find\(\(x\) => x\.hao === hao\)/.test(appJs) && /phase === 'start'/.test(appJs));
panding('项12 主进程另开"行动台账"通道（控制台通道仍不许带路径）',
  /warmy:xingDongShiJian/.test(main) && /dangQianXingDong/.test(main) && /onXingDong/.test(preload));
panding('项12 只有异常（失败）用强调色，进行中/完成都是正常色',
  /\.xdZhuang\.jinXing \{ color: var\(--muted\)/.test(appCss.replace(/\n\s*/g, ' '))
  && /\.xdZhuang\.chengGong \{ color: var\(--muted\)/.test(appCss.replace(/\n\s*/g, ' '))
  && /\.xdZhuang\.shiBai \{ color: var\(--danger-fg/.test(appCss.replace(/\n\s*/g, ' ')));
panding('项12 点开展示三行：开始时间·状态 / 具体内容 / 更新·耗时·状态',
  /xdXian1/.test(appJs) && /xdXian2/.test(appJs) && /xdXian3/.test(appJs) && /chat\.xdCost/.test(appJs));
panding('项12 明细里的路径点开走"打开编辑"（绝不运行可执行文件）',
  /daKaiBianJi/.test(main) && /BU_KE_BIAN_JI/.test(main) && /xdBianJi/.test(appJs) && /cannot-edit/.test(main));
panding('项12 主进程把完整路径/完整命令放进台账（写文件给路径、跑命令给命令）',
  /quLuJingCanShu\(aA\)/.test(win(main, 'let xingDongDetail', 900)) && /command/.test(win(main, 'let xingDongDetail', 900)));

/* ═══ 项 13：行动过程并入执行过程、按时间混排、单行浮雕 ════════════════ */
panding('项13/36-5 执行明细**长在思考块里**（不再单独一个 details 区块）',
  /let kuai = wrap\.querySelector\('\.siKaoKuai'\)/.test(appJs) && /kuai\.appendChild\(xingDongHangNode\(m\)\)/.test(appJs));
panding('项13 动作行按时间升序插入（同一条时间线）', /mingXi\.sort\(\(a, b\) => \(Number\(a\.ts\) \|\| 0\) - \(Number\(b\.ts\) \|\| 0\)\)/.test(appJs));
panding('项13 中间回复节点带时间戳（排序依据）', /div\.dataset\.ts = String\(Number\(ts\)/.test(appJs));
panding('项13 行动行有凸出浮雕（渐变 + 内外阴影）',
  /\.xingDongHang \{[^}]*linear-gradient\(180deg/.test(appCss.replace(/\n\s*/g, ' ')) && /\.xingDongHang:hover \{[^}]*translateY\(-1px\)/.test(appCss.replace(/\n\s*/g, ' ')));

/* ═══ 项 14：执行过程（改名 / 不限高 / 无滚动条） ══════════════════════ */
panding('项14 文案改成"执行过程"（内心活动/行动过程两个旧名都不再出现于语言包值）',
  (() => {
    const j = JSON.parse(rd(path.join(SRC, 'i18n/zh-CN.json')) || '{}');
    return j['chat.thinking'] === '执行过程' && j['chat.thinkingDone'] === '执行过程'
      && j['chat.actionLog'] === '执行过程' && j['chat.actingNow'].startsWith('执行中');
  })());
panding('项14 app.css 里思考正文不限高、不出滚动条',
  /\.siKaoKuai pre \{[^}]*max-height: none; overflow: visible/.test(appCss.replace(/\n\s*/g, ' ')));
panding('项14 renderer.css（后加载、会覆盖 app.css）同样不限高',
  /\.siKaoKuai pre \{[^}]*max-height: none; overflow: visible/.test(rendCss.replace(/\n\s*/g, ' ')));
panding('项14 执行过程区块本身也不限高', /\.xingDongKuai \{[^}]*max-height: none; overflow: visible/.test(appCss.replace(/\n\s*/g, ' ')));

/* ═══ 项 15：ASR 修好（不再拿聊天模型当识别模型） ═════════════════════ */
panding('项15 兜底不再用 providerCfg.model（当前聊天模型）当听话模型',
  appJsAlways() && !/asrChatShi\(anDie, providerCfg\.model \|\|/.test(main));
panding('项15 兜底只挑真正的听话模型（asr/whisper/paraformer…）',
  /asrMo = nengLiLianMoXing\('asr'\)\.find/.test(main));
panding('项15 识别语言不再写死 zh（跟随设置，auto 就不传）',
  !/asrChatShi\(anDie, asrMo, buf, yinPinGeShi, undefined, 'zh'\)/.test(main) && /langArg/.test(main));
panding('项15 结果合理性闸新增"话太多也是症状"（字数/秒 + 重复句）',
  /zi \/ yinPinMiao > 12/.test(main) && /\\1\{2,\}/.test(main));
panding('项15 降采样前先抗混叠（区间均值）+ 去直流',
  /区间均值/.test(appJs) && /dcBias/.test(appJs) && /Math\.floor\(\(i \+ 1\) \* ratio\)/.test(appJs));

/* ═══ i18n：十国齐全且键集合相等 ═══════════════════════════════════════ */
{
  const LANGS = ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko', 'ru', 'es', 'fr', 'pt', 'eo'];
  const xin = ['chat.thinking', 'chat.thinkingDone', 'chat.thinkingOpen', 'chat.thinkingCollapsed', 'chat.thinkingExpanded',
    'chat.actionLog', 'chat.actingNow', 'chat.tipTime', 'chat.tipModel', 'chat.tipTurns', 'chat.xdUpdated', 'chat.xdCost',
    'chat.hourShort', 'chat.minShort', 'chat.secShort', 'chat.cannotEdit', 'chat.pathNotFound', 'model.chip.unknown'];
  const counts = new Set();
  const que = [];
  for (const l of LANGS) {
    let j = {};
    try { j = JSON.parse(rd(path.join(SRC, 'i18n', l + '.json'))); } catch { /* */ }
    counts.add(Object.keys(j).length);
    for (const k of xin) if (!j[k]) que.push(l + ':' + k);
  }
  panding('i18n 十个语言包的键集合完全相等', counts.size === 1, [...counts].join(','));
  panding('i18n 本轮新增/改名的 ' + xin.length + ' 个键在十国里都有非空值', que.length === 0, que.slice(0, 6).join(' '));
}

/* ═══ 编译产物 & preload 接线（真机实际加载的是 dist） ═════════════════ */
panding('dist/preload.cjs 暴露新通道（luJingCunZai / daKaiBianJi / onXingDong / fuJianShouQuan）',
  ['luJingCunZai:', 'daKaiBianJi:', 'onXingDong:', 'fuJianShouQuan:'].every((k) => rd(path.join(DIST, 'preload.cjs')).includes(k)));
panding('dist 渲染层已含本轮改动（木马蒙版 + 执行行 + 合并气泡）',
  (() => { const d = rd(path.join(DIST, 'renderer/app.js')); return d.includes('xingDongZu') && d.includes('chat.tipTurns') && d.includes('siKaoKuai'); })());
panding('dist CSS 已含木马强调色蒙版', rd(path.join(DIST, 'renderer/app.css')).includes('muMa.svg'));
panding('dist 主进程已含本轮改动（门禁注入 + 台账通道 + plan.missing）',
  (() => { const d = rd(path.join(DIST, 'electron-main.js')); return d.includes('warmy:xingDongShiJian') && d.includes('plan.missing'); })());

/* ═══ 单元：真跑编译产物 ═══════════════════════════════════════════════ */
{
  try {
    const m = await import(pathToFileURL(path.join(PROV, 'mo-xing-neng-li.js')).href);
    const a = m.moXingNengLi('clef:latest', { vision: true, kind: 'imageUnd' });
    panding('单元 端点的"图像理解"能落到 kind=imageUnd（不再被当成画图）', a.kind === 'imageUnd', JSON.stringify(a));
    const b = m.moXingNengLi('clef-flash:latest', { vision: true });
    panding('单元 只有 vision、没有生成证据的模型不会被判成 image（画图）', b.kind !== 'image', JSON.stringify(b));
    const c = m.moXingNengLi('mystery-model-x', null);
    panding('单元 完全不认识的模型 kind=unknown（界面据此标"未知"）', c.kind === 'unknown', JSON.stringify(c));
  } catch (e) { panding('单元 mo-xing-neng-li 可加载', false, String(e).slice(0, 160)); }
}
{
  try {
    const m = await import(pathToFileURL(path.join(PROV, 'audio.js')).href);
    const body = m.taoAsrChatBody({ model: 'mimo-v2.5-asr', dataBase64: 'AAA', format: 'wav', language: '' });
    panding('单元 chat 式 ASR 请求体带 input_audio（wav）且"自动"时不传 language',
      !!body && JSON.stringify(body).includes('input_audio') && body.language === undefined, JSON.stringify(body).slice(0, 200));
  } catch (e) { panding('单元 audio.js 可加载', false, String(e).slice(0, 160)); }
}

/* ═══ 输出 ═════════════════════════════════════════════════════════════ */
function appJsAlways() { return true; }
const ok = jie.filter((x) => x.ok).length;
const bad = jie.length - ok;
for (const x of jie) console.log((x.ok ? '  ok   ' : '  FAIL ') + x.ming + (x.xiang ? '  ← ' + x.xiang : ''));
console.log(`\n==== verify-round35-changes：${ok} ok / ${bad} FAIL ====`);
process.exit(bad ? 1 : 0);
