/**
 * verify-round34-changes.mjs —— 第 34 轮 12 项变更的自持门禁
 *
 * 原则（第 34 轮 项 12 学到的）：**结果的绿不等于过程的绿**。
 * 以前只看"桌面上有没有那份文件"，于是模型绕三圈、把同一个 PPT 重造四遍也算过 ⇒ 假绿。
 * 这一层因此只做**静态 + 单元**：每条断言都指向"这一轮到底改了什么、少了会不会复发"，
 * 真行为（循环/重做/落点）交给 verify-round34-live.mjs 的轨迹判分。
 *
 * 用法：node verify-round34-changes.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const ROOT = __ROOT;
const SRC = path.join(ROOT, 'packages/app-shell/src');
const I18N = path.join(SRC, 'i18n');
const DIST = path.join(ROOT, 'packages/app-shell', 'dist');
const PACKS = ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko', 'ru', 'es', 'fr', 'pt', 'eo'];

let ok = 0;
const shi = [];
const jian = (ming, panding, xuan) => {
  if (panding) { ok += 1; return; }
  shi.push(ming + (xuan ? '  ← ' + String(xuan).slice(0, 220) : ''));
};
const du = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };

const appJs = du(path.join(SRC, 'renderer/app.js'));
const appCss = du(path.join(SRC, 'renderer/app.css'));
const indexHtml = du(path.join(SRC, 'renderer/index.html'));
const main = du(path.join(SRC, 'electron-main.ts'));
const preload = du(path.join(SRC, 'preload.cjs'));
const workTools = du(path.join(SRC, 'work-tools.ts'));
const subagents = du(path.join(SRC, 'subagents.ts'));
const packs = Object.fromEntries(PACKS.map((L) => [L, du(path.join(I18N, L + '.json'))]));

/* ── 项 1：模型「预设供应商」里不再有本地语音识别（本机服务） ───────────── */
{
  const xiaLa = appJs.match(/function GONGYING_YUSHE_JIAN\(\)[\s\S]*?\n  }/);
  jian('项1 预设供应商下拉里没有"本地语音识别/本机服务"', !!xiaLa && !/本机服务|本地语音识别/.test(xiaLa[0]), xiaLa && xiaLa[0].slice(0, 80));
  jian('项1 那条教用户去添加它的语言包文案已删除', PACKS.every((L) => !/"settings\.asrLocal(How|Hint)"/.test(packs[L])), '还留在某些包里');
}

/* ── 项 2：牛马管理局调用链：模型名与按钮同一行、同一中线 ─────────────── */
jian('项2 调用链行不换行、按钮与名称同高', /\.shiLiHang\.lianHang \{[^}]*flex-wrap: nowrap/.test(appCss)
  && /\.shiLiHang\.lianHang > button \{[^}]*height: 28px/.test(appCss)
  && /\.shiLiHang\.lianHang \.lianMing,[^}]*line-height: 28px/.test(appCss));
