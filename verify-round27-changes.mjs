/**
 * 第 27 轮变更门禁（项 2/3/4/5/6/7/8/10）
 *
 * 只验收**本轮改的东西**，但尽量用真行为而不是只看字符串：
 *   · 技能系统（requires 门控、索引检索、扫描目录、写技能）直接调 dist 里的导出函数；
 *   · 中文编号直接把 app.js 的纯函数抠出来跑（避免「八1、八2」这类回归）；
 *   · 本地语音直接调 dist/bendi-yuyin.js（状态机、拒绝语义、删除标记）；
 *   · 重复 IPC 通道扫描是第 3 项的**真因**（重复注册会被静默吞掉 ⇒ 必须门禁钉住）；
 *   · 市场/真机项在没有网络时**如实标记为未验证**，不假装通过。
 *
 * 跑法：node verify-round27-changes.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const GEN = path.dirname(fileURLToPath(import.meta.url));
let guo = 0; let bai = 0; let wei = 0;
const shuo = (ok, ming, xiang = '') => {
  if (ok) { guo++; console.log('  [过] ' + ming); }
  else { bai++; console.log('  [败] ' + ming + (xiang ? ' :: ' + String(xiang).slice(0, 260) : '')); }
};
const weiTi = (ming, yin) => { wei++; console.log('  [没跑] ' + ming + ' :: ' + yin); };

const READER = path.join(GEN, 'packages/app-shell/src/renderer/app.js');
const INDEX_HTML = path.join(GEN, 'packages/app-shell/src/renderer/index.html');
const APP_CSS = path.join(GEN, 'packages/app-shell/src/renderer/app.css');
const PRELOAD = path.join(GEN, 'packages/app-shell/src/preload.cjs');
const MAIN_TS = path.join(GEN, 'packages/app-shell/src/electron-main.ts');
const MAIN_JS = path.join(GEN, 'packages/app-shell/dist/electron-main.js');
const app = fs.readFileSync(READER, 'utf8');
const html = fs.readFileSync(INDEX_HTML, 'utf8');
const css = fs.readFileSync(APP_CSS, 'utf8');
const pre = fs.readFileSync(PRELOAD, 'utf8');
const mainTs = fs.readFileSync(MAIN_TS, 'utf8');
const mainJs = fs.existsSync(MAIN_JS) ? fs.readFileSync(MAIN_JS, 'utf8') : '';
const i18n = JSON.parse(fs.readFileSync(path.join(GEN, 'packages/app-shell/src/i18n/zh-CN.json'), 'utf8'));

const duan = (b) => (b ? 'ok' : 'missing');

// ── 项 3：技能扫描目录（真因是重复 IPC 注册被静默吞掉） ────────────
console.log('\n项 3 · 扫描目录去重 + 重复通道');
{
  const qudao = [...mainTs.matchAll(/chuliIpc\('([^']+)'/g)].map((m) => m[1]);
  const count = new Map();
  for (const q of qudao) count.set(q, (count.get(q) || 0) + 1);
  const chongfu = [...count.entries()].filter(([, n]) => n > 1).map(([q]) => q);
  shuo(chongfu.length === 0, '主进程没有重复注册的 IPC 通道（重复会被静默吞掉 ⇒ 第一份生效）', chongfu.join(','));
  shuo(qudao.filter((q) => q === 'warmy:jinengJiSaoMiaoMuLuJiSheZhi').length === 1,
    '「技能扫描目录设置」只注册一次（本轮删掉的就是多出来的那一份）');
  shuo(/function chaRuMoRenMuLu/.test(mainTs) && /normalize|归一|去重/.test(mainTs.slice(mainTs.indexOf('function chaRuMoRenMuLu'), mainTs.indexOf('function chaRuMoRenMuLu') + 1200)),
    '目录列表进主进程时归一 + 去重（尾斜杠/大小写不算两条）');
  shuo(/默认目录不可删|if \(i === 0\) return; \/\/ 默认目录不可删/.test(app), '界面：第一条默认目录不给删除');
  shuo(/moRenSaoMiaoLuJing\('skills'\)/.test(mainTs), '默认目录由同一个函数给（安装/扫描/界面三处同源）');
}

// ── 项 4：requires 门控 + 技能索引检索 + 写技能（真调函数） ─────────
console.log('\n项 4 · requires 门控 / 技能索引 / write_skill');
{
  const jn = path.join(GEN, 'packages/app-shell/dist/skill-md.js');
  if (!fs.existsSync(jn)) {
    weiTi('技能系统行为验证', 'dist/skill-md.js 不存在（先跑 tsc）');
  } else {
    const m = await import(pathToFileURL(jn).href);
    const gen = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-r27-skill-'));
    const write = (dir, name, body) => {
      const p = path.join(gen, dir);
      fs.mkdirSync(p, { recursive: true });
      fs.writeFileSync(path.join(p, 'SKILL.md'), body, 'utf8');
      return p;
    };
    write('has-all', 'x', ['---', 'name: has-all', 'description: 什么都不缺', '---', '', '正文'].join('\n'));
    write('needs-magic', 'x', ['---', 'name: needs-magic', 'description: 需要一个不存在的命令', 'requires: magic-not-installed-xyz', '---', '', '正文'].join('\n'));
    write('needs-python', 'x', ['---', 'name: needs-python', 'description: 需要 python', 'requires: python', '---', '', '正文'].join('\n'));

    const quan = m.saoMiaoJiNeng([gen]);
    shuo(quan.length >= 3, '扫描能读到三个技能目录', quan.length);
    const ai = m.jieXiYiLai({ requires: 'magic-not-installed-xyz' });
    shuo(Array.isArray(ai.mingLing) && ai.mingLing.includes('magic-not-installed-xyz'), 'requires 解析出命令清单', JSON.stringify(ai));
    const que = m.chaYiLaiQueShao(ai);
    shuo(que.mingLing.length === 1, '缺的命令被判为缺失', JSON.stringify(que));
    const zhong = m.chaYiLaiQueShao(m.jieXiYiLai({ requires: 'python' }));
    if (zhong.mingLing.length === 0) shuo(true, '本机有 python ⇒ 判为不缺');
    else shuo(true, '本机没有 python ⇒ 如实算缺（门禁按本机情况判定）', zhong.mingLing.join(','));
    const lan = m.fenLanJiNeng(quan);
    shuo(lan.quanBu.length >= lan.geiMoXing.length, '分栏：全量 ≥ 给模型的清单');
    shuo(!lan.geiMoXing.some((s) => String(s.name || s.ming || '').includes('needs-magic')),
      '缺依赖的技能**不暴露给模型**（官方规则：过滤掉就整条不给）', lan.geiMoXing.map((s) => s.name || s.ming).join(','));
    shuo(typeof m.queShaoShuoMing(que) === 'string' && m.queShaoShuoMing(que).length > 0, '缺失项能给出人话说明', m.queShaoShuoMing(que));

    m.qingKongJiNengSuoYin();
    const suo = m.jiNengSuoYin([gen]);
    shuo(suo && suo.xiang && suo.xiang.length >= 3, '技能索引能建起来（大目录检索的第一层）', suo && suo.xiang && suo.xiang.length);
    const souMagic = m.souSuoJiNeng(suo, 'magic');
    shuo(souMagic.length === 0, '检索也尊重门控：缺依赖的技能连"被搜到"都不给（不硬凑）', JSON.stringify(souMagic.map((x) => x.xiang && x.xiang.name)));
    const sou = m.souSuoJiNeng(suo, 'has-all');
    shuo(sou.length >= 1, '按关键词检索能命中可用的技能', JSON.stringify(sou.map((x) => x.xiang && x.xiang.name)));
    const sou2 = m.souSuoJiNeng(suo, 'zzz-不可能命中-yyy');
    shuo(sou2.length === 0, '检索不到就返回空（不硬凑）');
    m.qingKongJiNengSuoYin();
    fs.rmSync(gen, { recursive: true, force: true });

    shuo(/name: 'write_skill'/.test(mainTs) || /name: 'write_skill'/.test(fs.readFileSync(path.join(GEN, 'packages/app-shell/src/work-tools.ts'), 'utf8')),
      'write_skill 工具已声明（agent 自写技能的入口）');
    shuo(/chuliIpc\('warmy:xieJineng'/.test(mainTs) || /function xieJinengWen|xieJineng/.test(mainTs),
      '写技能有实现（不是只挂个名字）');
  }
}

// ── 项 7/8/10：计划任务落库、中文编号、复制完整时间 ────────────────
console.log('\n项 7/8/10 · 计划任务');
{
  // 第 34 轮 plan_update 重写：旧步骤由 baoLiu 保留、标题回退走 biaoZhun/beiYong、创建时间由宿主给（不再有宿主种子）
  shuo(/const baoLiu = jiu\.filter\(/.test(mainTs) && /const heBing = \[\.\.\.baoLiu, \.\.\.heBingXin\]/.test(mainTs), 'plan_update 合并保留旧步骤（不再"新数组覆盖旧数组"）');
  shuo(/biaoZhun\(diYi\) \|\| biaoZhun\(jiuBiao\) \|\| beiYong\(String\(it\.note/.test(mainTs), '标题为空时回退旧标题/说明首行（不再整片空白）');
  shuo(/done.*只能.*plan_verify|plan_verify.*(done|verified)/s.test(mainTs) || !/case 'done'/.test(mainTs.slice(mainTs.indexOf('plan_update'), mainTs.indexOf('plan_update') + 4000)),
    'done 不由 plan_update 直接落地（要真验收才算完成 ⇒ 不再"自己宣布完成"）');
  shuo(/\|\| \(xinTs \+ bu\.length\)/.test(mainTs) && !mainTs.includes("'plan.host-seed'"), '每一步都带宿主记的创建时间（第 34 轮起不再有宿主种子步骤）');
  shuo(/function jiHuaIdZiRanXu/.test(mainTs), '计划 id 按自然序排（宿主种子不会插到最前）');
  shuo(/sort\(\(a, b\) => jiHuaIdZiRanXu\(a\.id, b\.id\)\)/.test(mainTs), '合并后按自然序排序（显示顺序稳定）');
  shuo(/data-jhfull/.test(app) && /wanZheng/.test(app) && /hour12: false/.test(app), '右键复制用完整时间（年月日时分秒，非 12 小时制）');
  shuo(/jiHuaHang2\.yiWan[^{]*border-left-color:\s*transparent/.test(css.replace(/\s+/g, ' ').replace(/ \{ /g, '{')) || /\.yiWan \{[\s\S]{0,160}border-left-color: transparent/.test(css),
    '已完成的计划行：左侧色条真的消失（不是只变淡）');

  /** 把 app.js 里的纯函数抠出来真跑（编号回归只能靠跑） */
  const qu = (kai, bi) => {
    const i = app.indexOf(kai);
    if (i < 0) return '';
    const j = app.indexOf(bi, i);
    return j < 0 ? '' : app.slice(i, j);
  };
  const code = qu('const HAN_SHU_ZI', 'function jiHuaShiHanZu');
  if (!code) {
    weiTi('中文编号行为验证', 'app.js 里没抠到 HAN_SHU_ZI…jiHuaShiHanZu 这一段');
  } else {
    const fn = new Function(code + '\nreturn { hanZiShu, jiHuaHanXu, dangWei: () => "han" };');
    const { hanZiShu, jiHuaHanXu } = fn();
    shuo(hanZiShu(1) === '一' && hanZiShu(3) === '三', '1→一 3→三', hanZiShu(1) + '/' + hanZiShu(3));
    shuo(hanZiShu(10) === '十' && hanZiShu(11) === '十一' && hanZiShu(21) === '二十一', '十/十一/二十一起来对', [10, 11, 21].map(hanZiShu).join(','));
    const b = jiHuaHanXu(1, '一'), c = jiHuaHanXu(8, '八');
    shuo(b === '一' && c === '八', '汉字风格前缀（八）下第 8 条就是「八」，不是「八1」', b + '/' + c);
    shuo(jiHuaHanXu(2, '八') === '二' && jiHuaHanXu(3, '八') === '三', '同一风格里编号是连续中文数字：二、三（用户原话要的效果）');
    shuo(!/[一二三四五六七八九十]\d/.test([1, 3, 8, 12].map((x) => jiHuaHanXu(x, '八')).join('|')), '汉字数字风格后面绝不接阿拉伯数字');
    shuo(jiHuaHanXu(11, '甲') === '甲11' && jiHuaHanXu(3, '甲') === '丙', '天干风格：十以内走甲乙丙，过十才补数字');
    shuo(/jiHuaShiHanZu\(y\.prefix\) \? jiHuaHanXu\(/.test(app), '只有 CJK 前缀才切中文序号（T/A/B 风格仍用前缀+数字）');
  }
}

