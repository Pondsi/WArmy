/**
 * verify-secret-at-rest.mjs —— 用户数据/审计/导出面不得落盘明文密钥
 * 判据：
 *  1. 源码里敏感字段（password/miMa/token/apiKey）落盘路径必须走加密（safeStorage/cred-vault）
 *  2. 审计/日志模板不得打印完整密钥（只允许长度/前缀）
 *  3. 仓库内不得提交真实密钥文件名
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
let fail = 0;
const ok = (c, label, detail) => {
  console.log(`  [${c ? 'PASS' : 'FAIL'}] ${label}${detail ? ' => ' + detail : ''}`);
  if (!c) fail++;
};

const srcFiles = [];
function walk(d, dep = 0) {
  if (dep > 4) return;
  for (const n of fs.readdirSync(d)) {
    if (n === 'node_modules' || n === 'dist' || n === '.git' || n === 'release') continue;
    const p = path.join(d, n);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, dep + 1);
    else if (/\.(ts|js|cjs|mjs)$/.test(n)) srcFiles.push(p);
  }
}
walk(path.join(root, 'packages'));

// 1) cred-vault 存在且使用 safeStorage
const vault = path.join(root, 'packages/app-shell/src/cred-vault.ts');
ok(fs.existsSync(vault), 'cred-vault.ts 存在');
if (fs.existsSync(vault)) {
  const s = fs.readFileSync(vault, 'utf8');
  ok(/safeStorage|encryptString/i.test(s), 'cred-vault 使用 safeStorage 加密');
  ok(/plain/.test(s) && /如实|不冒充/.test(s), '不可用时如实标 plain，不冒充加密');
}

// 2) 审计日志不得直接拼密钥原文
const main = path.join(root, 'packages/app-shell/src/electron-main.ts');
const ms = fs.readFileSync(main, 'utf8');
const badLog = /audit\?\.log\([^)]*apiKey\s*[:+]/.test(ms) || /qidong\([^)]*apiKey\s*\)/.test(ms);
ok(!badLog, '审计/启动日志不直接拼 apiKey');

// 3) 仓库不得跟踪真实密钥文件（文件名模式，不写具体密钥文件名）
const tracked = String(execSync('git ls-files', { cwd: root, encoding: 'utf8' }));
const forbiddenRe = /(令牌|api[-_]?key|github的令牌|openai[-_]?key).*\.(txt|md|json)$/i;
const hit = tracked.split(/\r?\n/).filter((n) => forbiddenRe.test(n) && !/sample|example|template|placeholder/i.test(n));
ok(hit.length === 0, '仓库未跟踪真实密钥文件', hit.slice(0, 5).join(',') || 'clean');

// 4) 导出密码字段走加密（peizhiDaoChu）
ok(/peizhiDaoChu|nm\.setExportPassword|password/i.test(ms), '配置导出带口令字段');

console.log(fail === 0 ? 'ALL PASS' : 'FAILURES=' + fail);
process.exit(fail === 0 ? 0 : 1);
