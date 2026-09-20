/**
 * repo-guard + lease 的可重跑验证（ADR 003 附四.3① ② / 附五 / 附三.4）
 *
 *   node scripts/verify-repo-guard.mjs          # 全量
 *   node scripts/verify-repo-guard.mjs --keep   # 保留临时目录（排查用）
 *
 * 覆盖：
 *   [1] 危险推送路径（.git/hooks、.git/config、.gitattributes 驱动、符号链接逃逸、.. 穿越）
 *   [2] 绕过尝试回归（反斜杠、末尾空格/末尾点、Unicode 归一化、大小写差异、批次内碰撞）
 *   [3] ref 规则（推主分支被拒、删 ref 被拒、删环境 ref 被拒、非快进被拒、合法推送通过）
 *   [4] 公开目录发布扫描（邮箱 / 密钥 / 聊天日志 / 成员名册 / 本机绝对路径）
 *   [5] 租约仲裁（无租约被拒、持有通过、他人冲突被拒、过期自动失效、越权释放/续租）
 *
 * 依赖 dist（先 `pnpm --filter @warmy/app-shell build`）。不联网、不碰电子主进程、不影响仓库本体。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validatePushPaths, validateRefUpdate, saomiaoKeFabucDaochu, normalizeRepoPath} from '../dist/repo-guard.js';
import {LeaseRegistry} from '../dist/lease.js';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const keep = process.argv.includes('--keep');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-repo-guard-'));

let pass = 0;
let fail = 0;
let skip = 0;

function check(label, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  [PASS] ${label}${detail === undefined ? '' : ` => ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
  } else {
    fail++;
    console.log(`  [FAIL] ${label}${detail === undefined ? '' : ` => ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
  }
}

function skipped(label, why) {
  skip++;
  console.log(`  [SKIP] ${label} => ${why}`);
}

function codes(result) {
  return (result.rejected ?? result.rejections ?? result.violations ?? []).map((r) => r.code).join(',');
}

function section(title) {
  console.log(`\n── ${title} ──`);
}

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);
const D = 'd'.repeat(40);
const Z = '0'.repeat(40);

console.log(`repo-guard 验证开始`);
console.log(`临时目录: ${tmpRoot}`);

// ─────────────────────────────────────────────────────────────────────────────
section('1. 危险推送路径必须被拒（validatePushPaths）');
// ─────────────────────────────────────────────────────────────────────────────

const dangerCases = [
  { label: '.git/hooks/post-receive（钩子=任意代码执行）', entries: ['.git/hooks/post-receive'], expect: 'git-hooks' },
  { label: '.git/config（core.hooksPath）', entries: ['.git/config'], expect: 'git-config' },
  { label: '.git/config.worktree', entries: ['.git/config.worktree'], expect: 'git-config' },
  { label: '.git/info/attributes', entries: ['.git/info/attributes'], expect: 'git-attributes' },
  { label: '.git 本体', entries: ['.git'], expect: 'git-internal' },
  { label: '.git/objects/…（内部数据）', entries: ['.git/objects/ab/cdef'], expect: 'git-internal' },
  { label: '嵌套 foo/.git/hooks/pre-commit', entries: ['foo/.git/hooks/pre-commit'], expect: 'git-hooks' },
  { label: '.. 穿越：../outside.txt', entries: ['../outside.txt'], expect: 'parent-escape' },
  { label: '.. 穿越：src/../../etc/passwd', entries: ['src/../../etc/passwd'], expect: 'parent-escape' },
  { label: '绝对路径：/etc/passwd', entries: ['/etc/passwd'], expect: 'abs-path' },
  { label: 'Windows 盘符：C:\\Users\\p\\secret.txt', entries: ['C:\\Users\\p\\secret.txt'], expect: 'abs-path' },
  { label: 'UNC 路径：\\\\server\\share\\x', entries: ['\\\\server\\share\\x'], expect: 'abs-path' },
  { label: '家目录：~/x', entries: ['~/x'], expect: 'abs-path' },
  { label: 'NUL / 控制字符', entries: ['.git/config\u0000.txt'], expect: 'illegal-char' },
  {
    label: '.gitattributes 绑 filter 驱动',
    entries: [{ path: '.gitattributes', content: '*.txt filter=evil\n' }],
    expect: 'git-attributes',
  },
  {
    label: '.gitattributes 绑 diff 驱动（textconv）',
    entries: [{ path: '.gitattributes', content: '*.bin diff=evil\n' }],
    expect: 'git-attributes',
  },
  {
    label: '子目录 .gitattributes 绑 filter 驱动',
    entries: [{ path: 'sub/.gitattributes', content: '*.md filter=lfs\n' }],
    expect: 'git-attributes',
  },
  {
    label: '.gitattributes 没给内容 → fail-closed（无法校验）',
    entries: [{ path: '.gitattributes' }],
    expect: 'git-attributes-unverified',
  },
  {
    label: '符号链接逃逸：link -> ../../outside',
    entries: [{ path: 'link', mode: '120000', symlinkTarget: '../../outside' }],
    expect: 'symlink-escape',
  },
  {
    label: '符号链接逃逸：link -> C:/Windows/System32',
    entries: [{ path: 'link', mode: '120000', symlinkTarget: 'C:/Windows/System32' }],
    expect: 'symlink-escape',
  },
  {
    label: '符号链接指向 git 内部：link -> .git/config',
    entries: [{ path: 'link', mode: '120000', symlinkTarget: '.git/config' }],
    expect: 'symlink-escape',
  },
  {
    label: '符号链接没给目标',
    entries: [{ path: 'link', mode: '120000' }],
    expect: 'symlink-escape',
  },
];

for (const c of dangerCases) {
  const r = validatePushPaths(c.entries);
  const hit = r.rejected.some((x) => x.code === c.expect);
  check(c.label, r.allowed === false && hit, `${c.expect} | 实际=[${codes(r)}] ${r.rejected[0]?.reason ?? ''}`);
}

const gitdirHooks = validatePushPaths(['hooks/post-receive'], { base: 'gitdir' });
check('base=gitdir：hooks/post-receive 被拒', gitdirHooks.allowed === false && codes(gitdirHooks).includes('git-hooks'), codes(gitdirHooks));
const gitdirConfig = validatePushPaths(['config'], { base: 'gitdir' });
check('base=gitdir：config 被拒', gitdirConfig.allowed === false && codes(gitdirConfig).includes('git-config'), codes(gitdirConfig));
const gitdirDotGit = validatePushPaths(['.git/hooks/post-receive'], { base: 'gitdir' });
check('base=gitdir：显式前缀 .git/hooks/… 仍被拒', gitdirDotGit.allowed === false, codes(gitdirDotGit));

section('1b. 正常路径必须通过');
const okPush = validatePushPaths([
  'src/app.ts',
  'packages/app-shell/src/index.ts',
  'docs/报告.md',
  '.gitignore',
]);
check(
  '4 条正常路径（含中文名 / .gitignore）全部通过',
  okPush.allowed === true && okPush.accepted.length === 4,
  `accepted=${JSON.stringify(okPush.accepted)}`
);
const okAttr = validatePushPaths([{ path: '.gitattributes', content: '*.png binary\n* text=auto\n' }]);
check('.gitattributes 干净内容（text=auto / binary）通过', okAttr.allowed === true, codes(okAttr));
const attrNoContentLoose = validatePushPaths([{ path: '.gitattributes' }], { requireAttributesContent: false });
check(
  'requireAttributesContent:false 时未给内容的 .gitattributes 放行但给告警',
  attrNoContentLoose.allowed === true && attrNoContentLoose.warnings.length > 0,
  attrNoContentLoose.warnings.join(' / ')
);
const insideLink = validatePushPaths([{ path: 'link', mode: '120000', symlinkTarget: 'src/app.ts' }]);
check('指向仓库内的符号链接放行（但给告警）', insideLink.allowed === true && insideLink.warnings.length > 0, insideLink.warnings.join(' / '));
const single = validatePushPaths('src/single.ts');
check('单字符串入参可用', single.allowed === true && single.accepted[0] === 'src/single.ts', single.accepted);

// ─────────────────────────────────────────────────────────────────────────────
section('2. 绕过尝试回归（反斜杠 / 末尾空格 / Unicode 归一化 / 大小写）');
// ─────────────────────────────────────────────────────────────────────────────

const bypass = [
  { label: '[反斜杠] .git\\hooks\\post-receive', entries: ['.git\\hooks\\post-receive'], expect: 'git-hooks' },
  { label: '[反斜杠+穿越] ..\\..\\etc\\passwd', entries: ['..\\..\\etc\\passwd'], expect: 'parent-escape' },
  { label: '[末尾空格] ".git/config  "', entries: ['.git/config  '], expect: 'git-config' },
  { label: '[末尾点] ".git./config"', entries: ['.git./config'], expect: 'git-config' },
  { label: '[末尾空格] "src/app.ts " 也被拒（Windows 会剥离 → 可改到另一个文件）', entries: ['src/app.ts '], expect: 'noise-suffix' },
  { label: '[Unicode] 全角 ".ｇｉｔ／ｃｏｎｆｉｇ"', entries: ['.ｇｉｔ／ｃｏｎｆｉｇ'], expect: 'git-config' },
  { label: '[Unicode] 零宽空格 ".git\\u200b/config"', entries: ['.git\u200b/config'], expect: 'git-config' },
  { label: '[大小写] ".GIT/CONFIG"', entries: ['.GIT/CONFIG'], expect: 'git-config' },
  { label: '[大小写] ".Git/Hooks/Post-Receive"', entries: ['.Git/Hooks/Post-Receive'], expect: 'git-hooks' },
];
for (const c of bypass) {
  const r = validatePushPaths(c.entries);
  const hit = r.rejected.some((x) => x.code === c.expect);
  check(c.label, r.allowed === false && hit, `${c.expect} | 实际=[${codes(r)}]`);
}

const zw = validatePushPaths(['.git\u200b/config']);
check(
  '[Unicode] 零宽字符被记录为别名（审计可见）',
  (zw.rejected[0]?.aliases ?? []).includes('unicode'),
  JSON.stringify(zw.rejected[0]?.aliases)
);
const upper = validatePushPaths(['.GIT/CONFIG']);
check('[大小写] 大小写别名被记录（审计可见）', (upper.rejected[0]?.aliases ?? []).includes('case'), JSON.stringify(upper.rejected[0]?.aliases));

const caseCollision = validatePushPaths(['src/A.ts', 'src/a.ts']);
check(
  '[大小写碰撞] src/A.ts + src/a.ts 同批次两者都被拒',
  caseCollision.allowed === false && caseCollision.rejected.length === 2 && caseCollision.accepted.length === 0,
  `rejected=${JSON.stringify(caseCollision.rejected.map((r) => [r.path, r.code, r.conflictsWith]))}`
);
const nfc = 'caf\u00e9.txt';
const nfd = 'cafe\u0301.txt';
const uniCollision = validatePushPaths([nfc, nfd]);
check(
  '[Unicode 碰撞] NFC 与 NFD 的 café.txt 被判为同一文件',
  uniCollision.allowed === false && uniCollision.rejected.length === 2,
  `rejected=${JSON.stringify(uniCollision.rejected.map((r) => [r.path, r.code]))}`
);
const dup = validatePushPaths(['src/dup.ts', 'src/zhongFu.ts']);
check('完全重复路径 = 只收一条 + 告警（不算绕过）', dup.allowed === true && dup.accepted.length === 1 && dup.warnings.length > 0, dup.warnings[0]);

const norm = normalizeRepoPath('．/／src/../src\\app.ts ');
check(
  'normalizeRepoPath 归一化可见（供审计/日志用）',
  norm.ok === true && norm.normalized === 'src/app.ts' && norm.aliases.length > 0,
  `${norm.normalized} aliases=${JSON.stringify(norm.aliases)} noisy=${norm.noisy}`
);

// ─────────────────────────────────────────────────────────────────────────────
section('3. ref 规则（validateRefUpdate）');
// ─────────────────────────────────────────────────────────────────────────────

const ffYes = () => true;
const ffNo = () => false;

const refCases = [
  {
    label: '成员推主分支 refs/heads/main → 拒',
    res: validateRefUpdate('refs/heads/main', A, B, { role: 'member', isAncestor: ffYes }),
    expect: 'main-branch-protected',
  },
  {
    label: '成员推 refs/heads/master → 拒',
    res: validateRefUpdate('refs/heads/master', A, B, { role: 'member', isAncestor: ffYes }),
    expect: 'main-branch-protected',
  },
  {
    label: '成员删自己的提案分支 → 拒（不允许删 ref）',
    res: validateRefUpdate('refs/heads/proposals/fix-1', A, Z, { role: 'member' }),
    expect: 'ref-delete',
  },
  {
    label: '创建者删环境 ref → 拒（环境 ref 任何人不得删）',
    res: validateRefUpdate('refs/environments/staging', A, Z, { role: 'creator', allowDeleteByCreator: true }),
    expect: 'env-ref-delete',
  },
  {
    label: '成员推环境 ref → 拒（只允许 creator/admin）',
    res: validateRefUpdate('refs/environments/staging', A, B, { role: 'member', isAncestor: ffYes }),
    expect: 'env-ref-protected',
  },
  {
    label: '非快进推送 → 拒',
    res: validateRefUpdate('refs/heads/proposals/fix-1', A, C, { role: 'member', isAncestor: ffNo }),
    expect: 'non-fast-forward',
  },
  {
    label: '强制推（--force）→ 拒',
    res: validateRefUpdate('refs/heads/proposals/fix-1', A, C, { role: 'member', force: true, isAncestor: ffYes }),
    expect: 'forced-update',
  },
  {
    label: '没有对象图可判定 → fail-closed 拒',
    res: validateRefUpdate('refs/heads/proposals/fix-1', A, C, { role: 'member' }),
    expect: 'fast-forward-unverified',
  },
  {
    label: 'ref 名非法（含 ..）→ 拒',
    res: validateRefUpdate('refs/heads/../evil', A, C, { role: 'member', isAncestor: ffYes }),
    expect: 'ref-invalid',
  },
  {
    label: 'ref 名非法（.lock 结尾）→ 拒',
    res: validateRefUpdate('refs/heads/evil.lock', A, C, { role: 'member', isAncestor: ffYes }),
    expect: 'ref-invalid',
  },
  {
    label: '对象名非法 → 拒',
    res: validateRefUpdate('refs/heads/proposals/x', 'not-a-sha', C, { role: 'member', isAncestor: ffYes }),
    expect: 'sha-invalid',
  },
  {
    label: '成员推 refs/heads/别人的分支 → 拒（白名单）',
    res: validateRefUpdate('refs/heads/feature-x', A, B, { role: 'member', isAncestor: ffYes }),
    expect: 'ref-not-whitelisted',
  },
  {
    label: '推 refs/replace/** → 拒（永久封禁，改对象图）',
    res: validateRefUpdate('refs/replace/' + A, A, B, { role: 'member', isAncestor: ffYes }),
    expect: 'ref-blocked',
  },
  {
    label: 'oldSha 与服务端不一致（并发/强推）→ 拒',
    res: validateRefUpdate('refs/heads/proposals/fix-1', A, B, { role: 'member', isAncestor: ffYes, knownSha: D }),
    expect: 'stale-old-sha',
  },
];
for (const c of refCases) {
  const hit = c.res.rejections.some((r) => r.code === c.expect);
  check(c.label, c.res.allowed === false && hit, `${c.expect} | 实际=[${codes(c.res)}] ${c.res.rejections[0]?.reason ?? ''}`);
}

section('3b. 合法推送必须通过');
const refOk = validateRefUpdate('refs/heads/proposals/fix-1', Z, B, { role: 'member', memberId: 'm1', isAncestor: ffYes });
check('成员新建提案分支（create + 快进）→ 通过', refOk.allowed === true && refOk.action === 'create', JSON.stringify(refOk.rejections));
const refOwn = validateRefUpdate('refs/heads/members/m1/wip', A, B, { role: 'member', memberId: 'm1', isAncestor: ffYes });
check('成员推自己的 refs/heads/members/m1/** → 通过', refOwn.allowed === true, codes(refOwn));
const refOther = validateRefUpdate('refs/heads/members/m2/wip', A, B, { role: 'member', memberId: 'm1', isAncestor: ffYes });
check('成员推别人的 members 命名空间 → 拒', refOther.allowed === false && codes(refOther).includes('ref-not-whitelisted'), codes(refOther));
const refCreatorMain = validateRefUpdate('refs/heads/main', A, B, { role: 'creator', isAncestor: ffYes });
check('创建者快进推主分支 → 通过', refCreatorMain.allowed === true, codes(refCreatorMain));
const refCreatorForceMain = validateRefUpdate('refs/heads/main', A, B, { role: 'creator', force: true });
check('创建者强推主分支 → 默认仍拒（可回退靠检查点，不靠 force）', refCreatorForceMain.allowed === false && codes(refCreatorForceMain).includes('forced-update'), codes(refCreatorForceMain));
const refEnvCreator = validateRefUpdate('refs/environments/staging', A, B, { role: 'creator', isAncestor: ffYes });
check('创建者更新环境 ref → 通过', refEnvCreator.allowed === true, codes(refEnvCreator));
const refNoop = validateRefUpdate('refs/heads/proposals/fix-1', A, A, { role: 'member' });
check('无变化的 no-op → 放行但给告警', refNoop.allowed === true && refNoop.action === 'noop' && refNoop.warnings.length > 0, refNoop.warnings[0]);

// ─────────────────────────────────────────────────────────────────────────────
section('4. 公开目录发布门禁（saomiaoKeFabucDaochu）');
// ─────────────────────────────────────────────────────────────────────────────

const cleanDir = path.join(tmpRoot, 'clean-public');
fs.mkdirSync(path.join(cleanDir, 'src'), { recursive: true });
fs.mkdirSync(path.join(cleanDir, 'docs'), { recursive: true });
fs.writeFileSync(path.join(cleanDir, 'README.md'), '# 公开目录\n本目录的内容会被导出并发布到公开位置。\n', 'utf8');
fs.writeFileSync(path.join(cleanDir, 'src', 'app.ts'), 'export const hello = (): string => "hi";\n', 'utf8');
fs.writeFileSync(path.join(cleanDir, 'docs', 'notes.md'), '联系示例（占位邮箱，允许）：alice@example.com\n', 'utf8');
const cleanScan = saomiaoKeFabucDaochu(cleanDir);
check(
  '干净目录 → 允许发布',
  cleanScan.allowed === true && cleanScan.files === 3 && cleanScan.violations.length === 0,
  `files=${cleanScan.files} bytes=${cleanScan.bytes} violations=${JSON.stringify(cleanScan.violations)}`
);
check('占位邮箱 @example.com 被放行（但要显式说明）', cleanScan.allowed === true, `warnings=${cleanScan.warnings.length}`);

const dirtyDir = path.join(tmpRoot, 'dirty-public');
fs.mkdirSync(path.join(dirtyDir, 'src'), { recursive: true });
fs.mkdirSync(path.join(dirtyDir, 'docs'), { recursive: true });
fs.writeFileSync(path.join(dirtyDir, 'chat.log'), '2026-09-18 12:00 群主: 大家好\n', 'utf8');
fs.writeFileSync(
  path.join(dirtyDir, 'members.json'),
  JSON.stringify(
    [
      { memberId: 'm1', name: '群主', email: 'boss@corp.example.cn' },
      { memberId: 'm2', name: '牛马一号' },
    ],
    null,
    2
  ),
  'utf8'
);
fs.writeFileSync(path.join(dirtyDir, 'secret.pem'), '-----BEGIN OPENSSH PRIVATE KEY-----\nAAAAB3NzaC1yc2E\n-----END OPENSSH PRIVATE KEY-----\n', 'utf8');
fs.writeFileSync(path.join(dirtyDir, '.env'), 'API_KEY=abcdef123456\n', 'utf8');
fs.writeFileSync(path.join(dirtyDir, 'docs', 'config.md'), '本机路径：D:\\Projects\\WArmy\\本体\n', 'utf8');
fs.writeFileSync(path.join(dirtyDir, 'src', 'transcript.ts'), 'const h = [{"role": "user", "content": "hi"}];\n', 'utf8');
fs.writeFileSync(path.join(dirtyDir, 'src', 'cred.ts'), `const token = "ghp_${'a'.repeat(30)}";\n`, 'utf8');
fs.writeFileSync(path.join(dirtyDir, 'src', 'mail.ts'), 'export const mail = "bob@corp.example.cn";\n', 'utf8');
fs.writeFileSync(path.join(dirtyDir, 'src', 'roster.ts'), 'export const m = [{"memberId": "m1"}, {"memberId": "m2"}];\n', 'utf8');
fs.writeFileSync(path.join(dirtyDir, 'src', 'abs.ts'), 'export const p = "C:\\Users\\someone\\Documents\\a.txt";\n', 'utf8');
fs.writeFileSync(path.join(dirtyDir, 'src', 'homedir.ts'), `export const home = ${JSON.stringify(os.homedir())};\n`, 'utf8');

// 导出目录里的符号链接必须被拒。Windows 上创建"文件符号链接"通常要开发者模式/管理员，
// 所以失败时退化成目录 junction（同样被 lstat 报成 symlink），保证这条规则真的被跑到。
let linkCreated = '';
try {
  fs.symlinkSync(path.join(tmpRoot, 'outside-secret.txt'), path.join(dirtyDir, 'escape.txt'), 'file');
  linkCreated = 'file-symlink';
} catch {
  const outsideDir = path.join(tmpRoot, 'outside-dir');
  fs.mkdirSync(outsideDir, { recursive: true });
  fs.writeFileSync(path.join(outsideDir, 'outside-secret.txt'), 'outside\n', 'utf8');
  try {
    fs.symlinkSync(outsideDir, path.join(dirtyDir, 'escape-dir'), 'junction');
    linkCreated = 'junction';
  } catch (e) {
    skipped('公开目录里的符号链接被拒', `本机不允许创建符号链接/junction（${e instanceof Error ? e.code ?? e.name : 'unknown'}）`);
  }
}

const dirtyScan = saomiaoKeFabucDaochu(dirtyDir);
const dirtyCodes = new Set(dirtyScan.violations.map((v) => v.code));
check('含聊天日志/邮箱/密钥/名册/本机路径的目录 → 拒绝发布', dirtyScan.allowed === false, `violations=${dirtyScan.violations.length}`);
for (const code of ['chat-log', 'member-roster', 'email', 'secret-key', 'local-abs-path', 'env-file']) {
  check(`  违规类型命中：${code}`, dirtyCodes.has(code), [...dirtyCodes].join(','));
}
if (linkCreated) {
  check(`  违规类型命中：symlink（导出目录里的符号链接，本次用 ${linkCreated} 制造）`, dirtyCodes.has('symlink'), [...dirtyCodes].join(','));
}
check(
  '报告里的密钥/邮箱已脱敏（不回显完整值）',
  dirtyScan.violations.every((v) => !v.match || (!v.match.includes('@corp.example.cn') || v.match.startsWith('b***') || v.match.startsWith('b***@'))),
  dirtyScan.violations.slice(0, 4).map((v) => `${v.code}:${v.match ?? '-'}`).join(' | ')
);
check(
  '每条违规都带路径 + 可读原因',
  dirtyScan.violations.every((v) => !!v.path && !!v.reason && v.reason.length > 4),
  dirtyScan.violations[0]?.reason
);

const chatOnly = saomiaoKeFabucDaochu([{ path: 'public/聊天记录.md', content: '# 聊天记录\n' }]);
check('数组入参：文件名带聊天记录 → 拒', chatOnly.allowed === false && codes(chatOnly).includes('chat-log'), codes(chatOnly));
const emailOnly = saomiaoKeFabucDaochu([{ path: 'public/contact.txt', content: '邮箱：carol@team.example.cn\n' }]);
check('数组入参：内容含真实邮箱 → 拒', emailOnly.allowed === false && codes(emailOnly).includes('email'), codes(emailOnly));
const keyOnly = saomiaoKeFabucDaochu([{ path: 'public/config.md', content: `key = "sk-${'z'.repeat(24)}"\n` }]);
check('数组入参：内容含 API Key → 拒', keyOnly.allowed === false && codes(keyOnly).includes('secret-key'), codes(keyOnly));
const cleanArray = saomiaoKeFabucDaochu([
  { path: 'public/index.html', content: '<!doctype html><title>ok</title>\n' },
  { path: 'public/style.css', content: 'body { color: #333; }\n' },
]);
check('数组入参：干净的两条 → 允许', cleanArray.allowed === true && cleanArray.files === 2, JSON.stringify(cleanArray.violations));
const placeholder = saomiaoKeFabucDaochu([{ path: 'public/a.md', content: 'demo@example.org\n' }]);
check('数组入参：占位邮箱放行', placeholder.allowed === true, codes(placeholder));
const allowListed = saomiaoKeFabucDaochu([{ path: 'public/内部.md', content: '聊天记录\n' }], { allowPathPatterns: ['内部'] });
check('allowPathPatterns 可以显式放行（要留审计）', allowListed.allowed === true && allowListed.warnings.length > 0, allowListed.warnings[0]);

// ─────────────────────────────────────────────────────────────────────────────
section('5. 租约仲裁（LeaseRegistry）');
// ─────────────────────────────────────────────────────────────────────────────

let now = 1_700_000_000_000; // 固定时钟，过期判定可复现
const reg = new LeaseRegistry({ now: () => now });

const noLease = reg.checkWrite('m1', 'src/a.ts');
check('无租约写入 → 拒（no-lease）且原因可读', noLease.allowed === false && noLease.code === 'no-lease', noLease.reason);

const acq1 = reg.acquire({ holder: 'm1', kind: 'dir', scope: 'src', ttlMs: 5 * 60_000 });
check('m1 拿到 目录级 租约 src', acq1.ok === true && acq1.lease?.paths[0] === 'src' && !!acq1.lease?.id, acq1.lease && `${acq1.lease.id} 到期 ${new Date(acq1.lease.expiresAt).toISOString()}`);

const ownWrite = reg.checkWrite('m1', 'src/a.ts');
check('持有者写入自己的租约范围 → 通过', ownWrite.allowed === true && ownWrite.lease?.holder === 'm1', ownWrite.reason);
check('持有者写子目录 → 通过', reg.checkWrite('m1', 'src/deep/b.ts').allowed === true);
const outside = reg.checkWrite('m1', 'docs/x.md');
check('持有者写租约范围外 → 拒（no-lease）', outside.allowed === false && outside.code === 'no-lease', outside.reason);

const otherWrite = reg.checkWrite('m2', 'src/a.ts');
check(
  '他人写入 → 拒（held-by-other）且原因含持有者与到期时间',
  otherWrite.allowed === false && otherWrite.code === 'held-by-other' && otherWrite.reason.includes('m1') && otherWrite.heldBy === 'm1',
  otherWrite.reason
);
const conflict = reg.acquire({ holder: 'm2', kind: 'dir', scope: 'src', paths: ['src/a.ts'], ttlMs: 60_000 });
check(
  '他人申请重叠租约 → 拒（held-by-other + conflicts）',
  conflict.ok === false && conflict.error?.code === 'held-by-other' && (conflict.conflicts?.length ?? 0) === 1,
  conflict.error?.reason
);

const holders = reg.holdersOf('src/a.ts');
check('查询某路径当前被谁持有 → m1', holders.length === 1 && holders[0].holder === 'm1', holders[0].reason);
const holdersFree = reg.holdersOf('docs/x.md');
check('未持有的路径 → holder=null', holdersFree[0].holder === null, holdersFree[0].reason);

const mismatchExtend = reg.extend({ leaseId: acq1.lease.id, holder: 'm2' });
check('他人续租 → 拒（holder-mismatch）', mismatchExtend.ok === false && mismatchExtend.error?.code === 'holder-mismatch', mismatchExtend.error?.reason);
const mismatchRelease = reg.release({ leaseId: acq1.lease.id, holder: 'm2' });
check('他人释放 → 拒（holder-mismatch）', mismatchRelease.ok === false && mismatchRelease.error?.code === 'holder-mismatch', mismatchRelease.error?.reason);
const notFound = reg.release({ leaseId: 'lease-nope' });
check('释放不存在的租约 → lease-not-found', notFound.ok === false && notFound.error?.code === 'lease-not-found', notFound.error?.reason);

const fileLease = reg.acquire({ holder: 'm3', kind: 'file', scope: 'docs/readme.md', ttlMs: 10 * 60_000 });
check('文件级租约：精确匹配自己 → 通过', fileLease.ok === true && reg.checkWrite('m3', 'docs/readme.md').allowed === true, fileLease.lease?.id);
check(
  '文件级租约：同目录其它文件不在范围内 → 拒',
  reg.checkWrite('m3', 'docs/other.md').allowed === false && reg.checkWrite('m3', 'docs/other.md').code === 'no-lease'
);
const taskLease = reg.acquire({ holder: 'm4', kind: 'task', taskId: 'T-7', scope: 'T-7', paths: ['packages/a', 'packages/b'], ttlMs: 30 * 60_000 });
check('任务级租约覆盖多条路径', taskLease.ok === true && reg.checkWrite('m4', 'packages/a/src/x.ts').allowed === true && reg.checkWrite('m4', 'packages/b/y.ts').allowed === true, taskLease.lease?.paths);
check('任务级租约范围外 → 拒', reg.checkWrite('m4', 'packages/c/z.ts').allowed === false);
const taskNoPaths = reg.acquire({ holder: 'm4', kind: 'task', taskId: 'T-8' });
check('任务级租约缺 paths → 拒（invalid-request）', taskNoPaths.ok === false && taskNoPaths.error?.code === 'invalid-request', taskNoPaths.error?.reason);

section('5b. 租约绕过尝试回归');
const bypassLease = [
  { label: '[反斜杠] 他人写 "src\\a.ts" → 拒', path: 'src\\a.ts' },
  { label: '[末尾空格] 他人写 "src/a.ts " → 拒', path: 'src/a.ts ' },
  { label: '[大小写] 他人写 "SRC/A.TS" → 拒', path: 'SRC/A.TS' },
  { label: '[点前缀] 他人写 "./src/a.ts" → 拒', path: './src/a.ts' },
  { label: '[相对穿越] 他人写 "src/../src/a.ts" → 拒', path: 'src/../src/a.ts' },
];
for (const c of bypassLease) {
  const r = reg.checkWrite('m2', c.path);
  check(c.label, r.allowed === false && r.code === 'held-by-other', `${r.code} | ${r.reason}`);
}
const escape = reg.checkWrite('m1', '../../etc/passwd');
check('[穿越] 写入路径逃出仓库 → 拒（path-invalid）', escape.allowed === false && escape.code === 'path-invalid', escape.reason);
const badAcquire = reg.acquire({ holder: 'm9', kind: 'dir', paths: ['../outside'] });
check('申请租约时路径逃逸 → 拒（path-invalid）', badAcquire.ok === false && badAcquire.error?.code === 'path-invalid', badAcquire.error?.reason);
const badTtl = reg.acquire({ holder: 'm9', kind: 'dir', paths: ['tmpx'], ttlMs: 0 });
check('ttl<=0 → 拒（ttl-invalid）', badTtl.ok === false && badTtl.error?.code === 'ttl-invalid', badTtl.error?.reason);

const batchDenied = reg.checkWriteBatch('m2', ['docs/readme.md', 'src/a.ts']);
check(
  '批量：任一路径被占即整体拒绝（denied = 第一条被拒的）',
  batchDenied.allowed === false && batchDenied.results.every((r) => r.allowed === false) && batchDenied.denied?.code === 'held-by-other',
  `${batchDenied.denied?.path} | ${batchDenied.denied?.reason}`
);
const batchOk = reg.checkWriteBatch('m1', ['src/a.ts', 'src/b.ts']);
check('批量：全部在租约内 → 通过', batchOk.allowed === true && batchOk.results.length === 2);
check('批量：空列表 fail-closed', reg.checkWriteBatch('m1', []).allowed === false);

section('5c. 过期自动失效');
now += 6 * 60_000; // 越过 m1 的 5 分钟租约
const expiredWrite = reg.checkWrite('m1', 'src/a.ts');
check('过期后原持有者写入 → 拒（expired）', expiredWrite.allowed === false && expiredWrite.code === 'expired', expiredWrite.reason);
const extendExpired = reg.extend({ holder: 'm1', scope: 'src' });
check('过期后不能续租 → 拒（expired）', extendExpired.ok === false && extendExpired.error?.code === 'expired', extendExpired.error?.reason);
const releaseExpired = reg.release({ holder: 'm1', scope: 'src' });
check('释放已过期租约 → 不报错，提示已自动失效', releaseExpired.ok === true && releaseExpired.released === false, releaseExpired.reason);
const reAcquire = reg.acquire({ holder: 'm2', kind: 'dir', scope: 'src', ttlMs: 60_000 });
check('过期释放了范围 → 他人可立即拿到', reAcquire.ok === true, reAcquire.error?.reason);
const holderNow = reg.holdersOf('src/a.ts');
check('过期后持有人已换 → m2', holderNow[0].holder === 'm2', holderNow[0].reason);

let now2 = 2_000_000_000_000;
const reg2 = new LeaseRegistry({ now: () => now2, defaultTtlMs: 1_000, historyLimit: 3 });
reg2.acquire({ holder: 'x', kind: 'dir', scope: 'a' });
reg2.acquire({ holder: 'y', kind: 'dir', scope: 'b' });
now2 += 5_000;
const swept = reg2.sweep();
check('sweep() 返回本次过期的租约（无定时器，靠调用/操作时判定）', swept.length === 2, swept.map((l) => `${l.holder}:${l.scope}`));
check('sweep 后活跃数归零', reg2.stats().active === 0 && reg2.stats().expired === 2, JSON.stringify(reg2.stats()));
check('过期留痕有上限（historyLimit=3）', reg2.expiredHistory().length === 2);

section('5d. 自己的租约合并 / 上限');
const reg3 = new LeaseRegistry({ now: () => now2, maxLeasesPerHolder: 2 });
const g1 = reg3.acquire({ holder: 'm1', kind: 'dir', scope: 'apps/x', ttlMs: 60_000 });
const g2 = reg3.acquire({ holder: 'm1', kind: 'file', scope: 'apps/x/a.ts', ttlMs: 60_000 });
check(
  '同一持有者的重叠租约自动合并（幂等，不跟自己抢）',
  g1.ok === true && g2.ok === true && g2.merged === true && g2.lease?.id === g1.lease?.id && (g2.lease?.paths ?? []).includes('apps/x/a.ts'),
  `${g2.lease?.id} paths=${JSON.stringify(g2.lease?.paths)}`
);
reg3.acquire({ holder: 'm1', kind: 'dir', scope: 'apps/y', ttlMs: 60_000 });
const overLimit = reg3.acquire({ holder: 'm1', kind: 'dir', scope: 'apps/z', ttlMs: 60_000 });
check('同一持有者租约数上限生效 → 拒', overLimit.ok === false && overLimit.error?.code === 'invalid-request', overLimit.error?.reason);
check('创建者/成员都必须拿租约（没有内置 bypass）', reg3.checkWrite('creator', 'apps/x/a.ts').allowed === false, reg3.checkWrite('creator', 'apps/x/a.ts').reason);

const rel = reg3.release({ leaseId: g1.lease.id, holder: 'm1' });
check('本人释放 → ok/released', rel.ok === true && rel.released === true, rel.lease?.id);
check('释放后写入 → 拒（no-lease）', reg3.checkWrite('m1', 'apps/x/a.ts').allowed === false, reg3.checkWrite('m1', 'apps/x/a.ts').code);

// ─────────────────────────────────────────────────────────────────────────────
if (!keep) {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* 忽略 */
  }
}

