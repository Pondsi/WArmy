/**
 * verify-r53-tishangxian.mjs（fast 档）—— 第 53 轮项 2「提示词：AI 友好格式 + 每层固定上限 + 超限立刻自愈」。
 *
 * 用户口径拆成可执行的三条：
 *  ① **每层都有固定上限**，超限**不让用户继续输入**（渲染层挡住 + 主进程保存入口拒绝，两处不许只做一个）；
 *  ② **程序自己把某层顶超限 ⇒ 当场修正**：先去空行装饰（零损失），仍超就把**最旧的整条条目搬进知识库**，绝不静默截断；
 *  ③ **要点清晰没有丢失**：判据两条一起过 —— 要点数守恒 + **字级守恒**（留下的 + 搬走的 = 原文，一个字符不多不少），
 *     任一条对不上就整步放弃、只报警；「道」/「产品门禁」在 `BU_KE_YA_SUO` 里 ⇒ 程序一个字都不许动，超限只能报警让人删。
 *
 * 排版：这些文本只给 AI 读 ⇒ 出厂稿正文**零空行、零装饰分隔线**（省下的每个字符都是每轮都发的 token）。
 * 口径唯一：层上限只有 `ti-shi-shang-xian.ts` 一张表，存储闸/注入预算/保存拒绝/渲染层输入框全从它取数
 * （旧代码里 印象 6000/3000、术 8000/4200 两套数字并存在这件事里被清掉）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const U = (p, f) => (p ? pathToFileURL(p).href : pathToFileURL(f).href);
const TX = await import(U(process.env.V53_TX, path.join(ROOT, 'packages/app-shell/dist/ti-shi-shang-xian.js')));
const DAO = await import(U(process.env.V53_DAO, path.join(ROOT, 'packages/app-shell/dist/dao-default.js')));
const SHUM = await import(U(process.env.V53_SHU, path.join(ROOT, 'packages/app-shell/dist/shu-default.js')));
const YJ = await import(U(process.env.V53_YJ, path.join(ROOT, 'packages/app-shell/dist/yuSuan-jiage.js')));
const READD = (e, f) => fs.readFileSync(process.env[e] || path.join(ROOT, f), 'utf8');
const MAIN = READD('V53_MAIN', 'packages/app-shell/src/electron-main.ts');
const APP = READD('V53_APP', 'packages/app-shell/src/renderer/app.js');
const PRE = READD('V53_PRE', 'packages/app-shell/src/preload.cjs');

let okN = 0, failN = 0;
const jian = (l, p, d) => { if (p) { okN++; console.log('  ok  ' + l); } else { failN++; console.log('  FAIL ' + l + (d ? ' ← ' + String(d).slice(0, 160) : '')); } };

// ── 1. 上限表：一层一个数字，且真的会咬人 ──────────────────────────
const CENG = ['道', '术', '规范', '印象', '教条', '束缚', '认知'];
jian('七层提示词都登记了固定上限（不是"没写就是无限"）',
  CENG.every((c) => Number(TX.TI_SHI_SHANG_XIAN[c]) > 0), CENG.filter((c) => !(Number(TX.TI_SHI_SHANG_XIAN[c]) > 0)).join(','));
jian('上限本身也有上界（每层 ≤ 8000 字：写"上限 8 万"等于没有上限）',
  CENG.every((c) => TX.TI_SHI_SHANG_XIAN[c] <= 8000));
jian('每层上限都小于总合闸 ⇒ 单层合规仍可能被总量报警拦下（防止"每层都塞满"）',
  TX.TI_SHI_ZONG_HE < CENG.reduce((n, c) => n + TX.TI_SHI_SHANG_XIAN[c], 0) && TX.TI_SHI_ZONG_HE > TX.TI_SHI_SHANG_XIAN['道']);
jian('没登记的层 ⇒ shangXianOf 给 0（绝不给一个默认上限让人以为受限了）', TX.shangXianOf('没有这一层') === 0);
jian('取数只有一个入口：chaoShangXian 与 shangXianOf 对同一层给出同一个数字',
  CENG.every((c) => TX.chaoShangXian(c, '字'.repeat(TX.shangXianOf(c))).shangXian === TX.shangXianOf(c)));

// ── 2. AI 友好格式：出厂稿本身就紧凑，且压缩不可能吃字 ──────────────
{
  const zhuangShi = (w) => /^\s*[-*_]{3,}\s*$/m.test(String(w || ''));
  for (const [c, txt] of [['道', DAO.DAO_MOREN], ['术', SHUM.SHU_MOREN]]) {
    jian(`「${c}」出厂稿在上限内（现在 ${String(txt || '').length} / 上限 ${TX.shangXianOf(c)}）`,
      String(txt || '').length <= TX.shangXianOf(c), String(txt || '').length);
    jian(`「${c}」出厂稿正文零空行（每轮都发的 token，不留给人看的排版）`, !/\n\n/.test(txt));
    jian(`「${c}」出厂稿没有装饰性分隔线`, !zhuangShi(txt));
    jian(`「${c}」出厂稿已经是 jinCouHua 的不动点（再压一次一字不变）`, TX.jinCouHua(txt) === txt);
    jian(`「${c}」出厂稿仍带条目（没被格式化成一整段）`, TX.yaoDianJiShu(txt) > 10, TX.yaoDianJiShu(txt));
  }
  const yuan = '# 标题\n\n正文一  \n\n---\n\n1. 第一条\n   续行\n\n## 二、小节\n\n- 甲\n***\n';
  const ya = TX.jinCouHua(yuan);
  jian('jinCouHua 删空行、行尾空白、装饰线（--- / ***）', !/\n\n/.test(ya) && !/^---$/m.test(ya) && !/^\*\*\*$/.test(ya), JSON.stringify(ya));
  jian('jinCouHua 不动正文字符：只去空白时指纹完全相同（省 token 不可能吃掉要点）',
    TX.wuKongBaiZhiWen(ya) === TX.wuKongBaiZhiWen(yuan.replace(/^\s*[-*_]{3,}\s*$/gm, '')));
  jian('jinCouHua 删掉的只有空白与装饰线本身（按这个定义逐行对照，多删一个字就红）',
    TX.wuKongBaiZhiWen(ya) === TX.wuKongBaiZhiWen(yuan.split('\n').filter((l) => !/^\s*[-*_]{3,}\s*$/.test(l)).join('\n')));
  jian('jinCouHua 不误删列表项（"- 甲" / "1. 第一条" / 缩进续行都留下）',
    /^- 甲$/m.test(ya) && /^1\. 第一条$/m.test(ya) && /^ {3}续行$/m.test(ya), JSON.stringify(ya));
  jian('jinCouHua 不动小节标题（## 仍是 ##）', /^## 二、小节$/m.test(ya));
  jian('jinCouHua 幂等（跑第二遍不变 ⇒ 不会每次启动都重写文件）', TX.jinCouHua(ya) === ya);
  jian('要点计数把"编号条目 + 列表项 + 小节标题"都算进去（防止删掉整节标题还自称没丢）',
    TX.yaoDianJiShu('## 甲\n1. 一\n- 二\n普通句子') === 3, TX.yaoDianJiShu('## 甲\n1. 一\n- 二\n普通句子'));
}

// ── 3. 超限判据（保存入口与自检共用）───────────────────────────────
{
  const s = TX.shangXianOf('规范');
  jian('恰好写到上限 ⇒ 允许保存（上限是"最多这么多"，不是"少一个"）', TX.chaoShangXian('规范', '字'.repeat(s)).chao === false);
  jian('多一个字就拒（1 字之差也要挡，否则上限形同虚设）', TX.chaoShangXian('规范', '字'.repeat(s + 1)).chao === true);
  jian('拒绝时把当前字数与上限一起报出去（用户要知道删多少）',
    TX.chaoShangXian('规范', '字'.repeat(s + 7)).ziShu === s + 7 && TX.chaoShangXian('规范', '字'.repeat(s + 7)).shangXian === s);
  jian('未登记的层不假装拦得住（chao=false，由接线断言保证六入口都用真层名）', TX.chaoShangXian('打错的层', 'x'.repeat(9999)).chao === false);
  jian('空文本不算超限（清空某层是正当动作，不是错误）', TX.chaoShangXian('道', '').chao === false);
}

// ── 4. 超限自愈：只去空行 → 搬最旧条目 → 压不动就报警 ───────────────
{
  const s = TX.shangXianOf('规范');
  const weiChao = '# 甲\n\n- 一\n\n## 乙\n\n- 二\n';
  const a = TX.guiHuaYaSuo('规范', weiChao);
  jian('未超限 ⇒ 只做零损失去空行，一条都不搬', a.yiChu.length === 0 && a.gaoDing === true && a.xinWen === TX.jinCouHua(weiChao), JSON.stringify(a.liYou));
  jian('未超限时理由写成"只去空行与装饰"或"未超限"（审计里看得懂动没动内容）',
    /只去空行|未超限/.test(a.liYou), a.liYou);

  const tiao = (n) => Array.from({ length: n }, (_, i) => `- 第${i + 1}条：` + '要'.repeat(40)).join('\n');
  const chao = '# 术（做事的章法）\n## 一、节制\n' + tiao(30) + '\n## 二、把事做成\n' + tiao(20) + '\n- 最后一条：收尾要给三样东西\n';
  jian('测试稿确实超限（判据要跑在真会超限的输入上）', chao.length > s, chao.length + ' vs ' + s);
  const b = TX.guiHuaYaSuo('规范', chao);
  jian('超限 ⇒ 压到上限内（gaoDing）', b.gaoDing === true && b.xinWen.length <= s, b.xinWen.length + ' / ' + s + ' / ' + b.liYou);
  jian('压的方式是搬走整条条目，不是把某条砍一半', b.yiChu.length > 0 && b.yiChu.every((t) => /第\d+条：/.test(t)), b.yiChu.length);
  jian('搬走的是**最旧**的条目（第一条被搬走，最后一条留在原位）',
    /第1条/.test(b.yiChu.join('\n')) && /最后一条/.test(b.xinWen) && !/最后一条/.test(b.yiChu.join('\n')));
  jian('小节标题不塌（结构还在，只是条目少了）', /^# 术（做事的章法）$/m.test(b.xinWen) && /## 二、把事做成/.test(b.xinWen));
  jian('要点数守恒：留下的 + 搬走的 = 原来那么多',
    b.yaoDianHou + b.yiChu.reduce((n, t) => n + TX.yaoDianJiShu(t), 0) === b.yaoDianQian,
    b.yaoDianHou + ' + ? = ' + b.yaoDianQian);
  jian('字级守恒：搬走的 + 留下的 = 原文（一个字符不多不少）', TX.ziShuShouHeng(TX.jinCouHua(chao), b.xinWen, b.yiChu));
  jian('搬走的原文交出去（调用方写进知识库），一个字不丢', b.yiChu.every((t) => chao.includes(t.split('\n')[0])));

  const sanWen = '开'.repeat(s + 500);
  const c = TX.guiHuaYaSuo('规范', sanWen);
  jian('纯散文超限（没有条目可搬）⇒ 不硬压：gaoDing=false，正文一字不动',
    c.gaoDing === false && c.xinWen === sanWen && c.yiChu.length === 0, JSON.stringify(c.liYou));
  jian('压不动时理由把原因说清（"仍超限：没有可搬的条目"）', /仍超限/.test(c.liYou), c.liYou);

  jian('字级判据能真失败：丢字要报不守恒', TX.ziShuShouHeng('aaabbb', 'aaa', []) === false);
  jian('字级判据能真失败：重复搬（多出来的字）也要报不守恒', TX.ziShuShouHeng('aaabbb', 'aaabbb', ['bbb']) === false);
  jian('字级判据对空白不敏感（换行被 jinCouHua 删掉不算丢内容）', TX.ziShuShouHeng('a b\nc', 'ab\nc', []) === true);
  jian('未超限层的规划结果本身也过字级守恒（零损失不是只写在注释里）',
    TX.ziShuShouHeng(TX.jinCouHua(weiChao), a.xinWen, a.yiChu));
}

// ── 5. 溢出条目进哪一层的知识库 ────────────────────────────────────
jian('印象的溢出条目进会话库（它本来就是去过隐私的形象概要）', TX.yiChuGuiXiang('印象') === 'session');
jian('术/规范/教条/束缚/认知/道的溢出条目进内部库（业务与做法不是公开内容）',
  ['术', '规范', '教条', '束缚', '认知', '道'].every((c) => TX.yiChuGuiXiang(c) === 'internal'));

// ── 6. 主进程接线：六个保存入口 + 启动自检 + 报警 ──────────────────
{
  const Liu = [['warmy:daoShe', '道'], ['warmy:shuShe', '术'], ['warmy:guiFanShe', '规范'],
    ['warmy:yinXiangShe', '印象'], ['warmy:zuiGaoXinNianShe', '教条'], ['warmy:shuFuShe', '束缚']];
  for (const [ip, ceng] of Liu) {
    const at = MAIN.indexOf(`chuliIpc('${ip}'`);
    const duan = at < 0 ? '' : MAIN.slice(at, at + 700);
    jian(`${ip}：保存前先查「${ceng}」的硬上限（超限直接拒，不是存进去再说）`,
      at >= 0 && new RegExp(`chaoShangXianRi\\('${ceng}'`).test(duan), at < 0 ? '找不到这个 IPC' : duan.slice(0, 90));
  }
  jian('拒绝时落审计 prompt.over-cap-rejected（超限要能在日志里查到，不是只弹一句）',
    /prompt\.over-cap-rejected/.test(MAIN) && /audit\?\.log\('prompt\.over-cap-rejected', \{ ceng, ziShu: j\.ziShu, shangXian: j\.shangXian \}/.test(MAIN));
  jian('拒绝文案如实给出"现在多少字 / 上限多少字"并指路知识库',
    /现在\s*'\s*\+\s*j\.ziShu\s*\+\s*'\s*字，上限\s*'\s*\+\s*j\.shangXian/.test(MAIN) && /搬进知识库/.test(MAIN) && /knowledge_add/.test(MAIN));
  jian('启动时跑超限自检（在播种之后：先把出厂稿落盘，再检查所有层）',
    /boZhongShuMoRen\(\);\s*\n\s*\/\*\*[^]*?\*\/\s*\n\s*ziJianTiShangXian\(\);/.test(MAIN)
    || /boZhongDaoMoRen\(\);\n\s*boZhongShuMoRen\(\);\n[^\n]*\n\s*ziJianTiShangXian\(\);/.test(MAIN));
  jian('自检覆盖程序会自己改的层（术/教条/束缚/印象 + 规范在读时自愈）——印象是归档每轮都改的层，最容易悄悄超限',
    /const CENG_ZI_JIAN/.test(MAIN) && ['术', '教条', '束缚', '印象'].every((c) => new RegExp(`ceng: '${c}'`).test(MAIN))
    && /yaSuoYiCeng\(\{ ceng: '规范'/.test(MAIN));
  jian('「道」只在**只报警名单**里，连写文件的闭包都不给（不留"永远不会执行的写路径"这种口子）',
    /const CENG_ZHI_BAO_JING/.test(MAIN) && /ceng: '道', du: duDao \}/.test(MAIN)
    && !/ceng: '道',[^\n]*xie:/.test(MAIN));
  jian('程序压缩前留一份可回退的备份（改的是用户拥有的文件）',
    /copyFileSync\(x\.lu\(\), x\.lu\(\) \+ '\.bak-compress-/.test(MAIN));
  jian('搬出去的条目真的写进知识库（allow(层).addEvent），并带上来源标记 prompt:overflow',
    /knowledge\.allow\(guiCeng\)\.addEvent\(/.test(MAIN) && /laiYuan: 'prompt:overflow'/.test(MAIN));
  jian('压成功落审计 prompt.compressed，含压缩前后字数与要点数（要点没丢要能被核对）',
    /prompt\.compressed/.test(MAIN) && /yaoDianQian: ji\.yaoDianQian, yaoDianHou: ji\.yaoDianHou/.test(MAIN));
  jian('压不动落审计 prompt.still-over-cap（不许"看起来处理过了"）', /prompt\.still-over-cap/.test(MAIN));
  jian('「道」/「产品门禁」一个字都不许程序动：判据复用 BU_KE_YA_SUO，不留第二套名单',
    /BU_KE_YA_SUO\.some\(\(b\) => String\(ceng \|\| ''\)\.startsWith\(b\)\)/.test(MAIN)
    && (YJ.BU_KE_YA_SUO || []).includes('道') && (YJ.BU_KE_YA_SUO || []).includes('产品门禁'));
  jian('永不可压的层超限 ⇒ 只报 prompt.over-cap-immovable，不动文件、不搬条目（**两道都设**：名单里没有它 + 进函数再判一次）',
    /prompt\.over-cap-immovable/.test(MAIN) && !/writeFileSync\(daoLu\(\), duDao/.test(MAIN)
    && /if \(!chengXuKeYiDong\(x\.ceng\)\) \{\s*\n\s*audit\?\.log\('prompt\.over-cap-immovable'/.test(MAIN));
  jian('单层都合规但总量超 ⇒ 报 prompt.over-total（每轮发的是它们的和）',
    /if \(zong > TI_SHI_ZONG_HE\) \{\s*\n\s*audit\?\.log\('prompt\.over-total'/.test(MAIN) && /zong > TI_SHI_ZONG_HE/.test(MAIN));
  jian('总量报警把最大的几层点名（只说"超了"等于没告诉用户该删哪儿）',
    /ming\.sort\(\(a, b\) => b\.ziShu - a\.ziShu\)\.slice\(0, 3\)/.test(MAIN));
  jian('规范不再"读到超限就悄悄截断"：改成读时自愈（发出去的和文件里的是同一份）',
    !/readFileSync\(p, 'utf8'\)\.slice\(0, GUI_FAN_MAX_CHARS\)/.test(MAIN)
    && /yaSuoYiCeng\(\{ ceng: '规范'/.test(MAIN));
  jian('上限只有一个来源：旧的每层两个字面量已经从主进程里清掉',
    !/YIN_XIANG_MAX_CHARS = \d/.test(MAIN) && !/GUI_FAN_MAX_CHARS = \d/.test(MAIN)
    && !/REN_ZHI_INJECT_CHARS = \d/.test(MAIN) && !/SHU_ZONG_LIANG_MAX = \d/.test(MAIN));
  jian('存储闸与注入预算都从上限表取数（印象 6000/3000 两套数字那种缺陷不再出现；第 54 轮起按语言折算）',
    /function yinXiangMaxChars\(\): number \{ return shangXianOf\('印象', dangQianYuYan\(\)\); \}/.test(MAIN)
    && /function yinXiangInjectChars\(\): number \{ return shangXianOf\('印象', dangQianYuYan\(\)\); \}/.test(MAIN)
    && /function guiFanMaxChars\(\): number \{ return shangXianOf\('规范', dangQianYuYan\(\)\); \}/.test(MAIN)
    && /function renZhiInjectChars\(\): number \{ return shangXianOf\('认知', dangQianYuYan\(\)\); \}/.test(MAIN)
    && /function shuZongLiangMax\(\): number \{ return shangXianOf\('术', dangQianYuYan\(\)\); \}/.test(MAIN));
  jian('上限表通过 IPC 发给渲染层（渲染层不抄一份数字；发的是**按当前语言折算**后的表）',
    /chuliIpc\('warmy:tiShiShangXian'/.test(MAIN) && /biao\[c\] = shangXianOf\(c, lang\)/.test(MAIN)
    && /tiShiShangXian: \(\) => ipcRenderer\.invoke\('warmy:tiShiShangXian'\)/.test(PRE));
}

// ── 7. 渲染层：超限不让继续输入 ────────────────────────────────────
{
  jian('渲染层向上限表取数（不硬编码每层字数）', /huoQuTiShiShangXian/.test(APP) && /window\.warmy\.tiShiShangXian/.test(APP));
  jian('输入框设 maxlength：打字打不过上限（"超出上限时不让用户继续输入"）',
    /setAttribute\('maxlength', String\(shangXian\)\)/.test(APP));
  jian('粘贴/程序赋值也挡得住：超出部分当场截掉', /ta\.value = String\(ta\.value\)\.slice\(0, shangXian\)/.test(APP));
  jian('截掉时如实说"多出的内容没有写入"并给出路（合并同类项 / 搬进知识库）',
    /多出的内容没有写入/.test(APP) && /搬进知识库/.test(APP));
  jian('实时显示"本层 已用/上限"，到九成先提醒、到上限标红',
    /\.textContent = ceng \+ ' ' \+ n \+ '\/' \+ shangXian/.test(APP) && /shangXian \* 0\.9/.test(APP) && /#d33/.test(APP));
  jian('六张卡片都绑了层名，且层名对得上各自的文件（道→dao.md、印象→yinxiang.md、教条→agents.md、术→shu.md、束缚→Memory.md）',
    /'dao\.md',\s*'道'\)/.test(APP) && /'yinxiang\.md',\s*'印象'\)/.test(APP)
    && /'agents\.md',\s*'教条'\)/.test(APP) && /'shu\.md',\s*'术'\)/.test(APP)
    && /'Memory\.md',\s*'束缚'\)/.test(APP) && /zhuangShangXianKongZhi\(kuang, '规范'\)/.test(APP));
  jian('载入既有文件时只刷新计数、**不当场截断**（已落盘的内容要靠程序压缩搬进知识库，不是界面里悄悄切掉）',
    /ta\._shuaXinXian = hua/.test(APP) && !/kuang\.value = wen\.slice/.test(APP));
  jian('保存失败时把主进程的超限理由原样显示（不再套一层"保存失败："吞掉原因）',
    /String\(\(r && r\.error\) \|\| tOr\('panel\.guifan\.baoCunShiBai'/.test(APP));
}

// ── 8. 认知与会话级印象：第 53 轮补的两个洞 ─────────────────────────
{
  jian('认知层在保存时就压到上限（注入侧不再"悄悄截断 1600"）',
    /if \(qie\) \{ try \{ audit\?\.log\('prompt\.persona-over-cap'/.test(MAIN) && /const xian = shangXianOf\('认知'(?:,\s*dangQianYuYan\(\))?\)/.test(MAIN)
    && /persona: o\.persona\.slice\(0, xian\)/.test(MAIN));
  jian('认知输入框也绑了上限（用户打不过去，不是存进去再截）',
    /zhuangShangXianKongZhi\(ta, '认知'\)/.test(APP));
  jian('会话级印象草稿走同一个上限判据（旧做法 slice(上限×2) 已经删掉）',
    /chaoShangXianRi\('印象', String\(p0\?\.text \?\? ''\)\)/.test(MAIN) && !/slice\(0, YIN_XIANG_MAX_CHARS \* 2\)/.test(MAIN));
  jian('会话级印象输入框也绑了上限（它是提示词层：注入时优先于全局印象）',
    /zhuangShangXianKongZhi\(wen, '印象'\)/.test(APP));
  jian('删掉指向不存在入口的死调用（instancesSave 在 preload 里从来没有过，?.() 把错误吃了）',
    !/window\.warmy\.instancesSave/.test(APP) && !/instancesSave:/.test(PRE));
}

console.log(`==== verify-r53-tishangxian: ${okN} ok / ${failN} FAIL ====`);
process.exit(failN ? 1 : 0);