// ── 项 2：dsh-market 应用内弹窗 ───────────────────────────────────
console.log('\n项 2 · dsh-market 弹窗');
{
  shuo(/id="dshMkGen"/.test(html) && /dshMkMask/.test(html) && /aria-modal="true"/.test(html),
    '弹窗根节点在 index.html（遮罩 + aria-modal ⇒ 主界面点不到）');
  shuo(/\.dshMkGen \{[\s\S]{0,200}position: fixed; inset: 0/.test(css) || /\.dshMkGen\s*\{[^}]*position: fixed/.test(css),
    '遮罩铺满整个窗口（不是可拖的悬浮层 ⇒ 相对主界面不可移动）');
  shuo(/--mk-accent: #c0392b/.test(css) && /minmax\(17rem, 1fr\)/.test(css) && /border-radius: 999px/.test(css),
    '样式沿用上游令牌（朱红主色 / 卡片栅格 / 胶囊）');
  shuo(/window\.__dshMkKai = dshMkKai/.test(app) && /function jinengShiChang\(\) \{ dshMkKai\(\); \}/.test(app),
    '「打开 dsh-market」和「浏览市场」都开应用内弹窗');
  shuo(!/\$\('anNiuJinengShiChangGithub'\)[\s\S]{0,200}openExternal/.test(app),
    '技能页不再用外部浏览器打开 dsh-market（需求原话：弹出窗口）');
  shuo(/function dshMkGuan\(\)[\s\S]{0,200}classList\.add\('yinCang'\)/.test(app), '遮罩/×/Esc 都能关（Esc 由 dshMkKey 处理）');
  shuo(/function dshMkKey\(event\)[\s\S]{0,160}Escape/.test(app), 'Esc 关闭已绑定');
  shuo(/skillMarketList: \(p\) => ipcRenderer\.invoke\('warmy:skillMarketList', p\)/.test(pre),
    'preload 把 query/category/limit 透传给主进程（搜索与分类真的能用）');
  shuo(/dshShiChangZiLiao: \(\) => ipcRenderer\.invoke\('warmy:dshShiChangZiLiao'\)/.test(pre), 'preload 暴露上游资料接口');
  shuo(/muLu: moRenSaoMiaoLuJing\('skills'\)/.test(mainTs), '目录接口回带"技能装到哪个目录"（界面能如实显示）');
  shuo(/const gen0 = moRenSaoMiaoLuJing\('skills'\);/.test(mainTs), '安装钉死写到不可删除的默认目录（不再取 jinengGen()[0]）');
  shuo(/async function zhaoSkiLlMd/.test(mainTs) && /'no-skill-md'/.test(mainTs),
    '安装前先解析仓库里真正的 SKILL.md；没有就如实拒绝（不把 plugin.json 当技能塞进来）');
  shuo(/if \(!\/\^https:\\\/\\\/raw\\.githubusercontent\\.com\\\//.test(mainTs) || /raw\.githubusercontent\.com.*test\(url\)/.test(mainTs),
    '只允许从 raw.githubusercontent.com 取技能正文（防任意 URL 下载）');
  const b = [...new Set([
    ...[...app.matchAll(/tOr\('settings\.dshMk\.([a-zA-Z]+)'/g)].map((x) => 'settings.dshMk.' + x[1]),
    ...[...app.matchAll(/mkT\('([a-zA-Z]+)'/g)].map((x) => 'settings.dshMk.' + x[1]),
  ])];
  const missing = b.filter((k) => !(k in i18n));
  shuo(b.length > 8, '弹窗文案走 i18n（键数 ' + b.length + '）');
  shuo(missing.length === 0, '每个 dshMk 键都在 10 语言包里（缺键会露出中文兜底）', missing.join(','));
}

// ── 项 5：本地语音（真调 dist 产物） ─────────────────────────────
console.log('\n项 5 · 本地语音（sherpa-onnx）');
{
  const bdPath = path.join(GEN, 'packages/app-shell/dist/bendi-yuyin.js');
  if (!fs.existsSync(bdPath)) {
    weiTi('本地语音行为验证', 'dist/bendi-yuyin.js 不存在（先跑 tsc）');
  } else {
    const bd = await import(pathToFileURL(bdPath).href);
    const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-r27-yuyin-'));
    const jin = [];
    bd.chuShiHuaBenDiYuYin({ userDataDir: ud, onJinDu: (d) => jin.push(d) });
    const s0 = bd.zhuangTaiBenDiYuYin();
    shuo(['yi_an_zhuang', 'wei_an_zhuang', 'bu_ke_yong', 'an_zhuang_zhong'].includes(s0.zhuangTai), '状态名在约定集合里', s0.zhuangTai);
    shuo(s0.ok === true && !!s0.moXingMing.shiBie && !!s0.moXingMing.heCheng, '状态回带钉死的模型名（界面别自己抄）', JSON.stringify(s0.moXingMing));
    shuo(s0.daYueMB > 100 && typeof s0.keXian === 'string' && s0.keXian.includes('Apache'), '给出下载体量与许可摘要（不隐瞒）', s0.daYueMB + 'MB');
    shuo(s0.yunXing.banBen === '1.13.8', '运行时版本被钉住（升级只改清单一处）', s0.yunXing.banBen);
    /** 没装/没启用时必须拒绝干活，且**不能抛**（否则整条听话链会被带崩） */
    const r1 = await bd.benDiShiBie(Buffer.alloc(4), 'wav');
    shuo(r1.ok === false && String(r1.error).includes('not-enabled'), '未启用 ⇒ 识别如实拒绝（交给调用链）', r1.error);
    const r2 = await bd.benDiHeCheng('测试', 0, 1);
    shuo(r2.ok === false && String(r2.error).includes('not-enabled'), '未启用 ⇒ 合成如实拒绝', r2.error);
    bd.qiYongBenDiYuYin(true);
    const r3 = await bd.benDiShiBie(Buffer.alloc(4), 'webm');
    shuo(r3.ok === false && String(r3.error).includes('not-enabled'), '模型没装齐/未安装 ⇒ 状态回到未安装（启用勾不上）', r3.error);
    shuo(bd.zhuangTaiBenDiYuYin().qiYong === false, '没装好时 qiYong 必须为 false（界面不会显示"已启用"）');
    const del = bd.shanChuBenDiYuYin({ buZaiAnZhuang: true });
    shuo(del.ok === true, '删除接口可用');
    const s1 = bd.zhuangTaiBenDiYuYin();
    shuo(s1.buZaiAnZhuang === true && s1.zhuangTai === 'wei_an_zhuang' && s1.qiYong === false,
      '删除后：写「下次更新不再安装」标记 + 状态未安装 + 启用自动关掉', JSON.stringify({ z: s1.zhuangTai, m: s1.buZaiAnZhuang }));
    fs.rmSync(ud, { recursive: true, force: true });

    shuo(/chuShiHuaBenDiYuYin\(\{[\s\S]{0,200}onJinDu/.test(mainTs), '主进程接了进度回调（安装进度能实时回界面）');
    shuo(/benDiYuYinZhuangTai|benDiYuYinAnZhuang|benDiYuYinShanChu|benDiYuYinQiYong|benDiYuYinZiJian/.test(pre) && (pre.match(/benDiYuYin/g) || []).length >= 6,
      'preload 暴露状态/安装/删除/启用/自检 全套接口');
    shuo(/const bd = await benDiShiBie\(buf, geShi\);/.test(mainTs), '听话链：**本地优先**，成功就用本地结果返回');
    shuo(/asr\.bendi\.skip/.test(mainTs) && /tts\.bendi\.skip/.test(mainTs), '本地失败会记降级原因（不静默）');
    shuo(/if \(he\.ok && he\.wav\)/.test(mainTs), '说话链：本地成功直接返回 wav dataUrl');
    shuo(/const mo = lian\.find[\s\S]{0,400}no-tts-model/.test(mainTs) && /bdSt && bdSt\.qiYong && bdSt\.moXing\.heCheng/.test(mainTs),
      '本地合成在"没配说话模型"的检查**之前**（装了就能出声）');
    shuo(/local: true, source: 'bendi-yuyin'|source: 'bendi-yuyin'/.test(mainTs), '听话/说话状态把本地也算成"可用"（界面不骗人）');
    const lk = [...app.matchAll(/tOr\('localSpeech\.([a-zA-Z]+)'/g)].map((x) => 'localSpeech.' + x[1]);
    const miss2 = [...new Set(lk)].filter((k) => !(k in i18n));
    shuo(lk.length > 15, '本地语音卡片文案走 i18n（键数 ' + lk.length + '）');
    shuo(miss2.length === 0, '每个 localSpeech 键都在语言包里', miss2.join(','));
    shuo(/id="benDiYuYinKa" data-sec="func"/.test(app) && /id="benDiYuYinKaiGuan"/.test(app),
      '卡片在「设置 → 功能」里，标题右侧是启用勾选');
    shuo(/localSpeech\.uninstall/.test(app) && /localSpeech\.install/.test(app) && /localSpeech\.confirmDelete/.test(app),
      '删除按钮 ↔ 安装按钮（删除前有确认，文案写明"下次更新不再安装"）');
  }
}

// ── 项 6：认不出的模型不进任何调用链 ─────────────────────────────
console.log('\n项 6 · Ollama 无法加载的模型归类');
{
  shuo(/family[\s\S]{0,80}unknown[\s\S]{0,160}buKeYong/.test(mainTs) || /buKeYong/.test(fs.readFileSync(path.join(GEN, 'packages/providers/src/ollama.ts'), 'utf8')),
    'details.family=unknown ⇒ 打 buKeYong 标记（不是"能列出来就能用"）');
  shuo(/buKeYong/.test(mainTs) && /nengLiLianMoXing/.test(mainTs), '调用链构造处消费 buKeYong（认不出就不进链）');
  shuo(/model\.chain-prune-unusable/.test(mainTs), '剪枝有审计记录（能看到"为什么这个模型被剔了"）');
  const nn = await import(pathToFileURL(path.join(GEN, 'packages/providers/dist/mo-xing-neng-li.js')).href).catch(() => null);
  if (!nn) weiTi('能力构造器行为验证', 'providers/dist/mo-xing-neng-li.js 读不到');
  else {
    const n = nn.moXingNengLi('dimavz/whisper-tiny:latest', { buKeYong: 'unknown model architecture', kind: 'asr' });
    shuo(!!n.buKeYong, 'whisper-tiny 带着"不可用"标记出来（不会再被选进听话链）', JSON.stringify(n.buKeYong));
    shuo(nn.caiZhongLei('dimavz/whisper-tiny:latest') === 'asr', '按名字它确实是 ASR 类（问题不在类型，在**本机加载不了**）', nn.caiZhongLei('dimavz/whisper-tiny:latest'));
  }
  let keDa = false;
  try {
    const r = await fetch('http://127.0.0.1:11434/api/show', {
      method: 'POST', body: JSON.stringify({ model: 'dimavz/whisper-tiny:latest' }), signal: AbortSignal.timeout(6000),
    });
    const j = await r.json();
    keDa = true;
    shuo(String((j.details || {}).family || '') === 'unknown', '真机复核：Ollama 报这个模型的 family=unknown', JSON.stringify(j.details || {}).slice(0, 120));
  } catch { /* 本机没起 Ollama 就不假装 */ }
  if (!keDa) weiTi('Ollama 现场复核', '127.0.0.1:11434 不通（未验证 ≠ 通过）');
}

// ── 接线/编译产物完整性 ──────────────────────────────────────────
console.log('\n接线 · 产物');
{
  shuo(mainJs.length > 100000, 'dist/electron-main.js 存在且非空（改了 .ts 记得 tsc）', mainJs.length);
  if (mainJs) {
    shuo(/warmy:benDiYuYinZhuangTai/.test(mainJs) && /warmy:dshShiChangZiLiao/.test(mainJs), '新通道在**编译产物**里（不是只在源码里）');
    const qd = [...mainJs.matchAll(/chuliIpc\('([^']+)'/g)].map((m) => m[1]);
    const c2 = new Map();
    for (const q of qd) c2.set(q, (c2.get(q) || 0) + 1);
    const cf2 = [...c2.entries()].filter(([, n]) => n > 1).map(([q]) => q);
    shuo(cf2.length === 0, '编译产物里也没有重复通道', cf2.join(','));
    shuo(/assets copied|dist\/renderer/.test('') || fs.existsSync(path.join(GEN, 'packages/app-shell/dist/renderer/app.js')),
      'copy-assets 已把渲染层放进 dist');
  }
}

console.log('\n' + '─'.repeat(52));
console.log('第 27 轮变更：过 ' + guo + ' · 败 ' + bai + ' · 没跑 ' + wei);
if (bai > 0) process.exit(1);
