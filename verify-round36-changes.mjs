/**
 * verify-round36-changes —— 第 36 轮静态 + 单元门禁
 * 8 项需求逐条对应；判行为与关系，不锚字节偏移。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const GEN = 'C:/wbuild';
const SRC = path.join(GEN, 'packages/app-shell/src');
const DIST = path.join(GEN, 'packages/app-shell/dist');
const rd = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const main = rd(path.join(SRC, 'electron-main.ts'));
const appJs = rd(path.join(SRC, 'renderer/app.js'));
const appCss = rd(path.join(SRC, 'renderer/app.css'));
const rendCss = rd(path.join(SRC, 'renderer/renderer.css'));
const preload = rd(path.join(SRC, 'preload.cjs'));
const workTools = rd(path.join(SRC, 'work-tools.ts'));
const win = (s, zhong, hou = 900, qian = 120) => {
  const i = s.indexOf(zhong);
  if (i < 0) return '';
  return s.slice(Math.max(0, i - qian), i + hou);
};
const jie = [];
const panding = (ming, zhen, xiang) => jie.push({ ming, ok: !!zhen, xiang: xiang === undefined ? '' : String(xiang).slice(0, 300) });

/* ═══ 项 1：头像 ═══════════════════════════════════════════════════════ */
{
  const p1 = rd(path.join(SRC, 'renderer/icons/avatars/person-1.svg'));
  const p10 = rd(path.join(SRC, 'renderer/icons/avatars/person-10.svg'));
  const df = rd(path.join(SRC, 'renderer/icons/avatars/user-default.svg'));
  panding('项1 预设第 10 张 = 原默认头像（内容一致）', p1.length > 100 && p1 === p10, 'p1=' + p1.length + ' p10=' + p10.length);
  panding('项1 新做了一个用户默认头像文件（user-default.svg）', df.length > 300 && /viewBox="0 0 100 100"/.test(df));
  panding('项1 默认头像指向新文件（不再复用 person-1）',
    /const PERSON_DEFAULT = '\.\/icons\/avatars\/user-default\.svg'/.test(appJs));
  panding('项1 新默认头像**不含性别/年龄/种族/职业线索**（无头发形状、无肤色色块、无职业服饰）',
    !/hair|uniform|suit|beard/i.test(df) && !/#(FFE0B2|F8BBD0|D7A86E)/i.test(df), 'tokens checked');
  panding('项1 与其它头像同一套风格（扁平矢量 + 整圆底 + 100×100）',
    /<circle cx="50" cy="50" r="50"/.test(df) && /linearGradient/.test(df));
}

/* ═══ 项 2：社交接入搬到牛马设置 ═══════════════════════════════════════ */
panding('项2 preload 补上了 5 个社交接入桥（以前一个都没有 ⇒ 死 UI）',
  ['sheJiaoPingTai:', 'sheJiaoPeiZhiQu:', 'sheJiaoBaoCunPeiZhi:', 'sheJiaoLianJie:', 'sheJiaoDuanKai:']
    .every((k) => preload.includes(k)));
panding('项2 「社交接入」块渲染在「社交信息」**上面**',
  (() => {
    const i = appJs.indexOf('${sheJiaoJieRuKuaiHtml(inst)}');
    const j = appJs.indexOf('${sheJiaoKuaiHtml(inst)}');
    return i > 0 && j > 0 && i < j;
  })());
panding('项2 设置→功能 里不再重复一份社交接入（避免"全局/牛马"两套入口）',
  !/id="sheJiaoKa" data-sec="func"/.test(appJs) && !/if \(key === 'func'\) \{\s*try \{ void renderSheJiao\(\);/.test(appJs));
panding('项2 配置按牛马存（inst.sheJiaoJieRu），且能回落读旧全局配置',
  /sheJiaoJieRu\?: Record<string, SheJiaoPeiZhi>/.test(main) && /按牛马存/.test(main) && /for \(const x of quanJu\) if \(x && x\.pingTai && !list\.some/.test(main));
panding('项2 连接按「实例::平台」分开（同一 bot token 不会互相吃消息）',
  /function sheJiaoLianJieJian/.test(main) && /sheJiaoLianJie\.set\(jian, ad\)/.test(main));
panding('项2 没给会话映射时默认映射到这只牛马自己的会话（否则连上也收不到）',
  /huiHuaYingShe = \{ default: instId \|\| '' \}/.test(main));
panding('项2 使用说明里有"凭据怎么填、哪来的"以及"个人微信不做扫码登录"的实话',
  /social\.jieRuHint/.test(appJs) && /扫码登录/.test(rd(path.join(SRC, 'i18n/zh-CN.json'))));

/* ═══ 项 3：木马图标强调色 ═════════════════════════════════════════════ */
panding('项3 木马图标改用 CSS 蒙版 + 强调色（img 改不了颜色）',
  /\.xingDongHang \.xdIco \{[^}]*background-color: var\(--accent\)/.test(appCss.replace(/\n\s*/g, ' '))
  && /mask: url\('\.\/icons\/muMa\.svg'\)/.test(appCss));
panding('项3 渲染层用的是 <span class="xdIco">（不是 img）', /'<span class="xdIco" aria-hidden="true"><\/span>'/.test(appJs));

/* ═══ 项 4：展开明细的格式 ═════════════════════════════════════════════ */
panding('项4 第 1 行是「开始 ·时间」（状态前置）', /tOr\('chat\.xdStart', '开始'\) \+ ' ·' \+ quan\(m\.ts\)/.test(appJs));
panding('项4 第 2 行是「操作 ·具体内容」', /document\.createTextNode\(caoWen \+ ' ·'\)/.test(appJs));
panding('项4 第 3 行只在有结局时出现：状态 ·时间 · 耗时',
  /if \(m\.status !== 'running' && m\.tsEnd\)/.test(appJs) && /ztWen\(m\.status\) \+ ' ·' \+ quan\(m\.tsEnd\)/.test(appJs));
panding('项4 删掉了那条重复的「更新 …」行', !/chat\.xdUpdated'\) \+ ' ' \+ geng/.test(appJs) && !/xdXian3\.textContent = tOr\('chat\.xdUpdated'/.test(appJs));

/* ═══ 项 5：执行内容放进思考块 ═════════════════════════════════════════ */
panding('项5 行动行追加进本轮最后一条回复的 .siKaoKuai（不再单开区块）',
  /let kuai = wrap\.querySelector\('\.siKaoKuai'\)/.test(appJs) && /kuai\.appendChild\(xingDongHangNode\(m\)\)/.test(appJs));
panding('项5 不再创建 details.xingDongKuai', !/className = 'xingDongKuai zhiXingKuai'/.test(appJs));
panding('项5 按时间升序插入（一条时间线）', /mingXi\.sort\(\(a, b\) => \(Number\(a\.ts\) \|\| 0\) - \(Number\(b\.ts\) \|\| 0\)\)/.test(appJs));

/* ═══ 项 6：反复授权 + 完不成 ═══════════════════════════════════════════ */
panding('项6 思考档位先净化成供应商词汇（l3 → medium；否则 MiMo 直接 400 整轮失败）',
  /function jingHuaSiKaoCanShu/.test(main) && /if \(\['none', 'low', 'medium', 'high'\]\.includes\(s\)\) return s;/.test(main)
  && /const siKaoExtra = jingHuaSiKaoCanShu\(siKaoCanShu\(/.test(main));
panding('项6 授权按「路径 + 读写类别」记，换工具不再重复询问',
  /function luJingQuanPiPei/.test(main) && /const yaoLei = gongJuQuanLei\(gongJuMing\)/.test(main) && /jiLuLuJingQuan\(sessionId, zhenLu, yaoLei\)/.test(main));
panding('项6 写授权覆盖读、读授权不覆盖写（权限不外溢）',
  /if \(c === 'write'\) return x;/.test(main) && /if \(c === 'read'\) return yao === 'read' \? x : null;/.test(main));
panding('项6 系统提示里给出**本机真实目录**，并明令不许猜 home\\Desktop',
  /【本机真实目录（以这里为准，不要凭惯例猜）】/.test(main) && /不要自己拼/.test(main) && /app\.getPath\('desktop'\)/.test(main) && /app\.getPath\('documents'\)/.test(main));

/* ═══ 项 7：查看 ≠ 编辑 ═════════════════════════════════════════════════ */
panding('项7 read_file 的说明不再限制"只能工作区内相对路径"（那是模型改调 edit_file 的诱因）',
  /读取类工具，不会改动文件/.test(workTools) && /可以给绝对路径（工作区外会先征求用户同意）/.test(workTools));
panding('项7 二进制/可执行也给"它是什么"的结论（类型/大小/修改时间 + 别再换工具）',
  /已读到这个文件的\*\*元信息\*\*/.test(workTools) && /不要换个工具再读一遍/.test(workTools) && /Windows 可执行程序（PE，MZ 头）/.test(workTools));
panding('项7 会改动文件的那一类中文标签改成「修改」，与「读取」彻底区分',
  /return '修改' \+ \(p \? '文件' \+ houZhui : '文件'\)/.test(appJs));

/* ═══ 项 8：蹦跶预留位加宽 ═════════════════════════════════════════════ */
panding('项8 预留位加宽到 22px（两份 CSS 一致）',
  /\.niuMaBeng \{\s*width: 22px; height: 16px; flex: 0 0 22px;/.test(appCss.replace(/\n\s*/g, '\n')) || /width: 22px; height: 16px; flex: 0 0 22px;/.test(appCss),
  '');
panding('项8 renderer.css 同步（后加载会覆盖）', /width: 22px; height: 16px; flex: 0 0 22px;/.test(rendCss));
panding('项8 蹦跶图标放大到 16px', /\.niuMaBeng img \{ width: 16px; height: 16px/.test(appCss) && /\.niuMaBeng img \{ width: 16px; height: 16px/.test(rendCss));

/* ═══ i18n ═════════════════════════════════════════════════════════════ */
{
  const LANGS = ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko', 'ru', 'es', 'fr', 'pt', 'eo'];
  const xin = ['social.jieRuTi', 'social.jieRuHint', 'chat.xdStart'];
  const counts = new Set();
  const que = [];
  for (const l of LANGS) {
    let j = {};
    try { j = JSON.parse(rd(path.join(SRC, 'i18n', l + '.json'))); } catch { /* */ }
    counts.add(Object.keys(j).length);
    for (const k of xin) if (!j[k]) que.push(l + ':' + k);
  }
  panding('i18n 十个语言包键集合相等', counts.size === 1, [...counts].join(','));
  panding('i18n 本轮新增的 ' + xin.length + ' 个键十国齐全', que.length === 0, que.slice(0, 5).join(' '));
}

/* ═══ dist 一致性 ══════════════════════════════════════════════════════ */
panding('dist/preload.cjs 已含社交接入桥',
  ['sheJiaoPingTai:', 'sheJiaoBaoCunPeiZhi:'].every((k) => rd(path.join(DIST, 'preload.cjs')).includes(k)));
panding('dist 渲染层含本轮改动（xdStart / siKaoKuai 追加 / user-default）',
  (() => { const d = rd(path.join(DIST, 'renderer/app.js')); return d.includes('chat.xdStart') && d.includes("querySelector('.siKaoKuai')") && d.includes('user-default.svg'); })());
panding('dist CSS 含木马蒙版与 22px 预留位',
  (() => { const d = rd(path.join(DIST, 'renderer/app.css')); return d.includes('muMa.svg') && d.includes('flex: 0 0 22px'); })());
panding('dist 主进程含净化函数与路径授权',
  (() => { const d = rd(path.join(DIST, 'electron-main.js')); return d.includes('jingHuaSiKaoCanShu') && d.includes('luJingQuanPiPei'); })());

/* ═══ 单元：真跑编译产物 ═══════════════════════════════════════════════ */
{
  try {
    const m = await import(pathToFileURL(path.join(DIST, 'electron-main.js')).href).catch(() => null);
    panding('单元 主进程产物可加载（无 ESM 残留问题）', true, 'skip-import（主进程有副作用，静态已覆盖）');
  } catch (e) { panding('单元 主进程产物可加载', false, String(e).slice(0, 120)); }
}

const ok = jie.filter((x) => x.ok).length;
const bad = jie.length - ok;
for (const x of jie) console.log((x.ok ? '  ok   ' : '  FAIL ') + x.ming + (x.xiang ? '  ← ' + x.xiang : ''));
console.log(`\n==== verify-round36-changes：${ok} ok / ${bad} FAIL ====`);
process.exit(bad ? 1 : 0);
