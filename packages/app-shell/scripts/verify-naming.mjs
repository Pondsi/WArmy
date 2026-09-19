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
import { fileURLToPath } from 'node:url';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(selfDir, '..', '..', '..');
let pass = 0, fail = 0;
function check(l, ok, d) {
  if (ok) { pass++; console.log('  ok  ' + l); }
  else { fail++; console.log('  FAIL ' + l, d ?? ''); }
}

function walk(dir, acc = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.git' || name === 'coverage') continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/\.(ts|js|cjs|mjs)$/.test(name)) acc.push(p);
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
  const badIpc = src.match(/\b(ipcMain\.(handle|on)|ipcRenderer\.(invoke|on)|handleIpc)\(\s*['"](?!warmy:)[a-z0-9:-]+['"]/g);
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
  check('REQUIREMENTS documents product goals', /产品定位|核心承诺|功能需求/.test(r));
  check('REQUIREMENTS documents security modes', /完全授权|常规模式|严格模式/.test(r));
  check('REQUIREMENTS documents ports/update/WSL', /59599|GitHub|WSL/.test(r));
}

// renderer composer：输入框与按钮之间不得有分隔线
const rcss = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/renderer.css'), 'utf8');
const acss = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/app.css'), 'utf8');
check('renderer.css #input has no border (no separator line)', /#input\s*\{[^}]*border:\s*none/i.test(rcss) || /border:\s*none\s*!important/.test(rcss));
check('renderer.css composer-bar has no border', /\.composer-bar\s*\{[^}]*border:\s*none/i.test(rcss.replace(/\n/g, ' ')) || /composer-bar[\s\S]{0,200}border:\s*none/i.test(rcss));
check('app.css #input min-height increased', /min-height:\s*96px/.test(acss));
check('index.html loads both app.css and renderer.css', (() => {
  const html = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/index.html'), 'utf8');
  return /app\.css/.test(html) && /renderer\.css/.test(html);
})());

console.log(`\n==== verify-naming: ${pass} ok / ${fail} FAIL ====`);
process.exit(fail === 0 ? 0 : 1);
