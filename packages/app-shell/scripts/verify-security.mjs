#!/usr/bin/env node
/**
 * WArmy 安全/密钥门禁（可第三方复跑）。
 * 覆盖：密钥形态、隐私路径/主机名、模板插值、IPC/updater/node-fetch 不变量、危险 API。
 * 用法：node packages/app-shell/scripts/verify-security.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(selfDir, '..');
const root = path.resolve(pkgRoot, '..', '..');

let pass = 0, fail = 0;
const fails = [];
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS ' + label); }
  else { fail++; fails.push(label); console.log('  FAIL ' + label + (detail !== undefined ? ' => ' + String(detail).slice(0, 160) : '')); }
}

const SKIP = /node_modules|[/\\]\.git[/\\]|[/\\]release[/\\]|[/\\]dist[/\\]/;
const TEXT = new Set(['.ts', '.js', '.mjs', '.cjs', '.json', '.md', '.yml', '.yaml', '.txt', '.css', '.html', '.py', '.sh', '.ps1', '.bat', '.vbs']);
function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.test(p + '/')) yield* walk(p); continue; }
    if (TEXT.has(path.extname(e.name).toLowerCase()) && !SKIP.test(p)) yield p;
  }
}

const SECRET = [
  ['github-pat', /ghp_[A-Za-z0-9]{20,}/],
  ['github-oauth', /gho_[A-Za-z0-9]{20,}/],
  ['github-fp', /github_pat_[A-Za-z0-9_]{20,}/],
  ['openai-proj', /sk-proj-[A-Za-z0-9_-]{16,}/],
  ['openai-sk', /\bsk-[A-Za-z0-9]{20,}/],
  ['google', /AIza[0-9A-Za-z_-]{30,}/],
  ['aws', /AKIA[0-9A-Z]{16}/],
  ['slack', /xox[baprs]-[A-Za-z0-9-]{10,}/],
  ['jwt', /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----\s*\n[A-Za-z0-9+/=\s]{40,}/],
];
const FIXTURE = /repeat\(|'\w{5,}'\s*\+|TOKEN'|placeholder|example|fixture|假|测试|夹具|脱敏|正则|regex|scan|ghp_\$\{|'ghp_|"ghp_|sk-\$\{|'sk-|"sk-|never|永不/;

const PRIV = [
  ['user-home', /C:[/\\]Users[/\\](?!<user>|x|user|test|Public|Default|All Users)[A-Za-z0-9._-]+[/\\]/],
  ['hostname', /DESKTOP-[A-Z0-9]*\d[A-Z0-9]*/],
  ['secret-file', /秘钥\.txt|令牌\.txt|api-key\.txt|apikey\.txt/i],
  ['abs-temp-user', /C:[/\\]Users[/\\]p[/\\]/],
  ['cn-workspace', /大龙虾互动区/],
  ['local-drive', /[A-Z]:[/\\]XZM[/\\]/],
];

const secHits = [], privHits = [];
for (const p of walk(root)) {
  // 扫描器自身含规则字面量（如密钥文件名正则），跳过以免自匹配
  if (p.endsWith('verify-security.mjs')) continue;
  let t;
  try { t = fs.readFileSync(p, 'utf8'); } catch { continue; }
  const rel = path.relative(root, p);
  for (const [kind, rx] of SECRET) {
    for (const m of t.matchAll(new RegExp(rx.source, 'g'))) {
      const ctx = t.slice(Math.max(0, m.index - 80), m.index + 30);
      const head = t.slice(Math.max(0, m.index - 250), m.index);
      if (FIXTURE.test(ctx) || FIXTURE.test(head)) continue;
      secHits.push(`${rel} [${kind}] ${m[0].slice(0, 16)}…`);
    }
  }
  const t2 = t.replaceAll('C:\\Users\\<user>', '').replaceAll('C:/Users/<user>', '').replaceAll('Users/<user>', '');
  for (const [kind, rx] of PRIV) {
    if (rx.test(t2)) privHits.push(`${rel} [${kind}]`);
  }
}
check('无真实密钥/令牌/私钥体', secHits.length === 0, secHits.slice(0, 8).join(' | '));
check('无用户路径/主机名/密钥文件名', privHits.length === 0, privHits.slice(0, 8).join(' | '));