console.log(`\n结论: ${fail === 0 ? '全部通过' : `${fail} 项失败`}（PASS ${pass} / FAIL ${fail} / SKIP ${skip}）`);
console.log(
  `\n本脚本**不覆盖**（防护边界之外，见 repo-guard.ts / lease.ts 末尾「已知缺口」）：\n` +
    `  · 内容型代码执行：成员推来的构建脚本 / package.json postinstall / CI 配置等（推上来不执行，\n` +
    `    "跑一下看看"才执行 —— 靠审核隔离，本模块管不了）\n` +
    `  · SSH 层：sshd 若给的是 shell 而不是 forced-command，任何路径校验都是摆设\n` +
    `  · 混淆/编码后的秘密（base64、UTF-16、图片文字、压缩包）、.gitmodules 子模块递归\n` +
    `  · 跨进程/跨机器的租约（本模块是进程内仲裁，需接 sync-protocol 广播 + 落盘）\n` +
    `  · 绕过 git 直接改工作区（编辑器自动保存、构建产物写回）\n` +
    `  · 大小写/Unicode 折叠只是 NFKC + toLowerCase 的近似，不是各文件系统的真实规则`
);
if (keep) console.log(`临时目录保留: ${tmpRoot}`);
process.exit(fail === 0 ? 0 : 1);
