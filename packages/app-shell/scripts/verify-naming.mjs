/**
 * 变量/常量/协议命名规范门禁（交接给其他开发者/AI 时必须可断言）。
 *
 * 规范摘要（详见 docs/TECHNICAL.md §命名规范）：
 *  1. 用户可见品牌：WArmy / 无限牛马 / 無限社畜 / 무한 사축；禁 CCArmy、Corporate Cattle
 *  2. 代码与环境变量前缀：WARMY_（SCREAMING_SNAKE_CASE）
 *  3. IPC 通道：warmy: + kebab-case
 *  4. 线协议常量 CCARMY-*：**禁止改名**（破坏性协议变更，见 ADR）
 *  5. 旧环境变量仅允许 legacy 回退读取：CCARM_NODE、CCA_ARMY_MEMORY_DIR
 *  6. 端口常量必须为 WARMY_DEFAULT/DEV/TEST_NET_PORT + WARMY_SUGGESTED_NET_PORTS
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(selfDir, '..', '..', '..');
let pass = 0, fail = 0;
function check(l, ok, d) {
  if (ok) { pass++; console.log('  ok  ' + l); }
  else { fail++; console.log('  FAIL ' + l, d ?? ''); }
}

function walk(dir, acc = []) {
  for (const ming of fs.readdirSync(dir)) {
    if (ming === 'node_modules' || ming === 'dist' || ming === '.git' || ming === 'coverage') continue;
    const p = path.join(dir, ming);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/\.(ts|js|cjs|mjs)$/.test(ming)) acc.push(p);
  }
  return acc;
}

const files = walk(path.join(ROOT, 'packages'));
const offenders = { brand: [], portConst: [], ipc: [], envNewLegacy: [] };

// 允许出现旧名的位置（仅 legacy 回退 / 协议 / 校验脚本自身）
const LEGACY_ALLOW = [
  /CCARM_NODE/, // env legacy fallback
  /CCA_ARMY_MEMORY_DIR/,
  /CCARMY-/, // wire protocol markers — must stay
  /verify-docs\.mjs/,
  /ui-inspect-round\.mjs/,
  /verify-naming\.mjs/,
];

for (const f of files) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  const src = fs.readFileSync(f, 'utf8');
  // 1) 产品品牌残留（代码/脚本注释里也不应把产品叫 CCArmy）
  if (/CCArmy|Corporate Cattle|Corporate Catle/i.test(src) && !LEGACY_ALLOW.some((re) => re.test(rel + src.slice(0, 200)) || /verify-docs|ui-inspect|verify-naming/.test(rel))) {
    // allow verify scripts that assert absence
    if (!/verify-|ui-inspect/.test(rel)) offenders.brand.push(rel);
  }
  // 2) 端口常量必须 WARMY_*
  const badPort = src.match(/\b(CCAARMY_|CCARMY_|CCARM_)[A-Z_]*PORT[A-Z_]*\b/g);
  if (badPort) offenders.portConst.push(`${rel}: ${badPort.join(',')}`);
  // 3) IPC 通道必须 warmy:
  const badIpc = src.match(/\b(ipcMain\.(handle|qiYong)|ipcRenderer\.(invoke|qiYong)|chuliIpc)\(\s*['"](?!warmy:)[a-z0-9:-]+['"]/g);
  if (badIpc && !/node_modules/.test(rel)) offenders.ipc.push(`${rel}: ${badIpc.slice(0, 3).join(' | ')}`);
  // 4) 新代码禁止再引入 CCAARMY_* 环境变量名（legacy 读取除外）
  const badEnv = src.match(/process\.env\[['"]CCAARMY_[^'"]+['"]\]|process\.env\.CCAARMY_[A-Z_]+/g);
  if (badEnv) offenders.envNewLegacy.push(`${rel}: ${badEnv.join(',')}`);
}

check('no CCArmy brand tokens in package sources', offenders.brand.length === 0, offenders.brand.slice(0, 5));
check('no old *PORT constants (must be WARMY_*)', offenders.portConst.length === 0, offenders.portConst.slice(0, 5));
check('IPC handlers use warmy: prefix', offenders.ipc.length === 0, offenders.ipc.slice(0, 5));
check('no new CCAARMY_* env reads', offenders.envNewLegacy.length === 0, offenders.envNewLegacy.slice(0, 5));

// 正向：规范常量必须存在
const settings = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/settings-store.ts'), 'utf8');
check('WARMY_DEFAULT_NET_PORT defined', /export const WARMY_DEFAULT_NET_PORT = 59599/.test(settings));
check('WARMY_DEV_NET_PORT defined', /export const WARMY_DEV_NET_PORT = 58588/.test(settings));
check('WARMY_TEST_NET_PORT defined', /export const WARMY_TEST_NET_PORT = 62666/.test(settings));
check('WARMY_SUGGESTED_NET_PORTS defined', /export const WARMY_SUGGESTED_NET_PORTS/.test(settings));
check('no WARMY_PORT_FALLBACK (silent port switch banned)', !/WARMY_PORT_FALLBACK|PORT_FALLBACK_CHAIN/.test(settings));

const main = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/electron-main.ts'), 'utf8');
check('legacy env only as fallback', /WARMY_NODE.*CCARM_NODE|process\.env\['WARMY_NODE'\].*CCARM_NODE/.test(main));
check('memory env prefers WARMY_MEMORY_DIR', /WARMY_MEMORY_DIR/.test(fs.readFileSync(path.join(ROOT, 'packages/memory-os/src/ipc.ts'), 'utf8')));

const tech = path.join(ROOT, 'docs/TECHNICAL.md');
const req = path.join(ROOT, 'docs/REQUIREMENTS.md');
check('TECHNICAL.md exists', fs.existsSync(tech));
check('REQUIREMENTS.md exists', fs.existsSync(req));
if (fs.existsSync(tech)) {
  const t = fs.readFileSync(tech, 'utf8');
  check('TECHNICAL documents naming rules', /WARMY_|命名规范|CCARMY|kebab-case/.test(t));
  check('TECHNICAL documents project philosophy', /理念|目标|注入上下文|JSONL/.test(t));
  check('TECHNICAL documents variable/env convention', /WARMY_MEMORY_DIR|WARMY_DEFAULT_NET_PORT|WARMY_UPDATE_FEED_URL/.test(t));
}
if (fs.existsSync(req)) {
  const r = fs.readFileSync(req, 'utf8');
  check('REQUIREMENTS documents chanPin goals', /产品定位|核心承诺|功能需求/.test(r));
  check('REQUIREMENTS documents security modes', /完全授权|常规模式|严格模式/.test(r));
  check('REQUIREMENTS documents ports/update/WSL', /59599|GitHub|WSL/.test(r));
}

/* ── 命名规范（全拼 + 三级重名兜底 + 明确哪些不改）必须写在技术文档里 ── */
if (fs.existsSync(tech)) {
  const t = fs.readFileSync(tech, 'utf8');
  check('TECHNICAL: pinyin naming rule present', /全拼/.test(t) && /汉语拼音/.test(t));
  check('TECHNICAL: three-level collision ladder documented',
    /全拼_作用域_英文名/.test(t) && /所有重名者/.test(t));
  check('TECHNICAL: additive requirements stated (not conflicting with pinyin)',
    /追加要求/.test(t) && /不与"全拼"冲突|不与全拼冲突/.test(t));
  check('TECHNICAL: forbidden-to-rename list present',
    /IPC 通道名/.test(t) && /i18n 键/.test(t) && /线协议标记/.test(t));
}
const mapFile = path.join(ROOT, 'docs/PINYIN-MAP.json');
check('PINYIN-MAP.json exists', fs.existsSync(mapFile));
if (fs.existsSync(mapFile)) {
  const m = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  check('PINYIN-MAP declares collision ladder',
    Array.isArray(m._collision_ladder) && m._collision_ladder.length === 3);
  check('PINYIN-MAP has global + local scopes', !!m.global && !!m.local);
}

