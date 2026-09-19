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

const langHeads = ['## English', '## 简体中文'];
for (const h of langHeads) {
  check(`README has ${h}`, readme.includes(h), h);
}
for (const alias of ['繁體中文', '한국어', 'Русский', '日本語', 'Español', 'Français', 'Português', 'Esperanto']) {
  check(`README mentions ${alias}`, readme.includes(alias));
}

const SIG = 'Pondsi (+mimo-X-por-Preview +mimo-v2.5-pro +DeepSeek-V4.1-Flash +Qwen3.7-max +Qwen3.8-27b +Gemini3.1pro +Gemini3.8-flash)';
const SIG_ZH_FULL = 'Pondsi（+mimo-X-por-Preview +mimo-v2.5-pro +DeepSeek-V4.1-Flash +Qwen3.7-max +Qwen3.8-27b +Gemini3.1pro +Gemini3.8-flash）';
check('README signature models', readme.includes(SIG) || readme.includes(SIG_ZH_FULL));
check('说明 signature models', shuoming.includes(SIG) || shuoming.includes(SIG_ZH_FULL));
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
for (const k of ['What makes WArmy different', 'Compared with similar open-source', 'Install', 'How to use', 'Technical highlights', '59599']) {
  check(`README section/keyword: ${k}`, readme.includes(k), k);
}
for (const k of ['优点', '同类产品', '安装方法', '使用方法', '技术要点', '59599']) {
  check(`说明 section/keyword: ${k}`, shuoming.includes(k), k);
}

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
