/**
 * 发布准备（只做检查与可选暂存，不发布）
 *
 * 用户口径（第 122 轮）：
 *  · 只发布项目代码等必要内容；配置/测试/交接文档等非必要文件不发布；
 *  · 必须发布的非必要文件只有 `说明.md`、`LICENSE`、`SPONSORS.md`；
 *  · 除代码注释与这三个文件外，其余发布文件必须全英文
 *    （代码引用/变量/项目必须的非英文内容，如 i18n 语言包，除外）。
 *
 * 用法：
 *   node scripts/prepare-publish.mjs            # 只审计，打印统计与问题
 *   node scripts/prepare-publish.mjs --stage    # 审计通过后复制到 _publish/WArmy
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAGE = path.resolve(ROOT, '..', '_publish', 'WArmy');
const stageMode = process.argv.includes('--stage');

const ALLOW_FILES = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.json',
  'tsconfig.base.json',
  '.gitignore',
  'LICENSE',
  '说明.md',
  'SPONSORS.md',
  'README.md',
]);
const ALLOW_DIRS = ['packages'];
/** 构建必需的包内脚本（不是测试/校验）：app-shell 的 build 直接调用这两个文件 */
const EXTRA_FILES = [
  'packages/app-shell/scripts/check-syntax.mjs',
  'packages/app-shell/scripts/copy-assets.mjs',
  'docs/screenshots/readme-first-run.png',
  'sponsors/wxd.png',
  'sponsors/zfbd.png',
];
const SKIP_DIR_NAMES = new Set(['node_modules', 'dist', 'release', 'release-r122', 'dev', 'docs', 'scripts', '.git', '.tmp', 'feed', 'trash', 'backup']);const SKIP_EXT = /\.(log|lock|tmp|bak|sqlite|db|exe|dll|node|zip|7z|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|mp3|wav|webm|mp4)$/i;
const ZH_OK_FILES = new Set(['说明.md', 'LICENSE', 'SPONSORS.md']);
const I18N_OK = /packages\/app-shell\/src\/i18n\/.*\.json$/;

const CODE_EXT = /\.(ts|tsx|js|mjs|cjs|css|html|json|jsonl)$/i;
const TEXT_EXT = /\.(md|txt|yml|yaml|json|ts|tsx|js|mjs|cjs|css|html|sh)$/i;

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.tmp')) continue;
    if (ent.name === 'README.md') continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (SKIP_DIR_NAMES.has(ent.name)) continue;
      if (ent.name === 'release' || ent.name === 'release-r122') continue;
      walk(p, out);
    } else {
      if (SKIP_EXT.test(ent.name)) continue;
      out.push(p);
    }
  }
  return out;
}

const all = [];
for (const f of ALLOW_FILES) if (fs.existsSync(path.join(ROOT, f))) all.push(path.join(ROOT, f));
for (const d of ALLOW_DIRS) {
  const p = path.join(ROOT, d);
  if (fs.existsSync(p)) walk(p, all);
}
for (const f of EXTRA_FILES) {
  const p = path.join(ROOT, f);
  if (fs.existsSync(p) && !all.includes(p)) all.push(p);
}
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

const cjk = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/;
const secretPats = [
  [/sk-[A-Za-z0-9]{20,}/, 'openai-like-key'],
  [/tp-[A-Za-z0-9_-]{16,}/, 'token-plan-key'],
  [/ghp_[A-Za-z0-9]{20,}/, 'github-token'],
  [/AKIA[0-9A-Z]{16}/, 'aws-key'],
  [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'private-key'],
  [/C:\\Users\\(?!<|[\u4e00-\u9fff])[A-Za-z0-9._-]+/i, 'local-user-path'],
  [/\b192\.168\.\d{1,3}\.\d{1,3}\b/, 'private-ip'],
  [/\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, 'private-ip'],
  [/\b103\.140\.228\.207\b/, 'test-host-ip'],
  [/\b144\.168\.59\.11\b/, 'test-host-ip'],
  [/\bWIN-[A-Z0-9]{10,}\b/, 'test-host-name'],
  [/\b232307860@qq\.com\b/i, 'personal-email'],
];

const langIssues = [];
const secretIssues = [];
let checkedLang = 0;
let checkedSecret = 0;
for (const p of all) {
  const r = rel(p);
  let text = '';
  try {
    const b = fs.readFileSync(p);
    if (b.length > 4 * 1024 * 1024) continue;
    text = b.toString('utf8');
  } catch {
    continue;
  }
  checkedSecret += 1;
  for (const [re, name] of secretPats) {
    if (re instanceof RegExp && re.test(text)) secretIssues.push(`${r}: ${name}`);
  }
  if (!TEXT_EXT.test(p)) continue;
  const isCode = CODE_EXT.test(p) && !/\.json$/i.test(p);
  if (isCode) continue;
  if (ZH_OK_FILES.has(path.basename(p)) || I18N_OK.test(r)) continue;
  checkedLang += 1;
  const langTextRaw = /\.(yml|yaml)$/i.test(p) ? text.split('\n').map((l) => l.replace(/#.*$/, '')).join('\n') : text;
  /** README 只允许品牌名、中文说明文件名、各语言的自称（这些是项目必须的非英文内容） */
  const langText = r === 'README.md'
    ? langTextRaw.replace(/无限牛马|说明\.md|简体中文|繁體中文|日本語|한국어|语言/g, '')
    : langTextRaw;
  if (cjk.test(langText)) langIssues.push(r);
}

console.log(`允许清单文件数：${all.length}`);
console.log(`英文审计（非代码、非例外）：${checkedLang} 个文件，含非英文：${langIssues.length}`);
for (const x of langIssues.slice(0, 40)) console.log('  LANG ' + x);
console.log(`秘密/本机信息扫描：${checkedSecret} 个文件，命中：${secretIssues.length}`);
for (const x of secretIssues.slice(0, 40)) console.log('  SECRET ' + x);
console.log('\n清单样例（前 25）：');
for (const p of all.slice(0, 25)) console.log('  ' + rel(p));
console.log(`\n合计待发布 ${all.length} 个文件；目标目录 ${STAGE}`);

const bad = langIssues.length + secretIssues.length;
if (bad) {
  console.log(`\n未通过：${bad} 处需要处理（本轮不复制、不发布）`);
  process.exit(1);
}
if (stageMode) {
  fs.rmSync(STAGE, { recursive: true, force: true });
  for (const p of all) {
    const dst = path.join(STAGE, rel(p));
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(p, dst);
  }
  console.log(`\n已暂存到 ${STAGE}（未发布）`);
} else {
  console.log('\n审计通过（未暂存；加 --stage 才会复制）');
}
