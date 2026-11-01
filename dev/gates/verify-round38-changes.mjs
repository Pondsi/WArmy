/**
 * verify-round38-changes.mjs —— 第 38 轮 11 项变更的自持门禁（静态 + 口径级）
 *
 * 每条断言都写成"**少了它这轮的坏行为就会复发**"，并且**不锚在会漂的东西上**
 * （不写死变量名顺序、不写字节偏移；判"关系与顺序"、判"两份 CSS 一起改"、判"十国键齐全"）。
 * 跑法：node dev/gates/verify-round38-changes.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(ROOT, 'packages/app-shell/src');
const DIST = path.join(ROOT, 'packages/app-shell/dist');
const LANG = ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko', 'fr', 'es', 'pt', 'ru', 'eo'];
const du = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const main = du(path.join(SRC, 'electron-main.ts'));
const app = du(path.join(SRC, 'renderer/app.js'));
const cssA = du(path.join(SRC, 'renderer/app.css'));
const cssR = du(path.join(SRC, 'renderer/renderer.css'));
const html = du(path.join(SRC, 'renderer/index.html'));
const pre = du(path.join(SRC, 'preload.cjs'));
const ac = du(path.join(SRC, 'archive-cleanup.ts'));
const eta = du(path.join(SRC, 'eta-forecast.ts'));
const packs = Object.fromEntries(LANG.map((m) => [m, (() => { try { return JSON.parse(du(path.join(SRC, 'i18n', m + '.json'))); } catch { return {}; } })()]));

let ok = 0; const shi = [];
const jian = (ming, panding, xuan) => { if (panding) { ok += 1; return; } shi.push(ming + (xuan ? '  ← ' + String(xuan).slice(0, 200) : '')); };
const quanBu = (k, pan) => LANG.filter((m) => !pan(packs[m][k]));

/* ── 项 7【最优先】ASR 次序：本机语音服务优先，三种情况才落到听话模型链 ── */
{
  const iLocal = main.indexOf('if (localEnabled) {');
  const iChain = main.indexOf("const houXuan = [...new Set(nengLiLianMoXing('asr'))]");
  jian('项7 本机语音启用即仅本地，且在听话模型链之前返回（第 77 轮定稿）',
    iLocal > 0 && iChain > iLocal && /return \{ ok: false, error: bd\.error \|\| 'bendi-yuyin-empty-result'/.test(main));
  jian('项7 未启用本机时才走听话模型链（候选只来自配置的 asr 链）',
    /const localEnabled = !!zhuangTaiBenDiYuYin\(\)\.qiYong;/.test(main)
    && /const houXuan = \[\.\.\.new Set\(nengLiLianMoXing\('asr'\)\)\]/.test(main));
  jian('项7 本机失败如实报错、不静默降级（不假装成功）',
    /bendi-yuyin-asr-failed/.test(main) && /return \{ ok: false, error: bd\.error/.test(main));
  jian('项7 识别语言跟随设置，auto 就不传（不写死 zh）',
    /asrLang/.test(main) && /const yuYan = lang && lang !== 'auto' \? lang : undefined;/.test(main));
  jian('项7 谁答的都能查（asr.used 带 source）',
    /audit\?\.log\('asr\.used'/.test(main) && /source: r\.source/.test(main));
  const bb = du(path.join(SRC, 'bendi-yuyin.ts'));
  /**
   * 【这一轮最底层的那条根因】Electron 的 V8/N-API **禁止创建外部 ArrayBuffer**：
   * sherpa-onnx 的 `readWave(p)` / `tts.generate()` 默认就要建一个 ⇒ 在应用里**必抛**
   * `External buffers are not allowed`，本机识别与本机合成**从来没有成功过一次**，
   * 每次都静默落到听话模型链 —— 用户看到的就是"语音转文字改了半天毫无变化"。
   * 系统 node 里不抛，所以只有真机门禁抓得到；这两个参数一旦被人"清理"掉，故障原样复发。
   */
  jian('项7 【根因】readWave 关掉外部缓冲区、TTS generate 关 enableExternalBuffer（少一个本机就永远跑不起来）',
    /readWave\(w\.lu, false\)/.test(bb) && /enableExternalBuffer: false/.test(bb)
    && /External buffers are not allowed/.test(bb));
  jian('项7 模型下载记住"上一个能用"的镜像（hf-mirror 挂了不再让 20 个文件各白等一次连接超时）',
    /let xiaZaiJingXiang = 0/.test(bb) && /xiaZaiJingXiang = jx/.test(bb));
}

/* ── 项 2 / 项 8：思考·模型·词元·执行过程 重启不丢 ───────────────────── */
{
  jian('项2/8 旁路元数据落盘文件存在（chat-meta.json，含上限与原子写）',
    /'chat-meta\.json'/.test(main) && /META_XIAO_SHANG = 400/.test(main) && /anQuanYuanZiXieJson\(f/.test(main));
  jian('项2/8 每条会话日志写入时都记富字段（push 之后调 jiLuMeta，不是另开一条写路径）',
    /else chatLogs\.set\(key, \[tiaoMu\]\);[\s\S]{0,200}jiLuMeta\(key, tiaoMu\)/.test(main));
  jian('项2/8 每条回复（含续派轮）独立落账并各自记富字段（不再合并改写上一条）',
    /jiLuMeta\(key, tiaoMu\)/.test(main) && !/jiLuMeta\(key, last\)/.test(main));
  jian('项8 执行过程落盘（fachuXingDong 里 jiLuXingDong，而不是只广播一次）',
    /function fachuXingDong[\s\S]{0,1600}jiLuXingDong\(payload\)/.test(main));
  jian('项2/8 启动顺序对：先读元数据，再重建会话日志，最后合并回填',
    main.indexOf('duChatMeta()') > 0 && main.indexOf('duChatMeta()') < main.indexOf("youJiYiHuiFuHuiHuaRiZhi('boot')")
    && /yingYongMeta\(String\(key\)\)/.test(main));
  jian('项2 重启后「继续/重试」会重现：账本里读中断（lieZhongDuan 被主进程调用）并广播',
    /lieZhongDuan\(\)/.test(eta) && /etaHuo\(\)\.lieZhongDuan\(\)/.test(main) && /laiYuan: 'boot'/.test(main));
  jian('项8 渲染层取得到执行过程（IPC warmy:xingDongLieBiao + preload 暴露）',
    /chuliIpc\('warmy:xingDongLieBiao'/.test(main) && /xingDongLieBiao:/.test(pre));
  jian('项8 富字段回给渲染层（reasoningDuan 在 liaoTianXiaoXiJi 的返回里）',
    /reasoningDuan: Array\.isArray\(\(e as \{ reasoningDuan/.test(main));
  /**
   * 下面这几条都是本轮**真机门禁逼出来的**判据，每一条背后都是一个"看起来修了、其实重启就没了"的坑。
   */
  jian('项2 半成品（思考+中间回复）每 2 秒落盘：渲染层节流送、主进程写、preload 有这条路',
    /function jinXingLuoPan\(/.test(app) && /jinXingLuoPan\(sid,/.test(app)
    && /function jiJinXing\(/.test(main) && /chuliIpc\('warmy:huiFuJinXing'/.test(main) && /huiFuJinXing:/.test(pre));
  jian('项2 半成品的作废由渲染层说了算（正式回复落地才 clear）——主进程不许按角色猜，猜了就必然误杀',
    /clear: true/.test(app) && /p\.clear/.test(main)
    && !/if \(String\(e\.role \|\| ''\) === 'assistant' && h\.jinXing\) delete/.test(main));
  jian('项2 重启后画得出「中断保留」块，并把中断认成这一轮被打断（点亮继续/重试）',
    /zhongDuanBaoZhi/.test(app) && /state\.planInterrupted\.add\(sidBaoZhi\)/.test(app));
  jian('项8 重启后的操作明细灌回行动台账（复用同一条渲染路，不另写一套）',
    /__xingDongJi/.test(app) && /xingDong: Array\.isArray\(m\.xingDong\)/.test(app));
  jian('项8 旁路元数据按"谁身上有我缺的东西"配对，不是只认最近时间戳（真机：合了 3 条补的却是空值）',
    /const xinYao = \(x: ChatMetaXiaoXi\)/.test(main) && /youBenLing/.test(main));
  jian('项8 合并只补"缺的那个字段"，已有值不被空值盖掉；镜像派生排在合并之后',
    /if \(queMoXing\) anyM\.moXing = zhao\.moXing \|\| '';/.test(main)
    && main.indexOf('yingYongMeta(String(key))') < main.indexOf('chatHistories.set(key, quHuiHuaXiaoXiJi(key))'));
  jian('项8 读会话日志时自己补齐一次（不赌开机时序，来了就读）',
    /yingYongMeta\(sessionId\)/.test(main));
  jian('项2 半成品必须能在重启后读回来（duChatMeta 不能把它丢掉）',
    /jinXing: v\.jinXing && typeof v\.jinXing === 'object'/.test(main));
  jian('看图结论由宿主兜底送到回复里（模型整段跳过"图里是什么"时，用户仍能看到视觉模型的原文）',
    main.includes("audit?.log('chat.image-result-surfaced'") && main.includes("tMain('chat.imageResultNote'")
    && /huiHuaKanTuJie\.get\(String\(sessionId \|\| ''\)\)/.test(main));
}

/* ── 项 2b / 项 3：思考与操作交替 + 结尾只出现一次状态 ────────────────── */
{
  jian('项2b 流式思考按"操作发生"切段（增量写入 + 新操作开始时封段）',
    /SI_KAO_DUAN/.test(app) && /siKaoZhuiDuan\(sid, String\(d\.reasoning\)\)/.test(app) && /siKaoFengDuan\(sid\)/.test(app));
  jian('项2b 思考按段带 data-ts 输出，并按中间回复分到不同执行过程段',
    /guoChengLieHtml/.test(app) && /data-ts=/.test(app) && /data-fen=/.test(app) && /guoChengDuan/.test(app));
  // 第 67 轮 项 18：多段由中间回复切分，工具按段归属。
  jian('项2b 没有中间回复时一段；有中间回复时按段分配工具',
    /zhongJianKa/.test(app) && /for \(const e of ev\)/.test(app) && /e\.kind === 'mid'/.test(app) && /fen \+= 1/.test(app));
  jian('项2b 各段 join 起来必须等于整块 reasoning（渲染分段不改口径）',
    /reasoningDuan/.test(du(path.join(SRC, 'context-renderer.ts'))));
  jian('项3 展开区不再重复状态：第 3 行写「结束 · 时间 · 耗时」，且删掉了 more 重复行',
    /tOr\('chat\.xdEnd', '结束'\)/.test(app) && !/xdXianMore/.test(app));
  const que3 = quanBu('chat.actOk', (v) => !!v);
  const que4 = quanBu('chat.xdEnd', (v) => !!v);
  jian('项3 缺的语言键已补齐十国（chat.actOk/actFail/actRunning/xdEnd）',
    que3.length === 0 && que4.length === 0 && quanBu('chat.actFail', (v) => !!v).length === 0 && quanBu('chat.actRunning', (v) => !!v).length === 0,
    'actOk 缺:' + que3 + ' xdEnd 缺:' + que4);
}

/* ── 项 4：印象说明文案 ─────────────────────────────────────────────── */
jian('项4 「印象」说明 = 用户定稿文案（简中逐字，其余语言非空且不残留旧句）',
  packs['zh-CN']['wo.yinXiangHint'] === '这是牛马对你的印象，专属于你们的记忆。'
  && LANG.every((m) => String(packs[m]['wo.yinXiangHint'] || '').length > 8)
  && !/专属于你们共同|共同拥有/.test(packs['zh-CN']['wo.yinXiangHint']));

/* ── 项 1：微信二维码显示 ───────────────────────────────────────────── */
{
  /**
   * 【本轮真机抓出来的第二条根因】上一版把 `qrcode_img_content` 当成"远程图片地址"，
   * 由主进程下载后转成 data URL 塞进 `<img src>`。实测那个地址回的是 **text/html 的确认页**，
   * 于是 `<img>` 收到 `data:text/html;base64,PCFkb2N0eXBl…` ⇒ 画不出任何东西 ⇒ 用户看到的还是空白。
   * 现在的口径：**它是"要编码进二维码的内容"**，二维码由渲染层本地 `qrSvg()` 画；
   * 只有按**字节魔数**确认真是图片时才用 data URL（响应头不算数）。
   */
  jian('项1 二维码改成**本地画**（服务端给的是要编码的文本/地址，不是一张图片）',
    /qrcode_img_content/.test(main) && /tuNeiRong/.test(main) && /shejiao\.qr-not-image/.test(main)
    && /qrSvg\(String\(r\.tuNeiRong\)/.test(app));
  jian('项1 判"是不是图片"按字节魔数，不按响应头（text/html 冒充 img 就是上一版的空白）',
    /function tuPianZiJie\(bu: Buffer\)/.test(main) && /0x89 && bu\[1\] === 0x50/.test(main)
    && !/imgLei = \(String\(t\.headers\.get\('content-type'\)/.test(main));
  jian('项1 CSP 仍然只允许 self/data/blob（没有为了显示二维码而放开远程图）',
    /img-src 'self' data: blob:/.test(html));
  jian('项1 既没图也没内容时如实说（带原因，不假装成功）',
    /shejiao\.qr-img-failed|shejiao\.qr-img-error/.test(main)
    && /cuo: \(img \|\| tuNeiRong\) \? '' : '服务端没给出二维码内容/.test(main));
}

/* ── 项 6：第四列卡片限高 + 滚动（两份 CSS 一起改） ──────────────────── */
{
  const guo = (s) => /#mianBanJiHuaKuai \{ max-height: 460px; \}/.test(s) && /#mianBanShouQuanKuai \{ max-height: 380px; \}/.test(s)
    && /#mianBanJiHuaKuai > #jiHuaLieBiao/.test(s) && /overflow-y: auto/.test(s);
  jian('项6 计划卡/授权卡有限高 + 内部滚动，且 app.css 与 renderer.css 两份都有',
    guo(cssA) && guo(cssR), 'app.css=' + guo(cssA) + ' renderer.css=' + guo(cssR));
}

/* ── 项 9：头像可选 SVG 且正确显示 ──────────────────────────────────── */
jian('项9 选择器 accept 含 svg；SVG 走文本读+自拼 data URL；校验 <svg> 与 512KB 上限',
  /accept="image\/png,image\/jpeg,image\/webp,image\/svg\+xml,\.svg"/.test(html)
  && /shiSvg/.test(app) && /readAsText\(f\)/.test(app) && /data:image\/svg\+xml;charset=utf-8/.test(app)
  && /<svg\[\\s>\]/.test(app) && /512 \* 1024/.test(app));

/* ── 项 10：计划状态真的作用到界面 ─────────────────────────────────── */
{
  jian('项10 行上带 data-st（CSS 的竖条/删除线选择器终于能命中）',
    /class="jiHuaHang2' \+ \(wan \? ' yiWan' : ''\) \+ '" data-st="/.test(app));
  jian('项10 状态样式按真实 DOM 写：已停止/已删除去竖条 + 删除线（两份 CSS 都有）',
    /\.jiHuaHang2\[data-st="blocked"\], \.jiHuaHang2\[data-st="deleted"\] \{ text-decoration: line-through/.test(cssA)
    && /\.jiHuaHang2\[data-st="blocked"\], \.jiHuaHang2\[data-st="deleted"\] \{ text-decoration: line-through/.test(cssR));
  jian('项10 文案是「已停止」（十国都改，前端兜底表也是）',
    LANG.every((m) => String(packs[m]['panel.plan.st.blocked'] || '').length > 1)
    && packs['zh-CN']['panel.plan.st.blocked'] === '已停止' && /blocked: '已停止'/.test(app));
  jian('项10 自然收尾时把没证据的步骤转成已停止（不谎报完成，且只在自然停下时做）',
    /function qiYongShouWeiDuiQi/.test(main) && /qiYongShouWeiDuiQi\(sid\)/.test(main)
    && main.indexOf('qiYongShouWeiDuiQi(sid)') < main.indexOf("return { jiXu: false, liYou: 'done' };", main.indexOf('qiYongShouWeiDuiQi(sid)')));
}

/* ── 计划门禁与预算：真机 840 秒那条红的两个根因 ─────────────────────── */
{
  /**
   * 第 38 轮真机：同一条会话里模型先收了一张截图（占掉 2 次工具调用），等真正那条"六件事"来的时候，
   * 老写法 `yiYongCi === 3` 已经永远不会再成立 ⇒ **计划门禁从来没触发** ⇒
   * 模型不列计划、想到哪做到哪，先写小说写到 10843 字把结果预算花光，剩下四件事没做。
   * 判据按行为写：不许有"一次性等号"，提醒要有再提醒的节奏，话术必须要求"把用户要的都列出来"。
   */
  jian('项10 计划门禁改成"≥3 就提醒、仍没计划每 +6 次再提醒"（不许再用 === 3 这种一辈子只响一次的条件）',
    /if \(yiYongCi >= 3\)/.test(main) && main.includes('const jiHuaTiXingCi = new Map')
    && /yiYongCi - shangCi >= 6/.test(main) && !/if \(yiYongCi === 3\)/.test(main));
  jian('项10 提醒话术要求"把用户这次要的所有东西都列进计划、没列的现在补做"',
    main.includes('把用户这次要的所有东西都列进去') && main.includes('没列出的那几件事，请现在补做'));
  /**
   * 口径已改（第 39 轮额度重做）：不再用"长文还在推进就把结果预算 ×4"这种**预支式**补丁，
   * 改成一条预算账本 + 撞顶时按宿主事实申请续预算。细节由 `verify-round39-budget` 逐条行为验证，
   * 这里只守住两条"回到旧写法就会复发原缺陷"的底线。
   */
  jian('额度不再靠预支式硬编码（×4/×2/+8 都不许回来），改由预算账本统一给',
    !/limits\.totalChars \* 4/.test(main) && !/jiZhun \* 2/.test(main) && /function xinBenLunYuSuan/.test(main));
  jian('判据仍然要"宿主看到的净进展"（停滞/重复≥3 就一点额度都不多给 —— 给推进续命、不给打转续命）',
    /function huizhuYouJinZhan/.test(main) && /changWenTingZhiLe\(s\)/.test(main) && /chongFuZuiDuoCiShu\(s\) >= 3/.test(main));
  /**
   * 第三条同源缺陷：完成核对原来只在"有计划里没做完的步骤 / 缺证据 / 被截断"时才跑。
   * 模型**一条计划都没建**就收工 ⇒ `jiHuaWeiWanCheng` 恒空 ⇒ 核对根本不会跑 ⇒
   * "用户要六件事、它只做了一件"被当成做完。现在补一条保守判据：
   * 没计划 + 这一条消息确实动过 ≥3 次工具 ⇒ 仍核对**一次**（受 `!z.heDui` 限制，不会连环）。
   */
  jian('没建计划却动过手（≥3 次工具）的收场也要走一次完成核对，不许把"没记账"当成"没欠账"',
    main.includes('const wuJiHuaDanDongShou =') && /jiHuaQueZhengJu\(sid\)\.length \|\| wuJiHuaDanDongShou/.test(main));
  jian('核对话术在无计划时明确说"一条计划都没建，先列全再补做"（不许显示"没有未完成的步骤"）',
    main.includes('你**一条计划都没建**') && main.includes('宿主无法核对'));
}

/* ── 项 5：归档用模型 + 纪律优先修改 + 偏好统一进印象 ────────────────── */
{
  jian('项5 归档整理印象走模型：整理模型优先，缺则用这只牛马的对话模型',
    /async function moXingGuiNaYinXiang/.test(main) && /nengLiLianMoXing\('organizer'\)/.test(main)
    && /lian\[0\] \|\| zhaoShiJiMoXing\(sid\)/.test(main));
  jian('项5 提示词带软门禁与既有提取纪律（按门禁归档）',
    /YIN_XIANG_TIQU_MENJIN/.test(main) && /【已有提取纪律/.test(main));
  jian('项5 幻觉硬闸：模型给的行必须能在素材里找到 ≥10 字原话，否则丢掉并记审计',
    /yinxiang\.hallucination-dropped/.test(main) && /suCai\.includes\(zheng\(a\)\)/.test(main));
  jian('项5 模型不可用时如实降级并保留确定性提取（不假装整理过）',
    /yinxiang\.model-degraded/.test(main) && /catch \(e\)[\s\S]{0,400}zhengLiYinXiang\(\{ yuanHua, zanCai, sid \}\)/.test(main));
  jian('项5 硬门禁改为"优先修改现有提取纪律"（改不动才追加）',
    /yinxiang\.discipline-updated/.test(main) && /yinxiang\.discipline-added/.test(main)
    && /const tongLei = bu\.find/.test(main));
  jian('项5 踩也被提取成偏好（旧实现只处理赞）',
    /v\.pingJia === '踩'/.test(app) || /v\.pingJia === '踩'/.test(main));
  jian('项5 user-preferences.json 死路径已删除，偏好统一进印象',
    !/path\.join\(userData, ['"]user-preferences\.json['"]\)/.test(ac) && /function xiePianHaoDaoYinXiang/.test(main)
    && !/heBingYongHuPianHao/.test(main));
  jian('项5 文档里的"落点表"不再把它当现存文件（做了一套、写的是另一套，下一轮就会照旧文档改回去）',
    !/\| `user-preferences\.json` \|/.test(du(path.join(ROOT, 'docs/TECHNICAL.md')))
    && !/userData\/user-preferences\.json/.test(du(path.join(ROOT, 'docs/MEMORY-SYSTEM.md')))
    && !/user-preferences\.json/.test(du(path.join(ROOT, 'docs/REQUIREMENTS.md')))
    && /yinxiang\.md/.test(du(path.join(ROOT, 'docs/TECHNICAL.md'))));
}

/* ── 编译产物同步（改了 .ts 必须 copy-assets / 重新编译） ────────────── */
{
  const js = du(path.join(DIST, 'electron-main.js'));
  const rjs = du(path.join(DIST, 'renderer/app.js'));
  jian('dist 已同步本轮改动（真跑的那份里有新逻辑）',
    /localEnabled/.test(js) && /chat-meta\.json/.test(js) && /qiYongShouWeiDuiQi|jiHuaHang2/.test(js) && /lieZhongDuan/.test(js)
    && /SI_KAO_DUAN/.test(rjs) && /data-st=/.test(rjs));
  jian('dist 语言包已同步（新键在）', /chat\.actOk/.test(du(path.join(DIST, 'i18n', 'zh-CN.json'))));
}

console.log(`==== verify-round38-changes：${ok} ok / ${shi.length} FAIL ====`);
for (const s of shi) console.log('  FAIL ' + s);
process.exit(shi.length ? 1 : 0);
