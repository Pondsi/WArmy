import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let fail = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) fail++; };

// 主流项目必要门禁：依赖锁定、最小 CI 权限、秘密扫描、依赖审查、CodeQL。
const lock = path.join(root, 'pnpm-lock.yaml');
ok(fs.existsSync(lock), '依赖锁文件存在');
const workflows = path.join(root, '.github', 'workflows');
const files = fs.existsSync(workflows) ? fs.readdirSync(workflows).filter((f) => /\.ya?ml$/i.test(f)) : [];
const all = files.map((f) => fs.readFileSync(path.join(workflows, f), 'utf8')).join('\n');
ok(/permissions:\s*\n\s*contents:\s*read/m.test(all), 'CI 声明最小 contents: read 权限');
ok(/codeql|security-events:\s*write/i.test(all), 'CodeQL / 安全事件上报门禁');
ok(/dependency-review|dependabot/i.test(all) || fs.existsSync(path.join(root, '.github', 'dependabot.yml')), '依赖审查 / Dependabot 门禁');
ok(/gitleaks|trufflehog|secret[-_ ]?scan/i.test(all), '提交秘密扫描门禁');

// Agent 本地门禁：工作区隔离 + 精确编辑 + 危险动作审批。
const wt = fs.readFileSync(path.join(root, 'packages', 'app-shell', 'src', 'work-tools.ts'), 'utf8');
ok(wt.includes("name: 'edit_file'") && wt.includes("oldText-not-unique"), '精确编辑防误改门禁');
ok(wt.includes('workspace-escape') && wt.includes('absolute-path-not-allowed'), '工作区路径逃逸门禁');
const em = fs.readFileSync(path.join(root, 'packages', 'app-shell', 'src', 'electron-main.ts'), 'utf8');
ok(em.includes('panDuanShouQuan') && em.includes('check_safety'), '危险命令审批门禁');
ok(em.includes("audit?.log('triage.local'"), '本地分诊软门禁');

console.log(`industry gates: ${fail ? 'FAIL' : 'PASS'} (${fail} failures)`);
process.exit(fail ? 1 : 0);