// renderer shuRuQu：输入框与按钮之间不得有分隔线
const rcss = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/renderer.css'), 'utf8');
const acss = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/app.css'), 'utf8');
check('renderer.css #shuRu has no border (no separator line)', /#shuRu\s*\{[^}]*border:\s*none/i.test(rcss) || /border:\s*none\s*!important/.test(rcss));
check('renderer.css shuRuQuTiao has no border', /\.shuRuQuTiao\s*\{[^}]*border:\s*none/i.test(rcss.replace(/\n/g, ' ')) || /shuRuQuTiao[\s\S]{0,200}border:\s*none/i.test(rcss));
check('app.css #shuRu min-height increased', /min-height:\s*96px/.test(acss));
check('index.html loads both app.css and renderer.css', (() => {
  const html = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/index.html'), 'utf8');
  return (/app\.css/.test(html) || /yingYong\.css/.test(html)) && /renderer\.css/.test(html);
})());

/* ── CSS 大括号平衡（曾经漏掉一段导致后续规则被解析器丢弃：真机 UI 才看得出） ──
   任何一次 `{`/`}` 不平衡都会让**后面的规则整段失效**，静态 grep 查不出来。 */
for (const f of ['app.css', 'renderer.css']) {
  const css = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer', f), 'utf8');
  const daKai = (css.match(/\{/g) || []).length;
  const close = (css.match(/\}/g) || []).length;
  check(`${f} braces balanced (${daKai}/${close})`, daKai === close, { daKai, close });
}

/* ── 关键 UI 契约：横幅在文档流内（不得 absolute 覆盖聊天区） ── */
check('wangLuoBanner is in flow (not absolute overlay)',
  /\.wangLuoBanner\s*\{[^}]*position:\s*relative/.test(acss) && !/\.wangLuoBanner\s*\{[^}]*position:\s*absolute/.test(acss));

/* ── 右栏分区唯一权威 + 会话卡片默认隐藏 ── */
const idxHtml = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/index.html'), 'utf8');
check('panel members block yinCang by default', /id="mianBanChengYuanJiKuai"[^>]*class="[^"]*yinCang|class="mianBanKuai onlyQun yinCang"[^>]*id="mianBanChengYuanJiKuai"/.test(idxHtml));
check('panel jinDu/assist/model default yinCang',
  /class="mianBanKuai yinCang" id="mianBanJinDuKuai"/.test(idxHtml) &&
  /class="mianBanKuai yinCang" id="mianBanAssistKuai"/.test(idxHtml) &&
  /class="mianBanKuai yinCang" id="mianBanMoXingMgrKuai"/.test(idxHtml));
