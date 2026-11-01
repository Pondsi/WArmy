/**
 * 第 92 轮：短记忆 / 要求 / 我的页布局 的静态与逻辑门禁。
 *
 * 用户口径：
 *  · 原「规范」更名「短记忆」，第四列不再显示、添加卡片里也没有，人看不到内容；
 *  · 短记忆只由归档时的模型更新；
 *  · 第四列新增「要求」，每会话一份、用户亲写、模型不可改；
 *    注入优先级：术 > 要求 > 短记忆，可压缩。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(ROOT, 'packages/app-shell/src');
const DIST = path.join(ROOT, 'packages/app-shell/dist');
const rd = (p) => fs.readFileSync(p, 'utf8');
let okN = 0, failN = 0;
const ok = (m) => { okN++; console.log('  ok  ' + m); };
const bad = (m) => { failN++; console.log('  FAIL ' + m); };
const jian = (m, c, d) => (c ? ok(m) : bad(m + (d === undefined ? '' : ' ← ' + String(d).slice(0, 300))));

console.log('\n[1] 上限 / 压缩层级 / 产品门禁');
const TX = await import(pathToFileURL(path.join(DIST, 'ti-shi-shang-xian.js')).href);
const YS = await import(pathToFileURL(path.join(DIST, 'yaSuo-fenCeng.js')).href);
const BR = await import(pathToFileURL(path.join(DIST, 'builtin-rules.js')).href);
jian('要求上限 2000', TX.TI_SHI_SHANG_XIAN['要求'] === 2000, TX.TI_SHI_SHANG_XIAN['要求']);
jian('短记忆上限 2000（与旧规范同数）', TX.TI_SHI_SHANG_XIAN['短记忆'] === 2000 && TX.TI_SHI_SHANG_XIAN['规范'] === 2000);
jian('压缩第三层顺序：短记忆 → 要求 → 术',
  JSON.stringify(YS.YA_SUO_CENG[2]) === JSON.stringify(['短记忆', '要求', '术']), JSON.stringify(YS.YA_SUO_CENG[2]));
jian('cengOf：要求/短记忆/术同层（第 3 层）',
  YS.cengOf('短记忆') === 3 && YS.cengOf('要求') === 3 && YS.cengOf('术') === 3);
jian('层内名次：短记忆先于要求、要求先于术',
  YS.cengNeiMing('短记忆', 3) < YS.cengNeiMing('要求', 3) && YS.cengNeiMing('要求', 3) < YS.cengNeiMing('术', 3));
jian('产品门禁包含门禁 E（要求只能用户写）', /硬门禁 E/.test(BR.CHANPIN_MENJIN) && /模型\*\*只能读取、不得改写、删除、伪造/.test(BR.CHANPIN_MENJIN));
jian('产品门禁仍不含被撤除的「不是…而是…」句式纪律', !/不是…而是…/.test(BR.CHANPIN_MENJIN));

console.log('\n[2] 注入顺序与 IPC');
const MAIN = rd(path.join(SRC, 'electron-main.ts'));
const PRE = rd(path.join(SRC, 'preload.cjs'));
const APP = rd(path.join(SRC, 'renderer/app.js'));
const HTML = rd(path.join(SRC, 'renderer/index.html'));
const iShu = MAIN.indexOf('【术 · 方法论');
const iYao = MAIN.indexOf('【要求 · 只作用于本会话');
const iDuan = MAIN.indexOf('【短记忆 · 只作用于本会话');
const iYin = MAIN.indexOf("'【印象 · 对用户的长期理解】");
jian('注入顺序：术 → 要求 → 短记忆 → 印象', iShu > 0 && iShu < iYao && iYao < iDuan && iDuan < iYin);
jian('要求 = userData/yaoqiu/<sid>.md，有用户读写 IPC',
  /function yaoQiuLu/.test(MAIN) && /'yaoqiu'/.test(MAIN) && /warmy:yaoQiuDu/.test(MAIN) && /warmy:yaoQiuShe/.test(MAIN)
  && /yaoQiuDu: \(p\) => ipcRenderer\.invoke\('warmy:yaoQiuDu'/.test(PRE) && /yaoQiuShe: \(p\) => ipcRenderer\.invoke\('warmy:yaoQiuShe'/.test(PRE));
jian('要求保存先过上限闸', /chaoShangXianRi\('要求', t\)/.test(MAIN));
jian('要求注入留审计 chat.yaoqiu-injected', /chat\.yaoqiu-injected/.test(MAIN));
jian('短记忆只注入、没有用户 IPC', /chat\.duanjiyi-injected/.test(MAIN) && !/warmy:guiFanDu|warmy:guiFanShe/.test(MAIN) && !/guiFanDu:|guiFanShe:/.test(PRE));
jian('短记忆归档更新不再只限项目/群聊', /guiNaDuanJiYi\(sid\)/.test(MAIN) && !/groupStore\?\.getGroup\?\.\(sid\)\) return 0/.test(MAIN));
jian('归档提示把要求标成只读、短记忆说明由宿主按频率维护', /用户要求（用户亲写，只读；不得改写\/删除）/.test(MAIN) && /短记忆（按它归置；它由宿主按知识库使用频率更新/.test(MAIN));
jian('run_shell 堵住写入要求目录', /yaoqiu-readonly|命中 userData\/yaoqiu|yaoqiu/i.test(MAIN) && /会话「要求」只能由用户/.test(MAIN));
const WT = rd(path.join(SRC, 'work-tools.ts'));
jian('文件工具 write/edit/copy/move 都拒绝写要求目录',
  /yaoqiu-readonly/.test(WT) && (WT.match(/shiYaoQiuLuJing\(/g) || []).length >= 4);
{
  const os = await import('node:os');
  const fs2 = await import('node:fs');
  const WTM = await import(pathToFileURL(path.join(DIST, 'work-tools.js')).href);
  const tmp = fs2.mkdtempSync(path.join(os.tmpdir(), 'warmy-r92-wt-'));
  try {
    const badW = WTM.workWriteFile(tmp, { path: 'yaoqiu/x.md', content: 'tamper' });
    const goodW = WTM.workWriteFile(tmp, { path: 'normal.txt', content: 'ok' });
    jian('write_file 拒绝 yaoqiu/…（行为级）', badW && badW.ok === false && /yaoqiu-readonly/.test(String(badW.content || badW.error || '')), JSON.stringify(badW));
    jian('write_file 普通路径仍可写（负向断言不误伤）', goodW && goodW.ok === true, JSON.stringify(goodW));
    const copyBad = WTM.workCopyFile(tmp, { path: 'normal.txt', destination: 'yaoqiu/copy.md' });
    jian('copy_file 拒绝把文件复制进 yaoqiu/', copyBad && copyBad.ok === false, JSON.stringify(copyBad));
    const mvBad = WTM.workMoveFile(tmp, { path: 'normal.txt', destination: 'yaoqiu/move.md' });
    jian('move_file 拒绝把文件移进 yaoqiu/', mvBad && mvBad.ok === false, JSON.stringify(mvBad));
  } finally {
    fs2.rmSync(tmp, { recursive: true, force: true });
  }
}

console.log('\n[3] 第四列卡片：规范移除、要求新增');
jian('PAN_DEFAULT 不再含规范卡、已含要求卡',
  !/mianBanGuiFanKuai/.test(APP.slice(APP.indexOf('const PAN_DEFAULT'), APP.indexOf('const PAN_ALL')))
  && /mianBanYaoQiuKuai/.test(APP.slice(APP.indexOf('const PAN_DEFAULT'), APP.indexOf('const PAN_ALL'))));
jian('PAN_ALL 登记要求卡、不再登记规范卡',
  /mianBanYaoQiuKuai: 'yaoqiu'/.test(APP) && !/mianBanGuiFanKuai: 'guifan'/.test(APP));
jian('添加卡片下拉有「要求」、没有「规范」',
  /<option value="mianBanYaoQiuKuai">/.test(APP) && !/<option value="mianBanGuiFanKuai">/.test(APP));
jian('DOM：有要求卡、没有规范卡', /id="mianBanYaoQiuKuai"/.test(HTML) && !/id="mianBanGuiFanKuai"/.test(HTML));
jian('渲染函数：renderPanelYaoQiu 存在，renderPanelGuiFan 已删',
  /async function renderPanelYaoQiu/.test(APP) && !/function renderPanelGuiFan/.test(APP));
jian('旧布局一次性迁移：含规范卡的旧 panCards 换成要求卡', /saved\.includes\('mianBanGuiFanKuai'\)/.test(APP) && /mianBanYaoQiuKuai/.test(APP));
jian('要求卡默认折叠、有注入徽标、有保存/清空', /mianBanYaoQiuKuai === undefined/.test(APP) && /panInjectBadge/.test(HTML) && /anNiuYaoQiuBaoCun/.test(HTML));

console.log('\n[4] 我的页布局（源码）');
const iAvatar = APP.indexOf('id="pAvAnNiu"');
const iName = APP.indexOf('id="pMingDisplay"');
const iCardBtn = APP.indexOf('id="pMingPianBtn"');
const iEmail = APP.indexOf('id="pYouJian"');
const iAuth = APP.indexOf('id="warmyAuthMyCard"');
jian('名片在用户名同一行且位于其后', iName > 0 && iCardBtn > iName && iAvatar < iName);
jian('邮箱在账号列、位于助记词卡片之前（上方）', iEmail > 0 && iAuth > iEmail && /class="woR68Account"/.test(APP));
jian('头像+用户名行水平居中（CSS）', /\.woR68Profile \{[^}]*align-items: center/.test(rd(path.join(SRC, 'renderer/auth-gate.css')))
  && /\.woR68Profile \.woMingHang \{ justify-content: center/.test(rd(path.join(SRC, 'renderer/auth-gate.css'))));
jian('以左侧 logo 为锚点上下居中（CSS）', /\.woDing\.woDingR68 \{[^}]*align-items: center/.test(rd(path.join(SRC, 'renderer/auth-gate.css'))));
jian('账号列整体下移（padding-top）', /\.woR68Account \{[^}]*padding-top: 14px/.test(rd(path.join(SRC, 'renderer/auth-gate.css'))));

console.log('\n[5] 10 种语言文案');
for (const lang of ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko', 'ru', 'es', 'fr', 'pt', 'eo']) {
  const j = JSON.parse(rd(path.join(SRC, 'i18n', lang + '.json')));
  const keys = ['panel.yaoqiu.biaoTi', 'panel.yaoqiu.tiShi', 'panel.yaoqiu.baoCun', 'panel.yaoqiu.chongZhi', 'panel.yaoqiu.kong', 'panel.yaoqiu.zanWu', 'panel.yaoqiu.yiBaoCun', 'panel.yaoqiu.baoCunShiBai', 'panel.yaoqiu.chaoShangXian', 'panel.yaoqiu.xianXuanHuiHua'];
  jian(`${lang} 要求文案 10 条齐全`, keys.every((k) => typeof j[k] === 'string' && j[k].trim()));
}

console.log(`\nverify-r92-duanjiyi-yaoqiu: ${okN} ok / ${failN} FAIL`);
process.exitCode = failN ? 1 : 0;
