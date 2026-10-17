/**
 * verify-round37-changes —— 第 37 轮静态 + 单元门禁（13 项逐条）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const GEN = __ROOT;
const SRC = path.join(GEN, 'packages/app-shell/src');
const DIST = path.join(GEN, 'packages/app-shell/dist');
const rd = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const main = rd(path.join(SRC, 'electron-main.ts'));
const appJs = rd(path.join(SRC, 'renderer/app.js'));
const appCss = rd(path.join(SRC, 'renderer/app.css'));
const preload = rd(path.join(SRC, 'preload.cjs'));
const rules = rd(path.join(SRC, 'builtin-rules.ts'));
const cred = rd(path.join(SRC, 'cred-vault.ts'));
const jie = [];
const panding = (ming, zhen, xiang) => jie.push({ ming, ok: !!zhen, xiang: xiang === undefined ? '' : String(xiang).slice(0, 300) });

/* 项 1：内置技能 */
panding('项1 技能播到**默认技能目录**（scan-dirs/skills），不是历史遗留目录',
  /moRenSaoMiaoLuJing\('skills'\)/.test(main) && /bo\('warmy-self-modify'/.test(main));
panding('项1 find-skill 也走同一个默认目录', /bo\('find-skill'/.test(main));
panding('项1 技能面向"改造本机这一份"（源码/打包两种形态 + 风险分层 + 自证 + 回滚）',
  /源码形态/.test(rules) && /打包形态/.test(rules) && /回滚/.test(rules) && /改完必须自证/.test(rules));
panding('项1 技能里没有仓库地图 / 本机路径 / 密钥',
  !/仓库地图/.test(rules) && !/packages\/app-shell/.test(rules) && !/Users[\\/]/.test(rules) && !/ghp_|sk-/.test(rules));
panding('项1 老位置的同名播种会被清掉（内容与我们出厂稿一致才删）',
  /if \(fs\.readFileSync\(wen, 'utf8'\) === nei\) fs\.rmSync/.test(main));

/* 项 2：印象 */
panding('项2 「印象」文件是 userData/yonghushuju.md，读写 IPC 齐全',
  /function yinXiangLu/.test(main) && /'yonghushuju\.md'/.test(main) && /warmy:yinXiangDu/.test(main) && /warmy:yinXiangShe/.test(main));
panding('项2 preload 暴露 yinXiangDu/She/ZhiYi', ['yinXiangDu:', 'yinXiangShe:', 'yinXiangZhiYi:'].every((k) => preload.includes(k)));
panding('项2 「我的」页在**道与规矩之间**渲染印象卡（可编辑，与道同一套确定/取消）',
  (() => {
    const i = appJs.indexOf('id="daoKa"');
    const j = appJs.indexOf('id="yinXiangKa"');
    const k = appJs.indexOf('id="zuiGaoXinNianKa"');
    return i > 0 && j > i && k > j && /yinXiangTi/.test(appJs);
  })());
panding('项2 印象注入系统提示，且**明确低于规矩**、与用户当场的话冲突以用户为准',
  /【印象 · 牛马对用户的长期理解（低于「规矩」）】/.test(main) && /一律以用户当场说的为准/.test(main)
  && /已被用户否认/.test(main));
panding('项2 归档时归纳进印象（确定性提取，不调用模型）',
  /zhengLiYinXiang\(\{ yuanHua: yongHuHua \}\)/.test(main) && /function zhengLiYinXiang/.test(main));
panding('项2 印象有防膨胀上限（行数 + 字符双闸）',
  /YIN_XIANG_MAX_LINES = 120/.test(main) && /YIN_XIANG_MAX_CHARS = 6000/.test(main) && /ziZeng\.length > YIN_XIANG_MAX_LINES/.test(main));
panding('项2 软门禁（提取纪律）存在：只提取长期有效的、不提取一次细节/隐私/猜测',
  /YIN_XIANG_TIQU_MENJIN/.test(main) && /不要提取/.test(main) && /三个月后再看到这条/.test(main));
panding('项2 硬门禁：用户否认 ⇒ 归因 + 标记该条 + **追加一条提取纪律**',
  /warmy:yinXiangZhiYi/.test(main) && /已被用户否认/.test(main) && /## 提取纪律（用户否认后自动追加）/.test(main));
panding('项2 渲染层在用户否认时调用归因（保守：只认明确否认措辞）',
  /yinXiangZhiYi\?\.\(\{ wen: wen0, yuanYin: '用户在对话中否认' \}\)/.test(appJs) && /我没说|别乱说|你记错/.test(appJs));

/* 项 5：微信扫码 */
panding('项5 微信扫码：官方 iLink 两步（get_bot_qrcode → get_qrcode_status）',
  /get_bot_qrcode\?bot_type=/.test(main) && /get_qrcode_status\?qrcode=/.test(main));
panding('项5 扫码确认后凭据**加密**保存并默认映射到这只牛马自己的会话',
  /st === 'confirmed'/.test(main) && /zhengJiaMi\(\{ pingTai: dai\.pingTai, botId, botToken: token/.test(main) && /huiHuaYingShe: \{ default: dai\.instId \}/.test(main));
panding('项5 UI 有「微信扫码连接」按钮 + 二维码弹层 + 状态轮询', /data-sj-qr/.test(appJs) && /sheJiaoSaoMaZhuangTai/.test(appJs));
panding('项5 失败如实显示服务端原话（不假装成功）', /qrFail/.test(appJs) && /HTTP ' \+ r\.status/.test(main));

/* 项 6：头像 */
/**
 * 项 6 的最终状态（用户后面又定点改了两次，这里按**现在的**口径判）：
 *  · `preset-1..10` = 牛马预设，**已恢复成原来那套**（不再要求抽象人）；
 *  · `person-10`（可选列表第 9 个）= 抽象的人；
 *  · `user-default`（默认头像）= 抽象的人，且**左右对称、无角落装饰点**；
 *  · `abs-1`（可选列表第 10 个）= 原来那张默认头像的画面（与 person-1 逐字相同）。
 */
panding('项6 person-10 / user-default 是"抽象的人"（几何人形 + 整圆底）',
  (() => {
    const dir = path.join(SRC, 'renderer/icons/avatars');
    return ['person-10', 'user-default'].every((n) => {
      const s = rd(path.join(dir, n + '.svg'));
      return /<circle cx="50" cy="50" r="50"/.test(s) && /(circle|rect)[^>]*cx="50"|rect x="3[0-9]"/.test(s);
    });
  })());
panding('项6 默认头像左右对称且无角落装饰点（用户两次点名要求）',
  (() => {
    const s = rd(path.join(SRC, 'renderer/icons/avatars/user-default.svg'));
    // 对称：关键元素都以 x=50 为轴（居中圆/居中方头 + 左右成对弧）
    return /cx="50"/.test(s) && /M26,72/.test(s) && /M74,72/.test(s)
      && !/<circle[^>]*\br="[1-5](\.[0-9]+)?"/.test(s);
  })());
panding('项6 可选列表第 10 个（abs-1）= 原默认头像画面', (() => {
  const dir = path.join(SRC, 'renderer/icons/avatars');
  const a = rd(path.join(dir, 'abs-1.svg'));
  const b = rd(path.join(dir, 'person-1.svg'));
  return a.length > 100 && a === b;
})());
panding('项6 牛马预设 10 张已恢复原样（不含抽象人母题 pabg/p10bg）',
  (() => {
    const dir = path.join(SRC, 'renderer/icons/avatars');
    return Array.from({ length: 10 }, (_, i) => 'preset-' + (i + 1)).every((n) => {
      const s = rd(path.join(dir, n + '.svg'));
      return s.length > 100 && !/pabg|p10bg/.test(s);
    });
  })());
panding('项6 不含政治/宗教/种族/职业线索（无头发形状、无制服、无标志符号）',
  (() => {
    const dir = path.join(SRC, 'renderer/icons/avatars');
    const lie = ['preset-1', 'preset-5', 'preset-10', 'user-default'];
    return lie.every((n) => {
      const s = rd(path.join(dir, n + '.svg'));
      return !/hair|uniform|beard|cross|star-of|flag|logo/i.test(s);
    });
  })());

/* 项 7：撤销按钮对齐 */
panding('项7 授权卡的撤销按钮靠右对齐（margin-left:auto + 操作列占满）',
  /\.shouQuanCheXiaoXiao \{ flex:0 0 auto; margin-left:auto;/.test(appCss.replace(/\n\s*/g, ' '))
  && /\.shouQuanHang2 \.shouQuanCaoZuo \{ flex:1 1 auto;/.test(appCss.replace(/\n\s*/g, ' ')));

/* 项 8：附件只读 */
panding('项8 附件授权显式标成只读（cls:read）', /du: true, cls: 'read'/.test(main));
panding('项8 要改附件时卡片改口为「请求**修改**你给它的这个文件」并说明"你只授权了读取"',
  /AI 请求\*\*修改\*\*你给它的这个文件/.test(main) && /你只授权了「读取」/.test(main));

/* 项 9：流式期间的执行明细 */
panding('项9 执行明细能挂到**流式气泡**上（不再等最终回复）',
  /const liuShi = hang\.filter\(\(n\) => n\.hasAttribute\('data-streaming'\)\)/.test(appJs)
  && /const zhuan = liuShi\.length \? liuShi\[liuShi\.length - 1\]/.test(appJs));

/* 项 10：退出走应用自己的路 */
panding('项10 支持 --warmy-quit 二次启动参数 ⇒ 走应用自己的退出函数（不再 taskkill）',
  /--warmy-quit/.test(main) && /tuichuYingyong\('second-instance-argv'\)/.test(main));

/* 项 11/12：凭据加密 + 按牛马 */
panding('项11 社交凭据落盘加密（safeStorage，enc:v1）',
  /export function jiaMiWenBen/.test(cred) && /export function jieMiWenBen/.test(cred)
  && /xiao\.zheng = zhengJiaMi\(/.test(main) && /zhengJieMi\(x\.zheng\)/.test(main));
panding('项12 社交配置按牛马存 + 连接按「实例::平台」分开',
  /sheJiaoJieRu\?: Record<string, SheJiaoPeiZhi>/.test(main) && /function sheJiaoLianJieJian/.test(main));
panding('项12 默认映射到这只牛马**自己的会话**', /huiHuaYingShe = \{ default: instId \|\| '' \}/.test(main));

/* i18n + dist */
{
  const LANGS = ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko', 'ru', 'es', 'fr', 'pt', 'eo'];
  const xin = ['wo.yinXiang', 'wo.yinXiangHint', 'chat.voiceTooQuiet', 'localSpeech.micTest', 'shejiao.qrConnect', 'shejiao.qrConfirmed'];
  const counts = new Set();
  const que = [];
  for (const l of LANGS) {
    let j = {};
    try { j = JSON.parse(rd(path.join(SRC, 'i18n', l + '.json'))); } catch { /* */ }
    counts.add(Object.keys(j).length);
    for (const k of xin) if (!j[k]) que.push(l + ':' + k);
  }
  panding('i18n 十国键集合相等', counts.size === 1, [...counts].join(','));
  panding('i18n 本轮新增键十国齐全', que.length === 0, que.slice(0, 5).join(' '));
}
panding('dist/preload 含本轮新桥（印象 + 扫码）',
  ['yinXiangDu:', 'yinXiangShe:', 'sheJiaoSaoMaKaiShi:', 'sheJiaoSaoMaZhuangTai:'].every((k) => rd(path.join(DIST, 'preload.cjs')).includes(k)));
panding('dist 渲染层含印象卡与扫码按钮',
  (() => { const d = rd(path.join(DIST, 'renderer/app.js')); return d.includes('yinXiangKa') && d.includes('data-sj-qr'); })());
panding('dist 主进程含印象/扫码/加密',
  (() => { const d = rd(path.join(DIST, 'electron-main.js')); return d.includes('yinXiangZhiYi') && d.includes('get_bot_qrcode') && d.includes('zhengJiaMi'); })());

const ok = jie.filter((x) => x.ok).length;
const bad = jie.length - ok;
for (const x of jie) console.log((x.ok ? '  ok   ' : '  FAIL ') + x.ming + (x.xiang ? '  ← ' + x.xiang : ''));
console.log(`\n==== verify-round37-changes：${ok} ok / ${bad} FAIL ====`);
process.exit(bad ? 1 : 0);
