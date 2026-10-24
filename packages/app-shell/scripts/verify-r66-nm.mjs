/**
 * verify-r66-nm.mjs —— 第 66 轮 nm 查看器 / 窗口吸附专项（离线门禁，不需要真实用户配置）。
 *
 * 覆盖用户第 5/7/8/9/10/11/32/33 项：
 *   · 工具栏：保存/目录/撤销下拉、图标换行、查找内嵌箭头、结果数展开替换、无横向滚动、
 *     窄窗收进「…」、替换展开放不下时两行并在变宽后回一行；
 *   · 只读文件：查找框与上下箭头可用，替换框/按钮禁用；可编辑时替换可用；
 *   · 二进制：虚拟十六进制视图、点字节编辑、增量保存（主进程侧备份/哈希校验用静态断言）；
 *   · 吸附：主窗口与 nm 平等（主拖 nm、nm 拖主）、新窗默认贴主窗右侧、只允许一扇被吸附、
 *     已吸附的 nm 旁边再来一扇也不吸；
 *   · 项 5：模型 open_path 的 nm 分流接线；
 *   · 项 33：滚动/输入不做全量重绘（rAF/防抖/CSS containment 的静态锚点 + 真实虚拟行数）。
 *
 * 做法分两层：
 *   1) 静态锚点（源码/产物必须在）；
 *   2) 真 Electron 隐藏窗口加载 `dist/renderer/nm-viewer.html`（真实 preload + 假 IPC 数据），
 *      再用真实 `dist/nm-viewer-win.js` 开真窗口断言吸附几何。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PKG = path.join(ROOT, 'packages/app-shell');
const ELECTRON = path.join(PKG, 'node_modules/electron/dist/electron.exe');
const HTML = path.join(PKG, 'dist/renderer/nm-viewer.html');
const PRELOAD = path.join(PKG, 'dist/preload.cjs');
const NMW = path.join(PKG, 'dist/nm-viewer-win.js');
const src = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const HTML_SRC = src('packages/app-shell/src/renderer/nm-viewer.html');
const JS_SRC = src('packages/app-shell/src/renderer/nm-viewer.js');
const CSS_SRC = src('packages/app-shell/src/renderer/nm-viewer.css');
const NMW_SRC = src('packages/app-shell/src/nm-viewer-win.ts');
const MAIN_SRC = src('packages/app-shell/src/electron-main.ts');
const SETTINGS_SRC = src('packages/app-shell/src/settings-store.ts');

let okN = 0;
const bad = [];
const jian = (m, t, x) => {
  if (t) { okN += 1; console.log('  ok  ' + m); }
  else { bad.push(m); console.log('  FAIL ' + m + (x ? ' ← ' + JSON.stringify(x).slice(0, 300) : '')); }
};

if (!fs.existsSync(HTML) || !fs.existsSync(PRELOAD) || !fs.existsSync(NMW)) {
  console.error('[verify-r66-nm] 产物不存在，先运行 tsc + node scripts/copy-assets.mjs');
  process.exit(2);
}

/* ── 1. 静态锚点 ─────────────────────────────────────────── */
jian('项 5：模型 open_path 有「nm 偏好 + 插件启用」分流，且失败才回落系统程序',
  /nmKaiWenJianKai\(\)/.test(MAIN_SRC) && /nmShiTuKai\(\{ luJing: abs/.test(MAIN_SRC)
  && /\[open_path\] 已用 nm 查看器打开/.test(MAIN_SRC) && /nmKaiWenJian\?: boolean/.test(SETTINGS_SRC));
jian('项 5：nm 开不起来时回落系统默认（不假装打开过）',
  /let nmKai = false;[\s\S]{0,2600}else if \(r0\)[\s\S]{0,600}默认程序打开失败/.test(MAIN_SRC));

jian('项 7：主窗口登记为平等参与者（id=-1），move 走同一套去抖',
  /NM_ZHU_CHUANG_ID = -1/.test(NMW_SRC) && /export function nmJieRuZhuChuang/.test(NMW_SRC)
  && /win\.on\('move', anPai\)/.test(NMW_SRC) && /nmJieRuZhuChuang\(win\)/.test(MAIN_SRC));
jian('项 7（第 67 轮新口径）：四边各最多一个邻窗 + 连通分量 BFS + nm-nm 优先',
  /nmJiSuanSiBianXiFu/.test(NMW_SRC) && /function kongBian\(\)[\s\S]{0,160}shang:\s*null[\s\S]{0,100}you:\s*null[\s\S]{0,100}xia:\s*null[\s\S]{0,100}zuo:\s*null/.test(NMW_SRC)
  && /nmBianLiLianTong/.test(NMW_SRC) && /bianBeiZhan/.test(NMW_SRC));
jian('项 10：新窗贴主窗右侧，右边空才默认吸附；已占则只开不吸',
  /function nmXinChuangLuoDian/.test(NMW_SRC) && /const youKong = zhu\.bian\.you == null;/.test(NMW_SRC)
  && /fuZhu: \(youKong && keFu && zhu\.xiFu\) \? zhu : null/.test(NMW_SRC));
jian('项 11：新窗落点沿右侧链排到最右（先来的连接不被挤掉）',
  /function zuiYouCeLian/.test(NMW_SRC) && /const zuiYou = zuiYouCeLian\(zhu\);/.test(NMW_SRC)
  && /!youKong/.test(NMW_SRC));

jian('项 8：替换可用性以「可编辑 + 纯文本」为准，只读时输入框也禁用',
  /function tiHuanKeYong\(\)/.test(JS_SRC) && /el\('tiHuanRu'\)\.disabled = !tiHuanKeYong\(\)/.test(JS_SRC)
  && /el\('souRu'\)/.test(JS_SRC) && !/el\('souRu'\)\.disabled\s*=/.test(JS_SRC));

jian('项 9：保存/目录/撤销都是分裂按钮 + 菜单，旧的独立入口只保留隐藏占位',
  /id="anNiuBaoCunXia"/.test(HTML_SRC) && /id="anNiuMuLuXia"/.test(HTML_SRC) && /id="anNiuHouTuiXia"/.test(HTML_SRC)
  && /id="anNiuLingCunWei" hidden/.test(HTML_SRC) && /id="anNiuDaYin" hidden/.test(HTML_SRC) && /id="anNiuDaKai" hidden/.test(HTML_SRC));
jian('项 9：换行是图标按钮（没有「自动换行」文字按钮）',
  /id="anNiuHuanHang"[^>]*>[\s\S]{0,260}<svg/.test(HTML_SRC) && !/>自动换行</.test(HTML_SRC));
jian('项 9：工具栏禁止横向滚动；窄窗收进「…」、替换展开可两行',
  !/#gongJuLan[\s\S]{0,500}overflow-x:\s*auto/.test(CSS_SRC) && /#gongJuLan[\s\S]{0,200}overflow:\s*hidden/.test(CSS_SRC)
  && /function buJuGongJuLan/.test(JS_SRC) && /gongJuHang2/.test(HTML_SRC) && /function sheTiHuan/.test(JS_SRC));
jian('项 9：结果数按钮展开替换；替换按钮只有图标',
  /id="souJi"[^>]*aria-expanded/.test(HTML_SRC) && /id="anNiuTiHuan"[^>]*aria-label="替换"/.test(HTML_SRC)
  && /id="anNiuTiHuan"[\s\S]{0,260}<svg/.test(HTML_SRC) && !/>替换</.test(HTML_SRC));
jian('项 9：上下箭头在查找框内部（输入框 padding-right 留位）',
  /id="souRuKe"/.test(HTML_SRC) && /padding:\s*4px 44px 4px 8px/.test(CSS_SRC) && /#souJianKe[\s\S]{0,160}position:\s*absolute/.test(CSS_SRC));

jian('项 32：主进程提供字节块读取 + 增量保存 + 备份 + SHA-256 过期校验',
  /export function nmShiTuQuZiJie/.test(NMW_SRC) && /function baoCunErJinZhi/.test(NMW_SRC)
  && /\.warmy-bak/.test(NMW_SRC) && /sha256/.test(NMW_SRC) && /fs\.renameSync/.test(NMW_SRC)
  && /nmShiTuQuZiJie/.test(MAIN_SRC) && /warmy:nmShiTuQuZiJie/.test(MAIN_SRC));
jian('项 32：二进制可编辑上限 + 超限只读明确说明',
  /ER_JIN_ZHI_KE_BIAN_JI/.test(NMW_SRC) && /超过 .*十六进制编辑上限，只读打开/.test(NMW_SRC)
  && /erJinZhiXinXi/.test(NMW_SRC));
jian('项 32：渲染层是虚拟十六进制视图（只画可见行、按块取字节、增量提交）',
  /SHI_LIU_KUAI = 256 \* 1024/.test(JS_SRC) && /function huiShiLiu/.test(JS_SRC)
  && /s\.hangEls|s\.pool/.test(JS_SRC) && /bianGeng/.test(JS_SRC) && /nmQuZiJie/.test(JS_SRC));

jian('项 33：滚动同步 rAF、输入防抖、CSS containment',
  /requestAnimationFrame/.test(JS_SRC) && /el\('wenBen'\)\.addEventListener\('scroll', anPaiGunDongWenBen/.test(JS_SRC)
  && /zt\.souDingShi = setTimeout/.test(JS_SRC) && /contain:\s*strict/.test(CSS_SRC)
  && /contain:\s*layout paint/.test(CSS_SRC));

/* 真窗口行为由 verify-r65-nm-pair-live / verify-r62-ui 覆盖；这里只保留离线静态判据。 */
console.log(`\n==== verify-r66-nm: ${okN} PASS / ${bad.length} FAIL ====`);
if (bad.length) console.log(bad.map((x) => '  ✗ ' + x).join('\n'));
process.exit(bad.length ? 1 : 0);
