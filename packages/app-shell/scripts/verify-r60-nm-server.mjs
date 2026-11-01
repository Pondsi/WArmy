/**
 * verify-r60-nm-server.mjs（fast 档）—— 第 60 轮：
 *  ① nm 查看器：打开/自动保存/所在目录/文件名+完整路径/吸附与置顶在标题栏、后退前进记内容快照、查找+替换的可用条件；
 *  ② 中转服务器独立成项目（fwarmy/，第 64 轮由 relay-server/ 改名）且带在线心跳；
 *  ③ 群/项目创建者离线一律只读（不排队）。
 * 第 62 轮补：正文区必须铺满整个内容高度（媒体区 hidden 时不许占位）、主界面吸附与 nm 同图标同语义、服务器管理页可视化配置。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const HTML = rd('packages/app-shell/src/renderer/nm-viewer.html');
const JS = rd('packages/app-shell/src/renderer/nm-viewer.js');
const CSS = rd('packages/app-shell/src/renderer/nm-viewer.css');
const PRE = rd('packages/app-shell/src/preload.cjs');
const MAIN = rd('packages/app-shell/src/electron-main.ts');
const QUN = rd('packages/app-shell/src/qun-xiao-xi-rixi.ts');
const ZHU = rd('packages/app-shell/src/renderer/index.html');
const APP = rd('packages/app-shell/src/renderer/app.js');
const { FWARMY_ROOT, fwRead } = await import(pathToFileURL(path.join(ROOT, 'packages/app-shell/scripts/fwarmy-loc.mjs')).href);
const SRV = fwRead('server.mjs');
const ADMIN = fwRead('admin.html');
const CTL = fwRead('ctl.mjs');

let okN = 0, failN = 0;
const jian = (l, p, d) => { if (p) { okN++; console.log('  ok  ' + l); } else { failN++; console.log('  FAIL ' + l + (d ? ' ← ' + String(d).slice(0, 150) : '')); } };

// ── nm 查看器 ─────────────────────────────────────────────
jian('工具栏右侧有「打开」（选文件后在新窗口打开）',
  /id="anNiuDaKai"/.test(HTML) && /nmDaKai/.test(JS) && /chuliIpc\('warmy:nmDaKai'/.test(MAIN) && /nmDaKai: \(\) => ipcRenderer\.invoke\('warmy:nmDaKai'\)/.test(PRE));
jian('顶部显示文件名 + 完整路径（压缩包/网页显示包内路径或 URL）', /id="wenJianLuJing"/.test(HTML) && /el\('wenJianMing'\)\.textContent = .*ming/.test(JS) && /el\('wenJianLuJing'\)\.textContent = lu/.test(JS) && /zt\.yaSuoBao\.luJing|ka\.url/.test(JS));
jian('标题栏顺序：吸附 → 置顶 → 最小化（与主界面一致）',
  HTML.indexOf('id="anNiuXiFu"') < HTML.indexOf('id="anNiuZongShiDing"') && HTML.indexOf('id="anNiuZongShiDing"') < HTML.indexOf('id="anNiuZuiXiao"'));
/**
 * 第 65 轮 项 25：图标不再用 `<img src>`（固定黑色，深色主题下看不见），改成 CSS mask + currentColor；
 * 形状仍是用户给的那枚 ruo-ci-tie.svg。两种实现都算，但必须真的引用同一枚图。
 */