const em = fs.readFileSync(path.join(pkgRoot, 'src/electron-main.ts'), 'utf8');
const up = fs.readFileSync(path.join(pkgRoot, 'src/updater.ts'), 'utf8');
const gs = fs.readFileSync(path.join(pkgRoot, 'src/group-store.ts'), 'utf8');
const appjs = fs.readFileSync(path.join(pkgRoot, 'src/renderer/app.js'), 'utf8');
const index = fs.readFileSync(path.join(pkgRoot, 'src/renderer/index.html'), 'utf8');
const fetchNode = fs.readFileSync(path.join(root, 'scripts/fetch-node-runtime.mjs'), 'utf8');
const rename = fs.readFileSync(path.join(root, 'scripts/pinyin-rename.mjs'), 'utf8');
const css = fs.readFileSync(path.join(pkgRoot, 'src/renderer/app.css'), 'utf8') + fs.readFileSync(path.join(pkgRoot, 'src/renderer/renderer.css'), 'utf8');

const checks = [
  ['recordId 插值完整', em.includes('return `${prefix}-${Date.now()}-${chatLogIdSeq}`;')],
  ['无坏 recordId 模板', !em.includes('prefix-Date.now()')],
  ['成员 id 插值', gs.includes('`inst:${instId}`') && gs.includes('`m-${Date.now().toString(36)}-${LieBiao.length}`')],
  ['max 上限插值', gs.includes('max ${QUN_CHENGYUAN_SHANGXIAN}')],
  ['IPC sender fail-closed', em.includes('forbidden sender') && /return false/.test(em) && em.includes('senderFrame')],
  ['IPC 非 file 默认拒', /startsWith\('file:'\)/.test(em)],
  ['devtools 默认不放行 IPC', /WARMY_ALLOW_DEVTOOLS_IPC/.test(em)],
  ['updater 拒远程 http', up.includes('http refused')],
  ['updater 无 sha256 不落盘', up.includes('refuse unverified')],
  ['downloadUrl 走 https 校验', up.includes('jiaoyanGengxinyuanUrl(chk.downloadUrl)')],
  ['node 下载 SHASUMS256', fetchNode.includes('SHASUMS256') && fetchNode.includes('createHash')],
  ['插件锁版本', /pin-version|must pin a version/.test(em)],
  ['contextIsolation 开启', /contextIsolation:\s*true/.test(em)],
  ['nodeIntegration 关闭', /nodeIntegration:\s*false/.test(em)],
  ['CSP 存在', /Content-Security-Policy/i.test(index)],
  ['escapeHtml 存在', /(?:function\s+escapeHtml|const\s+escapeHtml\s*=)/.test(appjs)],
  ['webSecurity 未关', !em.includes('webSecurity: false')],
  ['allowRunningInsecureContent 未开', !em.includes('allowRunningInsecureContent: true')],
  ['模板门禁在仓内', fs.existsSync(path.join(pkgRoot, 'scripts/verify-template-integrity.mjs'))],
  ['pinyin-rename lock 防护', /lock:\s*true|seg\.lock/.test(rename)],
  ['LICENSE 含 Pondsi', fs.readFileSync(path.join(root, 'LICENSE'), 'utf8').includes('Pondsi')],
  ['第四列可滚', /overflow-y:\s*auto/.test(css)],
  ['body overflow hidden', /body\s*\{[^}]*overflow:\s*hidden/.test(css)],
];
for (const [label, cond] of checks) check(label, !!cond);

// 危险 API：用户字段未转义插入 innerHTML
let danger = 0;
for (const rel of ['src/renderer/app.js', 'src/electron-main.ts']) {
  const t = fs.readFileSync(path.join(pkgRoot, rel), 'utf8');
  const rx = /\.innerHTML\s*=[\s\S]{0,200}?\$\{(?!(?:escapeHtml|JSON\.stringify)\()[a-zA-Z_][\w.]*\.(name|ming|text|content|value|username|email|biaoTi|summary|path)/g;
  danger += [...t.matchAll(rx)].length;
}
check('无用户字段未转义 innerHTML', danger === 0, `hits=${danger}`);

// git 不跟踪密钥文件
try {
  const tracked = execFileSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8' });
  const bad = ['github的令牌.txt', 'deepseek-api-key.txt', 'key-google.txt', 'api-key.txt'].filter((n) => tracked.includes(n));
  check('git 未跟踪密钥文件名', bad.length === 0, bad.join(','));
} catch {
  check('git 未跟踪密钥文件名', false, 'git ls-files failed');
}

console.log(`\n==== verify-security: ${fail === 0 ? '全部通过' : fail + ' FAIL'} (PASS ${pass}) ====`);
process.exit(fail === 0 ? 0 : 1);
