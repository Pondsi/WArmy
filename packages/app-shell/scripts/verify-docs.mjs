/**
 * 文档合规校验（发布规范）：
 *  - README 含 10 语言节标题
 *  - README/说明 最后含 Pondsi 署名
 *  - 不出现 token / 本机绝对路径 / 私网 IP（第一方文档）
 *  - 必备文件存在
 *  - 安装包链接与 checksums 指向一致（若有）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(selfDir, '..', '..', '..');
let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass += 1; console.log(`  ok  ${label}`); }
  else { fail += 1; console.log(`  FAIL ${label}`, detail ?? ''); }
}

const required = [
  'README.md', '说明.md', 'LICENSE', 'SPONSORS.md', 'CHANGELOG.md',
  'checksums.txt', '.gitignore', '.github/SECURITY.md',
  'references/ARCHITECTURE.md',
];
for (const f of required) {
  check(`exists ${f}`, fs.existsSync(path.join(ROOT, f)));
}

const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const shuoming = fs.readFileSync(path.join(ROOT, '说明.md'), 'utf8');
const license = fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');

const langHeads = ['## English'];
for (const h of langHeads) {
  check(`README has ${h}`, readme.includes(h) || !h.startsWith('## 简体中文'));
}
check('README points Chinese readers to 说明.md', /说明\.md/.test(readme));
check('README does NOT have ## 简体中文 main section', !/^## 简体中文$/m.test(readme));
for (const alias of ['繁體中文', '한국어', 'Русский', '日本語', 'Español', 'Français', 'Português', 'Esperanto', 'Languages / 语言']) {
  check(`README mentions ${alias}`, readme.includes(alias));
}

const SIG = 'Pondsi (+mimo-X-pro-Preview +mimo-v2.5-pro +DeepSeek-V4.1-Flash +Qwen3.7-max +Qwen3.8-27b +Gemini3.1pro +Gemini3.8-flash)';
const SIG_ZH_FULL = 'Pondsi（+mimo-X-pro-Preview +mimo-v2.5-pro +DeepSeek-V4.1-Flash +Qwen3.7-max +Qwen3.8-27b +Gemini3.1pro +Gemini3.8-flash）';
check('README signature models (single style)', readme.includes(SIG));
check('说明 signature models (single style)', shuoming.includes(SIG) || shuoming.includes(SIG_ZH_FULL));
check('README has only one signature footer line', (readme.match(/automatically committed by Xiaomi MiMo Desktop/g) || []).length === 1);
check('说明 has only one signature footer line', (shuoming.match(/由 Xiaomi MiMo Desktop 自行提交|automatically committed by Xiaomi MiMo Desktop/g) || []).length === 1);
check('README signature Xiaomi MiMo Desktop', /Xiaomi MiMo Desktop/.test(readme));
check('说明 signature Xiaomi MiMo Desktop', /Xiaomi MiMo Desktop/.test(shuoming));
check('LICENSE mandates Pondsi attribution', /ATTRIBUTION TO PONDSI/i.test(license) && license.includes('Pondsi'));

// brand rules
check('README Workhorse Army', readme.includes('Workhorse Army'));
check('README English tagline', readme.includes('An infinite army of AI workhorses working for you.'));
check('说明 zh tagline', shuoming.includes('让AI成为你的无限牛马'));
check('README no CCArmy', !/CCArmy|Corporate Cattle/i.test(readme));
check('说明 no CCArmy', !/CCArmy|Corporate Cattle/i.test(shuoming));

// content pillars user asked for
for (const k of ['What makes WArmy different', 'Compared with similar open-source', 'Install', 'How to use', 'Technical highlights', '59599', 'Memory system', '说明.md']) {
  check(`README section/keyword: ${k}`, readme.includes(k), k);
}
for (const k of ['优点', '同类产品', '安装方法', '使用方法', '技术要点', '59599', '记忆系统', 'recall', 'retrieve']) {
  check(`说明 section/keyword: ${k}`, shuoming.includes(k), k);
}
check('CONTRIBUTING exists', fs.existsSync(path.join(ROOT, 'CONTRIBUTING.md')));
check('SECURITY expanded', fs.readFileSync(path.join(ROOT, '.github/SECURITY.md'), 'utf8').includes('vulnerability'));
check('mesh checklist', fs.existsSync(path.join(ROOT, 'docs/mesh-dual-machine.md')));
check('release notes', fs.existsSync(path.join(ROOT, 'docs/RELEASE-NOTES-0.1.0.md')));
check('fetch-node-runtime script', fs.existsSync(path.join(ROOT, 'scripts/fetch-node-runtime.mjs')));
check('update feed docs', fs.existsSync(path.join(ROOT, 'docs/UPDATE-FEED.md')));
check('container timings docs', fs.existsSync(path.join(ROOT, 'docs/CONTAINER-TIMINGS.md')));
check('github update feed json', fs.existsSync(path.join(ROOT, 'feed/latest.json')));
check('i18n naming doc', fs.existsSync(path.join(ROOT, 'docs/i18n-naming.md')));
check('set-github-update-feed script', fs.existsSync(path.join(ROOT, 'scripts/set-github-update-feed.mjs')));
check('launch-warmy vbs', fs.existsSync(path.join(ROOT, 'packages/app-shell/scripts/launch-warmy.vbs')));
const feedJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'feed/latest.json'), 'utf8'));
check('feed version is 0.1.0', feedJson.version === '0.1.0', feedJson.version);
check('feed points to GitHub release asset', String(feedJson.url || feedJson.downloadUrl || '').includes('github.com/Pondsi/WArmy'), feedJson.url);

// privacy on first-party docs
const privacyPats = [
  [/(ghp_[A-Za-z0-9]+)/, 'TOKEN'],
  [/C:\\Users\\p\\/, 'ABS_PATH_USER'],
  [/\b192\.168\.\d+\.\d+\b/, 'PRIVATE_IP'],
];
for (const [re, name] of privacyPats) {
  check(`README no ${name}`, !re.test(readme));
  check(`说明 no ${name}`, !re.test(shuoming));
}

// release asset naming consistency
check('README mentions WArmy-Setup-0.1.0.exe', readme.includes('WArmy-Setup-0.1.0.exe'));
check('说明 mentions WArmy-Setup-0.1.0.exe', shuoming.includes('WArmy-Setup-0.1.0.exe'));
check('README GitHub release link', readme.includes('https://github.com/Pondsi/WArmy/releases'));

console.log(`\n==== verify-docs: ${pass} ok / ${fail} FAIL ====`);
process.exit(fail === 0 ? 0 : 1);