jian('吸附图标用用户给的那枚（ruo-ci-tie.svg；第 65 轮起走 currentColor mask）',
  /ruo-ci-tie\.svg/.test(JS) || /#xiFuTu[\s\S]{0,220}mask:\s*url\(['"]?\.\/icons\/ruo-ci-tie\.svg/.test(CSS)
  && fs.existsSync(path.join(ROOT, 'packages/app-shell/src/renderer/icons/ruo-ci-tie.svg')),
  { js: /ruo-ci-tie\.svg/.test(JS), cssMask: /#xiFuTu[\s\S]{0,220}mask:\s*url\(['"]?\.\/icons\/ruo-ci-tie\.svg/.test(CSS) });
jian('自动保存（停手 2 秒）+ 打开文件所在目录',
  /id="gouZiDongBaoCun"/.test(HTML) && /2000\)/.test(JS) && /nmSuoZaiMuLu/.test(JS) && /chuliIpc\('warmy:nmSuoZaiMuLu'/.test(MAIN) && /showItemInFolder/.test(MAIN));
jian('后退/前进记的是**内容快照**（改内容后可后退、后退后可前进）',
  /\{ lu, wen: String\(wen \?\? ''\) \}/.test(JS) && /async function huiFu\(wei\)/.test(JS) && /liShiWei \+= 1;[\s\S]{0,80}huiFu\(liShiWei\)/.test(JS));
jian('编辑也会压入历史（防抖 600ms）', /yiXiuGai\.lishi = setTimeout\(\(\) => \{ tuiRuLiShi\(zt\.luJing, el\('wenBen'\)\.value\); \}, 600\)/.test(JS));
jian('替换按钮：搜索框有内容 + 至少一个结果 + 可编辑才可用',
  /id="anNiuTiHuan"/.test(HTML) && /const nengTiHuan = !!zt\.souCi && zong > 0 && tiHuanKeYong\(\)/.test(JS)
  && /anNiuTiHuan'\)\.disabled = !nengTiHuan/.test(JS));
jian('替换会触发历史（可后退回替换前）', /function tiHuanDangQian[\s\S]{0,500}tuiRuLiShi\(zt\.luJing, ta\.value\)/.test(JS));
jian('窗口按钮不再带箭头（"后退/前进"文字）', !/← 后退|前进 →/.test(HTML));
jian('正文区铺满内容高度（媒体区 hidden 时不许占下半屏）',
  /\[hidden\]\s*\{\s*display:\s*none\s*!important\s*;?\s*\}/.test(CSS)
  && /#meiTiLie:not\(\[hidden\]\)\s*\{\s*display:\s*flex/.test(CSS)
  && !/#meiTiLie\s*\{[^}]*display:\s*flex/.test(CSS)
  && ['#juanCuo', '#kuaiLie', '#meiTiLie'].every((s) => new RegExp(s.replace('#', '\\#') + '\\s*\\{[^}]*flex:\\s*1 1 0').test(CSS)));

// ── 主界面吸附：与 nm 同图标、同语义 ─────────────────────
const TIE_SVG = rd('packages/app-shell/src/renderer/icons/ruo-ci-tie.svg');
const TIE_PATH = (/\sd="([^"]+)"/.exec(TIE_SVG) || [])[1] || '';
const ZHU_XI_FU_AT = ZHU.indexOf('id="anNiuZhuXiFu"');
const ZHU_XI_FU_BLOCK = ZHU_XI_FU_AT >= 0 ? ZHU.slice(ZHU_XI_FU_AT, ZHU_XI_FU_AT + 2000) : '';
/** 主界面可以直接引用 svg 文件，也可以内联同一枚 path（当前实现是内联）；两种都算“同一枚图标”。 */
const zhuXiFuTongYiTu = ZHU_XI_FU_BLOCK.includes('ruo-ci-tie.svg') || (!!TIE_PATH && ZHU_XI_FU_BLOCK.includes(TIE_PATH));
jian('主界面标题栏有吸附按钮，且用 nm 同一枚图标（在置顶左侧）',
  zhuXiFuTongYiTu && ZHU_XI_FU_AT < ZHU.indexOf('id="anNiuZongShiDing"'));
jian('主界面吸附真的接线：IPC + 拖动时贴屏幕边缘',
  /zhuXiFu: \(kai\) => ipcRenderer\.invoke\('warmy:zhuXiFu'/.test(PRE)
  && /chuliIpc\('warmy:zhuXiFu'/.test(MAIN)
  && /function tieBianZhuChuang/.test(MAIN)
  && /win\.on\('move', \(\) => \{[\s\S]{0,400}tieBianZhuChuang\(win\)/.test(MAIN)
  && /window\.warmy\.zhuXiFu\?\./.test(APP));

// ── 独立服务器项目 ────────────────────────────────────────
const S = FWARMY_ROOT;
jian('服务器独立成项目（server/ctl/package/README + 自包含管理页 + 三平台一键脚本）',
  ['server.mjs', 'admin.html', 'ctl.mjs', 'package.json', 'README.md', 'start.bat', 'start.sh', 'stop.bat', 'stop.sh', 'fwarmy-headless.bat', 'fwarmy-console.bat', 'build-sea.mjs', 'build-sea.sh'].every((f) => fs.existsSync(path.join(S, f))));
jian('服务器带在线心跳与批量查询', /\/api\/heartbeat/.test(fwRead('server.mjs')) && /\/api\/presence\/batch/.test(fwRead('server.mjs')));
jian('客户端有心跳/批量在线方法', /async xinTiao\(\)/.test(rd('packages/app-shell/src/zhong-ji-ke-hu.ts')) && /async piLiangZaiXian\(/.test(rd('packages/app-shell/src/zhong-ji-ke-hu.ts')));
jian('服务器仍不落盘消息（只写凭据/配置/统计）',
  !/(writeFile|appendFile|createWriteStream)[^;]*(queue|env)/i.test(fwRead('server.mjs')) && /credentials\.json/.test(fwRead('server.mjs')) && /stats\.json/.test(fwRead('server.mjs')));
jian('本机管理面不再要求密钥/登录（回环 + Host + 同源 + JSON 四道边界仍在）',
  /isAdminRequest/.test(SRV) && /isLocalHostHeader/.test(SRV) && /sec-fetch-site/.test(SRV) && !/x-admin-key/.test(SRV) && !/admin-key\.txt/.test(SRV));
jian('旧的 dev 副本已删除（不留两份服务器代码）', !fs.existsSync(path.join(ROOT, 'dev/server-prototype')));
/** 第 65 轮 项 1：暂停/恢复从配置区移到**顶部启停按钮**（toggleService），配置区不再有 cfgAccept */
jian('管理页可可视化改限流/开关并自动刷新（不用记命令）',
  /id=["']?cfgRate/.test(ADMIN) && /id=["']?cfgDaily/.test(ADMIN) && /id=["']?cfgEnv/.test(ADMIN) && /id=["']?cfgQueue/.test(ADMIN)
  && /id=["']?cfgTtl/.test(ADMIN) && /id=["']?toggleService/.test(ADMIN) && /saveCfg/.test(ADMIN) && /setInterval\(/.test(ADMIN));
jian('一键启动会打开管理页（ctl --open / start.bat / start.sh）',
  /openUrl\(/.test(CTL) && /--open/.test(CTL) && /start --open/.test(fwRead('start.bat')) && /start --open/.test(fwRead('start.sh')));
jian('服务器在线 TTL 真的用配置值（不是写死常量）', /zaiXianTtl = \(\) => Math\.max\(100, Number\(cfg\.presenceTtlMs\)/.test(SRV) && /\/api\/admin\/config/.test(SRV));
jian('测试不往仓库数据目录写凭据/配置（WARMY_RELAY_DATA 可指向临时目录）',
  /process\.env\.WARMY_RELAY_DATA/.test(SRV) && /WARMY_RELAY_DATA: shuJu/.test(rd('packages/app-shell/scripts/verify-r58-zhongji.mjs')) && fs.existsSync(path.join(S, '.gitignore')));

// ── 群/项目只读策略 ─────────────────────────────────────
jian('群/项目创建者离线 ⇒ 只读（不排队），联系人消息才走本地队列',
  /QUN_RUO_YI_ZHI_MO_REN = false/.test(QUN) && /return 'readonly';/.test(QUN) && /只有\*\*联系人\*\*的消息才留本机/.test(QUN));

console.log(`==== verify-r60-nm-server: ${okN} ok / ${failN} FAIL ====`);
process.exit(failN ? 1 : 0);