jian('项2 调用链行内的对齐交给 CSS（不再写 inline flex-wrap:wrap）', !/class="shiLiHang lianHang" style="margin:4px 0;align-items:center;flex-wrap:wrap/.test(appJs), '还有一处 inline wrap 会把按钮顶到下一行');

/* ── 项 3：计划任务由模型按门禁规则添加（宿主不按句拆） ─────────────────── */
{
  const miao = (workTools.match(/name: 'plan_update'[\s\S]*?description: '(.*?)',\n/) || [])[1] || '';
  jian('项3 plan_update 说明里写死了门禁（步数上下限/去重/单 doing/verified 只走 plan_verify）',
    /3 个及以上|至少 2 步/.test(miao) && /最多 10 步/.test(miao) && /同一时刻只能有 1 步 doing/.test(miao) && /逐句照抄用户原话/.test(miao), miao.slice(0, 120));
  jian('项3 宿主不再按句/按行替用户造计划行（host-seed 只被读来退役历史数据，没有任何地方写它）',
    !/\.note\s*=\s*'host-seed'|note:\s*'host-seed'/.test(main) && !/yuanWen.*split\(.*\n.*\).map.*plan/i.test(main), '还在写 host-seed 预置行');
}

/* ── 项 4：设置→功能：信任文件夹独立成块，排在本地语音之后 ─────────────── */
{
  const yinPin = appJs.indexOf('id="yinPinSheBeiKa"');
  const yuYin = appJs.indexOf('id="benDiYuYinKa"');
  const xinRen = appJs.indexOf('id="xinRenWenJianJiaKa"');
  jian('项4 三个块都在（音频设备 → 本地语音与文字互转 → 信任文件夹）', yinPin >= 0 && yuYin > yinPin && xinRen > yuYin,
    `yinPin=${yinPin} yuYin=${yuYin} xinRen=${xinRen}`);
  jian('项4 信任文件夹是自己的 sheZhiSection（不塞在音频设备里）', /<div class="sheZhiSection sheZhiKa" id="xinRenWenJianJiaKa"/.test(appJs));
  jian('项4 信任文件夹三个键十国语言包齐全', ['settings.trustedFoldersTitle', 'settings.trustedFoldersHint', 'settings.addTrustedFolder']
    .every((k) => PACKS.every((L) => packs[L].includes('"' + k + '"'))));
}

/* ── 项 5：同类文件图标统一（真分类行为由 verify-round34-ui.mjs 调 __wenJianIcoLei 判） ── */
{
  const zu = (appJs.match(/const WEN_JIAN_ZU = \{[\s\S]*?\n  \};/) || [''])[0];
  const you = (x) => new RegExp("'" + x + "'").test(zu);
  jian('项5 同族表包含 ppt 族 / 表格族 / 文档族 / 文本族的全部常见扩展名',
    zu.length > 0 && ['ppt', 'pptx', 'pptm', 'odp', 'key', 'xls', 'xlsx', 'csv', 'ods', 'numbers', 'doc', 'docx', 'odt', 'wps', 'epub', 'md', 'jpeg', 'webp']
      .filter((e) => !you(e)).length === 0,
    ['ppt', 'pptx', 'docx', 'csv'].filter((e) => !you(e)).join(','));
  jian('项5 分类函数暴露给验收（window.__wenJianIcoLei）', /window\.__wenJianIcoLei = wenJianIcoLei/.test(appJs));
  jian('项5 无扩展名的有名文件也认族（README→文本、Makefile/Dockerfile→代码）',
    /readme: 'wenBen'/.test(appJs) && /makefile: 'daiMa'/.test(appJs) && /dockerfile: 'daiMa'/.test(appJs));
}

/* ── 项 6：授权卡位置/展开/内容有确定性 ─────────────────────────────── */
jian('项6 授权卡进了第四列统一成员表（位置能落盘）', /mianBanShouQuanKuai: 'auth'/.test(appJs));
jian('项6 授权卡显隐由 applyPanelVisibility 统一决定', /set\('mianBanShouQuanKuai', vis\.mianBanShouQuanKuai\)/.test(appJs));
jian('项6 renderShouQuanKa 不再每次强行把卡加回来', !/queBaoKaPian\('mianBanShouQuanKuai'\)/.test(appJs), '还在无条件补卡 ⇒ 用户移除/拖动会被覆盖');
jian('项6 进会话就拉一次授权真实数据', /void renderShouQuanKa\?\.\(\);/.test(appJs));
jian('项6 展开时不再被"收起态的 inline 高度"压扁', !/ka\.style\.maxHeight = gaoDu\[id\]/.test(appJs) && /if \(Number\.isFinite\(h\) && h < 100\) \{ ka\.style\.height = ''; ka\.style\.maxHeight = ''/.test(appJs), '仍有 maxHeight 夹死展开的风险');
jian('项6 只有用户真的拉过右下角才记高度', /yongHuLaGuo/.test(appJs) && /ev\.target === ka && \(r\.bottom - ev\.clientY\) < 18/.test(appJs));
jian('项6 启动时读回卡片顺序/高度/收起/自定义卡片', /state\.panCards = jie/.test(appJs)
  && /window\.__panelCardHeights\[k\] = Math\.round\(n\)/.test(appJs)
  && /state\.customCards = s\.settings\.customCards/.test(appJs)
  && /state\.panKaShou = \{\}/.test(appJs));
jian('项6 添加卡片下拉里有授权卡', /<option value="mianBanShouQuanKuai">/.test(appJs));

/* ── 项 7：去掉刷新按钮，改动自动及时刷新 ─────────────────────────────── */
jian('项7 「↻ 刷新」按钮彻底移除（含 id 注册表）', !/anNiuShuaXinChanPin/.test(appJs), '代码里还留着');
jian('项7 主进程开了文件监听并广播变化', /function kaiWenJianJianShi/.test(main) && /wc\.send\('warmy:wenJianBianGeng'/.test(main));
jian('项7 监听有边界（忽略 node_modules/.git、项目目录只盯一层、防抖 600ms）',
  /JIAN_SHI_HUO_LUE/.test(main) && /gao\.forEach\(\(d\) => ka1\(d, true\)\)/.test(main) && /di\.forEach\(\(d\) => ka1\(d, false\)\)/.test(main) && /}, 600\)/.test(main));
jian('项7 窗口销毁会回收 watcher', /wc\.once\('destroyed'/.test(main));
jian('项7 移动/删除也会广播变化', /broadcastToWindows\('warmy:wenJianBianGeng', \{ sessionId, path: zhenAbs/.test(main));
jian('项7 preload 暴露 onWenJianBianGeng（并给退订）', /onWenJianBianGeng: \(cb\) =>/.test(preload) && /removeListener\('warmy:wenJianBianGeng'/.test(preload));
jian('项7 渲染层收到变化会防抖重画、按会话过滤', /window\.warmy\.onWenJianBianGeng\?\.\(/.test(appJs) && /500\)/.test(appJs) && /!g\.sid \|\| g\.sid === String\(\(state\.selectedChat/.test(appJs));
jian('项7 产物按真实存在性剪掉（删掉的不再挂着）', /g\.missing = true/.test(appJs) && /filter\(\(g\) => !g\.missing/.test(appJs));
jian('项7 段落折叠状态在自动重画后仍然保持', /window\.__pfSectionShou/.test(appJs));

/* ── 项 8：思考/模型悬停提示不再写"已改用上面那个" ───────────────────── */
jian('项8 渲染层降级提示里没有"已改用"', !/modelDegradedTo/.test(appJs), '还在拼这句');
jian('项8 主进程降级提示里没有"已改用"', !/chat\.modelDegradedTo/.test(main), '还在拼这句');
jian('项8 语言包已删除该键', PACKS.every((L) => !packs[L].includes('"chat.modelDegradedTo"')));

/* ── 项 9：分身卡重做 ─────────────────────────────────────────────── */
jian('项9 一行只显示 时间/任务(截断)/状态', /class="fenShenZt"[\s\S]{0,80}zhuangTaiWen/.test(appJs) && /renWu\.length > 46 \? \(renWu\.slice\(0, 46\) \+ '…'\)/.test(appJs));
jian('项9 点行展开详情：完整时间/全文任务/派发者/小弟X号/模型全称',
  /fenShenXiang/.test(appJs) && /'小弟' \+ String\(Number\(x\.hao \|\| 0\)\) \+ '号'/.test(appJs) && /fsWanZhengShi\(x\.endedAt\)/.test(appJs));
jian('项9 悬停气泡五项齐全（创建时间/任务内容/派发者/执行者/模型）',
  /tipCreated/.test(appJs) && /tipTask/.test(appJs) && /tipParent/.test(appJs) && /tipRunner/.test(appJs) && /tipModel/.test(appJs));
jian('项9 右键菜单有「停止」和「重试」两项', /panel\.fenshen\.stop/.test(appJs) && /panel\.fenshen\.retry/.test(appJs) && /xiiaoDiChongShi|window\.warmy\.xiaoDiChongShi/.test(appJs));
jian('项9 已停下的「停止」灰掉、正在跑的「重试」灰掉', /xiang\(tOr\('panel\.fenshen\.stop', '停止'\), !yiTing/.test(appJs) && /xiang\(tOr\('panel\.fenshen\.retry', '重试'\), zt !== 'running'/.test(appJs));
jian('项9 选中行有强调外框 + 进行中竖线 + 停止后删除线',
  /\.fenShenHang\.xuanZhong \{ outline/.test(appCss) && /\.fenShenHang\.isRun \{ border-left-color: var\(--accent\)/.test(appCss) && /\.fenShenHang\.isStop[\s\S]{0,120}line-through/.test(appCss));
jian('项9 标题旁 x:X:X 计数', /ji\.textContent = run \+ ':' \+ bad \+ ':' \+ ok2/.test(appJs));
jian('项9 分身卡默认收起状态能被记住（与其它卡同一机制）', /huanYuanKaShou\(\)/.test(appJs));
jian('项9 「停止」真的掐掉在途请求（不是只改状态）', /xiaoDiKongZhi\.get\(id\)\?\.abort\(\)/.test(main) && /signal: kong\.signal/.test(main));
jian('项9 「重试」= 同供应商同模型真跑一遍', /chuliIpc\('warmy:xiaoDiChongShi'/.test(main) && /void paoXiaoDiRenWu\(\{ lu: xin, provider, moXing: String\(xin\.modelId/.test(main));
jian('项9 记录里存了供应商与原始模型 id', /presetId\?: string/.test(subagents) && /modelId\?: string/.test(subagents) && /modelId: moXingId/.test(main));
jian('项9 卡片显示「供应商 · 模型」全称', /model: gongMing \? \(gongMing \+ ' · ' \+ moXingId\) : moXingId/.test(main));
jian('项9 preload 有 xiaoDiChongShi', /xiaoDiChongShi: \(payload\) => ipcRenderer\.invoke\('warmy:xiaoDiChongShi'/.test(preload));
jian('项9 进会话会主动拉分身列表', /void renderFenShenKa\?\.\(\);/.test(appJs));

/* ── 项 10：所有卡片（含自定义）都能折叠 ───────────────────────────── */
jian('项10 折叠绑定覆盖自定义卡片（用后代选择器，不再只挑直接子节点）',
  /host\.querySelectorAll\('\.mianBanKuai'\)\.forEach\(\(ka\) => \{\s*if \(ka\.dataset\.collapseBound/.test(appJs), '还是 :scope > 绑不到容器里的自定义卡片');
jian('项10 拖拽标题行认得 .mianBanBiaoTi（定时/分身/项目记忆）',
  /:scope > h3, :scope > \.mianBanKaiGuan, :scope > \.mianBanBiaoTi/.test(appJs));
jian('项10 不再有"整张卡片当拖拽面"的兜底（它会吞掉正文的点击）',
  !/yinPanKaTuo\(ka, ka\)/.test(appJs), '还有整卡兜底');
jian('项10 按下不再立即 setPointerCapture（capture 会把 click 抢走）',
  !/hand\.setPointerCapture/.test(appJs), 'pointerdown 就捕获 ⇒ 点标题折不起来');
jian('项10 只有真拖过才吞一次 click（旧的"拖拽面上永久吞 click"已消失，且 400ms 自动解除）',
  !/hand\.addEventListener\('click', \(e\) => \{ e\.preventDefault\(\); e\.stopPropagation\(\); \}\)/.test(appJs)
  && /if \(!z0\.dong\) return;/.test(appJs)
  && /window\.addEventListener\('click', xiao, true\)/.test(appJs)
  && /setTimeout\(\(\) => \{ try \{ window\.removeEventListener\('click', xiao, true\); \} catch \{ \/\* noop \*\/ \} \}, 400\)/.test(appJs));
jian('项10 收起 = CSS 只剩标题行（不被重渲染冲掉）',
  /\.mianBanKuai\.shouQi > :not\(\[data-ka-title\]\)/.test(appCss) && /\.mianBanKuai\.shouQi \{[\s\S]{0,120}resize: none/.test(appCss));
jian('项10 补出来的折叠箭头会接进 toggle（以前是 const，箭头永远不动）',
  /let jianTou = biaoTi\.querySelector/.test(appJs) && /jianTou = j;/.test(appJs));
jian('项10 折叠状态落盘 + 启动读回', /panelCardCollapsed: state\.panKaShou/.test(appJs) && /s\.settings\.panelCardCollapsed/.test(appJs));
jian('项10 标题行不参与文字选中', /\.mianBanKuai > \.mianBanKaiGuan, \.mianBanKuai > \.mianBanBiaoTi, \.mianBanKuai > h3 \{ user-select: none/.test(appCss));

/* ── 项 11：分身卡/计划卡显示排序 ─────────────────────────────────── */
jian('项11 计划卡显示顺序：已完成→已停止→进行中→刚创建', /JI_HUA_DENG = \{ verified: 0, done: 0, deleted: 1, blocked: 1, doing: 2, pending: 3 \}/.test(appJs));
jian('项11 计划卡只重排显示、编号不动（渲染用的是排好序的 xianShi）', /he\.innerHTML = xianShi\.map/.test(appJs) && /state\.jiHuaRenWu = bu;/.test(appJs));
jian('项11 分身卡显示顺序：已完成→已停止→进行中', /FEN_DENG = \{ done: 0, stopped: 1, failed: 1, running: 2 \}/.test(appJs) && /const xianShi = items\.slice\(\)\.sort/.test(appJs));

/* ── 项 12【本轮测试】真机循环的三个根因 ─────────────────────────────── */
jian('项12 交付物落点纠正：用户要桌面 + 裸文件名 ⇒ 改道 Desktop/<名> 走同一套授权',
  /function jiaoFuWuLuoDian/.test(main) && /return 'Desktop\/' \+ r;/.test(main) && /mingZhongJu/.test(main));
jian('项12 落点纠正只在执行前改一次参数，不在工作区留副本',
  /audit\?\.log\('chat\.deliverable-target-fixed'/.test(main) && !/先写工作区再复制到桌面|复制.*到桌面/.test(main));
jian('项12 每个文件名只改一次（不许反复改道）', /jiaoFuWuGaiXie/.test(main) && /yiGai\.has\(key\)/.test(main));
jian('项12 桌面交付物已真实落盘后，不再拿"别处已有同名"拦正确的桌面写入（但 open_path 的同名提示保留）',
  /const jiaoFuWuZaiDing = new Map/.test(main) && /const keLanTongMing = !zhuoMianJiaoFuWu\(sid\);/.test(main)
  && /keLanTongMing \? tongMingBieChu/.test(main)
  && /tongMingBieChu\(riH, abs, \['write\|', 'gen\|', 'open\|'\]\)/.test(main), '拦不拦没分开，或把提示也删了');
jian('项12 换任务会清掉落点纠正的账', /jiaoFuWuGaiXie\.delete\(sessionId\)/.test(main) && /jiaoFuWuZaiDing\.delete\(sessionId\)/.test(main));
jian('项12 一模一样的交付物不做第二遍：所有轮都拦（以前只在续接轮拦）',
  /if \(!shiFuGaiQueRen\(a\)\) \{[\s\S]{0,1400}if \(!benLunXuJie\.get\(sid\)\) return null;/.test(main), '重复生成闸仍被"续接轮"挡住 ⇒ 首轮能重造四遍');
jian('项12 同路径文档还在 ⇒ 不再整篇重造（要重做带 overwrite:true）',
  /stepGenExists/.test(main) && /jg && zai\) return fanHui\(jg/.test(main));
jian('项12 只读探测的重复 = 回缓存 + 中性事件，不再判成循环',
  /ZHI_DU_CHONG_FU/.test(main) && /chat\.tool-repeat-cached/.test(main)
  && /benMing \? 'chat\.tool-repeat-cached' : 'chat\.tool-repeat-stopped'/.test(main));
jian('项12 只读集合里都是不改变世界状态的工具',
  /'read_file', 'list_dir', 'find_files', 'search_files', 'list_archive', 'read_archive_entry'/.test(main));
/** 幂等重复与长文副本（真机 r34-b1：同参 write_file 与 novel_check.txt 各判死一轮） */
jian('项12 同参数已成功写过的重复 = 幂等缓存，不记循环异常（append 除外；改写前后两份指纹都记）',
  /const IDEMPOTENT_CHONG_FU = new Set/.test(main) && /chengGongZhiWen\.add\(zhiWenOf\(gongJuMing, c\)\)/.test(main)
  && /gaiDaoQianCanShu\.get\(String\(sessionId \|\| \'\'\) \+ \'\|\' \+ gongJuMing\)/.test(main)
  && /gaiDaoQianCanShu\.set\(String\(sessionId \|\| \'\'\) \+ \'\|\' \+ gongJuMing/.test(main));
jian('项12 跨轮 ≥3 次的重复也先判幂等：只读/幂等只记中性事件，不再触发 tool-repeat-3x',
  /if \(zong >= 3 && !benMing\) \{[\s\S]{0,200}chat\.tool-repeat-3x/.test(main)
  && /else if \(zong >= 3\) \{[\s\S]{0,160}chat\.tool-repeat-cached/.test(main));
jian('项12 长文"换个名字另存一份去自己数字数"被拒（所有轮都拦）',
  /function changWenFuZhiLan/.test(main) && /fuGaiDiuGao\(ri, a, base\) \|\| zhuiJiaCuoWei\(ri, a, base\) \|\| changWenFuZhiLan\(ri, a, base\)/.test(main)
  && /longTextCopyBlocked/.test(main));
/** 文件系统事实版：不再依赖内存台账（真机 r34-c1 台账没对上 ⇒ 同一个 PPT 被重造、还 copy_file 出"验证副本"） */
jian('项12 本任务刚产出的文件不再被整篇重造（按 mtime 判，不靠台账）',
  /function benRenWuZiJiChanChuLan/.test(main) && /x\.mtime < kai/.test(main) && /regenOwnBlocked/.test(main));
jian('项12 copy_file 把交付物另存到工作区外当"验证副本"被拒',
  /ming === 'copy_file'/.test(main) && /verifyCopyBlocked/.test(main) && /zaiGongZuoQuNei/.test(main));
jian('项12 台账为空也要过这道闸（新守卫在 ri 判空之前）',
  /jieZ\.ok && \/\^\(\?:make_/.test(main) && main.indexOf('benRenWuZiJiChanChuLan(mingNei') < main.indexOf('const ri = benCiRenWuBuZhou.get(sid);'));
jian('项12 长文"变长"的整篇覆盖仍放行（不能把小说一段段写大也拦掉）',
  /xin > jiu \* 1\.02\) return null/.test(main));
jian('项12 同一目录同族交付物只许一份（换名字重做被拦；工作区内不拦）',
  /function tongLeiDiErFenLan/.test(main) && /sameFamilySecondBlocked/.test(main) && /if \(zaiGongZuoQuNei\) return null/.test(main));
/** 第 11–13 个根因（真机 r35-2-ollama-4）：open_path 被通用指纹闸抢走 ⇒ 记成循环；长文差字数被弹卡抛回用户 */
jian('项12 open_path 交给它自己的"已打开过"处理，不再被通用指纹闸记成循环',
  /'open_path', 'open_file'\]/.test(main) && /huiHuaYiDaKai/.test(main));
jian('项12 长文还差字数时不许弹决策卡抛回用户（要它继续 append，或停下如实汇报）',
  /chat\.ask-length-blocked/.test(main) && /askLengthBlocked/.test(main) && /changWenChai && zaiShuoChangWen/.test(main));
jian('项12 弃稿重来（第一篇没写完就另起一篇从头写）被拒',
  /abandon-draft/.test(main) && /weiXieWan\(other\)/.test(main));
/** 第四个根因：整篇正文在历史里堆了十几份 ⇒ 23 万 token 打死 12.8 万窗口的本地模型（真机 400） */
jian('项12 发请求前压实上下文：同一文件的旧版整篇正文不再重复发送',
  /function yaSuoMoXingXiaoXi/.test(main) && /DAI_ZHENG_WEN_GONG_JU/.test(main) && /zuiHouYiCi\.set/.test(main));
jian('项12 压实钩子真的接进主循环与子代理循环',
  (main.match(/yaSuoLai: yaSuoMoXingXiaoXi/g) || []).length >= 2, '接线次数不足');
jian('项12 超出上下文被拒时压硬一档重发一次（不再整轮报废）',
  /exceeds the available context/.test(du(path.join(ROOT, 'packages/providers/src/tools.ts')))
  && /compress-after-context-overflow/.test(du(path.join(ROOT, 'packages/providers/src/tools.ts'))));
jian('项12 整篇重写时明确引导模型改用 append:true（少发重复全文才是根治）',
  /整篇重写/.test(main) && /下一段请只发新增内容，并带 `append:true`/.test(main));
/** 第五个根因：字数永远差最后几十个字 ⇒ 宿主一直催，模型一路写到轮数封顶 */
jian('项12 字数达标线 = 要求的 95%（与验收同口径，不再按精确值催写）',
  /const daBiaoXian = Math\.ceil\(yao \* 0\.95\)/.test(main) && /jing >= daBiaoXian/.test(main));
jian('项12 连续三次只增不到 2% ⇒ 判定写不动了并**叫停**（不再催、也不再以此续派）',
  /chat\.length-stall/.test(main) && /zhuang\.xia >= 3/.test(main) && /changWenTingZhiLe\(sid\)/.test(main)
  && /plan\.length-stall-stop/.test(main));
jian('项12 停滞账本按会话清理（换任务不带着上一次的停滞）',
  /for \(const k of \[\.\.\.changWenJinZhan\.keys\(\)\]\)/.test(main));

/* ── 单元：子代理登记簿带上新字段仍可用 ─────────────────────────────── */
{
  const os = await import('node:os');
  const { pathToFileURL } = await import('node:url');
  const m = await import(pathToFileURL(path.join(DIST, 'subagents.js')).href);
  const XiaoDiDengJiBu = m.XiaoDiDengJiBu;
  const wen = path.join(os.tmpdir(), 'r34-xiaodi-unit-' + Date.now() + '.json');
  const bu = new XiaoDiDengJiBu(wen);
  const p1 = bu.pai('阿黄', Date.now(), { sessionId: 's1', task: '写一段', model: 'MiMo · mimo-v2.6-flash', modelId: 'mimo-v2.6-flash', presetId: 'mimo-token-plan', status: 'running' });
  jian('单元 派出小弟能带 modelId/presetId 并登记 running', p1.ok === true && p1.lu.modelId === 'mimo-v2.6-flash' && p1.lu.presetId === 'mimo-token-plan' && p1.lu.status === 'running', JSON.stringify(p1).slice(0, 120));
  const p2 = bu.pai('阿黄', Date.now(), { sessionId: 's1' });
  jian('单元 编号继续递增（小弟1号 → 小弟2号）', p2.ok === true && p1.lu.hao === 1 && p2.lu.hao === 2, `${p1.lu && p1.lu.hao}/${p2.lu && p2.lu.hao}`);
  const g = bu.gengXin(p1.lu.id, { status: 'done', endedAt: Date.now() });
  jian('单元 状态可回写 done', g && g.status === 'done');
  const chong = new XiaoDiDengJiBu(wen);
  jian('单元 重启后读回同一份账（modelId 不丢）', (chong.all().find((x) => x.id === p1.lu.id) || {}).modelId === 'mimo-v2.6-flash');
  const hu = chong.listHuiHua('s1');
  jian('单元 按会话列分身（倒序）', hu.length === 2 && Number(hu[0].createdAt) >= Number(hu[1].createdAt), JSON.stringify(hu.map((x) => x.ming)));
  try { fs.unlinkSync(wen); } catch { /* noop */ }
}

/* ── 单元：交付物落点判类（与主进程同一套口径的纯函数面） ───────────── */
{
  /** jiaoFuWuLei 在 electron-main 里是模块私有 ⇒ 这里查编译产物里确实带上了本轮改动，
   *  真行为由 verify-round34-live.mjs 的桌面差分与轨迹判分负责（不在这里重实现一遍）。 */
  const js = du(path.join(DIST, 'electron-main.js'));
  jian('编译产物里已带上落点纠正与只读缓存（改到的是真跑的那份）',
    /function jiaoFuWuLuoDian/.test(js) && /ZHI_DU_CHONG_FU/.test(js) && /chat\.tool-repeat-cached/.test(js) && /kaiWenJianJianShi/.test(js));
  jian('dist 渲染层已同步本轮改动', /huanYuanKaShou/.test(du(path.join(DIST, 'renderer', 'app.js'))));
  jian('dist 语言包已同步（分身卡新键在）', /panel\.fenshen\.retry/.test(du(path.join(DIST, 'i18n', 'zh-CN.json'))));
}

/* ── 第 34 轮 项 12 收尾（r35-live5 复盘）：空壳交付物 / 拦下后重发 / 短稿误判 ── */
{
  const js = du(path.join(DIST, 'electron-main.js'));
  const wt = du(path.join(SRC, 'work-tools.ts'));
  jian('生成器有"空稿闸"：一个正文都没有就如实失败，不写出空壳文件',
    /make_pptx-empty-content/.test(wt) && /make_docx-empty-content/.test(wt) && /make_xlsx-empty-content/.test(wt) && /make_pdf-empty-content/.test(wt));
  jian('make_pptx 认得模型把正文发在 content/text/paragraphs 里的写法（旧代码兜底成空白页）',
    /for \(const k of \['content', 'text', 'paragraphs', 'body', 'bullets', 'pages'\]\)/.test(wt));
  jian('生成结果里报出真正写进去的字数（宿主不给出"假成功"）',
    /正文合计 \$\{pianZiShu\} 字/.test(wt) && /ziShu: pianZiShu/.test(wt));
  jian('守卫拦下的调用再原样发一次 ≠ 循环（记 blocked-repeat，不再记 fei-ming-deng）',
    /const lanXiaZhiWen = new Map\(\)/.test(js) && /beiLanGuo \? 'blocked-repeat'/.test(js) && /lanXiaZhiWen\.set\(fpL, yiZuo\.wen\)/.test(js));
  jian('磁盘上那份是空壳时允许重做（regen-own 先量文件正文，不能把补做拦成循环）',
    /liYou: 'regen-own'/.test(js) && /tiQuWenDang\(lu\.abs/.test(js) && /chat\.deliverable-repair/.test(js));
  jian('只写过一次的短交付物不算"写了一半的长文"（弃稿闸要求同一份 ≥2 次写入）',
    /const xieRuCiShu = new Map\(\)/.test(js) && /if \(\(xieRuCiShu\.get\(String\(sid \|\| ''\) \+ '\|' \+ buZhouJian\(other\)\) \|\| 0\) < 2\)/.test(js));
  jian('第一次报字数时话说得软（这份可能只是短交付物，长文还没开工）',
    /llm\.lengthProgressSoft/.test(js) && /xieCi < 2/.test(js));
  const lang = ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko', 'fr', 'es', 'pt', 'ru', 'eo'];  const que = lang.filter((m) => !du(path.join(SRC, 'i18n', m + '.json')).includes('"llm.lengthProgressSoft"'));
  jian('十国语言包都补了 lengthProgressSoft（占位符一致）', que.length === 0, que.join(','));
  const kaiTi = lang.filter((m) => {
    const w = JSON.parse(du(path.join(SRC, 'i18n', m + '.json')))['llm.lengthProgressSoft'] || '';
    return !['{n}', '{p}', '{y}', '{x}'].every((k) => w.includes(k));
  });
  jian('新话术里的占位符 {n}{p}{y}{x} 每国都在（不会漏字）', kaiTi.length === 0, kaiTi.join(','));
  /**
   * **真机门禁的"认交付物"口径**（r36 第 1 计次我自己写错的那条，钉住不许再犯）：
   * 用户原话只说"生成一个 txt…写入 你是谁，我是谁"，**没规定文件名** ⇒ 只能按**正文**认，
   * 并按**路径身份**排除交付物；任何"按文件名里有没有你是谁"的猜法都是假红来源。
   */
  {
    const live = du(path.join(path.dirname(fileURLToPath(import.meta.url)), 'verify-round34-live.mjs'));
    const fu = du(path.join(path.dirname(fileURLToPath(import.meta.url)), 'verify-round34-jiaofu.mjs'));
    jian('live 门禁把"认交付物"抽成纯函数并按证据强度退级（轨迹>正文>文件名）',
      /import \{ renJiaoFu \}/.test(live) && /const kaiShiJian = op\('open_path\.try'\)/.test(live)
        && /const dengKai0 = /.test(live) && /const SHENG = \['trajectory', 'content', 'name'\]/.test(fu));
    jian('live 门禁不再留任何"文件名里有没有你是谁"的直接猜法（判据只在纯函数里，且可回放）',
      !/\/你是谁\/\.test\(path\.basename/.test(live) && !/shiJiaoFuWen/.test(live) && !/hanLiangJu/.test(live));
    jian('小说候选与"长文只有一份"都按路径身份排除交付物（同一口径，不会互相打脸）',
      (live.match(/!jiaoFuLuJing\.has\(xiaoXie\(p\)\)/g) || []).length >= 2);
    jian('live 门禁有空壳判据（办公文件正文 ≥20 字）', /kongKe/.test(live) && /ziShu\(x\.wen\) < 20/.test(live));
  }
}
/* ── 单元：生成器空稿闸的真行为（不只看源码里有没有这句话） ─────────── */
{
  const os = await import('node:os');
  const { pathToFileURL } = await import('node:url');
  const wt = await import(pathToFileURL(path.join(DIST, 'work-tools.js')).href);
  const de = await import(pathToFileURL(path.join(DIST, 'doc-extract.js')).href);
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'r36-konggao-'));
  const MU = path.join(ROOT, 'packages/app-shell');
  try {
    const r1 = wt.workMakePptx(d, { path: 'a.pptx' }, false, MU);
    jian('单元 只给 path 不给 slides ⇒ 如实失败且不写文件',
      r1.ok === false && /empty-content/.test(String(r1.content)) && !fs.existsSync(path.join(d, 'a.pptx')), String(r1.content).slice(0, 80));
    const r2 = wt.workMakePptx(d, { path: 'b.pptx', title: '你是谁，我是谁', content: '我是牛马-1\n你是老板' }, false, MU);
    jian('单元 正文落在 content 上也能生成，且提取回来的正文真有标题',
      r2.ok === true && Number(r2.meta.ziShu) >= 10 && /你是谁/.test(String(de.tiQuWenDang(String(r2.meta.abs)).text)), JSON.stringify(r2.meta).slice(0, 120));
    const r3 = wt.workMakePptx(d, { path: 'c.pptx', slides: [{ title: '首页', body: ['要点一'] }] }, false, MU);
    jian('单元 正常 slides 照常生成（页数与字数都报出来）',
      r3.ok === true && r3.meta.pian === 1 && Number(r3.meta.ziShu) > 0, JSON.stringify({ p: r3.meta.pian, z: r3.meta.ziShu }));
    const r4 = wt.workMakeDocx(d, { path: 'e.docx', content: '  \n \n ' });
    const r5 = wt.workMakeXlsx(d, { path: 'f.xlsx', sheets: [{ name: 'S', rows: [['', '']] }] });
    const r6 = wt.workMakePdf(d, { path: 'g.pdf', content: '   ' });
    jian('单元 docx/xlsx/pdf 的空白参数同样被拦下且不留文件',
      !r4.ok && !r5.ok && !r6.ok && !fs.existsSync(path.join(d, 'e.docx')) && !fs.existsSync(path.join(d, 'f.xlsx')) && !fs.existsSync(path.join(d, 'g.pdf')),
      [r4.content, r5.content, r6.content].map((s) => String(s).slice(0, 26)).join(' / '));
  } finally {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* noop */ }
  }
}

/* ── 单元：交付物认定纯函数（用三次真机实录回放，防"假红级联"复发） ─── */
{
  const { pathToFileURL } = await import('node:url');
  const { renJiaoFu } = await import(pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), 'verify-round34-jiaofu.mjs')).href);
  const kai = (m, ts) => ({ abs: 'D:\\X\\' + m, ts });
  /** 实录 A：r36-ollama-4（模型起名 身份.txt / 身份.pptx，等待前打开这两份，小说 6234 字另开一份） */
  const xinA = [
    { m: '身份.txt', p: 'D:\\X\\身份.txt', wen: '我是牛马-1，你是老板。' },
    { m: '身份.pptx', p: 'D:\\X\\身份.pptx', wen: '封面 我是谁 你是谁 关于模型' },
    { m: '牛马记.txt', p: 'D:\\X\\牛马记.txt', wen: '你是谁' + '字'.repeat(6000) },
  ];
  const a = renJiaoFu({ xin: xinA, kai: [kai('身份.txt', 1000), kai('身份.pptx', 1100), kai('牛马记.txt', 5000)], dengKai: 2000 });
  jian('回放 A（r36-ollama-4 自由起名）按轨迹认对两份，不再假红',
    a.fangshi === 'txt:trajectory/ppt:trajectory' && a.txt[0].m === '身份.txt' && a.ppt[0].m === '身份.pptx',
    JSON.stringify({ f: a.fangshi, t: a.txt.map((x) => x.m), p: a.ppt.map((x) => x.m) }));
  /** 实录 B：r35-live5-mimo-1（6000 字小说被**追加进短稿**：桌面 你是谁我是谁.txt 6144 字 + pptx 426 字） */
  const xinB = [
    { m: '你是谁我是谁.txt', p: 'D:\\X\\你是谁我是谁.txt', wen: '你是谁，我是谁。' + '字'.repeat(6100) },
    { m: '你是谁我是谁.pptx', p: 'D:\\X\\你是谁我是谁.pptx', wen: '你是谁，我是谁' },
  ];
  const b = renJiaoFu({ xin: xinB, kai: [kai('你是谁我是谁.txt', 1000), kai('你是谁我是谁.pptx', 1100)], dengKai: 2000 });
  jian('回放 B（合并事故）认下的交付物就是那份被撑长的 txt ⇒ 小说候选为空 ⇒ 只有"小说没单独成文"一条红',
    b.txt.length === 1 && b.txt[0].m === '你是谁我是谁.txt' && b.ppt.length === 1, JSON.stringify({ f: b.fangshi, t: b.txt.map((x) => x.m) }));
  /** 实录 C：r35-live5-ollama-4（pptx 是空壳：只有模板占位字） */
  const xinC = [
    { m: '我是谁你是谁.txt', p: 'D:\\X\\我是谁你是谁.txt', wen: '我是谁，你是谁。' },
    { m: '我是谁你是谁.pptx', p: 'D:\\X\\我是谁你是谁.pptx', wen: '单击此处添加标题' },
  ];
  const c = renJiaoFu({ xin: xinC, kai: [kai('我是谁你是谁.txt', 1000), kai('我是谁你是谁.pptx', 1200)], dengKai: 2000 });
  jian('回放 C（空壳 ppt）照样把两份认出来 ⇒ 交给"办公文件正文 ≥20 字"那条去判红',
    c.ppt.length === 1 && [...c.ppt[0].wen.replace(/\s/g, '')].length < 20, JSON.stringify({ f: c.fangshi, p: c.ppt.map((x) => x.m) }));
  /** 退级：没有"等待前打开"事件 ⇒ 用正文；正文也没有 ⇒ 用文件名；都没有 ⇒ 如实空手 */
  const d = renJiaoFu({ xin: xinA, kai: [], dengKai: null });
  jian('没有等待事件时退到正文判据；正文对不上就**如实空手**（不拿"写过"的文件硬凑成交付物）',
    d.fangshi === 'txt:none/ppt:content' && d.ppt[0].m === '身份.pptx' && d.txt.length === 0,
    JSON.stringify({ f: d.fangshi, t: d.txt.map((x) => x.m), p: d.ppt.map((x) => x.m) }));
  /** 正文级出现多份候选时取**最短**那份 ⇒ 短稿是交付物、长的那份是小说（合并事故会被暴露而非隐藏） */
  const duo = [
    { m: '说明.txt', p: 'D:\\X\\说明.txt', wen: '你是谁，我是谁。（300 字）' + '字'.repeat(300) },
    { m: '长篇.txt', p: 'D:\\X\\长篇.txt', wen: '你是谁，我是谁？' + '字'.repeat(6000) },
    { m: '片子.pptx', p: 'D:\\X\\片子.pptx', wen: '你是谁 我是谁 一页' },
  ];
  const du2 = renJiaoFu({ xin: duo, kai: [], dengKai: null });
  jian('正文级多候选取最短（长的那份留给"小说"判分，不会把小说当交付物）',
    du2.txt[0].m === '说明.txt' && du2.ppt[0].m === '片子.pptx', JSON.stringify({ t: du2.txt.map((x) => x.m), p: du2.ppt.map((x) => x.m) }));
  const e = renJiaoFu({ xin: [{ m: '你是谁我是谁.txt', p: 'D:\\X\\你是谁我是谁.txt', wen: '随便一句话' }], kai: [], dengKai: null });
  jian('正文没关键词时还能按文件名退到第三级（txt:name / ppt:none）',
    e.fangshi === 'txt:name/ppt:none' && e.txt.length === 1, JSON.stringify({ f: e.fangshi, t: e.txt.map((x) => x.m), l: e.liyou }));
}

console.log(`==== verify-round34-changes：${ok} ok / ${shi.length} FAIL ====`);
for (const s of shi) console.log('  FAIL ' + s);
process.exit(shi.length ? 1 : 0);