const appjs2 = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/app.js'), 'utf8');
check('applyPanelVisibility exists and is authoritative', /function applyPanelVisibility/.test(appjs2));
check('refreshPanelVisibility called qiYong nav change', /hideMain\(\);[\s\S]{0,200}refreshPanelVisibility\(\)/.test(appjs2));
check('panelVisibilityFor: members only group kinds',
  /members:\s*group/.test(appjs2) && /const group = kind === 'internal' \|\| kind === 'external' \|\| kind === 'externalGroup' \|\| kind === 'extgroup'/.test(appjs2));

/* ── 子进程一律隐藏控制台窗口（Windows 上否则会往桌面堆窗口） ──
 * 用户实测：桌面上堆积了大量无用的控制台窗口 —— 根因是 spawn/execFile 没有
 * `windowsHide: true`：每派生子进程就多一个控制台窗口，杀掉进程后窗口仍留在桌面上。
 * 这是**静态可查**的约定，所以放进本门禁：新写子进程调用忘了加就红。 */
const spawnFiles = [];
(function walkSrc(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['node_modules', 'dist', 'vendor'].includes(e.name)) walkSrc(p); continue; }
    if (/\.(ts|js|mjs|cjs)$/.test(e.name)) spawnFiles.push(p);
  }
})(path.join(ROOT, 'packages/app-shell/src'));
const consoleOffenders = [];
for (const f of spawnFiles) {
  const src = fs.readFileSync(f, 'utf8');
  // 只看真正的子进程调用：spawn( / execFile( / execSync?（不含正则 .exec(）
  const rx = /(?:^|[^.\w])(spawn|execFile|execFileSync|spawnSync)\s*\(/g;
  let m;
  while ((m = rx.exec(src))) {
    const lineStart = src.lastIndexOf('\n', m.index) + 1;
    const line = src.slice(lineStart, src.indexOf('\n', m.index) < 0 ? src.length : src.indexOf('\n', m.index));
    // 跳过**方法声明**（例如 runtime 里自己的 `async spawn(opts)`）：那不是子进程调用
    if (/^\s*(?:async\s+)?(?:public\s+|private\s+|protected\s+|static\s+)*spawn\s*\(/.test(line)) continue;
    // 取该调用到下一个空行前的片段，判断有没有 windowsHide
    const seg = src.slice(m.index, m.index + 1200);
    if (!/windowsHide/.test(seg)) {
      consoleOffenders.push(`${path.relative(ROOT, f)}:${src.slice(0, m.index).split('\n').length}`);
    }
  }
}
check(`所有子进程调用都隐藏了控制台窗口（发现 ${consoleOffenders.length} 处未隐藏）`,
  consoleOffenders.length === 0, consoleOffenders.slice(0, 6));

/* ── 任务栏/托盘图标必须有**白底版**，且只有这两处用它 ── */
{
  const iconDir = path.join(ROOT, 'packages/app-shell/src/renderer/icons');
  const need = ['app-white.ico', 'app-white-256.png', 'app-white-64.png', 'app-white-16.png'];
  const missing = need.filter((n) => !fs.existsSync(path.join(iconDir, n)));
  check(`白底图标资产齐备（${need.length} 个，缺 ${missing.length}）`, missing.length === 0, missing);
  const mainSrc = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/electron-main.ts'), 'utf8');
  check('任务栏窗口与系统托盘用白底图标（warmyTaskbarIcon 用在 createWindow / 独立窗 / createTray）',
    /warmyTaskbarIcon\(\)/.test(mainSrc) && (mainSrc.match(/warmyTaskbarIcon\(\)/g) || []).length >= 3);
  // 其它地方（渲染层 logo / 标题栏 / 我的页 / 关于页）**不许**换成白底版
  const appjsIcons = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/app.js'), 'utf8');
  check('渲染层的 logo 不被换成白底版（只有任务栏/托盘用白底）', !/app-white/i.test(appjsIcons));
  check('独立窗的任务栏头像图标也合成白底（chatAvatarDataUrl 里先铺白底）',
    /puBaiDi\(\)/.test(appjsIcons) && /fillStyle = '#ffffff'/.test(appjsIcons));
}

/* ── 跨窗口联动：只刷"当前正在看的实体"，否则会把另一个会话的界面串台 ── */
{
  const appJs2 = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/app.js'), 'utf8');
  check('跨窗口刷新必须校验当前会话（refreshEntityView 带一致性守卫）',
    /async function refreshEntityView[\s\S]{0,600}shiDangQian/.test(appJs2), '跨窗口刷新必须校验当前会话');
  check('列表头像 class 未被改名破坏（仍是 avTuPian）',
    /class="avTuPian"/.test(appJs2) && !/av-tuPian/.test(appJs2), 'class 名还原检查');
}

/* ── WSL：例行路径绝不为了探测而启动它（用户两次反馈"开新窗口触发打开 WSL"） ── */
{
  const probeSrc = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/container-probe.ts'), 'utf8');
  const mainSrc2 = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/electron-main.ts'), 'utf8');
  check('例行探测默认静默：probeWsl 在 !deep 时不 spawn 任何 wsl.exe',
    /async function tanCeWsl[\s\S]{0,900}status: 'not-probed'/.test(probeSrc) && /wsl-not-probed/.test(probeSrc), '例行探测默认静默');
  check('项目状态查询不传 deep（不会启动 WSL）',
    /tanCeRongQiYunXing\(\{ cacheMs: 8000, only: \[runtimeId\] \}\)/.test(mainSrc2) && !/tanCeRongQiYunXing\(\{ cacheMs: 8000, only: \[runtimeId\], deep/.test(mainSrc2), '项目状态查询不传 deep');
  check('显式探测（容器卡片按钮）才允许 deep',
    /warmy:rongQiTanCe/.test(mainSrc2) && /opts\?\.deep === true/.test(mainSrc2), '显式探测才允许 deep');
}

console.log(`\n==== verify-naming: ${pass} ok / ${fail} FAIL ====`);
process.exit(fail === 0 ? 0 : 1);
