import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const root = process.cwd();
const realRoot = fs.realpathSync(root);
const tokenFile = path.join(path.dirname(realRoot), 'github的' + String.fromCharCode(0x4ee4, 0x724c) + '.txt');
const raw = fs.readFileSync(tokenFile, 'utf8');
const token = (raw.match(/gh[pous]_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+/) || [])[0] || '';
if (!token || token.length < 20) { console.error('no token'); process.exit(1); }
const auth = Buffer.from('x-access-token:' + token).toString('base64');
const gitEnv = {
  ...process.env,
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'http.extraheader',
  GIT_CONFIG_VALUE_0: 'Authorization: Basic ' + auth,
};
function git(cmd, env) {
  console.log('>', cmd.slice(0, 90));
  return execSync(cmd, { encoding: 'utf8', cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: env || process.env });
}

// 本脚本先挪开
const self = path.join(root, '_gh-push.mjs');
const bak = path.join(root, '_gh-push.bak.mjs');
try { fs.renameSync(self, bak); } catch { /* noop */ }

git('git add -A');
const msg = 'fix(ci,ui): non-empty i18n resumeTaskHint (CI verify-i18n was empty-value fail); first-run no longer auto-creates 牛马-1 (restore-only); skip AIQ DOM rebuild when unchanged (UI lag); tsconfig typeRoots for node types';
try { git(`git commit -m ${JSON.stringify(msg)}`); } catch (e) {
  console.log('commit', String(e.stdout || e.message || e).slice(0, 250));
}

try { fs.renameSync(bak, self); } catch { /* noop */ }

try {
  console.log('push', git('git push origin HEAD:main', gitEnv).slice(0, 250));
} catch (e) {
  console.log('push fail, try fetch+rebase', String(e.stderr || e.message || e).slice(0, 200));
  try {
    git('git fetch origin main', gitEnv);
    git('git rebase origin/main', gitEnv);
    console.log('push', git('git push origin HEAD:main', gitEnv).slice(0, 250));
  } catch (e2) {
    console.log('push fail2', String(e2.stderr || e2.stdout || e2.message || e2).slice(0, 400));
    try { execSync('git rebase --abort', { cwd: root, stdio: 'ignore' }); } catch { /* noop */ }
    process.exit(1);
  }
}
console.log('HEAD', git('git rev-parse --short HEAD').trim());
